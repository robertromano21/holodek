'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const fixture = require('./fixtures/edran-dialogue.cjs');

test('Edran\'s logged gesture-interrupted reply retains all three quotes without reading narrative gestures aloud', () => {
  const extracted = I.extractDialogue(fixture.prose + ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({
    spoken: [{ speaker: fixture.speaker }], replies: [{ speaker: fixture.speaker, lines: fixture.replies }]
  }) + '[[/CHARACTER_DIALOGUE]]', [fixture.speaker], { audibleNames: [fixture.speaker] });
  assert.equal(extracted.content, fixture.prose);
  assert.deepEqual(extracted.dialogue, [{ speaker: fixture.speaker, line: fixture.speech }]);
  assert.equal(I.splitSpeech(extracted.dialogue[0].line).join(' '), fixture.speech);
  assert.doesNotMatch(extracted.dialogue[0].line, /thumb rubs|meets her gaze/);
});

test('a previous speaker is required for possessive gesture continuation', () => {
  assert.deepEqual(I.extractAttributedSpeech('His thumb rubs a groove. "Wait here."', ['Edran Bellworn']), []);
  assert.deepEqual(I.extractAttributedSpeech('Edran says, "Wait here." His thumb traces an inscription: "Open the gate."', ['Edran Bellworn']),
    [{ speaker: fixture.speaker, line: 'Wait here.' }]);
  assert.deepEqual(I.extractAttributedSpeech('Edran says, "Wait here." You say, "No." His thumb rubs a groove. "Come here."', ['Edran Bellworn']),
    [{ speaker: fixture.speaker, line: 'Wait here.' }]);
});

test('idle echo detection catches the logged shortened reply but preserves new facts and questions', () => {
  for (const line of fixture.replies) assert.equal(I.speechRepeats(line, [fixture.speech]), true, line);
  assert.equal(I.speechRepeats('The keepers carved it into this place.', [fixture.speech]), true);
  for (const line of [
    'The keepers carved your name here yesterday.',
    'Why did the keepers carve your name here?',
    'I do not know the name Mortacia.',
    'The northern guard carries three seals.',
    'We should ask the ferryman about the missing burial register.'
  ]) assert.equal(I.speechRepeats(line, [fixture.speech, 'The southern guard carries two seals.']), false, line);
  assert.equal(I.speechRepeats('Do the keepers still guard the harbor?', ['The keepers still guard the harbor.']), false);
});

test('recent speech is bounded, expires and survives room metadata serialization', () => {
  const record = {};
  for (let i = 0; i < 20; i++) I.rememberSpeech(record, `The keeper recorded testimony number ${i}.`, 1000 + i);
  assert.equal(record.recentSpeech.length, 8);
  assert.equal(I.recentSpeech(JSON.parse(JSON.stringify(record)), 1100).length, 8);
  assert.deepEqual(I.recentSpeech(record, 601020), []);
  assert.deepEqual(I.recentSpeech(record, 900), [], 'Future-dated history cannot block speech.');
});

test('recruiting a resident retains their recent speech instead of resetting idle echo protection', () => {
  const population = I.createPopulation('0,0,0', [{ name: fixture.speaker }]);
  I.noteSpoken(population, [{ speaker: fixture.speaker, line: fixture.speech }]);
  I.applyReplies(population, [{ speaker: fixture.speaker, lines: fixture.replies }], [{ name: fixture.speaker, type: 'npc', hp: 20 }]);
  assert.deepEqual(population.companions[fixture.speaker].dialogue, []);
  assert.ok(population.companions[fixture.speaker].recentSpeech.length);
  assert.notEqual(population.companions[fixture.speaker].recentSpeech, population.actors[fixture.speaker].recentSpeech);
});
