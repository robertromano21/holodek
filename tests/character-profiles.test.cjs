'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/characterProfiles');
const I = require('../assets/dungeonInhabitants');
const Memory = require('../retort/dialogueMemory');
const { generateProfiles } = require('../retort/characterProfiles');
const { generateCharacterDialogue, describeCharacters } = require('../retort/characterDialogue');

test('Mortacia and Suzerain keep their established origins instead of accepting random replacement biographies', () => {
  const mortacia = P.create({ Name: 'Mortacia' }, 'run', { history: 'A farmer who already defeated Arithus.' });
  assert.equal(mortacia.canonical, true); assert.match(mortacia.history, /goddess of death/); assert.match(mortacia.history, /Sepulchra/);
  assert.doesNotMatch(mortacia.history, /farmer|already defeated/);
  assert.match(P.create({ Name: 'Suzerain' }).history, /Knight of Atinus/);
  assert.equal(P.create({ Name: 'constructor' }).canonical, false);
});
test('missing biographies stay explicitly pending, never become stock personal histories', () => {
  const actor = { Name: 'Mason', Race: 'Elf', Class: 'Mason', HP: 20, sprite: { dataUrl: 'unchanged' } }, before = JSON.stringify(actor);
  const profile = P.create(actor, 'run');
  assert.deepEqual(P.create(actor, 'run'), profile); assert.equal(profile.source, 'pending');
  assert.equal(profile.history, ''); assert.equal(P.complete(profile), false);
  assert.ok(profile.history.length <= 600 && profile.personality.length <= 220); assert.equal(JSON.stringify(actor), before);
});
test('party-mode backgrounds use one batch for random companions and keep Mortacia canonical', async () => {
  const characters = [{ Name: 'Mortacia' }, { Name: 'Lysa', Race: 'Elf', Class: 'Scholar' }, { Name: 'Borin', Race: 'Dwarf', Class: 'Mason' }];
  let requests = 0; const prompts = [];
  const agent = { user: (parts, ...values) => prompts.push(String.raw({ raw: parts }, ...values)),
    assistant: { generation: async () => { requests++; return { content: JSON.stringify({ profiles: [
      { name: 'Lysa', personality: 'Curious but evasive.', history: 'Copied shipwreck journals. Regrets hiding a final letter.', voice: 'Questions before answers.', motivation: 'Make amends.' },
      { name: 'Borin', personality: 'Proud but gentle.', history: 'Restored a mountain shrine. Failed to save its custodian.', voice: 'Dry practical counsel.', motivation: 'Protect a new companion.' }
    ] }) }; } } };
  const profiles = await generateProfiles(agent, characters, 'run');
  assert.equal(requests, 1); assert.equal(profiles.length, 3); assert.equal(profiles[0].canonical, true);
  assert.match(profiles[1].history, /shipwreck/); assert.match(profiles[2].history, /mountain shrine/);
  assert.ok(!prompts[0].split('Return ONLY')[0].includes('Mortacia'));
  await generateProfiles(agent, characters.map((actor, i) => ({ ...actor, originProfile: profiles[i] })), 'run');
  assert.equal(requests, 1, 'Saved origins are not regenerated on a revisit or sprite reroll.');
});
test('monster personalities and histories survive population persistence and recollection updates', () => {
  const p = I.createPopulation('1,0,0', [{ name: 'Korvak', allegiance: 'Hostile', history: 'Kept vigil over a flooded quarry.', personality: 'Watchful and bitter.' }]);
  const saved = JSON.parse(JSON.stringify(p)), ledger = { characters: {}, recent: [] }, state = { getDialogueMemory: () => ledger };
  Memory.rememberDialogue(state, saved, [{ speaker: 'Korvak', line: 'Do not disturb my vigil.' }]);
  assert.match(saved.actors.Korvak.memory.profile.history, /flooded quarry/);
  const recalled = Memory.memoryContext(state, ['Korvak'], saved);
  assert.match(recalled[0].recollection.profile.personality, /Watchful/);
  const described = describeCharacters([{ name: 'Korvak', type: 'monster', hp: 20 }], saved);
  assert.match(described[0].background.history, /flooded quarry/);
});
test('dialogue generation receives personal evidence and explicitly rejects generic chorus and shared remote knowledge', async () => {
  const prompts = [], agent = { system() {}, user: (parts, ...values) => prompts.push(String.raw({ raw: parts }, ...values)),
    assistant: { generation: async () => ({ content: '{"spoken":[],"replies":[]}' }) } };
  await generateCharacterDialogue(agent, { characters: [{ name: 'Borin', background: P.compact(P.create({ Name: 'Borin' })) }],
    personalMemories: [{ name: 'Borin', heardCurrentConversation: false, memories: [{ excerpt: 'I promised to protect Lysa.' }] }] });
  const text = prompts.join('\n'); assert.match(text, /promised to protect Lysa/);
  assert.match(text, /must not react to the player's recent conversation/); assert.match(text, /Avoid interchangeable remarks/);
});
