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

