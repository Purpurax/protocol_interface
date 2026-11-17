// Basic container shapes. One container is always a single tube / well / tip / dish; a cargo shows
// a collection of them inside a housing (rack, plate, tip box).

import * as THREE from 'three';
import { config } from '../core/config.js';
import { shapeForType } from '../shared/collections.js';

const geometries = new Map();
const shared = new Set();
function geometry(key, make) {
  if (!geometries.has(key)) {
    const made = make();
    geometries.set(key, made);
    shared.add(made);
  }
  return geometries.get(key);
}
export const markShared = (geo) => { shared.add(geo); return geo; };
const r2 = (v) => Math.round(v * 100) / 100;

const unitCylinder = () => geometry('unit-cylinder', () => new THREE.CylinderGeometry(1, 1, 1, 20));
const unitDisc = () => geometry('unit-disc', () => new THREE.CylinderGeometry(1, 1, 1, 24));

/** Shape spec for a container type, with the user's overrides from the configuration applied. */
export function specForType(typeName, maxVolume) {
  return { ...shapeForType(typeName, maxVolume), ...(config.containerShapes[typeName] || {}) };
}

/**
 * Builds one container. Returns { group, top, setState({ fill, tint, closed, hazard }) }.
 * The group's origin is the container centre at the height of the cargo's top surface.
 */
export function buildContainer(spec, palette) {
  const group = new THREE.Group();
  const r = spec.diameter / 2, h = spec.height;
  let liquid = null, cap = null, gem = null, top = h, setFill = () => {};

  if (spec.shape === 'well') {
    top = spec.housing || h;
    const hole = new THREE.Mesh(unitDisc(), palette.hole);
    hole.scale.set(r, 0.5, r);
    hole.position.y = top + 0.3;
    liquid = new THREE.Mesh(unitDisc(), palette.hole);
    liquid.position.y = top + 0.7;
    setFill = (fill) => { const s = r * (0.5 + 0.42 * fill); liquid.scale.set(s, 0.4, s); };
    group.add(hole, liquid);
  } else if (spec.shape === 'dish') {
    const wall = new THREE.Mesh(geometry(`dish:${r2(r)}:${r2(h)}`, () => new THREE.CylinderGeometry(r, r, h, 48, 1, true)), palette.glass);
    wall.position.y = h / 2;
    const floor = new THREE.Mesh(unitDisc(), palette.plate);
    floor.scale.set(r, 1, r);
    floor.position.y = 0.5;
    liquid = new THREE.Mesh(unitDisc(), palette.hole);
    setFill = (fill) => { const lh = Math.max(0.6, fill * h * 0.8); liquid.scale.set(r * 0.97, lh, r * 0.97); liquid.position.y = 1 + lh / 2; };
    group.add(floor, liquid, wall);
  } else {
    // tube: straight body on a conical bottom
    const cone = h * 0.14;
    const body = new THREE.Mesh(geometry(`tube:${r2(r)}:${r2(h)}`, () => new THREE.CylinderGeometry(r, r, h - cone, 20, 1, true)), palette.glass);
    body.position.y = cone + (h - cone) / 2;
    const tipCone = new THREE.Mesh(geometry(`cone:${r2(r)}:${r2(cone)}`, () => new THREE.CylinderGeometry(r, r * 0.22, cone, 20, 1, true)), palette.glass);
    tipCone.position.y = cone / 2;
    const rim = new THREE.Mesh(geometry(`rim:${r2(r)}`, () => new THREE.TorusGeometry(r, Math.max(0.5, r * 0.06), 6, 24)), palette.metalLight);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = h;
    liquid = new THREE.Mesh(unitCylinder(), palette.hole);
    const base = cone * 0.45;
    setFill = (fill) => { const lh = Math.max(0.5, fill * (h - base) * 0.94); liquid.scale.set(r * 0.86, lh, r * 0.86); liquid.position.y = base + lh / 2; };
    cap = new THREE.Mesh(unitCylinder(), palette.accent2Dim);
    cap.scale.set(r * 1.12, Math.max(6, r * 0.6), r * 1.12);
    cap.position.y = h + Math.max(6, r * 0.6) / 2 - 2;
    top = h;
    group.add(liquid, tipCone, body, rim, cap);
  }

  gem = new THREE.Mesh(geometry('gem', () => new THREE.OctahedronGeometry(1)), palette.warn);
  const gemSize = Math.max(1.6, Math.min(5, r * 0.3));
  gem.scale.set(gemSize, gemSize * 1.4, gemSize);
  gem.position.y = top + gemSize * 3 + (cap ? 8 : 2);
  gem.userData.spin = true;
  group.add(gem);

  const setState = ({ fill, tint, closed, hazard }) => {
    const hasLiquid = !!tint && fill > 0.001;
    liquid.visible = hasLiquid;
    if (hasLiquid) { liquid.material = palette.liquid(tint); setFill(Math.min(1, fill)); }
    if (cap) cap.visible = !!closed;
    gem.visible = !!hazard;
  };
  return { group, top, gem, setState };
}

/** One pipette tip standing in its box. setState({ hasTip, sterile }). */
export function buildTip(spec, palette) {
  const group = new THREE.Group();
  const r = spec.diameter / 2, housing = spec.housing || 50;
  const hole = new THREE.Mesh(unitDisc(), palette.hole);
  hole.scale.set(r * 0.8, 0.5, r * 0.8);
  hole.position.y = housing + 0.3;
  const collar = new THREE.Mesh(geometry(`tip:${r2(r)}`, () => new THREE.CylinderGeometry(r * 0.62, r * 0.5, 12, 12)), palette.accentDim);
  collar.position.y = housing + 6;
  group.add(hole, collar);
  const setState = ({ hasTip, sterile }) => {
    collar.visible = !!hasTip;
    collar.material = sterile ? palette.accentDim : palette.plastic;
  };
  return { group, top: housing + 12, setState };
}

/** The box that holds a set of containers: rack for tubes, plate for wells, box for tips. */
export function buildHousing(spec, slots, palette) {
  if (!spec.housing || !slots.length) return null;
  const xs = slots.map((s) => s.x), zs = slots.map((s) => s.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const margin = spec.shape === 'well' ? 6 : 5;
  const width = maxX - minX + spec.diameter + margin * 2;
  const depth = maxZ - minZ + spec.diameter + margin * 2;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, spec.housing, depth), spec.shape === 'well' ? palette.plate : palette.plastic);
  mesh.position.set((minX + maxX) / 2, spec.housing / 2, (minZ + maxZ) / 2);
  mesh.userData.ownGeometry = true;
  return mesh;
}

/** Corner-bracket box used as selection reticle and for ghost outlines. */
export function bracketBox(box, material, corner = 0.22) {
  const { min, max } = box;
  const size = box.getSize(new THREE.Vector3());
  const len = new THREE.Vector3(Math.min(size.x * corner, 40), Math.min(size.y * corner, 40), Math.min(size.z * corner, 40));
  const points = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        const sx = x === min.x ? 1 : -1, sy = y === min.y ? 1 : -1, sz = z === min.z ? 1 : -1;
        points.push(x, y, z, x + sx * len.x, y, z, x, y, z, x, y + sy * len.y, z, x, y, z, x, y, z + sz * len.z);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geo, material);
}

export function wireBox(width, height, depth, material) {
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth));
  const lines = new THREE.LineSegments(geo, material);
  lines.userData.ownGeometry = true;
  return lines;
}

/** Frees per-object geometry (shared cached geometry is kept). */
export function disposeTree(object) {
  object.traverse((child) => {
    if (child.geometry && !shared.has(child.geometry)) child.geometry.dispose();
    if (child.material?.map && child.userData.ownTexture) { child.material.map.dispose(); child.material.dispose(); }
  });
  object.removeFromParent();
}
