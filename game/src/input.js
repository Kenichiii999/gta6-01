// Keyboard + mouse-drag camera input. Raw DOM events become held movement
// axes, one-shot action flags, and camera orbit deltas. No pointer lock:
// the camera orbits while the mouse is dragged.
import { KEYS } from './config.js';

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;
export const ACTION_INTERACT = 8;
export const ACTION_PUNCH = 16;

const UP = new Set(KEYS.up);
const DOWN = new Set(KEYS.down);
const LEFT = new Set(KEYS.left);
const RIGHT = new Set(KEYS.right);
const RUN = new Set(KEYS.run);
const INTERACT = new Set(KEYS.interact);
const PUNCH = new Set(KEYS.punch);
const PAUSE = new Set(KEYS.pause);
const MUTE = new Set(KEYS.mute);
const CONFIRM = new Set(KEYS.confirm);

// Codes whose default browser behaviour (page scroll on arrows/space) we
// always suppress, repeats included.
const PREVENT = new Set([...KEYS.up, ...KEYS.down, ...KEYS.left, ...KEYS.right, ...KEYS.confirm, ...KEYS.pause]);

export function createInput(target) {
  const held = new Set();
  let actions = 0;
  let orbitX = 0;
  let orbitY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener('keydown', (event) => {
    if (PREVENT.has(event.code)) event.preventDefault();
    if (event.repeat) return;
    held.add(event.code);
    // Checked in this order, so a code in two sets would only fire the
    // first; in practice no code is in two sets.
    if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    else if (MUTE.has(event.code)) actions |= ACTION_MUTE;
    else if (INTERACT.has(event.code)) actions |= ACTION_INTERACT;
    else if (PUNCH.has(event.code)) actions |= ACTION_PUNCH;
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of
  // everything on blur, or the player would keep walking on their own.
  window.addEventListener('blur', () => {
    held.clear();
    dragging = false;
  });

  target.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    try { target.setPointerCapture(event.pointerId); } catch { /* no capture: drag still works */ }
  });
  target.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    orbitX += event.clientX - lastX;
    orbitY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  const endDrag = () => { dragging = false; };
  target.addEventListener('pointerup', endDrag);
  target.addEventListener('pointercancel', endDrag);

  const anyHeld = (set) => {
    for (const code of set) if (held.has(code)) return true;
    return false;
  };

  return {
    // { x, y } each in [-1, 1]: x = right - left, y = up - down (W = +1).
    axes() {
      return {
        x: (anyHeld(RIGHT) ? 1 : 0) - (anyHeld(LEFT) ? 1 : 0),
        y: (anyHeld(UP) ? 1 : 0) - (anyHeld(DOWN) ? 1 : 0),
      };
    },
    // True while either Shift is held.
    running() {
      return anyHeld(RUN);
    },
    // Mouse-drag pixel deltas since the last call (and zeroes them).
    takeOrbit() {
      const out = { dx: orbitX, dy: orbitY };
      orbitX = 0;
      orbitY = 0;
      return out;
    },
    // The one-shot ACTION_* bitmask since the last call (and zeroes it).
    // A press between two frames is never lost and never counted twice.
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
