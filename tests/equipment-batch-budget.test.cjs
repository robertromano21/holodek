'use strict';
// Monster equipment is authored in independent 8-item batches inside the population's generation scope.
// Each batch has its own attempt budget; the whole pass is bounded; nothing is published until every batch validates.
const test = require('node:test'), assert = require('node:assert/strict');
const { templateContent } = require('retort-js/dist/message');
const { generateInhabitants } = require('../retort/inhabitantGeneration');
const { toJSON } = require('../retort/structuredSchema');
const fixtures = require('./fixtures/inhabitants.cjs');
const Gear = require('../retort/monsterEquipment'), Policy = require('../retort/generationPolicy');
const party = [{ Name: 'Companion', HP: 20, Level: 4, Equipped: { Weapon: { name: 'bronze spear', attack_modifier: 4, damage_modifier: 5 },
  Armor: { name: 'ring coat', ac: 2 }, Shield: { name: 'round shield', ac: 2 } } }];
const quiet = async fn => { const w = console.warn, l = console.log; console.warn = console.log = () => {}; try { return await fn(); } finally { console.warn = w; console.log = l; } };
// failAt: item-batch call numbers (1-based) that return an invalid item (damage_modifier 99, rejected by validation).
function model({ failAt = [] } = {}) {
  const itemCalls = [], populationCalls = []; let serial = 0;
  const agent = { run: async work => { const prompts = [];
    return work({ user: (parts, ...values) => prompts.push(typeof parts === 'string' ? parts : templateContent(parts, ...values)), assistant: { generation: async options => {
      const schema = toJSON(options.parameters);
      if (schema.properties.inhabitants) {
        const ids = schema.properties.inhabitants.items.properties.slot.enum; populationCalls.push(ids);
        const plan = JSON.parse(prompts.map(p => p.match(/NOT a fixed cast: (\[.*?\])\.\n/)).find(Boolean)[1]);
        const allegiance = r => { const s = plan.find(x => x.slot === r.slot); return s.cohortAllegiance || (s.peaceful ? 'Neutral' : s.allegiance); };
        return { content: JSON.stringify({ inhabitants: fixtures(16).filter(r => ids.includes(r.slot)).map(r => ({ ...r, allegiance: allegiance(r), encounterId: 'locals', homeSite: 'commons' })) }) };
      }
      const types = JSON.parse(prompts.findLast(p => p.startsWith('Engine-selected item types')).match(/\[[^\]]*\]/)[0]);
      itemCalls.push(types.length); const bad = failAt.includes(itemCalls.length);
      return { content: JSON.stringify({ items: types.map(type => ({ name: `ash ${type} ${String.fromCharCode(97 + Math.floor(serial / 26) % 26, 97 + serial++ % 26)}`,
        type, attack_modifier: type === 'weapon' ? 3 : 0, damage_modifier: bad ? 99 : type === 'weapon' ? 4 : 0, ac: ['armor', 'shield'].includes(type) ? 2 : 0,
        magic: type === 'other' ? 1 : 0, consumable_kind: 'none', description: 'Dark fitted equipment with reinforced seams.' })) }) };
    } } }); } };
  return { agent, itemCalls, populationCalls };
}
const actor = name => ({ Name: name, Race: 'Many-limbed revenant', Class: 'Fighter', State: 'Hostile', Level: 4, HP: 20, MaxHP: 20, AC: 10, Attack: 2, Damage: 1, Armor: 0, Magic: 0,
  Equipped: { Weapon: null, Armor: null, Shield: null, Other: null } });
let captured;
async function population(m, { lr }) {
  const before = process.env.HOLODEK_LIVING_REGION; process.env.HOLODEK_LIVING_REGION = lr ? '1' : '0'; captured = null;
  try {
    return await quiet(() => generateInhabitants(m.agent, { roomName: 'Ash Crossing', roomDescription: 'A road.', geoKey: '1,0,0', indoor: false,
      partyNames: ['Companion'], party, usedNames: [], rooms: { '0,0,0': { name: 'Old Temple' } } },
      { random: min => min, level: () => 4, sex: () => 'Female', xp: () => 0,
        equipPopulation: actors => { captured = actors; return Gear.equip(m.agent, actors, { party, random: () => .99 }); } }));
  } finally { if (before === undefined) delete process.env.HOLODEK_LIVING_REGION; else process.env.HOLODEK_LIVING_REGION = before; }
}

for (const lr of [false, true]) test(`a 16-resident population needing six equipment batches is fully equipped inside one generation scope (living region ${lr ? 'on' : 'off'})`, async () => {
  const m = model(), result = await population(m, { lr });
  assert.equal(m.populationCalls.length, 4);
  assert.deepEqual(m.itemCalls, [8, 8, 8, 8, 8, 8], 'six independent batches (48 items), each accepted on its first attempt');
  assert.equal(Object.keys(result.population.actors).length, 16);
  assert.equal(result.equipment.length, 48);
});

test('a batch that fails validation is retried within its own budget; the whole pass stays bounded', async () => {
  const m = model({ failAt: [5, 7] }), actors = Array.from({ length: 16 }, (_, i) => actor('Ash Warden ' + i));
  const items = await quiet(() => Policy.scope(() => Gear.equip(m.agent, actors, { party, random: () => .99 })));
  assert.equal(items.length, 48); assert.equal(m.itemCalls.length, 8, 'six batches plus two retries');
  // More than three retries in total stops the operation even though each batch still has attempts left.
  const n = model({ failAt: [1, 3, 5, 7] }), others = Array.from({ length: 16 }, (_, i) => actor('Ash Warden ' + i));
  const snapshot = JSON.stringify(others);
  await assert.rejects(quiet(() => Policy.scope(() => Gear.equip(n.agent, others, { party, random: () => .99 }))), e => e.code === 'GENERATION_BUDGET_EXHAUSTED' || /exhausted|failed/i.test(e.message));
  assert.ok(n.itemCalls.length <= 6 + Policy.RETRIES, 'at most one attempt per batch plus three retries in total');
  assert.equal(JSON.stringify(others), snapshot, 'a later-batch failure publishes no equipment and changes no stats');
});

test('one batch never gets more than its own four attempts', async () => {
  const m = model({ failAt: [1, 2, 3, 4] }), actors = Array.from({ length: 3 }, (_, i) => actor('Ash Warden ' + i)), snapshot = JSON.stringify(actors);
  await assert.rejects(quiet(() => Policy.scope(() => Gear.equip(m.agent, actors, { party, random: () => .99 }))));
  assert.equal(m.itemCalls.length, Policy.ATTEMPTS); assert.equal(JSON.stringify(actors), snapshot);
});

test('a later-batch failure in the population pass publishes no population and applies no partial stats', async () => {
  const m = model({ failAt: [6, 7, 8, 9] });
  await assert.rejects(population(m, { lr: false }));
  assert.ok(captured?.length === 16);
  for (const a of captured) assert.deepEqual(Object.values(a.Equipped).filter(Boolean), [], 'no equipment was attached to any actor');
});

test('equipment rules are unchanged: each actor still receives one to three typed items in their own slots, with the same modifier sums', async () => {
  const m = model(), actors = Array.from({ length: 9 }, (_, i) => actor('Ash Warden ' + i));
  const items = await quiet(() => Policy.scope(() => Gear.equip(m.agent, actors, { party, random: () => 0 })));
  assert.equal(items.length, 27); assert.deepEqual(m.itemCalls, [8, 8, 8, 3]);
  for (const a of actors) { assert.equal(a.Attack, 5); assert.equal(a.Damage, 5); assert.equal(a.Armor, 4); assert.equal(a.AC, 14); }
});
