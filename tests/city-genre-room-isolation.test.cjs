'use strict';
process.env.HOLODEK_GENRE_EXPANSION = '1';
process.env.HOLODEK_GENRE_KITS = '1';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Setting = require('../retort/settingLayer'), Homebrew = require('../retort/homebrewStoryPrompts');
const Initial = require('../retort/initialGameState'), Environments = require('../retort/environmentIntents');
const { templateContent } = require('retort-js/dist/message');
const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
const foreign = /Children of the Grave|Grave Master|Ruined Temple|Wastelands of Tartarus|\bTartarus\b|\bHades\b|Mortacia|Sepulchra|yellowish sky|hellish sandstorms|powerful demons/;
const quiet = { log() {}, info() {}, warn() {}, error() {} };
function world(genre) {
  const b = Setting.validateBible(Setting.localBible('Independent ' + genre + ' campaign', [genre]));
  b.opening = { name: 'Rainline Exchange', indoor: true, city: false };
  return b;
}
function slice(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
}
function agent(value) {
  const prompts = [], $ = { model: 'gpt-4.1-mini', temperature: .8 };
  const tag = (s, ...v) => prompts.push(typeof s === 'string' ? s : templateContent(s, ...v));
  $.user = tag; $.assistant = tag;
  $.assistant.generation = async () => ({ content: JSON.stringify(value) });
  $.run = callback => callback($);
  return { $, prompts };
}

for (const genre of Setting.GENRES) test('native room construction has no canonical scenery for ' + genre, async () => {
  const b = world(genre);
  await Setting.withDraft(b, async () => {
    const legacy = { updatedGameConsole: 'Room Name: Ruined Temple Entrance\nRoom Description: Old temple prose\nCoordinates: X: 0, Y: 0, Z: 0\nAdjacent Rooms: north: Wastelands of Tartarus',
      roomNameDatabaseString: JSON.stringify({ '0,0,0': { name: 'Ruined Temple Entrance', exits: { north: { targetCoordinates: '0,1,0', status: 'blocked', key: 'native key' } }, classification: { biome: 'temple', world1Temple: true } },
        '0,1,0': { name: 'Wastelands of Tartarus', indoor: false, classification: { biome: 'wasteland', features: ['sandstorms'] } } }) };
    const before = JSON.stringify(legacy), initial = Initial.buildInitialWorldConsole(legacy, b), db = JSON.parse(initial.roomNameDatabaseString);
    assert.doesNotMatch(JSON.stringify(initial), foreign);
    assert.equal(JSON.stringify(legacy), before);
    assert.equal(db['0,0,0'].name, 'Rainline Exchange');
    assert.equal(db['0,0,0'].indoor, true);
    assert.equal(db['0,0,0'].classification.world1Temple, undefined);
    assert.equal(db['0,1,0'].classification, undefined);
    assert.equal(db['0,0,0'].exits.north.key, 'native key');
    assert.match(initial.console, /Room Description: None/);
    assert.match(initial.console, /Adjacent Rooms: north: None/);
    assert.doesNotMatch(Homebrew.classification('A covered civic exchange.'), foreign);
    assert.doesNotMatch(Homebrew.classification('A covered civic exchange.', true), foreign);
    assert.doesNotMatch(Homebrew.raceClass({ roomName: 'Rainline Exchange' }), foreign);
    assert.deepEqual(Homebrew.defaultShape().features, []);
    const a = agent({ directions: { north: { template: 'guildhall', hint: 'A covered civic workshop connected to the exchange.' } } });
    const plan = await Environments.chooseEnvironmentIntents(a.$, { coords: { x: 0, y: 0, z: 0 },
      sourceIndoor: true, directions: ['north'], database: { '0,0,0': { name: 'Rainline Exchange', exits: {} } } });
    assert.equal(plan.status, 'planned');
    assert.equal(plan.intents.north.evidence.constraint, null);
    assert.equal(plan.intents.north.indoor, true, 'The first neighbor is not forced into outdoor terrain.');
    assert.doesNotMatch(a.prompts.join('\n'), foreign);
    assert.doesNotMatch(JSON.stringify(plan.intents), foreign);
    assert.doesNotMatch(Environments.describeEnvironmentIntent({ ...Environments.CATALOG.wasteland }), /yellow sky|Open ash and sand/);
  });
});

test('the actual first-exit skeleton rule runs for canonical play only', async () => {
  const block = slice('    // SPECIAL: entrance first exit is outdoors', '    // Eagerly create ALL new adjacent rooms');
  for (const b of [world('cyberpunk'), null]) await Setting.withDraft(b, async () => {
    // withDraft(null) is deliberately not canonical play; live CotG uses no draft at all.
    const context = { WorldSetting: { isCotGPlay: () => !b }, coordKey: '0,0,0', startKey: '0,0,0',
      roomExitsArray: ['north', 'west'], directionMap: { north: { x: 0, y: 1, z: 0 } },
      currentCoordinates: { x: 0, y: 0, z: 0 }, roomNameDatabasePlain: {}, newAdjacentRooms: { north: 'Native Concourse' },
      coordinatesToString: c => `${c.x},${c.y},${c.z}`, classifyDungeon: async () => ({ indoor: true, size: 32, biome: 'fortress' }), console: quiet };
    await vm.runInNewContext('(async()=>{' + block + '})()', context);
    if (b) assert.equal(context.roomNameDatabasePlain['0,1,0'], undefined);
    else assert.equal(context.roomNameDatabasePlain['0,1,0'].classification.biome, 'wasteland');
  });
});

test('missing genre start skeleton uses the saved opening without temple marking', async () => {
  const block = slice('  let startRoom = getRoomSafeLocal(roomNameDatabasePlain, startKey);', '  // Ensure current room exists');
  const b = world('cyberpunk'); b.opening.indoor = false;
  await Setting.withDraft(b, async () => {
    const context = { WorldSetting: Setting, startKey: '0,0,0', roomNameDatabasePlain: {},
      getRoomSafeLocal: (db, key) => db[key], setRoomSafeLocal: (db, key, value) => db[key] = value,
      constructionReadOnly: () => false, ensureRoomFlagsConsistent() {},
      TempleComplex: { mark() { throw Error('A genre opening must not be temple-marked.'); } } };
    await vm.runInNewContext('(async()=>{' + block + '})()', context);
    const room = context.roomNameDatabasePlain['0,0,0'];
    assert.equal(room.name, b.opening.name); assert.equal(room.indoor, false);
    assert.equal(room.classification.world1Temple, undefined);
    assert.doesNotMatch(JSON.stringify(room), foreign);
  });
});

test('non-local-model genre neighbor names go through the native structured authoring path', async () => {
  await Setting.withDraft(world('cyberpunk'), async () => {
    const calls = [], context = { WorldSetting: Setting, StoryPrompts: { isHolodek1: () => false },
      roomNameDatabasePlain: {}, coordKey: '0,0,0', startKey: '0,0,0', roomName: 'Rainline Exchange',
      roomExitsArray: ['north', 'west'], existingAdjacentRooms: [], namingDirections: ['north', 'west'], frontierIntent: { intents: {} },
      $: {}, require: id => { assert.equal(id, './holodekRoomWork'); return { adjacentNames: async (_, input) => {
        calls.push(input); return { north: 'Civic Concourse', west: 'Freight Passage' }; } }; } };
    await vm.runInNewContext('(async()=>{' + slice('    let newAdjacentRooms = {};', '    // Direction map (unchanged)') + '})()', context);
    assert.equal(calls.length, 1); assert.equal(calls[0].outdoorDirection, null);
  });
});

test('actual classification keeps native city results and never sends canonical scenery', async () => {
  await Setting.withDraft(world('cyberpunk'), async () => {
    const prompts = [], context = { WorldSetting: Setting, console: quiet, process, client: {},
      getFallback: () => Homebrew.defaultShape(), require: id => id === './modelTransport' ? { complete: async (_, body) => {
        prompts.push(body); return { choices: [{ message: { content: JSON.stringify({ ...Homebrew.defaultShape(), biome: 'city' }) } }] };
      } } : require('../retort/' + id.slice(2)) };
    vm.runInNewContext(slice('async function classifyDungeon(', '// Fallback stays the same'), context);
    assert.equal((await context.classifyDungeon('A neon city exchange under pressure-rated roof panels.')).biome, 'city');
    assert.doesNotMatch(JSON.stringify(prompts), foreign);
  });
});

test('genre object names remain model-authored on non-local models, without a stock item fallback', async () => {
  await Setting.withDraft(world('cyberpunk'), async () => {
    const a = agent({ items: [{ name: 'signal probe', type: 'other', attack_modifier: 0, damage_modifier: 0, ac: 0, magic: 1,
      consumable_kind: 'none', description: 'A pocket probe with a shielded contact tip.' }] }), context = { WorldSetting: Setting, console: quiet,
      StoryPrompts: { isHolodek1: () => false }, getDelayedUpdatedGameConsole: async () => '',
      sharedState: { getRoomNameDatabase: () => '{}' }, isReservedBossKeyName: () => false,
      Math: Object.assign(Object.create(Math), { random: () => 0 }), require: id => require('../retort/' + id.slice(2)) };
    vm.runInNewContext(slice('async function generateRoomObjects(', 'async function generateObjectModifiers('), context);
    const items = await context.generateRoomObjects(a.$, 'Rainline Exchange', 'A covered neon exchange.');
    assert.equal(items[0].name, 'signal probe'); assert.doesNotMatch(a.prompts.join('\n'), foreign);
    await assert.rejects(require('../retort/holodekObjectName').generate(agent({ name: '' }).$, {
      objectType: 'weapon', roomName: 'Rainline Exchange', roomDescription: 'Neon exchange.' }), /Original-world item naming failed/);
  });
});

test('canonical startup and scenery remain unchanged without an original-world setting', () => {
  Setting.setActive(null);
  const initial = Initial.buildInitialWorldConsole();
  assert.match(initial.console, /Ruined Temple Entrance/); assert.match(initial.console, /Tartarus/);
  assert.match(Environments.describeEnvironmentIntent(Environments.CATALOG.wasteland), /yellow sky/);
});

test('a player-authorized overlapping place name is not mistaken for an inherited skeleton', () => {
  const b = world('mythic'); b.topology.goal = 'Wastelands of Tartarus';
  const room = { name: 'Wastelands of Tartarus', description: 'An explicitly authored destination.', indoor: false };
  const initial = Initial.buildInitialWorldConsole({ roomNameDatabaseString: JSON.stringify({ '2,3,0': room }) }, b);
  assert.deepEqual(JSON.parse(initial.roomNameDatabaseString)['2,3,0'], room);
});

test('genre rendering defaults do not assign the canonical temple or yellow-ash palette', () => {
  Setting.withDraft(world('cyberpunk'), () => {
    const context = { WorldSetting: Setting, require: id => require('../retort/' + id.slice(2)) };
    vm.runInNewContext(slice('function getFallback(', 'async function generateRoomVisualStyle('), context);
    const fallback = context.getFallback(false);
    assert.equal(fallback.biome, 'fortress');
    assert.deepEqual(fallback.features, []);
    assert.notEqual(fallback.skyTop, '#FFDD88');
    assert.equal(context.getFallback(true).skyTop, fallback.skyTop);
  });
});
