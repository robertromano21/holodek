'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { ActionDice } = require('../retort/actionDice');
const { createCombatSpace } = require('../retort/dungeonReach');
const Flow = require('../retort/combatTurnFlow'), I = require('../assets/dungeonInhabitants');
const ActionFeedback = require('../assets/actionFeedback');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8');
const combat = source.slice(source.indexOf('let combatSpace = null;'), source.indexOf('// Global variable to hold the current situation'));
function fixture({ retreatRound = 1, lethal = false } = {}) {
  const d = { geoKey: '1,0,0', start: { x: 4, y: 4 }, layout: { width: 24, height: 24 }, cells: {} };
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) d.cells[`${x},${y}`] = { tile: 'floor' };
  const names = ['Guard', 'Guard 2', 'Far Guard'], p = I.createPopulation(d.geoKey, names.map(name => ({ name, allegiance: 'Hostile', encounterId: name === 'Far Guard' ? 'remote' : 'guards' })));
  const row = (Name, HP = 1000) => formatStartingCharacterSheet({ Name, Sex: 'Female', Race: 'Human', Class: 'Fighter',
    Level: 1, HP, MaxHP: HP, AC: 10, Attack: 1, Damage: 0 });
  let text = `Coordinates: X: 1, Y: 0, Z: 0\nPC:\n${row('PC')}\nNPCs in Party:\n${row('Companion', lethal ? 2 : 1000)}\nMonsters in Room:\n${names.map(n => row(n)).join('\n')}\nMonsters Equipped Properties: None\nMonsters State: Hostile\nRooms Visited: 2`;
  let wire = JSON.stringify([['PC', 'pc', 4, 4], ['Companion', 'npc', 4, 5], ['Guard', 'monster', 5, 4],
    ['Guard 2', 'monster', 5, 6], ['Far Guard', 'monster', 20, 20]].map(([name, type, mazeX, mazeY]) =>
    ({ name, type, hp: name === 'Companion' && lethal ? 2 : 1000, mazeX, mazeY, x: mazeX, y: mazeY, mazeRoomKey: d.geoKey })));
  const emitter = new EventEmitter(), events = [];
  const dice = new ActionDice({ random: sides => sides, animationMs: 0 });
  const state = { emitter, getLastCoords: () => ({ x: 1, y: 0, z: 0 }), getRoomDungeon: () => d,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: value => text = value,
    getCombatCharactersString: () => wire, setCombatCharactersString: value => wire = value,
    getRoomPopulation: () => p, getDungeonRunId: () => 'run' };
  const broadcast = event => {
    events.push(event);
    if (event.type === 'dice_state' && event.pending) setImmediate(() => dice.submit(event.pending.id, event.pending.actionId, event.pending.geoKey));
    if (event.type === 'target_prompt') setImmediate(() => emitter.emit(`target_response_${event.combatant}`,
      { actionId: event.actionId, turnId: event.turnId, action: event.allowRetreat && event.round >= retreatRound ? 'retreat' : 'attack', target: 'Guard' }));
  };
  const context = { CombatTurnFlow: Flow, Inhabitants: I, ActionFeedback, actionDice: dice, createCombatSpace, sharedState: state,
    populationService: { get: () => p, recordPositions() {}, save() {} }, broadcast,
    console: { log() {}, info() {}, warn() {} }, updatedGameConsole: text, characterClasses: [{ name: 'Fighter', baseHP: 3 }],
    ensureSelectedPCSprite() {}, allocateXP() {}, dropMonsterItemsToRoom() {}, getRandomInt: () => 1000, updateCombatMap() {},
    getDelayedUpdatedGameConsole: async () => text, Math: Object.assign(Object.create(Math), { random: () => 0 }),
    setTimeout: (fn, ms) => setTimeout(fn, ms === 200 ? 0 : ms), clearTimeout, setInterval, clearInterval };
  vm.runInNewContext(combat, context);
  return { context, events, dice, p, state, d };
}
for (const mode of ['Combat Map-Based', 'Interactive Map-Based', 'No Combat Map']) {
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
  vm.runInNewContext(body, { app: { post: (_url, fn) => { handler = fn; } }, actionDice: dice,
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
    { target: 'Absent Guard' }, { action: 'invented' }, { action: 'hold', cancelled: true }, { cancelled: true }]) {
    assert.equal(f.post(invalid).status, 409);
  }
  f.pause(true); assert.equal(f.post().status, 409); f.pause(false);
  assert.equal(f.events.length, 0);
  assert.equal(f.post().status, 200);
  assert.equal(f.post({ action: 'retreat', target: undefined }).status, 200);
  delete f.dice.active.turn;
  assert.equal(f.post().status, 409, 'A selection cannot be replayed while attacks or initiative are resolving');
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
