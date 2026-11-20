// Neon Bay — every shared constant, palette, tuning number and key binding.
// Nothing in here is computed at runtime; every other module reads from here
// so the numbers the game agrees on live in exactly one place.

// The simulation's fixed step, in seconds: 60 updates a second whatever
// the display's rate.
export const STEP = 1 / 60;

// localStorage key for the single save slot.
export const SAVE_KEY = 'neon-bay.save.v1';

// City geometry: 9 blocks of 60 m separated by 12 m roads, on a 72 m pitch.
export const CITY = {
  blocks: 9,
  block: 60,
  road: 12,
  get pitch() { return this.block + this.road; }, // 72
  get half() { return (this.blocks * this.pitch) / 2; }, // 324
  minBuildingHeight: 8,
  maxBuildingHeight: 40,
  towerHeight: 88,
};

export const PALETTE = {
  skyTop: 0x3d8fd1,
  skyBottom: 0xbfe6f5,
  fog: 0xa8d4e8,
  sun: 0xffe3b3,
  sunIntensity: 2.6,
  hemiSky: 0xbfd9ff,
  hemiGround: 0x8a7a5f,
  hemiIntensity: 0.9,
  road: 0x3a3f46,
  sidewalk: 0xb9b3a4,
  sand: 0xe8d49a,
  ocean: 0x1e7fa8,
  oceanDeep: 0x0e5a80,
  grass: 0x7fae62,
  facades: [0xf2c9a0, 0xf5e6c8, 0xa8d0d8, 0xf2a7a7, 0xc9d6a3, 0xe8d5f2, 0xf7f3e8, 0x9fc3e8],
  roofs: [0x6b5a4a, 0x7a6a58, 0x5a6a72, 0x8a7a6a],
  landmark: {
    tower: 0x2e4a6b,
    hospital: 0xf2f2f2,
    police: 0x2f4a7a,
    garage: 0xd97b2f,
    bank: 0xc9a227,
  },
};

// On-foot player tuning (speeds in m/s).
export const PLAYER = {
  walkSpeed: 5,
  runSpeed: 9,
  radius: 0.55,
  accel: 40,
  turnRate: 12,
};

// Third-person orbit camera tuning. Default pitch is near-level (0.12):
// the old steep 0.42 pitch filled the spawn frame with empty sidewalk,
// while 0.12 keeps the horizon, street and buildings in view from the
// first frame and still shows the road ahead while driving.
export const CAMERA = {
  dist: 9,
  minDist: 4,
  maxDist: 20,
  pitch: 0.12,
  minPitch: 0.08,
  maxPitch: 1.1,
  fov: 60,
  near: 0.1,
  far: 1600,
};

// Key bindings, by KeyboardEvent.code. There is no C (camera) or R (reset)
// key: the game ships exactly these bindings.
export const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE'],
  punch: ['KeyF'],
  pause: ['KeyP', 'Escape'],
  mute: ['KeyM'],
  confirm: ['Enter', 'Space'],
};
