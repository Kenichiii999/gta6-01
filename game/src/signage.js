// Neon landmark signage — one glowing sign per landmark, carried on all
// four faces of the building so that from any cardinal direction exactly
// one face is front-on and the text appears exactly once. There is no
// rooftop sign: the old roof sign stood behind the facade sign, and from
// street level to the south the two stacked into doubled, ghosted
// lettering. Text uses only the city's own names, each in its own neon
// colour. Signs are sized from each landmark mesh's own dimensions and
// placed from its position, so they follow any city seed. Text is painted
// on offscreen canvases (no image files, no network); the sign planes use
// unlit materials with tone mapping off so the colours stay saturated
// in daylight. Each sign is a dark backing plus the glowing text face —
// no larger faint copy behind the text, so there is no halo or ghosting.
// Built once, lazily, on the first frame that has a city — and a
// failure here must never break the frame.
import * as THREE from 'three';

// [sign text, neon colour] per landmark key.
const SIGN_TEXT = {
  tower: { text: 'NEON BAY', color: '#ff5a9a' },
  garage: { text: 'MARCHETTI GARAGE', color: '#ff9a3d' },
  hospital: { text: 'BAY GENERAL', color: '#4dff88' },
  police: { text: 'POLICE HQ', color: '#5a9aff' },
  bank: { text: 'NEON BAY BANK', color: '#ffd23d' },
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

// One sign: dark backing plus the glowing text face. Unlit, tone
// mapping off. Front side only — a face is readable from the side it
// faces and invisible from the opposite side, so exactly one face of a
// landmark shows from any cardinal direction.
function makeSign(text, color, faceWidth, faceHeight) {
  const group = new THREE.Group();
  const texture = makeTextTexture(text, color);
  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(faceWidth + 0.8, faceHeight + 0.8),
    new THREE.MeshBasicMaterial({ color: 0x0a0a14, toneMapped: false }),
  );
  group.add(backing);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(faceWidth, faceHeight),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
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

      // One sign per face of the building, all carrying the same text:
      // south (+Z), north (−Z), east (+X), west (−X). Each face is
      // front-side only, so from any cardinal direction exactly one
      // face is front-on and the text appears exactly once. The 88 m
      // tower's sign sits lower — about a third of its height (~28 m)
      // — so it is in frame from a normal street distance; the others
      // keep theirs in the upper third.
      const signY = isTower ? h * 0.33 : h * 0.75;
      const signMaxH = isTower ? h * 0.14 : h * 0.42;
      const faces = [
        { dx: 0, dz: d / 2 + 0.25, rotY: 0, base: w },
        { dx: 0, dz: -d / 2 - 0.25, rotY: Math.PI, base: w },
        { dx: w / 2 + 0.25, dz: 0, rotY: Math.PI / 2, base: d },
        { dx: -w / 2 - 0.25, dz: 0, rotY: -Math.PI / 2, base: d },
      ];
      for (const face of faces) {
        let faceW = face.base * 0.85;
        let faceH = faceW / makeTextAspect(spec.text, spec.color);
        if (faceH > signMaxH) {
          faceH = signMaxH;
          faceW = faceH * makeTextAspect(spec.text, spec.color);
        }
        const sign = makeSign(spec.text, spec.color, faceW, faceH);
        sign.group.position.set(lm.pos.x + face.dx, signY, lm.pos.z + face.dz);
        sign.group.rotation.y = face.rotY;
        scene.add(sign.group);
      }
    } catch {
      // One bad landmark must not take the other signs with it.
    }
  }
}

// Aspect (width / height) of the painted text canvas for a string.
// Cached per string so the face sizing and the sign itself agree.
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
