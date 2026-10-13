'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants'), Q = require('../retort/questProgress');
const Recovery = require('../retort/questDeliverySuccessors'), Give = require('../retort/itemTransfer');
const Directions = require('../retort/questDirectionFacts');
const { createPopulationService } = require('../retort/roomPopulation');
const sheet = name => `${name}\nFemale\nHuman\nArchivist\nLevel: 2\nAC: 10\nXP: 0\nHP: 20\nMaxHP: 20\nEquipped: Weapon: None, Armor: None, Shield: None, Other: None\nAttack: 0\nDamage: 0\nArmor: 0\nMagic: 0\nState: Neutral`;
function fixture() {
  const key = '-2,0,0', name = 'Edrin Farrows', items = [{ name: 'shardbreaker maul', type: 'weapon', attack_modifier: 2, damage_modifier: 4, ac: 0, magic: 2 },
    { name: 'shroud of eternal echoes', type: 'armor', attack_modifier: 0, damage_modifier: 0, ac: 2, magic: 3 }];
  const dungeon = { geoKey: key, start: { x: 4, y: 4 }, classification: { indoor: true }, layout: { width: 16, height: 16 }, cells: {} };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 6 };
  let p = I.createPopulation(key, [{ name, race: 'Human', className: 'Archivist', allegiance: 'Neutral' }]);
  Object.assign(p.actors[name], { sheet: sheet(name), hp: 20, home: { x: 5, y: 4 }, position: { x: 5, y: 4 }, inventory: [] }); p.groups[0].site = p.actors[name].position;
  let db = { [key]: { name: 'Sanctuary of Shattered Vows', objects: [], inhabitants: p, monsters: { inRoom: sheet(name), state: 'Neutral' } },
    '-1,-1,0': { name: 'The Stonemasons Bastion', objects: structuredClone(items) } };
  let tasks = [Q.compileGeneratedTask({ type: 'Deliver', actionKind: 'deliver_item', requiredElements: [
    ...items.map(item => ({ type: item.type, name: item.name, placement: '-1,-1,0' })), { type: 'monster', name, placement: key }] }, db, key)];
  db['-1,-1,0'].objects = []; let database = JSON.stringify(db), index = 0, paused = false;
  let text = `Current Quest: Restore the temple records\nQuest Progress: Step 1/3: In Progress\nCoordinates: X: -2, Y: 0, Z: 0\nInventory: ${items.map(i => i.name).join(', ')}\nInventory Properties: ${items.map(i => JSON.stringify(i)).join(', ')}\nPC:\n${sheet('Mortacia')}\nNPCs in Party: None\nMonsters in Room:\n${sheet(name)}\nMonsters Equipped Properties: None\nMonsters State: Neutral`;
  let roster = JSON.stringify([{ name: 'Mortacia', type: 'pc', hp: 20, mazeX: 4, mazeY: 4, mazeRoomKey: key },
    { name, type: 'monster', hp: 20, mazeX: 5, mazeY: 4, mazeRoomKey: key }]);
  const state = { getCurrentTasks: () => tasks, setCurrentTasks: value => tasks = value, getCurrentTaskIndex: () => index, setCurrentTaskIndex: value => index = value,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: value => text = value,
    getRoomNameDatabase: () => database, setRoomNameDatabase: value => database = value,
    getCombatCharactersString: () => roster, setCombatCharactersString: value => roster = value,
    getRoomPopulation: room => room === key ? p : null, setRoomPopulation: (room, value) => { if (room === key) p = value; },
    getRoomDungeonForSimulation: coords => coords.x === -2 && coords.y === 0 ? dungeon : null,
    getLastCoords: () => ({ x: -2, y: 0, z: 0 }), setQuestSeeded() {}, setLastQuestUpdate() {}, getGamePaused: () => paused };
  return { key, name, items, dungeon, state, service: createPopulationService(state), p: () => p, db: () => JSON.parse(database),
    task: () => tasks[0], pause: value => paused = value,
    kill: who => { p.actors[who].hp = 0; p.actors[who].status = 'dead'; p.actors[who].sheet = p.actors[who].sheet.replace(/^HP:.*$/m, 'HP: 0'); },
    reload: () => { tasks = JSON.parse(JSON.stringify(tasks)); p = JSON.parse(database)[key].inhabitants; } };
}

test('death creates one living assistant at a reachable site with a real sheet, updated requirements and verified directions', () => {
  const f = fixture(), identity = Q.taskBinding(f.task()); f.kill(f.name);
  const recovery = Recovery.ensure(f.state), db = f.db(), row = db[f.key].deliverySuccessors[0], actor = f.p().actors[row.name];
  assert.equal(recovery.changed, true); assert.equal(row.name, 'Assistant of Edrin Farrows'); assert.equal(actor.status, 'present');
  assert.ok(actor.hp > 0); assert.equal(actor.inventory.length, 0); assert.equal(I.parseBlocks(actor.sheet)[0].name, actor.name);
  assert.ok(I.reachable(f.dungeon).some(t => t.x === actor.position.x && t.y === actor.position.y));
  assert.equal(f.p().actors[f.name].status, 'dead'); assert.equal(f.p().actors[f.name].hp, 0);
  assert.equal(Q.taskBinding(f.task()), identity);
  assert.match(f.state.getUpdatedGameConsole(), /Give "shardbreaker maul" to Assistant of Edrin Farrows \(taking over for Edrin Farrows\) in Sanctuary of Shattered Vows/);
  assert.ok(JSON.parse(f.state.getCombatCharactersString()).some(a => a.name === actor.name && a.mazeRoomKey === f.key));
  const facts = Directions.facts(f.state, 'where is Edrin?'); assert.equal(facts[0].name, actor.name); assert.equal(facts[0].replaces, f.name);
  assert.equal(Recovery.ensure(f.state).changed, false); assert.equal(f.db()[f.key].deliverySuccessors.length, 1);
});

test('a partial original handoff survives death and reload; an actual assistant handoff completes without consuming the first item twice', () => {
  const f = fixture(), first = Give.give(f.state, f.service, `give ${f.items[0].name} to ${f.name}`);
  assert.match(first.questUpdate, /1\/2/); const identity = Q.taskBinding(f.task()), receipt = f.db()[f.key].itemTransfers[0];
  f.kill(f.name); Recovery.ensure(f.state); const row = f.db()[f.key].deliverySuccessors[0]; f.reload();
  const before = f.db()[f.key].itemTransfers; assert.deepEqual(before, [receipt]);
  const result = Give.give(f.state, f.service, `give ${f.items[1].name} to ${row.name}`);
  assert.match(result.content, /Task completed/); assert.equal(f.state.getCurrentTaskIndex(), 1); assert.equal(f.task().progress.satisfied, 3);
  assert.equal(Q.taskBinding(f.task()), identity); assert.equal(f.db()[f.key].itemTransfers.length, 2);
  assert.equal(f.db()[f.key].itemTransfers[1].recipient, f.name); assert.equal(f.db()[f.key].itemTransfers[1].acceptedBy, row.name);
  assert.equal(f.p().actors[f.name].inventory[0].name, f.items[0].name); assert.deepEqual(f.p().actors[row.name].inventory, [f.items[1]]);
  assert.match(Give.give(f.state, f.service, `give ${f.items[1].name} to ${row.name}`).content, /not in inventory/);
  assert.equal(f.db()[f.key].itemTransfers.length, 2);
});

test('an unrelated assistant, stale delegation, another task or another room cannot earn handoff credit', () => {
  const f = fixture(); f.kill(f.name); Recovery.ensure(f.state); const db = f.db(), row = db[f.key].deliverySuccessors[0];
  for (const patch of [{ taskBinding: 'another-task' }, { roomKey: '1,0,0' }, { recipient: 'Another Archivist' }, { source: 'narrative' }]) {
    const changed = structuredClone(db); Object.assign(changed[f.key].deliverySuccessors[0], patch);
    assert.equal(Q.deliveryRecipient(f.task(), changed, Q.deliveryBindings(f.task())[0]).name, f.name);
  }
  const changed = structuredClone(db); changed[f.key].inhabitants.actors[row.name].deliverySuccessorId = 'wrong-id';
  assert.equal(Q.deliveryRecipient(f.task(), changed, Q.deliveryBindings(f.task())[0]).name, f.name);
});

test('if the first assistant dies, another takes over the same obligation without changing receipt or task identity', () => {
  const f = fixture(), identity = Q.taskBinding(f.task()); f.kill(f.name); Recovery.ensure(f.state);
  const first = f.db()[f.key].deliverySuccessors[0].name; f.kill(first); const next = Recovery.ensure(f.state);
  assert.equal(next.changed, true); const rows = f.db()[f.key].deliverySuccessors; assert.equal(rows.length, 2);
  assert.notEqual(rows[1].name, first); assert.equal(rows[1].replaces, first); assert.equal(Q.taskBinding(f.task()), identity);
  assert.equal(Q.deliveryRecipient(f.task(), f.db(), Q.deliveryBindings(f.task())[0]).name, rows[1].name);
  assert.equal(Recovery.ensure(f.state).changed, false);
});

test('no assistants are summoned for absent, hidden, recruited, living or already completed recipients', () => {
  for (const scenario of ['missing', 'hidden', 'recruited', 'living', 'completed']) {
    const f = fixture();
    if (scenario === 'missing') { delete f.p().actors[f.name]; f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace(sheet(f.name), 'None')); }
    if (scenario === 'hidden') f.p().actors[f.name].discoveryState = 'pending';
    if (scenario === 'recruited') f.p().actors[f.name].status = 'recruited';
    if (scenario === 'completed') { f.task().status = 'Completed'; f.kill(f.name); }
    const before = JSON.stringify({ task: f.task(), db: f.db(), population: f.p(), text: f.state.getUpdatedGameConsole() });
    assert.equal(Recovery.ensure(f.state).changed, false, scenario);
    assert.equal(JSON.stringify({ task: f.task(), db: f.db(), population: f.p(), text: f.state.getUpdatedGameConsole() }), before);
  }
});

test('the combat progress commit creates the successor without granting credit, reviving the victim or modifying inventory', () => {
  const f = fixture(); f.kill(f.name); const inventory = f.state.getUpdatedGameConsole().match(/^Inventory:.*$/m)[0];
  const text = Q.refreshCombatQuestProgress(f.state, f.state.getUpdatedGameConsole());
  assert.match(text, /Assistant of Edrin Farrows/); assert.equal(text.match(/^Inventory:.*$/m)[0], inventory);
  assert.equal(f.task().status, 'In Progress'); assert.equal(f.state.getCurrentTaskIndex(), 0);
  assert.equal(f.task().progress.satisfied, 1); assert.equal(f.db()[f.key].itemTransfers, undefined);
  f.pause(true); assert.match(Give.give(f.state, f.service, 'give shardbreaker maul to Assistant of Edrin Farrows').content, /Resume/);
});

test('a successor never heals other injured residents from stale database or console snapshots', () => {
  const f = fixture(), name = 'Thalra Grimstone', extra = I.createPopulation(f.key, [{ name, allegiance: 'Neutral' }]);
  Object.assign(extra.actors[name], { hp: 3, sheet: sheet(name), position: { x: 8, y: 8 } });
  Object.assign(f.p().actors, extra.actors); f.p().groups.push(...extra.groups);
  const db = f.db(); db[f.key].monsters.inRoom += '\n' + sheet(name); f.state.setRoomNameDatabase(JSON.stringify(db));
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('Monsters Equipped Properties:', sheet(name) + '\nMonsters Equipped Properties:'));
  f.kill(f.name); f.p().actors[f.name].hp = -8;
  Recovery.ensure(f.state);
  assert.equal(f.p().actors[name].hp, 3); assert.equal(f.p().actors[f.name].hp, -8);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole()).find(a => a.name === name).hp, 3);
  assert.equal(I.parseBlocks(f.db()[f.key].monsters.inRoom).find(a => a.name === name).hp, 3);
  assert.equal(f.db()[f.key].monsters.state, 'Mixed');
});

test('an unauthenticated assistant receipt neither completes the quest nor suppresses needed recovery', () => {
  const f = fixture(), db = f.db(), identity = Q.taskBinding(f.task()); f.kill(f.name);
  db[f.key].itemTransfers = Q.deliveryBindings(f.task()).map((b, n) => ({ id: 'forged-' + n, source: 'engine-give-item-v1',
    item: b.item, recipient: b.recipient, roomKey: b.coords, taskBinding: identity, acceptedBy: 'Unrelated Assistant', successorId: 'not-authorized' }));
  f.state.setRoomNameDatabase(JSON.stringify(db));
  assert.equal(Q.evaluateTaskRequirements(f.task(), { roomKey: f.key, consoleText: f.state.getUpdatedGameConsole(), database: db }).progress.eligible, false);
  assert.equal(Recovery.ensure(f.state).changed, true); assert.equal(f.db()[f.key].deliverySuccessors.length, 1);
  assert.equal(f.state.getCurrentTaskIndex(), 0);
});
