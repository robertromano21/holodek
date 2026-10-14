'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { templateContent } = require('retort-js/dist/message');
const Protocol = require('../retort/graveMasterProtocol');
const Runtime = require('../retort/gameRetort');
const { createModelService } = require('../retort/gameModels');
const source = ['../retort/retortWithUserInput.js', '../retort/graveMasterStoryPrompts.js']
  .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n')).join('\n');
const originals = [...source.matchAll(/\$\.user`(Instructions for the Grave Master:[\s\S]*?Backend Integration: Programmatic vs\. Narrative Handling)`;/g)].map(match => match[1]);
const original = templateContent({ raw: [originals[0]] });

test('all three original Grave Master prompts remain verbatim, including the full lore', () => {
  assert.equal(originals.length, 3);
  for (const text of originals) assert.equal(crypto.createHash('sha256').update(text).digest('hex'),
    '32471eb28d7b91730668f2a938b7c4c6e8f3c88fc4adbce9e40e546130ec42ee');
});

for (const id of ['original', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o-mini']) {
  test(`${id} retains the original runtime without additional instructions`, () => {
    const models = createModelService({ initial: id });
    assert.equal(Protocol.enabled(models), false);
    assert.equal(Protocol.runtimeFor({}, { models }), Runtime);
  });
}

for (const name of ['Mortacia', 'Suzerain', 'Benedict']) test(`${name}: nested room and object calls inherit the entire prompt and confirmed selection`, async () => {
  const requests = [];
  const client = { chat: { completions: { create: async body => {
    requests.push(body);
    return (async function* () {
      yield { choices: [{ index: 0, delta: { content: 'A vaulted hall stands above the sands.' }, finish_reason: null }] };
      yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    })();
  } } } };
  const models = createModelService({ initial: 'gpt-6-luna', clientFor: () => client });
  const state = { getCurrentPC: () => ({ Name: name, sprite: { dataUrl: 'must-not-be-sent' } }) };
  const runtime = Protocol.runtimeFor(state, { models, client, log() {} });
  const options = { shouldSaveToLog: false };
  await runtime.run(runtime.retort(async $ => {
    $.user(original);
    await $.run(async room => {
      room.assistant('Generate only the room description.');
      await room.assistant.generation({ maxTokens: 220 });
      await room.run(async objects => {
        objects.assistant('Generate room objects.');
        await objects.assistant.generation();
      }, null, options);
    }, null, options);
    $.assistant('Continue the current adventure.');
    await $.assistant.generation();
  }), null, options);
  assert.equal(requests.length, 3);
  for (const body of requests) {
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[0].content, original);
    assert.equal(body.messages.filter(message => message.content === original).length, 1);
    assert.match(body.messages[1].content, /assistant-role prompts/);
    assert.match(body.messages[1].content, /Character selection is complete/);
    assert.ok(body.messages[1].content.includes(JSON.stringify(name)));
    assert.equal(body.reasoning_effort, 'none');
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(body.max_tokens, undefined);
    assert.doesNotMatch(JSON.stringify(body.messages), /must-not-be-sent/);
  }
  assert.match(requests[0].messages.at(-1).content, /room description/);
  assert.match(requests[1].messages.at(-1).content, /room objects/);
});

test('live console identity takes priority over old startup metadata and context refreshes each call', () => {
  let text = 'PC:\n  Benedict\n  Male\n  Human';
  const prepare = Protocol.createProtocol({ getUpdatedGameConsole: () => text, getCurrentPC: () => ({ Name: 'Mortacia' }) });
  const messages = [{ role: 'user', content: original }, { role: 'assistant', content: 'Describe the current room.' }];
  assert.match(prepare(messages)[1].content, /player-created character/);
  assert.match(prepare(messages)[1].content, /"Benedict"/);
  text = 'PC:\n  Suzerain\n  Male\n  Human';
  assert.match(prepare(messages)[1].content, /playing as Suzerain/);
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant']);
});

test('a backend call without a saved character does not invent a selection', () => {
  const messages = Protocol.createProtocol({})([{ role: 'assistant', content: 'Describe a room.' }]);
  assert.match(messages[0].content, /No confirmed character is recorded/);
  assert.equal(messages.at(-1).content, 'Describe a room.');
});

const actionPrompts = [...source.matchAll(/\$\.user`(\nWrite an interactive fiction adventure[\s\S]*?)`;/g)].map(match => match[1]);
test('both original bottom action/dialogue prompts remain complete and verbatim', () => {
  assert.equal(actionPrompts.length, 2);
  for (const text of actionPrompts) {
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'),
      'c70f72e97ae83f1fc123c6b1817b51db5f51c48c100c627c7217ee24d7a03827');
    assert.ok(text.endsWith('Improvise!\n'));
  }
});

for (const id of ['original', 'gpt-4.1-mini', 'gpt-6-luna']) test(`${id}: complete bottom prompt reaches the actual request after the full original lore`, async () => {
  let request;
  const client = { chat: { completions: { create: async body => {
    request = body;
    return (async function* () {
      yield { choices: [{ index: 0, delta: { content: 'The pilgrim answers.' }, finish_reason: null }] };
      yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    })();
  } } } };
  const models = createModelService({ initial: id, clientFor: () => client });
  const runtime = Runtime.createRuntime({ models, client, log() {},
    prepareMessages: Protocol.enabled(models) ? Protocol.createProtocol({ getCurrentPC: () => ({ Name: 'Mortacia' }) }) : undefined });
  const actionPrompt = templateContent({ raw: [actionPrompts[0].replaceAll('${roomName}', 'Ruined Temple Entrance')] });
  await runtime.run(runtime.retort(async $ => {
    $.user(original);
    $.user(actionPrompt);
    $.user('Queued reply entries are at most 20 words.');
    $.user('Preserve complete live spoken passages and append CHARACTER_DIALOGUE metadata.');
    await $.assistant.generation();
  }), null, { shouldSaveToLog: false });
  const task = request.messages.find(message => message.content.startsWith('Write an interactive fiction adventure'));
  assert.equal(task?.role, 'user'); assert.equal(task?.content, actionPrompt);
  assert.ok(task.content.endsWith('Improvise!'));
  assert.equal(request.messages.filter(message => message.content === original).length, 1);
  assert.equal(request.messages.findIndex(message => message === task) < request.messages.length - 2, true);
  if (id === 'gpt-6-luna') {
    const guidance = request.messages[1].content;
    assert.match(guidance, /remains an active instruction/);
    assert.match(guidance, /20-word limits apply ONLY to queued reply entries/);
    assert.doesNotMatch(guidance, /rich, flowing, multi-paragraph storytelling|questions, initiative, disagreements|psychopomp guides/,
      'Model adapters must not supply different character-writing guidance.');
  } else assert.deepEqual(request.messages.map(message => message.role), ['user', 'user', 'user', 'user']);
});
