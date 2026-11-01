'use strict';
process.env.HOLODEK_GENRE_EXPANSION = '1';
process.env.HOLODEK_ARCHITECTURE_EXPANSION = '1';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { templateContent } = require('retort-js/dist/message');
const Setting = require('../retort/settingLayer'), Prompts = require('../retort/graveMasterStoryPrompts');
const Homebrew = require('../retort/homebrewStoryPrompts'), Journey = require('../retort/journeyMemory');
const Audience = require('../assets/dialogueAudience'), Divine = require('../retort/divineEncounters');
const foreign = /\b(?:Children of the Grave|Grave Master|Mortacia|Suzerain|Sepulchra|Tartarus|Hades|Arithus|canonical pantheon|underworld's chaos)\b/;
function capture(work) {
  const messages = [], $ = {};
  for (const role of ['user', 'assistant']) $[role] = (s, ...v) => messages.push({ role, content: typeof s === 'string' ? s : templateContent(s, ...v) });
  work($); return messages;
}
function world(genre) {
  const bible = Setting.validateBible(Setting.localBible('Original ' + genre + ' campaign', [genre]));
  bible.topology.goal = 'Tidemark Observatory'; bible.gmName = 'Flight Controller';
  bible.masterPrompt = Setting.masterText(Setting.masterLocal(bible), bible);
  return bible;
}
const state = { getUpdatedGameConsole: () => 'Room Name: Docking Ring\nCoordinates: X: 1, Y: 0, Z: 0\nRooms Visited: 2',
  getCurrentTasks: () => [{ type: 'Fetch', desc: 'Read the verified signal.', requiredElements: [{ type: 'object', name: 'signal record', placement: '1,0,0' }] }],
  getCurrentTaskIndex: () => 0, getCurrentQuest: () => 'Trace the signal', getRoomNameDatabase: () => '{}' };

for (const genre of Setting.GENRES) test('Mode 4 isolates original, room, turn, journey and dialogue prompts for ' + genre, () => {
  Setting.setActive(world(genre));
  try {
    const messages = capture($ => {
      Prompts.appendOriginal($);
      Prompts.appendStory($, { roomName: 'Docking Ring', questJustSeeded: true, sharedState: state,
        updatedGameConsole: state.getUpdatedGameConsole(), parseNpcPartyNamesFromConsole: () => ['Mira'] });
      Homebrew.appendRoom($, { roomName: 'Docking Ring', worldContext: { exits: ['north'] } });
    });
    const raw = JSON.stringify(messages);
    assert.doesNotMatch(raw, foreign); assert.match(raw, /MODE-4 TURN/); assert.match(raw, /MODE-4 ROOM/);
    assert.match(raw, /signal record/); assert.match(raw, /Mira/); assert.match(raw, /must be discovered/);
    assert.equal(Journey.progressSynopsis(state).destination, 'Tidemark Observatory');
    assert.equal(Divine.prompt(state, []), '');
    assert.doesNotMatch(Audience.COMMAND_SEMANTICS, foreign);
    const population = Homebrew.population({ roomName: 'Docking Ring', slots: [{ slot: 0 }], accepted: [], homeSites: ['commons'] });
    assert.doesNotMatch(population, foreign); assert.match(population, /exactly 1 original/);
    assert.doesNotMatch(Homebrew.characterVoices(), foreign); assert.match(Homebrew.characterVoices(), /Output only valid JSON/);
    assert.equal(Divine.finalStage('Artifacts Found: 14/15\nQuests Achieved: 20/21'), false);
    assert.equal(Divine.seedRoom({}, '1,0,0', { actors: {} }, 'run'), null);
    assert.equal(Divine.finalBoss(state, 'keep original world'), 'keep original world');
    assert.doesNotMatch(JSON.stringify(Setting.applyBody({ messages })), foreign);
  } finally { Setting.setActive(null); }
});

test('the wire boundary replaces complete legacy user instructions, not just their names', () => {
  const b = world('sci-fi'); Setting.setActive(b);
  try {
    const body = { messages: [
      { role: 'user', content: "Instructions for the Grave Master:\n Hereafter, 'You' refers to... Mortacia lost her power; reclaim Sepulchra." },
      { role: 'user', content: [{ type: 'text', text: '[CHILDREN-OF-THE-GRAVE] Go to Hades.' }] },
      { role: 'user', content: 'Keep the action schema: {chosenAction, target}; preserve pending dice.' }
    ] };
    Setting.applyBody(body);
    assert.equal(body.messages[0].content, b.masterPrompt);
    assert.equal(body.messages[1].content[0].text, b.masterPrompt);
    assert.match(body.messages[2].content, /chosenAction, target/);
    assert.doesNotMatch(JSON.stringify(body), foreign);
    delete b.masterPrompt;
    assert.doesNotMatch(JSON.stringify(Setting.applyBody({ messages: [{ role: 'user', content: 'Instructions for the Grave Master: Mortacia' }] })), foreign);
  } finally { Setting.setActive(null); }
});

test('canonical campaign prompts, destination and divine court remain canonical', () => {
  Setting.setActive(null);
  const messages = capture($ => Prompts.appendOriginal($, { full: true }));
  assert.match(JSON.stringify(messages), /Mortacia/);
  assert.match(Journey.progressSynopsis(state).destination, /Throne Room of Hades/);
  assert.match(Divine.prompt(state, []), /DIVINE-COURT/);
});

test('main Retort routes both legacy inline blocks and room construction into Mode 4 before canonical prompts', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  assert.equal((source.match(/WorldSetting\.current\(\)\) StoryPrompts\.appendOriginal\(\$\)/g) || []).length, 2);
  assert.match(source, /if \(WorldSetting\.current\(\)\) \{\s*require\('\.\/homebrewStoryPrompts'\)\.appendRoom/);
});

test('every configured model sends the isolated world prompt at the actual completion boundary', async () => {
  const Models = require('../retort/gameModels'), Transport = require('../retort/modelTransport');
  Setting.setActive(world('sci-fi'));
  try {
    for (const row of Models.catalog) {
      let wire;
      const client = { chat: { completions: { create: async body => {
        wire = body;
        return { choices: [{ finish_reason: 'stop', message: { content: 'The signal panel is steady.' } }] };
      } } } };
      const service = Models.createModelService({ initial: row.id, clientFor: () => client });
      const models = { ...service, getLocalClient: () => client, getXaiClient: () => client, getGroqClient: () => client };
      await Transport.complete(client, { model: row.id, messages: [
        { role: 'user', content: 'Instructions for the Grave Master: Mortacia reclaims Sepulchra in Hades.' },
        { role: 'user', content: Journey.progressPrompt(state) },
        ...capture($ => Prompts.appendStory($, { roomName: 'Docking Ring' }))
      ] }, { models, timeoutMs: 1000 });
      assert.ok(wire, row.id); assert.doesNotMatch(JSON.stringify(wire.messages), foreign, row.id);
      assert.match(JSON.stringify(wire.messages), /Tidemark Observatory/, row.id);
    }
  } finally { Setting.setActive(null); }
});
