'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { once, EventEmitter } = require('node:events'), { randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const root = path.resolve(__dirname, '..'), workerRoot = path.join(root, 'tools/website-worker');
const Worker = require(path.join(workerRoot, 'worker.cjs')), Pool = require(path.join(workerRoot, 'workerPool.cjs'));
const Task = require(path.join(workerRoot, 'roomTask.cjs')), Wire = require(path.join(workerRoot, 'roomWire.cjs'));
const HASH = 'b'.repeat(64), SECRET = 'PRIVATE PC MODEL PROMPT';
const result = content => ({ model: 'holodek-1', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
const body = content => ({ model: 'holodek-1', stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content }] });
function write(directory, relative, value) {
  const file = path.join(directory, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
}
async function waitFor(check, label) {
  const until = Date.now() + 8000;
  do { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < until);
  assert.fail('Timed out waiting for ' + label);
}
function packet(index = 0) {
  const payload = { pcModel: 'holodek-1', provider: 'ollama', snapshot: { prompt: SECRET + index }, flags: {},
    job: { id: randomUUID(), key: `${index},0,0`, runId: 'offline-run', stage: 'population', model: 'holodek-1' } };
  return { operation: 'room-stage', engineHash: HASH, pcModel: 'holodek-1', background: true, payload: Wire.pack(payload) };
}
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-pc-bridge-'));
  const servers = [], registries = [], requests = [], logs = [], pending = [], abort = new AbortController(); let providerCalls = 0;
  const track = promise => { promise.catch(() => {}); pending.push(promise); return promise; };
  t.after(async () => {
    abort.abort(); for (const server of servers) server.closeAllConnections();
    await Promise.allSettled(pending);
    await Promise.all(servers.map(server => new Promise(resolve => server.close(() => resolve()))));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('holodek-pc-bridge-')); fs.rmSync(directory, { recursive: true, force: true });
  });
  write(directory, 'active-engine.json', { hash: HASH }); write(directory, 'pool.json', { version: 1, slots: [0, 1, 2] });
  write(directory, 'worker.cjs', 'module.exports = require(' + JSON.stringify(path.join(workerRoot, 'worker.cjs')) + ');\n');
  const engine = path.join(directory, 'engines', HASH);
  write(engine, '.installed.json', { hash: HASH, manifestHash: 'c'.repeat(64), ready: true });
  write(engine, 'retort/remoteRoomWorker.js', `'use strict';
const {parentPort,workerData} = require('node:worker_threads');
const {job,snapshot,pcSession,gateway,background} = workerData;
const timer = snapshot.finishFile ? setInterval(() => {
  if (require('node:fs').existsSync(snapshot.finishFile)) {
    clearInterval(timer); parentPort.postMessage({type:'done'}); parentPort.close();
  }
}, 5) : null;
require(gateway).rpc({operation:'generate',provider:'ollama',pcSession:pcSession.id,background,
  body:{model:'holodek-1',stream:true,messages:[{role:'user',content:snapshot.prompt}]}},
  {runtime:pcSession.runtime}).then(value => {
    parentPort.postMessage({type:'checkpoint',artifact:{jobId:job.id,result:value,session:pcSession.id}});
    parentPort.postMessage({type:'done'});
  },error=>parentPort.postMessage({type:'failed',reason:error.message})).finally(()=>{clearInterval(timer);parentPort.close();});
`);
  for (const slot of [0, 1, 2]) {
    const runtime = path.join(directory, slot ? `runtime-${slot + 1}.json` : 'runtime.json');
    const server = Worker.startServer({ runtime, maxActive: slot ? 1 : 2, maxBackground: 1,
      fetchImpl: () => { providerCalls++; throw Error('No external or website Ollama requests are allowed.'); }, log: row => logs.push(row) });
    servers.push(server); await once(server, 'listening'); registries.push(JSON.parse(fs.readFileSync(runtime, 'utf8')));
  }
  const fetchImpl = (url, options) => {
    const target = new URL(url); assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1');
    assert.ok(registries.some(row => row.port === Number(target.port)), 'Only fixture-owned loopback listeners may be called.');
    assert.equal(target.pathname, '/jobs'); requests.push({ port: Number(target.port), packet: JSON.parse(options.body) });
    return fetch(url, { ...options, headers: { ...options.headers, Connection: 'close' } });
  };
  const options = { directory, fetchImpl, signal: abort.signal };
  return { directory, engine, registries, requests, logs, options, track, get providerCalls() { return providerCalls; },
    nodes: () => Pool.inspect(options),
    reply: value => Worker.rpc({ operation: 'pc-model-response', ...value }, options),
    post: (slot, value) => track(fetchImpl(`http://127.0.0.1:${registries[slot].port}/jobs`, { method: 'POST', signal: abort.signal,
      headers: { Authorization: 'Bearer ' + registries[slot].token, 'Content-Type': 'application/json' }, body: JSON.stringify(value) })),
    async stage(value = packet(), signal = abort.signal) {
      const response = await Pool.route(value, { ...options, signal }), rows = [], pcRequests = [];
      assert.equal(response.status, 200);
      const finished = track((async () => {
        const decoder = new StringDecoder('utf8'); let buffer = '';
        const receive = line => { if (line.trim()) { const row = JSON.parse(line); rows.push(row); if (row.type === 'pc-model-request') pcRequests.push(row); } };
        for await (const bytes of response.body) {
          buffer += decoder.write(Buffer.from(bytes)); let newline;
          while ((newline = buffer.indexOf('\n')) >= 0) { receive(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
        }
        buffer += decoder.end(); if (buffer.trim()) receive(buffer); return rows;
      })());
      return { rows, pcRequests, finished, port: Number(new URL(response.url).port) };
    } };
}

test('three concurrent compute stages relay PC completions through their owning listeners without model reservations on response', { timeout: 15000 }, async t => {
  const f = await fixture(t), stages = await Promise.all([0, 1, 2].map(index => f.stage(packet(index))));
  await waitFor(() => stages.every(stage => stage.pcRequests.length === 1), 'three private model requests');
  const messages = stages.map(stage => stage.pcRequests[0]);
  assert.equal(new Set(stages.map(stage => stage.port)).size, 3); assert.equal(new Set(messages.map(message => message.session)).size, 3);
  for (const message of messages) {
    assert.match(message.session, /^[a-f0-9]{48}$/); assert.match(message.id, /^[a-f0-9]{24}$/);
    assert.equal(message.body.model, 'holodek-1'); assert.equal(message.body.stream, false); assert.equal(message.background, true);
    assert.ok(!Object.hasOwn(message, 'runtime') && !Object.hasOwn(message, 'credential'));
  }
  await assert.rejects(f.reply({ session: messages[0].session, id: messages[1].id, result: result('wrong job') }), /No active/);
  for (const index of [2, 0, 1]) {
    const before = f.requests.length, message = messages[index];
    assert.deepEqual(await f.reply({ session: message.session, id: message.id, result: result(message.body.messages[0].content) }), { accepted: true });
    assert.ok(f.requests.slice(before).every(row => ['capacity', 'pc-model-response'].includes(row.packet.operation)), 'Responses must bypass reservations and occupied inference slots.');
  }
  for (const stage of stages) {
    const rows = await stage.finished; assert.deepEqual(rows.map(row => row.type), ['pc-model-request', 'checkpoint', 'done']);
    const artifact = Wire.unpack(rows[1].value).artifact;
    assert.equal(artifact.result.choices[0].message.content, stage.pcRequests[0].body.messages[0].content);
    assert.equal(artifact.session, stage.pcRequests[0].session);
  }
  await assert.rejects(f.reply({ session: messages[0].session, id: messages[0].id, result: result('duplicate') }), /No active/);
  assert.ok((await f.nodes()).every(node => node.active === 0 && node.queued === 0 && node.computeActive === 0));
  assert.equal(f.providerCalls, 0); assert.ok(!JSON.stringify(f.logs).includes(SECRET));
  for (const message of messages) assert.ok(!JSON.stringify(f.logs).includes(message.session));
});

test('PC bridge rejects forged sessions, invalid models, malformed replies and oversized results without website fallback', { timeout: 15000 }, async t => {
  const f = await fixture(t), stage = await f.stage();
  const message = await waitFor(() => stage.pcRequests[0], 'PC model request'), slot = f.registries.findIndex(row => row.port === stage.port);
  const denied = await f.options.fetchImpl(`http://127.0.0.1:${stage.port}/jobs`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'pc-model-response', session: message.session, id: message.id, result: result('unauthorized') }) });
  assert.equal(denied.status, 403); await denied.json();
  for (const mutate of [value => { value.pcSession = 'd'.repeat(48); }, value => { value.body.model = 'other-model'; },
    value => { value.provider = 'openai'; }, value => { value.background = false; }]) {
    const value = { operation: 'generate', pcSession: message.session, provider: 'ollama', background: true, body: body('forged') }; mutate(value);
    const response = await f.post(slot, value); assert.equal(response.status, 400); await response.json();
  }
  for (const extra of [{}, { result: {} }, { result: { choices: [null] } }, { result: { ...result('x'), model: 'substituted-model' } },
    { result: result('') }, { result: result('x'), error: 'both' }, { error: '' },
    { result: result('x'.repeat(4 * 1024 * 1024)) }]) {
    const response = await f.post(slot, { operation: 'pc-model-response', session: message.session, id: message.id, ...extra });
    assert.equal(response.status, 400); await response.json();
  }
  const badId = await f.post(slot, { operation: 'pc-model-response', session: '../escape', id: message.id, result: result('x') });
  assert.equal(badId.status, 400); await badId.json();
  await f.reply({ session: message.session, id: message.id, result: result('valid after rejected responses') });
  assert.equal((await stage.finished).at(-1).type, 'done'); assert.equal(f.providerCalls, 0);
});

test('stage cancellation aborts pending and queued PC calls, enforces an eight-call bound and invalidates late replies', { timeout: 15000 }, async t => {
  const f = await fixture(t), controller = new AbortController(); t.after(() => controller.abort());
  const stage = await f.stage(packet(), controller.signal), message = await waitFor(() => stage.pcRequests[0], 'pending request');
  const slot = f.registries.findIndex(row => row.port === stage.port);
  const extras = Array.from({ length: 8 }, () => f.post(slot, { operation: 'generate', pcSession: message.session,
    provider: 'ollama', background: true, body: body('queued private call') }).then(async response => ({ status: response.status, ...(await response.json()) })));
  let limit;
  for (const extra of extras) extra.then(value => { if (/pending request limit/.test(value.error || '')) limit = value; });
  await waitFor(() => limit, 'bounded bridge admission');
  assert.equal(limit.status, 400);
  await waitFor(async () => (await f.nodes())[slot].queued === 7, 'seven queued calls');
  controller.abort(); await assert.rejects(stage.finished);
  const answers = await Promise.all(extras); assert.ok(answers.every(value => value.status === 400));
  await waitFor(async () => (await f.nodes()).every(node => node.active === 0 && node.queued === 0 && node.computeActive === 0), 'complete cancellation cleanup');
  await assert.rejects(f.reply({ session: message.session, id: message.id, result: result('too late') }), /No active/);
  assert.equal(f.providerCalls, 0);
});

test('PC inference errors settle the model call, fail the stage and revoke the session without echoing host error text', { timeout: 15000 }, async t => {
  const f = await fixture(t), stage = await f.stage(), message = await waitFor(() => stage.pcRequests[0], 'PC inference request');
  await f.reply({ session: message.session, id: message.id, error: 'private-host-diagnostic-key-do-not-log' });
  const rows = await stage.finished; assert.equal(rows.at(-1).type, 'failed'); assert.match(rows.at(-1).reason, /PC model request failed/);
  assert.ok(!JSON.stringify(rows).includes('private-host-diagnostic')); assert.equal(f.providerCalls, 0);
  await assert.rejects(f.reply({ session: message.session, id: message.id, result: result('retry') }), /No active/);
});

test('a normally ending stage revokes its session and cancels an unanswered model call', { timeout: 15000 }, async t => {
  const f = await fixture(t), value = packet(), payload = Wire.unpack(value.payload);
  payload.snapshot.finishFile = path.join(f.directory, 'finish-stage'); value.payload = Wire.pack(payload);
  const stage = await f.stage(value), message = await waitFor(() => stage.pcRequests[0], 'unanswered inference');
  fs.writeFileSync(payload.snapshot.finishFile, 'finish');
  assert.deepEqual((await stage.finished).map(row => row.type), ['pc-model-request', 'done']);
  await waitFor(async () => (await f.nodes()).every(node => node.active === 0 && node.queued === 0 && node.computeActive === 0), 'stage-end cleanup');
  await assert.rejects(f.reply({ session: message.session, id: message.id, result: result('late result') }), /No active/);
  assert.equal(f.providerCalls, 0);
});

test('room task requires both PC model declarations, the exact model/provider and a server-owned session before spawning', { timeout: 15000 }, async t => {
  const f = await fixture(t), value = packet(), payload = Wire.unpack(value.payload);
  const pcSession = { id: 'a'.repeat(48), runtime: path.join(f.directory, 'runtime-2.json') };
  const invalid = [p => { delete p.pcModel; }, p => { p.pcModel = 'other'; }, p => { p.job.model = 'other'; },
    p => { p.provider = 'openai'; p.credential = 'k'.repeat(32); }];
  for (const mutate of invalid) {
    const changed = structuredClone(payload); mutate(changed);
    await assert.rejects(Task.run({ ...value, payload: Wire.pack(changed) }, { directory: f.directory, pcSession,
      send() {}, spawn() { assert.fail('Invalid bridge must not spawn.'); } }), /Invalid PC model stage bridge/);
  }
  for (const changed of [{ ...value, pcModel: undefined }, value]) {
    await assert.rejects(Task.run(changed, { directory: f.directory, pcSession: changed === value ? undefined : pcSession,
      send() {}, spawn() { assert.fail('Missing bridge must not spawn.'); } }), /Invalid PC model stage bridge/);
  }
  for (const session of [{ ...pcSession, id: 'short' }, { ...pcSession, runtime: path.join(f.directory, '../outside.json') }]) {
    await assert.rejects(Task.run(value, { directory: f.directory, pcSession: session,
      send() {}, spawn() { assert.fail('Invalid server session must not spawn.'); } }), /Invalid PC model stage bridge/);
  }
  payload.pcSession = { id: 'f'.repeat(48), runtime: '/untrusted/registry.json' };
  await Task.run({ ...value, payload: Wire.pack(payload) }, { directory: f.directory, pcSession, send() {}, spawn(file, options) {
    assert.deepEqual(options.workerData.pcSession, pcSession);
    const worker = new EventEmitter(); worker.terminate = async () => {};
    setImmediate(() => worker.emit('message', { type: 'done' })); return worker;
  } });
  delete payload.pcModel; payload.job.model = 'ordinary-model';
  await Task.run({ ...value, pcModel: undefined, payload: Wire.pack(payload) }, { directory: f.directory, send() {}, spawn(file, options) {
    assert.ok(!Object.hasOwn(options.workerData, 'pcSession'), 'Wire data must not create a PC session for an ordinary model.');
    const worker = new EventEmitter(); worker.terminate = async () => {};
    setImmediate(() => worker.emit('message', { type: 'done' })); return worker;
  } });
});

test('handle uses only the injected PC transport and strips streaming fields before relay', async () => {
  let relayed = 0;
  const value = { operation: 'generate', provider: 'ollama', pcSession: 'a'.repeat(48), body: body('offline') };
  const output = await Worker.handle(value, { fetchImpl() { assert.fail('PC inference must never call a website provider.'); },
    pcRequest: async (session, request) => {
      relayed++; assert.equal(session, value.pcSession); assert.equal(request.stream, false);
      assert.ok(!Object.hasOwn(request, 'stream_options')); return result('offline response');
    } });
  assert.equal(relayed, 1); assert.equal(output.choices[0].message.content, 'offline response');
  for (const changed of [{ ...value, provider: 'openai' }, { ...value, pcSession: 'bad' },
    { ...value, body: { ...value.body, model: 'different-model' } }]) {
    await assert.rejects(Worker.handle(changed, { fetchImpl() { assert.fail('No fallback allowed.'); },
      pcRequest() { assert.fail('Invalid work must not be relayed.'); } }), /Invalid PC model bridge/);
  }
});

test('remote room gateway polls cloud providers, keeps stock Ollama RPC and pins PC sessions to their server registry', async () => {
  const source = fs.readFileSync(path.join(root, 'retort/remoteRoomWorker.js'), 'utf8');
  for (const mode of ['pc', 'openai', 'xai', 'ollama']) {
    const pc = mode === 'pc', provider = pc ? 'ollama' : mode;
    const calls = [], messages = [], runtime = path.join(os.tmpdir(), 'gateway', 'runtime-3.json'); let transport;
    const model = pc ? 'holodek-1' : provider === 'ollama' ? 'gpt-oss:20b' : 'cloud-model';
    const workerData = { job: { id: randomUUID(), stage: 'population', model },
      snapshot: { roomNameDatabaseString: '{}', roomDungeonDatabase: {} }, flags: {}, gateway: path.join(path.dirname(runtime), 'worker.cjs'), provider,
      credential: provider === 'ollama' ? undefined : 'k'.repeat(32), background: true,
      ...(pc ? { pcModel: 'holodek-1', pcSession: { id: 'a'.repeat(48), runtime } } : {}) };
    let finished;
    const done = new Promise(resolve => { finished = resolve; });
    const localRequire = id => {
      if (id === 'node:worker_threads') return { workerData, parentPort: { postMessage: value => messages.push(value), close: () => finished() } };
      if (id === 'node:fs' || id === 'node:path') return require(id);
      if (id === './worldFlags') return { DEFAULTS: {} };
      if (id === './websiteAi') return { useRemoteTransport: value => { transport = value; } };
      if (id === workerData.gateway) return {
        rpc: async (...args) => { calls.push({ method: 'rpc', args }); return result('offline'); },
        pollModelJob: async (...args) => { calls.push({ method: 'pollModelJob', args }); return result('offline'); }
      };
      if (id === '../sharedState') return { importSaveState() {}, getCombatMode: () => false };
      if (id === './settingLayer') return { attach() {} };
      if (id === './gameModels') return { restore() {}, withSnapshot: work => work() };
      if (id === './retortWithUserInput') return { retortWithUserInput: () => transport({ operation: 'generate', provider,
        body: { ...body('offline'), model } }) };
      throw Error('Unexpected offline import: ' + id);
    };
    vm.runInNewContext(source, { require: localRequire, process: { env: {} }, __dirname: path.join(root, 'retort') });
    await done; assert.equal(messages.at(-1).type, 'done'); assert.equal(calls.length, 1);
    const { method, args } = calls[0];
    assert.equal(args[0].background, true); assert.equal(args[0].provider, provider); assert.equal(args[0].body.model, model);
    if (pc) {
      assert.equal(method, 'rpc'); assert.equal(args.length, 2);
      assert.equal(args[0].pcSession, workerData.pcSession.id); assert.equal(args[1].runtime, runtime);
    } else {
      assert.equal(method, provider === 'ollama' ? 'rpc' : 'pollModelJob');
      assert.equal(args.length, 1); assert.ok(!Object.hasOwn(args[0], 'pcSession'));
    }
  }
});
