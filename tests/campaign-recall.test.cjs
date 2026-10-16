'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const M = require('../assets/campaignMemory'), C = require('../retort/campaignMemory');
const { tokenizer, pool } = require('../retort/memoryEmbeddingWorker');
const { createService } = require('../retort/memorySemantic');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
const audience = ['Mortacia', 'Iven Sootleaf', 'Vessa Reedwake', 'Orro Flintcup', 'Tarn Vell'];
const record = (id, text, extra = {}) => ({ id, text, runId: 'run', roomKey: '0,0,0', roomName: 'Ruined Temple Entrance',
  kind: 'dialogue', authority: 'statement', source: 'subtitle-displayed', speaker: 'Tarn Vell', actors: ['Tarn Vell'],
  witnesses: audience, turn: 9, at: 90, ...extra });
function episodes() {
  const rows = [record('choice-input', 'Ask Tarn whether to join our journey or stay behind.', {
    kind: 'player-input', source: 'player-command', speaker: 'Mortacia', actors: ['Mortacia'] }),
  record('choice', 'Tarn Vell says, "I will stay. Someone should keep watch here while you are gone." Tarn remains at his post.', {
    kind: 'room-history', authority: 'reported', source: 'room-turn-narrative', speaker: '', witnesses: ['Mortacia'], at: 91 }),
  record('farewell-input', 'Say farewell to Tarn, the temple guardian.', { kind: 'player-input', source: 'player-command', turn: 29, at: 290 }),
  record('farewell', 'Tarn stays at his post. The others leave the ruined temple after bidding him farewell.', {
    kind: 'room-history', authority: 'reported', source: 'room-turn-narrative', turn: 29, at: 291, speaker: '', witnesses: ['Mortacia'] }),
  record('private', 'The assassin buried the stolen sapphire behind the ruined temple.', {
    witnesses: ['Distant Assassin'], actors: ['Distant Assassin'], speaker: 'Distant Assassin' })];
  for (let i = 30; i < 80; i++) rows.push(record(`chatter-${i}`, 'The market has good bread today.', { turn: i, roomKey: '1,1,0' }));
  return rows;
}
function stateFor(records = episodes()) {
  const ledger = { runId: 'run', records };
  const sheet = name => formatStartingCharacterSheet({ Name: name, HP: 20, MaxHP: 20, Level: 1, Class: 'Wizard', Race: 'Human' });
  const consoleText = `Room Name: Spring\nCoordinates: X: 1, Y: 1, Z: 0\nPC:\n${sheet('Mortacia')}\nNPCs in Party:\n${audience.slice(1, 4).map(sheet).join('\n')}\nMonsters in Room: None\nTurns: 80`;
  return { getDungeonRunId: () => 'run', getCampaignMemory: () => ledger, getUpdatedGameConsole: () => consoleText,
    getCombatCharactersString: () => '[]' };
}

test('cryptic departure recall recovers the shared encounter and answer without a supplied name', () => {
  const state = stateFor(), query = 'Who did we leave behind at the ruined temple?';
  const result = C.context(state, query, state.getUpdatedGameConsole(), null, { trace() {} });
  assert.match(result.evidence[0].text, /Tarn/);
  for (const name of audience.slice(1, 4)) {
    const recall = result.memories.find(row => row.name === name);
    assert.ok(recall.evidenceIds.some(id => /Tarn/.test(result.evidence.find(row => row.id === id).text)));
    assert.ok(result.connections.find(row => row.name === name).sharedEncountersWith.includes('Tarn Vell'));
  }
  assert.ok(!JSON.stringify(result).includes('sapphire'));
  assert.ok(JSON.stringify(result).length <= M.MAX_CONTEXT);
});

test('legacy witness repair uses the historical audience, never recruits or nearby residents from a later room', () => {
  const index = M.createIndex('run', episodes());
  assert.deepEqual(index.get('choice').witnesses, audience);
  assert.ok(index.search('stay behind', { owner: 'Iven Sootleaf' }).some(row => row.id === 'choice'));
  assert.deepEqual(index.search('stay behind', { owner: 'Nera Quill' }), []);
  const privateRows = M.createIndex('run', [record('unwitnessed', 'Tarn stayed.', {
    source: 'room-turn-narrative', kind: 'room-history', authority: 'reported', witnesses: ['Mortacia'] })]);
  assert.deepEqual(privateRows.search('Tarn', { owner: 'Iven Sootleaf' }), []);
  const earlier = M.createIndex('run', [record('early', 'A private conversation before Iven arrived.', {
    source: 'room-turn-narrative', kind: 'room-history', authority: 'reported', witnesses: ['Mortacia'], at: 40 }),
  record('later', 'A later question in the same turn.', { kind: 'player-input', source: 'player-command', at: 90 })]);
  assert.deepEqual(earlier.get('early').witnesses, ['Mortacia']);
});

test('budgeted excerpts keep original evidence intact, including negation, and cannot replace full archived records', () => {
  const full = record('long', 'The corridor is quiet. '.repeat(35) + 'Tarn did not surrender the chronicle to the thief. ' + 'The corridor is quiet. '.repeat(15));
  const index = M.createIndex('run', [full]), before = index.get('long');
  const [excerpt] = index.search('Tarn surrender chronicle thief', { maxText: 160, maxChars: 900 });
  assert.equal(excerpt.excerpted, true); assert.match(excerpt.text, /did not surrender/);
  assert.equal(index.add(excerpt), null); assert.deepEqual(index.get('long'), before);
  assert.ok(JSON.stringify([excerpt]).length <= 900);
});

test('qualified hybrid recall adds paraphrases without displacing the keyword anchor or leaking a private encounter', () => {
  const index = M.createIndex('run', [record('exact', 'Tarn keeps watch at the temple.'),
    record('semantic', 'The gatekeeper elected to remain on duty.'), ...episodes().filter(row => row.id === 'private')]);
  const semantic = new Map([['private', .99], ['semantic', .9], ['exact', .3]]);
  const rows = index.search('Tarn temple', { semantic, qualified: true, actors: ['Iven Sootleaf'], maxChars: 2400 });
  assert.equal(rows[0].id, 'exact'); assert.ok(rows.some(row => row.id === 'semantic'));
  assert.ok(!rows.some(row => row.id === 'private'));
});

test('preparation limits local AI to qualified interactions and keeps the keyword path when the local encoder fails', async () => {
  const state = stateFor(); let candidates;
  await C.prepare(state, 'the old keeper', { semantic: { async rank(query, rows) { candidates = rows; return new Map([['choice', .8]]); } } });
  assert.ok(!candidates.some(row => row.id === 'private'));
  const traces = [];
  C.context(state, 'the old keeper', state.getUpdatedGameConsole(), null, { trace: value => traces.push(value) });
  assert.equal(traces[0].method, 'hybrid-local');
  await C.prepare(state, 'Who did we leave behind?', { semantic: { async rank() { throw Error('fixture encoder unavailable'); } } });
  const recalled = C.context(state, 'Who did we leave behind?', state.getUpdatedGameConsole(), null, { trace() {} });
  assert.ok(recalled.evidence.some(row => /Tarn/.test(row.text)));
});

test('import preserves episode topic and console turn without granting every character sheet witnessing rights', () => {
  const rows = M.historyRecords({ runId: 'run', conversationId: 'story', id: 1,
    gameConsole: 'Coordinates: X: 0, Y: 0, Z: 0\nPC: Mortacia\nTurns: 29',
    prompt: '$.user `Say farewell to the keeper.`', response: '$.assistant `Tarn promises to keep watch.`' },
  { runId: 'run', conversationId: 'story' });
  assert.ok(rows.every(row => row.turn === 29 && JSON.stringify(row.witnesses) === '["Mortacia"]'));
  assert.equal(rows.find(row => row.kind === 'room-history').topic, 'Say farewell to the keeper.');
  const source = fs.readFileSync(require.resolve('../assets/game.js'), 'utf8');
  assert.doesNotMatch(source, /performDynamicSearch\(combinedHistory\)/);
});

test('an engine handoff has separate committed evidence from an earlier promise and no invented distant witnesses', async () => {
  const state = stateFor();
  const receipt = { id: 'receipt', source: 'engine-give-item-v1', roomKey: '0,0,0',
    giver: 'Mortacia', recipient: 'Tarn Vell', item: 'chronicle', at: 200, turn: 20, witnesses: ['Mortacia', 'Iven Sootleaf'] };
  C.rememberTransfer(state, receipt);
  const event = C.exportRecords(state).find(row => row.id === 'transfer:receipt');
  assert.equal(event.authority, 'state'); assert.equal(event.kind, 'activity');
  assert.deepEqual(event.witnesses, ['Mortacia', 'Tarn Vell', 'Iven Sootleaf']);
  assert.match(event.text, /gave chronicle to Tarn/);
  assert.ok(!event.witnesses.includes('Vessa Reedwake'));
  assert.equal(event.roomName, '', 'A historical transfer must not receive the name of the current room.');
  state.getRoomNameDatabase = () => JSON.stringify({ '0,0,0': { itemTransfers: [receipt] } });
  await C.prepare(state, 'chronicle', { semantic: { async rank() { return new Map(); } } });
  assert.equal(C.exportRecords(state).filter(row => row.id === 'transfer:receipt').length, 1);
});

test('BERT tokenization and attention-masked mean pooling match the local model contract', () => {
  const encode = tokenizer('[PAD]\n[UNK]\n[CLS]\n[SEP]\nhello\nworld\n##s\n!\n');
  assert.deepEqual(encode('Hello worlds!'), [2, 4, 5, 6, 7, 3]);
  const [pooled] = pool(new Float32Array([2, 0, 0, 2, 100, 100]), [1, 3, 2], [1, 1, 0]);
  assert.ok(Math.abs(pooled[0] - Math.SQRT1_2) < .00001 && Math.abs(pooled[1] - Math.SQRT1_2) < .00001);
});

test('local vectors are cached on disk and reused across service instances without an API call', async t => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-memory-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  let encoded = 0;
  const embed = async texts => { encoded += texts.length; return texts.map(() => [1, ...Array(383).fill(0)]); };
  const rows = [record('one', 'A keeper guards the book.')], logger = { info() {} };
  const service = createService({ cacheDir, embed, logger });
  assert.equal((await service.rank('the guardian', rows)).get('one'), 1);
  assert.equal(encoded, 2);
  const reopened = createService({ cacheDir, embed, logger });
  await reopened.rank('the guardian', rows); assert.equal(encoded, 2);
});

test('planning recall uses qualified semantic episodes without replacing the response query or treating claims as state', async () => {
  const state = stateFor(); state.getCurrentQuest = () => 'Investigate the missing guardian.';
  await C.prepare(state, 'Tarn', { semantic: { async rank() { return new Map([['choice', .8]]); } } });
  let candidates, query;
  const result = await C.planningContext(state, 'future campaign continuity', { details: 'a guardian who stayed behind',
    semantic: { async rank(q, rows) { query = q; candidates = rows; return new Map([['choice', .9]]); } } });
  assert.match(query, /missing guardian/); assert.ok(!candidates.some(row => row.id === 'private'));
  assert.ok(result.evidence.some(row => row.id === 'choice')); assert.ok(!JSON.stringify(result).includes('sapphire'));
  assert.ok(JSON.stringify(result).length <= 3600);
  assert.match(C.prompt(result), /not proof/);
  let trace;
  C.context(state, 'Tarn', state.getUpdatedGameConsole(), null, { trace: t => trace = t });
  assert.equal(trace.method, 'hybrid-local');
});

test('planning recall times out to keyword results and rejects a late answer from a previous campaign', async () => {
  const state = stateFor(), result = await C.planningContext(state, 'Tarn temple', { waitMs: 1,
    semantic: { rank: () => new Promise(() => {}) } });
  assert.ok(result.evidence.some(row => /Tarn/.test(row.text)));
  let resolve;
  const pending = C.planningContext(state, 'old campaign', { waitMs: 100, semantic: { rank: () => new Promise(r => resolve = r) } });
  await new Promise(r => setImmediate(r)); state.getDungeonRunId = () => 'different-run'; resolve(new Map([['choice', .9]]));
  assert.deepEqual((await pending).evidence, []);
});

test('empty planning history does not start or queue a semantic model job', async () => {
  const state = stateFor(); state.getCampaignMemory = () => ({ runId: state.getDungeonRunId(), records: [] });
  let calls = 0;
  const result = await C.planningContext(state, 'new campaign', { semantic: { async rank() { calls++; return new Map(); } } });
  assert.equal(calls, 0); assert.deepEqual(result.evidence, []);
});
