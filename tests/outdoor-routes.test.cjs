const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ensureContinuation } = require('../assets/outdoorRoutes');

const OFFSETS = {
  north: [0, 1, 0], northeast: [1, 1, 0], east: [1, 0, 0], southeast: [1, -1, 0],
  south: [0, -1, 0], southwest: [-1, -1, 0], west: [-1, 0, 0], northwest: [-1, 1, 0],
  up: [0, 0, 1], down: [0, 0, -1]
};
const REVERSE = { north: 'south', northeast: 'southwest', east: 'west', southeast: 'northwest',
  south: 'north', southwest: 'northeast', west: 'east', northwest: 'southeast', up: 'down', down: 'up' };
const origin = { x: 0, y: 0, z: 0 };
const keyOf = coords => `${coords.x},${coords.y},${coords.z}`;
const coordsOf = key => { const [x, y, z] = key.split(',').map(Number); return { x, y, z }; };
const step = (coords, dir) => {
  const [x, y, z] = OFFSETS[dir];
  return { x: coords.x + x, y: coords.y + y, z: coords.z + z };
};
const depth = (coords, from = origin) => Math.abs(coords.x - from.x) + Math.abs(coords.y - from.y) + Math.abs(coords.z - from.z);
const exit = (targetCoordinates, more = {}) => ({ status: 'open', targetCoordinates, key: null, ...more });
const outdoor = (more = {}) => ({ name: 'Existing Wastes', indoor: false, exits: {}, ...more });
const snapshot = value => JSON.stringify(value instanceof Map ? Object.fromEntries(value) : value);

test('CommonJS, browser and AMD expose the same dependency-free helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/outdoorRoutes.js'), 'utf8');
  assert.equal(typeof ensureContinuation, 'function');
  const context = { window: {}, fetch: () => { throw new Error('No network calls.'); } };
  vm.runInNewContext(source, context);
  assert.equal(typeof context.window.OutdoorRoutes.ensureContinuation, 'function');
  const room = outdoor(), db = new Map([['0,0,0', room]]);
  assert.equal(context.window.OutdoorRoutes.ensureContinuation(db, origin, []).added, true);
  let amd;
  const define = (dependencies, factory) => { assert.equal(dependencies.length, 0); amd = factory(); };
  define.amd = true;
  vm.runInNewContext(source, { define });
  assert.equal(typeof amd.ensureContinuation, 'function');
});

test('all ten reserved routes use GEO offsets, including north +y and south -y', () => {
  for (const dir of Object.keys(OFFSETS)) {
    const expected = step(origin, dir), db = { '0,0,0': outdoor({ outdoorContinuation: dir }) };
    const result = ensureContinuation(db, origin, []);
    assert.equal(result.reason, 'reused-reserved-continuation');
    assert.equal(result.direction, dir);
    assert.equal(result.targetKey, keyOf(expected));
    assert.deepEqual(db['0,0,0'].exits[dir], exit(keyOf(expected), { outdoorContinuation: true }));
    assert.deepEqual(db[result.targetKey].exits[REVERSE[dir]], exit('0,0,0', { outdoorContinuation: true }));
  }
});

for (const databaseType of ['object', 'Map']) {
  test(`${databaseType}: supplements rather than replacing existing generator mechanics`, () => {
    const coords = { x: 3, y: 2, z: 0 }, sourceKey = keyOf(coords);
    const incomingKey = keyOf(step(coords, 'west'));
    const locked = { status: 'locked', targetCoordinates: '4,2,0', key: 'Brass Key', puzzle: { required: ['sun', 'moon'] } };
    const openIndoor = exit(step(coords, 'north'), { mechanism: 'sluice' });
    const incoming = exit(incomingKey);
    const existingExits = { west: incoming, east: locked, north: openIndoor };
    const objects = [{ name: 'Brass Key', unlocks: { coordinates: '4,2,0', direction: 'east' } }];
    const monsters = { inRoom: 'Guardian', state: 'alive' };
    const room = outdoor({ exits: existingExits, objects, monsters, trapTriggered: true,
      attemptedSearches: 3, description: 'Existing room description', classification: { indoor: false, biome: 'wasteland', size: 96 } });
    const roomBefore = structuredClone(room), metadataBefore = JSON.stringify(existingExits);
    const entries = { [sourceKey]: room, [incomingKey]: outdoor(), '4,2,0': outdoor(), '3,3,0': { indoor: true, name: 'Temple' } };
    const db = databaseType === 'Map' ? new Map(Object.entries(entries)) : entries;
    const get = key => db instanceof Map ? db.get(key) : db[key];
    const generated = ['west', 'east', 'north'];
    const result = ensureContinuation(db, coords, generated, { fromKey: incomingKey, seed: 'mechanics' });
    assert.equal(result.added, true);
    assert.deepEqual(result.exits, generated.concat(result.direction));
    assert.deepEqual(generated, ['west', 'east', 'north']);
    assert.equal(room.exits, existingExits);
    assert.equal(room.exits.west, incoming);
    assert.equal(room.exits.east, locked);
    assert.equal(room.exits.north, openIndoor);
    const preserved = { ...room.exits };
    delete preserved[result.direction];
    assert.equal(JSON.stringify(preserved), metadataBefore);
    for (const field of Object.keys(roomBefore).filter(field => field !== 'exits')) assert.deepEqual(room[field], roomBefore[field]);
    assert.equal(room.objects, objects);
    assert.equal(room.monsters, monsters);
    assert.deepEqual(room.exits[result.direction], exit(result.targetKey, { outdoorContinuation: true }));
    const target = get(result.targetKey);
    assert.deepEqual(Object.keys(target).sort(), ['name', 'indoor', 'isIndoor', 'isOutdoor', 'classification', 'exits',
      'outdoorContinuationSource', 'outdoorRegionOrigin', 'outdoorRegionDepth'].sort());
    assert.equal(target.indoor, false);
    assert.equal(target.isIndoor, false);
    assert.equal(target.isOutdoor, true);
    assert.deepEqual(target.classification, { indoor: false, biome: 'wasteland' });
    assert.deepEqual(target.exits[REVERSE[result.direction]], exit(sourceKey, { outdoorContinuation: true }));
    assert.equal(target.outdoorContinuationSource, sourceKey);
    assert.deepEqual(target.outdoorRegionOrigin, origin);
    assert.equal(room.outdoorContinuation, result.direction);
    assert.equal(room.outdoorRegionDepth, depth(coords));
    assert.equal(target.outdoorRegionDepth, depth(coordsOf(result.targetKey)));
    assert.ok(target.outdoorRegionDepth > room.outdoorRegionDepth);
    assert.equal('objects' in target, false);
    assert.equal('monsters' in target, false);
    assert.equal('dungeon' in target, false);
  });
}

test('unknown and indoor sources are skipped without creating or normalizing rooms', () => {
  for (const room of [undefined, 'Old Room', {}, { classification: {} }, { indoor: null }, { indoor: 'false' },
    { indoor: true, isOutdoor: true }, { classification: { indoor: true }, isOutdoor: true }, { isIndoor: true }, { isOutdoor: false }]) {
    const db = { '0,0,0': room }, before = snapshot(db), input = ['s', 'Locked Gallery'];
    const result = ensureContinuation(db, origin, input);
    assert.equal(result.added, false);
    assert.equal(result.direction, null);
    assert.equal(result.targetKey, null);
    assert.deepEqual(result.exits, input);
    assert.equal(snapshot(db), before);
  }
});

test('direct, classification and indoor/outdoor boolean flags authorize only known outdoor sources', () => {
  for (const flags of [{ indoor: false }, { classification: { indoor: false } }, { isIndoor: false }, { isOutdoor: true },
    { indoor: false, classification: { indoor: true }, isOutdoor: false }]) {
    const room = { ...flags, exits: {} }, db = { '0,0,0': room };
    const originalFlags = structuredClone(flags);
    assert.equal(ensureContinuation(db, origin, []).added, true);
    for (const field of Object.keys(flags)) assert.deepEqual(room[field], originalFlags[field]);
  }
});

test('an explicit open, unvisited outward outdoor exit suffices with no metadata changes', () => {
  const coords = { x: 2, y: 0, z: 0 };
  for (const targetCoordinates of ['3,0,0', { x: 3, y: 0, z: 0 }]) {
    const metadata = exit(targetCoordinates, { key: 'Previously Unlocked Key', custom: 'preserved' });
    const db = { '2,0,0': outdoor({ exits: { E: metadata } }), '3,0,0': { classification: { indoor: false } } };
    const before = snapshot(db);
    const result = ensureContinuation(db, coords, ['E'], { fromKey: '1,0,0', visitedKeys: new Set(['1,0,0']) });
    assert.equal(result.added, false);
    assert.equal(result.reason, 'existing-deeper-outdoor-exit');
    assert.equal(result.direction, 'east');
    assert.equal(result.targetKey, '3,0,0');
    assert.deepEqual(result.exits, ['E']);
    assert.equal(snapshot(db), before);
  }
});

test('visited outward, sideways, inward and incoming outdoor routes do not satisfy the rule', () => {
  const coords = { x: 2, y: 0, z: 0 };
  const cases = [
    { target: '3,0,0', visitedKeys: new Set(['3,0,0']) },
    { target: '1,1,0' },
    { target: '1,0,0' },
    { target: '3,0,0', fromKey: '3,0,0' },
    { target: '3,0,0', visited: true },
    { target: '3,0,0', visitCount: 1 }
  ];
  for (const { target, visited, visitCount, ...options } of cases) {
    const oldExit = exit(target), db = { '2,0,0': outdoor({ exits: { east: oldExit } }),
      [target]: outdoor({ ...(visited ? { visited } : {}), ...(visitCount ? { visitCount } : {}) }) };
    const destinationBefore = JSON.stringify(db[target]);
    const result = ensureContinuation(db, coords, ['east'], options);
    assert.equal(result.added, true);
    assert.deepEqual(result.exits, ['east', result.direction]);
    assert.notEqual(result.direction, 'east');
    assert.notEqual(result.targetKey, target);
    assert.ok(depth(coordsOf(result.targetKey)) > depth(coords));
    assert.equal(db['2,0,0'].exits.east, oldExit);
    assert.equal(JSON.stringify(db[target]), destinationBefore);
  }
});

test('saved greater region depth can qualify an existing outdoor exit', () => {
  const coords = { x: 4, y: 0, z: 0 };
  const db = { '4,0,0': outdoor({ outdoorRegionDepth: 20, exits: { west: exit('3,0,0') } }),
    '3,0,0': outdoor({ outdoorRegionDepth: 21 }) };
  const before = snapshot(db);
  assert.equal(ensureContinuation(db, coords, ['west']).added, false);
  assert.equal(snapshot(db), before);
  assert.equal(ensureContinuation(db, coords, ['west'], { visitedKeys: new Set(['3,0,0']) }).added, true);
});

test('unknown or indoor destinations never qualify just because an exit is open', () => {
  for (const destination of [undefined, {}, 'Wasteland Name Only', { indoor: true, isOutdoor: true }, { indoor: null }]) {
    const db = { '2,0,0': outdoor({ exits: { east: exit('3,0,0') } }), '3,0,0': destination };
    const before = JSON.stringify(destination);
    const result = ensureContinuation(db, { x: 2, y: 0, z: 0 }, ['east']);
    assert.equal(result.added, true);
    assert.notEqual(result.direction, 'east');
    assert.equal(JSON.stringify(db['3,0,0']), before);
  }
});

test('every lock representation is preserved and does not count as an open continuation', () => {
  for (const locking of [{ status: 'locked', key: 'Iron Key' }, { status: 'closed' }, { status: 'sealed' },
    { locked: true }, { isLocked: true }, { door: { isLocked: true } }, { status: null }]) {
    const locked = exit('3,0,0', locking), before = JSON.stringify(locked);
    const db = { '2,0,0': outdoor({ exits: { east: locked } }), '3,0,0': outdoor() };
    const result = ensureContinuation(db, { x: 2, y: 0, z: 0 }, ['east']);
    assert.equal(result.added, true);
    assert.notEqual(result.direction, 'east');
    assert.equal(db['2,0,0'].exits.east, locked);
    assert.equal(JSON.stringify(locked), before);
  }
});

test('array, string and object inputs preserve order and aliases while reserving used directions', () => {
  const descriptor = Object.freeze({ direction: 'NE', status: 'locked', targetCoordinates: '1,1,0', key: 'Moon Key' });
  for (const [input, expected] of [
    [Object.freeze(['S', descriptor, 'N-W']), ['S', descriptor, 'N-W']],
    ['S; NE, N-W', ['S', 'NE', 'N-W']],
    [Object.freeze({ S: 'open', NE: descriptor, 'N-W': { status: 'locked' } }), ['S', 'NE', 'N-W']]
  ]) {
    const db = { '0,0,0': outdoor() }, before = JSON.stringify(input);
    const result = ensureContinuation(db, origin, input, { seed: 'input-shapes' });
    assert.equal(result.added, true);
    assert.deepEqual(result.exits.slice(0, -1), expected);
    assert.ok(!['south', 'northeast', 'northwest'].includes(result.direction));
    assert.equal(JSON.stringify(input), before);
  }
});

test('input metadata targets and aliases qualify even before generator persistence', () => {
  const coords = { x: 1, y: 1, z: 0 }, input = [{ direction: 'n-e', status: 'OPEN', targetCoordinates: { x: 2, y: 2, z: 0 } }];
  const db = { '1,1,0': outdoor(), '2,2,0': { isOutdoor: true } }, before = snapshot(db);
  const result = ensureContinuation(db, coords, input);
  assert.equal(result.added, false);
  assert.equal(result.direction, 'northeast');
  assert.equal(result.exits[0], input[0]);
  assert.equal(snapshot(db), before);
});

test('locks in either stored or input metadata veto conflicting open records', () => {
  for (const sourceLocked of [true, false]) {
    const db = { '1,0,0': outdoor({ exits: { E: exit('2,0,0', { status: sourceLocked ? 'locked' : 'open' }) } }), '2,0,0': outdoor() };
    const input = { east: exit('2,0,0', { status: sourceLocked ? 'open' : 'locked' }) };
    const before = JSON.stringify(db['1,0,0'].exits.E);
    const result = ensureContinuation(db, { x: 1, y: 0, z: 0 }, input);
    assert.equal(result.added, true);
    assert.notEqual(result.direction, 'east');
    assert.equal(JSON.stringify(db['1,0,0'].exits.E), before);
  }
});

test('eligible explicit reservations are reused without overwriting their exit metadata', () => {
  for (const reservation of ['room', 'exit']) {
    const metadata = exit({ x: 3, y: 0, z: 0 }, { outdoorContinuation: true, custom: 'retain verbatim' });
    const room = outdoor({ exits: { E: metadata }, ...(reservation === 'room' ? { outdoorContinuation: 'E' } : {}) });
    const db = { '2,0,0': room }, before = JSON.stringify(metadata);
    const result = ensureContinuation(db, { x: 2, y: 0, z: 0 }, ['south']);
    assert.equal(result.added, true);
    assert.equal(result.reason, 'reused-reserved-continuation');
    assert.equal(result.direction, 'east');
    assert.deepEqual(result.exits, ['south', 'east']);
    assert.equal(room.exits.E, metadata);
    assert.equal(JSON.stringify(metadata), before);
    assert.equal('east' in room.exits, false);
    assert.deepEqual(db['3,0,0'].exits.west, exit('2,0,0', { outdoorContinuation: true }));
  }
});

test('a direction-only reservation reuses an outdoor stub and preserves its other exits', () => {
  const locked = exit('3,1,0', { status: 'locked', key: 'Stone Key' });
  const target = outdoor({ name: 'Reserved Reach', exits: { N: locked } });
  const db = { '2,0,0': outdoor({ outdoorContinuation: 'E' }), '3,0,0': target };
  const result = ensureContinuation(db, { x: 2, y: 0, z: 0 }, []);
  assert.equal(result.reason, 'reused-reserved-continuation');
  assert.equal(result.targetKey, '3,0,0');
  assert.equal(target.name, 'Reserved Reach');
  assert.equal(target.exits.N, locked);
  assert.deepEqual(target.exits.west, exit('2,0,0', { outdoorContinuation: true }));
  assert.equal(target.outdoorContinuationSource, '2,0,0');
});

test('an existing reserved reciprocal exit is retained byte for byte', () => {
  const reciprocal = exit({ x: 2, y: 0, z: 0 }, { terrain: 'bridge', key: 'Used Key' });
  const target = outdoor({ exits: { W: reciprocal } });
  const db = { '2,0,0': outdoor({ outdoorContinuation: 'east' }), '3,0,0': target };
  const before = JSON.stringify(reciprocal);
  assert.equal(ensureContinuation(db, { x: 2, y: 0, z: 0 }, []).added, true);
  assert.equal(target.exits.W, reciprocal);
  assert.equal(JSON.stringify(reciprocal), before);
  assert.equal('west' in target.exits, false);
});

test('locked, visited, inward, indoor or conflicting reciprocal reservations are not repaired destructively', () => {
  const cases = [
    { metadata: exit('3,0,0', { status: 'locked', outdoorContinuation: true }), target: outdoor() },
    { metadata: exit('3,0,0', { outdoorContinuation: true }), target: outdoor(), visitedKeys: new Set(['3,0,0']) },
    { metadata: exit('1,0,0', { outdoorContinuation: true }), target: undefined },
    { metadata: exit('3,0,0', { outdoorContinuation: true }), target: { indoor: true } },
    { target: outdoor({ exits: { west: exit('2,0,0', { status: 'locked' }) } }) },
    { target: outdoor({ exits: { west: exit('9,9,0') } }) },
    { target: outdoor({ description: 'Detailed saved destination.' }) }
  ];
  for (const { metadata, target, visitedKeys } of cases) {
    const targetKey = metadata?.targetCoordinates || '3,0,0';
    const room = outdoor({ outdoorContinuation: 'east', exits: metadata ? { east: metadata } : {} });
    const db = { '2,0,0': room, [targetKey]: target }, before = JSON.stringify(target), metadataBefore = JSON.stringify(metadata);
    const result = ensureContinuation(db, { x: 2, y: 0, z: 0 }, [], { visitedKeys });
    assert.equal(result.added, true);
    assert.notEqual(result.direction, 'east');
    assert.equal(JSON.stringify(db[targetKey]), before);
    if (metadata) assert.equal(JSON.stringify(room.exits.east), metadataBefore);
  }
});

test('a qualifying generator route does not repair or overwrite the destination reverse mechanics', () => {
  const db = { '2,0,0': outdoor({ exits: { east: exit('3,0,0') } }),
    '3,0,0': outdoor({ exits: { west: exit('2,0,0', { status: 'locked', key: 'Keep This Key' }) } }) };
  const before = snapshot(db);
  assert.equal(ensureContinuation(db, { x: 2, y: 0, z: 0 }, ['east']).added, false);
  assert.equal(snapshot(db), before);
});

test('saved rooms are idempotent even if the generator omits the supplemental direction', () => {
  let db = { '0,0,0': outdoor() };
  const first = ensureContinuation(db, origin, [], { seed: 42 });
  db = JSON.parse(JSON.stringify(db));
  const before = snapshot(db);
  for (const input of [first.exits, []]) {
    const result = ensureContinuation(db, origin, input, { seed: 'different-seed' });
    assert.equal(result.added, false);
    assert.equal(result.direction, first.direction);
    assert.equal(result.targetKey, first.targetKey);
    assert.ok(result.exits.includes(first.direction));
    assert.equal(snapshot(db), before);
  }
});

test('walking into the saved continuation excludes the return route and adds exactly one deeper route', () => {
  const db = new Map([['0,0,0', outdoor()]]);
  const first = ensureContinuation(db, origin, [], { seed: 'walk' });
  const target = db.get(first.targetKey), reverse = target.exits[REVERSE[first.direction]];
  const next = ensureContinuation(db, coordsOf(first.targetKey), Object.keys(target.exits), {
    fromKey: '0,0,0', visitedKeys: new Set(['0,0,0']), seed: 'walk'
  });
  assert.equal(next.added, true);
  assert.equal(db.size, 3);
  assert.equal(target.exits[REVERSE[first.direction]], reverse);
  assert.ok(depth(coordsOf(next.targetKey)) > depth(coordsOf(first.targetKey)));
  assert.equal(next.exits.length, 2);
  const before = snapshot(db);
  assert.equal(ensureContinuation(db, coordsOf(first.targetKey), next.exits, {
    fromKey: '0,0,0', visitedKeys: new Set(['0,0,0'])
  }).added, false);
  assert.equal(snapshot(db), before);
});

test('a changed incoming room or visited set causes a saved room to gain a new outward supplement', () => {
  for (const revisit of ['incoming', 'visited']) {
    const db = { '2,0,0': outdoor() }, coords = { x: 2, y: 0, z: 0 };
    const first = ensureContinuation(db, coords, [], { seed: 'revisit' });
    const original = db['2,0,0'].exits[first.direction];
    const options = revisit === 'incoming' ? { fromKey: first.targetKey } : { visitedKeys: new Set([first.targetKey]) };
    const second = ensureContinuation(db, coords, first.exits, options);
    assert.equal(second.added, true);
    assert.notEqual(second.targetKey, first.targetKey);
    assert.equal(db['2,0,0'].exits[first.direction], original);
    assert.deepEqual(second.exits, first.exits.concat(second.direction));
    assert.equal(Object.keys(db).length, 3);
  }
});

test('new coordinates are preferred over empty unknown stubs, with horizontal before vertical', () => {
  const probe = ensureContinuation({ '0,0,0': outdoor() }, origin, [], { seed: 'preference' });
  const db = { '0,0,0': outdoor(), [probe.targetKey]: {} };
  const result = ensureContinuation(db, origin, [], { seed: 'preference' });
  assert.equal(result.added, true);
  assert.notEqual(result.targetKey, probe.targetKey);
  assert.equal(OFFSETS[result.direction][2], 0);
  assert.deepEqual(db[probe.targetKey], {});

  const stub = { name: '', indoor: null, isIndoor: null, isOutdoor: null, exits: {},
    visited: false, objects: [], attemptedSearches: 0, outdoorRegionDepth: 0 };
  const constrained = { '0,0,0': outdoor(), [probe.targetKey]: stub };
  for (const dir of Object.keys(OFFSETS).slice(0, 8)) {
    const key = keyOf(step(origin, dir));
    if (key !== probe.targetKey) constrained[key] = { indoor: true };
  }
  const reused = ensureContinuation(constrained, origin, [], { seed: 'preference' });
  assert.equal(reused.targetKey, probe.targetKey);
  assert.equal(constrained[probe.targetKey], stub);
  assert.equal(stub.indoor, false);
  assert.ok(stub.outdoorRegionDepth > 0);
  assert.deepEqual(stub.objects, []);
  assert.equal('monsters' in stub, false);
});

test('detailed, named, classified and visited unknown rooms are never converted', () => {
  for (const fields of [{ name: 'Named Unclassified Place' }, { description: 'Already described' }, { roomDescription: 'Detailed' },
    { visited: true }, { visitCount: 2 }, { visitedAt: '2026-01-01' }, { visitedAt: 0 }, { lastVisitedAt: 0 },
    { createdAt: new Date('2026-01-01T00:00:00Z') },
    { dungeon: {} }, { dungeon: { cells: {} } }, { sceneSpec: {} }, { sceneSpec: { indoor: null } },
    { objects: [{ name: 'Relic' }] }, { monsters: { inRoom: 'Guardian' } }, { classification: { biome: 'temple', size: 32 } },
    { exits: { north: exit('9,9,9', { status: 'locked' }) } }]) {
    const db = { '0,0,0': outdoor() };
    for (const dir of Object.keys(OFFSETS)) {
      const key = keyOf(step(origin, dir));
      db[key] = structuredClone(fields);
    }
    const before = snapshot(db);
    const result = ensureContinuation(db, origin, []);
    assert.equal(result.added, false, `Protected metadata: ${JSON.stringify(fields)}`);
    assert.equal(result.reason, 'no-available-outward-route');
    assert.equal(snapshot(db), before);
  }
});

test('vertical outward fallback works only after all eight horizontal directions are unavailable', () => {
  for (const z of [2, -2]) {
    const coords = { x: 2, y: 1, z }, db = { [keyOf(coords)]: outdoor() };
    for (const dir of Object.keys(OFFSETS).slice(0, 8)) db[keyOf(step(coords, dir))] = { indoor: true };
    const result = ensureContinuation(db, coords, []);
    assert.equal(result.added, true);
    assert.equal(result.direction, z > 0 ? 'up' : 'down');
    assert.deepEqual(db[result.targetKey].exits[REVERSE[result.direction]], exit(keyOf(coords), { outdoorContinuation: true }));
    assert.ok(depth(coordsOf(result.targetKey)) > depth(coords));
  }
});

test('inward empty coordinates cannot be claimed when every outward direction is blocked', () => {
  const coords = { x: 2, y: 3, z: 4 }, db = { [keyOf(coords)]: outdoor() };
  for (const dir of Object.keys(OFFSETS)) {
    const adjacent = step(coords, dir);
    if (depth(adjacent) > depth(coords)) db[keyOf(adjacent)] = { indoor: true, name: 'Protected Indoor Room' };
  }
  const before = snapshot(db), result = ensureContinuation(db, coords, []);
  assert.equal(result.added, false);
  assert.equal(result.reason, 'no-available-outward-route');
  assert.deepEqual(result.exits, []);
  assert.equal(snapshot(db), before);
});

test('all known indoor neighbors or all used directions report failure without mutation', () => {
  for (const mode of ['neighbors', 'exits']) {
    const db = { '0,0,0': outdoor() };
    for (const dir of Object.keys(OFFSETS)) {
      const key = keyOf(step(origin, dir));
      if (mode === 'neighbors') db[key] = { indoor: true, description: 'Protected room' };
      else db['0,0,0'].exits[dir] = exit(key, { status: 'locked', key: `${dir} Key` });
    }
    const input = mode === 'exits' ? Object.keys(db['0,0,0'].exits) : [];
    const before = snapshot(db), result = ensureContinuation(db, origin, input);
    assert.equal(result.added, false);
    assert.equal(result.direction, null);
    assert.equal(result.targetKey, null);
    assert.equal(result.reason, 'no-available-outward-route');
    assert.deepEqual(result.exits, input);
    assert.equal(snapshot(db), before);
  }
});

test('origin options and saved origins drive geometry; visited keys normalize without mutation', () => {
  const coords = { x: 8, y: 5, z: -2 }, regionalOrigin = { x: 10, y: 5, z: -2 };
  for (const saved of [true, false]) {
    const room = outdoor(saved ? { outdoorRegionOrigin: regionalOrigin } : {});
    const db = { '8,5,-2': room, '9,5,-2': outdoor(), '7,5,-2': outdoor() };
    room.exits = { east: exit('9,5,-2'), west: exit('7,5,-2') };
    const visitedKeys = new Set([' 7, 5,-2 ', { x: 9, y: 5, z: -2 }]);
    const beforeVisited = [...visitedKeys];
    const result = ensureContinuation(db, coords, ['east', 'west'], { visitedKeys, ...(saved ? {} : { origin: regionalOrigin }) });
    assert.equal(result.added, true);
    assert.ok(depth(coordsOf(result.targetKey), regionalOrigin) > depth(coords, regionalOrigin));
    assert.deepEqual(db[result.targetKey].outdoorRegionOrigin, regionalOrigin);
    assert.deepEqual([...visitedKeys], beforeVisited);
  }
});

test('an explicit origin overrides the default or saved region origin for qualification', () => {
  const coords = { x: 8, y: 0, z: 0 }, room = outdoor({ outdoorRegionOrigin: origin, exits: { west: exit('7,0,0') } });
  const db = { '8,0,0': room, '7,0,0': outdoor() }, before = snapshot(db);
  const result = ensureContinuation(db, coords, ['west'], { origin: { x: 10, y: 0, z: 0 } });
  assert.equal(result.added, false);
  assert.equal(result.targetKey, '7,0,0');
  assert.equal(snapshot(db), before);
});

test('safe outdoor biomes inherit; indoor or unsupported biomes fall back to wasteland', () => {
  for (const [source, expected] of [
    [{ biome: 'forest' }, 'forest'], [{ classification: { indoor: false, biome: 'canyon' } }, 'canyon'],
    [{ classification: { indoor: false, biome: 'ruins' } }, 'ruins'], [{ biome: 'temple' }, 'wasteland'],
    [{ classification: { biome: 'crypt' } }, 'wasteland'], [{ biome: 'unknown' }, 'wasteland']
  ]) {
    const db = { '0,0,0': outdoor(source) }, result = ensureContinuation(db, origin, []);
    assert.equal(db[result.targetKey].classification.biome, expected);
  }
});

test('seeded routes and names are deterministic and coordinate-unique', () => {
  const left = { '0,0,0': outdoor() }, right = { '0,0,0': outdoor() };
  assert.deepEqual(ensureContinuation(left, origin, [], { seed: 'repeatable' }), ensureContinuation(right, origin, [], { seed: 'repeatable' }));
  assert.equal(snapshot(left), snapshot(right));
  const names = new Set();
  for (let x = 0; x < 100; x++) {
    const db = { [`${x},0,0`]: outdoor() }, result = ensureContinuation(db, { x, y: 0, z: 0 }, [], { seed: 'repeatable' });
    const name = db[result.targetKey].name;
    assert.match(name, /Wasteland/);
    assert.equal(names.has(name), false);
    names.add(name);
  }
});

test('100-room linear exploration grows one minimal stub per step with no database scans or circuits', () => {
  class BoundedDatabase extends Map {
    reads = 0;
    get(key) { this.reads++; return super.get(key); }
    entries() { throw new Error('Route creation must not scan the database.'); }
    values() { throw new Error('Route creation must not scan room names.'); }
    [Symbol.iterator]() { throw new Error('Route creation must not scan the database.'); }
  }
  const db = new BoundedDatabase([['0,0,0', outdoor()]]), visitedKeys = new Set(), names = new Set();
  let coords = origin, fromKey = null, previousDepth = -1;
  for (let i = 0; i < 100; i++) {
    const sourceKey = keyOf(coords), current = db.get(sourceKey);
    db.reads = 0;
    const result = ensureContinuation(db, coords, Object.keys(current.exits), { fromKey, visitedKeys, seed: 'long-walk' });
    assert.equal(result.added, true);
    assert.ok(db.reads <= 15, `Only immediate candidates should be read, got ${db.reads}`);
    assert.equal(db.size, i + 2);
    assert.equal(visitedKeys.has(result.targetKey), false);
    const target = db.get(result.targetKey), next = coordsOf(result.targetKey);
    assert.ok(depth(next) > depth(coords));
    assert.ok(target.outdoorRegionDepth > previousDepth);
    assert.ok(Object.keys(current.exits).length <= 2);
    assert.equal(Object.keys(target.exits).length, 1);
    assert.ok(Object.keys(target).length <= 9);
    assert.equal('objects' in target, false);
    assert.equal('monsters' in target, false);
    assert.equal(names.has(target.name), false);
    names.add(target.name);
    const metadata = JSON.stringify(current);
    const repeated = ensureContinuation(db, coords, result.exits, { fromKey, visitedKeys, seed: 'long-walk' });
    assert.equal(repeated.added, false);
    assert.equal(JSON.stringify(current), metadata);
    assert.equal(db.size, i + 2);
    visitedKeys.add(sourceKey);
    fromKey = sourceKey;
    coords = next;
    previousDepth = target.outdoorRegionDepth;
  }
  assert.equal(db.size, 101);
  assert.equal(visitedKeys.size, 100);
  assert.equal(names.size, 100);
});

test('invalid coordinates, origins and explicit targets cannot produce malformed routes', () => {
  for (const coords of [null, {}, { x: 0, y: 0 }, { x: NaN, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }]) {
    const db = { '0,0,0': outdoor() }, before = snapshot(db);
    assert.equal(ensureContinuation(db, coords, []).reason, 'invalid-coordinates');
    assert.equal(snapshot(db), before);
  }
  const db = { '0,0,0': outdoor() }, before = snapshot(db);
  assert.equal(ensureContinuation(db, origin, [], { origin: { x: 0, y: 0 } }).reason, 'invalid-origin');
  assert.equal(snapshot(db), before);
  for (const targetCoordinates of ['bad', { x: 1, y: 0 }, null]) {
    const room = outdoor({ exits: { east: exit(targetCoordinates, { outdoorContinuation: true }) } });
    const malformed = { '0,0,0': room }, metadataBefore = JSON.stringify(room.exits.east);
    const result = ensureContinuation(malformed, origin, ['east']);
    assert.equal(result.added, true);
    assert.notEqual(result.direction, 'east');
    assert.equal(JSON.stringify(room.exits.east), metadataBefore);
  }
  assert.equal(ensureContinuation(null, origin, []).reason, 'invalid-database');
  assert.equal(ensureContinuation({}, origin, []).reason, 'missing-room');
});

test('protectedKeys veto new and reserved explicit destinations in object and Map databases', () => {
  for (const databaseType of ['object', 'Map']) for (const protectedValue of ['X: 3, Y: 0, Z: 0', ' 3, 0, 0 ', { x: 3, y: 0, z: 0 }]) {
    const metadata = exit('X: 3, Y: 0, Z: 0', { outdoorContinuation: true, key: 'Exact existing key' });
    const room = outdoor({ outdoorContinuation: 'E', exits: { E: metadata } });
    const entries = { '2,0,0': room }, db = databaseType === 'Map' ? new Map(Object.entries(entries)) : entries;
    const before = JSON.stringify(metadata), result = ensureContinuation(db, { x: 2, y: 0, z: 0 }, [], {
      protectedKeys: new Set([protectedValue]), seed: 'protected-boss'
    });
    assert.equal(result.added, true);
    assert.notEqual(result.targetKey, '3,0,0');
    assert.equal(db instanceof Map ? db.has('3,0,0') : Object.hasOwn(db, '3,0,0'), false);
    assert.equal(JSON.stringify(metadata), before);
    assert.equal(room.exits.E, metadata);
  }
});

test('protected existing outdoor destinations cannot count as deeper routes or acquire reverse links', () => {
  for (const reservation of [false, true]) {
    const room = outdoor({ exits: { east: exit('3,0,0') }, ...(reservation ? { outdoorContinuation: 'east' } : {}) });
    const target = outdoor({ name: 'Exact bound boss room', classification: { indoor: false, biome: 'ruins', size: 48 } });
    const db = { '2,0,0': room, '3,0,0': target }, before = JSON.stringify(target);
    const result = ensureContinuation(db, { x: 2, y: 0, z: 0 }, ['east'], { protectedKeys: ['X: 3, Y: 0, Z: 0'] });
    assert.equal(result.added, true);
    assert.notEqual(result.targetKey, '3,0,0');
    assert.equal(JSON.stringify(target), before);
    assert.equal(target.exits.west, undefined);
  }
});

test('all protected outward targets skip without console-side state, key, identity or classification changes', () => {
  const coords = { x: 2, y: 0, z: 0 }, protectedKeys = Object.keys(OFFSETS).map(dir => step(coords, dir));
  const db = { '2,0,0': outdoor({ classification: { indoor: false, biome: 'wasteland' } }) }, before = snapshot(db);
  const result = ensureContinuation(db, coords, [], { protectedKeys });
  assert.equal(result.reason, 'no-available-outward-route');
  assert.equal(result.added, false);
  assert.equal(snapshot(db), before);
  assert.equal(ensureContinuation(db, coords, [], { protectedKeys: 'X: 2, Y: 0, Z: 0' }).reason, 'protected-source');
});

test('bossGate metadata vetoes existing boss rooms and source-held pending boss targets', () => {
  const coords = { x: 2, y: 0, z: 0 };
  const target = outdoor({ bossGate: { targetKey: 'X: 3, Y: 0, Z: 0', bossName: 'Exact boss' } });
  const db = { '2,0,0': outdoor({ exits: { east: exit('3,0,0') }, outdoorContinuation: 'east' }), '3,0,0': target };
  const before = JSON.stringify(target), result = ensureContinuation(db, coords, ['east']);
  assert.equal(result.added, true);
  assert.notEqual(result.targetKey, '3,0,0');
  assert.equal(JSON.stringify(target), before);
  const pending = { '2,0,0': outdoor({ bossGate: { targetKey: '3,0,0' }, outdoorContinuation: 'east' }) };
  assert.notEqual(ensureContinuation(pending, coords, []).targetKey, '3,0,0');
});

test('known classification objects, including empty classifications, are never replaced by route seeding', () => {
  const db = { '0,0,0': outdoor() };
  for (const dir of Object.keys(OFFSETS)) db[keyOf(step(origin, dir))] = { classification: {} };
  const before = snapshot(db), result = ensureContinuation(db, origin, []);
  assert.equal(result.added, false);
  assert.equal(snapshot(db), before);
});
