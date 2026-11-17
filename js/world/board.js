// The backdrop: an endless pegboard (IKEA Skådis style) everything appears to be hooked into.

import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uBase; uniform vec3 uHole; uniform vec3 uLine; uniform vec3 uAccent; uniform vec3 uFog;
  uniform vec3 uCamera; uniform vec3 uFocus; uniform float uFogNear; uniform float uFogFar; uniform float uTime; uniform float uGlow;
  varying vec3 vWorld;

  float slot(vec2 q) {            // 5 x 15 mm rounded slot
    q.y -= clamp(q.y, -5.0, 5.0);
    return length(q) - 2.5;
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 p = vWorld.xy;
    // two lattices, 40 mm pitch, offset by half a cell: the Skadis hole pattern
    float d = min(slot(mod(p, 40.0) - 20.0), slot(mod(p + 20.0, 40.0) - 20.0));
    float aa = max(fwidth(d), 0.0001);
    float detail = clamp(1.6 - aa * 0.45, 0.0, 1.0);          // fade the pattern out when it gets sub-pixel
    float hole = (1.0 - smoothstep(-aa, aa, d)) * detail;
    float rim = (1.0 - smoothstep(0.0, 1.4 + aa, abs(d - 0.5))) * detail;

    // boards are 760 x 560 mm panels with a small gap between them
    vec2 panel = abs(mod(p + vec2(380.0, 280.0), vec2(760.0, 560.0)) - vec2(380.0, 280.0));
    float seamDist = min(380.0 - panel.x, 280.0 - panel.y);
    float seam = 1.0 - smoothstep(1.2, 1.2 + max(fwidth(seamDist), 0.001) * 1.5, seamDist);

    vec2 cell = floor(p / 40.0);
    float grain = (hash(cell) - 0.5) * 0.035 + (hash(floor(p / 3.0)) - 0.5) * 0.02 * detail;
    vec3 color = uBase * (1.0 + grain);
    color = mix(color, uLine, rim * 0.7);
    color = mix(color, uHole, hole);
    color = mix(color, uHole, seam * 0.85);

    // arcane touch: a slow sweep that lights the hole rims, plus a soft pool of light around the focus
    float sweep = smoothstep(0.92, 1.0, sin((p.x + p.y * 0.6) * 0.0016 - uTime * 0.35) * 0.5 + 0.5);
    float pool = exp(-dot(p - uFocus.xy, p - uFocus.xy) / 9.0e5);
    color += uAccent * (rim * (0.10 * sweep + 0.012 * pool) + pool * 0.008) * uGlow;

    float dist = length(vWorld - uCamera);
    color = mix(color, uFog, smoothstep(uFogNear, uFogFar, dist));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Board {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uBase: { value: new THREE.Color() }, uHole: { value: new THREE.Color() }, uLine: { value: new THREE.Color() },
        uAccent: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uCamera: { value: new THREE.Vector3() },
        uFocus: { value: new THREE.Vector3() }, uFogNear: { value: 2000 }, uFogFar: { value: 8000 }, uTime: { value: 0 },
        uGlow: { value: 1 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.scale.setScalar(60000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  applyTheme(theme) {
    const u = this.material.uniforms;
    u.uBase.value.set(theme.board);
    u.uHole.value.set(theme.boardHole);
    u.uLine.value.set(theme.boardLine);
    u.uAccent.value.set(theme.accent);
    u.uFog.value.set(theme.fog);
    u.uFogNear.value = theme.fogNear;
    u.uFogFar.value = theme.fogFar;
    u.uGlow.value = theme.dark ? 1 : 0.35;
  }

  update(camera, focus, time) {
    const u = this.material.uniforms;
    u.uCamera.value.copy(camera.position);
    u.uFocus.value.copy(focus);
    u.uTime.value = time;
    // keep the plane under the camera; the pattern is computed in world space so it never slides
    this.mesh.position.set(Math.round(focus.x / 40) * 40, Math.round(focus.y / 40) * 40, 0);
  }
}
