// Neon Bay — wanted system + police AI. One job: own the heat. Wanted
// stars 0-5, police cars that chase on the road grid and ram, foot cops
// that run the player down and arrest, wanted decay when the heat is off,
// and the busted / wasted flows (cash penalty + respawn + wanted cleared).
// Self-contained: builds its own police car / foot cop meshes here, imports
// nothing from the vehicles slice. All names, art and design original.

import * as THREE from 'three';
import { SCREEN_BUSTED, SCREEN_PLAY, SCREEN_WASTED } from './render.js';

// --- Tuning (shared contract: DESIGN.md "Wanted rules") --------------------
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

// Decay interval is a module value (not a magic number in the loop) so a
// playtest can shorten it through setPoliceDecaySeconds; shipped value is
// DECAY_SECONDS (20 s) and nothing in the game changes it.
let decaySeconds = DECAY_SECONDS;
export function setPoliceDecaySeconds(s) {
  decaySeconds = Math.max(0.1, s);
}

// --- Per-state context (scene + overlays); state.police stays the array ---
const contexts = new WeakMap();

function turnToward(heading, target, rate, dt) {
  let diff = target - heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return heading + Math.max(-rate * dt, Math.min(rate * dt, diff));
}

function nearestRoadLine(state, v) {
  const lines = state.city.roadLines;
  let best = lines[0];
  let bestD = Math.abs(v - best);
  for (let i = 1; i < lines.length; i += 1) {
    const d = Math.abs(v - lines[i]);
    if (d < bestD) {
      bestD = d;
      best = lines[i];
    }
  }
  return best;
}

// --- Shared geometry / materials (built once, reused by every unit) -------
let shared = null;

function buildShared() {
  if (shared) return shared;
  const lambert = (color) => new THREE.MeshLambertMaterial({ color });
  shared = {
    carBodyGeo: new THREE.BoxGeometry(2.0, 0.7, 4.4),
    carCabinGeo: new THREE.BoxGeometry(1.7, 0.55, 2.0),
    carBarGeo: new THREE.BoxGeometry(1.3, 0.14, 0.4),
    carLightGeo: new THREE.BoxGeometry(0.55, 0.2, 0.36),
    wheelGeo: new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10),
    copLegGeo: new THREE.BoxGeometry(0.22, 0.8, 0.24),
    copShoeGeo: new THREE.BoxGeometry(0.24, 0.12, 0.42),
    copTorsoGeo: new THREE.BoxGeometry(0.62, 0.72, 0.34),
    copArmGeo: new THREE.BoxGeometry(0.18, 0.68, 0.2),
    copHeadGeo: new THREE.BoxGeometry(0.4, 0.4, 0.38),
    copCapGeo: new THREE.BoxGeometry(0.46, 0.1, 0.44),
    matWhite: lambert(0xf2f2f2),
    matBlack: lambert(0x14181f),
    matWheel: lambert(0x1a1a1a),
    matRed: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
    matBlue: new THREE.MeshBasicMaterial({ color: 0x2a6aff }),
    matNavy: lambert(0x1f2f52),
    matNavyDark: lambert(0x16233d),
    matSkin: lambert(0xe8b88a),
    matGold: lambert(0xc9a227),
  };
  return shared;
}

function box(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Black-and-white patrol car with a red/blue light bar. Original design. */
function buildPoliceCar() {
  const s = shared;
  const group = new THREE.Group();
  const body = box(s.carBodyGeo, s.matWhite, 0, 0.55, 0);
  const cabin = box(s.carCabinGeo, s.matBlack, 0, 1.15, -0.2);
  // Black hood + trunk panels over the white body: the two-tone look.
  const hood = box(new THREE.BoxGeometry(1.9, 0.1, 1.1), s.matBlack, 0, 0.92, 1.55);
  const trunk = box(new THREE.BoxGeometry(1.9, 0.1, 0.9), s.matBlack, 0, 0.92, -1.7);
  const bar = box(s.carBarGeo, s.matBlack, 0, 1.5, -0.2);
  const red = box(s.carLightGeo, s.matRed, -0.32, 1.62, -0.2);
  const blue = box(s.carLightGeo, s.matBlue, 0.32, 1.62, -0.2);
  group.add(body, cabin, hood, trunk, bar, red, blue);
  for (const [x, z] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
    const wheel = new THREE.Mesh(s.wheelGeo, s.matWheel);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.38, z);
    wheel.castShadow = true;
    group.add(wheel);
  }
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { group, red, blue };
}

/** Foot cop: navy uniform, cap with gold band. Original design. */
function buildFootCop() {
  const s = shared;
  const group = new THREE.Group();
  const leftLeg = box(s.copLegGeo, s.matNavyDark, -0.14, 0.4, 0);
  const rightLeg = box(s.copLegGeo, s.matNavyDark, 0.14, 0.4, 0);
  const leftShoe = box(s.copShoeGeo, s.matBlack, -0.14, 0.06, 0.06);
  const rightShoe = box(s.copShoeGeo, s.matBlack, 0.14, 0.06, 0.06);
  const torso = box(s.copTorsoGeo, s.matNavy, 0, 1.16, 0);
  const badge = box(new THREE.BoxGeometry(0.12, 0.12, 0.05), s.matGold, -0.18, 1.3, 0.18);
  const leftArm = box(s.copArmGeo, s.matNavy, -0.42, 1.16, 0);
  const rightArm = box(s.copArmGeo, s.matNavy, 0.42, 1.16, 0);
  const head = box(s.copHeadGeo, s.matSkin, 0, 1.78, 0);
  const cap = box(s.copCapGeo, s.matNavyDark, 0, 2.0, 0);
  const capBand = box(new THREE.BoxGeometry(0.47, 0.05, 0.45), s.matGold, 0, 1.96, 0);
  group.add(leftLeg, rightLeg, leftShoe, rightShoe, torso, badge, leftArm, rightArm, head, cap, capBand);
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { group, parts: { leftLeg, rightLeg, leftArm, rightArm } };
}

// --- Spawning ---------------------------------------------------------------
function spawnPosNearPlayer(state, dist) {
  const p = state.player.pos;
  const angle = Math.random() * Math.PI * 2;
  let x = p.x + Math.cos(angle) * dist;
  let z = p.z + Math.sin(angle) * dist;
  // Snap onto the road grid: move whichever axis is closer to a road line.
  const snapX = nearestRoadLine(state, x);
  const snapZ = nearestRoadLine(state, z);
  if (Math.abs(x - snapX) <= Math.abs(z - snapZ)) x = snapX;
  else z = snapZ;
  const limit = state.city.half + 40;
  return {
    x: Math.max(-limit, Math.min(limit, x)),
    z: Math.max(-state.city.half - 6, Math.min(state.city.half + 40, z)),
  };
}

function spawnCar(state, ctx) {
  const { group, red, blue } = buildPoliceCar();
  const at = spawnPosNearPlayer(state, 50 + Math.random() * 20);
  group.position.set(at.x, 0, at.z);
  ctx.scene.add(group);
  const unit = {
    kind: 'car',
    counted: true,
    group,
    pos: group.position, // same object: moving the mesh moves the unit
    heading: Math.atan2(state.player.pos.x - at.x, state.player.pos.z - at.z),
    speed: 0,
    siren: Math.random() * Math.PI * 2,
    red,
    blue,
    stuckTime: 0,
    sampleT: 0,
    lastX: at.x,
    lastZ: at.z,
    reverseT: 0,
    ramCooldown: 0,
    deployed: false,
    disengage: false,
    remove: false,
  };
  group.rotation.y = unit.heading;
  state.police.push(unit);
  return unit;
}

function spawnFootCop(state, ctx, at, counted) {
  const { group, parts } = buildFootCop();
  group.position.set(at.x, 0, at.z);
  ctx.scene.add(group);
  const unit = {
    kind: 'foot',
    counted,
    group,
    parts,
    pos: group.position,
    heading: Math.atan2(state.player.pos.x - at.x, state.player.pos.z - at.z),
    speed: 0,
    health: COP_HEALTH,
    walkPhase: Math.random() * Math.PI * 2,
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

function removeUnit(state, ctx, unit) {
  ctx.scene.remove(unit.group);
  const i = state.police.indexOf(unit);
  if (i >= 0) state.police.splice(i, 1);
}

function clearPolice(state, ctx) {
  if (!ctx) return;
  for (const unit of [...state.police]) removeUnit(state, ctx, unit);
}

// --- Wanted -----------------------------------------------------------------
export function addWanted(state, n, reason) {
  const before = state.wanted || 0;
  state.wanted = Math.max(0, Math.min(WANTED_MAX, before + n));
  if (reason) state.lastWantedReason = reason;
  // The HUD in main.js reads state.wanted every frame, so the stars update
  // with no extra hook. Siren sting on a fresh star (slice D defines __sfx).
  if (state.wanted > before && typeof window !== 'undefined' && typeof window.__sfx === 'function') {
    try {
      window.__sfx('siren');
    } catch {
      /* audio is best-effort */
    }
  }
  return state.wanted;
}

// --- Busted / wasted ----------------------------------------------------------
function showOverlay(ctx, el, penaltyText) {
  if (!el) return;
  const p = el.querySelector('.penalty');
  if (p) p.textContent = penaltyText;
  el.style.display = 'flex';
}

function hideOverlays(ctx) {
  if (!ctx) return;
  if (ctx.bustedEl) ctx.bustedEl.style.display = 'none';
  if (ctx.wastedEl) ctx.wastedEl.style.display = 'none';
}

function respawnAt(state, landmarkKey, dx, dz) {
  const lm = state.city && state.city.landmarks ? state.city.landmarks[landmarkKey] : null;
  if (lm) {
    state.player.pos.set(lm.pos.x + dx, 0, lm.pos.z + dz);
    state.player.heading = Math.PI;
    if (state.player.mesh) state.player.mesh.position.copy(state.player.pos);
  }
  state.player.onFoot = true;
  state.player.car = null;
  state.player.speed = 0;
}

export function bustPlayer(state) {
  if (!state || state.screen === SCREEN_BUSTED) return;
  const ctx = contexts.get(state);
  const loss = Math.floor((state.cash || 0) * BUSTED_CASH_LOSS);
  state.cash = Math.max(0, (state.cash || 0) - loss);
  state.wanted = 0;
  state.health = state.maxHealth || 100;
  respawnAt(state, 'police', 26, 26);
  clearPolice(state, ctx);
  state.screen = SCREEN_BUSTED;
  if (ctx) {
    showOverlay(ctx, ctx.bustedEl, `You lost $${loss.toLocaleString('en-US')} — 20% of your cash.`);
  }
  if (typeof window !== 'undefined' && typeof window.__sfx === 'function') {
    try {
      window.__sfx('busted');
    } catch {
      /* best-effort */
    }
  }
}

export function wastePlayer(state) {
  if (!state || state.screen === SCREEN_WASTED) return;
  const ctx = contexts.get(state);
  const loss = Math.floor((state.cash || 0) * WASTED_CASH_LOSS);
  state.cash = Math.max(0, (state.cash || 0) - loss);
  state.wanted = 0;
  state.health = state.maxHealth || 100;
  respawnAt(state, 'hospital', 26, 26);
  clearPolice(state, ctx);
  state.screen = SCREEN_WASTED;
  if (ctx) {
    showOverlay(ctx, ctx.wastedEl, `You lost $${loss.toLocaleString('en-US')} — 10% of your cash.`);
  }
  if (typeof window !== 'undefined' && typeof window.__sfx === 'function') {
    try {
      window.__sfx('wasted');
    } catch {
      /* best-effort */
    }
  }
}

// --- Busted/wasted overlay DOM (built here so index.html stays untouched) ---
function makeOverlay(id, title, color, sub) {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'screen';
  el.style.display = 'none';
  el.style.zIndex = '30';
  const h1 = document.createElement('h1');
  h1.textContent = title;
  h1.style.color = color;
  const p = document.createElement('p');
  p.className = 'penalty';
  p.textContent = sub;
  const hint = document.createElement('p');
  hint.textContent = 'Press Enter to keep playing.';
  el.append(h1, p, hint);
  document.body.appendChild(el);
  return el;
}

let resumeListenerAdded = false;

export function createPolice(state, scene) {
  buildShared();
  const bustedEl = makeOverlay('busted', 'BUSTED', '#7fd4ff', 'The Neon Bay PD caught you.');
  const wastedEl = makeOverlay('wasted', 'WASTED', '#ff5a7a', 'You blacked out on the streets of Neon Bay.');
  const ctx = { scene, decayTimer: 0, bustedEl, wastedEl };
  contexts.set(state, ctx);

  // Enter resumes from busted/wasted: main.js only handles title/paused,
  // so this listener owns the return to play.
  if (!resumeListenerAdded) {
    resumeListenerAdded = true;
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'Enter' && event.code !== 'Space') return;
      if (state.screen !== SCREEN_BUSTED && state.screen !== SCREEN_WASTED) return;
      hideOverlays(ctx);
      state.screen = SCREEN_PLAY;
    });
  }

  if (typeof window !== 'undefined') {
    if (!window.__wantedAdd) window.__wantedAdd = (n, reason) => addWanted(state, n, reason);
    window.__police = {
      setDecaySeconds: setPoliceDecaySeconds,
      bust: () => bustPlayer(state),
      waste: () => wastePlayer(state),
    };
  }
  return {
    update(dt) {
      updatePolice(state, dt);
    },
  };
}

// --- Unit updates -------------------------------------------------------------
function collideBuildings(state, pos, r) {
  for (const b of state.city.buildings) {
    const nx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const nz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r || d2 <= 1e-8) continue;
    const d = Math.sqrt(d2);
    pos.x = nx + (dx / d) * r;
    pos.z = nz + (dz / d) * r;
  }
}

function shake(state, seconds) {
  // Consumed by the renderer (slice E): a decaying shake timer on state.
  state.shakeTime = Math.max(state.shakeTime || 0, seconds);
}

function sfx(name) {
  if (typeof window !== 'undefined' && typeof window.__sfx === 'function') {
    try {
      window.__sfx(name);
    } catch {
      /* best-effort */
    }
  }
}

function updateCar(state, ctx, u, dt) {
  const p = state.player.pos;
  const dx = p.x - u.pos.x;
  const dz = p.z - u.pos.z;
  const dist = Math.hypot(dx, dz);

  // Flashing light bar.
  u.siren += dt * 6;
  const phase = Math.sin(u.siren) > 0;
  u.red.visible = phase;
  u.blue.visible = !phase;

  u.ramCooldown = Math.max(0, u.ramCooldown - dt);

  if (u.disengage) {
    // Drive off: away from the player, then remove once far enough.
    const away = Math.atan2(u.pos.x - p.x, u.pos.z - p.z);
    u.heading = turnToward(u.heading, away, 2.4, dt);
    u.speed += Math.max(-12 * dt, Math.min(12 * dt, 14 - u.speed));
    u.pos.x += Math.sin(u.heading) * u.speed * dt;
    u.pos.z += Math.cos(u.heading) * u.speed * dt;
    u.group.rotation.y = u.heading;
    if (dist > DESPAWN_DIST_CAR) u.remove = true;
    return;
  }

  let targetSpeed = CAR_CHASE_SPEED;
  let targetHeading;
  if (dist > 12) {
    // Road-grid chase: run along the axis with the bigger gap, snapped to
    // the nearest road line on the other axis, so cars stay on roads
    // instead of cutting through buildings.
    if (Math.abs(dx) > Math.abs(dz)) {
      targetHeading = Math.atan2(dx, nearestRoadLine(state, u.pos.z) - u.pos.z);
    } else {
      targetHeading = Math.atan2(nearestRoadLine(state, u.pos.x) - u.pos.x, dz);
    }
  } else {
    targetHeading = Math.atan2(dx, dz);
  }

  if (state.player.onFoot && dist < CAR_DEPLOY_RANGE) {
    // Close on foot: stop, and a cop gets out (once per car).
    targetSpeed = 0;
    if (!u.deployed) {
      u.deployed = true;
      const side = u.pos.x + Math.cos(u.heading) * 2.2;
      const sideZ = u.pos.z - Math.sin(u.heading) * 2.2;
      spawnFootCop(state, ctx, { x: side, z: sideZ }, false);
    }
  } else if (state.player.onFoot && dist < 20 && u.deployed) {
    // Parked with its cop out: stay put while the cop works.
    targetSpeed = 0;
  }

  // Stuck recovery: barely moved while trying to drive for 2 s -> reverse
  // and turn for 1 s, then try again.
  u.sampleT += dt;
  if (u.sampleT >= 0.5) {
    const moved = Math.hypot(u.pos.x - u.lastX, u.pos.z - u.lastZ);
    if (targetSpeed > 1 && moved < 0.8) u.stuckTime += 0.5;
    else u.stuckTime = 0;
    u.lastX = u.pos.x;
    u.lastZ = u.pos.z;
    u.sampleT = 0;
  }
  if (u.stuckTime >= 2 && u.reverseT <= 0) {
    u.reverseT = 1;
    u.stuckTime = 0;
  }

  if (u.reverseT > 0) {
    u.reverseT -= dt;
    u.heading += 1.5 * dt;
    u.speed = -6;
  } else {
    u.heading = turnToward(u.heading, targetHeading, 2.4, dt);
    u.speed += Math.max(-12 * dt, Math.min(12 * dt, targetSpeed - u.speed));
  }
  u.pos.x += Math.sin(u.heading) * u.speed * dt;
  u.pos.z += Math.cos(u.heading) * u.speed * dt;
  u.group.rotation.y = u.heading;

  // Ram: contact with the player.
  if (dist < CAR_RAM_RANGE && u.ramCooldown <= 0) {
    u.ramCooldown = 1;
    shake(state, 0.35);
    sfx('crash');
    if (state.player.onFoot) {
      state.health = Math.max(0, state.health - CAR_RAM_DAMAGE);
      const push = Math.max(dist, 0.01);
      state.player.pos.x += (dx / push) * 2.5;
      state.player.pos.z += (dz / push) * 2.5;
      if (state.player.mesh) state.player.mesh.position.copy(state.player.pos);
    } else if (state.player.car && typeof state.player.car.speed === 'number') {
      state.player.car.speed *= 0.6;
    }
  }
}

function updateFoot(state, ctx, u, dt) {
  if (u.down) {
    // Fallen cop: lie flat, then get removed.
    u.downTimer += dt;
    u.group.rotation.x = Math.max(-Math.PI / 2, u.group.rotation.x - dt * 4);
    if (u.downTimer > 3) u.remove = true;
    return;
  }
  if (u.health <= 0) {
    u.down = true;
    u.downTimer = 0;
    return;
  }

  const p = state.player.pos;
  const dx = p.x - u.pos.x;
  const dz = p.z - u.pos.z;
  const dist = Math.hypot(dx, dz);
  u.punchCooldown = Math.max(0, u.punchCooldown - dt);

  if (u.disengage) {
    const away = Math.atan2(u.pos.x - p.x, u.pos.z - p.z);
    u.heading = turnToward(u.heading, away, 6, dt);
    u.speed = 5;
    u.pos.x += Math.sin(u.heading) * u.speed * dt;
    u.pos.z += Math.cos(u.heading) * u.speed * dt;
    collideBuildings(state, u.pos, 0.55);
    u.group.rotation.y = u.heading;
    if (dist > DESPAWN_DIST_FOOT) u.remove = true;
    return;
  }

  // Run the player down, then hold at arm's length: standing next to the
  // player lets the arrest timer run instead of orbiting through them
  // (which kept resetting it) and lets the cop punch from a fixed spot.
  const HOLD_DIST = 1.5;
  u.heading = turnToward(u.heading, Math.atan2(dx, dz), 6, dt);
  if (dist >= HOLD_DIST) {
    u.speed = COP_RUN_SPEED;
    u.pos.x += Math.sin(u.heading) * u.speed * dt;
    u.pos.z += Math.cos(u.heading) * u.speed * dt;
    collideBuildings(state, u.pos, 0.55);
    u.walkPhase += dt * u.speed * 1.6;
  } else {
    u.speed = 0;
  }
  u.group.rotation.y = u.heading;

  // Walk cycle (frozen mid-stride while holding still).
  const swing = u.speed > 0.3 ? Math.sin(u.walkPhase) * 0.6 : 0;
  u.parts.leftLeg.rotation.x = swing;
  u.parts.rightLeg.rotation.x = -swing;
  u.parts.leftArm.rotation.x = -swing * 0.8;
  u.parts.rightArm.rotation.x = swing * 0.8;

  // Punch when adjacent (arrest timer below is the slow path).
  if (dist < COP_PUNCH_RANGE && u.punchCooldown <= 0) {
    u.punchCooldown = COP_PUNCH_COOLDOWN;
    state.health = Math.max(0, state.health - COP_PUNCH_DAMAGE);
    shake(state, 0.25);
    sfx('hit');
  }

  // Arrest: within 2 m for 2 continuous seconds.
  if (dist < ARREST_DIST) {
    u.arrestTimer += dt;
    if (u.arrestTimer >= ARREST_TIME) {
      bustPlayer(state);
      return;
    }
  } else {
    u.arrestTimer = 0;
  }
}

// --- Main update ---------------------------------------------------------------
export function updatePolice(state, dt) {
  const ctx = contexts.get(state);
  if (!ctx || !state) return;
  if (state.screen !== SCREEN_PLAY) return;

  // Health 0 -> wasted (checked before and after the units move, so a
  // punch or a ram in this same frame is caught immediately).
  if (state.health <= 0) {
    wastePlayer(state);
    return;
  }

  const wanted = state.wanted || 0;

  // Desired force: 1 car per star (max 3), 2 foot cops at 3+ stars.
  const wantCars = Math.min(wanted, MAX_POLICE_CARS);
  const wantFoot = wanted >= FOOT_COPS_AT_STARS ? FOOT_COP_COUNT : 0;
  const cars = state.police.filter((u) => u.kind === 'car' && !u.remove);
  const foot = state.police.filter((u) => u.kind === 'foot' && u.counted && !u.remove);

  // Disengage the surplus first (they drive/walk off, then get removed).
  for (let i = wantCars; i < cars.length; i += 1) cars[i].disengage = true;
  for (let i = wantFoot; i < foot.length; i += 1) foot[i].disengage = true;
  if (wanted === 0) {
    for (const u of state.police) u.disengage = true;
  }

  // Spawn the missing units.
  for (let i = cars.filter((u) => !u.disengage).length; i < wantCars; i += 1) spawnCar(state, ctx);
  for (let i = foot.filter((u) => !u.disengage).length; i < wantFoot; i += 1) {
    const at = spawnPosNearPlayer(state, 30 + Math.random() * 15);
    spawnFootCop(state, ctx, at, true);
  }

  // Wanted decay: -1 star per decay interval while no police unit is
  // within 80 m of the player.
  const p = state.player.pos;
  let nearest = Infinity;
  for (const u of state.police) {
    if (u.remove || u.down) continue;
    nearest = Math.min(nearest, Math.hypot(u.pos.x - p.x, u.pos.z - p.z));
  }
  if (wanted > 0 && nearest > DECAY_CLEAR_DIST) {
    ctx.decayTimer += dt;
    if (ctx.decayTimer >= decaySeconds) {
      ctx.decayTimer = 0;
      state.wanted = wanted - 1;
    }
  } else {
    ctx.decayTimer = 0;
  }

  // Step every unit; drop the removed ones.
  for (const unit of [...state.police]) {
    if (unit.kind === 'car') updateCar(state, ctx, unit, dt);
    else updateFoot(state, ctx, unit, dt);
    if (unit.remove) removeUnit(state, ctx, unit);
    if (state.screen !== SCREEN_PLAY) return; // busted mid-frame
  }

  if (state.health <= 0) wastePlayer(state);
}
