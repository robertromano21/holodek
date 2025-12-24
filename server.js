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

app.post('/submit-target2', (req, res) => {
    const { combatant, target } = req.body;
    console.log(`Received target selection: ${combatant} targets ${target}`);
    sharedState.emitter.emit(`target_response_${combatant}`, { target });
    res.json({ status: 'success' });
});

const tasks = new Map();  // { taskId: { status: 'processing', result: null } }

app.post('/processInput7', async (req, res) => {
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
    const { personalNarrative, updatedGameConsole, roomNameDatabaseString, combatCharactersString, combatMode, currentQuest } = req.body; // New: currentQuest

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
    const sidCore = path.join(__dirname, 'retort', 'renderSid_poke.js');
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