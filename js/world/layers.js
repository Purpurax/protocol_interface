// Layer modes of the world: normal, labeled, touch (anchors), prediction (time scrubbing), setup.

import * as THREE from 'three';
import { h, clear, fmtClock, fmtDuration, fill } from '../core/util.js';
import { config, getAssignment } from '../core/config.js';
import { buildSchedule, simulateTimeline } from '../core/predict.js';
import { CARGO_WIDTH, STATUS } from '../shared/kinematics.js';
import { fmtVolume, isEmptyMaterial, materialHazards, materialLabel } from '../shared/material.js';
import { hazardBadges, icon } from '../ui/icons.js';
import { DIM } from './themes.js';
import { bracketBox, disposeTree, wireBox } from './shapes.js';

const { CARGO_Z0, CARGO_DEPTH, CARGO_BASE, BELT_Z0, BELT_DEPTH } = DIM;

export class LayerManager {
  constructor(app) {
    this.app = app;
    this.world = app.world;
    this.store = app.store;
    this.name = 'normal';
    this.objects = []; // three objects owned by the current layer
    this.frame = null; // per-frame callback of the current layer
    this.preview = null; // { name, instructions } a protocol plan shown in the prediction layer
    this.time = 0;
    this.playing = false;
    this.rate = 4;
    this.timelineEl = document.getElementById('timeline');
    this.world.updaters.add((dt) => this.frame?.(dt));
    this.store.on('snapshot', () => this.refresh());
    this.world.on('rebuilt', () => this.set(this.name));
  }

  set(name) {
    this.teardown();
    this.name = name;
    document.body.dataset.layer = name;
    if (name === 'labeled') this.buildLabeled();
    else if (name === 'touch') this.buildTouch();
    else if (name === 'prediction') this.buildPrediction();
    else if (name === 'setup') this.buildSetup();
  }

  teardown() {
    for (const object of this.objects) disposeTree(object);
    this.objects = [];
    this.frame = null;
    this.world.removeLabels('layer:');
    this.timelineEl.hidden = true;
    this.timeline = null;
  }

  refresh() {
    if (this.name === 'labeled') this.fillLabels();
    else if (this.name === 'touch') this.fillTouch();
    else if (this.name === 'prediction' && !this.preview) this.computeTimeline();
  }

  add(object) {
    this.world.overlay.add(object);
    this.objects.push(object);
    return object;
  }

  label(key, cls, position) {
    const inner = h('div.inner');
    const el = h(`div.world-label.${cls}`, inner);
    this.world.addLabel(`layer:${key}`, el, position);
    return inner;
  }

  // ------------------------------------------------------------------ labeled

  buildLabeled() {
    const { world, store } = this;
    this.cargoLabels = new Map();
    for (const view of world.views.cargo.values()) {
      const inner = this.label(`cargo:${view.id}`, 'cargo-label', (target) => {
        const p = view.group.position;
        return target.set(p.x + CARGO_WIDTH / 2, p.y - 30, CARGO_Z0 + CARGO_DEPTH);
      });
      this.cargoLabels.set(view.id, inner);
    }
    for (const view of world.views.conveyor.values()) {
      const conv = view.conv;
      const inner = this.label(`conveyor:${conv.id}`, 'device-label', (target) =>
        target.set(conv.x + conv.lenX + 26, view.carriage.position.y - 8, BELT_Z0 + BELT_DEPTH));
      inner.append(h('b', `CV-${String(conv.id).padStart(2, '0')}`), conv.storage ? ' storage' : conv.ym != null ? ' lift' : '');
    }
    for (const view of world.views.pipetter.values()) {
      const p = view.pipetter;
      const inner = this.label(`pipetter:${p.id}`, 'device-label', (target) => target.set(p.x + 60, p.y + p.lenY + 150, 60));
      inner.append(h('b', `PIP-${String(p.id).padStart(2, '0')}`), ' pipetter');
    }
    this.fillLabels();
  }

  fillLabels() {
    const { store } = this;
    for (const [cargoId, inner] of this.cargoLabels || []) {
      const containers = store.containersByCargo.get(cargoId) || [];
      const tips = store.tipsByCargo.get(cargoId) || [];
      const groups = new Map();
      const hazards = new Set();
      let empty = 0;
      for (const c of containers) {
        const material = store.materialOf(c);
        if (isEmptyMaterial(material)) { empty += 1; continue; }
        const name = materialLabel(material, store.lookup);
        const group = groups.get(name) || { name, count: 0, volume: 0 };
        group.count += 1;
        group.volume += store.volumeOf(c);
        groups.set(name, group);
        for (const flag of materialHazards(material, store.lookup)) hazards.add(flag);
      }
      const rows = [...groups.values()].sort((a, b) => b.volume - a.volume);
      fill(inner, 
        h('div.cargo-label-head', h('b', store.cargoTag(cargoId)), h('span.ellipsis', store.cargos.get(cargoId)?.label || ''), hazardBadges([...hazards])),
        h('div.cargo-label-rows',
          rows.slice(0, 6).map((row) => h('div.cargo-label-row', h('span.ellipsis', `${row.count > 1 ? `${row.count}× ` : ''}${row.name}`), h('span.mono', fmtVolume(row.volume)))),
          rows.length > 6 ? h('div.cargo-label-row.muted', `+ ${rows.length - 6} more materials`) : null,
          empty ? h('div.cargo-label-row.muted', `${empty} empty`) : null,
          tips.length ? h('div.cargo-label-row', h('span', 'Tips'), h('span.mono', `${tips.filter((t) => t.hasTip && t.sterile).length} / ${tips.length}`)) : null,
        ),
      );
    }
  }

  // ------------------------------------------------------------------ touch (anchored cargo)

  buildTouch() {
    const { world, store } = this;
    this.touch = [];
    for (const view of world.views.cargo.values()) {
      const cargo = store.cargos.get(view.id);
      const inner = this.label(`touch:${view.id}`, 'touch-label', (target) => {
        const p = view.group.position;
        return target.set(p.x + CARGO_WIDTH / 2, p.y + view.topY + 26, CARGO_Z0 + CARGO_DEPTH / 2);
      });
      const entry = { view, inner, anchored: cargo.anchoredConveyor != null };
      if (entry.anchored) {
        const size = new THREE.Vector3(CARGO_WIDTH + 8, view.topY + 8, CARGO_DEPTH + 8);
        entry.box = this.add(bracketBox(new THREE.Box3(size.clone().multiplyScalar(-0.5), size.clone().multiplyScalar(0.5)), world.palette.accent2Line, 0.3));
        entry.home = this.add(wireBox(CARGO_WIDTH, CARGO_BASE, CARGO_DEPTH, world.palette.accent2Line));
        entry.link = this.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), world.palette.accent2Line));
        entry.link.frustumCulled = false;
      }
      this.touch.push(entry);
    }
    this.fillTouch();
    this.frame = () => {
      for (const entry of this.touch) {
        if (!entry.anchored) continue;
        const cargo = store.cargos.get(entry.view.id);
        const conv = cargo && store.conveyors.get(cargo.anchoredConveyor);
        if (!conv) continue;
        const p = entry.view.group.position;
        entry.box.position.set(p.x + CARGO_WIDTH / 2, p.y + entry.view.topY / 2, CARGO_Z0 + CARGO_DEPTH / 2);
        const hx = conv.x + cargo.anchoredRel, hy = store.conveyorY(conv.id);
        entry.home.position.set(hx + CARGO_WIDTH / 2, hy + CARGO_BASE / 2, CARGO_Z0 + CARGO_DEPTH / 2);
        const away = Math.hypot(hx - p.x, hy - p.y) > 3;
        entry.link.visible = away;
        if (away) {
          const points = entry.link.geometry.attributes.position;
          points.setXYZ(0, p.x + CARGO_WIDTH / 2, p.y + CARGO_BASE / 2, CARGO_Z0 + CARGO_DEPTH + 4);
          points.setXYZ(1, hx + CARGO_WIDTH / 2, hy + CARGO_BASE / 2, CARGO_Z0 + CARGO_DEPTH + 4);
          points.needsUpdate = true;
        }
      }
    };
  }

  fillTouch() {
    const { store } = this;
    for (const entry of this.touch || []) {
      const cargo = store.cargos.get(entry.view.id);
      if (!cargo) continue;
      clear(entry.inner);
      if (cargo.anchoredConveyor == null) {
        entry.inner.append(h('span.muted', `${store.cargoTag(cargo.id)} · free`));
        entry.inner.parentElement.classList.remove('anchored');
        continue;
      }
      entry.inner.parentElement.classList.add('anchored');
      const docked = cargo.conveyorId === cargo.anchoredConveyor;
      const offset = cargo.rel - cargo.anchoredRel;
      entry.inner.append(icon('anchor'), h('b', store.cargoTag(cargo.id)),
        h('span', docked ? (Math.abs(offset) <= 3 ? 'docked' : `off by ${offset > 0 ? '+' : ''}${offset.toFixed(1)} mm`) : `away · home CV-${String(cargo.anchoredConveyor).padStart(2, '0')}`));
    }
  }

  // ------------------------------------------------------------------ prediction

  /** Shows a protocol plan in the prediction layer instead of the live queue (null: live again). */
  setPreview(preview) {
    this.preview = preview;
    this.time = 0;
    if (this.name === 'prediction') this.set('prediction');
  }

  buildPrediction() {
    this.ghosts = new Map();
    this.liftGhosts = new Map();
    this.paths = [];
    this.buildTimelineUi();
    this.computeTimeline();
    this.frame = (dt) => {
      const timeline = this.timeline;
      if (!timeline) return;
      if (this.playing) {
        this.time += dt * 1000 * this.rate;
        if (this.time >= timeline.duration) { this.time = timeline.duration; this.playing = false; this.renderTransport(); }
        this.renderTime();
      }
      for (const [id, ghost] of this.ghosts) {
        const pos = timeline.cargoAt(id, this.time);
        if (!pos) continue;
        ghost.position.set(pos.x + CARGO_WIDTH / 2, pos.y + ghost.userData.height / 2, CARGO_Z0 + CARGO_DEPTH / 2);
        const live = this.world.views.cargo.get(id)?.group.position;
        ghost.visible = !live || Math.hypot(live.x - pos.x, live.y - pos.y) > 2;
      }
      for (const [id, ghost] of this.liftGhosts) {
        const y = timeline.liftAt(id, this.time);
        const conv = this.store.conveyors.get(id);
        if (y == null || !conv) continue;
        ghost.position.set(conv.x + conv.lenX / 2, y - 10, BELT_Z0 + BELT_DEPTH / 2);
        ghost.visible = Math.abs(this.store.conveyorY(id) - y) > 2;
      }
    };
  }

  computeTimeline() {
    const { store, world } = this;
    for (const object of this.objects) disposeTree(object);
    this.objects = [];
    this.ghosts.clear();
    this.liftGhosts.clear();
    world.removeLabels('layer:ghost');

    const instructions = this.preview ? this.preview.instructions : store.instructions;
    const pending = instructions.filter((ins) => ins.status !== STATUS.COMPLETED);
    if (!pending.length) {
      this.timeline = null;
      this.schedule = null;
      this.renderTimelineInfo();
      return;
    }
    const schedule = this.preview ? (this.preview.schedule || buildSchedule(store, instructions)) : buildSchedule(store, instructions, { tracked: store.tracked });
    const timeline = simulateTimeline(store, instructions, schedule);
    this.schedule = schedule;
    this.timeline = timeline;
    this.time = Math.min(this.time, timeline.duration);

    for (const [id, track] of timeline.tracks) {
      if (!track.moved) continue;
      const view = world.views.cargo.get(id);
      const height = view ? view.topY : CARGO_BASE;
      const ghost = new THREE.Group();
      ghost.add(wireBox(CARGO_WIDTH, height, CARGO_DEPTH, world.palette.ghostLine));
      ghost.add(new THREE.Mesh(new THREE.BoxGeometry(CARGO_WIDTH, height, CARGO_DEPTH), world.palette.ghost));
      ghost.userData.height = height;
      this.add(ghost);
      this.ghosts.set(id, ghost);
      const inner = this.label(`ghost:${id}`, 'ghost-label', (target) => (ghost.visible ? target.copy(ghost.position).setY(ghost.position.y + height / 2 + 20) : null));
      inner.textContent = store.cargoTag(id);

      // trajectory: where this cargo will travel from now on
      const points = [];
      let last = null;
      for (let i = 0; i < track.t.length; i++) {
        if (track.t[i] < 0) continue;
        const point = new THREE.Vector3(track.x[i] + CARGO_WIDTH / 2, track.y[i] + CARGO_BASE / 2, CARGO_Z0 + CARGO_DEPTH + 10);
        if (last && last.distanceToSquared(point) < 16) continue;
        points.push(point);
        last = point;
      }
      if (points.length > 1) {
        const line = this.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), world.palette.ghostLine));
        line.frustumCulled = false;
        const end = this.add(new THREE.Mesh(new THREE.OctahedronGeometry(9), world.palette.ghost.clone()));
        end.material.opacity = 0.9;
        end.position.copy(points[points.length - 1]);
      }
    }
    for (const id of timeline.lifts.keys()) {
      const conv = store.conveyors.get(id);
      const ghost = this.add(wireBox(conv.lenX, 22, BELT_DEPTH, world.palette.ghostLine));
      this.liftGhosts.set(id, ghost);
    }
    this.renderTimelineInfo();
  }

  buildTimelineUi() {
    const el = this.timelineEl;
    el.hidden = false;
    el.className = 'panel';
    this.ui = {
      source: h('div.timeline-source.ellipsis'),
      play: h('button.btn.icon-only.primary', { title: 'Play / pause (Space)', onclick: () => this.togglePlay() }),
      slider: h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': 'Time' }),
      now: h('span.mono.timeline-now'),
      marks: h('div.timeline-marks'),
      rates: h('div.row'),
      info: h('div.timeline-info.muted'),
      live: h('button.btn.small', { onclick: () => this.setPreview(null) }, icon('close'), 'Back to live queue'),
    };
    this.ui.slider.addEventListener('input', () => {
      if (!this.timeline) return;
      this.time = (this.ui.slider.value / 1000) * this.timeline.duration;
      this.playing = false;
      this.renderTransport();
      this.renderTime(false);
    });
    for (const rate of [1, 4, 16]) {
      this.ui.rates.append(h('button.speed', { dataset: { rate }, onclick: () => { this.rate = rate; this.renderTransport(); } }, `×${rate}`));
    }
    fill(el, 
      h('div.timeline-top', icon('forecast'), this.ui.source, this.ui.live),
      h('div.timeline-main', this.ui.play, h('div.timeline-track', this.ui.marks, this.ui.slider), this.ui.now, this.ui.rates),
      this.ui.info,
    );
    this.renderTransport();
  }

  renderTimelineInfo() {
    const ui = this.ui;
    if (!ui) return;
    const { timeline, schedule } = this;
    ui.source.textContent = this.preview ? `Preview · ${this.preview.name}` : 'Live queue';
    ui.live.hidden = !this.preview;
    clear(ui.marks);
    ui.play.disabled = ui.slider.disabled = !timeline;
    if (!timeline) {
      ui.info.textContent = 'Nothing is queued. Start a protocol, or open one in the protocol browser and choose Preview to see where everything will travel.';
      ui.now.textContent = '';
      return;
    }
    const moving = [...timeline.tracks.values()].filter((t) => t.moved).length;
    ui.info.textContent = `${moving} cargo will move · ≈ ${fmtDuration(schedule.autoMs)} of motion`
      + (schedule.manualCount ? ` · ${schedule.manualCount} manual step${schedule.manualCount > 1 ? 's' : ''} (time not included)` : '');
    for (const item of schedule.items.values()) {
      if (!item.manual) continue;
      ui.marks.append(h('i.manual-mark', { title: 'Manual step', style: { left: `${(item.start / timeline.duration) * 100}%`, width: `${Math.max(0.6, ((item.end - item.start) / timeline.duration) * 100)}%` } }));
    }
    this.renderTime();
  }

  renderTime(moveSlider = true) {
    if (!this.timeline || !this.ui) return;
    if (moveSlider) this.ui.slider.value = String(Math.round((this.time / Math.max(1, this.timeline.duration)) * 1000));
    this.ui.now.textContent = `T+${fmtClock(this.time)} / ${fmtClock(this.timeline.duration)}`;
  }

  renderTransport() {
    if (!this.ui) return;
    fill(this.ui.play, icon(this.playing ? 'pause' : 'play'));
    for (const b of this.ui.rates.children) b.classList.toggle('active', Number(b.dataset.rate) === this.rate);
  }

  togglePlay() {
    if (!this.timeline) return;
    if (!this.playing && this.time >= this.timeline.duration - 1) this.time = 0;
    this.playing = !this.playing;
    this.renderTransport();
  }

  // ------------------------------------------------------------------ setup

  buildSetup() {
    const { world, store } = this;
    const describe = (type, id) => {
      const assignment = getAssignment(type, id);
      const prefab = assignment && config.prefabs[assignment.prefab];
      return prefab ? prefab.name : 'default';
    };
    const tagged = [];
    const mark = (type, view, text, origin, position) => {
      const axes = this.add(new THREE.AxesHelper(46));
      axes.material.depthTest = false;
      axes.renderOrder = 5;
      const inner = this.label(`setup:${type}:${view.id}`, 'setup-label', position);
      tagged.push({ type, id: view.id, text, inner, axes, origin });
    };
    for (const view of world.views.cargo.values()) {
      mark('cargo', view, store.cargoTag(view.id), () => view.group.position,
        (target) => target.copy(view.group.position).add(new THREE.Vector3(CARGO_WIDTH / 2, view.topY + 24, CARGO_DEPTH / 2)));
    }
    for (const view of world.views.conveyor.values()) {
      const origin = new THREE.Vector3();
      mark('conveyor', view, `CV-${String(view.id).padStart(2, '0')}`, () => origin.set(view.conv.x, view.carriage.position.y, 0),
        (target) => target.set(view.conv.x + view.conv.lenX / 2, view.carriage.position.y - 44, BELT_Z0 + BELT_DEPTH));
    }
    for (const view of world.views.pipetter.values()) {
      const origin = new THREE.Vector3(view.pipetter.x, view.pipetter.y, 0);
      mark('pipetter', view, `PIP-${String(view.id).padStart(2, '0')}`, () => origin, (target) => target.set(view.pipetter.x, view.pipetter.y - 30, 60));
    }
    const relabel = () => {
      for (const item of tagged) {
        const model = describe(item.type, item.id);
        fill(item.inner, h('b', item.text), h(`span${model === 'default' ? '.muted' : '.accent'}`, model));
      }
    };
    relabel();
    this.refillSetup = relabel;
    this.frame = () => { for (const item of tagged) item.axes.position.copy(item.origin()); };
  }
}
