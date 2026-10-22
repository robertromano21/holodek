'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const express = require('express'), Economy = require('../retort/economy');
const { createGameJsonParser, createRoomDatabaseReceiver } = require('../gameStateTransport');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');

async function fixture(t) {
  const blade = { name: 'shattered oath blade', type: 'weapon', attack_modifier: 2, damage_modifier: 3, ac: 0, magic: 4 };
  const scroll = { name: 'keepers scroll of ruined temple entrance', type: 'other', magic: 0 };
  const dungeon = { geoKey: '0,0,0', start: { x: 4.5, y: 4.5 }, cells: {}, tiles: {},
    sceneObjects: [{ ...blade, x: 4, y: 5 }, { ...scroll, x: 6, y: 6 }] };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
  let text = `Coordinates: X: 0, Y: 0, Z: 0\nObjects in Room: ${blade.name}, ${scroll.name}\nObjects in Room Properties: ${JSON.stringify(blade)}, ${JSON.stringify(scroll)}\nInventory: Empty\nInventory Properties: None\nPC:\n${formatStartingCharacterSheet({ Name: 'Benedict', HP: 12, MaxHP: 12 }, 0, 'pc')}\nNPCs in Party: None\nMonsters in Room: None\nMonsters Equipped Properties: None`;
  let database = JSON.stringify({ '0,0,0': { name: 'Ruined Temple Entrance', objects: [scroll], readables: [
    { name: scroll.name, kind: 'scroll', chapters: [{ title: 'Keeper Notes', text: 'Study the marked controls.' }] }] } });
  let roster = JSON.stringify([{ name: 'Benedict', type: 'pc', hp: 12, mazeX: 4, mazeY: 4, mazeRoomKey: '0,0,0' }]);
  let population = null;
  const state = { getDungeonRunId: () => 'pickup-test-run', getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getGamePaused: () => false,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getRoomNameDatabase: () => database, setRoomNameDatabase: v => database = v,
    getCombatCharactersString: () => roster, setCombatCharactersString: v => roster = v,
    getRoomDungeonForSimulation: () => dungeon, getRoomPopulation: () => population, getCurrentTasks: () => [], getCurrentTaskIndex: () => 0 };
  Economy.start(state, { Name: 'Benedict' }, []);
  const app = express(), events = [];
  app.use(createGameJsonParser());
  const source = fs.readFileSync('server.js', 'utf8');
  const context = { app, sharedState: state, Economy, SpellSystem: require('../retort/spellSystem'), populationService: { save() {} }, inputTaskInFlight: false,
    actionDice: { active: false }, roomDatabaseReceiver: createRoomDatabaseReceiver(), require,
    prepareQuestScene(req) { return req.body.runId === state.getDungeonRunId() && req.body.geoKey === '0,0,0' ? {} : { status: 409, error: 'Stale room.' }; },
    broadcast: event => events.push(event), console: { info() {}, warn() {}, log() {} }, setImmediate: cb => cb(), prepareRoomSong() {} };
  vm.runInNewContext(source.slice(source.indexOf('function economyStateEvent('), source.indexOf("app.post('/spells/view'")), context);
  vm.runInNewContext(source.slice(source.indexOf("app.post('/economy/view'"), source.indexOf("app.post('/room-population/visit'")), context);
  const start = source.indexOf("app.post('/updateState7'");
  vm.runInNewContext(source.slice(start, source.indexOf('// NEW: Endpoint to get room music', start)), context);
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  t.after(async () => { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); });
  const base = `http://127.0.0.1:${listener.address().port}`;
  const observer = { runId: state.getDungeonRunId(), geoKey: '0,0,0', player: { x: 4.5, y: 4.5 }, actors: [],
    objectView: { names: [blade.name, scroll.name], camera: { x: 4.5, y: 4.5, eyeZ: .65, dirX: 0, dirY: 1,
      planeScale: .577, verticalScale: 1.73, viewShift: 0, aspect: 1.8 } } };
  const post = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { state, dungeon, blade, scroll, observer, events, post, setPopulation: value => population = value };
}

test('outdoor encounter loot is taken at its placed tile, not its original distant seed, without deleting a neighbor', async t => {
  const f = await fixture(t), Discovery = require('../assets/outdoorDiscovery');
  const original = f.dungeon.sceneObjects.find(o => o.name === f.blade.name);
  original.x = 13; original.y = 13;
  const population = { travelDiscovery: { objects: { [f.blade.name]: { name: f.blade.name, status: 'placed', x: 4, y: 5 } } } };
  f.setPopulation(population);
  assert.equal(Discovery.objects(f.dungeon.sceneObjects, population).find(o => o.name === f.blade.name).x, 4);
  const balance = await f.post('/economy/view', f.observer);
  const request = { ...f.observer, kind: 'take', item: f.blade.name, nonce: 'outdoor-pickup:123', revision: balance.body.revision };
  const taken = await f.post('/economy/action', request);
  assert.equal(taken.status, 200, JSON.stringify(taken.body));
  assert.equal(Economy.field(taken.body.updatedGameConsole, 'Inventory'), f.blade.name);
  assert.deepEqual(f.dungeon.sceneObjects.map(o => o.name), [f.scroll.name]);
  assert.ok(!Discovery.objects(f.dungeon.sceneObjects, population).some(o => o.name === f.blade.name));
  const repeated = await f.post('/economy/action', request);
  assert.equal(repeated.status, 200); assert.equal(repeated.body.duplicate, true);
  assert.equal(Economy.field(f.state.getUpdatedGameConsole(), 'Inventory'), f.blade.name);
});

test('a placed outdoor item cannot be collected from its old seed tile', async t => {
  const f = await fixture(t);
  f.setPopulation({ travelDiscovery: { objects: { [f.blade.name]: { status: 'placed', x: 13, y: 13 } } } });
  const balance = await f.post('/economy/view', f.observer);
  const result = await f.post('/economy/action', { ...f.observer, kind: 'take', item: f.blade.name,
    nonce: 'old-seed-pickup:123', revision: balance.body.revision });
  assert.equal(result.status, 409); assert.equal(Economy.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  assert.equal(f.dungeon.sceneObjects.length, 2);
});

for (const status of ['pending', 'exhausted']) test(`outdoor ${status} loot cannot be guessed and collected`, async t => {
  const f = await fixture(t);
  f.setPopulation({ travelDiscovery: { objects: { [f.blade.name]: { status, x: 4, y: 5 } } } });
  const balance = await f.post('/economy/view', f.observer);
  const result = await f.post('/economy/action', { ...f.observer, kind: 'take', item: f.blade.name,
    nonce: 'hidden-outdoor-pickup:123', revision: balance.body.revision });
  assert.equal(result.status, 409); assert.equal(Economy.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  assert.equal(f.dungeon.sceneObjects.length, 2);
});

test('real state-sync, balance lookup and pickup routes repair the visible blade without losing its modifiers', async t => {
  const f = await fixture(t);
  const stale = { updatedGameConsole: f.state.getUpdatedGameConsole(), roomNameDatabaseString: f.state.getRoomNameDatabase(),
    combatCharactersString: f.state.getCombatCharactersString() };
  const sync = await f.post('/updateState7', stale);
  assert.equal(sync.status, 200); assert.ok(sync.body.economyResult);
  assert.equal(sync.body.economyResult.passive, true);
  assert.ok(sync.body.economyResult.sceneObjects.some(o => o.name === f.blade.name));
  const balance = await f.post('/economy/view', f.observer); assert.equal(balance.status, 200);
  assert.ok(balance.body.sceneObjects.some(o => o.name === f.blade.name && o.x === 4 && o.y === 5));
  const request = { ...f.observer, kind: 'take', item: f.blade.name, nonce: 'http-pickup:123', revision: balance.body.revision };
  const taken = await f.post('/economy/action', request);
  assert.equal(taken.status, 200, JSON.stringify(taken.body)); assert.match(taken.body.content, /You take shattered oath blade/);
  assert.equal(Economy.field(taken.body.updatedGameConsole, 'Inventory'), f.blade.name);
  assert.equal(JSON.parse(Economy.field(taken.body.updatedGameConsole, 'Inventory Properties')).damage_modifier, 3);
  assert.equal(Economy.field(taken.body.updatedGameConsole, 'Silver Pieces'), '1');
  assert.ok(!taken.body.sceneObjects.some(o => o.name === f.blade.name));
  assert.equal(f.events.length, 1);
  const repeated = await f.post('/economy/action', request); assert.equal(repeated.status, 200); assert.equal(repeated.body.duplicate, true);
  // A pre-pickup browser database and console must not put the blade back on the floor.
  const late = await f.post('/updateState7', { updatedGameConsole: stale.updatedGameConsole,
    roomNameDatabaseString: stale.roomNameDatabaseString });
  assert.equal(late.status, 200);
  assert.equal(Economy.field(f.state.getUpdatedGameConsole(), 'Objects in Room'), f.scroll.name);
  assert.equal(Economy.field(f.state.getUpdatedGameConsole(), 'Inventory'), f.blade.name, 'The stale console cannot erase a committed pickup');
  assert.equal(JSON.parse(Economy.field(f.state.getUpdatedGameConsole(), 'Inventory Properties')).magic, 4);
  assert.ok(!JSON.parse(f.state.getRoomNameDatabase())['0,0,0'].objects.some(o => o.name === f.blade.name));
  assert.ok(!f.dungeon.sceneObjects.some(o => o.name === f.blade.name));
});

test('repaired catalogs still reject absent camera visibility and visible-but-distant pickups', async t => {
  const f = await fixture(t);
  const balance = await f.post('/economy/view', f.observer); assert.equal(balance.status, 200);
  const request = { ...f.observer, kind: 'take', item: f.blade.name, nonce: 'hidden-pickup:123', revision: balance.body.revision };
  const hidden = await f.post('/economy/action', { ...request, objectView: { ...f.observer.objectView, names: [] } });
  assert.equal(hidden.status, 409); assert.match(hidden.body.error, /not currently in view/);
  f.dungeon.sceneObjects.find(o => o.name === f.blade.name).y = 8;
  const distant = await f.post('/economy/action', { ...request, nonce: 'distant-pickup:123' });
  assert.equal(distant.status, 409); assert.match(distant.body.error, /Move closer/);
  assert.equal(Economy.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  assert.equal(JSON.parse(f.state.getRoomNameDatabase())['0,0,0'].economy.receipts.length, 0);
});

test('real pickup, equip, state sync, unequip and drop routes preserve one physical copy and charged-item identity', async t => {
  const f = await fixture(t), S = require('../retort/spellSystem'), I = require('../assets/dungeonInhabitants');
  const transact = async input => {
    const balance = await f.post('/economy/view', f.observer);
    const result = await f.post('/economy/action', { ...f.observer, nonce: require('node:crypto').randomUUID(), revision: balance.body.revision, ...input });
    assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body;
  };
  await transact({ kind: 'take', item: f.blade.name }); const carried = f.state.getUpdatedGameConsole();
  await transact({ kind: 'equip', item: f.blade.name });
  let pc = I.parseSheets(f.state.getUpdatedGameConsole(), 'PC')[0];
  assert.equal(I.parseEquipment(pc.lines[9]).Weapon, f.blade.name);
  assert.equal(Economy.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  let property = JSON.parse(Economy.field(f.state.getUpdatedGameConsole(), 'Party Equipped Properties'));
  assert.equal(property.damage_modifier, 3); assert.equal(property.magic, 4); const id = property.spell_item_id; assert.ok(id);
  const synced = await f.post('/updateState7', { updatedGameConsole: carried }); assert.equal(synced.status, 200);
  assert.equal(Economy.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  assert.equal(I.parseEquipment(I.parseSheets(f.state.getUpdatedGameConsole(), 'PC')[0].lines[9]).Weapon, f.blade.name);
  await transact({ kind: 'unequip', item: f.blade.name });
  property = JSON.parse(Economy.field(f.state.getUpdatedGameConsole(), 'Inventory Properties'));
  assert.equal(property.spell_item_id, id); assert.equal(property.magic, 4);
  await transact({ kind: 'equip', item: f.blade.name });
  assert.equal(JSON.parse(Economy.field(f.state.getUpdatedGameConsole(), 'Party Equipped Properties')).spell_item_id, id);
  assert.equal(Object.keys(JSON.parse(f.state.getRoomNameDatabase())['0,0,0'].spellSystem.items).length, 1);
  await transact({ kind: 'unequip', item: f.blade.name }); const preDrop = f.state.getUpdatedGameConsole();
  await transact({ kind: 'drop', item: f.blade.name });
  assert.equal(Economy.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  assert.ok(JSON.parse(f.state.getRoomNameDatabase())['0,0,0'].objects.some(o => o.name === f.blade.name));
  await f.post('/updateState7', { updatedGameConsole: preDrop });
  assert.equal(S.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty', 'A late pre-drop console cannot recreate a carried copy');
});
