// The WebGL renderer and the third-person orbit camera. The sun-soaked look
// lives here: a warm directional sun with shadows that follows the player,
// hemisphere fill, a blue sky dome, haze fog, and drifting clouds.
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

  // Sky dome: a huge sphere that re-centres on the camera every frame, so
  // the player can never reach its edge.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1200, 24, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(PALETTE.skyTop, PALETTE.skyBottom), side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);

  // Sun: warm directional light with shadows. It follows the player so the
  // shadow camera stays crisp anywhere in the city.
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

  scene.add(new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, PALETTE.hemiIntensity));

  // Clouds: 9 groups of 3-5 flattened white spheres, drifting east.
  const cloudGroups = [];
  const puffGeo = new THREE.SphereGeometry(1, 10, 8);
  const puffMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 9; i += 1) {
    const group = new THREE.Group();
    const puffs = 3 + (i % 3);
    for (let p = 0; p < puffs; p += 1) {
      const puff = new THREE.Mesh(puffGeo, puffMat);
      puff.scale.set(16 + (p % 3) * 6, 5, 10);
      puff.position.set(p * 14 - puffs * 7, (p % 2) * 3, (p % 3) * 6 - 6);
      group.add(puff);
    }
    group.position.set(-500 + i * 130, 150 + (i % 3) * 25, -420 + ((i * 97) % 700));
    scene.add(group);
    cloudGroups.push(group);
  }

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  function updateClouds(dt) {
    for (const group of cloudGroups) {
      group.position.x += dt * 1.5;
      if (group.position.x > 700) group.position.x = -700;
    }
  }

  // Third-person orbit: the camera sits behind/above the target at the
  // state's yaw/pitch/dist and looks at the target's head height. `shake`
  // (optional, metres of camera shake, decaying — set by police rams and
  // punches via state.shakeTime) jitters the look target, never the player.
  function updateCamera(target, camState, dt, shake = 0) {
    const yaw = camState.yaw;
    const pitch = camState.pitch;
    const dist = camState.dist;
    const cx = target.x + Math.sin(yaw) * Math.cos(pitch) * dist;
    const cz = target.z + Math.cos(yaw) * Math.cos(pitch) * dist;
    const cy = Math.max(0.6, target.y + 1.6 + Math.sin(pitch) * dist);
    camera.position.set(cx, cy, cz);
    let lookX = target.x;
    let lookY = target.y + 1.6;
    let lookZ = target.z;
    if (shake > 0) {
      const amp = 0.15 * shake;
      lookX += (Math.random() - 0.5) * 2 * amp;
      lookY += (Math.random() - 0.5) * 2 * amp;
      lookZ += (Math.random() - 0.5) * 2 * amp;
    }
    camera.lookAt(lookX, lookY, lookZ);
    // The sun and the sky follow the player.
    sun.position.set(target.x + 180, target.y + 260, target.z + 120);
    sun.target.position.copy(target);
    sky.position.set(camera.position.x, 0, camera.position.z);
  }

  // Paint one frame: drift the clouds, then render the scene.
  function draw(state) {
    updateClouds(1 / 60);
    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, resize, updateCamera, updateClouds, draw };
}
