'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), { EventEmitter } = require('node:events');
const Build = require('../retort/roomBuildState'), Queue = require('../retort/roomBuildQueue');
const Adapter = require('../retort/websiteRoomBuild');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn) { for (let n = 0; n < 100 && !fn(); n++) await tick(); assert.ok(fn()); }
function setup(t, pending = false) {
  let db = { '0,0,0': { name: 'Entry Hall', visited: true, exits: {
    north: { targetCoordinates: '0,1,0' }, south: { targetCoordinates: '0,-1,0' }, southeast: { targetCoordinates: '1,-1,0' } } },
  '0,1,0': { name: 'Provisional alley', indoor: false, ...(pending ? { namePending: true } : {}) },
  '0,-1,0': { name: 'Foundation Court', indoor: false }, '1,-1,0': { name: 'Saltmarket', indoor: false } };
  let quest = 'None', here = { x: 0, y: 0, z: 0 }, run = 'ee87eaa7-688d-4335-bec2-c7937a98efd1';
  const dungeons = {}, workers = [], spawned = [], logs = [];
  const state = { getDungeonRunId: () => run, getLastCoords: () => here,
    getCurrentQuest: () => quest, getCurrentTasks: () => [], getCurrentTaskIndex: () => 0,
    getRoomNameDatabase: () => JSON.stringify(db), setRoomNameDatabase: json => {
      db = JSON.parse(Build.protectDatabase(JSON.stringify(db), json, run)); },
    getRoomDungeonForSimulation: c => dungeons[`${c.x},${c.y},${c.z}`] || null,
    setRoomDungeon: (c, d) => { dungeons[`${c.x},${c.y},${c.z}`] = structuredClone(d); },
    setRoomPopulation() {}, setRoomMusic() {},
    exportSaveState: () => ({ roomNameDatabaseString: JSON.stringify(db), lastCoords: { ...here }, roomDungeonDatabase: {} }) };
  const service = Queue.createService(state, { concurrency: 3, retryDelayMs: 0,
    models: { current: () => ({ id: 'offline', revision: 1 }) },
    website: { backgroundEnabled: () => true, view: () => ({ revision: 1 }) },
    spawn: (job, snapshot) => { const worker = new EventEmitter(); worker.terminate = () => {};
      workers.push(worker); spawned.push({ job, snapshot }); return worker; },
    logger: { info: (_, row) => logs.push(JSON.parse(row)) },
    commit: (s, j, a, opts) => Build.commit(s, j, a, { ...opts, adoptMusic() {} }) });
  t.after(() => service._reset());
  return { state, service, workers, spawned, logs, db: () => db, dungeons,
    move: c => { here = c; }, quest: value => { quest = value; }, newRun: () => { run = 'new'; } };
}
function artifact(job, stage = 'population') {
  const rooms = structuredClone(job.base), room = rooms[job.key];
  Object.assign(room, { populationComplete: true, description: 'An authored open court beneath a stone arcade.',
    inhabitants: { actors: {}, groups: [] }, illustration: { plan: {} } });
  return { key: job.key, runId: job.runId, jobId: job.id, leaseId: job.id, stage, rooms,
    dungeon: stage === 'population' ? null : { geoKey: job.key, _geometryStamp: 'ready', cells: { '1,1': { tile: 'floor' } },
      layout: { width: 16, height: 16 }, sceneSpec: { source: { roomName: room.name, description: room.description } } },
    music: { voices: [{}], archive: { id: 'offline' } } };
}

test('pending model names finalize once under the same lease, then every stage and stale client uses that identity', async t => {
  const s = setup(t, true), stale = s.state.getRoomNameDatabase();
  s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north'] }); await until(() => s.workers.length === 1);
  const job = s.spawned[0].job, population = artifact(job);
  const description = population.rooms[job.key].description; delete population.rooms[job.key].description;
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const start = source.indexOf('  if(currentRoomData.namePending'), end = source.indexOf('  if (!construction && currentRoomData.pendingCommunityActivation)', start);
  let namesRequested = 0;
  await vm.runInNewContext('(async()=>{' + source.slice(start, end) + '})()', {
    currentRoomData: population.rooms[job.key], roomNameDatabasePlain: population.rooms, coordKey: job.key,
    roomName: job.name, updatedGameConsole: 'Room Name: ' + job.name, $: {},
    setRoomSafeLocal: (db, key, room) => { db[key] = room; },
    require: id => { assert.equal(id, './holodekRoomWork'); return { locationName: async () => { namesRequested++; return 'Glass Orchard'; } }; } });
  assert.equal(namesRequested, 1, 'Exercise the real pending-name branch, not a synthetic rename policy.');
  population.rooms[job.key].description = description;
  s.workers[0].emit('message', { type: 'checkpoint', artifact: population });
  assert.equal(s.service.status()[0].phase, 'running'); assert.equal(job.name, 'Glass Orchard');
  assert.equal(s.db()[job.key].preparedBuild.provisionalName, 'Provisional alley');
  const full = artifact(job, 'complete');
  s.workers[0].emit('message', { type: 'checkpoint', artifact: full }); s.workers[0].emit('message', { type: 'done' });
  assert.equal(s.db()[job.key].preparedBuild.ready, true);
  const old = JSON.parse(stale); old['0,0,0'].playerNote = 'Keep a live discovery';
  s.state.setRoomNameDatabase(JSON.stringify(old));
  assert.equal(s.db()[job.key].name, 'Glass Orchard'); assert.equal(s.db()[job.key].namePending, undefined);
  assert.equal(s.db()['0,0,0'].playerNote, 'Keep a live discovery');
  await s.service.join(job.key); assert.equal(s.workers.length, 1);
});

test('non-pending, late, empty and foreign-lease renames still reject without any cache installation', async t => {
  for (const variant of ['not-pending', 'geometry', 'empty', 'lease', 'still-pending']) {
    const s = setup(t, variant !== 'not-pending');
    s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north'] }); await until(() => s.workers.length === 1);
    const job = s.spawned[0].job, a = artifact(job, variant === 'geometry' ? 'geometry' : 'population');
    a.rooms[job.key].name = variant === 'empty' ? '' : 'Wrong Replacement';
    if (variant !== 'still-pending') delete a.rooms[job.key].namePending;
    if (variant === 'lease') a.leaseId = 'foreign';
    const before = s.state.getRoomNameDatabase();
    s.workers[0].emit('message', { type: 'checkpoint', artifact: a });
    assert.equal(s.state.getRoomNameDatabase(), before); assert.equal(s.dungeons[job.key], undefined);
    assert.equal(s.service.status()[0].phase, 'discarded');
  }
});

test('parallel stage orders receive the accepted model name, not the provisional work-order label', async () => {
  const job = { id: 'job', key: '0,1,0', name: 'Provisional alley', runId: 'run' };
  const calls = [], events = [];
  const worker = Adapter.spawnBuild(job, { roomNameDatabaseString: JSON.stringify({ [job.key]: { name: job.name, namePending: true } }), roomDungeonDatabase: {} },
    { runStage: async (order, snapshot, { onCheckpoint }) => {
      calls.push(order); const rooms = JSON.parse(snapshot.roomNameDatabaseString);
      if (order.stage === 'population') { rooms[job.key].name = 'Glass Orchard'; delete rooms[job.key].namePending; }
      assert.equal(rooms[job.key].name, order.stage === 'population' ? 'Glass Orchard' : order.name);
      onCheckpoint({ artifact: { runId: job.runId, key: job.key, stage: order.stage, rooms } });
    } });
  worker.on('message', value => events.push(value));
  await until(() => events.some(e => ['done', 'failed'].includes(e.type)));
  assert.equal(events.at(-1).type, 'done');
  assert.deepEqual(calls.filter(c => c.stage !== 'population').map(c => c.name), ['Glass Orchard', 'Glass Orchard', 'Glass Orchard']);
});

test('the PC reserves disjoint frontier writes before dispatching three actual adjacent topology plans', async t => {
  const s = setup(t);
  s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north', 'south', 'southeast'] });
  await until(() => s.workers.length === 3);
  const keys = new Set();
  for (const { job, snapshot } of s.spawned) {
    assert.ok(job.assignment.writeSet.length > 1, 'Own new frontier coordinates before model requests.');
    for (const key of job.assignment.writeSet) { assert.ok(!keys.has(key), 'No shared write lease: ' + key); keys.add(key); }
    const room = JSON.parse(snapshot.roomNameDatabaseString)[job.key];
    assert.equal(room.backgroundTopology.version, 1);
    for (const exit of Object.values(room.exits)) {
      const other = JSON.parse(snapshot.roomNameDatabaseString)[exit.targetCoordinates];
      assert.ok(job.assignment.writeSet.includes(exit.targetCoordinates) || other?.visited ||
        Object.values(other?.exits || {}).some(back => back.targetCoordinates === job.key));
    }
  }
  for (let n = 2; n >= 0; n--) {
    const { job } = s.spawned[n], a = artifact(job, 'complete');
    for (const key of job.assignment.writeSet) if (!a.rooms[key])
      a.rooms[key] = { name: 'Mock authored frontier ' + key, exits: {} };
    s.workers[n].emit('message', { type: 'checkpoint', artifact: a }); s.workers[n].emit('message', { type: 'done' });
  }
  assert.ok(s.service.status().every(j => j.phase === 'complete' && j.attempt === 1));
  assert.equal(s.logs.filter(row => row.phase === 'retry').length, 0);
});

test('stale client synchronization cannot erase PC-planned topology before the population checkpoint', async t => {
  const s = setup(t), old = JSON.parse(s.state.getRoomNameDatabase());
  s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north'] }); await until(() => s.workers.length === 1);
  const planned = structuredClone(s.db()['0,1,0']);
  old['0,1,0'].exits = { up: { targetCoordinates: '0,1,30' } }; old['0,0,0'].playerNote = 'new';
  s.state.setRoomNameDatabase(JSON.stringify(old));
  assert.deepEqual(s.db()['0,1,0'].exits, planned.exits);
  assert.deepEqual(s.db()['0,1,0'].backgroundTopology, planned.backgroundTopology);
  assert.equal(s.db()['0,0,0'].playerNote, 'new');
});

test('chosen second-room entry joins construction and activates the private quest before display', async () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const start = source.indexOf('    const preparedKey = Inhabitants.roomKey(');
  const end = source.indexOf('    let roomDescriptionGenerated', start), block = source.slice(start, end);
  const main = source.indexOf('    return await run(gameRetort(async ($) => {');
  assert.ok(!source.slice(main, start).includes('generateQuest($)'), 'No quest mutation before joining the worker.');
  const events = [], state = { getRoomNameDatabase: () => '{}', getDungeonRunId: () => 'run', getUpdatedGameConsole: () => '' };
  await vm.runInNewContext('(async()=>{' + block + '})()', {
    updatedGameConsole: 'Coordinates: X: 1, Y: -1, Z: 0', roomNameDatabaseString: '{}', userInput: 'southeast', populationService: {}, broadcast() {},
    sharedState: state, Inhabitants: { roomKey: () => '1,-1,0' }, console: { info() {} },
    require: id => id === './preparedRoomEntry' ? { publish: () => { events.push('display'); return null; } } :
      id === './openingQuestPreparation' ? { entryPending: () => true, service: () => ({
        status: () => null, activate: async () => { events.push('activate'); return true; } }) } :
      id === './gameModels' ? { current: () => ({ id: 'offline' }) } : { service: () => ({ join: async key => events.push('join:' + key) }) },
    $: { run: fn => fn() }, generateQuest: async () => events.push('quest'), generateMissingRoomDetails: async () => {} });
  assert.deepEqual(events, ['join:1,-1,0', 'activate', 'display', 'quest']);
  const a = source.indexOf('  if (options.prepareRoom) {'), b = source.indexOf('\n    if (options.realtimeEncounter)', a);
  assert.ok(!source.slice(a, b).includes('generateQuest('));
  const quest = source.slice(source.indexOf('async function generateQuest($,'), source.indexOf('async function generateQuest($,') + 1200);
  assert.match(quest, /!preparation && questRoomCoordinates\.slice\(1\)\.every/);
});

test('a genuinely changed quest or run still fences late background artifacts', async t => {
  for (const change of [s => s.quest('A genuinely new quest'), s => s.newRun()]) {
    const s = setup(t); s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north'] }); await until(() => s.workers.length === 1);
    const job = s.spawned[0].job, before = s.state.getRoomNameDatabase(); change(s);
    s.workers[0].emit('message', { type: 'checkpoint', artifact: artifact(job, 'complete') });
    assert.equal(s.service.status()[0].phase, 'cancelled'); assert.equal(s.state.getRoomNameDatabase(), before);
  }
});

test('whichever second room is chosen consumes one completed build before the quest is seeded', async t => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const start = source.indexOf('    const preparedKey = Inhabitants.roomKey('), end = source.indexOf('    let roomDescriptionGenerated', start);
  for (const [direction, key] of [['north', '0,1,0'], ['south', '0,-1,0'], ['southeast', '1,-1,0']]) {
    const s = setup(t); let seeded = false;
    s.service.queueNeighbors({ currentKey: '0,0,0', exits: [direction] }); await until(() => s.workers.length === 1);
    const { job } = s.spawned[0];
    const entry = vm.runInNewContext('(async()=>{' + source.slice(start, end) + '})()', {
      updatedGameConsole: `Coordinates: X: ${job.coords.x}, Y: ${job.coords.y}, Z: ${job.coords.z}`, roomNameDatabaseString: '{}',
      userInput: direction, populationService: {}, broadcast() {},
      sharedState: { ...s.state, setUpdatedGameConsole() {}, getUpdatedGameConsole: () => '' },
      Inhabitants: { roomKey: () => key }, console: { info() {} },
      require: id => id === './roomBuildQueue' ? { service: () => s.service } : id === './preparedRoomEntry' ? { publish: () => null } :
        id === './openingQuestPreparation' ? { entryPending: () => true, service: () => ({ status: () => null,
          activate: async () => { seeded = true; s.quest('A new first quest bound on entry'); return true; } }) } :
        id === './gameModels' ? { current: () => ({ id: 'offline' }) } : Build,
      $: { run: fn => fn() }, generateQuest: async () => {} });
    await tick(); assert.equal(seeded, false); assert.equal(s.state.getCurrentQuest(), 'None');
    s.workers[0].emit('message', { type: 'checkpoint', artifact: artifact(job, 'complete') });
    s.workers[0].emit('message', { type: 'done' }); await entry;
    assert.equal(seeded, true); assert.equal(s.service.status()[0].phase, 'complete');
    assert.equal(s.workers.length, 1); assert.equal(s.db()[key].preparedBuild.ready, true);
    assert.equal(s.dungeons[key].sceneSpec.source.roomName, s.db()[key].name);
  }
});

test('missing content cannot be accepted merely because a pending name was finalized', async t => {
  for (const field of ['populationComplete', 'description']) {
    const s = setup(t, true); s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north'] }); await until(() => s.workers.length === 1);
    const { job } = s.spawned[0], a = artifact(job); a.rooms[job.key].name = 'Glass Orchard';
    delete a.rooms[job.key].namePending; delete a.rooms[job.key][field];
    const before = s.state.getRoomNameDatabase();
    s.workers[0].emit('message', { type: 'checkpoint', artifact: a });
    assert.equal(s.service.status()[0].phase, 'discarded'); assert.equal(s.state.getRoomNameDatabase(), before);
  }
});

test('a published frontier can get its own job while the parent geometry/music/art still run', async t => {
  const s = setup(t); s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north'] }); await until(() => s.workers.length === 1);
  const { job } = s.spawned[0], a = artifact(job), frontier = job.assignment.writeSet.find(key => key !== job.key);
  assert.ok(frontier);
  for (const key of job.assignment.writeSet) if (!a.rooms[key]) a.rooms[key] = { name: 'Mock authored frontier ' + key, exits: {} };
  s.workers[0].emit('message', { type: 'checkpoint', artifact: a });
  assert.equal(s.service.status()[0].phase, 'running');
  const db = s.db(); db[job.key].visited = true; s.state.setRoomNameDatabase(JSON.stringify(db)); s.move(job.coords);
  const direction = Object.keys(db[job.key].exits).find(d => db[job.key].exits[d].targetCoordinates === frontier);
  assert.deepEqual(s.service.queueNeighbors({ currentKey: job.key, exits: [direction] }), [frontier]);
  await until(() => s.workers.length === 2);
  assert.equal(s.spawned[1].job.key, frontier); assert.notEqual(s.spawned[1].job.id, job.id);
});

test('foreign frontier reservations are excluded before neighbor name and environment authoring requests', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const start = source.indexOf('    const namingDirections ='), end = source.indexOf('    const frontierIntent =', start);
  const directions = vm.runInNewContext(source.slice(start, end) + '\nnamingDirections;', {
    roomExitsArray: ['north', 'south', 'southeast'], existingAdjacentRooms: ['north'],
    currentRoomData: { exits: { north: { targetCoordinates: '0,1,0' }, south: { targetCoordinates: '0,-1,0' }, southeast: { targetCoordinates: '1,-1,0' } } },
    constructionReadOnly: key => key === '1,-1,0' });
  assert.deepEqual([...directions], ['south']);
});
