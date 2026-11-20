// Neon Bay — traffic cars, parked cars and pedestrians. One job: fill the
// roads with cars that follow the grid (lane, turn at intersections, stop
// behind the car ahead, slow near the player), park stealable cars along
// road edges, and walk pedestrians on the sidewalks who flee from a fast
// car or a crime and fall when a player-driven car hits them.
//
// Traffic cars keep a lane: they drive along one road centreline at a fixed
// offset, and at an intersection they may turn onto the crossing road.
// Pedestrians walk along block edges and cross at corners occasionally.

import * as THREE from 'three';
import { makeCar } from './cars.js';
import { createRandom, randInt, randPick, randRange } from './random.js';

const TRAFFIC_COUNT = 14;
const PARKED_COUNT = 8;
const PED_COUNT = 16;
const LANE_OFFSET = 3; // right-hand lane offset from the centreline
const ROAD_HALF = 6; // half the road width

const CAR_COLORS = [0xd94f4f, 0x4f7ad9, 0x4fd97a, 0xd9c24f, 0x8a6fd9, 0xd97a4f, 0x9aa2ab, 0x3a3f46, 0xe8e8e8, 0x4fd9c9];
const CAR_KINDS = ['sedan', 'sedan', 'sedan', 'taxi', 'sports', 'truck'];
const PED_SHIRTS = [0xd94f4f, 0x4f7ad9, 0x4fd97a, 0xd9c24f, 0xe8e8e8, 0x8a6fd9, 0xf2a7a7, 0x2e8b7a];
const PED_PANTS = [0x2a2f45, 0x3a3f46, 0x6b5a4a, 0x2f4a3a];
const PED_SKINS = [0xe8b88a, 0xc98a5a, 0x8a5a3a, 0xf2c9a0];

// --- Shared pedestrian geometry/materials (one build, reused) --------------
let pedShared = null;
function getPedShared() {
  if (pedShared) return pedShared;
  pedShared = {
    legGeo: new THREE.BoxGeometry(0.2, 0.75, 0.22),
    torsoGeo: new THREE.BoxGeometry(0.55, 0.65, 0.32),
    headGeo: new THREE.BoxGeometry(0.36, 0.36, 0.34),
    armGeo: new THREE.BoxGeometry(0.16, 0.6, 0.18),
    shirtMats: new Map(),
    pantsMats: new Map(),
    skinMats: new Map(),
  };
  return pedShared;
}

function pedMat(map, color) {
  if (!map.has(color)) map.set(color, new THREE.MeshLambertMaterial({ color }));
  return map.get(color);
}

function makePedMesh(rng) {
  const s = getPedShared();
  const shirt = pedMat(s.shirtMats, randPick(rng, PED_SHIRTS));
  const pants = pedMat(s.pantsMats, randPick(rng, PED_PANTS));
  const skin = pedMat(s.skinMats, randPick(rng, PED_SKINS));
  const group = new THREE.Group();
  const leftLeg = new THREE.Mesh(s.legGeo, pants);
  leftLeg.position.set(-0.13, 0.38, 0);
  const rightLeg = new THREE.Mesh(s.legGeo, pants);
  rightLeg.position.set(0.13, 0.38, 0);
  const torso = new THREE.Mesh(s.torsoGeo, shirt);
  torso.position.set(0, 1.08, 0);
  const leftArm = new THREE.Mesh(s.armGeo, shirt);
  leftArm.position.set(-0.37, 1.08, 0);
  const rightArm = new THREE.Mesh(s.armGeo, shirt);
  rightArm.position.set(0.37, 1.08, 0);
  const head = new THREE.Mesh(s.headGeo, skin);
  head.position.set(0, 1.62, 0);
  for (const m of [leftLeg, rightLeg, torso, leftArm, rightArm, head]) {
    m.castShadow = true;
    group.add(m);
  }
  return { group, parts: { leftLeg, rightLeg, leftArm, rightArm } };
}

function wantedAdd(stars, reason) {
  if (typeof window !== 'undefined' && typeof window.__wantedAdd === 'function') {
    window.__wantedAdd(stars, reason);
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// --- Traffic cars -----------------------------------------------------------

/**
 * Pick a road to drive on: an axis ('x' = along X at fixed z, 'z' = along Z
 * at fixed x), a centreline coordinate from the city's road lines, and a
 * travel direction. The lane offset keeps the car on the right-hand side.
 */
function pickRoad(rng, lines) {
  const axis = rng() < 0.5 ? 'x' : 'z';
  const line = randPick(rng, lines);
  const dir = rng() < 0.5 ? 1 : -1;
  return { axis, line, dir };
}

function roadPos(road, along) {
  if (road.axis === 'x') return { x: along, z: road.line + LANE_OFFSET * road.dir };
  return { x: road.line - LANE_OFFSET * road.dir, z: along };
}

function roadHeading(road) {
  // Forward = (sin h, cos h): along +X is h = PI/2, along +Z is h = 0.
  if (road.axis === 'x') return road.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return road.dir > 0 ? 0 : Math.PI;
}

/** Build one moving traffic car on a random road. */
function spawnTrafficCar(state, scene, rng) {
  const lines = state.city.roadLines;
  const half = state.city.half;
  const road = pickRoad(rng, lines);
  const along = randRange(rng, -half + 20, half - 20);
  const { x, z } = roadPos(road, along);
  const kind = randPick(rng, CAR_KINDS);
  const car = makeCar(scene, kind, randPick(rng, CAR_COLORS),
    new THREE.Vector3(x, 0, z), roadHeading(road));
  car.driver = 'traffic';
  car.speed = randRange(rng, 6, 11);
  return {
    car,
    road,
    targetSpeed: car.kind === 'truck' ? 8 : randRange(rng, 9, 13),
    turnCooldown: 0,
  };
}

/** Build one parked car along a road edge (stealable, driver null). */
function spawnParkedCar(state, scene, rng) {
  const lines = state.city.roadLines;
  const half = state.city.half;
  const road = pickRoad(rng, lines);
  const along = randRange(rng, -half + 30, half - 30);
  // Park at the road edge, just outside the driving lane.
  const edge = ROAD_HALF + 1.6;
  let x;
  let z;
  if (road.axis === 'x') { x = along; z = road.line + edge * (rng() < 0.5 ? 1 : -1); }
  else { x = road.line + edge * (rng() < 0.5 ? 1 : -1); z = along; }
  // Never park inside a building or on the beach road's sand side.
  if (!state.city.isOnRoad(x, z) && Math.abs(z) < half) {
    // nudge back onto the road shoulder
    if (road.axis === 'x') z = road.line + (z > road.line ? ROAD_HALF + 0.5 : -ROAD_HALF - 0.5);
    else x = road.line + (x > road.line ? ROAD_HALF + 0.5 : -ROAD_HALF - 0.5);
  }
  const kind = randPick(rng, CAR_KINDS);
  const car = makeCar(scene, kind, randPick(rng, CAR_COLORS),
    new THREE.Vector3(x, 0, z), roadHeading(road));
  car.driver = null;
  car.parked = true;
  car.speed = 0;
  return car;
}

// --- Pedestrians ------------------------------------------------------------

/** A sidewalk spot: just outside a road, on a block edge. */
function sidewalkSpot(state, rng) {
  const lines = state.city.roadLines;
  const half = state.city.half;
  const line = randPick(rng, lines);
  const along = randRange(rng, -half + 10, half - 10);
  const side = rng() < 0.5 ? 1 : -1;
  const off = ROAD_HALF + 2.5 + rng() * 4;
  if (rng() < 0.5) return { x: along, z: line + off * side };
  return { x: line + off * side, z: along };
}

function spawnPed(state, scene, rng) {
  const spot = sidewalkSpot(state, rng);
  const { group, parts } = makePedMesh(rng);
  const heading = rng() * Math.PI * 2;
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = heading;
  scene.add(group);
  return {
    mesh: group,
    parts,
    pos: new THREE.Vector3(spot.x, 0, spot.z),
    heading,
    speed: randRange(rng, 1.0, 1.6),
    walkSpeed: randRange(rng, 1.0, 1.6),
    state: 'walk', // 'walk' | 'flee' | 'down'
    stateTimer: randRange(rng, 2, 8),
    phase: rng() * Math.PI * 2,
    downTimer: 0,
  };
}

// --- Public API -------------------------------------------------------------

/**
 * Spawn the traffic: ~14 moving cars, ~8 parked cars, ~16 pedestrians.
 * Deterministic from state.seed so a ?seed=N world always has the same
 * traffic. Results live on state.traffic / state.parkedCars / state.peds.
 */
export function createTraffic(state, scene) {
  const rng = createRandom((state.seed >>> 0) + 7);
  state.traffic = [];
  state.parkedCars = [];
  state.peds = [];
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    state.traffic.push(spawnTrafficCar(state, scene, rng));
  }
  for (let i = 0; i < PARKED_COUNT; i += 1) {
    state.parkedCars.push(spawnParkedCar(state, scene, rng));
  }
  for (let i = 0; i < PED_COUNT; i += 1) {
    state.peds.push(spawnPed(state, scene, rng));
  }
  return { traffic: state.traffic, parkedCars: state.parkedCars, peds: state.peds };
}

/**
 * Step all traffic and pedestrians one fixed step. `state.traffic` entries
 * are { car, road, targetSpeed }; peds are { mesh, pos, heading, state }.
 */
export function updateTraffic(state, dt) {
  const half = state.city.half;
  const lines = state.city.roadLines;
  const player = state.player;
  const playerCar = !player.onFoot && player.car ? player.car : null;

  // --- Moving traffic cars -------------------------------------------------
  for (const t of state.traffic) {
    const car = t.car;
    if (!car || !car.pos) continue;
    t.turnCooldown = Math.max(0, t.turnCooldown - dt);

    // Target speed: slow for the car ahead, slow near the player.
    let target = t.targetSpeed;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    // Car ahead in the same lane: stop behind it.
    let nearestAhead = Infinity;
    for (const other of state.traffic) {
      if (other === t || !other.car || !other.car.pos) continue;
      const dx = other.car.pos.x - car.pos.x;
      const dz = other.car.pos.z - car.pos.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < nearestAhead && side < 2.2) nearestAhead = ahead;
    }
    if (nearestAhead < 9) target = nearestAhead < 5.5 ? 0 : t.targetSpeed * 0.35;
    // Slow near the player (on foot or driving) so traffic feels alive.
    const pdx = player.pos.x - car.pos.x;
    const pdz = player.pos.z - car.pos.z;
    const pAhead = pdx * fx + pdz * fz;
    const pDist = Math.hypot(pdx, pdz);
    if (pAhead > 0 && pAhead < 14 && pDist < 14) target = Math.min(target, 3);
    // Ease toward the target speed.
    const accel = target > car.speed ? 6 : 12;
    car.speed += Math.max(-accel * dt, Math.min(accel * dt, target - car.speed));
    if (car.speed < 0.05 && target === 0) car.speed = 0;

    car.pos.x += fx * car.speed * dt;
    car.pos.z += fz * car.speed * dt;

    // At an intersection (near a crossing centreline), maybe turn.
    if (t.turnCooldown <= 0 && car.speed > 0.5) {
      const cross = crossingNear(car.pos, lines, t.road.axis);
      if (cross !== null) {
        const roll = Math.random();
        if (roll < 0.22) {
          // Turn left or right onto the crossing road.
          const turn = roll < 0.11 ? 1 : -1;
          const newAxis = t.road.axis === 'x' ? 'z' : 'x';
          const newLine = cross;
          const newDir = turn * (t.road.dir > 0 ? 1 : -1) * (newAxis === 'x' ? 1 : -1);
          // Snap onto the new lane so the car stays centred on the road.
          const lane = LANE_OFFSET * newDir;
          if (newAxis === 'x') {
            car.pos.z = newLine + lane;
            car.pos.x = Math.max(-half, Math.min(half, car.pos.x));
          } else {
            car.pos.x = newLine - lane;
            car.pos.z = Math.max(-half, Math.min(half, car.pos.z));
          }
          t.road = { axis: newAxis, line: newLine, dir: newDir };
          car.heading = roadHeading(t.road);
          t.turnCooldown = 4;
        } else {
          t.turnCooldown = 1.5; // don't re-roll every frame at this crossing
        }
      }
    }

    // World edge: turn around at the outer ring road instead of leaving.
    if (car.pos.x < -half || car.pos.x > half || car.pos.z < -half || car.pos.z > half) {
      t.road.dir *= -1;
      car.heading = roadHeading(t.road);
      car.pos.x = Math.max(-half, Math.min(half, car.pos.x));
      car.pos.z = Math.max(-half, Math.min(half, car.pos.z));
      t.turnCooldown = 2;
    }

    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = car.heading;
    if (car.wheels) {
      const spin = (car.speed * dt) / 0.36;
      for (const w of car.wheels) {
        if (w.children[0]) w.children[0].rotation.x += spin;
      }
    }
  }

  // --- Pedestrians -----------------------------------------------------------
  for (const ped of state.peds) {
    if (!ped.pos) continue;
    ped.stateTimer -= dt;

    if (ped.state === 'down') {
      ped.downTimer -= dt;
      // Lie flat, then get up and walk away.
      ped.mesh.rotation.x = -Math.PI / 2 + Math.max(0, ped.downTimer) * 0.1;
      if (ped.downTimer <= 0) {
        ped.state = 'flee';
        ped.stateTimer = 3;
        ped.mesh.rotation.x = 0;
      }
      continue;
    }

    // Flee: player driving fast nearby, or a wanted crime just happened
    // near the pedestrian.
    const dx = ped.pos.x - player.pos.x;
    const dz = ped.pos.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    const playerFast = playerCar && Math.abs(playerCar.speed) > 8;
    if (ped.state !== 'flee' && dist < 14 && (playerFast || (state.wanted > 0 && dist < 10))) {
      ped.state = 'flee';
      ped.stateTimer = 2.5;
    }
    if (ped.state === 'flee' && ped.stateTimer <= 0) {
      ped.state = 'walk';
      ped.stateTimer = randRange(Math.random, 2, 8);
      ped.speed = ped.walkSpeed;
    }

    if (ped.state === 'flee') {
      // Run directly away from the player.
      const len = dist || 1;
      const tx = dx / len;
      const tz = dz / len;
      const targetHeading = Math.atan2(tx, tz);
      ped.heading += wrapAngle(targetHeading - ped.heading) * Math.min(1, 8 * dt);
      ped.speed = 4.2;
    } else {
      // Walk along the block edge; at a corner, sometimes turn.
      if (ped.stateTimer <= 0) {
        ped.stateTimer = randRange(Math.random, 3, 9);
        if (Math.random() < 0.4) ped.heading += (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
      }
      ped.speed = ped.walkSpeed;
    }

    ped.pos.x += Math.sin(ped.heading) * ped.speed * dt;
    ped.pos.z += Math.cos(ped.heading) * ped.speed * dt;
    // Keep pedestrians inside the city + beach; bounce off the edge.
    if (ped.pos.x < -half - 10 || ped.pos.x > half + 10 || ped.pos.z < -half - 10 || ped.pos.z > half + 50) {
      ped.heading += Math.PI;
      ped.pos.x = Math.max(-half - 10, Math.min(half + 10, ped.pos.x));
      ped.pos.z = Math.max(-half - 10, Math.min(half + 50, ped.pos.z));
    }

    // Hit by the player's car: fall down, wanted +1 (once per hit).
    if (playerCar && Math.abs(playerCar.speed) > 2 && dist < 1.8) {
      ped.state = 'down';
      ped.downTimer = 3;
      wantedAdd(1, 'hit pedestrian');
    }

    // Walk cycle: legs and arms swing.
    ped.phase += dt * ped.speed * 3.2;
    const swing = Math.sin(ped.phase) * 0.5;
    ped.parts.leftLeg.rotation.x = swing;
    ped.parts.rightLeg.rotation.x = -swing;
    ped.parts.leftArm.rotation.x = -swing * 0.7;
    ped.parts.rightArm.rotation.x = swing * 0.7;
    ped.mesh.position.copy(ped.pos);
    ped.mesh.rotation.y = ped.heading;
    if (ped.state !== 'down') ped.mesh.rotation.x = 0;
  }
}

/**
 * The centreline coordinate of the crossing road near (x, z), or null when
 * the point is not at an intersection. A car on an X-road (fixed z) crosses
 * a Z-road when its x is near a line; a car on a Z-road crosses an X-road
 * when its z is near a line. `axis` is the road the car is travelling on.
 */
export function crossingNear(pos, lines, axis) {
  if (axis === 'x') {
    for (const c of lines) {
      if (Math.abs(pos.x - c) <= 2.5) return c;
    }
    return null;
  }
  for (const c of lines) {
    if (Math.abs(pos.z - c) <= 2.5) return c;
  }
  return null;
}
