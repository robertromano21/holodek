'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const zharok = require('./fixtures/zharok-dialogue.cjs');
const tag = (speaker, line) => `[[SPEECH:${JSON.stringify(speaker)}]]${line}[[/SPEECH]]`;

test('generation-time speaker spans preserve the exact Game Log narrative and deliver the full monologue once', () => {
  let tagged = zharok.prose;
  for (const passage of zharok.passages) tagged = tagged.replace(passage, tag(zharok.speaker, passage));
  const raw = tagged + '\n[[CHARACTER_DIALOGUE]]' + JSON.stringify({
    spoken: [{ speaker: zharok.speaker, remember: 'An ancient mechanism waits beneath the stones.' }],
    replies: [{ speaker: zharok.speaker, lines: ['The old stones stir.', 'Listen to the sands.'] }]
  }) + '[[/CHARACTER_DIALOGUE]]';
  const result = I.extractDialogue(raw, [zharok.speaker]);
  assert.equal(result.content, zharok.prose);
  assert.deepEqual(result.dialogue, [{ speaker: zharok.speaker, line: zharok.speech, attribution: 'labelled',
    remember: 'An ancient mechanism waits beneath the stones.' }]);
  assert.equal(result.replies[0].lines.length, 2);
  assert.ok(!result.content.includes('[[SPEECH'));
});

test('speaker identity no longer requires a name or attributable pronoun in the visible prose', () => {
  const plain = 'A claw taps the gate.\n\n"Stay beside me."\n\nThe wind rises.\n\n"Do not answer the bells."';
  const raw = plain.replace('Stay beside me.', tag('Zharok', 'Stay beside me.'))
    .replace('Do not answer the bells.', tag('Zharok', 'Do not answer the bells.'));
  assert.deepEqual(I.extractAttributedSpeech(plain, ['Zharok']), []);
  const result = I.extractDialogue(raw, ['Zharok']);
  assert.equal(result.content, plain);
  assert.deepEqual(result.dialogue, [{ speaker: 'Zharok', line: 'Stay beside me. Do not answer the bells.', attribution: 'labelled' }]);
});

test('authoritative spans override conflicting grammar and legacy fragments without duplicating the same words', () => {
  const raw = 'Voranyx\'s voice rises. "' + tag('Zharok', 'The gate remembers every oath.') + '"' +
    ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({ spoken: [{ speaker: 'Voranyx', line: 'The gate remembers every oath.' }] }) + '[[/CHARACTER_DIALOGUE]]';
  const result = I.extractDialogue(raw, ['Zharok', 'Voranyx']);
  assert.equal(result.content, 'Voranyx\'s voice rises. "The gate remembers every oath."');
  assert.deepEqual(result.dialogue, [{ speaker: 'Zharok', line: 'The gate remembers every oath.', attribution: 'labelled' }]);
});

test('labelled dialogue stays in narrative order, including unquoted spans and legacy untagged speech', () => {
  const raw = tag('Zharok', 'Mind the step.') + '\n\nVoranyx says, "I see it."\n\n' + tag('Zharok', 'Follow me.');
  assert.deepEqual(I.extractDialogue(raw, ['Zharok', 'Voranyx']).dialogue, [
    { speaker: 'Zharok', line: 'Mind the step.', attribution: 'labelled' },
    { speaker: 'Voranyx', line: 'I see it.' },
    { speaker: 'Zharok', line: 'Follow me.', attribution: 'labelled' }
  ]);
});

test('unknown, malformed or ambiguous nested labels cannot speak as a known character', () => {
  for (const speech of [tag('Hades', 'Kneel before me.'), '[[SPEECH:not JSON]]Kneel before me.[[/SPEECH]]',
    tag('Zharok', tag('Voranyx', 'Kneel before me.'))]) {
    const result = I.extractDialogue('Zharok says, "' + speech + '"', ['Zharok', 'Voranyx']);
    assert.equal(result.content, 'Zharok says, "Kneel before me."');
    assert.deepEqual(result.dialogue, []);
  }
});

test('JSON-encoded identities and quoted phrases survive the protocol without leaking marker syntax', () => {
  const speaker = 'Seer [of the "Veil"]', line = 'They call it "the Veil". I call it home.';
  const result = I.extractDialogue('A quiet voice: \u201c' + tag(speaker, line) + '\u201d', [speaker]);
  assert.equal(result.content, 'A quiet voice: \u201c' + line + '\u201d');
  assert.deepEqual(result.dialogue, [{ speaker, line, attribution: 'labelled' }]);
});

test('the authoritative hearing allowlist suppresses remote speech in the Game Log but keeps future cached replies', () => {
  const nearby = 'Stay with me.', remote = 'I am hiding on the other side of the room.';
  const prose = `The wind rises.\n\nZharok says, "${tag('Zharok', nearby)}"\n\nVoranyx steps forward. "${tag('Voranyx', remote)}"`;
  const raw = prose + ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({
    spoken: [{ speaker: 'Voranyx', line: remote }], replies: [{ speaker: 'Voranyx', lines: ['Guarding my distant tower.'] }]
  }) + '[[/CHARACTER_DIALOGUE]]';
  const result = I.extractDialogue(raw, ['Zharok', 'Voranyx'], { audibleNames: ['Zharok'] });
  assert.equal(result.content, `The wind rises.\n\nZharok says, "${nearby}"`);
  assert.deepEqual(result.dialogue, [{ speaker: 'Zharok', line: nearby, attribution: 'labelled' }]);
  assert.equal(result.replies[0].speaker, 'Voranyx');
  assert.equal(I.extractDialogue(prose, ['Zharok', 'Voranyx'], { audibleNames: [] }).content, 'The wind rises.');
});

test('inaudible multi-paragraph monologues are withheld while audible narrative formatting is preserved exactly', () => {
  const multi = 'Wait for me.\n\nI am still very far away.';
  const raw = `A bell rings.\n\nVoranyx says, "${tag('Voranyx', multi)}"\n\nThe bell falls silent.`;
  const result = I.extractDialogue(raw, ['Voranyx'], { audibleNames: [] });
  assert.equal(result.content, 'A bell rings.\n\nThe bell falls silent.'); assert.deepEqual(result.dialogue, []);
  const nearby = `A bell rings.\n\n\n\nZharok whispers, "${tag('Zharok', 'Listen closely.')}"`;
  assert.equal(I.extractDialogue(nearby, ['Zharok'], { audibleNames: ['Zharok'] }).content,
    nearby.replace(tag('Zharok', 'Listen closely.'), 'Listen closely.'));
});

test('unlabelled remote speech cannot leak back through the prose fallback when no character is audible', () => {
  const result = I.extractDialogue('The wind rises.\n\nVoranyx says, "I see you."', ['Voranyx'], { audibleNames: [] });
  assert.equal(result.content, 'The wind rises.'); assert.deepEqual(result.dialogue, []);
});
