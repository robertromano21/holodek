'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Queue = require('../retort/roomBuildQueue'), Build = require('../retort/roomBuildState');
test('a constructed entrance cannot be queued again when a stale visited flag is absent', () => {
  const db = { '0,1,0': { exits: { south: { targetCoordinates: '0,0,0' } } },
    '0,0,0': { name: 'Entrance', populationComplete: true, description: 'An already constructed entrance.' } };
  assert.deepEqual(Queue.candidates(db, '0,1,0', ['south']), []);
});
test('an interrupted population checkpoint remains eligible for bounded explicit recovery', () => {
  const db = { '0,0,0': { exits: { north: { targetCoordinates: '0,1,0' } } },
    '0,1,0': { name: 'Road', populationComplete: true, preparedBuild: { stage: 'population', ready: false } } };
  assert.equal(Queue.candidates(db, '0,0,0', ['north']).length, 1);
});
test('host search bookkeeping does not force a paid adjacent-room rebuild', () => {
  const base = { '0,0,0': { name: 'Entrance', visited: true }, '0,1,0': { name: 'Road', exhaustionLimit: null } };
  let db = structuredClone(base); Object.assign(db['0,1,0'], { exhaustionLimit: 4, attemptedSearches: 1, trapTriggered: false });
  const state = { getDungeonRunId: () => 'run', getRoomNameDatabase: () => JSON.stringify(db),
    setRoomNameDatabase: text => { db = JSON.parse(text); }, setRoomPopulation() {} };
  const job = { key: '0,1,0', id: 'build', runId: 'run', model: 'gpt-6-luna', name: 'Road', base,
    context: Build.context(state, 'gpt-6-luna') };
  const rooms = structuredClone(base); Object.assign(rooms['0,1,0'], { exhaustionLimit: 6, populationComplete: true,
    description: 'A narrow road between weathered stone walls.', inhabitants: { actors: {}, groups: [] } });
  Build.commit(state, job, { key: job.key, jobId: job.id, runId: 'run', stage: 'population', rooms }, { complete: false });
  assert.equal(db['0,1,0'].exhaustionLimit, 4); assert.equal(db['0,1,0'].attemptedSearches, 1);
  assert.equal(db['0,1,0'].populationComplete, true); assert.equal(db['0,1,0'].preparedBuild.stage, 'population');
});
