// Generates a 1024×1024 Skitza brand PNG into apps/desktop/src-tauri/icons/source-1024.png.
// Run: node apps/desktop/scripts/generate-icon-source.mjs
//
// The design: squircle (iOS-style rounded-rect) in Skitza cream #F4EFE7 with a
// large italic serif "S" monogram in amber #C98A0A. The S occupies the visual
// center at readable weight down to 32×32 (the smallest bundled size).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("/Users/giliasraf/Skitza 16.4/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.join(__dirname, "..", "src-tauri", "icons", "source-1024.png");

// Squircle via rounded rect with radius 22% — macOS icon-ish curvature.
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F7F2EA"/>
      <stop offset="1" stop-color="#EDE5D6"/>
    </linearGradient>
    <linearGradient id="amber" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#D99511"/>
      <stop offset="1" stop-color="#B87606"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>
      <feOffset dx="0" dy="6" result="off"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.18"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="1024" height="1024" rx="224" ry="224" fill="url(#bg)"/>
  <rect x="1" y="1" width="1022" height="1022" rx="223" ry="223"
        fill="none" stroke="#00000010" stroke-width="2"/>
  <g filter="url(#shadow)">
    <text x="512" y="712"
          font-family="Georgia, 'Times New Roman', serif"
          font-size="720"
          font-style="italic"
          font-weight="700"
          fill="url(#amber)"
          text-anchor="middle"
          letter-spacing="-8">S</text>
  </g>
</svg>`;

await sharp(Buffer.from(svg))
  .resize(1024, 1024)
  .png({ compressionLevel: 9 })
  .toFile(OUT);

console.log("wrote", OUT);
