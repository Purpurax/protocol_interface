// Prefab workshop: a separate 3D view in which a reusable model is put together from parts
// (STL files, boxes, cylinders, conveyor references and container collections) and aligned with
// the element it will stand in for.

import * as THREE from 'three';
import { h, clear, clamp, scrubber, fill } from '../core/util.js';
import { config, saveConfig, setAssignment } from '../core/config.js';
import { COLLECTIONS } from '../shared/collections.js';
import { CARGO_WIDTH } from '../shared/kinematics.js';
import { DIM, themeOf } from '../world/themes.js';
import { PART_TYPES, buildPart, deletePrefab, duplicatePrefab, listModels, newPart, newPrefab, storeModel } from '../world/prefabs.js';
import { disposeTree, wireBox } from '../world/shapes.js';
import { icon } from './icons.js';

const KINDS = { cargo: 'Cargo', conveyor: 'Conveyor', pipetter: 'Pipetter' };
const pad = (id) => String(id).padStart(2, '0');

export function createWorkshop(app) {
  const { store, world } = app;
  const palette = world.palette;
  let prefab = null;
  let partId = null;
  let models = [];
  let three = null; // { renderer, scene, camera, raf, objects, reference, helper }
  const orbit = { yaw: -0.6, pitch: 0.5, dist: 520, target: new THREE.Vector3(CARGO_WIDTH / 2, 30, 45) };

  const canvas = h('canvas.ws-canvas');
  const view = h('div.ws-view', canvas,
    h('div.ws-hint.muted', 'drag: turn · right-drag: move · wheel: zoom · arrow keys: nudge the selected part (Shift ×10, PgUp / PgDn for height)'),
    h('div.ws-axes.mono', h('span.axis.x', 'X →'), h('span.axis.y', 'Y ↑'), h('span.axis.z', 'Z out of the wall')));
  const left = h('aside.ws-side.panel');
  const right = h('aside.ws-side.panel');
  const el = h('section.workshop', { 'aria-label': 'Prefab workshop' },
    h('header.ws-head.panel', h('div.panel-head', icon('anvil'), h('span.grow', 'Prefab workshop'),
      h('span.muted.ws-sub', 'Build a model once, reuse it for every element of that kind'),
      h('button.btn.small.primary', { onclick: () => app.close() }, icon('check'), 'Done'))),
    h('div.ws-layout', left, view, right));

  const part = () => prefab?.parts.find((p) => p.id === partId) || null;
  const changed = () => saveConfig('workshop');

  // ------------------------------------------------------------------ 3D view

  const initThree = () => {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 5, 20000);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 2.2);
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(-400, 700, 600);
    scene.add(hemi, key);
    three = { renderer, scene, camera, hemi, objects: new Map(), reference: new THREE.Group(), helper: null, grid: null, raycaster: new THREE.Raycaster() };
    scene.add(three.reference);
    new ResizeObserver(resize).observe(view);

    let drag = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: false }; });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
      if (!drag.moved) return;
      if (drag.button === 2 || e.shiftKey) {
        const scale = orbit.dist / canvas.clientHeight * 0.9;
        const right3 = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up3 = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        orbit.target.addScaledVector(right3, -dx * scale).addScaledVector(up3, dy * scale);
      } else {
        orbit.yaw -= dx * 0.006;
        orbit.pitch = clamp(orbit.pitch + dy * 0.006, -1.4, 1.5);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved && drag.button === 0) pick(e);
      drag = null;
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.0012), 40, 6000); }, { passive: false });
    view.addEventListener('dragover', (e) => e.preventDefault());
    view.addEventListener('drop', (e) => { e.preventDefault(); upload([...e.dataTransfer.files]); });
  };

  const resize = () => {
    if (!three || !view.clientWidth) return;
    three.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    three.renderer.setSize(view.clientWidth, view.clientHeight, false);
    three.camera.aspect = view.clientWidth / view.clientHeight;
    three.camera.updateProjectionMatrix();
  };

  const applyTheme = () => {
    const theme = themeOf(config.worldTheme);
    three.scene.background = new THREE.Color(theme.background).lerp(new THREE.Color(theme.board), 0.5);
    three.hemi.color.set(theme.sky);
    three.hemi.groundColor.set(theme.ground);
    if (three.grid) disposeTree(three.grid);
    three.grid = new THREE.GridHelper(2000, 100, theme.accent, theme.boardLine);
    three.grid.material.transparent = true;
    three.grid.material.opacity = 0.45;
    three.scene.add(three.grid);
  };

  const frame = () => {
    three.raf = requestAnimationFrame(frame);
    palette.time.value = performance.now() / 1000;
    const cp = Math.cos(orbit.pitch);
    three.camera.position.set(orbit.target.x + Math.sin(orbit.yaw) * cp * orbit.dist, orbit.target.y + Math.sin(orbit.pitch) * orbit.dist, orbit.target.z + Math.cos(orbit.yaw) * cp * orbit.dist);
    three.camera.lookAt(orbit.target);
    if (three.helper) three.helper.update();
    three.renderer.render(three.scene, three.camera);
  };

  const pick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    three.raycaster.setFromCamera(ndc, three.camera);
    const hit = three.raycaster.intersectObjects([...three.objects.values()], true)[0];
    let node = hit?.object;
    while (node && !node.userData.partId) node = node.parent;
    selectPart(node ? node.userData.partId : null);
  };

  /** The rectangle the prefab replaces, as a guide to align against. */
  const buildReference = () => {
    for (const child of [...three.reference.children]) disposeTree(child);
    if (!prefab) return;
    const add = (w, hgt, d, x, y, z) => { const box = wireBox(w, hgt, d, palette.dimLine); box.position.set(x, y, z); three.reference.add(box); };
    if (prefab.kind === 'cargo') add(CARGO_WIDTH, DIM.CARGO_BASE, DIM.CARGO_DEPTH, CARGO_WIDTH / 2, DIM.CARGO_BASE / 2, DIM.CARGO_DEPTH / 2);
    else if (prefab.kind === 'conveyor') add(300, DIM.BELT_THICK, DIM.BELT_DEPTH, 150, -DIM.BELT_THICK / 2, DIM.BELT_Z0 + DIM.BELT_DEPTH / 2);
    else add(56, 300, 20, 0, 150, 12);
    const axes = new THREE.AxesHelper(60);
    three.reference.add(axes);
  };

  const pendingFit = new Set(); // freshly added models are centred on the reference once loaded
  const fitTargets = () => (prefab.kind === 'cargo' ? [CARGO_WIDTH / 2, DIM.CARGO_DEPTH / 2] : prefab.kind === 'conveyor' ? [150, DIM.BELT_Z0 + DIM.BELT_DEPTH / 2] : [0, 12]);
  const centrePart = (p, floor) => {
    const box = partBox(p);
    if (!box || box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const [x, z] = fitTargets();
    p.pos[0] = Math.round((p.pos[0] + x - centre.x) * 10) / 10;
    p.pos[2] = Math.round((p.pos[2] + z - centre.z) * 10) / 10;
    if (floor) p.pos[1] = Math.round((p.pos[1] - box.min.y) * 10) / 10;
    updatePart(p, p.type === 'belt');
    renderRight();
  };

  const rebuildPart = (p) => {
    const old = three.objects.get(p.id);
    if (old) disposeTree(old);
    const object = buildPart(p, palette, { workshop: true, onError: (message) => app.toast(message, 'error'), onLoad: () => {
      if (pendingFit.delete(p.id)) centrePart(p, true);
      refreshHelper();
    } });
    three.scene.add(object);
    three.objects.set(p.id, object);
    if (p.id === partId) refreshHelper();
  };

  const rebuildAll = () => {
    for (const object of three.objects.values()) disposeTree(object);
    three.objects.clear();
    buildReference();
    for (const p of prefab?.parts || []) rebuildPart(p);
    refreshHelper();
  };

  const refreshHelper = () => {
    if (three.helper) { disposeTree(three.helper); three.helper = null; }
    const object = three.objects.get(partId);
    if (!object) return;
    three.helper = new THREE.BoxHelper(object, themeOf(config.worldTheme).accent);
    three.scene.add(three.helper);
  };

  const partBox = (p) => {
    const object = three.objects.get(p.id);
    return object ? new THREE.Box3().setFromObject(object) : null;
  };

  // ------------------------------------------------------------------ actions

  const selectPrefab = (id) => {
    prefab = config.prefabs[id] || null;
    partId = prefab?.parts[0]?.id ?? null;
    if (prefab?.kind === 'conveyor') orbit.target.set(150, 0, 80); else if (prefab?.kind === 'pipetter') orbit.target.set(0, 150, 60); else orbit.target.set(CARGO_WIDTH / 2, 30, 45);
    rebuildAll();
    renderLeft();
    renderRight();
  };

  const selectPart = (id) => {
    partId = id;
    refreshHelper();
    renderRight();
  };

  const addPart = (type, extra) => {
    if (!prefab) return;
    const p = newPart(type, extra);
    if (type === 'belt' && prefab.kind !== 'conveyor') p.pos = [0, 0, -3];
    if (type === 'stl') pendingFit.add(p.id);
    prefab.parts.push(p);
    partId = p.id;
    rebuildPart(p);
    changed();
    renderRight();
  };

  const updatePart = (p, rebuild = true) => {
    if (rebuild) rebuildPart(p); else {
      const object = three.objects.get(p.id);
      object.position.fromArray(p.pos);
      object.rotation.set(...p.rot.map(THREE.MathUtils.degToRad));
      if (Array.isArray(p.scale)) object.scale.fromArray(p.scale); else object.scale.setScalar(p.scale);
    }
    changed();
  };

  const upload = async (files) => {
    const stl = files.filter((f) => /\.stl$/i.test(f.name));
    if (!stl.length) { app.toast('Only STL files can be added', 'warn'); return; }
    for (const file of stl) {
      try { await storeModel(file); } catch (err) { app.toast(`${file.name}: ${err.message}`, 'error'); }
    }
    models = await listModels();
    renderLeft();
    app.toast(`${stl.length} model${stl.length > 1 ? 's' : ''} stored in this browser`, 'ok');
  };

  // ------------------------------------------------------------------ left: prefabs + model library

  const renderLeft = () => {
    const prefabs = Object.values(config.prefabs);
    const fileInput = h('input', { type: 'file', accept: '.stl', multiple: true, hidden: true, onchange: () => upload([...fileInput.files]) });
    fill(left, 
      h('div.panel-head', icon('model'), h('span.grow', 'Prefabs')),
      h('div.panel-body.scroll',
        prefabs.length ? h('div.content-list', prefabs.map((p) => h(`button.content-row${p.id === prefab?.id ? '.current' : ''}`, { onclick: () => selectPrefab(p.id) },
          icon(p.kind === 'cargo' ? 'crate' : p.kind === 'conveyor' ? 'belt' : 'pipette'), h('span.grow.ellipsis', p.name), h('span.muted.small', `${p.parts.length} part${p.parts.length === 1 ? '' : 's'}`))))
          : h('p.muted.small', 'No prefabs yet. Create one for a cargo, a conveyor or the pipetter.'),
        h('div.row.wrap.gap', Object.entries(KINDS).map(([kind, label]) => h('button.btn.small', { onclick: () => selectPrefab(newPrefab(kind, `${label} prefab`).id) }, icon('plus'), label))),

        h('div.section-title', `Model library · ${models.length}`),
        h('div.row.wrap', h('button.btn.small', { onclick: () => fileInput.click() }, icon('upload'), 'Add STL files'), fileInput),
        models.length ? h('div.content-list.gap', models.map((m) => h('button.content-row', { disabled: !prefab, title: prefab ? 'Add this model to the prefab' : 'Create a prefab first',
          onclick: () => addPart('stl', { src: m.url, name: m.name.replace(/^Biomation - /, '').replace(/\.stl$/i, '') }) },
        icon('model'), h('span.grow.ellipsis', m.name.replace(/^Biomation - /, '').replace(/\.stl$/i, '')), m.local ? h('span.chip', 'local') : null)))
          : h('p.muted.small.gap', 'Put STL files into the models folder next to index.html (served by serve.mjs), or add them here: they are then kept in this browser.')));
  };

  // ------------------------------------------------------------------ right: prefab + part properties

  const vector = (p, key, step, unit, rebuild = false) => h('div.vec', ['x', 'y', 'z'].map((axis, i) => h('div.row', h(`span.axis.${axis}`, axis.toUpperCase()),
    scrubber({ value: p[key][i], step, unit, digits: 1, onchange: (v) => { p[key][i] = v; updatePart(p, rebuild); } }))));
  const number = (label, obj, key, opts, after) => h('label', h('span.label', label), scrubber({ value: obj[key], step: 1, digits: 1, ...opts, onchange: (v) => { obj[key] = v; after(); } }));

  const partProps = (p) => {
    const rebuild = () => updatePart(p, true);
    const rows = [h('label', h('span.label', 'Name'), h('input.field', { value: p.name, maxLength: 60, oninput: (e) => { p.name = e.target.value; changed(); }, onchange: () => renderRight() }))];
    if (p.type === 'stl') {
      const select = h('select.field', { onchange: () => { p.src = select.value; rebuild(); } }, h('option', { value: '' }, 'Choose a model…'),
        models.map((m) => h('option', { value: m.url, selected: m.url === p.src }, m.name)),
        p.src && !models.some((m) => m.url === p.src) ? h('option', { value: p.src, selected: true }, `${p.src} (missing)`) : null);
      rows.push(h('label', h('span.label', 'Model file'), select));
    } else if (p.type === 'box') {
      rows.push(h('span.label', 'Size'), vector(p, 'size', 1, 'mm', true));
    } else if (p.type === 'cylinder') {
      rows.push(h('div.form-grid', number('Radius', p, 'radius', { min: 0.5, unit: 'mm' }, rebuild), number('Height', p, 'height', { min: 0.5, unit: 'mm' }, rebuild)));
    } else if (p.type === 'belt') {
      rows.push(
        h('span.label', 'Conveyor shape'),
        h('div.row.wrap',
          h(`button.btn.small${p.mode === 'through' ? '.active' : ''}`, { title: 'An endless rectangle that runs through in both directions', onclick: () => { p.mode = 'through'; rebuild(); renderRight(); } }, 'Going through'),
          h(`button.btn.small${p.mode === 'edge' ? '.active' : ''}`, { title: 'Starts at this point and runs on to one side', onclick: () => { p.mode = 'edge'; rebuild(); renderRight(); } }, 'Edge'),
          p.mode === 'edge' ? h('button.btn.small', { title: 'Which side runs on', onclick: () => { p.dir = -p.dir; rebuild(); renderRight(); } }, icon(p.dir >= 0 ? 'right' : 'left'), p.dir >= 0 ? 'runs on to +X' : 'runs on to −X') : null),
        h('div.form-grid', number('Depth', p, 'width', { min: 5, unit: 'mm' }, rebuild), number('Thickness', p, 'thickness', { min: 1, unit: 'mm' }, rebuild)));
    } else if (p.type === 'collection') {
      const preset = h('select.field', { onchange: () => { Object.assign(p, COLLECTIONS[preset.value], { preset: preset.value, name: COLLECTIONS[preset.value].name }); rebuild(); renderRight(); } },
        Object.entries(COLLECTIONS).map(([key, c]) => h('option', { value: key, selected: key === p.preset }, c.name)));
      const shape = h('select.field', { onchange: () => { p.shape = shape.value; p.isTips = p.shape === 'tip'; rebuild(); } },
        ['tube', 'well', 'tip', 'dish'].map((s) => h('option', { value: s, selected: s === p.shape }, s[0].toUpperCase() + s.slice(1))));
      rows.push(
        h('div.form-grid', h('label', h('span.label', 'Start from'), preset), h('label', h('span.label', 'Single container'), shape)),
        h('div.form-grid',
          number('Columns', p, 'cols', { min: 1, max: 24, digits: 0 }, rebuild), number('Rows', p, 'rows', { min: 1, max: 16, digits: 0 }, rebuild),
          number('Spacing X', p, 'pitchX', { min: 0, step: 0.5, unit: 'mm' }, rebuild), number('Spacing Z', p, 'pitchZ', { min: 0, step: 0.5, unit: 'mm' }, rebuild),
          number('Diameter', p, 'diameter', { min: 1, step: 0.5, unit: 'mm' }, rebuild), number('Height', p, 'height', { min: 1, unit: 'mm' }, rebuild),
          number('Box height', p, 'housing', { min: 0, unit: 'mm' }, rebuild)),
        h('p.muted.small', 'One container is a single tube, well or tip. The collection is the box around them; on a cargo the containers themselves come from the warehouse.'));
    }

    const colorSelect = h('select.field', { onchange: () => { p.color = colorSelect.value === 'custom' ? '#8899aa' : colorSelect.value || null; rebuild(); renderRight(); } },
      [['', 'Theme metal'], ['accent', 'Accent'], ['accent2', 'Second accent'], ['custom', 'Custom colour']].map(([value, label]) =>
        h('option', { value, selected: value === (p.color && p.color.startsWith('#') ? 'custom' : p.color || '') }, label)));
    rows.push(
      h('div.section-title', 'Placement'),
      h('span.label', 'Position'), vector(p, 'pos', 1, 'mm', p.type === 'belt'),
      h('span.label.gap', 'Rotation'), vector(p, 'rot', 5, '°'),
      h('div.row.wrap.gap', ['x', 'y', 'z'].map((axis, i) => h('button.btn.small', { title: `Turn 90° around ${axis.toUpperCase()}`, onclick: () => { p.rot[i] = ((p.rot[i] + 90 + 180) % 360) - 180; updatePart(p, false); renderRight(); } }, `${axis.toUpperCase()} +90°`))),
      h('div.form-grid.gap',
        h('label', h('span.label', 'Scale'), scrubber({ value: Array.isArray(p.scale) ? p.scale[0] : p.scale, step: 0.05, min: 0.001, digits: 3, onchange: (v) => { p.scale = v; updatePart(p, false); } })),
        p.type !== 'belt' && p.type !== 'collection' ? h('label', h('span.label', 'Colour'), h('div.row', colorSelect,
          p.color && p.color.startsWith('#') ? h('input.color', { type: 'color', value: p.color, oninput: (e) => { p.color = e.target.value; rebuild(); } }) : null)) : null),
      h('div.row.wrap.gap',
        h('button.btn.small', { title: 'Centre the part on the reference rectangle', onclick: () => centrePart(p, false) }, icon('target'), 'Centre'),
        h('button.btn.small', { title: 'Lower / raise the part until it stands on the origin plane', onclick: () => {
          const box = partBox(p);
          if (!box || box.isEmpty()) return;
          p.pos[1] = Math.round((p.pos[1] - box.min.y) * 10) / 10;
          updatePart(p, p.type === 'belt');
          renderRight();
        } }, icon('down'), 'Stand on floor'),
        h('button.btn.small', { onclick: () => {
          const copy = JSON.parse(JSON.stringify(p));
          copy.id = Math.random().toString(36).slice(2, 9);
          copy.name = `${p.name} copy`;
          copy.pos[0] += 20;
          prefab.parts.push(copy);
          partId = copy.id;
          rebuildPart(copy);
          changed();
          renderRight();
        } }, icon('copy'), 'Duplicate'),
        h('button.btn.small.danger', { onclick: () => removePart(p) }, icon('trash'), 'Remove')));
    return rows;
  };

  const removePart = (p) => {
    prefab.parts = prefab.parts.filter((x) => x !== p);
    const object = three.objects.get(p.id);
    if (object) disposeTree(object);
    three.objects.delete(p.id);
    partId = prefab.parts[0]?.id ?? null;
    refreshHelper();
    changed();
    renderRight();
  };

  const elementsOf = (kind) => {
    if (kind === 'cargo') return [...store.cargos.values()].filter((c) => c.available).map((c) => ({ id: c.id, label: `${store.cargoTag(c.id)} ${c.label || ''}` }));
    if (kind === 'conveyor') return [...store.conveyors.values()].map((c) => ({ id: c.id, label: `CV-${pad(c.id)}` }));
    return [...store.pipetters.values()].map((p) => ({ id: p.id, label: `PIP-${pad(p.id)}` }));
  };

  const renderRight = () => {
    clear(right);
    if (!prefab) {
      right.append(h('div.panel-head', icon('wrench'), h('span.grow', 'Prefab')), h('div.panel-body', h('p.muted', 'Create or pick a prefab on the left.')));
      return;
    }
    const scroll = right.querySelector('.panel-body')?.scrollTop || 0;
    const users = Object.entries(config.assignments).filter(([, a]) => a.prefab === prefab.id).map(([key]) => key);
    const elements = elementsOf(prefab.kind);
    const assignSelect = h('select.field', elements.map((e) => h('option', { value: e.id }, e.label)));
    const current = part();
    const body = h('div.panel-body.scroll',
      h('div.form-grid',
        h('label', h('span.label', 'Prefab name'), h('input.field', { value: prefab.name, maxLength: 60, oninput: (e) => { prefab.name = e.target.value; changed(); }, onchange: renderLeft })),
        h('label', h('span.label', 'Made for'), (() => { const s = h('select.field', { onchange: () => { prefab.kind = s.value; buildReference(); changed(); renderLeft(); renderRight(); } },
          Object.entries(KINDS).map(([kind, label]) => h('option', { value: kind, selected: kind === prefab.kind }, label))); return s; })())),
      h('label.switch.gap', h('input', { type: 'checkbox', checked: prefab.hideDefault, onchange: (e) => { prefab.hideDefault = e.target.checked; changed(); } }), h('i'), 'Replaces the default rectangle'),
      h('div.row.gap', assignSelect, h('button.btn.small', { disabled: !elements.length, onclick: () => {
        setAssignment(prefab.kind, Number(assignSelect.value), { prefab: prefab.id, offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });
        app.toast('Assigned. Fine-tune the offset in the Setup layer.', 'ok');
        renderRight();
      } }, icon('link'), 'Use for')),
      users.length ? h('div.row.wrap.gap', users.map((key) => h('button.chip.target', { title: 'Stop using the prefab for this element', onclick: () => { const [type, id] = key.split(':'); setAssignment(type, Number(id), null); renderRight(); } }, key.replace(':', ' '), icon('close')))) : null,
      h('div.row.wrap.gap',
        h('button.btn.small', { onclick: () => selectPrefab(duplicatePrefab(prefab).id) }, icon('copy'), 'Duplicate prefab'),
        h('button.btn.small.danger', { onclick: () => { if (confirm(`Delete the prefab "${prefab.name}"?`)) { deletePrefab(prefab.id); selectPrefab(Object.keys(config.prefabs)[0] || null); } } }, icon('trash'), 'Delete prefab')),

      h('div.section-title', `Parts · ${prefab.parts.length}`),
      prefab.parts.length ? h('div.content-list', prefab.parts.map((p) => h(`button.content-row${p.id === partId ? '.current' : ''}`, { onclick: () => selectPart(p.id) },
        icon(p.type === 'stl' ? 'model' : p.type === 'belt' ? 'belt' : p.type === 'collection' ? 'flask' : 'cube'), h('span.grow.ellipsis', p.name), h('span.muted.small', PART_TYPES[p.type].label)))) : h('p.muted.small', 'Add a model from the library on the left, or one of the basic parts below.'),
      h('div.row.wrap.gap',
        h('button.btn.small', { onclick: () => addPart('box') }, icon('plus'), 'Box'),
        h('button.btn.small', { onclick: () => addPart('cylinder') }, icon('plus'), 'Cylinder'),
        h('button.btn.small', { title: 'An endless conveyor running through', onclick: () => addPart('belt', { mode: 'through', name: 'Conveyor (through)' }) }, icon('plus'), 'Conveyor through'),
        h('button.btn.small', { title: 'A conveyor that starts here and runs on to one side', onclick: () => addPart('belt', { mode: 'edge', name: 'Conveyor (edge)' }) }, icon('plus'), 'Conveyor edge'),
        h('button.btn.small', { title: 'Rack, plate or tip box: a grid of single containers', onclick: () => addPart('collection') }, icon('plus'), 'Collection')),
      current ? [h('div.section-title', `Selected · ${PART_TYPES[current.type].label}`), ...partProps(current)] : null);
    right.append(h('div.panel-head', icon('wrench'), h('span.grow.ellipsis', prefab.name)), body);
    body.scrollTop = scroll;
  };

  // ------------------------------------------------------------------ panel

  return {
    el,
    async onOpen(args) {
      world.paused = true;
      if (!three) initThree();
      applyTheme();
      resize();
      models = await listModels();
      const wanted = args.prefabId && config.prefabs[args.prefabId] ? args.prefabId : prefab && config.prefabs[prefab.id] ? prefab.id : Object.keys(config.prefabs)[0] || null;
      selectPrefab(wanted);
      cancelAnimationFrame(three.raf);
      frame();
      requestAnimationFrame(resize);
    },
    onClose() {
      cancelAnimationFrame(three?.raf);
      world.paused = false;
      saveConfig('prefabs'); // the world rebuilds with the edited prefabs
    },
    handleKey(e) {
      const p = part();
      if (!p) return true;
      const step = e.shiftKey ? 10 : 1;
      const moves = { ArrowLeft: [0, -step], ArrowRight: [0, step], ArrowUp: [2, -step], ArrowDown: [2, step], PageUp: [1, step], PageDown: [1, -step] };
      if (moves[e.code]) {
        e.preventDefault();
        p.pos[moves[e.code][0]] += moves[e.code][1];
        updatePart(p, p.type === 'belt');
        renderRight();
      } else if (e.code === 'Delete') removePart(p);
      return true;
    },
  };
}
