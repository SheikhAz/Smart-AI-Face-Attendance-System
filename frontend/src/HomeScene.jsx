import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/* Grass blade count. If the page ever feels heavy on a weak GPU, lower these. */
const GRASS_DESKTOP = 40000;
const GRASS_TOUCH = 20000;

/* Terrain height, shared by ground, grass and TV so they always agree */
const hill = (x, z) =>
  0.95 * Math.exp(-(x * x) / 38 - (z + 0.5) ** 2 / 22) +
  0.22 * Math.sin(x * 0.55 + 0.6) * Math.cos(z * 0.45) +
  0.1 * Math.sin(x * 1.3 + z * 0.9) -
  0.03 * z;

const canvasTex = (w, h, draw) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const radial = (g, x, y, r, a) => {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(255,255,255,${a})`);
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
};

/* ───────── GRASS ─────────
   Wind uses only slow, continuous sine waves driven by absolute time, so it rolls
   across the field without any jumps. Wave crests also brighten the blades. */
const GRASS_VERT = /* glsl */ `
uniform float uTime, uWind;
uniform vec3 uBase, uMid, uTip, uFog;
attribute vec3 aOffset, aRand;
attribute float aTone;
varying vec3 vColor;
void main(){
  float h = position.y;
  vec3 p = position;
  p.x *= 0.09 * (1.0 - h * 0.92);
  p.y = h * aRand.x;
  float c = cos(aRand.z), s = sin(aRand.z);
  vec3 w = aOffset + vec3(p.x * c, p.y, -p.x * s);

  float w1 = sin(uTime * 0.9 - aOffset.x * 0.32 - aOffset.z * 0.18);
  float w2 = sin(uTime * 1.5 - aOffset.x * 0.7 + aOffset.z * 0.4 + aRand.y * 0.25);
  float gust = 0.65 + 0.35 * sin(uTime * 0.35 - aOffset.x * 0.08);
  float k = h * h * aRand.x * uWind;
  float bend = (w1 * 0.7 + w2 * 0.2 + 0.25) * gust * k * 0.3;
  w.x += bend;
  w.z += bend * 0.3 + w2 * k * 0.03;

  float sheen = 0.5 + 0.5 * w1;
  vec3 col = mix(uBase, uMid, smoothstep(0.0, 0.55, h));
  col = mix(col, uTip, smoothstep(0.4, 1.0, h) * (0.4 + 0.6 * aTone));
  col *= 0.9 + 0.3 * sheen * h;
  float fog = smoothstep(8.0, 26.0, distance(w, cameraPosition));
  vColor = mix(col, uFog, fog * 0.8);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const GRASS_FRAG = /* glsl */ `
varying vec3 vColor;
void main(){
  gl_FragColor = vec4(vColor, 1.0);
  #include <colorspace_fragment>
}`;

/* ───────── MORNING SKY + CLOUDS ─────────
   Clouds are projected onto a flat plane above the viewer, so they are big overhead
   and shrink toward the horizon. Shape comes from domain-warped fbm noise; light and
   shadow come from sampling the density a step toward the sun. */
const SKY_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop, uMid, uLow, uSunCol, uLit, uShade;
uniform vec2 uSun;
uniform float uTime, uAspect, uHorizon;
varying vec2 vUv;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < __OCT__; i++){ v += a * noise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
  return v;
}

void main(){
  float up = clamp((vUv.y - uHorizon) / (1.0 - uHorizon), 0.0, 1.0);
  vec3 c = mix(uLow, uMid, smoothstep(0.0, 0.32, up));
  c = mix(c, uTop, smoothstep(0.3, 1.0, up));

  // sun: halo, soft light shafts, bright core
  vec2 sd = (vUv - uSun) * vec2(uAspect, 1.0);
  float sr = length(sd);
  c += uSunCol * (exp(-sr * 2.6) * 0.45 + exp(-sr * 9.0) * 0.55);
  float a = atan(sd.y, sd.x);
  float ray = fbm(vec2(cos(a), sin(a)) * 2.2 + uTime * 0.02);
  c += uSunCol * smoothstep(0.35, 0.75, ray) * exp(-sr * 2.2) * 0.28 * smoothstep(0.0, 0.1, up);
  c += uSunCol * (1.0 - smoothstep(0.030, 0.042, sr)) * 1.2;

  // clouds
  float sy = max(vUv.y - uHorizon, 0.0) + 0.07;
  vec2 p = vec2((vUv.x - 0.5) * uAspect / sy, 1.0 / sy) * 1.5;
  p.x += uTime * 0.05;
  vec2 q = vec2(fbm(p * 0.5 + vec2(uTime * 0.01, 0.0)), fbm(p * 0.5 + vec2(5.2, 1.3)));
  vec2 pp = p + 1.7 * q;
  float d = fbm(pp);
  float d2 = fbm(pp + vec2(0.6, 0.8) * 0.18);

  float cover = smoothstep(0.50, 0.80, d);
  float lit = clamp(0.62 + (d - d2) * 4.5, 0.0, 1.0);
  float rim = smoothstep(0.50, 0.60, d) * (1.0 - smoothstep(0.60, 0.74, d));
  vec3 cc = mix(uShade, uLit, lit);
  cc += uSunCol * rim * 0.35 * lit;
  cc += uSunCol * 0.25 * exp(-sr * 2.5);
  float fade = smoothstep(0.0, 0.16, up);
  c = mix(c, cc, cover * fade * 0.96);
  c += uSunCol * exp(-sr * 6.0) * 0.18;

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export default function HomeScene() {
  const ref = useRef(null);

  useEffect(() => {
    // Fresh canvas per run so React StrictMode / hot reload never reuse a WebGL context.
    const host = ref.current;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(canvas);
    const mq = window.matchMedia("(max-width: 860px)");
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const speed = calm ? 0.35 : 1;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: "high-performance" });
    } catch {
      canvas.remove();
      return; // WebGL unavailable: the CSS gradient fallback stays visible
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 140);

    /* ── sky ── */
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color("#2a64c8") },
          uMid: { value: new THREE.Color("#7fb8ee") },
          uLow: { value: new THREE.Color("#ffe6c2") },
          uSunCol: { value: new THREE.Color("#ffd9a0") },
          uLit: { value: new THREE.Color("#fffaf0") },
          uShade: { value: new THREE.Color("#8fa8d0") },
          uSun: { value: new THREE.Vector2(0.78, 0.66) },
          uTime: { value: 0 },
          uAspect: { value: 1 },
          uHorizon: { value: 0.46 },
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG.replace("__OCT__", coarse ? "4" : "5"),
      })
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);

    /* ── distant hazy mountains ── */
    const shp = new THREE.Shape();
    shp.moveTo(-100, -8);
    for (let x = -100; x <= 100; x += 3)
      shp.lineTo(x, 4 + Math.sin(x * 0.11) * 2.2 + Math.sin(x * 0.37 + 1) * 0.9);
    shp.lineTo(100, -8);
    const mountains = new THREE.Mesh(
      new THREE.ShapeGeometry(shp),
      new THREE.MeshBasicMaterial({ color: "#9db6dc" })
    );
    mountains.position.z = -52;
    scene.add(mountains);

    /* ── floating pollen / light motes ── */
    const dotTex = canvasTex(64, 64, (g) => radial(g, 32, 32, 30, 1));
    const SP = 70;
    const spPos = new Float32Array(SP * 3);
    for (let i = 0; i < SP; i++) {
      spPos[i * 3] = (Math.random() * 2 - 1) * 12;
      spPos[i * 3 + 1] = Math.random() * 4;
      spPos[i * 3 + 2] = -10 + Math.random() * 14;
    }
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
    const motes = new THREE.Points(
      spGeo,
      new THREE.PointsMaterial({
        map: dotTex,
        color: "#fff4c8",
        size: 0.14,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    motes.frustumCulled = false;
    scene.add(motes);

    /* ── ground ── */
    const gGeo = new THREE.PlaneGeometry(70, 50, 140, 100);
    gGeo.rotateX(-Math.PI / 2);
    gGeo.translate(0, 0, -10);
    const gp = gGeo.attributes.position;
    const gc = new Float32Array(gp.count * 3);
    const cNear = new THREE.Color("#244d27");
    const cFar = new THREE.Color("#a8c8b0");
    const tmp = new THREE.Color();
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i);
      const z = gp.getZ(i);
      gp.setY(i, hill(x, z) - 0.03);
      tmp.copy(cNear).lerp(cFar, THREE.MathUtils.smoothstep(-z, 4, 30));
      tmp.toArray(gc, i * 3);
    }
    gGeo.setAttribute("color", new THREE.BufferAttribute(gc, 3));
    scene.add(new THREE.Mesh(gGeo, new THREE.MeshBasicMaterial({ vertexColors: true })));

    /* ── grass (instanced blades, wind in the vertex shader) ── */
    const N = coarse ? GRASS_TOUCH : GRASS_DESKTOP;
    const off = new Float32Array(N * 3);
    const rnd = new Float32Array(N * 3);
    const tone = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() * 2 - 1) * 17;
      const z = -22 + 26.5 * Math.pow(Math.random(), 0.75);
      off.set([x, hill(x, z), z], i * 3);
      rnd.set([0.5 + Math.random() * 0.55, Math.random() * 6.283, Math.random() * 3.14], i * 3);
      tone[i] = Math.random();
    }
    const base = new THREE.PlaneGeometry(1, 1, 1, 5);
    base.translate(0, 0.5, 0);
    const grassGeo = new THREE.InstancedBufferGeometry();
    grassGeo.index = base.index;
    grassGeo.setAttribute("position", base.attributes.position);
    grassGeo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(off, 3));
    grassGeo.setAttribute("aRand", new THREE.InstancedBufferAttribute(rnd, 3));
    grassGeo.setAttribute("aTone", new THREE.InstancedBufferAttribute(tone, 1));
    grassGeo.instanceCount = N;
    const grassMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: calm ? 0.5 : 1 },
        uBase: { value: new THREE.Color("#1f4a28") },
        uMid: { value: new THREE.Color("#6fae3c") },
        uTip: { value: new THREE.Color("#d6ea86") },
        uFog: { value: new THREE.Color("#b4d0c4") },
      },
      vertexShader: GRASS_VERT,
      fragmentShader: GRASS_FRAG,
    });
    const grass = new THREE.Mesh(base, grassMat);
    grass.geometry = grassGeo;
    grass.frustumCulled = false;
    scene.add(grass);

    /* ── TV (fixed in place: it never follows the cursor here) ── */
    const tv = new THREE.Group();
    const body = new THREE.Mesh(
      new RoundedBoxGeometry(1.5, 1.2, 1, 4, 0.14),
      new THREE.MeshStandardMaterial({ color: "#4a3a32", roughness: 0.5, metalness: 0.05 })
    );
    body.position.y = 0.72;
    const bezel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.08, 0.88),
      new THREE.MeshBasicMaterial({ color: "#ffb454", toneMapped: false })
    );
    bezel.position.set(-0.12, 0.74, 0.505);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.76),
      new THREE.MeshBasicMaterial({ color: "#fff6d0", toneMapped: false })
    );
    screen.position.set(-0.12, 0.74, 0.506);
    const antMat = new THREE.MeshStandardMaterial({ color: "#2a2420", roughness: 0.6 });
    const antGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6);
    antGeo.translate(0, 0.55, 0);
    const ant = new THREE.Group();
    ant.position.set(0, 1.32, 0);
    [-0.42, 0.38].forEach((r) => {
      const a = new THREE.Mesh(antGeo, antMat);
      a.rotation.z = r;
      ant.add(a);
    });
    const glowTex = canvasTex(128, 128, (g) => radial(g, 64, 64, 62, 1));
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: "#ffd08a",
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.35,
      })
    );
    glow.scale.setScalar(3.2);
    glow.position.set(-0.12, 0.75, 0.9);
    tv.add(body, bezel, screen, ant, glow);
    tv.rotation.y = -0.12;
    tv.position.set(0, hill(0, 0) - 0.04, 0);

    const sun = new THREE.DirectionalLight("#fff1d0", 2.4);
    sun.position.set(5, 6, 6);
    scene.add(tv, sun, new THREE.AmbientLight("#b8c8f0", 0.9));

    /* ── sizing: static camera, horizon is derived so clouds meet the hills ── */
    const layout = () => {
      const mobile = mq.matches;
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight;
      const fov = mobile ? 62 : 50;
      const cy = mobile ? 1.6 : 1.7;
      const cz = mobile ? 8.5 : 7.5;
      const ly = mobile ? 0.6 : 2.0;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = fov;
      camera.position.set(0, cy, cz);
      camera.lookAt(0, ly, 0);
      camera.updateProjectionMatrix();
      tv.scale.setScalar(mobile ? 1.2 : 1);

      const pitch = Math.atan2(ly - cy, cz);
      const horizon = 0.5 - (0.5 * Math.tan(pitch)) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const u = sky.material.uniforms;
      u.uAspect.value = w / h;
      u.uHorizon.value = horizon;
      u.uSun.value.set(mobile ? 0.72 : 0.78, horizon + (mobile ? 0.14 : 0.2));
    };
    layout();
    window.addEventListener("resize", layout);

    /* ── loop: only time-driven uniforms change (wind, clouds, motes) ── */
    const t0 = performance.now();
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = ((performance.now() - t0) / 1000) * speed;
      grassMat.uniforms.uTime.value = t;
      sky.material.uniforms.uTime.value = t;
      glow.material.opacity = 0.35 * (0.92 + 0.08 * Math.sin(t * 2.3));

      for (let i = 0; i < SP; i++) {
        spPos[i * 3 + 1] += 0.0025 * speed;
        spPos[i * 3] += Math.sin(t * 0.8 + i) * 0.002 * speed;
        if (spPos[i * 3 + 1] > 4) spPos[i * 3 + 1] = 0;
      }
      spGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", layout);
      scene.traverse((o) => {
        o.geometry?.dispose();
        const m = o.material;
        (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => {
          x.map?.dispose();
          x.dispose();
        });
      });
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return <div ref={ref} className="scene" aria-hidden="true" />;
}