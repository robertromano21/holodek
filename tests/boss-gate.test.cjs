'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ensureBossGate, seedBossKey, makeBossKeyTask, isReservedBossKeyName, bossRoomNameForTarget } = require('../retort/bossGate');
const { itemKind, parseRoomObjects } = require('../assets/renderSceneItems');
const { evaluateTaskRequirements } = require('../retort/questProgress');

const clone = value => JSON.parse(JSON.stringify(value));
const BOSS_KEY = '9,-4,2';
const BOSS_NAME = 'The Ash Regent, Keeper of Oaths';
const BOSS_ROOM = 'Sanctuary of Unbroken Oaths';

function consoleText(overrides = {}) {
  const lines = {
    'Room Name': 'Ruined Temple Entrance', Coordinates: 'X: 0, Y: 0, Z: 0',
    'Next Boss': BOSS_NAME, 'Next Boss Room': BOSS_ROOM, 'Boss Room Coordinates': 'X: 9, Y: -4, Z: 2',
    'Next Artifact': 'Sepulchra', 'Current Quest': 'Recover Sepulchra without changing the bound boss.',
    Inventory: 'old brass key', 'Objects in Room': 'None', Score: '17', Turns: '8', ...overrides
  };
  return Object.entries(lines).map(([key, value]) => `${key}: ${value}`).join('\r\n');
}

function database() {
  return {
    '0,0,0': {
      name: 'Ruined Temple Entrance', classification: { indoor: true, biome: 'temple' },
      objects: [{ name: 'old brass key', type: 'key', unlocks: { coordinates: '0,0,0', direction: 'east' } }],
      exits: {
        east: { status: 'open', targetCoordinates: BOSS_KEY, key: 'old brass key', hint: 'The fixed sanctuary',
          locks: { puzzle: 'untouched' }, door: { material: 'iron' } },
        north: { status: 'open', targetCoordinates: '0,1,0', key: null },
        west: { status: 'locked', targetCoordinates: '-1,0,0', key: 'unrelated key', locks: ['unchanged'] }
      }
    },
    '0,1,0': {
      name: 'Last Task Hall', objects: [], exits: {
        south: { status: 'open', targetCoordinates: '0,0,0' },
        up: { status: 'sealed', targetCoordinates: { x: 9, y: -4, z: 2 }, key: 'old upstairs key',
          puzzle: 'Leave this puzzle metadata alone' }
      }
    },
    '-1,0,0': { name: 'Locked Side Room', objects: [], exits: {} },
    '2,2,0': { name: 'Disconnected Known Room', objects: [], exits: {} },
    '20,0,2': { name: 'Room Behind Boss', objects: [], exits: {} },
    [BOSS_KEY]: {
      name: BOSS_ROOM, coordinates: { x: 9, y: -4, z: 2 },
      monsters: { inRoom: BOSS_NAME, consoleBlock: `${BOSS_NAME}\nHP: 90`, state: 'Hostile' },
      objects: [{ name: 'Sepulchra', type: 'artifact', properties: { magic: 10 } }],
      classification: { indoor: true, biome: 'temple' }, sceneSpec: { source: { description: 'Fixed sanctuary' } },
      exits: { west: { status: 'open', targetCoordinates: '0,0,0' }, east: { status: 'open', targetCoordinates: '20,0,2' } }
    }
  };
}

const gateItems = (db, gate) => Object.values(db).flatMap(room => Array.isArray(room?.objects) ?
  room.objects.filter(item => item.questGateId === gate.id || item.name === gate.keyName) : []);

test('only gate metadata and every existing inbound lock change; boss bindings and console are read-only', () => {
  const db = database(), before = clone(db), text = consoleText();
  const report = ensureBossGate(db, text, { questId: 'quest-1' });
  assert.equal(report.status, 'ready');
  assert.equal(report.created, true);
  assert.equal(report.changed, true);
  const gate = report.gate;
  assert.strictEqual(db[BOSS_KEY].bossGate, gate);
  assert.deepEqual(gate, {
    version: 1, id: gate.id, keyName: gate.keyName, bossName: BOSS_NAME, bossRoomName: BOSS_ROOM,
    targetKey: BOSS_KEY, keyPlacement: null, keySeeded: false
  });
  assert.match(gate.keyName, /^sanctuary of unbroken oaths seal key [a-f0-9]{12}$/);
  assert.deepEqual(report.lockedExits, [{ coordinates: '0,0,0', direction: 'east' }, { coordinates: '0,1,0', direction: 'up' }]);
  for (const [key, direction] of [['0,0,0', 'east'], ['0,1,0', 'up']]) {
    assert.deepEqual(db[key].exits[direction], {
      ...before[key].exits[direction], status: 'locked', key: gate.keyName, bossGateId: gate.id
    });
    before[key].exits[direction] = clone(db[key].exits[direction]);
  }
  before[BOSS_KEY].bossGate = clone(gate);
  assert.deepEqual(db, before);
  assert.equal(text, consoleText());
  assert.equal(gateItems(db, gate).length, 0);
});

test('ensure is deterministic, idempotent, and never seeds a key at stage 0', () => {
  const db = database(), other = database(), text = consoleText();
  const first = ensureBossGate(db, text);
  assert.deepEqual(ensureBossGate(other, text).gate, first.gate);
  const before = clone(db);
  for (let turn = 0; turn < 4; turn++) {
    const again = ensureBossGate(db, text);
    assert.strictEqual(again.gate, first.gate);
    assert.equal(again.created, false);
    assert.equal(again.changed, false);
    assert.deepEqual(again.lockedExits, []);
    assert.equal(gateItems(db, first.gate).length, 0);
    assert.equal(first.gate.keyPlacement, null);
    assert.equal(first.gate.keySeeded, false);
  }
  assert.deepEqual(db, before);
});

test('an exit already opened for this same gate stays open on every subsequent ensure', () => {
  const db = database(), text = consoleText(), { gate } = ensureBossGate(db, text);
  const entry = db['0,0,0'].exits.east;
  entry.status = 'open';
  const opened = clone(entry);
  for (let call = 0; call < 3; call++) {
    const report = ensureBossGate(db, text);
    assert.equal(report.changed, false);
    assert.deepEqual(report.preservedOpenExits, [{ coordinates: '0,0,0', direction: 'east' }]);
    assert.deepEqual(entry, opened);
    assert.equal(db['0,1,0'].exits.up.status, 'locked');
    assert.equal(db['0,1,0'].exits.up.key, gate.keyName);
  }
});

test('legacy unlocking can clear exit.key without relocking or rewriting an opened same-gate exit', () => {
  const db = database(), text = consoleText(), { gate } = ensureBossGate(db, text);
  seedBossKey(db, gate, '0,0,0');
  const entry = db['0,0,0'].exits.east;
  entry.status = 'open';
  entry.key = null;
  const before = clone(db);
  for (let call = 0; call < 3; call++) {
    const report = ensureBossGate(db, text);
    assert.equal(report.changed, false);
    assert.deepEqual(report.preservedOpenExits, [{ coordinates: '0,0,0', direction: 'east' }]);
    assert.deepEqual(db, before);
    assert.equal(seedBossKey(db, gate, '0,0,0').status, 'already-seeded');
  }
});

test('old keys and gates cannot authorize this gate, and newly discovered inbound approaches are locked', () => {
  const db = database(), text = consoleText();
  db['0,0,0'].exits.east.bossGateId = 'old-gate';
  const { gate } = ensureBossGate(db, text);
  assert.notEqual(gate.keyName, 'old brass key');
  assert.notEqual(gate.keyName, 'old upstairs key');
  assert.notEqual(db['0,0,0'].exits.east.key, db['0,0,0'].objects[0].name);
  const oldObject = clone(db['0,0,0'].objects[0]);
  db['0,1,0'].exits.east = { status: 'open', targetCoordinates: BOSS_KEY, key: 'old brass key' };
  const again = ensureBossGate(db, text);
  assert.strictEqual(again.gate, gate);
  assert.deepEqual(again.lockedExits, [{ coordinates: '0,1,0', direction: 'east' }]);
  assert.deepEqual(db['0,1,0'].exits.east, { status: 'locked', targetCoordinates: BOSS_KEY, key: gate.keyName, bossGateId: gate.id });
  assert.deepEqual(db['0,0,0'].objects[0], oldObject);
});

test('gate identities distinguish full boss names, all coordinate components, artifacts, and optional quest IDs', () => {
  const original = ensureBossGate(database(), consoleText(), { questId: 'quest-1' }).gate;
  const cases = [
    [{ 'Next Boss': `${BOSS_NAME} II` }, BOSS_KEY, 'quest-1'],
    [{ 'Next Artifact': 'Different Relic' }, BOSS_KEY, 'quest-1'],
    [{}, BOSS_KEY, 'quest-2'],
    [{ 'Boss Room Coordinates': 'X: 9, Y: -4, Z: 3' }, '9,-4,3', 'quest-1'],
    [{ 'Boss Room Coordinates': 'X: 9, Y: -5, Z: 2' }, '9,-5,2', 'quest-1'],
    [{ 'Boss Room Coordinates': 'X: 10, Y: -4, Z: 2' }, '10,-4,2', 'quest-1']
  ];
  for (const [overrides, targetKey, questId] of cases) {
    const db = database();
    db[targetKey] = clone(db[BOSS_KEY]);
    const { gate } = ensureBossGate(db, consoleText(overrides), { questId });
    assert.notEqual(gate.id, original.id);
    assert.notEqual(gate.keyName, original.keyName);
  }
});

test('new quests relock old opened gates but do not remove old key objects or change the boss', () => {
  const db = database(), text = consoleText(), first = ensureBossGate(db, text, { questId: 'first' }).gate;
  seedBossKey(db, first, '0,0,0');
  db['0,0,0'].exits.east.status = 'open';
  const boss = clone(db[BOSS_KEY]), oldItems = clone(db['0,0,0'].objects);
  const { gate } = ensureBossGate(db, text, { questId: 'second' });
  assert.notEqual(gate.keyName, first.keyName);
  assert.equal(db['0,0,0'].exits.east.status, 'locked');
  assert.equal(db['0,0,0'].exits.east.bossGateId, gate.id);
  assert.deepEqual(db['0,0,0'].objects, oldItems);
  delete boss.bossGate;
  const afterBoss = clone(db[BOSS_KEY]);
  delete afterBoss.bossGate;
  assert.deepEqual(afterBoss, boss);
  assert.equal(gateItems(db, gate).length, 0);
});

test('key names are lowercase human-readable ASCII, bounded and safe for quoted console fields', () => {
  const room = 'Hall "of" \\ Oaths: <Forbidden>|?* / ' + 'Very Long Sanctuary '.repeat(30);
  const { gate } = ensureBossGate(database(), consoleText({ 'Next Boss Room': room }));
  assert.ok(gate.keyName.length <= 96);
  assert.match(gate.keyName, /^hall of oaths forbidden very long sanctuary.* seal key [a-f0-9]{12}$/);
  assert.match(gate.keyName, /^[a-z0-9 ]+$/);
  assert.equal(gate.bossRoomName, room.trim());
});

test('the literal key in the seal name is recognized by existing name-only item routing and console property parsing', () => {
  const db = database(), { gate } = ensureBossGate(db, consoleText());
  assert.match(gate.keyName, /\bkey\b/);
  assert.equal(itemKind({ name: gate.keyName }), 'key');
  seedBossKey(db, gate, '0,0,0');
  const key = gateItems(db, gate)[0];
  assert.deepEqual(key.properties, { attack: 0, damage: 0, ac: 0, magic: 0 });
  const text = `Objects in Room: ${key.name}\nObjects in Room Properties: {name: "${key.name}", type: "key", ` +
    `attack_modifier: ${key.properties.attack}, damage_modifier: ${key.properties.damage}, ac: ${key.properties.ac}, magic: ${key.properties.magic}}`;
  const parsed = parseRoomObjects(text);
  assert.deepEqual(parsed, [{ name: key.name, type: 'key', magic: 0 }]);
  assert.equal(itemKind(parsed[0]), 'key');
});

test('an unrelated object or exit key with the deterministic candidate name forces a unique stable name', () => {
  const candidate = ensureBossGate(database(), consoleText()).gate.keyName;
  for (const collision of ['object', 'exit', 'metadata']) {
    const db = database();
    if (collision === 'object') db['0,0,0'].objects.push({ name: candidate.toUpperCase(), type: 'key' });
    if (collision === 'exit') db['0,0,0'].exits.west.key = candidate;
    if (collision === 'metadata') db['2,2,0'].bossGate = { keyName: candidate };
    const sameInput = clone(db), { gate } = ensureBossGate(db, consoleText());
    assert.notEqual(gate.keyName, candidate);
    assert.equal(ensureBossGate(sameInput, consoleText()).gate.keyName, gate.keyName);
    assert.equal(ensureBossGate(db, consoleText()).gate.keyName, gate.keyName);
  }
});

test('stage-1 caller seeds exactly the existing key schema at the selected current or last-task room', () => {
  for (const placement of ['0,0,0', '0,1,0']) {
    const db = database(), { gate } = ensureBossGate(db, consoleText()), before = clone(db);
    const result = seedBossKey(db, gate, placement);
    assert.equal(result.status, 'seeded');
    assert.equal(result.seeded, true);
    assert.equal(result.changed, true);
    assert.strictEqual(result.gate, gate);
    assert.equal(gate.keyPlacement, placement);
    assert.equal(gate.keySeeded, true);
    assert.deepEqual(gateItems(db, gate), [{
      name: gate.keyName, type: 'key', properties: { attack: 0, damage: 0, ac: 0, magic: 0 },
      unlocks: { coordinates: '0,0,0', direction: 'east' }, questGateId: gate.id
    }]);
    before[placement].objects.push(clone(gateItems(db, gate)[0]));
    before[BOSS_KEY].bossGate = clone(gate);
    assert.deepEqual(db, before);
  }
});

test('seeded flags survive pickup, serialization, a detached stale gate, and repeated ensures without inventory reads', () => {
  let db = database();
  const text = consoleText(), { gate } = ensureBossGate(db, text), stale = clone(gate);
  seedBossKey(db, gate, '0,1,0');
  assert.equal(seedBossKey(db, gate, '0,0,0').status, 'already-seeded');
  assert.equal(gateItems(db, gate).length, 1);
  db['0,1,0'].objects = [];
  db = clone(db);
  const persisted = ensureBossGate(db, text).gate;
  for (const snapshot of [stale, persisted]) {
    const result = seedBossKey(db, snapshot, '0,0,0');
    assert.equal(result.status, 'already-seeded');
    assert.equal(result.seeded, false);
    assert.equal(result.changed, false);
    assert.strictEqual(result.gate, persisted);
  }
  assert.equal(persisted.keyPlacement, '0,1,0');
  assert.equal(persisted.keySeeded, true);
  assert.equal(gateItems(db, persisted).length, 0);
});

test('a preexisting exact gate key is adopted, not duplicated', () => {
  const db = database(), { gate } = ensureBossGate(db, consoleText());
  seedBossKey(db, gate, '0,1,0');
  gate.keySeeded = false;
  gate.keyPlacement = null;
  const key = db['0,1,0'].objects[0];
  db['0,1,0'].objects[0] = { questGateId: key.questGateId, unlocks: key.unlocks,
    properties: { magic: 0, ac: 0, damage: 0, attack: 0 }, type: key.type, name: key.name };
  const result = seedBossKey(db, gate, '0,1,0');
  assert.equal(result.status, 'seeded');
  assert.equal(result.seeded, false);
  assert.equal(gate.keySeeded, true);
  assert.equal(gateItems(db, gate).length, 1);
});

test('tasks bind the exact seal and caller placement, stay Pending, and never change quest progress', () => {
  const db = database(), { gate } = ensureBossGate(db, consoleText());
  const stage0 = { type: 'Defeat', status: 'Complete' };
  const bossTask = { type: 'Defeat', desc: 'Original boss confrontation', status: 'Pending',
    requiredElements: [{ type: 'monster', name: BOSS_NAME, placement: BOSS_KEY }] };
  const quest = { currentTaskIndex: 1, score: 17, xp: 200, tasks: [stage0, null, bossTask] }, before = clone(quest);
  const task = makeBossKeyTask(gate, '0,1,0');
  assert.deepEqual(task, {
    type: 'Fetch',
    desc: `Retrieve ${gate.keyName} at 0,1,0 to unlock ${BOSS_ROOM} for the confrontation with ${BOSS_NAME}.`,
    metrics: `${gate.keyName} in Inventory regardless of current room`,
    requiredElements: [{ type: 'key', name: gate.keyName, placement: '0,1,0' }],
    actionKind: 'take_item',
    hardRequirements: [{ check: 'inventory_contains', value: gate.keyName }],
    actionRequirements: [], status: 'Pending', bossGateId: gate.id
  });
  assert.equal(gate.keySeeded, false);
  assert.equal(gateItems(db, gate).length, 0);
  seedBossKey(db, gate, '0,1,0');
  assert.deepEqual(makeBossKeyTask(gate, '0,1,0'), task);
  assert.equal(makeBossKeyTask(gate, '0,0,0'), null);
  assert.deepEqual(quest, before);
  task.requiredElements[0].name = 'mutated task copy';
  assert.equal(makeBossKeyTask(gate, '0,1,0').requiredElements[0].name, gate.keyName);
});

test('the unique boss seal remains eligible after pickup and travel, but ordinary or similar keys do not qualify', () => {
  const db = database(), { gate } = ensureBossGate(db, consoleText());
  seedBossKey(db, gate, '0,1,0', { playerRoomKey: '0,0,0' });
  const task = makeBossKeyTask(gate, '0,1,0'), before = clone(task);
  const assess = item => evaluateTaskRequirements(task, { roomKey: '0,0,0', database: db,
    consoleText: consoleText({ Inventory: item }) });
  assert.equal(assess(gate.keyName).progress.eligible, true);
  assert.equal(assess(gate.keyName.toUpperCase()).progress.eligible, true);
  for (const wrong of ['old brass key', `${gate.keyName} fragment`, 'None']) {
    const result = assess(wrong);
    assert.equal(result.progress.eligible, false);
    assert.equal(result.hardFails.length, 1);
  }
  assert.deepEqual(task.requiredElements, [{ type: 'key', name: gate.keyName, placement: '0,1,0' }]);
  assert.deepEqual(task, before);
});

test('missing/None boss bindings, partial or malformed coordinates, and non-record databases are skipped without mutation', () => {
  const overrides = [
    { 'Next Boss': 'None' }, { 'Next Boss Room': 'nOnE' }, { 'Next Boss': '' }, { 'Next Boss Room': '' },
    { 'Boss Room Coordinates': 'None' }, { 'Boss Room Coordinates': '9' },
    { 'Boss Room Coordinates': 'X: 9, Y: -4' }, { 'Boss Room Coordinates': 'X: 9, Y: -4, Z: 2 extra' },
    { 'Boss Room Coordinates': 'X: 9.5, Y: -4, Z: 2' }, { 'Boss Room Coordinates': '9,-4,2,3' },
    { 'Boss Room Coordinates': 'X: 9007199254740992, Y: -4, Z: 2' }
  ];
  for (const values of overrides) {
    const db = database(), before = clone(db), result = ensureBossGate(db, consoleText(values));
    assert.equal(result.status, 'skipped');
    assert.equal(result.gate, null);
    assert.equal(result.changed, false);
    assert.deepEqual(db, before);
  }
  for (const value of [null, [], 'serialized DB', undefined]) assert.equal(ensureBossGate(value, consoleText()).gate, null);
});

test('only exact console labels count; blank fields cannot borrow the following line and duplicate bindings fail closed', () => {
  const cases = [
    consoleText().replace('Next Boss:', 'Some Next Boss:'),
    consoleText().replace('Next Boss Room:', 'Next Boss Room Description:'),
    consoleText().replace('Boss Room Coordinates:', 'Former Boss Room Coordinates:'),
    consoleText({ 'Next Boss': '' }),
    `${consoleText()}\r\nNext Boss: Impostor`
  ];
  for (const text of cases) {
    const db = database(), before = clone(db);
    assert.equal(ensureBossGate(db, text).gate, null);
    assert.deepEqual(db, before);
  }
});

test('a missing or ambiguous bound boss record returns pending, never creating a room or boss actor', () => {
  for (const replacement of [undefined, null, 'Named room but not initialized']) {
    const db = database();
    if (replacement === undefined) delete db[BOSS_KEY];
    else db[BOSS_KEY] = replacement;
    const before = clone(db), result = ensureBossGate(db, consoleText());
    assert.equal(result.status, 'pending');
    assert.equal(result.reason, 'missing-boss-record');
    assert.equal(result.gate, null);
    assert.deepEqual(db, before);
  }
  const db = database();
  db['9, -4, 2'] = clone(db[BOSS_KEY]);
  const before = clone(db);
  assert.equal(ensureBossGate(db, consoleText()).status, 'pending');
  assert.deepEqual(db, before);
});

test('missing inbound entries remain pending, with no fabricated rooms, links, or objects', () => {
  const db = { [BOSS_KEY]: clone(database()[BOSS_KEY]) }, before = clone(db);
  const result = ensureBossGate(db, consoleText());
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'missing-boss-entry');
  const gate = result.gate;
  before[BOSS_KEY].bossGate = clone(gate);
  assert.deepEqual(db, before);
  assert.equal(seedBossKey(db, gate, BOSS_KEY).seeded, false);
  assert.equal(gate.keySeeded, false);
});

test('seed rejects unknown, malformed, boss, disconnected, locked, and boss-only-path rooms without mutation', () => {
  const cases = [
    [BOSS_KEY, 'boss-room-placement'], ['404,0,0', 'unknown-placement'], ['9,-4', 'unknown-placement'],
    ['9,-4,2 extra', 'unknown-placement'], [null, 'unknown-placement'],
    ['2,2,0', 'unreachable-placement'], ['-1,0,0', 'unreachable-placement'], ['20,0,2', 'unreachable-placement']
  ];
  for (const [placement, reason] of cases) {
    const db = database(), { gate } = ensureBossGate(db, consoleText()), before = clone(db);
    const result = seedBossKey(db, gate, placement);
    assert.equal(result.seeded, false);
    assert.equal(result.reason, reason);
    assert.equal(gate.keyPlacement, null);
    assert.equal(gate.keySeeded, false);
    assert.deepEqual(db, before);
  }
});

test('reachability follows authoritative directed links, not implicit adjacency or malformed explicit links', () => {
  const db = database(), { gate } = ensureBossGate(db, consoleText());
  db['0,0,0'].exits.north.targetCoordinates = 'invalid';
  const before = clone(db);
  assert.equal(seedBossKey(db, gate, '0,1,0').reason, 'unreachable-placement');
  assert.deepEqual(db, before);
  delete db['0,0,0'].exits.north;
  assert.equal(seedBossKey(db, gate, '0,1,0').reason, 'unreachable-placement');
  db['0,0,0'].exits.north = { status: 'open', targetCoordinates: { x: 0, y: 1, z: 0 } };
  assert.equal(seedBossKey(db, gate, '0,1,0').seeded, true);
});

test('optional player reachability rejects a one-way placement reachable from the primary approach without mutation', () => {
  const db = database(), { gate } = ensureBossGate(db, consoleText());
  db['0,0,0'].exits.up = { status: 'open', targetCoordinates: '2,2,0' };
  const before = clone(db);
  const result = seedBossKey(db, gate, '0,1,0', { playerRoomKey: '2,2,0' });
  assert.equal(result.reason, 'unreachable-from-player');
  assert.equal(result.seeded, false);
  assert.equal(result.changed, false);
  assert.deepEqual(db, before);
  assert.equal(gate.keySeeded, false);
  assert.equal(gate.keyPlacement, null);
  assert.equal(gateItems(db, gate).length, 0);
  assert.equal(seedBossKey(db, gate, '0,1,0').seeded, true);
});

test('optional player validation follows existing open links and cannot use an unknown room or boss shortcut', () => {
  for (const playerRoomKey of ['404,0,0', BOSS_KEY, '2,2,0']) {
    const db = database(), { gate } = ensureBossGate(db, consoleText());
    db['2,2,0'].exits.east = { status: 'open', targetCoordinates: BOSS_KEY };
    const before = clone(db);
    const result = seedBossKey(db, gate, '0,1,0', { playerRoomKey });
    assert.equal(result.seeded, false);
    assert.equal(result.changed, false);
    assert.deepEqual(db, before);
  }
  const db = database(), { gate } = ensureBossGate(db, consoleText());
  db['2,2,0'].exits.west = { status: 'open', targetCoordinates: '0,0,0' };
  assert.equal(seedBossKey(db, gate, '0,1,0', { playerRoomKey: '2,2,0' }).seeded, true);
});

test('existing implicit directional inbound exits are locked without adding explicit targets or exits', () => {
  const db = { '0,0,0': { name: 'Entry', exits: { east: { status: 'open', hint: 'implicit' } } },
    '1,0,0': { name: 'Boss', monsters: { inRoom: BOSS_NAME }, exits: {} } };
  const { gate } = ensureBossGate(db, consoleText({ 'Boss Room Coordinates': '1,0,0' }));
  assert.deepEqual(db['0,0,0'].exits.east, { status: 'locked', hint: 'implicit', key: gate.keyName, bossGateId: gate.id });
  assert.equal(Object.hasOwn(db['0,0,0'].exits.east, 'targetCoordinates'), false);
  assert.equal(seedBossKey(db, gate, '0,0,0').seeded, true);
});

test('entry selection and unlock bindings do not depend on room or exit insertion order', () => {
  const db = database(), reversed = Object.fromEntries(Object.entries(database()).reverse());
  reversed['0,0,0'].exits = Object.fromEntries(Object.entries(reversed['0,0,0'].exits).reverse());
  const first = ensureBossGate(db, consoleText()).gate, second = ensureBossGate(reversed, consoleText()).gate;
  seedBossKey(db, first, '0,1,0');
  seedBossKey(reversed, second, '0,1,0');
  assert.deepEqual(gateItems(db, first), gateItems(reversed, second));
  assert.deepEqual(first, second);
});

test('seeding requires the persisted bound gate, not a fabricated or stale gate', () => {
  const db = database(), { gate } = ensureBossGate(db, consoleText());
  for (const supplied of [null, {}, { ...gate, targetKey: null }, { ...gate, id: 'boss-gate:other' },
    { ...gate, keyName: 'wrong seal key abcdef123456' }]) {
    const before = clone(db);
    assert.equal(seedBossKey(db, supplied, '0,0,0').seeded, false);
    assert.deepEqual(db, before);
  }
  delete db[BOSS_KEY].bossGate;
  const before = clone(db);
  assert.equal(seedBossKey(db, gate, '0,0,0').reason, 'missing-bound-gate');
  assert.deepEqual(db, before);
});

test('task construction rejects invalid placements or gates rather than binding a fallback boss location', () => {
  const { gate } = ensureBossGate(database(), consoleText());
  for (const placement of [BOSS_KEY, null, '0,1', '0,1,0 extra', '0,1,0,3']) {
    assert.equal(makeBossKeyTask(gate, placement), null);
  }
  assert.equal(makeBossKeyTask(null, '0,0,0'), null);
  assert.equal(makeBossKeyTask({}, '0,0,0'), null);
});

test('seal names are reserved before a boss record or gate exists, independent of model item type', () => {
  const name = ensureBossGate(database(), consoleText()).gate.keyName;
  for (const db of [undefined, null, {}, database()]) {
    const before = db && clone(db);
    assert.equal(isReservedBossKeyName(db, name), true);
    assert.equal(isReservedBossKeyName(db, `  ${name.toUpperCase()}  `), true);
    if (db) assert.deepEqual(db, before);
  }
});

test('exit-target naming uses only the exact full console boss binding, not partial coordinates or conflicting labels', () => {
  const text = consoleText();
  assert.equal(bossRoomNameForTarget(text, BOSS_KEY), BOSS_ROOM);
  assert.equal(bossRoomNameForTarget(text, { x: 9, y: -4, z: 2 }), BOSS_ROOM);
  for (const target of ['9,-4,3', '9,-5,2', '10,-4,2', null, '9,-4,2 trailing']) {
    assert.equal(bossRoomNameForTarget(text, target), null);
  }
  for (const invalid of [consoleText({ 'Next Boss': 'None' }), consoleText({ 'Next Boss Room': 'None' }),
    consoleText({ 'Boss Room Coordinates': 'X: 9, Y: -4, Z: 2 trailing' }),
    `${text}\nNext Boss Room: Conflicting Room`]) {
    assert.equal(bossRoomNameForTarget(invalid, BOSS_KEY), null);
  }
});

test('persisted gate, exit and item identities reserve exact legacy names without reserving ordinary locks', () => {
  const cases = [
    { bossGate: { keyName: 'Legacy Sanctuary Key' } },
    { exits: { east: { status: 'locked', key: 'Legacy Sanctuary Key', bossGateId: 'boss-gate:legacy' } } },
    { objects: [{ name: 'Legacy Sanctuary Key', questGateId: 'boss-gate:legacy' }] }
  ];
  for (const room of cases) {
    const db = { '1,0,0': room }, before = clone(db);
    assert.equal(isReservedBossKeyName(db, ' legacy sanctuary key '), true);
    assert.equal(isReservedBossKeyName(db, 'legacy sanctuary key fragment'), false);
    assert.deepEqual(db, before);
  }
  const db = database(), before = clone(db);
  for (const name of ['old brass key', 'unrelated key', 'ordinary seal key', 'sanctuary seal key not a hash',
    'sanctuary seal key abcdef123456 fragment', null, {}, '']) {
    assert.equal(isReservedBossKeyName(db, name), false);
  }
  assert.deepEqual(db, before);
});

test('seal reservation survives stage-1 seeding, pickup and a legacy unlock that clears exit.key', () => {
  const db = database(), { gate } = ensureBossGate(db, consoleText());
  assert.equal(isReservedBossKeyName(db, gate.keyName), true);
  seedBossKey(db, gate, '0,1,0');
  assert.equal(isReservedBossKeyName(db, gate.keyName), true);
  db['0,1,0'].objects = [];
  db['0,0,0'].exits.east.status = 'open';
  db['0,0,0'].exits.east.key = null;
  const before = clone(db);
  assert.equal(isReservedBossKeyName(db, gate.keyName), true);
  assert.deepEqual(db, before);
  assert.equal(seedBossKey(db, gate, '0,1,0').status, 'already-seeded');
});

test('the real client status check and typed unlock flow require the specific seeded seal and preserve opened gate identity', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'game.js'), 'utf8').replace(/\r\n/g, '\n');
  const traversalStart = source.indexOf('function isExitTraversable(');
  const traversal = source.slice(traversalStart, source.indexOf('// Function to calculate new coordinates', traversalStart));
  const unlockStart = source.indexOf('const unlockCommands = [');
  const unlock = source.slice(unlockStart, source.indexOf('\n  if (validDirection) {', unlockStart));
  assert.ok(traversalStart >= 0 && unlockStart >= 0 && traversal && unlock);
  const db = database(), { gate } = ensureBossGate(db, consoleText()), ordinary = clone(db['0,0,0'].exits.west);
  const context = {
    roomNameDatabase: new Map(Object.entries(db)), currentCoordinates: { x: 0, y: 0, z: 0 },
    coordinatesToString: coords => `${coords.x},${coords.y},${coords.z}`,
    mapToPlainObject: map => Object.fromEntries(map), gameConsoleData: consoleText(), inventory: ['old brass key'],
    userInput: 'unlock door with old brass key', chatLog: { innerHTML: '' }, chatHistory: '',
    updateChatLog() {}, scrollToBottom() {}, console: { log() {} }
  };
  vm.runInNewContext(`${traversal}\nfunction typedUnlock() {\n${unlock}\n}`, context);
  assert.equal(context.isExitTraversable(context.currentCoordinates, 'east').traversable, false);
  context.typedUnlock();
  assert.equal(db['0,0,0'].exits.east.status, 'locked');
  context.userInput = `unlock door with ${gate.keyName}`;
  context.typedUnlock();
  assert.equal(db['0,0,0'].exits.east.status, 'locked');
  seedBossKey(db, gate, '0,0,0');
  assert.equal(context.isExitTraversable(context.currentCoordinates, 'east').traversable, false);
  context.inventory = [gate.keyName];
  context.typedUnlock();
  assert.equal(db['0,0,0'].exits.east.status, 'open');
  assert.equal(db['0,0,0'].exits.east.key, null);
  assert.equal(db['0,0,0'].exits.east.bossGateId, gate.id);
  assert.equal(context.isExitTraversable(context.currentCoordinates, 'east').traversable, true);
  assert.equal(ensureBossGate(db, consoleText()).changed, false);
  assert.equal(db['0,1,0'].exits.up.status, 'locked');
  assert.deepEqual(db['0,0,0'].exits.west, ordinary);
});
