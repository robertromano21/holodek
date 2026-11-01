'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const A = require('../retort/genreAbilities'), Base = require('../assets/spellRules'), Setting = require('../retort/settingLayer');
const Native = require('../retort/homebrewRegionalAdventure'), Regional = require('../retort/regionalAdventure');
const Language = require('../assets/abilityLanguage');
function world() {
  return { ...Setting.localBible('an orbital habitat', ['sci-fi']),
    classes: [{ name: 'Systems Operator' }], races: [{ name: 'Habitat Native' }] };
}
function authored() {
  return { name: 'Field Systems', ability: 'module', plural: 'modules', resource: 'Charge', book: 'Loadout Manual', scroll: 'data cartridge', activate: 'activate', explanation: 'Installed equipment draws power from a rechargeable cell.',
    effects: Object.keys(Base.templates).map(id => ({ id, name: 'Module ' + id, description: 'A controlled equipment effect with its engine-defined limitations.' })),
    classes: [{ name: 'Systems Operator', rulesClass: 'Wizard' }] };
}
test('genre abilities retain engine effects and costs while CotG retains its exact catalog', () => {
  const b = world(); b.abilitySystem = A.validate(authored(), b); const rules = A.forWorld(b);
  assert.equal(rules.classSettings('Systems Operator', 3).rulesClass, 'Wizard');
  assert.equal(rules.classSettings('Systems Operator', 3).tradition, 'Systems Operator');
  for (const id of Object.keys(Base.templates)) {
    const own = rules.classSpell(id, 3), old = Base.classSpell(id, 3);
    for (const k of ['id','effect','cost','dice','sides','absorb','rounds','save','maxTargets']) assert.equal(own[k], old[k]);
    assert.equal(own.name, 'Module ' + id);
  }
  assert.match(rules.scroll('missile').name, /^data cartridge/);
  assert.equal(A.forWorld(null), Base); assert.equal(Base.templates.missile.name, 'Magic Missile');
});
test('world ability authoring persists once and rejects stale run completion', async () => {
  let db = { '0,0,0': { setting: world() } }, run = 'run', calls = 0;
  const state = { getRoomNameDatabase: () => JSON.stringify(db), setRoomNameDatabase: s => { db = JSON.parse(s); }, getDungeonRunId: () => run };
  const previous = Setting.current();
  const runner = async work => work({ user() {}, assistant: { generation: async () => { calls++; return { content: JSON.stringify(authored()) }; } } });
  try {
    await A.ensure(state, { runner }); await A.ensure(state, { runner }); assert.equal(calls, 1);
    assert.equal(db['0,0,0'].setting.abilitySystem.book, 'Loadout Manual');
    delete db['0,0,0'].setting.abilitySystem;
    await assert.rejects(A.ensure(state, { runner: async work => { const result = await runner(work); run = 'other'; return result; } }), /World changed/);
    assert.equal(db['0,0,0'].setting.abilitySystem, undefined);
  } finally { Setting.setActive(previous); }
});
test('saved genre region ignores an inherited CotG atlas even without a globally attached world', () => {
  const b = world(), db = { '0,0,0': { setting: b, campaignAtlas: { origin: 'Tartarus', regions: [{ name: 'Tartarus' }] } } };
  const region = A.region(db, '1,0,0');
  assert.equal(region.kind, 'homebrew'); assert.doesNotMatch(JSON.stringify(region), /Tartarus|Hades/);
});
test('regional quest prompt has an independent original-world track and preserves canonical track', () => {
  const b = world(), prompt = Regional.prompt({ world: b, room: 'Docking Hub' });
  assert.match(prompt, /ORIGINAL-WORLD REGIONAL ADVENTURE/);
  assert.doesNotMatch(prompt, /Arithus|Dantuea|Tartarus|Cistern Compact|Ashroad Fellowship/);
  assert.equal(Native.policy(b).templates[3], 'fortress');
  assert.match(Regional.prompt({ room: 'Ruined Temple' }), /Children of the Grave/);
});
test('genre menus use module vocabulary while legacy menus remain unchanged', () => {
  assert.equal(Language.text('Cast a spell; Magic; spellbook; scroll', authored()), 'activate a module; Charge; Loadout Manual; data cartridge');
  assert.equal(Language.text('Magic Missile', null), 'Magic Missile');
});
test('genre regional compiler binds world factions, records and architecture without canonical patrons', () => {
  const I = require('../assets/dungeonInhabitants'), sheet = require('../retort/initialGameState').formatStartingCharacterSheet;
  const b = world(), contact = sheet({ Name: 'Local Contact', Race: 'Human', Class: 'Fighter', Level: 1, HP: 20, MaxHP: 20 }, 6, 'npc');
  const pop = I.createPopulation('1,0,0', [{ name: 'Local Contact', hp: 20, allegiance: 'Neutral', sheet: contact }]);
  pop.actors['Local Contact'].hp = 20;
  const db = { '0,0,0': { setting: b }, '1,0,0': { name: 'Dock Hub', exits: { north: { status: 'open' } }, inhabitants: pop, monsters: { consoleBlock: contact, state: 'Neutral' } },
    '2,0,0': { name: 'Bound Objective' } };
  const raw = { title: 'Missing Records', premise: 'Investigate a disputed access record.', hook: 'Please check this record.', rumor: 'A witness may know more.', investigation: 'Inspect the preserved record.', rescue: 'Bring the witness back.', conclusion: 'Choose who should manage access.', burialText: 'The access record contradicts the report.', testimonyText: 'I witnessed the access change.',
    sites: ['Supply Hub', 'Records Deck', 'Service Route', 'Holding Facility'].map(name => ({ name, flavor: 'A section of the orbital habitat.' })),
    actors: ['Hub Delegate','Captive Witness','Route Guard One','Route Guard Two','Facility Guard One','Facility Guard Two'].map(name => ({ name, history: 'Worked on this habitat.', personality: 'Observant and wary.' })), templePatron: b.factions[1].name };
  const text = 'Coordinates: X: 1, Y: 0, Z: 0\nPC:\n' + sheet({ Name: 'Hero', Race: 'Human', Class: 'Fighter', Level: 1, HP: 20, MaxHP: 20 }, 6, 'npc');
  const result = Regional.compile(raw, db, '1,0,0', { targetKey: '2,0,0', bossName: 'Bound Defender' }, text, 'run');
  assert.ok(result);
  const rooms = result.route.rooms.map(k => result.database[k]);
  assert.ok(rooms.every(r => r.regionalSite.homebrew && r.campaignSetting.religion.patron === null));
  assert.match(rooms[1].inscriptions[0].name, /^investigation record/);
  assert.doesNotMatch(JSON.stringify(result.task), /Cistern Compact|Ashroad Fellowship|burial register|at the oasis/);
  assert.ok(rooms[3].campaignSetting.faction.id.startsWith('world-faction-'));
  const factions = require('../retort/factionMemory');
  const option = result.task.story.stages.find(s => s.id === 'resolution').options[0];
  factions.record(result.database, 'run', { id: 'decision', storyId: result.task.story.id, choice: option.id, summary: option.label, effects: option.factionEffects });
  const memory = factions.project(result.database);
  assert.equal(memory.factions[0].name, b.factions[0].name);
  assert.equal(memory.factions[0].score, 2);
  assert.throws(() => factions.record(result.database, 'run', { id: 'forged', storyId: 'story', choice: 'forged', summary: 'Invalid faction', effects: { wellkeepers: 2 } }), /Invalid engine faction/);
});
