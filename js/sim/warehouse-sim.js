// In-process warehouse simulator.
//
// It implements the HTTP contract the interface expects from protocol_warehouse (the existing
// endpoints plus the ones requested in required.md), so the interface can run without hardware.
// It has no DOM dependency: the browser uses it directly, `serve.mjs --mock` exposes it over HTTP.
//
// Like the real runtime, it only publishes a position once an instruction is COMPLETED; what
// happens in between is the client's job to predict.

import { seedDatabase } from './seed.js';
import { COLLECTIONS } from '../shared/collections.js';
import {
  CARGO_PITCH, CARGO_WIDTH, MAX_OVERHANG, STATUS, convY, makeKin, motorKinds, moveMotor, pickStartable, settle,
} from '../shared/kinematics.js';
import { beltRange, liftRange, positionProblem, sticksOut } from '../shared/limits.js';
import { cloneMaterial, extractRatio, materialVolume, materialsMatch, mergeMaterial, num } from '../shared/material.js';

const TICK_MS = 40;
const INFORM_AGAIN_MS = 5000;
const PIPETTE_MAX_UL = 1000;
const MAX_CYCLES = 5;
const KEEP_COMPLETED = 60;

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class WarehouseSim {
  /** opts: { storage?: { load(): object|null, save(db): void }, timeScale?: number } */
  constructor(opts = {}) {
    this.storage = opts.storage || null;
    this.timeScale = opts.timeScale || 1;
    this.rates = { x: 33.5, y: 31.2, tool: 5.6 }; // true ms per mm (belts as measured on the hardware), the client has to learn these
    this.overheadMs = 120;
    this.listeners = new Set();
    this.revision = 1;
    this.running = new Map(); // instruction_id -> { ins, t0, dur, applied }
    this.batches = new Map(); // grbl_index -> open instruction count
    this.timer = null;
    this.paused = false; // runtime only, like in the warehouse: never stored
    this.load();
  }

  load() {
    let db = null;
    try { db = this.storage?.load() || null; } catch { db = null; }
    this.db = db && db.motor && db.conveyor ? db : seedDatabase();
    // Anything that was running when the page closed starts over.
    for (const ins of this.db.instruction) {
      if (ins.instruction_status === STATUS.RUNNING) { ins.instruction_status = STATUS.OPEN; ins.started_at = null; }
    }
    this.running.clear();
    this.batches.clear();
    this.live = makeKin({ motors: this.db.motor, conveyors: this.db.conveyor, cargos: this.db.cargo });
  }

  reset() {
    this.db = seedDatabase();
    this.running.clear();
    this.batches.clear();
    this.live = makeKin({ motors: this.db.motor, conveyors: this.db.conveyor, cargos: this.db.cargo });
    this.changed();
  }

  start() { if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS); }
  stop() { clearInterval(this.timer); this.timer = null; }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(event) { for (const fn of this.listeners) { try { fn(event); } catch (err) { console.error(err); } } }

  changed() {
    this.revision += 1;
    this.emit({ StateChanged: this.revision });
    if (this.storage) {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => { try { this.storage.save(this.db); } catch { /* storage full */ } }, 400);
    }
  }

  // ------------------------------------------------------------------ lookups

  get lookup() {
    return {
      substances: new Map(this.db.substance.map((s) => [s.substance_id, s])),
      organisms: new Map(this.db.organism.map((o) => [o.organism_id, o])),
      proteins: new Map(this.db.protein.map((p) => [p.protein_id, p])),
    };
  }
  row(table, key, id) { return this.db[table].find((r) => r[key] === id); }
  materialOf(container) { return this.row('material', 'material_id', container.material_id); }
  nextId(table, key) { return this.db[table].reduce((max, r) => Math.max(max, r[key]), 0) + 1; }

  // ------------------------------------------------------------------ runtime

  tick() {
    const now = Date.now();
    let changed = false;

    // 1. advance running moves in the live model
    const finished = [];
    for (const run of this.running.values()) {
      const p = Math.min(1, (now - run.t0) / run.dur);
      const delta = run.ins.automatic.target_value;
      moveMotor(this.live, run.ins.automatic.motor_id, (p - run.applied) * delta);
      run.applied = p;
      if (p >= 1) finished.push(run);
    }
    if (this.running.size) settle(this.live);

    // 2. complete: this is the moment the "database" learns about the move
    for (const run of finished) {
      const { ins } = run;
      this.running.delete(ins.instruction_id);
      ins.instruction_status = STATUS.COMPLETED;
      ins.completed_at = new Date(now).toISOString();
      const motor = this.row('motor', 'motor_id', ins.automatic.motor_id);
      motor.grbl_value = round4(motor.grbl_value + ins.automatic.target_value);
      this.live.motor.set(motor.motor_id, motor.grbl_value);
      const left = (this.batches.get(motor.grbl_index) || 1) - 1;
      if (left <= 0) this.batches.delete(motor.grbl_index); else this.batches.set(motor.grbl_index, left);
      this.applyEffect(ins.fx);
      changed = true;
    }
    if (finished.length) this.publishCargoPositions();

    // 3. start whatever became executable
    const statusOf = (id) => this.row('instruction', 'instruction_id', id)?.instruction_status ?? STATUS.COMPLETED;
    const flat = this.db.instruction.map((ins) => ({
      id: ins.instruction_id, is_automatic: ins.is_automatic, depends_on: ins.depends_on,
      motor_id: ins.automatic?.motor_id, pair_with: ins.pair_with, ref: ins,
    }));
    const motorById = new Map(this.db.motor.map((m) => [m.motor_id, m]));
    // paused: running moves finish, nothing new starts
    const { auto, manual } = this.paused ? { auto: [], manual: [] } : pickStartable(flat, statusOf, new Set(this.batches.keys()), motorById);
    const kinds = motorKinds({ conveyors: this.db.conveyor, pipetters: this.db.pipetter });
    for (const { ref: ins } of auto) {
      const motor = motorById.get(ins.automatic.motor_id);
      ins.instruction_status = STATUS.RUNNING;
      ins.started_at = new Date(now).toISOString();
      this.batches.set(motor.grbl_index, (this.batches.get(motor.grbl_index) || 0) + 1);
      this.running.set(ins.instruction_id, { ins, t0: now, dur: this.durationOf(ins, kinds), applied: 0 });
      changed = true;
    }
    for (const { ref: ins } of manual) {
      ins.instruction_status = STATUS.RUNNING;
      ins.started_at = new Date(now).toISOString();
      changed = true;
    }

    // 4. (re)inform the user about manual work
    for (const ins of this.db.instruction) {
      if (ins.is_automatic || ins.instruction_status !== STATUS.RUNNING || ins.manual.user_accepted) continue;
      if (now - Date.parse(ins.manual.last_user_inform) < INFORM_AGAIN_MS) continue;
      ins.manual.last_user_inform = new Date(now).toISOString();
      this.emit({ ManualCommand: [ins.manual.instruction_manual_command_id, ins.manual.command] });
    }

    // 5. run finished?
    if (this.db.run && !this.db.instruction.some((ins) => ins.instruction_status !== STATUS.COMPLETED)) {
      this.emit({ ProtocolFinished: [this.db.run.protocol_id, this.db.run.protocol_name] });
      this.db.run = null;
      changed = true;
    }
    if (changed) {
      this.trimCompleted();
      this.changed();
    }
  }

  durationOf(ins, kinds) {
    const distance = Math.abs(ins.automatic.target_value);
    const kind = kinds.get(ins.automatic.motor_id) || 'tool';
    // The jitter depends on the dependency set only, so both halves of a transfer pair agree.
    let hash = Math.round(distance * 10);
    for (const dep of ins.depends_on) hash = (hash * 33 + dep) >>> 0;
    const jitter = 1 + 0.07 * Math.sin(hash * 12.9898);
    return Math.max(TICK_MS, ((distance * this.rates[kind] + this.overheadMs) * jitter) / this.timeScale);
  }

  /** Copies live cargo positions into the tables for every belt that is at rest. */
  publishCargoPositions() {
    const movingBelts = new Set();
    for (const run of this.running.values()) {
      for (const conv of this.live.convs) if (conv.xm === run.ins.automatic.motor_id) movingBelts.add(conv.id);
    }
    for (const cargo of this.live.cargos) {
      const row = this.row('cargo', 'cargo_id', cargo.id);
      if (!row || movingBelts.has(cargo.conv.id) || movingBelts.has(row.on_conveyor_id)) continue;
      const travelled = Math.abs(cargo.conv.x + cargo.rel - (this.live.convById.get(row.on_conveyor_id).x + row.relative_x));
      row.x_distance_after_last_calibration = round4(row.x_distance_after_last_calibration + travelled);
      row.on_conveyor_id = cargo.conv.id;
      row.relative_x = round4(cargo.rel);
    }
  }

  applyEffect(fx) {
    if (!fx) return;
    if (fx.type === 'pick') {
      const tip = this.row('tip_container', 'tip_container_id', fx.tip);
      if (tip) tip.has_tip = false;
    } else if (fx.type === 'eject') {
      const tip = this.row('tip_container', 'tip_container_id', fx.tip);
      if (tip) { tip.has_tip = true; tip.is_sterile = false; }
    } else if (fx.type === 'transfer') {
      const from = this.row('container', 'container_id', fx.from);
      const to = this.row('container', 'container_id', fx.to);
      if (!from || !to) return;
      const source = this.materialOf(from);
      const volume = materialVolume(source, this.lookup);
      if (volume <= 0) return;
      mergeMaterial(this.materialOf(to), extractRatio(source, fx.volume / volume));
    } else if (fx.type === 'open') {
      const container = this.row('container', 'container_id', fx.container);
      if (container) container.is_closed = false;
    } else if (fx.type === 'refill') {
      for (const tip of this.db.tip_container) {
        if (tip.on_cargo_id === fx.cargo) { tip.has_tip = true; tip.is_sterile = true; }
      }
    }
  }

  trimCompleted() {
    const done = this.db.instruction.filter((ins) => ins.instruction_status === STATUS.COMPLETED);
    if (done.length <= KEEP_COMPLETED * 2) return;
    const drop = new Set(done.slice(0, done.length - KEEP_COMPLETED).map((ins) => ins.instruction_id));
    this.db.instruction = this.db.instruction.filter((ins) => !drop.has(ins.instruction_id));
    for (const ins of this.db.instruction) ins.depends_on = ins.depends_on.filter((id) => !drop.has(id));
  }

  // ------------------------------------------------------------------ planner

  /** Returns { can_run, reasons, mapping, list } without touching the tables. */
  plan(protocolId) {
    const protocol = this.row('protocol', 'protocol_id', protocolId);
    if (!protocol) throw new ApiError(404, `Unknown protocol ${protocolId}`);
    const lookup = this.lookup;
    const reasons = [];
    const mapping = {};

    // virtual -> physical containers
    const flows = new Map(protocol.containers.map((c) => [c.virtual_container_id, { ins: 0, outs: 0 }]));
    for (const step of protocol.steps) {
      if (flows.has(step.from_id)) flows.get(step.from_id).outs += num(step.volume);
      if (flows.has(step.to_id)) flows.get(step.to_id).ins += num(step.volume);
    }
    const usable = this.db.container.filter((c) => this.row('cargo', 'cargo_id', c.on_cargo_id)?.is_available !== false);
    const taken = new Set();
    for (const virt of protocol.containers) {
      const flow = flows.get(virt.virtual_container_id);
      const fits = (c) => {
        const volume = materialVolume(this.materialOf(c), lookup);
        return volume + 1e-6 >= flow.outs && volume + flow.ins <= num(c.maximum_volume) + 1e-6;
      };
      let choice = usable.find((c) => c.container_id === virt.preferred_container_id && !taken.has(c.container_id));
      if (!choice) {
        choice = usable.find((c) => !taken.has(c.container_id) && materialsMatch(this.materialOf(c), virt.material, lookup) && fits(c));
      }
      if (!choice) {
        reasons.push(`No physical container for virtual container ${virt.virtual_container_id}`);
        continue;
      }
      taken.add(choice.container_id);
      mapping[virt.virtual_container_id] = choice.container_id;
    }
    if (!protocol.steps.length) reasons.push('Protocol has no steps');
    if (reasons.length) return { can_run: false, reasons, mapping, list: [] };

    try {
      const list = this.planMoves(protocol, mapping);
      return { can_run: true, reasons, mapping, list };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      return { can_run: false, reasons: [err.message], mapping, list: [] };
    }
  }

  /** `job` is a protocol, or { cargoMove: { cargoId, conveyorId, relX } } to drive one cargo somewhere. */
  planMoves(job, mapping) {
    const protocol = job.cargoMove ? { steps: [] } : job;
    const db = this.db;
    const kin = makeKin({ motors: db.motor, conveyors: db.conveyor, cargos: db.cargo });
    const list = [];
    const last = new Map(); // resource -> Set(index)
    let barrier = new Set();
    const depsFor = (resources) => {
      const deps = new Set();
      for (const r of resources) for (const i of last.get(r) || barrier) deps.add(i);
      return deps;
    };
    const res = (conv) => `conv${conv.id}`;
    const emit = (motor_id, delta, after, marks, label, fx) => {
      if (Math.abs(delta) < 0.01 && !fx) return;
      list.push({ automatic: { motor_id, target_value: round4(delta) }, deps: depsFor(after), label, fx });
      for (const r of marks) last.set(r, new Set([list.length - 1]));
    };
    const manual = (command, task, container_ids, cargo_ids, fx) => {
      const deps = new Set(barrier);
      for (const set of last.values()) for (const i of set) deps.add(i);
      list.push({ manual: { command, task, container_ids, cargo_ids }, deps, label: command, fx });
      barrier = new Set([list.length - 1]);
      last.clear();
    };

    const pipetter = db.pipetter[0];
    const pipConv = pipetter ? kin.convById.get(pipetter.on_conveyor_id) : null;
    const elevator = kin.convs.find((c) => c.ym != null);
    const cargoOf = (id) => kin.cargos.find((c) => c.id === id);
    const cargosOn = (conv) => kin.cargos.filter((c) => c.conv === conv).sort((a, b) => a.rel - b.rel);
    const home = new Map(kin.cargos.map((c) => [c.id, c.conv]));
    const capacity = (conv) => Math.floor((conv.lenX + CARGO_PITCH - CARGO_WIDTH) / CARGO_PITCH);
    const name = (cargo) => db.cargo.find((c) => c.cargo_id === cargo.id)?.label || `cargo ${cargo.id}`;

    const moveBelt = (conv, delta, label) => {
      if (Math.abs(delta) < 0.01) return;
      for (const cargo of cargosOn(conv)) {
        const rel = cargo.rel + delta;
        if (rel < -MAX_OVERHANG - 0.01 || rel > conv.lenX - CARGO_WIDTH + MAX_OVERHANG + 0.01) {
          throw new Error(`Belt ${conv.id} cannot move ${Math.round(delta)} mm: ${name(cargo)} would fall off`);
        }
      }
      const after = [res(conv)];
      if (conv === pipConv) after.push('head');
      emit(conv.xm, delta, after, [res(conv)], label);
      moveMotor(kin, conv.xm, delta);
      settle(kin);
    };
    const liftTo = (y, label) => {
      const delta = y - convY(kin, elevator);
      if (y < elevator.y0 - 0.01 || y > elevator.y0 + elevator.lenY + 0.01) throw new Error('Elevator cannot reach that height');
      emit(elevator.ym, delta, [res(elevator)], [res(elevator)], label);
      kin.motor.set(elevator.ym, kin.motor.get(elevator.ym) + delta);
    };
    const transfer = (a, b, delta, label) => {
      const deps = depsFor(a === pipConv || b === pipConv ? [res(a), res(b), 'head'] : [res(a), res(b)]);
      list.push({ automatic: { motor_id: a.xm, target_value: round4(delta) }, deps, label, pair: list.length + 1 });
      list.push({ automatic: { motor_id: b.xm, target_value: round4(delta) }, deps: new Set(deps), label, pair: list.length - 1 });
      const pair = new Set([list.length - 2, list.length - 1]);
      last.set(res(a), pair);
      last.set(res(b), new Set(pair));
      moveMotor(kin, a.xm, delta);
      moveMotor(kin, b.xm, delta);
      settle(kin);
    };

    const needed = new Set();
    /** Moves `cargo` (via the elevator on the left) onto `dest`. */
    const bring = (cargo, dest) => {
      const src = cargo.conv;
      if (src === dest) return;
      if (!elevator) throw new Error('No elevator connects the conveyors');
      if (cargosOn(dest).length >= capacity(dest)) throw new Error(`Conveyor ${dest.id} is full`);
      const tag = name(cargo);
      if (src !== elevator) {
        // everything between the cargo and the elevator has to leave first
        for (;;) {
          const blocker = cargosOn(src).find((other) => other.rel < cargo.rel);
          if (!blocker) break;
          if (needed.has(blocker.id) && pipConv && src !== pipConv) bring(blocker, pipConv);
          else park(blocker, [src, dest]);
        }
        moveBelt(src, -cargo.rel, `${tag}: to the belt edge`);
        liftTo(convY(kin, src), `Elevator to conveyor ${src.id}`);
        const out = elevator.x + elevator.lenX - CARGO_WIDTH - (src.x + cargo.rel);
        transfer(src, elevator, out, `${tag}: onto the elevator`);
        if (cargosOn(src).length) moveBelt(src, -CARGO_WIDTH - out, `Conveyor ${src.id}: re-seat cargo`);
      }
      if (dest === elevator) return;
      liftTo(convY(kin, dest), `${tag}: lift to conveyor ${dest.id}`);
      const into = dest.x - (elevator.x + cargo.rel);
      const others = cargosOn(dest);
      if (others.length) moveBelt(dest, CARGO_PITCH - into - others[0].rel, `Conveyor ${dest.id}: make room`);
      transfer(elevator, dest, into, `${tag}: onto conveyor ${dest.id}`);
    };
    /** Puts a cargo away on a shelf. */
    const park = (cargo, avoid = []) => {
      const row = db.cargo.find((c) => c.cargo_id === cargo.id);
      const shelves = kin.convs.filter((c) => c.ym == null && c !== pipConv && !avoid.includes(c) && c !== cargo.conv
        && cargosOn(c).length < capacity(c));
      const score = (c) => (c.id === row?.anchored_conveyor ? -1000 : 0) + (c === home.get(cargo.id) ? -100 : 0) + cargosOn(c).length;
      shelves.sort((a, b) => score(a) - score(b));
      if (!shelves.length) throw new Error(`No shelf has room for ${name(cargo)}`);
      bring(cargo, shelves[0]);
    };

    // pipetter helpers (the belt does the x positioning, the pipetter moves in y and z)
    const alignX = (cargo, relX, label) => moveBelt(pipConv, num(pipetter.absolute_x) - (pipConv.x + cargo.rel + relX), label);
    const zTo = (z) => {
      const delta = z - kin.motor.get(pipetter.z_motor);
      emit(pipetter.z_motor, delta, ['pz', 'head'], ['pz'], 'Pipetter: depth');
      kin.motor.set(pipetter.z_motor, z);
    };
    const dip = (depth, label, fx) => {
      emit(pipetter.y_motor, depth, ['head', 'pz', res(pipConv)], ['head'], label, fx && fx.at === 'down' ? fx : undefined);
      if (fx && fx.at === 'plunge') emit(pipetter.push_motor, fx.plunge, ['head'], ['head'], fx.label, fx);
      emit(pipetter.y_motor, -depth, ['head'], ['head'], 'Pipetter: up');
    };
    const depthFor = (container) => {
      const type = db.container_type.find((t) => t.container_type_id === container.container_type_id)?.container_type_name || '';
      const spec = Object.values(COLLECTIONS).find((s) => s.type === type);
      const top = 14 + (spec ? (spec.shape === 'well' || spec.shape === 'dish' ? spec.housing || spec.height : spec.height) : 60);
      const travel = num(pipetter.absolute_y) + num(pipetter.length_y) - (pipConv.y0 + top) + 10;
      return Math.max(20, Math.min(num(pipetter.length_y), travel));
    };

    if (job.cargoMove) {
      const cargo = cargoOf(job.cargoMove.cargoId);
      const dest = kin.convById.get(job.cargoMove.conveyorId);
      // other cargo stranded on the elevator goes back to a shelf first
      if (elevator && dest !== elevator) for (const other of cargosOn(elevator)) if (other !== cargo) park(other, [dest]);
      bring(cargo, dest);
      moveBelt(dest, job.cargoMove.relX - cargo.rel, `${name(cargo)}: to ${Math.round(job.cargoMove.relX)} mm on conveyor ${dest.id}`);
      for (const other of kin.cargos) {
        if (sticksOut(other.rel, other.conv.lenX)) throw new Error(`${name(other)} would hang over the edge of conveyor ${other.conv.id}`);
      }
      return list;
    }

    const opened = new Set();
    const usedTips = new Set();
    const container = (id) => db.container.find((c) => c.container_id === id);
    const tipCargoIds = [...new Set(db.tip_container.map((t) => t.on_cargo_id))].filter((id) => cargoOf(id));
    for (const step of protocol.steps) {
      const from = container(mapping[step.from_id]);
      const to = container(mapping[step.to_id]);
      if (from) needed.add(from.on_cargo_id);
      if (to) needed.add(to.on_cargo_id);
    }
    if (tipCargoIds.length) needed.add(tipCargoIds[0]);
    // cargo stranded on the elevator (aborted run) goes back to a shelf first
    if (elevator) for (const cargo of cargosOn(elevator)) park(cargo);

    for (const step of protocol.steps) {
      const from = container(mapping[step.from_id]);
      const to = container(mapping[step.to_id]);
      const volume = num(step.volume);
      if (!from || !to) throw new Error(`Step ${step.step_order + 1} uses an unknown container`);
      if (from === to) throw new Error(`Step ${step.step_order + 1} transfers a container into itself`);

      for (const c of [from, to]) {
        if (c.is_closed && !opened.has(c.container_id)) {
          opened.add(c.container_id);
          manual(`Open the lid of container ${c.container_id}`, 'open', [c.container_id], [c.on_cargo_id], { type: 'open', container: c.container_id });
        }
      }

      let tip = null, tipCargo = null;
      for (const id of tipCargoIds) {
        tip = db.tip_container.find((t) => t.on_cargo_id === id && t.has_tip && t.is_sterile && !usedTips.has(t.tip_container_id));
        if (tip) { tipCargo = cargoOf(id); break; }
      }
      const cycles = Math.ceil(volume / PIPETTE_MAX_UL);
      if (!pipetter || !pipConv || cycles > MAX_CYCLES || (!tip && !tipCargoIds.length)) {
        manual(`Transfer ${volume} µL from container ${from.container_id} into container ${to.container_id}`, 'transfer',
          [from.container_id, to.container_id], [from.on_cargo_id, to.on_cargo_id], { type: 'transfer', from: from.container_id, to: to.container_id, volume });
        continue;
      }
      if (!tip) {
        const id = tipCargoIds[0];
        manual(`Refill the tip box on cargo ${id}`, 'refill', [], [id], { type: 'refill', cargo: id });
        usedTips.clear();
        tip = db.tip_container.find((t) => t.on_cargo_id === id);
        tipCargo = cargoOf(id);
      }
      usedTips.add(tip.tip_container_id);

      const cargoFrom = cargoOf(from.on_cargo_id), cargoTo = cargoOf(to.on_cargo_id);
      if (!cargoFrom || !cargoTo) throw new Error(`Step ${step.step_order + 1} needs a cargo that is out of the system`);
      for (const cargo of [...new Set([cargoFrom, cargoTo, tipCargo])]) bring(cargo, pipConv);

      alignX(tipCargo, num(tip.relative_center_x), 'Belt: tip under the pipetter');
      zTo(num(tip.relative_center_z));
      dip(Math.min(num(pipetter.length_y), 158), 'Pipetter: pick up a tip', { at: 'down', type: 'pick', tip: tip.tip_container_id });
      let left = volume;
      while (left > 1e-9) {
        const chunk = Math.min(PIPETTE_MAX_UL, left);
        left -= chunk;
        alignX(cargoFrom, num(from.relative_center_x), `Belt: container ${from.container_id} under the pipetter`);
        zTo(num(from.relative_center_z));
        dip(depthFor(from), `Pipetter: into container ${from.container_id}`, { at: 'plunge', plunge: chunk / 25, label: `Aspirate ${chunk} µL from container ${from.container_id}` });
        alignX(cargoTo, num(to.relative_center_x), `Belt: container ${to.container_id} under the pipetter`);
        zTo(num(to.relative_center_z));
        dip(depthFor(to), `Pipetter: into container ${to.container_id}`, {
          at: 'plunge', plunge: -chunk / 25, label: `Dispense ${chunk} µL into container ${to.container_id}`,
          type: 'transfer', from: from.container_id, to: to.container_id, volume: chunk,
        });
      }
      alignX(tipCargo, num(tip.relative_center_x), 'Belt: tip slot under the pipetter');
      zTo(num(tip.relative_center_z));
      dip(Math.min(num(pipetter.length_y), 140), 'Pipetter: eject the tip', { at: 'down', type: 'eject', tip: tip.tip_container_id });
    }

    // put everything back on the shelves
    if (pipConv) {
      for (;;) {
        const cargo = cargosOn(pipConv)[0];
        if (!cargo) break;
        park(cargo);
      }
    }
    return list;
  }

  insertPlan(protocol, plan) {
    const db = this.db;
    const run_id = ++db.seq.run;
    const ids = [];
    for (const item of plan.list) {
      const instruction_id = ++db.seq.instruction;
      ids.push(instruction_id);
      db.instruction.push({
        instruction_id, is_automatic: !!item.automatic, instruction_status: STATUS.OPEN,
        estimated_execution_time_ms: 1, earliest_start: new Date(0).toISOString(), latest_start: new Date(0).toISOString(),
        depends_on: [...item.deps].map((index) => ids[index]), started_at: null, completed_at: null,
        label: item.label || null, protocol_run_id: run_id, fx: item.fx || null, pair_with: null,
        automatic: item.automatic ? { instruction_automatic_command_id: ++db.seq.automatic, ...item.automatic, speed_feed_rate: 2000 } : null,
        manual: item.manual ? {
          instruction_manual_command_id: ++db.seq.manual, ...item.manual, user_accepted: false,
          last_user_inform: new Date(0).toISOString(),
        } : null,
      });
    }
    plan.list.forEach((item, index) => {
      if (item.pair != null) db.instruction.find((ins) => ins.instruction_id === ids[index]).pair_with = ids[item.pair];
    });
    const cargo_ids = [...new Set(Object.values(plan.mapping || {}).map((id) => this.row('container', 'container_id', id)?.on_cargo_id))];
    db.run = {
      run_id, protocol_id: protocol.protocol_id, protocol_name: protocol.protocol_name,
      started_at: new Date().toISOString(), instruction_count: ids.length, cargo_ids,
    };
    this.changed();
    return run_id;
  }

  // ------------------------------------------------------------------ HTTP-like API

  /** Resolves to { status, json }. Never throws. */
  async handle(method, path, query = {}, body = null) {
    try {
      return { status: 200, json: this.route(method.toUpperCase(), path.replace(/\/+$/, '') || '/', query, body || {}) };
    } catch (err) {
      if (err instanceof ApiError) return { status: err.status, json: { error: err.message } };
      console.error(err);
      return { status: 500, json: { error: String(err.message || err) } };
    }
  }

  route(method, path, query, body) {
    const id = (value) => {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n)) throw new ApiError(400, 'Missing or invalid id');
      return n;
    };
    let m;
    if (method === 'GET' && (path === '/' || path === '/status')) return { status: 'active', api: 2, simulated: true };
    if (method === 'GET' && path === '/warehouse/state') return this.snapshot();
    if (method === 'POST' && (path === '/runtime/pause' || path === '/runtime/resume')) {
      this.paused = path === '/runtime/pause';
      this.changed();
      return { paused: this.paused };
    }
    if (method === 'POST' && (m = path.match(/^\/conveyor\/(\d+)\/move$/))) return this.moveConveyor(id(m[1]), body);
    if (method === 'GET' && path === '/protocols') return this.db.protocol.map((p) => this.protocolSummary(p));
    if (method === 'GET' && path === '/protocol/can_run') {
      const { can_run, reasons, mapping } = this.planIfIdle(id(query.id));
      return { protocol_id: id(query.id), can_run, reasons, mapping };
    }
    if (method === 'GET' && path === '/protocol/plan') {
      const plan = this.planIfIdle(id(query.id));
      return {
        protocol_id: id(query.id), can_run: plan.can_run, reasons: plan.reasons, mapping: plan.mapping,
        instructions: plan.list.map((item, index) => ({
          index, is_automatic: !!item.automatic, depends_on: [...item.deps], label: item.label || null, pair_with: item.pair ?? null,
          automatic: item.automatic ? { ...item.automatic, speed_feed_rate: 2000 } : null, manual: item.manual || null,
        })),
      };
    }
    if (method === 'GET' && path === '/protocol/run') {
      const protocol = this.row('protocol', 'protocol_id', id(query.id));
      if (!protocol) throw new ApiError(404, `Unknown protocol ${query.id}`);
      if (this.busy()) throw new ApiError(409, 'Another protocol is already running, parallel execution is not possible yet');
      const plan = this.plan(protocol.protocol_id);
      if (!plan.can_run) throw new ApiError(422, plan.reasons.join('; '));
      return { protocol_id: protocol.protocol_id, ok: true, run_id: this.insertPlan(protocol, plan), instruction_count: plan.list.length };
    }
    if (method === 'POST' && path === '/protocol/abort') {
      const open = this.db.instruction.filter((ins) => ins.instruction_status === STATUS.OPEN || (!ins.is_automatic && ins.instruction_status === STATUS.RUNNING));
      const drop = new Set(open.map((ins) => ins.instruction_id));
      this.db.instruction = this.db.instruction.filter((ins) => !drop.has(ins.instruction_id));
      for (const ins of this.db.instruction) ins.depends_on = ins.depends_on.filter((dep) => !drop.has(dep));
      this.db.run = null;
      this.changed();
      return { aborted: drop.size };
    }
    if (method === 'POST' && path === '/protocol') return { protocol_id: this.saveProtocol(null, body) };
    if ((m = path.match(/^\/protocol\/(\d+)$/))) {
      const protocol = this.row('protocol', 'protocol_id', id(m[1]));
      if (!protocol) throw new ApiError(404, `Unknown protocol ${m[1]}`);
      if (method === 'GET') return JSON.parse(JSON.stringify(protocol));
      if (method === 'PUT') return { protocol_id: this.saveProtocol(protocol, body) };
      if (method === 'DELETE') {
        if (this.db.run?.protocol_id === protocol.protocol_id) throw new ApiError(409, 'Protocol is running');
        this.db.protocol = this.db.protocol.filter((p) => p !== protocol);
        this.changed();
        return { deleted: protocol.protocol_id };
      }
    }
    if (method === 'POST' && (m = path.match(/^\/instruction\/manual\/(accept|complete)\/(\d+)$/))) {
      const ins = this.db.instruction.find((i) => i.manual?.instruction_manual_command_id === id(m[2]));
      if (!ins) throw new ApiError(500, `No instruction with manual instruction id ${m[2]}`);
      if (m[1] === 'accept') {
        ins.manual.user_accepted = true;
        this.changed();
        return { instruction_manual_command_id: id(m[2]), status: 'accepted' };
      }
      ins.instruction_status = STATUS.COMPLETED;
      ins.completed_at = new Date().toISOString();
      this.applyEffect(ins.fx);
      this.changed();
      return { instruction_manual_command_id: id(m[2]), status: 'completed' };
    }
    if (method === 'POST' && path === '/cargo') return { cargo_id: this.createCargo(body) };
    if ((m = path.match(/^\/cargo\/(\d+)(?:\/(remove|insert|position|navigate))?$/))) {
      const cargo = this.row('cargo', 'cargo_id', id(m[1]));
      if (!cargo) throw new ApiError(404, `Unknown cargo ${m[1]}`);
      if (method === 'POST' && m[2] === 'remove') return this.removeCargo(cargo);
      if (method === 'POST' && m[2] === 'insert') return this.insertCargo(cargo, body);
      if (method === 'POST' && m[2] === 'position') return this.setCargoPosition(cargo, body);
      if (method === 'POST' && m[2] === 'navigate') return this.navigateCargo(cargo, body);
      if (method === 'DELETE' && !m[2]) return this.deleteCargo(cargo);
    }
    if (method === 'POST' && path === '/sim/reset') { this.reset(); return { ok: true }; }
    if (method === 'POST' && path === '/sim/speed') {
      this.setTimeScale(num(body.time_scale, 1));
      return { time_scale: this.timeScale };
    }
    throw new ApiError(404, `No route ${method} ${path}`);
  }

  setTimeScale(scale) {
    const next = Math.max(0.25, Math.min(20, scale));
    const now = Date.now();
    // keep the progress of running moves, only change how fast the rest goes
    for (const run of this.running.values()) {
      const p = Math.min(1, (now - run.t0) / run.dur);
      run.dur = (run.dur * this.timeScale) / next;
      run.t0 = now - p * run.dur;
    }
    this.timeScale = next;
  }

  busy() { return this.db.instruction.some((ins) => ins.instruction_status !== STATUS.COMPLETED); }

  planIfIdle(protocolId) {
    const plan = this.plan(protocolId);
    if (plan.can_run && this.busy()) return { ...plan, can_run: false, reasons: ['Another protocol is already running'] };
    return plan;
  }

  protocolSummary(p) {
    return {
      protocol_id: p.protocol_id, protocol_name: p.protocol_name, protocol_author: p.protocol_author,
      protocol_version: p.protocol_version, protocol_software_version: p.protocol_software_version,
      step_count: p.steps.length, container_count: p.containers.length,
    };
  }

  saveProtocol(existing, body) {
    const name = String(body.protocol_name || '').trim();
    if (!name) throw new ApiError(400, 'protocol_name is required');
    if (existing && this.db.run?.protocol_id === existing.protocol_id) throw new ApiError(409, 'Protocol is running');
    const containers = (body.containers || []).map((c) => ({
      virtual_container_id: parseInt(c.virtual_container_id, 10), material: cloneMaterial(c.material),
      internal_temperature: num(c.internal_temperature, 20), homogeneous: c.homogeneous !== false,
      last_update: new Date().toISOString(), preferred_container_id: c.preferred_container_id ?? null,
    }));
    const known = new Set(containers.map((c) => c.virtual_container_id));
    const steps = (body.steps || []).map((s, step_order) => {
      if (!known.has(s.from_id) || !known.has(s.to_id)) throw new ApiError(400, `Step ${step_order + 1} references an unknown virtual container`);
      if (!(num(s.volume) > 0)) throw new ApiError(400, `Step ${step_order + 1} needs a positive volume`);
      return { step_order, kind: 'transfer', from_id: s.from_id, to_id: s.to_id, volume: num(s.volume) };
    });
    const row = existing || { protocol_id: this.nextId('protocol', 'protocol_id') };
    Object.assign(row, {
      protocol_name: name, protocol_author: String(body.protocol_author || 'unknown'),
      protocol_version: String(body.protocol_version || '0.0.1'),
      protocol_software_version: String(body.protocol_software_version || '0.0.1'), containers, steps,
    });
    if (!existing) this.db.protocol.push(row);
    this.changed();
    return row.protocol_id;
  }

  // ------------------------------------------------------------------ manual control

  assertIdle() {
    if (this.busy()) throw new ApiError(409, 'Wait until the queued instructions have finished');
  }

  /** POST /conveyor/{id}/move { axis: 'x' | 'y', distance }: one move of a belt or a lift, inside its permitted range. */
  moveConveyor(conveyorId, body) {
    const conv = this.live.convById.get(conveyorId);
    if (!conv) throw new ApiError(404, `Unknown conveyor ${conveyorId}`);
    this.assertIdle();
    const distance = round4(num(body.distance, NaN));
    const signed = (v) => `${v > 0 ? '+' : ''}${round4(v)} mm`;
    let range, motor_id;
    if (body.axis === 'x') {
      if (conv.xm == null) throw new ApiError(400, `Conveyor ${conveyorId} has no belt motor`);
      range = beltRange(conv.lenX, this.live.cargos.filter((c) => c.conv === conv).map((c) => c.rel));
      if (!range) throw new ApiError(409, `The cargo on conveyor ${conveyorId} does not fit on its belt`);
      motor_id = conv.xm;
    } else if (body.axis === 'y') {
      if (conv.ym == null) throw new ApiError(400, `Conveyor ${conveyorId} has no lift`);
      const hanging = this.live.cargos.find((c) => sticksOut(c.rel, c.conv.lenX));
      if (hanging) throw new ApiError(409, `Cargo ${hanging.id} hangs over the edge of conveyor ${hanging.conv.id}, the lift cannot move`);
      range = liftRange(this.live.motor.get(conv.ym) || 0, conv.lenY);
      motor_id = conv.ym;
    } else throw new ApiError(400, 'axis has to be "x" or "y"');
    if (!Number.isFinite(distance) || distance === 0) throw new ApiError(400, 'The distance is 0');
    if (distance < range[0] - 1e-6 || distance > range[1] + 1e-6) {
      throw new ApiError(400, `Conveyor ${conveyorId} can move ${signed(range[0])} to ${signed(range[1])} now, not ${signed(distance)}`);
    }
    const label = `Manual: conveyor ${conveyorId} ${body.axis === 'x' ? 'belt' : 'lift'} ${signed(distance)}`;
    const list = [{ automatic: { motor_id, target_value: distance }, deps: new Set(), label }];
    const run_id = this.insertPlan({ protocol_id: null, protocol_name: `Manual move · conveyor ${conveyorId}` }, { list });
    return { conveyor_id: conveyorId, axis: body.axis, distance, run_id, instruction_count: 1 };
  }

  /** Checks the target of a cargo; returns the live conveyor and the position. */
  cargoTarget(cargo, body, checkCollisions) {
    if (cargo.is_available === false) throw new ApiError(404, `Cargo ${cargo.cargo_id} is not in the system`);
    this.assertIdle();
    const conv = this.live.convById.get(body.on_conveyor_id);
    if (!conv) throw new ApiError(400, `Unknown conveyor ${body.on_conveyor_id}`);
    const x = round4(num(body.relative_x, NaN));
    if (!Number.isFinite(x)) throw new ApiError(400, 'relative_x is missing');
    const others = this.live.cargos.filter((c) => c.conv === conv && c.id !== cargo.cargo_id).map((c) => c.rel);
    const problem = positionProblem(conv.lenX, checkCollisions ? others : [], x);
    if (problem === 'edge') throw new ApiError(400, `Position ${x} mm is over the edge of conveyor ${conv.id} (0 to ${round4(conv.lenX - CARGO_WIDTH)} mm)`);
    if (problem === 'collision') throw new ApiError(409, `Position ${x} mm on conveyor ${conv.id} collides with another cargo`);
    return { conv, x };
  }

  /** POST /cargo/{id}/position: the cargo is declared to stand somewhere else. Nothing moves. */
  setCargoPosition(cargo, body) {
    const { conv, x } = this.cargoTarget(cargo, body, true);
    cargo.on_conveyor_id = conv.id;
    cargo.relative_x = x;
    const live = this.live.cargos.find((c) => c.id === cargo.cargo_id);
    live.conv = conv;
    live.rel = x;
    this.changed();
    return { cargo_id: cargo.cargo_id, is_available: true, on_conveyor_id: conv.id, relative_x: x };
  }

  /** POST /cargo/{id}/navigate: plans the way to the position and queues it as one run. */
  navigateCargo(cargo, body) {
    const { conv, x } = this.cargoTarget(cargo, body, false);
    let list;
    try {
      list = this.planMoves({ cargoMove: { cargoId: cargo.cargo_id, conveyorId: conv.id, relX: x } }, {});
    } catch (err) {
      throw new ApiError(422, err.message);
    }
    const run_id = list.length
      ? this.insertPlan({ protocol_id: null, protocol_name: `Move ${cargo.label || `cargo ${cargo.cargo_id}`} to conveyor ${conv.id}` }, { list })
      : null;
    return { cargo_id: cargo.cargo_id, on_conveyor_id: conv.id, relative_x: x, run_id, instruction_count: list.length };
  }

  assertBeltsAtRest() {
    if (this.running.size) throw new ApiError(409, 'Wait until the running moves have finished');
  }

  removeCargo(cargo) {
    if (cargo.is_available === false) throw new ApiError(409, 'Cargo is already out of the system');
    this.assertBeltsAtRest();
    if (this.db.run?.cargo_ids?.includes(cargo.cargo_id)) throw new ApiError(409, 'Cargo is used by the running protocol');
    cargo.is_available = false;
    this.live.cargos = this.live.cargos.filter((c) => c.id !== cargo.cargo_id);
    this.changed();
    return { cargo_id: cargo.cargo_id, is_available: false };
  }

  freeSlot(conveyorId, wanted, ignoreId) {
    const conv = this.live.convById.get(conveyorId);
    if (!conv) throw new ApiError(400, `Unknown conveyor ${conveyorId}`);
    const others = this.live.cargos.filter((c) => c.conv === conv && c.id !== ignoreId).map((c) => c.rel);
    const free = (x) => x >= 0 && x <= conv.lenX - CARGO_WIDTH && others.every((o) => Math.abs(o - x) >= CARGO_PITCH - 0.01);
    if (wanted != null && free(wanted)) return wanted;
    for (let x = 0; x <= conv.lenX - CARGO_WIDTH; x += 5) if (free(x)) return x;
    throw new ApiError(409, `Conveyor ${conveyorId} has no free slot`);
  }

  insertCargo(cargo, body) {
    if (cargo.is_available !== false) throw new ApiError(409, 'Cargo is already in the system');
    this.assertBeltsAtRest();
    const conveyorId = body.on_conveyor_id ?? cargo.on_conveyor_id;
    const wanted = body.relative_x != null ? num(body.relative_x) : (conveyorId === cargo.on_conveyor_id ? cargo.relative_x : null);
    cargo.relative_x = this.freeSlot(conveyorId, wanted, cargo.cargo_id);
    cargo.on_conveyor_id = conveyorId;
    cargo.is_available = true;
    this.live.cargos.push({ id: cargo.cargo_id, conv: this.live.convById.get(conveyorId), rel: cargo.relative_x });
    this.changed();
    return { cargo_id: cargo.cargo_id, is_available: true, on_conveyor_id: conveyorId, relative_x: cargo.relative_x };
  }

  deleteCargo(cargo) {
    if (cargo.is_available !== false) throw new ApiError(409, 'Take the cargo out of the system first');
    const materialIds = new Set(this.db.container.filter((c) => c.on_cargo_id === cargo.cargo_id).map((c) => c.material_id));
    this.db.container = this.db.container.filter((c) => c.on_cargo_id !== cargo.cargo_id);
    this.db.tip_container = this.db.tip_container.filter((t) => t.on_cargo_id !== cargo.cargo_id);
    this.db.material = this.db.material.filter((mat) => !materialIds.has(mat.material_id));
    this.db.cargo = this.db.cargo.filter((c) => c !== cargo);
    this.changed();
    return { deleted: cargo.cargo_id };
  }

  createCargo(body) {
    this.assertBeltsAtRest();
    const conveyorId = parseInt(body.on_conveyor_id, 10);
    const relative_x = this.freeSlot(conveyorId, body.relative_x != null ? num(body.relative_x) : null, -1);
    const cargo_id = this.nextId('cargo', 'cargo_id');
    this.db.cargo.push({
      cargo_id, relative_x, anchored_conveyor: body.anchored ? conveyorId : null,
      anchored_relative_x: body.anchored ? relative_x : null, on_conveyor_id: conveyorId,
      x_distance_after_last_calibration: 0, is_available: true, label: body.label ? String(body.label) : null,
      collection: body.collection || null,
    });
    for (const c of body.containers || []) {
      const typeName = String(c.container_type_name || 'Container');
      let type = this.db.container_type.find((t) => t.container_type_name === typeName);
      if (!type) {
        type = { container_type_id: this.nextId('container_type', 'container_type_id'), container_type_name: typeName };
        this.db.container_type.push(type);
      }
      const material_id = this.nextId('material', 'material_id');
      this.db.material.push({ material_id, ...cloneMaterial(c.material) });
      this.db.container.push({
        container_id: this.nextId('container', 'container_id'), container_type_id: type.container_type_id, on_cargo_id: cargo_id,
        relative_center_x: num(c.relative_center_x), relative_center_z: num(c.relative_center_z),
        maximum_volume: num(c.maximum_volume), is_closed: !!c.is_closed, material_id,
      });
    }
    for (const t of body.tips || []) {
      this.db.tip_container.push({
        tip_container_id: this.nextId('tip_container', 'tip_container_id'), on_cargo_id: cargo_id,
        relative_center_x: num(t.relative_center_x), relative_center_z: num(t.relative_center_z),
        has_tip: t.has_tip !== false, is_sterile: t.is_sterile !== false,
      });
    }
    this.live.cargos.push({ id: cargo_id, conv: this.live.convById.get(conveyorId), rel: relative_x });
    this.changed();
    return cargo_id;
  }

  snapshot() {
    const db = this.db;
    const copy = (rows) => rows.map((r) => ({ ...r }));
    const done = db.instruction.filter((ins) => ins.instruction_status === STATUS.COMPLETED).slice(-KEEP_COMPLETED);
    const active = db.instruction.filter((ins) => ins.instruction_status !== STATUS.COMPLETED);
    return {
      revision: this.revision, server_time: new Date().toISOString(), simulated: true, time_scale: this.timeScale, paused: this.paused,
      motors: copy(db.motor), conveyors: copy(db.conveyor), deadzones: copy(db.deadzone), calibrators: copy(db.calibrator),
      pipetters: copy(db.pipetter), cargos: copy(db.cargo), container_types: copy(db.container_type),
      containers: copy(db.container), tip_containers: copy(db.tip_container),
      materials: db.material.map((mat) => ({ material_id: mat.material_id, ...cloneMaterial(mat) })),
      substances: db.substance.map((s) => ({ ...s, hazard: { ...s.hazard } })), proteins: copy(db.protein), organisms: copy(db.organism),
      instructions: [...done, ...active].map((ins) => {
        const { fx, ...rest } = ins;
        return { ...rest, depends_on: [...ins.depends_on], automatic: ins.automatic && { ...ins.automatic }, manual: ins.manual && { ...ins.manual } };
      }),
      run: db.run ? { ...db.run } : null,
    };
  }
}

const round4 = (v) => Math.round(v * 1e4) / 1e4;
