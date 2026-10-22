'use strict';
const clone = value => structuredClone(value);
const conflict = key => Object.assign(Error('Concurrent room change: ' + key + ' is reserved by another room build; retry from a fresh snapshot.'), { code: 'ROOM_BUILD_CONFLICT' });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
// This registry exists only in the PC queue. Workers receive immutable descriptions, never its maps.
function createRegistry(runId) {
  const owners = new Map(), leases = new Map();
  function release(id) { leases.delete(id); for (const [key, owner] of owners) if (owner.id === id) owners.delete(key); }
  function assign(job) {
    if (job.runId !== runId || leases.has(job.id) && leases.get(job.id).key !== job.key) throw Error('Invalid PC room lease identity.');
    const prior = owners.get(job.key);
    if (prior && prior.id !== job.id) throw conflict(job.key);
    owners.set(job.key, { id: job.id, destination: job.key, kind: 'destination' });
    leases.set(job.id, job);
  }
  function reserve(job, keys) {
    if (job.runId !== runId || leases.get(job.id) !== job || owners.get(job.key)?.id !== job.id) throw Error('PC room lease is no longer active.');
    for (const key of keys) if (owners.has(key) && owners.get(key).id !== job.id) throw conflict(key);
    // Preflight is side-effect free. Publish reservations only after the entire artifact commits.
    return () => { for (const key of keys) owners.set(key, { id: job.id, destination: job.key, kind: key === job.key ? 'destination' : 'topology' }); };
  }
  function describe(job, jobs, database) {
    const assigned = new Map([...leases.values()].map(other => [other.key, other]));
    for (const [key, other] of jobs) assigned.set(key, other);
    const relevant = new Set(['0,0,0', job.fromKey, job.key,
      ...Object.values(database[job.key]?.exits || {}).map(exit => exit.targetCoordinates),
      ...[...assigned.values()].filter(other => !other.finished).map(other => other.key)]);
    return freeze({ version: 1, authority: 'pc-game-server', runId, leaseId: job.id, destination: job.key,
      writeSet: [...owners].filter(([, owner]) => owner.id === job.id).map(([key]) => key),
      sharedProposals: ['topology', 'crossGameHistory:append'],
      otherConstructedRoomsReadOnly: true,
      readOnly: [...relevant].filter(key => key !== job.key && (database[key]?.visited || database[key]?.populationComplete || database[key]?.preparedBuild || database[key]?.builder?.mode === 'hand')),
      assignments: [...assigned.values()].filter(other => !other.finished || relevant.has(other.key)).map(other => ({ destination: other.key, owner: other.id,
        phase: other.phase, stage: other.stage, ready: other.stage === 'complete', attempt: other.attempt })),
      reservations: [...owners].filter(([key]) => relevant.has(key)).map(([key, owner]) => ({ key, ...owner })) });
  }
  return { assign, reserve, release, describe };
}
const registries = new WeakMap();
function registryFor(state) {
  const runId = state.getDungeonRunId(); let entry = registries.get(state);
  if (!entry || entry.runId !== runId) { entry = { runId, registry: createRegistry(runId) }; registries.set(state, entry); }
  return entry.registry;
}
module.exports = { createRegistry, registryFor, freeze };
