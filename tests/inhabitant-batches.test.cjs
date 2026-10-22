'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const { templateContent } = require('retort-js/dist/message');
const { generateInhabitants } = require('../retort/inhabitantGeneration');
const { toJSON } = require('../retort/structuredSchema');
const fixtures = require('./fixtures/inhabitants.cjs');
const Runtime = require('../retort/gameRetort'), Models = require('../retort/gameModels');
const { batchRows, slotIds } = require('./fixtures/inhabitant-batch.cjs');
const context = { roomName: 'Ash Crossing', roomDescription: 'A road across the yellow-sky wasteland.',
  geoKey: '1,0,0', indoor: false, partyNames: ['Mortacia'], usedNames: ['Old Watch'],
  campaignSetting: { region: 'Ashen Wastes', pressure: 'An old bridge is disputed.', livelihoods: ['memorial carving'] } };
const allRows = () => fixtures(16).map(row => ({ ...row, allegiance: 'Neutral', encounterId: 'locals', homeSite: 'commons' }));
function fixture(reply = ({ ids }) => ({ inhabitants: allRows().filter(row => ids.includes(row.slot)) }), overrides = {}) {
  const requests = [], branches = [], counters = { levels: 0, equipment: 0 };
  const agent = { run: async work => {
    const branch = { id: branches.length, prompts: [] }; branches.push(branch);
    return work({ user: (parts, ...values) => branch.prompts.push(templateContent(parts, ...values)), assistant: { generation: async options => {
      assert.equal(counters.levels, 0, 'No stats before the entire population validates.');
      assert.equal(counters.equipment, 0, 'No equipment before the entire population validates.');
      const schema = toJSON(options.parameters), ids = schema.properties.inhabitants.items.properties.slot.enum;
      const request = { ids, options, branch, schema, index: requests.length }; requests.push(request);
      const result = await reply(request);
      if (result instanceof Error) throw result;
      return { content: typeof result === 'string' ? result : JSON.stringify(result) };
    } } });
  } };
  const rules = { random: min => min, level: () => { counters.levels++; return 1; }, sex: () => 'Female', xp: () => 0,
    equipment: async () => { counters.equipment++; return null; }, ...overrides };
  return { requests, branches, counters, run: value => generateInhabitants(agent, { ...context, ...value }, rules) };
}

test('16 outdoor slots use four bounded requests, exact global IDs 0..15, with no intermediate state mutation', async () => {
  const rooms = { '0,0,0': { name: 'Old Temple', inhabitants: { actors: { 'Old Watch': { name: 'Old Watch' } } } } };
  const original = JSON.stringify(rooms), f = fixture(), result = await f.run({ rooms });
  assert.deepEqual(f.requests.map(request => request.ids), [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]]);
  assert.equal(new Set(f.requests.flatMap(request => request.ids)).size, 16); assert.equal(f.branches.length, 4);
  assert.equal(Object.keys(result.population.actors).length, 16); assert.equal(f.counters.levels, 16); assert.equal(JSON.stringify(rooms), original);
  for (const request of f.requests) {
    const array = request.schema.properties.inhabitants;
    assert.equal(array.minItems, 4); assert.equal(array.maxItems, 4); assert.equal(request.options.strictParameters, true);
    assert.equal(array.items.properties.race.enum, undefined, 'Ordinary races remain free-form.');
    assert.match(request.branch.prompts.join('\n'), /Ashen Wastes/);
    assert.match(request.branch.prompts.join('\n'), /memorial carving/);
    assert.match(request.branch.prompts.join('\n'), /there is no word-count limit/);
  }
  assert.match(f.branches[1].prompts.at(-1), /Resident 0/); assert.match(f.branches[3].prompts.at(-1), /Resident 11/);
});

test('every batch retains the original Tartarus paragraph byte for byte', async () => {
  const source = fs.readFileSync(require.resolve('../retort/inhabitantGeneration'), 'utf8');
  const paragraph = source.match(/These are fantasy races[^\r\n]+/)[0];
  const Pantheon = require('../assets/pantheonCharacters');
  const expected = paragraph.replace('${Pantheon.names.join(\', \')}', Pantheon.names.join(', '));
  const f = fixture(); await f.run();
  for (const branch of f.branches) assert.ok(branch.prompts[0].includes(expected));
  assert.match(expected, /Tartarus, a vast wasteland with a yellowish sky/);
  assert.match(expected, /Arithus never appears outside the final throne-room encounter/);
});

test('first batch timeout retries only its IDs once, on a fresh branch with a contextual reason', async () => {
  const f = fixture(request => request.index === 0 ? Error('The game model timed out after 120 seconds, response 0.') :
    { inhabitants: allRows().filter(row => request.ids.includes(row.slot)) });
  const result = await f.run();
  assert.equal(Object.keys(result.population.actors).length, 16); assert.equal(f.requests.length, 5);
  assert.deepEqual(f.requests.slice(0, 2).map(request => request.ids), [[0, 1, 2, 3], [0, 1, 2, 3]]);
  assert.notEqual(f.requests[0].branch.id, f.requests[1].branch.id);
  const retry = f.requests[1].branch.prompts.join('\n');
  assert.match(retry, /ONLY slots 0, 1, 2, 3 timed out/); assert.match(retry, /120 seconds, response 0/);
  assert.match(retry, /only this batch from this fresh conversation within its remaining recovery budget/); assert.match(retry, /Do not regenerate the 0 already accepted/);
});

test('later batch timeout never repeats accepted batches and carries their read-only identities', async () => {
  const f = fixture(request => request.index === 1 ? Object.assign(Error('request deadline exceeded'), { code: 'ETIMEDOUT' }) :
    { inhabitants: allRows().filter(row => request.ids.includes(row.slot)) });
  await f.run();
  assert.deepEqual(f.requests.map(request => request.ids[0]), [0, 4, 4, 8, 12]);
  assert.match(f.requests[2].branch.prompts.join('\n'), /Do not regenerate the 4 already accepted/);
  assert.match(f.requests[2].branch.prompts.join('\n'), /Resident 3/);
});

test('four transport timeouts stop with no manufactured population or stat allocation', async () => {
  const f = fixture(() => Error('The game model timed out.'));
  await assert.rejects(f.run(), /Inhabitant generation failed in Ash Crossing:.*timed out/);
  assert.equal(f.requests.length, 4); assert.equal(f.branches.length, 4); assert.deepEqual(f.counters, { levels: 0, equipment: 0 });
});

for (const reason of ['429 quota exceeded', 'The game model declined this response.', 'request cancelled', 'provider unavailable']) {
  test(reason + ' is not retried or treated as a malformed cast', async () => {
    const f = fixture(() => Error(reason)); await assert.rejects(f.run(), error => error.message.includes(reason));
    assert.equal(f.requests.length, 1); assert.equal(f.branches.length, 1); assert.equal(f.counters.levels, 0);
  });
}

for (const [name, mutate, expected] of [
  ['duplicate slot', rows => { rows[1].slot = rows[0].slot; }, /Unknown or duplicate inhabitant slot/],
  ['out-of-batch slot', rows => { rows[0].slot = 15; }, /Unknown or duplicate inhabitant slot/],
  ['invalid allegiance', rows => { rows[0].allegiance = 'Enemy'; }, /invalid allegiance/]
]) test(name + ' is never accepted, even after three bounded validation corrections', async () => {
  const f = fixture(request => { const rows = allRows().filter(row => request.ids.includes(row.slot)); mutate(rows); return { inhabitants: rows }; });
  await assert.rejects(f.run(), expected); assert.equal(f.requests.length, 4); assert.equal(f.branches.length, 1);
  assert.deepEqual(f.counters, { levels: 0, equipment: 0 });
});

test('a name accepted in an earlier batch cannot be reused; later failure leaves caller state unchanged', async () => {
  const rooms = { '1,0,0': { name: 'Ash Crossing', saved: 'unchanged' } }, before = JSON.stringify(rooms);
  const f = fixture(request => {
    const rows = allRows().filter(row => request.ids.includes(row.slot));
    if (request.ids[0] === 4) rows[0].name = 'Resident 0'; return { inhabitants: rows };
  });
  await assert.rejects(f.run({ rooms }), /duplicate or reserved name: Resident 0/);
  assert.deepEqual(f.requests.map(request => request.ids[0]), [0, 4, 4, 4, 4]); assert.equal(JSON.stringify(rooms), before);
  assert.deepEqual(f.counters, { levels: 0, equipment: 0 });
});

test('invalid supplemental race is rejected while exact catalog and creature metadata survive', async () => {
  const encounter = { count: 3, races: ['Allip'], catalog: [{ name: 'Allip', description: 'Tormented, babbling undead.' }] };
  const bad = fixture(request => ({ skip: false, inhabitants: allRows().filter(row => request.ids.includes(row.slot)) }));
  await assert.rejects(bad.run({ encounter }), /outside the encounter catalog/); assert.equal(bad.requests.length, 4);
  assert.equal(bad.counters.levels, 0);
  const good = fixture(request => ({ skip: false, inhabitants: allRows().filter(row => request.ids.includes(row.slot)).map(row => ({ ...row, race: 'Allip' })) }));
  const result = await good.run({ encounter }); assert.equal(Object.keys(result.population.actors).length, 3);
  assert.deepEqual(good.requests[0].schema.properties.inhabitants.items.properties.race.enum, ['Allip']);
  assert.match(good.branches[0].prompts[0], /Tormented, babbling undead/);
  assert.ok(Object.values(result.population.actors).every(actor => actor.race === 'Allip'));
});

test('single quest contact and unlimited long remarks survive all batches without new quest introductions', async () => {
  const greeting = 'Ask about the existing seal. ' + 'The old route may hold a clue worth discussing. '.repeat(60);
  const f = fixture(request => ({ inhabitants: allRows().filter(row => request.ids.includes(row.slot)).map(row => row.slot === 0 ?
    { ...row, allegiance: 'Friendly', dialogue: [greeting, 'My bridge.', 'My old friend.'] } : row) }));
  const result = await f.run({ quest: 'Find the forgotten seal.', questSeed: true });
  assert.equal(result.population.questIntroduction.speaker, 'Resident 0'); assert.equal(result.population.questIntroduction.hook, greeting.trim());
  assert.equal(result.population.actors['Resident 0'].allegiance, 'Friendly');
  assert.equal(result.population.actors['Resident 1'].allegiance, 'Neutral'); assert.equal(result.population.actors['Resident 2'].allegiance, 'Neutral');
  assert.match(f.branches[0].prompts[0], /single NEUTRAL or FRIENDLY quest contact/);
  for (const branch of f.branches.slice(1)) assert.match(branch.prompts[0], /No quest is being newly introduced here/);
});

test('an infeasible settlement batch exhausts three corrections before any mechanics are allocated', async () => {
  const f = fixture(request => ({ inhabitants: allRows().filter(row => request.ids.includes(row.slot)).map(row => ({ ...row, allegiance: 'Hostile' })) }));
  await assert.rejects(f.run({ campaignSetting: { village: { id: 'settlement', population: 'Quiet shades.' } } }), /majority of neutral/);
  assert.equal(f.requests.length, 6); assert.deepEqual(f.counters, { levels: 0, equipment: 0 });
});

for (const city of [false, true]) test((city ? 'civic non-hostile' : 'village neutral') + ' majority budget corrects the last batch without repeating accepted batches', async t => {
  const previous = process.env.HOLODEK_CITY_COMPLETE;
  process.env.HOLODEK_CITY_COMPLETE = '1';
  t.after(() => { if (previous === undefined) delete process.env.HOLODEK_CITY_COMPLETE; else process.env.HOLODEK_CITY_COMPLETE = previous; });
  const qualifying = city ? 'Friendly' : 'Neutral';
  const f = fixture(request => ({ inhabitants: allRows().filter(row => request.ids.includes(row.slot)).map(row => ({
    ...row, allegiance: row.slot < 8 || request.index === 4 && row.slot === 12 ? qualifying : 'Hostile'
  })) }));
  const result = await f.run({ campaignSetting: city ? { city: { population: { civilianMajority: true } } } :
    { village: { id: 'settlement', population: 'Quiet shades.' } } });
  assert.deepEqual(f.requests.map(request => request.ids[0]), [0, 4, 8, 12, 12]);
  assert.equal(f.branches.length, 4); assert.equal(f.requests[3].branch.id, f.requests[4].branch.id);
  assert.match(f.requests[3].branch.prompts.join('\n'), /at least 1 of these 4 residents must be/);
  assert.match(f.requests[4].branch.prompts.at(-1), /previous structured answer failed validation: This batch needs at least 1/);
  const actors = Object.values(result.population.actors);
  assert.equal(actors.filter(actor => city ? ['Neutral', 'Friendly'].includes(actor.allegiance) : actor.allegiance === 'Neutral').length, 9);
  assert.equal(actors.filter(actor => actor.allegiance === 'Hostile').length, 7);
  assert.equal(f.counters.levels, 16);
});

test('batch fixture honors numeric enums or min/max without hiding corrupted slot identities', () => {
  const rows = allRows(); rows[5].slot = 4;
  const options = slot => ({ parameters: { inhabitants: { type: [{ type: { slot } }] } } });
  assert.deepEqual(slotIds(options({ minimum: 4, maximum: 7 })), [4, 5, 6, 7]);
  const selected = batchRows(rows, options({ enum: [4, 5, 6, 7] }));
  assert.deepEqual(selected.map(row => row.slot), [4, 4, 6, 7]);
  assert.equal(selected[1], rows[5]); assert.equal(rows.length, 16);
});

test('starting and evil-temple allegiances remain authoritative across batch boundaries', async () => {
  const start = fixture(undefined, { random: (min, max) => max === 5 ? 4 : min });
  const friendly = await start.run({ geoKey: '0,0,0', indoor: true, quest: 'Find the seal.', questSeed: true });
  assert.equal(start.requests.length, 1); assert.equal(friendly.population.questIntroduction, undefined);
  assert.ok(Object.values(friendly.population.actors).every(actor => actor.allegiance === 'Friendly'));
  const temple = fixture(), hostile = await temple.run({ indoor: true, roomName: 'Evil Temple',
    campaignSetting: { siteKind: 'roman_temple', religion: { patron: 'Arithus' } } });
  assert.equal(temple.requests.length, 2); assert.ok(Object.values(hostile.population.actors).every(actor => actor.allegiance === 'Hostile'));
});

test('malformed later batch gets one correction without regenerating an accepted earlier batch', async () => {
  const f = fixture(request => {
    const rows = allRows().filter(row => request.ids.includes(row.slot));
    if (request.index === 1) rows[1].slot = rows[0].slot; return { inhabitants: rows };
  });
  const result = await f.run(); assert.equal(Object.keys(result.population.actors).length, 16);
  assert.deepEqual(f.requests.map(request => request.ids[0]), [0, 4, 4, 8, 12]);
  assert.equal(f.requests[1].branch.id, f.requests[2].branch.id);
  assert.match(f.requests[2].branch.prompts.at(-1), /previous structured answer failed validation/);
});

test('real Luna runtime isolates each bounded request and recovers a timed-out batch without a poisoned ancestor', async () => {
  const requests = [], client = { chat: { completions: { create: async request => {
    const ids = request.tools[0].function.parameters.properties.inhabitants.items.properties.slot.enum;
    requests.push({ ids, messages: request.messages });
    if (requests.length === 1) throw Error('The game model timed out.');
    const content = JSON.stringify({ inhabitants: allRows().filter(row => ids.includes(row.slot)) });
    return (async function* () { yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'cast', type: 'function', function: { name: 'answer', arguments: content } }] } }] };
      yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }; })();
  } } } };
  const models = Models.createModelService({ initial: 'gpt-6-luna', clientFor: () => client, localProbe: async () => [] });
  const runtime = Runtime.createRuntime({ models, client, log() {} });
  const original = 'Instructions for the Grave Master: Original lore must be preserved verbatim.';
  const result = await runtime.run(runtime.retort(async $ => {
    await $.user(original);
    return generateInhabitants($, context, { random: min => min, level: () => 1, sex: () => 'Female', xp: () => 0, equipment: async () => null });
  }), null, { shouldSaveToLog: false });
  assert.equal(Object.keys(result.population.actors).length, 16); assert.deepEqual(requests.map(request => request.ids[0]), [0, 0, 4, 8, 12]);
  assert.ok(requests.every(request => request.messages.every(message => message.role !== 'assistant')));
  assert.ok(requests.every(request => request.messages.filter(message => message.content === original).length === 1));
});
