'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const I = require('../assets/dungeonInhabitants'), G = require('../assets/dungeonGeometryStamp'), E = require('../assets/dungeonExits');
const Entry = require('../retort/preparedRoomEntry'), Population = require('../retort/roomPopulation');
const sheet = name => `${name}\nFemale\nHuman\nFighter\nLevel: 1\nAC: 10\nXP: 0\nHP: 10\nMaxHP: 10\nEquipped: None\nAttack: 0\nDamage: 0\nArmor: 0\nMagic: 0\nState: Friendly`;
function fixture() {
  const key = '0,1,0', runId = 'entry-run', model = 'offline', description = 'An authored market beneath the relay spans.';
  const dungeon = { geoKey: key, layout: { width: 24, height: 24 }, start: { x: 12, y: 18 },
    classification: { indoor: true }, sceneSpec: { exits: ['north', 'south'], source: { roomName: 'Relay Market', description } }, cells: {} };
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) dungeon.cells[`${x},${y}`] = { tile: x && y && x < 23 && y < 23 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 5 };
  E.install(dungeon);
  for (const part of dungeon.sceneStructures) part.shape = 'g_neon_sign';
  dungeon.sceneStructures.push({ role: 'authored-arcade', tile: 'arch', position: { x: 3, y: 3, z: 0 }, size: { x: 1, y: 1, z: 4 } });
  G.stamp(dungeon, key);
  const pop = I.createPopulation(key, [], { indoor: true });
  let db = { '0,0,0': { name: 'Entry', exits: { north: { targetCoordinates: key } } },
    [key]: { name: 'Relay Market', description, populationComplete: true, inhabitants: pop,
      preparedBuild: { runId, model, ready: true, stage: 'complete' }, exits: { south: { targetCoordinates: '0,0,0' }, north: { targetCoordinates: '0,2,0' } } } };
  let text = `Room Name: Entry\nRoom Description: A saved starting hall.\nCoordinates: X: 0, Y: 1, Z: 0\nCurrent Quest: None\nNext Artifact: None\nRooms Visited: 2\nPC:\n${sheet('Hero')}\nNPCs in Party: None\nMonsters in Room: None\nMonsters Equipped Properties: None\nMonsters State: None\nObjects in Room: None\nObjects in Room Properties: None\nInventory: Signal Token\nInventory Properties: None`;
  let here = { x: 0, y: 0, z: 0 }, roster = JSON.stringify([{ name: 'Hero', type: 'pc', hp: 10, mazeX: 2, mazeY: 2, mazeRoomKey: '0,0,0' }]);
  const populations = new Map([[key, pop]]), events = [];
  const state = { getDungeonRunId: () => runId, getLastCoords: () => here, setLastCoords: c => { here = c; },
    getCurrentQuest: () => 'Existing quest', getCurrentTasks: () => [{ id: 'existing-task' }], getGamePaused: () => false,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: t => { text = t; },
    getRoomNameDatabase: () => JSON.stringify(db), setRoomNameDatabase: s => { db = JSON.parse(s); },
    getRoomDungeonForSimulation: () => dungeon, setRoomDungeon: (_c, d) => { Object.assign(dungeon, d); },
    getRoomPopulation: k => populations.get(k), setRoomPopulation: (k, p) => populations.set(k, p),
    getCombatCharactersString: () => roster, setCombatCharactersString: s => { roster = s; } };
  const population = Population.createPopulationService(state);
  return { state, dungeon, events, key, runId, model, population, db: () => db, text: () => text,
    options: { key, input: 'north', model, population, broadcast: e => events.push(e) } };
}

test('entry withholds display until first-quest inference finishes, then publishes prepared geometry exactly once', async () => {
  const f = fixture(), originalStamp = f.dungeon._geometryStamp;
  let release, questStarted = false, quest = 'None';
  let tasks = [];
  f.state.getCurrentQuest = () => quest; f.state.getCurrentTasks = () => tasks;
  const waiting = new Promise(resolve => { release = resolve; });
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const start = source.indexOf('    let preparedEntry = null;'), end = source.indexOf('    let roomDescriptionGenerated', start);
  const run = vm.runInNewContext('(async()=>{' + source.slice(start, end) + '})()', {
    updatedGameConsole: f.text(), roomNameDatabaseString: f.state.getRoomNameDatabase(), sharedState: f.state,
    userInput: 'north', populationService: f.population, broadcast: f.options.broadcast, Inhabitants: I, console: { info() {} },
    require: id => id === './roomBuildQueue' ? { service: () => ({ join: async () => {} }) } :
      id === './gameModels' ? { current: () => ({ id: f.model }) } : require('../retort/' + id.slice(2)),
    $: { run: work => work() }, generateQuest: async () => { questStarted = true; await waiting; quest = 'Prepared quest'; },
    seedAndManageQuest: async () => { tasks = [{ id: 'prepared-task' }]; return { activeTask: tasks[0] }; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(questStarted, true); assert.equal(f.events.length, 0);
  release(); await run; assert.equal(f.events.length, 1);
  const event = f.events[0]; assert.equal(event.type, 'dungeonLoaded'); assert.equal(event.entryReady.geoKey, f.key);
  assert.equal(event.dungeon._geometryStamp, originalStamp); assert.equal(G.compute(event.dungeon, f.key), originalStamp);
  assert.deepEqual(f.state.getLastCoords(), { x: 0, y: 1, z: 0 });
  assert.match(event.entryReady.updatedGameConsole, /^Inventory: Signal Token$/m);
  assert.equal(f.state.getCurrentQuest(), 'Prepared quest');
  const actor = JSON.parse(event.entryReady.combatCharactersString)[0];
  assert.equal(actor.mazeRoomKey, f.key); assert.equal(actor.mazeX, f.dungeon.start.x);
  assert.equal(f.events.length, 1, 'Finishing the deferred story must not re-deliver the room and reset the camera.');
  assert.match(source, /preparedEntry \|\| await buildGeneratedRoom\(/);
});

test('old, partial, foreign-model and mismatched-description prebuilds cannot be displayed early', () => {
  for (const change of [f => { f.db()[f.key].preparedBuild.ready = false; }, f => { f.db()[f.key].preparedBuild.runId = 'old'; },
    f => { f.db()[f.key].preparedBuild.model = 'other'; }, f => { f.dungeon.sceneSpec.source.description = 'Different room'; }]) {
    const f = fixture(); change(f); const before = f.text();
    assert.equal(Entry.publish(f.state, f.options), null); assert.equal(f.events.length, 0); assert.equal(f.text(), before);
    assert.deepEqual(f.state.getLastCoords(), { x: 0, y: 0, z: 0 });
  }
});

test('early display preserves deferred community activation and its existing exactly-once entry contract', () => {
  const f = fixture(), Economy = require('../retort/economy');
  Economy.seedRoom(f.db(), f.key, f.db()[f.key].inhabitants, f.runId, f.text(), { deferCommunity: true });
  const pending = structuredClone(f.db()[f.key].pendingCommunityActivation);
  assert.ok(pending); assert.ok(Entry.publish(f.state, f.options));
  assert.deepEqual(f.db()[f.key].pendingCommunityActivation, pending);
  assert.equal(Entry.activate(f.state, f.key, f.text()).changed, true);
  const once = structuredClone(f.db());
  assert.equal(Entry.activate(f.state, f.key, f.text()).changed, false);
  assert.deepEqual(f.db(), once); assert.equal(f.events.length, 1);
});

test('a failed population handoff cannot leave partially changed coordinates, roster, console or geometry', () => {
  const f = fixture(), before = JSON.stringify({ dungeon: f.dungeon, db: f.db(), text: f.text(), roster: f.state.getCombatCharactersString() });
  assert.throws(() => Entry.publish(f.state, { ...f.options, createPopulation: staged => ({ prepare() {
    staged.setUpdatedGameConsole('partial'); staged.setCombatCharactersString('[]'); throw Error('Invalid saved population');
  } }) }), /Invalid saved population/);
  assert.equal(f.events.length, 0); assert.deepEqual(f.state.getLastCoords(), { x: 0, y: 0, z: 0 });
  assert.equal(JSON.stringify({ dungeon: f.dungeon, db: f.db(), text: f.text(), roster: f.state.getCombatCharactersString() }), before);
});

test('serialized finalized exits survive repeated browser/arrival installation without losing genre shapes or changing stamps', () => {
  const f = fixture(), original = JSON.stringify(f.dungeon.sceneStructures), stamp = f.dungeon._geometryStamp;
  for (let i = 0; i < 4; i++) {
    const restored = JSON.parse(JSON.stringify(f.dungeon));
    E.install(restored); require('../retort/roomEntry').prepare(restored, { fromKey: '0,0,0', input: 'north' });
    assert.equal(JSON.stringify(restored.sceneStructures), original);
    assert.equal(G.compute(restored, f.key), stamp);
  }
  const legacy = JSON.parse(JSON.stringify(f.dungeon)); delete legacy.roomExits.bindingSignature;
  E.install(legacy); assert.equal(G.compute(legacy, f.key), stamp);
  const changed = JSON.parse(JSON.stringify(f.dungeon)); E.install(changed, ['west']);
  assert.equal(changed.roomExits.signature, 'west'); assert.notEqual(G.compute(changed, f.key), stamp);
});

test('early browser handoff updates the map, roster and console without releasing the command gate or moving the camera', () => {
  const f = fixture(); Entry.publish(f.state, f.options); const event = f.events[0].entryReady;
  const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  const start = source.indexOf('window.applyPreparedRoomEntry ='), end = source.indexOf('const realtimeCombatResultsSeen', start);
  const window = { dungeonRunId: f.runId, DungeonInhabitants: I, GameCommandGate: { end: () => assert.fail('Concurrent world actions must stay blocked') } };
  const context = { window, currentDungeon: f.dungeon, currentCoordinates: {}, playerPosX: 7.5, playerPosY: 8.5,
    world1ApplyDatabase: () => {}, ensureKnownSpritesInCombatList() {}, updateCharacterSheetsFromConsole() {}, updateGameConsole() {} };
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal(window.applyPreparedRoomEntry(event), true);
  assert.equal(window.currentCoordinates, 'X: 0, Y: 1, Z: 0'); assert.equal(window.lastServerGameConsole, event.updatedGameConsole);
  assert.equal(context.playerPosX, 7.5); assert.equal(context.playerPosY, 8.5);
  assert.equal(window.applyPreparedRoomEntry({ ...event, runId: 'old' }), false);
});

test('the real console updater accepts a newly entered room with only one history row', () => {
  const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  const start = source.indexOf('function updateGameConsole('), end = source.indexOf('function displayPCData(', start);
  const text = 'Room Name: Relay Market\nRoom Description: An authored market.\nCoordinates: X: 0, Y: 1, Z: 0\nExits: south\nScore: 0\nMonsters in Room: None\nMonsters Equipped Properties: None\nMonsters State: None\nRooms Visited: 2';
  for (const count of [1, 2]) {
    const first = { roomName: 'Relay Market', roomHistory: 'An authored market.', response: '', roomExits: ['south'],
      roomEquipment: ['signal token'], objectMetadata: ['{"name":"signal token","type":"other"}'], adjacentRooms: [] };
    const rows = count === 1 ? [first] : [first, { roomEquipment: ['signal token'], objectMetadata: ['newer metadata'] }];
    const roomNameDatabase = new Map([['0,1,0', { name: 'Relay Market', classification: { indoor: true } }]]);
    const context = { console: { log() {}, warn() {}, error() {} }, window: { DungeonInhabitants: I },
      roomNameDatabase, roomConnections: {}, roomConversationHistories: { '0,1,0': rows },
      currentCoordinates: { x: 0, y: 1, z: 0 }, visitedRooms: new Set(['0,0,0']), unvisitedRooms: new Set(),
      monstersInVisitedRooms: new Map(), monstersEquippedPropertiesByRoom: new Map(), monstersStateByRoom: new Map(),
      characters: [], npcs: [], inventory: [], inventoryProperties: [], equipmentItems: ['torch'],
      turns: 1, charactersString: '', npcsString: '', globalArtifactsFound: 0, globalQuestsAchieved: 0,
      nextArtifact: 'None', nextBoss: 'None', nextBossRoom: 'None', bossCoordinates: 'None', currentQuest: 'None',
      coordinatesToString: c => `${c.x},${c.y},${c.z}`, findMatchingConsoleByCoordinates: () => 'Coordinates: X: 0, Y: 1, Z: 0',
      populateRoomNameDatabase() {}, mapToPlainObject: m => Object.fromEntries(m), generateMonstersForRoom() {},
      updateRoomConversationFirstResponse() {}, getFirstResponseForRoom: () => first, updateRoomConnections() {}, updateUnvisitedRoomsSet() {},
      escapeRegExp: s => s, calculateNumVisitedRooms: () => 2, calculateConnectedRooms: () => [],
      displayAllNPCData() {}, displayPCData() {}, completeQuestIfArtifactFound() {} };
    vm.runInNewContext(source.slice(start, end), context);
    const result = context.updateGameConsole('', context.currentCoordinates, text, null, text);
    assert.match(result, /Objects in Room: signal token/);
    assert.match(result, /Objects in Room Properties: \{"name":"signal token","type":"other"\}/);
    assert.equal(rows.length, count, 'Projection must not invent a second conversation row.');
  }
});

function browserDelivery(overrides = {}) {
  const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  const start = source.indexOf("    if (data.type === 'dungeonLoaded') {"), end = source.indexOf('    // Refresh the combat-map overlay', start);
  const calls = [], dungeon = { geoKey: '0,1,0', cells: {}, start: { x: 12, y: 18 } };
  const context = { data: { type: 'dungeonLoaded', geoKey: dungeon.geoKey, dungeon, entryReady: {} }, dungeonSwitchRequest: 0,
    currentDungeon: { geoKey: '0,0,0' }, DUNGEON_CACHE_VERSION: 1, playerDungeonX: 1, playerDungeonY: 1, playerPosX: 1.5, playerPosY: 1.5,
    playerAngle: 0, playerZInitialized: true, console: { log() {}, warn() {}, error() {} },
    ensureDungeonGeometryStamp: d => d, idbSetDungeon: async () => {}, world1ArrivalStart: () => null,
    findNearestWalkableStart: (_d, p) => p, choosePlayerSpawnAngle: () => 0,
    updatePlayerHeightFromCell: () => calls.push('height'), ensurePartyMazeIdleInterval() {}, logDungeonLayout() {},
    preloadDungeonTextures() {}, refreshPartyDungeonPresence() {}, renderDungeonView: () => calls.push('render'),
    presentRoomIllustration() {}, requestAnimationFrame() {},
    window: { dungeonRunId: 'run', RoomEntry: { prepare: async () => {}, failed: (error, details) => calls.push({ error: error.message, ...details }) },
      applyPreparedRoomEntry() {
        assert.equal(context.playerPosX, 12.5); assert.equal(context.playerPosY, 18.5);
        assert.equal(context.playerZInitialized, false); assert.deepEqual(calls, ['height']); calls.push('state'); return true;
      } } };
  Object.assign(context.window, overrides);
  vm.runInNewContext(source.slice(start, end) + '\n}', context);
  return { context, calls };
}

test('SSE room delivery places the camera before any prepared-state redraw', async () => {
  const f = browserDelivery(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, ['height', 'state', 'render']);
});

test('SSE handoff exceptions are caught and reported instead of silently abandoning a blank room', async () => {
  const f = browserDelivery({ applyPreparedRoomEntry() { throw Error('Invalid saved history'); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls[1].error, 'Invalid saved history'); assert.equal(f.calls[1].phase, 'prepared-state');
  assert.equal(f.calls[1].geoKey, '0,1,0'); assert.equal(f.calls.includes('render'), false);
});
