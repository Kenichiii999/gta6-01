// Persist the player's progress in localStorage under one namespaced key
// and read it back, tolerating a missing or corrupt save (a bad save is
// simply no save). Only cash, mission index, health, player position and a
// timestamp are saved — never wanted, cars, traffic, police, stats or mute.
import { SAVE_KEY } from './config.js';

// -> { cash, missionIndex, health, pos: { x, y, z } | null, savedAt } | null
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const cash = typeof data.cash === 'number' ? data.cash : 0;
    const missionIndex = typeof data.missionIndex === 'number' ? data.missionIndex : 0;
    const health = typeof data.health === 'number' ? data.health : 100;
    let pos = null;
    if (Array.isArray(data.pos) && data.pos.length === 3) {
      pos = { x: Number(data.pos[0]) || 0, y: 0, z: Number(data.pos[2]) || 0 };
    }
    return { cash, missionIndex, health, pos, savedAt: data.savedAt || 0 };
  } catch {
    return null;
  }
}

// -> true on success, false when storage is unavailable (private windows).
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
    return false;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage can be off: there is simply nothing to clear.
  }
}
