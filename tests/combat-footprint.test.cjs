const test = require('node:test'), assert = require('node:assert/strict');
const Footprint = require('../assets/combatFootprint');
const { createCombatSpace } = require('../retort/dungeonReach');
const { paths } = require('../retort/combatTactics');

function fixture() {
  const dungeon = { cells: {} };
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 10 };
  const pc = { name: 'Hero', type: 'pc', hp: 30, mazeX: 7, mazeY: 5, mazeRoomKey: '1,0,0' };
  const dragon = { name: 'Dragon', type: 'monster', hp: 100, mazeX: 5, mazeY: 4, mazeRoomKey: '1,0,0',
    sprite: { spec: { stature: { category: 'large', scale: 1.96 } } } };
  return { pc, dragon, dungeon, space: createCombatSpace(dungeon, [pc, dragon], '1,0,0') };
}

test('footprint uses physical size categories, not enlarged artwork or wings, with explicit rectangular overrides', () => {
  assert.equal(Footprint.cells({ mazeX: 2, mazeY: 3, sprite: { spec: { stature: { scale: 3 } } } }).length, 1);
  for (const [category, span] of [['humanoid', 1], ['large', 2], ['huge', 3], ['gargantuan', 4]]) {
    const actor = { mazeX: 2, mazeY: 3, stature: { category } }, cells = Footprint.cells(actor);
    assert.equal(cells.length, span * span); assert.deepEqual(cells[0], { x: 2, y: 3 });
    assert.deepEqual(cells.at(-1), { x: 1 + span, y: 2 + span });
  }
  assert.equal(Footprint.cells({ mazeX: 2, mazeY: 3, combatFootprint: { width: 3, height: 2 } }).length, 6);
  assert.equal(Footprint.cells({ mazeX: 2, mazeY: 3, sprite: { spec: { stature: { category: 'large' }, traits: { size: 'huge' } } } }).length, 9);
  assert.equal(Footprint.cells({ mazeX: 2, mazeY: 3, sprite: { spec: { stature: { category: 'humanoid' }, traits: { size: 'large' } } } }).length, 1);
});

test('all large-monster cells block tactical movement, and melee reaches its near side rather than its anchor', () => {
  const { pc, dragon, space } = fixture(), routes = paths(space, pc, 6);
  for (const c of Footprint.cells(dragon)) assert.equal(routes.has(`${c.x},${c.y}`), false);
  assert.equal(space.distance(pc, dragon), 1);
  assert.equal(space.canAttack(pc, dragon), true); assert.equal(space.canStrike(dragon, pc), true);
  assert.equal(space.canStrikeFrom(dragon, space.point(dragon), { x: 10.5, y: 5.5 }, pc), false);
});

test('map centers use the whole rectangular footprint and preserve fractional movement between tiles', () => {
  const actor = { combatFootprint: { width: 3, height: 2 }, mazeX: 4, mazeY: 7 };
  assert.deepEqual(Footprint.center(actor), { x: 5.5, y: 8 });
  assert.deepEqual(Footprint.center(actor, { x: 4.25, y: 7.5 }), { x: 5.75, y: 8.5 });
  assert.deepEqual(Footprint.center({}, { x: 4, y: 7 }), { x: 4.5, y: 7.5 });
});

test('a large actor cannot move if any footprint cell hits a wall, actor, or excessive height change', () => {
  const { dragon, dungeon, space } = fixture();
  assert.equal(space.canMoveTo(dragon, { x: 5, y: 4 }, { x: 4, y: 4 }), true);
  dungeon.cells['4,5'].tile = 'wall';
  assert.equal(space.canMoveTo(dragon, { x: 5, y: 4 }, { x: 4, y: 4 }), false);
  dungeon.cells['4,5'].tile = 'floor'; dungeon.cells['4,5'].floorHeight = 5;
  assert.equal(space.canMoveTo(dragon, { x: 5, y: 4 }, { x: 4, y: 4 }), false);
  assert.equal(space.canMoveTo(dragon, { x: 5, y: 4 }, { x: 6, y: 4 }), false, 'The far footprint cell overlaps the hero');
});
