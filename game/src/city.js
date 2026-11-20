// The whole 9x9-block coastal city, built from a seeded RNG, plus the
// collision data (roads, buildings, landmarks) every later slice drives on
// and points at. South (+Z) is the beach and the ocean.
import * as THREE from 'three';
import { CITY, PALETTE } from './config.js';
import { randInt, randRange, randPick } from './random.js';
import { makeFacadeTexture, makeRoadTexture, makeSidewalkTexture, makeSandTexture } from './textures.js';

const HALF = CITY.half; // 324
const PITCH = CITY.pitch; // 72

// Landmark blocks (bx, bz), world pos, footprint, height, colour.
const LANDMARKS = [
  { key: 'tower', name: 'Neon Bay Tower', bx: 0, bz: 0, w: 34, d: 34, h: CITY.towerHeight, color: PALETTE.landmark.tower, kind: 'tower' },
  { key: 'garage', name: 'Marchetti Garage', bx: -2, bz: -2, w: 40, d: 26, h: 10, color: PALETTE.landmark.garage, kind: 'garage' },
  { key: 'hospital', name: 'Bay General Hospital', bx: 2, bz: -2, w: 34, d: 30, h: 16, color: PALETTE.landmark.hospital, kind: 'hospital' },
  { key: 'police', name: 'Neon Bay Police HQ', bx: -2, bz: 2, w: 34, d: 30, h: 16, color: PALETTE.landmark.police, kind: 'police' },
  { key: 'bank', name: 'Neon Bay Bank', bx: 2, bz: 2, w: 34, d: 30, h: 16, color: PALETTE.landmark.bank, kind: 'bank' },
];

// The 8 decorative traffic lights: [x, z, green?].
const TRAFFIC_LIGHTS = [
  [36, 36, true], [-36, 36, false], [36, -36, false], [-36, -36, true],
  [108, 36, true], [-108, -36, false], [36, 108, false], [-36, -108, true],
];

export function createCity(scene, rng) {
  const group = new THREE.Group();
  scene.add(group);

  const buildings = []; // collision data: { minX, maxX, minZ, maxZ, height, kind }
  const landmarks = {};
  const roads = [];
  const roadLines = [];
  for (let k = 0; k <= 10; k += 1) roadLines.push(-HALF + k * PITCH);
  for (const c of roadLines) {
    roads.push({ x1: -HALF, z1: c, x2: HALF, z2: c });
    roads.push({ x1: c, z1: -HALF, x2: c, z2: HALF });
  }

  const isOnRoad = (x, z) => {
    const m = CITY.road / 2 + 1; // 7
    for (const c of roadLines) {
      if (Math.abs(z - c) <= m || Math.abs(x - c) <= m) return true;
    }
    return false;
  };

  // 1. Ground: a 660x660 sidewalk-textured slab.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 12, HALF * 2 + 12),
    new THREE.MeshLambertMaterial({ map: makeSidewalkTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // 2. Roads: one plane per centreline, both directions.
  const roadTex = makeRoadTexture();
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
  for (const c of roadLines) {
    const ew = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 12, CITY.road), roadMat);
    ew.rotation.x = -Math.PI / 2;
    ew.position.set(0, 0.02, c);
    ew.receiveShadow = true;
    group.add(ew);
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(CITY.road, HALF * 2 + 12), roadMat);
    ns.rotation.x = -Math.PI / 2;
    ns.position.set(c, 0.02, 0);
    ns.receiveShadow = true;
    group.add(ns);
  }

  // 3. Beach + ocean + boardwalk along the south edge.
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 120, 64),
    new THREE.MeshLambertMaterial({ map: makeSandTexture() }),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(0, 0.01, HALF + 32);
  beach.receiveShadow = true;
  group.add(beach);
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 420),
    new THREE.MeshLambertMaterial({ color: PALETTE.ocean, transparent: true, opacity: 0.92 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, 0.05, HALF + 64 + 210);
  group.add(ocean);
  const boardwalk = new THREE.Mesh(
    new THREE.BoxGeometry(HALF * 2 + 120, 0.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x9a7a52 }),
  );
  boardwalk.position.set(0, 0.2, HALF + 3);
  boardwalk.receiveShadow = true;
  group.add(boardwalk);

  // 4. Facade materials: one per pastel colour, seeded window patterns.
  const facadeMats = PALETTE.facades.map((hex) => new THREE.MeshLambertMaterial({
    map: makeFacadeTexture(hex, rng, 6 + randInt(rng, 0, 6), 4 + randInt(rng, 0, 3)),
  }));
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x6b5a4a });
  const landmarkMats = {};
  for (const lm of LANDMARKS) {
    landmarkMats[lm.key] = new THREE.MeshLambertMaterial({
      map: makeFacadeTexture(lm.color, rng, 10, 8),
    });
  }

  // 5. Buildings. UVs are tiled so windows keep their proportions.
  function addBuilding(cx, cz, w, d, h, mat, kind) {
    const rx = Math.max(1, Math.round(w / 14));
    const ry = Math.max(1, Math.round(h / 22));
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getX(i) * rx, uv.getY(i) * ry);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6), roofMat);
    roof.position.set(cx, h + 0.25, cz);
    roof.castShadow = true;
    group.add(roof);
    buildings.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, height: h, kind });
    return mesh;
  }

  const landmarkByBlock = new Map(LANDMARKS.map((lm) => [`${lm.bx},${lm.bz}`, lm]));
  for (let bx = -4; bx <= 4; bx += 1) {
    for (let bz = -4; bz <= 4; bz += 1) {
      const cx = bx * PITCH;
      const cz = bz * PITCH;
      const lm = landmarkByBlock.get(`${bx},${bz}`);
      if (lm) {
        const h = lm.key === 'tower' ? lm.h : lm.h + (lm.key === 'garage' ? 0 : randInt(rng, 0, 10));
        const mesh = addBuilding(cx, cz, lm.w, lm.d, h, landmarkMats[lm.key], lm.kind);
        landmarks[lm.key] = { name: lm.name, pos: new THREE.Vector3(cx, 0, cz), mesh };
        if (lm.key === 'tower') {
          const beacon = new THREE.Mesh(
            new THREE.SphereGeometry(2.2, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0xff5a9a }),
          );
          beacon.position.set(cx, h + 3, cz);
          group.add(beacon);
        }
        continue;
      }
      // Ordinary block: 1-3 buildings on a shuffled subset of four slots.
      const slots = [[-15, -15], [15, -15], [-15, 15], [15, 15]];
      for (let i = slots.length - 1; i > 0; i -= 1) {
        const j = randInt(rng, 0, i);
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      const count = randInt(rng, 1, 3);
      for (let i = 0; i < count; i += 1) {
        const [sx, sz] = slots[i];
        const w = randRange(rng, 16, 24);
        const d = randRange(rng, 16, 24);
        const h = randRange(rng, CITY.minBuildingHeight, CITY.maxBuildingHeight);
        addBuilding(cx + sx, cz + sz, w, d, h, randPick(rng, facadeMats), 'building');
      }
    }
  }

  // 6. Props (visual only — no collision).
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 8);
  const lampHeadGeo = new THREE.SphereGeometry(0.35, 10, 8);
  function addLamp(x, z) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 3.5, z);
    group.add(pole);
    const head = new THREE.Mesh(lampHeadGeo, lampHeadMat);
    head.position.set(x, 7.1, z);
    group.add(head);
  }
  for (const c of roadLines) {
    for (let k = -3; k <= 3; k += 1) {
      const along = k * 72 + 36;
      if (rng() < 0.7) addLamp(c + 7.5, along);
      if (rng() < 0.5) addLamp(along, c + 7.5);
    }
  }

  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a38 });
  const palmTopMat = new THREE.MeshLambertMaterial({ color: 0x2f8f4e });
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.45, 7, 8);
  const palmTopGeo = new THREE.ConeGeometry(2.6, 3.2, 8);
  function addPalm(x, z) {
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 3.5, z);
    trunk.castShadow = true;
    group.add(trunk);
    const top = new THREE.Mesh(palmTopGeo, palmTopMat);
    top.position.set(x, 8.2, z);
    top.castShadow = true;
    group.add(top);
  }
  for (let x = -HALF; x <= HALF; x += 36) {
    addPalm(x + randRange(rng, -6, 6), HALF + 18 + randRange(rng, -4, 4));
  }

  const benchMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
  const hydrantMat = new THREE.MeshLambertMaterial({ color: 0xc94f4f });
  for (let i = 0; i < 26; i += 1) {
    const bx = randInt(rng, -4, 4) * PITCH + randRange(rng, -26, 26);
    const bz = randInt(rng, -4, 4) * PITCH + randRange(rng, -26, 26);
    addPalm(bx, bz);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.8), benchMat);
    bench.position.set(bx, 0.5, bz + 28);
    bench.rotation.y = randRange(rng, 0, Math.PI);
    bench.castShadow = true;
    group.add(bench);
    const hydrant = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 1.1, 8), hydrantMat);
    hydrant.position.set(bx + 3, 0.55, bz);
    hydrant.castShadow = true;
    group.add(hydrant);
  }

  // 8 decorative traffic lights (traffic never stops at them).
  const tlPoleGeo = new THREE.CylinderGeometry(0.12, 0.16, 6, 8);
  const tlBoxGeo = new THREE.BoxGeometry(0.7, 1.6, 0.7);
  const tlRedMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const tlGreenMat = new THREE.MeshBasicMaterial({ color: 0x2aff66 });
  for (const [x, z, green] of TRAFFIC_LIGHTS) {
    const pole = new THREE.Mesh(tlPoleGeo, poleMat);
    pole.position.set(x, 3, z);
    group.add(pole);
    const box = new THREE.Mesh(tlBoxGeo, green ? tlGreenMat : tlRedMat);
    box.position.set(x, 6.2, z);
    group.add(box);
  }

  return { group, roads, buildings, landmarks, blocks: CITY.blocks, half: HALF, roadLines, isOnRoad };
}
