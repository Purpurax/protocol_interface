// Heads-up display: brand / link state, layer bar, operations queue, dock, toasts, hover tip.

import { h, clear, fmtClock, fmtDuration, isTouchDevice, fill } from '../core/util.js';
import { DEFAULT_RATE, config, setConfig } from '../core/config.js';
import { queueForecast } from '../core/predict.js';
import { STATUS } from '../shared/kinematics.js';
import { icon, instructionIcon } from './icons.js';
import { SIGIL } from './boot.js';

export const LAYERS = [
  { id: 'normal', label: 'Normal', icon: 'cube', hint: 'The warehouse as it is' },
  { id: 'labeled', label: 'Labeled', icon: 'tag', hint: 'What every cargo contains' },
  { id: 'touch', label: 'Touch', icon: 'anchor', hint: 'Anchored cargo and its home slot' },
  { id: 'prediction', label: 'Prediction', icon: 'forecast', hint: 'Scrub forward in time' },
  { id: 'setup', label: 'Setup', icon: 'wrench', hint: 'Models and offsets' },
];

export function initHud(app) {
  const { store, world } = app;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ brand + link state
  const linkChip = h('span.chip');
  const speedRow = h('div.sim-speed', { hidden: true });
  $('brand').append(
    h('div.brand-sigil', { html: SIGIL }),
    h('div.brand-text', h('div.brand-title', 'Warehouse'), h('div.brand-sub', linkChip, speedRow)),
  );
  const renderLink = () => {
    const state = !store.online ? ['warn', 'Offline'] : app.sim || store.simulated ? ['gold', 'Simulation'] : ['accent', 'Linked'];
    linkChip.className = `chip ${state[0]}`;
    linkChip.textContent = state[1];
    linkChip.classList.toggle('blink', !store.online);
    speedRow.hidden = !(app.sim || store.simulated);
  };
  for (const speed of [1, 2, 4, 8]) {
    speedRow.append(h('button.speed', {
      title: `Simulation speed × ${speed}`, dataset: { speed },
      onclick: async () => {
        try {
          await app.api.post('/sim/speed', { time_scale: speed });
          setConfig('simSpeed', speed);
          renderSpeed();
        } catch (err) { app.toast(err.message, 'error'); }
      },
    }, `×${speed}`));
  }
  const renderSpeed = () => { for (const b of speedRow.children) b.classList.toggle('active', Number(b.dataset.speed) === (store.ready ? store.timeScale : config.simSpeed || 1)); };
  renderSpeed();
  store.on('snapshot', renderSpeed);
  store.on('online', renderLink);
  store.on('ready', renderLink);

  // ------------------------------------------------------------------ layer bar
  const layerButtons = new Map();
  LAYERS.forEach((layer, index) => {
    const button = h('button.layer', { title: `${layer.hint} (${index + 1})`, onclick: () => app.setLayer(layer.id) },
      icon(layer.icon, 'lg'), h('span.layer-label', layer.label), h('span.kbd', index + 1));
    layerButtons.set(layer.id, button);
    $('layerbar').append(button);
  });
  const renderLayer = () => { for (const [id, button] of layerButtons) button.classList.toggle('active', id === app.layer); };

  // ------------------------------------------------------------------ dock
  const dockItems = [
    { id: 'protocols', icon: 'scroll', label: 'Protocols', key: 'Tab' },
    { id: 'control', icon: 'motor', label: 'Manual control', key: 'G' },
    { id: 'cargobay', icon: 'crate', label: 'Cargo bay', key: 'C' },
    { id: 'workshop', icon: 'anvil', label: 'Prefab workshop', key: 'M' },
    { id: 'settings', icon: 'gear', label: 'Settings', key: 'O' },
    { id: 'help', icon: 'keys', label: 'Controls', key: 'H' },
  ];
  const dockButtons = new Map();
  for (const item of dockItems) {
    const button = h('button.dock-btn', { title: `${item.label} (${item.key})`, onclick: () => app.toggle(item.id) },
      icon(item.icon, 'lg'), h('span.dock-label', item.label));
    dockButtons.set(item.id, button);
    $('dock').append(button);
  }
  const renderDock = () => { for (const [id, button] of dockButtons) button.classList.toggle('active', app.openPanel === id); };

  // ------------------------------------------------------------------ operations queue
  const queue = $('queue');
  queue.classList.add('panel');
  const queueBody = h('div.panel-body');
  const queueToggle = h('button.btn.ghost.small.icon-only.queue-toggle', { title: 'Collapse', onclick: () => queue.classList.toggle('collapsed') }, icon('down'));
  const queueState = h('span.grow');
  const pauseButton = h('button.btn.small.icon-only.pause-toggle', { onclick: () => app.togglePause() });
  queue.append(h('div.panel-head', icon('clock'), queueState, pauseButton, queueToggle), queueBody);

  // ------------------------------------------------------------------ pause
  const banner = $('paused-banner');
  fill(banner, h('div.paused-stripe'), h('div.paused-text', icon('pause', 'lg'), h('div', h('b', 'Paused'), h('div.small', 'The warehouse starts no new instruction. Moves that already run finish.'))),
    h('button.btn.gold', { onclick: () => app.togglePause() }, icon('play'), 'Resume', h('span.kbd', 'P')));
  const renderPause = () => {
    const paused = store.paused;
    banner.hidden = !paused;
    document.body.classList.toggle('is-paused', paused);
    pauseButton.classList.toggle('gold', paused);
    fill(pauseButton, icon(paused ? 'play' : 'pause'));
    pauseButton.title = paused ? 'Resume (P)' : 'Pause: start no new instruction (P)';
  };
  store.on('paused', renderPause);
  store.on('ready', renderPause);
  if (isTouchDevice()) queue.classList.add('collapsed');

  let forecast = null;
  let forecastAt = 0;
  const renderQueue = () => {
    forecast = queueForecast(store);
    forecastAt = performance.now();
    clear(queueBody);
    if (forecast.idle) {
      queueState.textContent = store.paused ? 'Operations · paused' : 'Operations · idle';
      queue.dataset.state = 'idle';
      const s = config.speed;
      queueBody.append(
        h('div.queue-idle', h('span.swatch.ok'), 'No instructions queued'),
        h('dl.kv.queue-rates',
          h('dt', 'Belt speed'), h('dd', `${s.x.rate.toFixed(1)} ms/mm${s.x.overhead >= 1 ? ` + ${s.x.overhead.toFixed(0)} ms` : ''}`),
          h('dt', 'Lift speed'), h('dd', `${s.y.rate.toFixed(1)} ms/mm${s.y.overhead >= 1 ? ` + ${s.y.overhead.toFixed(0)} ms` : ''}`),
          h('dt', 'Calibration'), h('dd', s.x.samples + s.y.samples ? `${s.x.samples + s.y.samples} moves` : `default ${DEFAULT_RATE.x} ms/mm`)),
      );
      return;
    }
    const run = store.run;
    const active = store.activeInstructions();
    const total = run?.instruction_count || store.instructions.length;
    const done = Math.max(0, total - active.length);
    queue.dataset.state = forecast.manualCount ? 'manual' : 'busy';
    queueState.textContent = store.paused ? 'Operations · paused' : 'Operations · running';
    const eta = h('span.queue-eta.mono');
    eta.dataset.role = 'eta';
    queueBody.append(
      h('div.queue-run', h('div.grow.ellipsis', run?.protocol_name || 'Queued instructions'), eta),
      h('div.meter', h('i', { style: { width: `${(done / Math.max(1, total)) * 100}%` } })),
      h('div.queue-count.muted.mono', `${done} / ${total} instructions`),
    );

    // manual intervention forecast
    if (forecast.manualCount) {
      const waiting = store.pendingManual().length > 0;
      const when = h('span.mono');
      when.dataset.role = 'manual-eta';
      queueBody.append(h('div.queue-manual', icon('hand'),
        h('div.grow', h('div', `Manual intervention · ${forecast.manualCount} step${forecast.manualCount > 1 ? 's' : ''}`),
          h('div.muted', waiting ? 'Waiting for you now' : ['first in ≈ ', when]))));
    } else {
      queueBody.append(h('div.queue-auto', icon('check'), 'Fully automatic from here'));
    }

    const items = active.map((ins) => ({ ins, at: forecast.schedule.items.get(ins.id) })).filter((x) => x.at)
      .sort((a, b) => a.at.start - b.at.start);
    const list = h('ol.queue-list');
    for (const { ins, at } of items.slice(0, 7)) {
      const running = ins.status === STATUS.RUNNING;
      const time = h('span.mono.muted', running ? 'now' : `+${fmtClock(at.start)}`);
      list.append(h(`li${running ? '.running' : ''}${ins.auto ? '' : '.manual'}`, icon(instructionIcon(ins, store)),
        h('span.grow.ellipsis', { title: store.describe(ins) }, store.describe(ins)), time));
    }
    if (items.length > 7) list.append(h('li.more.muted', `+ ${items.length - 7} more`));
    queueBody.append(list,
      h('button.btn.small.danger.block', { onclick: () => app.abort() }, icon('stop'), 'Abort run'));
    tickQueue();
  };
  const tickQueue = () => {
    if (!forecast || forecast.idle) return;
    const elapsed = performance.now() - forecastAt;
    const eta = queueBody.querySelector('[data-role="eta"]');
    if (eta) eta.textContent = `≈ ${fmtDuration(Math.max(0, forecast.total - elapsed))}${forecast.manualCount ? ' + manual' : ''}`;
    const manual = queueBody.querySelector('[data-role="manual-eta"]');
    if (manual) manual.textContent = fmtDuration(Math.max(0, (forecast.firstManualAt || 0) - elapsed));
  };
  store.on('snapshot', renderQueue);
  store.on('paused', renderQueue);
  setInterval(tickQueue, 500);

  // ------------------------------------------------------------------ toasts
  const toasts = $('toasts');
  const toast = (message, kind = 'info', ms = 4200) => {
    const el = h(`div.toast.${kind}`, icon(kind === 'error' || kind === 'warn' ? 'warning' : kind === 'ok' ? 'check' : 'dot'), h('span', message));
    toasts.append(el);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); }, ms);
  };

  // ------------------------------------------------------------------ hover tip
  const tip = $('hover-tip');
  let pointer = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY }; if (!tip.hidden) placeTip(); }, { passive: true });
  const placeTip = () => { tip.style.transform = `translate(${Math.min(pointer.x + 16, innerWidth - 220)}px, ${pointer.y + 18}px)`; };
  world.on('hover', (sel) => {
    if (!sel) { tip.hidden = true; return; }
    const info = app.describe(sel);
    fill(tip, h('b', info.title), info.subtitle ? h('span.muted', info.subtitle) : null);
    tip.hidden = false;
    placeTip();
  });

  // ------------------------------------------------------------------ touch helpers
  const pad = $('touchpad');
  if (isTouchDevice()) {
    pad.hidden = false;
    const orbit = h('button.btn.icon-only', { title: 'One finger turns the camera', onclick: () => {
      world.rig.touchOrbit = !world.rig.touchOrbit;
      orbit.classList.toggle('active', world.rig.touchOrbit);
    } }, icon('orbit'));
    pad.append(orbit, h('button.btn.icon-only', { title: 'Reset camera', onclick: () => { app.select(null); world.rig.reset(); } }, icon('home')));
  }

  renderLink();
  renderLayer();
  renderQueue();
  renderPause();
  return { toast, renderLayer, renderDock, renderQueue, renderLink, renderPause };
}
