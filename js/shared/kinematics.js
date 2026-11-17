// Minimal kinematic model of the warehouse, shared by the predictor (client) and the simulator.
//
//  - a conveyor is a belt: when its x motor moves by d, every cargo standing on it moves by d
//  - a conveyor with a y motor (elevator) travels vertically, its cargo travels with it
//  - a cargo belongs to the conveyor under its centre; it changes conveyor when its centre crosses
//    onto another belt that is at the same height

import { num } from './material.js';

export const CARGO_WIDTH = 135;
export const CARGO_GAP = 5;
export const CARGO_PITCH = CARGO_WIDTH + CARGO_GAP;
export const MAX_OVERHANG = CARGO_WIDTH / 3;
export const TRANSFER_Y_TOLERANCE = 8;

export const STATUS = { OPEN: 0, COMPLETED: 1, RUNNING: 2 };

/** Builds a kinematic state from snapshot-like tables. */
export function makeKin({ motors, conveyors, cargos }) {
  const kin = { motor: new Map(), convs: [], convById: new Map(), cargos: [] };
  for (const m of motors) kin.motor.set(m.motor_id, num(m.grbl_value));
  for (const c of conveyors) {
    const conv = {
      id: c.conveyor_id, x: num(c.absolute_x), y0: num(c.absolute_y), lenX: num(c.length_x),
      lenY: num(c.length_y), xm: c.x_motor ?? null, ym: c.y_motor ?? null, storage: !!c.is_storage,
    };
    kin.convs.push(conv);
    kin.convById.set(conv.id, conv);
  }
  for (const c of cargos) {
    if (c.is_available === false) continue;
    const conv = kin.convById.get(c.on_conveyor_id);
    if (conv) kin.cargos.push({ id: c.cargo_id, conv, rel: num(c.relative_x) });
  }
  return kin;
}

export function cloneKin(kin) {
  return {
    motor: new Map(kin.motor), convs: kin.convs, convById: kin.convById,
    cargos: kin.cargos.map((c) => ({ id: c.id, conv: c.conv, rel: c.rel })),
  };
}

export const convY = (kin, conv) => conv.y0 + (conv.ym != null ? kin.motor.get(conv.ym) || 0 : 0);

export const cargoPos = (kin, cargo) => ({ x: cargo.conv.x + cargo.rel, y: convY(kin, cargo.conv) });

/** Applies a relative motor move; belts carry their cargo. */
export function moveMotor(kin, motorId, delta) {
  kin.motor.set(motorId, (kin.motor.get(motorId) || 0) + delta);
  for (const conv of kin.convs) {
    if (conv.xm !== motorId) continue;
    for (const cargo of kin.cargos) if (cargo.conv === conv) cargo.rel += delta;
  }
}

/** Re-assigns cargos whose centre left their belt and now sits over another one. */
export function settle(kin) {
  for (const cargo of kin.cargos) {
    const conv = cargo.conv;
    const centre = conv.x + cargo.rel + CARGO_WIDTH / 2;
    if (centre >= conv.x && centre <= conv.x + conv.lenX) continue;
    const y = convY(kin, conv);
    const next = kin.convs.find((o) => o !== conv && centre >= o.x && centre <= o.x + o.lenX
      && Math.abs(convY(kin, o) - y) <= TRANSFER_Y_TOLERANCE);
    if (next) {
      cargo.rel = conv.x + cargo.rel - next.x;
      cargo.conv = next;
    }
  }
}

/** 'x' belt motor, 'y' lift motor, 'tool' anything else (pipetter axes). */
export function motorKinds({ conveyors, pipetters = [] }) {
  const kinds = new Map();
  for (const p of pipetters) for (const id of [p.y_motor, p.z_motor, p.push_motor]) if (id != null) kinds.set(id, 'tool');
  for (const c of conveyors) {
    if (c.x_motor != null) kinds.set(c.x_motor, 'x');
    if (c.y_motor != null) kinds.set(c.y_motor, 'y');
  }
  return kinds;
}

/**
 * Same selection rule as the warehouse runtime loop: OPEN instructions whose dependencies are all
 * COMPLETED; one batch per grbl board with at most one instruction per axis; busy boards wait.
 * Both halves of a belt-to-belt transfer (`pair_with`) only ever start together.
 * `instructions`: [{ id, is_automatic, depends_on, motor_id, pair_with? }]
 */
export function pickStartable(instructions, statusOf, busyGrbl, motorById) {
  const auto = [], manual = [];
  const batchAxes = new Map();
  for (const ins of instructions) {
    if (statusOf(ins.id) !== STATUS.OPEN) continue;
    if (ins.depends_on.some((dep) => statusOf(dep) !== STATUS.COMPLETED)) continue;
    if (!ins.is_automatic) { manual.push(ins); continue; }
    const motor = motorById.get(ins.motor_id);
    if (!motor) continue;
    if (busyGrbl.has(motor.grbl_index)) continue;
    const axes = batchAxes.get(motor.grbl_index) || new Set();
    if (axes.has(motor.axis)) continue;
    axes.add(motor.axis);
    batchAxes.set(motor.grbl_index, axes);
    auto.push(ins);
  }
  const ids = new Set(auto.map((ins) => ins.id));
  return { auto: auto.filter((ins) => ins.pair_with == null || ids.has(ins.pair_with)), manual };
}
