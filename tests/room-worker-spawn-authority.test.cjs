'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const Life = require('../retort/combatLife');
const Build = require('../retort/roomBuildState');
function fixture(isMainThread) {
  const file = require.resolve('../sharedState'), nativeRequire = createRequire(file), module = { exports: {} };
  const requireFake = name => name === 'node:worker_threads' ? { isMainThread } : nativeRequire(name);
  vm.compileFunction(fs.readFileSync(file, 'utf8'), ['require', 'module', 'exports', '__dirname', 'console'], { filename: file })(
    requireFake, module, module.exports, path.dirname(file), { log() {}, info() {}, warn() {} });
  const state = module.exports, key = '1,1,0', dungeon = { start: { x: 4, y: 5 }, cells: { '4,5': { tile: 'floor' } } };
  const db = { '0,0,0': { name: 'Origin', visited: true }, [key]: { name: 'Destination' } };
  Life.ledger(db, state.getDungeonRunId()).rescuesUsed = 1;
  state.setRoomNameDatabase(JSON.stringify(db)); state.setRoomDungeon({ x: 1, y: 1, z: 0 }, dungeon, []);
  return { state, db, key };
}
test('room-worker scratch movement never writes the campaign-root life or spawn ledger', () => {
  const f = fixture(false), before = f.state.getRoomNameDatabase();
  f.state.setLastCoords({ x: 1, y: 1, z: 0 });
  assert.deepEqual(f.state.getLastCoords(), { x: 1, y: 1, z: 0 });
  assert.equal(f.state.getRoomNameDatabase(), before);
});
test('the main game still records a stable original spawn without spending a recovery', () => {
  const f = fixture(true); f.state.setLastCoords({ x: 1, y: 1, z: 0 });
  const first = JSON.parse(f.state.getRoomNameDatabase())['0,0,0'].combatLife;
  assert.deepEqual(first.levelSpawns[f.key], { key: f.key, start: { x: 4, y: 5 } });
  assert.equal(first.rescuesUsed, 1);
  f.state.setRoomDungeon({ x: 1, y: 1, z: 0 }, { start: { x: 9, y: 9 }, cells: {} }, []);
  f.state.setLastCoords({ x: 1, y: 1, z: 0 });
  assert.deepEqual(JSON.parse(f.state.getRoomNameDatabase())['0,0,0'].combatLife, first);
});

test('a second-room geometry commit preserves newer PC-owned spawn history and still rejects foreign life writes', () => {
  const f = fixture(false), rooms = JSON.parse(f.state.getRoomNameDatabase());
  rooms[f.key] = { name: 'Destination', description: 'A working station with a sealed observation gallery.',
    populationComplete: true, inhabitants: { actors: {}, groups: [] } };
  f.state.setRoomNameDatabase(JSON.stringify(rooms));
  const job = { id: 'spawn-authority-job', key: f.key, name: 'Destination', runId: f.state.getDungeonRunId(),
    model: 'offline-model', coords: { x: 1, y: 1, z: 0 }, base: structuredClone(rooms), entering: true };
  job.context = Build.context(f.state, job.model);
  f.state.setLastCoords(job.coords);
  const generated = JSON.parse(f.state.getRoomNameDatabase());
  generated[f.key].sceneSpec = { source: { roomName: 'Destination', description: rooms[f.key].description } };
  const dungeon = { geoKey: f.key, layout: { width: 16, height: 16 }, cells: { '4,5': { tile: 'floor' } },
    _geometryStamp: 'second-room', sceneSpec: generated[f.key].sceneSpec };
  const latest = JSON.parse(f.state.getRoomNameDatabase());
  require('../retort/playerRespawn').noteLevelSpawn(latest, job.runId, f.key, { ...dungeon, start: { x: 4, y: 5 } });
  f.state.setRoomNameDatabase(JSON.stringify(latest));
  const pcLife = structuredClone(latest['0,0,0'].combatLife);
  Build.commit(f.state, job, { jobId: job.id, key: f.key, runId: job.runId,
    stage: 'geometry', rooms: generated, dungeon }, { complete: false });
  const committed = JSON.parse(f.state.getRoomNameDatabase());
  assert.deepEqual(committed['0,0,0'].combatLife, pcLife);
  assert.equal(committed[f.key].preparedBuild.stage, 'geometry');
  assert.equal(f.state.getRoomDungeonForSimulation(job.coords)._geometryStamp, 'second-room');

  const foreign = structuredClone(generated); foreign['0,0,0'].combatLife.rescuesUsed++;
  const before = f.state.getRoomNameDatabase();
  assert.throws(() => Build.commit(f.state, job, { jobId: job.id, key: f.key, runId: job.runId,
    stage: 'art', rooms: foreign }, { complete: false }), error => error.code === 'ROOM_BUILD_CONFLICT');
  assert.equal(f.state.getRoomNameDatabase(), before);
});
