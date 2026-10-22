'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { once } = require('node:events'), { randomUUID, randomBytes } = require('node:crypto'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), workerFile = path.join(root, 'tools/website-worker/worker.cjs');
const W = require(workerFile), Pool = require('../tools/website-worker/workerPool.cjs');
const KEY = 'offline-cloud-key-' + 'K'.repeat(32), PROMPT = 'private asynchronous cloud prompt';
const completion = value => ({ model: 'offline-cloud', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: value } }] });
function job(label = PROMPT, background = true) {
  return { operation: 'model-submit', id: randomUUID(), capability: randomBytes(32).toString('hex'), provider: 'openai', credential: KEY,
    background, body: { model: 'offline-cloud', messages: [{ role: 'user', content: label }], stream: true } };
}
function clock() {
  let time = 0; const timers = new Map();
  return { now: () => time, setTimeout(callback, delay) { const timer = { at: time + delay, unref() {} }; timers.set(timer, callback); return timer; },
    clearTimeout: timer => timers.delete(timer), advance(milliseconds) {
      const end = time + milliseconds;
      for (;;) {
        const timer = [...timers.keys()].filter(row => row.at <= end).sort((a, b) => a.at - b.at)[0]; if (!timer) break;
        const callback = timers.get(timer); timers.delete(timer); time = timer.at; callback();
      }
      time = end;
    } };
}
async function waitFor(check, label) {
  const until = Date.now() + 8000;
  do { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)); } while (Date.now() < until);
  assert.fail('Timed out waiting for ' + label);
}
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-model-jobs-')), timers = clock();
  const servers = [], registries = [], started = [], requests = [], logs = [], pending = [], abort = new AbortController();
  const f = { directory, timers, started, requests, logs, auto: false, providerError: false, oversize: false };
  t.after(async () => {
    abort.abort(); servers.forEach(server => server.closeAllConnections());
    await Promise.allSettled(pending);
    await Promise.all(servers.map(server => new Promise(resolve => server.close(() => resolve()))));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('holodek-model-jobs-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(directory, 'pool.json'), JSON.stringify({ version: 1, slots: [0, 1, 2] }));
  for (const slot of [0, 1, 2]) {
    const runtime = path.join(directory, slot ? `runtime-${slot + 1}.json` : 'runtime.json');
    const fetchImpl = async (url, options) => {
      assert.equal(url, W.PROVIDERS.openai); assert.equal(options.headers.Authorization, 'Bearer ' + KEY);
      assert.equal(options.redirect, 'error'); assert.equal(JSON.parse(options.body).stream, false);
      if (f.providerError) throw Error(KEY + ' provider detail must not escape');
      const row = { slot, label: JSON.parse(options.body).messages[0].content, signal: options.signal };
      let cancel;
      try {
        await new Promise((resolve, reject) => {
          row.release = resolve; cancel = () => reject(Error('fake provider aborted'));
          options.signal.addEventListener('abort', cancel, { once: true }); started.push(row);
          if (options.signal.aborted) cancel(); else if (f.auto) resolve();
        });
      } finally { options.signal.removeEventListener('abort', cancel); }
      return Response.json(completion(f.oversize ? 'x'.repeat(4 * 1024 * 1024) : row.label));
    };
    const server = W.startServer({ runtime, maxActive: slot ? 1 : 2, maxBackground: 1, modelClock: timers, fetchImpl, log: row => logs.push(row) });
    servers.push(server); await once(server, 'listening'); registries.push(JSON.parse(fs.readFileSync(runtime, 'utf8')));
  }
  const fetchImpl = (url, options) => {
    const target = new URL(url); assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1');
    assert.ok(registries.some(row => row.port === Number(target.port))); assert.equal(target.pathname, '/jobs');
    requests.push({ port: Number(target.port), packet: JSON.parse(options.body) });
    return fetch(url, { ...options, headers: { ...options.headers, Connection: 'close' } });
  };
  f.options = { directory, fetchImpl, signal: abort.signal }; f.registries = registries;
  f.call = packet => { const promise = W.rpc(packet, f.options); promise.catch(() => {}); pending.push(promise); return promise; };
  f.poll = packet => f.call({ operation: 'model-poll', id: packet.id, capability: packet.capability });
  f.cancel = packet => f.call({ operation: 'model-cancel', id: packet.id, capability: packet.capability });
  f.nodes = () => Pool.inspect(f.options);
  f.post = async (slot, packet) => {
    const response = await fetchImpl(`http://127.0.0.1:${registries[slot].port}/jobs`, { method: 'POST', signal: abort.signal,
      headers: { Authorization: 'Bearer ' + registries[slot].token }, body: JSON.stringify(packet) });
    const value = await response.json();
    if (!response.ok) throw Object.assign(Error(value.error), { code: value.code }); return value.value;
  };
  f.direct = async (slot, packet) => {
    const reservation = await f.post(slot, { operation: 'reserve', kind: 'model', background: packet.background === true, queue: true });
    return f.post(slot, { ...packet, lease: reservation.lease });
  };
  return f;
}

test('async submissions return before inference and retain the three-background plus reserved-foreground queue limits', { timeout: 15000 }, async t => {
  const f = await fixture(t), background = [0, 1, 2].map(index => job('background-' + index));
  for (const packet of background) assert.equal((await f.call(packet)).id, packet.id);
  await waitFor(() => f.started.length === 3, 'three running cloud jobs');
  assert.deepEqual(f.started.map(row => row.slot).sort(), [0, 1, 2]);
  const foreground = job('foreground', false), fifth = job('fifth'); await f.call(foreground); await f.call(fifth);
  await waitFor(() => f.started.length === 4, 'foreground reserved slot');
  assert.equal(f.started.find(row => row.label === 'foreground').slot, 0);
  assert.equal((await f.poll(fifth)).phase, 'queued');
  f.started.find(row => row.label === 'foreground').release();
  await waitFor(async () => (await f.poll(foreground)).phase === 'complete', 'foreground completion');
  assert.equal((await f.poll(fifth)).phase, 'queued', 'Idle foreground capacity must not admit a second background.');
  assert.equal((await f.cancel(fifth)).code, 'MODEL_JOB_CANCELLED'); assert.ok(!f.started.some(row => row.label === 'fifth'));
  for (const row of f.started) row.release();
  for (const packet of background) await waitFor(async () => (await f.poll(packet)).phase === 'complete', 'background completion');
  const before = f.requests.length; await f.poll(background[0]); await f.cancel(background[0]);
  assert.ok(f.requests.slice(before).every(row => ['capacity', 'model-poll', 'model-cancel'].includes(row.packet.operation)));
  assert.ok((await f.nodes()).every(node => node.active === 0 && node.queued === 0));
  assert.ok(!JSON.stringify(f.logs).includes(KEY) && !JSON.stringify(f.logs).includes('background-'));
  for (const file of fs.readdirSync(f.directory)) {
    const content = fs.readFileSync(path.join(f.directory, file), 'utf8');
    assert.ok(!content.includes(KEY) && !background.some(packet => content.includes(packet.capability)));
  }
});

test('healthy polls renew the lease for hours without a 120-second or 600-second inference deadline', { timeout: 15000 }, async t => {
  const f = await fixture(t), packet = job(); await f.call(packet);
  await waitFor(() => f.started.length === 1, 'provider start');
  for (let i = 0; i < 90; i++) { f.timers.advance(89000); assert.equal((await f.poll(packet)).phase, 'running'); }
  assert.ok(f.timers.now() > 2 * 60 * 60 * 1000); assert.equal(f.started[0].signal.aborted, false);
  f.started[0].release(); await waitFor(async () => (await f.poll(packet)).phase === 'complete', 'long completion');
  assert.equal((await f.poll(packet)).result.choices[0].message.content, PROMPT);
  f.timers.advance(600001); assert.equal((await f.poll(packet)).code, 'MODEL_JOB_UNKNOWN');
});

test('orphan expiry aborts only its job while a queued heartbeat remains valid, and cancellation releases inference capacity', { timeout: 15000 }, async t => {
  const f = await fixture(t), first = job('orphan'), second = job('live queued');
  await f.direct(0, first); await f.direct(0, second); await waitFor(() => f.started.length === 1, 'initial inference');
  f.timers.advance(89000); assert.equal((await f.poll(second)).phase, 'queued');
  f.timers.advance(1001); await waitFor(() => f.started.length === 2, 'queued survivor');
  assert.equal((await f.poll(first)).code, 'MODEL_JOB_ORPHANED'); assert.equal(f.started[0].signal.aborted, true);
  assert.equal((await f.poll(second)).phase, 'running'); assert.equal(f.started[1].signal.aborted, false);
  assert.equal((await f.cancel(second)).code, 'MODEL_JOB_CANCELLED'); assert.equal(f.started[1].signal.aborted, true);
  await waitFor(async () => (await f.nodes())[0].active === 0, 'cancelled provider cleanup');
  assert.equal((await f.cancel(second)).code, 'MODEL_JOB_CANCELLED');
});

function childSubmit(f, packet) {
  const program = `let text='';process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',async()=>{
    const input=JSON.parse(text), native=globalThis.fetch;
    const fetchImpl=(url,options)=>{const target=new URL(url);if(target.hostname!=='127.0.0.1'||!input.ports.includes(Number(target.port)))throw Error('Nonfixture HTTP blocked');return native(url,options);};
    try{const value=await require(process.argv[1]).rpc(input.packet,{directory:input.directory,fetchImpl});process.stdout.write(JSON.stringify(value));}
    catch(error){process.stderr.write(error.message);process.exitCode=1;}});`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', program, workerFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject); child.on('close', code => { if (code) reject(Error(error)); else resolve(JSON.parse(output)); });
    child.stdin.end(JSON.stringify({ packet, directory: f.directory, ports: f.registries.map(row => row.port) }));
  });
}
test('separate CLI processes submitting the same id and capability buy inference once, including after result completion', { timeout: 15000 }, async t => {
  const f = await fixture(t), packet = job();
  const replies = await Promise.all([0, 1, 2].map(() => childSubmit(f, packet)));
  assert.ok(replies.every(reply => reply.id === packet.id && reply.capability === packet.capability));
  assert.equal(f.started.length, 1); assert.equal(fs.existsSync(path.join(f.directory, '.model-submit.lock')), false);
  await assert.rejects(f.call({ ...packet, capability: randomBytes(32).toString('hex') }), error => error.code === 'MODEL_JOB_DENIED');
  assert.equal(f.started.length, 1);
  f.started[0].release(); await waitFor(async () => (await f.poll(packet)).phase === 'complete', 'single completion');
  assert.equal((await f.call(packet)).phase, 'complete'); assert.equal(f.started.length, 1);
});

test('dead submit-lock owners are recovered only after the lease, while live owners and malformed files are never stolen', { timeout: 15000 }, async t => {
  const f = await fixture(t), file = path.join(f.directory, '.model-submit.lock');
  const child = spawn(process.execPath, ['-e', ''], { windowsHide: true, stdio: 'ignore' }), pid = child.pid;
  await once(child, 'exit'); assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
  const dead = JSON.stringify({ pid, at: Date.now() - 90001 }); fs.writeFileSync(file, dead, { mode: 0o600 });
  const packet = job('recovered dead owner'); await f.call(packet); assert.equal(f.started.length, 1); assert.equal(fs.existsSync(file), false);
  const live = JSON.stringify({ pid: process.pid, at: Date.now() - 1000000 }); fs.writeFileSync(file, live, { mode: 0o600 });
  // Existing-job retries recover their acknowledgement even when an unrelated submit lock is unavailable.
  assert.equal((await f.call(packet)).id, packet.id); assert.equal(fs.readFileSync(file, 'utf8'), live); assert.equal(f.started.length, 1);
  await assert.rejects(Pool.route(job('must not steal live lock'), { ...f.options, signal: AbortSignal.timeout(150) }), /cancelled/);
  assert.equal(fs.readFileSync(file, 'utf8'), live);
  fs.unlinkSync(file); const young = JSON.stringify({ pid, at: Date.now() }); fs.writeFileSync(file, young);
  await assert.rejects(Pool.route(job('must not steal young lock'), { ...f.options, signal: AbortSignal.timeout(150) }), /cancelled/);
  assert.equal(fs.readFileSync(file, 'utf8'), young);
  for (const metadata of ['invalid-json', JSON.stringify({ pid: -1, at: 0 }), JSON.stringify({ pid, at: Date.now(), extra: 'unexpected' })]) {
    fs.writeFileSync(file, metadata);
    await assert.rejects(f.call(job('malformed lock')), /Invalid.*lock/); assert.equal(fs.readFileSync(file, 'utf8'), metadata);
  }
  fs.unlinkSync(file); f.started[0].release();
  await waitFor(async () => (await f.poll(packet)).phase === 'complete', 'recovered job completion');
});

test('result cache eviction keeps idempotency tombstones, bounds answers and never exposes provider errors or credentials', { timeout: 15000 }, async t => {
  const f = await fixture(t); f.auto = true; const packets = [];
  for (let index = 0; index < 33; index++) {
    const packet = job('cached-' + index); packets.push(packet); await f.direct(0, packet);
    await waitFor(async () => (await f.poll(packet)).phase === 'complete', 'cached result');
  }
  assert.equal((await f.poll(packets[0])).code, 'MODEL_JOB_EXPIRED');
  assert.equal((await f.call(packets[0])).phase, 'failed'); assert.equal(f.started.length, 33);
  const wrong = await f.post(0, { operation: 'model-poll', id: randomUUID(), capability: randomBytes(32).toString('hex') }).catch(error => error);
  assert.equal(wrong.code, 'MODEL_JOB_UNKNOWN');
  f.oversize = true; const large = job('too-large'); await f.direct(0, large);
  assert.equal((await waitFor(async () => { const row = await f.poll(large); return row.phase === 'failed' && row; }, 'oversized failure')).code, 'MODEL_JOB_FAILED');
  f.oversize = false; f.providerError = true; const bad = job('provider failure'); await f.direct(0, bad);
  const failed = await waitFor(async () => { const row = await f.poll(bad); return row.phase === 'failed' && row; }, 'provider failure');
  assert.ok(!JSON.stringify({ failed, logs: f.logs }).includes(KEY));
  assert.ok(!JSON.stringify(f.logs).includes(PROMPT));
});

test('async queue admission is bounded to 32 waiting jobs and rejects malformed identities before inference', { timeout: 15000 }, async t => {
  const f = await fixture(t), first = job('blocking'); await f.direct(0, first);
  for (let i = 0; i < 32; i++) await f.direct(0, job('queued-' + i));
  await assert.rejects(f.direct(0, job('overflow')), error => error.code === 'MODEL_JOB_QUEUE_FULL');
  assert.equal((await f.nodes())[0].queued, 32); assert.equal(f.started.length, 1);
  for (const change of [{ id: '../escape' }, { capability: 'bad' }, { provider: 'ollama' }, { pcSession: 'a'.repeat(48) }]) {
    await assert.rejects(f.call({ ...job(), ...change }));
  }
  f.timers.advance(90001); await waitFor(async () => (await f.nodes())[0].active === 0 && (await f.nodes())[0].queued === 0, 'all orphan queue cleanup');
  assert.equal(f.started.length, 1);
});

test('pollModelJob exports the injected call contract, reuses submit identity after lost acknowledgement and polls without an overall clock', async () => {
  const calls = []; let submits = 0, polls = 0;
  const value = await W.pollModelJob({ provider: 'openai', body: {} }, { pollMs: 0, call: async (packet, options) => {
    calls.push(packet); assert.ok(options.signal instanceof AbortSignal);
    if (packet.operation === 'model-submit') { if (++submits === 1) throw Error('lost acknowledgement'); return { id: packet.id, capability: packet.capability, phase: 'queued' }; }
    assert.equal(packet.operation, 'model-poll');
    return ++polls < 100 ? { phase: 'running' } : { phase: 'complete', result: completion('eventual') };
  } });
  assert.equal(value.choices[0].message.content, 'eventual'); assert.equal(submits, 2); assert.equal(polls, 100);
  assert.equal(new Set(calls.map(packet => packet.id)).size, 1); assert.equal(new Set(calls.map(packet => packet.capability)).size, 1);
  assert.match(calls[0].id, /^[a-f0-9-]{36}$/); assert.match(calls[0].capability, /^[a-f0-9]{64}$/);
});

test('pollModelJob stops after five consecutive RPC failures and cancellation uses a fresh nonaborted signal', async () => {
  const calls = [];
  await assert.rejects(W.pollModelJob({ provider: 'xai' }, { pollMs: 0, call: async packet => {
    calls.push(packet); throw Error('offline RPC failure');
  } }), error => error.code === 'MODEL_JOB_RPC_FAILED');
  assert.equal(calls.filter(packet => packet.operation === 'model-submit').length, 5);
  assert.equal(calls.filter(packet => packet.operation === 'model-cancel').length, 1);
  const controller = new AbortController(); let cancelled = false;
  await assert.rejects(W.pollModelJob({ provider: 'openai' }, { signal: controller.signal, pollMs: 0, call: async (packet, options) => {
    if (packet.operation === 'model-submit') return { ...packet, phase: 'queued' };
    if (packet.operation === 'model-poll') { controller.abort(); return { phase: 'running' }; }
    assert.equal(packet.operation, 'model-cancel'); assert.equal(options.signal.aborted, false); cancelled = true;
  } }), error => error.code === 'MODEL_JOB_CANCELLED');
  assert.equal(cancelled, true);
});

test('V2 worker ownership marker cannot be mistaken for the legacy V1 deployment target', () => {
  const source = fs.readFileSync(workerFile, 'utf8'); assert.ok(source.includes('HOLODEK_WEBSITE_WORKER_V2'));
  assert.ok(!source.includes('HOLODEK_WEBSITE_WORKER_V1'));
});
