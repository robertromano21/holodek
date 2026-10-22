'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const progress = new AsyncLocalStorage();
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function fingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(canonical({ character: payload.character,
    npcs: payload.npcs || [], combatCharacters: payload.combatCharacters || [], scope: payload.scope || null }))).digest('hex');
}
function create({ tasks, scope = () => null }) {
  let current = null;
  const identity = payload => fingerprint({ ...payload, scope: scope() });
  function find(payload, runId) {
    if (!current) return null;
    if (current.runId && runId && current.runId !== runId) throw Error('This startup belongs to an earlier game. Begin a new character review explicitly.');
    // Save after a terminal failure explicitly retries. Active/completed receipts stay idempotent.
    if (tasks.get(current.taskId)?.status === 'error') {
      tasks.delete(current.taskId); current = null; return null;
    }
    if (current.fingerprint !== identity(payload)) throw Error('A different character, model or world was already submitted. Begin a new character review explicitly.');
    return current;
  }
  function begin(payload) {
    if (current) throw Error('A startup task already exists.');
    current = { taskId: randomUUID(), fingerprint: identity(payload), runId: null };
    tasks.set(current.taskId, { startup: true, status: 'processing', phase: 'starting', result: null, startedAt: Date.now() });
    return current;
  }
  function bind(taskId, runId) {
    if (current?.taskId !== taskId) throw Error('Stale startup task.');
    current.runId = runId;
    Object.assign(tasks.get(taskId), { runId });
  }
  function track(taskId, work) {
    return progress.run(event => {
      const task = tasks.get(taskId);
      if (current?.taskId === taskId && task?.status === 'processing')
        task.progress = { ...event, at: Date.now() };
    }, work);
  }
  function clear() {
    if (current && tasks.get(current.taskId)?.status === 'processing') throw Error('The first room is still being built.');
    if (current) tasks.delete(current.taskId);
    current = null;
  }
  return { find, begin, bind, track, clear };
}
function report(event) { progress.getStore()?.(event); }
module.exports = { create, report, fingerprint };
