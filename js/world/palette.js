// Shared THREE materials. They are created once and recoloured in place when the world theme
// changes, so no mesh has to be rebuilt.

import * as THREE from 'three';
import { DIM } from './themes.js';

const hdr = (hex, boost) => new THREE.Color(hex).multiplyScalar(boost);

const BELT_VERT = /* glsl */ `
  varying vec2 vUv;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

// Chevrons painted on the belt; they travel with the belt (uOffset is the motor position in mm).
const BELT_FRAG = /* glsl */ `
  uniform vec3 uBase; uniform vec3 uAccent; uniform float uOffset; uniform float uLength; uniform float uDepth;
  uniform float uActive; uniform float uDir;
  varying vec2 vUv;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    float x = vUv.x * uLength - uOffset;
    float z = (vUv.y - 0.5) * uDepth;
    float lean = abs(z) * 0.55 * (uDir >= 0.0 ? -1.0 : 1.0);
    float f = fract((x + lean) / 34.0);
    float band = smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.26, 0.32, f));
    float edge = smoothstep(0.42, 0.47, abs(vUv.y - 0.5));
    vec3 color = mix(uBase, uAccent, band * (0.10 + 1.9 * uActive) * (1.0 - edge));
    color = mix(color, uBase * 0.55, edge);
    gl_FragColor = vec4(color, 1.0);
    #include <fog_fragment>
  }`;

// Holographic arrows on the front face of a conveyor / along a lift, only visible while moving.
const HOLO_FRAG = /* glsl */ `
  uniform vec3 uAccent; uniform float uTime; uniform float uLength; uniform float uHeight;
  uniform float uActive; uniform float uDir;
  varying vec2 vUv;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    float along = vUv.x * uLength;
    float across = (vUv.y - 0.5) * uHeight;
    float p = along * uDir - uTime * 90.0 + abs(across) * 1.1;
    float f = fract(p / 30.0);
    float arrow = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.34, 0.42, f));
    float fade = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
    float alpha = arrow * fade * uActive;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uAccent * 2.6, alpha);
    #include <fog_fragment>
  }`;

// Dashes flowing along a tube (transfer arcs, trajectories).
const FLOW_FRAG = /* glsl */ `
  uniform vec3 uAccent; uniform float uTime; uniform float uRepeat; uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float f = fract(vUv.x * uRepeat - uTime * 1.4);
    float dash = smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.55, 0.7, f));
    gl_FragColor = vec4(uAccent * (0.8 + 2.4 * dash), (0.25 + 0.75 * dash) * uOpacity);
  }`;

// Vertical light column used for beacons.
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uAccent; uniform float uTime;
  varying vec2 vUv;
  void main() {
    float rise = fract(vUv.y * 2.0 - uTime * 0.8);
    float alpha = pow(1.0 - vUv.y, 1.6) * (0.35 + 0.35 * smoothstep(0.0, 0.2, rise) * (1.0 - smoothstep(0.2, 0.9, rise)));
    gl_FragColor = vec4(uAccent * 2.4, alpha);
  }`;

const PLAIN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export class Palette {
  constructor() {
    this.time = { value: 0 };
    this.theme = null;
    const standard = (roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ roughness, metalness, ...extra });
    this.metal = standard(0.62, 0.25);
    this.metalLight = standard(0.45, 0.35);
    this.plastic = standard(0.8, 0.1);
    this.cargo = standard(0.6, 0.12);
    this.plate = standard(0.5, 0.0, { transparent: true, opacity: 0.92 });
    this.glass = standard(0.15, 0.0, { transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
    this.hole = new THREE.MeshBasicMaterial();
    this.stl = standard(0.6, 0.2);
    this.accent = new THREE.MeshBasicMaterial();
    this.accentDim = new THREE.MeshBasicMaterial();
    this.accent2 = new THREE.MeshBasicMaterial();
    this.accent2Dim = new THREE.MeshBasicMaterial();
    this.warn = new THREE.MeshBasicMaterial();
    this.ok = new THREE.MeshBasicMaterial();
    this.ghost = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false });
    this.ghostLine = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95 });
    this.accentLine = new THREE.LineBasicMaterial();
    this.accent2Line = new THREE.LineBasicMaterial();
    this.warnLine = new THREE.LineBasicMaterial();
    this.dimLine = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 });
    this.zone = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    this.additive = new Set(); // per-object accent materials that follow the theme
    this.liquids = new Map();
    this.shaders = new Set();
  }

  /** Per-object accent material whose brightness can be animated. */
  accentInstance(which = 'accent') {
    const material = new THREE.MeshBasicMaterial();
    material.userData.which = which;
    material.userData.level = 0.25;
    this.additive.add(material);
    if (this.theme) this.tint(material);
    return material;
  }

  tint(material) {
    const level = material.userData.level ?? 1;
    material.color.copy(hdr(this.theme[material.userData.which || 'accent'], 0.25 + level * 2.4));
  }

  setLevel(material, level) {
    if (Math.abs((material.userData.level ?? 0) - level) < 0.01) return;
    material.userData.level = level;
    this.tint(material);
  }

  textured(texture, which = 'accent', opacity = 1) {
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    material.userData.which = which;
    material.userData.level = 0.6;
    this.additive.add(material);
    if (this.theme) this.tint(material);
    return material;
  }

  shader(fragment, which, uniforms = {}, options = {}) {
    const material = new THREE.ShaderMaterial({
      vertexShader: options.fog ? BELT_VERT : PLAIN_VERT, fragmentShader: fragment, fog: !!options.fog,
      transparent: options.transparent !== false, depthWrite: false, side: THREE.DoubleSide,
      blending: options.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: {
        ...(options.fog ? THREE.UniformsUtils.clone(THREE.UniformsLib.fog) : {}),
        uAccent: { value: new THREE.Color() }, uTime: this.time, ...uniforms,
      },
    });
    material.userData.which = which;
    this.shaders.add(material);
    if (this.theme) material.uniforms.uAccent.value.set(this.theme[which]);
    return material;
  }

  belt(length, storage) {
    const material = new THREE.ShaderMaterial({
      vertexShader: BELT_VERT, fragmentShader: BELT_FRAG, fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uBase: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() }, uOffset: { value: 0 },
        uLength: { value: length }, uDepth: { value: DIM.BELT_DEPTH }, uActive: { value: 0 }, uDir: { value: 1 },
      },
    });
    material.userData.which = storage ? 'accent2' : 'accent';
    material.userData.belt = true;
    this.shaders.add(material);
    if (this.theme) this.recolorShader(material);
    return material;
  }

  holo(length, height, which = 'accent') {
    return this.shader(HOLO_FRAG, which, { uLength: { value: length }, uHeight: { value: height }, uActive: { value: 0 }, uDir: { value: 1 } }, { fog: true });
  }
  flow(which = 'accent', repeat = 8) {
    return this.shader(FLOW_FRAG, which, { uRepeat: { value: repeat }, uOpacity: { value: 1 } });
  }
  beam(which = 'warn') { return this.shader(BEAM_FRAG, which); }

  recolorShader(material) {
    material.uniforms.uAccent.value.set(this.theme[material.userData.which]);
    if (material.userData.belt) material.uniforms.uBase.value.set(this.theme.belt);
  }

  /** Liquid material for a tint {h, s, l}; glows a little so contents stand out of the neutral scene. */
  liquid(tint) {
    const key = `${tint.h}:${tint.s}:${tint.l}`;
    let material = this.liquids.get(key);
    if (!material) {
      const color = new THREE.Color().setHSL(tint.h / 360, tint.s / 100, tint.l / 100);
      material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0 });
      this.liquids.set(key, material);
    }
    return material;
  }

  /** Drops a per-object material created by accentInstance / textured / shader / belt. */
  forget(material) {
    if (this.additive.delete(material) || this.shaders.delete(material)) material.dispose();
  }

  apply(theme) {
    this.theme = theme;
    this.metal.color.set(theme.metal);
    this.metalLight.color.set(theme.metalLight);
    this.plastic.color.set(theme.plastic);
    this.cargo.color.set(theme.cargo);
    this.plate.color.set(theme.plate);
    this.glass.color.set(theme.glass);
    this.glass.opacity = theme.dark ? 0.2 : 0.42;
    this.hole.color.set(theme.boardHole);
    this.stl.color.set(theme.metalLight);
    this.accent.color.copy(hdr(theme.accent, 2.4));
    this.accentDim.color.copy(hdr(theme.accent, 0.45));
    this.accent2.color.copy(hdr(theme.accent2, 2.2));
    this.accent2Dim.color.copy(hdr(theme.accent2, 0.5));
    this.warn.color.copy(hdr(theme.warn, 2.4));
    this.ok.color.copy(hdr(theme.ok, 2.0));
    this.ghost.color.set(theme.ghost);
    this.ghostLine.color.copy(hdr(theme.ghost, 2.0));
    this.accentLine.color.copy(hdr(theme.accent, 2.2));
    this.accent2Line.color.copy(hdr(theme.accent2, 2.2));
    this.warnLine.color.copy(hdr(theme.warn, 2.2));
    this.dimLine.color.set(theme.metalLight);
    this.zone.color.set(theme.warn);
    // additive glow disappears on a bright background, so light themes blend normally
    const blending = theme.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const material of this.additive) {
      this.tint(material);
      if (material.map && material.blending !== blending) { material.blending = blending; material.needsUpdate = true; }
    }
    for (const material of this.shaders) {
      this.recolorShader(material);
      if (material.transparent && !material.userData.belt && material.blending !== blending) { material.blending = blending; material.needsUpdate = true; }
    }
  }
}

/** White-on-transparent text drawn to a canvas; tinted by the material that uses it. */
export function textTexture(text, { size = 64, weight = 700, padding = 10 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${weight} ${size}px "Chakra Petch", "Segoe UI", sans-serif`;
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + padding * 2;
  canvas.width = THREE.MathUtils.ceilPowerOfTwo(width);
  canvas.height = THREE.MathUtils.ceilPowerOfTwo(size + padding * 2);
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + size * 0.04);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData.aspect = canvas.width / canvas.height;
  return texture;
}

/** A ring of pseudo runes: the arcane accent used behind devices and under beacons. */
export function runeTexture(seed = 7, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  let s = seed;
  const random = () => { s = (s * 16807) % 2147483647; return (s & 0xffff) / 0xffff; };
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  const circle = (r, w, dash) => {
    ctx.lineWidth = w;
    ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
  };
  circle(c * 0.96, 3); circle(c * 0.74, 2); circle(c * 0.7, 1, [3, 9]); circle(c * 0.42, 1.5, [22, 8]);
  ctx.setLineDash([]);
  const glyphs = 22;
  for (let i = 0; i < glyphs; i++) {
    const angle = (i / glyphs) * Math.PI * 2;
    ctx.save();
    ctx.translate(c + Math.cos(angle) * c * 0.85, c + Math.sin(angle) * c * 0.85);
    ctx.rotate(angle + Math.PI / 2);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    const u = c * 0.045;
    let x = (Math.floor(random() * 3) - 1) * u, y = -u * 1.4;
    ctx.moveTo(x, y);
    for (let k = 0; k < 3 + Math.floor(random() * 2); k++) {
      x = (Math.floor(random() * 3) - 1) * u;
      y += u * (0.6 + random() * 0.6);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + 0.26;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * c * 0.42, c + Math.sin(angle) * c * 0.42);
    ctx.lineTo(c + Math.cos(angle) * c * 0.7, c + Math.sin(angle) * c * 0.7);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
