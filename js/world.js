import * as THREE from "three";
import { Noise } from "./noise.js";
import { COLORS, WORLD, PLACES } from "./config.js";

const isMobile = matchMedia("(max-width: 820px)").matches;

// ---- Shared height field: used both to build geometry and to seat objects ----
const noise = new Noise(WORLD.seed);

// A handful of craters scattered across the site.
const CRATERS = [];
(() => {
  const rng = new Noise(WORLD.seed + 7);
  for (let i = 0; i < 26; i++) {
    const a = rng.noise2D(i * 1.3, 11.7) * Math.PI * 4;
    const r = 40 + (rng.noise2D(i * 2.1, 4.2) * 0.5 + 0.5) * 380;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const rad = 12 + (rng.noise2D(i * 3.7, 9.1) * 0.5 + 0.5) * 46;
    const depth = 0.5 + (rng.noise2D(i * 5.2, 2.3) * 0.5 + 0.5) * 1.2;
    CRATERS.push({ cx, cz, rad, depth });
  }
})();

// Graded apron in front of the habitat supply port: a capsule from the port
// out along the approach, flat at the port level, blending back into the
// regolith. The robot turns round on it and reverses up to the port.
const APRON = (() => {
  const [px, pz] = PLACES.supplyPort, [dx, dz] = PLACES.dock;
  const len = Math.hypot(dx - px, dz - pz);
  return { px, pz, ux: (dx - px) / len, uz: (dz - pz) / len, len: 14, flat: 5, fade: 6 };
})();
APRON.level = rawHeight(APRON.px, APRON.pz);

export function sampleHeight(x, z) {
  const h = rawHeight(x, z);
  const A = APRON;
  const t = Math.min(Math.max((x - A.px) * A.ux + (z - A.pz) * A.uz, 0), A.len);
  const d = Math.hypot(x - (A.px + A.ux * t), z - (A.pz + A.uz * t));
  if (d >= A.flat + A.fade) return h;
  const k = Math.min(Math.max((d - A.flat) / A.fade, 0), 1);
  const w = 1 - k * k * (3 - 2 * k);
  return h + (A.level - h) * w;
}

function rawHeight(x, z) {
  const W = WORLD;
  // Base rolling regolith.
  let h = noise.fbm(x * 0.010, z * 0.010, 5, 2.1, 0.5) * W.heightScale;
  h += noise.ridged(x * 0.03, z * 0.03, 3, 2.2, 0.5) * W.heightScale * 0.28;
  // Craters: bowl + raised rim.
  for (const c of CRATERS) {
    const dx = x - c.cx, dz = z - c.cz;
    const d = Math.sqrt(dx * dx + dz * dz) / c.rad;
    if (d < 1.6) {
      const bowl = -(1 - Math.min(d, 1) ** 2) * c.depth * c.rad * 0.16;
      const rim = Math.exp(-((d - 1.0) ** 2) / 0.05) * c.depth * c.rad * 0.05;
      h += bowl + rim;
    }
  }
  // Fake planetary curvature so the far edge droops into a horizon.
  h -= (x * x + z * z) * W.curvature;
  return h;
}

// Terrain normal via finite differences.
export function terrainNormal(x, z, e = 1.2) {
  const dhdx = (sampleHeight(x + e, z) - sampleHeight(x - e, z)) / (2 * e);
  const dhdz = (sampleHeight(x, z + e) - sampleHeight(x, z - e)) / (2 * e);
  return new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: !isMobile, powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.space);
    this.scene.fog = new THREE.FogExp2(COLORS.fog, 0.0016);

    this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 4000);
    this.camera.position.set(8, 150, 360);

    this._buildLights();
    this._buildStars();
    this._buildEarth();
    this._buildTerrain();

    addEventListener("resize", () => this.resize());
  }

  _buildLights() {
    // Harsh, near-white sun at a low angle -> long lunar shadows.
    const sun = new THREE.DirectionalLight(COLORS.sun, 3.1);
    sun.position.set(-260, 90, 150);
    sun.castShadow = true;
    sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    const s = 150;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 900;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun);
    this.sun = sun;

    // Very low, cold fill so shadows stay close to black (space, no atmosphere).
    const hemi = new THREE.HemisphereLight(COLORS.fill, COLORS.ground, 0.18);
    this.scene.add(hemi);
    this.hemi = hemi;

    // Soft fill from the shadow side, ramped up only for the engineering inspection.
    const insp = new THREE.DirectionalLight(0xcdd6e0, 0.0);
    insp.position.set(220, 130, -70);
    this.scene.add(insp);
    this.inspLight = insp;
  }

  // k in 0..1 — blends from the cinematic surface look to a readable inspection.
  setInspection(k) {
    this.inspLight.intensity = k * 1.35;
    this.hemi.intensity = 0.18 + k * 0.32;
  }

  _buildStars() {
    const count = isMobile ? 2600 : 6500;
    const pos = new Float32Array(count * 3);
    const scale = new Float32Array(count);
    const phase = new Float32Array(count);
    const speed = new Float32Array(count);
    const tint = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Distribute on a large shell, biased toward the upper hemisphere.
      const u = Math.random(), v = Math.random() * 0.62 + 0.05;
      const theta = u * Math.PI * 2;
      const phi = Math.acos(1 - 2 * v);
      const r = 1400 + Math.random() * 900;
      pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      pos[i * 3 + 1] = Math.abs(Math.cos(phi)) * r * 0.9 + 40;
      pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
      scale[i] = 0.6 + Math.random() * Math.random() * 3.4;
      phase[i] = Math.random() * Math.PI * 2;
      // Most stars barely twinkle; a few twinkle noticeably, at varied intervals.
      speed[i] = Math.random() < 0.55 ? 0.15 + Math.random() * 0.5 : 0.9 + Math.random() * 2.2;
      // Mostly white, faint cool/warm variation.
      const t = Math.random();
      const c = t < 0.75 ? [1, 1, 1] : t < 0.9 ? [0.78, 0.86, 1.0] : [1.0, 0.9, 0.78];
      tint[i * 3] = c[0]; tint[i * 3 + 1] = c[1]; tint[i * 3 + 2] = c[2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aScale", new THREE.BufferAttribute(scale, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
    geo.setAttribute("aTint", new THREE.BufferAttribute(tint, 3));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uOpacity: { value: 0 },
      },
      vertexShader: `
        attribute float aScale; attribute float aPhase; attribute float aSpeed; attribute vec3 aTint;
        uniform float uTime; uniform float uPixelRatio;
        varying float vTw; varying vec3 vTint;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aScale * uPixelRatio * (300.0 / -mv.z);
          float s = sin(uTime * aSpeed + aPhase) * 0.5 + 0.5;
          vTw = 0.30 + 0.70 * pow(s, 1.6);
          vTint = aTint;
        }`,
      fragmentShader: `
        uniform float uOpacity; varying float vTw; varying vec3 vTint;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vTint, a * vTw * uOpacity);
        }`,
    });
    this.starMat = mat;
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  _buildEarth() {
    // A small, subtle Earth hanging in the black sky.
    const g = new THREE.SphereGeometry(26, 48, 48);
    const m = new THREE.MeshStandardMaterial({
      color: 0x24425f, roughness: 1, metalness: 0,
      emissive: 0x0a1522, emissiveIntensity: 0.4,
    });
    const earth = new THREE.Mesh(g, m);
    earth.position.set(430, 300, -760);
    this.scene.add(earth);
    // Faint atmosphere rim.
    const rim = new THREE.Mesh(
      new THREE.SphereGeometry(28.5, 48, 48),
      new THREE.MeshBasicMaterial({
        color: 0x6fa8d6, transparent: true, opacity: 0.12,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    rim.position.copy(earth.position);
    this.scene.add(rim);
    this.earth = earth;
  }

  _detailNormalMap() {
    // Small tiling normal map for fine regolith grain.
    const size = 256;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const n = new Noise(WORLD.seed + 99);
    const H = (x, y) => n.fbm(x * 0.08, y * 0.08, 4, 2.3, 0.55) * 0.5 + 0.5;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const hL = H(x - 1, y), hR = H(x + 1, y);
        const hD = H(x, y - 1), hU = H(x, y + 1);
        const nx = (hL - hR) * 2.2;
        const ny = (hD - hU) * 2.2;
        const nz = 1.0;
        const len = Math.hypot(nx, ny, nz);
        const i = (y * size + x) * 4;
        img.data[i] = (nx / len * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(90, 90);
    return tex;
  }

  _buildTerrain() {
    const W = WORLD;
    const seg = isMobile ? 180 : W.terrainSegments;
    const geo = new THREE.PlaneGeometry(W.terrainSize, W.terrainSize, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(COLORS.regolith);
    const dark = new THREE.Color(COLORS.regolithDark);
    const light = new THREE.Color(0xa9acb0);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = sampleHeight(x, z);
      pos.setY(i, h);
      // Tonal variation: crater floors darker, highs slightly brighter, plus mottling.
      const mottle = noise.fbm(x * 0.05, z * 0.05, 3, 2.0, 0.5) * 0.5 + 0.5;
      const t = THREE.MathUtils.clamp(0.5 + h / (W.heightScale * 1.6), 0, 1);
      tmp.copy(dark).lerp(base, t).lerp(light, mottle * 0.35);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.97,
      metalness: 0.0,
      normalMap: this._detailNormalMap(),
      normalScale: new THREE.Vector2(0.55, 0.55),
      dithering: true,
    });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    this.scene.add(terrain);
    this.terrain = terrain;
  }

  setFog(density) {
    if (this.scene.fog) this.scene.fog.density = density;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    if (this.starMat) this.starMat.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
  }

  update(elapsed, starReveal) {
    this.starMat.uniforms.uTime.value = elapsed;
    // Ease star opacity in during boot.
    const target = starReveal;
    const cur = this.starMat.uniforms.uOpacity.value;
    this.starMat.uniforms.uOpacity.value += (target - cur) * 0.04;
    this.stars.rotation.y = elapsed * 0.002;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
