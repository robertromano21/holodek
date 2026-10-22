'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../retort/generationContracts'), Host = require('../retort/pcModelHost');
const Models = require('../retort/gameModels'), Runtime = require('../retort/gameRetort');
const Work = require('../retort/holodekWork'), Budget = require('../retort/holodekBudget');
function answer(schema) {
  if (schema.enum) return schema.enum[0];
  const type = [].concat(schema.type).find(type => type !== 'null');
  if (type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([k, s]) => [k, answer(s)]));
  if (type === 'array') return Array.from({ length: schema.minItems || 0 }, () => answer(schema.items));
  if (type === 'number') return schema.minimum || 0;
  if (type === 'boolean') return false;
  return 'Authored';
}
async function replay(options, respond, work) {
  const bodies = [], before = Models.current().id;
  const host = Host.createHost({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    const value = await respond(body, bodies.length);
    return { ok: true, text: async () => JSON.stringify(value) };
  } });
  const runtime = Runtime.createRuntime({ models: { ...Models, getLocalClient: () => Host.modelClient(host) }, log() {} });
  Models.restore('holodek-1');
  try {
    const result = await runtime.run(runtime.retort($ => work ? work($) : C.request($, options)), null, { shouldSaveToLog: false });
    return { result, bodies };
  } finally { Models.restore(before); }
}
const completion = (content, finish = 'stop') => ({ model: 'holodek-1', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  choices: [{ finish_reason: finish, message: { role: 'assistant', content } }] });
const valid = body => completion(JSON.stringify(answer(body.response_format.json_schema.schema)));

test('empty local final retries the same bounded part without a fallback', async () => {
  const { result, bodies } = await replay({ component: 'empty-replay', parameters: { name: C.text(30) },
    localWork: { brief: 'Name this room.' } }, (body, n) => n === 1 ? completion('') : valid(body));
  assert.deepEqual(result.value, { name: 'Authored' }); assert.equal(bodies.length, 2);
  assert.equal(result.recovery.retryParts, 1);
});

test('native empty-limit failure retains finish and usage without exposing reasoning', async () => {
  const host = Host.createHost({ fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify(completion('', 'length')) }) });
  await assert.rejects(host.complete({ model: 'holodek-1', messages: [{ role: 'user', content: 'small' }] }), error => {
    assert.equal(error.code, 'PC_MODEL_OUTPUT_LIMIT');
    assert.deepEqual(error.responseEvidence, { finishReason: 'length', prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, finalChars: 0 });
    return true;
  });
});

test('a refusal is not mistaken for an empty response that should be retried', async () => {
  const { result, bodies } = await replay({ component: 'refusal-replay', parameters: { name: C.text(30) },
    localWork: { brief: 'Name this room.' } }, () => completion('', 'content_filter'));
  assert.equal(result.value, null); assert.equal(bodies.length, 1); assert.equal(result.error.code, 'PC_MODEL_REFUSAL');
});

test('output-limit diagnostics count the rejected final and reasoning without exposing reasoning text', async () => {
  const partial = '{"name":"unfinished';
  const { result, bodies } = await replay({ component: 'cap-evidence', parameters: { name: C.text(30) },
    localWork: { brief: 'Name this room.' } }, () => {
    const value = completion(partial, 'length'); value.choices[0].message.reasoning = 'private reasoning'; return value;
  });
  assert.equal(bodies.length, 1); assert.equal(result.error.code, 'MODEL_OUTPUT_LIMIT');
  assert.equal(result.error.responseEvidence.finalChars, partial.length);
  assert.equal(result.error.responseEvidence.reasoningChars, 17);
  assert.equal(result.error.responseEvidence.completion_tokens, 20);
  assert.ok(!JSON.stringify(result.error).includes('private reasoning'));
});

test('capped multi-field answers split rather than resubmit the same oversized group', async () => {
  const { result, bodies } = await replay({ component: 'cap-replay', parameters: { context: C.text(300), lore: C.text(320) },
    localWork: { brief: 'Author this apparatus and its lore.' } }, (body, n) => n === 1 ? completion('{"context":"unfinished', 'length') : valid(body));
  assert.equal(bodies.length, 3); assert.ok(result.value);
  assert.equal(result.recovery.splitParts, 1);
  assert.deepEqual(bodies.slice(1).map(b => Object.keys(b.response_format.json_schema.schema.properties)), [['context'], ['lore']]);
});

test('schema correction asks only for invalid fields and cannot rewrite accepted identity', async () => {
  const { result, bodies } = await replay({ component: 'width-replay', parameters: {
    name: C.text(40), width: { type: Number, minimum: .2, maximum: 1 } }, localWork: { brief: 'Draw the saved arch.' } },
  (body, n) => n === 1 ? completion(JSON.stringify({ name: 'Temple Arch', width: 5 })) : completion('{"width":0.6}'));
  assert.deepEqual(result.value, { name: 'Temple Arch', width: .6 });
  assert.deepEqual(Object.keys(bodies[1].response_format.json_schema.schema.properties), ['width']);
  assert.ok(bodies[1].messages.some(m => m.content.includes('Temple Arch')));
});

test('invalid nested scenery width repairs one leaf without changing the valid row or assembly', async () => {
  const row = { name: C.text(40), shape: C.choice(['arch', 'column']), width: { type: Number, minimum: .2, maximum: 1 },
    assembly: { material: C.choice(['sandstone', 'marble']) } };
  const authored = { name: 'Temple Arch', shape: 'arch', width: 5, assembly: { material: 'sandstone' } };
  const { result, bodies } = await replay({ component: 'nested-replay', parameters: { structures: { type: C.list(row), minItems: 1, maxItems: 1 } },
    localWork: { brief: 'Retain this temple landmark.', arrays: { structures: { count: 1, batch: 1 } } } },
  (_body, n) => n === 1 ? completion(JSON.stringify({ rows: [authored] })) : completion('{"value":0.6}'));
  assert.deepEqual(result.value.structures, [{ ...authored, width: .6 }]); assert.equal(bodies.length, 2);
  assert.equal(result.recovery.repairedLeaves, 1);
  assert.deepEqual(Object.keys(bodies[1].response_format.json_schema.schema.properties), ['value']);
});

test('a failed later part resumes exact accepted choices but changed dependencies do not', async () => {
  const checkpoint = new Map(); let broken = true;
  const options = { component: 'resume-replay', parameters: { name: C.text(40), detail: C.text(40) },
    context: { runId: 'run-a' }, localWork: { checkpoint, isolate: ['name', 'detail'], brief: 'Saved temple identity.' } };
  const { result, bodies } = await replay(options, body => {
    if (body.response_format.json_schema.schema.properties.detail && broken) throw Error('Connection failed');
    return valid(body);
  }, async $ => {
    const failed = await C.request($, options); assert.equal(failed.value, null);
    broken = false;
    const resumed = await C.request($, options); assert.ok(resumed.value);
    await C.request($, { ...options, context: { runId: 'run-b' } });
    return resumed;
  });
  assert.ok(result.value);
  assert.equal(bodies.filter(b => b.response_format.json_schema.schema.properties.name).length, 2);
});

test('SID dependent enums produce executable distinct operations and valid melodic contours', async () => {
  const rules = require('../retort/sidLocalWork').rules();
  const { result, bodies } = await replay({ component: 'sid-constraints', parameters: {
    motifRhythm: C.choice(['4,4,8,8,16,16,8']), motifContour: [{ type: Number, enum: Array.from({ length: 12 }, (_, i) => i - 4) }],
    performance: { rhythmicDevelopment: [C.choice(require('../retort/sidMusicGrammar').RHYTHMIC_OPS)] },
    developmentPath: [C.choice(require('../retort/sidMusicTheory').planPromptSpec().developmentTransforms)] },
    localWork: { ...rules, brief: 'Compose the exact saved rhythm.' } }, body => valid(body));
  assert.ok(result.value, result.error?.message);
  const contour = result.value.motifContour, gaps = contour.slice(1).map((n, i) => Math.abs(n - contour[i]));
  assert.equal(contour.length, 7); assert.equal(contour[0], 0); assert.ok(new Set(contour).size >= 3);
  assert.ok(gaps.every(n => n <= 5)); assert.ok(gaps.filter(n => n >= 3).length <= 2);
  const ops = result.value.performance.rhythmicDevelopment;
  assert.equal(new Set(ops).size, ops.length); assert.ok(!ops.includes('diminish_repeat'));
  assert.ok(result.value.developmentPath.every((op, i, all) => !i || op !== all[i - 1]));
  assert.ok(bodies.every(b => Budget.tally(b.messages, [{ response_format: b.response_format }]).total <= Budget.CEILING));
});

test('all greedy contour paths and random legal prefixes retain an executable completion', () => {
  const { contourChoices } = require('../retort/sidLocalWork');
  for (const path of ['$.motifContour', '$.contrastContour']) for (let count = 5; count <= 9; count++) for (let seed = 0; seed < 12; seed++) {
    const values = [];
    while (values.length < count) {
      const choices = contourChoices({ values, count, path }); assert.ok(choices.length);
      values.push(choices[(seed + values.length) % choices.length]);
    }
    assert.ok(new Set(values).size >= 3);
  }
});

test('checkpoint identity joins active work, retains failed parts and separates runs', async () => {
  const pool = require('../retort/localWorkCheckpoint').create({ limit: 2 }); let release, calls = 0;
  const first = pool.run({ run: 1 }, async parts => { calls++; parts.set('identity', 'Temple'); await new Promise(r => { release = r; }); throw Error('later failure'); });
  const joined = pool.run({ run: 1 }, () => assert.fail('duplicate chain'));
  await new Promise(r => setImmediate(r)); release();
  await assert.rejects(first, /later failure/); await assert.rejects(joined, /later failure/);
  assert.equal(calls, 1);
  assert.equal(await pool.run({ run: 1 }, parts => parts.get('identity')), 'Temple');
  assert.equal(await pool.run({ run: 2 }, parts => parts.size), 0);
});

test('readable long puzzle text is isolated instead of grouped with independent lore', async () => {
  let options; const original = C.request;
  C.request = async (_agent, given) => { options = given; throw Error('capture only'); };
  const before = Models.current().id; Models.restore('holodek-1');
  try { await require('../retort/physicalPuzzleDesign').generateDesign({}, { roomName: 'Saved Hall', seed: 'replay' }); }
  finally { C.request = original; Models.restore(before); }
  assert.ok(options.localWork.isolate.includes('context')); assert.ok(options.localWork.isolate.includes('lore'));
  assert.ok(options.localWork.isolate.includes('text'));
});

test('puzzle choices obey executable positions, unique sequence IDs and unsolved starts', () => {
  const Puzzles = require('../assets/physicalPuzzles');
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const brief = Puzzles.fallback(seed, 'Saved Hall'), rules = require('../retort/puzzleLocalWork').rules(brief, new Map());
    const mechanic = Puzzles.toolbox().mechanics[brief.kind], rows = [];
    for (let i = 0; i < brief.controls.length; i++) {
      const prior = { nextIndex: i, acceptedRows: rows, options: Array.from({ length: mechanic.positions }, (_, n) => 'Position ' + n) };
      const initial = rules.field(`$.controls[${i}].initial`, { type: Number, minimum: 0, maximum: mechanic.positions - 1 }, prior).enum[0];
      const goal = rules.field(`$.controls[${i}].goal`, { type: Number, minimum: 0, maximum: mechanic.positions - 1 }, { ...prior, initial }).enum[0];
      rows.push({ ...brief.controls[i], initial, goal });
    }
    assert.doesNotThrow(() => Puzzles.compile({ ...brief, controls: rows }));
    const order = [];
    while (order.length < rules.order.count) order.push(rules.order.sequence({ prior: { controls: rows }, values: order })[0]);
    assert.equal(new Set(order).size, order.length); assert.equal(order.length, mechanic.ordered ? rows.length : 0);
  }
});

test('non-fresco artwork exposes no numeric aspect ratio and non-mosaics expose no mosaic pattern', () => {
  const brief = require('../assets/physicalPuzzles').fallback('art', 'Saved Hall');
  const rules = require('../retort/puzzleLocalWork').rules(brief, new Map());
  const ratio = { type: Number, enum: [1, 2], optional: true };
  const field = rules.field('$.roomArt[0].aspectRatio', ratio, { kind: 'mosaic' });
  const schema = require('../retort/modelTransport').strictSchema(require('../retort/structuredSchema').toJSON({ ratio: field }));
  assert.deepEqual(schema.properties.ratio.enum, [null]);
  assert.equal(rules.field('$.roomArt[0].aspectRatio', ratio, { kind: 'fresco' }), ratio);
});
