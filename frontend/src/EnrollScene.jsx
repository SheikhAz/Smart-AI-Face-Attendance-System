import { useEffect, useRef } from "react";
import * as THREE from "three";

/* ------------------------------------------------------------------
   Head as a dotted halftone grid (like the reference photo).
   - Everything is sampled on a regular lattice (rows + vertically aligned
     columns). Dots grow where the surface is lit and shrink in shadow.
   - Head: real facial proportions (units are centimetres * K), a jaw/chin
     profile, closed eyes, nose, lips. Edit FACE to reshape the face:
       [x, y, half-width, half-height, depth, mirrored]   (all in cm)
     y is measured up from the chin (menton = 0, top of head = 23).
     depth > 0 pushes the skin out, depth < 0 carves it in.
   - Ears: separate sculpted surface (helix rim, concha, tragus, lobe).
   - No neck, torso or shoulders: just the head.
------------------------------------------------------------------- */
const TAU = Math.PI * 2;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const K = 0.072;            // world units per centimetre
const Y0 = 0.73;            // world y of the chin bottom
const YC = Y0 + 11.5 * K;   // head centre (half of 23 cm)
const YH = 11.5 * K;

/* ---------- head silhouette: half-width / half-depth per height (cm) ---------- */
// [y cm, half-width cm, half-depth cm]
const NODES = [
  [1.5, 2.7, 6.6],   // under the chin
  [3, 3.9, 7.7],     // chin / mentolabial fold
  [5, 5.3, 8.1],     // jaw angle, mouth level
  [7, 6.2, 8.6],     // nose base, cheeks
  [9, 6.95, 9.0],
  [11.5, 7.3, 9.25], // eye line
  [14, 7.5, 9.4],
  [16, 7.6, 9.5],    // widest, temples; dome above
];
function profile(y) {
  const c = (y - Y0) / K;
  let w, d;
  if (c >= 16) {
    const s = Math.sqrt(Math.max(0, 1 - ((c - 16) / 7) ** 2));
    w = 7.6 * s; d = 9.5 * s;
  } else {
    const cc = Math.max(c, 1.5);
    let i = 0;
    while (i < NODES.length - 2 && cc > NODES[i + 1][0]) i++;
    const n0 = NODES[i], n1 = NODES[i + 1];
    const nm = NODES[Math.max(i - 1, 0)], np = NODES[Math.min(i + 2, NODES.length - 1)];
    const h = n1[0] - n0[0], t = (cc - n0[0]) / h, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const val = (k) => {
      const m0 = (n1[k] - nm[k]) / (n1[0] - nm[0]);
      const m1 = (np[k] - n0[k]) / (np[0] - n0[0]);
      return h00 * n0[k] + h10 * h * m0 + h01 * n1[k] + h11 * h * m1;
    };
    w = val(1); d = val(2);
    if (c < 1.5) { const s = Math.sqrt(Math.max(0, 1 - ((1.5 - c) / 1.5) ** 2)); w *= s; d *= s; }
  }
  return [w * K, d * K];
}
/* ---------- facial relief (cm) ---------- */
const FACE = [
  // [x, y, half-w, half-h, depth, mirrored, tilt, curve]   (cm; curve>0 lifts the ends = U shape)
  // brow + forehead
  [3.3, 13.5, 2.5, 0.65, 0.3, 1, 0, -0.5],     // brow ridge (arched)
  [0, 13.3, 1.0, 0.9, 0.15, 0],                // glabella
  [0, 12.0, 0.9, 0.6, -0.25, 0],               // nasal root dip
  [6.2, 14.0, 1.2, 1.8, -0.15, 1],             // temple hollow
  // closed eyes (almond shaped: outer corner higher, lash line curves down)
  [3.1, 11.9, 2.0, 1.8, -0.3, 1, 0.1, 0],      // orbit recess
  [3.1, 11.75, 1.45, 0.75, 0.4, 1, 0.1, 0.3],  // upper lid (eyeball bulge)
  [3.1, 11.2, 1.4, 0.32, -0.55, 1, 0.15, 0.45],// lash line / closed slit
  [3.1, 12.55, 1.45, 0.3, -0.3, 1, 0.12, 0.45],// lid crease
  [3.1, 10.65, 1.35, 0.45, 0.2, 1, 0.1, 0.35], // lower lid
  [1.6, 11.5, 0.5, 0.7, -0.3, 1],              // inner eye corner
  // nose
  [0, 10.2, 0.7, 2.4, 1.3, 0],                 // bridge
  [0, 8.1, 1.0, 0.9, 1.5, 0],                  // tip
  [1.4, 7.7, 0.8, 0.75, 0.55, 1],              // alar wings
  [1.7, 7.9, 0.28, 1.0, -0.25, 1],             // alar groove
  [0.75, 7.1, 0.38, 0.3, -0.45, 1],            // nostril openings
  [0, 6.9, 0.8, 0.4, 0.3, 0],                  // underside of nose
  // cheeks
  [4.4, 9.2, 2.0, 1.4, 0.6, 1],                // cheekbones
  [4.6, 6.4, 1.5, 1.6, -0.3, 1],               // cheek hollow
  [2.4, 6.2, 0.45, 1.4, -0.22, 1],             // nasolabial fold
  // mouth
  [0, 6.1, 0.38, 0.7, -0.2, 0],                // philtrum
  [0, 5.55, 1.45, 0.55, 0.8, 0, 0, -0.2],      // upper lip
  [0, 5.0, 1.9, 0.3, -0.5, 0, 0, 0.25],        // mouth line
  [0, 4.0, 1.5, 0.65, 0.85, 0, 0, 0.3],        // lower lip
  [2.3, 5.1, 0.45, 0.35, -0.2, 1],             // mouth corners
  [0, 3.0, 1.3, 0.4, -0.55, 0, 0, 0.3],        // mentolabial fold
  [0, 1.6, 1.9, 1.2, 1.15, 0],                 // chin
];
const FU = FACE.map(([x, y, sx, sy, d, m, tl = 0, cv = 0]) => [x * K, Y0 + y * K, sx * K, sy * K, d * K, m, tl, cv * K]);

function headP(u, ph, o) {
  const y = YC + u * YH;
  const [a, c] = profile(y);
  const sn = Math.sin(ph), cs = Math.cos(ph);
  const x = a * sn, z = c * cs;
  const dy = 0.004, p1 = profile(y + dy), p0 = profile(y - dy);
  const da = (p1[0] - p0[0]) / (2 * dy), dc = (p1[1] - p0[1]) / (2 * dy);
  let nx = c * sn, ny = -(c * da * sn * sn + a * dc * cs * cs), nz = a * cs;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const fm = ss(0.1, 0.7, cs);
  let d = 0;
  if (fm > 0) {
    for (const [fx, fy, sx, sy, A, m, tl, cv] of FU) {
      const dr = x - fx, er = (y - fy - tl * dr - cv * (dr / sx) ** 2) / sy;
      d += A * Math.exp(-er * er - (dr / sx) ** 2);
      if (m) {
        const dl = x + fx, el = (y - fy + tl * dl - cv * (dl / sx) ** 2) / sy;
        d += A * Math.exp(-el * el - (dl / sx) ** 2);
      }
    }
    d *= fm;
  }
  o[0] = x + nx * d; o[1] = y + ny * d; o[2] = z + nz * d;
}

/* ---------- lattice helpers ---------- */
const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
const E = 1e-3;

// columns of one ring: x-aligned lattice (vertical columns on the front), gaps filled by arc length
function ringPhases(a, c, sp) {
  const kmax = Math.floor(a / sp);
  if (kmax < 1) {
    const n = Math.max(3, Math.ceil((TAU * Math.max(a, c)) / sp));
    return Array.from({ length: n }, (_, i) => (i / n) * TAU);
  }
  let set = [];
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
    const m = Math.ceil(dist / (1.7 * sp));
    for (let j = 1; j < m; j++) out.push(p1 + ((p2 - p1) * j) / m);
  }
  return out;
}
const unit = (n) => { const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; };
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const sub = (p, q) => [(p[0] - q[0]) / E, (p[1] - q[1]) / E, (p[2] - q[2]) / E];
const FRONT = -0.45; // skip the back of the head (cos(ph) below this): it is never seen

function buildHead(sp) {
  const pts = [];
  let u = -0.997;
  while (u < 0.997) {
    const y = YC + u * YH;
    const [a, c] = profile(y);
    for (const ph of ringPhases(a, c, sp)) {
      if (Math.cos(ph) < FRONT) continue;
      headP(u, ph, A); headP(u + E, ph, B); headP(u, ph + E, C);
      pts.push({ q: [A[0], A[1], A[2]], n: unit(cross(sub(C, A), sub(B, A))), k: 0 });
    }
    // advance one dot-spacing along the surface (measured on the side, where there is no relief)
    headP(u, Math.PI / 2, A); headP(u + E, Math.PI / 2, B);
    const speed = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) / E;
    u += Math.max(2e-4, Math.min(sp / Math.max(speed, 1e-3), 0.05));
  }
  return pts;
}

/* ---------- ears ---------- */
const EY = Y0 + 9.9 * K, ERY = 3.3 * K, EZ = -0.1, ERZ = 1.9 * K;
function earLift(a, b) {            // cm out from the head
  const wb = 0.55 + 0.45 * ss(-1, 0.3, b);
  const r = Math.hypot(a / wb, b);
  let h = 0.2 + 1.3 * ((1 - a) * 0.5);                                            // flares out toward the rear
  h += 0.5 * Math.exp(-(((r - 0.88) / 0.13) ** 2));                                // helix rim
  h += 0.3 * Math.exp(-(((r - 0.52) / 0.14) ** 2)) * ss(-0.5, 0.2, b);             // antihelix
  h -= 0.45 * Math.exp(-(((a - 0.05) / 0.3) ** 2 + ((b + 0.02) / 0.3) ** 2));      // concha bowl
  h += 0.35 * Math.exp(-(((a - 0.85) / 0.14) ** 2 + ((b + 0.1) / 0.16) ** 2));     // tragus
  h += 0.25 * Math.exp(-(((a + 0.05) / 0.45) ** 2 + ((b + 0.85) / 0.2) ** 2));     // lobe
  return Math.max(h, 0.05);
}
function earP(zz, yy, side, o) {
  const b = (yy - EY) / ERY, a = (zz - (EZ - 0.025 * b)) / ERZ;
  const [w, d] = profile(yy);
  const hx = w * Math.sqrt(Math.max(0, 1 - (zz / d) ** 2));
  o[0] = side * (hx + earLift(a, b) * K); o[1] = yy; o[2] = zz;
}
function buildEars(sp) {
  const pts = [], s = sp * 0.8;
  for (const side of [-1, 1]) {
    for (let yy = EY - ERY * 1.05; yy < EY + ERY * 1.05; yy += s) {
      const b = (yy - EY) / ERY;
      const wb = 0.55 + 0.45 * ss(-1, 0.3, b);
      for (let zz = EZ - ERZ * 1.2; zz < EZ + ERZ * 1.2; zz += s) {
        const a = (zz - (EZ - 0.025 * b)) / ERZ;
        if ((a / wb) ** 2 + b * b > 1) continue;
        earP(zz, yy, side, A); earP(zz + E, yy, side, B); earP(zz, yy + E, side, C);
        const n = cross(sub(C, A), sub(B, A));          // d/dy x d/dz
        pts.push({ q: [A[0], A[1], A[2]], n: unit(n.map((v) => v * side)), k: 1 });
      }
    }
  }
  return pts;
}

function buildCloud(sp) {
  const all = [buildHead(sp), buildEars(sp)].flat();
  const pos = new Float32Array(all.length * 3), nor = new Float32Array(all.length * 3);
  const rnd = new Float32Array(all.length), kind = new Float32Array(all.length);
  all.forEach(({ q, n, k }, i) => {
    for (let j = 0; j < 3; j++) { pos[i * 3 + j] = q[j]; nor[i * 3 + j] = n[j]; }
    rnd[i] = Math.random();
    kind[i] = k;
  });
  return { pos, nor, rnd, kind, count: all.length };
}

const VERT = /* glsl */ `
uniform float uTime, uOrbit, uAct, uScan, uScale, uPitch;
uniform vec3 uBlue, uCyan, uRed;
attribute vec3 aN;
attribute float aR;
attribute float aK;
varying vec3 vC;
void main(){
  vec3 p = position + aN * sin(uTime * 1.3 + position.y * 3.0 + aR * 6.283) * 0.0025;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 nv = normalize(normalMatrix * aN);
  float f = dot(nv, normalize(-mv.xyz));
  // hide the far side (no depth test); ears stay visible further around so they read as attached
  float vis = mix(smoothstep(0.02, 0.42, f), smoothstep(-0.35, 0.15, f), aK);
  float face = smoothstep(0.0, 1.0, f);

  // overhead key light: carves the eye sockets, nose, lips, chin like the reference
  vec3 L = normalize(vec3(-0.15, 0.62, 0.75));
  float lit = clamp(dot(nv, L) * 1.1 + 0.12, 0.0, 1.0);
  float shade = clamp(0.04 + 0.96 * pow(lit, 1.15) + 0.2 * face + 0.07 * pow(1.0 - clamp(f, 0.0, 1.0), 2.0), 0.0, 1.0);

  // red bands drift around the head (model space), speckled per point
  float a = atan(position.x, position.z);
  float w = 0.7 * cos(a - uOrbit + position.y * 0.9)
          + 0.3 * cos(2.0 * a + uOrbit * 1.7 - position.y * 1.5);
  w *= mix(0.65, 1.0, smoothstep(2.0, 0.2, position.y));
  float red = smoothstep(0.3, 0.9, w + (aR - 0.5) * 0.6);

  float scan = exp(-pow((position.y - uScan) * 4.5, 2.0)) * uAct;
  vec3 col = mix(uBlue, uCyan, smoothstep(0.05, 0.9, shade));
  col = mix(col, vec3(1.0), smoothstep(0.7, 1.0, shade) * 0.45);
  col = mix(col, uRed, red * 0.6);
  col += vec3(0.5, 0.75, 1.0) * scan;

  // halftone: lit dots grow, shadowed dots shrink (size from the world-space grid pitch)
  float dia = uPitch * (0.22 + 0.62 * shade + scan * 0.7) * (0.92 + 0.16 * aR);
  float px = dia * uScale / -mv.z * vis;
  vC = col * (0.1 + 1.25 * shade) * vis * clamp(px, 0.0, 1.0);
  gl_PointSize = max(px, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec3 vC;
void main(){
  float a = smoothstep(0.5, 0.25, length(gl_PointCoord - 0.5));
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

    // grid pitch in world units: ~65 dots across the face on desktop (smaller = finer)
    const PITCH = coarse ? 0.018 : 0.014;
    const { pos, nor, rnd, kind, count } = buildCloud(PITCH);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aN", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("aR", new THREE.BufferAttribute(rnd, 1));
    geo.setAttribute("aK", new THREE.BufferAttribute(kind, 1));
    geo.setDrawRange(0, count);
    const u = {
      uTime: { value: 0 }, uOrbit: { value: 0 }, uAct: { value: 0 }, uScan: { value: 0 },
      uScale: { value: 1 }, uPitch: { value: PITCH },
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
    pts.position.y = -YC; // centre the head on the rig, so it turns about its own middle
    rig.add(pts);

    let baseY = 0;
    const layout = () => {
      mobile = mq.matches;
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = mobile ? 46 : 34;
      camera.position.set(0, 0, mobile ? 4.4 : 3.7);   // head only: close in so the face fills the screen
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      const s = mobile ? 0.9 : 1;
      rig.scale.setScalar(s);
      baseY = mobile ? 0.25 : 0;
      // pixels per world unit at distance 1, so dot size follows the grid at any resolution
      u.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      u.uPitch.value = PITCH * s;
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
      u.uScan.value = 0.6 + ((t * 0.5) % 1) * 1.9;
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