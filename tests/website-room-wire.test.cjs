'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), zlib = require('node:zlib'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..'), workerRoot = path.join(root, 'tools/website-worker');
const Wire = require(path.join(workerRoot, 'roomWire.cjs'));
const Pool = require(path.join(workerRoot, 'workerPool.cjs'));
const Task = require(path.join(workerRoot, 'roomTask.cjs'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const engineHash = 'e'.repeat(64), bundleHash = 'b'.repeat(64), jobId = '12345678-1234-4234-9234-123456789abc';
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-room-wire-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(directory, file, value) {
  const target = path.join(directory, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
}
function envelope(text) {
  const compressed = zlib.gzipSync(Buffer.from(text));
  return { encoding: 'gzip-json-v1', bytes: compressed.toString('base64'), sha256: hash(compressed) };
}
function poolFixture(t) {
  const directory = temporary(t), calls = [], leases = [new Map(), new Map(), new Map()], queueFull = new Set();
  let sequence = 0;
  write(directory, 'pool.json', { version: 1, slots: [0, 1, 2] });
  const rows = [0, 1, 2].map(slot => ({ version: 1, port: 32001 + slot, pid: 9000 + slot,
    token: String(slot + 1).repeat(64), bundleHash }));
  const capacity = rows.map(row => ({ pid: row.pid, port: row.port, bundleHash, engineHash,
    active: 0, queued: 0, computeActive: 0, computeQueued: 0, maxActive: 2, maxBackground: 2 }));
  const save = () => rows.forEach((row, i) => write(directory, i ? `runtime-${i + 1}.json` : 'runtime.json', row));
  save();
  const fetchImpl = async (url, options) => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:3200[1-3]\/jobs$/);
    const slot = Number(new URL(url).port) - 32001, packet = JSON.parse(options.body);
    calls.push({ slot, packet, options });
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + rows[slot].token);
    const reserved = kind => [...leases[slot].values()].filter(lease => lease.kind === kind);
    if (packet.operation === 'capacity') return Response.json({ value: { ...capacity[slot],
      computeReserved: reserved('room').length, modelReserved: reserved('model').length } });
    if (packet.operation === 'status') return Response.json({ value: { ...capacity[slot], version: 1 } });
    if (packet.operation === 'reserve') {
      assert.ok(['room', 'model'].includes(packet.kind));
      assert.equal(Object.hasOwn(packet, 'credential'), false);
      assert.equal(Object.hasOwn(packet, 'payload'), false);
      const row = capacity[slot], held = reserved(packet.kind);
      const occupied = packet.kind === 'room' ? row.computeActive + row.computeQueued + held.length : row.active + row.queued + held.length;
      const backgroundOccupied = (row.activeBackground || 0) + reserved('model').filter(lease => lease.background).length;
      if (!packet.queue && (occupied >= (packet.kind === 'room' ? 1 : row.maxActive) ||
          packet.kind === 'model' && packet.background && backgroundOccupied >= row.maxBackground)) return Response.json({ value: { available: false } });
      if (packet.queue && queueFull.has(slot) || held.length >= 16) return Response.json({ error: 'Website worker queue is full.' }, { status: 400 });
      const lease = hash(Buffer.from(`${slot}:${++sequence}`)).slice(0, 48);
      leases[slot].set(lease, { kind: packet.kind, background: packet.background === true });
      return Response.json({ value: { available: true, lease } });
    }
    const kind = packet.operation === 'room-stage' ? 'room' : 'model', held = leases[slot].get(packet.lease);
    assert.ok(held, 'actual request must carry a lease from this listener');
    assert.equal(held.kind, kind); assert.equal(held.background, packet.background === true);
    leases[slot].delete(packet.lease);
    // Retain simulated in-flight occupancy while concurrent routes finish dispatching.
    if (kind === 'room') capacity[slot].computeActive++; else capacity[slot].active++;
    if (packet.operation === 'room-stage') return new Response('{"type":"done"}\n', { headers: { 'content-type': 'application/x-ndjson' } });
    return Response.json({ value: { slot, choices: [] } });
  };
  return { directory, rows, capacity, calls, save, fetchImpl, leases, queueFull };
}
function taskFixture(t) {
  const directory = temporary(t), engine = path.join(directory, 'engines', engineHash);
  write(engine, 'retort/remoteRoomWorker.js', 'throw Error("Test workers must never execute");\n');
  write(engine, '.installed.json', { hash: engineHash, manifestHash: 'f'.repeat(64), ready: true });
  const payload = { job: { id: jobId, key: '0,1,0', coords: { x: 0, y: 1, z: 0 }, name: 'Road',
    runId: 'offline-run', model: 'offline-model', stage: 'geometry' }, provider: 'ollama', snapshot: {},
    gateway: '/untrusted/override.cjs', background: false };
  return { directory, engine, payload, packet: () => ({ engineHash, background: true, operation: 'room-stage', payload: Wire.pack(payload) }) };
}

test('room wire preserves supported typed arrays, subarray bounds, nested objects and empty arrays', () => {
  const value = { unicode: 'A\u00e9\u6f22', nested: { ok: true }, arrays: {} };
  for (const Type of [Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array]) {
    value.arrays[Type.name] = new Type([9, 1, 2, 3, 8]).subarray(1, 4);
    value.arrays[Type.name + 'Empty'] = new Type(0);
  }
  const result = Wire.unpack(Wire.pack(value));
  for (const [name, array] of Object.entries(value.arrays)) {
    assert.equal(result.arrays[name].constructor, array.constructor);
    assert.deepEqual([...result.arrays[name]], [...array]);
  }
  assert.equal(result.unicode, value.unicode); assert.deepEqual(result.nested, value.nested);
});

test('room wire checks hash, encoding and compressed data before decoding JSON', () => {
  const packet = Wire.pack({ ok: true });
  assert.throws(() => Wire.unpack({ ...packet, sha256: '0'.repeat(64) }), /checksum/);
  assert.throws(() => Wire.unpack({ ...packet, encoding: 'raw-json' }), /Invalid/);
  assert.throws(() => Wire.unpack({ ...packet, bytes: '../not-base64' }), /Invalid/);
  assert.throws(() => Wire.unpack(envelope('not JSON')));
  const invalid = Buffer.from('not gzip');
  assert.throws(() => Wire.unpack({ encoding: 'gzip-json-v1', bytes: invalid.toString('base64'), sha256: hash(invalid) }));
});

test('room wire rejects prototype-bearing object fields recursively', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => Wire.unpack(envelope('{"nested":{"' + key + '":{"polluted":true}}}')), /Unsafe/);
  }
  assert.equal({}.polluted, undefined);
});

test('room wire bounds gzip expansion, tested with a reduced limit to avoid a 256 MB allocation', () => {
  const source = fs.readFileSync(path.join(workerRoot, 'roomWire.cjs'), 'utf8');
  const reduced = source.replace(/const MAX_JSON\s*=\s*[^,;]+/, 'const MAX_JSON = 64 * 1024');
  assert.notEqual(reduced, source);
  const module = { exports: {} };
  vm.runInNewContext('(function(require,module,Buffer){' + reduced + '\n})', {})
    (name => { assert.ok(['node:zlib', 'node:crypto'].includes(name)); return require(name); }, module, Buffer);
  assert.equal(module.exports.MAX_JSON, 64 * 1024);
  const packet = envelope(JSON.stringify({ text: 'x'.repeat(128 * 1024) }));
  assert.throws(() => module.exports.unpack(packet), /larger|limit|length|buffer/i);
});

test('room wire transports path-looking data inertly rather than treating it as an extraction path', () => {
  const value = { path: '../../keys/openai.key', directory: 'C:\\private\\file', nested: ['/etc/passwd', '\\server\\share'] };
  assert.deepEqual(Wire.unpack(Wire.pack(value)), value);
});

test('room wire rejects unknown and misaligned typed-array representations', () => {
  for (const value of [{ __holodekTyped: 'NoSuchArray', bytes: '' }, { __holodekTyped: 'Uint32Array', bytes: 'AQ==' }])
    assert.throws(() => Wire.unpack(envelope(JSON.stringify(value))), /array/);
});

test('room wire rejects malformed base64 inside a typed array', () => {
  assert.throws(() => Wire.unpack(envelope('{"__holodekTyped":"Uint8Array","bytes":"not valid !!!"}')), /array|encoding|base64/i);
});

test('room wire accepts only own allowlisted typed-array constructors', () => {
  assert.throws(() => Wire.unpack(envelope('{"__holodekTyped":"constructor","bytes":"AQ=="}')), /array|type/i);
});

test('pool verifies three distinct loopback listeners before routing any credentials', async t => {
  const f = poolFixture(t), nodes = await Pool.inspect(f);
  assert.equal(nodes.length, 3); assert.equal(new Set(nodes.map(n => n.port)).size, 3);
  assert.deepEqual(f.calls.map(c => c.packet.operation), ['capacity', 'capacity', 'capacity']);
  assert.ok(f.calls.every(c => !Object.hasOwn(c.packet, 'credential')));
});

test('pool routes model and compute work by their respective advertised loads', async t => {
  const f = poolFixture(t);
  Object.assign(f.capacity[0], { active: 2, queued: 2, computeActive: 0 });
  Object.assign(f.capacity[1], { active: 0, queued: 0, computeActive: 2 });
  Object.assign(f.capacity[2], { active: 1, queued: 0, computeActive: 1 });
  const model = await Pool.route({ operation: 'generate', credential: 'offline-not-a-key' }, f);
  assert.equal(model.slot, 1);
  const response = await Pool.route({ operation: 'room-stage', engineHash }, f);
  assert.equal(await response.text(), '{"type":"done"}\n');
  assert.equal(f.calls.at(-1).slot, 0);
});

test('pool excludes stale PID and bundle identities without sending them provider keys', async t => {
  const f = poolFixture(t);
  f.capacity[0].pid++; f.capacity[1].bundleHash = 'a'.repeat(64);
  await Pool.route({ operation: 'generate', credential: 'offline-not-a-key' }, f);
  assert.deepEqual(f.calls.filter(c => c.packet.operation === 'generate').map(c => c.slot), [2]);
  f.capacity[2].pid++;
  await assert.rejects(Pool.route({ operation: 'generate', credential: 'must-not-be-sent' }, f), /No verified/);
  assert.ok(!f.calls.some(c => c.packet.credential === 'must-not-be-sent'));
});

test('pool refuses malformed registries and path-like slot names before making requests', async t => {
  const f = poolFixture(t);
  write(f.directory, 'pool.json', { version: 1, slots: [0, '../escape', 2] });
  await assert.rejects(Pool.inspect(f), /Invalid worker pool/); assert.equal(f.calls.length, 0);
  for (const change of [{ port: 0 }, { port: 65536 }, { token: 'bad' }, { pid: '9000' }]) {
    write(f.directory, 'bad.json', { ...f.rows[0], ...change });
    assert.throws(() => Pool.registry(path.join(f.directory, 'bad.json')), /Invalid/);
  }
});

test('pool status totals capacity but does not disclose private registry bearer tokens', async t => {
  const f = poolFixture(t);
  f.capacity.forEach((row, i) => { row.active = i; row.computeQueued = i + 1; });
  const result = await Pool.status(f);
  assert.equal(result.roomWorkers, 3); assert.equal(result.active, 3); assert.equal(result.computeQueued, 6);
  for (const row of f.rows) assert.ok(!JSON.stringify(result).includes(row.token));
});

test('pool forwards room-stage NDJSON using only fake fetch', async t => {
  const f = poolFixture(t), chunks = [];
  await Pool.stream({ operation: 'room-stage', engineHash }, { ...f, write: chunk => { chunks.push(chunk); } });
  assert.equal(Buffer.concat(chunks).toString(), '{"type":"done"}\n');
});

test('concurrent idle room stages reserve all three listeners atomically', async t => {
  const f = poolFixture(t);
  await Promise.all(['geometry', 'music', 'art'].map(stage => Pool.route({ operation: 'room-stage', engineHash, stage }, f)));
  const slots = f.calls.filter(c => c.packet.operation === 'room-stage').map(c => c.slot);
  assert.equal(new Set(slots).size, 3, 'simultaneous stage routes should consume the three idle listeners');
  assert.ok(f.calls.filter(c => c.packet.operation === 'room-stage').every(c => /^[a-f0-9]{48}$/.test(c.packet.lease)));
  assert.ok(f.leases.every(leases => leases.size === 0));
});

test('pool rejects the whole pool when registry ports are duplicated', async t => {
  const f = poolFixture(t);
  f.rows[1] = { ...f.rows[0] }; f.rows[2] = { ...f.rows[0] }; f.save();
  f.capacity[1] = { ...f.capacity[0] }; f.capacity[2] = { ...f.capacity[0] };
  await assert.rejects(Pool.inspect(f), /Duplicate worker listener/);
  assert.ok(f.calls.every(call => call.packet.operation === 'capacity'));
});

test('pool excludes registries without verifiable bundle hashes and rejects when none remain', async t => {
  const f = poolFixture(t);
  delete f.rows[0].bundleHash; f.save();
  assert.throws(() => Pool.registry(path.join(f.directory, 'runtime.json')), /Invalid/);
  assert.deepEqual((await Pool.inspect(f)).map(node => node.slot), [1, 2]);
  delete f.rows[1].bundleHash; delete f.rows[2].bundleHash; f.save();
  f.calls.length = 0;
  await assert.rejects(Pool.inspect(f), /No verified/);
  assert.equal(f.calls.length, 0);
});

test('pool obtains an explicitly queued lease only after all immediate reservations are unavailable', async t => {
  const f = poolFixture(t);
  f.capacity.forEach(row => { row.computeActive = 1; });
  await Pool.route({ operation: 'room-stage', engineHash, background: true }, f);
  const reservations = f.calls.filter(call => call.packet.operation === 'reserve');
  assert.deepEqual(reservations.map(call => call.slot), [0, 1, 2, 0]);
  assert.ok(reservations.slice(0, 3).every(call => call.packet.queue === undefined));
  assert.equal(reservations.at(-1).packet.queue, true);
  assert.ok(reservations.every(call => call.packet.kind === 'room' && call.packet.background === true));
  assert.equal(f.calls.at(-1).packet.operation, 'room-stage');
});

test('pool does not send work or credentials when queued reservations are rejected', async t => {
  const f = poolFixture(t);
  f.capacity.forEach(row => { row.active = row.maxActive; }); f.queueFull.add(0);
  await assert.rejects(Pool.route({ operation: 'generate', credential: 'must-not-be-sent' }, f), /queue is full/);
  assert.ok(f.calls.every(call => !Object.hasOwn(call.packet, 'credential')));
});

test('Ollama reserves only slot zero even when other model listeners are idle', async t => {
  const f = poolFixture(t);
  f.capacity[0].active = f.capacity[0].maxActive;
  const result = await Pool.route({ operation: 'generate', provider: 'ollama', background: true }, f);
  assert.equal(result.slot, 0);
  const reservations = f.calls.filter(call => call.packet.operation === 'reserve');
  assert.deepEqual(reservations.map(call => call.slot), [0, 0]);
  assert.ok(reservations.every(call => call.packet.kind === 'model'));
  assert.equal(reservations.at(-1).packet.queue, true);
  f.capacity[0].pid++;
  await assert.rejects(Pool.route({ operation: 'generate', provider: 'ollama' }, f), /serialized Ollama gateway/);
});

test('room task restricts engine hashes to one fixed generation path', t => {
  const f = taskFixture(t);
  assert.equal(Task.engine(f.directory, engineHash), f.engine);
  for (const bad of ['../escape', '/tmp/escape', 'C:\\escape', '../' + engineHash, 'E'.repeat(64), 'e'.repeat(63), 'e'.repeat(65)])
    assert.throws(() => Task.engine(f.directory, bad), /Invalid/);
  assert.throws(() => Task.engine(f.directory, 'a'.repeat(64)), /not installed/);
});

test('room task validates wire identity and overrides caller gateway/background before a fake worker starts', async t => {
  const f = taskFixture(t), sent = []; let terminated = 0;
  await Task.run(f.packet(), { directory: f.directory, send: row => { sent.push(row); }, spawn: (file, options) => {
    assert.equal(file, path.join(f.engine, 'retort/remoteRoomWorker.js'));
    assert.equal(options.workerData.gateway, path.join(f.directory, 'worker.cjs'));
    assert.equal(options.workerData.background, true);
    assert.ok(options.resourceLimits.maxOldGenerationSizeMb <= 1024);
    const worker = new EventEmitter(); worker.stdout = worker.stderr = { resume() {} };
    worker.terminate = async () => { terminated++; };
    setImmediate(() => { worker.emit('message', { type: 'checkpoint', artifact: { samples: new Float32Array([1, 2]) } }); worker.emit('message', { type: 'done' }); });
    return worker;
  } });
  assert.deepEqual(sent.map(row => row.type), ['checkpoint', 'done']);
  assert.deepEqual([...Wire.unpack(sent[0].value).artifact.samples], [1, 2]); assert.equal(terminated, 1);
});

test('room task rejects invalid provider, stage and job paths without spawning', async t => {
  const f = taskFixture(t);
  for (const mutate of [p => { p.provider = 'https://attacker.invalid'; }, p => { p.job.stage = '../escape'; },
    p => { p.job.id = '../../escape'; }, p => { p.provider = 'openai'; p.credential = 'short'; }, p => { p.job.key = '../escape'; }]) {
    const payload = structuredClone(f.payload); mutate(payload);
    await assert.rejects(Task.run({ engineHash, payload: Wire.pack(payload) }, {
      directory: f.directory, send() { assert.fail('must not send'); }, spawn() { assert.fail('must not spawn'); }
    }), /Invalid|needs a provider/);
  }
});

test('room task terminates its fake worker on abort and rejects incomplete output', async t => {
  const f = taskFixture(t), controller = new AbortController(); let terminated = 0;
  const running = Task.run(f.packet(), { directory: f.directory, signal: controller.signal, send() {}, spawn() {
    const worker = new EventEmitter();
    worker.terminate = async () => { terminated++; setImmediate(() => worker.emit('exit', 1)); };
    return worker;
  } });
  controller.abort(); await assert.rejects(running, /cancelled/); assert.ok(terminated >= 1);
});

test('room task rejects checkpoint send failure and still terminates its fake worker', async t => {
  const f = taskFixture(t); let terminated = false;
  await assert.rejects(Task.run(f.packet(), { directory: f.directory, send: async () => { throw Error('offline closed stream'); }, spawn() {
    const worker = new EventEmitter(); worker.terminate = async () => { terminated = true; };
    setImmediate(() => worker.emit('message', { type: 'checkpoint', artifact: {} })); return worker;
  } }), /closed stream/);
  assert.equal(terminated, true);
});

test('room task checks installed receipt identity before trusting an engine', t => {
  const f = taskFixture(t);
  write(f.engine, '.installed.json', { hash: 'a'.repeat(64), ready: false });
  assert.throws(() => Task.engine(f.directory, engineHash), /identity|verified|installed|receipt/i);
});

test('room task rejects a symlinked engine generation', t => {
  const f = taskFixture(t), outside = temporary(t), linkHash = 'a'.repeat(64);
  write(outside, 'retort/remoteRoomWorker.js', '// external code\n');
  write(outside, '.installed.json', { hash: linkHash, ready: true });
  try { fs.symlinkSync(outside, path.join(f.directory, 'engines', linkHash), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('OS does not allow test symlinks'); throw error; }
  assert.throws(() => Task.engine(f.directory, linkHash), /symlink|Unsafe|verified|directory/i);
});

test('room-stage work orders exclude host Timeout objects', async t => {
  const RoomBuild = require(path.join(root, 'retort/websiteRoomBuild'));
  const job = { id: jobId, key: '0,1,0', coords: { x: 0, y: 1, z: 0 }, name: 'Road', runId: 'run', model: 'offline-model' };
  job.timer = setTimeout(() => {}, 30000); t.after(() => clearTimeout(job.timer));
  const rooms = { [job.key]: { name: job.name, populationComplete: true, description: 'A sufficiently long road description.' } };
  const worker = RoomBuild.spawnBuild(job, { roomNameDatabaseString: JSON.stringify(rooms), roomDungeonDatabase: {} }, {
    runStage: async (stageJob, snapshot, { onCheckpoint }) => {
      Wire.pack({ job: stageJob, snapshot });
      onCheckpoint({ artifact: { key: job.key, runId: job.runId, stage: stageJob.stage, rooms: structuredClone(rooms) } });
    }
  });
  const result = await new Promise(resolve => worker.on('message', row => { if (['done', 'failed'].includes(row.type)) resolve(row); }));
  assert.equal(result.type, 'done', result.reason);
});

test('authenticated null worker packets produce a protocol error, not an unhandled async rejection',
  async t => {
    const directory = temporary(t), runtime = path.join(directory, 'runtime.json');
    let handler;
    const server = { address: () => ({ port: 32001 }), listen(port, host, ready) {
      assert.equal(host, '127.0.0.1'); setImmediate(ready); return this;
    } };
    const source = fs.readFileSync(path.join(workerRoot, 'worker.cjs'), 'utf8'), module = { exports: {} };
    const localRequire = name => {
      if (name === 'node:http') return { createServer: callback => { handler = callback; return server; } };
      if (name.startsWith('.')) return require(path.join(workerRoot, name));
      return require(name);
    };
    vm.runInNewContext('(function(require,module,__dirname,__filename){' + source + '\n})', {
      process, Buffer, console, AbortController, AbortSignal, setTimeout, clearTimeout, setImmediate
    })(localRequire, module, workerRoot, path.join(workerRoot, 'worker.cjs'));
    module.exports.startServer({ runtime, log() {} });
    await new Promise(resolve => setImmediate(resolve));
    const registry = JSON.parse(fs.readFileSync(runtime, 'utf8'));
    const req = { method: 'POST', url: '/jobs', headers: { authorization: 'Bearer ' + registry.token },
      async *[Symbol.asyncIterator]() { yield Buffer.from('null'); } };
    const res = new EventEmitter(); res.setHeader = () => {}; res.destroyed = false;
    res.end = body => { res.body = JSON.parse(body); res.writableFinished = true; };
    await handler(req, res);
    assert.equal(res.statusCode, 400); assert.ok(res.body.error);
  });

test('remote cloud completion calls cannot bypass the website model gateway',
  async () => {
    let direct = 0, gateway = 0;
    const result = { choices: [{ finish_reason: 'stop', message: { content: 'offline answer' } }] };
    const directClient = { chat: { completions: { create: async () => { direct++; return result; } } } };
    const gatewayClient = { chat: { completions: { create: async () => { gateway++; return result; } } } };
    const models = { profile: () => ({ id: 'gpt-6-luna', provider: 'openai' }), getClient: () => gatewayClient };
    const module = { exports: {} }, source = fs.readFileSync(path.join(root, 'retort/modelTransport.js'), 'utf8');
    vm.runInNewContext('(function(require,module){' + source + '\n})', {
      process: { env: { HOLODEK_REMOTE_ENGINE: '1' } }, AbortController, setTimeout, clearTimeout
    })(name => {
      if (name === './gameModels') return models;
      if (name === './generationFailure') return require('../retort/generationFailure');
      if (name === './generationPolicy') return require('../retort/generationPolicy');
      if (name === './settingLayer') return { applyBody: body => body };
      if (name === './generationDiagnostics') return { report() {} };
      throw Error('Unexpected offline dependency: ' + name);
    }, module);
    await module.exports.complete(directClient, { model: 'gpt-6-luna', messages: [{ role: 'user', content: 'offline' }] }, { models });
    assert.equal(direct, 0); assert.equal(gateway, 1);
  });
