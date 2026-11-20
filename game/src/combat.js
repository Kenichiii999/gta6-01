// Melee combat. One job: the F punch. Short-range arc in front of the
// player, 0.35 s cooldown, a small lunge on the player mesh, damage to
// the nearest pedestrian or cop in range, and the wanted consequences
// (assault seen by police, hitting a cop).
import { ACTION_PUNCH } from './input.js';
import { addWanted } from './police.js';
import { SCREEN_PLAY } from './render.js';

export const PUNCH_RANGE = 2.2; // m
export const PUNCH_ARC = 0.5; // cos of the half-angle, ~60 degrees each side
export const PUNCH_COOLDOWN = 0.35; // s
export const PUNCH_COP_DAMAGE = 15;
export const PUNCH_PED_DAMAGE = 25;
export const POLICE_SEE_CRIME_DIST = 60; // m
export const LUNGE_TIME = 0.18; // s
export const LUNGE_DIST = 0.35; // m

// Per-state context (cooldown + lunge timer).
const contexts = new WeakMap();

function sfx(name) {
  try {
    if (typeof window.__sfx === 'function') window.__sfx(name);
  } catch { /* a missing audio slice must never break a punch */ }
}

// Positions are read defensively: entries expose .pos, .mesh or .group.
function entryPos(entry) {
  if (!entry) return null;
  if (entry.pos) return entry.pos;
  if (entry.mesh) return entry.mesh.position;
  if (entry.group) return entry.group.position;
  return null;
}

export function updateCombat(state, dt, input) {
  let ctx = contexts.get(state);
  if (!ctx) {
    ctx = { cooldown: 0, lungeT: 0 };
    contexts.set(state, ctx);
  }
  if (ctx.cooldown > 0) ctx.cooldown -= dt;

  // Lunge animation: while it runs, offset the player mesh forward along
  // the heading (peak mid-lunge, back to 0 at the end). This must run
  // AFTER player.update() in the main loop, because player.update()
  // re-asserts the mesh position every step.
  if (ctx.lungeT > 0) {
    ctx.lungeT -= dt;
    const t = Math.max(0, ctx.lungeT);
    const offset = Math.sin(Math.PI * (1 - t / LUNGE_TIME)) * LUNGE_DIST;
    const mesh = state.player.mesh;
    if (mesh) {
      mesh.position.set(
        state.player.pos.x + Math.sin(state.player.heading) * offset,
        state.player.pos.y,
        state.player.pos.z + Math.cos(state.player.heading) * offset,
      );
    }
  }

  if (state.screen !== SCREEN_PLAY) return;

  // F this frame: either the actions bitmask the main loop already took
  // (calling takeActions() again here would see nothing) or the input
  // object itself (then takeActions() is called here).
  let punched = false;
  if (typeof input === 'number') {
    punched = (input & ACTION_PUNCH) !== 0;
  } else if (input && typeof input.takeActions === 'function') {
    punched = (input.takeActions() & ACTION_PUNCH) !== 0;
  }
  if (!punched) return;
  // Punching only works on foot, and not while cooling down.
  if (!state.player.onFoot) return;
  if (ctx.cooldown > 0) return;
  ctx.cooldown = PUNCH_COOLDOWN;
  ctx.lungeT = LUNGE_TIME;
  sfx('punch');

  // Target: nearest hittable entry inside the 2.2 m arc in front of the
  // player (forward dot product >= 0.5, distance > ~0). A whiff (no
  // target) still lunges and plays the sound.
  const fx = Math.sin(state.player.heading);
  const fz = Math.cos(state.player.heading);
  let best = null;
  let bestKind = null;
  let bestDist = PUNCH_RANGE;
  const consider = (entry, kind) => {
    if (kind === 'cop' && entry.down) return;
    const pos = entryPos(entry);
    if (!pos) return;
    const dx = pos.x - state.player.pos.x;
    const dz = pos.z - state.player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= 0.01 || d > bestDist) return;
    if ((dx * fx + dz * fz) / d < PUNCH_ARC) return;
    best = entry;
    bestKind = kind;
    bestDist = d;
  };
  for (const u of state.police) {
    if (u.kind === 'foot') consider(u, 'cop');
  }
  for (const ped of state.peds) consider(ped, 'ped');
  if (!best) return;

  if (bestKind === 'cop') {
    best.health = (best.health ?? 100) - PUNCH_COP_DAMAGE;
    addWanted(state, 1, 'hit police');
    // The cop's own update drops it once health hits 0; it fights back
    // with its punch while still standing.
  } else {
    best.health = (best.health ?? 100) - PUNCH_PED_DAMAGE;
    if (best.health <= 0) best.down = true;
    else best.fleeing = true;
    // Assault witnessed by police within 60 m: +1 star, once.
    for (const u of state.police) {
      if (u.remove || u.down) continue;
      const pos = entryPos(u);
      if (!pos) continue;
      const d = Math.hypot(pos.x - state.player.pos.x, pos.z - state.player.pos.z);
      if (d <= POLICE_SEE_CRIME_DIST) {
        addWanted(state, 1, 'assault');
        break;
      }
    }
  }
}
