const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { ActionDice } = require('../retort/actionDice');
const { createCombatSpace } = require('../retort/dungeonReach');
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
      actionDice: dice, createCombatSpace, broadcast, characterClasses: [{ name: 'Goddess', baseHP: 11 }],
      roll1d20: () => initiatives.shift(), ensureSelectedPCSprite() {},
      allocateXP: (player, allies, amount) => xp.push(amount), dropMonsterItemsToRoom: target => loot.push(target.name),
      getRandomInt: (min, max) => { assert.equal(min, 1000); assert.equal(max, 1500); return 1000; },
      updateCombatMap() {}, setTimeout: (fn, ms) => setTimeout(fn, ms === 200 ? 0 : ms), clearTimeout,
      Math: Object.assign(Object.create(Math), { random: () => 0 }),
      getDelayedUpdatedGameConsole: async () => context.updatedGameConsole,
      sharedState: { emitter, getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getRoomDungeon: () => dungeon,
        getCombatCharactersString: () => roster, setCombatCharactersString: value => { roster = value; },
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
    const final = events.findLast(event => event.type === 'final');
    if (final) assert.equal(JSON.parse(final.combatCharactersString).some(c => c.name === 'Sylvara'), false);
    assert.equal(dice.snapshot().active, null);
  });
}
