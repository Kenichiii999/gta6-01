# Neon Bay — gta6-01 rebuild spec

> **Purpose.** This document is the complete rebuild specification for the
> game "Neon Bay" (make.fun competition `gta6-01`). It was written by reading
> every line of the v1 source (4,017 lines in `game/src/`, plus
> `game/index.html`, `main.ts`, `serve.ts`, `README.md`, `shots.json`) and the
> four slice smoke tests in `~/workspace/makefun/gta6-01-dev/smoke-{a,b,c,d}.mjs`.
> A fresh agent who has **never seen the v1 code** must be able to rebuild the
> same game from this document alone, **without opening the original `.js`
> files**. Where v1 code and the earlier coordinator notes
> (`~/workspace/makefun/gta6-01-dev/DESIGN.md`) disagree, **the code wins**;
> disagreements are listed in §9.
>
> **Critical fact about v1 (read first).** In the v1 commit at HEAD
> (`ec90ef6`), `game/src/main.js` does **not** wire slices B/C/D into the
> game loop: it never calls `createTraffic`, `createPolice`, `createMissions`,
> `createHud`, or `createAudio`, never calls `updateDrive`,
> `updateTraffic`, `updatePolice`, `updateMissions`, `updateCombat`, or
> `updateAudio`, never handles the E key, and never starts mission 1. The
> modules exist and are complete, but the committed game as-shipped only
> plays the slice-A part (on-foot movement in the city + HUD skeleton).
> Slices B/C/D were verified against an **integrated copy** with the wiring
> applied (see §8). The rebuild MUST include the wiring in §2.4 — it is
> part of the game, not an optional extra. Anything in §2.4 marked
> **[reconstructed]** is derived from the module APIs, the smoke tests, and
> the coordinator progress log, not from a committed wired `main.js`.

## 1. Overview

### 1.1 Game concept

**Neon Bay** is an open-world crime game in the browser. The player is
**Danny Cole**, a driver-for-hire in a sun-soaked coastal city. On foot or
behind the wheel, the player explores a 9×9-block procedurally built city,
steals cars, runs from the police, punches pedestrians and cops, and works
through a 5-mission story for the fixer **Vera "V" Marchetti**. All names,
story, dialogue, art, and sound are original — no Rockstar / GTA assets,
no licensed material.

Core loop: start at Marchetti Garage → steal a car → drive to objectives
shown by a yellow 3D beacon and a minimap marker → earn cash → gain and
lose police heat → complete all 5 missions → "NEON BAY LEGEND" ending.

### 1.2 Tech stack

| Piece | Choice |
|---|---|
| 3D | three.js **r170**, vendored locally at `game/vendor/three.min.js` (691,648 bytes, minified module build). Imported via an import map: `{"three": "./vendor/three.min.js"}`. No CDN, no other library. |
| Language | Plain ES modules (`.js`), no build step, no bundler, no TypeScript in the game itself. |
| Rendering | WebGL via three.js, `MeshLambertMaterial` almost everywhere (cheap), one shadow-casting directional light, ACES filmic tone mapping. |
| Audio | WebAudio API, 100% synthesized (no audio files). See §4.9. |
| Textures | Procedural canvas textures (`THREE.CanvasTexture`), no image files. See §3.15. |
| Persistence | `localStorage`, one key. See §4.8. |
| Determinism | Seeded RNG (mulberry32). `?seed=N` fixes the city layout and traffic spawn. |
| Screenshots | `?shot=<name>&seed=N` stages a scene, paints twice, sets `window.__shotReady`. |

### 1.3 Constraints (non-negotiable)

- **No network requests at runtime.** Every script/image is a file under
  `game/` or a `data:` URI. The page must load and play fully offline.
- **Desktop Chrome**, keyboard + mouse. No touch controls, no pointer lock
  (camera orbits on mouse drag).
- **Static files only.** The game is `game/index.html` + ES modules + the
  vendored three.js. No server-side logic.

### 1.4 How to run it

```sh
node serve.ts            # serves game/ on http://localhost:8080
# open http://localhost:8080
```

`serve.ts` is a Node 22 standard-library-only static server: it serves
`game/` on `127.0.0.1`, default port 8080 (`--port N` overrides), sends the
MIME types a browser game needs (`.html`, `.js`, `.mjs`, `.css`, `.json`,
`.png/.jpg/.gif/.webp/.svg`, `.woff2`, `.glb/.gltf`, `.wasm`, audio), refuses
any path outside `game/` (403), returns 404 for missing files, and sends
`cache-control: no-store`. It is a development convenience, not a web server.

### 1.5 How to submit it (entry program)

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
from beside itself into `/output` (or `$MAKEFUN_OUTPUT_DIR` outside the
grader container) and writes `/output/dossier.json` with the vendored
`vendor/makefun-game.ts` `buildDossier`. Scorer caps enforced in `main.ts`:

- `text_max_bytes: 163840` (dossier text budget)
- screenshots: max **4**, each max **262,144 bytes**
- game: max **993 files**, max **50,331,648 bytes (48 MiB)**, path max 1000 bytes

`README.md` at the repo root carries the three make.fun badges (competition,
rank, reward) for owner `Kenichiii999`, repo `gta6-01`, referral `9v6tjk8q`,
and the run command `node serve.ts` + `http://localhost:8080`.

## 2. Architecture

### 2.1 File list

```
gta6-01/
  README.md            # badges + one-paragraph description (see §1.5)
  main.ts              # entry program: copies game/ + screenshots/ to /output, writes dossier.json
  serve.ts             # dev static server (Node stdlib only), port 8080
  shots.json           # v1: still the KIT starter list (start/play/end) — see §9.8
  LICENSE
  vendor/makefun-game.ts   # vendored make.fun library (kit file, do not rewrite)
  screenshots/         # v1: still the KIT starter images — slice E replaces with 4 game shots
  game/
    index.html         # canvas #game, HUD DOM, screens, import map, loads ./src/main.js
    vendor/three.min.js    # three.js r170 (vendored library — the only exception to "write it fresh")
    src/
      config.js    (86)    # every shared constant, palette, tuning number, key binding
      random.js    (29)    # seeded RNG (mulberry32) + helpers
      input.js     (118)   # keyboard + mouse-drag camera input, one-shot action flags
      render.js    (126)   # WebGL renderer, scene, camera, lights, sky, fog, clouds
      textures.js  (154)   # procedural canvas textures (facades, road, sidewalk, sand, sky)
      city.js      (297)   # 9x9-block coastal city generation + collision data
      player.js    (155)   # on-foot player (Danny Cole), movement + collision + walk cycle
      cars.js      (472)   # car mesh factory + arcade driving physics + enter/exit
      traffic.js   (405)   # traffic cars, parked cars, pedestrians
      police.js    (647)   # wanted system + police car/foot-cop AI + busted/wasted
      combat.js    (147)   # melee punch (F)
      missions.js  (478)   # 5-mission story, beacon, cash drops, rewards, ending
      hud.js       (295)   # HUD DOM extras, banner, speed, minimap, mute indicator
      audio.js     (271)   # WebAudio synth: engine, siren, SFX, synthwave music loop
      save.js      (50)    # localStorage save/load
      shots.js     (27)    # ?shot= staging — v1 is a TITLE-ONLY STUB, see §9.8
      main.js      (260)   # boot, shared state, fixed-step loop, screens, HUD skeleton, shot mode
```

Line counts are v1's; the rebuild need not match them exactly, but the file
split and one-job-per-file rule must be kept (the judge reads the outline).

### 2.2 Shared state (the contract every system builds on)

`main.js` creates one `state` object; every system receives it and reads /
writes only its own fields (plus the fields the contract names). This is the
exact shape:

```js
state = {
  time: 0,                       // seconds of play (fixed-step accumulator), advances only in play
  seed,                          // integer; ?seed=N or random uint32
  screen: 'title'|'play'|'paused'|'busted'|'wasted',
  cash: 0,
  health: 100,
  maxHealth: 100,
  wanted: 0,                     // 0..5 stars
  lastWantedReason: undefined,   // string set by addWanted, e.g. 'stolen car'
  missionIndex: 0,               // 0..5 (5 = all done)
  mission: null,                 // active mission object or null (see §3.12)
  gameComplete: false,           // true after mission 5 completes
  player: {
    pos: THREE.Vector3,          // spawn: garage pos + (0, 0, 18), y = 0
    heading: Math.PI,            // radians; forward = (sin h, cos h)
    speed: 0,                    // m/s (on foot: smoothed speed; driving: car speed)
    onFoot: true,
    car: null,                   // car object while driving, else null
    mesh: null,                  // player mesh Group (set by createPlayer)
  },
  camera: { yaw: 0, pitch: 0.42, dist: 9 },
  city,                          // return value of createCity (see §3.6)
  traffic: [],                   // [{ car, road, targetSpeed, turnCooldown }] (see §3.9)
  parkedCars: [],                // [car] (see §3.8)
  peds: [],                      // [ped] (see §3.9)
  police: [],                    // [unit] (see §3.10)
  stats: { carsStolen: 0, missionsDone: 0 },
  muted: false,
  shakeTime: 0,                  // set by police on ram/punch; CONSUMED BY NOTHING in v1, see §9.6
  // set by the systems themselves (not by main.js):
  _missions: undefined,          // createMissions runtime (sys object)
  _hud: undefined,               // createHud api { banner, hideBanner, drawMinimap }
  _audio: undefined,             // createAudio api { play, update }
}
```

Conventions used everywhere:

- **Heading:** forward = `(sin h, cos h)`. Along +X is `h = π/2`, along +Z is
  `h = 0`. Player, cars, traffic, police, peds all use this.
- **Fixed step:** `STEP = 1/60` s. All simulation advances in `STEP` slices.
- **Y = 0** is ground level everywhere; the game is flat (no hills, no
  jumping, no vertical movement except mesh bob).
- **World axes:** +X east, +Z south. South (+Z) is the beach and the ocean.
- **Never throw:** audio, HUD hooks, and the cross-slice `window.*` hooks are
  all guarded with try/catch — a missing system must never break gameplay.

### 2.3 Module dependency graph

```
main.js ──> config.js, random.js, input.js, render.js, city.js,
           player.js, save.js, shots.js
           [REBUILD: also cars.js, traffic.js, police.js, combat.js,
            missions.js, hud.js, audio.js — see §2.4]
render.js ──> config.js, textures.js
city.js   ──> config.js, random.js, textures.js
player.js ──> config.js
cars.js   ──> (three only; no project imports)
traffic.js ──> cars.js, random.js
police.js ──> render.js (SCREEN_* constants only)
combat.js ──> input.js (ACTION_PUNCH), police.js (addWanted), render.js (SCREEN_PLAY)
missions.js ──> save.js
hud.js    ──> (DOM only; no project imports)
audio.js  ──> (WebAudio only; no project imports)
save.js   ──> config.js (SAVE_KEY)
shots.js  ──> render.js (SCREEN_TITLE)
textures.js ──> random.js (randInt)
input.js  ──> config.js (KEYS)
random.js ──> (nothing)
config.js ──> (nothing)
```

Cross-slice communication is by **shared state + `window.*` hooks**, never by
direct imports between gameplay slices (police does not import cars/traffic;
missions does not import police/cars). The hooks:

| Hook | Set by | Called by | Purpose |
|---|---|---|---|
| `window.__game = state` | main.js | smoke tests / console | whole live state (debug/playtest) |
| `window.__wantedAdd(n, reason)` | police.js `createPolice` (only if not already set) | cars.js `enterCar`, traffic.js ped-hit | add wanted stars without importing police |
| `window.__sfx(name)` | audio.js `createAudio` | police.js, combat.js, missions.js | play a named sound |
| `window.__audioState()` | audio.js | smoke test D | returns AudioContext state or `'none'` |
| `window.__missionEvent(type, payload)` | missions.js `createMissions` | (nothing in v1 calls it — see §9.5) | `'carStolen'`, `'cashPickup'` |
| `window.__police = { setDecaySeconds, bust, waste }` | police.js `createPolice` | smoke test C | test/debug hooks |
| `window.__shotReady = true` | main.js `runShot` | screenshot script | signals the staged frame is painted |

### 2.4 Main loop flow (main.js) — INCLUDES THE REBUILD WIRING

Boot order in `runGame()`:

1. Parse URL: `shot = params.get('shot')`, `seed` from `?seed=N` (integer)
   else `Math.floor(Math.random() * 4294967296)`.
2. Grab DOM: `#game`, `#status`, `#hud`, `#title`, `#paused`, `#cash`,
   `#health-fill`, `#wanted`, `#objective`, `#minimap`, `#continue-btn`,
   `#start-btn`; `minimap.getContext('2d')`.
3. `renderer = createRenderer(canvas)`; `city = createCity(renderer.scene, createRandom(seed))`; `garage = city.landmarks.garage`.
4. Build `state` (§2.2); `player = createPlayer(state, renderer.scene)`;
   `window.__game = state`.
5. **[reconstructed]** Create the slice systems, in this order, all with
   `(state, renderer.scene)` unless noted:
   `createTraffic(state, renderer.scene)`,
   `createPolice(state, renderer.scene)`,
   `createMissions(state, renderer.scene)`,
   `createHud(state, renderer.scene)`,
   `createAudio(state)`.
   (Order matters only in that `createPolice` installs `__wantedAdd` and
   `createAudio` installs `__sfx` before anything can call them.)
6. `input = createInput(canvas)`.
7. Show title screen; `requestAnimationFrame(frame)`.

Per-frame `frame(now)`:

- `accumulator += min((now - last)/1000, MAX_FRAME)` with
  `MAX_FRAME = 0.25` (a longer stall is dropped, not replayed). `last = now`.
- `handleActions()`: take the one-shot actions once per frame into a local
  **`frameActions`** variable **[reconstructed]** — the same bitmask is
  consumed by the screen logic AND passed to combat/car-interact, because
  `takeActions()` empties the queue and a second call would see nothing.
  - `ACTION_MUTE` → `state.muted = !state.muted`.
  - `ACTION_CONFIRM` on title → `startGame(false)` (fresh start).
  - `ACTION_PAUSE` on play → show paused screen, status `'Paused.'`.
  - `ACTION_PAUSE | ACTION_CONFIRM` on paused → back to play.
  - (Busted/wasted resume is owned by police.js's own Enter/Space
    listener, not by main.js — see §3.10.)
- If screen is title or play, run `step()` while `accumulator >= STEP`
  (fixed 1/60 s slices; several in a slow frame, none in a fast one).
  If paused/busted/wasted, `accumulator = 0` (simulation frozen).
- Every frame (any screen): `renderer.updateCamera(state.player.pos, state.camera, STEP)` then `renderer.draw(state)`.
- If screen is play: `updateHud()` (main.js's local HUD refresh, or
  `hud.js`'s `updateHud(state, dt)` — see §3.13).

Per fixed `step()` (only while screen is play; title steps exist only to
keep `state.time` advancing — in v1 `step()` runs on title too, but only
the camera orbit and time advance; no system updates run on title):

1. `state.time += STEP`.
2. Camera orbit from mouse drag: `orbit = input.takeOrbit()`; if non-zero,
   `state.camera.yaw -= orbit.dx * 0.005`,
   `state.camera.pitch = clamp(state.camera.pitch + orbit.dy * 0.004, 0.08, 1.1)`.
3. If screen is play:
   - If `state.player.onFoot`: `player.update(STEP, input.axes(), input.running(), state.camera.yaw)`.
   - Else (driving): `updateDrive(state, STEP, input)` **[reconstructed]**.
   - `handleCarInteract(state)` if `frameActions & ACTION_INTERACT`
     **[reconstructed]** — returns `'entered' | 'exited' | 'too-fast' | null`.
   - `updateCombat(state, STEP, frameActions)` — **must run AFTER
     `player.update()`**, because the punch lunge offsets the player mesh
     and `player.update()` re-asserts the mesh position every step
     **[reconstructed]**.
   - `updateTraffic(state, STEP)` **[reconstructed]**.
   - `updatePolice(state, STEP)` **[reconstructed]** (internally no-ops
     unless screen is play; also triggers busted/wasted).
   - `updateMissions(state, STEP)` **[reconstructed]**.
   - `updateAudio(state, STEP)` **[reconstructed]**.
   - Autosave: `saveTimer += STEP`; every 10 s, `saveGame(state)`.
4. (HUD refresh happens in `frame()`, not in `step()`.)

`startGame(fromSave)`:

- If `fromSave`, `loadSave()`; on a save: `cash`, `missionIndex`, `health`
  from save, player pos from `save.pos` (x, 0, z). Else fresh: cash 0,
  missionIndex 0, health = maxHealth, player at garage + (0,0,18),
  heading π.
- Always: `wanted = 0`, `mission = null`.
- **[reconstructed]** If no active mission and `missionIndex < 5`,
  `startMission(state, state.missionIndex)` — this is what makes mission 1
  ("First Wheels") auto-start on Enter, as smoke test D asserts. In v1
  code nothing calls `startMission` at all; the call must be added here
  (or equivalently in `showScreen` when entering play). Do NOT auto-start
  when `missionIndex >= 5` (game complete).
- Show play screen, status
  `'Playing. WASD to move, Shift to run, drag to look around.'`, refresh HUD.

`showScreen(screen)`: sets `state.screen`, toggles `.hidden` on
`#title` (shown iff title), `#paused` (iff paused), `#hud` (hidden iff
title). On title: `loadSave()`; `#continue-btn` shown iff a save exists;
status `'Neon Bay. Press Enter to start.'`.

Other main.js behaviours:

- `#start-btn` click → `startGame(false)`; `#continue-btn` click →
  `startGame(true)`.
- `visibilitychange`: if the tab becomes hidden while playing → pause
  (show paused screen, status `'Paused.'`).
- `updateHud()` (local to main.js): cash as `$` + locale string; health
  bar width %; wanted as `'★'.repeat(wanted) + '☆'.repeat(5 - wanted)`;
  objective line `'<title> — <text>'` or the default
  `'Talk to Vera at the garage. First mission coming soon.'`; calls the
  local `drawMinimap()`.
- Local `drawMinimap()`: 180×180 canvas, `half = city.half + 60`,
  `toMap(v) = ((v + half) / (half*2)) * size`; background `#0d1b26`; roads
  as grey (`#5a6a72`, lineWidth 2) lines from `city.roads`; beach strip
  `#e8d49a` from `toMap(half)` down; ocean `#1e7fa8` from
  `toMap(half + 40)` down; garage dot `#ff9a3d` r4; player arrow `#ffd23d`
  (triangle, rotated by heading). **Note:** this local minimap does NOT
  draw traffic/police/mission markers — `hud.js`'s fuller minimap does
  (§3.13). The rebuild should use `hud.js`'s version (or merge them) and
  delete the duplication; do not ship both drawing the same canvas.
- Shot mode (`?shot=<name>`): `runShot(name)` instead of `runGame()`:
  `stageShot(name, state)` (§3.16), show that screen, `updateHud()`, then
  paint twice via `requestAnimationFrame` (`updateCamera` + `draw` each
  time) and set `window.__shotReady = true` after the second paint.

`index.html` structure (must be reproduced): `<canvas id="game">`, hidden
`<p id="status" role="status" aria-live="polite">`, `#hud.hidden` containing
`#objective`, `#wanted` (`☆☆☆☆☆`), `#cash` (`$0`), `#health > #health-fill`,
`<canvas id="minimap" width="180" height="180">`; `#title.screen` with
`h1 NEON BAY`, `h2 An open-world crime game`, `Press Enter to start`, a
`.controls` block listing the keys, `#start-btn` (Start) and
`#continue-btn.secondary.hidden` (Continue); `#paused.screen.hidden` with
`h1 PAUSED`. Import map `{"three": "./vendor/three.min.js"}` in `<head>`;
`<script type="module" src="./src/main.js">`. CSS: full-viewport canvas,
HUD absolute-positioned (cash top-right 26px green `#7dff9a`; health bar
top-right 180×12px; wanted top-centre 26px gold, letter-spacing 4px;
objective top-left, max-width 340px, orange left border; minimap
bottom-left 180×180, circular, 2px white-ish border); screens are
full-viewport flex overlays with a dark gradient, `h1` 84px/900/gold with
pink glow. Favicon is `data:,` (no file). No external resources of any kind.


## 3. Module-by-module spec

Every module header comment in v1 states its "one job" in one sentence;
those sentences are reproduced here as the module's responsibility.

### 3.1 config.js — shared constants, palette, tuning, key bindings

Responsibility: *every number the other modules agree on lives here.*
Exports only constants; imports nothing.

```js
export const STEP = 1 / 60;
export const SAVE_KEY = 'neon-bay.save.v1';
export const CITY = {
  blocks: 9, block: 60, road: 12,
  get pitch() { return this.block + this.road; },   // 72
  get half() { return (this.blocks * this.pitch) / 2; }, // 324
  minBuildingHeight: 8, maxBuildingHeight: 40,
  towerHeight: 88,
};
export const PALETTE = {
  skyTop: 0x3d8fd1, skyBottom: 0xbfe6f5, fog: 0xa8d4e8,
  sun: 0xffe3b3, sunIntensity: 2.6,
  hemiSky: 0xbfd9ff, hemiGround: 0x8a7a5f, hemiIntensity: 0.9,
  road: 0x3a3f46, sidewalk: 0xb9b3a4, sand: 0xe8d49a,
  ocean: 0x1e7fa8, oceanDeep: 0x0e5a80, grass: 0x7fae62,
  facades: [0xf2c9a0, 0xf5e6c8, 0xa8d0d8, 0xf2a7a7, 0xc9d6a3, 0xe8d5f2, 0xf7f3e8, 0x9fc3e8],
  roofs: [0x6b5a4a, 0x7a6a58, 0x5a6a72, 0x8a7a6a],
  landmark: { tower: 0x2e4a6b, hospital: 0xf2f2f2, police: 0x2f4a7a, garage: 0xd97b2f, bank: 0xc9a227 },
};
export const PLAYER = { walkSpeed: 5, runSpeed: 9, radius: 0.55, accel: 40, turnRate: 12 };
export const CAMERA = { dist: 9, minDist: 4, maxDist: 20, pitch: 0.42, minPitch: 0.08, maxPitch: 1.1, fov: 60, near: 0.1, far: 1600 };
export const KEYS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'], interact: ['KeyE'], punch: ['KeyF'],
  pause: ['KeyP', 'Escape'], mute: ['KeyM'], confirm: ['Enter', 'Space'],
};
```

Notes: `PALETTE.roofs` and `PALETTE.grass` and `PALETTE.oceanDeep` are
defined but unused by v1 code (roofs use a hardcoded `0x6b5a4a`); keep them
or drop them, but do not invent new palette entries the modules don't
consume. Speeds are m/s. There is **no** C (camera) or R (reset car) key
in v1 despite the coordinator notes claiming them — see §9.2.

### 3.2 random.js — seeded RNG (mulberry32)

Responsibility: *deterministic randomness so a `?seed=N` world always
builds the same city and the same shot staging.*

- `createRandom(seed)` → `next()` returning `[0, 1)`. mulberry32: keep an
  internal `a = seed >>> 0`; each call: `a |= 0; a = (a + 0x6d2b79f5) | 0;
  t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7),
  61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296`.
- `randInt(rng, min, max)` → integer in `[min, max]` inclusive.
- `randRange(rng, min, max)` → float in `[min, max)`.
- `randPick(rng, items)` → one element.
- Imports nothing. Consumed by city, traffic, textures.

### 3.3 input.js — keyboard + mouse-drag camera input

Responsibility: *turn raw DOM events into held movement axes, one-shot
action flags, and camera orbit deltas. No pointer lock: the camera orbits
while the mouse is dragged.*

Exports: `ACTION_CONFIRM = 1`, `ACTION_PAUSE = 2`, `ACTION_MUTE = 4`,
`ACTION_INTERACT = 8`, `ACTION_PUNCH = 16`, and `createInput(target)`.

`createInput(target)` (target = the `#game` canvas) returns:

- `axes()` → `{ x, y }`, each in `[-1, 1]`: x = right − left, y = up − down
  (W = +1 forward).
- `running()` → true while either Shift is held.
- `takeOrbit()` → `{ dx, dy }` mouse-drag pixel deltas since the last call
  (and zeroes the accumulator).
- `takeActions()` → the one-shot ACTION_* bitmask since the last call (and
  zeroes it). A press between two frames is never lost and never counted
  twice.

Behaviour details:

- `keydown`: ignore repeats for held-state purposes (but still
  `preventDefault()` on movement/confirm/pause repeats); add code to the
  held set; set the matching action bit (confirm / pause / mute /
  interact / punch — checked in that `else if` order, so a code that were
  in two sets would only fire the first; in v1 no code is in two sets).
  `preventDefault()` for movement, confirm, and pause codes (stops page
  scroll on arrows/space).
- `keyup`: remove from held set.
- `blur` (window): clear the whole held set and stop dragging — a key
  released while the tab is hidden never sends `keyup`, so without this
  the player would keep walking on their own.
- Pointer: `pointerdown` on the canvas starts a drag (with
  `setPointerCapture`); `pointermove` while dragging accumulates deltas;
  `pointerup`/`pointercancel` ends the drag.
- Key sets are built from `KEYS` in config.js via `new Set(list)`.

### 3.4 render.js — renderer, scene, camera, lights, sky

Responsibility: *own the WebGL renderer and the third-person orbit
camera, and paint the frame the game state describes. The sun-soaked look
lives here: warm directional sun with shadows, hemisphere fill, blue sky
dome, haze fog, drifting clouds.*

Exports: `SCREEN_TITLE = 'title'`, `SCREEN_PLAY = 'play'`,
`SCREEN_PAUSED = 'paused'`, `SCREEN_BUSTED = 'busted'`,
`SCREEN_WASTED = 'wasted'`, and `createRenderer(canvas)`.

`createRenderer(canvas)` returns
`{ renderer, scene, camera, resize, updateCamera, updateClouds, draw(state) }`:

- `THREE.WebGLRenderer({ canvas, antialias: true })`; pixel ratio
  `min(devicePixelRatio, 2)`; size = window inner size; shadows enabled,
  `PCFSoftShadowMap`; tone mapping `ACESFilmicToneMapping`, exposure 1.05.
- `scene.fog = new THREE.Fog(PALETTE.fog, 120, 900)`.
- Sky dome: `SphereGeometry(1200, 24, 16)`, `MeshBasicMaterial` with
  `makeSkyTexture(skyTop, skyBottom)`, `side: BackSide`, `fog: false`;
  re-centred on the camera every frame (`sky.position.set(camera.x, 0,
  camera.z)`) so the player can never reach its edge.
- Sun: `DirectionalLight(PALETTE.sun, 2.6)` at `(180, 260, 120)`,
  `castShadow`, shadow map 2048×2048, shadow camera left/right/top/bottom
  ±260, near 10, far 900, bias −0.0004. The sun **follows the player**:
  each `updateCamera` sets `sun.position = target + (180, 260, 120)` and
  `sun.target = target`, so shadows stay crisp anywhere in the city.
- Hemisphere fill: `HemisphereLight(0xbfd9ff, 0x8a7a5f, 0.9)`.
- Clouds: 9 groups, each 3–5 flattened white spheres
  (`SphereGeometry(1, 10, 8)`, `MeshLambertMaterial` white, transparent,
  opacity 0.85; puffs scaled ~`(16 + (p%3)*6, 5, 10)`, offset along the
  group); placed at `x = -500 + i*130`, `y = 150 + (i%3)*25`,
  `z = -420 + ((i*97) % 700)`. `updateClouds(dt)`: `x += dt * 1.5`,
  wrap `x > 700 → -700`.
- Camera: `PerspectiveCamera(fov 60, aspect, near 0.1, far 1600)`.
- `resize()`: window resize listener; sets renderer size + camera aspect.
- `updateCamera(target, camState, dt)`: third-person orbit — camera sits
  behind/above the target at the state's yaw/pitch/dist:
  `cx = target.x + sin(yaw)*cos(pitch)*dist`,
  `cz = target.z + cos(yaw)*cos(pitch)*dist`,
  `cy = target.y + 1.6 + sin(pitch)*dist` (clamped `cy >= 0.6`);
  `camera.lookAt(target.x, target.y + 1.6, target.z)`. `dt` is accepted
  but unused.
- `draw(state)`: `updateClouds(1/60)` then `renderer.render(scene,
  camera)`.

Consumes: `CAMERA`, `PALETTE` from config.js; `makeSkyTexture` from
textures.js.

### 3.5 textures.js — procedural canvas textures

Responsibility: *paint every texture the city needs on offscreen canvases
so the game ships no image files and loads nothing over the net.*

Internal helper `canvasTexture(width, height, paint, repeatX = 1,
repeatY = 1)`: creates a canvas, runs `paint(ctx, w, h)`, returns a
`THREE.CanvasTexture` with `RepeatWrapping` on S and T, the given repeat,
`colorSpace = SRGBColorSpace`, `anisotropy = 4`. Internal `css(hex)` →
`'#rrggbb'`.

- `makeFacadeTexture(baseHex, rng, floors = 8, cols = 6)` — 256×512 canvas:
  pastel base fill; subtle vertical panel shading (`rgba(0,0,0,0.04)`
  stripes every 32 px); a grid of windows (margins: x 14, top 18, bottom
  band 46; window 64% of cell wide, 58% tall; lit with probability 0.22
  in `#ffe9a8`, else `#27405c`; white-ish frame stroke + centre mullion);
  ground floor: dark band (`rgba(0,0,0,0.18)`, 46 px) with shop doors
  (`#3a2f28` or `#5a3a28`) and coloured awnings (one of `0xd97b2f`,
  `0x2e8b7a`, `0xc94f4f`, `0x4f7ac9`); roofline strip
  (`rgba(0,0,0,0.25)`, 10 px). `rng` is a seeded stream, so each variant
  is stable for a given seed.
- `makeRoadTexture()` — 128×256, repeat `(1, 4)`: asphalt `#3a3f46` with
  900 speckles (grey 50–90), edge lines `#d8d8c8` (3 px at x 4 and x w−7),
  dashed centre line `#e8c84a` (4 px wide, 34 px dashes every 64 px).
- `makeSidewalkTexture()` — 128×128, repeat `(4, 4)`: base `#b9b3a4`,
  4×4 slab joints (`rgba(0,0,0,0.18)`, 2 px), 200 speckles.
- `makeSandTexture()` — 128×128, repeat `(8, 8)`: base `#e8d49a`, 1200
  speckles (warm grains).
- `makeSkyTexture(topHex, bottomHex)` — 4×256 canvas, vertical gradient:
  stop 0 = top colour, 0.55 = bottom colour, 1 = `#f5e9c8` (warm horizon);
  `CanvasTexture`, SRGB, no repeat wrapping needed.
- Note: road/sidewalk/sand speckles use unseeded `Math.random()` — texture
  grain varies run to run; only the facade windows are seeded. That is
  v1 behaviour; keep it.

### 3.6 city.js — city generation

Responsibility: *build the whole 9×9-block coastal city from a seeded RNG
and expose its data (roads, buildings, landmarks) so later slices
(traffic, police, missions) can drive on it and point at it.*

Layout (all metres): block 60, road 12, pitch 72. Block centres at
`(bx*72, bz*72)` for `bx, bz ∈ -4..4`. Road centrelines halfway between
blocks and around the outer edge. `HALF = 324`. South (+Z) is beach/ocean.
Landmarks take whole blocks:

| Landmark | Block (bx, bz) | World pos | Size (w×d) | Height | Colour |
|---|---|---|---|---|---|
| Neon Bay Tower | (0, 0) | (0, 0) | 34×34 | 88 | `0x2e4a6b` + pink beacon sphere r2.2 at y 91 |
| Marchetti Garage (mission hub) | (−2, −2) | (−144, −144) | 40×26 | 10 | `0xd97b2f` |
| Bay General Hospital | (2, −2) | (144, −144) | 34×30 | 16 + randInt(0,10) | `0xf2f2f2` |
| Neon Bay Police HQ | (−2, 2) | (−144, 144) | 34×30 | 16 + randInt(0,10) | `0x2f4a7a` |
| Neon Bay Bank | (2, 2) | (144, 144) | 34×30 | 16 + randInt(0,10) | `0xc9a227` |

`createCity(scene, rng)` returns
`{ group, roads, buildings, landmarks, blocks: 9, half: 324, roadLines, isOnRoad(x, z) }`:

- `roads`: 20 centreline segments `{ x1, z1, x2, z2 }` — 10 east-west and
  10 north-south, at coordinates `-324, -252, …, 324` (i.e.
  `-HALF + k*PITCH`, k = 0..10).
- `roadLines`: the 11 centreline coordinates (same list, one per line).
- `buildings`: array of `{ minX, maxX, minZ, maxZ, height, kind }` where
  kind is `'tower' | 'garage' | 'hospital' | 'police' | 'bank' |
  'building'`. This is the **collision data** every other module uses.
- `landmarks`: `{ tower, garage, hospital, police, bank }`, each
  `{ name, pos: Vector3, mesh }`.
- `isOnRoad(x, z)`: true when within `road/2 + 1` (7 m) of any road line
  on either axis.

Construction, in order:

1. **Ground:** base slab `PlaneGeometry(HALF*2+12, HALF*2+12)` =
   660×660, sidewalk texture, rotated flat, y 0, `receiveShadow`.
2. **Roads:** for each of the 11 lines `c`: an east-west plane
   `(HALF*2+12) × 12` at `(0, 0.02, c)` and a north-south plane at
   `(c, 0.02, 0)`, both road texture, `receiveShadow`. (The E–W plane is
   built as a plane rotated `x −π/2` then `z π/2`.)
3. **Beach + ocean:** beach plane `(HALF*2+120) × 64` = 768×64, sand
   texture, at `(0, 0.01, HALF+32)`; ocean plane 1400×420, colour
   `PALETTE.ocean`, transparent, opacity 0.92, at `(0, 0.05,
   HALF+64+210)` = z 598; boardwalk box `(HALF*2+120) × 0.4 × 6`,
   colour `0x9a7a52`, at `(0, 0.2, HALF+3)`.
4. **Facade materials:** one `MeshLambertMaterial` per pastel facade
   colour (8), each with `makeFacadeTexture(hex, rng, 6 + randInt(rng, 0,
   6), 4 + randInt(rng, 0, 3))`; one roof material `0x6b5a4a`; one
   landmark material per landmark colour via
   `makeFacadeTexture(hex, rng, 10, 8)`.
5. **Buildings:** `addBuilding(cx, cz, w, d, h, mat, kind)` — box
   geometry with UVs tiled so windows keep proportions: `rx =
   max(1, round(w/14))`, `ry = max(1, round(h/22))`, every UV multiplied
   by (rx, ry); mesh at `(cx, h/2, cz)`, cast+receive shadow; roof box
   `(w+0.6) × 0.5 × (d+0.6)` at `y = h + 0.25`; pushes the AABB into
   `buildings`. Per block: tower as above (plus beacon sphere); other
   landmarks as above; ordinary blocks: `count = randInt(rng, 1, 3)`
   buildings on a shuffled subset of the four slots
   `[(-15,-15), (15,-15), (-15,15), (15,15)]`, each `w, d ∈ [16, 24)`,
   `h ∈ [8, 40)`, random facade material.
6. **Props** (shared geometries/materials, one build each):
   - Street lamps: for each road line `c`, for `k = -3..3`,
     `along = k*72 + 36`: with probability 0.7 `addLamp(c+7.5, along)`,
     with probability 0.5 `addLamp(along, c+7.5)`. Lamp = pole cylinder
     (r 0.12→0.16, h 7) at y 3.5 + head sphere r 0.35 (`0xffe9a8`,
     basic material) at y 7.1.
   - Palms along the beach: `x = -HALF..HALF` step 36, at
     `(x + randRange(-6,6), HALF + 18 + randRange(-4,4))`. Palm = trunk
     cylinder (r 0.25→0.45, h 7, `0x7a5a38`) at y 3.5 + cone top (r 2.6,
     h 3.2, `0x2f8f4e`) at y 8.2.
   - 26 scattered sets: random block centre + jitter ±26: one palm, one
     bench (box 2.2×0.5×0.8, `0x8a6a42`, y 0.5, random rotation, offset
     z +28), one hydrant (cylinder r 0.35→0.4, h 1.1, `0xc94f4f`, y 0.55).
   - Traffic lights at exactly 8 fixed positions (decorative — traffic
     does NOT stop at them, see §9.3):
     `(36,36,true), (-36,36,false), (36,-36,false), (-36,-36,true),
     (108,36,true), (-108,-36,false), (36,108,false), (-36,-108,true)`
     where the boolean is green vs red. Pole cylinder h 6 at y 3 + box
     0.7×1.6×0.7 at y 6.2, red `0xff2a2a` / green `0x2aff66` (basic).

Props are visual only — no collision. Only buildings collide (plus the
world bounds in each mover).

### 3.7 player.js — the on-foot player

Responsibility: *build Danny Cole, a low-poly humanoid made of boxes, and
move him through the city: WASD relative to the camera, Shift to run,
heading that faces the movement, a walk-cycle bob and arm swing, and
collision (circle vs building AABB push-out) plus world bounds so he can
never walk through a wall or off the map.*

- `createPlayerMesh()` → `{ group, parts }`. Danny Cole: dark-jeans legs
  (0.22×0.8×0.24, `0x2a2f45`) at x ±0.14, y 0.4; white sneakers
  (0.24×0.12×0.42, `0xf2f2f2`) at y 0.06, z +0.06; teal torso
  (0.62×0.72×0.34, `0x2e8b7a`) at y 1.16; darker jacket band
  (0.66×0.2×0.38, `0x1f6a5c`) at y 1.42; teal arms (0.18×0.68×0.2) at x
  ±0.42, y 1.16; head (0.4×0.4×0.38, skin `0xe8b88a`) at y 1.78; hair
  (0.44×0.14×0.42, `0x2a2018`) at y 2.0; orange cap (0.46×0.08×0.44,
  `0xd97b2f`) at y 1.98. All meshes `castShadow`. Parts returned:
  `leftLeg, rightLeg, leftShoe, rightShoe, leftArm, rightArm, torso,
  head`.
- `createPlayer(state, scene)` → `{ group, update(dt, axes, running, camYaw) }`.
  Adds the mesh to the scene, sets `state.player.mesh = group`.
  `update(dt, axes, running, camYaw)`:
  - Target speed: 0 if no input, else run 9 / walk 5. `speedSmooth`
    approaches it at most `accel` (40) per second; `player.speed =
    speedSmooth`.
  - Camera-relative movement: forward = `(-sin(camYaw), -cos(camYaw))`
    (W walks away from the camera); right = `(-forwardZ, forwardX)`;
    move dir = forward*axes.y + right*axes.x, normalised; pos +=
    dir * speed * dt.
  - Heading: `targetHeading = atan2(mx, mz)`; turn toward it on the
    shortest arc at `turnRate` 12/s (`heading += diff * min(1, 12*dt)`).
  - Collision `collide(pos)`: circle (radius 0.55) vs every building AABB
    push-out, one pass per building — nearest point on the AABB, push out
    along the delta; if the centre is inside the box, push out along the
    smallest penetration (left/right/top/bottom). World bounds after:
    `x ∈ [-limit, limit]`, `z ∈ [-half-6, half+56]` with
    `limit = half + 56` (380 / −330..380) — the ocean is the wall.
  - Walk cycle: if `speed > 0.3`, `walkPhase += dt * speed * 1.6`;
    swing = `sin(walkPhase) * min(0.7, speed/9)`; legs/shoes swing ±,
    arms opposite at 0.8×; torso and head bob `+ |sin(walkPhase)| * 0.05`
    in y (base 1.16 / 1.78). Idle: swing 0.
  - `group.position.copy(player.pos)`; `group.rotation.y = heading`.

### 3.8 cars.js — car mesh factory + arcade driving physics

Responsibility: *build original low-poly cars (sedan / taxi / sports /
truck / police) out of boxes, and drive the player's car with an arcade
model (accelerate, brake/reverse, speed-sensitive steering, handbrake
slide) plus simple collision against buildings, other cars and the world
edge.*

A car is
`{ mesh, kind, color, speed, heading, pos, steering, health, driver, parked, length, width, topSpeed, wheels, _fwdX, _fwdZ }`.
`pos` is the live `Vector3` the mesh follows. `driver` is
`'player' | 'traffic' | null` (null = parked and stealable for free).

Per-kind tuning (`CAR_SPECS`):

| kind | topSpeed | reverseSpeed | accel | brake | steer | length | width | height |
|---|---|---|---|---|---|---|---|---|
| sedan | 28 | 9 | 16 | 30 | 1.9 | 4.4 | 1.9 | 1.35 |
| taxi | 26 | 9 | 15 | 30 | 1.9 | 4.4 | 1.9 | 1.35 |
| sports | 38 | 10 | 24 | 34 | 2.3 | 4.2 | 2.0 | 1.05 |
| truck | 18 | 7 | 9 | 24 | 1.4 | 6.2 | 2.3 | 2.2 |
| police | 32 | 10 | 20 | 32 | 2.1 | 4.5 | 1.95 | 1.35 |

(speeds m/s, accel/brake m/s².)

- `makeCar(scene, kind, color, pos, heading = 0)`: shared geometries /
  materials built once and cached (wheel cylinder r 0.36, w 0.3, rotated
  so the axle is along X; hub r 0.18; glass `0x1d3a4a`; headlight
  `0xfff2b0` basic; taillight `0xff2a2a` basic; chrome; paint materials
  cached per colour; body/cabin geometries cached per kind). Body: low
  slab `width × 0.62 × length` at y 0.55. Cabin: glass box — width
  `0.82×` (truck `0.9×`), length `0.45×` (truck `0.3×`), height 0.55
  (sports 0.42, truck 0.85); cabin z = `−length*0.05` (truck
  `+length*0.28`, y 1.28; sports y 1.05; else y 1.12). Truck: cargo box
  `0.96w × 1.5 × 0.55L` (`0x8a94a0`) at y 1.55, z `−0.2L`. Police:
  black body `0x1a1d22`, white doors band `(w+0.02) × 0.3 × 0.5L`
  (`0xf2f2f2`) at y 0.55, roof light bar red left (`0xff2020`) / blue
  right (`0x2050ff`) 0.5×0.14×0.3 at (±0.4, 1.45, 0). Taxi: yellow
  `0xf2c200` (colour argument ignored), roof sign 0.7×0.18×0.3
  (`0xffe14d`) at y 1.5, black chequer band `(w+0.02) × 0.16 × 0.6L`
  at y 0.5. Sports: rear spoiler `0.9w × 0.07 × 0.35` (`0x14161a`) at
  y 1.0, z `−L/2 + 0.15`. Headlights front (+Z is forward) and taillights
  rear: 0.34×0.14×0.06 lamps at x `±(w/2 − 0.35)`, y 0.62, z `±(L/2 −
  0.05)`. Four wheels: pivots at `(±(w/2 − 0.08), 0.36, ±(L/2 − 0.85))`,
  tyre + hub; front pair steers visually. Group positioned at `pos`
  (y 0), rotated to `heading`, added to scene. Returns the car object
  with `speed 0, steering 0, health 100, driver null, parked false`.
- `makePoliceCar(scene, pos, heading = 0)`: `makeCar(..., 'police',
  0x1a1d22, ...)` with `driver = 'traffic'`. (Note: police.js does NOT use
  this — it builds its own police car mesh; see §9.7.)
- `isHandbrakeHeld()`: Space is tracked by a **separate listener in
  cars.js itself** (input.js exposes no handbrake key): window
  keydown/keyup on `Space`, cleared on blur. This is the only extra
  listener the vehicles slice adds; it never interferes with the title
  screen confirm (Space there starts the game, which is harmless).

`updateDrive(state, dt, input)` — advance the player's car one fixed
step; no-op when on foot or no car:

- Longitudinal: W (`axes.y > 0`): `speed += accel*dt`, cap `topSpeed`.
  S (`axes.y < 0`): if `speed > 0.5` brake (`speed -= brake*dt`), else
  reverse (`speed -= accel*0.7*dt`), floor `−reverseSpeed`. Neither:
  coast drag `(0.6 + |speed|*0.04)*dt` toward 0. Handbrake (Space):
  `speed -= sign(speed) * min(|speed|, 22*dt)`; snap to 0 below 0.2.
- Steering: `speedFactor = 1 / (1 + |speed|*0.045)`;
  `steerTarget = -axes.x * steer * speedFactor * (handbrake ? 1.6 : 1)`;
  `steering` lerps toward it at `10*dt`. `dirSign = speed >= 0 ? 1 : -1`;
  `heading += steering * (|speed| / max(1, topSpeed)) * dirSign * dt *
  2.2`; handbrake slide: if handbrake and `|speed| > 6`,
  `heading += -axes.x * 0.9 * dt * dirSign`.
- Move: `pos += (sin h, cos h) * speed * dt`; store `_fwdX/_fwdZ`.
- Collisions: buildings — circle radius `hypot(length, width)/2 − 0.35`
  vs AABB push-out (same approach as player); on a hit,
  `speed *= -0.25` and `health = max(0, health - 1)`. Other cars —
  soft push between overlapping circles (radius `hypot(L,W)/2`,
  overlap threshold minus 0.6): separate by half the overlap each, both
  speeds `*= 0.85`; checked against traffic cars and `state.parkedCars`
  (parked cars are solid too; they are not in `state.traffic`).
- World bounds: same as player (`x ±(half+56)`, `z [−half−6, half+56]`).
- Sync: mesh position/rotation from pos/heading; front wheels
  `rotation.y = steering * 0.45`; wheels spin `(speed*dt)/0.36`
  (wheel radius 0.36); `player.pos.copy(car.pos)`,
  `player.heading = car.heading`, `player.speed = car.speed`.
- Chase camera: ease orbit yaw to `car.heading + π` at `4*dt`, dist to
  11 at `3*dt`, pitch to 0.32 at `3*dt` (all `min(1, rate*dt)` lerps).

Enter / exit:

- `nearestCar(state, maxDist = 3.5)`: nearest car to the player among
  traffic cars, parked cars, and police cars (via `pc.car || pc` —
  police units are not cars, see §3.10), excluding the player's own car.
- `enterCar(state, car)`: no-op if no car or already in one. If
  `car.driver === 'traffic'` (occupied): `stats.carsStolen += 1` and
  `wantedAdd(1, 'stolen car')` (via `window.__wantedAdd` if present —
  +1 star for stealing an occupied car). Remove the car from
  `state.traffic` or `state.parkedCars` as applicable. Set
  `driver = 'player'`, `parked = false`, `player.car = car`,
  `player.onFoot = false`, sync pos/heading/speed (speed 0), hide the
  player mesh.
- `exitCar(state)`: fails (returns false) if no car or `|speed| >= 1`
  (must be near-stopped). Sets `driver = null`, `parked = true`,
  `speed = 0`; player steps out on the driver's side (left of forward):
  `pos = car.pos + (-fz*2.2, 0, +fx*2.2)`; `onFoot = true`, mesh visible
  and repositioned; car appended to `state.parkedCars`.
- `handleCarInteract(state)`: on foot → enter nearest car within 3.5 m
  (`'entered'` or null); driving → exit (`'exited'` or `'too-fast'`).


### 3.9 traffic.js — traffic cars, parked cars, pedestrians

Responsibility: *fill the roads with cars that follow the grid (lane,
turn at intersections, stop behind the car ahead, slow near the player),
park stealable cars along road edges, and walk pedestrians on the
sidewalks who flee from a fast car or a crime and fall when a
player-driven car hits them.*

Constants: `TRAFFIC_COUNT = 14`, `PARKED_COUNT = 8`, `PED_COUNT = 16`,
`LANE_OFFSET = 3` (right-hand lane offset from the centreline),
`ROAD_HALF = 6`. Car colours (10): `0xd94f4f, 0x4f7ad9, 0x4fd97a,
0xd9c24f, 0x8a6fd9, 0xd97a4f, 0x9aa2ab, 0x3a3f46, 0xe8e8e8, 0x4fd9c9`.
Car kinds weighted: `['sedan', 'sedan', 'sedan', 'taxi', 'sports',
'truck']`. Ped shirts (8), pants (4), skins (4) — see code values in the
module; any varied palette is acceptable as long as shirts/pants/skins
are randomised per ped.

- `createTraffic(state, scene)`: spawns with a **seeded** RNG
  `createRandom((state.seed >>> 0) + 7)` — so a `?seed=N` world always
  has the same traffic. Writes `state.traffic`, `state.parkedCars`,
  `state.peds`; returns them. Traffic entry:
  `{ car, road: { axis: 'x'|'z', line, dir: 1|-1 }, targetSpeed, turnCooldown }`.
  Ped entry:
  `{ mesh, parts: { leftLeg, rightLeg, leftArm, rightArm }, pos, heading, speed, walkSpeed, state: 'walk'|'flee'|'down', stateTimer, phase, downTimer }`.
- `pickRoad(rng, lines)`: random axis, random centreline from
  `city.roadLines`, random direction. `roadPos(road, along)`: on an
  X-road, `(along, line + 3*dir)`; on a Z-road, `(line − 3*dir, along)`.
  `roadHeading(road)`: X-road +dir → `π/2`, −dir → `−π/2`; Z-road +dir
  → `0`, −dir → `π`.
- `spawnTrafficCar`: random road, `along ∈ [−half+20, half−20]`, random
  kind/colour, `driver = 'traffic'`, `speed ∈ [6, 11]`,
  `targetSpeed = kind === 'truck' ? 8 : randRange(9, 13)`.
- `spawnParkedCar`: random road, `along ∈ [−half+30, half−30]`, parked at
  the road edge `ROAD_HALF + 1.6` (7.6) on a random side; if the spot is
  not on a road and `|z| < half`, nudge back onto the shoulder
  (`ROAD_HALF + 0.5`). `driver = null`, `parked = true`, `speed = 0`.
- `sidewalkSpot`: random road line, `along ∈ [−half+10, half−10]`, offset
  `ROAD_HALF + 2.5 + rng()*4` (8.5–12.5) on a random side, random axis.
- `spawnPed`: ped mesh from shared geometries (legs 0.2×0.75×0.22, torso
  0.55×0.65×0.32, head 0.36×0.36×0.34, arms 0.16×0.6×0.18; randomised
  shirt/pants/skin materials, cached per colour); random heading;
  `speed = walkSpeed = randRange(1.0, 1.6)`; `state = 'walk'`;
  `stateTimer = randRange(2, 8)`; `phase` random.

`updateTraffic(state, dt)` — one fixed step for all traffic + peds:

**Moving traffic cars**, per car:
- `turnCooldown -= dt`.
- Target speed: start at `targetSpeed`. Car ahead in the same lane
  (ahead > 0, lateral offset < 2.2 m): nearest ahead < 9 m → target =
  `targetSpeed * 0.35`; < 5.5 m → target 0 (stop behind it). Player
  ahead within 14 m and within 14 m distance → target = min(target, 3)
  (slow near the player). Ease toward target: accel 6 up, 12 down
  (clamped per-step); if target 0 and speed < 0.05 → 0.
- Move along heading; mesh position/rotation synced; wheels spin
  `(speed*dt)/0.36`.
- Intersection turn: if `turnCooldown <= 0` and `speed > 0.5` and
  `crossingNear(pos, lines, road.axis)` returns a crossing centreline
  (within 2.5 m of a line on the crossing axis): roll `Math.random()`
  — **unseeded, see §9.9** — `< 0.22` turns (left if `< 0.11`, else
  right) onto the crossing road: new axis/line/dir computed from the
  turn, car snapped onto the new lane (`line ± LANE_OFFSET`), heading
  recomputed, `turnCooldown = 4`. Otherwise `turnCooldown = 1.5`
  (don't re-roll every frame at this crossing).
- World edge: if outside `±half` on either axis, reverse `road.dir`,
  recompute heading, clamp pos to `±half`, `turnCooldown = 2` (turn
  around at the outer ring road instead of leaving).

**Pedestrians**, per ped:
- `stateTimer -= dt`.
- `'down'`: `downTimer -= dt`; mesh lies flat
  (`rotation.x = −π/2 + max(0, downTimer)*0.1`); when `downTimer <= 0` →
  state `'flee'`, `stateTimer = 3`, `rotation.x = 0`.
- Flee trigger: `dist < 14` and (player driving fast — player car
  `|speed| > 8` — or `wanted > 0` and `dist < 10`) → state `'flee'`,
  `stateTimer = 2.5`. Flee expiry → `'walk'`, new `stateTimer =
  randRange(2, 8)` (unseeded `Math.random` stream in v1), speed =
  walkSpeed.
- `'flee'`: run directly away from the player at speed 4.2, heading
  turned toward the away-direction at rate 8/s.
- `'walk'`: walk along the block edge; when `stateTimer <= 0`, reset to
  `randRange(3, 9)` and with probability 0.4 turn ±90°.
- Move along heading; keep inside city + beach: if outside
  `x ±(half+10)` / `z [−half−10, half+50]`, turn around (heading += π)
  and clamp.
- **Hit by the player's car:** if player is driving, `|car speed| > 2`,
  and `dist < 1.8` → state `'down'`, `downTimer = 3`,
  `wantedAdd(1, 'hit pedestrian')` (once per hit — the ped is `'down'`
  afterwards so it can't re-trigger until it gets up).
- Walk cycle: `phase += dt * speed * 3.2`; legs/arms swing
  `sin(phase) * 0.5` (arms 0.7×); mesh position/rotation synced;
  `rotation.x = 0` when not down.

`crossingNear(pos, lines, axis)` (exported): the centreline coordinate of
the crossing road near (x, z), or null. For an X-road car, a line whose
`|pos.x − c| <= 2.5`; for a Z-road car, `|pos.z − c| <= 2.5`.

### 3.10 police.js — wanted system + police AI

Responsibility: *own the heat. Wanted stars 0–5, police cars that chase
on the road grid and ram, foot cops that run the player down and arrest,
wanted decay when the heat is off, and the busted / wasted flows (cash
penalty + respawn + wanted cleared). Self-contained: builds its own police
car / foot cop meshes here, imports nothing from the vehicles slice.*

Tuning constants (exported; the shipped values are the contract):

```js
WANTED_MAX = 5
DECAY_SECONDS = 20            // −1 star per 20 s with no police near
DECAY_CLEAR_DIST = 80         // "no police within" radius (m)
MAX_POLICE_CARS = 3
FOOT_COPS_AT_STARS = 3        // 2 foot cops once wanted >= 3
FOOT_COP_COUNT = 2
CAR_CHASE_SPEED = 16          // m/s
CAR_RAM_RANGE = 3.6
CAR_RAM_DAMAGE = 5            // health lost when rammed on foot
CAR_DEPLOY_RANGE = 8          // car stops, a cop gets out, when closer
COP_RUN_SPEED = 6.5           // m/s (walk 5, run 9: cops catch walkers)
COP_HEALTH = 100
COP_PUNCH_DAMAGE = 10
COP_PUNCH_RANGE = 1.6
COP_PUNCH_COOLDOWN = 1.2
ARREST_DIST = 2               // cop within 2 m...
ARREST_TIME = 2               // ...for 2 continuous seconds = busted
BUSTED_CASH_LOSS = 0.2
WASTED_CASH_LOSS = 0.1
DESPAWN_DIST_CAR = 140
DESPAWN_DIST_FOOT = 100
```

`setPoliceDecaySeconds(s)` — module-level override of the decay interval
(min 0.1 s); a playtest/test hook only, shipped value stays 20 s, nothing
in the game changes it.

Per-state context is kept in a `WeakMap` keyed by `state` (scene +
decay timer + overlay elements); `state.police` stays the plain unit array.

**Meshes** (shared geometries/materials built once):
- Police car: white body box 2.0×0.7×4.4 at y 0.55; black cabin
  1.7×0.55×2.0 at y 1.15, z −0.2; black hood 1.9×0.1×1.1 at y 0.92,
  z 1.55; black trunk 1.9×0.1×0.9 at y 0.92, z −1.7; black light bar
  1.3×0.14×0.4 at y 1.5, z −0.2; red light 0.55×0.2×0.36 at
  (−0.32, 1.62, −0.2), blue at (+0.32, 1.62, −0.2); four wheels
  (cylinder r 0.38, w 0.3, rotated z π/2) at (±0.85, 0.38, ±1.4). Light
  bar flashes: `siren += dt*6`; red visible when `sin(siren) > 0`, blue
  otherwise.
- Foot cop: navy uniform (`0x1f2f52`, dark navy `0x16233d` legs/cap),
  same proportions as the player mesh (legs 0.22×0.8×0.24 at y 0.4,
  shoes, torso 0.62×0.72×0.34 at y 1.16, arms, head skin `0xe8b88a` at
  y 1.78, cap 0.46×0.1×0.44 at y 2.0) plus a gold badge
  (0.12×0.12×0.05, `0xc9a227`) at (−0.18, 1.3, 0.18) and a gold cap band
  (0.47×0.05×0.45) at y 1.96.

**Spawning:** `spawnPosNearPlayer(state, dist)`: random angle, point at
`dist` from the player, snapped onto the road grid (move whichever axis
is closer to a road line onto that line), clamped to `x ±(half+40)`,
`z [−half−6, half+40]`. Cars spawn at `50 + random*20` m; foot cops at
`30 + random*15` m. Spawn positions use unseeded `Math.random()`.

**Units:** car unit
`{ kind: 'car', counted: true, group, pos (= group.position, same object), heading, speed, siren, red, blue, stuckTime, sampleT, lastX, lastZ, reverseT, ramCooldown, deployed, disengage, remove }`;
foot unit
`{ kind: 'foot', counted, group, parts, pos, heading, speed, health: 100, walkPhase, punchCooldown, arrestTimer, down, downTimer, disengage, remove }`.
`counted` distinguishes the 2 standing foot cops (counted, part of the
desired force) from the extra cop a police car deploys on foot (uncounted
— it doesn't count toward the 2).

**Wanted:** `addWanted(state, n, reason)`: clamps `wanted` to `[0, 5]`,
records `state.lastWantedReason`; on a fresh increase, plays the
`'siren'` sting via `window.__sfx` if present (guarded try/catch).
Sources of stars (whole game): steal occupied car +1 (`cars.js`),
hit pedestrian +1 (`traffic.js`), hit a cop +1 (`combat.js`), assault
witnessed by police within 60 m +1 (`combat.js`).

**Busted / wasted:**
- `bustPlayer(state)`: no-op if already on the busted screen. Cash loss
  `floor(cash * 0.2)`; `wanted = 0`; `health = maxHealth`; respawn at the
  **police** landmark + (26, 26), on foot, no car, speed 0; clear all
  police; screen = `'busted'`; show the `#busted` overlay with
  `You lost $X — 20% of your cash.`; play `'busted'` via `__sfx`.
- `wastePlayer(state)`: same shape, 10% loss, respawn at the
  **hospital** landmark + (26, 26), screen `'wasted'`, overlay text
  `You lost $X — 10% of your cash.`, sound `'wasted'`.
- Overlays are built by police.js itself (so `index.html` stays
  untouched): `makeOverlay(id, title, color, sub)` creates a
  `div.screen` (`display: none`, `zIndex 30`) with an `h1` (title in the
  given colour), a `p.penalty`, and a `p` reading
  `Press Enter to keep playing.`; appended to `document.body`. BUSTED is
  `#7fd4ff` on `The Neon Bay PD caught you.`; WASTED is `#ff5a7a` on
  `You blacked out on the streets of Neon Bay.`
- Resume: a single window `keydown` listener (added once) — Enter or
  Space while on the busted/wasted screen hides the overlays and sets
  screen back to `'play'`. main.js does NOT handle this.

`createPolice(state, scene)` → `{ update(dt) }`. Builds shared meshes,
both overlays, stores the context, installs the resume listener,
installs `window.__wantedAdd` (only if not already set) and
`window.__police = { setDecaySeconds, bust, waste }`.

`updatePolice(state, dt)` — the per-frame logic (no-op unless screen is
play; also checks health ≤ 0 before AND after stepping units, so a punch
or ram in the same frame is caught immediately):

1. Health ≤ 0 → `wastePlayer(state)`, return.
2. Desired force: `wantCars = min(wanted, 3)`; `wantFoot = wanted >= 3 ? 2 : 0`.
   Counted cars / counted foot cops only. Surplus units get
   `disengage = true` (they drive/walk off, then are removed); if
   `wanted === 0`, ALL units disengage. Spawn the missing units.
3. Wanted decay: if `wanted > 0` and the nearest non-removed, non-down
   police unit is farther than 80 m, `decayTimer += dt`; at
   `decaySeconds` (20), `decayTimer = 0`, `wanted -= 1`. Otherwise
   `decayTimer = 0` (no decay while police are near).
4. Step every unit; remove units flagged `remove`; if the screen left
   play mid-frame (busted), return immediately.

**Police car update** (`updateCar`):
- Flash the light bar; `ramCooldown -= dt`.
- If disengaging: drive away from the player at up to 14 m/s (accel 12),
  heading turned at 2.4 rad/s; `remove = true` once `dist >
  DESPAWN_DIST_CAR` (140).
- Chase: target speed 16. If `dist > 12`, road-grid chase — run along
  the axis with the bigger gap, snapped to the nearest road line on the
  other axis (so cars stay on roads instead of cutting through
  buildings); if `dist <= 12`, head straight at the player. Heading
  turns toward the target at 2.4 rad/s; speed eases at 12/s.
- If the player is on foot and `dist < 8`: target speed 0 (stop) and,
  once per car, deploy a foot cop beside the car (uncounted,
  `spawnFootCop` at the car's side: `pos + (cos h * 2.2, −sin h * 2.2)`).
  If on foot, `dist < 20`, and the car already deployed: stay put
  (target speed 0) while the cop works.
- Stuck recovery: sample movement every 0.5 s; if trying to drive
  (`targetSpeed > 1`) but moved < 0.8 m, `stuckTime += 0.5`, else 0.
  At `stuckTime >= 2` → `reverseT = 1`, `stuckTime = 0`. While
  `reverseT > 0`: `heading += 1.5*dt`, `speed = −6`.
- Move along heading; mesh rotation synced.
- Ram: if `dist < 3.6` and `ramCooldown <= 0`: `ramCooldown = 1`,
  `shake(state, 0.35)` (sets `state.shakeTime`, see §9.6), sound
  `'crash'`; if the player is on foot: `health -= 5`, shove the player
  2.5 m away from the car along the car→player direction, sync the
  player mesh; if driving: `player.car.speed *= 0.6`.

**Foot cop update** (`updateFoot`):
- If `down`: lie flat (`rotation.x` decreases at 4 rad/s toward −π/2);
  `remove = true` after `downTimer > 3`. If `health <= 0` → `down =
  true`, `downTimer = 0`.
- If disengaging: walk away at 5 m/s (heading turned at 6 rad/s),
  building collision (radius 0.55); `remove` once `dist > 100`.
- Otherwise: turn toward the player at 6 rad/s; if `dist >= 1.5`
  (HOLD_DIST), run at 6.5 m/s with building collision and walk-cycle
  animation (`walkPhase += dt * speed * 1.6`, swing `sin * 0.6`, arms
  0.8×); if closer, stand still (speed 0) — standing next to the player
  lets the arrest timer run instead of orbiting through them (which kept
  resetting it) and lets the cop punch from a fixed spot.
- Punch: if `dist < 1.6` and `punchCooldown <= 0`: cooldown 1.2 s,
  `health -= 10`, `shake(state, 0.25)`, sound `'hit'`.
- Arrest: if `dist < 2`, `arrestTimer += dt`; at 2 s → `bustPlayer`.
  Else `arrestTimer = 0` (must be 2 *continuous* seconds).

Building collision for foot cops: same circle-vs-AABB push-out as the
player, radius 0.55 (`collideBuildings(state, pos, r)` local helper).

### 3.11 combat.js — melee combat

Responsibility: *the F punch. Short-range arc in front of the player,
0.35 s cooldown, a small lunge on the player mesh, damage to the nearest
pedestrian or cop in range, and the wanted consequences (assault seen by
police, hitting a cop).*

Constants: `PUNCH_RANGE = 2.2` m, `PUNCH_ARC = 0.5` (cos of the
half-angle, ~60° each side), `PUNCH_COOLDOWN = 0.35` s,
`PUNCH_COP_DAMAGE = 15`, `PUNCH_PED_DAMAGE = 25`,
`POLICE_SEE_CRIME_DIST = 60` m, `LUNGE_TIME = 0.18` s,
`LUNGE_DIST = 0.35` m.

`updateCombat(state, dt, input)`:

- Per-state context in a `WeakMap`: `{ cooldown, lungeT }`.
- Lunge animation: while `lungeT > 0`, it counts down and offsets the
  player mesh forward along the heading by
  `sin(π * (1 − lungeT / 0.18)) * 0.35` (peak mid-lunge, back to 0 at the
  end). **Must run AFTER `player.update()` in the main loop**, because
  `player.update()` re-asserts the mesh position every step.
- `input` is either the actions bitmask already taken this frame
  (`ACTION_PUNCH` bit — the main loop passes what `takeActions()`
  returned, because calling `takeActions()` again here would see
  nothing) or the input object itself (then `takeActions()` is called
  here). Punching only works on foot, during play, and not while
  `cooldown > 0`. On a punch: `cooldown = 0.35`, `lungeT = 0.18`, sound
  `'punch'`.
- Target: nearest hittable entry inside the 2.2 m arc in front of the
  player (forward dot product ≥ 0.5, distance > ~0). Candidates: foot
  cops in `state.police` (kind `'foot'`, not `down`) and peds in
  `state.peds`. Position is read defensively (`entry.pos`, `entry.mesh`,
  or `entry.group` position). A whiff (no target) still lunges and plays
  the sound.
- Hitting a cop: `cop.health -= 15`; `addWanted(state, 1, 'hit
  police')`. The cop's own update drops it once health hits 0; it fights
  back with its punch while still standing.
- Hitting a ped: `ped.health -= 25` (peds start with no `health` field,
  so `(ped.health ?? 100) − 25`); if health ≤ 0 → `ped.down = true`;
  else `ped.fleeing = true`. **Known v1 mismatch: `traffic.js` never
  reads `ped.down`, `ped.health`, or `ped.fleeing` — see §9.4.** If any
  police unit (not down/removed) is within 60 m, `addWanted(state, 1,
  'assault')` (once — `break` after the first witness).
- There are no ranged weapons, no other combat moves. F is the only
  attack.

### 3.12 missions.js — the 5-mission story

Responsibility: *the 5-mission story for Danny Cole and his fixer Vera
"V" Marchetti, with objectives checked every frame, a 3D beacon over the
current target, rewards, and an ending when the Bay Heist is done. All
story, names and dialogue are original.*

Mission definitions (data only; marker positions are filled in by
`createMissions` from city landmarks, so the defs stay seed-independent):

| # | id | Title | Briefing (Vera) | Objective | Reward | Steps |
|---|---|---|---|---|---|---|
| 1 | `first-wheels` | First Wheels | "No wheels, no work, Danny. Borrow a car and bring it to my garage." | Steal any car, then drive it to Marchetti Garage. | $500 | steal → garage |
| 2 | `payday-pickup` | Payday Pickup | "Three dead drops around the bay. Cash, no questions. Grab them all." | Collect the 3 cash drops around Neon Bay. | $800 | drops (0/3) |
| 3 | `hot-pursuit` | Hot Pursuit | "The cops need to know your name — then forget it. Get hot, then go cold." | Reach 2 wanted stars, then lose all heat. | $1,200 | heat → cool |
| 4 | `the-getaway` | The Getaway | "Ninety seconds, garage to the pier. The tide waits for nobody, Danny." | Drive from the garage to the pier in 90 seconds. | $1,500 | pier (timer 90) |
| 5 | `bay-heist` | Bay Heist | "The big one. Neon Bay Bank, then vanish. This is the job that makes us legends." | Crack the bank vault, then escape to the garage with heat on you. | $3,000 | bank → vault → escape |

Arrival points: landmark markers sit at building centres, and the player
collides with the building, so "arriving" means reaching the doorstep in
front of the building, not the exact centre. `GARAGE_FRONT = (0, 0, 18)`
added to the garage pos; `BANK_FRONT = (0, 0, 20)` added to the bank pos;
`ARRIVE_DIST = 8`.

`createMissions(state, scene)` → `sys`, stored on `state._missions`:

- Landmark fallbacks if the city lacks them: garage `(−144, 0, −144)`,
  bank `(144, 0, 144)`, tower `(0, 0, 0)`, hospital `(144, 0, −144)`,
  police `(−144, 0, 144)`, `half` 324.
- Per-mission beacon marker: first-wheels → garage; payday-pickup →
  tower (marker moves to each remaining drop as they are collected);
  hot-pursuit → garage; the-getaway → pier `(0, 0, half + 24)` =
  (0, 0, 348); bay-heist → bank (moves to garage for the escape step).
- `sys = { defs, beacon, drops: [], flags: { stolen: false },
  nextStartAt: 0, garagePos, bankPos, garageFront, bankFront, pierPos,
  dropSpots, scene }`.
- Cash-drop spots (just outside the landmark buildings, since their
  centres are inside the footprint): tower + (0,0,24), hospital +
  (0,0,24), police + (0,0,−24).
- Beacon mesh (`makeBeacon`): a group with a pillar (cylinder r 2.4,
  h 70, yellow `0xffd23d`, transparent 0.28, additive blending, no depth
  write, double-sided, open-ended) at y 35; a diamond (octahedron r 1.7,
  solid yellow) at y 9; a ring (RingGeometry 3.2–4.2, yellow, transparent
  0.7, double-sided) flat at y 0.15. Initially invisible.
- Drop marker (`makeDropMarker(pos)`): green (`0x7dff9a`) pillar
  (cylinder r 1.4, h 24, transparent 0.3, additive) at y 12 + cash box
  (1.6×0.5×1.0, solid green) at y 2.2.
- `window.__missionEvent = (type, payload)`: `'carStolen'` →
  `sys.flags.stolen = true` and `stats.carsStolen += 1`;
  `'cashPickup'` with `payload.index` → `collectDrop(state, index)`.
  Never throws; never requires other slices to exist. (Nothing in v1
  calls it — see §9.5.)

`startMission(state, i)` → false when out of range (also clears the
mission and hides the beacon). Builds the runtime mission object:
`{ id, title, briefing, objective, marker (cloned), steps (cloned),
timer, reward, stepIndex: 0, progress: 0, timerLeft: timer || 0,
collected: 0, holdTime: 0, text: steps[0].text }`. Sets
`state.missionIndex = i`, `state.mission = mission`, beacon visible at
the marker; spawns drops for payday-pickup, clears them otherwise;
shows a banner via `state._hud.banner(title, briefing, 5200)` if the HUD
exists; plays `'click'`.

`updateMissions(state, dt)` — call only while screen is play:

- Auto-start: if no active mission, `nextStartAt > 0`, and
  `state.time >= nextStartAt` → `nextStartAt = 0`, start mission
  `missionIndex` (if < 5). `nextStartAt` is set to `state.time + 2.5`
  on every completion (a brief breather, then the next briefing).
- Beacon animation (while visible): diamond rotates `dt * 1.6`, bobs
  `y = 9 + sin(time*2.2)*0.9`; ring scales `1 + sin(time*2.2)*0.12`;
  pillar opacity `0.22 + sin(time*2.2)*0.08`; beacon follows
  `mission.marker`.
- Drop markers spin: cash `rotation.y += dt*2`, y bob
  `2.2 + sin(time*3 + drop.pos.x)*0.25`.
- Per-mission logic (2D distance from player pos):
  - **first-wheels:** step 0 → advance when `flags.stolen ||
    stats.carsStolen > 0 || player.car` (any of the three counts as
    "stolen"); step 1 → complete when within 8 m of `garageFront`.
  - **payday-pickup:** each untaken drop within 4 m → `collectDrop`:
    mark taken, remove its mesh, `collected += 1`, `progress =
    collected/3`, step text `Collect the cash drops (n/3)`, sound
    `'pickup'`, beacon moves to the next remaining drop. Complete at 3.
  - **hot-pursuit:** step 0 → advance when `wanted >= 2`; step 1 →
    complete when `wanted <= 0`.
  - **the-getaway:** `timerLeft -= dt` (from 90); text
    `Reach the pier — Ns left`; complete when within 10 m of `pierPos`;
    fail when the timer hits 0 → `failMission` (banner
    `MISSION FAILED` / `Out of time — Vera is not impressed.`, sound
    `'fail'`, restart the same mission from the top).
  - **bay-heist:** step 0 → advance within 8 m of `bankFront`; step 1
    (vault): while within 8 m of `bankFront`, `holdTime += dt`,
    `progress = min(1, holdTime/5)`, text
    `Cracking the vault… Ns`; at 5 s → advance; while away,
    `holdTime` decays at `2*dt` and the text reverts to
    `Crack the vault — hold position at the bank`; step 2 (escape) →
    complete within 8 m of `garageFront` **only if `wanted >= 1`**,
    otherwise the text becomes
    `Escape to the garage — you need heat on you (1+ star)`.
- `advanceStep`: `stepIndex += 1`, `progress = stepIndex /
  steps.length`, text = next step's text; for bay-heist step 2 the marker
  moves to the garage; sound `'click'`.
- `completeMission`: `cash += reward`; `stats.missionsDone += 1`;
  `missionIndex = min(missionIndex + 1, 5)`; `mission = null`; clear
  drops; hide beacon; sound `'mission-complete'`; banner
  `MISSION COMPLETE` / `+$X — <title>` for 4200 ms; **save immediately**
  (`saveGame(state)`) so a completed mission survives a reload. If
  `missionIndex >= 5`: `state.gameComplete = true`, banner
  `NEON BAY LEGEND` / `You own this city.` for 9000 ms. Else
  `nextStartAt = state.time + 2.5`.

Mission runtime fields on `state.mission` (HUD reads these):
`id, title, briefing, objective, marker, steps: [{ id, text }],
stepIndex, progress, timer, timerLeft, collected, holdTime, text`.

### 3.13 hud.js — HUD

Responsibility: *everything the player reads while playing — cash,
health, wanted stars, the objective line, mission banners, speed, the
minimap, the controls hint and the mute indicator. Extends the HUD
skeleton already in index.html (element ids cash, health-fill, wanted,
objective, minimap); the extra pieces (banner, speed, hint, mute) are
created here so index.html stays untouched. DOM writes are cached: text /
styles only change when the value actually changed, so the per-frame cost
stays near zero.*

`createHud(state, scene)` → `api`, stored on `state._hud` so missions.js
can show banners without importing this module. (`scene` is accepted for
the shared `createXxx(state, scene)` signature; the HUD is DOM + 2D
canvas.)

Extra elements created once (inline styles):
- `#banner` (inside `#hud`): absolute, top 64 px, centred, padding
  12×28 px, radius 10 px, `rgba(0,0,0,.62)` background, gold border,
  opacity 0, 0.35 s fade, pointer-events none, max-width 520 px. Title
  child: 26 px / 900 / letter-spacing 2 px / `#ffd23d`. Sub child:
  14 px / 600 / `#dfeef5` / line-height 1.4.
- `#speed`: absolute right 16 px bottom 16 px, 24 px / 800, white,
  `display: none` until driving.
- `#controls-hint`: `WASD move · Shift run · E enter car · F punch ·
  Space handbrake · M mute`, bottom centre, 12 px, translucent dark pill.
- `#mute-indicator`: `🔇 MUTED`, right 16 px bottom 52 px, 13 px / 700,
  `#ffb3b3`, `display: none` until muted.

API: `banner(title, sub, ms)` — sets texts, opacity 1, auto-hides after
`ms` (default 4000) via `setTimeout` (clearing any previous timer);
`hideBanner()`; `drawMinimap()`.

`drawMinimap(state, ctx, canvas)` — same mapping as main.js's local
version (`half = city.half + 60`, `toMap`), plus: cash drops as green
`#7dff9a` dots r 3.5 (while Payday Pickup is active, untaken only);
traffic cars as white dots r 2.5; police as red `#ff4d4d` dots r 3;
mission marker as a pulsing yellow diamond (rotated square, size
`5 + sin(time*4)*1.5`); player arrow as before. All entry positions are
read defensively (`entry.pos`, `entry.x/z`, or `entry.mesh.position`).

`updateHud(state, dt)` — refresh from state, every write guarded by a
module-level cache (`{ cash, health, wanted, objective, speed, muted }`):
- Cash: `$` + locale string.
- Health: bar width %; colour green gradient normally, red gradient
  (`#d63a37 → #ff7a5d`) below 30%.
- Wanted: `'★'.repeat(n) + '☆'.repeat(5 − n)`.
- Objective: `'<title> — <text>'`, plus ` (Ns)` when a mission timer is
  running; `NEON BAY LEGEND — you own this city.` when `gameComplete`;
  default `Talk to Vera at the garage. First mission coming soon.`
- Speed (only while driving): `Math.round(|car.speed| * 3.6) + ' km/h'`
  (m/s → km/h); hidden on foot.
- Mute indicator shown iff `state.muted`.
- Minimap redrawn every frame while playing; also once on the title
  screen so it is never blank.

### 3.14 audio.js — audio

Responsibility: *every sound in the game, synthesized live with WebAudio.
No audio files, no network: engine hum, police siren, pickup chime,
mission jingle, punch/crash thuds, UI clicks, and a quiet synthwave
arpeggio loop for ambience. The AudioContext only exists after a user
gesture (browsers block audio before interaction), so everything
lazy-inits on the first gesture or the first play() call, and every public
entry point is guarded: audio must never throw, even before the context
exists. Master mute follows `state.muted` (M key).*

`createAudio(state)` → `api { play, update(dt) }`, stored on
`state._audio`; also installs `window.__sfx = (name) => play(name)` and
`window.__audioState = () => ctx ? ctx.state : 'none'`.

- `ensure()`: creates the `AudioContext` (or `webkitAudioContext`) on
  first use, builds the node graph, resumes if suspended; returns false
  when unavailable. Unlock listeners on window `pointerdown`/`keydown`
  call `ensure()` (first gesture) or resume a suspended context.
- Node graph: master gain (0.9, or 0 while muted) → destination.
  - **Engine:** sawtooth oscillator (55 Hz) → low-pass filter (420 Hz)
    → gain (0) → master; started once.
  - **Siren:** square oscillator (820 Hz) → gain (0) → master; an LFO
    (square, 1.1 Hz, gain 140) modulates the siren frequency (~0.45 s
    per tone); both started once.
  - **Music bus:** gain 0.05 (`MUSIC_GAIN`) → master; notes scheduled in
    `update`.
- One-shot synth helpers: `tone(freq, dur, type, vol, delay = 0,
  slideTo = 0)` (oscillator with 0.01 s attack ramp and exponential decay
  to 0.0001, optional exponential frequency slide); `noiseBurst(dur, vol,
  filterFreq)` (white-noise buffer with linear decay through a low-pass).
- `play(name)` — named one-shots (all guarded; no-op before the context
  exists or while it isn't `running`):
  - `'pickup'`: bright two-note chime — sine 987.77 Hz 0.12 s vol 0.22,
    then 1318.5 Hz 0.2 s vol 0.22 at +0.09 s.
  - `'mission-complete'`: rising arpeggio — triangle 523.25 / 659.25 /
    783.99 / 1046.5 Hz, 0.22 s each, vol 0.22, staggered 0.11 s.
  - `'fail'`: low descending buzz — sawtooth 220 → 110 Hz, 0.45 s,
    vol 0.14.
  - `'punch'`: body thud — sine 170 → 55 Hz, 0.12 s, vol 0.3, plus noise
    burst 0.08 s vol 0.18 filter 700.
  - `'crash'`: metal crunch — noise burst 0.28 s vol 0.32 filter 800,
    plus sine 95 → 38 Hz, 0.3 s, vol 0.28.
  - `'click'`: UI blip — square 880 Hz, 0.05 s, vol 0.07.
  - `'siren'`, `'busted'`, `'wasted'`, `'hit'`: **called by other slices
    but have NO case in v1's `play()` switch** — they hit the `default`
    branch and are silent. The `'siren'` sting on a fresh wanted star
    (§3.10) and the busted/wasted/hit sounds are therefore silent in v1.
    The rebuild may either keep this (documented silence) or add them;
    if added, keep them quiet one-shots in the same style — do not change
    the existing six.
- `update(dt)` (per frame; also exported as `updateAudio(state, dt)`):
  - If muted, master gain → 0 (setTargetAtTime, 0.05 s); else → 0.9.
  - Engine: speed from the player's car (or 0 on foot); on when in a car
    and `speed > 0.5`; target frequency `55 + min(40, speed) * 3.6`;
    target gain `0.045 + min(0.075, speed * 0.0018)` when on, else 0
    (both eased with setTargetAtTime, 0.08–0.1 s).
  - Siren: on when `wanted > 0` and police are near — nearest police
    unit < 160 m, or the police list is empty (then wanted heat alone is
    enough to hear it faintly); target gain 0.035 when on, else 0
    (0.15 s easing).
  - Music: synthwave arpeggio, `MUSIC_STEP = 0.24` s per note; chords
    (roots in Hz) cycle Am → F → C → G:
    `Am [110.0, 130.81, 164.81, 220.0]`, `F [87.31, 110.0, 130.81,
    174.61]`, `C [130.81, 164.81, 196.0, 261.63]`, `G [98.0, 123.47,
    146.83, 196.0]`. Chord changes every 4 steps
    (`CHORDS[floor(musicStep/4) % 4]`), note within the chord is
    `chord[musicStep % 4]`; triangle oscillator, 0.02 s attack, decay to
    0.001 over `MUSIC_STEP * 1.8`, stopped at `MUSIC_STEP * 2`. Notes are
    scheduled up to 0.18 s ahead of `ctx.currentTime`; if the scheduler
    falls more than 1 s behind, it resets to `currentTime + 0.05`.

### 3.15 save.js — save/load

Responsibility: *persist the player's progress in localStorage under
namespaced keys and read it back, tolerating a missing or corrupt save (a
bad save is simply no save).*

- `SAVE_KEY = 'neon-bay.save.v1'` (from config.js).
- `loadSave()` → `{ cash, missionIndex, health, pos: { x, y: 0, z } | null, savedAt }`
  or `null`. Validates types field by field (numbers default 0 / 0 / 100
  / 0; `pos` only when an array of length 3). Any throw (including
  `JSON.parse` failure) → `null`.
- `saveGame(state)` → true/false. Writes `{ cash, missionIndex, health,
  pos: [x, y, z], savedAt: Date.now() }` as JSON. False when storage is
  unavailable (e.g. private windows) — progress then lasts the visit only.
- `clearSave()` removes the key (guarded).
- What is saved: **only** cash, mission index, health, player position,
  and timestamp. NOT saved: wanted (always 0 on load), the active
  mission's step/progress (restarts at the mission's first step via
  `startMission`), cars, traffic/ped state, police, stats, mute. The
  rebuild must not "improve" this into a fuller save without a design
  decision — the smoke tests rely on the current shape.

### 3.16 shots.js — screenshot staging

Responsibility (v1): *put the world in the named scene for
`?shot=<name>&seed=<n>`. For now there is only the title screen: the
player stands by the garage and the camera looks down the street at Neon
Bay Tower. Later slices add chase/street/heist/city shots with a real
autopilot; the shape (return the screen to draw) stays the same.*

- `stageShot(name, state)`: ignores `name` (any unknown name stages the
  title screen — in v1 ALL names do). Sets `state.screen = 'title'`,
  `state.time = 0`; player at garage + (0,0,18), heading π; camera
  `yaw 0, pitch 0.42, dist 11`. Returns `{ screen: SCREEN_TITLE }`.
- The kit starter's `shots.js` staged three scenes (`start`/`play`/`end`)
  by playing a 2D autopilot forward; v1 replaced the game but kept only
  the title stub. **Slice E must implement the four real shots** (see
  §6.3 and §9.8): `chase`, `street`, `heist`, `city` — stage each by
  simulating the real game forward from a seeded world with a simple
  autopilot (drive toward the mission marker, keep clear of buildings),
  paint twice, set `window.__shotReady`. The shape — return the screen
  to draw — stays the same.


## 4. Game design synthesis

This section describes the playable game as a whole. Everything here is
a restatement of the module specs in §3 — if §4 and §3 ever disagree,
§3 (and the v1 code behind it) wins; the disagreement belongs in §9.

### 4.1 The city of Neon Bay

Neon Bay is a sun-soaked coastal city, 9×9 blocks on a 72 m pitch
(60 m block + 12 m road), ~660 m across, centred on the origin. The
south edge (+Z) is a beach with palms and a boardwalk, then open ocean;
the other three edges are hard world bounds. The centre block holds the
88 m Neon Bay Tower with a pink beacon. Four corner-ish landmarks anchor
the map and the story: Marchetti Garage (−144, −144, mission hub and
spawn), Bay General Hospital (144, −144, wasted respawn), Neon Bay
Police HQ (−144, 144, busted respawn), Neon Bay Bank (144, 144, the
heist target). Ordinary blocks hold 1–3 procedural buildings (8–40 m)
with pastel facades, lit windows, shopfronts and awnings. Streets have
lamps, benches, hydrants, palms, and 8 decorative traffic lights.
Traffic (14 cars), parked cars (8), and pedestrians (16) fill the city;
the player is never alone in it. The look is warm and bright: blue sky
dome, haze fog, drifting clouds, one shadow-casting sun that follows the
player.

### 4.2 Story and characters

**Danny Cole** is the player: a driver-for-hire, new in town, broke,
good behind the wheel. **Vera "V" Marchetti** is the fixer who runs the
garage at (−144, −144) and hands Danny the jobs; every mission briefing
is her voice, and the garage is the hub the story keeps returning to.
There are no other named characters. All names, dialogue, art, and sound
are original — nothing is taken from any existing game or film.

The arc, in one line: Danny arrives with no car and no money, steals
his first wheels, runs cash for Vera, gets the cops to know his name,
proves he can outrun them, and ends by robbing Neon Bay Bank and
becoming a legend.

### 4.3 The 5-mission arc

Missions run in fixed order, 1 → 5, auto-chaining: when one completes,
the next briefing appears 2.5 s later (`nextStartAt = state.time +
2.5`). Mission 1 auto-starts when play begins (see §2.4 and §9.12).
Rewards are cash only; there is no shop, no upgrade, no inventory.

| # | Title | Trigger to advance / complete | Reward |
|---|---|---|---|
| 1 | First Wheels | Step 0: get in any car (see §9.15). Step 1: drive it within 8 m of the garage front (−144, 0, −126). | $500 |
| 2 | Payday Pickup | Collect 3 cash drops (tower, hospital, police fronts) — within 4 m of each. Beacon moves to the next remaining drop. | $800 |
| 3 | Hot Pursuit | Step 0: reach wanted ≥ 2. Step 1: lose all heat (wanted back to 0). | $1,200 |
| 4 | The Getaway | Reach the pier (0, 0, 348) within 10 m before the 90 s timer runs out. Timer runs from mission start (§9.16). Fail → same mission restarts from the top. | $1,500 |
| 5 | Bay Heist | Step 0: reach the bank front (144, 0, 164). Step 1: hold position within 8 m for 5 s to crack the vault (progress decays if you leave). Step 2: escape to the garage front — only counts with wanted ≥ 1. | $3,000 + ending |

Ending: completing mission 5 sets `state.gameComplete = true` and shows
the banner `NEON BAY LEGEND` / `You own this city.` for 9 s. The game
stays playable afterwards (free roam); the objective line reads
`NEON BAY LEGEND — you own this city.` Every completion saves
immediately (`saveGame`), pays the reward, and shows a
`MISSION COMPLETE` / `+$X — <title>` banner for 4.2 s. The only
failable mission is 4 (timeout); all others can only be completed, never
failed.

### 4.4 Moment-to-moment loop

The loop the player actually lives in, on foot and in a car:

1. **On foot.** Spawn at the garage front. WASD moves camera-relative,
   Shift runs, mouse drag orbits the camera. The city is open: walk
   anywhere, collide with buildings, never fall off the map.
2. **Steal a car.** Walk within 3.5 m of a parked car (free, no heat) or
   an occupied traffic car (+1 star, `stats.carsStolen += 1`) and press
   E. The player mesh hides; the chase camera eases behind the car.
3. **Drive.** W/S accelerate and brake/reverse, A/D steer (speed
   sensitive), Space handbrakes into a slide. Cars collide with
   buildings (bounce, −1 health, speed × −0.25), other cars (soft push),
   and pedestrians (a hit at > 2 m/s knocks the ped down and adds +1
   star). Exit with E at < 1 m/s; the car stays where you left it as a
   parked car.
4. **Heat.** Stealing an occupied car, hitting a pedestrian, hitting a
   cop, or being seen assaulting someone within 60 m of police each add
   stars (0–5). Police cars spawn (1 per star, max 3) and chase on the
   road grid, ram, and deploy foot cops when close; at 3+ stars, 2 foot
   cops run the player down, punch, and arrest (2 continuous seconds
   within 2 m → busted). Heat decays −1 star per 20 s only when no
   police unit is within 80 m.
5. **Busted / wasted.** Busted: −20% cash, respawn at Police HQ, wanted
   0, health 100. Wasted (health 0): −10% cash, respawn at the hospital.
   Enter resumes. The mission state survives both — only cash is lost.
6. **Missions.** The yellow beacon and the minimap diamond always point
   at the current objective; the objective line names it; cash drops are
   green beacons. Follow the beacon, do the job, get paid, next job.
7. **Free roam after the ending.** Missions done, heat still works, cars
   still stealable — the city stays live.

### 4.5 Controls

| Input | On foot | Driving | Title / paused / busted / wasted |
|---|---|---|---|
| W / ↑, S / ↓, A / ←, D / → | Move (camera-relative) | Accelerate / brake-reverse, steer | — |
| Shift (either) | Run (9 m/s vs 5) | — | — |
| Space | — | Handbrake | Confirm (start / resume) |
| E | Enter nearest car (≤ 3.5 m) | Exit car (only if \|speed\| < 1 m/s) | — |
| F | Punch (2.2 m arc, 0.35 s cooldown) | — | — |
| P or Esc | Pause | Pause | P resumes from paused |
| M | Mute toggle | Mute toggle | Mute toggle |
| Enter | — | — | Start (title), resume (paused / busted / wasted) |
| Mouse drag on canvas | Orbit camera | Orbit camera (eases back to chase view while driving) | — |

There is **no** C (camera) key and **no** R (reset car) key in v1, despite
the coordinator notes claiming them (see §9.2). Space does double duty
(handbrake while driving, confirm on screens) — this is harmless by
design, because the two never apply at the same time. No touch controls,
no pointer lock.

### 4.6 Heat, health, and the busted/wasted loop

Health starts at 100 and is restored to 100 on busted/wasted respawn;
nothing else heals. Damage sources: police car ram on foot (−5), foot
cop punch (−10), player-car collision with a building (−1 car health,
not player health). Player health reaching 0 means wasted, checked
before and after stepping police units each frame. Wanted stars 0–5 are
the game's difficulty dial: 0 is calm (traffic, peds, missions), 1–2 is
a chase, 3+ adds foot cops and arrests. Losing heat is a real mechanic
(mission 3 requires it): break line of contact until no police unit is
within 80 m, then wait out the 20 s decay per star. Being busted or
wasted is a setback, not a game over — cash is the only thing lost, and
the mission restarts from its first step only if a save is loaded; in
the live session the active mission keeps its step.

### 4.7 Economy

Cash is the single resource and the score. Sources: mission rewards
($500 + $800 + $1,200 + $1,500 + $3,000 = $7,000 total). Sinks:
busted −20%, wasted −10% (both floored). There is nothing to spend cash
on in v1 — no shop, no car purchase, no bribe. Cash is displayed top
right (`$` + locale string) and is the only number that persists across
sessions besides mission index and health (see §4.8).

### 4.8 Persistence (save)

One `localStorage` key: `neon-bay.save.v1` (see §3.15). What is saved:
`{ cash, missionIndex, health, pos: [x, y, z], savedAt }` — nothing
else. When it is written: every 10 s of play (autosave in `step()`),
and immediately on every mission completion. When it is read: on the
title screen (to decide whether the Continue button shows) and by
Continue, which restores cash, mission index, health, and position;
wanted is always 0 on load, the active mission restarts at its first
step via `startMission`, and cars, traffic, peds, police, stats, and
mute are all fresh. A missing or corrupt save is simply no save
(`loadSave()` returns `null`); storage being unavailable (e.g. private
windows) makes `saveGame()` return false and progress lasts the visit
only. There is no manual save button, no save slots, no delete-save UI
(`clearSave()` exists in code but has no UI caller). The rebuild must
not widen the save into a fuller snapshot without a design decision —
the smoke tests rely on the current shape.

### 4.9 Audio

100% synthesized WebAudio; no audio files, no network. The
`AudioContext` is created lazily on the first user gesture or the first
`play()` call (browsers block audio before interaction) and every public
entry point is guarded — audio must never throw, even before the context
exists. Master gain 0.9, or 0 while muted (M key, `state.muted`).

| Sound | When | Design (one-shot unless noted) |
|---|---|---|
| `click` | UI advance / mission step | Square 880 Hz, 0.05 s, vol 0.07 |
| `pickup` | Cash drop collected | Sine 987.77 Hz 0.12 s then 1318.5 Hz 0.2 s at +0.09 s, vol 0.22 |
| `mission-complete` | Mission completes | Triangle arpeggio 523.25 / 659.25 / 783.99 / 1046.5 Hz, 0.22 s each, staggered 0.11 s, vol 0.22 |
| `fail` | Mission 4 timeout | Sawtooth 220 → 110 Hz, 0.45 s, vol 0.14 |
| `punch` | F punch (hit or whiff) | Sine 170 → 55 Hz, 0.12 s, vol 0.3, + noise burst 0.08 s vol 0.18 filter 700 |
| `crash` | Police ram | Noise burst 0.28 s vol 0.32 filter 800 + sine 95 → 38 Hz, 0.3 s, vol 0.28 |
| `siren` | Fresh wanted-star increase (sting) | **Missing in v1 — implement in the rebuild (§9.10).** Prescribed: two-tone wail, square 700 → 950 Hz, 0.5 s, vol 0.12. Distinct from the continuous siren loop below. |
| `busted` | Busted flow | **Missing in v1 — implement (§9.10).** Prescribed: low descending two-note sting, triangle 330 → 220 Hz, 0.6 s, vol 0.18. |
| `wasted` | Wasted flow | **Missing in v1 — implement (§9.10).** Prescribed: low descending two-note sting, triangle 262 → 175 Hz, 0.7 s, vol 0.18. |
| `hit` | Foot cop punch lands | **Missing in v1 — implement (§9.10).** Prescribed: short thud, sine 200 → 70 Hz, 0.1 s, vol 0.25, + noise burst 0.05 s vol 0.12 filter 900. |

Continuous layers (in `update(dt)`): **engine** — sawtooth 55 Hz
through a 420 Hz low-pass, frequency `55 + min(40, speed) * 3.6`, gain
`0.045 + min(0.075, speed * 0.0018)` while driving faster than 0.5 m/s,
else 0; **siren loop** — square 820 Hz with a 1.1 Hz LFO (±140 Hz),
gain 0.035 while `wanted > 0` and the nearest police unit is < 160 m
(or the police list is empty), else 0; **music** — a quiet synthwave
arpeggio, triangle notes, 0.24 s per step, chords cycling Am → F → C →
G (roots in §3.14), chord changing every 4 steps, bus gain 0.05,
scheduled up to 0.18 s ahead. `window.__sfx(name)` plays a named sound
from anywhere; `window.__audioState()` returns the context state or
`'none'`.

## 5. Acceptance checks per slice

These are the EXACT check lists recovered from the four v1 smoke scripts
in `~/workspace/makefun/gta6-01-dev/smoke-{a,b,c,d}.mjs` (dev scratch,
not part of the repo). The rebuild agents re-run them against the rebuilt
game; a slice is done only when its list passes in full. Every check
below is named exactly as the script names it, with what it asserts and
how. No check's content was unrecoverable — all four scripts are
complete and quoted faithfully here.

### 5.0 How to run them (common harness)

All four scripts share the same harness; only the checks differ.

- **Serve:** spawn `node serve.ts --port 8080` with cwd the repo root;
  poll `http://localhost:8080/` until it answers (up to 40 × 250 ms);
  kill the server in a `finally`.
- **Browser:** `playwright-core` `chromium.launch` with
  `executablePath: ~/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`
  (note: `chrome-linux64/chrome`, not `chrome-linux/chrome`) and args
  `['--no-sandbox', '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader']` (smoke D adds
  `'--autoplay-policy=no-user-gesture-required'`). Viewport 1280×720
  (smoke C uses 960×540).
- **Error capture:** every script collects `console` messages of type
  `error`, `pageerror` events, and `requestfailed` events into arrays,
  and the last two checks of every list assert both arrays are empty.
- **Game-time waits:** headless SwiftShader renders at ~0.1× real time
  (game time advances ~0.5 s per 5 s wall clock), so waits are driven by
  `window.__game.time`, not wall-clock sleeps — `waitForFunction` on a
  game-time predicate with a generous real-time timeout (60–120 s), or a
  poll loop with a game-seconds budget. A plain `waitForTimeout` is only
  used for sub-second UI settles (200–600 ms).
- **State access:** all assertions read the live game through
  `window.__game` (and the hooks in §2.3). Teleporting the player or a
  unit by setting `.pos` directly is the scripts' standard way to stage
  a situation deterministically instead of driving there.
- **Reporting:** `check(name, ok, extra)` prints `PASS`/`FAIL` per check
  and counts failures; the script prints `SMOKE-X: ALL PASS` and exits 0
  only when every check passes, otherwise `SMOKE-X: N FAILURE(S)` and
  exit 1.
- **Screenshots:** each script saves a PNG next to itself
  (`smoke-a-title.png`, `smoke-a-shot.png`, `smoke-a.png`, `smoke-b.png`,
  `smoke-c.png`, `smoke-d.png`) as visual evidence; the PNGs are not
  assertions.

### 5.1 Slice A — foundation (10/10)

Run: `node smoke-a.mjs` (cwd `~/workspace/makefun/gta6-01-dev/`).
Loads `http://localhost:8080/`, waits 2.5 s.

| # | Check (exact name) | Asserts / how |
|---|---|---|
| A1 | title screen renders | `#title` is not `.hidden` and its text contains `NEON BAY`. |
| A2 | canvas sized | `#game` canvas has `width > 0` and `height > 0`. |
| A3 | Enter starts play | After `keyboard.press('Enter')` + 500 ms, `window.__game.screen === 'play'`. (Also saves `smoke-a-title.png` before this.) |
| A4 | player moves with WASD | Record `player.pos` (x, z); hold W 2 s, then A 1 s; distance moved > 2 m. |
| A5 | Shift run is faster than walk | Hold ShiftLeft + W 800 ms; sample `player.speed` while running; > 6 m/s. |
| A6 | P pauses | `keyboard.press('KeyP')` + 300 ms → `screen === 'paused'`. |
| A7 | P resumes | `keyboard.press('KeyP')` again + 300 ms → `screen === 'play'`. (Also saves `smoke-a.png`.) |
| A8 | ?shot=title sets __shotReady | `page.goto('/?shot=title&seed=1')`, `waitForFunction(() => window.__shotReady === true, 10 s)`. (Also saves `smoke-a-shot.png`.) |
| A9 | no console errors | Console-error + pageerror arrays are empty. |
| A10 | no failed requests | Failed-request array is empty. |

### 5.2 Slice B — vehicles + traffic (13/13)

Run: `node smoke-b.mjs`. Loads `/?seed=1`, waits 2.5 s, presses Enter,
waits 500 ms. All movement waits are game-time based (see §5.0).

| # | Check (exact name) | Asserts / how |
|---|---|---|
| B1 | Enter starts play | `window.__game.screen === 'play'` after Enter. |
| B2 | traffic spawns ~14 cars | `window.__game.traffic.length === 14`. |
| B3 | parked cars spawn ~8 | `window.__game.parkedCars.length === 8`. |
| B4 | pedestrians spawn ~16 | `window.__game.peds.length === 16`. |
| B5 | E enters parked car | Teleport the player to `parkedCars[0].pos + (2, 0, 0)`; press E; after 400 ms `player.onFoot === false`, `player.car` set, `parkedCars.length` is 7 (the entered car left the list). |
| B6 | W accelerates the car | From the entered car, hold W until `__game.time` advances 3 s; `player.speed > 5` m/s and distance moved > 10 m. |
| B7 | E exits car at low speed | Hold S until `\|car.speed\| < 1` (game-time wait, 60 s real timeout); press E; after 400 ms `player.onFoot === true`, `player.car` null. (Also saves `smoke-b.png` before the braking step.) |
| B8 | traffic cars move along roads | Sample all traffic car positions, wait 2.5 game-s, re-sample; ≥ 10 of 14 cars moved > 1 m. |
| B9 | traffic cars stay on roads | `traffic.filter(t => !city.isOnRoad(t.car.pos.x, t.car.pos.z)).length === 0`. |
| B10 | pedestrians walk | Sample all ped positions, wait 2.5 game-s, re-sample; ≥ 12 of 16 peds moved > 0.5 m. |
| B11 | E steals occupied traffic car | Record `stats.carsStolen`; teleport the player next to `traffic[0].car`; press E; after 400 ms `onFoot === false`, `stats.carsStolen` increased by exactly 1, `traffic.length === 13`. |
| B12 | no console errors | Console-error + pageerror arrays are empty. |
| B13 | no failed requests | Failed-request array is empty. |

Note on B11: this check ran against the B-only isolated copy, before
the police slice existed, so no wanted star was asserted (there was no
`__wantedAdd` yet). In the integrated game the same steal also adds +1
wanted star — see §9.17.

### 5.3 Slice C — police + combat + wanted (20/20)

Run: `node smoke-c.mjs`. Loads `/` (no seed), waits 2 s, presses Enter.
Helpers: `waitForGame(page, fn, gameSeconds, realTimeoutMs, label)` —
polls `fn` every 300 ms until true, a game-time budget, or a real
timeout; `waitGameTime(page, seconds, realTimeoutMs)` — waits until that
many game-seconds pass. Sets `__game.cash = 1000` before the wanted
tests so the cash-loss assertions have a known base.

| # | Check (exact name) | Asserts / how |
|---|---|---|
| C1 | Enter starts play | `waitForGame(() => screen === 'play', 2 game-s, 30 s)`; assert `screen === 'play'`. |
| C2 | __wantedAdd hook exists | `typeof window.__wantedAdd === 'function'`. |
| C3 | __police test hook exists | `window.__police` exists and `typeof window.__police.setDecaySeconds === 'function'`. |
| C4 | wanted 2 spawns 2 police cars | `window.__wantedAdd(2, 'stolen car')`; wait (5 game-s, 60 s) until `wanted === 2` and ≥ 2 police units of kind `'car'`. |
| C5 | police cars chase (distance closes) | Nearest police-car distance to the stationary player, before vs after 3 game-s of chase; assert it closed by > 20 m. (Also saves `smoke-c.png`.) |
| C6 | wanted 3 spawns foot cops | `window.__wantedAdd(1, 'stolen car')` (wanted 2 → 3); wait (5 game-s, 60 s) until some police unit of kind `'foot'` exists. |
| C7 | F punch damages cop 15 and adds wanted (hit police) | Park all police cars 600 m away (their rams would shove the player and break the geometry); teleport a foot cop to 1.5 m in front of the player, face both at each other (`player.heading = atan2(1.5, 0)`); press F; within 1.5 game-s assert the cop's health dropped by exactly 15, `wanted` rose by exactly 1, and `screen` is still `'play'` (the 2 s arrest timer cannot fire inside this window). |
| C8 | busted flow triggers | Teleport a standing foot cop to 1 m from the player, `arrestTimer = 0`; wait (5 game-s, 90 s) until `screen === 'busted'`. |
| C9 | busted: -20% cash, wanted 0, health 100, respawn at police station | After C8: `cash === 800` (20% of the 1000 set earlier), `wanted === 0`, `health === 100`, distance from player to the police landmark < 60 m. |
| C10 | busted overlay visible | `#busted` element exists and `style.display !== 'none'`. |
| C11 | Enter resumes from busted | Press Enter + 500 ms → `screen === 'play'`. |
| C12 | no decay while police within 80 m | `__police.setDecaySeconds(1)` (test hook — shipped decay stays 20 s), `__wantedAdd(2, ...)`; wait 1 game-s; assert `wanted === 2` still (police are closing in, so decay is blocked). |
| C13 | wanted decays to 0 with police far away (test decay 1 s) | Teleport all police units 600 m away; wait 3 game-s (decay interval is 1 s via the hook); assert `wanted === 0`. Then restore `setDecaySeconds(20)`. |
| C14 | foot cop spawns for wasted test | Set `cash = 1000`, `health = 1`, `__wantedAdd(3, ...)`; wait (5 game-s, 60 s) until a foot cop exists. |
| C15 | wasted flow triggers on health 0 | Teleport a standing foot cop to 1 m from the player, `punchCooldown = 0`, `arrestTimer = 0`; wait (5 game-s, 90 s) until `screen === 'wasted'` (the cop punch takes health 1 → 0). |
| C16 | wasted: -10% cash, wanted 0, health 100, respawn at hospital | After C15: `cash === 900`, `wanted === 0`, `health === 100`, distance to the hospital landmark < 60 m. |
| C17 | wasted overlay visible | `#wasted` element exists and `style.display !== 'none'`. |
| C18 | Enter resumes from wasted | Press Enter + 500 ms → `screen === 'play'`. |
| C19 | no console errors | Console-error + pageerror arrays are empty. |
| C20 | no failed requests | Failed-request array is empty. |

### 5.4 Slice D — missions + HUD + audio (15/15)

Run: `node smoke-d.mjs`. Loads `/?seed=1`, waits 2 s. Chromium is
launched with the extra `--autoplay-policy=no-user-gesture-required`
flag so the audio context can run headless.

| # | Check (exact name) | Asserts / how |
|---|---|---|
| D1 | __game hook exists | `!!window.__game`. |
| D2 | __missionEvent hook exists | `typeof window.__missionEvent === 'function'`. |
| D3 | __sfx hook exists | `typeof window.__sfx === 'function'`. |
| D4 | Enter starts play + mission 1 auto-starts | Press Enter + 600 ms; `screen === 'play'`, `mission.title === 'First Wheels'`, `missionIndex === 0`. **This check only passes with the §2.4 reconstructed wiring** (the `startMission` call on entering play); it fails against the unwired v1 HEAD `main.js`. |
| D5 | HUD objective shows mission 1 | `document.getElementById('objective').textContent` includes `First Wheels`. |
| D6 | minimap draws mission marker | Recompute the marker's minimap pixel from `mission.marker` with the same `toMap` mapping as the HUD (`half = city.half + 60`); scan the 12×12 px box around it for a yellow pixel (`r > 200, g > 180, b < 100`). |
| D7 | steal advances mission 1 to garage step | Teleport the player to the city centre (0, 0, 0) — away from the garage doorstep where it spawns — set `stats.carsStolen = 1`; after 400 ms `mission.stepIndex === 1`. |
| D8 | mission 1 completes: +$500, index -> 1 | Teleport the player to `_missions.garageFront`; after 600 ms `cash === 500`, `missionIndex === 1`, `stats.missionsDone === 1`. |
| D9 | mission-complete banner shows | `#banner` text includes `MISSION COMPLETE` and `500`. |
| D10 | mission 2 auto-starts | `waitForFunction(() => mission.title === 'Payday Pickup', 30 s)` — the 2.5 s game-time breather after mission 1. |
| D11 | mission 2 completes: cash $1300, index -> 2 | Teleport the player onto each untaken drop in turn (`_missions.drops`, `find(d => !d.taken)`, 400–600 ms between teleports); assert `cash === 1300` (500 + 800) and `missionIndex === 2`. |
| D12 | audio context initializes after click (no throw) | `page.mouse.click(640, 360)` + 300 ms; call `window.__sfx('click')` and `window.__sfx('mission-complete')`; `window.__audioState()` is `'running'` or `'suspended'`. |
| D13 | M mutes + indicator shows | Press M + 300 ms; `__game.muted === true` and `#mute-indicator` `style.display !== 'none'`. Press M again to restore. (Also saves `smoke-d.png`.) |
| D14 | no console errors | Console-error + pageerror arrays are empty. |
| D15 | no failed requests | Failed-request array is empty. |

## 6. Key technical constraints

These are the rules the rebuild must not violate. §1.3 states the
short form; this section is the binding detail.

### 6.1 Offline, static files, no network

- The game is `game/index.html` + ES modules + the vendored three.js.
  No build step, no bundler, no TypeScript in the game itself, no
  server-side logic. `serve.ts` is a dev convenience only.
- **No network requests at runtime, ever.** Every script, texture, and
  image is a file under `game/` or a `data:` URI. Textures are procedural
  canvas textures; audio is synthesized WebAudio; the favicon is
  `data:,`. The only external file the page loads is the vendored
  `game/vendor/three.min.js`. A page load with the network disabled must
  play identically — the smoke tests' "no failed requests" check (§5)
  enforces this.
- Only one bare import specifier is allowed, via the import map:
  `{"three": "./vendor/three.min.js"}`. No CDN, no other library.

### 6.2 Platform and input

- **Desktop Chrome**, keyboard + mouse. No touch controls, no pointer
  lock; the camera orbits on mouse drag. Headless verification uses
  Chromium with SwiftShader (§5.0).
- Fixed step `STEP = 1/60` s; simulation advances only in fixed slices,
  only while the screen is `play` (title steps advance `state.time` and
  the camera orbit only). A frame stall longer than `MAX_FRAME = 0.25` s
  is dropped, not replayed.
- Flat world: Y = 0 is ground everywhere; no jumping, no hills, no
  vertical movement except mesh bob.
- Audio, HUD hooks, and the cross-slice `window.*` hooks are all guarded
  with try/catch — a missing system must never break gameplay, and audio
  must never throw.

### 6.3 Screenshots and scorer caps

- **Screenshots:** exactly 4, each ≤ 256 KiB (262,144 bytes), JPEG,
  1280×720 (long side ≤ 1280, short side ≥ 480), quality ~0.8. The four
  shots are `chase`, `street`, `heist`, `city` (see §3.16 and §9.8),
  staged by `?shot=<name>&seed=N`, painted twice, signalled by
  `window.__shotReady`. `shots.json` must list the four real shots, not
  the kit starter's `start`/`play`/`end`.
- **Scorer caps, enforced in `main.ts`:** screenshots max 4, each max
  262,144 bytes; game max **993 files**, max **50,331,648 bytes
  (48 MiB)**; game path max 1000 bytes; dossier text budget
  `text_max_bytes: 163840`. `main.ts` refuses an entry the scorer would
  refuse rather than submitting a doomed one.
- `game/index.html` ≤ 1 MiB. The dossier (`dossier.json`) ≤ 1.5 MiB.

### 6.4 Entry program and authorship rule

- `main.ts` (Node 22, standard library only) copies `game/` and
  `screenshots/` into `/output` (or `$MAKEFUN_OUTPUT_DIR` outside the
  grader container) and writes `/output/dossier.json` with the vendored
  `vendor/makefun-game.ts` `buildDossier`. It must be rewritten fresh by
  an agent in a recorded session — at least 1 authored line; the starter
  `main.ts` is kit-excluded and does not count.
- **Authorship bar (competition rule):** ≥ 30% authored lines overall;
  some file revised in ≥ 2 assistant messages; every file's final content
  written during recorded sessions. No downloaded or copied-in
  deliverable code except vendored libraries (`*.min.js`, i.e. three.js
  r170) and kit files. The rebuild agents write every game file fresh
  from this document and never open the v1 `.js` files — reading them
  would count their lines as copied against the 30% bar.
- `README.md` at the repo root carries the three make.fun badges for
  owner `Kenichiii999`, repo `gta6-01`, referral `9v6tjk8q`, and the run
  command `node serve.ts` + `http://localhost:8080`.

### 6.5 Determinism

- `?seed=N` fixes the city layout and traffic spawn (seeded mulberry32;
  city from `createRandom(seed)`, traffic from
  `createRandom((seed >>> 0) + 7)`). Facade window patterns are seeded;
  road/sidewalk/sand speckle grain is not (visual only, §9.14).
- Behavioural randomness must also go through the seeded RNG in the
  rebuild — traffic turn rolls and ped timers in v1 use `Math.random()`,
  so `?seed=N` does not fully fix behaviour (§9.9); police spawn
  positions do the same (§9.13). Route them through the seeded RNG.
- Never invent new palette entries, tuning numbers, or key bindings the
  modules don't consume; keep the one-job-per-file split and the file
  list in §2.1 (the judge reads the outline).

## 8. Integration evidence — how v1 was actually verified

There is no §7 in this document; the numbering jumps from §6 to §8
because no §7 was ever assigned. This section exists because the
preamble (and §2.4) cite it: slices B/C/D were verified against an
**integrated copy** with the wiring applied, not against the committed
`main.js` at HEAD.

**What the integrated copy was.** Each slice agent (B, C, D) took the
HEAD tree, applied its slice's wiring snippet to a scratch copy of
`main.js` — imports, `createXxx` calls, per-step `updateXxx` calls,
`handleCarInteract` on the E key, the `frameActions` stash, and the
`startMission` call on entering play — ran its smoke test against that
copy, and then **reverted `main.js` to byte-identical HEAD** before
committing only its own module files. The wiring snippets are preserved
in the slice reports (coordinator progress log, §2.4) and are the source
of the **[reconstructed]** markings in §2.4. The committed game at HEAD
(`ec90ef6`) therefore plays only the slice-A part (on-foot movement in
the city + HUD skeleton); the full game exists only as HEAD + the §2.4
wiring. That is a defect of the v1 commit, not of the design — see §9.1.

**Verification record.**

| Slice | Commit | Smoke result | Notes |
|---|---|---|---|
| A — foundation | `5d1313b` | smoke-a 10/10, 0 console errors, 0 failed requests | game/ 752 KB, 12 files |
| B — vehicles + traffic | `59542fd` | smoke-b 13/13, 0 console errors, 0 failed requests | Verified against an ISOLATED copy (shared tree was broken mid-test by C's half-written police.js); B's main.js revert removed only its 5 lines, leaving C+D wiring intact |
| C — police + combat + wanted | `ec90ef6` | smoke-c 20/20, 0 console errors, 0 failed requests | `setDecaySeconds` bug fixed (it is `setPoliceDecaySeconds`, a test hook; shipped decay stays 20 s); main.js reverted to byte-identical HEAD |
| D — missions + HUD + audio | `402a236` | smoke-d 15/15, 0 console errors, 0 failed requests | Mission 1 auto-start asserted (D4) — passes only with the §2.4 wiring |
| E — shots + polish + integration | not spawned | — | Slice E was never spawned: the recording failed to seal (see the coordinator progress log) and the rebuild supersedes it |
| F — verification | not spawned | — | `main.ts` run + `check --kit . --repo` + dossier/caps check; runs against the rebuilt game |

**Rule for the rebuild.** The rebuild ships the §2.4 wiring inside
`game/src/main.js` itself — imports, system creation, per-step updates,
E-key handling, and mission 1 auto-start — and re-runs all four smoke
lists in §5 against that single wired tree. There must be no separate
"integrated copy": the committed `main.js` IS the integrated one.

## 9. Ambiguities

Where v1 code and the earlier coordinator notes
(`~/workspace/makefun/gta6-01-dev/DESIGN.md`) disagree, **the code
wins**. This section lists every disagreement and every v1 defect found
in the first spec pass, each with a prescribed rebuild resolution. The
rebuild must NOT reproduce v1's bugs: a resolution marked
**[rebuild]** is a change from v1 behaviour, and the smoke lists in §5
are the check that the change did not break the game.

### 9.1 Unwired `main.js` at HEAD — B/C/D never connected

**Ambiguity.** The v1 commit at HEAD (`ec90ef6`) ships `main.js` with
no slice B/C/D wiring at all: no `createTraffic` / `createPolice` /
`createMissions` / `createHud` / `createAudio`, no `updateDrive` /
`updateTraffic` / `updatePolice` / `updateMissions` / `updateCombat` /
`updateAudio`, no E-key handling, no mission 1 auto-start. The modules
exist and are complete, and slices B/C/D were verified against an
integrated copy (§8) — but the committed game as-shipped only plays the
slice-A part.

**Resolution [rebuild].** The rebuild MUST wire all slices in `main.js`
exactly per §2.4 (the steps marked **[reconstructed]**). The unwired
HEAD state is a bug, not the spec. Do not "preserve" it, do not ship a
separate integrated copy — the committed `main.js` is the integrated
one, and smoke D check D4 (mission 1 auto-starts) fails without it.

### 9.2 Coordinator / dev notes vs code — the notes are wrong

**Ambiguity.** The coordinator notes disagree with the code in four
places (code wins in all four):

- Notes claim C (camera) and R (reset car) keys. The code has no such
  keys: `KEYS` in config.js lists only W/A/S/D + arrows, Shift, E, F,
  P/Esc, M, Enter/Space (§3.1, §4.5).
- Notes say mission 3 is "evade 30 s". The code is "reach 2 stars, then
  back to 0" — no timer, no 30 s (§3.12).
- Notes say mission 5 is "escape with 3 stars". The code requires
  "≥ 1 star" on the garage escape step (§3.12).
- Notes say "1–4 buildings per block". The code spawns
  `randInt(rng, 1, 3)` — 1–3 buildings per block (§3.6).

**Resolution.** Follow the code in all four cases. Do not implement C/R
keys, a 30 s evade timer, a 3-star escape requirement, or a 4th
building per block.

### 9.3 Traffic lights are decorative — traffic never stops

**Ambiguity.** The coordinator notes say traffic cars "stop at lights".
The code places 8 traffic lights at fixed positions (§3.6) and
`updateTraffic` never reads them: cars slow for the car ahead and for
the player, and turn at intersections, but no light state is ever
checked.

**Resolution.** Follow the code: lights are visual props only. Do not
add stop-at-red behaviour — it would change traffic flow and could
break smoke B checks B8/B9 (cars moving, cars staying on roads).

### 9.4 Combat ↔ traffic mismatch — punched peds never fall

**Ambiguity.** `combat.js` sets `ped.health`, `ped.down`, and
`ped.fleeing` when a punch hits a pedestrian (§3.11), but `traffic.js`
never reads any of those fields: its peds only know `state`
(`'walk'` / `'flee'` / `'down'`), `stateTimer`, and `downTimer`. A
punched ped therefore takes damage in the combat slice and keeps
walking in the traffic slice — the punch's visible effect on peds is
nil (cops are unaffected: their `health`/`down` ARE read by
`police.js`).

**Resolution [rebuild].** `traffic.js` must honour the combat fields:
in `updateTraffic`, a ped with `ped.down === true` behaves as state
`'down'` (lies flat, `downTimer = 3`, then gets up into `'flee'`), and a
ped with `ped.fleeing === true` behaves as state `'flee'` (runs away
from the player at 4.2 m/s) and clears the flag once the flee state is
entered. Keep the existing car-hit path (`state = 'down'`,
`downTimer = 3`) as the canonical down transition; the combat fields
feed into it, they do not create a second one.

### 9.5 `window.__missionEvent('carStolen')` is never called

**Ambiguity.** `missions.js` installs `window.__missionEvent` handling
`'carStolen'` (sets `flags.stolen`, increments `stats.carsStolen`) and
`'cashPickup'` (§3.12), but nothing in v1 calls it. Mission 1's steal
step works anyway, because it also accepts `stats.carsStolen > 0` and
`player.car` (§3.12) — the steal is counted by `cars.js` directly via
`stats.carsStolen += 1` in `enterCar`.

**Resolution [rebuild].** Either call it or remove it — do not leave a
dead event. Prescribed: **call it.** In `cars.js` `enterCar`, when an
occupied car is stolen, call `window.__missionEvent('carStolen')` (guarded
try/catch, as with `__wantedAdd`) in addition to the direct
`stats.carsStolen` increment, so the mission flag path is exercised and
the hook is not dead code. Leave `'cashPickup'` routed through
`collectDrop` as it is (the hook is the alternate entry point for it,
not the primary one).

### 9.6 `state.shakeTime` is set but consumed by nothing

**Ambiguity.** `police.js` sets `state.shakeTime` (0.35 on a ram, 0.25
on a cop punch) via its local `shake()` helper, but no module reads it:
the camera never shakes. The field exists in the shared state (§2.2)
as a dead write.

**Resolution [rebuild].** `render.js` must apply camera shake from it
(slice E work in v1's plan, now part of the rebuild): in
`updateCamera`, while `state.shakeTime > 0`, offset the camera target
by a small random amount (amplitude ~0.15 m × `shakeTime`, decaying)
and decrement `state.shakeTime` by `dt` each frame (clamped at 0).
The shake must be purely visual — it must not move `player.pos` or
affect collision, and it must decay to exactly 0 so the camera settles.

### 9.7 `police.js` duplicates the police-car mesh

**Ambiguity.** `cars.js` exports `makePoliceCar` (a police variant of
the shared car factory, §3.8), but `police.js` never imports it: it
builds its own police car mesh inline from boxes (§3.10), with
different proportions (body 2.0×0.7×4.4, black cabin, black hood/trunk,
own wheel positions) and its own flashing-light fields (`red`, `blue`,
`siren`). Two police-car looks therefore exist in the codebase; only
the police.js one ever appears in-game.

**Resolution [rebuild].** Reuse `makePoliceCar` from `cars.js` for
police units, and delete the inline mesh builder from `police.js`.
Keep the police.js unit behaviour (flashing light bar, chase/ram/deploy
logic, `siren` phase) by driving the factory car's meshes: the factory
car already has a red/blue roof light bar, so the flash can toggle
those meshes' visibility instead of police.js's own `red`/`blue`
meshes. Do not change the unit's external shape (length/width/speed)
beyond what the factory already provides — the chase and ram ranges in
§3.10 were tuned against the police.js mesh, and the factory car's
footprint (4.5 × 1.95) is within 0.1 m of it.

### 9.8 `shots.js` is a title-only stub; `shots.json` / `screenshots/` are kit starter

**Ambiguity.** `stageShot(name, state)` ignores `name` and always stages
the title screen (§3.16); `shots.json` still lists the kit starter's
`1-start.jpg` / `2-play.jpg` / `3-end.jpg` with `?shot=start|play|end`,
and `screenshots/` still holds the kit starter Block Dodger images.
None of the four real shots (`chase`, `street`, `heist`, `city`) exists.

**Resolution [rebuild].** Implement real screenshots: `stageShot`
must handle `chase`, `street`, `heist`, and `city` per the dev notes
(§3.16, §6.3) — stage each by simulating the real game forward from a
seeded world with a simple autopilot (drive toward the mission marker,
keep clear of buildings), paint twice, set `window.__shotReady`.
Replace `shots.json` with the four real shots and replace
`screenshots/` with the four real renders (1280×720 JPEG q~0.8, each
≤ 256 KiB). Unknown shot names still stage the title screen, as v1
does. The kit starter entries and images must not ship.

### 9.9 Non-determinism — traffic turns and ped timers use `Math.random()`

**Ambiguity.** `?seed=N` is specified to fix the world (§3.2, §6.5),
but `traffic.js` rolls intersection turns with unseeded `Math.random()`
(`< 0.22` to turn, `< 0.11` left) and resets ped `stateTimer` from an
unseeded stream (`randRange(Math.random, 2, 8)`, `randRange(Math.random,
3, 9)`, and the ±90° turn roll). Two runs with the same seed therefore
build the same city and spawn the same traffic, but the traffic then
behaves differently.

**Resolution [rebuild].** Route them through the seeded RNG: give the
traffic system its own seeded stream (e.g. `createRandom((state.seed >>>
0) + 7)` already seeds spawns — extend the same stream, or a second
stream derived from the seed, to the turn rolls and ped timers) and
remove every `Math.random()` call from `traffic.js`. The seeded stream
must be created once in `createTraffic` and stored on the traffic
runtime, not re-created per frame. Smoke B checks B8–B10 (cars move,
stay on roads, peds walk) must still pass with the seeded rolls.

### 9.10 Audio gaps — four called sounds have no case in `play()`

**Ambiguity.** `'siren'`, `'busted'`, `'wasted'`, and `'hit'` are called
(`police.js`: `__sfx('siren')` on a fresh wanted increase,
`__sfx('busted')` / `__sfx('wasted')` in the busted/wasted flows,
`sfx('hit')` on a cop punch) but have NO case in `audio.js` `play()` —
they hit the `default` branch and are silent. The wanted sting, the
busted/wasted stings, and the cop-punch thud are therefore all silent
in v1. Note: §3.14 says the rebuild "may either keep this (documented
silence) or add them" — that sentence is superseded by this section.

**Resolution [rebuild].** Implement all four, as one-shots in the same
style as the existing six (see the prescribed designs in §4.9):
`siren` (two-tone wail), `busted` and `wasted` (low descending stings,
distinct pitches so the two flows sound different), `hit` (short
thud). Do not change the existing six sounds. Keep the continuous
siren loop in `update()` as it is — the one-shot `'siren'` sting is a
separate event (fresh star), not the loop.

### 9.11 HUD duplication — local `updateHud`/`drawMinimap` vs `hud.js`

**Ambiguity.** `main.js` has its own local `updateHud()` and
`drawMinimap()` (cash, health, wanted, objective, player arrow, garage
dot), while `hud.js` has the fuller versions (same fields plus speed,
mute indicator, banner, traffic/police/drop/marker minimap layers).
Both draw to the same `#minimap` canvas; whichever runs last wins the
frame, and the local one drops the mission marker, police dots, and
traffic dots that smoke D check D6 asserts.

**Resolution [rebuild].** Use `hud.js` only: `main.js` calls
`state._hud`'s `updateHud(state, dt)` / `drawMinimap()` (via the
`createHud` api stored on `state._hud`, §3.13) and deletes its local
`updateHud()` and `drawMinimap()` entirely. Do not ship both drawing
the same canvas. The HUD element ids and the objective-line format stay
as specified in §2.4/§3.13.

### 9.12 Mission 1 auto-start has no caller

**Ambiguity.** `startMission(state, i)` exists and
`updateMissions` auto-starts later missions via `nextStartAt`, but
nothing in v1 calls `startMission` for mission 1: a fresh game enters
play with `mission === null` and no briefing, and only the 2.5 s
breather path (which needs a prior completion to set `nextStartAt`)
would ever start a mission.

**Resolution [rebuild].** Call `startMission(state, missionIndex)` on
entering play — in `startGame`, after the fresh/load setup, whenever no
mission is active and `missionIndex < 5` (§2.4). Do NOT auto-start when
`missionIndex >= 5` (game complete). Smoke D check D4 asserts this
behaviour.

### 9.13 Police spawn randomness is also unseeded (new)

**Ambiguity.** Found while resolving §9.9: `police.js` also uses
unseeded `Math.random()` — spawn angle and distance
(`50 + random*20` m for cars, `30 + random*15` m for foot cops), the
initial siren phase, and the foot cop `walkPhase`. Same-seed runs
therefore spawn police at different places.

**Resolution [rebuild].** Route these through the seeded RNG as well
(same prescription as §9.9: a seeded stream owned by the police
runtime, created once in `createPolice`). Spawn positions are
gameplay-visible, so this is a real determinism fix, not cosmetic.
Smoke C teleports police units explicitly, so its checks are unaffected
by the seeding.

### 9.14 Texture speckle grain is unseeded (new)

**Ambiguity.** `textures.js` paints road/sidewalk/sand speckles with
unseeded `Math.random()` (§3.5). Same-seed runs therefore have
different asphalt/sand grain. Unlike §9.9/§9.13 this affects no
behaviour — only pixels.

**Resolution.** Accepted as-is: keep the unseeded speckle. It is
visual grain only, it never affects collision, spawn, or any check, and
seeding it would churn every facade texture for no gameplay gain. Do
not "fix" it by seeding; do not cite it as a determinism failure. (The
facade window patterns ARE seeded and must stay seeded.)

### 9.15 Mission 1 "steal" counts any car entry, parked cars included (new)

**Ambiguity.** The briefing says "Borrow a car" and the mission is
called "First Wheels" / "steal any car", but the code advances step 0
when `flags.stolen || stats.carsStolen > 0 || player.car` (§3.12) —
entering a free parked car (no theft, no wanted star) also counts.
Smoke D check D7 relies on this: it sets `stats.carsStolen = 1`
directly rather than stealing.

**Resolution.** Follow the code: any car entry advances mission 1 step
0. Do not restrict it to occupied-car thefts — that would make the
mission harder than specified and break D7's staging. The "steal" in
the title is flavour; the mechanic is "get in a car".

### 9.16 Mission 4 timer runs from mission start, wherever the player is (new)

**Ambiguity.** The briefing says "Ninety seconds, garage to the pier",
implying the run starts at the garage — but the code starts the 90 s
timer at `startMission` and only checks arrival at the pier (§3.12).
Mission 4 auto-starts 2.5 s after mission 3 completes, wherever the
player happens to be; there is no requirement to be at the garage, and
no teleport to it.

**Resolution.** Follow the code: the timer runs from mission start,
the only condition is reaching the pier (within 10 m) before it hits 0,
and failing restarts the same mission from the top. Do not add a
garage-start requirement or a teleport — either would change the
mission's difficulty and is not in the code. The "garage to the pier"
wording stays as briefing flavour.

### 9.17 Occupied-car steal adds +1 wanted only in the integrated game (new)

**Ambiguity.** Smoke B check B11 (steal an occupied traffic car)
asserts `carsStolen + 1` and `traffic 14 → 13` but asserts nothing
about wanted — because it ran against the B-only isolated copy, before
`police.js` existed and before `window.__wantedAdd` was installed.
`cars.js` `enterCar` calls `__wantedAdd(1, 'stolen car')` only if the
hook exists, so in the B-only copy the steal was heat-free.

**Resolution.** The integrated behaviour is the spec: stealing an
occupied car adds +1 wanted star (§3.8, §3.10). The rebuild's B-list
re-run must still pass B11 as written (counts only), and the +1 star
is additionally asserted by the integrated game, not by changing B11.
Do not "fix" B11 to assert wanted — the B list is a historical record
of what slice B verified; the star is covered by smoke C's wanted
checks and by §4.4.
