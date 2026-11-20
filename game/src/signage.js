// Neon landmark signage — one wraparound sign per landmark: the
// landmark's own name, painted once on each of its four faces at the
// same height, so from any cardinal direction exactly one face is
// front-on and the text shows exactly once. The faces of a box meet
// only at the corner edge, so two faces can never overlap or ghost
// over each other the way the old rooftop sign used to land on top of
// the facade sign when viewed from the south. Text uses only the
// city's own names, each in its own neon colour. Signs are sized from
// each landmark mesh's own dimensions and placed from its position,
// so they follow any city seed. Text is painted on offscreen canvases
// (no image files, no network); the sign planes use unlit materials
// with tone mapping off so the colours stay saturated in daylight.
// Each sign is a dark backing plus the glowing text face plus a
// larger faint copy of the same text behind it as a halo. Built once,
// lazily, on the first frame that has a city — and a failure here must
// never break the frame.
import * as THREE from 'three';

// [sign text, neon colour] per landmark key. One text per landmark:
// the same text is painted on all four faces, so it can never be
// doubled by a second sign carrying the same words.
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
    // Exactly the face size, on purpose: a wider halo would poke past
    // the dark backing and ghost its edge letters onto the facade
    // (the R3 halo at 1.3x did exactly that). Same-size, it still
    // shows through the face's transparent pixels and doubles the
    // glow around the letters, but nothing of it can escape the sign.
    new THREE.PlaneGeometry(faceWidth, faceHeight),
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

      // One sign, wrapped around all four faces at the same height.
      // The 88 m tower's sign sits lower — about a third of its height
      // (~28 m) — so it is in frame from a normal street distance;
      // the others keep theirs in the upper third. Each face is sized
      // from its own face width (w for the south/north faces, d for
      // the east/west ones) and capped at the same max height, so the
      // text never overhangs a corner. The old rooftop sign is gone:
      // from the south it used to land directly on top of the facade
      // sign and double the lettering.
      const signY = isTower ? h * 0.33 : h * 0.75;
      const signMaxH = isTower ? h * 0.14 : h * 0.42;
      const aspect = makeTextAspect(spec.text, spec.color);
      // [face width, offset from centre, outward rotation]. South
      // first (the side the spawn, the street shots and most
      // approaches look at), then north, east, west.
      const faces = [
        { width: w, x: 0, z: d / 2 + 0.25, rotY: 0 },
        { width: w, x: 0, z: -d / 2 - 0.25, rotY: Math.PI },
        { width: d, x: w / 2 + 0.25, z: 0, rotY: Math.PI / 2 },
        { width: d, x: -w / 2 - 0.25, z: 0, rotY: -Math.PI / 2 },
      ];
      for (const face of faces) {
        let faceW = face.width * 0.85;
        let faceH = faceW / aspect;
        if (faceH > signMaxH) {
          faceH = signMaxH;
          faceW = faceH * aspect;
        }
        const sign = makeSign(spec.text, spec.color, faceW, faceH, false);
        sign.group.position.set(lm.pos.x + face.x, signY, lm.pos.z + face.z);
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
