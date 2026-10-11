const test = require('node:test');
const assert = require('node:assert/strict');
const { applySceneRoofs } = require('../retort/sceneRoofs');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');

function fixture(zones, size = 32) {
  const d = { layout: { width: size, height: size }, start: { x: 3, y: size - 5 }, cells: {}, tiles: {},
    classification: { indoor: false }, sceneArchitecture: { version: 7, status: 'built', family: 'warehouse',
      dimensions: { clearance: 6 }, zones } };
  const spec = { indoor: false, source: { roomName: 'Covered Storehouse', description: 'Stone walls support a coffered ceiling.' },
    wallStyleMaterial: 'marble' };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d.cells[`${x},${y}`] = {
    tile: x && y && x < size - 1 && y < size - 1 ? 'floor' : 'wall', floorHeight: .5, ceilHeight: 3.5
  };
  return { d, spec };
}

function wallOverhang(d, z) {
  for (let y = z.y; y < z.y + z.height; y++) {
    d.cells[`${z.x - 1},${y}`] = { tile: 'wall', floorHeight: .5, ceilHeight: 3.5 };
    d.cells[`${z.x + z.width},${y}`].navigationReserved = true;
  }
  for (const y of [z.y - 1, z.y + z.height]) for (let x = z.x; x < z.x + z.width; x++) {
    d.cells[`${x},${y}`].navigationReserved = true;
  }
}
function preserved(d, original) {
  const before = reachable(makeNavigation({ ...d, cells: original }), d.start);
  const nav = makeNavigation(d), after = reachable(nav, d.start);
  for (const [key, c] of Object.entries(original)) {
    assert.equal(d.cells[key].floorHeight, c.floorHeight, key);
    if (c.navigationReserved || c.exit || c.door || c.interactable) {
      const { roof, ...ground } = d.cells[key]; assert.deepEqual(ground, c, key);
    }
  }
  for (let i = 0; i < before.seen.length; i++) if (before.seen[i] && nav.passable[i]) assert.ok(after.seen[i], `route ${i}`);
}

test('ordinary freestanding roofs retain their original columns without extra corner repairs or subdivided bays', () => {
  const z = { role: 'hall', x: 8, y: 8, width: 8, height: 8 };
  const { d, spec } = fixture([z]);
  const roof = applySceneRoofs(d, spec);
  assert.equal(roof.bays.length, 1);
  assert.equal(roof.bays[0].wallBearingRepairs, undefined);
  assert.equal(roof.bays[0].bearing, undefined);
  assert.ok(!d.sceneStructures.some(p => p.role === 'wall-corbel'));
  for (const [key, c] of Object.entries(d.cells)) if (c.architectureRole === 'roof-support') {
    const [x] = key.split(',').map(Number); assert.ok(x === 7 || x === 16, key);
  }
});

test('a roof overhanging a masonry wall gets at most two local pillars without blocking routes', () => {
  const z = { role: 'hall', infill: true, x: 8, y: 8, width: 8, height: 8 };
  const { d, spec } = fixture([z]); wallOverhang(d, z);
  const original = structuredClone(d.cells), roof = applySceneRoofs(d, spec), bay = roof.bays[0];
  assert.equal(roof.bays.length, 1);
  assert.equal(bay.wallBearingRepairs.length, 2);
  for (const key of bay.wallBearingRepairs) {
    const c = d.cells[key]; assert.equal(c.architectureRole, 'roof-support');
    assert.equal(c.floorHeight + c.structureHeight, bay.springHeight);
  }
  preserved(d, original);
});

test('one-sided columns without a wall do not trigger the withdrawn room-wide support expansion', () => {
  const z = { role: 'hall', infill: true, x: 8, y: 8, width: 8, height: 8 };
  const { d, spec } = fixture([z]); wallOverhang(d, z);
  for (let y = 8; y < 16; y++) d.cells[`7,${y}`].tile = 'pillar';
  const roof = applySceneRoofs(d, spec);
  assert.equal(roof.bays.length, 1); assert.equal(roof.bays[0].wallBearingRepairs, undefined);
  assert.equal(d.cells['15,8'].tile, 'floor'); assert.equal(d.cells['15,15'].tile, 'floor');
});

test('wall repairs leave exits, items and stair treads alone, even when it means no extra pillar fits', () => {
  const z = { role: 'hall', infill: true, x: 8, y: 8, width: 8, height: 8 };
  const { d, spec } = fixture([z]); wallOverhang(d, z);
  d.cells['15,8'].interactable = { id: 'quest-item' };
  d.cells['15,15'].architectureRole = 'stair-tread';
  const original = structuredClone(d.cells), roof = applySceneRoofs(d, spec);
  assert.equal(roof.bays.length, 1); assert.equal(roof.bays[0].wallBearingRepairs, undefined);
  assert.deepEqual(d.cells['15,15'], { ...original['15,15'], roof: d.cells['15,15'].roof });
  preserved(d, original);
});

test('wall-specific additional pillars are capped at eight per room, not per floor rectangle', () => {
  const zones = Array.from({ length: 6 }, (_, i) => ({ role: 'hall', infill: true,
    x: 8 + i * 13, y: 8, width: 8, height: 8 }));
  const { d, spec } = fixture(zones, 96);
  for (const z of zones) wallOverhang(d, z);
  const original = structuredClone(d.cells), roof = applySceneRoofs(d, spec);
  assert.equal(roof.bays.length, 6);
  assert.equal(roof.bays.flatMap(b => b.wallBearingRepairs || []).length, 8);
  assert.ok(roof.bays.every(b => (b.wallBearingRepairs?.length || 0) <= 2));
  preserved(d, original);
});

test('cached saved rooms keep their current pillars and roofs exactly as stored', () => {
  const { d, spec } = fixture([{ role: 'hall', x: 8, y: 8, width: 8, height: 8 }]);
  d.sceneRoof = { version: 6, status: 'built', bays: [{ supports: ['7,8'], springHeight: 6.5 }] };
  d.cells['8,8'].roof = { height: 6.85, material: 'marble' };
  d.sceneStructures = [{ shape: 'coffered_slab', position: { x: 8, y: 8, z: 6.85 }, size: { x: 8, y: 8, z: .22 } }];
  const snapshot = JSON.stringify(d);
  assert.equal(applySceneRoofs(d, spec), d.sceneRoof);
  assert.equal(JSON.stringify(d), snapshot);
});
