// Entry point: boots the backend link, builds the world and wires the interface together.

import { Store } from './core/store.js';
import { config, events as configEvents, setConfig } from './core/config.js';
import { World } from './world/world.js';
import { LayerManager } from './world/layers.js';
import { boot } from './ui/boot.js';
import { LAYERS, initHud } from './ui/hud.js';
import { initInspector } from './ui/inspector.js';
import { initManual } from './ui/manual.js';
import { initPanels } from './ui/panels.js';
import { fmtVolume, materialLabel } from './shared/material.js';

const pad = (id) => String(id).padStart(2, '0');

async function main() {
  document.documentElement.dataset.uiTheme = config.uiTheme;
  const store = new Store(null);
  const world = new World(document.getElementById('world'), document.getElementById('labels'), store);
  world.start();

  const { api, sim } = await boot(document.getElementById('boot'));
  store.api = api;

  const app = {
    api, sim, store, world,
    layer: LAYERS.some((l) => l.id === config.layer) ? config.layer : 'normal',
    selection: null,
    openPanel: null,

    toast: (message, kind) => hud.toast(message, kind),

    setLayer(name) {
      app.layer = name;
      setConfig('layer', name);
      app.layers.set(name);
      hud.renderLayer();
      inspector.render();
    },

    select(sel, options) {
      world.select(sel, options);
    },

    /** Short title / subtitle for anything that can be selected. */
    describe(sel) {
      const s = store;
      switch (sel?.type) {
        case 'cargo': return { title: `Cargo ${s.cargoTag(sel.id)}`, subtitle: s.cargos.get(sel.id)?.label || '' };
        case 'container': {
          const c = s.containers.get(sel.id);
          if (!c) return { title: `Container ${sel.id}` };
          return { title: `Container #${c.id} · ${s.slotName(c)}`, subtitle: `${materialLabel(s.materialOf(c), s.lookup)} · ${fmtVolume(s.volumeOf(c))} · ${s.cargoTag(c.cargoId)}` };
        }
        case 'tip': return { title: `Tip slot #${sel.id}`, subtitle: s.cargoTag(s.tips.get(sel.id)?.cargoId) };
        case 'conveyor': {
          const c = s.conveyors.get(sel.id);
          return { title: `Conveyor CV-${pad(sel.id)}`, subtitle: c?.ym != null ? 'Lift' : c?.storage ? 'Storage shelf' : 'Belt' };
        }
        case 'pipetter': return { title: `Pipetter PIP-${pad(sel.id)}`, subtitle: '' };
        case 'deadzone': return { title: `Dead zone ${sel.id}`, subtitle: '' };
        case 'calibrator': return { title: `Calibrator ${sel.id}`, subtitle: '' };
        default: return { title: 'Unknown', subtitle: '' };
      }
    },

    open: (name, args) => panels.open(name, args),
    close: () => panels.close(),
    toggle: (name) => (app.openPanel === name ? panels.close() : panels.open(name)),

    async takeOut(cargoId) {
      try {
        await api.removeCargo(cargoId);
        app.toast(`${store.cargoTag(cargoId)} taken out of the system`, 'ok');
        await store.refresh();
        app.open('cargobay');
      } catch (err) { app.toast(err.message, 'error'); }
    },

    async runProtocol(id, name) {
      try {
        await api.run(id);
        app.toast(`Protocol "${name}" started`, 'ok');
        app.layers.setPreview(null);
        await store.refresh();
        return true;
      } catch (err) {
        app.toast(err.message, 'error');
        return false;
      }
    },

    async togglePause() {
      const pause = !store.paused;
      try {
        await (pause ? api.pause() : api.resume());
        app.toast(pause ? 'Paused: no new instruction is started' : 'Resumed', pause ? 'warn' : 'ok');
        await store.refresh();
      } catch (err) { app.toast(err.message, 'error'); }
    },

    async abort() {
      try {
        const result = await api.abort();
        app.toast(`Run aborted${result?.aborted != null ? ` · ${result.aborted} instructions dropped` : ''}`, 'warn');
        await store.refresh();
      } catch (err) { app.toast(err.message, 'error'); }
    },
  };

  app.layers = new LayerManager(app);
  const hud = initHud(app);
  const inspector = initInspector(app);
  const panels = initPanels(app, hud);
  app.panels = panels;

  // world events
  world.on('pick', ({ sel }) => {
    if (panels.handlePick?.(sel)) return;
    app.select(sel);
  });
  world.on('select', (sel) => { app.selection = sel; inspector.render(); });
  world.on('quality', () => app.toast('Effects reduced to keep the frame rate up', 'info'));

  // store events
  store.on('finished', ({ name }) => app.toast(`Protocol "${name}" finished`, 'ok'));
  store.on('error', (message) => app.toast(message, 'error'));
  store.on('online', (up) => app.toast(up ? 'Warehouse link restored' : 'Warehouse link lost, retrying…', up ? 'ok' : 'warn'));

  // configuration changes
  configEvents.on('change', (what) => {
    if (what === 'uiTheme' || what === 'all') document.documentElement.dataset.uiTheme = config.uiTheme;
    if (what === 'worldTheme' || what === 'all') world.setTheme(config.worldTheme);
    if (what === 'quality' || what === 'all') world.setQuality(config.quality);
    if (what === 'all' || what === 'prefabs') { world.rebuild(); app.layers.set(app.layer); }
    if (what === 'speed') hud.renderQueue();
  });

  // keyboard
  window.addEventListener('keydown', (e) => {
    const el = e.target;
    const typing = el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    if (e.key === 'Escape') {
      if (typing) { el.blur(); return; }
      if (app.openPanel) app.close(); else app.select(null);
      return;
    }
    if (typing || e.ctrlKey || e.metaKey) return;
    if (panels.handleKey?.(e)) return; // panels may use Alt (fine steps)
    if (e.altKey) return;
    if (/^Digit[1-5]$/.test(e.code)) { app.setLayer(LAYERS[Number(e.code.slice(5)) - 1].id); return; }
    if (e.code === 'Tab' && (!app.openPanel || app.openPanel === 'protocols')) { e.preventDefault(); app.toggle('protocols'); return; }
    if (e.code === 'KeyP') app.togglePause();
    else if (e.code === 'KeyG') app.toggle('control');
    else if (e.code === 'KeyC') app.toggle('cargobay');
    else if (e.code === 'KeyM') app.toggle('workshop');
    else if (e.code === 'KeyO') app.toggle('settings');
    else if (e.code === 'KeyH') app.toggle('help');
    else if (e.code === 'F2' && app.selection) world.focusOn(app.selection);
    else if (e.code === 'Space' && app.layer === 'prediction') { e.preventDefault(); app.layers.togglePlay(); }
  });

  store.on('ready', () => {
    document.getElementById('hud').hidden = false;
    app.layers.set(app.layer);
    hud.renderLayer();
    initManual(app);
  });
  store.connect();
  window.app = app; // handy in the browser console
}

main().catch((err) => {
  console.error(err);
  document.getElementById('boot').textContent = `Failed to start: ${err.message}`;
});
