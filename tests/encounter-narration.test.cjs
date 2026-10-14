'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const Campaign = require('../retort/campaignMemory');
const { narrateEncounter, replayHistory } = require('../retort/encounterNarration');
const { createPopulationService } = require('../retort/roomPopulation');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');

function fixture() {
  const d = { geoKey: '1,0,0', classification: { indoor: true }, layout: { width: 32, height: 32 }, start: { x: 4, y: 4 }, cells: {} };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 6 };
  const profile = { personality: 'Patient and curious.', voice: 'Warm practical observations.', history: 'Carved the old bridge with her sister.', motivation: 'Repair the memorial.' };
  const p = I.createPopulation(d.geoKey, [{ name: 'Mason', allegiance: 'Neutral', dialogue: ['Old stored greeting.'], ...profile }]);
  I.place(p, d);
  const spot = p.actors.Mason.position;
  const body = { geoKey: d.geoKey, runId: 'run', player: { x: spot.x + .5, y: spot.y + 1.5 } };
  const sheet = (Name, State) => formatStartingCharacterSheet({ Name, HP: 20, MaxHP: 20, Level: 1, Race: 'Human', Class: 'Mason', State });
  let text = `Room Name: Bell Hall\nRoom Description: A vaulted hall.\nCoordinates: X: 1, Y: 0, Z: 0\nPC:\n${sheet('Hero', 'Alive')}\nNPCs in Party: None\nMonsters in Room:\n${sheet('Mason', 'Neutral')}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nTurns: 3\nRooms Visited: 2`;
  let roster = JSON.stringify([{ name: 'Hero', type: 'pc', hp: 20, mazeX: spot.x, mazeY: spot.y + 1, mazeRoomKey: d.geoKey },
    { name: 'Mason', type: 'monster', hp: 20, mazeX: spot.x, mazeY: spot.y, mazeRoomKey: d.geoKey }]);
  const archive = { runId: 'run', records: [] }, memory = { characters: {}, recent: [] };
  let database = '{}', coords = { x: 1, y: 0, z: 0 };
  const state = { getDungeonRunId: () => 'run', getLastCoords: () => coords, getGamePaused: () => false,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: value => { text = value; },
    getRoomNameDatabase: () => database, setRoomNameDatabase: value => { database = value; },
    getRoomPopulation: () => p, setRoomPopulation() {}, getCombatCharactersString: () => roster,
    setCombatCharactersString: value => { roster = value; }, getRoomDungeonForSimulation: () => d,
    getCurrentTasks: () => [], getCurrentQuest: () => 'Recover the existing bell.', getActiveTask: () => null,
    getCampaignMemory: () => archive, getDialogueMemory: () => memory,
    getPersonalNarrative: () => '$.user `I promised to restore the crossing.`\n$.assistant `The ferry keeper entrusted you with the old bell.`' };
  const service = createPopulationService(state);
  return { d, p, state, service, body, memory, archive, leave: () => { coords = { x: 2, y: 0, z: 0 }; } };
}

function transport(content, after = () => {}) {
  const prompts = [], requests = [];
  const add = (parts, ...values) => prompts.push(typeof parts === 'string' ? parts : String.raw({ raw: parts }, ...values));
  return { prompts, requests, retort: fn => fn, run: async fn => fn({ user: add, assistant: Object.assign((...args) => add(...args), { generation: async settings => {
    requests.push(settings); after(); return { content };
  } }) }) };
}
const line = 'The keeper entrusted you with the bell. What will you do about the crossing?';
const prose = 'Mason puts down her chisel. "[[SPEECH:"Mason"]]' + line + '[[/SPEECH]]"';

test('first approach replays the original lore, story and full bottom prompt without building a room', async () => {
  const f = fixture(), runtime = transport(prose), before = JSON.stringify(f.d);
  const visit = f.service.visit({ ...f.body, deferIntroductions: true });
  assert.equal(visit.dialogue.length, 0); assert.equal(visit.encounters.length, 1); assert.equal(f.p.groups[0].introPlayed, false);
  const result = await narrateEncounter({ state: f.state, service: f.service, visit, runtime });
  assert.equal(runtime.requests.length, 1);
  assert.ok(runtime.prompts.some(text => text.startsWith('Instructions for the Grave Master:') && text.includes('Tome of the Twelve')));
  assert.ok(runtime.prompts.some(text => text.includes('The ferry keeper entrusted you with the old bell.')));
  assert.ok(runtime.prompts.some(text => text.includes('Write an interactive fiction adventure') && text.trim().endsWith('Improvise!')));
  assert.ok(!runtime.prompts.some(text => text.includes('Generate a unique description') || text.includes('TURN 0')));
  assert.match(result.story.content, /Mason puts down her chisel/); assert.equal(result.dialogue[0].line, line);
  assert.equal(JSON.stringify(f.d), before); assert.equal(f.p.groups[0].introPlayed, true);
  assert.ok(f.memory.characters.Mason.recent.includes(line));
  assert.ok(Campaign.exportRecords(f.state).some(row => row.kind === 'dialogue' && row.speaker === 'Mason' && row.text.includes('crossing')));
  assert.ok(Campaign.exportRecords(f.state).some(row => row.kind === 'room-history'));
  assert.equal(f.service.visit({ ...f.body, deferIntroductions: true }).encounters.length, 0);
});

test('a late encounter result cannot spend an introduction or create memories after leaving the room', async () => {
  const f = fixture(), runtime = transport(prose, f.leave), visit = f.service.visit({ ...f.body, deferIntroductions: true });
  const result = await narrateEncounter({ state: f.state, service: f.service, visit, runtime });
  assert.equal(result.stale, true); assert.equal(result.story, undefined);
  assert.equal(f.p.groups[0].introPlayed, false); assert.deepEqual(f.memory.recent, []);
});

test('failed story generation leaves the introduction unspent instead of substituting a canned greeting', async () => {
  const f = fixture(), visit = f.service.visit({ ...f.body, deferIntroductions: true });
  await assert.rejects(narrateEncounter({ state: f.state, service: f.service, visit, runtime: transport('') }), /no narrative/);
  assert.equal(f.p.groups[0].introPlayed, false); assert.deepEqual(f.memory.recent, []);
});

test('history replay preserves multiline conversation roles without truncating to the old cache excerpt', () => {
  const messages = [], $ = { user: content => messages.push(['user', content]), assistant: content => messages.push(['assistant', content]) };
  const long = 'An earlier promise. '.repeat(200);
  replayHistory($, '$.user `A question.`\n$.assistant `' + long + '\nThe answer continues.`');
  assert.equal(messages.length, 2); assert.equal(messages[0][0], 'user');
  assert.equal(messages[1][0], 'assistant'); assert.ok(messages[1][1].includes(long));
});
