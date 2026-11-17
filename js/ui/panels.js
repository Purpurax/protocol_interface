// Panel manager: one screen-level panel is open at a time (protocol browser, editor, cargo bay,
// prefab workshop, settings, controls).

import { createProtocolBrowser } from './protocols.js';
import { createEditor } from './editor.js';
import { createCargoBay } from './cargobay.js';
import { createControl } from './control.js';
import { createWorkshop } from './workshop.js';
import { createSettings, createHelp } from './settings.js';

export function initPanels(app, hud) {
  const root = document.getElementById('panels');
  const registry = {
    protocols: createProtocolBrowser(app),
    editor: createEditor(app),
    cargobay: createCargoBay(app),
    control: createControl(app),
    workshop: createWorkshop(app),
    settings: createSettings(app),
    help: createHelp(app),
  };
  let current = null;

  const close = () => {
    if (!current) return;
    const panel = current;
    if (panel.canClose && !panel.canClose()) return;
    current = null;
    panel.onClose?.();
    panel.el.remove();
    app.world.setInset('left', 0);
    app.openPanel = null;
    delete document.body.dataset.panel;
    hud.renderDock();
  };

  const open = (name, args) => {
    const panel = registry[name];
    if (!panel) return;
    if (current && current !== panel) {
      close();
      if (current) return; // the open panel refused to close (unsaved changes)
    }
    current = panel;
    app.openPanel = name;
    document.body.dataset.panel = name;
    if (!panel.el.isConnected) root.append(panel.el);
    panel.onOpen?.(args || {});
    // docked panels cover the left part of the world: centre the view on what stays visible
    const docked = panel.el.matches('.editor, .side-panel');
    app.world.setInset('left', docked ? panel.el.getBoundingClientRect().right : 0);
    hud.renderDock();
  };

  return {
    open, close,
    handlePick: (sel) => !!current?.handlePick?.(sel),
    handleKey: (event) => !!current?.handleKey?.(event),
    get current() { return current; },
  };
}
