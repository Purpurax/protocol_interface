// Manual control: steer one conveyor (belt / lift) or place one cargo. The panel shows the permitted
// range with the warehouse's own rules (shared/limits.js) and a ghost of the target in 3D; the
// warehouse checks again before it accepts anything.
//
//   conveyor  ← →  belt distance · ↑ ↓  lift distance · Enter  send the move
//   cargo     ← →  target position · ↑ ↓  conveyor above / below · click a belt to aim there
//             Enter  drive there (the warehouse plans the way) · Shift+Enter  set the position
//   Shift ×10 · Alt ×0.1 (steps of 5 mm, 50 mm, 0.5 mm)

import * as THREE from 'three';
import { h, fill, fmtMm } from '../core/util.js';
import { CARGO_WIDTH } from '../shared/kinematics.js';
import { beltRange, liftRange, nearestFreePosition, positionProblem, sticksOut } from '../shared/limits.js';
import { DIM } from '../world/themes.js';
import { disposeTree, wireBox } from '../world/shapes.js';
import { icon } from './icons.js';

const { CARGO_Z0, CARGO_DEPTH, CARGO_BASE, BELT_Z0, BELT_DEPTH } = DIM;
const STEP = 5;
const pad = (id) => String(id).padStart(2, '0');
const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v * 10) / 10;
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtMm(Math.abs(v))}`;

export function createControl(app) {
  const { store, world } = app;
  const body = h('div.panel-body.scroll');
  const el = h('aside.side-panel.panel.control-panel', { 'aria-label': 'Manual control' },
    h('div.panel-head', icon('motor'), h('span.grow', 'Manual control'),
      h('button.btn.ghost.small.icon-only', { title: 'Close (Esc)', onclick: () => app.close() }, icon('close'))),
    body);

  // what is steered, and the pending target
  let target = null; // { type: 'conveyor' | 'cargo', id }
  const jog = { x: 0, y: 0 }; // conveyor: pending distances
  const aim = { conveyorId: null, x: 0 }; // cargo: wanted position
  let sending = false;
  let ghosts = [];
  let ui = {};

  // ------------------------------------------------------------------ state from the store

  const cargosOn = (conveyorId, exceptId = null) => [...store.cargos.values()]
    .filter((c) => c.available && c.conveyorId === conveyorId && c.id !== exceptId);

  /** Permitted distances of the selected conveyor: { x: [min,max] | null, y: [min,max] | null, why } */
  const conveyorRanges = (conv) => {
    const x = conv.xm != null ? beltRange(conv.lenX, cargosOn(conv.id).map((c) => c.rel)) : null;
    let y = null, why = null;
    if (conv.ym != null) {
      const hanging = [...store.cargos.values()].find((c) => c.available && sticksOut(c.rel, store.conveyors.get(c.conveyorId)?.lenX ?? Infinity));
      if (hanging) why = `${store.cargoTag(hanging.id)} hangs over the edge of CV-${pad(hanging.conveyorId)}, the lift has to wait`;
      else y = liftRange(store.motors.get(conv.ym)?.value ?? 0, conv.lenY);
    }
    return { x, y, why };
  };

  /** Conveyors from top to bottom (the lift where it stands now). */
  const conveyorsByHeight = () => [...store.conveyors.values()].sort((a, b) => store.conveyorY(b.id) - store.conveyorY(a.id));

  const aimProblem = () => {
    const conv = store.conveyors.get(aim.conveyorId);
    if (!conv) return 'edge';
    return positionProblem(conv.lenX, cargosOn(conv.id, target.id).map((c) => c.rel), aim.x);
  };

  const blocked = () => {
    if (!store.online) return 'The warehouse is not reachable';
    if (store.busy) return 'Instructions are queued. Manual control waits until they have finished (or abort them).';
    return null;
  };

  // ------------------------------------------------------------------ target

  const setTarget = (sel) => {
    if (!sel || (sel.type !== 'conveyor' && sel.type !== 'cargo')) return false;
    if (sel.type === 'cargo' && !store.cargos.get(sel.id)?.available) return false;
    target = { type: sel.type, id: sel.id };
    jog.x = 0; jog.y = 0;
    if (sel.type === 'cargo') {
      const cargo = store.cargos.get(sel.id);
      aim.conveyorId = cargo.conveyorId;
      aim.x = round(cargo.rel);
    }
    render();
    return true;
  };

  const step = (e) => STEP * (e?.shiftKey ? 10 : 1) * (e?.altKey ? 0.1 : 1);

  const nudge = (axis, direction, e) => {
    if (!target) return;
    if (target.type === 'conveyor') {
      const ranges = conveyorRanges(store.conveyors.get(target.id));
      const range = ranges[axis];
      if (!range) return;
      jog[axis] = round(clampTo(jog[axis] + direction * step(e), range));
    } else if (axis === 'x') {
      const conv = store.conveyors.get(aim.conveyorId);
      aim.x = round(clampTo(aim.x + direction * step(e), [0, conv.lenX - CARGO_WIDTH]));
    } else {
      const list = conveyorsByHeight();
      const index = list.findIndex((c) => c.id === aim.conveyorId);
      const next = list[index - direction];
      if (!next) return;
      const absolute = store.conveyors.get(aim.conveyorId).x + aim.x;
      aim.conveyorId = next.id;
      aim.x = round(clampTo(absolute - next.x, [0, Math.max(0, next.lenX - CARGO_WIDTH)]));
    }
    update();
  };

  // ------------------------------------------------------------------ actions

  const act = async (fn, okText) => {
    if (sending) return;
    sending = true;
    update();
    try {
      const result = await fn();
      app.toast(okText(result), 'ok');
      jog.x = 0; jog.y = 0;
      await store.refresh();
    } catch (err) {
      app.toast(err.message, 'error');
    } finally {
      sending = false;
      render();
    }
  };

  const sendMove = (axis) => {
    const distance = jog[axis];
    if (!target || target.type !== 'conveyor' || !distance || blocked()) return;
    act(() => app.api.moveConveyor(target.id, axis, distance),
      () => `CV-${pad(target.id)}: ${axis === 'x' ? 'belt' : 'lift'} ${signed(distance)} queued${store.paused ? ' (paused)' : ''}`);
  };

  const navigate = () => {
    if (!target || target.type !== 'cargo' || blocked() || aimProblem() === 'edge') return;
    act(() => app.api.navigateCargo(target.id, { on_conveyor_id: aim.conveyorId, relative_x: aim.x }),
      (r) => r.instruction_count
        ? `${store.cargoTag(target.id)}: ${r.instruction_count} moves queued to CV-${pad(aim.conveyorId)}${store.paused ? ' (paused)' : ''}`
        : `${store.cargoTag(target.id)} is already there`);
  };

  const overwrite = () => {
    if (!target || target.type !== 'cargo' || blocked() || aimProblem()) return;
    act(() => app.api.setCargoPosition(target.id, { on_conveyor_id: aim.conveyorId, relative_x: aim.x }),
      () => `${store.cargoTag(target.id)} is now recorded at ${fmtMm(aim.x)} on CV-${pad(aim.conveyorId)}`);
  };

  const snapToFree = () => {
    const conv = store.conveyors.get(aim.conveyorId);
    const free = nearestFreePosition(conv.lenX, cargosOn(conv.id, target.id).map((c) => c.rel), aim.x);
    if (free == null) { app.toast(`CV-${pad(conv.id)} has no free spot`, 'warn'); return; }
    aim.x = round(free);
    update();
  };

  // ------------------------------------------------------------------ 3D ghosts

  const clearGhosts = () => { for (const ghost of ghosts) disposeTree(ghost); ghosts = []; };
  const ghostBox = (w, height, d, material) => {
    const object = wireBox(w, height, d, material);
    object.renderOrder = 18;
    world.overlay.add(object);
    ghosts.push(object);
    return object;
  };

  /** Rebuilds the ghosts for the current target (positions follow every frame). */
  const buildGhosts = () => {
    clearGhosts();
    if (!target) return;
    if (target.type === 'conveyor') {
      const conv = store.conveyors.get(target.id);
      for (const cargo of cargosOn(conv.id)) {
        const height = world.views.cargo.get(cargo.id)?.topY ?? CARGO_BASE;
        const box = ghostBox(CARGO_WIDTH, height, CARGO_DEPTH, world.palette.ghostLine);
        box.userData.place = () => box.position.set(conv.x + cargo.rel + jog.x + CARGO_WIDTH / 2, store.conveyorY(conv.id) + jog.y + height / 2, CARGO_Z0 + CARGO_DEPTH / 2);
        box.userData.show = () => Math.abs(jog.x) > 0.05 || Math.abs(jog.y) > 0.05;
      }
      if (conv.ym != null) {
        const lift = ghostBox(conv.lenX, 22, BELT_DEPTH, world.palette.ghostLine);
        lift.userData.place = () => lift.position.set(conv.x + conv.lenX / 2, store.conveyorY(conv.id) + jog.y - 10, BELT_Z0 + BELT_DEPTH / 2);
        lift.userData.show = () => Math.abs(jog.y) > 0.05;
      }
    } else {
      const height = world.views.cargo.get(target.id)?.topY ?? CARGO_BASE;
      const ok = ghostBox(CARGO_WIDTH, height, CARGO_DEPTH, world.palette.ghostLine);
      const bad = ghostBox(CARGO_WIDTH, height, CARGO_DEPTH, world.palette.warnLine);
      const beam = ghostBox(2, 2400, 2, world.palette.dimLine);
      const place = (box) => () => {
        const conv = store.conveyors.get(aim.conveyorId);
        if (conv) box.position.set(conv.x + aim.x + CARGO_WIDTH / 2, store.conveyorY(conv.id) + (box === beam ? 1200 : height / 2), CARGO_Z0 + CARGO_DEPTH / 2);
      };
      ok.userData.place = place(ok);
      bad.userData.place = place(bad);
      beam.userData.place = place(beam);
      ok.userData.show = () => !aimProblem();
      bad.userData.show = () => !!aimProblem();
      beam.userData.show = () => true;
    }
  };

  let pulse = 0;
  const frame = (dt) => {
    pulse += dt;
    const scale = 1 + Math.sin(pulse * 5) * 0.015;
    for (const ghost of ghosts) {
      ghost.userData.place?.();
      ghost.visible = ghost.userData.show ? ghost.userData.show() : true;
      ghost.scale.setScalar(scale);
    }
  };

  // ------------------------------------------------------------------ UI

  /** A horizontal track showing the permitted range, the current value and the target. */
  const rangeTrack = (range, value, onpick) => {
    const [lo, hi] = range;
    const span = Math.max(1e-6, hi - lo);
    const pct = (v) => `${((v - lo) / span) * 100}%`;
    const knob = h('i.track-knob');
    const zero = h('i.track-zero');
    const bar = h('div.range-track', { title: 'Click or drag to choose' }, h('i.track-fill'), zero, knob);
    const place = (v) => {
      knob.style.left = pct(v);
      zero.style.left = pct(Math.min(hi, Math.max(lo, 0)));
      const fillEl = bar.firstChild;
      const a = Math.min(0, v), b = Math.max(0, v);
      fillEl.style.left = pct(Math.max(lo, a));
      fillEl.style.width = `calc(${pct(Math.min(hi, b))} - ${pct(Math.max(lo, a))})`;
    };
    place(value);
    const pick = (e) => {
      const rect = bar.getBoundingClientRect();
      const v = lo + ((e.clientX - rect.left) / rect.width) * span;
      onpick(round(clampTo(Math.round(v / (e.altKey ? 0.5 : STEP)) * (e.altKey ? 0.5 : STEP), range)));
    };
    bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); bar.dragging = true; pick(e); });
    bar.addEventListener('pointermove', (e) => { if (bar.dragging) pick(e); });
    bar.addEventListener('pointerup', (e) => { bar.dragging = false; bar.releasePointerCapture(e.pointerId); });
    bar.place = place;
    return bar;
  };

  const pad3 = (onLeft, onRight, onUp, onDown, labels) => h('div.dpad',
    h('button.btn.icon-only.dpad-up', { title: labels.up, disabled: !onUp, onclick: (e) => onUp?.(e) }, icon('up')),
    h('button.btn.icon-only.dpad-left', { title: labels.left, disabled: !onLeft, onclick: (e) => onLeft?.(e) }, icon('left')),
    h('div.dpad-core', icon(target.type === 'cargo' ? 'crate' : 'belt', 'lg')),
    h('button.btn.icon-only.dpad-right', { title: labels.right, disabled: !onRight, onclick: (e) => onRight?.(e) }, icon('right')),
    h('button.btn.icon-only.dpad-down', { title: labels.down, disabled: !onDown, onclick: (e) => onDown?.(e) }, icon('down')));

  const conveyorView = () => {
    const conv = store.conveyors.get(target.id);
    const ranges = conveyorRanges(conv);
    ui.readX = h('b.mono.readout');
    ui.readY = h('b.mono.readout');
    ui.trackX = ranges.x ? rangeTrack(ranges.x, jog.x, (v) => { jog.x = v; update(); }) : null;
    ui.trackY = ranges.y ? rangeTrack(ranges.y, jog.y, (v) => { jog.y = v; update(); }) : null;
    ui.sendX = h('button.btn.primary.block', { onclick: () => sendMove('x') }, icon('play'), 'Move belt', h('span.kbd', 'Enter'));
    ui.sendY = h('button.btn.primary.block', { onclick: () => sendMove('y') }, icon('lift'), 'Move lift');
    return [
      h('div.control-target', h('span.chip.accent', icon(conv.ym != null ? 'lift' : 'belt'), `CV-${pad(conv.id)}`),
        h('span.muted.small', `${cargosOn(conv.id).length} cargo on the belt · ${fmtMm(conv.lenX)} long`)),
      pad3((e) => nudge('x', -1, e), (e) => nudge('x', 1, e), ranges.y ? (e) => nudge('y', 1, e) : null, ranges.y ? (e) => nudge('y', -1, e) : null,
        { left: 'Belt to the left (←)', right: 'Belt to the right (→)', up: 'Lift up (↑)', down: 'Lift down (↓)' }),
      h('div.section-title', 'Belt'),
      ranges.x ? [
        h('div.row', h('span.grow.muted.small', `Permitted ${signed(ranges.x[0])} … ${signed(ranges.x[1])}`), ui.readX),
        ui.trackX, ui.sendX,
      ] : h('p.muted.small', conv.xm == null ? 'This conveyor has no belt motor.' : 'The cargo on this belt does not fit on it; fix its position first.'),
      conv.ym != null ? [
        h('div.section-title', 'Lift'),
        ranges.y ? [
          h('div.row', h('span.grow.muted.small', `Height ${fmtMm(store.motors.get(conv.ym)?.value ?? 0)} of ${fmtMm(conv.lenY)} · permitted ${signed(ranges.y[0])} … ${signed(ranges.y[1])}`), ui.readY),
          ui.trackY, ui.sendY,
        ] : h('p.hazard-note', icon('warning'), ranges.why),
      ] : null,
      h('p.muted.small.gap', 'Choose a distance with the arrow keys, the pad or the track (Shift ×10, Alt ×0.1). The ghost shows where the cargo will be. Nothing moves until you send it.'),
    ];
  };

  const cargoView = () => {
    const cargo = store.cargos.get(target.id);
    const conv = store.conveyors.get(aim.conveyorId);
    const last = Math.max(0, conv.lenX - CARGO_WIDTH);
    ui.conveyorSelect = h('select.field', { onchange: () => {
      const next = store.conveyors.get(Number(ui.conveyorSelect.value));
      const absolute = store.conveyors.get(aim.conveyorId).x + aim.x;
      aim.conveyorId = next.id;
      aim.x = round(clampTo(absolute - next.x, [0, Math.max(0, next.lenX - CARGO_WIDTH)]));
      render();
    } }, conveyorsByHeight().map((c) => h('option', { value: c.id, selected: c.id === aim.conveyorId },
      `CV-${pad(c.id)}${c.ym != null ? ' · lift' : c.storage ? ' · storage' : ''} · ${cargosOn(c.id, target.id).length} other cargo`)));
    ui.readX = h('b.mono.readout');
    ui.status = h('div.aim-status');
    ui.trackX = rangeTrack([0, last], aim.x, (v) => { aim.x = v; update(); });
    ui.navigate = h('button.btn.primary.block', { onclick: navigate }, icon('play'), 'Drive there', h('span.kbd', 'Enter'));
    ui.overwrite = h('button.btn.gold.block', { onclick: () => {
      if (confirm(`Record ${store.cargoTag(target.id)} at ${fmtMm(aim.x)} on CV-${pad(aim.conveyorId)}? Nothing moves: use this when the cargo already stands there.`)) overwrite();
    } }, icon('edit'), 'Set position (nothing moves)', h('span.kbd', '⇧ Enter'));
    return [
      h('div.control-target', h('span.chip.accent', icon('crate'), store.cargoTag(cargo.id)), h('span.grow.ellipsis', cargo.label || ''),
        h('span.muted.small', `now CV-${pad(cargo.conveyorId)} @ ${fmtMm(cargo.rel)}`)),
      pad3((e) => nudge('x', -1, e), (e) => nudge('x', 1, e), (e) => nudge('y', 1, e), (e) => nudge('y', -1, e),
        { left: 'Target to the left (←)', right: 'Target to the right (→)', up: 'Conveyor above (↑)', down: 'Conveyor below (↓)' }),
      h('div.section-title', 'Target'),
      h('label', h('span.label', 'Conveyor'), ui.conveyorSelect),
      h('div.row.gap', h('span.grow.muted.small', `Position on the belt · 0 … ${fmtMm(last)}`), ui.readX),
      ui.trackX,
      ui.status,
      h('div.control-actions', ui.navigate, ui.overwrite,
        h('button.btn.small', { onclick: snapToFree }, icon('target'), 'Nearest free spot'),
        h('button.btn.small', { onclick: () => setTarget(target) }, icon('home'), 'Back to where it is')),
      h('p.muted.small.gap', 'Aim with the arrow keys, the track, or click a belt in the 3D view. "Drive there" lets the warehouse find the way and move other cargo aside; "Set position" only corrects the record.'),
    ];
  };

  /** Refreshes the values that change while steering, without rebuilding the panel. */
  const update = () => {
    if (!target) return;
    const why = blocked();
    if (ui.blockNote) { ui.blockNote.hidden = !why; ui.blockNote.lastChild.textContent = why || ''; }
    if (target.type === 'conveyor') {
      if (ui.readX) ui.readX.textContent = signed(jog.x);
      if (ui.readY) ui.readY.textContent = signed(jog.y);
      ui.trackX?.place(jog.x);
      ui.trackY?.place(jog.y);
      if (ui.sendX) ui.sendX.disabled = !!why || sending || !jog.x;
      if (ui.sendY) ui.sendY.disabled = !!why || sending || !jog.y;
    } else {
      const problem = aimProblem();
      const cargo = store.cargos.get(target.id);
      const here = cargo && cargo.conveyorId === aim.conveyorId && Math.abs(cargo.rel - aim.x) < 0.05;
      ui.readX.textContent = fmtMm(aim.x);
      ui.trackX.place(aim.x);
      if (ui.conveyorSelect && Number(ui.conveyorSelect.value) !== aim.conveyorId) ui.conveyorSelect.value = aim.conveyorId;
      ui.status.className = `aim-status ${problem ? 'warn' : 'ok'}`;
      fill(ui.status, icon(problem ? 'warning' : 'check'),
        here ? 'This is where it stands now'
          : problem === 'collision' ? 'Collides with another cargo: the warehouse will push it aside when driving, setting is not possible'
            : problem === 'edge' ? 'Over the edge of the belt'
              : 'Free spot');
      ui.navigate.disabled = !!why || sending || problem === 'edge' || here;
      ui.overwrite.disabled = !!why || sending || !!problem || here;
    }
  };

  const render = () => {
    if (!el.isConnected) return;
    shown = signature();
    ui = {};
    clearGhosts();
    if (target && (!world.exists(target) || (target.type === 'cargo' && !store.cargos.get(target.id)?.available))) target = null;
    if (target?.type === 'cargo' && !store.conveyors.has(aim.conveyorId)) setTarget(target);
    ui.blockNote = h('div.hazard-note.control-block', icon('warning'), h('span'));
    const steerables = [
      ...[...store.conveyors.values()].map((c) => ({ type: 'conveyor', id: c.id, label: `CV-${pad(c.id)}`, icon: c.ym != null ? 'lift' : 'belt' })),
      ...[...store.cargos.values()].filter((c) => c.available).sort((a, b) => a.id - b.id).map((c) => ({ type: 'cargo', id: c.id, label: store.cargoTag(c.id), icon: 'crate' })),
    ];
    fill(body,
      store.paused ? h('div.paused-note', icon('pause'), 'The warehouse is paused: moves are queued and start after you resume.') : null,
      ui.blockNote,
      h('div.section-title', 'Steer'),
      h('div.control-pick', steerables.map((s) => h(`button.btn.small${target?.type === s.type && target?.id === s.id ? '.active' : ''}`, {
        onclick: () => { app.select({ type: s.type, id: s.id }, { focus: false }); setTarget(s); },
      }, icon(s.icon), s.label))),
      target ? (target.type === 'conveyor' ? conveyorView() : cargoView())
        : h('p.muted', 'Pick a conveyor or a cargo above, or click one in the 3D view.'),
    );
    buildGhosts();
    update();
  };

  // ------------------------------------------------------------------ keep in step with the warehouse

  /** What the panel shows depends on: positions, motor values, queue, pause. */
  const signature = () => [
    [...store.cargos.values()].map((c) => `${c.id}:${c.available}:${c.conveyorId}:${c.rel}`).join(','),
    [...store.motors.values()].map((m) => `${m.id}:${m.value}`).join(','),
    store.busy, store.paused, store.online,
  ].join('|');
  let shown = '';
  const rerender = () => {
    if (!el.isConnected || sending) return;
    const key = signature();
    if (key === shown) { update(); return; }
    // never rebuild under the user's pointer or while a field is focused
    const dragging = ui.trackX?.dragging || ui.trackY?.dragging;
    if (dragging || (el.contains(document.activeElement) && document.activeElement.tagName === 'SELECT')) return;
    shown = key;
    render();
  };
  store.on('snapshot', rerender);
  store.on('paused', rerender);
  store.on('online', rerender);

  // ------------------------------------------------------------------ panel hooks

  return {
    el,
    onOpen(args) {
      world.rig.arrowsTaken = true;
      world.updaters.add(frame);
      const sel = args?.sel || app.selection;
      if (!setTarget(sel)) render();
    },
    onClose() {
      world.rig.arrowsTaken = false;
      world.updaters.delete(frame);
      clearGhosts();
    },
    /** A click in the world: aim the cargo at a belt, or steer what was clicked. */
    handlePick(sel) {
      if (target?.type === 'cargo' && sel?.type === 'conveyor' && world.lastPickPoint) {
        const conv = store.conveyors.get(sel.id);
        aim.conveyorId = conv.id;
        aim.x = round(clampTo(Math.round((world.lastPickPoint.x - conv.x - CARGO_WIDTH / 2) / STEP) * STEP, [0, Math.max(0, conv.lenX - CARGO_WIDTH)]));
        render();
        return true;
      }
      if (sel?.type === 'conveyor' || sel?.type === 'cargo') { setTarget(sel); return false; }
      if (sel?.type === 'container') { setTarget({ type: 'cargo', id: store.containers.get(sel.id)?.cargoId }); return false; }
      return false;
    },
    handleKey(e) {
      if (!target) return false;
      const keys = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['y', 1], ArrowDown: ['y', -1] };
      if (keys[e.code]) {
        e.preventDefault();
        nudge(keys[e.code][0], keys[e.code][1], e);
        return true;
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        if (target.type === 'conveyor') sendMove(jog.x ? 'x' : 'y');
        else if (e.shiftKey) overwrite();
        else navigate();
        return true;
      }
      return false;
    },
    refresh: () => render(),
  };
}
