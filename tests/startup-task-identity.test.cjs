'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Startup = require('../retort/startupTasks'), Client = require('../assets/characterStartup');
const payload = () => ({ character: { Name: 'Mortacia', HP: 120 }, npcs: [{ Name: 'Friend' }] });
test('repeated Save joins one PC-owned task and ignores transient client console changes', () => {
  const tasks = new Map(), registry = Startup.create({ tasks });
  const first = registry.begin(payload()); registry.bind(first.taskId, 'run-a');
  const second = registry.find({ ...payload(), initialState: { updatedGameConsole: 'different client snapshot' } }, 'run-a');
  assert.equal(first.taskId, second.taskId); assert.equal(tasks.size, 1);
  assert.throws(() => registry.find({ character: { Name: 'Other' } }, 'run-a'), /different character/);
  assert.throws(() => registry.find(payload(), 'run-b'), /earlier game/);
  assert.throws(() => registry.clear(), /still being built/);
});
test('terminal completed startup receipts remain idempotent until explicitly cleared', () => {
  const tasks = new Map(), registry = Startup.create({ tasks }), first = registry.begin(payload());
  tasks.set(first.taskId, { ...tasks.get(first.taskId), status: 'complete', phase: 'first-room', result: 'Saved'  });
  assert.equal(registry.find(payload(), 'run-a').taskId, first.taskId);
  assert.throws(() => registry.begin(payload()), /already exists/);
  registry.clear(); assert.equal(tasks.size, 0);
  assert.notEqual(registry.begin(payload()).taskId, first.taskId);
});
test('progress is scoped to its startup task and cannot update a later run', async () => {
  const tasks = new Map(), registry = Startup.create({ tasks }), first = registry.begin(payload());
  await registry.track(first.taskId, async () => { await Promise.resolve(); Startup.report({ component: 'music', path: '$.motifContour[2]' }); });
  assert.equal(tasks.get(first.taskId).progress.component, 'music');
  tasks.get(first.taskId).status = 'complete'; registry.clear(); const next = registry.begin(payload());
  await registry.track(first.taskId, async () => Startup.report({ component: 'stale' }));
  assert.equal(tasks.get(next.taskId).progress, undefined);
});
test('passing the browser wait notice keeps polling the same server task', async () => {
  let time = 0, polls = 0, notices = 0, posts = 0;
  const result = await Client.start(payload(), { timeout: 10, now: () => time,
    pause: async () => { time += 20; }, onWait: () => { notices++; }, request: async url => {
      if (url === '/startGameWithCharacter') posts++;
      const data = url === '/startGameWithCharacter' ? { taskId: 'same-task' } : ++polls <= 3 ?
        { status: 'processing', phase: 'music' } : { status: 'complete', result: { updatedGameConsole: 'Saved Hall' } };
      return { ok: true, json: async () => data };
    } });
  assert.equal(result.updatedGameConsole, 'Saved Hall'); assert.equal(posts, 1); assert.equal(polls, 4); assert.ok(notices > 0);
});
test('a pre-cancelled browser wait never submits a startup', async () => {
  const signal = new AbortController(); signal.abort(); let posts = 0;
  await assert.rejects(Client.start(payload(), { signal: signal.signal, request: async () => { posts++; return { ok: true, json: async () => ({ taskId: 'active' }) }; } }),
    error => error.code === 'STARTUP_WAIT_STOPPED');
  assert.equal(posts, 0);
});

test('changed server model or world cannot join an unrelated startup identity', () => {
  let scope = { model: 'holodek-1', world: 'Tartarus' };
  const registry = Startup.create({ tasks: new Map(), scope: () => scope }); registry.begin(payload());
  scope = { model: 'gpt-6-luna', world: 'Tartarus' };
  assert.throws(() => registry.find(payload(), 'run-a'), /model or world/);
});

test('actual Save endpoint joins active task and permits one new attempt after failure', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const tasks = new Map(), routes = new Map(), registry = Startup.create({ tasks });
  let starts = 0, economyStarts = 0, release;
  const state = { getDungeonRunId: () => 'run-a', getCombatMode: () => 'Map', beginDungeonRun: () => { starts++; return 'run-a'; },
    setCurrentPC() {}, setCharacterGenerationInProgress() {}, setPendingCharacterForReview() {}, setCombatCharactersString() {},
    setRoomNameDatabase() {}, setPersonalNarrative() {}, setUpdatedGameConsole() {} };
  const context = { app: { post: (url, handler) => routes.set(url, handler) }, startupTasks: registry, sharedState: state, tasks,
    inputTaskInFlight: false, console: { log() {}, error() {} }, broadcast() {}, actionDice: { setPaused() {}, end() {} },
    roomDatabaseReceiver: { reset() {} }, buildInitialWorldConsole: () => ({ console: '', roomNameDatabaseString: '{}' }),
    buildInitialGameConsole: () => '', Economy: { start() { economyStarts++; } },
    retortWithUserInput: async () => { await new Promise(resolve => { release = resolve; }); throw Error('music failed'); } };
  vm.runInNewContext(source.slice(source.indexOf("app.post('/startGameWithCharacter'"), source.indexOf('// Dedicated endpoint to begin')), context);
  async function save() {
    let value;
    await routes.get('/startGameWithCharacter')({ body: payload() }, { status(n) { assert.equal(n, 202); return this; }, json(data) { value = data; } });
    return value;
  }
  const first = await save(), second = await save();
  assert.equal(first.taskId, second.taskId); assert.equal(second.joined, true);
  assert.equal(starts, 1); assert.equal(economyStarts, 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(tasks.get(first.taskId).status, 'error'); assert.equal(tasks.get(first.taskId).phase, 'first-room');
  const retry = await save(); assert.notEqual(retry.taskId, first.taskId); assert.equal(starts, 2); assert.equal(economyStarts, 2);
  release(); await new Promise(resolve => setImmediate(resolve));
});
