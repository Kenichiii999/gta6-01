// Neon Bay — procedural canvas textures. One job: paint every texture the
// city needs (building facades, road asphalt, sidewalk) on offscreen
// canvases so the game ships no image files and loads nothing over the net.

import * as THREE from 'three';
import { randInt } from './random.js';

function canvasTexture(width, height, paint, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function css(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * A building facade: pastel base colour, a grid of lit/unlit windows with
 * frames, a darker ground-floor band (shops/doors) and a roofline strip.
 * `rng` is a seeded stream so each variant is stable for a given seed.
 */
export function makeFacadeTexture(baseHex, rng, floors = 8, cols = 6) {
  return canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = css(baseHex);
    ctx.fillRect(0, 0, w, h);
    // Subtle vertical shading so big flat walls read as panels.
    for (let x = 0; x < w; x += 32) {
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      ctx.fillRect(x, 0, 16, h);
    }
    const marginX = 14;
    const marginTop = 18;
    const cellW = (w - marginX * 2) / cols;
    const cellH = (h - marginTop - 46) / floors;
    for (let f = 0; f < floors; f += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = marginX + c * cellW + cellW * 0.18;
        const y = marginTop + f * cellH + cellH * 0.2;
        const ww = cellW * 0.64;
        const wh = cellH * 0.58;
        const lit = rng() < 0.22;
        ctx.fillStyle = lit ? '#ffe9a8' : '#27405c';
        ctx.fillRect(x, y, ww, wh);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, ww, wh);
        ctx.beginPath();
        ctx.moveTo(x + ww / 2, y);
        ctx.lineTo(x + ww / 2, y + wh);
        ctx.stroke();
      }
    }
    // Ground floor: shopfront band with doors and awnings.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, h - 46, w, 46);
    for (let c = 0; c < cols; c += 1) {
      const x = marginX + c * cellW + cellW * 0.1;
      ctx.fillStyle = randInt(rng, 0, 1) === 0 ? '#3a2f28' : '#5a3a28';
      ctx.fillRect(x, h - 40, cellW * 0.8, 34);
      ctx.fillStyle = css([0xd97b2f, 0x2e8b7a, 0xc94f4f, 0x4f7ac9][randInt(rng, 0, 3)]);
      ctx.fillRect(x, h - 46, cellW * 0.8, 8);
    }
    // Roofline strip.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, 10);
  });
}

/** Road asphalt with a dashed centre line and worn edge lines. */
export function makeRoadTexture() {
  return canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(0, 0, w, h);
    // Asphalt speckle.
    for (let i = 0; i < 900; i += 1) {
      const g = 50 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${g},${g + 3},${g + 8})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // Edge lines.
    ctx.fillStyle = '#d8d8c8';
    ctx.fillRect(4, 0, 3, h);
    ctx.fillRect(w - 7, 0, 3, h);
    // Dashed centre line.
    ctx.fillStyle = '#e8c84a';
    for (let y = 0; y < h; y += 64) ctx.fillRect(w / 2 - 2, y + 8, 4, 34);
  }, 1, 4);
}

/** Sidewalk paving slabs with joints. */
export function makeSidewalkTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b9b3a4';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo((i * w) / 4, 0);
      ctx.lineTo((i * w) / 4, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i * h) / 4);
      ctx.lineTo(w, (i * h) / 4);
      ctx.stroke();
    }
    for (let i = 0; i < 200; i += 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, 4, 4);
}

/** Sand for the beach: warm grains with a few shells' worth of speckle. */
export function makeSandTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e8d49a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1200; i += 1) {
      const g = 200 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${g},${g - 20},${g - 90})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, 8, 8);
}

/**
 * A vertical sky gradient painted on a canvas, wrapped onto the inside of a
 * big sphere so the horizon reads as haze and the zenith as deep blue.
 */
export function makeSkyTexture(topHex, bottomHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, css(topHex));
  gradient.addColorStop(0.55, css(bottomHex));
  gradient.addColorStop(1, '#f5e9c8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
