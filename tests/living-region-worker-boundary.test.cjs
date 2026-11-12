'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const LR = require('../retort/livingRegion'), Build = require('../retort/roomBuildState');
process.env.HOLODEK_LIVING_REGION = '1';
const key = '1,0,0', otherKey = '0,1,0', runId = 'worker-boundary';
function fixture() {
  return {
    '0,0,0': { name: 'Origin', visited: true, livingRegion: { source: LR.SOURCE, version: LR.VERSION, runId,
      routes: [], communities: [{ id: 'c1', anchor: { key } }, { id: 'c2', anchor: { key: otherKey } }],
      residents: [{ id: 'r1', name: 'Resident One', communityId: 'c1', goal: { id: 'g1' } },
        { id: 'r2', name: 'Resident Two', communityId: 'c2', goal: { id: 'g2' } }], quests: [] } },
    [key]: { name: 'Community One' }, [otherKey]: { name: 'Community Two' }
  };
}
function result(name = 'Resident One') {
  return { population: { actors: { [name]: { name, status: 'present', hp: 23, equipment: ['owned shield'] } },
    groups: [{ id: 'group', members: [name] }] } };
}
function tagged(db, at = key, name = 'Resident One') {
  const value = result(name);
  LR.bindPopulation(db, at, value);
  return value.population;
}
function stateFor(initial) {
  let rooms = structuredClone(initial);
  return { getRoomNameDatabase: () => JSON.stringify(rooms), setRoomNameDatabase: text => { rooms = JSON.parse(text); },
    getDungeonRunId: () => runId, getCurrentQuest: () => '', getCurrentTaskIndex: () => 0, getCurrentTasks: () => [],
    setRoomPopulation: () => {}, setRoomMusic: () => {}, setRoomDungeon: () => {}, db: () => rooms };
}

test('population binding tags actual actors without writing host-owned resident state', () => {
  const db = fixture(), before = structuredClone(db), value = result();
  assert.equal(LR.bindPopulation(db, key, value), value);
  assert.deepEqual(db, before);
  const actor = value.population.actors['Resident One'];
  assert.deepEqual(actor.livingRegion, { source: LR.SOURCE, runId, residentId: 'r1', goalId: 'g1', communityId: 'c1' });
  assert.equal(actor.hp, 23); assert.deepEqual(actor.equipment, ['owned shield']);
});

test('name reservation reads committed tags but never mutates its database snapshot', () => {
  const db = fixture(); db[key].inhabitants = tagged(db);
  delete db['0,0,0'].livingRegion.residents[0].materialized;
  const before = structuredClone(db);
  assert.deepEqual(LR.reservedNames(db, '9,9,0'), ['Resident Two']);
  assert.deepEqual(db, before);
});

test('failed construction cannot materialize a resident before its population is committed', () => {
  const db = fixture(), population = tagged(db);
  assert.ok(population.actors['Resident One'].livingRegion);
  assert.deepEqual(LR.reservedNames(db, '9,9,0'), ['Resident One', 'Resident Two']);
  assert.equal(LR.syncMaterialized(db, db['0,0,0'].livingRegion), false);
});

test('real helper checkpoint commits while preserving concurrent host goals, history and party changes', () => {
  const base = fixture(), state = stateFor(base), job = { key, id: 'job', runId, name: base[key].name,
    model: 'offline', coords: { x: 1, y: 0, z: 0 }, base: structuredClone(base) };
  job.context = Build.context(state, job.model);
  const rooms = structuredClone(base), population = tagged(rooms);
  Object.assign(rooms[key], { populationComplete: true, description: 'A built hall with a persistent resident and their possessions.', inhabitants: population });
  const root = state.db()['0,0,0'];
  root.party = ['Already Recruited'];
  root.livingRegion.quests.push({ id: 'accepted', status: 'active' });
  root.livingRegion.residents[1].history = ['A verified promise'];
  const expected = structuredClone(root);
  const artifact = Build.scopeArtifact(job, { runId, key, stage: 'population', rooms }, job.base);
  Build.commit(state, job, artifact, { complete: false });
  assert.deepEqual(state.db()['0,0,0'], expected);
  assert.equal(state.db()[key].preparedBuild.stage, 'population');
  assert.equal(LR.syncMaterialized(state.db(), state.db()['0,0,0'].livingRegion), true);
  assert.equal(state.db()['0,0,0'].livingRegion.residents[0].materialized.roomKey, key);
  assert.deepEqual(state.db()[key].inhabitants.actors['Resident One'].equipment, ['owned shield']);
});

test('parallel population builds retain both identities when committed in either order and restored', () => {
  for (const order of [[key, otherKey], [otherKey, key]]) {
    const base = fixture(), state = stateFor(base), jobs = new Map(), artifacts = new Map();
    for (const at of order) {
      const job = { key: at, id: at, runId, name: base[at].name, model: 'offline', base: structuredClone(base) };
      job.context = Build.context(state, job.model);
      const rooms = structuredClone(base);
      Object.assign(rooms[at], { populationComplete: true, description: 'A completed community hall containing its original resident.',
        inhabitants: tagged(rooms, at, at === key ? 'Resident One' : 'Resident Two') });
      jobs.set(at, job); artifacts.set(at, Build.scopeArtifact(job, { key: at, runId, stage: 'population', rooms }, job.base));
    }
    for (const at of order) {
      Build.commit(state, jobs.get(at), artifacts.get(at), { complete: false });
      LR.syncMaterialized(state.db(), state.db()['0,0,0'].livingRegion);
    }
    const restored = JSON.parse(JSON.stringify(state.db())), region = restored['0,0,0'].livingRegion;
    assert.deepEqual(region.residents.map(r => r.materialized.roomKey), [key, otherKey]);
    assert.equal(LR.syncMaterialized(restored, region), false);
    assert.deepEqual(LR.reservedNames(restored, '9,9,0'), []);
  }
});

function objectiveFixture() {
  const db = fixture(), region = db['0,0,0'].livingRegion;
  region.communities = [{ id: 'c1', anchor: { key: '2,0,0' } }];
  region.residents = [{ id: 'r1', name: 'Resident One', homeCommunityId: 'c1', communityId: 'c1',
    goal: { id: 'g1', item: 'owned repair tool', whyHidden: 'A tool put away before the storm.',
      objective: { obstacle: 'hidden-chamber', status: 'unplaced', tried: [] } } }];
  region.routes = [{ id: 'route', communityId: 'c1', status: 'reserved', anchor: '2,0,0', cells: [key, '2,0,0'], dirs: ['east'],
    footprint: { rooms: [key, '2,0,0'], objectives: { r1: { key, obstacle: 'hidden-chamber' } }, successorRooms: {} } }];
  db['0,0,0'].exits = { east: { status: 'open', targetCoordinates: key } };
  db[key].exits = { west: { status: 'open', targetCoordinates: '0,0,0' }, east: { status: 'open', targetCoordinates: '2,0,0' } };
  db['2,0,0'] = { name: 'Home', exits: { west: { status: 'open', targetCoordinates: key } } };
  const dungeon = { geoKey: key, start: { x: 2, y: 4 }, layout: { width: 16, height: 16 }, cells: {}, sceneObjects: [],
    secretDoors: { doors: [{ id: 'secret:4,4', key: '4,4', x: 4, y: 4, entry: { x: 3, y: 4 }, chamber: ['5,4', '6,4'], open: false }] } };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
  dungeon.cells['4,4'].tile = 'wall';
  return { db, dungeon };
}

test('isolated goal placement returns the bound object without changing any shared regional records', () => {
  const { db, dungeon } = objectiveFixture(), state = stateFor(db), before = structuredClone(db['0,0,0']);
  LR.sealGoalItems(state, dungeon, 'Objects in Room: None\nObjects in Room Properties: None', { construction: true });
  assert.deepEqual(state.db()['0,0,0'], before);
  assert.equal(state.db()[key].objects[0].livingRegionGoal, 'g1');
  assert.equal(dungeon.sceneObjects[0].id, 'living-region:g1');
  LR.sealGoalItems(state, dungeon, '', { construction: true });
  assert.equal(dungeon.sceneObjects.length, 1, 'repeated geometry preparation never duplicates a goal item');
});

test('the host derives one objective binding from verified item and chamber evidence at geometry commit', () => {
  const { db, dungeon } = objectiveFixture(), state = stateFor(db), worker = stateFor(db);
  const job = { key, id: 'geometry', runId, name: db[key].name, model: 'offline', base: structuredClone(db) };
  job.context = Build.context(state, job.model);
  LR.sealGoalItems(worker, dungeon, '', { construction: true });
  const rooms = worker.db();
  Object.assign(rooms[key], { populationComplete: true, description: 'A real chamber contains the tool behind a closed stone panel.', inhabitants: { actors: {} } });
  dungeon._geometryStamp = 'test'; dungeon.sceneSpec = { source: { roomName: rooms[key].name, description: rooms[key].description } };
  state.db()['0,0,0'].livingRegion.quests.push({ id: 'accepted-work' });
  const artifact = Build.scopeArtifact(job, { key, runId, stage: 'geometry', rooms, dungeon }, job.base);
  Build.commit(state, job, artifact, { complete: false });
  const region = state.db()['0,0,0'].livingRegion, binding = region.residents[0].goal.objective;
  assert.equal(binding.status, 'sealed'); assert.equal(binding.cacheKey, key); assert.equal(binding.cell, '5,4');
  assert.deepEqual(region.quests, [{ id: 'accepted-work' }]);
  assert.equal(LR.adoptGoalItems(state.db(), key, dungeon), false, 'the exact same evidence is idempotent');
  assert.deepEqual(state.db()['0,0,0'].livingRegion.residents[0].goal.objective, binding);
});

test('forged or stale objective evidence cannot replace a goal binding', () => {
  for (const corrupt of [
    (db, d) => { db[key].objects[0].name = 'different item'; },
    (db, d) => { d.secretDoors.doors[0].open = true; },
    (db, d) => { d.sceneObjects[0].x = 8; },
    (db, d) => { db['0,0,0'].livingRegion.residents[0].goal.objective.status = 'bound'; },
    (db, d) => { db[key].objects[0].livingRegionGoal = 'unknown'; }
  ]) {
    const { db, dungeon } = objectiveFixture(), worker = stateFor(db);
    LR.sealGoalItems(worker, dungeon, '', { construction: true });
    const rooms = worker.db(); corrupt(rooms, dungeon);
    const before = structuredClone(rooms['0,0,0']);
    assert.throws(() => LR.adoptGoalItems(rooms, key, dungeon), /Invalid regional objective/);
    assert.deepEqual(rooms['0,0,0'], before);
  }
});

test('an actual isolated worker prepares regional loot plus ordinary rewards without publishing a shared binding', async t => {
  const { Worker } = require('node:worker_threads'), { db, dungeon } = objectiveFixture();
  const worker = new Worker(`
    const { parentPort, workerData: data } = require('node:worker_threads');
    const LR = require(data.module), Loot = require(data.loot);
    let text = JSON.stringify(data.db);
    const state = { getRoomNameDatabase: () => text, setRoomNameDatabase: value => { text = value; },
      getDungeonRunId: () => data.runId, setUpdatedGameConsole: () => {} };
    Loot.prepare({}, state, data.dungeon, '', { author: async (_agent, options) => Array.from({ length: options.count },
      (_, index) => ({ name: 'bonus object ' + index, type: 'other', attack_modifier: 0, damage_modifier: 0, ac: 0, magic: 0 })) })
      .then(() => parentPort.postMessage({ db: JSON.parse(text), dungeon: data.dungeon }));
  `, { eval: true, workerData: { db, dungeon, runId, module: require.resolve('../retort/livingRegion'), loot: require.resolve('../retort/secretRoomLoot') } });
  t.after(() => worker.terminate());
  const answer = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  assert.deepEqual(answer.db['0,0,0'], db['0,0,0']);
  assert.equal(answer.db[key].objects.filter(item => item.livingRegionGoal).length, 1);
  assert.equal(answer.db[key].objects.filter(item => !item.livingRegionGoal).length, 1, 'regional loot never replaces the ordinary secret reward');
  assert.equal(LR.adoptGoalItems(answer.db, key, answer.dungeon), true);
});

test('a required hidden chamber uses a small sealed foundation on sloping outdoor ground without changing ordinary generation', () => {
  const Secrets = require('../retort/secretDoors');
  const make = () => {
    const d = { geoKey: key, layout: { width: 40, height: 40 }, start: { x: 4, y: 4 }, cells: {}, sceneObjects: [] };
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) d.cells[`${x},${y}`] = {
      tile: x && y && x < 39 && y < 39 ? 'floor' : 'wall', floorHeight: (x + y) * .12, ceilHeight: 80 };
    d.cells['15,15'].feature = 'protected landmark'; return d;
  };
  const ordinary = make(), required = make(), protectedCell = structuredClone(required.cells['15,15']);
  Secrets.install(ordinary); assert.equal(ordinary.secretDoors.doors.length, 0);
  Secrets.install(required, { required: true }); assert.ok(required.secretDoors.doors.length > 0);
  assert.deepEqual(required.cells['15,15'], protectedCell);
  for (const door of required.secretDoors.doors) {
    const floor = required.cells[`${door.entry.x},${door.entry.y}`].floorHeight;
    assert.ok(door.chamber.every(k => required.cells[k].floorHeight === floor));
  }
  const before = JSON.stringify(required); Secrets.install(required, { required: true }); assert.equal(JSON.stringify(required), before);
});
