'use strict';
// world1 GENRE_ARCH: genre building styles, blends, room shapes, garb, startup retry. Pure/local.
process.env.HOLODEK_GENRE_KITS = '1'; process.env.HOLODEK_GENRE_ARCH = '1';
const test = require('node:test'), assert = require('assert');
const A = require('../assets/genreArchitecture'), T = require('../assets/renderSceneTextures'), Flags = require('../retort/worldFlags'), IB = require('../retort/indoorBlueprint');
const MIX = [{ genre: 'western', weight: .67 }, { genre: 'cosmic-horror', weight: .33 }];
const GENRES = ['fantasy', 'dark-fantasy', 'sci-fi', 'cyberpunk', 'post-apocalyptic', 'steampunk', 'western', 'modern', 'cosmic-horror', 'nautical', 'mythic', 'noir'];
test('flag GENRE_ARCH is on by default like the other world1 flags', () => { assert.strictEqual(Flags.DEFAULTS.GENRE_ARCH, true); });
test('all 12 genres have a style; fantasy-family keeps the Ruined Temple stone kit (null = no override)', () => {
  for (const g of GENRES) assert.ok(A.STYLES[g], g);
  assert.strictEqual(A.style([{ genre: 'fantasy', weight: 1 }], { name: 'Ruined Temple' }), null);
  assert.strictEqual(A.style([{ genre: 'dark-fantasy', weight: .6 }, { genre: 'fantasy', weight: .4 }], { name: 'Crypt' }), null);
  for (const g of GENRES.filter(g => !A.STYLES[g].keep)) { const s = A.style([{ genre: g, weight: 1 }], { name: 'Hall', seed: g }); assert.ok(s && T.hasMaterial('wall', s.wall) && T.hasMaterial('floor', s.floor), g); }
});
test('new materials are added under new names only; existing tables untouched', () => {
  for (const k of ['stone', 'brick', 'wood', 'metal', 'marble', 'obsidian']) assert.ok(!A.WALL[k] && !A.FLOOR[k], k);
  for (const k of Object.keys(A.WALL)) assert.ok(T.hasMaterial('wall', k), k); for (const k of Object.keys(A.FLOOR)) assert.ok(T.hasMaterial('floor', k), k);
});
test('Juniper Flats blend: frontier frame, horror grows near mine/church and with depth, corrupts deep down', () => {
  const st = n => A.style(MIX, { name: n[0], z: n[1], seed: 'j' });
  const street = st(['Juniper Flats Main Street', 0]), church = st(['Old Church', 0]), mine = st(['Copper Mine', 0]), deep = st(['Copper Mine Shaft', -3]);
  assert.deepStrictEqual([street.wall, street.floor, street.shape], ['clapboard', 'dirt_street', 'main_street']);
  assert.strictEqual(church.wall, 'timber_frame'); assert.strictEqual(church.shape, 'church_nave'); assert.strictEqual(mine.wall, 'pit_prop');
  assert.ok(street.horror < church.horror && church.horror <= mine.horror && mine.horror < deep.horror);
  assert.ok(!street.corrupt && deep.corrupt && deep.wall === 'polyp_prop' && deep.floor === 'ichor_floor');
});
test('textures paint through drawSceneSurface with window/trim/taint', () => {
  const { createCanvas } = require('canvas'); for (const [k, m] of [['wall', 'clapboard'], ['floor', 'dirt_street'], ['wall', 'door_plank']]) { const c = createCanvas(64, 64);
    assert.strictEqual(T.drawSceneSurface(c.getContext('2d'), createCanvas, k, { material: m, genreArch: { window: 'sash', trim: 'cornice', taint: .5 } }), m); }
});
test('room shapes run through the existing IndoorBlueprint.build and stay connected', () => {
  for (const shape of ['main_street', 'storefront', 'church_nave', 'mine_tunnel', 'corridor_grid', 'ship_deck', 'shanty_ring', 'temple_court']) {
    const d = { layout: { width: 64, height: 64 }, cells: {}, start: { x: 32, y: 32 }, generation: { seed: 's' + shape } }; IB.build(d, A.roomPlan(shape, 's'), { floor: 0, ceil: 4 });
    assert.ok(Object.values(d.cells).filter(c => c.tile === 'floor').length > 100, shape); }
});
test('street plans and garb exist; garb never drawn for fantasy-only mixes', () => {
  assert.ok(A.streetPlan('main_street', 'x').rows.join('').includes('='));
  assert.strictEqual(A.garbFor([{ genre: 'fantasy', weight: 1 }], 'a'), null); assert.ok(A.garbFor(MIX, 'wren'));
});
test('no real-world names in style labels (IP lint)', () => { const s = JSON.stringify([A.STYLES, A.GARB, A.STREETS]); assert.ok(!/mortacia|suzerain|tobin|velyra|lovecraft|cthulhu|tolkien|leone|eastwood/i.test(s)); });
test('startup: a timed-out poll is retried, not fatal', async () => {
  const { start } = require('../assets/characterStartup'); let polls = 0;
  const request = async url => { if (url === '/startGameWithCharacter') return { ok: true, json: async () => ({ taskId: 't' }) };
    if (++polls < 3) { const e = new Error('signal timed out'); e.name = 'TimeoutError'; throw e; } return { ok: true, json: async () => ({ status: 'complete', result: { updatedGameConsole: 'x' } }) }; };
  const r = await start({}, { request, pause: async () => {} }); assert.strictEqual(r.updatedGameConsole, 'x'); assert.strictEqual(polls, 3);
});
