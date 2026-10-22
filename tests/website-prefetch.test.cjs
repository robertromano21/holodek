'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), vm = require('node:vm'), fs = require('node:fs');
const root = process.env.HOLODEK_WEBSITE_SOURCE_ROOT || path.resolve(__dirname, '..');
const A = require(path.join(root, 'retort/adjacentRooms'));
const Routes = require(path.join(root, 'retort/roomPrefetchRoutes'));
const Models = require(path.join(root, 'retort/gameModels'));
const waitFor = async condition => { for (let n = 0; n < 100 && !condition(); n++) await new Promise(r => setTimeout(r, 10)); assert.ok(condition()); };

function stampFunction(file, endMarker) {
  const source = fs.readFileSync(path.join(root, file), 'utf8'), begin = source.indexOf('function computeDungeonGeometryStamp(');
  assert.ok(begin >= 0);
  return vm.runInNewContext('(' + source.slice(begin, source.indexOf(endMarker, begin)).trim() + ')');
}
const serverStamp = stampFunction('retort/retortWithUserInput.js', 'function finalizeRoomDungeon(');
const browserStamp = stampFunction('assets/game.js', 'function ensureDungeonGeometryStamp(');
function geometry() {
  return { geoKey: '0,0,0', layout: { width: 32, height: 32 }, cells: {
    '4,4': { tile: 'floor', floorHeight: 0, ceilHeight: 6,
      roof: { style: 'pitched', height: 6, slopeX: .5, slopeY: -.25 }, structureHeight: 7 },
    '4,5': { tile: 'door', floorHeight: -.125, ceilHeight: 6, door: { isOpen: false } }
  }, sceneStructures: [{ role: 'pediment', size: { x: 6, y: 1, z: 2 } }],
  surfaceArt: [{ kind: 'mosaic', id: 'floor-art', x: 4, y: 4 }] };
}
test.afterEach(() => A._reset());

test('browser and server use identical geometry stamps for roofs, supports, structures, artwork and doors', () => {
  for (const dungeon of [null, {}, { cells: {}, layout: {} }, geometry(), { ...geometry(), sceneStructures: [], surfaceArt: [] }])
    assert.equal(browserStamp(dungeon, '0,0,0'), serverStamp(dungeon, '0,0,0'));
  const d = geometry(), initial = browserStamp(d, d.geoKey);
  for (const change of [
    next => next.cells['4,4'].roof.slopeY++, next => next.cells['4,4'].structureHeight++,
    next => next.sceneStructures[0].role = 'arch', next => next.surfaceArt[0].id = 'new-art',
    next => next.cells['4,5'].door.isOpen = true
  ]) {
    const next = structuredClone(d); change(next);
    assert.equal(browserStamp(next, next.geoKey), serverStamp(next, next.geoKey));
    assert.notEqual(browserStamp(next, next.geoKey), initial);
  }
});

test('a browser-stamped displayed room prepares one-hop Luna descriptions that entry can consume exactly once', async () => {
  const dungeon = geometry(); dungeon._geometryStamp = serverStamp(dungeon, dungeon.geoKey);
  const db = { '0,0,0': { name: 'Hall', description: 'A roofed hall.', exits: { north: { targetCoordinates: '0,1,0' } } },
    '0,1,0': { name: 'Road', exits: { north: { targetCoordinates: '0,2,0' } } }, '0,2,0': { name: 'Far Road' } };
  const before = JSON.stringify(db), packets = [], endpoints = {};
  const web = { backgroundEnabled: () => true, view: () => ({ revision: 1 }), generate: async packet => {
    packets.push(packet); return { choices: [{ message: { content: 'Ash drifts across an open crossing.' } }] };
  } };
  const models = Models.createModelService({ initial: 'gpt-6-luna' });
  Routes.install({ post: (url, handler) => endpoints[url] = handler }, {
    getDungeonRunId: () => 'run', getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getRoomNameDatabase: () => JSON.stringify(db),
    getRoomDungeonForSimulation: () => dungeon, getRoomDungeon: () => { throw Error('Must not clone the entire rendered level for an acknowledgement.'); }
  }, { website: web, models, adjacent: { _reset: A._reset, queueNeighbors: request => A.queueNeighbors({ ...request, deps: { website: web, models } }) } });
  let status = 200, result;
  endpoints['/room-displayed']({ body: { runId: 'run', geoKey: dungeon.geoKey, geometryStamp: browserStamp(dungeon, dungeon.geoKey) } },
    { status(value) { status = value; return this; }, json(value) { result = value; } });
  assert.equal(status, 200); assert.deepEqual(result.queued, ['0,1,0']);
  await waitFor(() => A._state().ready === 1);
  assert.equal(packets.length, 1); assert.equal(packets[0].body.model, 'gpt-6-luna'); assert.equal(packets[0].background, true);
  assert.equal(JSON.stringify(db), before, 'Background work never writes authoritative room state.');
  assert.equal(A.take('0,1,0', 'Road', 'run', db['0,1,0']), 'Ash drifts across an open crossing.');
  assert.equal(A.take('0,1,0', 'Road', 'run', db['0,1,0']), null);
  assert.equal(A.take('0,2,0', 'Far Road', 'run', db['0,2,0']), null, 'Preparing a neighbor cannot recursively prepare its neighbors.');
});
test('website neighbors use selected Luna, include diagonal/portal targets and never rewrite a visited room', async () => {
  const packets = [], web = { backgroundEnabled: () => true, view: () => ({ revision: 7 }),
    generate: async packet => { packets.push(packet); return { choices: [{ message: { content: 'A weathered crossing lies beneath the open sky.' } }] }; } };
  const db = { '0,0,0': { name: 'Gate', exits: { northeast: { targetCoordinates: '1,1,0' }, portal: { targetCoordinates: '40,30,2' } } },
    '1,1,0': { name: 'Road' }, '40,30,2': { name: 'Crystal Crossing' }, '0,1,0': { name: 'Visited', visited: true } };
  const models = Models.createModelService({ initial: 'gpt-6-luna' });
  const keys = models.withSnapshot(() => A.queueNeighbors({ db, currentKey: '0,0,0', exits: ['northeast', 'portal', 'north'], runId: 'one', deps: { website: web, models } }));
  assert.deepEqual(keys, ['1,1,0', '40,30,2']); assert.equal(packets.length, 0);
  await waitFor(() => A._state().ready === 2);
  for (const packet of packets) { assert.equal(packet.provider, 'openai'); assert.equal(packet.body.model, 'gpt-6-luna'); assert.equal(packet.body.reasoning_effort, 'none'); assert.equal(packet.background, true); assert.equal(packet.expectedRevision, 7); }
  assert.equal(db['1,1,0'].description, undefined);
  assert.ok(A.take('1,1,0', 'Road', 'one', db['1,1,0'])); assert.equal(A.take('1,1,0', 'Road', 'one'), null);
  db['40,30,2'].visited = true; assert.equal(A.take('40,30,2', 'Crystal Crossing', 'one', db['40,30,2']), null);
});
test('late results after a connection change cannot enter the ready cache', async () => {
  let revision = 1, release;
  const web = { backgroundEnabled: () => true, view: () => ({ revision }), generate: () => new Promise(resolve => { release = resolve; }) };
  const db = { '0,0,0': {}, '0,1,0': { name: 'Road' } };
  A.queueNeighbors({ db, currentKey: '0,0,0', exits: ['north'], deps: { website: web } });
  await waitFor(() => !!release); revision++;
  release({ choices: [{ message: { content: 'A silent road.' } }] }); await waitFor(() => A._state().active === 0);
  assert.equal(A._state().ready, 0);
});
test('only acknowledgement of the active built room unlocks prefetch, once per room', () => {
  const endpoints = {}, calls = [], room = { name: 'Hall', description: 'A roofed hall.', exits: { north: {} } };
  const shared = { getDungeonRunId: () => 'run', getLastCoords: () => ({ x: 0, y: 0, z: 0 }),
    getRoomDungeon: () => ({ _geometryStamp: 'built' }), getRoomNameDatabase: () => JSON.stringify({ '0,0,0': room }) };
  Routes.install({ post: (url, handler) => endpoints[url] = handler }, shared, { adjacent: { _reset() {}, queueNeighbors: request => { calls.push(request); return ['0,1,0']; } },
    models: { withSnapshot: f => f() }, website: { backgroundEnabled: () => true, view: () => ({ revision: 1 }) } });
  const request = body => { let code = 200, value; endpoints['/room-displayed']({ body }, { status(n) { code = n; return this; }, json(v) { value = v; } }); return { code, value }; };
  assert.equal(calls.length, 0);
  assert.equal(request({ runId: 'old', geoKey: '0,0,0', geometryStamp: 'built' }).code, 409);
  assert.equal(request({ runId: 'run', geoKey: '0,1,0', geometryStamp: 'built' }).code, 409);
  assert.equal(request({ runId: 'run', geoKey: '0,0,0', geometryStamp: 'old' }).code, 409);
  const valid = { runId: 'run', geoKey: '0,0,0', geometryStamp: 'built' };
  assert.deepEqual(request(valid).value.queued, ['0,1,0']); request(valid); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].exits, ['north']);
});
test('display acknowledgement waits for two animation frames and does not fire for a replaced room', async () => {
  const frames = [], calls = [], listeners = {}, dungeon = { geoKey: '0,0,0', _geometryStamp: 'built' };
  const rootWindow = { dungeonRunId: 'run', currentDungeon: dungeon, requestAnimationFrame: f => frames.push(f),
    addEventListener: (event, callback) => listeners[event] = callback,
    fetch: async (...args) => { calls.push(args); return { ok: true }; } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/websiteRoomReady.js'), 'utf8'), { window: rootWindow, AbortSignal });
  rootWindow.WebsiteRoomReady.shown(dungeon); assert.equal(calls.length, 0);
  frames.shift()(); assert.equal(calls.length, 0); await frames.shift()(); assert.equal(calls.length, 1);
  rootWindow.WebsiteRoomReady.shown(dungeon); assert.equal(frames.length, 0);
  listeners['holodek:website-ai-changed'](); rootWindow.currentDungeon = {};
  frames.shift()(); await frames.shift()(); assert.equal(calls.length, 1);
});

test('rejected display acknowledgements report the error, back off, and retry rather than silently disabling preparation', async () => {
  let now = 1000, accepts = false; const frames = [], calls = [], warnings = [];
  const dungeon = { geoKey: '0,0,0', _geometryStamp: 'built' };
  const window = { dungeonRunId: 'run', currentDungeon: dungeon, requestAnimationFrame: f => frames.push(f), addEventListener() {},
    console: { warn: (...row) => warnings.push(row) }, fetch: async (url, options) => {
      calls.push(JSON.parse(options.body)); return { ok: accepts, status: accepts ? 200 : 409 };
    } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/websiteRoomReady.js'), 'utf8'), { window, AbortSignal, Date: { now: () => now } });
  const display = async () => { window.WebsiteRoomReady.shown(dungeon); if (frames.length) { frames.shift()(); await frames.shift()(); } };
  await display(); assert.equal(calls.length, 1); assert.equal(warnings.length, 1);
  await display(); assert.equal(calls.length, 1);
  now += 15000; await display(); assert.equal(calls.length, 2); assert.equal(warnings.length, 1);
  accepts = true; now += 15000; await display(); assert.equal(calls.length, 3);
  await display(); assert.equal(calls.length, 3);
});
