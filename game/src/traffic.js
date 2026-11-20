// Traffic cars, parked cars, pedestrians. One job: fill the roads with
// cars that follow the grid (lane, turn at intersections, stop behind the
// car ahead, slow near the player), park stealable cars along road edges,
// and walk pedestrians on the sidewalks who flee from a fast car or a
// crime and fall when a player-driven car hits them.
//
// Determinism (§9.9): every roll in this module — spawns, intersection
// turns, ped timers and ped turns — goes through one seeded stream
// (createRandom(seed + 7)), created once in createTraffic. No Math.random()
// anywhere in this file.
import * as THREE from 'three';
import { createRandom, randInt, randRange, randPick } from './random.js';
import { makeCar, updateCarWheels } from './cars.js';

export const TRAFFIC_COUNT = 40;
export const PARKED_COUNT = 32;
export const PED_COUNT = 56;
export const LANE_OFFSET = 3; // right-hand lane offset from the centreline
export const ROAD_HALF = 6;

// Pedestrian body radius for building collision, and the clearance a
// spawn spot must keep from any building footprint.
const PED_RADIUS = 0.5;
const SPAWN_CLEARANCE = 0.8;

// Spawn-cluster sizes: part of the counts above, placed by hand around
// the garage so the first frame is busy (see spawnCluster).
const CLUSTER_TRAFFIC = 2;
const CLUSTER_PARKED = 2;
const CLUSTER_PEDS = 2;

// Respawn bubble: entities further than this from the player are recycled
// onto a road/sidewalk 60-120 m around the player, never closer than 50 m.
const RESPAWN_FAR = 200;
const RESPAWN_MIN = 60;
const RESPAWN_MAX = 120;
const RESPAWN_FLOOR = 50;

const CAR_COLORS = [
  0xd94f4f, 0x4f7ad9, 0x4fd97a, 0xd9c24f, 0x8a6fd9,
  0xd97a4f, 0x9aa2ab, 0x3a3f46, 0xe8e8e8, 0x4fd9c9,
];
const CAR_KINDS = ['sedan', 'sedan', 'sedan', 'taxi', 'sports', 'truck'];
const PED_SHIRTS = [0xd94f4f, 0x4f7ad9, 0x4fd97a, 0xd9c24f, 0x8a6fd9, 0xe8e8e8, 0x2e8b7a, 0xf2a7a7];
const PED_PANTS = [0x2a2f45, 0x3a3f46, 0x5a4a3a, 0x7a8a9a];
const PED_SKINS = [0xe8b88a, 0xc98a5a, 0x8a5a3a, 0xf2d0a8];

// Per-state runtime (the seeded stream), created once in createTraffic.
const runtimes = new WeakMap();

function wantedAdd(n, reason) {
  try {
    if (typeof window.__wantedAdd === 'function') window.__wantedAdd(n, reason);
  } catch { /* a missing police slice must never break a ped hit */ }
}

// --- Road helpers ----------------------------------------------------------
export function pickRoad(rng, lines) {
  return {
    axis: rng() < 0.5 ? 'x' : 'z',
    line: randPick(rng, lines),
    dir: rng() < 0.5 ? 1 : -1,
  };
}

// Centre bias: about half of all spawns land in the middle of the city —
// the road lines near the garage, tower, bank and early missions —
// instead of spreading evenly over the whole road network. A centre
// spawn picks a centre line AND a centre along-coordinate; the rest are
// uniform over the city, so the outskirts stay populated too.
const CENTRE_LINE = 180;
function isCentreSpawn(rng) {
  return rng() < 0.5;
}

function pickRoadBiased(rng, lines, centre) {
  let pool = lines;
  if (centre) {
    const near = lines.filter((c) => Math.abs(c) <= CENTRE_LINE);
    if (near.length > 0) pool = near;
  }
  return {
    axis: rng() < 0.5 ? 'x' : 'z',
    line: randPick(rng, pool),
    dir: rng() < 0.5 ? 1 : -1,
  };
}

// Along-coordinate for a spawn: centre spawns stay within the middle of
// the city, the rest range over the whole road.
function biasedAlong(rng, half, margin, centre) {
  if (centre) return randRange(rng, -CENTRE_LINE, CENTRE_LINE);
  return randRange(rng, -half + margin, half - margin);
}

// Point on a road's right-hand lane at distance `along` down the road.
export function roadPos(road, along) {
  if (road.axis === 'x') return { x: along, z: road.line + LANE_OFFSET * road.dir };
  return { x: road.line - LANE_OFFSET * road.dir, z: along };
}

export function roadHeading(road) {
  if (road.axis === 'x') return road.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return road.dir > 0 ? 0 : Math.PI;
}

// Centreline coordinate of the crossing road near (x, z), or null. For an
// X-road car, a line whose |x - c| <= 2.5; for a Z-road car, |z - c| <= 2.5.
export function crossingNear(pos, lines, axis) {
  if (axis === 'x') {
    for (const c of lines) if (Math.abs(pos.x - c) <= 2.5) return c;
  } else {
    for (const c of lines) if (Math.abs(pos.z - c) <= 2.5) return c;
  }
  return null;
}

// --- Building-footprint helpers (V2) -------------------------------------
// Pedestrians must never be inside a building — not at spawn, and not
// after walking. The sidewalk ring is only ~6 m wide and building edges
// reach into it, so spawn spots and movement both check the footprints.

// The building whose footprint (expanded by `margin`) contains (x, z),
// or null when the point is clear.
function insideBuilding(state, x, z, margin) {
  for (const b of state.city.buildings) {
    if (x > b.minX - margin && x < b.maxX + margin
      && z > b.minZ - margin && z < b.maxZ + margin) return b;
  }
  return null;
}

// Circle (radius r) vs every building AABB, one pass each: push out along
// the delta to the nearest point; if the centre is inside the box, leave
// along the smallest penetration. Same approach as the player collision,
// so a ped slides along a wall instead of passing through it.
function collideBuildings(state, pos, r) {
  for (const b of state.city.buildings) {
    const nx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const nz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const distSq = dx * dx + dz * dz;
    if (distSq >= r * r) continue;
    if (distSq > 0.000001) {
      const dist = Math.sqrt(distSq);
      const push = (r - dist) / dist;
      pos.x += dx * push;
      pos.z += dz * push;
    } else {
      const left = pos.x - b.minX;
      const right = b.maxX - pos.x;
      const top = pos.z - b.minZ;
      const bottom = b.maxZ - pos.z;
      const min = Math.min(left, right, top, bottom);
      if (min === left) pos.x = b.minX - r;
      else if (min === right) pos.x = b.maxX + r;
      else if (min === top) pos.z = b.minZ - r;
      else pos.z = b.maxZ + r;
    }
  }
}

// --- Spawning --------------------------------------------------------------
function spawnTrafficCar(state, scene, rng, fixed) {
  const half = state.city.half;
  const centre = fixed ? false : isCentreSpawn(rng);
  const road = fixed?.road ?? pickRoadBiased(rng, state.city.roadLines, centre);
  const along = fixed?.along ?? biasedAlong(rng, half, 20, centre);
  const p = roadPos(road, along);
  const kind = randPick(rng, CAR_KINDS);
  const color = randPick(rng, CAR_COLORS);
  const car = makeCar(scene, kind, color, new THREE.Vector3(p.x, 0, p.z), roadHeading(road));
  car.driver = 'traffic';
  car.speed = randRange(rng, 6, 11);
  return {
    car,
    road,
    targetSpeed: kind === 'truck' ? 8 : randRange(rng, 9, 13),
    turnCooldown: randRange(rng, 0, 2),
  };
}

function spawnParkedCar(state, scene, rng, fixed) {
  const half = state.city.half;
  const centre = fixed ? false : isCentreSpawn(rng);
  const road = fixed?.road ?? pickRoadBiased(rng, state.city.roadLines, centre);
  const along = fixed?.along ?? biasedAlong(rng, half, 30, centre);
  const side = fixed?.side ?? (rng() < 0.5 ? 1 : -1);
  let x;
  let z;
  if (road.axis === 'x') {
    x = along;
    z = road.line + side * (ROAD_HALF + 1.6);
  } else {
    x = road.line + side * (ROAD_HALF + 1.6);
    z = along;
  }
  // If the spot is not on a road and we are still inside the city, nudge
  // back onto the shoulder.
  if (!state.city.isOnRoad(x, z) && Math.abs(z) < half) {
    if (road.axis === 'x') z = road.line + side * (ROAD_HALF + 0.5);
    else x = road.line + side * (ROAD_HALF + 0.5);
  }
  const kind = randPick(rng, CAR_KINDS);
  const color = randPick(rng, CAR_COLORS);
  const car = makeCar(scene, kind, color, new THREE.Vector3(x, 0, z), roadHeading(road));
  car.driver = null;
  car.parked = true;
  car.speed = 0;
  return car;
}

function sidewalkSpot(state, rng) {
  const half = state.city.half;
  let spot = null;
  // Reject any spot inside (or within SPAWN_CLEARANCE of) a building
  // footprint and pick another one instead; the sidewalk ring is wide,
  // so a valid spot turns up within a few tries. The count and the
  // centre-biased density are unchanged — only the bad spots are redrawn.
  for (let tries = 0; tries < 16; tries += 1) {
    const centre = isCentreSpawn(rng);
    const axis = rng() < 0.5 ? 'x' : 'z';
    const lines = centre
      ? state.city.roadLines.filter((c) => Math.abs(c) <= CENTRE_LINE)
      : state.city.roadLines;
    const line = randPick(rng, lines.length > 0 ? lines : state.city.roadLines);
    const along = biasedAlong(rng, half, 10, centre);
    const side = rng() < 0.5 ? 1 : -1;
    const offset = ROAD_HALF + 2.5 + rng() * 4; // 8.5 - 12.5 m off the centreline
    if (axis === 'x') spot = { x: along, z: line + side * offset };
    else spot = { x: line + side * offset, z: along };
    if (!insideBuilding(state, spot.x, spot.z, SPAWN_CLEARANCE)) return spot;
  }
  return spot;
}

// Shared ped geometries; materials cached per colour.
let pedShared = null;
function getPedShared() {
  if (pedShared) return pedShared;
  const legGeo = new THREE.BoxGeometry(0.2, 0.75, 0.22);
  const torsoGeo = new THREE.BoxGeometry(0.55, 0.65, 0.32);
  const headGeo = new THREE.BoxGeometry(0.36, 0.36, 0.34);
  const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.18);
  const mats = new Map();
  const mat = (color) => {
    let m = mats.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color });
      mats.set(color, m);
    }
    return m;
  };
  pedShared = { legGeo, torsoGeo, headGeo, armGeo, mat };
  return pedShared;
}

function spawnPed(state, scene, rng, fixedSpot) {
  const s = getPedShared();
  const spot = fixedSpot ?? sidewalkSpot(state, rng);
  // Safety net: a fixed cluster spot (or a retry exhaustion) that still
  // lands inside a footprint is pushed to the nearest edge, outside it.
  if (insideBuilding(state, spot.x, spot.z, SPAWN_CLEARANCE)) {
    const probe = { x: spot.x, z: spot.z };
    collideBuildings(state, probe, SPAWN_CLEARANCE);
    spot.x = probe.x;
    spot.z = probe.z;
  }
  const group = new THREE.Group();
  const shirt = s.mat(randPick(rng, PED_SHIRTS));
  const pants = s.mat(randPick(rng, PED_PANTS));
  const skin = s.mat(randPick(rng, PED_SKINS));

  function box(geo, material, x, y, z) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }
  const leftLeg = box(s.legGeo, pants, -0.12, 0.375, 0);
  const rightLeg = box(s.legGeo, pants, 0.12, 0.375, 0);
  const torso = box(s.torsoGeo, shirt, 0, 1.08, 0);
  const head = box(s.headGeo, skin, 0, 1.58, 0);
  const leftArm = box(s.armGeo, shirt, -0.36, 1.08, 0);
  const rightArm = box(s.armGeo, shirt, 0.36, 1.08, 0);

  group.position.set(spot.x, 0, spot.z);
  scene.add(group);
  const walkSpeed = randRange(rng, 1.0, 1.6);
  return {
    mesh: group,
    parts: { leftLeg, rightLeg, leftArm, rightArm, torso, head },
    pos: group.position, // same object as the mesh position
    heading: randRange(rng, 0, Math.PI * 2),
    speed: walkSpeed,
    walkSpeed,
    state: 'walk',
    stateTimer: randRange(rng, 2, 8),
    phase: randRange(rng, 0, Math.PI * 2),
    downTimer: 0,
    health: 100,
    down: false,
    fleeing: false,
  };
}

// --- Spawn cluster -------------------------------------------------------
// Guarantee a busy first frame: 2 parked cars, 2 moving cars and 2 peds
// within ~30 m of the player spawn, placed relative to the garage
// landmark (never hard-coded to a seed). The player spawns at the garage
// front facing south down the road, so the cluster sits on the first road
// south of the garage and the sidewalk in front of it.
function spawnCluster(state, scene, rng, traffic, parkedCars, peds) {
  const garage = state.city.landmarks.garage;
  if (!garage) return;
  const gx = garage.pos.x;
  const gz = garage.pos.z;
  const spawnZ = gz + 18;
  // First road line south of the spawn (the road the player faces).
  const southLines = state.city.roadLines.filter((c) => c > spawnZ);
  if (southLines.length === 0) return;
  const southLine = Math.min(...southLines);
  const road = { axis: 'x', line: southLine, dir: 1 };

  // 2 parked cars on the near (north) shoulder of that road, flanking the
  // spawn — the nearer one ends up ~10 m from the player. A car placed at
  // an exact spot shifts along the road if a random parked car already
  // sits within ~6 m of it.
  for (const dx of [-5, 5]) {
    let along = gx + dx;
    for (let shift = 0; shift < 5; shift += 1) {
      const px = along;
      const pz = southLine - (ROAD_HALF + 1.6);
      const clash = parkedCars.some(
        (c) => Math.hypot(c.pos.x - px, c.pos.z - pz) < 6,
      );
      if (!clash) break;
      along += 8;
    }
    parkedCars.push(spawnParkedCar(state, scene, rng, { road, along, side: -1 }));
  }

  // 2 moving cars on the same road, one each way, in view of the spawn.
  traffic.push(spawnTrafficCar(state, scene, rng, {
    road: { axis: 'x', line: southLine, dir: 1 },
    along: gx - 20,
  }));
  traffic.push(spawnTrafficCar(state, scene, rng, {
    road: { axis: 'x', line: southLine, dir: -1 },
    along: gx + 20,
  }));

  // 2 pedestrians on the sidewalk in front of the garage.
  peds.push(spawnPed(state, scene, rng, { x: gx - 6, z: gz + 24 }));
  peds.push(spawnPed(state, scene, rng, { x: gx + 7, z: gz + 26 }));
}

export function createTraffic(state, scene) {
  // One seeded stream for the whole traffic system: spawns, turn rolls
  // and ped timers all draw from it, so ?seed=N fixes behaviour too.
  const rng = createRandom((state.seed >>> 0) + 7);
  runtimes.set(state, { rng });

  const traffic = [];
  for (let i = 0; i < TRAFFIC_COUNT - CLUSTER_TRAFFIC; i += 1) traffic.push(spawnTrafficCar(state, scene, rng));
  const parkedCars = [];
  for (let i = 0; i < PARKED_COUNT - CLUSTER_PARKED; i += 1) parkedCars.push(spawnParkedCar(state, scene, rng));
  const peds = [];
  for (let i = 0; i < PED_COUNT - CLUSTER_PEDS; i += 1) peds.push(spawnPed(state, scene, rng));
  spawnCluster(state, scene, rng, traffic, parkedCars, peds);

  state.traffic = traffic;
  state.parkedCars = parkedCars;
  state.peds = peds;
  return { traffic, parkedCars, peds };
}

// --- Per-step updates ------------------------------------------------------
function turnOntoCrossing(t, crossLine, left) {
  const car = t.car;
  let heading = car.heading + (left ? Math.PI / 2 : -Math.PI / 2);
  while (heading > Math.PI) heading -= Math.PI * 2;
  while (heading < -Math.PI) heading += Math.PI * 2;
  const newAxis = t.road.axis === 'x' ? 'z' : 'x';
  let dir;
  if (newAxis === 'z') dir = Math.abs(heading) < Math.PI / 2 ? 1 : -1;
  else dir = heading > 0 ? 1 : -1;
  const newRoad = { axis: newAxis, line: crossLine, dir };
  const along = newAxis === 'x' ? car.pos.x : car.pos.z;
  const p = roadPos(newRoad, along);
  car.pos.x = p.x;
  car.pos.z = p.z;
  car.heading = heading;
  t.road = newRoad;
}

function updateTrafficCar(state, t, dt, rng) {
  const car = t.car;
  t.turnCooldown -= dt;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);

  // Target speed: follow the car ahead, slow near the player.
  let target = t.targetSpeed;
  for (const other of state.traffic) {
    if (other === t) continue;
    const dx = other.car.pos.x - car.pos.x;
    const dz = other.car.pos.z - car.pos.z;
    const ahead = dx * fx + dz * fz;
    if (ahead <= 0) continue;
    const lateral = Math.abs(dx * -fz + dz * fx);
    if (lateral < 2.2) {
      if (ahead < 5.5) target = 0;
      else if (ahead < 9) target = Math.min(target, t.targetSpeed * 0.35);
    }
  }
  const pdx = state.player.pos.x - car.pos.x;
  const pdz = state.player.pos.z - car.pos.z;
  const pDist = Math.hypot(pdx, pdz);
  const pAhead = pdx * fx + pdz * fz;
  if (pAhead > 0 && pDist < 14) target = Math.min(target, 3);

  // Ease toward the target: 6 up, 12 down per second.
  if (car.speed < target) car.speed = Math.min(target, car.speed + 6 * dt);
  else if (car.speed > target) car.speed = Math.max(target, car.speed - 12 * dt);
  if (target === 0 && car.speed < 0.05) car.speed = 0;

  // Move along the heading.
  car.pos.x += fx * car.speed * dt;
  car.pos.z += fz * car.speed * dt;
  car._fwdX = fx;
  car._fwdZ = fz;

  // Intersection turn: roll once per crossing (seeded).
  if (t.turnCooldown <= 0 && car.speed > 0.5) {
    const cross = crossingNear(car.pos, state.city.roadLines, t.road.axis);
    if (cross !== null) {
      const roll = rng();
      if (roll < 0.22) {
        turnOntoCrossing(t, cross, roll < 0.11);
        t.turnCooldown = 4;
      } else {
        t.turnCooldown = 1.5;
      }
    }
  }

  // World edge: turn around on the outer ring road instead of leaving.
  const half = state.city.half;
  if (Math.abs(car.pos.x) > half || Math.abs(car.pos.z) > half) {
    t.road.dir = -t.road.dir;
    car.heading = roadHeading(t.road);
    car.pos.x = Math.max(-half, Math.min(half, car.pos.x));
    car.pos.z = Math.max(-half, Math.min(half, car.pos.z));
    t.turnCooldown = 2;
  }

  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
  updateCarWheels(car, dt);
}

function updatePed(state, ped, dt, rng) {
  const half = state.city.half;
  ped.stateTimer -= dt;
  const dx = state.player.pos.x - ped.pos.x;
  const dz = state.player.pos.z - ped.pos.z;
  const dist = Math.hypot(dx, dz);

  // Combat fields (§9.4): a punched ped feeds into the canonical states.
  // `down` (health <= 0) lies flat, then gets up into 'flee'; `fleeing`
  // runs away. Both flags are consumed here so they fire exactly once.
  if (ped.down === true && ped.state !== 'down') {
    ped.down = false;
    ped.state = 'down';
    ped.downTimer = 3;
  } else if (ped.fleeing === true && ped.state !== 'flee') {
    ped.fleeing = false;
    ped.state = 'flee';
    ped.stateTimer = 2.5;
  }
  if (ped.health !== undefined && ped.health <= 0 && ped.state !== 'down') {
    ped.state = 'down';
    ped.downTimer = 3;
  }

  if (ped.state === 'down') {
    // Lie flat; get up into a flee when the timer runs out.
    ped.downTimer -= dt;
    ped.mesh.rotation.x = -Math.PI / 2 + Math.max(0, ped.downTimer) * 0.1;
    if (ped.downTimer <= 0) {
      ped.state = 'flee';
      ped.stateTimer = 3;
      ped.mesh.rotation.x = 0;
    }
  } else {
    // Flee trigger: a fast player car nearby, or any wanted heat close in.
    const drivingFast = !!state.player.car && Math.abs(state.player.car.speed) > 8;
    if (ped.state !== 'flee' && dist < 14 && (drivingFast || (state.wanted > 0 && dist < 10))) {
      ped.state = 'flee';
      ped.stateTimer = 2.5;
    }

    if (ped.state === 'flee') {
      // Run directly away from the player at 4.2 m/s.
      const away = Math.atan2(-dx, -dz);
      let diff = away - ped.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ped.heading += diff * Math.min(1, 8 * dt);
      ped.speed = 4.2;
      if (ped.stateTimer <= 0) {
        ped.state = 'walk';
        ped.stateTimer = randRange(rng, 2, 8);
        ped.speed = ped.walkSpeed;
      }
    } else {
      // Walk along the block edge; occasionally turn +/-90 degrees.
      ped.speed = ped.walkSpeed;
      if (ped.stateTimer <= 0) {
        ped.stateTimer = randRange(rng, 3, 9);
        if (rng() < 0.4) ped.heading += (rng() < 0.5 ? 1 : -1) * (Math.PI / 2);
      }
    }

    // Move along the heading; keep out of building footprints the same
    // way the player is kept out (slide along the wall, never pass
    // through), then turn around at the city + beach bounds.
    ped.pos.x += Math.sin(ped.heading) * ped.speed * dt;
    ped.pos.z += Math.cos(ped.heading) * ped.speed * dt;
    collideBuildings(state, ped.pos, PED_RADIUS);
    if (ped.pos.x < -half - 10 || ped.pos.x > half + 10
      || ped.pos.z < -half - 10 || ped.pos.z > half + 50) {
      ped.heading += Math.PI;
      ped.pos.x = Math.max(-half - 10, Math.min(half + 10, ped.pos.x));
      ped.pos.z = Math.max(-half - 10, Math.min(half + 50, ped.pos.z));
    }

    // Hit by the player's car: knocked down, +1 wanted (once per hit —
    // the ped is 'down' afterwards, so it cannot re-trigger until it
    // gets up).
    if (state.player.car && Math.abs(state.player.car.speed) > 2) {
      const cdx = ped.pos.x - state.player.car.pos.x;
      const cdz = ped.pos.z - state.player.car.pos.z;
      if (Math.hypot(cdx, cdz) < 1.8) {
        ped.state = 'down';
        ped.downTimer = 3;
        wantedAdd(1, 'hit pedestrian');
      }
    }
  }

  // Walk cycle + mesh sync (flat while down, upright otherwise).
  if (ped.state === 'down') {
    ped.mesh.rotation.x = -Math.PI / 2 + Math.max(0, ped.downTimer) * 0.1;
  } else {
    ped.mesh.rotation.x = 0;
    ped.phase += dt * ped.speed * 3.2;
    const swing = Math.sin(ped.phase) * 0.5;
    ped.parts.leftLeg.rotation.x = swing;
    ped.parts.rightLeg.rotation.x = -swing;
    ped.parts.leftArm.rotation.x = -swing * 0.7;
    ped.parts.rightArm.rotation.x = swing * 0.7;
  }
  ped.mesh.position.copy(ped.pos);
  ped.mesh.rotation.y = ped.heading;
}

// --- Near-player respawn bubble -------------------------------------------
// A point 60-120 m around the player, clamped inside the city, snapped to
// the nearest road. Returns { x, z, road } (road is the snapped road) or
// null when no road is near enough. Never closer than ~50 m to the
// player, so nothing pops in on top of the camera.
function bubbleSpot(state, rng) {
  const half = state.city.half;
  const p = state.player.pos;
  const lines = state.city.roadLines.filter((c) => Math.abs(c) <= half);
  if (lines.length === 0) return null;
  for (let tries = 0; tries < 10; tries += 1) {
    const angle = randRange(rng, 0, Math.PI * 2);
    const radius = randRange(rng, RESPAWN_MIN, RESPAWN_MAX);
    const tx = Math.max(-half + 20, Math.min(half - 20, p.x + Math.sin(angle) * radius));
    const tz = Math.max(-half + 20, Math.min(half - 20, p.z + Math.cos(angle) * radius));
    // Nearest road line to the target, in either direction.
    let bestLine = null;
    let bestAxis = 'x';
    let bestDist = Infinity;
    for (const c of lines) {
      const dz = Math.abs(tz - c);
      if (dz < bestDist) { bestDist = dz; bestLine = c; bestAxis = 'x'; }
      const dx = Math.abs(tx - c);
      if (dx < bestDist) { bestDist = dx; bestLine = c; bestAxis = 'z'; }
    }
    if (bestLine === null || bestDist > 60) continue;
    const dir = rng() < 0.5 ? 1 : -1;
    const road = { axis: bestAxis, line: bestLine, dir };
    const along = bestAxis === 'x' ? tx : tz;
    const spot = roadPos(road, along);
    if (Math.hypot(spot.x - p.x, spot.z - p.z) < RESPAWN_FLOOR) continue;
    return { x: spot.x, z: spot.z, road };
  }
  return null;
}

// Recycle one moving traffic car onto a road near the player.
function respawnTrafficCar(state, t, rng) {
  const spot = bubbleSpot(state, rng);
  if (!spot) return false;
  t.road = spot.road;
  t.car.pos.set(spot.x, 0, spot.z);
  t.car.heading = roadHeading(spot.road);
  t.car.speed = randRange(rng, 6, 11);
  t.turnCooldown = randRange(rng, 0, 2);
  t.car.mesh.position.copy(t.car.pos);
  t.car.mesh.rotation.y = t.car.heading;
  return true;
}

// Recycle one pedestrian onto a sidewalk near the player.
function respawnPed(state, ped, rng) {
  const spot = bubbleSpot(state, rng);
  if (!spot) return false;
  const offset = ROAD_HALF + 2.5 + rng() * 4;
  // Try both sides of the road; if neither side is clear of buildings,
  // skip the respawn (retried next frame) rather than placing a ped
  // inside a footprint.
  const sides = rng() < 0.5 ? [1, -1] : [-1, 1];
  for (const side of sides) {
    let x;
    let z;
    if (spot.road.axis === 'x') {
      x = spot.x;
      z = spot.road.line + side * offset;
    } else {
      x = spot.road.line + side * offset;
      z = spot.z;
    }
    if (insideBuilding(state, x, z, SPAWN_CLEARANCE)) continue;
    if (Math.hypot(x - state.player.pos.x, z - state.player.pos.z) < RESPAWN_FLOOR) return false;
    ped.pos.set(x, 0, z);
    ped.heading = randRange(rng, 0, Math.PI * 2);
    ped.stateTimer = randRange(rng, 2, 8);
    ped.mesh.position.copy(ped.pos);
    ped.mesh.rotation.y = ped.heading;
    return true;
  }
  return false;
}

export function updateTraffic(state, dt) {
  let rt = runtimes.get(state);
  if (!rt) {
    // Defensive: updateTraffic before createTraffic still stays seeded.
    rt = { rng: createRandom((state.seed >>> 0) + 7) };
    runtimes.set(state, rt);
  }
  const rng = rt.rng;
  for (const t of state.traffic) {
    updateTrafficCar(state, t, dt, rng);
    // Near-player bubble: a car that drifted far from the player respawns
    // on a road 60-120 m around them, keeping the streets busy.
    const d = Math.hypot(t.car.pos.x - state.player.pos.x, t.car.pos.z - state.player.pos.z);
    if (d > RESPAWN_FAR) respawnTrafficCar(state, t, rng);
  }
  for (const ped of state.peds) {
    updatePed(state, ped, dt, rng);
    // Same bubble for pedestrians — but never teleport one who is knocked
    // down flat (they get up and flee where they fell).
    if (ped.state === 'down' || ped.down === true) continue;
    const d = Math.hypot(ped.pos.x - state.player.pos.x, ped.pos.z - state.player.pos.z);
    if (d > RESPAWN_FAR) respawnPed(state, ped, rng);
  }
}
