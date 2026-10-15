const serverLog = require('./serverLogger').installServerLogger();

const express = require('express');
const { createGameJsonParser, gameJsonErrorHandler, createRoomDatabaseReceiver } = require('./gameStateTransport');
const cors = require('cors');
const { retortWithUserInput, runNpcAutonomyTick, generatePartyCharacterProfiles } = require('./retort/retortWithUserInput.js');
const sharedState = require('./sharedState');
const Inhabitants = require('./assets/dungeonInhabitants');
const PhysicalPuzzles = require('./assets/physicalPuzzles');
const QuestScenes = require('./retort/questScenes');
const Economy = require('./retort/economy');
const AdventureJournal = require('./retort/adventureJournal');
const SpellSystem = require('./retort/spellSystem');
const ClassMagic = require('./retort/classMagic');
const CombatLife = require('./retort/combatLife');
const PartySpellbook = require('./retort/partySpellbook');
const GameLogContent = require('./assets/gameLogContent');
const CampaignMemory = require('./retort/campaignMemory');
const DialogueTurns = require('./retort/dialogueTurns');
const { createPopulationService } = require('./retort/roomPopulation');
const { narrateEncounter } = require('./retort/encounterNarration');
const populationService = createPopulationService(sharedState);
DialogueTurns.install(sharedState, Inhabitants);
const fs = require('fs');
const path = require('path');
const LiveRoomMusic = require('./retort/liveRoomMusic');
const MusicSlots = require('./retort/musicSlots');
const SidVoice = require('./retort/sidVoice'); // 64-SID speech (Piper analysis -> SID vocoder), pre-synthesized at dialogue creation
const characterTraits = require('./retort/characterTraitSpec');
const { summarizeDungeon } = require('./dungeonDiagnostics');
const { actionDice } = require('./retort/actionDice');
const { finalizeRoomDungeon } = require('./retort/retortWithUserInput');
const SecretDoors = require('./retort/secretDoors');
const { buildEnvironmentLab, descriptions: environmentLabKinds } = require('./retort/environmentLab');
const { buildInitialWorldConsole, buildInitialGameConsole } = require('./retort/initialGameState');
const app = express();
const port = 3000;
const roomDatabaseReceiver = createRoomDatabaseReceiver();

// Middleware
app.use(createGameJsonParser());
app.use(cors());
require('./retort/gameModels').install(app);
SidVoice.install(app, express); // /voice/profiles, /voice/line.wav, /voice/status
require('./retort/audioPalette').install(app, sharedState); // same-score SID variants; effects rendered off-thread
require('./retort/sidArchive').install(app, express);
// Stock / Enhanced SID switch (♫ panel): one global clock mode for voices, music renders and the effects set (retort/sidMode.js)
const SidMode = require('./retort/sidMode');
app.get('/sid-mode', (req, res) => res.json({ mode: SidMode.get() }));
app.post('/sid-mode', express.json({ limit: '1kb' }), (req, res) => {
  const want = SidMode.norm(req.body && req.body.mode); if (!want) return res.status(400).json({ error: 'mode must be 1x, 2x or 4x' });
  res.json({ mode: SidMode.set(want), music: 'next room song renders in this mode' });
});
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
app.use('/sid', express.static(path.join(__dirname, 'sid'), {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// SSE broadcaster
const clients = [];

app.get('/combat-updates2', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial connection confirmation
    res.write(`data: connected at ${new Date().toISOString()}\n\n`);

    // Heartbeat every 15 seconds to keep the stream alive
    const keepAlive = setInterval(() => {
        res.write(`data: ping ${Date.now()}\n\n`);
    }, 15000);

    const client = {
        res,
        send: (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };
    clients.push(client);
    client.send({ type: 'dungeonRun', runId: sharedState.getDungeonRunId() });
    client.send({ type: 'campaign_memory', runId: sharedState.getDungeonRunId(), records: CampaignMemory.exportRecords(sharedState).slice(-128) });
    client.send(actionDice.snapshot());
    client.send({ type: 'game_pause', paused: sharedState.getGamePaused(), runId: sharedState.getDungeonRunId() });
    client.send({ type: 'life_status', ...CombatLife.status(sharedState) });
    const coords = sharedState.getLastCoords();
    const population = coords && sharedState.getRoomPopulation(`${coords.x},${coords.y},${coords.z}`);
    if (population) client.send({ type: 'room_population', population, runId: sharedState.getDungeonRunId() });
    if (actionDice.active?.kind === 'combat') client.send({ type: 'combat_health',
      actionId: actionDice.active.id, revision: actionDice.active.healthRevision || 0,
      geoKey: actionDice.active.geoKey, runId: sharedState.getDungeonRunId(),
      updatedGameConsole: sharedState.getUpdatedGameConsole(),
      combatCharactersString: sharedState.getCombatCharactersString(), population });

    req.on('close', () => {
        clearInterval(keepAlive);
        const index = clients.indexOf(client);
        if (index !== -1) clients.splice(index, 1);
    });
});

// Function to broadcast to all connected clients
function broadcast(data) {
    if (data && data.type === 'character_dialogue') SidVoice.prefetch(data.dialogue);
    if (data.type === 'dungeonLoaded' && data.dungeon) {
        console.info('[DungeonDelivered]', JSON.stringify(summarizeDungeon(data.dungeon)));
    }
    clients.forEach(client => client.send(data));
}
sharedState.emitter.on('combat_life', status => broadcast({ type: 'life_status', ...status }));
require('./retort/campaignPlanningLog').watch(sharedState);

app.post('/debug/dungeon-rendering', (req, res) => {
    const report = req.body;
    if (!report || typeof report.geoKey !== 'string' || !/^-?\d+,-?\d+,-?\d+$/.test(report.geoKey) ||
        !Array.isArray(report.samples) || report.samples.length > 100 ||
        report.samples.some(sample => !sample || typeof sample.key !== 'string') ||
        (report.combatMap?.samples && (!Array.isArray(report.combatMap.samples) ||
            report.combatMap.samples.length > 100 || report.combatMap.samples.some(sample => !sample || typeof sample.key !== 'string')))) {
        return res.status(400).json({ error: 'Invalid dungeon diagnostic report' });
    }
    const [x, y, z] = report.geoKey.split(',').map(Number);
    const dungeon = sharedState.getRoomDungeon({ x, y, z });
    const mismatches = [];
    for (const sample of report.samples) {
        const cell = dungeon?.cells?.[sample.key];
        const source = sample.source;
        if (!source || !cell || source.tile !== cell.tile ||
            source.floor !== (Number.isFinite(cell.floorHeight) ? cell.floorHeight : 0) ||
            source.ceil !== (Number.isFinite(cell.ceilHeight) ? cell.ceilHeight : (cell.floorHeight || 0) + 2)) {
            mismatches.push({ key: sample.key, browser: source, server: cell || null });
        }
    }
    const comparison = {
        serverPid: process.pid,
        serverDungeonPresent: !!dungeon,
        serverGeometryStamp: dungeon?._geometryStamp || null,
        matchingGeometryStamp: !!dungeon && dungeon._geometryStamp === report.geometryStamp,
        serverToBrowserMismatches: mismatches
    };
    comparison.serverToCombatMapMismatches = (report.combatMap?.samples || []).filter(sample => {
        const cell = dungeon?.cells?.[sample.key];
        return !cell || sample.tile !== cell.tile ||
            sample.floor !== (Number.isFinite(cell.floorHeight) ? cell.floorHeight : 0) ||
            sample.ceil !== (Number.isFinite(cell.ceilHeight) ? cell.ceilHeight : (cell.floorHeight || 0) + 2);
    }).map(sample => ({ key: sample.key, combatMap: sample, server: dungeon?.cells?.[sample.key] || null }));
    console.info('[DungeonRendering]', JSON.stringify({ ...report, comparison }));
    res.json({ recorded: true, comparison });
});

app.post('/debug/dialogue-subtitles', (req, res) => {
  const { runId, reports } = req.body || {};
  const stages = ['queued', 'displayed', 'skipped', 'deferred', 'duplicate', 'dismissed'];
  if (typeof runId !== 'string' || !Array.isArray(reports) || reports.length > 32 || reports.some(row =>
      !row || row.runId !== runId || typeof row.geoKey !== 'string' || !/^-?\d+,-?\d+,-?\d+$/.test(row.geoKey) || !stages.includes(row.stage) ||
      typeof row.speaker !== 'string' || row.speaker.length > 70 || typeof row.line !== 'string' || row.line.length > (row.stage === 'displayed' ? 24000 : 320) ||
      !Number.isFinite(row.at) || !Number.isInteger(row.queueDepth) || row.queueDepth < 0 || row.queueDepth > 32 ||
      ['reason', 'source', 'kind'].some(key => row[key] !== undefined && (typeof row[key] !== 'string' || row[key].length > 80)) ||
      ['distance', 'range'].some(key => row[key] !== undefined && row[key] !== null && (!Number.isFinite(row[key]) || row[key] < 0)) ||
      ['part', 'parts'].some(key => row[key] !== undefined && (!Number.isInteger(row[key]) || row[key] < 1 || row[key] > 1000)))) {
    return res.status(400).json({ error: 'Invalid subtitle diagnostic report.' });
  }
  if (runId !== sharedState.getDungeonRunId()) return res.status(409).json({ error: 'That game is no longer active.' });
  for (const row of reports) console.info('[DialogueSubtitle]', JSON.stringify({
    runId, geoKey: row.geoKey, stage: row.stage, speaker: row.speaker, line: row.line, source: row.source, kind: row.kind,
    at: row.at, queueDepth: row.queueDepth, reason: row.reason, distance: row.distance, range: row.range,
    lineOfSight: row.lineOfSight === true, canHear: row.canHear === true, part: row.part, parts: row.parts,
    mood: SidVoice.moodOf(row.speaker, row.line), cadence: SidVoice.cadenceOf(row.line), confidence: SidVoice.confidenceOf(row.speaker, row.line)
  }));
  const memoryRoom = typeof CampaignMemory !== 'undefined' ? CampaignMemory.cast(sharedState).geo : null;
  for (const row of reports) if (row.stage === 'displayed' && row.geoKey === memoryRoom) CampaignMemory.rememberDialogue(sharedState, null,
    [{ speaker: row.speaker, line: row.line }], 'subtitle-displayed', broadcast);
  res.json({ recorded: reports.length });
});

app.post('/campaign-memory/recall', (req, res) => {
  if (req.body?.runId !== sharedState.getDungeonRunId()) return res.status(409).json({ error: 'That campaign is no longer active.' });
  try {
    const records = CampaignMemory.restore(sharedState, req.body.records, req.body.runId);
    res.json({ indexed: records.length });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

// Procedural character sprites: structured visual trait specs (one cheap LLM call per new character, cached by name).
// Body: { sheets: [{name, sex, race, class, level, equipped, isMonster}], wait?: boolean, reroll?: boolean }
// Returns cached entries immediately (source 'llm' | 'pending'); finished specs are also broadcast as
// { type: 'characterTraits', traits: { [name]: entry } } over /combat-updates2.
app.post('/character-traits', async (req, res) => {
  try {
    const sheets = req.body && Array.isArray(req.body.sheets) ? req.body.sheets : [];
    const traits = await characterTraits.requestTraitSpecs(sheets, { broadcast, wait: !!(req.body && req.body.wait), reroll: !!(req.body && req.body.reroll) });
    res.json({ traits });
  } catch (err) {
    console.error('[traits] endpoint error:', err && err.message);
    res.status(500).json({ error: 'trait generation failed', traits: {} });
  }
});
app.get('/character-traits', (req, res) => {
  const names = String(req.query.names || '').split('|').map((n) => n.trim()).filter(Boolean);
  res.json({ traits: characterTraits.getCachedTraitSpecs(names) });
});

// Get current combat mode
app.get('/get-combat-mode2', (req, res) => {
    const mode = sharedState.getCombatMode();
    res.json({ mode });
});

// Set combat mode
app.post('/set-combat-mode2', (req, res) => {
    const { mode } = req.body;
    if (['Combat Map-Based', 'Interactive Map-Based', 'No Combat Map'].includes(mode)) {
        sharedState.setCombatMode(mode);
        console.log(`Combat mode set to ${mode} via /set-combat-mode`);
        res.json({ status: 'success' });
    } else {
        res.status(400).json({ error: 'Invalid combat mode' });
    }
});

// Get dungeon testing mode
app.get('/get-dungeon-testing-mode', (req, res) => {
    const enabled = sharedState.getDungeonTestingMode();
    res.json({ enabled });
});

// Set dungeon testing mode
app.post('/set-dungeon-testing-mode', (req, res) => {
    const { enabled } = req.body;
    sharedState.setDungeonTestingMode(!!enabled);
    console.log(`Dungeon testing mode set to ${!!enabled} via /set-dungeon-testing-mode`);
    res.json({ status: 'success', enabled: !!enabled });
});

app.post('/submit-target2', (req, res) => {
    if (sharedState.getGamePaused()) return res.status(409).json({ error: 'Resume the game before choosing a target.' });
    const { combatant, target, cancelled, actionId, turnId, action, itemId, spellId, kind, item } = req.body;
    if (!actionDice.active || actionDice.active.kind !== 'combat' || actionDice.active.id !== actionId) {
      return res.status(409).json({ error: 'That combat turn is no longer active.' });
    }
    const turn = actionDice.active.turn;
    const validAction = turn && (action === 'attack' && !cancelled && turn.targets.includes(target) ||
      action === 'retreat' && turn.allowRetreat && !cancelled ||
      action === 'cast' && !cancelled && turn.spells?.some(s => s.itemId === itemId && s.spellId === spellId && s.target === target) ||
      action === 'care' && !cancelled && turn.care?.some(c => c.kind === kind && c.item === item && c.target === target) ||
      action === 'hold' && cancelled === true);
    if (!turn || turn.turnId !== turnId || turn.combatant !== combatant || !validAction) {
      return res.status(409).json({ error: 'That player turn or target is no longer available.' });
    }
    if (turn.movement?.busy || turn.tactical && action === 'attack' && !turn.attackTargets.includes(target))
      return res.status(409).json({ error: 'Movement is resolving or that enemy is out of range or sight.' });
    console.log(`Received target selection: ${combatant} targets ${target}`);
    sharedState.emitter.emit(`target_response_${combatant}`, { target, cancelled: cancelled === true, actionId, turnId, action, itemId, spellId, kind, item });
    res.json({ status: 'success' });
});

app.post('/combat/move', async (req, res) => {
  if (sharedState.getGamePaused() || !actionDice.moveCombatant) return res.status(409).json({ error: 'No player movement is available.' });
  try { res.json(await actionDice.moveCombatant(req.body || {})); }
  catch (error) { res.status(409).json({ error: error.message }); }
});

const tasks = new Map();  // { taskId: { status: 'processing', result: null } }
let inputTaskInFlight = false;

// Isolated exhibits use the production builder/renderer but never touch campaign state.
const environmentLabCache = new Map();
app.get('/environment-lab/:kind', (req, res) => {
  const kind = req.params.kind;
  if (!Object.hasOwn(environmentLabKinds, kind)) return res.status(404).json({ error: 'Unknown exhibit' });
  const seed = req.query?.seed;
  if (seed !== undefined && (typeof seed !== 'string' || !seed.length || seed.length > 160)) return res.status(400).json({ error: 'Lab seed must contain 1-160 characters.' });
  try {
    const cacheKey = JSON.stringify([kind, seed ?? null]);
    if (!environmentLabCache.has(cacheKey)) environmentLabCache.set(cacheKey, buildEnvironmentLab(kind, { seed }));
    const dungeon = environmentLabCache.get(cacheKey);
    environmentLabCache.delete(cacheKey); environmentLabCache.set(cacheKey, dungeon);
    while (environmentLabCache.size > 12) environmentLabCache.delete(environmentLabCache.keys().next().value);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ dungeon });
  } catch (error) {
    console.error('[EnvironmentLab]', error);
    res.status(500).json({ error: 'Exhibit construction failed; see server log.' });
  }
});

app.post('/living-environment/interact', (req, res) => {
  res.status(410).json({ error: 'The old seal minigame has been retired. Operate room mechanisms through the normal text-command pipeline.' });
});

app.post('/action-dice/roll', (req, res) => {
  try {
    const { id, actionId, geoKey } = req.body || {};
    const result = actionDice.submit(id, actionId, geoKey);
    res.json({ result, state: actionDice.snapshot() });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});
const NPC_AUTONOMY_TICK_MS = Inhabitants.DIALOGUE_REFRESH_MS;
let npcAutonomyTickInFlight = false;
let lastAutonomyAt = 0;

app.post('/game/pause', (req, res) => {
  if (req.body?.runId !== sharedState.getDungeonRunId()) return res.status(409).json({ error: 'That game is no longer active.' });
  if (typeof CombatLife !== 'undefined' && CombatLife.status(sharedState).gameOver) return res.status(409).json({ error: 'This adventure has ended. Start a new game.' });
  if (typeof req.body.paused !== 'boolean') return res.status(400).json({ error: 'A pause setting is required.' });
  sharedState.setGamePaused(req.body.paused);
  actionDice.setPaused(req.body.paused);
  const event = { type: 'game_pause', paused: req.body.paused, runId: sharedState.getDungeonRunId() };
  broadcast(event); res.json(event);
});

function prepareQuestScene(req) {
  if (typeof CombatLife !== 'undefined' && CombatLife.status(sharedState).gameOver) return { error: 'This adventure has ended. Start a new game.', status: 409 };
  if (inputTaskInFlight || actionDice.active || sharedState.getGamePaused() || npcAutonomyTickInFlight)
    return {error:'The current action is resolving or the game is paused.',status:409};
  return populationService.visit(req.body || {});
}
app.post('/journal/view', (req, res) => {
  if (req.body?.runId !== sharedState.getDungeonRunId()) return res.status(409).json({ error: 'That journal belongs to another game.' });
  try { res.json(AdventureJournal.project(sharedState)); }
  catch (error) { console.warn('[AdventureJournal]', error.message); res.status(503).json({ error: 'The journal could not be read.' }); }
});
app.post('/spellbook/view', (req, res) => {
  if (req.body?.runId !== sharedState.getDungeonRunId()) return res.status(409).json({ error: 'That spellbook belongs to another game.' });
  try { res.json(PartySpellbook.project(sharedState)); }
  catch (error) { console.warn('[PartySpellbook]', error.message); res.status(503).json({ error: 'The spellbook could not be read.' }); }
});
app.post('/quest-scenes/view', (req,res) => {
  const ready=prepareQuestScene(req); if(ready.error)return res.status(ready.status).json({error:ready.error});
  const result=QuestScenes.view(sharedState,req.body.actor);
  if(result.error)return res.status(409).json(result);
  res.json(result);
});
app.post('/quest-scenes/choose', (req,res) => {
  const ready=prepareQuestScene(req); if(ready.error)return res.status(ready.status).json({error:ready.error});
  inputTaskInFlight=true;
  try {
    const result=QuestScenes.choose(sharedState,populationService,req.body);
    if(result.error)return res.status(result.status||409).json({error:result.error});
    const coords=sharedState.getLastCoords(),geoKey=`${coords.x},${coords.y},${coords.z}`;
    const event={...result,type:'quest_scene_result',eventId:require('node:crypto').randomUUID(),runId:sharedState.getDungeonRunId(),geoKey,
      updatedGameConsole:sharedState.getUpdatedGameConsole(),roomNameDatabaseString:sharedState.getRoomNameDatabase(),
      combatCharactersString:sharedState.getCombatCharactersString(),population:sharedState.getRoomPopulation(geoKey)};
    if(!result.command)broadcast(event);
    console.info('[QuestScene]',JSON.stringify({storyId:req.body.storyId,stageId:req.body.stageId,optionId:req.body.optionId,geoKey}));
    res.json(event);
  } catch(error) {console.warn('[QuestScene]',error.message);res.status(503).json({error:'The scene could not resolve.'});}
  finally {inputTaskInFlight=false;}
});

function economyStateEvent(geoKey, update) {
  return { type: 'economy_result', passive: true, eventId: require('node:crypto').randomUUID(), runId: sharedState.getDungeonRunId(), geoKey,
    content: update?.notices?.join('\n') || 'Party inventory and currency synchronized.',
    updatedGameConsole: sharedState.getUpdatedGameConsole(), roomNameDatabaseString: sharedState.getRoomNameDatabase(),
    combatCharactersString: sharedState.getCombatCharactersString(), population: sharedState.getRoomPopulation(geoKey),
    sceneObjects: sharedState.getRoomDungeonForSimulation(sharedState.getLastCoords())?.sceneObjects };
}
function spellStateEvent(geoKey, result = {}, passive = false) {
  return { ...result, type: 'spell_result', passive, eventId: require('node:crypto').randomUUID(), runId: sharedState.getDungeonRunId(), geoKey,
    updatedGameConsole: sharedState.getUpdatedGameConsole(), roomNameDatabaseString: sharedState.getRoomNameDatabase(),
    combatCharactersString: sharedState.getCombatCharactersString(), population: sharedState.getRoomPopulation(geoKey),
    sceneObjects: sharedState.getRoomDungeonForSimulation(sharedState.getLastCoords())?.sceneObjects };
}
app.post('/spells/view', (req, res) => {
  const ready = prepareQuestScene(req); if (ready.error) return res.status(ready.status).json({ error: ready.error });
  try {
    const data = SpellSystem.view(sharedState, req.body.caster), text = sharedState.getUpdatedGameConsole();
    const targets = SpellSystem.allActors(text).filter(a => Inhabitants.allegiance(a) === 'Hostile' && a.hp > 0).map(a => a.name);
    for (const caster of data.casters) caster.choices = SpellSystem.choices(sharedState, caster.name, targets);
    const names = SpellSystem.field(text, 'Inventory').split(/,\s*/);
    data.scrolls = require('./assets/inventoryUi').parseProperties(SpellSystem.field(text, 'Inventory Properties')).filter(p => names.includes(p.name) && SpellSystem.Rules.templates[p.spell_scroll] && p.magic > 0);
    res.json({ ...data, spellResult: spellStateEvent(req.body.geoKey, { content: '' }, true) });
  }
  catch (error) { console.warn('[Spells]', error.message); res.status(503).json({ error: 'Spell records could not be read.' }); }
});
app.post('/spells/prepare', (req, res) => {
  const ready = prepareQuestScene(req); if (ready.error) return res.status(ready.status).json({ error: ready.error });
  inputTaskInFlight = true;
  try {
    if (!/^[\w:-]{8,100}$/.test(req.body.nonce || '')) return res.status(400).json({ error: 'A spell preparation transaction ID is required.' });
    const result = ClassMagic.action(sharedState, req.body); if (result.error) return res.status(409).json(result);
    const event = spellStateEvent(req.body.geoKey, result); broadcast(event); res.json(event);
  } catch (error) { console.warn('[Spells]', error.message); res.status(503).json({ error: 'Spell preparation could not resolve.' }); }
  finally { inputTaskInFlight = false; }
});
app.post('/spells/cast', async (req, res) => {
  const ready = prepareQuestScene(req); if (ready.error) return res.status(ready.status).json({ error: ready.error });
  inputTaskInFlight = true;
  try {
    SpellSystem.synchronize(sharedState);
    const previous = JSON.parse(sharedState.getRoomNameDatabase())['0,0,0'].spellSystem.receipts.find(r => r.nonce === req.body.nonce);
    if (previous) {
      if (JSON.stringify(previous.request) !== JSON.stringify([req.body.runId, req.body.geoKey, req.body.caster, req.body.itemId, req.body.spellId, req.body.target])) return res.status(409).json({ error: 'That spell transaction was already used.' });
      return res.json(spellStateEvent(req.body.geoKey, { ...previous.result, duplicate: true }));
    }
    const c = SpellSystem.context(sharedState, req.body, { combat: true });
    if (req.body.revision !== c.pool.revision || !/^[\w:-]{8,100}$/.test(req.body.nonce || '')) return res.status(409).json({ error: 'That spell selection is stale.' });
    let result;
    if (!['heal', 'ward'].includes(c.spell.effect)) {
      SpellSystem.queue(sharedState, req.body);
      result = await retortWithUserInput('attack ' + c.target.name, broadcast, sharedState.getCombatMode(), { spellOpening: true });
    } else {
      result = SpellSystem.cast(sharedState, populationService, req.body);
      if (result.error) return res.status(409).json(result);
      if (!result.duplicate) SpellSystem.advance(sharedState);
    }
    const event = spellStateEvent(req.body.geoKey, result); broadcast(event); res.json(event);
  } catch (error) { console.warn('[Spells]', error.message); res.status(409).json({ error: error.message }); }
  finally { SpellSystem.clearOpening(sharedState); inputTaskInFlight = false; }
});
app.post('/combat/care/view', (req, res) => {
  const ready = prepareQuestScene(req); if (ready.error) return res.status(ready.status).json({ error: ready.error });
  const care = SpellSystem.party(sharedState.getUpdatedGameConsole()).flatMap(a => CombatLife.careChoices(sharedState, a.name).map(c => ({ ...c, actor: a.name })));
  res.json({ care });
});
app.post('/secret-doors/action', (req, res) => {
  const ready = prepareQuestScene(req); if (ready.error) return res.status(ready.status).json({ error: ready.error });
  inputTaskInFlight = true;
  try {
    const result = SecretDoors.act(sharedState, req.body);
    if (result.error) return res.status(409).json(result);
    if (!result.duplicate) {
      const dungeon = finalizeRoomDungeon(req.body.geoKey, result.dungeon, result.dungeon.customTiles);
      sharedState.setRoomDungeon(sharedState.getLastCoords(), dungeon, dungeon.customTiles); SecretDoors.persist(sharedState, dungeon);
      broadcast({ type: 'dungeonCellUpdate', geoKey: req.body.geoKey, previousStamp: result.previousStamp,
        geometryStamp: dungeon._geometryStamp, cells: result.cells, secretDoors: dungeon.secretDoors });
      if (req.body.kind === 'search') SpellSystem.advance(sharedState);
    }
    const { dungeon, cells, previousStamp, ...message } = result;
    const event = spellStateEvent(req.body.geoKey, message); broadcast(event); res.json(event);
  } finally { inputTaskInFlight = false; }
});
app.post('/combat/wait', (req, res) => {
  const ready = prepareQuestScene(req); if (ready.error) return res.status(ready.status).json({ error: ready.error });
  const result = CombatLife.wait(sharedState, req.body); if (result.error) return res.status(409).json(result);
  if (!result.duplicate) SpellSystem.advance(sharedState);
  const event = spellStateEvent(req.body.geoKey, result); broadcast(event); res.json(event);
});
app.post('/combat/care', (req, res) => {
  const ready = prepareQuestScene(req); if (ready.error) return res.status(ready.status).json({ error: ready.error });
  inputTaskInFlight = true;
  try {
    const result = CombatLife.care(sharedState, req.body);
    if (result.error) return res.status(409).json(result);
    if (!result.duplicate) SpellSystem.advance(sharedState);
    const event = spellStateEvent(req.body.geoKey, result); broadcast(event); res.json(event);
  } finally { inputTaskInFlight = false; }
});
app.post('/economy/view', (req, res) => {
  const ready = prepareQuestScene(req); if (ready.error) return res.status(ready.status).json({ error: ready.error });
  try {
    const update = Economy.refresh(sharedState);
    const book = Economy.project(sharedState);
    const result = req.body.actor ? Economy.view(sharedState, req.body.actor) : { silver: book.silver, revision: book.revision };
    if (result.error) return res.status(409).json(result);
    res.json({ ...result, ...(update.changed ? { economyResult: economyStateEvent(req.body.geoKey, update) } : {}) });
  } catch (error) { console.warn('[Economy]', error.message); res.status(503).json({ error: 'The economy records could not be read.' }); }
});
app.post('/economy/action', (req, res) => {
  const ready = prepareQuestScene(req); if (ready.error) return res.status(ready.status).json({ error: ready.error });
  inputTaskInFlight = true;
  try {
    const result = Economy.action(sharedState, populationService, req.body);
    if (result.error) {
      if (req.body.kind === 'take') console.warn('[PickupRejected]', JSON.stringify({ geoKey: req.body.geoKey,
        item: req.body.item, player: req.body.player, reason: result.error }));
      return res.status(409).json(result);
    }
    if (['equip', 'unequip'].includes(req.body.kind) && typeof SpellSystem !== 'undefined') SpellSystem.synchronize(sharedState);
    const event = { ...result, type: 'economy_result', eventId: require('node:crypto').randomUUID(), runId: sharedState.getDungeonRunId(),
      geoKey: req.body.geoKey, updatedGameConsole: sharedState.getUpdatedGameConsole(), roomNameDatabaseString: sharedState.getRoomNameDatabase(),
      combatCharactersString: sharedState.getCombatCharactersString(), population: sharedState.getRoomPopulation(req.body.geoKey) };
    broadcast(event); res.json(event);
  } catch (error) { console.warn('[Economy]', error.message); res.status(503).json({ error: 'The transaction could not resolve.' }); }
  finally { inputTaskInFlight = false; }
});

app.post('/room-population/visit', async (req, res) => {
  if (inputTaskInFlight || actionDice.active || npcAutonomyTickInFlight) return res.status(409).json({ error: 'The current action is resolving.' });
  let result = populationService.visit({ ...req.body, deferIntroductions: true });
  if (result.error) return res.status(result.status).json({ error: result.error });
  if (result.encounters?.length) {
    inputTaskInFlight = true;
    try { result = await narrateEncounter({ state: sharedState, service: populationService, visit: result,
      isCurrent: () => !actionDice.active }); }
    catch (error) {
      console.warn('[EncounterNarration]', error.message);
      return res.status(503).json({ error: 'Encounter narration failed; its introduction remains available to retry.' });
    } finally { inputTaskInFlight = false; }
  }
  if (result.dialogue.length) console.info('[RoomPopulation]', JSON.stringify({ phase: 'speech', geoKey: req.body.geoKey,
    speakers: result.dialogue.map(row => row.speaker), player: req.body.player, speech: result.speech, nearby: true }));
  if (result.story) {
    broadcast({ type: 'encounter_story', ...result.story });
    broadcast({ type: 'campaign_memory', runId: sharedState.getDungeonRunId(), records: CampaignMemory.exportRecords(sharedState).slice(-32) });
  } else if (result.dialogue.length) broadcast({ type: 'character_dialogue', dialogue: result.dialogue,
    geoKey: req.body.geoKey, runId: sharedState.getDungeonRunId() });
  res.json(result);
});

app.post('/room-population/engage', async (req, res) => {
  if (inputTaskInFlight || actionDice.active || sharedState.getGamePaused() || sharedState.getDungeonTestingMode()) return res.status(409).json({ error: 'The simulation is busy or paused.' });
  const visit = populationService.visit(req.body || {});
  if (visit.error) return res.status(visit.status).json({ error: visit.error });
  if (visit.dialogue.length) broadcast({type:'character_dialogue',dialogue:visit.dialogue,geoKey:req.body.geoKey,runId:sharedState.getDungeonRunId()});
  const record = visit.population.actors[req.body.target], coords = sharedState.getLastCoords();
  const dungeon = sharedState.getRoomDungeonForSimulation(coords);
  const livingPc=JSON.parse(sharedState.getCombatCharactersString() || '[]').some(a=>a.type==='pc'&&(a.hp ?? 1)>0);
  if (!livingPc || visit.population.starting && !record?.pursuit?.arrivedThrough || !record?.position || record.status !== 'present' || record.allegiance !== 'Hostile' ||
      Math.hypot(record.position.x + 0.5 - req.body.player.x, record.position.y + 0.5 - req.body.player.y) > 3.5 ||
      !Inhabitants.lineClear(dungeon, req.body.player, { x: record.position.x + 0.5, y: record.position.y + 0.5 })) return res.status(409).json({ error: 'There is no nearby hostile encounter.' });
  inputTaskInFlight = true;
  const runId = sharedState.getDungeonRunId(), eventId = require('node:crypto').randomUUID();
  try {
    const result = await retortWithUserInput('', broadcast, sharedState.getCombatMode(), { realtimeEncounter: record.name });
    const event = { type: 'realtime_combat_result', runId, geoKey: req.body.geoKey, eventId,
      ...result, updatedGameConsole: sharedState.getUpdatedGameConsole(), population: sharedState.getRoomPopulation(req.body.geoKey) };
    broadcast(event); res.json(event);
  } catch (error) { console.warn('[EncounterCombat]', error.message); res.status(503).json({ error: 'The encounter could not resolve.' }); }
  finally { actionDice.end(); inputTaskInFlight = false; }
});

app.post('/room-population/autonomy', async (req, res) => {
  if (req.body?.runId !== sharedState.getDungeonRunId()) return res.status(409).json({ error: 'That game is no longer active.' });
  const coords = sharedState.getLastCoords(), geoKey = `${coords.x},${coords.y},${coords.z}`;
  if (req.body.geoKey !== geoKey) return res.status(409).json({ error: 'That room is no longer active.' });
  if (sharedState.getGamePaused() || inputTaskInFlight || actionDice.active || npcAutonomyTickInFlight) return res.status(409).json({ error: 'The simulation is busy or paused.' });
  const live=req.body.liveWorldState,dungeon=sharedState.getRoomDungeonForSimulation(coords);
  if(Inhabitants.roomKey(live?.roomKey)!==geoKey || !Inhabitants.pointWalkable(dungeon,live?.player?.x,live?.player?.y))
    return res.status(400).json({error:'A valid current-room observer is required.'});
  if (Date.now() - lastAutonomyAt < NPC_AUTONOMY_TICK_MS) return res.json({ dialogue: [], summary: '' });
  npcAutonomyTickInFlight = true; lastAutonomyAt = Date.now();
  const runId = sharedState.getDungeonRunId();
  try {
    sharedState.setLiveWorldState(req.body.liveWorldState);
    const result = await runNpcAutonomyTick(() => !inputTaskInFlight && !actionDice.active);
    if (sharedState.getGamePaused() || runId !== sharedState.getDungeonRunId() ||
        geoKey !== `${sharedState.getLastCoords().x},${sharedState.getLastCoords().y},${sharedState.getLastCoords().z}` || inputTaskInFlight || actionDice.active) return res.json({ dialogue: [], summary: '' });
    if (result.population) broadcast({type:'room_population',population:result.population,runId});
    broadcast({ type: 'character_dialogue', dialogue: result.dialogue, summary: result.summary, geoKey, runId, eventId: String(result.ts) });
    res.json(result);
  } catch (error) { console.warn('[RoomAutonomy]', error.message); res.status(503).json({ error: 'The inhabitants are quiet for now.' }); }
  finally { npcAutonomyTickInFlight = false; }
});

app.use('/processInput7', (req, res, next) => DialogueTurns.run(req.body?.userInput, next));
app.post('/processInput7', async (req, res) => {
  if (typeof CombatLife !== 'undefined' && CombatLife.status(sharedState).gameOver) return res.status(409).json({ error: 'This adventure has ended. Start a new game.' });
  if (sharedState.getGamePaused()) return res.status(409).json({ error: 'Resume the game before issuing a command.' });
  if (inputTaskInFlight) return res.status(409).json({ error: 'The previous action is still resolving.' });
  // Pickup is mechanical and view-validated by /economy/action, never adjudicated by narration.
  if (/^\s*(?:take|pick\s+up|collect)\b/i.test(req.body?.userInput || ''))
    return res.status(409).json({ error: 'Take only objects currently shown in Objects in Room. Refresh the page to use the current pickup controls.' });
  if (/^\s*(?:cast|scribe|prepare\s+spells)\b/i.test(req.body?.userInput || ''))
    return res.status(409).json({ error: 'Use Spells or the scroll Scribe option; spell effects are engine-verified, not narrated.' });
  // If we're still in the character generation / review phase, don't let the main Retort flow
  // (which triggers full dungeon creation) run yet. The client should be showing the Save/Reroll menu.
  if (sharedState.isCharacterGenerationInProgress && sharedState.isCharacterGenerationInProgress()) {
    console.log('[Server] Blocked /processInput7 — still in character generation phase.');
    // We can still return a polite message so the client knows what's happening.
    const taskId = Date.now().toString();
    tasks.set(taskId, {
      status: 'complete',
      result: {
        response: "Please finish reviewing and saving your starting character before the game begins.",
        characterGenerationPhase: true
      }
    });
    return res.status(202).json({ taskId });
  }

  const taskId = Date.now().toString();
  tasks.set(taskId, { status: 'processing', result: null });
  inputTaskInFlight = true;
  const puzzleDefinition = sharedState.getRoomDungeon(sharedState.getLastCoords())?.physicalPuzzle?.definition;
  const physicalPuzzleCommand = puzzleDefinition && PhysicalPuzzles.intent(req.body.userInput, puzzleDefinition);
  let resolvePuzzleNarration;
  const puzzleNeedsNarration = new Promise(resolve => { resolvePuzzleNarration = resolve; });

  // Background process
  const task = (async () => {
    try {
      if (req.body && req.body.liveWorldState !== undefined) {
        sharedState.setLiveWorldState(req.body.liveWorldState);
      }
      const combatMode = sharedState.getCombatMode();
      console.log(`Starting retortWithUserInput for taskId ${taskId}`);
      const result = await retortWithUserInput(req.body.userInput, broadcast, combatMode, physicalPuzzleCommand ? {
        onPhysicalPuzzlePrepared: result => resolvePuzzleNarration(!result || result.completed)
      } : {});
      console.log(`retortWithUserInput completed for taskId ${taskId}:`, {
        responseChars: result.content?.length || 0, dialogue: (result.dialogue || []).map(row => row.speaker), actionOnly: !!result.actionOnly });
      Economy.refresh(sharedState);
      let updatedGameConsole = sharedState.getUpdatedGameConsole();
        if (!updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/)) {
            console.log('No coordinates in updatedGameConsole, adding default');
            updatedGameConsole = `Coordinates: X: 0, Y: 0, Z: 0\n${updatedGameConsole}`;
            sharedState.setUpdatedGameConsole(updatedGameConsole);
        }
      const combatCharactersString = sharedState.getCombatCharactersString();
      CampaignMemory.rememberRoomHistory(sharedState, req.body.userInput, result.content, updatedGameConsole, broadcast);
      if (!result.actionOnly) characterTraits.ensureTraitSpecsForConsole(updatedGameConsole, broadcast); // new actors only on narrative turns
      const roomNameDatabaseString = sharedState.getRoomNameDatabase(); // Add this
      const currentQuest = sharedState.getCurrentQuest(); // New: Include current quest
      const finalResult = { 
        response: GameLogContent.withoutLootLists(result.content),
        updatedGameConsole, 
        combatCharactersString,
        roomNameDatabaseString, // Include in response
        currentQuest, // New
        imageUrl: result.imageUrl,
        musicArrangement: result.musicArrangement || null,
        npcDirectives: Array.isArray(result.npcDirectives) ? result.npcDirectives : [],
        population: result.population || null,
        dialogue: SidVoice.prefetch(result.dialogue || []),
        combatRoundOnly: !!(result.combatRoundOnly || result.actionOnly)
      };
      tasks.set(taskId, { 
        status: 'complete', 
        result: finalResult 
      });
      console.log(`Task ${taskId} completed:`, { responseChars: finalResult.response?.length || 0,
        consoleChars: updatedGameConsole.length, rosterChars: combatCharactersString?.length || 0, roomDatabaseChars: roomNameDatabaseString?.length || 0 });
    } catch (err) {
      console.error('Background task error for taskId ' + taskId + ':', err);
      tasks.set(taskId, { status: 'error', result: err.message });
    } finally {
      actionDice.end();
      inputTaskInFlight = false;
      resolvePuzzleNarration(false);
    }
  })();

  // Reuse the client's existing inline-result handler only for recognized physical controls.
  // Room generation and all other commands retain the long-running background/polling path.
  if (physicalPuzzleCommand && !await puzzleNeedsNarration) {
    await task;
    const completed = tasks.get(taskId);
    if (completed.status === 'complete') return res.json({ completedStartResult: completed.result });
  }
  res.status(202).json({ taskId }); // Immediate return
});

// New endpoint: Client calls this after the user clicks "Save" on the character sprite review menu.
// This tells the Retort session "the player has finalized their starting character (with sprite) — now proceed with dungeon generation".
app.post('/startGameWithCharacter', async (req, res) => {
  if (inputTaskInFlight) return res.status(409).json({ error: 'Finish the pending action before starting another game.' });
  if (!req.body?.character || typeof req.body.character !== 'object') return res.status(400).json({ error: 'Missing starting character.' });
  const taskId = Date.now().toString();
  tasks.set(taskId, { status: 'processing', result: null });
  inputTaskInFlight = true;

  (async () => {
    try {
      const combatMode = sharedState.getCombatMode();
      const characterData = req.body.character; // The finalized PC with sprite.dataUrl etc.
      const partyNpcData = Array.isArray(req.body.npcs) ? req.body.npcs : [];
      const incomingCombatCharacters = Array.isArray(req.body.combatCharacters) ? req.body.combatCharacters : null;

      console.log(`[Server] Starting game with finalized character:`, characterData?.Name || characterData?.name);
      const runId = sharedState.beginDungeonRun();
      actionDice.setPaused(false);
      roomDatabaseReceiver.reset();
      broadcast({ type: 'dungeonRun', runId });

      // Store the finalized character (with sprite) so the Retort flow and client can access it
      sharedState.setCurrentPC(characterData);

      // CRITICAL: clear the character generation phase guard so /processInput7 and normal flow unblock
      // (prevents "Blocked /processInput7 — still in character generation phase" after Save).
      sharedState.setCharacterGenerationInProgress(false);
      sharedState.setPendingCharacterForReview(null);

      // Seed combatCharactersString (and thus per-room party/combat slots) from the saved PC right now.
      // Combat already supports sprite.dataUrl billboards (25px) + add/remove party functions; this
      // puts the starting character into the same slots the later dungeon/combat code expects instead of [].
      const pcForCombat = {
        name: characterData.Name || characterData.name || 'Player',
        type: 'pc',
        sprite: characterData.sprite || null
      };
      const seededCombatRoster = incomingCombatCharacters && incomingCombatCharacters.length
        ? incomingCombatCharacters
        : [
            pcForCombat,
            ...partyNpcData.map(npc => ({
              name: npc.Name || npc.name || 'Party NPC',
              type: 'npc',
              sprite: npc.sprite || null
            }))
          ];
      sharedState.setCombatCharactersString(JSON.stringify(seededCombatRoster));
      console.log('[Server] Seeded combatCharactersString from saved starting character (prevents empty [] after Save)');

      // Broadcast that the character has been finalized (client can react if needed)
      broadcast({ type: 'characterFinalized', character: characterData });

      // Format the PC stats exactly like the original client-side createMortacia / createSuzerain flow
      // so they appear in the "game console" (above the prompt) using the original methodology.
      // Seed the updatedGameConsole with the PC stats so the main console display (and the LLM prompt)
      // includes them above the prompt, exactly as the last-known-good 1/2 path in chatbotprocessinput did.
      const initialWorld = buildInitialWorldConsole(req.body.initialState);
      sharedState.setRoomNameDatabase(initialWorld.roomNameDatabaseString);
      sharedState.setPersonalNarrative('');
      sharedState.setUpdatedGameConsole(buildInitialGameConsole(initialWorld.console, characterData, partyNpcData));
      Economy.start(sharedState, characterData, partyNpcData);
      const profiles = typeof generatePartyCharacterProfiles === 'function' ? await generatePartyCharacterProfiles([characterData, ...partyNpcData], runId) : [];
      if (profiles.length) CampaignMemory.rememberProfiles(sharedState, profiles, broadcast);
      if (profiles.length) {
        const profileRoster = JSON.parse(sharedState.getCombatCharactersString() || '[]');
        for (const actor of profileRoster) actor.originProfile = profiles.find(profile => profile.name === actor.name);
        sharedState.setCombatCharactersString(JSON.stringify(profileRoster));
      }

      // We send a special internal command to retortWithUserInput so it knows to skip the normal start menu
      // and use the provided character directly, then begin dungeon generation.
      const specialInput = `__START_WITH_CHARACTER__${JSON.stringify(characterData)}`;

      const result = await retortWithUserInput(specialInput, broadcast, combatMode);
      CampaignMemory.rememberRoomHistory(sharedState, '', result.content, sharedState.getUpdatedGameConsole(), broadcast);
      Economy.refresh(sharedState);

      let updatedGameConsole = sharedState.getUpdatedGameConsole();
      if (!updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/)) {
        updatedGameConsole = `Coordinates: X: 0, Y: 0, Z: 0\n${updatedGameConsole}`;
        sharedState.setUpdatedGameConsole(updatedGameConsole);
      }

      const combatCharactersString = sharedState.getCombatCharactersString();
      const roomNameDatabaseString = sharedState.getRoomNameDatabase();
      const currentQuest = sharedState.getCurrentQuest();

      const finalResult = {
        response: (result && result.content) || 'The game begins in the Ruined Temple Entrance...',
        updatedGameConsole,
        combatCharactersString,
        roomNameDatabaseString,
        currentQuest,
        imageUrl: (result && result.imageUrl) || null,
        musicArrangement: (result && result.musicArrangement) || null,
        population: result.population || null,
        dialogue: SidVoice.prefetch(result.dialogue || []),
        characterConfirmed: true
      };

      tasks.set(taskId, { status: 'complete', result: finalResult });
    } catch (err) {
      console.error('startGameWithCharacter error:', err);
      tasks.set(taskId, { status: 'error', result: err.message });
    } finally {
      actionDice.end();
      inputTaskInFlight = false;
    }
  })();

  res.status(202).json({ taskId });
});

// Dedicated endpoint to begin the isolated character generation phase.
// This triggers a *focused* Retort-assisted character + sprite generation
// BEFORE the main dungeon creation logic ever runs.
app.post('/beginCharacterGeneration', async (req, res) => {
  if (inputTaskInFlight) return res.status(409).json({ error: 'Finish the pending action before creating another character.' });
  const taskId = Date.now().toString();
  tasks.set(taskId, { status: 'processing', result: null });

  (async () => {
    try {
      const choice = req.body.choice; // "1", "2", or "3"
      console.log(`[Server] Beginning isolated character generation phase for choice: ${choice}`);

      sharedState.setCharacterGenerationInProgress(true);

      // === 1. Roll the base character stats first ===
      // Prefer the exact character rolled by client createMortacia/createSuzerain (verbatim from game.js)
      // so that HP roll, Attack etc match what was shown immediately on 1/2 press. Pass via {choice, character}.
      let baseCharacter;
      const passedChar = req.body && req.body.character;
      if (passedChar && passedChar.Name) {
        baseCharacter = { ...passedChar };
        delete baseCharacter.sprite; // fresh sprite will be attached by generateFull
      } else if (choice === '1') {
        const initialHP = 120 + Math.floor(Math.random() * 20) + 1;
        baseCharacter = {
          Name: 'Mortacia',
          Sex: 'Female',
          Race: 'Goddess',
          Class: 'Assassin-Fighter-Necromancer-Goddess',
          Level: 50,
          XP: 18816000,
          AC: 13,
          HP: initialHP,
          MaxHP: initialHP,
          Equipped: { Weapon: null, Armor: null, Shield: null, Other: null },
          Attack: 12,
          Damage: '2d6+8',
          Armor: 0,
          Magic: 15
        };
      } else if (choice === '2') {
        const initialHP = 80 + Math.floor(Math.random() * 20) + 1;
        baseCharacter = {
          Name: 'Suzerain',
          Sex: 'Male',
          Race: 'Human',
          Class: 'Knight of Atinus',
          Level: 15,
          AC: 11,
          XP: 168000,
          HP: initialHP,
          MaxHP: initialHP,
          Equipped: { Weapon: null, Armor: null, Shield: null, Other: null },
          Attack: 4,
          Damage: '1d10+3',
          Armor: 0,
          Magic: 2
        };
      } else {
        baseCharacter = {
          Name: 'Adventurer',
          Sex: 'Male',
          Race: 'Human',
          Class: 'Fighter',
          Level: 1,
          HP: 10 + Math.floor(Math.random() * 10) + 1,
          MaxHP: 10,
          AC: 10,
          Equipped: { Weapon: null, Armor: null, Shield: null, Other: null }
        };
      }

      // === 2. Use the dedicated focused Retort helper (defined in retortWithUserInput.js)
      // to let the LLM act as the "prefab component artist".
      // LLM only chooses body types/poses from the documented catalog (skull_crest, flowing_robe, striding_boots, scythe_long, flowing_cape etc).
      // Renderer assembles pre-mapped old-school components (Epyx stride, small head+feature, fluid folds).
      // It takes the rolled baseCharacter and returns a full character object
      // with a creative LLM-influenced spriteSpec + rendered dataUrl. Never grid/ASCII.
      const { generateFullCharacterWithRetortSprite } = require('./retort/retortWithUserInput.js');
      const fullCharacter = await generateFullCharacterWithRetortSprite(baseCharacter);

      // fullCharacter now comes from the dedicated Retort helper (LLM-influenced spriteSpec + rendered sprite)
      sharedState.setPendingCharacterForReview(fullCharacter);

      // Broadcast via the existing SSE so the client can show the review menu immediately
      broadcast({
        type: 'characterGenerationStarted',
        choice,
        character: fullCharacter,
        message: 'Character stats rolled and sprite generated by server. Review and Save or Reroll.'
      });

      const result = {
        status: 'character-ready-for-review',
        character: fullCharacter,
        taskId
      };

      tasks.set(taskId, { status: 'complete', result });
    } catch (err) {
      console.error('beginCharacterGeneration error:', err);
      sharedState.setCharacterGenerationInProgress(false);
      sharedState.setPendingCharacterForReview(null);
      tasks.set(taskId, { status: 'error', result: err.message });
    }
  })();

  res.status(202).json({ taskId });
});

// Lightweight reroll for the review menu: keep the same stats, ask the LLM artist for a fresh creative spriteSpec.
app.post('/rerollCharacterSprite', async (req, res) => {
  try {
    const base = req.body && req.body.character ? req.body.character : req.body;
    if (!base || !base.Name) {
      return res.status(400).json({ error: 'character with Name etc. required' });
    }

    // Strip any previous sprite so we get a brand new one
    const cleanBase = { ...base };
    delete cleanBase.sprite;

    const { generateFullCharacterWithRetortSprite } = require('./retort/retortWithUserInput.js');
    const updated = await generateFullCharacterWithRetortSprite(cleanBase);

    // Broadcast so any listeners (if needed) can react, though the review menu will use the direct response
    broadcast({
      type: 'characterSpriteRerolled',
      character: updated
    });

    res.json({ character: updated });
  } catch (err) {
    console.error('rerollCharacterSprite error:', err);
    res.status(500).json({ error: err.message || 'reroll failed' });
  }
});

app.post('/clearCharacterGenerationPhase', (req, res) => {
  try {
    sharedState.setCharacterGenerationInProgress(false);
    sharedState.setPendingCharacterForReview(null);
    console.log('[Server] Cleared character generation phase by request.');
    res.json({ ok: true });
  } catch (err) {
    console.error('clearCharacterGenerationPhase error:', err);
    res.status(500).json({ ok: false, error: err.message || 'clear failed' });
  }
});

// Poll endpoint

app.get('/poll-task2/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) {
    console.log(`Task not found for taskId ${req.params.taskId}`);
    return res.status(404).json({ error: 'Task not found' });
  }
  if (task.status === 'complete' || task.status === 'error') {
    console.log(`Returning task ${req.params.taskId} with status ${task.status}`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json(task);
    tasks.delete(req.params.taskId); // Cleanup
  } else {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({ status: 'processing' });
  }
});

app.post('/updateState7', async (req, res) => {
    if (inputTaskInFlight || (typeof actionDice !== 'undefined' && actionDice.active)) return res.status(409).json({ error: 'Cannot replace state during an action.' });
    const { personalNarrative, updatedGameConsole, roomNameDatabaseString, combatCharactersString, combatMode, dungeonTestingMode, currentQuest, liveWorldState } = req.body; // New: currentQuest
    let roomSync;
    try {
      roomSync = roomDatabaseReceiver.apply(req.body, sharedState.getRoomNameDatabase());
    } catch (error) {
      const status = error.code === 'ROOM_DATABASE_SYNC_REQUIRED' ? 409 : 400;
      console.warn('[StateSyncRejected]', JSON.stringify({ status, reason: error.code || 'invalid-room-database' }));
      return res.status(status).json({ error: error.message, code: error.code });
    }

    let consoleSnapshot, roomSnapshot, rosterSnapshot = combatCharactersString;
    try {
      if (updatedGameConsole !== undefined && typeof updatedGameConsole !== 'string') throw Error('The game console must be text.');
      if (updatedGameConsole !== undefined) consoleSnapshot = Economy.preserveInventory(sharedState.getUpdatedGameConsole(), updatedGameConsole, sharedState.getRoomNameDatabase());
      if (roomSync) roomSnapshot = Economy.preserve(sharedState.getRoomNameDatabase(), roomSync.json);
      if (roomSnapshot !== undefined && typeof SecretDoors !== 'undefined') roomSnapshot = SecretDoors.preserve(sharedState.getRoomNameDatabase(), roomSnapshot);
      if (typeof SpellSystem !== 'undefined') {
        const protectedSpells = SpellSystem.preserve(sharedState, consoleSnapshot, roomSnapshot);
        consoleSnapshot = protectedSpells.text; roomSnapshot = protectedSpells.database;
      }
      if (typeof CombatLife !== 'undefined') {
        const life = CombatLife.preserve(sharedState, consoleSnapshot, roomSnapshot, rosterSnapshot);
        consoleSnapshot = life.text; roomSnapshot = life.database; rosterSnapshot = life.roster;
      }
      if (combatCharactersString !== undefined) Economy.validateDivineRoster?.(combatCharactersString);
    } catch (error) { return res.status(400).json({ error: 'Invalid economy state: ' + error.message }); }
    if (personalNarrative !== undefined) sharedState.setPersonalNarrative(personalNarrative);
    if (consoleSnapshot !== undefined) sharedState.setUpdatedGameConsole(consoleSnapshot);
    if (roomSnapshot !== undefined) sharedState.setRoomNameDatabase(roomSnapshot);
    if (combatCharactersString !== undefined) {
        sharedState.setCombatCharactersString(rosterSnapshot);
        console.log('Combat roster synchronized:', { payloadChars: combatCharactersString?.length || 0 });
    }
    if (combatMode !== undefined) {
        sharedState.setCombatMode(combatMode); // Update combatMode
        console.log("Updated combatMode:", combatMode); // Debug log
    }
    if (dungeonTestingMode !== undefined) {
        sharedState.setDungeonTestingMode(dungeonTestingMode);
        console.log("Updated dungeonTestingMode:", dungeonTestingMode);
    }
    if (currentQuest !== undefined) {
        sharedState.setCurrentQuest(currentQuest); // New: Update currentQuest
        console.log("Updated currentQuest:", currentQuest); // Debug log
    }
    if (liveWorldState !== undefined) {
        sharedState.setLiveWorldState(liveWorldState);
    }
    const economyUpdate = Economy.refresh(sharedState);
    const spellUpdate = typeof SpellSystem !== 'undefined' ? SpellSystem.synchronize(sharedState) : null;

    const coordinates = String(updatedGameConsole || '').match(/Coordinates:\s*X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/);
    const geoKey = coordinates ? `${coordinates[1]},${coordinates[2]},${coordinates[3]}` : null;
    console.info('[StateSyncAccepted]', JSON.stringify({ geoKey, bytes: Number(req.get('Content-Length')) || null,
      roomDatabaseMode: roomSync?.mode || 'unchanged', changedRooms: roomSync?.changedRooms || 0 }));
    res.json({ message: 'State updated successfully', geoKey, roomDatabaseSyncToken: roomSync?.token,
      ...(economyUpdate?.changed ? { economyResult: economyStateEvent(geoKey, economyUpdate) } : {}),
      ...(spellUpdate?.changed ? { spellResult: spellStateEvent(geoKey, { content: '' }, true) } : {}) });
    // Revisit pre-render: the client syncs the new room's coordinates before the turn runs. If that room already has a
    // saved song (no LLM needed) and it is not in a slot, render it into the free slot now and announce it; the browser
    // queues it and switches when the room is on screen. The turn's own render then reuses the slot.
    if (geoKey) setImmediate(() => prepareRoomSong(geoKey));
});

// NEW: Endpoint to get room music JSON by coordinates
app.get('/get-room-music', (req, res) => {
  const { coords } = req.query; // Expect ?coords=x,y,z
  if (!coords) return res.status(400).json({ error: 'Missing coords' });
  const [x, y, z] = coords.split(',').map(n => parseInt(n) || 0);
  const coordsObj = { x, y, z };
  const music = sharedState.getRoomMusic(coordsObj);
  // runId lets the browser ignore songs cached in IndexedDB by an earlier run (every run composes fresh music)
  res.json({ music, runId: sharedState.getDungeonRunId() });
});

// NEW: Endpoint to set room music JSON by coordinates
app.post('/set-room-music', (req, res) => {
  const { coords, musicJson } = req.body;
  if (!coords || !musicJson) return res.status(400).json({ error: 'Missing coords or musicJson' });
  const [x, y, z] = coords.split(',').map(n => parseInt(n) || 0);
  const coordsObj = { x, y, z };
  sharedState.setRoomMusic(coordsObj, musicJson);
  res.json({ status: 'success' });
});

app.post('/music/commit', async (req, res) => {
  try {
    const { coords, musicJson } = req.body || {};
    if (!coords) return res.status(400).json({ error: 'Missing coords' });

    const [x, y, z] = String(coords).split(',').map(n => parseInt(n) || 0);
    const coordsObj = { x, y, z };
    const key = `${x},${y},${z}`;

    // Prefer provided JSON; else load from sharedState
    const arrangement = musicJson || sharedState.getRoomMusic(coordsObj);
    if (!arrangement) return res.status(404).json({ error: `No music JSON for ${key}` });

    const playback = LiveRoomMusic.prepare(arrangement,{coords:key,runId:sharedState.getDungeonRunId()});
    // The browser executes the SID; preparing music no longer creates a room WAV.
    const token = Date.now();
    // SFX pass: the LLM's ambience tags ride along so the browser can start the room's ambient loops.
    const ambience = Array.isArray(arrangement.ambience) ? arrangement.ambience : null;
    broadcast({ ...playback, type: 'roomMusicReady', coords: key, token, ambience });

    return res.json({ ...playback, ok: true, coords: key, ambience });
  } catch (err) {
    console.error('POST /music/commit error:', err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
});

function prepareRoomSong(geoKey) {
  try {
    const [x, y, z] = geoKey.split(',').map(Number);
    const song = sharedState.getRoomMusic({ x, y, z });
    if (!song || MusicSlots.find(geoKey)) return;
    if (MusicSlots.latest().playing && MusicSlots.state.holds[MusicSlots.state.playing] === geoKey) return;
    const playback=LiveRoomMusic.prepare(song,{coords:geoKey,runId:sharedState.getDungeonRunId()});
    console.log(`[music] prepared saved SID for revisit ${geoKey}`);
    broadcast({ ...playback, type: 'roomMusicUpdated', coords: geoKey, isNew: true, ambience: Array.isArray(song.ambience) ? song.ambience : null });
  } catch (err) { console.warn('[music] revisit SID preparation failed:', err && err.message); }
}

// Two-slot room music: the browser reports which slot it is playing, and asks for the latest song on page load.
app.post('/music/now-playing', (req, res) => {
  MusicSlots.setPlaying(String((req.body && req.body.slot) || ''));
  res.json({ ok: true, ...MusicSlots.latest() });
});
app.get('/music/latest', (req, res) => res.json(MusicSlots.latest()));

app.get('/get-room-dungeon', (req, res) => {
  const { coords } = req.query; // ?coords=x,y,z
  if (!coords) return res.status(400).json({ error: 'Missing coords' });
  const [x, y, z] = coords.split(',').map(n => parseInt(n) || 0);
  const dungeon = sharedState.getRoomDungeon({ x, y, z });
  res.json({ dungeon: dungeon || null });
});

// DISABLED: the 45s "space weather" / dungeon sim reports (runNpcAutonomyTick + broadcast) were causing Objects in Room to respawn after equipping/taking items (despite guards in retort).
// The client-driven 45s via chatbotprocessinput('') was also disabled for the same reason.
// Re-enable only if autonomous background narrative + NPC movement routines are desired again.
// setInterval(async () => {
//   if (npcAutonomyTickInFlight) return;
//   if (sharedState.isCharacterGenerationInProgress && sharedState.isCharacterGenerationInProgress()) return;
//   if (!sharedState.getLiveWorldState || !sharedState.getLiveWorldState()) return;

//   npcAutonomyTickInFlight = true;
//   try {
//     const update = await runNpcAutonomyTick();
//     if (update && (update.summary || (Array.isArray(update.dialogue) && update.dialogue.length) || (Array.isArray(update.routines) && update.routines.length))) {
//       broadcast({ type: 'npcAutonomyUpdate', update });
//     }
//   } catch (err) {
//     console.error('[NPC Autonomy] Loop tick failed:', err);
//   } finally {
//     npcAutonomyTickInFlight = false;
//   }
// }, NPC_AUTONOMY_TICK_MS);

app.use(gameJsonErrorHandler);

require('./saveGames').install(app, { state: sharedState,
  isBusy: () => inputTaskInFlight || npcAutonomyTickInFlight || [...tasks.values()].some(t => t.status === 'processing'),
  onRestored: checkpoint => { roomDatabaseReceiver.reset(); tasks.clear(); MusicSlots.reset(); lastAutonomyAt = 0;
    const population = sharedState.getRoomPopulation(checkpoint.roomKey);
    if (population) population.dialogueResumePending = true;
    SidMode.set(checkpoint.settings.sidMode);
    prepareRoomSong(checkpoint.roomKey);
    const audio = MusicSlots.latest();
    if (sharedState.getRoomMusic(sharedState.getLastCoords()) && !audio.sid) throw Error('Room music compiler did not produce a SID.');
    return audio; }
});

const lifecycle = require('./serverLifecycle').install(app, { port, state: sharedState, dice: actionDice,
  isBusy: () => inputTaskInFlight || npcAutonomyTickInFlight || [...tasks.values()].some(t => t.status === 'processing'),
  beforeClose: () => { for (const client of clients.slice()) client.res.end(); },
  flush: () => serverLog?.close()
});
lifecycle.listen();

module.exports = { broadcast };
