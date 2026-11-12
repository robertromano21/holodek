'use strict';
// Living region v5. Every test enables the feature explicitly; it is off by default.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { templateContent } = require('retort-js/dist/message');
const LR = require('../retort/livingRegion'), Ledger = require('../retort/livingRegionLedger'), Authoring = require('../retort/livingRegionAuthoring');
const Topology = require('../retort/livingRegionTopology'), Fixture = require('../retort/livingRegionFixture');
const RoomTopology = require('../retort/roomBuildTopology');
const I = require('../assets/dungeonInhabitants');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
const on = () => { process.env.HOLODEK_LIVING_REGION = '1'; };
on();
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
// Builds a route cell through the real topology pass, then marks it visited like room entry does.
function build(state, key, { protectedKeys = new Set() } = {}) {
  state.change(d => { d[key] ||= { name: 'Room ' + key }; RoomTopology.prepare(d, key, { seed: 'test-seed', protectedKeys }); d[key].visited = true; });
}
function routed() {
  return generated().then(state => {
    LR.turn(state, { geoKey: '0,0,0' });
    const route = state.db()['0,0,0'].livingRegion.routes[0];
    for (const key of route.cells) build(state, key);
    return { state, route };
  });
}
// A valid server checkpoint whose current room is `key` (the shape saveGameState.validate requires).
function checkpoint(State, key, db, over = {}) {
  const x = State.exportSaveState(), [cx, cy, cz] = key.split(',').map(Number);
  for (const k of ['personalNarrative', 'currentQuest', 'lastQuestUpdate']) if (typeof x[k] !== 'string') x[k] = '';
  return { ...x, dungeonRunId: 'run-a', combatCharactersString: '[]', roomMusicDatabase: {}, roomPopulations: {}, currentTasks: [], currentTaskIndex: 0, questLog: [], npcAutonomyFeed: [],
    lastCoords: { x: cx, y: cy, z: cz }, updatedGameConsole: consoleFor(key, 3), roomNameDatabaseString: JSON.stringify(db), roomDungeonDatabase: { [key]: grid(key) },
    dialogueMemory: {}, campaignMemory: { runId: 'run-a', version: 1, records: [], sequence: 0 }, gamePaused: false, dungeonTestingMode: false, questSeeded: false,
    characterGenerationInProgress: false, activeCityFloor: null, ...over };
}
function grid(geoKey, n = 16) {
  const d = { geoKey, layout: { width: n, height: n }, start: { x: 4, y: 4 }, cells: {}, tiles: {}, customTiles: [], sceneObjects: [] };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) d.cells[`${x},${y}`] = { tile: x && y && x < n - 1 && y < n - 1 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 3 };
  return d;
}

test('on by default through the repo flag convention; HOLODEK_LIVING_REGION=0 disables everything: no authoring, no exits, no slots, no turn output', async () => {
  const saved = process.env.HOLODEK_LIVING_REGION; delete process.env.HOLODEK_LIVING_REGION;
  try {
    assert.equal(require('../retort/worldFlags').DEFAULTS.LIVING_REGION, true);
    assert.equal(LR.enabled(), true, 'on with no environment override');
    for (const off of ['off', 'false']) { process.env.HOLODEK_LIVING_REGION = off; assert.equal(LR.enabled(), false, off + ' disables it'); }
    process.env.HOLODEK_LIVING_REGION = '0';
    assert.equal(LR.enabled(), false);
    const state = makeState(), gen = requester([STAGE1()]);
    assert.equal((await LR.ensure($, state, { request: gen.request })).status, 'disabled'); assert.equal(gen.calls.length, 0);
    assert.deepEqual(LR.turn(state, {}), { notice: '', prompt: '', moments: [], developments: [], consequences: [] });
    assert.deepEqual(LR.exitsFor(START(), '1,0,0'), []); assert.deepEqual(LR.reserveSlots([{ slot: 0 }], START(), '1,0,0'), []);
    assert.equal(LR.roomContext(START(), '1,0,0'), null); assert.deepEqual(LR.applyPhysical(grid('1,0,0'), '1,0,0', state), { changed: false });
    const db = START(); db['1,0,0'] = { name: 'x' }; RoomTopology.prepare(db, '1,0,0', { seed: 's' });
    assert.ok(Object.values(db['1,0,0'].exits).every(e => !e.livingRegionRoute && !e.livingRegionGate));
  } finally { process.env.HOLODEK_LIVING_REGION = saved ?? '1'; on(); }
});


test('release coverage: focused verify and helper release lists include the living-region test; the engine bundle ships every module', () => {
  const root = path.join(__dirname, '..');
  const verify = fs.readFileSync(path.join(root, '.retort-data/popup-viewport/verify.cjs'), 'utf8'), release = fs.readFileSync(path.join(root, '.retort-data/helper-release-sync/release.cjs'), 'utf8');
  for (const t of ['living-region', 'living-world']) { assert.match(verify, new RegExp(`'${t}'`)); assert.match(release, new RegExp(`'${t}\\.test\\.cjs'`)); }
  const files = require('../retort/websiteEngineBundle').build(root).files.map(f => f.path);
  for (const m of ['livingRegion', 'livingRegionAuthoring', 'livingRegionLedger', 'livingRegionTopology', 'livingRegionFixture', 'livingWorld']) assert.ok(files.includes(`retort/${m}.js`), m);
});


test('plan first: the engine fixes each resident\'s obstacle and consequence; stages author communities, then residents against those slots, then one review pass in parts small enough for the local model; social detail comes after', async () => {
  await fresh();
  const state = makeState(), gen = requester(ANSWERS());
  const { v: out } = await quiet(() => LR.ensure($, state, { request: gen.request }));
  assert.equal(out.status, 'generated');
  assert.deepEqual(gen.stages().slice(0, 3), ['communities', 'residents', 'review'], 'the playable region needs only these calls');
  const r0 = state.db()['0,0,0'].livingRegion;
  assert.equal(r0.ledger.facts.length, 0); assert.equal(r0.social.status, 'running', 'relationships and history are not part of the playable region');
  await LR.jobs.settle(); assert.deepEqual(gen.stages(), ['communities', 'residents', 'review', 'relations']);
  LR.turn(state, {});
  const r = state.db()['0,0,0'].livingRegion;
  assert.equal(r.social.status, 'authored');
  assert.deepEqual(Authoring.plan().slots.map(s => [s.id, s.obstacle, s.effect]), [['r1', 'hidden-chamber', 'restore-fixture'], ['r2', 'mechanism', 'earn-trust']]);
  assert.deepEqual(r.plan, Authoring.plan());
  assert.deepEqual(Object.keys(Authoring.stages(ctx())[1].collections.residents.fields), ['name', 'goalItem', 'residentAction', 'whyHidden', 'meaning', 'history', 'willingTraveler'], 'the model never chooses an obstacle or a consequence');
  assert.deepEqual(Object.keys(Authoring.stages(ctx())[0].collections.communities.fields), ['name', 'setting', 'landmarkName', 'landmarkPurpose', 'landmarkDamage', 'landmarkForm', 'problem', 'improvement', 'passageMatters', 'dangerMatters']);
  assert.deepEqual(Authoring.FIXTURE_FORMS, ['upright', 'frame', 'slab', 'column'], 'neutral visual forms; the landmark purpose is authored separately');
  assert.deepEqual(Authoring.OBSTACLES, ['hidden-chamber', 'mechanism']); assert.ok(!Authoring.GOAL_KINDS.some(k => Authoring.DEFERRED_GOAL_KINDS.includes(k)));
  const prompts = gen.prompts(), block = p => p.match(/PERMITTED EFFECTS \(authoritative[\s\S]*?as what retrieving or delivering the object does\./)?.[0];
  for (const p of prompts) assert.ok(block(p), 'every stage receives the permitted-effects list');
  assert.equal(new Set(prompts.map(block)).size, 1, 'the same list, word for word');
  assert.match(prompts[1], /r1 \(lives in c1 Saltreach Landing\): player action = the player travels to a room on the way to the community, searches its walls/);
  assert.match(prompts[1], /r2 \(lives in c1 Saltreach Landing\): player action = the player travels to a room on the way to the community where a physical mechanism is already built/);
  assert.match(prompts[1], /world consequence = the engine rebuilds "the cracked cistern" in the community room/);
  assert.match(prompts[2], /LIVING REGION REVIEW/); assert.match(prompts[2], /"path":"residents\[0\]\.residentAction"/); assert.match(prompts[2], /chainHolds/);
  assert.match(prompts[2], /"path":"communities\[0\]\.improvement"/); assert.match(prompts[2], /"path":"residents\[0\]\.history"/);
  assert.match(prompts[2], /"path":"residents\[1\]\.meaning"/, 'one review covers the chain and both residents');
  assert.ok(prompts[2].length < prompts[1].length + 3200, 'the combined review remains bounded by the authored stage');
  assert.match(prompts[3], /SOCIAL DETAIL/);
  assert.deepEqual(r.residents.map(x => [x.goal.kind, x.goal.consequence, x.goal.objective.obstacle, x.goal.objective.status]),
    [['deliver-sealed-item', 'fixture', 'hidden-chamber', 'unplaced'], ['deliver-mechanism-item', 'standing', 'mechanism', 'unplaced']]);
  assert.deepEqual(r.residents.map(x => [x.id, x.name, x.communityId, x.goal.id, x.goal.requirements]), [['r1', 'Orsel Vane', 'c1', 'lrg:r1', { kind: 'retrieve', item: 'brass survey chain', recipientId: 'r1' }],
    ['r2', 'Kettri Moss', 'c1', 'lrg:r2', { kind: 'retrieve', item: 'lamp oil cask', recipientId: 'r2' }]], 'explicit target requirements exist before any favor');
  assert.deepEqual(r.residents.map(x => x.goal.text), ['Bring brass survey chain to Orsel Vane so they can true the fallen stones of the cracked cistern with it.',
    'Bring lamp oil cask to Kettri Moss so they can keep the lower gate lamps lit through the night.']);
  assert.deepEqual(r0.communities.map(c => [c.id, c.name, c.fixture.name, c.fixture.form, c.fixture.state, c.anchor.status]), [['c1', 'Saltreach Landing', 'the cracked cistern', 'slab', 'damaged', 'planned']]);
  assert.match(r.communities[0].purpose, /drinking water/); assert.match(r.communities[0].improvement, /holds water again/);
  assert.deepEqual(r.residents.map(x => x.relationships), [[{ kind: 'rival', target: 'r2', source: 'authored' }], [{ kind: 'rival', target: 'r1', source: 'authored' }]]);
  assert.equal(r0.routes.length, 1, 'the footprint is reserved when the region is generated'); assert.ok(r0.routes[0].footprint.rooms.includes(r0.routes[0].anchor));
  for (const p of prompts) assert.doesNotMatch(p, /e\.g\.|for example|such as|for instance/i);
  // Only accepted content from earlier stages appears; no sample content is ever placed in a prompt.
  assert.doesNotMatch(prompts[0], /Saltreach|cistern|Orsel|survey chain|lamp oil/); assert.doesNotMatch(prompts[1], /Orsel|survey chain|lamp oil/);
});

test('an invalid field is repaired in place: accepted values stay, no renaming, only the listed field changes', async () => {
  await fresh();
  const bad = STAGE2(); bad.residents[1].goalItem = 'Orsel Vane';
  const repair = { residents: [{ index: 1, remove: false, ...STAGE2().residents[1], name: 'Renamed Person' }, { index: 0, remove: false, ...STAGE2().residents[0], name: 'Other Name' }] };
  const state = makeState(), gen = requester([STAGE1(), bad, repair, REVIEW(), STAGE3()]);
  const { v: out } = await quiet(() => LR.ensure($, state, { request: gen.request }));
  assert.equal(out.status, 'generated'); assert.deepEqual(gen.stages().slice(0, 4), ['communities', 'residents', 'residents', 'review']);
  assert.equal(gen.calls[2].context.repair, true); assert.deepEqual(Object.keys(gen.calls[2].parameters), ['residents']);
  assert.match(gen.prompts()[2], /residents\[1\]\.goalItem: must be an object, not a person/); assert.match(gen.prompts()[2], /Do not rename people/);
  const r = state.db()['0,0,0'].livingRegion;
  assert.deepEqual(r.residents.map(x => [x.name, x.goal.item, x.goal.consequence]), [['Orsel Vane', 'brass survey chain', 'fixture'], ['Kettri Moss', 'lamp oil cask', 'standing']]);
  const lead = Authoring.accept(Authoring.stages(ctx())[1], { residents: [{ ...STAGE2().residents[0], residentAction: 'so they can true the stones of the cistern.' }, STAGE2().residents[1]] }, { plan: Authoring.plan() }).residents[0];
  assert.equal(lead.itemUse, 'true the stones of the cistern', 'a repeated "so they can" lead-in is normalized');
  assert.equal(Authoring.verbPhrase('Orsel Vane wants to restores the cistern', 'Orsel Vane'), 'restore the cistern');
  const hyphen = Authoring.accept(Authoring.stages(ctx())[1], { residents: [{ ...STAGE2().residents[0], name: 'Veyra Ashen-Throat' }, STAGE2().residents[1]] }, { plan: Authoring.plan() }).residents[0];
  assert.equal(hyphen.name, 'Veyra Ashen Throat', 'names use the population pipeline\'s own normalization, so the generated record matches');
  assert.equal(LR.slotProblem({ slot: 0, regionalIdentity: { name: 'Veyra Ashen Throat' } }, { name: 'Veyra Ashen-Throat' }), null);
});

test('narrative review is a second line: over-promising text and a broken chain are flagged by path and only those text fields are rewritten; gameplay never changes; there is no verb blacklist', async () => {
  await fresh();
  const stage = Authoring.stages(ctx())[1], accepted = { communities: [{ id: 'c1', name: 'Saltreach Landing', fixtureName: 'the cracked cistern' }] };
  const promise = STAGE2(); promise.residents[0].residentAction = 'free the souls of the drowned cistern keepers'; promise.residents[1].residentAction = 'repair the cracked cistern and unlock the vault';
  assert.deepEqual(Authoring.check(stage, promise, ctx(), accepted), [], 'engine checks are structural only');
  const flagged = REVIEW([{ path: 'residents[0].residentAction', problem: 'Claims to free souls; the consequence only rebuilds the cistern.' },
    { path: 'residents[1].residentAction', problem: 'Claims a repair and an unlock; earn-trust changes nothing physical.' }], false);
  const fixes = { fixes: [{ path: 'residents[0].residentAction', text: 'so they can reset the split stones of the cracked cistern with it' },
    { path: 'residents[1].residentAction', text: 'keeps watch at the lower gate with it' },
    { path: 'communities[0].problem', text: 'The split cistern drains away, so families ration what water they carry up.' },
    { path: 'communities[0].improvement', text: 'With the cistern whole, families draw water again instead of rationing.' },
    { path: 'residents[0].history', text: 'not listed, ignored' }] };
  const state = makeState(), gen = requester([STAGE1(), promise, flagged, fixes, STAGE3()]);
  const { v: out } = await quiet(() => LR.ensure($, state, { request: gen.request }));
  assert.equal(out.status, 'generated');
  assert.deepEqual(gen.calls.slice(2, 4).map(c => c.context.attempt), ['review', 'review-repair']);
  const repairPrompt = gen.prompts()[3];
  assert.match(repairPrompt, /REWRITE THESE/); assert.match(repairPrompt, /residents\[0\]\.residentAction/); assert.match(repairPrompt, /communities\[0\]\.improvement/);
  assert.match(repairPrompt, /GAMEPLAY PLAN \(fixed, engine-owned\)/); assert.match(repairPrompt, /PERMITTED EFFECTS/);
  const r = state.db()['0,0,0'].livingRegion;
  assert.deepEqual(r.residents.map(x => x.goal.itemUse), ['reset the split stones of the cracked cistern with it', 'keep watch at the lower gate with it']);
  assert.deepEqual(r.residents.map(x => [x.name, x.goal.item, x.goal.objective.obstacle, x.goal.consequence, x.history]), [['Orsel Vane', 'brass survey chain', 'hidden-chamber', 'fixture', 'Orsel surveyed the landing for twenty years.'],
    ['Kettri Moss', 'lamp oil cask', 'mechanism', 'standing', 'Kettri keeps the lower gate.']], 'gameplay and unlisted text are unchanged');
  assert.match(r.communities[0].need, /families ration what water/); assert.match(r.communities[0].improvement, /draw water again/);
  assert.deepEqual(r.review.flagged.sort(), ['communities[0].improvement', 'communities[0].problem', 'residents[0].residentAction', 'residents[1].residentAction']);
  // A failed review call is recorded in the trace, never fatal and never silent.
  await fresh();
  const s2 = makeState(), g2 = requester([STAGE1(), STAGE2(), Error('provider unavailable'), STAGE3()]);
  assert.equal((await quiet(() => LR.ensure($, s2, { request: g2.request }))).v.status, 'generated');
  assert.equal(s2.db()['0,0,0'].livingRegion.review.ran, false); assert.deepEqual(s2.db()['0,0,0'].livingRegion.review.failedParts, ['c1']);
  assert.ok(s2.db()['0,0,0'].livingRegionAttempt.trace.some(t => t.stage === 'review' && t.ok === false && /provider unavailable/.test(t.error)));
  const source = fs.readFileSync(path.join(__dirname, '../retort/livingRegionAuthoring.js'), 'utf8');
  assert.doesNotMatch(source, /REPAIR_VERBS|PROMISES|UNSUPPORTED_OUTCOMES|PHYSICAL\s*=/, 'no verb or outcome blacklist');
});

test('a review rewrite that talks about the game instead of the world is not applied; the original text stays and is recorded', async () => {
  let text = 'They keep the lower gate lamps lit.';
  const fields = [{ path: 'residents[1].residentAction', text, set: v => { text = v; } }, { path: 'residents[1].meaning', text: 'Kettri hopes.', set: () => {} }];
  const gen = requester([REVIEW([{ path: 'residents[1].residentAction', problem: 'Too vague.' }, { path: 'residents[1].meaning', problem: 'Too short.' }]),
    { fixes: [{ path: 'residents[1].residentAction', text: 'give the cask; the engine then raises trust' }, { path: 'residents[1].meaning', text: 'Kettri hopes the gate stays lit.' }] }]);
  const trace = [], out = await Authoring.review($, gen.request, ctx(), { planText: '{}', fields, trace });
  assert.deepEqual(out.fixes.map(f => f.path), ['residents[1].meaning']);
  assert.deepEqual(trace.find(x => x.attempt === 'review-repair').notApplied, ['residents[1].residentAction']);
  assert.match(gen.prompts()[1], /never mentions the engine/); assert.match(gen.prompts()[0], /never mentions the engine/);
});

test('when the chain holds, a flag on the repair resident\'s own rebuilding action is dismissed, not rewritten; other flags still are', async () => {
  let repair = 'fit the iron pin into the gate so it swings true again', other = 'raise the gate with the cask';
  const fields = [{ path: 'communities[0].problem', text: 'Water spills past the troughs.', set: () => {} },
    { path: 'residents[0].residentAction', text: repair, set: v => { repair = v; } }, { path: 'residents[1].residentAction', text: other, set: v => { other = v; } }];
  const parts = [{ id: 'c1', chain: true, planText: '{}', paths: fields.map(f => f.path), repairPaths: ['residents[0].residentAction'] }];
  const gen = requester([{ review: [{ chainHolds: true, chainProblem: 'none', issues: [{ path: 'residents[0].residentAction', problem: 'Claims the gate is repaired.' }, { path: 'residents[1].residentAction', problem: 'Earn-trust cannot change the gate.' }] }] },
    { fixes: [{ path: 'residents[1].residentAction', text: 'hang the cask by the gate as a thanks' }] }]);
  const trace = [], out = await Authoring.review($, gen.request, ctx(), { planText: '{}', fields, trace, parts });
  assert.deepEqual(out.fixes.map(f => f.path), ['residents[1].residentAction']);
  assert.deepEqual(trace.find(x => x.attempt === 'review').dismissed, ['residents[0].residentAction']);
  assert.match(gen.prompts()[0], /A resident action that tells its own consequence this way is correct/);
});

test('an unrepaired reference fails visibly, keeps accepted stages, invents nothing, and an explicit retry resumes at that stage', async () => {
  await fresh();
  const bad = STAGE2(); bad.residents[0].name = 'Hero';
  const state = makeState(), gen = requester([STAGE1(), bad, { residents: [{ index: 0, remove: false, ...bad.residents[0] }] }]);
  const { v: out, logs } = await quiet(() => LR.ensure($, state, { request: gen.request }));
  assert.equal(out.status, 'failed'); assert.equal(out.stage, 'residents'); assert.equal(gen.calls.length, 3);
  assert.ok(logs.some(l => /\[LivingRegion\] FAILED/.test(l)));
  const attempt = state.db()['0,0,0'].livingRegionAttempt;
  assert.equal(state.db()['0,0,0'].livingRegion, undefined, 'no region is substituted');
  assert.deepEqual(attempt.acceptedStages, ['communities']); assert.equal(attempt.accepted.residents, undefined, 'no invented residents');
  const first = LR.turn(state, {}); assert.equal(first.notice, '', 'authoring failure stays in server diagnostics');
  assert.equal(LR.turn(state, {}).notice, '', 'failure is consumed once');
  const idle = requester([STAGE2()]);
  assert.equal((await LR.ensure($, state, { request: idle.request, userInput: 'look around' })).status, 'failed'); assert.equal(idle.calls.length, 0, 'no silent auto-retry');
  const retry = requester([STAGE2(), REVIEW(), STAGE3()]);
  const { v: again } = await quiet(() => LR.ensure($, state, { request: retry.request, userInput: 'retry living region' }));
  assert.equal(again.status, 'generated'); assert.deepEqual(retry.stages().slice(0, 2), ['residents', 'review'], 'accepted stages are reused'); await LR.jobs.settle();
  assert.deepEqual(state.db()['0,0,0'].livingRegion.residents.map(r => r.name), ['Orsel Vane', 'Kettri Moss']);
});

test('no JSON at all gets one more full call; a model error after that fails visibly', async () => {
  await fresh();
  const state = makeState(), gen = requester([Error('provider unavailable'), Error('provider unavailable')]);
  const { v: out } = await quiet(() => LR.ensure($, state, { request: gen.request }));
  assert.equal(out.status, 'failed'); assert.equal(gen.calls.length, 2); assert.equal(out.stage, 'communities');
});

test('a new game authors once; a loaded save restores its region without calling the model; an old save is skipped', async () => {
  await fresh();
  const state = makeState(), gen = requester(ANSWERS());
  await quiet(() => LR.ensure($, state, { request: gen.request })); await quiet(() => LR.ensure($, state, { request: gen.request }));
  await LR.jobs.settle(); assert.equal(gen.calls.length, 4);
  const saved = state.db(), loaded = makeState({ db: saved, turns: 9 }), load = requester([STAGE1()]);
  assert.equal((await LR.ensure($, loaded, { request: load.request })).status, 'present'); assert.equal(load.calls.length, 0);
  // Another run's database without run-a's reserved community skeleton (whose name would collide with the same answers).
  const otherDb = Object.fromEntries(Object.entries(saved).filter(([, v]) => !v.livingRegionReserved));
  const other = makeState({ runId: 'run-b', db: otherDb }), next = requester(ANSWERS());
  assert.equal((await quiet(() => LR.ensure($, other, { request: next.request }))).v.status, 'generated'); await LR.jobs.settle(); assert.equal(next.calls.length, 4);
  const old = makeState({ runId: 'run-old', turns: 14 }), none = requester([STAGE1()]);
  assert.equal((await quiet(() => LR.ensure($, old, { request: none.request }))).v.status, 'skipped'); assert.equal(none.calls.length, 0);
});

test('authored prose is stored in full; only prompt excerpts are shortened; collections are bounded', async () => {
  const long = 'The cistern stones split along an old seam '.repeat(120).trim();
  const s1 = STAGE1(); s1.communities[0].problem = long;
  const s3 = STAGE3(); s3.facts[0].text = long;
  const state = await generated({}, [s1, STAGE2(), REVIEW(), s3]);
  LR.turn(state, {});
  const r = state.db()['0,0,0'].livingRegion;
  assert.equal(r.communities[0].need, long); assert.equal(r.ledger.facts[0].text, long);
  assert.ok(state.gen.calls.every(c => !Object.hasOwn(c, 'maxTokens')), 'authoring does not set an output token cap');
  assert.ok(state.gen.prompts()[1].length < long.length + 4000 && !state.gen.prompts()[1].includes(long), 'prompt uses an excerpt');
  const l = Ledger.create('run-x'), f = Ledger.append(l, { kind: 'history', writer: 'authored-history', text: long });
  assert.equal(Ledger.truth(l, f.id).text, long);
  const tooMany = STAGE2(); tooMany.residents.push({ ...STAGE2().residents[0], name: 'Third Person' });
  assert.ok(Authoring.check(Authoring.stages(ctx())[1], tooMany, ctx(), { communities: [{ id: 'c1', name: 'Saltreach Landing' }] }).some(i => i.excess));
  assert.ok(Authoring.MAX.communities === 3 && Authoring.MAX.residents === 10, 'schema extends to 3 communities and 6-10 residents');
  const wide = Authoring.stages(ctx(), { communities: 3, residentsPerCommunity: 3, factsMin: 4, factsMax: 8 }, Authoring.plan({ communities: 3, residentsPerCommunity: 3 }));
  assert.deepEqual(wide[0].collections.communities.count, [3, 3]); assert.deepEqual(wide[1].collections.residents.count, [9, 9]);
  const unbounded = STAGE1(); unbounded.communities[0].name = 'A'.repeat(120); unbounded.communities[0].problem = 'a'.repeat(61000);
  assert.deepEqual(Authoring.check(Authoring.stages(ctx())[0], unbounded, ctx(), {}), [], 'long authored names and prose are not rejected by character limits');
});

test('ledger is append-only: facts are truth, beliefs are separate witness records, tampering is detected', () => {
  const l = Ledger.create('run-a');
  const f = Ledger.append(l, { kind: 'history', writer: 'authored-history', text: 'The cistern cracked.' });
  const b = Ledger.believe(l, { factId: f.id, holder: 'Orsel Vane', account: 'It was sabotage.', matchesTruth: false, channel: 'hearsay' });
  assert.equal(Ledger.truth(l, f.id).text, 'The cistern cracked.'); assert.equal(b.matchesTruth, false); assert.ok(Ledger.verify(l).ok);
  assert.equal(Ledger.append(l, { kind: 'discovery', writer: 'discovery', key: 'k', text: 'Reached.' }).id, 'lrf:2');
  assert.equal(Ledger.append(l, { kind: 'discovery', writer: 'discovery', key: 'k', text: 'Reached again.' }), null);
  assert.throws(() => Ledger.append(l, { kind: 'history', writer: 'model', text: 'x' }), /writer/);
  const tampered = structuredClone(l); tampered.facts[0].text = 'Nothing cracked.'; assert.equal(Ledger.verify(tampered).ok, false);
  const removed = structuredClone(l); removed.facts.pop(); assert.equal(Ledger.verify(removed).ok, false);
});


test('ledger facts and beliefs mirror into campaign memory once; companion stakes surface as biography', async () => {
  const state = await generated(); LR.turn(state, {});
  const mem = state.getCampaignMemory().records;
  assert.ok(mem.find(r => r.id === 'living-region:lrf:1')); assert.deepEqual(mem.find(r => r.id === 'living-region:lrb:1').witnesses, ['Orsel Vane']);
  assert.deepEqual(mem.find(r => r.source === 'living-region-companion-thread').actors, ['Ally']);
  const before = mem.length; LR.turn(state, {}); assert.equal(state.getCampaignMemory().records.length, before);
});

test('the route is laid through real topology preparation without announcing undiscovered communities', async () => {
  const state = await generated();
  const planned = LR.turn(state, { geoKey: '0,0,0' });
  assert.equal(planned.notice, '', 'unvisited communities and needs are not announced');
  state.change(d => { d['0,0,0'].livingRegion.state.notices.push('Living region authored: secret need', 'Living region: its rooms and connecting exits are now reserved.', 'Route confirmed: secret place', 'A resident offers help.'); });
  assert.equal(LR.turn(state, { geoKey: '0,0,0' }).notice, 'A resident offers help.', 'legacy setup notices are hidden without hiding gameplay');
  const route = state.db()['0,0,0'].livingRegion.routes[0];
  assert.equal(route.cells[0], '1,0,0'); assert.equal(route.cells.length, 3); assert.equal(route.anchor, route.cells[2]);
  assert.equal(state.db()['0,0,0'].livingRegion.communities[0].anchor.status, 'planned');
  assert.equal(LR.roomContext(state.db(), '0,0,0'), null, 'nothing is advertised from rooms without a route exit');
  build(state, route.cells[0]);
  assert.equal(state.db()[route.cells[0]].exits[route.dirs[0]].targetCoordinates, route.cells[1], 'normal prepare pass created the route exit');
  assert.deepEqual(LR.roomContext(state.db(), route.cells[0]), { role: 'approach', toward: 'Saltreach Landing', exit: route.dirs[0], rule: LR.roomContext(state.db(), route.cells[0]).rule });
  assert.doesNotMatch(LR.turn(state, { geoKey: route.cells[0] }).notice, /Route confirmed/);
  build(state, route.cells[1]); build(state, route.cells[2]);
  const confirmed = LR.turn(state, { geoKey: route.cells[1] });
  assert.doesNotMatch(confirmed.notice, /Route confirmed|Saltreach Landing is reachable/, 'route discovery happens through exits, not setup narration');
  const db = state.db(), r = db['0,0,0'].livingRegion;
  assert.equal(r.communities[0].anchor.status, 'reachable'); assert.equal(r.routes[0].status, 'traversable');
  assert.deepEqual(Topology.directions(db, route.anchor).map(s => s.to), ['1,0,0', route.cells[1], route.cells[2]]);
  for (let i = 0; i < 2; i++) { const e = db[route.cells[i]].exits[route.dirs[i]]; assert.equal(e.status, 'open'); assert.equal(db[route.cells[i + 1]].exits[Topology.OPP[route.dirs[i]]].targetCoordinates, route.cells[i]); }
  if (route.gate) assert.equal(db[route.anchor].exits[route.gate.dir].status, 'blocked', 'the side passage is a real blocked exit');
  assert.equal(LR.roomContext(db, route.anchor).role, 'community');
});


test('route planning avoids built rooms, city sites, regional rooms, boss targets, exit targets and protected in-flight cells', async () => {
  const db = START(); Object.assign(db['0,0,0'], { campaignAtlas: { map: { cities: [{ site: { key: '3,0,0' } }] } }, regionalAdventure: { rooms: ['2,1,0', '2,-1,0'] } });
  db['0,0,0'].exits.north = { status: 'open', targetCoordinates: '0,1,0' };
  db['5,5,0'] = { name: 'Boss', bossGate: { targetKey: '1,2,0' } }; db['2,0,0'] = { name: 'Built', visited: true };
  db['0,1,0'] = { name: 'Aimed', exits: { north: { status: 'open', targetCoordinates: '0,2,0' } } };
  const blocked = ['0,0,0', '3,0,0', '2,1,0', '2,-1,0', '1,2,0', '2,0,0', '0,2,0', '5,5,0'];
  for (const runId of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const plan = Topology.plan(db, { runId, routes: [] }, 'c1');
    assert.ok(plan, runId);
    for (const k of [...plan.cells.slice(1), plan.gate?.key].filter(Boolean)) { assert.ok(!blocked.includes(k), `${runId}: ${k}`); assert.ok(!db[k], k); }
  }
  // Reserved footprint: a route cell another build is constructing still gets its exit (that builder is assigned the
  // reverse link), so the route is never broken by timing.
  const reserved = await generated(); LR.turn(reserved, { geoKey: '0,0,0' });
  const fr = reserved.db()['0,0,0'].livingRegion.routes[0];
  build(reserved, fr.cells[0], { protectedKeys: new Set([fr.cells[1]]) });
  assert.equal(reserved.db()[fr.cells[0]].exits[fr.dirs[0]]?.targetCoordinates, fr.cells[1]);
  await quiet(() => LR.turn(reserved, { geoKey: fr.cells[0] })); assert.equal(reserved.db()['0,0,0'].livingRegion.routes.length, 1);
  // A route from an older save (no footprint): a protected cell never receives a route exit; the broken route is re-planned.
  const state = await generated(); state.change(d => { delete d['0,0,0'].livingRegion.routes[0].footprint; }); LR.turn(state, { geoKey: '0,0,0' });
  const route = state.db()['0,0,0'].livingRegion.routes[0];
  build(state, route.cells[0], { protectedKeys: new Set([route.cells[1]]) });
  assert.notEqual(state.db()[route.cells[0]].exits[route.dirs[0]]?.targetCoordinates, route.cells[1]);
  await quiet(() => LR.turn(state, { geoKey: route.cells[0] }));
  const r = state.db()['0,0,0'].livingRegion;
  assert.equal(r.routes[0].status, 'abandoned'); assert.equal(r.routes.length, 2); assert.notEqual(r.routes[1].anchor, route.anchor);
});


// Normal character pipeline harness (same as tests/inhabitant-batches.test.cjs).
const fixtures = require('./fixtures/inhabitants.cjs');
const { toJSON } = require('../retort/structuredSchema');
const { generateInhabitants } = require('../retort/inhabitantGeneration');
function pipeline({ wrongFirst = false } = {}) {
  const requests = [], counters = { levels: 0, equipment: 0 }; let wrong = wrongFirst;
  const agent = { run: async work => { const prompts = [];
    return work({ user: (parts, ...values) => prompts.push(typeof parts === 'string' ? parts : templateContent(parts, ...values)), assistant: { generation: async options => {
      const ids = toJSON(options.parameters).properties.inhabitants.items.properties.slot.enum;
      const guidance = prompts.find(p => p.startsWith('RESERVED REGIONAL RESIDENTS'));
      const fixed = guidance ? JSON.parse(guidance.match(/: (\[.*?\])\. For each/)[1]) : [];
      const shown = prompts.map(p => p.match(/NOT a fixed cast: (\[.*?\])\.\n/)).find(Boolean);
      requests.push({ ids, fixed: fixed.map(f => f.name), shown: shown ? JSON.parse(shown[1]) : [] });
      const rows = fixtures(16).filter(r => ids.includes(r.slot)).map(r => {
        const f = fixed.find(x => x.slot === r.slot);
        return f ? { ...r, name: wrong ? 'Someone Else' : f.name, motivation: f.wants } : r;
      });
      if (fixed.length) wrong = false;
      return { content: JSON.stringify({ inhabitants: rows }) };
    } } }); } };
  const rules = { random: min => min, level: () => { counters.levels++; return 1; }, sex: () => 'Female', xp: () => 0, equipment: async () => { counters.equipment++; return null; }, equipPopulation: async chars => { counters.equipped = chars.map(c => c.Name); return []; } };
  return { requests, counters, run: ctxt => generateInhabitants(agent, ctxt, rules) };
}
// Mirrors generateRoomInhabitantPopulation: encounter policy, generation, binding and goal items; only the room's
// population and objects are saved (the region record itself is not written by that path).
const Policy = require('../retort/encounterPolicy');
async function residentsAt(state, anchor, opts) {
  const rooms = state.db(), p = pipeline(opts), party = [{ Name: 'Hero', Level: 2 }];
  const reservation = Policy.reserve(rooms, anchor, { seed: 'run-a' });
  const roomEncounterPlan = Policy.budget(rooms[anchor], anchor, reservation, { party, indoor: true, roll: .5 });
  const { v: result } = await quiet(() => p.run({ roomName: 'Saltreach Landing', roomDescription: 'A stone landing.', geoKey: anchor, indoor: true, partyNames: ['Hero'], party,
    usedNames: LR.reservedNames(rooms, anchor), rooms, roomEncounterPlan }));
  LR.bindPopulation(rooms, anchor, result);
  state.change(d => { d[anchor].inhabitants = result.population; d[anchor].populationComplete = true; d[anchor].objects = [{ name: 'iron lantern', type: 'other', magic: 0 }]; });
  return { result, p, profile: Policy.profile(rooms[anchor], anchor, { indoor: true }) };
}

test('regional residents are generated by the normal pipeline in reserved slots, with stats and equipment, and nobody is discarded', async () => {
  const { state, route } = await routed(); LR.turn(state, { geoKey: route.anchor });
  assert.equal(state.db()[route.anchor].encounterDanger, 'safe', 'the prepare pass marked the community room safe before population planning');
  const { result, p, profile } = await residentsAt(state, route.anchor, { wrongFirst: true });
  assert.equal(profile, 'safe');
  assert.ok(p.requests.some(r => r.shown.length), 'the slot plan shown to the model was captured');
  assert.deepEqual(p.requests.flatMap(r => r.shown).filter(s => s.peaceful && s.allegiance === 'Hostile'), [], 'a peaceful slot is never suggested as Hostile');
  assert.deepEqual(state.db()[route.anchor].objects.map(o => o.name), ['iron lantern'], 'goal items are never placed in the recipients\' own room');
  const groupOf = n => result.population.groups.find(g => g.members.includes(n));
  assert.notEqual(groupOf('Orsel Vane').id, groupOf('Kettri Moss').id, 'each resident has their own encounter group (one favor per group)');
  assert.deepEqual([groupOf('Orsel Vane').members, groupOf('Kettri Moss').members], [['Orsel Vane'], ['Kettri Moss']]);
  const slots = p.requests.filter((r, i, a) => a.findIndex(x => x.ids[0] === r.ids[0]) === i).flatMap(r => r.ids);
  const names = Object.keys(result.population.actors);
  assert.equal(names.length, slots.length, 'every slot is kept; nothing is replaced or removed');
  assert.ok(names.includes('Orsel Vane') && names.includes('Kettri Moss'));
  assert.ok(p.requests.some(r => r.fixed.length) && p.requests.filter(r => r.fixed.length).length >= 2, 'a wrong reserved name is rejected and retried');
  assert.equal(p.counters.levels, names.length); assert.deepEqual([...p.counters.equipped].sort(), [...names].sort(), 'regional residents get the same stats and equipment pass');
  for (const name of ['Orsel Vane', 'Kettri Moss']) {
    const a = result.population.actors[name];
    assert.equal(a.allegiance, 'Neutral'); assert.match(result.sheets, new RegExp(name)); assert.equal(a.livingRegion.source, LR.SOURCE);
  }
  assert.equal(result.population.actors['Orsel Vane'].livingRegion.goalId, 'lrg:r1');
  assert.ok(state.db()['0,0,0'].livingRegion.residents.every(x => !x.materialized), 'the population path does not write the region');
  LR.turn(state, { geoKey: route.anchor });
  const r = state.db()['0,0,0'].livingRegion;
  assert.ok(r.residents.every(x => x.materialized?.roomKey === route.anchor), 'materialization is derived from the tagged records');
  assert.equal(r.routes.filter(x => x.status === 'abandoned').length, 0, 'a site with its residents is kept');
  assert.deepEqual(LR.reservedNames(state.db(), '9,9,0'), [], 'materialized residents are no longer reserved elsewhere');
  assert.deepEqual(LR.reserveSlots([{ slot: 0, allegiance: 'Neutral' }], state.db(), route.anchor), [], 'no second copy is reserved');
});


// ---------- v4: the playable objective ----------
// A playable world: one database, console, roster and geometry store shared across rooms, like the server state.
// Rooms are entered in order and the inventory carries over.
const xyz = key => { const [x, y, z] = key.split(',').map(Number); return { x, y, z }; };
function world(dbObj) {
  const E = require('../retort/economy'), dungeons = {}, pops = {}, k = c => `${c.x},${c.y},${c.z}`;
  let db = JSON.stringify(dbObj), coords = { x: 0, y: 0, z: 0 }, wire = '[]', text = '', present = [];
  const state = { getDungeonRunId: () => 'run-a', getLastCoords: () => coords, getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getRoomNameDatabase: () => db, setRoomNameDatabase: v => db = v, getCombatCharactersString: () => wire, setCombatCharactersString: v => wire = v,
    getRoomPopulation: key => pops[key] || null, setRoomPopulation: (key, v) => { pops[key] = v; },
    getRoomDungeon: c => dungeons[k(c)] || null, setRoomDungeon: (c, d) => { dungeons[k(c)] = d; }, getRoomDungeonForSimulation: c => dungeons[k(c || coords)] || null,
    getCurrentTasks: () => [], getCurrentTaskIndex: () => 0, getGamePaused: () => false, getCampaignMemory: () => null,
    db: () => JSON.parse(db), change: fn => { const d = JSON.parse(db); fn(d); db = JSON.stringify(d); } };
  const place = at => { wire = JSON.stringify([{ name: 'Benedict', type: 'pc', hp: 12, mazeX: at.x, mazeY: at.y, mazeRoomKey: k(coords) }, { name: 'Ally', type: 'npc', hp: 12, mazeX: 2, mazeY: 2, mazeRoomKey: k(coords) },
    ...present.map((n, i) => ({ name: n, type: 'monster', hp: 12, state: 'Neutral', mazeX: 5 + i, mazeY: 4, mazeRoomKey: k(coords) }))]); };
  const enter = (key, { at = { x: 4, y: 4 }, monsters = [] } = {}) => {
    const carried = text ? [E.field(text, 'Inventory') || 'Empty', E.field(text, 'Inventory Properties') || 'None'] : ['Empty', 'None'];
    coords = xyz(key); present = monsters;
    const name = JSON.parse(db)[key]?.name || 'Room ' + key;
    text = `Room Name: ${name}\nCoordinates: X: ${coords.x}, Y: ${coords.y}, Z: ${coords.z}\nTurns: 3\nSilver Pieces: 0\nCurrent Quest: None\nQuest Progress: None\nInventory: ${carried[0]}\nInventory Properties: ${carried[1]}\nObjects in Room: None\nObjects in Room Properties: None\nPC:\n${row('Benedict', 'pc')}\nNPCs in Party:\n${row('Ally', 'npc')}\nMonsters in Room:${monsters.length ? '\n' + monsters.map(n => row(n).replace('State: Friendly', 'State: Neutral')).join('\n') : ' None'}\nMonsters Equipped Properties: None\nMonsters State: ${monsters.length ? 'Neutral' : 'None'}\nRooms Visited: 4`;
    place(at);
  };
  return { state, enter, place, dungeons, pops, text: () => text };
}
// TEST FIXTURE ONLY: the bonus loot secretRoomLoot asks the model for, for chambers that do not hold a goal item.
const lootAuthor = async ($, o) => Array.from({ length: o.count }, (_, i) => ({ name: `sealed chamber relic ${i + 1}`, type: 'other', magic: 0 }));
// Routed region; the player walks T (too cramped for a hidden chamber) and M (an open room where the engine installs
// its secret doors). Room geometry passes through the real secretRoomLoot.prepare, which runs the sealing hook.
async function expedition() {
  const E = require('../retort/economy'), Loot = require('../retort/secretRoomLoot');
  const { state: base, route } = await routed();
  const [T, M, A] = route.cells, w = world(base.db());
  w.enter(T); E.start(w.state, { Name: 'Benedict' }, [{ Name: 'Ally' }]);
  const t = grid(T, 7); t.start = { x: 3, y: 3 };
  const { v: tText } = await quiet(() => Loot.prepare($, w.state, t, w.text(), { author: lootAuthor }));
  w.state.setUpdatedGameConsole(tText); w.state.setRoomDungeon(xyz(T), t);
  w.enter(M); const m = grid(M, 24);
  const { v: mText } = await quiet(() => Loot.prepare($, w.state, m, w.text(), { author: lootAuthor }));
  w.state.setUpdatedGameConsole(mText); w.state.setRoomDungeon(xyz(M), m);
  return { w, route, T, M, A, m };
}
function chamberView(m, door, names) {
  const dx = door.x - door.entry.x, dy = door.y - door.entry.y;
  return { names, camera: { x: door.entry.x + .5, y: door.entry.y + .5, eyeZ: .65, dirX: dx, dirY: dy, planeScale: .577, verticalScale: 1.73, viewShift: 0, aspect: 1.8 } };
}
let nonce = 0;
const takeAt = (w, key, item, view) => { const E = require('../retort/economy'), { createPopulationService } = require('../retort/roomPopulation');
  return E.action(w.state, createPopulationService(w.state), { runId: 'run-a', geoKey: key, revision: E.project(w.state).revision, nonce: 'lr-take:' + ++nonce, kind: 'take', item, objectView: view }); };

test('the hidden-chamber goal item is sealed in a reachable route room, never in the recipient\'s room; the mechanism goal is not sealed', async () => {
  const { w, T, M, A, m } = await expedition(), db = w.state.db(), region = db['0,0,0'].livingRegion;
  const [orsel, kettri] = region.residents;
  assert.deepEqual(orsel.goal.objective.tried.map(t => [t.key, t.reason]), [[T, 'no hidden chamber in this room']], 'the cramped first room was tried and has no chamber');
  const o = orsel.goal.objective, door = m.secretDoors.doors.find(d => d.id === o.doorId);
  assert.deepEqual([o.status, o.cacheKey, o.cacheName], ['sealed', M, 'Room ' + M]);
  assert.ok(door && !door.open && !door.discovered, 'behind a closed, undiscovered panel');
  const item = db[M].objects.find(i => i.name === orsel.goal.item);
  assert.deepEqual([item.secretDoorId, item.minor_mission_id, item.livingRegionGoal, item.economyItemId], [door.id, orsel.goal.id, orsel.goal.id, 'living-region:' + orsel.goal.id]);
  const scene = m.sceneObjects.find(s => s.name === orsel.goal.item);
  assert.ok(door.chamber.includes(`${scene.x},${scene.y}`) && scene.fixed, 'on a chamber floor cell');
  assert.deepEqual([kettri.goal.objective.status, db[M].objects.some(i => i.name === kettri.goal.item)], ['unplaced', false], 'a mechanism goal is never sealed in a chamber');
  assert.ok(Topology.search(db).has(M), 'reachable from the start through open exits');
  assert.equal(db[A].objects, undefined, 'nothing is placed in the community room');
  assert.match(w.text(), /^Objects in Room: .*brass survey chain/m, 'the room ground list is synced like secret-chamber loot');
  assert.equal(require('../retort/economy').protectedItem(w.state, db, db[M].objects.find(i => i.name === 'brass survey chain')), 'lrg:r1');
  const before = w.state.getRoomNameDatabase(); w.enter(A); LR.sealGoalItems(w.state, grid(A, 24), w.text());
  assert.equal(w.state.getRoomNameDatabase(), before);
});

test('obstacle resolution: the item cannot be taken until the panel is found by a search check and opened; then the real take works', async () => {
  const Secrets = require('../retort/secretDoors'), E = require('../retort/economy');
  const { w, M, m } = await expedition(), o = w.state.db()['0,0,0'].livingRegion.residents[0].goal.objective;
  const door = m.secretDoors.doors.find(d => d.id === o.doorId), view = () => chamberView(m, door, m.sceneObjects.map(s => s.name));
  w.place({ x: door.entry.x, y: door.entry.y });
  assert.match(takeAt(w, M, 'brass survey chain', view()).error, /not currently in view|Move closer/, 'sealed: not takeable');
  const act = (kind, roll) => Secrets.act(w.state, { runId: 'run-a', geoKey: M, kind, nonce: 'lr-secret:' + ++nonce }, { natural: () => roll });
  const miss = act('search', 3);
  assert.deepEqual([miss.rolls[0].natural, miss.rolls[0].success, door.discovered], [3, false, false]); assert.match(miss.content, /reveals no new passage/);
  assert.match(takeAt(w, M, 'brass survey chain', view()).error, /not currently in view|Move closer/, 'a failed search changes nothing');
  const hit = act('search', 17);
  assert.equal(door.discovered, true); assert.match(hit.content, /You discover a secret panel/); assert.equal(Secrets.SEARCH_DC, 5);
  assert.match(takeAt(w, M, 'brass survey chain', view()).error, /not currently in view|Move closer/, 'found but still closed');
  const opened = act('open', 1);
  assert.match(opened.content, /concealed stone panel slides upward/); assert.equal(door.open, true); assert.equal(m.cells[door.key].door.isOpen, true);
  Secrets.persist(w.state, m);
  const took = takeAt(w, M, 'brass survey chain', view());
  assert.equal(took.error, undefined); assert.match(took.content, /You take brass survey chain/);
  assert.match(E.field(w.text(), 'Inventory'), /brass survey chain/);
  assert.equal(w.state.db()[M].objects.some(i => i.name === 'brass survey chain'), false);
});


// The community room with its two residents present, as the milestone harness voices them.
async function settleIn(w, A) {
  w.enter(A, { monsters: ['Orsel Vane', 'Kettri Moss'] });
  w.state.change(d => { d[A].name = 'Saltreach Landing'; });
  await residentsAt(w.state, A);
  const built = grid(A); built.sceneObjects = [{ x: 3, y: 3, name: 'crate' }];
  assert.equal(LR.applyPhysical(built, A, w.state).changed, true); w.state.setRoomDungeon(xyz(A), built);
  const p = w.state.db()[A].inhabitants;
  for (const [i, name] of ['Orsel Vane', 'Kettri Moss'].entries()) Object.assign(p.actors[name], { hp: 12, position: { x: 5 + i, y: 4 }, home: { x: 5 + i, y: 4 }, sheet: row(name), encounteredAt: 1, job: 'keeper' });
  for (const g of p.groups) g.site = { x: 5, y: 4 };
  for (const n of Object.keys(p.actors).filter(n => !p.actors[n].livingRegion)) delete p.actors[n]; // the harness voices only the two residents
  for (const g of p.groups) g.members = (g.members || []).filter(n => p.actors[n]);
  w.state.change(d => { d[A].inhabitants = p; }); w.pops[A] = p;
  return p;
}
// TEST FIXTURE ONLY: an existing physical mechanism in a room north of the start (the engine's own deterministic
// design builder stands in for the room's authored design). Geometry is installed by the real puzzle installer.
function mechanismRoom(w, key = '0,1,0', { build = true } = {}) {
  const Pz = require('../assets/physicalPuzzles'), design = Pz.fallback('run-a:' + key + ':test', 'North Works', {});
  const mechanism = { ...design, state: Pz.initialState(Pz.compile(design)) };
  w.state.change(d => { d['0,0,0'].exits.north = { status: 'open', targetCoordinates: key }; d[key] = { name: 'North Works', visited: true, exits: { south: { status: 'open', targetCoordinates: '0,0,0' } }, puzzleMechanism: mechanism }; });
  return { mechanism, build: () => { const g = grid(key, 24); assert.equal(Pz.install(g, { puzzleMechanism: mechanism }).status, 'built'); w.state.setRoomDungeon(xyz(key), g); return g; } };
}
// Sets every control to its goal the way the puzzle action path commits it: the step, the saved room state, then the
// finalize hook on the next geometry (tryPhysicalPuzzleAction order).
function solve(w, key) {
  const Pz = require('../assets/physicalPuzzles');
  let dungeon = w.state.getRoomDungeon(xyz(key));
  const first = w.state.db()[key].puzzleMechanism;
  for (const move of Pz.findSolution(first, first.state)) {
    const stored = w.state.db()[key].puzzleMechanism;
    const next = Pz.step(stored, stored.state, move.controlId), delta = Pz.applyVisualState(dungeon, next);
    w.state.change(d => { d[key].puzzleMechanism = { ...stored, state: next }; });
    dungeon = { ...dungeon, cells: { ...dungeon.cells, ...delta.cells }, physicalPuzzle: delta.physicalPuzzle };
    LR.applyPhysical(dungeon, key, w.state); w.state.setRoomDungeon(xyz(key), dungeon);
  }
  assert.equal(w.state.db()[key].puzzleMechanism.state.status, 'complete');
  return w.state.getRoomDungeon(xyz(key));
}
// Stands the player beside a scene object, facing it, and takes it through the real economy action.
function takeNear(w, key, name) {
  const d = w.state.getRoomDungeon(xyz(key)), s = d.sceneObjects.find(o => o.name === name);
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => ({ x: s.x + dx, y: s.y + dy }))
    .find(p => d.cells[`${p.x},${p.y}`]?.tile === 'floor' && !d.cells[`${p.x},${p.y}`].puzzleFixture && !d.sceneObjects.some(o => o.x === p.x && o.y === p.y));
  w.place(spot);
  const dx = s.x - spot.x, dy = s.y - spot.y, n = Math.hypot(dx, dy);
  return takeAt(w, key, name, { names: d.sceneObjects.map(o => o.name), camera: { x: spot.x + .5, y: spot.y + .5, eyeZ: .65, dirX: dx / n, dirY: dy / n, planeScale: .577, verticalScale: 1.73, viewShift: 0, aspect: 1.8 } });
}
async function deliverOrsel(w, route, M, m, A) {
  const Secrets = require('../retort/secretDoors'), Give = require('../retort/itemTransfer'), F = require('../retort/residentFavors');
  const service = require('../retort/roomPopulation').createPopulationService(w.state);
  await quiet(() => { assert.match(F.command(w.state, service, 'accept favor from Orsel Vane').content, /accepted/i); });
  const orsel = Object.values(w.state.db()[A].minorMissions).find(x => x.livingRegionGoal?.goalId === 'lrg:r1');
  w.enter(M); const door = m.secretDoors.doors.find(d => d.id === orsel.conditions[0].secretDoorId);
  w.place({ x: door.entry.x, y: door.entry.y });
  Secrets.act(w.state, { runId: 'run-a', geoKey: M, kind: 'search', nonce: 'lr-secret:' + ++nonce }, { natural: () => 12 });
  Secrets.act(w.state, { runId: 'run-a', geoKey: M, kind: 'open', nonce: 'lr-secret:' + ++nonce }); Secrets.persist(w.state, m);
  assert.match(takeAt(w, M, 'brass survey chain', chamberView(m, door, m.sceneObjects.map(s => s.name))).content, /You take brass survey chain/);
  w.enter(A, { monsters: ['Orsel Vane', 'Kettri Moss'] });
  await quiet(() => Give.give(w.state, service, 'give brass survey chain to Orsel Vane'));
  await quiet(() => { assert.match(F.command(w.state, service, 'report to Orsel Vane').content, /completed/i); });
  return orsel;
}

test('milestone: accept the regional request, find and open the panel, take the item, deliver it, and the fixture is rebuilt in the room; survives save/load', async () => {
  const F = require('../retort/residentFavors'), State = require('../sharedState');
  const { w, route, M, A, m } = await expedition();
  const p = await settleIn(w, A);
  // The turn the residents first exist: the sealed item's request is offered with exact directions; the mechanism
  // request waits (no built mechanism yet) and says so once.
  const { v: arrival } = await quiet(() => LR.turn(w.state, { enteringRoom: true, geoKey: A, consoleText: w.text() }));
  const back = Topology.OPP[route.dirs[1]];
  const steps = `Go ${back} to Room ${M}, search its walls for the concealed panel, open it, take brass survey chain from the hidden chamber, and bring it back to Orsel Vane in Saltreach Landing.`;
  assert.ok(arrival.notice.includes(`Orsel Vane has a request: Recover brass survey chain. ${steps}`), arrival.notice);
  assert.doesNotMatch(arrival.notice, /The engine has not placed it yet/);
  const missions = () => Object.values(w.state.db()[A].minorMissions);
  assert.deepEqual(missions().map(x => x.recipient), ['Orsel Vane'], 'no request is advertised before its object is placed');
  const orsel = missions()[0];
  assert.deepEqual([orsel.source, orsel.type, orsel.status, orsel.livingRegionGoal.goalId, orsel.conditions[0].kind, orsel.conditions[0].item, orsel.conditions[0].roomKey, orsel.conditions[0].sourceRoomKey],
    [F.SOURCE, 'resident-favor', 'offered', 'lrg:r1', 'retrieve', 'brass survey chain', A, M]);
  assert.equal(orsel.offer, 'Orsel walled the chain into a cache on the landing road when raiders came. Bring it to me so I can true the fallen stones of the cracked cistern with it.');
  let authored = 0;
  const offers = await quiet(() => F.prepare(w.state, null, 'how can we help you', { audibleNames: ['Orsel Vane'], population: p,
    author: async (b, choices) => { authored++; return { title: 'The lantern', objectiveId: choices.find(c => c.item === 'iron lantern')?.id, offer: 'Bring me the iron lantern.' }; } }));
  assert.equal(authored, 0); assert.deepEqual(offers.v.map(o => o.id), [orsel.id]);
  assert.equal(F.presentation(w.state).find(x => x.id === orsel.id).requestDescription, `Recover brass survey chain: ${steps}\nCompletion: Give brass survey chain to Orsel Vane.`);
  await deliverOrsel(w, route, M, m, A);
  const { v: done } = await quiet(() => LR.turn(w.state, { geoKey: A, consoleText: w.text() }));
  assert.equal(done.consequences.length, 1); assert.deepEqual([done.consequences[0].kind, done.consequences[0].real, done.consequences[0].physical.stored], ['fixture', true, true]);
  assert.match(done.notice, /the cracked cistern in Saltreach Landing has been restored\. The change is permanent\./);
  const live = w.state.db()['0,0,0'].livingRegion;
  assert.deepEqual(live.residents.map(r => [r.goal.id, LR.goalStatus(live, r.goal)]), [['lrg:r1', 'resolved'], ['lrg:r2', 'active']], 'only the delivered goal resolved');
  assert.equal(LR.turn(w.state, { geoKey: A, consoleText: w.text() }).consequences.length, 0, 'applied once');
  const after = w.state.getRoomDungeon(xyz(A)), restored = Fixture.read(after, 'lrfix:c1');
  assert.deepEqual([restored.state, restored.rubble], ['restored', false]);
  assert.deepEqual(after.sceneObjects.map(o => o.name), ['iron lantern'], 'scene objects are only the room\'s own objects (synced by the economy pass); the fixture adds none');
  // Save/load through the real checkpoint export/import.
  await quiet(() => State.importSaveState(checkpoint(State, A, w.state.db(), { roomDungeonDatabase: { [A]: after } }), { graphicsReady: [A] }));
  const saved = JSON.parse(JSON.stringify(State.exportSaveState()));
  await quiet(() => State.importSaveState(checkpoint(State, '0,0,0', { '0,0,0': { name: 'Other game' } }), { graphicsReady: ['0,0,0'] }));
  await quiet(() => State.importSaveState(saved, { graphicsReady: [A] }));
  assert.equal(Fixture.read(State.getRoomDungeon(xyz(A)), 'lrfix:c1').state, 'restored');
  const loaded = JSON.parse(State.getRoomNameDatabase());
  assert.equal(LR.questStatus(loaded, loaded['0,0,0'].livingRegion.quests.find(q => q.goalId === 'lrg:r1')), 'completed');
  assert.equal(Object.values(loaded[A].minorMissions).find(x => x.id === orsel.id).status, 'completed');
});

test('mechanism obstacle: advertised only after the built geometry and the binding exist; solving it releases the object; take, give and report complete the request', async () => {
  const F = require('../retort/residentFavors'), Give = require('../retort/itemTransfer');
  const { w, route, A } = await expedition();
  await settleIn(w, A);
  const room = mechanismRoom(w, '0,1,0');
  // Saved design but no installed geometry: not bound, not advertised.
  await quiet(() => LR.turn(w.state, { enteringRoom: true, geoKey: A, consoleText: w.text() }));
  let kettri = () => w.state.db()['0,0,0'].livingRegion.residents[1];
  assert.equal(kettri().goal.objective.status, 'unplaced');
  assert.ok(kettri().goal.objective.tried.some(t => t.key === '0,1,0' && t.reason === 'the mechanism geometry is not built yet'));
  assert.ok(!Object.values(w.state.db()[A].minorMissions).some(m => m.recipient === 'Kettri Moss'), 'no request before geometry');
  // A room the main quest's task uses is never bound.
  const g = room.build();
  w.state.getCurrentTasks = () => [{ type: 'puzzle', physicalPuzzleRoom: '0,1,0' }];
  await quiet(() => LR.turn(w.state, { geoKey: A, consoleText: w.text() }));
  assert.ok(kettri().goal.objective.tried.some(t => t.key === '0,1,0' && t.reason === 'the main quest uses this room')); assert.equal(kettri().goal.objective.status, 'unplaced');
  w.state.getCurrentTasks = () => [];
  const { v: bound } = await quiet(() => LR.turn(w.state, { geoKey: A, consoleText: w.text() }));
  const o = kettri().goal.objective;
  assert.deepEqual([o.status, o.cacheKey, o.mechanismId], ['bound', '0,1,0', room.mechanism.id]);
  assert.match(bound.notice, /Kettri Moss has a request: Recover lamp oil cask\. Go .* to North Works, work the mechanism there \(read its plaque for the clue, then set its controls\); when it is solved it releases lamp oil cask\. Take lamp oil cask and bring it back to Kettri Moss in Saltreach Landing\./);
  const mission = Object.values(w.state.db()[A].minorMissions).find(m => m.recipient === 'Kettri Moss');
  assert.deepEqual(mission.conditions.map(c => [c.kind, c.roomKey, c.mechanismId || c.item]), [['puzzle', '0,1,0', room.mechanism.id], ['retrieve', A, 'lamp oil cask']]);
  assert.match(mission.requestDescription, /Completion: Solve the existing puzzle in North Works\. Also: Take lamp oil cask from beside the solved mechanism/);
  assert.equal(w.state.db()['0,1,0'].objects, undefined, 'nothing is placed before the mechanism is solved');
  const service = require('../retort/roomPopulation').createPopulationService(w.state);
  await quiet(() => { assert.match(F.command(w.state, service, 'accept favor from Kettri Moss').content, /accepted/i); });
  w.enter('0,1,0');
  const solved = solve(w, '0,1,0');
  const item = w.state.db()['0,1,0'].objects.find(i => i.name === 'lamp oil cask'), scene = solved.sceneObjects.find(s => s.name === 'lamp oil cask');
  assert.deepEqual([item.minor_mission_id, item.economyItemId, scene.fixed], ['lrg:r2', 'living-region:lrg:r2', true]);
  const receiver = g.physicalPuzzle.fixtures.find(f => f.id === 'receiver').key.split(',').map(Number);
  assert.ok(Math.hypot(scene.x - receiver[0], scene.y - receiver[1]) <= 4, 'released beside the receiver');
  assert.equal(kettri().goal.objective.status, 'released');
  const { v: released } = await quiet(() => LR.turn(w.state, { geoKey: '0,1,0', consoleText: w.text() }));
  assert.match(released.notice, /The solved mechanism in North Works releases lamp oil cask/);
  assert.match(w.text(), /^Objects in Room: .*lamp oil cask/m);
  assert.match(takeNear(w, '0,1,0', 'lamp oil cask').content, /You take lamp oil cask/);
  w.enter(A, { monsters: ['Orsel Vane', 'Kettri Moss'] });
  await quiet(() => Give.give(w.state, service, 'give lamp oil cask to Kettri Moss'));
  await quiet(() => { assert.match(F.command(w.state, service, 'report to Kettri Moss').content, /completed/i); });
  const { v: done } = await quiet(() => LR.turn(w.state, { geoKey: A, consoleText: w.text() }));
  assert.deepEqual(done.consequences.map(c => [c.kind, c.real]), [['standing', false]]);
  assert.match(done.notice, /narrative only/);
  assert.equal(LR.goalStatus(w.state.db()['0,0,0'].livingRegion, kettri().goal), 'resolved');
});

test('one authoritative record per task: quest and goal status are derived from the mission record and its consumed receipt, never stored', async () => {
  const { w, A } = await expedition();
  await settleIn(w, A);
  await quiet(() => LR.turn(w.state, { enteringRoom: true, geoKey: A, consoleText: w.text() }));
  const region = () => w.state.db()['0,0,0'].livingRegion, quest = () => region().quests.find(q => q.goalId === 'lrg:r1');
  const q0 = quest();
  assert.ok(!('status' in q0) && !('status' in region().residents[0].goal), 'no stored completion state');
  assert.equal(LR.questStatus(w.state.db(), q0), 'active');
  // Forged stored fields are ignored.
  w.state.change(d => { const q = d['0,0,0'].livingRegion.quests.find(x => x.goalId === 'lrg:r1'); q.status = 'completed'; d['0,0,0'].livingRegion.residents[0].goal.status = 'resolved'; });
  const { v: forged } = await quiet(() => LR.turn(w.state, { geoKey: A, consoleText: w.text() }));
  assert.equal(forged.consequences.length, 0); assert.equal(LR.goalStatus(region(), region().residents[0].goal), 'active');
  // Completed without the engine receipt: verifying, never consumed.
  w.state.change(d => { Object.assign(d[A].minorMissions[q0.missionId], { status: 'completed' }); });
  assert.equal(LR.questStatus(w.state.db(), quest()), 'verifying');
  assert.equal((await quiet(() => LR.turn(w.state, { geoKey: A, consoleText: w.text() }))).v.consequences.length, 0);
  // With the receipt and evidence: consumed once; the receipt is the marker.
  w.state.change(d => { Object.assign(d[A].minorMissions[q0.missionId], { rewardReceiptId: 'receipt-1', completionEvidence: [{ kind: 'retrieve' }] }); });
  assert.equal((await quiet(() => LR.turn(w.state, { geoKey: A, consoleText: w.text() }))).v.consequences.length, 1);
  assert.deepEqual(quest().receipt, { missionId: q0.missionId, rewardReceiptId: 'receipt-1', source: 'engine-resident-favor-v1' });
  assert.equal(LR.questStatus(w.state.db(), quest()), 'completed'); assert.equal(LR.goalStatus(region(), region().residents[0].goal), 'resolved');
  w.state.change(d => { d[A].minorMissions[q0.missionId].status = 'failed'; });
  assert.equal(LR.questStatus(w.state.db(), quest()), 'completed', 'a consumed receipt is final');
  assert.equal((await quiet(() => LR.turn(w.state, { geoKey: A, consoleText: w.text() }))).v.consequences.length, 0);
  // A withdrawn, unconsumed request is unbound and offered again from the same goal.
  const { w: w2, A: A2 } = await expedition(); await settleIn(w2, A2);
  await quiet(() => LR.turn(w2.state, { enteringRoom: true, geoKey: A2, consoleText: w2.text() }));
  const first = w2.state.db()['0,0,0'].livingRegion.quests.find(q => q.goalId === 'lrg:r1');
  w2.state.change(d => { d[A2].minorMissions[first.missionId].status = 'withdrawn'; });
  assert.equal(LR.questStatus(w2.state.db(), first), 'unbound');
  await quiet(() => LR.turn(w2.state, { geoKey: A2, consoleText: w2.text() }));
  const again = w2.state.db()['0,0,0'].livingRegion.quests.filter(q => q.goalId === 'lrg:r1');
  assert.equal(again.length, 1); assert.notEqual(again[0].missionId, first.missionId); assert.equal(LR.questStatus(w2.state.db(), again[0]), 'active');
});

test('successor: a verified completion queues one next request caused by the committed change; the engine fixes its obstacle and consequence; the give receipt verifies it and the real blocked exit opens', async () => {
  const Give = require('../retort/itemTransfer');
  const { w, route, M, m, A } = await expedition();
  assert.ok(route.gate, 'this seed plans a side passage');
  await settleIn(w, A);
  await quiet(() => LR.turn(w.state, { enteringRoom: true, geoKey: A, consoleText: w.text() }));
  const next = requester([SUCCESSOR(), REVIEW()]);
  assert.equal((await LR.ensure($, w.state, { request: next.request })).status, 'present');
  const orselMission = await deliverOrsel(w, route, M, m, A);
  const { v: done } = await quiet(() => LR.turn(w.state, { geoKey: A, consoleText: w.text() }));
  assert.equal(done.consequences[0].kind, 'fixture');
  let region = w.state.db()['0,0,0'].livingRegion, s = region.successors[0];
  const mission = w.state.db()[A].minorMissions[orselMission.id];
  assert.deepEqual([region.successors.length, s.residentId, s.goalId, s.status], [1, 'r1', 'lrg:r1:2', 'running']);
  assert.deepEqual(s.causedBy, { questId: 'lrq:lrg:r1', missionId: orselMission.id, receipt: mission.rewardReceiptId, consequence: 'fixture', real: true, change: 'the cracked cistern in Saltreach Landing was rebuilt' });
  assert.deepEqual(s.input.slot, { obstacle: 'mechanism', effect: 'reopen-passage' }, 'the other obstacle; the real closed exit');
  await LR.jobs.settle();
  assert.deepEqual(next.stages(), ['successor', 'review']);
  assert.match(next.prompts()[0], /COMMITTED FACTS \(engine state, already true\): .*restored/); assert.match(next.prompts()[0], /FIXED NEXT STEP \(engine-owned\): player action = the player travels to a room on the way to the community where a physical mechanism/);
  assert.match(next.prompts()[0], /world consequence = the engine opens the community's closed exit/); assert.match(next.prompts()[0], /PERMITTED EFFECTS/);
  const room = mechanismRoom(w, '0,1,0'); room.build();
  const { v: merged } = await quiet(() => LR.turn(w.state, { geoKey: A, consoleText: w.text() }));
  region = w.state.db()['0,0,0'].livingRegion;
  const orsel = region.residents[0];
  assert.deepEqual([orsel.goal.id, orsel.goal.item, orsel.goal.consequence, orsel.goal.channel, orsel.pastGoals.map(g => [g.id, LR.goalStatus(region, g)])],
    ['lrg:r1:2', 'tide gate key', 'access', 'delivery', [['lrg:r1', 'resolved']]]);
  assert.equal(orsel.goal.causedBy.missionId, orselMission.id);
  assert.equal(w.state.db()[A].inhabitants.actors['Orsel Vane'].livingRegion.goalId, 'lrg:r1:2', 'the generated record follows the current goal');
  assert.match(merged.notice, /because the cracked cistern in Saltreach Landing was rebuilt, Orsel Vane has a new aim: Bring tide gate key to Orsel Vane so they can open the north way to the salt flats\./);
  assert.match(merged.notice, /Orsel Vane has a new request: Bring tide gate key .* work the mechanism there .* Then give tide gate key to Orsel Vane\./);
  assert.equal(orsel.goal.objective.cacheKey, '0,1,0');
  assert.equal(Object.values(w.state.db()[A].minorMissions).filter(x => x.recipient === 'Orsel Vane').length, 1, 'no second favor mission: the completed bargain stays the resident\'s mission');
  w.enter('0,1,0'); solve(w, '0,1,0');
  await quiet(() => LR.turn(w.state, { geoKey: '0,1,0', consoleText: w.text() }));
  assert.match(takeNear(w, '0,1,0', 'tide gate key').content, /You take tide gate key/);
  w.enter(A, { monsters: ['Orsel Vane', 'Kettri Moss'] });
  const service = require('../retort/roomPopulation').createPopulationService(w.state);
  assert.equal(LR.turn(w.state, { geoKey: A, consoleText: w.text() }).consequences.length, 0, 'nothing before the give receipt');
  await quiet(() => Give.give(w.state, service, 'give tide gate key to Orsel Vane'));
  const { v: opened } = await quiet(() => LR.turn(w.state, { geoKey: A, consoleText: w.text() }));
  assert.deepEqual(opened.consequences.map(c => [c.kind, c.real, c.gate]), [['access', true, route.gate.key]]);
  const db = w.state.db();
  assert.equal(db[route.anchor].exits[route.gate.dir].status, 'open');
  const q = db['0,0,0'].livingRegion.quests.find(x => x.goalId === 'lrg:r1:2');
  assert.equal(q.receipt.source, 'engine-give-item-v1'); assert.equal(LR.questStatus(db, q), 'completed');
  assert.equal(db['0,0,0'].livingRegion.successors.length, 1, 'one successor per first request; the chain is bounded');
});

test('relationships and history are authored after the region is playable; one retry, then an explicit retry; a lost job restarts', async () => {
  await fresh();
  const state = makeState(), gen = requester([STAGE1(), STAGE2(), REVIEW(), { nope: 1 }]);
  assert.equal((await quiet(() => LR.ensure($, state, { request: gen.request }))).v.status, 'generated');
  await LR.jobs.settle();
  const planned = LR.turn(state, { geoKey: '0,0,0' });
  assert.equal(planned.notice, '');
  const region = () => state.db()['0,0,0'].livingRegion;
  assert.equal(region().routes.length, 1, 'the region is playable without the social detail');
  assert.deepEqual([region().social.status, region().social.tries], ['running', 1], 'the one retry starts at once in the background');
  await LR.jobs.settle();
  const failed = LR.turn(state, {});
  assert.doesNotMatch(failed.notice, /Living region/);
  assert.equal(region().social.status, 'failed'); assert.equal(LR.turn(state, {}).notice, '', 'shown once');
  const quietRun = requester([STAGE3()]);
  await quiet(() => LR.ensure($, state, { request: quietRun.request, userInput: 'look around' })); await LR.jobs.settle();
  assert.equal(quietRun.calls.length, 0, 'no silent auto-retry');
  const good = requester([STAGE3()]);
  await quiet(() => LR.ensure($, state, { request: good.request, userInput: 'retry living region' })); await LR.jobs.settle();
  LR.turn(state, {});
  assert.deepEqual([good.stages(), region().social.status], [['relations'], 'authored']);
  // A job lost with the process (a restart while it was running) is started again on the next turn.
  await fresh();
  state.change(d => { d['0,0,0'].livingRegion.social = { status: 'running', tries: 0 }; });
  const again = requester([STAGE3()]);
  await quiet(() => LR.ensure($, state, { request: again.request })); await LR.jobs.settle();
  assert.deepEqual(again.stages(), ['relations']);
});

test('the access consequence opens the real blocked exit in both directions; with no passage it is labelled narrative only', async () => {
  const { state, route } = await routed();
  assert.ok(route.gate, 'this seed plans a side passage');
  build(state, route.gate.key);
  const before = state.db();
  assert.equal(before[route.anchor].exits[route.gate.dir].status, 'blocked'); assert.equal(before[route.gate.key].exits[Topology.OPP[route.gate.dir]].status, 'blocked', 'reverse link inherits blocked');
  assert.ok(!Topology.search(before).has(route.gate.key) || Object.values(before[route.gate.key].exits).some(e => e.status === 'open'), 'only reachable by other open exits, never through the gate');
  const db = state.db(), region = db['0,0,0'].livingRegion, notices = [];
  region.routes[0].status = 'traversable';
  const kettri = region.residents[1]; kettri.goal.consequence = 'access'; // engine path kept; not offered to authoring in v4
  const c = LR.complete(db, region, { quest: { id: 'q', goalId: kettri.goal.id }, mission: { id: 'm', source: 'engine-resident-favor-v1', roomKey: route.anchor, rewardReceiptId: 'r' }, resident: kettri }, { turn: 3, notices, state });
  assert.deepEqual([c.kind, c.real, c.gate], ['access', true, route.gate.key]);
  assert.equal(db[route.anchor].exits[route.gate.dir].status, 'open'); assert.equal(db[route.gate.key].exits[Topology.OPP[route.gate.dir]].status, 'open');
  assert.ok(Topology.search(db).has(route.gate.key), 'travel permission changed: the cell beyond is now reachable');
  assert.match(notices.at(-1), /can now be traversed/);
  const bare = state.db(), r2 = bare['0,0,0'].livingRegion, n2 = []; r2.routes = [];
  const c2 = LR.complete(bare, r2, { quest: { id: 'q2', goalId: 'lrg:r2' }, mission: { id: 'm2', source: 'engine-resident-favor-v1', roomKey: route.anchor, rewardReceiptId: 'r' }, resident: r2.residents[1] }, { turn: 3, notices: n2, state });
  assert.equal(c2.real, false); assert.match(n2.at(-1), /narrative only/);
  const r3 = state.db()['0,0,0'].livingRegion, n3 = [], db3 = state.db();
  r3.residents[1].goal.consequence = 'standing';
  const c3 = LR.complete(db3, r3, { quest: { id: 'q3', goalId: 'lrg:r2' }, mission: { id: 'm3', source: 'engine-resident-favor-v1', roomKey: route.anchor, rewardReceiptId: 'r' }, resident: r3.residents[1] }, { turn: 3, notices: n3, state });
  assert.equal(c3.real, false); assert.match(n3.at(-1), /narrative only/);
});


test('rest advances the region only from a committed lodging receipt; typing about rest does nothing', async () => {
  const { state, route } = await routed(); LR.turn(state, { enteringRoom: true, geoKey: route.anchor });
  await residentsAt(state, route.anchor); LR.turn(state, { geoKey: route.anchor }); // the residents' requests are offered on their first turn
  const facts = () => state.db()['0,0,0'].livingRegion.ledger.facts.length, n0 = facts();
  for (const input of ['we rest here', 'I sleep by the fire', 'take a long rest']) {
    const out = LR.turn(state, { geoKey: route.anchor, userInput: input, consoleText: consoleFor(route.anchor, 4) });
    assert.equal(out.moments.length, 0, input);
  }
  assert.equal(facts(), n0, 'no rest moment without a receipt');
  state.change(d => { d[route.anchor].venueDesk = { stays: [{ nonce: 'n1', at: Date.now(), members: ['Hero'], paid: 5 }] }; });
  const rest = LR.turn(state, { geoKey: route.anchor });
  assert.deepEqual(rest.moments.map(m => m.kind), ['rest']); assert.equal(rest.developments.length, 1);
  assert.equal(LR.turn(state, { geoKey: route.anchor }).moments.length, 0, 'one moment per receipt');
  state.change(d => { d[route.anchor].venueDesk.stays.push({ nonce: 'n2', at: Date.now(), members: [], paid: 0 }); });
  assert.equal(LR.turn(state, { geoKey: route.anchor }).moments.length, 0, 'a stay with no members is not a receipt');
});


test('traveler movement changes only where an unmaterialized resident will appear; encountered residents never move', () => {
  const two = { communities: [{ id: 'c1', name: 'One', need: 'n', fixtureName: 'f', fixtureForm: 'pillar', setting: 'indoor', disagreementWith: 'c2', disagreement: 'd' },
    { id: 'c2', name: 'Two', need: 'n', fixtureName: 'g', fixtureForm: 'marker', setting: 'outdoor', disagreementWith: 'c1', disagreement: 'd' }],
    residents: [{ id: 'r1', name: 'Met Person', community: 'c1', history: 'h', goalItem: 'item one', obstacle: 'hidden-chamber', whyHidden: 'w', effect: 'earn-trust', itemUse: 'u', willingTraveler: true },
      { id: 'r2', name: 'Unmet Person', community: 'c1', history: 'h', goalItem: 'item two', obstacle: 'hidden-chamber', whyHidden: 'w', effect: 'restore-fixture', itemUse: 'u', willingTraveler: true },
      { id: 'r3', name: 'Far Person', community: 'c2', history: 'h', goalItem: 'item three', obstacle: 'hidden-chamber', whyHidden: 'w', effect: 'earn-trust', itemUse: 'u', willingTraveler: false }],
    relationships: [], facts: [], companionHooks: [] };
  const region = LR.compile(two, ctx());
  region.communities.forEach((c, i) => c.anchor = { key: `${4 + i * 4},0,0`, status: 'reachable' });
  region.residents[0].materialized = { roomKey: '4,0,0', at: 1 };
  for (let i = 0; i < 6; i++) LR.develop({}, region, { kind: 'travel', communityId: 'c1' }, { turn: i, notices: [] });
  assert.equal(region.residents[0].communityId, 'c1', 'an encountered resident is never relocated');
  assert.ok(region.residents.filter(r => r.travels.length).every(r => !r.materialized));
  const docs = fs.readFileSync(path.join(__dirname, '../docs/living-region.md'), 'utf8');
  assert.match(docs, /only changes where an unmaterialized resident will appear/); assert.match(docs, /never relocates/);
});


test('a resident who falls in combat is recorded from engine state, never silently', async () => {
  const { state, route } = await routed(); LR.turn(state, { geoKey: route.anchor });
  await residentsAt(state, route.anchor);
  assert.equal(LR.turn(state, { geoKey: route.anchor }).notice.includes('fallen'), false);
  state.change(d => d[route.anchor].inhabitants.actors['Kettri Moss'].status = 'dead');
  assert.match(LR.turn(state, { geoKey: route.anchor }).notice, /Kettri Moss has fallen/);
  assert.equal(state.db()['0,0,0'].livingRegion.ledger.facts.at(-1).writer, 'combat-outcome');
});


const favor = (id, recipient, roomKey, item, extra = {}) => ({ id, source: 'engine-resident-favor-v1', type: 'resident-favor', runId: 'run-a', status: 'offered', recipient, roomKey,
  title: 't', conditions: [{ id: 'retrieve:' + id, kind: 'retrieve', item, roomKey }], ...extra });
test('exact binding: unrelated or forged favors for the same resident never resolve a goal; only the seeded request\'s own receipt does', async () => {
  const { w, A } = await expedition(); await settleIn(w, A);
  const state = w.state, done = { status: 'completed', rewardReceiptId: 'receipt', completionEvidence: [{ kind: 'retrieve' }] };
  await quiet(() => LR.turn(state, { enteringRoom: true, geoKey: A, consoleText: w.text() }));
  const r = () => state.db()['0,0,0'].livingRegion, seeded = r().quests.find(q => q.goalId === 'lrg:r1');
  assert.ok(seeded?.seeded, 'the request exists from the turn its item is placed and the resident exists');
  state.change(d => { Object.assign(d[A].minorMissions, { u1: favor('u1', 'Orsel Vane', A, 'iron lantern', done),
    u2: { ...structuredClone(d[A].minorMissions[seeded.missionId]), id: 'u2', ...done } }); });
  const { v: out } = await quiet(() => LR.turn(state, { geoKey: A, consoleText: w.text() }));
  assert.equal(out.consequences.length, 0); assert.deepEqual(r().residents.map(x => LR.goalStatus(r(), x.goal)), ['active', 'active']);
  assert.ok(!r().quests.some(q => ['u1', 'u2'].includes(q.missionId)), 'no forged or unrelated mission becomes a quest');
  const orsel = r().residents[0];
  assert.equal(LR.meets({ kind: 'retrieve', item: 'iron lantern', roomKey: A }, orsel), false);
  assert.equal(LR.meets({ kind: 'retrieve', item: 'brass survey chain', roomKey: '9,9,0' }, orsel), false, 'the right item in another room does not bind');
  assert.equal(LR.meets({ kind: 'read', item: 'brass survey chain', roomKey: A }, orsel), false);
  assert.equal(LR.meets({ kind: 'retrieve', item: 'Brass Survey Chain', roomKey: A }, orsel), true);
  state.change(d => Object.assign(d[A].minorMissions[seeded.missionId], done));
  const { v: resolved } = await quiet(() => LR.turn(state, { geoKey: A, consoleText: w.text() }));
  assert.equal(resolved.consequences.length, 1); assert.deepEqual(r().residents.map(x => LR.goalStatus(r(), x.goal)), ['resolved', 'active']);
});

test('stranded-goal guard: an older unaccepted offer is superseded; one in progress defers the request; a completed one is recorded as stranded', async () => {
  const F = require('../retort/residentFavors');
  const { w, A } = await expedition(); await settleIn(w, A); mechanismRoom(w).build();
  const state = w.state, groups = state.db()[A].inhabitants.groups, groupOf = n => groups.find(g => g.members.includes(n)).id;
  const floor = require('../retort/hostLocalFloors').identity(undefined);
  state.change(d => { d[A].minorMissions = { old: favor('old', 'Orsel Vane', A, 'iron lantern', { groupId: groupOf('Orsel Vane'), floor }),
    busy: favor('busy', 'Kettri Moss', A, 'iron lantern', { status: 'accepted', title: 'The lantern', groupId: groupOf('Kettri Moss'), floor }) }; });
  const { v: out } = await quiet(() => LR.turn(state, { geoKey: A, consoleText: w.text() }));
  const db = state.db(), keys = Object.keys(db[A].minorMissions), mine = db[A].minorMissions[keys[0]];
  assert.deepEqual([mine.recipient, mine.livingRegionGoal.goalId], ['Orsel Vane', 'lrg:r1'], 'the regional request is first in the room, ahead of the older offer');
  F.refresh(state, db);
  assert.equal(db[A].minorMissions.old.status, 'withdrawn', 'the favor system\'s own duplicate rule withdraws the older offer');
  assert.doesNotMatch(out.notice, /Kettri Moss already has a different request/);
  assert.ok(state.db()['0,0,0'].livingRegion.state.told.some(id => id.startsWith('stranded:lrg:r2:busy:accepted')));
  assert.equal(Object.values(db[A].minorMissions).some(m => m.livingRegionGoal?.goalId === 'lrg:r2'), false, 'never two requests in progress for one resident');
  state.change(d => { d[A].minorMissions.busy.status = 'completed'; });
  const { v: later } = await quiet(() => LR.turn(state, { geoKey: A, consoleText: w.text() }));
  assert.doesNotMatch(later.notice, /Kettri Moss completed a different request/);
  assert.equal(state.db()['0,0,0'].livingRegion.state.stranded['lrg:r2'].missionId, 'busy');
  assert.doesNotMatch(LR.turn(state, { geoKey: A, consoleText: w.text() }).notice, /stranded/, 'reported once');
  state.change(d => { d[A].minorMissions.busy.status = 'withdrawn'; });
  LR.turn(state, { geoKey: A, consoleText: w.text() });
  assert.ok(Object.values(state.db()[A].minorMissions).some(m => m.livingRegionGoal?.goalId === 'lrg:r2' && m.status === 'offered'));
  assert.equal(state.db()['0,0,0'].livingRegion.state.stranded['lrg:r2'], undefined);
});

test('no chamber on the route: no request is advertised and the wait is told once; the next reachable room with a chamber gets the item and the request is offered with exact directions', async () => {
  const Loot = require('../retort/secretRoomLoot');
  const { state: base, route } = await routed();
  base.change(d => { d['0,0,0'].exits.north = { status: 'open', targetCoordinates: '0,1,0' }; d['0,1,0'] = { name: 'North Hall', visited: true, exits: { south: { status: 'open', targetCoordinates: '0,0,0' } } }; });
  const [T, M, A] = route.cells, w = world(base.db());
  for (const key of [T, M]) { w.enter(key); const small = grid(key, 7); small.start = { x: 3, y: 3 }; const { v } = await quiet(() => Loot.prepare($, w.state, small, w.text(), { author: lootAuthor })); w.state.setUpdatedGameConsole(v); }
  assert.deepEqual(w.state.db()['0,0,0'].livingRegion.residents[0].goal.objective.tried.map(t => t.key), [T, M]);
  await settleIn(w, A);
  const { v: waiting } = await quiet(() => LR.turn(w.state, { enteringRoom: true, geoKey: A, consoleText: w.text() }));
  assert.doesNotMatch(waiting.notice, /The engine has not placed it yet/);
  assert.equal(Object.values(w.state.db()[A].minorMissions || {}).length, 0, 'nothing advertised before placement');
  assert.doesNotMatch(LR.turn(w.state, { geoKey: A, consoleText: w.text() }).notice, /wants brass survey chain/, 'told once');
  w.enter('0,1,0'); const hall = grid('0,1,0', 24);
  const { v: text } = await quiet(() => Loot.prepare($, w.state, hall, w.text(), { author: lootAuthor })); w.state.setUpdatedGameConsole(text);
  const o = w.state.db()['0,0,0'].livingRegion.residents[0].goal.objective;
  assert.deepEqual([o.status, o.cacheKey], ['sealed', '0,1,0']);
  const { v: offered } = await quiet(() => LR.turn(w.state, { geoKey: '0,1,0', consoleText: w.text() }));
  const mission = Object.values(w.state.db()[A].minorMissions).find(m => m.livingRegionGoal?.goalId === 'lrg:r1');
  assert.equal(mission.conditions[0].sourceRoomKey, '0,1,0');
  assert.match(mission.requestDescription, new RegExp(`^Recover brass survey chain: Go ${Topology.OPP[route.dirs[1]]}, then ${Topology.OPP[route.dirs[0]]}, then west, then north to North Hall, search its walls`));
  assert.match(offered.notice, /Orsel Vane has a request: Recover brass survey chain\./);
});


// Fixture placement protections.
function room({ corridor = false } = {}) {
  const d = grid('5,5,0');
  if (corridor) for (const [k, c] of Object.entries(d.cells)) { const [x, y] = k.split(',').map(Number); if (y !== 4 && !(x === 4 && y === 4)) c.tile = 'wall'; }
  return d;
}
test('fixture placement avoids hazards, navigation reservations, exits, secret chambers, puzzle alcoves, structure footprints and objects, and keeps routes', () => {
  const d = room();
  d.cells['14,7'].exit = 'east'; d.cells['8,8'].navigationReserved = true; d.cells['9,2'].puzzleFixture = 'p1';
  d.roomHazards = { hazards: [{ id: 'h1', state: 'armed', keys: ['10,10'], gap: [], zone: ['10,10', '11,10', '10,11', '11,11'] }] };
  d.secretDoors = { doors: [{ id: 's1', key: '2,12', entry: { x: 3, y: 12 }, chamber: ['1,12', '1,13', '2,13'] }] };
  d.puzzleAlcove = { x: 11, y: 2, width: 3, height: 3 };
  d.sceneStructures = [{ id: 'well', position: { x: 5.5, y: 9.5, z: 0 }, size: { x: 3, y: 2, z: 1 } }];
  d.sceneObjects = [{ x: 7, y: 12, name: 'crate' }]; d.questWritings = [{ key: '12,12' }];
  const blocked = Fixture.protectedCells(d, 'probe');
  for (const k of ['14,7', '13,7', '8,8', '9,2', '10,10', '9,9', '12,12', '2,12', '1,13', '3,12', '4,13', '11,2', '10,1', '5,9', '8,10', '7,12', '4,4']) assert.ok(blocked.has(k), k);
  const I = require('../assets/dungeonInhabitants'), reach = new Set(I.reachable(d).map(p => `${p.x},${p.y}`));
  for (let i = 0; i < 40; i++) {
    const copy = structuredClone(d), out = Fixture.apply(copy, { id: 'fx' + i, name: 'f', form: 'pillar', state: 'damaged' });
    assert.equal(out.placed, true, 'an open room has a site');
    const used = Object.entries(copy.cells).filter(([, c]) => c.livingFixture).map(([k]) => k);
    assert.equal(used.length, 2);
    for (const k of used) assert.ok(!blocked.has(k), `fx${i} used protected ${k}`);
    const after = new Set(I.reachable({ ...copy, cells: Object.fromEntries(Object.entries(copy.cells).map(([k, c]) => [k, c.livingFixture ? { ...c, tile: 'wall' } : c])) }).map(p => `${p.x},${p.y}`));
    for (const k of reach) if (!used.includes(k)) assert.ok(after.has(k), `fx${i} cut the route at ${k}`);
  }
  const narrow = room({ corridor: true }), none = Fixture.apply(narrow, { id: 'fx', name: 'f', form: 'pillar', state: 'damaged' });
  assert.deepEqual([none.placed, none.changed], [false, false]); assert.match(none.reason, /no open, unprotected floor area/);
  assert.equal(Fixture.read(narrow, 'fx'), null);
});


function store(initial = {}) {
  const m = structuredClone(initial), k = c => `${c.x},${c.y},${c.z}`;
  return { m, getRoomDungeon: c => m[k(c)] ? structuredClone(m[k(c)]) : null, setRoomDungeon: (c, d) => { m[k(c)] = structuredClone(d); } };
}
test('a failed fixture placement is never claimed as permanent; it stays pending and is placed and announced once a safe site exists', async () => {
  const { state: base, route } = await routed(); const A = route.anchor, [x, y, z] = A.split(',').map(Number);
  const dungeons = store({ [A]: room({ corridor: true }) }), state = makeState({ db: base.db(), key: A, dungeons });
  assert.equal(LR.applyPhysical(dungeons.getRoomDungeon({ x, y, z }), A, state).placed, false, 'finalize hook: no site');
  const db = state.db(), region = db['0,0,0'].livingRegion, notices = [], orsel = region.residents[0];
  assert.deepEqual(Fixture.commit(state, A, { ...region.communities[0].fixture, state: 'restored' }), { stored: false, placed: false, reason: 'no open, unprotected floor area large enough for the fixture' });
  const c = LR.complete(db, region, { quest: { id: 'q', goalId: orsel.goal.id }, mission: { id: 'm', source: 'engine-resident-favor-v1', roomKey: A, rewardReceiptId: 'r' }, resident: orsel }, { turn: 3, notices, state });
  assert.deepEqual([c.kind, c.real, c.physical.stored], ['fixture', false, false]);
  assert.doesNotMatch(notices.join('\n'), /permanent|has been restored\. The change/); assert.match(notices.at(-1), /recorded, not yet visible/);
  assert.equal(region.communities[0].fixture.physical.status, 'pending');
  state.change(d => { d['0,0,0'].livingRegion = region; });
  assert.doesNotMatch(LR.turn(state, { geoKey: A }).notice, /now restored/, 'still pending while there is no site');
  dungeons.setRoomDungeon({ x, y, z }, room()); // the room geometry is rebuilt with open floor
  const recovered = LR.turn(state, { geoKey: A });
  assert.match(recovered.notice, /the cracked cistern in Saltreach Landing is now restored in the room/);
  assert.equal(Fixture.read(dungeons.getRoomDungeon({ x, y, z }), 'lrfix:c1').state, 'restored');
  assert.equal(state.db()['0,0,0'].livingRegion.communities[0].fixture.physical.status, 'placed');
  assert.doesNotMatch(LR.turn(state, { geoKey: A }).notice, /now restored/, 'announced once');
});


test('community rooms are marked safe before population planning; a site without room for its residents reserves nobody and is rejected and re-planned', async () => {
  const { state, route } = await routed(), A = route.anchor;
  assert.equal(state.db()[A].encounterDanger, 'safe'); assert.equal(Policy.profile(state.db()[A], A, { indoor: true }), 'safe');
  assert.equal(state.db()[route.cells[1]].encounterDanger, undefined, 'only the community room');
  // All or nothing: one peaceful slot for two residents reserves nobody.
  const slots = [{ slot: 0, allegiance: 'Hostile' }, { slot: 1, allegiance: 'Neutral' }, { slot: 2, allegiance: 'Neutral', serviceRole: 'keeper' }];
  const { v: short, logs } = await quiet(() => LR.reserveSlots(slots, state.db(), A));
  assert.deepEqual([...short], []); assert.equal(short.incompatible, true); assert.ok(slots.every(s => !s.regionalIdentity));
  assert.ok(logs.some(l => /site-incompatible/.test(l)));
  // Enough peaceful slots: identities are reserved; the serialized slot list (part of the population prompt) carries only
  // the identity, and the guidance gives history and goal once, as excerpts, so the work order fits a 4k local context.
  const roomy = [{ slot: 0, allegiance: 'Neutral' }, { slot: 1, allegiance: 'Neutral' }, { slot: 2, allegiance: 'Neutral' }];
  await quiet(() => LR.reserveSlots(roomy, state.db(), A));
  const id = roomy.find(s => s.regionalIdentity?.name === 'Orsel Vane').regionalIdentity;
  assert.deepEqual(JSON.parse(JSON.stringify(id)), { name: 'Orsel Vane' }); assert.deepEqual([id.residentId, id.community], ['r1', 'Saltreach Landing']);
  assert.match(id.history, /surveyed the landing/); assert.match(LR.slotGuidance(roomy), /"name":"Orsel Vane","wants":"Bring brass survey chain/);
  assert.doesNotMatch(LR.slotGuidance(roomy), /surveyed the landing/); assert.ok(LR.slotGuidance(roomy).length < 520, 'compact guidance');
  // The room is then populated without the residents: the site is rejected, its fixture removed, and a new site planned.
  const [x, y, z] = A.split(',').map(Number), dungeons = store();
  const built = room(); Fixture.apply(built, state.db()['0,0,0'].livingRegion.communities[0].fixture); dungeons.setRoomDungeon({ x, y, z }, built);
  const live = makeState({ db: state.db(), key: A, dungeons });
  live.change(d => { d[A].inhabitants = I.createPopulation(A, [{ name: 'Someone Else', allegiance: 'Neutral' }]); d[A].populationComplete = true; });
  const { v: out } = await quiet(() => LR.turn(live, { geoKey: A }));
  assert.doesNotMatch(out.notice, /Saltreach Landing could not settle/, 'replanning remains an engine detail');
  const r = live.db()['0,0,0'].livingRegion;
  assert.equal(r.routes[0].status, 'abandoned'); assert.match(r.routes[0].reason, /site rejected/);
  assert.equal(r.routes.length, 2); assert.notEqual(r.routes[1].anchor, A); assert.equal(r.communities[0].anchor.key, r.routes[1].anchor);
  assert.deepEqual(r.communities[0].rejectedSites, [A]); assert.equal(Fixture.read(dungeons.getRoomDungeon({ x, y, z }), 'lrfix:c1'), null, 'fixture removed from the rejected room');
  assert.ok(r.residents.every(x => !x.materialized), 'nobody was lost; they are due at the new site');
  assert.deepEqual(Object.keys(live.db()[A].inhabitants.actors), ['Someone Else'], 'the existing population is untouched');
});

