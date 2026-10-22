'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const Host = require('../retort/pcModelHost'), Models = require('../retort/gameModels'), Runtime = require('../retort/gameRetort');
const Budget = require('../retort/holodekBudget'), Rooms = require('../retort/holodekRoomWork'), Narration = require('../retort/holodekNarration');
const Arbiter = require('../retort/holodekAdjudication'), I = require('../assets/dungeonInhabitants');
async function runtime(task, answer) {
  const requests = [], previous = Models.current().id;
  const host = Host.createHost({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    assert.ok(Budget.tally(body.messages, [{ response_format: body.response_format }]).total <= Budget.CEILING);
    const result = await answer(body, requests.length);
    return { ok: true, text: async () => JSON.stringify({ model: 'holodek-1', choices: [{ finish_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify(result) } }] }) };
  } });
  const app = Runtime.createRuntime({ models: { ...Models, getLocalClient: () => Host.modelClient(host) }, log() {} });
  Models.restore('holodek-1');
  try {
    return { result: await app.run(app.retort(async $ => {
      await $.user('LEGACY PARENT MUST NOT LEAK ' + 'Old unrelated work. '.repeat(5000));
      return task($, app);
    }), null, { shouldSaveToLog: false }), requests };
  } finally { Models.restore(previous); }
}
const text = body => body.messages.map(row => row.content).join('\n');
const fixture = { name: 'Ruined Temple Entrance', indoor: true, exits: { northwest: { targetCoordinates: '-1,1,0' }, down: { targetCoordinates: '0,0,-1' } } };
const consoleText = 'Room Name: Bronze Hall\nRoom Description: A roofed hall with an old bronze bell.\nCoordinates: X: 0, Y: 0, Z: 0\nExits: northwest, down\nObjects in Room: bronze bell\nInventory: None\nPuzzle in Room: An old bell frame.\nPuzzle Solution: Ring the original bell once.';

test('adjacent naming is scoped, sequential, coordinate-bound and never inherits the failed parent prompt', async () => {
  const database = { '0,0,0': fixture }, before = JSON.stringify(database);
  const { result, requests } = await runtime($ => Rooms.adjacentNames($, { database, sourceKey: '0,0,0', sourceName: fixture.name,
    directions: ['northwest', 'down'], outdoorDirection: 'northwest',
    intents: { northwest: { template: 'wasteland', indoor: false, campaignSetting: { region: 'Ash Wastes', atlas: 'irrelevant'.repeat(10000) } },
      down: { template: 'crypt', indoor: true } } }), (_body, count) => ({ name: count === 1 ? 'The Rusted Expanse' : 'The Bell Crypt' }));
  assert.deepEqual(result, { northwest: 'The Rusted Expanse', down: 'The Bell Crypt' });
  assert.equal(JSON.stringify(database), before); assert.equal(requests.length, 2);
  assert.ok(requests.every(body => !/LEGACY PARENT|irrelevant/.test(text(body))));
  assert.match(text(requests[0]), /-1,1,0/); assert.match(text(requests[1]), /The Rusted Expanse/i);
  assert.match(text(requests[0]), /"indoor":false/); assert.match(text(requests[1]), /"indoor":true/);
});

test('published connected rooms are reused without a naming request or a rename', async () => {
  const database = { '0,0,0': fixture, '-1,1,0': { name: 'Published Ashland', objects: ['existing relic'] } };
  const { result, requests } = await runtime($ => Rooms.roomName($, { database, sourceKey: '0,0,0', direction: 'northwest' }), () => assert.fail('No inference for a published name.'));
  assert.equal(result, 'Published Ashland'); assert.equal(requests.length, 0);
});

test('description link receives physical context, not previous room-naming instructions', async () => {
  const { result, requests } = await runtime($ => require('../retort/roomDescription').generate($, {
    name: 'The Bell Crypt', coordinates: '0,0,-1', classification: { indoor: true, biome: 'crypt' },
    room: { campaignSetting: { region: 'Ash Wastes', atlas: 'irrelevant'.repeat(10000) } },
    physicalGuidance: ['The crypt has a continuous rock ceiling.']
  }), () => ({ description: 'A continuous rock ceiling covers burial niches and an old bell frame.' }));
  assert.match(result, /rock ceiling/); assert.equal(requests.length, 1);
  assert.doesNotMatch(text(requests[0]), /LEGACY PARENT|irrelevant/);
  assert.match(text(requests[0]), /0,0,-1/);
});

test('scene, one NPC at a time, and each future cache are separate links with witnessed-only continuity', async () => {
  const characters = [{ name: 'Ilyra', encountered: true, background: { history: 'PRIVATE ILYRA HISTORY' } },
    { name: 'Drel', encountered: true, background: { history: 'PRIVATE DREL HISTORY' } }];
  let speech = 0;
  const { result, requests } = await runtime($ => Narration.generate($, { consoleText, userInput: 'What happened to the bell?',
    characters, audibleNames: ['Ilyra', 'Drel'], requiredSpeakers: ['Ilyra'] }), body => {
    const fields = body.response_format.json_schema.schema.properties;
    if (fields.prose) return { prose: 'The bell rests in its bronze frame. The question draws two attentive glances.', speakers: ['Ilyra', 'Drel'] };
    if (fields.line) return { action: 'glances at the bell.', line: ++speech === 1 ? 'I heard the bell crack at dusk.' : 'I heard that crack too.', remember: '', recipient: 'PC' };
    return { lines: Array(fields.lines.minItems).fill('CACHED FUTURE POSSIBILITY') };
  });
  const parsed = I.extractDialogue(result.content, ['Ilyra', 'Drel'], { audibleNames: ['Ilyra', 'Drel'] });
  assert.equal(parsed.dialogue.length, 2); assert.equal(parsed.replies.length, 2);
  const live = requests.filter(body => body.response_format.json_schema.schema.properties.line);
  assert.equal(live.length, 2); assert.match(text(live[1]), /I heard the bell crack at dusk/);
  assert.doesNotMatch(text(live[1]), /PRIVATE ILYRA HISTORY/); assert.match(text(live[1]), /PRIVATE DREL HISTORY/);
  assert.ok(requests.every(body => !text(body).includes('LEGACY PARENT')));
  assert.doesNotMatch(parsed.content, /CACHED FUTURE POSSIBILITY/);
});

test('no perceived speakers means environmental prose, not hallucinated dialogue', async () => {
  const { result, requests } = await runtime($ => Narration.generate($, { consoleText, audibleNames: [], characters: [] }),
    () => ({ prose: 'The bell frame creaks in the otherwise quiet hall.', speakers: [] }));
  const parsed = I.extractDialogue(result.content, []);
  assert.equal(parsed.dialogue.length, 0); assert.equal(requests.length, 1);
});

test('adjudication authors each actor and range separately; only the engine-selected roll becomes metadata', async () => {
  let alternative = 0;
  const { result, requests } = await runtime($ => Arbiter.ranges($, { actors: ['Mortacia', 'Ilyra'], action: 'Search',
    userInput: 'Search the bell frame', consoleText, exhausted: false }), body => {
    if (body.response_format.json_schema.schema.properties.upperBounds) return { upperBounds: [6, 14, 20] };
    return { outcome: 'Studies the bronze frame without taking anything. Alternative ' + ++alternative,
      result: alternative % 3 === 0 ? 'success' : 'partial', target: 'bronze bell', questAttempted: false,
      puzzleSteps: [], puzzleRequiresExit: false, puzzleRequiresObject: false };
  });
  const decoded = require('../retort/adjudicationMetadata').extract(result.content);
  assert.equal(decoded.candidates.length, 6); assert.equal(requests.length, 8);
  const initial = { 'Selected Characters': ['Mortacia'], 'Dice Rolls': [{ character: 'Mortacia', roll: 18 }],
    'Outcome Ranges': [[{ low: 15, high: 20, outcome: decoded.candidates[2].outcome }]], Action: 'Search' };
  const chosen = require('../retort/adjudicationMetadata').select(decoded.candidates, initial);
  assert.equal(chosen.length, 1); assert.equal(chosen[0].roll, 18); assert.equal(chosen[0].low, 15);
  assert.ok(requests.every(body => !text(body).includes('LEGACY PARENT')));
});

test('XP links see selected outcomes, never the whole table of hypothetical successes', async () => {
  const initial = { Action: 'Search', 'Dice Rolls': [{ character: 'Mortacia', roll: 5 }],
    Outcomes: [{ character: 'Mortacia', outcome: 'Misses the old mark.' }], 'Outcome Ranges': ['UNROLLED TREASURE MUST NOT LEAK'] };
  const { result, requests } = await runtime($ => Arbiter.xp($, ['Mortacia', 'Ilyra'], initial, 'Award only justified action XP.'), () => ({ xp: 0 }));
  assert.deepEqual(result.result, { Mortacia: 0, Ilyra: 0 });
  assert.ok(requests.every(body => !text(body).includes('UNROLLED TREASURE')));
});

test('an unavailable link aborts adjudication authoring before a partial table can be returned', async () => {
  await assert.rejects(runtime($ => Arbiter.ranges($, { actors: ['Mortacia'], action: 'Search', userInput: 'search', consoleText }),
    (_body, index) => { if (index > 1) throw Error('offline unavailable'); return { upperBounds: [6, 14, 20] }; }), /Ollama/);
});

test('production startup, final conversation, encounter and action paths use the scoped links', () => {
  const main = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  assert.match(main, /holodekRoomWork'\)\.adjacentNames/); assert.match(main, /holodekAdjudication'\)\.ranges/);
  assert.match(main, /holodekNarration'\)\.generate/);
  assert.match(fs.readFileSync(require.resolve('../retort/encounterNarration'), 'utf8'), /holodekNarration'\)\.generate/);
});

test('each live speaker receives only their own recalled disclosures; unseen caches get no journey or private input', async () => {
  const characters = [{ name: 'Ilyra', partyMember: true }, { name: 'Drel', encountered: true }, { name: 'Distant', encountered: false }];
  const { requests } = await runtime(async $ => { const result = await Narration.generate($, { consoleText, characters, audibleNames: ['Ilyra', 'Drel'],
    userInput: 'PRIVATE CURRENT INPUT', quest: 'PRIVATE QUEST PLAN', journey: { promise: 'PRIVATE JOURNEY' },
    currentSituation: { narrative: 'The bell rings once.', updatedGameConsole: 'DUPLICATED CONSOLE MUST NOT LEAK' },
    task: { desc: 'Study the bell.', story: 'WHOLE TASK GRAPH MUST NOT LEAK' },
    recollections: [{ name: 'Ilyra', recollection: { notes: ['ILYRA PRIVATE RECOLLECTION'] } }, { name: 'Drel', recollection: { notes: ['DREL PRIVATE RECOLLECTION'] } }],
    personalMemories: [{ name: 'Ilyra', heardCurrentConversation: true, memories: [{ excerpt: 'ILYRA WITNESSED DISCLOSURE' }] },
      { name: 'Drel', heardCurrentConversation: true, memories: [{ excerpt: 'DREL WITNESSED DISCLOSURE' }] },
      { name: 'Distant', heardCurrentConversation: false, memories: [] }] });
    await Narration.cache($, { characters: [characters[2]], roomDescription: 'A bronze hall.', quest: 'PRIVATE QUEST PLAN',
      journey: { promise: 'PRIVATE JOURNEY' }, conversation: 'PRIVATE CURRENT INPUT',
      personalMemories: [{ name: 'Distant', heardCurrentConversation: false, memories: [] }] });
    return result;
  }, body => {
    const fields = body.response_format.json_schema.schema.properties;
    if (fields.prose) return { prose: 'The bell rings once.', speakers: ['Ilyra', 'Drel'] };
    if (fields.line) return { action: 'nods.', line: 'I hear it now.', remember: '', recipient: 'PC' };
    return { lines: Array(fields.lines.minItems).fill('I am still tending the bronze frame.') };
  });
  const live = requests.filter(body => body.response_format.json_schema.schema.properties.line);
  assert.match(text(live[0]), /ILYRA WITNESSED DISCLOSURE/); assert.doesNotMatch(text(live[0]), /DREL PRIVATE RECOLLECTION|DREL WITNESSED DISCLOSURE/);
  assert.match(text(live[1]), /DREL PRIVATE RECOLLECTION/); assert.doesNotMatch(text(live[1]), /ILYRA PRIVATE RECOLLECTION|ILYRA WITNESSED DISCLOSURE|PRIVATE QUEST PLAN/);
  const distant = requests.find(body => text(body).includes('Own character data: {"name":"Distant"'));
  assert.ok(distant); assert.doesNotMatch(text(distant), /PRIVATE CURRENT INPUT|PRIVATE QUEST PLAN|PRIVATE JOURNEY/);
  assert.ok(requests.every(body => !/DUPLICATED CONSOLE|WHOLE TASK GRAPH/.test(text(body))));
});

function answerSchema(schema, key = '') {
  if (schema.enum) return schema.enum[0];
  if (Array.isArray(schema.type)) schema = { ...schema, type: schema.type.find(type => type !== 'null') };
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([name, child]) => [name, answerSchema(child, name)]));
  if (schema.type === 'array') return Array.from({ length: schema.minItems || 0 }, () => answerSchema(schema.items));
  if (schema.type === 'number' || schema.type === 'integer') return schema.minimum ?? 0;
  if (schema.type === 'boolean') return false;
  if (/color|primary|secondary|shadow|highlight|grade/i.test(key)) return '#aa8855';
  if (schema.pattern?.startsWith('^#')) return '#aa8855';
  return key === 'name' ? 'Bronze Shrine' : 'Old bronze masonry.';
}

test('visual style is compiled from small typed rendering parts, not inherited JSON prose', async () => {
  const { result, requests } = await runtime($ => Rooms.visualStyle($, 'A bronze hall with a broken arch.', '0,0,0', { indoor: true, biome: 'temple' }),
    body => answerSchema(body.response_format.json_schema.schema));
  assert.equal(result.floor.material, 'stone'); assert.equal(result.palette.primary, '#aa8855');
  assert.ok(requests.length >= 5); assert.ok(requests.every(body => !text(body).includes('LEGACY PARENT')));
});

test('level geometry uses the real bounded local chain even without a cloud API key', async () => {
  const previousCache = process.env.HOLODEK_LEVEL_CACHE, previousKey = process.env.OPENAI_API_KEY;
  const path = require('node:path'), os = require('node:os');
  process.env.HOLODEK_LEVEL_CACHE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-level-chain-')), 'cache.json');
  delete process.env.OPENAI_API_KEY;
  delete require.cache[require.resolve('../retort/levelSpec')];
  try {
    const { result, requests } = await runtime(async ($, app) => {
      const saved = { run: Runtime.run, retort: Runtime.retort };
      Runtime.run = app.run; Runtime.retort = app.retort;
      try { return await require('../retort/levelSpec').getLevelSpec({ roomName: 'Bronze Hall', description: 'A covered hall with a bronze shrine.' }); }
      finally { Object.assign(Runtime, saved); }
    }, body => answerSchema(body.response_format.json_schema.schema));
    assert.equal(result.source, 'llm'); assert.equal(result.structures.length, 1);
    assert.ok(requests.length > 6); assert.ok(requests.every(body => !text(body).includes('LEGACY PARENT')));
    assert.deepEqual(require('../retort/levelSpec').validate(result), []);
  } finally {
    if (previousCache === undefined) delete process.env.HOLODEK_LEVEL_CACHE; else process.env.HOLODEK_LEVEL_CACHE = previousCache;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    delete require.cache[require.resolve('../retort/levelSpec')];
  }
});

test('missing character profiles are authored one exact person at a time before assembly', async () => {
  const { result, requests } = await runtime($ => require('../retort/characterProfiles').generateProfiles($,
    [{ Name: 'Ada', Race: 'Human', Class: 'Mage' }, { Name: 'Bryn', Race: 'Elf', Class: 'Scout' }], 'offline-run'), body => ({
      name: body.response_format.json_schema.schema.properties.name.enum[0], personality: 'Careful and curious.',
      voice: 'Speaks quietly.', history: 'Studied bronze bells. Left home to travel.', motivation: 'Wants to understand the bronze craft.' }));
  assert.deepEqual(result.map(row => row.name), ['Ada', 'Bryn']); assert.equal(requests.length, 2);
  assert.ok(requests.every(body => !text(body).includes('LEGACY PARENT')));
});

test('adjudication retains mechanical quest requirements but excludes the complete adventure graph', async () => {
  const task = { id: 'bell-step', type: 'Puzzle', desc: 'Ring the bell.', metrics: 'The bound bell rang.',
    actionRequirements: [{ check: 'bell_rung', value: 'bronze bell' }], story: 'HUGE UNRELATED ADVENTURE GRAPH '.repeat(1000) };
  const { requests } = await runtime($ => Arbiter.action($, { userInput: 'Ring the bell', task }, ['PuzzleSolving']), () => ({ action: 'PuzzleSolving' }));
  assert.match(text(requests[0]), /bell_rung/); assert.doesNotMatch(text(requests[0]), /HUGE UNRELATED ADVENTURE GRAPH/);
});

test('ordinary narration refreshes only current voices, not every distant resident on the critical path', async () => {
  const { requests } = await runtime($ => Narration.generate($, { consoleText, audibleNames: [],
    characters: Array.from({ length: 20 }, (_, index) => ({ name: 'Distant ' + index, encountered: false })) }),
    () => ({ prose: 'The wind settles over the bronze hall.', speakers: [] }));
  assert.equal(requests.length, 1);
});

test('legacy exit, equipment and artifact helpers use clean local requests at their actual production boundaries', async () => {
  const mainFile = require.resolve('../retort/retortWithUserInput');
  const source = fs.readFileSync(mainFile, 'utf8'), context = {
    require: require('node:module').createRequire(mainFile), StoryPrompts: { isHolodek1: () => true }, console: { log() {} }
  };
  let helpers = '';
  for (const [start, end] of [['async function selectExitStatus(', '// Drop-in replacement for syncKeysOnRoomEntry'],
    ['async function generateMonsterEquipmentName(', 'async function generateMonstersForRoomUsingGPT('],
    ['async function determineArtifactType(', '// Generates the boss monster and adds it']])
    helpers += source.slice(source.indexOf(start), source.indexOf(end)) + '\n';
  Object.assign(context, new Function('require', 'StoryPrompts', 'console', helpers + '\nreturn { selectExitStatus, generateMonsterEquipmentName, determineArtifactType };')(
    context.require, context.StoryPrompts, context.console));
  const { result, requests } = await runtime(async $ => ({ status: await context.selectExitStatus($),
    equipment: await context.generateMonsterEquipmentName($, 'weapon', 'Bronze Warden'),
    artifact: await context.determineArtifactType($, 'bronze spear') }), body => {
      const fields = body.response_format.json_schema.schema.properties;
      return fields.status ? { status: 'locked' } : fields.name ? { name: 'bronze spear' } : { type: 'weapon' };
    });
  assert.deepEqual(result, { status: 'locked', equipment: 'bronze spear', artifact: 'weapon' });
  assert.equal(requests.length, 3); assert.ok(requests.every(body => !text(body).includes('LEGACY PARENT')));
});
