'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');
const P = require('../assets/characterProfiles');
const Memory = require('../retort/dialogueMemory');
const CampaignMemory = require('../retort/campaignMemory');
const JourneyMemory = require('../retort/journeyMemory');
const { generateCharacterDialogue, describeCharacters } = require('../retort/characterDialogue');
const { buildInitialGameConsole, buildInitialWorldConsole } = require('../retort/initialGameState');
const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8');
const premiseStart = source.indexOf('// Detect "party mode" from NPCs in Party');
const premiseCode = source.slice(premiseStart, source.indexOf('    $.user`This is the current game console (monsters shown only within shouting distance)', premiseStart));
const narrationStart = source.indexOf('// Narration runs only after placement');
const narrationCode = source.slice(narrationStart, source.indexOf('// Include musicArrangement here', narrationStart));
const startingCharacter = Name => ({ Name, Race: 'Human', Class: 'Fighter', Sex: 'Female', HP: 30, MaxHP: 30, Level: 1 });
function fixture(pcName, companions, turns = 0, geoKey = '0,0,0') {
  const consoleText = buildInitialGameConsole(buildInitialWorldConsole().console, startingCharacter(pcName), companions.map(startingCharacter))
    .replace('Turns: 0', `Turns: ${turns}`).replace('Coordinates: X: 0, Y: 0, Z: 0', `Coordinates: ${geoKey.split(',').map((n, i) => ['X', 'Y', 'Z'][i] + ': ' + n).join(', ')}`);
  const roster = [pcName, ...companions].map((name, i) => ({ name, type: i ? 'npc' : 'pc', hp: 30,
    mazeX: 4 + i % 3, mazeY: 4 + Math.floor(i / 3), mazeRoomKey: geoKey, originProfile: P.create({ Name: name }, 'run') }));
  const dungeon = { geoKey, classification: { indoor: true }, layout: { width: 32, height: 32 }, start: { x: 4, y: 4 }, cells: {} };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 6 };
  const population = I.createPopulation(geoKey, [], { starting: geoKey === '0,0,0' });
  const ledger = { characters: {}, recent: [] }, archive = { runId: 'run', records: [] };
  const state = { getRoomDungeonForSimulation: () => dungeon, getCombatCharactersString: () => JSON.stringify(roster),
    getUpdatedGameConsole: () => consoleText, setUpdatedGameConsole(value) { assert.equal(value, consoleText); },
    getCurrentQuest: () => 'None', getDialogueMemory: () => ledger, getDungeonRunId: () => 'run',
    getCampaignMemory: () => archive, getRoomPopulation: () => population, getCurrentTasks: () => [] };
  const prompts = [], requests = [], agent = { user(parts, ...values) {
    prompts.push(typeof parts === 'string' ? parts : String.raw({ raw: parts }, ...values));
  }, assistant: { generation: async options => { requests.push(options); return { content: agent.output }; } } };
  const context = { Inhabitants: I, DialogueMemory: Memory, JourneyMemory, generateCharacterDialogue, describeCharacters,
    sharedState: state, geoCoords: { x: 0, y: 0, z: 0 }, geoKey, enteringRoom: true, isFirstTurn: turns === 0,
    userInput: '', updatedGameConsole: consoleText, roomDescription: 'The Ruined Temple threshold.', personalNarrative: '',
    autoMax: 850, spoken: { dialogue: [], replies: [] }, populationService: { prepare: () => population }, $: agent,
    parseNpcPartyNamesFromConsole: text => I.parseSheets(text, 'NPCs in Party').map(row => row.name),
    run: async () => { throw Error('Startup must stay in the main Retort conversation, not a separate entry-dialogue run.'); },
    console: { info() {}, warn() {} } };
  return { consoleText, roster, dungeon, population, state, prompts, requests, agent, context };
}

for (const [name, party, expected] of [
  ['New Adventurer', ['Catorin', 'Skaroraia', 'Wolyn', 'Uelenina', 'Joem Selaela', 'Mortacia'], /TURN 0 PARTY AWAKENING PREMISE/],
  ['Mortacia', [], /TURN 0 SOLO SEED \(Mortacia/],
  ['Suzerain', [], /TURN 0 SOLO SEED \(Suzerain/]
]) test(`${name} startup finishes the original premise in the main Retort and extracts all actual opening speech`, async () => {
  const f = fixture(name, party), before = JSON.stringify(f.dungeon), rosterBefore = JSON.stringify(f.roster);
  const story = name === 'Mortacia' ? 'The threshold of Tartarus receives the goddess after her long exile.' : 'Awareness returns on the cold stone of the Ruined Temple.';
  const lines = party.map((speaker, i) => ({ speaker, line: i === party.length - 1 ? 'You have been summoned. Your questions are yours to ask.' : `I remember my own name, ${speaker}, but not this place.` }));
  const prose = [story, ...lines.map(row => `${row.speaker} says, "[[SPEECH:${JSON.stringify(row.speaker)}]]${row.line}[[/SPEECH]]"`)].join('\n\n');
  f.agent.output = prose + ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({ spoken: [], replies: [] }) + '[[/CHARACTER_DIALOGUE]]';
  const result = await vm.runInNewContext(`(async()=>{${premiseCode}\n${narrationCode}\nreturn {response,spoken,initialArrival};})()`, f.context);
  assert.equal(result.initialArrival, true); assert.equal(f.requests.length, 1);
  assert.ok(f.prompts.some(prompt => expected.test(prompt)));
  assert.ok(f.prompts.some(prompt => prompt.includes('INITIAL GAME ARRIVAL') && prompt.includes('without choosing actions or speaking for the PC')));
  if (party.length) assert.ok(f.prompts.some(prompt => prompt.includes('none of the non-divine characters recognize who the others are')));
  if (name === 'Mortacia') assert.ok(f.prompts.some(prompt => prompt.includes('self-imposed exile') && prompt.includes('Sepulchra') && prompt.includes('Arithus')));
  if (name === 'Suzerain') assert.ok(f.prompts.some(prompt => prompt.includes('has just died') && prompt.includes('raise an army')));
  assert.equal(result.response, prose.replace(/\[\[SPEECH:[^\]]*\]\]|\[\[\/SPEECH\]\]/g, ''));
  assert.deepEqual(result.spoken.dialogue.map(row => row.speaker), party);
  assert.ok(f.requests[0].maxTokens <= 4200); assert.equal(JSON.stringify(f.dungeon), before); assert.equal(JSON.stringify(f.roster), rosterBefore);
  assert.equal(f.state.getUpdatedGameConsole(), f.consoleText); assert.equal(f.state.getCurrentQuest(), 'None');
});

for (const [turns, geoKey] of [[1, '0,0,0'], [0, '1,0,0']]) test(`entry at turn ${turns} in ${geoKey} does not replay the initial awakening`, async () => {
  const f = fixture('Mortacia', ['Companion'], turns, geoKey); let entryCalls = 0;
  f.agent.output = 'Companion: "[[SPEECH:"Companion"]]We have returned to the threshold.[[/SPEECH]]"';
  f.context.run = async work => { entryCalls++; return work(f.agent); }; f.context.retort = work => work;
  f.agent.system = f.agent.user;
  const result = await vm.runInNewContext(`(async()=>{${narrationCode}\nreturn {response,initialArrival};})()`, f.context);
  assert.equal(result.initialArrival, false); assert.equal(entryCalls, 0); assert.equal(f.requests.length, 1);
  assert.equal(result.response, 'Companion: "We have returned to the threshold."');
  assert.ok(!f.prompts.some(prompt => prompt.includes('INITIAL GAME ARRIVAL')));
  assert.ok(f.prompts.some(prompt => prompt.includes('ROOM ENTRY NARRATION')));
});

test('the full opening scene is indexed as room history without treating narration as character speech or a quest completion', () => {
  const f = fixture('New Adventurer', ['Mortacia']);
  CampaignMemory.rememberRoomHistory(f.state, '', 'Awareness returned on cold temple stone; strangers were waking nearby.', f.consoleText);
  const rows = CampaignMemory.exportRecords(f.state);
  assert.equal(rows.length, 1); assert.equal(rows[0].roomKey, '0,0,0');
  assert.equal(rows[0].kind, 'room-history'); assert.equal(rows[0].authority, 'reported');
  assert.equal(rows[0].speaker, ''); assert.deepEqual(rows[0].witnesses, ['New Adventurer']);
  assert.match(fs.readFileSync('server.js', 'utf8'), /await retortWithUserInput\(specialInput, broadcast, combatMode\);\s*CampaignMemory\.rememberRoomHistory/);
});
