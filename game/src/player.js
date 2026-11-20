// Danny Cole, on foot: a low-poly humanoid made of boxes, moved through the
// city WASD-style relative to the camera, Shift to run, heading that faces
// the movement, a walk-cycle bob and arm swing, and collision (circle vs
// building AABB push-out) plus world bounds so he can never walk through a
// wall or off the map.
import * as THREE from 'three';
import { CITY, PLAYER } from './config.js';

const SKIN = 0xe8b88a;
const HAIR = 0x2a2018;

// Build the mesh. All parts cast shadows; parts are returned so update()
// can swing the limbs and bob the torso.
export function createPlayerMesh() {
  const group = new THREE.Group();
  const mat = (color) => new THREE.MeshLambertMaterial({ color });
  const jeans = mat(0x2a2f45);
  const shoe = mat(0xf2f2f2);
  const teal = mat(0x2e8b7a);
  const jacket = mat(0x1f6a5c);
  const skin = mat(SKIN);
  const hair = mat(HAIR);
  const cap = mat(0xd97b2f);

  function box(w, h, d, material, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  const leftLeg = box(0.22, 0.8, 0.24, jeans, -0.14, 0.4, 0);
  const rightLeg = box(0.22, 0.8, 0.24, jeans, 0.14, 0.4, 0);
  const leftShoe = box(0.24, 0.12, 0.42, shoe, -0.14, 0.06, 0.06);
  const rightShoe = box(0.24, 0.12, 0.42, shoe, 0.14, 0.06, 0.06);
  const torso = box(0.62, 0.72, 0.34, teal, 0, 1.16, 0);
  box(0.66, 0.2, 0.38, jacket, 0, 1.42, 0);
  const leftArm = box(0.18, 0.68, 0.2, teal, -0.42, 1.16, 0);
  const rightArm = box(0.18, 0.68, 0.2, teal, 0.42, 1.16, 0);
  const head = box(0.4, 0.4, 0.38, skin, 0, 1.78, 0);
  box(0.44, 0.14, 0.42, hair, 0, 2.0, 0);
  box(0.46, 0.08, 0.44, cap, 0, 1.98, 0);

  return {
    group,
    parts: { leftLeg, rightLeg, leftShoe, rightShoe, leftArm, rightArm, torso, head },
  };
}

export function createPlayer(state, scene) {
  const { group, parts } = createPlayerMesh();
  scene.add(group);
  state.player.mesh = group;

  let speedSmooth = 0;
  let walkPhase = 0;
  const half = state.city.half;
  const limit = half + 56; // 380; the ocean is the wall

  // Circle (radius PLAYER.radius) vs every building AABB, one pass each:
  // push out along the delta to the nearest point; if the centre is inside
  // the box, push out along the smallest penetration.
  function collide(pos) {
    const r = PLAYER.radius;
    for (const b of state.city.buildings) {
      const nx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const nz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      let dx = pos.x - nx;
      let dz = pos.z - nz;
      const distSq = dx * dx + dz * dz;
      if (distSq >= r * r) continue;
      if (distSq > 0.000001) {
        const dist = Math.sqrt(distSq);
        const push = (r - dist) / dist;
        pos.x += dx * push;
        pos.z += dz * push;
      } else {
        // Centre inside the box: leave along the smallest penetration.
        const left = pos.x - b.minX;
        const right = b.maxX - pos.x;
        const top = pos.z - b.minZ;
        const bottom = b.maxZ - pos.z;
        const min = Math.min(left, right, top, bottom);
        if (min === left) pos.x = b.minX - r;
        else if (min === right) pos.x = b.maxX + r;
        else if (min === top) pos.z = b.minZ - r;
        else pos.z = b.maxZ + r;
      }
    }
    pos.x = Math.max(-limit, Math.min(limit, pos.x));
    pos.z = Math.max(-half - 6, Math.min(half + 56, pos.z));
  }

  function update(dt, axes, running, camYaw) {
    const player = state.player;
    const hasInput = axes.x !== 0 || axes.y !== 0;
    const targetSpeed = hasInput ? (running ? PLAYER.runSpeed : PLAYER.walkSpeed) : 0;
    const maxDelta = PLAYER.accel * dt;
    speedSmooth += Math.max(-maxDelta, Math.min(maxDelta, targetSpeed - speedSmooth));
    player.speed = speedSmooth;

    if (hasInput && speedSmooth > 0.01) {
      // Camera-relative movement: W walks away from the camera.
      const fx = -Math.sin(camYaw);
      const fz = -Math.cos(camYaw);
      const rx = -fz;
      const rz = fx;
      let mx = fx * axes.y + rx * axes.x;
      let mz = fz * axes.y + rz * axes.x;
      const len = Math.hypot(mx, mz);
      if (len > 0.000001) {
        mx /= len;
        mz /= len;
      }
      player.pos.x += mx * speedSmooth * dt;
      player.pos.z += mz * speedSmooth * dt;
      // Face the movement, turning on the shortest arc at turnRate.
      const targetHeading = Math.atan2(mx, mz);
      let diff = targetHeading - player.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      player.heading += diff * Math.min(1, PLAYER.turnRate * dt);
    }

    collide(player.pos);

    // Walk cycle: legs/shoes swing, arms opposite at 0.8x, torso and head bob.
    if (player.speed > 0.3) {
      walkPhase += dt * player.speed * 1.6;
      const swing = Math.sin(walkPhase) * Math.min(0.7, player.speed / 9);
      parts.leftLeg.rotation.x = swing;
      parts.rightLeg.rotation.x = -swing;
      parts.leftShoe.rotation.x = swing;
      parts.rightShoe.rotation.x = -swing;
      parts.leftArm.rotation.x = -swing * 0.8;
      parts.rightArm.rotation.x = swing * 0.8;
      const bob = Math.abs(Math.sin(walkPhase)) * 0.05;
      parts.torso.position.y = 1.16 + bob;
      parts.head.position.y = 1.78 + bob;
    } else {
      parts.leftLeg.rotation.x = 0;
      parts.rightLeg.rotation.x = 0;
      parts.leftShoe.rotation.x = 0;
      parts.rightShoe.rotation.x = 0;
      parts.leftArm.rotation.x = 0;
      parts.rightArm.rotation.x = 0;
      parts.torso.position.y = 1.16;
      parts.head.position.y = 1.78;
    }

    group.position.copy(player.pos);
    group.rotation.y = player.heading;
  }

  return { group, update };
}
