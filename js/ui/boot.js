// Start screen: waits for the warehouse, or starts the built-in simulation.

import { h, clear, fill } from '../core/util.js';
import { Api, HttpTransport, SimTransport, resolveBaseUrl } from '../core/api.js';
import { config, setConfig } from '../core/config.js';
import { icon } from './icons.js';

const SIM_STORAGE_KEY = 'warehouse-interface.sim-db';

export const simStorage = {
  load() { return JSON.parse(localStorage.getItem(SIM_STORAGE_KEY) || 'null'); },
  save(db) { localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(db)); },
  clear() { localStorage.removeItem(SIM_STORAGE_KEY); },
};

/** Resolves with { api, sim? } once a backend is ready. */
export function boot(root) {
  return new Promise((resolve) => {
    let stopped = false;
    let timer = null;
    const status = h('div.boot-status');
    const detail = h('div.boot-detail.muted');
    const address = h('input.field.mono', { value: config.server, placeholder: 'auto (dev-server proxy or http://localhost:3210)', spellcheck: false, 'aria-label': 'Warehouse address' });
    const steps = h('ol.boot-steps');

    const finish = (result) => {
      stopped = true;
      clearTimeout(timer);
      root.classList.add('leaving');
      setTimeout(() => { clear(root); root.hidden = true; }, 600);
      resolve(result);
    };

    const startSim = async () => {
      status.textContent = 'Starting simulation…';
      const { WarehouseSim } = await import('../sim/warehouse-sim.js');
      const sim = new WarehouseSim({ storage: simStorage, timeScale: config.simSpeed || 1 });
      sim.start();
      finish({ api: new Api(new SimTransport(sim)), sim });
    };

    const setStep = (index, state, text) => {
      const li = steps.children[index];
      li.dataset.state = state;
      if (text) li.lastChild.textContent = text;
    };

    const attempt = async () => {
      if (stopped) return;
      const base = await resolveBaseUrl(config.server.trim());
      const api = new Api(new HttpTransport(base));
      detail.textContent = base;
      try {
        await api.status();
        setStep(0, 'ok', 'Warehouse answers');
      } catch {
        setStep(0, 'wait', 'Waiting for the warehouse…');
        setStep(1, 'idle', 'Read warehouse state');
        status.textContent = 'Waiting for the warehouse';
        timer = setTimeout(attempt, 2000);
        return;
      }
      try {
        const state = await api.state();
        if (!state || !Array.isArray(state.conveyors)) throw new Error('unexpected answer');
        setStep(1, 'ok', 'Warehouse state received');
        status.textContent = 'Link established';
        finish({ api });
      } catch (err) {
        setStep(1, 'fail', err.status === 404 || err.status === 405
          ? 'The warehouse does not offer GET /warehouse/state yet (see required.md)'
          : `State not readable: ${err.message}`);
        status.textContent = 'Warehouse online, state API missing';
        timer = setTimeout(attempt, 4000);
      }
    };

    steps.append(
      h('li', { dataset: { state: 'wait' } }, h('i'), h('span', 'Waiting for the warehouse…')),
      h('li', { dataset: { state: 'idle' } }, h('i'), h('span', 'Read warehouse state')),
    );
    address.addEventListener('change', () => { setConfig('server', address.value.trim()); clearTimeout(timer); attempt(); });

    root.hidden = false;
    fill(root, h('div.boot-card.panel',
      h('div.boot-sigil', { html: SIGIL }),
      h('div.eyebrow', 'Biomation'),
      h('h1.boot-title', 'Warehouse Interface'),
      status, steps, detail,
      h('div.boot-actions',
        h('label.grow', h('span.label', 'Warehouse address'), address),
        h('button.btn.gold', { onclick: startSim }, icon('play'), 'Run simulation'),
      ),
      h('p.boot-note.muted', 'The simulation runs in this browser and offers the full API the interface is built for. Add ?sim to the address to start it right away.'),
    ));

    if (new URLSearchParams(location.search).has('sim') || config.autoEnterSim) startSim(); else attempt();
  });
}

export const SIGIL = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="2.500" stroke-linejoin="round" stroke-linecap="round">
    <path d="M50 5l39 22.500v45L50 95 11 72.500v-45z"/>
    <path d="M50 17l28.500 16.500v33L50 83 21.500 66.500v-33z" opacity=".45"/>
    <path d="M42 30h16M45 30v15L33 66a4 4 0 0 0 3.500 6h27A4 4 0 0 0 67 66L55 45V30"/>
    <path d="M39 60h22" opacity=".7"/>
  </g>
  <circle cx="46" cy="64" r="2" fill="currentColor"/><circle cx="54" cy="56" r="1.500" fill="currentColor"/>
</svg>`;
