const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { ActionDice } = require('../retort/actionDice');
const { createCombatSpace } = require('../retort/dungeonReach');
const { refreshCombatQuestProgress } = require('../retort/questProgress');
const { buildInitialWorldConsole, buildInitialGameConsole, formatStartingCharacterSheet } = require('../retort/initialGameState');

const source = fs.readFileSync(path.join(__dirname, '../retort/retortWithUserInput.js'), 'utf8').replace(/\r\n/g, '\n');
const combat = source.slice(source.indexOf('let combatSpace = null;'), source.indexOf('// Global variable to hold the current situation'));

for (const mode of ['Combat Map-Based', 'Interactive Map-Based', 'No Combat Map']) {
  test(`${mode}: successive hits accumulate on live HP; a killed monster cannot retaliate`, async () => {
    const pc = { Name: 'Mortacia', Sex: 'Female', Race: 'Goddess', Class: 'Goddess', Level: 50,
      AC: 13, HP: 100, MaxHP: 100, Attack: 1, Damage: 1 };
    const npc = { Name: 'Zarthul the Veiled Sentinel', Sex: 'Male', Race: 'Human', Class: 'Sentinel', Level: 8,
      AC: 13, HP: 20, MaxHP: 20, Attack: 5, Damage: 6 };
    const sylvara = { Name: 'Sylvara', Sex: 'Female', Race: 'Wraith', Class: 'Sentinel', Level: 8,
      AC: 10, HP: 14, MaxHP: 14, Attack: 5, Damage: 6 };
    const vorathis = { Name: 'Vorathis', Sex: 'Male', Race: 'Wraith', Class: 'Sentinel', Level: 1,
      AC: 10, HP: 40, MaxHP: 40, Attack: 0, Damage: 0 };
    const cells = {};
    for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 2.5 };
    const dungeon = { geoKey: '0,0,0', layout: { width: 10, height: 8 }, cells };
    let roster = JSON.stringify([
      { name: pc.Name, type: 'pc', x: 2, y: 2, mazeX: 2, mazeY: 2, mazeRoomKey: 'X: 0, Y: 0, Z: 0' },
      { name: npc.Name, type: 'npc', x: 4, y: 2, mazeX: 4, mazeY: 2, mazeRoomKey: 'X: 0, Y: 0, Z: 0' },
      { name: sylvara.Name, type: 'monster', x: 3, y: 2, mazeX: 3, mazeY: 2, mazeRoomKey: 'X: 0, Y: 0, Z: 0' },
      { name: vorathis.Name, type: 'monster', x: 8, y: 6, mazeX: 8, mazeY: 6, mazeRoomKey: 'X: 0, Y: 0, Z: 0' }
    ]);
    const gameConsole = buildInitialGameConsole(buildInitialWorldConsole().console, pc, [npc])
      .replace('Monsters in Room: None', `Monsters in Room: \n${formatStartingCharacterSheet(sylvara)}\n${formatStartingCharacterSheet(vorathis)}`)
      .replace('Monsters State: None', 'Monsters State: Hostile');
    const rolls = [12, 7, 11, 3, 2], initiatives = [10, 8, 8, 1];
    const dice = new ActionDice({ random: () => rolls.shift() ?? 1, animationMs: 0 });
    const events = [], xp = [], loot = [], emitter = new EventEmitter();
    let taskIndex = 0, seeded = true, tasks = [{ type: 'Defeat', actionKind: 'defeat_monster', status: 'In Progress',
      desc: 'Defeat Sylvara.', requiredElements: [{ type: 'monster', name: 'Sylvara', placement: '0,0,0' }],
      hardRequirements: [{ check: 'at_coords', value: '0,0,0' }, { check: 'monster_hp_zero', value: 'Sylvara' }],
      actionRequirements: [{ check: 'monster_hp_zero', value: 'Sylvara' }] }];
    const broadcast = event => {
      events.push(event);
      if (event.type === 'dice_state' && event.pending) {
        setImmediate(() => dice.submit(event.pending.id, event.pending.actionId, event.pending.geoKey));
      }
      if (event.type === 'target_prompt') {
        setImmediate(() => emitter.emit(`target_response_${event.combatant}`, { actionId: event.actionId, target: 'Sylvara' }));
      }
    };
    const context = {
      console: { log() {}, info() {}, warn() {}, error() {} }, updatedGameConsole: gameConsole,
      actionDice: dice, createCombatSpace, refreshCombatQuestProgress, Inhabitants: require('../assets/dungeonInhabitants'), broadcast, characterClasses: [{ name: 'Goddess', baseHP: 11 }],
      roll1d20: () => initiatives.shift(), ensureSelectedPCSprite() {},
      allocateXP: (player, allies, amount) => xp.push(amount), dropMonsterItemsToRoom: target => loot.push(target.name),
      getRandomInt: (min, max) => { assert.equal(min, 1000); assert.equal(max, 1500); return 1000; },
      updateCombatMap() {}, setTimeout: (fn, ms) => setTimeout(fn, ms === 200 ? 0 : ms), clearTimeout, setInterval, clearInterval,
      Math: Object.assign(Object.create(Math), { random: () => 0 }),
      getDelayedUpdatedGameConsole: async () => context.updatedGameConsole,
      sharedState: { emitter, getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getRoomDungeon: () => dungeon,
        getCombatCharactersString: () => roster, setCombatCharactersString: value => { roster = value; },
        getUpdatedGameConsole: () => context.updatedGameConsole, getRoomNameDatabase: () => '{}',
        getCurrentTasks: () => tasks, setCurrentTasks: value => { tasks = value; },
        getCurrentTaskIndex: () => taskIndex, setCurrentTaskIndex: value => { taskIndex = value; },
        setQuestSeeded: value => { seeded = value; },
        setUpdatedGameConsole: value => { context.updatedGameConsole = value; } }
    };
    vm.runInNewContext(combat, context);
    const result = await context.handleCombatRound({}, 'attack Sylvara', mode);
    assert.match(result.combatLog, /Mortacia hits Sylvara for 8 damage[\s\S]*Sylvara has 6 HP left/);
    assert.match(result.combatLog, /Zarthul the Veiled Sentinel hits Sylvara for 9 damage[\s\S]*Sylvara has -3 HP left/);
    assert.match(result.combatLog, /Sylvara is killed by Zarthul the Veiled Sentinel/);
    assert.doesNotMatch(result.combatLog, /Sylvara targets|Sylvara rolls|Sylvara hits/);
    assert.equal(rolls.length, 0);
    assert.deepEqual(xp, [8000]);
    assert.deepEqual(loot, ['Sylvara']);
    const monsterSheet = context.updatedGameConsole.match(/Monsters in Room:([\s\S]*?)Monsters Equipped Properties:/)[1];
    assert.match(monsterSheet, /Sylvara[\s\S]*?HP:\s*-3/);
    assert.equal(require('../assets/dungeonInhabitants').parseSheets(context.updatedGameConsole).find(a => a.name === 'Sylvara').state, 'Dead');
    assert.equal(tasks[0].progress.satisfied, 1);
    assert.equal(tasks[0].progress.total, 1);
    assert.equal(tasks[0].status, 'Completed');
    assert.equal(taskIndex, 1);
    assert.equal(seeded, false);
    const final = events.findLast(event => event.type === 'final');
    if (final) assert.equal(JSON.parse(final.combatCharactersString).some(c => c.name === 'Sylvara'), false);
    assert.equal(dice.snapshot().active, null);
  });
}

for (const mode of ['Combat Map-Based', 'Interactive Map-Based', 'No Combat Map']) {
  test(`${mode}: individual sheet states override a hostile room summary`, async () => {
    const I = require('../assets/dungeonInhabitants');
    const hero = { Name: 'Hero', Sex: 'Female', Race: 'Human', Class: 'Sentinel', Level: 1, AC: 10,
      HP: 40, MaxHP: 40, Attack: 1, Damage: 1 };
    const inhabitants = [['Pilgrim', 'Friendly', 20], ['Mason', 'Neutral', 20], ['Guard', 'Hostile', 20], ['Fallen', 'Dead', 0]];
    const sheets = inhabitants.map(([Name, state, HP]) => formatStartingCharacterSheet({ ...hero, Name, HP })
      .replace(/State: .*/, `State: ${state}`)).join('\n');
    let text = buildInitialGameConsole(buildInitialWorldConsole().console, hero)
      .replace('Monsters in Room: None', `Monsters in Room:\n${sheets}`)
      .replace('Monsters State: None', 'Monsters State: Hostile');
    let roster = JSON.stringify([{ name: 'Hero', type: 'pc', x: 2, y: 2, mazeX: 2, mazeY: 2, mazeRoomKey: '0,0,0' },
      ...inhabitants.map(([name], i) => ({ name, type: 'monster', x: 3, y: 2+i, mazeX: 3, mazeY: 2+i, mazeRoomKey: '0,0,0' }))]);
    const cells = {};
    for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 2.5 };
    const dungeon = { geoKey: '0,0,0', layout: { width: 10, height: 8 }, cells };
    const emitter = new EventEmitter(), dice = new ActionDice({ random: () => 1, animationMs: 0 });
    const context = { console: { log() {}, info() {}, warn() {}, error() {} }, updatedGameConsole: text,
      Inhabitants: I, createCombatSpace, actionDice: dice, characterClasses: [{ name: 'Sentinel', baseHP: 10 }],
      roll1d20: () => 10, ensureSelectedPCSprite() {}, updateCombatMap() {},
      getRandomInt: () => { throw Error('A missed attack must not award XP.'); }, allocateXP() {}, dropMonsterItemsToRoom() {},
      setTimeout: (fn, ms) => setTimeout(fn, ms === 200 ? 0 : ms), clearTimeout, setInterval, clearInterval,
      Math: Object.assign(Object.create(Math), { random: () => 0 }),
      getDelayedUpdatedGameConsole: async () => text,
      broadcast: event => {
        if (event.type === 'dice_state' && event.pending) setImmediate(() => dice.submit(event.pending.id, event.pending.actionId, event.pending.geoKey));
        if (event.type === 'target_prompt') setImmediate(() => emitter.emit(`target_response_${event.combatant}`, { actionId: event.actionId, target: 'Guard' }));
      },
      sharedState: { emitter, getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getRoomDungeon: () => dungeon,
        getCombatCharactersString: () => roster, setCombatCharactersString: v => roster = v,
        getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => { text = v; context.updatedGameConsole = v; } } };
    vm.runInNewContext(combat, context);
    const result = await context.handleCombatRound({}, 'attack Guard', mode);
    const rolling = dice.snapshot().results.map(r => r.actor);
    assert.ok(rolling.includes('Hero'));
    assert.ok(rolling.includes('Pilgrim'));
    assert.ok(rolling.includes('Guard'));
    assert.ok(!rolling.includes('Mason') && !rolling.includes('Fallen'));
    assert.match(result.combatLog, /Pilgrim (?:rolls|misses) Guard|Pilgrim rolls \d+ to hit Guard/);
    assert.doesNotMatch(result.combatLog, /Mason targets|Fallen targets|Mason rolls|Fallen rolls/);
    assert.deepEqual(I.parseSheets(text).map(a => a.state), ['Friendly', 'Neutral', 'Hostile', 'Dead']);
    assert.equal(dice.snapshot().active, null);
  });
}
