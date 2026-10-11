const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness(blocked = new Set()) {
  const source = fs.readFileSync('assets/game.js', 'utf8');
  const begin = source.indexOf('function findNextPartyMazeStep('), end = source.indexOf('// ---- Monster wandering', begin);
  let queries = 0;
  const context = { playerDungeonX: 366, playerDungeonY: 387,
    canEnterTile: (_x, _y, x, y) => { queries++; return x >= 0 && y >= 0 && x < 512 && y < 512 && !blocked.has(`${x},${y}`); },
    isObstacleAtPos: () => false };
  vm.runInNewContext(source.slice(begin, end), context);
  return { context, queries: () => queries };
}
test('companions far behind the player make bounded walking progress instead of exhausting a breadth-first search', () => {
  for (const start of [{ x: 234, y: 388 }, { x: 269, y: 381 }, { x: 310, y: 373 }]) {
    const { context, queries } = harness(), goal = { x: 365, y: 387 };
    const next = context.findNextPartyMazeStep(start, goal, 'Companion', new Set());
    assert.equal(Math.abs(next.x - start.x) + Math.abs(next.y - start.y), 1);
    assert.ok(Math.abs(next.x - goal.x) + Math.abs(next.y - goal.y) < Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y));
    assert.ok(queries() <= 2048);
    assert.equal(context.partyFollowCadence({ mazeX: start.x, mazeY: start.y }, 600), 150);
  }
});
test('follow routes respect walls, occupied tiles and sealed rooms, and never teleport', () => {
  const walls = new Set(Array.from({ length: 20 }, (_, y) => `12,${y}`));
  const { context } = harness(walls), goal = { x: 15, y: 3 };
  let current = { x: 8, y: 3 };
  for (let i = 0; i < 60 && (current.x !== goal.x || current.y !== goal.y); i++) {
    const next = context.findNextPartyMazeStep(current, goal, 'Companion', new Set());
    assert.equal(Math.abs(next.x - current.x) + Math.abs(next.y - current.y), 1);
    assert.ok(!walls.has(`${next.x},${next.y}`)); current = next;
  }
  assert.equal(current.x, goal.x); assert.equal(current.y, goal.y);
  const sealed = harness(new Set(['3,2', '1,2', '2,3', '2,1']));
  const start = { x: 2, y: 2 };
  assert.equal(sealed.context.findNextPartyMazeStep(start, goal, 'Companion', new Set()), start);
  const stationary = context.findNextPartyMazeStep(goal, goal, 'Companion', new Set());
  assert.equal(stationary, goal);
});
test('close companions retain their normal formation cadence', () => {
  const { context } = harness();
  assert.equal(context.partyFollowCadence({ mazeX: 365, mazeY: 388 }, 600), 600);
});
