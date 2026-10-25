import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { World, sampleHeight, terrainNormal } from "./world.js";
import { buildRobot, buildCargoPiece, BAY, CARGO, CRANE } from "./robot.js";
import { COLORS, ENGINEERING } from "./config.js";

// Subsystems inspection page: the transport robot parked on the regolith.
// Click (or tap) a part to open its brief, with a rendered figure that shows
// that subsystem highlighted on the robot.

const $ = (s) => document.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SIGNAL = new THREE.Color(COLORS.signal);
const SITE = [-34, 16];             // quiet patch of regolith off the mission traverse
const HEADING = new THREE.Vector3(-0.35, 0, 1).normalize();
const BY_ID = Object.fromEntries(ENGINEERING.map((c) => [c.id, c]));
const FIT_RADIUS = 4.4;              // robot bounding radius (+margin) kept in frame
const shortName = (t) => t.replace(" SYSTEM", "").replace(" MECHANISM", "").replace(" SENSORS", "");

// Parked pose: hatch open with the crane reaching out holding a piece, two
// pieces on the conveyor, rear door partly open.
function poseForDisplay(rig) {
  rig.pose({ hatch: 1, extend: 1.7, grabY: CRANE.raisedY, claw: 1, belt: 0.3, door: 0.35 });
  const hooked = buildCargoPiece();
  const g = rig.grabber.position;
  hooked.position.set(0, g.y - CARGO.h / 2, g.z);
  rig.chassis.add(hooked);
  for (const z of BAY.slots.slice(2)) {
    const p = buildCargoPiece();
    p.position.set(0, BAY.beltY + CARGO.h / 2, z);
    rig.chassis.add(p);
  }
}

/* ---------------- HIGHLIGHT FIGURE ----------------
   A second, offscreen renderer draws the robot as a faint wireframe ghost with
   the chosen subsystem solid and lit in the signal colour, framed by brackets. */
class FigureRenderer {
  constructor() {
    this.w = 800; this.h = 500;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.w, this.h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070a);
    scene.add(new THREE.HemisphereLight(0xcfd8e2, 0x0a0c10, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(-6, 10, 8); scene.add(key);
    const rim = new THREE.DirectionalLight(COLORS.signal, 0.8); rim.position.set(8, 4, -6); scene.add(rim);
    const grid = new THREE.GridHelper(40, 40, 0x1d2a33, 0x0e151b);
    scene.add(grid);
    this.scene = scene;

    const rig = buildRobot();
    poseForDisplay(rig);
    scene.add(rig.group);
    rig.group.updateMatrixWorld(true);
    this.robot = rig.group;

    this.ghost = new THREE.MeshBasicMaterial({ color: 0x8b9aa6, transparent: true, opacity: 0.06, depthWrite: false });
    this.edgeDim = new THREE.LineBasicMaterial({ color: 0x7f909c, transparent: true, opacity: 0.3 });
    this.edgeHot = new THREE.LineBasicMaterial({ color: COLORS.signal });
    this.meshes = [];
    rig.group.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
    for (const m of this.meshes) {
      const hot = m.material.clone();
      hot.emissive = SIGNAL.clone(); hot.emissiveIntensity = 0.4;
      m.userData.hot = hot;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), this.edgeDim);
      m.add(edges); m.userData.edges = edges;
    }

    this.camera = new THREE.PerspectiveCamera(30, this.w / this.h, 0.1, 200);
    this.out = document.createElement("canvas");
    this.out.width = this.w; this.out.height = this.h;
    this.ctx = this.out.getContext("2d");
    this.cache = {};
  }

  get(c) {
    if (this.cache[c.id]) return this.cache[c.id];
    const box = new THREE.Box3();
    for (const m of this.meshes) {
      const hot = m.userData.subsystem === c.id;
      m.material = hot ? m.userData.hot : this.ghost;
      m.renderOrder = hot ? 1 : 0;
      m.userData.edges.material = hot ? this.edgeHot : this.edgeDim;
      if (hot) box.expandByObject(m);
    }
    const center = box.getCenter(new THREE.Vector3());
    const target = new THREE.Vector3(0, 1.4, 0).lerp(center, 0.5);
    const dir = new THREE.Vector3(...c.view).normalize();
    this.camera.position.copy(target).addScaledVector(dir, 15);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);

    // Composite: render + bracket around the highlighted part + labels.
    const { ctx, w, h } = this;
    ctx.drawImage(this.renderer.domElement, 0, 0);
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(this.camera);
      const sx = (p.x * 0.5 + 0.5) * w, sy = (-p.y * 0.5 + 0.5) * h;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    const pad = 14;
    x0 = Math.max(12, x0 - pad); y0 = Math.max(12, y0 - pad);
    x1 = Math.min(w - 12, x1 + pad); y1 = Math.min(h - 12, y1 + pad);
    const L = Math.min(22, (x1 - x0) / 3, (y1 - y0) / 3);
    ctx.strokeStyle = "#9fc7d8"; ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.moveTo(cx + dx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * L);
    }
    ctx.stroke();
    ctx.font = '500 15px "IBM Plex Mono", monospace';
    ctx.fillStyle = "#9fc7d8";
    const label = shortName(c.title);
    const lw = ctx.measureText(label).width;
    const ly = y0 > 40 ? y0 - 10 : y1 + 24;
    ctx.fillText(label, Math.min(Math.max(x0, 18), w - lw - 18), ly);
    ctx.font = '400 13px "IBM Plex Mono", monospace';
    ctx.fillStyle = "#5b636b";
    ctx.fillText(`FIG. ${c.n}`, 22, 34);
    ctx.fillText("R-00 · CARGO TRANSPORT", 22, h - 22);

    return (this.cache[c.id] = this.out.toDataURL("image/png"));
  }
}

/* ---------------- PAGE ---------------- */
class SubsystemsPage {
  constructor() {
    const canvas = $("#scene");
    this.canvas = canvas;
    this.world = new World(canvas);
    this.world.setFog(0.0055);
    this.world.setInspection(0.8);
    this.camera = this.world.camera;
    this.figures = new FigureRenderer();

    this._placeRobot();
    this._indexParts();
    this._scatterRocks();
    this._buildList();
    this._bindCard();
    this._setupControls();
    this._bindPicking();

    this.hovered = null;
    this.selected = null;
    this.shift = new THREE.Vector2();
    this._loop();
  }

  _placeRobot() {
    const rig = buildRobot();
    const robot = rig.group;
    const [x, z] = SITE;
    // Robot origin is the ground contact; settle slightly into the regolith.
    robot.position.set(x, sampleHeight(x, z) - 0.08, z);
    const up = terrainNormal(x, z, 2.5);
    const right = new THREE.Vector3().crossVectors(up, HEADING).normalize();
    const fwd = new THREE.Vector3().crossVectors(right, up).normalize();
    robot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
    poseForDisplay(rig);
    robot.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.world.scene.add(robot);
    robot.updateMatrixWorld(true);
    this.robot = robot;
    this.rig = rig;
    this.center = robot.localToWorld(new THREE.Vector3(0, 1.8, 0.2));

    // Keep the sun's shadow camera centred on the robot so its shadow is crisp.
    const sun = this.world.sun;
    sun.target.position.copy(robot.position);
    sun.position.copy(robot.position).add(new THREE.Vector3(-260, 90, 150).normalize().multiplyScalar(160));
    sun.shadow.camera.left = sun.shadow.camera.bottom = -24;
    sun.shadow.camera.right = sun.shadow.camera.top = 24;
    sun.shadow.camera.updateProjectionMatrix();
    this.world.scene.add(sun.target);
  }

  _indexParts() {
    this.parts = {};
    this.robot.traverse((o) => {
      const id = o.userData.subsystem;
      if (!o.isMesh || !id) return;
      o.material = o.material.clone();
      o.userData.baseEmissive = o.material.emissive.clone();
      o.userData.baseIntensity = o.material.emissiveIntensity;
      (this.parts[id] ||= []).push(o);
    });
    this.partCenter = {};
    for (const [id, meshes] of Object.entries(this.parts)) {
      const box = new THREE.Box3();
      for (const m of meshes) box.expandByObject(m);
      this.partCenter[id] = box.getCenter(new THREE.Vector3());
    }
  }

  _scatterRocks() {
    const [cx, cz] = SITE;
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x71747a, roughness: 1, metalness: 0 });
    const spots = [[-9, 4, 1.1], [7, -6, 0.8], [11, 7, 1.6], [-6, -9, 0.6], [-14, -3, 2.2], [3, 12, 0.7], [16, -2, 0.9]];
    for (const [dx, dz, r] of spots) {
      const geo = new THREE.DodecahedronGeometry(r, 0);
      const p = geo.attributes.position;
      for (let k = 0; k < p.count; k++) {
        p.setXYZ(k, p.getX(k) * (0.8 + Math.random() * 0.5), p.getY(k) * (0.55 + Math.random() * 0.35), p.getZ(k) * (0.8 + Math.random() * 0.5));
      }
      geo.computeVertexNormals();
      const rock = new THREE.Mesh(geo, rockMat);
      const x = cx + dx, z = cz + dz;
      rock.position.set(x, sampleHeight(x, z) + r * 0.25, z);
      rock.rotation.set(Math.random(), Math.random() * 6, Math.random());
      rock.castShadow = true; rock.receiveShadow = true;
      this.world.scene.add(rock);
    }
  }

  _setupControls() {
    const cam = this.camera;
    const c = new OrbitControls(cam, this.canvas);
    this.controls = c;
    cam.position.copy(this.center).add(new THREE.Vector3(-8.5, 4.8, 12).setLength(this._fitDistance(false)));
    c.target.copy(this.center);
    c.enableDamping = true; c.dampingFactor = 0.08;
    c.enablePan = false;
    c.minDistance = 6; c.maxDistance = 30;
    c.maxPolarAngle = Math.PI * 0.47;
    c.autoRotate = !reduce; c.autoRotateSpeed = 0.45;
    c.addEventListener("start", () => { c.autoRotate = false; this.fly = null; });
    c.update();
  }

  // Screen region not covered by the subsystem list / detail card.
  _freeRect(withCard) {
    const W = innerWidth, H = innerHeight;
    const list = $("#sys-list").getBoundingClientRect();
    const card = this.card.root.getBoundingClientRect();
    if (W > 820) return { l: list.right + 16, r: withCard ? card.left - 16 : W, t: 0, b: H };
    return { l: 0, r: W, t: 0, b: withCard ? card.top : list.top };
  }

  // Camera distance that fits the whole robot inside the free region.
  _fitDistance(withCard) {
    const f = this._freeRect(withCard);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanX = tanV * this.camera.aspect * ((f.r - f.l) / innerWidth);
    const tanY = tanV * ((f.b - f.t) / innerHeight);
    const d = (FIT_RADIUS / Math.max(Math.min(tanX, tanY), 0.05)) * 1.1;
    return THREE.MathUtils.clamp(d, 11, this.controls.maxDistance);
  }

  /* ---------- left rail ---------- */
  _buildList() {
    const host = $("#sys-list");
    this.items = {};
    for (const c of ENGINEERING) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sys-item";
      b.innerHTML = `<i>${c.n}</i>${shortName(c.title)}`;
      b.addEventListener("click", () => (this.selected === c.id ? this.close() : this.select(c.id)));
      b.addEventListener("mouseenter", () => { this.listHover = c.id; });
      b.addEventListener("mouseleave", () => { this.listHover = null; });
      host.appendChild(b);
      this.items[c.id] = b;
    }
  }

  /* ---------- detail card ---------- */
  _bindCard() {
    this.card = {
      root: $("#sys-card"), index: $("#c-index"), img: $("#c-img"), cap: $("#c-cap"),
      title: $("#c-title"), body: $("#c-body"), spec: $("#c-spec"),
    };
    $("#c-close").addEventListener("click", () => this.close());
    $("#c-prev").addEventListener("click", () => this.step(-1));
    $("#c-next").addEventListener("click", () => this.step(1));
    addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
      else if (this.selected && e.key === "ArrowRight") this.step(1);
      else if (this.selected && e.key === "ArrowLeft") this.step(-1);
    });
  }

  step(d) {
    const i = ENGINEERING.findIndex((c) => c.id === this.selected);
    const n = ENGINEERING.length;
    this.select(ENGINEERING[(i + d + n) % n].id);
  }

  select(id) {
    const c = BY_ID[id];
    if (!c) return;
    this.selected = id;
    for (const [k, b] of Object.entries(this.items)) b.classList.toggle("active", k === id);

    const k = this.card;
    k.index.textContent = `SUBSYSTEM ${c.n} / ${String(ENGINEERING.length).padStart(2, "0")}`;
    k.title.textContent = c.title;
    k.body.textContent = c.body;
    k.spec.innerHTML = c.specs.map(([a, b]) => `<div><span class="k">${a}</span><span class="v">${b}</span></div>`).join("");
    k.img.src = this.figures.get(c);
    k.img.alt = `${c.title} highlighted on the cargo transport robot`;
    k.cap.textContent = `FIG. ${c.n} — ${c.title} · HIGHLIGHTED`;
    k.root.classList.add("open");
    document.body.classList.add("card-open");
    k.root.setAttribute("aria-hidden", "false");
    k.root.scrollTop = 0;

    // Swing the camera round to this subsystem's inspection angle.
    const tgt = this.center.clone().lerp(this.partCenter[id], 0.6);
    const dir = new THREE.Vector3(...c.view).normalize().applyQuaternion(this.robot.quaternion);
    if (dir.y < 0.15) dir.y = 0.15;
    dir.normalize();
    const dist = this._fitDistance(true);
    this.fly = { tgt, pos: tgt.clone().addScaledVector(dir, dist) };
    this.controls.autoRotate = false;
  }

  close() {
    if (!this.selected) return;
    this.selected = null;
    for (const b of Object.values(this.items)) b.classList.remove("active");
    this.card.root.classList.remove("open");
    document.body.classList.remove("card-open");
    this.card.root.setAttribute("aria-hidden", "true");
    this.fly = { tgt: this.center.clone(), pos: null };
  }

  /* ---------- picking ---------- */
  _bindPicking() {
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tip = $("#sys-tip");
    const cv = this.canvas;
    let down = null;

    cv.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const id = down ? null : this._pick(e);
      this.hovered = id;
      cv.classList.toggle("over-part", !!id);
      if (id) {
        const c = BY_ID[id];
        this.tip.innerHTML = `<b>${c.n}</b>${shortName(c.title)}`;
        this.tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`;
        this.tip.classList.add("show");
      } else this.tip.classList.remove("show");
    });
    cv.addEventListener("pointerleave", () => { this.hovered = null; this.tip.classList.remove("show"); });
    cv.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener("pointerup", (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 6) return; // that was an orbit drag, not a click
      const id = this._pick(e);
      if (id) this.select(id);
      else this.close();
    });
  }

  _pick(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObject(this.robot, true).find((h) => h.object.userData.subsystem);
    return hit ? hit.object.userData.subsystem : null;
  }

  /* ---------- per frame ---------- */
  _applyGlow(t) {
    const hover = this.hovered || this.listHover;
    for (const b of Object.values(this.items)) b.classList.remove("hover");
    if (hover && this.items[hover]) this.items[hover].classList.add("hover");
    for (const [id, meshes] of Object.entries(this.parts)) {
      const k = id === this.selected ? 0.5 + 0.2 * Math.sin(t * 3)
        : id === hover ? 0.32 : 0;
      for (const m of meshes) {
        if (k > 0) { m.material.emissive.copy(SIGNAL); m.material.emissiveIntensity = k; }
        else { m.material.emissive.copy(m.userData.baseEmissive); m.material.emissiveIntensity = m.userData.baseIntensity; }
      }
    }
  }

  // Shift the rendered view so the robot stays centred in the space the card leaves free.
  _updateViewShift() {
    const f = this._freeRect(!!this.selected);
    const want = new THREE.Vector2(innerWidth / 2 - (f.l + f.r) / 2, innerHeight / 2 - (f.t + f.b) / 2);
    this.shift.lerp(want, reduce ? 1 : 0.08);
    this.camera.setViewOffset(innerWidth, innerHeight, this.shift.x, this.shift.y, innerWidth, innerHeight);
  }

  _loop() {
    let first = true;
    const tick = () => {
      const dt = Math.min(this.world.clock.getDelta(), 0.05);
      const t = this.world.clock.elapsedTime;

      if (this.fly) {
        const k = reduce ? 1 : 0.06;
        this.controls.target.lerp(this.fly.tgt, k);
        if (this.fly.pos) this.camera.position.lerp(this.fly.pos, k);
        const done = this.controls.target.distanceTo(this.fly.tgt) < 0.02
          && (!this.fly.pos || this.camera.position.distanceTo(this.fly.pos) < 0.05);
        if (done) this.fly = null;
      }
      this.controls.update();
      this.rig.drum.rotation.y += dt * 2.0;
      this._applyGlow(t);
      this._updateViewShift();
      this.world.update(t, 1.0);
      this.world.render();

      if (first) { first = false; $("#veil").classList.add("off"); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch { return false; }
}

if (hasWebGL()) {
  window.__subsystems = new SubsystemsPage();
} else {
  document.body.innerHTML =
    '<div style="color:#fff;font-family:monospace;letter-spacing:.2em;text-align:center;padding:4rem 2rem">WEBGL UNAVAILABLE<br><br>This inspection view requires a WebGL-capable browser.</div>';
}
