const test = require('node:test');
const assert = require('node:assert/strict');
const { upgradePorticos, prepareRoom } = require('../retort/porticoUpgrade');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');

function room(count = 4) {
  const bay = { role: 'shrine', style: 'pitched', idiom: 'classical', x: 4, y: 4, width: 5, height: 7,
    springHeight: 5, supports: ['4,4', '8,4', '4,10', '8,10'] };
  if (count === 9) bay.supports.push('4,6', '4,8', '8,6', '8,8', '6,4');
  const dungeon = { geoKey: '1,1,0', start: { x: 6, y: 16 }, layout: { width: 24, height: 24 }, cells: {},
    tiles: { stone_column: { url: '/pillar.png', spriteSpec: { voxelShape: 'ionic_column', material: 'marble' } } },
    sceneRoof: { version: 6, status: 'built', bays: [bay] },
    sceneStructures: [{ shape: 'pediment', position: { x: 4, y: 4, z: 5 }, size: { x: 5, y: 1, z: 1 } }],
    _geometryStamp: 'saved', _meta: { geometryStamp: 'saved' }, _lodCache: { stale: true } };
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) dungeon.cells[`${x},${y}`] = {
    tile: x && y && x < 23 && y < 23 ? 'floor' : 'wall', floorHeight: .25, ceilHeight: 3,
    roof: x >= 4 && x <= 8 && y >= 4 && y <= 10 ? { height: 5.35, style: 'pitched' } : undefined };
  for (const key of bay.supports) Object.assign(dungeon.cells[key], {
    tile: 'stone_column', feature: 'pillar', architectureRole: 'roof-support', structureHeight: 4.75, ceilHeight: 5 });
  return dungeon;
}

for (const count of [4, 9]) test(`saved ${count}-column portico becomes ten without moving columns or replacing roofs`, () => {
  const d = room(count), before = structuredClone(d), nav = makeNavigation(d), reachableBefore = reachable(nav, d.start);
  const result = upgradePorticos(d);
  assert.equal(result.upgraded, 1); assert.equal(result.added.length, 10 - count);
  assert.equal(d.sceneRoof.bays[0].supports.length, 10);
  for (const key of before.sceneRoof.bays[0].supports) assert.deepEqual(d.cells[key], before.cells[key]);
  for (const [key, cell] of Object.entries(d.cells)) {
    assert.deepEqual(cell.roof, before.cells[key].roof); assert.equal(cell.floorHeight, before.cells[key].floorHeight);
    if (!result.added.includes(key)) assert.deepEqual(cell, before.cells[key]);
    else { assert.equal(cell.tile, 'stone_column'); assert.equal(cell.structureHeight + cell.floorHeight, 5); }
  }
  assert.deepEqual(d.sceneStructures, before.sceneStructures); assert.deepEqual(d.tiles, before.tiles);
  assert.equal(d._lodCache, undefined);
  const afterNav = makeNavigation(d), after = reachable(afterNav, d.start);
  for (let i = 0; i < nav.passable.length; i++) if (reachableBefore.seen[i] && afterNav.passable[i]) assert.ok(after.seen[i]);
  const upgraded = structuredClone(d);
  assert.equal(upgradePorticos(d).changed, false); assert.deepEqual(d, upgraded);
});

for (const [name, modify, options] of [
  ['reserved route', d => { d.cells['4,6'].navigationReserved = true; }],
  ['quest item', d => { d.cells['4,6'].interactable = { id: 'key' }; }],
  ['stairs', d => { d.cells['4,6'].architectureRole = 'stair-tread'; }],
  ['door', d => { d.cells['4,6'].door = { isOpen: true }; }],
  ['scene object', d => { d.sceneObjects = [{ position: { x: 4.5, y: 6.5 }, name: 'chest' }]; }],
  ['physical puzzle', d => { d.physicalPuzzle = { pieces: [{ x: 4, y: 6 }] }; }],
  ['player', () => {}, { player: { x: 4.5, y: 6.5 } }],
  ['companion', () => {}, { actors: [{ mazeX: 4, mazeY: 6 }] }],
  ['unsupported terrain', d => { d.cells['4,6'].floorHeight = 2; }]
]) test(`${name} prevents a partial upgrade and remains unchanged`, () => {
  const d = room(); modify(d); const before = structuredClone(d);
  assert.equal(upgradePorticos(d, options).changed, false); assert.deepEqual(d, before);
});

test('a new pillar may not cut off a previously reachable floor', () => {
  const d = room();
  for (const key of ['3,5', '3,7', '2,6']) d.cells[key].tile = 'wall';
  const before = structuredClone(d), result = upgradePorticos(d);
  assert.equal(result.changed, false); assert.equal(result.skipped[0].reason, 'would-block-route'); assert.deepEqual(d, before);
});

test('full-room preparation commits and restamps only the requested room, never an action delta', () => {
  let stored = room(), finalized = 0, written = 0;
  const state = { getRoomDungeon: () => structuredClone(stored), getCombatCharactersString: () => '[]',
    getLiveWorldState: () => null, getRoomPopulation: () => null,
    setRoomDungeon(coords, dungeon) { assert.deepEqual(coords, { x: 1, y: 1, z: 0 }); written++; stored = dungeon; } };
  const finalize = (key, d) => { assert.equal(key, '1,1,0'); finalized++; d._geometryStamp = d._meta.geometryStamp = 'ten-pillars'; return d; };
  assert.equal(prepareRoom(state, '1,1,0', { finalize })._geometryStamp, 'ten-pillars');
  prepareRoom(state, '1,1,0', { finalize });
  assert.equal(finalized, 1); assert.equal(written, 1);
  stored = room(); state.getRoomPopulation = () => ({ actors: { companion: { position: { x: 4, y: 6 } } } });
  assert.equal(prepareRoom(state, '1,1,0', { finalize }).sceneRoof.bays[0].supports.length, 4);
  assert.equal(written, 1);
});
