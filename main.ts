// Neon Bay — the gta6-01 entry program (Node 22, standard library only).
//
// The game itself is plain static files: game/index.html plus ES modules
// and the vendored three.js under game/vendor/, nothing fetched over the
// network, no build step. This program hands it in: it copies game/ and
// screenshots/ from beside this file into /output (or $MAKEFUN_OUTPUT_DIR
// outside the grader container) and writes /output/dossier.json, the
// summary the judge reads, using the vendored make.fun library.
//
// Play it locally first:
//   node serve.ts        # then open http://localhost:8080
// Hand it in from a scratch directory:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The repo root: the directory this file lives in.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Inside the grader the output directory is /output; outside it, the
// MAKEFUN_OUTPUT_DIR environment variable stands in for it.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Copy the game in whole, then the screenshots beside it (if any).
mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
const screenshotsDir = join(repoRoot, 'screenshots');
if (existsSync(screenshotsDir)) {
  cpSync(screenshotsDir, join(outputDir, 'screenshots'), { recursive: true });
}

// The scorer's caps, from the competition's gate: the dossier text budget
// shapes the bytes, and the rest refuse an entry the scorer would refuse
// outright — more than 4 screenshots or one over 256 KiB; more than 993
// files in game/ or 48 MiB of game files in all; a game path over 1000
// bytes (game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
console.log(`Neon Bay entry written to ${outputDir}`);
