'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { templateContent } = require('retort-js/dist/message');
const I = require('../assets/dungeonInhabitants');
const Grounding = require('../retort/dialogueGrounding');
const Campaign = require('../retort/campaignMemory');
const { describeCharacters } = require('../retort/characterDialogue');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
const { createModelService } = require('../retort/gameModels');
const Runtime = require('../retort/gameRetort');
const Protocol = require('../retort/graveMasterProtocol');
const StoryPrompts = require('../retort/graveMasterStoryPrompts');
const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8').replace(/\r\n/g, '\n');
const section = (start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return source.slice(first, last);
};
const bottom = `StoryPrompts.appendStory($, { questJustSeeded, currentSituation, activeTask, questUpdate, roomName,
  updatedGameConsole, sharedState, parseNpcPartyNamesFromConsole: typeof parseNpcPartyNamesFromConsole === 'function' ? parseNpcPartyNamesFromConsole : undefined });`;
const entry = 'const physicalPuzzleResult = null;\n' + section('// Narration runs only after placement', '// Include musicArrangement here');
const assembly = section('// Include musicArrangement here', 'if (isAutoSimAdvance && response)');
const original = templateContent({ raw: [source.match(/\$\.user`(Instructions for the Grave Master:[\s\S]*?Backend Integration: Programmatic vs\. Narrative Handling)`;/)[1]] });
const quiet = { log() {}, info() {}, warn() {} };
const compile = (body, dependencies) => {
  const supplied = { StoryPrompts, ...dependencies };
  return vm.compileFunction(body, Object.keys(supplied))(...Object.values(supplied));
};

for (const questJustSeeded of [false, true]) for (const currentSituation of ['', 'The lantern flickers.']) {
  test(`full bottom sequence runs exactly once with new quest=${questJustSeeded}, situation=${!!currentSituation}`, () => {
    const prompts = [], task = { type: 'Fetch', desc: 'Recover the existing seal.', requiredElements: [] };
    compile(bottom, { $: { user: (parts, ...values) => prompts.push(templateContent(parts, ...values)) },
      questJustSeeded, currentSituation, activeTask: task, questUpdate: 'The bound task is ready.', roomName: 'Ruined Temple Entrance',
      updatedGameConsole: 'Coordinates: X: 0, Y: 0, Z: 0', console: quiet, parseNpcPartyNamesFromConsole: () => [],
      sharedState: { getRoomNameDatabase: () => '{}', getCurrentTasks: () => [task], getCurrentTaskIndex: () => 0,
        getCurrentQuest: () => 'Recover the bound seal.' } });
    assert.equal(prompts.filter(text => text.startsWith('Integrate:')).length, 1);
    assert.doesNotMatch(prompts.join('\n'), /moral_inversion|blending with a moral twist/);
    const tasks = prompts.filter(text => text.startsWith('Write an interactive fiction adventure'));
    assert.equal(tasks.length, 1); assert.ok(tasks[0].endsWith('Improvise!'));
    assert.equal(prompts.some(text => text.startsWith('Seed the quest NOW')), questJustSeeded);
  });
}

for (const scenario of [
  { name: 'confirmed startup with blank internal input', userInput: '', isAutoSimAdvance: false, isFirstTurn: true, enteringRoom: true, idle: false },
  { name: 'first-turn blank input', userInput: '', isAutoSimAdvance: true, isFirstTurn: true, enteringRoom: true, idle: false },
  { name: 'ordinary room entry', userInput: 'east', isAutoSimAdvance: false, isFirstTurn: false, enteringRoom: true, idle: false },
  { name: 'actual idle tick', userInput: '', isAutoSimAdvance: true, isFirstTurn: false, enteringRoom: false, idle: true }
]) test(`${scenario.name} receives only the appropriate input instruction`, () => {
  const code = section("if (userInput && userInput.trim() !== '') {", '// Detect "party mode"');
  const prompts = [];
  compile(code, { ...scenario, $: { user: (parts, ...values) => prompts.push(templateContent(parts, ...values)) } });
  assert.equal(prompts.some(text => text.startsWith('[Auto 45s')), scenario.idle);
  if (scenario.userInput) assert.deepEqual(prompts, [scenario.userInput]);
  else if (!scenario.idle) assert.deepEqual(prompts, []);
});

test('live-story grounding is scoped to trailing metadata while cache-only grounding stays cache-only', () => {
  const characters = [{ name: 'Edran Bellworn', encountered: false }];
  const live = Grounding.prompt(characters, [], null, { mode: 'narrative' });
  assert.match(live, /^Live story continuation/);
  assert.doesNotMatch(live, /Queued dialogue planning, not immediate speech/);
  assert.match(live, /not to the story or live speech/);
  assert.match(live, /empty permitted-speaker list/);
  assert.match(live, /Cached alternatives have NOT happened/);
  assert.match(Grounding.prompt(characters, [], null), /^Queued dialogue planning, not immediate speech/);
  assert.equal(Campaign.dialoguePrompt(characters, [], null, { mode: 'narrative' }), live);
});

for (const id of ['gpt-4.1-mini', 'gpt-6-luna']) for (const opening of [true, false]) {
  test(`${id}: ${opening ? 'opening' : 'later entry'} carries full story prompts through the wire and returns prose even with no discovered speakers`, async () => {
    const geoKey = opening ? '0,0,0' : '1,0,0', coords = { x: opening ? 0 : 1, y: 0, z: 0 };
    const dungeon = { geoKey, classification: { indoor: true }, layout: { width: 16, height: 16 }, start: { x: 4, y: 4 }, cells: {} };
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 6 };
    const sheet = Name => formatStartingCharacterSheet({ Name, HP: 20, MaxHP: 20, Race: 'Soul', Class: 'Guide', Level: 1 });
    let text = `Room Name: Ruined Temple Entrance\nRoom Description: A roofed temple chamber.\nCoordinates: X: ${coords.x}, Y: 0, Z: 0\nPC:\n${sheet('Mortacia')}\nNPCs in Party: None\nMonsters in Room:\n${sheet('Edran Bellworn')}\nMonsters Equipped Properties: None\nTurns: ${opening ? 0 : 2}\nPuzzle in Room: A carved relief links three blocks.`;
    const roster = [{ name: 'Mortacia', type: 'pc', hp: 20, mazeX: 4, mazeY: 4, mazeRoomKey: geoKey },
      { name: 'Edran Bellworn', type: 'monster', hp: 20, state: 'Friendly', mazeX: 6, mazeY: 4, mazeRoomKey: geoKey }];
    const population = I.createPopulation(geoKey, [{ name: 'Edran Bellworn', allegiance: 'Friendly', job: 'pilgrim' }]);
    I.attach(roster, population);
    const beforeGeometry = JSON.stringify(dungeon), logs = [], requests = [];
    const prose = 'A single note travels through the lintel and fades into the vault. The old sanctuary seems to wait for an answer; the next choice remains Mortacia\'s.';
    const resultText = prose + '\n\n[[CHARACTER_DIALOGUE]]' + JSON.stringify({ spoken: [], replies: [
      { speaker: 'Edran Bellworn', lines: ['I still remember the harbor bells.'] }
    ], exchanges: [] }) + '[[/CHARACTER_DIALOGUE]]';
    const client = { chat: { completions: { create: async body => {
      requests.push(body);
      return (async function* () {
        yield { choices: [{ index: 0, delta: { content: resultText }, finish_reason: null }] };
        yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      })();
    } } } };
    const state = { getCurrentPC: () => ({ Name: 'Mortacia' }), getUpdatedGameConsole: () => text, setUpdatedGameConsole: value => { text = value; },
      getRoomDungeonForSimulation: () => dungeon, getCombatCharactersString: () => JSON.stringify(roster), getCurrentQuest: () => 'None' };
    const models = createModelService({ initial: id, clientFor: () => client });
    const runtime = Runtime.createRuntime({ models, client, log() {},
      prepareMessages: Protocol.enabled(models) ? Protocol.createProtocol(state) : undefined });
    const result = await runtime.run(runtime.retort(async $ => {
      const nestedRun = $.run;
      $.run = (value, params, options) => nestedRun(value, params, { ...options, shouldSaveToLog: false });
      $.user(original);
      return compile('return (async()=>{' + bottom + '\n' + entry + '\n' + assembly + '\nreturn {response,returnObj};})()', {
        $, Inhabitants: I, describeCharacters, sharedState: state, populationService: { prepare: () => population },
        CampaignMemory: { dialogueContext: () => [], dialoguePrompt: Grounding.prompt }, JourneyMemory: { progressSynopsis: () => null },
        console: { ...quiet, info: (...args) => logs.push(args) }, geoCoords: coords, geoKey, enteringRoom: true,
        isFirstTurn: opening, isAutoSimAdvance: false, userInput: opening ? '' : 'east', updatedGameConsole: text,
        roomName: 'Ruined Temple Entrance', roomDescription: 'A roofed temple chamber.', roomNameDatabaseString: '{}',
        questJustSeeded: false, currentSituation: '', activeTask: null, questUpdate: '', autoMax: 850,
        roomDescriptionGenerated: true, attackDecision: 'None', monstersInRoom: 'None', returnObj: {}, truncatedResponse: '',
        sanitizeImage: async () => '', narrative: '', response: '', spoken: { dialogue: [], replies: [] }
      });
    }), null, { shouldSaveToLog: false });
    assert.equal(requests.length, 1, 'No retry or extra narrative model call.');
    const messages = requests[0].messages;
    const bottomTask = messages.find(message => message.content.startsWith('Write an interactive fiction adventure'));
    assert.ok(bottomTask.content.endsWith('Improvise!'));
    assert.equal(messages.filter(message => message.content.startsWith('Integrate:')).length, 1);
    assert.equal(messages.filter(message => message.content === original).length, 1);
    assert.doesNotMatch(messages.map(message => message.content).join('\n'), /PUBLIC UNDERWORLD CULTURE|before asking a character-driven question|moral_inversion|blending with a moral twist/);
    assert.ok(messages.some(message => message.content.startsWith('Live story continuation')));
    assert.ok(!messages.some(message => message.content.startsWith('Queued dialogue planning')));
    assert.ok(!messages.some(message => message.content.startsWith('[Auto 45s')));
    assert.match(messages.at(-1).content, /^FINAL STORY RESPONSE:/);
    assert.match(messages.at(-1).content, /narrative FIRST/);
    assert.equal(messages.some(message => message.content.startsWith('INITIAL GAME ARRIVAL:')), opening);
    assert.equal(messages.some(message => message.content.startsWith('ROOM ENTRY NARRATION:')), !opening);
    assert.equal(result.response, prose);
    assert.ok(result.returnObj.content.endsWith(prose));
    assert.match(result.returnObj.content, /A carved relief links three blocks/);
    assert.doesNotMatch(result.returnObj.content, /CHARACTER_DIALOGUE|I still remember the harbor/);
    assert.equal(JSON.stringify(dungeon), beforeGeometry);
    assert.equal(population.groups[0].status, 'unseen');
    assert.equal(population.actors['Edran Bellworn'].encounteredAt, undefined);
    const report = JSON.parse(logs.find(row => row[0] === '[StoryNarration]')[1]);
    assert.equal(report.status, 'story'); assert.equal(report.permittedSpeakers, 0);
  });
}
