'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Inhabitants = require('../assets/dungeonInhabitants');
const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
const prune = source.slice(source.indexOf('async function pruneAndDedupeRoomObjectsOnEntry('), source.indexOf('// --- ROOM ENSURER'));
const sync = source.slice(source.indexOf('async function syncObjectsOnRoomEntry('), source.indexOf('function hasHostileMonsters('));
const keyName = "cairnwarden's ward key";
const key = { name: keyName, type: 'key', properties: { attack: 0, damage: 0, ac: 1, magic: 2 } };
const props = name => `{name: "${name}", type: "key", attack_modifier: 0, damage_modifier: 0, ac: 1, magic: 2}`;
test('actual key-placement sync replaces None with the key name, not None plus a key', async () => {
  const start = source.indexOf('async function syncKeysOnRoomEntry('), end = source.indexOf('async function syncMonstersOnRoomEntry(', start);
  assert.ok(end > start);
  const db = { '0,0,0': { objects: [{ ...key, unlocks: { coordinates: '-1,-1,0', direction: 'south' } }] } };
  const context = { coordinatesToString: () => '0,0,0', getRoomSafe: (db, k) => db[k], setRoomSafe() {}, ensureAllRoomsClassified() {} };
  vm.runInNewContext(source.slice(start, end), context);
  const text = 'Objects in Room: None\nObjects in Room Properties: None\nInventory: Empty\nExits: south';
  const value = await context.syncKeysOnRoomEntry({}, {}, db, text);
  assert.equal(value, `Objects in Room: ${keyName}\nObjects in Room Properties: ${props(keyName)}\nInventory: Empty\nExits: south`);
  assert.equal(await context.syncKeysOnRoomEntry({}, {}, db, value), value, 'A repeat sync cannot duplicate the key or restore None');
});
for (const eol of ['\n', '\r\n']) {
  for (const names of [keyName, `None, ${keyName}`, `${keyName}, silver ring`]) {
    test(`collected key pruning cannot erase inventory/sheet/prose names or join fields (${JSON.stringify(eol)}, ${names})`, async () => {
      const text = [`Room Description: Bring ${keyName} back to the temple.`, `Objects in Room: ${names}`,
        `Objects in Room Properties: ${props(keyName)}, ${props('silver ring')}`, 'Exits: east',
        `Inventory: ${keyName}, emberfang glaive`, `Inventory Properties: ${props(keyName)}`,
        `Equipped: Weapon: None, Armor: None, Shield: None, Other: ${keyName}`].join(eol);
      const db = { '0,0,0': { objects: [{ ...key }] } };
      const context = { Inhabitants, sharedState: { setRoomNameDatabase() {} }, canonicalObjectSignature: JSON.stringify,
        generateObjectModifiers() { throw Error('Already generated modifiers must not be changed'); } };
      vm.runInNewContext(prune, context);
      const value = await context.pruneAndDedupeRoomObjectsOnEntry({}, '0,0,0', db, text);
      assert.equal(value.split(eol).length, text.split(eol).length);
      assert.match(value, new RegExp(`^Objects in Room: ${names.includes('silver ring') ? 'silver ring' : 'None'}\r?$`, 'm'));
      assert.match(value, /^Objects in Room Properties: \{name: "silver ring"/m);
      assert.equal(value.split(eol).filter(line => !/^Objects in Room(?: Properties)?:/.test(line)).join(eol),
        text.split(eol).filter(line => !/^Objects in Room(?: Properties)?:/.test(line)).join(eol));
      assert.equal(db['0,0,0'].objects.length, 0);
    });
  }
  test(`empty room field stays empty, not the following property header (${JSON.stringify(eol)})`, async () => {
    const text = ['Room Name: Temple', 'Objects in Room: ', 'Objects in Room Properties: None',
      'Inventory: Empty', 'Exits: east'].join(eol);
    const context = { getRoomSafe: (db, k) => db[k], coordinatesToString: () => '0,0,0', ensureAllRoomsClassified() {} };
    vm.runInNewContext(sync, context);
    const value = await context.syncObjectsOnRoomEntry({}, {}, { '0,0,0': { objects: [] } }, text);
    assert.equal(value, text.replace('Objects in Room: ', 'Objects in Room: None'));
  });
}
