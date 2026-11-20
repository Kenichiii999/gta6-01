// Neon landmark signage — one glowing sign pair per landmark: a
// facade sign on the south face (the side the spawn, the street shots
// and most approaches look at) plus a double-sided rooftop sign.
// Text uses only the city's own names, each in its own neon colour.
// Signs are sized from each landmark mesh's own dimensions and placed
// from its position, so they follow any city seed. Text is painted on
// offscreen canvases (no image files, no network); the sign planes use
// unlit materials with tone mapping off so the colours stay saturated
// in daylight. Each sign is a dark backing plus the glowing text face
// plus a larger faint copy of the same text behind it as a halo.
// Built once, lazily, on the first frame that has a city — and a
// failure here must never break the frame.
import * as THREE from 'three';

// [facade text, rooftop text, neon colour] per landmark key.
const SIGN_TEXT = {
  tower: { facade: 'NEON BAY', roof: 'NEON BAY', color: '#ff5a9a' },
  garage: { facade: 'MARCHETTI GARAGE', roof: 'GARAGE', color: '#ff9a3d' },
  hospital: { facade: 'BAY GENERAL', roof: 'HOSPITAL', color: '#4dff88' },
  police: { facade: 'POLICE HQ', roof: 'POLICE', color: '#5a9aff' },
  bank: { facade: 'NEON BAY BANK', roof: 'BANK', color: '#ffd23d' },
};

const builtScenes = new WeakMap();

// Paint glowing text on an offscreen canvas; returns the texture.
function makeTextTexture(text, color) {
  const probe = document.createElement('canvas').getContext('2d');
  const font = '900 150px Arial, Helvetica, sans-serif';
  probe.font = font;
  const pad = 90;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(probe.measureText(text).width) + pad * 2;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  // Two soft-glow passes in the neon colour, then a hot white core.
  ctx.shadowColor = color;
  ctx.shadowBlur = 42;
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
  ctx.fillText(text, cx, cy);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(text, cx, cy);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// One sign: dark backing, a larger faint copy of the text as a halo,
// and the glowing text face on top. Unlit, tone mapping off.
function makeSign(text, color, faceWidth, faceHeight, doubleSided) {
  const group = new THREE.Group();
  const texture = makeTextTexture(text, color);
  const side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(faceWidth + 0.8, faceHeight + 0.8),
    new THREE.MeshBasicMaterial({ color: 0x0a0a14, side, toneMapped: false }),
  );
  group.add(backing);
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(faceWidth * 1.3, faceHeight * 1.3),
    new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity: 0.35, side, toneMapped: false, depthWrite: false,
    }),
  );
  halo.position.z = 0.05;
  group.add(halo);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(faceWidth, faceHeight),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side, toneMapped: false }),
  );
  face.position.z = 0.1;
  group.add(face);
  return { group, aspect: texture.image.width / texture.image.height };
}

// Footprint / height of a landmark, read from its own mesh.
function landmarkSize(landmark) {
  const params = landmark.mesh && landmark.mesh.geometry && landmark.mesh.geometry.parameters;
  if (params && typeof params.width === 'number' && typeof params.height === 'number') {
    return { w: params.width, h: params.height, d: params.depth };
  }
  return { w: 34, h: 16, d: 30 };
}

function buildSignage(state, scene) {
  const landmarks = state.city.landmarks;
  for (const key of Object.keys(SIGN_TEXT)) {
    const lm = landmarks[key];
    if (!lm || !lm.mesh) continue;
    try {
      const spec = SIGN_TEXT[key];
      const { w, h, d } = landmarkSize(lm);
      const isTower = key === 'tower';

      // Facade sign on the south face (+Z). The 88 m tower's sign sits
      // lower — about a third of its height (~28 m) — so it is in frame
      // from a normal street distance; the others keep theirs in the
      // upper third.
      const facadeY = isTower ? h * 0.33 : h * 0.75;
      const facadeMaxH = isTower ? h * 0.14 : h * 0.42;
      let facadeW = w * 0.85;
      let facadeH = facadeW / makeTextAspect(spec.facade, spec.color);
      if (facadeH > facadeMaxH) {
        facadeH = facadeMaxH;
        facadeW = facadeH * makeTextAspect(spec.facade, spec.color);
      }
      const facade = makeSign(spec.facade, spec.color, facadeW, facadeH, false);
      facade.group.position.set(lm.pos.x, facadeY, lm.pos.z + d / 2 + 0.25);
      scene.add(facade.group);

      // Double-sided rooftop sign, standing on the roof.
      let roofW = w * 0.55;
      let roofH = roofW / makeTextAspect(spec.roof, spec.color);
      if (roofH > 5) {
        roofH = 5;
        roofW = roofH * makeTextAspect(spec.roof, spec.color);
      }
      const roof = makeSign(spec.roof, spec.color, roofW, roofH, true);
      roof.group.position.set(lm.pos.x, h + roofH / 2 + 0.9, lm.pos.z);
      scene.add(roof.group);
    } catch {
      // One bad landmark must not take the other signs with it.
    }
  }
}

// Aspect (width / height) of the painted text canvas for a string.
// Cached per string so the facade/roof sizing and the sign itself agree.
const aspectCache = new Map();
function makeTextAspect(text, color) {
  const cacheKey = `${text}|${color}`;
  if (!aspectCache.has(cacheKey)) {
    const texture = makeTextTexture(text, color);
    aspectCache.set(cacheKey, texture.image.width / texture.image.height);
  }
  return aspectCache.get(cacheKey);
}

// Build once, lazily, on the first frame that has a city. Never throws.
export function updateSignage(state, scene) {
  if (!state || !state.city || !state.city.landmarks || !scene) return;
  if (builtScenes.has(scene)) return;
  try {
    buildSignage(state, scene);
  } catch {
    // Signage must never break a frame.
  }
  builtScenes.set(scene, true);
}
