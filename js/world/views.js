// 3D views of the warehouse elements. By default every element is a plain rectangle placed at its
// database position; a prefab assigned in the configuration replaces the rectangle.

import * as THREE from 'three';
import { DIM } from './themes.js';
import { textTexture } from './palette.js';
import { buildContainer, buildHousing, buildTip, disposeTree, specForType, wireBox } from './shapes.js';
import { buildPrefab, collectionOf } from './prefabs.js';
import { config, getAssignment } from '../core/config.js';
import { CARGO_WIDTH } from '../shared/kinematics.js';
import { materialHazards, materialTint } from '../shared/material.js';
import { damp } from '../core/util.js';

const { BELT_Z0: Z0, BELT_DEPTH: D, BELT_THICK: T, CARGO_Z0, CARGO_DEPTH, CARGO_BASE } = DIM;

let shadowTexture = null;
function shadowMaterial() {
  if (!shadowTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(0,0,0,0.75)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    shadowTexture = new THREE.CanvasTexture(canvas);
  }
  return new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.55 });
}
let sharedShadow = null;
function shadow(width, height) {
  sharedShadow = sharedShadow || shadowMaterial();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), sharedShadow);
  mesh.renderOrder = -5;
  return mesh;
}

function plate(text, palette, height, which = 'accent') {
  const texture = textTexture(text);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * texture.userData.aspect, height), palette.textured(texture, which, 0.95));
  mesh.userData.ownTexture = true;
  return mesh;
}

class View {
  constructor(world, type, id) {
    this.world = world;
    this.type = type;
    this.id = id;
    this.group = new THREE.Group();
    this.defaults = new THREE.Group();
    this.model = null;
  }

  tagPick(object, pick = { type: this.type, id: this.id }) {
    object.traverse((child) => { if (child.isMesh && !child.userData.pick) child.userData.pick = pick; });
  }

  /** Shows the prefab assigned to this element (if any) in `anchor`. */
  applyAssignment(anchor, ctx = {}) {
    if (this.model) { disposeTree(this.model); this.model = null; }
    const assignment = getAssignment(this.type, this.id);
    const prefab = assignment && config.prefabs[assignment.prefab];
    this.prefab = prefab || null;
    this.defaults.visible = !(prefab && prefab.hideDefault);
    if (!prefab) return;
    this.model = new THREE.Group();
    this.model.position.fromArray(assignment.offset || [0, 0, 0]);
    const [rx, ry, rz] = assignment.rotation || [0, 0, 0];
    this.model.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz));
    this.model.scale.setScalar(assignment.scale || 1);
    this.model.add(buildPrefab(prefab, this.world.palette, {
      ...ctx, onLoad: (part) => { this.tagPick(part); this.world.pickablesDirty = true; },
    }));
    this.tagPick(this.model);
    anchor.add(this.model);
    this.world.pickablesDirty = true;
  }

  dispose() {
    const palette = this.world.palette;
    this.group.traverse((child) => { if (child.material) palette.forget(child.material); });
    disposeTree(this.group);
  }
}

// ---------------------------------------------------------------------------------------- conveyor

export class ConveyorView extends View {
  constructor(world, conv) {
    super(world, 'conveyor', conv.id);
    const { palette, store } = world;
    const L = conv.lenX;
    const which = conv.storage ? 'accent2' : 'accent';
    this.conv = conv;
    this.isLift = conv.ym != null;
    this.active = 0;
    this.liftActive = 0;
    this.dir = 1;
    this.markerBoxes = new Map();
    this.group.position.set(conv.x, 0, 0);
    this.carriage = new THREE.Group();
    this.carriage.position.y = conv.y;
    this.carriage.add(this.defaults);
    this.group.add(this.carriage);

    const body = new THREE.Mesh(new THREE.BoxGeometry(L, T, D), palette.metal);
    body.position.set(L / 2, -T / 2 - 0.5, Z0 + D / 2);
    this.beltMaterial = palette.belt(L, conv.storage);
    const belt = new THREE.Mesh(new THREE.PlaneGeometry(L, D - 6), this.beltMaterial);
    belt.rotation.x = -Math.PI / 2;
    belt.position.set(L / 2, 0, Z0 + D / 2);
    this.stripMaterial = palette.accentInstance(which);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(L - 6, 2.2, 2), this.stripMaterial);
    strip.position.set(L / 2, -2.4, Z0 + D + 0.6);
    this.holoMaterial = palette.holo(L, T - 6, which);
    const holo = new THREE.Mesh(new THREE.PlaneGeometry(L, T - 6), this.holoMaterial);
    holo.position.set(L / 2, -T / 2 - 2, Z0 + D + 2);
    this.defaults.add(body, belt, strip, holo);
    for (const x of [0, L]) {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(T / 2 + 1, T / 2 + 1, D + 5, 18), palette.metalLight);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(x, -T / 2 - 0.5, Z0 + D / 2);
      this.defaults.add(roller);
    }
    // hooks into the pegboard
    const hooks = Math.max(1, Math.round(L / 280));
    for (let i = 0; i < hooks; i++) {
      const x = hooks === 1 ? L / 2 : 40 + ((L - 80) * i) / (hooks - 1);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(14, 10, Z0 + 4), palette.metal);
      arm.position.set(x, -T / 2 - 2, Z0 / 2);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(24, 52, 3.5), palette.metalLight);
      hook.position.set(x, -T / 2 + 6, 1.8);
      this.defaults.add(arm, hook);
    }
    const tag = plate(`CV-${String(conv.id).padStart(2, '0')}`, palette, 9, which);
    tag.position.set(L - 26, -T / 2 - 1, Z0 + D + 2.6);
    const blob = shadow(L + 140, 150);
    blob.position.set(L / 2, -T - 18, 0.8);
    this.carriage.add(tag, blob);

    if (this.isLift) {
      const height = conv.lenY + 120, base = conv.y - 50;
      for (const x of [12, L - 12]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(14, height, 20), palette.metal);
        rail.position.set(x, base + height / 2, 12);
        this.group.add(rail);
      }
      for (const y of [base, base + height]) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(L + 12, 12, 28), palette.metalLight);
        cap.position.set(L / 2, y, 14);
        this.group.add(cap);
      }
      this.spineMaterial = palette.accentInstance('accent2');
      const spine = new THREE.Mesh(new THREE.BoxGeometry(3, height - 12, 2), this.spineMaterial);
      spine.position.set(L / 2, base + height / 2, 3);
      this.liftHolo = palette.holo(height, 40, 'accent2');
      const flow = new THREE.Mesh(new THREE.PlaneGeometry(height, 40), this.liftHolo);
      flow.rotation.z = Math.PI / 2;
      flow.position.set(L / 2, base + height / 2, 5);
      const back = new THREE.Mesh(new THREE.BoxGeometry(L - 30, 34, Z0 - 6), palette.metal);
      back.position.set(L / 2, -T / 2, (Z0 - 6) / 2 + 4);
      this.defaults.add(back);
      const liftShadow = shadow(L + 160, height + 160);
      liftShadow.position.set(L / 2, base + height / 2, 0.6);
      this.group.add(spine, flow, liftShadow);
    }

    // dead zones and calibrators that belong to this conveyor
    for (const zone of store.deadzones.filter((z) => z.conveyorId === conv.id)) {
      const width = Math.max(4, zone.end - zone.start);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, D - 6), palette.zone);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(zone.start + width / 2, 0.8, Z0 + D / 2);
      mesh.userData.pick = { type: 'deadzone', id: zone.id };
      const frame = wireBox(width, 3, D - 6, palette.warnLine);
      frame.position.set(zone.start + width / 2, 1.5, Z0 + D / 2);
      this.carriage.add(mesh, frame);
      this.markerBoxes.set(`deadzone:${zone.id}`, new THREE.Box3(new THREE.Vector3(zone.start, -4, Z0), new THREE.Vector3(zone.end, 30, Z0 + D)));
    }
    for (const cal of store.calibrators.filter((c) => c.conveyorId === conv.id)) {
      const vertical = cal.up != null || cal.down != null;
      const sensor = new THREE.Mesh(new THREE.BoxGeometry(10, 22, 10), palette.metalLight);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), palette.accent2);
      const offset = Number(cal.left ?? cal.right ?? cal.up ?? cal.down ?? 0);
      let box;
      if (vertical) {
        sensor.position.set(-12, conv.y + offset + 4, 26);
        eye.position.set(-12, conv.y + offset + 4, 32);
        this.group.add(sensor, eye);
        box = new THREE.Box3(new THREE.Vector3(-20, offset - 10, 18), new THREE.Vector3(-4, offset + 18, 36));
        box.userData = { static: true, y: conv.y };
      } else {
        sensor.position.set(offset, 12, Z0 + D + 7);
        eye.position.set(offset, 12, Z0 + D + 1.5);
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, D), palette.accent2Dim);
        beam.position.set(offset, 12, Z0 + D / 2);
        this.carriage.add(sensor, eye, beam);
        box = new THREE.Box3(new THREE.Vector3(offset - 8, 0, Z0), new THREE.Vector3(offset + 8, 26, Z0 + D + 14));
      }
      sensor.userData.pick = eye.userData.pick = { type: 'calibrator', id: cal.id };
      this.markerBoxes.set(`calibrator:${cal.id}`, box);
    }

    this.tagPick(this.group);
    this.applyAssignment(this.carriage, { ownerLength: L });
  }

  update(dt) {
    const { store, palette } = this.world;
    const conv = this.conv;
    this.carriage.position.y = store.conveyorY(conv.id);
    const vx = conv.xm != null ? store.motorVelocity(conv.xm) : 0;
    if (Math.abs(vx) > 1) this.dir = Math.sign(vx);
    this.active = damp(this.active, Math.abs(vx) > 1 ? 1 : 0, 8, dt);
    this.beltMaterial.uniforms.uOffset.value = conv.xm != null ? store.motorValue(conv.xm) : 0;
    this.beltMaterial.uniforms.uActive.value = this.active;
    this.beltMaterial.uniforms.uDir.value = this.dir;
    this.holoMaterial.uniforms.uActive.value = this.active;
    this.holoMaterial.uniforms.uDir.value = this.dir;
    palette.setLevel(this.stripMaterial, 0.16 + 0.84 * this.active);
    if (this.isLift) {
      const vy = store.motorVelocity(conv.ym);
      if (Math.abs(vy) > 1) this.liftDir = Math.sign(vy);
      this.liftActive = damp(this.liftActive, Math.abs(vy) > 1 ? 1 : 0, 8, dt);
      this.liftHolo.uniforms.uActive.value = this.liftActive;
      this.liftHolo.uniforms.uDir.value = this.liftDir || 1;
      palette.setLevel(this.spineMaterial, 0.2 + 0.8 * this.liftActive);
    }
  }

  getBox(target = new THREE.Box3()) {
    const conv = this.conv;
    if (this.isLift) {
      target.min.set(conv.x - 6, conv.y - 56, 0);
      target.max.set(conv.x + conv.lenX + 6, conv.y + conv.lenY + 76, Z0 + D + 4);
    } else {
      const y = this.carriage.position.y;
      target.min.set(conv.x - T / 2, y - T - 2, 0);
      target.max.set(conv.x + conv.lenX + T / 2, y + 3, Z0 + D + 4);
    }
    return target;
  }

  markerBox(key, target = new THREE.Box3()) {
    const box = this.markerBoxes.get(key);
    if (!box) return this.getBox(target);
    const y = box.userData?.static ? box.userData.y : this.carriage.position.y;
    target.copy(box).translate(new THREE.Vector3(this.conv.x, y, 0));
    return target;
  }
}

// ------------------------------------------------------------------------------------------- cargo

export class CargoView extends View {
  constructor(world, cargo) {
    super(world, 'cargo', cargo.id);
    const { palette, store } = world;
    const W = CARGO_WIDTH;
    this.cargo = cargo;
    this.items = new Map();
    this.tipItems = new Map();
    this.gems = [];
    this.signatures = new Map();
    this.topY = CARGO_BASE;
    this.level = 0.2;

    const base = new THREE.Mesh(new THREE.BoxGeometry(W - 1, CARGO_BASE, CARGO_DEPTH), palette.cargo);
    base.position.set(W / 2, CARGO_BASE / 2, CARGO_DEPTH / 2);
    this.lipMaterial = palette.accentInstance('accent');
    const lip = new THREE.Mesh(new THREE.BoxGeometry(W - 1, 1.8, 1.8), this.lipMaterial);
    lip.position.set(W / 2, CARGO_BASE - 0.9, CARGO_DEPTH + 0.3);
    const tag = plate(store.cargoTag(cargo.id), palette, 8.5);
    tag.position.set(22, CARGO_BASE / 2 - 0.6, CARGO_DEPTH + 0.5);
    this.defaults.add(base, lip, tag);
    this.housings = new THREE.Group();
    this.housings.position.y = CARGO_BASE;
    this.defaults.add(this.housings);
    this.content = new THREE.Group();
    this.content.position.y = CARGO_BASE;
    this.group.add(this.defaults, this.content);

    // a prefab with a collection part defines shape and housing, otherwise they follow the type
    const assignment = getAssignment('cargo', cargo.id);
    const override = collectionOf(assignment && config.prefabs[assignment.prefab]);
    const byType = new Map();
    for (const c of store.containersByCargo.get(cargo.id) || []) {
      if (!byType.has(c.type)) byType.set(c.type, { spec: override || specForType(c.type, c.maxVolume), list: [] });
      byType.get(c.type).list.push(c);
    }
    for (const { spec, list } of byType.values()) {
      if (!override) {
        const housing = buildHousing(spec, list, palette);
        if (housing) this.housings.add(housing);
      }
      for (const c of list) {
        const item = buildContainer(spec, palette);
        item.group.position.set(c.x, 0, c.z);
        this.tagPick(item.group, { type: 'container', id: c.id });
        this.content.add(item.group);
        this.items.set(c.id, item);
        this.gems.push(item.gem);
        this.topY = Math.max(this.topY, CARGO_BASE + item.top);
      }
    }
    const tips = store.tipsByCargo.get(cargo.id) || [];
    if (tips.length) {
      const spec = override || specForType('Tip 1000', 1000);
      if (!override) {
        const housing = buildHousing(spec, tips, palette);
        if (housing) this.housings.add(housing);
      }
      for (const t of tips) {
        const item = buildTip(spec, palette);
        item.group.position.set(t.x, 0, t.z);
        this.tagPick(item.group, { type: 'tip', id: t.id });
        this.content.add(item.group);
        this.tipItems.set(t.id, item);
        this.topY = Math.max(this.topY, CARGO_BASE + item.top);
      }
    }

    // motion indicator: chevrons that run in the direction of travel
    this.marker = new THREE.Group();
    this.marker.position.set(W / 2, this.topY + 30, CARGO_DEPTH / 2);
    this.cones = [0, 1, 2].map(() => {
      const cone = new THREE.Mesh(CargoView.coneGeometry(), palette.accent);
      this.marker.add(cone);
      return cone;
    });
    this.marker.visible = false;
    this.group.add(this.marker);

    // where the current move will put the cargo
    this.ghost = wireBox(W, Math.max(CARGO_BASE, this.topY * 0.6), CARGO_DEPTH, palette.accentLine);
    this.ghost.visible = false;
    this.ghostHeight = Math.max(CARGO_BASE, this.topY * 0.6);
    this.link = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), palette.accentLine);
    this.link.visible = false;
    this.link.frustumCulled = false;
    world.overlay.add(this.ghost, this.link);

    this.tagPick(this.group);
    this.applyAssignment(this.group);
    this.refresh();
    this.update(0, 0);
  }

  static coneGeometry() {
    CargoView.cone = CargoView.cone || new THREE.ConeGeometry(7, 18, 4);
    return CargoView.cone;
  }

  /** Brings fill levels, lids, tips and hazard marks in line with the latest snapshot. */
  refresh() {
    const { store } = this.world;
    for (const [id, item] of this.items) {
      const c = store.containers.get(id);
      if (!c) continue;
      const material = store.materialOf(c);
      const volume = store.volumeOf(c);
      const tint = materialTint(material, store.lookup);
      const hazard = materialHazards(material, store.lookup).length > 0;
      const signature = `${volume.toFixed(1)}|${c.closed}|${tint ? `${tint.h}:${tint.s}` : ''}|${hazard}`;
      if (this.signatures.get(id) === signature) continue;
      this.signatures.set(id, signature);
      this.contentVersion = (this.contentVersion || 0) + 1;
      item.setState({ fill: c.maxVolume > 0 ? volume / c.maxVolume : 0, tint, closed: c.closed, hazard });
    }
    for (const [id, item] of this.tipItems) {
      const t = store.tips.get(id);
      if (!t) continue;
      const signature = `${t.hasTip}|${t.sterile}`;
      if (this.signatures.get(`t${id}`) === signature) continue;
      this.signatures.set(`t${id}`, signature);
      this.contentVersion = (this.contentVersion || 0) + 1;
      item.setState(t);
    }
  }

  update(dt, time) {
    const { store, palette } = this.world;
    const pos = store.cargoPosition(this.id);
    this.group.position.set(pos.x, pos.y, CARGO_Z0);
    const display = store.cargoDisplay.get(this.id);
    const moving = !!display?.moving;
    this.level = damp(this.level, moving ? 1 : this.selected ? 0.75 : 0.2, 8, dt || 0.016);
    palette.setLevel(this.lipMaterial, this.level);
    for (const gem of this.gems) if (gem.visible) gem.rotation.y = time * 1.6;

    this.marker.visible = moving;
    if (moving) {
      const horizontal = Math.abs(display.vx) >= Math.abs(display.vy);
      const dx = horizontal ? Math.sign(display.vx) : 0, dy = horizontal ? 0 : Math.sign(display.vy);
      this.cones.forEach((cone, i) => {
        const s = (time * 1.5 + i / 3) % 1;
        cone.position.set(dx * (s - 0.5) * 70, dy * (s - 0.5) * 70, 0);
        cone.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
        cone.scale.setScalar(0.25 + Math.sin(s * Math.PI) * 0.95);
      });
    }

    const dest = store.cargoDestination(this.id);
    const far = dest && Math.hypot(dest.x - pos.x, dest.y - pos.y) > 6;
    this.ghost.visible = this.link.visible = !!far;
    if (far) {
      this.ghost.position.set(dest.x + CARGO_WIDTH / 2, dest.y + this.ghostHeight / 2, CARGO_Z0 + CARGO_DEPTH / 2);
      const points = this.link.geometry.attributes.position;
      points.setXYZ(0, pos.x + CARGO_WIDTH / 2, pos.y + this.ghostHeight / 2, CARGO_Z0 + CARGO_DEPTH + 2);
      points.setXYZ(1, dest.x + CARGO_WIDTH / 2, dest.y + this.ghostHeight / 2, CARGO_Z0 + CARGO_DEPTH + 2);
      points.needsUpdate = true;
    }
  }

  getBox(target = new THREE.Box3()) {
    const p = this.group.position;
    target.min.set(p.x, p.y, p.z);
    target.max.set(p.x + CARGO_WIDTH, p.y + this.topY, p.z + CARGO_DEPTH);
    return target;
  }

  /** World position of the top of a container / tip on this cargo. */
  itemPosition(kind, id, target = new THREE.Vector3()) {
    const item = (kind === 'tip' ? this.tipItems : this.items).get(id);
    if (!item) return this.group.position.clone();
    return target.copy(item.group.position).add(this.group.position).add(new THREE.Vector3(0, CARGO_BASE + item.top, 0));
  }

  itemBox(kind, id, target = new THREE.Box3()) {
    const item = (kind === 'tip' ? this.tipItems : this.items).get(id);
    if (!item) return this.getBox(target);
    const store = this.world.store;
    const c = kind === 'tip' ? null : store.containers.get(id);
    const spec = c ? specForType(c.type, c.maxVolume) : specForType('Tip 1000', 1000);
    const r = spec.diameter / 2 + 1.5;
    const p = this.group.position, q = item.group.position;
    const low = spec.shape === 'well' || kind === 'tip' ? item.top - 4 : 0;
    target.min.set(p.x + q.x - r, p.y + CARGO_BASE + low, p.z + q.z - r);
    target.max.set(p.x + q.x + r, p.y + CARGO_BASE + item.top + 2, p.z + q.z + r);
    return target;
  }

  dispose() {
    disposeTree(this.ghost);
    disposeTree(this.link);
    super.dispose();
  }
}

// ---------------------------------------------------------------------------------------- pipetter

const NOZZLE = 96, HEAD = 46;

export class PipetterView extends View {
  constructor(world, pipetter) {
    super(world, 'pipetter', pipetter.id);
    const { palette } = world;
    const p = pipetter;
    this.pipetter = p;
    this.active = 0;
    this.group.position.set(p.x, 0, 0);
    const reach = p.lenZ + CARGO_Z0 + 34;
    const columnHeight = p.lenY + NOZZLE + HEAD + 70;

    const column = new THREE.Mesh(new THREE.BoxGeometry(56, columnHeight, 20), palette.metal);
    column.position.set(0, p.y + columnHeight / 2 - 10, 12);
    const rails = [-20, 20].map((x) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(6, columnHeight - 16, 6), palette.metalLight);
      rail.position.set(x, p.y + columnHeight / 2 - 10, 24);
      return rail;
    });
    const tag = plate(`PIP-${String(p.id).padStart(2, '0')}`, palette, 10);
    tag.position.set(0, p.y + columnHeight - 4, 23);
    this.defaults.add(column, ...rails, tag);

    // the arcane part: a rune circle on the wall that spins up while the pipetter works
    this.rune = new THREE.Mesh(new THREE.PlaneGeometry(380, 380), palette.textured(world.runeTexture, 'accent', 0.5));
    this.rune.position.set(0, p.y + p.lenY * 0.5 + 40, 1.4);
    this.runeInner = new THREE.Mesh(new THREE.PlaneGeometry(210, 210), palette.textured(world.runeTexture, 'accent2', 0.4));
    this.runeInner.position.copy(this.rune.position).setZ(1.8);
    const blob = shadow(260, columnHeight + 120);
    blob.position.set(0, p.y + columnHeight / 2, 0.7);
    this.group.add(blob, this.rune, this.runeInner);

    this.carriage = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(36, 20, reach), palette.metalLight);
    arm.position.set(0, 10, reach / 2 + 18);
    this.carriage.add(arm);
    this.head = new THREE.Group();
    const block = new THREE.Mesh(new THREE.BoxGeometry(44, HEAD, 36), palette.metal);
    this.headMaterial = palette.accentInstance('accent');
    const window = new THREE.Mesh(new THREE.BoxGeometry(45, 7, 14), this.headMaterial);
    window.position.y = 8;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 40, 16), palette.metalLight);
    barrel.position.y = -HEAD / 2 - 20;
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 1.4, NOZZLE - 40, 12), palette.glass);
    nozzle.position.y = -HEAD / 2 - 40 - (NOZZLE - 40) / 2;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.7, NOZZLE - 40, 8), this.headMaterial);
    core.position.copy(nozzle.position);
    const emitter = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 8), palette.accent);
    emitter.position.y = -HEAD / 2 - NOZZLE;
    this.plunger = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 34, 12), palette.accent2Dim);
    this.head.add(block, window, barrel, core, nozzle, emitter, this.plunger);
    this.carriage.add(this.head);
    this.defaults.add(this.carriage);
    this.group.add(this.defaults);

    this.tagPick(this.group);
    this.model = null;
    this.anchor = new THREE.Group();
    this.anchor.position.y = p.y;
    this.group.add(this.anchor);
    this.applyAssignment(this.anchor);
    this.update(0, 0);
  }

  update(dt) {
    const { store, palette } = this.world;
    const p = this.pipetter;
    const yv = p.ym != null ? store.motorValue(p.ym) : 0;
    const zv = p.zm != null ? store.motorValue(p.zm) : 0;
    const pv = p.pm != null ? store.motorValue(p.pm) : 0;
    this.carriage.position.y = p.y + p.lenY - yv + NOZZLE + HEAD / 2;
    this.head.position.z = CARGO_Z0 + zv;
    this.plunger.position.y = HEAD / 2 + 16 - Math.max(-14, Math.min(14, pv * 0.35));
    const speed = Math.abs(p.ym != null ? store.motorVelocity(p.ym) : 0) + Math.abs(p.zm != null ? store.motorVelocity(p.zm) : 0)
      + Math.abs(p.pm != null ? store.motorVelocity(p.pm) : 0) * 4;
    this.active = damp(this.active, speed > 1 ? 1 : 0, 5, dt || 0.016);
    this.rune.rotation.z += (0.05 + this.active * 0.9) * (dt || 0);
    this.runeInner.rotation.z -= (0.09 + this.active * 1.4) * (dt || 0);
    palette.setLevel(this.headMaterial, 0.3 + 0.7 * this.active);
    palette.setLevel(this.rune.material, 0.25 + 0.6 * this.active);
    palette.setLevel(this.runeInner.material, 0.25 + 0.6 * this.active);
  }

  getBox(target = new THREE.Box3()) {
    const p = this.pipetter;
    target.min.set(p.x - 40, p.y - 20, 0);
    target.max.set(p.x + 40, p.y + p.lenY + NOZZLE + HEAD + 60, CARGO_Z0 + p.lenZ + 40);
    return target;
  }
}
