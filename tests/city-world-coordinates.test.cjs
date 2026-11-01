'use strict';
for (const flag of ['CITY_SITES', 'CITY_COMPLETE']) process.env['HOLODEK_' + flag] = '1';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const City = require('../retort/citySites'), Routes = require('../assets/outdoorRoutes');
const city = { id: 'coordinate-city', name: 'Authored City' };
const anchor = (exits = {}) => ({ name: 'Arrival Hall', exits, environmentIntent: { citySite: city } });
test('new city north from the origin is 0,1,0, not a private Z=30 street', () => {
  const db = { '0,0,0': anchor() }, report = City.install(db, '0,0,0', { seed: 'two-live-session-regression' });
  assert.equal(report.status, 'installed'); assert.equal(report.direction, 'north');
  assert.equal(db['0,0,0'].exits.north.targetCoordinates, '0,1,0');
  assert.equal(db['0,1,0'].exits.south.targetCoordinates, '0,0,0');
  for (const [key, room] of Object.entries(db)) if (room.cityRoom?.kind === 'street') assert.equal(Routes.coordinates(key).z, 0);
});
test('every new street direction is a real adjacent world coordinate across genres and seeds', () => {
  for (const genre of ['fantasy', 'dark-fantasy', 'cyberpunk', 'sci-fi', 'modern']) for (let i = 0; i < 12; i++) {
    const plan = City.plan({ seed: 'world-grid-' + i, city, anchorKey: '-5,7,-3', genre });
    assert.equal(plan.coordinateMode, 'world-grid'); assert.deepEqual(City.validate(plan), []);
    const streets = new Set(plan.rooms.filter(r => r.kind === 'street').map(r => r.key));
    for (const room of plan.rooms.filter(r => r.kind === 'street')) for (const [direction, exit] of Object.entries(room.exits)) {
      if (!streets.has(exit.targetCoordinates) && exit.targetCoordinates !== plan.anchorKey) continue;
      const from = Routes.coordinates(room.key);
      assert.equal(exit.targetCoordinates, Routes.resolveExit(from, direction, {}).targetKey);
    }
  }
});
test('blocked north uses a free cardinal neighbor and rotates the street graph without changing Z', () => {
  const protectedRoom = { name: 'Existing North', description: 'Preserve this room', visited: true };
  const db = { '0,0,0': anchor({ north: { status: 'open', targetCoordinates: '0,1,0' } }), '0,1,0': protectedRoom };
  const report = City.install(db, '0,0,0', { seed: 'rotated' });
  assert.equal(report.status, 'installed'); assert.equal(report.direction, 'east');
  assert.equal(db['0,0,0'].exits.east.targetCoordinates, '1,0,0');
  assert.equal(db['1,0,0'].exits.west.targetCoordinates, '0,0,0'); assert.equal(db['0,1,0'], protectedRoom);
});
test('occupied street coordinates are preserved by choosing another gate, never by moving streets up 30 levels', () => {
  const db = { '0,0,0': anchor(), '0,1,0': { name: 'Protected', visited: true } }, before = JSON.stringify(db['0,1,0']);
  const report = City.install(db, '0,0,0', { seed: 'collision' });
  assert.equal(report.status, 'installed'); assert.notEqual(report.direction, 'north'); assert.equal(JSON.stringify(db['0,1,0']), before);
  for (const [key, room] of Object.entries(db)) if (room.cityRoom?.kind === 'street') assert.equal(Routes.coordinates(key).z, 0);
});
test('no safe cardinal gate fails without any partial room installation or vertical shortcut', () => {
  const exits = Object.fromEntries(['north', 'east', 'south', 'west'].map(d => [d, { status: 'open' }]));
  const db = { '0,0,0': anchor(exits) }, before = JSON.stringify(db);
  assert.equal(City.install(db, '0,0,0').status, 'skipped'); assert.equal(JSON.stringify(db), before);
});
test('old installed city coordinates, descriptions, dead residents and quests stay untouched', () => {
  const db = { '0,0,0': { ...anchor(), citySites: { version: 'world1-city-sites-1', gateKey: '0,0,30' },
    exits: { north: { status: 'open', targetCoordinates: '0,0,30' } } },
    '0,0,30': { name: 'Saved Street', description: 'Authored prose', cityRoom: { anchorKey: '0,0,0', completion: require('../retort/cityCompletion').VERSION },
      inhabitants: { actors: { Saved: { status: 'dead' } } }, questStories: ['Keep'] } };
  const before = JSON.stringify(db); assert.equal(City.install(db, '0,0,0').status, 'already-installed'); assert.equal(JSON.stringify(db), before);
});
test('validation rejects a world-grid street exit that changes Z or skips an adjacent coordinate', () => {
  const plan = City.plan({ seed: 'validate', city, anchorKey: '0,0,0' });
  const street = plan.rooms.find(r => r.kind === 'street' && r.exits.north && r.exits.north.targetCoordinates !== plan.anchorKey);
  const target = plan.rooms.find(r => r.key === street.exits.north.targetCoordinates);
  target.key = '0,0,30'; street.exits.north.targetCoordinates = target.key;
  assert.ok(City.validate(plan).some(error => /adjacent|world-grid/.test(error)));
});
test('first-entry construction uses saved city exits, not the provisional client exit list', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const start = source.indexOf('  if (construction || currentRoomData.backgroundTopology || currentRoomData.preparedBuild || FortifiedSites.isFloor(currentRoomData)'),
    end = source.indexOf('  // Repair empty/missing classification', start);
  assert.ok(start > 0 && end > start);
  for (const kind of ['cityRoom', 'citySites', 'backgroundTopology', 'preparedBuild']) {
    const currentRoomData = { name: 'Saved Authored Street', [kind]: {}, exits: {
      south: { status: 'open', targetCoordinates: '0,0,0' }, north: { status: 'open', targetCoordinates: '0,2,0' } } };
    const context = { construction: null, currentRoomData, FortifiedSites: { isFloor: () => false }, roomExitsArray: ['down', 'west'], existingAdjacentRooms: [],
      updatedGameConsole: 'Room Name: Provisional\nExits: down, west\nAdjacent Rooms: None',
      roomNameDatabasePlain: { '0,0,0': { name: 'Arrival Hall' }, '0,2,0': { name: 'Next Street' } } };
    vm.runInNewContext(source.slice(start, end), context);
    assert.deepEqual(context.roomExitsArray, ['south', 'north']); assert.deepEqual(context.existingAdjacentRooms, ['south', 'north']);
    assert.match(context.updatedGameConsole, /Exits: south, north/); assert.match(context.updatedGameConsole, /south: Arrival Hall, north: Next Street/);
  }
});
test('new world-grid plans never clamp the anchor to hide an out-of-bounds gate', () => {
  const p = City.plan({ city, anchorKey: '1000,1000,0' });
  assert.equal(p.gateKey, '1000,1001,0'); assert.ok(City.validate(p).some(e => /out of bounds/.test(e)));
  const db = { '1000,1000,0': anchor() }, before = JSON.stringify(db);
  const result = City.install(db, '1000,1000,0');
  if (result.status === 'installed') {
    for (const [key, room] of Object.entries(db)) if (room.cityRoom) assert.ok(key.split(',').every(n => Math.abs(Number(n)) <= 1000));
  } else assert.equal(JSON.stringify(db), before);
});
test('each cardinal orientation has an adjacent reciprocal gate and contiguous street routes', () => {
  for (const direction of ['north', 'east', 'south', 'west']) {
    const plan = City.plan({ city, anchorKey: '7,-9,4', gateDirection: direction, seed: 'rotation' });
    assert.equal(plan.gateKey, Routes.resolveExit('7,-9,4', direction, {}).targetKey); assert.deepEqual(City.validate(plan), []);
  }
});
