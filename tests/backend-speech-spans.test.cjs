'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const zharok = require('./fixtures/zharok-dialogue.cjs');
const tag = (speaker, line) => `[[SPEECH:${JSON.stringify(speaker)}]]${line}[[/SPEECH]]`;

test('the logged Liora greeting and companion reactions regain visible attribution and quotation marks', () => {
  const greeting = 'Welcome, traveler. The Shifting Maw holds horrors and the Vorathrax waits. Seek the Bleeding Dunes and beware its cursed sands.';
  const warning = "The caravan roads I've known echo in these dunes, and I fear the same betrayals lie ahead.";
  const caution = 'Every mechanism here answers to old oaths, not new hopes.';
  const intro = 'Near the apparatus, Liora Venshal stands quietly, her gaze steady as she studies the horizon.';
  const raw = intro + '\n\n' + tag('Liora Venshal', greeting) + '\n\n' +
    "Kaelthar's eyes narrow as he surveys the desolate expanse. " + tag('Kaelthar Shadowsnout', warning) + '\n\n' +
    'Seralyth steps closer, her voice clipped and cautious. ' + tag('Seralyth Duskwraith', caution);
  const result = I.extractDialogue(raw, ['Liora Venshal', 'Kaelthar Shadowsnout', 'Seralyth Duskwraith']);
  assert.equal(result.content, intro + '\n\nLiora Venshal says, "' + greeting + '"\n\n' +
    'Kaelthar\'s eyes narrow as he surveys the desolate expanse. "' + warning + '"\n\n' +
    'Seralyth steps closer, her voice clipped and cautious. "' + caution + '"');
  assert.deepEqual(result.dialogue.map(row => row.line), [greeting, warning, caution]);
  assert.doesNotMatch(result.content, /\[\[|\]\]/);
});

test('repairing missing quotes keeps nested quoted phrases, paragraphs and subtitle text intact', () => {
  const line = 'They call it "the Veil".\n\nI call it home.';
  const result = I.extractDialogue(tag('Liora Venshal', line), ['Liora Venshal']);
  assert.equal(result.content, 'Liora Venshal says, "' + line + '"');
  assert.equal(result.dialogue[0].line.replace(/\s+/g, ' '), 'They call it "the Veil". I call it home.');
  const alreadyQuoted = I.extractDialogue('Liora says, ' + tag('Liora Venshal', '"Welcome, traveler."'), ['Liora Venshal']);
  assert.equal(alreadyQuoted.content, 'Liora says, "Welcome, traveler."');
  assert.equal(alreadyQuoted.dialogue[0].line, 'Welcome, traveler.');
});

test('repaired speech obeys hearing and directed-recipient filtering without leaving stray attribution', () => {
  const A = require('../assets/dialogueAudience');
  const names = ['Liora Venshal', 'Kaelthar Shadowsnout'];
  const actors = names.map(name => ({ name, type: 'monster', hp: 10, state: 'Neutral' }));
  const policy = A.resolve('ask Liora about the dunes', actors, names);
  const raw = tag(names[0], 'Seek the Bleeding Dunes.') + '\n\n' + tag(names[1], 'I am elsewhere.');
  for (const options of [{ audibleNames: [names[0]] }, { audibleNames: names, responsePolicy: policy }]) {
    const result = I.extractDialogue(raw, names, options);
    assert.equal(result.content, 'Liora Venshal says, "Seek the Bleeding Dunes."');
    assert.deepEqual(result.dialogue.map(row => row.speaker), [names[0]]);
  }
});

test('the logged Jarek and Tana quotes followed by labelled copies appear and speak exactly once', () => {
  const passages = [
    { speaker: 'Jarek Solin', action: 'Jarek Solin pauses, his weathered face creasing with concern as he addresses the group, ',
      line: 'The wells are all we have. Keep your feet clean, your sins lighter--thirst is a cruel judge out here.' },
    { speaker: 'Tana Voren', action: 'Tana Voren offers a gentle nod, her voice soft yet urgent, ',
      line: 'The plants suffer as much as we do. Each bloom hides secrets beneath tough skins. The sands whisper of pain, but also healing.' }
  ];
  const raw = passages.map(row => row.action + '"' + row.line + '" ' + tag(row.speaker, row.line)).join('\n\n');
  const expected = passages.map(row => row.action + '"' + row.line + '"').join('\n\n');
  const names = passages.map(row => row.speaker), result = I.extractDialogue(raw, names);
  assert.equal(result.content, expected);
  assert.deepEqual(result.dialogue.map(row => row.line), passages.map(row => row.line));
  assert.deepEqual(I.mergeAttributedSpeech(result.dialogue, I.extractAttributedSpeech(result.content, names, result.dialogue))
    .map(row => row.line), passages.map(row => row.line), 'The browser fallback and SSE must agree on one copy.');
});

test('duplicate-label repair preserves separate speakers, intentional refrains and later narrative actions', () => {
  const names = ['Jarek Solin', 'Tana Voren'], line = 'We keep watch. We keep watch.';
  const raw = 'Jarek says, "' + line + '" ' + tag(names[0], line) + ' He points toward the well.\n\n' +
    'Tana says, "' + line + '" ' + tag(names[1], line);
  const result = I.extractDialogue(raw, names);
  assert.equal(result.content, 'Jarek says, "' + line + '" He points toward the well.\n\nTana says, "' + line + '"');
  assert.deepEqual(result.dialogue.map(row => row.line), [line, line]);
  const echo = I.extractDialogue('Jarek says, "Stay here." ' + tag(names[1], 'Stay here.'), names);
  assert.deepEqual(echo.dialogue.map(row => row.speaker), names);
});

test('deduplicated speech remains subject to the directed-recipient policy', () => {
  const A = require('../assets/dialogueAudience'), names = ['Jarek Solin', 'Tana Voren'];
  const policy = A.resolve('ask Jarek about water', names.map(name => ({ name, type: 'monster', hp: 10, state: 'Neutral' })), names);
  const raw = 'Jarek says, "Guard the well." ' + tag(names[0], 'Guard the well.') + '\n\n' +
    'Tana says, "Watch the flowers." ' + tag(names[1], 'Watch the flowers.');
  const result = I.extractDialogue(raw, names, { audibleNames: names, responsePolicy: policy });
  assert.equal(result.content, 'Jarek says, "Guard the well."');
  assert.deepEqual(result.dialogue.map(row => row.speaker), [names[0]]);
});

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
