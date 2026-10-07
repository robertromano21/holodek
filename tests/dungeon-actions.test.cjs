const test = require('node:test');
const assert = require('node:assert/strict');
const { doorIntent, prepareDoorAction, applyDoorAction } = require('../retort/dungeonActions');
const { createCombatSpace } = require('../retort/dungeonReach');
function room() {
  const cells = {};
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
  cells['2,1'] = { tile: 'door', door: { isOpen: false, locked: true } };
  return { geoKey: '0,0,0', cells };
}
const actor = { name: 'PC', mazeX: 1, mazeY: 1, mazeRoomKey: '0,0,0' };
test('noncombat check changes the same door cell, without modifying its original snapshot', () => {
  const dungeon = room();
  const plan = prepareDoorAction({ input: 'force the door', dungeon, actor, geoKey: dungeon.geoKey });
  assert.equal(plan.allowed, true);
  assert.equal(plan.check, true);
  const next = applyDoorAction(dungeon, plan, true);
  assert.equal(next.cells['2,1'].door.isOpen, true);
  assert.equal(dungeon.cells['2,1'].door.isOpen, false);
  assert.equal(next.actionAttempts['2,1:force'], true);
});
test('no remote unlock, puzzle bypass, free retries, or lock picking without tools', () => {
  const dungeon = room();
  const args = { dungeon, actor, geoKey: dungeon.geoKey };
  assert.equal(prepareDoorAction({ ...args, input: 'pick the door lock' }).allowed, false);
  assert.equal(prepareDoorAction({ ...args, actor: { ...actor, mazeRoomKey: '1,0,0' }, input: 'force door' }).allowed, false);
  const plan = prepareDoorAction({ ...args, input: 'force door' });
  const next = applyDoorAction(dungeon, plan, false);
  assert.equal(prepareDoorAction({ ...args, dungeon: next, input: 'force door' }).allowed, false);
  dungeon.cells['2,1'].door.questLocked = true;
  assert.equal(prepareDoorAction({ ...args, input: 'force door' }).allowed, false);
  assert.equal(doorIntent('how do I open this door?'), null);
  assert.equal(doorIntent('do not open the door'), null);
});
test('ordinary opening needs no roll; barred door cannot be trivially opened', () => {
  const dungeon = room();
  dungeon.cells['2,1'].door.locked = false;
  const args = { input: 'open door', dungeon, actor, geoKey: dungeon.geoKey };
  assert.equal(prepareDoorAction(args).check, false);
  dungeon.cells['2,1'].door.barred = true;
  assert.equal(prepareDoorAction(args).allowed, false);
});
test('combat uses maze positions, reach, walls, corner occlusion, and floor height', () => {
  const dungeon = room();
  const enemy = { name: 'Enemy', mazeX: 1, mazeY: 2, mazeRoomKey: dungeon.geoKey, x: 999, y: 999 };
  const space = createCombatSpace(dungeon, [actor, enemy], dungeon.geoKey);
  assert.equal(space.canAttack(actor, enemy), true);
  enemy.mazeX = 5;
  assert.equal(space.canAttack(actor, enemy), false);
  assert.equal(space.canAttack({ ...actor, equipped: { Weapon: 'long bow' } }, enemy), false); // door blocks ray
  enemy.mazeX = 2; enemy.mazeY = 2;
  assert.equal(space.canAttack(actor, enemy), false); // closed door at the diagonal corner
  dungeon.cells['2,1'].door.isOpen = true;
  assert.equal(space.canAttack(actor, enemy), true);
  dungeon.cells['2,2'].floorHeight = 4;
  assert.equal(space.canAttack(actor, enemy), false);
});
