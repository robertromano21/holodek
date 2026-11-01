'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const installer = path.resolve(__dirname, '../.retort-data/host-local-floors/install.cjs');
const source = fs.existsSync(installer) ? fs.readFileSync(installer, 'utf8') : '';
const releaseTest = source ? test : (name, fn) => test(name, { skip: 'Local release updater is not part of a clean checkout.' }, fn);
async function run({ busy = false, changedPid = false, failedConnect = false, missingStatus = false, pinnedRelease = false,
  warming = 0, partialPool = false, connecting = false, failedStatus = false, lifecycleFailures = 0, invalidSlot = false, localMode = false, flags = ['--helpers'] } = {}) {
  const hash = 'a'.repeat(64), calls = [], written = [], errors = [], output = []; let lifeCalls = 0, websiteCalls = 0, direct = 0, clock = 0;
  const workers = [0, 1, 2].map(slot => ({ slot, pid: 100 + slot, port: 3100 + slot, engineHash: hash, active: busy ? 1 : 0, queued: 0 }));
  if(invalidSlot)workers[2].slot=3;
  const report = { sourceStable: true, engineHash: hash, full: { tests: 10, pass: 9, fail: 1, newFailures: [], cancelled: 0 },
    focused: { tests: 5, pass: 5, fail: 0 }, files: {}, helpers: { tests: 5, pass: 5, fail: 0 } };
  const fakeFs = { readFileSync(file) {
    if (String(file).endsWith('connection.json')) return JSON.stringify({ host: 'example.invalid', user: 'helper' });
    if (String(file).includes('helper-release-sync')) return JSON.stringify({ engineHash: hash, tests: 5, pass: 5, fail: 0, files: {} });
    return JSON.stringify(report);
  }, writeFileSync(file, value) { written.push({ file: String(file), value: JSON.parse(value) }); } };
  const process = { argv: ['node', 'install.cjs', ...flags], chdir() {}, exitCode: 0 };
  const fakeRequire = name => {
    if (name === 'node:fs') return fakeFs;
    if (name === 'node:path') return path;
    if (name === 'node:crypto') return require(name);
    if (name.endsWith('websiteEngineBundle')) return { build: () => ({ hash }) };
    if (name.endsWith('websiteAi')) return { normalize: config => config, createService() { direct++; throw Error('Protected keys must not be read by this process.'); } };
    if (name.endsWith('roomEngineCompatibility')) return { assertCompatible(worker, expected) { assert.equal(expected, hash); assert.equal(worker.pool.length, 3); } };
    throw Error('Unexpected import: ' + name);
  };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/game/lifecycle')) { lifeCalls++; return { ok: lifeCalls > lifecycleFailures, json: async () => ({ pid: changedPid && lifeCalls > 1 ? 2 : 1, port: 3000 }) }; }
    if (url.endsWith('/room-helpers')) return { ok: true, json: async () => ({ location: localMode ? 'local' : 'website',
      engineHash: pinnedRelease ? 'b'.repeat(64) : hash, concurrency: 3, active: 0, queued: 0 }) };
    if (url.endsWith('/website-ai/connect')) return { ok: !failedConnect, json: async () => failedConnect ? { error: 'Installation declined' } : { worker: { pool: workers } } };
    const fresh=url.endsWith('/website-ai/status'), waiting=!fresh&&++websiteCalls<=warming;
    return { ok: !fresh||!failedStatus, json: async () => ({ connected: !waiting||partialPool||connecting, connecting: waiting&&connecting,
      worker: missingStatus||waiting&&!partialPool&&!connecting ? undefined : { pool: waiting&&partialPool ? workers.slice(0,2) : workers },
      release: { engineHash: pinnedRelease ? 'b'.repeat(64) : hash } }) };
  };
  await vm.runInNewContext(source, { require: fakeRequire, __dirname: path.resolve(__dirname, '../.retort-data/host-local-floors'),
    process, fetch, AbortSignal, Date: class extends Date { static now(){return clock;} },
    setTimeout: (callback, ms) => { clock+=ms; queueMicrotask(callback); },
    console: { log: v => output.push(v), error: v => errors.push(v) } });
  return { process, calls, written, errors, output, direct, clock };
}

releaseTest('verified helper installer deploys through the running application without reading protected keys or restarting PC servers', async () => {
  const result = await run(); assert.equal(result.process.exitCode, 0, result.errors.join(' ')); assert.equal(result.direct, 0);
  const request = result.calls.find(c => c.url.endsWith('/website-ai/connect'));
  assert.equal(request.options.method, 'POST'); assert.equal(JSON.parse(request.options.body).deploy, true);
  const receipt = result.written.find(w => path.basename(w.file) === 'installation.json').value;
  assert.equal(receipt.deployment, 'running-application'); assert.equal(receipt.before.pid, receipt.after.pid);
  assert.equal(receipt.gameServer2, 'untouched'); assert.equal(receipt.serverRestarts.length, 0); assert.equal(receipt.workers.length, 3);
  assert.ok(result.calls.some(c=>c.url.endsWith('/website-ai/status')&&c.options.method==='POST'));
  assert.match(result.output.at(-1), /no additional server restart is needed/);
});

releaseTest('busy helpers block installation before any deploy request', async () => {
  const result = await run({ busy: true }); assert.equal(result.process.exitCode, 1); assert.match(result.errors[0], /helper is generating/);
  assert.equal(result.calls.some(c => c.url.endsWith('/website-ai/connect')), false);
});

releaseTest('local helper verification requires no website connection, deployment, SSH key access or server restart', async () => {
  const result = await run({ localMode: true }); assert.equal(result.process.exitCode, 0, result.errors.join(' '));
  assert.equal(result.calls.some(call => call.url.includes('/website-ai')), false); assert.equal(result.direct, 0);
  assert.equal(result.written.length, 0); assert.match(result.output.at(-1), /No website deployment/);
});

releaseTest('failed application deployment never falls back to reading the protected SSH identity', async () => {
  const result = await run({ failedConnect: true }); assert.equal(result.process.exitCode, 1); assert.equal(result.direct, 0);
  assert.equal(result.written.some(w => path.basename(w.file) === 'installation.json'), false); assert.match(result.errors[0], /Installation declined/);
});

releaseTest('a PC server restart during installation is detected rather than marked successful', async () => {
  const result = await run({ changedPid: true }); assert.equal(result.process.exitCode, 1); assert.match(result.errors[0], /PC server restarted/);
  assert.equal(result.written.some(w => path.basename(w.file) === 'installation.json'), false);
});

releaseTest('check-only installer performs no network or deployment requests', async () => {
  const result = await run({ flags: ['--check'] }); assert.equal(result.process.exitCode, 0);
  assert.equal(result.calls.length, 0); assert.equal(result.direct, 0); assert.equal(result.written.length, 0);
});

releaseTest('missing helper status fails closed before deployment instead of assuming workers are idle', async () => {
  const result = await run({ missingStatus: true }); assert.equal(result.process.exitCode, 1);
  assert.match(result.errors[0], /Cannot verify all three helper statuses/);
  assert.equal(result.calls.some(c => c.url.endsWith('/website-ai/connect')), false); assert.equal(result.direct, 0);
  assert.ok(result.clock>0&&result.clock<=180000);
});

releaseTest('startup readiness waits for reconnection, a partial pool or an in-progress connection before deploying once', async () => {
  for(const options of [{warming:3},{warming:3,partialPool:true},{warming:3,connecting:true},{lifecycleFailures:2}]){
    const result=await run(options);
    assert.equal(result.process.exitCode,0,result.errors.join(' '));assert.equal(result.direct,0);
    assert.ok(result.clock>=2000);assert.equal(result.calls.filter(c=>c.url.endsWith('/website-ai/connect')).length,1);
    assert.equal(result.output.filter(line=>line.startsWith('Waiting for')).length,1);
  }
});

releaseTest('a server that remains unavailable times out without opening a direct SSH service or attempting deployment', async () => {
  const result=await run({lifecycleFailures:1000});
  assert.equal(result.process.exitCode,1);assert.equal(result.direct,0);
  assert.match(result.errors[0],/after waiting for startup/);
  assert.match(result.errors[0],/without restarting gameServer/);
  assert.equal(result.calls.some(c=>c.url.endsWith('/website-ai/connect')),false);
});

releaseTest('fresh status failure and an invalid helper slot never produce a successful installation receipt', async () => {
  for(const options of [{failedStatus:true},{invalidSlot:true}]){
    const result=await run(options);assert.equal(result.process.exitCode,1);
    assert.equal(result.written.some(w=>path.basename(w.file)==='installation.json'),false);
    assert.equal(result.direct,0);
  }
});
releaseTest('a pinned old PC release requests a user-controlled restart before any helper deployment', async () => {
  const result = await run({ pinnedRelease: true }); assert.equal(result.process.exitCode, 2);
  assert.match(result.errors[0], /restart only gameServer/); assert.match(result.errors[0], /before playing/);
  assert.equal(result.calls.some(c => c.url.endsWith('/website-ai/connect')), false); assert.equal(result.direct, 0);
  assert.equal(result.written.length, 0);
});
