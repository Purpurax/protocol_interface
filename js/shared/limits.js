// What may be moved by hand, and how far. The warehouse enforces these rules (logic/manual.rs);
// the interface uses the same ones to draw the permitted range before it asks.

import { CARGO_PITCH, CARGO_WIDTH } from './kinematics.js';

const EPS = 1e-6;

/** A cargo at `rel` on a belt of length `lenX` hangs over an edge. */
export const sticksOut = (rel, lenX) => rel < -EPS || rel + CARGO_WIDTH > lenX + EPS;

/**
 * Distances [min, max] a belt may move: every cargo on it (`rels`: their relative x) stays
 * completely on the belt. An empty belt may turn one belt length. null: the cargo does not fit.
 */
export function beltRange(lenX, rels) {
  if (!rels.length) return [-lenX, lenX];
  const range = [-Math.min(...rels), lenX - CARGO_WIDTH - Math.max(...rels)];
  return range[0] > range[1] + EPS ? null : range;
}

/** Distances [min, max] a lift may move: its travel is 0 … lenY. */
export const liftRange = (value, lenY) => [-value, lenY - value];

/**
 * Why a cargo cannot stand at `x` on a belt: 'edge' (over the edge), 'collision' (closer than one
 * cargo pitch to one of `others`), or null if it can.
 */
export function positionProblem(lenX, others, x) {
  if (x < -EPS || x > lenX - CARGO_WIDTH + EPS) return 'edge';
  if (others.some((other) => Math.abs(other - x) < CARGO_PITCH - EPS)) return 'collision';
  return null;
}

/** The free position on a belt closest to `x`, or null when the belt is full. */
export function nearestFreePosition(lenX, others, x) {
  const last = lenX - CARGO_WIDTH;
  if (last < 0) return null;
  const candidates = [Math.min(last, Math.max(0, x)), 0, last];
  for (const other of others) candidates.push(other - CARGO_PITCH, other + CARGO_PITCH);
  let best = null;
  for (const candidate of candidates) {
    if (positionProblem(lenX, others, candidate)) continue;
    if (best == null || Math.abs(candidate - x) < Math.abs(best - x)) best = candidate;
  }
  return best;
}
