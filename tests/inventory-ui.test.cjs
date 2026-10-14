'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Inventory = require('../assets/inventoryUi');
const Pickup = require('../assets/itemInteractionUi');

test('inventory is read-only, grouped by existing declared type, alphabetized and counted', () => {
  const names = ['zinc blade', 'amber sword', 'moon robe', 'round shield', 'brass key', 'amber sword', 'Empty'];
  const props = '{name: "zinc blade", type: "weapon", attack_modifier: 3}, {name: "amber sword", type: "weapon", magic: 2}, ' +
    '{name: "moon robe", type: "armor"}, {name: "round shield", type: "shield"}, {name: "brass key", type: "key"}';
  const original = names.slice();
  const result = Inventory.inventoryItems(names, props);
  assert.deepEqual(result.map(item => item.name), ['amber sword', 'brass key', 'moon robe', 'round shield', 'zinc blade']);
  assert.deepEqual(result.map(item => item.type), ['weapon', 'other', 'armor', 'shield', 'weapon']);
  assert.equal(result[0].quantity, 2); assert.equal(result[0].magic, 2);
  assert.deepEqual(names, original);
  assert.deepEqual(Inventory.inventoryItems('Empty', 'None'), []);
  assert.deepEqual(Inventory.inventoryItems('None', 'None'), []);
});

test('inventory metadata reads JSON and existing object-literal text without executing it', () => {
  assert.equal(Inventory.parseProperties('{"name":"silver sword","type":"weapon","magic":4}')[0].magic, 4);
  assert.equal(Inventory.parseProperties('{name: "silver sword", type: "weapon", magic: 4}')[0].magic, 4);
  const original = { name: 'bone shield', type: 'shield' };
  const parsed = Inventory.parseProperties([original]); parsed[0].name = 'changed';
  assert.equal(original.name, 'bone shield');
  globalThis.inventoryUnsafeEvaluated = false;
  Inventory.parseProperties('{name: "cursed orb", magic: (globalThis.inventoryUnsafeEvaluated = true)}');
  assert.equal(globalThis.inventoryUnsafeEvaluated, false);
  delete globalThis.inventoryUnsafeEvaluated;
});

test('legacy capitalized equipment types still use their correct inventory categories', () => {
  const rows = ['Weapon', 'Armor', 'Shield', 'Other'].map(type => ({ name: type + ' item', type }));
  const items = Inventory.inventoryItems(rows.map(r => r.name), rows);
  for (const item of items) assert.equal(item.type, item.name.split(' ')[0].toLowerCase());
});

test('server result hydration updates the actual equip-command arrays, including duplicate and empty inventories', () => {
  const source = fs.readFileSync('assets/game.js', 'utf8');
  const start = source.indexOf('window.applySpellEquipment = text => {'), end = source.indexOf('window.getEconomyResidentInfo', start);
  const context = { window: { DungeonInhabitants: require('../assets/dungeonInhabitants'), InventoryUi: Inventory },
    currentDungeon: { geoKey: '0,0,0' }, characters: [], npcs: [], monstersInVisitedRooms: new Map(),
    inventory: ['stale loot'], inventoryProperties: ['stale metadata'] };
  vm.runInNewContext(source.slice(start, end), context);
  const item = { name: 'veilbreaker aegis', type: 'shield', magic: 3, ac: 2 };
  context.window.applySpellEquipment(`Inventory: ${item.name}, ${item.name}\nInventory Properties: ${JSON.stringify(item)}`);
  assert.deepEqual(Array.from(context.inventory), [item.name, item.name]);
  assert.deepEqual(Array.from(context.window.inventory), [item.name, item.name]);
  assert.equal(JSON.parse(context.inventoryProperties[0]).ac, 2);
  context.window.applySpellEquipment('Inventory: Empty\nInventory Properties: None');
  assert.equal(context.inventory.length, 0); assert.equal(context.inventoryProperties.length, 0); assert.equal(context.window.inventory.length, 0);
});

test('slot occupancy reads the original text sheet for all four slots', () => {
  const sheet = 'Mortacia\nEquipped: Weapon: bronze sword, Armor: moon robe, Shield: None, Other: red ring\nMagic: 2';
  assert.equal(Inventory.equippedName(sheet, 'weapon'), 'bronze sword');
  assert.equal(Inventory.equippedName(sheet, 'armor'), 'moon robe');
  assert.equal(Inventory.equippedName(sheet, 'shield'), null);
  assert.equal(Inventory.equippedName(sheet, 'other'), 'red ring');
});

test('item purposes use stored descriptions and explain combat and readable roles without inventing powers', () => {
  assert.equal(Inventory.describeItem({ name: 'ritual bowl', purpose: 'A vessel used for offerings.' }), 'A vessel used for offerings.');
  for (const type of ['weapon', 'armor', 'shield']) assert.match(Inventory.describeItem({ name: 'old gear', type }), /Equip/);
  const readable = { title: 'History of the Pale Court', backstory: 'Kept by the ancient archivist.' };
  assert.match(Inventory.describeItem({ name: 'chronicle' }, readable), /ancient archivist/);
  assert.match(Inventory.describeItem({ name: 'old grimoire', type: 'other' }), /does not cast or teach/);
  assert.match(Inventory.describeItem({ name: 'old scroll', type: 'other' }), /stored text/);
  assert.match(Inventory.describeItem({ name: 'historical map', type: 'other' }), /not a guarantee/);
});

function ground() {
  const dungeon = { geoKey: '0,0,0', cells: {} };
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0 };
  return dungeon;
}
test('3D pickup requires contact and an unobstructed same-height route, not a distant/foreign item', () => {
  const dungeon = ground(), player = { x: 2.7, y: 2.5 }, item = { name: 'bronze sword', x: 2, y: 2 };
  assert.equal(Pickup.nearby(dungeon, [item], player), item);
  assert.equal(Pickup.nearby(dungeon, [item], { x: 1, y: 1 }), null);
  assert.equal(Pickup.nearby(dungeon, [{ ...item, roomKey: '1,0,0' }], player), null);
  dungeon.cells['2,2'].floorHeight = 3;
  assert.equal(Pickup.nearby(dungeon, [item], { x: 1.9, y: 2.5 }), null);
});
test('closed doors and walls prevent pickup through them', () => {
  const dungeon = ground(), player = { x: 1.9, y: 2.5 }, item = { name: 'bronze sword', x: 2, y: 2 };
  dungeon.cells['2,2'] = { tile: 'door', door: { isOpen: false } };
  assert.equal(Pickup.nearby(dungeon, [item], player), null);
  dungeon.cells['2,2'].door.isOpen = true;
  assert.equal(Pickup.nearby(dungeon, [item], player), item);
  dungeon.cells['2,2'].tile = 'wall';
  assert.equal(Pickup.nearby(dungeon, [item], player), null);
});

test('walk-over confirmation reaches beyond one tile in every direction and stays local', () => {
  const dungeon = ground(), item = { name: 'bronze sword', x: 2, y: 2 };
  assert.equal(Pickup.PROXIMITY_RANGE, 1.25);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    assert.equal(Pickup.nearby(dungeon, [item], { x: 2.5 + Math.cos(angle) * 1.2, y: 2.5 + Math.sin(angle) * 1.2 }), item);
    assert.equal(Pickup.nearby(dungeon, [item], { x: 2.5 + Math.cos(angle) * 1.3, y: 2.5 + Math.sin(angle) * 1.3 }), null);
  }
});

test('click and drag pickup reach extends to 2.5 tiles without widening automatic proximity prompts', () => {
  const dungeon = ground(), item = { name: 'bronze sword', x: 3, y: 2 }, player = { x: 1, y: 2.5 };
  assert.equal(Pickup.TAKE_RANGE, 2.5);
  assert.equal(Pickup.reachable(dungeon, player, item), true);
  assert.equal(Pickup.reachable(dungeon, { x: .99, y: 2.5 }, item), false);
  assert.equal(Pickup.nearby(dungeon, [item], player), null, 'Walking by should not open distant confirmation popups.');
  assert.equal(Pickup.reachable(dungeon, player, { ...item, geoKey: '1,0,0' }), false);
  dungeon.cells['2,2'].tile = 'wall';
  assert.equal(Pickup.reachable(dungeon, player, item), false);
  dungeon.cells['2,2'] = { tile: 'door', door: { isOpen: false } };
  assert.equal(Pickup.reachable(dungeon, player, item), false);
  dungeon.cells['2,2'].door.isOpen = true;
  assert.equal(Pickup.reachable(dungeon, player, item), true);
});

test('pickup proximity reuses Take confirmation once, does not take automatically, and rearms after leaving', () => {
  const source = fs.readFileSync(require.resolve('../assets/itemInteractionUi'), 'utf8');
  let popup = null, clicks = 0;
  const link = { getAttribute: () => 'bronze sword', click() { clicks++; popup = { dataset: {}, remove() { popup = null; } }; } };
  const context = { window: {}, document: { hidden: false, activeElement: null,
    querySelector: selector => selector.includes('data-dungeon-item-proximity') ? popup?.dataset.dungeonItemProximity ? popup : null : popup,
    querySelectorAll: () => [link] } };
  vm.runInNewContext(source, context);
  const dungeon = ground(), item = { name: 'bronze sword', x: 2, y: 2 }, player = { x: 2.5, y: 2.5 };
  context.window.ItemInteractionUi.update(dungeon, [item], player);
  assert.equal(clicks, 1); popup.remove();
  context.window.ItemInteractionUi.update(dungeon, [item], player);
  assert.equal(clicks, 1, 'Cancel must not immediately reopen the prompt');
  context.window.ItemInteractionUi.update(dungeon, [item], { x: 0.5, y: 0.5 });
  context.window.ItemInteractionUi.update(dungeon, [item], player);
  assert.equal(clicks, 2);
  context.window._combatCommandPending = true; popup.remove(); context.window.ItemInteractionUi.reset();
  context.window.ItemInteractionUi.update(dungeon, [item], player);
  assert.equal(clicks, 2, 'Pending combat cannot be interrupted');
});

test('new inventory and pickup modules load before game.js, leaving original commands and popups in place', () => {
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
  for (const name of ['inventoryUi', 'itemInteractionUi']) assert.ok(html.indexOf(`/assets/${name}.js`) < html.indexOf('/assets/game.js'));
  const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  assert.match(source, /chatInput\.value = `equip \$\{objectName\} to \$\{selectedCharacter\}`/);
  assert.match(source, /chatInput\.value = `unequip \$\{itemName\} from \$\{characterName\}`/);
  assert.match(source, /chatInput\.value = `take \$\{objectName\}`/);
});
