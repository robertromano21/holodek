const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { start } = require('../assets/characterStartup');
const { buildInitialWorldConsole, buildInitialGameConsole, formatStartingCharacterSheet } = require('../retort/initialGameState');
const { sceneInputFromConsole } = require('../retort/sceneSpec');
const { parseSheets } = require('../assets/partyRoster');
const { templateContent } = require('../node_modules/retort-js/dist/message.js');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const quiet = { log() {}, info() {}, warn() {}, error() {} };

test('typing start displays all three choices through the real command and message handlers', async () => {
  const source = read('assets/game.js');
  const display = source.slice(source.indexOf('function displayMessage('), source.indexOf('// Function to get a random integer between min and max', source.indexOf('function displayMessage(')));
  const command = source.slice(source.indexOf('async function chatbotprocessinput('), source.indexOf('//const sharedState', source.indexOf('async function chatbotprocessinput(')));
  for (const value of ['start', 'Start']) {
    const input = { value }, chat = { innerHTML: 'Game introduction' };
    const context = {
      console: quiet, window: {}, currentCoordinates: { x: 0, y: 0, z: 0 },
      document: { getElementById: id => id === 'chatuserinput' ? input : chat },
      localStorage: { getItem: () => 'test-conversation' }, getPromptsAndResponsesForConversation: async () => [],
      startKeepAliveInterval() {}, scrollToBottom() {}, roomConversationHistories: {},
      coordinatesToString: c => `${c.x},${c.y},${c.z}`, roomNameDatabase: new Map(),
      characters: [], character: { Race: '', Class: '' }, characterRaces: [], characterClasses: [],
      isCharacterCreationInProgress: () => false,
      fetch: () => { throw new Error('The local start menu must not send a server command.'); }
    };
    vm.runInNewContext(`${display}\n${command}`, context);
    await context.chatbotprocessinput();
    assert.match(chat.innerHTML, /1\) Play as Mortacia/);
    assert.match(chat.innerHTML, /2\) Play as Suzerain/);
    assert.match(chat.innerHTML, /3\) Create character and play as a party of 7/);
  }
});

test('Save waits for the accepted startup task and applies its result once', async () => {
  const requests = [], result = { updatedGameConsole: 'Room Name: Ruined Temple Entrance', characterConfirmed: true };
  let polls = 0, applied = 0;
  await start({ character: { Name: 'Mortacia' } }, {
    request: async (url, options) => {
      requests.push({ url, method: options.method });
      const data = url === '/startGameWithCharacter' ? { taskId: 'start-1' } :
        ++polls < 3 ? { status: 'processing' } : { status: 'complete', result };
      return { ok: true, json: async () => data };
    }, pause: async () => {}, onResult: value => { assert.equal(value, result); applied++; }
  });
  assert.equal(applied, 1);
  assert.equal(requests.filter(r => r.method === 'POST').length, 1);
  assert.ok(requests.every(r => r.url === '/startGameWithCharacter' || r.url === '/poll-task2/start-1'));
});

test('startup task and request failures surface without submitting another command', async () => {
  let applied = false;
  const responses = [{ ok: true, taskId: 'failed' }, { ok: true, status: 'error', result: 'Undefined passed to retort template' }];
  await assert.rejects(start({}, {
    request: async () => { const response = responses.shift(); return { ok: response.ok, json: async () => response }; },
    onResult: () => { applied = true; }
  }), /Undefined passed/);
  assert.equal(applied, false);
  await assert.rejects(start({}, { request: async () => ({ ok: false, status: 409, json: async () => ({ error: 'Startup already running.' }) }) }), /Startup already running/);
});

test('first-room world fields are seeded before Retort while saved sheets remain separate', () => {
  const partial = 'Room Name: Ruined Temple Entrance\nCoordinates: X: 0, Y: 0, Z: 0\nTurns: 100\nPC: old character\nNPCs in Party: old NPC\nMonsters in Room: None';
  const result = buildInitialWorldConsole({ updatedGameConsole: partial, roomNameDatabaseString: '{"0,0,0":{"exits":{"east":{},"down":{}}}}' });
  assert.match(result.console, /^Exits: east, down$/m);
  assert.match(result.console, /^Turns: 0$/m);
  assert.match(result.console, /^Room Description: .+/m);
  assert.match(result.console, /^Monsters in Room: None$/m);
  assert.doesNotMatch(result.console, /old character|old NPC/);
  assert.throws(() => buildInitialWorldConsole({ updatedGameConsole: 'Coordinates: X: 1, Y: 0, Z: 0' }), /must start/);
});

test('startup sheets preserve preset names, zero stats, and legacy section boundaries', () => {
  const character = { Name: 'Mortacia', Sex: 'Female', Race: 'Goddess', Class: 'Assassin', HP: 0, MaxHP: 120 };
  const text = buildInitialGameConsole(buildInitialWorldConsole().console, character, [{ Name: 'Suzerain', HP: 24 }]);
  const pc = text.match(/PC:(.*?)(?=NPCs in Party:|$)/s)[1].trim().split('\n').map(line => line.trim());
  const npcs = text.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)[1].trim().split('\n').map(line => line.trim());
  assert.equal(pc.length, 14);
  assert.deepEqual(pc.slice(0, 4), ['Mortacia', 'Female', 'Goddess', 'Assassin']);
  assert.equal(pc[7], 'HP: 0');
  assert.equal(pc[8], 'MaxHP: 120');
  assert.equal(npcs.length, 14);
  assert.equal(npcs[0], 'Suzerain');
  assert.doesNotMatch(text, /undefined|\[object Object\]/);
});

test('startup response seeds complete room history before dialogue instead of using narrative as room state', async () => {
  const source = read('assets/game.js');
  const helpers = source.slice(source.indexOf('function getFirstResponseForRoom('), source.indexOf('// Initialize the currentCoordinates'));
  const description = 'The north courtyard opens east onto the ruined temple. A furnace warms the western shrine.';
  const world = buildInitialWorldConsole().console.replace(/^Room Description:.*$/m, `Room Description: ${description}`);
  const gameConsole = buildInitialGameConsole(world, { Name: 'Mortacia', HP: 120 });
  const coordinates = { x: 0, y: 0, z: 0 };
  const histories = {}, saved = [];
  const context = {
    console: quiet, currentCoordinates: coordinates, coordinatesToString: c => `${c.x},${c.y},${c.z}`,
    roomConversationHistories: histories, monstersInRoom: [], monstersEquippedProperties: [],
    db: { transaction: () => ({ objectStore: () => ({ add: value => saved.push(value) }) }) },
    saveRoomConversationHistory: (coords, entry) => histories['0,0,0'].push({ response: entry.response }),
    getPromptsAndResponsesForConversation: async () => saved
  };
  vm.runInNewContext(helpers, context);
  context.addPromptAndResponse('', '', '', 'Welcome, Mortacia.', '', 'test', gameConsole);
  let first = context.getFirstResponseForRoom(coordinates);
  assert.equal(first.roomName, 'Ruined Temple Entrance');
  assert.equal(first.roomHistory, description);
  context.addPromptAndResponse('ask monsters to join me', '', '', 'The monsters reply.', '', 'test', gameConsole);
  first = context.getFirstResponseForRoom(coordinates);
  assert.equal(first.roomName, 'Ruined Temple Entrance');
  assert.equal(first.roomHistory, description);
  assert.equal(first.puzzleInRoom, 'None');
  context.updateRoomConversationFirstResponse(coordinates, 'Room Name: undefined\nRoom Description: undefined');
  assert.equal(context.getFirstResponseForRoom(coordinates).roomHistory, description);
  histories['0,0,0'].unshift({ response: 'Older narrative-only entry' });
  assert.equal(context.getFirstResponseForRoom(coordinates).roomName, 'Ruined Temple Entrance');
  await new Promise(resolve => setImmediate(resolve));
});

test('labeled preset names are canonicalized before procedural sprites can replace selected art', () => {
  const source = read('assets/game.js');
  const preset = source.slice(source.indexOf('function isPresetSpriteCharacter('), source.indexOf('function proceduralNameKey('));
  const ensure = source.slice(source.indexOf('function ensureKnownSpritesInCombatList('), source.indexOf('function buildCombatEntryFromCharacter('));
  const selected = { dataUrl: 'data:mortacia-preset' };
  let generated = 0;
  const context = {
    PRESET_SPRITE_NAMES: ['mortacia', 'suzerain'], window: { createTraitSpriteCanvas() {} },
    getProceduralCharactersApi: () => ({}), resolveKnownCharacterSprite: () => selected,
    applyProceduralSpriteToEntry: entry => {
      if (!context.shouldUseProceduralSprite(entry)) return false;
      generated++;
      entry.sprite = { dataUrl: 'data:generic' };
      return true;
    }
  };
  vm.runInNewContext(`${preset}\n${ensure}`, context);
  const roster = [{ name: 'Name: Mortacia', type: 'pc', sprite: { dataUrl: 'data:bad', procedural: true } }];
  context.ensureKnownSpritesInCombatList(roster);
  assert.equal(roster[0].name, 'Mortacia');
  assert.equal(roster[0].sprite, selected);
  assert.equal(generated, 0);
  const other = [{ name: 'New Character', type: 'npc' }];
  context.ensureKnownSpritesInCombatList(other);
  assert.equal(generated, 1);
});

test('startup runs the complete console updater; dialogue retains monsters, equipment, stats and scene source', () => {
  const source = read('assets/game.js');
  const history = source.slice(source.indexOf('function getFirstResponseForRoom('), source.indexOf('// add a prompt, assistant prompt'));
  const matching = source.slice(source.indexOf('function findMatchingConsoleByCoordinates('), source.indexOf('// Keep track of visited room coordinates'));
  const update = source.slice(source.indexOf('function updateGameConsole('), source.indexOf('// Function to display PC data in the PC column'));
  const generateMonsters = source.slice(source.indexOf('function generateMonstersForRoom('), source.indexOf('// Helper function to parse monsters from the string'));
  const parseEquipped = source.slice(source.indexOf('function parseEquippedItems('), source.indexOf('// Function to find item properties from monstersEquippedProperties'));
  const ensurePC = source.slice(source.indexOf('function ensurePCProperties('), source.indexOf('// Ensure that npc properties exist'));
  const ensureNPC = source.slice(source.indexOf('function ensureNPCProperties('), source.indexOf('function getReverseExit('));
  const handoffStart = source.lastIndexOf('addPromptAndResponse(userInput, messages[0].content');
  const handoff = source.slice(handoffStart, source.indexOf('const formattedUpdatedGameConsole =', handoffStart));
  const retort = read('retort/retortWithUserInput.js');
  const gate = retort.slice(retort.indexOf('let hasRoomDungeon = false;'), retort.indexOf('if (isNewGeoRoom && roomDescription && !isAutoSimAdvance)'));
  const startingCharacter = { Name: 'Mortacia', Sex: 'Female', Race: 'Goddess', Class: 'Assassin', HP: 120, MaxHP: 120, Level: 50 };
  const names = ['Zharvok the Duskwither', 'Kaeltharion the Veiled Prophet', 'Zirethra the Veilcrawler', 'Valmortis the Chainbearer'];
  const sheets = names.map(Name => formatStartingCharacterSheet({ Name, Sex: 'Male', Race: 'Wraith', Class: 'Sentinel',
    Level: 8, HP: 34, MaxHP: 34, Attack: 0, Equipped: { Other: 'shadowglass orb' } })).join('\n');
  const properties = '{name: "shadowglass orb", type: "other", attack_modifier: 0, damage_modifier: 0, ac: 1, magic: 3}';
  const world = buildInitialWorldConsole().console
    .replace('Monsters in Room: None', `Monsters in Room: \n${sheets}`)
    .replace('Monsters Equipped Properties: None', `Monsters Equipped Properties: ${properties}`)
    .replace('Monsters State: None', 'Monsters State: Neutral')
    .replace('Current Quest: None', 'Current Quest: Restore the balance')
    .replace('Puzzle in Room: None', 'Puzzle in Room: Read the rune tablet')
    .replace('Puzzle Solution: None', 'Puzzle Solution: Speak the ancient oath')
    .replace('Objects in Room: None', 'Objects in Room: soulshard reaver');
  const npc = { Name: 'Suzerain', Level: 2, HP: 8, MaxHP: 8 };
  const initial = buildInitialGameConsole(world, { ...startingCharacter, HP: 128, MaxHP: 128 }, [{ ...npc, Level: 3, HP: 10, MaxHP: 12 }]);
  const logs = [];
  const context = {
    console: { ...quiet, info: (...args) => logs.push(args) }, window: {},
    coordinatesToString: c => `${c.x},${c.y},${c.z}`, roomConversationHistories: {},
    visitedRooms: new Set(), unvisitedRooms: new Set(), roomConnections: {},
    monstersInVisitedRooms: new Map(), monstersEquippedPropertiesByRoom: new Map(), monstersStateByRoom: new Map(),
    monstersInRoom: [], monstersEquippedProperties: [], characters: [startingCharacter], npcs: [npc],
    roomNameDatabase: new Map([['0,0,0', { name: 'Ruined Temple Entrance' }]]),
    equipmentItems: [], inventory: [], inventoryProperties: [], turns: 1,
    globalArtifactsFound: 0, globalQuestsAchieved: 0, nextArtifact: 'None', nextBoss: 'None',
    nextBossRoom: 'None', bossCoordinates: 'None', currentQuest: 'None',
    updateRoomConnections() {}, updateUnvisitedRoomsSet() {}, displayAllNPCData() {}, displayPCData() {},
    completeQuestIfArtifactFound() {}, calculateNumVisitedRooms: () => 1, calculateConnectedRooms: () => [],
    populateRoomNameDatabase() {}, mapToPlainObject: map => Object.fromEntries(map), roomNameDatabasePlainObject: {},
    generatePathToTarget: () => [], findNearestUnvisitedRoom: () => null,
    addPromptAndResponse: () => {}, userInput: '', messages: [{ content: '' }, { content: '' }],
    content: 'The four monsters watch Mortacia.', personalNarrative: '', conversationId: 'test',
    objectsInRoomString: '', completedStartResult: { characterConfirmed: true },
    currentCoordinates: { x: 0, y: 0, z: 0 }, conversationHistory: initial, serverGameConsole: initial, updatedGameConsole: initial,
    geoCoords: { x: 0, y: 0, z: 0 }, geoKey: '0,0,0', lastGeoKey: '0,0,0',
    isFirstTurn: false, isAutoSimAdvance: false, sceneInputFromConsole,
    sharedState: { getRoomDungeon: () => ({ layout: { width: 32, height: 32 }, cells: {}, sceneSpec: {
      source: sceneInputFromConsole(initial)
    } }) }
  };
  vm.runInNewContext(`${history}\n${matching}\n${generateMonsters}\n${parseEquipped}\n${ensurePC}\n${ensureNPC}\n${update}`, context);
  context.updateRoomConversationFirstResponse(context.geoCoords, initial);
  context.roomConversationHistories['0,0,0'].push({ response: 'Welcome.', roomEquipment: ['soulshard reaver'], objectMetadata: [] });
  vm.runInNewContext(handoff, context);
  assert.deepEqual(Array.from(context.monstersInVisitedRooms.get('0,0,0'), monster => monster.Name), names);
  assert.equal(startingCharacter.HP, 128);
  assert.equal(npc.Level, 3);
  assert.equal(npc.HP, 10);
  assert.equal(context.currentQuest, 'Restore the balance');
  assert.equal(context.monstersStateByRoom.get('0,0,0'), 'Neutral');
  const dialogue = context.updateGameConsole("ask monsters what has transpired in my absence and if they'll join me", context.geoCoords, initial);
  assert.equal(sceneInputFromConsole(dialogue).roomName, 'Ruined Temple Entrance');
  assert.equal(sceneInputFromConsole(dialogue).description, sceneInputFromConsole(initial).description);
  assert.match(dialogue, /PC: Mortacia\n/);
  for (const name of names) assert.ok(dialogue.includes(name));
  assert.match(dialogue, /Monsters State: Neutral/);
  assert.ok(dialogue.includes(properties));
  assert.match(dialogue, /Objects in Room: soulshard reaver/);
  assert.match(dialogue, /Puzzle in Room: Read the rune tablet/);
  assert.match(dialogue, /Puzzle Solution: Speak the ancient oath/);
  assert.doesNotMatch(dialogue, /Room (?:Name|Description): undefined/);
  context.updatedGameConsole = dialogue;
  context.roomDescription = sceneInputFromConsole(dialogue).description;
  vm.runInNewContext(gate, context);
  const decision = JSON.parse(logs.find(args => args[0] === '[DungeonEntry]')[1]);
  assert.equal(decision.build, false);
  assert.equal(decision.reason, 'cached-room');
});

test('real room/puzzle helper accepts missing monsters using Retort template validation', async () => {
  const source = read('retort/retortWithUserInput.js');
  const fn = source.slice(source.indexOf('async function generateMissingRoomDetails('), source.indexOf('// Ensure a room record exists'));
  const prompts = [];
  const tag = (strings, ...values) => { const text = templateContent(strings, ...values); prompts.push(text); return text; };
  let lastGeneration = '';
  const assistant = (strings, ...values) => { lastGeneration = tag(strings, ...values); return lastGeneration; };
  assistant.generation = async ({ maxTokens }) => ({ content: maxTokens === 60 ? '{"exhaustionLimit":4}' : maxTokens === 40 ? 'Desolate Court' : 'A carved stone depicts ash, ember and bone.' });
  const agent = { user: tag, assistant, run: callback => callback(agent) };
  const room = buildInitialWorldConsole().console.replace(/^Monsters in Room:.*\n?/m, '');
  const context = {
    console: quiet, updatedGameConsole: room, roomNameDatabaseString: '{}',
    ...require('../retort/worldContext'),
    ...require('../retort/environmentIntents'),
    ...require('../retort/bossGate'),
    coordinatesToString: c => `${c.x},${c.y},${c.z}`,
    generateDefaultClassification: async () => ({ indoor: true, size: 32, biome: 'temple', features: [] }),
    classifyDungeon: async () => ({ indoor: true, size: 32, biome: 'temple', features: [] }),
    generateRoomObjects: async () => [], applyLevelAndHpAdjustments: value => value,
    generateMonstersForRoomUsingGPT: async () => {},
    sharedState: { setRoomNameDatabase() {}, setUpdatedGameConsole() {}, getCurrentTasks: () => [], getLastQuestUpdate: () => '' }
  };
  vm.runInNewContext(fn, context);
  assert.equal(await context.generateMissingRoomDetails(agent), true);
  assert.ok(prompts.some(p => p.includes('current monsters in the room: None')));
  assert.ok(prompts.some(p => p.includes('For puzzle, tie to variability seed')));
  assert.match(context.updatedGameConsole, /^Puzzle Solution: A carved stone/m);
});

function roomPopulationHarness(room, database = {}, options = {}) {
  const source = read('retort/retortWithUserInput.js');
  const fn = source.slice(source.indexOf('async function generateMissingRoomDetails('), source.indexOf('// Ensure a room record exists'));
  const calls = [], logs = [], prompts = [];
  const tag = (strings, ...values) => {
    const text = templateContent(strings, ...values);
    prompts.push(text);
    return text;
  };
  const assistant = tag;
  assistant.generation = async ({ maxTokens }) => {
    calls.push(`text:${maxTokens}`);
    return { content: maxTokens === 60 ? '{"exhaustionLimit":4}' : maxTokens === 40 ? 'Ashen Court' : 'An ancient stone hall with a carved rune puzzle.' };
  };
  const agent = { user: tag, assistant, run: callback => callback(agent) };
  const context = {
    console: { ...quiet, info: (...args) => logs.push(args) }, updatedGameConsole: room, roomNameDatabaseString: JSON.stringify(database),
    parseSheets, Math: Object.assign(Object.create(Math), { random: options.random || Math.random }),
    ...require('../retort/worldContext'), ...require('../retort/environmentIntents'), ...require('../retort/bossGate'),
    coordinatesToString: c => `${c.x},${c.y},${c.z}`,
    generateDefaultClassification: async () => ({ indoor: true, size: 32, biome: 'temple', features: [] }),
    classifyDungeon: async () => ({ indoor: true, size: 32, biome: 'temple', features: [] }),
    generateRoomObjects: async () => { calls.push('objects'); return [{ name: 'ashen sword', type: 'weapon' }]; },
    generateObjectModifiers: async () => { calls.push('modifiers'); return { attack_modifier: 2, damage_modifier: 3, ac: 0, magic: 1 }; },
    applyLevelAndHpAdjustments: value => { calls.push('level'); return value; },
    generateMonstersForRoomUsingGPT: async () => {
      calls.push('monsters');
      context.updatedGameConsole = context.updatedGameConsole.replace(/^Monsters in Room:[^\n]*/m, 'Monsters in Room: Ash Sentinel');
    },
    sharedState: { setRoomNameDatabase(value) { context.committedRooms = value; }, setUpdatedGameConsole(value) { calls.push('console'); context.committedConsole = value; },
      getCurrentTasks: () => [], getLastQuestUpdate: () => '' }
  };
  vm.runInNewContext(fn, context);
  return { context, calls, logs, prompts, run: () => context.generateMissingRoomDetails(agent) };
}

test('one-exit startup with Adjacent Rooms: None runs the complete existing population pipeline', async () => {
  const room = buildInitialWorldConsole().console.replace(/^Exits:.*$/m, 'Exits: east');
  const { context, calls, prompts, run } = roomPopulationHarness(room);
  assert.equal(await run(), true);
  assert.deepEqual(calls.filter(call => !call.startsWith('text:')), ['objects', 'modifiers', 'level', 'monsters', 'console']);
  assert.match(context.committedConsole, /^Objects in Room: ashen sword$/m);
  assert.match(context.committedConsole, /name: "ashen sword", type: "weapon", attack_modifier: 2, damage_modifier: 3/);
  assert.match(context.committedConsole, /^Monsters in Room: Ash Sentinel$/m);
  assert.match(context.committedConsole, /^Adjacent Rooms: east: Ashen Court$/m);
  assert.match(context.committedConsole, /^Puzzle in Room: An ancient stone hall/m);
  assert.match(context.committedConsole, /^Puzzle Solution: An ancient stone hall/m);
  assert.equal(JSON.parse(context.roomNameDatabaseString)['1,0,0'].name, 'Ashen Court');
  assert.equal(JSON.parse(context.committedRooms)['0,0,0'].populationComplete, true);
  assert.ok(prompts.some(prompt => prompt.includes('You must store the following words into memory:')));
});

function sevenStartingCharacters() {
  return [
    ['Benedict', 'Male', 'High Elf', 'Sorcerer', 15, 0, 1],
    ['Becken Ralal Merak', 'Male', 'Half-Elf', 'Wizard', 9, 0, 1],
    ['Lyth', 'Male', 'Human', 'Barbarian', 18, 0, 1],
    ['Korna Caelora', 'Female', 'Unseelie Elf', 'Witch', 16, 0, 1],
    ['Fomurg Hiusira', 'Female', 'Half-Elf', 'Witch', 7, 0, 1],
    ['Loog', 'Male', 'Unseelie Elf', 'Barbarian', 9, 0, 1],
    ['Mortacia', 'Female', 'Goddess', 'Assassin-Fighter-Necromancer-Goddess', 129, 18816000, 50]
  ].map(([Name, Sex, Race, Class, HP, XP, Level]) => ({ Name, Sex, Race, Class, HP, XP, Level, MaxHP: HP,
    AC: Name === 'Mortacia' ? 13 : 10, Attack: 0, Damage: 0, Armor: 0, Magic: 0,
    Equipped: { Weapon: null, Armor: null, Shield: null, Other: null } }));
}

test('startup serializes PC and all six NPCs exactly like the original game.js sheet templates', () => {
  const source = read('assets/game.js');
  const pcTemplate = source.slice(source.indexOf('// Construct a string to represent all characters in the characters array'), source.indexOf('// Duplicate old start-menu block neutralized'));
  const npcTemplate = source.slice(source.indexOf('// Create a string representing NPCs and Mortacia'), source.indexOf('// Helper function to parse the Equipped string into an object'));
  const [pc, ...party] = sevenStartingCharacters();
  const original = vm.runInNewContext(`${pcTemplate}\n${npcTemplate}\n({ charactersString, npcsString });`, {
    characters: [structuredClone(pc)], npcs: structuredClone(party)
  });
  const text = buildInitialGameConsole(buildInitialWorldConsole().console, pc, party);
  const sheets = text.match(/PC:[\s\S]*?(?=Monsters in Room:)/)[0];
  assert.equal(sheets, `PC:\n${original.charactersString}\nNPCs in Party: ${original.npcsString}\n`);
});

for (const blankSeparators of [false, true]) {
  test(`full room population with the logged seven-character party${blankSeparators ? ' and blank sheet separators' : ''} preserves sheets and awards XP correctly`, async () => {
    const [pc, ...party] = sevenStartingCharacters();
    const world = buildInitialWorldConsole().console.replace(/^Exits:.*$/m, 'Exits: east');
    let room = buildInitialGameConsole(world, pc, party);
    if (blankSeparators) room = room.replace(/(NPCs in Party:)([\s\S]*?)(?=Monsters in Room:)/,
      (_, label, sheets) => label + sheets.replace(/\n(?=\w)/g, '\n\n'));
    const { context, calls, run } = roomPopulationHarness(room, {}, { random: () => 0.5 });
    assert.equal(await run(), true);
    assert.ok(calls.includes('monsters'));
    assert.match(context.committedConsole, /^Puzzle Solution: An ancient stone hall/m);
    const sheetSection = text => text.match(/PC:[\s\S]*?(?=Monsters in Room:)/)[0];
    const withoutXp = text => sheetSection(text).replace(/(^[ \t]*XP:)[ \t]*\d+/gm, '$1');
    assert.equal(withoutXp(context.committedConsole), withoutXp(room));
    const parsed = [
      ...parseSheets(context.committedConsole.match(/PC:([\s\S]*?)(?=NPCs in Party:)/)[1], 'pc'),
      ...parseSheets(context.committedConsole.match(/NPCs in Party:([\s\S]*?)(?=Monsters in Room:)/)[1], 'npc')
    ];
    assert.equal(parsed.length, 7);
    for (const [index, member] of parsed.entries()) {
      const before = [pc, ...party][index];
      assert.equal(member.name, before.Name);
      assert.equal(member.Class, before.Class);
      assert.equal(member.xp, before.XP + 142);
      assert.equal(member.hp, before.HP);
      assert.equal(member.maxhp, before.MaxHP);
      assert.equal(member.level, before.Level);
    }
  });
}

test('completed room population is not repeated for dialogue or a revisit, even after its monsters are gone', async () => {
  const room = buildInitialWorldConsole().console.replace(/^Exits:.*$/m, 'Exits: east')
    .replace(/^Adjacent Rooms:.*$/m, 'Adjacent Rooms: east: Ashen Court');
  const { context, calls, run } = roomPopulationHarness(room);
  assert.equal(await run(), false);
  assert.deepEqual(calls, []);
  assert.equal(context.updatedGameConsole, room);
});

test('a placeholder adjacent destination cannot satisfy the startup exit', async () => {
  const room = buildInitialWorldConsole().console.replace(/^Exits:.*$/m, 'Exits: east')
    .replace(/^Adjacent Rooms:.*$/m, 'Adjacent Rooms: east: None');
  const { context, logs, run } = roomPopulationHarness(room);
  assert.equal(await run(), true);
  const decision = JSON.parse(logs.find(args => args[0] === '[RoomPopulation]')[1]);
  assert.deepEqual(decision.missingAdjacentRooms, ['east']);
  assert.equal(decision.generate, true);
  const complete = JSON.parse(logs.filter(args => args[0] === '[RoomPopulation]')[1][1]);
  assert.equal(complete.generatedObjects, 1);
  assert.equal(complete.hasMonsters, true);
  assert.equal(complete.hasPuzzle, true);
  assert.match(context.committedConsole, /^Adjacent Rooms: east: Ashen Court$/m);
});

test('a literal None room description still requires population when all exits are named', async () => {
  const room = buildInitialWorldConsole().console.replace(/^Exits:.*$/m, 'Exits: east')
    .replace(/^Room Description:.*$/m, 'Room Description: None')
    .replace(/^Adjacent Rooms:.*$/m, 'Adjacent Rooms: east: Ashen Court');
  const { context, calls, run } = roomPopulationHarness(room);
  assert.equal(await run(), true);
  assert.ok(calls.includes('monsters'));
  assert.match(context.committedConsole, /^Room Description: An ancient stone hall/m);
});

test('population checks missing directions rather than the count of adjacent entries', async () => {
  const room = buildInitialWorldConsole().console.replace(/^Exits:.*$/m, 'Exits: north, east')
    .replace(/^Adjacent Rooms:.*$/m, 'Adjacent Rooms: north: Crypt, west: Court');
  const { context, calls, run } = roomPopulationHarness(room);
  assert.equal(await run(), true);
  assert.ok(calls.includes('monsters'));
  assert.match(context.updatedGameConsole, /^Adjacent Rooms: north: .*east: Ashen Court$/m);
});

test('real startup followed by a new missing neighbor repairs only that neighbor on a revisit', async () => {
  const [pc, ...party] = sevenStartingCharacters();
  const room = buildInitialGameConsole(buildInitialWorldConsole().console.replace(/^Exits:.*$/m, 'Exits: east'), pc, party);
  const { context, calls, logs, run } = roomPopulationHarness(room, {}, { random: () => 0.5 });
  assert.equal(await run(), true);
  const database = JSON.parse(context.committedRooms);
  Object.assign(database['0,0,0'], { attemptedSearches: 3, exhaustionLimit: 6, trapTriggered: true });
  context.roomNameDatabaseString = JSON.stringify(database);
  context.updatedGameConsole = context.committedConsole
    .replace(/^Exits:.*$/m, 'Exits: east, north')
    .replace(/^Adjacent Rooms:.*$/m, 'Adjacent Rooms: east: Ashen Court, north: None')
    .replace(/^Monsters in Room:.*$/m, 'Monsters in Room: None');
  const before = context.updatedGameConsole;
  calls.length = 0;
  logs.length = 0;
  assert.equal(await run(), false, 'Neighbor repair is not a newly generated description');
  assert.deepEqual(calls, ['text:40', 'console']);
  assert.equal(context.committedConsole, before.replace('north: None', 'north: Ashen Court'));
  const after = JSON.parse(context.committedRooms);
  assert.equal(after['0,0,0'].attemptedSearches, 3);
  assert.equal(after['0,0,0'].exhaustionLimit, 6);
  assert.equal(after['0,0,0'].trapTriggered, true);
  assert.deepEqual(after['1,0,0'], database['1,0,0']);
  assert.equal(after['0,1,0'].name, 'Ashen Court');
  assert.equal(after['0,1,0'].populationComplete, undefined, 'New neighbor skeletons still need their own first population');
  assert.equal(JSON.parse(logs.find(args => args[0] === '[RoomPopulation]')[1]).generate, false);
  calls.length = 0;
  const completed = context.committedConsole;
  assert.equal(await run(), false);
  assert.deepEqual(calls, []);
  assert.equal(context.updatedGameConsole, completed);
});

for (const lineEnding of ['\n', '\r\n']) {
  test(`legacy described revisit repairs named targets without changing character sheets or any other console text (${JSON.stringify(lineEnding)})`, async () => {
    const [pc, ...party] = sevenStartingCharacters();
    const world = buildInitialWorldConsole().console
      .replace(/^Room Name:.*$/m, 'Room Name: The Remembered Crypt')
      .replace(/^Room Description:.*$/m, 'Room Description: A carved crypt retains the marks of earlier exploration.')
      .replace(/^Coordinates:.*$/m, 'Coordinates: X: -4, Y: 8, Z: -1')
      .replace(/^Exits:.*$/m, 'Exits: north, east')
      .replace(/^Adjacent Rooms:.*$/m, 'Adjacent Rooms: north: None, east: None')
      .replace(/^Objects in Room:.*$/m, 'Objects in Room: old key')
      .replace(/^Objects in Room Properties:.*$/m, 'Objects in Room Properties: {name: "old key", type: "key", magic: 0}')
      .replace(/^Puzzle in Room:.*$/m, 'Puzzle in Room: The opened seal is silent.')
      .replace(/^Puzzle Solution:.*$/m, 'Puzzle Solution: Solved with the old key.')
      .replace(/^Monsters in Room:.*$/m, `Monsters in Room:\n${formatStartingCharacterSheet({ Name: 'Old Guardian', HP: 0, XP: 1234 })}`);
    const room = buildInitialGameConsole(world, pc, party).replace(/\n/g, lineEnding);
    const source = { name: 'The Remembered Crypt', attemptedSearches: 5, exhaustionLimit: 6, trapTriggered: true,
      objects: [{ name: 'old key', type: 'key' }], monsters: { inRoom: 'None', state: 'Defeated' },
      indoor: true, classification: { indoor: true, size: 32, biome: 'crypt', features: [] },
      exits: { north: { status: 'locked', targetCoordinates: '-4,9,-1', key: 'old key', attempts: 2 },
        east: { status: 'sealed', targetCoordinates: '17,-6,2', key: 'quest seal', questLocked: true } } };
    const north = { name: 'Known Crypt', description: 'Previously visited.', objects: [{ name: 'urn' }],
      monsters: { inRoom: 'None' }, classification: { indoor: true }, indoor: true, isIndoor: true, isOutdoor: false };
    const east = { ...structuredClone(north), name: 'Remote Court' };
    const { context, calls, run } = roomPopulationHarness(room, { '-4,8,-1': source, '-4,9,-1': north, '17,-6,2': east });
    assert.equal(await run(), false);
    assert.deepEqual(calls, ['console'], 'Known names require no generation, population or XP calls');
    assert.equal(context.committedConsole, room.replace('north: None, east: None', 'north: Known Crypt (locked), east: Remote Court (sealed)'));
    const after = JSON.parse(context.committedRooms);
    assert.deepEqual(after['-4,8,-1'], { ...source, isIndoor: true, isOutdoor: false, populationComplete: true });
    assert.deepEqual(after['-4,9,-1'], north);
    assert.deepEqual(after['17,-6,2'], east);
    assert.equal(after['-3,8,-1'], undefined, 'An authoritative non-grid target must not be redirected');
  });
}

for (const evidence of [{ populationComplete: true }, { visited: true },
  { sceneSpec: { source: { description: 'A previously constructed temple.' } } }]) {
  test(`saved first-room boilerplate with ${Object.keys(evidence)[0]} repairs its sole first exit without repopulation`, async () => {
    const room = buildInitialWorldConsole().console.replace(/^Exits:.*$/m, 'Exits: east')
      .replace(/^Adjacent Rooms:.*$/m, 'Adjacent Rooms: east: None');
    const current = { ...evidence, name: 'Ruined Temple Entrance', attemptedSearches: 4,
      exits: { east: { status: 'open', targetCoordinates: '1,0,0', key: null } } };
    const { context, calls, run } = roomPopulationHarness(room, { '0,0,0': current });
    assert.equal(await run(), false);
    assert.deepEqual(calls, ['text:40', 'console']);
    assert.equal(context.committedConsole, room.replace('east: None', 'east: Ashen Court'));
    const after = JSON.parse(context.committedRooms);
    assert.equal(after['0,0,0'].attemptedSearches, 4);
    assert.deepEqual(after['0,0,0'].exits, current.exits);
    assert.equal(after['1,0,0'].name, 'Ashen Court');
  });
}

test('first-room neighbor repair retains the outdoor entrance skeleton and leaves known indoor neighbors untouched', async () => {
  const room = buildInitialWorldConsole().console
    .replace(/^Adjacent Rooms:.*$/m, 'Adjacent Rooms: north: None, down: Known Crypt');
  const current = { populationComplete: true, name: 'Ruined Temple Entrance', attemptedSearches: 2,
    exits: { down: { status: 'open', targetCoordinates: '0,0,-1', key: null } } };
  const crypt = { name: 'Known Crypt', description: 'A previously visited crypt.', attemptedSearches: 5,
    objects: [{ name: 'old relic' }], monsters: { inRoom: 'None' },
    indoor: true, isIndoor: true, isOutdoor: false, classification: { indoor: true, biome: 'crypt' } };
  const { context, calls, run } = roomPopulationHarness(room, { '0,0,0': current, '0,0,-1': crypt });
  assert.equal(await run(), false);
  assert.deepEqual(calls, ['text:40', 'console']);
  assert.equal(context.committedConsole, room.replace('north: None', 'north: Ashen Court'));
  const after = JSON.parse(context.committedRooms);
  assert.equal(after['0,1,0'].indoor, false);
  assert.equal(after['0,1,0'].classification.biome, 'wasteland');
  assert.deepEqual(after['0,0,-1'], crypt);
  assert.equal(after['0,0,0'].attemptedSearches, 2);
});

test('a nameless existing neighbor is named without replacing its content or shape', async () => {
  const room = buildInitialWorldConsole().console
    .replace(/^Room Description:.*$/m, 'Room Description: A hall explored long ago.')
    .replace(/^Exits:.*$/m, 'Exits: east')
    .replace(/^Adjacent Rooms:.*$/m, 'Adjacent Rooms: east: None');
  const neighbor = { name: 'None', attemptedSearches: 6, exhaustionLimit: 6, trapTriggered: true,
    objects: [{ name: 'protected relic' }], monsters: { inRoom: 'Ancient Guardian' },
    indoor: false, isIndoor: false, isOutdoor: true, classification: { indoor: false, biome: 'forest' } };
  const { context, calls, run } = roomPopulationHarness(room, { '1,0,0': neighbor });
  assert.equal(await run(), false);
  assert.deepEqual(calls, ['text:40', 'console']);
  assert.equal(context.committedConsole, room.replace('east: None', 'east: Ashen Court'));
  assert.deepEqual(JSON.parse(context.committedRooms)['1,0,0'], { ...neighbor, name: 'Ashen Court' });
});

test('Dungeon Test resets to OFF despite a previously saved ON setting, with manual opt-in retained', () => {
  const html = read('assets/index.html');
  const fn = html.slice(html.indexOf('function updateDungeonTestingButton('), html.indexOf('function scrollToBottom('));
  const storage = new Map([['dungeonTestingMode', 'true']]), requests = [], button = {};
  const context = { window: {}, console: quiet, document: { getElementById: () => button },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: (url, options) => { requests.push({ url, ...JSON.parse(options.body) }); return Promise.resolve({ ok: true }); }
  };
  vm.runInNewContext(fn, context);
  context.initDungeonTestingMode();
  assert.equal(context.window.dungeonTestingMode, false);
  assert.equal(storage.get('dungeonTestingMode'), 'false');
  assert.equal(button.textContent, 'Dungeon Test: OFF');
  assert.deepEqual(requests[0], { url: '/set-dungeon-testing-mode', enabled: false });
  context.toggleDungeonTestingMode();
  assert.equal(context.window.dungeonTestingMode, true);
  assert.equal(button.textContent, 'Dungeon Test: ON');
  assert.equal(requests[1].enabled, true);
  context.initDungeonTestingMode();
  assert.equal(context.window.dungeonTestingMode, false);
});

test('startup dependencies load before game.js and inline startup handlers parse', () => {
  const html = read('assets/index.html');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  for (const dependency of ['/assets/roomDatabaseSync.js', '/assets/characterStartup.js']) assert.ok(scripts.indexOf(dependency) >= 0 && scripts.indexOf(dependency) < scripts.indexOf('/assets/game.js'), dependency);
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script.trim()) new vm.Script(script);
});

test('saved-character UI waits on startup and consumes its completion without a new task', async () => {
  const source = read('assets/game.js');
  const fn = source.slice(source.indexOf('window.startReviewedGame ='), source.indexOf('async function syncGameStateBeforeCommand('));
  const result = { updatedGameConsole: 'Room Name: Ruined Temple Entrance' };
  let calls = 0;
  const context = {
    window: { CharacterStartup: { start: async (payload, options) => {
      calls++;
      assert.equal(context.window._characterStartupPending, true);
      assert.equal(payload.initialState.updatedGameConsole, 'Initial room console');
      assert.equal(await context.window.startReviewedGame({}), undefined);
      await options.onResult(result); return result;
    } } }, currentCoordinates: { x: 9, y: 9, z: 9 },
    updateGameConsole: () => 'Initial room console', mapToPlainObject: () => ({}), roomNameDatabase: new Map(), updateChatLog() {},
    chatbotprocessinput: async value => { assert.equal(value.completedStartResult, result); }
  };
  vm.runInNewContext(fn, context);
  await context.window.startReviewedGame({ character: { Name: 'Mortacia' } });
  assert.equal(calls, 1); assert.equal(context.window._characterStartupPending, false);
  assert.equal(context.window._statsRolled, true);
});

test('server startup seeds a complete world and releases its lock after a task error', async () => {
  const source = read('server.js'), tasks = new Map(), routes = new Map();
  const values = {};
  const context = {
    app: { post: (url, handler) => routes.set(url, handler) }, inputTaskInFlight: false, tasks,
    console: quiet, broadcast() {}, roomDatabaseReceiver: { reset() {} }, buildInitialWorldConsole, buildInitialGameConsole,
    actionDice: { end() { values.diceEnded = true; } },
    sharedState: {
      getCombatMode: () => 'Combat Map-Based', beginDungeonRun: () => 'new-run', setCurrentPC() {},
      setCharacterGenerationInProgress() {}, setPendingCharacterForReview() {}, setCombatCharactersString() {},
      setUpdatedGameConsole: v => { values.console = v; }, setRoomNameDatabase: v => { values.rooms = v; }, setPersonalNarrative() {}
    },
    retortWithUserInput: async () => {
      assert.equal(context.inputTaskInFlight, true);
      assert.match(values.console, /^Room Name: Ruined Temple Entrance$/m);
      assert.match(values.console, /^Monsters in Room: None$/m);
      assert.match(values.console, /^Coordinates: X: 0, Y: 0, Z: 0$/m);
      assert.match(values.console, /PC:\nMortacia\n/);
      assert.ok(values.console.indexOf('PC:') < values.console.indexOf('NPCs in Party:'));
      assert.ok(values.console.indexOf('NPCs in Party:') < values.console.indexOf('Monsters in Room:'));
      throw new Error('Test generation failure');
    }
  };
  const first = source.indexOf("app.post('/startGameWithCharacter'");
  const end = source.indexOf('// Dedicated endpoint to begin', first);
  vm.runInNewContext(source.slice(first, end), context);
  let accepted;
  await routes.get('/startGameWithCharacter')({ body: { character: { Name: 'Mortacia', HP: 120 } } }, {
    status(code) { assert.equal(code, 202); return this; }, json(data) { accepted = data; }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tasks.get(accepted.taskId).status, 'error');
  assert.equal(tasks.get(accepted.taskId).result, 'Test generation failure');
  assert.equal(context.inputTaskInFlight, false);
  assert.equal(values.diceEnded, true);
});
