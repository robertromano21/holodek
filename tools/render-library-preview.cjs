// world1 LIBRARY_BOOKS preview: shelf elevation with each book's own hit box (as used by the click/hover picker).
'use strict';
const { createCanvas } = require('canvas'); const fs = require('node:fs'), path = require('node:path');
const L = require('../assets/libraryBooks');
const out = process.argv[2] || path.join(__dirname, '..', 'library-preview'); fs.mkdirSync(out, { recursive: true });
const cells = {}; for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) cells[`${x},${y}`] = { tile: y === 0 ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 3 };
cells['1,0'] = cells['2,0'] = cells['3,0'] = null; for (const k of ['1,0', '2,0', '3,0']) cells[k] = { tile: 'custom_bookshelf', floorHeight: 0, structureHeight: 2 };
const d = { cells, tiles: { custom_bookshelf: { landmark: { type: 'bookshelf' } } } }, books = L.books(d);
const k = 180, c = createCanvas(3 * k + 60, 2.2 * k + 70), g = c.getContext('2d');
g.fillStyle = '#14100c'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#e8dcc0'; g.font = '12px monospace';
g.fillText(`library shelves: ${books.length} individually clickable books (hover = title, click = reader)`, 12, 18);
const X = x => 30 + (x - 1) * k, Z = z => 40 + (2.2 - z) * k;
for (const s of ['1,0', '2,0', '3,0']) { const x = Number(s.split(',')[0]); g.fillStyle = '#5a3a1e'; g.fillRect(X(x) + .08 * k, Z(2), .84 * k, 2 * k); }
const cols = ['#7a2020', '#204a7a', '#2a6a2a', '#7a6a20', '#5a2a6a', '#3a3a3a'];
books.forEach((b, i) => { g.fillStyle = cols[i % cols.length]; g.fillRect(X(b.position.x), Z(b.position.z + b.size.z), b.size.x * k, b.size.z * k);
  g.strokeStyle = i === 7 ? '#ffe070' : 'rgba(255,240,180,.45)'; g.lineWidth = i === 7 ? 2 : 1; g.strokeRect(X(b.position.x), Z(b.position.z + b.size.z), b.size.x * k, b.size.z * k); });
const hov = books[7]; g.fillStyle = 'rgba(20,14,8,.9)'; g.fillRect(X(hov.position.x) + 20, Z(hov.position.z + hov.size.z) - 30, 230, 22);
g.fillStyle = '#ffe9a8'; g.fillText(`${hov.name}: "The Ash Concordance" - Click to read`, X(hov.position.x) + 26, Z(hov.position.z + hov.size.z) - 15);
fs.writeFileSync(path.join(out, 'library-shelf-hitboxes.png'), c.toBuffer());
