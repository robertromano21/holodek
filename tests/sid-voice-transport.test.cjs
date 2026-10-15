'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module'), { EventEmitter } = require('node:events');
function fixture() {
  const file = require.resolve('../retort/sidVoice'), localRequire = createRequire(file), jobs = [], routes = new Map();
  class Worker extends EventEmitter {
    postMessage(job) { jobs.push(job); queueMicrotask(() => {
      const result = job.type === 'track' ? { frames: [[150, [], []]], noiseFrames: [{ env: [], rms: 0.1, high: 1 }], phones: [], ms: { analyse: 1 } } :
        job.type === 'render' ? { pcm: new Int16Array([Math.round(job.P.f0), job.noiseFrames ? 200 : 100]), sr: 44100,
          articulation: { mode: job.noiseFrames ? 'detail' : 'legacy' }, ms: { render: 1 } } : {};
      this.emit('message', { id: job.id, ok: true, ...result });
    }); }
  }
  const context = { module: { exports: {} }, require: name => name === 'worker_threads' ? { Worker } : localRequire(name),
    __dirname: require('node:path').dirname(file), Buffer, process, console, setTimeout: () => 0 };
  vm.createContext(context); vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  const api = context.module.exports;
  api.install({ get: (url, ...handlers) => routes.set('GET ' + url, handlers.at(-1)), post: (url, ...handlers) => routes.set('POST ' + url, handlers.at(-1)) }, { json: () => () => {} });
  async function call(method, url, data) {
    let response; const res = { headers: {}, code: 200, status(n) { this.code = n; return this; }, set(h) { this.headers = h; return this; },
      end(data) { response = data; return this; }, json(data) { response = data; return this; } };
    await routes.get(method + ' ' + url)({ method, body: data, query: data }, res);
    return { ...res, data: response };
  }
  return { api, jobs, call };
}
test('POST speech binds the submitted identity to the first render and emits a valid WAV header', async () => {
  const f = fixture();
  const r = await f.call('POST', '/voice/line.wav', { speaker: 'Vessa Reedwake', text: 'Welcome.', chip: '10582', clock: '2x', profile: { name: 'Wrong Name', f0: 211, fs: 1.16 } });
  assert.equal(r.code, 200); assert.equal(r.data.toString('ascii', 0, 4), 'RIFF'); assert.equal(r.data.readUInt32LE(24), 44100);
  assert.equal(r.headers['X-Voice-Articulation'], 'detail');
  const render = f.jobs.find(j => j.type === 'render');
  assert.equal(render.P.name, 'Vessa Reedwake'); assert.equal(render.P.f0, 211); assert.equal(render.P.fs, 1.16);
  assert.ok(render.noiseFrames); assert.equal(render.audio, null); assert.equal(render.digi, null);
  assert.equal(f.api.profileOf('  VESSA   REEDWAKE ').fs, 1.16);
});
test('legacy/detail renders reuse one analysis take but never share the rendered cache', async () => {
  const f = fixture(), q = { speaker: 'Test', text: 'Welcome.', chip: '10582', clock: '2x' };
  await f.call('POST', '/voice/line.wav', { ...q, detail: true });
  const legacy = await f.call('POST', '/voice/line.wav', { ...q, detail: false });
  await f.call('POST', '/voice/line.wav', { ...q, detail: true });
  assert.equal(legacy.headers['X-Voice-Articulation'], 'legacy');
  assert.equal(f.jobs.filter(j => j.type === 'track').length, 1);
  assert.equal(f.jobs.filter(j => j.type === 'render').length, 2);
});
test('GET clients still work and 8580 requests never receive extended analysis controls', async () => {
  const f = fixture();
  const r = await f.call('GET', '/voice/line.wav', { speaker: 'Test', text: 'Welcome.', chip: '8580', detail: '1' });
  assert.equal(r.code, 200); assert.equal(r.headers['X-Voice-Articulation'], 'legacy');
  assert.equal(f.jobs.find(j => j.type === 'render').noiseFrames, null);
  const status = await f.call('GET', '/voice/status', {});
  assert.equal(status.data.synthesis, 'oscillators-noise-filters-only'); assert.equal(status.data.profileVersion, 2);
});
test('a changed profile cannot reuse a sentence rendered in the old voice', async () => {
  const f = fixture(), q = { speaker: 'Test', text: 'Welcome.', chip: '10582', clock: '2x' };
  const a = await f.call('POST', '/voice/line.wav', { ...q, profile: { f0: 160, fs: 1 } });
  const b = await f.call('POST', '/voice/line.wav', { ...q, profile: { f0: 180, fs: 1.12 } });
  assert.notDeepEqual(a.data, b.data); assert.equal(f.jobs.filter(j => j.type === 'render').length, 2);
});
test('overlapping requests retain their own profile snapshot', async () => {
  const f = fixture(), q = { speaker: 'Test', text: 'Welcome.', chip: '10582', clock: '2x' };
  const first = f.call('POST', '/voice/line.wav', { ...q, profile: { f0: 160, fs: 1 } });
  const second = f.call('POST', '/voice/line.wav', { ...q, profile: { f0: 180, fs: 1.12 } });
  const a = await first, b = await second;
  assert.equal(a.data.readInt16LE(44), 160); assert.equal(b.data.readInt16LE(44), 180);
});
test('audio-panel articulation preference also controls prefetch and legacy GET defaults', async () => {
  const f = fixture();
  await f.call('POST', '/voice/chip', { chip: '10582', detail: false });
  const r = await f.call('GET', '/voice/line.wav', { speaker: 'Test', text: 'Welcome.', clock: '2x' });
  assert.equal(r.headers['X-Voice-Articulation'], 'legacy');
  const status = await f.call('GET', '/voice/status', {}); assert.equal(status.data.detail, false);
});
