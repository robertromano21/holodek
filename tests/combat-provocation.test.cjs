'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const P = require('../retort/combatProvocation'), I = require('../assets/dungeonInhabitants');
const { createCombatSpace } = require('../retort/dungeonReach');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
function fixture(allegiance = 'Friendly') {
  const dungeon = { geoKey: '1,0,0', cells: {}, layout: { width: 24, height: 24 } };
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor' };
  const actor = (name, type, x, y) => ({ name, type, hp: 40, mazeX: x, mazeY: y, mazeRoomKey: dungeon.geoKey,
    sprite: { spec: { name } }, voiceSpec: { f0: 205 }, originProfile: { name, history: 'A remembered journey.' } });
  let roster = [actor('PC', 'pc', 4, 4), actor('Companion', 'npc', 5, 4), actor('Other Ally', 'npc', 4, 5), actor('Resident', 'monster', 5, 5)];
  const row = Name => formatStartingCharacterSheet({ Name, Sex: 'Female', Race: 'Human', Class: 'Fighter',
    Level: 2, HP: 40, MaxHP: 40, AC: 13, Attack: 3, Damage: 2, Armor: 1, Magic: 1 });
  let text = `Coordinates: X: 1, Y: 0, Z: 0\nPC:\n${row('PC')}\nNPCs in Party:\n${row('Companion')}\n${row('Other Ally')}\nMonsters in Room:\n${row('Resident')}\nMonsters Equipped Properties: None\nMonsters State: ${allegiance}\nRooms Visited: 2`;
  const population = I.createPopulation(dungeon.geoKey, [{ name: 'Resident', allegiance }]);
  population.companions = { Companion: { memory: { notes: ['Tarn stayed behind.'] }, profile: roster[1].originProfile } };
  let saved, paused = false;
  const state = { getLastCoords: () => ({ x: 1, y: 0, z: 0 }), getRoomDungeon: () => dungeon, getDungeonRunId: () => 'run',
    getGamePaused: () => paused, getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => { text = v; },
    getCombatCharactersString: () => JSON.stringify(roster), setCombatCharactersString: v => { roster = JSON.parse(v); } };
  const service = { get: () => population, save: () => { saved = JSON.parse(JSON.stringify(population)); } };
  return { dungeon, state, service, population, roster: () => roster, saved: () => saved, pause: () => { paused = true; } };
}
test('attacking a friendly or neutral resident persists hostility without changing other allegiances', () => {
  for (const allegiance of ['Friendly', 'Neutral']) {
    const f = fixture(allegiance), event = P.prepare(f.state, f.service, 'attack Resident');
    assert.ok(event?.passive); assert.equal(f.population.actors.Resident.allegiance, 'Hostile');
    assert.equal(I.parseSheets(event.updatedGameConsole)[0].state, 'Hostile');
    assert.equal(f.saved().actors.Resident.allegiance, 'Hostile');
    const teams = I.teams(f.roster(), f.population, createCombatSpace(f.dungeon, f.roster(), f.dungeon.geoKey));
    assert.deepEqual(teams.hostiles.map(a => a.name), ['Resident']);
    assert.deepEqual(teams.friends.map(a => a.name), ['PC', 'Companion', 'Other Ally']);
  }
});
test('an attacked companion alone leaves the party, retaining stats, artwork, voice and memory', () => {
  const f = fixture(), before = JSON.parse(JSON.stringify(f.roster()[1]));
  const event = P.prepare(f.state, f.service, 'attack Companion');
  assert.match(event.content, /leaves the party/);
  assert.deepEqual(I.parseSheets(event.updatedGameConsole, 'NPCs in Party').map(a => a.name), ['Other Ally']);
  const target = f.roster().find(a => a.name === 'Companion');
  for (const field of ['sprite', 'voiceSpec', 'hp', 'mazeX', 'mazeY', 'originProfile']) assert.deepEqual(target[field], before[field]);
  assert.equal(target.type, 'monster'); assert.equal(target.state, 'Hostile');
  assert.deepEqual(f.population.actors.Companion.memory.notes, ['Tarn stayed behind.']);
  assert.equal(f.population.companions.Companion, undefined);
  assert.equal(I.parseSheets(event.updatedGameConsole).find(a => a.name === 'Companion').attack, 3);
  const teams = I.teams(f.roster(), f.population, createCombatSpace(f.dungeon, f.roster(), f.dungeon.geoKey), 'attack Companion');
  assert.deepEqual(teams.hostiles.map(a => a.name), ['Companion']);
  assert.deepEqual(teams.friends.map(a => a.name), ['PC', 'Other Ally', 'Resident']);
  assert.ok(teams.targets(teams.friends[1]).every(a => a.type !== 'npc'), 'AI never attacks a current party member');
});
test('inspection, ambiguity, paused commands and distant/occluded attacks cannot turn friends hostile', () => {
  for (const mode of ['inspect', 'ambiguous', 'paused', 'distant', 'wall']) {
    const f = fixture(); let command = 'attack Companion';
    if (mode === 'inspect') command = 'inspect Companion';
    if (mode === 'ambiguous') { command = 'attack Comp'; f.roster()[2].name = 'Companion Two'; }
    if (mode === 'paused') f.pause();
    if (mode === 'distant') f.roster()[1].mazeX = 23;
    if (mode === 'wall') { f.roster()[1].mazeX = 6; f.dungeon.cells['5,4'].tile = 'wall'; }
    assert.equal(P.prepare(f.state, f.service, command), null, mode);
    assert.equal(f.roster()[1].type, 'npc'); assert.equal(f.population.actors.Resident.allegiance, 'Friendly');
    assert.equal(f.saved(), undefined);
  }
});
test('party-attack confirmation cancels safely and does not warn for room residents or ordinary commands', async () => {
  const calls = [], root = { combatCharacters: [{ name: 'Companion', type: 'npc' }, { name: 'Resident', type: 'monster' }],
    confirm: s => { calls.push(s); return false; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/combatCharacterUi'), 'utf8'), { window: root });
  const before = JSON.stringify(root.combatCharacters);
  assert.equal(root.CombatCharacterUi.confirmAttackCommand('attack Companion'), false);
  assert.match(calls[0], /^Attack Party Member\?/); assert.match(calls[0], /leave your party and become hostile/);
  assert.equal(root.CombatCharacterUi.confirmAttackCommand('attack Resident'), true);
  assert.equal(root.CombatCharacterUi.confirmAttackCommand('talk to Companion'), true);
  assert.equal(calls.length, 1); assert.equal(JSON.stringify(root.combatCharacters), before);
  const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  assert.match(source, /confirmAttackCommand\(userInput\) === false\) return false;\s*if \(!completedStartResult\) document\.getElementById\("chatuserinput"\)\.value = ""/);
  const draft = { value: 'attack Companion' }, entry = source.slice(source.indexOf('async function chatbotprocessinput('), source.indexOf('  const divineRefusal =', source.indexOf('async function chatbotprocessinput(')));
  const context = { window: root, document: { getElementById: () => draft }, currentCoordinates: { x: 1, y: 0, z: 0 } };
  vm.runInNewContext(entry + '\nthrow Error("Canceled command continued");}', context);
  assert.equal(await context.chatbotprocessinput(), false);
  assert.equal(draft.value, 'attack Companion');
});
