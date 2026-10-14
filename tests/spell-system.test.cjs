'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../retort/spellSystem'), C = require('../retort/classMagic'), Q = require('../retort/questProgress');
const I = require('../assets/dungeonInhabitants'), Inventory = require('../assets/inventoryUi');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
const R = S.Rules;
function fixture(options = {}) {
  const item = { name: 'ashblade', type: 'weapon', attack_modifier: 2, damage_modifier: 1, ac: 1, magic: 1, ...options.item };
  const d = { geoKey: '1,0,0', layout: { width: 16, height: 16 }, cells: {} };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) d.cells[`${x},${y}`] = { tile: 'floor' };
  const actor = (name, extra = {}, type = 'pc') => sheet({ Name: name, Sex: 'Female', Race: 'Human', Class: 'Fighter', Level: 1,
    HP: 100, MaxHP: 100, AC: 10, Attack: 4, Damage: 2, Armor: 1, Magic: 0, ...extra }, 6, type);
  const className = options.className || 'Fighter', classMagic = R.classes[className]?.startingMagic ?? R.classes[className]?.pointsPerLevel ?? 0;
  let text = `Coordinates: X: 1, Y: 0, Z: 0\nInventory: ${options.inventory?.map(p => p.name).join(', ') || 'Empty'}\nInventory Properties: ${options.inventory?.map(p => JSON.stringify(p)).join(', ') || 'None'}\nPC:\n${actor('PC', { Class: className, Level: options.level || 1, Magic: classMagic + item.magic, Equipped: { Weapon: item.name } })}\nNPCs in Party:\n${actor('Ally', { HP: 50 }, 'npc')}\nMonsters in Room:\n${actor('Enemy', { Equipped: options.monsterItem ? { Other: options.monsterItem.name } : {}, Magic: options.monsterItem?.magic || 0 }, 'npc').replace('State: Friendly', 'State: Hostile')}\nMonsters Equipped Properties: ${options.monsterItem ? JSON.stringify({ ...options.monsterItem, owner: 'Enemy', slot: 'Other' }) : 'None'}\nMonsters State: Hostile\nParty Equipped Properties: ${JSON.stringify({ ...item, owner: 'PC', slot: 'Weapon' })}`;
  let database = JSON.stringify({ '0,0,0': { name: 'Entrance' }, '1,0,0': { name: 'Ash Hall', indoor: true, objects: [item] }, '2,0,0': { name: 'Boss Hall', bossGate: { status: 'locked', quest: 'Main Quest' } } });
  let roster = JSON.stringify([['PC', 'pc', 2, 2], ['Ally', 'npc', 2, 3], ['Enemy', 'monster', options.enemyX ?? (options.className ? 8 : 4), 2]].map(([name, type, mazeX, mazeY]) => ({ name, type, mazeX, mazeY, mazeRoomKey: d.geoKey, hp: 100 })));
  let tasks = [], paused = false;
  const state = { getDungeonRunId: () => 'run', getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getRoomNameDatabase: () => database, setRoomNameDatabase: v => database = v,
    getCombatCharactersString: () => roster, setCombatCharactersString: v => roster = v,
    getLastCoords: () => ({ x: 1, y: 0, z: 0 }), getRoomDungeonForSimulation: () => d,
    getGamePaused: () => paused, setGamePaused: v => paused = v, getCurrentTasks: () => tasks, setCurrentTasks: v => tasks = v,
    getCurrentTaskIndex: () => 0, getCurrentQuest: () => 'Main Quest' };
  const pool = () => JSON.parse(database)['0,0,0'].spellSystem;
  if (options.blankBook) {
    // Isolate scroll-learning regressions from the separate starter-formula grant.
    S.synchronize(state);
    const db = JSON.parse(database), c = db['0,0,0'].spellSystem.casters.PC;
    c.known = []; c.prepared = []; c.learned = {}; database = JSON.stringify(db);
  }
  const input = (spell = 'missile', target = 'Enemy', caster = 'PC') => {
    const v = S.view(state, caster, { monster: caster === 'Enemy' }), entry = v.casters[0].items.find(i => i.spells.some(s => s.id === spell));
    return { runId: 'run', geoKey: d.geoKey, revision: v.revision, caster, itemId: entry?.id, spellId: spell, target, nonce: require('node:crypto').randomUUID() };
  };
  return { state, item, d, input, pool, actor: name => S.allActors(text).find(a => a.name === name) };
}
test('charged equipment has bounded original spell recipes and LLM decorations cannot change mechanics', () => {
  for (let magic = 1; magic <= 10; magic++) {
    const recipe = R.recipe({ name: 'ring', type: 'other', magic });
    assert.ok(recipe.length > 0 && recipe.length <= 3); assert.ok(recipe.reduce((n, s) => n + s.cost, 0) <= magic);
    const decorated = R.decorate(recipe, recipe.map(s => ({ id: s.id, name: 'Ash ' + s.name, lore: 'Oaths become force.', damage: 999, cost: 0 })));
    decorated.forEach((s, i) => { assert.equal(s.cost, recipe[i].cost); assert.equal(s.dice, recipe[i].dice); assert.ok(s.name.startsWith('Ash ')); });
  }
  assert.deepEqual(R.recipe({ name: 'healing potion 3 hp', magic: 3, consumable_kind: 'healing' }), []);
  assert.deepEqual(R.recipe({ name: 'blank', magic: 0 }), []);
});
test('equipped item casts spend real Magic, damage real HP, remove all bonuses at zero and deduplicate receipts', () => {
  const f = fixture(), input = f.input(), before = f.state.getUpdatedGameConsole();
  const result = S.cast(f.state, null, input, { combat: true, random: () => 4 });
  assert.equal(result.error, undefined); assert.equal(result.ash, true); assert.equal(f.actor('Enemy').hp, 95);
  assert.equal(f.actor('PC').magic, 0); assert.equal(f.actor('PC').attack, 2); assert.equal(f.actor('PC').damage, 1); assert.equal(f.actor('PC').armor, 0); assert.equal(f.actor('PC').ac, 9);
  assert.equal(I.parseEquipment(f.actor('PC').lines[9]).Weapon, 'None');
  assert.equal(S.cast(f.state, null, input, { combat: true }).duplicate, true); assert.equal(f.actor('Enemy').hp, 95);
  assert.match(S.cast(f.state, null, { ...input, target: 'Ally' }, { combat: true }).error, /already used/);
  const stale = S.preserve(f.state, before, JSON.stringify({ '0,0,0': { spellSystem: {} } }));
  assert.equal(I.parseSheets(stale.text, 'PC')[0].magic, 0); assert.equal(I.parseEquipment(I.parseSheets(stale.text, 'PC')[0].lines[9]).Weapon, 'None');
  assert.equal(JSON.parse(stale.database)['0,0,0'].spellSystem.items[input.itemId].status, 'ash');
  const preId = S.preserve(f.state, S.write(before, 'Party Equipped Properties', JSON.stringify({ ...f.item, owner: 'PC', slot: 'Weapon' })));
  assert.equal(I.parseEquipment(I.parseSheets(preId.text, 'PC')[0].lines[9]).Weapon, 'None', 'Pre-ID snapshots also cannot restore destroyed equipment');
});
test('invalid, paused, foreign, stale, unequipped, dead and out-of-range casts consume nothing', () => {
  const f = fixture({ item: { magic: 2 } }), input = f.input();
  for (const change of [{ runId: 'other' }, { geoKey: '2,0,0' }, { revision: -1 }, { nonce: 'bad' }, { itemId: 'invented' }, { spellId: 'resurrection' }, { target: 'Ally' }, { caster: 'Enemy' }]) {
    assert.ok(S.cast(f.state, null, { ...input, ...change }, { combat: true }).error); assert.equal(f.pool().items[input.itemId].remaining, 2);
  }
  f.state.setGamePaused(true); assert.ok(S.cast(f.state, null, input, { combat: true }).error); f.state.setGamePaused(false);
  f.d.cells['3,2'].tile = 'wall'; assert.ok(S.cast(f.state, null, input, { combat: true }).error);
  f.d.cells['3,2'].tile = 'floor';
  const roster = JSON.parse(f.state.getCombatCharactersString()); roster.find(a => a.name === 'Enemy').mazeX = 15; f.state.setCombatCharactersString(JSON.stringify(roster));
  assert.ok(S.cast(f.state, null, input, { combat: true }).error);
  assert.equal(f.pool().items[input.itemId].remaining, 2);
});
test('a normal scroll can be cast exactly once by a Fighter', () => {
  const scroll = R.scroll('missile', 'test'), f = fixture({ item: scroll });
  const result = S.cast(f.state, null, f.input(), { combat: true, random: () => 1 });
  assert.equal(result.error, undefined); assert.equal(result.ash, true); assert.equal(f.actor('Enemy').hp, 98);
  assert.equal(S.view(f.state).casters.find(c => c.name === 'PC').items.length, 0);
});
test('monster equipment follows the same casts, charge costs and ash rules', () => {
  const f = fixture({ monsterItem: R.scroll('missile', 'enemy') }), input = f.input('missile', 'PC', 'Enemy');
  const result = S.cast(f.state, null, input, { combat: true, monster: true, random: () => 3 });
  assert.equal(result.error, undefined); assert.equal(result.ash, true); assert.equal(f.actor('PC').hp, 96); assert.equal(f.actor('Enemy').magic, 0);
});
test('campaign artifacts do not ash, regenerate after five real turns and never recharge just from viewing', () => {
  const f = fixture({ item: { quest_artifact: true } }), input = f.input();
  assert.equal(S.cast(f.state, null, input, { combat: true, random: () => 1 }).ash, false);
  for (let i = 0; i < 10; i++) S.view(f.state); assert.equal(f.pool().clock, 0); assert.equal(f.actor('PC').magic, 0);
  for (let i = 0; i < 4; i++) S.advance(f.state); assert.equal(f.pool().items[input.itemId].remaining, 0);
  S.advance(f.state); assert.equal(f.pool().items[input.itemId].remaining, 1); assert.equal(f.actor('PC').magic, 1);
  assert.equal(I.parseEquipment(f.actor('PC').lines[9]).Weapon, 'ashblade');
});
test('healing caps HP; wards and curses alter actual regular attack results and expire', () => {
  const f = fixture({ item: { type: 'shield', magic: 4 } });
  assert.equal(S.cast(f.state, null, f.input('ward', 'Ally'), { random: () => 1 }).error, undefined);
  assert.equal(S.absorb(f.state, f.actor('Ally'), 6), 2); assert.equal(S.absorb(f.state, f.actor('Ally'), 6), 6);
  const h = fixture({ item: R.scroll('mend', 'healing') });
  const heal = h.input('mend', 'Ally'); assert.equal(S.cast(h.state, null, heal, { random: () => 6 }).changes[0].hp, 57);
  const g = fixture({ item: R.scroll('curse', 'curse') });
  const curse = g.input('curse'); assert.equal(S.cast(g.state, null, curse, { combat: true, random: () => 1 }).error, undefined);
  assert.equal(S.penalty(g.state, g.actor('Enemy')), 2); S.advance(g.state); assert.equal(S.penalty(g.state, g.actor('Enemy')), 2);
  S.advance(g.state); assert.equal(S.penalty(g.state, g.actor('Enemy')), 0);
});
test('fireball applies saves, friendly fire and occlusion using actual tile positions', () => {
  const f = fixture({ item: { magic: 3 } }), input = f.input('fireball');
  const result = S.cast(f.state, null, input, { combat: true, random: sides => sides === 20 ? 20 : 6 });
  assert.equal(result.error, undefined); assert.equal(f.actor('Enemy').hp, 91); assert.equal(f.actor('PC').hp, 91);
  assert.equal(f.actor('Ally').hp, 50, 'Ally lies outside two-tile blast radius'); assert.equal(result.rolls.filter(r => r.sides === 20).length, 2);
});

test('spell preview and commit use the same automatic save order for a fatal multi-target blast', () => {
  const f = fixture({ item: { magic: 3 } }), Life = require('../retort/combatLife');
  f.state.setUpdatedGameConsole(S.changeActor(S.changeActor(f.state.getUpdatedGameConsole(), 'PC', s => S.stat(s, 'HP', 5)), 'Enemy', s => S.stat(s, 'HP', 5)));
  const input = f.input('fireball'), options = { combat: true };
  const naturals = S.rollPlan(f.state, input, options).map(r => r.sides === 20 ? 1 : 6);
  const saves = S.survivalPlan(f.state, input, naturals, options);
  assert.deepEqual(saves.map(s => s.actor), ['PC', 'Enemy']); assert.ok(saves.every(s => s.player === false));
  const sequence = [...naturals, ...saves.map(() => 1)];
  const result = S.cast(f.state, null, input, { ...options, random: () => sequence.shift() });
  assert.ok(!result.error, result.error); assert.equal(sequence.length, 0);
  assert.equal(f.actor('PC').state, 'Dying'); assert.equal(f.actor('Enemy').state, 'Dying');
  assert.equal(result.rolls.filter(r => r.label === 'Spell Save').length, 2);
  assert.equal(result.rolls.filter(r => r.label === 'Survival Save').length, 2);
  Life.advance(f.state); assert.equal(f.actor('PC').state, 'Dying');
  Life.advance(f.state); assert.equal(f.actor('PC').hp, 50); assert.equal(f.actor('Enemy').state, 'Dead');
});
for (const className of ['Wizard', 'Witch', 'Necromancer']) test(`${className} must consume a real scroll to learn, then prepare and cast with class Magic`, () => {
  const id = { Wizard: 'missile', Witch: 'thorn_needle', Necromancer: 'bone_shard' }[className];
  const scroll = R.scroll(id, 'learning'), f = fixture({ className, level: 3, inventory: [scroll], enemyX: 6, blankBook: true });
  let data = S.view(f.state), c = data.casters.find(a => a.name === 'PC').items.find(i => i.classSource);
  assert.equal(c.capacity, 6); assert.deepEqual(c.known, []); assert.ok(S.field(f.state.getUpdatedGameConsole(), 'Inventory').includes(c.name));
  const request = { runId: 'run', geoKey: '1,0,0', caster: 'PC', revision: data.revision, kind: 'prepare', spellIds: [id] };
  assert.ok(C.action(f.state, request).error, 'A name alone cannot teach a spell');
  assert.equal(C.action(f.state, { ...request, kind: 'scribe', item: scroll.name }).error, undefined);
  assert.ok(!S.field(f.state.getUpdatedGameConsole(), 'Inventory').includes(scroll.name));
  data = S.view(f.state); assert.equal(C.action(f.state, { ...request, revision: data.revision }).error, undefined);
  const input = { ...f.input(id), itemId: 'class:PC' };
  assert.equal(S.cast(f.state, null, input, { combat: true, random: () => 2 }).error, undefined); assert.equal(f.pool().casters.PC.remaining, 5);
  assert.equal(f.pool().casters.PC.status, 'ready'); assert.ok(S.field(f.state.getUpdatedGameConsole(), 'Inventory').includes(c.name));
  for (let i = 0; i < 6; i++) S.advance(f.state); assert.equal(f.pool().casters.PC.remaining, 6);
});
test('normal Necromancers keep their existing starting bonus and per-level spell progression', () => {
  const source = require('node:fs').readFileSync('assets/game.js', 'utf8');
  for (const [className, rate] of [['Necromancer', 2]]) {
    assert.ok(source.includes(`'${className}': { Attack: 0, Damage: 0, Armor: 0, Magic: ${rate} }`));
    const f = fixture({ className, level: 3 }); let data = S.view(f.state);
    assert.equal(data.casters[0].items.find(i => i.classSource).capacity, rate * 3);
    assert.equal(f.actor('PC').magic, rate * 3 + f.item.magic);
    assert.deepEqual(f.pool().casters.PC.known, C.starterSpells(f.pool().casters.PC.settings));
    const magic = f.actor('PC').magic; S.view(f.state); assert.equal(f.actor('PC').magic, magic);
    f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'PC', s => S.stat(s, 'Level', 9)));
    data = S.view(f.state); const caster = data.casters[0].items.find(i => i.classSource);
    assert.equal(caster.capacity, rate * 9); assert.equal(caster.slots, 5); assert.equal(caster.rechargeEvery, 4);
    assert.equal(caster.scribeTurns, 2); assert.equal(caster.bookPresent, true);
  }
});
const MORTACIA_CLASS = 'Assassin-Fighter-Necromancer-Goddess';
test('Mortacia retains divine level 50, but only has five class Magic and recovery-level-one spell rules', () => {
  const f = fixture({ className: MORTACIA_CLASS, level: 50 }), source = S.view(f.state).casters[0].items.find(i => i.classSource);
  assert.equal(source.capacity, 5); assert.equal(source.magic, 5); assert.equal(f.actor('PC').magic, 6, 'Five class points plus the separate one-point weapon');
  assert.equal(f.actor('PC').level, 50); assert.equal(source.divineLevel, 50); assert.equal(source.castingLevel, 1);
  assert.equal(source.slots, 2); assert.equal(source.rechargeEvery, 6); assert.equal(source.rechargeAmount, 1); assert.equal(source.scribeTurns, 3);
  assert.deepEqual(f.pool().casters.PC.settings.available, ['bone_shard', 'mend', 'ward']); assert.deepEqual(source.known, ['bone_shard', 'mend', 'ward']);
  assert.equal(S.view(f.state).casters[0].items.find(i => !i.classSource).spells[0].dice, 1, 'Equipment does not bypass diminished spell strength');
  f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'PC', s => S.stat(s, 'Magic', 0)));
  assert.equal(S.view(f.state).casters[0].items.find(i => i.classSource).magic, 5); assert.equal(f.actor('PC').magic, 6);
});
test('Mortacia earns only two Magic per actual level after 50 and cannot refill by repeatedly viewing', () => {
  const f = fixture({ className: MORTACIA_CLASS, level: 50 }); S.view(f.state);
  let db = JSON.parse(f.state.getRoomNameDatabase()); db['0,0,0'].spellSystem.casters.PC.remaining = 2; f.state.setRoomNameDatabase(JSON.stringify(db));
  for (const level of [51, 52, 58, 60]) {
    const before = f.pool().casters.PC, gained = (level - before.level) * 2;
    f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'PC', s => S.stat(s, 'Level', level)));
    const c = S.view(f.state).casters[0].items.find(i => i.classSource);
    assert.equal(c.capacity, 5 + 2 * (level - 50)); assert.equal(c.magic, before.remaining + gained); assert.equal(c.castingLevel, level - 49);
    assert.equal(S.view(f.state).casters[0].items.find(i => i.classSource).magic, c.magic);
  }
  assert.equal(f.pool().casters.PC.capacity, 25); assert.equal(f.pool().casters.PC.settings.slots, 5);
});
test('Mortacia learns through scrolls, casts with diminished strength, pays costs and recharges slowly', () => {
  const scroll = R.scroll('bone_shard', 'mortacia'), f = fixture({ className: MORTACIA_CLASS, level: 50, inventory: [scroll], blankBook: true });
  let data = S.view(f.state); C.action(f.state, { runId: 'run', geoKey: '1,0,0', caster: 'PC', revision: data.revision, kind: 'scribe', item: scroll.name });
  data = S.view(f.state); C.action(f.state, { runId: 'run', geoKey: '1,0,0', caster: 'PC', revision: data.revision, kind: 'prepare', spellIds: ['bone_shard'] });
  const input = { ...f.input('bone_shard'), itemId: 'class:PC' }, result = S.cast(f.state, null, input, { combat: true, random: () => 4 });
  assert.equal(result.error, undefined); assert.equal(f.actor('Enemy').hp, 95); assert.equal(f.pool().casters.PC.remaining, 4);
  for (let i = 0; i < 5; i++) S.advance(f.state); assert.equal(f.pool().casters.PC.remaining, 4);
  S.advance(f.state); assert.equal(f.pool().casters.PC.remaining, 5);
});
test('Mortacia companion follows exactly the same diminished reserves and spell limits as the PC', () => {
  const f = fixture();
  f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'Ally', s => S.stat(S.stat(s.replace('Fighter', MORTACIA_CLASS), 'Level', 50), 'Magic', 5)));
  const c = S.view(f.state, 'Ally').casters[0].items.find(i => i.classSource);
  assert.equal(c.capacity, 5); assert.equal(c.castingLevel, 1); assert.equal(c.slots, 2); assert.equal(c.rechargeEvery, 6);
  assert.equal(c.bookPresent, true); assert.equal(f.actor('Ally').level, 50); assert.equal(f.actor('Ally').magic, 5);
});
test('items and scrolls cannot use Mortacia divine level to bypass diminished damage or healing', () => {
  for (const [id, target, die, expectedHP] of [['missile', 'Enemy', 4, 95], ['mend', 'Ally', 6, 57], ['fireball', 'Enemy', 6, 82]]) {
    const f = fixture({ className: MORTACIA_CLASS, level: 50, item: R.scroll(id, 'diminished') });
    const result = S.cast(f.state, null, f.input(id, target), { combat: true, random: () => die });
    assert.equal(result.error, undefined); assert.equal(result.ash, true); assert.equal(f.actor(target).hp, expectedHP);
    assert.equal(f.pool().casters.PC.remaining, 5, 'Class and item Magic remain distinct');
  }
});
test('old inflated Mortacia pools migrate without forgiving expenditure, losing learned spells or touching gear', () => {
  for (const spent of [0, 3, 20]) {
    const f = fixture({ className: MORTACIA_CLASS, level: 50 }); S.view(f.state);
    const db = JSON.parse(f.state.getRoomNameDatabase()), pool = db['0,0,0'].spellSystem, c = pool.casters.PC;
    c.capacity = 250; c.remaining = 250 - spent; c.settings = { ...c.settings, diminished: undefined, castingLevel: undefined, rechargeEvery: 2, rechargeAmount: 11, slots: 5 };
    c.known = ['missile', 'mend', 'ward', 'curse', 'fireball']; c.prepared = ['fireball', 'missile', 'curse', 'ward'];
    const gearId = pool.bindings['PC:Weapon']; f.state.setRoomNameDatabase(JSON.stringify(db));
    f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'PC', s => S.stat(s, 'Magic', 251 - spent)));
    const fixed = S.view(f.state).casters[0].items.find(i => i.classSource);
    assert.equal(fixed.capacity, 5); assert.equal(fixed.magic, Math.max(0, 5 - spent)); assert.deepEqual(fixed.prepared, ['ward']);
    assert.equal(fixed.known.length, 5); assert.equal(fixed.rechargeEvery, 6); assert.equal(f.actor('PC').magic, Math.max(0, 5 - spent) + 1);
    assert.equal(f.pool().items[gearId].remaining, 1); assert.equal(S.view(f.state).casters[0].items.find(i => i.classSource).magic, fixed.magic);
  }
});
function legacyAdvancement(state, text) {
  const fs = require('node:fs'), vm = require('node:vm'), source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8');
  const parser = source.slice(source.indexOf('function extractCharactersAndNpcs('), source.indexOf('function parseNpcPartyNamesFromConsole('));
  const helpers = source.slice(source.indexOf('function rollTotalHP('), source.indexOf('// Function to restart gameServer2'));
  return vm.runInNewContext(parser + helpers + '\napplyLevelAndHpAdjustments(input);', {
    input: text, sharedState: state, SpellSystem: S, console: { log() {} }, Math: Object.assign(Object.create(Math), { random: () => 0 })
  });
}
test('legacy advancement persists real accumulated Magic for unmanaged PC and NPC without repeating birth bonuses', () => {
  const f = fixture({ className: 'Necromancer' });
  let text = f.state.getUpdatedGameConsole();
  text = S.changeActor(text, 'PC', s => S.stat(S.stat(s, 'XP', 1250), 'Magic', 7));
  text = S.changeActor(text, 'Ally', s => S.stat(S.stat(s.replace('Fighter', 'Necromancer'), 'XP', 1250), 'Magic', 4));
  const advanced = legacyAdvancement(f.state, text), pc = I.parseSheets(advanced, 'PC')[0], ally = I.parseSheets(advanced, 'NPCs in Party')[0];
  assert.equal(pc.level, 2); assert.equal(pc.magic, 9); assert.equal(ally.level, 2); assert.equal(ally.magic, 6);
  assert.equal(I.parseSheets(legacyAdvancement(f.state, advanced), 'PC')[0].magic, 9);
  assert.equal(I.parseSheets(legacyAdvancement(f.state, advanced), 'NPCs in Party')[0].magic, 6);
});
test('actual XP reset advances Mortacia above 50 and class Magic is awarded exactly once with expenditure retained', () => {
  for (const name of ['PC', 'Ally']) {
    const f = fixture({ className: name === 'PC' ? MORTACIA_CLASS : 'Fighter', level: name === 'PC' ? 50 : 1 });
    if (name === 'Ally') f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), name, s => S.stat(S.stat(s.replace('Fighter', MORTACIA_CLASS), 'Level', 50), 'Magic', 5)));
    S.view(f.state); const db = JSON.parse(f.state.getRoomNameDatabase()); db['0,0,0'].spellSystem.casters[name].remaining = 2;
    f.state.setRoomNameDatabase(JSON.stringify(db)); S.view(f.state);
    const before = f.actor(name).magic;
    let text = S.changeActor(f.state.getUpdatedGameConsole(), name, s => S.stat(s, 'XP', 18816000 + 3500));
    text = legacyAdvancement(f.state, text);
    assert.equal(S.allActors(text).find(a => a.name === name).level, 51);
    assert.equal(S.allActors(text).find(a => a.name === name).magic, before, 'Managed gains belong to the authoritative class pool');
    f.state.setUpdatedGameConsole(text); const c = S.view(f.state, name).casters[0].items.find(i => i.classSource);
    assert.equal(c.capacity, 7); assert.equal(c.magic, 4); assert.equal(c.castingLevel, 2);
    assert.equal(S.view(f.state, name).casters[0].items.find(i => i.classSource).magic, 4);
  }
});
test('Necromancer party members and native monsters receive individual class pools and real spellbooks', () => {
  const f = fixture(), population = I.createPopulation('1,0,0', [{ name: 'Enemy', allegiance: 'Hostile', className: 'Necromancer' }]);
  const db = JSON.parse(f.state.getRoomNameDatabase()); db['1,0,0'].inhabitants = population; f.state.setRoomNameDatabase(JSON.stringify(db));
  f.state.setUpdatedGameConsole(S.changeActor(S.changeActor(f.state.getUpdatedGameConsole(), 'Ally', sheet => S.stat(sheet.replace('Fighter', 'Necromancer'), 'Magic', 2)),
    'Enemy', sheet => S.stat(sheet.replace('Fighter', 'Necromancer'), 'Magic', 2)));
  S.view(f.state);
  assert.equal(f.pool().casters.Ally.capacity, 2); assert.deepEqual(f.pool().casters.Ally.known, ['bone_shard', 'mend', 'ward']);
  assert.ok(S.field(f.state.getUpdatedGameConsole(), 'Inventory').includes('spellbook of ally'));
  assert.equal(f.pool().casters.Enemy.capacity, 2); assert.ok(f.pool().casters.Enemy.known.length > 0);
  assert.equal(C.ownsBook(f.state, f.pool().casters.Enemy), true);
  assert.ok(f.pool().casters.Enemy.scribingReceipts.every(r => r.consumed === true));
  const choice = f.input('bone_shard', 'PC', 'Enemy');
  assert.equal(S.cast(f.state, null, choice, { combat: true, monster: true, random: () => 1 }).error, undefined);
  assert.equal(f.pool().casters.Enemy.remaining, 1); assert.equal(f.actor('PC').hp, 98);
});
for (const className of ['Sorcerer', 'Warlock']) test(`${className} chooses level-appropriate weave spells without a book or scroll`, () => {
  const ids = className === 'Sorcerer' ? ['weave_spark', 'dawn_mending'] : ['cinder_bolt', 'pact_veil'];
  const f = fixture({ className, level: 1, enemyX: 6 }), data = S.view(f.state), source = data.casters[0].items.find(i => i.classSource);
  assert.equal(source.capacity, 3); assert.equal(source.bookRequired, false); assert.equal(source.slots, 2);
  assert.ok(C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: data.revision, caster: 'PC', kind: 'prepare', spellIds: ['fireball'] }).error);
  assert.equal(C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: data.revision, caster: 'PC', kind: 'prepare', spellIds: ids }).error, undefined);
  const input = { ...f.input(ids[0]), itemId: source.id };
  assert.equal(S.cast(f.state, null, input, { combat: true, random: () => 1 }).error, undefined); assert.equal(f.pool().casters.PC.remaining, 2);
  assert.equal(S.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
});
test('learning consumes metadata too and stale browser snapshots cannot resurrect a scribed scroll', () => {
  const scroll = R.scroll('mend', 'learning'), f = fixture({ className: 'Necromancer', inventory: [scroll], blankBook: true }), before = f.state.getUpdatedGameConsole(), data = S.view(f.state);
  C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: data.revision, caster: 'PC', kind: 'scribe', item: scroll.name });
  const stale = S.preserve(f.state, before);
  assert.ok(!S.field(stale.text, 'Inventory').includes(scroll.name));
  assert.ok(!Inventory.parseProperties(S.field(stale.text, 'Inventory Properties')).some(p => p.name === scroll.name));
  assert.deepEqual(f.pool().casters.PC.known, ['mend']);
});
test('missing spellbooks, over-limit preparation and non-spell scrolls cannot bypass learning', () => {
  const f = fixture({ className: 'Witch' }), data = S.view(f.state);
  const input = { runId: 'run', geoKey: '1,0,0', revision: data.revision, caster: 'PC', kind: 'scribe', item: 'invented scroll' };
  assert.ok(C.action(f.state, input).error);
  f.state.setUpdatedGameConsole(S.write(S.write(f.state.getUpdatedGameConsole(), 'Inventory', 'Empty'), 'Inventory Properties', 'None'));
  assert.match(C.action(f.state, input).error, /spellbook/);
});
test('level-up increases class Magic capacity without repeating birth bonuses; recharge gets faster', () => {
  const f = fixture({ className: 'Sorcerer' }); S.view(f.state); const before = f.actor('PC').magic;
  f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'PC', s => S.stat(s, 'Level', 8)));
  S.view(f.state); assert.equal(f.pool().casters.PC.capacity, 24); assert.equal(f.actor('PC').magic, before + 21);
  S.view(f.state); assert.equal(f.actor('PC').magic, before + 21); assert.equal(f.pool().casters.PC.settings.rechargeEvery, 4);
});
test('empty class pools preserve spellbooks, and equipped item charges do not recharge with class Magic', () => {
  const scroll = R.scroll('missile', 'pool'), f = fixture({ className: 'Wizard', inventory: [scroll], blankBook: true });
  let data = S.view(f.state); C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: data.revision, caster: 'PC', kind: 'scribe', item: scroll.name });
  data = S.view(f.state); C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: data.revision, caster: 'PC', kind: 'prepare', spellIds: ['missile'] });
  for (let i = 0; i < 2; i++) assert.equal(S.cast(f.state, null, { ...f.input(), itemId: 'class:PC' }, { combat: true, random: () => 1 }).ash, false);
  assert.equal(f.pool().casters.PC.remaining, 0); assert.ok(S.field(f.state.getUpdatedGameConsole(), 'Inventory').includes('spellbook of pc'));
  const gear = f.input(); S.cast(f.state, null, gear, { combat: true, random: () => 1 });
  for (let i = 0; i < 6; i++) S.advance(f.state);
  assert.equal(f.pool().casters.PC.remaining, 1); assert.equal(f.pool().items[gear.itemId].status, 'ash');
});
test('every spell uses explicit, monotonic level tables while charge cost remains fixed', () => {
  for (const id of Object.keys(R.templates)) {
    let previous = 0;
    for (let level = 1; level <= 20; level++) {
      const s = R.classSpell(id, level), power = s.dice || s.absorb || s.penalty || s.maxTargets;
      assert.equal(s.cost, R.templates[id].cost); assert.ok(power >= previous); previous = power;
    }
  }
  assert.equal(R.classSpell('missile', 1).dice, 1); assert.equal(R.classSpell('missile', 9).dice, 5);
  assert.equal(R.classSpell('missile', 9).bonus, 5); assert.equal(R.classSpell('mend', 13).dice, 4); assert.equal(R.classSpell('mend', 13).bonus, 5);
  assert.equal(R.classSpell('ward', 19).absorb, 16); assert.equal(R.classSpell('curse', 11).penalty, 4);
  assert.deepEqual([1, 3, 6, 9].map(l => R.classSettings('Wizard', l).slots), [2, 3, 4, 5]);
});
test('a scroll with nonstandard Magic spends that exact value once and a book retains the cost as power grows', () => {
  const scroll = { ...R.scroll('missile', 'three-charge'), magic: 3 };
  const single = fixture({ item: scroll, level: 9 });
  const result = S.cast(single.state, null, single.input(), { combat: true, random: () => 2 });
  assert.equal(result.ash, true); assert.equal(single.actor('Enemy').hp, 85); assert.equal(single.actor('PC').magic, 0);
  const f = fixture({ className: 'Wizard', level: 9, inventory: [scroll], blankBook: true }), data = S.view(f.state);
  C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: data.revision, caster: 'PC', kind: 'scribe', item: scroll.name });
  let v = S.view(f.state); C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: v.revision, caster: 'PC', kind: 'prepare', spellIds: ['missile'] });
  v = S.view(f.state); const learned = v.casters[0].items.find(i => i.classSource).spells[0];
  assert.equal(learned.cost, 3); assert.equal(learned.dice, 5); assert.equal(learned.bonus, 5);
});
test('scribing rests are short, decrease with level, count actual turns and cannot be replayed', () => {
  for (const [level, turns] of [[1, 3], [5, 2], [10, 1]]) {
    const scroll = R.scroll('coven_mending', 'rest'), f = fixture({ className: 'Witch', level, inventory: [scroll], blankBook: true }), data = S.view(f.state);
    const input = { runId: 'run', geoKey: '1,0,0', revision: data.revision, caster: 'PC', kind: 'scribe', item: scroll.name, nonce: 'scribe-rest-test' };
    assert.equal(C.action(f.state, input).turns, turns); assert.equal(Number(S.field(f.state.getUpdatedGameConsole(), 'Turns')), turns);
    assert.equal(f.pool().clock, turns); assert.equal(C.action(f.state, input).duplicate, true); assert.equal(f.pool().clock, turns);
  }
});
test('a hostile within encounter reach prevents scribing without consuming the scroll or advancing time', () => {
  const scroll = R.scroll('missile', 'threat'), f = fixture({ className: 'Wizard', inventory: [scroll] }), data = S.view(f.state);
  const roster = JSON.parse(f.state.getCombatCharactersString()); roster.find(a => a.name === 'Enemy').mazeX = 3; f.state.setCombatCharactersString(JSON.stringify(roster));
  assert.match(C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: data.revision, caster: 'PC', kind: 'scribe', item: scroll.name }).error, /nearby hostile/);
  assert.ok(S.field(f.state.getUpdatedGameConsole(), 'Inventory').includes(scroll.name)); assert.equal(f.pool().clock, 0);
});
test('burned quest equipment fails its actual task and stages a harder real item and guards on the same boss path', () => {
  const f = fixture();
  const task = Q.compileGeneratedTask({ id: 'fetch', type: 'Fetch', requiredElements: [{ type: 'weapon', name: f.item.name, placement: '1,0,0' }] }, JSON.parse(f.state.getRoomNameDatabase()), '1,0,0');
  assert.ok(task.hardRequirements.some(r => r.check === 'inventory_magic_min'));
  f.state.setCurrentTasks([task]); S.cast(f.state, null, f.input(), { combat: true, random: () => 1 });
  assert.equal(f.state.getCurrentTasks()[0].status, 'Failed');
  const recovery = require('../retort/questFailure').recover(f.state, '1,0,0'), db = JSON.parse(f.state.getRoomNameDatabase());
  assert.equal(recovery.recoveryAttempt, 1); assert.equal(recovery.guardElements.length, 1);
  assert.ok(db['1,0,0'].objects.some(o => o.name === recovery.requiredElements[0].name && o.magic > 0));
  assert.equal(db['2,0,0'].bossGate.status, 'locked'); assert.equal(db['0,0,0'].questFailures.length, 1);
  assert.ok(recovery.hardRequirements.some(r => r.check === 'monster_hp_zero'));
  const guard = Object.values(db['1,0,0'].inhabitants.actors)[0]; assert.equal(guard.hp, 22); assert.equal(I.parseBlocks(guard.sheet)[0].state, 'Hostile');
  assert.match(Q.describeQuestRequirements(recovery, db), /Ash Hall/);
});
function serverFixture(options) {
  const fs = require('node:fs'), vm = require('node:vm'), f = fixture(options), routes = new Map(), calls = [];
  const population = I.createPopulation('1,0,0', [{ name: 'Enemy', allegiance: 'Hostile' }]);
  f.state.getRoomPopulation = () => population;
  const source = fs.readFileSync('server.js', 'utf8'), body = source.slice(source.indexOf('function spellStateEvent('), source.indexOf("app.post('/economy/view'"));
  const ctx = { app: { post: (path, fn) => routes.set(path, fn) }, sharedState: f.state, SpellSystem: S, ClassMagic: C, Inhabitants: I,
    console: { warn() {} }, inputTaskInFlight: false, broadcast: event => calls.push(event),
    require: path => path.startsWith('node:') ? require(path) : require('../' + path.slice(2)),
    prepareQuestScene: req => req.body.runId !== 'run' || req.body.geoKey !== '1,0,0' || ctx.inputTaskInFlight ? { error: 'stale', status: 409 } : {},
    populationService: { get: () => population, save() {} },
    retortWithUserInput: async (command, broadcast, mode, request) => { calls.push({ command, request }); return { content: 'Initiative started.' }; } };
  f.state.getCombatMode = () => 'Combat Map-Based'; vm.runInNewContext(body, ctx);
  const post = async (path, input) => {
    let status = 200, value; const res = { status(n) { status = n; return this; }, json(v) { value = v; return this; } };
    await routes.get(path)({ body: input }, res); return { status, value };
  };
  return { ...f, post, calls, ctx };
}
test('real spell view endpoint exposes canonical scroll metadata, choices, scaled spells and no time advance', async () => {
  const f = serverFixture({ className: 'Wizard', inventory: [R.scroll('mend', 'view')] });
  const response = await f.post('/spells/view', { runId: 'run', geoKey: '1,0,0' });
  assert.equal(response.status, 200); assert.equal(response.value.scrolls[0].spell_scroll, 'mend');
  assert.equal(response.value.spellResult.type, 'spell_result'); assert.equal(f.pool().clock, 0);
  assert.equal((await f.post('/spells/view', { runId: 'other', geoKey: '1,0,0' })).status, 409);
});
test('real preparation endpoint enforces transaction IDs, consumes one scroll once and records rest time', async () => {
  const scroll = R.scroll('coven_mending', 'server'), f = serverFixture({ className: 'Witch', inventory: [scroll], blankBook: true });
  const data = await f.post('/spells/view', { runId: 'run', geoKey: '1,0,0' });
  const input = { runId: 'run', geoKey: '1,0,0', revision: data.value.revision, caster: 'PC', kind: 'scribe', item: scroll.name };
  assert.equal((await f.post('/spells/prepare', input)).status, 400);
  const result = await f.post('/spells/prepare', { ...input, nonce: 'prepare-test-transaction' });
  assert.equal(result.status, 200); assert.equal(result.value.turns, 3); assert.equal(f.pool().clock, 3);
  assert.equal((await f.post('/spells/prepare', { ...input, nonce: 'prepare-test-transaction' })).value.duplicate, true);
  assert.equal(f.pool().clock, 3); assert.equal(f.ctx.inputTaskInFlight, false);
});
test('real cast endpoint ignores supplied damage, heals actual HP and refuses replay changes', async () => {
  const f = serverFixture({ item: R.scroll('mend', 'server') }), input = { ...f.input('mend', 'Ally'), damage: 999999, cost: 0 };
  const response = await f.post('/spells/cast', input);
  assert.equal(response.status, 200); assert.equal(response.value.ash, true); assert.ok(f.actor('Ally').hp >= 52 && f.actor('Ally').hp <= 57);
  assert.equal(f.pool().clock, 1); assert.equal((await f.post('/spells/cast', input)).value.duplicate, true); assert.equal(f.pool().clock, 1);
  assert.equal((await f.post('/spells/cast', { ...input, target: 'PC' })).status, 409); assert.equal(f.ctx.inputTaskInFlight, false);
});
test('offensive endpoint enters initiative instead of applying an immediate free hit', async () => {
  const f = serverFixture(), input = f.input();
  const response = await f.post('/spells/cast', input); assert.equal(response.status, 200);
  assert.equal(f.actor('Enemy').hp, 100); assert.equal(f.pool().items[input.itemId].remaining, 1);
  const call = f.calls.find(c => c.command); assert.equal(call.command, 'attack Enemy'); assert.equal(call.request.spellOpening, true);
  assert.equal(S.takeOpening(f.state, 'PC'), null, 'Opening queue is cleared after the encounter resolves');
});

test('the five player traditions have disjoint, mechanically differentiated catalogs and real unlock levels', () => {
  const seen = new Set();
  for (const name of ['Wizard', 'Witch', 'Sorcerer', 'Warlock', 'Necromancer']) {
    assert.ok(R.traditions[name]); assert.ok(R.catalog(name).length >= 6);
    for (const id of R.catalog(name)) {
      assert.ok(!seen.has(id)); seen.add(id);
      const t = R.templates[id]; assert.equal(t.tradition, name);
      assert.ok(R.classSettings(name, t.minLevel).available.includes(id));
      if (t.minLevel > 1) assert.ok(!R.classSettings(name, t.minLevel - 1).available.includes(id));
      assert.ok(t.cost <= R.classSettings(name, t.minLevel).capacity);
    }
  }
  assert.ok(!R.catalog('Wizard').some(id => R.templates[id].effect === 'heal'));
  assert.ok(!R.catalog('Warlock').some(id => R.templates[id].effect === 'heal'));
  assert.ok(R.templates.dawn_mending.range > R.templates.coven_mending.range);
  assert.ok(R.templates.fireball.radius > R.templates.abyssal_pyre.radius);
  assert.ok(R.templates.ruin_brand.sides > R.templates.death_sentence.sides);
});

test('generated scrolls identify only book traditions and preserve flat class metadata through loot parsing', () => {
  for (const id of R.scrollIds) {
    const scroll = R.scroll(id, 'catalog');
    assert.equal(scroll.spell_class, R.templates[id].tradition); assert.equal(scroll.spell_min_level, R.templates[id].minLevel);
    assert.match(scroll.description, /Only a/); assert.equal(scroll.magic, R.templates[id].cost);
    assert.equal(I.parseEquipmentProperties(JSON.stringify(scroll))[0].spell_class, scroll.spell_class);
    assert.equal(Inventory.parseProperties(JSON.stringify(scroll))[0].spell_min_level, scroll.spell_min_level);
    for (const name of ['Wizard', 'Witch', 'Necromancer']) assert.equal(R.canLearn(name, id), name === scroll.spell_class);
  }
  for (const name of ['Sorcerer', 'Warlock', 'Cleric']) for (const id of R.catalog(name)) assert.equal(R.scroll(id), null);
});

test('actual room seeding supplies class-labeled readable formulas and excludes low-level Turn Undead loot', () => {
  const E = require('../retort/economy'), found = new Set();
  for (let n = 0; n < 64; n++) {
    const db = { '0,0,0': { name: 'Entrance' } }, population = I.createPopulation('0,0,0', [{ name: 'Keeper', class: 'Wizard', allegiance: 'Neutral' }]);
    E.seedRoom(db, '0,0,0', population, 'scroll-test-' + n, '');
    const scroll = db['0,0,0'].objects.find(o => o.spell_scroll);
    assert.ok(R.scrollIds.includes(scroll.spell_scroll)); assert.notEqual(scroll.spell_scroll, 'turn_undead'); found.add(scroll.spell_class);
    const readable = db['0,0,0'].readables.find(r => r.name === scroll.name);
    assert.ok(readable.chapters[0].text.includes('Only a ' + scroll.spell_class));
    for (const item of population.actors.Keeper.inventory || []) if (item.spell_scroll) assert.equal(item.spell_class, 'Wizard');
  }
  assert.deepEqual([...found].sort(), ['Necromancer', 'Witch', 'Wizard']);
});

for (const [name, wrong] of [['Wizard', 'bone_shard'], ['Witch', 'missile'], ['Necromancer', 'coven_mending'], [MORTACIA_CLASS, 'missile']]) {
  test(`${name} rejects cross-tradition scribing even when the scroll's class label is forged`, () => {
    const scroll = { ...R.scroll(wrong, 'forged'), spell_class: name }, f = fixture({ className: name, level: name === MORTACIA_CLASS ? 50 : 3, inventory: [scroll] });
    const data = S.view(f.state), before = f.state.getUpdatedGameConsole(), clock = f.pool().clock;
    const result = C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: data.revision, caster: 'PC', kind: 'scribe', item: scroll.name });
    assert.match(result.error, /Only .* spellcasters/); assert.equal(f.state.getUpdatedGameConsole(), before);
    assert.equal(f.pool().clock, clock); assert.deepEqual(f.pool().casters.PC.known, C.starterSpells(f.pool().casters.PC.settings));
  });
}

test('a matching advanced scroll may be learned early but cannot be prepared until its actual level unlock', () => {
  const scroll = R.scroll('force_lance', 'early'), f = fixture({ className: 'Wizard', inventory: [scroll] });
  let data = S.view(f.state);
  assert.equal(C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: data.revision, caster: 'PC', kind: 'scribe', item: scroll.name }).error, undefined);
  const prepare = () => C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: S.view(f.state).revision, caster: 'PC', kind: 'prepare', spellIds: ['force_lance'] });
  assert.ok(prepare().error); assert.deepEqual(f.pool().casters.PC.known, [...C.starterSpells(f.pool().casters.PC.settings), 'force_lance']);
  f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'PC', s => S.stat(s, 'Level', 6)));
  assert.equal(prepare().error, undefined); assert.equal(f.pool().casters.PC.spells[0].cost, scroll.magic);
});

for (const [name, starter, unlocked, other] of [['Sorcerer', 'weave_spark', 'sunburst', 'cinder_bolt'], ['Warlock', 'cinder_bolt', 'abyssal_pyre', 'weave_spark']]) {
  test(`${name} gains only its own new weave choices on level-up, without forgetting preparation or refilling spent Magic`, () => {
    const f = fixture({ className: name, enemyX: 6 }); let v = S.view(f.state);
    assert.ok(C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: v.revision, caster: 'PC', kind: 'prepare', spellIds: [other] }).error);
    assert.equal(C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: v.revision, caster: 'PC', kind: 'prepare', spellIds: [starter] }).error, undefined);
    S.cast(f.state, null, { ...f.input(starter), itemId: 'class:PC' }, { combat: true, random: () => 1 });
    assert.equal(f.pool().casters.PC.remaining, 2);
    f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'PC', s => S.stat(s, 'Level', 3)));
    v = S.view(f.state); const c = v.casters[0].items.find(i => i.classSource);
    assert.equal(c.magic, 8); assert.deepEqual(c.prepared, [starter]);
    assert.ok(c.learnable.find(s => s.id === unlocked).available); assert.ok(!c.learnable.some(s => s.id === other));
    assert.equal(S.view(f.state).casters[0].items.find(i => i.classSource).magic, 8);
  });
}

test('same-level catalog migration removes incompatible preparation without erasing learned receipts or replenishing Magic', () => {
  const f = fixture({ className: 'Witch', level: 3 }); S.view(f.state);
  const db = JSON.parse(f.state.getRoomNameDatabase()), c = db['0,0,0'].spellSystem.casters.PC;
  c.settings.catalogVersion = 1; c.settings.available = ['missile', 'mend', 'curse', 'ward', 'fireball'];
  c.remaining = 2; c.known = ['missile', 'curse']; c.prepared = ['missile', 'curse']; c.scribingReceipts = [{ item: 'spent old scroll' }];
  f.state.setRoomNameDatabase(JSON.stringify(db));
  const source = S.view(f.state).casters[0].items.find(i => i.classSource);
  assert.equal(source.magic, 2); assert.deepEqual(source.known, ['missile', 'curse']); assert.deepEqual(source.prepared, ['curse']);
  assert.equal(f.pool().casters.PC.scribingReceipts.length, 1); assert.equal(f.pool().casters.PC.settings.catalogVersion, R.catalogVersion);
  assert.match(source.learnable.find(s => s.id === 'missile').unavailableReason, /Different/);
});

function nativeFixture(archetype, title = 'Crypt Keeper', preferences = []) {
  const f = fixture(), p = I.createPopulation('1,0,0', [{ name: 'Enemy', class: title, combatArchetype: archetype, spellPreferences: preferences, allegiance: 'Hostile' }]);
  const db = JSON.parse(f.state.getRoomNameDatabase()); db['1,0,0'].inhabitants = p; f.state.setRoomNameDatabase(JSON.stringify(db));
  f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'Enemy', s => S.stat(s.replace('Fighter', title), 'Level', 3)));
  S.view(f.state); return f;
}
for (const archetype of R.archetypes) test(`a custom ${archetype} native retains its title and receives bounded, level-appropriate individual rules`, () => {
  const preferred = R.classSettings(archetype, 3)?.available.slice(-1) || [], f = nativeFixture(archetype, 'Crypt Keeper', [...preferred, 'invented', 'force_lance']);
  assert.equal(f.actor('Enemy').className, `Crypt Keeper [rules: ${archetype}]`);
  assert.equal(f.pool().combatProfiles.Enemy.rulesClass, archetype);
  const c = f.pool().casters.Enemy;
  if (archetype === 'Fighter') { assert.equal(c, undefined); assert.equal(f.actor('Enemy').magic, 0); return; }
  assert.equal(c.capacity, R.classes[archetype].pointsPerLevel * 3); assert.equal(f.actor('Enemy').magic, c.capacity);
  assert.equal(c.prepared[0], preferred[0]); assert.ok(c.prepared.length <= c.settings.slots);
  assert.ok(c.prepared.every(id => R.classSettings(archetype, 3).available.includes(id)));
  if (c.settings.spellbook) assert.ok(c.scribingReceipts.every(r => r.consumed && r.scroll.spell_class === archetype));
});

test('a recruited custom spellcaster keeps its personal preparation, expenditure and physical spellbook, without a recruitment grant', () => {
  const f = nativeFixture('Witch', 'Sand Oracle', ['thorn_needle']);
  assert.equal(S.cast(f.state, null, f.input('thorn_needle', 'PC', 'Enemy'), { combat: true, monster: true, random: () => 1 }).error, undefined);
  const before = f.pool().casters.Enemy, enemy = f.actor('Enemy');
  let text = f.state.getUpdatedGameConsole().replace(enemy.rawSheet, '');
  text = text.replace(I.sectionPattern('NPCs in Party'), (_, header, body) => header + body + '\n' + enemy.rawSheet.replace('State: Hostile', 'State: Friendly') + '\n');
  f.state.setUpdatedGameConsole(text); require('../retort/economy').refresh(f.state);
  const roster = JSON.parse(f.state.getCombatCharactersString()); roster.find(a => a.name === 'Enemy').type = 'npc'; f.state.setCombatCharactersString(JSON.stringify(roster));
  const source = S.view(f.state, 'Enemy').casters[0].items.find(i => i.classSource);
  assert.equal(source.magic, before.remaining); assert.deepEqual(source.prepared, before.prepared); assert.equal(source.bookPresent, true);
  assert.equal(source.className, 'Sand Oracle [rules: Witch]'); assert.equal(source.tradition, 'Witch');
  assert.equal(S.view(f.state, 'Enemy').casters[0].items.find(i => i.classSource).magic, before.remaining);
});

test('saved native archetypes cannot be rewritten by a stale or fabricated recruited-character sheet', () => {
  const f = nativeFixture('Fighter'), original = f.actor('Enemy').className;
  const forged = S.changeActor(f.state.getUpdatedGameConsole(), 'Enemy', s => s.replace(original, 'Crypt Keeper [rules: Warlock]'));
  assert.equal(I.parseSheets(S.preserve(f.state, forged).text).find(a => a.name === 'Enemy').className, original);
  f.state.setUpdatedGameConsole(forged); S.view(f.state);
  assert.equal(f.actor('Enemy').className, original); assert.equal(f.pool().casters.Enemy, undefined);
});

for (const archetype of ['Fighter', 'Cleric', 'Warlock']) test(`recruited custom ${archetype} advancement uses its real rules and never creates warrior Magic`, () => {
  const f = fixture(), className = `Ash Veteran [rules: ${archetype}]`, startMagic = R.classes[archetype]?.pointsPerLevel || 0;
  f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'Ally', s => S.stat(s.replace('Fighter', className), 'Magic', startMagic)));
  S.view(f.state); const oldHP = f.actor('Ally').hp;
  const text = legacyAdvancement(f.state, S.changeActor(f.state.getUpdatedGameConsole(), 'Ally', s => S.stat(s, 'XP', archetype === 'Warlock' ? 1500 : 1750)));
  f.state.setUpdatedGameConsole(text); S.view(f.state);
  assert.equal(f.actor('Ally').level, 2); assert.equal(f.actor('Ally').hp, oldHP + 1); assert.equal(f.actor('Ally').className, className);
  assert.equal(f.actor('Ally').magic, startMagic * 2);
  if (archetype === 'Fighter') assert.equal(f.pool().casters.Ally, undefined);
});

function turningFixture(level = 7, options = {}) {
  const scroll = R.scroll('turn_undead', 'turning'), f = fixture({ className: 'Necromancer', level, inventory: [scroll], enemyX: 7, ...options });
  f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'Enemy', s => S.stat(s.replace('Human', 'Wraith'), 'Level', 3)));
  let v = S.view(f.state);
  C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: v.revision, caster: 'PC', kind: 'scribe', item: scroll.name });
  v = S.view(f.state); C.action(f.state, { runId: 'run', geoKey: '1,0,0', revision: v.revision, caster: 'PC', kind: 'prepare', spellIds: ['turn_undead'] });
  return f;
}
function extraUndead(f, name, x, y, race = 'Wraith', state = 'Hostile') {
  const sheet = f.actor('Enemy').rawSheet.replace(/^Enemy/, name).replace('Wraith', race).replace('State: Hostile', 'State: ' + state);
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace(/^Monsters Equipped Properties:/m, sheet + '\nMonsters Equipped Properties:'));
  const roster = JSON.parse(f.state.getCombatCharactersString()); roster.push({ name, type: 'monster', hp: 100, mazeX: x, mazeY: y, mazeRoomKey: '1,0,0' }); f.state.setCombatCharactersString(JSON.stringify(roster));
}

test('Turn Undead unlocks at seven, and diminished Mortacia must reach recovered seven rather than divine fifty', () => {
  assert.equal(R.templates.turn_undead.minLevel, 7); assert.equal(R.templates.turn_undead.cost, 5);
  assert.ok(!R.classSettings('Necromancer', 6).available.includes('turn_undead'));
  assert.ok(R.classSettings('Necromancer', 7).available.includes('turn_undead'));
  assert.ok(!R.classSettings(MORTACIA_CLASS, 50).available.includes('turn_undead'));
  assert.ok(R.classSettings(MORTACIA_CLASS, 56).available.includes('turn_undead'));
  for (const [className, level] of [['Fighter', 6], [MORTACIA_CLASS, 50]]) {
    const f = fixture({ className, level, item: R.scroll('turn_undead', 'blocked') });
    assert.match(S.cast(f.state, null, f.input('turn_undead'), { combat: true }).error, /casting level 7/);
  }
});

for (const [level, count, turns] of [[7, 1, 1], [11, 2, 2], [15, 3, 2], [50, 3, 2]]) test(`level ${level} turning affects at most ${count} weaker undead for ${turns} actions, never an entire four-monster encounter`, () => {
  const f = turningFixture(level);
  for (const [name, x, y] of [['Shade Two', 7, 3], ['Shade Three', 8, 2], ['Shade Four', 8, 3]]) extraUndead(f, name, x, y);
  extraUndead(f, 'Neutral Shade', 6, 2, 'Wraith', 'Neutral'); extraUndead(f, 'Ordinary Guard', 6, 3, 'Human');
  const input = { ...f.input('turn_undead'), itemId: 'class:PC' }, before = f.pool().casters.PC.remaining;
  assert.equal(S.rollPlan(f.state, input, { combat: true }).length, count);
  const result = S.cast(f.state, null, input, { combat: true, random: () => 1 });
  assert.equal(result.error, undefined); assert.equal(result.changes.length, count); assert.ok(result.changes.every(c => c.effect === 'turn' && c.hp === 100));
  assert.equal(f.pool().effects.filter(e => e.kind === 'turn').length, count); assert.equal(S.turned(f.state, f.actor('Enemy')).remainingTurns, turns);
  assert.equal(f.pool().casters.PC.remaining, before - 5);
  assert.equal(result.changes.some(c => c.name === 'Neutral Shade' || c.name === 'Ordinary Guard'), false);
});

test('turning allows a real save, cannot affect peers, bosses or deities, and charges for a resisted cast', () => {
  const f = turningFixture(), input = { ...f.input('turn_undead'), itemId: 'class:PC' };
  const result = S.cast(f.state, null, input, { combat: true, random: () => 20 });
  assert.equal(result.error, undefined); assert.equal(result.changes[0].effect, 'resisted turning'); assert.equal(S.turned(f.state, f.actor('Enemy')), null);
  assert.equal(f.pool().casters.PC.remaining, 9);
  for (const immune of ['peer', 'boss', 'deity', 'mortal']) {
    const g = turningFixture();
    if (immune === 'peer') g.state.setUpdatedGameConsole(S.changeActor(g.state.getUpdatedGameConsole(), 'Enemy', s => S.stat(s, 'Level', 6)));
    if (immune === 'mortal') g.state.setUpdatedGameConsole(S.changeActor(g.state.getUpdatedGameConsole(), 'Enemy', s => s.replace('Wraith', 'Human')));
    if (immune === 'boss' || immune === 'deity') {
      const db = JSON.parse(g.state.getRoomNameDatabase());
      if (immune === 'boss') db['1,0,0'].bossGate = { bossName: 'Enemy' };
      else db['1,0,0'].inhabitants = { actors: { Enemy: { deityId: 'deity:Enemy' } } };
      g.state.setRoomNameDatabase(JSON.stringify(db));
    }
    assert.match(S.cast(g.state, null, { ...g.input('turn_undead'), itemId: 'class:PC' }, { combat: true }).error, /weaker undead/);
    assert.equal(g.pool().casters.PC.remaining, 14);
  }
});

test('turning cooldown spans sources, damage breaks turning, and withdrawal expires after exactly its allotted actions', () => {
  const f = turningFixture(), input = { ...f.input('turn_undead'), itemId: 'class:PC' };
  S.cast(f.state, null, input, { combat: true, random: () => 1 });
  const scroll = R.scroll('turn_undead', 'second-source');
  f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'PC', s => s.replace('Other: None', 'Other: ' + scroll.name)));
  f.state.setUpdatedGameConsole(S.write(f.state.getUpdatedGameConsole(), 'Party Equipped Properties', S.field(f.state.getUpdatedGameConsole(), 'Party Equipped Properties') + ', ' + JSON.stringify({ ...scroll, owner: 'PC', slot: 'Other' })));
  const other = f.input('turn_undead'); assert.notEqual(other.itemId, 'class:PC');
  assert.match(S.cast(f.state, null, other, { combat: true }).error, /cooldown/); assert.equal(f.pool().items[other.itemId].remaining, 5);
  assert.match(S.cast(f.state, null, { ...f.input('turn_undead'), itemId: 'class:PC' }, { combat: true }).error, /cooldown/);
  assert.equal(S.absorb(f.state, f.actor('Enemy'), 0), 0); assert.ok(S.turned(f.state, f.actor('Enemy')));
  assert.equal(S.absorb(f.state, f.actor('Enemy'), 1), 1); assert.equal(S.turned(f.state, f.actor('Enemy')), null);
  for (let i = 0; i < 4; i++) S.advance(f.state);
  assert.equal(S.cast(f.state, null, { ...f.input('turn_undead'), itemId: 'class:PC' }, { combat: true, random: () => 1 }).error, undefined);
  S.consumeTurn(f.state, f.actor('Enemy')); assert.equal(S.turned(f.state, f.actor('Enemy')).remainingTurns, 0);
  S.advance(f.state); assert.equal(S.turned(f.state, f.actor('Enemy')), null);
});
