// world1 previews: interlocking ornament fields, moldings per theme, pyramids, and room pictures before/after.
'use strict';
const { createCanvas } = require('canvas');
const fs = require('node:fs'), path = require('node:path');
const out = process.argv[2] || path.join(__dirname, '..', 'ornament-preview');
fs.mkdirSync(out, { recursive: true });
const C = require('../assets/designCatalog'), Carvings = require('../assets/stoneCarvings'), Voxels = require('../assets/scenePropVoxels');
const pal = { highlight: '#e9dcb8', shadow: '#4a3d2f', secondary: '#b59c7a', primary: '#cdb894' };
const label = (ctx, t, x, y, c = '#e8dcc0') => { ctx.fillStyle = c; ctx.font = '11px monospace'; ctx.fillText(t, x, y); };
// 1. Ornament sheet: each motif painted as THREE adjacent wall modules (world-continuous) to show seams joining.
{
  const cols = 3, cellW = 3 * 96, cellH = 64, gap = 22, rows = Math.ceil(C.ORNAMENTS.length / cols);
  const c = createCanvas(cols * (cellW + 16) + 16, rows * (cellH + gap) + 40), ctx = c.getContext('2d');
  ctx.fillStyle = '#17130f'; ctx.fillRect(0, 0, c.width, c.height); label(ctx, 'world1 ornament fields: 3 adjacent modules each (seams join)', 16, 18);
  C.ORNAMENTS.forEach((name, i) => {
    const ox = 16 + (i % cols) * (cellW + 16), oy = 36 + Math.floor(i / cols) * (cellH + gap);
    for (let m = 0; m < 3; m++) {
      const tile = createCanvas(96, 64), t = tile.getContext('2d'); t.fillStyle = pal.primary; t.fillRect(0, 0, 96, 64);
      C.paintBand(t, { carvingStyle: name, stoneworkRole: 'dado', axis: 'y', size: { x: 1, y: .02, z: .6 }, position: { x: m, y: 0, z: 0 } }, pal);
      ctx.drawImage(tile, ox + m * 96, oy);
    }
    label(ctx, `${name} (${C.TRADITION[name]})`, ox, oy + cellH + 13);
  });
  fs.writeFileSync(path.join(out, 'ornament-fields.png'), c.toBuffer());
}
// 2. Interlocking weaves: big sprawling fields combining two motifs.
{
  const pairs = [['meander_field', 'assyrian_rosettes'], ['girih_stars', 'arabesque_vine'], ['step_fret', 'stepped_terrace'], ['tracery_field', 'quatrefoil_field'],
    ['lotus_scroll', 'cloud_scroll'], ['coffer_grid', 'rinceau_scroll'], ['knot_lattice', 'chain_links'], ['hex_star_tile', 'diamond_lozenge']];
  const W = 300, H = 150, c = createCanvas(16 + 4 * (W + 16), 40 + 2 * 4 * (H + 22) / 2 + 200), ctx = c.getContext('2d');
  c.height = 40 + 8 * (H + 22); ctx.fillStyle = '#17130f'; ctx.fillRect(0, 0, c.width, c.height); label(ctx, 'interlocking weaves: single / overlay / strapwork / nested', 16, 18);
  pairs.forEach(([a, b], r) => C.WEAVES.forEach((weave, k) => {
    const ox = 16 + k * (W + 16), oy = 34 + r * (H + 22);
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = C.field(a, x, y, 20, b, weave), q = (y * W + x) * 4, col = v === 2 ? [233, 220, 184] : v === 1 ? [74, 61, 47] : [190, 170, 140]; img.data.set([...col, 255], q); }
    ctx.putImageData(img, ox, oy); label(ctx, `${a} + ${b} [${weave}]`, ox, oy + H + 13);
  }));
  fs.writeFileSync(path.join(out, 'ornament-weaves.png'), c.toBuffer());
}
// 3. Moldings: per theme, a wall elevation with cornice, dado and baseboard, plus an arch surround.
{
  const themes = Object.keys(C.THEMES), W = 300, H = 220, c = createCanvas(16 + 3 * (W + 16), 40 + Math.ceil(themes.length / 3) * (H + 24)), ctx = c.getContext('2d');
  ctx.fillStyle = '#17130f'; ctx.fillRect(0, 0, c.width, c.height); label(ctx, 'molding system by theme: cornice / dado / baseboard / gate surround', 16, 18);
  themes.forEach((name, i) => {
    const th = C.THEMES[name], colors = C.PALETTES[th.palette], ox = 16 + (i % 3) * (W + 16), oy = 34 + Math.floor(i / 3) * (H + 24);
    const p = { primary: colors[0], secondary: colors[1], shadow: colors[3], highlight: colors[4] };
    ctx.fillStyle = colors[0]; ctx.fillRect(ox, oy, W, H);
    const course = (role, y, h, motif) => { for (let m = 0; m < 3; m++) { const t = createCanvas(96, 64), g = t.getContext('2d'); g.fillStyle = p.primary; g.fillRect(0, 0, 96, 64);
      C.paintBand(g, { carvingStyle: motif, ornamentSecond: th.ornaments[1], ornamentWeave: 'strapwork', stoneworkRole: role, axis: 'y', size: { x: 1, y: .02, z: .5 }, position: { x: m, y: 0, z: 0 } }, p);
      ctx.drawImage(t, ox + m * 100, oy + y, 100, h); } };
    course('cornice', 0, 34, th.ornaments[0]); course('dado', 96, 40, th.ornaments[0]); course('baseboard', H - 26, 26, th.ornaments[0]);
    // gate surround: vertical jambs + lintel at surround scale
    const t = createCanvas(96, 64), g = t.getContext('2d'); g.fillStyle = p.primary; g.fillRect(0, 0, 96, 64);
    C.paintBand(g, { carvingStyle: th.ornaments[2 % th.ornaments.length], stoneworkRole: 'surround', axis: 'y', size: { x: 1, y: .02, z: .3 }, position: { x: 0, y: 0, z: 0 } }, p);
    ctx.fillStyle = '#0c0a08'; ctx.fillRect(ox + 120, oy + 60, 60, H - 86);
    ctx.drawImage(t, ox + 108, oy + 48, 84, 14);
    ctx.save(); ctx.translate(ox + 120, oy + 62); ctx.rotate(Math.PI / 2); ctx.drawImage(t, 0, 0, H - 88, 12); ctx.restore();
    ctx.save(); ctx.translate(ox + 192, oy + 62); ctx.rotate(Math.PI / 2); ctx.drawImage(t, 0, 0, H - 88, 12); ctx.restore();
    label(ctx, `${name}: ${th.ornaments[0]} (${th.palette})`, ox, oy + H + 13);
  });
  fs.writeFileSync(path.join(out, 'moldings-by-theme.png'), c.toBuffer());
}
// 4. Pyramids: isometric voxel previews.
{
  const C30 = Math.cos(Math.PI / 6), S30 = .5, res = 32, k = 150, c = createCanvas(4 * 260 + 20, 300), ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 300); sky.addColorStop(0, '#f2d34a'); sky.addColorStop(1, '#c78a3a'); ctx.fillStyle = sky; ctx.fillRect(0, 0, c.width, c.height);
  label(ctx, 'wasteland pyramids (voxel shapes): stepped / smooth / ruined / terraced ziggurat', 12, 18, '#2a1a0a');
  C.PYRAMIDS.forEach((shape, i) => {
    const g = Voxels.build(shape, res, 3), at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < res && y < res && z < res && g[x + y * res + z * res * res];
    const ox = 140 + i * 260, oy = 120, faces = [], s = 1 / res;
    for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) if (at(x, y, z)) {
      const X = x * s, Y = y * s, Z = z * s * .7, col = n => Voxels.color(shape, (x + .5) / res, (y + .5) / res, (z + .5) / res, n, [.5, .5, .5], 'stone', {});
      if (!at(x, y, z + 1)) faces.push({ o: X + Y + Z + 3, t: 1, X, Y, Z: Z + s * .7, c: col([0, 0, 1]) });
      if (!at(x, y + 1, z)) faces.push({ o: X + Y + Z + 2, t: .78, X, Y: Y + s, Z, c: col([0, 1, 0]), f: 'y' });
      if (!at(x + 1, y, z)) faces.push({ o: X + Y + Z + 2, t: .6, X: X + s, Y, Z, c: col([1, 0, 0]), f: 'x' });
    }
    faces.sort((a, b) => a.o - b.o);
    const P = (X, Y, Z) => [ox + (X - Y) * C30 * k, oy + (X + Y) * S30 * k - Z * k], h = s * .7;
    for (const f of faces) {
      const pts = f.f === 'y' ? [[f.X, f.Y, f.Z], [f.X + s, f.Y, f.Z], [f.X + s, f.Y, f.Z + h], [f.X, f.Y, f.Z + h]] : f.f === 'x' ? [[f.X, f.Y, f.Z], [f.X, f.Y + s, f.Z], [f.X, f.Y + s, f.Z + h], [f.X, f.Y, f.Z + h]] : [[f.X, f.Y, f.Z], [f.X + s, f.Y, f.Z], [f.X + s, f.Y + s, f.Z], [f.X, f.Y + s, f.Z]];
      ctx.beginPath(); pts.map(p => P(...p)).forEach(([a, b], j) => j ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.closePath();
      const [r, gg, b] = f.c.map(v => Math.round(Math.min(1, v * f.t) * 255)); ctx.fillStyle = `rgb(${r},${gg},${b})`; ctx.fill();
    }
    label(ctx, shape, ox - 60, 290, '#2a1a0a');
  });
  fs.writeFileSync(path.join(out, 'pyramids.png'), c.toBuffer());
}
module.exports = {};
