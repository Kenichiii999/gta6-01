// Screenshot staging behind ?shot=<name>&seed=<n>. For now there is only the
// title screen: the player stands by the garage and the camera looks down
// the street at Neon Bay Tower. Later slices add chase/street/heist/city
// shots with a real autopilot; the shape (return the screen to draw) stays
// the same. Any unknown name stages the title screen, as v1 does.
import { SCREEN_TITLE } from './render.js';

export function stageShot(name, state) {
  state.screen = SCREEN_TITLE;
  state.time = 0;
  const garage = state.city.landmarks.garage;
  state.player.pos.set(garage.pos.x, 0, garage.pos.z + 18);
  state.player.heading = Math.PI;
  state.camera.yaw = 0;
  state.camera.pitch = 0.42;
  state.camera.dist = 11;
  return { screen: SCREEN_TITLE };
}
