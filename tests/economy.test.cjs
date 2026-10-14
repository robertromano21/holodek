'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../retort/economy'), R = require('../assets/economyRules'), I = require('../assets/dungeonInhabitants');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
const Give = require('../retort/itemTransfer');
const { createPopulationService } = require('../retort/roomPopulation');
const Puzzles = require('../assets/physicalPuzzles');
function fixture() {
  const geoKey = '1,0,0', d = { geoKey, start: { x: 4, y: 4 }, layout: { width: 16, height: 16 }, cells: {}, sceneObjects: [], tiles: {} };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
  const row = (name, hp = 12) => sheet({ Name: name, Sex: 'Female', Race: 'Human', Class: 'Cleric', Level: 2, AC: 10, HP: hp, MaxHP: 20 }, 6, name === 'Benedict' ? 'pc' : 'npc');
  const p = I.createPopulation(geoKey, [{ name: 'Keeper', race: 'Human', className: 'Cleric', allegiance: 'Neutral', job: 'toll-keeper', encounterId: 'keeper' }]);
  Object.assign(p.actors.Keeper, { hp: 12, position: { x: 5, y: 4 }, home: { x: 5, y: 4 }, sheet: row('Keeper') });
  p.groups[0].site = { x: 5, y: 4 };
  let text = `Room Name: Amber Well Market\nCoordinates: X: 1, Y: 0, Z: 0\nSilver Pieces: 0\nCurrent Quest: None\nQuest Progress: None\nInventory: Empty\nInventory Properties: None\nObjects in Room: None\nObjects in Room Properties: None\nPC:\n${row('Benedict')}\nNPCs in Party:\n${row('Ally')}\nMonsters in Room:\n${row('Keeper').replace('State: Friendly', 'State: Neutral')}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nRooms Visited: 2`;
  let wire = JSON.stringify([{ name: 'Benedict', type: 'pc', hp: 12, mazeX: 4, mazeY: 4, mazeRoomKey: geoKey },
    { name: 'Ally', type: 'npc', hp: 12, mazeX: 4, mazeY: 5, mazeRoomKey: geoKey },
    { name: 'Keeper', type: 'monster', hp: 12, state: 'Neutral', mazeX: 5, mazeY: 4, mazeRoomKey: geoKey }]);
  let db = JSON.stringify({ '0,0,0': {}, [geoKey]: { name: 'Amber Well Market', objects: [], inhabitants: p, monsters: { inRoom: row('Keeper') } } });
  let paused = false;
  const state = { getDungeonRunId: () => 'test-run', getLastCoords: () => ({ x: 1, y: 0, z: 0 }),
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getRoomNameDatabase: () => db, setRoomNameDatabase: v => db = v,
    getCombatCharactersString: () => wire, setCombatCharactersString: v => wire = v,
    getRoomPopulation: k => k === geoKey ? p : null, setRoomPopulation: (k, value) => { if (k === geoKey && value !== p) Object.assign(p, value); },
    getRoomDungeonForSimulation: () => d, getCurrentTasks: () => [], getCurrentTaskIndex: () => 0,
    getGamePaused: () => paused };
  const service = createPopulationService(state);
  E.start(state, { Name: 'Benedict' }, [{ Name: 'Ally' }, { Name: 'Mortacia' }]);
  let seq = 0;
  const objectView = { names: [], camera: { x: 4.5, y: 4.5, eyeZ: .65, dirX: 0, dirY: 1, planeScale: .577, verticalScale: 1.73, viewShift: 0, aspect: 1.8 } };
  const action = input => E.action(state, service, { runId: 'test-run', geoKey, revision: E.project(state).revision, nonce: 'test-action:' + ++seq,
    objectView: { ...objectView, names: d.sceneObjects.map(o => o.name) }, ...input });
  const change = fn => { const data = JSON.parse(db); fn(data); db = JSON.stringify(data); };
  const inventory = (item, count = 1) => { text = E.write(E.write(text, 'Inventory', Array(count).fill(item.name).join(', ')), 'Inventory Properties', JSON.stringify(item)); };
  const business = kind => { change(data => data[geoKey].services = { shop: { id: 'shop', kind, operator: 'Keeper', originalOperator: 'Keeper', stock: [{ ...R.healingPotion(6), quantity: 2 }], till: 12, revision: 0 } }); };
  return { state, service, action, change, inventory, business, p, d, row, book: () => E.project(state), pause: () => paused = true, db: () => JSON.parse(db) };
}
test('initial pooled silver excludes Mortacia and is never an inventory property', () => {
  assert.equal(R.startingSilver({ Name: 'Mortacia' }), 0);
  assert.equal(R.startingSilver({ Name: 'Suzerain' }), 1);
  assert.equal(R.startingSilver({ Name: 'PC' }, ['A', 'B', 'C', 'D', 'E', 'Mortacia'].map(Name => ({ Name }))), 6);
  assert.equal(R.startingSilver({ Name: 'PC' }, [{ Name: 'PC' }, { Name: 'Mortacia' }]), 1);
  const f = fixture(); assert.equal(f.book().silver, 2);
  E.start(f.state, { Name: 'Benedict' }, [{ Name: 'Ally' }]); assert.equal(f.book().silver, 2);
  assert.match(f.state.getUpdatedGameConsole(), /^Silver Pieces: 2$/m);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory Properties'), 'None');
});

test('drop all preserves equipped gear and cannot be undone by an older browser inventory', () => {
  const f = fixture(), sword = { name: 'bronze sword', type: 'weapon', attack_modifier: 1, damage_modifier: 2, ac: 0, magic: 0 };
  f.inventory(sword); assert.ok(!f.action({ kind: 'equip', item: sword.name }).error);
  const potion = R.healingPotion(4); f.inventory(potion, 2);
  const before = f.state.getUpdatedGameConsole();
  const result = f.action({ kind: 'drop-all' }); assert.ok(!result.error, result.error);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  assert.equal(I.parseEquipment(I.parseSheets(f.state.getUpdatedGameConsole(), 'PC')[0].lines[9]).Weapon, sword.name);
  assert.equal(f.db()['1,0,0'].objects.find(o => o.name === potion.name).quantity, 2);
  const repaired = E.preserveInventory(f.state.getUpdatedGameConsole(), before, f.state.getRoomNameDatabase());
  assert.equal(E.field(repaired, 'Inventory'), 'Empty');
});

test('a monster dying two turns later releases its real equipment and private belongings without another battle', () => {
  const f = fixture(), Life = require('../retort/combatLife');
  const gear = { name: 'charged iron spear', type: 'weapon', attack_modifier: 2, damage_modifier: 1, ac: 0, magic: 3,
    owner: 'Keeper', slot: 'Weapon', spell_charge_id: 'keeper-spear', spell_magic_remaining: 2 };
  f.state.setUpdatedGameConsole(E.write(f.state.getUpdatedGameConsole(), 'Monsters Equipped Properties', JSON.stringify(gear)));
  const actor = I.parseSheets(f.state.getUpdatedGameConsole()).find(a => a.name === 'Keeper');
  const raw = actor.rawSheet.replace('Weapon: None', 'Weapon: ' + gear.name);
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace(actor.rawSheet, raw));
  const potion = R.healingPotion(3); f.p.actors.Keeper.inventory = [potion];
  const db = f.db(); db['1,0,0'].inhabitants = f.p;
  Life.apply(db, 'test-run', I.parseSheets(f.state.getUpdatedGameConsole())[0], 0, 1, { damage: 20, geoKey: '1,0,0' }); Life.commit(f.state, db);
  assert.equal(E.corpseDrops(f.state, 'Keeper'), false);
  Life.advance(f.state); assert.equal(f.db()['1,0,0'].objects.length, 0);
  Life.advance(f.state);
  const loot = f.db()['1,0,0'].objects;
  assert.ok(loot.some(o => o.name === potion.name));
  assert.equal(loot.find(o => o.name === gear.name).spell_magic_remaining, 2);
  assert.equal(I.parseEquipment(I.parseSheets(f.state.getUpdatedGameConsole())[0].lines[9]).Weapon, 'None');
  assert.equal(E.corpseDrops(f.state, 'Keeper'), false);
});

test('equipping and unequipping all four slots atomically preserves actual properties and modifiers', () => {
  for (const [type, slot] of [['weapon', 'Weapon'], ['armor', 'Armor'], ['shield', 'Shield'], ['other', 'Other']]) {
    const f = fixture(), item = { name: 'verified ' + type, type, attack_modifier: 2, damage_modifier: 3, ac: 4, magic: 5, description: 'Recorded gear.' };
    f.inventory(item, 2);
    const before = I.parseSheets(f.state.getUpdatedGameConsole(), 'PC')[0];
    const request = { kind: 'equip', item: item.name, nonce: 'gear-repeat:123' };
    assert.ok(!f.action(request).error); assert.equal(f.action(request).duplicate, true);
    let pc = I.parseSheets(f.state.getUpdatedGameConsole(), 'PC')[0];
    assert.equal(I.parseEquipment(pc.lines[9])[slot], item.name);
    for (const [field, amount] of [['attack', 2], ['damage', 3], ['armor', 4], ['ac', 4], ['magic', 5]]) assert.equal(pc[field], before[field] + amount);
    assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), item.name);
    assert.equal(JSON.parse(E.field(f.state.getUpdatedGameConsole(), 'Inventory Properties')).type, type);
    const worn = JSON.parse(E.field(f.state.getUpdatedGameConsole(), 'Party Equipped Properties'));
    assert.equal(worn.owner, 'Benedict'); assert.equal(worn.slot, slot); assert.equal(worn.description, item.description);
    assert.ok(!f.action({ kind: 'unequip', item: item.name }).error);
    pc = I.parseSheets(f.state.getUpdatedGameConsole(), 'PC')[0];
    assert.equal(I.parseEquipment(pc.lines[9])[slot], 'None');
    for (const field of ['attack', 'damage', 'armor', 'ac', 'magic']) assert.equal(pc[field], before[field]);
    assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), item.name + ', ' + item.name);
    assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Party Equipped Properties'), 'None');
  }
});

test('failed equipment changes never remove an item, overwrite a slot or partially alter stats', () => {
  for (const failure of ['missing-item', 'missing-properties', 'invalid-modifier', 'wrong-target', 'occupied', 'full', 'potion']) {
    const f = fixture(), item = { name: 'shadowbone spear', type: 'Weapon', attack_modifier: 2, damage_modifier: 3, ac: 0, magic: 0 };
    f.inventory(item);
    if (failure === 'occupied' || failure === 'full') assert.ok(!f.action({ kind: 'equip', item: item.name }).error);
    if (failure === 'occupied') f.inventory({ ...item, name: 'other spear' });
    if (failure === 'full') f.inventory({ ...item, name: 'other spear' }, 25);
    if (failure === 'missing-properties') f.state.setUpdatedGameConsole(E.write(f.state.getUpdatedGameConsole(), 'Inventory Properties', 'None'));
    if (failure === 'invalid-modifier') f.inventory({ ...item, damage_modifier: 'not a number' });
    if (failure === 'potion') f.inventory(R.healingPotion(6));
    const before = [f.state.getUpdatedGameConsole(), f.state.getRoomNameDatabase(), f.state.getCombatCharactersString()];
    const result = f.action({ kind: failure === 'full' ? 'unequip' : 'equip', item: failure === 'missing-item' ? 'invented spear' :
      failure === 'occupied' ? 'other spear' : failure === 'potion' ? 'healing potion 6 hp' : item.name,
      ...(failure === 'wrong-target' ? { target: 'Not in Party' } : {}) });
    assert.ok(result.error, failure);
    assert.deepEqual([f.state.getUpdatedGameConsole(), f.state.getRoomNameDatabase(), f.state.getCombatCharactersString()], before, failure);
  }
});

test('NPC equipment and item copies survive stale browser snapshots, including target aliases', () => {
  const f = fixture(), item = { name: 'veilbreaker aegis', type: 'shield', ac: 2, magic: 3, attack_modifier: 5, damage_modifier: 6 };
  f.inventory(item); const before = f.state.getUpdatedGameConsole();
  assert.ok(!f.action({ kind: 'equip', item: item.name, target: 'Ally' }).error);
  const equipped = f.state.getUpdatedGameConsole();
  let preserved = E.preserveInventory(equipped, before, f.state.getRoomNameDatabase());
  assert.equal(E.field(preserved, 'Inventory'), 'Empty');
  assert.equal(I.parseEquipment(I.parseSheets(preserved, 'NPCs in Party')[0].lines[9]).Shield, item.name);
  assert.equal(JSON.parse(E.field(preserved, 'Party Equipped Properties')).magic, 3);
  assert.ok(!f.action({ kind: 'unequip', item: item.name, target: 'Ally' }).error);
  preserved = E.preserveInventory(f.state.getUpdatedGameConsole(), equipped, f.state.getRoomNameDatabase());
  assert.equal(E.field(preserved, 'Inventory'), item.name);
  assert.equal(I.parseEquipment(I.parseSheets(preserved, 'NPCs in Party')[0].lines[9]).Shield, 'None');
  // Alias receipts protect the actual character, not only the spelling supplied by the browser.
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace(/^Ally$/m, 'Ally Keeper'));
  const aliasBefore = f.state.getUpdatedGameConsole();
  assert.ok(!f.action({ kind: 'equip', item: item.name, target: 'Ally' }).error);
  preserved = E.preserveInventory(f.state.getUpdatedGameConsole(), aliasBefore, f.state.getRoomNameDatabase());
  assert.equal(I.parseEquipment(I.parseSheets(preserved, 'NPCs in Party')[0].lines[9]).Shield, item.name);
});
test('birth purses distinguish fares, plunder, tolls and beasts, and remain deterministic', () => {
  const beast = { name: 'Wolf', race: 'Wolf', job: 'hunter' };
  assert.equal(R.wallet(beast, 'a').silver, 0);
  assert.equal(R.wallet({ ...beast, coinOrigin: 'swallowed-fare' }, 'a').silver, 1);
  for (let n = 0; n < 30; n++) {
    const shade = { name: 'Shade ' + n, race: 'Shade', job: 'mourner' };
    assert.ok([0, 1].includes(R.wallet(shade, 'a').silver));
    assert.deepEqual(R.wallet(shade, 'a'), R.wallet(shade, 'a'));
  }
  assert.ok(R.wallet({ name: 'Keeper', race: 'Human', job: 'toll-keeper' }, 'a').silver >= 4);
  assert.equal(R.wallet({ name: 'Raider', race: 'Human', job: 'raider' }, 'a').origin, 'plunder');
});
test('every potion strength heals from Magic, discards one copy, and preserves another copy', () => {
  for (let magic = 3; magic <= 10; magic++) {
    const f = fixture(), potion = R.healingPotion(magic); f.inventory(potion, 2);
    const result = f.action({ kind: 'drink', item: potion.name, target: 'Benedict' }); assert.ok(!result.error, result.error);
    const pc = I.parseSheets(f.state.getUpdatedGameConsole(), 'PC')[0];
    assert.equal(pc.hp, Math.min(20, 12 + magic));
    assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), potion.name);
    assert.equal(JSON.parse(E.field(f.state.getUpdatedGameConsole(), 'Inventory Properties')).magic, magic);
    assert.equal(JSON.parse(f.state.getCombatCharactersString())[0].hp, pc.hp);
    assert.equal(f.book().silver, 2);
  }
});
test('empty, invalid, full-health, dead, paused, stale and duplicate drinks cannot consume twice', () => {
  const f = fixture(), potion = R.healingPotion(3); f.inventory(potion);
  const input = { kind: 'drink', item: potion.name, target: 'Benedict', nonce: 'same-action:123' };
  assert.ok(!f.action(input).error); assert.equal(f.action(input).duplicate, true);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  for (const mode of ['full', 'dead', 'paused', 'stale', 'invalid']) {
    const a = fixture(); a.inventory(mode === 'invalid' ? { ...potion, magic: 500 } : potion);
    if (mode === 'full' || mode === 'dead') a.state.setUpdatedGameConsole(a.state.getUpdatedGameConsole().replace('HP: 12', `HP: ${mode === 'full' ? 20 : 0}`));
    if (mode === 'paused') a.pause();
    const before = a.state.getUpdatedGameConsole();
    const result = a.action({ kind: 'drink', item: potion.name, target: 'Benedict', ...(mode === 'stale' ? { revision: -1 } : {}) });
    assert.ok(result.error, mode); assert.equal(a.state.getUpdatedGameConsole(), before, mode);
  }
});
test('shops transfer actual stock and silver, honor finite tills, and reject protected items', () => {
  const f = fixture(); f.business('shop');
  assert.ok(!f.action({ kind: 'buy', actor: 'Keeper', item: 'healing potion 6 hp' }).error);
  assert.equal(f.book().silver, 0); assert.equal(f.db()['1,0,0'].services.shop.stock[0].quantity, 1);
  assert.equal(f.db()['1,0,0'].services.shop.till, 14);
  assert.match(f.action({ kind: 'buy', actor: 'Keeper', item: 'healing potion 6 hp' }).error, /Not enough/);
  assert.ok(!f.action({ kind: 'sell', actor: 'Keeper', item: 'healing potion 6 hp' }).error); assert.equal(f.book().silver, 1);
  f.inventory({ name: 'boss key', type: 'key', magic: 0 });
  assert.match(f.action({ kind: 'sell', actor: 'Keeper', item: 'boss key' }).error, /cannot be sold/);
});
test('temples heal living party members and resurrect only a dead real member', () => {
  const f = fixture(); f.business('temple');
  assert.ok(!f.action({ kind: 'heal', actor: 'Keeper', target: 'Ally' }).error);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(), 'NPCs in Party')[0].hp, 20); assert.equal(f.book().silver, 1);
  assert.ok(f.action({ kind: 'resurrect', actor: 'Keeper', target: 'Ally' }).error);
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace(f.row('Ally'), f.row('Ally', 0)));
  // Replace the already-healed sheet, if needed.
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('HP: 20\n      MaxHP: 20', 'HP: 0\n      MaxHP: 20'));
  assert.match(f.action({ kind: 'resurrect', actor: 'Keeper', target: 'Ally' }).error, /Not enough/);
  f.change(db => db['0,0,0'].economy.silver = 5);
  assert.ok(!f.action({ kind: 'resurrect', actor: 'Keeper', target: 'Ally' }).error);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(), 'NPCs in Party')[0].hp, 1); assert.equal(f.book().silver, 0);
});
test('a living companion can pay to resurrect the PC, but an entirely dead party cannot transact', () => {
  const f = fixture(); f.business('temple'); f.change(db => db['0,0,0'].economy.silver = 5);
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('HP: 12', 'HP: 0'));
  const roster = JSON.parse(f.state.getCombatCharactersString()); roster[0].hp = 0; f.state.setCombatCharactersString(JSON.stringify(roster));
  assert.ok(!f.action({ kind: 'resurrect', actor: 'Keeper', target: 'Benedict' }).error);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(), 'PC')[0].hp, 1); assert.equal(f.book().silver, 0);
  const dead = fixture(); dead.business('temple'); const all = JSON.parse(dead.state.getCombatCharactersString());
  all.filter(a => a.type !== 'monster').forEach(a => a.hp = 0); dead.state.setCombatCharactersString(JSON.stringify(all));
  assert.ok(dead.action({ kind: 'heal', actor: 'Keeper', target: 'Ally' }).error);
});
test('nested source placement metadata does not corrupt the existing flat inventory property format', () => {
  const f = fixture(), item = { name: 'ordinary key', type: 'key', magic: 0, unlocks: { coordinates: '2,0,0', direction: 'east' } };
  f.change(db => db['1,0,0'].objects.push(item)); f.d.sceneObjects = [{ name: item.name, x: 4, y: 5, type: 'key' }];
  assert.ok(!f.action({ kind: 'take', item: item.name }).error);
  const property = JSON.parse(E.field(f.state.getUpdatedGameConsole(), 'Inventory Properties'));
  assert.equal(property.name, item.name); assert.equal(property.type, 'key'); assert.equal(property.unlocks, undefined);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), item.name);
});

test('nearby loot cannot be taken by name without a current clear camera view', () => {
  const f = fixture(), item = { name: 'hidden key', type: 'key', magic: 0 };
  f.change(db => db['1,0,0'].objects.push(item));
  f.d.sceneObjects = [{ ...item, x: 4, y: 5 }];
  const before = f.state.getUpdatedGameConsole(), count = f.book().receipts.length;
  for (const objectView of [null, { names: [], camera: {} },
    { names: [item.name], camera: { x: 4.5, y: 4.5, eyeZ: .65, dirX: 0, dirY: -1, planeScale: .577, verticalScale: 1.73, viewShift: 0, aspect: 1.8 } }]) {
    assert.match(f.action({ kind: 'take', item: item.name, objectView }).error, /not currently in view/);
    assert.equal(f.state.getUpdatedGameConsole(), before); assert.equal(f.book().receipts.length, count);
    assert.equal(f.db()['1,0,0'].objects.length, 1);
  }
  assert.ok(!f.action({ kind: 'take', item: item.name }).error);
  assert.equal(f.db()['1,0,0'].objects.length, 0);
});

test('a readable scroll can be picked up beside a physical puzzle without consuming silver or losing its content', () => {
  const f = fixture(), item = { name: 'keepers scroll of ruined temple entrance', type: 'other', magic: 0, readable_kind: 'scroll' };
  const readable = { name: item.name, kind: 'scroll', chapters: [{ title: 'Keeper Notes', text: 'Watch the marked controls.' }] };
  f.change(db => { db['1,0,0'].objects.push(item); db['1,0,0'].readables = [readable]; });
  f.d.sceneObjects = [{ ...item, x: 4, y: 5 }];
  Puzzles.install(f.d, { puzzleMechanism: Puzzles.fallback('pickup-regression', 'Ruined Temple Entrance') });
  assert.ok(f.d.physicalPuzzle?.fixtures.length);
  const puzzle = JSON.stringify(f.d.physicalPuzzle), silver = f.book().silver;
  const result = f.action({ kind: 'take', item: item.name, nonce: 'scroll-pickup:123' });
  assert.ok(!result.error, result.error);
  assert.match(result.content, /You take keepers scroll/);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), item.name);
  assert.equal(JSON.parse(E.field(f.state.getUpdatedGameConsole(), 'Inventory Properties')).readable_kind, 'scroll');
  assert.equal(f.db()['1,0,0'].objects.length, 0);
  assert.deepEqual(f.db()['1,0,0'].readables, [readable]);
  assert.equal(f.book().silver, silver);
  assert.equal(JSON.stringify(f.d.physicalPuzzle), puzzle);
  assert.equal(f.action({ kind: 'take', item: item.name, nonce: 'scroll-pickup:123' }).duplicate, true);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), item.name);
});
test('a corpse drops only its recorded purse and carried items; collecting coins never creates inventory items', () => {
  const f = fixture(); f.p.actors.Keeper.hp = 0; f.p.actors.Keeper.status = 'dead';
  f.p.actors.Keeper.wallet = { silver: 1, origin: 'uncrossed-fare', source: 'engine-birth-purse-v1', looted: false };
  f.p.actors.Keeper.inventory = [R.healingPotion(3)];
  assert.equal(E.corpseDrops(f.state, 'Keeper'), true); assert.equal(E.corpseDrops(f.state, 'Keeper'), false);
  const room = f.db()['1,0,0']; assert.equal(room.objects.length, 2); assert.equal(f.book().silver, 2);
  f.d.sceneObjects = [{ name: room.objects[0].name, x: 4, y: 5, type: 'other' }];
  assert.ok(!f.action({ kind: 'take', item: room.objects[0].name }).error);
  assert.equal(f.book().silver, 3); assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  assert.match(f.action({ kind: 'take', item: room.objects[0].name }).error, /not present/);
});
test('a real local delivery pays once and never advances the main quest', () => {
  const f = fixture(), item = { name: 'guild packet', type: 'other', minor_mission_id: 'contract' }; f.inventory(item);
  f.change(db => db['1,0,0'].minorMissions = { contract: { id: 'contract', status: 'accepted', item: item.name,
    recipient: 'Keeper', originalRecipient: 'Keeper', roomKey: '1,0,0', escrowSilver: 2, rewardSilver: 2, description: 'Give guild packet to Keeper.' } });
  const given = Give.give(f.state, f.service, 'give guild packet to Keeper'); assert.match(given.content, /You give/);
  E.refresh(f.state); assert.equal(f.book().silver, 4); E.refresh(f.state); assert.equal(f.book().silver, 4);
  assert.equal(f.db()['1,0,0'].minorMissions.contract.status, 'completed'); assert.equal(f.state.getCurrentTaskIndex(), 0);
});
test('an item-paid local contract releases only its escrowed potion and never duplicates it', () => {
  const f = fixture(), item = { name: 'guild packet', type: 'other', minor_mission_id: 'contract' }; f.inventory(item);
  f.change(db => db['1,0,0'].minorMissions = { contract: { id: 'contract', status: 'accepted', item: item.name,
    recipient: 'Keeper', originalRecipient: 'Keeper', roomKey: '1,0,0', escrowSilver: 0, rewardSilver: 0,
    rewardItem: R.healingPotion(4), escrowItems: [R.healingPotion(4)], description: 'Give the packet for a potion.' } });
  Give.give(f.state, f.service, 'give guild packet to Keeper'); E.refresh(f.state); E.refresh(f.state);
  assert.equal(f.book().silver, 2); assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'healing potion 4 hp');
  assert.equal(f.db()['1,0,0'].minorMissions.contract.status, 'completed');
  assert.deepEqual(f.db()['1,0,0'].minorMissions.contract.escrowItems, []);
});
test('recruitment pools only actual loose possessions once and leaves equipment alone', () => {
  const f = fixture(); f.p.actors.Keeper.wallet = { id: 'keeper-purse', silver: 1, source: 'engine-birth-purse-v1', looted: false };
  f.p.actors.Keeper.inventory = [R.healingPotion(3)];
  let text = f.state.getUpdatedGameConsole().replace(I.sectionPattern('NPCs in Party'), (_, header, body) => header + body + '\n' + f.row('Keeper') + '\n');
  text = text.replace(I.sectionPattern('Monsters in Room'), (_, header) => header + ' None\n'); f.state.setUpdatedGameConsole(text);
  const first = E.refresh(f.state); assert.equal(first.changed, true); assert.equal(f.book().silver, 3);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'healing potion 3 hp');
  assert.ok(first.notices.some(n => n.includes('unequipped belongings')));
  const second = E.refresh(f.state); assert.equal(second.changed, false); assert.equal(f.book().silver, 3);
  assert.deepEqual(f.p.actors.Keeper.inventory, []);
});
test('successor operators keep the same shop stock and do not inherit free corpse money', () => {
  const f = fixture(); f.business('shop'); f.p.actors.Keeper.status = 'dead'; f.p.actors.Keeper.hp = 0;
  E.refresh(f.state); const shop = f.db()['1,0,0'].services.shop;
  assert.match(shop.operator, /assistant/); assert.equal(shop.stock[0].quantity, 2); assert.equal(shop.till, 12);
  assert.equal(f.p.actors[shop.operator].wallet.silver, 0); assert.match(f.state.getUpdatedGameConsole(), /Keeper assistant 1/);
  E.refresh(f.state); assert.equal(f.db()['1,0,0'].services.shop.operator, shop.operator);
});
test('browser synchronization cannot replace silver, services, receipts or protected ground loot', () => {
  const f = fixture(); f.business('shop'); const old = f.db(), next = structuredClone(old);
  next['0,0,0'].economy.silver = 999; next['1,0,0'].services.shop.till = 999;
  old['1,0,0'].objects.push({ name: 'fare', currency_kind: 'silver', silver: 1, economyItemId: 'fare' });
  next['1,0,0'].objects = [{ name: 'fake purse', currency_kind: 'silver', silver: 999 }];
  const restored = JSON.parse(E.preserve(JSON.stringify(old), JSON.stringify(next)));
  assert.equal(restored['0,0,0'].economy.silver, 2); assert.equal(restored['1,0,0'].services.shop.till, 12);
  assert.deepEqual(restored['1,0,0'].objects, old['1,0,0'].objects);
});

test('generation saves ordinary loot and puzzle readables in the same room snapshot', () => {
  const f = fixture(), blade = { name: 'shattered oath blade', type: 'weapon', attack_modifier: 2, damage_modifier: 3, ac: 0, magic: 4 };
  const text = E.write(E.write(f.state.getUpdatedGameConsole(), 'Objects in Room', blade.name), 'Objects in Room Properties',
    `{name: "${blade.name}", type: "weapon", attack_modifier: 2, damage_modifier: 3, ac: 0, magic: 4}`);
  const local = f.db(), room = local['1,0,0'];
  assert.equal(E.registerGround(room, text, '1,0,0'), true);
  const live = structuredClone(local);
  // Population/economy generation writes a separate database; the later puzzle save used to lose this blade.
  live['1,0,0'].objects.push({ name: 'scroll of ember lance', type: 'other', magic: 2, spell_scroll: 'ember-lance', economyItemId: 'scroll:1,0,0' });
  room.objects.push({ name: 'keeper records', type: 'other', properties: { magic: 0 }, puzzlePiece: { readableId: 'records' } });
  const saved = JSON.parse(E.preserve(JSON.stringify(live), JSON.stringify(local), { trustedNewFields: true }))['1,0,0'];
  assert.deepEqual(saved.objects.map(o => o.name), [blade.name, 'keeper records', 'scroll of ember lance']);
  assert.equal(saved.objects[0].damage_modifier, 3); assert.equal(saved.groundInventoryVersion, 1);
  assert.equal(E.registerGround(saved, text, '1,0,0'), false, 'Registration is idempotent');
});

test('a legacy puzzle-only catalog imports saved loot before scene synchronization and pickup', () => {
  const f = fixture(), blade = { name: 'shattered oath blade', type: 'weapon', attack_modifier: 2, damage_modifier: 3, ac: 0, magic: 4 };
  f.change(db => db['1,0,0'].objects.push({ name: 'keeper records', type: 'other', magic: 0 }));
  const text = E.write(E.write(f.state.getUpdatedGameConsole(), 'Objects in Room', blade.name + ', keeper records'),
    'Objects in Room Properties', JSON.stringify(blade) + ', ' + JSON.stringify({ name: 'keeper records', type: 'other', magic: 0 }));
  f.state.setUpdatedGameConsole(text);
  f.d.sceneObjects = [{ ...blade, x: 4, y: 5 }, { name: 'keeper records', type: 'other', x: 6, y: 6 }];
  const position = f.d.sceneObjects[0], update = E.refresh(f.state);
  assert.equal(update.changed, true); assert.equal(f.db()['1,0,0'].groundInventoryVersion, 1);
  assert.deepEqual(f.d.sceneObjects[0], position, 'A valid existing placement must not move');
  assert.equal(f.db()['1,0,0'].objects.find(o => o.name === blade.name).magic, 4);
  const result = f.action({ kind: 'take', item: blade.name, nonce: 'catalog-repair:123' });
  assert.ok(!result.error, result.error); assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), blade.name);
  assert.equal(JSON.parse(E.field(f.state.getUpdatedGameConsole(), 'Inventory Properties')).damage_modifier, 3);
  assert.ok(!f.db()['1,0,0'].objects.some(o => o.name === blade.name));
  assert.ok(!f.d.sceneObjects.some(o => o.name === blade.name));
  assert.equal(f.action({ kind: 'take', item: blade.name, nonce: 'catalog-repair:123' }).duplicate, true);
  assert.match(f.action({ kind: 'take', item: blade.name }).error, /not present/);
});

test('legacy repair restores scene items already removed by a failed pickup and never revives collected items', () => {
  const f = fixture(), blade = { name: 'shattered oath blade', type: 'weapon', attack_modifier: 1, damage_modifier: 2, ac: 0, magic: 3 };
  f.state.setUpdatedGameConsole(E.write(E.write(f.state.getUpdatedGameConsole(), 'Objects in Room', blade.name),
    'Objects in Room Properties', JSON.stringify(blade)));
  assert.deepEqual(f.d.sceneObjects, []);
  assert.equal(E.refresh(f.state).changed, true);
  assert.ok(f.d.sceneObjects.some(o => o.name === blade.name));
  assert.equal(E.refresh(f.state).changed, false);
  const spent = fixture();
  spent.change(db => db['0,0,0'].economy.receipts.push({ nonce: 'old-pickup:123', roomKey: '1,0,0', kind: 'take', item: blade.name }));
  spent.state.setUpdatedGameConsole(E.write(E.write(spent.state.getUpdatedGameConsole(), 'Objects in Room', blade.name),
    'Objects in Room Properties', JSON.stringify(blade)));
  E.refresh(spent.state);
  assert.deepEqual(spent.db()['1,0,0'].objects, []); assert.deepEqual(spent.d.sceneObjects, []);
  assert.equal(E.field(spent.state.getUpdatedGameConsole(), 'Objects in Room'), 'None');
});

test('registered ground catalogs reject stale deletions, modified stats and respawned or invented objects', () => {
  const f = fixture(), blade = { name: 'shattered oath blade', type: 'weapon', magic: 3 };
  const old = f.db(); Object.assign(old['1,0,0'], { groundInventoryVersion: 1, objects: [blade] });
  for (const objects of [[], [{ ...blade, magic: 999 }], [{ name: 'invented blade', type: 'weapon', magic: 99 }]]) {
    const incoming = structuredClone(old); incoming['1,0,0'].objects = objects; delete incoming['1,0,0'].groundInventoryVersion;
    const saved = JSON.parse(E.preserve(JSON.stringify(old), JSON.stringify(incoming)));
    assert.deepEqual(saved['1,0,0'].objects, [blade]); assert.equal(saved['1,0,0'].groundInventoryVersion, 1);
  }
  const stale = structuredClone(old); old['1,0,0'].objects = [];
  const saved = JSON.parse(E.preserve(JSON.stringify(old), JSON.stringify(stale)));
  assert.deepEqual(saved['1,0,0'].objects, [], 'A stale client cannot respawn a collected object');
  assert.deepEqual(JSON.parse(E.preserve(JSON.stringify(old), '{}'))['1,0,0'].objects, [], 'Omitted rooms retain their authoritative catalog');
  const invented = f.db(); invented['1,0,0'].groundInventoryVersion = 1;
  assert.equal(JSON.parse(E.preserve(JSON.stringify(f.db()), JSON.stringify(invented)))['1,0,0'].groundInventoryVersion, undefined);
});

test('catalog registration cannot import another room, metadata-only loot, or an already carried object', () => {
  const f = fixture(), room = f.db()['1,0,0'], item = { name: 'shattered oath blade', type: 'weapon', magic: 3 };
  const text = E.write(E.write(f.state.getUpdatedGameConsole(), 'Objects in Room', item.name), 'Objects in Room Properties', JSON.stringify(item));
  assert.equal(E.registerGround(room, text, '2,0,0'), false); assert.deepEqual(room.objects, []);
  E.registerGround(room, text, '1,0,0', new Set([item.name])); assert.deepEqual(room.objects, []);
  E.registerGround(room, E.write(text, 'Objects in Room', 'None'), '1,0,0'); assert.deepEqual(room.objects, []);
});

test('committed pickup quantities and properties survive stale consoles without blocking actual equipping', () => {
  const f = fixture(), blade = { name: 'shattered oath blade', type: 'weapon', attack_modifier: 1, damage_modifier: 2, ac: 0, magic: 3 };
  f.change(db => db['0,0,0'].economy.receipts.push({ kind: 'take', item: blade.name })); f.inventory(blade, 2);
  const old = f.state.getUpdatedGameConsole(), db = f.state.getRoomNameDatabase();
  const stale = E.write(E.write(old, 'Inventory', 'Empty'), 'Inventory Properties', 'None');
  const restored = E.preserveInventory(old, stale, db);
  assert.equal(E.field(restored, 'Inventory'), `${blade.name}, ${blade.name}`);
  assert.deepEqual(JSON.parse(E.field(restored, 'Inventory Properties')), blade);
  const equipped = stale.replace('Equipped: Weapon: None', 'Equipped: Weapon: ' + blade.name);
  assert.equal(E.field(E.preserveInventory(old, equipped, db), 'Inventory'), blade.name, 'Only the actually equipped copy leaves inventory');
  const empty = E.write(E.write(old, 'Inventory', 'Empty'), 'Inventory Properties', 'None');
  assert.equal(E.field(E.preserveInventory(empty, empty, db), 'Inventory'), 'Empty', 'Already consumed, sold or given items are not restored');
});
