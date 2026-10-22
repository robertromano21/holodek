'use strict';
const { randomUUID } = require('node:crypto');
const Build = require('./roomBuildState');
const Coordination = require('./roomBuildCoordination');
const { constructionSnapshot } = require('./websiteRoomBuild');
const sessions = new WeakMap();
function configured(website = require('./websiteAi').service()) {
  return process.env.HOLODEK_REMOTE_ENGINE !== '1' && website.view().enabled && website.view().remoteBuild === true;
}
function begin(state, consoleText = state.getUpdatedGameConsole(), { website = require('./websiteAi').service(), logger = console } = {}) {
  if (!configured(website)) return null;
  const match = consoleText.match(/^Coordinates:\s*X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/m);
  if (!match) throw Error('Remote construction has no room coordinate.');
  const key = match.slice(1).map(Number).join(','), runId = state.getDungeonRunId(), db = JSON.parse(state.getRoomNameDatabase());
  const room = db[key]; if (!room?.populationComplete || Build.description(room).trim().length < 20) return null;
  let current = sessions.get(state);
  if (!current) sessions.set(state, current = new Map());
  const model = require('./gameModels').current(), existing = current.get(key);
  if (!existing?.failed && existing?.runId === runId && existing.job.modelRevision === model.revision && existing.job.model === model.id &&
      existing.context === Build.context(state, existing.job.model)) return existing;
  existing?.worker?.terminate();
  const coordinator = Coordination.registryFor(state);
  if (existing?.job) coordinator.release(existing.job.id);
  const coords = Object.fromEntries(['x', 'y', 'z'].map((name, i) => [name, Number(match[i + 1])]));
  const dungeon = state.getRoomDungeonForSimulation(coords), music = state.getRoomMusic?.(coords);
  const Art = require('./roomIllustration'), source = dungeon?.sceneSpec?.source;
  if (dungeon?.layout && dungeon.cells && source?.roomName === room.name &&
      source.description?.trim() === Build.description(room).trim() && music?.archive?.id &&
      Art.accepted(room.illustration, Art.fingerprint(Art.context(state, key)))) {
    current.delete(key);
    return null;
  }
  const job = { key, runId, id: randomUUID(), name: room.name, modelRevision: model.revision,
    coords, model: model.id,
    entering: true, base: structuredClone(db), context: Build.context(state, model.id), phase: 'queued', stage: 'population', attempt: 1, queuedAt: Date.now() };
  coordinator.assign(job); job.assignment = coordinator.describe(job, new Map(), db);
  const barriers = {};
  for (const stage of ['geometry', 'music', 'art', 'complete']) {
    let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    promise.catch(() => {}); barriers[stage] = { promise, resolve, reject };
  }
  const entry = { job, runId, context: job.context, barriers }; current.set(key, entry);
  (async () => {
    try {
      await website.ensureConnected();
      if (state.getDungeonRunId() !== runId || Build.context(state, job.model) !== job.context ||
          require('./gameModels').current().id !== job.model || require('./gameModels').current().revision !== job.modelRevision)
        throw Error('Adventure or model changed before room workers became ready.');
      if (!website.remoteBuildEnabled()) throw Error('Website room workers are not ready. Reconnect Website AI.');
      job.websiteRevision = website.view().revision;
      job.dungeonBase = structuredClone(state.getRoomDungeonForSimulation(job.coords) || null);
      const snapshot = constructionSnapshot(state, job, consoleText);
      snapshot.roomNameDatabaseString = JSON.stringify(db);
      job.phase = 'running'; job.assignment = coordinator.describe(job, new Map(), JSON.parse(state.getRoomNameDatabase()));
      entry.worker = website.spawnBuild(job, snapshot, { background: false, skipPopulation: true });
      entry.worker.on('message', message => {
        try {
          if (entry.failed) return;
          const selected = require('./gameModels').current();
          if (selected.id !== job.model || selected.revision !== job.modelRevision || website.view().revision !== job.websiteRevision)
            throw Error('Model or website connection changed during room construction.');
          if (message.type === 'checkpoint') {
            const artifact = message.artifact;
            if (entry.geometryAccepted && artifact.stage !== 'geometry') {
              artifact.dungeon = structuredClone(state.getRoomDungeonForSimulation(job.coords));
              job.dungeonBase = structuredClone(artifact.dungeon);
            }
            Build.commit(state, job, artifact, { complete: artifact.stage === 'complete',
              protectedKeys: new Set(job.assignment.assignments.filter(other => other.owner !== job.id && !other.ready).map(other => other.destination)),
              reserveWrites: keys => coordinator.reserve(job, keys) });
            job.stage = artifact.stage; job.assignment = coordinator.describe(job, new Map(), JSON.parse(state.getRoomNameDatabase()));
            if ((artifact.completedStages || []).includes('geometry')) entry.geometryAccepted = true;
            for (const stage of artifact.completedStages || []) barriers[stage]?.resolve();
            if (artifact.stage === 'complete') { job.phase = 'complete'; coordinator.release(job.id); barriers.complete.resolve(); }
            logger.info('[WebsiteRoomChain]', JSON.stringify({ key, destination: key, leaseOwner: job.id, authority: 'pc-game-server',
              stage: artifact.stage, model: job.model, elapsedMs: Date.now() - job.queuedAt }));
          } else if (message.type === 'failed') throw Error(message.reason);
        } catch (error) { entry.failed = true; coordinator.release(job.id); entry.worker.terminate(); logger.warn?.('[WebsiteRoomChain]', key, error.message); for (const barrier of Object.values(barriers)) barrier.reject(error); }
      });
    } catch (error) { entry.failed = true; coordinator.release(job.id); for (const barrier of Object.values(barriers)) barrier.reject(error); }
  })();
  while (current.size > 32) { const [old, value] = current.entries().next().value; value.worker?.terminate(); coordinator.release(value.job.id); current.delete(old); }
  return entry;
}
async function wait(state, key, stage) {
  const entry = sessions.get(state)?.get(key);
  if (!entry || entry.runId !== state.getDungeonRunId()) return false;
  await entry.barriers[stage].promise;
  if (Build.context(state, entry.job.model) !== entry.context) throw Error('Room context changed during remote construction.');
  return true;
}
module.exports = { begin, wait, configured };
