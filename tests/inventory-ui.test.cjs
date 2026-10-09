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

test('slot occupancy reads the original text sheet for all four slots', () => {
  const sheet = 'Mortacia\nEquipped: Weapon: bronze sword, Armor: moon robe, Shield: None, Other: red ring\nMagic: 2';
  assert.equal(Inventory.equippedName(sheet, 'weapon'), 'bronze sword');
  assert.equal(Inventory.equippedName(sheet, 'armor'), 'moon robe');
  assert.equal(Inventory.equippedName(sheet, 'shield'), null);
  assert.equal(Inventory.equippedName(sheet, 'other'), 'red ring');
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
