'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Q = require('../retort/questProgress'), P = require('../assets/physicalPuzzles');
const sheet = (name, state = 'Neutral') => `${name}\nFemale\nHuman\nArchivist\nLevel: 2\nAC: 10\nXP: 0\nHP: 20\nMaxHP: 20\nEquipped: None\nAttack: 0\nDamage: 0\nArmor: 0\nMagic: 0\nState: ${state}`;
function fixture() {
  const puzzle = P.fallback('quest-compiler', 'Hall of Records'); puzzle.state = P.initialState(puzzle);
  return { '0,0,0': { name: 'Ruined Temple Entrance', objects: [{ name: 'chronicle of ancient vows', type: 'book' }], exits: {} },
    '0,1,0': { name: 'Hall of Records', objects: [{ name: 'iron sigil', type: 'key', unlocks: { coordinates: '0,1,0', direction: 'east' } }],
      exits: { east: { status: 'locked', key: 'iron sigil', targetCoordinates: '1,1,0' } }, puzzleMechanism: puzzle,
      monsters: { inRoom: sheet('Edrin Farrows') + '\n' + sheet('Stone Sentinel', 'Hostile'), state: 'Mixed' } } };
}
const item = { type: 'object', name: 'chronicle of ancient vows', placement: '0,0,0' };
const recipient = { type: 'monster', name: 'Edrin Farrows', placement: '0,1,0' };
const hostile = { type: 'monster', name: 'Stone Sentinel', placement: '0,1,0' };

test('generated retrievals pull full names and source rooms from real object metadata, replacing vague prose and invented gates', () => {
  const database = fixture(), proposal = { type: 'Fetch', actionKind: 'other', desc: 'Find the book in the northern hall.',
    metrics: 'The storyteller says so.', requiredElements: [{ ...item, name: item.name.toUpperCase() }],
    actionRequirements: [{ check: 'invented_action' }] }, before = JSON.stringify({ database, proposal });
  const task = Q.compileGeneratedTask(proposal, database, '0,0,0');
  assert.ok(task.id); assert.equal(task.requiredElements[0].name, item.name);
  assert.match(task.desc, /chronicle of ancient vows from Ruined Temple Entrance \(0,0,0\)/);
  assert.doesNotMatch(task.metrics + task.desc, /northern hall|storyteller|invented_action/);
  assert.deepEqual(task.actionRequirements, []);
  const assessment = Q.evaluateTaskRequirements(task, { roomKey: '0,0,0', consoleText: `Inventory: ${item.name}`, database });
  assert.equal(Q.verifiedTaskCompletion(task, assessment), true);
  assert.equal(JSON.stringify({ database, proposal }), before);
});

test('every advertised generated type has a concrete compiler and unsupported objectives are never advertised or published', () => {
  const db = fixture();
  assert.deepEqual(Q.generatedTaskTypes([item], db, '0,1,0'), ['fetch']);
  assert.deepEqual(Q.generatedTaskTypes([item, recipient], db, '0,1,0'), ['deliver']);
  assert.deepEqual(Q.generatedTaskTypes([hostile], db, '0,1,0'), ['defeat']);
  assert.deepEqual(Q.generatedTaskTypes([recipient], db, '0,1,0'), []);
  assert.deepEqual(Q.generatedTaskTypes([], db, '0,1,0'), ['puzzle']);
  assert.deepEqual(Q.generatedTaskTypes([], db, '0,0,0'), []);
  for (const type of ['Investigate', 'Negotiate', 'Protect', 'Hybrid']) assert.equal(Q.compileGeneratedTask({ type, actionKind: type.toLowerCase(), requiredElements: [item] }, db, '0,1,0'), null);
});

test('defeat objectives bind each living hostile by room and never select neutral, friendly, dead or recruited targets', () => {
  for (const state of ['Neutral', 'Friendly', 'Dead', 'recruited']) {
    const db = fixture(); db['0,1,0'].inhabitants = { actors: { 'Stone Sentinel': { name: 'Stone Sentinel', hp: state === 'Dead' ? 0 : 20,
      status: state === 'recruited' ? 'recruited' : 'present', allegiance: state } } };
    assert.equal(Q.compileGeneratedTask({ type: 'Defeat', actionKind: 'defeat_monster', requiredElements: [hostile] }, db, '0,1,0'), null);
  }
  const db = fixture(), task = Q.compileGeneratedTask({ type: 'Defeat', actionKind: 'defeat_monster', requiredElements: [hostile] }, db, '0,1,0');
  assert.deepEqual(task.hardRequirements, [{ check: 'monster_hp_zero', value: hostile.name }]);
  assert.match(task.desc, /Stone Sentinel in Hall of Records/);
});

test('missing, ambiguous, malformed or invented item and room bindings cannot publish a quest', () => {
  for (const scenario of ['missing-room', 'missing-item', 'duplicate-item', 'nameless-room', 'unsupported-action']) {
    const db = fixture(), task = { type: 'Fetch', actionKind: 'take_item', requiredElements: [item] };
    if (scenario === 'missing-room') delete db['0,0,0'];
    if (scenario === 'missing-item') db['0,0,0'].objects = [];
    if (scenario === 'duplicate-item') db['0,0,0'].objects.push({ name: item.name });
    if (scenario === 'nameless-room') delete db['0,0,0'].name;
    if (scenario === 'unsupported-action') task.actionKind = 'negotiate';
    assert.equal(Q.compileGeneratedTask(task, db, '0,1,0'), null, scenario);
  }
});

test('unlock tasks use real key metadata and keyed exits, not a fabricated direction or premature possession check', () => {
  const db = fixture(), key = { type: 'key', name: 'iron sigil', placement: '0,1,0' },
    proposal = { type: 'Fetch', actionKind: 'unlock_exit', requiredElements: [key] }, task = Q.compileGeneratedTask(proposal, db, '0,0,0');
  assert.deepEqual(task.hardRequirements, [{ check: 'inventory_contains', value: 'iron sigil' }]);
  assert.deepEqual(task.actionRequirements, [{ check: 'exit_open', coords: '0,1,0', direction: 'east' }]);
  assert.match(task.desc, /open the east exit in Hall of Records/);
  let assessment = Q.evaluateTaskRequirements(task, { roomKey: '0,0,0', consoleText: 'Inventory: iron sigil', database: db });
  assert.equal(Q.verifiedTaskCompletion(task, assessment), false);
  db['0,1,0'].exits.east.status = 'open';
  assessment = Q.evaluateTaskRequirements(task, { roomKey: '0,0,0', consoleText: 'Inventory: iron sigil', database: db });
  assert.equal(Q.verifiedTaskCompletion(task, assessment), true);
  delete db['0,1,0'].exits.east; assert.equal(Q.compileGeneratedTask(proposal, db, '0,0,0'), null);
});

test('puzzle objectives require an existing valid unsolved mechanism and never introduce unrelated pickup requirements', () => {
  const db = fixture(), proposal = { type: 'Puzzle', actionKind: 'solve_puzzle', requiredElements: [] },
    task = Q.compileGeneratedTask(proposal, db, '0,1,0');
  assert.equal(task.actionRequirements[0].mechanismId, db['0,1,0'].puzzleMechanism.id);
  assert.match(task.desc, /Hall of Records/);
  assert.equal(Q.compileGeneratedTask(proposal, db, '0,0,0'), null);
  assert.equal(Q.compileGeneratedTask({ ...proposal, requiredElements: [item] }, db, '0,1,0'), null);
  const mechanism = db['0,1,0'].puzzleMechanism;
  for (const move of P.findSolution(mechanism)) mechanism.state = P.step(mechanism, mechanism.state, move.controlId, move.value);
  assert.equal(Q.compileGeneratedTask(proposal, db, '0,1,0'), null);
});

test('ordinary objective compilation never claims or manufactures the boss seal reserved for the pre-boss quest loop', () => {
  const db = fixture(), name = 'boss sanctuary seal key abcdef123456';
  db['0,0,0'].objects.push({ name, type: 'key', questGateId: 'boss-gate:existing' });
  const before = JSON.stringify(db), elements = [{ type: 'key', name, placement: '0,0,0' }];
  assert.deepEqual(Q.generatedTaskTypes(elements, db, '0,1,0'), []);
  assert.equal(Q.compileGeneratedTask({ type: 'Fetch', actionKind: 'take_item', requiredElements: elements }, db, '0,1,0'), null);
  assert.equal(JSON.stringify(db), before);
});

test('unsupported mixed selections fall back to real supported elements without creating loot or moving a target', () => {
  const db = fixture(), before = JSON.stringify(db);
  assert.deepEqual(Q.selectGeneratedElements([item, hostile], db, '0,1,0'), [item]);
  const rows = Q.selectGeneratedElements([recipient], db, '0,1,0');
  assert.equal(rows[1], recipient); assert.equal(rows[0].name, item.name); assert.deepEqual(Q.generatedTaskTypes(rows, db, '0,1,0'), ['deliver']);
  const fallback = Q.selectGeneratedElements([], db, '0,0,0'); assert.deepEqual(fallback, [item]);
  assert.equal(JSON.stringify(db), before);
});

test('fallbacks exclude the boss room and seal namespace and wait when no bound objective is possible', () => {
  const db = fixture(); delete db['0,1,0'].puzzleMechanism;
  db['0,0,0'].objects = []; db['0,1,0'].objects = [{ name: 'boss room seal key abcdef123456', type: 'key' }];
  const before = JSON.stringify(db), rows = Q.selectGeneratedElements([], db, '0,0,0', ['0,1,0']);
  assert.deepEqual(rows, []); assert.deepEqual(Q.generatedTaskTypes(rows, db, '0,0,0'), []); assert.equal(JSON.stringify(db), before);
});
