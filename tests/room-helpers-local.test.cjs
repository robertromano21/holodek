'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events'), Helpers = require('../retort/roomHelpers');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'room-helpers-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const workers = [], file = path.join(directory, 'config.json');
  const service = Helpers.create({ file, spawn(data) { const w = new EventEmitter(); w.data = data;
    w.terminate = async () => { w.emit('exit', 0); }; workers.push(w); return w; } });
  return { service, file, workers };
}
test('helpers default to local enabled execution without website credentials', t => {
  const s = fixture(t); assert.deepEqual(s.service.view(), { enabled: true, location: 'local', revision: 0, concurrency: 3, active: 0, queued: 0 });
  assert.equal(fs.existsSync(s.file), false);
});
test('quest and room jobs share one three-worker local ceiling', async t => {
  const s = fixture(t), jobs = Array.from({ length: 5 }, (_, n) => s.service.local({ stage: n ? 'all' : 'quest', id: n }, {}));
  for (const job of jobs) job.on('error', () => {});
  await tick(); assert.equal(s.workers.length, 3); assert.equal(s.service.view().queued, 2);
  s.workers[0].emit('exit', 0); await tick(); assert.equal(s.workers.length, 4); assert.equal(s.service.view().active, 3);
  await Promise.all(jobs.map(job => job.terminate()));
});
test('a cancelled queued job never spawns and local shutdown releases owned workers', async t => {
  const s = fixture(t), jobs = Array.from({ length: 4 }, (_, n) => s.service.local({ id: n }, {}));
  await tick(); await jobs[3].terminate(); await Promise.all(jobs.slice(0, 3).map(job => job.terminate())); await tick();
  assert.equal(s.workers.length, 3); assert.equal(s.service.view().active, 0); assert.equal(s.service.view().queued, 0);
});
test('website execution is explicit and persisted; switching while workers run is rejected', async t => {
  const s = fixture(t); s.service.configure({ enabled: true, location: 'website' });
  assert.equal(Helpers.create({ file: s.file }).view().location, 'website');
  assert.throws(() => s.service.configure({ enabled: true, location: 'somewhere' }), /local or website/);
  const job = s.service.local({}, {}); await tick();
  assert.throws(() => s.service.configure({ enabled: false, location: 'local' }), /finish/); await job.terminate();
});
test('local worker bypasses SSH without replacing the selected model or changing the saved website connection', () => {
  const source = fs.readFileSync(require.resolve('../retort/roomBuildWorker'), 'utf8');
  assert.doesNotMatch(source, /ensureConnected|\.disable\(/);
  assert.match(source, /models\.restore\(workerData\.job\.model\)/); assert.match(source, /useForGameModels = \(\) => false/);
});
