require('./serverLogger').installServerLogger();

const express = require('express');
const { createGameJsonParser, gameJsonErrorHandler, createRoomDatabaseReceiver } = require('./gameStateTransport');
const cors = require('cors');
const { retortWithUserInput, runNpcAutonomyTick } = require('./retort/retortWithUserInput.js');
const sharedState = require('./sharedState');
const fs = require('fs');
const path = require('path');
const { renderArrangementToWav } = require('./retort/renderAudio');
const characterTraits = require('./retort/characterTraitSpec');
const { summarizeDungeon } = require('./dungeonDiagnostics');
const { actionDice } = require('./retort/actionDice');
const LivingEnvironments = require('./assets/livingEnvironments');
const { finalizeRoomDungeon } = require('./retort/retortWithUserInput');
const { buildEnvironmentLab, descriptions: environmentLabKinds } = require('./retort/environmentLab');
const { buildInitialWorldConsole, buildInitialGameConsole } = require('./retort/initialGameState');
const app = express();
const port = 3000;
const roomDatabaseReceiver = createRoomDatabaseReceiver();

// Middleware
app.use(createGameJsonParser());
app.use(cors());
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
    client.send(actionDice.snapshot());

    req.on('close', () => {
        clearInterval(keepAlive);
        const index = clients.indexOf(client);
        if (index !== -1) clients.splice(index, 1);
    });
});

// Function to broadcast to all connected clients
function broadcast(data) {
    if (data.type === 'dungeonLoaded' && data.dungeon) {
        console.info('[DungeonDelivered]', JSON.stringify(summarizeDungeon(data.dungeon)));
    }
    clients.forEach(client => client.send(data));
}

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
    const { combatant, target, cancelled, actionId } = req.body;
    if (!actionDice.active || actionDice.active.kind !== 'combat' || actionDice.active.id !== actionId) {
      return res.status(409).json({ error: 'That combat turn is no longer active.' });
    }
    console.log(`Received target selection: ${combatant} targets ${target}`);
    sharedState.emitter.emit(`target_response_${combatant}`, { target, cancelled: cancelled === true, actionId });
    res.json({ status: 'success' });
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
  if (inputTaskInFlight || actionDice.active) return res.status(409).json({ error: 'Finish the current action first.' });
  const coords = sharedState.getLastCoords();
  if (!coords || !req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'No active room or action.' });
  const geoKey = `${coords.x},${coords.y},${coords.z}`;
  if (req.body.geoKey !== geoKey) return res.status(409).json({ error: 'That room is no longer active.' });
  const dungeon = sharedState.getRoomDungeon(coords);
  if (!dungeon?.livingEncounter) return res.status(404).json({ error: 'No seal encounter in this room.' });
  const result = LivingEnvironments.interact(dungeon, req.body);
  if (!result.ok) return res.status(409).json({ error: result.message });
  const next = finalizeRoomDungeon(geoKey, { ...dungeon, cells: { ...dungeon.cells, ...result.cells }, livingEncounter: result.encounter }, dungeon.customTiles);
  sharedState.setRoomDungeon(coords, next, next.customTiles);
  const delta = { type: 'dungeonCellUpdate', geoKey, previousStamp: dungeon._geometryStamp,
    geometryStamp: next._geometryStamp, cells: result.cells, livingEncounter: result.encounter };
  broadcast(delta);
  console.info('[LivingEnvironmentAction]', JSON.stringify({ geoKey, fixture: req.body.fixtureId, revision: result.encounter.revision, status: result.encounter.status }));
  res.json({ message: result.message, delta });
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
const NPC_AUTONOMY_TICK_MS = 45000; // changed to 45s; main story simulation now also driven via client chatbotprocessinput(every 45s) with char positions for narrative continuity
let npcAutonomyTickInFlight = false;

app.post('/processInput7', async (req, res) => {
  if (inputTaskInFlight) return res.status(409).json({ error: 'The previous action is still resolving.' });
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

  // Background process
  (async () => {
    try {
      if (req.body && req.body.liveWorldState !== undefined) {
        sharedState.setLiveWorldState(req.body.liveWorldState);
      }
      const combatMode = sharedState.getCombatMode();
      console.log(`Starting retortWithUserInput for taskId ${taskId}`);
      const result = await retortWithUserInput(req.body.userInput, broadcast, combatMode);
      console.log(`retortWithUserInput completed for taskId ${taskId}, result:`, result);
      let updatedGameConsole = sharedState.getUpdatedGameConsole();
        if (!updatedGameConsole.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/)) {
            console.log('No coordinates in updatedGameConsole, adding default');
            updatedGameConsole = `Coordinates: X: 0, Y: 0, Z: 0\n${updatedGameConsole}`;
            sharedState.setUpdatedGameConsole(updatedGameConsole);
        }
      const combatCharactersString = sharedState.getCombatCharactersString();
      characterTraits.ensureTraitSpecsForConsole(updatedGameConsole, broadcast); // new PCs/NPCs/monsters -> trait specs (async)
      const roomNameDatabaseString = sharedState.getRoomNameDatabase(); // Add this
      const currentQuest = sharedState.getCurrentQuest(); // New: Include current quest
      const finalResult = { 
        response: result.content, 
        updatedGameConsole, 
        combatCharactersString,
        roomNameDatabaseString, // Include in response
        currentQuest, // New
        imageUrl: result.imageUrl,
        musicArrangement: result.musicArrangement || null,
        npcDirectives: Array.isArray(result.npcDirectives) ? result.npcDirectives : [],
        combatRoundOnly: !!(result.combatRoundOnly || result.actionOnly)
      };
      tasks.set(taskId, { 
        status: 'complete', 
        result: finalResult 
      });
      console.log(`Task ${taskId} completed, result set:`, finalResult);
    } catch (err) {
      console.error('Background task error for taskId ' + taskId + ':', err);
      tasks.set(taskId, { status: 'error', result: err.message });
    } finally {
      actionDice.end();
      inputTaskInFlight = false;
    }
  })();

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

      // We send a special internal command to retortWithUserInput so it knows to skip the normal start menu
      // and use the provided character directly, then begin dungeon generation.
      const specialInput = `__START_WITH_CHARACTER__${JSON.stringify(characterData)}`;

      const result = await retortWithUserInput(specialInput, broadcast, combatMode);

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
    console.log(`Returning task ${req.params.taskId} with status ${task.status}:`, task);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json(task);
    tasks.delete(req.params.taskId); // Cleanup
  } else {
    console.log(`Task ${req.params.taskId} still processing`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({ status: 'processing' });
  }
});

app.post('/updateState7', async (req, res) => {
    if (inputTaskInFlight) return res.status(409).json({ error: 'Cannot replace state during an action.' });
    const { personalNarrative, updatedGameConsole, roomNameDatabaseString, combatCharactersString, combatMode, dungeonTestingMode, currentQuest, liveWorldState } = req.body; // New: currentQuest
    let roomSync;
    try {
      roomSync = roomDatabaseReceiver.apply(req.body, sharedState.getRoomNameDatabase());
    } catch (error) {
      const status = error.code === 'ROOM_DATABASE_SYNC_REQUIRED' ? 409 : 400;
      console.warn('[StateSyncRejected]', JSON.stringify({ status, reason: error.code || 'invalid-room-database' }));
      return res.status(status).json({ error: error.message, code: error.code });
    }

    if (personalNarrative !== undefined) sharedState.setPersonalNarrative(personalNarrative);
    if (updatedGameConsole !== undefined) sharedState.setUpdatedGameConsole(updatedGameConsole);
    if (roomSync) sharedState.setRoomNameDatabase(roomSync.json);
    if (combatCharactersString !== undefined) {
        sharedState.setCombatCharactersString(combatCharactersString);
        console.log("Updated combatCharactersString:", combatCharactersString);
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

    const coordinates = String(updatedGameConsole || '').match(/Coordinates:\s*X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/);
    const geoKey = coordinates ? `${coordinates[1]},${coordinates[2]},${coordinates[3]}` : null;
    console.info('[StateSyncAccepted]', JSON.stringify({ geoKey, bytes: Number(req.get('Content-Length')) || null,
      roomDatabaseMode: roomSync?.mode || 'unchanged', changedRooms: roomSync?.changedRooms || 0 }));
    res.json({ message: 'State updated successfully', geoKey, roomDatabaseSyncToken: roomSync?.token });
});

// NEW: Endpoint to get room music JSON by coordinates
app.get('/get-room-music', (req, res) => {
  const { coords } = req.query; // Expect ?coords=x,y,z
  if (!coords) return res.status(400).json({ error: 'Missing coords' });
  const [x, y, z] = coords.split(',').map(n => parseInt(n) || 0);
  const coordsObj = { x, y, z };
  const music = sharedState.getRoomMusic(coordsObj);
  res.json({ music });
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

    // Ensure directories
    const retortDir = path.join(__dirname, 'retort');
    const sidDir    = path.join(__dirname, 'sid');
    fs.mkdirSync(retortDir, { recursive: true });
    fs.mkdirSync(sidDir, { recursive: true });

    const jsonPath = path.join(retortDir, 'current_room.json');
    const asmOut = path.join(sidDir, 'current_room.asm');
    const sidPath = path.join(sidDir, 'current_room.sid');
    const renderSeconds = 60;
    const wavBase = path.join(sidDir, 'current_room');
    const sidCore = path.join(__dirname, 'assets', 'renderSid_poke.js');
    const { wavPath, renderer } = renderArrangementToWav(arrangement, {
      jsonPath,
      asmOut,
      sidOut: sidPath,
      outBaseNoExt: wavBase,
      seconds: renderSeconds,
      renderJsPath: sidCore,
      cwd: __dirname,
    });
    if (!wavPath || !fs.existsSync(wavPath)) {
      return res.status(500).json({ error: 'WAV not produced at expected path' });
    }

    // 4) broadcast + reply (cache-busted URL for clients)
    const token = Date.now();
    const wavUrl = `/sid/current_room.wav?cb=${token}`;
    broadcast({ type: 'roomMusicReady', coords: key, wav: wavUrl, token, renderer });

    return res.json({ ok: true, coords: key, wav: wavUrl, renderer });
  } catch (err) {
    console.error('POST /music/commit error:', err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
});

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

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

module.exports = { broadcast };
