import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/* How strong the TV's light is. 1 = original, lower = dimmer (try 0.4 to 1). */
const TV_GLOW = 0.65;

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

const GRASS_VERT = /* glsl */ `
uniform float uTime, uWind, uGlow;
uniform vec3 uTv, uBase, uMid, uTip, uFog;
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

  // two crossing waves (opposite directions) + a slow gust
  float w1 = sin(uTime * 1.1 + aOffset.x * 0.55 + aOffset.z * 0.25 + aRand.y);
  float w2 = sin(uTime * 0.7 - aOffset.x * 0.35 + aOffset.z * 0.45 + aRand.y * 1.7);
  float gust = sin(uTime * 0.35 + aOffset.x * 0.12);
  float bend = (w1 * 0.6 + w2 * 0.4 + gust * 0.5) * h * h * 0.24 * aRand.x * uWind;
  w.x += bend;
  w.z += bend * 0.35 + w2 * h * h * 0.05 * uWind;

  vec2 d = aOffset.xz - uTv.xz;
  float glow = exp(-dot(d, d) * 0.16);
  vec3 col = mix(uBase, uMid, smoothstep(0.0, 0.6, h));
  col = mix(col, uTip, smoothstep(0.45, 1.0, h) * (0.35 + 0.65 * aTone));
  col += vec3(1.0, 0.6, 0.2) * glow * (0.2 + 0.9 * h) * uGlow;
  float fog = smoothstep(8.0, 24.0, distance(w, cameraPosition));
  vColor = mix(col, uFog, fog * 0.85);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const GRASS_FRAG = /* glsl */ `
varying vec3 vColor;
void main(){
  gl_FragColor = vec4(vColor, 1.0);
  #include <colorspace_fragment>
}`;

const SKY_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

/* Night gradient + three layers of twinkling stars (bright / medium / fine).
   Stars live on a jittered grid in screen space, so they sit behind everything. */
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop, uMid, uLow;
uniform float uTime, uAspect;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 stars(vec2 uv, float scale, float density, float radius, float gain, float speed){
  vec2 g = uv * scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash(id);
  float on = step(density, h);
  vec2 jitter = (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.5;
  float d = length(f - jitter);
  float core = 1.0 - smoothstep(0.0, radius, d);
  float twinkle = 0.7 + 0.3 * sin(uTime * speed + h * 80.0);
  vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.92, 0.78), hash(id + 11.3));
  return tint * core * core * twinkle * gain * on;
}

void main(){
  float y = vUv.y;
  vec3 c = mix(uLow, uMid, smoothstep(0.28, 0.5, y));
  c = mix(c, uTop, smoothstep(0.5, 0.95, y));

  vec2 uv = vec2(vUv.x * uAspect, y);
  vec3 s = stars(uv,        14.0, 0.93, 0.10, 1.6, 1.4)
         + stars(uv + 4.7,  30.0, 0.90, 0.11, 1.0, 2.1)
         + stars(uv + 9.2,  56.0, 0.92, 0.12, 0.6, 3.0);
  c += s * smoothstep(0.42, 0.70, y);

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export default function LoginScene() {
  const ref = useRef(null);

  useEffect(() => {
    // A fresh canvas for every run of this effect. React StrictMode (and hot reload)
    // runs it more than once; reusing one canvas reuses its WebGL context with leftover
    // pixel-store state, which is what triggered the texImage3D warnings.
    const host = ref.current;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(canvas);
    const mq = window.matchMedia("(max-width: 860px)"); // layout: width only
    const coarse = window.matchMedia("(pointer: coarse)").matches; // performance: touch devices
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const speed = calm ? 0.35 : 1;
    let mobile = mq.matches;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse });
    } catch {
      canvas.remove();
      return; // WebGL unavailable: CSS gradient fallback stays visible
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 140);
    let lookY = 2;

    /* ── night sky + stars ── */
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color("#050b2e") },
          uMid: { value: new THREE.Color("#0e1b5c") },
          uLow: { value: new THREE.Color("#2b3b96") },
          uTime: { value: 0 },
          uAspect: { value: 1 },
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
      })
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);

    /* ── distant mountains ── */
    const shp = new THREE.Shape();
    shp.moveTo(-100, -8);
    for (let x = -100; x <= 100; x += 3)
      shp.lineTo(x, 4 + Math.sin(x * 0.11) * 2.2 + Math.sin(x * 0.37 + 1) * 0.9);
    shp.lineTo(100, -8);
    const mountains = new THREE.Mesh(
      new THREE.ShapeGeometry(shp),
      new THREE.MeshBasicMaterial({ color: "#16206a" })
    );
    mountains.position.z = -52;
    scene.add(mountains);

    /* ── sparkles ── */
    const dotTex = canvasTex(64, 64, (g) => radial(g, 32, 32, 30, 1));
    const SP = 160;
    const spPos = new Float32Array(SP * 3);
    for (let i = 0; i < SP; i++) {
      spPos[i * 3] = (Math.random() * 2 - 1) * 14;
      spPos[i * 3 + 1] = Math.random() * 10;
      spPos[i * 3 + 2] = -12 + Math.random() * 16;
    }
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
    const sparkles = new THREE.Points(
      spGeo,
      new THREE.PointsMaterial({
        map: dotTex,
        size: 0.2,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    sparkles.frustumCulled = false;
    scene.add(sparkles);

    /* ── ground ── */
    const gGeo = new THREE.PlaneGeometry(70, 50, 140, 100);
    gGeo.rotateX(-Math.PI / 2);
    gGeo.translate(0, 0, -10);
    const gp = gGeo.attributes.position;
    const gc = new Float32Array(gp.count * 3);
    const cNear = new THREE.Color("#0a1233");
    const cFar = new THREE.Color("#131b55");
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
    const N = coarse ? 24000 : 48000;
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
        uWind: { value: calm ? 0.45 : 1 },
        uGlow: { value: TV_GLOW },
        uTv: { value: new THREE.Vector3() },
        uBase: { value: new THREE.Color("#0b1a3a") },
        uMid: { value: new THREE.Color("#4f6228") },
        uTip: { value: new THREE.Color("#f2b84b") },
        uFog: { value: cFar.clone() },
      },
      vertexShader: GRASS_VERT,
      fragmentShader: GRASS_FRAG,
    });
    const grass = new THREE.Mesh(base, grassMat);
    grass.geometry = grassGeo;
    grass.frustumCulled = false;
    scene.add(grass);

    /* ── TV ── */
    const tv = new THREE.Group();
    const body = new THREE.Mesh(
      new RoundedBoxGeometry(1.5, 1.2, 1, 4, 0.14),
      new THREE.MeshStandardMaterial({ color: "#0e1536", roughness: 0.45, metalness: 0.1 })
    );
    body.position.y = 0.72;
    const bezel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.08, 0.88),
      new THREE.MeshBasicMaterial({ color: "#ffad45", toneMapped: false })
    );
    bezel.position.set(-0.12, 0.74, 0.505);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.76),
      new THREE.MeshBasicMaterial({ color: "#fff6d0", toneMapped: false })
    );
    screen.position.set(-0.12, 0.74, 0.506);
    const antMat = new THREE.MeshStandardMaterial({ color: "#1a1d33", roughness: 0.6 });
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
        color: "#ffb04a",
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.85 * TV_GLOW,
      })
    );
    glow.scale.setScalar(5);
    glow.position.set(-0.12, 0.75, 0.9);
    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: "#fff2c0",
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.7 * TV_GLOW,
      })
    );
    core.scale.setScalar(2);
    core.position.set(-0.12, 0.74, 0.6);
    const tvLight = new THREE.PointLight("#ffb35a", 14 * TV_GLOW, 9, 2);
    tvLight.position.set(0, 0.8, 1.6);
    tv.add(body, bezel, screen, ant, glow, core, tvLight);
    scene.add(tv, new THREE.AmbientLight("#6a78d8", 0.7));

    /* ── sizing / mobile vs desktop camera ── */
    const layout = () => {
      mobile = mq.matches;
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = mobile ? 62 : 50;
      camera.position.set(0, mobile ? 1.6 : 1.7, mobile ? 8.5 : 7.5);
      lookY = mobile ? 0.6 : 2.0;
      tv.scale.setScalar(mobile ? 1.2 : 1);
      sky.material.uniforms.uAspect.value = w / h;
      camera.updateProjectionMatrix();
    };
    layout();
    window.addEventListener("resize", layout);

    /* ── pointer (desktop only) ── */
    const ptr = { x: 0, y: 0 };
    const onMove = (e) => {
      if (mobile) return;
      ptr.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.y = 1 - (e.clientY / window.innerHeight) * 2;
    };
    window.addEventListener("pointermove", onMove);

    /* ── loop ── */
    const timer = new THREE.Timer();
    let t = 0;
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      timer.update();
      const dt = Math.min(timer.getDelta(), 0.05);
      const ds = dt * speed;
      t += ds;
      const k = 1 - Math.exp(-dt * 3.2);

      // TV: glides along the hill toward the cursor (static on mobile)
      if (!mobile) {
        const tx = ptr.x * 2.6;
        const tz = -ptr.y * 1.4;
        const before = tv.position.x;
        tv.position.x += (tx - tv.position.x) * k;
        tv.position.z += (tz - tv.position.z) * k;
        tv.rotation.y += (ptr.x * 0.5 + Math.sin(t * 0.5) * 0.05 - tv.rotation.y) * k;
        tv.rotation.x += (-ptr.y * 0.18 - tv.rotation.x) * k;
        tv.rotation.z += ((before - tv.position.x) * 4 - tv.rotation.z) * k;
        camera.position.x += (ptr.x * 0.5 - camera.position.x) * k * 0.5;
      }
      tv.position.y = hill(tv.position.x, tv.position.z) - 0.04;
      ant.rotation.z = Math.sin(t * 1.3) * 0.03;
      const flick = 0.85 + 0.08 * Math.sin(t * 3.1) + 0.04 * Math.sin(t * 7.3);
      glow.material.opacity = flick * TV_GLOW;
      tvLight.intensity = 14 * TV_GLOW * flick;
      grassMat.uniforms.uTv.value.copy(tv.position);
      grassMat.uniforms.uTime.value = t;
      sky.material.uniforms.uTime.value = t;

      for (let i = 0; i < SP; i++) {
        spPos[i * 3 + 1] += ds * 0.18;
        spPos[i * 3] += Math.sin(t + i) * ds * 0.12;
        if (spPos[i * 3 + 1] > 10) spPos[i * 3 + 1] = 0;
      }
      spGeo.attributes.position.needsUpdate = true;

      camera.lookAt(0, lookY, 0);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", layout);
      window.removeEventListener("pointermove", onMove);
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