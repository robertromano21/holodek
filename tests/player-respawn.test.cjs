'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Life = require('../retort/combatLife'), R = require('../retort/playerRespawn');
const I = require('../assets/dungeonInhabitants'), Profiles = require('../assets/characterProfiles');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
function fixture() {
  const origin = '4,2,1', entry = origin;
  const make = geoKey => { const d = { geoKey, start: { x: 2, y: 2 }, cells: {} }; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) d.cells[`${x},${y}`] = { tile: 'floor', ceilHeight: 4 }; return d; };
  const dungeons = { [entry]: make(entry), [origin]: make(origin) };
  const profile = Profiles.create({ name: 'Ally', personality: 'Patient.', voice: 'Warm.', history: 'Shared the old bridge crossing.', motivation: 'Protect the party.' });
  let text = 'Coordinates: X: 4, Y: 2, Z: 1\nRoom Name: Far Hall\nRoom Description: A quiet hall.\nInventory: bronze token\nInventory Properties: None\nPC:\n' +
    sheet({ Name: 'Hero', Class: 'Fighter', HP: 10, MaxHP: 20 }) + '\nNPCs in Party:\n' + sheet({ Name: 'Ally', Class: 'Fighter', HP: 10, MaxHP: 20 }) +
    '\nMonsters in Room: None\nMonsters Equipped Properties: None\nMonsters State: None\n';
  const population = I.createPopulation(origin, []); population.companions = { Ally: { profile, memory: { notes: ['Remember the bridge.'], profile }, dialogue: ['We crossed that bridge together.'] } };
  let database = JSON.stringify({ '0,0,0': { name: 'Ground entrance' }, [entry]: { name: 'Upper landing', visited: true, exits: {}, objects: [] }, [origin]: { name: 'Far Hall', visited: true, exits: {}, inhabitants: population, objects: [] } });
  let wire = JSON.stringify([{ name: 'Hero', type: 'pc', hp: 10, maxHp: 20, mazeX: 4, mazeY: 4, mazeRoomKey: origin },
    { name: 'Ally', type: 'npc', hp: 10, maxHp: 20, mazeX: 5, mazeY: 4, mazeRoomKey: origin, originProfile: profile, sprite: { dataUrl: 'saved' } }]);
  let at = { x: 4, y: 2, z: 1 };
  const state = { emitter: new EventEmitter(), getDungeonRunId: () => 'run', getGamePaused: () => false,
    getLastCoords: () => at, setLastCoords: v => at = v, getRoomNameDatabase: () => database, setRoomNameDatabase: v => database = v,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getCombatCharactersString: () => wire, setCombatCharactersString: v => wire = v,
    getRoomDungeon: c => dungeons[`${c.x},${c.y},${c.z}`], getRoomDungeonForSimulation: c => dungeons[`${c.x},${c.y},${c.z}`],
    setRoomDungeon: (c, d) => dungeons[`${c.x},${c.y},${c.z}`] = d };
  return { state, profile, entry, origin, dungeons,
    injure(name, natural = 1) { const db = JSON.parse(database), actor = Life.actors(text).find(a => a.name === name); Life.apply(db, 'run', actor, 0, natural, { damage: 10, geoKey: origin }); Life.commit(state, db); },
    db: () => JSON.parse(database) };
}
test('confirmed death consumes a life immediately and returns the player alone to this level, preserving companions and memories', () => {
  const f = fixture(); f.injure('Hero'); f.injure('Hero');
  assert.equal(Life.status(f.state).rescuesUsed, 1); assert.equal(Life.status(f.state).pendingRespawn, true);
  const event = R.complete(f.state);
  assert.equal(event.geoKey, f.entry); assert.equal(event.fromKey, f.origin);
  assert.equal(I.parseSheets(event.updatedGameConsole, 'NPCs in Party').length, 0);
  assert.equal(I.parseSheets(event.updatedGameConsole, 'PC')[0].hp, 10);
  assert.match(event.updatedGameConsole, /Inventory: Empty/);
  assert.ok(f.db()[f.origin].objects.some(o => o.name === 'bronze token'));
  assert.deepEqual(f.state.getLastCoords(), { x: 4, y: 2, z: 1 });
  const ally = f.db()[f.origin].inhabitants.actors.Ally;
  assert.equal(ally.status, 'present'); assert.equal(ally.allegiance, 'Friendly'); assert.equal(ally.hp, 10);
  assert.equal(ally.profile.history, f.profile.history); assert.deepEqual(ally.memory.notes, ['Remember the bridge.']);
  assert.deepEqual(ally.position, { x: 5, y: 4 }); assert.equal(ally.sprite.dataUrl, 'saved');
  assert.match(ally.dialogue[0], /Hero.*glad you're back/);
  assert.equal(JSON.parse(event.combatCharactersString).some(a => a.type === 'npc'), false);
  assert.equal(R.complete(f.state), null, 'A reconnect cannot spend another life or repeat a transfer');
});

test('player death leaves carried and equipped gear behind, without stripping companion inventory or equipment', () => {
  const f = fixture(), E = require('../retort/economy');
  const sword = { name: 'hero sword', type: 'weapon', owner: 'Hero', slot: 'Weapon', attack_modifier: 2, damage_modifier: 3, magic: 0, ac: 0 };
  const shield = { name: 'ally shield', type: 'shield', owner: 'Ally', slot: 'Shield', attack_modifier: 0, damage_modifier: 0, magic: 0, ac: 2 };
  let text = f.state.getUpdatedGameConsole();
  const pc = I.parseSheets(text, 'PC')[0], npc = I.parseSheets(text, 'NPCs in Party')[0];
  text = text.replace(pc.rawSheet, pc.rawSheet.replace('Weapon: None', 'Weapon: hero sword').replace('Attack: 0', 'Attack: 2'));
  text = text.replace(npc.rawSheet, npc.rawSheet.replace('Shield: None', 'Shield: ally shield'));
  f.state.setUpdatedGameConsole(E.write(text, 'Party Equipped Properties', JSON.stringify(sword) + ', ' + JSON.stringify(shield)));
  const db = f.db(), population = db[f.origin].inhabitants;
  population.actors.Ally = { name: 'Ally', status: 'recruited', inventory: [{ name: 'ally keepsake', type: 'other' }] };
  f.state.setRoomNameDatabase(JSON.stringify(db));
  const stale = f.state.getUpdatedGameConsole();
  f.injure('Hero');
  assert.match(f.state.getUpdatedGameConsole(), /Weapon: hero sword/, 'Dying alone does not strip the player.');
  f.injure('Hero');
  assert.deepEqual(f.db()[f.origin].objects.map(i => i.name).sort(), ['bronze token', 'hero sword']);
  const event = R.complete(f.state), after = f.db();
  assert.equal(I.parseEquipment(I.parseSheets(event.updatedGameConsole, 'PC')[0].lines[9]).Weapon, 'None');
  assert.equal(I.parseSheets(event.updatedGameConsole, 'PC')[0].attack, 0);
  assert.equal(after[f.origin].inhabitants.actors.Ally.inventory[0].name, 'ally keepsake');
  assert.match(after[f.origin].inhabitants.actors.Ally.sheet, /Shield: ally shield/);
  assert.ok(require('../assets/inventoryUi').parseProperties(E.field(event.updatedGameConsole, 'Monsters Equipped Properties')).some(item => item.owner === 'Ally' && item.name === 'ally shield'));
  assert.ok(!after[f.origin].objects.some(i => i.name === 'ally shield' || i.name === 'ally keepsake'));
  assert.equal(R.complete(f.state), null);
  assert.equal(after[f.origin].objects.length, 2);
  const protectedText = E.preserveInventory(event.updatedGameConsole, stale, f.state.getRoomNameDatabase());
  assert.match(protectedText, /^Inventory: Empty$/m);
  assert.equal(I.parseEquipment(I.parseSheets(protectedText, 'PC')[0].lines[9]).Weapon, 'None');
});
test('the first recorded spawn for a level is stable across later room entries', () => {
  const f = fixture(), db = f.db();
  assert.equal(R.noteLevelSpawn(db, 'run', f.entry, f.dungeons[f.entry]), true);
  f.dungeons[f.origin].start = { x: 6, y: 6 };
  assert.equal(R.noteLevelSpawn(db, 'run', f.origin, f.dungeons[f.origin]), false);
  assert.deepEqual(R.destination(f.state, db, f.origin).start, { x: 2, y: 2 });
  f.state.setRoomNameDatabase(JSON.stringify(db));
  assert.equal(R.destination(f.state, db, f.origin).key, f.entry);
});
test('stable unconsciousness restores HP through time without spending a life', () => {
  const f = fixture(); f.injure('Hero', 20); Life.settle(f.state);
  assert.equal(Life.status(f.state).recovery.afterBattle, true);
  Life.advance(f.state); assert.equal(Life.status(f.state).recovery.state, 'Unconscious');
  Life.advance(f.state); assert.equal(Life.actors(f.state.getUpdatedGameConsole()).find(a => a.type === 'pc').hp, 1);
  assert.equal(Life.status(f.state).rescuesUsed, 0); assert.equal(Life.status(f.state).pendingRespawn, false);
});
test('an entirely dying party with no recovery hope reaches the death scene without more attacks', () => {
  const f = fixture(); f.injure('Hero'); f.injure('Ally'); Life.settle(f.state);
  assert.equal(Life.status(f.state).rescuesUsed, 1); assert.equal(Life.status(f.state).pendingRespawn, true);
  assert.equal(Life.actors(f.state.getUpdatedGameConsole()).find(a => a.name === 'Ally').state, 'Dead');
  assert.ok(Life.status(f.state).deathScene.reviver);
});
