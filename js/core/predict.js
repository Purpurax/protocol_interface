// Prediction: when will each queued instruction run, how long does a protocol take, and where will
// every cargo be at a given moment in the future.

import { config } from './config.js';
import { STATUS, convY, makeKin, moveMotor, pickStartable, settle } from '../shared/kinematics.js';

export const MANUAL_GUESS_MS = 20000;
const STEP_MM = 6;

/** Turns the answer of GET /protocol/plan into the instruction shape the scheduler uses. */
export function planInstructions(plan) {
  return (plan.instructions || []).map((item) => ({
    id: item.index, auto: !!item.is_automatic, status: STATUS.OPEN, deps: item.depends_on || [],
    motorId: item.automatic?.motor_id ?? null, d: Number(item.automatic?.target_value) || 0,
    pairWith: item.pair_with ?? null, label: item.label || null, manual: item.manual || null,
  }));
}

/**
 * Replays the warehouse runtime loop on a clock.
 * Returns { items: Map(id -> {start, end, manual}), total, autoMs, manualCount, firstManualAt } in ms
 * relative to "now"; moves that are already running get a negative start.
 */
export function buildSchedule(store, instructions, { tracked = null, manualMs = MANUAL_GUESS_MS } = {}) {
  const now = performance.now();
  const status = new Map(instructions.map((ins) => [ins.id, ins.status]));
  const statusOf = (id) => (status.has(id) ? status.get(id) : STATUS.COMPLETED);
  const flat = instructions.map((ins) => ({ id: ins.id, is_automatic: ins.auto, depends_on: ins.deps, motor_id: ins.motorId, pair_with: ins.pairWith, ref: ins }));
  const motorById = new Map([...store.motors.values()].map((m) => [m.id, m]));
  const items = new Map();
  const running = [];
  const batches = new Map();
  const occupy = (grbl, n) => {
    const left = (batches.get(grbl) || 0) + n;
    if (left <= 0) batches.delete(grbl); else batches.set(grbl, left);
  };

  for (const ins of instructions) {
    if (ins.status !== STATUS.RUNNING) continue;
    if (ins.auto) {
      const track = tracked?.get(ins.id);
      const predicted = track ? track.predicted : store.predictMs(ins);
      const start = track ? track.t0 - now : 0;
      const end = Math.max(60, start + predicted);
      items.set(ins.id, { start, end, manual: false });
      running.push({ id: ins.id, end, grbl: motorById.get(ins.motorId)?.grbl_index });
      occupy(motorById.get(ins.motorId)?.grbl_index, 1);
    } else {
      items.set(ins.id, { start: 0, end: manualMs, manual: true });
      running.push({ id: ins.id, end: manualMs, grbl: null });
    }
  }

  let t = 0;
  for (let guard = 0; guard < 20000; guard++) {
    const { auto, manual } = pickStartable(flat, statusOf, new Set(batches.keys()), motorById);
    for (const { ref: ins } of auto) {
      const end = t + store.predictMs(ins);
      status.set(ins.id, STATUS.RUNNING);
      items.set(ins.id, { start: t, end, manual: false });
      const grbl = motorById.get(ins.motorId)?.grbl_index;
      running.push({ id: ins.id, end, grbl });
      occupy(grbl, 1);
    }
    for (const { ref: ins } of manual) {
      status.set(ins.id, STATUS.RUNNING);
      items.set(ins.id, { start: t, end: t + manualMs, manual: true });
      running.push({ id: ins.id, end: t + manualMs, grbl: null });
    }
    if (!running.length) break;
    t = Math.min(...running.map((r) => r.end));
    for (let i = running.length - 1; i >= 0; i--) {
      if (running[i].end > t + 1e-6) continue;
      status.set(running[i].id, STATUS.COMPLETED);
      if (running[i].grbl != null) occupy(running[i].grbl, -1);
      running.splice(i, 1);
    }
  }

  let manualCount = 0, firstManualAt = null, manualTotal = 0;
  for (const item of items.values()) {
    if (!item.manual) continue;
    manualCount += 1;
    manualTotal += item.end - item.start;
    if (firstManualAt == null || item.start < firstManualAt) firstManualAt = item.start;
  }
  const stuck = instructions.filter((ins) => ins.status !== STATUS.COMPLETED && !items.has(ins.id)).length;
  return { items, total: t, autoMs: Math.max(0, t - manualTotal), manualCount, firstManualAt, stuck };
}

/**
 * Integrates the scheduled moves over time.
 * Returns { duration, tracks: Map(cargoId -> {t, x, y}), lifts: Map(conveyorId -> {t, y}), at(t) }.
 */
export function simulateTimeline(store, instructions, schedule) {
  const raw = store.raw;
  const kin = makeKin({ motors: raw.motors, conveyors: raw.conveyors, cargos: raw.cargos });
  const moves = [];
  for (const ins of instructions) {
    const item = schedule.items.get(ins.id);
    if (!ins.auto || !item || Math.abs(ins.d) < 1e-9) continue;
    moves.push({ motorId: ins.motorId, start: item.start, end: Math.max(item.end, item.start + 1), d: ins.d });
  }
  const tracks = new Map(kin.cargos.map((c) => [c.id, { t: [], x: [], y: [], moved: false }]));
  const lifts = new Map(kin.convs.filter((c) => c.ym != null).map((c) => [c.id, { t: [], y: [] }]));
  const record = (t) => {
    for (const cargo of kin.cargos) {
      const track = tracks.get(cargo.id);
      const x = cargo.conv.x + cargo.rel, y = convY(kin, cargo.conv);
      const n = track.t.length;
      if (n && (Math.abs(track.x[n - 1] - x) > 0.01 || Math.abs(track.y[n - 1] - y) > 0.01)) track.moved = true;
      track.t.push(t); track.x.push(x); track.y.push(y);
    }
    for (const [id, lift] of lifts) { lift.t.push(t); lift.y.push(convY(kin, kin.convById.get(id))); }
  };

  const times = [...new Set([0, ...moves.flatMap((m) => [m.start, m.end])])].sort((a, b) => a - b);
  record(times[0]);
  for (let i = 0; i < times.length - 1; i++) {
    const a = times[i], b = times[i + 1];
    const velocity = new Map();
    for (const move of moves) {
      if (move.start <= a + 1e-6 && move.end >= b - 1e-6) {
        velocity.set(move.motorId, (velocity.get(move.motorId) || 0) + move.d / (move.end - move.start));
      }
    }
    if (!velocity.size) { record(b); continue; }
    const fastest = Math.max(...[...velocity.values()].map(Math.abs));
    const steps = Math.max(1, Math.ceil((fastest * (b - a)) / STEP_MM));
    const dt = (b - a) / steps;
    for (let s = 1; s <= steps; s++) {
      for (const [motorId, v] of velocity) moveMotor(kin, motorId, v * dt);
      settle(kin);
      record(a + s * dt);
    }
  }

  const sample = (track, key, t) => {
    const ts = track.t;
    if (!ts.length) return 0;
    if (t <= ts[0]) return track[key][0];
    if (t >= ts[ts.length - 1]) return track[key][ts.length - 1];
    let lo = 0, hi = ts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid; else hi = mid;
    }
    const f = (t - ts[lo]) / Math.max(1e-9, ts[hi] - ts[lo]);
    return track[key][lo] + (track[key][hi] - track[key][lo]) * f;
  };

  return {
    duration: Math.max(schedule.total, times[times.length - 1] || 0),
    tracks, lifts,
    cargoAt: (id, t) => {
      const track = tracks.get(id);
      return track ? { x: sample(track, 'x', t), y: sample(track, 'y', t) } : null;
    },
    liftAt: (id, t) => (lifts.has(id) ? sample(lifts.get(id), 'y', t) : null),
  };
}

/** Summary of what is queued right now, for the side indicator. */
export function queueForecast(store) {
  const active = store.activeInstructions();
  if (!active.length) return { idle: true, total: 0, remaining: 0, manualCount: 0, firstManualAt: null, schedule: null };
  const schedule = buildSchedule(store, store.instructions, { tracked: store.tracked });
  return {
    idle: false, remaining: active.length, total: schedule.total, autoMs: schedule.autoMs,
    manualCount: schedule.manualCount, firstManualAt: schedule.firstManualAt, schedule,
  };
}

/** Estimate for a protocol plan that has not been started. */
export function estimatePlan(store, plan) {
  const instructions = planInstructions(plan);
  const schedule = buildSchedule(store, instructions);
  const samples = Math.min(config.speed.x.samples, config.speed.y.samples);
  return {
    instructions, schedule, total: schedule.total, autoMs: schedule.autoMs, manualCount: schedule.manualCount,
    confidence: samples >= 5 ? 'calibrated' : samples > 0 ? 'learning' : 'default',
  };
}
