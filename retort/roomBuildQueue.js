'use strict';
const { Worker } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const Build = require('./roomBuildState');
const Coordination = require('./roomBuildCoordination');
const OFFSETS = { north: [0, 1, 0], south: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 0, 1], down: [0, 0, -1],
  northeast: [1, 1, 0], northwest: [-1, 1, 0], southeast: [1, -1, 0], southwest: [-1, -1, 0] };
const coords = key => Object.fromEntries(['x', 'y', 'z'].map((k, i) => [k, Number(key.split(',')[i])]));
function candidates(db, currentKey, exits) {
  if (!Build.coordinate.test(currentKey)) return [];
  const point = currentKey.split(',').map(Number), result = new Map();
  for (const direction of exits || []) {
    const exit = db[currentKey]?.exits?.[direction], offset = OFFSETS[direction];
    // Secret routes stay undiscovered; other physical locks do not prevent offscreen construction.
    if (exit?.hidden || exit?.secret && !exit?.discovered) continue;
    const key = exit?.targetCoordinates || offset && point.map((v, i) => v + offset[i]).join(',');
    if (!Build.coordinate.test(key || '') || key === currentKey) continue;
    const room = db[key];
    if (!room?.name || room.visited || room.preparedBuild?.ready || room.builder?.mode === 'hand') continue;
    result.set(key, { key, name: room.name, direction });
  }
  return [...result.values()];
}
const localSpawn = (job, snapshot) => new Worker(path.join(__dirname, 'roomBuildWorker.js'), {
  workerData: { job: Object.fromEntries(['id', 'key', 'name', 'coords', 'runId', 'model', 'assignment'].map(k => [k, job[k]])), snapshot },
  stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 768 }
});
function createService(state, { models = require('./gameModels'), website = require('./websiteAi').service(),
  spawn, concurrency = spawn ? 1 : 3, logger = console, commit = Build.commit, timeoutMs = 20 * 60 * 1000,
  conflictRetries = 2, retryDelayMs = 250 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw Error('Room build concurrency must be between 1 and 3.');
  if (!Number.isInteger(conflictRetries) || conflictRetries < 0 || conflictRetries > 2 || !Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw Error('Invalid bounded room retry policy.');
  const jobs = new Map(), active = new Set(); let runId = state.getDungeonRunId(), capacityTimer = null;
  let registry = Coordination.registryFor(state);
  const log = (job, phase, extra = {}) => logger.info('[AdjacentRoomBuild]', JSON.stringify({ phase,
    id: job.id, leaseOwner: job.id, destination: job.key, from: job.fromKey, key: job.key, name: job.name, model: job.model, runId: job.runId,
    stage: job.stage, attempt: job.attempt, elapsedMs: Date.now() - job.queuedAt, ...extra }));
  function assignment(job) { return registry.describe(job, jobs, JSON.parse(state.getRoomNameDatabase() || '{}')); }
  function stopAttempt(job) {
    job.liveAttempt = null;
    clearTimeout(job.timer); clearInterval(job.guard); clearTimeout(job.retryTimer);
    try { Promise.resolve(job.worker?.terminate()).catch(() => {}); } catch { /* Transport already closed. */ }
    active.delete(job);
  }
  function valid(job) {
    try { return website.backgroundEnabled() && state.getDungeonRunId() === job.runId &&
      models.current().id === job.model && models.current().revision === job.modelRevision &&
      website.view().revision === job.websiteRevision && Build.context(state, job.model) === job.context &&
      (!job.remote || website.remoteBuildEnabled?.() === true);
    } catch { return false; }
  }
  function finish(job, phase, reason) {
    if (job.finished) return;
    const error = reason instanceof Error ? reason : null;
    job.finished = true; job.phase = phase; job.reason = error?.message || reason || null;
    job.retryable = error?.retryable !== false && error?.recoverable !== false && ['failed', 'discarded', 'cancelled'].includes(phase);
    stopAttempt(job); registry.release(job.id);
    log(job, phase, job.reason ? { reason: job.reason, ...(error?.code ? { code: error.code, retryable: job.retryable } : {}),
      ...(error?.responseEvidence ? { evidence: error.responseEvidence } : {}) } : {}); job.resolve();
    setImmediate(pump);
  }
  function retryConflict(job, error) {
    const here = state.getLastCoords(), near = job.fromKey === `${here.x},${here.y},${here.z}` || job.entering;
    if (error.code !== 'ROOM_BUILD_CONFLICT' || error.retryable === false || job.stage === 'complete' || !valid(job) || !near || job.attempt > conflictRetries)
      return finish(job, 'discarded', error);
    log(job, 'conflict', { reason: error.message, code: error.code, evidence: error.responseEvidence });
    stopAttempt(job); registry.release(job.id);
    const previousId = job.id;
    job.id = randomUUID(); job.attempt++; job.phase = 'backoff'; job.reason = error.message;
    job.stage = null; job.checkpoint = null; job.checkpoints = {}; job.worker = null;
    registry.assign(job);
    const delayMs = retryDelayMs * 2 ** (job.attempt - 2);
    log(job, 'retry', { previousId, delayMs, reason: error.message });
    job.retryTimer = setTimeout(() => {
      if (job.finished) return;
      if (!valid(job)) return finish(job, 'cancelled', 'Adventure, model, quest or website connection changed during retry.');
      job.phase = 'queued'; pump();
    }, delayMs);
    job.retryTimer.unref?.(); setImmediate(pump);
  }
  function start(job, remote) {
    try {
      const db = JSON.parse(state.getRoomNameDatabase() || '{}'), target = db[job.key];
      if (!target || target.name !== job.name || target.visited || target.preparedBuild?.ready || target.builder?.mode === 'hand') return finish(job, 'skipped');
      // Take a fresh snapshot at execution, not when queued, to include earlier neighbors and player discoveries.
      job.base = structuredClone(db);
      const snapshot = state.exportSaveState();
      const current = `${snapshot.lastCoords.x},${snapshot.lastCoords.y},${snapshot.lastCoords.z}`;
      snapshot.roomDungeonDatabase = Object.fromEntries(Object.entries(snapshot.roomDungeonDatabase).filter(([key]) => key === job.key || key === current));
      job.dungeonBase = structuredClone(state.getRoomDungeonForSimulation?.(job.coords) ?? snapshot.roomDungeonDatabase[job.key] ?? null);
      active.add(job); job.remote = remote; job.phase = 'running'; job.assignment = assignment(job);
      const attemptId = job.id;
      job.liveAttempt = attemptId;
      log(job, 'running', { remote, assignment: { authority: 'pc-game-server', writeSet: job.assignment.writeSet,
        peers: job.assignment.assignments.filter(other => other.owner !== job.id).map(other => ({ key: other.destination, stage: other.stage, phase: other.phase })) } });
      job.worker = spawn ? spawn(job, snapshot) : remote ? website.spawnBuild(job, snapshot, { background: true }) : localSpawn(job, snapshot);
      // Do not forward full prompts, console dumps or credentials into the player log.
      job.worker.stdout?.resume(); job.worker.stderr?.resume();
      job.worker.on('message', message => {
        if (job.finished || job.id !== attemptId || job.liveAttempt !== attemptId) return;
        if (!valid(job)) return finish(job, 'cancelled', 'Adventure, model, quest or website connection changed.');
        if ((message?.jobId !== undefined && message.jobId !== job.id) || (message?.runId !== undefined && message.runId !== job.runId))
          return finish(job, 'discarded', 'Room build message identity mismatch.');
        if (message?.type === 'checkpoint') {
          try {
            const complete = message.artifact?.stage === 'complete';
            const accepted = commit(state, job, message.artifact, { complete, reserveWrites: keys => registry.reserve(job, keys), protectedKeys: new Set(
              [...jobs.values()].filter(other => other !== job && !other.finished).map(other => other.key)) });
            job.stage = accepted?.preparedBuild?.stage || message.artifact.stage;
            job.assignment = assignment(job);
            log(job, job.stage === 'complete' ? 'ready' : 'checkpoint', { stage: job.stage,
              readOnlyNormalizations: message.artifact.readOnlyNormalizations || [], writeSet: job.assignment.writeSet });
          } catch (error) { retryConflict(job, error); }
        } else if (message?.type === 'done') finish(job, job.stage === 'complete' ? 'complete' : 'failed', job.stage === 'complete' ? null : 'Missing final room artifact.');
        else if (message?.type === 'failed') finish(job, 'failed', require('../tools/website-worker/worker.cjs').failureFrom({ ...message,error:message.reason }));
      });
      job.worker.on('error', error => { if (job.liveAttempt === attemptId) finish(job, 'failed', error.message); });
      job.worker.on('exit', code => { if (!job.finished && job.liveAttempt === attemptId) finish(job, 'failed', 'Room worker exited before completion (' + code + ').'); });
      job.timer = setTimeout(() => { if (job.liveAttempt === attemptId) finish(job, 'failed', 'Room build exceeded its bounded time limit.'); }, timeoutMs);
      job.guard = setInterval(() => { if (job.liveAttempt === attemptId && !valid(job)) finish(job, 'cancelled', 'Adventure, model, quest or website connection changed.'); }, 1000);
      job.timer.unref?.(); job.guard.unref?.();
    } catch (error) { finish(job, 'failed', error.message); }
  }
  function pump() {
    clearTimeout(capacityTimer); capacityTimer = null;
    for (const job of jobs.values()) if (!job.finished && !valid(job)) finish(job, 'cancelled', 'Adventure, model, quest or website connection changed.');
    let remote = false, remoteRequested = false, capacity = 0;
    try {
      remoteRequested = !spawn && website.view().remoteBuild === true;
      remote = !spawn && website.remoteBuildEnabled?.() === true;
      // capacity() is the total pool ceiling, not the number of currently free slots.
      capacity = spawn ? concurrency : remote ? website.capacity?.() ?? 3 : remoteRequested ? 0 : 1;
    } catch { /* An unavailable capacity check must not dispatch or crash the server. */ }
    const limit = Number.isInteger(capacity) && capacity >= 0 ? Math.min(concurrency, capacity, 3) : 0;
    while (active.size < limit) {
      const job = [...jobs.values()].find(j => j.phase === 'queued'); if (!job) return;
      start(job, remote);
    }
    // A configured remote engine must become ready; never replace it with PC construction.
    if (((remoteRequested && !remote) || (remote && limit < concurrency)) && [...jobs.values()].some(job => job.phase === 'queued')) {
      capacityTimer = setTimeout(pump, 100); capacityTimer.unref?.();
    }
  }
  function reset() {
    clearTimeout(capacityTimer); capacityTimer = null;
    for (const job of jobs.values()) if (!job.finished) finish(job, 'cancelled', 'Run changed.');
    jobs.clear(); runId = state.getDungeonRunId();
    registry = Coordination.registryFor(state);
  }
  function queueNeighbors({ currentKey, exits, retry = false } = {}) {
    if (state.getDungeonRunId() !== runId) reset();
    if (!website.backgroundEnabled()) return [];
    const db = JSON.parse(state.getRoomNameDatabase() || '{}'), model = models.current(), queued = [];
    const here = state.getLastCoords();
    if (currentKey !== `${here.x},${here.y},${here.z}` || db[currentKey]?.visited !== true) return [];
    for (const item of candidates(db, currentKey, exits)) {
      const prior = jobs.get(item.key);
      if ((prior && !(retry && prior.finished && prior.retryable)) || [...jobs.values()].filter(j => !j.finished).length >= 16) continue;
      const job = { ...item, fromKey: currentKey, id: randomUUID(), coords: coords(item.key), runId, model: model.id, modelRevision: model.revision,
        websiteRevision: website.view().revision, context: Build.context(state, model.id), remote: !spawn && website.remoteBuildEnabled?.() === true,
        phase: 'queued', stage: null, attempt: 1, queuedAt: Date.now() };
      job.promise = new Promise(resolve => { job.resolve = resolve; });
      registry.assign(job); jobs.set(job.key, job); queued.push(job.key); log(job, 'queued');
    }
    // Only this explicit displayed-room acknowledgement can enqueue work. Completion never calls queueNeighbors.
    if (queued.length) setImmediate(pump);
    while (jobs.size > 64) { const old = [...jobs.values()].find(j => j.finished); if (!old) break; jobs.delete(old.key); }
    return queued;
  }
  async function join(key) {
    const job = jobs.get(key);
    if (!job || job.runId !== state.getDungeonRunId()) return;
    if (job.finished) {
      const room = JSON.parse(state.getRoomNameDatabase() || '{}')[key];
      if (room?.preparedBuild?.id === job.id && room.preparedBuild.ready) log(job, 'prefetch-hit', { ready: true });
      return;
    }
    job.entering = true;
    if (job.phase === 'queued') {
      // Prioritize the requested neighbor without duplicating a running generation.
      const entries = [...jobs.entries()]; jobs.clear(); jobs.set(key, job);
      for (const [k, value] of entries) if (k !== key) jobs.set(k, value);
      pump();
    }
    log(job, 'joined'); await job.promise;
  }
  return { queueNeighbors, join, _reset: reset, status: () => [...jobs.values()].map(j => ({ key: j.key, name: j.name, id: j.id, runId: j.runId,
    phase: j.phase, stage: j.stage, model: j.model, remote: !!j.remote, reason: j.reason || null, retryable: !!j.retryable,
    attempt: j.attempt, leaseOwner: j.id, elapsedMs: Date.now() - j.queuedAt })) };
}
const services = new WeakMap();
function service(state) { if (!services.has(state)) services.set(state, createService(state)); return services.get(state); }
module.exports = { candidates, createService, service };
