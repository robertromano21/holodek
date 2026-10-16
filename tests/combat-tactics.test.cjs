'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const T = require('../retort/combatTactics'), Gear = require('../assets/equipmentRules');
const Reach = require('../retort/dungeonReach'), Flow = require('../retort/combatTurnFlow');
const { ActionDice } = require('../retort/actionDice');
const Ui = require('../assets/combatTacticalUi');
function fixture() {
  const dungeon = { geoKey: '1,0,0', cells: {} };
  for (let y = 0; y < 12; y++) for (let x = 0; x < 15; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', ceilHeight: 3 };
  const actor = (name, type, x, y) => ({ name, type, hp: 40, mazeX: x, mazeY: y, mazeRoomKey: dungeon.geoKey, state: type === 'monster' ? 'Hostile' : 'Friendly' });
  const pc = actor('PC', 'pc', 3, 4), enemy = actor('Guard', 'monster', 4, 4), ally = actor('Ally', 'npc', 3, 5);
  const space = Reach.createCombatSpace(dungeon, [pc, enemy, ally], dungeon.geoKey), dice = new ActionDice();
  dice.begin('combat', dungeon.geoKey); dice.active.turn = { turnId: 'turn', combatant: 'PC', actionId: dice.active.id };
  let paused = false; const state = { getDungeonRunId: () => 'run', getGamePaused: () => paused,
    getLastCoords: () => ({ x: 1, y: 0, z: 0 }) };
  const events = [], opportunities = [];
  const t = T.attach({ space, dice, state, actor: pc, targets: [enemy],
    step: async tile => events.push(tile), opportunity: async enemy => opportunities.push(enemy.name) });
  const input = (x, y, extra = {}) => ({ x, y, actionId: dice.active.id, turnId: 'turn', combatant: 'PC', geoKey: dungeon.geoKey, runId: 'run', revision: dice.active.turn.movement.revision, ...extra });
  return { dungeon, pc, enemy, ally, space, dice, state, t, input, events, opportunities, pause(value) { paused = value; } };
}
test('bounded cardinal paths respect living occupancy, walls, doors and terrain height', () => {
  const f = fixture(); f.dungeon.cells['2,4'].tile = 'wall'; f.dungeon.cells['3,3'] = { tile: 'door', door: { isOpen: false } };
  assert.equal(T.paths(f.space, f.pc, 6).size, 0);
  f.dungeon.cells['3,3'].door.isOpen = true; f.dungeon.cells['3,3'].floorHeight = 3;
  assert.equal(T.paths(f.space, f.pc, 6).size, 0);
  f.dungeon.cells['3,3'].floorHeight = 0;
  for (const path of T.paths(f.space, f.pc, 6).values()) {
    assert.ok(path.length <= 6); assert.deepEqual(path[0], { x: 3, y: 3 });
    assert.ok(!path.some(p => p.x === 4 && p.y === 4 || p.x === 3 && p.y === 5));
  }
});
test('movement spends a shared turn budget, persists real tiles and rejects replayed revisions', async () => {
  const f = fixture(), first = f.input(3, 3); await f.dice.moveCombatant(first);
  assert.equal(f.dice.active.turn.movement.remaining, 5);
  await assert.rejects(f.dice.moveCombatant(first), /stale/);
  await f.dice.moveCombatant(f.input(3, 2));
  assert.equal(f.dice.active.turn.movement.remaining, 4);
  assert.deepEqual(f.space.point(f.pc), { x: 3.5, y: 2.5 });
  assert.equal(f.opportunities.length, 1);
  await assert.rejects(f.dice.moveCombatant(f.input(14, 11)), /not available/);
  f.t.close(); assert.equal(f.dice.moveCombatant, undefined);
});

test('selecting a target approaches only to real weapon range using the same movement budget', async () => {
  const f = fixture(); f.space.move(f.enemy, { x: 8, y: 4 }); f.t.update();
  const plan = f.dice.active.turn.approachTargets.find(t => t.name === 'Guard');
  assert.ok(plan && plan.cost > 0 && plan.cost <= 6);
  assert.equal(await f.t.approach(f.enemy), true);
  assert.equal(f.space.canAttack(f.pc, f.enemy), true);
  assert.equal(f.events.length, plan.cost);
  assert.equal(f.dice.active.turn.movement.remaining, 6 - plan.cost);
  assert.notDeepEqual(f.space.point(f.pc), f.space.point(f.enemy), 'Never step onto an occupied target square');
  const count = f.events.length; assert.equal(await f.t.approach(f.enemy), true);
  assert.equal(f.events.length, count, 'An already reachable target costs no extra movement');
});

test('automatic approach cannot teleport through walls, exceed the turn budget or charge a bow target', async () => {
  const f = fixture(); f.space.move(f.enemy, { x: 14, y: 4 }); f.t.update();
  assert.equal(await f.t.approach(f.enemy), false); assert.equal(f.events.length, 0);
  f.space.move(f.enemy, { x: 8, y: 4 });
  for (let y = 0; y < 12; y++) f.dungeon.cells[`6,${y}`].tile = 'wall';
  assert.equal(await f.t.approach(f.enemy), false); assert.equal(f.events.length, 0);
  for (let y = 0; y < 12; y++) f.dungeon.cells[`6,${y}`].tile = 'floor';
  f.pc.equipped = { Weapon: 'shortbow' }; f.t.update();
  assert.equal(await f.t.approach(f.enemy), true); assert.equal(f.events.length, 0);
  f.t.close(); assert.equal(await f.t.approach(f.enemy), false);
});
test('stale, malformed, paused, wrong-room and out-of-turn moves cannot spend movement', async () => {
  const f = fixture();
  for (const extra of [{ runId: 'old' }, { geoKey: '0,0,0' }, { actionId: 'old' }, { turnId: 'old' }, { combatant: 'Ally' }, { revision: -1 }, { x: 3.1 }])
    await assert.rejects(f.dice.moveCombatant(f.input(3, 3, extra)), /stale/);
  f.pause(true); await assert.rejects(f.dice.moveCombatant(f.input(3, 3)), /paused/); f.pause(false);
  assert.equal(f.dice.active.turn.movement.remaining, 6);
  const move = f.dice.moveCombatant, input = f.input(3, 3); f.dice.end(); await assert.rejects(move(input), /stale/);
});
test('movement locks actions until all steps resolve and repeated clicks cannot interleave', async () => {
  const f = fixture(); f.t.close(); let release, started;
  const ready = new Promise(r => started = r), wait = new Promise(r => release = r);
  T.attach({ space: f.space, dice: f.dice, state: { getDungeonRunId: () => 'run' }, actor: f.pc, targets: [f.enemy], step: async () => { started(); await wait; } });
  const input = f.input(3, 3), pending = f.dice.moveCombatant(input); await ready;
  assert.equal(f.dice.active.turn.movement.busy, true);
  await assert.rejects(f.dice.moveCombatant(f.input(3, 2)), /resolving/);
  release(); await pending; assert.equal(f.dice.active.turn.movement.remaining, 5);
});
test('a storey change rejects old movement even when the posted room and turn tokens are still valid', async () => {
  const f = fixture(), old = f.input(3, 3);
  f.state.getLastCoords = () => ({ x: 1, y: 0, z: 1 });
  await assert.rejects(f.dice.moveCombatant(old), /stale/);
  assert.equal(f.dice.active.turn.movement.remaining, 6);
  assert.equal(f.events.length, 0);
});
test('ranged attacks use catalog range and LOS; ranged enemies cannot make retreat free shots', () => {
  const f = fixture(); f.space.move(f.enemy, { x: 14, y: 4 }); f.pc.equipped = { Weapon: 'shortbow' };
  assert.equal(f.space.canAttack(f.pc, f.enemy), true);
  f.dungeon.cells['8,4'].tile = 'wall'; assert.equal(f.space.canAttack(f.pc, f.enemy), false);
  f.dungeon.cells['8,4'].tile = 'floor'; f.pc.equipped.Weapon = 'sling'; assert.equal(f.space.canAttack(f.pc, f.enemy), false);
  f.space.move(f.enemy, { x: 4, y: 4 }); f.enemy.equipped = { Weapon: 'longbow' };
  assert.deepEqual(Flow.opportunityTargets(f.enemy, [f.pc], f.space), []);
  assert.equal(f.space.rangedPenalty(f.pc), 4);
  f.pc.equipped.Weapon = 'longsword'; assert.equal(f.space.rangedPenalty(f.pc), 0);
});
test('all catalog gear has working modifiers, bounded prices, correct medium SRD dice and honest descriptions', () => {
  const R = require('../assets/economyRules');
  assert.equal(Gear.catalog.greatsword.damage_dice, '2d6'); assert.equal(Gear.catalog.shortbow.damage_dice, '1d6');
  assert.equal(Gear.catalog['light crossbow'].range_tiles, 16); assert.equal(Gear.catalog['chain shirt'].ac, 4);
  assert.equal(Gear.armorBonus({ equipped: { Armor: 'leather armor', Shield: 'heavy wooden shield' } }), 4);
  for (const item of Gear.stock()) {
    assert.ok(item.description && item.quantity > 0); assert.ok(R.price(item) > 0 && R.price(item) <= 12);
    assert.equal(R.price({ ...item, price_silver: 500 }), R.price(item));
  }
});
test('production damage rolls weapon dice, adds Damage once and never heals a target with negative damage', async () => {
  const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8');
  const dice = new ActionDice({ random: sides => sides, animationMs: 0 }); dice.begin('combat', '1,0,0');
  const context = { EquipmentRules: Gear, actionDice: dice, characterClasses: [{ name: 'Fighter', baseHP: 10 }] };
  vm.runInNewContext(source.slice(source.indexOf('async function rollCombatDamage('), source.indexOf('function automaticCombatSpell(')), context);
  assert.equal(await context.rollCombatDamage({ name: 'Ally', className: 'Fighter', equipped: { Weapon: 'greatsword' }, damage: 2 }, { name: 'Guard' }, { name: 'PC' }, []), 14);
  assert.deepEqual([...dice.results.values()].map(r => [r.sides, r.modifier]), [[6, 2], [6, 0]]);
  assert.equal(await context.rollCombatDamage({ name: 'Ally', className: 'Fighter', equipped: { Weapon: 'dagger' }, damage: -20 }, { name: 'Guard' }, { name: 'PC' }, []), 0);
});
test('rotated map picking inverts the existing fractional maze projection at every facing', () => {
  for (const combatAngle of [0, Math.PI / 2, Math.PI, -.8, 2.3]) {
    const d = { combatAngle, cs: 10, centerX: 155, centerY: 155, pos: { x: 41.27, y: 35.62 } };
    for (const tile of [{ x: 42, y: 35 }, { x: 39, y: 39 }]) {
      const lx = (tile.x + .5 - d.pos.x) * d.cs, ly = (tile.y + .5 - d.pos.y) * d.cs;
      const x = d.centerX + lx * Math.cos(combatAngle) - ly * Math.sin(combatAngle), y = d.centerY + lx * Math.sin(combatAngle) + ly * Math.cos(combatAngle);
      assert.deepEqual(Ui.tileAt(d, x * 2.5, y * 2.5, 2.5), tile);
    }
  }
});
test('real target route rejects attacks outside reach and choices during movement; End Turn remains valid', () => {
  const source = fs.readFileSync('server.js', 'utf8'); let handler, events = 0;
  const dice = { active: { id: 'battle', kind: 'combat', turn: { turnId: 'turn', combatant: 'PC', targets: ['Guard'], tactical: true, attackTargets: [], movement: { busy: false } } } };
  vm.runInNewContext(source.slice(source.indexOf("app.post('/submit-target2',"), source.indexOf("app.post('/combat/move',")), {
    app: { post: (_url, fn) => handler = fn }, actionDice: dice, sharedState: { getGamePaused: () => false, emitter: { emit: () => events++ } }, console: { log() {} } });
  const post = extra => { let status = 200; handler({ body: { combatant: 'PC', actionId: 'battle', turnId: 'turn', action: 'attack', target: 'Guard', ...extra } },
    { status(v) { status = v; return this; }, json() {} }); return status; };
  assert.equal(post({}), 409); dice.active.turn.attackTargets = ['Guard']; assert.equal(post({}), 200);
  dice.active.turn.attackTargets = []; dice.active.turn.approachTargets = [{ name: 'Guard', x: 3, y: 4, cost: 2 }];
  assert.equal(post({}), 200); dice.active.turn.approachTargets = [];
  dice.active.turn.movement.busy = true; assert.equal(post({ action: 'hold', cancelled: true }), 409);
  dice.active.turn.movement.busy = false; assert.equal(post({ action: 'hold', cancelled: true }), 200); assert.equal(events, 3);
});
