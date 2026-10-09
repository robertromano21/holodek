'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateTaskRequirements, mergeTaskProgress, taskBinding } = require('../retort/questProgress');

const sheet = (name, hp = 5) => `${name}\nFemale\nWraith\nMage\nLevel: 2\nAC: 12\nXP: 0\nHP: ${hp}\nMaxHP: 30\nEquipped: None\nAttack: 1\nDamage: 2\nArmor: 0\nMagic: 3`;
const consoleFor = ({ inventory = 'None', monsters = 'None', npcs = 'None', pc = sheet('Hero'), prose = '' } = {}) =>
  `Room Description: ${prose}\nCoordinates: X: 0, Y: 0, Z: 0\nInventory: ${inventory}\nInventory Properties: None\nPC:\n${pc}\nNPCs in Party:\n${npcs}\nMonsters in Room:\n${monsters}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nObjects in Room: None\nRooms Visited: 1`;
const context = (values = {}) => ({ roomKey: '0,0,0', consoleText: consoleFor(), database: {}, ...values });
const fetchTask = () => ({ type: 'Fetch', actionKind: 'fetch_object', status: 'Pending',
  requiredElements: [{ type: 'object', name: 'Iron Sigil', placement: '1,0,0', targetID: 'sigil-1' }],
  hardRequirements: [{ check: 'at_coords', value: '1,0,0' }, { check: 'inventory_contains', value: 'Iron Sigil' }],
  actionRequirements: [] });
const bossTask = (placement = '0,0,0', name = 'The Ash Regent') => ({ type: 'Defeat', actionKind: 'defeat_monster',
  desc: `Defeat ${name} and claim Sepulchra.`, metrics: 'Boss HP=0 and Sepulchra in Inventory', status: 'Pending',
  requiredElements: [{ type: 'monster', name, placement, targetID: 'bound-boss' }],
  hardRequirements: [{ check: 'at_coords', value: placement }, { check: 'monster_hp_zero', value: name }],
  actionRequirements: [{ check: 'monster_hp_zero', value: name }] });
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const evaluate = (task, values) => evaluateTaskRequirements(task, context(values));

test('partial fetch reports individual gates with stable IDs and detached requirements', () => {
  const task = freeze(fetchTask());
  const result = evaluate(task, { roomKey: '1,0,0' });
  assert.deepEqual(Object.keys(result), ['hardFails', 'actionFails', 'checks', 'progress']);
  assert.deepEqual(result.progress, { satisfied: 1, total: 2, unknown: 0, eligible: false });
  assert.deepEqual(result.checks.map(c => [c.id, c.phase, c.index, c.passed]), [
    ['hard:0', 'hard', 0, true], ['hard:1', 'hard', 1, false]
  ]);
  assert.deepEqual(result.hardFails, ['Have "Iron Sigil" in Inventory']);
  assert.deepEqual(result.actionFails, []);
  assert.deepEqual(result.checks[0].requirement, task.hardRequirements[0]);
  assert.notEqual(result.checks[0].requirement, task.hardRequirements[0]);
  assert.deepEqual(evaluate(task, { roomKey: '1,0,0' }), result);
});

test('an item in inventory at the wrong location is only partial progress; remote DB items are not inventory', () => {
  const task = fetchTask();
  const wrongRoom = evaluate(task, { consoleText: consoleFor({ inventory: 'Iron Sigil' }) });
  assert.deepEqual(wrongRoom.progress, { satisfied: 1, total: 2, unknown: 0, eligible: false });
  assert.deepEqual(wrongRoom.hardFails, ['Be at 1,0,0']);
  const remote = evaluate(task, { roomKey: '1,0,0', database: {
    '1,0,0': { objects: [{ name: 'Iron Sigil' }], inventory: ['Iron Sigil'] }
  } });
  assert.equal(remote.checks[1].passed, false);
  assert.equal(remote.progress.eligible, false);
});

test('inventory matching is case-insensitive and exact, with None, Empty and blank as empty', () => {
  const task = { hardRequirements: [{ check: 'inventory_contains', value: '  Iron Sigil  ' }] };
  for (const inventory of ['None', 'nOnE', 'Empty', 'EMPTY', '', 'Iron Sigil Fragment', 'Greater Iron Sigil']) {
    assert.equal(evaluate(task, { consoleText: consoleFor({ inventory }) }).checks[0].passed, false, inventory);
  }
  assert.equal(evaluate(task, { consoleText: consoleFor({ inventory: 'Rope, iRoN SiGiL, Sword' }) }).checks[0].passed, true);
  const noInventory = evaluate(task, { consoleText: 'Objects in Room: Iron Sigil' });
  assert.equal(noInventory.checks[0].passed, null);
  assert.equal(noInventory.progress.unknown, 1);
  assert.equal(noInventory.hardFails.length, 1);
  const blank = evaluate(task, { consoleText: 'Inventory:\nIron Sigil\nHP: 0' });
  assert.equal(blank.checks[0].passed, false);
});

test('earned item checkpoints survive loss, but current eligibility does not', () => {
  const task = fetchTask();
  const gained = evaluate(task, { roomKey: '1,0,0', consoleText: consoleFor({ inventory: 'Iron Sigil' }) });
  const first = freeze(mergeTaskProgress(null, gained));
  assert.deepEqual(first.earnedCheckpointIds, ['hard:0', 'hard:1']);
  assert.equal(first.eligible, true);
  const lost = evaluate(task, { roomKey: '1,0,0' });
  const after = mergeTaskProgress(first, lost);
  assert.deepEqual(after.earnedCheckpointIds, first.earnedCheckpointIds);
  assert.deepEqual([after.satisfied, after.total, after.unknown, after.eligible], [1, 2, 0, false]);
  assert.equal(after.checks[1].passed, false);
  assert.equal(after.revision, first.revision + 1);
  assert.deepEqual(mergeTaskProgress(after, lost), after);
});

test('coordinates canonicalize raw, formatted and object values, including DB keys', () => {
  const forms = ['-2,3,0', ' -02, 003, -0 ', 'X: -2, Y: 3, Z: 0', 'Coordinates: X: -2, Y: 3, Z: 0',
    { x: -2, y: 3, z: 0 }, { x: '-2', y: '3', z: '0' }];
  for (const roomKey of forms) for (const value of forms) {
    assert.equal(evaluate({ hardRequirements: [{ check: 'at_coords', value }] }, { roomKey }).checks[0].passed, true);
  }
  const result = evaluate({ actionRequirements: [{ check: 'exit_open', coords: { x: -2, y: 3, z: 0 }, direction: 'north' }] }, {
    database: { 'Coordinates: X: -02, Y: 3, Z: -0': { exits: { north: { status: 'open' } } } }
  });
  assert.equal(result.progress.eligible, true);
});

test('locked exit transitions to open with exact status, direction and lock flags', () => {
  const task = { actionRequirements: [{ check: 'exit_open', coords: '0,0,0', direction: 'north' }] };
  const checkExit = exit => evaluate(task, { database: { '0,0,0': { exits: { north: exit } } } });
  const locked = checkExit({ status: 'locked' });
  assert.deepEqual(locked.progress, { satisfied: 0, total: 1, unknown: 0, eligible: false });
  assert.deepEqual(locked.actionFails, ['Open the north exit at 0,0,0']);
  const prior = mergeTaskProgress(null, locked);
  const open = checkExit({ status: 'open', locked: false, isLocked: false, key: 'Iron Key' });
  assert.deepEqual(open.actionFails, []);
  assert.equal(open.progress.eligible, true);
  const progress = mergeTaskProgress(prior, open);
  assert.deepEqual(progress.earnedCheckpointIds, ['action:0']);
  assert.equal(progress.revision, prior.revision + 1);
  for (const exit of [null, {}, { status: 'OPEN' }, { status: 'Open' }, { status: 'open ' }, { status: 'opened' },
    { status: 'open', locked: true }, { status: 'open', isLocked: true }, { status: 'open', locked: 'true' },
    { status: 'open', door: { locked: true } }, { status: 'open', door: { isLocked: true } }]) {
    assert.equal(checkExit(exit).checks[0].passed, false, JSON.stringify(exit));
  }
  assert.equal(evaluate(task, { database: { '0,0,0': { exits: { North: { status: 'open' } } } } }).progress.eligible, false);
  assert.equal(evaluate(task, { consoleText: 'Exits: north (open)' }).progress.eligible, false);
});

test('live bound boss HP overrides a stale DB snapshot and preserves hard/action duplicates', () => {
  const task = bossTask();
  const database = freeze({ '0,0,0': { monsters: { consoleBlock: `Monsters in Room:\n${sheet('The Ash Regent', 20)}` } } });
  const result = evaluate(task, { consoleText: consoleFor({ monsters: sheet('The Ash Regent', 0) }), database });
  assert.deepEqual(result.progress, { satisfied: 3, total: 3, unknown: 0, eligible: true });
  assert.deepEqual(result.checks.map(c => c.id), ['hard:0', 'hard:1', 'action:0']);
  assert.equal(result.checks[1].evidence.source, 'console.Monsters in Room');
  assert.equal(result.checks[1].evidence.hp, 0);
  assert.deepEqual(result.checks[1].evidence, result.checks[2].evidence);
  const alive = evaluate(task, { consoleText: consoleFor({ monsters: sheet('The Ash Regent', 7) }), database: {
    '0,0,0': { monsters: { consoleBlock: sheet('The Ash Regent', 0) } }
  } });
  assert.deepEqual(alive.progress, { satisfied: 1, total: 3, unknown: 0, eligible: false });
  assert.equal(alive.hardFails.length, 1);
  assert.equal(alive.actionFails.length, 1);
  assert.equal(alive.checks[1].evidence.hp, 7);
  assert.equal(evaluate(task, { consoleText: consoleFor({ monsters: sheet('The Ash Regent', -2) }) }).progress.eligible, true);
});

test('other-room same-name monster HP cannot satisfy the bound kill', () => {
  const task = bossTask('9,9,2');
  const liveDeadDuplicate = consoleFor({ monsters: sheet('The Ash Regent', 0) });
  const result = evaluate(task, { consoleText: liveDeadDuplicate, database: {
    '9,9,2': { monsters: { consoleBlock: sheet('The Ash Regent', 12) } },
    '0,0,0': { monsters: { consoleBlock: sheet('The Ash Regent', 0) } }
  } });
  assert.deepEqual(result.progress, { satisfied: 0, total: 3, unknown: 0, eligible: false });
  assert.equal(result.checks[1].evidence.source, 'database.monsters.consoleBlock');
  assert.equal(result.checks[1].evidence.roomKey, '9,9,2');
  assert.equal(result.checks[1].evidence.hp, 12);
  const absentDb = evaluate(task, { consoleText: liveDeadDuplicate });
  assert.equal(absentDb.checks[1].passed, null);
  assert.equal(absentDb.checks[2].passed, null);
  assert.equal(absentDb.progress.eligible, false);
});

test('cross-room DB fallback reads only the bound target, allowing partial kill progress remotely', () => {
  const task = bossTask({ x: 9, y: 9, z: 2 });
  const database = { 'X: 9, Y: 9, Z: 2': { monsters: { consoleBlock: `Monsters in Room:\n${sheet('Decoy', 50)}\n${sheet('The Ash Regent', 0)}` } } };
  const result = evaluate(task, { consoleText: consoleFor({ monsters: sheet('The Ash Regent', 20) }), database });
  assert.deepEqual(result.progress, { satisfied: 2, total: 3, unknown: 0, eligible: false });
  assert.deepEqual(result.hardFails, ['Be at 9,9,2']);
  assert.deepEqual(result.actionFails, []);
  assert.equal(result.checks[1].evidence.hp, 0);
  assert.equal(evaluate(task, { roomKey: 'Coordinates: X: 9, Y: 9, Z: 2', database }).progress.eligible, true);
});

test('legacy task.elements binds monsters without changing task or target IDs', () => {
  const task = bossTask('X: 2, Y: -1, Z: 0');
  task.elements = task.requiredElements;
  delete task.requiredElements;
  const before = JSON.stringify(task);
  freeze(task);
  const result = evaluate(task, { roomKey: { x: 2, y: -1, z: 0 }, consoleText: consoleFor({ monsters: sheet('The Ash Regent', 0) }) });
  assert.equal(result.progress.eligible, true);
  assert.equal(JSON.stringify(task), before);
  assert.equal(task.elements[0].targetID, 'bound-boss');
  const nullable = { ...task, requiredElements: null };
  assert.equal(evaluate(nullable, { roomKey: '2,-1,0', consoleText: consoleFor({ monsters: sheet('The Ash Regent', 0) }) }).progress.eligible, true);
});

test('unbound, invalid and conflicting placements fail instead of rebinding to the current room', () => {
  for (const requiredElements of [undefined, [], null, [{ type: 'monster', name: 'The Ash Regent' }],
    [{ type: 'npc', name: 'The Ash Regent', placement: '0,0,0' }],
    [{ type: 'monster', name: 'The Ash Regent', placement: 'bad' }],
    [{ type: 'monster', name: 'The Ash Regent', placement: '0,0,0' }, { type: 'monster', name: 'The Ash Regent', placement: '1,0,0' }]]) {
    const task = { requiredElements, hardRequirements: [{ check: 'monster_hp_zero', value: 'The Ash Regent' }] };
    const result = evaluate(task, { consoleText: consoleFor({ monsters: sheet('The Ash Regent', 0) }) });
    assert.equal(result.checks[0].passed, false);
    assert.equal(result.hardFails.length, 1);
    assert.equal(result.checks[0].evidence.reason, 'missing_or_invalid_monster_binding');
  }
});

test('NPCs, PCs, prose and similarly named monsters cannot supply boss HP', () => {
  const task = bossTask();
  const text = consoleFor({ npcs: sheet('The Ash Regent', 0), pc: sheet('The Ash Regent', 0),
    prose: 'The Ash Regent HP: 0', monsters: `${sheet('The Ash Regent the Lesser', 0)}\n${sheet('Other Monster', 0)}` });
  const missing = evaluate(task, { consoleText: text });
  assert.equal(missing.checks[1].passed, null);
  assert.equal(missing.checks[2].passed, null);
  const living = evaluate(task, { consoleText: text.replace('Monsters Equipped Properties:', `${sheet('The Ash Regent', 9)}\nMonsters Equipped Properties:`) });
  assert.equal(living.checks[1].passed, false);
  assert.equal(living.checks[1].evidence.hp, 9);
  assert.equal(evaluate(task, { consoleText: sheet('The Ash Regent', 0) }).checks[1].passed, null);
  assert.equal(evaluate(task, { consoleText: consoleFor({ monsters: sheet('the ash regent', 0) }) }).checks[1].passed, null);
});

test('regex metacharacters, Name labels and latest monster section use exact actor identity', () => {
  const task = bossTask('0,0,0', 'Regent (A)+[B].*');
  const labelled = sheet('Name: Regent (A)+[B].*', 0).replace('Female', 'Sex: Female').replace('Wraith', 'Race: Wraith').replace('Mage', 'Class: Mage');
  assert.equal(evaluate(task, { consoleText: consoleFor({ monsters: labelled }) }).progress.eligible, true);
  const oldText = consoleFor({ monsters: sheet('Regent (A)+[B].*', 12) });
  const latest = `${oldText}\n${consoleFor({ monsters: labelled })}`;
  assert.equal(evaluate(task, { consoleText: latest }).checks[1].evidence.hp, 0);
  assert.equal(evaluate(task, { consoleText: consoleFor({ monsters: sheet('Regent ABBBxxx', 0) }) }).checks[1].passed, null);
});

test('missing or malformed HP never bleeds from another sheet or MaxHP, even with stale DB HP=0', () => {
  const task = bossTask();
  const deadDb = { '0,0,0': { monsters: { consoleBlock: sheet('The Ash Regent', 0) } } };
  const malformed = [sheet('The Ash Regent', 5).replace('HP: 5\n', ''),
    sheet('The Ash Regent', 5).replace('Magic: 3', ''), sheet('The Ash Regent', '0.5'),
    sheet('The Ash Regent', '0/30'), sheet('The Ash Regent', '0oops'), sheet('The Ash Regent', '9007199254740992'),
    sheet('The Ash Regent', 0).replace('MaxHP:', 'HP: 4\nMaxHP:')];
  for (const bad of malformed) {
    const result = evaluate(task, { consoleText: consoleFor({ monsters: `${bad}\n${sheet('Other Monster', 0)}` }), database: deadDb });
    assert.equal(result.checks[1].passed, null, bad);
    assert.equal(result.progress.eligible, false);
    assert.equal(result.checks[1].evidence.reason, 'invalid_monster_sheet');
  }
});

test('truncated identities and incomplete neighboring actors cannot lend HP across Magic boundaries', () => {
  const task = bossTask();
  const database = { '0,0,0': { monsters: { consoleBlock: sheet('The Ash Regent', 0) } } };
  const noHp = sheet('The Ash Regent', 8).replace('HP: 8\n', '');
  const incompleteNeighbor = sheet('Other Monster', 0).replace('Level: 2\n', '').replace('Magic: 3', '');
  for (const monsters of [sheet('The Ash Regent', 0).replace('Level: 2\n', ''),
    `${noHp}\n${incompleteNeighbor}`,
    `${noHp.replace('Magic: 3', '')}\n${sheet('Other Monster', 0).replace('Level: 2\n', '')}`]) {
    const result = evaluate(task, { consoleText: consoleFor({ monsters }), database });
    assert.equal(result.checks[1].passed, null);
    assert.equal(result.checks[1].evidence.reason, 'invalid_monster_sheet');
    assert.equal(result.progress.eligible, false);
  }
});

test('duplicate exact monster sheets are unverified, not arbitrarily picked or overridden by DB', () => {
  const task = bossTask();
  const result = evaluate(task, { consoleText: consoleFor({ monsters: `${sheet('The Ash Regent', 0)}\n${sheet('The Ash Regent', 15)}` }),
    database: { '0,0,0': { monsters: { consoleBlock: sheet('The Ash Regent', 0) } } } });
  assert.deepEqual(result.progress, { satisfied: 1, total: 3, unknown: 2, eligible: false });
  assert.equal(result.checks[1].evidence.reason, 'ambiguous_monster');
  const remote = evaluate(bossTask('1,0,0'), { database: {
    '1,0,0': { monsters: { consoleBlock: `Monsters in Room: None\nNPCs in Party:\n${sheet('The Ash Regent', 0)}` } }
  } });
  assert.equal(remote.checks[1].passed, null);
});

test('unknown checks and known checks in the wrong phase block eligibility with phase-specific diagnostics', () => {
  const task = { hardRequirements: [{ check: 'novel_condition', value: 'done' }, { check: 'exit_open', coords: '0,0,0', direction: 'north' }],
    actionRequirements: [{ check: 'inventory_contains', value: 'Iron Sigil' }, { check: 'solve_puzzle' }] };
  const result = evaluate(task, { consoleText: consoleFor({ inventory: 'Iron Sigil' }), database: { '0,0,0': { exits: { north: { status: 'open' } } } } });
  assert.deepEqual(result.progress, { satisfied: 0, total: 4, unknown: 4, eligible: false });
  assert.equal(result.hardFails.length, 2);
  assert.equal(result.actionFails.length, 2);
  assert.match(result.hardFails[0], /Unknown hard requirement.*novel_condition/);
  assert.match(result.actionFails[0], /Unknown action requirement.*inventory_contains/);
  assert.ok(result.checks.every(c => c.passed === null));
  assert.deepEqual(mergeTaskProgress(null, result).earnedCheckpointIds, []);
});

test('missing and invalid checks fail explicitly, including sparse arrays and malformed lists', () => {
  const bad = [null, undefined, {}, '', 12, [], { check: 42 }, { check: '' },
    { check: 'at_coords' }, { check: 'at_coords', value: { x: 0, y: 0 } },
    { check: 'at_coords', value: '0,0,0 junk' }, { check: 'at_coords', value: { x: null, y: 0, z: 0 } },
    { check: 'inventory_contains' }, { check: 'inventory_contains', value: 'None' },
    { check: 'inventory_contains', value: 42 }, { check: 'monster_hp_zero', value: '' }];
  for (const requirement of bad) {
    const result = evaluate({ hardRequirements: [requirement] });
    assert.equal(result.checks[0].passed, false, JSON.stringify(requirement));
    assert.equal(result.progress.eligible, false);
    assert.equal(result.hardFails.length, 1);
  }
  for (const requirement of [{ check: 'exit_open' }, { check: 'exit_open', coords: 'bad', direction: 'north' },
    { check: 'exit_open', coords: '0,0,0', direction: '' }, { check: 'exit_open', coords: '0,0,0', direction: 1 }]) {
    assert.equal(evaluate({ actionRequirements: [requirement] }).checks[0].passed, false);
  }
  for (const task of [null, undefined, [], 'not a task', { hardRequirements: null }, { actionRequirements: {} }]) {
    const result = evaluate(task);
    assert.equal(result.progress.eligible, false);
    assert.equal(result.hardFails.length + result.actionFails.length, 1);
  }
  assert.equal(evaluate({ hardRequirements: Array(1) }).checks[0].passed, false);
  const cyclic = { check: 'at_coords', value: '0,0,0' };
  cyclic.self = cyclic;
  const result = evaluate({ hardRequirements: [cyclic] });
  assert.equal(result.checks[0].passed, false);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('missing room evidence is unknown and conflicting DB aliases cannot open exits', () => {
  const task = { hardRequirements: [{ check: 'at_coords', value: '0,0,0' }] };
  const missing = evaluateTaskRequirements(task);
  assert.equal(missing.checks[0].passed, null);
  assert.equal(missing.hardFails.length, 1);
  const database = { '0,0,0': { exits: { north: { status: 'open' } } },
    'X: 0, Y: 0, Z: 0': { exits: { north: { status: 'locked' } } } };
  const result = evaluate({ actionRequirements: [{ check: 'exit_open', coords: '0,0,0', direction: 'north' }] }, { database });
  assert.equal(result.progress.eligible, false);
});

test('zero-check narrative tasks are eligible, but never completed or awarded anything', () => {
  const task = freeze({ type: 'Talk', actionKind: 'talk_to_npc', metrics: 'Gain the oath', status: 'Pending', rewards: { xp: 500 },
    targetID: 'speaker-1', requiredElements: [{ type: 'npc', name: 'Oracle', placement: '0,0,0' }] });
  const before = JSON.stringify(task);
  const result = evaluate(task);
  assert.deepEqual(result.progress, { satisfied: 0, total: 0, unknown: 0, eligible: true });
  assert.deepEqual(result.checks, []);
  assert.equal(JSON.stringify(task), before);
  const state = mergeTaskProgress(null, result);
  assert.deepEqual(state, { revision: 1, satisfied: 0, total: 0, unknown: 0, eligible: true, checks: [], earnedCheckpointIds: [] });
  assert.equal(task.status, 'Pending');
});

test('same repeated assessments and JSON persistence are idempotent without revision drift', () => {
  const task = fetchTask();
  const assessment = freeze(evaluate(task, { roomKey: '1,0,0' }));
  const first = freeze(mergeTaskProgress(undefined, assessment));
  const before = JSON.stringify(first);
  let state = first;
  for (let i = 0; i < 10; i++) {
    state = mergeTaskProgress(JSON.parse(JSON.stringify(state)), JSON.parse(JSON.stringify(assessment)));
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual(state, first);
  }
  assert.equal(JSON.stringify(first), before);
  assert.notEqual(state.checks, assessment.checks);
  const reordered = JSON.parse(JSON.stringify(assessment));
  reordered.checks[0].requirement = { value: '1,0,0', check: 'at_coords' };
  reordered.checks[0].evidence = { targetRoomKey: '1,0,0', roomKey: '1,0,0' };
  assert.deepEqual(mergeTaskProgress(first, reordered), first);
  state.checks[0].evidence.roomKey = 'mutation';
  assert.equal(first.checks[0].evidence.roomKey, '1,0,0');
});

test('revision changes for verified evidence, not irrelevant narrative, XP, time or metadata', () => {
  const task = bossTask();
  const alive = evaluate(task, { consoleText: consoleFor({ monsters: sheet('The Ash Regent', 20) }) });
  const first = mergeTaskProgress(null, alive);
  const injured = evaluate(task, { consoleText: consoleFor({ monsters: sheet('The Ash Regent', 10) }) });
  const second = mergeTaskProgress(first, injured);
  assert.equal(second.revision, first.revision + 1);
  assert.equal(second.satisfied, first.satisfied);
  const irrelevant = evaluate(task, { consoleText: consoleFor({ monsters: sheet('The Ash Regent', 10), prose: 'A new story' })
    .replace('XP: 0', 'XP: 500') + '\nTurns: 100' });
  assert.deepEqual(mergeTaskProgress(second, irrelevant), second);
  const polluted = { ...second, status: 'Complete', xp: 500, currentTaskIndex: 2, timestamp: 123 };
  assert.deepEqual(mergeTaskProgress(polluted, irrelevant), second);
});

test('all verified checks leave full task/quest context, actors, rewards and quest index untouched', () => {
  const tasks = [fetchTask(), { type: 'Unlock', actionKind: 'unlock_exit', status: 'Pending',
    requiredElements: [{ type: 'key', name: 'Iron Key', placement: '2,0,0', unlocks: { coordinates: '2,0,0', direction: 'north' } }],
    hardRequirements: [{ check: 'at_coords', value: '2,0,0' }, { check: 'inventory_contains', value: 'Iron Key' }],
    actionRequirements: [{ check: 'exit_open', coords: '2,0,0', direction: 'north' }] }, bossTask('9,9,2')];
  const quest = freeze({ tasks, currentTaskIndex: 0, status: 'Pending', xp: 200, score: 0,
    actors: [{ id: 'bound-boss', name: 'The Ash Regent', hp: 0 }, { id: 'pc', hp: 15, xp: 200 }],
    targetIDs: ['sigil-1', 'bound-boss'], rewards: { xp: 500, item: 'Sepulchra' } });
  const database = freeze({ '2,0,0': { exits: { north: { status: 'open' } } },
    '9,9,2': { monsters: { consoleBlock: sheet('The Ash Regent', 0) } } });
  const before = JSON.stringify({ quest, database });
  const states = [context({ roomKey: '1,0,0', consoleText: consoleFor({ inventory: 'Iron Sigil' }), database }),
    context({ roomKey: '2,0,0', consoleText: consoleFor({ inventory: 'Iron Key' }), database }),
    context({ roomKey: '9,9,2', database })];
  for (let i = 0; i < 3; i++) {
    const assessment = evaluateTaskRequirements(quest.tasks[i], freeze(states[i]));
    assert.equal(assessment.progress.eligible, true);
    assert.equal(assessment.progress.total, i === 0 ? 2 : 3);
    const merged = mergeTaskProgress(null, assessment);
    assert.equal(merged.satisfied, merged.total);
    assert.ok(!Object.hasOwn(merged, 'status'));
    assert.ok(!Object.hasOwn(merged, 'xp'));
    assert.ok(!Object.hasOwn(merged, 'currentTaskIndex'));
    assert.equal(quest.tasks[i].status, 'Pending');
  }
  assert.equal(JSON.stringify({ quest, database }), before);
  assert.equal(quest.currentTaskIndex, 0);
  assert.equal(quest.xp, 200);
  assert.equal(quest.tasks[2].hardRequirements.length, 2);
  assert.equal(quest.tasks[2].actionRequirements.length, 1);
  assert.equal(quest.tasks[2].requiredElements[0].targetID, 'bound-boss');
  // Sepulchra is a narrative metric, not an invented inventory gate.
  assert.equal(quest.tasks[2].metrics, 'Boss HP=0 and Sepulchra in Inventory');
});

test('checks and history are bounded at 64 with explicit over-limit rejection, never silent truncation', () => {
  const requirement = { check: 'at_coords', value: '0,0,0' };
  const maxTask = { hardRequirements: Array(32).fill(requirement), actionRequirements: Array(32).fill({ check: 'novel' }) };
  const max = evaluate(maxTask);
  assert.equal(max.checks.length, 64);
  assert.equal(mergeTaskProgress(null, max).checks.length, 64);
  assert.throws(() => evaluate({ hardRequirements: Array(65).fill(requirement) }), /64/);
  assert.throws(() => evaluate({ hardRequirements: Array(64).fill(requirement), actionRequirements: [requirement] }), /64/);
  assert.throws(() => mergeTaskProgress(null, { checks: Array(65).fill(max.checks[0]) }), /64/);
  assert.throws(() => evaluate({ hardRequirements: [{ check: 'inventory_contains', value: 'A'.repeat(20000) }] }), /limit/);
  const allHard = evaluate({ hardRequirements: Array(64).fill(requirement) });
  const prior = mergeTaskProgress(null, allHard);
  const next = evaluate({ actionRequirements: [{ check: 'exit_open', coords: '0,0,0', direction: 'north' }] }, {
    database: { '0,0,0': { exits: { north: { status: 'open' } } } }
  });
  assert.throws(() => mergeTaskProgress(prior, next), /64/);
  const tooMuchHistory = { ...prior, earnedCheckpointIds: [...prior.earnedCheckpointIds, 'action:0'] };
  assert.throws(() => mergeTaskProgress(tooMuchHistory, next), /64/);
  assert.doesNotThrow(() => JSON.stringify(prior));
});

test('merger validates persisted checks and derives current counters instead of trusting eligibility', () => {
  const assessment = evaluate(fetchTask());
  const forged = { ...assessment, progress: { satisfied: 99, total: 0, unknown: 0, eligible: true } };
  const result = mergeTaskProgress(null, forged);
  assert.equal(result.eligible, false);
  assert.equal(result.satisfied, 0);
  assert.equal(result.total, 2);
  assert.throws(() => mergeTaskProgress(null, {}), /checks/);
  assert.throws(() => mergeTaskProgress(null, { checks: [assessment.checks[0], assessment.checks[0]] }), /Invalid/);
  assert.throws(() => mergeTaskProgress(null, { checks: [{ ...assessment.checks[0], passed: 'true' }] }), /Invalid/);
  assert.throws(() => mergeTaskProgress(null, { checks: [{ ...assessment.checks[0], id: 'hard:64', index: 64 }] }), /Invalid/);
  assert.throws(() => mergeTaskProgress({ ...result, revision: -1 }, assessment), /Invalid/);
  assert.throws(() => mergeTaskProgress({ ...result, earnedCheckpointIds: ['status:0'] }, assessment), /Invalid/);
  assert.throws(() => mergeTaskProgress({ ...result, revision: Number.MAX_SAFE_INTEGER }, evaluate(fetchTask(), { roomKey: '1,0,0' })), /revision/);
  const unchangedAtLimit = { ...result, revision: Number.MAX_SAFE_INTEGER };
  assert.deepEqual(mergeTaskProgress(unchangedAtLimit, assessment), unchangedAtLimit);
});

test('task binding includes immutable full identity but is stable across status/progress and JSON persistence', () => {
  const task = fetchTask();
  task.id = 'task-one';
  task.questId = 'quest-one';
  task.targetID = 'target-one';
  task.metrics = 'Retrieve the original sigil';
  task.elements = [{ type: 'object', name: 'Legacy Sigil', placement: '0,1,0' }];
  const original = taskBinding(freeze(task));
  for (const overrides of [{ actionKind: 'deliver_item' }, { metrics: 'Deliver the sigil' }, { id: 'task-two' },
    { questId: 'quest-two' }, { targetID: 'target-two' }, { targetIDs: ['target-two'] },
    { elements: [{ type: 'object', name: 'Different Legacy Sigil', placement: '0,1,0' }] }]) {
    assert.notEqual(taskBinding({ ...task, ...overrides }), original);
  }
  const progressed = { ...task, status: 'Completed', progress: { revision: 10, satisfied: 2 } };
  assert.equal(taskBinding(progressed), original);
  assert.equal(taskBinding(JSON.parse(JSON.stringify(progressed))), original);
  assert.equal(taskBinding(Object.fromEntries(Object.entries(progressed).reverse())), original);
  assert.equal(taskBinding(null), null);
  assert.equal(taskBinding(undefined), null);
});
