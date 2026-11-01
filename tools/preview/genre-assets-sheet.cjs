'use strict';
process.env.HOLODEK_GENRE_EXPANSION = '1';
process.env.HOLODEK_ARCHITECTURE_EXPANSION = '1';
const fs = require('node:fs'), path = require('node:path');
const { createCanvas } = require('canvas');
const K = require('../../assets/genreKits');
const genres = Object.keys(K.GENRES), width = 1024, rowHeight = 126;
const canvas = createCanvas(width, rowHeight * genres.length), ctx = canvas.getContext('2d');
ctx.fillStyle = '#111b22'; ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.imageSmoothingEnabled = false;
for (const [row, genre] of genres.entries()) {
  const y = row * rowHeight;
  ctx.fillStyle = row % 2 ? '#19242c' : '#111b22'; ctx.fillRect(0, y, width, rowHeight);
  ctx.font = '15px monospace'; ctx.fillStyle = '#e8deca'; ctx.fillText(genre, 12, y + 26);
  const shapes = [`x_${genre}_hall`, `g_${genre}_support`, `f_${genre}_storage`, `f_${genre}_workstation`,
    `f_${genre}_light`, `f_${genre}_transport`, `f_${genre}_device`];
  for (const [column, shape] of shapes.entries()) {
    const x = 174 + column * 120;
    K.paint(ctx, shape, x, y + 5, 108, 94);
    ctx.font = '10px monospace'; ctx.fillStyle = '#b5c6ce';
    ctx.fillText(shape.split('_').at(-1), x + 8, y + 116);
  }
}
const directory = path.resolve('.retort-data/genre-assets'); fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, 'genre-assets.png'); fs.writeFileSync(file, canvas.toBuffer('image/png'));
console.log(JSON.stringify({ file, genres: genres.length, shapes: genres.length * 7 }));
