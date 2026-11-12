'use strict';
// Living region: the playable footprint is reserved before helpers build next to it (t479u).
const test = require('node:test'), assert = require('node:assert/strict');
const LR = require('../retort/livingRegion'), Topology = require('../retort/livingRegionTopology');
const RoomTopology = require('../retort/roomBuildTopology'), Build = require('../retort/roomBuildState');
const { createRegistry } = require('../retort/roomBuildCoordination');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
process.env.HOLODEK_LIVING_REGION = '1';
// These fixtures author one community; the game's region has three (LR.CONFIG.scope).
LR.CONFIG.scope = require('../retort/livingRegionAuthoring').SCOPE;


// TEST FIXTURE ONLY: stage answers a model might return. The runtime never substitutes authored content.
const STAGE1 = () => ({ communities: [{ name: 'Saltreach Landing', setting: 'outdoor', landmarkName: 'the cracked cistern', landmarkPurpose: 'It holds the landing\'s drinking water through the dry months.',
  landmarkDamage: 'Its stone lip has split and the water drains into the sand.', landmarkForm: 'slab', problem: 'The landing has no stored water and families ration what they carry up.',
  improvement: 'The cistern holds water again and families can draw from it.', passageMatters: 'The closed north way is the only path to the salt flats.', dangerMatters: 'Carriers on the way bring the water.' }] });
const STAGE2 = () => ({ residents: [
  { name: 'Orsel Vane', goalItem: 'brass survey chain', residentAction: 'true the fallen stones of the cracked cistern with it', whyHidden: 'Orsel walled the chain into a cache on the landing road when raiders came.',
    meaning: 'Orsel hopes the landing will forgive him for leaving it.', history: 'Orsel surveyed the landing for twenty years.', willingTraveler: true },
  { name: 'Kettri Moss', goalItem: 'lamp oil cask', residentAction: 'keep the lower gate lamps lit through the night', whyHidden: 'A carter left the cask in a sealed works room when the cart was stopped.',
    meaning: 'Kettri wants the party to prove they are not raiders.', history: 'Kettri keeps the lower gate.', willingTraveler: false }] });
const REVIEW = (issues = [], chainHolds = true) => ({ review: [{ chainHolds, chainProblem: chainHolds ? 'none' : 'The improvement does not follow from rebuilding the cistern.', issues }] });
const STAGE3 = () => ({ relationships: [{ from: 'r1', kind: 'rival', to: 'r2' }, { from: 'r2', kind: 'rival', to: 'r1' }],
  facts: [{ text: 'The cistern cracked three nights ago.', community: 'c1', involves: ['r1'], beliefs: [{ holder: 'r1', account: 'Someone cracked it on purpose.' }] },
    { text: 'A cart of lamp oil went missing on the road.', community: 'region', involves: [], beliefs: [] }],
  companionHooks: [{ companion: 'Ally', kind: 'promise', stake: 'Ally once promised to carry word to the landing.', community: 'c1' }] });
const SUCCESSOR = () => ({ successor: [{ goalItem: 'tide gate key', residentAction: 'open the north way to the salt flats', whyHidden: 'The key was locked away when the cistern failed and nobody went north.',
  meaning: 'Now that the cistern holds water, Orsel wants the salt road open again.' }] });
// The review pass covers the community chain and its residents together.
const ANSWERS = () => [STAGE1(), STAGE2(), REVIEW(), STAGE3()];

const row = (name, type) => sheet({ Name: name, Sex: 'Female', Race: 'Human', Class: 'Cleric', Level: 2, AC: 10, HP: 12, MaxHP: 20 }, 6, type);
const consoleFor = (key = '0,0,0', turns = 0) => { const [x, y, z] = key.split(','); return `Room Name: Here\nCoordinates: X: ${x}, Y: ${y}, Z: ${z}\nTurns: ${turns}\nPC:\n${row('Hero', 'pc')}\nNPCs in Party:\n${row('Ally', 'npc')}\nMonsters in Room: None\nMonsters Equipped Properties: None\nMonsters State: None\nRooms Visited: 1`; };
const START = () => ({ '0,0,0': { name: 'Start', visited: true, exits: { east: { status: 'open', targetCoordinates: '1,0,0', key: null } } } });
function makeState({ runId = 'run-a', db = START(), key = '0,0,0', turns = 0, memory = true, dungeons = null } = {}) {
  let dbs = JSON.stringify(db), text = consoleFor(key, turns);
  const mem = memory ? { runId, records: [], version: 1 } : null;
  return { getDungeonRunId: () => runId, getRoomNameDatabase: () => dbs, setRoomNameDatabase: v => dbs = v,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v, setConsole: (k, t) => text = consoleFor(k, t),
    getCampaignMemory: () => mem, getCombatCharactersString: () => '[]', getLastCoords: () => ({ x: 0, y: 0, z: 0 }), db: () => JSON.parse(dbs),
    change: fn => { const d = JSON.parse(dbs); fn(d); dbs = JSON.stringify(d); },
    ...(dungeons ? { getRoomDungeon: c => dungeons.getRoomDungeon(c), setRoomDungeon: (c, d, t) => dungeons.setRoomDungeon(c, d, t) } : {}) };
}
// A stand-in for generationContracts.request that runs the real shape validator, like the engine contract does.
function requester(answers) {
  const calls = [];
  const request = async (agent, options) => { calls.push(options); const raw = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (raw instanceof Error) return { value: null, error: raw };
    try { return { value: options.validate(structuredClone(raw)) }; } catch (error) { return { value: null, error }; } };
  return { request, calls, prompts: () => calls.map(c => c.localWork.brief), stages: () => calls.map(c => c.context.stage) };
}
const $ = { model: 'test' };
const ctx = () => ({ runId: 'run-a', party: ['Hero', 'Ally'], companions: ['Ally'], existingNames: [], setting: { kind: 'children-of-the-grave', premise: 'x' }, homebrew: false });
function quiet(fn) { const w = console.warn, i = console.info, l = console.log, logs = []; console.warn = (...a) => logs.push(a.join(' ')); console.info = () => {}; console.log = () => {};
  return Promise.resolve().then(fn).finally(() => { console.warn = w; console.info = i; console.log = l; }).then(v => ({ v, logs })); }
// Background jobs are per process; each test starts clean.
async function fresh() { await LR.jobs.settle(); LR.jobs.clear(); }
async function generated(opts = {}, answers = ANSWERS()) {
  await fresh();
  const state = makeState(opts), gen = requester(answers);
  const { v: out } = await quiet(() => LR.ensure($, state, { request: gen.request }));
  assert.equal(out.status, 'generated');
  await LR.jobs.settle();
  state.gen = gen;
  return state;
}
const region = state => state.db()['0,0,0'].livingRegion;
const linkOk = (db, l) => db[l.from]?.exits?.[l.dir]?.targetCoordinates === l.to && db[l.to]?.exits?.[Topology.OPP[l.dir]]?.targetCoordinates === l.from;

test('generated means reserved: the footprint (route, community, objective and successor rooms, passage) is saved before any helper dispatch', async () => {
  const state = await generated();
  const db = state.db(), r = region(state), route = r.routes[0], fp = route.footprint;
  assert.equal(db['0,0,0'].livingRegionAttempt.status, 'generated');
  assert.ok(fp && fp.reservedAt, 'footprint saved in the plan by ensure, before any turn or helper');
  assert.deepEqual(route.cells.slice(0, 1), ['1,0,0']);
  for (const k of [...route.cells, ...(route.gate ? [route.gate.key] : [])]) assert.ok(fp.rooms.includes(k));
  assert.deepEqual(Object.keys(fp.objectives).sort(), ['r1', 'r2']);
  assert.notEqual(fp.objectives.r1.key, fp.objectives.r2.key); assert.ok(!Object.values(fp.objectives).some(o => o.key === route.anchor));
  for (const [id, s] of Object.entries(fp.successorRooms)) {
    assert.ok(fp.rooms.includes(s.key)); assert.ok(fp.links.some(l => l.to === s.key && l.kind === 'successor'), 'successor room is linked into the footprint');
    assert.equal(s.obstacle, r.residents.find(x => x.id === id).goal.objective.obstacle === 'mechanism' ? 'hidden-chamber' : 'mechanism');
  }
  assert.equal(new Set(fp.rooms).size, fp.rooms.length, 'no reserved cell is used twice');
  assert.equal(db[route.anchor].name, 'Saltreach Landing', 'the community room carries its identity from reservation');
  assert.equal(r.communities[0].anchor.key, route.anchor);
});

test('helper assignments carry the destination obligations; the helper prepare pass adds the required exits', async () => {
  const state = await generated(), db = state.db(), route = region(state).routes[0], fp = route.footprint;
  const registry = createRegistry('run-a'), jobs = new Map();
  const job = key => { const j = { id: 'job:' + key, runId: 'run-a', key, name: db[key]?.name || 'Room ' + key }; db[key] ||= { name: j.name }; registry.assign(j); jobs.set(key, j); return j; };
  const T = job(route.cells[0]); registry.plan(T, db);
  const t = registry.describe(T, jobs, db).livingRegion;
  assert.equal(t.routeContext.community, 'Saltreach Landing'); assert.ok(['route', 'objective'].includes(t.role));
  assert.deepEqual(t.exits.find(e => e.target === route.cells[1]), { direction: route.dirs[0], target: route.cells[1], status: 'open' });
  assert.equal(db[route.cells[0]].exits[route.dirs[0]].targetCoordinates, route.cells[1], 'PC plan pass applied the route exit');
  const A = job(route.anchor); registry.plan(A, db);
  const a = registry.describe(A, jobs, db).livingRegion;
  assert.equal(a.role, 'community'); assert.equal(a.community.name, 'Saltreach Landing'); assert.equal(a.community.landmark, 'the cracked cistern');
  assert.deepEqual(a.residentSlots.map(s => s.name), ['Orsel Vane', 'Kettri Moss']); assert.equal(a.fixture.name, 'the cracked cistern');
  assert.ok(a.exits.some(e => e.target === route.cells[1] && e.direction === Topology.OPP[route.dirs[1]]), 'the return exit is required too');
  if (route.gate) assert.ok(a.exits.some(e => e.target === route.gate.key && e.status === 'blocked'));
  assert.equal(db[route.anchor].livingRegionCommunity.id, 'c1'); assert.equal(db[route.anchor].encounterDanger, 'safe');
  const objKey = fp.objectives.r1.key, ob = LR.obligations(db, objKey);
  assert.ok(ob.objectives.some(o => o.residentId === 'r1' && o.obstacle === 'hidden-chamber' && !o.successor));
  const unrelated = { id: 'job:9,9,0', runId: 'run-a', key: '9,9,0', name: 'Far' }; db['9,9,0'] = { name: 'Far' }; registry.assign(unrelated);
  assert.equal(registry.describe(unrelated, jobs, db).livingRegion, null, 'rooms outside the footprint get no regional obligations');
});

const anchorArtifact = (state, mutate = () => {}) => {
  const db = state.db(), route = region(state).routes[0], room = { ...db[route.anchor], populationComplete: true, description: 'A wind-worn landing above the salt flats.',
    exits: { [Topology.OPP[route.dirs[1]]]: { status: 'open', targetCoordinates: route.cells[1], key: null } }, livingRegionCommunity: { id: 'c1' },
    inhabitants: { actors: { 'Orsel Vane': { livingRegion: { residentId: 'r1' } }, 'Kettri Moss': { livingRegion: { residentId: 'r2' } } } } };
  if (route.gate) room.exits[route.gate.dir] = { status: 'blocked', targetCoordinates: route.gate.key, key: null };
  mutate(room, route);
  return { runId: 'run-a', key: route.anchor, stage: 'population', rooms: { [route.anchor]: room } };
};
test('a returned room that violates its obligations is rejected at commit; a missing exit is restored only when safe', async () => {
  const state = await generated(), route = region(state).routes[0], latest = state.db();
  assert.deepEqual(LR.checkArtifact(latest, route.anchor, anchorArtifact(state)).problems, []);
  const renamed = anchorArtifact(state, room => { room.name = 'Somewhere Else'; });
  assert.ok(LR.checkArtifact(latest, route.anchor, renamed).problems.some(p => /must be Saltreach Landing/.test(p)));
  const untagged = anchorArtifact(state, room => { delete room.livingRegionCommunity; });
  assert.ok(LR.checkArtifact(latest, route.anchor, untagged).problems.some(p => /not marked/.test(p)));
  const noResident = anchorArtifact(state, room => { delete room.inhabitants.actors['Kettri Moss']; });
  assert.ok(LR.checkArtifact(latest, route.anchor, noResident).problems.some(p => /Kettri Moss has no place/.test(p)));
  const noExit = anchorArtifact(state, room => { room.exits = {}; });
  const fixed = LR.checkArtifact(latest, route.anchor, noExit);
  assert.deepEqual(fixed.problems, []); assert.ok(fixed.repairs.length >= 1); assert.equal(noExit.rooms[route.anchor].exits[Topology.OPP[route.dirs[1]]].targetCoordinates, route.cells[1]);
  // The route neighbour was built without a way back: the exit cannot be restored, so the room is rejected.
  latest[route.cells[1]] = { name: 'Built', visited: true, exits: {} };
  const blocked = anchorArtifact(state, room => { room.exits = {}; });
  assert.ok(LR.checkArtifact(latest, route.anchor, blocked).problems.some(p => /required .* exit/.test(p)));
  // Through the real commit path: a population checkpoint with the wrong residents is refused, nothing is written.
  const before = state.getRoomNameDatabase();
  const job = { id: 'j', runId: 'run-a', key: route.anchor, name: 'Saltreach Landing', base: {} };
  assert.throws(() => Build.commit(state, job, noResident, { complete: false }), e => e.code === 'LIVING_REGION_OBLIGATION' && e.retryable === false);
  assert.equal(state.getRoomNameDatabase(), before);
  // Objective rooms: geometry without a closed hidden chamber, or with a mismatched mechanism, is refused.
  const fp = route.footprint, chamberKey = fp.objectives.r1.key, mechKey = fp.objectives.r2.key;
  const geo = (key, extra) => ({ runId: 'run-a', key, stage: 'geometry', rooms: { [key]: { name: 'Room', exits: Object.fromEntries(LR.obligations(latest, key).exits.map(e => [e.direction, { status: e.status, targetCoordinates: e.target }])), puzzleMechanism: { id: 'pm1' }, ...extra } },
    dungeon: { cells: { '1,1': { tile: 'floor' } }, secretDoors: { doors: [] }, physicalPuzzle: { definition: { id: 'other' } } } });
  delete latest[route.cells[1]];
  assert.ok(LR.checkArtifact(latest, chamberKey, geo(chamberKey)).problems.some(p => /hidden chamber/.test(p)));
  assert.ok(LR.checkArtifact(latest, mechKey, geo(mechKey)).problems.some(p => /mechanism .* not built and verified/.test(p)));
});

test('built rooms are preserved; when no straight route fits, a connected extension is reserved from the frontier without leaking it', async () => {
  await fresh();
  const db = START();
  // Every straight two-step line from the frontier ends in an already built room.
  for (const [dx, dy] of Object.values(Topology.DIRS).map(d => d.slice(0, 2))) { const k = `${1 + 2 * dx},${2 * dy},0`; if (k !== '-1,0,0') db[k] = { name: 'Built ' + k, visited: true, exits: {} }; }
  db['-1,0,0'] = { name: 'Built west', visited: true, exits: {} };
  const built = Object.fromEntries(Object.entries(db).filter(([k]) => k !== '0,0,0').map(([k, v]) => [k, structuredClone(v)]));
  const state = makeState({ db }), gen = requester(ANSWERS());
  const { v } = await quiet(() => LR.ensure($, state, { request: gen.request }));
  assert.equal(v.status, 'generated'); await LR.jobs.settle();
  const after = state.db(), route = after['0,0,0'].livingRegion.routes[0];
  for (const [k, room] of Object.entries(built)) assert.deepEqual(after[k], room, 'built room ' + k + ' unchanged');
  assert.ok(route.extension, 'recorded as a deliberate extension'); assert.equal(route.extension.frontier, '1,0,0'); assert.equal(route.extension.enteredFrom, '0,0,0');
  assert.equal(route.cells[0], '1,0,0'); assert.equal(route.extension.leadsTo, route.anchor);
  for (let i = 1; i < route.cells.length; i++) assert.ok(!built[route.cells[i]], 'reserved cells are free');
  const notice = LR.turn(state, { geoKey: '0,0,0' }).notice;
  assert.doesNotMatch(notice, /reserved beyond the unexplored|Saltreach Landing/);
});

test('a footprint that cannot be reserved is not called generated; it is retried each turn without a player-facing setup notice', async () => {
  await fresh();
  const db = { '0,0,0': { name: 'Start', visited: true, exits: {} } };
  const state = makeState({ db }), gen = requester(ANSWERS());
  const { v } = await quiet(() => LR.ensure($, state, { request: gen.request }));
  assert.equal(v.status, 'footprint-blocked'); assert.equal(state.db()['0,0,0'].livingRegionAttempt.status, 'footprint-blocked');
  assert.doesNotMatch(LR.turn(state, { geoKey: '0,0,0' }).notice, /No connected space could be reserved/);
  state.change(d => { d['0,0,0'].exits.east = { status: 'open', targetCoordinates: '1,0,0', key: null }; });
  const later = LR.turn(state, { geoKey: '0,0,0' });
  assert.doesNotMatch(later.notice, /now reserved/); assert.equal(state.db()['0,0,0'].livingRegionAttempt.status, 'generated');
  assert.ok(region(state).routes[0].footprint);
});

test('save/load keeps the reservation exactly; nothing is re-planned', async () => {
  const state = await generated(), saved = state.db();
  const loaded = makeState({ db: JSON.parse(JSON.stringify(saved)), turns: 9 }), none = requester([STAGE1()]);
  assert.equal((await LR.ensure($, loaded, { request: none.request })).status, 'present'); assert.equal(none.calls.length, 0);
  await quiet(() => LR.turn(loaded, { geoKey: '0,0,0' }));
  const a = saved['0,0,0'].livingRegion.routes, b = loaded.db()['0,0,0'].livingRegion.routes;
  assert.equal(b.length, 1); assert.deepEqual(b[0].footprint, a[0].footprint); assert.deepEqual(b[0].cells, a[0].cells);
  for (const k of a[0].footprint.rooms) assert.deepEqual(LR.obligations(loaded.db(), k), LR.obligations(saved, k));
});

test('build order and timing do not matter: any order of helper builds (with neighbours built first) yields the same connected footprint', async () => {
  const state = await generated(), base = state.db(), route = base['0,0,0'].livingRegion.routes[0], fp = route.footprint;
  const neighbours = [...new Set(fp.rooms.flatMap(k => Object.values(Topology.DIRS).map(d => { const p = k.split(',').map(Number); return `${p[0] + d[0]},${p[1] + d[1]},0`; })))]
    .filter(k => !fp.rooms.includes(k) && k !== '0,0,0' && !base[k]);
  let rng = 7; const rand = n => (rng = (rng * 1103515245 + 12345) % 2147483648) % n;
  const orders = [fp.rooms.slice(), fp.rooms.slice().reverse()];
  for (let i = 0; i < 10; i++) { const o = fp.rooms.slice(); for (let j = o.length - 1; j > 0; j--) { const x = rand(j + 1); [o[j], o[x]] = [o[x], o[j]]; } orders.push(o); }
  for (const order of orders) {
    const db = structuredClone(base);
    // Unrelated helper rooms next to the footprint are built first, with their own random exits.
    for (const k of neighbours) { db[k] = { name: 'N ' + k }; RoomTopology.prepare(db, k, { seed: 'n' + order.join() }); db[k].visited = true; }
    const pending = new Set(order);
    for (const k of order) {
      pending.delete(k); db[k] ||= { name: 'Room ' + k };
      RoomTopology.prepare(db, k, { seed: 'h' + order.join(), protectedKeys: pending }); db[k].visited = true;
    }
    for (const l of fp.links) assert.ok(linkOk(db, l), `link ${l.from} ${l.dir} ${l.to} in order ${order.join(' ')}`);
    for (const k of neighbours) for (const e of Object.values(db[k].exits || {})) if (fp.rooms.includes(e.targetCoordinates) && e.targetCoordinates !== route.cells[0])
      assert.fail(`unrelated room ${k} punched into the footprint at ${e.targetCoordinates}`);
    assert.equal(Topology.status(db, route).status, 'traversable', 'walkable whatever the order');
    if (route.gate) assert.equal(db[route.anchor].exits[route.gate.dir].status, 'blocked');
  }
});

test('objectives prefer their reserved rooms; in-flight helper cells are never reserved over', async () => {
  const state = await generated(), r = region(state);
  for (const res of r.residents) assert.equal(LR.assignedRoom(r, res), r.routes[0].footprint.objectives[res.id].key);
  const db = START(), reg = { runId: 'x', routes: [], communities: [{ id: 'c1' }], residents: [] };
  const free = Topology.reserve(db, reg, { id: 'c1' }, [], { reserved: ['1,0,0'] });
  assert.equal(free, null, 'the only frontier cell is owned by an in-flight build, so nothing is reserved over it');
});
