'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const RoomDescription = require('../retort/roomDescription');
const target = { name: 'The Spring of Unburied Green', coordinates: '1,1,0', classification: { indoor: false, biome: 'ashland' } };

test('the creation order authorizes descriptive worldbuilding without replacing the Grave Master or mechanical state', () => {
  const prompt = RoomDescription.creationPrompt(target);
  assert.match(prompt, /The Spring of Unburied Green/);
  assert.match(prompt, /"coordinates":"1,1,0"/);
  assert.match(prompt, /"indoor":false/);
  assert.match(prompt, /complete Grave Master lore/);
  assert.match(prompt, /uninhabited placeholder.*not.*forbids creating/);
  assert.match(prompt, /do not invent portable objects, characters, exits/);
  assert.match(prompt, /historical or figurative/);
  assert.match(prompt, /do not verify whether its name was established/);
  assert.throws(() => RoomDescription.creationPrompt({ name: target.name }), /engine-registered/);
});

test('generation keeps existing prompt context and appends one scoped creation order', async () => {
  const messages = ['The original Grave Master lore.', 'The original creative room guidance.'], requests = [];
  const prose = 'Beneath the yellow sky, green seepage stains the ashland basalt. The old name recalls a spring long buried.';
  const agent = { user: async prompt => { messages.push(prompt); }, assistant: { generation: async options => {
    requests.push(options); return { content: prose };
  } } };
  assert.equal(await RoomDescription.generate(agent, target), prose);
  assert.deepEqual(messages.slice(0, 2), ['The original Grave Master lore.', 'The original creative room guidance.']);
  assert.equal(messages.length, 3); assert.match(messages[2], /^ROOM DESCRIPTION CREATION WORK ORDER/);
  assert.equal(requests.length, 1);
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const creation = source.indexOf('roomDescription = await RoomDescription.generate(');
  assert.ok(creation > 0);
  assert.ok(source.indexOf('roomDescriptionGenerated = true', creation) > creation);
});

test('meta-responses cannot silently become persistent room descriptions', () => {
  for (const content of ['', 'I cannot establish that room.', 'I can\u2019t describe this place.',
    "I can't establish that location.", 'As an AI, I cannot verify that.', 'Please choose your character.']) {
    assert.throws(() => RoomDescription.validate(content), /No description was committed/);
  }
  assert.equal(RoomDescription.validate('An inscription reads, "I cannot forget."\n\nThe basalt is green.'),
    'An inscription reads, "I cannot forget." The basalt is green.');
});
