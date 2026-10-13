const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDefeatTask, refreshCombatQuestProgress, evaluateTaskRequirements } = require('../retort/questProgress');

const sheet = (name, hp) => `${name}\nFemale\nWraith\nSentinel\nLevel: 2\nAC: 10\nXP: 2000\nHP: ${hp}\nMaxHP: 20\nEquipped: None\nAttack: 1\nDamage: 2\nArmor: 0\nMagic: 3\nState: ${hp > 0 ? 'Hostile' : 'Dead'}`;
const targets = [
  { type: 'monster', name: 'Vexathar', placement: '-1,-1,0', targetID: 'first' },
  { type: 'monster', name: 'Lathira', placement: '0,-2,0', targetID: 'second' },
  { type: 'monster', name: 'Sylithra', placement: '-1,1,0', targetID: 'third' }
];
const legacyTask = () => ({ type: 'Defeat', actionKind: 'defeat_monster', status: 'In Progress',
  desc: 'Defeat Vexathar, Lathira, and Sylithra.', requiredElements: structuredClone(targets),
  hardRequirements: [{ check: 'at_coords', value: '-1,-1,0' }, { check: 'monster_hp_zero', value: 'Vexathar' }],
  actionRequirements: [{ check: 'monster_hp_zero', value: 'Vexathar' }] });
const consoleFor = (monsters = 'None', coordinates = 'X: 0, Y: -2, Z: 0') =>
  `Coordinates: ${coordinates}\nCurrent Quest: Lift the curse\nQuest Progress: Step 1/3: In Progress; 0/3 requirements verified.\nInventory: iron key\nPC:\n${sheet('PC', 20)}\nNPCs in Party: None\nMonsters in Room:\n${monsters}\nMonsters Equipped Properties: None\nMonsters State: Hostile\nRooms Visited: 4`;
function fixture(task = legacyTask(), index = 0) {
  const f = { tasks: Array.from({ length: index }, () => ({ status: 'Completed' })).concat(task), index, seeded: true,
    database: Object.fromEntries(targets.map(e => [e.placement, { monsters: { inRoom: sheet(e.name, 20) } }])), logs: [] };
  f.state = { getCurrentTasks: () => f.tasks, setCurrentTasks: v => f.tasks = v,
    getCurrentTaskIndex: () => f.index, setCurrentTaskIndex: v => f.index = v,
    setQuestSeeded: v => f.seeded = v, getRoomNameDatabase: () => JSON.stringify(f.database),
    setUpdatedGameConsole: v => f.text = v, setLastQuestUpdate: v => f.update = v,
    appendQuestLog: v => f.logs.push(v) };
  return f;
}

test('legacy multi-room defeat gates count each bound target once without moving their placements', () => {
  const old = legacyTask(), before = JSON.stringify(old), fixed = normalizeDefeatTask(old);
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(fixed.requiredElements, targets);
  assert.deepEqual(fixed.hardRequirements.map(r => r.value), targets.map(e => e.name));
  assert.deepEqual(fixed.actionRequirements, []);
  assert.equal(normalizeDefeatTask(fixed), fixed);
});

test('combat immediately records partial kills and retains them after the player leaves the room', () => {
  const f = fixture();
  f.database['-1,-1,0'].monsters.inRoom = sheet('Vexathar', 0);
  const first = refreshCombatQuestProgress(f.state, consoleFor(sheet('Lathira', 20)));
  assert.match(first, /1\/3 requirements verified/);
  for (const target of targets) assert.ok(first.includes(`Defeat ${target.name} in Room (${target.placement})`));
  assert.equal(first.match(/^Quest Requirements:/gm).length, 1);
  assert.equal(f.tasks[0].progress.satisfied, 1);
  assert.equal(f.index, 0);
  assert.deepEqual(f.logs, []);
  f.database['0,-2,0'].monsters.inRoom = sheet('Lathira', -3);
  const away = refreshCombatQuestProgress(f.state, consoleFor('None', 'X: 8, Y: 8, Z: 0'));
  assert.match(away, /2\/3 requirements verified/);
  assert.match(away, /Inventory: iron key/);
  assert.equal(f.index, 0);
  assert.equal(f.seeded, true);
});

test('all three verified deaths advance only the current non-boss step and do not grant duplicate XP or keys', () => {
  const f = fixture();
  for (const e of targets) f.database[e.placement].monsters.inRoom = sheet(e.name, 0);
  const original = consoleFor(), result = refreshCombatQuestProgress(f.state, original);
  assert.match(result, /Completed; 3\/3 requirements verified/);
  assert.equal(f.index, 1);
  assert.equal(f.seeded, false);
  assert.equal(f.logs.length, 1);
  assert.match(result, /^Quest Requirements: Step completed\./m);
  const withoutQuestDisplay = text => text.replace(/^Quest (?:Progress|Requirements):[^\n]*\n/gm, '');
  assert.equal(withoutQuestDisplay(result), withoutQuestDisplay(original));
  assert.equal(refreshCombatQuestProgress(f.state, result), result);
  assert.equal(f.logs.length, 1);
});

test('fresh saved sheets override stale kill snapshots, while same-name deaths elsewhere give no credit', () => {
  const f = fixture(normalizeDefeatTask(legacyTask()));
  f.database['-1,-1,0'].monsters.consoleBlock = sheet('Vexathar', 0);
  const result = evaluateTaskRequirements(f.tasks[0], { roomKey: '0,-2,0', consoleText: consoleFor(sheet('Vexathar', 0)), database: f.database });
  assert.equal(result.checks[0].passed, false);
  assert.equal(result.checks[0].evidence.source, 'database.monsters.inRoom');
  assert.equal(result.progress.satisfied, 0);
  f.database['-1,-1,0'].monsters.inRoom = sheet('Vexathar', 0).replace('HP: 0', 'HP: invalid');
  assert.equal(evaluateTaskRequirements(f.tasks[0], { roomKey: '8,8,0', consoleText: consoleFor(), database: f.database }).checks[0].passed, null);
});

test('normalization leaves mixed objectives, malformed gates and conflicting monster bindings unchanged', () => {
  const cases = [
    { hardRequirements: { check: 'monster_hp_zero', value: 'Vexathar' } },
    { actionRequirements: [{ check: 'monster_hp_zero', value: 42 }] },
    { hardRequirements: [{ check: 'inventory_contains', value: 'boss key' }] },
    { hardRequirements: [{ check: 'at_coords', value: '9,9,0' }] },
    { actionRequirements: [{ check: 'monster_hp_zero', value: 'Unbound Guard' }] },
    { requiredElements: [...targets, { type: 'monster', name: 'Vexathar', placement: '9,9,0' }] },
    { requiredElements: [...targets, { type: 'object', name: 'boss key', placement: '9,9,0' }] },
    { status: 'Completed' }
  ];
  for (const values of cases) { const task = { ...legacyTask(), ...values }; assert.equal(normalizeDefeatTask(task), task); }
});

test('combat never advances the bound final boss stage or drops additional quest gates', () => {
  const f = fixture(legacyTask(), 2);
  for (const e of targets) f.database[e.placement].monsters.inRoom = sheet(e.name, 0);
  refreshCombatQuestProgress(f.state, consoleFor(sheet('Vexathar', 0), 'X: -1, Y: -1, Z: 0'));
  assert.equal(f.index, 2);
  assert.equal(f.seeded, true);
  assert.equal(f.tasks[2].status, 'In Progress');
  assert.deepEqual(f.tasks[2].hardRequirements, legacyTask().hardRequirements);
  const mixed = fixture({ ...legacyTask(), type: 'Hybrid', hardRequirements: [{ check: 'monster_hp_zero', value: 'Vexathar' }], actionRequirements: [] });
  refreshCombatQuestProgress(mixed.state, consoleFor(sheet('Vexathar', 0), 'X: -1, Y: -1, Z: 0'));
  assert.equal(mixed.index, 0);
  assert.equal(mixed.tasks[0].status, 'In Progress');
});
