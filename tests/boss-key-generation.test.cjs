'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { isReservedBossKeyName } = require('../retort/bossGate');
const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
const seal = 'oath sanctuary seal key 012345abcdef';

function compile(start, end, name, dependencies) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return vm.compileFunction(`${source.slice(first, last)}\nreturn ${name};`, Object.keys(dependencies))(...Object.values(dependencies));
}
function harness(database, response) {
  const tag = () => {};
  const reply = response.result ? response : { content: JSON.stringify({ items: [{ name: response.content, type: 'weapon',
    attack_modifier: 3, damage_modifier: 4, ac: 0, magic: 0, consumable_kind: 'none', description: 'An iron blade with a wrapped grip.' }] }) };
  return { agent: { user: tag, assistant: Object.assign(tag, { generation: async () => reply }) },
    dependencies: { console: { log() {}, warn() {} }, isReservedBossKeyName, GeneratedNames: require('../retort/generatedNames'),
      require: id => require('../retort/' + id.slice(2)),
      WorldSetting: { current: () => null },
      sharedState: { getRoomNameDatabase: () => JSON.stringify(database) },
      coordinatesToString: c => `${c.x},${c.y},${c.z}`,
      Math: Object.assign(Object.create(Math), { random: () => 0 }),
      getDelayedUpdatedGameConsole: async () => 'Next Artifact: Sepulchra\nCurrent Quest: Retrieve the relic' } };
}

test('ordinary key generator retains its existing properties but cannot mint the reserved final seal', async () => {
  for (const keyName of [seal, 'legacy sentinel key']) {
    const database = { '9,0,0': { bossGate: { keyName: 'legacy sentinel key' } } };
    const h = harness(database, { result: { name: keyName, type: 'key', attack_modifier: 2, damage_modifier: 1, ac: 3, magic: 2 } });
    const generate = compile('async function generateKey(', '// Opposite direction map', 'generateKey', h.dependencies);
    const result = await generate(h.agent, { x: 0, y: 0, z: 0 }, 'east');
    assert.equal(result.name, 'key for east at 0,0,0');
    assert.equal(result.type, 'key');
    assert.deepEqual(result.properties, { attack: 2, damage: 1, ac: 3, magic: 2 });
  }
});

test('ordinary key generation remains unchanged for keys unrelated to the quest gate', async () => {
  const h = harness({}, { result: { name: 'Iron Key', type: 'key', magic: 1 } });
  const generate = compile('async function generateKey(', '// Opposite direction map', 'generateKey', h.dependencies);
  assert.deepEqual(await generate(h.agent, { x: 0, y: 0, z: 0 }, 'north'), {
    name: 'iron key', type: 'key', properties: { attack: 0, damage: 0, ac: 0, magic: 1 }
  });
});

test('real room-object generator rejects a seal disguised as a weapon without creating it in the database', async () => {
  const database = { '9,0,0': { bossGate: { keyName: seal, keySeeded: false }, objects: [] } };
  const h = harness(database, { content: seal });
  const generate = compile('async function generateRoomObjects(', 'async function generateObjectModifiers(', 'generateRoomObjects', h.dependencies);
  const original = JSON.stringify(database);
  await assert.rejects(generate(h.agent, 'Hall', 'An existing hall.'), /reserved quest key/);
  assert.equal(JSON.stringify(database), original);
});

test('real room-object generator retains authored names and types with the current game modifiers', async () => {
  const h = harness({}, { content: 'Iron Sword' });
  const generate = compile('async function generateRoomObjects(', 'async function generateObjectModifiers(', 'generateRoomObjects', h.dependencies);
  const [item] = await generate(h.agent, 'Hall', 'An existing hall.');
  assert.equal(item.name, 'iron sword'); assert.equal(item.type, 'weapon'); assert.equal(item.attack_modifier, 3); assert.equal(item.damage_modifier, 4);
});

test('real room-object generator preserves word boundaries before storing item names', async () => {
  const h = harness({}, { content: 'Bone-rib Spear' });
  const generate = compile('async function generateRoomObjects(', 'async function generateObjectModifiers(', 'generateRoomObjects', h.dependencies);
  const [item] = await generate(h.agent, 'Hall', 'An existing hall.');
  assert.equal(item.name, 'bone rib spear'); assert.equal(item.type, 'weapon');
});
