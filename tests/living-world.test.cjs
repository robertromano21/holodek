'use strict';
// Living world (t480u): universal participation in history, selective active planning, knowledge boundaries,
// verified sources from every story system, bounded cost and consequence guards. Three-community region.
const test = require('node:test'), assert = require('node:assert/strict');
process.env.HOLODEK_LIVING_REGION = '1';
const LR = require('../retort/livingRegion'), World = require('../retort/livingWorld'), Ledger = require('../retort/livingRegionLedger');
const Topology = require('../retort/livingRegionTopology'), RoomTopology = require('../retort/roomBuildTopology');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
LR.CONFIG.scope = { communities: 3, residentsPerCommunity: 2, factsMin: 3, factsMax: 8 };

// TEST FIXTURE ONLY: stage answers a model might return.
const C = (name, landmark, form, setting, problem, other) => ({ name, setting, landmarkName: landmark, landmarkPurpose: `It serves the people of ${name}.`, landmarkDamage: `${landmark} is cracked through.`,
  landmarkForm: form, problem, improvement: `${landmark} works again.`, passageMatters: 'The closed way leads on.', dangerMatters: 'Travellers bring supplies.', disagreementWith: other, disagreement: 'They argue over who repairs the road.' });
const STAGE1 = () => ({ communities: [C('Saltreach Landing', 'the cracked cistern', 'slab', 'outdoor', 'The landing has no stored water.', 'c2'),
  C('Brinewatch', 'the fallen beacon', 'column', 'outdoor', 'Boats cannot find the harbour at night.', 'c1'), C('Kelp Hollow', 'the split drying rack', 'frame', 'outdoor', 'The harvest rots before it dries.', 'c2')] });
const R = (name, item, action, traveler = false) => ({ name, goalItem: item, residentAction: action, whyHidden: `${item} was hidden away when trouble came.`, meaning: `${name} wants the place whole again.`, history: `${name} has lived here for years.`, willingTraveler: traveler });
const STAGE2 = () => ({ residents: [R('Orsel Vane', 'brass survey chain', 'true the fallen stones of the cracked cistern with it'), R('Kettri Moss', 'lamp oil cask', 'keep the lower gate lamps lit', true),
  R('Dunmar Reed', 'beacon lens', 'set the fallen beacon upright and fit its lens'), R('Hesk Arlow', 'tide chart', 'read the harbour tides aloud each dusk'),
  R('Mira Tull', 'rack pegs', 'peg the split drying rack back together'), R('Ober Lisk', 'salt barrel', 'salt the drying catch for winter')] });
const REVIEW = () => ({ review: [{ chainHolds: true, chainProblem: 'none', issues: [] }] });
const STAGE3 = () => ({ relationships: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((id, i, a) => ({ from: id, kind: 'ally', to: a[(i + 1) % a.length] })),
  facts: [{ text: 'The cistern cracked three nights ago.', community: 'c1', involves: ['r1'], beliefs: [] }, { text: 'The beacon fell in a storm.', community: 'c2', involves: ['r3'], beliefs: [] },
    { text: 'The rack split under a heavy harvest.', community: 'c3', involves: ['r5'], beliefs: [] }],
  companionHooks: [{ companion: 'Ally', kind: 'promise', stake: 'Ally once promised to carry word to Brinewatch.', community: 'c2' }] });
const ANSWERS = () => [STAGE1(), STAGE2(), ...Array.from({ length: 3 }, REVIEW), STAGE3()];
const ADOPT = item => ({ successor: [{ goalItem: item, residentAction: 'mend the old net with it', whyHidden: `${item} was left beside a stiff old mechanism.`, meaning: 'They want to repay the party.' }] });

const row = (name, type) => sheet({ Name: name, Sex: 'Female', Race: 'Human', Class: 'Cleric', Level: 2, AC: 10, HP: 12, MaxHP: 20 }, 6, type);
const consoleFor = (key = '0,0,0', turns = 0) => { const [x, y, z] = key.split(','); return `Room Name: Here\nCoordinates: X: ${x}, Y: ${y}, Z: ${z}\nTurns: ${turns}\nPC:\n${row('Hero', 'pc')}\nNPCs in Party:\n${row('Ally', 'npc')}\nMonsters in Room: None\n`; };
const START = () => ({ '0,0,0': { name: 'Start', visited: true, exits: { east: { status: 'open', targetCoordinates: '1,0,0', key: null }, west: { status: 'open', targetCoordinates: '-1,0,0', key: null }, north: { status: 'open', targetCoordinates: '0,1,0', key: null } } } });
function makeState({ runId = 'run-w', db = START(), key = '0,0,0', turns = 0 } = {}) {
  let dbs = JSON.stringify(db), text = consoleFor(key, turns), tasks = [{ desc: 'Defeat the Hollow King and recover the Ember Crown.', status: 'Pending' }], taskWrites = 0;
  const mem = { runId, records: [], version: 1 };
  return { getDungeonRunId: () => runId, getRoomNameDatabase: () => dbs, setRoomNameDatabase: v => dbs = v, getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    setConsole: (k, t) => text = consoleFor(k, t), getCampaignMemory: () => mem,
    getCombatCharactersString: () => { const k=IKey(text);return JSON.stringify([{ name:'Hero',type:'pc',hp:12,mazeX:2,mazeY:2,mazeRoomKey:k },{name:'Ally',type:'npc',hp:12,mazeX:3,mazeY:2,mazeRoomKey:k}]); },
    getRoomDungeonForSimulation: () => ({cells:Object.fromEntries(Array.from({length:144},(_,i)=>[`${i%12},${Math.floor(i/12)}`,{tile:'floor',floorHeight:0,ceilHeight:6}]))}),
    getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getCurrentTasks: () => tasks, setCurrentTasks: v => { taskWrites++; tasks = v; }, taskWrites: () => taskWrites,
    db: () => JSON.parse(dbs), change: fn => { const d = JSON.parse(dbs); fn(d); dbs = JSON.stringify(d); }, mem };
}
const IKey=text=>require('../assets/dungeonInhabitants').roomKey(text.match(/^Coordinates: (.*)$/m)?.[1]);
function requester(answers) {
  const calls = [];
  const request = async (agent, options) => { calls.push(options); const raw = answers[Math.min(calls.length - 1, answers.length - 1)];
    try { return { value: options.validate(structuredClone(raw)) }; } catch (error) { return { value: null, error }; } };
  return { request, calls };
}
const $ = { model: 'test' };
function quiet(fn) { const w = console.warn, i = console.info, l = console.log; console.warn = console.info = console.log = () => {};
  return Promise.resolve().then(fn).finally(() => { console.warn = w; console.info = i; console.log = l; }); }
async function generated(opts = {}) {
  await LR.jobs.settle(); LR.jobs.clear();
  const state = makeState(opts), gen = requester(opts.answers || ANSWERS());
  const out = await quiet(() => LR.ensure($, state, { request: gen.request }));
  assert.equal(out.status, 'generated', JSON.stringify(out));
  await LR.jobs.settle(); state.gen = gen;
  await quiet(() => LR.turn(state, { geoKey: '0,0,0' }));
  return state;
}
const region = s => s.db()['0,0,0'].livingRegion;
const turnAt = (state, key, turns, extra = {}) => { state.setConsole(key, turns); return quietSync(() => LR.turn(state, { geoKey: key, consoleText: state.getUpdatedGameConsole(), ...extra })); };
function quietSync(fn) { const w = console.warn, i = console.info, l = console.log; console.warn = console.info = console.log = () => {}; try { return fn(); } finally { console.warn = w; console.info = i; console.log = l; } }
// Places a resident's generated record in their community room, tagged as the population pipeline does.
function materialize(state, rid) {
  state.change(d => { const r = d['0,0,0'].livingRegion, res = r.residents.find(x => x.id === rid), key = r.communities.find(c => c.id === res.homeCommunityId).anchor.key;
    d[key] ||= { name: 'Room ' + key }; d[key].inhabitants ||= { geoKey: key, actors: {}, groups: [] };
    d[key].inhabitants.actors[res.name] = { name: res.name, status: 'present', hp: 12, allegiance: 'Neutral',position:{x:4+Number(rid.slice(1))%2,y:4}, livingRegion: { source: LR.SOURCE, runId: r.runId, residentId: rid, goalId: res.goal.id } }; });
}
const memory = (state, rec) => state.mem.records.push({ runId: 'run-w', at: Date.now(), turn: 1, actors: [], witnesses: ['Hero', 'Ally'], roomKey: '0,0,0', ...rec });

test('three communities are authored and each has a reserved, connected footprint (later ones chain onward when the frontier runs out)', async () => {
  const state = await generated({ db: { '0,0,0': { name: 'Start', visited: true, exits: { east: { status: 'open', targetCoordinates: '1,0,0', key: null } } } } });
  const r = region(state);
  assert.equal(r.communities.length, 3); assert.equal(r.residents.length, 6);
  assert.equal(state.db()['0,0,0'].livingRegionAttempt.status, 'generated');
  assert.deepEqual(r.communities.map(c => r.routes.some(x => x.communityId === c.id && x.footprint)), [true, true, true]);
  const chained = r.routes.filter(x => x.chainedFrom);
  assert.ok(chained.length >= 1, 'the single frontier is used once; the others continue from earlier footprints');
  for (const x of chained) { assert.ok(x.footprint.links.some(l => l.kind === 'connector' && l.to === x.cells[0])); assert.ok(World.connected(r, x.communityId).includes(x.chainedFrom)); }
  assert.ok(new Set(r.routes.flatMap(x => x.footprint.rooms)).size === r.routes.flatMap(x => x.footprint.rooms).length, 'no cell reserved twice');
  // Built in any order, the chained route becomes walkable from the start.
  const db = state.db(), rooms = [...new Set(r.routes.flatMap(x => x.footprint.rooms.filter(k => k !== x.gate?.key)))].reverse();
  for (const k of rooms) { db[k] ||= { name: 'Room ' + k }; RoomTopology.prepare(db, k, { seed: 's' }); db[k].visited = true; }
  for (const x of r.routes) assert.equal(Topology.status(db, x).status, 'traversable', x.communityId);
});

test('narration and dialogue never become facts; committed records from other systems do, with their own witnesses', async () => {
  const state = await generated(); materialize(state, 'r1');
  const r0 = region(state), before = r0.ledger.facts.length, key = r0.communities[0].anchor.key;
  memory(state, { id: 'room-turn:x', kind: 'room-history', authority: 'reported', source: 'room-turn-narrative', text: 'Orsel Vane collapses and dies.', roomKey: key, witnesses: ['Hero', 'Ally', 'Orsel Vane'] });
  memory(state, { id: 'speech:x', kind: 'dialogue', authority: 'statement', source: 'turn-dialogue', speaker: 'Orsel Vane', text: 'I gave my chain to the Hollow King.', roomKey: key, witnesses: ['Hero', 'Ally', 'Orsel Vane'] });
  turnAt(state, key, 3);
  let r = region(state);
  assert.ok(!r.ledger.facts.some(f => /room-turn|speech/.test(f.key || '')), 'no fact from narration or speech'); assert.ok(r.ledger.facts.length >= before);
  assert.ok(!r.ledger.facts.some(f => /dies|Hollow King/.test(f.text)));
  assert.equal(state.db()[key].inhabitants.actors['Orsel Vane'].status, 'present', 'narrated death changes nothing');
  memory(state, { id: 'transfer:t1', kind: 'activity', authority: 'state', source: 'committed-game-state', text: 'Hero gave a copper ring to Orsel Vane. The item left the giver\'s inventory and was received.',
    actors: ['Hero', 'Orsel Vane'], roomKey: key, witnesses: ['Hero', 'Ally', 'Orsel Vane'] });
  turnAt(state, key, 4); r = region(state);
  const f = r.ledger.facts.find(x => x.key === 'mem:transfer:t1');
  assert.ok(f && f.kind === 'world-event' && f.evidence[0].category === 'exchange' && f.communityId === 'c1');
  assert.ok(World.knows(r, 'Orsel Vane', f.id) && World.knows(r, 'Ally', f.id) && !World.knows(r, 'Kettri Moss', f.id), 'only those present know at first');
  assert.ok(r.world.people['orsel vane'].events.includes(f.id));
  assert.equal(r.world.people['orsel vane'].hp, undefined, 'the world layer keeps history, not a second copy of state');
});

test('every story system contributes verified events: main quest, jobs, favors, combat, injuries, exploration and companions', async () => {
  const state = await generated();
  state.change(d => {
    d['1,1,0'] = { name: 'Fish Market', visited: true, inhabitants: { actors: { 'Pell Garr': { name: 'Pell Garr', status: 'present' }, 'Tam Holt': { name: 'Tam Holt', status: 'present' } } },
      minorMissions: { job1: { id: 'job1', source: 'engine-local-contract-v1', status: 'accepted', recipient: 'Pell Garr', title: 'Deliver the sealed packet', roomKey: '1,1,0' } } };
    d['0,0,0'].adventureJournal = [{ id: 'task-1', source: 'engine-journal-v1', title: 'Found the ember shard', description: 'x', status: 'Completed' }];
    d['0,0,0'].combatLife = { source: 'engine-combat-life-v1', runId: 'run-w', actors: { ally: { name: 'Ally', type: 'npc', at: 3, save: { natural: 15, total: 15, difficulty: 12, passed: true } } }, defeats: [{ source: 'engine-combat-defeat-v1', runId: 'run-w', name: 'Tam Holt', roomKey: '1,1,0', at: 4 }] };
  });
  memory(state, { id: 'quest:step1', kind: 'quest', authority: 'state', source: 'verified-quest-gate', text: 'Completed quest step: Found the ember shard', roomKey: '1,1,0' });
  turnAt(state, '1,1,0', 5);
  const r = region(state), cats = new Set(r.ledger.facts.filter(f => f.kind === 'world-event').map(f => f.evidence[0].category));
  for (const c of ['main-quest', 'job', 'combat', 'injury', 'exploration']) assert.ok(cats.has(c), c);
  assert.deepEqual(r.world.people['pell garr'].promises, [{ missionId: 'job1', title: 'Deliver the sealed packet', status: 'accepted' }]);
  assert.equal(r.world.people['ally'].injuries.length, 1); assert.ok(r.world.people['tam holt'].fallen);
  // Party change: a companion leaving is recorded from the roster, never from prose.
  state.getCombatCharactersString = () => JSON.stringify([{ name: 'Hero', type: 'pc' }]);
  state.setConsole('1,1,0', 6); const text = state.getUpdatedGameConsole().replace(/NPCs in Party:\n[^\n]*\n/, 'NPCs in Party:\n');
  quietSync(() => LR.turn(state, { geoKey: '1,1,0', consoleText: text }));
  assert.ok(region(state).ledger.facts.some(f => f.text === 'Ally left the party.'));
  assert.equal(state.taskWrites(), 0, 'the world layer never writes main-quest tasks');
  // Favor completion for the same contact, and the job itself is never silently invalidated.
  state.change(d => { d['1,1,0'].minorMissions.job1.status = 'completed'; });
  turnAt(state, '1,1,0', 7);
  assert.equal(region(state).world.people['pell garr'].promises[0].status, 'completed');
});

test('tiers: background figures stay unregistered until a meaningful interaction; residents are regional; the active cast is bounded and near the player', async () => {
  const state = await generated();
  for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) materialize(state, id);
  const r0 = region(state), A = r0.communities[0].anchor.key;
  state.change(d => { d[A].inhabitants.actors['Crowd Seller'] = { name: 'Crowd Seller', status: 'present' }; d[A].inhabitants.actors['Old Fenn'] = { name: 'Old Fenn', status: 'present' }; });
  turnAt(state, A, 2);
  let w = region(state).world;
  assert.equal(w.people['crowd seller'], undefined, 'present but no interaction: background');
  for (const t of [3, 4, 5]) memory(state, { id: 'speech:fenn:' + t, turn: t, kind: 'dialogue', authority: 'statement', source: 'turn-dialogue', speaker: 'Old Fenn', text: 'Mind the tide.', roomKey: A, witnesses: ['Hero', 'Ally', 'Old Fenn'] });
  turnAt(state, A, 6); w = region(state).world;
  assert.equal(w.people['old fenn'].tier, 'regional', 'repeated conversation makes them persistent; living in a community room makes them regional');
  assert.equal(w.people['crowd seller'], undefined);
  assert.equal(w.people['orsel vane'].tier, 'regional'); assert.equal(w.people['orsel vane'].regionalRole.via, 'authored');
  assert.equal(w.people['ally'].tier, 'persistent', 'a party member in a community room stays a persistent party member'); assert.equal(w.people['ally'].party, true);
  assert.ok(w.active.length <= World.LIMITS.activeCast);
  assert.ok(w.active.every(a => a.distance <= World.LIMITS.activeRadius));
  assert.ok(w.active.some(a => a.name === 'Orsel Vane'), 'people where the player is are active');
  const far = region(state).communities.find(c => Topology.search(state.db(), A).get(c.anchor.key) === undefined && c.anchor.key !== A);
  if (far) assert.ok(!w.active.some(a => region(state).residents.find(r => r.name === a.name)?.homeCommunityId === far.id), 'distant communities are not active');
});

test('knowledge travels by plausible channels and later: community word after a delay when the player is near, then connected communities; never instantly', async () => {
  const state = await generated();
  for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) materialize(state, id);
  const r0 = region(state), A = r0.communities[0].anchor.key;
  memory(state, { id: 'transfer:t2', turn: 10, kind: 'activity', authority: 'state', source: 'committed-game-state', text: 'Hero gave a lamp to Orsel Vane.', actors: ['Hero', 'Orsel Vane'], roomKey: A, witnesses: ['Hero', 'Orsel Vane'] });
  turnAt(state, A, 10);
  let r = region(state); const f = r.ledger.facts.find(x => x.key === 'mem:transfer:t2');
  assert.ok(!World.knows(r, 'Kettri Moss', f.id), 'a neighbour has not heard yet');
  assert.ok(r.world.pending.some(p => p.factId === f.id && p.communityId === 'c1'));
  turnAt(state, '0,0,0', 12); r = region(state);
  assert.ok(!World.knows(r, 'Kettri Moss', f.id), 'the player is away: distant state waits');
  turnAt(state, A, 13); r = region(state);
  assert.ok(World.knows(r, 'Kettri Moss', f.id)); assert.equal(Ledger.beliefsOf(r.ledger, 'Kettri Moss').find(b => b.factId === f.id).channel, 'hearsay');
  const linked = World.connected(r, 'c1'), unlinked = r.communities.map(c => c.id).filter(id => id !== 'c1' && !linked.includes(id));
  for (const id of unlinked) for (const n of r.residents.filter(x => x.homeCommunityId === id).map(x => x.name)) assert.ok(!World.knows(r, n, f.id), 'unconnected communities never hear');
  // The memory mirror carries beliefs with only the holder as witness, so dialogue recall is bounded too.
  const recs = Ledger.memoryRecords(r.ledger).filter(m => m.source === 'living-region-belief' && m.text.includes('lamp'));
  assert.ok(recs.every(m => m.witnesses.length === 1));
  assert.ok(!Ledger.memoryRecords(r.ledger).some(m => m.id === 'living-region:' + f.id), 'a copied memory record is not mirrored twice');
});

test('reputation is what a community knows: a known killing closes new work there (with a notice); accepted work is never withdrawn', async () => {
  const state = await generated();
  materialize(state, 'r3'); materialize(state, 'r4');
  const r0 = region(state), B = r0.communities[1].anchor.key;
  state.change(d => { d['0,0,0'].combatLife = { source: 'engine-combat-life-v1', runId: 'run-w', actors: {}, defeats: [{ source: 'engine-combat-defeat-v1', runId: 'run-w', name: 'Hesk Arlow', roomKey: B, at: 9 }] };
    d[B].inhabitants.actors['Hesk Arlow'].status = 'dead'; });
  turnAt(state, B, 9); turnAt(state, B, 12);
  const r = region(state);
  assert.ok(r.world.reputation.c2.score <= -2 && r.world.reputation.c2.closed, JSON.stringify(r.world.reputation.c2));
  assert.equal(r.world.reputation.c1?.closed || false, false, 'other communities have not heard');
  // Dunmar's request is not offered while closed (placing it would otherwise offer it).
  state.change(d => { const res = d['0,0,0'].livingRegion.residents.find(x => x.id === 'r3'); Object.assign(res.goal.objective, { status: 'sealed', cacheKey: '0,0,0', cacheName: 'Start' }); });
  const t = turnAt(state, B, 13);
  assert.match(t.notice + region(state).state.told.join(' '), /closed:c2|will not ask the party for help/);
  assert.ok(!region(state).quests.some(q => q.residentId === 'r3'));
});

test('a character who becomes important through play acquires a regional role on their own record (one model call); guards keep main-quest people and accepted work', async () => {
  const state = await generated({ answers: [...ANSWERS(), ADOPT('net needle')] });
  const before = state.gen.calls.length;
  state.change(d => { d['0,1,0'] = { name: 'Net Loft', visited: true, exits: { south: { status: 'open', targetCoordinates: '0,0,0' } }, inhabitants: { actors: {
    'Wenna Cole': { name: 'Wenna Cole', status: 'present', hp: 9, history: 'Wenna mends nets for the landing.' },
    'Hollow King': { name: 'Hollow King', status: 'present', hp: 40 } } } }; });
  for (let i = 0; i < 4; i++) memory(state, { id: 'act:w' + i, turn: 20 + i, kind: 'activity', authority: 'adjudicated', source: 'selected-dice-outcome', text: `Hero: helped [Persuade; success; target: Wenna Cole; performed steps: none]`, actors: ['Hero'], roomKey: '0,1,0', witnesses: ['Hero', 'Wenna Cole'] });
  for (let i = 0; i < 4; i++) memory(state, { id: 'act:k' + i, turn: 20 + i, kind: 'activity', authority: 'adjudicated', source: 'selected-dice-outcome', text: `Hero: taunted [Intimidate; success; target: Hollow King; performed steps: none]`, actors: ['Hero'], roomKey: '0,1,0', witnesses: ['Hero', 'Hollow King'] });
  turnAt(state, '0,1,0', 24, { enteringRoom: true });
  let r = region(state);
  assert.ok(r.world.adoptions.some(a => a.name === 'Wenna Cole'));
  assert.ok(r.world.guards.some(g => g.rule === 'main-quest-person' && g.subject === 'Hollow King'), 'main-quest people keep their role');
  await quiet(() => LR.ensure($, state, { request: state.gen.request })); await LR.jobs.settle();
  turnAt(state, '0,1,0', 25);
  r = region(state);
  assert.equal(state.gen.calls.length - before, 2, 'adoption: one authoring call and its one review pass');
  assert.equal(region(state).world.cost.modelJobs.adoption, 1);
  const res = r.residents.find(x => x.name === 'Wenna Cole');
  assert.ok(res && res.adopted && res.goal.channel === 'delivery' && res.goal.item === 'net needle');
  const rec = state.db()['0,1,0'].inhabitants.actors['Wenna Cole'];
  assert.equal(rec.hp, 9); assert.equal(rec.history, 'Wenna mends nets for the landing.'); assert.equal(rec.livingRegion.residentId, res.id, 'same record, not a new character');
  assert.equal(Object.keys(state.db()['0,1,0'].inhabitants.actors).filter(n => n === 'Wenna Cole').length, 1);
  assert.equal(r.world.people['wenna cole'].regionalRole.via, 'adopted');
});

test('bounded cost: many quiet turns call no model; ingest is idempotent; save/load keeps people, pending word and reputation', async () => {
  const state = await generated();
  const calls = state.gen.calls.length, t0 = Date.now();
  for (let t = 1; t <= 60; t++) turnAt(state, t % 2 ? '0,0,0' : '1,0,0', 100 + t);
  await LR.jobs.settle();
  assert.equal(state.gen.calls.length, calls, 'no model call on ordinary turns');
  assert.ok(Date.now() - t0 < 5000);
  assert.deepEqual(Object.keys(region(state).world.cost.modelCalls), ['authoring']); assert.deepEqual(region(state).world.cost.modelJobs, { social: 1 });
  memory(state, { id: 'transfer:t9', kind: 'activity', authority: 'state', source: 'committed-game-state', text: 'Hero gave bread to Ally.', actors: ['Hero', 'Ally'] });
  turnAt(state, '0,0,0', 170); const n = region(state).ledger.facts.length;
  turnAt(state, '0,0,0', 171); assert.equal(region(state).ledger.facts.length, n, 'the same record is never ingested twice');
  const saved = JSON.parse(JSON.stringify(state.db())), loaded = makeState({ db: saved, turns: 172 });
  loaded.mem.records.push(...state.mem.records);
  quietSync(() => LR.turn(loaded, { geoKey: '0,0,0', consoleText: loaded.getUpdatedGameConsole() }));
  const a = saved['0,0,0'].livingRegion.world, b = loaded.db()['0,0,0'].livingRegion.world;
  assert.deepEqual(Object.keys(b.people).sort(), Object.keys(a.people).sort()); assert.equal(loaded.db()['0,0,0'].livingRegion.ledger.facts.length, n, 'loading does not re-ingest');
  assert.ok(Ledger.verify(loaded.db()['0,0,0'].livingRegion.ledger).ok);
});

test('companions act on their own stakes when the party brings them there, and carry news when the party rests', async () => {
  const state = await generated();
  for (const id of ['r3', 'r4']) materialize(state, id);
  const r0 = region(state), B = r0.communities[1].anchor.key;
  // The party reaches Brinewatch along its route.
  state.change(d => { d['0,0,0'].livingRegion.communities[1].anchor.status = 'reachable'; });
  const t = turnAt(state, B, 30, { enteringRoom: true });
  const r = region(state);
  assert.match(t.notice, /Ally acts on a personal stake in Brinewatch/);
  assert.equal(r.companionThreads[0].status, 'acted'); assert.equal(r.communities[1].standing, 1);
  const hist = r.ledger.facts.find(f => f.kind === 'history' && f.communityId === 'c2');
  assert.ok(World.knows(r, 'Ally', hist.id), 'the companion learns the community history from its people');
  // A rest moment there: what Ally witnessed elsewhere reaches Brinewatch's people through Ally.
  memory(state, { id: 'quest:s2', kind: 'quest', authority: 'state', source: 'verified-quest-gate', text: 'Completed quest step: Lit the old signal.', roomKey: '9,9,0', witnesses: ['Hero', 'Ally'] });
  turnAt(state, '9,9,0', 31);
  state.change(d => { d[B].venueDesk = { stays: [{ nonce: 'n1', at: Date.now(), members: ['Hero', 'Ally'] }] }; });
  turnAt(state, B, 32);
  const r2 = region(state), q = r2.ledger.facts.find(f => f.key === 'mem:quest:s2');
  assert.ok(World.knows(r2, 'Dunmar Reed', q.id)); assert.equal(Ledger.beliefsOf(r2.ledger, 'Dunmar Reed').find(b => b.factId === q.id).heardFrom, 'Ally');
});

test('consequence guards: a distant development never moves someone in the active cast; the world layer writes no tasks and never ends the adventure', async () => {
  const state = await generated();
  const run = active => { const db = state.db(), reg = db['0,0,0'].livingRegion; reg.communities.forEach(c => { c.anchor.status = 'reachable'; });
    const t = reg.residents.find(x => x.willingTraveler); if (active) reg.world.active = [{ name: t.name, distance: 1, plan: t.goal.id }];
    return { d: LR.develop(db, reg, { kind: 'travel', communityId: 'c1' }, { turn: 1, notices: [] }), t, reg }; };
  const free = run(false); assert.equal(free.d.kind, 'traveler-moves', 'control: an inactive willing traveler can move');
  const held = run(true); assert.notEqual(held.d?.kind, 'traveler-moves'); assert.equal(held.reg.residents.find(x => x.id === held.t.id).travels.length, 0);
  assert.equal(state.taskWrites(), 0); assert.equal(state.getCurrentTasks()[0].status, 'Pending');
  // A distant defeat of someone the party has accepted work from is surfaced, never silently resolved.
  state.change(d => { d['5,5,0'] = { name: 'Far Dock', inhabitants: { actors: { 'Pell Garr': { name: 'Pell Garr', status: 'dead' } } }, minorMissions: { j: { id: 'j', source: 'engine-resident-favor-v1', status: 'accepted', recipient: 'Pell Garr', title: 'Find the lost key' } } };
    d['0,0,0'].combatLife = { source: 'engine-combat-life-v1', runId: 'run-w', actors: {}, defeats: [{ source: 'engine-combat-defeat-v1', runId: 'run-w', name: 'Pell Garr', roomKey: '5,5,0', at: 2 }] }; });
  const t = turnAt(state, '0,0,0', 3);
  assert.match(t.notice, /Pell Garr/); assert.equal(state.db()['5,5,0'].minorMissions.j.status, 'accepted', 'accepted work is not changed by the world layer');
});

test('initiative is selective: a trusted community vouches for another; an accepted request is followed up later; leaving demotes the active cast', async () => {
  const state = await generated();
  for (const id of ['r1', 'r2']) materialize(state, id);
  const A = region(state).communities[0].anchor.key;
  state.change(d => { const r = d['0,0,0'].livingRegion; r.communities[0].standing = 3; r.communities[0].anchor.status = 'reachable'; });
  const t = turnAt(state, A, 40, { enteringRoom: true });
  assert.equal(region(state).world.reputation.c1.trusted, true);
  assert.match(t.notice, /tells you (how to reach|of) (Brinewatch|Kelp Hollow)/);
  assert.equal(region(state).ledger.facts.filter(f => f.kind === 'initiative').length, 1, 'at most one vouch per community pair, bounded per turn');
  turnAt(state, A, 41, { enteringRoom: true });
  // Follow-up: accepted work that waits is asked after once, with no penalty.
  state.change(d => { const r = d['0,0,0'].livingRegion, res = r.residents.find(x => x.id === 'r1');
    r.quests.push({ id: 'q-test', goalId: res.goal.id, residentId: 'r1', roomKey: A, missionId: 'm-test', channel: 'mechanism' });
    d[A].minorMissions = { 'm-test': { id: 'm-test', source: 'engine-resident-favor-v1', status: 'accepted', recipient: 'Orsel Vane', title: 'Help Orsel' } }; });
  turnAt(state, A, 42);
  memory(state, { id: 'quest:late', turn: 51, kind: 'quest', authority: 'state', source: 'verified-quest-gate', text: 'Completed quest step: Opened the sluice.', roomKey: A });
  const late = turnAt(state, A, 51);
  assert.match(late.notice, /Orsel Vane sends word asking after brass survey chain; the request still stands/);
  assert.equal(state.db()[A].minorMissions['m-test'].status, 'accepted');
  assert.ok(region(state).world.active.some(a => a.name === 'Orsel Vane'));
  turnAt(state, '9,9,9', 52);
  assert.ok(!region(state).world.active.some(a => a.name === 'Orsel Vane'), 'out of range: back to persistent history only');
  assert.ok(region(state).world.people['orsel vane'].events.length > 0, 'their history stays');
});

test('HOLODEK_LIVING_REGION=0 disables the world layer as well', async () => {
  const state = makeState(), gen = requester(ANSWERS());
  process.env.HOLODEK_LIVING_REGION = '0';
  try { const out = await quiet(() => LR.ensure($, state, { request: gen.request })); assert.notEqual(out?.status, 'generated');
    const t = quietSync(() => LR.turn(state, { geoKey: '0,0,0' })); assert.ok(!t?.world); assert.equal(gen.calls.length, 0); assert.equal(state.db()['0,0,0'].livingRegion, undefined); }
  finally { process.env.HOLODEK_LIVING_REGION = '1'; }
});
