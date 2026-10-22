'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createHost, modelClient, localOllamaURL } = require('../retort/pcModelHost');
const body = (content = 'Describe the hall.') => ({ model: 'holodek-1', messages: [{ role: 'user', content }] });
const answer = (message = { content: 'A stone hall.' }, extra = {}) => ({ id: 'pc-answer', model: 'holodek-1:latest',
  choices: [{ index: 0, finish_reason: message.tool_calls?.length ? 'tool_calls' : 'stop', message: { role: 'assistant', ...message } }], ...extra });
const response = value => ({ ok: true, text: async () => JSON.stringify(value) });
const tick = () => new Promise(resolve => setImmediate(resolve));
function controlled(options = {}) {
  const calls = []; let active = 0, peak = 0;
  const host = createHost({ timeoutMs: 1500, ...options, fetchImpl: (url, init) => new Promise((resolve, reject) => {
    active++; peak = Math.max(peak, active);
    const call = { url, init, body: JSON.parse(init.body), release(value = answer()) { active--; resolve(response(value)); },
      reject(error) { active--; reject(error); } };
    calls.push(call);
  }) });
  const start = (name, opts) => { const promise = host.complete(body(name), opts); promise.catch(() => {}); return promise; };
  return { host, calls, start, get peak() { return peak; } };
}

test('PC endpoint is canonical loopback only, without credentials or endpoint disclosure', () => {
  for (const [input, expected] of [
    [undefined, 'http://127.0.0.1:11434/v1'], ['http://localhost:11434/', 'http://localhost:11434/v1'],
    ['http://127.0.0.1:11434/v1///', 'http://127.0.0.1:11434/v1'], ['http://[::1]:11434', 'http://[::1]:11434/v1']
  ]) assert.equal(localOllamaURL({ HOLODEK_OLLAMA_URL: input }), expected);
  for (const input of ['https://private.example/v1', 'http://secret:password@localhost/v1', 'http://localhost/v1?key=secret',
    'http://localhost/v1#secret', 'file:///private', 'http://localhost/private', 'not-an-endpoint']) {
    assert.throws(() => localOllamaURL({ HOLODEK_OLLAMA_URL: input }), error => {
      assert.equal(error.code, 'PC_MODEL_URL'); assert.doesNotMatch(error.message, /secret|private|password|not-an-endpoint/); return true;
    });
  }
});

test('only exact holodek-1 is accepted; invalid requests never make an inference call', async () => {
  let calls = 0;
  const host = createHost({ fetchImpl: () => { calls++; assert.fail('Invalid requests must not fetch.'); } });
  for (const model of ['gpt-oss:20b', 'holodek-1:latest', 'gpt-6-luna', undefined])
    await assert.rejects(host.complete({ ...body(), model }), { code: 'PC_MODEL_MODEL' });
  await assert.rejects(host.complete({ model: 'holodek-1', messages: [] }), { code: 'PC_MODEL_REQUEST' });
  await assert.rejects(host.complete(body(), { signal: {} }), { code: 'PC_MODEL_REQUEST' });
  const circular = body(); circular.extra = circular;
  await assert.rejects(host.complete(circular), { code: 'PC_MODEL_REQUEST' });
  await assert.rejects(host.complete(body('x'.repeat(4 * 1024 * 1024))), { code: 'PC_MODEL_REQUEST_SIZE' });
  assert.equal(calls, 0);
});

test('wire request is nonstream exact model, no auth or provider keys, with caller body untouched', async () => {
  let sent;
  const host = createHost({ url: 'http://localhost:11434', fetchImpl: async (url, init) => { sent = { url, init }; return response(answer()); } });
  const input = { ...body(), stream: true, stream_options: { include_usage: true }, apiKey: 'private-key', api_key: 'private-key',
    credential: 'private-key', authorization: 'private-key', headers: { Authorization: 'private-key' },
    toJSON() { return { model: 'gpt-oss:20b', stream: true, api_key: 'private-key' }; } };
  const result = await host.complete(input);
  const wire = JSON.parse(sent.init.body);
  assert.equal(sent.url, 'http://localhost:11434/v1/chat/completions'); assert.equal(wire.model, 'holodek-1'); assert.equal(wire.stream, false);
  assert.doesNotMatch(sent.init.body, /private-key|stream_options/);
  assert.deepEqual(sent.init.headers, { 'Content-Type': 'application/json', Accept: 'application/json' });
  assert.equal(sent.init.redirect, 'error'); assert.ok(sent.init.signal instanceof AbortSignal);
  assert.equal(input.stream, true); assert.equal(input.apiKey, 'private-key'); assert.equal(result.model, 'holodek-1');
  assert.equal(result.object, 'chat.completion'); assert.equal(result.choices[0].message.content, 'A stone hall.');
});

test('normalization preserves tools, reasoning, finish reason and usage without promoting reasoning', async () => {
  const tool_calls = [{ id: 'call-1', type: 'function', function: { name: 'answer', arguments: '{"name":"Hall"}' } }];
  const message = { content: null, tool_calls, reasoning: 'private analysis', reasoning_content: 'other analysis' };
  const usage = { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 };
  const host = createHost({ fetchImpl: async () => response(answer(message, { usage })) });
  const result = await host.complete(body());
  assert.deepEqual(result.usage, usage); assert.deepEqual(result.choices[0].message, { role: 'assistant', ...message });
  assert.equal(result.choices[0].finish_reason, 'tool_calls');
  for (const field of ['reasoning', 'reasoning_content']) {
    const onlyReasoning = createHost({ fetchImpl: async () => response(answer({ content: '', [field]: '{"name":"Hall"}' })) });
    const value = await onlyReasoning.complete(body());
    assert.equal(value.choices[0].message.content, ''); assert.equal(value.choices[0].message[field], '{"name":"Hall"}');
  }
});

test('empty, wrong-model and malformed completions are rejected without substitution', async () => {
  for (const [value, code] of [
    [answer({ content: '  ', reasoning: ' ', tool_calls: [] }), 'EMPTY'],
    [answer(undefined, { model: 'gpt-oss:20b' }), 'MODEL_MISMATCH'],
    [{ choices: [] }, 'RESPONSE'], [answer({ content: { bad: true } }), 'RESPONSE'],
    [answer({ content: 'x', reasoning: { private: true } }), 'RESPONSE']
  ]) {
    const host = createHost({ fetchImpl: async () => response(value) });
    await assert.rejects(host.complete(body()), { code: 'PC_MODEL_' + code });
  }
});

test('HTTP, parser and network failures redact response bodies, URLs, causes and spoofed host errors', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 503, text() { assert.fail('Must not read an error body.'); } }),
    async () => ({ ok: true, text: async () => 'private-response-not-json' }),
    async () => { throw Object.assign(new Error('private-secret-key at http://secret'), { cause: Error('private-cause') }); },
    async () => { throw Object.assign(new Error('private-spoofed-error'), { code: 'PC_MODEL_EMPTY' }); }
  ]) {
    const host = createHost({ fetchImpl });
    await assert.rejects(host.complete(body()), error => {
      assert.match(error.code, /^PC_MODEL_/); assert.doesNotMatch(error.stack + JSON.stringify(error), /private-|http:\/\/secret/);
      assert.equal(error.cause, undefined); return true;
    });
  }
});

test('streamed response reads have a bounded size and abort on overflow', async () => {
  let signal;
  const host = createHost({ fetchImpl: async (_url, init) => {
    signal = init.signal;
    return { ok: true, body: (async function* () { yield Buffer.alloc(8 * 1024 * 1024 + 1); })() };
  } });
  await assert.rejects(host.complete(body()), { code: 'PC_MODEL_RESPONSE_SIZE' }); assert.equal(signal.aborted, true);
});

test('one active request, foreground priority and FIFO within each queue class', async () => {
  const f = controlled();
  const jobs = [f.start('active-background', { background: true }), f.start('background-1', { background: true }),
    f.start('background-2', { background: true }), f.start('foreground-1'), f.start('foreground-2')];
  assert.equal(f.calls.length, 1);
  for (const name of ['active-background', 'foreground-1', 'foreground-2', 'background-1', 'background-2']) {
    assert.equal(f.calls.at(-1).body.messages[0].content, name); f.calls.at(-1).release(); await tick();
  }
  await Promise.all(jobs); assert.equal(f.peak, 1); assert.equal(f.calls.length, 5);
});

test('queue admission is bounded, queued cancellation frees admission without inference', async () => {
  const f = controlled({ maxQueued: 1 }), controller = new AbortController();
  const first = f.start('active'), queued = f.start('cancelled', { signal: controller.signal });
  await assert.rejects(f.start('overflow'), { code: 'PC_MODEL_QUEUE_FULL', status: 429 });
  controller.abort('private cancellation reason'); await assert.rejects(queued, { code: 'PC_MODEL_CANCELLED' });
  const replacement = f.start('replacement'); f.calls[0].release(); await first; await tick();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].body.messages[0].content, 'replacement');
  f.calls[1].release(); await replacement; assert.equal(f.peak, 1);
});

test('active cancellation rejects promptly, aborts fetch and keeps its slot until fetch unwinds', async () => {
  const f = controlled(), controller = new AbortController();
  const first = f.start('active', { signal: controller.signal }), next = f.start('next');
  controller.abort('private abort reason');
  await assert.rejects(first, error => error.code === 'PC_MODEL_CANCELLED' && !error.message.includes('private'));
  assert.equal(f.calls[0].init.signal.aborted, true); assert.equal(f.calls.length, 1);
  f.calls[0].reject(new Error('AbortError private detail')); await tick(); assert.equal(f.calls.length, 2);
  f.calls[1].release(); await next; assert.equal(f.peak, 1);
});

test('pre-cancelled requests never fetch; timeout also aborts active inference', async () => {
  const f = controlled({ timeoutMs: 25 }), controller = new AbortController(); controller.abort();
  await assert.rejects(f.start('cancelled', { signal: controller.signal }), { code: 'PC_MODEL_CANCELLED' }); assert.equal(f.calls.length, 0);
  await assert.rejects(f.start('timeout'), { code: 'PC_MODEL_TIMEOUT', status: 504 });
  assert.equal(f.calls[0].init.signal.aborted, true); f.calls[0].reject(new Error('aborted'));
});

test('SDK client synthesizes streams with indexed tools and preserves reasoning, finish and usage', async () => {
  const message = { content: null, reasoning: '{"name":"Hall"}', reasoning_content: 'context',
    tool_calls: [{ id: 'tool', type: 'function', function: { name: 'answer', arguments: '{"name":"Hall"}' } }] };
  const requests = [], host = createHost({ fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return response(answer(message, { usage: { total_tokens: 9 } })); } });
  const sdk = modelClient(host), controller = new AbortController();
  const iterator = await sdk.chat.completions.create({ ...body(), stream: true }, { signal: controller.signal, background: true });
  const chunks = []; for await (const chunk of iterator) chunks.push(chunk);
  assert.equal(requests[0].stream, false); assert.equal(chunks.length, 1); assert.equal(chunks[0].object, 'chat.completion.chunk');
  assert.equal(chunks[0].choices[0].delta.content, null); assert.equal(chunks[0].choices[0].delta.reasoning, message.reasoning);
  assert.equal(chunks[0].choices[0].delta.reasoning_content, message.reasoning_content);
  assert.equal(chunks[0].choices[0].delta.tool_calls[0].index, 0); assert.equal(chunks[0].choices[0].finish_reason, 'tool_calls');
  assert.equal(chunks[0].usage.total_tokens, 9);
  assert.equal((await sdk.chat.completions.create(body())).object, 'chat.completion');
  const late = await sdk.chat.completions.create({ ...body(), stream: true }, { signal: controller.signal });
  controller.abort(); await assert.rejects(late.next(), { code: 'PC_MODEL_CANCELLED' });
});
