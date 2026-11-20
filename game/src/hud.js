// Neon Bay — HUD. One job: everything the player reads while playing —
// cash, health, wanted stars, the objective line, mission banners, speed,
// the minimap, the controls hint and the mute indicator.
//
// Extends the HUD skeleton already in index.html (element ids cash,
// health-fill, wanted, objective, minimap); the extra pieces (banner,
// speed, hint, mute) are created here so index.html stays untouched.
// DOM writes are cached: textContent / styles only change when the value
// actually changed, so the per-frame cost stays near zero.

function formatCash(value) {
  return `$${Math.floor(value).toLocaleString('en-US')}`;
}

function el(tag, id, parent, text) {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (text) node.textContent = text;
  parent.appendChild(node);
  return node;
}

/**
 * Build the HUD extras and store the api on state._hud so missions.js can
 * show banners without importing this module. `scene` is accepted for the
 * shared createXxx(state, scene) signature; the HUD is DOM + 2D canvas.
 */
export function createHud(state, scene) {
  const hud = document.getElementById('hud');
  const cashEl = document.getElementById('cash');
  const healthFill = document.getElementById('health-fill');
  const wantedEl = document.getElementById('wanted');
  const objectiveEl = document.getElementById('objective');
  const minimap = document.getElementById('minimap');
  const minimapCtx = minimap ? minimap.getContext('2d') : null;

  // --- Extra HUD pieces (created once, styled inline) -----------------------
  const banner = el('div', 'banner', hud);
  banner.style.cssText = [
    'position:absolute', 'top:64px', 'left:50%', 'transform:translateX(-50%)',
    'text-align:center', 'padding:12px 28px', 'border-radius:10px',
    'background:rgba(0,0,0,.62)', 'border:1px solid rgba(255,210,61,.7)',
    'opacity:0', 'transition:opacity .35s', 'pointer-events:none',
    'max-width:520px',
  ].join(';');
  const bannerTitle = el('div', null, banner);
  bannerTitle.style.cssText = 'font-size:26px;font-weight:900;letter-spacing:2px;color:#ffd23d';
  const bannerSub = el('div', null, banner);
  bannerSub.style.cssText = 'font-size:14px;font-weight:600;color:#dfeef5;margin-top:4px;line-height:1.4';

  const speedEl = el('div', 'speed', hud, '');
  speedEl.style.cssText = [
    'position:absolute', 'right:16px', 'bottom:16px', 'font-size:24px',
    'font-weight:800', 'color:#fff', 'display:none',
  ].join(';');

  const hintEl = el('div', 'controls-hint', hud, 'WASD move · Shift run · E enter car · F punch · Space handbrake · M mute');
  hintEl.style.cssText = [
    'position:absolute', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
    'font-size:12px', 'color:rgba(255,255,255,.75)', 'background:rgba(0,0,0,.35)',
    'padding:5px 12px', 'border-radius:6px', 'white-space:nowrap',
  ].join(';');

  const muteEl = el('div', 'mute-indicator', hud, '🔇 MUTED');
  muteEl.style.cssText = [
    'position:absolute', 'right:16px', 'bottom:52px', 'font-size:13px',
    'font-weight:700', 'color:#ffb3b3', 'background:rgba(0,0,0,.5)',
    'padding:4px 10px', 'border-radius:6px', 'display:none',
  ].join(';');

  let bannerTimer = 0;

  const api = {
    /** Show a centre banner for `ms` milliseconds (briefing, completion…). */
    banner(title, sub, ms) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub || '';
      bannerSub.style.display = sub ? '' : 'none';
      banner.style.opacity = '1';
      if (bannerTimer) window.clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => {
        banner.style.opacity = '0';
      }, ms || 4000);
    },
    hideBanner() {
      if (bannerTimer) window.clearTimeout(bannerTimer);
      banner.style.opacity = '0';
    },
    /** Draw the minimap now (also used by updateHud). */
    drawMinimap() {
      drawMinimap(state, minimapCtx, minimap);
    },
  };
  state._hud = api;
  return api;
}

// --- Minimap ------------------------------------------------------------------

/** Read a world position out of a traffic / police entry, whatever its shape. */
function entryPos(entry) {
  if (!entry) return null;
  if (entry.pos && typeof entry.pos.x === 'number') return entry.pos;
  if (typeof entry.x === 'number' && typeof entry.z === 'number') return entry;
  if (entry.mesh && entry.mesh.position) return entry.mesh.position;
  return null;
}

function drawMinimap(state, ctx, canvas) {
  if (!ctx || !canvas || !state.city) return;
  const size = canvas.width;
  const half = state.city.half + 60;
  const toMap = (v) => ((v + half) / (half * 2)) * size;

  ctx.fillStyle = '#0d1b26';
  ctx.fillRect(0, 0, size, size);

  // Roads.
  ctx.strokeStyle = '#5a6a72';
  ctx.lineWidth = 2;
  for (const road of state.city.roads || []) {
    ctx.beginPath();
    ctx.moveTo(toMap(road.x1), toMap(road.z1));
    ctx.lineTo(toMap(road.x2), toMap(road.z2));
    ctx.stroke();
  }

  // Beach strip + ocean along the south edge.
  ctx.fillStyle = '#e8d49a';
  ctx.fillRect(0, toMap(state.city.half), size, size - toMap(state.city.half));
  ctx.fillStyle = '#1e7fa8';
  ctx.fillRect(0, toMap(state.city.half + 40), size, size - toMap(state.city.half + 40));

  // Garage dot (mission hub).
  const garage = state.city.landmarks && state.city.landmarks.garage;
  if (garage) {
    ctx.fillStyle = '#ff9a3d';
    ctx.beginPath();
    ctx.arc(toMap(garage.pos.x), toMap(garage.pos.z), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cash drops (green) while Payday Pickup is active.
  const sys = state._missions;
  if (sys && Array.isArray(sys.drops)) {
    ctx.fillStyle = '#7dff9a';
    for (const drop of sys.drops) {
      if (drop.taken) continue;
      ctx.beginPath();
      ctx.arc(toMap(drop.pos.x), toMap(drop.pos.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Traffic cars (white dots) — defensive: slice B may not have run yet.
  ctx.fillStyle = '#ffffff';
  for (const car of state.traffic || []) {
    const p = entryPos(car);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(toMap(p.x), toMap(p.z), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Police (red dots).
  ctx.fillStyle = '#ff4d4d';
  for (const cop of state.police || []) {
    const p = entryPos(cop);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(toMap(p.x), toMap(p.z), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mission marker: pulsing yellow diamond.
  if (state.mission && state.mission.marker) {
    const m = state.mission.marker;
    const pulse = 5 + Math.sin(state.time * 4) * 1.5;
    ctx.save();
    ctx.translate(toMap(m.x), toMap(m.z));
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffd23d';
    ctx.fillRect(-pulse / 2, -pulse / 2, pulse, pulse);
    ctx.restore();
  }

  // Player arrow, pointing along the heading.
  const px = toMap(state.player.pos.x);
  const pz = toMap(state.player.pos.z);
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(state.player.heading);
  ctx.fillStyle = '#ffd23d';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 5);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --- Per-frame update -----------------------------------------------------------

const cache = {
  cash: null,
  health: null,
  wanted: null,
  objective: null,
  speed: null,
  muted: null,
};

/**
 * Refresh the HUD from state. Cheap by design: every text/style write is
 * guarded by a cached-value comparison, and the minimap redraws only while
 * playing (it is the only per-frame canvas work).
 */
export function updateHud(state, dt) {
  const hud = state._hud;
  const cashEl = document.getElementById('cash');
  const healthFill = document.getElementById('health-fill');
  const wantedEl = document.getElementById('wanted');
  const objectiveEl = document.getElementById('objective');
  const minimap = document.getElementById('minimap');
  const speedEl = document.getElementById('speed');
  const muteEl = document.getElementById('mute-indicator');

  const cashText = formatCash(state.cash || 0);
  if (cashText !== cache.cash && cashEl) {
    cashEl.textContent = cashText;
    cache.cash = cashText;
  }

  const healthPct = Math.max(0, Math.min(100, ((state.health || 0) / (state.maxHealth || 100)) * 100));
  if (healthPct !== cache.health && healthFill) {
    healthFill.style.width = `${healthPct}%`;
    healthFill.style.background = healthPct < 30
      ? 'linear-gradient(90deg, #d63a37, #ff7a5d)'
      : 'linear-gradient(90deg, #37d67a, #9be15d)';
    cache.health = healthPct;
  }

  const wanted = Math.max(0, Math.min(5, state.wanted || 0));
  if (wanted !== cache.wanted && wantedEl) {
    wantedEl.textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    cache.wanted = wanted;
  }

  // Objective line: current mission + live text, plus timer when timed.
  let objectiveText;
  if (state.mission) {
    objectiveText = `${state.mission.title} — ${state.mission.text}`;
    if (state.mission.timerLeft > 0 && state.mission.timer) {
      objectiveText += ` (${Math.ceil(state.mission.timerLeft)}s)`;
    }
  } else if (state.gameComplete) {
    objectiveText = 'NEON BAY LEGEND — you own this city.';
  } else {
    objectiveText = 'Talk to Vera at the garage. First mission coming soon.';
  }
  if (objectiveText !== cache.objective && objectiveEl) {
    objectiveEl.textContent = objectiveText;
    cache.objective = objectiveText;
  }

  // Speed readout, only while driving.
  const car = state.player && state.player.car;
  let speedText = null;
  if (car) {
    const v = typeof car.speed === 'number'
      ? car.speed
      : (car.velocity ? Math.hypot(car.velocity.x || 0, car.velocity.z || 0) : (state.player.speed || 0));
    speedText = `${Math.round(Math.abs(v) * 3.6)} km/h`;
  }
  if (speedText !== cache.speed && speedEl) {
    speedEl.textContent = speedText || '';
    speedEl.style.display = speedText ? '' : 'none';
    cache.speed = speedText;
  }

  // Mute indicator.
  if (state.muted !== cache.muted && muteEl) {
    muteEl.style.display = state.muted ? '' : 'none';
    cache.muted = state.muted;
  }

  // Minimap (2D canvas redraw each frame while playing).
  if (hud && state.screen === 'play') {
    hud.drawMinimap();
  } else if (hud && minimap && state.screen === 'title') {
    // Keep the title-screen minimap painted once so it is never blank.
    hud.drawMinimap();
  }
}
