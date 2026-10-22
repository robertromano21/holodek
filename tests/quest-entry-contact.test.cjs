'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const { prepareEntryQuestContact } = require('../retort/roomPopulation');
const { generateInhabitants } = require('../retort/inhabitantGeneration');
const inhabitantReply = require('./fixtures/inhabitants.cjs');
const { batchRows, slotIds } = require('./fixtures/inhabitant-batch.cjs');
const { describeCharacters, generateCharacterDialogue } = require('../retort/characterDialogue');
const quest = 'Find the missing keeper before confronting the bound boss.';
function fixture() {
  const dungeon = { geoKey: '1,0,0', start: { x: 4, y: 4 }, cells: {}, layout: { width: 32, height: 32 } };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 6 };
  const p = I.createPopulation(dungeon.geoKey, [{ name: 'Guide', allegiance: 'Neutral' }, { name: 'Far Worker', allegiance: 'Neutral' }]);
  p.questIntroduction = { questId: String(I.hash(quest)), speaker: 'Guide', status: 'pending', hook: 'Our keeper has vanished. Can you investigate?' };
  const roster = [{ name: 'Guide', type: 'monster', hp: 20, state: 'Neutral', mazeX: 6, mazeY: 4, mazeRoomKey: dungeon.geoKey },
    { name: 'Far Worker', type: 'monster', hp: 20, state: 'Neutral', mazeX: 25, mazeY: 4, mazeRoomKey: dungeon.geoKey }];
  const perception = { player: { x: 4.5, y: 4.5 } };
  return { p, dungeon, roster, perception, contact: () => prepareEntryQuestContact(p, dungeon, roster, perception, quest) };
}

for (const [label, mutate] of [
  ['distant', f => f.roster[0].mazeX = 25], ['blocked by a wall', f => f.dungeon.cells['5,4'].tile = 'wall'],
  ['pending outdoor discovery', f => f.roster[0].discoveryState = 'pending'], ['hostile', f => f.roster[0].state = 'Hostile'],
  ['dead', f => f.roster[0].hp = 0], ['wrong room', f => f.roster[0].mazeRoomKey = '2,0,0'],
  ['different population room', f => f.p.geoKey = '2,0,0'], ['departed', f => f.p.actors.Guide.status = 'departed'],
  ['stale quest', f => f.p.questIntroduction.questId = 'old-quest'], ['already introduced', f => f.p.questIntroduction.status = 'introduced'],
  ['starting room', f => { f.p.geoKey = f.dungeon.geoKey = '0,0,0'; f.roster[0].mazeRoomKey = '0,0,0'; }]
]) test(`a quest contact ${label} cannot be discovered or summoned into the entry scene`, () => {
  const f = fixture(); mutate(f); const before = JSON.stringify(f.p);
  assert.equal(f.contact(), null); assert.equal(JSON.stringify(f.p), before);
});

test('an actual visible contact is discovered individually, but its quest is introduced only after actual speech', () => {
  const f = fixture(), other = f.p.actors['Far Worker'];
  const contact = f.contact(); assert.equal(contact.speaker, 'Guide'); assert.ok(f.p.actors.Guide.encounteredAt > 0);
  assert.equal(other.encounteredAt, undefined); assert.equal(f.p.questIntroduction.status, 'pending');
  I.noteSpoken(f.p, [{ speaker: 'Guide', line: contact.hook }], true);
  assert.equal(f.p.questIntroduction.status, 'introduced'); assert.equal(f.contact(), null);
});

test('a first-time contact cannot be discovered through a pillar, but a previously seen one can still discuss its hook', () => {
  const f = fixture();
  f.dungeon.tiles = { column: { spriteSpec: { voxelShape: 'doric_column', baseWidth: .6, heightRatio: 1 } } };
  f.dungeon.cells['5,4'] = { tile: 'column', floorHeight: 0, ceilHeight: 6, structureHeight: 6 };
  assert.equal(f.contact(), null);
  f.p.actors.Guide.encounteredAt = 1000;
  assert.equal(f.contact().speaker, 'Guide');
});

for (const proposed of ['Friendly', 'Hostile']) test(`quest-contact generation protects ${proposed === 'Friendly' ? 'a friendly ally' : 'a nonhostile contact'} while other residents retain model-chosen allegiance`, async () => {
  const requests = [];
  const agent = { user() {}, assistant: { generation: async options => { requests.push(options); return { content: JSON.stringify({ inhabitants: batchRows(inhabitantReply(8, [
    { slot: 0, name: 'Guide', allegiance: proposed, dialogue: ['The keeper is missing. Can you investigate?'] },
    { slot: 3, name: 'Guard', allegiance: 'Friendly' }
  ]), options) }) }; } } };
  const result = await generateInhabitants(agent, { roomName: 'Cloister', roomDescription: 'A ruined cloister.', geoKey: '1,0,0', indoor: true, quest, questSeed: true },
    { level: () => 1, random: () => 5, sex: () => 'Female', xp: () => 0, equipment: async () => null });
  assert.equal(requests.length, 2); assert.deepEqual(requests.flatMap(slotIds), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.population.actors.Guide.allegiance, proposed === 'Friendly' ? 'Friendly' : 'Neutral');
  assert.equal(result.population.actors.Guard.allegiance, 'Friendly');
  assert.equal(result.population.questIntroduction.hook, 'The keeper is missing. Can you investigate?');
  const d = fixture().dungeon; I.place(result.population, d);
  const guide = result.population.actors.Guide;
  assert.ok(I.dialogueReach(d, { name: 'Guide', type: 'monster', hp: 20, mazeX: guide.position.x, mazeY: guide.position.y, mazeRoomKey: d.geoKey },
    { x: 4.5, y: 4.5 }).canSpeak);
});

test('the reserved quest hook survives a cache refresh and continues to inform that contact alone', async () => {
  const f = fixture(); I.applyReplies(f.p, [{ speaker: 'Guide', lines: ['A generic cached remark.'] }], f.roster);
  const contact = f.contact(); assert.equal(contact.hook, 'Our keeper has vanished. Can you investigate?');
  const characters = describeCharacters(f.roster, f.p); assert.equal(characters[0].pendingQuestHook, contact.hook);
  assert.equal(characters[1].pendingQuestHook, undefined);
  const prompts = [], agent = { system() {}, user(parts, ...values) { prompts.push(String.raw({ raw: parts }, ...values)); },
    assistant: { generation: async () => ({ content: '{"spoken":[],"replies":[]}' }) } };
  await generateCharacterDialogue(agent, { characters, quest });
  assert.match(prompts.join('\n'), /retain its existing quest invitation/);
  assert.equal(f.p.questIntroduction.status, 'pending');
});
