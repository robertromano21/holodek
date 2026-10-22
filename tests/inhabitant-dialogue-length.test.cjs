'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const root = process.env.HOLODEK_DIALOGUE_SOURCE_ROOT || path.resolve(__dirname, '..');
const { generateInhabitants } = require(path.join(root, 'retort/inhabitantGeneration'));
const Inhabitants = require(path.join(root, 'assets/dungeonInhabitants'));
const fixtures = require(path.join(root, 'tests/fixtures/inhabitants.cjs'));
const { batchRows, slotIds } = require('./fixtures/inhabitant-batch.cjs');
const { templateContent } = require('retort-js/dist/message');
const loggedGreeting = "You seek the Ashen Vow of Ronalde? Ask me about the Sepulchral Wyrm's Ashen Vault; I can tell you what the old route marks remember.";
const longGreeting = loggedGreeting + ' ' + 'The names in the burial register must be compared with the old route marks before anyone can know which road was lost. '.repeat(6).trim();
const context = { roomName: 'The Saffron Mile of Unfinished Maps', roomDescription: 'An ashland road lined with incomplete maps.',
  geoKey: '0,1,0', indoor: false, quest: 'Find the Ashen Vow of Ronalde.', questSeed: true };
const rules = { random: min => min, level: () => 1, sex: () => 'Female', xp: () => 0, equipment: async () => null };
function agent(rows) {
  const requests = [], prompts = [];
  return { requests, prompts, user: (parts, ...values) => prompts.push(templateContent(parts, ...values)),
    assistant: { generation: async options => { requests.push(options); return { content: JSON.stringify({ inhabitants: batchRows(rows, options) }) }; } } };
}
for (const greeting of [loggedGreeting, longGreeting]) test(`outdoor quest batches accept and preserve a ${greeting.split(/\s+/).length}-word greeting without correction`, async () => {
  const rows = fixtures(16, [{ slot: 0, name: 'Sella Ashline', dialogue: [greeting], allegiance: 'Neutral' }]);
  const a = agent(rows), result = await generateInhabitants(a, context, rules);
  assert.equal(a.requests.length, 4);
  assert.deepEqual(a.requests.flatMap(slotIds), Array.from({ length: 16 }, (_, slot) => slot));
  assert.equal(Object.keys(result.population.actors).length, 16);
  assert.equal(result.population.actors['Sella Ashline'].dialogue[0], greeting);
  assert.equal(result.population.questIntroduction.hook, greeting);
  assert.equal(result.population.questIntroduction.speaker, 'Sella Ashline');
  assert.equal(result.population.questIntroduction.status, 'pending');
  assert.match(a.prompts.join('\n'), /there is no word-count limit/);
  assert.doesNotMatch(a.prompts.join('\n'), /at most 24 words/);
});
test('normalizing or reconstructing a population preserves long resident dialogue', () => {
  assert.ok(longGreeting.length > 400);
  const rows = fixtures(1, [{ slot: 0, dialogue: [longGreeting] }]);
  assert.equal(Inhabitants.normalizeDescriptors(rows)[0].dialogue[0], longGreeting);
  const population = Inhabitants.createPopulation('0,1,0', rows);
  assert.equal(population.actors[rows[0].name].dialogue[0], longGreeting);
});
for (const dialogue of [['One.', 'Two.'], ['One.', 'Two.', '   '], ['One.', null, 'Three.'], 'Not an array']) {
  test('missing, empty or non-text dialogue is still invalid: ' + JSON.stringify(dialogue), async () => {
    const rows = fixtures(16); rows[0].dialogue = dialogue;
    const a = agent(rows);
    await assert.rejects(generateInhabitants(a, context, rules), /dialogue requires three nonempty remarks/);
    assert.equal(a.requests.length, 4, 'Initial attempt plus three shared retries; malformed dialogue stays rejected.');
  });
}
