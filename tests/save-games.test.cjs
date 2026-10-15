'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib');
const express = require('express');
const Saves = require('../saveGames'), Shape = require('../saveGameState'), State = require('../sharedState');
const Assets = require('../saveGameAssets');
const { bindings } = require('../liveSaveBridge');
const { ActionDice } = require('../retort/actionDice');
function fixture() {
  const runId = 'test-save-run', server = State.exportSaveState();
  Object.assign(server, { dungeonRunId: runId, lastCoords: { x: 0, y: 0, z: 0 }, gamePaused: true,
    updatedGameConsole: 'Room: Test Temple\nCoordinates: X: 0, Y: 0, Z: 0\nTurns: 4\nSilver Pieces: 6',
    roomNameDatabaseString: JSON.stringify({ '0,0,0': { name: 'Test Temple', economy: { silver: 6 }, life: { revivals: 1 } }, '1,0,0': { name: 'Old Room' } }),
    combatCharactersString: JSON.stringify([{ name: 'Mortacia', type: 'pc', hp: 91, sprite: { spec: { seed: .7 } } }]),
    roomDungeonDatabase: { '0,0,0': { geoKey: '0,0,0', layout: { width: 2, height: 2 }, cells: { '0,0': { tile: 'floor', door: { isOpen: false } } }, tiles: {} },
      '1,0,0': { geoKey: '1,0,0', layout: { width: 2, height: 2 }, cells: { '0,0': { tile: 'floor' } }, tiles: {} } },
    roomMusicDatabase: { '0,0,0': { title: 'Preserved Score', voices: [{ pattern: [{ note: 'C', octave: 4, duration: 4 }] }] } },
    roomPopulations: { '0,0,0': { geoKey: '0,0,0', actors: { a: { hp: 2, memory: ['I remember you.'] } } } },
    campaignMemory: { runId, version: 1, records: [{ text: 'We opened the well.' }], sequence: 1 },
    questLog: Array.from({ length: 80 }, (_, n) => ({ text: 'Quest ' + n })), currentPC: { Name: 'Mortacia' } });
  const browser = { version: 1, runId, geoKey: '0,0,0', position: { x: .5, y: .5, z: 1, angle: .25 },
    conversation: { id: 'story', rows: [{ id: 4, conversationId: 'story', response: 'Hello', systemPrompt: 'The Grave Master' }] },
    exploration: [{ key: runId + ':0,0,0', value: { seen: [1, 0, 0, 0] } }], memories: [{ key: 'm1', value: { key: 'm1', runId, text: 'The well.' } }],
    data: { characters: [], npcs: [], inventory: ['spear'], inventoryProperties: [{ name: 'spear', magic: 3 }], equippedInventory: {},
      visitedRooms: ['0,0,0'], unvisitedRooms: ['1,0,0'], connectedRooms: [], unconnectedRooms: [], monstersInVisitedRooms: [],
      monstersEquippedPropertiesByRoom: [], monstersStateByRoom: [], combatCharacters: [], roomConversationHistories: {}, roomConnections: {},
      partyRegistry: {}, spriteRegistry: {}, roomImages: {}, latestUpdatedData: {}, turns: 4, gameLogText: 'Hello', audioCheckpoint: { time: 42, paused: false } } };
  return { server, browser, runId, savedAt: new Date().toISOString(), label: 'My Adventure', roomKey: '0,0,0', roomName: 'Test Temple', turns: 4, pc: 'Mortacia', settings: { model: 'original', sidMode: '2x' } };
}
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-save-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('exact server checkpoint roundtrip includes full quest log, roster, ledgers, music and private Maps', async () => {
  const p = fixture(); State.importSaveState(p.server, { graphicsReady: ['0,0,0', '1,0,0'] });
  assert.deepEqual(State.exportSaveState(), p.server);
  assert.equal(State.getQuestLog().length, 50); assert.equal(State.exportSaveState().questLog.length, 80);
  assert.deepEqual(Shape.clone(await bindings(State.getDungeonRunId, Shape.FIELDS)), p.server);
  assert.deepEqual(await bindings((() => { let inputTaskInFlight = false, npcAutonomyTickInFlight = true; return () => inputTaskInFlight || npcAutonomyTickInFlight; })(), ['inputTaskInFlight', 'npcAutonomyTickInFlight']), { inputTaskInFlight: false, npcAutonomyTickInFlight: true });
  await assert.rejects(bindings(State.getDungeonRunId, ['missingBinding']), /missingBinding/);
});

test('save has exactly ten bounded slots, checksummed atomic writes and overwrite backups', t => {
  const store = Saves.createStore(temp(t)), p = fixture();
  assert.equal(store.list().length, 10); assert.ok(store.list().every(x => !x.occupied));
  for (const bad of [0, 11, '01', '../1', '1/../../x', 1.5]) assert.throws(() => store.file(bad), /1 to 10/);
  const first = store.write(1, p); assert.ok(first.bytes > 0); assert.deepEqual(store.read(1).payload, p);
  assert.throws(() => store.write(1, p), /occupied/);
  assert.throws(() => store.write(1, p, { overwrite: true, expectedChecksum: 'stale' }), /changed/);
  const second = store.write(1, { ...p, label: 'Second' }, { overwrite: true, expectedChecksum: first.checksum });
  assert.notEqual(second.checksum, first.checksum); assert.equal(Saves.unpack(fs.readFileSync(store.file(1) + '.bak')).payload.label, p.label);
  assert.equal(fs.readdirSync(path.dirname(store.file(1))).some(x => x.endsWith('.tmp')), false);
  for (let n = 2; n <= 10; n++) store.write(n, p); assert.equal(store.list().filter(x => x.occupied).length, 10);
});

test('corruption, truncation and mismatched room/history never become a valid checkpoint', t => {
  const store = Saves.createStore(temp(t)), p = fixture(), envelope = Saves.pack(p);
  envelope.payload.label = 'Tampered'; assert.throws(() => Saves.unpack(zlib.gzipSync(JSON.stringify(envelope))), /damaged/);
  store.write(1, p); const bytes = fs.readFileSync(store.file(1)); fs.writeFileSync(store.file(1), bytes.subarray(0, 30));
  assert.equal(store.list()[0].damaged, true); assert.throws(() => store.read(1), /Cannot load/);
  let b = structuredClone(p); b.browser.geoKey = '9,9,9'; assert.throws(() => Saves.pack(b), /do not match/);
  b = structuredClone(p); b.browser.position.x = 3; assert.throws(() => Saves.pack(b), /outside/);
  b = structuredClone(p); b.browser.conversation.rows[0].conversationId = 'future'; assert.throws(() => Saves.pack(b), /conversation/);
  b = structuredClone(p); b.browser.exploration[0].key = 'another:0,0,0'; assert.throws(() => Saves.pack(b), /different adventure/);
  b = structuredClone(p); b.server.currentTaskIndex = 9; assert.throws(() => Saves.pack(b), /quest/);
  b = structuredClone(p); b.server.roomDungeonDatabase = {}; assert.throws(() => Saves.pack(b), /geometry/);
  b = structuredClone(p); b.settings.sidMode = 'invalid'; assert.throws(() => Saves.pack(b), /settings/);
});

test('graphics rebuild only current room, preserves gameplay and does not require generated PNGs', () => {
  const p = fixture(), calls = [];
  for (const d of Object.values(p.server.roomDungeonDatabase)) { d.visualStyle = { palette: { primary: '#887766' } }; d.tiles.floor = { url: '/sid/sprites/deleted.png' }; }
  const before = structuredClone(p.server);
  const next = Assets.rebuild(p.server, '0,0,0', { generateSprite: (style, type, name) => { calls.push(name); return '/sid/sprites/rebuilt.png'; }, sceneGraphics() {} });
  assert.deepEqual(calls, ['0,0,0_floor']); assert.deepEqual(p.server, before);
  assert.deepEqual(next.roomDungeonDatabase['0,0,0'].cells, before.roomDungeonDatabase['0,0,0'].cells);
  assert.equal(next.roomDungeonDatabase['1,0,0'].tiles.floor.url, '/sid/sprites/deleted.png');
  assert.deepEqual(next.roomMusicDatabase, before.roomMusicDatabase);
});

test('procedural image recipe reproduces pixels with a local RNG, even after PNG deletion', t => {
  const { generateSpriteFromStyle } = require('../assets/renderSprite_poke'), directory = temp(t), name = 'saved_floor';
  const rng = Math.random, style = { palette: { primary: '#887766' }, floor: { pattern: 'tiles', cracks: .5 } };
  generateSpriteFromStyle(style, 'floor', name, { directory }); const first = fs.readFileSync(path.join(directory, name + '.png'));
  fs.unlinkSync(path.join(directory, name + '.png')); generateSpriteFromStyle(style, 'floor', name, { directory });
  assert.deepEqual(fs.readFileSync(path.join(directory, name + '.png')), first); assert.equal(Math.random, rng);
  assert.throws(() => generateSpriteFromStyle(style, 'floor', '../escape', { directory }), /Invalid sprite name/);
});

test('structural variants retain voxel definitions and share the reconstructed surface image', () => {
  const p = fixture(), dungeon = p.server.roomDungeonDatabase['0,0,0'];
  dungeon.visualStyle = { palette: {} };
  dungeon.tiles = { wall: { url: '/sid/sprites/wall.png' }, custom_structure_carved: { url: '/sid/sprites/wall.png', spriteSpec: { carving: 'laurel', depth: 3 } } };
  const next = Assets.rebuild(p.server, '0,0,0', { generateSprite: () => '/sid/sprites/new-wall.png', sceneGraphics() {} }).roomDungeonDatabase['0,0,0'];
  assert.equal(next.tiles.custom_structure_carved.url, '/sid/sprites/new-wall.png'); assert.deepEqual(next.tiles.custom_structure_carved.spriteSpec, dungeon.tiles.custom_structure_carved.spriteSpec);
});

test('old bridge saves recover complete character recipes from their existing actor sprites', () => {
  const p = fixture();
  p.browser.data.combatCharacters = [{ sprite: { spec: { kind: 'procedural', source: 'llm', name: 'The Keeper', sex: 'Female', race: 'Shade', class: 'Witch', level: 3, salt: 44, variant: 2, traits: { bodyPlan: 'humanoid' } } } }];
  const recipes = Assets.characterTraits(p);
  assert.equal(recipes['the keeper'].salt, 44); assert.equal(recipes['the keeper'].variant, 2); assert.equal(recipes['the keeper'].appearance.class, 'Witch');
});

test('import defers old-room graphics until its first request and rebuilds each only once', () => {
  const p = fixture(), real = Assets.rebuildRoom, rebuilt = [];
  try {
    Assets.rebuildRoom = (room, key) => { rebuilt.push(key); return room; };
    State.importSaveState(p.server, { graphicsReady: ['0,0,0'] });
    State.getRoomDungeon({ x: 0, y: 0, z: 0 }); assert.deepEqual(rebuilt, []);
    State.getRoomDungeon({ x: 1, y: 0, z: 0 }); State.getRoomDungeon({ x: 1, y: 0, z: 0 }); assert.deepEqual(rebuilt, ['1,0,0']);
  } finally { Assets.rebuildRoom = real; }
});

async function httpFixture(t) {
  const p = fixture(); State.importSaveState(p.server, { graphicsReady: ['0,0,0'] });
  let selected = 'original', busy = false, renders = 0;
  const app = express(), dice = new ActionDice(); app.use(express.json({ limit: '2mb' }));
  const store = Saves.createStore(temp(t));
  Saves.install(app, { state: State, store, dice, models: { catalog: [], current: () => ({ id: selected }), restore: id => { selected = id; } },
    traits: { getCachedTraitSpecs: () => ({}), restoreCachedTraitSpecs() {} },
    isBusy: () => busy, rebuild: async (server, key) => { renders++; assert.equal(key, '0,0,0'); return Shape.clone(server); }, onRestored: () => ({ url: '/sid/room_A.wav' }) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(url, body, headers = {}) { const r = await fetch(base + '/game-saves' + url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
  return { p, request, store, dice, busy: value => { busy = value; }, renders: () => renders };
}
test('HTTP save/load pairs browser/server state, bypasses old parser size cap, restores fresh-server state paused', async t => {
  const f = await httpFixture(t); f.p.browser.data.gameLogText = 'x'.repeat(3 * 1024 * 1024);
  const saved = await f.request('/1', { runId: f.p.runId, browser: f.p.browser, label: 'Large history' }); assert.equal(saved.status, 200, saved.data.error);
  assert.equal((await f.request('')).data.slots.length, 10);
  State.setUpdatedGameConsole(''); State.setRoomNameDatabase(''); State.setCombatCharactersString('');
  const loaded = await f.request('/1/load', { runId: f.p.runId, checksum: saved.data.checksum });
  assert.equal(loaded.status, 200, loaded.data.error); assert.equal(loaded.data.loaded, true); assert.equal(f.renders(), 1);
  assert.equal(loaded.data.browser.data.gameLogText.length, 3 * 1024 * 1024); assert.equal(loaded.data.audio.url, '/sid/room_A.wav');
  assert.equal(f.dice.paused, true); assert.equal(State.getGamePaused(), true); assert.deepEqual(State.exportSaveState().questLog, f.p.server.questLog);
});
test('HTTP refuses stale/cross-origin/busy/unpaused/changed saves without changing progress', async t => {
  const f = await httpFixture(t), body = { runId: f.p.runId, browser: f.p.browser };
  assert.equal((await f.request('/1', { ...body, runId: 'old' })).status, 409);
  assert.equal((await f.request('/1', body, { Origin: 'https://other.example' })).status, 403);
  f.busy(true); assert.equal((await f.request('/1', body)).status, 409); f.busy(false);
  State.setGamePaused(false); assert.equal((await f.request('/1', body)).status, 409); State.setGamePaused(true);
  const saved = await f.request('/1', body); assert.equal(saved.status, 200, saved.data.error);
  const before = State.exportSaveState(); assert.equal((await f.request('/1/load', { runId: f.p.runId, checksum: 'stale' })).status, 409);
  assert.deepEqual(State.exportSaveState(), before); assert.equal(f.renders(), 0);
});
