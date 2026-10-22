'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Host = require('../retort/pcModelHost'), Models = require('../retort/gameModels'), Runtime = require('../retort/gameRetort');
const C = require('../retort/generationContracts'), Schema = require('../retort/structuredSchema');
const { generateInhabitants } = require('../retort/inhabitantGeneration');
const Budget = require('../retort/holodekBudget');
const schema = { dialogue: { type: [C.nonblankText()], minItems: 3, maxItems: 3 } };
const remarks = ['Welcome to the ash garden.', 'These flowers open after the wind dies.', 'My sister taught me their names.'];
async function runtime(task, answer, model = 'holodek-1') {
  const requests = [], prior = Models.current().id;
  const host = Host.createHost({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    const message = await answer(body, requests.length);
    return { ok: true, text: async () => JSON.stringify({ model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', ...message } }] }) };
  } });
  const cloud = { chat: { completions: { create: async body => {
    requests.push(body); const message = await answer(body, requests.length);
    return (async function* () { yield { choices: [{ finish_reason: 'tool_calls', delta: { tool_calls: [{ index: 0,
      function: { name: 'answer', arguments: message.content } }] } }] }; })();
  } } } };
  const app = Runtime.createRuntime({ models: { ...Models, getLocalClient: () => Host.modelClient(host) }, client: cloud, log() {} });
  Models.restore(model);
  try { return { result: await app.run(app.retort(task), null, { shouldSaveToLog: false }), requests }; }
  finally { Models.restore(prior); }
}
const json = value => ({ content: JSON.stringify(value) });
const ask = $ => C.request($, { component: 'offline-strict-dialogue', parameters: schema, strictAnswer: true });
const wireSchema = body => body.response_format?.json_schema.schema || body.tools[0].function.parameters;

test('the actual inhabitant grammar survives Retort, strict schema, setting layer and PC wire on initial call and retry', async () => {
  const row = { ...require('./fixtures/inhabitants.cjs')(1)[0], name: 'Nera', homeSite: 'commons', encounterId: 'residents', allegiance: 'Friendly' };
  row.dialogue = remarks.slice();
  row.dialogue[0] += ' ' + 'The paths through these flowers belong to the living and the dead alike. '.repeat(12).trim();
  const { result, requests } = await runtime($ => generateInhabitants($, {
    roomName: 'Ruined Temple Entrance', roomDescription: 'An ash garden beside a ruined temple.', geoKey: '0,0,0', indoor: true
  }, { random: min => min, level: () => 1, sex: () => 'Female', xp: () => 0, equipment: async () => null }),
  (_body, index) => json(index === 1 ? { inhabitants: [{ ...row, dialogue: ['One combined remark.'] }] } : { fix_0: row.dialogue }));
  assert.equal(requests.length, 2);
  for (const body of requests.slice(0, 1)) {
    const top = wireSchema(body), inhabitant = top.properties.inhabitants.items;
    const dialogue = inhabitant.properties.dialogue;
    assert.equal(dialogue.minItems, 3); assert.equal(dialogue.maxItems, 3);
    assert.equal(dialogue.items.type, 'string'); assert.equal(dialogue.items.minLength, 1);
    assert.equal(dialogue.items.pattern, '[\\s\\S]*\\S[\\s\\S]*'); assert.equal(dialogue.items.maxLength, undefined);
    assert.ok(inhabitant.required.includes('dialogue')); assert.equal(inhabitant.additionalProperties, false);
    assert.equal(body.tools, undefined); assert.equal(body.strictAnswer, undefined);
    assert.ok(Budget.tally(body.messages, [{ response_format: body.response_format }]).total <= Budget.CEILING);
  }
  const repair = wireSchema(requests[1]);
  assert.deepEqual(Object.keys(repair.properties), ['fix_0']);
  assert.equal(repair.properties.fix_0.minItems, 3); assert.equal(repair.properties.fix_0.maxItems, 3);
  assert.equal(repair.properties.fix_0.items.pattern, '[\\s\\S]*\\S[\\s\\S]*');
  const correction = requests[1].messages.map(row => row.content).join('\n');
  assert.match(correction, /dialogue: expected at least 3 items; received 1/);
  assert.match(correction, /exactly 3 separate, nonblank authored remarks/);
  assert.match(correction, /Do not return one combined entry, duplicate a remark, pad missing entries/);
  assert.deepEqual(result.population.actors.Nera.dialogue, row.dialogue);
});

for (const [label, value, reason] of [
  ['zero', { dialogue: [] }, /received 0/], ['one', { dialogue: remarks.slice(0, 1) }, /received 1/],
  ['two', { dialogue: remarks.slice(0, 2) }, /received 2/], ['four', { dialogue: [...remarks, 'Another.'] }, /received 4/],
  ['empty', { dialogue: ['', ...remarks.slice(1)] }, /at least 1 characters/],
  ['whitespace', { dialogue: [' \n\t', ...remarks.slice(1)] }, /nonblank text required/],
  ['wrong item type', { dialogue: [null, ...remarks.slice(1)] }, /expected string/],
  ['missing', {}, /dialogue: required field missing/], ['wrong type', { dialogue: 'Three sentences.' }, /expected array/]
]) test('strict local JSON rejects ' + label + ' remarks on all four attempts without invention', async () => {
  const original = JSON.stringify(value), { result, requests } = await runtime(ask,
    body => json(wireSchema(body).properties.fix_0 ? { fix_0: value.dialogue[0] } : value));
  assert.equal(result.value, null); assert.equal(requests.length, 4); assert.match(result.error.message, reason);
  assert.equal(JSON.stringify(value), original);
  assert.equal(result.response, '');
});

test('three real remarks pass the unchanged cloud tool route and preserve array/item bounds', async () => {
  const { result, requests } = await runtime(ask, () => json({ dialogue: remarks }), 'gpt-6-luna');
  assert.deepEqual(result.value.dialogue, remarks); assert.equal(requests.length, 1);
  assert.equal(requests[0].response_format, undefined); assert.equal(requests[0].tools[0].function.strict, true);
  assert.deepEqual(wireSchema(requests[0]).properties.dialogue, Schema.toJSON(schema).properties.dialogue);
});

for (const channel of ['reasoning', 'reasoning_content']) test('strict authoring never promotes ' + channel + ' JSON to final content', async () => {
  const { result, requests } = await runtime(ask, () => ({ content: '', [channel]: JSON.stringify({ dialogue: remarks }) }));
  assert.equal(result.value, null); assert.equal(requests.length, 4); assert.match(result.error.message, /no final structured JSON/);
});

for (const content of ['Here is the answer: {"dialogue":["One","Two","Three"]}', '```json\n{"dialogue":["One","Two","Three"]}\n```'])
  test('strict authoring does not extract JSON from wrapped prose', async () => {
    const { result } = await runtime(ask, () => ({ content }));
    assert.equal(result.value, null); assert.match(result.error.message, /No extraction or repairs/);
  });

for (const [label, parameters, value] of [
  ['missing scalar', { approved: Boolean }, {}],
  ['invalid numeric enum', { choice: { type: Number, enum: [2, 4] } }, { choice: 3 }],
  ['short required text', { note: C.text(20) }, { note: '' }]
]) test('opt-in strict mode rejects ' + label + ' without changing legacy compatibility', async () => {
  const task = strictAnswer => $ => C.request($, { component: 'offline-strict-scalar', parameters, strictAnswer });
  const strict = await runtime(task(true), () => json(value));
  assert.equal(strict.result.value, null);
  const legacy = await runtime(task(false), () => json(value));
  assert.ok(legacy.result.value);
});

test('strict opt-in follows each bounded localWork part', async () => {
  const { result, requests } = await runtime($ => C.request($, { component: 'offline-strict-parts', strictAnswer: true,
    parameters: { approved: Boolean }, localWork: { brief: 'Choose whether this proposed action is approved.' } }), () => json({}));
  assert.equal(result.value, null); assert.equal(requests.length, 4); assert.match(result.error.message, /approved: required field missing/);
});

test('bounded localWork cannot replace an original array count with a conflicting dynamic count', async () => {
  const { result, requests } = await runtime($ => C.request($, { component: 'offline-conflict',
    parameters: { names: { type: [C.nonblankText()], minItems: 3, maxItems: 3 } },
    localWork: { brief: 'Author names.', arrays: { names: { count: 2 } } } }), () => assert.fail('Invalid bounds must fail before inference.'));
  assert.equal(result.value, null); assert.equal(requests.length, 0); assert.match(result.error.message, /conflicts with the original array bounds/);
});

test('inhabitant semantic correction also reports the received count when using a non-wire test adapter', async () => {
  const row = require('./fixtures/inhabitants.cjs')(1)[0], prompts = [];
  row.dialogue = ['One combined greeting.'];
  const $ = { user: async (parts, ...values) => prompts.push(require('retort-js/dist/message').templateContent(parts, ...values)),
    assistant: { generation: async () => json({ inhabitants: [row] }) } };
  await assert.rejects(generateInhabitants($, { roomName: 'Temple', roomDescription: 'A hall.', geoKey: '0,0,0', indoor: true },
    { random: () => 1 }), /requires three nonempty remarks; received 1 entries/);
  assert.match(prompts.at(-1), /3 separate nonblank entries/);
});
