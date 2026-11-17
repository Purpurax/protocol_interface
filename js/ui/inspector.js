// Inspector: what the selected element is. Every element type gets its own view.

import { h, fmtMm, scrubber, fill } from '../core/util.js';
import { config, getAssignment, saveConfig, setAssignment } from '../core/config.js';
import {
  componentAmount, fmtVolume, isEmptyMaterial, materialComponents, materialHazards, materialLabel, materialTint,
} from '../shared/material.js';
import { COLLECTIONS } from '../shared/collections.js';
import { specForType } from '../world/shapes.js';
import { newPrefab } from '../world/prefabs.js';
import { hazardBadges, icon } from './icons.js';

const pad = (id) => String(id).padStart(2, '0');

export function initInspector(app) {
  const { store, world } = app;
  const root = document.getElementById('inspector');
  root.classList.add('panel');
  const title = h('span.grow');
  const body = h('div.panel-body.scroll');
  root.append(
    h('div.panel-head', h('span.icon'), title,
      h('button.btn.ghost.small.icon-only', { title: 'Focus camera (F2)', onclick: () => app.selection && world.focusOn(app.selection) }, icon('target')),
      h('button.btn.ghost.small.icon-only', { title: 'Close (Esc)', onclick: () => app.select(null) }, icon('close'))),
    body,
  );
  let live = []; // functions updating live values every few frames

  const swatch = (material) => {
    const tint = materialTint(material, store.lookup);
    return h('span.swatch', { style: { color: tint ? `hsl(${tint.h} ${tint.s}% ${tint.l}%)` : 'var(--muted)' } });
  };
  const kv = (...pairs) => {
    const dl = h('dl.kv');
    for (let i = 0; i < pairs.length; i += 2) if (pairs[i + 1] != null) dl.append(h('dt', pairs[i]), h('dd', pairs[i + 1]));
    return dl;
  };
  const liveValue = (fn) => {
    const el = h('span');
    live.push(() => { const text = fn(); if (el.textContent !== text) el.textContent = text; });
    return el;
  };
  const link = (label, sel) => h('button.link', { onclick: () => app.select(sel) }, label);
  const motorRows = (entries) => entries.filter(([, id]) => id != null).flatMap(([name, id]) => {
    const motor = store.motors.get(id);
    return [`${name} motor`, h('span', `#${id} · grbl ${motor?.grbl_index}${motor?.axis} · `, liveValue(() => `${store.motorValue(id).toFixed(1)} mm`))];
  });

  // ------------------------------------------------------------------ per type

  function cargoView(cargo) {
    const containers = store.containersByCargo.get(cargo.id) || [];
    const tips = store.tipsByCargo.get(cargo.id) || [];
    const hazards = new Set();
    for (const c of containers) for (const flag of materialHazards(store.materialOf(c), store.lookup)) hazards.add(flag);
    const anchored = cargo.anchoredConveyor != null;
    const list = h('div.content-list');
    for (const c of containers) {
      const material = store.materialOf(c);
      if (isEmptyMaterial(material) && containers.length > 12) continue;
      const volume = store.volumeOf(c);
      list.append(h('button.content-row', { onclick: () => app.select({ type: 'container', id: c.id }),
        onpointerenter: () => world.setBeacons('hover', [{ sel: { type: 'container', id: c.id }, kind: 'hover' }]),
        onpointerleave: () => world.setBeacons('hover', []) },
      swatch(material), h('span.mono.tagcol', store.slotName(c)), h('span.grow.ellipsis', materialLabel(material, store.lookup)),
      hazardBadges(materialHazards(material, store.lookup)), h('span.mono.muted', fmtVolume(volume))));
    }
    const emptyCount = containers.filter((c) => isEmptyMaterial(store.materialOf(c))).length;
    return [
      h('div.row.wrap', h(`span.chip.${anchored ? 'gold' : ''}`, icon('anchor'), anchored ? 'Anchored' : 'Free'),
        cargo.collection && COLLECTIONS[cargo.collection] ? h('span.chip', COLLECTIONS[cargo.collection].name) : null, hazardBadges([...hazards])),
      kv('Conveyor', link(`CV-${pad(cargo.conveyorId)}`, { type: 'conveyor', id: cargo.conveyorId }),
        'Position on belt', liveValue(() => fmtMm(store.cargoPosition(cargo.id).x - (store.conveyors.get(cargo.conveyorId)?.x || 0))),
        'Absolute', liveValue(() => { const p = store.cargoPosition(cargo.id); return `${p.x.toFixed(0)} · ${p.y.toFixed(0)} mm`; }),
        'Home slot', anchored ? `CV-${pad(cargo.anchoredConveyor)} @ ${fmtMm(cargo.anchoredRel)}` : null,
        'Since calibration', fmtMm(cargo.sinceCalibration)),
      containers.length ? h('div.section-title', `Containers · ${containers.length}`) : null,
      containers.length ? list : null,
      containers.length > 12 && emptyCount ? h('div.muted.small', `${emptyCount} empty containers not listed`) : null,
      tips.length ? h('div.section-title', 'Tips') : null,
      tips.length ? kv('Sterile', `${tips.filter((t) => t.hasTip && t.sterile).length} / ${tips.length}`, 'Used', String(tips.filter((t) => t.hasTip && !t.sterile).length), 'Missing', String(tips.filter((t) => !t.hasTip).length)) : null,
      h('div.section-title', 'Actions'),
      h('div.row.wrap',
        h('button.btn.small.primary', { onclick: () => app.open('control', { sel: { type: 'cargo', id: cargo.id } }) }, icon('motor'), 'Move / place'),
        h('button.btn.small', { onclick: () => app.takeOut(cargo.id) }, icon('eject'), 'Take out of system'),
        h('button.btn.small', { onclick: () => app.open('cargobay') }, icon('crate'), 'Cargo bay')),
      app.layer === 'setup' ? modelSection('cargo', cargo.id) : null,
    ];
  }

  function containerView(c) {
    const material = store.materialOf(c);
    const volume = store.volumeOf(c);
    const components = materialComponents(material, store.lookup);
    const hazards = materialHazards(material, store.lookup);
    const level = c.maxVolume > 0 ? volume / c.maxVolume : 0;
    const table = h('div.components');
    for (const comp of components) {
      const flags = comp.kind === 'substance' ? Object.keys(comp.hazard).filter((key) => comp.hazard[key]) : comp.kind === 'organism' ? ['biological'] : [];
      table.append(h('div.component',
        h('div.grow', h('div.ellipsis', comp.name), h('div.muted.mono.small', [comp.formula, comp.cas].filter(Boolean).join(' · ') || comp.kind)),
        hazardBadges(flags), h('div.mono', componentAmount(comp, volume))));
    }
    return [
      h('div.row.wrap', h('span.chip', c.type || 'Container'), h(`span.chip.${c.closed ? 'gold' : 'ok'}`, icon('lid'), c.closed ? 'Lid closed' : 'Open'), hazardBadges(hazards)),
      h('div.volume', h('div.row', swatch(material), h('b.grow.ellipsis', materialLabel(material, store.lookup)), h('span.mono', `${fmtVolume(volume)} / ${fmtVolume(c.maxVolume)}`)),
        h(`div.meter${level > 0.95 ? '.warn' : ''}`, h('i', { style: { width: `${Math.min(100, level * 100)}%` } }))),
      hazards.length ? h('div.hazard-note', icon('warning'), `Hazard: ${hazards.map((flag) => flag).join(', ')}`) : null,
      components.length ? h('div.section-title', 'Composition') : null,
      components.length ? table : null,
      h('div.section-title', 'Location'),
      kv('Cargo', link(`${store.cargoTag(c.cargoId)} ${store.cargos.get(c.cargoId)?.label || ''}`, { type: 'cargo', id: c.cargoId }),
        'Slot', store.slotName(c), 'Centre x · z', `${c.x.toFixed(1)} · ${c.z.toFixed(1)} mm`),
      app.layer === 'setup' ? shapeSection(c) : null,
    ];
  }

  function tipView(t) {
    return [
      h('div.row.wrap', h(`span.chip.${t.hasTip ? (t.sterile ? 'ok' : 'gold') : 'warn'}`, icon('tip'), t.hasTip ? (t.sterile ? 'Sterile tip' : 'Used tip') : 'Empty slot')),
      kv('Cargo', link(store.cargoTag(t.cargoId), { type: 'cargo', id: t.cargoId }), 'Centre x · z', `${t.x.toFixed(1)} · ${t.z.toFixed(1)} mm`),
    ];
  }

  function conveyorView(conv) {
    const cargos = [...store.cargos.values()].filter((c) => c.available && c.conveyorId === conv.id).sort((a, b) => a.rel - b.rel);
    const zones = store.deadzones.filter((z) => z.conveyorId === conv.id);
    const calibrators = store.calibrators.filter((c) => c.conveyorId === conv.id);
    return [
      h('div.row.wrap', conv.storage ? h('span.chip.gold', 'Storage') : null, conv.ym != null ? h('span.chip.accent', icon('lift'), 'Lift') : h('span.chip', icon('belt'), 'Belt'),
        h('span.chip', liveValue(() => (Math.abs(store.motorVelocity(conv.xm)) > 1 || (conv.ym != null && Math.abs(store.motorVelocity(conv.ym)) > 1) ? 'Moving' : 'At rest')))),
      kv('Origin x · y', `${conv.x.toFixed(0)} · ${conv.y.toFixed(0)} mm`, 'Belt length', fmtMm(conv.lenX),
        'Lift travel', conv.lenY ? fmtMm(conv.lenY) : null,
        'Height now', conv.ym != null ? liveValue(() => fmtMm(store.conveyorY(conv.id))) : null,
        ...motorRows([['Belt', conv.xm], ['Lift', conv.ym]])),
      h('button.btn.small.primary.gap', { onclick: () => app.open('control', { sel: { type: 'conveyor', id: conv.id } }) }, icon('motor'), conv.ym != null ? 'Move belt / lift by hand' : 'Move belt by hand'),
      h('div.section-title', `Cargo · ${cargos.length}`),
      cargos.length ? h('div.content-list', cargos.map((c) => h('button.content-row', { onclick: () => app.select({ type: 'cargo', id: c.id }) },
        icon('crate'), h('span.mono.tagcol', store.cargoTag(c.id)), h('span.grow.ellipsis', c.label || ''), h('span.mono.muted', fmtMm(c.rel))))) : h('div.muted', 'Empty'),
      zones.length || calibrators.length ? h('div.section-title', 'Markers') : null,
      zones.map((z) => h('button.content-row', { onclick: () => app.select({ type: 'deadzone', id: z.id }) }, icon('warning'), h('span.grow', `Dead zone ${z.id}`), h('span.mono.muted', `${z.start}–${z.end} mm`))),
      calibrators.map((c) => h('button.content-row', { onclick: () => app.select({ type: 'calibrator', id: c.id }) }, icon('target'), h('span.grow', `Calibrator ${c.id}`), h('span.mono.muted', c.forCargo ? 'cargo' : 'conveyor'))),
      app.layer === 'setup' ? modelSection('conveyor', conv.id) : null,
    ];
  }

  function pipetterView(p) {
    return [
      h('div.row.wrap', h('span.chip.accent', icon('pipette'), 'Pipetter')),
      kv('Position x · y', `${p.x.toFixed(0)} · ${p.y.toFixed(0)} mm`, 'Over conveyor', link(`CV-${pad(p.conveyorId)}`, { type: 'conveyor', id: p.conveyorId }),
        'Travel y · z', `${p.lenY.toFixed(0)} · ${p.lenZ.toFixed(0)} mm`, ...motorRows([['Y', p.ym], ['Z', p.zm], ['Plunger', p.pm]])),
      app.layer === 'setup' ? modelSection('pipetter', p.id) : null,
    ];
  }

  // ------------------------------------------------------------------ setup: model + offsets

  function modelSection(type, id) {
    const assignment = getAssignment(type, id) || { prefab: '', offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
    const apply = () => {
      setAssignment(type, id, assignment.prefab ? assignment : null);
      world.reassign(type, id);
      app.layers.refillSetup?.();
    };
    const select = h('select.field', { onchange: () => { assignment.prefab = select.value; apply(); render(); } },
      h('option', { value: '' }, 'Default rectangle'),
      Object.values(config.prefabs).map((prefab) => h('option', { value: prefab.id, selected: prefab.id === assignment.prefab }, prefab.name)));
    const vector = (key, step, unit) => h('div.vec', ['x', 'y', 'z'].map((axis, i) => h('div.row', h(`span.axis.${axis}`, axis.toUpperCase()),
      scrubber({ value: assignment[key][i], step, unit, digits: 1, onchange: (v) => { assignment[key][i] = v; apply(); } }))));
    return [
      h('div.section-title', 'Model'),
      h('label', h('span.label', 'Prefab shown for this element'), select),
      assignment.prefab ? [
        h('span.label.gap', 'Offset'), vector('offset', 1, 'mm'),
        h('span.label.gap', 'Rotation'), vector('rotation', 5, '°'),
        h('span.label.gap', 'Scale'), scrubber({ value: assignment.scale, step: 0.05, min: 0.01, digits: 2, onchange: (v) => { assignment.scale = v; apply(); } }),
      ] : h('p.muted.small', 'Pick a prefab to show a model instead of the rectangle, then fine-tune its offset here.'),
      h('div.row.wrap.gap',
        h('button.btn.small', { onclick: () => app.open('workshop', { prefabId: assignment.prefab || null, kind: type }) }, icon('anvil'), assignment.prefab ? 'Edit prefab' : 'Open workshop'),
        h('button.btn.small', { onclick: () => {
          const prefab = newPrefab(type, `${type} ${id}`);
          assignment.prefab = prefab.id;
          apply();
          app.open('workshop', { prefabId: prefab.id, kind: type });
        } }, icon('plus'), 'New prefab'),
        assignment.prefab && type === 'cargo' ? h('button.btn.small', { title: 'Use this prefab and offsets for every cargo that carries the same collection', onclick: () => {
          const mine = store.cargos.get(id);
          const signature = (cargoId) => (store.containersByCargo.get(cargoId)?.[0]?.type || (store.tipsByCargo.get(cargoId)?.length ? 'tips' : ''));
          let count = 0;
          for (const other of store.cargos.values()) {
            if (other.id === id || signature(other.id) !== signature(mine.id)) continue;
            setAssignment('cargo', other.id, JSON.parse(JSON.stringify(assignment)));
            world.reassign('cargo', other.id);
            count += 1;
          }
          app.layers.refillSetup?.();
          app.toast(`Applied to ${count} more cargo`, 'ok');
        } }, icon('copy'), 'Apply to similar') : null),
    ];
  }

  function shapeSection(c) {
    const spec = specForType(c.type, c.maxVolume);
    const override = config.containerShapes[c.type] || {};
    const apply = (key, value) => {
      config.containerShapes[c.type] = { ...override, [key]: value };
      Object.assign(override, { [key]: value });
      saveConfig('containerShapes');
      world.reassign('cargo', c.cargoId);
      for (const other of store.cargos.values()) {
        if (other.id !== c.cargoId && (store.containersByCargo.get(other.id) || []).some((x) => x.type === c.type)) world.reassign('cargo', other.id);
      }
    };
    const shape = h('select.field', { onchange: () => apply('shape', shape.value) },
      ['tube', 'well', 'dish'].map((s) => h('option', { value: s, selected: s === spec.shape }, s[0].toUpperCase() + s.slice(1))));
    return [
      h('div.section-title', `Shape of "${c.type}"`),
      h('div.form-grid',
        h('label', h('span.label', 'Shape'), shape),
        h('label', h('span.label', 'Diameter'), scrubber({ value: spec.diameter, step: 0.5, min: 1, unit: 'mm', onchange: (v) => apply('diameter', v) })),
        h('label', h('span.label', 'Height'), scrubber({ value: spec.height, step: 1, min: 1, unit: 'mm', onchange: (v) => apply('height', v) })),
        h('label', h('span.label', 'Housing'), scrubber({ value: spec.housing || 0, step: 1, min: 0, unit: 'mm', onchange: (v) => apply('housing', v) }))),
      h('button.btn.small.gap', { onclick: () => { delete config.containerShapes[c.type]; saveConfig('containerShapes'); world.rebuild(); render(); } }, 'Reset to default'),
    ];
  }

  // ------------------------------------------------------------------ render

  const HEAD = { cargo: 'crate', container: 'flask', tip: 'tip', conveyor: 'belt', pipetter: 'pipette', deadzone: 'warning', calibrator: 'target' };

  function render() {
    const sel = app.selection;
    live = [];
    if (!sel || !world.exists(sel)) { root.hidden = true; world.setInset('right', 0); return; }
    const info = app.describe(sel);
    const scroll = body.scrollTop;
    root.hidden = false;
    world.setInset('right', 344);
    root.dataset.type = sel.type;
    root.querySelector('.panel-head .icon').replaceWith(icon(HEAD[sel.type] || 'dot'));
    title.textContent = info.title;
    let content;
    if (sel.type === 'cargo') content = cargoView(store.cargos.get(sel.id));
    else if (sel.type === 'container') content = containerView(store.containers.get(sel.id));
    else if (sel.type === 'tip') content = tipView(store.tips.get(sel.id));
    else if (sel.type === 'conveyor') content = conveyorView(store.conveyors.get(sel.id));
    else if (sel.type === 'pipetter') content = pipetterView(store.pipetters.get(sel.id));
    else if (sel.type === 'deadzone') {
      const z = store.deadzones.find((d) => d.id === sel.id);
      content = [h('p.muted', 'Cargo must not stop inside a dead zone.'), kv('Conveyor', link(`CV-${pad(z.conveyorId)}`, { type: 'conveyor', id: z.conveyorId }), 'From', fmtMm(z.start), 'To', fmtMm(z.end))];
    } else {
      const c = store.calibrators.find((x) => x.id === sel.id);
      content = [kv('Conveyor', link(`CV-${pad(c.conveyorId)}`, { type: 'conveyor', id: c.conveyorId }), 'Calibrates', c.forCargo ? 'cargo' : 'conveyor',
        'Left x', c.left, 'Right x', c.right, 'Up y', c.up, 'Down y', c.down)];
    }
    fill(body, h('div.inspector-sub.muted', info.subtitle || ''), ...content.flat(3).filter(Boolean));
    body.scrollTop = scroll;
    for (const fn of live) fn();
  }

  let frames = 0;
  world.on('frame', () => { if (!root.hidden && ++frames % 6 === 0) for (const fn of live) fn(); });
  // do not rebuild under the user's fingers: wait while a field is edited or a value is dragged
  let dragging = false;
  root.addEventListener('pointerdown', () => { dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });
  store.on('snapshot', () => {
    const active = document.activeElement;
    const editing = root.contains(active) && /^(INPUT|SELECT)$/.test(active.tagName);
    if (!dragging && !editing) render();
  });
  return { render };
}
