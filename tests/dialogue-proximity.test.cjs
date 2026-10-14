'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const { createPopulationService } = require('../retort/roomPopulation');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
function fixture(indoor = true) {
  const dungeon = { geoKey: '1,0,0', classification: { indoor }, start: { x: 4, y: 4 }, layout: { width: 32, height: 32 }, cells: {} };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 10 };
  const population = I.createPopulation(dungeon.geoKey, [{ name: 'Mason', allegiance: 'Neutral', dialogue: ['Mind the cracked arch.', 'The mortar still crumbles.'] }], { indoor });
  const record = population.actors.Mason;
  record.position = record.home = { x: I.MONSTER_DIALOGUE_RANGE + 5, y: 4 }; population.groups[0].site = { ...record.position };
  const actor = { name: 'Mason', type: 'monster', hp: 20, mazeX: record.position.x, mazeY: 4, mazeRoomKey: dungeon.geoKey };
  let roster = JSON.stringify([{ name: 'PC', type: 'pc', hp: 20, mazeX: 4, mazeY: 4, mazeRoomKey: dungeon.geoKey }, actor]), db = '{}';
  const sheet = formatStartingCharacterSheet({ Name: 'Mason', Sex: 'Female', Race: 'Human', Class: 'Mason', Level: 1, HP: 20, MaxHP: 20, AC: 10 });
  const text = `Coordinates: X: 1, Y: 0, Z: 0\nNPCs in Party: None\nMonsters in Room:\n${sheet}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nRooms Visited: 1`;
  const state = { getDungeonRunId: () => 'run', getGamePaused: () => false, getLastCoords: () => ({ x: 1, y: 0, z: 0 }),
    getRoomDungeonForSimulation: () => dungeon, getRoomPopulation: () => population, setRoomPopulation() {},
    getUpdatedGameConsole: () => text, getRoomNameDatabase: () => db, setRoomNameDatabase: value => { db = value; },
    getCombatCharactersString: () => roster, setCombatCharactersString: value => { roster = value; } };
  return { dungeon, population, record, actor, state, service: createPopulationService(state),
    body: { geoKey: dungeon.geoKey, runId: 'run', player: { x: 4.5, y: 4.5 }, actors: [] } };
}

for (const indoor of [true, false]) test(`${indoor ? 'indoor' : 'outdoor'} encountered residents speak within the ten-tile boundary but not beyond it`, () => {
  const f = fixture(indoor), group = f.population.groups[0];
  f.record.encounteredAt = 1; group.status = 'discovered';
  const far = f.service.visit(f.body);
  assert.equal(group.status, 'discovered'); assert.equal(group.introPlayed, false);
  assert.ok(f.record.encounteredAt > 0);
  assert.equal(far.dialogue.length, 0); assert.equal(f.record.dialogueIndex, 0);
  assert.deepEqual(I.nearbyMonsterNames(f.dungeon, [], f.population, f.body.player), indoor ? [] : ['Mason']);
  const near = f.service.visit({ ...f.body, player: { x: 5.5, y: 4.5 } });
  assert.deepEqual(near.dialogue, [{ speaker: 'Mason', line: 'Mind the cracked arch.', kind: 'encounter' }]);
  assert.equal(near.speech[0].distance, 10); assert.equal(near.speech[0].range, I.MONSTER_DIALOGUE_RANGE);
  assert.equal(near.speech[0].lineOfSight, true);
  assert.equal(group.introPlayed, true); assert.equal(f.record.dialogueIndex, 1);
  f.population.lastCannedSpeechAt = 0;
  const returnFar = f.service.visit(f.body);
  assert.equal(returnFar.dialogue.length, 0); assert.equal(f.record.dialogueIndex, 1);
  const returnNear = f.service.visit({ ...f.body, player: { x: 5.5, y: 4.5 } });
  assert.equal(returnNear.dialogue[0].line, 'The mortar still crumbles.');
});

test('the dialogue boundary uses the continuous player position, not a rounded maze cell', () => {
  const f = fixture();
  f.record.encounteredAt = 1;
  assert.equal(f.service.visit({ ...f.body, player: { x: 5.499, y: 4.5 } }).dialogue.length, 0);
  assert.equal(f.service.visit({ ...f.body, player: { x: 5.5, y: 4.5 } }).dialogue.length, 1);
});

test('actual discovery is recorded per resident, not inherited from another member of the same group', () => {
  const f = fixture(), second = I.createPopulation(f.dungeon.geoKey, [{ name: 'Far Mason', allegiance: 'Neutral' }]).actors['Far Mason'];
  second.encounterId = f.record.encounterId;
  second.home = second.position = { x: 25, y: 25 };
  f.population.actors[second.name] = second;
  f.population.groups[0].members.push(second.name);
  const sheet = formatStartingCharacterSheet({ Name: second.name, Sex: 'Female', Race: 'Human', Class: 'Mason',
    Level: 1, HP: 20, MaxHP: 20, AC: 10 });
  const original = f.state.getUpdatedGameConsole();
  f.state.getUpdatedGameConsole = () => original.replace('Monsters Equipped Properties:', `${sheet}\nMonsters Equipped Properties:`);
  f.service.visit({ ...f.body, player: { x: 13.5, y: 4.5 } });
  assert.equal(f.population.groups[0].status, 'discovered');
  assert.equal(I.hasEncountered(f.actor, f.population), true);
  assert.equal(I.hasEncountered({ name: second.name, type: 'monster' }, f.population), false);
  assert.equal(second.encounteredAt, undefined);
});

test('a moving monster waits until its rendered position arrives within speaking distance', () => {
  const f = fixture();
  f.record.encounteredAt = 1;
  const incoming = { name: 'Mason', mazeX: 14, mazeY: 4, mazePoint: { x: 15.2, y: 4.5 } };
  assert.equal(f.service.visit({ ...f.body, actors: [incoming] }).dialogue.length, 0);
  assert.equal(f.population.groups[0].introPlayed, false);
  assert.equal(f.service.visit({ ...f.body, actors: [{ ...incoming, mazePoint: { x: 14.4, y: 4.5 } }] }).dialogue.length, 1);
});

test('invalid remote rendered positions cannot pull a distant monster into a conversation', () => {
  const f = fixture();
  assert.equal(f.service.visit({ ...f.body, actors: [{ name: 'Mason', mazeX: 15, mazeY: 4, mazePoint: f.body.player }] }).dialogue.length, 0);
  const actor = JSON.parse(f.state.getCombatCharactersString()).find(a => a.name === 'Mason');
  assert.equal(actor.mazePoint, undefined);
});

test('walls still block nearby speech and only living residents in the current room may speak', () => {
  const f = fixture(), player = { x: 12.5, y: 4.5 };
  assert.equal(I.dialogueReach(f.dungeon, f.actor, player).canSpeak, true);
  f.dungeon.cells['13,4'].tile = 'wall';
  assert.equal(I.dialogueReach(f.dungeon, f.actor, player).canSpeak, false);
  f.dungeon.cells['13,4'].tile = 'floor';
  for (const changes of [{ hp: 0 }, { state: 'Dead' }, { status: 'departed' }, { mazeRoomKey: '2,0,0' }]) {
    assert.equal(I.dialogueReach(f.dungeon, { ...f.actor, ...changes }, player).canSpeak, false);
  }
});

test('a discovered resident continues its cached dialogue behind a pillar without announcing unseen residents', () => {
  const f = fixture(), player = { x: 13.5, y: 4.5 };
  assert.equal(f.service.visit({ ...f.body, player }).dialogue[0].line, 'Mind the cracked arch.');
  f.dungeon.tiles = { custom_column: { spriteSpec: { voxelShape: 'doric_column', baseWidth: .6, heightRatio: 1 } } };
  f.dungeon.cells['14,4'] = { tile: 'custom_column', floorHeight: 0, ceilHeight: 10, structureHeight: 6 };
  f.population.lastCannedSpeechAt = 0;
  const heard = f.service.visit({ ...f.body, player });
  assert.equal(heard.dialogue[0].line, 'The mortar still crumbles.');
  assert.equal(heard.speech[0].lineOfSight, false); assert.equal(heard.speech[0].canHear, true);
  assert.ok(I.nearbyMonsterNames(f.dungeon, [], f.population, player).includes('Mason'));
  delete f.record.encounteredAt; f.record.dialogueIndex = 0; f.population.groups[0].introPlayed = false;
  f.population.groups[0].status = 'unseen'; f.population.lastCannedSpeechAt = 0;
  assert.deepEqual(f.service.visit({ ...f.body, player }).dialogue, []);
  assert.equal(f.record.encounteredAt, undefined);
});

test('dialogue distance accounts for height, not just adjacent XY coordinates', () => {
  const f = fixture(), player = { x: 14.95, y: 4.5 };
  f.dungeon.cells['15,4'].floorHeight = 12; f.dungeon.cells['15,4'].ceilHeight = 22;
  assert.equal(I.dialogueReach(f.dungeon, f.actor, player).canSpeak, false);
  assert.ok(I.dialogueReach(f.dungeon, f.actor, player).distance > 10);
});

test('party companions retain their existing nearby conversation range', () => {
  const f = fixture();
  assert.equal(I.dialogueReach(f.dungeon, f.actor, f.body.player).canSpeak, false);
  const companion = { ...f.actor, type: 'npc', mazeX: 12, status: 'recruited' };
  assert.equal(I.dialogueReach(f.dungeon, companion, f.body.player).canSpeak, true);
  assert.equal(I.dialogueReach(f.dungeon, companion, f.body.player).range, 8);
});

test('the logged resident question selects all four encountered speakers at four to six tiles', () => {
  const f = fixture(), pc = { name: 'Mortacia', type: 'pc', hp: 132, mazeX: 4, mazeY: 4, mazeRoomKey: f.dungeon.geoKey };
  const roster = [pc, ...['Vharzith the Dreadseer', 'Sylithra Whisperveil', 'Kaelen Duskwraith', 'Xarlith Shadowclaw'].map((name, i) => ({
    ...f.actor, name, mazeX: 8 + i / 2, mazeY: 4, discoveryState: 'fixed' }))];
  const population = I.createPopulation(f.dungeon.geoKey, roster.slice(1).map(a => ({ name: a.name, allegiance: 'Friendly' })));
  for (const a of Object.values(population.actors)) a.encounteredAt = 1;
  const audible = I.perceive(f.dungeon, roster, population).conversational.filter(a => I.hasEncountered(a, population)).map(a => a.name);
  const policy = require('../assets/dialogueAudience').resolve('ask the monsters what has transpired in my absence', roster, audible);
  assert.deepEqual(policy.responders, roster.slice(1).map(a => a.name));
  assert.equal(I.MONSTER_DIALOGUE_RANGE, 10);
});
