const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { applyAdditionalOutcomes, parseObjectProperties, selectCommandedNpcs } = require('../retort/adjudicationState');
const { buildInitialWorldConsole, buildInitialGameConsole } = require('../retort/initialGameState');
const { parseSheets } = require('../assets/partyRoster');
const { ActionDice } = require('../retort/actionDice');
const { taskBinding, evaluateTaskRequirements } = require('../retort/questProgress');
const { ensureBossGate, seedBossKey } = require('../retort/bossGate');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const source = read('retort/retortWithUserInput.js');
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const startingConsole = () => buildInitialGameConsole(buildInitialWorldConsole().console, {
  Name: 'Mortacia', HP: 20, MaxHP: 20, XP: 100
}, [{ Name: 'Zarthul the Veiled Sentinel', HP: 10, MaxHP: 12, XP: 200 }, { Name: 'Ally (A)', HP: 8, XP: 0 }])
  .replace('Room Description:', 'Room Description: Zarthul the Veiled Sentinel and Mortacia are here.')
  .replace('Exits: north, down', 'Exits: south');
const discovery = {
  new_objects: ['ethereal bloom'], object_modifiers: { 'ethereal bloom': { type: 'other', magic: 2 } },
  new_exit: 'north', new_adjacent_room: { name: 'Garden of Vows' }, coordinates_of_connected_rooms: { x: 0, y: 1, z: 0 },
  xp_awarded: { Mortacia: 50, 'Zarthul the Veiled Sentinel': 125 }, trap_damage: {}
};
const sheets = text => [...parseSheets(text.match(/PC:([\s\S]*?)NPCs in Party:/)[1], 'pc'),
  ...parseSheets(text.match(/NPCs in Party:([\s\S]*?)Monsters in Room:/)[1], 'npc')];

function bossFixture() {
  const text = startingConsole().replace(/^Next Boss:.*$/m, 'Next Boss: The Bound Regent')
    .replace(/^Next Boss Room:.*$/m, 'Next Boss Room: Sanctuary of Oaths')
    .replace(/^Next Artifact:.*$/m, 'Next Artifact: Bound Relic')
    .replace(/^Current Quest:.*$/m, 'Current Quest: Recover the bound relic.') + '\nBoss Room Coordinates: X: 1, Y: 0, Z: 0';
  const database = {
    '0,0,0': { name: 'Temple', objects: [], exits: {
      east: { status: 'open', targetCoordinates: '1,0,0', hint: 'Fixed boss approach' },
      north: { status: 'sealed', targetCoordinates: '0,1,0', key: 'ordinary brass key', locks: { puzzle: true } }
    } },
    '1,0,0': { name: 'Sanctuary of Oaths', objects: [], classification: { indoor: true, biome: 'temple' },
      monsters: { inRoom: 'The Bound Regent', consoleBlock: 'The Bound Regent\nHP: 90' },
      exits: { west: { status: 'open', targetCoordinates: '0,0,0' } } },
    '2,0,0': { name: 'Other Approach', objects: [], exits: {
      west: { status: 'blocked', targetCoordinates: { x: 1, y: 0, z: 0 }, key: 'old boss key', hint: 'Keep' }
    } },
    '0,1,0': { name: 'Ordinary Locked Room', objects: [], exits: {} }
  };
  return { text, database };
}

test('burial discovery commits the item, modifiers and connected exit without altering scene geometry metadata', () => {
  const database = { '0,0,0': { name: 'Ruined Temple Entrance', objects: [], exits: {}, classification: { biome: 'temple' },
    sceneSpec: { source: { description: 'Existing description' } }, blueprint: { seed: 123 }, attemptedSearches: 4 } };
  const before = JSON.stringify(database);
  const result = applyAdditionalOutcomes(discovery, startingConsole(), database);
  assert.match(result.console, /^Objects in Room: ethereal bloom$/m);
  assert.match(result.console, /^Exits: south, north$/m);
  assert.match(result.console, /^Adjacent Rooms: north: Garden of Vows$/m);
  assert.match(result.console, /^Coordinates of Connected Rooms: 0,1,0$/m);
  assert.equal(parseObjectProperties(result.console.match(/^Objects in Room Properties: (.*)$/m)[1])[0].magic, 2);
  assert.equal(result.database['0,0,0'].objects[0].properties.magic, 2);
  assert.equal(result.database['0,0,0'].exits.north.targetCoordinates, '0,1,0');
  assert.equal(result.database['0,1,0'].exits.south.targetCoordinates, '0,0,0');
  assert.deepEqual(result.database['0,0,0'].blueprint, database['0,0,0'].blueprint);
  assert.deepEqual(result.database['0,0,0'].sceneSpec, database['0,0,0'].sceneSpec);
  assert.equal(JSON.stringify(database), before);
  assert.deepEqual(sheets(result.console).map(c => c.xp), [150, 325, 0]);
});

test('XP and damage apply to exact character sheets, not names in prose or regex metacharacters', () => {
  const result = applyAdditionalOutcomes({ xp_awarded: { 'Ally (A)': '25', Mortacia: '10', Stranger: 999 },
    trap_damage: { Mortacia: 7, 'Zarthul the Veiled Sentinel': 20 } }, startingConsole());
  assert.deepEqual(sheets(result.console).map(c => [c.name, c.xp, c.hp]), [
    ['Mortacia', 110, 13], ['Zarthul the Veiled Sentinel', 200, 0], ['Ally (A)', 25, 8]
  ]);
  assert.equal(Object.hasOwn(result.xp, 'Stranger'), false);
});

test('the first NPC receives adjudication updates in the original same-line and older separate-line formats without reformatting sheets', () => {
  for (const inline of [true, false]) {
    const original = inline ? startingConsole() : startingConsole().replace('NPCs in Party: Zarthul', 'NPCs in Party: \nZarthul');
    const result = applyAdditionalOutcomes({ xp_awarded: { 'Zarthul the Veiled Sentinel': 25 },
      trap_damage: { 'Zarthul the Veiled Sentinel': 3 } }, original);
    assert.deepEqual(sheets(result.console).map(c => [c.name, c.xp, c.hp]), [
      ['Mortacia', 100, 20], ['Zarthul the Veiled Sentinel', 225, 7], ['Ally (A)', 0, 8]
    ]);
    const before = original.match(/PC:[\s\S]*?(?=Monsters in Room:)/)[0];
    const after = result.console.match(/PC:[\s\S]*?(?=Monsters in Room:)/)[0];
    assert.equal(after, before.replace('XP: 200', 'XP: 225').replace('HP: 10', 'HP: 7'));
  }
});

test('duplicate discoveries, locked exits, revisits and invalid outcomes cannot corrupt existing room data', () => {
  const first = applyAdditionalOutcomes({ ...discovery, xp_awarded: {} }, startingConsole());
  first.database['0,0,0'].exits.north.status = 'locked';
  const again = applyAdditionalOutcomes({ ...discovery, new_objects: ['Ethereal Bloom'], xp_awarded: {} }, first.console, first.database);
  assert.equal(again.database['0,0,0'].objects.length, 1);
  assert.equal(again.database['0,0,0'].exits.north.status, 'locked');
  assert.equal(again.database['0,1,0'].name, 'Garden of Vows');
  const before = JSON.stringify(first.database);
  assert.throws(() => applyAdditionalOutcomes({ ...discovery, new_exit: 'teleport' }, first.console, first.database), /direction/);
  assert.throws(() => applyAdditionalOutcomes({ ...discovery, coordinates_of_connected_rooms: { x: 99 } }, first.console, first.database), /coordinates/);
  assert.throws(() => applyAdditionalOutcomes({ trap_damage: { Mortacia: -5 } }, first.console, first.database), /Invalid/);
  assert.equal(JSON.stringify(first.database), before);
});

test('discovered item modifiers survive the existing room-entry synchronizer on revisits', async () => {
  const outcomes = { ...discovery, object_modifiers: { 'ethereal bloom': { type: 'other', attack_modifier: 2, damage_modifier: 3, ac: 1, magic: 2 } } };
  const first = applyAdditionalOutcomes(outcomes, startingConsole());
  const sync = source.slice(source.indexOf('async function syncObjectsOnRoomEntry('), source.indexOf('function hasHostileMonsters('));
  const context = { console: quiet, coordinatesToString: c => `${c.x},${c.y},${c.z}`,
    getRoomSafe: (db, key) => db[key], ensureAllRoomsClassified() {} };
  vm.runInNewContext(sync, context);
  const revisit = await context.syncObjectsOnRoomEntry({}, { x: 0, y: 0, z: 0 }, first.database, startingConsole());
  const props = parseObjectProperties(revisit.match(/^Objects in Room Properties: (.*)$/m)[1])[0];
  assert.deepEqual([props.attack_modifier, props.damage_modifier, props.ac, props.magic], [2, 3, 1, 2]);
  assert.match(revisit, /Objects in Room: ethereal bloom/);
});

test('named NPC commands recognize unambiguous short names without accidentally selecting similar names', () => {
  const names = ['Zarthul the Veiled Sentinel', 'Zartha', 'Ally (A)'];
  assert.deepEqual(selectCommandedNpcs('tell Zarthul to prepare burial rites', names), ['Zarthul the Veiled Sentinel']);
  assert.deepEqual(selectCommandedNpcs('ask Zartha about Zarthul', names), names.slice(0, 2));
  assert.deepEqual(selectCommandedNpcs('bury the dead', names), []);
  assert.deepEqual(selectCommandedNpcs('tell Zarthul to bury them', ['Zarthul One', 'Zarthul Two']), []);
});

test('real simulation commits once across retries, and the turn hands the updated console to quest processing', async () => {
  const resolve = source.slice(source.indexOf('async function resolveActionWithSimulation('), source.indexOf('async function adjudicateActionWithPythonSimulation('));
  const process = source.slice(source.indexOf('function processGameUpdate('), source.indexOf('async function adjudicateActionWithCodeInterpreter('));
  const narrative = source.slice(source.indexOf('function generateNarrative('), source.indexOf('async function generateOutcomes('));
  let database = '{}', sharedConsole = startingConsole(), commits = 0, rolled = 0, generated = 0, metadataAttempts = 0;
  const context = {
    console: quiet, applyAdditionalOutcomes, taskBinding,
    generateOutcomes: async () => { rolled++; return { Outcomes: [{ character: 'Zarthul', outcome: 'Performs burial rites.' }] }; },
    generateAdditionalOutcomes: async () => { generated++; return discovery; },
    sharedState: { getCurrentTasks: () => [], getRoomNameDatabase: () => database,
      setRoomNameDatabase: value => { database = value; }, setUpdatedGameConsole: value => { commits++; sharedConsole = value; },
      setLastAdjudication: () => { if (metadataAttempts++ === 0) throw Error('Test transient metadata failure'); } },
    setTimeout: fn => setImmediate(fn)
  };
  vm.runInNewContext(`${process}\n${narrative}\n${resolve}`, context);
  const result = await context.resolveActionWithSimulation({}, 'tell Zarthul to perform burial rites', startingConsole(), null, 2, 0);
  assert.equal(commits, 1);
  assert.equal(rolled, 1);
  assert.equal(generated, 1);
  assert.equal(metadataAttempts, 2);
  assert.equal(result.updatedGameConsole, sharedConsole);
  assert.equal(sheets(sharedConsole)[0].xp, 150);
  assert.match(result.narrative, /ethereal bloom/);
  const second = context.generateNarrative({ Outcomes: [{ character: 'Mortacia', outcome: 'Waits.' }] }, {}, 'wait');
  assert.doesNotMatch(second, /ethereal bloom/);
  const start = source.indexOf('currentSituation = await adjudicateActionWithSimulation(');
  const handoff = source.slice(start, source.indexOf('formattedCurrentSituation =', start));
  context.currentSituation = null; context.updatedGameConsole = startingConsole(); context.roomNameDatabaseString = '{}';
  context.$ = {}; context.userInput = 'tell Zarthul to perform burial rites';
  context.adjudicateActionWithSimulation = async () => result;
  await vm.runInNewContext(`(async () => { ${handoff} })()`, context);
  assert.match(context.updatedGameConsole, /Objects in Room: ethereal bloom/);
  assert.equal(context.roomNameDatabaseString, database);
});

for (const scenario of ['discovery', 'failed search', 'exhausted', 'dialogue', 'missing quest prerequisites']) {
  test(`real additional-outcome planner and commit: ${scenario}`, async () => {
    const fn = source.slice(source.indexOf('async function generateAdditionalOutcomes('), source.indexOf('// LLM-only gate'));
    let database = JSON.stringify({ '0,0,0': { name: 'Temple', objects: [], exits: {},
      attemptedSearches: scenario === 'exhausted' ? 4 : 0, exhaustionLimit: 4, trapTriggered: false, blueprint: { seed: 'keep' } } });
    let consoleText = startingConsole();
    const flags = { engagedInDialogue: scenario === 'dialogue' ? 'true' : 'false', justLooking: 'false',
      searchAttempted: true, searchSuccessful: scenario !== 'failed search',
      objectDiscovered: scenario === 'dialogue' ? 'false' : scenario !== 'failed search',
      exitDiscovered: scenario === 'dialogue' ? 'false' : scenario !== 'failed search' };
    const prompts = [];
    const responses = [JSON.stringify({ questAttempted: scenario === 'missing quest prerequisites' ? 'true' : 'false' }),
      JSON.stringify(flags), scenario === 'discovery' ? '{"Mortacia":50,"Zarthul the Veiled Sentinel":125}' : '{}',
      '{"count":1}', '{"name":"ethereal bloom"}', '{"type":"other"}', '{"name":"Garden of Vows"}'];
    const agent = { user: (parts, ...values) => { prompts.push(parts.reduce((text, part, i) => text + part + (values[i] ?? ''), '')); },
      assistant: { generation: async () => ({ content: responses.shift() || '{}' }) } };
    const context = { console: quiet, parseSheets, evaluateTaskRequirements, generateObjectModifiers: async () => ({ magic: 2 }),
      Math: Object.assign(Object.create(Math), { random: () => 0 }),
      sharedState: { getRoomNameDatabase: () => database, setRoomNameDatabase: value => { database = value; },
        setUpdatedGameConsole: value => { consoleText = value; } } };
    vm.runInNewContext(fn, context);
    const task = scenario === 'missing quest prerequisites' ? { type: 'Puzzle', actionKind: 'solve_puzzle',
      hardRequirements: [{ check: 'inventory_contains', value: 'magic rope' }] } : null;
    const additional = await context.generateAdditionalOutcomes(agent, { Action: scenario === 'dialogue' ? 'Dialogue' : 'Search' }, startingConsole(), 'perform rites', task);
    const result = applyAdditionalOutcomes(additional, startingConsole(), JSON.parse(database));
    if (scenario === 'discovery') {
      assert.match(result.console, /Objects in Room: ethereal bloom/);
      assert.match(result.console, /Exits: south, north/);
      assert.deepEqual(sheets(result.console).map(c => c.xp), [150, 325, 0]);
      assert.ok(prompts.some(p => p.includes('Mortacia, Zarthul the Veiled Sentinel, Ally (A)')));
    } else {
      assert.equal(additional.new_objects.length, 0);
      assert.equal(additional.new_exit, '');
    }
    if (scenario === 'failed search' || scenario === 'missing quest prerequisites') {
      assert.deepEqual(sheets(result.console).map(c => c.hp), [19, 9, 7]);
      assert.deepEqual(sheets(consoleText).map(c => c.hp), [20, 10, 8]); // planner must not apply damage a first time
      assert.equal(result.database['0,0,0'].trapTriggered, true);
    }
    if (scenario === 'exhausted' || scenario === 'dialogue') assert.deepEqual(sheets(result.console).map(c => c.hp), [20, 10, 8]);
    assert.equal(result.database['0,0,0'].blueprint.seed, 'keep');
  });
}

test('cancelled exploration roll makes no discoveries, awards, damage or additional model calls', async () => {
  const resolve = source.slice(source.indexOf('async function resolveActionWithSimulation('), source.indexOf('async function adjudicateActionWithPythonSimulation('));
  const context = { console: quiet, sharedState: { getCurrentTasks: () => [] },
    generateOutcomes: async () => ({ cancelled: true, reason: 'No roll was made.' }),
    generateAdditionalOutcomes: () => { throw Error('Cancelled actions must not generate effects.'); } };
  vm.runInNewContext(resolve, context);
  const result = await context.resolveActionWithSimulation({}, 'perform rites', startingConsole());
  assert.equal(result.updatedGameConsole, startingConsole());
  assert.match(result.narrative, /No roll/);
});

test('real outcome generator makes the named NPC roll when addressed by a unique short name', async () => {
  const fn = source.slice(source.indexOf('async function generateOutcomes('), source.indexOf('async function generateAdditionalOutcomes('));
  const dice = new ActionDice({ random: () => 20, animationMs: 0 });
  dice.begin('exploration', '0,0,0');
  const responses = ['{"action":"Dialogue"}', '- "Zarthul the Veiled Sentinel":\n1. Dice roll range 1-6: Declines.\n2. Dice roll range 7-14: Prepares the grave.\n3. Dice roll range 15-20: Performs the rites.'];
  const agent = { user() {}, assistant: { generation: async () => ({ content: responses.shift() }) } };
  const context = { console: quiet, parseSheets, selectCommandedNpcs, actionDice: dice,
    sharedState: { getRoomNameDatabase: () => '{}' } };
  vm.runInNewContext(fn, context);
  const result = await context.generateOutcomes(agent, 'tell Zarthul to prepare burial rites', startingConsole());
  assert.deepEqual(Array.from(result['Selected Characters']), ['Zarthul the Veiled Sentinel']);
  assert.equal(result.Outcomes[0].outcome, 'Performs the rites.');
  assert.equal(dice.snapshot().pending, null);
  assert.equal(dice.snapshot().results[0].actor, 'Zarthul the Veiled Sentinel');
  dice.end();
});

test('HP/XP commit also updates living combat actors and removes a trap-killed actor', () => {
  const fn = source.slice(source.indexOf('function processGameUpdate('), source.indexOf('async function adjudicateActionWithCodeInterpreter('));
  let consoleText = startingConsole(), database = '{}';
  let roster = JSON.stringify([{ name: 'Mortacia', hp: 20, mazeX: 1 }, { name: 'Zarthul the Veiled Sentinel', hp: 10 }, { name: 'Enemy', hp: 25 }]);
  const context = { console: quiet, parseSheets, applyAdditionalOutcomes,
    sharedState: { getRoomNameDatabase: () => database, setRoomNameDatabase: value => { database = value; },
      setUpdatedGameConsole: value => { consoleText = value; }, getCombatCharactersString: () => roster,
      setCombatCharactersString: value => { roster = value; } } };
  vm.runInNewContext(fn, context);
  context.processGameUpdate({ xp_awarded: { Mortacia: 25 }, trap_damage: { 'Zarthul the Veiled Sentinel': 15 } }, consoleText);
  const actors = JSON.parse(roster);
  assert.deepEqual(actors.map(c => c.name), ['Mortacia', 'Enemy']);
  assert.equal(actors[0].xp, 125);
  assert.equal(actors[0].mazeX, 1);
  assert.equal(sheets(consoleText)[1].hp, 0);
});

test('ordinary model discoveries cannot forge a reserved seal at stage 0 by disguising its type', () => {
  for (const type of ['other', 'key', 'weapon']) {
    const { text, database } = bossFixture(), { gate } = ensureBossGate(database, text);
    const before = JSON.stringify(database), raw = ` ${gate.keyName.toUpperCase()} `;
    const outcomes = { new_objects: [raw, 'ordinary brass key'], object_modifiers: {
      [raw]: { type, attack_modifier: 99, questGateId: gate.id, unlocks: { coordinates: '0,0,0', direction: 'east' } },
      'ordinary brass key': { type: 'other', magic: 1 }
    } };
    const result = applyAdditionalOutcomes(outcomes, text, database);
    assert.deepEqual(result.discoveries, ['ordinary brass key']);
    assert.equal(result.console.includes(gate.keyName), false);
    assert.equal(result.database['0,0,0'].objects.some(item => item.name === gate.keyName), false);
    assert.deepEqual(result.database['1,0,0'].bossGate, gate);
    assert.equal(result.database['1,0,0'].bossGate.keySeeded, false);
    assert.deepEqual(result.database['0,0,0'].exits.north, database['0,0,0'].exits.north);
    assert.equal(JSON.stringify(database), before);
    assert.deepEqual(sheets(result.console).map(c => [c.hp, c.xp]), sheets(text).map(c => [c.hp, c.xp]));
    const seeded = seedBossKey(result.database, result.database['1,0,0'].bossGate, '0,0,0');
    assert.equal(seeded.seeded, true);
    assert.equal(result.database['0,0,0'].objects.filter(item => item.name === gate.keyName).length, 1);
  }
});

test('seal forgery is blocked even before the boss-room initializer and gate exist', () => {
  const { text, database } = bossFixture();
  const name = ensureBossGate(JSON.parse(JSON.stringify(database)), text).gate.keyName;
  delete database['1,0,0'];
  const before = JSON.stringify(database);
  const result = applyAdditionalOutcomes({ new_objects: [name] }, text, database);
  assert.deepEqual(result.discoveries, []);
  assert.equal(result.console.includes(name), false);
  assert.equal(Object.hasOwn(result.database, '1,0,0'), false);
  assert.equal(JSON.stringify(database), before);
  assert.equal(ensureBossGate(result.database, result.console).reason, 'missing-boss-record');
});

test('a newly revealed boss approach is immediately locked with the common seal without disturbing ordinary locks', () => {
  const { text, database } = bossFixture();
  delete database['0,0,0'].exits.east;
  const originalBoss = JSON.parse(JSON.stringify(database['1,0,0']));
  const ordinaryLock = JSON.parse(JSON.stringify(database['0,0,0'].exits.north));
  const result = applyAdditionalOutcomes({ new_exit: 'east', new_adjacent_room: { name: 'Do Not Rename Boss' },
    coordinates_of_connected_rooms: { x: 1, y: 0, z: 0 } }, text, database);
  const gate = result.database['1,0,0'].bossGate;
  assert.ok(gate);
  for (const [key, direction] of [['0,0,0', 'east'], ['2,0,0', 'west']]) {
    assert.equal(result.database[key].exits[direction].status, 'locked');
    assert.equal(result.database[key].exits[direction].key, gate.keyName);
    assert.equal(result.database[key].exits[direction].bossGateId, gate.id);
  }
  assert.deepEqual(result.database['0,0,0'].exits.north, ordinaryLock);
  assert.deepEqual(result.database['1,0,0'], { ...originalBoss, bossGate: gate });
  assert.deepEqual(Object.keys(result.database), Object.keys(database));
  assert.equal(gate.keySeeded, false);
  assert.equal(gate.keyPlacement, null);
});

test('a missing revealed boss record uses the bound room name rather than the model suggestion and locks in the same commit', () => {
  const { text, database } = bossFixture();
  const seal = ensureBossGate(JSON.parse(JSON.stringify(database)), text).gate.keyName;
  delete database['1,0,0'];
  delete database['0,0,0'].exits.east;
  const before = JSON.stringify(database);
  const result = applyAdditionalOutcomes({ new_objects: [seal, 'ethereal bloom'], new_exit: 'east',
    new_adjacent_room: { name: 'Garden of Vows', classification: { biome: 'wasteland', indoor: false } },
    coordinates_of_connected_rooms: { x: 1, y: 0, z: 0 } }, text, database);
  const boss = result.database['1,0,0'], gate = boss.bossGate;
  assert.equal(boss.name, 'Sanctuary of Oaths');
  assert.equal(Object.hasOwn(boss, 'classification'), false);
  assert.equal(Object.hasOwn(boss, 'monsters'), false);
  assert.deepEqual(result.discoveries, ['ethereal bloom']);
  assert.equal(gate.keyName, seal);
  assert.equal(gate.keySeeded, false);
  assert.equal(gate.keyPlacement, null);
  assert.deepEqual(result.database['0,0,0'].exits.east,
    { status: 'locked', targetCoordinates: '1,0,0', key: seal, bossGateId: gate.id });
  assert.equal(result.database['2,0,0'].exits.west.status, 'locked');
  assert.equal(result.database['2,0,0'].exits.west.key, seal);
  assert.equal(JSON.stringify(database), before);
});

test('an existing boss record retains its authoritative name and classification when a model reveals its exit', () => {
  const { text, database } = bossFixture();
  database['1,0,0'].name = 'Saved Sanctuary Name';
  const before = JSON.parse(JSON.stringify(database['1,0,0']));
  const result = applyAdditionalOutcomes({ new_exit: 'east', new_adjacent_room: {
    name: 'Garden of Vows', classification: { indoor: false, biome: 'wasteland' }
  } }, text, database);
  assert.deepEqual(result.database['1,0,0'], { ...before, bossGate: result.database['1,0,0'].bossGate });
  assert.equal(result.database['0,0,0'].exits.east.status, 'locked');
});

test('revealing an existing boss exit preserves its lock or legitimate cleared-key open state', () => {
  for (const status of ['locked', 'open']) {
    const { text, database } = bossFixture(), { gate } = ensureBossGate(database, text);
    if (status === 'open') {
      seedBossKey(database, gate, '0,0,0');
      database['0,0,0'].objects = [];
      database['0,0,0'].exits.east.status = 'open';
      database['0,0,0'].exits.east.key = null;
    }
    const before = JSON.stringify(database);
    const result = applyAdditionalOutcomes({ new_exit: 'east', new_objects: [gate.keyName] }, text, database);
    assert.deepEqual(result.discoveries, []);
    assert.deepEqual(result.database, JSON.parse(before));
    assert.equal(JSON.stringify(database), before);
    assert.equal(result.database['0,0,0'].exits.east.status, status);
    if (status === 'open') assert.equal(seedBossKey(result.database, gate, '0,0,0').status, 'already-seeded');
  }
});

test('legitimately seeded seal objects keep the existing key schema and cannot be duplicated by model modifiers', () => {
  const { text, database } = bossFixture(), { gate } = ensureBossGate(database, text);
  seedBossKey(database, gate, '0,0,0');
  const item = JSON.parse(JSON.stringify(database['0,0,0'].objects[0]));
  const visible = text.replace(/^Objects in Room:.*$/m, `Objects in Room: ${item.name}`)
    .replace(/^Objects in Room Properties:.*$/m,
      `Objects in Room Properties: {name: "${item.name}", type: "key", attack_modifier: 0, damage_modifier: 0, ac: 0, magic: 0}`);
  const result = applyAdditionalOutcomes({ new_objects: [item.name, 'ethereal bloom'],
    object_modifiers: { [item.name]: { type: 'other', magic: 999 } } }, visible, database);
  assert.deepEqual(result.discoveries, ['ethereal bloom']);
  assert.deepEqual(result.database['0,0,0'].objects.filter(object => object.name === item.name), [item]);
  assert.deepEqual(result.database['1,0,0'].bossGate, gate);
  assert.equal(seedBossKey(result.database, gate, '0,0,0').status, 'already-seeded');
});

test('real simulation filters forged seal keys from both committed state and narrative and keeps real task binding', async () => {
  const resolve = source.slice(source.indexOf('async function resolveActionWithSimulation('), source.indexOf('async function adjudicateActionWithPythonSimulation('));
  const process = source.slice(source.indexOf('function processGameUpdate('), source.indexOf('async function adjudicateActionWithCodeInterpreter('));
  const narrative = source.slice(source.indexOf('function generateNarrative('), source.indexOf('async function generateOutcomes('));
  const fixture = bossFixture(), { gate } = ensureBossGate(fixture.database, fixture.text);
  const task = { type: 'Investigate', desc: 'Search the altar.', status: 'Pending', hardRequirements: [], actionRequirements: [] };
  const additional = { new_objects: [gate.keyName, 'ethereal bloom'], object_modifiers: {}, questAttempted: true, prereqsMet: true };
  let database = JSON.stringify(fixture.database), lastAdjudication;
  const context = { console: quiet, applyAdditionalOutcomes, taskBinding,
    generateOutcomes: async () => ({ Outcomes: [{ character: 'Mortacia', outcome: 'Searches the altar.' }] }),
    generateAdditionalOutcomes: async () => additional,
    sharedState: { getCurrentTasks: () => [task], getCurrentTaskIndex: () => 0, getRoomNameDatabase: () => database,
      setRoomNameDatabase: value => { database = value; }, setUpdatedGameConsole() {},
      setLastAdjudication: value => { lastAdjudication = value; } } };
  vm.runInNewContext(`${process}\n${narrative}\n${resolve}`, context);
  const result = await context.resolveActionWithSimulation({}, 'search the altar', fixture.text);
  assert.deepEqual(additional.new_objects, ['ethereal bloom']);
  assert.equal(result.narrative.includes(gate.keyName), false);
  assert.equal(result.updatedGameConsole.includes(gate.keyName), false);
  assert.equal(JSON.parse(database)['1,0,0'].bossGate.keySeeded, false);
  assert.equal(lastAdjudication.taskBinding, taskBinding(task));
  assert.equal(task.status, 'Pending');
});

for (const scenario of ['wrong-room monster HP', 'stale database monster HP', 'pending action requirement']) {
  test(`real additional planner delegates only hard prerequisite checks: ${scenario}`, async () => {
    const fn = source.slice(source.indexOf('async function generateAdditionalOutcomes('), source.indexOf('// LLM-only gate'));
    const actionOnly = scenario === 'pending action requirement', placement = scenario === 'wrong-room monster HP' ? '1,0,0' : '0,0,0';
    const text = startingConsole().replace(/^Monsters in Room: None$/m,
      `Monsters in Room:\nWatcher\nHP: ${scenario === 'stale database monster HP' ? 12 : 0}`);
    let database = JSON.stringify({ '0,0,0': { name: 'Temple', objects: [], exits: { east: { status: 'locked' } },
      attemptedSearches: 0, exhaustionLimit: 4, trapTriggered: false, monsters: { consoleBlock: 'Watcher\nHP: 0' } },
      '1,0,0': { name: 'Different Room', objects: [], exits: {} } });
    const task = { type: 'Investigate', status: 'Pending', requiredElements: [{ type: 'monster', name: 'Watcher', placement }],
      hardRequirements: actionOnly ? [] : [{ check: 'monster_hp_zero', value: 'Watcher' }],
      actionRequirements: actionOnly ? [{ check: 'exit_open', coords: '0,0,0', direction: 'east' }] : [] };
    const responses = ['{"questAttempted":"true"}', '{"engagedInDialogue":true,"justLooking":false}'];
    const agent = { user() {}, assistant: { generation: async () => ({ content: responses.shift() || '{}' }) } };
    const context = { console: quiet, parseSheets, evaluateTaskRequirements,
      sharedState: { getRoomNameDatabase: () => database, setRoomNameDatabase: value => { database = value; } } };
    vm.runInNewContext(fn, context);
    const additional = await context.generateAdditionalOutcomes(agent, { Action: 'Dialogue' }, text, 'ask about the task', task);
    assert.equal(additional.prereqsMet, actionOnly);
    assert.equal(task.status, 'Pending');
    assert.deepEqual(Object.keys(additional.xp_awarded), []);
  });
}
