'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');
const M = require('../assets/campaignMemory');
const Campaign = require('../retort/campaignMemory');
const Memory = require('../retort/dialogueMemory');
const Journey = require('../retort/journeyMemory');
const Grounding = require('../retort/dialogueGrounding');
const edran = require('./fixtures/edran-dialogue.cjs');
const { describeCharacters, generateCharacterDialogue } = require('../retort/characterDialogue');
const { createPopulationService } = require('../retort/roomPopulation');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
const tickCode = source.slice(source.indexOf('async function runNpcAutonomyTick('), source.indexOf('async function runLegacyNpcAutonomyTick('));
const entryCode = 'const physicalPuzzleResult = null;\n' + source.slice(source.indexOf('// Narration runs only after placement'),
  source.indexOf('// Include musicArrangement here', source.indexOf('// Narration runs only after placement')));
const sheet = Name => formatStartingCharacterSheet({ Name, HP: 20, MaxHP: 20, Race: 'Human', Class: 'Mason', Level: 1 });

function fixture() {
  const dungeon = { geoKey: '1,0,0', classification: { indoor: true }, layout: { width: 32, height: 32 }, start: { x: 4, y: 4 }, cells: {} };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 6 };
  const actors = [{ name: 'Mortacia', type: 'pc', hp: 20, mazeX: 4, mazeY: 4, mazeRoomKey: dungeon.geoKey },
    { name: 'Noria', type: 'npc', hp: 20, mazeX: 5, mazeY: 4, mazeRoomKey: dungeon.geoKey },
    { name: 'Zharok', type: 'npc', hp: 20, mazeX: 4, mazeY: 5, mazeRoomKey: dungeon.geoKey }];
  const population = I.createPopulation(dungeon.geoKey, []);
  const ledger = { runId: 'run', records: [] }, dialogue = { characters: {}, recent: [] };
  const consoleText = `Room Name: Hall of Bells\nCoordinates: X: 1, Y: 0, Z: 0\nPC:\n${sheet('Mortacia')}\nNPCs in Party:\n${sheet('Noria')}\n${sheet('Zharok')}\nMonsters in Room: None\nMonsters Equipped Properties: None\nTurns: 10\nRooms Visited: 4\nExits: north\nInventory: Empty`;
  let roster = JSON.stringify(actors), db = '{}';
  const state = { getUpdatedGameConsole: () => consoleText, setUpdatedGameConsole() {}, getDungeonRunId: () => 'run',
    getLastCoords: () => ({ x: 1, y: 0, z: 0 }), getGamePaused: () => false, getRoomDungeonForSimulation: () => dungeon,
    getCombatCharactersString: () => roster, setCombatCharactersString: value => { roster = value; },
    getRoomPopulation: () => population, setRoomPopulation() {}, getRoomNameDatabase: () => db,
    setRoomNameDatabase: value => { db = value; }, getDialogueMemory: () => dialogue, getCampaignMemory: () => ledger,
    getCurrentQuest: () => 'Recover the silver bell.', getCurrentTasks: () => [{ desc: 'Find the keeper.', status: 'Completed' },
      { desc: 'Recover the silver bell.', status: 'In Progress', progress: { satisfied: 1, total: 2 } }], getCurrentTaskIndex: () => 1,
    getLiveWorldState: () => ({ roomKey: dungeon.geoKey, player: { x: 4.5, y: 4.5 }, currentConversation: 'The keeper warned us about the damaged bell.' }) };
  const service = createPopulationService(state);
  const visit = () => service.visit({ geoKey: dungeon.geoKey, runId: 'run', player: { x: 4.5, y: 4.5 } });
  return { actors, dungeon, population, ledger, dialogue, state, service, visit, stored: () => JSON.parse(db) };
}
const record = (id, text, extra = {}) => ({ id, text, runId: 'run', roomKey: '1,0,0', kind: 'dialogue', authority: 'statement',
  turn: 1, at: 1, speaker: 'Noria', witnesses: ['Noria', 'Zharok', 'Mortacia'], ...extra });
const exchange = { lines: [{ speaker: 'Noria', line: 'The keeper trusted us with his bell.' },
  { speaker: 'Zharok', line: 'Then we should honor his trust.' }] };
function agent(result) {
  const prompts = [], requests = [];
  const add = (parts, ...values) => prompts.push(typeof parts === 'string' ? parts : String.raw({ raw: parts }, ...values));
  return { prompts, requests, user: add, system: add, assistant: { generation: async options => {
    requests.push(options); const json = JSON.stringify(result);
    return { content: prompts.some(text => text.includes('Mark EVERY actual spoken passage')) ?
      `The keeper's warning lingers. [[CHARACTER_DIALOGUE]]${json}[[/CHARACTER_DIALOGUE]]` : json };
  } } };
}

test('live speech removes shortened echoes from future idle caches and later refreshes', () => {
  const f = fixture(), fresh = 'We should ask the ferryman about the missing burial register.';
  const rows = [{ speaker: 'Noria', lines: [...edran.replies, fresh] }];
  I.applyReplies(f.population, rows, f.actors);
  I.noteSpoken(f.population, [{ speaker: 'Noria', line: edran.speech }]);
  assert.deepEqual(f.population.companions.Noria.dialogue, [fresh]);
  assert.equal(f.population.companions.Noria.dialogueIndex, 0);
  I.applyReplies(f.population, rows, f.actors);
  assert.deepEqual(f.population.companions.Noria.dialogue, [fresh]);
  I.applyReplies(f.population, [{ speaker: 'Zharok', lines: [edran.replies[0]] }], f.actors);
  assert.deepEqual(f.population.companions.Zharok.dialogue, [edran.replies[0]], 'Speech history is individual.');
  f.population.lastCannedSpeechAt = 0;
  assert.deepEqual(f.visit().dialogue, [{ speaker: 'Zharok', line: edran.replies[0], kind: 'canned' }]);
  f.population.lastCannedSpeechAt = 0;
  assert.deepEqual(f.visit().dialogue, [{ speaker: 'Noria', line: fresh, kind: 'canned' }]);
});

test('spoken-cache cursor is preserved while unread repeats and stale paired exchanges are removed', () => {
  const f = fixture(), first = 'I know the name Mortacia.', fresh = 'The harbor needs another watchman.';
  I.applyReplies(f.population, [{ speaker: 'Noria', lines: [first, edran.replies[0], fresh] }], f.actors,
    { exchanges: [{ lines: [{ speaker: 'Noria', line: edran.replies[0] }, exchange.lines[1]] }] });
  I.noteSpoken(f.population, [{ speaker: 'Noria', line: first }]);
  I.noteSpoken(f.population, [{ speaker: 'Noria', line: edran.speech }]);
  assert.equal(f.population.companions.Noria.dialogueIndex, 1);
  assert.deepEqual(f.population.companions.Noria.dialogue, [first, fresh]);
  assert.deepEqual(f.population.dialogueQueue, []);
  assert.equal(f.ledger.records.length, 0, 'Dedup history does not fabricate performed campaign events.');
});

test('live and queued dialogue retain individual voices without the added public-lore directive', () => {
  const characters = [{ name: 'Edran Bellworn', job: 'temple custodian', background: {
    history: 'Repaired the harbor bell with his daughter.', voice: 'Warm practical observations.', motivation: 'Finish the memorial.' } }];
  for (const mode of ['narrative', 'cache']) {
    const prompt = Grounding.prompt(characters, [], null, { mode });
    assert.doesNotMatch(prompt, /PUBLIC UNDERWORLD CULTURE|Local public context|Hades has fallen to Arithus|before asking a character-driven question/);
    assert.match(prompt, /Repaired the harbor bell with his daughter/);
    assert.match(prompt, /Warm practical observations/); assert.match(prompt, /Finish the memorial/);
    assert.match(prompt, /concerns, questions or practical observations/);
    assert.match(prompt, /characters can disagree, reminisce/);
    assert.match(prompt, /including the live speech in this very response/);
    assert.match(prompt, /If heardCurrentConversation is false/);
  }
  assert.match(Campaign.prompt({}), /No relevant record means unknown, not permission to fabricate earlier events/);
  assert.doesNotMatch(Campaign.prompt({}), /ignorance of the original canonical backstory/);
});

test('five-minute dialogue keeps the authored character context without the added lore emphasis', async () => {
  const f = fixture(), a = agent({ spoken: [], replies: [] });
  const characters = describeCharacters(f.actors, f.population);
  characters[0].background = { history: 'Carved the old bridge with her sister.', voice: 'Quick and good-humored.' };
  await generateCharacterDialogue(a, { characters });
  assert.equal(a.requests.length, 1);
  const prompt = a.prompts.find(value => value.startsWith('Queued dialogue planning'));
  assert.match(prompt, /Carved the old bridge with her sister/); assert.match(prompt, /Quick and good-humored/);
  assert.doesNotMatch(a.prompts.join('\n'), /PUBLIC UNDERWORLD CULTURE|before asking a character-driven question/);
});

test('batch planning favors companions and discovered residents while keeping a hard room budget', () => {
  assert.deepEqual(Grounding.batchPlan([{ name: 'Noria', partyMember: true }, { name: 'Mason', encountered: true }, { name: 'Unseen' }]),
    [{ name: 'Noria', lines: 6 }, { name: 'Mason', lines: 4 }, { name: 'Unseen', lines: 2 }]);
  const crowded = Array.from({ length: 50 }, (_, i) => ({ name: `Soul ${i}`, partyMember: true }));
  const plan = Grounding.batchPlan(crowded);
  assert.equal(plan.length, 32); assert.equal(plan.reduce((sum, row) => sum + row.lines, 0), 64);
  assert.ok(plan.every(row => row.lines >= 2)); assert.ok(Grounding.outputBudget(crowded, 4000) <= 6000);
});

test('recent retrieval preserves chronological witnessed context without requiring matching query words', () => {
  const index = M.createIndex('run', [record('old', 'The keeper entrusted us with his instrument.'),
    record('latest', 'He asked us not to abandon him.', { turn: 9 }),
    record('private', 'A secret inside the guardhouse.', { turn: 10, witnesses: ['Guard'], speaker: 'Guard' })]);
  const recent = index.recent({ owner: 'Noria', limit: 2 });
  assert.deepEqual(recent.map(row => row.id), ['latest', 'old']);
  assert.deepEqual(index.search('unmentioned telescope', { owner: 'Noria' }), []);
  recent[0].text = 'changed'; assert.notEqual(index.get('latest').text, 'changed');
  assert.ok(JSON.stringify(index.recent({ maxChars: 300 })).length <= 300);
  assert.deepEqual(index.recent({ limit: 0 }), []);
});

test('personal recap carries recent conversations and committed outcomes across rooms without leaking private history', () => {
  const f = fixture();
  Campaign.add(f.state, [record('promise', 'The keeper trusted us not to abandon him.', { roomKey: '0,0,0' }),
    record('partial', 'The gate remains closed; only the left dial moved.', { turn: 9, kind: 'puzzle', authority: 'adjudicated' }),
    record('guard-secret', 'The other dial should face midnight.', { turn: 10, speaker: 'Far Guard', witnesses: ['Far Guard'] })]);
  const rows = Campaign.dialogueContext(f.state, [{ name: 'Noria', partyMember: true },
    { name: 'Far Guard', job: 'sentinel', activity: 'watching the gate' }], 'unmentioned telescope');
  assert.ok(rows[0].memories.some(row => row.id === 'promise' && row.recent && row.roomKey === '0,0,0'));
  assert.ok(rows[0].memories.some(row => row.id === 'partial' && row.authority === 'adjudicated' && /remains closed/.test(row.excerpt)));
  assert.ok(rows[0].memories.every(row => row.id !== 'guard-secret'));
  assert.ok(rows[1].memories.every(row => !['promise', 'partial'].includes(row.id)));
  assert.equal(rows[1].heardCurrentConversation, false);
  assert.deepEqual(rows[0].memories.map(row => row.turn), [1, 9]);
  assert.ok(JSON.stringify(Campaign.dialogueContext(f.state, Array(20).fill({ name: 'Noria' }), 'keeper', 1200)).length <= 1200);
});

test('distant residents recall their own work rather than adopting the global recent-conversation query', () => {
  const f = fixture();
  Campaign.add(f.state, [record('old-watch', 'Far Guard promised to repair the watchtower.',
    { speaker: 'Far Guard', witnesses: ['Far Guard'], turn: 1 }),
    record('old-private', 'I keep a private sapphire in my locker.', { speaker: 'Far Guard', witnesses: ['Far Guard'], turn: 2 }),
    ...Array.from({ length: 6 }, (_, i) => record(`latest-${i}`, 'The gate shift continues.',
      { speaker: 'Far Guard', witnesses: ['Far Guard'], turn: 3 + i }))]);
  const [row] = Campaign.dialogueContext(f.state, [{ name: 'Far Guard', job: 'watchtower repairer', activity: 'repairing the watchtower' }],
    'Mortacia secretly asked about sapphire lockers.');
  assert.ok(row.memories.some(item => item.id === 'old-watch'));
  assert.ok(!row.memories.some(item => item.id === 'old-private'));
});

test('crowded-room recall favors actual listeners without excluding the remaining character identities', () => {
  const f = fixture();
  Campaign.add(f.state, [record('keeper-request', 'The keeper asked us not to abandon him, even if repairing the silver bell takes time.',
    { turn: 9 }), record('keeper-outcome', 'We found the keeper, but the silver bell has not been recovered.',
    { turn: 10, kind: 'quest', authority: 'state' })]);
  const characters = [{ name: 'Noria', partyMember: true }, { name: 'Zharok', partyMember: true },
    ...Array.from({ length: 18 }, (_, i) => ({ name: `Distant Soul ${i}`, job: 'sentinel' }))];
  const rows = Campaign.dialogueContext(f.state, characters, 'unmentioned telescope');
  assert.equal(rows.length, 20); assert.ok(JSON.stringify(rows).length <= 6000);
  assert.ok(rows.slice(0, 2).every(row => row.memories.some(memory => memory.id === 'keeper-request') &&
    row.memories.some(memory => memory.id === 'keeper-outcome' && /has not been recovered/.test(memory.excerpt))));
  assert.ok(rows.slice(2).every(row => !row.heardCurrentConversation && row.memories.length === 0));
});

test('queued batches preserve more than three lines, remain bounded and do not become spoken memories', () => {
  const f = fixture(), lines = Array.from({ length: 6 }, (_, i) => `An afterthought about the keeper ${i}.`);
  const parsed = I.extractDialogue(`[[CHARACTER_DIALOGUE]]${JSON.stringify({ replies: [{ speaker: 'Noria', lines }], exchanges: [exchange] })}[[/CHARACTER_DIALOGUE]]`, ['Noria', 'Zharok']);
  assert.equal(parsed.replies[0].lines.length, 6); assert.equal(parsed.dialogue.length, 0);
  I.applyReplies(f.population, parsed.replies, f.actors, { exchanges: parsed.exchanges });
  assert.deepEqual(f.population.companions.Noria.dialogue, lines); assert.equal(f.population.companions.Noria.dialogueIndex, 0);
  assert.equal(f.population.dialogueQueue.length, 1); assert.equal(f.dialogue.recent.length, 0); assert.equal(f.ledger.records.length, 0);
  const crowded = Array.from({ length: 32 }, (_, i) => ({ speaker: `Soul ${i}`, lines: Array.from({ length: 20 }, (_, n) => `Remark ${n}.`) }));
  const bounded = I.sanitizeReplies(crowded, crowded.map(row => row.speaker));
  assert.equal(bounded.length, 32); assert.equal(bounded.reduce((sum, row) => sum + row.lines.length, 0), 64);
  assert.equal(I.sanitizeReplies([{ speaker: 'Noria', lines: ['Same.', 'Same.', {}, 3] }], ['Noria'])[0].lines.length, 1);
});

test('companion side conversations play in order, only when both speakers are present and audible, without model calls', () => {
  const f = fixture(); I.applyReplies(f.population, [], f.actors, { exchanges: [exchange] });
  const far = JSON.parse(f.state.getCombatCharactersString()); far.find(a => a.name === 'Zharok').mazeX = 25;
  f.state.setCombatCharactersString(JSON.stringify(far));
  assert.deepEqual(f.visit().dialogue, []); assert.equal(f.population.dialogueQueue.length, 1);
  f.state.setCombatCharactersString(JSON.stringify(f.actors));
  const heard = f.visit();
  assert.deepEqual(heard.dialogue.map(row => [row.speaker, row.line]), exchange.lines.map(row => [row.speaker, row.line]));
  assert.ok(heard.speech.every(row => row.canHear)); assert.equal(f.population.dialogueQueue.length, 0);
  assert.equal(f.dialogue.recent.length, 2); assert.equal(f.ledger.records.length, 0, 'Archive waits for actual subtitle display reports.');
  assert.deepEqual(f.visit().dialogue, []);
  assert.equal(f.stored()['1,0,0'].inhabitants.dialogueQueue.length, 0);
});

test('side conversations respect pause and directed-conversation focus and reject nonparty or deceased speakers', () => {
  const f = fixture(); I.applyReplies(f.population, [], f.actors, { exchanges: [exchange,
    { lines: [{ speaker: 'Noria', line: 'Hello.' }, { speaker: 'Unknown Guard', line: 'An unseen reply.' }] }] });
  assert.equal(f.population.dialogueQueue.length, 1);
  f.state.getGamePaused = () => true;
  assert.equal(f.visit().status, 409); assert.equal(f.population.dialogueQueue.length, 1);
  f.state.getGamePaused = () => false;
  f.population.dialogueFocus = { until: Date.now() + 5000 };
  assert.deepEqual(f.visit().dialogue, []); assert.equal(f.population.dialogueQueue.length, 1);
  delete f.population.dialogueFocus;
  const dead = JSON.parse(f.state.getCombatCharactersString()); dead.find(a => a.name === 'Zharok').hp = 0;
  f.state.setCombatCharactersString(JSON.stringify(dead));
  assert.deepEqual(f.visit().dialogue, []); assert.equal(f.population.dialogueQueue.length, 0);
});

test('normal player narration generates the queued batch in its existing request and resets the five-minute server clock', async () => {
  const f = fixture(), a = agent({ replies: [{ speaker: 'Noria', lines: Array.from({ length: 6 }, (_, i) => `Keeper afterthought ${i}.`) }], exchanges: [exchange] });
  f.population.lastDialogueRefreshAt = Date.now() - I.DIALOGUE_REFRESH_MS - 1000;
  f.actors[1].originProfile = { personality: 'Quiet and skeptical.', history: 'Once kept a flooded quarry safe.', voice: 'Plain and exact.', motivation: 'Keep promises.' };
  f.state.setCombatCharactersString(JSON.stringify(f.actors));
  Campaign.rememberInput(f.state, 'I promised the keeper I would return.', f.state.getUpdatedGameConsole());
  const context = { Inhabitants: I, DialogueMemory: Memory, JourneyMemory: Journey, CampaignMemory: Campaign, describeCharacters,
    generateCharacterDialogue, sharedState: f.state, geoCoords: { x: 1, y: 0, z: 0 }, geoKey: f.dungeon.geoKey,
    enteringRoom: false, updatedGameConsole: f.state.getUpdatedGameConsole(), userInput: 'ask Noria about the keeper',
    roomDescription: 'A hall with a damaged silver bell.', spoken: { dialogue: [], replies: [] }, autoMax: 850,
    populationService: { prepare: () => f.population, get: () => f.population, save() {} },
    $: a, run: work => work(a), retort: work => work, sanitizeLiveWorldStateForPrompt: value => value,
    console: { info() {}, warn() {} } };
  await vm.runInNewContext(`(async()=>{${entryCode}})()`, context);
  assert.equal(a.requests.length, 1); assert.ok(Date.now() - f.population.lastDialogueRefreshAt < 1000);
  assert.equal(f.population.companions.Noria.dialogue.length, 6); assert.equal(f.population.dialogueQueue.length, 1);
  const prompt = a.prompts.find(text => text.startsWith('Live story continuation'));
  assert.match(prompt, /I promised the keeper/); assert.match(prompt, /Find the keeper/); assert.match(prompt, /1\/2/);
  assert.match(prompt, /"Noria","lines":6/); assert.match(prompt, /Cached alternatives have NOT happened/);
  assert.match(prompt, /flooded quarry/); assert.match(prompt, /Quiet and skeptical/);
  vm.runInNewContext(tickCode, context);
  const background = await context.runNpcAutonomyTick();
  assert.equal(background.cached, true); assert.equal(a.requests.length, 1, 'No redundant refresh immediately after a typed command.');
});

test('five-minute fallback receives party progress and recent conversation recap in one batched request', async () => {
  const f = fixture(), a = agent({ spoken: [], replies: [{ speaker: 'Noria', lines: ['The keeper is still counting on us.'] }], exchanges: [exchange] });
  Campaign.add(f.state, [record('keeper', 'He asked us not to abandon him.', { turn: 9 })]);
  const logs = [], context = { Inhabitants: I, DialogueMemory: Memory, JourneyMemory: Journey, CampaignMemory: Campaign,
    describeCharacters, generateCharacterDialogue, sharedState: f.state,
    populationService: { get: () => f.population, save: value => f.service.save(value) },
    sanitizeLiveWorldStateForPrompt: value => value, run: work => work(a), retort: work => work,
    console: { warn() {}, info: (...args) => logs.push(args) } };
  vm.runInNewContext(tickCode, context);
  const result = await context.runNpcAutonomyTick();
  assert.equal(result.refreshed, true); assert.equal(result.dialogue.length, 0); assert.equal(a.requests.length, 1);
  assert.match(a.prompts.join('\n'), /Find the keeper/); assert.match(a.prompts.join('\n'), /He asked us not to abandon him/);
  assert.equal(f.population.dialogueQueue.length, 1); assert.equal(f.stored()['1,0,0'].inhabitants.dialogueQueue.length, 1);
  assert.ok(logs.some(([tag, json]) => tag === '[DialogueGrounding]' && JSON.parse(json).characters.some(row => row.evidenceIds.includes('keeper'))));
});
