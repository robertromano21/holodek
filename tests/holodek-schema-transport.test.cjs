'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const Host = require('../retort/pcModelHost');
const H = require('../retort/holodekStructured');
const Schema = require('../retort/structuredSchema');
const Contracts = require('../retort/generationContracts');
const root = path.resolve(__dirname, '..');
const row = { name: { type: String, minLength: 1, maxLength: 12 } };
const parameters = {
  regions: { type: [{ type: row }], minItems: 4, maxItems: 4 },
  factions: { type: [{ type: row }], minItems: 4, maxItems: 4 }
};
const answer = () => ({ regions: [1, 2, 3, 4].map(i => ({ name: 'Region ' + i })),
  factions: [1, 2, 3, 4].map(i => ({ name: 'Faction ' + i })) });
function fixture(value, { id = 'holodek-1', structured = true } = {}) {
  const requests = [], reports = [], chunks = [];
  const host = Host.createHost({ fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, text: async () => JSON.stringify({ model: 'holodek-1',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }] }) };
  } });
  const client = id === 'holodek-1' ? Host.modelClient(host) : { chat: { completions: { create: async body => {
    requests.push(body);
    return (async function* () {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'answer', arguments: JSON.stringify(value) } }] }, finish_reason: 'tool_calls' }] };
    })();
  } } } };
  const profile = { id, ...(id === 'holodek-1' ? { local: 'ollama' } : {}) };
  const models = { profile: () => profile, getLocalClient: () => client, getClient: () => client };
  const file = path.join(root, 'retort/modelTransport.js'), native = createRequire(file), module = { exports: {} };
  const stubs = { './gameModels': models, './settingLayer': { applyBody: body => body },
    './generationDiagnostics': { report: (...args) => reports.push(args) } };
  vm.runInThisContext('(function(require,module,exports,__dirname){\n' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })
    (id => Object.hasOwn(stubs, id) ? stubs[id] : native(id), module, module.exports, path.dirname(file));
  const collect = async () => {
    for await (const chunk of module.exports.stream({ model: id, strictParameters: true, ...(structured ? { parameters } : {}) },
      [{ role: 'user', content: 'Choose the campaign geography.' }], { models, client })) chunks.push(chunk);
    return chunks.map(chunk => chunk.contentDelta).join('');
  };
  return { requests, reports, chunks, collect };
}

test('PC holodek-1 receives exact response grammar, required keys and cardinalities without tool calls', async () => {
  const value = answer(), f = fixture(value);
  assert.deepEqual(JSON.parse(await f.collect()), value);
  const body = f.requests[0], format = body.response_format;
  assert.equal(body.model, 'holodek-1'); assert.equal(body.stream, false);
  assert.equal(body.tools, undefined); assert.equal(body.tool_choice, undefined);
  assert.equal(format.type, 'json_schema'); assert.equal(format.json_schema.name, 'answer');
  assert.equal(format.json_schema.strict, true);
  assert.deepEqual(format.json_schema.schema.required, ['regions', 'factions']);
  assert.equal(format.json_schema.schema.additionalProperties, false);
  for (const key of ['regions', 'factions']) {
    assert.equal(format.json_schema.schema.properties[key].minItems, 4);
    assert.equal(format.json_schema.schema.properties[key].maxItems, 4);
  }
  assert.equal(f.chunks.filter(chunk => chunk.contentDelta).length, 1);
});

test('Luna retains its existing tool-call schema rather than the local response grammar', async () => {
  const f = fixture(answer(), { id: 'gpt-6-luna' });
  assert.deepEqual(JSON.parse(await f.collect()), answer());
  assert.equal(f.requests[0].response_format, undefined);
  assert.equal(f.requests[0].tools[0].function.strict, true);
  assert.equal(f.requests[0].tool_choice.function.name, 'answer');
});

test('unstructured PC narration does not acquire a JSON response grammar', async () => {
  const f = fixture('The wind crosses the ash.', { structured: false });
  assert.equal(await f.collect(), JSON.stringify('The wind crosses the ash.'));
  assert.equal(f.requests[0].response_format, undefined);
});

test('the reported world/regions failure names the missing key without accepting invented collections', async () => {
  const value = answer(), f = fixture({ world: value.regions, factions: value.factions });
  await assert.rejects(f.collect(), error => {
    assert.match(error.message, /\$\.regions: required field missing/);
    assert.ok(error.message.length < 220); return true;
  });
  assert.equal(f.chunks.map(chunk => chunk.contentDelta).join(''), '');
  assert.equal(JSON.parse(f.reports.at(-1)[1].response).regions, undefined);
});

for (const [label, change, pattern] of [
  ['short region list', value => { value.regions.pop(); }, /\$\.regions: expected at least 4 items; received 3/],
  ['extra faction', value => { value.factions.push({ name: 'Fifth' }); }, /\$\.factions: expected at most 4 items; received 5/],
  ['unexpected root field', value => { value.world = []; }, /\$\.world: unexpected field/],
  ['unexpected nested field', value => { value.regions[2].underworld = 'unsupported'; }, /\$\.regions\[2\]\.underworld: unexpected field/],
  ['wrong nested type', value => { value.regions[1].name = 3; }, /\$\.regions\[1\]\.name: expected string; received number/],
  ['long nested name', value => { value.regions[1].name = 'x'.repeat(20); }, /\$\.regions\[1\]\.name: expected at most 12 characters; received 20/]
]) test('invalid local JSON is never emitted before rejection: ' + label, async () => {
  const value = answer(); change(value); const f = fixture(value);
  await assert.rejects(f.collect(), pattern);
  assert.equal(f.chunks.map(chunk => chunk.contentDelta).join(''), '');
});

test('legacy repairs cannot fabricate missing arrays or nullable object collections', () => {
  const value = {}, schema = { type: 'object', properties: { regions: { type: 'array', items: { type: 'string' } },
    maybe: { type: ['array', 'null'], items: { type: 'string' } }, settings: { type: ['object', 'null'], properties: {} } },
    required: ['regions', 'maybe', 'settings'] };
  assert.deepEqual(H.repair(value, schema), []); assert.deepEqual(value, {});
});

test('campaign atlas prompt and provider schema require the same named four-region/faction structure', async () => {
  const C = require('../retort/campaignSetting'), prompts = []; let options, data = '{}';
  const $ = { user: async (strings, ...values) => prompts.push(String.raw({ raw: strings }, ...values)),
    assistant: { generation: async input => {
      options = input;
      return { content: JSON.stringify({ regions: C.REGIONS, factions: C.FACTIONS }) };
    } } };
  const state = { getDungeonRunId: () => 'schema-offline-run', getRoomNameDatabase: () => data, setRoomNameDatabase: value => { data = value; } };
  const atlas = await C.prepareAtlas($, state);
  assert.equal(atlas.source, 'validated-campaign-plan'); assert.equal(options.strictParameters, true);
  const schema = Schema.toJSON(options.parameters);
  for (const key of ['regions', 'factions']) {
    assert.equal(schema.properties[key].minItems, 4); assert.equal(schema.properties[key].maxItems, 4);
  }
  const trades = schema.properties.regions.items.properties.livelihoods;
  assert.equal(trades.minItems, 2); assert.equal(trades.maxItems, 3);
  assert.ok(prompts.some(text => /exactly the root keys "regions" and "factions"/.test(text)));
});

test('missing-collection error reaches the existing corrected-answer retry without a default atlas', async () => {
  const prompts = []; let attempts = 0;
  const $ = { user: async (strings, ...values) => prompts.push(String.raw({ raw: strings }, ...values)),
    assistant: { generation: async () => {
      attempts++;
      const value = answer(), f = fixture(attempts === 1 ? { world: value.regions, factions: value.factions } : value);
      return { content: await f.collect() };
    } } };
  const result = await Contracts.request($, { component: 'offline-schema-regression', parameters });
  assert.equal(attempts, 2); assert.deepEqual(result.value, answer());
  assert.match(prompts[0], /\$\.regions: required field missing/);
  assert.doesNotMatch(prompts[0], /expected \{"type"/);
});

for (const local of [true, false]) test('retry instructions match the actual ' + (local ? 'local JSON' : 'cloud tool-call') + ' transport', async () => {
  const file = path.join(root, 'retort/generationContracts.js'), native = createRequire(file), module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){\n' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })
    (id => id === './graveMasterStoryPrompts' ? { isHolodek1: () => local } : native(id), module, module.exports);
  let count = 0; const prompts = [];
  const $ = { user: async (strings, ...values) => prompts.push(String.raw({ raw: strings }, ...values)),
    assistant: { generation: async () => {
      if (++count === 1) throw Error('The returned JSON does not match the answer schema: $.regions: required field missing');
      return { content: '{"regions":[]}' };
    } } };
  const result = await module.exports.request($, { component: 'offline-retry-format', parameters: {} });
  assert.deepEqual(result.value, { regions: [] });
  if (local) {
    assert.match(prompts[0], /as one JSON object matching the requested schema/);
    assert.match(prompts[0], /Do not call a function or wrap the JSON in a string/);
    assert.doesNotMatch(prompts[0], /through the requested Retort answer function/);
  } else assert.match(prompts[0], /through the requested Retort answer function/);
});

test('city grammar uses engine bearings and templates and exactly one result per planned city', async () => {
  const key = 'HOLODEK_CITY_PLACEMENT', previous = process.env[key];
  process.env[key] = '1';
  try {
    const C = require('../retort/campaignSetting'), Map = require('../retort/campaignMap'); let options;
    const $ = { user: async () => {}, assistant: { generation: async input => {
      options = input;
      return { content: JSON.stringify({ cities: [{ bearing: 'east', distance: 3, underground: false, template: 'market' }] }) };
    } } };
    await C.placeCitiesWithModel($, 'offline-city-schema', { cities: [{ id: 'city', name: 'Example', region: 'Region' }] });
    const cities = Schema.toJSON(options.parameters).properties.cities;
    assert.equal(cities.minItems, 1); assert.equal(cities.maxItems, 1);
    assert.deepEqual(cities.items.properties.bearing.enum, Object.keys(Map.BEARINGS));
    assert.deepEqual(cities.items.properties.template.enum, Object.values(Map.CITY_TEMPLATES).flat());
    assert.ok(!cities.items.properties.template.enum.includes('city'));
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});
