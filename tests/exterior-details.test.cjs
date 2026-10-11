'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const V = require('../assets/scenePropVoxels');
const D = require('../assets/sceneExteriorDetails');
const E = require('../retort/sceneExterior');
const X = require('../assets/dungeonExits');
const { applySceneRoofs } = require('../retort/sceneRoofs');

function fixture(direction = 'north', coords = { x: 0, y: -1, z: 0 }) {
  const spec = { indoor: false, coords, exits: [direction], source: { roomName: 'Ash Flats', description: 'Flat ash plains with scattered ruins.' } };
  E.prepareSceneExteriors(spec, { '0,0,0': { name: 'Ruined Temple Entrance', indoor: true } }, { seed: 'grand-gate' });
  const d = { geoKey: `${coords.x},${coords.y},0`, layout: { width: 64, height: 64 }, start: { x: 32, y: 32 },
    cells: {}, tiles: { wall: { url: '/wall.png' }, floor: { url: '/floor.png' } }, sceneStructures: [], classification: { indoor: false } };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) d.cells[`${x},${y}`] = {
    tile: x && y && x < 63 && y < 63 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 2.5 };
  X.install(d, spec.exits);
  assert.equal(E.applySceneExteriors(d, spec).placed, 1);
  return { d, spec };
}

test('grand gate leaves are opaque from ground to lintel in both orientations at all mesh resolutions', () => {
  for (const size of [8, 16, 32, 64]) for (const shape of ['grand_gate', 'grand_gate_side']) {
    const grid = V.build(shape, size);
    const side = shape.endsWith('_side');
    for (let z = 0; z < size; z++) for (let u = 0; u < size; u++) {
      assert.ok(Array.from({ length: size }, (_, depth) => grid[(side ? depth : u) + (side ? u : depth) * size + z * size ** 2]).some(Boolean),
        `${shape}: gap at ${u},${z} in ${size}-voxel model`);
    }
    assert.deepEqual(grid, V.build(shape, size));
    assert.ok(grid.some(v => !v), 'Raised relief remains a volumetric model, not a filled cube');
  }
});

test('ornamental gates use destination colors with contrasting raised trim and no changes to legacy timber gates', () => {
  const palette = { primary: [.2, .5, .3], secondary: [.1, .2, .15], highlight: [.9, .85, .6], shadow: [.05, .1, .05] };
  const panel = V.color('grand_gate', .25, .38, .4, [0, -1, 0], palette.primary, 'metal', { palette });
  const trim = V.color('grand_gate', .25, .25, .4, [0, -1, 0], palette.primary, 'metal', { palette });
  assert.ok(trim.every((v, i) => v > panel[i]));
  assert.ok(panel[1] > panel[0]);
  assert.ok(V.usesRoomPalette('grand_gate_side'));
  const legacy = V.build('timber_gate', 16);
  assert.equal(legacy[0], 0, 'Do not turn existing timber gateways into the new grand gate');
});

test('the roof pass keeps earlier gates, facade masonry, torch walls and journey markers intact', () => {
  const { d, spec } = fixture();
  const prior = d.sceneStructures.slice(), torches = Object.entries(d.cells).filter(([, c]) => c.tile === 'torch');
  const report = applySceneRoofs(d, spec);
  for (const p of prior) assert.ok(d.sceneStructures.includes(p), p.role);
  for (const [key, c] of torches) assert.deepEqual(d.cells[key], c);
  assert.ok(d.sceneStructures.some(p => p.role === 'exterior-closed-gate' && p.shape === 'grand_gate'));
  assert.ok(d.sceneStructures.some(p => p.role === 'journey-exit-marker'));
  assert.equal(d.sceneStructures.length, prior.length + report.parts);
  const after = JSON.stringify(d);
  applySceneRoofs(d, spec);
  assert.equal(JSON.stringify(d), after);
});

test('facade sconces use real bounded torch tiles; they leave the exit and perimeter walkable', () => {
  const { d } = fixture();
  const torches = Object.values(d.cells).filter(c => c.exteriorDestination && c.tile === 'torch');
  assert.ok(torches.length >= 8 && torches.length <= 32, `sconces: ${torches.length}`);
  assert.ok(torches.every(c => c.feature === 'torch' && c.torchMountHeight >= 2.2 && c.torchMountHeight <= 3.5 &&
    c.torchMountHeight < c.ceilHeight - c.floorHeight));
  const marker = d.roomExits.markers[0], b = d.sceneExteriors.buildings[0];
  assert.equal(d.cells[marker.key].tile, 'floor');
  assert.equal(X.nearby(d, { x: marker.x + .5, y: marker.y + .5 }), marker);
  const gate = d.sceneStructures.find(p => p.role === 'exterior-closed-gate');
  assert.equal(gate.position.z, marker.floor);
  assert.equal(gate.size.z, b.wallHeight);
  assert.deepEqual(d.tiles[gate.tile].spriteSpec.palette, b.palette);
});

for (const [direction, coords] of [['north', { x: 0, y: -1, z: 0 }], ['west', { x: 1, y: 0, z: 0 }]]) {
  test(`existing saved ${direction} gate gets a cached presentation without mutating saved geometry`, () => {
    const { d } = fixture(direction, coords);
    // Reproduce the roof overwrite from the user's saved session.
    d.sceneStructures = d.sceneStructures.filter(p => !p.exteriorDestination);
    for (const [key, c] of Object.entries(d.cells)) if (c.tile === 'torch') d.cells[key] = { ...c, tile: 'wall', torchMountHeight: undefined };
    d._geometryStamp = 'original-saved-room';
    const original = JSON.stringify(d), view = D.forRendering(d);
    assert.notEqual(view, d);
    assert.equal(D.forRendering(d), view, 'Do not rescan/copy the terrain every frame');
    const gate = view.sceneStructures.find(p => p.role === 'exterior-closed-gate');
    assert.equal(gate.shape, direction === 'west' ? 'grand_gate_side' : 'grand_gate');
    assert.ok(Object.values(view.cells).filter(c => c.tile === 'torch').length >= 8);
    assert.equal(JSON.stringify(d), original);
    assert.equal(view.roomExits, d.roomExits);
    assert.equal(view.sceneRoof, d.sceneRoof);
    assert.equal(view.sceneExteriors, d.sceneExteriors);
    for (const [key, c] of Object.entries(d.cells)) {
      assert.equal(view.cells[key].floorHeight, c.floorHeight);
      assert.equal(view.cells[key].ceilHeight, c.ceilHeight);
      assert.equal(view.cells[key].blocked, c.blocked);
      assert.equal(view.cells[key].obstacle, c.obstacle);
    }
    d._geometryStamp = 'later-door-action';
    assert.notEqual(D.forRendering(d), view, 'Real geometry updates invalidate the presentation cache');
  });
}

test('already complete exteriors, indoor rooms and unsealed/open gateways are not reconstructed', () => {
  const { d } = fixture();
  assert.equal(D.forRendering(d), d);
  const indoor = { ...d, classification: { indoor: true } };
  assert.equal(D.forRendering(indoor), indoor);
  assert.equal(D.forRendering({ cells: {}, tiles: {} }).sceneStructures, undefined);
  const malformed = { cells: {}, tiles: {}, sceneExteriors: { buildings: [{ entrance: 'closed-gate' }] } };
  assert.equal(D.forRendering(malformed), malformed);
  d.sceneStructures = []; d.sceneExteriors.buildings[0].entrance = 'open';
  const open = { ...d };
  assert.equal(D.forRendering(open), open);
});

test('sconce light and flame sprites share the same clamped world mount height', () => {
  const source = fs.readFileSync('assets/rendererWebGL.js', 'utf8');
  const start = source.indexOf('const torchMountZ =');
  const end = source.indexOf('\n      };', start) + '\n      };'.length;
  const context = { TORCH_MOUNT_HEIGHT: .45, TORCH_MOUNT_RATIO: .55 };
  vm.runInNewContext(source.slice(start, end) + '\nthis.mount = torchMountZ;', context);
  assert.equal(context.mount({ floorHeight: -1, ceilHeight: 19, torchMountHeight: 3.5 }), 2.5);
  assert.equal(context.mount({ floorHeight: 0, ceilHeight: 2.5 }), 1.375);
  assert.ok(context.mount({ floorHeight: 0, ceilHeight: 2.5, torchMountHeight: 100 }) < 2.5);
  assert.match(source, /const torchZ = torchMountZ\(cell\)/);
  assert.match(source, /spriteBaseZ = torchMountZ\(cell\)/);
  assert.match(source, /SceneExteriorDetails\?\.forRendering\(window.currentDungeon\)/);
});
