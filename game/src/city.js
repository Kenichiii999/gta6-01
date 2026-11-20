// Neon Bay — city generation. One job: build the whole 9x9-block coastal
// city from a seeded RNG and expose its data (roads, buildings, landmarks)
// so later slices (traffic, police, missions) can drive on it and point at it.
//
// Layout: block 60 m, road 12 m, pitch 72 m. Block centres sit at
// (bx * 72, bz * 72) for bx, bz in -4..4; road centrelines sit halfway
// between blocks and around the outer edge. South (+Z) is the beach and
// the ocean. Landmarks take whole blocks: Neon Bay Tower at the centre,
// garage (mission hub) north-west, hospital north-east, police south-west,
// bank south-east.

import * as THREE from 'three';
import { CITY, PALETTE } from './config.js';
import { randInt, randPick, randRange } from './random.js';
import { makeFacadeTexture, makeRoadTexture, makeSandTexture, makeSidewalkTexture } from './textures.js';

const HALF = CITY.half; // 324 m
const PITCH = CITY.pitch; // 72 m

// Landmark blocks, in block coordinates (bx, bz).
const LANDMARKS = {
  tower: { bx: 0, bz: 0, name: 'Neon Bay Tower' },
  garage: { bx: -2, bz: -2, name: 'Marchetti Garage' },
  hospital: { bx: 2, bz: -2, name: 'Bay General Hospital' },
  police: { bx: -2, bz: 2, name: 'Neon Bay Police HQ' },
  bank: { bx: 2, bz: 2, name: 'Neon Bay Bank' },
};

function landmarkAt(bx, bz) {
  for (const [key, lm] of Object.entries(LANDMARKS)) {
    if (lm.bx === bx && lm.bz === bz) return key;
  }
  return null;
}

export function createCity(scene, rng) {
  const buildings = []; // { minX, maxX, minZ, maxZ, height, kind }
  const roads = []; // road centreline segments { x1, z1, x2, z2 }
  const landmarks = {};
  const group = new THREE.Group();
  scene.add(group);

  const roadTex = makeRoadTexture();
  const sidewalkTex = makeSidewalkTexture();
  const sandTex = makeSandTexture();

  // --- Ground ----------------------------------------------------------------
  // Base slab under the whole city (sidewalk colour; roads are drawn over it).
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 12, HALF * 2 + 12),
    new THREE.MeshLambertMaterial({ map: sidewalkTex }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.set(0, 0, 0);
  base.receiveShadow = true;
  group.add(base);

  // Road centrelines: 10 lines each way, at -324, -252, ..., 324.
  const lines = [];
  for (let k = 0; k <= CITY.blocks; k += 1) lines.push(-HALF + k * PITCH);

  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
  for (const c of lines) {
    // Road running east-west (along X) at z = c.
    const ew = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 12, CITY.road), roadMat);
    ew.rotation.x = -Math.PI / 2;
    ew.rotation.z = Math.PI / 2;
    ew.position.set(0, 0.02, c);
    ew.receiveShadow = true;
    group.add(ew);
    // Road running north-south (along Z) at x = c.
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 12, CITY.road), roadMat);
    ns.rotation.x = -Math.PI / 2;
    ns.position.set(c, 0.02, 0);
    ns.receiveShadow = true;
    group.add(ns);
    roads.push({ x1: -HALF, z1: c, x2: HALF, z2: c });
    roads.push({ x1: c, z1: -HALF, x2: c, z2: HALF });
  }

  // --- Beach + ocean (south edge, +Z) ---------------------------------------
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 120, 64),
    new THREE.MeshLambertMaterial({ map: sandTex }),
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

  // A low boardwalk strip where the sand meets the city.
  const boardwalk = new THREE.Mesh(
    new THREE.BoxGeometry(HALF * 2 + 120, 0.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x9a7a52 }),
  );
  boardwalk.position.set(0, 0.2, HALF + 3);
  boardwalk.receiveShadow = true;
  group.add(boardwalk);

  // --- Facade textures (one per pastel colour, shared by all buildings) -----
  const facadeMats = PALETTE.facades.map((hex) =>
    new THREE.MeshLambertMaterial({ map: makeFacadeTexture(hex, rng, 6 + randInt(rng, 0, 6), 4 + randInt(rng, 0, 3)) }),
  );
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x6b5a4a });
  const landmarkMats = {};
  for (const [key, hex] of Object.entries(PALETTE.landmark)) {
    landmarkMats[key] = new THREE.MeshLambertMaterial({ map: makeFacadeTexture(hex, rng, 10, 8) });
  }

  // --- Buildings ---------------------------------------------------------------
  function addBuilding(cx, cz, w, d, h, mat, kind) {
    // Tile the facade texture so windows keep their proportions no matter
    // how wide or tall the building is: scale the box UVs by the face size
    // (one texture tile per ~14 m wide, ~22 m tall). The texture is shared,
    // only the per-building geometry UVs change.
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    const rx = Math.max(1, Math.round(w / 14));
    const ry = Math.max(1, Math.round(h / 22));
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * rx, uv.getY(i) * ry);
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

  for (let bz = -4; bz <= 4; bz += 1) {
    for (let bx = -4; bx <= 4; bx += 1) {
      const cx = bx * PITCH;
      const cz = bz * PITCH;
      const lmKey = landmarkAt(bx, bz);
      if (lmKey === 'tower') {
        const tower = addBuilding(cx, cz, 34, 34, CITY.towerHeight, landmarkMats.tower, 'tower');
        // Glowing beacon on top of the tower.
        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(2.2, 12, 10),
          new THREE.MeshBasicMaterial({ color: 0xff5a7a }),
        );
        beacon.position.set(cx, CITY.towerHeight + 3, cz);
        group.add(beacon);
        landmarks.tower = { name: LANDMARKS.tower.name, pos: new THREE.Vector3(cx, 0, cz), mesh: tower };
        continue;
      }
      if (lmKey) {
        const lm = LANDMARKS[lmKey];
        const w = lmKey === 'garage' ? 40 : 34;
        const d = lmKey === 'garage' ? 26 : 30;
        const h = lmKey === 'garage' ? 10 : 16 + randInt(rng, 0, 10);
        const mesh = addBuilding(cx, cz, w, d, h, landmarkMats[lmKey], lmKey);
        landmarks[lmKey] = { name: lm.name, pos: new THREE.Vector3(cx, 0, cz), mesh };
        continue;
      }
      // Ordinary block: 1-3 buildings placed on a jittered sub-grid.
      const count = randInt(rng, 1, 3);
      const slots = [
        [-15, -15], [15, -15], [-15, 15], [15, 15],
      ];
      // Shuffle the slots with the seeded stream.
      for (let i = slots.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      for (let i = 0; i < count; i += 1) {
        const [ox, oz] = slots[i];
        const w = randRange(rng, 16, 24);
        const d = randRange(rng, 16, 24);
        const h = randRange(rng, CITY.minBuildingHeight, CITY.maxBuildingHeight);
        addBuilding(cx + ox, cz + oz, w, d, h, randPick(rng, facadeMats), 'building');
      }
    }
  }

  // --- Props -------------------------------------------------------------------
  const lampPoleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
  const lampPoleMat = new THREE.MeshLambertMaterial({ color: 0x2a2f36 });
  const lampHeadGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const palmTrunkGeo = new THREE.CylinderGeometry(0.25, 0.45, 7, 6);
  const palmTrunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a38 });
  const palmTopGeo = new THREE.ConeGeometry(2.6, 3.2, 7);
  const palmTopMat = new THREE.MeshLambertMaterial({ color: 0x2f8f4e });
  const benchGeo = new THREE.BoxGeometry(2.2, 0.5, 0.8);
  const benchMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
  const hydrantGeo = new THREE.CylinderGeometry(0.35, 0.4, 1.1, 8);
  const hydrantMat = new THREE.MeshLambertMaterial({ color: 0xc94f4f });
  const lightPoleGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 6);
  const lightPoleMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const lightBoxGeo = new THREE.BoxGeometry(0.7, 1.6, 0.7);
  const lightRedMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const lightGreenMat = new THREE.MeshBasicMaterial({ color: 0x2aff66 });

  function addLamp(x, z) {
    const pole = new THREE.Mesh(lampPoleGeo, lampPoleMat);
    pole.position.set(x, 3.5, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(lampHeadGeo, lampHeadMat);
    head.position.set(x, 7.1, z);
    group.add(head);
  }

  function addPalm(x, z) {
    const trunk = new THREE.Mesh(palmTrunkGeo, palmTrunkMat);
    trunk.position.set(x, 3.5, z);
    trunk.castShadow = true;
    group.add(trunk);
    const top = new THREE.Mesh(palmTopGeo, palmTopMat);
    top.position.set(x, 8.2, z);
    top.castShadow = true;
    group.add(top);
  }

  function addBench(x, z, rotY) {
    const bench = new THREE.Mesh(benchGeo, benchMat);
    bench.position.set(x, 0.5, z);
    bench.rotation.y = rotY;
    bench.castShadow = true;
    group.add(bench);
  }

  function addHydrant(x, z) {
    const hydrant = new THREE.Mesh(hydrantGeo, hydrantMat);
    hydrant.position.set(x, 0.55, z);
    hydrant.castShadow = true;
    group.add(hydrant);
  }

  function addTrafficLight(x, z, green) {
    const pole = new THREE.Mesh(lightPoleGeo, lightPoleMat);
    pole.position.set(x, 3, z);
    pole.castShadow = true;
    group.add(pole);
    const box = new THREE.Mesh(lightBoxGeo, green ? lightGreenMat : lightRedMat);
    box.position.set(x, 6.2, z);
    group.add(box);
  }

  // Street lamps at road corners, palms along the beach and a few blocks,
  // benches and hydrants scattered on sidewalks, traffic lights at the
  // intersections nearest the centre.
  for (const c of lines) {
    for (let k = -3; k <= 3; k += 1) {
      const along = k * 72 + 36;
      if (rng() < 0.7) addLamp(c + 7.5, along);
      if (rng() < 0.5) addLamp(along, c + 7.5);
    }
  }
  for (let x = -HALF; x <= HALF; x += 36) {
    addPalm(x + randRange(rng, -6, 6), HALF + 18 + randRange(rng, -4, 4));
  }
  for (let i = 0; i < 26; i += 1) {
    const bx = randInt(rng, -4, 4) * PITCH;
    const bz = randInt(rng, -4, 4) * PITCH;
    addPalm(bx + randRange(rng, -26, 26), bz + randRange(rng, -26, 26));
    addBench(bx + randRange(rng, -26, 26), bz + 28, rng() * Math.PI);
    addHydrant(bx + randRange(rng, -26, 26), bz + randRange(rng, -26, 26));
  }
  for (const [x, z, green] of [
    [36, 36, true], [-36, 36, false], [36, -36, false], [-36, -36, true],
    [108, 36, true], [-108, -36, false], [36, 108, false], [-36, -108, true],
  ]) {
    addTrafficLight(x, z, green);
  }

  return {
    group,
    roads,
    buildings,
    landmarks,
    blocks: CITY.blocks,
    half: HALF,
    // Road centreline coordinates (one per line, each way).
    roadLines: lines,
    /** True when point (x, z) is on a road (within the road half-width). */
    isOnRoad(x, z) {
      for (const c of lines) {
        if (Math.abs(x - c) <= CITY.road / 2 + 1 || Math.abs(z - c) <= CITY.road / 2 + 1) return true;
      }
      return false;
    },
  };
}
