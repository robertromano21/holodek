'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { ActionDice } = require('../retort/actionDice');
const { createCombatSpace } = require('../retort/dungeonReach');
const Flow = require('../retort/combatTurnFlow'), I = require('../assets/dungeonInhabitants');
const ActionFeedback = require('../assets/actionFeedback');
const SpellSystem = require('../retort/spellSystem');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8');
const combat = source.slice(source.indexOf('let combatSpace = null;'), source.indexOf('// Global variable to hold the current situation'));
function fixture({ retreatRound = 1, lethal = false, spell = false, turning = false, tactical = false, life = false, aid = false } = {}) {
  const d = { geoKey: '1,0,0', start: { x: 4, y: 4 }, layout: { width: 24, height: 24 }, cells: {} };
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) d.cells[`${x},${y}`] = { tile: 'floor' };
  const names = ['Guard', 'Guard 2', 'Far Guard'], p = I.createPopulation(d.geoKey, names.map(name => ({ name, allegiance: 'Hostile', encounterId: name === 'Far Guard' ? 'remote' : 'guards' })));
  const row = (Name, HP = 1000) => formatStartingCharacterSheet({ Name, Sex: 'Female', Race: 'Human', Class: 'Fighter',
    Level: 1, HP, MaxHP: HP, AC: 10, Attack: 1, Damage: 0 });
  let text = `Coordinates: X: 1, Y: 0, Z: 0\nPC:\n${row('PC')}\nNPCs in Party:\n${row('Companion', lethal ? 2 : 1000)}\nMonsters in Room:\n${names.map(n => row(n)).join('\n')}\nMonsters Equipped Properties: None\nMonsters State: Hostile\nRooms Visited: 2`;
  let wire = JSON.stringify([['PC', 'pc', 4, 4], ['Companion', 'npc', 4, 5], ['Guard', 'monster', 5, 4],
    ['Guard 2', 'monster', 5, 6], ['Far Guard', 'monster', 20, 20]].map(([name, type, mazeX, mazeY]) =>
    ({ name, type, hp: name === 'Companion' && lethal ? 2 : 1000, mazeX, mazeY, x: mazeX, y: mazeY, mazeRoomKey: d.geoKey })));
  let database = JSON.stringify({ '0,0,0': {}, '1,0,0': { name: 'Hall', inhabitants: p } });
  if (spell || turning) {
    const scroll = SpellSystem.Rules.scroll(turning ? 'turn_undead' : 'missile', 'test');
    text = SpellSystem.changeActor(text, 'PC', s => SpellSystem.stat(s.replace('Other: None', 'Other: scroll of force'), 'Magic', scroll.magic));
    if (turning) {
      text = SpellSystem.changeActor(text, 'PC', s => SpellSystem.stat(s, 'Level', 7));
      text = SpellSystem.changeActor(text, 'Guard', s => s.replace('Human', 'Wraith'));
    }
    text += '\nParty Equipped Properties: ' + JSON.stringify({ ...scroll, name: 'scroll of force', owner: 'PC', slot: 'Other' });
    text = I.withStates(text, p);
  }
  const emitter = new EventEmitter(), events = [];
  const dice = new ActionDice({ random: sides => turning ? 1 : sides, animationMs: 0 });
  const state = { emitter, getLastCoords: () => ({ x: 1, y: 0, z: 0 }), getRoomDungeon: () => d,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: value => text = value,
    getCombatCharactersString: () => wire, setCombatCharactersString: value => wire = value,
    getRoomPopulation: () => p, getDungeonRunId: () => 'run' };
  if (spell || turning || life) Object.assign(state, { getRoomNameDatabase: () => database, setRoomNameDatabase: v => database = v, getRoomDungeonForSimulation: () => d });
  if (aid) {
    const Life = require('../retort/combatLife'), db = JSON.parse(database), ally = Life.actors(text).find(a => a.name === 'Companion');
    Life.apply(db, 'run', ally, 0, 1, { geoKey: d.geoKey, damage: 1000 }); Life.commit(state, db);
  }
  const broadcast = event => {
    events.push(event);
    if (event.type === 'dice_state' && event.pending) setImmediate(() => dice.submit(event.pending.id, event.pending.actionId, event.pending.geoKey));
    if (event.type === 'target_prompt' && aid && event.round === 1 && event.combatant === 'PC') {
      const care = event.care.find(c => c.kind === 'bandage' && c.target === 'Companion');
      setImmediate(() => emitter.emit('target_response_PC', { actionId: event.actionId, turnId: event.turnId, action: 'care', ...care }));
    } else if (event.type === 'target_prompt' && tactical && event.round === 1 && event.combatant === 'PC') {
      setImmediate(async () => {
        await dice.moveCombatant({ actionId: event.actionId, turnId: event.turnId, combatant: 'PC', runId: 'run', geoKey: d.geoKey,
          revision: event.movement.revision, x: 4, y: 3 });
        emitter.emit('target_response_PC', { actionId: event.actionId, turnId: event.turnId, action: 'hold', cancelled: true });
      });
    } else if (event.type === 'target_prompt') setImmediate(() => emitter.emit(`target_response_${event.combatant}`,
      { actionId: event.actionId, turnId: event.turnId, action: (spell || turning) && event.combatant === 'PC' && event.round === 1 ? 'cast' : event.allowRetreat && event.round >= retreatRound ? 'retreat' : 'attack', target: 'Guard',
        itemId: event.spells?.find(s => s.target === 'Guard')?.itemId, spellId: turning ? 'turn_undead' : 'missile' }));
  };
  const context = { CombatTurnFlow: Flow, Inhabitants: I, ActionFeedback, actionDice: dice, createCombatSpace, sharedState: state,
    SpellSystem, require,
    populationService: { get: () => p, recordPositions() {}, save() {} }, broadcast,
    console: { log() {}, info() {}, warn() {} }, updatedGameConsole: text, characterClasses: [{ name: 'Fighter', baseHP: 3 }],
    ensureSelectedPCSprite() {}, allocateXP() {}, dropMonsterItemsToRoom() {}, getRandomInt: () => 1000, updateCombatMap() {},
    getDelayedUpdatedGameConsole: async () => text, Math: Object.assign(Object.create(Math), { random: () => 0 }),
    setTimeout: (fn, ms) => setTimeout(fn, ms === 200 ? 0 : ms), clearTimeout, setInterval, clearInterval };
  if (tactical) Object.assign(context, { CombatTactics: require('../retort/combatTactics'), EquipmentRules: require('../assets/equipmentRules') });
  if (life) context.CombatLife = require('../retort/combatLife');
  vm.runInNewContext(combat, context);
  return { context, events, dice, p, state, d };
}
for (const mode of ['Combat Map-Based', 'Interactive Map-Based', 'No Combat Map']) {
  test(`${mode}: fatal damage visibly rolls Survival Save and retreat carries a stable unconscious companion`, async () => {
    const f = fixture({ life: true, lethal: true });
    const result = await f.context.handleCombatRound({}, 'attack Guard', mode);
    assert.equal(result.retreated, true);
    assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(), 'NPCs in Party')[0].state, 'Unconscious');
    assert.ok(f.events.some(e => e.type === 'dice_state' && e.results.some(r => r.actor === 'Companion' && r.label === 'Survival Save')));
    assert.ok(f.events.some(e => e.type === 'combat_maze_step' && e.character === 'Companion'));
    assert.ok(JSON.parse(f.state.getCombatCharactersString()).some(a => a.name === 'Companion' && a.hp === 0));
  });
  test(`${mode}: selecting Bandage consumes exactly one initiative action and cannot also attack`, async () => {
    const f = fixture({ life: true, aid: true, retreatRound: 2 });
    const result = await f.context.handleCombatRound({}, 'attack Guard', mode);
    assert.equal(result.retreated, true); assert.match(result.combatLog, /PC bandages Companion/);
    assert.ok(!f.events.some(e => e.type === 'dice_state' && e.results.some(r => r.actor === 'PC' && r.label === 'Attack')));
    assert.notEqual(I.parseSheets(f.state.getUpdatedGameConsole(), 'NPCs in Party')[0].state, 'Dead');
  });
  test(`${mode}: actual player tile movement retains initiative, persists and End Turn never attacks`, async () => {
    const f = fixture({ tactical: true, retreatRound: 2 });
    const result = await f.context.handleCombatRound({}, 'attack Guard', mode);
    assert.match(result.combatLog, /PC ends the turn in place/);
    const steps = f.events.filter(e => e.type === 'combat_maze_step' && e.character === 'PC');
    assert.equal(steps[0].x, 4); assert.equal(steps[0].y, 3);
    assert.ok(f.events.some(e => e.type === 'dice_state' && e.active?.turn?.movement?.remaining === 5));
    assert.ok(!f.events.some(e => e.type === 'dice_state' && e.results?.some(r => r.actor === 'PC' && r.label === 'Attack')));
    assert.equal(f.dice.moveCombatant, undefined);
    assert.equal(result.retreated, true);
  });
  test(`${mode}: a turned undead withdraws in actual maze space and loses its action without losing HP`, async () => {
    const f = fixture({ turning: true, retreatRound: 2 }), result = await f.context.handleCombatRound({}, 'attack Guard', mode);
    assert.equal(result.retreated, true); assert.match(result.combatLog, /Guard is turned and withdraws 2 tiles instead of acting/);
    assert.ok(f.events.some(e => e.type === 'combat_maze_step' && e.character === 'Guard' && e.x > 5));
    assert.equal(f.events.some(e => e.type === 'dice_state' && e.results.some(r => r.actor === 'Guard' && r.label === 'Attack')), false);
    assert.equal(I.parseSheets(f.state.getUpdatedGameConsole()).find(a => a.name === 'Guard').hp, 1000);
    assert.ok(f.events.some(e => e.type === 'dice_state' && e.results.some(r => r.actor === 'Guard' && r.label === 'Spell Save')));
  });
  test(`${mode}: spell dice are visible, scrolls ash, live HP changes and casting does not also attack`, async () => {
    const f = fixture({ spell: true, retreatRound: 2 }), result = await f.context.handleCombatRound({}, 'attack Guard', mode);
    assert.equal(result.retreated, true); assert.match(result.combatLog, /casts Magic Missile/);
    const casts = f.events.filter(e => e.type === 'spell_cast'); assert.equal(casts.length, 1); assert.equal(casts[0].ash, true);
    assert.ok(f.events.some(e => e.type === 'dice_state' && e.results.some(r => r.actor === 'PC' && r.label === 'Spell Damage')));
    assert.ok(!f.events.some(e => e.type === 'dice_state' && e.results.some(r => r.actor === 'PC' && r.label === 'Attack')));
    assert.ok(f.events.some(e => e.type === 'combat_health' && I.parseSheets(e.updatedGameConsole).some(a => a.name === 'Guard' && a.hp === 995)));
    assert.equal(I.parseEquipment(I.parseSheets(f.state.getUpdatedGameConsole(), 'PC')[0].lines[9]).Other, 'None');
  });
  test(`${mode}: visible automatic initiative precedes a whole-party retreat with one free shot per in-range hostile`, async () => {
    const f = fixture(), result = await f.context.handleCombatRound({}, 'attack Guard', mode);
    assert.equal(result.retreated, true);
    const pending = f.events.filter(e => e.type === 'dice_state' && e.pending);
    assert.equal(pending.some(e => e.pending.label === 'Initiative'), false);
    assert.ok(f.events.some(e => e.type === 'dice_state' && e.results.some(r => r.label === 'Initiative' && r.actor === 'PC')));
    const prompt = f.events.find(e => e.type === 'target_prompt');
    assert.ok(prompt.allowRetreat && prompt.turnId); assert.equal(prompt.round, 1);
    const rolls = f.dice.snapshot().results;
    assert.deepEqual(rolls.filter(r => r.label === 'Retreat Attack').map(r => [r.actor, r.target]), [['Guard', 'PC'], ['Guard 2', 'Companion']]);
    assert.equal(rolls.some(r => r.actor === 'Far Guard'), false);
    assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(), 'PC')[0].hp, 997);
    assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(), 'NPCs in Party')[0].hp, 997);
    const health = f.events.filter(e => e.type === 'combat_health');
    assert.ok(health.some(e => I.parseSheets(e.updatedGameConsole, 'PC')[0].hp === 997));
    assert.ok(health.some(e => I.parseSheets(e.updatedGameConsole, 'NPCs in Party')[0].hp === 997));
    assert.ok(health.every(e => e.actionId === prompt.actionId), 'Live health must not start another action.');
    assert.ok(f.events.some(e => e.type === 'combat_maze_step' && e.character === 'PC'));
    assert.ok(f.events.some(e => e.type === 'combat_maze_step' && e.character === 'Companion'));
    assert.equal(f.dice.active, null); assert.ok(f.p.retreatUntil > Date.now());
  });
}
test('successive rounds keep one action lock, reroll PC initiative, and reject old turn IDs', async () => {
  const f = fixture({ retreatRound: 2 }), result = await f.context.handleCombatRound({}, 'attack Guard', 'Combat Map-Based');
  assert.equal(result.retreated, true);
  const states = f.events.filter(e => e.type === 'dice_state');
  assert.equal(states.filter(e => !e.active).length, 1, 'The lock is released only after the party retreats');
  const prompts = f.events.filter(e => e.type === 'target_prompt' && e.allowRetreat);
  assert.deepEqual(prompts.map(e => e.round), [1, 2]); assert.notEqual(prompts[0].turnId, prompts[1].turnId);
  assert.equal(new Set(states.filter(e => e.active).map(e => e.active.id)).size, 1);
  const initiatives = new Set(f.events.flatMap(e => (e.results || []).filter(r => r.label === 'Initiative' && r.actor === 'PC').map(r => r.id)));
  assert.equal(initiatives.size, 2);
});

test('turning withdrawal never moves through walls, closed doors or occupied cells and cowers if surrounded', () => {
  const f = fixture(), roster = JSON.parse(f.state.getCombatCharactersString()), space = createCombatSpace(f.d, roster, f.d.geoKey);
  const guard = roster.find(a => a.name === 'Guard'), pc = roster[0];
  f.d.cells['6,4'].tile = 'wall'; f.d.cells['5,3'] = { tile: 'door', door: { isOpen: false } };
  f.d.cells['5,5'].tile = 'wall';
  assert.deepEqual(Flow.turnPath(space, guard, pc, roster), []);
  f.d.cells['6,4'].tile = 'floor';
  roster.push({ name: 'Blocker', hp: 10, mazeX: 6, mazeY: 4, mazeRoomKey: f.d.geoKey });
  const blocked = createCombatSpace(f.d, roster, f.d.geoKey); assert.deepEqual(Flow.turnPath(blocked, guard, pc, roster), []);
  roster.pop(); assert.deepEqual(Flow.turnPath(space, guard, pc, roster), [{ x: 6, y: 4 }, { x: 7, y: 4 }]);
});
test('opportunity attacks exclude out-of-range, occluded, dead and non-party targets after every strike', () => {
  const f = fixture(), roster = JSON.parse(f.state.getCombatCharactersString()), space = createCombatSpace(f.d, roster, f.d.geoKey);
  const attacker = { ...roster[2], state: 'Hostile' }, party = roster.slice(0, 2);
  assert.deepEqual(Flow.opportunityTargets(attacker, party, space).map(a => a.name), ['PC', 'Companion']);
  f.d.cells['5,4'].tile = 'wall';
  assert.equal(Flow.opportunityTargets(attacker, party, space).length, 0);
  f.d.cells['5,4'].tile = 'floor'; party[0].hp = 0;
  assert.deepEqual(Flow.opportunityTargets(attacker, party, space).map(a => a.name), ['Companion']);
  attacker.hp = 0; assert.equal(Flow.opportunityTargets(attacker, party, space).length, 0);
});
test('retreat can kill a companion without reviving them or awarding monster XP', async () => {
  const f = fixture({ lethal: true }), result = await f.context.handleCombatRound({}, 'attack Guard', 'Combat Map-Based');
  assert.equal(result.retreated, true);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(), 'NPCs in Party')[0].hp, -1);
  const kills = f.events.filter(e => e.type === 'action_notice' && e.kind === 'defeat');
  assert.equal(kills.length, 1); assert.equal(kills[0].subject, 'Companion');
  assert.equal(f.events.some(e => e.type === 'combat_maze_step' && e.character === 'Companion'), false);
});

test('ending a long fight refreshes pursuit from actual positions without changing combat reach', async () => {
  const f = fixture();
  f.context.HostilePursuit = require('../retort/hostilePursuit');
  const guard = f.p.actors.Guard;
  guard.position = { x: 5, y: 4 }; guard.pursuit = { willing: true, active: true, remainingRooms: 2, lastSeenAt: Date.now() - 60000 };
  await f.context.handleCombatRound({}, 'attack Guard', 'Combat Map-Based');
  assert.equal(guard.pursuit.active, true);
  assert.ok(guard.pursuit.lastSeenAt > Date.now() - 1000);
  assert.equal(guard.pursuit.targetRoom, f.d.geoKey);
});

function targetRoute() {
  const server = fs.readFileSync('server.js', 'utf8');
  const body = server.slice(server.indexOf("app.post('/submit-target2',"), server.indexOf('const tasks = new Map();'));
  const emitter = new EventEmitter(), events = []; let handler, paused = false;
  const dice = { active: { kind: 'combat', id: 'battle', turn: { turnId: 'turn-2', combatant: 'PC', targets: ['Guard'], allowRetreat: true } } };
  emitter.on('target_response_PC', event => events.push(event));
  emitter.on('target_response_Companion', event => events.push(event));
  vm.runInNewContext(body, { app: { post: (url, fn) => { if (url === '/submit-target2') handler = fn; } }, actionDice: dice,
    sharedState: { emitter, getGamePaused: () => paused }, console: { log() {} } });
  return { dice, events, pause: value => { paused = value; }, post(overrides = {}) {
    let status = 200, payload;
    const res = { status(value) { status = value; return this; }, json(value) { payload = value; return this; } };
    handler({ body: { actionId: 'battle', turnId: 'turn-2', combatant: 'PC', action: 'attack', target: 'Guard', ...overrides } }, res);
    return { status, payload };
  } };
}
test('the real target endpoint rejects stale turns, actors, targets, unknown actions and paused choices', () => {
  const f = targetRoute();
  for (const invalid of [{ actionId: 'old-battle' }, { turnId: 'turn-1' }, { combatant: 'Companion' },
    { target: 'Absent Guard' }, { action: 'invented' }, { cancelled: true }]) {
    assert.equal(f.post(invalid).status, 409);
  }
  f.pause(true); assert.equal(f.post().status, 409); f.pause(false);
  assert.equal(f.events.length, 0);
  assert.equal(f.post().status, 200);
  assert.equal(f.post({ action: 'retreat', target: undefined }).status, 200);
  assert.equal(f.post({ action: 'hold', cancelled: true }).status, 200);
  delete f.dice.active.turn;
  assert.equal(f.post().status, 409, 'A selection cannot be replayed while attacks or initiative are resolving');
});

test('the combat aid endpoint accepts only the published bandage or potion and exact target', () => {
  const f = targetRoute(); f.dice.active.turn.care = [{ kind: 'bandage', target: 'Companion' }, { kind: 'drink', target: 'PC', item: 'healing potion 3 hp' }];
  assert.equal(f.post({ action: 'care', kind: 'bandage', target: 'Companion' }).status, 200);
  assert.equal(f.events[0].kind, 'bandage');
  for (const bad of [{ kind: 'resurrect', target: 'Companion' }, { kind: 'bandage', target: 'Guard' },
    { kind: 'drink', target: 'PC', item: 'healing potion 999 hp' }]) assert.equal(f.post({ action: 'care', ...bad }).status, 409);
});
test('NPC turns have unique reconnectable prompts and cannot request a whole-party retreat', () => {
  const f = targetRoute(), state = new ActionDice({ random: () => 10 }); state.begin('combat', '1,0,0');
  const flow = Flow.create(state, {}), companion = { name: 'Companion', hp: 20, initiative: 10 };
  flow.teams = { combatants: [companion] }; flow.startRound();
  const prompt = flow.prompt(companion, [{ name: 'Guard' }], [], false);
  assert.equal(state.snapshot().active.turn.turnId, prompt.turnId);
  f.dice.active.turn = prompt; f.dice.active.id = prompt.actionId;
  const request = { actionId: prompt.actionId, turnId: prompt.turnId, combatant: 'Companion' };
  assert.equal(f.post({ ...request, action: 'retreat' }).status, 409);
  assert.equal(f.post(request).status, 200);
  assert.equal(f.post({ ...request, action: 'hold', cancelled: true }).status, 200);
  flow.clearPrompt(prompt.turnId); assert.equal(state.snapshot().active.turn, undefined); state.end();
});
test('the combat endpoint accepts only spells and targets published on this initiative turn', () => {
  const f = targetRoute();
  f.dice.active.turn.spells = [{ itemId: 'ring', spellId: 'ward', target: 'Companion' }];
  assert.equal(f.post({ action: 'cast', itemId: 'ring', spellId: 'ward', target: 'Companion' }).status, 200);
  assert.equal(f.events[0].spellId, 'ward'); assert.equal(f.events[0].itemId, 'ring');
  for (const change of [{ itemId: 'other' }, { spellId: 'fireball' }, { target: 'Guard' }, { turnId: 'old' }])
    assert.equal(f.post({ action: 'cast', itemId: 'ring', spellId: 'ward', target: 'Companion', ...change }).status, 409);
});
