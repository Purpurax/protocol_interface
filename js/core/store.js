// Live warehouse state: polls / listens to the warehouse, keeps a normalized copy of the snapshot,
// animates what happens between two database updates and learns how fast the motors really are.

import { Emitter } from './util.js';
import { DEFAULT_RATE, config, saveConfig } from './config.js';
import { STATUS, motorKinds } from '../shared/kinematics.js';
import { materialVolume, num } from '../shared/material.js';

const POLL_BUSY_MS = 300;
const POLL_IDLE_MS = 1500;
const MIN_CALIBRATION_MM = 2;
const FORGET = 0.94; // weight of older measurements each time a new one arrives

/** Critically damped spring towards a target (the classic game "smooth damp"). */
function smoothDamp(state, target, smoothTime, dt) {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = state.value - target;
  const temp = (state.velocity + omega * change) * dt;
  state.velocity = (state.velocity - omega * temp) * exp;
  state.value = target + (change + temp) * exp;
}

/** Expected fraction done after `elapsed` of a move predicted to take `total`: linear, then it
 *  creeps towards (never reaches) the end until the database confirms the move. */
function progress(elapsed, total) {
  const t = Math.max(0, elapsed) / Math.max(1, total);
  if (t <= 0.85) return t;
  return 0.85 + 0.135 * (1 - Math.exp(-(t - 0.85) / 0.45));
}

export class Store extends Emitter {
  constructor(api) {
    super();
    this.api = api;
    this.ready = false;
    this.online = true;
    this.revision = -1;
    this.simulated = false;
    this.timeScale = 1;
    this.run = null;
    this.paused = false; // the warehouse runtime starts no new instruction
    this.motors = new Map();
    this.conveyors = new Map();
    this.cargos = new Map();
    this.containers = new Map();
    this.tips = new Map();
    this.pipetters = new Map();
    this.materials = new Map();
    this.containerTypes = new Map();
    this.deadzones = [];
    this.calibrators = [];
    this.instructions = [];
    this.instructionById = new Map();
    this.lookup = { substances: new Map(), organisms: new Map(), proteins: new Map() };
    this.containersByCargo = new Map();
    this.tipsByCargo = new Map();
    this.motorKind = new Map();
    this.motorOwner = new Map();
    this.structureKey = '';
    this.raw = null;

    this.tracked = new Map(); // running automatic instructions: id -> { t0, predicted, d, motorId, kind }
    this.motorDisplay = new Map(); // motor id -> { value, velocity }
    this.cargoDisplay = new Map(); // cargo id -> { x: {value, velocity}, y, vx, vy, moving }
    this.pollTimer = null;
    this.refreshing = false;
    this.stopListening = null;
  }

  // ------------------------------------------------------------------ connection

  connect() {
    this.stopListening = this.api.listen((event) => this.onServerEvent(event), (up) => this.emit('stream', up));
    this.schedulePoll(0);
  }

  disconnect() {
    clearTimeout(this.pollTimer);
    this.stopListening?.();
  }

  schedulePoll(ms) {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.refresh(), ms);
  }

  async refresh() {
    if (this.refreshing) { this.again = true; return; }
    this.refreshing = true;
    try {
      const snapshot = await this.api.state();
      if (!this.online) { this.online = true; this.emit('online', true); }
      this.apply(snapshot);
    } catch (err) {
      if (this.online) { this.online = false; this.emit('online', false); }
    } finally {
      this.refreshing = false;
      const again = this.again;
      this.again = false;
      this.schedulePoll(again ? 30 : this.busy ? POLL_BUSY_MS : POLL_IDLE_MS);
    }
  }

  onServerEvent(event) {
    if (event === 'StateChanged' || (event && typeof event === 'object' && 'StateChanged' in event)) {
      this.schedulePoll(15);
      return;
    }
    if (event?.ManualCommand) this.emit('manual', { id: event.ManualCommand[0], command: event.ManualCommand[1] });
    else if (event?.ProtocolFinished) this.emit('finished', { id: event.ProtocolFinished[0], name: event.ProtocolFinished[1] });
    else if (event?.Error) this.emit('error', String(event.Error));
    this.schedulePoll(15);
  }

  get busy() { return this.instructions.some((ins) => ins.status !== STATUS.COMPLETED); }

  // ------------------------------------------------------------------ snapshot

  apply(snap) {
    const now = performance.now();
    const firstTime = !this.ready;
    const serverNow = Date.parse(snap.server_time) || Date.now();
    this.raw = snap;
    this.simulated = !!snap.simulated;
    this.timeScale = num(snap.time_scale, 1) || 1;
    this.run = snap.run || null;
    const pausedChanged = this.paused !== !!snap.paused;
    this.paused = !!snap.paused;

    const index = (rows, key, map) => new Map((rows || []).map((row) => [row[key], map(row)]));
    this.motors = index(snap.motors, 'motor_id', (m) => ({ ...m, id: m.motor_id, value: num(m.grbl_value) }));
    this.conveyors = index(snap.conveyors, 'conveyor_id', (c) => ({
      id: c.conveyor_id, storage: !!c.is_storage, x: num(c.absolute_x), y: num(c.absolute_y),
      lenX: num(c.length_x), lenY: num(c.length_y), xm: c.x_motor ?? null, ym: c.y_motor ?? null,
    }));
    this.cargos = index(snap.cargos, 'cargo_id', (c) => ({
      id: c.cargo_id, conveyorId: c.on_conveyor_id, rel: num(c.relative_x), anchoredConveyor: c.anchored_conveyor ?? null,
      anchoredRel: c.anchored_relative_x == null ? null : num(c.anchored_relative_x),
      sinceCalibration: num(c.x_distance_after_last_calibration), available: c.is_available !== false,
      label: c.label || null, collection: c.collection || null,
    }));
    this.containerTypes = index(snap.container_types, 'container_type_id', (t) => t.container_type_name);
    this.materials = index(snap.materials, 'material_id', (m) => m);
    this.containers = index(snap.containers, 'container_id', (c) => ({
      id: c.container_id, typeId: c.container_type_id, type: this.containerTypes.get(c.container_type_id) || '',
      cargoId: c.on_cargo_id, x: num(c.relative_center_x), z: num(c.relative_center_z), maxVolume: num(c.maximum_volume),
      closed: !!c.is_closed, materialId: c.material_id,
    }));
    this.tips = index(snap.tip_containers, 'tip_container_id', (t) => ({
      id: t.tip_container_id, cargoId: t.on_cargo_id, x: num(t.relative_center_x), z: num(t.relative_center_z),
      hasTip: !!t.has_tip, sterile: !!t.is_sterile,
    }));
    this.pipetters = index(snap.pipetters, 'pipetter_id', (p) => ({
      id: p.pipetter_id, conveyorId: p.on_conveyor_id, x: num(p.absolute_x), y: num(p.absolute_y),
      ym: p.y_motor ?? null, zm: p.z_motor ?? null, pm: p.push_motor ?? null, lenY: num(p.length_y), lenZ: num(p.length_z),
    }));
    this.deadzones = (snap.deadzones || []).map((d) => ({ id: d.deadzone_id, conveyorId: d.on_conveyor_id, start: num(d.start_x), end: num(d.end_x) }));
    this.calibrators = (snap.calibrators || []).map((c) => ({
      id: c.calibrator_id, conveyorId: c.conveyor_id, forCargo: !!c.meant_for_cargo,
      left: c.calibrates_left_x, right: c.calibrates_right_x, up: c.calibrates_up_y, down: c.calibrates_down_y,
    }));
    this.lookup = {
      substances: new Map((snap.substances || []).map((s) => [s.substance_id, { ...s, molar: num(s.molar), density: num(s.density), hazard: s.hazard || {} }])),
      organisms: new Map((snap.organisms || []).map((o) => [o.organism_id, o])),
      proteins: new Map((snap.proteins || []).map((p) => [p.protein_id, p])),
    };
    this.motorKind = motorKinds({ conveyors: snap.conveyors || [], pipetters: snap.pipetters || [] });
    this.motorOwner = new Map();
    for (const p of this.pipetters.values()) {
      for (const [axis, id] of [['Y', p.ym], ['Z', p.zm], ['push', p.pm]]) if (id != null) this.motorOwner.set(id, { type: 'pipetter', id: p.id, axis });
    }
    for (const c of this.conveyors.values()) {
      if (c.xm != null) this.motorOwner.set(c.xm, { type: 'conveyor', id: c.id, axis: 'X' });
      if (c.ym != null) this.motorOwner.set(c.ym, { type: 'conveyor', id: c.id, axis: 'Y' });
    }

    this.containersByCargo = new Map();
    for (const c of this.containers.values()) {
      if (!this.containersByCargo.has(c.cargoId)) this.containersByCargo.set(c.cargoId, []);
      this.containersByCargo.get(c.cargoId).push(c);
    }
    this.tipsByCargo = new Map();
    for (const t of this.tips.values()) {
      if (!this.tipsByCargo.has(t.cargoId)) this.tipsByCargo.set(t.cargoId, []);
      this.tipsByCargo.get(t.cargoId).push(t);
    }

    // instructions
    this.instructions = (snap.instructions || []).map((ins) => {
      const command = ins.manual?.command || '';
      const ids = (pattern) => [...command.matchAll(pattern)].map((m) => Number(m[1]));
      return {
        id: ins.instruction_id, auto: !!ins.is_automatic, status: ins.instruction_status, deps: ins.depends_on || [],
        motorId: ins.automatic?.motor_id ?? null, d: num(ins.automatic?.target_value), label: ins.label || null,
        pairWith: ins.pair_with ?? null, startedAt: ins.started_at ? Date.parse(ins.started_at) : null,
        completedAt: ins.completed_at ? Date.parse(ins.completed_at) : null,
        manual: ins.manual ? {
          id: ins.manual.instruction_manual_command_id, command, accepted: !!ins.manual.user_accepted,
          task: ins.manual.task || (/open/i.test(command) ? 'open' : /refill/i.test(command) ? 'refill' : /transfer/i.test(command) ? 'transfer' : 'task'),
          containerIds: ins.manual.container_ids || ids(/container (\d+)/gi),
          cargoIds: ins.manual.cargo_ids || ids(/cargo (\d+)/gi),
        } : null,
      };
    });
    this.instructionById = new Map(this.instructions.map((ins) => [ins.id, ins]));
    this.trackInstructions(now, serverNow);

    // display state: new things start where they are, known things keep animating
    for (const motor of this.motors.values()) {
      if (!this.motorDisplay.has(motor.id)) this.motorDisplay.set(motor.id, { value: motor.value, velocity: 0 });
    }
    for (const id of [...this.motorDisplay.keys()]) if (!this.motors.has(id)) this.motorDisplay.delete(id);
    for (const id of [...this.cargoDisplay.keys()]) if (!this.cargos.get(id)?.available) this.cargoDisplay.delete(id);

    const structureKey = [
      [...this.conveyors.values()].map((c) => `${c.id}:${c.x}:${c.y}:${c.lenX}:${c.lenY}:${c.storage}`).join(','),
      [...this.cargos.values()].map((c) => `${c.id}:${c.available}`).join(','),
      [...this.containers.values()].map((c) => `${c.id}:${c.cargoId}:${c.x}:${c.z}:${c.typeId}`).join(','),
      [...this.tips.values()].map((t) => `${t.id}:${t.cargoId}`).join(','),
      [...this.pipetters.values()].map((p) => `${p.id}:${p.x}:${p.y}`).join(','),
      this.deadzones.length, this.calibrators.length,
    ].join('|');
    const structureChanged = structureKey !== this.structureKey;
    this.structureKey = structureKey;
    const revisionChanged = snap.revision == null || snap.revision !== this.revision;
    this.revision = snap.revision ?? this.revision + 1;

    this.ready = true;
    if (firstTime) this.emit('ready');
    if (structureChanged) this.emit('structure');
    if (revisionChanged || structureChanged) this.emit('snapshot');
    if (pausedChanged) this.emit('paused', this.paused);
  }

  trackInstructions(now, serverNow) {
    for (const ins of this.instructions) {
      if (!ins.auto || ins.status !== STATUS.RUNNING || this.tracked.has(ins.id)) continue;
      const kind = this.motorKind.get(ins.motorId) || 'tool';
      const alreadyRunning = ins.startedAt ? Math.max(0, serverNow - ins.startedAt) : 0;
      this.tracked.set(ins.id, { t0: now - alreadyRunning, predicted: this.predictMs(ins), d: ins.d, motorId: ins.motorId, kind });
      this.emit('instruction:start', ins);
    }
    for (const [id, track] of [...this.tracked]) {
      const ins = this.instructionById.get(id);
      if (ins && ins.status === STATUS.RUNNING) continue;
      this.tracked.delete(id);
      const measured = ins?.startedAt && ins?.completedAt ? ins.completedAt - ins.startedAt : now - track.t0;
      this.calibrate(track, measured);
      this.emit('instruction:done', { id, measured, predicted: track.predicted });
    }
  }

  /** Predicted duration of an automatic move in wall-clock ms. */
  predictMs(ins) {
    const model = config.speed[this.motorKind.get(ins.motorId) || 'tool'];
    return Math.max(40, (model.overhead + Math.abs(ins.d) * model.rate) / this.timeScale);
  }

  /**
   * Learns from a finished move how long moves really take. The model is a line,
   * time = overhead + rate * distance, fitted by weighted least squares in which old measurements
   * fade out. It starts from the default rate of the motor kind and corrects itself over the first moves.
   */
  calibrate(track, measuredMs) {
    const distance = Math.abs(track.d);
    if (distance < MIN_CALIBRATION_MM || !(measuredMs > 0)) return;
    const time = Math.min(600000, measuredMs * this.timeScale);
    const model = config.speed[track.kind];
    // the prior: two imagined moves (50 mm and 500 mm, half weight each) that follow the default rate exactly
    const prior = DEFAULT_RATE[track.kind] ?? 10;
    const fit = model.fit || { w: 1, d: 275, t: 275 * prior, dd: 126250, dt: 126250 * prior };
    for (const key of Object.keys(fit)) fit[key] *= FORGET;
    fit.w += 1; fit.d += distance; fit.t += time; fit.dd += distance * distance; fit.dt += distance * time;
    const spread = fit.w * fit.dd - fit.d * fit.d;
    let rate = spread > 1e-6 ? (fit.w * fit.dt - fit.d * fit.t) / spread : fit.t / fit.d;
    let overhead = (fit.t - rate * fit.d) / fit.w;
    if (!(rate > 0.2) || overhead < 0) { rate = fit.dt / fit.dd; overhead = 0; } // fall back to a line through zero
    model.fit = fit;
    model.rate = Math.min(500, Math.max(0.2, rate));
    model.overhead = Math.min(10000, Math.max(0, overhead));
    model.samples += 1;
    saveConfig('speed');
  }

  // ------------------------------------------------------------------ per-frame motion

  update(dt) {
    if (!this.ready) return;
    const now = performance.now();
    const offsets = new Map();
    for (const track of this.tracked.values()) {
      const offset = track.d * progress(now - track.t0, track.predicted);
      offsets.set(track.motorId, (offsets.get(track.motorId) || 0) + offset);
    }
    for (const [id, display] of this.motorDisplay) {
      const motor = this.motors.get(id);
      smoothDamp(display, motor.value + (offsets.get(id) || 0), 0.12, dt);
      if (Math.abs(display.velocity) < 0.02 && !offsets.has(id)) display.velocity = 0;
    }
    for (const cargo of this.cargos.values()) {
      if (!cargo.available) continue;
      const conv = this.conveyors.get(cargo.conveyorId);
      if (!conv) continue;
      const beltOffset = conv.xm != null ? this.motorDisplay.get(conv.xm).value - this.motors.get(conv.xm).value : 0;
      const targetX = conv.x + cargo.rel + beltOffset;
      const y = this.conveyorY(conv.id);
      let display = this.cargoDisplay.get(cargo.id);
      if (!display) {
        display = { x: { value: targetX, velocity: 0 }, y, vx: 0, vy: 0, moving: false };
        this.cargoDisplay.set(cargo.id, display);
      }
      const previousY = display.y;
      smoothDamp(display.x, targetX, 0.06, dt);
      display.y = y;
      display.vx = display.x.velocity;
      display.vy = dt > 0 ? (y - previousY) / dt : 0;
      display.moving = Math.abs(display.vx) > 1.5 || Math.abs(display.vy) > 1.5;
    }
  }

  motorValue(id) { return this.motorDisplay.get(id)?.value ?? this.motors.get(id)?.value ?? 0; }
  motorVelocity(id) { return this.motorDisplay.get(id)?.velocity ?? 0; }

  /** Current height of a conveyor's belt surface (elevators travel). */
  conveyorY(id) {
    const conv = this.conveyors.get(id);
    if (!conv) return 0;
    return conv.y + (conv.ym != null ? this.motorValue(conv.ym) : 0);
  }

  /** Remaining travel of the move a motor is doing right now (0 when idle). */
  motorRemaining(id) {
    let target = this.motors.get(id)?.value ?? 0;
    let active = false;
    for (const track of this.tracked.values()) if (track.motorId === id) { target += track.d; active = true; }
    return active ? target - this.motorValue(id) : 0;
  }

  /** Where the move that is running right now will leave a cargo, or null when it is at rest. */
  cargoDestination(id) {
    const cargo = this.cargos.get(id);
    const conv = cargo && this.conveyors.get(cargo.conveyorId);
    if (!conv) return null;
    let dx = 0, dy = 0, active = false;
    for (const track of this.tracked.values()) {
      if (track.motorId === conv.xm) { dx += track.d; active = true; }
      if (track.motorId === conv.ym) { dy += track.d; active = true; }
    }
    if (!active) return null;
    return { x: conv.x + cargo.rel + dx, y: conv.y + (conv.ym != null ? this.motors.get(conv.ym).value : 0) + dy };
  }

  cargoPosition(id) {
    const display = this.cargoDisplay.get(id);
    if (display) return { x: display.x.value, y: display.y };
    const cargo = this.cargos.get(id);
    const conv = cargo && this.conveyors.get(cargo.conveyorId);
    return conv ? { x: conv.x + cargo.rel, y: this.conveyorY(conv.id) } : { x: 0, y: 0 };
  }

  // ------------------------------------------------------------------ convenience

  materialOf(container) { return this.materials.get(container.materialId) || { substances: [], proteins: [], organisms: [] }; }
  volumeOf(container) { return materialVolume(this.materialOf(container), this.lookup); }
  cargoName(id) {
    const cargo = this.cargos.get(id);
    return cargo?.label ? `${cargo.label}` : `Cargo ${id}`;
  }
  cargoTag(id) { return `C-${String(id).padStart(2, '0')}`; }

  /** "A1"-style slot name derived from the container's position among its siblings. */
  slotName(container) {
    const siblings = this.containersByCargo.get(container.cargoId) || [];
    const rows = [...new Set(siblings.map((c) => c.z))].sort((a, b) => a - b);
    const cols = [...new Set(siblings.map((c) => c.x))].sort((a, b) => a - b);
    return `${'ABCDEFGHIJKLMNOP'[rows.indexOf(container.z)] || '?'}${cols.indexOf(container.x) + 1}`;
  }

  /** One line describing an instruction, used when the warehouse sends no label. */
  describe(ins) {
    if (ins.label) return ins.label;
    if (!ins.auto) return ins.manual?.command || 'Manual task';
    const owner = this.motorOwner.get(ins.motorId);
    const mm = `${Math.abs(ins.d) >= 100 ? Math.abs(ins.d).toFixed(0) : Math.abs(ins.d).toFixed(1)} mm`;
    if (!owner) return `Motor ${ins.motorId}: ${ins.d >= 0 ? '+' : '−'}${mm}`;
    if (owner.type === 'conveyor') {
      const arrow = owner.axis === 'X' ? (ins.d >= 0 ? '→' : '←') : (ins.d >= 0 ? '↑' : '↓');
      return `${owner.axis === 'X' ? 'Conveyor' : 'Lift'} ${owner.id} ${arrow} ${mm}`;
    }
    return `Pipetter ${owner.id} ${owner.axis} ${ins.d >= 0 ? '+' : '−'}${mm}`;
  }

  activeInstructions() { return this.instructions.filter((ins) => ins.status !== STATUS.COMPLETED); }
  pendingManual() { return this.instructions.filter((ins) => !ins.auto && ins.status === STATUS.RUNNING); }
}
