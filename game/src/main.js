// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps (several in a slow frame, none in a fast one), and the
// renderer paints what is there. The game moves between five screens:
// title, play, paused, busted and wasted (the last two are owned by the
// police slice, which builds their overlays itself).
//
// ?seed=N fixes the city layout. ?shot=title (with &seed=N) stages the
// title scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
//
// SLICE A — foundation only. The per-step calls for slices B/C/D
// (vehicles, traffic, police, combat, missions, HUD, audio) are marked
// EXTENSION POINT below and must not be called until those modules exist.
import * as THREE from 'three';
import { CAMERA, STEP } from './config.js';
import { createRandom } from './random.js';
import { ACTION_CONFIRM, ACTION_INTERACT, ACTION_MUTE, ACTION_PAUSE, ACTION_PUNCH, createInput } from './input.js';
import { createRenderer, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createCity } from './city.js';
import { createPlayer } from './player.js';
import { createTraffic, updateTraffic } from './traffic.js';
import { handleCarInteract, updateDrive } from './cars.js';
import { createPolice, updatePolice } from './police.js';
import { updateCombat } from './combat.js';
import { loadSave, saveGame } from './save.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;
const AUTOSAVE_SECONDS = 10;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('game');
const status = document.getElementById('status');
const hudEl = document.getElementById('hud');
const titleEl = document.getElementById('title');
const pausedEl = document.getElementById('paused');
const cashEl = document.getElementById('cash');
const healthFillEl = document.getElementById('health-fill');
const wantedEl = document.getElementById('wanted');
const objectiveEl = document.getElementById('objective');
const minimapEl = document.getElementById('minimap');
const minimapCtx = minimapEl.getContext('2d');
const continueBtn = document.getElementById('continue-btn');
const startBtn = document.getElementById('start-btn');

// --- World ----------------------------------------------------------------
const renderer = createRenderer(canvas);
const city = createCity(renderer.scene, createRandom(seed));
const garage = city.landmarks.garage;

// --- Shared state (the contract every system builds on) -------------------
const state = {
  time: 0,
  seed,
  screen: SCREEN_TITLE,
  cash: 0,
  health: 100,
  maxHealth: 100,
  wanted: 0,
  lastWantedReason: undefined,
  missionIndex: 0,
  mission: null,
  gameComplete: false,
  player: {
    pos: new THREE.Vector3(garage.pos.x, 0, garage.pos.z + 18),
    heading: Math.PI,
    speed: 0,
    onFoot: true,
    car: null,
    mesh: null,
  },
  camera: { yaw: 0, pitch: CAMERA.pitch, dist: CAMERA.dist },
  city,
  traffic: [],
  parkedCars: [],
  peds: [],
  police: [],
  stats: { carsStolen: 0, missionsDone: 0 },
  muted: false,
  shakeTime: 0,
  _missions: undefined,
  _hud: undefined,
  _audio: undefined,
};

const player = createPlayer(state, renderer.scene);
window.__game = state;

// Slice B: vehicles + traffic. Slice C: police + combat. (Slice D adds
// createMissions / createHud / createAudio here, in that order.)
createTraffic(state, renderer.scene);
createPolice(state, renderer.scene);

// --- HUD (slice-A skeleton) ------------------------------------------------
// Slice D replaces this whole section with hud.js (banner, speed, mute
// indicator, fuller minimap) and main.js then calls state._hud instead.
// Until then the local versions below own the HUD, per the foundation spec.
function drawMinimap() {
  const size = 180;
  const half = city.half + 60;
  const toMap = (v) => ((v + half) / (half * 2)) * size;
  const ctx = minimapCtx;
  ctx.fillStyle = '#0d1b26';
  ctx.fillRect(0, 0, size, size);
  // Roads.
  ctx.strokeStyle = '#5a6a72';
  ctx.lineWidth = 2;
  for (const c of city.roadLines) {
    ctx.beginPath(); ctx.moveTo(toMap(-half), toMap(c)); ctx.lineTo(toMap(half), toMap(c)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(toMap(c), toMap(-half)); ctx.lineTo(toMap(c), toMap(half)); ctx.stroke();
  }
  // Beach strip, then ocean.
  ctx.fillStyle = '#e8d49a';
  ctx.fillRect(0, toMap(half), size, size - toMap(half));
  ctx.fillStyle = '#1e7fa8';
  ctx.fillRect(0, toMap(half + 40), size, size - toMap(half + 40));
  // Garage dot.
  ctx.fillStyle = '#ff9a3d';
  ctx.beginPath(); ctx.arc(toMap(garage.pos.x), toMap(garage.pos.z), 4, 0, Math.PI * 2); ctx.fill();
  // Player arrow.
  const px = toMap(state.player.pos.x);
  const py = toMap(state.player.pos.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(state.player.heading);
  ctx.fillStyle = '#ffd23d';
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function updateHud() {
  cashEl.textContent = `$${state.cash.toLocaleString('en-US')}`;
  healthFillEl.style.width = `${Math.max(0, Math.min(100, (state.health / state.maxHealth) * 100))}%`;
  wantedEl.textContent = '★'.repeat(state.wanted) + '☆'.repeat(5 - state.wanted);
  if (state.gameComplete) {
    objectiveEl.textContent = 'NEON BAY LEGEND — you own this city.';
  } else if (state.mission) {
    objectiveEl.textContent = `${state.mission.title} — ${state.mission.text}`;
  } else {
    objectiveEl.textContent = 'Talk to Vera at the garage. First mission coming soon.';
  }
  drawMinimap();
}

// --- Screens ---------------------------------------------------------------
function showScreen(screen) {
  state.screen = screen;
  titleEl.classList.toggle('hidden', screen !== SCREEN_TITLE);
  pausedEl.classList.toggle('hidden', screen !== SCREEN_PAUSED);
  hudEl.classList.toggle('hidden', screen === SCREEN_TITLE);
  if (screen === SCREEN_TITLE) {
    const save = loadSave();
    continueBtn.classList.toggle('hidden', !save);
    status.textContent = 'Neon Bay. Press Enter to start.';
  }
}

function startGame(fromSave) {
  if (fromSave) {
    const save = loadSave();
    if (save) {
      state.cash = save.cash;
      state.missionIndex = save.missionIndex;
      state.health = save.health;
      if (save.pos) state.player.pos.set(save.pos.x, 0, save.pos.z);
    }
  } else {
    state.cash = 0;
    state.missionIndex = 0;
    state.health = state.maxHealth;
    state.player.pos.set(garage.pos.x, 0, garage.pos.z + 18);
    state.player.heading = Math.PI;
  }
  state.wanted = 0;
  state.mission = null;
  state.player.onFoot = true;
  state.player.car = null;
  state.player.speed = 0;
  // EXTENSION POINT (slice D): if no mission is active and
  // state.missionIndex < 5, startMission(state, state.missionIndex) here —
  // mission 1 ("First Wheels") auto-starts when play begins.
  showScreen(SCREEN_PLAY);
  status.textContent = 'Playing. WASD to move, Shift to run, drag to look around.';
  updateHud();
}

// --- Shot mode -------------------------------------------------------------
function runShot(name) {
  const staged = stageShot(name, state);
  showScreen(staged.screen);
  updateHud();
  let painted = 0;
  function paint() {
    renderer.updateCamera(state.player.pos, state.camera, STEP, state.shakeTime);
    renderer.draw(state);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

// --- Game loop -------------------------------------------------------------
function runGame() {
  const input = createInput(canvas);
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;
  // The one-shot actions taken this frame, consumed once by the screen
  // logic AND passed on to combat / car-interact (a second takeActions()
  // call would see nothing).
  let frameActions = 0;

  function handleActions() {
    frameActions = input.takeActions();
    if (frameActions & ACTION_MUTE) state.muted = !state.muted;
    if ((frameActions & ACTION_CONFIRM) && state.screen === SCREEN_TITLE) {
      startGame(false);
    } else if ((frameActions & ACTION_PAUSE) && state.screen === SCREEN_PLAY) {
      showScreen(SCREEN_PAUSED);
      status.textContent = 'Paused.';
    } else if ((frameActions & (ACTION_PAUSE | ACTION_CONFIRM)) && state.screen === SCREEN_PAUSED) {
      showScreen(SCREEN_PLAY);
      status.textContent = 'Playing. WASD to move, Shift to run, drag to look around.';
    }
    // Busted/wasted resume is owned by police.js's own Enter/Space
    // listener (slice C), not by main.js.
  }

  function step() {
    state.time += STEP;
    // Camera orbit from mouse drag (title and play alike).
    const orbit = input.takeOrbit();
    if (orbit.dx !== 0 || orbit.dy !== 0) {
      state.camera.yaw -= orbit.dx * 0.005;
      state.camera.pitch = Math.max(
        CAMERA.minPitch,
        Math.min(CAMERA.maxPitch, state.camera.pitch + orbit.dy * 0.004),
      );
    }
    if (state.screen !== SCREEN_PLAY) return;

    if (state.player.onFoot) {
      player.update(STEP, input.axes(), input.running(), state.camera.yaw);
    } else {
      updateDrive(state, STEP, input);
    }
    // E-key: enter / exit a car ('entered' | 'exited' | 'too-fast' | null).
    if (frameActions & ACTION_INTERACT) handleCarInteract(state);
    // Slice C: the punch. Must run AFTER player.update(), because the
    // punch lunge offsets the player mesh and player.update() re-asserts
    // the mesh position every step.
    updateCombat(state, STEP, frameActions);
    updateTraffic(state, STEP);
    // Slice C: police chase / arrest / busted / wasted.
    updatePolice(state, STEP);
    // EXTENSION POINT (slice D): updateMissions(state, STEP).
    // EXTENSION POINT (slice D): updateAudio(state, STEP).

    // Autosave every 10 s of play.
    saveTimer += STEP;
    if (saveTimer >= AUTOSAVE_SECONDS) {
      saveTimer = 0;
      saveGame(state);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (state.screen === SCREEN_TITLE || state.screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (state.screen === SCREEN_TITLE || state.screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    // Camera shake (set by police rams/punches, slice C) decays here and is
    // purely visual: it never moves player.pos or affects collision.
    if (state.shakeTime > 0) state.shakeTime = Math.max(0, state.shakeTime - STEP);
    renderer.updateCamera(state.player.pos, state.camera, STEP, state.shakeTime);
    renderer.draw(state);
    if (state.screen === SCREEN_PLAY) updateHud();
  }

  startBtn.addEventListener('click', () => startGame(false));
  continueBtn.addEventListener('click', () => startGame(true));

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.screen === SCREEN_PLAY) {
      showScreen(SCREEN_PAUSED);
      status.textContent = 'Paused.';
    }
  });

  showScreen(SCREEN_TITLE);
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
