// Game-style camera for a world that hangs on a wall.
//
//  keyboard  W A S D / arrows pan · Q E turn · R F tilt · Z X or + - zoom · Shift faster · Home reset
//  mouse     left drag pan · right drag orbit · wheel zoom to cursor · click select
//  touch     one finger pan (or orbit in orbit mode) · pinch zoom · twist turn

import * as THREE from 'three';
import { clamp, damp } from '../core/util.js';
import { config } from '../core/config.js';

const YAW_LIMIT = 1.25;
const PITCH_MIN = -0.85, PITCH_MAX = 1.05;
const DIST_MIN = 120, DIST_MAX = 9000;
const CLICK_SLOP = 6;

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.pose = { target: new THREE.Vector3(700, 700, 60), dist: 2600, yaw: 0, pitch: 0.12 };
    this.goal = { target: this.pose.target.clone(), dist: 2600, yaw: 0, pitch: 0.12 };
    this.home = null;
    this.saved = null; // pose to return to when a focus ends
    this.follow = null; // { position(): Vector3, radius }
    this.bounds = new THREE.Box3(new THREE.Vector3(-500, -300, 0), new THREE.Vector3(2200, 1900, 0));
    this.keys = new Set();
    this.pointers = new Map();
    this.touchOrbit = false;
    this.enabled = true;
    this.onClick = null; // (event) => void, a press that did not turn into a drag
    this.onUserMove = null;
    this.gesture = null;
    this.bind();
  }

  // ------------------------------------------------------------------ poses

  frame(box, instant = false) {
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const fitHeight = size.y / 2 / Math.tan(half);
    const fitWidth = size.x / 2 / (Math.tan(half) * this.camera.aspect);
    const pose = { target: new THREE.Vector3(centre.x, centre.y, 60), dist: clamp(Math.max(fitHeight, fitWidth) * 1.18 + 200, DIST_MIN, DIST_MAX), yaw: -0.22, pitch: 0.16 };
    this.home = { ...pose, target: pose.target.clone() };
    this.bounds.copy(box).expandByScalar(700);
    this.setGoal(pose);
    if (instant) this.snap();
  }

  setGoal(pose) {
    this.goal.target.copy(pose.target);
    this.goal.dist = pose.dist;
    this.goal.yaw = pose.yaw;
    this.goal.pitch = pose.pitch;
  }

  snap() {
    this.pose.target.copy(this.goal.target);
    this.pose.dist = this.goal.dist;
    this.pose.yaw = this.goal.yaw;
    this.pose.pitch = this.goal.pitch;
  }

  reset() {
    this.follow = null;
    this.saved = null;
    if (this.home) this.setGoal(this.home);
  }

  /** Focus on something (possibly moving). The previous free pose is remembered. */
  focus(position, radius) {
    if (!this.saved) this.saved = { target: this.goal.target.clone(), dist: this.goal.dist, yaw: this.goal.yaw, pitch: this.goal.pitch };
    this.follow = { position, radius };
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const aspect = this.visibleAspect || this.camera.aspect;
    const wanted = (radius / Math.tan(half)) * (aspect < 1 ? 1.25 / aspect : 1.25) + 80;
    this.goal.dist = clamp(wanted, DIST_MIN, DIST_MAX);
    if (Math.abs(this.goal.yaw) < 0.12) this.goal.yaw = -0.32;
    if (this.goal.pitch < 0.2) this.goal.pitch = 0.3;
  }

  /** Ends a focus and returns to where the user was before. */
  release() {
    this.follow = null;
    if (this.saved) this.setGoal(this.saved);
    this.saved = null;
  }

  get focused() { return !!this.follow; }

  // ------------------------------------------------------------------ input

  bind() {
    const dom = this.dom;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => this.pointerDown(e));
    dom.addEventListener('pointermove', (e) => this.pointerMove(e));
    dom.addEventListener('pointerup', (e) => this.pointerUp(e));
    dom.addEventListener('pointercancel', (e) => this.pointerUp(e, true));
    dom.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      this.keys.add(e.code);
      if (e.code === 'Home') this.reset();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  worldPerPixel() {
    return (2 * this.pose.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / this.dom.clientHeight;
  }

  userMoved() {
    // steering by hand ends the tracking; the place the user steers to becomes the new normal
    if (this.follow) { this.follow = null; this.saved = null; }
    this.onUserMove?.();
  }

  pan(dxPixels, dyPixels) {
    const scale = this.worldPerPixel();
    this.goal.target.x -= (dxPixels * scale) / Math.max(0.35, Math.cos(this.pose.yaw));
    this.goal.target.y += (dyPixels * scale) / Math.max(0.35, Math.cos(this.pose.pitch));
    this.userMoved();
  }

  orbit(dxPixels, dyPixels) {
    this.goal.yaw = clamp(this.goal.yaw - dxPixels * 0.005, -YAW_LIMIT, YAW_LIMIT);
    this.goal.pitch = clamp(this.goal.pitch + dyPixels * 0.005, PITCH_MIN, PITCH_MAX);
  }

  zoom(factor, clientX, clientY) {
    const before = this.goal.dist;
    this.goal.dist = clamp(before * factor, DIST_MIN, DIST_MAX);
    if (clientX == null || this.follow) return;
    // keep the point under the cursor where it is
    const rect = this.dom.getBoundingClientRect();
    const scale = this.worldPerPixel() * (1 - this.goal.dist / before);
    this.goal.target.x += (clientX - rect.left - rect.width / 2) * scale;
    this.goal.target.y -= (clientY - rect.top - rect.height / 2) * scale;
  }

  pointerDown(e) {
    if (!this.enabled) return;
    this.dom.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, button: e.button, type: e.pointerType, moved: false });
    if (this.pointers.size === 2) this.gesture = this.gestureState();
  }

  gestureState() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  pointerMove(e) {
    const pointer = this.pointers.get(e.pointerId);
    if (!pointer) return;
    const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (!pointer.moved && Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) > CLICK_SLOP) pointer.moved = true;
    if (!pointer.moved) return;

    if (this.pointers.size >= 2 && this.gesture) {
      for (const p of this.pointers.values()) p.moved = true;
      const next = this.gestureState();
      if (next.dist > 0 && this.gesture.dist > 0) this.zoom(this.gesture.dist / next.dist, next.cx, next.cy);
      let twist = next.angle - this.gesture.angle;
      if (twist > Math.PI) twist -= Math.PI * 2;
      if (twist < -Math.PI) twist += Math.PI * 2;
      this.goal.yaw = clamp(this.goal.yaw - twist * 0.9, -YAW_LIMIT, YAW_LIMIT);
      this.pan(next.cx - this.gesture.cx, next.cy - this.gesture.cy);
      this.gesture = next;
      return;
    }
    const orbiting = pointer.button === 2 || (pointer.type !== 'mouse' && this.touchOrbit) || (pointer.button === 0 && e.shiftKey);
    if (orbiting) this.orbit(dx, dy); else this.pan(dx, dy);
  }

  pointerUp(e, cancelled = false) {
    const pointer = this.pointers.get(e.pointerId);
    if (!pointer) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gesture = null;
    if (!cancelled && !pointer.moved && pointer.button === 0 && this.pointers.size === 0) this.onClick?.(e);
  }

  wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.zoom(Math.exp(clamp(delta, -400, 400) * (e.ctrlKey ? 0.006 : 0.0014)), e.clientX, e.clientY);
  }

  // ------------------------------------------------------------------ frame

  update(dt) {
    const keys = this.keys;
    if (this.enabled && keys.size) {
      const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.6 : 1;
      const speed = this.pose.dist * 0.85 * dt * fast * (config.cameraSpeed || 1);
      let mx = 0, my = 0;
      // the manual control panel uses the arrow keys to steer conveyors and cargo
      const arrows = !this.arrowsTaken;
      if (keys.has('KeyA') || (arrows && keys.has('ArrowLeft'))) mx -= 1;
      if (keys.has('KeyD') || (arrows && keys.has('ArrowRight'))) mx += 1;
      if (keys.has('KeyW') || (arrows && keys.has('ArrowUp'))) my += 1;
      if (keys.has('KeyS') || (arrows && keys.has('ArrowDown'))) my -= 1;
      if (mx || my) {
        this.goal.target.x += mx * speed;
        this.goal.target.y += my * speed;
        this.userMoved();
      }
      const turn = 1.3 * dt * fast;
      if (keys.has('KeyQ')) this.goal.yaw = clamp(this.goal.yaw - turn, -YAW_LIMIT, YAW_LIMIT);
      if (keys.has('KeyE')) this.goal.yaw = clamp(this.goal.yaw + turn, -YAW_LIMIT, YAW_LIMIT);
      if (keys.has('KeyR')) this.goal.pitch = clamp(this.goal.pitch + turn, PITCH_MIN, PITCH_MAX);
      if (keys.has('KeyF')) this.goal.pitch = clamp(this.goal.pitch - turn, PITCH_MIN, PITCH_MAX);
      const zoom = Math.exp(1.6 * dt * fast);
      if (keys.has('KeyZ') || keys.has('Equal') || keys.has('NumpadAdd')) this.goal.dist = clamp(this.goal.dist / zoom, DIST_MIN, DIST_MAX);
      if (keys.has('KeyX') || keys.has('Minus') || keys.has('NumpadSubtract')) this.goal.dist = clamp(this.goal.dist * zoom, DIST_MIN, DIST_MAX);
    }

    if (this.follow) this.goal.target.copy(this.follow.position());
    else {
      this.goal.target.x = clamp(this.goal.target.x, this.bounds.min.x, this.bounds.max.x);
      this.goal.target.y = clamp(this.goal.target.y, this.bounds.min.y, this.bounds.max.y);
      this.goal.target.z = 60;
    }

    const pose = this.pose, goal = this.goal;
    const follow = this.follow ? 9 : 7;
    pose.target.x = damp(pose.target.x, goal.target.x, follow, dt);
    pose.target.y = damp(pose.target.y, goal.target.y, follow, dt);
    pose.target.z = damp(pose.target.z, goal.target.z, follow, dt);
    pose.dist = damp(pose.dist, goal.dist, 6, dt);
    pose.yaw = damp(pose.yaw, goal.yaw, 7, dt);
    pose.pitch = damp(pose.pitch, goal.pitch, 7, dt);

    const cp = Math.cos(pose.pitch);
    this.camera.position.set(
      pose.target.x + Math.sin(pose.yaw) * cp * pose.dist,
      pose.target.y + Math.sin(pose.pitch) * pose.dist,
      Math.max(40, pose.target.z + Math.cos(pose.yaw) * cp * pose.dist),
    );
    this.camera.lookAt(pose.target);
  }
}

function isTyping(e) {
  const el = e.target;
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}
