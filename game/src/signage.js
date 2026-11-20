// Emissive neon signage for the landmark buildings — the scoped fix for
// "Neon Bay has no neon". One glowing sign pair per landmark (a facade
// sign on the south face + a double-sided rooftop sign), using only the
// city's own names. No city rework, no new lights, no RNG: the signs are
// sized from each landmark mesh's own BoxGeometry and placed from its
// position, so they follow any seed. Text is painted on offscreen
// canvases (no image files, no network); the planes use unlit materials
// with tone mapping off so the colours stay saturated in daylight.
import * as THREE from 'three';

// Short label + facade text + neon colour per landmark key (DESIGN.md
// §3.6 names — no outside names).
const SIGNS = {
  tower: { short: 'NEON BAY', full: 'NEON BAY', color: '#ff2e88' },
  garage: { short: 'GARAGE', full: 'MARCHETTI GARAGE', color: '#ff9a3d' },
  hospital: { short: 'HOSPITAL', full: 'BAY GENERAL', color: '#37e0c8' },
  police: { short: 'POLICE', full: 'POLICE HQ', color: '#4d8dff' },
  bank: { short: 'BANK', full: 'NEON BAY BANK', color: '#ffd23d' },
};

// Paint glowing text on a transparent canvas. Font size shrinks until
// the text fits, so long names never clip.
function makeNeonTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  let px = 76;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  do {
    ctx.font = `900 ${px}px system-ui, "Segoe UI", sans-serif`;
    px -= 4;
  } while (ctx.measureText(text).width > 470 && px > 20);
  ctx.font = `900 ${px}px system-ui, "Segoe UI", sans-serif`;
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 256, 66);
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 66);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.55;
  ctx.fillText(text, 256, 66);
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// One sign: dark backing (letters stay readable against bright facades),
// the glowing text face, and a larger faint copy of the same text behind
// it as a halo. Returns a Group facing +Z.
function makeSign(text, color, width, height) {
  const group = new THREE.Group();
  const tex = makeNeonTexture(text, color);
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.35, height * 1.6),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
  );
  halo.position.z = -0.14;
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.04, height * 1.18),
    new THREE.MeshBasicMaterial({
      color: 0x0a0a14, transparent: true, opacity: 0.88,
      side: THREE.DoubleSide, toneMapped: false,
    }),
  );
  back.position.z = -0.07;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide,
      depthWrite: false, toneMapped: false,
    }),
  );
  group.add(halo, back, face);
  return group;
}

// Width estimate for a sign of the given height: bold caps run about
// 0.62 of the cap height per character, plus end padding.
function signWidth(text, height) {
  return height * (text.length * 0.62 + 0.8);
}

// Build all landmark signs into the scene. Safe to call once; guards
// against a missing landmark or a non-box mesh so a bad entry can never
// break the frame.
export function createNeonSigns(scene, city) {
  if (!scene || !city || !city.landmarks) return;
  for (const [key, lm] of Object.entries(city.landmarks)) {
    const spec = SIGNS[key];
    if (!spec || !lm || !lm.mesh) continue;
    const params = lm.mesh.geometry && lm.mesh.geometry.parameters;
    if (!params || typeof params.width !== 'number') continue;
    const w = params.width;
    const h = params.height;
    const d = params.depth;
    const cx = lm.pos.x;
    const cz = lm.pos.z;

    // Facade sign on the south (+Z) face — the face the spawn, the
    // street shot and most approaches look at — in the upper third.
    const facadeH = Math.max(2.2, Math.min(4.5, h * 0.14));
    let facadeText = spec.full;
    if (signWidth(facadeText, facadeH) > w * 0.86) facadeText = spec.short;
    const facadeW = Math.min(signWidth(facadeText, facadeH), w * 0.86);
    const facade = makeSign(facadeText, spec.color, facadeW, facadeH);
    facade.position.set(cx, h * 0.72, cz + d / 2 + 0.15);
    scene.add(facade);

    // Rooftop sign: double-sided, so it reads from the north and the
    // south alike. Stands just above the roof slab (roof top = h + 0.5).
    const roofH = Math.max(3, Math.min(7, h * 0.2));
    const roofW = Math.min(signWidth(spec.short, roofH), w * 0.9);
    const roof = makeSign(spec.short, spec.color, roofW, roofH);
    roof.position.set(cx, h + 0.5 + roofH / 2, cz);
    scene.add(roof);
  }
}
