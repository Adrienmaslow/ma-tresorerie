// Génère les icônes PNG de la PWA à partir de scripts/icon.svg
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync(new URL('./icon.svg', import.meta.url));
mkdirSync('public/icons', { recursive: true });

const out = [
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
  ['public/icons/apple-touch-icon.png', 180],
];
for (const [file, size] of out) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(file);
}
// Version "maskable" : motif réduit à 80 % dans la zone de sécurité
const inner = await sharp(svg, { density: 384 }).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0b1110' } })
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile('public/icons/icon-maskable-512.png');
// Favicon SVG avec coins arrondis
const fav = svg.toString().replace('<rect width="512" height="512" fill="url(#bg)"/>', '<rect width="512" height="512" rx="112" fill="url(#bg)"/>').replace('<rect width="512" height="512" fill="url(#glow)"/>', '<rect width="512" height="512" rx="112" fill="url(#glow)"/>');
writeFileSync('public/favicon.svg', fav);
console.log('Icônes générées.');
