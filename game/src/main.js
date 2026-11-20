// Neon Bay — boot, the one loop, screens and HUD. One job: own the shared
// state every system gets, step the world in fixed 1/60 s slices, move
// between title / play / paused, and draw the HUD skeleton (cash, health,
// wanted stars, objective line, minimap canvas).
//
// ?seed=N fixes the world. ?shot=<name>&seed=N stages that scene instead of
// running the loop, paints it twice and sets window.__shotReady for a
// screenshot — the same pattern as the kit starter's main.js/shots.js.

import * as THREE from 'three';
import { CAMERA, STEP } from './config.js';
import { createRandom } from './random.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createCity } from './city.js';
import { createPlayer } from './player.js';
import { loadSave, saveGame } from './save.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const hud = document.getElementById('hud');
const titleScreen = document.getElementById('title');
const pauseScreen = document.getElementById('paused');
const cashEl = document.getElementById('cash');
const healthFill = document.getElementById('health-fill');
const wantedEl = document.getElementById('wanted');
const objectiveEl = document.getElementById('objective');
const minimap = document.getElementById('minimap');
const continueBtn = document.getElementById('continue-btn');
const startBtn = document.getElementById('start-btn');
const minimapCtx = minimap.getContext('2d');

// --- Shared state (the contract every later slice builds on) --------------
const renderer = createRenderer(canvas);
const city = createCity(renderer.scene, createRandom(seed));
const garage = city.landmarks.garage;

const state = {
  time: 0,
  seed,
  screen: SCREEN_TITLE,
  cash: 0,
  health: 100,
  maxHealth: 100,
  wanted: 0,
  missionIndex: 0,
  mission: null,
  player: {
    pos: new THREE.Vector3(garage ? garage.pos.x : 0, 0, garage ? garage.pos.z + 18 : 0),
    heading: Math.PI,
    speed: 0,
    onFoot: true,
    car: null,
    mesh: null,
  },
  camera: { yaw: 0, pitch: CAMERA.pitch, dist: CAMERA.dist },
  city,
  traffic: [],
  peds: [],
  police: [],
  stats: { carsStolen: 0, missionsDone: 0 },
  muted: false,
};

const player = createPlayer(state, renderer.scene);

// Playtest / debug hook: the whole state, live, for the browser console.
window.__game = state;

function formatCash(value) {
  return `$${Math.floor(value).toLocaleString('en-US')}`;
}

function updateHud() {
  cashEl.textContent = formatCash(state.cash);
  healthFill.style.width = `${Math.max(0, Math.min(100, (state.health / state.maxHealth) * 100))}%`;
  wantedEl.textContent = '★'.repeat(state.wanted) + '☆'.repeat(Math.max(0, 5 - state.wanted));
  objectiveEl.textContent = state.mission
    ? `${state.mission.title} — ${state.mission.text}`
    : 'Talk to Vera at the garage. First mission coming soon.';
  drawMinimap();
}

/** Minimap: roads as grey lines, the player as a yellow arrow, the garage as a dot. */
function drawMinimap() {
  const size = minimap.width;
  const half = state.city.half + 60;
  const toMap = (v) => ((v + half) / (half * 2)) * size;
  minimapCtx.fillStyle = '#0d1b26';
  minimapCtx.fillRect(0, 0, size, size);
  minimapCtx.strokeStyle = '#5a6a72';
  minimapCtx.lineWidth = 2;
  for (const road of state.city.roads) {
    minimapCtx.beginPath();
    minimapCtx.moveTo(toMap(road.x1), toMap(road.z1));
    minimapCtx.lineTo(toMap(road.x2), toMap(road.z2));
    minimapCtx.stroke();
  }
  // Beach strip along the south edge.
  minimapCtx.fillStyle = '#e8d49a';
  minimapCtx.fillRect(0, toMap(state.city.half), size, size - toMap(state.city.half));
  minimapCtx.fillStyle = '#1e7fa8';
  minimapCtx.fillRect(0, toMap(state.city.half + 40), size, size - toMap(state.city.half + 40));
  // Garage marker.
  if (garage) {
    minimapCtx.fillStyle = '#ff9a3d';
    minimapCtx.beginPath();
    minimapCtx.arc(toMap(garage.pos.x), toMap(garage.pos.z), 4, 0, Math.PI * 2);
    minimapCtx.fill();
  }
  // Player arrow, pointing along the heading.
  const px = toMap(state.player.pos.x);
  const pz = toMap(state.player.pos.z);
  minimapCtx.save();
  minimapCtx.translate(px, pz);
  minimapCtx.rotate(state.player.heading);
  minimapCtx.fillStyle = '#ffd23d';
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -6);
  minimapCtx.lineTo(4, 5);
  minimapCtx.lineTo(-4, 5);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.restore();
}

function showScreen(screen) {
  state.screen = screen;
  titleScreen.classList.toggle('hidden', screen !== SCREEN_TITLE);
  pauseScreen.classList.toggle('hidden', screen !== SCREEN_PAUSED);
  hud.classList.toggle('hidden', screen === SCREEN_TITLE);
  if (screen === SCREEN_TITLE) {
    const save = loadSave();
    continueBtn.classList.toggle('hidden', !save);
    status.textContent = 'Neon Bay. Press Enter to start.';
  }
}

function startGame(fromSave) {
  const save = fromSave ? loadSave() : null;
  if (save) {
    state.cash = save.cash;
    state.missionIndex = save.missionIndex;
    state.health = save.health;
    if (save.pos) state.player.pos.set(save.pos.x, 0, save.pos.z);
  } else {
    state.cash = 0;
    state.missionIndex = 0;
    state.health = state.maxHealth;
    state.player.pos.set(garage ? garage.pos.x : 0, 0, garage ? garage.pos.z + 18 : 0);
    state.player.heading = Math.PI;
  }
  state.wanted = 0;
  state.mission = null;
  showScreen(SCREEN_PLAY);
  status.textContent = 'Playing. WASD to move, Shift to run, drag to look around.';
  updateHud();
}

function runShot(name) {
  const staged = stageShot(name, state);
  showScreen(staged.screen);
  updateHud();
  let painted = 0;
  function paint() {
    renderer.updateCamera(state.player.pos, state.camera, STEP);
    renderer.draw(state);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;

  function step() {
    state.time += STEP;
    // Camera orbit from mouse drag.
    const orbit = input.takeOrbit();
    if (orbit.dx !== 0 || orbit.dy !== 0) {
      state.camera.yaw -= orbit.dx * 0.005;
      state.camera.pitch = Math.max(
        0.08,
        Math.min(1.1, state.camera.pitch + orbit.dy * 0.004),
      );
    }
    if (state.screen === SCREEN_PLAY) {
      player.update(STEP, input.axes(), input.running(), state.camera.yaw);
      // Autosave every 10 s of play.
      saveTimer += STEP;
      if (saveTimer >= 10) {
        saveTimer = 0;
        saveGame(state);
      }
    }
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) state.muted = !state.muted;
    if (actions & ACTION_CONFIRM && state.screen === SCREEN_TITLE) startGame(false);
    else if (actions & ACTION_PAUSE && state.screen === SCREEN_PLAY) {
      showScreen(SCREEN_PAUSED);
      status.textContent = 'Paused.';
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && state.screen === SCREEN_PAUSED) {
      showScreen(SCREEN_PLAY);
      status.textContent = 'Playing.';
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
    renderer.updateCamera(state.player.pos, state.camera, STEP);
    renderer.draw(state);
    if (state.screen === SCREEN_PLAY) updateHud();
  }

  startBtn.addEventListener('click', () => startGame(false));
  continueBtn.addEventListener('click', () => startGame(true));

  // Leaving the tab pauses a running game rather than letting it run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.screen === SCREEN_PLAY) {
      showScreen(SCREEN_PAUSED);
      status.textContent = 'Paused.';
    }
  });

  showScreen(SCREEN_TITLE);
  updateHud();
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
