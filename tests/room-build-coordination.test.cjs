'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createRegistry } = require('../retort/roomBuildCoordination');
const Build = require('../retort/roomBuildState'), Topology = require('../retort/roomBuildTopology');
const Adapter = require('../retort/websiteRoomBuild');
const { EventEmitter } = require('node:events');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('only the PC reservation transaction publishes topology ownership; conflicting reservations are atomic', () => {
  const registry = createRegistry('run'), one = { id: 'one', runId: 'run', key: '0,1,0' }, two = { id: 'two', runId: 'run', key: '1,0,0' };
  registry.assign(one); registry.assign(two);
  const jobs = new Map([[one.key, one], [two.key, two]]);
  const commit = registry.reserve(one, ['1,1,0']);
  assert.deepEqual(registry.describe(one, jobs, {}).writeSet, [one.key]); commit();
  assert.deepEqual(registry.describe(one, jobs, {}).writeSet, [one.key, '1,1,0']);
  assert.throws(() => registry.reserve(two, ['2,1,0', '1,1,0']), error => error.code === 'ROOM_BUILD_CONFLICT');
  assert.deepEqual(registry.describe(two, jobs, {}).writeSet, [two.key]);
  registry.release(one.id); registry.reserve(two, ['1,1,0'])();
  assert.deepEqual(registry.describe(two, jobs, {}).writeSet, [two.key, '1,1,0']);
});

test('read-only normalization never hides a genuine object edit, name change or foreign field write', () => {
  const base = { '0,0,0': { name: 'Hall', indoor: true }, '0,1,0': { name: 'Road' } }, job = { key: '0,1,0', id: 'job' };
  const rooms = structuredClone(base);
  Object.assign(rooms['0,0,0'], { objects: [{ name: 'Forbidden gift' }], name: 'Forged Hall', workerRepair: true, isIndoor: true });
  const result = Build.scopeArtifact(job, { rooms }, base);
  assert.equal(result.rooms['0,0,0'].isIndoor, undefined);
  assert.equal(result.rooms['0,0,0'].name, 'Forged Hall');
  assert.equal(result.rooms['0,0,0'].workerRepair, true);
  assert.equal(result.rooms['0,0,0'].objects[0].name, 'Forbidden gift');
  assert.equal(rooms['0,0,0'].isIndoor, true, 'Projection must not mutate the transport payload.');
});

test('malformed, foreign-run and subtractive history proposals cannot overwrite the PC history', () => {
  const base = { version: 2, runs: [{ runId: 'run', at: 1, names: ['original'] }] };
  for (const proposed of [{ version: 2, runs: [{ runId: 'other-run', at: 2, names: ['wrong'] }] },
    { version: 2, runs: [{ runId: 'run', at: 1, names: [] }] }, { version: 2, runs: [{ runId: 'run', at: 1, money: 100 }] }])
    assert.throws(() => Build.mergeHistory(base, proposed, base, 'run'), /Concurrent room change/);
  assert.deepEqual(base.runs[0].names, ['original']);
});

test('legacy version-one history migrates canonically without losing concurrent PC additions', () => {
  const base = { version: 1, runs: [{ runId: 'run', at: 1, names: ['Veyra Ashquiet'] }] };
  const current = structuredClone(base); current.runs[0].names.push('PC Discovery');
  const proposed = { version: 2, runs: [{ runId: 'run', at: 1, names: ['veyra ashquiet', 'new resident'] }] };
  const result = Build.mergeHistory(base, proposed, current, 'run');
  assert.equal(result.version, 2);
  assert.deepEqual(result.runs[0].names, ['veyra ashquiet', 'pc discovery', 'new resident']);
  assert.deepEqual(base.runs[0].names, ['Veyra Ashquiet']);
});

test('worker assignment identity is immutable input, not permission to choose another destination', () => {
  const base = { '0,1,0': { name: 'Road' } };
  const job = { id: 'one', runId: 'run', key: '0,1,0', assignment: { authority: 'website', leaseId: 'one', runId: 'run', destination: '0,1,0' } };
  assert.throws(() => Build.scopeArtifact(job, { rooms: base }, base), /Invalid PC room assignment/);
});

test('topology planning cannot create a new one-way link into another assigned destination', () => {
  for (let seed = 0; seed < 20; seed++) {
    const db = { '0,0,0': { name: 'Origin', visited: true, exits: { north: { targetCoordinates: '0,1,0' } } },
      '0,1,0': { name: 'Road', indoor: false }, '1,0,0': { name: 'Other worker' } };
    Topology.prepare(db, '0,1,0', { seed: String(seed), protectedKeys: new Set(['1,0,0']) });
    assert.ok(!Object.values(db['0,1,0'].exits).some(exit => exit.targetCoordinates === '1,0,0'));
    assert.equal(db['0,1,0'].exits.south.targetCoordinates, '0,0,0');
  }
});

test('all remote stages receive only serializable PC assignment context and keep branch parallelism', async () => {
  const job = { id: 'job', key: '0,1,0', runId: 'run', name: 'Road', model: 'offline',
    assignment: { authority: 'pc-game-server', leaseId: 'job', runId: 'run', destination: '0,1,0', writeSet: ['0,1,0'], assignments: [] } };
  const snapshot = { roomNameDatabaseString: JSON.stringify({ '0,1,0': { name: 'Road' } }), roomDungeonDatabase: {} };
  const calls = [], releases = new Map(), events = [];
  const worker = Adapter.spawnBuild(job, snapshot, { runStage: (order, source, { onCheckpoint }) => new Promise(resolve => {
    calls.push(order);
    const release = () => {
      const rooms = JSON.parse(source.roomNameDatabaseString);
      rooms[job.key].populationComplete = true;
      onCheckpoint({ artifact: { jobId: job.id, leaseId: job.id, key: job.key, runId: job.runId, stage: order.stage, rooms } }); resolve();
    };
    if (order.stage === 'population') release(); else releases.set(order.stage, release);
  }) });
  worker.on('message', value => events.push(value));
  await tick(); await tick();
  assert.deepEqual(new Set(releases.keys()), new Set(['geometry', 'music', 'art']));
  for (const call of calls) assert.deepEqual(call.assignment, job.assignment);
  for (const stage of ['art', 'music', 'geometry']) { releases.get(stage)(); await tick(); }
  assert.equal(events.at(-1).type, 'done');
});
