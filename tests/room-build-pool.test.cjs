'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events'), { randomUUID } = require('node:crypto');
const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module');
const Build = require('../retort/roomBuildState'), Queue = require('../retort/roomBuildQueue');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function wait(condition) {
  for (let n = 0; n < 200 && !condition(); n++) await tick();
  assert.ok(condition(), 'Expected room build condition before timeout.');
}
function queueWithLocalProbe(localWorkers) {
  const file = require.resolve('../retort/roomBuildQueue'), nativeRequire = createRequire(file), module = { exports: {} };
  const requireFake = id => id === 'node:worker_threads' ? { Worker: class extends EventEmitter {
    constructor(script, options) { super(); this.script = script; this.options = options; this.terminated = 0; localWorkers.push(this); }
    terminate() { this.terminated++; return Promise.resolve(); }
  } } : nativeRequire(id);
  vm.runInThisContext('(function(require,module,exports,__dirname){\n' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })
    (requireFake, module, module.exports, nativeRequire('node:path').dirname(file));
  return module.exports;
}
function setup(t, { injected = false, concurrency, capacity = 3, queue = Queue, retryOptions = { conflictRetries: 0 } } = {}) {
  let runId = randomUUID(), restore = 0, quest = 'Find the witness';
  let db = { '0,0,0': { name: 'Hall', description: 'A quiet roofed hall of stone.', visited: true, exits: {
    north: { targetCoordinates: '0,1,0' }, east: { targetCoordinates: '1,0,0' },
    south: { targetCoordinates: '0,-1,0' }, west: { targetCoordinates: '-1,0,0' }, portal: { targetCoordinates: '10,10,0' }
  } }, '0,1,0': { name: 'Road' }, '1,0,0': { name: 'Court' }, '0,-1,0': { name: 'Garden' },
  '-1,0,0': { name: 'Chapel' }, '10,10,0': { name: 'Crossing' } };
  const dungeons = { '0,0,0': { _geometryStamp: 'hall', cells: {}, layout: {} } }, populations = {}, music = {};
  const writes = [], workers = [], spawned = [], logs = [], model = { id: 'gpt-6-luna', revision: 1 };
  const web = { enabled: true, remote: true, revision: 1, capacity };
  const keyOf = c => `${c.x},${c.y},${c.z}`;
  const state = { getDungeonRunId: () => runId, getRestoreRevision: () => restore,
    getCurrentQuest: () => quest, getCurrentTaskIndex: () => 0, getCurrentTasks: () => [],
    getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getRoomNameDatabase: () => JSON.stringify(db),
    setRoomNameDatabase: json => { writes.push('rooms'); db = JSON.parse(Build.protectDatabase(JSON.stringify(db), json, runId)); },
    getRoomDungeonForSimulation: c => dungeons[keyOf(c)] || null,
    setRoomDungeon: (c, d) => { writes.push('dungeon'); dungeons[keyOf(c)] = structuredClone(d); },
    setRoomPopulation: (k, p) => { writes.push('population'); populations[k] = structuredClone(p); },
    setRoomMusic: (c, m) => { writes.push('music'); music[keyOf(c)] = structuredClone(m); },
    exportSaveState: () => ({ roomNameDatabaseString: JSON.stringify(db), roomDungeonDatabase: structuredClone(dungeons),
      lastCoords: { x: 0, y: 0, z: 0 } }) };
  const spawn = (job, snapshot, options) => {
    const worker = new EventEmitter(); worker.terminated = 0;
    worker.terminate = () => { worker.terminated++; };
    workers.push(worker); spawned.push({ job, snapshot, options }); return worker;
  };
  const website = { backgroundEnabled: () => web.enabled, view: () => web,
    remoteBuildEnabled: () => web.remote, capacity: () => web.capacity,
    spawnBuild: injected ? () => { throw Error('Injected spawn must take precedence.'); } : spawn };
  const deps = { website, models: { current: () => model }, logger: { info: (_tag, data) => logs.push(JSON.parse(data)) },
    commit: (s, j, a, options) => Build.commit(s, j, a, { ...options, adoptMusic() {} }) };
  if (injected) deps.spawn = spawn;
  if (concurrency !== undefined) deps.concurrency = concurrency;
  // Existing atomic-rejection cases disable automatic recovery; dedicated tests below exercise its default policy.
  const service = queue.createService(state, { ...deps, ...retryOptions });
  t.after(() => service._reset());
  const emit = (n, stage = 'complete', change) => {
    const job = spawned[n].job, artifact = makeArtifact(job, stage);
    change?.(artifact);
    workers[n].emit('message', { type: 'checkpoint', jobId: job.id, runId: job.runId, artifact });
    return artifact;
  };
  const done = n => workers[n].emit('message', { type: 'done' });
  return { state, service, web, website, model, workers, spawned, dungeons, music, populations, writes, logs, emit, done,
    queue: (exits = ['north', 'east', 'south'], retry = false) => service.queueNeighbors({ currentKey: '0,0,0', exits, retry }),
    db: () => db, changeQuest: () => { quest = 'A new quest'; }, restore: () => restore++, newRun: () => { runId = randomUUID(); } };
}
function makeArtifact(job, stage = 'complete') {
  const rooms = structuredClone(job.base), room = rooms[job.key];
  Object.assign(room, { populationComplete: true, description: 'A long road winds between quiet stone walls.',
    inhabitants: { actors: {}, groups: [] } });
  if (stage === 'complete') room.illustration = { plan: { layers: [] } };
  return { jobId: job.id, leaseId: job.assignment?.leaseId, runId: job.runId, key: job.key, stage, rooms,
    dungeon: stage === 'population' ? null : { geoKey: job.key, layout: { width: 16, height: 16 },
      cells: { '1,1': { tile: 'floor' } }, _geometryStamp: 'ready-' + job.key,
      sceneSpec: { source: { roomName: room.name, description: room.description } } },
    music: ['music', 'complete'].includes(stage) ? { voices: [{}, {}, {}], archive: { id: 'offline-score' } } : null };
}

test('remote pool dispatches exactly three rooms and refills only a released slot', async t => {
  const s = setup(t); s.queue(['north', 'east', 'south', 'west']);
  await wait(() => s.workers.length === 3); await tick();
  assert.equal(s.service.status().filter(j => j.phase === 'running').length, 3);
  assert.equal(s.service.status().filter(j => j.phase === 'queued').length, 1);
  assert.equal(new Set(s.spawned.map(({ job }) => job.id)).size, 3);
  assert.equal(new Set(s.spawned.map(({ job }) => job.runId)).size, 1);
  assert.ok(s.spawned.every(({ job, snapshot }) => /^[a-f0-9-]{36}$/.test(job.id) && snapshot.roomDungeonDatabase['0,0,0']));
  assert.ok(s.spawned.every(({ options }) => options.background === true));
  s.emit(1); s.done(1); await wait(() => s.workers.length === 4);
  assert.equal(s.spawned[3].job.key, '-1,0,0');
  assert.equal(JSON.parse(s.spawned[3].snapshot.roomNameDatabaseString)['1,0,0'].preparedBuild.ready, true);
});

test('captured five-neighbor prefetch commits through three workers while live source dialogue evolves', async t => {
  const Economy = require('../retort/economy'), s = setup(t, { retryOptions: {} });
  const targets = [['west','-1,0,0'],['south','0,-1,0'],['northeast','1,1,0'],['down','0,0,-1'],['southeast','1,-1,0']];
  s.db()['0,0,0'].exits = Object.fromEntries(targets.map(([direction, key]) => [direction, { status:'open', targetCoordinates:key }]));
  for (const [, key] of targets) s.db()[key] = { name:'Captured neighbor '+key, indoor:true, objects:[] };
  const direct = structuredClone(s.db());
  Economy.seedRoom(direct, '-1,0,0', { geoKey:'-1,0,0', actors:{}, groups:[] }, s.state.getDungeonRunId());
  assert.ok(Build.changedPaths(s.db()['0,0,0'], direct['0,0,0'], '0,0,0').includes('0,0,0.divineCourt'), 'Reproduce the substantive foreign ledger write before changing its producer.');
  assert.equal(s.queue(targets.map(([direction]) => direction)).length, 5);
  await wait(() => s.workers.length === 3);
  for (let n = 0; n < 5; n++) {
    await wait(() => s.workers.length > n);
    const source = s.db()['0,0,0'];
    source.playerNote = 'discovery-'+n; source.inhabitants = { actors: { Speaker: { hp:19-n, dialogue:['new live line '+n] } } };
    const before = structuredClone(source);
    s.emit(n, 'complete', artifact => {
      const room = artifact.rooms[artifact.key]; room.inhabitants.geoKey = artifact.key;
      Economy.seedRoom(artifact.rooms, artifact.key, room.inhabitants, s.state.getDungeonRunId(), '', { deferCommunity:true });
    }); s.done(n);
    assert.deepEqual(s.db()['0,0,0'], before, 'Offscreen construction cannot move gods, seed contracts, or overwrite live dialogue.');
  }
  assert.ok(s.service.status().every(job => job.phase === 'complete' && job.attempt === 1));
  assert.equal(s.logs.filter(row => row.phase === 'running').length, 5);
  for (const [, key] of targets) {
    assert.equal(s.db()[key].preparedBuild.ready, true);
    await s.service.join(key);
  }
  assert.equal(s.workers.length, 5, 'Traversal consumes every ready coordinate without a second generation.');
  assert.equal(s.logs.filter(row => row.phase === 'prefetch-hit').length, 5);
});

test('genuine foreign inventory changes retain exact safe field diagnostics and stop automatically', async t => {
  const s = setup(t, { retryOptions: {} }); s.queue(['north']); await wait(() => s.workers.length === 1);
  const before = s.state.getRoomNameDatabase();
  s.emit(0, 'complete', artifact => { artifact.rooms['0,0,0'].inventory = ['private object name']; });
  assert.equal(s.state.getRoomNameDatabase(), before); assert.equal(s.service.status()[0].retryable, false);
  const log = s.logs.find(row => row.phase === 'discarded');
  assert.deepEqual(log.evidence.changedPaths, ['0,0,0.inventory']); assert.ok(!JSON.stringify(log).includes('private object name'));
});

test('the PC supplies immutable per-run leases and all three concurrent destinations know the other assignments', async t => {
  const s = setup(t, { retryOptions: {} }); s.queue(); await wait(() => s.workers.length === 3);
  for (const { job } of s.spawned) {
    assert.equal(job.assignment.authority, 'pc-game-server'); assert.equal(job.assignment.leaseId, job.id);
    assert.equal(job.assignment.runId, job.runId); assert.equal(job.assignment.destination, job.key);
    assert.ok(job.assignment.readOnly.includes('0,0,0'));
    assert.deepEqual(job.assignment.writeSet, [job.key]);
    assert.equal(job.assignment.assignments.length, 3);
    assert.deepEqual(new Set(job.assignment.assignments.map(row => row.destination)), new Set(['0,1,0', '1,0,0', '0,-1,0']));
    assert.ok(Object.isFrozen(job.assignment)); assert.ok(Object.isFrozen(job.assignment.assignments));
    assert.throws(() => job.assignment.writeSet.push('0,0,0'), /extensible|read only/);
  }
});

test('foreground construction and adjacent workers share the same PC run registry', async t => {
  const s = setup(t, { retryOptions: {} }), registry = require('../retort/roomBuildCoordination').registryFor(s.state);
  const foreground = { id: 'foreground-owner', runId: s.state.getDungeonRunId(), key: '0,0,0', phase: 'running', stage: 'music', attempt: 1 };
  registry.assign(foreground); t.after(() => registry.release(foreground.id));
  s.queue(); await wait(() => s.workers.length === 3);
  for (const { job } of s.spawned) {
    const peer = job.assignment.assignments.find(row => row.owner === foreground.id);
    assert.equal(peer.destination, '0,0,0'); assert.equal(peer.stage, 'music');
    assert.ok(!job.assignment.writeSet.includes('0,0,0'));
  }
  assert.throws(() => registry.assign({ ...foreground, id: 'competing-owner' }), /reserved/);
});

test('an unauthorized foreign-room write is terminal, not an automatic paid retry', async t => {
  const s = setup(t, { retryOptions: { retryDelayMs: 0 } }); s.queue(['north', 'east']); await wait(() => s.workers.length === 2);
  const before = s.state.getRoomNameDatabase();
  s.emit(0, 'complete', artifact => { artifact.rooms['1,0,0'].inventory = ['forged']; });
  assert.equal(s.service.status().find(row => row.key === '0,1,0').phase, 'discarded');
  assert.equal(s.state.getRoomNameDatabase(), before); await tick(); assert.equal(s.workers.length, 2);
});

test('a leased job rejects missing and expired artifact leases before installing caches', async t => {
  for (const lease of [undefined, 'expired-lease']) {
    const s = setup(t, { retryOptions: {} }); s.queue(['north']); await wait(() => s.workers.length === 1);
    const before = s.state.getRoomNameDatabase(); s.emit(0, 'complete', artifact => { artifact.leaseId = lease; });
    assert.equal(s.service.status()[0].phase, 'discarded'); assert.match(s.service.status()[0].reason, /lease mismatch/);
    assert.equal(s.state.getRoomNameDatabase(), before); assert.equal(s.dungeons['0,1,0'], undefined);
  }
});

test('visited-source scratch normalization and live state changes do not discard any of three complete targets', async t => {
  for (const order of [[0, 1, 2], [2, 1, 0]]) {
    const s = setup(t, { retryOptions: {} });
    s.db()['0,0,0'].classification = { indoor: true }; s.db()['0,0,0'].indoor = true;
    s.queue(); await wait(() => s.workers.length === 3);
    for (const n of order) {
      const source = s.db()['0,0,0']; source.playerNote = 'Preserve discovery ' + n;
      source.inhabitants = { actors: { Veyra: { hp: 17 - n, dialogue: ['Live line ' + n] } } };
      source.objects = [{ name: 'Player discovery ' + n }]; source.attemptedSearches = n;
      const before = structuredClone(source), job = s.spawned[n].job;
      const raw = makeArtifact(job); Object.assign(raw.rooms['0,0,0'], { isIndoor: true, isOutdoor: false, objects: [] });
      const scoped = Build.scopeArtifact(job, raw, job.base);
      s.workers[n].emit('message', { type: 'checkpoint', artifact: scoped }); s.done(n);
      assert.deepEqual(s.db()['0,0,0'], before); assert.equal(s.db()[job.key].preparedBuild.ready, true);
    }
    assert.equal(s.workers.length, 3); assert.ok(s.service.status().every(row => row.phase === 'complete'));
    assert.ok(s.logs.some(row => row.phase === 'ready' && row.readOnlyNormalizations.includes('0,0,0.objects')));
    const count = s.workers.length; await s.service.join('0,1,0');
    assert.equal(s.workers.length, count); assert.ok(s.logs.some(row => row.phase === 'prefetch-hit'));
  }
});

test('genuine shared topology conflicts automatically retry on a fresh snapshot and joiners keep the same logical job', async t => {
  const s = setup(t, { retryOptions: { retryDelayMs: 0 } }); s.queue(['north', 'east']); await wait(() => s.workers.length === 2);
  s.emit(0, 'complete', artifact => { artifact.rooms['1,1,0'] = { name: 'Accepted Shared Road' }; }); s.done(0);
  const oldId = s.spawned[1].job.id, oldWorker = s.workers[1];
  let joined = false; const joining = s.service.join('1,0,0').then(() => { joined = true; });
  s.emit(1, 'complete', artifact => { artifact.rooms['1,1,0'] = { name: 'Conflicting Road' }; });
  assert.equal(joined, false); assert.equal(s.db()['1,0,0'].preparedBuild, undefined);
  await wait(() => s.workers.length === 3);
  const job = s.spawned[2].job;
  assert.notEqual(job.id, oldId); assert.equal(job.attempt, 2);
  assert.equal(job.base['1,1,0'].name, 'Accepted Shared Road');
  oldWorker.emit('message', { type: 'done' }); oldWorker.emit('exit', 1);
  assert.equal(s.service.status().find(row => row.key === '1,0,0').phase, 'running');
  s.emit(2); s.done(2); await joining; assert.equal(joined, true);
  assert.equal(s.db()['1,0,0'].preparedBuild.ready, true);
  assert.ok(s.logs.some(row => row.phase === 'conflict'));
  assert.ok(s.logs.some(row => row.phase === 'retry' && row.previousId === oldId));
});

test('default conflict recovery is bounded to two retries and never retries model/transport failures', async t => {
  const s = setup(t, { retryOptions: { retryDelayMs: 0 } }); s.queue(['north']); await wait(() => s.workers.length === 1);
  for (let n = 0; n < 3; n++) {
    const job = s.spawned[n].job;
    s.db()['1,1,0'] = { name: 'A real current room' };
    s.emit(n, 'complete', artifact => { artifact.rooms['1,1,0'] = { name: 'A conflicting generated room ' + n }; });
    if (n < 2) await wait(() => s.workers.length === n + 2);
    assert.equal(s.db()[job.key].preparedBuild, undefined);
  }
  assert.equal(s.service.status()[0].phase, 'discarded'); assert.equal(s.workers.length, 3);
  const failed = setup(t, { retryOptions: { retryDelayMs: 0 } }); failed.queue(['north']); await wait(() => failed.workers.length === 1);
  failed.workers[0].emit('message', { type: 'failed', reason: 'Provider quota exceeded.' });
  await tick(); assert.equal(failed.workers.length, 1); assert.equal(failed.service.status()[0].phase, 'failed');
});

test('quest invalidation during retry backoff cancels without another generation or a hung join', async t => {
  const s = setup(t, { retryOptions: { retryDelayMs: 15 } }); s.queue(['north']); await wait(() => s.workers.length === 1);
  s.db()['1,1,0'] = { name: 'Current' };
  const joining = s.service.join('0,1,0');
  s.emit(0, 'complete', artifact => { artifact.rooms['1,1,0'] = { name: 'Stale' }; }); s.changeQuest();
  await wait(() => s.service.status()[0].phase === 'cancelled'); await joining;
  assert.equal(s.workers.length, 1); assert.equal(s.db()['0,1,0'].preparedBuild, undefined);
});

test('host history proposals append both casts without importing other visited-room edits', async t => {
  const s = setup(t); s.queue(['north', 'east']); await wait(() => s.workers.length === 2);
  const origin = structuredClone(s.db()['0,0,0']);
  for (let n = 0; n < 2; n++) {
    const job = s.spawned[n].job, artifact = makeArtifact(job);
    artifact.rooms['0,0,0'].crossGameHistory = { version: 2, runs: [{ runId: job.runId, at: 123, names: ['resident ' + n] }] };
    const scoped = Build.scopeArtifact(job, artifact, job.base);
    s.workers[n].emit('message', { type: 'checkpoint', artifact: scoped }); s.done(n);
  }
  const { crossGameHistory, ...source } = s.db()['0,0,0']; assert.deepEqual(source, origin);
  assert.deepEqual(crossGameHistory.runs[0].names, ['resident 0', 'resident 1']);
});

test('injected spawn remains single-slot unless concurrency is explicitly supplied', async t => {
  for (const concurrency of [undefined, 2, 3]) {
    const s = setup(t, { injected: true, concurrency }); s.web.remoteBuild = true; s.web.remote = false; s.queue();
    await wait(() => s.workers.length === (concurrency || 1)); await tick();
    assert.equal(s.workers.length, concurrency || 1); s.service._reset();
  }
  assert.throws(() => Queue.createService({}, { concurrency: 4, models: {}, website: {} }), /between 1 and 3/);
});

test('remote capacity backpressure never falls back to local workers and later capacity wakes the queue', async t => {
  const s = setup(t, { capacity: 0 }); s.queue(); await tick();
  assert.equal(s.workers.length, 0);
  s.web.capacity = 1; await wait(() => s.workers.length === 1);
  s.web.capacity = 20; await wait(() => s.workers.length === 3);
  assert.ok(s.service.status().every(j => j.remote));
});

test('configured remote engine waits for connection readiness without launching PC workers, then dispatches remotely', async t => {
  const localWorkers = [], s = setup(t, { queue: queueWithLocalProbe(localWorkers) });
  s.web.remoteBuild = true; s.web.remote = false;
  assert.equal(s.queue().length, 3);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(localWorkers.length, 0, 'Not-ready remote construction must not fall back to a PC Worker.');
  assert.equal(s.workers.length, 0); assert.ok(s.service.status().every(job => job.phase === 'queued'));
  s.web.remote = true; await wait(() => s.workers.length === 3);
  assert.equal(localWorkers.length, 0); assert.ok(s.service.status().every(job => job.remote && job.phase === 'running'));
});

test('legacy remoteBuild-unset configuration retains the single local worker path', async t => {
  const localWorkers = [], s = setup(t, { queue: queueWithLocalProbe(localWorkers) });
  s.web.remote = false;
  assert.equal(s.web.remoteBuild, undefined); s.queue();
  await wait(() => localWorkers.length === 1); await tick();
  assert.equal(localWorkers.length, 1); assert.equal(s.workers.length, 0);
  assert.equal(s.service.status().filter(job => job.phase === 'running').length, 1);
  assert.equal(s.service.status().filter(job => job.phase === 'queued').length, 2);
  assert.ok(localWorkers[0].script.endsWith('roomBuildWorker.js'));
});

test('three independent stale snapshots merge in all completion orders without replacing other targets', async t => {
  for (const order of [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]]) {
    const s = setup(t); s.queue(); await wait(() => s.workers.length === 3);
    const hall = structuredClone(s.db()['0,0,0']);
    for (const n of order) { s.emit(n); s.done(n); }
    assert.deepEqual(s.db()['0,0,0'], hall);
    for (const { job } of s.spawned) {
      assert.equal(s.db()[job.key].preparedBuild.id, job.id);
      assert.equal(s.db()[job.key].preparedBuild.ready, true);
      assert.ok(s.dungeons[job.key]); assert.ok(s.music[job.key]);
    }
    assert.ok(s.service.status().every(j => j.phase === 'complete')); s.service._reset();
  }
});

test('different shared-neighbor proposals discard the loser atomically and require explicit fresh retry', async t => {
  const s = setup(t); s.queue(); await wait(() => s.workers.length === 3);
  s.emit(0, 'complete', a => { a.rooms['1,1,0'] = { name: 'First Shared Road' }; }); s.done(0);
  const accepted = s.state.getRoomNameDatabase(), loser = s.spawned[1].job;
  s.emit(1, 'complete', a => { a.rooms['1,1,0'] = { name: 'Different Shared Road' }; });
  assert.equal(s.state.getRoomNameDatabase(), accepted);
  assert.equal(s.dungeons[loser.key], undefined);
  const rejected = s.service.status().find(j => j.key === loser.key);
  assert.equal(rejected.phase, 'discarded'); assert.equal(rejected.retryable, true);
  assert.match(rejected.reason, /Concurrent room change.*retry/);
  s.emit(2); s.done(2);
  assert.deepEqual(s.queue(), []);
  assert.deepEqual(s.queue(['east'], true), [loser.key]); await wait(() => s.workers.length === 4);
  assert.notEqual(s.spawned[3].job.id, loser.id);
  assert.equal(s.spawned[3].job.base['1,1,0'].name, 'First Shared Road');
  s.emit(3); s.done(3); assert.equal(s.db()[loser.key].preparedBuild.ready, true);
});

test('auxiliary writes cannot mutate another reserved target or an already prepared target', async t => {
  for (const prepared of [false, true]) {
    const s = setup(t); s.queue(); await wait(() => s.workers.length === 3);
    if (prepared) { s.emit(0); s.done(0); }
    const before = s.state.getRoomNameDatabase();
    s.emit(1, 'complete', a => { a.rooms[s.spawned[0].job.key].workerRepair = 'foreign write'; });
    assert.equal(s.state.getRoomNameDatabase(), before);
    assert.equal(s.service.status().find(j => j.key === s.spawned[1].job.key).phase, 'discarded');
    assert.equal(s.db()[s.spawned[0].job.key].workerRepair, undefined); s.service._reset();
  }
});

test('city coordinate namespaces conflict even when both workers propose the same room name', async t => {
  const s = setup(t); s.queue(); await wait(() => s.workers.length === 3);
  const city = n => a => { a.rooms['0,3,30'] = { name: 'Gate Ward',
    cityRoom: { anchorKey: s.spawned[n].job.key, cityId: 'city-' + n } }; };
  s.emit(0, 'complete', city(0)); s.done(0); const before = s.state.getRoomNameDatabase();
  s.emit(1, 'complete', city(1));
  assert.equal(s.state.getRoomNameDatabase(), before);
  assert.equal(s.db()['0,3,30'].cityRoom.cityId, 'city-0');
  assert.match(s.service.status().find(j => j.key === '1,0,0').reason, /cityRoom namespace/);
});

test('a new one-way exit into another in-flight target is rejected without changing topology', async t => {
  const s = setup(t); s.queue(); await wait(() => s.workers.length === 3);
  s.emit(0, 'complete', a => { a.rooms['0,1,0'].exits = { southeast: { targetCoordinates: '1,0,0' } }; });
  assert.equal(s.db()['0,1,0'].exits, undefined);
  assert.match(s.service.status()[0].reason, /lacks a reserved return/);
});

test('run, restore, quest, model and connection changes fence every late pool result', async t => {
  for (const change of [s => s.newRun(), s => s.restore(), s => s.changeQuest(), s => s.model.revision++,
    s => { s.model.id = 'another-model'; }, s => s.web.revision++, s => { s.web.enabled = false; }, s => { s.web.remote = false; }]) {
    const s = setup(t); s.queue(['north','east','south','west']); await wait(() => s.workers.length === 3);
    const before = s.state.getRoomNameDatabase(); change(s);
    for (let n = 0; n < 3; n++) { s.emit(n); s.done(n); }
    await wait(() => s.service.status().every(j => j.phase === 'cancelled'));
    assert.equal(s.state.getRoomNameDatabase(), before);
    assert.equal(s.workers.length, 3); assert.ok(s.workers.every(w => w.terminated === 1));
    await s.service.join('0,1,0'); s.service._reset();
  }
});

test('foreground join prioritizes a queued coordinate and duplicate exits/joiners share one build', async t => {
  const s = setup(t);
  const db = s.db(); db['0,0,0'].exits.up = { targetCoordinates: '10,10,0' }; s.state.setRoomNameDatabase(JSON.stringify(db));
  assert.equal(s.queue(['north','east','south','west','portal','up']).length, 5);
  assert.deepEqual(s.queue(), []); await wait(() => s.workers.length === 3);
  let joined = 0;
  const joins = [s.service.join('10,10,0'), s.service.join('10,10,0')].map(p => p.then(() => joined++));
  await tick(); assert.equal(joined, 0);
  s.emit(0); s.done(0); await wait(() => s.workers.length === 4);
  assert.equal(s.spawned[3].job.key, '10,10,0'); assert.equal(s.spawned[3].job.entering, true);
  s.emit(3); await tick(); assert.equal(joined, 0);
  s.done(3); await Promise.all(joins); assert.equal(joined, 2);
  await wait(() => s.workers.length === 5);
  assert.equal(s.spawned[4].job.key, '-1,0,0');
  assert.equal(s.spawned.filter(({ job }) => job.key === '10,10,0').length, 1);
});

test('a new run gets new job identities and old emitters cannot commit to the replacement run', async t => {
  const s = setup(t); s.queue(); await wait(() => s.workers.length === 3);
  const old = s.spawned.map(row => ({ ...row.job })); s.newRun(); s.queue();
  await wait(() => s.workers.length === 6);
  for (let n = 0; n < 3; n++) { s.emit(n); s.done(n); }
  assert.equal(s.db()['0,1,0'].populationComplete, undefined);
  for (let n = 0; n < 3; n++) {
    assert.notEqual(s.spawned[n + 3].job.id, old[n].id);
    assert.notEqual(s.spawned[n + 3].job.runId, old[n].runId);
    s.emit(n + 3); s.done(n + 3);
  }
  assert.ok(s.service.status().every(j => j.phase === 'complete'));
});

test('checkpoint replay is idempotent and a late earlier stage cannot regress a completed receipt', async t => {
  const s = setup(t); s.queue(['north']); await wait(() => s.workers.length === 1);
  const geometry = s.emit(0, 'geometry'), writes = s.writes.length;
  s.workers[0].emit('message', { type: 'checkpoint', artifact: structuredClone(geometry) });
  assert.equal(s.writes.length, writes);
  s.emit(0); const before = s.state.getRoomNameDatabase();
  s.workers[0].emit('message', { type: 'checkpoint', artifact: geometry });
  assert.equal(s.state.getRoomNameDatabase(), before);
  assert.equal(s.db()['0,1,0'].preparedBuild.ready, true);
  assert.equal(s.service.status()[0].phase, 'discarded');
});

test('population then parallel geometry/music/art accumulate safely in all branch completion orders', async t => {
  for (const order of [['geometry','music','art'], ['geometry','art','music'], ['music','geometry','art'],
    ['music','art','geometry'], ['art','geometry','music'], ['art','music','geometry']]) {
    const s = setup(t); s.queue(['north']); await wait(() => s.workers.length === 1);
    const job = s.spawned[0].job, full = makeArtifact(job), accumulated = makeArtifact(job, 'population');
    const send = () => s.workers[0].emit('message', { type: 'checkpoint', artifact: structuredClone(accumulated) });
    send();
    for (const stage of order) {
      accumulated.stage = stage;
      if (stage === 'geometry') accumulated.dungeon = full.dungeon;
      if (stage === 'music') accumulated.music = full.music;
      if (stage === 'art') accumulated.rooms[job.key].illustration = full.rooms[job.key].illustration;
      send();
      assert.equal(s.service.status()[0].phase, 'running');
      assert.equal(s.db()[job.key].preparedBuild.stage, stage);
      assert.equal(s.db()[job.key].preparedBuild.ready, false);
      if (!accumulated.dungeon) assert.equal(s.dungeons[job.key], undefined);
      assert.deepEqual(job.base, accumulated.rooms);
    }
    accumulated.stage = 'complete'; send(); s.done(0);
    assert.equal(s.db()[job.key].preparedBuild.ready, true);
    assert.ok(s.db()[job.key].illustration.plan); assert.ok(s.dungeons[job.key]); assert.ok(s.music[job.key]);
    assert.equal(s.service.status()[0].phase, 'complete'); s.service._reset();
  }
});

test('replaying an earlier branch cannot replace the accumulated artifact or change the latest stage', async t => {
  const s = setup(t); s.queue(['north']); await wait(() => s.workers.length === 1);
  const job = s.spawned[0].job, music = makeArtifact(job, 'music'); music.dungeon = null;
  s.workers[0].emit('message', { type: 'checkpoint', artifact: music });
  const geometry = structuredClone(music); geometry.stage = 'geometry'; geometry.dungeon = makeArtifact(job).dungeon;
  s.workers[0].emit('message', { type: 'checkpoint', artifact: geometry });
  const before = s.state.getRoomNameDatabase(), base = structuredClone(job.base), writes = s.writes.length;
  s.workers[0].emit('message', { type: 'checkpoint', artifact: structuredClone(music) });
  assert.equal(s.writes.length, writes); assert.equal(s.state.getRoomNameDatabase(), before);
  assert.deepEqual(job.base, base); assert.equal(s.service.status()[0].stage, 'geometry');
});

test('music and art without a dungeon remain partial and cannot satisfy final complete validation', async t => {
  const s = setup(t); s.queue(['north']); await wait(() => s.workers.length === 1);
  const partial = makeArtifact(s.spawned[0].job); partial.dungeon = null; partial.stage = 'art';
  s.workers[0].emit('message', { type: 'checkpoint', artifact: structuredClone(partial) });
  assert.equal(s.db()['0,1,0'].preparedBuild.ready, false); assert.ok(s.music['0,1,0']);
  partial.stage = 'complete'; s.workers[0].emit('message', { type: 'checkpoint', artifact: partial });
  assert.equal(s.db()['0,1,0'].preparedBuild.ready, false);
  assert.equal(s.service.status()[0].phase, 'discarded'); assert.match(s.service.status()[0].reason, /Incomplete room artifact/);
});

test('cache setters cannot mutate worker payloads and break replay identity', async t => {
  const s = setup(t); s.queue(['north']); await wait(() => s.workers.length === 1);
  const setter = s.state.setRoomDungeon;
  s.state.setRoomDungeon = (coords, dungeon) => { dungeon.customTiles ||= []; setter(coords, dungeon); };
  const artifact = s.emit(0, 'geometry'), writes = s.writes.length;
  assert.equal(artifact.dungeon.customTiles, undefined);
  s.workers[0].emit('message', { type: 'checkpoint', artifact: structuredClone(artifact) });
  assert.equal(s.writes.length, writes); assert.equal(s.service.status()[0].phase, 'running');
});

test('wrong job or run identities are rejected before installing any checkpoint state', async t => {
  for (const field of ['jobId','runId']) {
    const s = setup(t); s.queue(['north']); await wait(() => s.workers.length === 1);
    const message = { type: 'checkpoint', artifact: makeArtifact(s.spawned[0].job), [field]: 'wrong' };
    s.workers[0].emit('message', message);
    assert.equal(s.writes.length, 0); assert.equal(s.service.status()[0].phase, 'discarded'); s.service._reset();
  }
});

test('cache-only foreground edits conflict instead of being overwritten by later room stages', async t => {
  const s = setup(t); s.queue(['north']); await wait(() => s.workers.length === 1);
  s.emit(0, 'geometry'); s.dungeons['0,1,0']._geometryStamp = 'foreground-door-edit';
  const before = s.state.getRoomNameDatabase(); s.emit(0, 'music');
  assert.equal(s.dungeons['0,1,0']._geometryStamp, 'foreground-door-edit');
  assert.equal(s.state.getRoomNameDatabase(), before); assert.equal(s.service.status()[0].phase, 'discarded');
});

test('failed cache installation cannot publish a ready room', async t => {
  const s = setup(t); s.queue(['north']); await wait(() => s.workers.length === 1);
  s.emit(0, 'population'); const before = s.state.getRoomNameDatabase();
  s.state.setRoomDungeon = () => { throw Error('Injected cache failure.'); };
  s.emit(0);
  assert.equal(s.state.getRoomNameDatabase(), before);
  assert.equal(s.db()['0,1,0'].preparedBuild.ready, false);
  assert.equal(s.service.status()[0].phase, 'discarded');
});

test('explicit retry uses a fresh ID and stale same-ID or superseded snapshots cannot erase checkpoints', async t => {
  const s = setup(t); s.queue(['north']); await wait(() => s.workers.length === 1);
  s.emit(0, 'geometry'); const stale = s.state.getRoomNameDatabase(), id = s.spawned[0].job.id;
  s.workers[0].emit('message', { type: 'failed', reason: 'Offline failure.' });
  assert.deepEqual(s.queue(['north']), []); s.queue(['north'], true); await wait(() => s.workers.length === 2);
  s.emit(1, 'geometry'); assert.notEqual(s.db()['0,1,0'].preparedBuild.id, id);
  assert.equal(s.db()['0,1,0'].preparedBuild.previousId, id);
  const partial = s.state.getRoomNameDatabase(); s.emit(1); const ready = s.state.getRoomNameDatabase();
  s.state.setRoomNameDatabase(partial); assert.equal(s.state.getRoomNameDatabase(), ready);
  s.state.setRoomNameDatabase(stale); assert.equal(s.state.getRoomNameDatabase(), ready);
  s.done(1);
});
