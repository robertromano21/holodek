'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');
const Sync = require('../retort/monsterConsoleSync');
const { createPopulationService } = require('../retort/roomPopulation');
const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
const sheet = (name, hp = 20, state = 'Hostile', eol = '\n') => [name, '      Female', '      Wraith', '      Sentinel',
  '      Level: 2', '      AC: 10', '      XP: 2000', `      HP: ${hp}`, '      MaxHP: 20',
  '      Equipped: Weapon: $& blade, Armor: None, Shield: None, Other: None', '      Attack: 1',
  '      Damage: 2', '      Armor: 0', '      Magic: 3', `      State: ${state}`].join(eol);
const consoleFor = (block, eol = '\n', inline = false) => ['Room Name: Flats', 'Coordinates: X: 1, Y: 0, Z: 0',
  'Objects in Room: key', 'Inventory: silver ring', 'PC: None', 'NPCs in Party: None',
  'Monsters in Room:' + (inline ? ' ' : eol) + block, 'Monsters Equipped Properties: None',
  'Monsters State: Mixed', 'Rooms Visited: 2', 'Puzzle in Room: Speak the oath.'].join(eol);

for (const eol of ['\n', '\r\n']) for (const inline of [false, true]) {
  test(`whole-section monster sync is stable across repeated DB feedback (${JSON.stringify(eol)}, inline=${inline})`, async () => {
    const block = sheet('Guard', 20, 'Hostile', eol) + eol + sheet('Watcher', 10, 'Neutral', eol);
    let text = consoleFor(block, eol, inline);
    const db = { '1,0,0': { name: 'Flats', monsters: { inRoom: block, equippedProperties: 'None', state: 'Mixed', custom: 'keep' } } };
    const context = { MonsterConsoleSync: Sync, coordinatesToString: () => '1,0,0',
      getRoomSafe: (db, key) => db[key], setRoomSafe: (db, key, value) => { db[key] = value; }, ensureAllRoomsClassified() {} };
    const first = source.indexOf('async function syncMonstersOnRoomEntry(');
    vm.runInNewContext(source.slice(first, source.indexOf('// Drop-in replacement for syncObjectsOnRoomEntry.', first)), context);
    for (let n = 0; n < 40; n++) {
      const next = await context.syncMonstersOnRoomEntry({}, {}, db, text);
      assert.equal(next, text);
      assert.equal(I.parseSheets(next).length, 2);
      assert.equal(db['1,0,0'].monsters.custom, 'keep');
      db['1,0,0'].monsters.inRoom = next.match(I.sectionPattern('Monsters in Room'))[2].trim();
      text = next;
    }
    assert.equal(I.parseSheets(text).map(a => a.sheet).join(eol).replace(/\n/g, eol),
      I.parseSheets(consoleFor(block, eol, inline)).map(a => a.sheet).join(eol).replace(/\n/g, eol));
  });
}

test('729 duplicated casts collapse to unique sheets before prompting, without deleting other console fields', () => {
  const rows = Array.from({ length: 16 }, (_, i) => sheet(`Soul ${i}`));
  const inflated = rows[0] + '\n' + Array(729).fill(rows.slice(1).join('\n')).join('\n');
  const text = consoleFor(inflated), repaired = Sync.dedupeConsole(text);
  assert.equal(I.parseSheets(text).length, 10936);
  assert.equal(I.parseSheets(repaired).length, 16);
  assert.ok(repaired.length < 9000);
  assert.equal(Sync.dedupeConsole(repaired), repaired);
  assert.equal(repaired.split('Monsters in Room:')[0], text.split('Monsters in Room:')[0]);
  assert.equal(repaired.split('Monsters Equipped Properties:')[1], text.split('Monsters Equipped Properties:')[1]);
  const result = Sync.syncConsole(text, { inRoom: inflated, state: 'Mixed', equippedProperties: 'None' });
  assert.equal(I.parseBlocks(result.monsters.inRoom).length, 16);
  assert.equal(result.monsters.consoleBlock, result.monsters.inRoom);
});

test('a duplicate stale sheet cannot overwrite the first current HP, equipment or individual state', () => {
  const current = sheet('Guard', 0, 'Dead'), stale = sheet('Guard', 20, 'Hostile');
  const repaired = Sync.uniqueMonsterBlock(`${current}\n${sheet('Mason', 10, 'Neutral')}\n${stale}`);
  assert.ok(repaired.startsWith(current));
  assert.equal(I.parseBlocks(repaired)[0].hp, 0);
  assert.equal(I.parseBlocks(repaired)[0].state, 'Dead');
  assert.deepEqual(I.parseBlocks(repaired).map(a => a.name), ['Guard', 'Mason']);
});

test('legacy names-only DB blocks use their full saved sheets; explicit None clears the complete section', () => {
  const block = sheet('Guard');
  const legacy = Sync.syncConsole(consoleFor('None'), { inRoom: 'Guard', consoleBlock: `Monsters in Room:\n${block}\nMonsters State: Hostile`, state: 'Hostile' });
  assert.equal(I.parseSheets(legacy.consoleText).length, 1);
  const empty = Sync.syncConsole(legacy.consoleText, { inRoom: 'None', consoleBlock: block, state: 'None', equippedProperties: 'None' });
  assert.equal(I.parseSheets(empty.consoleText).length, 0);
  assert.doesNotMatch(empty.consoleText, /Guard/);
  assert.equal(empty.monsters.inRoom, 'None');
});

test('missing room metadata leaves the current legitimate sheets unchanged', () => {
  const text = consoleFor(sheet('Guard'));
  assert.equal(Sync.syncConsole(text).consoleText, text);
});

test('population persistence cannot save duplicated console sheets back into room storage', () => {
  const block = Array(12).fill(sheet('Guard')).join('\n');
  let text = consoleFor(block), db = '{}';
  const population = I.createPopulation('1,0,0', [{ name: 'Guard', allegiance: 'Hostile' }]);
  const service = createPopulationService({ getUpdatedGameConsole: () => text, setUpdatedGameConsole: value => { text = value; },
    getRoomNameDatabase: () => db, setRoomNameDatabase: value => { db = value; }, setRoomPopulation() {} });
  service.save(population);
  assert.equal(I.parseSheets(text).length, 1);
  assert.equal(I.parseBlocks(JSON.parse(db)['1,0,0'].monsters.inRoom).length, 1);
});

test('actual regular spawning replaces old multiline inhabitants rather than leaving them under the new cast', () => {
  const first = source.indexOf('    // Update the game console with new monsters and their equipped properties');
  const context = { MonsterConsoleSync: Sync, updatedGameConsole: consoleFor(sheet('Old Guard') + '\n' + sheet('Old Mason')),
    monstersInRoomString: sheet('New Guard'), monstersEquippedPropertiesString: 'None', monstersState: 'Hostile' };
  vm.runInNewContext(source.slice(first, source.indexOf('\n}', first)), context);
  assert.deepEqual(I.parseSheets(context.updatedGameConsole).map(a => a.name), ['New Guard']);
});

test('actual boss insertion retains complete existing sheets and cannot duplicate the boss on repeats', () => {
  const first = source.indexOf('    // Update Monsters in Room in game console', source.indexOf('async function generateBossMonster('));
  const code = source.slice(first, source.indexOf('    console.log("Updated game console after generating boss:', first));
  let text = consoleFor(sheet('Guard') + '\n' + sheet('Mason', 10, 'Neutral'));
  for (let n = 0; n < 10; n++) {
    const context = { MonsterConsoleSync: Sync, Inhabitants: I, updatedGameConsole: text,
      bossDetailsString: sheet('Bound Boss'), monstersEquippedProperties: [] };
    vm.runInNewContext(code, context); text = context.updatedGameConsole;
    assert.deepEqual(I.parseSheets(text).map(a => a.name), ['Bound Boss', 'Guard', 'Mason']);
    assert.equal(I.parseSheets(text).find(a => a.name === 'Mason').state, 'Neutral');
    assert.match(text, /^Inventory: silver ring$/m);
  }
  assert.doesNotMatch(source, /replace\(\/Monsters in Room: \.\*\//);
});
