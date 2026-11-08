'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const W = require('../assets/genreWardrobe');
const A = require('../assets/genreArchitecture');

const COTG = { homebrew: false, genres: W.COTG };
const leaked = { hat: 'visor', coat: 'trench', belt: 'tool', genre: 'cyberpunk', wrong: 'eye' };

test('every wardrobe piece is genre-tagged with known genres and descriptive names only', () => {
  const known = new Set(['fantasy', 'dark-fantasy', 'mythic', 'desert-fantasy', 'gothic-horror', 'cosmic-horror', 'prehistoric', 'sci-fi', 'cyberpunk',
    'post-apocalyptic', 'steampunk', 'western', 'modern', 'nautical', 'noir', 'solarpunk', 'dieselpunk', 'underwater']);
  for (const p of Object.values(W.PIECES)) {
    if (p.genres === null) continue;
    assert.ok(Array.isArray(p.genres) && p.genres.length, `${p.slot}:${p.id} has genres`);
    for (const g of p.genres) assert.ok(known.has(g), `${p.slot}:${p.id} genre ${g}`);
    assert.ok(W.SLOTS.includes(p.slot));
  }
  assert.ok(!/mortacia|suzerain|lovecraft|cthulhu|tolkien/i.test(JSON.stringify(Object.keys(W.PIECES))));
});

test('the expansion adds many new pieces in every slot and for every supported genre', () => {
  const c = W.counts();
  assert.ok(c.hat >= 25 && c.coat >= 30 && c.cloak >= 8 && c.belt >= 8 && c.extra >= 25 && c.hair >= 6, JSON.stringify(c));
  const g = W.genreCounts();
  for (const genre of ['fantasy', 'dark-fantasy', 'mythic', 'sci-fi', 'cyberpunk', 'post-apocalyptic', 'steampunk', 'western', 'modern', 'nautical', 'noir', 'cosmic-horror'])
    assert.ok(g[genre] >= 6, `${genre}: ${g[genre]}`);
  assert.ok(Object.values(W.PIECES).filter(p => p.spirit).length >= 10, 'spirit / undead / ethereal variants exist');
});

test('the built-in campaign never shows science-fiction or other out-of-genre garb', () => {
  assert.equal(W.sanitizeGarb(leaked, COTG), null);
  for (const genre of ['sci-fi', 'cyberpunk', 'noir', 'western', 'modern', 'steampunk', 'post-apocalyptic'])
    for (const outfit of [...(A.GARB[genre] || []), ...W.outfitsFor(genre)]) assert.equal(W.sanitizeGarb({ ...outfit, genre }, COTG), null, `${genre} ${JSON.stringify(outfit)}`);
  // A fantasy garb that somehow carries a trench coat loses the coat but keeps its fantasy pieces.
  const mixed = W.sanitizeGarb({ genre: 'fantasy', hat: 'circlet', coat: 'trench', belt: 'rope_belt' }, COTG);
  assert.deepEqual(mixed, { genre: 'fantasy', hat: 'circlet', belt: 'rope_belt' });
  for (const genre of W.COTG) for (const outfit of [...W.outfitsFor(genre), ...W.spiritOutfitsFor(genre)]) {
    const clean = W.sanitizeGarb(outfit, COTG);
    assert.ok(clean, `${genre} outfit survives`);
    for (const slot of W.SLOTS) if (clean[slot]) assert.ok(W.tagsOf(slot, clean[slot]) === null || W.tagsOf(slot, clean[slot]).includes(genre));
  }
});

test('homebrew worlds keep their own genre garb and drop pieces from genres the world does not use', () => {
  const world = { homebrew: true, genres: ['cyberpunk'] };
  assert.deepEqual(W.sanitizeGarb(leaked, world), leaked);
  assert.equal(W.sanitizeGarb({ hat: 'tricorn', coat: 'greatcoat', genre: 'nautical' }, world), null);
  assert.deepEqual(W.sanitizeGarb({ genre: 'cyberpunk', hat: 'glow_visor', coat: 'chainmail' }, world), { genre: 'cyberpunk', hat: 'glow_visor' });
  // Unknown world (tools/tests): pieces must still belong to the garb's own genre.
  assert.deepEqual(W.sanitizeGarb({ genre: 'fantasy', hat: 'visor', coat: 'tabard' }), { genre: 'fantasy', coat: 'tabard' });
});

test('drawGarb refuses out-of-genre garb for the current world and draws every new piece without errors', () => {
  const grid = 24, cells = new Map();
  const body = (x, y) => x >= 9 && x <= 14 && y >= 3 && y <= 21;
  const k = world => ({ grid, filled: body, rect: (x, y, w, h, c) => cells.set(`${x},${y}`, c), world });
  assert.equal(A.drawGarb(k(COTG), leaked, {}), false);
  assert.equal(cells.size, 0);
  for (const p of Object.values(W.PIECES)) {
    if (!p.draw) continue;
    const genre = p.genres[0], before = cells.size;
    const drawn = A.drawGarb(k({ homebrew: true, genres: [genre] }), { genre, [p.slot]: p.id }, { glow: '#a8d8ff', hair: '#302b31' });
    assert.equal(drawn, true, `${p.slot}:${p.id}`);
    assert.ok(cells.size >= before);
  }
  assert.ok(cells.size > 0);
});

test('spirit bodies in a world with garb get spirit or undead variants', () => {
  for (const genre of ['dark-fantasy', 'gothic-horror', 'fantasy']) {
    const list = W.spiritOutfitsFor(genre);
    assert.ok(list.length >= 2, genre);
    for (const o of list) assert.ok(W.piece('coat', o.coat).spirit);
  }
  const cosmic = A.garbFor([{ genre: 'cosmic-horror', weight: 1 }], 'Orren Vale', 'spectral');
  assert.ok(cosmic && cosmic.genre === 'cosmic-horror');
});

test('the trait cache strips stored garb on load and restore, and the built-in campaign stamps none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-wardrobe-'));
  const file = path.join(dir, 'character-traits.json');
  const traits = { v: 1, bodyPlan: 'spectral', outfit: { style: 'rags' }, palette: {}, genreGarb: leaked };
  fs.writeFileSync(file, JSON.stringify({ entries: { 'orren vale': { name: 'Orren Vale', traits, source: 'llm', salt: 1, variant: 0, sheet: { name: 'Orren Vale' } } } }));
  process.env.HOLODEK_TRAIT_CACHE = file;
  const T = require('../retort/characterTraitSpec');
  const out = T.getCachedTraitSpecs(['Orren Vale']);
  const entry = out['Orren Vale'];
  assert.ok(entry && entry.traits);
  assert.equal(entry.traits.genreGarb, undefined, 'no cyberpunk trench on a built-in campaign spirit');
  assert.equal(entry.traits.bodyPlan, 'spectral');
  T.restoreCachedTraitSpecs({ x: { name: 'Saved Spirit', source: 'llm', traits: { ...traits }, salt: 2, variant: 0, appearance: { name: 'Saved Spirit' } } });
  assert.equal(T.getCachedTraitSpecs(['Saved Spirit'])['Saved Spirit'].traits.genreGarb, undefined);
});

require('./sprite-expansion-cases.cjs')('wardrobe');
