'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const root = process.env.HOLODEK_WEBSITE_SOURCE_ROOT || path.resolve(__dirname, '..');
const W = require(path.join(root, 'retort/websiteAi'));
const publicBytes = Buffer.from('offline test host key'), encoded = publicBytes.toString('base64');
const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(publicBytes).digest('base64').replace(/=+$/, '');
const config = { enabled: true, host: 'worker.example.invalid', username: 'holodek-agent', sshPort: 22,
  fingerprint, background: true, useForGameModels: true, remoteBuild: false };
const scan = 'worker.example.invalid ssh-ed25519 ' + encoded;
test('connection settings reject shell syntax, URLs, root, invalid pins and invalid ports', () => {
  for (const change of [{ host: 'host;whoami' }, { host: 'https://example.invalid' }, { host: '-option' },
    { username: 'root' }, { username: 'user;id' }, { sshPort: 0 }, { sshPort: '22' }, { fingerprint: 'unverified' }, { enabled: 'true' }, { remoteBuild: 'true' }])
    assert.throws(() => W.normalize({ ...config, ...change }));
  assert.deepEqual(W.normalize({ ...config, credential: 'secret' }), config);
  assert.match(W.trustedHost(scan, fingerprint), /^holodek-website-ai ssh-ed25519 /);
  assert.throws(() => W.trustedHost(scan, 'SHA256:' + 'X'.repeat(43)), /fingerprint did not match/);
});
test('connection controls require a loopback peer and literal local host with matching origin', () => {
  const request = (remoteAddress, host, origin) => ({ socket: { remoteAddress }, headers: { host, ...(origin ? { origin } : {}) } });
  assert.equal(W.localRequest(request('127.0.0.1', 'localhost:3000', 'http://localhost:3000')), true);
  assert.equal(W.localRequest(request('::1', '[::1]:3000')), true);
  for (const r of [request('203.0.113.5', 'localhost:3000'), request('127.0.0.1', 'attacker.invalid:3000'),
    request('127.0.0.1', 'localhost:3000', 'https://attacker.invalid'), { ...request('127.0.0.1', 'localhost:3000'), headers: { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' } }])
    assert.equal(W.localRequest(r), false);
});
function fixture(t, { mismatch = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-website-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [], secret = 'offline-test-key-' + 'K'.repeat(24), jobs = new Map();
  const run = async (exe, args, options = {}) => {
    calls.push({ exe, args, options });
    if (exe.includes('ssh-keygen')) { const file = args[args.indexOf('-f') + 1]; fs.writeFileSync(file, 'private-test-key'); fs.writeFileSync(file + '.pub', 'ssh-ed25519 test-public-key'); return ''; }
    if (exe.includes('ssh-keyscan')) return mismatch ? scan.replace(encoded, Buffer.from('wrong').toString('base64')) : scan;
    if (args.at(-1).includes('node -e')) return JSON.stringify({ value: { version: 1, port: 45678, cpus: 8, memoryGB: 32, models: [] } });
    const packet = JSON.parse(options.input);
    if (packet.operation === 'status') return JSON.stringify({ value: { version: 1, port: 45678, cpus: 8, models: [] } });
    if (packet.operation === 'model-poll') return JSON.stringify({ value: { phase: 'complete', result: jobs.get(packet.id) } });
    if (packet.operation === 'model-cancel') return JSON.stringify({ value: { accepted: true } });
    if (packet.body.model === 'error') return JSON.stringify({ error: 'provider leaked ' + secret });
    const result = { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'A room.' } }] };
    if (packet.operation === 'model-submit') { jobs.set(packet.id, result); return JSON.stringify({ value: { id: packet.id, capability: packet.capability, phase: 'queued' } }); }
    return JSON.stringify({ value: result });
  };
  return { directory, secret, calls, service: W.createService({ directory, run, env: { OPENAI_API_KEY: secret },
    source: path.join(root, 'tools/website-worker/worker.cjs') }) };
}
test('deployment verifies the pin, uses SSH stdin for jobs and stores no provider key', async t => {
  const f = fixture(t); const view = await f.service.connect(config, { deploy: true });
  assert.equal(view.connected, true); assert.equal(view.worker.port, 45678);
  await f.service.generate({ provider: 'openai', body: { model: 'gpt-6-luna', messages: [{ role: 'user', content: 'Room' }] } });
  const job = f.calls.find(call => call.options.input && JSON.parse(call.options.input).operation === 'model-submit');
  assert.equal(JSON.parse(job.options.input).credential, f.secret);
  assert.equal(JSON.stringify(job.args).includes(f.secret), false);
  assert.match(job.args.join(' '), /StrictHostKeyChecking=yes/);
  assert.equal(JSON.stringify(view).includes('identityFile'), false);
  for (const file of fs.readdirSync(f.directory)) assert.equal(fs.readFileSync(path.join(f.directory, file), 'utf8').includes(f.secret), false);
  await assert.rejects(f.service.generate({ provider: 'openai', body: { model: 'error' } }), e => !e.message.includes(f.secret) && e.message.includes('[redacted]'));
});
test('pin mismatch sends no SSH command and incomplete existing keys are never replaced', async t => {
  const f = fixture(t, { mismatch: true });
  await assert.rejects(f.service.connect(config, { deploy: true }), /fingerprint/);
  assert.equal(f.calls.some(c => /ssh(?:\.exe)?$/.test(c.exe)), false);
  fs.unlinkSync(path.join(f.directory, 'identity_ed25519.pub'));
  await assert.rejects(f.service.publicKey(), /Incomplete SSH key pair/);
  assert.equal(fs.readFileSync(path.join(f.directory, 'identity_ed25519'), 'utf8'), 'private-test-key');
});
test('changing or disabling a connection cannot silently reroute an in-flight action', async t => {
  const f = fixture(t); await f.service.connect(config, { deploy: true });
  await f.service.withSnapshot(async () => {
    await f.service.connect({ ...config, host: 'other.example.invalid' }, { deploy: true });
    await assert.rejects(f.service.generate({ provider: 'openai', body: {} }), /connection changed/);
  });
  f.service.disable(); await assert.rejects(f.service.generate({ provider: 'openai', body: {} }), /disabled/);
});
test('SDK adapter preserves complete tool calls and streamed deltas for the same selected provider', async () => {
  const calls = [], result = { choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
    tool_calls: [{ id: 'one', type: 'function', function: { name: 'answer', arguments: '{"ok":true}' } }] } }] };
  const client = W.modelClient({ generate: async packet => { calls.push(packet); return result; } }, 'openai');
  const stream = await client.chat.completions.create({ model: 'gpt-6-luna', stream: true });
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  assert.equal(calls[0].provider, 'openai'); assert.equal(calls[0].body.model, 'gpt-6-luna');
  assert.equal(chunks[0].choices[0].delta.tool_calls[0].index, 0);
  assert.equal(chunks[0].choices[0].finish_reason, 'tool_calls');
});
