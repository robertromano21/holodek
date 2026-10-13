'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const { createPopulationService } = require('../retort/roomPopulation');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
const sheet = name => formatStartingCharacterSheet({ Name: name, Sex: 'Female', Race: 'Human',
  Class: 'Fighter', Level: 1, HP: 20, MaxHP: 20, AC: 10 });

test('server active rosters are room-local, while companions and original resident records survive return travel', () => {
  const temple = I.createPopulation('0,0,0', [], { starting: true });
  const bastion = I.createPopulation('-1,-1,0', [{ name: 'Elyra', allegiance: 'Neutral' }]);
  Object.assign(bastion.actors.Elyra, { sheet: sheet('Elyra'), hp: 20, position: { x: 2, y: 2 } });
  const original = JSON.stringify(bastion);
  const populations = new Map([[temple.geoKey, temple], [bastion.geoKey, bastion]]);
  let db = JSON.stringify({ '0,0,0': { inhabitants: temple }, '-1,-1,0': { inhabitants: bastion } });
  let roster = JSON.stringify([{ name: 'PC', type: 'pc', hp: 20 }, { name: 'Companion', type: 'npc', hp: 20 },
    { name: 'Elyra', type: 'monster', hp: 20, mazeRoomKey: bastion.geoKey, mazeX: 2, mazeY: 2 }]);
  let text;
  const state = { getRoomPopulation: key => populations.get(key), setRoomPopulation: (key, value) => populations.set(key, value),
    getRoomNameDatabase: () => db, setRoomNameDatabase: value => db = value,
    getCombatCharactersString: () => roster, setCombatCharactersString: value => roster = value,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: value => text = value };
  const service = createPopulationService(state);
  function enter(geoKey, inhabitants) {
    text = `Coordinates: ${geoKey}\nPC:\n${sheet('PC')}\nNPCs in Party:\n${sheet('Companion')}\nMonsters in Room:\n${inhabitants}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nRooms Visited: 2`;
    service.prepare(text, { geoKey });
    return JSON.parse(roster);
  }
  assert.deepEqual(enter(temple.geoKey, 'None').map(a => a.name), ['PC', 'Companion']);
  assert.equal(JSON.stringify(bastion), original, 'Leaving does not erase, recruit or move the original resident');
  const returned = enter(bastion.geoKey, sheet('Elyra'));
  assert.deepEqual(returned.map(a => a.name), ['PC', 'Companion', 'Elyra']);
  assert.equal(returned[2].mazeRoomKey, bastion.geoKey);
  assert.equal(returned[2].mazeX, 2);
  assert.equal(returned[2].hp, 20);
});
