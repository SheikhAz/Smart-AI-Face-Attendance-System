import { useEffect, useRef } from "react";
import * as THREE from "three";

/* ------------------------------------------------------------------
   Procedural bust, sampled as a point cloud.
   - Head: bald, smooth surface sculpted with relief features (closed eyes,
     lids, nose, nostrils, cheekbones, full lips, chin). The head is sampled
     on a regular LATTICE (rows + vertically aligned columns) so it reads as
     the dotted halftone mesh in the reference image.
   - Neck, shoulders, torso, ears: ellipsoids, random outer-shell points.
   Tweak FACE (x, y, half-width, half-height, depth, mirrored) and AMP to
   reshape the face. HEAD_SP is the dot spacing (smaller = finer grid).
------------------------------------------------------------------- */
const TAU = Math.PI * 2;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ---------- head: one smooth surface, sculpted with relief features ---------- */
const HC = [0, 1.55, 0], HR = [0.6, 0.82, 0.66];
// x, y, half-width, half-height, depth (+ out / - in), mirrored
const FACE = [
  // brow + forehead
  [0.19, 1.80, 0.17, 0.035, 0.06, 1],   // brow ridge
  [0.0, 1.74, 0.07, 0.06, 0.03, 0],     // glabella
  // closed eyes
  [0.22, 1.66, 0.12, 0.075, -0.06, 1],  // eye socket
  [0.22, 1.655, 0.085, 0.03, 0.05, 1],  // upper lid (bulge)
  [0.22, 1.625, 0.085, 0.012, -0.06, 1],// lash line (slit)
  [0.22, 1.60, 0.08, 0.015, 0.02, 1],   // lower lid
  [0.22, 1.70, 0.095, 0.012, -0.035, 1],// lid crease
  [0.09, 1.64, 0.03, 0.04, -0.03, 1],   // inner eye corner
  // nose
  [0.0, 1.58, 0.035, 0.17, 0.06, 0],    // nose bridge
  [0.07, 1.5, 0.03, 0.12, -0.03, 1],    // side-of-nose valleys
  [0.0, 1.31, 0.07, 0.055, 0.12, 0],    // nose tip
  [0.095, 1.27, 0.04, 0.04, 0.06, 1],   // nostril wings
  [0.045, 1.25, 0.022, 0.016, -0.06, 1],// nostril openings
  [0.0, 1.24, 0.04, 0.02, 0.02, 0],     // columella
  // cheeks
  [0.4, 1.45, 0.15, 0.1, 0.05, 1],      // cheekbones
  [0.34, 1.2, 0.1, 0.1, -0.04, 1],      // cheek hollow
  [0.17, 1.17, 0.03, 0.1, -0.03, 1],    // nasolabial fold
  // mouth
  [0.0, 1.2, 0.02, 0.04, -0.02, 0],     // philtrum
  [0.0, 1.145, 0.1, 0.03, 0.07, 0],     // upper lip
  [0.0, 1.105, 0.14, 0.014, -0.07, 0],  // mouth line
  [0.0, 1.055, 0.105, 0.03, 0.08, 0],   // lower lip
  [0.15, 1.1, 0.025, 0.02, -0.04, 1],   // mouth corners
  [0.0, 0.99, 0.1, 0.02, -0.05, 0],     // under-lip dip
  [0.0, 0.9, 0.13, 0.08, 0.09, 0],      // chin
];
const AMP = 1.2;

function headP(u, ph, o) {
  const p = 2 + 1.1 * ss(-0.05, -0.55, u);
  const s = Math.pow(1 - Math.pow(Math.abs(u), p), 1 / p);
  const dx = s * Math.sin(ph), dz = s * Math.cos(ph);
  const tp = 1 - 0.22 * ss(0.15, -1, u);
  const x = HC[0] + dx * HR[0] * tp, y = HC[1] + u * HR[1], z = HC[2] + dz * HR[2];
  let nx = dx / HR[0], ny = u / HR[1], nz = dz / HR[2];
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const fm = ss(0.1, 0.7, Math.cos(ph));
  let d = 0;
  if (fm > 0) {
    for (const [fx, fy, sx, sy, A, m] of FACE) {
      d += AMP * A * Math.exp(-(((y - fy) / sy) ** 2) - (((x - fx) / sx) ** 2));
      if (m) d += AMP * A * Math.exp(-(((y - fy) / sy) ** 2) - (((x + fx) / sx) ** 2));
    }
    d *= fm;
  }
  o[0] = x + nx * d; o[1] = y + ny * d; o[2] = z + nz * d;
}

/* ---------- head lattice: rows of dots, columns aligned vertically on the face ---------- */
const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
const E = 1e-3;

function ringPhases(a, c, sp) {
  const kmax = Math.floor(a / sp);
  let set = [];
  if (kmax < 1) {
    const n = Math.max(3, Math.ceil((TAU * Math.max(a, c)) / sp));
    for (let i = 0; i < n; i++) set.push((i / n) * TAU);
    return set;
  }
  for (let k = -kmax; k <= kmax; k++) {
    const sn = (k * sp) / a;
    const p1 = Math.asin(Math.max(-1, Math.min(1, sn)));
    set.push(p1);
    if (Math.abs(sn) < 0.9999) set.push(Math.PI - p1);
  }
  set = set.map((p) => ((p % TAU) + TAU) % TAU).sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < set.length; i++) {
    const p1 = set[i], p2 = i + 1 < set.length ? set[i + 1] : set[0] + TAU;
    const dist = Math.hypot(a * (Math.sin(p2) - Math.sin(p1)), c * (Math.cos(p2) - Math.cos(p1)));
    out.push(p1);
    const m = Math.ceil(dist / (1.3 * sp));
    for (let j = 1; j < m; j++) out.push(p1 + ((p2 - p1) * j) / m);
  }
  return out;
}

function buildHead(sp) {
  const pts = [];
  let u = -0.997;
  while (u < 0.997) {
    const p = 2 + 1.1 * ss(-0.05, -0.55, u);
    const sh = Math.pow(1 - Math.pow(Math.abs(u), p), 1 / p);
    const tp = 1 - 0.22 * ss(0.15, -1, u);
    const a = sh * HR[0] * tp, c = sh * HR[2];
    for (const ph of ringPhases(a, c, sp)) {
      headP(u, ph, A); headP(u + E, ph, B); headP(u, ph + E, C);
      const pu = [(B[0] - A[0]) / E, (B[1] - A[1]) / E, (B[2] - A[2]) / E];
      const pp = [(C[0] - A[0]) / E, (C[1] - A[1]) / E, (C[2] - A[2]) / E];
      const n = [pp[1] * pu[2] - pp[2] * pu[1], pp[2] * pu[0] - pp[0] * pu[2], pp[0] * pu[1] - pp[1] * pu[0]];
      const l = Math.hypot(...n) || 1;
      pts.push({ q: [A[0], A[1], A[2]], n: [n[0] / l, n[1] / l, n[2] / l] });
    }
    // advance one dot-spacing along the surface (measured on the plain ellipsoid side)
    headP(u, Math.PI / 2, A); headP(u + E, Math.PI / 2, B);
    const speed = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) / E;
    u += Math.max(2e-4, Math.min(sp / Math.max(speed, 1e-3), 0.05));
  }
  return pts;
}

/* ---------- everything else: ellipsoids ---------- */
const ellipsoid = (c, r, w, f) => ({
  w, f, c, r,
  inside: (q) => q.reduce((a, v, m) => a + ((v - c[m]) / r[m]) ** 2, 0) < 0.96,
  sample() {
    const u = Math.random() * 2 - 1, th = Math.random() * TAU, s = Math.sqrt(1 - u * u);
    const d = [s * Math.cos(th), u, s * Math.sin(th)];
    const n = d.map((v, j) => v / r[j]), l = Math.hypot(...n);
    return { q: d.map((v, j) => c[j] + v * r[j]), n: n.map((v) => v / l), f };
  },
});

const HEAD_IN = [0.97, 0.99, 0.97];
const headInside = (q) => q.reduce((a, v, m) => a + ((v - HC[m]) / (HR[m] * HEAD_IN[m])) ** 2, 0) < 0.96;
const PARTS = [
  ellipsoid([0, 0.45, -0.05], [0.3, 0.8, 0.31], 1.6, 0.01),          // neck
  ellipsoid([0, -0.8, 0], [1.0, 0.8, 0.5], 4, 0.012),                // torso
  ellipsoid([-0.5, -0.06, -0.03], [0.6, 0.25, 0.38], 1, 0.012),     // trapezius
  ellipsoid([0.5, -0.06, -0.03], [0.6, 0.25, 0.38], 1, 0.012),
  ellipsoid([-1.0, -0.4, 0], [0.46, 0.3, 0.4], 1.1, 0.012),         // shoulders
  ellipsoid([1.0, -0.4, 0], [0.46, 0.3, 0.4], 1.1, 0.012),
  ellipsoid([-0.63, 1.5, -0.04], [0.06, 0.15, 0.1], 0.3, 0.008),     // ears
  ellipsoid([0.63, 1.5, -0.04], [0.06, 0.15, 0.1], 0.3, 0.008),
];

function buildCloud(N, headSp) {
  const head = buildHead(headSp);
  const total = PARTS.reduce((s, p) => s + p.w, 0);
  const cap = Math.max(N, head.length + 1000);
  const pos = new Float32Array(cap * 3), nor = new Float32Array(cap * 3), rnd = new Float32Array(cap);
  let i = 0;
  for (const { q, n } of head) {
    for (let j = 0; j < 3; j++) { pos[i * 3 + j] = q[j]; nor[i * 3 + j] = n[j]; }
    rnd[i++] = Math.random();
  }
  let guard = 0;
  while (i < cap && guard++ < cap * 30) {
    let pick = Math.random() * total, k = 0;
    while (pick > PARTS[k].w && k < PARTS.length - 1) pick -= PARTS[k++].w;
    const { q, n, f } = PARTS[k].sample();
    if (headInside(q) || PARTS.some((o, j) => j !== k && o.inside(q))) continue;
    const jit = (Math.random() + Math.random() - 1) * (f ?? PARTS[k].f) * 1.4;
    for (let j = 0; j < 3; j++) { nor[i * 3 + j] = n[j]; pos[i * 3 + j] = q[j] + n[j] * jit; }
    rnd[i++] = Math.random();
  }
  return { pos, nor, rnd, count: i };
}

const VERT = /* glsl */ `
uniform float uTime, uOrbit, uAct, uScan, uPR, uSize;
uniform vec3 uBlue, uCyan, uRed;
attribute vec3 aN;
attribute float aR;
varying vec3 vC;
void main(){
  vec3 p = position + aN * sin(uTime * 1.3 + position.y * 3.0 + aR * 6.283) * 0.004;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 nv = normalize(normalMatrix * aN);
  float f = dot(nv, normalize(-mv.xyz));
  float face = smoothstep(-0.25, 1.0, f);

  // key light from above-left-front: carves the lids, nose, lips like the reference
  vec3 L = normalize(vec3(-0.35, 0.75, 0.65));
  float lit = 0.08 + 0.92 * pow(max(dot(nv, L), 0.0), 0.9);

  // red bands drift around the body (model space), speckled per point
  float a = atan(position.x, position.z);
  float w = 0.7 * cos(a - uOrbit + position.y * 0.9)
          + 0.3 * cos(2.0 * a + uOrbit * 1.7 - position.y * 1.5);
  w *= mix(0.65, 1.0, smoothstep(1.6, -0.4, position.y));
  float red = smoothstep(0.3, 0.9, w + (aR - 0.5) * 0.6);

  float scan = exp(-pow((position.y - uScan) * 4.5, 2.0)) * uAct;
  vec3 col = mix(uBlue, uCyan, face * face * 0.85);
  col = mix(col, uRed, red * 0.8);
  col += vec3(0.5, 0.75, 1.0) * scan;
  float fade = smoothstep(-1.55, -0.7, position.y);

  vC = col * (0.12 + 1.2 * lit * (0.4 + 0.6 * face)) * fade;
  // halftone: lit dots grow, shadowed dots shrink
  gl_PointSize = uSize * uPR * (0.55 + 0.75 * lit + scan * 1.2) * (0.9 + 0.2 * aR) * (6.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec3 vC;
void main(){
  float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vC * a, 1.0);
  #include <colorspace_fragment>
}`;

export default function EnrollScene({ active = false }) {
  const ref = useRef(null);
  const live = useRef(active);
  live.current = active;

  useEffect(() => {
    const host = ref.current;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(canvas);
    const mq = window.matchMedia("(max-width: 860px)");
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const speed = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.35 : 1;
    let mobile = mq.matches;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    } catch {
      canvas.remove();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    const rig = new THREE.Group();
    scene.add(rig);

    // head lattice spacing: finer on desktop, coarser on touch devices
    const { pos, nor, rnd, count } = buildCloud(coarse ? 50000 : 90000, coarse ? 0.016 : 0.0115);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aN", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("aR", new THREE.BufferAttribute(rnd, 1));
    geo.setDrawRange(0, count);
    const u = {
      uTime: { value: 0 }, uOrbit: { value: 0 }, uAct: { value: 0 }, uScan: { value: 0 },
      uPR: { value: renderer.getPixelRatio() }, uSize: { value: 1.6 },
      uBlue: { value: new THREE.Color("#1d3bff") },
      uCyan: { value: new THREE.Color("#aac0ff") },
      uRed: { value: new THREE.Color("#ff2d55") },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    rig.add(pts);

    let baseY = 0;
    const layout = () => {
      mobile = mq.matches;
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = mobile ? 46 : 34;
      camera.position.set(0, 0.45, 6.4);
      camera.lookAt(0, 0.45, 0);
      camera.updateProjectionMatrix();
      rig.scale.setScalar(mobile ? 0.8 : 1);
      baseY = mobile ? 0.55 : 0;
      u.uPR.value = renderer.getPixelRatio();
    };
    layout();
    window.addEventListener("resize", layout);

    const ptr = { x: 0, y: 0 };
    const onMove = (e) => {
      ptr.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.y = 1 - (e.clientY / window.innerHeight) * 2;
    };
    window.addEventListener("pointermove", onMove);

    let last = performance.now(), t = 0, orbit = 0, act = 0, raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const k = 1 - Math.exp(-dt * 3);
      act += ((live.current ? 1 : 0) - act) * k;
      t += dt * speed;
      orbit += dt * speed * (0.55 + act * 0.9); // red keeps its phase, only the speed eases

      const ty = mobile ? Math.sin(t * 0.35) * 0.25 : ptr.x * 0.4 + Math.sin(t * 0.35) * 0.1;
      rig.rotation.y += (ty - rig.rotation.y) * k;
      rig.rotation.x += ((mobile ? 0 : -ptr.y * 0.08) - rig.rotation.x) * k;
      rig.position.y = baseY + Math.sin(t * 0.8) * 0.02;

      u.uTime.value = t;
      u.uOrbit.value = orbit;
      u.uAct.value = act;
      u.uScan.value = -1.5 + ((t * 0.5) % 1) * 4.2;
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", layout);
      window.removeEventListener("pointermove", onMove);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return <div ref={ref} className="en-scene" aria-hidden="true" />;
}