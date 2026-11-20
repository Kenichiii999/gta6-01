// Wanted stars, police chase AI, foot cops, arrest, busted / wasted.
// One job: own the heat. Wanted stars 0-5, police cars that chase on the
// road grid and ram, foot cops that run the player down and arrest,
// wanted decay when the heat is off, and the busted / wasted flows (cash
// penalty + respawn + wanted cleared). Self-contained apart from the car
// factory: police cars are built with cars.js makePoliceCar (DESIGN.md
// §9.7), foot cops are built here.
//
// Determinism (§9.13): spawn positions, siren phase and cop walk phase
// all draw from one seeded stream (createRandom(seed + 13)), created
// once in createPolice. No Math.random() anywhere in this file.
import * as THREE from 'three';
import { createRandom, randRange } from './random.js';
import { makePoliceCar, updateCarWheels } from './cars.js';
import { SCREEN_BUSTED, SCREEN_PLAY, SCREEN_WASTED } from './render.js';

export const WANTED_MAX = 5;
export const DECAY_SECONDS = 20; // -1 star per 20 s with no police near
export const DECAY_CLEAR_DIST = 80; // "no police within" radius (m)
export const MAX_POLICE_CARS = 3;
export const FOOT_COPS_AT_STARS = 3; // 2 foot cops once wanted >= 3
export const FOOT_COP_COUNT = 2;
export const CAR_CHASE_SPEED = 16; // m/s
export const CAR_RAM_RANGE = 3.6;
export const CAR_RAM_DAMAGE = 5; // health lost when rammed on foot
export const CAR_DEPLOY_RANGE = 8; // car stops, a cop gets out, when closer
export const COP_RUN_SPEED = 6.5; // m/s (walk 5, run 9: cops catch walkers)
export const COP_HEALTH = 100;
export const COP_PUNCH_DAMAGE = 10;
export const COP_PUNCH_RANGE = 1.6;
export const COP_PUNCH_COOLDOWN = 1.2;
export const ARREST_DIST = 2; // cop within 2 m...
export const ARREST_TIME = 2; // ...for 2 continuous seconds = busted
export const BUSTED_CASH_LOSS = 0.2;
export const WASTED_CASH_LOSS = 0.1;
export const DESPAWN_DIST_CAR = 140;
export const DESPAWN_DIST_FOOT = 100;

// Module-level decay override (a playtest/test hook only); the shipped
// value stays 20 s and nothing in the game changes it.
let decaySeconds = DECAY_SECONDS;
export function setPoliceDecaySeconds(s) {
  decaySeconds = Math.max(0.1, s);
}

// Per-state context (scene + seeded stream + decay timer + overlays),
// keyed by state; state.police stays the plain unit array.
const contexts = new WeakMap();
// The live game state, for the busted/wasted resume listener (one game).
let activeState = null;
let resumeListenerAdded = false;

function sfx(name) {
  try {
    if (typeof window.__sfx === 'function') window.__sfx(name);
  } catch { /* a missing audio slice must never break a police event */ }
}

// Sets state.shakeTime; the camera consumes it (render.js updateCamera
// 4th arg) and main.js decays it. Purely visual, never moves the player.
function shake(state, amount) {
  state.shakeTime = Math.max(state.shakeTime || 0, amount);
}

// --- Wanted ---------------------------------------------------------------
export function addWanted(state, n, reason) {
  const before = state.wanted || 0;
  const after = Math.max(0, Math.min(WANTED_MAX, before + n));
  state.wanted = after;
  if (reason !== undefined) state.lastWantedReason = reason;
  // A fresh increase plays the siren sting (audio implements the case).
  if (n > 0 && after > before) sfx('siren');
}

// --- Shared helpers -------------------------------------------------------
function turnToward(heading, target, rate, dt) {
  let diff = target - heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return heading + Math.max(-rate * dt, Math.min(rate * dt, diff));
}

function easeSpeed(speed, target, rate, dt) {
  if (speed < target) return Math.min(target, speed + rate * dt);
  return Math.max(target, speed - rate * dt);
}

function nearestRoadLine(lines, v) {
  let best = lines[0];
  let bestDist = Infinity;
  for (const c of lines) {
    const d = Math.abs(c - v);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

// Circle (radius r) vs every building AABB push-out, same approach as
// the player slice. Used by foot cops (and only them: police cars stay
// on the road grid and have no building collision).
function collideBuildings(state, pos, r) {
  for (const b of state.city.buildings) {
    const nx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const nz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    let dx = pos.x - nx;
    let dz = pos.z - nz;
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

// --- Foot-cop mesh (shared geometries/materials, built once) --------------
let copShared = null;
function getCopShared() {
  if (copShared) return copShared;
  const legGeo = new THREE.BoxGeometry(0.22, 0.8, 0.24);
  const shoeGeo = new THREE.BoxGeometry(0.24, 0.12, 0.42);
  const torsoGeo = new THREE.BoxGeometry(0.62, 0.72, 0.34);
  const armGeo = new THREE.BoxGeometry(0.18, 0.68, 0.2);
  const headGeo = new THREE.BoxGeometry(0.4, 0.4, 0.38);
  const capGeo = new THREE.BoxGeometry(0.46, 0.1, 0.44);
  const bandGeo = new THREE.BoxGeometry(0.47, 0.05, 0.45);
  const badgeGeo = new THREE.BoxGeometry(0.12, 0.12, 0.05);
  const mats = new Map();
  const mat = (color) => {
    let m = mats.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color });
      mats.set(color, m);
    }
    return m;
  };
  copShared = {
    legGeo, shoeGeo, torsoGeo, armGeo, headGeo, capGeo, bandGeo, badgeGeo, mat,
  };
  return copShared;
}

// Navy uniform, same proportions as the player mesh, plus a gold badge
// and a gold cap band.
function buildCopMesh() {
  const s = getCopShared();
  const navy = s.mat(0x1f2f52);
  const darkNavy = s.mat(0x16233d);
  const skin = s.mat(0xe8b88a);
  const gold = s.mat(0xc9a227);
  const group = new THREE.Group();
  function box(geo, material, x, y, z) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }
  const leftLeg = box(s.legGeo, darkNavy, -0.14, 0.4, 0);
  const rightLeg = box(s.legGeo, darkNavy, 0.14, 0.4, 0);
  box(s.shoeGeo, darkNavy, -0.14, 0.06, 0.06);
  box(s.shoeGeo, darkNavy, 0.14, 0.06, 0.06);
  const torso = box(s.torsoGeo, navy, 0, 1.16, 0);
  const leftArm = box(s.armGeo, navy, -0.42, 1.16, 0);
  const rightArm = box(s.armGeo, navy, 0.42, 1.16, 0);
  const head = box(s.headGeo, skin, 0, 1.78, 0);
  box(s.capGeo, darkNavy, 0, 2.0, 0);
  box(s.bandGeo, gold, 0, 1.96, 0);
  box(s.badgeGeo, gold, -0.18, 1.3, 0.18);
  return { group, parts: { leftLeg, rightLeg, leftArm, rightArm, torso, head } };
}

// --- Spawning -------------------------------------------------------------
// Random point at `dist` from the player, snapped onto the road grid
// (whichever axis is closer to a road line moves onto that line).
function spawnPosNearPlayer(state, rng, dist) {
  const half = state.city.half;
  const a = rng() * Math.PI * 2;
  let x = state.player.pos.x + Math.sin(a) * dist;
  let z = state.player.pos.z + Math.cos(a) * dist;
  const lineX = nearestRoadLine(state.city.roadLines, x);
  const lineZ = nearestRoadLine(state.city.roadLines, z);
  if (Math.abs(x - lineX) <= Math.abs(z - lineZ)) x = lineX;
  else z = lineZ;
  x = Math.max(-half - 40, Math.min(half + 40, x));
  z = Math.max(-half - 6, Math.min(half + 40, z));
  return { x, z };
}

function spawnPoliceCar(state, ctx) {
  const p = spawnPosNearPlayer(state, ctx.rng, randRange(ctx.rng, 50, 70));
  const car = makePoliceCar(ctx.scene, new THREE.Vector3(p.x, 0, p.z), 0);
  const unit = {
    kind: 'car',
    counted: true,
    car,
    group: car.mesh,
    pos: car.pos, // same object as the mesh position
    heading: car.heading,
    speed: 0,
    siren: ctx.rng() * Math.PI * 2, // seeded light-bar phase
    red: car.lightBarRed,
    blue: car.lightBarBlue,
    stuckTime: 0,
    sampleT: 0,
    lastX: p.x,
    lastZ: p.z,
    reverseT: 0,
    ramCooldown: 0,
    deployed: false,
    disengage: false,
    remove: false,
  };
  state.police.push(unit);
  return unit;
}

function spawnFootCop(state, ctx, pos, counted) {
  const { group, parts } = buildCopMesh();
  group.position.set(pos.x, 0, pos.z);
  ctx.scene.add(group);
  const unit = {
    kind: 'foot',
    counted,
    group,
    parts,
    pos: group.position, // same object as the mesh position
    heading: ctx.rng() * Math.PI * 2,
    speed: 0,
    health: COP_HEALTH,
    walkPhase: ctx.rng() * Math.PI * 2, // seeded walk cycle
    punchCooldown: 0,
    arrestTimer: 0,
    down: false,
    downTimer: 0,
    disengage: false,
    remove: false,
  };
  group.rotation.y = unit.heading;
  state.police.push(unit);
  return unit;
}

// --- Busted / wasted ------------------------------------------------------
function makeOverlay(id, title, color, sub) {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'screen';
  el.style.display = 'none';
  el.style.zIndex = '30';
  const h1 = document.createElement('h1');
  h1.textContent = title;
  h1.style.color = color;
  const subEl = document.createElement('p');
  subEl.textContent = sub;
  const penalty = document.createElement('p');
  penalty.className = 'penalty';
  const hint = document.createElement('p');
  hint.textContent = 'Press Enter to keep playing.';
  el.append(h1, subEl, penalty, hint);
  document.body.appendChild(el);
  return { el, penalty };
}

function clearPolice(state) {
  const ctx = contexts.get(state);
  for (const u of state.police) {
    if (ctx && u.group) ctx.scene.remove(u.group);
  }
  state.police.length = 0;
}

function respawn(state, landmarkKey, screen, overlayKey, lost, lossFrac) {
  // Detach from any car: the player respawns on foot and the car stays
  // where it was left as a parked car.
  if (state.player.car) {
    const car = state.player.car;
    car.driver = null;
    car.parked = true;
    car.speed = 0;
    state.parkedCars.push(car);
  }
  state.player.car = null;
  state.player.onFoot = true;
  state.player.speed = 0;
  const lm = state.city.landmarks[landmarkKey];
  const base = lm ? lm.pos : new THREE.Vector3(0, 0, 0);
  state.player.pos.set(base.x + 26, 0, base.z + 26);
  state.player.heading = Math.PI;
  if (state.player.mesh) {
    state.player.mesh.visible = true;
    state.player.mesh.position.copy(state.player.pos);
    state.player.mesh.rotation.y = state.player.heading;
  }
  clearPolice(state);
  state.screen = screen;
  const ctx = contexts.get(state);
  if (ctx) {
    const ov = ctx.overlays[overlayKey];
    ov.penalty.textContent = `You lost $${lost} — ${Math.round(lossFrac * 100)}% of your cash.`;
    ov.el.style.display = 'flex';
  }
}

export function bustPlayer(state) {
  if (state.screen === SCREEN_BUSTED || state.screen === SCREEN_WASTED) return;
  const lost = Math.floor(state.cash * BUSTED_CASH_LOSS);
  state.cash -= lost;
  state.wanted = 0;
  state.health = state.maxHealth;
  respawn(state, 'police', SCREEN_BUSTED, 'busted', lost, BUSTED_CASH_LOSS);
  sfx('busted');
}

export function wastePlayer(state) {
  if (state.screen === SCREEN_BUSTED || state.screen === SCREEN_WASTED) return;
  const lost = Math.floor(state.cash * WASTED_CASH_LOSS);
  state.cash -= lost;
  state.wanted = 0;
  state.health = state.maxHealth;
  respawn(state, 'hospital', SCREEN_WASTED, 'wasted', lost, WASTED_CASH_LOSS);
  sfx('wasted');
}

// One window keydown listener (added once): Enter or Space on the
// busted/wasted screen hides the overlays and returns to play. main.js
// does NOT handle this.
function ensureResumeListener() {
  if (resumeListenerAdded) return;
  resumeListenerAdded = true;
  window.addEventListener('keydown', (e) => {
    if (!activeState) return;
    if (e.code !== 'Enter' && e.code !== 'Space') return;
    if (activeState.screen !== SCREEN_BUSTED && activeState.screen !== SCREEN_WASTED) return;
    const ctx = contexts.get(activeState);
    if (ctx) {
      ctx.overlays.busted.el.style.display = 'none';
      ctx.overlays.wasted.el.style.display = 'none';
    }
    activeState.screen = SCREEN_PLAY;
  });
}

// --- Per-unit updates -----------------------------------------------------
function updateCar(state, unit, dt, ctx) {
  const car = unit.car;
  const p = state.player;
  let dx = p.pos.x - car.pos.x;
  let dz = p.pos.z - car.pos.z;
  const dist = Math.hypot(dx, dz);

  // Flash the roof light bar.
  unit.siren += dt * 6;
  const redOn = Math.sin(unit.siren) > 0;
  if (car.lightBarRed) car.lightBarRed.visible = redOn;
  if (car.lightBarBlue) car.lightBarBlue.visible = !redOn;
  unit.ramCooldown -= dt;

  let targetSpeed = CAR_CHASE_SPEED;
  let targetHeading = car.heading;

  if (unit.reverseT > 0) {
    // Stuck recovery: back up while turning.
    unit.reverseT -= dt;
    car.heading += 1.5 * dt;
    car.speed = -6;
  } else if (unit.disengage) {
    // Drive away from the player, then despawn once far enough.
    targetHeading = Math.atan2(-dx, -dz);
    targetSpeed = 14;
    car.heading = turnToward(car.heading, targetHeading, 2.4, dt);
    car.speed = easeSpeed(car.speed, targetSpeed, 12, dt);
    if (dist > DESPAWN_DIST_CAR) unit.remove = true;
  } else if (p.onFoot && dist < CAR_DEPLOY_RANGE) {
    // Stop and put a cop on the street (once per car).
    targetSpeed = 0;
    car.speed = easeSpeed(car.speed, targetSpeed, 12, dt);
    if (!unit.deployed) {
      unit.deployed = true;
      spawnFootCop(state, ctx, {
        x: car.pos.x + Math.cos(car.heading) * 2.2,
        z: car.pos.z - Math.sin(car.heading) * 2.2,
      }, false);
    }
  } else if (p.onFoot && dist < 20 && unit.deployed) {
    // Stay put while the deployed cop works.
    targetSpeed = 0;
    car.speed = easeSpeed(car.speed, targetSpeed, 12, dt);
  } else {
    if (dist <= 12) {
      // Close in: head straight at the player.
      targetHeading = Math.atan2(dx, dz);
    } else {
      // Road-grid chase: run along the axis with the bigger gap,
      // snapped to the nearest road line on the other axis.
      const lines = state.city.roadLines;
      if (Math.abs(dx) > Math.abs(dz)) {
        const line = nearestRoadLine(lines, car.pos.z);
        targetHeading = Math.atan2(Math.sign(dx) * 10, line - car.pos.z);
      } else {
        const line = nearestRoadLine(lines, car.pos.x);
        targetHeading = Math.atan2(line - car.pos.x, Math.sign(dz) * 10);
      }
    }
    car.heading = turnToward(car.heading, targetHeading, 2.4, dt);
    car.speed = easeSpeed(car.speed, targetSpeed, 12, dt);
  }

  // Move along the heading; sync the mesh and the wheels.
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  car.pos.x += fx * car.speed * dt;
  car.pos.z += fz * car.speed * dt;
  car._fwdX = fx;
  car._fwdZ = fz;
  car.mesh.rotation.y = car.heading;
  updateCarWheels(car, dt);
  unit.heading = car.heading;
  unit.speed = car.speed;

  // Stuck recovery: sample movement every 0.5 s; if trying to drive
  // but barely moving, back up for a second.
  unit.sampleT -= dt;
  if (unit.sampleT <= 0) {
    unit.sampleT = 0.5;
    const moved = Math.hypot(car.pos.x - unit.lastX, car.pos.z - unit.lastZ);
    if (targetSpeed > 1 && moved < 0.8) unit.stuckTime += 0.5;
    else unit.stuckTime = 0;
    unit.lastX = car.pos.x;
    unit.lastZ = car.pos.z;
    if (unit.stuckTime >= 2) {
      unit.reverseT = 1;
      unit.stuckTime = 0;
    }
  }

  // Ram: close in, shove the player on foot (or slow their car).
  dx = p.pos.x - car.pos.x;
  dz = p.pos.z - car.pos.z;
  const ramDist = Math.hypot(dx, dz);
  if (ramDist < CAR_RAM_RANGE && unit.ramCooldown <= 0) {
    unit.ramCooldown = 1;
    shake(state, 0.35);
    sfx('crash');
    if (p.onFoot) {
      state.health -= CAR_RAM_DAMAGE;
      const d = ramDist || 1;
      p.pos.x += (dx / d) * 2.5;
      p.pos.z += (dz / d) * 2.5;
      if (p.mesh) p.mesh.position.copy(p.pos);
    } else if (p.car) {
      p.car.speed *= 0.6;
    }
  }
}

function updateFoot(state, unit, dt, ctx) {
  const p = state.player;
  unit.punchCooldown -= dt;

  if (unit.health <= 0 && !unit.down) {
    unit.down = true;
    unit.downTimer = 0;
  }
  if (unit.down) {
    // Lie flat, then leave once the timer runs out.
    unit.downTimer += dt;
    unit.group.rotation.x = Math.max(-Math.PI / 2, unit.group.rotation.x - 4 * dt);
    if (unit.downTimer > 3) unit.remove = true;
    return;
  }

  const dx = p.pos.x - unit.pos.x;
  const dz = p.pos.z - unit.pos.z;
  const dist = Math.hypot(dx, dz);

  if (unit.disengage) {
    // Walk away from the player, then despawn once far enough.
    const away = Math.atan2(-dx, -dz);
    unit.heading = turnToward(unit.heading, away, 6, dt);
    unit.speed = 5;
    unit.pos.x += Math.sin(unit.heading) * unit.speed * dt;
    unit.pos.z += Math.cos(unit.heading) * unit.speed * dt;
    collideBuildings(state, unit.pos, 0.55);
    unit.walkPhase += dt * unit.speed * 1.6;
    const swing = Math.sin(unit.walkPhase) * 0.6;
    unit.parts.leftLeg.rotation.x = swing;
    unit.parts.rightLeg.rotation.x = -swing;
    unit.parts.leftArm.rotation.x = -swing * 0.8;
    unit.parts.rightArm.rotation.x = swing * 0.8;
    unit.group.rotation.y = unit.heading;
    if (dist > DESPAWN_DIST_FOOT) unit.remove = true;
    return;
  }

  // Chase: turn toward the player, run until close, then stand still —
  // standing next to the player lets the arrest timer run instead of
  // orbiting through them (which kept resetting it).
  unit.heading = turnToward(unit.heading, Math.atan2(dx, dz), 6, dt);
  if (dist >= 1.5) {
    unit.speed = COP_RUN_SPEED;
    unit.pos.x += Math.sin(unit.heading) * unit.speed * dt;
    unit.pos.z += Math.cos(unit.heading) * unit.speed * dt;
    collideBuildings(state, unit.pos, 0.55);
    unit.walkPhase += dt * unit.speed * 1.6;
    const swing = Math.sin(unit.walkPhase) * 0.6;
    unit.parts.leftLeg.rotation.x = swing;
    unit.parts.rightLeg.rotation.x = -swing;
    unit.parts.leftArm.rotation.x = -swing * 0.8;
    unit.parts.rightArm.rotation.x = swing * 0.8;
  } else {
    unit.speed = 0;
    unit.parts.leftLeg.rotation.x = 0;
    unit.parts.rightLeg.rotation.x = 0;
    unit.parts.leftArm.rotation.x = 0;
    unit.parts.rightArm.rotation.x = 0;
  }
  unit.group.rotation.y = unit.heading;

  // Punch: close in, on cooldown.
  if (dist < COP_PUNCH_RANGE && unit.punchCooldown <= 0) {
    unit.punchCooldown = COP_PUNCH_COOLDOWN;
    state.health -= COP_PUNCH_DAMAGE;
    shake(state, 0.25);
    sfx('hit');
  }

  // Arrest: 2 continuous seconds within 2 m = busted.
  if (dist < ARREST_DIST) {
    unit.arrestTimer += dt;
    if (unit.arrestTimer >= ARREST_TIME) {
      bustPlayer(state);
      return;
    }
  } else {
    unit.arrestTimer = 0;
  }
}

// --- Setup / per-frame ----------------------------------------------------
export function createPolice(state, scene) {
  const rng = createRandom((state.seed >>> 0) + 13);
  const overlays = {
    busted: makeOverlay('busted', 'BUSTED', '#7fd4ff', 'The Neon Bay PD caught you.'),
    wasted: makeOverlay('wasted', 'WASTED', '#ff5a7a', 'You blacked out on the streets of Neon Bay.'),
  };
  contexts.set(state, { scene, rng, decayTimer: 0, overlays });
  activeState = state;
  ensureResumeListener();
  // Only install __wantedAdd if nothing set it already.
  if (typeof window.__wantedAdd !== 'function') {
    window.__wantedAdd = (n, reason) => addWanted(state, n, reason);
  }
  window.__police = {
    setDecaySeconds: (s) => setPoliceDecaySeconds(s),
    bust: () => bustPlayer(state),
    waste: () => wastePlayer(state),
  };
  return { update: (dt) => updatePolice(state, dt) };
}

export function updatePolice(state, dt) {
  if (state.screen !== SCREEN_PLAY) return;
  const ctx = contexts.get(state);
  if (!ctx) return;
  // Health 0 is wasted — checked before AND after stepping the units.
  if (state.health <= 0) {
    wastePlayer(state);
    return;
  }

  // Desired force: 1 police car per star (max 3), 2 foot cops at 3+ stars.
  const wantCars = Math.min(state.wanted, MAX_POLICE_CARS);
  const wantFoot = state.wanted >= FOOT_COPS_AT_STARS ? FOOT_COP_COUNT : 0;

  // Surplus counted units disengage; with no heat at all, everything does.
  for (const u of state.police) {
    if (u.remove || u.disengage) continue;
    if (state.wanted === 0) {
      u.disengage = true;
      continue;
    }
    if (!u.counted) continue;
    if (u.kind === 'car') {
      const counted = state.police.filter((o) => !o.remove && !o.disengage && o.counted && o.kind === 'car').length;
      if (counted > wantCars) u.disengage = true;
    } else if (u.kind === 'foot') {
      const counted = state.police.filter((o) => !o.remove && !o.disengage && o.counted && o.kind === 'foot').length;
      if (counted > wantFoot) u.disengage = true;
    }
  }

  // Spawn the missing units.
  let activeCars = 0;
  let activeFoot = 0;
  for (const u of state.police) {
    if (u.remove || u.disengage || !u.counted) continue;
    if (u.kind === 'car') activeCars += 1;
    else if (u.kind === 'foot') activeFoot += 1;
  }
  for (let i = activeCars; i < wantCars; i += 1) spawnPoliceCar(state, ctx);
  for (let i = activeFoot; i < wantFoot; i += 1) {
    const p = spawnPosNearPlayer(state, ctx.rng, randRange(ctx.rng, 30, 45));
    spawnFootCop(state, ctx, p, true);
  }

  // Wanted decay: -1 star per interval, only while no police unit is
  // within 80 m; any unit nearby resets the timer.
  if (state.wanted > 0) {
    let nearest = Infinity;
    for (const u of state.police) {
      if (u.remove || u.down) continue;
      const d = Math.hypot(u.pos.x - state.player.pos.x, u.pos.z - state.player.pos.z);
      if (d < nearest) nearest = d;
    }
    if (nearest > DECAY_CLEAR_DIST) {
      ctx.decayTimer += dt;
      if (ctx.decayTimer >= decaySeconds) {
        ctx.decayTimer = 0;
        state.wanted = Math.max(0, state.wanted - 1);
      }
    } else {
      ctx.decayTimer = 0;
    }
  } else {
    ctx.decayTimer = 0;
  }

  // Step every unit; a busted/wasted mid-frame stops the rest.
  for (const u of state.police) {
    if (u.remove) continue;
    if (u.kind === 'car') updateCar(state, u, dt, ctx);
    else updateFoot(state, u, dt, ctx);
    if (state.screen !== SCREEN_PLAY) return;
  }

  // Remove units flagged for removal.
  for (let i = state.police.length - 1; i >= 0; i -= 1) {
    const u = state.police[i];
    if (u.remove) {
      if (u.group) ctx.scene.remove(u.group);
      state.police.splice(i, 1);
    }
  }

  if (state.health <= 0) wastePlayer(state);
}
