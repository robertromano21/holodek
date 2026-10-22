const test = require('node:test');
const assert = require('node:assert/strict');
process.env.HOLODEK_CITY_SITES = '1';
const C = require('../retort/citySites');
const city = { id: 'test-city', name: 'Ash Gate City', role: 'test' };
const GENRES = ['fantasy', 'western', 'sci-fi', 'cyberpunk', 'nautical', 'steampunk'];

test('city plans are 30-60 rooms, connected, reciprocal, every building returns to its street', () => {
  for (const genre of GENRES) for (let i = 0; i < 60; i++) {
    const p = C.plan({ seed: `run${i}`, city, anchorKey: '0,3,0', genre });
    assert.ok(p.rooms.length >= 30 && p.rooms.length <= 60, `${genre} ${i} size ${p.rooms.length}`);
    assert.deepEqual(C.validate(p), [], `${genre} ${i}`);
    assert.ok(p.stats.districts >= 6, 'districts');
    const byKey = new Map(p.rooms.map(r => [r.key, r]));
    for (const b of p.rooms.filter(r => r.kind === 'building')) {
      assert.ok(Object.values(b.exits).some(e => e.targetCoordinates === b.streetKey), `${b.name} has a return exit`);
      assert.equal(byKey.get(b.streetKey).kind, 'street');
    }
    assert.ok(p.rooms.every(r => Number(r.key.split(',')[2]) >= 29), 'city rooms stay off the anchor layer');
  }
});

test('plans are deterministic per seed and vary across seeds', () => {
  const a = C.plan({ seed: 'x', city, genre: 'western' }), b = C.plan({ seed: 'x', city, genre: 'western' }), c = C.plan({ seed: 'y', city, genre: 'western' });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.rooms.map(r => r.key), c.rooms.map(r => r.key));
});

test('genre styles differ; fantasy keeps the current look', () => {
  const f = C.plan({ seed: 's', city, genre: 'fantasy' }), w = C.plan({ seed: 's', city, genre: 'western' }), s = C.plan({ seed: 's', city, genre: 'sci-fi' });
  assert.equal(f.rooms[0].tiles, null);
  assert.equal(w.rooms[0].tiles.wall, 'clapboard'); assert.equal(s.rooms[0].tiles.wall, 'bulkhead');
  assert.notEqual(w.streetRule, s.streetRule);
  assert.notEqual(w.rooms[0].name, s.rooms[0].name);
});

test('install writes skeleton rooms, links the anchor, never overwrites existing rooms, and is idempotent', () => {
  const db = { '0,3,0': { name: 'Ash Gate', exits: { south: { status: 'open', targetCoordinates: '0,2,0' } }, environmentIntent: { template: 'cavern_village', citySite: city } } };
  const p0 = C.plan({ seed: 'r', city, anchorKey: '0,3,0', genre: 'fantasy', underground: true });
  db[p0.rooms[5].key] = { name: 'Already Here', description: 'kept' };
  const r = C.install(db, '0,3,0', { seed: 'r' });
  assert.equal(r.status, 'installed'); assert.equal(r.direction, 'north'); assert.equal(r.kept, 1);
  assert.equal(db[p0.rooms[5].key].name, 'Already Here');
  assert.equal(db['0,3,0'].exits.north.targetCoordinates, p0.gateKey);
  assert.equal(db[p0.gateKey].exits.south.targetCoordinates, '0,3,0');
  assert.ok(db[p0.gateKey].cityRoom && !db[p0.gateKey].description);
  assert.equal(C.sceneKind(db[p0.gateKey]).biome, 'city');
  assert.equal(C.install(db, '0,3,0', { seed: 'r' }).status, 'already-installed');
  assert.match(C.describe(db[p0.gateKey]), /\[CITY\]/);
});

test('flag off: install is skipped', () => {
  process.env.HOLODEK_CITY_SITES = '0';
  assert.equal(C.install({ a: {} }, 'a').status, 'skipped');
  process.env.HOLODEK_CITY_SITES = '1';
});
