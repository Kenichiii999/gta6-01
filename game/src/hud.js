// Everything the player reads while playing — cash, health, wanted
// stars, the objective line, mission banners, speed, the minimap, the
// controls hint and the mute indicator. Extends the HUD skeleton already
// in index.html (element ids cash, health-fill, wanted, objective,
// minimap); the extra pieces (banner, speed, hint, mute) are created
// here so index.html stays untouched. DOM writes are cached: text /
// styles only change when the value actually changed, so the per-frame
// cost stays near zero.

function readPos(entry) {
  if (!entry) return null;
  if (entry.pos) return { x: entry.pos.x, z: entry.pos.z };
  if (typeof entry.x === 'number' && typeof entry.z === 'number') return { x: entry.x, z: entry.z };
  if (entry.mesh && entry.mesh.position) return { x: entry.mesh.position.x, z: entry.mesh.position.z };
  if (entry.group && entry.group.position) return { x: entry.group.position.x, z: entry.group.position.z };
  if (entry.car) return readPos(entry.car);
  return null;
}

export function createHud(state, scene) {
  const hudEl = document.getElementById('hud');
  const cashEl = document.getElementById('cash');
  const healthFillEl = document.getElementById('health-fill');
  const wantedEl = document.getElementById('wanted');
  const objectiveEl = document.getElementById('objective');
  const minimapEl = document.getElementById('minimap');
  const minimapCtx = minimapEl ? minimapEl.getContext('2d') : null;

  // Banner (inside #hud).
  const bannerEl = document.createElement('div');
  bannerEl.id = 'banner';
  bannerEl.style.cssText = 'position:absolute;top:64px;left:50%;transform:translateX(-50%);'
    + 'padding:12px 28px;border-radius:10px;background:rgba(0,0,0,.62);'
    + 'border:1px solid #ffd23d;opacity:0;transition:opacity .35s;'
    + 'pointer-events:none;max-width:520px;text-align:center;';
  const bannerTitle = document.createElement('div');
  bannerTitle.style.cssText = 'font-size:26px;font-weight:900;letter-spacing:2px;color:#ffd23d;';
  const bannerSub = document.createElement('div');
  bannerSub.style.cssText = 'font-size:14px;font-weight:600;color:#dfeef5;line-height:1.4;';
  bannerEl.appendChild(bannerTitle);
  bannerEl.appendChild(bannerSub);
  if (hudEl) hudEl.appendChild(bannerEl);

  // Speed readout (driving only).
  const speedEl = document.createElement('div');
  speedEl.id = 'speed';
  speedEl.style.cssText = 'position:absolute;right:16px;bottom:16px;font-size:24px;'
    + 'font-weight:800;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.7);display:none;';
  if (hudEl) hudEl.appendChild(speedEl);

  // Controls hint.
  const hintEl = document.createElement('div');
  hintEl.id = 'controls-hint';
  hintEl.textContent = 'WASD move · Shift run · E enter car · F punch · Space handbrake · M mute';
  hintEl.style.cssText = 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);'
    + 'font-size:12px;color:#dfeef5;background:rgba(0,0,0,.45);padding:6px 12px;border-radius:12px;'
    + 'pointer-events:none;white-space:nowrap;';
  if (hudEl) hudEl.appendChild(hintEl);

  // Mute indicator.
  const muteEl = document.createElement('div');
  muteEl.id = 'mute-indicator';
  muteEl.textContent = '🔇 MUTED';
  muteEl.style.cssText = 'position:absolute;right:16px;bottom:52px;font-size:13px;'
    + 'font-weight:700;color:#ffb3b3;display:none;';
  if (hudEl) hudEl.appendChild(muteEl);

  let bannerTimer = null;
  // Cached last-written values; only changed values touch the DOM.
  const cache = { cash: null, health: null, healthLow: null, wanted: null, objective: null, speed: null, muted: null };

  function banner(title, sub, ms = 4000) {
    bannerTitle.textContent = title;
    bannerSub.textContent = sub || '';
    bannerEl.style.opacity = '1';
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { bannerEl.style.opacity = '0'; }, ms);
  }

  function hideBanner() {
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
    bannerEl.style.opacity = '0';
  }

  function drawMinimap(drawState = state, ctx = minimapCtx, canvas = minimapEl) {
    if (!ctx || !canvas) return;
    const city = drawState.city;
    if (!city) return;
    const size = canvas.width || 180;
    const half = city.half + 60;
    const toMap = (v) => ((v + half) / (half * 2)) * size;

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

    // Cash drops (green) while Payday Pickup is active, untaken only.
    const sys = drawState._missions;
    if (drawState.mission && drawState.mission.id === 'payday-pickup' && sys) {
      ctx.fillStyle = '#7dff9a';
      for (const drop of sys.drops) {
        if (drop.taken) continue;
        ctx.beginPath();
        ctx.arc(toMap(drop.pos.x), toMap(drop.pos.z), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Traffic cars (white).
    ctx.fillStyle = '#ffffff';
    for (const t of drawState.traffic || []) {
      const p = readPos(t.car || t);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(toMap(p.x), toMap(p.z), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Police units (red).
    ctx.fillStyle = '#ff4d4d';
    for (const unit of drawState.police || []) {
      const p = readPos(unit);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(toMap(p.x), toMap(p.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Garage dot.
    if (city.landmarks && city.landmarks.garage) {
      ctx.fillStyle = '#ff9a3d';
      ctx.beginPath();
      ctx.arc(toMap(city.landmarks.garage.pos.x), toMap(city.landmarks.garage.pos.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mission marker: pulsing yellow diamond.
    if (drawState.mission && drawState.mission.marker) {
      const m = drawState.mission.marker;
      const mx = toMap(m.x);
      const my = toMap(m.z);
      const s = 5 + Math.sin(drawState.time * 4) * 1.5;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd23d';
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }

    // Player arrow.
    const px = toMap(drawState.player.pos.x);
    const py = toMap(drawState.player.pos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(drawState.player.heading);
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function updateHud(hudState = state, dt = 0) {
    // Cash.
    const cashText = `$${hudState.cash.toLocaleString('en-US')}`;
    if (cache.cash !== cashText) {
      cache.cash = cashText;
      if (cashEl) cashEl.textContent = cashText;
    }
    // Health bar.
    const healthPct = Math.max(0, Math.min(100, (hudState.health / hudState.maxHealth) * 100));
    if (cache.health !== healthPct) {
      cache.health = healthPct;
      if (healthFillEl) healthFillEl.style.width = `${healthPct}%`;
    }
    const healthLow = healthPct < 30;
    if (cache.healthLow !== healthLow) {
      cache.healthLow = healthLow;
      if (healthFillEl) {
        healthFillEl.style.background = healthLow
          ? 'linear-gradient(90deg, #d63a37, #ff7a5d)'
          : 'linear-gradient(90deg, #2fae62, #7dff9a)';
      }
    }
    // Wanted stars.
    const wantedText = '★'.repeat(hudState.wanted) + '☆'.repeat(5 - hudState.wanted);
    if (cache.wanted !== wantedText) {
      cache.wanted = wantedText;
      if (wantedEl) wantedEl.textContent = wantedText;
    }
    // Objective line.
    let objectiveText;
    if (hudState.gameComplete) {
      objectiveText = 'NEON BAY LEGEND — you own this city.';
    } else if (hudState.mission) {
      objectiveText = `${hudState.mission.title} — ${hudState.mission.text}`;
      if (hudState.mission.timer && hudState.mission.timerLeft > 0) {
        objectiveText += ` (${Math.max(0, Math.ceil(hudState.mission.timerLeft))}s)`;
      }
    } else {
      objectiveText = 'Talk to Vera at the garage. First mission coming soon.';
    }
    if (cache.objective !== objectiveText) {
      cache.objective = objectiveText;
      if (objectiveEl) objectiveEl.textContent = objectiveText;
    }
    // Speed (driving only).
    const driving = !hudState.player.onFoot && hudState.player.car;
    const speedText = driving ? `${Math.round(Math.abs(hudState.player.car.speed) * 3.6)} km/h` : '';
    if (cache.speed !== speedText) {
      cache.speed = speedText;
      speedEl.textContent = speedText;
      speedEl.style.display = driving ? 'block' : 'none';
    }
    // Mute indicator.
    if (cache.muted !== hudState.muted) {
      cache.muted = hudState.muted;
      muteEl.style.display = hudState.muted ? 'block' : 'none';
    }
    // Minimap: every frame while playing; also once on the title screen
    // so it is never blank.
    if (hudState.screen === 'play' || hudState.screen === 'title') drawMinimap(hudState, minimapCtx, minimapEl);
  }

  const api = { banner, hideBanner, drawMinimap, updateHud };
  state._hud = api;
  return api;
}

// Module-level entry point (main.js calls this per frame).
export function updateHud(state, dt = 0) {
  if (state._hud && typeof state._hud.updateHud === 'function') state._hud.updateHud(state, dt);
}
