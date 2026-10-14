'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Secrets = require('../retort/secretDoors'), Keys = require('../retort/keyPlacement'), Reach = require('../retort/dungeonReach');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
function dungeon(seed = 'test', outside = false) {
  const d = { layout: { width: 64, height: 64 }, geoKey: '0,0,0', generation: { seed }, start: { x: 32, y: 32 }, cells: {}, tiles: {}, sceneObjects: [] };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) d.cells[`${x},${y}`] = {
    tile: x === 0 || y === 0 || x === 63 || y === 63 || !outside && (x < 20 || x > 44 || y < 20 || y > 44) ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 3 };
  return d;
}
function fixture() {
  let d = dungeon(); Secrets.install(d); d._geometryStamp = 'before';
  const first = d.secretDoors.doors[0], p = first.entry;
  let text = 'Coordinates: X: 0, Y: 0, Z: 0\nPC:\n' + sheet({ Name: 'Benedict', HP: 10, MaxHP: 10 }, 0, 'pc') + '\nNPCs in Party: None\nMonsters in Room: None';
  let roster = JSON.stringify([{ name: 'Benedict', type: 'pc', mazeX: p.x, mazeY: p.y, mazeRoomKey: '0,0,0' }]);
  let database = '{"0,0,0":{"name":"Hall"}}';
  const state = { getDungeonRunId: () => 'secret-test', getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getGamePaused: () => false,
    getRoomDungeon: () => structuredClone(d), setRoomDungeon: (_, next) => d = structuredClone(next),
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: value => text = value,
    getCombatCharactersString: () => roster, setCombatCharactersString: value => roster = value,
    getRoomNameDatabase: () => database, setRoomNameDatabase: value => database = value };
  const request = { runId: 'secret-test', geoKey: '0,0,0', kind: 'search', nonce: 'search:0001' };
  const commit = result => { assert.ok(!result.error, result.error); state.setRoomDungeon(null, result.dungeon); Secrets.persist(state, result.dungeon); };
  return { state, request, first, commit, d: () => d };
}
test('indoor chambers and outdoor vaults provide 2-6 sealed, deterministic optional passages without cutting existing routes', () => {
  for (const outside of [false, true]) for (let seed = 0; seed < 12; seed++) {
    const d = dungeon(String(seed), outside), before = reachable(makeNavigation(d), d.start);
    const result = Secrets.install(d);
    assert.ok(result.doors.length >= 2 && result.doors.length <= 6, JSON.stringify({ outside, seed, count: result.doors.length }));
    assert.equal(result.doors.length, result.target);
    const after = reachable(makeNavigation(d), d.start);
    for (const secret of result.doors) {
      assert.equal(d.cells[secret.key].tile, 'wall'); assert.equal(secret.open, false); assert.equal(secret.discovered, false);
      assert.ok(after.seen[secret.entry.y * 64 + secret.entry.x]);
      for (const key of secret.chamber) {
        const [x, y] = key.split(',').map(Number); assert.equal(after.seen[y * 64 + x], 0, 'Chamber must be inaccessible before its secret door opens');
      }
    }
    for (let i = 0; i < before.seen.length; i++) if (before.seen[i] && d.cells[`${i % 64},${Math.floor(i / 64)}`].tile === 'floor' && !d.cells[`${i % 64},${Math.floor(i / 64)}`].secretChamber) assert.equal(after.seen[i], 1);
    const again = dungeon(String(seed), outside); Secrets.install(again); assert.deepEqual(again.secretDoors, result);
    assert.equal(Secrets.install(d), result, 'Revisiting must not regenerate secrets');
  }
});
test('nearby searching has exactly 80 percent discovery, costs no guessed remote reveal and can be retried', () => {
  let found = 0;
  for (let natural = 1; natural <= 20; natural++) {
    const f = fixture(), result = Secrets.act(f.state, f.request, { natural: () => natural });
    assert.ok(!result.error, result.error); found += result.found.includes(f.first.key) ? 1 : 0;
    if (natural >= 5) assert.equal(result.dungeon.cells[f.first.key].tile, 'wall', 'Discovery is not opening');
  }
  assert.equal(found, 16);
  const f = fixture(), failed = Secrets.act(f.state, f.request, { natural: () => 1 }); f.commit(failed);
  const replay = Secrets.act(f.state, f.request, { natural: () => 20 }); assert.equal(replay.duplicate, true); assert.deepEqual(replay.found, []);
  const retry = Secrets.act(f.state, { ...f.request, nonce: 'search:0002' }, { natural: () => 20 }); assert.ok(retry.found.includes(f.first.key));
  f.state.setCombatCharactersString(JSON.stringify([{ name: 'Benedict', type: 'pc', mazeX: 32, mazeY: 32, mazeRoomKey: '0,0,0' }]));
  const remote = Secrets.act(f.state, { ...f.request, nonce: 'search:remote' }, { natural: () => 20 }); assert.deepEqual(remote.found, []);
});
test('doors require real adjacency, open a walkable chamber, persist and reject stale-room or changed nonce requests', () => {
  const f = fixture(), request = { ...f.request, kind: 'open', key: f.first.key };
  const result = Secrets.act(f.state, request); f.commit(result);
  assert.equal(f.d().cells[f.first.key].door.isOpen, true);
  const reach = reachable(makeNavigation(f.d()), f.d().start);
  for (const k of f.first.chamber) { const [x, y] = k.split(',').map(Number); assert.equal(reach.seen[y * 64 + x], 1); }
  assert.equal(Secrets.act(f.state, request).duplicate, true);
  assert.ok(Secrets.act(f.state, { ...request, key: '1,1' }).error);
  assert.ok(Secrets.act(f.state, { ...request, geoKey: '9,9,9' }).error);
  assert.equal(JSON.parse(Secrets.preserve(f.state.getRoomNameDatabase(), '{"0,0,0":{}}'))['0,0,0'].secretDoors.doors[0].open, true);
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('State: Alive', 'State: Unconscious').replace('HP: 10', 'HP: 0'));
  assert.ok(Secrets.act(f.state, { ...request, nonce: 'downed:123' }).error);
});
test('search proximity does not see through another wall or between different floor heights', () => {
  const f = fixture(), d = f.d(), door = f.first, p = { x: door.entry.x + .5, y: door.entry.y + .5 };
  assert.ok(Secrets.nearby(d, p).some(s => s.key === door.key));
  d.cells[door.key].floorHeight = 4; assert.equal(Secrets.nearby(d, p).length, 0);
  d.cells[door.key].floorHeight = 0;
  const dx = door.x - door.entry.x, dy = door.y - door.entry.y;
  d.cells[`${door.entry.x - dx},${door.entry.y - dy}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
  d.cells[`${door.entry.x},${door.entry.y}`].tile = 'wall';
  assert.equal(Secrets.nearby(d, { x: p.x - dx, y: p.y - dy }).length, 0);
});
test('opening animation lifts an opaque voxel slab, finishes and ignores replay updates', () => {
  let api, handler;
  const window = { addEventListener: (_, fn) => handler = fn };
  vm.runInNewContext(fs.readFileSync('assets/secretDoorsUi.js', 'utf8'), { window, Date, WeakMap, Map, Math, Uint8Array });
  api = window.SecretDoorsUi;
  const d = dungeon(); Secrets.install(d); const after = structuredClone(d.secretDoors); after.doors[0].open = true;
  api.begin(d, after, 100); d.secretDoors = after;
  const initial = api.parts(d, 100)[0], half = api.parts(d, 450)[0];
  assert.equal(initial.size.z, 3); assert.ok(half.position.z > initial.position.z && half.size.z < initial.size.z);
  assert.equal(api.parts(d, 800).length, 0); api.begin(d, after, 900); assert.equal(api.parts(d, 900).length, 0);
  assert.equal(typeof handler, 'function');
});
test('ordinary keys favor the lock room or a real open unvisited route, never an implicit exit or the way back', () => {
  const db = { '0,0,0': { exits: { west: { status: 'open', targetCoordinates: '-1,0,0' }, east: { status: 'locked', targetCoordinates: '1,0,0' },
    north: { status: 'open', targetCoordinates: '0,1,0' } } }, '-1,0,0': { visited: true }, '1,0,0': {}, '0,1,0': {}, '0,-1,0': {} };
  const p = { x: 0, y: 0, z: 0 };
  assert.equal(Keys.choose(db, p, 'east', { random: () => 0 }), '0,0,0');
  assert.equal(Keys.choose(db, p, 'east', { random: () => .99 }), '0,1,0');
  assert.equal(Keys.choose(db, p, 'east', { random: () => .99, hostile: true }), '0,0,0');
  delete db['0,0,0'].exits.north; assert.equal(Keys.choose(db, p, 'east', { random: () => .99 }), '0,0,0');
});

test('the real secret-door HTTP route commits one search turn and sends an opening delta without replaying it', async t => {
  const f = fixture(), express = require('express'), app = express(), events = []; app.use(express.json());
  let turns = 0;
  const context = { app, sharedState: f.state, inputTaskInFlight: false, SecretDoors: { ...Secrets, act: (state, request) => Secrets.act(state, request, { natural: () => 20 }) },
    SpellSystem: { advance() { turns++; } }, broadcast: event => events.push(event),
    finalizeRoomDungeon: (key, d) => ({ ...d, geoKey: key, _geometryStamp: 'revision:' + d.secretDoors.revision }),
    spellStateEvent: (geoKey, data) => ({ ...data, geoKey }),
    prepareQuestScene: request => request.body.runId === 'secret-test' && !context.inputTaskInFlight ? {} : { error: 'Stale game.', status: 409 } };
  const source = fs.readFileSync('server.js', 'utf8');
  vm.runInNewContext(source.slice(source.indexOf("app.post('/secret-doors/action'"), source.indexOf("app.post('/combat/wait'")), context);
  const listener = app.listen(0, '127.0.0.1'); await new Promise(resolve => listener.once('listening', resolve));
  t.after(async () => { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); });
  const post = async body => { const response = await fetch(`http://127.0.0.1:${listener.address().port}/secret-doors/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
  const search = await post(f.request); assert.equal(search.status, 200); assert.equal(turns, 1);
  assert.ok(f.d().secretDoors.doors[0].discovered); assert.equal(f.d().secretDoors.doors[0].open, false);
  assert.equal((await post(f.request)).data.duplicate, true); assert.equal(turns, 1);
  const opening = { ...f.request, kind: 'open', key: f.first.key, nonce: 'open-http:123' };
  const result = await post(opening); assert.equal(result.status, 200); assert.equal(turns, 1);
  const delta = events.filter(e => e.type === 'dungeonCellUpdate'); assert.equal(delta.length, 2);
  assert.equal(delta[1].cells[f.first.key].door.isOpen, true); assert.ok(delta[1].secretDoors.doors[0].open);
  assert.equal((await post(opening)).data.duplicate, true);
  assert.equal(events.filter(e => e.type === 'dungeonCellUpdate').length, 2);
  assert.equal((await post({ ...opening, runId: 'old-game' })).status, 409);
  assert.equal(context.inputTaskInFlight, false);
});
