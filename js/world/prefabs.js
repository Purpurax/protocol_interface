// Prefabs: reusable models built from parts (STL files, boxes, conveyor references, container
// collections). A prefab is assigned to an element id in the configuration and is then shown
// instead of the default rectangle.

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { config, saveConfig } from '../core/config.js';
import { COLLECTIONS, collectionSlots } from '../shared/collections.js';
import { DIM } from './themes.js';
import { buildContainer, buildHousing, buildTip, markShared } from './shapes.js';

const loader = new STLLoader();
const stlCache = new Map(); // src -> Promise<BufferGeometry>

// ------------------------------------------------------------------ model library

const DB_NAME = 'warehouse-interface';
function idb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('models');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function idbCall(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', mode);
    const request = fn(tx.objectStore('models'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}

/** STL files the user dropped into the browser are kept in IndexedDB under "idb:<name>". */
export async function storeModel(file) {
  await idbCall('readwrite', (store) => store.put(file, file.name));
  stlCache.delete(`idb:${file.name}`);
  return { name: file.name, url: `idb:${file.name}`, size: file.size, local: true };
}

export async function removeModel(name) {
  await idbCall('readwrite', (store) => store.delete(name));
  stlCache.delete(`idb:${name}`);
}

/** Models in ./models (listed by serve.mjs) plus the ones stored in the browser. */
export async function listModels() {
  const models = [];
  try {
    const response = await fetch('/__models', { cache: 'no-store' });
    if (response.ok) models.push(...(await response.json()));
  } catch { /* plain static hosting: no listing */ }
  try {
    const names = await idbCall('readonly', (store) => store.getAllKeys());
    for (const name of names) models.push({ name, url: `idb:${name}`, local: true });
  } catch { /* IndexedDB unavailable */ }
  return models;
}

export function loadStl(src) {
  if (!stlCache.has(src)) {
    const promise = (async () => {
      let buffer;
      if (src.startsWith('idb:')) {
        const blob = await idbCall('readonly', (store) => store.get(src.slice(4)));
        if (!blob) throw new Error(`Model ${src.slice(4)} is not stored in this browser`);
        buffer = await blob.arrayBuffer();
      } else {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`Model ${src} not found`);
        buffer = await response.arrayBuffer();
      }
      const geo = loader.parse(buffer);
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      return markShared(geo);
    })();
    promise.catch(() => stlCache.delete(src));
    stlCache.set(src, promise);
  }
  return stlCache.get(src);
}

// ------------------------------------------------------------------ data

const uid = () => Math.random().toString(36).slice(2, 9);

export const PART_TYPES = {
  stl: { label: 'STL model' },
  box: { label: 'Box' },
  cylinder: { label: 'Cylinder' },
  belt: { label: 'Conveyor' },
  collection: { label: 'Container collection' },
};

export function newPart(type, extra = {}) {
  const base = { id: uid(), type, name: PART_TYPES[type].label, pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, color: null };
  if (type === 'stl') Object.assign(base, { src: '', rot: [-90, 0, 0] });
  if (type === 'box') Object.assign(base, { size: [135, 14, 90] });
  if (type === 'cylinder') Object.assign(base, { radius: 15, height: 60 });
  if (type === 'belt') Object.assign(base, { mode: 'through', dir: 1, width: DIM.BELT_DEPTH, thickness: DIM.BELT_THICK, pos: [0, 0, DIM.BELT_Z0] });
  if (type === 'collection') Object.assign(base, { preset: 'falcon50', ...COLLECTIONS.falcon50, pos: [0, DIM.CARGO_BASE, 0] });
  return Object.assign(base, extra);
}

export function newPrefab(kind = 'cargo', name = 'New prefab') {
  const prefab = { id: uid(), name, kind, hideDefault: true, parts: [] };
  config.prefabs[prefab.id] = prefab;
  saveConfig('prefabs');
  return prefab;
}

export function duplicatePrefab(prefab) {
  const copy = JSON.parse(JSON.stringify(prefab));
  copy.id = uid();
  copy.name = `${prefab.name} copy`;
  for (const part of copy.parts) part.id = uid();
  config.prefabs[copy.id] = copy;
  saveConfig('prefabs');
  return copy;
}

export function deletePrefab(id) {
  delete config.prefabs[id];
  for (const [key, value] of Object.entries(config.assignments)) if (value.prefab === id) delete config.assignments[key];
  saveConfig('prefabs');
}

// ------------------------------------------------------------------ building

function partMaterial(part, palette) {
  if (part.color === 'accent') return palette.accent;
  if (part.color === 'accent2') return palette.accent2;
  if (part.color) return new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.6, metalness: 0.3 });
  return palette.stl;
}

function applyTransform(object, part) {
  object.position.fromArray(part.pos || [0, 0, 0]);
  const [rx, ry, rz] = part.rot || [0, 0, 0];
  object.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz));
  if (Array.isArray(part.scale)) object.scale.fromArray(part.scale); else object.scale.setScalar(part.scale || 1);
}

/**
 * ctx: { workshop?: boolean, ownerLength?: number (conveyor length), onLoad?: () => void }
 * In the workshop a belt reference is drawn "endless"; in the world it is cut to its conveyor.
 */
export function buildPart(part, palette, ctx = {}) {
  const group = new THREE.Group();
  group.userData.partId = part.id;
  applyTransform(group, part);

  if (part.type === 'stl') {
    if (part.src) {
      loadStl(part.src).then((geo) => {
        const mesh = new THREE.Mesh(geo, partMaterial(part, palette));
        group.add(mesh);
        ctx.onLoad?.(group);
      }).catch((err) => { group.userData.error = err.message; ctx.onError?.(err.message); });
    }
  } else if (part.type === 'box') {
    const [w, h, d] = part.size;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), partMaterial(part, palette));
    mesh.position.set(w / 2, h / 2, d / 2);
    group.add(mesh);
  } else if (part.type === 'cylinder') {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(part.radius, part.radius, part.height, 32), partMaterial(part, palette));
    mesh.position.y = part.height / 2;
    group.add(mesh);
  } else if (part.type === 'belt') {
    const far = ctx.workshop ? 900 : null;
    let from, to;
    if (part.mode === 'through') {
      from = far != null ? -far : -part.pos[0];
      to = far != null ? far : (ctx.ownerLength ?? 300) - part.pos[0];
    } else if (part.dir >= 0) {
      from = 0;
      to = far != null ? far : Math.max(20, (ctx.ownerLength ?? 300) - part.pos[0]);
    } else {
      from = far != null ? -far : -Math.max(20, part.pos[0]);
      to = 0;
    }
    const length = to - from;
    const body = new THREE.Mesh(new THREE.BoxGeometry(length, part.thickness, part.width), palette.metal);
    body.position.set((from + to) / 2, -part.thickness / 2, part.width / 2);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(length, part.width - 8), palette.belt(length, false));
    top.rotation.x = -Math.PI / 2;
    top.position.set((from + to) / 2, 0.4, part.width / 2);
    top.material.uniforms.uActive.value = ctx.workshop ? 0.35 : 0;
    group.add(body, top);
    if (ctx.workshop) {
      // mark the fixed end of an edge conveyor and the open ("goes on") ends
      const marks = [];
      const openEnds = part.mode === 'through' ? [from, to] : [part.dir >= 0 ? to : from];
      for (const x of openEnds) {
        const s = x > 0 ? 1 : -1;
        for (let i = 1; i <= 3; i++) marks.push(x + s * i * 26, 0, 0, x + s * i * 26, 0, part.width);
      }
      if (part.mode === 'edge') marks.push(0, -part.thickness, 0, 0, 26, 0, 0, -part.thickness, part.width, 0, 26, part.width, 0, 26, 0, 0, 26, part.width);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(marks, 3));
      group.add(new THREE.LineSegments(geo, palette.accentLine));
    }
  } else if (part.type === 'collection') {
    const slots = collectionSlots(part);
    const housing = buildHousing(part, slots, palette);
    if (housing) group.add(housing);
    if (ctx.workshop) {
      for (const slot of slots) {
        const item = part.isTips || part.shape === 'tip' ? buildTip(part, palette) : buildContainer(part, palette);
        item.setState(part.shape === 'tip' ? { hasTip: true, sterile: true } : { fill: 0.55, tint: { h: 196, s: 70, l: 62 }, closed: false, hazard: false });
        item.group.position.set(slot.x, 0, slot.z);
        group.add(item.group);
      }
    }
  }
  return group;
}

export function buildPrefab(prefab, palette, ctx = {}) {
  const group = new THREE.Group();
  group.userData.prefabId = prefab.id;
  for (const part of prefab.parts) group.add(buildPart(part, palette, ctx));
  return group;
}

/** The collection part of a prefab, if it has one (it then defines the cargo's housing). */
export const collectionOf = (prefab) => prefab?.parts.find((part) => part.type === 'collection') || null;
