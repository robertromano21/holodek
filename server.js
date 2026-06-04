const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { retortWithUserInput } = require('./retort/retortWithUserInput.js');
const sharedState = require('./sharedState');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
//const { renderRoomMusic } = require('./retort/renderAudio');
const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use(express.json()); // Ensure JSON parsing is enabled
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

    req.on('close', () => {
        clearInterval(keepAlive);
        const index = clients.indexOf(client);
        if (index !== -1) clients.splice(index, 1);
    });
});

// Function to broadcast to all connected clients
function broadcast(data) {
    clients.forEach(client => client.send(data));
}

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
    const { combatant, target } = req.body;
    console.log(`Received target selection: ${combatant} targets ${target}`);
    sharedState.emitter.emit(`target_response_${combatant}`, { target });
    res.json({ status: 'success' });
});

const tasks = new Map();  // { taskId: { status: 'processing', result: null } }

app.post('/processInput7', async (req, res) => {
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

  // Background process
  (async () => {
    try {
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
      const roomNameDatabaseString = sharedState.getRoomNameDatabase(); // Add this
      const currentQuest = sharedState.getCurrentQuest(); // New: Include current quest
      const finalResult = { 
        response: result.content, 
        updatedGameConsole, 
        combatCharactersString,
        roomNameDatabaseString, // Include in response
        currentQuest, // New
        imageUrl: result.imageUrl,
        musicArrangement: result.musicArrangement || null
      };
      tasks.set(taskId, { 
        status: 'complete', 
        result: finalResult 
      });
      console.log(`Task ${taskId} completed, result set:`, finalResult);
    } catch (err) {
      console.error('Background task error for taskId ' + taskId + ':', err);
      tasks.set(taskId, { status: 'error', result: err.message });
    }
  })();

  res.status(202).json({ taskId }); // Immediate return
});

// New endpoint: Client calls this after the user clicks "Save" on the character sprite review menu.
// This tells the Retort session "the player has finalized their starting character (with sprite) — now proceed with dungeon generation".
app.post('/startGameWithCharacter', async (req, res) => {
  const taskId = Date.now().toString();
  tasks.set(taskId, { status: 'processing', result: null });

  (async () => {
    try {
      const combatMode = sharedState.getCombatMode();
      const characterData = req.body.character; // The finalized PC with sprite.dataUrl etc.
      const partyNpcData = Array.isArray(req.body.npcs) ? req.body.npcs : [];
      const incomingCombatCharacters = Array.isArray(req.body.combatCharacters) ? req.body.combatCharacters : null;

      console.log(`[Server] Starting game with finalized character:`, characterData?.Name || characterData?.name);

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
      const eq = characterData.Equipped || { Weapon: null, Armor: null, Shield: null, Other: null };
      const equippedStr = `Weapon: ${eq.Weapon || 'None'}, Armor: ${eq.Armor || 'None'}, Shield: ${eq.Shield || 'None'}, Other: ${eq.Other || 'None'}`;
      const pcBlock = `PC:
Name: ${characterData.Name || characterData.name}
Sex: ${characterData.Sex || characterData.sex}
Race: ${characterData.Race || characterData.race}
Class: ${characterData.Class || characterData.class}
Level: ${characterData.Level || characterData.level}
AC: ${characterData.AC || characterData.ac || 10}
XP: ${characterData.XP || characterData.xp || 0}
HP: ${characterData.HP || characterData.hp}
MaxHP: ${characterData.MaxHP || characterData.maxHP || characterData.HP || characterData.hp}
Equipped: ${equippedStr}
Attack: ${characterData.Attack || characterData.attack || 0}
Damage: ${characterData.Damage || characterData.damage || 0}
Armor: ${characterData.Armor || characterData.armor || 0}
Magic: ${characterData.Magic || characterData.magic || 0}
`;

      const npcBlock = partyNpcData.length
        ? `NPCs in Party:
${partyNpcData.map(npc => {
  const npcEq = npc.Equipped || { Weapon: null, Armor: null, Shield: null, Other: null };
  const npcEquippedStr = `Weapon: ${npcEq.Weapon || 'None'}, Armor: ${npcEq.Armor || 'None'}, Shield: ${npcEq.Shield || 'None'}, Other: ${npcEq.Other || 'None'}`;
  return `Name: ${npc.Name || npc.name}
Sex: ${npc.Sex || npc.sex}
Race: ${npc.Race || npc.race}
Class: ${npc.Class || npc.class}
Level: ${npc.Level || npc.level || 1}
AC: ${npc.AC || npc.ac || 10}
XP: ${npc.XP || npc.xp || 0}
HP: ${npc.HP || npc.hp || 0}
MaxHP: ${npc.MaxHP || npc.maxHP || npc.HP || npc.hp || 0}
Equipped: ${npcEquippedStr}
Attack: ${npc.Attack || npc.attack || 0}
Damage: ${npc.Damage || npc.damage || 0}
Armor: ${npc.Armor || npc.armor || 0}
Magic: ${npc.Magic || npc.magic || 0}`;
}).join('\n\n')}
`
        : `NPCs in Party: None
`;

      // Seed the updatedGameConsole with the PC stats so the main console display (and the LLM prompt)
      // includes them above the prompt, exactly as the last-known-good 1/2 path in chatbotprocessinput did.
      sharedState.setUpdatedGameConsole(`${pcBlock}${npcBlock}`);

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
    }
  })();

  res.status(202).json({ taskId });
});

// Dedicated endpoint to begin the isolated character generation phase.
// This triggers a *focused* Retort-assisted character + sprite generation
// BEFORE the main dungeon creation logic ever runs.
app.post('/beginCharacterGeneration', async (req, res) => {
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
    const { personalNarrative, updatedGameConsole, roomNameDatabaseString, combatCharactersString, combatMode, dungeonTestingMode, currentQuest } = req.body; // New: currentQuest

    if (personalNarrative !== undefined) sharedState.setPersonalNarrative(personalNarrative);
    if (updatedGameConsole !== undefined) sharedState.setUpdatedGameConsole(updatedGameConsole);
    if (roomNameDatabaseString !== undefined) sharedState.setRoomNameDatabase(roomNameDatabaseString);
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

    res.json({ message: 'State updated successfully' });
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

    // 1) write current_room.json
    const jsonPath = path.join(retortDir, 'current_room.json');
    fs.writeFileSync(jsonPath, JSON.stringify(arrangement, null, 2), 'utf8');

    // 2) build SID from JSON
    const asmOut  = path.join(sidDir, 'current_room.asm');
    const sidCore = path.join(__dirname, 'assets', 'renderSid_poke.js');
    const a = spawnSync('node', [sidCore, jsonPath, asmOut], { cwd: __dirname, stdio: 'inherit' });
    if (a.status !== 0) return res.status(500).json({ error: 'renderSid_poke.js failed' });

    const sidPath = path.join(sidDir, 'current_room.sid');
    if (!fs.existsSync(sidPath)) return res.status(500).json({ error: 'SID not produced' });

    // 3) render WAV (single, robust call)
    const renderSeconds = 60; // full minute
    const wavBase = path.join(sidDir, 'current_room'); // no extension here
    const sidArgs = ['-vp', `-w${wavBase}`, `-t${renderSeconds}`, sidPath];
    console.log('sidplayfp args:', sidArgs.join(' '));
    const w = spawnSync('sidplayfp', sidArgs, { stdio: 'inherit' });
    if (w.status !== 0) return res.status(500).json({ error: 'sidplayfp failed' });

    // Normalize output name: current_room.wav
    const wav1 = `${wavBase}.wav`;        // desired
    const wav2 = `${wavBase}.wav.wav`;    // some builds append twice
    const wav3 = wavBase;                 // rare: no extension
    try {
      if (fs.existsSync(wav2)) {
        if (fs.existsSync(wav1)) { try { fs.unlinkSync(wav1); } catch {} }
        fs.renameSync(wav2, wav1);
      } else if (!fs.existsSync(wav1) && fs.existsSync(wav3)) {
        fs.renameSync(wav3, wav1);
      }
    } catch (e) {
      console.warn('WAV normalize warning:', e);
    }
    if (!fs.existsSync(wav1)) return res.status(500).json({ error: 'WAV not produced at expected path' });

    // 4) broadcast + reply (cache-busted URL for clients)
    const token = Date.now();
    const wavUrl = `/sid/current_room.wav?cb=${token}`;
    broadcast({ type: 'roomMusicReady', coords: key, wav: wavUrl, token });

    return res.json({ ok: true, coords: key, wav: wavUrl });
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

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

module.exports = { broadcast };
