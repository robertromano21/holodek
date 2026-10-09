'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const { prepareSceneExteriors, applySceneExteriors, EXTERIOR_VERSION } = require('../retort/sceneExterior');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const Exits = require('../assets/dungeonExits');
const Voxels = require('../assets/scenePropVoxels');
const Collision = require('../assets/voxelCollision');

const clone = value => JSON.parse(JSON.stringify(value));
const ROOT = { name: 'Ruined Temple Entrance', indoor: true,
  description: 'Fractured temple walls and ancient inscriptions frame the entrance.' };

function spec(overrides = {}) {
  return { indoor: false, coords: { x: 0, y: -1, z: 0 }, source: { roomName: 'Ash Plains', description: 'Flat plains beneath a yellow sky.' },
    exits: ['north'], ...overrides };
}

function room(size = 64) {
  const dungeon = { layout: { width: size, height: size }, start: { x: Math.floor(size / 2), y: Math.floor(size / 2) },
    tiles: { floor: { url: '/floor.png' }, wall: { url: '/wall.png' }, pillar: { url: '/pillar.png' } },
    customTiles: [], cells: {}, sceneStructures: [], sceneObjects: [] };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dungeon.cells[`${x},${y}`] = {
    tile: x && y && x < size - 1 && y < size - 1 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 2.5
  };
  return dungeon;
}

function compiled(seed = 'campaign-0', input = spec(), db = { '0,0,0': ROOT }, dungeon = room()) {
  prepareSceneExteriors(input, db, { seed });
  Exits.install(dungeon, input.exits);
  const before = clone(dungeon);
  const report = applySceneExteriors(dungeon, input);
  return { dungeon, input, report, before };
}

function assertNavigation(before, dungeon) {
  const prior = reachable(makeNavigation(before), before.start), after = reachable(makeNavigation(dungeon), dungeon.start);
  const width = dungeon.layout.width;
  for (const [key, old] of Object.entries(before.cells)) {
    const c = dungeon.cells[key], [x, y] = key.split(',').map(Number), index = y * width + x;
    assert.equal(c.floorHeight, old.floorHeight, `elevation changed at ${key}`);
    if (prior.seen[index] && (c.tile === 'floor' || c.tile === 'door')) assert.ok(after.seen[index], `lost ${key}`);
  }
  return after;
}

test('known return to the root temple creates rendered shell, towers, supported doorway and a sky forecourt', () => {
  const { dungeon: d, input, report, before } = compiled();
  assert.equal(report.status, 'built', JSON.stringify(report));
  assert.equal(report.version, EXTERIOR_VERSION);
  assert.equal(report.placed, 1);
  assert.equal(report.groups, report.buildings);
  const b = report.buildings[0];
  assert.equal(b.targetKey, '0,0,0');
  assert.equal(b.targetName, ROOT.name);
  assert.equal(b.evidence.databaseKey, '0,0,0');
  assert.equal(b.evidence.description, ROOT.description);
  assert.equal(b.evidence.architectureSource, 'known-root-temple-name');
  assert.equal(b.evidence.indoorSource, 'indoor');
  assert.ok(b.counts.walls > 20);
  assert.equal(b.counts.towerCells, 8);
  assert.equal(b.counts.towers, 2);
  assert.equal(b.counts.doorwayCells, 3);
  assert.ok(d.sceneStructures.some(p => p.role === 'exterior-wall-box'));
  assert.ok(d.sceneStructures.some(p => p.role === 'exterior-tower-box'));
  assert.ok(d.sceneStructures.some(p => p.role === 'exterior-pediment'));
  const doorway = b.doorway;
  assert.equal(doorway.direction, 'north');
  assert.equal(doorway.facing, 'south');
  for (const p of doorway.cells) {
    const c = d.cells[p.key];
    assert.equal(c.tile, 'floor'); assert.equal(c.navigationReserved, true); assert.equal(c.complexExit, 'north');
    assert.ok(!c.feature && !c.door && !c.blocked && !c.obstacle && !c.structureHeight);
  }
  assert.equal(doorway.supports.length, 2);
  const lintel = d.sceneStructures.find(p => p.role === 'exterior-doorway-lintel');
  assert.ok(doorway.supports.every(key => d.cells[key].tile === 'wall' && d.cells[key].ceilHeight >= lintel.position.z));
  const court = b.forecourt;
  for (let y = court.y; y < court.y + court.height; y++) for (let x = court.x; x < court.x + court.width; x++) {
    assert.equal(d.cells[`${x},${y}`].tile, 'floor');
    assert.ok(!d.cells[`${x},${y}`].roof, 'forecourt must remain outdoor');
  }
  const nav = assertNavigation(before, d);
  assert.ok(nav.seen[doorway.y * d.layout.width + doorway.x]);
  assert.ok(nav.seen[doorway.approach.y * d.layout.width + doorway.approach.x]);
  for (const part of d.sceneStructures.filter(p => p.skyline)) {
    assert.equal(d.tiles[part.tile].spriteSpec.voxelShape, part.shape);
    assert.ok(Voxels.build(part.shape), part.shape);
    assert.ok([part.position.x, part.position.y, part.position.z, part.size.x, part.size.y, part.size.z].every(Number.isFinite));
    assert.ok(part.position.z + part.size.z <= 18);
    assert.ok(Object.values(part.size).every(n => n > 0));
    assert.ok(part.position.x >= b.footprint.x && part.position.x + part.size.x <= b.footprint.x + b.footprint.width);
    assert.ok(part.position.y >= b.footprint.y && part.position.y + part.size.y <= b.footprint.y + b.footprint.height);
  }
  for (const c of Object.values(d.cells).filter(c => c.exteriorRole && c.tile === 'wall')) assert.ok(c.ceilHeight <= 18 && c.structureHeight <= 18);
  assert.equal(report.parts, d.sceneStructures.filter(p => p.skyline).length);
  assert.deepEqual(input.exteriorPlan.buildings[0].evidence, b.evidence);
});

test('object, JSON and Map databases produce identical plans without changing records or cached rooms', () => {
  const db = { '0,0,0': { ...ROOT, cachedDungeon: room(24) },
    '0,-1,0': { exits: { north: { targetCoordinates: { x: 0, y: 0, z: 0 }, status: 'locked' } } } };
  const snapshot = clone(db);
  const plans = [db, JSON.stringify(db), new Map(Object.entries(db))].map(raw => prepareSceneExteriors(spec(), raw, { seed: 'run-id' }));
  assert.deepEqual(plans[0], plans[1]); assert.deepEqual(plans[1], plans[2]);
  assert.deepEqual(db, snapshot);
  assert.equal(plans[0].buildings[0].evidence.targetSource, 'exit-target-coordinates');
  assert.equal(plans[0].seed, 'run-id');
});

test('top-level coords win; source coords, direction aliases and explicit target forms also work', () => {
  const correct = prepareSceneExteriors(spec({ source: { coords: { x: 77, y: 77, z: 77 } }, exits: 'N, up' }), { '0,0,0': ROOT });
  assert.equal(correct.buildings[0].targetKey, '0,0,0');
  assert.ok(correct.rejected.some(r => r.reason === 'vertical-exit'));
  const fallback = spec({ coords: null, source: { coords: '0,-1,0' } });
  assert.equal(prepareSceneExteriors(fallback, { 'X: 0, Y: 0, Z: 0': ROOT }).buildings[0].targetKey, '0,0,0');
  for (const target of ['9,8,7', { x: 9, y: 8, z: 7 }, [9, 8, 7]]) {
    const input = spec({ exits: [{ direction: 'north', targetCoordinates: target }] });
    const plan = prepareSceneExteriors(input, { '9,8,7': { name: 'Marble Basilica', classification: { indoor: true } } });
    assert.equal(plan.buildings[0].targetKey, '9,8,7');
    assert.equal(plan.buildings[0].family, 'basilica');
  }
  const mapped = prepareSceneExteriors(spec({ exits: { east: '9,8,7' } }), new Map([['9,8,7', { name: 'Stone Keep', isIndoor: true }]]));
  assert.equal(mapped.buildings[0].targetKey, '9,8,7');
  assert.equal(mapped.buildings[0].family, 'castle');
});

test('only actual known indoor buildings are planned, with the exact root-name exception', () => {
  for (const indoor of [undefined, false, true]) {
    const root = { name: ROOT.name, ...(indoor === undefined ? {} : { indoor }) };
    assert.equal(prepareSceneExteriors(spec(), { '0,0,0': root }).buildings.length, 1);
  }
  for (const [db, reason] of [
    [{}, 'unknown-destination'],
    [{ '0,0,0': { name: 'Roman Temple' } }, 'unknown-indoor-metadata'],
    [{ '0,0,0': { name: 'Roman Temple', indoor: false } }, 'outdoor-destination'],
    [{ '0,0,0': { name: 'Quiet Cave', indoor: true } }, 'no-building-evidence'],
    [{ '0,0,0': { name: 'A Place', indoor: true } }, 'no-building-evidence']
  ]) {
    const input = spec();
    const plan = prepareSceneExteriors(input, db);
    assert.equal(plan.buildings.length, 0);
    assert.equal(plan.rejected[0].reason, reason);
    const d = room(), original = clone(d);
    assert.equal(applySceneExteriors(d, input).status, 'skipped');
    delete d.sceneExteriors;
    assert.deepEqual(d, original);
  }
  const malformed = prepareSceneExteriors(spec(), '{bad json');
  assert.equal(malformed.buildings.length, 0);
  const invalid = prepareSceneExteriors(spec({ exits: { north: { targetCoordinates: 'garbage' } } }), { '0,0,0': ROOT });
  assert.equal(invalid.buildings.length, 0);
  assert.equal(invalid.rejected[0].reason, 'invalid-target-coordinates');
  const undeclared = prepareSceneExteriors(spec({ exits: [] }), { '0,0,0': ROOT, '0,-1,0': { exits: { north: '0,0,0' } } });
  assert.equal(undeclared.buildings.length, 0);
});

test('campaign seeds vary roofs, dimensions and outdoor forecourts, while revisits and serialization stay stable', () => {
  const variants = [], roofs = new Set(), courts = new Set();
  for (let seed = 0; seed < 16; seed++) {
    const first = compiled(`run-${seed}`), second = compiled(`run-${seed}`);
    assert.equal(first.report.status, 'built', JSON.stringify(first.report));
    assert.deepEqual(first.dungeon, second.dungeon);
    const b = first.report.buildings[0];
    roofs.add(b.roofFamily); courts.add(b.forecourtDepth);
    variants.push(JSON.stringify([b.roofFamily, b.wallHeight, b.towerHeight, b.footprint]));
    assert.ok(b.footprint.width <= 21 && b.footprint.height <= 21);
    assert.equal(b.roofBuilt, b.roofFamily !== 'open');
    assertNavigation(first.before, first.dungeon);
    const saved = JSON.stringify(first.dungeon), report = first.report;
    prepareSceneExteriors(first.input, { '0,0,0': { ...ROOT, description: 'New prose must not migrate saved geometry.' } }, { seed: 'other-run' });
    assert.equal(applySceneExteriors(first.dungeon, first.input), report);
    assert.equal(JSON.stringify(first.dungeon), saved);
    const reloaded = clone(first.dungeon), priorReport = reloaded.sceneExteriors;
    assert.equal(applySceneExteriors(reloaded, first.input), priorReport);
    assert.equal(JSON.stringify(reloaded), saved);
  }
  assert.ok(roofs.size >= 3, [...roofs].join(','));
  assert.ok(courts.size >= 2);
  assert.ok(new Set(variants).size >= 12);
});

test('the same destination template is stable across source rooms and view directions, with complex/site identity overrides', () => {
  const offsets = { north: [0, 1], northeast: [1, 1], east: [1, 0], southeast: [1, -1],
    south: [0, -1], southwest: [-1, -1], west: [-1, 0], northwest: [-1, 1] };
  const parameters = b => [b.complexIdentity, b.family, b.ruined, b.roofFamily, b.transverse, b.depth,
    b.forecourtDepth, b.wallHeight, b.towerHeight];
  let expected;
  for (const [direction, [dx, dy]] of Object.entries(offsets)) {
    const input = spec({ coords: { x: -dx, y: -dy, z: 0 }, exits: [direction], source: { roomName: `Different ${direction} view` } });
    const plan = prepareSceneExteriors(input, { '0,0,0': ROOT }, { seed: 'same-campaign' });
    const b = plan.buildings[0];
    assert.equal(b.complexIdentity, 'ruined-temple');
    expected ||= parameters(b);
    assert.deepEqual(parameters(b), expected, direction);
  }
  for (const field of ['complexId', 'siteId']) {
    const db = { '4,5,0': { name: 'Temple Hall', indoor: true, [field]: 'shared-temple' },
      '4,6,0': { name: 'Temple Hall', indoor: true, [field]: 'shared-temple' } };
    const plans = Object.keys(db).map(target => prepareSceneExteriors(spec({ exits: { north: { targetCoordinates: target } } }), db, { seed: 'same-campaign' }));
    assert.equal(plans[0].buildings[0].complexIdentity, 'shared-temple');
    assert.equal(plans[0].buildings[0].evidence.identitySource, field);
    assert.deepEqual(parameters(plans[0].buildings[0]), parameters(plans[1].buildings[0]));
  }
});

test('marker relocation preserves installer cache identity and existing canonical marker mesh', () => {
  const d = room(), input = spec();
  prepareSceneExteriors(input, { '0,0,0': ROOT }, { seed: 'cache-test' });
  const exits = Exits.install(d, input.exits), marker = exits.markers[0];
  const originalMarker = { ...marker }, part = d.sceneStructures[0], oldPart = clone(part), markerTile = d.tiles[part.tile];
  const report = applySceneExteriors(d, input);
  assert.equal(report.status, 'built');
  assert.equal(Exits.install(d, input.exits), exits);
  assert.equal(exits.markers[0], marker);
  assert.equal(d.sceneStructures[0], part);
  assert.equal(d.tiles[part.tile], markerTile);
  assert.equal(marker.x, report.buildings[0].doorway.x); assert.equal(marker.y, report.buildings[0].doorway.y);
  assert.notEqual(marker.key, originalMarker.key);
  assert.equal(part.position.x, oldPart.position.x + marker.x - originalMarker.x);
  assert.equal(part.position.y, oldPart.position.y + marker.y - originalMarker.y);
  assert.equal(part.shape, oldPart.shape); assert.equal(part.tile, oldPart.tile); assert.ok(!part.skyline);
  assert.equal(Exits.nearby(d, { x: marker.x + 0.5, y: marker.y + 0.5 }), marker);
});

test('compass and corner markers have physical orthogonal doorways, not blocking prop tiles', () => {
  const offsets = { north: [0, 1], northeast: [1, 1], east: [1, 0], southeast: [1, -1],
    south: [0, -1], southwest: [-1, -1], west: [-1, 0], northwest: [-1, 1] };
  for (const [direction, [dx, dy]] of Object.entries(offsets)) {
    const input = spec({ coords: { x: -dx, y: -dy, z: 0 }, exits: [direction] });
    const { dungeon: d, before, report } = compiled('compass', input);
    assert.equal(report.status, 'built', `${direction}: ${JSON.stringify(report)}`);
    const door = report.buildings[0].doorway;
    assert.equal(door.direction, direction);
    assert.equal(door.width, 3);
    for (const p of door.cells) assert.equal(d.cells[p.key].tile, 'floor');
    const shape = door.facing === 'east' || door.facing === 'west' ? 'pediment_side' : 'pediment';
    assert.ok(d.sceneStructures.some(p => p.role === 'exterior-pediment' && p.shape === shape), direction);
    assertNavigation(before, d);
  }
});

test('the real game movement predicates allow a body-radius approach through the travel doorway', () => {
  const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  const code = ['isBlockedDungeonCell', 'canEnterTile', 'getDungeonCellFloorHeight', 'getDungeonSurfaceAt', 'canOccupyPos', 'isObstacleAtPos']
    .map(name => {
      const start = source.indexOf(`function ${name}(`), end = source.indexOf('\nfunction ', start + 1);
      assert.ok(start >= 0 && end > start, name);
      // Only evaluate the function, not the intervening browser initialization or assignments.
      return source.slice(start, source.indexOf('\n}', start) + 2);
    }).join('\n');
  const radius = Number(source.match(/const PLAYER_RADIUS\s*=\s*([\d.]+)/)[1]);
  for (const [name, coords] of [['north', { x: 0, y: -1, z: 0 }], ['west', { x: 1, y: 0, z: 0 }]]) {
    const { dungeon: d, report } = compiled('walk-up', spec({ coords, exits: [name] }));
    assert.equal(report.status, 'built');
    const door = report.buildings[0].doorway;
    const fx = door.x - door.approach.x, fy = door.y - door.approach.y;
    const context = { currentDungeon: d, window: { VoxelCollision: Collision }, PLAYER_RADIUS: radius,
      PLAYER_EYE_HEIGHT: 0.65, MAX_STEP: 1.5, isObstacleTile: tile => tile === 'pillar' || tile.startsWith('custom_'),
      getObstacleRadiusForTile: () => 0.5, playerPosX: door.x + 0.5 - fx * 2, playerPosY: door.y + 0.5 - fy * 2 };
    vm.runInNewContext(code, context);
    for (let step = 0; step <= 32; step++) {
      const x = door.x + 0.5 + fx * (step / 8 - 2), y = door.y + 0.5 + fy * (step / 8 - 2);
      assert.equal(context.isBlockedDungeonCell(d.cells[`${Math.floor(x)},${Math.floor(y)}`]), false);
      assert.equal(context.canOccupyPos(x, y), true, `${name}: step ${step}`);
      context.playerPosX = x; context.playerPosY = y;
    }
    const jamb = door.supports[0].split(',').map(Number);
    assert.equal(context.isBlockedDungeonCell(d.cells[door.supports[0]]), true);
    assert.equal(context.canOccupyPos(jamb[0] + 0.5, jamb[1] + 0.5), false);
    assert.equal(Exits.nearby(d, { x: door.x + 0.5, y: door.y + 0.5 }, 0.05), d.roomExits.markers[0]);
  }
});

test('exactly one front entrance leaves solid rear/side walls and a reserved two-wide walking ring on every face', () => {
  for (const [name, coords] of [['north', { x: 0, y: -1, z: 0 }], ['west', { x: 1, y: 0, z: 0 }]]) {
    const { dungeon: d, report, before } = compiled('single-entrance', spec({ coords, exits: [name] }));
    assert.equal(report.status, 'built', JSON.stringify(report));
    const b = report.buildings[0], f = b.footprint, p = b.perimeter, door = b.doorway;
    const fx = door.x - door.approach.x, fy = door.y - door.approach.y, half = Math.floor(b.transverse / 2);
    const point = (u, v) => ({ x: door.x - fy * u + fx * v, y: door.y + fx * u + fy * v });
    for (let v = 0; v < b.depth; v++) for (let u = -half; u <= half; u++) {
      if (v !== 0 && v !== b.depth - 1 && Math.abs(u) !== half) continue;
      const cell = point(u, v), c = d.cells[`${cell.x},${cell.y}`];
      assert.equal(c.tile, v === 0 && Math.abs(u) <= 1 ? 'floor' : 'wall', `${name}: shell ${u},${v}`);
    }
    assert.equal(Object.values(d.cells).filter(c => c.complexExit === name).length, 3);
    assert.equal(b.ringWidth, 2);
    assert.equal(p.x, f.x - 2); assert.equal(p.y, f.y - 2);
    assert.equal(p.width, f.width + 4); assert.equal(p.height, f.height + 4);
    assert.ok(p.width <= 25 && p.height <= 25);
    const nav = assertNavigation(before, d);
    let count = 0;
    for (let y = p.y; y < p.y + p.height; y++) for (let x = p.x; x < p.x + p.width; x++) {
      if (x >= f.x && x < f.x + f.width && y >= f.y && y < f.y + f.height) continue;
      const key = `${x},${y}`, c = d.cells[key], old = before.cells[key];
      assert.equal(c.tile, 'floor'); assert.equal(c.navigationReserved, true);
      assert.deepEqual(c, { ...old, navigationReserved: true }, `${name}: unchanged terrain ${key}`);
      assert.ok(!c.roof && !c.feature && !c.door && !c.obstacle && !c.blocked);
      assert.ok(nav.seen[y * d.layout.width + x], `${name}: unwalkable ring ${key}`);
      count++;
    }
    assert.equal(b.walkableRingCells, count);
    assert.equal(count, p.width * p.height - f.width * f.height);
    // Standing outside the closed rear and both side walls must remain reachable from spawn.
    for (const [u, v] of [[0, b.depth], [-half - 1, 3], [half + 1, 3]]) {
      const cell = point(u, v);
      assert.equal(d.cells[`${cell.x},${cell.y}`].tile, 'floor');
      assert.ok(nav.seen[cell.y * d.layout.width + cell.x]);
    }
    assert.ok(d.cells[before.roomExits.markers[0].key].navigationReserved);
  }
});

test('two-building cap prioritizes the root temple and rejects unknown or excess destinations', () => {
  const input = spec({ exits: ['south', 'east', 'west', 'north'] });
  const db = { '0,0,0': ROOT, '0,-2,0': { name: 'Stone Keep', indoor: true },
    '1,-1,0': { name: 'Roman Villa', indoor: true }, '-1,-1,0': { name: 'Warehouse', indoor: true } };
  const plan = prepareSceneExteriors(input, db, { seed: 'two-buildings' });
  assert.equal(plan.knownDestinations, 4);
  assert.equal(plan.buildings.length, 2);
  assert.equal(plan.buildings[0].targetKey, '0,0,0');
  assert.equal(plan.rejected.filter(r => r.reason === 'building-limit').length, 2);
  const d = room(96); Exits.install(d, input.exits);
  const before = clone(d), report = applySceneExteriors(d, input);
  assert.equal(report.placed, 2, JSON.stringify(report));
  assertNavigation(before, d);
  assert.equal(report.buildings.reduce((n, b) => n + b.changedCells, 0), report.changedCells);
  const zero = prepareSceneExteriors(spec(), db, { maxBuildings: 0 });
  assert.equal(zero.buildings.length, 0);
  assert.equal(prepareSceneExteriors(spec({ exits: input.exits }), db, { maxBuildings: 999 }).buildings.length, 2);
});

test('existing structures, doors, props, objects, protected routes and spawn are never overwritten', () => {
  const d = room(), input = spec();
  d.cells['32,20'] = { tile: 'door', floorHeight: 0, ceilHeight: 4, door: { locked: false, isOpen: true } };
  d.cells['20,27'] = { tile: 'custom_statue', floorHeight: 0, ceilHeight: 5, feature: 'statue' };
  d.cells['45,4'] = { tile: 'floor', floorHeight: 0, ceilHeight: 2.5, interactable: 'altar' };
  d.sceneObjects.push({ id: 'key', x: 46, y: 8 });
  const sentinel = { tile: 'pillar', shape: 'doric_column', role: 'old-portico',
    position: { x: 1, y: 24, z: 0 }, size: { x: 5, y: 3, z: 5 } };
  d.sceneStructures.push(sentinel);
  prepareSceneExteriors(input, { '0,0,0': ROOT }, { seed: 'protected' });
  Exits.install(d, input.exits);
  const before = clone(d), oldObjects = d.sceneObjects, oldDoor = d.cells['32,20'];
  const oldRefs = new Map(Object.entries(d.cells));
  const report = applySceneExteriors(d, input);
  assert.equal(report.status, 'built', JSON.stringify(report));
  const throat = new Set(report.buildings.flatMap(b => b.doorway.cells.map(p => p.key)));
  for (const [key, c] of Object.entries(before.cells)) {
    if (c.navigationReserved && !throat.has(key) || c.tile !== 'floor' || c.feature || c.interactable || key === '32,32') {
      assert.deepEqual(d.cells[key], c, key);
      assert.equal(d.cells[key], oldRefs.get(key), `identity changed at ${key}`);
    }
  }
  assert.equal(d.cells['32,20'], oldDoor);
  assert.equal(d.sceneObjects, oldObjects);
  assert.equal(d.sceneStructures[0], sentinel);
  assert.deepEqual(sentinel, before.sceneStructures[0]);
  assert.deepEqual(d.sceneObjects, before.sceneObjects);
  assertNavigation(before, d);
});

test('rejected sites are atomic, including tile registration and exit-marker movement', () => {
  for (const mode of ['reserved', 'roof', 'objects', 'parts', 'bad-canonical-tile', 'high', 'steep']) {
    const d = room(), input = spec();
    if (mode === 'reserved') for (const c of Object.values(d.cells)) c.navigationReserved = true;
    if (mode === 'roof') for (const c of Object.values(d.cells)) c.roof = { style: 'old-roof' };
    if (mode === 'objects') d.sceneObjects = [{ x: 32, y: 10 }];
    if (mode === 'objects') for (let y = 1; y <= 28; y++) for (let x = 1; x < 63; x++) d.sceneObjects.push({ x, y });
    if (mode === 'parts') d.sceneStructures.push({ role: 'existing-roof', position: { x: 1, y: 1, z: 4 }, size: { x: 62, y: 30, z: 1 } });
    if (mode === 'bad-canonical-tile') d.tiles.custom_exterior_v1_entablature = { spriteSpec: { voxelShape: 'pediment' } };
    if (mode === 'high') for (const c of Object.values(d.cells)) { c.floorHeight = 14; c.ceilHeight = 16.5; }
    if (mode === 'steep') for (const [key, c] of Object.entries(d.cells)) c.floorHeight = Number(key.split(',')[1]) % 2;
    prepareSceneExteriors(input, { '0,0,0': ROOT }, { seed: 'atomic' });
    Exits.install(d, input.exits);
    const before = clone(d), report = applySceneExteriors(d, input);
    assert.equal(report.status, 'skipped', `${mode}: ${JSON.stringify(report)}`);
    delete d.sceneExteriors;
    assert.deepEqual(d, before, mode);
    assert.ok(report.rejected[0].attempts <= 30);
  }
});

test('reachability checks honor the 1.5 step limit and reject isolated or stale exit markers', () => {
  const d = room(), input = spec();
  // A level top shelf is separated from spawn by an impassable two-unit ledge.
  for (let y = 1; y < 25; y++) for (let x = 1; x < 63; x++) d.cells[`${x},${y}`].floorHeight = 2;
  prepareSceneExteriors(input, { '0,0,0': ROOT }, { seed: 'ledge' });
  d.roomExits = { markers: [{ direction: 'north', x: 32, y: 8, key: '32,8', floor: 2 }] };
  const before = clone(d), report = applySceneExteriors(d, input);
  assert.equal(report.status, 'skipped');
  assert.equal(report.rejected[0].reason, 'unreachable-or-stale-exit-marker');
  delete d.sceneExteriors; assert.deepEqual(d, before);
  const flat = room(); Exits.install(flat, input.exits); flat.roomExits.markers[0].floor = 9;
  assert.equal(applySceneExteriors(flat, input).rejected[0].reason, 'unreachable-or-stale-exit-marker');
});

test('a pinched perimeter beside a reachable side chamber rejects the whole candidate', () => {
  const initial = compiled('branch');
  assert.equal(initial.report.status, 'built');
  const d = clone(initial.before), input = initial.input, f = initial.report.buildings[0].footprint;
  const inside = (x, y) => x >= f.x && y >= f.y && x < f.x + f.width && y < f.y + f.height;
  for (const [key, c] of Object.entries(d.cells)) {
    const [x, y] = key.split(',').map(Number);
    if (!inside(x, y)) c.navigationReserved = true;
  }
  const y = f.y + 3;
  // Existing rock walls pinch the outside ring; never carve them to make the shell fit.
  for (const [x, py] of [[f.x - 2, y], [f.x - 1, y - 1], [f.x - 1, y + 1]]) d.cells[`${x},${py}`].tile = 'wall';
  const before = clone(d);
  assert.ok(reachable(makeNavigation(d), d.start).seen[y * d.layout.width + f.x - 1]);
  const report = applySceneExteriors(d, input);
  assert.equal(report.status, 'skipped', JSON.stringify(report));
  assert.ok(report.rejected[0].siteRejections['no-clear-level-walking-perimeter'] > 0, JSON.stringify(report));
  delete d.sceneExteriors; assert.deepEqual(d, before);
});

test('disabled/indoor/malformed layouts and older exterior reports do not trigger geometry migrations', () => {
  for (const input of [spec({ indoor: true }), spec()]) {
    const d = room(), snapshot = clone(d);
    prepareSceneExteriors(input, { '0,0,0': ROOT }, { enabled: false });
    assert.equal(applySceneExteriors(d, input).status, 'skipped');
    delete d.sceneExteriors; assert.deepEqual(d, snapshot);
  }
  for (const size of [18, 513]) {
    const d = { layout: { width: size, height: size }, start: { x: 2, y: 2 }, cells: {} }, input = spec();
    prepareSceneExteriors(input, { '0,0,0': ROOT });
    assert.equal(applySceneExteriors(d, input).reason, 'invalid-layout-or-start');
  }
  const d = room(), oldReport = { version: 999, status: 'built', buildings: [{ targetKey: 'old' }] };
  d.sceneExteriors = oldReport;
  const snapshot = clone(d);
  assert.equal(applySceneExteriors(d, spec()), oldReport);
  assert.deepEqual(d, snapshot);
});

test('roofless evidence stays roofless and canonical roof meshes are reused without tile overwrites', () => {
  const input = spec();
  const d = room(), canonical = { url: '/entablature.png', spriteSpec: { voxelShape: 'entablature', material: 'marble' } };
  d.tiles.old_entablature = canonical;
  const { report } = compiled('roofless', input, { '0,0,0': { ...ROOT, description: 'A roofless temple entrance.' } }, d);
  assert.equal(report.status, 'built');
  assert.equal(report.buildings[0].roofFamily, 'open');
  assert.equal(report.buildings[0].counts.roofParts, 0);
  assert.equal(d.tiles.old_entablature, canonical);
  assert.ok(d.sceneStructures.filter(p => p.shape === 'entablature').every(p => p.tile === 'old_entablature'));
  assert.ok(!d.sceneStructures.some(p => p.role === 'exterior-roof-shell'));
});

async function withExteriorLab(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-exterior-lab-'));
  const prior = process.env.HOLODEK_SPRITE_DIR;
  const modules = ['../retort/sceneRoomBuilder', '../retort/environmentLab'].map(name => require.resolve(name));
  const saved = modules.map(id => require.cache[id]);
  process.env.HOLODEK_SPRITE_DIR = dir;
  for (const id of modules) delete require.cache[id];
  try { return await run(require('../retort/environmentLab'), require('../retort/sceneRoomBuilder'), dir); }
  finally {
    if (prior === undefined) delete process.env.HOLODEK_SPRITE_DIR; else process.env.HOLODEK_SPRITE_DIR = prior;
    modules.forEach((id, i) => { if (saved[i]) require.cache[id] = saved[i]; else delete require.cache[id]; });
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('holodek-exterior-lab-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the selectable outdoor lab builds two known destinations with real graphics and walkable physical entrances/perimeters', async () => {
  await withExteriorLab(({ buildEnvironmentLab }, graphics, dir) => {
    const d = buildEnvironmentLab('exteriors'), reset = buildEnvironmentLab('exteriors');
    assert.deepEqual(d, reset);
    assert.deepEqual(d.layout, { width: 80, height: 80 });
    assert.deepEqual(d.start, { x: 40, y: 40 });
    assert.equal(d.classification.indoor, false);
    assert.deepEqual(d.sceneSpec.coords, { x: 0, y: -1, z: 0 });
    assert.equal(d.sceneExteriors.placed, 2, JSON.stringify(d.sceneExteriors));
    assert.deepEqual(d.sceneExteriors.buildings.map(b => [b.targetKey, b.targetName, b.family]),
      [['0,0,0', 'Ruined Temple Entrance', 'temple'], ['1,-1,0', 'Basalt Gatehouse', 'castle']]);
    assert.equal(d.roomExits.markers.length, 2);
    assert.ok(d.sceneStructures.some(p => p.role === 'exterior-roof-shell'), 'The gatehouse has a real voxel roof');
    for (const meta of Object.values(d.tiles)) {
      if (meta.url) assert.ok(fs.existsSync(path.join(dir, path.basename(meta.url))), meta.url);
      else assert.equal(meta.spriteSpec?.voxelShape, 'exit_marker');
    }
    for (const part of d.sceneStructures.filter(p => p.skyline)) {
      assert.equal(d.tiles[part.tile].spriteSpec.voxelShape, part.shape);
      assert.ok(Voxels.build(part.shape));
      assert.ok(part.position.z + part.size.z <= 18);
    }
    const source = fs.readFileSync(require.resolve('../assets/environment-lab'), 'utf8');
    const movement = source.slice(source.indexOf('  function clear(x, y)'), source.indexOf('  function draw()'));
    const context = { window: { currentDungeon: d, VoxelCollision: Collision } };
    vm.runInNewContext(movement, context);
    const walk = (x, y) => {
      assert.equal(context.clear(x, y), true, `lab body blocked at ${x},${y}`);
      Object.assign(context.window, { playerPosX: x, playerPosY: y, playerDungeonX: Math.floor(x), playerDungeonY: Math.floor(y) });
    };
    const nav = reachable(makeNavigation(d), d.start);
    for (const b of d.sceneExteriors.buildings) {
      const door = b.doorway, f = b.footprint, p = b.perimeter;
      const marker = d.roomExits.markers.find(m => m.direction === b.direction);
      assert.equal(marker.key, `${door.x},${door.y}`);
      assert.equal(Exits.nearby(d, { x: door.x + 0.5, y: door.y + 0.5 }, 0.05), marker);
      assert.equal(b.evidence.targetSource, 'exit-target-coordinates');
      assert.ok(f.width <= 21 && f.height <= 21 && p.width <= 25 && p.height <= 25);
      const fx = door.x - door.approach.x, fy = door.y - door.approach.y;
      Object.assign(context.window, { playerPosX: door.x + 0.5 - fx * 2, playerPosY: door.y + 0.5 - fy * 2,
        playerDungeonX: door.x - fx * 2, playerDungeonY: door.y - fy * 2 });
      for (let step = 0; step <= 32; step++) walk(door.x + 0.5 + fx * (step / 8 - 2), door.y + 0.5 + fy * (step / 8 - 2));
      // Walk a complete circuit in the inner lane of the two-wide perimeter using the lab's real collision function.
      const corners = [[f.x - 0.5, f.y - 0.5], [f.x + f.width + 0.5, f.y - 0.5],
        [f.x + f.width + 0.5, f.y + f.height + 0.5], [f.x - 0.5, f.y + f.height + 0.5]];
      Object.assign(context.window, { playerPosX: corners[0][0], playerPosY: corners[0][1],
        playerDungeonX: Math.floor(corners[0][0]), playerDungeonY: Math.floor(corners[0][1]) });
      for (let edge = 0; edge < 4; edge++) {
        const a = corners[edge], z = corners[(edge + 1) % 4], steps = Math.ceil(Math.hypot(z[0] - a[0], z[1] - a[1]) * 8);
        for (let step = 0; step <= steps; step++) walk(a[0] + (z[0] - a[0]) * step / steps, a[1] + (z[1] - a[1]) * step / steps);
      }
      let ringCells = 0;
      for (let y = p.y; y < p.y + p.height; y++) for (let x = p.x; x < p.x + p.width; x++) {
        if (x >= f.x && x < f.x + f.width && y >= f.y && y < f.y + f.height) continue;
        const c = d.cells[`${x},${y}`];
        assert.equal(c.tile, 'floor'); assert.equal(c.floorHeight, 0); assert.equal(c.navigationReserved, true);
        assert.ok(nav.seen[y * d.layout.width + x] && !c.roof && !c.feature);
        ringCells++;
      }
      assert.equal(b.walkableRingCells, ringCells);
      assert.equal(Object.values(d.cells).filter(c => c.complexExit === b.direction).length, 3);
    }
    const deadwood = buildEnvironmentLab('deadwood');
    assert.equal(deadwood.sceneVegetation.status, 'built');
    assert.equal(deadwood.roomExits.markers.length, 3);
    assert.ok(!deadwood.sceneExteriors);
    assert.equal(typeof graphics.applySceneGraphics, 'function');
  });
});

test('the existing lab endpoint accepts and caches the new selector without campaign state or renderer changes', async () => {
  await withExteriorLab(({ buildEnvironmentLab, descriptions }) => {
    const html = fs.readFileSync(path.join(__dirname, '../assets/environment-lab.html'), 'utf8');
    assert.match(html, /<option value="exteriors">Outdoor temple return &amp; gatehouse<\/option>/);
    assert.match(html, /src="\/assets\/rendererWebGL\.js"/);
    assert.match(html, /src="\/assets\/environment-lab\.js"/);
    assert.doesNotMatch(html, /src="\/assets\/game\.js"/);
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = source.indexOf("app.get('/environment-lab/:kind'");
    const end = source.indexOf('\n});', start);
    assert.ok(start >= 0 && end > start);
    let handler, builds = 0;
    vm.runInNewContext(source.slice(start, end + 4), { app: { get(route, fn) { assert.equal(route, '/environment-lab/:kind'); handler = fn; } },
      environmentLabKinds: descriptions, environmentLabCache: new Map(), console,
      buildEnvironmentLab(kind) { builds++; return buildEnvironmentLab(kind); } });
    const response = () => ({ headers: {}, statusCode: 200, status(code) { this.statusCode = code; return this; },
      setHeader(key, value) { this.headers[key] = value; }, json(body) { this.body = body; } });
    const first = response(), second = response();
    handler({ params: { kind: 'exteriors' } }, first); handler({ params: { kind: 'exteriors' } }, second);
    assert.equal(first.statusCode, 200); assert.equal(first.headers['Cache-Control'], 'no-store');
    assert.equal(first.body.dungeon.sceneExteriors.placed, 2);
    assert.equal(first.body.dungeon, second.body.dungeon); assert.equal(builds, 1);
    const bad = response(); handler({ params: { kind: 'not-an-exhibit' } }, bad);
    assert.equal(bad.statusCode, 404); assert.equal(builds, 1);
  });
});

test('both actual production exterior call sites run against real compilers and survive the production finalizer', async () => {
  await withExteriorLab((lab, graphics) => {
    const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
    const preparations = [...source.matchAll(/prepareSceneGeography\(sceneSpec,\s*(\w+)\);[\s\S]*?prepareSceneVegetation\(sceneSpec,[^\n]+;/g)];
    const applications = [...source.matchAll(/applySceneRoofs\(dungeon, sceneSpec\);[\s\S]*?console\.info\('\[SceneVegetation\]'[^\n]+;/g)];
    assert.equal(preparations.length, 2); assert.equal(applications.length, 2);
    const roof = require('../retort/sceneRoofs');
    const architecture = require('../retort/sceneArchitecture');
    const geography = require('../retort/sceneGeography');
    const vegetation = require('../retort/sceneVegetation');
    const { buildSceneSpec } = require('../retort/sceneSpec');
    const { deriveLevelSpecFromText, applyLevelSpecToScene } = require('../retort/levelSpec');
    const Living = require('../assets/livingEnvironments');
    const { buildEnvironment } = require('../assets/dungeonEnvironment');
    const db = { '0,-1,0': { name: 'Ashen Crossroads', indoor: false, exits: {
      north: { targetCoordinates: '0,0,0' }, east: { targetCoordinates: '1,-1,0' }
    } }, '0,0,0': ROOT, '1,-1,0': { name: 'Basalt Gatehouse', indoor: true, siteId: 'lab-basalt-gatehouse' } };
    const originalDb = clone(db);
    for (let i = 0; i < preparations.length; i++) {
      const input = { roomName: 'Ashen Crossroads', description: 'The crossroads has no roof. Flat ash plains stretch under the yellow sky.',
        coords: { x: 0, y: -1, z: 0 }, exits: ['north', 'east'], objects: [] };
      const sceneSpec = buildSceneSpec(input), dungeon = room(96), calls = [];
      applyLevelSpecToScene(sceneSpec, deriveLevelSpecFromText(input));
      const trace = (name, fn) => (...args) => { calls.push(name); return fn(...args); };
      const context = { sceneSpec, dungeon, geoKey: '0,-1,0', process: { env: {} },
        sharedState: { getDungeonRunId: () => 'production-exterior-test' },
        [preparations[i][1]]: JSON.stringify(db), LivingEnvironments: Living,
        prepareSceneGeography: trace('prepare-geography', geography.prepareSceneGeography),
        prepareSceneExteriors: trace('prepare-exteriors', prepareSceneExteriors),
        prepareSceneVegetation: trace('prepare-vegetation', vegetation.prepareSceneVegetation),
        applySceneRoofs: trace('roofs', roof.applySceneRoofs),
        placeSceneLandmarks: trace('landmarks', graphics.placeSceneLandmarks),
        placeSceneObjects: trace('objects', graphics.placeSceneObjects),
        DungeonExits: { install: trace('exits', Exits.install) },
        applySceneExteriors: trace('exteriors', applySceneExteriors),
        applySceneVegetation: trace('vegetation', vegetation.applySceneVegetation),
        buildEnvironment, logDungeonConstruction() {}, saveDungeonDiagnostic: () => Promise.resolve(),
        console: { log() {}, info() {}, warn() {}, error() {} } };
      vm.runInNewContext(preparations[i][0], context);
      assert.equal(sceneSpec.exteriorPlan.seed, 'production-exterior-test');
      assert.equal(sceneSpec.exteriorPlan.buildings.length, 2);
      assert.deepEqual(calls, ['prepare-geography', 'prepare-exteriors', 'prepare-vegetation']);
      architecture.applySceneArchitecture(dungeon, sceneSpec);
      geography.applySceneGeography(dungeon, sceneSpec);
      graphics.applySceneGraphics(dungeon, sceneSpec, { geoKey: context.geoKey, customTiles: [] });
      dungeon.sceneSpec = sceneSpec;
      vm.runInNewContext(applications[i][0], context);
      assert.deepEqual(calls.slice(3), ['roofs', 'landmarks', 'objects', 'exits', 'exteriors', 'vegetation']);
      assert.equal(dungeon.sceneExteriors.placed, 2, JSON.stringify(dungeon.sceneExteriors));
      const cells = clone(dungeon.cells), parts = clone(dungeon.sceneStructures), report = clone(dungeon.sceneExteriors);
      const start = source.indexOf('function computeDungeonGeometryStamp('), end = source.indexOf('// Helper to attach a generated sprite', start);
      assert.ok(start >= 0 && end > start);
      vm.runInNewContext(source.slice(start, end), context);
      const finalized = clone(context.finalizeRoomDungeon(context.geoKey, dungeon, dungeon.customTiles));
      assert.deepEqual(finalized.cells, cells); assert.deepEqual(finalized.sceneStructures, parts);
      assert.deepEqual(finalized.sceneExteriors, report);
      assert.equal(finalized._meta.runId, 'production-exterior-test');
      assert.equal(finalized._meta.geometryStamp, finalized._geometryStamp);
      const nav = reachable(makeNavigation(finalized), finalized.start);
      for (const b of finalized.sceneExteriors.buildings) {
        const marker = finalized.roomExits.markers.find(m => m.direction === b.direction);
        assert.ok(b.doorway.cells.some(p => p.key === marker.key));
        assert.ok(nav.seen[marker.y * finalized.layout.width + marker.x]);
      }
    }
    assert.deepEqual(db, originalDb);
    assert.equal(lab.descriptions.exteriors.includes('Ruined Temple Entrance'), true);
  });
});
