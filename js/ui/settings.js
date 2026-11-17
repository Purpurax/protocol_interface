// Settings (themes, quality, configuration file) and the controls cheat sheet.

import { h, clear, fill } from '../core/util.js';
import { config, exportConfig, freshSpeed, importConfig, resetConfig, saveConfig, setConfig } from '../core/config.js';
import { WORLD_THEMES } from '../world/themes.js';
import { icon } from './icons.js';
import { simStorage } from './boot.js';

const UI_THEMES = {
  arcane: { name: 'Arcane Lab', colors: ['#0e131a', '#35e6ff', '#f2b84b'] },
  neon: { name: 'Neon Noir', colors: ['#120b1e', '#ff2fd0', '#f9f002'] },
  undercity: { name: 'Undercity', colors: ['#11140d', '#9cff2f', '#ff8a1f'] },
  cleanroom: { name: 'Clean Room', colors: ['#f4f6f8', '#0a6fe8', '#d95a00'] },
};
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

function frame(title, iconName, onClose, cls = '') {
  const body = h('div.panel-body.scroll');
  const el = h(`section.modal.panel${cls}`, { role: 'dialog', 'aria-label': title },
    h('div.panel-head', icon(iconName), h('span.grow', title), h('button.btn.ghost.small.icon-only', { title: 'Close (Esc)', onclick: onClose }, icon('close'))),
    body);
  return { el, body };
}

export function createSettings(app) {
  const { el, body } = frame('Settings', 'gear', () => app.close());

  const themeTiles = (current, themes, onPick) => h('div.theme-tiles', Object.entries(themes).map(([id, theme]) =>
    h(`button.tile.theme-tile${id === current ? '.active' : ''}`, { onclick: () => onPick(id) },
      h('span.theme-preview', theme.colors.map((color) => h('i', { style: { background: color } }))), h('span', theme.name))));

  const render = () => {
    const worldThemes = Object.fromEntries(Object.entries(WORLD_THEMES).map(([id, t]) => [id, { name: t.name, colors: [hex(t.board), hex(t.accent), hex(t.accent2)] }]));
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try { await importConfig(file); app.toast('Configuration imported', 'ok'); render(); } catch (err) { app.toast(`Import failed: ${err.message}`, 'error'); }
    } });
    const s = config.speed;
    fill(body, 
      h('div.section-title', 'Interface theme'),
      themeTiles(config.uiTheme, UI_THEMES, (id) => { setConfig('uiTheme', id); render(); }),
      h('div.section-title', 'World theme'),
      themeTiles(config.worldTheme, worldThemes, (id) => { setConfig('worldTheme', id); render(); }),
      h('div.row.gap', h('button.btn.small', { onclick: () => { setConfig('worldTheme', config.uiTheme in WORLD_THEMES ? config.uiTheme : 'arcane'); render(); } }, icon('link'), 'Match the interface')),

      h('div.section-title', 'Graphics and camera'),
      h('div.form-grid',
        h('label', h('span.label', 'Effects quality'), (() => {
          const select = h('select.field', { onchange: () => setConfig('quality', select.value) },
            [['auto', 'Automatic'], ['high', 'High (bloom)'], ['low', 'Low (mobile)']].map(([value, label]) => h('option', { value, selected: config.quality === value }, label)));
          return select;
        })()),
        h('label', h('span.label', `Keyboard camera speed · ${config.cameraSpeed.toFixed(1)}×`),
          h('input', { type: 'range', min: 0.4, max: 2.5, step: 0.1, value: config.cameraSpeed, onchange: (e) => { setConfig('cameraSpeed', Number(e.target.value)); render(); } }))),
      h('label.switch.gap', h('input', { type: 'checkbox', checked: config.followSelection, onchange: (e) => setConfig('followSelection', e.target.checked) }), h('i'),
        'Camera focuses and tracks the selected element'),

      h('div.section-title', 'Motion prediction'),
      h('p.muted.small', 'A belt or lift move of x mm is assumed to take 30·x ms (pipetter: 10·x ms) until real moves have been measured. Every finished move then corrects the estimate (time per mm plus a fixed start-up time); belt (x) and lift (y) are learned separately.'),
      h('dl.kv',
        [['Belt (x)', s.x], ['Lift (y)', s.y], ['Pipetter', s.tool]].map(([label, m]) => [h('dt', label),
          h('dd', `${m.rate.toFixed(2)} ms/mm + ${m.overhead.toFixed(0)} ms · ${m.samples} moves`)])),
      h('button.btn.small.gap', { onclick: () => {
        for (const kind of Object.keys(config.speed)) config.speed[kind] = freshSpeed(kind);
        saveConfig('speed');
        render();
      } }, 'Forget measured speeds'),

      h('div.section-title', 'Configuration file'),
      h('p.muted.small', 'Themes, prefabs, which model belongs to which element id, offsets and learned speeds are stored in this browser. Export them to a file to keep or move them.'),
      h('div.row.wrap',
        h('button.btn.small', { onclick: exportConfig }, icon('download'), 'Export'),
        h('button.btn.small', { onclick: () => fileInput.click() }, icon('upload'), 'Import'), fileInput,
        h('button.btn.small.danger', { onclick: () => { if (confirm('Reset every interface setting, prefab and model assignment?')) { resetConfig(); render(); } } }, 'Reset')),

      h('div.section-title', 'Warehouse link'),
      h('label', h('span.label', 'Warehouse address (empty: automatic)'),
        h('input.field.mono', { value: config.server, placeholder: 'http://localhost:3210', spellcheck: false, onchange: (e) => { setConfig('server', e.target.value.trim()); app.toast('Reload the page to connect to the new address', 'info'); } })),
      h('label.switch.gap', h('input', { type: 'checkbox', checked: config.autoEnterSim, onchange: (e) => setConfig('autoEnterSim', e.target.checked) }), h('i'),
        'Start the simulation without waiting for the warehouse'),
      app.sim ? h('div.row.wrap.gap',
        h('button.btn.small.danger', { onclick: async () => {
          if (!confirm('Reset the simulated warehouse to its initial state? Protocols created in the simulation are lost.')) return;
          simStorage.clear();
          await app.api.post('/sim/reset');
          await app.store.refresh();
          app.toast('Simulation reset', 'ok');
        } }, 'Reset simulation'),
        h('button.btn.small', { onclick: () => { setConfig('autoEnterSim', false); location.search = ''; } }, 'Leave simulation')) : null,
    );
  };

  return { el: h('div.modal-backdrop', { onpointerdown: (e) => { if (e.target === e.currentTarget) app.close(); } }, el), onOpen: render };
}

export function createHelp(app) {
  const { el, body } = frame('Controls', 'keys', () => app.close(), '.help');
  const key = (...keys) => h('span.keys', keys.map((k) => h('span.kbd', k)));
  const rows = [
    ['Move along the wall', key('W', 'A', 'S', 'D'), 'drag'],
    ['Turn / tilt the camera', key('Q', 'E', 'R', 'F'), 'right-drag · two-finger twist'],
    ['Zoom', key('Z', 'X'), 'wheel · pinch'],
    ['Faster', key('Shift'), ''],
    ['Reset the camera', key('Home'), 'home button'],
    ['Select / focus an element', '', 'click · tap'],
    ['Focus the selection again', key('F2'), 'target button'],
    ['Deselect, close a panel', key('Esc'), 'click the board'],
    ['Layers', key('1', '2', '3', '4', '5'), 'layer bar'],
    ['Play / pause the prediction', key('Space'), 'play button'],
    ['Protocol browser', key('Tab'), ''],
    ['Pause / resume the warehouse', key('P'), 'pause button in the queue'],
    ['Manual control panel', key('G'), 'dock'],
    ['Steer the conveyor or cargo (in the panel)', key('←', '→', '↑', '↓'), 'slider · click a belt'],
    ['Finer / coarser steps', key('Alt', 'Shift'), ''],
    ['Send the move · set the position', key('Enter'), 'buttons'],
    ['Cargo bay · Workshop · Settings', key('C', 'M', 'O'), 'dock'],
  ];
  body.append(h('table.help-table', h('thead', h('tr', h('th', 'Action'), h('th', 'Keyboard'), h('th', 'Mouse / touch'))),
    h('tbody', rows.map(([action, keys, pointer]) => h('tr', h('td', action), h('td', keys), h('td.muted', pointer))))));
  return { el: h('div.modal-backdrop', { onpointerdown: (e) => { if (e.target === e.currentTarget) app.close(); } }, el) };
}
