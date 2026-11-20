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
// SLICES A–D wired: foundation + vehicles/traffic + police/combat +
// missions/HUD/audio, per DESIGN.md §2.4.
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
import { createMissions, startMission, updateMissions } from './missions.js';
import { createHud, updateHud } from './hud.js';
import { createAudio, updateAudio } from './audio.js';
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

// Slice B: vehicles + traffic. Slice C: police + combat. Slice D:
// missions + HUD + audio (hud.js owns the HUD; see §9.11).
createTraffic(state, renderer.scene);
createPolice(state, renderer.scene);
createMissions(state, renderer.scene);
createHud(state, renderer.scene);
createAudio(state);

// --- HUD (slice D: hud.js owns it) ----------------------------------------
// The local updateHud/drawMinimap skeleton is gone (§9.11): hud.js is the
// only code that draws the HUD / minimap. This helper just calls it.
function hudUpdate() {
  updateHud(state, STEP);
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
  // Slice D: mission 1 ("First Wheels") auto-starts when play begins —
  // but never when the game is already complete.
  if (state.missionIndex < 5) startMission(state, state.missionIndex);
  showScreen(SCREEN_PLAY);
  status.textContent = 'Playing. WASD to move, Shift to run, drag to look around.';
  hudUpdate();
}

// --- Shot mode -------------------------------------------------------------
function runShot(name) {
  const staged = stageShot(name, state);
  showScreen(staged.screen);
  hudUpdate();
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
    // One-shot: consume INTERACT after the first step that uses it, or a
    // slow frame's fixed-step catch-up (N steps) would toggle enter/exit
    // N times per single press (even N = a complete no-op).
    if (frameActions & ACTION_INTERACT) {
      handleCarInteract(state);
      frameActions &= ~ACTION_INTERACT;
    }
    // Slice C: the punch. Must run AFTER player.update(), because the
    // punch lunge offsets the player mesh and player.update() re-asserts
    // the mesh position every step.
    updateCombat(state, STEP, frameActions);
    // Same one-shot rule for PUNCH: consume it after the first step, so
    // a slow frame cannot re-fire the punch (its cooldown already blunts
    // this, but the bit itself must not survive the frame).
    frameActions &= ~ACTION_PUNCH;
    updateTraffic(state, STEP);
    // Slice C: police chase / arrest / busted / wasted.
    updatePolice(state, STEP);
    // Slice D: mission objectives + audio layers.
    updateMissions(state, STEP);
    updateAudio(state, STEP);

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
    if (state.screen === SCREEN_PLAY) hudUpdate();
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
