'use strict';
// Preview sheets (box/dev only): per genre, three-view voxel sprites (front, three-quarter, side) for an NPC and a creature,
// plus genre props/building pieces through ScenePropVoxels, and a light-curve sheet. Usage: node tools/preview/genre-sheet.cjs <outdir>
process.env.HOLODEK_GENRE_KITS = '1';
const fs = require('fs'), path = require('path'), { createCanvas } = require('canvas');
const K = require('../../assets/genreKits'), L = require('../../assets/genreLights'), S = require('../../assets/renderCharacterSprite'), P = require('../../assets/scenePropVoxels');
const OUT = path.resolve(process.argv[2] || 'genre-previews'); fs.mkdirSync(OUT, { recursive: true });
// Orthographic voxel render with face shading and a dark 1px outline (game style). yaw 0 front, 45 three-quarter, 90 side.
function renderVox(size, at, colorAt, yaw, px = 3) {
  const W = size * 2, c = createCanvas(W * px, W * px), g = c.getContext('2d'), depth = new Float32Array(W * W).fill(-1e9), col = new Array(W * W);
  const ca = Math.cos(yaw * Math.PI / 180), sa = Math.sin(yaw * Math.PI / 180);
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { if (!at(x, y, z)) continue;
    const cx = x - size / 2, cy = y - size / 2, sx = Math.round(cx * ca - cy * sa + W / 2), d = cx * sa + cy * ca, sy = Math.round(W - 4 - z - (W - size) / 2);
    if (sx < 0 || sx >= W || sy < 0 || sy >= W) continue; const i = sy * W + sx; if (-d > depth[i]) { depth[i] = -d; const top = !at(x, y, z + 1); col[i] = colorAt(x, y, z, top ? 1.08 : (d < 0 ? .9 : .78)); } }
  for (let i = 0; i < W * W; i++) if (col[i]) { g.fillStyle = col[i]; g.fillRect((i % W) * px, Math.floor(i / W) * px, px, px); }
  g.fillStyle = '#0a0606'; for (let i = 0; i < W * W; i++) if (!col[i]) { const x = i % W, y = Math.floor(i / W); if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => x + a >= 0 && x + a < W && col[(y + b) * W + x + a])) g.fillRect(x * px, y * px, px, px); }
  return c;
}
const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
function spriteViews(spec) { const f = S.createSemanticCharacterVoxelFrame({ name: spec.name }, spec, {}), n = f.size, at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n && f.voxels[x + y * n + z * n * n];
  const ca = (x, y, z, k) => { const i = (x + y * n + z * n * n) * 3; return hex(f.colors[i] * k, f.colors[i + 1] * k, f.colors[i + 2] * k); }; return [0, 45, 90].map(yaw => renderVox(n, at, ca, yaw, 3)); }
function propView(shape, genre) { const n = 16, v = P.build(shape, n, 1, {}); if (!v) return null; const at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n && v[x + y * n + z * n * n];
  return renderVox(n, at, (x, y, z, k) => { const c = P.color(shape, (x + .5) / n, (y + .5) / n, (z + .5) / n, [0, 0, 1], null, 'stone', { genre }); return hex(c[0] * k, c[1] * k, c[2] * k); }, 35, 3); }
const genres = Object.keys(K.GENRES), CW = 1500, RH = 230, sheet = createCanvas(CW, 40 + genres.length * RH), g = sheet.getContext('2d');
g.fillStyle = '#000'; g.fillRect(0, 0, sheet.width, sheet.height); g.font = '14px monospace'; g.fillStyle = '#fff'; g.fillText('Genre kits: NPC front / 3-4 / side, creature front / 3-4 / side, props and building pieces (voxel)', 10, 24);
genres.forEach((gn, r) => { const y0 = 40 + r * RH; g.fillStyle = '#ffef9a'; g.fillText(gn + (K.GENRES[gn].cotg ? '  [CotG-compatible]' : ''), 10, y0 + 14);
  Object.values(K.GENRES[gn].palette).forEach((c, i) => { g.fillStyle = c; g.fillRect(300 + i * 14, y0 + 4, 12, 12); });
  let x = 10; for (const role of ['npc', 'creature']) { const spec = K.characterSpec(gn, role, 3); for (const v of spriteViews(spec)) { g.drawImage(v, x, y0 + 24, 150, 150); x += 152; }
    g.fillStyle = '#9cf'; g.fillText(role === 'npc' ? `${spec.parts.torso}, ${spec.genreGear.held}` : spec.name, x - 456, y0 + 196); x += 8; }
  for (const s of [...K.GENRES[gn].props, ...K.GENRES[gn].building].filter(K.has).slice(0, 5)) { const v = propView(s, gn); if (v) { g.drawImage(v, x, y0 + 44, 96, 96); g.fillStyle = '#ccc'; g.fillText(s.replace('g_', '').slice(0, 13), x, y0 + 160); x += 104; } } });
fs.writeFileSync(path.join(OUT, 'genre-kits-sheet.png'), sheet.toBuffer('image/png'));
const types = Object.entries(L.TYPES), ls = createCanvas(1100, 40 + types.length * 46), lg = ls.getContext('2d'); lg.fillStyle = '#000'; lg.fillRect(0, 0, ls.width, ls.height); lg.font = '13px monospace';
lg.fillStyle = '#fff'; lg.fillText('Genre light types: colour, intensity curve (8 s), radius x falloff, genres, prop', 10, 24);
types.forEach(([k, T], i) => { const y0 = 40 + i * 46; lg.fillStyle = T.color; lg.fillRect(10, y0 + 6, 28, 28); lg.fillStyle = '#fff'; lg.fillText(T.label + (T.cotg ? ' [CotG]' : ''), 46, y0 + 16); lg.fillStyle = '#9cf'; lg.fillText(`r ${T.radius} ${T.falloff}  ${T.genres.join(',')}  prop ${T.prop}`, 46, y0 + 34);
  const s = L.sample(k, .37, 8, 160); lg.fillStyle = T.color; s.forEach((v, j) => lg.fillRect(560 + j * 3, y0 + 40 - Math.round(v * 30), 3, 3)); });
fs.writeFileSync(path.join(OUT, 'genre-lights-sheet.png'), ls.toBuffer('image/png')); console.log(OUT);
