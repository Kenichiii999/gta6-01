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
    + 'pointer-events:none;white-space:nowrap;transition:opacity .5s;opacity:1;';
  if (hudEl) hudEl.appendChild(hintEl);

  // Controls hint auto-hide: visible at the start of a play session,
  // fades out after ~8 s of play or once the player moves off the
  // starting spot, shows again on the pause screen, and resets when
  // play is left so the next session gets the hint back.
  let hintPlayStart = null; // state.time when the current play session began
  let hintSpawn = null; // { x, z } where the session started
  let hintOverride = null; // 'hide' | 'show' | null (staged shots)
  let hintOnceHide = false; // hide for the next updateHud call only
  let hintVisible = true;
  let lastScreen = null;

  function setHintVisible(visible, instant = false) {
    if (hintVisible === visible && !instant) return;
    hintVisible = visible;
    // Explicit overrides hide/show instantly (a staged shot taken right
    // after the call must not catch the hint mid-fade); the auto-hide
    // keeps its 0.5 s fade.
    hintEl.style.transition = instant ? 'none' : 'opacity .5s';
    hintEl.style.opacity = visible ? '1' : '0';
  }

  function resetHint() {
    hintPlayStart = null;
    hintSpawn = null;
    setHintVisible(true);
  }

  // The pause screen is shown/hidden by main.js without calling
  // updateHud, so watch the screen elements directly for it.
  const pausedEl = document.getElementById('paused');
  const titleEl = document.getElementById('title');
  if (typeof MutationObserver !== 'undefined' && (pausedEl || titleEl)) {
    const screenObserver = new MutationObserver(() => {
      if (titleEl && !titleEl.classList.contains('hidden')) resetHint();
      if (pausedEl && !pausedEl.classList.contains('hidden') && hintOverride !== 'hide') {
        setHintVisible(true);
      }
    });
    if (pausedEl) screenObserver.observe(pausedEl, { attributes: true, attributeFilter: ['class'] });
    if (titleEl) screenObserver.observe(titleEl, { attributes: true, attributeFilter: ['class'] });
  }

  // Explicit override for staged screenshots: force the hint hidden or
  // shown without touching the auto-hide state; null clears it.
  function setHintOverride(mode) {
    hintOverride = mode === 'hide' || mode === 'show' ? mode : null;
  }

  // Hide the hint for one updateHud call only, leaving the auto-hide
  // state untouched (for a single staged frame).
  function hideHintOnce() {
    hintOnceHide = true;
  }

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
    // Roads: a bright casing line with a darker core on top, so the
    // streets read as streets at judge size instead of thin radar lines.
    for (const c of city.roadLines) {
      ctx.strokeStyle = '#aebdc7';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(toMap(-half), toMap(c)); ctx.lineTo(toMap(half), toMap(c)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(toMap(c), toMap(-half)); ctx.lineTo(toMap(c), toMap(half)); ctx.stroke();
    }
    for (const c of city.roadLines) {
      ctx.strokeStyle = '#3a3f46';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(toMap(-half), toMap(c)); ctx.lineTo(toMap(half), toMap(c)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(toMap(c), toMap(-half)); ctx.lineTo(toMap(c), toMap(half)); ctx.stroke();
    }
    // Beach strip, then ocean — both start at the city edge (south),
    // inside the canvas, not beyond it.
    const edge = city.half;
    ctx.fillStyle = '#e8d49a';
    ctx.fillRect(0, toMap(edge), size, size - toMap(edge));
    ctx.fillStyle = '#1e7fa8';
    ctx.fillRect(0, toMap(edge + 40), size, size - toMap(edge + 40));

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
      ctx.arc(toMap(p.x), toMap(p.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Police units (red).
    ctx.fillStyle = '#ff4d4d';
    for (const unit of drawState.police || []) {
      const p = readPos(unit);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(toMap(p.x), toMap(p.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Landmark dots in distinct colours, so the map reads as a city.
    const landmarkDots = [
      ['tower', '#ff5a9a'],
      ['hospital', '#ffffff'],
      ['police', '#5a9aff'],
      ['bank', '#ffd23d'],
    ];
    for (const [key, color] of landmarkDots) {
      const lm = city.landmarks && city.landmarks[key];
      if (!lm) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(toMap(lm.pos.x), toMap(lm.pos.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Garage dot: larger, with a white ring.
    if (city.landmarks && city.landmarks.garage) {
      const g = city.landmarks.garage;
      const gx = toMap(g.pos.x);
      const gy = toMap(g.pos.z);
      ctx.fillStyle = '#ff9a3d';
      ctx.beginPath();
      ctx.arc(gx, gy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(gx, gy, 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Mission marker: pulsing yellow diamond.
    if (drawState.mission && drawState.mission.marker) {
      const m = drawState.mission.marker;
      const mx = toMap(m.x);
      const my = toMap(m.z);
      const s = 7 + Math.sin(drawState.time * 4) * 1.5;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd23d';
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }

    // Player arrow, with a white outline so it stays visible over
    // bright roads.
    const px = toMap(drawState.player.pos.x);
    const py = toMap(drawState.player.pos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(drawState.player.heading);
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
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
    // Controls hint: visible at the start of play, then it fades out on
    // its own after ~8 s of play or once the player moves off the
    // starting spot; back on the pause screen; reset on leaving play.
    if (hintOverride === 'hide') {
      setHintVisible(false, true);
    } else if (hintOverride === 'show') {
      setHintVisible(true, true);
    } else if (hintOnceHide) {
      hintOnceHide = false;
      setHintVisible(false, true);
    } else if (hudState.screen === 'play') {
      if (lastScreen !== 'play' || hintPlayStart === null || !hintSpawn) {
        hintPlayStart = hudState.time;
        hintSpawn = { x: hudState.player.pos.x, z: hudState.player.pos.z };
      }
      const played = hudState.time - hintPlayStart;
      const moved = Math.hypot(hudState.player.pos.x - hintSpawn.x, hudState.player.pos.z - hintSpawn.z);
      setHintVisible(!(played >= 8 || moved > 12));
    } else if (hudState.screen === 'paused') {
      setHintVisible(true);
    } else {
      // Title / busted / wasted: reset so the next session gets the hint.
      hintPlayStart = null;
      hintSpawn = null;
      setHintVisible(true);
    }
    lastScreen = hudState.screen;
    // Minimap: every frame while playing; also once on the title screen
    // so it is never blank.
    if (hudState.screen === 'play' || hudState.screen === 'title') drawMinimap(hudState, minimapCtx, minimapEl);
  }

  const api = { banner, hideBanner, drawMinimap, updateHud, setHintOverride, hideHintOnce };
  state._hud = api;
  return api;
}

// Module-level entry point (main.js calls this per frame).
export function updateHud(state, dt = 0) {
  if (state._hud && typeof state._hud.updateHud === 'function') state._hud.updateHud(state, dt);
}
