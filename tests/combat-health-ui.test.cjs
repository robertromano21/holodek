'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
const source = fs.readFileSync('assets/game.js', 'utf8');
const code = source.slice(source.indexOf('window.applyLiveCombatHealth ='), source.indexOf('const realtimeCombatResultsSeen ='));

function fixture() {
  const row = (Name, HP, MaxHP) => formatStartingCharacterSheet({ Name, HP, MaxHP, Sex: 'Female',
    Race: 'Human', Class: 'Fighter', Level: 2, AC: 10, Attack: 2, Damage: 1, XP: 100 });
  const text = `Coordinates: X: 1, Y: 1, Z: 0\nRoom Name: Temple\nObjects in Room: maul\n` +
    `PC:\n${row('Hero', 13, 20)}\nNPCs in Party:\n${row('Companion', 0, 10)}\n` +
    `Monsters in Room:\n${row('Guard', 4, 18)}\nMonsters Equipped Properties: None\nMonsters State: Hostile\n` +
    'Quest Requirements: Give the shardbreaker maul to Edrin Farrows.';
  const actors = [['Hero', 'pc', 20], ['Companion', 'npc', 10], ['Guard', 'monster', 18]].map(([name, type, hp], i) =>
    ({ name, type, hp, mazeX: i + 2, mazeY: 4, renderMazeX: i + 2.4, sprite: { dataUrl: 'approved-' + name } }));
  const calls = [], dungeon = { geoKey: '1,1,0', cells: { '2,4': { tile: 'floor' } }, _geometryStamp: 'fixed' };
  const window = { dungeonRunId: 'run', DungeonInhabitants: I, combatCharacters: actors,
    actionDiceState: { active: { id: 'battle', kind: 'combat', round: 2, turn: { turnId: 'player-turn' } } },
    _combatCommandPending: true, _combatRoundActiveUntil: 5000,
    latestUpdatedData: { presentationMarker: 'preserved' },
    DungeonLife: { receivePopulation: event => calls.push(['population', event]) },
    game: { scene: { getScene: () => ({ scene: { restart: data => calls.push(['console', data]) } }) } },
    combatGame: { scene: { getScene: () => ({ updatePositions: list => calls.push(['map', list]) }) } },
    renderPartyIconDock: () => calls.push(['party']) };
  const characters = [{ Name: 'Hero', HP: 20 }], npcs = [{ Name: 'Companion', HP: 10 }];
  const monstersInVisitedRooms = new Map([[dungeon.geoKey, [{ Name: 'Guard', HP: 18 }]]]);
  const context = { window, currentDungeon: dungeon, characters, npcs, monstersInVisitedRooms,
    updateCharacterSheetsFromConsole: value => calls.push(['sheets', value]),
    renderDungeonView: () => calls.push(['render']) };
  vm.runInNewContext(code, context);
  const event = { type: 'combat_health', runId: 'run', geoKey: dungeon.geoKey, actionId: 'battle', revision: 1,
    updatedGameConsole: text, population: I.createPopulation(dungeon.geoKey, [{ name: 'Guard', allegiance: 'Hostile' }]) };
  return { window, dungeon, calls, event, characters, npcs, monstersInVisitedRooms };
}

test('live health updates the console, party sheets and existing sprites without restarting combat or the room', () => {
  const f = fixture(), geometry = JSON.stringify(f.dungeon), dice = JSON.stringify(f.window.actionDiceState);
  const sprites = f.window.combatCharacters.map(a => a.sprite), positions = f.window.combatCharacters.map(a => [a.mazeX, a.renderMazeX]);
  f.window.applyLiveCombatHealth(f.event);
  assert.equal(f.window.lastServerGameConsole, f.event.updatedGameConsole);
  assert.equal(f.window.latestUpdatedData.presentationMarker, 'preserved');
  assert.match(f.window.latestUpdatedData.pc, /HP: 13/);
  assert.match(f.window.latestUpdatedData.npcs, /HP: 0/);
  assert.match(f.window.latestUpdatedData.monsters, /HP: 4/);
  assert.match(f.window._partyInfoNPCString, /HP: 0/);
  assert.equal(f.window.latestUpdatedData.questRequirements, 'Give the shardbreaker maul to Edrin Farrows.');
  assert.deepEqual(f.window.combatCharacters.map(a => a.hp), [13, 0, 4]);
  assert.equal(f.window.combatCharacters[1].state, 'Dead');
  assert.deepEqual(f.window.combatCharacters.map(a => a.sprite), sprites);
  assert.deepEqual(f.window.combatCharacters.map(a => [a.mazeX, a.renderMazeX]), positions);
  assert.equal(f.characters[0].HP, 13); assert.equal(f.npcs[0].HP, 0);
  assert.equal(f.monstersInVisitedRooms.get(f.event.geoKey)[0].HP, 4);
  assert.equal(f.calls.filter(c => c[0] === 'console').length, 1);
  assert.ok(f.calls.some(c => c[0] === 'party'));
  assert.equal(JSON.stringify(f.dungeon), geometry);
  assert.equal(JSON.stringify(f.window.actionDiceState), dice);
  assert.equal(f.window._combatCommandPending, true); assert.equal(f.window._combatRoundActiveUntil, 5000);
});

for (const invalid of [{ runId: 'old' }, { geoKey: '2,0,0' }, { actionId: 'old-fight' }, { revision: -1 },
  { revision: NaN }, { updatedGameConsole: 'Coordinates: X: 2, Y: 0, Z: 0' },
  { updatedGameConsole: 'Coordinates: X: 1, Y: 1, Z: 0\nPC: None' }]) {
  test('stale or malformed combat health is ignored: ' + JSON.stringify(invalid), () => {
    const f = fixture(); f.window.applyLiveCombatHealth({ ...f.event, ...invalid });
    assert.equal(f.calls.length, 0);
    f.window.applyLiveCombatHealth(f.event);
    assert.equal(f.calls.filter(c => c[0] === 'console').length, 1);
  });
}

test('duplicate and out-of-order updates cannot restore HP; a reconnect accepts the latest revision', () => {
  const f = fixture(); f.window.applyLiveCombatHealth({ ...f.event, revision: 4 });
  f.window.applyLiveCombatHealth({ ...f.event, revision: 4 });
  f.window.applyLiveCombatHealth({ ...f.event, revision: 3 });
  assert.equal(f.calls.filter(c => c[0] === 'console').length, 1);
  f.window.applyLiveCombatHealth({ ...f.event, revision: 5 });
  assert.equal(f.calls.filter(c => c[0] === 'console').length, 2);
});

test('combat health does not revive a completed encounter or a previous action', () => {
  const f = fixture(); f.window.actionDiceState.active = null;
  f.window.applyLiveCombatHealth(f.event); assert.equal(f.calls.length, 0);
  f.window.actionDiceState.active = { id: 'other', kind: 'exploration' };
  f.window.applyLiveCombatHealth({ ...f.event, actionId: 'other' }); assert.equal(f.calls.length, 0);
});

test('live combat death projects exact ground loot coordinates before rendering, without changing the combat lock', () => {
  const f = fixture(), item = { name: 'fallen guard blade', x: 7, y: 8 };
  const before = JSON.stringify(f.window.actionDiceState);
  f.window.applyLiveCombatHealth({ ...f.event, sceneObjects: [item] });
  assert.deepEqual(f.dungeon.sceneObjects, [item]);
  assert.equal(JSON.stringify(f.window.actionDiceState), before);
  assert.equal(f.dungeon._geometryStamp, 'fixed');
  f.window.applyLiveCombatHealth({ ...f.event, revision: 0, sceneObjects: [] });
  assert.deepEqual(f.dungeon.sceneObjects, [item], 'An older health event cannot erase loot');
});

test('the SSE path sends and handles health, including a reconnect snapshot before further rolls', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const start = server.indexOf("app.get('/combat-updates2'");
  const end = server.indexOf('// Debug', start);
  assert.match(server.slice(start, end > start ? end : start + 4500), /client\.send\(\{ type: 'combat_health'/);
  assert.match(source, /data\.type === 'combat_health'[\s\S]*?window\.applyLiveCombatHealth\?\.\(data\)/);
});

test('browser state replacement cannot overwrite health while automatic combat is active', async () => {
  const server = fs.readFileSync('server.js', 'utf8'), start = server.indexOf("app.post('/updateState7'");
  const code = server.slice(start, server.indexOf('// NEW: Endpoint to get room music', start));
  let handler, status, result;
  vm.runInNewContext(code, { app: { post: (_url, fn) => { handler = fn; } },
    inputTaskInFlight: false, actionDice: { active: { kind: 'combat' } } });
  const res = { status: value => { status = value; return res; }, json: value => { result = value; } };
  await handler({ body: { updatedGameConsole: 'Stale HP' } }, res);
  assert.equal(status, 409); assert.match(result.error, /during an action/);
});
