// Neon Bay — renderer, scene, camera, lights and sky. One job: own the
// WebGL renderer and the third-person orbit camera, and paint the frame the
// game state describes. The sun-soaked look lives here: warm directional sun
// with shadows, hemisphere fill, blue sky dome, haze fog, drifting clouds.

import * as THREE from 'three';
import { CAMERA, PALETTE } from './config.js';
import { makeSkyTexture } from './textures.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_WASTED = 'wasted';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.fog, 120, 900);

  // Sky dome: gradient texture on the inside of a big sphere, always centred
  // on the camera so the player can never reach its edge.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1200, 24, 16),
    new THREE.MeshBasicMaterial({
      map: makeSkyTexture(PALETTE.skyTop, PALETTE.skyBottom),
      side: THREE.BackSide,
      fog: false,
    }),
  );
  scene.add(sky);

  // Warm afternoon sun, the only shadow caster.
  const sun = new THREE.DirectionalLight(PALETTE.sun, PALETTE.sunIntensity);
  sun.position.set(180, 260, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  // Hemisphere fill: blue sky above, warm ground bounce below.
  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, PALETTE.hemiIntensity);
  scene.add(hemi);

  // A few soft clouds: flattened white blobs drifting slowly overhead.
  const clouds = [];
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const cloudGeo = new THREE.SphereGeometry(1, 10, 8);
  for (let i = 0; i < 9; i += 1) {
    const cloud = new THREE.Group();
    const puffs = 3 + (i % 3);
    for (let p = 0; p < puffs; p += 1) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.position.set(p * 14 - puffs * 7, (p % 2) * 3, (p % 3) * 6 - 6);
      puff.scale.set(16 + (p % 3) * 6, 5, 10);
      cloud.add(puff);
    }
    cloud.position.set(-500 + i * 130, 150 + (i % 3) * 25, -420 + ((i * 97) % 700));
    scene.add(cloud);
    clouds.push(cloud);
  }

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // Third-person orbit: camera sits behind and above the target at the
  // state's yaw/pitch/dist, always looking at the target's chest height.
  function updateCamera(target, camState, dt) {
    const yaw = camState.yaw;
    const pitch = camState.pitch;
    const dist = camState.dist;
    const cx = target.x + Math.sin(yaw) * Math.cos(pitch) * dist;
    const cz = target.z + Math.cos(yaw) * Math.cos(pitch) * dist;
    const cy = target.y + 1.6 + Math.sin(pitch) * dist;
    camera.position.set(cx, Math.max(cy, 0.6), cz);
    camera.lookAt(target.x, target.y + 1.6, target.z);
    // Keep the shadow frustum following the player so shadows stay crisp
    // wherever they walk in the city.
    sun.position.set(target.x + 180, 260, target.z + 120);
    sun.target.position.set(target.x, 0, target.z);
    sun.target.updateMatrixWorld();
    sky.position.set(camera.position.x, 0, camera.position.z);
  }

  function updateClouds(dt) {
    for (const cloud of clouds) {
      cloud.position.x += dt * 1.5;
      if (cloud.position.x > 700) cloud.position.x = -700;
    }
  }

  return {
    renderer,
    scene,
    camera,
    resize,
    updateCamera,
    updateClouds,
    draw(state) {
      updateClouds(1 / 60);
      renderer.render(scene, camera);
    },
  };
}
