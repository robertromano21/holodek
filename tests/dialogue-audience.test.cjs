'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/dialogueAudience');
const I = require('../assets/dungeonInhabitants');
const Turns = require('../retort/dialogueTurns');
const actors = [
  { name: 'Mortacia', type: 'pc', hp: 100, state: 'Alive' },
  { name: 'Noria Helm', type: 'monster', hp: 30, allegiance: 'Neutral' },
  { name: 'Erlan Vess', type: 'monster', hp: 30, allegiance: 'Neutral' },
  { name: 'Korvak the Veinbreaker', type: 'monster', hp: 30, allegiance: 'Hostile' },
  { name: 'Vaelzorith the Shattered Warden', type: 'npc', hp: 30, allegiance: 'Friendly' },
  { name: 'Zyrralith the VeilHunter', type: 'npc', hp: 30, allegiance: 'Friendly' },
  { name: 'Liora Sundream', type: 'npc', hp: 30, allegiance: 'Friendly' }
];
const names = actors.filter(a => a.type !== 'pc').map(a => a.name);
const tagged = (name, line) => `[[SPEECH:${JSON.stringify(name)}]]${line}[[/SPEECH]]`;
const footer = rows => ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({ spoken: rows, replies: [
  { speaker: 'Vaelzorith the Shattered Warden', lines: ['A future remark, not an answer now.'] }
] }) + '[[/CHARACTER_DIALOGUE]]';

for (const command of ['say to monsters, "Who is Martellius?"', 'ask monsters what they know of the Shattered Cloister',
  'ask the neutral monsters, "Who is Martellius?"', 'talk to the monsters in room']) test(`explicit resident audience excludes the party: ${command}`, () => {
  const policy = A.resolve(command, actors, names);
  assert.equal(policy.directed, true); assert.ok(policy.responders.includes('Noria Helm'));
  assert.ok(!policy.responders.includes('Vaelzorith the Shattered Warden'));
  assert.ok(!policy.responders.includes('Liora Sundream'), 'Recruited residents are companions now.');
  if (command.includes('neutral')) assert.ok(!policy.responders.includes('Korvak the Veinbreaker'));
});

for (const command of ['ask Noria what he knows of Vorathrax', 'say to Noria Helm, "Vaelzorith told me about Erlan."',
  'Noria, who is Martellius?', 'say "Noria, who is Martellius?"']) test(`named recipients do not include names mentioned in the question: ${command}`, () => {
  assert.deepEqual(A.resolve(command, actors, names).responders, ['Noria Helm']);
});

test('party groups, multiple named residents and undirected questions retain their distinct audiences', () => {
  assert.deepEqual(A.resolve('say to my party, "Follow me."', actors, names).responders, names.slice(3));
  assert.deepEqual(A.resolve('ask Noria and Erlan about Liora', actors, names).responders, names.slice(0, 2));
  assert.equal(A.resolve('Who is Martellius?', actors, names).directed, false);
  assert.equal(A.resolve('look at Noria', actors, names).directed, false);
});

test('an absent or inaudible named recipient never redirects the question to party companions', () => {
  assert.deepEqual(A.resolve('say to Hades, "Hello."', actors, names).responders, []);
  assert.deepEqual(A.resolve('ask Noria about Martellius', actors, names.slice(3)).responders, []);
});

test('addressed residents speak; unrelated companion and other-resident replies disappear from both prose and subtitles', () => {
  const policy = A.resolve('ask Noria about Martellius', actors, names);
  const raw = `A page turns.\n\nNoria says, "${tagged('Noria Helm', 'Martellius taught us to question easy promises.')}"\n\n` +
    `Vaelzorith says, "${tagged(names[3], 'These ruins echo with forgotten vows.')}"\n\nErlan says, "${tagged('Erlan Vess', 'I also know about him.')}"`;
  const result = I.extractDialogue(raw + footer([]), names, { audibleNames: names, responsePolicy: policy });
  assert.equal(result.content, 'A page turns.\n\nNoria says, "Martellius taught us to question easy promises."');
  assert.deepEqual(result.dialogue.map(row => row.speaker), ['Noria Helm']);
  assert.equal(result.replies[0].speaker, names[3]);
});

test('one party member may respond to something the addressed resident actually said earlier in this turn', () => {
  const policy = A.resolve('ask monsters about Martellius', actors, names), trigger = 'Martellius taught us to question easy promises.';
  const reaction = 'Noria, would he have trusted the promises of a god?';
  const raw = `Noria says, "${tagged('Noria Helm', trigger)}"\n\nVaelzorith asks, "${tagged(names[3], reaction)}"\n\n` +
    `Zyrralith says, "${tagged(names[4], 'Noria, I also distrust easy promises.')}"` + footer([
      { speaker: names[3], replyTo: 'Noria Helm', reactsTo: trigger }, { speaker: names[4], replyTo: 'Noria Helm', reactsTo: trigger }
    ]);
  const result = I.extractDialogue(raw, names, { audibleNames: names, responsePolicy: policy });
  assert.deepEqual(result.dialogue.map(row => row.speaker), ['Noria Helm', names[3]]);
  assert.match(result.content, /would he have trusted/); assert.doesNotMatch(result.content, /Zyrralith/);
});

test('a valid companion follow-up retains every labelled continuation, not just its first phrase', () => {
  const policy = A.resolve('ask Noria about Martellius', actors, names), trigger = 'He guarded the northern stair.';
  const raw = tagged('Noria Helm', trigger) + '\n\n' + tagged(names[3], 'Noria, we saw footprints on that stair.') +
    '\n\n' + tagged(names[3], 'Could they belong to the keeper you mentioned?') + footer([{ speaker: names[3], replyTo: 'Noria Helm', reactsTo: trigger }]);
  const result = I.extractDialogue(raw, names, { audibleNames: names, responsePolicy: policy });
  assert.deepEqual(result.dialogue.map(row => row.speaker), ['Noria Helm', names[3]]);
  assert.match(result.dialogue[1].line, /footprints.*Could they belong/);
  assert.match(result.content, /keeper you mentioned/);
});

for (const fault of ['before', 'old-memory', 'invented', 'missing-metadata']) test(`party reactions cannot use a ${fault} trigger`, () => {
  const policy = A.resolve('ask monsters about Martellius', actors, names), npc = `Noria says, "${tagged('Noria Helm', 'Martellius taught us to question easy promises.')}"`;
  const party = `Vaelzorith says, "${tagged(names[3], 'Then we should question the promises too.')}"`;
  const rows = fault === 'missing-metadata' ? [] : [{ speaker: names[3], replyTo: fault === 'invented' ? 'Hades' : 'Noria Helm',
    reactsTo: fault === 'old-memory' ? 'The gate was unlocked last week.' : 'Martellius taught us to question easy promises.' }];
  const result = I.extractDialogue((fault === 'before' ? party + '\n\n' + npc : npc + '\n\n' + party) + footer(rows), names,
    { audibleNames: names, responsePolicy: policy });
  assert.deepEqual(result.dialogue.map(row => row.speaker), ['Noria Helm']); assert.doesNotMatch(result.content, /Vaelzorith/);
});

test('legacy unlabelled replies and mixed paragraphs still obey recipient selection', () => {
  const policy = A.resolve('ask Noria about Martellius', actors, names);
  const result = I.extractDialogue('Noria says, "He questioned easy promises." Vaelzorith says, "The stones remember our vows."', names,
    { audibleNames: names, responsePolicy: policy });
  assert.deepEqual(result.dialogue.map(row => row.speaker), ['Noria Helm']);
  assert.doesNotMatch(result.content, /stones remember|Vaelzorith says/);
});

test('directed focus holds cached chatter briefly without altering the saved roster or character sheets', () => {
  const population = {}, policy = A.resolve('ask Noria about Martellius', actors, names);
  const original = JSON.stringify(actors);
  Turns.focus(population, policy, [{ speaker: 'Noria Helm', line: 'He questioned easy promises.' }]);
  assert.ok(population.dialogueFocus.until > Date.now()); assert.deepEqual(population.dialogueFocus.responders, ['Noria Helm']);
  Turns.focus(population, A.resolve('look around', actors, names), []);
  assert.equal(population.dialogueFocus, undefined); assert.equal(JSON.stringify(actors), original);
});
