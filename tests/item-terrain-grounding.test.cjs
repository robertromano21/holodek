'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Items = require('../assets/renderSceneItems');
const source = fs.readFileSync('assets/rendererWebGL.js', 'utf8');
const context = { window: {}, console, performance };
vm.runInNewContext(source, context);
const renderer = context.window.webglDungeonRenderer;
const obj = { name: 'siltpiercer dagger', type: 'weapon', magic: 2, x: 2, y: 1 };
function fixture(floor, heightMin, heightRange) {
  const dungeon = { cells: { '2,1': { tile: 'floor', floorHeight: floor } } };
  const data = new Uint8Array(4 * 4 * 4);
  data[(1 * 4 + 2) * 4 + 1] = Math.round((floor - heightMin) / heightRange * 255);
  Object.assign(renderer, { dungeonObject: dungeon, gridW: 4, gridH: 4, sceneCellData: data, heightMin, heightRange });
  return dungeon;
}

test('loot is grounded on the actual packed floor, including the live wasteland height range', () => {
  const dungeon = fixture(-0.3288, -12.9395, 82.7165);
  const rendered = renderer._getRenderedFloorHeight(dungeon, 2.5, 1.5);
  assert.ok(Math.abs(rendered - (-0.28874117647058917)) < 1e-8);
  assert.ok(rendered > dungeon.cells['2,1'].floorHeight);
  const pix = Items.renderItemPixels(obj);
  const billboard = { worldHeight: 0.42, footInset: pix.footInset, glow: !!pix.glow };
  for (let now = 0; now <= 4000; now += 17) {
    const base = renderer._getItemBaseZ(dungeon, obj, billboard, now);
    const opaqueFoot = base + billboard.footInset * billboard.worldHeight;
    assert.ok(opaqueFoot >= rendered + 0.02999, 'The magic bob cannot sink the visible dagger below the rendered surface');
  }
  assert.equal(dungeon.cells['2,1'].floorHeight, -0.3288, 'Physical terrain and combat rules do not change');
});

test('nonmagic loot clears quantized floors that previously could bury the whole small sprite', () => {
  for (const floor of [-4.8, 1.7, 13.8]) {
    const dungeon = fixture(floor, -15, 220);
    const rendered = renderer._getRenderedFloorHeight(dungeon, 2.5, 1.5);
    const billboard = { worldHeight: 0.42, footInset: 0.2, glow: false };
    const base = renderer._getItemBaseZ(dungeon, obj, billboard, 0);
    assert.ok(Math.abs(base + billboard.footInset * billboard.worldHeight - rendered - 0.02) < 1e-8);
  }
});

test('missing, stale or out-of-range texture data uses the local physical floor, never a different room', () => {
  const dungeon = fixture(2.2, -15, 220);
  renderer.dungeonObject = {};
  assert.equal(renderer._getRenderedFloorHeight(dungeon, 2.5, 1.5), 2.2);
  renderer.dungeonObject = dungeon; renderer.sceneCellData = null;
  assert.equal(renderer._getRenderedFloorHeight(dungeon, 2.5, 1.5), 2.2);
  dungeon.cells['5,1'] = { floorHeight: 9 };
  assert.equal(renderer._getRenderedFloorHeight(dungeon, 5.5, 1.5), 9);
});

test('item rendering and discovery use the same rendered-floor sampler without changing world lighting', () => {
  const block = source.slice(source.indexOf('// Objects in Room: Doom-style item billboards'), source.indexOf('voxelCamera.billboards ='));
  assert.match(block, /this\._getItemBaseZ\(dungeon, obj, it, now\)/);
  assert.match(source, /floorHeightAt: \(x, y\) => this\._getRenderedFloorHeight\(dungeon, x, y\)/);
  const ui = fs.readFileSync('assets/worldInteractionUi.js', 'utf8');
  assert.match(ui, /camera\.floorHeightAt\?\.\(x, y\)/);
});

test('discovery respects the rendered terrain occluder instead of the lower CPU height', () => {
  const World = require('../assets/worldInteractionUi'), dungeon = { cells: {}, tiles: {} };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0 };
  const target = { type: 'item', key: '5,4', label: obj.name, distance: 3,
    pixels: { w: 4, h: 4, data: new Uint8Array(64).fill(255) }, screen: { left: 0.4, right: 0.6, top: 0.4, bottom: 0.6 } };
  const camera = { x: 2.5, y: 4.5, eyeZ: 0.65, dirX: 1, dirY: 0, planeScale: 0.577, verticalScale: 1.73, billboards: [target] };
  assert.equal(World.visibleBillboards(dungeon, camera, 'item').length, 1);
  camera.floorHeightAt = (x, y) => Math.floor(x) === 3 && Math.floor(y) === 4 ? 2 : 0;
  assert.equal(World.visibleBillboards(dungeon, camera, 'item').length, 0);
  camera.floorHeightAt = () => 0;
  assert.equal(World.visibleBillboards(dungeon, camera, 'item').length, 1);
});
