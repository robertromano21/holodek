'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Schema = require('../retort/structuredSchema');
const { templateContent } = require('retort-js/dist/message');
function agent(answer) {
  const requests = [], prompts = [], $ = { requests, prompts,
    user: async (parts, ...values) => prompts.push(typeof parts === 'string' ? parts : templateContent(parts, ...values)), system: async () => {},
    assistant: { generation: async options => { requests.push(options); return { content: JSON.stringify(answer(requests.length)) }; } } };
  return $;
}
async function flags(values, work) {
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return await work(); } finally { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}

test('atlas livelihood item schema and semantic count limits agree on both attempts', async () => {
  const Campaign = require('../retort/campaignSetting');
  const $ = agent(attempt => ({ regions: Campaign.REGIONS.map((row, i) => ({ ...row,
    underground: 'Dry passages connect to the surface.', livelihoods: i === 0 && attempt === 1 ? ['One', 'Two', 'Three', 'Four'] : row.livelihoods })), factions: Campaign.FACTIONS }));
  let data = '{}';
  const result = await Campaign.prepareAtlas($, { getDungeonRunId: () => 'offline-adjacent-schema', getRoomNameDatabase: () => data, setRoomNameDatabase: value => { data = value; } });
  assert.equal(result.source, 'validated-campaign-plan'); assert.equal($.requests.length, 2);
  for (const request of $.requests) {
    const trades = Schema.toJSON(request.parameters).properties.regions.items.properties.livelihoods;
    assert.equal(trades.minItems, 2); assert.equal(trades.maxItems, 3);
    assert.equal(trades.items.minLength, 1); assert.equal(trades.items.pattern, '[\\s\\S]*\\S[\\s\\S]*');
  }
  assert.match($.prompts.join('\n'), /livelihoods: expected two or three named trades/);
});

test('recurring-cast base schema mirrors local bounds and exact resident/destination choices', async () => flags({
  HOLODEK_LEVEL_CAST: '1', HOLODEK_QUEST_REWARDS: '1', HOLODEK_QUEST_LOCAL: '1', HOLODEK_QUEST_REVEALS: '1'
}, async () => {
  const value = { members: [{ name: 'Nera', interests: ['Gardens', 'Family'] }], arcs: [{ title: 'Ash Flowers', premise: 'Find the flowers lost along the old road.',
    giver: 'Nera', stages: ['Ask at the garden', 'Follow the road', 'Return to the gardener'], destinationHint: 'Ash Road',
    difficulty: 'easy', localStages: 1, localSpot: 'the garden', reveals: [{ kind: 'route', label: 'the old road', why: 'Her family used it.' }] }] };
  const $ = agent(attempt => ({ ...value, arcs: value.arcs.map(arc => ({ ...arc, giver: attempt === 1 ? 'Unselected' : 'Nera' })) }));
  const result = await require('../retort/roomCast').generate($, { runId: 'offline-cast-schema', geoKey: '0,1,0', roomName: 'Garden',
    population: { actors: { Nera: { name: 'Nera', allegiance: 'Friendly' }, Unselected: { name: 'Unselected', allegiance: 'Neutral' }, Guard: { name: 'Guard', allegiance: 'Hostile' } } },
    nearbyRooms: [{ name: 'Ash Road' }] });
  assert.equal($.requests.length, 2); assert.equal(result.arcs[0].giver, 'Nera');
  const schema = Schema.toJSON($.requests[0].parameters), members = schema.properties.members, arcs = schema.properties.arcs;
  assert.equal(members.minItems, 1); assert.equal(members.maxItems, 2);
  assert.deepEqual(members.items.properties.name.enum, ['Nera', 'Unselected']);
  assert.equal(members.items.properties.interests.minItems, 2); assert.equal(members.items.properties.interests.maxItems, 3);
  assert.equal(arcs.minItems, 1); assert.equal(arcs.maxItems, 2);
  assert.equal(arcs.items.properties.stages.minItems, 3); assert.equal(arcs.items.properties.stages.maxItems, 5);
  assert.equal(arcs.items.properties.stages.items.pattern, '[\\s\\S]*\\S[\\s\\S]*');
  assert.deepEqual(arcs.items.properties.destinationHint.enum, ['Ash Road']);
  assert.deepEqual(arcs.items.properties.difficulty.enum, ['easy', 'normal', 'hard', 'deadly']);
  assert.equal(arcs.items.properties.reveals.maxItems, 3);
  assert.match($.prompts.at(-1), /choose an exact name from the selected members/);
}));

for (const entry of [false, true]) test('cloud dialogue schema bounds ' + (entry ? 'entry greetings' : 'silent refreshes') + ' without changing local narration', async () => {
  const characters = [{ name: 'Nera', partyMember: true }, { name: 'Tarin', partyMember: true }];
  const $ = agent(() => ({ spoken: entry ? [{ speaker: 'Nera', line: 'Welcome back.' }] : [],
    replies: [{ speaker: 'Nera', lines: ['I still tend these flowers.', 'My family taught me their names.'] }],
    exchanges: [{ lines: [{ speaker: 'Nera', line: 'Have you seen the flowers?' }, { speaker: 'Tarin', line: 'They opened after the wind passed.' }] }] }));
  const result = await require('../retort/characterDialogue').generateCharacterDialogue($, { characters, entry });
  assert.equal($.requests.length, 1); assert.equal(result.dialogue.length, entry ? 1 : 0);
  const properties = Schema.toJSON($.requests[0].parameters).properties;
  assert.equal(properties.spoken.maxItems, entry ? 2 : 0);
  assert.equal(properties.replies.maxItems, 2);
  for (const branch of properties.replies.items.anyOf) {
    assert.equal(branch.properties.lines.minItems, 2);
    assert.equal(branch.properties.lines.maxItems, 6);
    assert.match(branch.properties.lines.items.pattern, /\{0,19\}/);
  }
  assert.equal(properties.exchanges.maxItems, 2);
  assert.equal(properties.exchanges.items.properties.lines.minItems, 2);
  assert.equal(properties.exchanges.items.properties.lines.maxItems, 2);
});

test('cache refresh rejects immediate speech and retries without publishing it', async () => {
  const $ = agent(attempt => ({ spoken: attempt === 1 ? [{ speaker: 'Nera', line: 'Not spoken now.' }] : [],
    replies: [{ speaker: 'Nera', lines: ['The road is quiet.', 'I will tend the flowers.'] }] }));
  const result = await require('../retort/characterDialogue').generateCharacterDialogue($, { characters: [{ name: 'Nera' }], entry: false });
  assert.equal($.requests.length, 2); assert.deepEqual(result.dialogue, []); assert.equal(result.replies.length, 1);
  assert.match($.prompts.at(-1), /cache refresh must not speak now/);
});
