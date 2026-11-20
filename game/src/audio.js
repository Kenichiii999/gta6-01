// Every sound in the game, synthesized live with WebAudio. No audio
// files, no network: engine hum, police siren, pickup chime, mission
// jingle, punch/crash thuds, UI clicks, and a quiet synthwave arpeggio
// loop for ambience. The AudioContext only exists after a user gesture
// (browsers block audio before interaction), so everything lazy-inits on
// the first gesture or the first play() call, and every public entry
// point is guarded: audio must never throw, even before the context
// exists. Master mute follows state.muted (M key).
const MUSIC_GAIN = 0.05;
const MUSIC_STEP = 0.24;
const CHORDS = [
  [110.0, 130.81, 164.81, 220.0], // Am
  [87.31, 110.0, 130.81, 174.61], // F
  [130.81, 164.81, 196.0, 261.63], // C
  [98.0, 123.47, 146.83, 196.0], // G
];

export function createAudio(state) {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineFilter = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let musicBus = null;
  let noiseBuffer = null;
  let musicStep = 0;
  let nextNoteTime = 0;

  function ensure() {
    try {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return true;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = state.muted ? 0 : 0.9;
      master.connect(ctx.destination);

      // Engine: sawtooth through a low-pass, silent until driving.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();

      // Siren loop: square wave with a 1.1 Hz LFO on its frequency.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'square';
      sirenOsc.frequency.value = 820;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1.1;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 140;
      lfo.connect(lfoGain);
      lfoGain.connect(sirenOsc.frequency);
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      lfo.start();

      // Music bus.
      musicBus = ctx.createGain();
      musicBus.gain.value = MUSIC_GAIN;
      musicBus.connect(master);

      // Shared white-noise buffer for bursts.
      const len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;

      nextNoteTime = ctx.currentTime + 0.05;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  // First user gesture unlocks audio.
  const unlock = () => { ensure(); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  function tone(freq, dur, type, vol, delay = 0, slideTo = 0) {
    if (!ctx || !master) return;
    try {
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch { /* audio must never throw */ }
  }

  function noiseBurst(dur, vol, filterFreq) {
    if (!ctx || !master || !noiseBuffer) return;
    try {
      const t0 = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    } catch { /* audio must never throw */ }
  }

  function play(name) {
    try {
      if (!ensure()) return;
      if (!ctx || ctx.state !== 'running') return;
      switch (name) {
        case 'pickup':
          tone(987.77, 0.12, 'sine', 0.22);
          tone(1318.5, 0.2, 'sine', 0.22, 0.09);
          break;
        case 'mission-complete':
          tone(523.25, 0.22, 'triangle', 0.22, 0);
          tone(659.25, 0.22, 'triangle', 0.22, 0.11);
          tone(783.99, 0.22, 'triangle', 0.22, 0.22);
          tone(1046.5, 0.22, 'triangle', 0.22, 0.33);
          break;
        case 'fail':
          tone(220, 0.45, 'sawtooth', 0.14, 0, 110);
          break;
        case 'punch':
          tone(170, 0.12, 'sine', 0.3, 0, 55);
          noiseBurst(0.08, 0.18, 700);
          break;
        case 'crash':
          noiseBurst(0.28, 0.32, 800);
          tone(95, 0.3, 'sine', 0.28, 0, 38);
          break;
        case 'click':
          tone(880, 0.05, 'square', 0.07);
          break;
        case 'siren':
          // Fresh wanted-star sting: two-tone wail (distinct from the
          // continuous siren loop in update()).
          tone(700, 0.5, 'square', 0.12, 0, 950);
          break;
        case 'busted':
          tone(330, 0.6, 'triangle', 0.18, 0, 220);
          break;
        case 'wasted':
          tone(262, 0.7, 'triangle', 0.18, 0, 175);
          break;
        case 'hit':
          tone(200, 0.1, 'sine', 0.25, 0, 70);
          noiseBurst(0.05, 0.12, 900);
          break;
        default:
          break;
      }
    } catch { /* audio must never throw */ }
  }

  function nearestPoliceDist() {
    let nearest = Infinity;
    for (const unit of state.police || []) {
      const p = unit.pos || (unit.group && unit.group.position) || (unit.mesh && unit.mesh.position);
      if (!p) continue;
      const d = Math.hypot(p.x - state.player.pos.x, p.z - state.player.pos.z);
      if (d < nearest) nearest = d;
    }
    return nearest;
  }

  function update(dt) {
    try {
      if (!ctx || !master) return;
      if (ctx.state !== 'running') return;
      const now = ctx.currentTime;

      // Master mute.
      master.gain.setTargetAtTime(state.muted ? 0 : 0.9, now, 0.05);

      // Engine layer.
      const car = state.player.car;
      const speed = car ? Math.abs(car.speed) : 0;
      const driving = !state.player.onFoot && !!car && speed > 0.5;
      if (engineOsc && engineGain) {
        engineOsc.frequency.setTargetAtTime(55 + Math.min(40, speed) * 3.6, now, 0.08);
        engineGain.gain.setTargetAtTime(
          driving ? 0.045 + Math.min(0.075, speed * 0.0018) : 0, now, 0.1,
        );
      }

      // Siren loop: on while wanted, and police are near (or none exist
      // yet, in which case the heat alone is enough to hear it faintly).
      if (sirenGain) {
        const nearest = nearestPoliceDist();
        const on = state.wanted > 0 && (state.police.length === 0 || nearest < 160);
        sirenGain.gain.setTargetAtTime(on ? 0.035 : 0, now, 0.15);
      }

      // Music: synthwave arpeggio, scheduled up to 0.18 s ahead.
      if (musicBus) {
        if (nextNoteTime < now - 1) nextNoteTime = now + 0.05;
        while (nextNoteTime < now + 0.18) {
          const chord = CHORDS[Math.floor(musicStep / 4) % CHORDS.length];
          const freq = chord[musicStep % 4];
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.0001, nextNoteTime);
          gain.gain.exponentialRampToValueAtTime(1, nextNoteTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + MUSIC_STEP * 1.8);
          osc.connect(gain);
          gain.connect(musicBus);
          osc.start(nextNoteTime);
          osc.stop(nextNoteTime + MUSIC_STEP * 2);
          nextNoteTime += MUSIC_STEP;
          musicStep += 1;
        }
      }
    } catch { /* audio must never throw */ }
  }

  const api = { play, update };
  state._audio = api;
  window.__sfx = (name) => play(name);
  window.__audioState = () => (ctx ? ctx.state : 'none');
  return api;
}

// Module-level entry point (main.js calls this per fixed step).
export function updateAudio(state, dt = 0) {
  try {
    if (state._audio && typeof state._audio.update === 'function') state._audio.update(dt);
  } catch { /* audio must never throw */ }
}
