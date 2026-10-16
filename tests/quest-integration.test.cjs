'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const progress = require('../retort/questProgress');
const bossGate = require('../retort/bossGate');
const PuzzleRewards = require('../retort/puzzleRewards');
const PhysicalPuzzles = require('../assets/physicalPuzzles');
const Inhabitants = require('../assets/dungeonInhabitants');
const ItemTransfer = require('../retort/itemTransfer');
const { createPopulationService } = require('../retort/roomPopulation');
const QuestDeliverySuccessors = require('../retort/questDeliverySuccessors');
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
const generationSource = extract('async function generateQuest(', 'function allocateXP(');
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
    'Objects in Room Properties': 'None', 'Rooms Visited': '3',
    'Puzzle in Room': 'Speak the oath carved into the tablet.', 'Puzzle Solution': 'Speak the old oath.',
    ...fields }).map(([k, v]) => `${k}: ${v}`).join('\n');
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
function attachSolvedMechanism(h) {
  const p = PhysicalPuzzles.fallback('quest-integration', 'Entry');
  let state = PhysicalPuzzles.initialState(p);
  for (const move of PhysicalPuzzles.findSolution(p)) state = PhysicalPuzzles.step(p, state, move.controlId, move.value);
  const db = h.db(); db['0,0,0'].puzzleMechanism = { ...p, state }; h.state.database = JSON.stringify(db);
  h.state.tasks[0].actionRequirements.push({ check: 'puzzle_solved', value: '0,0,0', mechanismId: p.id });
}

function harness({ tasks = [fetchTask()], index = 0, seeded = true, db = database(), text = consoleText(),
  quest = 'Recover Sepulchra', onGenerateQuest, stories = false, regional = false, dungeon = null } = {}) {
  const state = { tasks: clone(tasks), index, seeded, database: JSON.stringify(db), text, quest, lastAdjudication: null,
    updates: [], logs: [], setters: [], generatedQuests: [], prompts: [], requests: [], synchronizers: [],
    seedAttempts: [], xp: 200, score: 17 };
  const queue = [];
  const tagged = (parts, ...values) => { state.prompts.push(parts.reduce((s, part, i) => s + part + (values[i] ?? ''), '')); };
  const assistant = Object.assign(tagged, { generation: async request => {
    state.requests.push(request);
    assert.ok(queue.length, `Unexpected model call: ${state.prompts.at(-1)}`);
    if (request.parameters?.updatedStatus) assert.ok(Object.hasOwn(queue[0], 'updatedStatus'),
      'Unexpected second task evaluation: this turn should only seed the next step');
    const response = queue.shift();
    return { content: typeof response === 'string' ? response : JSON.stringify(response) };
  } });
  const agent = { user: tagged, assistant };
  const sharedState = {
    getDungeonRunId: () => 'integration-run',getGamePaused: () => false,
    getLastCoords: () => {const [x,y,z]=Inhabitants.roomKey(state.text.match(/^Coordinates:[ \t]*(.*)$/m)?.[1]).split(',').map(Number);return{x,y,z};},
    getRoomDungeon: () => dungeon,getRoomDungeonForSimulation: () => dungeon,getRoomPopulation: () => null,
    getCombatCharactersString: () => JSON.stringify([{name:'Hero',type:'pc',hp:20,mazeX:2,mazeY:2,mazeRoomKey:dungeon?.geoKey}]),
    setRoomDungeon: (_coords,value) => dungeon=value,
    getCurrentQuest: () => state.quest, getCurrentTasks: () => state.tasks, getCurrentTaskIndex: () => state.index,
    getQuestSeeded: () => state.seeded, getRoomNameDatabase: () => state.database, getUpdatedGameConsole: () => state.text,
    getLastAdjudication: () => state.lastAdjudication,
    setCurrentQuest: value => { state.quest = value; },
    setLastAdjudication: value => { state.lastAdjudication = value; },
    setCurrentTasks: value => { state.tasks = value; state.setters.push(['tasks', value.length]); },
    setCurrentTaskIndex: value => { state.index = value; state.setters.push(['index', value]); },
    setQuestSeeded: value => { state.seeded = value; state.setters.push(['seeded', value]); },
    setRoomNameDatabase: value => { state.database = value; }, setUpdatedGameConsole: value => { state.text = value; },
    setLastQuestUpdate: value => { state.updates.push(value); }, appendQuestLog: value => { state.logs.push(clone(value)); }
  };
  const sync = name => async (_agent, _coords, _db, text) => { state.synchronizers.push(name); return text; };
  const dependencies = { console: quiet, require: id => require(id.startsWith('./') ? '../retort/' + id.slice(2) : id),
    CampaignMemory: require('../retort/campaignMemory'), sharedState, PuzzleRewards, QuestDeliverySuccessors, Inhabitants, ...progress, ...bossGate, ...actualRoomHelpers,
    FortifiedSites: require('../retort/fortifiedSites'), snapshotQuestContext: require('../retort/worldContext').snapshotQuestContext,
    Divinity: require('../retort/divineEncounters'), Pantheon: require('../assets/pantheonCharacters'), GeneratedNames: require('../retort/generatedNames'),
    QuestScenes: stories ? require('../retort/questScenes') : undefined,
    QuestWritings: stories ? require('../assets/questWritings') : undefined,
    RegionalAdventure: regional ? require('../retort/regionalAdventure') : undefined,
    AdventureJournal: regional ? require('../retort/adventureJournal') : undefined,
    computeDungeonGeometryStamp: () => 'integration-writing-stamp',
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
    generate: async (responses = []) => {
      assert.equal(queue.length, 0, 'Previous turn left unused model responses');
      queue.push(...clone(responses));
      const generate = compile(`let updatedGameConsole = sharedState.getUpdatedGameConsole();
        let roomNameDatabaseString = sharedState.getRoomNameDatabase();
        let bossRoom = '';
        ${generationSource}`, dependencies, 'generateQuest');
      await generate(agent);
      assert.equal(queue.length, 0, 'Quest generation left unused model responses');
    },
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

function regionalHarness(blockWriting = false) {
  const db=database(),name='Edrin Farrows',p=Inhabitants.createPopulation('0,1,0',[{name,allegiance:'Neutral',encounterId:'scribe'}]);
  Object.assign(p.actors[name],{hp:20,sheet:sheet(name,20)+'\nState: Neutral',position:{x:3,y:2}});
  db['0,1,0'].inhabitants=p;db['0,1,0'].monsters={inRoom:name,consoleBlock:p.actors[name].sheet,state:'Neutral'};
  db['0,1,0'].exits.north={status:'open',targetCoordinates:'0,2,0'};
  db['0,2,0']={name:'Amber Spring Approach',objects:[],exits:{},classification:{indoor:false}};
  const dungeon={geoKey:'0,1,0',start:{x:2,y:2},layout:{width:12,height:12},cells:{},tiles:{},sceneObjects:[]};
  for(let y=0;y<12;y++)for(let x=0;x<12;x++)dungeon.cells[`${x},${y}`]={tile:x===0||y===0||x===11||y===11?'wall':'floor',floorHeight:0,ceilHeight:3};
  if(blockWriting)dungeon.cells={};
  return harness({db,tasks:[],seeded:false,regional:true,stories:true,dungeon,
    text:consoleText({roomKey:'0,1,0',monsters:p.actors[name].sheet,'Quests Achieved':'0/21'})});
}
test('real quest manager seeds the first LLM regional adventure while retaining its existing boss binding',async()=>{
  const h=regionalHarness(),originalBoss=h.db()[BOSS_KEY].monsters;
  await h.turn({responses:[require('./fixtures/regional-adventure.cjs')(),PENDING]});
  assert.equal(h.state.tasks.length,1);assert.equal(h.state.tasks[0].type,'Regional');
  assert.equal(h.db()['0,0,0'].regionalAdventureAttempt.status,'installed');
  assert.deepEqual(h.db()[BOSS_KEY].monsters,originalBoss);assert.equal(h.db()[BOSS_KEY].bossGate.keySeeded,false);
  assert.equal(h.state.requests.filter(r=>r.maxTokens===3200).length,1);
  assert.ok(!h.state.prompts.some(p=>/How many required elements/.test(p)));
});
test('real quest manager falls through to the unchanged generator after a rejected regional proposal',async()=>{
  const h=regionalHarness();await h.turn({responses:['not JSON','still not JSON',{count:0}]});
  assert.equal(h.state.tasks.length,0);assert.equal(h.db()['0,0,0'].regionalAdventure,undefined);
  assert.ok(h.state.prompts.some(p=>/How many required elements/.test(p)));
  assert.equal(h.db()[BOSS_KEY].bossGate.keySeeded,false);
});
test('inaccessible covenant placement discards the entire regional proposal before the older fallback runs',async()=>{
  const h=regionalHarness(true);await h.turn({responses:[require('./fixtures/regional-adventure.cjs')(),{count:0}]});
  assert.equal(h.state.tasks.length,0);assert.equal(h.db()['0,0,0'].regionalAdventure,undefined);
  assert.equal(h.db()['0,2,0'].regionalSite,undefined);assert.equal(h.db()['0,3,0'],undefined);
  assert.ok(h.state.prompts.some(p=>/How many required elements/.test(p)));
});
test('entrance never generates a quest even when Rooms Visited has already reached two or more', async () => {
  for (const visited of ['1', '2', '12']) {
    const text = consoleText({ 'Room Name': 'Ruined Temple Entrance', 'Current Quest': 'None',
      'Next Artifact': 'None', 'Rooms Visited': visited });
    const h = harness({ text, quest: 'None', tasks: [], seeded: false });
    const original = clone(h.state);
    await h.generate();
    assert.deepEqual(h.state, original);
  }
});

test('missing coordinates cannot trigger an unbound quest from the entrance boilerplate', async () => {
  const text = consoleText({ 'Current Quest': 'None', 'Next Artifact': 'None' }).replace(/^Coordinates:.*\n/m, '');
  const h = harness({ text, quest: 'None', tasks: [], seeded: false });
  const original = clone(h.state);
  await h.generate();
  assert.deepEqual(h.state, original);
});

test('None is not a quest and never seeds fake tasks in either the entrance or a later room', async () => {
  for (const roomKey of ['0,0,0', '0,1,0']) {
    for (const quest of ['None', ' none ', '', null]) {
      const h = harness({ text: consoleText({ roomKey, 'Current Quest': quest || 'None' }), quest, tasks: [], seeded: false });
      const original = clone(h.state);
      const result = await h.turn({ responses: [] });
      assert.deepEqual(result, { questJustSeeded: false, questUpdate: '', activeTask: null });
      assert.deepEqual(h.state, original);
    }
  }
});

test('an unstarted real quest defers its first task at the entrance without altering saved state', async () => {
  const h = harness({ tasks: [], seeded: false });
  const original = clone(h.state);
  const result = await h.turn({ responses: [] });
  assert.deepEqual(result, { questJustSeeded: false, questUpdate: '', activeTask: null });
  assert.deepEqual(h.state, original);
});

test('second room still generates the original artifact boss and quest once the visited gate is met', async () => {
  const h = harness({ text: consoleText({ roomKey: '0,1,0', 'Current Quest': 'None', 'Next Artifact': 'None',
    'Rooms Visited': '2' }), quest: 'None', tasks: [], seeded: false });
  await h.generate(['Test Chalice', 'Test Guardian', 'Test Sanctuary', 'Retrieve the Test Chalice.']);
  assert.equal(h.state.requests.length, 4);
  assert.equal(h.state.quest, 'Retrieve the Test Chalice.');
  assert.match(h.state.text, /^Coordinates: X: 0, Y: 1, Z: 0$/m);
  assert.match(h.state.text, /^Next Artifact: Test Chalice$/m);
  assert.match(h.state.text, /^Next Boss: Test Guardian$/m);
  assert.match(h.state.text, /^Next Boss Room: Test Sanctuary$/m);
  assert.match(h.state.text, /^Current Quest: Retrieve the Test Chalice\.$/m);
  assert.deepEqual(h.state.tasks, []);
  assert.equal(h.state.index, 0);
  assert.equal(h.state.seeded, false);
});

test('quest generation can bind an existing upper temple room without renaming it or minting its key', async () => {
  const db = database();
  db['6,6,0'] = { name: 'Temple Upper Sanctuary', indoor: true, exits: { down: { status: 'open', targetCoordinates: '6,6,-1' } },
    objects: [], fortifiedFloor: { version: 1, level: 1, bossEligible: true, purpose: 'Upper sanctuary' }, complexId: 'temple-site' };
  const h = harness({ db, text: consoleText({ roomKey: '0,1,0', 'Current Quest': 'None', 'Next Artifact': 'None', 'Rooms Visited': '2' }),
    quest: 'None', tasks: [], seeded: false });
  await h.generate(['Test Chalice', 'Test Guardian', 'Retrieve the Test Chalice from the temple.']);
  assert.match(h.state.text, /^Next Boss Room: Temple Upper Sanctuary$/m);
  assert.match(h.state.text, /^Boss Room Coordinates: X: 6, Y: 6, Z: 0$/m);
  assert.deepEqual(h.db(), db);
  assert.equal(h.state.requests.length, 3);
});

test('quest generation retains its original visited and artifact guards outside the entrance', async () => {
  for (const fields of [{ 'Next Artifact': 'None', 'Rooms Visited': '1' }, { 'Next Artifact': 'Existing Chalice', 'Rooms Visited': '2' }]) {
    const h = harness({ text: consoleText({ roomKey: '0,1,0', ...fields }) });
    const original = clone(h.state);
    await h.generate();
    assert.deepEqual(h.state, original);
  }
});

test('final quest generation binds Sepulchra and Arithus to Hades while ordinary bosses cannot impersonate deities', async () => {
  const final = harness({ text: consoleText({ roomKey: '0,1,0', 'Current Quest': 'None', 'Next Artifact': 'None',
    'Rooms Visited': '999', 'Artifacts Found': '14/15', 'Quests Achieved': '20/21' }), quest: 'None', tasks: [], seeded: false });
  await final.generate(['Invented Crown', 'Invented Boss', 'Invented Hall', 'Complete the last obligation.']);
  assert.match(final.state.text, /^Next Artifact: Sepulchra$/m);
  assert.match(final.state.text, /^Next Boss: Arithus$/m);
  assert.match(final.state.text, /^Next Boss Room: Throne Room of Hades$/m);
  const early = harness({ text: consoleText({ roomKey: '0,1,0', 'Current Quest': 'None', 'Next Artifact': 'None', 'Rooms Visited': '2' }),
    quest: 'None', tasks: [], seeded: false });
  await early.generate(['Test Chalice', 'Artihus', 'Test Sanctuary', 'Retrieve Test Chalice.']);
  assert.match(early.state.text, /^Next Boss: Throneward Sentinel /m);
});

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
  assert.match(h.state.text, /^Quest Requirements: .*Have "Iron Sigil" in your inventory\. Item source: Entry \(0,0,0\)/m);
  const callsBeforeCompletion = h.state.requests.length;
  const done = await h.turn({ text: consoleText({ inventory: 'Iron Sigil' }), responses: [PENDING, { placement: '0,1,0' }] });
  assert.equal(h.state.tasks[0].status, 'Completed');
  assert.equal(h.state.index, 1);
  assert.equal(h.state.seeded, true);
  assert.equal(done.questJustSeeded, true);
  assert.equal(done.activeTask, h.state.tasks[1]);
  assert.equal(done.activeTask.status, 'Pending');
  assert.equal(done.activeTask.progress.total, 1);
  assert.equal(h.state.requests.slice(callsBeforeCompletion).filter(r => r.parameters.updatedStatus).length, 1);
  assert.match(h.state.text, /^Quest Progress: Step 2\/3: Pending; 0\/1/m);
  const nextRequirements = h.state.text.match(/^Quest Requirements:[^\r\n]*/m)?.[0];
  assert.ok(nextRequirements.includes(`Have "${done.activeTask.requiredElements[0].name}" in your inventory.`));
  assert.doesNotMatch(nextRequirements, /Iron Sigil/);
  assert.match(done.questUpdate, /Task completed/);
  assert.doesNotMatch(done.questUpdate, /XP gained/);
  assert.equal(h.state.xp, 200);
  assert.equal(h.state.score, 17);
  assert.deepEqual(h.state.generatedQuests, []);
});

test('an already-seeded stage 0 never creates or fetches the special boss key early', async () => {
  const h = harness({ text: consoleText() });
  const result = await h.turn();
  const gate = h.db()[BOSS_KEY].bossGate;
  assert.equal(h.state.index, 0);
  assert.equal(h.state.seeded, true);
  assert.equal(result.questJustSeeded, false);
  assert.equal(h.state.tasks[0].status, 'In Progress');
  assert.equal(h.state.tasks[0].progress.eligible, false);
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
  const completed = await h.turn({ text: consoleText({ roomKey: BOSS_KEY, inventory: key, monsters: sheet(BOSS, 0) }), responses: [PENDING] });
  assert.equal(task.progress.eligible, true);
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

test('real resolver and verified mechanism completion advance the quest exactly once', async () => {
  const h = harness({ tasks: [puzzleTask()] });
  attachSolvedMechanism(h);
  await h.adjudicate({ questAttempted: true, questSucceeded: true, prereqsMet: true });
  assert.equal(h.state.lastAdjudication.taskBinding, progress.taskBinding(h.state.tasks[0]));
  assert.equal(h.state.lastAdjudication.roomKey, '0,0,0');
  const result = await h.turn({ responses: [{ placement: '0,1,0' }] });
  assert.equal(h.state.tasks[0].status, 'Completed');
  assert.equal(h.state.tasks[0].progress.eligible, true);
  assert.equal(h.state.tasks[0].progress.checks[0].evidence.source, 'database.puzzleMechanism');
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
  assert.equal(h.state.tasks[0].status, 'In Progress');
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
  attachSolvedMechanism(h);
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
    assert.equal(h.state.tasks[0].status, 'In Progress');
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
    assert.equal(h.state.tasks[0].status, 'In Progress');
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
    assert.equal(h.state.tasks[0].status, 'In Progress');
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
  const h = harness({ tasks: [fetchTask({ actionKind: 'unlock_exit',
    actionRequirements: [{ check: 'exit_open', coords: '0,0,0', direction: 'west' }] })] });
  await h.turn({ text: consoleText({ inventory: 'Iron Sigil' }) });
  assert.equal(h.state.index, 0);
  const first = clone(h.state.tasks[0].progress);
  assert.equal(first.eligible, false, 'The item checkpoint is earned but the actual exit action remains pending');
  assert.ok(first.earnedCheckpointIds.includes('hard:1'));
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
  const h = harness({ tasks: [], index: 0, seeded: false, text: consoleText({ roomKey: '0,1,0' }) });
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
  assert.equal(result.activeTask.progress.satisfied, 1);
  assert.deepEqual(h.db()[BOSS_KEY].monsters, originalBoss);
});

test('the real future generator publishes a staged writing quest, which only actual reading, pickup and an explicit conclusion can complete',async()=>{
  const S=require('../retort/questScenes'),d={geoKey:'0,1,0',start:{x:2,y:2},layout:{width:8,height:8},cells:{}};
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)d.cells[`${x},${y}`]={tile:x===0||y===0||x===7||y===7?'wall':'floor'};
  const h=harness({stories:true,dungeon:d,tasks:[],seeded:false,text:consoleText({roomKey:d.geoKey})});
  const result=await h.turn({responses:[{count:1},{type:'object'},{placement:d.geoKey},{type:'fetch'},
    {actionKind:'other'},{desc:'A debt that outlasts death.'},{metrics:'The sigil is returned'},COMPLETED]});
  assert.ok(result.activeTask.story);assert.equal(h.state.index,0);
  const task=result.activeTask;assert.equal(h.sharedState.getRoomDungeon().questWritings.length,1);
  const pick=id=>{const scene=S.view(h.sharedState).scene;return S.choose(h.sharedState,createPopulationService(h.sharedState),
    {runId:'integration-run',geoKey:d.geoKey,storyId:scene.storyId,stageId:scene.stageId,revision:scene.revision,optionId:id});};
  assert.equal(pick('read').error,undefined);
  h.state.text=h.state.text.replace('Inventory: None','Inventory: Iron Sigil');
  assert.equal(S.view(h.sharedState).scene.stageId,'resolution');assert.equal(h.state.index,0);
  assert.equal(pick('finish').error,undefined);assert.equal(h.state.index,1);assert.equal(task.status,'Completed');
  assert.equal(h.state.seedAttempts.length,0,'The story cannot mint a boss key outside the existing final-key step');
});

test('finishing a quest preserves generateQuest fresh console/boss/quest bindings and waiting UI', async () => {
  const finished = { type: 'Defeat', actionKind: 'defeat_monster', desc: 'Defeat the bound regent.',
    requiredElements: [{ type: 'monster', name: BOSS, placement: BOSS_KEY }],
    hardRequirements: [{ check: 'monster_hp_zero', value: BOSS }], actionRequirements: [] };
  const db = database(); db[BOSS_KEY].monsters.consoleBlock = `Monsters in Room:\n${sheet(BOSS, 0)}`;
  const fresh = consoleText({ 'Current Quest': 'New quest: find the chalice', 'Next Boss': 'New Bound Boss',
    'Next Boss Room': 'Fresh Sanctuary', 'Boss Room Coordinates': '5,6,7', 'Next Artifact': 'Fresh Chalice',
    inventory: 'Fresh Chalice', 'Quest Progress': 'old display should be replaced' });
  const h = harness({ tasks: [fetchTask({ status: 'Completed' }), fetchTask({ status: 'Completed' }), finished], index: 2,
    db,
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
  assert.match(h.state.text, /^Quest Requirements: Awaiting the next step/m);
  assert.equal(h.state.text.match(/^Quest Progress:/gm).length, 1);
  assert.doesNotMatch(h.state.text, /old display/);
  assert.doesNotMatch(result.questUpdate, /XP gained/);
  assert.equal(h.state.requests.length, 1);
});

test('future ordinary fetch quests publish exact required names even when generated descriptions abbreviate them', async () => {
  const db = database(), name = 'shroud of eternal echoes';
  db['0,1,0'].name = 'Hall of Eternal Echoes';
  db['0,1,0'].objects = [{ name, type: 'armor' }];
  const h = harness({ tasks: [], seeded: false, db, text: consoleText({ roomKey: '0,1,0', inventory: 'soulshroud' }) });
  const result = await h.turn({ responses: [{ count: 1 }, { type: 'object' }, { placement: '0,1,0' },
    { type: 'fetch' }, { actionKind: 'other' }, { desc: 'Find the shroud in the northern hall.' },
    { metrics: 'Find the shroud.' }, COMPLETED] });
  const text = h.state.text.match(/^Quest Requirements:[^\r\n]*/m)[0];
  assert.ok(text.includes('Have "shroud of eternal echoes" in your inventory. Item source: Hall of Eternal Echoes (0,1,0).'));
  assert.doesNotMatch(text, /northern hall|soulshroud/);
  assert.equal(h.state.index, 0);
  assert.equal(result.activeTask.progress.eligible, false, 'A similarly named item is not the required shroud');
});

const PLANNER_RESPONSES = [{ questAttempted: 'true' }, { engagedInDialogue: false, justLooking: false,
  searchAttempted: true, searchSuccessful: true, objectDiscovered: false, exitDiscovered: false,
  puzzleRequiresObject: false, puzzleRequiresExit: false }, { Hero: 250 }];

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

test('successful model planner flags cannot complete a puzzle without verified mechanism state', async () => {
  const h = harness({ tasks: [puzzleTask({ hardRequirements: [{ check: 'inventory_contains', value: 'Iron Sigil' }] })],
    text: consoleText({ inventory: 'Iron Sigil' }) });
  const planned = await h.plan(PLANNER_RESPONSES);
  assert.deepEqual([planned.questAttempted, planned.questSucceeded, planned.prereqsMet], [true, true, true]);
  await h.adjudicate(planned);
  const result = await h.turn({ responses: [COMPLETED] });
  assert.equal(h.state.tasks[0].status, 'In Progress');
  assert.equal(h.state.index, 0);
  assert.equal(h.state.seeded, true);
  assert.equal(result.questJustSeeded, false);
  assert.equal(h.state.tasks.length, 1);
  assert.equal(h.state.requests.filter(r => r.parameters?.updatedStatus).length, 1);
  assert.match(result.questUpdate, /programmatically verified/);
  assert.doesNotMatch(result.questUpdate, /puzzle completed|XP gained/);
});

test('location-only, empty and unsupported objectives reject generated Completed statuses', async () => {
  for (const task of [{ type: 'Talk', actionKind: 'negotiate', hardRequirements: [], actionRequirements: [] },
    { type: 'Investigate', actionKind: 'investigate', hardRequirements: [{ check: 'at_coords', value: '0,0,0' }], actionRequirements: [] },
    puzzleTask({ hardRequirements: [{ check: 'inventory_contains', value: 'Iron Sigil' }] })]) {
    const h = harness({ tasks: [task], text: consoleText({ inventory: 'Iron Sigil' }) });
    const result = await h.turn({ responses: [COMPLETED] });
    assert.equal(h.state.index, 0);
    assert.equal(h.state.tasks[0].status, 'In Progress');
    assert.equal(h.state.generatedQuests.length, 0);
    assert.equal(h.state.xp, 200);
    assert.match(result.questUpdate, /programmatically verified/);
    assert.doesNotMatch(result.questUpdate, /Task completed|XP gained/);
  }
});

test('a solved physical mechanism completes from database evidence even with no adjudication hint and Pending model output', async () => {
  const h = harness({ tasks: [puzzleTask()] }); attachSolvedMechanism(h);
  const result = await h.turn({ responses: [PENDING, { placement: '0,1,0' }] });
  assert.equal(h.state.index, 1);
  assert.equal(h.state.tasks[0].status, 'Completed');
  assert.equal(h.state.tasks[0].progress.eligible, true);
  assert.equal(h.state.tasks[1].status, 'Pending');
  assert.match(result.questUpdate, /Task completed/);
});

test('real future quest generation compiles vague two-item delivery prose into exact bindings and completes through real handoffs', async () => {
  const db = database(), itemNames = ['chronicle of ruined temple entrance', 'shroud of eternal echoes'], name = 'Grelma Voss';
  db['0,0,0'].name = 'Ruined Temple Entrance'; db['0,0,0'].objects = [{ name: itemNames[0], type: 'other' }];
  db['-1,1,0'] = { name: 'Hall of Eternal Echoes', objects: [{ name: itemNames[1], type: 'armor' }], exits: {} };
  db['0,1,0'].name = 'Hall of Quiet Descent';
  db['0,1,0'].monsters = { inRoom: name, consoleBlock: `Monsters in Room:\n${sheet(name, 20)}`, state: 'Neutral' };
  db['0,0,1'] = { name: 'Sanctum of Silent Reckoning', objects: [], exits: {} };
  const h = harness({ tasks: [], seeded: false, db, text: consoleText({ roomKey: '0,0,1' }) });
  const result = await h.turn({ responses: [{ count: 3 }, { type: 'object' }, { placement: '0,0,0' },
    { type: 'object' }, { placement: '-1,1,0' }, { type: 'monster' }, { placement: '0,1,0' },
    { type: 'deliver' }, { actionKind: 'deliver_item' },
    { desc: 'Retrieve the chronicle and shroud from the northern hall and deliver both to Grelma.' },
    { metrics: 'Both items in inventory and Grelma encountered.' }, COMPLETED] });
  const task = result.activeTask;
  assert.equal(task, h.state.tasks[0]); assert.equal(task.type, 'Deliver'); assert.equal(task.actionKind, 'deliver_item');
  assert.deepEqual(task.hardRequirements, [{ check: 'at_coords', value: '0,1,0' }]);
  assert.deepEqual(task.actionRequirements, itemNames.map(item => ({ check: 'item_delivered', item, recipient: name, coords: '0,1,0' })));
  assert.ok(task.desc.includes('chronicle of ruined temple entrance from Ruined Temple Entrance (0,0,0)'));
  assert.ok(task.desc.includes('shroud of eternal echoes from Hall of Eternal Echoes (-1,1,0)'));
  assert.ok(task.desc.includes('Grelma Voss in Hall of Quiet Descent (0,1,0)'));
  assert.doesNotMatch(task.desc, /northern hall/); assert.match(task.metrics, /engine item-transfer receipt/);
  const requirements = h.state.text.match(/^Quest Requirements:[^\r\n]*/m)?.[0];
  for (const item of itemNames) assert.ok(requirements.includes(`Give "${item}" to Grelma Voss in Hall of Quiet Descent (0,1,0).`));
  assert.ok(requirements.includes('Item source: Hall of Eternal Echoes (-1,1,0).'));
  assert.equal(h.state.index, 0, 'Invented Completed output cannot advance a newly generated delivery');
  assert.equal(task.actionRequirements.some(r => r.check === 'puzzle_solved'), false);
  const population = Inhabitants.createPopulation('0,1,0', [{ name, allegiance: 'Neutral' }]);
  Object.assign(population.actors[name], { sheet: sheet(name, 20), hp: 20, home: { x: 5, y: 4 }, position: { x: 5, y: 4 } });
  const dungeon = { geoKey: '0,1,0', start: { x: 4, y: 4 }, layout: { width: 12, height: 12 }, cells: {} };
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor' };
  let roster = JSON.stringify([{ name: 'Hero', type: 'pc', hp: 20, mazeX: 4, mazeY: 4, mazeRoomKey: '0,1,0' },
    { name, type: 'monster', hp: 20, mazeX: 5, mazeY: 4, mazeRoomKey: '0,1,0' }]);
  Object.assign(h.sharedState, { getLastCoords: () => ({ x: 0, y: 1, z: 0 }), getRoomDungeonForSimulation: () => dungeon,
    getRoomPopulation: () => population, setRoomPopulation() {}, getDungeonRunId: () => 'delivery-test',
    getCombatCharactersString: () => roster, setCombatCharactersString: value => { roster = value; } });
  const service = createPopulationService(h.sharedState);
  h.state.text = consoleText({ roomKey: '0,1,0', inventory: itemNames.join(', '), monsters: sheet(name, 20) });
  const ownedDB = h.db(); ownedDB['0,0,0'].objects = []; ownedDB['-1,1,0'].objects = []; h.state.database = JSON.stringify(ownedDB);
  const before = h.state.requests.length;
  assert.match(ItemTransfer.give(h.sharedState, service, `give ${itemNames[0]} to ${name}`).questUpdate, /1\/2/);
  assert.equal(h.state.index, 0); assert.equal(h.state.tasks[0].status, 'In Progress');
  h.state.tasks = clone(h.state.tasks); h.state.database = JSON.stringify(h.db());
  assert.match(ItemTransfer.give(h.sharedState, service, `give ${itemNames[1]} to ${name}`).questUpdate, /Task completed/);
  assert.equal(h.state.index, 1); assert.equal(h.state.tasks[0].status, 'Completed');
  assert.equal(h.state.tasks[0].progress.satisfied, 3); assert.equal(h.state.tasks[0].progress.total, 3);
  assert.equal(h.state.requests.length, before, 'Handoffs and progress persistence need no model adjudication');
  assert.equal(h.db()['0,1,0'].itemTransfers.length, 2); assert.equal(h.state.xp, 200);
});

test('future generation does not expose a delivery choice without a recipient and rejects invalid model proposals before saving a task', async () => {
  const h = harness({ tasks: [], seeded: false, text: consoleText({ roomKey: '0,1,0' }) });
  const result = await h.turn({ responses: [{ count: 1 }, { type: 'object' }, { placement: '0,0,0' },
    { type: 'deliver' }] });
  const types = h.state.requests.find(r => r.parameters.type?.enum?.includes('fetch'));
  assert.ok(!types.parameters.type.enum.includes('deliver'));
  const actions = h.state.requests.find(r => r.parameters.actionKind);
  assert.equal(actions, undefined, 'Reject an unsupported type before requesting an action');
  assert.equal(h.state.tasks.length, 0); assert.equal(h.state.index, 0); assert.equal(h.state.seeded, false);
  assert.equal(result.activeTask, null); assert.equal(result.questJustSeeded, false);
});

test('a future key-delivery quest requires handing over the key, not unlocking an unrelated exit or keeping it afterward', async () => {
  const db = database(), name = 'Grelma Voss';
  db['0,0,0'].objects = [{ name: 'sepulchral sigil', type: 'key', properties: { magic: 0 }, unlocks: { coordinates: '0,0,0', direction: 'north' } }];
  db['0,1,0'].monsters = { inRoom: name, consoleBlock: `Monsters in Room:\n${sheet(name, 20)}`, state: 'Neutral' };
  const h = harness({ tasks: [], seeded: false, db, text: consoleText({ roomKey: '0,1,0' }) });
  const result = await h.turn({ responses: [{ count: 2 }, { type: 'key' }, { placement: '0,0,0' },
    { type: 'monster' }, { placement: '0,1,0' }, { type: 'deliver' }, { actionKind: 'deliver_item' },
    { desc: 'Give the sigil to Grelma Voss.' }, { metrics: 'The sigil is handed over.' }, PENDING] });
  assert.equal(result.activeTask.actionKind, 'deliver_item');
  assert.deepEqual(result.activeTask.hardRequirements, [{ check: 'at_coords', value: '0,1,0' }]);
  assert.deepEqual(result.activeTask.actionRequirements, [{ check: 'item_delivered', item: 'sepulchral sigil', recipient: name, coords: '0,1,0' }]);
  assert.equal(result.activeTask.actionRequirements.some(r => r.check === 'exit_open'), false);
});

test('future generation never offers unimplemented types or actions and rejects an out-of-schema choice before publishing', async () => {
  for (const type of ['investigate', 'negotiate', 'protect', 'hybrid']) {
    const h = harness({ tasks: [], seeded: false, text: consoleText({ roomKey: '0,1,0' }) });
    const result = await h.turn({ responses: [{ count: 1 }, { type: 'object' }, { placement: '0,1,0' }, { type }] });
    const types = h.state.requests.find(r => r.parameters.type?.enum?.includes('fetch'));
    assert.deepEqual(types.parameters.type.enum, ['fetch']); assert.equal(h.state.tasks.length, 0); assert.equal(h.state.seeded, false);
    assert.equal(result.activeTask, null); assert.match(h.state.text, /^Quest Requirements: Awaiting the next step/m);
    assert.equal(h.state.requests.some(r => r.parameters.actionKind), false);
  }
});

test('zero-element future puzzle tasks bind an existing unsolved mechanism rather than invented model completion conditions', async () => {
  const db = database(), mechanism = PhysicalPuzzles.fallback('generated-puzzle', 'Key Hall');
  mechanism.state = PhysicalPuzzles.initialState(mechanism); db['0,1,0'].puzzleMechanism = mechanism;
  const h = harness({ tasks: [], seeded: false, db, text: consoleText({ roomKey: '0,1,0' }) });
  const result = await h.turn({ responses: [{ count: 0 }, { type: 'puzzle' }, { actionKind: 'solve_puzzle' },
    { desc: 'Investigate an invented southern shrine.' }, { metrics: 'The narrator decides it is done.' }, PENDING] });
  assert.equal(result.activeTask.physicalPuzzleRoom, '0,1,0');
  assert.deepEqual(result.activeTask.actionRequirements, [{ check: 'puzzle_solved', value: '0,1,0', mechanismId: mechanism.id }]);
  assert.match(result.activeTask.desc, /Key Hall/); assert.doesNotMatch(result.activeTask.desc, /invented southern shrine/);
  assert.match(h.state.text, /^Quest Requirements: .*Solve the physical puzzle.*Key Hall/m);
  assert.equal(result.activeTask.progress.eligible, false);
});
