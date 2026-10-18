// Renders the Home profile of deck.config.mjs as docs/layout.svg (used by the README).
// Run: node scripts/layout-svg.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = (await import(new URL('../deck.config.mjs', import.meta.url))).default();
const { cols, rows, screenCols } = config.device;

const CELL = 112, GAP = 12, PAD = 28, R = 16;
const NAV = '#4f8cff';
const SPECIAL = { approve: ['#f5b400', 'Approve'], status: ['#464646', 'Agents'], clock: ['#2a5fb0', 'Next\nmeeting'] };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const keyFace = (k) => {
  if (k.type === 'switch') return [NAV, k.label];
  const [color, label] = SPECIAL[k.type] ?? [k.color ?? '#5a5a5a', k.label ?? k.type];
  return [color, k.label ?? label];
};

const home = config.profiles.Default;
const keyCells = [], screenCells = [];
for (let i = 0; i < cols * rows; i++) (screenCols.includes(i % cols) ? screenCells : keyCells).push(i);
const layout = new Array(cols * rows).fill(null);
home.forEach((k, n) => { layout[keyCells[n]] = keyFace(k); });
config.screen.forEach((k, n) => { layout[screenCells[n]] = k.type === 'clock' ? SPECIAL.clock : [SPECIAL.status[0], `${k.label}\n${k.kinds ? 'status' : ''}`.trim()]; });

const W = PAD * 2 + cols * CELL + (cols - 1) * GAP;
const H = PAD * 2 + rows * CELL + (rows - 1) * GAP;
const cells = layout.map((face, i) => {
  if (!face) return '';
  const x = PAD + (i % cols) * (CELL + GAP), y = PAD + Math.floor(i / cols) * (CELL + GAP);
  const lines = face[1].split('\n');
  const top = y + CELL / 2 - ((lines.length - 1) * 9) + 5;
  const isScreen = screenCols.includes(i % cols);
  const text = lines.map((l, n) => `<text x="${x + CELL / 2}" y="${top + n * 18}" text-anchor="middle">${esc(l)}</text>`).join('');
  return `<g><rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="${R}" fill="${face[0]}" ${isScreen ? 'fill-opacity=".55" stroke="#8a8a8a" stroke-dasharray="5 4"' : ''}/><rect x="${x + 10}" y="${y + 1}" width="${CELL - 20}" height="5" rx="2.5" fill="#fff" fill-opacity=".18"/>${text}</g>`;
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="15" font-weight="600" fill="#fff">
<rect width="${W}" height="${H}" rx="22" fill="#15171c"/>
${cells}
</svg>
`;
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'layout.svg'), svg);
console.log('docs/layout.svg', W, 'x', H);
