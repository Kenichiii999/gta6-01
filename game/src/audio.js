// Neon Bay — audio. One job: every sound in the game, synthesized live
// with WebAudio. No audio files, no network: engine hum, police siren,
// pickup chime, mission jingle, punch/crash thuds, UI clicks, and a quiet
// synthwave arpeggio loop for ambience.
//
// The AudioContext only exists after a user gesture (browsers block audio
// before interaction), so everything lazy-inits on the first gesture or the
// first play() call, and every public entry point is guarded: audio must
// never throw, even before the context exists. Master mute follows
// state.muted (M key).

// Synthwave chord roots (Hz): Am — F — C — G.
const CHORDS = [
  [110.0, 130.81, 164.81, 220.0], // Am
  [87.31, 110.0, 130.81, 174.61], // F
  [130.81, 164.81, 196.0, 261.63], // C
  [98.0, 123.47, 146.83, 196.0], // G
];
const MUSIC_STEP = 0.24; // seconds per arpeggio note
const MUSIC_GAIN = 0.05;

/**
 * Build the audio system and store it on state._audio. Also exposes
 * window.__sfx = (name) => play(name) so the vehicles / police / combat
 * slices can trigger sounds without importing this module.
 */
export function createAudio(state) {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineFilter = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenLfo = null;
  let sirenGain = null;
  let musicGain = null;
  let nextNoteTime = 0;
  let musicStep = 0;
  let unlocked = false;

  function buildNodes() {
    master = ctx.createGain();
    master.gain.value = state.muted ? 0 : 0.9;
    master.connect(ctx.destination);

    // Engine: sawtooth through a low-pass, pitch follows car speed.
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

    // Siren: square wave whose pitch wobbles between two tones via an LFO.
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'square';
    sirenOsc.frequency.value = 820;
    sirenLfo = ctx.createOscillator();
    sirenLfo.type = 'square';
    sirenLfo.frequency.value = 1.1; // ~0.45 s per tone
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    sirenLfo.connect(lfoGain);
    lfoGain.connect(sirenOsc.frequency);
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();
    sirenLfo.start();

    // Music bus (quiet synthwave arpeggio, notes scheduled in update).
    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC_GAIN;
    musicGain.connect(master);
    nextNoteTime = ctx.currentTime + 0.1;
  }

  /** Create (or resume) the context. Returns false when audio is unavailable. */
  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      buildNodes();
      unlocked = true;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  // First user gesture unlocks audio (pointer or key). Browsers require it.
  const unlock = () => {
    if (!unlocked) ensure();
    else if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // --- One-shot synth helpers -------------------------------------------------
  function tone(freq, dur, type, vol, delay = 0, slideTo = 0) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noiseBurst(dur, vol, filterFreq) {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  /** Play a named one-shot. Safe to call before any gesture (no-op, no throw). */
  function play(name) {
    try {
      if (!ensure()) return;
      if (ctx.state !== 'running') return;
      switch (name) {
        case 'pickup': // bright two-note chime
          tone(987.77, 0.12, 'sine', 0.22);
          tone(1318.5, 0.2, 'sine', 0.22, 0.09);
          break;
        case 'mission-complete': // short rising arpeggio
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.22, 'triangle', 0.22, i * 0.11));
          break;
        case 'fail': // low descending buzz
          tone(220, 0.45, 'sawtooth', 0.14, 0, 110);
          break;
        case 'punch': // body thud
          tone(170, 0.12, 'sine', 0.3, 0, 55);
          noiseBurst(0.08, 0.18, 700);
          break;
        case 'crash': // metal crunch
          noiseBurst(0.28, 0.32, 800);
          tone(95, 0.3, 'sine', 0.28, 0, 38);
          break;
        case 'click': // UI blip
          tone(880, 0.05, 'square', 0.07);
          break;
        default:
          break;
      }
    } catch {
      // Audio must never break gameplay.
    }
  }

  // Cross-slice hook: window.__sfx('pickup') etc. Guarded, never throws.
  window.__sfx = (name) => {
    try {
      play(name);
    } catch {
      // Ignore: no sound is better than a crash.
    }
  };
  // Debug hook for playtests: 'none' until the first gesture unlocks audio.
  window.__audioState = () => (ctx ? ctx.state : 'none');

  const api = {
    play,
    /** Per-frame: engine pitch, siren gating, music scheduler, mute. */
    update(dt) {
      try {
        if (!ctx) return;
        if (state.muted) {
          if (master.gain.value !== 0) master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          return;
        }
        if (master.gain.value !== 0.9) master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.05);

        // Engine: pitch + volume follow the car; silent on foot.
        const car = state.player && state.player.car;
        const speed = car
          ? (typeof car.speed === 'number'
            ? Math.abs(car.speed)
            : (car.velocity ? Math.hypot(car.velocity.x || 0, car.velocity.z || 0) : Math.abs(state.player.speed || 0)))
          : 0;
        const engineOn = !!car && speed > 0.5;
        const targetFreq = 55 + Math.min(40, speed) * 3.6;
        const targetGain = engineOn ? 0.045 + Math.min(0.075, speed * 0.0018) : 0;
        engineOsc.frequency.setTargetAtTime(targetFreq, ctx.currentTime, 0.08);
        engineGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.1);

        // Siren: only with wanted heat and police nearby (or no police data
        // yet — then wanted heat alone is enough to hear it faintly).
        const wanted = state.wanted || 0;
        let nearestPolice = Infinity;
        for (const cop of state.police || []) {
          const p = cop && cop.pos ? cop.pos : (cop && cop.mesh ? cop.mesh.position : null);
          if (!p || !state.player || !state.player.pos) continue;
          const d = Math.hypot(p.x - state.player.pos.x, p.z - state.player.pos.z);
          if (d < nearestPolice) nearestPolice = d;
        }
        const policeNear = (state.police || []).length === 0 || nearestPolice < 160;
        const sirenOn = wanted > 0 && policeNear;
        sirenGain.gain.setTargetAtTime(sirenOn ? 0.035 : 0, ctx.currentTime, 0.15);

        // Ambient music: schedule arpeggio notes a little ahead of time.
        if (musicGain && ctx.state === 'running') {
          while (nextNoteTime < ctx.currentTime + 0.18) {
            const chord = CHORDS[Math.floor(musicStep / 4) % CHORDS.length];
            const note = chord[musicStep % 4];
            const t0 = nextNoteTime;
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.value = note;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, t0);
            gain.gain.linearRampToValueAtTime(1, t0 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t0 + MUSIC_STEP * 1.8);
            osc.connect(gain);
            gain.connect(musicGain);
            osc.start(t0);
            osc.stop(t0 + MUSIC_STEP * 2);
            nextNoteTime += MUSIC_STEP;
            musicStep += 1;
          }
          if (nextNoteTime < ctx.currentTime - 1) nextNoteTime = ctx.currentTime + 0.05;
        }
      } catch {
        // Audio must never break gameplay.
      }
    },
  };
  state._audio = api;
  return api;
}

/** Per-frame audio update (module function, mirrors the other slices). */
export function updateAudio(state, dt) {
  if (state._audio) state._audio.update(dt);
}
