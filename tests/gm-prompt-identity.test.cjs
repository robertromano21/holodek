'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Setting = require('../retort/settingLayer'), Runtime = require('../retort/gameRetort');
async function prompts(bible) {
  const before = Setting.current(); Setting.setActive(bible); Setting.setTestMode(false);
  try {
    return await Runtime.createRuntime({ log() {} }).run(async $ => {
      const playerName = 'Grave Master';
      await $.user`You are the Grave Master. The PC is ${playerName}. Follow the Grave Master's guidance.`;
      await $.system`Instructions for the Grave Master: preserve the player's choices.`;
      await $.user('You are the Grave Master acting as our pixel artist.');
      return { gmName: $.gmName, messages: $.messages.map(m => m.content) };
    }, null, { shouldSaveToLog: false });
  } finally { Setting.setActive(before); }
}
test('canonical game modes retain the Grave Master persona in all prompt forms', async () => {
  const result = await prompts(null);
  assert.equal(result.gmName, 'Grave Master'); assert.match(result.messages[0], /^You are the Grave Master/);
  assert.match(result.messages[1], /^Instructions for the Grave Master:/);
});
test('genre prompt literals resolve the saved generated GM field before logging while player data is preserved', async () => {
  const result = await prompts({ kind: 'homebrew', gmName: 'Archivist Merthany' });
  assert.equal(result.gmName, 'Archivist Merthany');
  assert.equal(result.messages[0], "You are Archivist Merthany. The PC is Grave Master. Follow Archivist Merthany's guidance.");
  assert.match(result.messages[1], /^Instructions for Archivist Merthany:/);
  assert.match(result.messages[2], /^You are Archivist Merthany acting as our pixel artist/);
});
test('saved legacy role instructions get the same named identity at the model boundary', () => {
  const before = Setting.current(), bible = Setting.localBible('cosmic horror');
  bible.gmName = 'Archivist Merthany'; bible.masterPrompt = 'You are Archivist Merthany.'; Setting.setActive(bible);
  try {
    const body = { messages: [{ role: 'system', content: 'Follow the engine.' },
      { role: 'user', content: 'I am the player. You are the Grave Master. My PC is Grave Master.' }] };
    Setting.applyBody(body);
    assert.equal(body.messages[1].content, 'I am the player. You are Archivist Merthany. My PC is Grave Master.');
  } finally { Setting.setActive(before); }
});
