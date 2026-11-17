// Small helpers used everywhere: DOM building, events, math, formatting.

export class Emitter {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }
  emit(type, payload) {
    for (const fn of this.handlers.get(type) || []) {
      try { fn(payload); } catch (err) { console.error(`[${type}]`, err); }
    }
  }
}

/**
 * h('div.card.active', { onclick, title, dataset: {..}, style: {..} }, child, 'text', [more])
 * `html` in props sets trusted markup (only used for the built-in SVG icons).
 */
export function h(spec, props, ...children) {
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'html') el.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'class') el.className = `${el.className} ${value}`.trim();
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
/** Replaces the content of `el`; like h(), it skips null / false and flattens arrays. */
export const fill = (el, ...children) => { clear(el); append(el, children); return el; };
/** Appends children the same forgiving way. */
export const add = (el, ...children) => { append(el, children); return el; };
export const $ = (selector, rootEl = document) => rootEl.querySelector(selector);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential approach. */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

export function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return '–';
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes) return `${minutes}:${String(seconds).padStart(2, '0')} min`;
  return `${seconds} s`;
}

export const fmtClock = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const fmtMm = (v) => `${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)} mm`;

export function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Deterministic pseudo random generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const debounce = (fn, ms) => {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
};

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
export const isSmallScreen = () => matchMedia('(max-width: 820px)').matches;

export function downloadText(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Number field that can be scrubbed by dragging horizontally, typed, or stepped with the wheel. */
export function scrubber({ value, step = 1, min = -Infinity, max = Infinity, unit = '', digits = 1, onchange }) {
  let current = value;
  const input = h('input.scrub-input', { type: 'text', inputMode: 'decimal', value: fmt(current) });
  const el = h('label.scrub', input, unit ? h('span.scrub-unit', unit) : null);
  function fmt(v) { return Number(v.toFixed(digits)).toString(); }
  function set(v, notify = true) {
    current = clamp(Math.round(v / (step / 10)) * (step / 10), min, max);
    input.value = fmt(current);
    if (notify) onchange?.(current);
  }
  input.addEventListener('change', () => { const v = parseFloat(input.value.replace(',', '.')); set(Number.isFinite(v) ? v : current); });
  input.addEventListener('wheel', (e) => { e.preventDefault(); set(current + (e.deltaY < 0 ? step : -step) * (e.shiftKey ? 10 : 1)); }, { passive: false });
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.target === input && document.activeElement === input) return;
    drag = { x: e.clientX, start: current, moved: false };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (drag.moved) { e.preventDefault(); set(drag.start + Math.round(dx / 4) * step * (e.shiftKey ? 10 : 1)); }
  });
  el.addEventListener('pointerup', (e) => {
    el.releasePointerCapture(e.pointerId);
    if (drag && !drag.moved) { input.focus(); input.select(); }
    drag = null;
  });
  el.set = (v) => set(v, false);
  return el;
}
