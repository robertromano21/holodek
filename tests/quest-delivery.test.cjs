'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Q = require('../retort/questProgress');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
function fixture() {
  const task = { type: 'Fetch', actionKind: 'deliver_item', status: 'Pending',
    desc: 'Find the chronicle and shroud in the northern hall, then give both to Grelma.',
    requiredElements: [{ type: 'object', name: 'chronicle of ruined temple entrance', placement: '0,0,0' },
      { type: 'object', name: 'shroud of eternal echoes', placement: '-1,1,0' },
      { type: 'monster', name: 'Grelma Voss', placement: '0,1,0' }],
    hardRequirements: [{ check: 'at_coords', value: '0,0,0' }, { check: 'inventory_contains', value: 'chronicle of ruined temple entrance' }],
    actionRequirements: [], targetID: 'delivery-one' };
  const sheet = formatStartingCharacterSheet({ Name: 'Grelma Voss', Sex: 'Male', Race: 'Human', Class: 'Stonecutter', Level: 1, HP: 20, MaxHP: 20 })
    .replace(/^[ \t]*State:.*$/m, 'State: Neutral');
  const database = { '0,0,0': { name: 'Ruined Temple Entrance', objects: [{ name: task.requiredElements[0].name, type: 'other' }] },
    '-1,1,0': { name: 'Hall of Eternal Echoes', objects: [{ name: task.requiredElements[1].name, type: 'armor' }] },
    '0,1,0': { name: 'Hall of Quiet Descent', objects: [], monsters: { inRoom: 'Grelma Voss', consoleBlock: `Monsters in Room:\n${sheet}`, state: 'Neutral' } } };
  return { task, database };
}
test('future deliveries compile from structured bindings despite abbreviated prose, preserving identity and exact locations', () => {
  const f = fixture(), before = JSON.stringify(f), compiled = Q.compileGeneratedDeliveryTask(f.task, f.database);
  assert.equal(JSON.stringify(f), before, 'Compiling must not mutate the proposed task or world records');
  assert.equal(compiled.targetID, f.task.targetID);
  assert.equal(compiled.deliveries.length, 2);
  assert.deepEqual(compiled.hardRequirements, [{ check: 'at_coords', value: '0,1,0' }]);
  assert.equal(compiled.actionRequirements.length, 2);
  assert.match(compiled.desc, /shroud of eternal echoes from Hall of Eternal Echoes/);
  assert.match(compiled.desc, /give each item to Grelma Voss in Hall of Quiet Descent/);
  assert.doesNotMatch(compiled.desc, /northern hall/);
  assert.equal(Q.normalizeDeliveryTask(compiled), compiled);
  const saved = JSON.parse(JSON.stringify(compiled));
  assert.equal(Q.normalizeDeliveryTask(saved), saved);
  assert.equal(Q.taskBinding(saved), Q.taskBinding(compiled));
});
test('separate generated deliveries cannot reuse earlier handoff receipts even when every item and destination matches', () => {
  const { task, database } = fixture(), first = Q.compileGeneratedDeliveryTask(task, database), second = Q.compileGeneratedDeliveryTask(task, database);
  assert.notEqual(first.id, second.id); assert.notEqual(Q.taskBinding(first), Q.taskBinding(second));
  database['0,1,0'].itemTransfers = first.deliveries.map((b, i) => ({ ...b, id: 'receipt-' + i,
    source: 'engine-give-item-v1', roomKey: b.coords, taskBinding: Q.taskBinding(first) }));
  const context = { roomKey: '0,1,0', database, consoleText: 'Inventory: Empty' };
  assert.equal(Q.verifiedTaskCompletion(first, Q.evaluateTaskRequirements(first, context)), true);
  assert.equal(Q.verifiedTaskCompletion(second, Q.evaluateTaskRequirements(second, context)), false);
});
test('generation refuses ambiguous, missing, hostile, dead or departed delivery recipients instead of publishing unwinnable tasks', () => {
  for (const scenario of ['ambiguous', 'missing', 'hostile', 'individual-hostile', 'dead', 'departed', 'recruited']) {
    const { task, database } = fixture(), room = database['0,1,0'];
    if (scenario === 'ambiguous') task.requiredElements.push({ type: 'monster', name: 'Other Archivist', placement: '0,1,0' });
    if (scenario === 'missing') delete room.monsters;
    if (scenario === 'hostile') {
      room.monsters.state = 'Hostile';
      room.monsters.consoleBlock = room.monsters.consoleBlock.replace('State: Neutral', '');
    }
    if (scenario === 'individual-hostile') room.monsters.consoleBlock = room.monsters.consoleBlock.replace('State: Neutral', 'State: Hostile');
    if (scenario === 'dead') room.monsters.consoleBlock = room.monsters.consoleBlock.replace('HP: 20', 'HP: 0');
    if (['departed', 'recruited'].includes(scenario)) room.inhabitants = { actors: { 'Grelma Voss': { name: 'Grelma Voss', status: scenario, allegiance: 'Neutral', hp: 20 } } };
    assert.equal(Q.compileGeneratedDeliveryTask(task, database), null, scenario);
  }
});
test('generation verifies every required item and rejects duplicate, malformed or invented source bindings', () => {
  for (const scenario of ['missing-item', 'wrong-item', 'missing-room', 'malformed-items', 'duplicate-item', 'invalid-coordinates']) {
    const { task, database } = fixture();
    if (scenario === 'missing-item') database['-1,1,0'].objects = [];
    if (scenario === 'wrong-item') database['-1,1,0'].objects = [{ name: 'soulshroud' }];
    if (scenario === 'missing-room') delete database['-1,1,0'];
    if (scenario === 'malformed-items') database['-1,1,0'].objects = {};
    if (scenario === 'duplicate-item') task.requiredElements[1].name = task.requiredElements[0].name;
    if (scenario === 'invalid-coordinates') task.requiredElements[1].placement = 'north';
    assert.equal(Q.compileGeneratedDeliveryTask(task, database), null, scenario);
  }
});
test('ordinary retrieval is unchanged and genuine puzzle-plus-delivery proposals cannot lose their additional requirements', () => {
  const { task, database } = fixture();
  const fetch = { ...task, actionKind: 'take_item', desc: 'Retrieve the shroud of eternal echoes.' };
  assert.equal(Q.compileGeneratedDeliveryTask(fetch, database), fetch);
  const hybrid = { ...task, desc: 'Activate the altar, then give both items to Grelma Voss.' };
  assert.equal(Q.normalizeDeliveryTask(hybrid), hybrid);
  assert.equal(Q.compileGeneratedDeliveryTask(hybrid, database), null, 'Unsupported hybrid handoffs must not be published as pure delivery');
});
