'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const { createCombatSpace } = require('../retort/dungeonReach');

function fixture(indoor = true) {
  const dungeon = { geoKey: '1,0,0', classification: { indoor }, cells: {},
    start: { x: 4, y: 4 }, layout: { width: 32, height: 32 },
    tiles: { custom_column: { spriteSpec: { voxelShape: 'doric_column', baseWidth: 0.6, heightRatio: 1 } } } };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: indoor ? 6 : 0.5 };
  }
  dungeon.cells['5,4'] = { tile: 'custom_column', floorHeight: 0, ceilHeight: 6, structureHeight: 6 };
  const roster = [
    { name: 'PC', type: 'pc', hp: 100, mazeX: 4, mazeY: 4, mazeRoomKey: dungeon.geoKey },
    { name: 'Guard', type: 'monster', hp: 30, mazeX: 6, mazeY: 4, mazeRoomKey: dungeon.geoKey },
    { name: 'Other Guard', type: 'monster', hp: 30, mazeX: 4, mazeY: 6, mazeRoomKey: dungeon.geoKey }
  ];
  const population = I.createPopulation(dungeon.geoKey, [
    { name: 'Guard', allegiance: 'Hostile', encounterId: 'first' },
    { name: 'Other Guard', allegiance: 'Hostile', encounterId: 'second' }
  ], { indoor });
  I.attach(roster, population);
  return { dungeon, roster, population, player: { x: 4.5, y: 4.5 } };
}

for (const indoor of [true, false]) test(`${indoor ? 'indoor' : 'outdoor'} speech bends around a pillar without granting visual or attack line of sight`, () => {
  const { dungeon: d, roster, player } = fixture(indoor);
  const reach = I.dialogueReach(d, roster[1], player);
  assert.equal(reach.lineOfSight, false);
  assert.equal(reach.canHear, true); assert.equal(reach.canSpeak, true);
  assert.equal(reach.distance, 2); assert.equal(reach.range, 3);
  assert.equal(createCombatSpace(d, roster, d.geoKey).canAttack(roster[0], roster[1]), false);
  roster[1].mazeX = 8;
  assert.equal(I.dialogueReach(d, roster[1], player).canHear, false);
});

test('hearing does not pass through walls, closed doors, sealed voxel barriers or low real roofs', () => {
  for (const barrier of ['wall', 'door', 'voxel', 'roof']) {
    const { dungeon: d, roster, player } = fixture(false);
    if (barrier === 'wall' || barrier === 'door') d.cells['5,4'] = { tile: barrier, door: { isOpen: false }, floorHeight: 0, ceilHeight: 6 };
    if (barrier === 'voxel') {
      d.tiles.custom_column.spriteSpec = { voxelShape: 'doric_column', baseWidth: 10, heightRatio: 1 };
    }
    if (barrier === 'roof') d.cells['6,4'].roof = { height: 0.4 };
    assert.equal(I.dialogueReach(d, roster[1], player).canSpeak, false, barrier);
  }
});

test('the narration cast includes audible companions independently of the visual nearby list', () => {
  const { dungeon: d, roster, population } = fixture();
  roster[1].type = 'npc';
  const perception = I.perceive(d, roster, population);
  assert.ok(!perception.nearby.includes(roster[1]));
  assert.ok(perception.conversational.includes(roster[1]));
});

test('an engaged pack persists behind pillars, keeps its console sheets and cannot be replaced by a closer pack', () => {
  const { dungeon: d, roster, population: p, player } = fixture();
  const space = createCombatSpace(d, roster, d.geoKey);
  d.cells['5,4'].tile = 'floor';
  assert.deepEqual(I.teams(roster, p, space, 'attack Guard').hostiles.map(a => a.name), ['Guard']);
  d.cells['5,4'].tile = 'custom_column';
  assert.deepEqual(I.teams(roster, p, space).hostiles.map(a => a.name), ['Guard']);
  assert.deepEqual(I.teams(roster, p, space, 'attack Guard').hostiles.map(a => a.name), ['Guard']);
  assert.deepEqual(I.hostileEncounterNames(d, roster, p, player), ['Guard']);
  assert.ok(I.nearbyMonsterNames(d, roster, p, player).includes('Guard'));
  assert.equal(space.canAttack(roster[0], roster[1]), false);
  const route = space.pursuitPath(roster[0], roster[1]);
  assert.ok(route.length > 0);
  for (const step of route) space.move(roster[0], step);
  assert.equal(space.canAttack(roster[0], roster[1]), true);
  assert.ok(!route.some(step => step.x === 5 && step.y === 4));
});

test('unseen packs behind pillars do not activate merely because their voices could carry', () => {
  const { dungeon: d, roster, population: p, player } = fixture();
  roster[2].mazeX = 25;
  assert.equal(I.dialogueReach(d, roster[1], player).canHear, true);
  assert.deepEqual(I.teams(roster, p, createCombatSpace(d, roster, d.geoKey)).hostiles, []);
  assert.deepEqual(I.hostileEncounterNames(d, roster, p, player), []);
  assert.deepEqual(I.nearbyMonsterNames(d, roster, p, player), []);
});

test('dead, departed, recruited and pending residents never remain combatants in an engaged group', () => {
  for (const status of ['dead', 'departed', 'recruited', 'pending']) {
    const { dungeon: d, roster, population: p, player } = fixture();
    p.groups[0].status = 'engaged';
    if (status === 'pending') p.actors.Guard.discoveryState = 'pending';
    else p.actors.Guard.status = status;
    roster[2].mazeX = 25;
    assert.deepEqual(I.teams(roster, p, createCombatSpace(d, roster, d.geoKey)).hostiles, [], status);
    assert.deepEqual(I.hostileEncounterNames(d, roster, p, player), [], status);
  }
});

test('open-sky terrain clearance does not become a phantom roof in perception, placement or combat movement', () => {
  const { dungeon: d, roster, player } = fixture(false);
  d.cells['5,4'].tile = 'floor';
  const before = JSON.stringify(d);
  assert.ok(I.walkable(d, 4, 4)); assert.ok(I.pointWalkable(d, player.x, player.y));
  assert.ok(I.lineClear(d, player, { x: 6.5, y: 4.5 }));
  assert.ok(I.reachable(d).some(point => point.x === 8 && point.y === 8));
  assert.ok(createCombatSpace(d, roster, d.geoKey).pursuitPath(roster[0], roster[1]).length);
  assert.equal(JSON.stringify(d), before, 'No saved geometry or terrain is rewritten.');
  d.cells['4,4'].roof = { height: 0.5 };
  assert.equal(I.walkable(d, 4, 4), false); assert.equal(I.pointWalkable(d, player.x, player.y), false);
  assert.equal(I.dialogueReach(d, roster[1], player).canSpeak, false);
});
