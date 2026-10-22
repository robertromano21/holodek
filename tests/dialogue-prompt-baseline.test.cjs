'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { templateContent } = require('retort-js/dist/message');
const { generateInhabitants } = require('../retort/inhabitantGeneration');
const Profiles = require('../assets/characterProfiles');
const inhabitants = require('./fixtures/inhabitants.cjs');
const { batchRows, slotIds } = require('./fixtures/inhabitant-batch.cjs');

for (const [geoKey, indoor, count] of [['0,0,0', true, 1], ['1,0,0', true, 8], ['2,0,0', false, 16]]) {
  test(`${geoKey}: authored residents retain regional context without the added public-lore instruction`, async () => {
    const prompts = [], requests = [], rows = inhabitants(count), before = JSON.stringify(rows);
    const agent = { user: (parts, ...values) => prompts.push(templateContent(parts, ...values)),
      assistant: { generation: async options => { requests.push(options); return { content: JSON.stringify({ inhabitants: batchRows(rows, options) }) }; } } };
    const result = await generateInhabitants(agent, { geoKey, indoor, roomName: 'Hall of Bells',
      roomDescription: 'A burial garden beside the crossing.', campaignSetting: {
        region: 'Ashen Wastes', inhabited: true, community: 'Cinder Well', livelihoods: ['grave masonry', 'ferrying']
      } }, { level: () => 1, random: min => min, sex: () => 'Female', xp: () => 0, equipment: async () => null });
    const prompt = prompts.join('\n');
    assert.equal(requests.length, Math.ceil(count / 4));
    assert.deepEqual(requests.flatMap(slotIds), rows.map(row => row.slot));
    assert.match(prompt, /Regional community facts \(read-only\)/);
    assert.match(prompt, /Cinder Well/); assert.match(prompt, /grave masonry/);
    assert.match(prompt, /Each individual needs a UNIQUE short history and personality/);
    assert.doesNotMatch(prompt, /PUBLIC UNDERWORLD CULTURE|Local public context|before asking a character-driven question/);
    for (const row of rows) {
      const profile = result.population.actors[row.name].profile;
      assert.equal(profile.source, 'llm'); assert.equal(Profiles.complete(profile), true);
      assert.equal(profile.history, row.history); assert.equal(profile.voice, row.voice);
    }
    assert.equal(JSON.stringify(rows), before);
  });
}

test('moral inversion stays out of variability seeds and both narrative progress prompts', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const seeds = [...source.matchAll(/const diversitySeed = (\[[^\r\n]+?\])/g)];
  assert.equal(seeds.length, 2);
  for (const seed of seeds) assert.doesNotMatch(seed[1], /moral|invers/i);
  const shared = fs.readFileSync(require.resolve('../retort/graveMasterStoryPrompts'), 'utf8');
  assert.doesNotMatch(source + shared, /moral_inversion|blending with a moral twist/);
  assert.equal(shared.match(/Evaluate input against active quest task; update progress narratively in 1 concise para\./g)?.length, 2);
});
