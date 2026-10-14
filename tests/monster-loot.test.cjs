'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');
const GeneratedNames = require('../retort/generatedNames');
const { createPopulationService } = require('../retort/roomPopulation');
const Sync = require('../retort/monsterConsoleSync');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const lootSource = slice('function parseMonstersEquippedProperties(', 'async function tryDungeonDoorAction(');
const nameSource = slice('async function generateMonsterEquipmentName(', 'async function generateMonstersForRoomUsingGPT(');
const modifiers = '{"attack_modifier":2,"damage_modifier":2,"ac":0,"magic":3}';
const item = (name, type = 'weapon') => ({ name, type, attack_modifier: 2, damage_modifier: -1, ac: 0, magic: 3 });
const legacy = p => `{name: ${JSON.stringify(p.name)}, type: ${JSON.stringify(p.type)}, attack_modifier: ${p.attack_modifier}, damage_modifier: ${p.damage_modifier}, ac: ${p.ac}, magic: ${p.magic}}`;
function sheet(name, equipment) {
  return formatStartingCharacterSheet({ Name: name, Sex: 'Female', Race: 'Wraith', Class: 'Sentinel', Level: 1,
    AC: 10, HP: 0, MaxHP: 10 }).replace(/Equipped:[^\r\n]*/, 'Equipped: ' + equipment);
}
function fixture(equipment, properties, other = '') {
  const text = `Room Description: A Guard watches the ruins.\nObjects in Room: None\nObjects in Room Properties: None\nInventory: silver ring\nMonsters in Room:\n${sheet('Guard', equipment)}\n${other}\nMonsters Equipped Properties: ${properties}\nMonsters State: Dead\nExits: east`;
  const context = { updatedGameConsole: text, Inhabitants: I, console: { warn() {} } };
  vm.runInNewContext(lootSource, context);
  return context;
}

test('modifier objects, blank and numeric names are rejected before equipment assignment', () => {
  for (const value of [modifiers, JSON.parse(modifiers), '', 'None', '0', '2', '3}', '{"name":""}', '{"name":"magic: 3"}', undefined]) {
    assert.equal(I.equipmentName(value), null, String(value));
  }
  assert.equal(I.equipmentName('{"name":"emberfang glaive"}'), 'emberfang glaive');
  assert.equal(I.equipmentName('pilgrim\'s shield'), 'pilgrim\'s shield');
});

test('name generation uses its own schema and retries malformed model output at the source', async () => {
  const results = [modifiers, '{"name":""}', '{"name":"Emberfang Glaive"}'], requests = [];
  const assistant = () => {};
  assistant.generation = async options => { requests.push(options); return { content: results.shift() }; };
  const context = { Inhabitants: I, GeneratedNames, console: { warn() {} } };
  vm.runInNewContext(nameSource, context);
  assert.equal(await context.generateMonsterEquipmentName({ assistant }, 'weapon', 'Guard'), 'emberfang glaive');
  assert.equal(requests.length, 3);
  for (const options of requests) {
    assert.deepEqual(Object.keys(options.parameters), ['name']);
    assert.equal(options.parameters.name.name, 'String');
  }
  assert.equal((source.match(/await generateMonsterEquipmentName\(\$, objectType, monster.Name\)/g) || []).length, 2);
});

test('persistent bad equipment names cannot hang spawning', async () => {
  let requests = 0;
  const assistant = () => {};
  assistant.generation = async () => { requests++; return { content: modifiers }; };
  const context = { Inhabitants: I, GeneratedNames, console: { warn() {} } };
  vm.runInNewContext(nameSource, context);
  assert.equal(await context.generateMonsterEquipmentName({ assistant }, 'armor', 'Boss'), null);
  assert.equal(requests, 3);
});

test('client and combat parsers keep only four real slots and never split modifier JSON into items', () => {
  const line = `Equipped: Weapon: ${modifiers}, Armor: None, Shield: dawnshield, Other: whispering bone`;
  const expected = { Weapon: 'None', Armor: 'None', Shield: 'dawnshield', Other: 'whispering bone' };
  assert.deepEqual(I.parseEquipment(line), expected);
  const game = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  const context = { window: { DungeonInhabitants: I } };
  vm.runInNewContext(game.slice(game.indexOf('function parseEquippedItems('), game.indexOf('// Function to find item properties')), context);
  assert.deepEqual(context.parseEquippedItems(line), expected);
  assert.deepEqual(I.parseEquipment({ Weapon: 'glaive', magic: '3}', ac: '0' }), { ...expected, Weapon: 'glaive', Shield: 'None', Other: 'None' });
  assert.equal((source.match(/return Inhabitants.parseEquipment\(line\);/g) || []).length, 3);
});

for (const format of ['legacy', 'json']) test(`${format}: death drops actual equipped names with exact modifiers, never numbers or extra slots`, () => {
  const glaive = item('emberfang glaive'), ring = item('silver ring', 'other');
  const context = fixture('Weapon: emberfang glaive, Armor: None, Shield: None, Other: None',
    [glaive, ring, item('3}')].map(p => format === 'json' ? JSON.stringify(p) : legacy(p)).join(', '),
    sheet('Guard Captain', 'Weapon: None, Armor: None, Shield: None, Other: silver ring'));
  const captainBefore = I.parseSheets(context.updatedGameConsole).find(a => a.name === 'Guard Captain').sheet;
  const target = { name: 'Guard', equipped: { Weapon: 'emberfang glaive', Armor: 'None', Shield: 'None', Other: 'None', magic: '3}', ac: '0' } };
  context.dropMonsterItemsToRoom(target);
  assert.match(context.updatedGameConsole, /^Objects in Room: emberfang glaive$/m);
  assert.deepEqual(I.parseEquipmentProperties(context.updatedGameConsole.match(/^Objects in Room Properties: (.*)$/m)[1]), [glaive]);
  assert.match(context.updatedGameConsole, /^Inventory: silver ring$/m);
  assert.match(context.updatedGameConsole, /^Exits: east$/m);
  assert.equal(I.parseSheets(context.updatedGameConsole).find(a => a.name === 'Guard Captain').sheet, captainBefore);
  assert.deepEqual(Object.values(target.equipped), ['None', 'None', 'None', 'None']);
  const after = context.updatedGameConsole;
  context.dropMonsterItemsToRoom(target);
  assert.equal(context.updatedGameConsole, after);
});

test('unnameable equipment makes no loot and does not rewrite existing saved room data', () => {
  const context = fixture(`Weapon: ${modifiers}, Armor: None, Shield: None, Other: None`, legacy(item('', 'key')));
  const before = context.updatedGameConsole;
  context.dropMonsterItemsToRoom({ name: 'Guard', equipped: { Weapon: modifiers, magic: '3}', ac: '0' } });
  assert.equal(context.updatedGameConsole, before);
});

test('shared equipment metadata stays available for another monster carrying the same item', () => {
  const context = fixture('Weapon: glaive, Armor: None, Shield: None, Other: None', legacy(item('glaive')),
    sheet('Guard Captain', 'Weapon: glaive, Armor: None, Shield: None, Other: None'));
  context.dropMonsterItemsToRoom({ name: 'Guard', equipped: { Weapon: 'glaive' } });
  assert.deepEqual(I.parseEquipmentProperties(context.updatedGameConsole.match(/^Monsters Equipped Properties: (.*)$/m)[1]), [item('glaive')]);
  context.dropMonsterItemsToRoom({ name: 'Guard Captain', equipped: { Weapon: 'glaive' } });
  assert.match(context.updatedGameConsole, /^Monsters Equipped Properties: None$/m);
  assert.match(context.updatedGameConsole, /^Objects in Room: glaive$/m);
});

test('spawned gear properties survive population save and proximity omission, then drop with original modifiers', () => {
  const blade = item('guard blade'), captainBlade = item('captain blade');
  const guardSheet = sheet('Guard', 'Weapon: guard blade, Armor: None, Shield: None, Other: None').replace('HP: 0', 'HP: 10');
  const captainSheet = sheet('Guard Captain', 'Weapon: captain blade, Armor: None, Shield: None, Other: None').replace('HP: 0', 'HP: 10');
  let text = `Coordinates: X: 1, Y: 0, Z: 0\nObjects in Room: None\nObjects in Room Properties: None\nInventory: silver ring\nMonsters in Room:\n${guardSheet}\n${captainSheet}\nMonsters Equipped Properties: ${legacy(blade)}, ${legacy(captainBlade)}\nMonsters State: Hostile\nExits: east`;
  let db = JSON.stringify({ '1,0,0': { name: 'Court', objects: [], monsters: { inRoom: 'None', equippedProperties: 'None', state: 'None' } } });
  const population = I.createPopulation('1,0,0', [{ name: 'Guard', allegiance: 'Hostile' }, { name: 'Guard Captain', allegiance: 'Hostile' }]);
  population.initialSheets = guardSheet + '\n' + captainSheet;
  population.initialEquipmentProperties = population.equipmentProperties = `${legacy(blade)}, ${legacy(captainBlade)}`;
  const state = { getUpdatedGameConsole: () => text, setUpdatedGameConsole: value => { text = value; },
    getRoomNameDatabase: () => db, setRoomNameDatabase: value => { db = value; }, setRoomPopulation() {} };
  const service = createPopulationService(state);
  I.sync(population, I.parseSheets(text)); service.save(population);
  assert.deepEqual(I.parseEquipmentProperties(JSON.parse(db)['1,0,0'].monsters.equippedProperties), [blade, captainBlade]);
  text = I.perceivedConsole(text, []); service.save(population);
  assert.deepEqual(I.parseEquipmentProperties(JSON.parse(db)['1,0,0'].monsters.equippedProperties), [blade, captainBlade]);
  text = Sync.syncConsole(text, JSON.parse(db)['1,0,0'].monsters).consoleText;
  const context = { updatedGameConsole: text, Inhabitants: I, sharedState: state, console: { warn() {} } };
  vm.runInNewContext(lootSource, context);
  context.updatedGameConsole = context.updatedGameConsole.replace(/(Guard\n[\s\S]*?HP:) 10/, '$1 0');
  context.dropMonsterItemsToRoom({ name: 'Guard', hp: 0, equipped: { Weapon: 'guard blade' } });
  text = context.updatedGameConsole;
  I.sync(population, I.parseSheets(text)); service.save(population);
  assert.match(text, /^Objects in Room: guard blade$/m);
  assert.deepEqual(I.parseEquipmentProperties(text.match(/^Objects in Room Properties: (.*)$/m)[1]), [blade]);
  assert.deepEqual(I.parseEquipmentProperties(JSON.parse(db)['1,0,0'].monsters.equippedProperties), [captainBlade]);
  assert.equal(JSON.parse(db)['1,0,0'].objects[0].properties.damage, blade.damage_modifier);
  const revisited = Sync.syncConsole(text, JSON.parse(db)['1,0,0'].monsters).consoleText;
  assert.equal(I.parseEquipment(I.parseSheets(revisited).find(a => a.name === 'Guard').lines[9]).Weapon, 'None');
  assert.equal(I.parseEquipment(I.parseSheets(revisited).find(a => a.name === 'Guard Captain').lines[9]).Weapon, 'captain blade');
  assert.match(revisited, /^Inventory: silver ring$/m);
});

test('final room-population snapshot carries generated sheets and modifiers instead of its earlier None defaults', () => {
  const begin = source.indexOf('    // Keep freshly generated sheets and modifiers together'), end = source.indexOf('    persistRoomDb(roomNameDatabasePlain);', begin);
  const blade = item('guard blade'), sheets = sheet('Guard', 'Weapon: guard blade, Armor: None, Shield: None, Other: None');
  const context = { Economy: require('../retort/economy'), currentRoomData: { monsters: { inRoom: 'None', equippedProperties: 'None' } }, monstersInRoom: sheets, coordKey: '1,0,0',
    updatedGameConsole: `Monsters Equipped Properties: ${legacy(blade)}\nMonsters State: Hostile`, sharedState: { getRoomPopulation: () => ({ equipmentProperties: legacy(blade) }) } };
  vm.runInNewContext(source.slice(begin, end), context);
  assert.equal(context.currentRoomData.monsters.inRoom, sheets);
  assert.deepEqual(I.parseEquipmentProperties(context.currentRoomData.monsters.equippedProperties), [blade]);
  assert.equal(context.currentRoomData.populationComplete, true);
});
