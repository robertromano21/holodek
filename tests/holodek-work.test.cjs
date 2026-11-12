'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Budget = require('../retort/holodekBudget'), Work = require('../retort/holodekWork');
const Schema = require('../retort/structuredSchema'), C = require('../retort/generationContracts');
const Host = require('../retort/pcModelHost'), Models = require('../retort/gameModels'), Runtime = require('../retort/gameRetort');
function value(schema, name = '', index = 0) {
  if (schema.enum) return name === 'suiteForm' ? schema.enum.at(-1) : schema.enum[0];
  const type = [].concat(schema.type || []).find(type => type !== 'null');
  if (type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, child]) => [key, value(child, key, index)]));
  if (type === 'array') return Array.from({ length: schema.minItems ?? 2 }, (_, i) => value(schema.items, name, index + i));
  if (type === 'boolean') return false;
  if (type === 'number') return Math.max(schema.minimum ?? -Infinity, Math.min(schema.maximum ?? Infinity,
    name === 'ceil' ? 5 : name === 'x' || name === 'y' ? .2 : name === 'w' || name === 'h' ? .12 : schema.minimum ?? 0));
  if (/color|shade|detail|sky|ground|shadow|stone|accent|light/.test(name)) return '#a09070';
  if (name === 'name') return 'Local ' + index;
  if (name === 'id') return 'control_' + index;
  if (name === 'pixels') return '0011100';
  if (name === 'label' && schema.pattern?.match(/ (\w+)\$$/)) return 'Local ' + index + ' ' + schema.pattern.match(/ (\w+)\$$/)[1];
  if (name === 'mark' || name === 'options') return 'Local ' + name + ' ' + index;
  return 'Authored ' + name;
}
async function runtime(work, answer) {
  const requests = [], before = Models.current().id;
  const host = Host.createHost({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    const result = answer ? await answer(body, requests.length) : value(body.response_format.json_schema.schema, '', requests.length * 10);
    return { ok: true, text: async () => JSON.stringify({ model: 'holodek-1', choices: [{ index: 0, finish_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify(result) } }] }) };
  } });
  const models = { ...Models, getLocalClient: () => Host.modelClient(host) };
  const app = Runtime.createRuntime({ models, log() {} });
  Models.restore('holodek-1');
  try { return { result: await app.run(app.retort(work), null, { shouldSaveToLog: false }), requests }; }
  finally { Models.restore(before); }
}
function size(body) { return Budget.tally(body.messages, body.tools?.length ? body.tools : [{ response_format: body.response_format }]).total; }

test('local quest chunks retain their original world and exact bindings without importing the parent campaign', async () => {
  const Setting = require('../retort/settingLayer'), previous = Setting.current();
  const world = Setting.localBible('an orbital repair station', ['sci-fi']);
  world.name = 'Meridian Station'; world.topology.goal = 'The Observation Deck';
  world.abilitySystem = { resource: 'Tech' };
  world.masterPrompt = Setting.masterText(Setting.masterLocal(world), world); Setting.setActive(world);
  try {
    const { result, requests } = await runtime(async $ => {
      await $.user('UNRELATED PARENT TRANSCRIPT '.repeat(2000));
      return require('../retort/holodekRoomWork').questReply($, 'quest-name', { name: C.text(60) },
        { artifact: 'Signal Token', coordinates: '1,1,0' }, 'Name the bound destination.');
    }, () => ({ name: 'Relay Station' }));
    assert.equal(result.result.name, 'Relay Station'); assert.equal(requests.length, 1);
    const raw = requests.flatMap(body => body.messages.map(row => row.content)).join('\n');
    for (const fact of ['Meridian Station', 'The Observation Deck', 'Tech', 'Signal Token', '1,1,0', 'MODE-4 QUEST']) assert.ok(raw.includes(fact), fact);
    assert.doesNotMatch(raw, /Tartarus|Children of the Grave|hellish sandstorms|UNRELATED PARENT TRANSCRIPT/);
    assert.ok(requests.every(body => size(body) <= Budget.CEILING));
  } finally { Setting.setActive(previous); }
});

test('quest name validation rejects reserved missing-data answers without supplying replacement content', () => {
  const { questName, questDescription } = require('../retort/holodekRoomWork');
  for (const name of ['None', ' none ', 'null', 'undefined', 'unknown', 'Unassigned Boss', 'N/A', '',
    'bad\nname']) assert.throws(() => questName(name), /name:/, name);
  assert.equal(questName('Floodgate Signal Key'), 'Floodgate Signal Key');
  assert.equal(questName('Relay Warden'), 'Relay Warden');
  for (const description of ['None', '', 'undefined', 'Unknown', 'first\nsecond'])
    assert.throws(() => questDescription(description), /description:/);
});

test('native quest work retries rejected placeholders through the model rather than accepting or substituting them', async () => {
  for (const component of ['quest-artifact-name', 'quest-boss-name', 'quest-boss-location']) {
    const { result, requests } = await runtime($ => require('../retort/holodekRoomWork').questReply($, component,
      { name: C.text(70) }, { previousQuest: 'None' }, 'Author one concrete new name, not a missing-data placeholder.'),
    (_body, attempt) => ({ name: attempt === 1 ? 'None' : 'Signal Vault' }));
    assert.equal(result.result.name, 'Signal Vault');
    assert.equal(requests.length, 2);
    assert.ok(requests.every(body => size(body) <= Budget.CEILING));
  }
});

test('local quest authoring accepts prose longer than the former cap without truncation or a corrective model call', async () => {
  const paragraph='Recover the named artifact from its bound guardian and preserve the testimony of those who remember its origin. '.repeat(8).trim();
  const {result,requests}=await runtime($=>require('../retort/holodekRoomWork').questReply($,'quest-premise',
    {description:C.text(600)},{artifact:'Witness Seal'},'Author one complete paragraph.'),()=>({description:paragraph}));
  assert.equal(result.result.description,paragraph);assert.equal(requests.length,1);
  assert.equal(requests[0].response_format.json_schema.schema.properties.description.maxLength,undefined);
});

test('installed 4096 context reserves input, answer and framing space together', () => {
  assert.equal(Budget.CONTEXT, 4096); assert.equal(Budget.ANSWER, 1024);
  assert.equal(Budget.CEILING + Budget.ANSWER + Budget.SAFETY, Budget.CONTEXT);
  assert.equal(Budget.prepare({ messages: [{ role: 'user', content: 'Small work order.' }], max_tokens: 12000 }, { log() {} }).max_tokens, 1024);
});

test('accepted geometry, control states and primitive arrays remain usable by later parts', () => {
  const compact = Work.dependencyView({ rooms: [{ x: .1, y: .2, w: .3, h: .4, role: 'entrance' }],
    corridors: [{ fromRoom: 0, toRoom: 1 }], controls: [{ id: 'west', options: ['Moon', 'Sun'], initial: 0, goal: 1 }],
    motifContour: [0, 1, 2, 1, 0] });
  assert.equal(compact.rooms.identities[0].w, .3); assert.equal(compact.corridors.identities[0].toRoom, 1);
  assert.deepEqual(compact.controls.identities[0].options, ['Moon', 'Sun']); assert.deepEqual(compact.motifContour, [0, 1, 2, 1, 0]);
});

test('primitive answer lengths follow previously accepted rhythm choices', async () => {
  const { result, requests } = await runtime($ => C.request($, { component: 'offline-rhythm',
    parameters: { motifRhythm: C.choice(['8,8,4,8,8,4']), motifContour: [{ type: Number, enum: [0, 1, 2] }] },
    localWork: { brief: 'Author matching note contours.', arrays: { motifContour: { count: (_root, prior) => prior.motifRhythm.split(',').length } } } }));
  assert.equal(result.value.motifContour.length, 6);
  assert.equal(requests.at(-1).response_format.json_schema.schema.properties.motifContour.maxItems, 6);
});

async function capture(call) {
  const previous = C.request; let options;
  C.request = async (_agent, given) => { options ||= given; throw Error('offline contract capture'); };
  try { await call({ user: async () => {}, system: async () => {} }); } catch {}
  finally { C.request = previous; }
  assert.ok(options?.localWork); return options;
}

for (const component of ['music', 'art', 'mechanism']) test(component + ' actual authoring contract fits every native local request', async () => {
  const before = Models.current().id; Models.restore('holodek-1');
  let options;
  try {
    options = await capture($ => component === 'music' ? require('../retort/sidComposition').generate($, {
      description: 'A ruined observatory with a wind-driven bronze orrery.', roomKey: '1,0,0', runId: 'offline' }) :
      component === 'art' ? require('../retort/roomIllustration').generate($, {
        name: 'The Broken Observatory', description: 'A ruined observatory with a wind-driven bronze orrery.', geoKey: '1,0,0', indoor: false }) :
      require('../retort/physicalPuzzleDesign').generateDesign($, {
        roomName: 'The Broken Observatory', roomDescription: 'A ruined observatory with a wind-driven bronze orrery.', seed: 'offline' }));
  } finally { Models.restore(before); }
  const artAnswer = body => {
    const sample = value(body.response_format.json_schema.schema);
    const fill = node => {
      if (Array.isArray(node)) return node.forEach(fill);
      if (!node || typeof node !== 'object') return;
      if (node.kind !== undefined && node.x !== undefined) {
        Object.assign(node, { kind: 'wall', x: 1, y: 1, w: 50, h: 50, count: 1 });
        if (node.parts) for (const key of Object.keys(node.parts)) node.parts[key] = 'none';
        if (node.assembly) Object.assign(node.assembly, { preset: 'cottage', condition: 'intact', roof: 'gable',
          windows: 'arched', material: 'stone', stack: ['wall_seg:stone'], attach: ['lantern@wall.front:0.5'],
          repeat: ['colonnade_bay:stone*2@right'] });
      }
      if (node.sky !== undefined && node.shadow !== undefined)
        Object.assign(node, { sky: '#8090aa', ground: '#776644', shadow: '#181818', stone: '#998877', light: '#ffeebb' });
      Object.values(node).forEach(fill);
    };
    fill(sample);
    return sample;
  };
  const { result, requests } = await runtime($ => C.request($, { ...options, attempts: 1, validate: raw => raw }),
    component === 'art' ? artAnswer : undefined);
  assert.ok(result.value, result.error?.message);
  assert.ok(requests.length > 2); assert.ok(requests.every(body => size(body) <= Budget.CEILING));
});

test('custom tiles assemble separately authored geometry, detail and bounded drawing steps', async () => {
  const { result, requests } = await runtime($ => require('../retort/holodekTiles').generate($, {
    roomDesc: 'A ruined observatory with broken metal sighting pillars.', puzzleDesc: '', isOutdoor: true, requiredTypes: ['sighting_pillar']
  }), body => {
    const schema = body.response_format.json_schema.schema;
    if (schema.properties.types) return { types: ['sighting_pillar', 'bronze_shards'] };
    return value(schema);
  });
  const tiles = Object.values(JSON.parse(result.content).tiles);
  assert.deepEqual(tiles.map(tile => tile.type), ['sighting_pillar', 'bronze_shards']);
  assert.ok(tiles.every(tile => tile.procedure.program.length >= 2));
  assert.ok(requests.length > 4); assert.ok(requests.every(body => size(body) <= Budget.CEILING));
});

test('completed work can be removed but latest console, system rules and unfinished work remain exact', () => {
  const consoleText = 'Current Game Console:\nRoom Name: Saved Hall\nInventory: exact relic';
  const messages = [{ role: 'system', content: 'Keep authoritative bindings.' }, { role: 'user', content: 'Old task ' + 'x'.repeat(16000) },
    { role: 'assistant', content: 'Old completed answer.' }, { role: 'assistant', content: consoleText },
    { role: 'user', content: 'Current work instruction A.' }, { role: 'user', content: 'Current work instruction B.' }];
  const original = JSON.stringify(messages), result = Budget.enforce(messages, undefined, { log() {} });
  assert.equal(JSON.stringify(messages), original); assert.ok(Budget.tally(result).total <= Budget.CEILING);
  for (const message of [messages[0], ...messages.slice(3)]) assert.ok(result.some(row => row.content === message.content));
  assert.ok(!result.some(row => row.content.startsWith('Old task')));
});

test('oversized immutable work fails before inference, never silently overflowing Ollama', async () => {
  let calls = 0;
  const host = Host.createHost({ fetchImpl: async () => { calls++; assert.fail('No inference for an oversized work order.'); } });
  await assert.rejects(host.complete({ model: 'holodek-1', messages: [{ role: 'user', content: 'x'.repeat(16000) }] }),
    error => error.code === 'PC_MODEL_CONTEXT_BUDGET' && /answer tokens/.test(error.message));
  assert.equal(calls, 0);
});

test('final response schema and schema instructions both count toward the admission budget', () => {
  const body = { model: 'holodek-1', messages: [{ role: 'user', content: 'Choose a value.' }], response_format: {
    type: 'json_schema', json_schema: { schema: { type: 'string', enum: Array.from({ length: 600 }, (_, i) => 'choice_' + i + 'x'.repeat(25)) } } } };
  assert.throws(() => Budget.prepare(body, { log() {} }), /context budget exceeded/);
});

test('campaign-sized lists join exact ordered chunks and never inherit a huge parent transcript', async () => {
  const { result, requests } = await runtime(async $ => {
    await $.user('Irrelevant old narrative '.repeat(2000));
    return C.request($, { component: 'offline-atlas', parameters: {
      regions: { type: C.list({ name: C.text(40), ecology: C.text(200) }), minItems: 4, maxItems: 4 },
      factions: { type: C.list({ name: C.text(40), purpose: C.text(200) }), minItems: 4, maxItems: 4 } },
      localWork: { brief: 'Invent four ordered regions and factions. Preserve earlier choices. No gameplay state changes.',
        arrays: { regions: { count: 4, max: 4, batch: 1 }, factions: { count: 4, max: 4, batch: 1 } } },
      validate: raw => { assert.equal(raw.regions.length, 4); assert.equal(raw.factions.length, 4); return raw; } });
  });
  assert.ok(result.value); assert.equal(requests.length, 8);
  assert.ok(requests.every(body => !body.messages.some(row => row.content.includes('Irrelevant old narrative'))));
  assert.ok(requests.every(body => size(body) <= Budget.CEILING));
  assert.ok(requests.slice(1).some(body => body.messages.at(-1).content.includes('acceptedRows')));
});

test('large enum selection retains legal choices through a smaller family request', async () => {
  const choices = Array.from({ length: 5 }, (_, family) => Array.from({ length: 15 }, (_, i) =>
    `mode${family}/very_long_harmonic_progression_${i}/contrasting_progression_${i}`)).flat();
  const { result, requests } = await runtime($ => C.request($, { component: 'offline-choice', parameters: { harmony: C.choice(choices) },
    localWork: { brief: 'Choose the harmonic character suited to this chamber.' } }));
  assert.ok(result.value); assert.ok(choices.includes(result.value.harmony));
  assert.equal(requests.length, 2); assert.ok(requests[0].response_format.json_schema.schema.properties.family);
  assert.ok(requests.every(body => size(body) <= Budget.CEILING));
});

test('a repeated chunk name retries only the current row, leaving earlier accepted work intact', async () => {
  const { result, requests } = await runtime($ => C.request($, { component: 'offline-duplicate',
    parameters: { regions: { type: C.list({ name: C.text(40) }), minItems: 2, maxItems: 2 } },
    localWork: { brief: 'Author two distinct regions.', arrays: { regions: { count: 2, max: 2, batch: 1 } } } }),
    (_body, count) => ({ rows: [{ name: count < 3 ? 'Ash Plain' : 'River Bank' }] }));
  assert.deepEqual(result.value.regions.map(row => row.name), ['Ash Plain', 'River Bank']);
  assert.equal(requests.length, 3);
  assert.ok(requests[1].messages.some(row => /NEW ROW 2 of 2/.test(row.content)));
  assert.ok(requests[2].messages.at(-1).content.includes('already an accepted row'));
});

test('a later failed chunk cannot return a partial compiled plan or invoke its commit validator', async () => {
  let validated = 0;
  const { result, requests } = await runtime($ => C.request($, { component: 'offline-failure',
    parameters: { layers: { type: C.list({ name: C.text(40) }), minItems: 4, maxItems: 4 } },
    localWork: { brief: 'Author exactly four ordered layers.', arrays: { layers: { count: 4, max: 4, batch: 1 } } },
    validate: value => { validated++; return value; } }), (body, count) => {
    // Accepted chunks need distinct identities; all attempts of the failing chunk must fail.
    if (count >= 3) throw Error('offline provider failed');
    return value(body.response_format.json_schema.schema, '', count * 10);
  });
  assert.equal(result.value, null); assert.equal(validated, 0); assert.match(result.error.message, /PC Ollama/);
  assert.equal(requests.length, 2 + require('../retort/generationPolicy').ATTEMPTS);
});

test('local population uses one exact slot per request and retains unique identities until the whole cast validates', async () => {
  const fixture = require('./fixtures/inhabitants.cjs')(3).map(row => ({ ...row, allegiance: 'Friendly', encounterId: 'locals', homeSite: 'commons' }));
  const { result, requests } = await runtime($ => require('../retort/inhabitantGeneration').generateInhabitants($,
    { roomName: 'Ruined Temple Entrance', roomDescription: 'A roofed hall under weathered stone with worn friezes.', geoKey: '0,0,0', indoor: true,
      partyNames: ['Mortacia'], usedNames: [], rooms: {} },
    { random: () => 3, level: () => 1, xp: () => 0, sex: () => 'Female', equipment: async () => null }), body => {
    const ids = body.response_format.json_schema.schema.properties.inhabitants.items.properties.slot.enum;
    return { inhabitants: fixture.filter(row => ids.includes(row.slot)) };
  });
  assert.equal(requests.length, 3); assert.equal(Object.keys(result.population.actors).length, 3);
  assert.deepEqual(requests.map(body => body.response_format.json_schema.schema.properties.inhabitants.items.properties.slot.enum), [[0], [1], [2]]);
  assert.ok(requests.every(body => size(body) <= Budget.CEILING));
  assert.ok(Object.values(result.population.actors).every(actor => actor.allegiance === 'Friendly'));
});

test('item naming starts in a fresh structured branch and retries prose without storing it as an item', async () => {
  const { result, requests } = await runtime(async $ => {
    await $.user('You are in the ruined temple. Choose your next adventure action.');
    return require('../retort/holodekObjectName').generate($, { objectType: 'armor', roomName: 'Saved Hall', roomDescription: 'Bronze-studded arches.' });
  }, (_body, count) => ({ name: count === 1 ? 'worn chainmail you are in the ruined temple entrance an indoor chamber with worn' : 'bronze mail' }));
  assert.equal(result, 'bronze mail'); assert.equal(requests.length, 2);
  assert.ok(requests.every(body => body.response_format.json_schema.schema.properties.name.maxLength === undefined));
  assert.ok(requests.every(body => !body.messages.some(row => row.content.includes('Choose your next adventure action'))));
});

test('dungeon authoring separates concept, room batches, indexed connections and scenery before assembly', async () => {
  const { result, requests } = await runtime($ => require('../retort/holodekBlueprint').generate($, {
    roomDescription: 'An indoor funerary complex of several small chambers.', puzzleDesc: '', classification: { indoor: true, biome: 'temple' },
    size: 64, customTiles: [{ type: 'bone_pillar' }], generation: { seed: 'offline-seed' }, sceneSpec: { architecture: 'roman' }
  }));
  assert.equal(result.seed, 'offline-seed'); assert.equal(result.indoorPlan.rooms.length, 6);
  assert.ok(result.indoorPlan.corridors.length >= 5); assert.ok(result.props.length >= 3);
  assert.ok(requests.length > 4); assert.ok(requests.every(body => size(body) <= Budget.CEILING));
  assert.ok(requests.some(body => /"x":0.2/.test(body.messages.at(-1).content)));
  for (const link of result.indoorPlan.corridors) {
    assert.ok(link.fromRoom >= 0 && link.fromRoom < 6); assert.ok(link.toRoom >= 0 && link.toRoom < 6);
  }
});

test('indoor authoring requires a distinct authored entrance even when every other room chooses a hall', async () => {
  const { result } = await runtime($ => require('../retort/holodekBlueprint').generate($, {
    roomDescription: 'Six connected halls.', classification: { indoor: true }, size: 64,
    customTiles: [], generation: { seed: 'entrance-regression' }, sceneSpec: { architecture: 'roman' }
  }));
  const rooms = result.indoorPlan.rooms;
  assert.equal(rooms.length, 6); assert.equal(rooms[0].role, 'entrance');
  assert.equal(rooms.filter(room => room.role === 'entrance').length, 1);
  assert.ok(rooms.slice(1).every(room => room.role === 'hall'));
  assert.ok(rooms[0].w > 0 && rooms[0].h > 0);
});
