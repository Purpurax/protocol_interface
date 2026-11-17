// Container collections: a grid of single containers (one tube / well / tip each) plus the box
// that holds them. Used to draw cargo, to build prefabs and to create new cargo.

import { CARGO_WIDTH } from './kinematics.js';

export const CARGO_DEPTH = 90;

/** shape: tube | well | tip | dish. Sizes in mm, volumes in µL. */
export const COLLECTIONS = {
  falcon50: { name: 'Falcon 50 mL rack', short: '50 mL', type: 'Falcon 50mL', shape: 'tube', cols: 3, rows: 2, pitchX: 40, pitchZ: 40, diameter: 29, height: 115, maxVolume: 50000, housing: 46 },
  falcon15: { name: 'Falcon 15 mL rack', short: '15 mL', type: 'Falcon 15mL', shape: 'tube', cols: 5, rows: 3, pitchX: 24, pitchZ: 26, diameter: 17, height: 120, maxVolume: 15000, housing: 52 },
  wells96: { name: '96-well plate', short: '96 well', type: 'Well 96', shape: 'well', cols: 12, rows: 8, pitchX: 9, pitchZ: 9, diameter: 6.9, height: 11, maxVolume: 360, housing: 14.5 },
  wells24: { name: '24-well plate', short: '24 well', type: 'Well 24', shape: 'well', cols: 6, rows: 4, pitchX: 19.3, pitchZ: 19.3, diameter: 15.6, height: 17, maxVolume: 3400, housing: 20 },
  tips: { name: 'Tip box 96', short: 'Tips', type: 'Tip 1000', shape: 'tip', cols: 12, rows: 8, pitchX: 9, pitchZ: 9, diameter: 7.4, height: 62, maxVolume: 1000, housing: 50, isTips: true },
  petri: { name: 'Petri dish', short: 'Petri', type: 'Petri 90', shape: 'dish', cols: 1, rows: 1, pitchX: 0, pitchZ: 0, diameter: 86, height: 15, maxVolume: 25000, housing: 0 },
};

const ROW_NAMES = 'ABCDEFGHIJKLMNOP';

/** Slot centres relative to the cargo's left / wall-side corner, centred on the cargo footprint. */
export function collectionSlots(spec, width = CARGO_WIDTH, depth = CARGO_DEPTH) {
  const slots = [];
  const x0 = (width - (spec.cols - 1) * spec.pitchX) / 2;
  const z0 = (depth - (spec.rows - 1) * spec.pitchZ) / 2;
  for (let row = 0; row < spec.rows; row++) {
    for (let col = 0; col < spec.cols; col++) {
      slots.push({ row, col, name: `${ROW_NAMES[row]}${col + 1}`, x: round(x0 + col * spec.pitchX), z: round(z0 + row * spec.pitchZ) });
    }
  }
  return slots;
}

const round = (v) => Math.round(v * 100) / 100;

/** Guesses how a container should look from its type name and capacity. */
export function shapeForType(typeName = '', maxVolume = 0) {
  const name = typeName.toLowerCase();
  for (const spec of Object.values(COLLECTIONS)) if (spec.type.toLowerCase() === name) return { ...spec };
  if (/tip/.test(name)) return { ...COLLECTIONS.tips };
  if (/well|plate/.test(name)) return { ...(maxVolume > 1000 ? COLLECTIONS.wells24 : COLLECTIONS.wells96) };
  if (/petri|dish/.test(name)) return { ...COLLECTIONS.petri };
  if (/falcon|tube|vial/.test(name)) return { ...(maxVolume > 20000 || maxVolume === 0 ? COLLECTIONS.falcon50 : COLLECTIONS.falcon15) };
  // Unknown type: a cylinder sized from its capacity (height = 3 x diameter).
  const volumeMm3 = Math.max(maxVolume, 50);
  const diameter = Math.max(5, Math.min(60, Math.cbrt((4 * volumeMm3) / (3 * Math.PI))));
  return { name: typeName || 'Container', type: typeName, shape: 'tube', diameter, height: Math.min(120, diameter * 3), maxVolume, housing: 0, cols: 1, rows: 1, pitchX: 0, pitchZ: 0 };
}
