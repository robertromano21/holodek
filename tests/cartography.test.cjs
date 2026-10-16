const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/dungeonCartography');
const I = require('../assets/dungeonInhabitants');
function dungeon(width = 40, height = width) {
  const d = { geoKey: '0,0,0', layout: { width, height }, cells: {}, roomExits: { markers: [] } };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0 };
  return d;
}

test('exploration objects use actual discovered items only, disappear on pickup and stay known offscreen', () => {
  const d = dungeon(), coin = { name: 'Amber coin', type: 'other', x: 22, y: 20 }, secret = { name: 'Unseen key', x: 30, y: 30 };
  d.sceneObjects = [coin, secret]; d.objectDiscoveries = { version: 1, names: ['amber coin'] };
  assert.deepEqual(C.knownObjects(d).map(m => m.label), ['Amber coin']);
  assert.equal(C.knownObjects(d)[0].item, coin);
  assert.deepEqual(C.knownObjects(d, [secret]), []);
  const saved = JSON.parse(JSON.stringify(d)); assert.equal(C.knownObjects(saved)[0].x, 22.5);
});

test('exploration hover names known icons and mapped terrain but never exposes an unexplored cell', () => {
  const d = dungeon(), state = C.createAtlas().get(d, 'run');
  C.reveal(state, d, { x: 20.5, y: 20.5 }, 6);
  assert.equal(C.hoverLabel(d, state, 21.5, 20.5), 'Floor');
  d.cells['21,20'].tile = 'wall'; assert.equal(C.hoverLabel(d, state, 21.5, 20.5), 'Wall');
  d.cells['35,35'].feature = 'secret_altar'; assert.equal(C.hoverLabel(d, state, 35.5, 35.5), 'Unexplored');
  const markers = [{ label: 'Vessa Reedwake', kind: 'encounter', x: 22.5, y: 20.5 }, { label: 'Amber coin', kind: 'object', x: 23.5, y: 20.5 }];
  assert.match(C.hoverLabel(d, state, 22.5, 20.5, markers, 1.1), /Vessa Reedwake \(last seen\).*Amber coin/);
});
test('map reveals only nearby actual tiles without modifying layout, geometry, objects or exits', async () => {
  const d = dungeon(), before = JSON.stringify(d), atlas = C.createAtlas(), state = atlas.get(d, 'game');
  const changed = atlas.reveal(state, d, { x: 20.5, y: 20.5 }, 6);
  assert.ok(changed.length > 70 && changed.length < 150);
  assert.ok(C.seen(state, 20 * 40 + 20));
  assert.equal(C.seen(state, 30 * 40 + 30), false);
  assert.deepEqual(atlas.reveal(state, d, { x: 20.6, y: 20.6 }, 6), []);
  assert.equal(JSON.stringify(d), before);
  assert.deepEqual(atlas.reveal(state, d, { x: NaN, y: 20 }), []);
  await state.ready;
});
test('opaque walls, torch masonry and closed doors stop discovery, and open doors reveal onward terrain', () => {
  for (const tile of ['wall', 'torch', 'door']) {
    const d = dungeon();
    for (let y = 0; y < 40; y++) d.cells[`22,${y}`] = { tile, door: { isOpen: false } };
    const atlas = C.createAtlas(), state = atlas.get(d, 'game');
    atlas.reveal(state, d, { x: 20.5, y: 20.5 }, 8);
    assert.ok(C.seen(state, 20 * 40 + 22), tile);
    assert.equal(C.seen(state, 20 * 40 + 23), false, tile);
    if (tile === 'door') {
      for (let y = 0; y < 40; y++) d.cells[`22,${y}`].door.isOpen = true;
      d._geometryStamp = 'opened';
      atlas.reveal(state, d, { x: 20.5, y: 20.5 }, 8);
      assert.ok(C.seen(state, 20 * 40 + 23));
    }
  }
});
test('closed diagonal corners cannot expose the room behind them', () => {
  const d = dungeon(); d.cells['21,20'].tile = 'wall'; d.cells['20,21'].tile = 'wall';
  assert.equal(C.visible(d, { x: 20.5, y: 20.5 }, 22, 22), false);
});
test('the exploration mask is compact, isolated by campaign/room, and stays valid across revisits', () => {
  const atlas = C.createAtlas(), d = dungeon(512), a = atlas.get(d, 'game-a');
  assert.equal(a.bits.length, 32768);
  atlas.reveal(a, d, { x: 256.5, y: 384.5 });
  assert.equal(atlas.get(d, 'game-a'), a);
  assert.equal(atlas.get(d, 'game-b').count, 0);
  d.geoKey = '1,0,0'; assert.equal(atlas.get(d, 'game-a').count, 0);
  d._meta = { runId: 'game-b' }; assert.equal(atlas.get(d, 'game-a'), null);
  assert.equal(atlas.get(d, null), null);
});
test('saved masks hydrate and merge safely with exploration that happens during the database read', async () => {
  let resolveLoad; const records = new Map(), d = dungeon(), saved = new Uint8Array(200);
  saved[0] = 1;
  const atlas = C.createAtlas({ load: () => new Promise(resolve => { resolveLoad = resolve; }), save: async (key, value) => records.set(key, value) });
  const state = atlas.get(d, 'game');
  await Promise.resolve();
  atlas.reveal(state, d, { x: 20.5, y: 20.5 }, 2);
  const current = state.count, flushing = atlas.flush(state);
  resolveLoad({ width: 40, height: 40, bits: saved });
  await flushing;
  assert.equal(state.count, current + 1);
  assert.ok(C.seen(state, 0)); assert.ok(C.seen(state, 20 * 40 + 20));
  assert.ok(records.get(state.key).bits[0] & 1);
  const reloaded = C.createAtlas({ load: async key => records.get(key) }).get(d, 'game');
  await reloaded.ready;
  assert.equal(reloaded.count, state.count);
});
test('bounded memory eviction flushes progress and malformed stored masks are ignored', async () => {
  const records = new Map(), atlas = C.createAtlas({ limit: 2, load: async () => ({ width: 40, height: 40, bits: [255] }), save: async (key, data) => records.set(key, data) });
  const states = [];
  for (let i = 0; i < 4; i++) {
    const d = dungeon(); d.geoKey = `${i},0,0`;
    const state = atlas.get(d, 'game'); states.push(state); atlas.reveal(state, d, { x: 20.5, y: 20.5 }, 2);
  }
  await Promise.all(states.map(s => s.ready)); await atlas.flushAll();
  assert.equal(atlas.size, 2);
  assert.equal(records.size, 4);
});
test('storage failures do not stop exploration or generate unhandled rejections', async () => {
  const errors = [], atlas = C.createAtlas({ load: async () => { throw new Error('unavailable'); },
    save: async () => { throw new Error('quota'); }, onError: error => errors.push(error.message) });
  const d = dungeon(), state = atlas.get(d, 'game');
  await state.ready; atlas.reveal(state, d, { x: 20.5, y: 20.5 }, 2); await atlas.flush(state);
  assert.ok(state.count); assert.deepEqual(errors, ['unavailable', 'quota']);
});
test('bearings use actual door positions rather than nominal exit labels, and rotate with the player', () => {
  const d = dungeon(); d.roomExits.markers = [
    { direction: 'west', label: 'W', x: 30, y: 20 }, { direction: 'up', label: 'UP', x: 20, y: 10 } ];
  const player = { x: 20.5, y: 20.5 };
  const northFacing = C.bearings(d, player, -Math.PI / 2);
  const west = northFacing.find(e => e.direction === 'west');
  assert.equal(west.distance, 10); assert.ok(Math.abs(west.ringX - 1) < 1e-6);
  assert.ok(Math.abs(northFacing.find(e => e.direction === 'up').ringY + 1) < 1e-6);
  assert.ok(Math.abs(C.bearings(d, player, 0).find(e => e.direction === 'west').ringY + 1) < 1e-6);
  assert.deepEqual(C.bearings(d, { x: NaN, y: 1 }), []);
});

test('unseen encounter hints show saved remote sites without names, allegiances or revealed terrain', () => {
  const d = dungeon(64), p = I.createPopulation(d.geoKey, [{ name: 'Secret Guard', allegiance: 'Hostile' }, { name: 'Secret Mason', allegiance: 'Neutral' }]);
  p.actors['Secret Guard'].position = { x: 58, y: 58 }; p.actors['Secret Mason'].position = { x: 48, y: 48 };
  const atlas = C.createAtlas(), state = atlas.get(d, 'game'); atlas.reveal(state, d, { x: 5.5, y: 5.5 });
  const before = JSON.stringify({ d, p, bits: [...state.bits], count: state.count });
  const markers = C.encounters(d, p);
  assert.equal(markers.length, 2); assert.equal(markers[0].x, 58.5);
  assert.ok(markers.every(m => m.glyph === '?' && m.allegiance === null && !m.label.includes('Secret')));
  assert.equal(JSON.stringify({ d, p, bits: [...state.bits], count: state.count }), before);
  assert.equal(C.seen(state, 58 * 64 + 58), false);
});

test('encounter pins use current individual positions and remove exhausted, dead, departed and recruited residents', () => {
  const d = dungeon(64), names = ['Moving', 'Dead', 'Departed', 'Recruited', 'Party', 'Exhausted'];
  const p = I.createPopulation(d.geoKey, names.map(name => ({ name, allegiance: 'Neutral' })));
  for (const a of Object.values(p.actors)) a.position = { x: 40, y: 40 };
  p.actors.Dead.hp = 0; p.actors.Departed.status = 'departed'; p.actors.Recruited.status = 'recruited';
  p.groups.find(g => g.members.includes('Exhausted')).status = 'exhausted';
  const moving = { name: 'Moving', type: 'monster', hp: 10, mazeRoomKey: 'X: 0, Y: 0, Z: 0', mazeX: 25, mazeY: 26 };
  const roster = [moving, { name: 'Party', type: 'npc', hp: 10 }];
  const markers = C.encounters(d, p, roster);
  assert.equal(markers.length, 1); assert.equal(markers[0].x, 25.5); assert.equal(markers[0].y, 26.5);
  moving.hp = 0; assert.deepEqual(C.encounters(d, p, roster), []);
  assert.deepEqual(C.encounters(d, { ...p, geoKey: '9,0,0' }), []);
});

test('discovered neutral and hostile groups gain their individual labels; quest contacts are marked explicitly', () => {
  const d = dungeon(64), p = I.createPopulation(d.geoKey, [{ name: 'Seer', allegiance: 'Neutral' }, { name: 'Raider', allegiance: 'Hostile' }]);
  for (const a of Object.values(p.actors)) a.position = { x: 20, y: 20 };
  p.questIntroduction = { speaker: 'Seer', status: 'pending' };
  let markers = C.encounters(d, p);
  assert.equal(markers[0].label, 'Quest contact'); assert.equal(markers[0].glyph, '!');
  p.groups.forEach(g => g.status = 'discovered'); markers = C.encounters(d, p);
  assert.equal(markers[0].label, 'Seer'); assert.equal(markers[0].allegiance, 'Neutral');
  assert.equal(markers[1].glyph, 'H'); assert.equal(markers[1].label, 'Raider');
});

test('only individually seen living residents get map pins, without revealing terrain or other group members', async () => {
  const d = dungeon(64), state = C.createAtlas().get(d, 'run'); await state.ready;
  const p = I.createPopulation(d.geoKey, ['Seer', 'Unseen Guard'].map(name => ({ name, allegiance: 'Neutral', encounterId: 'workers' })));
  for (const a of Object.values(p.actors)) a.position = { x: 22, y: 20 };
  const actor = { name: 'Seer', type: 'monster', state: 'Neutral', hp: 20, mazeX: 22, mazeY: 20, mazeRoomKey: d.geoKey };
  const observed = C.observeResident(state, d, actor, { x: 20.5, y: 20.5 }, 1000);
  assert.equal(observed.fresh, true); assert.equal(state.count, 0);
  assert.deepEqual(C.knownEncounters(d, state, p).map(m => m.label), ['Seer']);
  assert.equal(C.observeResident(state, d, actor, { x: 20.5, y: 20.5 }, 2000).fresh, false);
  actor.mazeX = 60; p.actors.Seer.position.x = 60;
  assert.equal(C.observeResident(state, d, actor, { x: 20.5, y: 20.5 }, 3000).changed, false);
  assert.equal(C.knownEncounters(d, state, p, [actor])[0].x, 22.5);
  p.actors.Seer.status = 'recruited'; assert.deepEqual(C.knownEncounters(d, state, p), []);
});

test('discovered residents persist across revisits and unseen, occluded or dead residents cannot be marked', async () => {
  const d = dungeon(64), saved = new Map(), options = { save: async (key, value) => saved.set(key, value), load: async key => saved.get(key) };
  const atlas = C.createAtlas(options), state = atlas.get(d, 'run'); await state.ready;
  const actor = { name: 'Seer', type: 'monster', hp: 20, state: 'Friendly', mazeX: 22, mazeY: 20, mazeRoomKey: d.geoKey };
  for (const patch of [{ hp: 0 }, { discoveryState: 'pending' }, { mazeRoomKey: '2,0,0' }])
    assert.equal(C.observeResident(state, d, { ...actor, ...patch }, { x: 20.5, y: 20.5 }).fresh, false);
  d.cells['21,20'].tile = 'wall'; assert.equal(C.observeResident(state, d, actor, { x: 20.5, y: 20.5 }).fresh, false);
  d.cells['21,20'].tile = 'floor'; C.observeResident(state, d, actor, { x: 20.5, y: 20.5 }, 1000); await atlas.flush(state);
  const restored = C.createAtlas(options).get(d, 'run'); await restored.ready;
  assert.deepEqual(restored.knownResidents, state.knownResidents);
  assert.equal(C.observeResident(restored, d, actor, { x: 20.5, y: 20.5 }, 2000).fresh, false);
  assert.equal(restored.count, 0);
});
