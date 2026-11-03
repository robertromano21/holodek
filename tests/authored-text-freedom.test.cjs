'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../retort/generationContracts'), Repair = require('../retort/generationRepair');
const I = require('../assets/dungeonInhabitants'), Profiles = require('../assets/characterProfiles');
const Readables = require('../assets/readableItems'), Items = require('../retort/itemAuthoring');
const prose = 'The witness records the history of this place in complete and particular detail. '.repeat(100).trim();
const longName = 'the keeper of the records of the distant settlements beyond the northern mountain';

test('authoring contracts remove only text widths, preserving exact choices, formats and game bounds', async () => {
  const parameters = { text: { type: String, minLength: 100, maxLength: 600 },
    nested: C.object({ name: C.text(40), choices: { type: [C.choice(['weapon', 'armor'])], minItems: 1, maxItems: 2 },
      color: { type: String, pattern: '^#[0-9a-fA-F]{6}$' }, amount: { type: Number, minimum: 0, maximum: 8 } }) };
  const normalized = C.authoringParameters(parameters);
  assert.equal(normalized.text.maxLength, undefined); assert.equal(normalized.text.minLength, 1);
  assert.equal(normalized.nested.type.name.maxLength, undefined);
  assert.deepEqual(normalized.nested.type.choices, parameters.nested.type.choices);
  assert.deepEqual(normalized.nested.type.color, parameters.nested.type.color);
  assert.deepEqual(normalized.nested.type.amount, parameters.nested.type.amount);
  assert.equal(parameters.text.maxLength, 600, 'Schema normalization does not mutate callers.');
  let calls = 0;
  const agent = { assistant: { generation: async options => {
    calls++; assert.deepEqual(options.parameters, normalized);
    return { content: JSON.stringify({ text: prose, nested: { name: longName } }) };
  } } };
  const result = await C.request(agent, { component: 'unrestricted-prose-test', parameters });
  assert.equal(calls, 1); assert.equal(result.value.text, prose); assert.equal(result.value.nested.name, longName);
});

test('cached dialogue has no twenty-word rejection but still rejects missing remarks', () => {
  assert.deepEqual(Repair.wordIssues(prose, '$.line'), []);
  assert.ok(Repair.wordIssues(' ', '$.line').length);
  assert.ok(Repair.wordIssues(null, '$.line').length);
  const contract = C.wordText();
  assert.equal(contract.maxLength, undefined); assert.ok(new RegExp(contract.pattern).test(prose));
});

test('glyph names have no prose width restriction while pixel rows retain their exact format',()=>{
  const Puzzle=require('../assets/physicalPuzzles'),Contract=require('../retort/puzzleContract');
  const Schema=require('../retort/structuredSchema'),Transport=require('../retort/modelTransport');
  const schema=Schema.toJSON(C.authoringParameters(Contract.parameters(Puzzle.fallback('glyph-length','Hall'))));
  const glyph=schema.properties.glyphs.items.properties;
  assert.ok(Transport.matches(longName,glyph.name));
  assert.ok(Transport.matches(Array(7).fill('0101010'),glyph.pixels));
  assert.equal(Transport.matches(Array(7).fill('01010101'),glyph.pixels),false);
});

test('resident identities, biographies and dialogue survive normalization without clipping', () => {
  const row = { name: longName, race: longName, className: longName, job: prose, activity: prose,
    history: prose, personality: prose, voice: prose, motivation: prose, dialogue: [prose], allegiance: 'Friendly' };
  const normalized = I.normalizeDescriptors([row], { starting: true })[0];
  for (const key of ['name', 'race', 'className', 'job', 'activity', 'history', 'personality', 'voice', 'motivation'])
    assert.equal(normalized[key], row[key], key);
  assert.equal(normalized.dialogue[0], prose);
  const profile = Profiles.create(row);
  for (const key of ['history', 'personality', 'voice', 'motivation']) {
    assert.equal(profile[key], prose);
  }
  assert.ok(Profiles.compact(profile).history.length <= 300, 'Context excerpts do not alter stored biographies.');
});

test('readables and inscriptions retain full contents while mechanical restrictions remain', () => {
  const raw = { kind: 'book', name: 'book of ' + longName, title: prose, backstory: prose, role: 'lore',
    chapters: [{ title: prose, text: prose }], modifiers: { magic: 1 } };
  const book = Readables.validate([raw])[0];
  assert.equal(book.name, raw.name); assert.equal(book.backstory, prose); assert.equal(book.chapters[0].text, prose);
  const stone = Readables.validateInscriptions([{ type: 'stone_tablet', name: longName,
    title: prose, backstory: prose, text: prose, role: 'lore' }])[0];
  assert.equal(stone.title, prose); assert.equal(stone.chapters[0].text, prose);
  assert.throws(() => Readables.validate([{ ...raw, modifiers: { magic: 99 } }]), /modifiers/);
  assert.throws(() => Readables.validate([{ ...raw, chapters: [{ title: 'Empty', text: '' }] }]), /chapters/);
});

test('ordinary equipment can have long authored names and descriptions, not imported combat rules', () => {
  const item = { name: longName, description: prose, type: 'weapon', attack_modifier: 3,
    damage_modifier: 4, ac: 0, magic: 0, consumable_kind: 'none' };
  const value = Items.validate({ items: [item] }, { count: 1 })[0];
  assert.equal(value.name, longName); assert.equal(value.description, prose);
  assert.throws(() => Items.validate({ items: [{ ...item, damage_dice: '1d6' }] }, { count: 1 }));
  assert.throws(() => Items.validate({ items: [{ ...item, attack_modifier: 99 }] }, { count: 1 }));
});

test('book covers and recorded facts preserve original long passages', () => {
  const Book = require('../retort/bookLore'), title = prose, contents = [1, 2, 3, 4].map(n => prose + n);
  const cover = Book.validateCover({ title, author: 'Anonymous', publishedSR: 400,
    backstory: prose, contents, newFacts: [prose] }, { authors: new Set() });
  assert.equal(cover.title, title); assert.equal(cover.backstory, prose); assert.deepEqual(cover.contents, contents);
  const db = {}; Book.storeFacts(db, cover.newFacts, title);
  assert.equal(db['0,0,0'].bookFacts[0].text, prose);
});

test('revival explanations and commissions have no prose ceilings', () => {
  const Death = require('../retort/deathStory'), Commission = require('../retort/cityCommissions');
  const story = Object.fromEntries([...Death.FIELDS, ...Death.SCENE_FIELDS].map(key => [key, prose]));
  assert.deepEqual(Death.validate(story), story);
  assert.deepEqual(Commission.validate({ title: prose, purpose: prose, parcelDescription: prose }),
    { title: prose, purpose: prose, parcelDescription: prose });
  assert.throws(() => Death.validate({ ...story, reason: '' }), /complete/);
});

test('genre rosters retain authored class, race, gear and ability text with stat limits intact', () => {
  const Setting = require('../retort/settingLayer');
  const classes = ['First', 'Second', 'Third', 'Fourth'].map(prefix => ({ name: prefix + ' ' + longName,
    description: prose, hitDie: 8, stats: { Attack: 99 }, abilities: [{ name: longName, effect: prose, cost: 99 }],
    gear: [longName], ammo: longName, bodyPlan: 'humanoid' }));
  const races = ['Elder', 'Younger'].map(prefix => ({ name: prefix + ' ' + longName, description: prose, hpBonus: 99 }));
  const roster = Setting.validateRoster({ classes, races });
  assert.equal(roster.classes[0].name, classes[0].name); assert.equal(roster.classes[0].description, prose);
  assert.equal(roster.classes[0].abilities[0].name, longName); assert.equal(roster.classes[0].abilities[0].effect, prose);
  assert.equal(roster.classes[0].gear[0], longName); assert.equal(roster.classes[0].ammo, longName);
  assert.equal(roster.races[0].description, prose); assert.equal(roster.classes[0].stats.Attack, 3);
  assert.equal(roster.classes[0].abilities[0].cost, 5); assert.equal(roster.races[0].hpBonus, 4);
});
