'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/campaignMemory');
const C = require('../retort/campaignMemory');
const I = require('../assets/dungeonInhabitants');
const Profiles = require('../assets/characterProfiles');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
const row = (id, text, extra = {}) => ({ id, text, runId: 'run', roomKey: '1,0,0', kind: 'dialogue',
  actors: ['Zharok'], speaker: 'Zharok', witnesses: ['Mortacia', 'Zharok'], authority: 'statement', turn: 1, ...extra });
const sheet = Name => formatStartingCharacterSheet({ Name, HP: 20, MaxHP: 20, Level: 1, Race: 'Human', Class: 'Mason' });
function fixture() {
  let runId = 'run', archive = { runId, records: [] };
  const dungeon = { geoKey: '1,0,0', classification: { indoor: true }, start: { x: 4, y: 4 }, cells: {} };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 6 };
  const roster = [{ name: 'Mortacia', type: 'pc', hp: 20, mazeX: 4, mazeY: 4, mazeRoomKey: dungeon.geoKey },
    { name: 'Zharok', type: 'npc', hp: 20, mazeX: 5, mazeY: 4, mazeRoomKey: dungeon.geoKey },
    { name: 'Far Guard', type: 'monster', hp: 20, mazeX: 25, mazeY: 25, mazeRoomKey: dungeon.geoKey }];
  const population = I.createPopulation(dungeon.geoKey, [{ name: 'Far Guard', allegiance: 'Hostile' }]);
  let consoleText = `Room Name: Hall of Bells\nCoordinates: X: 1, Y: 0, Z: 0\nPC:\n${sheet('Mortacia')}\nNPCs in Party:\n${sheet('Zharok')}\nMonsters in Room:\n${sheet('Far Guard')}\nMonsters Equipped Properties: None\nTurns: 10\nInventory: Empty\nExits: north`;
  const state = { getDungeonRunId: () => runId, getCampaignMemory: () => archive, getUpdatedGameConsole: () => consoleText,
    getCombatCharactersString: () => JSON.stringify(roster), getRoomDungeonForSimulation: () => dungeon,
    getRoomPopulation: () => population, getCurrentTasks: () => [], getActiveTask: () => null };
  return { state, roster, dungeon, population, text: () => consoleText,
    setText: value => consoleText = value, reset: () => { runId = 'new-run'; archive = { runId, records: [] }; } };
}

test('ranked retrieval finds an old exact character/item reference ahead of unrelated recent chatter', () => {
  const rows = [row('old', 'Zharok hid the obsidian seal beside the western bell.', { turn: 1 })];
  for (let i = 2; i < 200; i++) rows.push(row(`new${i}`, 'The sand whispers about another road.', { turn: i, actors: ['Other Soul'], speaker: 'Other Soul' }));
  const index = M.createIndex('run', rows);
  assert.equal(index.search('Zharok obsidian seal', { turn: 200 })[0].id, 'old');
  assert.equal(index.search('Zharokk obsidian', { turn: 200 })[0].id, 'old');
  assert.deepEqual(index.search('unmentioned telescopes'), []);
});
test('activity synonyms and inflections retrieve the original words, including negation', () => {
  const index = M.createIndex('run', [row('promise', 'Zharok promised to help, but did not deliver the key.')]);
  const hit = index.search('pledge')[0];
  assert.equal(hit.id, 'promise'); assert.match(hit.text, /did not deliver/);
  assert.equal(index.search('unlocked')[0].id, 'promise');
});
test('room filtering and personal witnesses prevent remote characters acquiring private memories', () => {
  const index = M.createIndex('run', [row('here', 'The obsidian key is missing.'), row('there', 'The obsidian key is broken.', { roomKey: '2,0,0' })]);
  assert.deepEqual(index.search('obsidian', { roomOnly: true, roomKey: '1,0,0' }).map(r => r.id), ['here']);
  assert.equal(index.search('obsidian', { owner: 'Mortacia' }).length, 2);
  assert.deepEqual(index.search('obsidian', { owner: 'Far Guard' }), []);
});
test('an archive is run-scoped, bounded, detached from callers and has a hard serialized prompt budget', () => {
  const index = M.createIndex('run', [], 40);
  for (let i = 0; i < 100; i++) index.add(row(`entry${i}`, `obsidian clue ${i} ` + 'long '.repeat(500)));
  assert.equal(index.size(), 40); assert.equal(index.get('entry0'), null);
  assert.equal(index.add(row('wrong', 'obsidian', { runId: 'other' })), null);
  const results = index.search('obsidian', { maxChars: 1800 });
  assert.ok(JSON.stringify(results).length <= 1800);
  results[0].text = 'changed'; assert.notEqual(index.get(results[0].id).text, 'changed');
  assert.deepEqual(index.search('obsidian', { limit: 0 }), []);
});
test('history import indexes room exchanges and own speech, not recursive prompts or console data', () => {
  const original = { id: 4, conversationId: 'conversation', runId: 'run',
    gameConsole: `Coordinates: X: 1, Y: 0, Z: 0\nPC:\n${sheet('Mortacia')}\nNPCs in Party:\n${sheet('Zharok')}\nMonsters in Room: None\nMonsters Equipped Properties: None`,
    prompt: '$.user `Tell me about the bell.`', response: '$.assistant `Zharok says, "I promised to repair the bell."`',
    personalNarrative: 'HUGE RECURSIVE TRANSCRIPT', systemPrompt: 'SECRET PUZZLE SOLUTION' };
  const rows = M.historyRecords(original, { runId: 'run', conversationId: 'conversation' });
  assert.ok(rows.every(r => r.roomKey === '1,0,0'));
  assert.ok(!JSON.stringify(rows).includes('RECURSIVE')); assert.ok(!JSON.stringify(rows).includes('SECRET'));
  assert.ok(rows.some(r => r.speaker === 'Zharok' && r.witnesses.includes('Zharok')));
  assert.deepEqual(M.historyRecords({ ...original, runId: 'other' }, { runId: 'run', conversationId: 'conversation' }), []);
  assert.deepEqual(M.historyRecords({ ...original, runId: undefined }, { runId: 'run', conversationId: 'conversation', allowLegacy: false }), []);
});
test('browser recollections cannot overwrite committed outcomes, even with the same ID', () => {
  const f = fixture(); C.add(f.state, [row('gate', 'The gate remains closed.', { authority: 'state', source: 'committed-game-state' })]);
  C.restore(f.state, [row('gate', 'The gate is open.', { authority: 'state' })], 'run');
  assert.equal(C.exportRecords(f.state)[0].text, 'The gate remains closed.');
  C.restore(f.state, [row('claim', 'We defeated the boss.', { authority: 'state' })], 'run');
  assert.equal(C.exportRecords(f.state).find(r => r.id === 'claim').authority, 'reported');
  assert.throws(() => C.restore(f.state, [], 'other'), /no longer/);
});

test('ambient history retains individual speakers and room scope even when its parent has no console or coordinates', () => {
  const ambient = { id: 99, kind: 'ambient-dialogue', conversationId: 'conversation', gameConsole: '', runId: 'run',
    dialogue: [{ geoKey: '1,0,0', speech: 'Zharok: "I promised to repair the bell."' },
      { geoKey: '2,0,0', speech: 'Far Guard: "Do not cross my bridge."' },
      { runId: 'other', geoKey: '2,0,0', speech: 'Another Soul: "A different adventure."' }] };
  const rows = M.historyRecords(ambient, { runId: 'run', conversationId: 'conversation' });
  assert.equal(rows.length, 2); assert.equal(rows[0].speaker, 'Zharok'); assert.equal(rows[1].roomKey, '2,0,0');
  assert.deepEqual(rows[0].witnesses, ['Zharok']); assert.equal(rows[0].text, 'I promised to repair the bell.');
  assert.deepEqual(M.historyRecords({ ...ambient, id: 100 }, { runId: 'run', conversationId: 'conversation' }), rows,
    'Rewriting the rolling ambient row must not duplicate the same memories.');
});
test('PC input and actual speech are remembered only by nearby hearing witnesses', () => {
  const f = fixture(); C.rememberInput(f.state, 'I promise to repair the bell.', f.text());
  C.rememberDialogue(f.state, null, [{ speaker: 'Zharok', line: 'Then I will help you.' }, { speaker: 'Far Guard', line: 'A remote secret.' }]);
  const records = C.exportRecords(f.state);
  assert.ok(records.every(r => r.witnesses.includes('Mortacia') && r.witnesses.includes('Zharok')));
  assert.ok(records.every(r => !r.witnesses.includes('Far Guard')));
  assert.ok(records.some(r => r.kind === 'player-input' && r.speaker === 'Mortacia'));
  assert.ok(!records.some(r => r.text === 'A remote secret.'));
  f.reset(); assert.deepEqual(C.exportRecords(f.state), []);
});

test('individual dialogue recalls witnessed promises without handing them to distant characters', () => {
  const f = fixture(); C.rememberInput(f.state, 'I promise to repair the bell.', f.text());
  C.add(f.state, [row('private', 'The bell reminds me of my abandoned watch.', { speaker: 'Far Guard', actors: ['Far Guard'], witnesses: ['Far Guard'] })]);
  const recalled = C.dialogueContext(f.state, [{ name: 'Zharok' }, { name: 'Far Guard' }], 'promised bell watch');
  assert.equal(recalled[0].heardCurrentConversation, true); assert.equal(recalled[1].heardCurrentConversation, false);
  assert.ok(recalled[0].memories.some(r => r.excerpt.includes('promise to repair')));
  assert.ok(recalled[1].memories.every(r => !r.excerpt.includes('promise to repair')));
  assert.ok(recalled[1].memories.some(r => r.id === 'private' && r.roomKey === '1,0,0'));
  assert.ok(JSON.stringify(C.dialogueContext(f.state, Array.from({ length: 32 }, (_, i) => ({ name: `Soul ${i}` })), 'bell', 1000)).length <= 1000);
});
test('commits preserve partial puzzle outcomes as evidence, not completed quests or alternative successes', () => {
  const f = fixture(), initial = { Action: 'PuzzleSolving', 'Selected Characters': ['Mortacia'],
    Outcomes: [{ character: 'Mortacia', outcome: 'Turns the left mirror; the right remains misaligned.' }],
    metadata: [{ actor: 'Mortacia', activity: 'PuzzleSolving', result: 'partial', target: 'mirrors', puzzleSteps: ['turn left mirror'], evidenceIds: ['old-clue'] }] };
  const task = { desc: 'Align both mirrors.', actionKind: 'solve_puzzle', status: 'In Progress' };
  C.rememberCommit(f.state, 'turn left mirror', initial, { questAttempted: true }, f.text(), f.text(), task);
  const evidence = C.exportRecords(f.state)[0];
  assert.equal(evidence.kind, 'puzzle'); assert.equal(evidence.authority, 'adjudicated'); assert.match(evidence.text, /partial/);
  assert.match(evidence.text, /turn left mirror/); assert.equal(task.status, 'In Progress');
  assert.match(C.prompt(C.context(f.state, 'mirrors', f.text(), task)), /cannot override the CURRENT Game Console/);
});
test('origin profiles are stable, private, run-persistent memory metadata rather than sheet fields', () => {
  const f = fixture(), events = [], profile = Profiles.create({ Name: 'Zharok', Race: 'Elf', Class: 'Mason' }, 'run');
  C.rememberProfiles(f.state, [profile], event => events.push(event));
  const before = JSON.stringify(C.exportRecords(f.state));
  f.setText(f.text().replace('Turns: 10', 'Turns: 11')); C.rememberProfiles(f.state, [profile]);
  assert.equal(JSON.stringify(C.exportRecords(f.state)), before);
  const context = C.context(f.state, 'hello Zharok', f.text());
  assert.equal(context.profiles[0].name, 'Zharok'); assert.ok(context.profiles[0].background.history);
  assert.deepEqual(C.exportRecords(f.state)[0].witnesses, ['Zharok']);
  assert.equal(events[0].type, 'campaign_memory');
  assert.doesNotMatch(f.text(), /personality|history|originProfile/);
});
test('room history remains first-class retrieved evidence with its original room and source', () => {
  const f = fixture(); C.rememberRoomHistory(f.state, 'read the inscription', 'The west bell bears a silver crescent.', f.text());
  const context = C.context(f.state, 'silver crescent', f.text());
  assert.ok(context.roomHistory.length); assert.equal(context.evidence[0].roomKey, '1,0,0');
  assert.equal(context.evidence[0].source, 'room-turn-narrative');
  assert.ok(JSON.stringify(context).length <= M.MAX_CONTEXT);
});
test('the protected chatbotprocessinput implementation is unchanged by memory transport hooks', () => {
  const source = fs.readFileSync('assets/game.js', 'utf8'), start = source.indexOf('async function chatbotprocessinput(');
  const end = start + 1 + source.slice(start + 1).search(/^(?:async )?function /m);
  assert.equal(require('node:crypto').createHash('sha256').update(source.slice(start, end)).digest('hex'),
    '4e7cd886c605d1093585b51fe3399810656a6f440f5086bb0aa9f6e041e1dfc4');
});
