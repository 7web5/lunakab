import * as THREE from "three";
import { COLORS, PLACES, PATH, TIMELINE as TL, CARGO_COUNT } from "./config.js";
import { sampleHeight } from "./world.js";
import { buildRobot, buildCargoPiece, BAY, CRANE, CARGO } from "./robot.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...opts });
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const ease = (k) => k * k * (3 - 2 * k);
// Signed shortest yaw from heading a to heading b (horizontal vectors).
const turnAngle = (a, b) => { const d = Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z); return Math.atan2(Math.sin(d), Math.cos(d)); };
const PORT_H = 2.17;      // habitat door centre height — matches the robot's rear door
const PORT_D = 0.4;       // habitat door frame depth
const DOCK_GAP = 3.32;    // habitat door → robot centre when docked (rear collar on the frame)
const TURN_GAP = 7;       // how far out from the dock the robot pivots before backing in
const EXIT_Z = -4.0;      // robot-local z where cargo has passed inside the habitat
// Payloader hold, in the robot's frame while it is parked nose-in at it.
// Its open end clears the robot's corners as it pivots in place (radius ~3.6).
const MODULE = { z0: 3.75, z1: 7.9, floorTop: 2.45, halfW: 0.95, roof: 4.1, slots: [4.35, 5.35, 6.35, 7.35] };

export class Mission {
  constructor(scene) {
    this.scene = scene;
    this.prevT = 0;
    this.state = { distance: 0, payload: "EMPTY", docking: "STANDBY", progress: 0, speed: 0 };

    this._buildPath();
    this._buildLander();
    this._buildHabitat();
    this._buildObstacles();
    this._buildRobot();
    this._buildCargo();

    this.totalMeters = 208; // presented distance across the site
  }

  _seat(x, z, clearance = 0) { return V(x, sampleHeight(x, z) + clearance, z); }

  _buildPath() {
    // The robot starts docked at the habitat (rear on the door, facing out),
    // drives the route out to the payloader, and reverses back onto the door.
    const [px, pz] = PLACES.supplyPort, [dx, dz] = PLACES.dock;
    this.portDir = V(dx - px, 0, dz - pz).normalize();          // door → outward
    const dock = V(px, 0, pz).addScaledVector(this.portDir, DOCK_GAP);
    this.turnXZ = dock.clone().addScaledVector(this.portDir, TURN_GAP);

    const curve = (pts) => new THREE.CatmullRomCurve3(pts.map(([x, z]) => this._seat(x, z, 1.3)), false, "catmullrom", 0.5);
    const out = [[dock.x, dock.z], [this.turnXZ.x, this.turnXZ.z], ...PATH.slice().reverse()];
    this.curveOut = curve(out);
    this.lenOut = this.curveOut.getLength();
    this.curve = curve([...PATH, [this.turnXZ.x, this.turnXZ.z]]);
    this.curveLen = this.curve.getLength();
  }

  _buildLander() {
    const g = new THREE.Group();
    const [x, z] = PLACES.lander;
    // Descent stage body (octagonal prism).
    const body = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 2.6, 8), mat(COLORS.bodyMid, { roughness: 0.5, metalness: 0.5 }));
    body.position.y = 3.4; body.castShadow = true;
    g.add(body);
    // Muted foil wrap (subtle).
    const foil = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.65, 1.2, 8), mat(COLORS.foil, { roughness: 0.35, metalness: 0.7 }));
    foil.position.y = 3.0; g.add(foil);
    // Deck plate + antenna.
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.4, 8), mat(COLORS.bodyLight, { metalness: 0.4 }));
    deck.position.y = 4.9; deck.castShadow = true; g.add(deck);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), mat(COLORS.metal));
    ant.position.set(1.4, 6.6, 0.6); g.add(ant);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), mat(COLORS.bodyLight, { metalness: 0.3 }));
    dish.position.set(1.4, 8.2, 0.6); dish.rotation.x = Math.PI; g.add(dish);
    // Engine bell.
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.5, 1.8, 16), mat(COLORS.bodyDark, { metalness: 0.7, roughness: 0.4 }));
    bell.position.y = 1.2; g.add(bell);
    // Four legs with footpads.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const lx = Math.cos(a) * 4.6, lz = Math.sin(a) * 4.6;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.6, 6), mat(COLORS.metal));
      leg.position.set(Math.cos(a) * 2.6, 2.4, Math.sin(a) * 2.6);
      leg.lookAt(V(lx, 0, lz)); leg.rotateX(Math.PI / 2);
      leg.castShadow = true; g.add(leg);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.25, 12), mat(COLORS.bodyDark));
      pad.position.copy(this._seat(x + lx, z + lz, 0.12).sub(V(x, 0, z))); g.add(pad);
    }
    g.position.copy(this._seat(x, z, 0));
    this.scene.add(g);
    this.lander = g;
  }

  _buildCargo() {
    // The payloader sits straight ahead of the robot's stop with its door at
    // the height of the front hatch and four pieces inside.
    this._placeOn(this.curveOut, this.lenOut);
    this.robot.updateMatrixWorld(true);
    const frame = { pos: this.robot.position.clone(), quat: this.robot.quaternion.clone() };

    // A sealed container: solid base down into the regolith, walls and roof
    // round the cargo hold, and a sliding door in the end facing the robot.
    const g = new THREE.Group();
    const M = MODULE, len = M.z1 - M.z0, zc = (M.z0 + M.z1) / 2, T = 0.12;
    const outerW = 2 * (M.halfW + T), base = -1.2;
    const shell = mat(COLORS.bodyLight, { roughness: 0.5, metalness: 0.4 });
    const add = (w, h, d, x, y, z, m = shell) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; g.add(b); return b;
    };
    add(outerW, M.floorTop - base, len + T, 0, (M.floorTop + base) / 2, zc + T / 2, mat(COLORS.bodyMid, { metalness: 0.5 }));
    for (const sx of [-1, 1]) add(T, M.roof - M.floorTop, len, sx * (M.halfW + T / 2), (M.roof + M.floorTop) / 2, zc);
    add(outerW, T, len + T, 0, M.roof + T / 2, zc + T / 2);
    add(outerW, M.roof - M.floorTop, T, 0, (M.roof + M.floorTop) / 2, M.z1 + T / 2);
    // Near end: an opening just big enough for the crane and one piece.
    const ow = 0.75, oTop = M.roof - 0.1;
    for (const sx of [-1, 1]) add(M.halfW + T - ow, oTop - M.floorTop, T, sx * (ow + (M.halfW + T - ow) / 2), (oTop + M.floorTop) / 2, M.z0 + T / 2);
    add(outerW, M.roof - oTop, T, 0, (M.roof + oTop) / 2, M.z0 + T / 2);
    // Ribbing and corner posts.
    const rib = mat(COLORS.bodyDark, { metalness: 0.5 });
    for (let k = 0; k <= 4; k++) for (const sx of [-1, 1]) {
      add(0.06, M.roof - base, 0.14, sx * (M.halfW + T + 0.03), (M.roof + base) / 2, M.z0 + 0.1 + k * (len - 0.2) / 4, rib);
    }
    // Door: slides aside across the near end when the robot's hatch opens.
    const door = add(2 * ow + 0.1, oTop - M.floorTop + 0.1, 0.06, 0, (oTop + M.floorTop) / 2, M.z0 - 0.04, mat(COLORS.bodyMid, { roughness: 0.4, metalness: 0.55 }));
    this.payDoor = door;
    const doorRail = add(outerW + 2 * ow + 0.2, 0.06, 0.06, ow + 0.1, oTop + 0.08, M.z0 - 0.08, mat(COLORS.metal, { metalness: 0.55 }));
    doorRail.castShadow = false;
    g.position.copy(frame.pos); g.quaternion.copy(frame.quat);
    this.scene.add(g);
    this.module = g;

    // Pieces resting in the hold; the crane reaches each in turn, nearest first.
    this.cargo = M.slots.slice(0, CARGO_COUNT).map((z) => {
      const piece = buildCargoPiece();
      piece.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const home = V(0, M.floorTop + CARGO.h / 2, z).applyQuaternion(frame.quat).add(frame.pos);
      piece.position.copy(home); piece.quaternion.copy(frame.quat);
      this.scene.add(piece);
      return { mesh: piece, home, homeQ: frame.quat.clone(), reach: z - CRANE.grabZ, pickY: M.floorTop + CARGO.h };
    });
    this._placeOn(this.curveOut, 0);
  }

  _buildHabitat() {
    const g = new THREE.Group();
    const [x, z] = PLACES.habitat;
    // Main pressurized module — horizontal cylinder.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 14, 32), mat(COLORS.habitat, { roughness: 0.55, metalness: 0.25 }));
    body.rotation.z = Math.PI / 2; body.position.y = 5.2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    // End caps.
    for (const ex of [-7, 7]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(4.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(COLORS.habitat, { roughness: 0.5, metalness: 0.3 }));
      cap.rotation.z = ex < 0 ? Math.PI / 2 : -Math.PI / 2; cap.position.set(ex, 5.2, 0); g.add(cap);
    }
    // Banding.
    for (const bx of [-3.5, 0, 3.5]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(4.52, 0.12, 8, 32), mat(COLORS.bodyDark));
      band.rotation.y = Math.PI / 2; band.position.set(bx, 5.2, 0); g.add(band);
    }
    // Legs.
    for (const lx of [-5, 5]) for (const lz of [-3, 3]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 5.2, 8), mat(COLORS.metal));
      leg.position.set(lx, 2.6, lz); leg.castShadow = true; g.add(leg);
    }
    // Solar panels.
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 4), mat(COLORS.metal));
      arm.position.set(0, 10.4, sx * 5.5); g.add(arm);
      const pan = new THREE.Mesh(new THREE.BoxGeometry(12, 0.15, 5), mat(0x1a2a3a, { roughness: 0.3, metalness: 0.6, emissive: 0x0a1420, emissiveIntensity: 0.3 }));
      pan.position.set(0, 10.6, sx * 8); pan.castShadow = true; g.add(pan);
    }
    // Habitat cargo door: a rectangular frame the robot's rear collar backs onto,
    // with a pressurised tunnel back to the hull. Local +Z faces out.
    const port = new THREE.Group();
    const hab = mat(COLORS.habitat, { roughness: 0.55, metalness: 0.25 });
    const tunnel = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.6, 6.0), hab);
    tunnel.position.z = -3.0; tunnel.castShadow = true; tunnel.receiveShadow = true; port.add(tunnel);
    const frameMat = mat(COLORS.bodyLight, { metalness: 0.5 });
    const fw = 3.3, fh = 2.3, ow = 2.6, oh = 1.5;
    for (const sx of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry((fw - ow) / 2, fh, PORT_D), frameMat);
      jamb.position.set(sx * (ow / 2 + (fw - ow) / 4), 0, PORT_D / 2); port.add(jamb);
    }
    for (const sy of [-1, 1]) {
      const hdr = new THREE.Mesh(new THREE.BoxGeometry(fw, (fh - oh) / 2, PORT_D), frameMat);
      hdr.position.set(0, sy * (oh / 2 + (fh - oh) / 4), PORT_D / 2); port.add(hdr);
    }
    // Receiving sockets for the robot's alignment pins.
    for (const sx of [-1, 1]) {
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12), mat(COLORS.bodyDark));
      sock.rotation.x = Math.PI / 2; sock.position.set(sx * 1.45, 3.4 - PORT_H, PORT_D + 0.02); port.add(sock);
    }
    // The habitat's own door slides aside together with the robot's.
    const habDoor = new THREE.Mesh(new THREE.BoxGeometry(ow, oh, 0.08), mat(COLORS.bodyMid, { roughness: 0.4, metalness: 0.55 }));
    habDoor.position.set(0, 0, 0.1); port.add(habDoor);
    this.habDoor = habDoor; this.habDoorX0 = 0;
    for (const sx of [-1.1, 1.1]) for (const sz of [-1, -5]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, PORT_H, 6), mat(COLORS.metal));
      leg.position.set(sx, -PORT_H / 2, sz); port.add(leg);
    }
    // Aim the door out toward the dock point.
    const portWorld = this._seat(PLACES.supplyPort[0], PLACES.supplyPort[1], PORT_H);
    port.position.copy(portWorld.clone().sub(this._seat(x, z, 0)));
    this.portWorld = portWorld;
    port.lookAt(port.position.clone().add(this.portDir));
    g.add(port);

    g.position.copy(this._seat(x, z, 0));
    this.scene.add(g);
    this.habitat = g;
  }

  _buildObstacles() {
    const rocks = new THREE.Group();
    const spots = [PLACES.obstacle, [PLACES.obstacle[0] + 5, PLACES.obstacle[1] - 3], [PLACES.obstacle[0] - 4, PLACES.obstacle[1] + 4], PLACES.crater];
    let s = 0;
    for (const [x, z] of spots) {
      const count = 2 + (s % 2);
      for (let i = 0; i < count; i++) {
        const r = 1.2 + Math.random() * 2.4;
        const geo = new THREE.DodecahedronGeometry(r, 0);
        const p = geo.attributes.position;
        for (let k = 0; k < p.count; k++) {
          p.setXYZ(k, p.getX(k) * (0.8 + Math.random() * 0.5), p.getY(k) * (0.6 + Math.random() * 0.4), p.getZ(k) * (0.8 + Math.random() * 0.5));
        }
        geo.computeVertexNormals();
        const rock = new THREE.Mesh(geo, mat(0x71747a, { roughness: 1, metalness: 0 }));
        const ox = x + (Math.random() - 0.5) * 5, oz = z + (Math.random() - 0.5) * 5;
        rock.position.copy(this._seat(ox, oz, r * 0.45));
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        rock.castShadow = true; rock.receiveShadow = true;
        rocks.add(rock);
      }
      s++;
    }
    this.scene.add(rocks);
    this.rocks = rocks;
  }

  _buildRobot() {
    this.rig = buildRobot();
    this._wheels = this.rig.wheels;
    this._wheelRadius = this.rig.wheelRadius;
    for (const w of this._wheels) w.angle = 0;
    this.rig.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(this.rig.group);
    this.robot = this.rig.group;
    this._placeOn(this.curveOut, 0);
  }

  // Seat the robot on the terrain at (x, z), facing `fwd` (horizontal).
  // The body rests on its four wheels, so take pitch/roll and height from the
  // ground under the wheel contact points rather than a single normal.
  _placeAt(x, z, fwd) {
    const side = V(fwd.z, 0, -fwd.x);
    const h = (a, b) => sampleHeight(x + fwd.x * a + side.x * b, z + fwd.z * a + side.z * b);
    const T = this.rig.trackHalf, B = 1.85;
    const fl = h(B, -T), fr = h(B, T), bl = h(-B, -T), br = h(-B, T);
    this.robot.position.set(x, (fl + fr + bl + br) / 4, z);
    const along = fwd.clone().multiplyScalar(2 * B).setY((fl + fr - bl - br) / 2);
    const across = side.clone().multiplyScalar(2 * T).setY((fr + br - fl - bl) / 2);
    const up = new THREE.Vector3().crossVectors(along, across).normalize();
    if (up.y < 0) up.negate();
    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const f = new THREE.Vector3().crossVectors(right, up).normalize();
    this.robot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, f));
    this._robotPos = this.robot.position.clone();
    this._robotFwd = fwd.clone();
  }

  _placeOn(curve, sDist) {
    const len = curve.getLength();
    const u = clamp01(sDist / len);
    const p = curve.getPointAt(u);
    const tan = curve.getTangentAt(Math.min(Math.max(u, 0.0001), 0.9999)).setY(0).normalize();
    this._placeAt(p.x, p.z, tan);
  }

  // Pivot in place at (x, z) from heading `from` to heading `to`, k = 0..1.
  // Returns the yaw turned so far (for wheel spin).
  _pivot(x, z, from, to, k) {
    const a0 = Math.atan2(from.x, from.z);
    const yaw = turnAngle(from, to) * ease(k), a = a0 + yaw;
    this._placeAt(x, z, V(Math.sin(a), 0, Math.cos(a)));
    return yaw;
  }

  // Place the robot for mission progress t. Returns the distance covered,
  // the pivot yaw so far, and the reverse distance so far.
  _drive(t) {
    const outEnd = this.curveOut.getTangentAt(0.9999).setY(0).normalize();
    const backStart = this.curve.getTangentAt(0.0001).setY(0).normalize();
    if (t < TL.hatchClosed) {
      const s = ease(seg(t, 0, TL.arrive)) * this.lenOut;
      this._placeOn(this.curveOut, s);
      return { s, yaw: 0, back: 0 };
    }
    if (t < TL.depart) {
      // Loaded: turn round at the payloader to face the habitat route.
      const p = this.curve.getPointAt(0);
      const yaw = this._pivot(p.x, p.z, outEnd, backStart, seg(t, TL.hatchClosed, TL.depart));
      return { s: this.lenOut, yaw, back: 0 };
    }
    if (t < TL.turn) {
      const s = ease(seg(t, TL.depart, TL.turn)) * this.curveLen;
      this._placeOn(this.curve, s);
      return { s: this.lenOut + s, yaw: turnAngle(outEnd, backStart), back: 0 };
    }
    // At the habitat: turn round until the rear faces the door, then reverse straight in.
    const end = this.curve.getTangentAt(0.9999).setY(0).normalize();
    const yaw = turnAngle(outEnd, backStart) + this._pivot(this.turnXZ.x, this.turnXZ.z, end, this.portDir, seg(t, TL.turn, TL.reverse));
    const back = ease(seg(t, TL.reverse, TL.docked)) * TURN_GAP;
    const p = this.turnXZ.clone().addScaledVector(this.portDir, -back);
    this._placeAt(p.x, p.z, this._robotFwd);
    return { s: this.lenOut + this.curveLen + back, yaw, back };
  }

  // Hatch / crane / conveyor / door pose for mission progress t, and where
  // each cargo piece is: in the payloader hold, on the hook, or riding the belt.
  _mechanism(t) {
    const cycle = (TL.loadEnd - TL.hatchOpen) / CARGO_COUNT;
    const raised = CRANE.raisedY, bayY = BAY.beltY + CARGO.h;
    const pose = {
      hatch: ease(seg(t, TL.arrive, TL.hatchOpen)) * (1 - ease(seg(t, TL.loadEnd, TL.hatchClosed))),
      extend: 0, grabY: raised, claw: 0, belt: 0,
      door: ease(seg(t, TL.docked, TL.doorOpen)),
    };
    const where = this.cargo.map(() => ({ at: "hold" }));
    let loaded = 0, loading = false;

    if (t >= TL.hatchOpen) {
      const done = Math.min(CARGO_COUNT, Math.floor((t - TL.hatchOpen) / cycle));
      loaded = done;
      for (let k = 0; k < done; k++) where[k] = { at: "belt", dropB: k * BAY.pitch };
      pose.belt = (CARGO_COUNT - 1) * BAY.pitch;
      if (done < CARGO_COUNT) {
        // One cycle: reach out through the hatch into the hold, lower, grip, lift, pull back
        // in, set down on the belt, release, then the belt indexes rearward.
        loading = true;
        const k = done, c = this.cargo[k];
        const u = (t - TL.hatchOpen - k * cycle) / cycle;
        pose.belt = k * BAY.pitch;
        pose.extend = c.reach * ease(seg(u, 0.02, 0.28)) * (1 - ease(seg(u, 0.56, 0.8)));
        pose.claw = ease(seg(u, 0.36, 0.42)) * (1 - ease(seg(u, 0.88, 0.92)));
        if (u < 0.42) pose.grabY = THREE.MathUtils.lerp(raised, c.pickY, ease(seg(u, 0.28, 0.36)));
        else if (u < 0.8) pose.grabY = THREE.MathUtils.lerp(c.pickY, raised, ease(seg(u, 0.42, 0.5)));
        else if (u < 0.92) pose.grabY = THREE.MathUtils.lerp(raised, bayY, ease(seg(u, 0.8, 0.88)));
        else pose.grabY = THREE.MathUtils.lerp(bayY, raised, ease(seg(u, 0.92, 1)));
        if (u >= 0.42 && u < 0.9) where[k] = { at: "hook", blend: ease(seg(u, 0.42, 0.46)) };
        else if (u >= 0.9) {
          where[k] = { at: "belt", dropB: k * BAY.pitch };
          loaded = k + 1;
          if (k < CARGO_COUNT - 1) pose.belt += ease(seg(u, 0.92, 1)) * BAY.pitch;
        }
      }
    }

    // Unload: the belt runs on through both open doors into the habitat.
    const unload = ease(seg(t, TL.doorOpen, TL.end));
    pose.belt += unload * (BAY.slots[0] - EXIT_Z + 0.05);
    return { pose, where, loaded, loading, unload };
  }

  // progress: 0..1 across the whole mission.
  update(progress, dt) {
    const t = clamp01(progress);
    const drive = this._drive(t);
    const mech = this._mechanism(t);
    this.rig.pose(mech.pose);
    this.robot.updateMatrixWorld(true);
    this.habDoor.position.x = this.habDoorX0 + mech.pose.door * 2.65;
    this.payDoor.position.x = mech.pose.hatch * 1.6;

    // Wheels: rolling distance (backwards while reversing), plus opposite-side
    // spin while skid-steering round in place.
    const prev = this._prevDrive || drive;
    const ds = (drive.s - prev.s) * (drive.back !== prev.back ? -1 : 1);
    const dyaw = drive.yaw - prev.yaw;
    for (const w of this._wheels) {
      w.angle += (ds + w.sx * dyaw * this.rig.trackHalf) / this._wheelRadius;
      w.mesh.rotation.x = w.angle;
    }
    this._prevDrive = drive;
    if (this.rig.drum) this.rig.drum.rotation.y += dt * 2.0;

    // Cargo pieces.
    const tmp = new THREE.Vector3();
    let delivered = 0;
    mech.where.forEach((w, k) => {
      const c = this.cargo[k], m = c.mesh;
      m.visible = true;
      if (w.at === "hold") { m.position.copy(c.home); m.quaternion.copy(c.homeQ); return; }
      m.quaternion.copy(this.robot.quaternion);
      if (w.at === "hook") {
        const g = this.rig.grabber.position;
        this.robot.localToWorld(tmp.set(0, g.y - CARGO.h / 2, g.z));
        m.position.lerpVectors(c.home, tmp, w.blend);
        m.quaternion.slerpQuaternions(c.homeQ, this.robot.quaternion, w.blend);
        return;
      }
      const z = BAY.slots[0] - (mech.pose.belt - w.dropB);
      if (z <= EXIT_Z) { m.visible = false; delivered++; return; }
      m.position.copy(this.robot.localToWorld(tmp.set(0, BAY.beltY + CARGO.h / 2, z)));
    });

    // ---- Telemetry ----
    let payload = "EMPTY";
    if (delivered === CARGO_COUNT) payload = "DELIVERED";
    else if (mech.unload > 0) payload = `UNLOADING ${delivered}/${CARGO_COUNT}`;
    else if (mech.loading) payload = `LOADING ${mech.loaded}/${CARGO_COUNT}`;
    else if (mech.loaded === CARGO_COUNT) payload = "SECURED";

    let docking = "STANDBY";
    if (t >= TL.docked) docking = mech.pose.door >= 1 ? "DOOR OPEN" : "DOCKED";
    else if (t >= TL.turn) docking = "ALIGNING";

    // Distance to the current destination: the payloader on the way out, the habitat on the way back.
    const leg = drive.s <= this.lenOut ? this.lenOut - drive.s : this.lenOut + this.curveLen + TURN_GAP - drive.s;
    const distance = Math.round(Math.max(0, leg) * (this.totalMeters / this.lenOut));
    const speed = Math.abs(ds / Math.max(dt, 1e-3));
    this.state = { distance, payload, docking, progress: t, speed, delivered: delivered === CARGO_COUNT };
    this.prevT = t;
    return this.state;
  }

  // World position to frame the robot for the engineering inspection.
  get focus() { return this.robot.position; }
}
