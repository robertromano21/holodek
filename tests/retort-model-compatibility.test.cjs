'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { Response } = require('node-fetch');
const OpenAI = require('openai');
const dist = path.dirname(require.resolve('retort-js'));
const usage = { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 };

const chunk = (delta, finish = null) => ({ id: 'offline', object: 'chat.completion.chunk',
  choices: [{ index: 0, delta, finish_reason: finish }] });
const textReply = text => ({ chunks: [chunk({ role: 'assistant', content: text }), chunk({}, 'stop'), { choices: [], usage }] });
const toolDelta = (argumentsText, index = 0) => ({ tool_calls: [{ index, id: 'call_offline_' + index,
  type: 'function', function: { name: 'answer', arguments: argumentsText } }] });

// Execute the installed Retort modules unchanged in an isolated module graph.
// Only logging and the SDK's HTTP transport are replaced; no keys or network are used.
function fixture(replies, adapt = body => body) {
  const requests = [], submitted = [], cache = new Map();
  class OfflineOpenAI extends OpenAI {
    constructor(options) {
      super({ ...options, apiKey: 'offline-not-a-real-key', baseURL: 'https://offline.invalid/v1', maxRetries: 0,
        fetch: async (url, init) => {
          requests.push({ url, method: init.method, body: JSON.parse(init.body) });
          const reply = replies.shift();
          assert.ok(reply, 'Every request must have an explicit offline response.');
          if (!reply.chunks) return new Response(JSON.stringify(reply.body), {
            status: reply.status || 200, headers: { 'content-type': 'application/json' }
          });
          const events = reply.chunks.map(value => 'data: ' + JSON.stringify(value) + '\n\n');
          events.push('data: [DONE]\n\n');
          return new Response(Readable.from(events), { headers: { 'content-type': 'text/event-stream' } });
        } });
      const create = this.chat.completions.create.bind(this.chat.completions);
      this.chat.completions.create = (body, options) => {
        submitted.push(structuredClone(body));
        return create(adapt(body), options);
      };
    }
  }
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    if (path.basename(filename) === 'log-message.js') return { logMessage() {} };
    const mod = { exports: {} }, local = createRequire(filename);
    cache.set(filename, mod);
    const requireOffline = name => {
      if (name === 'openai') return OfflineOpenAI;
      const resolved = local.resolve(name);
      return resolved.startsWith(dist + path.sep) ? load(resolved) : local(name);
    };
    vm.compileFunction(fs.readFileSync(filename, 'utf8'), ['exports', 'require', 'module', '__filename', '__dirname'],
      { filename })(mod.exports, requireOffline, mod, filename, path.dirname(filename));
    return mod.exports;
  }
  const retort = load(path.join(dist, 'retort.js')).retort;
  const run = load(path.join(dist, 'run.js')).run;
  return { requests, submitted, OfflineOpenAI,
    execute: callback => run(retort(callback), null, { shouldSaveToLog: false }),
    adapter: load(path.join(dist, 'openai-chat-completion.js')).openAiChatCompletion };
}

test('installed Retort and SDK preserve streamed text, usage, templates and a multi-step conversation', async () => {
  const f = fixture([textReply('east'), textReply('The crossing lies east.')]);
  const result = await f.execute(async $ => {
    $.model = 'gpt-4.1-mini'; $.temperature = 0.7;
    $.system`Remain the Grave Master.`;
    $.user`Find the crossing for ${'Mortacia'}.`;
    const first = await $.assistant.generation({ maxTokens: 40 });
    $.user`Describe the route: ${first}.`;
    const last = await $.assistant.generation({ maxTokens: 120 });
    return { first: first.content, last: last.content, tokens: last.totalTokens };
  });
  assert.deepEqual(result, { first: 'east', last: 'The crossing lies east.', tokens: 50 });
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].url, 'https://offline.invalid/v1/chat/completions');
  assert.equal(f.requests[0].method.toUpperCase(), 'POST');
  assert.deepEqual(f.requests[1].body.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(f.requests[1].body.messages[2].content, 'east');
  assert.equal(f.requests[1].body.messages[3].content, 'Describe the route: east.');
  assert.equal(f.requests[0].body.stream, true);
  assert.equal(f.requests[0].body.stream_options.include_usage, true);
});

test('installed Retort accepts the Luna model ID and assembles fragmented function arguments', async () => {
  const f = fixture([{ chunks: [chunk(toolDelta('{"direction":')), chunk(toolDelta('"east","found":true}')),
    chunk({}, 'tool_calls'), { choices: [], usage }] }, textReply('Proceed east.')]);
  const result = await f.execute(async $ => {
    $.model = 'gpt-6-luna';
    $.user('Choose a real exit.');
    const choice = await $.assistant.generation({ maxTokens: 50, parameters: {
      direction: { type: String, enum: ['east', 'west'] }, found: Boolean
    } });
    $.user('Describe that exit.');
    await $.assistant.generation();
    return choice.result;
  });
  assert.deepEqual(result, { direction: 'east', found: true });
  const body = f.requests[0].body;
  assert.equal(body.model, 'gpt-6-luna', 'No runtime allowlist blocks new model IDs.');
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'answer' } });
  assert.deepEqual(body.tools[0].function.parameters.properties.direction.enum, ['east', 'west']);
  assert.deepEqual(body.tools[0].function.parameters.required, ['direction', 'found']);
  assert.equal(f.requests[1].body.messages[1].content, JSON.stringify(result));
});

// These are characterization tests of known migration blockers, not a claim
// that a live Luna request succeeds. Update them when the adapter is replaced.
test('stock Retort silently drops reasoning settings and output-token limits', async () => {
  const f = fixture([textReply('offline')]);
  await f.execute(async $ => {
    $.model = 'gpt-6-luna';
    $.settings.reasoning_effort = 'none'; $.settings.reasoningEffort = 'none';
    $.settings.reasoning = { effort: 'none' };
    $.user('Return a short answer.');
    return $.assistant.generation({ maxTokens: 80, max_completion_tokens: 80, reasoning_effort: 'none' });
  });
  const body = f.requests[0].body;
  for (const field of ['reasoning_effort', 'reasoning', 'reasoningEffort', 'maxTokens', 'max_tokens', 'max_completion_tokens']) {
    assert.equal(Object.hasOwn(body, field), false, field + ' is not sent by stock Retort.');
  }
  assert.equal(body.temperature, 1);
  assert.equal(body.top_p, 1);
});

test('a TEST-ONLY boundary adaptation can send Luna none and current limits through the installed SDK', async () => {
  const f = fixture([{ chunks: [chunk(toolDelta('{"direction":"east"}')), chunk({}, 'tool_calls')] }],
    body => ({ ...body, reasoning_effort: 'none', max_completion_tokens: 80, parallel_tool_calls: false }));
  const result = await f.execute(async $ => {
    $.model = 'gpt-6-luna'; $.user('Choose east or west.');
    return (await $.assistant.generation({ maxTokens: 80, parameters: { direction: String } })).result;
  });
  assert.deepEqual(result, { direction: 'east' });
  assert.equal(f.requests[0].body.reasoning_effort, 'none');
  assert.equal(f.requests[0].body.max_completion_tokens, 80);
  assert.equal(f.requests[0].body.parallel_tool_calls, false);
  assert.equal(f.submitted[0].reasoning_effort, undefined, 'Production Retort remains unmodified.');
});

test('installed SDK also serializes Luna settings for direct non-streaming JSON helpers', async () => {
  const f = fixture([{ body: { choices: [{ message: { content: '{"indoor":true}' } }] } }]);
  const client = new f.OfflineOpenAI({});
  const reply = await client.chat.completions.create({ model: 'gpt-6-luna', reasoning_effort: 'none',
    max_completion_tokens: 1800, temperature: 0.6, response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: 'Return JSON for an indoor room.' }] });
  assert.equal(JSON.parse(reply.choices[0].message.content).indoor, true);
  assert.equal(f.requests[0].body.reasoning_effort, 'none');
  assert.equal(f.requests[0].body.max_completion_tokens, 1800);
  assert.deepEqual(f.requests[0].body.response_format, { type: 'json_object' });
});

test('stock Retort returns an empty string for a refusal-only stream instead of reporting refusal', async () => {
  const f = fixture([{ chunks: [chunk({ refusal: 'Offline refusal fixture.' }), chunk({}, 'stop')] }]);
  const result = await f.execute(async $ => {
    $.model = 'gpt-6-luna'; $.user('Offline refusal test.');
    return (await $.assistant.generation()).content;
  });
  assert.equal(result, '');
});

test('stock Retort does not reject truncated structured output until JSON is read', async () => {
  const f = fixture([{ chunks: [chunk(toolDelta('{"direction":')), chunk({}, 'length')] }]);
  const reply = await f.execute(async $ => {
    $.model = 'gpt-6-luna'; $.user('Offline truncation test.');
    return $.assistant.generation({ parameters: { direction: String } });
  });
  assert.equal(reply.content, '{"direction":');
  assert.throws(() => reply.result, SyntaxError);
});

test('stock Retort consumes only the first tool call when a stream returns several', async () => {
  const f = fixture([{ chunks: [chunk({ tool_calls: [
    ...toolDelta('{"direction":"east"}', 0).tool_calls,
    ...toolDelta('{"direction":"west"}', 1).tool_calls
  ] }), chunk({}, 'tool_calls')] }]);
  const reply = await f.execute(async $ => {
    $.model = 'gpt-6-luna'; $.user('Offline multiple-call test.');
    return $.assistant.generation({ parameters: { direction: String } });
  });
  assert.deepEqual(reply.result, { direction: 'east' });
  assert.equal(f.requests[0].body.parallel_tool_calls, undefined);
});

test('HTTP request errors reject at the raw adapter boundary', async () => {
  const f = fixture([{ status: 400, body: { error: { message: 'Offline unsupported setting.', type: 'invalid_request_error' } } }]);
  await assert.rejects(async () => {
    for await (const ignored of f.adapter({ model: 'gpt-6-luna', temperature: 1, topP: 1 }, [
      Promise.resolve({ role: 'user', content: 'Offline error test.' })
    ])) void ignored;
  }, error => error.status === 400 && /Offline unsupported setting/.test(error.message));
  assert.equal(f.requests.length, 1);
});

test('stock Retort stream-cloner loses rejection and leaves its consumer pending', () => {
  // Isolate the upstream unhandled rejection so it cannot contaminate the test runner.
  const script = `
    const clone = require(${JSON.stringify(path.join(dist, 'create-stream-cloner.js'))}).default;
    const observed = { consumer: 'pending', error: null };
    process.on('unhandledRejection', error => { observed.error = error.message; });
    const stream = clone((async function* () { throw new Error('offline stream failure'); })());
    stream().next().then(() => { observed.consumer = 'resolved'; }, () => { observed.consumer = 'rejected'; });
    setTimeout(() => process.stdout.write(JSON.stringify(observed)), 80);
  `;
  const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { consumer: 'pending', error: 'offline stream failure' });
});
