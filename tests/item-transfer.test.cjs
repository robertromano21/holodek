'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants'), Give = require('../retort/itemTransfer'), Q = require('../retort/questProgress');
const { createPopulationService } = require('../retort/roomPopulation');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
function fixture() {
  const key = '-2,0,0', name = 'Edrin Farrows', item = 'shardbreaker maul';
  const d = { geoKey: key, start: { x: 4, y: 4 }, layout: { width: 16, height: 16 }, cells: {} };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) d.cells[`${x},${y}`] = { tile: 'floor' };
  const p = I.createPopulation(key, [{ name, allegiance: 'Neutral', encounterId: 'archivist' }]);
  const row = who => formatStartingCharacterSheet({ Name: who, Sex: 'Female', Race: 'Human', Class: 'Archivist', Level: 2, AC: 10, HP: 30, MaxHP: 30 });
  p.actors[name].position = p.actors[name].home = { x: 5, y: 4 }; p.actors[name].sheet = row(name); p.actors[name].hp = 30;
  p.groups[0].site = { x: 5, y: 4 };
  const metadata = { name: item, type: 'weapon', attack_modifier: 2, damage_modifier: 4, ac: 0, magic: 2 };
  let text = `Current Quest: The temple records\nQuest Progress: Step 1/3: In Progress\nCoordinates: X: -2, Y: 0, Z: 0\nInventory: ${item}\nInventory Properties: ${JSON.stringify(metadata)}\nPC:\n${row('Mortacia')}\nNPCs in Party: None\nMonsters in Room:\n${row(name)}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nRooms Visited: 3`;
  let wire = JSON.stringify([{ name: 'Mortacia', type: 'pc', hp: 30, mazeX: 4, mazeY: 4, mazeRoomKey: key },
    { name, type: 'monster', hp: 30, mazeX: 5, mazeY: 4, mazeRoomKey: key }]);
  let db = JSON.stringify({ [key]: { inhabitants: p, monsters: { inRoom: row(name) } } }), idx = 0, questUpdate = '';
  let tasks = [{ type: 'Fetch', actionKind: 'solve_puzzle', status: 'In Progress',
    desc: `Retrieve the ${item} and present it to ${name}.`, physicalPuzzleRoom: '-1,-1,0',
    requiredElements: [{ type: 'weapon', name: item, placement: '-1,-1,0' }, { type: 'monster', name, placement: key }],
    hardRequirements: [{ check: 'at_coords', value: '-1,-1,0' }, { check: 'inventory_contains', value: item }],
    actionRequirements: [{ check: 'puzzle_solved', value: '-1,-1,0' }] }];
  const state = { getLastCoords: () => ({ x: -2, y: 0, z: 0 }), getRoomDungeonForSimulation: () => d,
    getRoomPopulation: () => p, setRoomPopulation() {}, getRoomNameDatabase: () => db, setRoomNameDatabase: v => db = v,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getCombatCharactersString: () => wire, setCombatCharactersString: v => wire = v,
    getCurrentTasks: () => tasks, setCurrentTasks: v => tasks = v, getCurrentTaskIndex: () => idx, setCurrentTaskIndex: v => idx = v,
    setQuestSeeded() {}, getLastQuestUpdate: () => questUpdate, setLastQuestUpdate: v => questUpdate = v };
  return { state, p, d, metadata, service: createPopulationService(state), input: `give ${item} to ${name}`, tasks: () => tasks,
    setText: value => text = value, roster: () => JSON.parse(wire) };
}
test('a verified nearby handoff transfers ownership and modifiers, and completes an explicitly worded delivery without any puzzle', () => {
  const f = fixture(), beforeHP = f.roster().map(a => a.hp), result = Give.give(f.state, f.service, f.input);
  assert.match(result.content, /Task completed/); assert.match(result.updatedGameConsole, /^Inventory: Empty$/m);
  assert.deepEqual(f.p.actors['Edrin Farrows'].inventory, [f.metadata]);
  assert.deepEqual(f.roster().map(a => a.hp), beforeHP);
  assert.equal(f.state.getCurrentTaskIndex(), 1); assert.equal(f.tasks()[0].status, 'Completed');
  assert.equal(f.tasks()[0].actionKind, 'deliver_item'); assert.equal(f.tasks()[0].physicalPuzzleRoom, undefined);
  assert.equal(f.tasks()[0].progress.eligible, true);
  assert.match(Give.give(f.state, f.service, f.input).content, /not in inventory/);
  assert.equal(f.p.actors['Edrin Farrows'].inventory.length, 1, 'A repeated command cannot duplicate the item');
});
test('wrong-recipient gifts do not satisfy a bound delivery, and dropped objects or dialogue are not transfer receipts', () => {
  const f = fixture(), normalized = Q.normalizeDeliveryTask(f.tasks()[0]);
  const assessment = Q.evaluateTaskRequirements(normalized, { roomKey: '-2,0,0', consoleText: f.state.getUpdatedGameConsole(), database: JSON.parse(f.state.getRoomNameDatabase()) });
  assert.equal(assessment.progress.eligible, false); assert.equal(assessment.actionFails.length, 1);
  f.tasks()[0].requiredElements[1].name = 'Another Archivist'; f.tasks()[0].desc = 'Retrieve the shardbreaker maul and present it to Another Archivist.';
  assert.doesNotMatch(Give.give(f.state, f.service, f.input).content, /Task completed/);
  assert.equal(f.state.getCurrentTaskIndex(), 0);
});
test('dead, hostile, absent, occluded, distant or empty-inventory handoffs cannot remove an item', () => {
  for (const scenario of ['dead', 'hostile', 'missing', 'wall', 'distance', 'empty']) {
    const f = fixture(), before = f.state.getUpdatedGameConsole();
    if (scenario === 'dead') f.p.actors['Edrin Farrows'].status = 'dead';
    if (scenario === 'hostile') f.p.actors['Edrin Farrows'].allegiance = 'Hostile';
    if (scenario === 'missing') delete f.p.actors['Edrin Farrows'];
    if (scenario === 'wall') f.d.cells['5,4'].tile = 'wall';
    if (scenario === 'distance') {
      const r = f.roster(); r[0].mazeX = 12; f.state.setCombatCharactersString(JSON.stringify(r));
    }
    if (scenario === 'empty') f.setText(before.replace('Inventory: shardbreaker maul', 'Inventory: Empty'));
    const initial = f.state.getUpdatedGameConsole();
    Give.give(f.state, f.service, f.input);
    if (scenario === 'dead') {
      assert.equal(f.state.getUpdatedGameConsole().match(/^Inventory:.*$/m)[0], initial.match(/^Inventory:.*$/m)[0]);
      assert.match(f.state.getUpdatedGameConsole(), /Assistant of Edrin Farrows/);
      assert.equal(f.p.actors['Edrin Farrows'].status, 'dead');
    } else assert.equal(f.state.getUpdatedGameConsole(), initial, scenario);
    assert.equal(f.state.getCurrentTaskIndex(), 0);
  }
});
test('genuine puzzle tasks and ordinary fetches are not rewritten as deliveries', () => {
  const f = fixture(), task = f.tasks()[0];
  const puzzle = { ...task, type: 'Puzzle' }; assert.equal(Q.normalizeDeliveryTask(puzzle), puzzle);
  const hybrid = { ...task, desc: 'Retrieve the shardbreaker maul, activate the altar, and present it to Edrin Farrows.' };
  assert.equal(Q.normalizeDeliveryTask(hybrid), hybrid);
  const fetch = { ...task, desc: 'Retrieve the shardbreaker maul from the bastion.' };
  assert.equal(Q.normalizeDeliveryTask(fetch), fetch);
});

test('multi-item deliveries persist each handoff and complete only after all required items are actually given', () => {
  const f = fixture(), task = f.tasks()[0], second = { name: 'shroud of eternal echoes', type: 'armor', ac: 2, magic: 3 };
  task.actionKind = 'deliver_item'; task.desc = 'Retrieve the maul and shroud, then give both to Edrin Farrows.';
  task.requiredElements.push({ type: 'armor', name: second.name, placement: '-1,1,0' });
  f.setText(f.state.getUpdatedGameConsole().replace('Inventory: shardbreaker maul', `Inventory: shardbreaker maul, ${second.name}`)
    .replace(`Inventory Properties: ${JSON.stringify(f.metadata)}`, `Inventory Properties: ${JSON.stringify(f.metadata)}, ${JSON.stringify(second)}`));
  const first = Give.give(f.state, f.service, f.input), boundTask = f.tasks()[0];
  assert.equal(f.state.getCurrentTaskIndex(), 0); assert.equal(boundTask.status, 'In Progress');
  assert.match(first.questUpdate, /1\/2 required items/); assert.doesNotMatch(first.content, /Task completed/);
  assert.equal(boundTask.progress.satisfied, 2); assert.equal(boundTask.progress.total, 3);
  assert.deepEqual(boundTask.hardRequirements, [{ check: 'at_coords', value: '-2,0,0' }]);
  assert.equal(boundTask.actionRequirements.length, 2); assert.equal(boundTask.physicalPuzzleRoom, undefined);
  assert.match(first.updatedGameConsole, /^Inventory: shroud of eternal echoes$/m);
  assert.match(first.updatedGameConsole, /^Quest Requirements: .*Give "shardbreaker maul" to Edrin Farrows.*Give "shroud of eternal echoes" to Edrin Farrows/m);
  const binding = Q.taskBinding(boundTask), db = JSON.parse(f.state.getRoomNameDatabase());
  assert.equal(db['-2,0,0'].itemTransfers[0].taskBinding, binding);
  f.state.setCurrentTasks(JSON.parse(JSON.stringify(f.tasks()))); f.state.setRoomNameDatabase(JSON.stringify(db));
  assert.equal(Q.normalizeDeliveryTask(f.tasks()[0]), f.tasks()[0], 'Reloading cannot rewrite the task identity between handoffs');
  assert.match(Give.give(f.state, f.service, f.input).content, /not in inventory/);
  assert.equal(f.p.actors['Edrin Farrows'].inventory.length, 1);
  const done = Give.give(f.state, f.service, `give ${second.name} to Edrin Farrows`);
  assert.match(done.questUpdate, /Task completed/); assert.equal(f.state.getCurrentTaskIndex(), 1);
  assert.equal(f.tasks()[0].progress.satisfied, 3); assert.equal(f.tasks()[0].progress.eligible, true);
  assert.equal(Q.taskBinding(f.tasks()[0]), binding);
  assert.deepEqual(f.p.actors['Edrin Farrows'].inventory, [f.metadata, second]);
  assert.equal(JSON.parse(f.state.getRoomNameDatabase())['-2,0,0'].itemTransfers.length, 2);
  assert.match(done.updatedGameConsole, /^Quest Requirements: Step completed\./m);
  assert.equal(done.updatedGameConsole.match(/^Quest Requirements:/gm).length, 1);
  assert.match(Give.give(f.state, f.service, `give ${second.name} to Edrin Farrows`).content, /not in inventory/);
  assert.equal(f.state.getCurrentTaskIndex(), 1);
});

test('missing delivery checks, similar items and receipts for another task, room or recipient cannot satisfy multi-item deliveries', () => {
  const f = fixture(), task = f.tasks()[0]; task.actionKind = 'deliver_item';
  task.requiredElements.push({ type: 'object', name: 'shroud of eternal echoes', placement: '-1,1,0' });
  const normalized = Q.normalizeDeliveryTask(task), bindings = Q.deliveryBindings(normalized);
  const receipts = bindings.map((b, i) => ({ id: 'receipt-' + i, source: 'engine-give-item-v1', ...b, roomKey: b.coords, taskBinding: Q.taskBinding(normalized) }));
  const database = JSON.parse(f.state.getRoomNameDatabase());
  database['-2,0,0'].itemTransfers = receipts;
  const assess = t => Q.evaluateTaskRequirements(t, { roomKey: '-2,0,0', consoleText: f.state.getUpdatedGameConsole(), database });
  assert.equal(Q.verifiedTaskCompletion(normalized, assess(normalized)), true);
  const missing = { ...normalized, actionRequirements: normalized.actionRequirements.slice(0, 1) };
  database['-2,0,0'].itemTransfers = receipts.map(r => ({ ...r, taskBinding: Q.taskBinding(missing) }));
  assert.equal(assess(missing).progress.eligible, true);
  assert.equal(Q.verifiedTaskCompletion(missing, assess(missing)), false);
  for (const patch of [{ item: 'soulshroud' }, { recipient: 'Another Archivist' }, { roomKey: '0,0,0' },
    { taskBinding: 'another-task' }, { source: 'dialogue' }]) {
    database['-2,0,0'].itemTransfers = [receipts[0], { ...receipts[1], ...patch }];
    assert.equal(Q.verifiedTaskCompletion(normalized, assess(normalized)), false, JSON.stringify(patch));
  }
});
