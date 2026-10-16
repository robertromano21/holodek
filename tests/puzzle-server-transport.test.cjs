'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const PhysicalPuzzles = require('../assets/physicalPuzzles');
const source = fs.readFileSync('server.js', 'utf8');
const start = source.indexOf("app.post('/processInput7', async");
const route = source.slice(start, source.indexOf('// New endpoint: Client calls this after the user clicks', start));
const quiet = { log() {}, info() {}, warn() {}, error() {} };
function fixture({ held = false, actionOnly = false, newlySolved = false } = {}) {
  let handler, resolve, calls = 0, traits = 0;
  const tasks = new Map(), definition = PhysicalPuzzles.fallback('test', 'Archive');
  const state = { getGamePaused: () => false, isCharacterGenerationInProgress: () => false,
    getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getRoomDungeon: () => ({ physicalPuzzle: { definition } }),
    getCombatMode: () => 'Combat Map-Based', getUpdatedGameConsole: () => 'Coordinates: X: 0, Y: 0, Z: 0',
    getCombatCharactersString: () => '[]', getRoomNameDatabase: () => '{}', getCurrentQuest: () => 'None' };
  const result = { content: 'A result.', actionOnly };
  const pending = held ? new Promise(done => resolve = () => done(result)) : Promise.resolve(result);
  const context = { sharedState: state, PhysicalPuzzles, tasks, inputTaskInFlight: false, console: quiet,
    Economy: { refresh() {} },
    GameLogContent: require('../assets/gameLogContent'), SidVoice: { prefetch: rows => rows },
    app: { post: (_path, callback) => handler = callback }, broadcast() {}, actionDice: { end() {} },
    CampaignMemory: { rememberRoomHistory() {} }, characterTraits: { ensureTraitSpecsForConsole() { traits++; } },
    retortWithUserInput: async (_input, _broadcast, _mode, options) => {
      calls++; options?.onPhysicalPuzzlePrepared?.({ completed: newlySolved }); return pending;
    } };
  vm.createContext(context); vm.runInContext(route, context);
  const response = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { context, definition, response, tasks, calls: () => calls, traits: () => traits,
    resolve: () => resolve(), request: input => handler({ body: { userInput: input } }, response) };
}

test('physical controls reuse the existing inline result format and do not generate character traits', async () => {
  const f = fixture({ actionOnly: true }); await f.request('read instruction plaque');
  assert.equal(f.response.code, 200); assert.equal(f.response.body.completedStartResult.response, 'A result.');
  assert.equal(f.response.body.completedStartResult.combatRoundOnly, true);
  assert.equal(f.calls(), 1); assert.equal(f.traits(), 0); assert.equal(f.context.inputTaskInFlight, false);
});

test('room generation immediately returns a task ID and continues background processing and polling', async () => {
  const f = fixture({ held: true }); await f.request('go west');
  assert.equal(f.response.code, 202); assert.ok(f.response.body.taskId);
  assert.equal(f.response.body.completedStartResult, undefined);
  assert.equal(f.tasks.get(f.response.body.taskId).status, 'processing'); assert.equal(f.context.inputTaskInFlight, true);
  f.resolve(); await new Promise(done => setImmediate(done));
  assert.equal(f.tasks.get(f.response.body.taskId).status, 'complete'); assert.equal(f.traits(), 1);
  assert.equal(f.context.inputTaskInFlight, false);
});

test('duplicate commands are refused while a direct puzzle result is resolving', async () => {
  const f = fixture({ held: true, actionOnly: true });
  const first = f.request('read instruction plaque');
  await f.request('go west'); assert.equal(f.response.code, 409); assert.equal(f.calls(), 1);
  f.resolve(); await first; assert.ok(f.response.body.completedStartResult);
});

test('a newly solved puzzle keeps narration in the background while its committed notice is available immediately', async () => {
  const f = fixture({ held: true, newlySolved: true });
  await f.request('read instruction plaque');
  assert.equal(f.response.code, 202); assert.ok(f.response.body.taskId);
  assert.equal(f.tasks.get(f.response.body.taskId).status, 'processing');
  f.resolve(); await new Promise(done => setImmediate(done));
  assert.equal(f.tasks.get(f.response.body.taskId).status, 'complete');
});
