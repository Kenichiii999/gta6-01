// The 5-mission story for Danny Cole and his fixer Vera "V" Marchetti,
// with objectives checked every frame, a 3D beacon over the current
// target, rewards, and an ending when the Bay Heist is done. All story,
// names and dialogue are original.
import * as THREE from 'three';
import { saveGame } from './save.js';

// Arrival means reaching the doorstep in front of a landmark building,
// not its exact centre (the player collides with the building itself).
const GARAGE_FRONT = { x: 0, z: 18 };
const BANK_FRONT = { x: 0, z: 20 };
const ARRIVE_DIST = 8;
const DROP_DIST = 4;
const PIER_DIST = 10;
const VAULT_HOLD_SECONDS = 5;
const NEXT_MISSION_DELAY = 2.5;

// Mission definitions (data only; marker positions are filled in by
// createMissions from the city landmarks, so the defs stay
// seed-independent).
const MISSION_DEFS = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    briefing: 'No wheels, no work, Danny. Borrow a car and bring it to my garage.',
    objective: 'Steal any car, then drive it to Marchetti Garage.',
    reward: 500,
    timer: 0,
    steps: [
      { id: 'steal', text: 'Steal a car — any car will do' },
      { id: 'garage', text: 'Drive it to Marchetti Garage' },
    ],
  },
  {
    id: 'payday-pickup',
    title: 'Payday Pickup',
    briefing: 'Three dead drops around the bay. Cash, no questions. Grab them all.',
    objective: 'Collect the 3 cash drops around Neon Bay.',
    reward: 800,
    timer: 0,
    steps: [
      { id: 'drops', text: 'Collect the cash drops (0/3)' },
    ],
  },
  {
    id: 'hot-pursuit',
    title: 'Hot Pursuit',
    briefing: 'The cops need to know your name — then forget it. Get hot, then go cold.',
    objective: 'Reach 2 wanted stars, then lose all heat.',
    reward: 1200,
    timer: 0,
    steps: [
      { id: 'heat', text: 'Get the cops hot — reach 2 wanted stars' },
      { id: 'cool', text: 'Lose the heat — get back to 0 stars' },
    ],
  },
  {
    id: 'the-getaway',
    title: 'The Getaway',
    briefing: 'Ninety seconds, garage to the pier. The tide waits for nobody, Danny.',
    objective: 'Drive from the garage to the pier in 90 seconds.',
    reward: 1500,
    timer: 90,
    steps: [
      { id: 'pier', text: 'Reach the pier — 90s left' },
    ],
  },
  {
    id: 'bay-heist',
    title: 'Bay Heist',
    briefing: 'The big one. Neon Bay Bank, then vanish. This is the job that makes us legends.',
    objective: 'Crack the bank vault, then escape to the garage with heat on you.',
    reward: 3000,
    timer: 0,
    steps: [
      { id: 'bank', text: 'Get to Neon Bay Bank' },
      { id: 'vault', text: 'Crack the vault — hold position at the bank' },
      { id: 'escape', text: 'Escape to the garage — you need heat on you (1+ star)' },
    ],
  },
];

function sfx(name) {
  try {
    if (typeof window.__sfx === 'function') window.__sfx(name);
  } catch { /* a missing audio slice must never break a mission */ }
}

function banner(state, title, sub, ms) {
  try {
    if (state._hud && typeof state._hud.banner === 'function') state._hud.banner(title, sub, ms);
  } catch { /* HUD missing: the mission still runs */ }
}

function makeBeacon() {
  const group = new THREE.Group();
  const pillarMat = new THREE.MeshBasicMaterial({
    color: 0xffd23d, transparent: true, opacity: 0.28,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 70, 12, 1, true), pillarMat);
  pillar.position.y = 35;
  group.add(pillar);
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.7),
    new THREE.MeshBasicMaterial({ color: 0xffd23d }),
  );
  diamond.position.y = 9;
  group.add(diamond);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 4.2, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd23d, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  group.add(ring);
  group.visible = false;
  group.userData = { pillar, pillarMat, diamond, ring };
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
  group.add(pillar);
  const cash = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.5, 1.0),
    new THREE.MeshBasicMaterial({ color: 0x7dff9a }),
  );
  cash.position.y = 2.2;
  group.add(cash);
  group.position.set(pos.x, 0, pos.z);
  group.userData = { cash };
  return group;
}

function dist2D(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

// Marker position for a mission id (filled in from landmarks at build time).
function markerFor(sys, id) {
  switch (id) {
    case 'first-wheels': return { x: sys.garagePos.x, z: sys.garagePos.z };
    case 'payday-pickup': {
      const next = sys.drops.find((d) => !d.taken);
      return next ? { x: next.pos.x, z: next.pos.z } : { x: sys.garagePos.x, z: sys.garagePos.z };
    }
    case 'hot-pursuit': return { x: sys.garagePos.x, z: sys.garagePos.z };
    case 'the-getaway': return { x: sys.pierPos.x, z: sys.pierPos.z };
    case 'bay-heist': return { x: sys.bankPos.x, z: sys.bankPos.z };
    default: return { x: sys.garagePos.x, z: sys.garagePos.z };
  }
}

export function createMissions(state, scene) {
  const landmarks = (state.city && state.city.landmarks) || {};
  const garagePos = landmarks.garage
    ? { x: landmarks.garage.pos.x, z: landmarks.garage.pos.z }
    : { x: -144, z: -144 };
  const bankPos = landmarks.bank
    ? { x: landmarks.bank.pos.x, z: landmarks.bank.pos.z }
    : { x: 144, z: 144 };
  const towerPos = landmarks.tower
    ? { x: landmarks.tower.pos.x, z: landmarks.tower.pos.z }
    : { x: 0, z: 0 };
  const hospitalPos = landmarks.hospital
    ? { x: landmarks.hospital.pos.x, z: landmarks.hospital.pos.z }
    : { x: 144, z: -144 };
  const policePos = landmarks.police
    ? { x: landmarks.police.pos.x, z: landmarks.police.pos.z }
    : { x: -144, z: 144 };
  const half = (state.city && state.city.half) || 324;

  const beacon = makeBeacon();
  scene.add(beacon);

  const sys = {
    defs: MISSION_DEFS,
    beacon,
    drops: [],
    flags: { stolen: false },
    nextStartAt: 0,
    garagePos,
    bankPos,
    garageFront: { x: garagePos.x + GARAGE_FRONT.x, z: garagePos.z + GARAGE_FRONT.z },
    bankFront: { x: bankPos.x + BANK_FRONT.x, z: bankPos.z + BANK_FRONT.z },
    pierPos: { x: 0, z: half + 24 },
    // Cash-drop spots sit just outside the landmark buildings, since
    // their centres are inside the footprint.
    dropSpots: [
      { x: towerPos.x, z: towerPos.z + 24 },
      { x: hospitalPos.x, z: hospitalPos.z + 24 },
      { x: policePos.x, z: policePos.z - 24 },
    ],
    scene,
  };

  state._missions = sys;

  // Cross-slice hook: cars.js calls __missionEvent('carStolen') when an
  // occupied car is stolen. cars.js already increments stats.carsStolen,
  // so this hook only sets the mission flag — it must NOT increment the
  // counter again (that would double-count the steal).
  window.__missionEvent = (type, payload) => {
    try {
      if (type === 'carStolen') {
        sys.flags.stolen = true;
      } else if (type === 'cashPickup' && payload && typeof payload.index === 'number') {
        collectDrop(state, payload.index);
      }
    } catch { /* never throw for a caller */ }
  };

  return sys;
}

function spawnDrops(state) {
  const sys = state._missions;
  clearDrops(state);
  sys.drops = sys.dropSpots.map((spot) => {
    const pos = new THREE.Vector3(spot.x, 0, spot.z);
    const mesh = makeDropMarker(pos);
    sys.scene.add(mesh);
    return { pos, mesh, taken: false };
  });
}

function clearDrops(state) {
  const sys = state._missions;
  if (!sys) return;
  for (const drop of sys.drops) {
    if (drop.mesh) sys.scene.remove(drop.mesh);
  }
  sys.drops = [];
}

export function collectDrop(state, index) {
  const sys = state._missions;
  const mission = state.mission;
  if (!sys || !mission || mission.id !== 'payday-pickup') return;
  const drop = sys.drops[index];
  if (!drop || drop.taken) return;
  drop.taken = true;
  if (drop.mesh) sys.scene.remove(drop.mesh);
  mission.collected += 1;
  mission.progress = mission.collected / 3;
  mission.text = `Collect the cash drops (${mission.collected}/3)`;
  sfx('pickup');
  // Beacon moves to the next remaining drop.
  const next = sys.drops.find((d) => !d.taken);
  if (next) {
    mission.marker.x = next.pos.x;
    mission.marker.z = next.pos.z;
  }
  if (mission.collected >= 3) completeMission(state);
}

export function startMission(state, i) {
  const sys = state._missions;
  if (!sys || i < 0 || i >= sys.defs.length) {
    if (sys) sys.beacon.visible = false;
    state.mission = null;
    return false;
  }
  const def = sys.defs[i];
  if (i === 0) sys.flags.stolen = false;
  const mission = {
    id: def.id,
    title: def.title,
    briefing: def.briefing,
    objective: def.objective,
    marker: markerFor(sys, def.id),
    steps: def.steps.map((s) => ({ ...s })),
    timer: def.timer,
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
  if (def.id === 'payday-pickup') {
    spawnDrops(state);
    // Marker points at the first drop once the drops exist.
    const first = sys.drops.find((d) => !d.taken);
    if (first) {
      mission.marker.x = first.pos.x;
      mission.marker.z = first.pos.z;
    }
  } else {
    clearDrops(state);
  }
  sys.beacon.position.set(mission.marker.x, 0, mission.marker.z);
  sys.beacon.visible = true;
  banner(state, def.title, def.briefing, 5200);
  sfx('click');
  return true;
}

function advanceStep(state) {
  const mission = state.mission;
  if (!mission) return;
  mission.stepIndex += 1;
  mission.progress = mission.stepIndex / mission.steps.length;
  if (mission.steps[mission.stepIndex]) mission.text = mission.steps[mission.stepIndex].text;
  // Bay Heist escape step: the marker moves to the garage.
  if (mission.id === 'bay-heist' && mission.stepIndex === 2) {
    const sys = state._missions;
    mission.marker.x = sys.garagePos.x;
    mission.marker.z = sys.garagePos.z;
  }
  sfx('click');
}

function completeMission(state) {
  const sys = state._missions;
  const mission = state.mission;
  if (!mission) return;
  const reward = mission.reward;
  const title = mission.title;
  state.cash += reward;
  state.stats.missionsDone += 1;
  state.missionIndex = Math.min(state.missionIndex + 1, 5);
  state.mission = null;
  clearDrops(state);
  if (sys) sys.beacon.visible = false;
  sfx('mission-complete');
  banner(state, 'MISSION COMPLETE', `+$${reward.toLocaleString('en-US')} — ${title}`, 4200);
  // Save immediately so a completed mission survives a reload.
  try { saveGame(state); } catch { /* storage can be off */ }
  if (state.missionIndex >= 5) {
    state.gameComplete = true;
    banner(state, 'NEON BAY LEGEND', 'You own this city.', 9000);
  } else {
    sys.nextStartAt = state.time + NEXT_MISSION_DELAY;
  }
}

function failMission(state) {
  const mission = state.mission;
  if (!mission) return;
  const index = state.missionIndex;
  sfx('fail');
  banner(state, 'MISSION FAILED', 'Out of time — Vera is not impressed.', 4200);
  // Restart the same mission from the top.
  startMission(state, index);
}

export function updateMissions(state, dt) {
  const sys = state._missions;
  if (!sys) return;
  if (state.screen !== 'play') return;

  // Auto-start: a completed mission schedules the next one 2.5 s later.
  if (!state.mission && sys.nextStartAt > 0 && state.time >= sys.nextStartAt) {
    sys.nextStartAt = 0;
    if (state.missionIndex < 5) startMission(state, state.missionIndex);
    return;
  }

  const mission = state.mission;
  if (!mission) return;

  // Beacon animation while visible.
  if (sys.beacon.visible) {
    const { pillarMat, diamond, ring } = sys.beacon.userData;
    diamond.rotation.y += dt * 1.6;
    diamond.position.y = 9 + Math.sin(state.time * 2.2) * 0.9;
    const ringScale = 1 + Math.sin(state.time * 2.2) * 0.12;
    ring.scale.set(ringScale, ringScale, 1);
    pillarMat.opacity = 0.22 + Math.sin(state.time * 2.2) * 0.08;
    sys.beacon.position.set(mission.marker.x, 0, mission.marker.z);
  }

  // Drop markers spin and bob.
  for (const drop of sys.drops) {
    if (drop.taken || !drop.mesh) continue;
    drop.mesh.userData.cash.rotation.y += dt * 2;
    drop.mesh.userData.cash.position.y = 2.2 + Math.sin(state.time * 3 + drop.pos.x) * 0.25;
  }

  const px = state.player.pos.x;
  const pz = state.player.pos.z;

  switch (mission.id) {
    case 'first-wheels': {
      if (mission.stepIndex === 0) {
        // The steal only counts while the player is actually sitting
        // in a car at check time: a transient enter/exit flicker
        // inside one frame must not flip the step while the player
        // ends up on foot. (enterCar sets the stolen counter and the
        // stolen flag in the same call that puts the player in the
        // car, so "in a car" subsumes both.)
        if (state.player.car) {
          advanceStep(state);
        }
      } else if (dist2D(px, pz, sys.garageFront.x, sys.garageFront.z) <= ARRIVE_DIST) {
        completeMission(state);
      }
      break;
    }
    case 'payday-pickup': {
      for (let i = 0; i < sys.drops.length; i += 1) {
        const drop = sys.drops[i];
        if (!drop.taken && dist2D(px, pz, drop.pos.x, drop.pos.z) <= DROP_DIST) {
          collectDrop(state, i);
          if (!state.mission) return; // completed on the third drop
        }
      }
      break;
    }
    case 'hot-pursuit': {
      if (mission.stepIndex === 0) {
        if (state.wanted >= 2) advanceStep(state);
      } else if (state.wanted <= 0) {
        completeMission(state);
      }
      break;
    }
    case 'the-getaway': {
      // The 90 s timer runs from mission start, wherever the player is.
      mission.timerLeft -= dt;
      mission.text = `Reach the pier — ${Math.max(0, Math.ceil(mission.timerLeft))}s left`;
      if (dist2D(px, pz, sys.pierPos.x, sys.pierPos.z) <= PIER_DIST) {
        completeMission(state);
      } else if (mission.timerLeft <= 0) {
        failMission(state);
      }
      break;
    }
    case 'bay-heist': {
      if (mission.stepIndex === 0) {
        if (dist2D(px, pz, sys.bankFront.x, sys.bankFront.z) <= ARRIVE_DIST) advanceStep(state);
      } else if (mission.stepIndex === 1) {
        if (dist2D(px, pz, sys.bankFront.x, sys.bankFront.z) <= ARRIVE_DIST) {
          mission.holdTime += dt;
          mission.progress = Math.min(1, mission.holdTime / VAULT_HOLD_SECONDS);
          mission.text = `Cracking the vault… ${Math.max(0, Math.ceil(VAULT_HOLD_SECONDS - mission.holdTime))}s`;
          if (mission.holdTime >= VAULT_HOLD_SECONDS) advanceStep(state);
        } else {
          mission.holdTime = Math.max(0, mission.holdTime - 2 * dt);
          mission.progress = Math.min(1, mission.holdTime / VAULT_HOLD_SECONDS);
          mission.text = 'Crack the vault — hold position at the bank';
        }
      } else if (dist2D(px, pz, sys.garageFront.x, sys.garageFront.z) <= ARRIVE_DIST) {
        // Escape only counts with heat on the player.
        if (state.wanted >= 1) completeMission(state);
        else mission.text = 'Escape to the garage — you need heat on you (1+ star)';
      }
      break;
    }
    default:
      break;
  }
}
