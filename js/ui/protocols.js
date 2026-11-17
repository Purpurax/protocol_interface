// Protocol browser: every protocol is a card with its own emblem; pick one to view, edit, preview
// or run it. The time estimate comes from the warehouse's plan and the learned motor speeds.

import { h, add, clear, fmtDuration, fill } from '../core/util.js';
import { estimatePlan } from '../core/predict.js';
import { fmtVolume, materialHazards, materialLabel } from '../shared/material.js';
import { emblem, hazardBadges, icon } from './icons.js';

export function createProtocolBrowser(app) {
  const { store } = app;
  const grid = h('div.proto-grid.scroll');
  const detail = h('div.proto-detail.scroll');
  const el = h('div.modal-backdrop', { onpointerdown: (e) => { if (e.target === e.currentTarget) app.close(); } },
    h('section.modal.wide.panel.proto-browser', { role: 'dialog', 'aria-label': 'Protocols' },
      h('div.panel-head', icon('scroll'), h('span.grow', 'Protocols'),
        h('button.btn.small.gold', { onclick: () => app.open('editor', { create: true }) }, icon('plus'), 'New protocol'),
        h('button.btn.ghost.small.icon-only', { title: 'Close (Esc)', onclick: () => app.close() }, icon('close'))),
      h('div.proto-layout', grid, detail)));

  let list = [];
  let selectedId = null;
  const details = new Map(); // id -> { protocol, plan, estimate, error }
  const seedOf = (p) => `${p.protocol_id}:${p.protocol_name}`;

  const load = async () => {
    try {
      list = await app.api.protocols();
    } catch (err) {
      list = [];
      fill(grid, h('div.empty', icon('warning', 'lg'), h('p', `Protocols could not be loaded: ${err.message}`),
        h('p.muted', 'The warehouse needs GET /protocols for this (see required.md).')));
      clear(detail);
      return;
    }
    details.clear();
    if (!list.some((p) => p.protocol_id === selectedId)) selectedId = list[0]?.protocol_id ?? null;
    renderGrid();
    select(selectedId);
  };

  const renderGrid = () => {
    clear(grid);
    for (const p of list) {
      const info = details.get(p.protocol_id);
      grid.append(h(`button.proto-card${p.protocol_id === selectedId ? '.active' : ''}`, { onclick: () => select(p.protocol_id), ondblclick: () => app.open('editor', { protocolId: p.protocol_id }) },
        emblem(seedOf(p), 84),
        h('div.proto-name', p.protocol_name),
        h('div.proto-meta.muted', `v${p.protocol_version} · ${p.protocol_author}`),
        h('div.row.wrap.proto-chips',
          h('span.chip', icon('transfer'), `${p.step_count ?? '?'} step${p.step_count === 1 ? '' : 's'}`),
          info?.estimate ? h('span.chip.accent', icon('clock'), fmtDuration(info.estimate.autoMs)) : null,
          info?.estimate?.manualCount ? h('span.chip.gold', icon('hand'), String(info.estimate.manualCount)) : null,
          info?.plan && !info.plan.can_run ? h('span.chip.warn', 'blocked') : null)));
    }
    grid.append(h('button.proto-card.new', { onclick: () => app.open('editor', { create: true }) }, h('span.proto-plus', icon('plus', 'lg')), h('div.proto-name', 'New protocol'), h('div.proto-meta.muted', 'Build it visually')));
  };

  const fetchDetail = async (id) => {
    if (details.has(id)) return details.get(id);
    const info = { protocol: null, plan: null, estimate: null, error: null };
    try {
      info.protocol = await app.api.protocol(id);
      try {
        info.plan = await app.api.plan(id);
        if (info.plan?.instructions?.length) info.estimate = estimatePlan(store, info.plan);
      } catch (err) { info.planError = err.message; }
    } catch (err) { info.error = err.message; }
    details.set(id, info);
    return info;
  };

  const select = async (id) => {
    selectedId = id;
    renderGrid();
    if (id == null) { fill(detail, h('div.empty', h('p.muted', 'No protocols yet. Create the first one.'))); return; }
    const summary = list.find((p) => p.protocol_id === id);
    fill(detail, h('div.empty', h('p.muted', 'Reading protocol…')));
    const info = await fetchDetail(id);
    if (selectedId !== id) return;
    renderGrid();
    renderDetail(summary, info);
  };

  const containerText = (info, vid) => {
    const virt = info.protocol.containers.find((c) => c.virtual_container_id === vid);
    const physicalId = info.plan?.mapping?.[vid] ?? virt?.preferred_container_id;
    const physical = physicalId != null ? store.containers.get(physicalId) : null;
    const material = physical ? store.materialOf(physical) : virt?.material;
    return {
      where: physical ? `${store.cargoTag(physical.cargoId)} · ${store.slotName(physical)}` : 'unbound',
      what: material ? materialLabel(material, store.lookup) : '?',
      hazards: material ? materialHazards(material, store.lookup) : [],
      bound: !!physical,
    };
  };

  const renderDetail = (summary, info) => {
    clear(detail);
    if (info.error) { detail.append(h('div.empty', icon('warning', 'lg'), h('p', info.error))); return; }
    const p = info.protocol;
    const est = info.estimate;
    const plan = info.plan;
    const busy = store.busy;
    const blocked = plan && !plan.can_run;
    const steps = h('ol.flow');
    p.steps.forEach((step, index) => {
      const from = containerText(info, step.from_id), to = containerText(info, step.to_id);
      const end = (side, cls) => h(`div.flow-end.${cls}${side.bound ? '' : '.unbound'}`, h('div.flow-where.mono', side.where), h('div.flow-what.ellipsis', { title: side.what }, side.what), hazardBadges(side.hazards));
      steps.append(h('li', h('span.flow-index.mono', String(index + 1).padStart(2, '0')), end(from, 'from'),
        h('div.flow-move', icon('transfer'), h('span.mono', fmtVolume(step.volume))), end(to, 'to')));
    });

    add(detail,
      h('div.proto-hero', emblem(seedOf(summary), 120),
        h('div.grow', h('div.eyebrow', `Protocol ${p.protocol_id}`), h('h2.proto-title', p.protocol_name),
          h('div.muted', `Version ${p.protocol_version} · by ${p.protocol_author}`))),
      h('div.proto-stats',
        h('div.stat', h('div.eyebrow', 'Estimated time'), h('div.stat-value.mono', est ? fmtDuration(est.autoMs) : '–'),
          h('div.muted.small', est ? ({ calibrated: 'from measured motor speeds', learning: 'still learning the motor speeds', default: 'assuming 30 ms per mm for belts' })[est.confidence] : (info.planError || 'no plan available'))),
        h('div.stat', h('div.eyebrow', 'Manual steps'), h(`div.stat-value.mono${est?.manualCount ? '.accent2' : ''}`, est ? String(est.manualCount) : '–'),
          h('div.muted.small', est?.manualCount ? 'you will be asked to help' : 'runs on its own')),
        h('div.stat', h('div.eyebrow', 'Machine moves'), h('div.stat-value.mono', plan?.instructions ? String(plan.instructions.length) : '–'),
          h('div.muted.small', `${p.steps.length} protocol step${p.steps.length === 1 ? '' : 's'}`))),
      blocked ? h('div.hazard-note', icon('warning'), (plan.reasons || []).join(' · ') || 'Cannot run right now') : null,
      h('div.proto-actions',
        h('button.btn.primary', { disabled: blocked || busy || !plan, title: busy ? 'Another protocol is running' : '', onclick: async () => { if (await app.runProtocol(p.protocol_id, p.protocol_name)) app.close(); } }, icon('play'), 'Run'),
        h('button.btn', { disabled: !est, onclick: () => {
          app.layers.setPreview({ name: p.protocol_name, instructions: est.instructions, schedule: est.schedule });
          app.setLayer('prediction');
          app.close();
        } }, icon('forecast'), 'Preview'),
        h('button.btn', { onclick: () => app.open('editor', { protocolId: p.protocol_id }) }, icon('edit'), 'Edit'),
        h('button.btn', { onclick: async () => {
          try {
            const { protocol_id: _ignored, ...copy } = p;
            const result = await app.api.createProtocol({ ...copy, protocol_name: `${p.protocol_name} copy` });
            selectedId = result.protocol_id;
            app.toast('Protocol duplicated', 'ok');
            load();
          } catch (err) { app.toast(err.message, 'error'); }
        } }, icon('copy'), 'Duplicate'),
        h('button.btn.danger', { onclick: async () => {
          if (!confirm(`Delete protocol "${p.protocol_name}"?`)) return;
          try { await app.api.deleteProtocol(p.protocol_id); app.toast('Protocol deleted', 'ok'); load(); } catch (err) { app.toast(err.message, 'error'); }
        } }, icon('trash'), 'Delete')),
      h('div.section-title', 'Steps'),
      p.steps.length ? steps : h('p.muted', 'This protocol has no steps yet.'),
    );
  };

  return { el, onOpen: (args) => { if (args.select != null) selectedId = args.select; load(); } };
}
