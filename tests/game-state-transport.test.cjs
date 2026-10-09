const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const express = require('express');
const { createGameJsonParser, gameJsonErrorHandler, createRoomDatabaseReceiver } = require('../gameStateTransport');
const RoomDatabaseSync = require('../assets/roomDatabaseSync');

const browser = fs.readFileSync(path.join(__dirname, '../assets/game.js'), 'utf8').replace(/\r\n/g, '\n');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const quietConsole = { info() {}, error() {}, log() {} };
const syncSource = browser.slice(browser.indexOf('const roomDatabaseSyncClient ='), browser.indexOf('async function chatbotprocessinput('));
const syncContext = () => ({ console: quietConsole, window: { RoomDatabaseSync } });

test('normal-play state over 100 KB reaches the real state-update route before the command', async () => {
  const app = express(), state = {};
  const setters = {
    setPersonalNarrative: v => { state.narrative = v; },
    setUpdatedGameConsole: v => { state.console = v; },
    setRoomNameDatabase: v => { state.rooms = v; },
    getRoomNameDatabase: () => state.rooms,
    setCombatCharactersString() {}, setCombatMode() {}, setDungeonTestingMode: v => { state.testMode = v; },
    setCurrentQuest() {}, setLiveWorldState() {}
  };
  app.use(createGameJsonParser());
  const start = server.indexOf("app.post('/updateState7'");
  const end = server.indexOf('// NEW: Endpoint to get room music', start);
  vm.runInNewContext(server.slice(start, end), { app, sharedState: setters, roomDatabaseReceiver: createRoomDatabaseReceiver(), inputTaskInFlight: false, console: quietConsole });
  app.post('/processInput7', (req, res) => res.json({ console: state.console, testMode: state.testMode }));
  app.use(gameJsonErrorHandler);
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  const base = `http://127.0.0.1:${listener.address().port}`;
  try {
    const context = syncContext();
    vm.runInNewContext(syncSource, context);
    const payload = { personalNarrative: 'History '.repeat(15000), updatedGameConsole: 'Coordinates: X: -1, Y: -2, Z: -2\nRoom Name: The Veiled Abyss',
      roomNameDatabaseString: JSON.stringify({ '-1,-2,-2': { description: 'A room '.repeat(20000) } }), dungeonTestingMode: false };
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) > 100 * 1024);
    const ack = await context.syncGameStateBeforeCommand(payload, (url, options) => fetch(base + url, options));
    assert.equal(ack.geoKey, '-1,-2,-2');
    assert.equal(state.rooms, payload.roomNameDatabaseString);
    const response = await fetch(base + '/processInput7', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"userInput":"down"}' });
    const result = await response.json();
    assert.equal(result.console, payload.updatedGameConsole);
    assert.equal(result.testMode, false);
    // Ordinary endpoints still have a bounded payload limit and return JSON errors.
    const tooLarge = await fetch(base + '/processInput7', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userInput: 'x'.repeat(3 * 1024 * 1024) }) });
    assert.equal(tooLarge.status, 413);
    assert.match((await tooLarge.json()).error, /size limit/);
  } finally {
    listener.closeAllConnections();
    await new Promise(resolve => listener.close(resolve));
  }
});

test('rejected, busy, malformed and wrong-room acknowledgements do not allow processing', async () => {
  const context = syncContext();
  vm.runInNewContext(syncSource, context);
  const payload = { updatedGameConsole: 'Coordinates: X: 1, Y: 0, Z: 0', roomNameDatabaseString: '{}' };
  for (const status of [413, 409, 500]) {
    await assert.rejects(context.syncGameStateBeforeCommand(payload, async () => ({ ok: false, status, json: async () => { throw new Error('HTML error page'); } })), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(context.syncGameStateBeforeCommand(payload, async () => ({ ok: true, json: async () => ({ geoKey: '0,0,0' }) })), /different room/);
  await assert.rejects(context.syncGameStateBeforeCommand(payload, async () => { throw new Error('Network unavailable'); }), /Network unavailable/);
});

test('1000 visited rooms send only one changed entry; server story changes survive', () => {
  const client = RoomDatabaseSync.createClient(), receiver = createRoomDatabaseReceiver();
  const rooms = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`${i},0,0`, { description: 'A richly described room. '.repeat(20), visited: true }]));
  const json = JSON.stringify(rooms), full = receiver.apply(client.prepare(json), '{}');
  client.acknowledge(json, full.token);
  assert.equal(client.prepare(json).roomDatabaseSync.mode, 'patch');
  rooms['500,0,0'].searched = true;
  const patch = client.prepare(JSON.stringify(rooms));
  assert.deepEqual(Object.keys(patch.roomDatabaseSync.updates), ['500,0,0']);
  assert.ok(Buffer.byteLength(JSON.stringify(patch)) < 2000);
  const serverRooms = JSON.parse(full.json); serverRooms['200,0,0'].storyEvent = 'A gate opens.';
  const merged = JSON.parse(receiver.apply(patch, JSON.stringify(serverRooms)).json);
  assert.equal(merged['200,0,0'].storyEvent, 'A gate opens.');
  assert.equal(merged['500,0,0'].searched, true);
  delete rooms['500,0,0'];
  assert.deepEqual(client.prepare(JSON.stringify(rooms)).roomDatabaseSync.removed, ['500,0,0']);
});

test('server restart triggers one full browser resync before the command can proceed', async () => {
  const context = syncContext(); vm.runInNewContext(syncSource, context);
  let receiver = createRoomDatabaseReceiver(), stored = '{}';
  const modes = [], payload = { roomNameDatabaseString: '{"0,0,0":{"name":"Temple"}}', updatedGameConsole: 'Coordinates: X: 0, Y: 0, Z: 0' };
  const transport = async (url, options) => {
    const request = JSON.parse(options.body); modes.push(request.roomDatabaseSync.mode);
    try {
      const result = receiver.apply(request, stored); stored = result.json;
      return { ok: true, json: async () => ({ geoKey: '0,0,0', roomDatabaseSyncToken: result.token }) };
    } catch (error) {
      return { ok: false, status: 409, json: async () => ({ code: error.code, error: error.message }) };
    }
  };
  await context.syncGameStateBeforeCommand(payload, transport);
  receiver = createRoomDatabaseReceiver(); stored = '{}';
  await context.syncGameStateBeforeCommand(payload, transport);
  assert.deepEqual(modes, ['full', 'patch', 'full']);
  assert.equal(JSON.parse(stored)['0,0,0'].name, 'Temple');
});

test('new games have separate dungeon caches while revisits retain the current game room', async () => {
  const shared = require('../sharedState');
  const coords = { x: 1, y: 0, z: 0 }, dungeon = { cells: { '1,1': { tile: 'floor' } }, layout: { width: 3, height: 3 } };
  const first = shared.beginDungeonRun();
  shared.setRoomDungeon(coords, dungeon);
  assert.deepEqual(shared.getRoomDungeon(coords).cells, dungeon.cells);
  const second = shared.beginDungeonRun();
  assert.notEqual(first, second); assert.equal(shared.getRoomDungeon(coords), null);
  const storage = new Map(), accessed = [];
  const context = { window: { dungeonRunId: first }, DUNGEON_STORE: 'rooms', openDungeonDB: async () => ({
    transaction() {
      const transaction = { objectStore() { return {
        get(key) { accessed.push(key); const req = { result: storage.get(key) }; queueMicrotask(() => req.onsuccess()); return req; },
        put(value, key) { storage.set(key, value); queueMicrotask(() => transaction.oncomplete()); }
      }; } };
      return transaction;
    }
  }) };
  const functions = browser.slice(browser.indexOf('async function idbGetDungeon('), browser.indexOf('let pendingLodPersist'));
  vm.runInNewContext(functions, context);
  await context.idbSetDungeon('1,0,0', { ...dungeon, _meta: { runId: first } });
  assert.ok(await context.idbGetDungeon('1,0,0'));
  context.window.dungeonRunId = second;
  assert.equal(await context.idbGetDungeon('1,0,0'), null);
  assert.deepEqual(accessed, [`${first}:1,0,0`, `${second}:1,0,0`]);
});

test('normal command handoff rolls back optimistic coordinates and returns on sync failure', async () => {
  const start = browser.indexOf('try {\n  if (!completedStartResult) await syncGameStateBeforeCommand(');
  const end = browser.indexOf('// An attack starts', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    syncGameStateBeforeCommand: async () => { throw new Error('413'); },
    personalNarrative: '', updatedGameConsole: '', roomNameDatabaseString: '{}', combatMode: '',
    currentCoordinates: { x: -1, y: -2, z: -2 }, coordinatesBeforeCommand: { x: -1, y: -2, z: -1 },
    window: { combatCharacters: [], keepAliveInterval: null }, fetchWithTimeout() {}, clearInterval() {}, console: quietConsole,
    userInput: 'down', updateChatLog() {}, document: { getElementById: () => ({}) }, processed: false,
    completedStartResult: null
  };
  await vm.runInNewContext(`(async () => { ${browser.slice(start, end)} processed = true; })()`, context);
  assert.equal(context.processed, false);
  assert.deepEqual(context.currentCoordinates, context.coordinatesBeforeCommand);
});
