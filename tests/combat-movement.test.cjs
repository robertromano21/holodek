const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createCombatSpace, position } = require('../retort/dungeonReach');
const { ActionDice } = require('../retort/actionDice');
const { buildInitialWorldConsole, buildInitialGameConsole, formatStartingCharacterSheet } = require('../retort/initialGameState');
const read = file => fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const actor = (name, x, y, type = 'monster') => ({ name, type, mazeX: x, mazeY: y, mazeRoomKey: 'X: 0, Y: 0, Z: 0', x: 15, y: 15, hp: 40 });
function room() {
  const cells = {};
  for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) cells[`${x},${y}`] = {
    tile: x === 0 || y === 0 || x === 9 || y === 7 ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 2.5
  };
  return { geoKey: '0,0,0', layout: { width: 10, height: 8 }, cells };
}

test('formatted browser keys use maze coordinates, not screen coordinates or another room', () => {
  const pc = actor('PC', 1, 1, 'pc'), monster = actor('Monster', 2, 1);
  const space = createCombatSpace(room(), [pc, monster], '0,0,0');
  assert.equal(space.canAttack(pc, monster), true);
  assert.deepEqual(position(pc, '0,0,0'), { x: 1.5, y: 1.5 });
  assert.equal(position(pc, '0,0,1'), null);
  monster.mazeRoomKey = 'X: 0, Y: 0, Z: 1';
  assert.equal(space.canAttack(pc, monster), false);
});

test('pursuit routes around walls and living allies, stops in range, and persists maze movement', () => {
  const dungeon = room(), pc = actor('PC', 1, 2, 'pc'), monster = actor('Monster', 7, 2), ally = actor('Ally', 2, 2, 'npc');
  for (let y = 1; y <= 4; y++) dungeon.cells[`4,${y}`].tile = 'wall';
  const space = createCombatSpace(dungeon, [pc, monster, ally], dungeon.geoKey);
  const path = space.pursuitPath(pc, monster);
  assert.ok(path.length > 0);
  assert.ok(path.some(p => p.y === 5));
  let previous = { x: pc.mazeX, y: pc.mazeY };
  for (const step of path) {
    assert.equal(dungeon.cells[`${step.x},${step.y}`].tile, 'floor');
    assert.notDeepEqual(step, { x: ally.mazeX, y: ally.mazeY });
    assert.equal(Math.abs(step.x - previous.x) + Math.abs(step.y - previous.y), 1);
    space.move(pc, step);
    previous = step;
  }
  assert.equal(space.canAttack(pc, monster), true);
  const saved = [{ name: 'PC', mazeX: 1, mazeY: 2 }];
  space.syncRoster(saved);
  assert.equal(saved[0].mazeX, pc.mazeX);
  assert.equal(saved[0].mazeY, pc.mazeY);
});

test('sealed doors and impassable height changes prevent pursuit; ranged attackers already in reach stay put', () => {
  const dungeon = room(), pc = actor('PC', 1, 1, 'pc'), monster = actor('Monster', 6, 1);
  for (let y = 1; y < 7; y++) dungeon.cells[`4,${y}`] = { tile: 'door', door: { isOpen: false }, floorHeight: 0, ceilHeight: 2.5 };
  const space = createCombatSpace(dungeon, [pc, monster], dungeon.geoKey);
  assert.deepEqual(space.pursuitPath(pc, monster), []);
  for (let y = 1; y < 7; y++) { dungeon.cells[`4,${y}`].door.isOpen = true; dungeon.cells[`4,${y}`].floorHeight = 3; }
  assert.deepEqual(space.pursuitPath(pc, monster), []);
  for (let y = 1; y < 7; y++) dungeon.cells[`4,${y}`].floorHeight = 0;
  assert.deepEqual(space.pursuitPath({ ...pc, equipped: { Weapon: 'longbow' } }, monster), []);
  assert.equal(space.canAttack({ ...pc, equipped: { Weapon: 'longbow' } }, monster), true);
});

for (const holdDamage of [false, true]) test(`existing map combat pursues and ${holdDamage ? 'applies no damage after a missed damage prompt' : 'interjects attack/damage dice at the original resolution points'}`, async () => {
  const source = read('retort/retortWithUserInput.js');
  const helpers = source.slice(source.indexOf('let combatSpace = null;'), source.indexOf('async function resolveCombatRound('));
  const map = source.slice(source.indexOf('async function handleCombatRoundWithMap('), source.indexOf('// Patch live HP'));
  const pc = actor('Mortacia', 1, 2, 'pc'), monster = actor('Pyraxus', 6, 2);
  const dungeon = room();
  let roster = JSON.stringify([pc, monster]), consoleText = '';
  const events = [], requests = [];
  const dice = new ActionDice({ random: sides => sides, timeoutMs: 5, animationMs: 0 });
  const sheet = Name => formatStartingCharacterSheet({ Name, Sex: 'Male', Race: 'Human', Class: 'Fighter',
    Level: 1, AC: 10, HP: 40, MaxHP: 40, Attack: 1, Damage: 2 });
  consoleText = buildInitialGameConsole(buildInitialWorldConsole().console, { Name: 'Mortacia', Sex: 'Female',
    Race: 'Goddess', Class: 'Fighter', Level: 50, AC: 15, HP: 40, MaxHP: 40, Attack: 1, Damage: 2 })
    .replace('Monsters in Room: None', `Monsters in Room: \n${sheet('Pyraxus')}`)
    .replace('Monsters State: None', 'Monsters State: Hostile');
  const broadcast = event => {
    events.push(event);
    if (event.type === 'dice_state' && event.pending) {
      requests.push(event.pending);
      if (holdDamage && event.pending.label === 'Damage') { setTimeout(() => {}, 15); return; }
      setImmediate(() => dice.submit(event.pending.id, event.pending.actionId, event.pending.geoKey));
    }
  };
  const context = {
    console: quiet, updatedGameConsole: consoleText, createCombatSpace, actionDice: dice, broadcast,
    characterClasses: [{ name: 'Fighter', baseHP: 10 }], roll1d20: (() => { let i = 0; return () => ++i === 1 ? 20 : 10; })(),
    ensureSelectedPCSprite() {}, patchLiveHPToConsole: value => value, allocateXP() {}, dropMonsterItemsToRoom() {},
    setTimeout: fn => { setImmediate(fn); }, getRandomInt: () => { throw Error('Damage must use the dice request.'); },
    sharedState: { getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getRoomDungeon: () => dungeon,
      getCombatCharactersString: () => roster, setCombatCharactersString: value => { roster = value; },
      setUpdatedGameConsole: value => { consoleText = value; } },
    resolveCombatRound: (agent, input) => context.handleCombatRoundWithMap(agent, broadcast, input)
  };
  vm.runInNewContext(helpers + '\n' + map, context);
  const result = await context.handleCombatRound({}, 'attack Pyraxus', 'Combat Map-Based');
  assert.match(result.combatLog, /Mortacia advances/);
  assert.doesNotMatch(result.combatLog, /cannot reach|cannot find/);
  assert.deepEqual(requests.map(r => [r.label, r.sides]), [['Attack', 20], ['Damage', 10]]);
  assert.deepEqual(dice.snapshot().results.map(r => r.label), holdDamage ? ['Attack', 'Attack', 'Damage'] : ['Attack', 'Damage', 'Attack', 'Damage']);
  assert.match(consoleText, /HP: 28/);
  const final = JSON.parse(events.findLast(e => e.type === 'final').combatCharactersString);
  assert.notEqual(final.find(c => c.name === 'Mortacia').mazeX, 1);
  assert.equal(final.find(c => c.name === 'Pyraxus').hp, holdDamage ? 40 : 28);
  if (holdDamage) assert.match(result.combatLog, /no damage was applied/);
  assert.equal(dice.snapshot().active, null);
  assert.ok(events.some(e => e.type === 'combat_maze_step'));
});

test('client applies combat steps to both the camera and maze actors without ambient anchor reassignment', () => {
  const source = read('assets/game.js');
  const control = source.slice(source.indexOf('function markCombatRoundActive('), source.indexOf('function shouldUsePartyMazeAnchors('));
  const sync = source.slice(source.indexOf('function syncPartyMazeToCombatPositions('), source.indexOf('let _partyMazeStepAt'));
  const pc = actor('Mortacia', 1, 2, 'pc'), npc = actor('Ally', 2, 3, 'npc');
  let resets = 0;
  const context = {
    window: { combatCharacters: [pc, npc], actionDiceState: { active: { kind: 'combat', id: 'round-1' } } },
    currentDungeon: room(), playerDungeonX: 1, playerDungeonY: 2, playerPosX: 1.5, playerPosY: 2.5,
    performance: { now: () => 100 }, deriveFacingFromDelta: () => 'right', advanceWalkFrame() {}, NPC_WALK_FRAME_MS: 200,
    updatePlayerHeightFromCell() {}, renderDungeonView() {}, COMBAT_GRID_CENTER: 15,
    shouldUsePartyMazeAnchors: () => true, ensurePartyMazeAnchors: () => { resets++; },
    getCurrentCombatRoomKey: () => 'X: 0, Y: 0, Z: 0', projectMazePointToCombatGrid: (x, y) => ({ x, y }),
    refreshPartyCombatProjection: () => context.syncPartyMazeToCombatPositions(false)
  };
  vm.runInNewContext(`${control}\n${sync}`, context);
  context.applyCombatMazeStep({ character: 'Mortacia', geoKey: '0,0,0', actionId: 'round-1', x: 2, y: 2, duration: 200 });
  assert.equal(context.playerDungeonX, 2);
  assert.equal(context.playerPosX, 2.5);
  assert.equal(pc.mazeX, 2);
  assert.equal(pc.x, 15);
  assert.equal(resets, 0);
  context.applyCombatMazeStep({ character: 'Ally', geoKey: '0,0,0', actionId: 'round-1', x: 3, y: 3 });
  assert.equal(npc.mazeX, 3);
  assert.equal(npc.x, 3.5);
  context.applyCombatMazeStep({ character: 'Mortacia', geoKey: '0,0,0', actionId: 'stale', x: 8, y: 2 });
  assert.equal(context.playerDungeonX, 2);
  context.window.actionDiceState.active = null;
  context.window._combatCommandPending = true;
  assert.equal(context.isCombatRoundActive(), true);
  context.syncPartyMazeToCombatPositions(false);
  assert.equal(resets, 0);
  context.window._combatCommandPending = false;
  context.syncPartyMazeToCombatPositions(false);
  assert.equal(resets, 1);
});

test('dice UI shows attack and damage outcomes alongside avatars and offers the actual pending damage die', () => {
  const element = () => ({ children: [], attributes: {}, listeners: {}, appendChild(child) { this.children.push(child); },
    style: {}, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(key, callback) { this.listeners[key] = callback; } });
  const slot = element(), dock = element();
  dock.querySelector = () => slot;
  let now = 0;
  const context = { window: {}, document: { createElement: element }, setTimeout() {}, Date: { now: () => now } };
  vm.runInNewContext(read('assets/actionDiceUi.js'), context);
  context.window.receiveDiceState({ type: 'dice_state', epoch: 'server', revision: 2, active: { kind: 'combat' },
    pending: { id: 'damage', actor: 'Mortacia', label: 'Damage', target: 'Monster', sides: 8, modifier: 2, difficulty: null },
    results: [{ id: 'attack-pc', actor: 'Mortacia', label: 'Attack', sides: 20, natural: 16, modifier: 1, total: 17 },
      { id: 'attack-npc', actor: 'Ally', label: 'Attack', sides: 20, natural: 15, modifier: 0, total: 15 },
      { id: 'damage-npc', actor: 'Ally', label: 'Damage', sides: 6, natural: 4, modifier: 2, total: 6 }] });
  now = 1001;
  context.window.renderPartyDice(dock, [{ label: 'Mortacia' }, { label: 'Ally' }]);
  const [pcDie, pcHistory] = slot.children[0].children;
  assert.equal(pcDie.disabled, false);
  assert.match(pcDie.title, /Damage: roll d8/);
  assert.match(pcHistory.textContent, /Attack: 17/);
  assert.match(slot.children[1].children[1].textContent, /Attack: 15\nDamage: 6/);
  assert.match(dock.children[0].textContent, /Roll d8 \+ 2/);
});

test('dice visibly tumble for one second and settle on the server result, not the cosmetic face', () => {
  let now = 0;
  const timers = [];
  const element = () => ({ children: [], style: {}, attributes: {}, appendChild(c) { this.children.push(c); },
    setAttribute(k, v) { this.attributes[k] = v; }, addEventListener() {} });
  const slot = element(), dock = element(); dock.querySelector = () => slot;
  const context = { window: {}, document: { createElement: element, querySelector: () => slot.children.at(-1)?.children[0] },
    setTimeout: fn => timers.push(fn), Date: { now: () => now } };
  vm.runInNewContext(read('assets/actionDiceUi.js'), context);
  context.window.receiveDiceState({ type: 'dice_state', epoch: 'server', revision: 1, active: { id: 'round', kind: 'combat' },
    pending: null, results: [{ id: 'npc-roll', actor: 'Ally', label: 'Attack', natural: 17, total: 19, sides: 20, modifier: 2 }] });
  context.window.renderPartyDice(dock, [{ label: 'Ally' }]);
  assert.match(slot.children.at(-1).children[0].className, /rolling/);
  assert.equal(slot.children.at(-1).children[1].textContent, '');
  now = 500; timers.shift()();
  assert.ok(Number(slot.children.at(-1).children[0].textContent) >= 1);
  now = 1001; timers.shift()();
  context.window.renderPartyDice(dock, [{ label: 'Ally' }]);
  assert.doesNotMatch(slot.children.at(-1).children[0].className, /rolling/);
  assert.equal(slot.children.at(-1).children[0].textContent, '17');
  assert.equal(slot.children.at(-1).children[1].textContent, 'Attack: 19');
});

test('interactive targeting uses the existing PC/NPC selection request and holding does not randomly attack', async () => {
  const source = read('retort/retortWithUserInput.js');
  const start = source.indexOf('async function promptForTarget(');
  const prompt = source.slice(start, source.indexOf('for (const combatant of initiativeOrder)', start));
  const emitter = new (require('node:events').EventEmitter)();
  const foe = { name: 'Pyraxus', hp: 40, x: 5, y: 6 };
  const events = [];
  const context = { initiativeOrder: [foe], alreadyKilled: new Set(), sharedState: { emitter },
    actionDice: { active: { id: 'round-1' } }, combatSpace: { distance: () => 3 }, setTimeout, clearTimeout,
    broadcast: event => {
      events.push(event);
      setImmediate(() => emitter.emit(`target_response_${event.combatant}`,
        { actionId: event.actionId, target: 'Pyraxus', cancelled: event.combatant === 'Ally' }));
    }
  };
  vm.runInNewContext(prompt, context);
  assert.equal((await context.promptForTarget({ name: 'Mortacia' }, [foe])).name, 'Pyraxus');
  assert.equal(await context.promptForTarget({ name: 'Ally' }, [foe]), null);
  assert.deepEqual(events.map(e => e.combatant), ['Mortacia', 'Ally']);
  assert.equal(events[0].positions[0].distance, 3);
  assert.equal(emitter.listenerCount('target_response_Ally'), 0);
});

test('console monster actions retain their popup while combat-turn targeting stays in the dock', async () => {
  const element = () => ({ children: [], style: {}, listeners: {}, appendChild(c) { this.children.push(c); },
    setAttribute() {}, addEventListener(key, fn) { this.listeners[key] = fn; } });
  let submitted;
  const context = { window: {}, document: { createElement: element }, setTimeout,
    fetch: async (url, options) => { submitted = JSON.parse(options.body); return { ok: true, json: async () => ({ status: 'success' }) }; } };
  vm.runInNewContext(read('assets/actionDiceUi.js'), context);
  context.window.showCombatTargetPrompt({ combatant: 'Mortacia', actionId: 'round', targets: ['Pyraxus'], positions: [{ distance: 3 }] });
  const targeting = element(); targeting.querySelector = () => null;
  context.window.renderPartyDice(targeting, []);
  assert.match(targeting.children[0].children[1].children[0].textContent, /3.0 tiles away/);
  await targeting.children[0].children[3].listeners.click();
  assert.equal(submitted.cancelled, true);
  assert.equal(submitted.actionId, 'round');
  const html = read('assets/index.html');
  assert.match(html, /id="game-menu"[\s\S]*?id="environment-lab-button" class="game-menu-button"[\s\S]*?<\/div>/);
  assert.doesNotMatch(read('assets/livingEnvironmentUi.js'), /Environment Lab|bottom:8px/);
  const game = read('assets/game.js');
  const handler = game.slice(game.indexOf('console.log(`Clicked on monster:'), game.indexOf('// ---- Exit click handler'));
  assert.match(handler, /chatInput.value = `attack \$\{monsterName\}`/);
  assert.match(handler, /document.body.appendChild\(popup\)/);
  assert.match(handler, /popup-container/);
  assert.match(handler, /id="add-button"/);
  assert.match(handler, /id="attack-button"/);
  assert.match(handler, /id="cancel-button"/);
  assert.doesNotMatch(handler, /showMonsterActions/);
});
