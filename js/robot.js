import * as THREE from "three";
import { COLORS } from "./config.js";

// The LunaKAB cargo transport robot, shared by the mission scene and the
// subsystem inspection page. Every mesh is tagged with `userData.subsystem`
// (an ENGINEERING id) so parts can be picked and highlighted.
//
// A fully enclosed box on four corner wheels (robot-local: origin on the
// ground under the centre, faces +Z):
//   - front face: sensor bar, stereo cameras, LiDAR, and a small hatch at the
//     top that slides open for the crane
//   - horizontal telescoping crane under the roof: it reaches out through the
//     hatch, a short hoist lifts a piece, and the boom pulls it back inside and
//     sets it on the front of the conveyor
//   - conveyor along the bay floor, carrying cargo to the sliding rear door

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...opts });
const tag = (obj, id) => obj.traverse((o) => { o.userData.subsystem = id; });
const box = (w, h, d, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.castShadow = true; return b; };

export const WHEEL_RADIUS = 0.85;

// Shared geometry the mission choreography needs.
export const BODY = { W: 3.4, L: 5.4, floorTop: 1.425, roofY: 3.8 };
export const BAY = {
  beltY: 1.51,                       // top surface of the belt
  slots: [1.65, 0.45, -0.75, -1.95], // cargo resting z, front intake → rear door
  pitch: 1.2,                        // conveyor advance per loaded piece
  rearZ: -2.7,                       // rear face of the body
};
export const CRANE = {
  tipZ: 1.82,       // boom tip with the boom retracted; the hoist hangs 0.17 behind it
  grabZ: 1.65,      // grabber z when retracted — over the front conveyor slot
  reach: 5.7,       // full two-stage extension
  boomY: 3.6,
  raisedY: 3.22,    // grabber height when carrying (cargo clears the hatch sill)
};
export const HATCH = { w: 1.3, y0: 2.45, y1: 3.8 };
export const CARGO = { w: 1.0, h: 0.7, d: 0.8 };

// One standard cargo piece (also used by the mission scene).
export function buildCargoPiece() {
  const g = new THREE.Group();
  const shell = box(CARGO.w, CARGO.h, CARGO.d, mat(COLORS.cargo, { roughness: 0.7, metalness: 0.15 }));
  shell.receiveShadow = true; g.add(shell);
  const lid = box(CARGO.w + 0.04, 0.08, CARGO.d + 0.04, mat(COLORS.bodyLight, { metalness: 0.3 }));
  lid.position.y = CARGO.h / 2 - 0.03; g.add(lid);
  for (const sx of [-0.25, 0.25]) {
    const rib = box(0.06, CARGO.h, CARGO.d + 0.03, mat(COLORS.bodyDark));
    rib.position.x = sx; g.add(rib);
  }
  // Lifting lugs the grabber's fingers close on.
  for (const sx of [-1, 1]) {
    const lug = box(0.05, 0.16, 0.4, mat(COLORS.metal, { metalness: 0.6 }));
    lug.position.set(sx * (CARGO.w / 2 + 0.025), CARGO.h / 2 - 0.14, 0); g.add(lug);
  }
  return g;
}

export function buildRobot() {
  const robot = new THREE.Group();
  const chassis = new THREE.Group();
  robot.add(chassis);

  const hull = mat(COLORS.bodyLight, { roughness: 0.45, metalness: 0.45 });
  const dark = mat(COLORS.bodyDark, { metalness: 0.5 });
  const metal = mat(COLORS.metal, { metalness: 0.55 });
  const lensMat = mat(0x0b0d10, { metalness: 0.2, roughness: 0.2, emissive: COLORS.signal, emissiveIntensity: 0.12 });

  // ---- Enclosed body: floor pan, side walls, roof, front wall with hatch ----
  const { W, L, roofY } = BODY;
  const wallY0 = 1.42, T = 0.12;
  const floor = box(W, 0.35, L, dark); floor.position.y = 1.25; chassis.add(floor);
  tag(floor, "autonomy");
  for (const sx of [-1, 1]) {
    const wall = box(T, roofY - wallY0, L, hull);
    wall.position.set(sx * (W / 2 - T / 2), (roofY + wallY0) / 2, 0); chassis.add(wall);
    tag(wall, "autonomy");
    // Edge trim.
    const trim = box(0.05, 0.05, L, metal);
    trim.position.set(sx * (W / 2 + 0.01), roofY - 0.4, 0); chassis.add(trim);
    tag(trim, "autonomy");
  }
  const roof = box(W, 0.15, L, hull); roof.position.y = roofY + 0.075; chassis.add(roof);
  tag(roof, "autonomy");
  // Front wall, built around the hatch opening.
  const front = new THREE.Group();
  const fz = L / 2 - T / 2;
  const below = box(W, HATCH.y0 - wallY0, T, hull);
  below.position.set(0, (HATCH.y0 + wallY0) / 2, fz); front.add(below);
  for (const sx of [-1, 1]) {
    const sideW = (W - HATCH.w) / 2;
    const side = box(sideW, HATCH.y1 - HATCH.y0, T, hull);
    side.position.set(sx * (HATCH.w / 2 + sideW / 2), (HATCH.y0 + HATCH.y1) / 2, fz); front.add(side);
  }
  // Hatch frame.
  for (const sx of [-1, 1]) {
    const jamb = box(0.06, HATCH.y1 - HATCH.y0, 0.06, metal);
    jamb.position.set(sx * (HATCH.w / 2 + 0.03), (HATCH.y0 + HATCH.y1) / 2, L / 2 + 0.02); front.add(jamb);
  }
  const sill = box(HATCH.w + 0.12, 0.06, 0.08, metal);
  sill.position.set(0, HATCH.y0, L / 2 + 0.02); front.add(sill);
  chassis.add(front);
  tag(front, "autonomy");
  // The hatch cover slides down inside the front wall to open.
  const hatchH = HATCH.y1 - HATCH.y0;
  const hatch = box(HATCH.w + 0.04, hatchH, 0.05, mat(COLORS.bodyMid, { roughness: 0.4, metalness: 0.55 }));
  hatch.position.set(0, (HATCH.y0 + HATCH.y1) / 2, L / 2 - T - 0.04);
  chassis.add(hatch);
  tag(hatch, "crane");
  // Avionics box slung under the floor (flight computer + battery).
  const avionics = box(2.4, 0.4, 3.2, mat(COLORS.panel, { metalness: 0.4 }));
  avionics.position.y = 0.88; chassis.add(avionics);
  tag(avionics, "autonomy");

  // ---- Power: solar panels on both side walls, above the wheel fenders ----
  const cellMat = mat(0x16202c, { roughness: 0.3, metalness: 0.6, emissive: 0x0a1420, emissiveIntensity: 0.3 });
  const panelY0 = 2.0, panelY1 = roofY - 0.5, panelL = L - 0.5;
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 + 0.03);
    const solar = box(0.05, panelY1 - panelY0, panelL, cellMat);
    solar.position.set(x, (panelY0 + panelY1) / 2, 0); chassis.add(solar);
    tag(solar, "power");
    for (let i = -3; i <= 3; i++) {
      const line = box(0.02, panelY1 - panelY0, 0.03, mat(0x2a3646));
      line.position.set(x + sx * 0.03, (panelY0 + panelY1) / 2, i * (panelL / 7)); chassis.add(line);
      tag(line, "power");
    }
    const mid = box(0.02, 0.03, panelL, mat(0x2a3646));
    mid.position.set(x + sx * 0.03, (panelY0 + panelY1) / 2, 0); chassis.add(mid);
    tag(mid, "power");
  }

  // ---- Navigation: sensors and cameras on the front face ----
  const nav = new THREE.Group();
  const sensorBar = box(W - 0.4, 0.34, 0.14, dark);
  sensorBar.position.set(0, 1.85, L / 2 + 0.07); nav.add(sensorBar);
  for (const sx of [-1.2, -0.85, 0.85, 1.2]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 14), lensMat);
    lens.rotation.x = Math.PI / 2; lens.position.set(sx, 1.85, L / 2 + 0.16); nav.add(lens);
  }
  // Stereo camera pods either side of the hatch.
  for (const sx of [-1, 1]) {
    const pod = box(0.36, 0.26, 0.2, hull);
    pod.position.set(sx * 1.25, 3.3, L / 2 + 0.1); nav.add(pod);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 12), lensMat);
    lens.rotation.x = Math.PI / 2; lens.position.set(sx * 1.25, 3.3, L / 2 + 0.22); nav.add(lens);
  }
  // LiDAR on the front edge of the roof.
  const drumBase = box(0.5, 0.08, 0.5, dark);
  drumBase.position.set(0, roofY + 0.19, L / 2 - 0.35); nav.add(drumBase);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 16), dark);
  drum.position.set(0, roofY + 0.37, L / 2 - 0.35); nav.add(drum);
  const drumWin = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.08, 16), lensMat);
  drumWin.position.copy(drum.position); nav.add(drumWin);
  chassis.add(nav);
  tag(nav, "nav");

  // ---- Conveyor along the bay floor ----
  const conveyor = new THREE.Group();
  const beltLen = 4.9, beltW = 2.4;
  const belt = box(beltW, 0.08, beltLen, mat(0x1b1d21, { roughness: 0.9, metalness: 0.1 }));
  belt.position.y = BAY.beltY - 0.04; conveyor.add(belt);
  for (const ez of [-1, 1]) {
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, beltW + 0.1, 12), metal);
    roller.rotation.z = Math.PI / 2; roller.position.set(0, BAY.beltY - 0.06, ez * beltLen / 2); conveyor.add(roller);
  }
  for (const sx of [-1, 1]) {
    const guide = box(0.06, 0.18, beltLen, metal);
    guide.position.set(sx * (beltW / 2 + 0.05), BAY.beltY + 0.05, 0); conveyor.add(guide);
  }
  // Cleats ride the belt so its motion reads.
  const cleats = [];
  const CLEAT_GAP = 0.6, CLEATS = Math.round(beltLen / CLEAT_GAP);
  for (let i = 0; i < CLEATS; i++) {
    const c = box(beltW - 0.1, 0.04, 0.06, mat(0x3a3e44));
    c.position.y = BAY.beltY + 0.01; conveyor.add(c); cleats.push(c);
  }
  chassis.add(conveyor);
  tag(conveyor, "conveyor");

  // ---- Dust vacuum: suction strips beside the belt feed a collector canister ----
  // Inside the sealed body, so it only shows on the subsystems page.
  const vacuum = new THREE.Group();
  const vx = beltW / 2 + 0.22;
  for (const sx of [-1, 1]) {
    const intake = box(0.18, 0.05, beltLen - 0.3, mat(0x14161a, { roughness: 0.9 }));
    intake.position.set(sx * vx, BAY.beltY - 0.03, 0); vacuum.add(intake);
    for (let i = -5; i <= 5; i++) {
      const slot = box(0.12, 0.02, 0.06, mat(0x050607));
      slot.position.set(sx * vx, BAY.beltY, i * 0.42); vacuum.add(slot);
    }
  }
  const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.8, 16), metal);
  canister.position.set(vx, BAY.beltY + 0.4, L / 2 - 0.35); vacuum.add(canister);
  const filterCap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 16), dark);
  filterCap.position.set(vx, BAY.beltY + 0.85, L / 2 - 0.35); vacuum.add(filterCap);
  const duct = box(0.08, 0.08, 0.5, dark);
  duct.position.set(vx, BAY.beltY + 0.02, L / 2 - 0.6); vacuum.add(duct);
  chassis.add(vacuum);
  tag(vacuum, "vacuum");

  // ---- Rear wall with sliding door + docking guides ----
  const rear = new THREE.Group();
  const doorW = 2.6, doorH = 1.5, doorY = wallY0 + doorH / 2;
  const rz = BAY.rearZ + T / 2;
  const head = box(W, roofY - (wallY0 + doorH), T, hull);
  head.position.set(0, (roofY + wallY0 + doorH) / 2, rz); rear.add(head);
  for (const sx of [-1, 1]) {
    const jamb = box((W - doorW) / 2, doorH, T, hull);
    jamb.position.set(sx * (doorW / 2 + (W - doorW) / 4), doorY, rz); rear.add(jamb);
  }
  // Rails run past the right-hand side so the door slides clear of the opening.
  for (const ry of [wallY0, wallY0 + doorH]) {
    const rail = box(W + doorW * 0.8, 0.06, 0.08, metal);
    rail.position.set(doorW * 0.4, ry, BAY.rearZ - 0.12); rear.add(rail);
  }
  const door = new THREE.Group();
  door.add(box(doorW, doorH, 0.07, mat(COLORS.bodyMid, { roughness: 0.4, metalness: 0.55 })));
  for (let i = -2; i <= 2; i++) {
    const rib = box(0.05, doorH - 0.1, 0.03, dark);
    rib.position.set(i * 0.5, 0, -0.05); door.add(rib);
  }
  door.position.set(0, doorY, BAY.rearZ - 0.12);
  rear.add(door);
  // Docking collar + alignment pins that mate with the habitat door.
  const collar = box(W - 0.2, 0.1, 0.2, metal);
  collar.position.set(0, wallY0 + doorH + 0.25, BAY.rearZ - 0.1); rear.add(collar);
  for (const sx of [-1, 1]) {
    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 10), metal);
    pin.rotation.x = -Math.PI / 2; pin.position.set(sx * 1.45, roofY - 0.4, BAY.rearZ - 0.2); rear.add(pin);
  }
  chassis.add(rear);
  tag(rear, "docking");

  // ---- Horizontal crane under the roof: housing + two telescoping stages ----
  const crane = new THREE.Group();
  const by = CRANE.boomY;
  const housing = box(0.52, 0.34, 3.8, mat(COLORS.bodyMid, { metalness: 0.55 }));
  housing.position.set(0, by, 0.55); crane.add(housing);
  for (const hz of [-1.2, 2.2]) {
    const hanger = box(0.7, 0.12, 0.2, metal);
    hanger.position.set(0, roofY - 0.06, hz); crane.add(hanger);
  }
  const STAGE1 = 3.4, STAGE2 = 3.2;
  const stage1 = box(0.4, 0.26, STAGE1, metal);
  crane.add(stage1);
  const stage2 = new THREE.Group();
  const stage2Bar = box(0.3, 0.18, STAGE2, mat(COLORS.bodyLight, { metalness: 0.5 }));
  stage2Bar.position.z = -STAGE2 / 2; stage2.add(stage2Bar);
  const hoistBlock = box(0.42, 0.22, 0.34, dark);
  hoistBlock.position.set(0, -0.18, -0.17); stage2.add(hoistBlock);
  crane.add(stage2);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6), mat(0x1a1c1f));
  cable.geometry.translate(0, -0.5, 0); // top-anchored, scale.y = length
  crane.add(cable);
  const grabber = new THREE.Group();
  const spreader = box(0.95, 0.08, 0.5, metal);
  spreader.position.y = 0.04; grabber.add(spreader);
  const fingers = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.56, 0.02, 0);
    const finger = box(0.06, 0.34, 0.36, dark);
    finger.position.y = -0.17; pivot.add(finger);
    grabber.add(pivot); fingers.push({ pivot, sx });
  }
  crane.add(grabber);
  chassis.add(crane);
  tag(crane, "crane");

  // ---- Four corner wheels, each on its own drive + suspension strut ----
  const wheels = [];
  const wr = WHEEL_RADIUS;
  const tire = mat(COLORS.bodyDark, { roughness: 0.85, metalness: 0.2 });
  for (const sx of [-1, 1]) {
    for (const wz of [-1.85, 1.85]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.6, 22), tire);
      wheel.rotation.z = Math.PI / 2; wheel.castShadow = true;
      for (let i = 0; i < 12; i++) {
        const gr = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 0.22), mat(0x2a2c30));
        const a = (i / 12) * Math.PI * 2;
        gr.position.set(0, Math.cos(a) * wr, Math.sin(a) * wr);
        gr.rotation.x = a; wheel.add(gr);
      }
      // Sealed hub caps keep regolith out of the bearings.
      for (const side of [-1, 1]) {
        const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.08, 20), mat(COLORS.bodyMid, { roughness: 0.4, metalness: 0.55 }));
        seal.position.y = side * 0.32; wheel.add(seal);
      }
      const pivot = new THREE.Group();
      pivot.position.set(sx * 2.05, wr, wz);
      pivot.add(wheel);
      chassis.add(pivot);
      const strut = box(0.36, 0.22, 0.3, metal);
      strut.position.set(sx * 1.78, wr + 0.05, wz); chassis.add(strut);
      const fender = box(0.7, 0.06, 1.9, dark);
      fender.position.set(sx * 2.05, wr * 2 + 0.12, wz); chassis.add(fender);
      tag(pivot, "mobility"); tag(strut, "mobility"); tag(fender, "mobility");
      wheels.push({ mesh: wheel, sx });
    }
  }

  // Apply a mechanism state. All fields optional.
  //   hatch 0..1    front hatch closed .. open
  //   extend        boom extension in metres (0..CRANE.reach)
  //   grabY         grabber height, robot-local
  //   claw  0..1    fingers open .. closed
  //   belt          conveyor travel in metres (top run moves front → rear)
  //   door  0..1    rear door closed .. open
  const state = { hatch: 0, extend: 0, grabY: CRANE.raisedY, claw: 0, belt: 0, door: 0 };
  function pose(s = {}) {
    Object.assign(state, s);
    hatch.position.y = (HATCH.y0 + HATCH.y1) / 2 - state.hatch * (hatchH + 0.02);
    // Each stage carries half the extension.
    const tipZ = CRANE.tipZ + state.extend;
    stage1.position.set(0, by, 0.3 + state.extend / 2);
    stage2.position.set(0, by, tipZ);
    const top = by - 0.29;
    cable.position.set(0, top, tipZ - 0.17);
    cable.scale.y = Math.max(0.05, top - (state.grabY + 0.08));
    grabber.position.set(0, state.grabY, tipZ - 0.17);
    for (const f of fingers) f.pivot.rotation.z = f.sx * (0.55 - 0.55 * state.claw);
    const span = CLEATS * CLEAT_GAP;
    for (let i = 0; i < CLEATS; i++) {
      cleats[i].position.z = THREE.MathUtils.euclideanModulo(i * CLEAT_GAP - state.belt, span) - span / 2;
    }
    door.position.x = state.door * (doorW + 0.05);
  }
  pose();

  return { group: robot, chassis, crane, drum, door, wheels, wheelRadius: wr, pose, state, grabber, trackHalf: 2.05 };
}
