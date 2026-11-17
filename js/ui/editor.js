// Visual protocol editor. A protocol is a list of steps; every step shows which container of which
// cargo is used (3D portrait, material, concentration, hazards) and what happens to it. Nothing is
// typed except names: containers are picked from the cargo (or by clicking them in the 3D world),
// amounts are dragged.

import { h, clear, fmtDuration, scrubber, fill } from '../core/util.js';
import { estimatePlan } from '../core/predict.js';
import {
  cloneMaterial, componentAmount, fmtVolume, isEmptyMaterial, materialComponents, materialHazards, materialLabel,
  materialSignature, materialTint, materialVolume,
} from '../shared/material.js';
import { specForType } from '../world/shapes.js';
import { emblem, hazardBadges, icon } from './icons.js';

const PRESETS = [10, 50, 100, 500, 1000];

export function createEditor(app) {
  const { store, world } = app;
  let draft = null;
  let dirty = false;
  let selected = -1;
  let picking = null; // { step, role }
  let pickerCargo = null;
  let estimate = null; // { text, kind }
  let saving = false;

  const head = h('span.grow', 'Protocol editor');
  const meta = h('div.editor-meta');
  const status = h('div.editor-status');
  const stepsEl = h('div.editor-steps.scroll');
  const foot = h('div.editor-foot');
  const picker = h('aside.editor-picker.panel', { hidden: true });
  const el = h('aside.editor.panel', { 'aria-label': 'Protocol editor' },
    h('div.panel-head', icon('edit'), head,
      h('button.btn.ghost.small.icon-only', { title: 'Show / hide the editor', onclick: () => el.classList.toggle('collapsed') }, icon('eye')),
      h('button.btn.ghost.small.icon-only', { title: 'Close (Esc)', onclick: () => app.close() }, icon('close'))),
    meta, status, stepsEl, foot, picker);

  // ------------------------------------------------------------------ model helpers

  const virt = (vid) => draft.containers.find((c) => c.vid === vid) || null;
  const physicalOf = (vid) => {
    const v = virt(vid);
    const c = v && v.preferred != null ? store.containers.get(v.preferred) : null;
    return c && store.cargos.get(c.cargoId)?.available ? c : null;
  };
  const materialOfVirt = (vid) => {
    const physical = physicalOf(vid);
    return physical ? store.materialOf(physical) : virt(vid)?.material || null;
  };
  const touch = () => { dirty = true; estimate = null; };

  /** Points a step's source / destination at a physical container. */
  const bind = (stepIndex, role, containerId) => {
    const container = store.containers.get(containerId);
    if (!container) return;
    let v = draft.containers.find((c) => c.preferred === containerId);
    if (!v) {
      v = {
        vid: draft.containers.reduce((max, c) => Math.max(max, c.vid), -1) + 1, preferred: containerId,
        material: cloneMaterial(store.materialOf(container)), temperature: 20, homogeneous: true,
      };
      draft.containers.push(v);
    }
    draft.steps[stepIndex][role] = v.vid;
    touch();
  };

  /** Volumes before / after every step, plus what is wrong with it. */
  const simulate = () => {
    const volume = new Map(), capacity = new Map();
    for (const v of draft.containers) {
      const physical = physicalOf(v.vid);
      volume.set(v.vid, physical ? store.volumeOf(physical) : materialVolume(v.material, store.lookup));
      capacity.set(v.vid, physical ? physical.maxVolume : Infinity);
    }
    return draft.steps.map((step) => {
      const problems = [];
      const out = { fromBefore: null, fromAfter: null, toBefore: null, toAfter: null, problems };
      if (step.from == null || !virt(step.from)) problems.push('Pick a source container');
      if (step.to == null || !virt(step.to)) problems.push('Pick a destination container');
      if (problems.length) return out;
      if (step.from === step.to) problems.push('Source and destination are the same container');
      if (!(step.volume > 0)) problems.push('The amount must be larger than zero');
      out.fromBefore = volume.get(step.from);
      out.toBefore = volume.get(step.to);
      out.fromAfter = out.fromBefore - step.volume;
      out.toAfter = out.toBefore + step.volume;
      if (out.fromAfter < -1e-6) problems.push(`Source only holds ${fmtVolume(out.fromBefore)} at this point`);
      if (out.toAfter > capacity.get(step.to) + 1e-6) problems.push(`Destination overflows (${fmtVolume(capacity.get(step.to))} max)`);
      if (physicalOf(step.from)?.closed || physicalOf(step.to)?.closed) out.manual = 'A lid is closed: you will be asked to open it';
      volume.set(step.from, Math.max(0, out.fromAfter));
      volume.set(step.to, out.toAfter);
      return out;
    });
  };

  // ------------------------------------------------------------------ world coupling

  const showStep = (focus = true) => {
    const step = draft?.steps[selected];
    const from = step && physicalOf(step.from), to = step && physicalOf(step.to);
    const fromSel = from ? { type: 'container', id: from.id } : null, toSel = to ? { type: 'container', id: to.id } : null;
    world.setBeacons('editor', [fromSel && { sel: fromSel, kind: 'from', text: 'From' }, toSel && { sel: toSel, kind: 'to', text: 'To' }].filter(Boolean));
    world.setArc(fromSel, toSel);
    if (!focus) return;
    world.select(null, { focus: false });
    if (fromSel && toSel) world.focusPair(fromSel, toSel);
    else if (fromSel || toSel) world.focusOn(fromSel || toSel);
  };

  // ------------------------------------------------------------------ rendering

  const renderMeta = () => {
    const mark = h('div.editor-emblem', emblem(`${draft.protocol_id ?? 'new'}:${draft.name}`, 64));
    const name = h('input.field.editor-name', { value: draft.name, placeholder: 'Protocol name', maxLength: 80, 'aria-label': 'Protocol name',
      oninput: () => { draft.name = name.value; touch(); renderFoot(); },
      onchange: () => { fill(mark, emblem(`${draft.protocol_id ?? 'new'}:${draft.name}`, 64)); } });
    const author = h('input.field', { value: draft.author, placeholder: 'Author', maxLength: 40, 'aria-label': 'Author', oninput: () => { draft.author = author.value; touch(); renderFoot(); } });
    const version = h('input.field.mono', { value: draft.version, placeholder: '0.0.1', maxLength: 12, 'aria-label': 'Version', oninput: () => { draft.version = version.value; touch(); renderFoot(); } });
    fill(meta, mark, h('div.grow.col', name, h('div.row', h('label.grow', h('span.label', 'Author'), author), h('label.version', h('span.label', 'Version'), version))));
    head.textContent = draft.protocol_id == null ? 'New protocol' : `Edit protocol ${draft.protocol_id}`;
  };

  const slotButton = (stepIndex, role, sim) => {
    const step = draft.steps[stepIndex];
    const vid = step[role];
    const v = vid != null ? virt(vid) : null;
    const physical = v ? physicalOf(vid) : null;
    const material = v ? materialOfVirt(vid) : null;
    const active = picking && picking.step === stepIndex && picking.role === role;
    const before = role === 'from' ? sim.fromBefore : sim.toBefore, after = role === 'from' ? sim.fromAfter : sim.toAfter;
    const capacity = physical ? physical.maxVolume : null;

    const thumb = h('div.slot-thumb');
    if (physical) {
      const url = world.thumbnail(physical.cargoId, { type: 'container', id: physical.id });
      if (url) thumb.append(h('img', { src: url, alt: '', draggable: false }));
    } else thumb.append(icon(v ? 'flask' : 'plus', 'lg'));

    const info = h('div.slot-info');
    if (!v) info.append(h('div.slot-title.muted', role === 'from' ? 'Choose the source' : 'Choose the destination'));
    else {
      const tint = materialTint(material, store.lookup);
      info.append(
        h('div.slot-title', physical ? [h('b.mono', store.cargoTag(physical.cargoId)), h('span.mono', store.slotName(physical)), h('span.muted.ellipsis', store.cargos.get(physical.cargoId)?.label || '')]
          : h('span.warn', 'Not bound to a container')),
        h('div.slot-material', h('span.swatch', { style: { color: tint ? `hsl(${tint.h} ${tint.s}% ${tint.l}%)` : 'var(--muted)' } }),
          h('span.ellipsis', { title: materialLabel(material, store.lookup) }, materialLabel(material, store.lookup)), hazardBadges(materialHazards(material, store.lookup))),
      );
      if (before != null) {
        const scale = capacity || Math.max(before, after, 1);
        info.append(h('div.slot-volume',
          h('div.meter.dual', h('i.before', { style: { width: `${Math.min(100, (Math.max(before, after) / scale) * 100)}%` } }), h('i', { style: { width: `${Math.min(100, (Math.max(0, Math.min(before, after)) / scale) * 100)}%` } })),
          h('span.mono', `${fmtVolume(before)} → ${fmtVolume(Math.max(0, after))}`)));
      }
    }
    return h(`button.slot.${role}${active ? '.picking' : ''}${v && !physical ? '.unbound' : ''}`, {
      title: role === 'from' ? 'Change the source container' : 'Change the destination container',
      onclick: (e) => { e.stopPropagation(); selectStep(stepIndex, false); openPicker(stepIndex, role); },
    }, h('span.slot-role', role === 'from' ? 'From' : 'To'), thumb, info);
  };

  const volumeControl = (stepIndex, sim) => {
    const step = draft.steps[stepIndex];
    const max = Math.max(100, Math.min(sim.fromBefore ?? 10000, 50000));
    const commit = (value, rerender = true) => {
      step.volume = Math.max(0, Math.round(value * 10) / 10);
      touch();
      if (rerender) renderSteps(); else { field.set(step.volume); renderFoot(); }
    };
    const field = scrubber({ value: step.volume, step: 10, min: 0, max: 1e6, unit: 'µL', digits: 1, onchange: (v) => commit(v, false) });
    field.addEventListener('pointerup', () => renderSteps());
    field.querySelector('input').addEventListener('change', () => renderSteps());
    const slider = h('input', { type: 'range', min: 0, max, step: max > 5000 ? 50 : 5, value: Math.min(step.volume, max), 'aria-label': 'Amount',
      oninput: () => commit(Number(slider.value), false), onchange: () => renderSteps() });
    return h('div.step-volume', { onclick: (e) => e.stopPropagation() },
      h('div.step-arrow', icon('transfer', 'lg')), field, slider,
      h('div.presets', PRESETS.map((p) => h(`button.preset${step.volume === p ? '.active' : ''}`, { onclick: () => commit(p) }, p >= 1000 ? `${p / 1000} mL` : `${p}`)),
        sim.fromBefore != null ? h('button.preset', { title: 'Everything that is in the source at this point', onclick: () => commit(sim.fromBefore) }, 'all') : null));
  };

  const renderSteps = () => {
    const scroll = stepsEl.scrollTop;
    const sims = simulate();
    clear(stepsEl);
    draft.steps.forEach((step, index) => {
      const sim = sims[index];
      const move = (delta) => (e) => {
        e.stopPropagation();
        const target = index + delta;
        if (target < 0 || target >= draft.steps.length) return;
        [draft.steps[index], draft.steps[target]] = [draft.steps[target], draft.steps[index]];
        selected = target;
        touch();
        render();
      };
      stepsEl.append(h(`div.step${index === selected ? '.selected' : ''}${sim.problems.length ? '.invalid' : ''}`, { onclick: () => selectStep(index) },
        h('div.step-head', h('span.step-index.mono', String(index + 1).padStart(2, '0')), icon('transfer'), h('span.grow', 'Transfer'),
          h('button.btn.ghost.small.icon-only', { title: 'Move up', disabled: index === 0, onclick: move(-1) }, icon('up')),
          h('button.btn.ghost.small.icon-only', { title: 'Move down', disabled: index === draft.steps.length - 1, onclick: move(1) }, icon('down')),
          h('button.btn.ghost.small.icon-only', { title: 'Duplicate step', onclick: (e) => { e.stopPropagation(); draft.steps.splice(index + 1, 0, { ...step }); selected = index + 1; touch(); render(); } }, icon('copy')),
          h('button.btn.ghost.small.icon-only', { title: 'Remove step', onclick: (e) => {
            e.stopPropagation();
            draft.steps.splice(index, 1);
            selected = Math.min(selected, draft.steps.length - 1);
            closePicker();
            touch();
            render();
          } }, icon('trash'))),
        h('div.step-body', slotButton(index, 'from', sim), volumeControl(index, sim), slotButton(index, 'to', sim)),
        sim.problems.length ? h('div.step-note.warn', icon('warning'), sim.problems.join(' · ')) : sim.manual ? h('div.step-note.accent2', icon('hand'), sim.manual) : null));
    });
    stepsEl.append(h('button.btn.block.add-step', { onclick: () => {
      const last = draft.steps[draft.steps.length - 1];
      draft.steps.push({ from: last?.from ?? null, to: null, volume: last?.volume ?? 100 });
      touch();
      selectStep(draft.steps.length - 1, false);
      openPicker(draft.steps.length - 1, last ? 'to' : 'from');
    } }, icon('plus'), 'Add transfer step'));
    stepsEl.scrollTop = scroll;
    renderFoot(sims);
  };

  const renderFoot = (sims = simulate()) => {
    const problems = sims.reduce((n, sim) => n + sim.problems.length, 0);
    const valid = draft.name.trim() && draft.steps.length && !problems;
    clear(status);
    if (!draft.steps.length) status.append(h('span.muted', 'Add a step, then pick its containers from the cargo or by clicking them in the 3D view.'));
    else if (problems) status.append(h('span.warn', icon('warning'), `${problems} thing${problems > 1 ? 's' : ''} to fix before this can be saved`));
    else if (estimate) status.append(h(`span.${estimate.kind}`, icon(estimate.kind === 'warn' ? 'warning' : 'clock'), estimate.text));
    else status.append(h('span.muted', dirty ? 'Unsaved changes' : 'No changes'));
    fill(foot, 
      h('button.btn.primary', { disabled: !valid || saving || !dirty, onclick: () => save() }, icon('save'), 'Save'),
      h('button.btn.gold', { disabled: !valid || saving || store.busy, title: store.busy ? 'Another protocol is running' : '', onclick: async () => {
        const id = await save();
        if (id != null && await app.runProtocol(id, draft.name)) { dirty = false; app.close(); }
      } }, icon('play'), 'Save and run'),
      h('span.grow'),
      h('button.btn.ghost', { onclick: () => app.open('protocols', { select: draft.protocol_id }) }, icon('scroll'), 'Browser'));
  };

  const render = () => { renderMeta(); renderSteps(); if (picking) renderPicker(); };

  const selectStep = (index, focus = true) => {
    const changed = selected !== index;
    selected = index;
    if (changed) { for (const [i, node] of [...stepsEl.querySelectorAll('.step')].entries()) node.classList.toggle('selected', i === index); }
    showStep(focus);
  };

  // ------------------------------------------------------------------ container picker

  const openPicker = (stepIndex, role) => {
    picking = { step: stepIndex, role };
    const current = physicalOf(draft.steps[stepIndex][role]);
    pickerCargo = current ? current.cargoId : pickerCargo ?? firstCargoWithContainers();
    renderSteps();
    renderPicker();
  };
  const closePicker = () => {
    picking = null;
    picker.hidden = true;
    world.setBeacons('hover', []);
    if (el.isConnected) world.setInset('left', el.getBoundingClientRect().right);
  };
  const firstCargoWithContainers = () => [...store.cargos.values()].find((c) => c.available && store.containersByCargo.get(c.id)?.length)?.id ?? null;

  const choose = (containerId) => {
    const { step, role } = picking;
    bind(step, role, containerId);
    const other = role === 'from' ? 'to' : 'from';
    if (draft.steps[step][other] == null) { picking = { step, role: other }; render(); showStep(false); return; }
    closePicker();
    render();
    showStep(true);
  };

  const renderPicker = () => {
    if (!picking) return;
    const step = draft.steps[picking.step];
    if (!step) { closePicker(); return; }
    const current = physicalOf(step[picking.role]);
    const currentMaterial = step[picking.role] != null ? materialOfVirt(step[picking.role]) : null;
    const cargos = [...store.cargos.values()].filter((c) => c.available && store.containersByCargo.get(c.id)?.length);
    if (!cargos.some((c) => c.id === pickerCargo)) pickerCargo = cargos[0]?.id ?? null;
    const info = h('div.picker-info.muted', 'Hover a container to see what is in it.');
    const describe = (c) => {
      const material = store.materialOf(c);
      const volume = store.volumeOf(c);
      fill(info, h('b', `${store.cargoTag(c.cargoId)} · ${store.slotName(c)}`), ' ',
        isEmptyMaterial(material) ? 'empty' : materialComponents(material, store.lookup).map((comp) => `${comp.name} ${componentAmount(comp, volume)}`).join(' · '),
        ` · max ${fmtVolume(c.maxVolume)}`, c.closed ? ' · lid closed' : '');
      world.setBeacons('hover', [{ sel: { type: 'container', id: c.id }, kind: 'hover' }]);
    };

    // top-down map of the chosen cargo
    const map = h('div.slot-map');
    const containers = store.containersByCargo.get(pickerCargo) || [];
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 135 90');
    const frame = document.createElementNS(svgNS, 'rect');
    for (const [key, value] of Object.entries({ x: 0.5, y: 0.5, width: 134, height: 89, class: 'map-frame' })) frame.setAttribute(key, value);
    svg.append(frame);
    for (const c of containers) {
      const spec = specForType(c.type, c.maxVolume);
      const material = store.materialOf(c);
      const tint = materialTint(material, store.lookup);
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', c.x);
      circle.setAttribute('cy', c.z);
      circle.setAttribute('r', Math.max(2.6, spec.diameter / 2 - 0.6));
      circle.setAttribute('class', `map-slot${current?.id === c.id ? ' current' : ''}${tint ? '' : ' empty'}${materialHazards(material, store.lookup).length ? ' risky' : ''}`);
      if (tint) circle.style.fill = `hsl(${tint.h} ${tint.s}% ${tint.l}%)`;
      circle.addEventListener('pointerenter', () => describe(c));
      circle.addEventListener('click', () => choose(c.id));
      const titleEl = document.createElementNS(svgNS, 'title');
      titleEl.textContent = `${store.slotName(c)} · ${materialLabel(material, store.lookup)} · ${fmtVolume(store.volumeOf(c))}`;
      circle.append(titleEl);
      svg.append(circle);
    }
    map.append(svg, h('div.map-hint.muted', 'front of the cargo'));

    // quick select: the same material in other containers, or empty ones for a destination
    const quick = [];
    if (currentMaterial && !isEmptyMaterial(currentMaterial)) {
      const signature = materialSignature(currentMaterial, store.lookup);
      for (const c of store.containers.values()) {
        if (c.id === current?.id || !store.cargos.get(c.cargoId)?.available) continue;
        if (materialSignature(store.materialOf(c), store.lookup) === signature) quick.push(c);
      }
    }
    const empties = picking.role === 'to' ? [...store.containers.values()].filter((c) => store.cargos.get(c.cargoId)?.available && isEmptyMaterial(store.materialOf(c))).slice(0, 4) : [];
    const quickRow = (c) => h('button.content-row', { onclick: () => choose(c.id), onpointerenter: () => describe(c) },
      h('span.mono.tagcol', store.cargoTag(c.cargoId)), h('span.mono', store.slotName(c)), h('span.grow.ellipsis', materialLabel(store.materialOf(c), store.lookup)),
      h('span.mono.muted', isEmptyMaterial(store.materialOf(c)) ? fmtVolume(c.maxVolume) : fmtVolume(store.volumeOf(c))));

    picker.hidden = false;
    world.setInset('left', picker.getBoundingClientRect().right);
    fill(picker, 
      h('div.panel-head', icon(picking.role === 'from' ? 'eject' : 'insert'), h('span.grow', `Step ${picking.step + 1} · ${picking.role === 'from' ? 'take from' : 'put into'}`),
        h('button.btn.ghost.small.icon-only', { title: 'Close', onclick: () => { closePicker(); renderSteps(); } }, icon('close'))),
      h('div.panel-body.scroll',
        h('div.picker-cargos', cargos.map((cargo) => {
          const url = world.thumbnail(cargo.id);
          return h(`button.picker-cargo${cargo.id === pickerCargo ? '.active' : ''}`, { onclick: () => { pickerCargo = cargo.id; renderPicker(); world.focusOn({ type: 'cargo', id: cargo.id }); } },
            url ? h('img', { src: url, alt: '', draggable: false }) : icon('crate', 'lg'), h('b.mono', store.cargoTag(cargo.id)), h('span.ellipsis', cargo.label || ''));
        })),
        map, info,
        quick.length ? [h('div.section-title', 'Same material elsewhere'), h('div.content-list', quick.slice(0, 8).map(quickRow))] : null,
        empties.length ? [h('div.section-title', 'Empty containers'), h('div.content-list', empties.map(quickRow))] : null,
        h('p.muted.small.gap', icon('target', 'sm'), ' You can also click a container in the 3D view.')));
  };

  // ------------------------------------------------------------------ load / save

  const fromServer = (protocol, mapping = {}) => ({
    protocol_id: protocol.protocol_id, name: protocol.protocol_name, author: protocol.protocol_author, version: protocol.protocol_version,
    software: protocol.protocol_software_version || '0.0.1',
    containers: protocol.containers.map((c) => ({
      vid: c.virtual_container_id, preferred: c.preferred_container_id ?? mapping[c.virtual_container_id] ?? null,
      material: cloneMaterial(c.material), temperature: Number(c.internal_temperature) || 20, homogeneous: c.homogeneous !== false,
    })),
    steps: protocol.steps.map((s) => ({ from: s.from_id, to: s.to_id, volume: Number(s.volume) })),
  });

  const toServer = () => {
    const used = new Set(draft.steps.flatMap((s) => [s.from, s.to]));
    return {
      protocol_name: draft.name.trim(), protocol_author: draft.author.trim() || 'unknown', protocol_version: draft.version.trim() || '0.0.1',
      protocol_software_version: draft.software,
      containers: draft.containers.filter((c) => used.has(c.vid)).map((c) => {
        const physical = physicalOf(c.vid);
        return {
          virtual_container_id: c.vid, material: physical ? cloneMaterial(store.materialOf(physical)) : c.material,
          internal_temperature: c.temperature, homogeneous: c.homogeneous, preferred_container_id: c.preferred,
        };
      }),
      steps: draft.steps.map((s, step_order) => ({ step_order, kind: 'transfer', from_id: s.from, to_id: s.to, volume: s.volume })),
    };
  };

  const refreshEstimate = async () => {
    if (draft.protocol_id == null) return;
    try {
      const plan = await app.api.plan(draft.protocol_id);
      if (!plan.can_run) estimate = { kind: 'warn', text: (plan.reasons || []).join(' · ') || 'Cannot run right now' };
      else {
        const est = estimatePlan(store, plan);
        estimate = { kind: 'accent', text: `Takes ≈ ${fmtDuration(est.autoMs)}${est.manualCount ? ` plus ${est.manualCount} manual step${est.manualCount > 1 ? 's' : ''}` : ', fully automatic'}` };
      }
    } catch { estimate = null; }
    if (!dirty) renderFoot();
  };

  const save = async () => {
    if (saving) return null;
    saving = true;
    renderFoot();
    try {
      const body = toServer();
      if (draft.protocol_id == null) draft.protocol_id = (await app.api.createProtocol(body)).protocol_id;
      else await app.api.updateProtocol(draft.protocol_id, body);
      dirty = false;
      app.toast(`Protocol "${draft.name}" saved to the warehouse`, 'ok');
      renderMeta();
      refreshEstimate();
      return draft.protocol_id;
    } catch (err) {
      app.toast(`Not saved: ${err.message}`, 'error');
      return null;
    } finally {
      saving = false;
      renderFoot();
    }
  };

  const onOpen = async (args) => {
    el.classList.remove('collapsed');
    closePicker();
    selected = -1;
    estimate = null;
    dirty = false;
    if (args.create || args.protocolId == null) {
      draft = { protocol_id: null, name: 'New protocol', author: 'me', version: '0.0.1', software: '0.0.1', containers: [], steps: [] };
      dirty = true;
      render();
      return;
    }
    draft = { protocol_id: args.protocolId, name: 'Loading…', author: '', version: '', software: '0.0.1', containers: [], steps: [] };
    render();
    try {
      const protocol = await app.api.protocol(args.protocolId);
      let mapping = {};
      try { mapping = (await app.api.canRun(args.protocolId)).mapping || {}; } catch { /* matching is optional */ }
      draft = fromServer(protocol, mapping);
      render();
      if (draft.steps.length) selectStep(0);
      refreshEstimate();
    } catch (err) {
      app.toast(`Protocol could not be read: ${err.message}`, 'error');
      app.close();
    }
  };

  store.on('snapshot', () => {
    if (!el.isConnected || !draft) return;
    const active = document.activeElement;
    if (el.contains(active) && /^(INPUT|SELECT)$/.test(active.tagName)) return;
    if (el.matches(':active') || el.querySelector(':active')) return;
    renderSteps();
    if (picking) renderPicker();
  });

  return {
    el, onOpen,
    canClose: () => !dirty || draft?.protocol_id == null && !draft.steps.length || confirm('Discard the unsaved changes to this protocol?'),
    onClose: () => {
      closePicker();
      world.setBeacons('editor', []);
      world.setArc(null, null);
      world.rig.release();
      draft = null;
    },
    handlePick: (sel) => {
      if (!picking || sel?.type !== 'container') return false;
      choose(sel.id);
      return true;
    },
  };
}
