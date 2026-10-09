'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const progress = require('../retort/questProgress');
const bossGate = require('../retort/bossGate');
const { parseSheets } = require('../assets/partyRoster');

const filename = path.join(__dirname, '..', 'retort', 'retortWithUserInput.js');
const source = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
const clone = value => JSON.parse(JSON.stringify(value));
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const BOSS = 'The Ash Regent (A)';
const BOSS_KEY = '9,-4,2';
const PENDING = { updatedStatus: 'Pending', narrative: '', progressNote: '', reward: '' };
const COMPLETED = { updatedStatus: 'Completed', narrative: 'The action succeeded.', progressNote: '', reward: 'XP gained: 999' };
const sheet = (name, hp) => `${name}\nFemale\nWraith\nMage\nLevel: 2\nAC: 12\nXP: 0\nHP: ${hp}\nMaxHP: 40\nEquipped: None\nAttack: 1\nDamage: 2\nArmor: 0\nMagic: 3`;

function extract(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Cannot extract ${start}`);
  return source.slice(first, last);
}
function compile(body, dependencies, name) {
  // Use the host realm so the real JSON validator sees ordinary production objects.
  return vm.compileFunction(`${body}\nreturn ${name};`, Object.keys(dependencies), { filename })(...Object.values(dependencies));
}
const roomHelpers = extract('function coordinatesToString(coordinates)', '// Updated generateDefaultClassification') +
  extract('function canonicalKey(k)', '// ---- NEW: de-dupe') +
  extract('function ensureRoom(db, key, defaults = {})', '// Read a single-line value');
const actualRoomHelpers = compile(`${roomHelpers}\nconst helpers = { canonicalizeRoomDb, ensureRoom };`, {}, 'helpers');
const seedSource = extract('async function seedAndManageQuest(', 'async function generateQuest(');
const resolveSource = extract('async function resolveActionWithSimulation(', 'async function adjudicateActionWithPythonSimulation(');
const additionalSource = extract('async function generateAdditionalOutcomes(', '// LLM-only gate');

function consoleText({ roomKey = '0,0,0', inventory = 'None', monsters = 'None', ...fields } = {}) {
  const [x, y, z] = roomKey.split(',');
  return Object.entries({ 'Room Name': 'Entry', 'Room Description': 'Existing actors and quest only.',
    Coordinates: `X: ${x}, Y: ${y}, Z: ${z}`, 'Next Boss': BOSS, 'Next Boss Room': 'Oath Sanctuary',
    'Boss Room Coordinates': 'X: 9, Y: -4, Z: 2', 'Next Artifact': 'Sepulchra', 'Current Quest': 'Recover Sepulchra',
    Inventory: inventory, 'Inventory Properties': 'None', Score: '17', Turns: '8',
    PC: `\n${sheet('Hero', 20)}`, 'NPCs in Party': `\n${sheet('Ally', 10)}`, 'Monsters in Room': `\n${monsters}`,
    'Monsters Equipped Properties': 'None', 'Monsters State': 'Neutral', 'Objects in Room': 'None',
    'Objects in Room Properties': 'None', 'Rooms Visited': '3', ...fields }).map(([k, v]) => `${k}: ${v}`).join('\n');
}
function database() {
  return { '0,0,0': { name: 'Entry', objects: [], exits: {
    east: { status: 'open', targetCoordinates: BOSS_KEY }, north: { status: 'open', targetCoordinates: '0,1,0' }
  } }, '0,1,0': { name: 'Key Hall', objects: [], exits: { south: { status: 'open', targetCoordinates: '0,0,0' } } },
  [BOSS_KEY]: { name: 'Oath Sanctuary', exits: {}, objects: [{ name: 'Sepulchra', type: 'artifact' }],
    monsters: { inRoom: BOSS, equippedProperties: 'None', state: 'Hostile', consoleBlock: `Monsters in Room:\n${sheet(BOSS, 40)}` } } };
}
function fetchTask(overrides = {}) {
  return { type: 'Fetch', actionKind: 'other', desc: 'Retrieve Iron Sigil.', metrics: 'Iron Sigil in Inventory here', status: 'Pending',
    requiredElements: [{ type: 'object', name: 'Iron Sigil', placement: '0,0,0', targetID: 'sigil-1' }],
    hardRequirements: [{ check: 'at_coords', value: '0,0,0' }, { check: 'inventory_contains', value: 'Iron Sigil' }],
    actionRequirements: [], ...overrides };
}
function puzzleTask(overrides = {}) {
  return { type: 'Puzzle', actionKind: 'solve_puzzle', desc: 'Read the oath.', metrics: 'Speak the old oath', status: 'Pending',
    requiredElements: [], hardRequirements: [], actionRequirements: [], targetID: 'puzzle-one', ...overrides };
}

function harness({ tasks = [fetchTask()], index = 0, seeded = true, db = database(), text = consoleText(),
  quest = 'Recover Sepulchra', onGenerateQuest } = {}) {
  const state = { tasks: clone(tasks), index, seeded, database: JSON.stringify(db), text, quest, lastAdjudication: null,
    updates: [], logs: [], setters: [], generatedQuests: [], prompts: [], requests: [], synchronizers: [],
    seedAttempts: [], xp: 200, score: 17 };
  const queue = [];
  const tagged = (parts, ...values) => { state.prompts.push(parts.reduce((s, part, i) => s + part + (values[i] ?? ''), '')); };
  const assistant = Object.assign(tagged, { generation: async request => {
    state.requests.push(request);
    assert.ok(queue.length, `Unexpected model call: ${state.prompts.at(-1)}`);
    if (request.parameters.updatedStatus) assert.ok(Object.hasOwn(queue[0], 'updatedStatus'),
      'Unexpected second task evaluation: this turn should only seed the next step');
    return { content: JSON.stringify(queue.shift()) };
  } });
  const agent = { user: tagged, assistant };
  const sharedState = {
    getCurrentQuest: () => state.quest, getCurrentTasks: () => state.tasks, getCurrentTaskIndex: () => state.index,
    getQuestSeeded: () => state.seeded, getRoomNameDatabase: () => state.database, getUpdatedGameConsole: () => state.text,
    getLastAdjudication: () => state.lastAdjudication,
    setLastAdjudication: value => { state.lastAdjudication = value; },
    setCurrentTasks: value => { state.tasks = value; state.setters.push(['tasks', value.length]); },
    setCurrentTaskIndex: value => { state.index = value; state.setters.push(['index', value]); },
    setQuestSeeded: value => { state.seeded = value; state.setters.push(['seeded', value]); },
    setRoomNameDatabase: value => { state.database = value; }, setUpdatedGameConsole: value => { state.text = value; },
    setLastQuestUpdate: value => { state.updates.push(value); }, appendQuestLog: value => { state.logs.push(clone(value)); }
  };
  const sync = name => async (_agent, _coords, _db, text) => { state.synchronizers.push(name); return text; };
  const dependencies = { console: quiet, sharedState, ...progress, ...bossGate, ...actualRoomHelpers,
    seedBossKey: (db, gate, placement, options) => {
      state.seedAttempts.push(placement);
      return bossGate.seedBossKey(db, gate, placement, options);
    },
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    pruneAndDedupeRoomObjectsOnEntry: sync('prune'), syncObjectsOnRoomEntry: sync('objects'),
    syncKeysOnRoomEntry: sync('keys'), syncMonstersOnRoomEntry: sync('monsters'),
    generateRoomObjects: async () => [{ name: 'Iron Sigil', type: 'object', properties: { magic: 1 } }],
    generateObjectModifiers: async () => ({ magic: 1 }),
    generateQuest: async () => {
      state.generatedQuests.push({ index: state.index, text: state.text });
      if (onGenerateQuest) onGenerateQuest(state);
    } };
  const seed = compile(seedSource, dependencies, 'seedAndManageQuest');
  return { state, sharedState, agent, dependencies,
    db: () => JSON.parse(state.database),
    turn: async ({ text, input = 'wait', responses = [PENDING] } = {}) => {
      assert.equal(queue.length, 0, 'Previous turn left unused model responses');
      if (text !== undefined) state.text = text;
      queue.push(...clone(responses));
      const result = await seed(agent, state.text, input);
      assert.equal(queue.length, 0, 'Turn did not consume its scripted model responses');
      return result;
    },
    adjudicate: async (outcomes, input = 'speak the oath', task = state.tasks[state.index]) => {
      const resolve = compile(resolveSource, { console: quiet, sharedState, taskBinding: progress.taskBinding,
        generateOutcomes: async () => ({ Action: 'PuzzleSolving' }), generateAdditionalOutcomes: async () => outcomes,
        processGameUpdate: (_outcomes, text) => text, generateNarrative: () => 'The action was resolved.' }, 'resolveActionWithSimulation');
      return resolve({}, input, state.text, task, 1, 0);
    },
    plan: async (responses, task = state.tasks[state.index]) => {
      queue.push(...clone(responses));
      const plan = compile(additionalSource, { ...dependencies, parseSheets }, 'generateAdditionalOutcomes');
      const result = await plan(agent, { Action: 'PuzzleSolving' }, state.text, 'speak the oath', task);
      assert.equal(queue.length, 0, 'Additional-outcome planner left unused responses');
      return result;
    } };
}

test('real quest manager stores partial progress, blocks model completion/reward, and advances only after action completion', async () => {
  const h = harness();
  const first = await h.turn({ responses: [COMPLETED] });
  assert.equal(first.questJustSeeded, false);
  assert.equal(first.activeTask, h.state.tasks[0]);
  assert.equal(h.state.index, 0);
  assert.equal(h.state.seeded, true);
  assert.equal(h.state.tasks[0].status, 'In Progress');
  assert.deepEqual([first.activeTask.progress.satisfied, first.activeTask.progress.total, first.activeTask.progress.eligible], [1, 2, false]);
  assert.doesNotMatch(first.questUpdate, /XP gained/);
  assert.match(h.state.text, /^Quest Progress: Step 1\/3: In Progress; 1\/2/m);
  const eligible = await h.turn({ text: consoleText({ inventory: 'Iron Sigil' }) });
  assert.equal(eligible.activeTask.progress.eligible, true);
  assert.equal(h.state.index, 0);
  assert.equal(h.state.tasks[0].status, 'Pending');
  const callsBeforeCompletion = h.state.requests.length;
  const done = await h.turn({ responses: [COMPLETED, { placement: '0,1,0' }] });
  assert.equal(h.state.tasks[0].status, 'Completed');
  assert.equal(h.state.index, 1);
  assert.equal(h.state.seeded, true);
  assert.equal(done.questJustSeeded, true);
  assert.equal(done.activeTask, h.state.tasks[1]);
  assert.equal(done.activeTask.status, 'Pending');
  assert.equal(done.activeTask.progress.total, 1);
  assert.equal(h.state.requests.slice(callsBeforeCompletion).filter(r => r.parameters.updatedStatus).length, 1);
  assert.match(h.state.text, /^Quest Progress: Step 2\/3: Pending; 0\/1/m);
  assert.match(done.questUpdate, /Task completed/);
  assert.doesNotMatch(done.questUpdate, /XP gained/);
  assert.equal(h.state.xp, 200);
  assert.equal(h.state.score, 17);
  assert.deepEqual(h.state.generatedQuests, []);
});

test('an already-seeded stage 0 never creates or fetches the special boss key early', async () => {
  const h = harness({ text: consoleText({ inventory: 'Iron Sigil' }) });
  const result = await h.turn();
  const gate = h.db()[BOSS_KEY].bossGate;
  assert.equal(h.state.index, 0);
  assert.equal(h.state.seeded, true);
  assert.equal(result.questJustSeeded, false);
  assert.equal(h.state.tasks[0].status, 'Pending');
  assert.equal(h.state.tasks[0].progress.eligible, true);
  assert.equal(gate.keySeeded, false);
  assert.equal(gate.keyPlacement, null);
  assert.equal(h.state.seedAttempts.length, 0);
  assert.equal(Object.values(h.db()).flatMap(r => r.objects).some(o => o.questGateId === gate.id), false);
  assert.equal(h.db()['0,0,0'].exits.east.status, 'locked');
  assert.equal(h.state.requests.length, 1);
});

test('real stage 1 seeds the exact final seal key and rejects wrong or missing ownership in every room', async () => {
  const prior = fetchTask({ status: 'Completed' });
  const h = harness({ tasks: [prior], index: 1, seeded: false });
  const seeded = await h.turn({ responses: [{ placement: '0,1,0' }, COMPLETED] });
  const keyTask = h.state.tasks[1], gate = h.db()[BOSS_KEY].bossGate;
  assert.equal(seeded.questJustSeeded, true);
  assert.equal(h.state.seeded, true);
  assert.equal(h.state.index, 1);
  assert.equal(keyTask.type, 'Fetch');
  assert.equal(keyTask.actionKind, 'take_item');
  assert.equal(keyTask.bossGateId, gate.id);
  assert.deepEqual(keyTask.hardRequirements, [{ check: 'inventory_contains', value: gate.keyName }]);
  assert.deepEqual(keyTask.requiredElements, [{ type: 'key', name: gate.keyName, placement: '0,1,0' }]);
  assert.equal(keyTask.status, 'In Progress');
  assert.equal(keyTask.progress.total, 1);
  assert.equal(gate.keySeeded, true);
  assert.equal(gate.keyPlacement, '0,1,0');
  assert.equal(h.db()['0,1,0'].objects.filter(o => o.questGateId === gate.id).length, 1);
  assert.equal(h.db()['0,0,0'].exits.east.status, 'locked');
  assert.doesNotMatch(seeded.questUpdate, /XP gained/);
  assert.deepEqual(h.state.tasks[0], prior);
  assert.ok(h.state.prompts.some(p => p.includes('Quest: Recover Sepulchra') && p.includes(`Previous completed step: ${prior.desc}`)));
  for (const roomKey of ['0,1,0', '0,0,0', BOSS_KEY]) {
    for (const inventory of ['None', 'Empty', 'old brass key', `${gate.keyName} fragment`]) {
      const result = await h.turn({ text: consoleText({ roomKey, inventory }), responses: [COMPLETED] });
      assert.equal(h.state.index, 1, `${roomKey}: ${inventory}`);
      assert.equal(h.state.seeded, true);
      assert.equal(keyTask.status, 'In Progress');
      assert.equal(keyTask.progress.satisfied, 0);
      assert.equal(keyTask.progress.total, 1);
      assert.equal(keyTask.progress.eligible, false);
      assert.deepEqual(keyTask.progress.earnedCheckpointIds, []);
      assert.doesNotMatch(result.questUpdate, /Be at|Task completed|XP gained/);
    }
  }
  const done = await h.turn({ text: consoleText({ roomKey: '0,0,0', inventory: gate.keyName }), responses: [PENDING] });
  assert.equal(h.state.index, 2);
  assert.equal(h.state.seeded, true);
  assert.equal(keyTask.status, 'Completed');
  assert.equal(done.activeTask, h.state.tasks[2]);
  assert.equal(done.activeTask.status, 'Pending');
  assert.equal(done.activeTask.progress.total, 3);
  assert.equal(done.questJustSeeded, true);
  assert.match(h.state.text, /^Quest Progress: Step 3\/3: Pending; 0\/3/m);
  assert.deepEqual(h.db()[BOSS_KEY].monsters, database()[BOSS_KEY].monsters);
  assert.equal(h.db()['0,1,0'].objects.filter(o => o.questGateId === gate.id).length, 1);
});

test('local seal-key pickup followed by travel advances at the next server command without returning to placement', async () => {
  const h = harness({ tasks: [fetchTask({ status: 'Completed' })], index: 1, seeded: false });
  await h.turn({ responses: [{ placement: '0,1,0' }, PENDING] });
  const gate = h.db()[BOSS_KEY].bossGate;
  const originalPlacement = clone(h.state.tasks[1].requiredElements);
  assert.equal(h.state.tasks[1].progress.total, 1);
  assert.deepEqual(h.state.tasks[1].progress.earnedCheckpointIds, []);
  const requestsBeforePickup = h.state.requests.length;

  // Local pickup/travel updates state but never runs the server quest manager.
  h.state.text = consoleText({ roomKey: '0,1,0', inventory: gate.keyName });
  const pickedUp = h.db();
  pickedUp['0,1,0'].objects = pickedUp['0,1,0'].objects.filter(o => o.questGateId !== gate.id);
  h.state.database = JSON.stringify(pickedUp);
  h.state.text = consoleText({ roomKey: '0,0,0', inventory: gate.keyName });
  h.state.tasks = clone(h.state.tasks);
  assert.equal(h.state.requests.length, requestsBeforePickup);
  assert.equal(h.state.index, 1);
  assert.equal(h.state.tasks[1].status, 'In Progress');
  assert.deepEqual(h.state.tasks[1].progress.earnedCheckpointIds, []);

  const keyTask = h.state.tasks[1];
  const result = await h.turn({ input: 'look around', responses: [PENDING] });
  assert.equal(h.state.index, 2);
  assert.equal(h.state.seeded, true);
  assert.equal(keyTask.status, 'Completed');
  assert.deepEqual([keyTask.progress.satisfied, keyTask.progress.total, keyTask.progress.eligible], [1, 1, true]);
  assert.deepEqual(keyTask.requiredElements, originalPlacement);
  assert.deepEqual(keyTask.hardRequirements, [{ check: 'inventory_contains', value: gate.keyName }]);
  assert.equal(result.questJustSeeded, true);
  assert.equal(result.activeTask, h.state.tasks[2]);
  assert.equal(result.activeTask.status, 'Pending');
  assert.deepEqual(result.activeTask.requiredElements, [{ type: 'monster', name: BOSS, placement: BOSS_KEY }]);
  assert.match(result.questUpdate, /Task completed/);
  assert.doesNotMatch(result.questUpdate, /Be at|XP gained/);
  assert.match(h.state.text, /^Coordinates: X: 0, Y: 0, Z: 0$/m);
  assert.match(h.state.text, /^Quest Progress: Step 3\/3: Pending; 0\/3/m);
  assert.equal(h.db()[BOSS_KEY].bossGate.keySeeded, true);
  assert.equal(h.db()[BOSS_KEY].bossGate.keyPlacement, '0,1,0');
  assert.equal(h.db()['0,1,0'].objects.some(o => o.questGateId === gate.id), false);
  assert.equal(h.state.requests.length, requestsBeforePickup + 1);
});

test('ordinary Fetch still requires its bound location even with the correct item in inventory', async () => {
  const task = fetchTask();
  const h = harness({ tasks: [task], text: consoleText({ roomKey: '0,1,0', inventory: 'Iron Sigil' }) });
  const result = await h.turn({ responses: [COMPLETED] });
  assert.equal(h.state.index, 0);
  assert.equal(h.state.seeded, true);
  assert.equal(h.state.tasks[0].status, 'In Progress');
  assert.deepEqual(h.state.tasks[0].hardRequirements, task.hardRequirements);
  assert.deepEqual([result.activeTask.progress.satisfied, result.activeTask.progress.total, result.activeTask.progress.eligible], [1, 2, false]);
  assert.match(result.questUpdate, /Be at 0,0,0/);
  assert.doesNotMatch(result.questUpdate, /Task completed|XP gained/);
  assert.equal(h.db()[BOSS_KEY].bossGate.keySeeded, false);
});

test('integration wrapper forwards playerRoomKey options to real seal placement reachability checks', () => {
  const db = database();
  db['5,5,0'] = { name: 'Isolated Player Room', exits: {}, objects: [] };
  const { gate } = bossGate.ensureBossGate(db, consoleText());
  const h = harness();
  const before = clone(db);
  const rejected = h.dependencies.seedBossKey(db, gate, '0,1,0', { playerRoomKey: '5,5,0' });
  assert.equal(rejected.seeded, false, 'Fourth options argument was lost or player reachability was ignored');
  assert.equal(gate.keySeeded, false);
  assert.equal(gate.keyPlacement, null);
  assert.deepEqual(db, before);
  const accepted = h.dependencies.seedBossKey(db, gate, '0,1,0', { playerRoomKey: '0,0,0' });
  assert.equal(accepted.seeded, true);
  assert.equal(gate.keySeeded, true);
  assert.equal(gate.keyPlacement, '0,1,0');
  assert.deepEqual(h.state.seedAttempts, ['0,1,0', '0,1,0']);
});

test('real stage 2 binds the original boss and cannot reuse a same-named remote monster kill', async () => {
  const h = harness({ tasks: [fetchTask({ status: 'Completed' })], index: 1, seeded: false });
  await h.turn({ responses: [{ placement: '0,0,0' }, PENDING] });
  const key = h.db()[BOSS_KEY].bossGate.keyName;
  const seeded = await h.turn({ text: consoleText({ inventory: key }) });
  const task = h.state.tasks[2];
  assert.equal(seeded.questJustSeeded, true);
  assert.equal(h.state.index, 2);
  assert.equal(h.state.seeded, true);
  assert.equal(task.status, 'Pending');
  assert.deepEqual(task.requiredElements, [{ type: 'monster', name: BOSS, placement: BOSS_KEY }]);
  assert.deepEqual(task.hardRequirements, [{ check: 'at_coords', value: BOSS_KEY }, { check: 'monster_hp_zero', value: BOSS }]);
  assert.deepEqual(task.actionRequirements, [{ check: 'monster_hp_zero', value: BOSS }]);
  assert.deepEqual([task.progress.satisfied, task.progress.total], [0, 3]);
  const wrongRoom = await h.turn({ text: consoleText({ inventory: key, monsters: sheet(BOSS, 0) }), responses: [COMPLETED] });
  assert.equal(task.status, 'In Progress');
  assert.equal(h.state.index, 2);
  assert.equal(wrongRoom.questJustSeeded, false);
  assert.doesNotMatch(seeded.questUpdate, /XP gained/);
  await h.turn({ text: consoleText({ roomKey: BOSS_KEY, inventory: key, monsters: sheet(BOSS, 0) }), responses: [PENDING] });
  assert.equal(task.progress.eligible, true);
  assert.equal(h.state.index, 2);
  const completed = await h.turn({ responses: [COMPLETED] });
  assert.equal(task.status, 'Completed');
  assert.equal(h.state.index, 3);
  assert.equal(h.state.seeded, false);
  assert.equal(completed.activeTask, null);
  assert.equal(h.state.generatedQuests.length, 1);
  assert.equal(h.state.generatedQuests[0].index, 3);
  assert.match(h.state.generatedQuests[0].text, /^Current Quest: None$/m);
  assert.match(completed.questUpdate, /Quest completed!/);
  assert.doesNotMatch(completed.questUpdate, /XP gained/);
});

test('real resolver writes puzzle success binding and real quest manager advances exactly once', async () => {
  const h = harness({ tasks: [puzzleTask()] });
  await h.adjudicate({ questAttempted: true, questSucceeded: true, prereqsMet: true });
  assert.equal(h.state.lastAdjudication.taskBinding, progress.taskBinding(h.state.tasks[0]));
  assert.equal(h.state.lastAdjudication.roomKey, '0,0,0');
  const result = await h.turn({ responses: [{ placement: '0,1,0' }] });
  assert.equal(h.state.tasks[0].status, 'Completed');
  assert.equal(h.state.index, 1);
  assert.equal(h.state.seeded, true);
  assert.equal(result.questJustSeeded, true);
  assert.equal(result.activeTask, h.state.tasks[1]);
  assert.equal(result.activeTask.status, 'Pending');
  assert.equal(h.state.requests.filter(r => r.parameters.updatedStatus).length, 0);
  assert.match(result.questUpdate, /Quest puzzle completed/);
  assert.equal(h.state.generatedQuests.length, 0);
});

test('a success for a differently targeted legacy puzzle cannot complete the next puzzle', async () => {
  const old = puzzleTask({ elements: [{ type: 'object', name: 'First tablet', placement: '0,0,0' }], targetID: 'puzzle-one' });
  const next = puzzleTask({ elements: [{ type: 'object', name: 'Second tablet', placement: '0,0,0' }], targetID: 'puzzle-two' });
  const h = harness({ tasks: [next] });
  await h.adjudicate({ questAttempted: true, questSucceeded: true, prereqsMet: true }, 'solve first tablet', old);
  const result = await h.turn();
  assert.equal(h.state.tasks[0].status, 'Pending');
  assert.equal(h.state.index, 0);
  assert.equal(h.state.seeded, true);
  assert.equal(result.activeTask, h.state.tasks[0]);
});

test('a saved old puzzle success cannot advance the special final-key task without its exact inventory item', async () => {
  const db = database(), text = consoleText();
  const { gate } = bossGate.ensureBossGate(db, text);
  bossGate.seedBossKey(db, gate, '0,0,0');
  const keyTask = bossGate.makeBossKeyTask(gate, '0,0,0');
  const previous = puzzleTask({ status: 'Completed' });
  const h = harness({ tasks: [previous, keyTask], index: 1, seeded: true, db, text });
  await h.adjudicate({ questAttempted: true, questSucceeded: true, prereqsMet: true }, 'solve old puzzle', previous);
  const result = await h.turn({ responses: [COMPLETED] });
  assert.equal(h.state.index, 1);
  assert.equal(h.state.seeded, true);
  assert.equal(result.questJustSeeded, false);
  assert.equal(h.state.tasks[1].status, 'In Progress');
  assert.equal(h.state.tasks[1].progress.satisfied, 0);
  assert.equal(h.state.tasks[1].progress.total, 1);
  assert.equal(h.state.tasks[1].progress.eligible, false);
  assert.equal(h.state.tasks.length, 2);
  assert.doesNotMatch(result.questUpdate, /puzzle completed|XP gained/);
});

test('a missing boss gate must leave stage 1 pending instead of generating a keyless replacement task', async () => {
  const db = database();
  delete db[BOSS_KEY];
  const h = harness({ tasks: [fetchTask({ status: 'Completed' })], index: 1, seeded: false, db });
  const result = await h.turn({ responses: [] });
  assert.equal(h.state.index, 1, 'Final key prerequisite was bypassed');
  assert.equal(h.state.seeded, false);
  assert.equal(h.state.tasks.length, 1);
  assert.equal(result.questJustSeeded, false);
  assert.equal(result.activeTask, null);
  assert.equal(h.state.requests.length, 0);
  assert.match(result.questProgress, /Step 2\/3: waiting/);
});

test('successful puzzle adjudication must not evaluate or complete a second pre-existing task in the same turn', async () => {
  const h = harness({ tasks: [puzzleTask(), fetchTask()] });
  await h.adjudicate({ questAttempted: true, questSucceeded: true, prereqsMet: true });
  const nextTask = clone(h.state.tasks[1]);
  const result = await h.turn({ responses: [{ placement: '0,1,0' }] });
  assert.equal(h.state.index, 1);
  assert.equal(h.state.seeded, true);
  assert.equal(h.state.tasks[0].status, 'Completed');
  assert.equal(nextTask.status, 'Pending');
  assert.equal(h.state.tasks[1].status, 'Pending', 'Next task received the previous puzzle input');
  assert.equal(result.activeTask, h.state.tasks[1]);
  assert.equal(h.state.requests.filter(r => r.parameters.updatedStatus).length, 0);
  assert.match(result.questUpdate, /Quest puzzle completed/);
});

for (const flag of ['questAttempted', 'questSucceeded', 'prereqsMet']) {
  test(`real adjudication's ${flag}=false cannot shortcut puzzle completion`, async () => {
    const h = harness({ tasks: [puzzleTask()] });
    const flags = { questAttempted: true, questSucceeded: true, prereqsMet: true, [flag]: false };
    await h.adjudicate(flags);
    assert.equal(h.state.lastAdjudication[flag], false);
    const result = await h.turn();
    assert.equal(h.state.index, 0);
    assert.equal(h.state.seeded, true);
    assert.equal(h.state.tasks[0].status, 'Pending');
    assert.equal(result.questJustSeeded, false);
    assert.equal(result.activeTask, h.state.tasks[0]);
    assert.equal(h.state.requests.length, 1);
    assert.doesNotMatch(result.questUpdate, /puzzle completed/);
  });
}

test('puzzle success from another room or an unbound legacy hint cannot be reused', async () => {
  for (const change of [hint => { hint.roomKey = '0,1,0'; }, hint => { delete hint.taskBinding; }]) {
    const h = harness({ tasks: [puzzleTask()] });
    await h.adjudicate({ questAttempted: true, questSucceeded: true, prereqsMet: true });
    change(h.state.lastAdjudication);
    await h.turn();
    assert.equal(h.state.index, 0);
    assert.equal(h.state.tasks[0].status, 'Pending');
    assert.equal(h.state.seeded, true);
  }
});

test('different immutable task identities cannot reuse a previous puzzle success', async () => {
  const old = puzzleTask();
  for (const overrides of [{ metrics: 'Speak a different oath' }, { actionKind: 'protect' },
    { targetID: 'puzzle-two' }, { questId: 'different-quest' }, { id: 'different-task' }]) {
    const next = { ...old, ...overrides };
    const h = harness({ tasks: [next] });
    await h.adjudicate({ questAttempted: true, questSucceeded: true, prereqsMet: true }, 'solve previous oath', old);
    await h.turn();
    assert.equal(h.state.index, 0, JSON.stringify(overrides));
    assert.equal(h.state.tasks[0].status, 'Pending');
    assert.equal(h.state.seeded, true);
  }
});

test('saved puzzle prereqsMet=true cannot override current lost inventory or unknown action requirements', async () => {
  for (const overrides of [{ hardRequirements: [{ check: 'inventory_contains', value: 'Iron Sigil' }] },
    { actionRequirements: [{ check: 'novel_action' }] }]) {
    const h = harness({ tasks: [puzzleTask(overrides)] });
    await h.adjudicate({ questAttempted: true, questSucceeded: true, prereqsMet: true });
    const result = await h.turn({ responses: [COMPLETED] });
    assert.equal(h.state.index, 0);
    assert.equal(h.state.seeded, true);
    assert.equal(h.state.tasks[0].status, 'In Progress');
    assert.equal(h.state.tasks[0].progress.eligible, false);
    assert.doesNotMatch(result.questUpdate, /XP gained|puzzle completed/);
  }
});

test('real manager preserves earned checkpoints without eligibility after item loss and JSON reload', async () => {
  const h = harness();
  await h.turn({ text: consoleText({ inventory: 'Iron Sigil' }) });
  assert.equal(h.state.index, 0);
  const first = clone(h.state.tasks[0].progress);
  assert.equal(first.eligible, true);
  h.state.tasks = clone(h.state.tasks);
  await h.turn({ text: consoleText() });
  const lost = clone(h.state.tasks[0].progress);
  assert.equal(lost.eligible, false);
  assert.equal(lost.satisfied, 1);
  assert.deepEqual(lost.earnedCheckpointIds, first.earnedCheckpointIds);
  assert.equal(lost.revision, first.revision + 1);
  h.state.tasks = clone(h.state.tasks);
  const again = await h.turn({ input: '' });
  assert.deepEqual(h.state.tasks[0].progress, lost);
  assert.equal(h.state.index, 0);
  assert.equal(h.state.seeded, true);
  assert.equal(again.questJustSeeded, false);
  assert.equal(h.state.text.match(/^Quest Progress:/gm).length, 1);
});

test('locked action requirement blocks false completion until authoritative DB exit is genuinely open', async () => {
  const db = database();
  db['0,0,0'].exits.north.status = 'locked';
  const task = fetchTask({ actionKind: 'unlock_exit', actionRequirements: [{ check: 'exit_open', coords: '0,0,0', direction: 'north' }] });
  const h = harness({ tasks: [task], db, text: consoleText({ inventory: 'Iron Sigil' }) });
  const first = await h.turn({ responses: [COMPLETED] });
  assert.equal(h.state.index, 0);
  assert.equal(h.state.tasks[0].status, 'In Progress');
  assert.equal(h.state.tasks[0].progress.satisfied, 2);
  assert.equal(h.state.tasks[0].progress.total, 3);
  assert.match(first.questUpdate, /Action pending/);
  assert.doesNotMatch(first.questUpdate, /XP gained/);
  const updated = h.db();
  updated['0,0,0'].exits.north.status = 'open';
  updated['0,0,0'].exits.north.isLocked = true;
  h.state.database = JSON.stringify(updated);
  await h.turn({ responses: [COMPLETED] });
  assert.equal(h.state.index, 0);
  updated['0,0,0'].exits.north.isLocked = false;
  h.state.database = JSON.stringify(updated);
  await h.turn({ responses: [COMPLETED, { placement: '0,1,0' }] });
  assert.equal(h.state.index, 1);
  assert.equal(h.state.tasks[0].status, 'Completed');
  assert.equal(h.state.tasks[1].status, 'Pending');
});

test('stage 1 unreachable gate waits without duplicating tasks, seeding flags or any model calls', async () => {
  const db = database();
  delete db['0,0,0'].exits.east;
  delete db['0,1,0'];
  const h = harness({ tasks: [fetchTask({ status: 'Completed' })], index: 1, seeded: false, db });
  for (let turn = 0; turn < 2; turn++) {
    const result = await h.turn({ responses: [] });
    assert.equal(result.activeTask, null);
    assert.equal(result.questJustSeeded, false);
    assert.equal(h.state.index, 1);
    assert.equal(h.state.seeded, false);
    assert.equal(h.state.tasks.length, 1);
    assert.equal(h.db()[BOSS_KEY].bossGate.keySeeded, false);
    assert.equal(h.db()['0,0,0'].objects.length, 0);
    assert.equal(h.state.seedAttempts.length, turn + 1, 'Failed seeding retried twice in the same turn');
    assert.match(result.questProgress, /Step 2\/3: waiting/);
  }
});

test('stage 2 accepts raw bound coordinates and replaces only index 2, without adding a fourth task', async () => {
  const originalBoss = fetchTask({ desc: 'Old placeholder at index 2', status: 'Completed' });
  const h = harness({ tasks: [fetchTask({ status: 'Completed' }), fetchTask({ status: 'Completed' }), originalBoss],
    index: 2, seeded: false, text: consoleText({ 'Boss Room Coordinates': BOSS_KEY }) });
  const result = await h.turn();
  assert.equal(result.questJustSeeded, true);
  assert.equal(h.state.index, 2);
  assert.equal(h.state.seeded, true);
  assert.equal(h.state.tasks.length, 3);
  assert.equal(h.state.tasks[2].type, 'Defeat');
  assert.equal(h.state.tasks[2].requiredElements[0].name, BOSS);
  assert.equal(h.state.tasks[2].requiredElements[0].placement, BOSS_KEY);
  assert.equal(result.activeTask, h.state.tasks[2]);
});

test('stage 2 invalid or missing boss binding never creates a substitute actor or current-room target', async () => {
  for (const fields of [{ 'Boss Room Coordinates': 'None' }, { 'Boss Room Coordinates': '9,-4' }, { 'Next Boss': 'None' },
    { 'Next Boss': undefined }, { 'Next Boss': '' }]) {
    const text = consoleText(fields).replace(/^Next Boss: undefined\n/m, '');
    const h = harness({ tasks: [fetchTask({ status: 'Completed' }), fetchTask({ status: 'Completed' })], index: 2, seeded: false, text });
    const result = await h.turn({ responses: [] });
    assert.equal(h.state.index, 2);
    assert.equal(h.state.seeded, false);
    assert.equal(result.activeTask, null);
    assert.equal(result.questJustSeeded, false);
    assert.equal(h.state.tasks.length, 2);
    assert.equal(h.state.requests.length, 0);
  }
});

test('stage 0 actual seeding restricts the placement enum to non-boss rooms and preserves boss actor bindings', async () => {
  const h = harness({ tasks: [], index: 0, seeded: false });
  const originalBoss = clone(h.db()[BOSS_KEY].monsters);
  const result = await h.turn({ responses: [{ count: 1 }, { type: 'object' }, { placement: '0,1,0' },
    { type: 'fetch' }, { actionKind: 'other' }, { desc: 'Retrieve the sigil from Key Hall.' },
    { metrics: 'Iron Sigil in Inventory at Key Hall' }, PENDING] });
  const placement = h.state.requests.find(r => r.parameters.placement?.enum);
  assert.ok(placement);
  assert.ok(!placement.parameters.placement.enum.includes(BOSS_KEY));
  assert.deepEqual(result.activeTask.requiredElements, [{ type: 'object', name: 'Iron Sigil', placement: '0,1,0', unlocks: undefined }]);
  assert.equal(h.state.index, 0);
  assert.equal(h.state.seeded, true);
  assert.equal(result.questJustSeeded, true);
  assert.equal(result.activeTask.progress.total, 2);
  assert.equal(result.activeTask.progress.satisfied, 0);
  assert.deepEqual(h.db()[BOSS_KEY].monsters, originalBoss);
});

test('finishing a quest preserves generateQuest fresh console/boss/quest bindings and waiting UI', async () => {
  const finished = fetchTask({ hardRequirements: [], actionRequirements: [], type: 'Defeat', actionKind: 'defeat_monster' });
  const fresh = consoleText({ 'Current Quest': 'New quest: find the chalice', 'Next Boss': 'New Bound Boss',
    'Next Boss Room': 'Fresh Sanctuary', 'Boss Room Coordinates': '5,6,7', 'Next Artifact': 'Fresh Chalice',
    inventory: 'Fresh Chalice', 'Quest Progress': 'old display should be replaced' });
  const h = harness({ tasks: [fetchTask({ status: 'Completed' }), fetchTask({ status: 'Completed' }), finished], index: 2,
    onGenerateQuest: state => {
      state.quest = 'New quest: find the chalice';
      state.tasks = [];
      state.index = 0;
      state.seeded = false;
      state.text = fresh;
    } });
  const result = await h.turn({ responses: [COMPLETED] });
  assert.equal(h.state.generatedQuests.length, 1);
  assert.equal(h.state.index, 0);
  assert.equal(h.state.seeded, false);
  assert.equal(result.activeTask, null);
  assert.match(h.state.text, /^Current Quest: New quest: find the chalice$/m);
  assert.match(h.state.text, /^Next Boss: New Bound Boss$/m);
  assert.match(h.state.text, /^Next Boss Room: Fresh Sanctuary$/m);
  assert.match(h.state.text, /^Boss Room Coordinates: 5,6,7$/m);
  assert.match(h.state.text, /^Next Artifact: Fresh Chalice$/m);
  assert.match(h.state.text, /^Inventory: Fresh Chalice$/m);
  assert.match(h.state.text, /^Quest Progress: Step 1\/3: waiting/m);
  assert.equal(h.state.text.match(/^Quest Progress:/gm).length, 1);
  assert.doesNotMatch(h.state.text, /old display/);
  assert.doesNotMatch(result.questUpdate, /XP gained/);
  assert.equal(h.state.requests.length, 1);
});

const PLANNER_RESPONSES = [{ questAttempted: 'true' }, { engagedInDialogue: true, justLooking: false,
  searchAttempted: true, searchSuccessful: true, objectDiscovered: false, exitDiscovered: false,
  puzzleRequiresObject: false, puzzleRequiresExit: false }];

test('real planner, resolver and manager agree on failed hard prerequisites, including room-bound HP and unknown checks', async () => {
  for (const overrides of [{ hardRequirements: [{ check: 'inventory_contains', value: 'Iron Sigil' }] },
    { hardRequirements: [{ check: 'novel_hard_condition' }] },
    { hardRequirements: [null] },
    { requiredElements: [{ type: 'monster', name: BOSS, placement: BOSS_KEY }],
      hardRequirements: [{ check: 'monster_hp_zero', value: BOSS }] }]) {
    const h = harness({ tasks: [puzzleTask(overrides)], text: consoleText({ monsters: sheet(BOSS, 0) }) });
    const planned = await h.plan(PLANNER_RESPONSES);
    assert.equal(planned.questAttempted, true);
    assert.equal(planned.prereqsMet, false);
    assert.equal(planned.questSucceeded, false);
    await h.adjudicate(planned);
    assert.equal(h.state.lastAdjudication.prereqsMet, false);
    const result = await h.turn({ responses: [COMPLETED] });
    assert.equal(h.state.index, 0);
    assert.equal(h.state.seeded, true);
    assert.equal(h.state.tasks[0].status, 'In Progress');
    assert.equal(h.state.tasks[0].progress.eligible, false);
    assert.doesNotMatch(result.questUpdate, /puzzle completed|XP gained/);
  }
});

test('planner checks hard prerequisites only; manager still gates locked actions before puzzle completion', async () => {
  const db = database();
  db['0,0,0'].exits.north.status = 'locked';
  const task = puzzleTask({ hardRequirements: [{ check: 'at_coords', value: '0,0,0' }],
    actionRequirements: [{ check: 'exit_open', coords: '0,0,0', direction: 'north' }] });
  const h = harness({ tasks: [task], db });
  const planned = await h.plan(PLANNER_RESPONSES);
  assert.equal(planned.prereqsMet, true);
  assert.equal(planned.questSucceeded, true);
  await h.adjudicate(planned);
  const result = await h.turn({ responses: [COMPLETED] });
  assert.equal(h.state.index, 0);
  assert.equal(h.state.tasks[0].status, 'In Progress');
  assert.equal(h.state.tasks[0].progress.eligible, false);
  assert.match(result.questUpdate, /Action pending/);
  assert.doesNotMatch(result.questUpdate, /puzzle completed|XP gained/);
});

test('successful real planner flags flow through the real resolver into single-step puzzle completion', async () => {
  const h = harness({ tasks: [puzzleTask({ hardRequirements: [{ check: 'inventory_contains', value: 'Iron Sigil' }] })],
    text: consoleText({ inventory: 'Iron Sigil' }) });
  const planned = await h.plan(PLANNER_RESPONSES);
  assert.deepEqual([planned.questAttempted, planned.questSucceeded, planned.prereqsMet], [true, true, true]);
  await h.adjudicate(planned);
  const result = await h.turn({ responses: [{ placement: '0,1,0' }] });
  assert.equal(h.state.tasks[0].status, 'Completed');
  assert.equal(h.state.index, 1);
  assert.equal(h.state.seeded, true);
  assert.equal(result.questJustSeeded, true);
  assert.equal(h.state.tasks[1].status, 'Pending');
  assert.equal(h.state.requests.filter(r => r.parameters?.updatedStatus).length, 0);
  assert.match(result.questUpdate, /Quest puzzle completed/);
});
