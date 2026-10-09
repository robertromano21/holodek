'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseEnvironmentIntents, describeEnvironmentIntent, CATALOG } = require('../retort/environmentIntents');
const { snapshotQuestContext } = require('../retort/worldContext');

function input(overrides = {}) {
  return { coords: { x: 4, y: 5, z: 2 }, directions: ['east', 'north'], database: {},
    currentQuest: 'Reach the bound sanctuary and recover the named relic.', nextBoss: 'The Ash Regent',
    bossCoordinates: { x: 9, y: 9, z: 2 }, nextBossRoom: 'Sanctuary of Unbroken Oaths',
    sourceIndoor: false, seed: 'campaign-seed', ...overrides };
}

function assistant(response, failure) {
  const calls = { prompts: [], generations: [] };
  const $ = { model: 'unchanged-model', temperature: 0.7 };
  $.assistant = async (parts, ...values) => {
    assert.ok(Array.isArray(parts) && Array.isArray(parts.raw), 'Must use a retort tagged template');
    assert.ok(values.every(value => typeof value === 'string'), 'No undefined or object interpolation');
    calls.prompts.push(parts.reduce((text, part, i) => text + part + (values[i] || ''), ''));
    if (failure === 'tag') throw new Error('tag failed');
  };
  $.assistant.generation = async options => {
    calls.generations.push(options);
    if (failure === 'generation') throw new Error('offline');
    return typeof response === 'function' ? response() : { content: typeof response === 'string' ? response : JSON.stringify(response) };
  };
  return { $, calls };
}

const choices = { directions: { east: { template: 'dead_grove', hint: 'Pale branches cast the shadows of ships that never arrived.' },
  north: { template: 'byzantine_basilica', hint: 'Its mosaics turn remembered promises into colors, not a new quest.' } } };

test('one optional tagged call retains model creativity and returns only canonical metadata', async () => {
  const { $, calls } = assistant(`\`\`\`json\n${JSON.stringify(choices)}\n\`\`\``);
  const plan = await chooseEnvironmentIntents($, input());
  assert.equal(plan.version, 1);
  assert.equal(plan.status, 'planned');
  assert.equal(calls.prompts.length, 1);
  assert.deepEqual(calls.generations, [{ maxTokens: 600 }]);
  assert.equal($.model, 'unchanged-model');
  assert.equal($.temperature, 0.7);
  assert.equal(plan.intents.east.narrativeHint, choices.directions.east.hint);
  assert.deepEqual(Object.keys(plan.intents.east).sort(), ['template', 'indoor', 'biome', 'architecture', 'physicalDescription',
    'nameGuidance', 'narrativeHint', 'evidence', 'targetKey'].sort());
  assert.equal(plan.intents.east.indoor, false);
  assert.equal(plan.intents.north.architecture, 'basilica');
  assert.equal(plan.intents.east.evidence.source, 'model');
});

test('unknown and malicious keys, extra quests, names, placements and model classifications are ignored', async () => {
  const response = JSON.parse('{"directions":{"east":{"template":"villa","hint":"A quiet hall","indoor":false,"name":"Replacement Boss","quest":"New quest","placement":"0,0,0"},"__proto__":{"polluted":true},"constructor":{"template":"castle","hint":"bad"},"west":{"template":"castle","hint":"bad"}},"currentQuest":"Replaced","nextBossRoom":"Wrong","tasks":[]}');
  const source = input({ directions: ['east', '__proto__', 'constructor', 'westward'] }), before = JSON.stringify(source);
  const plan = await chooseEnvironmentIntents(assistant(response).$, source);
  assert.deepEqual(Object.keys(plan.intents), ['east']);
  assert.equal(plan.intents.east.indoor, true);
  assert.equal(plan.intents.east.name, undefined);
  assert.equal(plan.intents.east.quest, undefined);
  assert.equal(plan.intents.east.placement, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(plan.protected.currentQuest, source.currentQuest);
  assert.equal(plan.protected.nextBossRoom, source.nextBossRoom);
  assert.equal(JSON.stringify(source), before);
});

test('named, classified and generated rooms are authoritative; empty link stubs remain eligible', async () => {
  const variants = [{ name: 'Saved name' }, { classification: {} }, { indoor: false }, { isIndoor: true },
    { sceneSpec: {} }, { dungeon: {} }, { generated: true }, { roomDescriptionGenerated: true },
    { description: 'Saved lore' }, 'Saved legacy name', { biome: 'crypt' }, { environmentIntent: { template: 'castle' } }];
  for (const room of variants) {
    const source = input({ directions: ['east'], database: { '5,5,2': room } }), before = JSON.stringify(source);
    const { $, calls } = assistant(choices);
    assert.equal((await chooseEnvironmentIntents($, source)).status, 'skipped');
    assert.equal(calls.prompts.length, 0);
    assert.equal(calls.generations.length, 0);
    assert.equal(JSON.stringify(source), before);
  }
  const source = input({ database: { '5,5,2': { exits: {}, objects: [], attemptedSearches: 0 } } });
  const before = JSON.stringify(source);
  assert.equal((await chooseEnvironmentIntents(assistant(choices).$, source)).status, 'planned');
  assert.equal(JSON.stringify(source), before);
});

test('bound boss is protected by coordinates even without a database record', async () => {
  for (const room of [null, { name: 'EXACT Boss Name', description: 'EXACT Boss Lore', classification: { indoor: true } }]) {
    const database = room ? { '5,5,2': room } : {};
    const source = input({ database, bossCoordinates: { x: 5, y: 5, z: 2 } }), before = JSON.stringify(source);
    const plan = await chooseEnvironmentIntents(assistant(choices).$, source);
    assert.deepEqual(Object.keys(plan.intents), ['north']);
    assert.equal(plan.protected.bossTargetKey, '5,5,2');
    assert.equal(plan.protected.skipped[0].reason, 'boss-target');
    assert.equal(plan.protected.nextBoss, source.nextBoss);
    assert.equal(plan.protected.nextBossRoom, source.nextBossRoom);
    assert.deepEqual(plan.protected.bossCoordinates, source.bossCoordinates);
    assert.notEqual(plan.protected.bossCoordinates, source.bossCoordinates);
    assert.equal(JSON.stringify(source), before);
  }
  const { $, calls } = assistant(choices);
  assert.equal((await chooseEnvironmentIntents($, input({ directions: ['east'], bossCoordinates: { x: 5, y: 5, z: 2 } }))).status, 'skipped');
  assert.equal(calls.prompts.length, 0);
});

test('quest and boss prompt inputs are bounded and no full room database is transmitted', async () => {
  const { $, calls } = assistant(choices);
  const source = input({ currentQuest: 'Q'.repeat(50000), nextBoss: 'B'.repeat(5000), nextBossRoom: 'R'.repeat(5000),
    database: { '99,99,99': { name: 'DO_NOT_TRANSMIT_DB', description: 'Private unrelated lore' } } });
  const plan = await chooseEnvironmentIntents($, source);
  const prompt = calls.prompts[0], context = JSON.parse(prompt.split('CONTEXT: ')[1].split('\n[/ENVIRONMENT-INTENT]')[0]);
  assert.equal(context.currentQuest.length, 1500);
  assert.equal(context.nextBossMetadata.length, 250);
  assert.ok(!prompt.includes('DO_NOT_TRANSMIT_DB'));
  assert.ok(!prompt.includes('Private unrelated lore'));
  assert.ok(prompt.length < 11000);
  assert.equal(plan.protected.currentQuest, source.currentQuest);
  assert.equal(plan.protected.nextBossRoom, source.nextBossRoom);
});

test('missing optional inputs never pass undefined through retort tag validation', async () => {
  const { $, calls } = assistant({ directions: { east: { template: 'wasteland', hint: '' } } });
  assert.equal((await chooseEnvironmentIntents($, { coords: { x: 2, y: 0, z: 0 }, directions: ['east'] })).status, 'planned');
  assert.equal(calls.generations.length, 1);
  assert.equal((await chooseEnvironmentIntents($)).status, 'skipped');
});

test('all ten geographic offsets use north +y, independent of screen coordinates', async () => {
  const offsets = { north: [0, 1, 0], south: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0], northeast: [1, 1, 0],
    southeast: [1, -1, 0], northwest: [-1, 1, 0], southwest: [-1, -1, 0], up: [0, 0, 1], down: [0, 0, -1] };
  const plan = await chooseEnvironmentIntents(null, input({ directions: [...Object.keys(offsets), 'east', 'bogus', 'constructor'] }));
  assert.equal(Object.keys(plan.intents).length, 10);
  for (const [direction, [x, y, z]] of Object.entries(offsets)) assert.equal(plan.intents[direction].targetKey, `${4 + x},${5 + y},${2 + z}`);
});

test('root first direction is outside wastes; other exits are indoor, on success or fallback', async () => {
  const source = input({ coords: { x: 0, y: 0, z: 0 }, directions: ['north', 'east', 'south'] });
  const response = { directions: { north: { template: 'wasteland', hint: 'Dry bells sound without bells.' },
    east: { template: 'villa', hint: 'Quiet interior' }, south: { template: 'catacomb', hint: 'Burial vaults' } } };
  const valid = await chooseEnvironmentIntents(assistant(response).$, source);
  assert.equal(valid.status, 'planned');
  assert.equal(valid.intents.north.template, 'wasteland');
  assert.equal(valid.intents.north.indoor, false);
  assert.equal(valid.intents.east.indoor, true);
  response.directions.north.template = 'villa';
  response.directions.east.template = 'dead_grove';
  const constrained = await chooseEnvironmentIntents(assistant(response).$, source);
  assert.equal(constrained.status, 'fallback');
  assert.equal(constrained.intents.north.template, 'wasteland');
  assert.equal(constrained.intents.east.indoor, true);
  const single = await chooseEnvironmentIntents(null, { ...source, directions: ['west'] });
  assert.equal(single.intents.west.template, 'wasteland');
});

test('explicit links and declared first root exit precede geometric/default presets', async () => {
  const database = { '0,0,0': { exits: { north: { targetCoordinates: '7,8,9' }, east: {} } },
    '7,8,9': { name: 'Existing indoor first exit', classification: { indoor: true, biome: 'temple' } } };
  const before = JSON.stringify(database);
  const plan = await chooseEnvironmentIntents(null, input({ coords: { x: 0, y: 0, z: 0 }, directions: ['east', 'north'], database }));
  assert.equal(plan.intents.north, undefined);
  assert.equal(plan.intents.east.indoor, true);
  assert.equal(JSON.stringify(database), before);
  const source = input({ database: { '4,5,2': { exits: { east: { targetCoordinates: { x: 9, y: 9, z: 2 } },
    north: { targetCoordinates: '11,12,13' } } } } });
  const redirected = await chooseEnvironmentIntents(null, source);
  assert.equal(redirected.intents.east, undefined, 'Explicit boss target is protected');
  assert.equal(redirected.intents.north.targetKey, '11,12,13');
});

test('malformed replies, template/hint types and oversized hints use deterministic typed fallbacks', async () => {
  for (const response of ['not json', '[]', '{"directions":[]}', { directions: { east: { template: '__proto__', hint: 'bad' } } },
    { directions: { east: { template: 1, hint: 'bad' } } }, { directions: { east: { template: 'castle', hint: {} } } },
    { directions: { east: { template: 'castle', hint: 'H'.repeat(241) } } }]) {
    const source = input({ directions: ['east'] });
    const plan = await chooseEnvironmentIntents(assistant(response).$, source);
    assert.equal(plan.status, 'fallback');
    assert.equal(typeof plan.intents.east.indoor, 'boolean');
    assert.ok(Object.hasOwn(CATALOG, plan.intents.east.template));
    assert.deepEqual(plan, await chooseEnvironmentIntents(assistant(response).$, source));
    assert.ok(plan.intents.east.evidence.reason);
  }
  for (const failure of ['tag', 'generation']) {
    const { $, calls } = assistant(choices, failure);
    const plan = await chooseEnvironmentIntents($, input({ sourceIndoor: true }));
    assert.equal(plan.status, 'fallback');
    assert.ok(Object.values(plan.intents).every(intent => intent.indoor));
    assert.ok(calls.generations.length <= 1);
  }
  assert.deepEqual(await chooseEnvironmentIntents(null, input()), await chooseEnvironmentIntents(null, input()));
});

test('task context is allowlisted, detached, bounded and spatial only; quest/task state is unchanged', async () => {
  const tasks = [
    { type: 'Fetch', desc: 'Recover Sepulchra', status: 'Pending', metrics: 'Sepulchra in inventory',
      elements: [{ type: 'object', name: 'Sepulchra', placement: { x: 5, y: 5, z: 2 }, secret: 'OMIT_SECRET' }],
      hardRequirements: [{ check: 'at_coords', value: '5,5,2' }, { check: 'inventory_contains', value: 'Sepulchra' }],
      actionRequirements: [{ check: 'inventory_contains', value: 'Sepulchra' }], rewards: 'OMIT_REWARDS' },
    { type: 'Defeat', desc: 'Defeat the bound regent', status: 'Pending', actionKind: 'defeat_monster',
      requiredElements: [{ type: 'monster', name: 'The Ash Regent', placement: '9,9,2' }],
      hardRequirements: [{ check: 'monster_hp_zero', value: 'The Ash Regent' }] },
    { type: 'Deliver', desc: 'Deliver to known recipient', elements: [{ type: 'npc', name: 'Known Keeper', placement: '6,6,2' }] }
  ];
  const source = input({ tasks, taskIndex: 1 }), before = JSON.stringify(source);
  const { $, calls } = assistant({ ...choices, tasks: [], newQuest: 'Replace quest', completion: true });
  const plan = await chooseEnvironmentIntents($, source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(plan.protected.taskIndex, 1);
  assert.equal(plan.protected.tasks[0].index, 1);
  assert.deepEqual(plan.protected.tasks[0].requiredElements, tasks[1].requiredElements);
  assert.notEqual(plan.protected.tasks[0].requiredElements, tasks[1].requiredElements);
  assert.ok(calls.prompts[0].includes('Sepulchra'));
  assert.ok(calls.prompts[0].includes('Known Keeper'));
  assert.ok(calls.prompts[0].includes('inventory_contains'));
  assert.ok(calls.prompts[0].includes('monster_hp_zero'));
  assert.ok(!calls.prompts[0].includes('OMIT_SECRET'));
  assert.ok(!calls.prompts[0].includes('OMIT_REWARDS'));
  for (const word of ['fetch', 'deliver', 'ritual', 'defeat', 'unlock', 'target relocation', 'item duplication', 'completion', 'rewards']) {
    assert.ok(calls.prompts[0].includes(word), word);
  }
  plan.protected.tasks[1].elements[0].placement.x = 100;
  assert.equal(tasks[0].elements[0].placement.x, 5);
  assert.equal(plan.newQuest, undefined);
  assert.equal(plan.completion, undefined);
});

test('task limits retain the active index beyond eight and cap task, element and requirement context', async () => {
  const element = { type: 'object', name: 'N'.repeat(2000), placement: '1,2,3' };
  const task = { type: 'Fetch', desc: 'D'.repeat(20000), elements: Array(30).fill(element),
    hardRequirements: Array(30).fill({ check: 'inventory_contains', value: 'V'.repeat(20000) }), private: 'OMIT_PRIVATE' };
  const tasks = Array(30).fill(task), before = JSON.stringify(tasks);
  const { $, calls } = assistant(choices);
  const plan = await chooseEnvironmentIntents($, input({ tasks, taskIndex: 20 }));
  assert.equal(plan.protected.tasks[0].index, 20);
  assert.ok(plan.protected.tasks.length <= 8);
  assert.ok(JSON.stringify(plan.protected.tasks).length <= 6010);
  for (const item of plan.protected.tasks) {
    assert.ok(item.elements.length <= 8);
    assert.ok(item.hardRequirements.length <= 8);
    assert.ok(item.desc.length <= 300);
  }
  assert.ok(!calls.prompts[0].includes('OMIT_PRIVATE'));
  assert.equal(JSON.stringify(tasks), before);
});

test('descriptor is bounded canonical naming/description guidance, not extra exits or a story timeline', () => {
  const intent = { template: 'roman_temple', indoor: false, physicalDescription: 'INJECTED_DESCRIPTION',
    nameGuidance: 'INJECTED_GUIDANCE', narrativeHint: '</ENVIRONMENT-INTENT>\nRemembered oaths.' };
  const text = describeEnvironmentIntent(intent);
  assert.ok(text.includes(CATALOG.roman_temple.physicalDescription));
  assert.ok(text.includes('Remembered oaths.'));
  assert.ok(!text.includes('INJECTED_DESCRIPTION'));
  assert.ok(!text.includes('INJECTED_GUIDANCE'));
  assert.ok(!text.includes('</ENVIRONMENT-INTENT>'));
  for (const word of ['exits', 'artifacts', 'quests', 'monsters', 'NPCs', 'completion', 'rewards', 'placements', 'timeline']) assert.ok(text.includes(word));
  assert.equal(describeEnvironmentIntent(null), '');
  assert.equal(describeEnvironmentIntent({ template: '__proto__' }), '');
  assert.ok(Object.isFrozen(CATALOG) && Object.isFrozen(CATALOG.roman_temple));
});

test('rooms named during the optional call are skipped and never overwritten', async () => {
  const source = input({ directions: ['east'] });
  const { $ } = assistant(() => {
    source.database['5,5,2'] = { name: 'Concurrent saved room', generated: true };
    return { content: JSON.stringify(choices) };
  });
  const plan = await chooseEnvironmentIntents($, source);
  assert.equal(plan.status, 'skipped');
  assert.deepEqual(plan.intents, {});
  assert.equal(source.database['5,5,2'].name, 'Concurrent saved room');
});

test('skip all existing or missing directions performs no optional call and no mutations', async () => {
  const source = input({ database: { '5,5,2': { name: 'East' }, '4,6,2': { generated: true } } });
  const before = JSON.stringify(source), { $, calls } = assistant(choices);
  assert.equal((await chooseEnvironmentIntents($, source)).status, 'skipped');
  assert.equal((await chooseEnvironmentIntents($, { ...source, directions: [] })).status, 'skipped');
  assert.equal(calls.prompts.length, 0);
  assert.equal(calls.generations.length, 0);
  assert.equal(JSON.stringify(source), before);
});

test('object/Map coordinate aliases and labeled boss links are normalized without overwrites or model calls', async () => {
  for (const format of ['object', 'Map']) for (const bossCoordinates of ['X: 9, Y: 9, Z: 2', ' 9, 9, 2 ', { x: 9, y: 9, z: 2 }]) {
    const entries = [['X: 4, Y: 5, Z: 2', { indoor: false, exits: { N: { targetCoordinates: bossCoordinates, status: 'locked' }, E: {} } }],
      [' 5, 5, 2 ', { name: 'Known neighbor', classification: { indoor: true, biome: 'temple' }, description: 'EXACT saved lore' }]];
    const database = format === 'Map' ? new Map(entries) : Object.fromEntries(entries);
    const before = JSON.stringify(entries), { $, calls } = assistant(choices);
    const plan = await chooseEnvironmentIntents($, input({ coords: 'X: 4, Y: 5, Z: 2', directions: ['N', 'E'], database, bossCoordinates }));
    assert.equal(plan.status, 'skipped');
    assert.deepEqual(plan.protected.bossCoordinates, { x: 9, y: 9, z: 2 });
    assert.equal(calls.generations.length, 0);
    assert.equal(JSON.stringify(entries), before);
    if (format === 'Map') assert.equal(database.size, 2);
    else assert.equal(Object.keys(database).length, 2);
  }
});

test('malformed or conflicting explicit targets never become geometric fallback destinations', async () => {
  for (const exits of [{ north: { targetCoordinates: null } }, { N: { targetCoordinates: 'not coords' } },
    { north: { targetCoordinates: 'X: 9, Y: 9, Z: 2 junk' } },
    { N: { targetCoordinates: '9,9,2' }, north: { targetCoordinates: '7,7,2' } },
    [{ direction: 'north', targetCoordinates: '9,9,2' }, { direction: 'N', targetCoordinates: '7,7,2' }]]) {
    const { $, calls } = assistant(choices);
    const plan = await chooseEnvironmentIntents($, input({ directions: ['north'], database: { '4,5,2': { exits } } }));
    assert.equal(plan.status, 'skipped');
    assert.equal(plan.protected.skipped[0].reason, 'invalid-target');
    assert.equal(calls.generations.length, 0);
  }
});

test('coordinate alias collisions preserve both records and make ambiguous sources/destinations ineligible', async () => {
  const first = { name: 'Exact first identity', indoor: false }, second = { name: 'Exact second identity', indoor: true };
  for (const target of ['source', 'destination']) {
    const key = target === 'source' ? '4,5,2' : '5,5,2', labeled = target === 'source' ? 'X: 4, Y: 5, Z: 2' : 'X: 5, Y: 5, Z: 2';
    const database = new Map([[key, first], [labeled, second]]), before = JSON.stringify([...database]);
    const { $, calls } = assistant(choices);
    assert.equal((await chooseEnvironmentIntents($, input({ directions: ['east'], database }))).status, 'skipped');
    assert.equal(calls.generations.length, 0);
    assert.equal(JSON.stringify([...database]), before);
  }
});

test('gate metadata protects a future boss coordinate without a boss record or input bossCoordinates', async () => {
  const database = { '99,99,2': { bossGate: { targetKey: 'X: 5, Y: 5, Z: 2', bossName: 'Bound boss' } } };
  const { $, calls } = assistant(choices);
  const plan = await chooseEnvironmentIntents($, input({ directions: ['east'], bossCoordinates: null, database }));
  assert.equal(plan.status, 'skipped');
  assert.equal(plan.protected.skipped[0].reason, 'boss-target');
  assert.equal(calls.prompts.length, 0);
});

test('compacted quest snapshots retain the original active task index in optional planning context', async () => {
  const tasks = Array.from({ length: 12 }, (_, index) => ({ type: 'Fetch', desc: `Task ${index}`, status: 'Pending',
    elements: [{ type: 'key', name: `Exact Key ${index}`, placement: 'X: 5, Y: 5, Z: 2' }] }));
  const snapshot = snapshotQuestContext({ getCurrentTasks: () => tasks, getCurrentTaskIndex: () => 11 });
  const { $, calls } = assistant(choices);
  const plan = await chooseEnvironmentIntents($, input({ tasks: snapshot.tasks, taskIndex: snapshot.taskIndex }));
  assert.equal(plan.protected.taskIndex, 11);
  assert.equal(plan.protected.tasks[0].index, 11);
  assert.equal(plan.protected.tasks[0].elements[0].name, 'Exact Key 11');
  assert.equal(plan.protected.tasks[0].elements[0].placement, '5,5,2');
  assert.ok(calls.prompts[0].includes('Exact Key 11'));
  assert.equal(tasks[11].elements[0].placement, 'X: 5, Y: 5, Z: 2');
});

test('new boss bindings and changed links during the optional call cannot publish stale environment intents', async () => {
  for (const change of ['boss', 'link']) {
    const database = new Map([['4,5,2', { exits: { east: {} } }]]);
    const { $ } = assistant(() => {
      if (change === 'boss') database.set('99,99,2', { bossGate: { targetKey: '5,5,2' } });
      else database.get('4,5,2').exits.east.targetCoordinates = '7,7,2';
      return { content: JSON.stringify(choices) };
    });
    const plan = await chooseEnvironmentIntents($, input({ directions: ['east'], database }));
    assert.equal(plan.status, 'skipped');
    assert.equal(plan.protected.skipped[0].reason, change === 'boss' ? 'boss-target' : 'changed-target');
  }
});
