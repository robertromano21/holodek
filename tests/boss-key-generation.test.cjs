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
  return { agent: { user: tag, assistant: Object.assign(tag, { generation: async () => response }) },
    dependencies: { console: { log() {}, warn() {} }, isReservedBossKeyName,
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
  assert.deepEqual(await generate(h.agent, 'Hall', 'An existing hall.'), []);
  assert.equal(JSON.stringify(database), original);
});

test('real room-object generator keeps normal names and original item-type selection', async () => {
  const h = harness({}, { content: 'Iron Sword' });
  const generate = compile('async function generateRoomObjects(', 'async function generateObjectModifiers(', 'generateRoomObjects', h.dependencies);
  assert.deepEqual(await generate(h.agent, 'Hall', 'An existing hall.'), [{ name: 'iron sword', type: 'weapon' }]);
});
