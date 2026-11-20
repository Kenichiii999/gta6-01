// Neon Bay — missions. One job: the 5-mission story for Danny Cole and his
// fixer Vera "V" Marchetti, with objectives checked every frame, a 3D beacon
// over the current target, rewards, and an ending when the Bay Heist is done.
//
// All story, names and dialogue are original. No Rockstar content.
//
// The mission system only reads state fields that exist today (player
// position, cash, wanted, stats) plus its own runtime fields, so it never
// depends on the vehicles or police slices. Where driving or wanted heat is
// needed it reads state.player.car / state.wanted defensively (null-safe),
// and other slices can feed events in through window.__missionEvent.

import * as THREE from 'three';
import { saveGame } from './save.js';

// --- Helpers -----------------------------------------------------------------

function dist2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** Small guarded call into the HUD / audio hooks; never throws. */
function callHook(fn) {
  try {
    fn();
  } catch {
    // HUD/audio are optional at runtime: a missing hook must not break a mission.
  }
}

function sfx(name) {
  callHook(() => {
    if (typeof window.__sfx === 'function') window.__sfx(name);
  });
}

// --- Mission definitions ------------------------------------------------------
// marker positions are filled in by createMissions from city landmarks, so
// the defs stay data-only and seed-independent.

const DEFS = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    briefing: 'Vera: "No wheels, no work, Danny. Borrow a car and bring it to my garage."',
    objective: 'Steal any car, then drive it to Marchetti Garage.',
    reward: 500,
    steps: [
      { id: 'steal', text: 'Steal any car' },
      { id: 'garage', text: 'Drive to Marchetti Garage' },
    ],
  },
  {
    id: 'payday-pickup',
    title: 'Payday Pickup',
    briefing: 'Vera: "Three dead drops around the bay. Cash, no questions. Grab them all."',
    objective: 'Collect the 3 cash drops around Neon Bay.',
    reward: 800,
    steps: [
      { id: 'drops', text: 'Collect the cash drops (0/3)' },
    ],
  },
  {
    id: 'hot-pursuit',
    title: 'Hot Pursuit',
    briefing: 'Vera: "The cops need to know your name — then forget it. Get hot, then go cold."',
    objective: 'Reach 2 wanted stars, then lose all heat.',
    reward: 1200,
    steps: [
      { id: 'heat', text: 'Get to 2 wanted stars' },
      { id: 'cool', text: 'Lose the heat — back to 0 stars' },
    ],
  },
  {
    id: 'the-getaway',
    title: 'The Getaway',
    briefing: 'Vera: "Ninety seconds, garage to the pier. The tide waits for nobody, Danny."',
    objective: 'Drive from the garage to the pier in 90 seconds.',
    reward: 1500,
    timer: 90,
    steps: [
      { id: 'pier', text: 'Reach the pier before time runs out' },
    ],
  },
  {
    id: 'bay-heist',
    title: 'Bay Heist',
    briefing: 'Vera: "The big one. Neon Bay Bank, then vanish. This is the job that makes us legends."',
    objective: 'Crack the bank vault, then escape to the garage with heat on you.',
    reward: 3000,
    steps: [
      { id: 'bank', text: 'Get to Neon Bay Bank' },
      { id: 'vault', text: 'Crack the vault — hold position' },
      { id: 'escape', text: 'Escape to the garage with at least 1 wanted star' },
    ],
  },
];

const MISSION_COUNT = DEFS.length;

// Arrival points: landmark markers sit at building centres, and the player
// collides with the building, so "arriving" means reaching the doorstep in
// front of the building (open ground the player can actually stand on),
// not the exact centre (garage is 40 m wide, the bank 34 m).
const GARAGE_FRONT = new THREE.Vector3(0, 0, 18);
const BANK_FRONT = new THREE.Vector3(0, 0, 20);
const ARRIVE_DIST = 8;

function makeBeacon() {
  const group = new THREE.Group();
  const pillarMat = new THREE.MeshBasicMaterial({
    color: 0xffd23d,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 70, 16, 1, true), pillarMat);
  pillar.position.y = 35;
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.7),
    new THREE.MeshBasicMaterial({ color: 0xffd23d }),
  );
  diamond.position.y = 9;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 4.2, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd23d, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  group.add(pillar, diamond, ring);
  group.visible = false;
  group.userData = { pillar, diamond, ring, pillarMat };
  return group;
}

function makeDropMarker(pos) {
  const group = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 24, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x7dff9a, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  pillar.position.y = 12;
  const cash = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.5, 1.0),
    new THREE.MeshBasicMaterial({ color: 0x7dff9a }),
  );
  cash.position.y = 2.2;
  group.add(pillar, cash);
  group.position.set(pos.x, 0, pos.z);
  group.userData = { cash, pillar };
  return group;
}

// --- Mission system -----------------------------------------------------------

/**
 * Build the mission system: mission definitions with live landmark markers,
 * the 3D beacon, and the window.__missionEvent hook other slices can call
 * (e.g. __missionEvent('carStolen')). Stores the runtime on state._missions
 * and returns the api.
 */
export function createMissions(state, scene) {
  const lm = (state.city && state.city.landmarks) || {};
  const garagePos = lm.garage ? lm.garage.pos : new THREE.Vector3(-144, 0, -144);
  const bankPos = lm.bank ? lm.bank.pos : new THREE.Vector3(144, 0, 144);
  const towerPos = lm.tower ? lm.tower.pos : new THREE.Vector3(0, 0, 0);
  const hospitalPos = lm.hospital ? lm.hospital.pos : new THREE.Vector3(144, 0, -144);
  const policePos = lm.police ? lm.police.pos : new THREE.Vector3(-144, 0, 144);
  const half = (state.city && state.city.half) || 324;
  const pierPos = new THREE.Vector3(0, 0, half + 24);

  const defs = DEFS.map((def) => {
    const marker = (() => {
      switch (def.id) {
        case 'first-wheels': return garagePos.clone();
        case 'payday-pickup': return towerPos.clone();
        case 'hot-pursuit': return garagePos.clone();
        case 'the-getaway': return pierPos.clone();
        case 'bay-heist': return bankPos.clone();
        default: return garagePos.clone();
      }
    })();
    return { ...def, marker, steps: def.steps.map((s) => ({ ...s })) };
  });

  const beacon = makeBeacon();
  if (scene) scene.add(beacon);

  const sys = {
    defs,
    beacon,
    drops: [], // { pos: Vector3, mesh, taken } for Payday Pickup
    flags: { stolen: false },
    nextStartAt: 0, // state.time at which the next mission auto-starts
    garagePos: garagePos.clone(),
    bankPos: bankPos.clone(),
    garageFront: garagePos.clone().add(GARAGE_FRONT),
    bankFront: bankPos.clone().add(BANK_FRONT),
    pierPos: pierPos.clone(),
    // Cash drops sit just outside the landmark buildings (their centres are
    // inside the building footprint, where the player can never stand).
    dropSpots: [
      towerPos.clone().add(new THREE.Vector3(0, 0, 24)),
      hospitalPos.clone().add(new THREE.Vector3(0, 0, 24)),
      policePos.clone().add(new THREE.Vector3(0, 0, -24)),
    ],
    scene: scene || null,
  };
  state._missions = sys;

  // Event hook for other slices (vehicles, police, combat). Never throws,
  // never requires those slices to exist.
  window.__missionEvent = (type, payload) => {
    try {
      if (type === 'carStolen') {
        sys.flags.stolen = true;
        if (state.stats) state.stats.carsStolen = (state.stats.carsStolen || 0) + 1;
      } else if (type === 'cashPickup' && payload && typeof payload.index === 'number') {
        collectDrop(state, payload.index);
      }
    } catch {
      // Ignore hook errors: missions must not break gameplay.
    }
  };

  return sys;
}

function sysOf(state) {
  return state._missions || null;
}

function clearDrops(state) {
  const sys = sysOf(state);
  if (!sys) return;
  for (const drop of sys.drops) {
    if (sys.scene && drop.mesh) sys.scene.remove(drop.mesh);
  }
  sys.drops = [];
}

function spawnDrops(state) {
  const sys = sysOf(state);
  if (!sys || !sys.scene) return;
  clearDrops(state);
  sys.drops = sys.dropSpots.map((pos) => {
    const mesh = makeDropMarker(pos);
    sys.scene.add(mesh);
    return { pos: pos.clone(), mesh, taken: false };
  });
}

function collectDrop(state, index) {
  const sys = sysOf(state);
  const mission = state.mission;
  if (!sys || !mission || mission.id !== 'payday-pickup') return;
  const drop = sys.drops[index];
  if (!drop || drop.taken) return;
  drop.taken = true;
  if (sys.scene && drop.mesh) sys.scene.remove(drop.mesh);
  mission.collected = (mission.collected || 0) + 1;
  mission.progress = mission.collected / 3;
  mission.steps[0].text = `Collect the cash drops (${mission.collected}/3)`;
  mission.text = mission.steps[0].text;
  sfx('pickup');
  // Point the beacon at the next remaining drop.
  const next = sys.drops.find((d) => !d.taken);
  if (next) mission.marker.copy(next.pos);
}

/** Start mission `i` (0-based). Returns false when there is no such mission. */
export function startMission(state, i) {
  const sys = sysOf(state);
  if (!sys || i < 0 || i >= MISSION_COUNT) {
    state.mission = null;
    if (sys) sys.beacon.visible = false;
    return false;
  }
  const def = sys.defs[i];
  const mission = {
    id: def.id,
    title: def.title,
    briefing: def.briefing,
    objective: def.objective,
    marker: def.marker.clone(),
    steps: def.steps.map((s) => ({ ...s })),
    timer: def.timer || 0,
    reward: def.reward,
    stepIndex: 0,
    progress: 0,
    timerLeft: def.timer || 0,
    collected: 0,
    holdTime: 0,
    text: def.steps[0].text,
  };
  state.missionIndex = i;
  state.mission = mission;
  sys.beacon.visible = true;
  sys.beacon.position.set(mission.marker.x, 0, mission.marker.z);
  if (mission.id === 'payday-pickup') spawnDrops(state);
  else clearDrops(state);
  callHook(() => {
    if (state._hud && typeof state._hud.banner === 'function') {
      state._hud.banner(mission.title, mission.briefing, 5200);
    }
  });
  sfx('click');
  return true;
}

function advanceStep(state, mission) {
  mission.stepIndex += 1;
  mission.progress = mission.stepIndex / mission.steps.length;
  if (mission.stepIndex < mission.steps.length) {
    mission.text = mission.steps[mission.stepIndex].text;
    // Move the beacon to the next step's target.
    const sys = sysOf(state);
    if (sys) {
      if (mission.id === 'bay-heist' && mission.stepIndex === 2) {
        mission.marker.copy(sys.garagePos);
      }
      sys.beacon.position.set(mission.marker.x, 0, mission.marker.z);
    }
    sfx('click');
  }
}

function failMission(state, mission, reason) {
  callHook(() => {
    if (state._hud && typeof state._hud.banner === 'function') {
      state._hud.banner('MISSION FAILED', reason, 3600);
    }
  });
  sfx('fail');
  // Restart the same mission from the top.
  startMission(state, state.missionIndex);
}

function completeMission(state, mission) {
  const sys = sysOf(state);
  const reward = mission.reward || 0;
  state.cash = (state.cash || 0) + reward;
  if (state.stats) state.stats.missionsDone = (state.stats.missionsDone || 0) + 1;
  state.missionIndex = Math.min(state.missionIndex + 1, MISSION_COUNT);
  state.mission = null;
  clearDrops(state);
  if (sys) sys.beacon.visible = false;
  sfx('mission-complete');
  callHook(() => {
    if (state._hud && typeof state._hud.banner === 'function') {
      state._hud.banner('MISSION COMPLETE', `+$${reward.toLocaleString('en-US')} — ${mission.title}`, 4200);
    }
  });
  // Persist progress right away: a completed mission must survive a reload.
  callHook(() => saveGame(state));

  if (state.missionIndex >= MISSION_COUNT) {
    // All five done: the ending banner.
    state.gameComplete = true;
    callHook(() => {
      if (state._hud && typeof state._hud.banner === 'function') {
        state._hud.banner('NEON BAY LEGEND', 'You own this city.', 9000);
      }
    });
  } else if (sys) {
    // Brief breather, then the next briefing.
    sys.nextStartAt = state.time + 2.5;
  }
}

/** Per-frame mission logic. Call only while state.screen === 'play'. */
export function updateMissions(state, dt) {
  const sys = sysOf(state);
  if (!sys) return;

  // Auto-start the next mission after a completion breather.
  if (!state.mission && sys.nextStartAt > 0 && state.time >= sys.nextStartAt) {
    sys.nextStartAt = 0;
    if (state.missionIndex < MISSION_COUNT) startMission(state, state.missionIndex);
    return;
  }

  const mission = state.mission;
  if (!mission) return;

  // Beacon: spin the diamond, bob it, pulse the pillar; follow the marker.
  const beacon = sys.beacon;
  if (beacon.visible) {
    const { diamond, ring, pillarMat } = beacon.userData;
    diamond.rotation.y += dt * 1.6;
    diamond.position.y = 9 + Math.sin(state.time * 2.2) * 0.9;
    ring.scale.setScalar(1 + Math.sin(state.time * 2.2) * 0.12);
    pillarMat.opacity = 0.22 + Math.sin(state.time * 2.2) * 0.08;
    beacon.position.set(mission.marker.x, 0, mission.marker.z);
  }
  // Cash-drop markers spin gently.
  for (const drop of sys.drops) {
    if (drop.taken || !drop.mesh) continue;
    drop.mesh.userData.cash.rotation.y += dt * 2;
    drop.mesh.userData.cash.position.y = 2.2 + Math.sin(state.time * 3 + drop.pos.x) * 0.25;
  }

  const player = state.player;
  if (!player || !player.pos) return;
  const wanted = state.wanted || 0;

  switch (mission.id) {
    case 'first-wheels': {
      if (mission.stepIndex === 0) {
        const stolen = sys.flags.stolen
          || (state.stats && state.stats.carsStolen > 0)
          || !!player.car;
        if (stolen) advanceStep(state, mission);
      } else if (dist2D(player.pos, sys.garageFront) < ARRIVE_DIST) {
        completeMission(state, mission);
      }
      break;
    }
    case 'payday-pickup': {
      for (let i = 0; i < sys.drops.length; i += 1) {
        const drop = sys.drops[i];
        if (drop.taken) continue;
        if (dist2D(player.pos, drop.pos) < 4) collectDrop(state, i);
      }
      if ((mission.collected || 0) >= 3) completeMission(state, mission);
      break;
    }
    case 'hot-pursuit': {
      if (mission.stepIndex === 0) {
        if (wanted >= 2) advanceStep(state, mission);
      } else if (wanted <= 0) {
        completeMission(state, mission);
      }
      break;
    }
    case 'the-getaway': {
      mission.timerLeft = Math.max(0, (mission.timerLeft || 0) - dt);
      mission.text = `Reach the pier — ${Math.ceil(mission.timerLeft)}s left`;
      if (dist2D(player.pos, sys.pierPos) < 10) {
        completeMission(state, mission);
      } else if (mission.timerLeft <= 0) {
        failMission(state, mission, 'Out of time — Vera is not impressed.');
      }
      break;
    }
    case 'bay-heist': {
      if (mission.stepIndex === 0) {
        if (dist2D(player.pos, sys.bankFront) < ARRIVE_DIST) advanceStep(state, mission);
      } else if (mission.stepIndex === 1) {
        // Hold at the bank to crack the vault.
        if (dist2D(player.pos, sys.bankFront) < ARRIVE_DIST) {
          mission.holdTime = (mission.holdTime || 0) + dt;
          mission.progress = Math.min(1, mission.holdTime / 5);
          mission.text = `Cracking the vault… ${Math.ceil(5 - mission.holdTime)}s`;
          if (mission.holdTime >= 5) advanceStep(state, mission);
        } else {
          mission.holdTime = Math.max(0, (mission.holdTime || 0) - dt * 2);
          mission.text = 'Crack the vault — hold position at the bank';
        }
      } else if (dist2D(player.pos, sys.garageFront) < ARRIVE_DIST) {
        if (wanted >= 1) completeMission(state, mission);
        else {
          mission.text = 'Escape to the garage — you need heat on you (1+ star)';
        }
      }
      break;
    }
    default:
      break;
  }
}
