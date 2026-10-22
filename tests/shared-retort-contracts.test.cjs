'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { createRequire } = require('node:module');
const C = require('../retort/generationContracts'), Policy = require('../retort/generationPolicy');
const Schema = require('../retort/structuredSchema'), Transport = require('../retort/modelTransport');
const Repair = require('../retort/generationRepair'), Models = require('../retort/gameModels');
const Puzzle = require('../assets/physicalPuzzles'), Art = require('../assets/surfaceArt');
const Contract = require('../retort/puzzleContract'), Dialogue = require('../retort/characterDialogue');
const { templateContent } = require('retort-js/dist/message');
test('nonblank text agrees under substring and whole-string provider pattern semantics', () => {
  const schema = Schema.toJSON({ line: C.nonblankText() }).properties.line;
  const substring = new RegExp(schema.pattern), whole = new RegExp('^(?:' + schema.pattern + ')$');
  for (const value of ['A full authored sentence.', '  A name with spaces  ', 'A multi\nline remark.', 'X']) {
    assert.ok(substring.test(value)); assert.ok(whole.test(value));
  }
  for (const value of ['', ' ', '\n\t']) { assert.equal(substring.test(value), false); assert.equal(whole.test(value), false); }
});
function route(id, answer) {
  const calls = [], prompts = [], local = id === 'holodek-1';
  const client = { chat: { completions: { create: async body => {
    calls.push(body);
    const value = await answer(body, calls.length);
    return (async function* () {
      yield { choices: [{ delta: local ? { content: JSON.stringify(value) } : { tool_calls: [{ index: 0, function: { name: 'answer', arguments: JSON.stringify(value) } }] },
        finish_reason: local ? 'stop' : 'tool_calls' }] };
    })();
  } } } };
  const profile = { id, ...(local ? { local: 'ollama' } : id === 'xai-fixture' ? { provider: 'xai' } : {}) };
  const models = { profile: () => profile, getLocalClient: () => client, getClient: () => client, getXaiClient: () => client };
  const file = require.resolve('../retort/modelTransport'), native = createRequire(file), mod = { exports: {} };
  const stubs = { './gameModels': models, './settingLayer': { applyBody: body => body }, './generationDiagnostics': { report() {} } };
  vm.runInThisContext('(function(require,module,exports,__dirname){\n' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })
    (name => stubs[name] || native(name), mod, mod.exports, path.dirname(file));
  const agent = { user: (parts, ...values) => prompts.push(typeof parts === 'string' ? parts : templateContent(parts, ...values)), system() {}, assistant: {
    async generation(settings) {
      let content = '';
      for await (const chunk of mod.exports.stream({ ...settings, model: id, strictAnswer: true }, [], { models, client })) content += chunk.contentDelta;
      return { content };
    }
  } };
  return { agent, calls, prompts };
}
for (const id of ['gpt-6-luna', 'xai-fixture', 'holodek-1']) {
  test(id + ': schema errors repair only the invalid nested remark and preserve accepted siblings', async () => {
    const parameters = { title: C.text(80), replies: { type: C.list({ speaker: C.choice(['Veyra']), lines: { type: [C.wordText()], minItems: 2, maxItems: 2 } }), minItems: 1, maxItems: 1 } };
    const long = Array.from({ length: 21 }, (_, n) => 'word' + n).join(' ');
    const first = { title: 'The Saved Story', replies: [{ speaker: 'Veyra', lines: ['Keep this exact thought.', long] }] };
    const f = route(id, (_body, n) => n === 1 ? first : { fix_0: n === 2 ? long : 'A new, shorter thought.' });
    const result = await C.request(f.agent, { component: 'cross-route', parameters });
    assert.ok(result.value, result.error?.message); assert.equal(f.calls.length, 3);
    assert.equal(result.value.title, first.title); assert.equal(result.value.replies[0].speaker, 'Veyra');
    assert.equal(result.value.replies[0].lines[0], first.replies[0].lines[0]);
    assert.equal(result.value.replies[0].lines[1], 'A new, shorter thought.');
    for (const body of f.calls.slice(1)) {
      const schema = body.response_format?.json_schema.schema || body.tools[0].function.parameters;
      assert.deepEqual(Object.keys(schema.properties), ['fix_0']);
    }
    assert.match(f.prompts[0], /\$\.replies\[0\]\.lines\[1\]/);
    assert.match(f.prompts[0], /Veyra/); assert.match(f.prompts[0], /word20/);
    assert.deepEqual(first.replies[0].lines, ['Keep this exact thought.', long], 'Rejected input is not mutated.');
    assert.equal(!!f.calls[0].response_format, id === 'holodek-1');
    assert.equal(f.calls[0].tools?.[0]?.function.strict, id === 'holodek-1' ? undefined : true);
  });
}
for (const successAt of [1, 2, 3, 4, Infinity]) test('shared recovery budget: success at ' + successAt, async () => {
  let calls = 0;
  const a = { user() {}, assistant: { generation: async () => ({ content: ++calls < successAt ? '{broken' : '{"name":"Accepted"}' }) } };
  const result = await C.request(a, { component: 'budget', parameters: { name: C.text(30) } });
  assert.equal(calls, Math.min(successAt, 4)); assert.equal(!!result.value, successAt <= 4);
});
test('nested request scopes share one four-attempt budget; a new operation gets its own budget', async () => {
  let calls = 0;
  const a = { user() {}, assistant: { generation: async () => { calls++; return { content: '{broken' }; } } };
  const options = { component: 'same-unit', context: { room: '1,0,0' }, parameters: { value: String } };
  await Policy.scope(async () => { for (let n = 0; n < 4; n++) await C.request(a, options); });
  assert.equal(calls, 4);
  await C.request(a, options); assert.equal(calls, 8);
});
for (const error of [Object.assign(Error('cancelled'), { name: 'AbortError' }), Object.assign(Error('bad key'), { status: 401 }),
  Object.assign(Error('quota'), { status: 429 }), Object.assign(Error('stale run'), { code: 'STALE_RUN' }),
  Object.assign(Error('provider down'), { code: 'MODEL_UNAVAILABLE' }), Error('The game model declined this response.')]) {
  test('no blind retry for ' + error.message, async () => {
    let calls = 0;
    const result = await C.request({ user() {}, assistant: { generation: async () => { calls++; throw error; } } },
      { component: 'permanent', parameters: { name: String } });
    assert.equal(calls, 1); assert.equal(result.error, error); assert.equal(result.value, null);
    assert.equal(Policy.recoverable(error, 'validation'), false, 'An outer validation wrapper cannot retry a permanent error.');
  });
}
test('transport issues identify multiple precise fields and reject fractional integer constraints', () => {
  for (const message of ['provider unavailable', 'Connection error', 'no OpenAI client / API key'])
    assert.equal(Policy.recoverable(Error(message), 'validation'), false);
  const schema = { type: 'object', required: ['count', 'line'], properties: { count: { type: 'number', multipleOf: 1 }, line: { type: 'string', minLength: 1 } } };
  assert.equal(Transport.matches({ count: 1.5, line: '' }, schema), false);
  assert.deepEqual(Transport.issues({ count: 1.5, line: '' }, schema).map(row => row.path), ['$.count', '$.line']);
});
test('targeted correction paths cannot edit prototypes, overlapping parents or unknown fields', () => {
  const parameters = { keep: String, nested: C.object({ line: String }) }, candidate = { keep: 'Exact', nested: { line: 'Bad' } };
  for (const paths of [['$.__proto__.polluted'], ['$.nested', '$.nested.line'], ['$.missing']])
    assert.equal(Repair.prepare(parameters, candidate, paths.map(path => ({ path }))), null);
  assert.equal({}.polluted, undefined);
});
test('malformed correction fields cannot discard the retained plan or rewrite its accepted title', async () => {
  const f = route('gpt-6-luna', (_body, count) => count === 1 ? { title: 'Keep this title.', note: '' } :
    count === 2 ? { fix_0: 'A valid note.', title: 'Malicious replacement.' } : { fix_0: 'The accepted authored note.' });
  const result = await C.request(f.agent, { component: 'preserved-plan', parameters: { title: C.text(80), note: C.nonblankText(80) } });
  assert.equal(f.calls.length, 3); assert.equal(result.value.title, 'Keep this title.');
  assert.equal(result.value.note, 'The accepted authored note.');
});
function artwork(kind) { return { kind, surface: 'wall', label: 'The Arrival', description: 'A newly arrived soul approaches the hall.', motifs: ['Moon'] }; }
test('art-kind schemas forbid inapplicable fields while valid examples pass the engine unchanged', () => {
  const p = Contract.parameters(Puzzle.fallback('shared', 'Temple')), schema = Schema.toJSON(p).properties.roomArt.items;
  for (const kind of ['fresco', 'mosaic', 'relief', 'inscription']) {
    const value = artwork(kind); assert.ok(Transport.matches(value, schema)); assert.equal(Art.validate([value])[0].kind, kind);
    const bad = { ...value, ...(kind === 'fresco' ? { mosaicShape: 'square' } : { aspectRatio: 2 }) };
    assert.equal(Transport.matches(bad, Transport.strictSchema(schema)), false);
    const issuePaths = Transport.issues(bad, Transport.strictSchema(schema)).map(row => row.path);
    assert.ok(issuePaths.includes(kind === 'fresco' ? '$.mosaicShape' : '$.aspectRatio'));
    assert.ok(!issuePaths.includes('$.kind'), 'A bad attribute cannot be repaired by changing the accepted art kind.');
    assert.throws(() => Art.validate([bad]));
  }
});
test('canonical figures never expose mortal identity overrides; ordinary figures use engine enums', () => {
  const p = Contract.parameters(Puzzle.fallback('shared', 'Temple')), row = p.roomArt.type[0].type.figures.type[0];
  const schema = Transport.strictSchema(Schema.toJSON({ figure: row })).properties.figure;
  const canonical = schema.anyOf.find(branch => branch.properties.subject.enum.includes('Mortacia'));
  for (const key of ['race', 'className', 'patron', 'sex']) assert.equal(canonical.properties[key], undefined);
  const ordinary = schema.anyOf.find(branch => !branch.properties.subject.enum.includes('Mortacia'));
  assert.ok(ordinary.properties.sex.enum.includes('Neutral')); assert.ok(!ordinary.properties.sex.enum.includes('Unknown'));
  assert.ok(ordinary.properties.race.enum.includes('Human'));
  const statue = Transport.strictSchema(Schema.toJSON({ row: p.sculptures.type[0] })).properties.row;
  assert.equal(statue.anyOf[0].properties.race, undefined); assert.equal(statue.anyOf[1].properties.deity, undefined);
});
test('mechanism counts and indexes match seeded kind rather than allowing impossible control states', () => {
  for (const kind of Object.keys(Puzzle.toolbox().mechanics)) {
    const brief = Puzzle.fallback('shared', 'Temple', { kind }), p = Contract.parameters(brief), schema = Schema.toJSON(p);
    const mechanics = Puzzle.toolbox().mechanics[brief.kind], control = schema.properties.controls.items;
    assert.equal(schema.properties.controls.minItems, brief.controls.length); assert.equal(schema.properties.controls.maxItems, brief.controls.length);
    assert.equal(control.properties.options.minItems, mechanics.positions); assert.equal(control.properties.options.maxItems, mechanics.positions);
    assert.equal(Transport.matches(mechanics.positions, control.properties.initial), false);
    assert.equal(Transport.matches(.5, control.properties.goal), false);
  }
});
test('art, documents and glyph bounds match existing engine counts and one-based chapter numbers', () => {
  const schema = Schema.toJSON(Contract.parameters(Puzzle.fallback('bounds', 'Temple'))).properties;
  for (const [key, maximum] of Object.entries({ glyphs: 12, roomArt: 6, sculptures: 2, shrines: 1, readables: 4, inscriptions: 4 }))
    assert.equal(schema[key].maxItems, maximum);
  const readable = schema.readables.items.properties;
  assert.equal(readable.chapters.minItems, 1); assert.equal(readable.chapters.maxItems, 3);
  assert.equal(Transport.matches(0, readable.clueChapter), false); assert.ok(Transport.matches(1, readable.clueChapter));
  assert.equal(Transport.matches(1.5, readable.modifiers.properties.magic), false);
  const glyph = schema.glyphs.items.properties.pixels;
  assert.equal(glyph.minItems, 7); assert.equal(glyph.maxItems, 7); assert.equal(glyph.items.pattern, '^[01]{7}$');
});
test('per-speaker cache allocations remain bounded when the roster reaches 32 characters', async () => {
  let parameters;
  await Dialogue.generateCharacterDialogue({ user() {}, system() {}, assistant: { generation: async settings => {
    parameters = settings.parameters; return { content: '{"spoken":[],"replies":[]}' };
  } } }, { characters: Array.from({ length: 32 }, (_v, n) => ({ name: 'Resident ' + n, partyMember: n === 0 })) });
  const variants = Schema.toJSON(parameters).properties.replies.items.anyOf;
  assert.equal(variants.length, 32);
  assert.equal(variants.reduce((sum, row) => sum + row.properties.lines.maxItems, 0), 64);
  for (const row of variants) { assert.equal(row.properties.speaker.enum.length, 1); assert.equal(row.properties.lines.minItems, 2); }
});
test('authoritative sex and pronouns survive compact character context without name-based guesses', () => {
  const rows = Dialogue.describeCharacters([{ name: 'Veyra', type: 'npc', hp: 10, sex: 'Male' }, { name: 'Sella', type: 'npc', hp: 5 }]);
  assert.equal(rows[0].sex, 'Male'); assert.equal(rows[0].pronouns, 'he/him');
  assert.match(rows[1].pronouns, /do not infer/);
});
test('logged 21-word cache remark is corrected by index, not truncated or regenerated as an entire cache', async () => {
  const before = Models.current().id; Models.restore('gpt-6-luna');
  try {
    const bad = Array.from({ length: 21 }, (_, n) => 'word' + n).join(' ');
    const accepted = ['Keep the first.', 'Keep the second.', 'Keep the third.', bad, 'Keep the fifth.', 'Keep the sixth.'];
    const f = route('gpt-6-luna', (_body, count) => count === 1 ? { spoken: [], replies: [{ speaker: 'Veyra Ashquiet', lines: accepted }], exchanges: null } : { fix_0: 'The shorter authored thought.' });
    const result = await Dialogue.generateCharacterDialogue(f.agent, { characters: [{ name: 'Veyra Ashquiet', partyMember: true }], roomDescription: 'The saved hall.' });
    assert.equal(f.calls.length, 2); assert.equal(result.replies[0].lines.length, 6);
    assert.deepEqual(result.replies[0].lines, accepted.map((line, n) => n === 3 ? 'The shorter authored thought.' : line));
    assert.match(f.prompts.at(-1), /\$\.replies\[0\]\.lines\[3\]/);
  } finally { Models.restore(before); }
});
