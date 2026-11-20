// Neon Bay — screenshot staging (slice A stub). One job: put the world in
// the named scene for ?shot=<name>&seed=<n>. For now there is only the title
// screen: the player stands by the garage and the camera looks down the
// street at Neon Bay Tower. Later slices add chase/street/heist/city shots
// with a real autopilot; the shape (return the screen to draw) stays the same.

import { SCREEN_TITLE } from './render.js';

/**
 * Stage `name` on the shared state and return the screen to draw over it.
 * Any unknown name stages the title screen.
 */
export function stageShot(name, state) {
  void name;
  state.screen = SCREEN_TITLE;
  state.time = 0;
  // Player waits by the garage (mission hub), facing the tower downtown.
  const garage = state.city.landmarks.garage;
  if (garage) {
    state.player.pos.set(garage.pos.x, 0, garage.pos.z + 18);
    state.player.heading = Math.PI;
  }
  state.camera.yaw = 0;
  state.camera.pitch = 0.42;
  state.camera.dist = 11;
  return { screen: SCREEN_TITLE };
}
