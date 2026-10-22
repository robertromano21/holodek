'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const { Response } = require('node-fetch');
const OpenAI = require('openai');
process.env.HOLODEK_OLLAMA_URL = 'http://127.0.0.1:9/v1'; // these tests cover cloud models; never see a real local Ollama
const { createModelService, catalog, install } = require('../retort/gameModels');
const Transport = require('../retort/modelTransport');
const { createRuntime } = require('../retort/gameRetort');
const noLog = () => {};

test('new sessions default to Luna while explicit 4.1 and original saved selections remain restorable', () => {
  const models = createModelService();
  assert.equal(models.current().id, 'gpt-6-luna');
  assert.equal(models.restore('gpt-4.1-mini').id, 'gpt-4.1-mini');
  assert.equal(models.restore('original').id, 'original');
  assert.equal(models.profile('gpt-4.1-mini').id, 'gpt-4.1-mini');
});
const packet = (delta, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] });
const text = content => [packet({ content }), packet({}, 'stop'), { choices: [], usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 } }];
function fixture(replies = [], initial = 'gpt-6-luna', timeoutMs = 500) {
  const requests = [], options = [];
  const client = { models: { list: async () => ({ data: catalog.map(row => ({ id: row.id })) }) }, chat: { completions: {
    create: async (body, opts) => {
      requests.push(body); options.push(opts);
      const next = replies.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next(opts);
      if (!body.stream) return { choices: [{ message: { content: JSON.stringify(next) }, finish_reason: 'stop' }] };
      assert.ok(next, 'Every model call needs a synthetic response.');
      return (async function* () { for (const chunk of next) yield chunk; })();
    }
  } } };
  const models = createModelService({ clientFor: () => client, initial });
  const runtime = createRuntime({ models, client, log: noLog, timeoutMs });
  const execute = callback => runtime.run(runtime.retort(callback), null, { shouldSaveToLog: false });
  return { client, models, runtime, execute, requests, options };
}

test('account model discovery intersects verified capabilities, excludes retired and reasoning-only IDs, and coalesces reads', async () => {
  let calls = 0, now = Date.parse('2026-10-14T12:00:00Z');
  const models = createModelService({ now: () => now, clientFor: () => ({ models: { list: async () => {
    calls++; return { data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6-astra' }, { id: 'gpt-6.1-sol' },
      { id: 'gpt-4.1-mini' }, { id: 'gpt-4o', shutdown_date: '2026-10-01' }, { id: 'unverified-model' }] };
  } } }) });
  const result = await Promise.all([models.view(), models.view()]);
  assert.equal(calls, 1);
  assert.deepEqual(result[0].models.map(row => row.id), ['gpt-6-luna', 'gpt-4.1-mini']);
  assert.equal(result[0].reasoning, 'off'); assert.equal(result[0].current.id, 'gpt-6-luna');
  now = Date.parse('2027-01-14T12:00:00Z');
  assert.deepEqual((await models.view()).models.map(row => row.id), ['gpt-6-luna']);
});

test('failed account discovery exposes no provider secrets, leaves selection alone and permits original-settings rollback', async () => {
  const models = createModelService({ initial: 'gpt-6-luna', clientFor: () => { throw Error('sk-private-secret'); } });
  const view = await models.view();
  assert.equal(view.models.length, 0); assert.doesNotMatch(JSON.stringify(view), /sk-private/);
  await assert.rejects(models.select('gpt-6-sol', 0), /not currently verified/);
  await models.select('original', 0); assert.equal(models.current().id, 'original');
  const missing = createModelService({ clientFor: () => null });
  assert.match((await missing.view()).warning, /API key/);
});

test('selection validates IDs and revisions without any completion call', async () => {
  const f = fixture();
  await assert.rejects(f.models.select('gpt-6-astra', 0), /supported non-reasoning/);
  await assert.rejects(f.models.select('gpt-6-sol'), /Refresh/);
  await f.models.select('gpt-6-sol', 0);
  await assert.rejects(f.models.select('gpt-4.1-mini', 0), /another window/);
  assert.equal(f.models.current().id, 'gpt-6-sol'); assert.equal(f.requests.length, 0);
});

test('switching during an action pins every chained Retort and direct JSON request to its original model', async () => {
  const f = fixture([text('east'), { indoor: true }, text('Continue east.'), text('Next action.')]);
  let release, entered;
  const gate = new Promise(resolve => release = resolve), ready = new Promise(resolve => entered = resolve);
  const old = f.execute(async $ => {
    $.model = 'gpt-4o-mini'; $.system`Remain the Grave Master.`; $.user`Find the ${'crossing'}.`;
    const first = await $.assistant.generation({ maxTokens: 40 });
    entered(); await gate;
    await Transport.complete(f.client, { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'Return JSON.' }],
      response_format: { type: 'json_object' } }, { models: f.models });
    $.model = 'gpt-4.1-mini'; $.user`Describe the route: ${first}.`;
    return (await $.assistant.generation()).content;
  });
  await ready; await f.models.select('gpt-6-sol', 0); release();
  assert.equal(await old, 'Continue east.');
  await f.execute(async $ => { $.model = 'gpt-4o-mini'; $.user('Next action.'); return $.assistant.generation(); });
  assert.deepEqual(f.requests.map(row => row.model), ['gpt-6-luna', 'gpt-6-luna', 'gpt-6-luna', 'gpt-6-sol']);
  assert.ok(f.requests.every(row => row.reasoning_effort === 'none'));
  assert.deepEqual(f.requests[2].messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(f.requests[2].messages[2].content, 'east');
});

test('original routing is preserved and all models omit app token caps while keeping reasoning off', async () => {
  const f = fixture([text('A'), text('B')], 'original');
  await f.execute(async $ => {
    $.model = 'gpt-4.1-mini'; $.user('A'); await $.assistant.generation({ maxTokens: 500 });
    $.model = 'gpt-4o-mini'; await $.assistant.generation({ maxTokens: 700 });
  });
  assert.deepEqual(f.requests.map(row => row.model), ['gpt-4.1-mini', 'gpt-4o-mini']);
  assert.equal(f.requests[0].max_tokens, undefined); assert.equal(f.requests[1].max_tokens, undefined);
  assert.equal(f.requests[0].reasoning_effort, undefined);
  for (const row of catalog) {
    const models = createModelService({ initial: row.id });
    const body = Transport.requestBody({ model: 'gpt-4.1-mini', maxTokens: 400, max_tokens: 900,
      max_completion_tokens: 1000, max_output_tokens: 1200, reasoning_effort: 'high' }, { models, maxTokens: 80 });
    assert.equal(body.reasoning_effort, row.reasoningNone ? 'none' : row.reasoningEffort); // gpt-oss cannot disable reasoning; it runs at low
    for (const key of ['maxTokens', 'max_tokens', 'max_completion_tokens', 'max_output_tokens']) assert.equal(Object.hasOwn(body, key), false);
  }
});

test('new runtime preserves forced schemas, fragment streams, usage and message/result interfaces', async () => {
  const args = value => ({ tool_calls: [{ index: 0, function: { arguments: value } }] });
  const f = fixture([[packet({ tool_calls: [{ index: 0, id: 'one', type: 'function', function: { name: 'answer', arguments: '' } }] }),
    packet(args('{"direction":')), packet(args('"east"}')), packet({}, 'tool_calls'),
    { choices: [], usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 } }]]);
  let generation, replayed;
  const answer = await f.execute(async $ => {
    $.user('Choose an exit.');
    generation = $.assistant.generation({ maxTokens: 80, parameters: { direction: { type: String, enum: ['east', 'west'] } } });
    replayed = (async () => { const chunks = []; for await (const value of generation.stream) chunks.push(value); return chunks; })();
    const result = await generation;
    assert.equal(result.totalTokens, 45); assert.equal(generation.message, result);
    assert.equal(result.toString(), '{"direction":"east"}');
    assert.deepEqual(JSON.parse(JSON.stringify(result)).content, result.content);
    return result.result;
  });
  assert.deepEqual(answer, { direction: 'east' });
  assert.equal((await replayed).at(-1), '{"direction":"east"}');
  assert.equal(f.requests[0].max_completion_tokens, undefined); assert.equal(f.requests[0].parallel_tool_calls, false);
});

for (const [label, reply, pattern] of [
  ['HTTP failure', new Error('offline HTTP 400'), /HTTP 400/],
  ['refusal', [packet({ refusal: 'No.' }), packet({}, 'stop')], /declined/],
  ['truncation', [packet({ content: 'Partial' }), packet({}, 'length')], /output limit/],
  ['empty answer', [packet({}, 'stop')], /empty answer/],
  ['broken stream', [packet({ content: 'Incomplete' })], /before.*complete/],
  ['network interruption', async () => (async function* () { yield packet({ content: 'Partial' }); throw Error('connection lost'); })(), /connection lost/]
]) test('generation rejects promptly without accepting partial content: ' + label, async () => {
  const f = fixture([reply]);
  await assert.rejects(f.execute(async $ => { $.user('Offline error.'); return $.assistant.generation(); }), pattern);
});

for (const [label, chunks, pattern] of [
  ['wrong function', [packet({ tool_calls: [{ index: 0, function: { name: 'other', arguments: '{}' } }] }), packet({}, 'tool_calls')], /unexpected.*function/],
  ['malformed JSON', [packet({ tool_calls: [{ index: 0, function: { name: 'answer', arguments: '{' } }] }), packet({}, 'tool_calls')], /invalid structured/],
  ['multiple calls', [packet({ tool_calls: [{ index: 1, function: { name: 'answer', arguments: '{}' } }] }), packet({}, 'tool_calls')], /more than one/],
  ['plain text', text('{}'), /text instead/]
]) test('structured output rejects ' + label, async () => {
  const f = fixture([chunks]);
  await assert.rejects(f.execute(async $ => { $.user('Offline schema test.'); return $.assistant.generation({ parameters: { direction: String } }); }), pattern);
});

test('a hung HTTP call and a stalled SSE iterator both time out and abort', async () => {
  for (const hung of [() => new Promise(() => {}), async () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) })]) {
    const f = fixture([hung], 'gpt-6-luna', 20);
    await assert.rejects(f.execute(async $ => { $.user('Offline timeout.'); return $.assistant.generation(); }), /timed out/);
    assert.equal(f.options[0].signal.aborted, true);
  }
});

test('caught model failures do not poison subsequent fallback narration in the same Retort conversation', async () => {
  const f = fixture([new Error('offline failure'), text('Fallback narration.')]);
  const result = await f.execute(async $ => {
    $.user('Generate a design.');
    try { await $.assistant.generation(); } catch {}
    $.user('Describe the deterministic fallback.');
    return (await $.assistant.generation()).content;
  });
  assert.equal(result, 'Fallback narration.');
  assert.deepEqual(f.requests[1].messages.map(row => row.role), ['user', 'user']);
});

for (const value of ['{}', '{"direction":true}', '{"direction":"invented exit"}', 'null']) test('structured generation validates required field/enum/type for ' + value, async () => {
  const f = fixture([[packet({ tool_calls: [{ index: 0, function: { name: 'answer', arguments: value } }] }), packet({}, 'tool_calls')]]);
  await assert.rejects(f.execute(async $ => { $.user('Choose east or west.'); return $.assistant.generation({ parameters: {
    direction: { type: String, enum: ['east', 'west'] }
  } }); }), /answer schema/);
});

test('the real installed SDK serializes the application runtime request and decodes offline SSE', async () => {
  let wire;
  const client = new OpenAI({ apiKey: 'offline-only', maxRetries: 0, fetch: async (_url, init) => {
    wire = JSON.parse(init.body);
    return new Response(Readable.from([...text('Across the ash.' ).map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n'), 'data: [DONE]\n\n']),
      { headers: { 'content-type': 'text/event-stream' } });
  } });
  const models = createModelService({ initial: 'gpt-6-luna', clientFor: () => client });
  const runtime = createRuntime({ models, client, log: noLog });
  const answer = await runtime.run(runtime.retort(async $ => { $.user('Describe the waste.'); return (await $.assistant.generation({ maxTokens: 900 })).content; }),
    null, { shouldSaveToLog: false });
  assert.equal(answer, 'Across the ash.'); assert.equal(wire.reasoning_effort, 'none'); assert.equal(wire.max_completion_tokens, undefined);
  assert.equal(wire.max_tokens, undefined);
});

test('startup tile generation ignores its old 400-token hint and accepts a complete large JSON answer', async () => {
  const tiles = Object.fromEntries(Array.from({ length: 12 }, (_, index) => ['tile' + index, {
    type: 'temple_feature_' + index, spriteSpec: { profile: 'block', detail: { carving: 'runes', bandCount: 3 } },
    procedure: { material: 'stone', program: Array.from({ length: 10 }, () => ({ op: 'block', width: .6, height: .8 })) }
  }]));
  const content = JSON.stringify({ tiles });
  assert.ok(content.length > 4000);
  const f = fixture([text(content)]);
  const result = await f.execute(async $ => {
    $.user('Generate all twelve required temple feature tiles as JSON.');
    return JSON.parse((await $.assistant.generation({ maxTokens: 400 })).content);
  });
  assert.deepEqual(result, { tiles });
  assert.equal(f.requests[0].max_completion_tokens, undefined);
  assert.equal(f.requests[0].max_tokens, undefined);
  assert.equal(f.requests[0].reasoning_effort, 'none');
});

test('direct JSON room and character helpers also omit their old output caps', async () => {
  for (const initial of ['gpt-6-luna', 'original']) {
    const f = fixture([{ indoor: true }, { bodyPlan: 'humanoid' }], initial);
    for (const max_tokens of [1800, 900]) await Transport.complete(f.client, {
      model: 'gpt-4.1-mini', max_tokens, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: 'Return JSON.' }]
    }, { models: f.models });
    for (const body of f.requests) {
      assert.equal(body.max_tokens, undefined); assert.equal(body.max_completion_tokens, undefined);
      assert.equal(body.reasoning_effort, initial === 'original' ? undefined : 'none');
    }
  }
});

test('model settings HTTP routes use no completion calls and the middleware snapshots background request work', async () => {
  const express = require('express'), app = express(), f = fixture();
  app.use(express.json()); install(app, f.models);
  app.post('/processInput7', (_req, res) => { const captured = f.models.snapshot(); setImmediate(() => res.json(captured)); });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const url = 'http://127.0.0.1:' + server.address().port;
    const view = await (await fetch(url + '/game-models')).json();
    const response = await fetch(url + '/game-models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'gpt-6-sol', revision: view.current.revision }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).current.id, 'gpt-6-sol');
    const invalid = await fetch(url + '/game-models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'gpt-6-astra', revision: 1 }) });
    assert.equal(invalid.status, 400);
    const request = await (await fetch(url + '/processInput7', { method: 'POST' })).json();
    assert.equal(request.id, 'gpt-6-sol'); assert.equal(f.requests.length, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
