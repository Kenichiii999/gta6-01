// Neon Bay — the on-foot player. One job: build Danny Cole, a low-poly
// humanoid made of boxes, and move him through the city: WASD relative to
// the camera, Shift to run, heading that faces the movement, a walk-cycle
// bob and arm swing, and collision (circle vs building AABB push-out) plus
// world bounds so he can never walk through a wall or off the map.

import * as THREE from 'three';
import { PLAYER } from './config.js';

function box(w, h, d, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.castShadow = true;
  return mesh;
}

/** Build Danny Cole: teal jacket, dark jeans, sneakers, original design. */
export function createPlayerMesh() {
  const group = new THREE.Group();

  const leftLeg = box(0.22, 0.8, 0.24, 0x2a2f45);
  leftLeg.position.set(-0.14, 0.4, 0);
  const rightLeg = box(0.22, 0.8, 0.24, 0x2a2f45);
  rightLeg.position.set(0.14, 0.4, 0);
  const leftShoe = box(0.24, 0.12, 0.42, 0xf2f2f2);
  leftShoe.position.set(-0.14, 0.06, 0.06);
  const rightShoe = box(0.24, 0.12, 0.42, 0xf2f2f2);
  rightShoe.position.set(0.14, 0.06, 0.06);

  const torso = box(0.62, 0.72, 0.34, 0x2e8b7a);
  torso.position.set(0, 1.16, 0);
  const jacket = box(0.66, 0.2, 0.38, 0x1f6a5c);
  jacket.position.set(0, 1.42, 0);

  const leftArm = box(0.18, 0.68, 0.2, 0x2e8b7a);
  leftArm.position.set(-0.42, 1.16, 0);
  const rightArm = box(0.18, 0.68, 0.2, 0x2e8b7a);
  rightArm.position.set(0.42, 1.16, 0);

  const head = box(0.4, 0.4, 0.38, 0xe8b88a);
  head.position.set(0, 1.78, 0);
  const hair = box(0.44, 0.14, 0.42, 0x2a2018);
  hair.position.set(0, 2.0, 0);
  const cap = box(0.46, 0.08, 0.44, 0xd97b2f);
  cap.position.set(0, 1.98, 0);

  group.add(leftLeg, rightLeg, leftShoe, rightShoe, torso, jacket, leftArm, rightArm, head, hair, cap);
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return {
    group,
    parts: { leftLeg, rightLeg, leftShoe, rightShoe, leftArm, rightArm, torso, head },
  };
}

export function createPlayer(state, scene) {
  const { group, parts } = createPlayerMesh();
  scene.add(group);
  const player = state.player;
  player.mesh = group;
  let walkPhase = 0;
  let speedSmooth = 0;

  function collide(pos) {
    // Circle (player) vs building AABB push-out, one pass per building.
    const r = PLAYER.radius;
    for (const b of state.city.buildings) {
      const nx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const nz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const dx = pos.x - nx;
      const dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * r;
        pos.z = nz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration.
        const pushL = pos.x - b.minX + r;
        const pushR = b.maxX - pos.x + r;
        const pushT = pos.z - b.minZ + r;
        const pushB = b.maxZ - pos.z + r;
        const m = Math.min(pushL, pushR, pushT, pushB);
        if (m === pushL) pos.x = b.minX - r;
        else if (m === pushR) pos.x = b.maxX + r;
        else if (m === pushT) pos.z = b.minZ - r;
        else pos.z = b.maxZ + r;
      }
    }
    // World bounds: the city edge plus the beach; the ocean is the wall.
    const limit = state.city.half + 56;
    pos.x = Math.max(-limit, Math.min(limit, pos.x));
    pos.z = Math.max(-state.city.half - 6, Math.min(state.city.half + 56, pos.z));
  }

  return {
    group,
    /**
     * Advance the player one fixed step. `axes` is {x, y} from input,
     * `running` is Shift, `camYaw` is the camera orbit yaw. Movement is
     * relative to the camera: W walks away from the camera.
     */
    update(dt, axes, running, camYaw) {
      const targetSpeed = (axes.x !== 0 || axes.y !== 0)
        ? (running ? PLAYER.runSpeed : PLAYER.walkSpeed)
        : 0;
      // Accelerate toward the target speed, capped by PLAYER.accel.
      speedSmooth += Math.max(-PLAYER.accel * dt, Math.min(PLAYER.accel * dt, targetSpeed - speedSmooth));
      player.speed = speedSmooth;

      if (axes.x !== 0 || axes.y !== 0) {
        // Camera-relative direction: forward is away from the camera.
        const forwardX = -Math.sin(camYaw);
        const forwardZ = -Math.cos(camYaw);
        const rightX = -forwardZ;
        const rightZ = forwardX;
        let mx = forwardX * axes.y + rightX * axes.x;
        let mz = forwardZ * axes.y + rightZ * axes.x;
        const len = Math.hypot(mx, mz) || 1;
        mx /= len;
        mz /= len;
        player.pos.x += mx * player.speed * dt;
        player.pos.z += mz * player.speed * dt;
        const targetHeading = Math.atan2(mx, mz);
        // Turn toward the movement heading on the shortest arc.
        let diff = targetHeading - player.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        player.heading += diff * Math.min(1, PLAYER.turnRate * dt);
      }

      collide(player.pos);

      // Walk cycle: legs and arms swing, body bobs, faster when running.
      const moving = player.speed > 0.3;
      if (moving) walkPhase += dt * player.speed * 1.6;
      const swing = moving ? Math.sin(walkPhase) * Math.min(0.7, player.speed / 9) : 0;
      parts.leftLeg.rotation.x = swing;
      parts.rightLeg.rotation.x = -swing;
      parts.leftShoe.rotation.x = swing;
      parts.rightShoe.rotation.x = -swing;
      parts.leftArm.rotation.x = -swing * 0.8;
      parts.rightArm.rotation.x = swing * 0.8;
      parts.torso.position.y = 1.16 + (moving ? Math.abs(Math.sin(walkPhase)) * 0.05 : 0);
      parts.head.position.y = 1.78 + (moving ? Math.abs(Math.sin(walkPhase)) * 0.05 : 0);

      group.position.copy(player.pos);
      group.rotation.y = player.heading;
    },
  };
}
