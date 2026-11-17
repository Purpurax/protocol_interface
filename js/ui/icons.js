// Inline SVG icon set (24 x 24, stroke based) and the generated protocol emblems.

import { h, hashString, rng } from '../core/util.js';

const P = {
  // layers
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M7 11h10M4 14c0 4 3.5 7 8 7s8-3 8-7"/>',
  forecast: '<circle cx="11" cy="13" r="7"/><path d="M11 9v4l3 2M9 3h4M18 5l2 2M20 12h2M17 19l3 2"/>',
  wrench: '<path d="M14.5 6a4.5 4.5 0 0 0-6 5.6L3 17l4 4 5.4-5.5a4.5 4.5 0 0 0 5.6-6L15 12.5 11.5 9z"/>',
  // dock
  scroll: '<path d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2z"/><path d="M6 8H3V6a2 2 0 0 1 2-2M10 9h6M10 13h6"/>',
  crate: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
  anvil: '<path d="M4 8h14a3 3 0 0 0 3-3H8"/><path d="M8 5v3M7 8c0 4 2 5 2 8h7c0-3 2-4 2-8M6 20h13M9 16l-1 4M16 16l1 4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  keys: '<rect x="2" y="6" width="20" height="12" rx="1"/><path d="M6 10h1M10 10h1M14 10h1M18 10h0M6 14h12"/>',
  // instructions
  belt: '<path d="M3 9h18M3 15h18"/><path d="M8 6L4.5 9 8 12M16 12l3.5 3L16 18"/>',
  lift: '<path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/>',
  pipette: '<path d="M14 4l6 6M12 6l6 6-7.5 7.5a2 2 0 0 1-2.8 0L6.5 18.3a2 2 0 0 1 0-2.8z"/><path d="M5 19l-2 2M9 12h7"/>',
  hand: '<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6.5 7S5 18.5 4 15l-1-3.2a1.4 1.4 0 0 1 2.6-1z"/>',
  transfer: '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>',
  lid: '<path d="M5 10h14v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M4 6l16-3M9 5l-.6-2"/>',
  tip: '<path d="M9 3h6l-1.5 12L12 21l-1.5-6z"/><path d="M8.5 7h7"/>',
  // hazards
  flame: '<path d="M12 3c1 4 5 5.5 5 10.5A5 5 0 0 1 7 13.5C7 11 8.5 10 9 8c1.5 1 2 2.500 2 4 1-1.500 1-5 1-9z"/>',
  corrosive: '<path d="M5 4h6M8 4v4M17 5v3M3 20h18M6 16h5l2-3M8 8l-1 3M17 8l1 3M16 15h3"/><path d="M14 12h5"/>',
  skull: '<path d="M12 3a7 7 0 0 0-4 12.700V18h8v-2.300A7 7 0 0 0 12 3z"/><circle cx="9.500" cy="11" r="1.300"/><circle cx="14.500" cy="11" r="1.300"/><path d="M10 21h4M11 18v3M13 18v3"/>',
  leaf: '<path d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15z"/><path d="M5 19c3-6 6-9 10-11"/>',
  oxidizer: '<circle cx="12" cy="16" r="5"/><path d="M12 3c.5 2 2.500 3 2.500 5.500a2.500 2.500 0 0 1-5 0C9.500 7 11 6 12 3z"/>',
  bio: '<circle cx="12" cy="12" r="2"/><path d="M12 10a5 5 0 1 1 4.300 2.500M12 10a5 5 0 1 0-4.300 2.500M7.700 12.500a5 5 0 1 0 8.600 0"/>',
  // actions
  play: '<path d="M7 4l13 8-13 8z"/>',
  pause: '<path d="M7 4v16M17 4v16"/>',
  stop: '<rect x="5" y="5" width="14" height="14"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16zM13 7l4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  minus: '<path d="M4 12h16"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  eject: '<path d="M12 4l8 10H4zM4 19h16"/>',
  insert: '<path d="M12 15L4 5h16zM4 19h16"/>',
  save: '<path d="M4 4h13l3 3v13H4z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  up: '<path d="M5 15l7-7 7 7"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  warning: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><path d="M3 12c0-3 4-5 9-5s9 2 9 5-4 5-9 5M18 14l-3 3 3 3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  home: '<path d="M3 11l9-7 9 7M6 9v11h12V9"/>',
  motor: '<circle cx="12" cy="12" r="6"/><path d="M12 6V3M12 21v-3M12 12l3-2"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.800 3h10.400a2 2 0 0 0 1.800-3l-5-9V3"/><path d="M7.500 15h9"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  model: '<path d="M12 3l8 4.500v9L12 21l-8-4.500v-9z"/><path d="M12 12l8-4.500M12 12v9M12 12L4 7.500" stroke-dasharray="2 2"/>',
  dot: '<circle cx="12" cy="12" r="3" fill="currentColor"/>',
};

export function icon(name, cls = '') {
  const body = P[name] || P.dot;
  return h(`span.icon${cls ? `.${cls}` : ''}`, {
    html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`,
  });
}

export const HAZARD_ICONS = {
  flammable: { icon: 'flame', label: 'Flammable' },
  corrosive: { icon: 'corrosive', label: 'Corrosive' },
  toxic: { icon: 'skull', label: 'Toxic' },
  environmental: { icon: 'leaf', label: 'Environmental hazard' },
  oxidizer: { icon: 'oxidizer', label: 'Oxidizer' },
  biological: { icon: 'bio', label: 'Contains organisms' },
};

/** Row of hazard diamonds for a list of hazard keys. */
export function hazardBadges(flags) {
  if (!flags.length) return null;
  return h('span.hazards', flags.map((flag) => {
    const info = HAZARD_ICONS[flag] || { icon: 'warning', label: flag };
    const el = h(`span.hazard${flag === 'biological' ? '.bio' : ''}`, { title: info.label });
    el.append(icon(info.icon).firstChild);
    return el;
  }));
}

/** Icon for what an instruction does. */
export function instructionIcon(ins, store) {
  if (!ins.auto) return ins.manual?.task === 'open' ? 'lid' : ins.manual?.task === 'refill' ? 'tip' : 'hand';
  const kind = store.motorKind.get(ins.motorId);
  return kind === 'x' ? 'belt' : kind === 'y' ? 'lift' : 'pipette';
}

/**
 * Game-style emblem generated from a protocol's identity: a framed sigil whose rune, frame and
 * hue are derived from the name, so every protocol gets its own recognisable icon.
 */
export function emblem(seedText, size = 72) {
  const random = rng(hashString(seedText));
  const hue = Math.floor(random() * 360);
  const frame = Math.floor(random() * 3);
  const c = 50;
  const points = [];
  const ring = 5 + Math.floor(random() * 3);
  for (let i = 0; i < ring; i++) {
    const angle = (i / ring) * Math.PI * 2 - Math.PI / 2;
    points.push([c + Math.cos(angle) * 22, c + Math.sin(angle) * 22]);
  }
  points.push([c, c]);
  let rune = '';
  const strokes = 4 + Math.floor(random() * 3);
  let current = Math.floor(random() * points.length);
  for (let i = 0; i < strokes; i++) {
    let next = Math.floor(random() * points.length);
    if (next === current) next = (next + 1) % points.length;
    rune += `M${points[current][0].toFixed(1)} ${points[current][1].toFixed(1)}L${points[next][0].toFixed(1)} ${points[next][1].toFixed(1)}`;
    current = next;
  }
  const dots = points.filter(() => random() > 0.45).map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.600" fill="hsl(${hue} 95% 78%)"/>`).join('');
  const frames = [
    '<path d="M50 6l38 22v44L50 94 12 72V28z"/>',
    '<path d="M14 14h72v46c0 16-18 28-36 34-18-6-36-18-36-34z"/>',
    '<path d="M50 5l45 45-45 45L5 50z"/>',
  ];
  const id = `e${hashString(seedText).toString(36)}`;
  const svg = `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue} 70% 30%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 60% 12%)"/>
      </linearGradient>
    </defs>
    <g fill="url(#${id})" stroke="hsl(${hue} 90% 62%)" stroke-width="2.500" stroke-linejoin="round">${frames[frame]}</g>
    <circle cx="50" cy="50" r="30" fill="none" stroke="hsl(${hue} 80% 60% / .35)" stroke-width="1" stroke-dasharray="3 5"/>
    <path d="${rune}" fill="none" stroke="hsl(${hue} 100% 80%)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 3px hsl(${hue} 100% 60%))"/>
    ${dots}
  </svg>`;
  return h('span.emblem', { html: svg, style: { width: `${size}px`, height: `${size}px` } });
}
