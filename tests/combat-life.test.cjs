'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const Life = require('../retort/combatLife'), I = require('../assets/dungeonInhabitants'), E = require('../retort/economy'), S = require('../retort/spellSystem');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
function fixture(pcName = 'PC') {
  const rows = [['PC', pcName, 'pc'], ['NPCs in Party', 'Ally', 'npc'], ['Monsters in Room', 'Enemy', 'monster']];
  let text = 'Coordinates: X: 0, Y: 0, Z: 0\nInventory: Empty\nInventory Properties: None\n' + rows.map(([label, name, type]) => label + ':\n' + sheet({ Name: name, Class: 'Fighter', Level: 1, HP: 10, MaxHP: 20, AC: 10 }, 6, type)).join('\n') + '\nMonsters Equipped Properties: None';
  let db = JSON.stringify({ '0,0,0': { objects: [], name: 'Hall' } });
  let roster = JSON.stringify(rows.map(([, name, type], x) => ({ name, type, hp: 10, maxHp: 20, mazeX: x + 2, mazeY: 2, mazeRoomKey: '0,0,0' })));
  const dungeon = { geoKey: '0,0,0', cells: {} }; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor' };
  let paused = false, run = 'life-run';
  const state = { emitter: new EventEmitter(), getDungeonRunId: () => run, getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getGamePaused: () => paused,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v, getRoomNameDatabase: () => db, setRoomNameDatabase: v => db = v,
    getCombatCharactersString: () => roster, setCombatCharactersString: v => roster = v, getRoomDungeonForSimulation: () => dungeon };
  const actor = name => Life.actors(text).find(a => a.name === name);
  const injure = (name, natural = 1) => { const data = JSON.parse(db), a = actor(name); Life.apply(data, run, a, 0, natural, { geoKey: '0,0,0', damage: 10 }); Life.commit(state, data); return actor(name); };
  return { state, actor, injure, dungeon, pause: () => paused = true, newRun: () => run = 'new-run', life: () => JSON.parse(db)['0,0,0'].combatLife };
}
test('automatic survival saves distinguish stable unconsciousness from dying, without premature death or loot', () => {
  for (const natural of [1, 11, 12, 20]) {
    const f = fixture(), ally = f.injure('Ally', natural);
    assert.equal(ally.hp, 0); assert.equal(ally.state, natural >= 12 ? 'Unconscious' : 'Dying');
    assert.equal(I.isAlive(ally), true); assert.equal(I.canAct(ally), false);
    assert.equal(Life.survivalPlan(ally).player, false);
    assert.equal(f.life().rescuesUsed, undefined);
  }
});
test('dying characters die only after two subsequent rounds, and paused time never advances injuries', () => {
  const f = fixture(); f.injure('Ally'); Life.advance(f.state);
  assert.equal(f.actor('Ally').state, 'Dying'); assert.equal(f.life().actors.ally.remaining, 1);
  Life.advance(f.state); assert.equal(f.actor('Ally').state, 'Dead');
  assert.deepEqual(Life.claimDeaths(f.state).map(a => a.name), ['Ally']); assert.deepEqual(Life.claimDeaths(f.state), []);
  const paused = fixture(); paused.injure('Ally'); paused.pause(); Life.advance(paused.state);
  assert.equal(paused.life().clock, 0); assert.equal(paused.actor('Ally').state, 'Dying');
});
test('bandaging is adjacent, turn-consuming, idempotent and stabilizes without restoring HP', () => {
  const f = fixture(); f.injure('Ally');
  const request = { runId: 'life-run', geoKey: '0,0,0', actor: 'PC', target: 'Ally', kind: 'bandage', nonce: 'first-aid:123' };
  const result = Life.care(f.state, request); assert.ok(!result.error, result.error);
  assert.equal(f.actor('Ally').state, 'Unconscious'); assert.equal(f.actor('Ally').hp, 0);
  assert.equal(Life.care(f.state, request).duplicate, true);
  assert.ok(Life.care(f.state, { ...request, target: 'Enemy' }).error);
  Life.advance(f.state); assert.equal(f.actor('Ally').hp, 0);
  Life.advance(f.state); assert.equal(f.actor('Ally').hp, 1, 'Stable characters eventually recover instead of soft-locking a solo PC');
});
test('first aid cannot be performed from afar, through walls, by a downed actor or on a hostile', () => {
  const f = fixture(); f.injure('Ally');
  f.dungeon.cells['3,2'].tile = 'wall'; assert.equal(Life.careChoices(f.state, 'PC').length, 0);
  f.dungeon.cells['3,2'].tile = 'floor'; assert.ok(Life.careChoices(f.state, 'PC').some(c => c.kind === 'bandage'));
  f.injure('PC'); assert.equal(Life.careChoices(f.state, 'PC').length, 0);
});
test('healing potions wake unconscious and dying allies, consume one copy and cancel their countdown', () => {
  for (const save of [1, 20]) {
    const f = fixture(); f.injure('Ally', save);
    const potion = { name: 'healing potion 3 hp', type: 'other', consumable_kind: 'healing', magic: 3 };
    f.state.setUpdatedGameConsole(E.write(E.write(f.state.getUpdatedGameConsole(), 'Inventory', potion.name + ', ' + potion.name), 'Inventory Properties', JSON.stringify(potion)));
    const result = Life.care(f.state, { runId: 'life-run', geoKey: '0,0,0', actor: 'PC', target: 'Ally', kind: 'drink', item: potion.name, nonce: 'potion-aid:123' });
    assert.ok(!result.error, result.error); assert.equal(f.actor('Ally').hp, 3); assert.equal(f.actor('Ally').state, 'Friendly');
    assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), potion.name);
    Life.advance(f.state); Life.advance(f.state); assert.equal(f.actor('Ally').hp, 3);
  }
});
test('divine rescues preserve two allowances, use different patrons and permanently end the third death', () => {
  for (const [name, patron] of [['PC', 'Mortacia'], ['Mortacia', 'Dyanetzia']]) {
    const f = fixture(name);
    for (let i = 1; i <= 3; i++) {
      f.injure(name, 1);
      if (name !== 'Mortacia') { Life.advance(f.state); Life.advance(f.state); }
      if (i <= 2) {
        assert.equal(f.actor(name).hp, 10); assert.equal(f.life().rescuesUsed, i); assert.match(f.life().message, new RegExp(patron));
        Life.commit(f.state, JSON.parse(f.state.getRoomNameDatabase())); assert.equal(f.life().rescuesUsed, i);
      } else {
        assert.ok(Life.status(f.state).gameOver); assert.equal(f.actor(name).state, 'Dead'); assert.equal(f.life().rescuesUsed, 2);
        assert.match(f.life().gameOver.reason, name === 'Mortacia' ? /Dantuea and Arithus/ : /another chosen/);
      }
    }
    f.newRun(); assert.equal(Life.status(f.state).gameOver, null);
  }
});
test('injuries and divine rescue limits cannot be undone through stale console, roster or database snapshots', () => {
  const f = fixture('Mortacia'), old = f.state.getUpdatedGameConsole(), roster = f.state.getCombatCharactersString();
  f.injure('Ally'); f.injure('Mortacia');
  const protectedState = Life.preserve(f.state, old, '{}', roster);
  assert.equal(Life.actors(protectedState.text).find(a => a.name === 'Ally').state, 'Dying');
  assert.equal(JSON.parse(protectedState.roster).find(a => a.name === 'Ally').hp, 0);
  assert.equal(JSON.parse(protectedState.database)['0,0,0'].combatLife.rescuesUsed, 1);
});
test('saving bonuses use diminished casting level for Mortacia, not her divine level fifty', () => {
  assert.equal(Life.saveBonus({ className: 'Assassin-Fighter-Necromancer-Goddess', level: 50 }), 0);
  assert.equal(Life.saveBonus({ className: 'Wizard', level: 20 }), 5);
});

test('actual care routes list verified aid choices, charge one turn and do not consume the same potion twice', async t => {
  const f = fixture(), express = require('express'), fs = require('node:fs'), vm = require('node:vm');
  f.injure('Ally');
  const potion = { name: 'healing potion 3 hp', type: 'other', consumable_kind: 'healing', magic: 3 };
  f.state.setUpdatedGameConsole(E.write(E.write(f.state.getUpdatedGameConsole(), 'Inventory', potion.name), 'Inventory Properties', JSON.stringify(potion)));
  const app = express(), events = [], source = fs.readFileSync('server.js', 'utf8'); app.use(express.json());
  const ctx = { app, CombatLife: Life, SpellSystem: S, sharedState: f.state, inputTaskInFlight: false, broadcast: e => events.push(e),
    prepareQuestScene: req => req.body.runId === 'life-run' && req.body.geoKey === '0,0,0' && !ctx.inputTaskInFlight ? {} : { status: 409, error: 'Stale aid.' },
    spellStateEvent: (geoKey, result) => ({ ...result, geoKey, updatedGameConsole: f.state.getUpdatedGameConsole() }) };
  vm.runInNewContext(source.slice(source.indexOf("app.post('/combat/care/view'"), source.indexOf("app.post('/economy/view'")), ctx);
  const listener = app.listen(0, '127.0.0.1'); await new Promise(resolve => listener.once('listening', resolve));
  t.after(async () => { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); });
  const post = async (path, body) => { const res = await fetch(`http://127.0.0.1:${listener.address().port}` + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
  const origin = { runId: 'life-run', geoKey: '0,0,0' };
  const view = await post('/combat/care/view', origin); assert.ok(view.body.care.some(c => c.kind === 'bandage' && c.actor === 'PC'));
  const request = { ...origin, actor: 'PC', target: 'Ally', kind: 'drink', item: potion.name, nonce: 'aid-route:123' };
  assert.equal((await post('/combat/care', request)).status, 200); assert.equal(f.life().clock, 1); assert.equal(f.actor('Ally').hp, 3);
  assert.equal((await post('/combat/care', request)).body.duplicate, true); assert.equal(f.life().clock, 1);
  assert.equal((await post('/combat/care', { ...request, target: 'Enemy' })).status, 409); assert.equal(ctx.inputTaskInFlight, false);
  const wait = { ...origin, nonce: 'wait-route:123' };
  assert.equal((await post('/combat/wait', wait)).status, 200); assert.equal(f.life().clock, 2);
  assert.equal((await post('/combat/wait', wait)).body.duplicate, true); assert.equal(f.life().clock, 2);
  assert.equal((await post('/combat/wait', origin)).status, 409); assert.equal(f.life().clock, 2);
});

test('laid-down billboard pixels retain the silhouette, touch the ground and do not mutate the original sprite', () => {
  const fs = require('node:fs'), vm = require('node:vm'), root = {};
  vm.runInNewContext(fs.readFileSync('assets/combatLifeUi.js', 'utf8'), { window: root });
  const pix = { w: 8, h: 8, bounds: { minX: 2, maxX: 3, minY: 1, maxY: 6 }, data: new Uint8Array(8 * 8 * 4) };
  for (let y = 1; y <= 6; y++) for (let x = 2; x <= 3; x++) pix.data[(y * 8 + x) * 4 + 3] = 255;
  const before = pix.data.slice(), down = root.CombatLifeUi.laidDownPixels(pix);
  assert.deepEqual(pix.data, before); assert.equal(down.bounds.maxY, 7); assert.equal(down.bounds.maxX - down.bounds.minX, 5);
  assert.equal(down.data.filter((n, i) => i % 4 === 3 && n > 0).length, 12);
});
