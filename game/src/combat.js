// Neon Bay — melee combat. One job: the F punch. Short-range arc in front
// of the player, 0.35 s cooldown, a small lunge on the player mesh, damage
// to the nearest pedestrian or cop in range, and the wanted consequences
// (assault seen by police, hitting a cop). Hit sound goes through the
// guarded window.__sfx hook (slice D owns audio). All names/design original.

import { ACTION_PUNCH } from './input.js';
import { addWanted } from './police.js';
import { SCREEN_PLAY } from './render.js';

export const PUNCH_RANGE = 2.2; // metres
export const PUNCH_ARC = 0.5; // cos of the half-angle (~60 deg each side)
export const PUNCH_COOLDOWN = 0.35; // seconds
export const PUNCH_COP_DAMAGE = 15;
export const PUNCH_PED_DAMAGE = 25;
export const POLICE_SEE_CRIME_DIST = 60; // assault witnessed within 60 m
export const LUNGE_TIME = 0.18; // seconds
export const LUNGE_DIST = 0.35; // metres forward at the peak of the lunge

const contexts = new WeakMap();

function getCtx(state) {
  let ctx = contexts.get(state);
  if (!ctx) {
    ctx = { cooldown: 0, lungeT: 0 };
    contexts.set(state, ctx);
  }
  return ctx;
}

function sfx(name) {
  if (typeof window !== 'undefined' && typeof window.__sfx === 'function') {
    try {
      window.__sfx(name);
    } catch {
      /* audio is best-effort */
    }
  }
}

/** Position of a pedestrian / cop entry, whatever shape its slice uses. */
function entryPos(entry) {
  if (!entry) return null;
  if (entry.pos) return entry.pos;
  if (entry.mesh) return entry.mesh.position;
  if (entry.group) return entry.group.position;
  return null;
}

/**
 * Advance melee combat one step.
 *
 * `input` is either the actions bitmask already taken this frame
 * (ACTION_PUNCH bit — the main loop passes what input.takeActions()
 * returned, because calling takeActions() again here would see nothing)
 * or the input object itself, in which case takeActions() is called here.
 * Punching only works on foot, during play.
 */
export function updateCombat(state, dt, input) {
  const ctx = getCtx(state);
  ctx.cooldown = Math.max(0, ctx.cooldown - dt);

  // Lunge animation: the player mesh leans forward along the heading, then
  // settles back. player.update() re-asserts the mesh position every step,
  // so this must run AFTER player.update() in the main loop.
  if (ctx.lungeT > 0) {
    ctx.lungeT = Math.max(0, ctx.lungeT - dt);
    const mesh = state.player.mesh;
    if (mesh) {
      const k = Math.sin(Math.PI * (1 - ctx.lungeT / LUNGE_TIME));
      mesh.position.set(
        state.player.pos.x + Math.sin(state.player.heading) * LUNGE_DIST * k,
        0,
        state.player.pos.z + Math.cos(state.player.heading) * LUNGE_DIST * k,
      );
    }
  }

  let punchPressed = false;
  if (typeof input === 'number') {
    punchPressed = (input & ACTION_PUNCH) !== 0;
  } else if (input && typeof input.takeActions === 'function') {
    punchPressed = (input.takeActions() & ACTION_PUNCH) !== 0;
  }
  if (!punchPressed) return;
  if (state.screen !== SCREEN_PLAY) return;
  if (!state.player.onFoot) return;
  if (ctx.cooldown > 0) return;

  ctx.cooldown = PUNCH_COOLDOWN;
  ctx.lungeT = LUNGE_TIME;
  sfx('punch');

  const px = state.player.pos.x;
  const pz = state.player.pos.z;
  const fx = Math.sin(state.player.heading);
  const fz = Math.cos(state.player.heading);

  // Nearest hittable target inside the 2.2 m arc in front of the player.
  let best = null;
  let bestD2 = PUNCH_RANGE * PUNCH_RANGE;
  function consider(entry, kind) {
    if (!entry || entry.down) return;
    const pos = entryPos(entry);
    if (!pos) return;
    const dx = pos.x - px;
    const dz = pos.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 > bestD2 || d2 <= 1e-8) return;
    const d = Math.sqrt(d2);
    if ((dx / d) * fx + (dz / d) * fz < PUNCH_ARC) return; // outside the arc
    bestD2 = d2;
    best = { entry, kind };
  }
  for (const cop of state.police || []) {
    if (cop.kind === 'foot') consider(cop, 'cop');
  }
  for (const ped of state.peds || []) consider(ped, 'ped');

  if (!best) return; // whiff: lunge + sound only

  if (best.kind === 'cop') {
    const cop = best.entry;
    cop.health = (cop.health ?? 100) - PUNCH_COP_DAMAGE;
    // The cop's own update drops it once health hits 0; it fights back
    // with its punch while it is still standing.
    addWanted(state, 1, 'hit police');
  } else {
    const ped = best.entry;
    ped.health = (ped.health ?? 100) - PUNCH_PED_DAMAGE;
    if (ped.health <= 0) {
      ped.down = true; // slice B renders the fall; slice C only sets it
    } else {
      ped.fleeing = true; // slice B makes the pedestrian run away
    }
    // Assault witnessed by any police unit within 60 m.
    for (const cop of state.police || []) {
      if (cop.down || cop.remove) continue;
      const pos = entryPos(cop);
      if (!pos) continue;
      if (Math.hypot(pos.x - px, pos.z - pz) <= POLICE_SEE_CRIME_DIST) {
        addWanted(state, 1, 'assault');
        break;
      }
    }
  }
}
