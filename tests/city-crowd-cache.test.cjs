'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { Worker } = require('node:worker_threads'), api = require('../assets/cityCrowdCache'), { database } = require('./fixtures/city-cache-db.cjs');
const wait = () => new Promise(setImmediate), deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function room() { return { geoKey: '0,0,30', _geometryStamp: 'stamp-a', _meta: { runId: 'run' }, layout: { width: 4, height: 4 },
  classification: { indoor: false }, cells: { '1,1': { tile: 'floor', ceilHeight: 12 } }, sceneStructures: [{ role: 'vault', height: 12 }],
  sceneObjects: [{ id: 'item', discovered: false }], cityCrowd: { revision: 1, actors: { blob: { bodyPlan: 'ooze', status: 'ambient' } } } }; }
function harness() {
  const db = database(), d = room(), calls = [], logs = []; let ref = null, token = 'street', closed = false;
  const root = { dungeonRunId: 'run', currentDungeon: d, Worker: class {}, console: { warn: (...v) => logs.push(v) },
    CityFloorScope: { token: () => token, cacheKey(key, dungeon) { const floor = dungeon ? dungeon.cityFloorContext : ref;
      return floor?.hostKey === key ? `${key}:building:${floor.buildingId}:floor:${floor.floor}` : key; } } };
  const options = { root, openDatabase: async () => db,
    async writeFull(dungeon, key, validate, snapshot) {
      const database = await options.openDatabase();
      if (validate && !validate()) return { status: 'skipped' };
      return new Promise((resolve, reject) => {
        const tx = database.transaction('rooms', 'readwrite'); snapshot?.(); tx.objectStore('rooms').put(dungeon, key);
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
      });
    }, transportFactory: () => ({ async call(data) { calls.push(data); return api.patch(db, data); }, close() { closed = true; } }) };
  function move(dungeon) { root.currentDungeon = dungeon; ref = dungeon.cityFloorContext || null; token = ref ? 'floor-' + ref.floor : 'street'; }
  function floor(level) { const n = room(); n.classification.indoor = true; n.cityFloorContext = { hostKey: n.geoKey, buildingId: 'inn', floor: level }; return n; }
  const cache = api.create({ ...options, transportFactory: () => options.transportFactory() });
  return { db, d, root, calls, logs, options, cache, move, floor, closed: () => closed, seed: () => cache.full(d.geoKey, d) };
}

test('native crowd saves patch only crowd and keep exact architecture, ceilings, geometry and non-human appearance', async () => {
  const h = harness(); await h.seed(); const original = structuredClone(h.db.tables.rooms.get('run:0,0,30'));
  h.d.cityCrowd.revision = 2; h.d.cityCrowd.actors.blob.status = 'promoted'; await h.cache.persist();
  const saved = h.db.tables.rooms.get('run:0,0,30'); assert.deepEqual({ ...saved, cityCrowd: original.cityCrowd }, original);
  assert.equal(saved.cityCrowd.actors.blob.bodyPlan, 'ooze'); assert.equal(saved.cityCrowd.revision, 2);
  assert.equal(h.cache.diagnostics().workerPatches, 1); assert.equal(h.cache.diagnostics().fullSaves, 1);
  assert.equal(h.calls[0].cells, undefined); assert.equal(h.calls[0].layout, undefined);
});

test('cold rooms seed one guarded full baseline before using the worker', async () => {
  const h = harness(); await h.cache.persist(); h.d.cityCrowd.revision = 2; await h.cache.persist();
  assert.equal(h.cache.diagnostics().crowdFullFallbacks, 1); assert.equal(h.cache.diagnostics().workerPatches, 1);
});

test('floors and non-city rooms use native complete saves with distinct captured keys', async () => {
  const h = harness();
  for (const level of [1, 2]) { const d = h.floor(level); h.move(d); await h.cache.persist(); }
  const outside = room(); outside.classification.indoor = true; outside.geoKey = '1,0,30'; h.move(outside); await h.cache.persist();
  assert.equal(h.calls.length, 0); assert.equal(h.db.tables.rooms.size, 3);
  assert.ok(h.db.tables.rooms.has('run:0,0,30:building:inn:floor:1')); assert.ok(h.db.tables.rooms.has('run:0,0,30:building:inn:floor:2'));
});

test('browsers without Worker retain native saves without altering their room schema', async () => {
  const h = harness(); h.root.Worker = undefined; await h.seed(); h.d.cityCrowd.revision = 2; await h.cache.persist();
  assert.equal(h.calls.length, 0); assert.equal(h.db.tables.rooms.get('run:0,0,30').cityCrowd.revision, 2);
});

test('nested mutable and unknown non-geometry changes force complete native saves', async () => {
  const h = harness(); h.d.futureFeature = { found: false }; await h.seed();
  h.d.sceneObjects[0].discovered = true; await h.cache.persist(); h.d.futureFeature.found = true; await h.cache.persist();
  assert.equal(h.calls.length, 0); assert.equal(h.db.tables.rooms.get('run:0,0,30').futureFeature.found, true);
  assert.equal(h.db.tables.rooms.get('run:0,0,30').sceneObjects[0].discovered, true);
});

test('stamped geometry changes take the full native path while separate population/LOD owners remain independent', async () => {
  const h = harness(); await h.seed(); h.d.cells['2,2'] = { tile: 'pillar', ceilHeight: 19 }; h.d._geometryStamp = 'stamp-b';
  await h.cache.persist(); assert.equal(h.db.tables.rooms.get('run:0,0,30').cells['2,2'].ceilHeight, 19);
  h.d.inhabitants = { revision: 9 }; h.d._lodCache = { 4: {} }; h.d.cityCrowd.revision = 2; await h.cache.persist();
  assert.equal(h.cache.diagnostics().workerPatches, 1);
});

test('a newer queued native full save supersedes an older pending crowd request', async () => {
  const h = harness(), gate = deferred(), open = h.options.openDatabase;
  h.options.openDatabase = async () => { await gate.promise; return open(); };
  const first = h.seed(), crowd = h.cache.persist(); const newer = structuredClone(h.d); newer._geometryStamp = 'new'; newer.cells['2,2'] = { tile: 'vault' };
  const next = h.cache.full(newer.geoKey, newer); gate.resolve(); await first; await crowd; await next;
  assert.equal(h.db.tables.rooms.get('run:0,0,30')._geometryStamp, 'new'); assert.equal(h.calls.length, 0);
  assert.equal(h.cache.diagnostics().superseded, 1);
});

test('in-flight worker patches finish before a later native geometry save and cannot overwrite it', async () => {
  const h = harness(), gate = deferred(); await h.seed();
  h.options.transportFactory = () => ({ async call(data) { await gate.promise; return api.patch(h.db, data); }, close() {} });
  h.d.cityCrowd.revision = 2; const patch = h.cache.persist(); await wait();
  const newer = structuredClone(h.d); newer._geometryStamp = 'new'; newer.cells['2,2'] = { tile: 'vault' };
  h.move(newer); const full = h.cache.full(newer.geoKey, newer); gate.resolve(); await patch; await full;
  assert.equal(h.db.tables.rooms.get('run:0,0,30')._geometryStamp, 'new');
  assert.equal(h.db.tables.rooms.get('run:0,0,30').cells['2,2'].tile, 'vault');
});

test('an accepted worker save stays in the original host city after moving onto a floor', async () => {
  const h = harness(), gate = deferred(); await h.seed();
  h.options.transportFactory = () => ({ async call(data) { await gate.promise; return api.patch(h.db, data); }, close() {} });
  h.d.cityCrowd.revision = 7; const pending = h.cache.persist(); await wait();
  const floor = h.floor(1); h.move(floor); await h.cache.full(floor.geoKey, floor); gate.resolve(); await pending;
  assert.equal(h.db.tables.rooms.get('run:0,0,30').cityCrowd.revision, 7);
  assert.equal(h.db.tables.rooms.get('run:0,0,30:building:inn:floor:1').cityCrowd.revision, 1);
});

test('cold full fallback rechecks the active floor after asynchronous database opening', async () => {
  const h = harness(), gate = deferred(), open = h.options.openDatabase;
  h.options.openDatabase = async () => { await gate.promise; return open(); };
  const pending = h.cache.persist(); await wait(); h.move(h.floor(2)); gate.resolve();
  assert.equal((await pending).status, 'skipped'); assert.equal(h.db.tables.rooms.size, 0);
});

test('queued native writes cannot resurrect an old run after the active world changes', async () => {
  const h = harness(), gate = deferred(), open = h.options.openDatabase;
  h.options.openDatabase = async () => { await gate.promise; return open(); };
  const pending = h.seed(); await wait(); h.root.dungeonRunId = 'new-run'; gate.resolve();
  assert.equal((await pending).status, 'skipped'); assert.equal(h.db.tables.rooms.size, 0);
});

test('worker geometry conflicts preserve newer cached snapshots until an explicit native save', async () => {
  const h = harness(); await h.seed(); const newer = structuredClone(h.d); newer._geometryStamp = 'new'; newer.cells['2,2'] = { tile: 'vault' };
  h.db.tables.rooms.set('run:0,0,30', newer); h.d.cityCrowd.revision = 3;
  assert.equal((await h.cache.persist()).status, 'conflict'); h.d.sceneObjects[0].discovered = true;
  assert.equal((await h.cache.persist()).status, 'conflict'); assert.equal(h.db.tables.rooms.get('run:0,0,30')._geometryStamp, 'new');
  assert.equal(h.logs.length, 1); h.move(newer); await h.cache.full(newer.geoKey, newer); newer.cityCrowd.revision = 4; await h.cache.persist();
  assert.equal(h.db.tables.rooms.get('run:0,0,30').cityCrowd.revision, 4);
});

test('newer cached crowd revisions are retained rather than reset by old queued data', async () => {
  const h = harness(); await h.seed(); h.db.tables.rooms.get('run:0,0,30').cityCrowd.revision = 9;
  h.d.cityCrowd.revision = 3; assert.equal((await h.cache.persist()).status, 'superseded');
  assert.equal(h.db.tables.rooms.get('run:0,0,30').cityCrowd.revision, 9);
  h.d.cityCrowd.revision = 10; await h.cache.persist(); assert.equal(h.db.tables.rooms.get('run:0,0,30').cityCrowd.revision, 10);
});

test('worker failure uses an atomic main-thread crowd patch, not a stale full-snapshot fallback', async () => {
  const h = harness(); await h.seed(); h.options.transportFactory = () => ({ call: async () => { throw Error('worker failed'); }, close() {} });
  h.d.cityCrowd.revision = 2; await h.cache.persist(); h.d.cityCrowd.revision = 3; await h.cache.persist();
  assert.equal(h.cache.diagnostics().workerFailures, 1); assert.equal(h.cache.diagnostics().mainThreadPatches, 2);
  assert.equal(h.cache.diagnostics().fullSaves, 1); assert.equal(h.db.tables.rooms.get('run:0,0,30').cityCrowd.revision, 3);
});

test('a lost worker acknowledgement is idempotent when the main-thread fallback sees an already committed crowd', async () => {
  const h = harness(); await h.seed();
  h.options.transportFactory = () => ({ async call(data) { await api.patch(h.db, data); throw Error('acknowledgement lost'); }, close() {} });
  h.d.cityCrowd.revision = 2; assert.equal((await h.cache.persist()).status, 'unchanged');
  assert.equal(h.cache.diagnostics().conflicts, 0); assert.equal(h.cache.diagnostics().fullSaves, 1);
  assert.equal(h.db.tables.rooms.get('run:0,0,30').cityCrowd.revision, 2);
});

test('worker failures retain newer cached geometry rather than falling back to a complete stale client snapshot', async () => {
  const h = harness(); await h.seed();
  const newer = structuredClone(h.d); newer._geometryStamp = 'new'; h.db.tables.rooms.set('run:0,0,30', newer);
  h.options.transportFactory = () => { throw Error('worker unavailable'); };
  h.d.cityCrowd.revision = 2; assert.equal((await h.cache.persist()).status, 'conflict');
  assert.equal(h.db.tables.rooms.get('run:0,0,30')._geometryStamp, 'new'); assert.equal(h.cache.diagnostics().fullSaves, 1);
});

test('missing caches are seeded atomically only while the original room is still current', async () => {
  const h = harness(); await h.seed(); h.db.tables.rooms.delete('run:0,0,30'); h.d.cityCrowd.revision = 2; await h.cache.persist();
  assert.equal(h.cache.diagnostics().seeded, 1); assert.equal(h.db.tables.rooms.get('run:0,0,30').cityCrowd.revision, 2);
  const n = harness(), gate = deferred(); await n.seed(); n.db.tables.rooms.delete('run:0,0,30');
  n.options.transportFactory = () => ({ async call(data) { await gate.promise; return api.patch(n.db, data); }, close() {} });
  const pending = n.cache.persist(); await wait(); n.move(n.floor(1)); gate.resolve();
  assert.equal((await pending).status, 'skipped'); assert.equal(n.db.tables.rooms.has('run:0,0,30'), false);
});

test('a missing-record race never seeds over a record inserted by another writer', async () => {
  const h = harness(); await h.seed(); const newer = structuredClone(h.d); newer._geometryStamp = 'new';
  h.options.transportFactory = () => ({ async call() { h.db.tables.rooms.set('run:0,0,30', newer); return { status: 'missing' }; }, close() {} });
  assert.equal((await h.cache.persist()).status, 'conflict'); assert.equal(h.db.tables.rooms.get('run:0,0,30')._geometryStamp, 'new');
});

test('native transaction failures reject and cannot establish a successful worker baseline', async () => {
  const h = harness(); h.db.failNext = true; await assert.rejects(h.seed(), /transaction failed/);
  assert.equal(h.db.tables.rooms.size, 0); await h.cache.persist();
  assert.equal(h.cache.diagnostics().saveFailures, 1); assert.equal(h.cache.diagnostics().workerPatches, 0);
});

test('unchanged crowd data does not create duplicate room writes', async () => {
  const h = harness(); await h.seed(); const writes = h.db.writes.length; await h.cache.persist(); await h.cache.persist();
  assert.equal(h.db.writes.length, writes); assert.equal(h.cache.diagnostics().workerPatches, 0);
});

test('cache bookkeeping does not retain an unbounded map of visited city geometry', async () => {
  const h = harness();
  for (let i = 0; i < 80; i++) { const d = room(); d.geoKey = i + ',0,30'; h.move(d); await h.cache.full(d.geoKey, d); }
  await h.cache.drain(); assert.ok(h.cache.diagnostics().keys <= 64); assert.equal(h.cache.diagnostics().queued, 0);
});

test('dispose drains accepted worker saves before terminating the transport', async () => {
  const h = harness(), gate = deferred(); await h.seed(); let closed = false;
  h.options.transportFactory = () => ({ async call(data) { await gate.promise; return api.patch(h.db, data); }, close() { closed = true; } });
  h.d.cityCrowd.revision = 7; const pending = h.cache.persist(); await wait(); const dispose = h.cache.dispose();
  assert.equal(closed, false); gate.resolve(); await pending; await dispose;
  assert.equal(closed, true); assert.equal(h.cache.diagnostics().workerPatches, 1); assert.equal(h.cache.diagnostics().fullSaves, 1);
});

test('worker protocol rejects schema upgrades and never creates a new cache layout', async () => {
  const replies = [], root = { indexedDB: { open(name, version) {
    assert.equal(name, 'cotg-dungeons'); assert.equal(version, 2);
    const request = { transaction: { abort() { request.aborted = true; } } }; queueMicrotask(() => request.onupgradeneeded()); return request;
  } }, postMessage: m => replies.push(m) };
  api.installWorker(root); root.onmessage({ data: { id: 1, type: 'patch' } }); await wait();
  assert.match(replies[0].error, /schema changes are disabled/);
});

test('worker bridge correlates replies, releases timers and terminates outstanding requests on timeout', async () => {
  let instance, terminated = false; const timers = new Map(), sent = [];
  const root = { Worker: class { constructor(url) { assert.match(url, /^\/assets\//); instance = this; } postMessage(data) { sent.push(data); } terminate() { terminated = true; } },
    setTimeout(fn) { const id = {}; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) };
  const transport = api.bridge(root, '/assets/cityCrowdCacheWorker.js?v=city-cache-1'), one = transport.call({ key: 'a' }), two = transport.call({ key: 'b' });
  instance.onmessage({ data: { id: sent[1].id, result: { status: 'patched' } } }); assert.equal((await two).status, 'patched');
  instance.onmessage({ data: { id: sent[0].id, result: { status: 'unchanged' } } }); assert.equal((await one).status, 'unchanged');
  assert.equal(timers.size, 0);
  const pending = transport.call({ key: 'c' }); [...timers.values()][0](); await assert.rejects(pending, /timed out/);
  assert.equal(timers.size, 0); assert.equal(terminated, true); transport.close();
});

test('atomic worker patch rejects floor, wrong-run and wrong-geometry records without changing them', async () => {
  for (const change of [r => { r.cityFloorContext = { floor: 1 }; }, r => { r._meta.runId = 'other'; }, r => { r._geometryStamp = 'new'; }]) {
    const h = harness(); await h.seed(); const record = h.db.tables.rooms.get('run:0,0,30'); change(record); const before = JSON.stringify(record);
    const result = await api.patch(h.db, { key: 'run:0,0,30', run: 'run', geoKey: h.d.geoKey, stamp: h.d._geometryStamp,
      expectedCrowd: JSON.stringify(h.d.cityCrowd), crowd: JSON.stringify({ ...h.d.cityCrowd, revision: 2 }) });
    assert.equal(result.status, 'conflict'); assert.equal(JSON.stringify(h.db.tables.rooms.get('run:0,0,30')), before);
  }
});

test('standalone production worker runs off-thread and keeps full room geometry intact', async () => {
  const d = room(), key = 'run:0,0,30', src = fs.readFileSync(require.resolve('../assets/cityCrowdCache'), 'utf8');
  const boot = "const {parentPort,workerData}=require('node:worker_threads');const db=(" + database.toString() + ")();db.tables.rooms.set(workerData.key,workerData.room);\n" +
    src + "\nconst self={indexedDB:{open(){const r={};queueMicrotask(()=>{r.result=db;r.onsuccess()});return r}},postMessage:m=>parentPort.postMessage(m)};" +
    "const send=self.postMessage;self.postMessage=m=>send({...m,record:db.tables.rooms.get(workerData.key)});" +
    "module.exports.installWorker(self);parentPort.on('message',data=>self.onmessage({data}));";
  const thread = new Worker(boot, { eval: true, workerData: { room: d, key } });
  try {
    const reply = new Promise((resolve, reject) => { thread.once('message', resolve); thread.once('error', reject); });
    thread.postMessage({ id: 1, type: 'patch', key, run: 'run', geoKey: d.geoKey, stamp: d._geometryStamp,
      expectedCrowd: JSON.stringify(d.cityCrowd), crowd: JSON.stringify({ ...d.cityCrowd, revision: 2 }) });
    const result = await reply; assert.equal(result.result.status, 'patched');
    assert.deepEqual({ ...result.record, cityCrowd: d.cityCrowd }, d);
  } finally { await thread.terminate(); }
});

test('same-origin worker asset and game scripts load without diagnostic imports or runtime method rewriting', () => {
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8'), worker = fs.readFileSync(require.resolve('../assets/cityCrowdCacheWorker'), 'utf8');
  const gameScripts = [...html.matchAll(/<script src="\/assets\/game\.js\?v=[^"]+"><\/script>/g)];
  const cacheIndex = html.indexOf('/assets/cityCrowdCache.js?v=city-cache-1');
  assert.equal(gameScripts.length, 1);
  assert.ok(cacheIndex >= 0 && cacheIndex < gameScripts[0].index);
  assert.match(worker, /importScripts\('\/assets\/cityCrowdCache\.js\?v=city-cache-1'\)/);
  assert.doesNotMatch(fs.readFileSync(require.resolve('../assets/cityCrowdCache'), 'utf8'), /\.eval\(|new Function|assets\/debug|setInterval/);
});

test('production game integrates native saves, worker patches and the original population-overlay reader', async () => {
  const db = database(), source = fs.readFileSync(require.resolve('../assets/game'), 'utf8'), d = room();
  const root = { currentDungeon: d, dungeonRunId: 'run', dungeonDBPromise: Promise.resolve(db), DUNGEON_STORE: 'rooms', DUNGEON_INHABITANTS_STORE: 'inhabitants',
    CityCrowdCache: api, CityFloorScope: { cacheKey: key => key, token: () => 'street' }, console, setTimeout, clearTimeout };
  root.Worker = class {
    constructor() {
      const self = { indexedDB: { open() { const r = {}; queueMicrotask(() => { r.result = db; r.onsuccess(); }); return r; } },
        postMessage: m => queueMicrotask(() => this.onmessage?.({ data: m })) }; api.installWorker(self); this.self = self;
    }
    postMessage(m) { this.self.onmessage({ data: structuredClone(m) }); } terminate() {}
  };
  root.window = root; const context = vm.createContext(root);
  vm.runInContext(source.slice(source.indexOf('function openDungeonDB()'), source.indexOf('async function idbSetPopulation(')), context);
  await root.idbSetDungeon(d.geoKey, d); d.cityCrowd.revision = 2; await root.cityCrowdCache.persist(d);
  db.tables.inhabitants.set('run:0,0,30', { revision: 10, actors: { blob: { bodyPlan: 'ooze' } } });
  const loaded = await root.idbGetDungeon(d.geoKey); assert.equal(loaded.cityCrowd.revision, 2); assert.equal(loaded.inhabitants.revision, 10);
  assert.deepEqual(loaded.sceneStructures, d.sceneStructures); assert.equal(root.cityCrowdCache.diagnostics().workerPatches, 1);
  await root.cityCrowdCache.dispose();
});

test('population saves capture the original floor key before asynchronous database opening', async () => {
  const db = database(), gate = deferred(), source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  let floor = 1;
  const window = { dungeonRunId: 'run', CityFloorScope: { cacheKey: key => key + ':building:inn:floor:' + floor } };
  const context = { window, DUNGEON_INHABITANTS_STORE: 'inhabitants', openDungeonDB: async () => { await gate.promise; return db; } };
  vm.runInNewContext(source.slice(source.indexOf('async function idbSetPopulation('), source.indexOf('async function discardPreviousDungeonRuns(')), context);
  const pending = context.idbSetPopulation({ geoKey: '0,0,30', revision: 7 });
  floor = 2; gate.resolve(); await pending;
  assert.equal(db.tables.inhabitants.get('run:0,0,30:building:inn:floor:1')?.revision, 7);
  assert.equal(db.tables.inhabitants.has('run:0,0,30:building:inn:floor:2'), false);
});
