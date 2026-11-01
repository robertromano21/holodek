'use strict';
const fs = require('node:fs'), path = require('node:path');
const { Worker } = require('node:worker_threads');
const { EventEmitter } = require('node:events');
function create({ file = path.join(__dirname, '../.retort-data/room-helpers/config.json'),
  spawn = data => new Worker(path.join(__dirname, 'roomBuildWorker.js'), {
    workerData: data, stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 768 }
  }) } = {}) {
  let settings = { enabled: true, location: 'local' }, revision = 0;
  if (fs.existsSync(file)) settings = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  const queue = [], active = new Set();
  function validate(value) {
    if (typeof value?.enabled !== 'boolean' || !['local', 'website'].includes(value.location)) throw Error('Choose local or website room helpers.');
    return { enabled: value.enabled, location: value.location };
  }
  function view() { return { ...settings, revision, concurrency: 3, active: active.size, queued: queue.length }; }
  function configure(value) {
    const next = validate(value);
    if (active.size || queue.length) throw Error('Wait for the local helpers to finish before changing their location.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 }); fs.renameSync(temporary, file);
    settings = next; revision++; return view();
  }
  function pump() {
    while (active.size < 3 && queue.length) {
      const entry = queue.shift(); if (entry.stopped) continue;
      active.add(entry);
      const finish = () => { active.delete(entry); setImmediate(pump); };
      try {
        entry.worker = spawn(entry.data);
        entry.worker.stdout?.resume(); entry.worker.stderr?.resume();
        entry.worker.on('message', message => entry.emitter.emit('message', message));
        entry.worker.on('error', error => entry.emitter.emit('error', error));
        entry.worker.once('exit', code => { finish(); entry.emitter.emit('exit', code); });
      } catch (error) { finish(); entry.emitter.emit('error', error); }
    }
  }
  function local(job, snapshot) {
    const emitter = new EventEmitter(), entry = { data: { job, snapshot }, emitter, stopped: false };
    emitter.terminate = async () => {
      entry.stopped = true;
      const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1);
      if (entry.worker) await entry.worker.terminate();
    };
    if (job.stage === 'quest') queue.unshift(entry); else queue.push(entry);
    setImmediate(pump); return emitter;
  }
  return { view, configure, local };
}
let singleton;
const service = () => singleton ||= create();
// Injected legacy transports retain their explicit test/operator policy.
function policy(website) {
  if (website?.helperSettings) return website.helperSettings();
  const remote = website?.view?.().remoteBuild ?? website?.remoteBuildEnabled?.();
  return { enabled: website?.backgroundEnabled?.() === true, location: remote ? 'website' : 'local', revision: 0 };
}
module.exports = { create, service, policy };
