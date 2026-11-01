'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Equipment = require('../retort/combatEquipment'), E = require('../retort/economy'), I = require('../assets/dungeonInhabitants');
const { ActionDice } = require('../retort/actionDice'), { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
function fixture(acting = 'PC') {
  const geoKey = '1,0,0', row = Name => sheet({ Name, Class: 'Fighter', HP: 20, MaxHP: 20, AC: 10 });
  const item = { name: 'real spear', type: 'weapon', attack_modifier: 2, damage_modifier: 3, ac: 1, magic: 0 };
  let text = `Coordinates: X: 1, Y: 0, Z: 0\nInventory: real spear\nInventory Properties: ${JSON.stringify(item)}\nParty Equipped Properties: None\nPC:\n${row('PC')}\nNPCs in Party:\n${row('Ally')}\nMonsters in Room: None\nMonsters Equipped Properties: None\nRooms Visited: 2`;
  const roster = [...I.parseSheets(text, 'PC'), ...I.parseSheets(text, 'NPCs in Party')].map(a => ({ ...a, mazeX: 4, mazeY: 4, mazeRoomKey: geoKey }));
  let wire = JSON.stringify(roster), db = JSON.stringify({ '0,0,0': {}, [geoKey]: { name: 'Hall', objects: [] } }), paused = false, live = true;
  const d = { geoKey, start: { x: 4, y: 4 }, cells: {}, sceneObjects: [] };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) d.cells[x + ',' + y] = { tile: 'floor' };
  const state = { getDungeonRunId: () => 'run', getLastCoords: () => ({ x: 1, y: 0, z: 0 }), getGamePaused: () => paused,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v, getCombatCharactersString: () => wire, setCombatCharactersString: v => wire = v,
    getRoomNameDatabase: () => db, setRoomNameDatabase: v => db = v, getRoomDungeonForSimulation: () => d, getCurrentTasks: () => [] };
  const dice = new ActionDice(), actor = roster.find(a => a.name === acting); dice.begin('combat', geoKey);
  const turn = dice.active.turn = { turnId: 'turn', combatant: actor.name, movement: { remaining: 6, busy: false } };
  const attached = Equipment.attach({ dice, state, actor, turn, targets: [], roster, space: { roster }, live: () => live });
  const input = { runId: 'run', geoKey, actionId: dice.active.id, turnId: turn.turnId, combatant: actor.name, target: actor.name,
    kind: 'equip', item: item.name, nonce: 'equipment-test-one' };
  return { dice, state, actor, roster, turn, attached, input, pause: () => paused = true, closeChoice: () => live = false };
}
for (const actor of ['PC', 'Ally']) test(`current ${actor} equips before attacking without consuming movement, advancing time or duplicating items`, () => {
  const f = fixture(actor), before = { attack: f.actor.attack, damage: f.actor.damage }, position = f.roster.map(a => [a.mazeX, a.mazeY]);
  const result = f.dice.changeEquipment(f.input);
  assert.equal(result.turn.turnId, 'turn'); assert.equal(f.turn.movement.remaining, 6);
  assert.equal(f.actor.equipped.Weapon, 'real spear'); assert.equal(f.actor.attack, before.attack + 2); assert.equal(f.actor.damage, before.damage + 3);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  assert.equal(f.dice.changeEquipment(f.input).duplicate, true); assert.equal(f.actor.attack, before.attack + 2);
  assert.deepEqual(f.roster.map(a => [a.mazeX, a.mazeY]), position);
  assert.equal(JSON.parse(f.state.getRoomNameDatabase())['0,0,0'].combatLife?.clock || 0, 0);
  f.dice.changeEquipment({ ...f.input, kind: 'unequip', nonce: 'equipment-test-two' });
  assert.equal(f.actor.equipped.Weapon, 'None'); assert.equal(f.actor.attack, before.attack);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'real spear');
  f.attached.close(); assert.equal(f.dice.changeEquipment, undefined);
});
test('stale, foreign, paused, moving and already-rolling combat turns cannot change equipment', () => {
  for (const bad of ['runId', 'geoKey', 'actionId', 'turnId', 'combatant', 'target', 'kind', 'paused', 'moving', 'rolling', 'choice-committed']) {
    const f = fixture(), input = { ...f.input }, before = f.state.getUpdatedGameConsole();
    if (bad === 'paused') f.pause(); else if (bad === 'moving') f.turn.movement.busy = true;
    else if (bad === 'rolling') f.dice.pending = { request: { label: 'Attack' } };
    else if (bad === 'choice-committed') f.closeChoice(); else input[bad] = 'foreign';
    assert.throws(() => f.dice.changeEquipment(input), /only.*turn/); assert.equal(f.state.getUpdatedGameConsole(), before);
  }
});
test('combat end removes the equipment hook even after interrupted target selection', () => {
  const f = fixture(); f.dice.end(); assert.equal(f.dice.changeEquipment, undefined);
});
test('combat UI sends pinned equipment requests, preserves the target choice, and blocks rolls and other actors', async () => {
  const requests = [], applied = [], input = { value: 'equip real spear' }, turn = { equipment: { allowed: true }, combatant: 'PC', turnId: 'turn', actionId: 'action' };
  const root = { dungeonRunId: 'run', currentDungeon: { geoKey: '1,0,0' }, actionDiceState: { active: { kind: 'combat', id: 'action' } },
    applyRealtimeCombatResult: async r => applied.push(r) };
  const document = { body: null, addEventListener() {}, getElementById: () => input };
  vm.runInNewContext(fs.readFileSync('assets/combatTurnUi.js', 'utf8'), { window: root, document, fetch: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ runId: 'run', geoKey: '1,0,0', turn }) };
  } });
  root.CombatTurnUi.receive(turn);
  assert.equal(await root.CombatTurnUi.handleEquipmentCommand(input.value), true); assert.equal(input.value, '');
  assert.equal(requests[0].url, '/combat/equipment'); assert.equal(requests[0].body.turnId, 'turn'); assert.equal(requests[0].body.target, 'PC');
  assert.equal(applied.length, 1); assert.equal(root.CombatTurnUi.canChangeEquipment(), true);
  assert.equal(await root.CombatTurnUi.equipment('equip', 'real spear', 'Ally'), false);
  root.actionDiceState.pending = { id: 'roll' }; assert.equal(await root.CombatTurnUi.equipment('equip', 'real spear'), false);
  assert.equal(requests.length, 1);
  delete root.actionDiceState.pending;
  root._combatCommandPending = true; root.GameCommandGate = { busy: () => true };
  vm.runInNewContext(fs.readFileSync('assets/inventoryUi.js', 'utf8'), { window: root, document });
  root.InventoryUi.update({ inventory: 'another spear', inventoryProperties: JSON.stringify({ name: 'another spear', type: 'weapon' }) });
  assert.equal(root.InventoryUi.requestEquip('another spear', 'PC'), true, 'Inventory equipment bypasses only the owning combat task, not a pending roll.');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2); assert.equal(requests[1].body.item, 'another spear');
});
