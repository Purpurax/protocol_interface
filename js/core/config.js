// Client-side user configuration. Everything the user sets up (themes, prefabs, which model is
// used for which element id, offsets, learned motor speeds, ...) lives in one JSON document that is
// kept in localStorage and can be exported / imported as a file.

import { Emitter, debounce, downloadText } from './util.js';

const STORAGE_KEY = 'warehouse-interface.config';
export const CONFIG_VERSION = 2; // 2: belts and lifts start at 30 ms per mm instead of 10

/** ms per mm a motor kind is assumed to need before anything was measured (x belt, y lift, tool pipetter). */
export const DEFAULT_RATE = { x: 30, y: 30, tool: 10 };
export const freshSpeed = (kind = 'tool') => ({ rate: DEFAULT_RATE[kind] ?? 10, overhead: 0, samples: 0, fit: null });

const defaults = () => ({
  version: CONFIG_VERSION,
  uiTheme: 'arcane',
  worldTheme: 'arcane',
  quality: 'auto', // auto | high | low
  layer: 'normal',
  server: '', // empty: same-origin /api (serve.mjs) or http://localhost:3210
  autoEnterSim: false,
  simSpeed: 1,
  cameraSpeed: 1,
  followSelection: true,
  // learned duration model per motor kind: time = overhead + rate * distance
  // (starts at DEFAULT_RATE with no overhead)
  speed: { x: freshSpeed('x'), y: freshSpeed('y'), tool: freshSpeed('tool') },
  // prefabs: id -> { id, name, kind, hideDefault, parts: [...] }
  prefabs: {},
  // assignments: "cargo:3" | "conveyor:1" | "pipetter:1" -> { prefab, offset: [x,y,z], rotation: [x,y,z], scale }
  assignments: {},
  // container type name -> { shape, diameter, height } overrides
  containerShapes: {},
});

export const events = new Emitter();
export const config = load();

function load() {
  const base = defaults();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored && typeof stored === 'object') return merge(base, stored);
  } catch { /* corrupt config: start fresh */ }
  return base;
}

function merge(base, stored) {
  const out = { ...base };
  for (const key of Object.keys(base)) {
    if (!(key in stored) || stored[key] == null) continue;
    if (key === 'speed') {
      for (const kind of Object.keys(base.speed)) {
        const s = stored.speed[kind];
        // an older config that never measured anything only holds the old default: take the new one
        if (!(stored.version >= CONFIG_VERSION) && !(s?.samples > 0)) continue;
        if (s && Number.isFinite(s.rate) && s.rate > 0) {
          out.speed[kind] = { rate: s.rate, overhead: Number.isFinite(s.overhead) ? Math.max(0, s.overhead) : 0, samples: s.samples | 0, fit: s.fit && typeof s.fit === 'object' ? s.fit : null };
        }
      }
    } else if (typeof base[key] === 'object') {
      if (typeof stored[key] === 'object') out[key] = stored[key];
    } else if (typeof stored[key] === typeof base[key]) {
      out[key] = stored[key];
    }
  }
  out.version = CONFIG_VERSION;
  return out;
}

const persist = debounce(() => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch (err) { console.warn('Config not saved', err); }
}, 250);

/** Call after mutating `config`. `what` names the part that changed for listeners. */
export function saveConfig(what = 'any') {
  persist();
  events.emit('change', what);
  events.emit(`change:${what}`, config);
}

export function setConfig(key, value) {
  if (config[key] === value) return;
  config[key] = value;
  saveConfig(key);
}

export function exportConfig() {
  downloadText('warehouse-interface.config.json', JSON.stringify(config, null, 2));
}

export async function importConfig(file) {
  const parsed = JSON.parse(await file.text());
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Not a configuration file');
  const merged = merge(defaults(), parsed);
  for (const key of Object.keys(config)) delete config[key];
  Object.assign(config, merged);
  saveConfig('all');
}

export function resetConfig() {
  const fresh = defaults();
  for (const key of Object.keys(config)) delete config[key];
  Object.assign(config, fresh);
  saveConfig('all');
}

export const assignmentKey = (type, id) => `${type}:${id}`;
export const getAssignment = (type, id) => config.assignments[assignmentKey(type, id)] || null;

export function setAssignment(type, id, value) {
  const key = assignmentKey(type, id);
  if (value) config.assignments[key] = value; else delete config.assignments[key];
  saveConfig('assignments');
}
