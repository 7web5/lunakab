import * as THREE from "three";
import { PLACES, MARKERS } from "./config.js";
import { sampleHeight } from "./world.js";

const $ = (s) => document.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Interface {
  constructor({ world, mission, onNavigate, onReplay }) {
    this.world = world;
    this.camera = world.camera;
    this.mission = mission;
    this.onNavigate = onNavigate;
    this.onReplay = onReplay;
    this.metStart = 0;
    this.section = 0;

    this._els = {
      boot: $("#boot"), bootStatus: $("#boot-status"), bootTitle: $("#boot-title"), bootLogo: $("#boot-logo"),
      bootSub: $("#boot-sub"), bootTag: $("#boot-tag"), bootBar: $("#boot-bar"), bootSkip: $("#boot-skip"),
      hud: $("#hud"), met: $("#met-clock"), coord: $("#coord"),
      mstatus: $("#mstatus"), mphase: $("#mphase"),
      distance: $("#t-distance"), payload: $("#t-payload"), docking: $("#t-docking"), tbar: $("#t-bar"),
      hint: $("#scroll-hint"), markers: $("#markers"),
    };

    this._buildMarkers();
    this._bindNav();
    this._observePanels();
    this._bindReplay();
    this._v = new THREE.Vector3();
  }

  /* ---------------- BOOT SEQUENCE ---------------- */
  // `instant` skips the typed intro (e.g. returning from the subsystems page).
  async runBoot(onDone, { instant = false } = {}) {
    const e = this._els;
    e.bootSkip.addEventListener("click", () => { skipped = true; });
    let skipped = false;

    const type = async (el, text, speed = 60) => {
      el.textContent = "";
      for (let i = 0; i <= text.length; i++) {
        if (skipped) { el.textContent = text; return; }
        el.innerHTML = text.slice(0, i) + '<span class="cursor">▍</span>';
        await wait(speed);
      }
      el.textContent = text;
    };

    const WORDMARK = 'LUNA<span class="kab">KAB</span>';
    e.bootLogo.classList.add("on");

    if (instant) {
      e.bootTitle.innerHTML = WORDMARK;
      return this._finishBoot(onDone);
    }

    if (reduce) {
      e.bootTitle.innerHTML = WORDMARK;
      e.bootSub.textContent = "LUNAR CARGO ROBOTICS";
      e.bootTag.textContent = "NASA HUNCH · EXTERNAL CARGO TRANSPORT";
      await wait(700);
      return this._finishBoot(onDone);
    }

    const statuses = [
      "INITIALIZING GUIDANCE COMPUTER",
      "LINKING DEEP SPACE NETWORK",
      "STAR TRACKER · LOCK ACQUIRED",
      "SURFACE MAP · LLASO SITE 02",
    ];
    for (const s of statuses) {
      if (skipped) break;
      e.bootStatus.textContent = s;
      await wait(620);
    }
    e.bootStatus.textContent = "MISSION INTERFACE ONLINE";

    await type(e.bootTitle, "LUNAKAB", 130);
    e.bootTitle.innerHTML = WORDMARK;
    await wait(240);
    await type(e.bootSub, "LUNAR CARGO ROBOTICS", 45);
    await wait(180);
    await type(e.bootTag, "NASA HUNCH · EXTERNAL CARGO TRANSPORT", 28);

    e.bootBar.classList.add("on");
    await wait(60);
    e.bootBar.querySelector("span").style.width = "100%";
    await wait(skipped ? 200 : 1900);
    this._finishBoot(onDone);
  }

  _finishBoot(onDone) {
    const e = this._els;
    e.boot.classList.add("done");
    e.hud.classList.add("on");
    e.hud.setAttribute("aria-hidden", "false");
    this.metStart = performance.now();
    setTimeout(() => { e.boot.style.display = "none"; }, 1700);
    onDone && onDone();
  }

  /* ---------------- MAP MARKERS ---------------- */
  _buildMarkers() {
    this._markers = MARKERS.map((m) => {
      const [x, z] = PLACES[m.place];
      const yOff = m.place === "habitat" || m.place === "supplyPort" ? 9 : 3;
      const world = new THREE.Vector3(x, sampleHeight(x, z) + yOff, z);
      const el = document.createElement("div");
      el.className = "marker";
      el.innerHTML = `<div class="dot"></div><div class="tick"></div><div class="lbl">${m.label}</div><div class="sub">${m.sub}</div>`;
      this._els.markers.appendChild(el);
      return { ...m, world, el };
    });
  }

  _updateMarkers() {
    const sec = this.section;
    for (const m of this._markers) {
      const inRange = sec >= m.from && sec <= m.to && !this._engActive;
      this._v.copy(m.world).project(this.camera);
      const onScreen = this._v.z < 1 && this._v.x > -1.05 && this._v.x < 1.05 && this._v.y > -1.05 && this._v.y < 1.05;
      if (inRange && onScreen) {
        const px = (this._v.x * 0.5 + 0.5) * innerWidth;
        const py = (-this._v.y * 0.5 + 0.5) * innerHeight;
        m.el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
        m.el.classList.add("show");
      } else {
        m.el.classList.remove("show");
      }
    }
  }

  /* ---------------- NAV ---------------- */
  _bindNav() {
    this._nav = [...document.querySelectorAll("#nav li")];
    for (const li of this._nav) {
      li.addEventListener("click", () => this.onNavigate(parseInt(li.dataset.target, 10)));
    }
  }

  _updateNav(section) {
    let best = null;
    for (const li of this._nav) {
      const t = parseInt(li.dataset.target, 10);
      if (t <= section + 0.5) best = li;
    }
    for (const li of this._nav) li.classList.toggle("active", li === best);
  }

  /* ---------------- PANELS + FINAL ---------------- */
  _observePanels() {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          if (e.target.classList.contains("final")) this._playFinal();
        }
      }
    }, { threshold: reduce ? 0.05 : 0.35 });
    document.querySelectorAll(".panel").forEach((p) => io.observe(p));
  }

  _playFinal() {
    if (this._finalPlayed) return;
    this._finalPlayed = true;
    const lines = [...document.querySelectorAll(".mc-line")];
    lines.forEach((l, i) => setTimeout(() => l.classList.add("in"), 300 + i * 650));
  }

  _bindReplay() {
    const btn = $("#replay");
    if (btn) btn.addEventListener("click", () => this.onReplay && this.onReplay());
  }

  /* ---------------- PER-FRAME UPDATE ---------------- */
  update(sectionT, mstate, engActive) {
    this.section = sectionT;
    const sec = Math.round(sectionT);

    // MET clock.
    if (this.metStart) {
      const s = Math.floor((performance.now() - this.metStart) / 1000);
      const hh = String(Math.floor(s / 3600)).padStart(2, "0");
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      this._els.met.textContent = `${hh}:${mm}:${ss}`;
    }
    // Flavor coordinates from camera.
    const cp = this.camera.position;
    const lat = (11.6 + cp.z * 0.008).toFixed(1);
    const lon = (41.2 + cp.x * 0.01).toFixed(1);
    this._els.coord.textContent = `LAT ${Math.abs(lat)}°N · LON ${Math.abs(lon)}°E`;

    // Mission status text per section.
    const STATUS = ["STANDBY", "SURVEY", "DEPLOYED", "LOADING", "IN TRANSIT", "UNLOADING", "INSPECTION", "COMPLETE"];
    this._els.mstatus.textContent = STATUS[Math.min(sec, 7)];
    this._els.mphase.textContent = `${String(Math.min(sec + 1, 8)).padStart(2, "0")} / 08`;

    // Telemetry.
    const d = this._els;
    d.distance.textContent = mstate.payload === "EMPTY" && sectionT < 2 ? "—" : `${mstate.distance} m`;
    d.payload.textContent = mstate.payload;
    d.docking.textContent = mstate.docking;
    const done = (v) => v === "SECURED" || v === "DELIVERED" || v === "DOCKED" || v === "DOOR OPEN";
    const busy = (v) => /^(LOADING|UNLOADING|ALIGNING)/.test(v);
    d.payload.className = "val " + (done(mstate.payload) ? "ok" : busy(mstate.payload) ? "hot" : "");
    d.docking.className = "val " + (done(mstate.docking) ? "ok" : busy(mstate.docking) ? "hot" : "");
    d.tbar.style.width = `${Math.round(mstate.progress * 100)}%`;

    this._updateNav(sectionT);
    this._updateMarkers();
    this._engActive = engActive;
  }

  hideHint() { this._els.hint.classList.add("hide"); }
}
