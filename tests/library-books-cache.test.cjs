'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const Books = require(path.resolve(process.env.HOLODEK_LIBRARY_SOURCE || path.join(__dirname, '../assets/libraryBooks.js')));
function room() {
  let scans = 0;
  const cells = new Proxy({ '1,1': { tile: 'floor', floorHeight: 0, ceilHeight: 3 },
    '1,2': { tile: 'floor', floorHeight: 0, ceilHeight: 3 } },
  { ownKeys: target => { scans++; return Reflect.ownKeys(target); } });
  return { dungeon: { _geometryStamp: 'a', cells, tiles: {}, sceneLandmarks: [] }, scans: () => scans };
}
test('an empty outdoor room scans once, not on every book/pointer query', () => {
  const { dungeon, scans } = room();
  for (let i = 0; i < 100; i++) {
    assert.equal(Books.books(dungeon).length, 0);
    assert.equal(Books.shelfCells(dungeon).length, 0);
    assert.equal(Books.sections(dungeon).length, 0);
  }
  assert.equal(scans(), 1);
});
test('geometry revisions rebuild shelves and preserve book IDs and positions', () => {
  const { dungeon, scans } = room();
  Books.books(dungeon);
  dungeon.cells['1,1'].tile = 'custom_bookcase'; dungeon._geometryStamp = 'b';
  const first = Books.books(dungeon);
  assert.equal(first.length, 20); assert.equal(scans(), 2);
  assert.deepEqual(Books.books(dungeon), first); assert.equal(scans(), 2);
  dungeon._geometryStamp = 'c';
  assert.deepEqual(Books.books(dungeon), first); assert.equal(scans(), 3);
});
test('replaced cells, tile definitions, landmarks, names, scale and rooms invalidate the layout', () => {
  const { dungeon } = room();
  Books.books(dungeon);
  dungeon.cells = { ...dungeon.cells, '2,1': { tile: 'bookcase' } };
  assert.equal(Books.books(dungeon).length, 20);
  dungeon.tiles = { floor: { spriteSpec: { voxelShape: 'bookshelf' } } };
  assert.equal(Books.books(dungeon).length, 60);
  dungeon.tiles = {};
  dungeon.sceneLandmarks = [{ x: 4, y: 4, type: 'bookshelf', label: 'Intact shelf' }];
  assert.equal(Books.books(dungeon).length, 40);
  dungeon.libraryScale = 'vast'; assert.equal(Books.books(dungeon).length, 144);
  delete dungeon.libraryScale; dungeon.roomName = 'The Library'; assert.equal(Books.books(dungeon).length, 144);
  dungeon.roomName = ''; dungeon.sceneSpec = { source: { roomName: 'Archive' } };
  assert.equal(Books.books(dungeon).length, 144);
  assert.equal(Books.books({ ...dungeon, cells: {}, tiles: {}, sceneLandmarks: [] }).length, 0);
});
test('revisionless rooms still observe direct edits without explicit invalidation', () => {
  const { dungeon } = room(); delete dungeon._geometryStamp;
  assert.equal(Books.books(dungeon).length, 0);
  dungeon.cells['1,1'].tile = 'bookshelf'; assert.equal(Books.books(dungeon).length, 20);
  dungeon.cells['1,1'].tile = 'floor'; assert.equal(Books.books(dungeon).length, 0);
});
