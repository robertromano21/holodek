const test = require('node:test');
const assert = require('node:assert/strict');
const Memory = require('../retort/dialogueMemory');
const Inhabitants = require('../assets/dungeonInhabitants');
const state = () => {
  const ledger = { characters: {}, recent: [] };
  return { getDialogueMemory: () => ledger };
};
test('character memories retain the introduction, latest remarks, promises and two player inputs', () => {
  const s = state(), p = Inhabitants.createPopulation('1,0,0', [{ name: 'Mason', allegiance: 'Neutral' }]);
  for (let i = 0; i < 8; i++) {
    Memory.rememberDialogue(s, p, [{ speaker: 'Mason', line: `Remark ${i}`, remember: `Promise ${i}` }]);
    Memory.rememberPlayerInput(s, `Question ${i}`, ['Mason'], p);
  }
  const memory = p.actors.Mason.memory;
  assert.equal(memory.first, 'Remark 0');
  assert.deepEqual(memory.recent, ['Remark 5', 'Remark 6', 'Remark 7']);
  assert.deepEqual(memory.notes, ['Promise 5', 'Promise 6', 'Promise 7']);
  assert.deepEqual(memory.player, ['Question 6', 'Question 7']);
  assert.equal(s.getDialogueMemory().recent.length, 6);
  assert.equal(s.getDialogueMemory().characters.Mason, memory);
});
test('revisited characters hydrate their saved memory before adding new speech or player questions', () => {
  const s = state(), p = Inhabitants.createPopulation('1,0,0', [{ name: 'Mason' }]);
  p.actors.Mason.memory = { first: 'My brother vanished.', recent: ['Keep the gate shut.'], notes: ['Player promised to look for my brother.'], player: [] };
  Memory.rememberPlayerInput(s, 'Do you still need my help?', ['Mason'], p);
  Memory.rememberDialogue(s, p, [{ speaker: 'Mason', line: 'I remember your promise.' }]);
  assert.equal(p.actors.Mason.memory.first, 'My brother vanished.');
  assert.deepEqual(p.actors.Mason.memory.notes, ['Player promised to look for my brother.']);
  assert.equal(Memory.memoryContext(state(), ['Mason'], JSON.parse(JSON.stringify(p)))[0].recollection.player[0], 'Do you still need my help?');
});
test('in-memory characters, string lengths and prompt context remain bounded', () => {
  const s = state();
  for (let i = 0; i < 100; i++) {
    Memory.rememberPlayerInput(s, 'Q'.repeat(1000), [`Soul ${i}`]);
    Memory.rememberDialogue(s, null, [{ speaker: `Soul ${i}`, line: 'L'.repeat(1000), remember: 'N'.repeat(1000) }]);
  }
  assert.equal(Object.keys(s.getDialogueMemory().characters).length, 64);
  const memory = s.getDialogueMemory().characters['Soul 99'];
  assert.equal(memory.recent[0].length, 320); assert.equal(memory.notes[0].length, 180); assert.equal(memory.player[0].length, 280);
  const context = Memory.memoryContext(s, Array.from({ length: 100 }, (_, i) => `Soul ${99-i}`), null, 2400);
  assert.ok(context.length && context.length <= 8 && JSON.stringify(context).length <= 2400);
});
