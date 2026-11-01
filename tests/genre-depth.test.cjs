'use strict';
process.env.HOLODEK_GENRE_EXPANSION = '1'; process.env.HOLODEK_ARCHITECTURE_EXPANSION = '1';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { createCanvas } = require('canvas'), K = require('../assets/genreKits'), F = require('../assets/genreFurnishings');
const Ceilings = require('../assets/genreCeilings'), Stories = require('../retort/genreStoryPalette');
const Textures = require('../assets/renderSceneTextures'), Policy = require('../retort/genreAssetPolicy');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');

test('all 18 genres have distinct ceiling undersides in the actual roof renderer', () => {
  const images = new Set();
  for (const genre of Object.keys(K.GENRES)) {
    assert.ok(Ceilings.PROFILES[genre], genre);
    const a = createCanvas(128, 128), b = createCanvas(128, 128);
    Textures.drawRoofSurface(a.getContext('2d'), createCanvas, { genre, seed: 'same seed' });
    Textures.drawRoofSurface(b.getContext('2d'), createCanvas, { genre, seed: 'same seed' });
    assert.equal(hash(a.toBuffer()), hash(b.toBuffer()), genre + ' deterministic');
    images.add(hash(a.toBuffer()));
  }
  assert.equal(images.size, 18);
  assert.equal(Ceilings.PROFILES['sci-fi'].material, 'metal');
  assert.equal(Ceilings.PROFILES.western.pattern, 'rafters');
  assert.equal(Ceilings.PROFILES.nautical.pattern, 'hull');
});

test('every genre exposes daily-life furnishings and architecture through approved model enums', () => {
  assert.equal(Object.keys(F.SHAPES).length, 18 * 26);
  for (const genre of Object.keys(K.GENRES)) {
    const setting = { kind: 'homebrew', seed: 'test', genres: [genre] }, catalog = Policy.catalog({}, setting);
    for (const role of ['sleeping', 'food', 'medical', 'communication', 'research', 'craft',...F.DETAIL_ROLES]) {
      const id = `f_${genre}_${role}`;
      assert.ok(catalog.shapes.includes(id), id); assert.ok(K.build(id, 16).some(Boolean), id);
      assert.ok(F.SHAPES[id].label.length > 8, id);
    }
    for (const role of ['window', 'doorframe', 'canopy', 'trim', 'roof_panel']) {
      const id = `g_${genre}_${role}`;
      assert.ok(catalog.shapes.includes(id), id); assert.ok(K.build(id, 16).some(Boolean), id);
    }
  }
});

test('genre story guidance supports original situations and blends without canned quests or foreign lore', () => {
  const directions = new Set();
  for (const genre of Object.keys(K.GENRES)) {
    const text = Stories.direction({ genres: [genre] }); directions.add(text);
    assert.match(text, /not a stock genre plot/); assert.match(text, /Contrast recent room scenarios/);
    assert.doesNotMatch(text, /\b(?:Mortacia|Sepulchra|Tartarus|Arithus|Hades)\b/);
  }
  assert.equal(directions.size, 18);
  const blend = Stories.direction({ genres: ['western', 'cosmic-horror'] });
  assert.match(blend, /"western"/); assert.match(blend, /"cosmic-horror"/);
  assert.equal(Stories.direction(null), '');
});
