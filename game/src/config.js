// Neon Bay — shared constants, palette, tuning and key bindings.
// One job: every number the other modules agree on lives here.

export const STEP = 1 / 60;
export const SAVE_KEY = 'neon-bay.save.v1';

// --- City layout -----------------------------------------------------------
export const CITY = {
  blocks: 9, // 9x9 blocks
  block: 60, // metres of buildable block
  road: 12, // metres of road between blocks
  get pitch() {
    return this.block + this.road;
  },
  // City extent (half-size) including the outer ring road.
  get half() {
    return (this.blocks * this.pitch) / 2;
  },
  minBuildingHeight: 8,
  maxBuildingHeight: 40,
  towerHeight: 88, // Neon Bay Tower, the tallest building, dead centre
};

// --- Sun-soaked palette ----------------------------------------------------
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
  // Pastel building facades (sun-soaked coastal city).
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

// --- Player tuning ---------------------------------------------------------
export const PLAYER = {
  walkSpeed: 5, // m/s
  runSpeed: 9, // m/s while Shift is held
  radius: 0.55, // collision circle radius
  accel: 40, // m/s^2 toward the target velocity
  turnRate: 12, // heading lerp rate
};

// --- Camera tuning ---------------------------------------------------------
export const CAMERA = {
  dist: 9,
  minDist: 4,
  maxDist: 20,
  pitch: 0.42, // radians looking down
  minPitch: 0.08,
  maxPitch: 1.1,
  fov: 60,
  near: 0.1,
  far: 1600,
};

// --- Keys ------------------------------------------------------------------
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
