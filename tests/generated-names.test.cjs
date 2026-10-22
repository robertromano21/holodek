'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const Names = require('../retort/generatedNames');
const Inhabitants = require('../assets/dungeonInhabitants');
const Puzzles = require('../assets/physicalPuzzles');
const { generateInhabitants } = require('../retort/inhabitantGeneration');
const inhabitantReply = require('./fixtures/inhabitants.cjs');
const { batchRows } = require('./fixtures/inhabitant-batch.cjs');

for (const [input, expected] of [
  ['Sereveth-Notched-Ear', 'Sereveth Notched Ear'],
  ['Veyr-of-the-Last-Breath', 'Veyr of the Last Breath'],
  ['Ash-woken jackal', 'Ash woken jackal'],
  ['dust_hide\u2014cuirass', 'dust hide cuirass'],
  ['  the  bonewood\u2011buckler  ', 'the bonewood buckler'],
  ["pilgrim's shield", "pilgrim's shield"],
  ['Mortacia', 'Mortacia'], ['Suzerain', 'Suzerain'], ['Shadowveil', 'Shadowveil']
]) test(`creation-time names retain word boundaries: ${input}`, () => assert.equal(Names.clean(input), expected));

test('real equipment generator registers the same readable name later used for equipment and loot', async () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const code = source.slice(source.indexOf('async function generateMonsterEquipmentName('), source.indexOf('async function generateMonstersForRoomUsingGPT('));
  const prompts = [];
  const assistant = (parts, ...values) => prompts.push(String.raw({ raw: parts }, ...values));
  assistant.generation = async () => ({ content: '{"name":"dust-hide cuirass"}' });
  const context = { GeneratedNames: Names, Inhabitants, console: { warn() {} } };
  vm.runInNewContext(code, context);
  assert.equal(await context.generateMonsterEquipmentName({ assistant }, 'armor', 'Sereveth Notched Ear'), 'dust hide cuirass');
  assert.match(prompts[0], /spaces between words/);
});

test('real starting-monster name assignment no longer glues hyphenated epithets', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const assignment = source.match(/const monsterName = [^\r\n]+;/)?.[0];
  assert.ok(assignment);
  const name = vm.runInNewContext(`${assignment}\nmonsterName`, {
    GeneratedNames: Names, nameResult: { content: 'Name: Sereveth-Notched-Ear' }
  });
  assert.equal(name, 'Sereveth Notched Ear');
});

test('bulk resident generation uses readable names consistently for sheets, population keys and duplicate detection', async () => {
  const tag = () => {};
  const agent = { user: tag, assistant: { generation: async options => ({ content: JSON.stringify({ inhabitants: batchRows(inhabitantReply(8, [
    { slot: 0, name: 'Sereveth-Notched-Ear', race: 'Jackal', class: 'Guide', combatRole: 'Warrior' },
    { slot: 1, name: 'Veyr-of-the-Last-Breath', race: 'Jackal', class: 'Guide', combatRole: 'Warrior' }
  ]), options) }) }) } };
  const rules = { level: () => 1, random: () => 1, sex: () => 'Female', xp: () => 0, equipment: async () => null };
  const result = await generateInhabitants(agent, { roomName: 'Hall', geoKey: '1,0,0', indoor: true }, rules);
  assert.ok(result.population.actors['Sereveth Notched Ear']);
  assert.ok(result.population.actors['Veyr of the Last Breath']);
  assert.match(result.sheets, /Sereveth Notched Ear\n/);
  await assert.rejects(generateInhabitants(agent, { roomName: 'Hall', geoKey: '1,0,0', indoor: true, partyNames: ['Sereveth Notched Ear'] }, rules), /duplicate or reserved name: Sereveth Notched Ear/);
});

test('fallback puzzle prose does not apply a singular article and verb to a plural kit name', () => {
  for (let seed = 0; seed < 200; seed++) {
    const definition = Puzzles.fallback('grammar:' + seed, 'Ruined Temple Entrance');
    const prose = Puzzles.prose(definition).description;
    assert.match(prose, /^In Ruined Temple Entrance, an ancient mechanism uses /);
    assert.doesNotMatch(prose, /An ancient (?:echo chimes|oath scales|star mirrors).* links/);
    assert.equal(Puzzles.findSolution(definition) !== null, true);
  }
});
