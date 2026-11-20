// Neon Bay — keyboard + mouse-drag camera input. One job: turn raw DOM
// events into held movement axes, one-shot action flags, and camera orbit
// deltas. No pointer lock: the camera orbits while the mouse is dragged.

import { KEYS } from './config.js';

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;
export const ACTION_INTERACT = 8;
export const ACTION_PUNCH = 16;

function setOf(list) {
  return new Set(list);
}

const UP = setOf(KEYS.up);
const DOWN = setOf(KEYS.down);
const LEFT = setOf(KEYS.left);
const RIGHT = setOf(KEYS.right);
const RUN = setOf(KEYS.run);
const INTERACT = setOf(KEYS.interact);
const PUNCH = setOf(KEYS.punch);
const PAUSE = setOf(KEYS.pause);
const MUTE = setOf(KEYS.mute);
const CONFIRM = setOf(KEYS.confirm);

export function createInput(target) {
  const held = new Set();
  let actions = 0;
  let orbitDX = 0;
  let orbitDY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code)) {
        event.preventDefault();
      }
      return;
    }
    held.add(event.code);
    if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    else if (MUTE.has(event.code)) actions |= ACTION_MUTE;
    else if (INTERACT.has(event.code)) actions |= ACTION_INTERACT;
    else if (PUNCH.has(event.code)) actions |= ACTION_PUNCH;
    if (
      UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code)
      || CONFIRM.has(event.code) || PAUSE.has(event.code)
    ) {
      event.preventDefault();
    }
  });

  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });

  // A key released while the tab is hidden never sends keyup: let go of
  // everything on blur so the player never keeps walking on their own.
  window.addEventListener('blur', () => {
    held.clear();
    dragging = false;
  });

  target.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    target.setPointerCapture(event.pointerId);
  });
  target.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    orbitDX += event.clientX - lastX;
    orbitDY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  const endDrag = () => {
    dragging = false;
  };
  target.addEventListener('pointerup', endDrag);
  target.addEventListener('pointercancel', endDrag);

  function hasAny(set) {
    for (const code of set) if (held.has(code)) return true;
    return false;
  }

  return {
    /** Movement axes: x right, y forward (W = +1). Each in [-1, 1]. */
    axes() {
      const x = (hasAny(RIGHT) ? 1 : 0) - (hasAny(LEFT) ? 1 : 0);
      const y = (hasAny(UP) ? 1 : 0) - (hasAny(DOWN) ? 1 : 0);
      return { x, y };
    },
    /** True while either Shift key is held. */
    running() {
      return hasAny(RUN);
    },
    /** Mouse-drag orbit deltas in pixels since the last call. */
    takeOrbit() {
      const d = { dx: orbitDX, dy: orbitDY };
      orbitDX = 0;
      orbitDY = 0;
      return d;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
