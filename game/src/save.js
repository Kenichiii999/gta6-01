// Neon Bay — save/load. One job: persist the player's progress in
// localStorage under namespaced keys and read it back, tolerating a missing
// or corrupt save (a bad save is simply no save).

import { SAVE_KEY } from './config.js';

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      cash: typeof data.cash === 'number' ? data.cash : 0,
      missionIndex: typeof data.missionIndex === 'number' ? data.missionIndex : 0,
      health: typeof data.health === 'number' ? data.health : 100,
      pos: Array.isArray(data.pos) && data.pos.length === 3
        ? { x: data.pos[0] || 0, y: 0, z: data.pos[2] || 0 }
        : null,
      savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function saveGame(state) {
  try {
    const data = {
      cash: state.cash,
      missionIndex: state.missionIndex,
      health: state.health,
      pos: [state.player.pos.x, state.player.pos.y, state.player.pos.z],
      savedAt: Date.now(),
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    // Storage can be off (private windows): progress then lasts this visit.
    return false;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to do: no save, no problem.
  }
}
