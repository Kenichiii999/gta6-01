// Car mesh factory + arcade driving physics + enter/exit. One job: build
// original low-poly cars (sedan / taxi / sports / truck / police) out of
// boxes, and drive the player's car with an arcade model (accelerate,
// brake/reverse, speed-sensitive steering, handbrake slide) plus simple
// collision against buildings, other cars and the world edge.
//
// Forward is +Z of the car mesh: heading h means forward (sin h, cos h).
// A car is { mesh, kind, color, speed, heading, pos, steering, health,
// driver, parked, length, width, topSpeed, wheels, _fwdX, _fwdZ }.
// driver is 'player' | 'traffic' | null (null = parked and stealable).
import * as THREE from 'three';

// Per-kind tuning. Speeds in m/s, accel/brake in m/s^2.
export const CAR_SPECS = {
  sedan: { topSpeed: 28, reverseSpeed: 9, accel: 16, brake: 30, steer: 1.9, length: 4.4, width: 1.9, height: 1.35 },
  taxi: { topSpeed: 26, reverseSpeed: 9, accel: 15, brake: 30, steer: 1.9, length: 4.4, width: 1.9, height: 1.35 },
  sports: { topSpeed: 38, reverseSpeed: 10, accel: 24, brake: 34, steer: 2.3, length: 4.2, width: 2.0, height: 1.05 },
  truck: { topSpeed: 18, reverseSpeed: 7, accel: 9, brake: 24, steer: 1.4, length: 6.2, width: 2.3, height: 2.2 },
  police: { topSpeed: 32, reverseSpeed: 10, accel: 20, brake: 32, steer: 2.1, length: 4.5, width: 1.95, height: 1.35 },
};

// --- Handbrake (Space) -----------------------------------------------------
// Space is tracked by a separate listener here (input.js exposes no
// handbrake key). It never interferes with the title-screen confirm:
// Space there starts the game, which is harmless.
let handbrakeHeld = false;
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') handbrakeHeld = true;
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') handbrakeHeld = false;
});
window.addEventListener('blur', () => { handbrakeHeld = false; });

export function isHandbrakeHeld() {
  return handbrakeHeld;
}

// --- Shared geometries / materials (built once, cached) --------------------
let shared = null;
function getShared() {
  if (shared) return shared;
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14);
  const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.32, 10);
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0x9aa2ab });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1d3a4a });
  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const chromeMat = new THREE.MeshLambertMaterial({ color: 0xc9d2d8 });
  const lampGeo = new THREE.BoxGeometry(0.34, 0.14, 0.06);
  const paintMats = new Map();
  const bodyGeos = new Map();
  const cabinGeos = new Map();
  shared = {
    wheelGeo, hubGeo, tyreMat, hubMat, glassMat, headlightMat, taillightMat,
    chromeMat, lampGeo, paintMats, bodyGeos, cabinGeos,
    paint(color) {
      let mat = paintMats.get(color);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({ color });
        paintMats.set(color, mat);
      }
      return mat;
    },
    bodyGeo(kind) {
      const spec = CAR_SPECS[kind];
      let geo = bodyGeos.get(kind);
      if (!geo) {
        geo = new THREE.BoxGeometry(spec.width, 0.62, spec.length);
        bodyGeos.set(kind, geo);
      }
      return geo;
    },
    cabinGeo(kind) {
      const spec = CAR_SPECS[kind];
      let geo = cabinGeos.get(kind);
      if (!geo) {
        const w = spec.width * (kind === 'truck' ? 0.9 : 0.82);
        const l = spec.length * (kind === 'truck' ? 0.3 : 0.45);
        const h = kind === 'sports' ? 0.42 : kind === 'truck' ? 0.85 : 0.55;
        geo = new THREE.BoxGeometry(w, h, l);
        cabinGeos.set(kind, geo);
      }
      return geo;
    },
  };
  return shared;
}

// --- Car factory -----------------------------------------------------------
// Builds the mesh, positions it at `pos` (y 0) with the given heading, and
// returns the car object. `color` is ignored for taxi (always yellow) and
// for police (always black body).
export function makeCar(scene, kind, color, pos, heading = 0) {
  const spec = CAR_SPECS[kind];
  const s = getShared();
  const group = new THREE.Group();

  const paintColor = kind === 'taxi' ? 0xf2c200 : kind === 'police' ? 0x1a1d22 : color;
  const body = new THREE.Mesh(s.bodyGeo(kind), s.paint(paintColor));
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  // Cabin: glass box. Truck cab sits forward and high; sports is low.
  const cabin = new THREE.Mesh(s.cabinGeo(kind), s.glassMat);
  cabin.position.y = kind === 'truck' ? 1.28 : kind === 'sports' ? 1.05 : 1.12;
  cabin.position.z = kind === 'truck' ? spec.length * 0.28 : -spec.length * 0.05;
  cabin.castShadow = true;
  group.add(cabin);

  let lightBarRed = null;
  let lightBarBlue = null;

  if (kind === 'truck') {
    // Cargo box behind the cab.
    const cargo = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width * 0.96, 1.5, spec.length * 0.55),
      new THREE.MeshLambertMaterial({ color: 0x8a94a0 }),
    );
    cargo.position.set(0, 1.55, -spec.length * 0.2);
    cargo.castShadow = true;
    group.add(cargo);
  }

  if (kind === 'police') {
    // White doors band + red/blue roof light bar.
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width + 0.02, 0.3, spec.length * 0.5),
      new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }),
    );
    band.position.y = 0.55;
    group.add(band);
    const barGeo = new THREE.BoxGeometry(0.5, 0.14, 0.3);
    lightBarRed = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    lightBarRed.position.set(-0.4, 1.45, 0);
    group.add(lightBarRed);
    lightBarBlue = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0x2050ff }));
    lightBarBlue.position.set(0.4, 1.45, 0);
    group.add(lightBarBlue);
  }

  if (kind === 'taxi') {
    // Roof sign + black chequer band.
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.18, 0.3),
      new THREE.MeshLambertMaterial({ color: 0xffe14d }),
    );
    sign.position.y = 1.5;
    group.add(sign);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width + 0.02, 0.16, spec.length * 0.6),
      new THREE.MeshLambertMaterial({ color: 0x14161a }),
    );
    band.position.y = 0.5;
    group.add(band);
  }

  if (kind === 'sports') {
    // Rear spoiler.
    const spoiler = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width * 0.9, 0.07, 0.35),
      new THREE.MeshLambertMaterial({ color: 0x14161a }),
    );
    spoiler.position.set(0, 1.0, -spec.length / 2 + 0.15);
    group.add(spoiler);
  }

  // Headlights front (+Z is forward), taillights rear.
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(s.lampGeo, s.headlightMat);
    head.position.set(side * (spec.width / 2 - 0.35), 0.62, spec.length / 2 - 0.05);
    group.add(head);
    const tail = new THREE.Mesh(s.lampGeo, s.taillightMat);
    tail.position.set(side * (spec.width / 2 - 0.35), 0.62, -spec.length / 2 + 0.05);
    group.add(tail);
  }

  // Four wheels: steer pivot -> spin group -> tyre + hub. The front pair
  // steers visually (pivot.rotation.y); all four spin around the axle.
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (spec.width / 2 - 0.08), 0.36, sz * (spec.length / 2 - 0.85));
      const spinner = new THREE.Group();
      const tyre = new THREE.Mesh(s.wheelGeo, s.tyreMat);
      tyre.rotation.z = Math.PI / 2; // cylinder axle along X
      tyre.castShadow = true;
      const hub = new THREE.Mesh(s.hubGeo, s.hubMat);
      hub.rotation.z = Math.PI / 2;
      spinner.add(tyre);
      spinner.add(hub);
      pivot.add(spinner);
      pivot.userData.spinner = spinner;
      pivot.userData.front = sz > 0;
      group.add(pivot);
      wheels.push(pivot);
    }
  }

  group.position.copy(pos);
  group.position.y = 0;
  group.rotation.y = heading;
  scene.add(group);

  const car = {
    mesh: group,
    kind,
    color: paintColor,
    speed: 0,
    heading,
    pos: group.position,
    steering: 0,
    health: 100,
    driver: null,
    parked: false,
    length: spec.length,
    width: spec.width,
    topSpeed: spec.topSpeed,
    wheels,
    _fwdX: Math.sin(heading),
    _fwdZ: Math.cos(heading),
    lightBarRed,
    lightBarBlue,
  };
  return car;
}

// Police variant of the factory car (slice C's police.js reuses this —
// see DESIGN.md §9.7 — instead of building its own police mesh).
export function makePoliceCar(scene, pos, heading = 0) {
  const car = makeCar(scene, 'police', 0x1a1d22, pos, heading);
  car.driver = 'traffic';
  return car;
}

// Spin the wheels from the car's speed and steer the front pair from its
// steering value. Shared by updateDrive (player car) and traffic.js.
export function updateCarWheels(car, dt) {
  for (const pivot of car.wheels) {
    if (pivot.userData.front) pivot.rotation.y = car.steering * 0.45;
    pivot.userData.spinner.rotation.x += (car.speed * dt) / 0.36;
  }
}

// --- Wanted / mission hooks (guarded; the systems may not exist yet) ------
function wantedAdd(n, reason) {
  try {
    if (typeof window.__wantedAdd === 'function') window.__wantedAdd(n, reason);
  } catch { /* a missing police slice must never break stealing a car */ }
}

function missionEvent(type, payload) {
  try {
    if (typeof window.__missionEvent === 'function') window.__missionEvent(type, payload);
  } catch { /* same: never throw for a missing missions slice */ }
}

// --- Collision helpers -----------------------------------------------------
function collideBuildings(state, car) {
  const r = Math.hypot(car.length, car.width) / 2 - 0.35;
  let hit = false;
  for (const b of state.city.buildings) {
    const nx = Math.max(b.minX, Math.min(car.pos.x, b.maxX));
    const nz = Math.max(b.minZ, Math.min(car.pos.z, b.maxZ));
    let dx = car.pos.x - nx;
    let dz = car.pos.z - nz;
    const distSq = dx * dx + dz * dz;
    if (distSq >= r * r) continue;
    hit = true;
    if (distSq > 0.000001) {
      const dist = Math.sqrt(distSq);
      const push = (r - dist) / dist;
      car.pos.x += dx * push;
      car.pos.z += dz * push;
    } else {
      const left = car.pos.x - b.minX;
      const right = b.maxX - car.pos.x;
      const top = car.pos.z - b.minZ;
      const bottom = b.maxZ - car.pos.z;
      const min = Math.min(left, right, top, bottom);
      if (min === left) car.pos.x = b.minX - r;
      else if (min === right) car.pos.x = b.maxX + r;
      else if (min === top) car.pos.z = b.minZ - r;
      else car.pos.z = b.maxZ + r;
    }
  }
  return hit;
}

function collideOtherCars(state, car) {
  const others = [];
  for (const t of state.traffic) others.push(t.car);
  for (const parked of state.parkedCars) others.push(parked);
  const r1 = Math.hypot(car.length, car.width) / 2;
  for (const other of others) {
    if (other === car) continue;
    const r2 = Math.hypot(other.length, other.width) / 2;
    const threshold = r1 + r2 - 0.6;
    let dx = other.pos.x - car.pos.x;
    let dz = other.pos.z - car.pos.z;
    let dist = Math.hypot(dx, dz);
    if (dist >= threshold) continue;
    if (dist < 0.000001) {
      dx = 1;
      dz = 0;
      dist = 1;
    }
    const overlap = threshold - dist;
    const pushX = (dx / dist) * (overlap / 2);
    const pushZ = (dz / dist) * (overlap / 2);
    car.pos.x -= pushX;
    car.pos.z -= pushZ;
    other.pos.x += pushX;
    other.pos.z += pushZ;
    car.speed *= 0.85;
    other.speed *= 0.85;
  }
}

// --- Driving ---------------------------------------------------------------
// Advance the player's car one fixed step. No-op when on foot or car-less.
export function updateDrive(state, dt, input) {
  const player = state.player;
  if (player.onFoot || !player.car) return;
  const car = player.car;
  const spec = CAR_SPECS[car.kind];
  const axes = input.axes();
  const handbrake = isHandbrakeHeld();

  // Longitudinal: W accelerates, S brakes then reverses, neither coasts.
  if (axes.y > 0) {
    car.speed = Math.min(spec.topSpeed, car.speed + spec.accel * dt);
  } else if (axes.y < 0) {
    if (car.speed > 0.5) car.speed -= spec.brake * dt;
    else car.speed = Math.max(-spec.reverseSpeed, car.speed - spec.accel * 0.7 * dt);
  } else {
    const drag = (0.6 + Math.abs(car.speed) * 0.04) * dt;
    if (Math.abs(car.speed) <= drag) car.speed = 0;
    else car.speed -= Math.sign(car.speed) * drag;
  }
  if (handbrake) {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 22 * dt);
    if (Math.abs(car.speed) < 0.2) car.speed = 0;
  }

  // Steering: speed-sensitive, sharper with the handbrake.
  const speedFactor = 1 / (1 + Math.abs(car.speed) * 0.045);
  const steerTarget = -axes.x * spec.steer * speedFactor * (handbrake ? 1.6 : 1);
  car.steering += Math.max(-10 * dt, Math.min(10 * dt, steerTarget - car.steering));
  const dirSign = car.speed >= 0 ? 1 : -1;
  car.heading += car.steering * (Math.abs(car.speed) / Math.max(1, spec.topSpeed)) * dirSign * dt * 2.2;
  if (handbrake && Math.abs(car.speed) > 6) {
    car.heading += -axes.x * 0.9 * dt * dirSign;
  }

  // Move.
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  car.pos.x += fx * car.speed * dt;
  car.pos.z += fz * car.speed * dt;
  car._fwdX = fx;
  car._fwdZ = fz;

  // Collisions: buildings bounce the car back and cost 1 health.
  if (collideBuildings(state, car)) {
    car.speed *= -0.25;
    car.health = Math.max(0, car.health - 1);
  }
  collideOtherCars(state, car);

  // World bounds: same as on foot (the ocean is the wall).
  const half = state.city.half;
  const limit = half + 56;
  car.pos.x = Math.max(-limit, Math.min(limit, car.pos.x));
  car.pos.z = Math.max(-half - 6, Math.min(half + 56, car.pos.z));

  // Sync mesh + wheels, then the player follows the car.
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
  updateCarWheels(car, dt);
  player.pos.copy(car.pos);
  player.heading = car.heading;
  player.speed = car.speed;

  // Chase camera: ease the orbit behind the car.
  const cam = state.camera;
  let dyaw = (car.heading + Math.PI) - cam.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  cam.yaw += dyaw * Math.min(1, 4 * dt);
  cam.dist += (11 - cam.dist) * Math.min(1, 3 * dt);
  cam.pitch += (0.32 - cam.pitch) * Math.min(1, 3 * dt);
}

// --- Enter / exit ----------------------------------------------------------
// Nearest car to the player among traffic cars, parked cars and police
// cars (police units are not cars: pc.car || pc), excluding the player's
// own car.
export function nearestCar(state, maxDist = 3.5) {
  const player = state.player;
  let best = null;
  let bestDist = maxDist;
  const consider = (car) => {
    if (!car || car === player.car) return;
    const d = Math.hypot(car.pos.x - player.pos.x, car.pos.z - player.pos.z);
    if (d < bestDist) {
      bestDist = d;
      best = car;
    }
  };
  for (const t of state.traffic) consider(t.car);
  for (const parked of state.parkedCars) consider(parked);
  for (const unit of state.police) consider(unit.car || unit);
  return best;
}

export function enterCar(state, car) {
  if (!car || state.player.car) return;
  const player = state.player;
  if (car.driver === 'traffic') {
    // Stealing an occupied car: +1 stolen, +1 wanted star.
    state.stats.carsStolen += 1;
    wantedAdd(1, 'stolen car');
    missionEvent('carStolen');
  }
  // The car leaves whichever list it was in.
  const ti = state.traffic.findIndex((t) => t.car === car);
  if (ti >= 0) state.traffic.splice(ti, 1);
  const pi = state.parkedCars.indexOf(car);
  if (pi >= 0) state.parkedCars.splice(pi, 1);
  car.driver = 'player';
  car.parked = false;
  car.speed = 0;
  car.steering = 0;
  player.car = car;
  player.onFoot = false;
  player.pos.copy(car.pos);
  player.heading = car.heading;
  player.speed = 0;
  if (player.mesh) player.mesh.visible = false;
}

// Returns false when there is no car or it is still moving (>= 1 m/s).
export function exitCar(state) {
  const player = state.player;
  const car = player.car;
  if (!car || Math.abs(car.speed) >= 1) return false;
  car.driver = null;
  car.parked = true;
  car.speed = 0;
  // Step out on the driver's side (left of forward).
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  player.pos.set(car.pos.x - fz * 2.2, 0, car.pos.z + fx * 2.2);
  player.heading = car.heading;
  player.onFoot = true;
  player.car = null;
  player.speed = 0;
  if (player.mesh) {
    player.mesh.visible = true;
    player.mesh.position.copy(player.pos);
    player.mesh.rotation.y = player.heading;
  }
  state.parkedCars.push(car);
  return true;
}

// E-key: on foot enter the nearest car within 3.5 m; driving exit (only
// when near-stopped). Returns 'entered' | 'exited' | 'too-fast' | null.
export function handleCarInteract(state) {
  if (state.player.onFoot) {
    const car = nearestCar(state, 3.5);
    if (!car) return null;
    enterCar(state, car);
    return 'entered';
  }
  return exitCar(state) ? 'exited' : 'too-fast';
}
