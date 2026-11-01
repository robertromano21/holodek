'use strict';
process.env.HOLODEK_GENRE_EXPANSION = '1'; process.env.HOLODEK_ARCHITECTURE_EXPANSION = '1';
const fs = require('node:fs'), path = require('node:path');
const { createCanvas, loadImage } = require('canvas'), K = require('../../assets/genreKits');
const directory = path.resolve('.retort-data/mode4-isolation');
async function main() {
  const { dungeon } = JSON.parse(fs.readFileSync(path.join(directory, 'repaired-room.json'), 'utf8'));
  const canvas = createCanvas(640, 440), ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const background = ctx.createLinearGradient(0, 0, 0, 440); background.addColorStop(0, '#101f30'); background.addColorStop(1, '#040b13');
  ctx.fillStyle = background; ctx.fillRect(0, 0, 640, 440);
  const project = (x, y, z) => [320 + (x - y) * 38, 160 + (x + y) * 18 - z * 38];
  function polygon(points, color) {
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }
  const floor = await loadImage(dungeon.tiles.floor.url), wall = await loadImage(dungeon.tiles.wall.url);
  function texture(image, a, b, c) {
    ctx.save(); ctx.transform((b[0] - a[0]) / image.width, (b[1] - a[1]) / image.width,
      (c[0] - a[0]) / image.height, (c[1] - a[1]) / image.height, ...a);
    ctx.drawImage(image, 0, 0); ctx.restore();
  }
  polygon([[90, 380], [320, 270], [550, 380], [320, 434]], '#03090f');
  for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++)
    texture(floor, project(x, y, 0), project(x + 1, y, 0), project(x, y + 1, 0));
  for (let i = 0; i < 6; i++) {
    texture(wall, project(i, 0, 2.6), project(i + 1, 0, 2.6), project(i, 0, 0));
    texture(wall, project(0, i + 1, 2.6), project(0, i, 2.6), project(0, i + 1, 0));
  }
  const faces = [];
  function instance(shape, pos, size, n = 16) {
    const voxels = K.build(shape, n);
    if (!voxels) throw Error('Unknown preview asset ' + shape);
    const at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n && voxels[x + y * n + z * n * n];
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!at(x, y, z)) continue;
      for (const [axis, normal] of [[0, [1, 0, 0]], [1, [0, 1, 0]], [2, [0, 0, 1]]]) {
        if (at(x + normal[0], y + normal[1], z + normal[2])) continue;
        const u = (axis + 1) % 3, v = (axis + 2) % 3, lo = [x, y, z], points = [];
        for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          const p = [...lo]; p[axis]++; p[u] += a; p[v] += b;
          points.push(p.map((t, i) => pos[i] + t / n * size[i]));
        }
        const color = K.color(shape, (x + .5) / n, (y + .5) / n, (z + .5) / n, normal);
        const center = points.reduce((a, p) => a.map((t, i) => t + p[i] / 4), [0, 0, 0]);
        faces.push({ depth: center[0] + center[1] + center[2] * .65, points: points.map(p => project(...p)),
          color: '#' + color.map(t => Math.max(0, Math.min(255, Math.round(t * 255))).toString(16).padStart(2, '0')).join('') });
      }
    }
  }
  for (const x of [.1, 2.8, 5.5]) instance('g_sci-fi_support', [x, .05, 0], [.35, .5, 2.6]);
  instance('g_sci-fi_beam', [.1, .1, 2.45], [5.7, .4, .25]);
  instance('g_airlock_frame', [3.2, .12, 0], [1.7, .65, 2.4]);
  instance('f_sci-fi_light', [1.2, .3, 1.9], [1.25, .35, .5]);
  instance('f_sci-fi_light', [.28, 2.9, 1.9], [.5, 1.25, .5]);
  instance('f_sci-fi_workstation', [.5, 1.1, 0], [1.3, 1.2, 1.2]);
  instance('g_pipe_cluster', [.2, 4.15, 0], [.8, .8, 2.1]);
  instance('f_sci-fi_storage', [4.5, 3.2, 0], [1, 1, 1.3]);
  instance('f_sci-fi_device', [2.3, 2.2, 0], [1.25, 1.25, 1.4]);
  for (const face of faces.sort((a, b) => a.depth - b.depth)) polygon(face.points, face.color);
  ctx.font = 'bold 14px monospace'; ctx.fillStyle = '#d5e9fa'; ctx.fillText('STATION NACRE / PROCEDURAL ASSET PREVIEW', 20, 24);
  ctx.font = '10px monospace'; ctx.fillStyle = '#89a8bf'; ctx.fillText('Actual metal tiles, pressure frames, consoles and electrical fixtures', 20, 41);
  ctx.fillText('Cutaway asset composition, not a live gameplay screenshot', 20, 425);
  const output = createCanvas(1280, 880), target = output.getContext('2d'); target.imageSmoothingEnabled = false;
  target.drawImage(canvas, 0, 0, 1280, 880);
  const file = path.join(directory, 'station-preview.png'); fs.writeFileSync(file, output.toBuffer('image/png')); console.log(file);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
