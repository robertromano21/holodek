'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createRequire } = require('node:module'), { createHash } = require('node:crypto');
const Wire = require('../tools/website-worker/roomWire.cjs');
const session = 'a'.repeat(48), id = 'b'.repeat(24), engineHash = 'c'.repeat(64);
const bundleHash = createHash('sha256').update(['worker.cjs','workerPool.cjs','roomTask.cjs','roomWire.cjs'].map(name=>
  name+'\n'+fs.readFileSync(path.join(__dirname,'../tools/website-worker',name),'utf8')).join('\n')).digest('hex');
const answer = { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Local hall.' } }], model: 'holodek-1' };
function fixture(t, { complete = async () => answer, mutate, model = 'holodek-1', staleEngine = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-pc-room-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const nativeRequire = createRequire(require.resolve('../retort/websiteAi')), module = { exports: {} }, calls = [], replies = [];
  const source = fs.readFileSync(require.resolve('../retort/websiteAi'), 'utf8');
  const fakeRequire = name => name === './pcModelHost' ? { complete: async (...args) => { calls.push(args); return complete(...args); } } :
    name === './websiteEngineBundle' ? { build: () => ({ hash:engineHash }) } :
    name === './gameModels' ? { profile: () => ({ id: model, local: model === 'holodek-1' ? 'ollama' : undefined }) } :
    name === './worldFlags' ? { snapshot: () => ({ CITY_COMPLETE: true }) } : nativeRequire(name);
  vm.runInThisContext('(function(require,module,exports,__dirname,process){' + source + '\n})', { filename: 'websiteAi-bridge-test.js' })
    (fakeRequire, module, module.exports, path.resolve(__dirname, '../retort'), process);
  const W = module.exports, publicKey = Buffer.from('offline host pin'), fingerprint = 'SHA256:' + createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '');
  const config = { enabled: true, host: 'worker.example.invalid', username: 'holodek-agent', sshPort: 22,
    fingerprint, background: true, remoteBuild: true, useForGameModels: true };
  let release;
  const delivered = new Promise(resolve => { release = resolve; });
  const run = async (exe, args, options = {}) => {
    if (exe.includes('ssh-keygen')) {
      const file = args[args.indexOf('-f') + 1]; fs.writeFileSync(file, 'private-test-key'); fs.writeFileSync(file + '.pub', 'ssh-ed25519 offline'); return '';
    }
    if (exe.includes('ssh-keyscan')) return 'worker.example.invalid ssh-ed25519 ' + publicKey.toString('base64');
    const packet = JSON.parse(options.input);
    if (packet.operation === 'status') return JSON.stringify({ value: { version: 1, port: 35000, roomWorkers: 3, engineHash,bundleHash,
      pool:[0,1,2].map(slot=>({slot,node:process.version,bundleHash,engineHash:staleEngine&&slot===2?'d'.repeat(64):engineHash})) } });
    if (packet.operation === 'pc-model-response') { replies.push(packet); release(packet); return JSON.stringify({ value: { accepted: true } }); }
    assert.equal(packet.operation, 'room-stage');
    assert.equal(Object.hasOwn(packet, 'credential'), false);
    const payload = Wire.unpack(packet.payload);
    assert.equal(payload.job.model, model);
    if (model === 'holodek-1') { assert.equal(packet.pcModel, model); assert.equal(payload.pcModel, model); assert.equal(payload.provider, 'ollama'); }
    const message = { type: 'pc-model-request', session, id, body: { model: 'holodek-1', messages: [{ role: 'user', content: 'Describe the hall.' }] } };
    mutate?.(message);
    options.onLine(JSON.stringify(message));
    const reply = await delivered;
    if (reply.error) { options.onLine(JSON.stringify({ type: 'failed', reason: reply.error })); return ''; }
    options.onLine(JSON.stringify({ type: 'checkpoint', value: Wire.pack({ type: 'checkpoint', artifact: { stage: 'art' } }) }));
    options.onLine(JSON.stringify({ type: 'done' })); return '';
  };
  const service = W.createService({ directory, run, env: { OPENAI_API_KEY: 'not-sent-to-local-model' } });
  return { calls, replies, service, connect: () => service.connect(config), start: async () => {
    await service.connect(config);
    const checkpoints = [];
    await service.runRoomStage({ model, stage: 'art' }, {}, { onCheckpoint: value => checkpoints.push(value), background: false });
    return checkpoints;
  } };
}
test('website room authoring requests exact PC holodek-1 through SSH response packets, without provider credentials', async t => {
  const f = fixture(t), checkpoints = await f.start();
  assert.equal(checkpoints.length, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0].model, 'holodek-1'); assert.equal(f.calls[0][1].background, false);
  assert.equal(f.replies[0].session, session); assert.equal(f.replies[0].id, id);
  assert.deepEqual(f.replies[0].result, answer);
});
test('a mixed helper release rejects before dispatch, without purchasing inference or replacing the route', async t => {
  const f=fixture(t,{staleEngine:true});
  await assert.rejects(f.start(), e=>e.code==='ROOM_ENGINE_MISMATCH'&&e.recoverable===false);
  assert.equal(f.calls.length,0);assert.equal(f.replies.length,0);
});
test('PC inference failure rejects the remote stage explicitly rather than substituting a website or cloud model', async t => {
  const f = fixture(t, { complete: async () => { throw Error('Local holodek-1 is unavailable.'); } });
  await assert.rejects(f.start(), /Local holodek-1 is unavailable/);
  assert.equal(f.calls.length, 1); assert.equal(f.replies[0].result, undefined);
});
for (const [name, mutate] of [
  ['another model', message => { message.body.model = 'gpt-6-luna'; }],
  ['invalid session', message => { message.session = '../unsafe'; }],
  ['invalid request id', message => { message.id = 'unsafe'; }]
]) test('room bridge rejects ' + name + ' before calling PC inference', async t => {
  const f = fixture(t, { mutate });
  await assert.rejects(f.start(), /Invalid PC model request/);
  assert.equal(f.calls.length, 0); assert.equal(f.replies.length, 0);
});
test('a cloud-model stage cannot invoke the PC model bridge', async t => {
  const f = fixture(t, { model: 'gpt-6-luna' });
  await assert.rejects(f.start(), /Invalid PC model request/); assert.equal(f.calls.length, 0);
});
test('legacy description prefetch also sends holodek-1 to the PC rather than website Ollama', async t => {
  const f = fixture(t); await f.connect();
  const result = await f.service.generate({ provider: 'ollama', body: { model: 'holodek-1', messages: [{ role: 'user', content: 'A hall.' }] }, background: true });
  assert.deepEqual(result, answer); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].background, true);
  assert.equal(f.replies.length, 0);
});
