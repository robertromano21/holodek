'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RetortConversation } = require('retort-js/dist/conversation');
const Audience = require('../assets/dialogueAudience');
const I = require('../assets/dungeonInhabitants');
const Turns = require('../retort/dialogueTurns');
const narrationPrompt = 'Preserve prose with [[CHARACTER_DIALOGUE]]. Replies: refresh two cached lines.';
const actors = [
  { name: 'Noria Helm', type: 'monster', hp: 30, state: 'Neutral' },
  { name: 'Korvak', type: 'monster', hp: 30, state: 'Hostile' },
  { name: 'Companion', type: 'npc', hp: 30, state: 'Friendly' }
];

test('request-scoped routing and the running-demo compatibility hook use the installed SDK without API calls', async t => {
  const population = {}, state = { getUpdatedGameConsole: () => 'Coordinates: X: 1, Y: 0, Z: 0',
    getCombatCharactersString: () => JSON.stringify(actors), getRoomPopulation: () => population };
  const inhabitants = { ...I }, previous = Audience.currentPolicy;
  Turns.install(state, inhabitants);
  const cleanup = Turns.installLegacyPromptGuard();
  try {
    await t.test('injects one recipient instruction at final narration, not other model passes', () => {
      const conversation = new RetortConversation();
      Turns.run('ask Noria about the seal', () => {
        conversation.user('Decide an ordinary action.');
        conversation.user(narrationPrompt); conversation.user(narrationPrompt);
      });
      const rules = conversation.messages.filter(m => m.content.startsWith('Dialogue recipient rule:'));
      assert.equal(rules.length, 1); assert.match(rules[0].content, /"responders":\["Noria Helm"\]/);
      assert.equal(conversation.messages.length, 4);
    });

    await t.test('new explicit prompts are not duplicated by the legacy hook', () => {
      const conversation = new RetortConversation();
      Turns.run('ask Noria about the seal', () => {
        conversation.user(Audience.prompt(Turns.policyFor(state))); conversation.user(narrationPrompt);
      });
      assert.equal(conversation.messages.length, 2);
    });

    await t.test('autonomy outside a player request and undirected inputs remain unchanged', () => {
      const autonomous = new RetortConversation(), general = new RetortConversation();
      autonomous.user(narrationPrompt);
      assert.equal(Turns.policyFor(state), null);
      Turns.run('look at the stairs', () => general.user(narrationPrompt));
      assert.equal(autonomous.messages.length, 1); assert.equal(general.messages.length, 1);
    });

    await t.test('asynchronous commands keep separate recipients even after the HTTP handler returns', async () => {
      const a = new RetortConversation(), b = new RetortConversation(); let releaseA, releaseB;
      const waitA = new Promise(resolve => releaseA = resolve), waitB = new Promise(resolve => releaseB = resolve);
      const first = Turns.run('ask Noria about the seal', async () => { await waitA; a.user(narrationPrompt); });
      const second = Turns.run('ask Korvak about the seal', async () => { await waitB; b.user(narrationPrompt); });
      releaseB(); await second; releaseA(); await first;
      assert.match(a.messages[1].content, /"responders":\["Noria Helm"\]/);
      assert.match(b.messages[1].content, /"responders":\["Korvak"\]/);
      assert.equal(Turns.policyFor(state), null);
    });

    await t.test('the existing extractor is guarded without passing a new parameter in live Retort', () => {
      const raw = 'Noria says, "[[SPEECH:"Noria Helm"]]The seal is beneath the northern stair.[[/SPEECH]]"\n\n' +
        'Companion says, "[[SPEECH:"Companion"]]These shadows whisper of old promises.[[/SPEECH]]"';
      const output = Turns.run('ask Noria about the seal', () => inhabitants.extractDialogue(raw, actors.map(a => a.name)));
      assert.deepEqual(output.dialogue.map(row => row.speaker), ['Noria Helm']);
      assert.doesNotMatch(output.content, /Companion|shadows whisper/); assert.ok(population.dialogueFocus.until > Date.now());
      assert.equal(inhabitants.extractDialogue(raw, actors.map(a => a.name)).dialogue.length, 2, 'No routing leaks into autonomous extraction.');
      Turns.run('look around', () => inhabitants.extractDialogue(raw, actors.map(a => a.name)));
      assert.equal(population.dialogueFocus, undefined);
    });
  } finally {
    cleanup();
    if (previous) Audience.currentPolicy = previous; else delete Audience.currentPolicy;
  }
});

test('invalid stored roster metadata falls back safely without modifying the state', () => {
  const state = { getCombatCharactersString: () => '{"not":"a roster"}' };
  assert.doesNotThrow(() => Turns.run('say to monsters, "Hello."', () => Turns.policyFor(state)));
});
