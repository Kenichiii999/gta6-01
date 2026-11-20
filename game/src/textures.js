// Procedural canvas textures: every texture the city needs is painted on
// offscreen canvases, so the game ships no image files and loads nothing
// over the net. Facade window patterns are seeded (stable per seed);
// road/sidewalk/sand speckle grain is visual only and unseeded.
import * as THREE from 'three';
import { randInt } from './random.js';

function css(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function canvasTexture(width, height, paint, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 256x512 facade: pastel base, window grid (some lit), shopfront band with
// doors and coloured awnings at ground level, dark roofline strip on top.
export function makeFacadeTexture(baseHex, rng, floors = 8, cols = 6) {
  return canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = css(baseHex);
    ctx.fillRect(0, 0, w, h);
    // Subtle vertical panel shading.
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 16, h);
    // Window grid: margins x 14, top 18, ground-floor band 46.
    const cellW = (w - 28) / cols;
    const cellH = (h - 18 - 46) / floors;
    const winW = cellW * 0.64;
    const winH = cellH * 0.58;
    for (let f = 0; f < floors; f += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = 14 + c * cellW + (cellW - winW) / 2;
        const y = 18 + f * cellH + (cellH - winH) / 2;
        const lit = rng() < 0.22;
        ctx.fillStyle = lit ? '#ffe9a8' : '#27405c';
        ctx.fillRect(x, y, winW, winH);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, winW, winH);
        // Centre mullion.
        ctx.beginPath();
        ctx.moveTo(x + winW / 2, y);
        ctx.lineTo(x + winW / 2, y + winH);
        ctx.stroke();
      }
    }
    // Ground floor: dark band with shop doors and coloured awnings.
    const groundY = h - 46;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, groundY, w, 46);
    const awnings = [0xd97b2f, 0x2e8b7a, 0xc94f4f, 0x4f7ac9];
    const shops = Math.max(1, Math.floor(cols / 2));
    const shopW = w / shops;
    for (let s = 0; s < shops; s += 1) {
      const x = s * shopW;
      ctx.fillStyle = s % 2 === 0 ? '#3a2f28' : '#5a3a28';
      ctx.fillRect(x + shopW * 0.32, groundY + 10, shopW * 0.36, 36);
      ctx.fillStyle = css(awnings[randInt(rng, 0, awnings.length - 1)]);
      ctx.fillRect(x + 4, groundY, shopW - 8, 12);
    }
    // Roofline strip.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, 10);
  });
}

// 128x256 asphalt, repeat (1, 4): speckles, pale edge lines, dashed yellow centre.
export function makeRoadTexture() {
  return canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i += 1) {
      const g = 50 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    ctx.fillStyle = '#d8d8c8';
    ctx.fillRect(4, 0, 3, h);
    ctx.fillRect(w - 7, 0, 3, h);
    ctx.fillStyle = '#e8c84a';
    for (let y = 0; y < h; y += 64) ctx.fillRect(w / 2 - 2, y, 4, 34);
  }, 1, 4);
}

// 128x128 pavement slabs, repeat (4, 4).
export function makeSidewalkTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b9b3a4';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i += 1) {
      ctx.beginPath(); ctx.moveTo((i * w) / 4, 0); ctx.lineTo((i * w) / 4, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i * h) / 4); ctx.lineTo(w, (i * h) / 4); ctx.stroke();
    }
    for (let i = 0; i < 200; i += 1) {
      const g = 140 + Math.floor(Math.random() * 60);
      ctx.fillStyle = `rgb(${g},${g - 8},${g - 20})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, 4, 4);
}

// 128x128 sand, repeat (8, 8).
export function makeSandTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e8d49a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1200; i += 1) {
      const g = 200 + Math.floor(Math.random() * 55);
      ctx.fillStyle = `rgb(${g},${g - 25},${g - 90})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, 8, 8);
}

// 4x256 vertical sky gradient: top colour -> bottom colour -> warm horizon.
export function makeSkyTexture(topHex, bottomHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, css(topHex));
  grad.addColorStop(0.55, css(bottomHex));
  grad.addColorStop(1, '#f5e9c8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
