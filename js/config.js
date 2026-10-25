// Central configuration for the LLASO Project 02 mission scene.
// All world positions are [x, z] on the surface plane; height is sampled from
// the terrain at runtime so nothing floats or clips.

export const COLORS = {
  sun: 0xfff2e0,
  fill: 0x2b3646,
  ground: 0x090b0e,
  fog: 0x04060a,
  space: 0x000000,
  regolith: 0x8a8d92,
  regolithDark: 0x4c4f54,
  bodyLight: 0xd6dade,
  bodyMid: 0x8b9096,
  bodyDark: 0x33363b,
  panel: 0x23262b,
  metal: 0xb8bcc2,
  foil: 0x7a6f5c,      // muted, low-saturation MLI nod — not a bright accent
  signal: 0x9fc7d8,
  caution: 0xd69a54,
  habitat: 0xe4e7ea,
  cargo: 0xc4c8cd,
};

export const WORLD = {
  terrainSize: 900,       // full extent (units)
  terrainSegments: 320,   // desktop resolution (reduced on mobile)
  curvature: 0.00055,     // fake planetary curvature -> curved horizon
  heightScale: 9.5,       // vertical relief of terrain
  seed: 20260917,
};

// Key mission placements — [x, z] surface coordinates.
export const PLACES = {
  lander:    [-80, -48],
  cargo:     [-51.5, -24.2], // the payloader (placed in front of the robot's stop)
  obstacle:  [16, 4],
  crater:    [44, 34],
  habitat:   [88, 60],
  supplyPort:[80, 53],   // the receiving port on the habitat's approach side
  dock:      [78, 51],   // where the robot comes to rest, aligned to the port
};

// Robot route between the payloader stop and the habitat — Catmull-Rom
// control points [x, z]. The mission drives it in reverse on the way out
// (from the habitat door) and forward on the way back.
export const PATH = [
  [-46, -22],     // payloader stop — the payloader is straight ahead (west)
  [-36, -16.5],
  [-20, -12],
  [-2, -12],
  [14, -14],      // sweep wide of the obstacle at [16, 4]
  [30, 4],
  [44, 20],
  [58, 34],       // the mission appends a turn-around point off the supply port
];

// Mission choreography, as fractions of the 0..1 mission progress.
// Leave the habitat door and drive to the payloader, open the front hatch and
// crane four pieces out of its hold onto the conveyor, close up and turn round,
// cross back, turn round again and reverse onto the habitat door, open the
// rear door and unload.
export const TIMELINE = {
  arrive: 0.20,      // stopped nose-in at the payloader
  hatchOpen: 0.22,
  loadEnd: 0.40,     // fourth piece on the conveyor, crane retracted
  hatchClosed: 0.42,
  depart: 0.46,      // turned round, rolling for the habitat
  turn: 0.84,        // reached the turn-around point
  reverse: 0.89,     // pivot complete, backing toward the port
  docked: 0.92,
  doorOpen: 0.94,
  end: 1,
};
export const CARGO_COUNT = 4;

// Camera choreography — one keyframe per narrative section.
// pos/target are absolute world coords; `orbit` flags the engineering inspection.
export const SHOTS = [
  { pos: [8, 150, 360], target: [0, 24, -40], fog: 0.0016, name: "DEEP SPACE" },       // 0 mission
  { pos: [-26, 78, 196], target: [-14, 8, -34], fog: 0.0021, name: "LUNAR SURFACE" },  // 1 problem
  { pos: [-104, 24, -8], target: [-80, 8, -46], fog: 0.0032, name: "LANDING ZONE" },   // 2 landing
  // 3 cargo / 4 transport / 5 docking follow the robot for a mission-sim feel.
  { follow: { off: [-15, 8, 14], lead: 3, up: 1.6 }, fog: 0.004, name: "CARGO ACQUISITION" },
  { follow: { off: [-21, 14, 22], lead: 6, up: 2.4 }, fog: 0.0026, name: "TRANSPORT" },
  { follow: { off: [-20, 12, -14], lead: 9, up: 2.6, toward: "habitat" }, fog: 0.0032, name: "HABITAT DOCKING" },
  { pos: [0, 6, 15], target: [0, 3.4, 0], fog: 0.0075, orbit: true, name: "ENGINEERING" },// 6 engineering
  { pos: [50, 56, 168], target: [70, 6, 50], fog: 0.0018, name: "MISSION COMPLETE" },  // 7 final
];

// Mission progress window in "section space" (0..7). Robot animates across it.
export const MISSION_START = 2.15;
export const MISSION_END = 5.4;

// `from`/`to` gate each marker to a zoom range so nothing clutters at wide shots.
export const MARKERS = [
  { id: "lander", place: "lander", label: "LANDING ZONE", sub: "DSC-1", from: 1, to: 3 },
  { id: "cargo", place: "cargo", label: "PAYLOADER", sub: "PL-1", from: 2, to: 4 },
  { id: "supply", place: "supplyPort", label: "SUPPLY PORT", sub: "HAB-P1", from: 4, to: 6 },
  { id: "habitat", place: "habitat", label: "HABITAT", sub: "HAB-1", from: 2, to: 6 },
];

// `view` is the direction (robot-local, robot faces +Z) the camera inspects each
// subsystem from, on the subsystems page and in its highlight figure.
export const ENGINEERING = [
  {
    id: "mobility", n: "01", title: "MOBILITY SYSTEM",
    body: "Four independently-driven wheels, one at each corner of the body, give a wide, stable footprint for the loaded bay. Skid steering lets it pivot in place — it turns round at the payloader, and again at the habitat to back straight up to the door. Sealed hubs keep abrasive regolith out of the bearings.",
    specs: [["DRIVE", "4× IND."], ["STEER", "SKID"], ["SPEED", "0.4 m/s"]],
    view: [-1, 0.35, 0.55],
  },
  {
    id: "crane", n: "02", title: "HORIZONTAL CRANE",
    body: "A two-stage telescoping boom runs under the roof. A small hatch at the top of the front face slides open, the payloader's door slides aside, the boom reaches into its hold, and a short hoist lifts each piece by its lugs. The boom pulls it back inside, sets it on the conveyor, and repeats; then the hatch closes for transit.",
    specs: [["REACH", "5.7 m"], ["STAGES", "2"], ["CYCLE", "4× PER TRIP"]],
    view: [-0.6, 0.8, 1],
  },
  {
    id: "conveyor", n: "03", title: "CONVEYOR BAY",
    body: "Inside the sealed body a cleated belt runs the length of the bay. After each drop it indexes one slot toward the rear, freeing the front for the next piece; at the habitat it runs on and slides every piece out through the rear door.",
    specs: [["SLOTS", "4"], ["INDEX", "1.2 m"], ["DIRECTION", "FRONT → REAR"]],
    view: [-0.35, 1.5, 0.1],
  },
  {
    id: "docking", n: "04", title: "REAR DOOR & DOCKING",
    body: "The rear wall carries a sliding door, a docking collar and alignment pins. The robot turns round and reverses onto the habitat door frame, the pins pull it into tolerance, and both doors slide aside so the conveyor can hand the cargo across.",
    specs: [["DOOR", "SLIDING"], ["TOL.", "± 15 mm"], ["APPROACH", "REVERSE"]],
    view: [-0.45, 0.45, -1],
  },
  {
    id: "nav", n: "05", title: "NAVIGATION SENSORS",
    body: "The front face carries the sensor suite: a hazard-camera bar, stereo camera pods either side of the hatch, and a scanning LiDAR on the roof edge. They fuse into a terrain-relative estimate and guide the crane into the payloader.",
    specs: [["RANGE", "40 m"], ["FUSION", "VIO + LIDAR"], ["RATE", "20 Hz"]],
    view: [-0.45, 0.4, 1],
  },
  {
    id: "autonomy", n: "06", title: "AUTONOMOUS CONTROL",
    body: "The onboard planner sequences the crane and conveyor, selects a route, re-plans around detected hazards, and runs the final reverse-docking approach without a ground link — the round-trip delay to Earth is too long to drive by hand.",
    specs: [["MODE", "FULL AUTO"], ["REPLAN", "ON HAZARD"], ["LINK", "OPTIONAL"]],
    view: [-1, 0.6, 0.35],
  },
  {
    id: "power", n: "07", title: "POWER SYSTEM",
    body: "Solar panels along both side walls charge a battery under the bay floor, sized to cross the site and hold through short eclipses, dropping to a low-power keep-alive state when parked.",
    specs: [["SOURCE", "SOLAR"], ["STORE", "BATTERY"], ["HOLD", "KEEP-ALIVE"]],
    view: [-1, 0.4, 0.1],
  },
  {
    id: "vacuum", n: "08", title: "DUST VACUUM",
    body: "Lunar dust can ride in on the cargo. Suction strips along both sides of the conveyor pull up any regolith that falls into the bay and feed it to a filtered collector canister, keeping the sealed interior, the belt and the crane free of abrasive dust.",
    specs: [["INTAKE", "BELT-SIDE STRIPS"], ["COLLECTOR", "FILTERED"], ["ZONE", "CARGO BAY"]],
    view: [0.45, 1.4, 0.35],
  },
];
