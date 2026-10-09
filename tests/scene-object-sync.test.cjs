const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SceneItems = require('../assets/renderSceneItems');
const { sync } = require('../assets/sceneObjectSync');

function consoleText(names, properties = '', key = '0,0,0') {
  const [x, y, z] = key.split(',');
  return `Room Name: Cached Room\nCoordinates: X: ${x}, Y: ${y}, Z: ${z}\nObjects in Room: ${names}\nObjects in Room Properties: ${properties}`;
}

function dungeon(size = 21, more = {}) {
  const cells = {};
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
  return { geoKey: '0,0,0', layout: { width: size, height: size }, cells,
    player: { x: Math.floor(size / 2) + 0.5, y: Math.floor(size / 2) + 0.5 },
    tiles: {}, sceneObjects: [], sceneStructures: [], _geometryStamp: 'saved', ...more };
}

function sparse(cells, more = {}) {
  return dungeon(0, { cells, player: { x: 0.5, y: 0.5 }, ...more });
}
const floor = (height = 0, more = {}) => ({ tile: 'floor', floorHeight: height, ...more });
const item = (name, x, y, more = {}) => ({ id: `saved-${name}`, name, type: 'artifact', magic: 4, x, y, ...more });
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

test('CommonJS, browser and AMD use the existing SceneItems dependency without DOM or network calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/sceneObjectSync.js'), 'utf8');
  let parses = 0, norms = 0;
  const dependency = { parseRoomObjects(text) { parses++; return SceneItems.parseRoomObjects(text); },
    normName(name) { norms++; return SceneItems.normName(name); } };
  const window = { SceneItems: dependency }, context = { window,
    fetch() { throw new Error('No network.'); }, document: new Proxy({}, { get() { throw new Error('No DOM.'); } }) };
  vm.runInNewContext(source, context);
  const d = dungeon(), result = window.SceneObjectSync.sync(d, consoleText('Bronze Key'));
  assert.equal(result.added, 1);
  assert.equal(parses, 1);
  assert.ok(norms > 0);
  assert.equal(window.SceneObjectSync.sync(d, consoleText('Bronze Key')).cacheHit, true);
  assert.equal(parses, 1);
  let amd;
  const define = (dependencies, factory) => { assert.equal(dependencies[0], './renderSceneItems'); amd = factory(SceneItems); };
  define.amd = true;
  vm.runInNewContext(source, { define });
  assert.equal(amd.sync(dungeon(), consoleText('Potion')).added, 1);
  assert.equal(typeof sync, 'function');
});

test('a browser dependency loaded after the helper is handled without clearing existing items', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/sceneObjectSync.js'), 'utf8'), window = {};
  vm.runInNewContext(source, { window });
  const existing = item('Old Key', 2, 3), d = dungeon(21, { sceneObjects: [existing] });
  assert.equal(window.SceneObjectSync.sync(d, consoleText('None')).reason, 'missing-scene-items');
  assert.equal(d.sceneObjects[0], existing);
  window.SceneItems = SceneItems;
  assert.equal(window.SceneObjectSync.sync(d, consoleText('None')).removed, 1);
});

test('new items synchronize into the cached room without geometry, inventory or existing-item changes', () => {
  const assembly = freeze({ kind: 'staff', shaft: 'bone', head: 'orb' });
  const existing = freeze(item('Soul Staff', 2, 3, { assembly, durability: 7, custom: { owner: 'Guardian' } }));
  const d = dungeon(21, { sceneObjects: [existing], inventory: freeze(['Carried Sword']),
    sceneStructures: freeze([{ role: 'arch', position: { x: 6, y: 7, z: 2 } }]) });
  freeze(d.cells); freeze(d.tiles); freeze(d.layout);
  const before = JSON.stringify({ ...d, sceneObjects: undefined }), cells = d.cells, structures = d.sceneStructures;
  const text = consoleText('Soul Staff, bronze seal key', '{name: "bronze seal key", type: "key", magic: 2}');
  const result = sync(d, text);
  assert.equal(result.changed, true);
  assert.equal(result.added, 1);
  assert.equal(result.removed, 0);
  assert.equal(result.updated, 0);
  assert.deepEqual(result.pending, []);
  assert.equal(result.objects, d.sceneObjects);
  assert.equal(result.objects[0], existing);
  assert.equal(result.objects[0].assembly, assembly);
  const added = result.objects[1];
  assert.equal(added.name, 'bronze seal key');
  assert.equal(added.type, 'key');
  assert.equal(added.magic, 2);
  assert.ok(Number.isInteger(added.x) && Number.isInteger(added.y));
  assert.ok(Math.hypot(added.x + 0.5 - d.player.x, added.y + 0.5 - d.player.y) <= 16);
  assert.notEqual(`${added.x},${added.y}`, '2,3');
  assert.equal(d.cells[`${added.x},${added.y}`].tile, 'floor');
  assert.match(added.id, /^scene-item-[0-9a-f]{8}-[0-9a-f]{8}$/);
  assert.equal(JSON.stringify({ ...d, sceneObjects: undefined }), before);
  assert.equal(d.cells, cells);
  assert.equal(d.sceneStructures, structures);
  assert.equal(d._geometryStamp, 'saved');
});

test('wrong-room and missing coordinate consoles never filter or add items', () => {
  for (const text of [consoleText('None', '', '1,0,0'), consoleText('New Key', '', '0,0,1'),
    'Objects in Room: None', 'Boss Room Coordinates: X: 0, Y: 0, Z: 0\nObjects in Room: None',
    `${consoleText('None')}\nCoordinates: X: 2, Y: 0, Z: 0`]) {
    const existing = item('Keep Me', 2, 3), d = dungeon(21, { sceneObjects: [existing] }), before = JSON.stringify(d);
    const result = sync(d, text);
    assert.equal(result.changed, false);
    assert.equal(result.added, 0);
    assert.equal(result.removed, 0);
    assert.equal(result.objects, d.sceneObjects);
    assert.equal(JSON.stringify(d), before);
  }
});

test('geoKey wins over conflicting spec coordinates; spec coordinates authorize a room without geoKey', () => {
  const mismatch = dungeon(21, { geoKey: '5,6,7', sceneSpec: { coords: { x: 0, y: 0, z: 0 } } });
  assert.equal(sync(mismatch, consoleText('Bronze Key')).reason, 'room-mismatch');
  assert.deepEqual(mismatch.sceneObjects, []);
  for (const field of ['sceneSpec', 'spec']) {
    const d = dungeon(21, { geoKey: undefined, [field]: { coords: { x: -123456789, y: 987654321, z: -7 } } });
    assert.equal(sync(d, consoleText('Bronze Key', '', '-123456789,987654321,-7')).added, 1);
  }
  assert.equal(sync(dungeon(21, { geoKey: 'bad' }), consoleText('None')).changed, false);
});

test('missing, blank, ambiguous or malformed object lines do not clear cached items', () => {
  for (const text of ['Coordinates: X: 0, Y: 0, Z: 0', 'Coordinates: X: 0, Y: 0, Z: 0\nObjects in Room: ',
    'Coordinates: X: 0, Y: 0, Z: 0\nObjects in Room: !!!', `${consoleText('None')}\nObjects in Room: Bronze Key`]) {
    const existing = item('Keep Me', 2, 3), d = dungeon(21, { sceneObjects: [existing] }), before = JSON.stringify(d);
    const result = sync(d, text);
    assert.equal(result.changed, false);
    assert.equal(result.objects[0], existing);
    assert.equal(JSON.stringify(d), before);
  }
});

test('explicit None clears only the matching room, with no placement search', () => {
  for (const none of ['None', 'None.', 'nothing']) {
    const existing = item('Key', 2, 3), foreign = item('Other Room Key', 4, 5, { geoKey: '2,0,0' });
    const d = dungeon(21, { sceneObjects: [existing, foreign] });
    const result = sync(d, consoleText(none));
    assert.equal(result.changed, true);
    assert.equal(result.removed, 1);
    assert.equal(result.added, 0);
    assert.equal(result.searched, 0);
    assert.deepEqual(result.objects, [foreign]);
    assert.equal(sync(d, consoleText(none)).changed, false);
  }
});

test('taken items use exact normalized names, never substring or inventory matching', () => {
  const key = item('key', 2, 3), bronze = item('Bronze Key', 4, 5), ring = item('Ring', 6, 7), fire = item('Ring of Fire', 8, 9);
  const d = dungeon(21, { sceneObjects: [key, bronze, ring, fire], inventory: ['key', 'Ring of Fire'] });
  const result = sync(d, `${consoleText('BRONZE-KEY, ring')}\nPC Inventory: key, Ring of Fire`);
  assert.equal(result.removed, 2);
  assert.equal(result.added, 0);
  assert.deepEqual(result.objects, [bronze, ring]);
  assert.equal(result.objects[0].name, 'Bronze Key');
  assert.deepEqual(d.inventory, ['key', 'Ring of Fire']);
});

test('canonical duplicate console names add once; existing duplicate instances remain stable', () => {
  const d = dungeon(), added = sync(d, consoleText('Bronze Key, bronze-key, BRONZE KEY'));
  assert.equal(added.added, 1);
  assert.equal(added.objects.length, 1);
  const first = item('bronze-key', 2, 3), second = item('Bronze Key', 4, 5);
  const duplicates = dungeon(21, { sceneObjects: [first, second] });
  const result = sync(duplicates, consoleText('BRONZE KEY'));
  assert.equal(result.changed, false);
  assert.deepEqual(result.objects, [first, second]);
  assert.equal(result.objects[0], first);
  assert.equal(result.objects[1], second);
});

test('authoritative type and magic update independently while positions, ids and assemblies are preserved', () => {
  const assembly = { kind: 'staff', head: 'skull' }, existing = freeze(item('Bone Staff', 2, 3, { assembly, custom: { preserved: true } }));
  const d = dungeon(21, { sceneObjects: [existing] });
  const update = sync(d, consoleText('Bone Staff', '{name: "Bone Staff", type: "weapon", magic: 0}'));
  assert.equal(update.updated, 1);
  assert.equal(update.added, 0);
  assert.equal(update.removed, 0);
  assert.equal(update.searched, 0);
  assert.equal(update.objects[0].type, 'weapon');
  assert.equal(update.objects[0].magic, 0);
  assert.equal(update.objects[0].id, existing.id);
  assert.equal(update.objects[0].assembly, assembly);
  assert.equal(update.objects[0].custom, existing.custom);
  assert.equal(update.objects[0].x, 2);
  assert.equal(update.objects[0].y, 3);
  const magicOnly = sync(d, consoleText('Bone Staff', '{name: "Bone Staff", magic: 6}'));
  assert.equal(magicOnly.objects[0].type, 'weapon');
  assert.equal(magicOnly.objects[0].magic, 6);
  const typeOnly = sync(d, consoleText('Bone Staff', '{name: "Bone Staff", type: "staff"}'));
  assert.equal(typeOnly.objects[0].type, 'staff');
  assert.equal(typeOnly.objects[0].magic, 6);
  assert.equal(sync(d, consoleText('Bone Staff')).updated, 0);
  assert.equal(d.sceneObjects[0].magic, 6);
  assert.equal(d.sceneObjects[0].type, 'staff');
});

test('unrelated, invalid or missing properties cannot reset existing type/magic or override assembly', () => {
  for (const props of ['', '{name: "Key", type: "potion", magic: 0}', '{name: "Bronze Key", magic: NaN}',
    '{name: "Bronze Key", magic: 2.5}', '{name: "Bronze Key", magic: 999999999999999999999}',
    '{name: "Bronze Key", assembly: "replace", attack: 8}']) {
    const existing = item('Bronze Key', 2, 3, { assembly: { kind: 'key' } }), d = dungeon(21, { sceneObjects: [existing] });
    const result = sync(d, consoleText('Bronze Key', props));
    assert.equal(result.changed, false, props);
    assert.equal(result.objects[0], existing);
  }
});

test('unsafe or malformed magic values cannot enter newly placed item metadata', () => {
  for (const value of ['NaN', 'Infinity', '2.5', '999999999999999999999']) {
    const d = dungeon(), result = sync(d, consoleText('Key', `{name: "Key", type: "key", magic: ${value}}`));
    assert.equal(result.added, 1);
    assert.equal(result.objects[0].type, 'key');
    assert.equal(result.objects[0].magic, 0);
  }
});

test('embedded inventory text cannot override the exact room object or property lines', () => {
  const d = dungeon();
  const text = 'PC Inventory: Objects in Room: Wrong Key\n' +
    'Inventory Description: Objects in Room Properties: {name: "Bronze Key", type: "potion", magic: 9}\n' +
    consoleText('Bronze Key', '{name: "Bronze Key", type: "key", magic: 1}');
  const result = sync(d, text);
  assert.equal(result.added, 1);
  assert.equal(result.objects[0].name, 'Bronze Key');
  assert.equal(result.objects[0].type, 'key');
  assert.equal(result.objects[0].magic, 1);
});

test('large geographic and floor coordinates do not overflow or allocate by layout size', () => {
  const x = 3000000000, y = -4000000000, geoKey = '-5000000000,6000000000,-8';
  const d = sparse({ [`${x},${y}`]: floor(), [`${x + 1},${y}`]: floor(1.5) }, {
    geoKey, player: { x: x + 0.5, y: y + 0.5 }, layout: { width: 9000000000, height: 9000000000 }
  });
  const result = sync(d, consoleText('Bronze Key', '', geoKey));
  assert.equal(result.added, 1);
  assert.equal(result.objects[0].x, x + 1);
  assert.equal(result.objects[0].y, y);
  assert.ok(result.searched < 20);
});

test('height limit is shared at 1.5; reachable ramp floors need not be at the player floor height', () => {
  for (const [height, added] of [[1.5, 1], [1.500001, 0], [-1.5, 1], [-1.500001, 0], [NaN, 0]]) {
    const d = sparse({ '0,0': floor(), '1,0': floor(height) });
    const result = sync(d, consoleText('Key'));
    assert.equal(result.added, added, `height ${height}`);
    if (!added) assert.equal(result.pending.length, 1);
  }
  const existing = item('Existing Token', 1, 0);
  const d = sparse({ '0,0': floor(), '1,0': floor(1.5), '2,0': floor(3) }, { sceneObjects: [existing] });
  const result = sync(d, consoleText('Existing Token, Key'));
  assert.equal(result.added, 1);
  assert.equal(result.objects[1].x, 2);
  assert.equal(result.objects[1].y, 0);
});

test('closed or locked doors block reachability; open doors can be crossed but never receive items', () => {
  for (const [door, expected] of [[{ isOpen: false }, 0], [{ isOpen: true, isLocked: true }, 0],
    [{ isOpen: true, locked: true }, 0], [{ isOpen: true }, 1]]) {
    const d = sparse({ '0,0': floor(), '1,0': { tile: 'door', door, floorHeight: 0 }, '2,0': floor() });
    const result = sync(d, consoleText('Key'));
    assert.equal(result.added, expected);
    if (expected) { assert.equal(result.objects[0].x, 2); assert.equal(result.objects[0].y, 0); }
    else assert.deepEqual(result.objects, []);
  }
});

test('blocked floors, obstacles, props, interaction cells and custom geometry never become new placements', () => {
  for (const blocking of [{ blocked: true }, { obstacle: true }, { blocking: true }, { collisionBlocking: true },
    { walkable: false }, { tile: 'pillar' }, { tile: 'custom_altar' }, { feature: 'furnace' }, { interactable: 'chest' },
    { tile: 'wall' }, { door: { isOpen: false } }]) {
    const d = sparse({ '0,0': floor(), '1,0': floor(0, blocking), '2,0': floor() });
    const before = JSON.stringify(d.cells), result = sync(d, consoleText('Key'));
    assert.equal(result.added, 0, JSON.stringify(blocking));
    assert.equal(result.pending.length, 1);
    assert.deepEqual(result.objects, []);
    assert.equal(JSON.stringify(d.cells), before);
  }
  const d = sparse({ '0,0': floor(), '1,0': floor() }, { tiles: { floor: { spriteSpec: { collisionBlocking: true } } } });
  assert.equal(sync(d, consoleText('Key')).added, 0);
});

test('the player cell and floor exit cells are not used as item landing spots', () => {
  for (const extra of [{ exit: 'east' }, { complexExit: 'east' }, { door: { isOpen: true } }]) {
    const d = sparse({ '0,0': floor(), '1,0': floor(0, extra) });
    assert.equal(sync(d, consoleText('Key')).added, 0);
  }
  assert.equal(sync(sparse({ '0,0': floor() }), consoleText('Key')).pending.length, 1);
});

test('an unreachable island is not selected just because it is a floor near the player', () => {
  const d = sparse({ '0,0': floor(), '1,0': { tile: 'wall' }, '2,0': floor(), '0,1': floor() });
  const result = sync(d, consoleText('Key'));
  assert.equal(result.added, 1);
  assert.equal(result.objects[0].x, 0);
  assert.equal(result.objects[0].y, 1);
});

test('safe preferred floors win; fallback is reachable and never exceeds 32 tiles', () => {
  for (const target of [16, 17, 32, 33]) {
    const cells = { '0,0': floor() };
    for (let x = 1; x < target; x++) cells[`${x},0`] = { tile: 'door', door: { isOpen: true }, floorHeight: 0 };
    cells[`${target},0`] = floor();
    const d = sparse(cells), result = sync(d, consoleText('Key'));
    assert.equal(result.added, target <= 32 ? 1 : 0, `target ${target}`);
    if (result.added) assert.equal(result.objects[0].x, target);
  }
  const cells = { '0,0': floor(), '0,1': floor() };
  for (let x = 1; x < 20; x++) cells[`${x},0`] = { tile: 'door', door: { isOpen: true } };
  cells['20,0'] = floor();
  const result = sync(sparse(cells), consoleText('Key'));
  assert.deepEqual([result.objects[0].x, result.objects[0].y], [0, 1]);
});

test('no safe floor yields pending names, not fabricated coordinates; repeat calls perform no cell reads', () => {
  let reads = 0;
  const cells = new Proxy({ '0,0': floor() }, { get(target, key) { reads++; return target[key]; } });
  const d = sparse(cells), text = consoleText('Key');
  const first = sync(d, text);
  assert.equal(first.changed, false);
  assert.equal(first.added, 0);
  assert.equal(first.pending[0].name, 'Key');
  assert.equal(first.pending[0].reason, 'no-reachable-floor');
  assert.equal('x' in first.pending[0], false);
  assert.equal('y' in first.pending[0], false);
  reads = 0;
  for (let i = 0; i < 100; i++) {
    const repeated = sync(d, `${text}\nTurn: ${i}`);
    assert.equal(repeated.cacheHit, true);
    assert.equal(repeated.changed, false);
    assert.equal(repeated.searched, 0);
    assert.equal(repeated.pending.length, 1);
  }
  assert.equal(reads, 0);
});

test('successful repeats do not rerun BFS or relocate items as the player moves', () => {
  const d = dungeon(), text = consoleText('Soul Staff, Bronze Key');
  sync(d, text);
  const objects = d.sceneObjects, before = JSON.stringify(objects);
  d.cells = new Proxy(d.cells, { get() { throw new Error('No placement reads when every item is present.'); } });
  assert.equal(sync(d, text).searched, 0);
  for (let i = 0; i < 100; i++) {
    d.player = { x: i + 0.5, y: 0.5 };
    const repeated = sync(d, text);
    assert.equal(repeated.cacheHit, true);
    assert.equal(repeated.changed, false);
    assert.equal(repeated.objects, objects);
    assert.equal(repeated.added, 0);
  }
  assert.equal(JSON.stringify(d.sceneObjects), before);
});

test('player overrides place new discoveries near a wandering actor without rescanning resolved items', () => {
  for (const cachedPlayer of [undefined, { x: 0.5, y: 0.5 }]) {
    const cells = { '0,0': floor(), '1,0': floor() };
    for (let y = 180; y <= 184; y++) for (let x = 200; x <= 204; x++) cells[`${x},${y}`] = floor();
    const reads = [];
    const d = sparse(new Proxy(cells, { get(data, key) { reads.push(key); return data[key]; } }), {
      player: cachedPlayer, start: { x: 0.5, y: 0.5 }, sceneSpec: { indoor: false }
    });
    const text = consoleText('Old Key');
    const first = sync(d, text, { player: { x: 0.5, y: 0.5 } });
    assert.equal(first.added, 1);
    const original = d.sceneObjects, existing = original[0], existingBefore = JSON.stringify(existing);
    reads.length = 0;
    for (let i = 0; i < 50; i++) {
      const result = sync(d, text, { player: { x: 200.25 + i, y: 180.75 } });
      assert.equal(result.cacheHit, true);
      assert.equal(result.changed, false);
      assert.equal(result.searched, 0);
      assert.equal(result.objects, original);
    }
    assert.equal(reads.length, 0);

    const player = Object.freeze({ x: 200.75, y: 180.25 });
    const result = sync(d, consoleText('Old Key, Wandering Seal Key'), { player });
    assert.equal(result.added, 1);
    assert.equal(result.pending.length, 0);
    assert.ok(result.searched > 0 && result.searched <= 4096);
    assert.equal(result.objects[0], existing);
    assert.equal(JSON.stringify(existing), existingBefore);
    const added = result.objects[1];
    assert.ok(Math.hypot(added.x + 0.5 - player.x, added.y + 0.5 - player.y) <= 16);
    assert.ok(Math.hypot(added.x + 0.5 - d.start.x, added.y + 0.5 - d.start.y) > 200);
    for (const key of reads) {
      const [x, y] = key.split(',').map(Number);
      assert.ok(Math.hypot(x + 0.5 - player.x, y + 0.5 - player.y) <= 32);
    }
    assert.equal(d.player, cachedPlayer);
    assert.deepEqual(d.start, { x: 0.5, y: 0.5 });
    assert.deepEqual(player, { x: 200.75, y: 180.25 });
    assert.equal(d._geometryStamp, 'saved');
  }
});

test('explicit player overrides require finite numeric coordinates and never silently fall back to spawn', () => {
  for (const player of [null, {}, { x: NaN, y: 0.5 }, { x: 0.5, y: Infinity }, { x: '0.5', y: 0.5 },
    { x: 0.5 }, { x: Number.MAX_SAFE_INTEGER + 1, y: 0.5 }]) {
    const d = sparse({ '0,0': floor(), '1,0': floor() }, { start: { x: 0.5, y: 0.5 } });
    const before = JSON.stringify(d), result = sync(d, consoleText('Key'), { player });
    assert.equal(result.added, 0);
    assert.equal(result.changed, false);
    assert.equal(result.searched, 0);
    assert.equal(result.pending.length, 1);
    assert.equal(JSON.stringify(d), before);
  }
  const d = sparse({ '0,0': floor(), '1,0': floor() });
  assert.equal(sync(d, consoleText('Key'), { player: undefined }).added, 1);
});

test('pending-player cache follows override tile changes, not the dungeon spawn anchor', () => {
  let reads = 0;
  const cells = new Proxy({ '0,0': floor(), '200,200': floor(), '201,200': floor() }, {
    get(data, key) { reads++; return data[key]; }
  });
  const d = sparse(cells, { player: undefined, start: { x: 0.5, y: 0.5 } }), text = consoleText('Key');
  const first = sync(d, text, { player: { x: 0.5, y: 0.5 } });
  assert.equal(first.pending.length, 1);
  reads = 0;
  const stationary = sync(d, text, { player: { x: 0.75, y: 0.25 } });
  assert.equal(stationary.cacheHit, true);
  assert.equal(stationary.searched, 0);
  assert.equal(reads, 0);
  const moved = sync(d, text, { player: { x: 200.5, y: 200.5 } });
  assert.equal(moved.added, 1);
  assert.equal(moved.pending.length, 0);
  assert.ok(moved.searched > 0 && moved.searched <= 4096);
  assert.deepEqual([moved.objects[0].x, moved.objects[0].y], [201, 200]);
  assert.equal(d.player, undefined);
  assert.equal(d._geometryStamp, 'saved');
});

test('outdoor player overrides support large floor and GEO coordinates without overflow or later rescans', () => {
  const x = 3000000000, y = -4000000000, geoKey = '-5000000000,6000000000,-8';
  let reads = 0;
  const cells = new Proxy({ '0,0': floor(), '1,0': floor(), [`${x},${y}`]: floor(), [`${x + 1},${y}`]: floor(1.5) }, {
    get(data, key) { reads++; return data[key]; }
  });
  const d = sparse(cells, { geoKey, player: undefined, start: { x: 0.5, y: 0.5 },
    sceneSpec: { indoor: false }, layout: { width: 9000000000, height: 9000000000 } });
  const player = { x: x + 0.75, y: y + 0.25 }, text = consoleText('Bronze Key', '', geoKey);
  const first = sync(d, text, { player });
  assert.equal(first.added, 1);
  assert.deepEqual([first.objects[0].x, first.objects[0].y], [x + 1, y]);
  assert.ok(Math.hypot(first.objects[0].x + 0.5 - player.x, first.objects[0].y + 0.5 - player.y) <= 16);
  assert.ok(first.searched < 20);
  reads = 0;
  const repeated = sync(d, text, { player: { x: x + 200.5, y: y - 200.5 } });
  assert.equal(repeated.cacheHit, true);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.searched, 0);
  assert.equal(repeated.objects, first.objects);
  assert.equal(reads, 0);
});

test('pending placements retry when geometry, a collision revision or player tile changes', () => {
  for (const change of ['stamp', 'revision', 'player', 'cells']) {
    const d = sparse({ '0,0': floor() }), text = consoleText('Key');
    assert.equal(sync(d, text).pending.length, 1);
    let options;
    if (change === 'cells') d.cells = { ...d.cells, '1,0': floor() };
    else d.cells['1,0'] = floor();
    if (change === 'stamp') d._geometryStamp = 'new';
    if (change === 'revision') options = { revision: 1 };
    if (change === 'player') d.player = { x: 1.5, y: 0.5 };
    const result = sync(d, text, options);
    assert.equal(result.added, 1);
    assert.equal(result.pending.length, 0);
    assert.ok(result.searched > 0);
  }
});

test('WeakMap state is per-dungeon even for the same geoKey and console signature', () => {
  const left = dungeon(), right = dungeon(), text = consoleText('Key');
  const a = sync(left, text), b = sync(right, text);
  assert.equal(a.added, 1);
  assert.equal(b.added, 1);
  assert.deepEqual(a.objects, b.objects);
  assert.notEqual(a.objects, b.objects);
});

test('a mismatched console does not poison the cache or clear pending/successful state', () => {
  const d = dungeon(), text = consoleText('Key');
  sync(d, text);
  const objects = d.sceneObjects;
  assert.equal(sync(d, consoleText('None', '', '8,8,8')).changed, false);
  const restored = sync(d, text);
  assert.equal(restored.cacheHit, true);
  assert.equal(restored.objects, objects);
});

test('signature cache observes in-place scene item edits and replaced lists without moving other items', () => {
  const d = dungeon(), text = consoleText('Key, Ring');
  sync(d, text);
  const ring = d.sceneObjects.find(value => value.name === 'Ring'), key = d.sceneObjects.find(value => value.name === 'Key');
  d.sceneObjects = [ring];
  const restored = sync(d, text);
  assert.equal(restored.added, 1);
  assert.equal(restored.objects[0], ring);
  assert.equal(restored.objects[1].id, key.id);
  restored.objects[1].name = 'Incorrect Key';
  const corrected = sync(d, text);
  assert.equal(corrected.removed, 1);
  assert.equal(corrected.added, 1);
  assert.equal(corrected.objects[0], ring);
});

test('default additions cap at 32; hard cap and local placement pool never exceed 64', () => {
  const names = Array.from({ length: 100 }, (_, i) => `Token ${i}`).join(', ');
  for (const [options, expected] of [[undefined, 32], [{ maxAdded: 64 }, 64], [{ maxAdded: 999999 }, 64], [{ maxAdded: 0 }, 0]]) {
    const d = dungeon(129), text = consoleText(names), result = sync(d, text, options);
    assert.equal(result.added, expected);
    assert.equal(result.pending.length, 100 - expected);
    assert.ok(result.searched <= 4096);
    assert.equal(new Set(result.objects.map(value => `${value.x},${value.y}`)).size, expected);
    for (const object of result.objects) assert.ok(Math.hypot(object.x + 0.5 - d.player.x, object.y + 0.5 - d.player.y) <= 16);
    const repeated = sync(d, text, options);
    assert.equal(repeated.cacheHit, true);
    assert.equal(repeated.added, 0);
    assert.equal(repeated.searched, 0);
    assert.equal(repeated.pending.length, 100 - expected);
  }
});

test('bounded navigation never scans a large room database or uses layout-sized allocations', () => {
  let reads = 0;
  const cells = new Proxy({}, {
    get(target, key) { reads++; return /^-?\d+,-?\d+$/.test(String(key)) ? floor(0, { exit: 'portal' }) : undefined; },
    ownKeys() { throw new Error('No full room scans.'); }
  });
  const d = sparse(cells, { layout: { width: 1000000000, height: 1000000000 } });
  const result = sync(d, consoleText('Key'), { maxSearchNodes: 80, fallbackRadius: 9999 });
  assert.equal(result.added, 0);
  assert.equal(result.pending.length, 1);
  assert.ok(result.searched <= 80);
  assert.ok(reads <= 80);
  reads = 0;
  assert.equal(sync(d, consoleText('Key'), { maxSearchNodes: 80, fallbackRadius: 9999 }).searched, 0);
  assert.equal(reads, 0);
});

test('placement candidates are revalidated and blocked cells are not committed', () => {
  const target = floor();
  let targetReads = 0;
  const cells = new Proxy({ '0,0': floor(), '1,0': target }, { get(data, key) {
    if (key === '1,0' && ++targetReads > 1) return { ...target, blocked: true };
    return data[key];
  } });
  const result = sync(sparse(cells), consoleText('Key'));
  assert.equal(result.added, 0);
  assert.equal(result.pending.length, 1);
  assert.deepEqual(result.objects, []);
});

test('failed placement checks remain bounded across a large pending console list', () => {
  let reads = 0;
  const fetched = new Set();
  const cells = new Proxy({}, { get(data, key) {
    if (!/^-?\d+,-?\d+$/.test(String(key))) return undefined;
    reads++;
    if (fetched.has(key)) return floor(0, { blocked: true });
    fetched.add(key);
    return floor();
  } });
  const names = Array.from({ length: 500 }, (_, i) => `Token ${i}`).join(', ');
  const result = sync(sparse(cells), consoleText(names), { maxSearchNodes: 120 });
  assert.equal(result.added, 0);
  assert.equal(result.pending.length, 500);
  assert.ok(reads <= 120 + 64, `Navigation and placement reads must stay bounded, got ${reads}`);
});

test('ids remain deterministic through removal, re-addition, property changes and saved reloads', () => {
  const d = dungeon(), text = consoleText('Bronze Key');
  const original = sync(d, text).objects[0];
  sync(d, consoleText('None'));
  const readded = sync(d, text).objects[0];
  assert.equal(readded.id, original.id);
  assert.deepEqual([readded.x, readded.y], [original.x, original.y]);
  const updated = sync(d, consoleText('Bronze Key', '{name: "Bronze Key", type: "key", magic: 3}')).objects[0];
  assert.equal(updated.id, original.id);
  const saved = JSON.parse(JSON.stringify(d)), positions = JSON.stringify(saved.sceneObjects);
  assert.equal(sync(saved, consoleText('Bronze Key', '{name: "Bronze Key", type: "key", magic: 3}')).changed, false);
  assert.equal(JSON.stringify(saved.sceneObjects), positions);
  const elsewhere = dungeon(21, { geoKey: '1,0,0' });
  assert.notEqual(sync(elsewhere, consoleText('Bronze Key', '', '1,0,0')).objects[0].id, original.id);
});

test('missing geometry or player leaves new items pending without initializing unrelated fields', () => {
  const d = { geoKey: '0,0,0' }, before = JSON.stringify(d);
  const result = sync(d, consoleText('Bronze Key'));
  assert.equal(result.changed, false);
  assert.equal(result.pending.length, 1);
  assert.equal(result.searched, 0);
  assert.equal(JSON.stringify(d), before);
  assert.equal(sync(null, consoleText('None')).reason, 'missing-dungeon');
});
