'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
const functions = source.slice(source.indexOf('function equipItem('), source.indexOf('function rollDice(', source.indexOf('function equipItem(')));
const character = Name => ({ Name, Attack: 5, Damage: 6, Armor: 1, Magic: 2,
  Equipped: { Weapon: 'None', Armor: 'None', Shield: 'None', Other: 'None' } });

for (const [type, slot] of [['weapon', 'Weapon'], ['armor', 'Armor'], ['shield', 'Shield'], ['other', 'Other']]) {
  for (const npcTarget of [false, true]) {
    test(`${slot} replacement on ${npcTarget ? 'NPC' : 'PC'} requires Unequip before Equip and never stacks modifiers`, () => {
      const pc = character('Mortacia'), npc = character('Zarthul');
      const old = { name: `old ${type}`, type, attack_modifier: 1, damage_modifier: 2, ac: 3, magic: 4 };
      const next = { name: `new ${type}`, type, attack_modifier: 7, damage_modifier: 8, ac: 9, magic: 10 };
      const requests = [], context = { characters: [pc], npcs: [npc], inventory: [old.name, next.name], inventoryProperties: [JSON.stringify(old), JSON.stringify(next)],
        window: { InventoryUi: { requestEquip: (...args) => requests.push(args) } }, console: { log() {} } };
      vm.runInNewContext(functions, context);
      const target = npcTarget ? npc : pc, targetName = npcTarget ? npc.Name : null;
      assert.match(context.equipItem(old.name, targetName), /has been equipped/);
      assert.deepEqual([target.Attack, target.Damage, target.Armor, target.Magic], [6, 8, 4, 6]);
      const before = JSON.stringify([target, context.inventory, context.inventoryProperties]);
      for (let i = 0; i < 10; i++) assert.match(context.equipItem(next.name, targetName), /Unequip old/);
      assert.equal(JSON.stringify([target, context.inventory, context.inventoryProperties]), before);
      assert.equal(requests[0][0], next.name); assert.equal(requests[0][1], target.Name);
      assert.match(context.unequipItem(old.name, targetName), /has been unequipped/);
      assert.deepEqual([target.Attack, target.Damage, target.Armor, target.Magic], [5, 6, 1, 2]);
      assert.equal(context.inventory.filter(name => name === old.name).length, 1);
      assert.match(context.equipItem(next.name, targetName), /has been equipped/);
      assert.deepEqual([target.Attack, target.Damage, target.Armor, target.Magic], [12, 14, 10, 12]);
      assert.equal(target.Equipped[slot].name, next.name);
      assert.deepEqual([npcTarget ? pc.Attack : npc.Attack, npcTarget ? pc.Magic : npc.Magic], [5, 2]);
      for (let i = 0; i < 5; i++) {
        context.unequipItem(next.name, targetName); context.equipItem(old.name, targetName);
        context.unequipItem(old.name, targetName); context.equipItem(next.name, targetName);
      }
      assert.deepEqual([target.Attack, target.Damage, target.Armor, target.Magic], [12, 14, 10, 12]);
      assert.equal(context.inventory.length, 1); assert.equal(context.inventoryProperties.length, 1);
    });
  }
}

test('missing inventory metadata cannot unequip or replace a current slot', () => {
  const pc = character('Mortacia'); pc.Equipped.Weapon = { name: 'old blade', type: 'weapon' };
  const context = { characters: [pc], npcs: [], inventory: ['new blade'], inventoryProperties: [], window: {}, console: { log() {} } };
  vm.runInNewContext(functions, context);
  assert.match(context.equipItem('new blade'), /cannot be equipped/);
  assert.equal(pc.Equipped.Weapon.name, 'old blade');
  assert.equal(pc.Attack, 5);
});

test('full NPC names select the intended recipient even when another name shares its prefix', () => {
  const npc = character('John'), other = character('John the Grey');
  const item = { name: 'silver blade', type: 'weapon', attack_modifier: 1, damage_modifier: 2, ac: 0, magic: 0 };
  const context = { characters: [character('Mortacia')], npcs: [npc, other], inventory: [item.name], inventoryProperties: [JSON.stringify(item)], window: {}, console: { log() {} } };
  vm.runInNewContext(functions, context);
  assert.match(context.equipItem(item.name, 'John'), /has been equipped/);
  assert.equal(npc.Equipped.Weapon.name, item.name); assert.equal(other.Equipped.Weapon, 'None');
  assert.match(context.unequipItem(item.name, 'John'), /has been unequipped/);
  assert.equal(npc.Attack, 5); assert.equal(other.Attack, 5);
});
