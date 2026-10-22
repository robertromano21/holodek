'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const path = require('node:path'), os = require('node:os'), { once } = require('node:events');
const root = process.env.HOLODEK_WEBSITE_SOURCE_ROOT || path.resolve(__dirname, '..');
const W = require(path.join(root, 'tools/website-worker/worker.cjs'));
const body = { model: 'gpt-6-luna', messages: [{ role: 'user', content: 'Describe the room.' }], stream: true, stream_options: { include_usage: true } };
const credential = 'offline-provider-key-' + 'A'.repeat(24);
const response = () => new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { content: 'An atrium.' } }] }));
test('worker fixes provider destinations, disables streaming and never substitutes a model', async () => {
  let received;
  await W.handle({ operation: 'generate', provider: 'openai', credential, body }, { fetchImpl: async (url, options) => { received = { url, options }; return response(); } });
  assert.equal(received.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(received.options.headers.Authorization, 'Bearer ' + credential);
  const sent = JSON.parse(received.options.body); assert.equal(sent.stream, false); assert.equal(sent.stream_options, undefined); assert.equal(sent.model, body.model);
  await assert.rejects(W.handle({ operation: 'generate', provider: 'https://attacker.invalid', credential, body }), /Unsupported/);
  await assert.rejects(W.handle({ operation: 'generate', provider: 'openai', credential, body }, { fetchImpl: async () => new Response(credential, { status: 401 }) }), e => e.message.includes('HTTP 401') && !e.message.includes(credential));
});
test('worker accepts assistant tool messages and preserves structured completions', async () => {
  const b = { ...body, messages: [{ role: 'assistant', content: null, tool_calls: [] }, { role: 'tool', content: '{}' }] };
  await W.handle({ operation: 'generate', provider: 'ollama', body: b }, { fetchImpl: async () => response() });
});
test('PM2 ownership checks refuse unrelated processes without stopping anything', () => {
  const script = path.join(root, 'tools/website-worker/worker.cjs');
  assert.equal(W.verifyProcess([], script), null);
  assert.throws(() => W.verifyProcess([{ name: 'holodek-adjacent-worker', pm2_env: { pm_exec_path: '/other/app.js', pm_cwd: '/other' } }], script), /different application/);
});
test('worker uses a free loopback port, prioritizes foreground jobs and protects its listener', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-worker-')), runtime = path.join(directory, 'runtime.json');
  const releases = [], started = [], reports = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/api/tags')) return new Response('{"models":[]}');
    const b = JSON.parse(init.body); started.push(b.messages[0].content);
    await new Promise(resolve => releases.push(resolve)); return response();
  };
  const server = W.startServer({ runtime, maxActive: 1, fetchImpl, log: row => reports.push(row) });
  t.after(async () => { for (const release of releases) release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  await once(server, 'listening');
  assert.equal(server.address().address, '127.0.0.1'); assert.ok(server.address().port > 0);
  const registry = JSON.parse(fs.readFileSync(runtime, 'utf8'));
  const url = 'http://127.0.0.1:' + registry.port + '/jobs';
  const denied = await fetch(url, { method: 'POST', body: '{}' }); assert.equal(denied.status, 403);
  const call = (name, background) => fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + registry.token },
    body: JSON.stringify({ operation: 'generate', provider: 'openai', credential, background, body: { ...body, messages: [{ role: 'user', content: name }] } }) });
  const waitFor = async condition => { for (let n = 0; n < 200 && !condition(); n++) await new Promise(r => setTimeout(r, 5)); assert.ok(condition()); };
  const first = call('first', true); await waitFor(() => started.length === 1);
  const background = call('background', true); await new Promise(r => setTimeout(r, 20));
  const foreground = call('foreground', false); await new Promise(r => setTimeout(r, 20));
  const status = await W.rpc({ operation: 'status' }, { runtime }); assert.equal(status.active, 1); assert.equal(status.queued, 2);
  assert.equal(status.jobs[0].provider, 'openai'); assert.equal(status.jobs[0].model, 'gpt-6-luna');
  assert.equal(status.jobs[0].background, true); assert.equal(status.jobs[0].phase, 'running');
  releases.shift()(); await first; await waitFor(() => started.length === 2); assert.equal(started[1], 'foreground');
  releases.shift()(); await foreground; await waitFor(() => started.length === 3);
  releases.shift()(); await background;
  assert.deepEqual(started, ['first', 'foreground', 'background']);
  const final = await W.rpc({ operation: 'status' }, { runtime });
  assert.equal(final.active, 0); assert.equal(final.completed, 3); assert.equal(final.failed, 0);
  assert.deepEqual(final.jobs, []); assert.equal(final.recent.length, 3);
  assert.ok(reports.some(row => row.model === 'gpt-6-luna' && row.phase === 'completed' && !row.background));
  assert.ok(!JSON.stringify({ reports, status, final }).includes(credential));
  assert.ok(!JSON.stringify({ reports, status, final }).includes('Describe the room.'));
  assert.equal(JSON.stringify(registry).includes(credential), false);
});
