// Cargo bay: take cargo out of the system, put it back, or add a new and different cargo.

import { h, fill } from '../core/util.js';
import { COLLECTIONS, collectionSlots } from '../shared/collections.js';
import { fmtVolume } from '../shared/material.js';
import { icon } from './icons.js';

const pad = (id) => String(id).padStart(2, '0');

export function createCargoBay(app) {
  const { store, world } = app;
  const body = h('div.panel-body.scroll');
  const el = h('aside.side-panel.panel', { 'aria-label': 'Cargo bay' },
    h('div.panel-head', icon('crate'), h('span.grow', 'Cargo bay'), h('button.btn.ghost.small.icon-only', { title: 'Close (Esc)', onclick: () => app.close() }, icon('close'))),
    body);

  const form = { label: '', collection: 'falcon50', conveyor: null, anchored: false, fill: 'empty', percent: 50, solute: '', molarity: 0.1 };
  const returnTo = new Map(); // cargo id -> conveyor id
  let busy = false;

  const act = async (fn, okText) => {
    if (busy) return;
    busy = true;
    try {
      await fn();
      if (okText) app.toast(okText, 'ok');
      await store.refresh();
    } catch (err) { app.toast(err.message, 'error'); } finally { busy = false; render(); }
  };

  const conveyorOptions = (selected) => [...store.conveyors.values()].filter((c) => c.ym == null).map((c) =>
    h('option', { value: c.id, selected: c.id === selected }, `CV-${pad(c.id)}${c.storage ? ' · storage' : ''} · ${[...store.cargos.values()].filter((x) => x.available && x.conveyorId === c.id).length} cargo`));

  const summary = (cargo) => {
    const containers = store.containersByCargo.get(cargo.id) || [];
    const tips = store.tipsByCargo.get(cargo.id) || [];
    if (containers.length) return `${containers.length} × ${containers[0].type}`;
    if (tips.length) return `${tips.length} tips`;
    return 'no containers';
  };

  const preview = (spec) => {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 135 90');
    const rect = document.createElementNS(svgNS, 'rect');
    for (const [k, v] of Object.entries({ x: 1, y: 1, width: 133, height: 88, class: 'map-frame' })) rect.setAttribute(k, v);
    svg.append(rect);
    for (const slot of collectionSlots(spec)) {
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', slot.x);
      circle.setAttribute('cy', slot.z);
      circle.setAttribute('r', Math.max(1.6, spec.diameter / 2 - 0.5));
      circle.setAttribute('class', 'map-slot preview');
      svg.append(circle);
    }
    return svg;
  };

  const buildCargo = () => {
    const spec = COLLECTIONS[form.collection];
    const slots = collectionSlots(spec);
    const water = [...store.lookup.substances.values()].find((s) => /^water$/i.test(s.substance_name || ''));
    const material = () => {
      if (form.fill === 'empty' || !water) return { substances: [], proteins: [], organisms: [] };
      const ul = (spec.maxVolume * form.percent) / 100;
      const substances = [{ substance_id: water.substance_id, amount: ((ul / 1000) * water.density) / water.molar }];
      if (form.fill === 'solution' && form.solute) substances.push({ substance_id: Number(form.solute), amount: form.molarity * (ul / 1e6) });
      return { substances, proteins: [], organisms: [] };
    };
    return {
      label: form.label.trim() || spec.name, collection: form.collection, on_conveyor_id: Number(form.conveyor), anchored: form.anchored,
      containers: spec.isTips ? [] : slots.map((slot) => ({
        container_type_name: spec.type, relative_center_x: slot.x, relative_center_z: slot.z, maximum_volume: spec.maxVolume, is_closed: false, material: material(),
      })),
      tips: spec.isTips ? slots.map((slot) => ({ relative_center_x: slot.x, relative_center_z: slot.z, has_tip: true, is_sterile: true })) : [],
    };
  };

  const render = () => {
    if (!el.isConnected) return;
    const inside = [...store.cargos.values()].filter((c) => c.available).sort((a, b) => a.id - b.id);
    const outside = [...store.cargos.values()].filter((c) => !c.available).sort((a, b) => a.id - b.id);
    const shelves = [...store.conveyors.values()].filter((c) => c.ym == null);
    if (form.conveyor == null || !store.conveyors.has(Number(form.conveyor))) form.conveyor = (shelves.find((c) => c.storage) || shelves[0])?.id ?? null;
    const spec = COLLECTIONS[form.collection];
    const scroll = body.scrollTop;

    fill(body, 
      h('div.section-title', `Out of the system · ${outside.length}`),
      outside.length ? h('div.bay-list', outside.map((cargo) => {
        if (!returnTo.has(cargo.id)) returnTo.set(cargo.id, store.conveyors.has(cargo.conveyorId) && store.conveyors.get(cargo.conveyorId).ym == null ? cargo.conveyorId : form.conveyor);
        const select = h('select.field', { 'aria-label': 'Conveyor to return to', onchange: () => returnTo.set(cargo.id, Number(select.value)) }, conveyorOptions(returnTo.get(cargo.id)));
        return h('div.bay-item.out',
          h('div.row', h('b.mono.accent2', store.cargoTag(cargo.id)), h('span.grow.ellipsis', cargo.label || ''), h('span.muted.small', summary(cargo))),
          h('div.row', select,
            h('button.btn.small.primary', { onclick: () => act(() => app.api.insertCargo(cargo.id, { on_conveyor_id: returnTo.get(cargo.id) }), `${store.cargoTag(cargo.id)} is back in the system`) }, icon('insert'), 'Return'),
            h('button.btn.small.danger.icon-only', { title: 'Delete this cargo for good', onclick: () => { if (confirm(`Delete ${store.cargoTag(cargo.id)} and its containers permanently?`)) act(() => app.api.deleteCargo(cargo.id), 'Cargo deleted'); } }, icon('trash'))));
      })) : h('p.muted.small', 'Nothing is out. Take a cargo out to work on it by hand; it stays known to the warehouse and can be returned at any time.'),

      h('div.section-title', `In the system · ${inside.length}`),
      h('div.bay-list', inside.map((cargo) => h('div.bay-item',
        h('button.bay-main', { onclick: () => app.select({ type: 'cargo', id: cargo.id }) },
          h('b.mono.accent', store.cargoTag(cargo.id)), h('span.grow.ellipsis', cargo.label || ''), h('span.muted.small', `CV-${pad(cargo.conveyorId)} · ${summary(cargo)}`)),
        h('button.btn.small.icon-only', { title: 'Take out of the system', onclick: () => act(() => app.api.removeCargo(cargo.id), `${store.cargoTag(cargo.id)} taken out of the system`) }, icon('eject'))))),

      h('div.section-title', 'Add a new cargo'),
      h('div.collection-tiles', Object.entries(COLLECTIONS).map(([key, c]) =>
        h(`button.tile.collection-tile${key === form.collection ? '.active' : ''}`, { onclick: () => { form.collection = key; render(); } }, preview(c), h('span', c.name)))),
      h('p.muted.small', `${spec.cols * spec.rows} × ${spec.shape}${spec.isTips ? '' : ` · ${fmtVolume(spec.maxVolume)} each`} · every single ${spec.shape} becomes its own container`),
      h('div.form-grid',
        h('label', h('span.label', 'Name'), h('input.field', { value: form.label, placeholder: spec.name, maxLength: 40, oninput: (e) => { form.label = e.target.value; } })),
        h('label', h('span.label', 'Put it on'), (() => { const s = h('select.field', { onchange: () => { form.conveyor = Number(s.value); } }, conveyorOptions(Number(form.conveyor))); return s; })())),
      h('label.switch.gap', h('input', { type: 'checkbox', checked: form.anchored, onchange: (e) => { form.anchored = e.target.checked; } }), h('i'), 'Anchor it to this slot'),
      spec.isTips ? null : [
        h('span.label.gap', 'Initial content of every container'),
        h('div.row.wrap', [['empty', 'Empty'], ['water', 'Water'], ['solution', 'Solution']].map(([value, label]) =>
          h(`button.btn.small${form.fill === value ? '.active' : ''}`, { onclick: () => { form.fill = value; render(); } }, label))),
        form.fill !== 'empty' ? h('label.gap', h('span.label', `Filled to ${form.percent} % · ${fmtVolume((spec.maxVolume * form.percent) / 100)}`),
          h('input', { type: 'range', min: 5, max: 100, step: 5, value: form.percent, oninput: (e) => { form.percent = Number(e.target.value); e.target.previousSibling.textContent = `Filled to ${form.percent} % · ${fmtVolume((spec.maxVolume * form.percent) / 100)}`; } })) : null,
        form.fill === 'solution' ? h('div.form-grid',
          h('label', h('span.label', 'Solute'), (() => {
            const s = h('select.field', { onchange: () => { form.solute = s.value; } }, h('option', { value: '' }, 'Choose…'),
              [...store.lookup.substances.values()].filter((x) => !/^water$/i.test(x.substance_name || '')).map((x) => h('option', { value: x.substance_id, selected: String(x.substance_id) === String(form.solute) }, x.substance_name)));
            return s;
          })()),
          h('label', h('span.label', 'Concentration (mol / L)'), h('input.field.mono', { type: 'number', min: 0, step: 0.01, value: form.molarity, oninput: (e) => { form.molarity = Math.max(0, Number(e.target.value) || 0); } }))) : null,
      ],
      h('button.btn.primary.block.gap', { disabled: form.conveyor == null, onclick: () => act(async () => {
        const result = await app.api.createCargo(buildCargo());
        form.label = '';
        setTimeout(() => app.select({ type: 'cargo', id: result.cargo_id }), 400);
      }, 'New cargo added to the system') }, icon('plus'), 'Add cargo'),
    );
    body.scrollTop = scroll;
  };

  store.on('snapshot', () => {
    const active = document.activeElement;
    if (el.contains(active) && /^(INPUT|SELECT)$/.test(active.tagName)) return;
    render();
  });
  world.on('rebuilt', render);
  return { el, onOpen: render };
}
