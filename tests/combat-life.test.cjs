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

test('hostile defeats award and log XP once across unconsciousness, healing, repeat defeat and later death', () => {
  for (const save of [1, 20]) {
    const f = fixture(), notices = [];
    f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace(/(Monsters in Room:[\s\S]*?State: )Friendly/, '$1Hostile'));
    f.state.emitter.on('combat_life_action', n => notices.push(n));
    const before = f.actor('PC').xp;
    f.injure('Enemy', save);
    const reward = f.life().defeatXP[0];
    assert.ok(reward.total >= 1000 && reward.total <= 1500);
    assert.equal(f.actor('PC').xp, before + Math.floor(reward.total/2));
    assert.match(notices.find(n => n.kind === 'defeat-xp').message, /party earns \d+ XP.*PC: \+\d+ XP.*Ally: \+\d+ XP/);
    Life.commit(f.state, JSON.parse(f.state.getRoomNameDatabase()));
    let db = JSON.parse(f.state.getRoomNameDatabase());
    Life.apply(db, 'life-run', f.actor('Enemy'), 10, null, { geoKey: '0,0,0' }); Life.commit(f.state, db);
    f.injure('Enemy', save); Life.advance(f.state); Life.advance(f.state);
    assert.equal(f.actor('PC').xp, before + Math.floor(reward.total/2));
    assert.equal(notices.filter(n => n.kind === 'defeat-xp').length, 1);
    const stale = f.state.getUpdatedGameConsole().replace(/(PC:[\s\S]*?XP:)\s*\d+/, '$1 0');
    assert.equal(Life.actors(Life.preserve(f.state, stale).text).find(a => a.name === 'PC').xp, f.actor('PC').xp);
  }
});

test('neutral defeats never grant hostile XP', () => {
  const f = fixture(); f.injure('Enemy',20);
  assert.equal(f.life().defeatXP, undefined);
});

test('natural recovery waits through all combat rounds and ten post-combat turns; healing still wakes during combat', () => {
  const f = fixture(); Life.beginCombat(f.state); f.injure('Enemy',20);
  for(let i=0;i<30;i++) Life.advance(f.state);
  assert.equal(f.actor('Enemy').hp,0);
  Life.settle(f.state);
  for(let i=1;i<Life.RECOVERY_TURNS;i++) { Life.advance(f.state); Life.settle(f.state); assert.equal(f.actor('Enemy').hp,0); }
  Life.advance(f.state); assert.equal(f.actor('Enemy').hp,1);
  Life.beginCombat(f.state); f.injure('Ally',20);
  const db=JSON.parse(f.state.getRoomNameDatabase());
  Life.apply(db,'life-run',f.actor('Ally'),5,null,{geoKey:'0,0,0'}); Life.commit(f.state,db);
  assert.equal(f.actor('Ally').hp,5); assert.equal(f.actor('Ally').state,'Friendly');
});

test('legacy unconscious timers and a new fight cannot cause premature natural recovery', () => {
  const f=fixture(); f.injure('Enemy',20);
  let db=JSON.parse(f.state.getRoomNameDatabase());
  db['0,0,0'].combatLife.actors.enemy.recoverAt=0; delete db['0,0,0'].combatLife.actors.enemy.recoveryVersion;
  f.state.setRoomNameDatabase(JSON.stringify(db)); Life.advance(f.state);
  assert.equal(f.actor('Enemy').hp,0);
  Life.beginCombat(f.state); for(let i=0;i<20;i++) Life.advance(f.state);
  assert.equal(f.actor('Enemy').hp,0); Life.settle(f.state);
  assert.equal(f.life().actors.enemy.recoverAt,f.life().clock+Life.RECOVERY_TURNS);
});

test('monster defeat evidence survives healing and recovery but cannot cross rooms or adventures', () => {
  const Defeats=require('../retort/questDefeatEvidence'),f=fixture();
  f.injure('Enemy',20);
  const before=JSON.stringify(Defeats.evidence(JSON.parse(f.state.getRoomNameDatabase()),'0,0,0','Enemy'));
  assert.notEqual(before,undefined);
  Life.advance(f.state);Life.advance(f.state);
  const db=JSON.parse(f.state.getRoomNameDatabase());Life.apply(db,'life-run',f.actor('Enemy'),10,null,{geoKey:'0,0,0'});Life.commit(f.state,db);
  const saved=JSON.parse(f.state.getRoomNameDatabase());assert.equal(JSON.stringify(Defeats.evidence(saved,'0,0,0','Enemy')),before);
  assert.equal(Defeats.evidence(saved,'1,0,0','Enemy'),null);
  saved['0,0,0'].combatLife.runId='different-run';assert.equal(Defeats.evidence(saved,'0,0,0','Enemy'),null);
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
  for (let i=1;i<Life.RECOVERY_TURNS;i++) { Life.advance(f.state); assert.equal(f.actor('Ally').hp, 0); }
  Life.advance(f.state); assert.equal(f.actor('Ally').hp, 1, 'Stable characters eventually recover instead of soft-locking a solo PC');
});

test('survival, countdown, aid and death publish committed outcomes exactly once, with no invented bandaging roll', () => {
  const f = fixture(), events = []; f.state.emitter.on('combat_life_action', notice => events.push(notice));
  f.injure('Ally');
  assert.equal(events.length, 1); assert.equal(events[0].roll, 1);
  assert.match(events[0].message, /d20 1.*vs 12.*2 rounds/);
  assert.equal(Life.status(f.state).injuries[0].remaining, 2);
  Life.commit(f.state, JSON.parse(f.state.getRoomNameDatabase()));
  assert.equal(events.length, 1, 'A repaint is not another survival roll');
  for (let i = 0; i < 10; i++) { Life.status(f.state); Life.careChoices(f.state, 'PC'); }
  assert.equal(f.life().clock, 0, 'Reading aid options and status consumes no turn');
  Life.advance(f.state); assert.equal(events.at(-1).kind, 'dying-warning');
  assert.equal(Life.status(f.state).injuries[0].remaining, 1);
  const input = { runId: 'life-run', geoKey: '0,0,0', actor: 'PC', target: 'Ally', kind: 'bandage', nonce: 'last-chance:aid' };
  assert.ok(!Life.care(f.state, input).error); assert.equal(events.at(-1).kind, 'first-aid');
  assert.match(events.at(-1).message, /bandages Ally.*countdown has stopped/);
  assert.equal(events.at(-1).roll, undefined);
  const count = events.length; Life.care(f.state, input); assert.equal(events.length, count);
  for(let i=0;i<Life.RECOVERY_TURNS;i++) Life.advance(f.state); assert.equal(f.actor('Ally').state, 'Friendly');

  const dying = fixture(), deaths = []; dying.state.emitter.on('combat_life_action', notice => deaths.push(notice));
  dying.injure('Ally'); Life.advance(dying.state); Life.advance(dying.state); Life.advance(dying.state);
  assert.equal(deaths.filter(n => n.kind === 'injury-death').length, 1);
  assert.match(deaths.find(n => n.kind === 'injury-death').message, /aid window expired/);
});

test('life announcements reach both the Game Log and existing on-screen action subtitles', () => {
  const fs = require('node:fs'), vm = require('node:vm'), events = [];
  const source = fs.readFileSync('server.js', 'utf8');
  const start = source.indexOf("sharedState.emitter.on('combat_life_action'");
  const end = source.indexOf("require('./retort/campaignPlanningLog')", start);
  const state = { emitter: new EventEmitter(), getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getDungeonRunId: () => 'life-run' };
  vm.runInNewContext(source.slice(start, end), { sharedState: state, console: { info() {} }, broadcast: e => events.push(e),
    require: name => { assert.equal(name, './assets/actionFeedback'); return require('../assets/actionFeedback'); } });
  state.emitter.emit('combat_life_action', { kind: 'first-aid', title: 'Ally', message: 'PC bandages Ally. Stable at 0 HP.', result: 'success' });
  assert.equal(events[0].type, 'combat_log'); assert.match(events[0].log, /bandages Ally/);
  assert.equal(events[1].type, 'action_notice'); assert.equal(events[1].kind, 'first-aid');
  assert.equal(events[1].runId, 'life-run'); assert.equal(events[1].geoKey, '0,0,0');
});
test('first aid cannot be performed from afar, through walls or by a downed actor', () => {
  const f = fixture(); f.injure('Ally');
  f.dungeon.cells['3,2'].tile = 'wall'; assert.equal(Life.careChoices(f.state, 'PC').length, 0);
  f.dungeon.cells['3,2'].tile = 'floor'; assert.ok(Life.careChoices(f.state, 'PC').some(c => c.kind === 'bandage'));
  f.injure('PC'); assert.equal(Life.careChoices(f.state, 'PC').length, 0);
});

test('deliberate mercy stabilizes a dying opponent as Neutral, but automated aid stays team-only', () => {
  const f = fixture();
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace(/(Monsters in Room:[\s\S]*?State: )Friendly/, '$1Hostile'));
  const roster = JSON.parse(f.state.getCombatCharactersString());
  Object.assign(roster.find(a => a.name === 'Enemy'), { mazeX: 3, mazeY: 3, allegiance: 'Hostile', pursuit: { target: 'PC' } });
  f.state.setCombatCharactersString(JSON.stringify(roster)); f.injure('Enemy');
  assert.ok(Life.careChoices(f.state, 'PC').some(c => c.target === 'Enemy' && c.kind === 'bandage'));
  assert.ok(!Life.careChoices(f.state, 'PC', { mercy: false }).some(c => c.target === 'Enemy'));
  const input = { runId: 'life-run', geoKey: '0,0,0', actor: 'PC', target: 'Enemy', kind: 'bandage', nonce: 'mercy-bandage:123' };
  const result = Life.care(f.state, input);
  assert.ok(!result.error, result.error); assert.equal(result.allegiance, 'Neutral');
  assert.equal(f.actor('Enemy').state, 'Unconscious');
  assert.equal(f.life().actors.enemy.allegiance, 'Neutral'); assert.equal(f.life().actors.enemy.remaining, undefined);
  assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a => a.name === 'Enemy').allegiance, 'Neutral');
  assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a => a.name === 'Enemy').pursuit, undefined);
  assert.deepEqual(Life.claimDeaths(f.state), []);
  for(let i=0;i<Life.RECOVERY_TURNS;i++) Life.advance(f.state);
  assert.equal(f.actor('Enemy').state, 'Neutral'); assert.equal(f.actor('Enemy').type, 'monster');
  assert.equal(Life.care(f.state, input).duplicate, true);
});

test('bandaging a legacy dying sheet never fabricates a new survival throw', () => {
  const f = fixture(), notices = [];
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace(/(NPCs in Party:[\s\S]*?HP: )10/, (_, prefix) => prefix + '0')
    .replace(/(NPCs in Party:[\s\S]*?State: )Friendly/, '$1Dying'));
  f.state.emitter.on('combat_life_action', n => notices.push(n));
  const result = Life.care(f.state, { runId: 'life-run', geoKey: '0,0,0', actor: 'PC', target: 'Ally', kind: 'bandage', nonce: 'legacy-care:123' });
  assert.ok(!result.error, result.error); assert.equal(f.actor('Ally').state, 'Unconscious');
  assert.equal(f.life().actors.ally.save, undefined);
  assert.deepEqual(notices.map(n => n.kind), ['first-aid']);
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
