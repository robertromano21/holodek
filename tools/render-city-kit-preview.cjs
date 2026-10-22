// Renders review PNGs of the world1 city voxel kit: a sheet of every kit piece, palette swatches, and one sample district.
// Isometric preview with the kit's own colours and a fixed sun (top/left/right face shading plus a ground shadow).
'use strict';
const { createCanvas } = require('canvas');
const fs = require('node:fs'), path = require('node:path');
const Kit = require('../assets/cityKit');
const out = process.argv[2] || path.join(__dirname, '..', 'city-kit-preview');
fs.mkdirSync(out, { recursive: true });
const C30 = Math.cos(Math.PI / 6), S30 = .5;
function drawProp(ctx, shape, { ox, oy, k, w = 1, d = 1, h = 1, res = 16, palette, guild, city, seed = 'p' }) {
  const g = Kit.build(shape, res, seed), at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < res && y < res && z < res && g[x + y * res + z * res * res];
  const sx = w / res, sy = d / res, sz = h / res, faces = [];
  for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) if (at(x, y, z)) {
    const X = x * sx, Y = y * sy, Z = z * sz, col = n => Kit.color(shape, (x + .5) / res, (y + .5) / res, (z + .5) / res, n, [.5, .5, .5], 'stone', { palette, guild, city });
    if (!at(x, y, z + 1)) faces.push({ o: X + Y + Z + 3, t: 1, X, Y, Z: Z + sz, c: col([0, 0, 1]) });
    if (!at(x, y + 1, z)) faces.push({ o: X + Y + Z + 2, t: .78, X, Y: Y + sy, Z, c: col([0, 1, 0]), f: 'y' });
    if (!at(x + 1, y, z)) faces.push({ o: X + Y + Z + 2, t: .62, X: X + sx, Y, Z, c: col([1, 0, 0]), f: 'x' });
  }
  faces.sort((a, b) => a.o - b.o);
  const P = (X, Y, Z) => [ox + (X - Y) * C30 * k, oy + (X + Y) * S30 * k - Z * k];
  for (const f of faces) {
    const pts = f.f === 'y' ? [[f.X, f.Y, f.Z], [f.X + sx, f.Y, f.Z], [f.X + sx, f.Y, f.Z + sz], [f.X, f.Y, f.Z + sz]]
      : f.f === 'x' ? [[f.X, f.Y, f.Z], [f.X, f.Y + sy, f.Z], [f.X, f.Y + sy, f.Z + sz], [f.X, f.Y, f.Z + sz]]
      : [[f.X, f.Y, f.Z], [f.X + sx, f.Y, f.Z], [f.X + sx, f.Y + sy, f.Z], [f.X, f.Y + sy, f.Z]];
    ctx.beginPath(); pts.map(p => P(...p)).forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.closePath();
    const [r, gg, b] = f.c.map(v => Math.round(Math.min(1, v * f.t) * 255)); ctx.fillStyle = `rgb(${r},${gg},${b})`; ctx.fill();
  }
}
function shadow(ctx, ox, oy, k, w, d, h) { // soft sun shadow cast toward +x+y
  const P = (X, Y) => [ox + (X - Y) * C30 * k, oy + (X + Y) * S30 * k];
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); [[0, 0], [w, 0], [w + h * .5, d + h * .5], [h * .5, d + h * .5], [0, d]].map(p => P(...p)).forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.fill();
}
// 1) kit sheet
const cols = 8, cell = 190, rows = Math.ceil(Kit.SHAPES.length / cols);
let cv = createCanvas(cols * cell, rows * cell + 30), ctx = cv.getContext('2d');
ctx.fillStyle = '#20232a'; ctx.fillRect(0, 0, cv.width, cv.height);
ctx.fillStyle = '#e8e2d0'; ctx.font = 'bold 16px sans-serif'; ctx.fillText(`world1 city voxel kit - ${Kit.SHAPES.length} pieces (palettes rotate per row)`, 10, 20);
const pal = Object.keys(Kit.PALETTES);
Kit.SHAPES.forEach((shape, i) => {
  const s = Kit.SPECS[shape], cx = (i % cols) * cell + cell / 2, cy = 30 + Math.floor(i / cols) * cell + cell * .62;
  const [w, d] = s.footprint, h = s.height, k = 64 / Math.max(w, d, h * .9);
  shadow(ctx, cx, cy - (w + d) * S30 * k / 2, k, w, d, h);
  drawProp(ctx, `${shape}__v${Kit.variants(shape)[i % Kit.variants(shape).length]}`, { ox: cx, oy: cy - (w + d) * S30 * k / 2, k, w, d, h, res: 16, palette: pal[Math.floor(i / cols) % pal.length], guild: 'glassblowers' });
  ctx.fillStyle = '#e8e2d0'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(shape, cx, 30 + Math.floor(i / cols) * cell + cell - 10); ctx.textAlign = 'left';
});
fs.writeFileSync(path.join(out, 'city-kit-sheet.png'), cv.toBuffer('image/png'));
// 2) palettes: the same five pieces in each city palette
const sample = ['city_townhouse', 'guild_hall', 'fountain_tiered', 'aqueduct_arch', 'lamp_post'];
cv = createCanvas(sample.length * 170, pal.length * 170 + 30); ctx = cv.getContext('2d'); ctx.fillStyle = '#20232a'; ctx.fillRect(0, 0, cv.width, cv.height);
ctx.fillStyle = '#e8e2d0'; ctx.font = 'bold 16px sans-serif'; ctx.fillText('per-city palettes: marble / sandstone / basalt / bronze', 10, 20);
pal.forEach((p, r) => sample.forEach((shape, c) => { const s = Kit.SPECS[shape], [w, d] = s.footprint, k = 56 / Math.max(w, d, s.height * .9), cx = c * 170 + 85, cy = 30 + r * 170 + 60;
  drawProp(ctx, `${shape}__v${Kit.variants(shape)[r % Kit.variants(shape).length]}`, { ox: cx, oy: cy, k, w, d, h: s.height, res: 16, palette: p, guild: 'smiths' }); if (c === 0) { ctx.fillStyle = '#e8e2d0'; ctx.font = '13px sans-serif'; ctx.fillText(p, 8, 30 + r * 170 + 160); } }));
fs.writeFileSync(path.join(out, 'city-kit-palettes.png'), cv.toBuffer('image/png'));
// 3) sample district: a 40x28 city room planned by CityKit.planCity
const W = 40, H = 28, cells = {};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0 };
const city = { id: 'preview-city', name: 'Salt Forum City', role: 'test', districts: ['forum', 'market ward', 'guild quarter', 'harbor ward', 'tenements'],
  guilds: ['smiths', 'scribes', 'glassblowers'], utilities: ['aqueduct', 'cistern', 'public fountains', 'harbor', 'bathhouse'], population: 9000 };
const plan = Kit.planCity({ cells, width: W, height: H, city, seed: 'preview' });
const k = 22; cv = createCanvas(Math.ceil((W + H) * C30 * k) + 80, Math.ceil((W + H) * S30 * k) + 240); ctx = cv.getContext('2d');
ctx.fillStyle = '#20232a'; ctx.fillRect(0, 0, cv.width, cv.height);
const ox = H * C30 * k + 40, oy = 200, P = (X, Y) => [ox + (X - Y) * C30 * k, oy + (X + Y) * S30 * k];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { ctx.fillStyle = (x + y) % 2 ? '#6d6656' : '#736b5b'; ctx.beginPath(); [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(p => P(...p)).forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.fill(); }
const sorted = plan.placements.slice().sort((a, b) => (a.ground ? -1 : 0) - (b.ground ? -1 : 0) || (a.x + a.y + a.footprint[0] + a.footprint[1]) - (b.x + b.y + b.footprint[0] + b.footprint[1]));
for (const p of sorted) if (!p.ground) shadow(ctx, ...P(p.x, p.y), k, p.footprint[0], p.footprint[1], p.height * .6);
for (const p of sorted) { const [px, py] = P(p.x, p.y); drawProp(ctx, p.tileShape, { ox: px, oy: py, k, w: p.footprint[0], d: p.footprint[1], h: p.height, res: p.detail ? 8 : 12, palette: p.palette, guild: p.guild, city }); }
ctx.fillStyle = '#e8e2d0'; ctx.font = 'bold 16px sans-serif';
ctx.fillText(`sample district: ${city.name} (${plan.palette}) - ${plan.placements.length} parts, ${plan.instancedTiles} shared tiles; districts: ${city.districts.join(', ')}`, 12, 22);
fs.writeFileSync(path.join(out, 'city-sample-district.png'), cv.toBuffer('image/png'));
console.log(JSON.stringify({ out, parts: plan.placements.length, tiles: plan.instancedTiles, counts: plan.counts }));
