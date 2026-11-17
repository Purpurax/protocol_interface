// Manual instructions: the warehouse asks the user to do something by hand. The task is announced
// in the HUD and pointed at in the 3D world until it is accepted and marked as done.

import { h, fill } from '../core/util.js';
import { icon } from './icons.js';

const TASKS = {
  open: { icon: 'lid', verb: 'Open lid', title: 'Open a container' },
  transfer: { icon: 'transfer', verb: 'Transfer', title: 'Transfer by hand' },
  refill: { icon: 'tip', verb: 'Refill tips', title: 'Refill the tip box' },
  task: { icon: 'hand', verb: 'Manual task', title: 'Manual task' },
};

let audio = null;
function chime() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const now = audio.currentTime;
    [660, 880].forEach((frequency, i) => {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = 'triangle';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.3);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.32);
    });
  } catch { /* audio not allowed yet */ }
}

export function initManual(app) {
  const { store, world } = app;
  const root = document.getElementById('manual');
  let shownId = null;
  let busy = false;

  const targetsOf = (manual) => {
    const containers = manual.containerIds.filter((id) => store.containers.has(id)).map((id) => ({ type: 'container', id }));
    if (containers.length) return containers;
    return manual.cargoIds.filter((id) => store.cargos.get(id)?.available).map((id) => ({ type: 'cargo', id }));
  };

  const render = () => {
    const pending = store.pendingManual();
    const ins = pending[0];
    if (!ins) {
      if (shownId != null) { world.setBeacons('manual', []); world.setArc(null, null); }
      shownId = null;
      root.hidden = true;
      document.body.classList.remove('manual-pending');
      return;
    }
    const manual = ins.manual;
    const task = TASKS[manual.task] || TASKS.task;
    const targets = targetsOf(manual);
    const isNew = shownId !== manual.id;
    shownId = manual.id;
    document.body.classList.add('manual-pending');

    // point at it in the world
    const kinds = manual.task === 'transfer' && targets.length === 2 ? ['from', 'to'] : null;
    world.setBeacons('manual', targets.map((sel, i) => ({
      sel, kind: kinds ? kinds[i] : 'manual',
      text: kinds ? (i === 0 ? 'Take from here' : 'Put in here') : task.verb,
    })));
    world.setArc(kinds ? targets[0] : null, kinds ? targets[1] : null);
    if (isNew) { chime(); if (targets[0]) app.select(targets[0]); }

    const act = async (fn, okText) => {
      if (busy) return;
      busy = true;
      try { await fn(); if (okText) app.toast(okText, 'ok'); await store.refresh(); } catch (err) { app.toast(err.message, 'error'); } finally { busy = false; render(); }
    };
    root.hidden = false;
    root.className = `panel manual-banner${manual.accepted ? ' accepted' : ''}`;
    fill(root, 
      h('div.manual-stripe'),
      h('div.manual-icon', icon(task.icon, 'lg')),
      h('div.manual-text',
        h('div.eyebrow', manual.accepted ? 'Manual task · in progress' : `Manual intervention needed${pending.length > 1 ? ` · ${pending.length} waiting` : ''}`),
        h('div.manual-command', manual.command),
        h('div.row.wrap', targets.map((sel) => {
          const info = app.describe(sel);
          return h('button.chip.target', { onclick: () => app.select(sel) }, icon('target'), `${info.title}${info.subtitle ? ` · ${info.subtitle}` : ''}`);
        }))),
      h('div.manual-actions',
        targets.length ? h('button.btn', { onclick: () => app.select(targets[0]) }, icon('eye'), 'Show') : null,
        manual.accepted
          ? h('button.btn.primary', { onclick: () => act(() => app.api.completeManual(manual.id), 'Task completed') }, icon('check'), 'Mark as done')
          : h('button.btn.primary', { onclick: () => act(() => app.api.acceptManual(manual.id)) }, icon('hand'), 'I am on it')),
    );
  };

  store.on('snapshot', render);
  store.on('manual', () => { if (shownId == null) store.refresh(); });
  render();
  return { render };
}
