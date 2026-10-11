const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const continued = require('./fixtures/continued-dialogue.cjs');
const zharok = require('./fixtures/zharok-dialogue.cjs');
const prose = 'Nyssara\u2019s ethereal gaze sharpens, her voice a low murmur, \u201cThe path ahead is fraught with shadows.\u201d ' +
  'Voranyx\u2019s eyes flicker with wary resolve, \u201cEach step we take risks stirring old betrayals.\u201d';
const expected = [{ speaker: 'Nyssara', line: 'The path ahead is fraught with shadows.' },
  { speaker: 'Voranyx', line: 'Each step we take risks stirring old betrayals.' }];

test('regular narration attributes the actual session style of possessive gaze/voice quotes', () => {
  assert.deepEqual(I.extractAttributedSpeech(prose, ['Nyssara', 'Voranyx']), expected);
});
test('an incomplete or empty structured speech list is supplemented from actual prose without duplicate speakers', () => {
  for (const spoken of [[], [expected[0]], expected]) {
    const raw = prose + ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({ spoken, replies: [] }) + '[[/CHARACTER_DIALOGUE]]';
    const result = I.extractDialogue(raw, ['Nyssara', 'Voranyx']);
    assert.equal(result.content, prose);
    assert.deepEqual(result.dialogue, expected);
  }
});
test('pronoun attribution after a quote uses an unambiguous named character, not an invented speaker or narrator', () => {
  assert.deepEqual(I.extractAttributedSpeech('Nyssara stands beside you.\n\n"The road is dangerous," she murmurs.', ['Nyssara']),
    [{ speaker: 'Nyssara', line: 'The road is dangerous,' }]);
  assert.deepEqual(I.extractAttributedSpeech('Nyssara and Voranyx study the dunes. "Follow me," she says.', ['Nyssara', 'Voranyx']), []);
  assert.deepEqual(I.extractAttributedSpeech('Nyssara studies an inscription: "Do not pass."', ['Nyssara']), []);
  assert.deepEqual(I.extractAttributedSpeech('Hades\u2019s gaze darkens, "Kneel before me."', ['Nyssara']), []);
});

const sessionNames = ['Vyrixa Shadowtide', 'Zareth Vilecoil', 'Kaelthas Nightrune'];
const sessionQuotes = [
  'The temple\u2019s memories stir, but not all is as it seems. Since your absence, whispers of unrest have grown louder\u2014shadows moving beneath the surface, old debts unpaid.',
  'The wards here falter. I sense a shifting in the balance\u2014darkness pressing in from the edges. The silence is not peace, but a waiting breath before the storm.',
  'I have felt it too. The echoes of broken oaths ripple through these halls. Something stirs in the depths below, something that hungers for the power you once held.'
];
const sessionProse = 'Vyrixa, Zareth, and Kaelthas wait nearby.\n\n' +
  `Vyrixa\u2019s voice breaks the stillness, low and cautious. \u201c${sessionQuotes[0]}\u201d She glances toward the mosaics.\n\n` +
  `Zareth\u2019s voice is softer, almost a murmur. \u201c${sessionQuotes[1]}\u201d\n\n` +
  `Kaelthas nods slowly, his eyes distant. \u201c${sessionQuotes[2]}\u201d`;

test('the logged short-name voices and gestures resolve to exact full monster names', () => {
  assert.deepEqual(I.extractAttributedSpeech(sessionProse, sessionNames), sessionNames.map((speaker, i) => ({ speaker, line: sessionQuotes[i] })));
});

test('partial machine dialogue yields to the actual complete quoted speech while preserving its memory', () => {
  const spoken = sessionNames.map((speaker, i) => ({ speaker, line: sessionQuotes[i].split('. ').at(-1), remember: 'A new warning.' }));
  const raw = sessionProse + ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({ spoken, replies: [] }) + '[[/CHARACTER_DIALOGUE]]';
  const result = I.extractDialogue(raw, sessionNames);
  assert.equal(result.content, sessionProse);
  assert.deepEqual(result.dialogue, sessionNames.map((speaker, i) => ({ speaker, line: sessionQuotes[i], remember: 'A new warning.' })));
});

test('ambiguous short names never select a speaker and multiple real quotes retain their order', () => {
  assert.deepEqual(I.extractAttributedSpeech('Zareth says, "Stay here."', ['Zareth Vilecoil', 'Zareth Ashborn']), []);
  const lines = I.extractAttributedSpeech('Zareth Vilecoil says, "Stay here." Zareth Vilecoil says, "Wait for my signal."', ['Zareth Vilecoil']);
  assert.deepEqual(I.mergeAttributedSpeech([{ speaker: 'Zareth Vilecoil', line: 'Stay here.' }], lines), [
    { speaker: 'Zareth Vilecoil', line: 'Stay here. Wait for my signal.' }]);
});

test('the entire long speech survives extraction and splits into short, sentence-aware cards', () => {
  const speech = Array.from({ length: 28 }, (_, i) => `Remember warning ${i}: the old temple guards its secrets beneath the shifting sands.`).join(' ');
  assert.ok(speech.length > 1600);
  const result = I.extractDialogue(`Vyrixa says, "${speech}"`, ['Vyrixa Shadowtide']);
  assert.equal(result.dialogue[0].line, speech);
  const cards = I.splitSpeech(result.dialogue[0].line);
  assert.ok(cards.length > 5); assert.equal(cards.join(' '), speech);
  assert.ok(cards.every(card => card.length <= 320 && card.split(/\s+/).length <= 56 && card.endsWith('.')));
  assert.ok(cards.at(-1).includes('warning 27'));
  assert.equal(I.splitSpeech('A short greeting.')[0], 'A short greeting.');
});

test('speech splitting never stalls or loses characters on long tokens and invalid sizing options', () => {
  const speech = 'a'.repeat(500);
  const cards = I.splitSpeech(speech, 0, NaN);
  assert.equal(cards.join(''), speech); assert.ok(cards.every(card => card.length <= 320));
  const boundary = 'a'.repeat(180) + '. Then continue.';
  assert.ok(I.splitSpeech(boundary).every(card => card.length <= 320));
});

test('the latest logged speech retains every interrupted quote and later pronoun-led paragraph', () => {
  const names = [continued.speaker, 'Vharzun Moltresh'];
  assert.deepEqual(I.extractAttributedSpeech(continued.prose, names), [{ speaker: continued.speaker, line: continued.speech }]);
  const raw = continued.prose + ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({ spoken: [
    { speaker: continued.speaker, line: continued.passages[0], remember: 'The ancient covenant is fracturing.' }
  ] }) + '[[/CHARACTER_DIALOGUE]]';
  assert.deepEqual(I.extractDialogue(raw, names).dialogue, [
    { speaker: continued.speaker, line: continued.speech, remember: 'The ancient covenant is fracturing.' }
  ]);
  const snippets = I.splitSpeech(continued.speech);
  assert.equal(snippets.join(' '), continued.speech);
  assert.ok(snippets.every(line => /[.!?]$/.test(line)));
  assert.ok(snippets[0].startsWith(continued.passages[0] + ' '));
  assert.ok(snippets.at(-1).includes('What truths have you uncovered in the silence?'));
});

test('complete sentences stay intact even when they exceed the preferred snippet length', () => {
  const sentence = 'The old temple ' + 'keeps its secrets '.repeat(24).trim() + '.';
  assert.deepEqual(I.splitSpeech(sentence + ' Follow me.'), [sentence, 'Follow me.']);
  assert.equal(I.splitSpeech('').length, 0);
});

test('continuation stops at ambiguous speakers, inscriptions and unrelated quotations', () => {
  const names = ['Nyssara', 'Voranyx'];
  for (const prose of [
    'Nyssara says, "Wait here." Nyssara and Voranyx turn. "Follow me," she says.',
    'Nyssara says, "Wait here." Her gaze studies an inscription: "Open the gate."',
    'Nyssara says, "Wait here." Hades\u2019s voice booms, "Kneel." She murmurs, "Who am I?"'
  ]) assert.deepEqual(I.extractAttributedSpeech(prose, names), [{ speaker: 'Nyssara', line: 'Wait here.' }]);
});

test('alternating speakers and repeated words remain in narrative order beyond six quote passages', () => {
  const names = ['Nyssara', 'Voranyx'];
  const prose = Array.from({ length: 10 }, (_, i) => `${names[i % 2]} says, "${i % 2 ? 'Not yet.' : 'Go now.'}"`).join(' ');
  const lines = I.extractAttributedSpeech(prose, names);
  assert.equal(lines.length, 10);
  assert.deepEqual(lines.map(row => row.speaker), Array.from({ length: 10 }, (_, i) => names[i % 2]));
});

test('Zharok\'s exact logged introduction resolves His voice and retains the entire following monologue', () => {
  const names = [zharok.speaker, 'Voranyx'];
  assert.deepEqual(I.extractAttributedSpeech(zharok.prose, names), [{ speaker: zharok.speaker, line: zharok.speech }]);
  const raw = zharok.prose + ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({ spoken: [
    { speaker: zharok.speaker, line: zharok.fragment, remember: 'A mechanism waits beneath the stones.' }
  ] }) + '[[/CHARACTER_DIALOGUE]]';
  const result = I.extractDialogue(raw, names);
  assert.equal(result.content, zharok.prose);
  assert.deepEqual(result.dialogue, [{ speaker: zharok.speaker, line: zharok.speech, remember: 'A mechanism waits beneath the stones.' }]);
  const cards = I.splitSpeech(result.dialogue[0].line);
  assert.ok(cards.length >= 3); assert.equal(cards.join(' '), zharok.speech);
  assert.ok(cards.at(-1).includes('the balance teeters.'));
});

test('speaker context survives separate introductory paragraphs, adverbial phrases and unique epithets', () => {
  const names = [zharok.speaker, 'Voranyx'];
  const prose = 'Zharok the Dune Reaper stands beside the old gate.\n\nHis deep voice carries through the hall. "Stay close."\n\n' +
    'With a slow breath, he lifts a claw toward the passage. "Listen for the bells."\n\n' +
    'The Dune Reaper continues, "Do not answer them."';
  assert.deepEqual(I.extractAttributedSpeech(prose, names), [
    { speaker: zharok.speaker, line: 'Stay close. Listen for the bells. Do not answer them.' }
  ]);
});

test('the grammatical subject owns the speech, not a character mentioned as its addressee', () => {
  assert.deepEqual(I.extractAttributedSpeech('Zharok says, "Wait here." He turns toward Voranyx, his voice dropping. "I know the way."',
    ['Zharok', 'Voranyx']), [{ speaker: 'Zharok', line: 'Wait here. I know the way.' }]);
  assert.deepEqual(I.extractAttributedSpeech('Zharok stands by the altar. Voranyx steps forward. Her voice rises. "Follow me."',
    ['Zharok', 'Voranyx']), [{ speaker: 'Voranyx', line: 'Follow me.' }]);
});

test('existing structured speech anchors ambiguous prose only when its words actually match the quote', () => {
  const prose = 'Zharok and Voranyx wait by the gate. "The ancient gate remembers every oath."\n\nHis voice softens. "Stay close."';
  assert.deepEqual(I.extractAttributedSpeech(prose, ['Zharok', 'Voranyx']), []);
  assert.deepEqual(I.extractAttributedSpeech(prose, ['Zharok', 'Voranyx'], [
    { speaker: 'Zharok', line: 'The ancient gate remembers' }
  ]), [{ speaker: 'Zharok', line: 'The ancient gate remembers every oath. Stay close.' }]);
  assert.deepEqual(I.extractAttributedSpeech(prose, ['Zharok', 'Voranyx'], [
    { speaker: 'Hades', line: 'The ancient gate remembers' }, { speaker: 'Zharok', line: 'This is unrelated speech.' }
  ]), []);
});

test('inscriptions, player speech, unknown labels and unintroduced pronouns never inherit an NPC identity', () => {
  for (const ending of [
    'Distant Guard: "You cannot enter."', 'Hades booms, "Kneel."', 'His friend\u2019s voice booms. "Kneel."',
    'You say, "Come with me."', 'His thoughts turn inward. He thinks, "I should leave."',
    'He studies an inscription: "Do not pass."'
  ]) assert.deepEqual(I.extractAttributedSpeech('Zharok says, "Wait here." ' + ending, ['Zharok']), [{ speaker: 'Zharok', line: 'Wait here.' }]);
  assert.deepEqual(I.extractAttributedSpeech('His voice is low. "The gate is open."', ['Zharok']), []);
  assert.deepEqual(I.extractAttributedSpeech('A weathered inscription covers the wall. Zharok steps away from it. His voice is low. "The gate is open."', ['Zharok']),
    [{ speaker: 'Zharok', line: 'The gate is open.' }]);
});

test('paired quotation marks preserve quoted names and phrases inside a spoken monologue', () => {
  const line = 'The wardens call it "the Veil" and fear its power. Do not mistake "silence" for peace.';
  assert.deepEqual(I.extractAttributedSpeech(`Zharok says, \u201c${line}\u201d`, ['Zharok']), [{ speaker: 'Zharok', line }]);
});
