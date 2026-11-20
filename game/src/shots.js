// Screenshot staging behind ?shot=<name>&seed=<n>.
//
// Four real shots (DESIGN.md §3.16, §6.3, §9.8): `city`, `street`,
// `chase`, `heist`. Each one stages the live game — the real city,
// traffic, police and missions systems, driven forward a few seconds
// by a simple autopilot (drive toward the mission marker, steer to stay
// on the road) — then frames the camera on the action and returns the
// screen to draw. Unknown names still stage the title screen, as v1
// does. The shape (return the screen to draw) stays the same.
import { STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { enterCar, exitCar, updateDrive } from './cars.js';
import { updateTraffic } from './traffic.js';
import { addWanted, updatePolice } from './police.js';
import { startMission, updateMissions } from './missions.js';

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Synthetic driving input for the autopilot: full throttle, steering
// toward (tx, tz). Steering sign follows cars.js: axes.x < 0 turns the
// heading up (toward +target), axes.x > 0 turns it down.
function driveInput(state, tx, tz) {
  const p = state.player.pos;
  const want = Math.atan2(tx - p.x, tz - p.z);
  const diff = wrapAngle(want - state.player.heading);
  return {
    axes: () => ({ x: clamp(-diff * 2, -1, 1), y: 1 }),
    running: () => false,
  };
}

// Advance the live systems `steps` fixed steps. When `driveTarget` is
// given and the player is driving, the autopilot drives toward it;
// otherwise only traffic / police / missions advance (the player car
// coasts to a stop on its own if it was moving, and the player mesh
// stays where it was put). Screen must be 'play' first — updatePolice
// no-ops on any other screen.
function simulate(state, steps, driveTarget) {
  for (let i = 0; i < steps; i += 1) {
    state.time += STEP;
    if (driveTarget && !state.player.onFoot && state.player.car) {
      updateDrive(state, STEP, driveInput(state, driveTarget.x, driveTarget.z));
    }
    updateTraffic(state, STEP);
    updatePolice(state, STEP);
    updateMissions(state, STEP);
  }
}

// Advance only traffic + missions (the player car and police stay
// exactly where they were staged — used after final placement so the
// composed frame does not drift).
function simulateAmbient(state, steps) {
  for (let i = 0; i < steps; i += 1) {
    state.time += STEP;
    updateTraffic(state, STEP);
    updateMissions(state, STEP);
  }
}

// Put the player behind the wheel of a parked car moved to (x, z) with
// the given heading. Entering a parked car is free (no wanted star);
// the car leaves the parked list, the player mesh hides.
function putPlayerInCar(state, x, z, heading) {
  const car = state.parkedCars[0];
  if (!car) return null;
  car.pos.set(x, 0, z);
  car.heading = heading;
  car.speed = 0;
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = heading;
  state.player.pos.set(x, 0, z);
  state.player.heading = heading;
  enterCar(state, car);
  return car;
}

// Move every spawned police car onto the given spots
// [{ x, z, heading, speed }] and sync their meshes.
function placePoliceCars(state, spots) {
  const cars = state.police.filter((u) => u.kind === 'car' && !u.remove);
  cars.forEach((unit, i) => {
    const spot = spots[i % spots.length];
    const car = unit.car;
    car.pos.set(spot.x, 0, spot.z);
    car.heading = spot.heading;
    car.speed = spot.speed || 0;
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = spot.heading;
    unit.heading = spot.heading;
    unit.speed = car.speed;
    unit.lastX = spot.x;
    unit.lastZ = spot.z;
    unit.stuckTime = 0;
    unit.sampleT = 0.5;
  });
}

function frameCamera(state, yaw, pitch, dist) {
  state.camera.yaw = yaw;
  state.camera.pitch = pitch;
  state.camera.dist = dist;
}

// The mission briefing banner is transient in real play (gone after
// ~5 s); hide it for shots where it would cover the view. The objective
// line, minimap and speed readout still carry the HUD.
function hideBanner(state) {
  try {
    if (state._hud && typeof state._hud.hideBanner === 'function') state._hud.hideBanner();
  } catch { /* HUD must never break staging */ }
}

// Hide the controls hint for staged shots via the HUD override, so it
// never smudges the frame (the auto-hide would still show it this
// early in a session).
function hideHint(state) {
  try {
    if (state._hud && typeof state._hud.setHintOverride === 'function') state._hud.setHintOverride('hide');
  } catch { /* HUD must never break staging */ }
}

// Complete mission 1 for real in the staged play, so the cash readout
// is not $0: steal a parked car (the game's own enterCar), park it at
// the garage front so the mission completes for +$500, then step out.
// The shot's own mission is started explicitly after this.
function completeMissionOne(state) {
  startMission(state, 0);
  const f = state._missions.garageFront;
  putPlayerInCar(state, f.x, f.z, 0);
  simulate(state, 4, null); // step 0 -> 1 (in a car) -> complete at garage
  exitCar(state);
  simulate(state, 2, null);
}

// --- The four shots -------------------------------------------------------

// 1-city.jpg — city + driving (the cover). Danny drives east along the
// z=36 road toward Neon Bay Tower, mission 2's beacon burning over the
// tower drop dead ahead. Camera chases behind the car.
function stageCity(state) {
  state.screen = SCREEN_PLAY;
  state.time = 0;
  completeMissionOne(state); // cash $500, mission 2 to start below
  startMission(state, 1); // Payday Pickup — beacon at the tower drop
  putPlayerInCar(state, -180, 39, Math.PI / 2);
  // Drive 4 s straight east along the road toward the tower so it
  // looms large ahead (the car stops ~90 m short — the drop at (0,24)
  // is never reached, so the beacon stays on the tower).
  simulate(state, 240, { x: 0, z: 36 });
  // Busy street: pull traffic and pedestrians onto the road ahead of
  // the car so the cover shows a living street, not an empty road.
  const p = state.player.pos;
  [
    { x: p.x + 22, z: 33 },
    { x: p.x + 42, z: 39 },
    { x: p.x + 62, z: 33 },
  ].forEach((s, i) => {
    const t = state.traffic[i];
    if (!t) return;
    t.car.pos.set(s.x, 0, s.z);
    t.car.heading = Math.PI / 2;
    t.car.speed = 10;
    t.car.mesh.position.copy(t.car.pos);
    t.car.mesh.rotation.y = Math.PI / 2;
  });
  [
    { x: p.x + 18, z: 26, heading: Math.PI / 2 },
    { x: p.x + 34, z: 46, heading: -Math.PI / 2 },
    { x: p.x + 52, z: 26, heading: 0 },
  ].forEach((s, i) => {
    const ped = state.peds[i];
    if (!ped) return;
    ped.pos.set(s.x, 0, s.z);
    ped.heading = s.heading;
    ped.mesh.rotation.y = s.heading;
    ped.state = 'walk';
    ped.stateTimer = 6;
  });
  simulateAmbient(state, 20);
  const h = state.player.heading;
  // Level camera (pitch ~0.12): the tower's neon sign sits ~28 m up,
  // and the old steep chase pitch put it above the frame top.
  frameCamera(state, h + Math.PI, 0.12, 12);
  hideBanner(state);
  hideHint(state);
  state.shakeTime = 0;
  return { screen: SCREEN_PLAY };
}

// 2-street.jpg — on-foot action. Danny stands on the z=-108 road in
// front of Marchetti Garage, pedestrians crossing around him, traffic
// passing, mission 1's beacon over the garage. Camera looks north up
// the street at the garage.
function stageStreet(state) {
  state.screen = SCREEN_PLAY;
  state.time = 0;
  // Danny already delivered the stolen car (+$500) and stepped out in
  // front of the garage; mission 1 is live.
  completeMissionOne(state);
  startMission(state, 0); // First Wheels — cash $500 on the HUD
  state.player.pos.set(-144, 0, -108);
  state.player.heading = Math.PI;
  if (state.player.mesh) {
    state.player.mesh.visible = true;
    state.player.mesh.position.copy(state.player.pos);
    state.player.mesh.rotation.y = state.player.heading;
  }
  // Pull three pedestrians into the frame around the player.
  const spots = [
    { x: -138, z: -102, heading: Math.PI / 2 },
    { x: -150, z: -104, heading: -Math.PI / 2 },
    { x: -140, z: -116, heading: 0 },
  ];
  spots.forEach((s, i) => {
    const ped = state.peds[i];
    if (!ped) return;
    ped.pos.set(s.x, 0, s.z);
    ped.heading = s.heading;
    ped.mesh.rotation.y = s.heading;
    ped.state = 'walk';
    ped.stateTimer = 6;
  });
  simulate(state, 120, null);
  // Level camera (pitch ~0.12) pulled back a little: the garage's neon
  // sign sits high on the south face, and the old steep pitch put it
  // above the frame top.
  frameCamera(state, 0, 0.12, 16);
  hideBanner(state);
  hideHint(state);
  state.shakeTime = 0;
  return { screen: SCREEN_PLAY };
}

// 3-chase.jpg — police / wanted chase. Danny drives east on the z=-36
// road at 2 stars with two police cars closing in behind him. Side-on
// camera from the south verge: the player car centre-frame, the black
// and whites trailing to the west.
function stageChase(state) {
  state.screen = SCREEN_PLAY;
  state.time = 0;
  completeMissionOne(state); // cash $500
  startMission(state, 0); // First Wheels — objective line + HUD heat
  putPlayerInCar(state, -180, -33, Math.PI / 2);
  addWanted(state, 2, 'stolen car');
  simulate(state, 150, { x: 200, z: -33 });
  // Bring the spawned police cars into the frame behind the player.
  // Placed after the drive so the gaps are exact, then only ambient
  // traffic moves — the composed chase line stays put.
  const p = state.player.pos;
  placePoliceCars(state, [
    { x: p.x - 14, z: -33, heading: Math.PI / 2, speed: 14 },
    { x: p.x - 24, z: -39, heading: Math.PI / 2, speed: 14 },
  ]);
  simulateAmbient(state, 20);
  // Camera sits on the road ahead-east of the car, looking back west:
  // the hero car head-on centre-frame, the black-and-whites trailing
  // behind it up the road. (Yaw 1.92 puts the camera on the road, not
  // inside the block south of it.)
  frameCamera(state, 1.92, 0.3, 16);
  hideBanner(state);
  hideHint(state);
  state.shakeTime = 0;
  return { screen: SCREEN_PLAY };
}

// 4-heist.jpg — missions / HUD with minimap. Danny drives up to Neon
// Bay Bank on mission 5 (Bay Heist) with 1 star of heat; the yellow
// beacon burns over the bank, the objective line and the minimap
// marker are live, one police car closing on the z=180 road.
function stageHeist(state) {
  state.screen = SCREEN_PLAY;
  state.time = 0;
  completeMissionOne(state); // cash $500
  startMission(state, 4); // Bay Heist — beacon at the bank
  // On the z=180 road south of the bank, nose toward the bank front
  // (about 14 m short of it, so mission step 0 does not advance).
  putPlayerInCar(state, 144, 186, Math.PI);
  addWanted(state, 1, 'stolen car');
  // Drive 1 s up the road toward the bank so the player car ends up
  // on the road itself (not on the plaza block south of it): the shot
  // camera then sits over the road, and the frame below the cars is
  // street, not empty plaza.
  simulate(state, 60, { x: 144, z: 170 });
  // Bring the spawned police car into the frame: a black-and-white
  // right beside the player car, closing on the bank front just ahead
  // of the player, between the camera and the beacon. Placed after the
  // drive so it stays in frame.
  placePoliceCars(state, [{ x: 140, z: 172, heading: Math.PI, speed: 10 }]);
  simulateAmbient(state, 20);
  // Close and levelled (dist 12, pitch ~0.10): the player car and the
  // police car fill the frame at roughly twice their R3 size, the bank
  // roofline — and the beacon pillar rising from it — still fit inside
  // it, and the plaza is a thin strip beyond the road.
  frameCamera(state, 0, 0.1, 12);
  hideBanner(state);
  hideHint(state);
  state.shakeTime = 0;
  return { screen: SCREEN_PLAY };
}

// Title screen (v1 staging, kept): the player stands by the garage and
// the camera looks down the street at Neon Bay Tower. Also the fallback
// for any unknown shot name.
function stageTitle(state) {
  state.screen = SCREEN_TITLE;
  state.time = 0;
  const garage = state.city.landmarks.garage;
  state.player.pos.set(garage.pos.x, 0, garage.pos.z + 18);
  state.player.heading = Math.PI;
  if (state.player.mesh) {
    state.player.mesh.visible = true;
    state.player.mesh.position.copy(state.player.pos);
    state.player.mesh.rotation.y = state.player.heading;
  }
  state.camera.yaw = 0;
  state.camera.pitch = 0.42;
  state.camera.dist = 11;
  return { screen: SCREEN_TITLE };
}

export function stageShot(name, state) {
  switch (name) {
    case 'city':
      return stageCity(state);
    case 'street':
      return stageStreet(state);
    case 'chase':
      return stageChase(state);
    case 'heist':
      return stageHeist(state);
    default:
      return stageTitle(state);
  }
}
