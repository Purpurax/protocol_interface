// The 3D world: renderer, camera, entity views, picking, selection, beacons and screen labels.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Emitter, isSmallScreen, isTouchDevice } from '../core/util.js';
import { config } from '../core/config.js';
import { Board } from './board.js';
import { CameraRig } from './camera.js';
import { Palette, runeTexture } from './palette.js';
import { DIM, themeOf } from './themes.js';
import { CargoView, ConveyorView, PipetterView } from './views.js';
import { bracketBox, disposeTree } from './shapes.js';

const BEACON_KIND = { manual: 'warn', from: 'accent', to: 'accent2', hover: 'accent' };

export class World extends Emitter {
  constructor(canvas, labelRoot, store) {
    super();
    this.canvas = canvas;
    this.labelRoot = labelRoot;
    this.store = store;
    this.palette = new Palette();
    this.runeTexture = runeTexture();
    this.time = 0;
    this.layer = 'normal';
    this.selection = null;
    this.views = { conveyor: new Map(), cargo: new Map(), pipetter: new Map() };
    this.pickables = [];
    this.pickablesDirty = true;
    this.labels = new Map();
    this.beacons = new Map();
    this.arc = null;
    this.updaters = new Set();
    this.paused = false;
    this.fps = { frames: 0, time: 0, value: 60, slow: 0 };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x000000, 2000, 9000);
    this.camera = new THREE.PerspectiveCamera(38, 1, 20, 40000);
    this.rig = new CameraRig(this.camera, canvas);
    this.rig.onClick = (event) => this.click(event);
    this.raycaster = new THREE.Raycaster();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 2.0);
    this.key = new THREE.DirectionalLight(0xffffff, 3.2);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.55);
    this.scene.add(this.hemi, this.key, this.key.target, this.fill, this.fill.target);

    this.board = new Board();
    this.staticGroup = new THREE.Group();
    this.cargoGroup = new THREE.Group();
    this.overlay = new THREE.Group(); // ghosts, reticles, beacons, layer helpers
    this.scene.add(this.board.mesh, this.staticGroup, this.cargoGroup, this.overlay);
    this.dust = this.makeDust();
    this.scene.add(this.dust);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.setTheme(config.worldTheme);
    this.setQuality(config.quality);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && e.buttons === 0) this.hoverPoint = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerleave', () => { this.hoverPoint = null; this.setHover(null); });

    store.on('structure', () => this.rebuild());
    store.on('snapshot', () => this.refresh());
  }

  // ------------------------------------------------------------------ setup

  makeDust() {
    const count = 420;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = -1500 + Math.random() * 5000;
      positions[i * 3 + 1] = -800 + Math.random() * 3400;
      positions[i * 3 + 2] = 150 + Math.random() * 900;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dustMaterial = new THREE.PointsMaterial({ size: 5, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, this.dustMaterial);
    points.frustumCulled = false;
    return points;
  }

  setTheme(name) {
    const theme = themeOf(name);
    this.theme = theme;
    this.palette.apply(theme);
    this.board.applyTheme(theme);
    this.scene.background = new THREE.Color(theme.background);
    this.scene.fog.color.set(theme.fog);
    this.scene.fog.near = theme.fogNear;
    this.scene.fog.far = theme.fogFar;
    this.hemi.color.set(theme.sky);
    this.hemi.groundColor.set(theme.ground);
    this.key.color.set(theme.key);
    this.fill.color.set(theme.fill);
    const light = theme.light || { hemi: 2.0, key: 3.2, fill: 0.9 };
    this.hemi.intensity = light.hemi;
    this.key.intensity = light.key;
    this.fill.intensity = light.fill;
    this.renderer.toneMappingExposure = theme.exposure;
    this.bloom.strength = theme.bloom.strength;
    this.bloom.radius = theme.bloom.radius;
    this.bloom.threshold = theme.bloom.threshold;
    this.dustMaterial.color.set(theme.accent);
    this.dust.visible = theme.dark;
    this.labelRoot.dataset.dark = theme.dark ? '1' : '0';
  }

  setQuality(quality) {
    const low = quality === 'low' || (quality === 'auto' && (isTouchDevice() || isSmallScreen()));
    this.useBloom = !low;
    this.maxPixelRatio = low ? 1.5 : 2;
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent.clientWidth), height = Math.max(1, parent.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio || 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    // keep the point of interest in the middle of the area that is not covered by docked panels
    const inset = this.inset || { left: 0, right: 0 };
    const shift = isSmallScreen() ? 0 : (inset.left - inset.right) / 2;
    if (shift) this.camera.setViewOffset(width, height, -shift, 0, width, height); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.rig.visibleAspect = isSmallScreen() ? width / height : Math.max(200, width - inset.left - inset.right) / height;
    this.size = { width, height };
  }

  /** Tells the world how much of the screen a docked panel covers on one side (in px). */
  setInset(side, px) {
    this.inset = this.inset || { left: 0, right: 0 };
    if (this.inset[side] === px) return;
    this.inset[side] = px;
    this.resize();
  }

  // ------------------------------------------------------------------ views

  rebuild() {
    const { store } = this;
    for (const map of Object.values(this.views)) {
      for (const view of map.values()) view.dispose();
      map.clear();
    }
    for (const conv of store.conveyors.values()) {
      const view = new ConveyorView(this, conv);
      this.views.conveyor.set(conv.id, view);
      this.staticGroup.add(view.group);
    }
    for (const pipetter of store.pipetters.values()) {
      const view = new PipetterView(this, pipetter);
      this.views.pipetter.set(pipetter.id, view);
      this.staticGroup.add(view.group);
    }
    for (const cargo of store.cargos.values()) {
      if (!cargo.available) continue;
      const view = new CargoView(this, cargo);
      this.views.cargo.set(cargo.id, view);
      this.cargoGroup.add(view.group);
    }
    this.pickablesDirty = true;
    this.beaconSignatures?.clear();

    const bounds = this.worldBounds();
    if (!this.framed && !bounds.isEmpty()) {
      this.rig.frame(bounds, true);
      this.framed = true;
    } else if (!bounds.isEmpty()) {
      this.rig.bounds.copy(bounds).expandByScalar(700);
    }
    if (this.selection && !this.exists(this.selection)) this.select(null);
    this.emit('rebuilt');
  }

  /** Rebuilds only the views whose prefab assignment changed (setup layer). */
  reassign(type, id) {
    const view = this.views[type]?.get(id);
    if (!view) return;
    if (type === 'cargo') {
      // the housing may come from the prefab's collection part: rebuild the whole cargo
      view.dispose();
      const next = new CargoView(this, this.store.cargos.get(id));
      this.views.cargo.set(id, next);
      this.cargoGroup.add(next.group);
    } else if (type === 'conveyor') view.applyAssignment(view.carriage, { ownerLength: view.conv.lenX });
    else view.applyAssignment(view.anchor);
    this.pickablesDirty = true;
  }

  refresh() {
    for (const view of this.views.cargo.values()) view.refresh();
  }

  worldBounds() {
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (const view of this.views.conveyor.values()) box.union(view.getBox(tmp));
    for (const view of this.views.pipetter.values()) box.union(view.getBox(tmp));
    return box;
  }

  exists(sel) {
    const s = this.store;
    switch (sel?.type) {
      case 'conveyor': return s.conveyors.has(sel.id);
      case 'cargo': return !!s.cargos.get(sel.id)?.available;
      case 'container': return s.containers.has(sel.id) && !!s.cargos.get(s.containers.get(sel.id).cargoId)?.available;
      case 'tip': return s.tips.has(sel.id) && !!s.cargos.get(s.tips.get(sel.id).cargoId)?.available;
      case 'pipetter': return s.pipetters.has(sel.id);
      case 'deadzone': return s.deadzones.some((d) => d.id === sel.id);
      case 'calibrator': return s.calibrators.some((c) => c.id === sel.id);
      default: return false;
    }
  }

  /** Current bounding box of any selectable thing, in world space. */
  boxOf(sel, target = new THREE.Box3()) {
    const s = this.store;
    switch (sel?.type) {
      case 'conveyor': return this.views.conveyor.get(sel.id)?.getBox(target) || null;
      case 'pipetter': return this.views.pipetter.get(sel.id)?.getBox(target) || null;
      case 'cargo': return this.views.cargo.get(sel.id)?.getBox(target) || null;
      case 'container': return this.views.cargo.get(s.containers.get(sel.id)?.cargoId)?.itemBox('container', sel.id, target) || null;
      case 'tip': return this.views.cargo.get(s.tips.get(sel.id)?.cargoId)?.itemBox('tip', sel.id, target) || null;
      case 'deadzone': {
        const zone = s.deadzones.find((d) => d.id === sel.id);
        return this.views.conveyor.get(zone?.conveyorId)?.markerBox(`deadzone:${sel.id}`, target) || null;
      }
      case 'calibrator': {
        const cal = s.calibrators.find((c) => c.id === sel.id);
        return this.views.conveyor.get(cal?.conveyorId)?.markerBox(`calibrator:${sel.id}`, target) || null;
      }
      default: return null;
    }
  }

  centreOf(sel, target = new THREE.Vector3()) {
    const box = this.boxOf(sel, this._box || (this._box = new THREE.Box3()));
    return box ? box.getCenter(target) : null;
  }

  /** Top-centre of a thing: where beacons and labels attach. */
  topOf(sel, target = new THREE.Vector3()) {
    const box = this.boxOf(sel, this._box || (this._box = new THREE.Box3()));
    if (!box) return null;
    return target.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
  }

  // ------------------------------------------------------------------ picking

  collectPickables() {
    this.pickables = [];
    const collect = (child) => { if (child.isMesh && child.userData.pick && child.visible) this.pickables.push(child); };
    this.staticGroup.traverse(collect);
    this.cargoGroup.traverse(collect);
    this.pickablesDirty = false;
  }

  pickAt(clientX, clientY) {
    if (this.pickablesDirty) this.collectPickables();
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.pickables, false)) {
      let visible = true;
      for (let node = hit.object; node; node = node.parent) if (!node.visible) { visible = false; break; }
      if (visible) { this.lastPickPoint = hit.point.clone(); return hit.object.userData.pick; }
    }
    this.lastPickPoint = null;
    return null;
  }

  click(event) {
    this.emit('pick', { sel: this.pickAt(event.clientX, event.clientY), event });
  }

  setHover(sel) {
    const same = (sel?.type === this.hover?.type && sel?.id === this.hover?.id);
    if (same) return;
    this.hover = sel;
    this.canvas.style.cursor = sel ? 'pointer' : '';
    this.emit('hover', sel);
  }

  // ------------------------------------------------------------------ selection & focus

  select(sel, { focus = true } = {}) {
    if (sel && !this.exists(sel)) sel = null;
    const changed = sel?.type !== this.selection?.type || sel?.id !== this.selection?.id;
    if (this.selection?.type === 'cargo') { const v = this.views.cargo.get(this.selection.id); if (v) v.selected = false; }
    this.selection = sel;
    if (this.reticle) { disposeTree(this.reticle); this.reticle = null; }
    if (!sel) {
      if (changed) this.rig.release();
      if (changed) this.emit('select', null);
      return;
    }
    if (sel.type === 'cargo') this.views.cargo.get(sel.id).selected = true;
    const box = this.boxOf(sel, new THREE.Box3());
    const size = box.getSize(new THREE.Vector3());
    const local = new THREE.Box3(size.clone().multiplyScalar(-0.5).addScalar(-2), size.clone().multiplyScalar(0.5).addScalar(2));
    this.reticle = bracketBox(local, this.palette.accentLine);
    this.overlay.add(this.reticle);
    if (focus && config.followSelection) this.focusOn(sel);
    if (changed) this.emit('select', sel);
  }

  focusOn(sel) {
    const box = this.boxOf(sel, new THREE.Box3());
    if (!box) return;
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(60, Math.max(size.x, size.y * 1.1) / 2 + (sel.type === 'container' || sel.type === 'tip' ? 70 : 40));
    const position = new THREE.Vector3();
    // aim a little above the element: the upper part of the screen is covered by the HUD
    // (on a phone the inspector is a bottom sheet, so there the element goes to the upper half)
    const shift = isSmallScreen() ? -0.75 : 0.3;
    this.rig.focus(() => { this.centreOf(sel, position); position.y += radius * shift; return position; }, radius);
  }

  /** Frames two things at once (the two ends of a transfer). */
  focusPair(a, b) {
    if (!this.exists(a) || !this.exists(b)) { if (this.exists(a)) this.focusOn(a); else if (this.exists(b)) this.focusOn(b); return; }
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), mid = new THREE.Vector3();
    this.centreOf(a, pa); this.centreOf(b, pb);
    const radius = Math.max(120, pa.distanceTo(pb) / 2 + 110);
    this.rig.focus(() => { this.centreOf(a, pa); this.centreOf(b, pb); return mid.copy(pa).lerp(pb, 0.5); }, radius);
  }

  /**
   * Small 3D portrait of a cargo (data URL), optionally with one container marked.
   * Rendered off-screen with only that cargo visible.
   */
  thumbnail(cargoId, markSel = null, width = 176, height = 132) {
    const view = this.views.cargo.get(cargoId);
    if (!view) return null;
    this.thumbs = this.thumbs || new Map();
    const key = `${cargoId}:${markSel ? `${markSel.type}${markSel.id}` : ''}:${view.contentVersion}:${config.worldTheme}`;
    if (this.thumbs.has(key)) return this.thumbs.get(key);
    if (this.thumbs.size > 300) this.thumbs.clear();

    const LAYER = 1;
    if (!this.thumbTarget) {
      this.thumbTarget = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
      this.thumbCamera = new THREE.PerspectiveCamera(26, width / height, 10, 5000);
      this.thumbCamera.layers.set(LAYER);
      this.thumbCanvas = document.createElement('canvas');
      this.thumbCanvas.width = width;
      this.thumbCanvas.height = height;
      for (const light of [this.hemi, this.key, this.fill]) light.layers.enable(LAYER);
    }
    const marker = new THREE.Group();
    if (markSel) {
      const top = this.topOf(markSel, new THREE.Vector3());
      if (top) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(markSel.type === 'container' ? Math.max(6, (this.boxOf(markSel, new THREE.Box3()).max.x - this.boxOf(markSel, new THREE.Box3()).min.x) / 2 + 2) : 6, 1.6, 8, 32), this.palette.accent);
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(top).setY(top.y + 3);
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(7, 18, 4), this.palette.accent);
        arrow.rotation.x = Math.PI;
        arrow.position.copy(top).setY(top.y + 24);
        marker.add(ring, arrow);
        this.scene.add(marker);
      }
    }
    const touched = [];
    const enable = (object) => { object.traverse((child) => { child.layers.enable(LAYER); touched.push(child); }); };
    enable(view.group);
    enable(marker);
    const box = view.getBox(new THREE.Box3());
    const centre = box.getCenter(new THREE.Vector3());
    this.thumbCamera.position.set(centre.x - 150, centre.y + 250, centre.z + 430);
    this.thumbCamera.lookAt(centre.x, centre.y + 4, centre.z);
    const { renderer } = this;
    const previousTarget = renderer.getRenderTarget();
    const background = this.scene.background, fog = this.scene.fog;
    this.scene.background = null;
    this.scene.fog = null;
    renderer.setRenderTarget(this.thumbTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.thumbCamera);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(this.thumbTarget, 0, 0, width, height, pixels);
    renderer.setRenderTarget(previousTarget);
    this.scene.background = background;
    this.scene.fog = fog;
    for (const child of touched) child.layers.disable(LAYER);
    disposeTree(marker);

    const ctx = this.thumbCanvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4, dst = y * width * 4;
      for (let i = 0; i < width * 4; i += 4) {
        // linear render target -> sRGB for the 2D canvas
        image.data[dst + i] = 255 * Math.pow(pixels[src + i] / 255, 1 / 2.2);
        image.data[dst + i + 1] = 255 * Math.pow(pixels[src + i + 1] / 255, 1 / 2.2);
        image.data[dst + i + 2] = 255 * Math.pow(pixels[src + i + 2] / 255, 1 / 2.2);
        image.data[dst + i + 3] = pixels[src + i + 3];
      }
    }
    ctx.putImageData(image, 0, 0);
    const url = this.thumbCanvas.toDataURL('image/png');
    this.thumbs.set(key, url);
    return url;
  }

  // ------------------------------------------------------------------ beacons, arcs, labels

  /** items: [{ sel, kind: manual|from|to|hover, text? }] */
  setBeacons(group, items) {
    const signature = items.map((item) => `${item.sel.type}:${item.sel.id}:${item.kind}:${item.text || ''}`).join('|');
    this.beaconSignatures = this.beaconSignatures || new Map();
    if (this.beaconSignatures.get(group) === signature) return;
    this.beaconSignatures.set(group, signature);
    for (const [key, beacon] of this.beacons) {
      if (beacon.groupName !== group) continue;
      disposeTree(beacon.object);
      this.palette.forget(beacon.beam.material);
      this.palette.forget(beacon.ring.material);
      beacon.pointer.material.dispose();
      this.removeLabel(key);
      this.beacons.delete(key);
    }
    items.forEach((item, index) => {
      if (!this.exists(item.sel)) return;
      const which = BEACON_KIND[item.kind] || 'accent';
      const object = new THREE.Group();
      const small = item.sel.type === 'container' || item.sel.type === 'tip';
      const radius = small ? 16 : 70;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, 260, 24, 1, true), this.palette.beam(which));
      beam.position.y = 130;
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(radius * 4.4, radius * 4.4), this.palette.textured(this.runeTexture, which, 1));
      ring.material.userData.level = 1;
      this.palette.tint(ring.material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 2;
      const pointer = new THREE.Mesh(new THREE.ConeGeometry(small ? 7 : 16, small ? 20 : 44, 4), this.palette[which === 'accent2' ? 'accent2' : which === 'warn' ? 'warn' : 'accent']);
      pointer.rotation.x = Math.PI;
      object.add(beam, ring, pointer);
      // a beacon has to be seen through shelves and cargo
      for (const part of [beam, ring, pointer]) {
        if (part === pointer) part.material = part.material.clone();
        part.material.depthTest = false;
        part.renderOrder = 20;
      }
      this.overlay.add(object);
      const key = `${group}:${index}`;
      this.beacons.set(key, { groupName: group, object, beam, ring, pointer, sel: item.sel, small });
      if (item.text) {
        const el = document.createElement('div');
        el.className = `world-label beacon-label beacon-${item.kind}`;
        el.textContent = item.text;
        this.addLabel(key, el, (target) => { const top = this.topOf(item.sel, target); if (top) top.y += small ? 66 : 120; return top; });
      }
    });
  }

  setArc(from, to) {
    if (this.arc) {
      disposeTree(this.arc.mesh);
      this.palette.forget(this.arc.mesh.material);
      this.arc = null;
    }
    if (!from || !to || !this.exists(from) || !this.exists(to)) return;
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.palette.flow('accent', 10));
    mesh.frustumCulled = false;
    this.overlay.add(mesh);
    this.arc = { from, to, mesh, a: new THREE.Vector3(1e9, 0, 0), b: new THREE.Vector3() };
  }

  updateArc() {
    const arc = this.arc;
    if (!arc) return;
    const a = this.topOf(arc.from, new THREE.Vector3()), b = this.topOf(arc.to, new THREE.Vector3());
    if (!a || !b) return;
    if (a.distanceTo(arc.a) < 1.5 && b.distanceTo(arc.b) < 1.5) return;
    arc.a.copy(a); arc.b.copy(b);
    const span = a.distanceTo(b);
    const mid = a.clone().lerp(b, 0.5);
    mid.y = Math.max(a.y, b.y) + Math.max(70, span * 0.3);
    mid.z += 50;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    arc.mesh.geometry.dispose();
    arc.mesh.geometry = new THREE.TubeGeometry(curve, 48, Math.max(1.4, Math.min(4, span * 0.006 + 1.2)), 6, false);
    arc.mesh.material.uniforms.uRepeat.value = Math.max(4, span / 26);
  }

  /** Screen-space HTML label that follows a world position. `position(target)` returns a Vector3 or null. */
  addLabel(key, el, position, options = {}) {
    this.removeLabel(key);
    this.labelRoot.append(el);
    this.labels.set(key, { el, position, options, vec: new THREE.Vector3() });
  }

  removeLabel(key) {
    const label = this.labels.get(key);
    if (!label) return;
    label.el.remove();
    this.labels.delete(key);
  }

  removeLabels(prefix) {
    for (const key of [...this.labels.keys()]) if (key.startsWith(prefix)) this.removeLabel(key);
  }

  updateLabels() {
    const { width, height } = this.size;
    for (const label of this.labels.values()) {
      const pos = label.position(label.vec);
      if (!pos) { label.el.style.display = 'none'; continue; }
      const distance = this.camera.position.distanceTo(pos);
      pos.project(this.camera);
      const x = (pos.x * 0.5 + 0.5) * width, y = (-pos.y * 0.5 + 0.5) * height;
      if (pos.z > 1 || x < -200 || x > width + 200 || y < -200 || y > height + 200) { label.el.style.display = 'none'; continue; }
      label.el.style.display = '';
      label.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      const lod = distance < 900 ? 'near' : distance < 2200 ? 'mid' : 'far';
      if (label.el.dataset.lod !== lod) label.el.dataset.lod = lod;
      label.el.style.zIndex = String(100000 - Math.round(distance));
    }
  }

  // ------------------------------------------------------------------ loop

  start() {
    let last = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (this.paused) return;
      this.tick(dt);
    };
    requestAnimationFrame(frame);
  }

  tick(dt) {
    this.time += dt;
    this.palette.time.value = this.time;
    this.store.update(dt);
    for (const view of this.views.conveyor.values()) view.update(dt, this.time);
    for (const view of this.views.pipetter.values()) view.update(dt, this.time);
    for (const view of this.views.cargo.values()) view.update(dt, this.time);
    for (const fn of this.updaters) fn(dt, this.time);

    if (this.reticle && this.selection) {
      const box = this.boxOf(this.selection, this._box2 || (this._box2 = new THREE.Box3()));
      if (box) {
        box.getCenter(this.reticle.position);
        this.reticle.scale.setScalar(1 + Math.sin(this.time * 3.2) * 0.012);
      }
    }
    const top = this._top || (this._top = new THREE.Vector3());
    for (const beacon of this.beacons.values()) {
      const pos = this.topOf(beacon.sel, top);
      beacon.object.visible = !!pos;
      if (!pos) continue;
      beacon.object.position.copy(pos);
      beacon.ring.rotation.z = this.time * 0.8;
      beacon.pointer.position.y = (beacon.small ? 34 : 70) + Math.sin(this.time * 4) * (beacon.small ? 6 : 12);
      beacon.pointer.rotation.y = this.time * 2;
    }
    this.updateArc();

    this.rig.update(dt);
    const target = this.rig.pose.target;
    this.key.position.set(target.x - 900, target.y + 1300, 2200);
    this.key.target.position.copy(target);
    this.fill.position.set(target.x + 1400, target.y - 300, 900);
    this.fill.target.position.copy(target);
    this.board.update(this.camera, target, this.time);
    this.dust.position.y = Math.sin(this.time * 0.07) * 60;
    this.dust.position.x = Math.cos(this.time * 0.05) * 40;

    if (this.hoverPoint && !this.rig.pointers.size) {
      this.setHover(this.pickAt(this.hoverPoint.x, this.hoverPoint.y));
      this.hoverPoint = null;
    }

    if (this.useBloom) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.emit('frame', dt);
    this.measure(dt);
  }

  /** In auto quality, give up bloom when the machine cannot keep up. */
  measure(dt) {
    const fps = this.fps;
    fps.frames += 1;
    fps.time += dt;
    if (fps.time < 1) return;
    fps.value = fps.frames / fps.time;
    fps.frames = 0;
    fps.time = 0;
    if (config.quality !== 'auto' || !this.useBloom) return;
    fps.slow = fps.value < 24 ? fps.slow + 1 : 0;
    if (fps.slow >= 4) { this.useBloom = false; this.maxPixelRatio = 1.5; this.resize(); this.emit('quality', 'low'); }
  }
}

export { DIM };
