// Neon Bay — car mesh factory + arcade driving physics. One job: build
// original low-poly cars (sedan / taxi / sports / truck / police) out of
// boxes, and drive the player's car with an arcade model (accelerate,
// brake/reverse, speed-sensitive steering, handbrake slide) plus simple
// collision against buildings, other cars and the world edge.
//
// A car is { mesh, kind, color, speed, heading, pos, steering, health,
// driver, parked, length, width, topSpeed }. `pos` is the live Vector3 the
// mesh follows; `driver` is 'player' | 'traffic' | null (null = parked and
// stealable for free). Slice C (police) reuses makeCar(..., 'police', ...).

import * as THREE from 'three';

// --- Per-kind tuning (top speed m/s, accel m/s^2, grip) -------------------
export const CAR_SPECS = {
  sedan: { topSpeed: 28, reverseSpeed: 9, accel: 16, brake: 30, steer: 1.9, length: 4.4, width: 1.9, height: 1.35 },
  taxi: { topSpeed: 26, reverseSpeed: 9, accel: 15, brake: 30, steer: 1.9, length: 4.4, width: 1.9, height: 1.35 },
  sports: { topSpeed: 38, reverseSpeed: 10, accel: 24, brake: 34, steer: 2.3, length: 4.2, width: 2.0, height: 1.05 },
  truck: { topSpeed: 18, reverseSpeed: 7, accel: 9, brake: 24, steer: 1.4, length: 6.2, width: 2.3, height: 2.2 },
  police: { topSpeed: 32, reverseSpeed: 10, accel: 20, brake: 32, steer: 2.1, length: 4.5, width: 1.95, height: 1.35 },
};

const TAXI_YELLOW = 0xf2c200;
const POLICE_BLACK = 0x1a1d22;
const POLICE_WHITE = 0xf2f2f2;

// --- Shared geometry / materials (built once, reused by every car) --------
let shared = null;
function getShared() {
  if (shared) return shared;
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2); // axle along X so the wheel rolls forward
  const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.32, 8);
  hubGeo.rotateZ(Math.PI / 2);
  shared = {
    wheelGeo,
    hubGeo,
    wheelMat: new THREE.MeshLambertMaterial({ color: 0x14161a }),
    hubMat: new THREE.MeshLambertMaterial({ color: 0x9aa2ab }),
    glassMat: new THREE.MeshLambertMaterial({ color: 0x1d3a4a }),
    headMat: new THREE.MeshBasicMaterial({ color: 0xfff2b0 }),
    tailMat: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
    chromeMat: new THREE.MeshLambertMaterial({ color: 0xc8ccd2 }),
    signMat: new THREE.MeshBasicMaterial({ color: 0xffe14d }),
    lightRedMat: new THREE.MeshBasicMaterial({ color: 0xff2020 }),
    lightBlueMat: new THREE.MeshBasicMaterial({ color: 0x2050ff }),
    paintMats: new Map(),
    bodyGeos: new Map(),
    cabinGeos: new Map(),
  };
  return shared;
}

function paintMat(color) {
  const s = getShared();
  if (!s.paintMats.has(color)) s.paintMats.set(color, new THREE.MeshLambertMaterial({ color }));
  return s.paintMats.get(color);
}

function bodyGeo(kind) {
  const s = getShared();
  if (!s.bodyGeos.has(kind)) {
    const spec = CAR_SPECS[kind];
    s.bodyGeos.set(kind, new THREE.BoxGeometry(spec.width, 0.62, spec.length));
  }
  return s.bodyGeos.get(kind);
}

function cabinGeo(kind) {
  const s = getShared();
  if (!s.cabinGeos.has(kind)) {
    const spec = CAR_SPECS[kind];
    const w = kind === 'truck' ? spec.width * 0.9 : spec.width * 0.82;
    const l = kind === 'truck' ? spec.length * 0.3 : spec.length * 0.45;
    const h = kind === 'truck' ? 0.85 : kind === 'sports' ? 0.42 : 0.55;
    s.cabinGeos.set(kind, new THREE.BoxGeometry(w, h, l));
  }
  return s.cabinGeos.get(kind);
}

function addBox(group, geo, mat, x, y, z, castShadow = true) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
  group.add(mesh);
  return mesh;
}

/**
 * Build one car and add it to `scene`. `kind` is sedan | taxi | sports |
 * truck | police. `color` is a hex number (ignored for taxi/police, which
 * have fixed liveries). `pos` is a THREE.Vector3 or {x, z}; `heading` is
 * radians, forward = (sin h, cos h), matching the player convention.
 */
export function makeCar(scene, kind, color, pos, heading = 0) {
  const spec = CAR_SPECS[kind] || CAR_SPECS.sedan;
  const s = getShared();
  const group = new THREE.Group();
  const paint = kind === 'taxi' ? TAXI_YELLOW : kind === 'police' ? POLICE_BLACK : color;

  // Body: low slab; cabin: glass box on top (truck: cab at the front only).
  const body = addBox(group, bodyGeo(kind), paintMat(paint), 0, 0.55, 0);
  void body;
  const cabinZ = kind === 'truck' ? spec.length * 0.28 : -spec.length * 0.05;
  const cabinY = kind === 'truck' ? 1.28 : kind === 'sports' ? 1.05 : 1.12;
  const cabin = addBox(group, cabinGeo(kind), s.glassMat, 0, cabinY, cabinZ);
  void cabin;

  if (kind === 'truck') {
    // Cargo box over the rear bed.
    addBox(group, new THREE.BoxGeometry(spec.width * 0.96, 1.5, spec.length * 0.55),
      paintMat(0x8a94a0), 0, 1.55, -spec.length * 0.2);
  }
  if (kind === 'police') {
    // White doors band: a slightly wider white slab through the middle.
    addBox(group, new THREE.BoxGeometry(spec.width + 0.02, 0.3, spec.length * 0.5),
      paintMat(POLICE_WHITE), 0, 0.55, 0);
    // Roof light bar: red left, blue right.
    addBox(group, new THREE.BoxGeometry(0.5, 0.14, 0.3), s.lightRedMat, -0.4, 1.45, 0);
    addBox(group, new THREE.BoxGeometry(0.5, 0.14, 0.3), s.lightBlueMat, 0.4, 1.45, 0);
  }
  if (kind === 'taxi') {
    // Roof sign.
    addBox(group, new THREE.BoxGeometry(0.7, 0.18, 0.3), s.signMat, 0, 1.5, 0);
    // Chequer band along the side.
    addBox(group, new THREE.BoxGeometry(spec.width + 0.02, 0.16, spec.length * 0.6),
      new THREE.MeshLambertMaterial({ color: 0x111111 }), 0, 0.5, 0);
  }
  if (kind === 'sports') {
    // Rear spoiler.
    addBox(group, new THREE.BoxGeometry(spec.width * 0.9, 0.07, 0.35), paintMat(0x14161a), 0, 1.0, -spec.length / 2 + 0.15);
  }

  // Headlights (front, +Z is forward) and taillights (rear).
  const frontZ = spec.length / 2 - 0.05;
  const rearZ = -spec.length / 2 + 0.05;
  const lampGeo = new THREE.BoxGeometry(0.34, 0.14, 0.06);
  addBox(group, lampGeo, s.headMat, -spec.width / 2 + 0.35, 0.62, frontZ, false);
  addBox(group, lampGeo, s.headMat, spec.width / 2 - 0.35, 0.62, frontZ, false);
  addBox(group, lampGeo, s.tailMat, -spec.width / 2 + 0.35, 0.62, rearZ, false);
  addBox(group, lampGeo, s.tailMat, spec.width / 2 - 0.35, 0.62, rearZ, false);

  // Four wheels, steered pair at the front.
  const wheels = [];
  const wheelX = spec.width / 2 - 0.08;
  const wheelZ = spec.length / 2 - 0.85;
  for (const [wx, wz] of [[-wheelX, wheelZ], [wheelX, wheelZ], [-wheelX, -wheelZ], [wheelX, -wheelZ]]) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.36, wz);
    const tyre = new THREE.Mesh(s.wheelGeo, s.wheelMat);
    tyre.castShadow = true;
    const hub = new THREE.Mesh(s.hubGeo, s.hubMat);
    pivot.add(tyre, hub);
    group.add(pivot);
    wheels.push(pivot);
  }

  const p = pos && typeof pos.x === 'number'
    ? new THREE.Vector3(pos.x, 0, pos.z || 0)
    : new THREE.Vector3(0, 0, 0);
  group.position.copy(p);
  group.rotation.y = heading;
  scene.add(group);

  return {
    mesh: group,
    kind,
    color: paint,
    speed: 0,
    heading,
    pos: p,
    steering: 0,
    health: 100,
    driver: null,
    parked: false,
    length: spec.length,
    width: spec.width,
    topSpeed: spec.topSpeed,
    wheels,
    // Scratch vectors, reused in updateDrive so the hot loop allocates nothing.
    _fwdX: 0,
    _fwdZ: 1,
  };
}

/** Convenience for slice C: a black-and-white police car. */
export function makePoliceCar(scene, pos, heading = 0) {
  const car = makeCar(scene, 'police', POLICE_BLACK, pos, heading);
  car.driver = 'traffic';
  return car;
}

// --- Handbrake (Space) ------------------------------------------------------
// input.js exposes no handbrake key, so cars.js tracks Space itself. This is
// the only extra listener the slice adds; it never interferes with the
// title-screen confirm (Space there starts the game, which is harmless).
let handbrakeHeld = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') handbrakeHeld = true;
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') handbrakeHeld = false;
  });
  window.addEventListener('blur', () => { handbrakeHeld = false; });
}

/** True while the handbrake (Space) is held. */
export function isHandbrakeHeld() {
  return handbrakeHeld;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function collideBuildings(car) {
  // Circle (car, radius ~ half the diagonal footprint) vs building AABB
  // push-out — the same approach as player.js, one pass per building.
  const r = Math.hypot(car.length, car.width) / 2 - 0.35;
  const pos = car.pos;
  const buildings = car._buildings;
  if (!buildings) return false;
  let hit = false;
  for (const b of buildings) {
    const nx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const nz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * r;
      pos.z = nz + (dz / d) * r;
    } else {
      const pushL = pos.x - b.minX + r;
      const pushR = b.maxX - pos.x + r;
      const pushT = pos.z - b.minZ + r;
      const pushB = b.maxZ - pos.z + r;
      const m = Math.min(pushL, pushR, pushT, pushB);
      if (m === pushL) pos.x = b.minX - r;
      else if (m === pushR) pos.x = b.maxX + r;
      else if (m === pushT) pos.z = b.minZ - r;
      else pos.z = b.maxZ + r;
    }
  }
  return hit;
}

function collideCars(car, others) {
  // Soft push between two cars: separate overlapping circles and bleed
  // speed from both. Cheap O(n) against the traffic list.
  if (!others) return;
  const r = Math.hypot(car.length, car.width) / 2;
  for (const other of others) {
    if (other === car || !other.pos) continue;
    const or = Math.hypot(other.length || 4.4, other.width || 1.9) / 2;
    const dx = car.pos.x - other.pos.x;
    const dz = car.pos.z - other.pos.z;
    const min = r + or - 0.6;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min || d2 < 1e-8) continue;
    const d = Math.sqrt(d2);
    const push = (min - d) / 2;
    const ux = dx / d;
    const uz = dz / d;
    car.pos.x += ux * push;
    car.pos.z += uz * push;
    if (other.driver !== 'player' && other.pos) {
      other.pos.x -= ux * push;
      other.pos.z -= uz * push;
      if (other.mesh) { other.mesh.position.x = other.pos.x; other.mesh.position.z = other.pos.z; }
    }
    car.speed *= 0.85;
    if (typeof other.speed === 'number') other.speed *= 0.85;
  }
}

/**
 * Advance the player's car one fixed step. `input` is the createInput()
 * object (axes() + running()). No-op when the player is on foot.
 * Also keeps state.player.pos/heading/speed in sync and eases the camera
 * into a driving chase view (behind the car, looking forward).
 */
export function updateDrive(state, dt, input) {
  const player = state.player;
  const car = player.car;
  if (!car || player.onFoot) return;
  const spec = CAR_SPECS[car.kind] || CAR_SPECS.sedan;
  const axes = input.axes();
  const handbrake = handbrakeHeld;
  const absSpeed = Math.abs(car.speed);

  // --- Longitudinal: accelerate / brake / reverse / coast ------------------
  if (axes.y > 0) {
    car.speed += spec.accel * dt;
    if (car.speed > spec.topSpeed) car.speed = spec.topSpeed;
  } else if (axes.y < 0) {
    if (car.speed > 0.5) car.speed -= spec.brake * dt; // brake
    else car.speed -= spec.accel * 0.7 * dt; // reverse
    if (car.speed < -spec.reverseSpeed) car.speed = -spec.reverseSpeed;
  } else {
    // Coast: drag + rolling resistance.
    const drag = (0.6 + absSpeed * 0.04) * dt;
    if (car.speed > 0) car.speed = Math.max(0, car.speed - drag);
    else if (car.speed < 0) car.speed = Math.min(0, car.speed + drag);
  }
  if (handbrake) {
    // Hard decel + tighter turn; the rear slides (extra yaw, see below).
    car.speed -= Math.sign(car.speed) * Math.min(absSpeed, 22 * dt);
    if (Math.abs(car.speed) < 0.2) car.speed = 0;
  }

  // --- Steering: speed-sensitive, stronger + slide on handbrake -----------
  const speedFactor = 1 / (1 + absSpeed * 0.045);
  const steerTarget = -axes.x * spec.steer * speedFactor * (handbrake ? 1.6 : 1);
  car.steering += (steerTarget - car.steering) * Math.min(1, 10 * dt);
  const dirSign = car.speed >= 0 ? 1 : -1;
  car.heading += car.steering * (absSpeed / Math.max(1, spec.topSpeed)) * dirSign * dt * 2.2;
  if (handbrake && absSpeed > 6) car.heading += -axes.x * 0.9 * dt * dirSign;

  // --- Move ------------------------------------------------------------------
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  car._fwdX = fx;
  car._fwdZ = fz;
  car.pos.x += fx * car.speed * dt;
  car.pos.z += fz * car.speed * dt;

  // --- Collisions ------------------------------------------------------------
  car._buildings = state.city.buildings;
  if (collideBuildings(car)) {
    // A wall hit scrubs most of the speed; a little bounce stays fun.
    car.speed *= -0.25;
    car.health = Math.max(0, car.health - 1);
  }
  collideCars(car, state.traffic ? state.traffic.map((t) => t.car || t) : []);
  // Parked cars are solid too (they are not in state.traffic).
  if (state.parkedCars) collideCars(car, state.parkedCars);

  // World bounds: the city edge plus the beach; the ocean is the wall.
  const limit = state.city.half + 56;
  car.pos.x = Math.max(-limit, Math.min(limit, car.pos.x));
  car.pos.z = Math.max(-state.city.half - 6, Math.min(state.city.half + 56, car.pos.z));

  // --- Sync mesh + player + chase camera ------------------------------------
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
  // Front wheels visually steer.
  const steerAngle = car.steering * 0.45;
  if (car.wheels) {
    car.wheels[0].rotation.y = steerAngle;
    car.wheels[1].rotation.y = steerAngle;
    // Spin wheels with speed.
    const spin = (car.speed * dt) / 0.36;
    for (const w of car.wheels) {
      if (w.children[0]) w.children[0].rotation.x += spin;
      if (w.children[1]) w.children[1].rotation.x += spin;
    }
  }
  player.pos.copy(car.pos);
  player.heading = car.heading;
  player.speed = car.speed;

  // Chase camera: ease the orbit yaw to directly behind the car.
  const targetYaw = car.heading + Math.PI;
  state.camera.yaw += wrapAngle(targetYaw - state.camera.yaw) * Math.min(1, 4 * dt);
  state.camera.dist += (11 - state.camera.dist) * Math.min(1, 3 * dt);
  state.camera.pitch += (0.32 - state.camera.pitch) * Math.min(1, 3 * dt);
}

// --- Enter / exit -----------------------------------------------------------

/** Nearest car to the player within `maxDist` metres, or null. */
export function nearestCar(state, maxDist = 3.5) {
  const p = state.player.pos;
  let best = null;
  let bestD2 = maxDist * maxDist;
  const all = [];
  if (state.traffic) for (const t of state.traffic) all.push(t.car || t);
  if (state.parkedCars) for (const c of state.parkedCars) all.push(c);
  if (state.police) for (const pc of state.police) all.push(pc.car || pc);
  for (const car of all) {
    if (!car || !car.pos || car === state.player.car) continue;
    const dx = car.pos.x - p.x;
    const dz = car.pos.z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = car; }
  }
  return best;
}

function wantedAdd(stars, reason) {
  if (typeof window !== 'undefined' && typeof window.__wantedAdd === 'function') {
    window.__wantedAdd(stars, reason);
  }
}

/** Put the player into `car` (steal rules + wanted applied). */
export function enterCar(state, car) {
  const player = state.player;
  if (!car || player.car) return false;
  const occupied = car.driver === 'traffic';
  if (occupied) {
    state.stats.carsStolen += 1;
    wantedAdd(1, 'stolen car');
  }
  // A stolen traffic car leaves the traffic list; a parked car leaves the
  // parked list. Either way the player now drives it.
  if (state.traffic) {
    const i = state.traffic.findIndex((t) => (t.car || t) === car);
    if (i >= 0) state.traffic.splice(i, 1);
  }
  if (state.parkedCars) {
    const i = state.parkedCars.indexOf(car);
    if (i >= 0) state.parkedCars.splice(i, 1);
  }
  car.driver = 'player';
  car.parked = false;
  player.car = car;
  player.onFoot = false;
  player.pos.copy(car.pos);
  player.heading = car.heading;
  player.speed = 0;
  if (player.mesh) player.mesh.visible = false;
  return true;
}

/** Step out of the player's car beside it; it becomes a parked car. */
export function exitCar(state) {
  const player = state.player;
  const car = player.car;
  if (!car) return false;
  if (Math.abs(car.speed) >= 1) return false; // must be (near-)stopped
  car.driver = null;
  car.parked = true;
  car.speed = 0;
  // Step out on the driver's side (left of the car's forward axis).
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  player.pos.set(car.pos.x - fz * 2.2, 0, car.pos.z + fx * 2.2);
  player.heading = car.heading;
  player.speed = 0;
  player.car = null;
  player.onFoot = true;
  if (player.mesh) {
    player.mesh.visible = true;
    player.mesh.position.copy(player.pos);
  }
  if (!state.parkedCars) state.parkedCars = [];
  state.parkedCars.push(car);
  return true;
}

/**
 * E-key handler: enter the nearest car on foot, or exit while driving.
 * Returns 'entered' | 'exited' | 'too-fast' | null.
 */
export function handleCarInteract(state) {
  const player = state.player;
  if (!player.onFoot) {
    if (exitCar(state)) return 'exited';
    return 'too-fast';
  }
  const car = nearestCar(state, 3.5);
  if (!car) return null;
  return enterCar(state, car) ? 'entered' : null;
}
