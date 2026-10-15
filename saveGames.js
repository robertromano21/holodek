'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { createHash, randomUUID } = require('node:crypto');
const Shape = require('./saveGameState');
const SLOT_COUNT = 10, MAX_BYTES = 192 * 1024 * 1024;
const error = (message, status = 400, code) => Object.assign(Error(message), { status, code });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function slotNumber(slot) { if (!/^(?:[1-9]|10)$/.test(String(slot))) throw error('Choose a save slot from 1 to 10.'); return Number(slot); }
function validatePayload(p) {
  if (!p || typeof p !== 'object') throw error('Invalid save payload.');
  Shape.validate(p.server);
  const b = p.browser, s = p.server, geo = `${s.lastCoords.x},${s.lastCoords.y},${s.lastCoords.z}`;
  if (b?.version !== 1 || b.runId !== s.dungeonRunId || b.geoKey !== geo || !b.position ||
      !['x', 'y', 'angle'].every(k => Number.isFinite(b.position[k])) || !b.conversation ||
      typeof b.conversation.id !== 'string' || !b.conversation.id || !Array.isArray(b.conversation.rows) || !b.data) throw error('Browser and server checkpoints do not match.');
  const room = s.roomDungeonDatabase[geo], { x, y } = b.position;
  if (x < 0 || y < 0 || x >= room.layout.width || y >= room.layout.height || !room.cells[`${Math.floor(x)},${Math.floor(y)}`]) throw error('Saved player position is outside the room.');
  if (p.runId !== s.dungeonRunId || p.roomKey !== geo || typeof p.label !== 'string' || p.label.length > 80) throw error('Invalid save metadata.');
  const record = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!record(p.settings) || typeof p.settings.model !== 'string' || !['1x', '2x', '4x'].includes(p.settings.sidMode)) throw error('Invalid saved settings.');
  for (const k of ['characters', 'npcs', 'inventory', 'visitedRooms', 'unvisitedRooms', 'connectedRooms', 'unconnectedRooms',
    'monstersInVisitedRooms', 'monstersEquippedPropertiesByRoom', 'monstersStateByRoom', 'combatCharacters'])
    if (!Array.isArray(b.data[k])) throw error('Invalid browser collection: ' + k);
  for (const k of ['roomConversationHistories', 'roomConnections', 'partyRegistry', 'spriteRegistry', 'roomImages', 'latestUpdatedData'])
    if (!record(b.data[k])) throw error('Invalid browser record: ' + k);
  for (const k of ['exploration', 'memories']) if (!Array.isArray(b[k]) || b[k].some(e => !record(e) || !Object.hasOwn(e, 'key') || !record(e.value))) throw error('Invalid browser archive: ' + k);
  if (b.exploration.some(e => !String(e.key).startsWith(p.runId + ':')) || b.memories.some(e => e.value.runId !== p.runId)) throw error('Browser archive belongs to a different adventure.');
  if (b.conversation.rows.some(r => !record(r) || r.conversationId !== b.conversation.id)) throw error('Invalid conversation archive.');
  if (!Number.isFinite(b.data.turns) || b.data.turns < 0 || typeof b.data.gameLogText !== 'string') throw error('Invalid browser progress.');
  return p;
}
function pack(payload) { validatePayload(payload); return { format: 'cotg-save', version: 1, checksum: digest(payload), payload }; }
function unpack(bytes) {
  const json = zlib.gunzipSync(bytes, { maxOutputLength: MAX_BYTES });
  const envelope = JSON.parse(json);
  if (envelope?.format !== 'cotg-save' || envelope.version !== 1 || envelope.checksum !== digest(envelope.payload)) throw error('Save file is damaged or unsupported.');
  validatePayload(envelope.payload); return envelope;
}
function createStore(directory = path.join(__dirname, '.retort-data/saves')) {
  const file = slot => path.join(directory, 'slot-' + String(slotNumber(slot)).padStart(2, '0') + '.json.gz');
  function read(slot) {
    const target = file(slot); if (!fs.existsSync(target)) throw error('That save slot is empty.', 404);
    try { return unpack(fs.readFileSync(target)); } catch (e) { throw error('Cannot load this save: ' + e.message, 422); }
  }
  function metadata(slot, envelope) { const p = envelope.payload;
    return { slot: slotNumber(slot), occupied: true, checksum: envelope.checksum, label: p.label, savedAt: p.savedAt,
      roomName: p.roomName, roomKey: p.roomKey, runId: p.runId, turns: p.turns, pc: p.pc, bytes: fs.statSync(file(slot)).size }; }
  function list() { return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const slot = i + 1; if (!fs.existsSync(file(slot))) return { slot, occupied: false };
    try { return metadata(slot, read(slot)); } catch (e) { return { slot, occupied: true, damaged: true, error: e.message }; }
  }); }
  function write(slot, payload, { overwrite = false, expectedChecksum } = {}) {
    const target = file(slot), envelope = pack(payload);
    if (fs.existsSync(target)) {
      if (!overwrite) throw error('This save slot is occupied. Confirm before replacing it.', 409, 'SLOT_OCCUPIED');
      if (expectedChecksum && read(slot).checksum !== expectedChecksum) throw error('This slot changed. Refresh before replacing it.', 409);
    }
    const json = Buffer.from(JSON.stringify(envelope)); if (json.length > MAX_BYTES) throw error('Save exceeds the size limit.', 413);
    fs.mkdirSync(directory, { recursive: true });
    const temp = target + '.' + randomUUID() + '.tmp'; let fd;
    try {
      fd = fs.openSync(temp, 'wx'); fs.writeFileSync(fd, zlib.gzipSync(json)); fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
      if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak');
      fs.renameSync(temp, target);
      const verified = read(slot); if (verified.checksum !== envelope.checksum) throw Error('Save verification failed.');
      return metadata(slot, verified);
    } finally { if (fd != null) fs.closeSync(fd); if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  return { read, write, list, file };
}
function install(app, options) {
  if (app.__holodekSaves) return app.__holodekSaves;
  const express = require('express'), state = options.state, store = options.store || createStore();
  const Models = options.models || require('./retort/gameModels'), Dice = options.dice || require('./retort/actionDice').actionDice;
  const Traits = options.traits || require('./retort/characterTraitSpec');
  let locked = false;
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.headers.origin && new URL(req.headers.origin).host !== req.get('host')) return res.status(403).json({ error: 'Use Save/Load from the game window.' });
    next();
  });
  router.use(express.json({ limit: MAX_BYTES }));
  const busy = async () => !!Dice.active || !!(await options.isBusy?.());
  const capture = options.capture || (() => state.exportSaveState());
  async function exclusive(req, operation) {
    if (locked) throw error('A save or load is already running.', 409);
    if (req.body?.runId !== state.getDungeonRunId()) throw error('This game window belongs to a different adventure.', 409);
    locked = true;
    try { if (await busy()) throw error('Finish the current command and combat round before saving or loading.', 409);
      return await operation();
    } finally { locked = false; }
  }
  const handle = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }); } };
  router.get('/', handle(async (req, res) => res.json({ slots: store.list(), slotCount: SLOT_COUNT, canLoad: typeof state.importSaveState === 'function', liveBridge: !!options.liveBridge })));
  router.get('/:slot', handle(async (req, res) => { const e = store.read(req.params.slot); res.json({ checksum: e.checksum, browser: e.payload.browser, metadata: {
    runId: e.payload.runId, roomKey: e.payload.roomKey, label: e.payload.label } }); }));
  router.post('/:slot', handle(async (req, res) => {
    const result = await exclusive(req, async () => {
      if (!state.getGamePaused()) throw error('Pause the game before creating a checkpoint.', 409);
      const snapshot = Shape.validate(await capture()), browser = Shape.clone(req.body.browser);
      const geo = `${snapshot.lastCoords.x},${snapshot.lastCoords.y},${snapshot.lastCoords.z}`;
      const rooms = JSON.parse(snapshot.roomNameDatabaseString), text = snapshot.updatedGameConsole;
      return store.write(req.params.slot, { savedAt: new Date().toISOString(), label: String(req.body.label || 'Adventure').trim().slice(0, 80),
        runId: snapshot.dungeonRunId, roomKey: geo, roomName: rooms[geo]?.name || geo,
        turns: Number(text.match(/^Turns:\s*(\d+)/m)?.[1]) || 0, pc: snapshot.currentPC?.Name || snapshot.currentPC?.name || '',
        settings: { model: Models.current().id, sidMode: require('./retort/sidMode').get() },
        characterTraits: { ...Traits.getCachedTraitSpecs(), ...(browser.data.characterTraits || {}) },
        server: snapshot, browser }, req.body);
    });
    console.info('[GameSaved]', JSON.stringify({ slot: result.slot, runId: result.runId, roomKey: result.roomKey, bytes: result.bytes }));
    res.json({ saved: true, ...result });
  }));
  router.post('/:slot/load', handle(async (req, res) => {
    const loaded = await exclusive(req, async () => {
      if (typeof state.importSaveState !== 'function') throw error('Your checkpoint can be saved now. Restart the server before loading it.', 409);
      const envelope = store.read(req.params.slot), p = envelope.payload;
      if (req.body.checksum !== envelope.checksum) throw error('The save slot changed; choose it again.', 409);
      if (!Models.catalog.some(m => m.id === p.settings.model) && p.settings.model !== 'original') throw error('Saved game model is not supported by this build.');
      // Render just this room before committing. Returning to another saved
      // room lazily rebuilds its graphics from its own recipe in sharedState.
      const server = options.rebuild ? await options.rebuild(p.server, p.roomKey) : require('./saveGameAssets').rebuild(p.server, p.roomKey);
      Shape.validate(server);
      const characterTraits = require('./saveGameAssets').characterTraits(p);
      Traits.restoreCachedTraitSpecs(characterTraits);
      const priorModel = Models.current().id;
      try { Models.restore(p.settings.model); state.importSaveState({ ...server, gamePaused: true }, { graphicsReady: [p.roomKey] }); }
      catch (e) { Models.restore(priorModel); throw e; }
      Dice.setPaused(true); Dice.results.clear(); Dice.epoch = randomUUID(); Dice.revision++;
      let audio = null, warning = null;
      try { audio = await options.onRestored?.(p); } catch (e) { warning = 'The adventure loaded, but audio could not be rebuilt: ' + e.message; console.warn('[GameLoadAudio]', e.message); }
      const geo = p.roomKey, dungeon = state.getRoomDungeon(state.getLastCoords());
      return { loaded: true, checksum: envelope.checksum, browser: p.browser, runId: p.runId, roomKey: geo, audio, warning, characterTraits,
        updatedGameConsole: state.getUpdatedGameConsole(), roomNameDatabaseString: state.getRoomNameDatabase(),
        combatCharactersString: state.getCombatCharactersString(), dungeon, population: state.getRoomPopulation(geo) };
    });
    console.info('[GameLoaded]', JSON.stringify({ slot: req.params.slot, runId: loaded.runId, roomKey: loaded.roomKey }));
    res.json(loaded);
  }));
  router.use((e, req, res, next) => res.status(e.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid or oversized save request.' }));
  // Install ahead of the old general JSON parser as well, so this can be added
  // to a live pre-feature process without its 2 MB body cap truncating the save.
  const middleware = (req, res, next) => {
    if (locked && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.path.startsWith('/game-saves')) return res.status(423).json({ error: 'A checkpoint is being written or restored.' });
    next();
  };
  app.use(middleware); const guard = app._router.stack.pop(); app._router.stack.splice(2, 0, guard);
  app.use('/game-saves', router); const layer = app._router.stack.pop(); app._router.stack.splice(3, 0, layer);
  return app.__holodekSaves = { store, router, version: 1 };
}
module.exports = { SLOT_COUNT, MAX_BYTES, createStore, pack, unpack, validatePayload, slotNumber, install };
