const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/dungeonCartography');
function dungeon(width = 40, height = width) {
  const d = { geoKey: '0,0,0', layout: { width, height }, cells: {}, roomExits: { markers: [] } };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0 };
  return d;
}
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
