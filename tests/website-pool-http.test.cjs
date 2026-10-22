'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { randomUUID } = require('node:crypto'), { once } = require('node:events');
const { StringDecoder } = require('node:string_decoder');
const root = path.resolve(__dirname, '..'), workerRoot = path.join(root, 'tools/website-worker');
const Worker = require(path.join(workerRoot, 'worker.cjs'));
const Pool = require(path.join(workerRoot, 'workerPool.cjs'));
const Wire = require(path.join(workerRoot, 'roomWire.cjs'));
const ENGINE_HASH = 'e'.repeat(64), CREDENTIAL = 'offline-http-provider-key-' + 'A'.repeat(24);

async function waitFor(condition, label, milliseconds = 8000) {
  const deadline = Date.now() + milliseconds;
  do {
    const value = await condition();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.fail('Timed out waiting for ' + label);
}
function write(directory, relative, value) {
  const file = path.join(directory, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
}
function modelPacket(label, background) {
  return { operation: 'generate', provider: 'openai', credential: CREDENTIAL, background,
    body: { model: 'offline-http-model', stream: true, messages: [{ role: 'user', content: label }] } };
}
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-pool-http-'));
  const servers = [], registries = [], started = [], reports = [], requests = [], pending = [], failures = [];
  const abort = new AbortController(), ports = new Set();
  const track = promise => { promise.catch(() => {}); pending.push(promise); return promise; };
  t.after(async () => {
    abort.abort();
    for (const row of started) row.release();
    for (const server of servers) server.closeAllConnections();
    await Promise.allSettled(pending);
    await Promise.all(servers.map(server => new Promise(resolve => server.close(() => resolve()))));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('holodek-pool-http-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (const slot of [0, 1, 2]) {
    const fetchImpl = async (url, options) => {
      if (url === 'http://127.0.0.1:11434/api/tags') return Response.json({ models: [] });
      try {
        assert.equal(url, Worker.PROVIDERS.openai, 'provider requests must be handled by this fake, not global fetch');
        assert.equal(options.headers.Authorization, 'Bearer ' + CREDENTIAL);
        assert.equal(options.redirect, 'error');
        const body = JSON.parse(options.body);
        assert.equal(body.model, 'offline-http-model'); assert.equal(body.stream, false);
        const row = { slot, port: servers[slot].address().port, label: body.messages[0].content, released: false };
        let cancel;
        try {
          await new Promise((resolve, reject) => {
            row.release = () => { if (!row.released) { row.released = true; resolve(); } };
            cancel = () => reject(Error('Offline provider request cancelled.'));
            options.signal.addEventListener('abort', cancel, { once: true });
            started.push(row);
            if (options.signal.aborted) cancel();
          });
        } finally { options.signal.removeEventListener('abort', cancel); }
        return Response.json({ model: body.model, choices: [{ index: 0, finish_reason: 'stop',
          message: { role: 'assistant', content: row.label } }] });
      } catch (error) {
        if (!options.signal?.aborted) failures.push(error);
        throw error;
      }
    };
    const runtime = path.join(directory, slot ? `runtime-${slot + 1}.json` : 'runtime.json');
    const server = Worker.startServer({ port: 0, runtime, maxActive: slot ? 1 : 2, maxBackground: 1,
      fetchImpl, log: row => reports.push({ slot, ...row }) });
    servers.push(server);
    await once(server, 'listening');
    assert.equal(server.address().address, '127.0.0.1');
    const registry = JSON.parse(fs.readFileSync(runtime, 'utf8'));
    assert.equal(registry.port, server.address().port); assert.equal(registry.pid, process.pid);
    assert.ok(!ports.has(registry.port)); ports.add(registry.port); registries.push(registry);
  }
  write(directory, 'pool.json', { version: 1, slots: [0, 1, 2] });
  write(directory, 'active-engine.json', { hash: ENGINE_HASH });
  const loopbackFetch = (url, options = {}) => {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'http:'); assert.equal(parsed.hostname, '127.0.0.1');
    assert.ok(ports.has(Number(parsed.port)), 'HTTP requests may reach only this fixture\'s listeners');
    assert.equal(parsed.pathname, '/jobs');
    requests.push({ port: Number(parsed.port), packet: options.body ? JSON.parse(options.body) : null });
    return fetch(url, { ...options, headers: { ...options.headers, Connection: 'close' } });
  };
  const options = { directory, fetchImpl: loopbackFetch, signal: abort.signal };
  const nodes = () => Pool.inspect(options);
  const check = () => { if (failures.length) throw failures[0]; };
  return { directory, servers, registries, ports, started, reports, requests, options, nodes, track, check,
    route: packet => track(Pool.route(packet, options)),
    post: async (slot, packet, authorized = true) => {
      const registry = registries[slot];
      return loopbackFetch(`http://127.0.0.1:${registry.port}/jobs`, { method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer ' + registry.token } : {}) }, body: JSON.stringify(packet) });
    } };
}

test('real three-port HTTP pool runs three background cloud jobs, reserves slot zero for foreground, and queues the fifth background',
  { timeout: 15000 }, async t => {
    const f = await fixture(t);
    const background = ['background-a', 'background-b', 'background-c'].map(label => f.route(modelPacket(label, true)));
    await waitFor(() => { f.check(); return f.started.length === 3; }, 'three background provider calls');
    assert.equal(new Set(f.started.map(row => row.port)).size, 3);
    assert.deepEqual(f.started.map(row => row.slot).sort(), [0, 1, 2]);
    let nodes = await f.nodes();
    assert.deepEqual(nodes.map(row => row.active), [1, 1, 1]);
    assert.deepEqual(nodes.map(row => row.maxActive), [2, 1, 1]);
    assert.ok(nodes.every(row => row.maxBackground === 1 && row.modelReserved === 0));

    const foreground = f.route(modelPacket('foreground-fourth', false));
    const foregroundRow = await waitFor(() => { f.check(); return f.started.find(row => row.label === 'foreground-fourth'); }, 'reserved foreground call');
    assert.equal(foregroundRow.slot, 0);
    nodes = await f.nodes(); assert.deepEqual(nodes.map(row => row.active), [2, 1, 1]);

    let fifthSettled = false;
    const fifth = f.route(modelPacket('background-fifth', true));
    fifth.then(() => { fifthSettled = true; }, () => { fifthSettled = true; });
    nodes = await waitFor(async () => {
      f.check(); const current = await f.nodes();
      return current.reduce((sum, row) => sum + row.queued, 0) === 1 ? current : null;
    }, 'the fifth request to queue');
    const queuedSlot = nodes.find(row => row.queued === 1).slot;
    assert.equal(f.started.length, 4); assert.equal(fifthSettled, false);
    assert.ok(f.requests.some(row => row.packet.operation === 'reserve' && row.packet.background && row.packet.queue === true));

    foregroundRow.release();
    assert.equal((await foreground).choices[0].message.content, 'foreground-fourth');
    nodes = await f.nodes();
    assert.equal(nodes[0].active, 1); assert.equal(f.started.length, 4);
    assert.equal(nodes.reduce((sum, row) => sum + row.queued, 0), 1);
    assert.equal(fifthSettled, false, 'free foreground capacity must not admit a second background call');

    f.started.find(row => row.slot === queuedSlot && row.label.startsWith('background-')).release();
    const fifthRow = await waitFor(() => { f.check(); return f.started.find(row => row.label === 'background-fifth'); }, 'the queued background request to start');
    assert.equal(fifthRow.slot, queuedSlot);
    for (const row of f.started) row.release();
    const results = await Promise.all([...background, fifth]);
    assert.deepEqual(results.map(row => row.choices[0].message.content).sort(),
      ['background-a', 'background-b', 'background-c', 'background-fifth'].sort());
    nodes = await f.nodes();
    assert.ok(nodes.every(row => row.active === 0 && row.queued === 0 && row.modelReserved === 0));
    assert.ok(!JSON.stringify(f.reports).includes(CREDENTIAL)); f.check();
  });

function installTinyEngine(f) {
  const engine = path.join(f.directory, 'engines', ENGINE_HASH), gates = path.join(f.directory, 'gates');
  fs.mkdirSync(gates);
  write(engine, '.installed.json', { hash: ENGINE_HASH, manifestHash: 'f'.repeat(64), ready: true });
  write(engine, 'retort/remoteRoomWorker.js', `'use strict';
const fs = require('node:fs'), path = require('node:path');
const { parentPort, workerData, threadId } = require('node:worker_threads');
const { job, snapshot } = workerData;
parentPort.postMessage({type:'checkpoint', artifact:{jobId:job.id, key:job.key, runId:job.runId,
  stage:job.stage, threadId, cells:new Uint16Array([1,2,3])}});
const timer = setInterval(() => {
  if (!fs.existsSync(path.join(snapshot.gates, job.id + '.release'))) return;
  clearInterval(timer); parentPort.postMessage({type:'done'}); parentPort.close();
}, 5);
`);
  return gates;
}
async function readRoom(response, checkpoint) {
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /ndjson/);
  const decoder = new StringDecoder('utf8'), rows = []; let pending = '';
  function consume(line) {
    if (!line.trim()) return;
    const row = JSON.parse(line); assert.notEqual(row.type, 'failed', row.reason);
    if (row.type === 'checkpoint') checkpoint(Wire.unpack(row.value));
    rows.push(row);
  }
  for await (const bytes of response.body) {
    pending += decoder.write(Buffer.from(bytes));
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
  }
  pending += decoder.end(); if (pending.trim()) consume(pending);
  return rows;
}

test('simultaneous real HTTP compute reservations occupy three ports and run three tiny checkpoint workers',
  { timeout: 15000 }, async t => {
    const f = await fixture(t), gates = installTinyEngine(f), checkpoints = [];
    const jobs = ['geometry', 'music', 'art'].map((stage, index) => ({ id: randomUUID(), key: `${index},1,0`, name: 'Offline fixture',
      coords: { x: index, y: 1, z: 0 }, runId: 'offline-run', model: 'offline-model', stage }));
    const responses = await Promise.all(jobs.map(job => f.route({ operation: 'room-stage', engineHash: ENGINE_HASH, background: true,
      payload: Wire.pack({ job, snapshot: { gates }, flags: {}, provider: 'ollama' }) })));
    assert.equal(new Set(responses.map(response => new URL(response.url).port)).size, 3);
    const streams = responses.map(response => f.track(readRoom(response, message => checkpoints.push(message.artifact))));
    await waitFor(() => checkpoints.length === 3, 'three live fixture worker checkpoints');
    assert.equal(new Set(checkpoints.map(row => row.threadId)).size, 3);
    assert.deepEqual(checkpoints.map(row => row.stage).sort(), ['art', 'geometry', 'music']);
    assert.deepEqual(new Set(checkpoints.map(row => row.jobId)), new Set(jobs.map(job => job.id)));
    for (const row of checkpoints) {
      assert.ok(row.cells instanceof Uint16Array); assert.deepEqual([...row.cells], [1, 2, 3]);
    }
    let nodes = await f.nodes();
    assert.ok(nodes.every(row => row.computeActive === 1 && row.computeQueued === 0 && row.computeReserved === 0));
    assert.equal(f.started.length, 0, 'fixture workers must not call a model or Ollama');
    for (const job of jobs) write(gates, job.id + '.release', 'release');
    const rows = await Promise.all(streams);
    assert.ok(rows.every(stream => stream.length === 2 && stream[0].type === 'checkpoint' && stream[1].type === 'done'));
    nodes = await f.nodes();
    assert.ok(nodes.every(row => row.computeActive === 0 && row.computeQueued === 0));
    assert.equal(f.reports.filter(row => row.phase === 'room-completed').length, 3);
    f.check();
  });

test('real HTTP listener enforces authorization, rejects null packets and validates reservation identity',
  { timeout: 15000 }, async t => {
    const f = await fixture(t);
    const denied = await f.post(0, { operation: 'capacity' }, false);
    assert.equal(denied.status, 403); await denied.json();
    const invalid = await f.post(0, null);
    assert.equal(invalid.status, 400); assert.match((await invalid.json()).error, /Invalid worker packet/);
    const reserved = await f.post(0, { operation: 'reserve', kind: 'room', background: true });
    const { value } = await reserved.json(); assert.equal(value.available, true); assert.match(value.lease, /^[a-f0-9]{48}$/);
    const wrongKind = await f.post(0, { ...modelPacket('must-not-start', true), lease: value.lease });
    assert.equal(wrongKind.status, 400); assert.match((await wrongKind.json()).error, /reservation expired or mismatched/);
    assert.equal(f.started.length, 0);
    const nodes = await f.nodes(); assert.equal(nodes[0].computeReserved, 1); assert.equal(nodes[0].active, 0);
    f.check();
  });
