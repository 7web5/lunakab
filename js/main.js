import * as THREE from "three";
import { World } from "./world.js";
import { Mission } from "./mission.js";
import { Interface } from "./interface.js";
import { SHOTS, MISSION_START, MISSION_END } from "./config.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const smoothstep = (t) => t * t * (3 - 2 * t);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const Y = new THREE.Vector3(0, 1, 0);

class App {
  constructor() {
    const canvas = document.getElementById("scene");
    this.world = new World(canvas);
    this.mission = new Mission(this.world.scene);
    this.iface = new Interface({
      world: this.world,
      mission: this.mission,
      onNavigate: (i) => this._scrollToSection(i),
      onReplay: () => this._playSimulation(),
    });

    // Camera state.
    this.curPos = new THREE.Vector3(...SHOTS[0].pos);
    this.curTgt = new THREE.Vector3(...SHOTS[0].target);
    this.world.camera.position.copy(this.curPos);
    this.world.camera.lookAt(this.curTgt);

    // Interaction state.
    this.pointer = { x: 0, y: 0 };
    this.lookYaw = 0; this.lookPitch = 0;
    this.engAngle = 0.6; this.engDrag = 0; this.engHeight = 0;
    this.dragging = false; this.dragMode = null;
    this.autoplay = false; this.autoT = 0;
    this.engActive = false;
    this.hintHidden = false;

    // Scratch vectors.
    this._p0 = new THREE.Vector3(); this._p1 = new THREE.Vector3();
    this._t0 = new THREE.Vector3(); this._t1 = new THREE.Vector3();
    this._center = new THREE.Vector3();

    this._bindPointer();
    addEventListener("scroll", () => this._onScroll(), { passive: true });

    // Arriving back from a detail page: skip the intro and land on its section.
    const RETURN = { "#problem": 1, "#research": 2, "#designs": 3, "#lunakab": 5, "#engineering": SHOTS.findIndex((s) => s.orbit) };
    const returnTo = RETURN[location.hash];
    this.iface.runBoot(() => { /* HUD revealed inside */ }, { instant: returnTo !== undefined });
    if (returnTo !== undefined) {
      requestAnimationFrame(() => scrollTo({ top: (returnTo / (SHOTS.length - 1)) * this.scrollMax, behavior: "auto" }));
    }
    this._loop();
  }

  get scrollMax() { return Math.max(1, document.documentElement.scrollHeight - innerHeight); }

  _onScroll() {
    if (!this.hintHidden && scrollY > 40) { this.iface.hideHint(); this.hintHidden = true; }
  }

  _scrollToSection(i) {
    const y = (i / (SHOTS.length - 1)) * this.scrollMax;
    scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
  }

  _bindPointer() {
    addEventListener("pointermove", (e) => {
      this.pointer.x = (e.clientX / innerWidth) * 2 - 1;
      this.pointer.y = (e.clientY / innerHeight) * 2 - 1;
      if (this.dragging) {
        const dx = e.movementX || 0, dy = e.movementY || 0;
        if (this.dragMode === "eng") {
          this.engDrag -= dx * 0.006;
          this.engHeight = clamp(this.engHeight - dy * 0.03, -3, 6);
        } else {
          this.lookYaw = clamp(this.lookYaw - dx * 0.0016, -0.28, 0.28);
          this.lookPitch = clamp(this.lookPitch - dy * 0.0014, -0.18, 0.22);
        }
      }
    });
    const canvas = this.world.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      if (this.engActive) this.dragMode = "eng";
      else if (e.pointerType === "mouse") this.dragMode = "look";
      else return; // let touch scroll the page outside engineering
      this.dragging = true;
      canvas.setPointerCapture?.(e.pointerId);
    });
    const end = () => { this.dragging = false; this.dragMode = null; };
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
  }

  _playSimulation() {
    if (this.autoplay) return;
    document.body.classList.add("simulating");
    this.autoplay = true;
    this.autoT = App.SIM_A;
    this._autoStart = performance.now();
  }

  // Returns the camera position for keyframe i (special-cased for engineering orbit + robot-follow).
  _shotPos(i, out) {
    const s = SHOTS[i];
    if (s.orbit) {
      const c = this._center;
      c.copy(this.mission.focus); c.y += 3.2;
      const a = this.engAngle + this.engDrag;
      const r = 10.5;
      return out.set(c.x + Math.sin(a) * r, c.y + 4.5 + this.engHeight, c.z + Math.cos(a) * r);
    }
    if (s.follow) {
      const r = this.mission.robot.position, o = s.follow.off;
      return out.set(r.x + o[0], r.y + o[1], r.z + o[2]);
    }
    return out.set(...s.pos);
  }
  _shotTarget(i, out) {
    const s = SHOTS[i];
    if (s.orbit) { out.copy(this.mission.focus); out.y += 3.2; return out; }
    if (s.follow) {
      const r = this.mission.robot.position;
      let dir;
      if (s.follow.toward === "habitat") dir = this.mission.portWorld.clone().sub(r).setY(0).normalize();
      else dir = (this.mission._robotFwd || new THREE.Vector3(0, 0, 1)).clone();
      return out.set(r.x + dir.x * s.follow.lead, r.y + s.follow.up, r.z + dir.z * s.follow.lead);
    }
    return out.set(...s.target);
  }

  _computeCamera(sectionT, dt) {
    const n = SHOTS.length - 1;
    const st = clamp(sectionT, 0, n);
    const i0 = Math.floor(st), i1 = Math.min(i0 + 1, n);
    const f = smoothstep(st - i0);

    // Advance engineering auto-rotation when in/near the inspection.
    this.engActive = sectionT > 5.6 && sectionT < 6.4;
    this.engBlend = clamp(1 - Math.abs(sectionT - 6) / 0.5, 0, 1);
    this.engBlend = smoothstep(this.engBlend);
    if (sectionT > 5.4 && sectionT < 6.6 && !this.dragging) this.engAngle += dt * 0.18;

    this._shotPos(i0, this._p0); this._shotPos(i1, this._p1);
    this._shotTarget(i0, this._t0); this._shotTarget(i1, this._t1);
    const pos = this._p0.clone().lerp(this._p1, f);
    const tgt = this._t0.clone().lerp(this._t1, f);
    const fog = SHOTS[i0].fog + (SHOTS[i1].fog - SHOTS[i0].fog) * f;
    this.world.setFog(fog);

    // Mouse parallax (skip during engineering orbit / reduced motion).
    if (!reduce && !this.engActive) {
      const off = pos.clone().sub(tgt);
      const dist = off.length();
      const k = clamp(dist * 0.012, 0.4, 6);
      const right = off.clone().cross(Y).normalize();
      const up = right.clone().cross(off).normalize();
      pos.addScaledVector(right, -this.pointer.x * k);
      pos.addScaledVector(up, this.pointer.y * k * 0.6);
      tgt.addScaledVector(right, -this.pointer.x * k * 0.25);
    }

    // Drag free-look (non-engineering): rotate offset around target, ease back.
    if (!this.engActive) {
      if (!this.dragging) { this.lookYaw *= 0.9; this.lookPitch *= 0.9; }
      if (Math.abs(this.lookYaw) > 1e-4 || Math.abs(this.lookPitch) > 1e-4) {
        const off = pos.clone().sub(tgt);
        off.applyAxisAngle(Y, this.lookYaw);
        const right = off.clone().cross(Y).normalize();
        off.applyAxisAngle(right, this.lookPitch);
        pos.copy(tgt).add(off);
      }
    }

    // Critically-damped follow for a physical feel.
    const lerp = this.autoplay ? 0.05 : 0.075;
    this.curPos.lerp(pos, lerp);
    this.curTgt.lerp(tgt, lerp);
    this.world.camera.position.copy(this.curPos);
    this.world.camera.lookAt(this.curTgt);
  }

  _currentSectionT() {
    if (this.autoplay) return this.autoT;
    return clamp((scrollY / this.scrollMax) * (SHOTS.length - 1), 0, SHOTS.length - 1);
  }

  _loop() {
    const tick = () => {
      const dt = Math.min(this.world.clock.getDelta(), 0.05);
      const elapsed = this.world.clock.elapsedTime;

      if (this.autoplay) {
        const p = (performance.now() - this._autoStart) / 11000;
        this.autoT = App.SIM_A + smoothstep(clamp(p, 0, 1)) * (App.SIM_B - App.SIM_A);
        if (p >= 1.15) { this.autoplay = false; document.body.classList.remove("simulating"); }
      }

      const sectionT = this._currentSectionT();
      const mp = clamp((sectionT - MISSION_START) / (MISSION_END - MISSION_START), 0, 1);
      const mstate = this.mission.update(mp, dt);

      this._computeCamera(sectionT, dt);
      this.world.setInspection(this.engBlend || 0);
      this.world.update(elapsed, 1.0);
      this.iface.update(sectionT, mstate, this.engActive);
      this.world.render();

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// Replay window (in section-space): from just before roll-out to fully docked.
App.SIM_A = 1.9;
App.SIM_B = 5.35;

// WebGL guard.
function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch { return false; }
}

if (hasWebGL()) {
  window.__hunch = new App();
} else {
  document.getElementById("boot").innerHTML =
    '<div style="color:#fff;font-family:monospace;letter-spacing:.2em;text-align:center;padding:2rem">WEBGL UNAVAILABLE<br><br>This mission interface requires a WebGL-capable browser.</div>';
}
