'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module'), { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const Build = require('../retort/roomBuildState'), Adapter = require('../retort/websiteRoomBuild');
const Art = require('../retort/roomIllustration'), ArtPlans = require('./fixtures/room-art.cjs');
const Save = require('../saveGameState');
const KEY = '0,0,0', BRANCHES = ['geometry', 'music', 'art'];
const ORDERS = [['geometry','music','art'], ['geometry','art','music'], ['music','geometry','art'],
  ['music','art','geometry'], ['art','geometry','music'], ['art','music','geometry']];
const clone = value => structuredClone(value);
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function eventually(condition) {
  for (let n = 0; n < 100 && !condition(); n++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(condition(), 'Expected the controlled room stage to advance.');
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise.then(value => ({ status: 'resolved', value }), error => ({ status: 'rejected', error })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'pending' }), 100); })]);
  } finally { clearTimeout(timer); }
}
function fixture({ populated = true } = {}) {
  const runId = randomUUID(); let restoreRevision = 0;
  const room = { name: 'First Hall', exits: {}, objects: [] };
  if (populated) Object.assign(room, { description: 'A quiet stone hall stretches beneath a vaulted roof.',
    populationComplete: true, inhabitants: { actors: {}, groups: [] } });
  const saved = { personalNarrative: 'The real player transcript.',
    updatedGameConsole: 'Room Name: First Hall\nRoom Description: ' + (room.description || 'None') +
      '\nCoordinates: X: 0, Y: 0, Z: 0\nTurns: 0\nInventory: Real player equipment',
    roomNameDatabaseString: JSON.stringify({ [KEY]: room, '0,1,0': { name: 'Road' } }),
    combatCharactersString: JSON.stringify([{ name: 'Aster', type: 'pc', hp: 17 }]),
    liveWorldState: { player: { x: 3, y: 4 }, inventory: ['real equipment'] }, npcAutonomyFeed: [],
    combatMode: 'Combat Map-Based', dungeonTestingMode: false, currentQuest: 'Find the missing witness',
    currentTasks: [], currentTaskIndex: 0, questSeeded: false, lastQuestUpdate: '', questLog: [],
    roomMusicDatabase: {}, roomDungeonDatabase: {}, dungeonRunId: runId, roomPopulations: {}, gamePaused: false,
    dialogueMemory: { characters: {}, recent: [] }, campaignMemory: { version: 1, runId, records: [], sequence: 0 },
    lastAdjudication: null, lastCoords: { x: 0, y: 0, z: 0 }, currentPC: { Name: 'Aster', HP: 17 },
    characterGenerationInProgress: false, pendingCharacterForReview: null };
  const writes = [], models = { id: 'offline-selected-model', revision: 1 };
  const coordsKey = c => `${c.x},${c.y},${c.z}`;
  const state = { getDungeonRunId: () => saved.dungeonRunId, getRestoreRevision: () => restoreRevision,
    getCurrentQuest: () => saved.currentQuest, getCurrentTaskIndex: () => saved.currentTaskIndex,
    getCurrentTasks: () => saved.currentTasks, getLastCoords: () => saved.lastCoords,
    getUpdatedGameConsole: () => saved.updatedGameConsole, getRoomNameDatabase: () => saved.roomNameDatabaseString,
    exportSaveState: () => clone(saved),
    setRoomNameDatabase: json => { writes.push('rooms'); saved.roomNameDatabaseString = Build.protectDatabase(saved.roomNameDatabaseString, json, saved.dungeonRunId); },
    getRoomDungeonForSimulation: c => saved.roomDungeonDatabase[coordsKey(c)] || null,
    getRoomMusic: c => saved.roomMusicDatabase[coordsKey(c)] || null,
    setRoomDungeon: (c, dungeon) => { writes.push('dungeon'); saved.roomDungeonDatabase[coordsKey(c)] = clone(dungeon); },
    setRoomPopulation: (key, population) => { writes.push('population'); saved.roomPopulations[key] = clone(population); },
    setRoomMusic: (c, music) => { writes.push('music'); saved.roomMusicDatabase[coordsKey(c)] = clone(music); } };
  for (const method of ['importSaveState', 'setUpdatedGameConsole', 'setCombatCharactersString', 'setCurrentPC',
    'setLiveWorldState', 'setLastCoords', 'setCurrentQuest', 'setCurrentTasks', 'setPersonalNarrative'])
    state[method] = () => assert.fail('Room construction must not call ' + method);
  const job = { id: randomUUID(), key: KEY, runId, name: room.name, coords: { x: 0, y: 0, z: 0 },
    model: models.id, entering: true, base: JSON.parse(saved.roomNameDatabaseString) };
  job.context = Build.context(state, job.model);
  return { state, saved, writes, models, job, snapshot: () => Adapter.constructionSnapshot(state, job),
    db: () => JSON.parse(saved.roomNameDatabaseString), restore: () => restoreRevision++ };
}
function stageArtifact(job, source) {
  const rooms = JSON.parse(source.roomNameDatabaseString), room = rooms[job.key];
  if (job.stage === 'population') Object.assign(room, { populationComplete: true,
    description: 'A quiet stone hall stretches beneath a vaulted roof.', inhabitants: { actors: {}, groups: [] } });
  const artifact = { jobId: job.id, leaseId: job.assignment?.leaseId, key: job.key, runId: job.runId, stage: job.stage, rooms, dungeon: null, music: null };
  if (job.stage === 'geometry') {
    room.sceneSpec = { source: { roomName: room.name, description: room.description } };
    artifact.dungeon = { geoKey: job.key, layout: { width: 16, height: 16 }, cells: { '8,8': { tile: 'floor' } },
      _geometryStamp: 'offline-geometry', sceneSpec: clone(room.sceneSpec) };
  }
  if (job.stage === 'music') {
    room.musicCue = 'quiet-hall';
    artifact.music = { title: 'Offline Hall', voices: [{}, {}, {}], archive: { id: 'offline-hall-0123456789abcdef' } };
  }
  if (job.stage === 'art') room.illustration = { plan: { layers: [{ kind: 'stone' }] } };
  return artifact;
}
function stageRunner({ mutate } = {}) {
  const calls = []; let active = 0, maximum = 0;
  const runStage = (job, source, options) => {
    const completion = deferred(), call = { job: clone(job), source: clone(source), options, finished: false };
    calls.push(call); active++; maximum = Math.max(maximum, active);
    const settle = (error, value) => {
      if (call.finished) return;
      call.finished = true; active--; options.signal.removeEventListener('abort', abort);
      if (error) completion.reject(error); else completion.resolve(value);
    };
    const abort = () => settle(Error('Controlled stage cancelled.'));
    call.release = () => {
      if (call.finished) return;
      const artifact = stageArtifact(call.job, call.source); mutate?.(artifact, call);
      try { options.onCheckpoint({ type: 'checkpoint', artifact }); settle(); }
      catch (error) { settle(error); }
    };
    call.fail = reason => settle(Error(reason));
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    return completion.promise;
  };
  return { calls, runStage, release: name => {
    const call = calls.find(row => row.job.stage === name && !row.finished);
    assert.ok(call, 'Missing pending ' + name + ' stage.'); call.release();
  }, maximum: () => maximum, active: () => active };
}
function observe(worker) {
  const messages = [], terminal = deferred();
  worker.on('message', message => { messages.push(message); if (['done','failed'].includes(message.type)) terminal.resolve(message); });
  return { messages, checkpoints: () => messages.filter(m => m.type === 'checkpoint').map(m => m.artifact), terminal: terminal.promise };
}
function playerState(saved) {
  const roomFields = new Set(['roomNameDatabaseString','roomDungeonDatabase','roomMusicDatabase','roomPopulations']);
  return Object.fromEntries(Save.FIELDS.filter(key => !roomFields.has(key)).map(key => [key, clone(saved[key])]));
}
function loadPipeline(models) {
  const file = require.resolve('../retort/websiteRoomPipeline'), nativeRequire = createRequire(file), module = { exports: {} };
  // Execute the complete production module, replacing only model selection and filesystem archive adoption.
  const requireFake = id => {
    if (id === './gameModels') return { current: () => ({ ...models }) };
    if (id === './roomBuildState') return { ...Build,
      commit: (state, job, artifact, options) => Build.commit(state, job, artifact, { ...options, adoptMusic() {} }) };
    if (id === './websiteAi') throw Error('Tests must inject the Website AI service.');
    return nativeRequire(id);
  };
  vm.runInThisContext('(function(require,module,exports,process){\n' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })
    (requireFake, module, module.exports, { env: {} });
  return module.exports;
}
function pipelineHarness(t, { manual = false, connect } = {}) {
  const f = fixture(), pipeline = loadPipeline(f.models), runner = stageRunner(), spawns = [];
  const config = { enabled: true, remoteBuild: true, revision: 1 };
  const website = { view: () => config, ensureConnected: () => connect?.promise || Promise.resolve(), remoteBuildEnabled: () => true,
    spawnBuild(job, snapshot, options) {
      let worker;
      if (manual) { worker = new EventEmitter(); worker.terminated = 0; worker.terminate = async () => { worker.terminated++; }; }
      else worker = Adapter.spawnBuild(job, snapshot, { ...options, runStage: runner.runStage });
      spawns.push({ job, snapshot: clone(snapshot), options, worker }); return worker;
    } };
  t.after(async () => { for (const { worker } of spawns) await worker.terminate(); await turn(); });
  return { ...f, pipeline, runner, website, config, spawns,
    begin: () => pipeline.begin(f.state, f.state.getUpdatedGameConsole(), { website, logger: { info() {} } }) };
}
function acceptedIllustration(state) {
  const source = Art.fingerprint(Art.context(state, KEY));
  const record = Art.accepted({ version: 1, source, plan: ArtPlans.temple() }, source);
  assert.ok(record, 'The cached-room fixture must pass the real illustration validator.');
  return record;
}
async function completeCachedRoom(f) {
  const entry = f.begin(); await eventually(() => f.spawns.length === 1);
  const call = f.spawns[0], artifact = stageArtifact({ ...call.job, stage: 'geometry' }, call.snapshot);
  artifact.music = stageArtifact({ ...call.job, stage: 'music' }, call.snapshot).music;
  artifact.rooms[KEY].illustration = acceptedIllustration(f.state);
  artifact.stage = 'complete'; artifact.completedStages = [...BRANCHES];
  call.worker.emit('message', { type: 'checkpoint', artifact });
  const outcome = await bounded(entry.barriers.complete.promise);
  assert.equal(outcome.status, 'resolved', outcome.error?.message);
  assert.equal(f.db()[KEY].preparedBuild.ready, true);
  assert.ok(Art.accepted(f.db()[KEY].illustration, Art.fingerprint(Art.context(f.state, KEY))));
  return entry;
}
function changeRoom(f, change) {
  const database = f.db(); change(database[KEY]); f.saved.roomNameDatabaseString = JSON.stringify(database);
}

test('constructionSnapshot validates before first geometry exists and never inserts scratch geometry into live state', () => {
  const f = fixture(); f.saved.characterGenerationInProgress = true;
  f.saved.roomDungeonDatabase['9,9,0'] = { _geometryStamp: 'unrelated' };
  const before = clone(f.saved);
  assert.throws(() => Save.validate(f.state.exportSaveState()), /geometry is missing/);
  const snapshot = f.snapshot();
  assert.doesNotThrow(() => Save.validate(snapshot));
  assert.deepEqual(snapshot.roomDungeonDatabase, { [KEY]: {} });
  assert.equal(snapshot.characterGenerationInProgress, false);
  snapshot.roomDungeonDatabase[KEY].mutated = true;
  assert.deepEqual(f.saved, before);
});

test('constructionSnapshot uses console coordinates, retains only current/target geometry, and rejects missing coordinates', () => {
  const f = fixture(); f.saved.lastCoords = { x: 9, y: 9, z: 0 };
  f.saved.roomDungeonDatabase = { [KEY]: { stamp: 'current' }, '0,1,0': { stamp: 'target' }, '9,9,0': { stamp: 'unrelated' } };
  const snapshot = Adapter.constructionSnapshot(f.state, { ...f.job, key: '0,1,0' });
  assert.deepEqual(snapshot.lastCoords, { x: 0, y: 0, z: 0 });
  assert.deepEqual(Object.keys(snapshot.roomDungeonDatabase).sort(), [KEY,'0,1,0']);
  assert.doesNotThrow(() => Save.validate(snapshot));
  assert.throws(() => Adapter.constructionSnapshot(f.state, f.job, 'No room coordinates.'), /authoritative coordinates/);
});

test('production preparation checkpoint attaches compiled archive identity for music/complete without changing the stored score', () => {
  const file = require.resolve('../retort/retortWithUserInput'), source = fs.readFileSync(file, 'utf8');
  const preparation = source.indexOf('  if (options.prepareRoom) {');
  const begin = source.indexOf('    const checkpoint = stage => {', preparation);
  const end = source.indexOf('\n    return runtime.run', begin);
  assert.ok(preparation >= 0 && begin > preparation && end > begin, 'Production checkpoint extraction boundaries must exist.');
  const createCheckpoint = vm.runInThisContext('(function(sharedState,job,options,require,Build,buildBase){\n' + source.slice(begin, end) +
    '\nreturn checkpoint;\n})', { filename: file });
  const f = fixture(), score = { title: 'Stored score without archive metadata', voices: [{}, {}, {}] };
  f.saved.roomMusicDatabase[KEY] = score; f.saved.roomDungeonDatabase[KEY] = {};
  const pristine = clone(score), records = [], checkpoints = [], archiveId = 'compiled-hall-0123456789abcdef';
  const checkpoint = createCheckpoint(f.state, f.job, { onBuildCheckpoint: artifact => checkpoints.push(artifact) }, id => {
    assert.equal(id, './sidArchive', 'The isolated checkpoint must use only the fake SID archive.');
    return { record(song, context) { records.push({ song: clone(song), context: clone(context) }); return { id: archiveId }; } };
  }, Build, f.job.base);
  for (const stage of ['population','geometry','art']) checkpoint(stage);
  assert.equal(records.length, 0, 'Non-music checkpoints must not compile archives.');
  const music = checkpoint('music');
  assert.equal(music.dungeon, null, 'Scratch first-room geometry must not leak into a checkpoint.');
  assert.equal(music.music.archive.id, archiveId);
  assert.notEqual(music.music, score); assert.deepEqual(score, pristine);
  assert.doesNotThrow(() => Build.validateArtifact(music, f.job, false));
  f.saved.roomDungeonDatabase[KEY] = stageArtifact({ ...f.job, stage: 'geometry' }, f.snapshot()).dungeon;
  changeRoom(f, room => { room.illustration = acceptedIllustration(f.state); });
  const complete = checkpoint('complete');
  assert.equal(complete.music.archive.id, archiveId);
  assert.doesNotThrow(() => Build.validateArtifact(complete, f.job));
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.deepEqual(record.song, pristine);
    assert.deepEqual(record.context, { roomKey: KEY, runId: f.job.runId });
  }
  assert.equal(checkpoints.at(-1), complete); assert.deepEqual(score, pristine);
  assert.equal(f.writes.length, 0, 'Checkpoint publication must not import or rewrite player state.');
});

for (const order of ORDERS) test('actual adapter accumulates incremental checkpoints: ' + order.join(' -> '), async t => {
  const f = fixture({ populated: false }), runner = stageRunner(), original = f.snapshot(), pristine = clone(original);
  const worker = Adapter.spawnBuild(f.job, original, { runStage: runner.runStage }), seen = observe(worker);
  t.after(() => worker.terminate());
  await eventually(() => runner.calls.length === 1); await turn();
  assert.deepEqual(runner.calls.map(call => call.job.stage), ['population']);
  assert.equal(seen.checkpoints().length, 0);
  runner.release('population'); await eventually(() => runner.calls.length === 4);
  assert.deepEqual(runner.calls.slice(1).map(call => call.job.stage).sort(), [...BRANCHES].sort());
  assert.equal(runner.active(), 3); assert.equal(runner.maximum(), 3);
  assert.ok(runner.calls.slice(1).every(call => JSON.parse(call.source.roomNameDatabaseString)[KEY].populationComplete));
  const committed = new Set(), frozen = JSON.stringify(seen.checkpoints()[0]);
  for (const name of order) {
    runner.release(name); committed.add(name);
    await eventually(() => seen.checkpoints().some(artifact => artifact.stage === name));
    const artifact = seen.checkpoints().find(value => value.stage === name), room = artifact.rooms[KEY];
    assert.deepEqual(artifact.completedStages, ['population', ...order.slice(0, committed.size)]);
    if (committed.has('geometry')) assert.equal(artifact.dungeon._geometryStamp, 'offline-geometry');
    else assert.equal(artifact.dungeon, null);
    if (committed.has('music')) { assert.equal(artifact.music.title, 'Offline Hall'); assert.equal(room.musicCue, 'quiet-hall'); }
    else assert.equal(artifact.music, null);
    if (committed.has('art')) assert.ok(room.illustration.plan);
    assert.doesNotThrow(() => Build.validateArtifact(artifact, f.job, false));
  }
  assert.equal((await bounded(seen.terminal)).value.type, 'done');
  assert.deepEqual(seen.checkpoints().map(artifact => artifact.stage), ['population', ...order, 'complete']);
  const final = seen.checkpoints().at(-1);
  Build.validateArtifact(final, f.job);
  assert.ok(final.rooms[KEY].sceneSpec); assert.ok(final.rooms[KEY].illustration.plan); assert.ok(final.music.archive.id);
  assert.equal(JSON.stringify(seen.checkpoints()[0]), frozen, 'Later branches must not mutate already emitted checkpoints.');
  assert.deepEqual(original, pristine, 'Branch orchestration must not mutate the caller snapshot.');
  assert.equal(f.writes.length, 0, 'The adapter itself does not import authoritative state.');
});

test('actual adapter cancels in-flight branches and emits one failure without complete or done', async t => {
  const f = fixture(), runner = stageRunner(), worker = Adapter.spawnBuild(f.job, f.snapshot(), { runStage: runner.runStage });
  const seen = observe(worker); t.after(() => worker.terminate());
  await eventually(() => runner.calls.length === 1); runner.release('population');
  await eventually(() => runner.calls.length === 4); await worker.terminate();
  assert.equal((await bounded(seen.terminal)).value.type, 'failed'); await turn();
  assert.ok(runner.calls.every(call => call.options.signal.aborted)); assert.equal(runner.active(), 0);
  assert.deepEqual(seen.messages.map(message => message.type), ['checkpoint','failed']);
});

test('cancellation at the population checkpoint must not invoke downstream stage runners', async t => {
  const f = fixture(), runner = stageRunner(), worker = Adapter.spawnBuild(f.job, f.snapshot(), { runStage: runner.runStage });
  const seen = observe(worker); t.after(() => worker.terminate());
  worker.on('message', message => { if (message.artifact?.stage === 'population') worker.terminate(); });
  await eventually(() => runner.calls.length === 1); runner.release('population');
  await bounded(seen.terminal); await turn();
  assert.deepEqual(runner.calls.map(call => call.job.stage), ['population'], 'Abort must be checked before launching the branch fan-out.');
});

test('a failed adapter branch aborts its siblings and never publishes a complete artifact', async t => {
  const f = fixture(), runner = stageRunner(), worker = Adapter.spawnBuild(f.job, f.snapshot(), { runStage: runner.runStage, skipPopulation: true });
  const seen = observe(worker); t.after(() => worker.terminate());
  await eventually(() => runner.calls.length === 3); runner.calls.find(call => call.job.stage === 'music').fail('Controlled music failure.');
  assert.equal((await bounded(seen.terminal)).value.type, 'failed'); await turn();
  assert.equal(runner.active(), 0); assert.ok(runner.calls.every(call => call.options.signal.aborted));
  assert.equal(seen.checkpoints().length, 0);
});

test('first-room pipeline skips population, starts all three branches, and resolves only committed barriers', async t => {
  const f = pipelineHarness(t), before = playerState(f.saved), entry = f.begin();
  assert.equal(f.begin(), entry, 'Concurrent first-room consumers must share one session.');
  await eventually(() => f.runner.calls.length === 3);
  assert.deepEqual(f.runner.calls.map(call => call.job.stage).sort(), [...BRANCHES].sort());
  assert.deepEqual(f.spawns[0].options, { background: false, skipPopulation: true });
  assert.doesNotThrow(() => Save.validate(f.spawns[0].snapshot));
  const resolved = new Set();
  for (const name of [...BRANCHES, 'complete']) entry.barriers[name].promise.then(() => resolved.add(name), () => {});
  f.runner.release('music'); await eventually(() => resolved.has('music'));
  assert.equal(f.saved.roomDungeonDatabase[KEY], undefined); assert.equal(resolved.has('geometry'), false);
  assert.equal(await f.pipeline.wait(f.state, KEY, 'music'), true);
  f.runner.release('art'); await eventually(() => resolved.has('art'));
  assert.equal(f.saved.roomDungeonDatabase[KEY], undefined); assert.equal(resolved.has('complete'), false);
  f.runner.release('geometry'); assert.equal((await bounded(f.pipeline.wait(f.state, KEY, 'complete'))).status, 'resolved');
  assert.ok(f.db()[KEY].illustration.plan); assert.ok(f.saved.roomMusicDatabase[KEY]); assert.ok(f.saved.roomDungeonDatabase[KEY]);
  assert.equal(f.db()[KEY].preparedBuild.ready, true); assert.deepEqual(playerState(f.saved), before);
});

for (const order of [['music','art'], ['art','music']]) test('first-room entry and door edits survive later ' + order.join(' -> ') + ' -> complete commits', async t => {
  const f = pipelineHarness(t), entry = f.begin(), checkpoints = [];
  await eventually(() => f.runner.calls.length === 3);
  entry.worker.on('message', message => {
    if (message.type !== 'checkpoint') return;
    const stage = message.artifact.stage, before = clone(f.saved.roomDungeonDatabase[KEY]);
    if (stage !== 'complete') {
      // Simulate live entry/door updates after the pipeline's geometry or partial commit handler.
      const dungeon = clone(before);
      dungeon.start = { x: 8, y: stage === 'geometry' ? 9 : 10 };
      dungeon.cells['8,8'] = { ...dungeon.cells['8,8'], tile: 'door', door: { isOpen: stage !== 'music' } };
      dungeon._geometryStamp = 'live-after-' + stage;
      f.state.setRoomDungeon(entry.job.coords, dungeon);
      f.saved.liveWorldState.player = { x: 8.5, y: dungeon.start.y + 0.5 };
      const roster = JSON.parse(f.saved.combatCharactersString);
      Object.assign(roster[0], { mazeX: 8, mazeY: dungeon.start.y, mazeRoomKey: KEY });
      f.saved.combatCharactersString = JSON.stringify(roster);
    }
    checkpoints.push({ stage, before, after: clone(f.saved.roomDungeonDatabase[KEY]), player: playerState(f.saved) });
  });
  f.runner.release('geometry');
  await eventually(() => checkpoints.some(checkpoint => checkpoint.stage === 'geometry'));
  assert.equal(await f.pipeline.wait(f.state, KEY, 'geometry'), true);
  for (const stage of order) {
    f.runner.release(stage); await eventually(() => checkpoints.some(checkpoint => checkpoint.stage === stage));
  }
  const outcome = await bounded(f.pipeline.wait(f.state, KEY, 'complete'));
  assert.equal(outcome.status, 'resolved', outcome.error?.message);
  assert.deepEqual(checkpoints.map(checkpoint => checkpoint.stage), ['geometry', ...order, 'complete']);
  for (let index = 1; index < checkpoints.length; index++) {
    assert.deepEqual(checkpoints[index].before, checkpoints[index - 1].after,
      checkpoints[index].stage + ' must keep the latest accepted entry/door geometry, not the original branch dungeon.');
    if (checkpoints[index].stage === 'complete') assert.deepEqual(checkpoints[index].player, checkpoints[index - 1].player);
  }
  assert.deepEqual(f.saved.roomDungeonDatabase[KEY], checkpoints.at(-2).after);
  assert.equal(f.db()[KEY].preparedBuild.ready, true);
  assert.ok(f.saved.roomMusicDatabase[KEY]); assert.ok(f.db()[KEY].illustration.plan);
});

test('pipeline ignores player/party/quest state forged in stage artifacts', async t => {
  const f = pipelineHarness(t), before = playerState(f.saved);
  const forged = stageRunner({ mutate: artifact => Object.assign(artifact, { updatedGameConsole: 'Inventory: Forged treasure',
    combatCharactersString: '[{"name":"Forged PC","hp":999}]', currentQuest: 'Forged quest', lastCoords: { x: 99, y: 99, z: 0 },
    personalNarrative: 'Forged turn', inventory: ['unearned treasure'], currentPC: { HP: 999 } }) });
  f.website.spawnBuild = (job, snapshot, options) => {
    const worker = Adapter.spawnBuild(job, snapshot, { ...options, runStage: forged.runStage });
    f.spawns.push({ job, snapshot: clone(snapshot), options, worker }); return worker;
  };
  f.begin(); await eventually(() => forged.calls.length === 3);
  for (const stage of ['art','music','geometry']) forged.release(stage);
  assert.equal((await bounded(f.pipeline.wait(f.state, KEY, 'complete'))).status, 'resolved');
  assert.deepEqual(playerState(f.saved), before);
});

test('cancelling the actual first-room adapter rejects every pipeline barrier without importing state', async t => {
  const f = pipelineHarness(t), entry = f.begin(); await eventually(() => f.runner.calls.length === 3);
  const before = clone(f.saved), outcomes = Object.values(entry.barriers).map(barrier => bounded(barrier.promise));
  await entry.worker.terminate();
  for (const result of await Promise.all(outcomes)) {
    assert.equal(result.status, 'rejected'); assert.match(result.error.message, /cancel/i);
  }
  assert.deepEqual(f.saved, before); assert.equal(f.writes.length, 0);
  assert.ok(f.runner.calls.every(call => call.options.signal.aborted));
});

test('quest changes reject pending current-room barriers and never commit stale branch artifacts', async t => {
  const f = pipelineHarness(t), entry = f.begin(); await eventually(() => f.runner.calls.length === 3);
  const before = f.state.getRoomNameDatabase(); f.saved.currentQuest = 'A new current quest';
  const outcomes = Object.values(entry.barriers).map(barrier => bounded(barrier.promise));
  f.runner.release('music');
  for (const result of await Promise.all(outcomes)) {
    assert.equal(result.status, 'rejected'); assert.match(result.error.message, /quest changed|context changed/i);
  }
  assert.equal(f.state.getRoomNameDatabase(), before); assert.equal(f.writes.length, 0);
  assert.ok(f.runner.calls.every(call => call.options.signal.aborted));
});

test('pipeline must not dispatch a stale first-room job after connection setup waits across a quest change', async t => {
  const connect = deferred(), f = pipelineHarness(t, { connect }), entry = f.begin();
  f.saved.currentQuest = 'Changed while connecting'; connect.resolve();
  const outcome = await bounded(entry.barriers.complete.promise);
  assert.equal(f.spawns.length, 0, 'Revalidate the captured job context after ensureConnected and before spawnBuild.');
  assert.equal(outcome.status, 'rejected');
});

test('pipeline failure must fence already queued late checkpoint events', async t => {
  const f = pipelineHarness(t, { manual: true }), entry = f.begin(); await eventually(() => f.spawns.length === 1);
  const call = f.spawns[0], before = f.state.getRoomNameDatabase();
  call.worker.emit('message', { type: 'failed', reason: 'Controlled transport failure.' });
  assert.equal((await bounded(entry.barriers.complete.promise)).status, 'rejected');
  call.worker.emit('message', { type: 'checkpoint', artifact: stageArtifact({ ...call.job, stage: 'geometry' }, call.snapshot) });
  assert.equal(f.state.getRoomNameDatabase(), before, 'A failed session must not accept a late valid checkpoint.');
  assert.equal(f.writes.length, 0);
});

test('a failed first-room session must permit a fresh explicit begin attempt', async t => {
  const f = pipelineHarness(t, { manual: true }), first = f.begin(); await eventually(() => f.spawns.length === 1);
  f.spawns[0].worker.emit('message', { type: 'failed', reason: 'Controlled transient failure.' });
  assert.equal((await bounded(first.barriers.complete.promise)).status, 'rejected');
  const retry = f.begin();
  assert.notEqual(retry.job.id, first.job.id, 'Do not cache a rejected session as a reusable in-flight build.');
  await eventually(() => f.spawns.length === 2);
});

for (const change of ['id','revision']) test('current-room session must invalidate on selected model ' + change + ' change', async t => {
  const f = pipelineHarness(t, { manual: true }), first = f.begin(); await eventually(() => f.spawns.length === 1);
  if (change === 'id') f.models.id = 'different-selected-model'; else f.models.revision++;
  const next = f.begin();
  assert.notEqual(next.job.id, first.job.id, 'Existing-session reuse must compare the current selected model and revision.');
  await eventually(() => f.spawns.length === 2);
});

test('a completed cached room survives quest/model context changes without spawning new construction', async t => {
  for (const change of ['quest','model-id','model-revision']) {
    const f = pipelineHarness(t, { manual: true }); await completeCachedRoom(f);
    if (change === 'quest') f.saved.currentQuest = 'A later unrelated quest';
    if (change === 'model-id') f.models.id = 'new-selected-model';
    if (change === 'model-revision') f.models.revision++;
    const before = clone(f.saved), writes = f.writes.length;
    assert.equal(f.begin(), null, change + ': valid saved geometry/music/art must not be re-authored.');
    await turn();
    assert.equal(f.spawns.length, 1, change + ': no second spawn is permitted.');
    assert.equal(f.spawns[0].worker.terminated, 1, 'Discard the old context session rather than retaining its barriers.');
    assert.equal(await f.pipeline.wait(f.state, KEY, 'complete'), false, 'Cached entry must not wait on the old-context session.');
    assert.equal(f.writes.length, writes); assert.deepEqual(f.saved, before);
  }
});

test('missing or stale geometry/music/art still starts construction despite a prior completed receipt', async t => {
  const cases = [
    ['missing geometry', f => { delete f.saved.roomDungeonDatabase[KEY]; }],
    ['missing geometry layout', f => { delete f.saved.roomDungeonDatabase[KEY].layout; }],
    ['missing geometry cells', f => { delete f.saved.roomDungeonDatabase[KEY].cells; }],
    ['stale geometry name', f => { f.saved.roomDungeonDatabase[KEY].sceneSpec.source.roomName = 'An earlier room'; }],
    ['stale geometry description', f => { f.saved.roomDungeonDatabase[KEY].sceneSpec.source.description = 'An earlier description of the room.'; }],
    ['missing music', f => { delete f.saved.roomMusicDatabase[KEY]; }],
    ['music without an archive identity', f => { delete f.saved.roomMusicDatabase[KEY].archive.id; }],
    ['missing art', f => changeRoom(f, room => { delete room.illustration; })],
    ['invalid art plan', f => changeRoom(f, room => { room.illustration.plan.layers = []; })],
    ['stale art fingerprint', f => changeRoom(f, room => { room.illustration.source = '0'.repeat(64); })],
    ['changed art context', f => changeRoom(f, room => { room.classification = { indoor: true, biome: 'cavern' }; })]
  ];
  for (const [name, damage] of cases) {
    const f = pipelineHarness(t, { manual: true }), completed = await completeCachedRoom(f);
    damage(f); f.saved.currentQuest = 'A new quest after the completed visit';
    const next = f.begin();
    assert.ok(next, name + ': an incomplete cache must not bypass construction.');
    assert.notEqual(next.job.id, completed.job.id, name + ': use a fresh current-context job.');
    await eventually(() => f.spawns.length === 2);
    assert.equal(f.spawns[1].job.id, next.job.id);
    assert.deepEqual(f.spawns[1].options, { background: false, skipPopulation: true });
  }
});

test('an unconfigured or unpopulated room never launches the current-room pipeline', async t => {
  const f = pipelineHarness(t); f.config.remoteBuild = false;
  assert.equal(f.begin(), null); f.config.remoteBuild = true;
  const db = f.db(); db[KEY].populationComplete = false; f.saved.roomNameDatabaseString = JSON.stringify(db);
  assert.equal(f.begin(), null); assert.equal(f.spawns.length, 0);
  assert.equal(await f.pipeline.wait(f.state, KEY, 'geometry'), false);
});
