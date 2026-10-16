'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module'), { EventEmitter } = require('node:events');
function fixture() {
  const file = require.resolve('../retort/sidVoice'), localRequire = createRequire(file), jobs = [], routes = new Map();
  class Worker extends EventEmitter {
    postMessage(job) { jobs.push(job); queueMicrotask(() => {
      const result = job.type === 'track' ? { frames: [[150, [], []]], noiseFrames: [{ env: [], rms: 0.1, high: 1 }], phones: [], ms: { analyse: 1 } } :
        job.type === 'render' ? { pcm: new Int16Array([Math.round(job.P.f0), job.noiseFrames ? 200 : 100]), sr: 44100,
          articulation: { mode: job.noiseFrames ? 'detail' : 'legacy' }, ms: { render: 1 } } : job.type==='score'?{score:new Uint8Array([1,2,3]),dur:1,ms:{compile:1}}:{};
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

test('Dantuea uses the female analysis guide even if a stale browser submits her old low dragon voice', async () => {
  const f = fixture();
  const result = await f.call('POST', '/voice/line.sidvoice', { speaker: 'Dantuea (Darkdrake)', text: 'I remember your exile.',
    chip: '10582', clock: '2x', profile: { f0: 82, fs: .75, kind: 'beast', accent: 'shade' } });
  assert.equal(result.code, 200);
  assert.equal(f.jobs.find(j => j.type === 'track').voice, 'lj');
  const rendered = f.jobs.find(j => j.type === 'score');
  assert.equal(rendered.P.f0, 195); assert.equal(rendered.P.fs, 1.12); assert.equal(rendered.P.kind, 'regal');
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

test('soft defaults, explicit styles and caches are independent of character identity and analysis',async()=>{
  const f=fixture(),q={speaker:'Vessa Reedwake',text:'Welcome.',clock:'2x',chip:'10582',profile:{f0:211,fs:1.16}};
  const a=await f.call('POST','/voice/line.wav',q);
  assert.equal(a.headers['X-Voice-Timbre'],'soft');
  await f.call('POST','/voice/line.wav',{...q,timbre:'original'});
  await f.call('POST','/voice/line.wav',{...q,timbre:'continuous'});
  await f.call('POST','/voice/line.wav',q);
  const jobs=f.jobs.filter(j=>j.type==='render');
  assert.equal(jobs.length,3);assert.equal(f.jobs.filter(j=>j.type==='track').length,1);
  assert.deepEqual(jobs.map(j=>j.timbre),['soft','original','continuous']);
  for(const j of jobs){assert.equal(j.P.f0,211);assert.equal(j.P.fs,1.16);assert.equal(j.digi,null);}
});

test('8580 ignores 10582 styles without discarding the saved preference',async()=>{
  const f=fixture();await f.call('POST','/voice/chip',{chip:'8580',timbre:'soft'});
  const r=await f.call('POST','/voice/line.wav',{speaker:'Test',text:'Welcome.'});
  assert.equal(r.headers['X-Voice-Timbre'],'original');
  const state=await f.call('GET','/voice/chip',{});
  assert.equal(state.data.timbre,'soft');assert.equal(state.data.effectiveTimbre,'original');
  await f.call('POST','/voice/chip',{chip:'10582'});
  const changed=await f.call('POST','/voice/line.wav',{speaker:'Test',text:'Welcome.'});
  assert.equal(changed.headers['X-Voice-Timbre'],'soft');
});

test('overlapping requests keep their selected timbre; prefetch uses the selected default',async()=>{
  const f=fixture(),q={speaker:'Test',text:'Welcome.',chip:'10582'};
  const results=await Promise.all(['soft','original'].map(timbre=>f.call('POST','/voice/line.wav',{...q,timbre})));
  assert.deepEqual(results.map(r=>r.headers['X-Voice-Timbre']),['soft','original']);
  await f.call('POST','/voice/chip',{timbre:'continuous'});
  f.api.prefetch([{speaker:'Test',line:'Welcome.'}]);await f.api.scoreFor('Test','Welcome.');
  assert.equal(f.jobs.find(j=>j.type==='score').timbre,'continuous');
});

test('unsupported voice styles fail visibly without changing settings',async()=>{
  const f=fixture();
  const invalid=await f.call('POST','/voice/chip',{chip:'8580',timbre:'something else'});
  assert.equal(invalid.code,400);
  const line=await f.call('POST','/voice/line.sidvoice',{speaker:'Test',text:'Hello.',timbre:'unknown'});
  assert.equal(line.code,400);assert.equal(f.jobs.length,0);
  const state=await f.call('GET','/voice/chip',{});assert.equal(state.data.chip,'10582');assert.equal(state.data.timbre,'soft');
});
