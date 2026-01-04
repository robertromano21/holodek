//const { ipcRenderer } = require('electron');

// Add this at the top of game (8).js
window.roomImages = {};

// Temporary: force the original canvas renderer while debugging sync issues.
window.forceCanvasDungeon = false;

window.currentCoordinates = "X: 0, Y: 0, Z: 0";

// --- IndexedDB for room music ---
const MUSIC_DB_NAME = 'cotg-music';
const MUSIC_STORE   = 'rooms';
// --- IndexedDB for dungeon layouts ---
const DUNGEON_DB_NAME = 'cotg-dungeons';
const DUNGEON_STORE   = 'rooms';
const DUNGEON_CACHE_VERSION = 2;
let dungeonDBPromise = null;
let lastDungeonGeoKey = null;

function openDungeonDB() {
  if (dungeonDBPromise) return dungeonDBPromise;

  dungeonDBPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DUNGEON_DB_NAME, 1);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DUNGEON_STORE)) {
        db.createObjectStore(DUNGEON_STORE); // key = "x,y,z"
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });

  return dungeonDBPromise;
}

async function idbGetDungeon(coordsKey) {
  const db = await openDungeonDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(DUNGEON_STORE, 'readonly');
    const req = tx.objectStore(DUNGEON_STORE).get(coordsKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => reject(req.error);
  });
}

async function idbSetDungeon(coordsKey, dungeon) {
  const db = await openDungeonDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DUNGEON_STORE, 'readwrite');
    tx.objectStore(DUNGEON_STORE).put(dungeon, coordsKey);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

let pendingLodPersist = null;

function scheduleLodCachePersist() {
  if (!currentDungeon || !currentDungeon.geoKey) return;
  if (pendingLodPersist) return;
  pendingLodPersist = setTimeout(async () => {
    try {
      const key = currentDungeon && currentDungeon.geoKey;
      if (!key) return;
      await idbSetDungeon(key, currentDungeon);
    } catch (err) {
      console.warn('Failed to persist LOD cache:', err);
    } finally {
      pendingLodPersist = null;
    }
  }, 1500);
}

function chooseLodFactor(pixelSize) {
  if (pixelSize >= 1.2) return 1;
  if (pixelSize >= 0.6) return 2;
  if (pixelSize >= 0.3) return 4;
  if (pixelSize >= 0.15) return 8;
  return 16;
}

function chooseRowStep(pixelSize) {
  const factor = chooseLodFactor(pixelSize);
  if (factor <= 1) return 1;
  if (factor <= 2) return 2;
  if (factor <= 4) return 3;
  if (factor <= 8) return 5;
  return 7;
}

function ensureLodCache(dungeon, factor) {
  if (!dungeon || !dungeon.layout || factor <= 1) return null;
  if (!dungeon._lodCache) dungeon._lodCache = {};
  if (dungeon._lodCache[factor]) return dungeon._lodCache[factor];

  const w = dungeon.layout.width;
  const h = dungeon.layout.height;
  const lw = Math.ceil(w / factor);
  const lh = Math.ceil(h / factor);
  const heights = new Array(lw * lh);
  const solids = new Array(lw * lh);
  const quantStep = factor >= 16 ? 0.5 : factor >= 8 ? 0.25 : 0.1;

  for (let cy = 0; cy < lh; cy++) {
    for (let cx = 0; cx < lw; cx++) {
      let sum = 0;
      let count = 0;
      let solidCount = 0;
      const x0 = cx * factor;
      const y0 = cy * factor;
      const x1 = Math.min(w, x0 + factor);
      const y1 = Math.min(h, y0 + factor);

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const cell = dungeon.cells[`${x},${y}`];
          if (!cell) continue;
          const fh = typeof cell.floorHeight === 'number' ? cell.floorHeight : 0;
          sum += fh;
          count++;
          if (cell.tile === 'wall') solidCount++;
        }
      }

      let avg = count > 0 ? (sum / count) : 0;
      if (quantStep > 0) {
        avg = Math.round(avg / quantStep) * quantStep;
      }
      const idx = cy * lw + cx;
      heights[idx] = avg;
      solids[idx] = count > 0 ? (solidCount > count * 0.5) : false;
    }
  }

  const cache = {
    factor,
    w: lw,
    h: lh,
    heights,
    solids,
    createdAt: Date.now()
  };

  dungeon._lodCache[factor] = cache;
  scheduleLodCachePersist();
  return cache;
}

function getLodSample(dungeon, x, y, factor) {
  const cache = ensureLodCache(dungeon, factor);
  if (!cache) return null;
  const cx = Math.floor(x / factor);
  const cy = Math.floor(y / factor);
  if (cx < 0 || cy < 0 || cx >= cache.w || cy >= cache.h) return null;
  const idx = cy * cache.w + cx;
  return { floorHeight: cache.heights[idx], solid: cache.solids[idx] };
}

async function switchDungeonForCoordinates(coordString) {
  // coordString is like "X: 0, Y: 0, Z: 0"
  const match = coordString.match(/X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/);
  if (!match) return;

  const geoKey = `${match[1]},${match[2]},${match[3]}`;

  if (currentDungeon?.geoKey === geoKey) return;

  const cached = await idbGetDungeon(geoKey);
  if (!cached) {
    console.log('No cached dungeon yet for', geoKey);
    return; // server will generate it
  }
  const cachedVersion = cached?._meta?.version || 0;
  if (cachedVersion < DUNGEON_CACHE_VERSION) {
    console.log('Discarding outdated dungeon cache on switch:', geoKey, 'version', cachedVersion);
    return; // allow server to generate a fresh dungeon
  }

  console.log('Switching dungeon due to coordinate change:', geoKey);

  currentDungeon = cached;
  currentDungeon.geoKey = geoKey;

  const rawStart  = currentDungeon.start || { x: 10, y: 18 };
  const safeStart = findNearestWalkableStart(currentDungeon, rawStart);

  currentDungeon.start = safeStart;
  playerDungeonX = safeStart.x;
  playerDungeonY = safeStart.y;
  playerZInitialized = false;
  playerPosX = playerDungeonX + 0.5;
  playerPosY = playerDungeonY + 0.5;

  preloadDungeonTextures();
  updatePlayerHeightFromCell();
  renderDungeonView();
  logDungeonCombatSync('move');

  if (window.combatGame) {
    const scene = window.combatGame.scene.getScene('CombatScene');
    if (scene && scene.drawDungeonOverlay) {
      scene.drawDungeonOverlay();
    }
  }
}

function logDungeonLayout(dungeon) {
  if (!dungeon || !dungeon.cells) {
    console.warn('logDungeonLayout: invalid dungeon');
    return;
  }

  // Clone cells into a single object for clean inspection
  const tileMap = {};

  for (const key of Object.keys(dungeon.cells)) {
    tileMap[key] = dungeon.cells[key];
  }

  console.group(`🧱 Dungeon Layout @ ${dungeon.geoKey || 'unknown'}`);
  console.log('Meta:', dungeon._meta || {});
  console.log('Size:', dungeon.layout || 'unknown');
  console.log('Start:', dungeon.start);

  // One expandable object: tileMap["20,3"] → full tile object
  console.log('Tiles (keyed by "x,y"):', tileMap);

  // Full cell dump (array of { x, y, ...cell }) for inspecting exact data.
  try {
    const cellsArray = [];
    for (const [key, cell] of Object.entries(dungeon.cells)) {
      const comma = key.indexOf(',');
      if (comma <= 0) continue;
      const x = Number(key.slice(0, comma));
      const y = Number(key.slice(comma + 1));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      cellsArray.push({ x, y, ...cell });
    }
    console.log('Dungeon cells array:', cellsArray);
  } catch (err) {
    console.warn('Failed to log dungeon cells array:', err);
  }

  console.groupEnd();
}

function applyCombatPixelScale() {
  const PIXEL_SCALE = 4;
  const canvas = document.querySelector('#combat-container canvas');
  if (!canvas) return;

  const displayW = canvas.clientWidth;
  const displayH = canvas.clientHeight;

  // 🔽 Reduce backing resolution
  canvas.width  = Math.floor(displayW / PIXEL_SCALE);
  canvas.height = Math.floor(displayH / PIXEL_SCALE);

  // 🔼 Keep visual size identical
  canvas.style.width  = displayW + 'px';
  canvas.style.height = displayH + 'px';

  // 🔒 Ensure nearest-neighbor
  canvas.style.imageRendering = 'pixelated';
  canvas.style.imageRendering = 'crisp-edges';

  console.log('Combat pixel scale applied:', PIXEL_SCALE);
}


let musicDBPromise = null;

function openMusicDB() {
  if (musicDBPromise) return musicDBPromise;
  musicDBPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(MUSIC_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(MUSIC_STORE)) {
        db.createObjectStore(MUSIC_STORE); // key = "x,y,z", value = music JSON
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return musicDBPromise;
}

async function idbSetMusic(coordsKey, json) {
  const db = await openMusicDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MUSIC_STORE, 'readwrite');
    tx.objectStore(MUSIC_STORE).put(json, coordsKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetMusic(coordsKey) {
  const db = await openMusicDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MUSIC_STORE, 'readonly');
    const req = tx.objectStore(MUSIC_STORE).get(coordsKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Ensure we have a reusable <audio> element
// Ensure we have a reusable <audio> element
let roomAudio = document.getElementById('room-audio');
if (!roomAudio) {
  roomAudio = document.createElement('audio');
  roomAudio.id = 'room-audio';
  roomAudio.preload = 'auto';
  roomAudio.loop = true; // optional
  roomAudio.crossOrigin = 'anonymous'; // safe on same-origin too
  document.body.appendChild(roomAudio);
}

// One-time autoplay unlock (mobile/safari friendly)
document.addEventListener('pointerdown', () => {
  roomAudio.muted = false;
  roomAudio.play().catch(() => {}); // kick the audio context once
  roomAudio.pause();
}, { once: true });

// Singleton <audio> (created if missing)
function getRoomAudio() {
  let a = document.getElementById('room-audio');
  if (!a) {
    a = document.createElement('audio');
    a.id = 'room-audio';
    a.autoplay = true;
    a.loop = true;
    a.preload = 'none';
    // Optional: avoid CORS weirdness if you ever move assets
    a.crossOrigin = 'anonymous';
    document.body.appendChild(a);
  }
  return a;
}

function stopRoomWav() {
  const a = getRoomAudio();
  try { a.pause(); } catch {}
  // Nuke any decoded buffer and force a brand-new load next time:
  a.removeAttribute('src');
  // If you ever used srcObject/WebAudio, clear it too:
  a.srcObject = null;
  a.load();
}

let lastWavToken = 0;
async function playRoomWavFresh(url, token = Date.now()) {
  const a = getRoomAudio();

  // Ignore stale broadcasts that arrive out of order
  if (token <= lastWavToken) return;
  lastWavToken = token;

  // Kill current playback completely, then swap source
  stopRoomWav();

  // Assign the new cache-busted URL and play
  a.src = url.includes('?') ? url : `${url}?cb=${Date.now()}`;
  // Force the network load (avoids some UA preloading quirks)
  a.load();
  try { await a.play(); } catch (e) {
    // If autoplay is blocked, user gesture will start it later
    console.warn('Autoplay blocked:', e);
  }
}

// Call this once on page load:
function attachMusicSSE() {
  // Don't create duplicate listeners
  if (window.__musicSSEAttached) return;
  window.__musicSSEAttached = true;

  const ev = new EventSource('/combat-updates2');
  ev.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }

    if (data?.type === 'roomMusicStop') {
      stopRoomWav();
    }
    if (data?.type === 'roomMusicReady' && data?.wav) {
      playRoomWavFresh(data.wav, data.token || Date.now());
    }
  };

  ev.onerror = (err) => console.warn('SSE error', err);
}

let currentDungeon = null;
let playerDungeonX = 7, playerDungeonY = 13;
let playerPosX = playerDungeonX + 0.5;
let playerPosY = playerDungeonY + 0.5;
// Facing angle for the 3D view (radians).
// -Math.PI/2 = looking "up" (negative Y) to match your usual north/up.
let playerAngle = -Math.PI / 2;

window.playerAngle = playerAngle;
window.playerPosX = playerPosX;
window.playerPosY = playerPosY;

// 3D dungeon extras
let dungeonTextures = {};
const PLAYER_EYE_HEIGHT = 0.65;  // eye above local floor
let playerZ = PLAYER_EYE_HEIGHT;
let playerZTarget = PLAYER_EYE_HEIGHT;
let playerZInitialized = false;
let _syncDebugLastKey = '';
let _syncDebugLastTs = 0;

function logDungeonCombatSync(reason) {
  const combatScene = window.combatGame && window.combatGame.scene.getScene('CombatScene');
  const pc = combatScene && combatScene.pcName && combatScene.characters
    ? combatScene.characters[combatScene.pcName]
    : null;
  const cam = combatScene && combatScene.cameras && combatScene.cameras.main
    ? combatScene.cameras.main
    : null;

  const state = {
    reason,
    dungeon: {
      x: playerDungeonX,
      y: playerDungeonY,
      z: playerZ
    },
    combat: {
      pcX: pc ? pc.x : null,
      pcY: pc ? pc.y : null,
      camX: cam ? Math.round(cam.scrollX) : null,
      camY: cam ? Math.round(cam.scrollY) : null
    },
    geoKey: currentDungeon ? currentDungeon.geoKey : null
  };

  const key = JSON.stringify(state);
  const now = Date.now();
  if (key === _syncDebugLastKey && now - _syncDebugLastTs < 500) return;
  _syncDebugLastKey = key;
  _syncDebugLastTs = now;
  //console.log('[Sync]', state);
}

// SSE handler
const eventSource = new EventSource('/combat-updates2');
eventSource.onmessage = function(event) {
  let data;
  try { data = JSON.parse(event.data); } catch { return; }

  // Room music
  if (data?.type === 'roomMusicReady' && data?.wav) {
    playRoomWavFresh(data.wav, data.token || Date.now());
    return;
  }

    // DUNGEON LOADED — THE DEMON HAS SPOKEN
    if (data.type === 'dungeonLoaded') {
      (async () => {
        const dungeon = data.dungeon;
        const geoKey  = data.geoKey || currentDungeon?.geoKey;
    
        if (!geoKey) {
          console.warn('dungeonLoaded with no geoKey; using transient dungeon');
          currentDungeon = dungeon;
        } else {
          // 1️⃣ Check IndexedDB first
          const cached = await idbGetDungeon(geoKey);
          const cachedVersion = cached?._meta?.version || 0;
    
          if (cached && cachedVersion >= DUNGEON_CACHE_VERSION) {
            console.log('Loaded dungeon from IndexedDB:', geoKey);
            currentDungeon = cached;
          } else {
            if (cached) {
              console.log('Discarding outdated dungeon cache:', geoKey, 'version', cachedVersion);
            }
            console.log('Caching newly generated dungeon:', geoKey);
    
            dungeon.geoKey = geoKey;   // 🔑 attach before caching
            dungeon._meta = {
              version: DUNGEON_CACHE_VERSION,
              cachedAt: Date.now()
            };
    
            await idbSetDungeon(geoKey, dungeon);
            currentDungeon = dungeon;
          }
        }
    
        // 🔒 REINFORCE GEO KEY (covers cached + fresh + fallback)
        if (geoKey && currentDungeon) {
          currentDungeon.geoKey = geoKey;
          logDungeonLayout(currentDungeon);
        }
    
        // --- NORMAL FLOW CONTINUES ---
        const rawStart  = currentDungeon.start || { x: 10, y: 18 };
        const safeStart = findNearestWalkableStart(currentDungeon, rawStart);
    
        currentDungeon.start = safeStart;
        playerDungeonX = safeStart.x;
        playerDungeonY = safeStart.y;
        playerZInitialized = false;
        playerPosX = playerDungeonX + 0.5;
        playerPosY = playerDungeonY + 0.5;
    
        preloadDungeonTextures();
        updatePlayerHeightFromCell();
        renderDungeonView();
    
        // Combat overlay sync (unchanged)
        if (window.combatGame) {
          const scene = window.combatGame.scene.getScene('CombatScene');
          if (scene && scene.drawDungeonOverlay) {
            scene.drawDungeonOverlay();
          }
        }
      })();
        
    // Force player to center on first load too
    if (combatScene) {
      const pc = combatScene.characters[combatScene.pcName];
      if (pc) {
        pc.x = 7;
        pc.y = 7;
        pc.sprite.setPosition(7 * 25 + 12.5, 7 * 25 + 12.5);
        pc.label.setPosition(7 * 25 + 12.5, 7 * 25 + 32.5);
        combatScene.centerCameraOn(7, 7);
        combatScene.drawDungeonOverlay();
      }
    }

    // Also refresh the combat-map overlay if the scene is alive
    if (window.combatGame) {
      const scene = window.combatGame.scene.getScene('CombatScene');
      if (scene && scene.drawDungeonOverlay) {
        scene.drawDungeonOverlay();
      }
    }
    return;
  }

  // Existing combat map movement
  if (data.type === 'movement') {
    const { character, path } = data;
    path.forEach((step, index) => {
      setTimeout(() => updateCharacterPosition(character, step.x, step.y), index * 500);
    });
  } else if (data.type === 'final') {
        const { combatCharactersString } = data;
        const newCombatCharacters = JSON.parse(combatCharactersString);
        window.combatCharacters = newCombatCharacters;
        const combatScene = window.combatGame.scene.getScene('CombatScene');
        if (combatScene) combatScene.updatePositions(newCombatCharacters);
    } else if (data.type === 'target_prompt') {
        const { combatant, targets, positions } = data;
        showTargetSelectionPopup(combatant, targets, positions);
    } else if (data.type === 'combat_log') {
        const { log } = data;
        updateChatLog("<br><br>" + log.replace(/\n/g, "<br>"));
    }
};



// Function to show target selection popup
function showTargetSelectionPopup(combatant, targets, positions) {
    // Remove any existing popup
    const existingPopup = document.querySelector('.target-selection-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    // Create popup container
    const popup = document.createElement('div');
    popup.classList.add('target-selection-popup');
    popup.style.position = 'absolute';
    popup.style.top = '50%';
    popup.style.left = '50%';
    popup.style.transform = 'translate(-50%, -50%)';
    popup.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    popup.style.color = 'white';
    popup.style.padding = '20px';
    popup.style.border = '1px solid white';
    popup.style.borderRadius = '8px';
    popup.style.zIndex = '3000';
    popup.style.textAlign = 'center';

    // Add content
    popup.innerHTML = `
        <p>Select a target for ${combatant}:</p>
        <select id="target-select">
            ${targets.map((target, index) => {
                const pos = positions[index];
                return `<option value="${target}">${target} (x: ${pos.x}, y: ${pos.y})</option>`;
            }).join('')}
        </select>
        <br>
        <button class="popup-button" id="confirm-target">Confirm</button>
        <button class="popup-button" id="cancel-target">Cancel</button>
    `;

    document.body.appendChild(popup);

    // Style buttons
    const buttons = popup.querySelectorAll('.popup-button');
    buttons.forEach(button => {
        button.style.backgroundColor = '#444';
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.padding = '5px 10px';
        button.style.margin = '5px';
        button.style.cursor = 'pointer';
        button.style.borderRadius = '5px';
    });

    // Event listeners
    document.getElementById('confirm-target').addEventListener('click', () => {
        const selectedTarget = document.getElementById('target-select').value;
        sendTargetSelection(combatant, selectedTarget);
        popup.remove();
    });

    document.getElementById('cancel-target').addEventListener('click', () => {
        // Select a random target as fallback
        const randomTarget = targets[Math.floor(Math.random() * targets.length)];
        sendTargetSelection(combatant, randomTarget);
        popup.remove();
    });
}

// Function to send target selection to the server
function sendTargetSelection(combatant, target) {
    fetch('/submit-target2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            combatant: combatant,
            target: target
        })
    })
    .then(response => response.json())
    .then(data => console.log('Target selection submitted:', data))
    .catch(error => console.error('Error submitting target:', error));
}

// Function to update character position on the map
function updateCharacterPosition(characterName, x, y) {
    const combatScene = window.combatGame.scene.getScene('CombatScene');
    if (combatScene) {
        
        combatScene.sys.game.loop.wake();
        
        const charData = combatScene.characters[characterName];
        if (charData) {
            charData.x = x;
            charData.y = y;
           // charData.sprite.setPosition(x * 40 + 20, y * 40 + 20); // Adjust for grid cell size
          //  charData.label.setPosition(x * 40 + 20, y * 40 + 40);  // Adjust label position
            const cellSize = 25;

            charData.sprite.setPosition(x * cellSize + cellSize / 2,
                                        y * cellSize + cellSize / 2);
            charData.label.setPosition(x * cellSize + cellSize / 2,
                                       y * cellSize + cellSize / 2 + 20);
        }
        
        combatScene.time.delayedCall(100, () => {
            combatScene.sys.game.loop.sleep(); // Sleep after update
        });
    }
}

// Move the player by a delta — DUNGEON-CENTRIC (player stays centered in combat map)
function movePlayerByDelta(dx, dy) {
  const combatScene = window.combatGame && window.combatGame.scene.getScene('CombatScene');
  if (!combatScene || !combatScene.pcName || !combatScene.characters[combatScene.pcName]) {
    console.warn('movePlayerByDelta: no combatScene/pc yet');
    return;
  }
  if (!currentDungeon) {
    console.warn('movePlayerByDelta: no currentDungeon yet');
    return;
  }

  const cellSize = 25;
  const pcData = combatScene.characters[combatScene.pcName];

  // 1) Try to move in the DUNGEON (this is the source of truth)

  const proposedDungeonX = playerDungeonX + dx;
  const proposedDungeonY = playerDungeonY + dy;

  const keyTarget  = `${proposedDungeonX},${proposedDungeonY}`;
  const keyCurrent = `${playerDungeonX},${playerDungeonY}`;
  
  const targetCell  = currentDungeon.cells[keyTarget];
  const currentCell = currentDungeon.cells[keyCurrent];

  if (
    !targetCell ||
    targetCell.tile === 'wall'   ||
    targetCell.tile === 'torch'  ||
    targetCell.tile === 'pillar'
  ) {
    console.log('Blocked by wall');
    return;
  }

  if (targetCell.tile === 'door' && !targetCell.door?.isOpen) {
    console.log('Blocked by closed door');
    return;
  }

  // --- NEW: step-height limit for ramps/steps ---
  const currentFloor = currentCell && typeof currentCell.floorHeight === 'number'
    ? currentCell.floorHeight : 0;
  const targetFloor  = typeof targetCell.floorHeight === 'number'
    ? targetCell.floorHeight : 0;

  const MAX_STEP = 0.75; // max allowed height delta per move

  if (Math.abs(targetFloor - currentFloor) > MAX_STEP) {
    console.log('Too steep to move there');
    return;
  }
  
  // 2) SUCCESS — Update dungeon position (this shifts the world)
  // Movement is ok
  playerDungeonX = proposedDungeonX;
  playerDungeonY = proposedDungeonY;
  playerPosX = playerDungeonX + 0.5;
  playerPosY = playerDungeonY + 0.5;
  updatePlayerHeightFromCell();


/*  const proposedDungeonX = playerDungeonX + dx;
  const proposedDungeonY = playerDungeonY + dy;

  const targetCellKey = `${proposedDungeonX},${proposedDungeonY}`;
  const targetCell = currentDungeon.cells[targetCellKey];

  console.log('Dungeon move attempt:', { 
    from: { x: playerDungeonX, y: playerDungeonY },
    to: { x: proposedDungeonX, y: proposedDungeonY },
    dx, dy,
    cell: targetCell
  });

  // Block move if wall or out of bounds
  if (!targetCell || targetCell.tile === 'wall') {
    console.log('Move blocked: wall or void');
    return;
  }

  playerDungeonX = proposedDungeonX;
  playerDungeonY = proposedDungeonY;*/

  // 3) COMBAT MAP: Player stays FIXED in the center (7,7 on 15x15 grid)
  const CENTER_X = 7;
  const CENTER_Y = 7;

  pcData.x = CENTER_X;
  pcData.y = CENTER_Y;

  pcData.sprite.setPosition(
    CENTER_X * cellSize + cellSize / 2,
    CENTER_Y * cellSize + cellSize / 2
  );
  pcData.label.setPosition(
    CENTER_X * cellSize + cellSize / 2,
    CENTER_Y * cellSize + cellSize / 2 + 20
  );

  // Keep camera centered on player
  combatScene.centerCameraOn(CENTER_X, CENTER_Y);

  // Sync global combatCharacters (for server & other logic)
  const pcGlobal = window.combatCharacters && window.combatCharacters.find(c => c.type === 'pc');
  if (pcGlobal) {
    pcGlobal.x = CENTER_X;
    pcGlobal.y = CENTER_Y;
  }

  // Optional: wake/sleep loop if you're using it for performance
  combatScene.sys.game.loop.wake();
  combatScene.time.delayedCall(100, () => {
    combatScene.sys.game.loop.sleep();
  });
  
    // NEW: update facing based on movement direction
    if (dx !== 0 || dy !== 0) {
      playerAngle = Math.atan2(dy, dx);
      window.playerAngle = playerAngle; // optional, if you exposed it
    }

  // 4) Redraw both views — dungeon shifts, combat overlay shifts, player stays put
  renderDungeonView();
  logDungeonCombatSync('sse');
  if (combatScene.drawDungeonOverlay) {
    combatScene.drawDungeonOverlay();
  }

  console.log('Player moved in dungeon. Combat player pinned to center. Views updated.');
}

const DUNGEON_MOVE = {
  velX: 0,
  velY: 0,
  lastTime: 0,
  active: false,
  raf: 0,
  keys: {
    forward: false,
    backward: false,
    left: false,
    right: false,
    strafeLeft: false,
    strafeRight: false,
    run: false
  }
};

const MOVE_ACCEL = 6.0;
const MOVE_MAX_SPEED = 3.2;
const MOVE_FRICTION = 10.0;
const TURN_SPEED = 2.6;
const SNAP_SPEED = 6.0;
const STOP_EPS = 0.01;
const MAX_STEP = 0.75;
const PLAYER_RADIUS = 0.2;
const Z_SMOOTH = 8.0;
const RUN_MULT = 1.6;

function isBlockedDungeonCell(cell) {
  if (!cell) return true;
  if (cell.tile === 'wall' || cell.tile === 'torch' || cell.tile === 'pillar') return true;
  if (cell.tile === 'door' && !cell.door?.isOpen) return true;
  return false;
}

function canEnterTile(fromX, fromY, toX, toY) {
  if (!currentDungeon || !currentDungeon.cells) return false;
  if (fromX === toX && fromY === toY) return true;
  const targetCell = currentDungeon.cells[`${toX},${toY}`];
  if (!targetCell || isBlockedDungeonCell(targetCell)) return false;
  const currentCell = currentDungeon.cells[`${fromX},${fromY}`] || {};
  const currentFloor = typeof currentCell.floorHeight === 'number' ? currentCell.floorHeight : 0;
  const targetFloor = typeof targetCell.floorHeight === 'number' ? targetCell.floorHeight : 0;
  return Math.abs(targetFloor - currentFloor) <= MAX_STEP;
}

function findNearestUnblockedTile(dungeon, start, maxRadius = 25) {
  if (!dungeon || !dungeon.cells) return start || { x: 0, y: 0 };
  const sx = (start && Number.isFinite(start.x)) ? start.x : 0;
  const sy = (start && Number.isFinite(start.y)) ? start.y : 0;
  const key = (x, y) => `${x},${y}`;
  const visited = new Set([key(sx, sy)]);
  const queue = [{ x: sx, y: sy, dist: 0 }];
  let nearest = null;

  while (queue.length) {
    const { x, y, dist } = queue.shift();
    const cell = dungeon.cells[key(x, y)];
    if (cell && !isBlockedDungeonCell(cell)) {
      nearest = { x, y };
      break;
    }
    if (dist >= maxRadius) continue;
    queue.push({ x: x + 1, y, dist: dist + 1 });
    queue.push({ x: x - 1, y, dist: dist + 1 });
    queue.push({ x, y: y + 1, dist: dist + 1 });
    queue.push({ x, y: y - 1, dist: dist + 1 });
  }

  if (nearest) return nearest;
  if (dungeon.start && Number.isFinite(dungeon.start.x) && Number.isFinite(dungeon.start.y)) {
    return { x: dungeon.start.x, y: dungeon.start.y };
  }
  return { x: sx, y: sy };
}

function canOccupyPos(nextX, nextY) {
  const currX = playerPosX;
  const currY = playerPosY;
  const offsets = [
    [PLAYER_RADIUS, PLAYER_RADIUS],
    [-PLAYER_RADIUS, PLAYER_RADIUS],
    [PLAYER_RADIUS, -PLAYER_RADIUS],
    [-PLAYER_RADIUS, -PLAYER_RADIUS],
    [PLAYER_RADIUS, 0],
    [-PLAYER_RADIUS, 0],
    [0, PLAYER_RADIUS],
    [0, -PLAYER_RADIUS]
  ];
  for (const [ox, oy] of offsets) {
    const fromX = Math.floor(currX + ox);
    const fromY = Math.floor(currY + oy);
    const toX = Math.floor(nextX + ox);
    const toY = Math.floor(nextY + oy);
    if (!canEnterTile(fromX, fromY, toX, toY)) return false;
  }
  return true;
}

function ensurePlayerOnValidTile() {
  if (!currentDungeon || !currentDungeon.cells) return false;
  let adjusted = false;

  if (!Number.isFinite(playerPosX) || !Number.isFinite(playerPosY)) {
    playerPosX = playerDungeonX + 0.5;
    playerPosY = playerDungeonY + 0.5;
    adjusted = true;
  }

  const tileX = Math.floor(playerPosX);
  const tileY = Math.floor(playerPosY);
  const cell = currentDungeon.cells[`${tileX},${tileY}`];

  if (!cell || isBlockedDungeonCell(cell)) {
    const safe = findNearestUnblockedTile(currentDungeon, { x: tileX, y: tileY });
    playerDungeonX = safe.x;
    playerDungeonY = safe.y;
    playerPosX = safe.x + 0.5;
    playerPosY = safe.y + 0.5;
    DUNGEON_MOVE.velX = 0;
    DUNGEON_MOVE.velY = 0;
    updatePlayerHeightFromCell();
    syncCombatPlayerCenter();
    return true;
  }

  return adjusted;
}

function syncCombatPlayerCenter() {
  const combatScene = window.combatGame && window.combatGame.scene.getScene('CombatScene');
  if (!combatScene || !combatScene.pcName || !combatScene.characters[combatScene.pcName]) return;
  const pcData = combatScene.characters[combatScene.pcName];
  const cellSize = 25;
  const CENTER_X = 7;
  const CENTER_Y = 7;

  pcData.x = CENTER_X;
  pcData.y = CENTER_Y;
  pcData.sprite.setPosition(
    CENTER_X * cellSize + cellSize / 2,
    CENTER_Y * cellSize + cellSize / 2
  );
  pcData.label.setPosition(
    CENTER_X * cellSize + cellSize / 2,
    CENTER_Y * cellSize + cellSize / 2 + 20
  );
  combatScene.centerCameraOn(CENTER_X, CENTER_Y);

  const pcGlobal = window.combatCharacters && window.combatCharacters.find(c => c.type === 'pc');
  if (pcGlobal) {
    pcGlobal.x = CENTER_X;
    pcGlobal.y = CENTER_Y;
  }

  if (combatScene.domContainer) {
    const gridSize = combatScene.gridSize || 15;
    const gridPx = gridSize * cellSize;
    const viewW = combatScene.domContainer.clientWidth;
    const viewH = combatScene.domContainer.clientHeight;
    const targetX = CENTER_X * cellSize + cellSize / 2;
    const targetY = CENTER_Y * cellSize + cellSize / 2;
    const maxScrollX = Math.max(0, gridPx - viewW);
    const maxScrollY = Math.max(0, gridPx - viewH);
    const scrollLeft = Math.max(0, Math.min(maxScrollX, targetX - viewW / 2));
    const scrollTop = Math.max(0, Math.min(maxScrollY, targetY - viewH / 2));
    combatScene.domContainer.scrollLeft = scrollLeft;
    combatScene.domContainer.scrollTop = scrollTop;
  }
}

function syncPlayerTileFromPos() {
  const nextTileX = Math.floor(playerPosX);
  const nextTileY = Math.floor(playerPosY);
  if (nextTileX === playerDungeonX && nextTileY === playerDungeonY) return false;
  playerDungeonX = nextTileX;
  playerDungeonY = nextTileY;
  updatePlayerHeightFromCell();
  syncCombatPlayerCenter();
  logDungeonCombatSync('move');
  if (window.combatGame) {
    const scene = window.combatGame.scene.getScene('CombatScene');
    if (scene && scene.drawDungeonOverlay) {
      scene.drawDungeonOverlay();
    }
  }
  return true;
}

function getPlayerPosForMap() {
  const px = Number.isFinite(playerPosX) ? playerPosX : playerDungeonX + 0.5;
  const py = Number.isFinite(playerPosY) ? playerPosY : playerDungeonY + 0.5;
  return { x: px, y: py };
}

function updateDungeonMovement(now) {
  if (!currentDungeon) return false;
  if (ensurePlayerOnValidTile()) {
    renderDungeonView();
  }
  if (!DUNGEON_MOVE.lastTime) DUNGEON_MOVE.lastTime = now;
  const dt = Math.min(0.05, (now - DUNGEON_MOVE.lastTime) / 1000);
  DUNGEON_MOVE.lastTime = now;

  const leftRight = (DUNGEON_MOVE.keys.right ? 1 : 0) - (DUNGEON_MOVE.keys.left ? 1 : 0);
  const turnInput = leftRight;
  if (turnInput !== 0) {
    playerAngle += turnInput * TURN_SPEED * dt;
  }

  const moveInput = (DUNGEON_MOVE.keys.forward ? 1 : 0) - (DUNGEON_MOVE.keys.backward ? 1 : 0);
  const strafeInput = (DUNGEON_MOVE.keys.strafeRight ? 1 : 0) - (DUNGEON_MOVE.keys.strafeLeft ? 1 : 0);
  const runMult = DUNGEON_MOVE.keys.run ? RUN_MULT : 1.0;
  const dirX = Math.cos(playerAngle);
  const dirY = Math.sin(playerAngle);
  const strafeX = -dirY;
  const strafeY = dirX;

  if (moveInput !== 0 || strafeInput !== 0) {
    const ax = (dirX * moveInput + strafeX * strafeInput) * MOVE_ACCEL * runMult;
    const ay = (dirY * moveInput + strafeY * strafeInput) * MOVE_ACCEL * runMult;
    DUNGEON_MOVE.velX += ax * dt;
    DUNGEON_MOVE.velY += ay * dt;
  } else {
    const speed = Math.hypot(DUNGEON_MOVE.velX, DUNGEON_MOVE.velY);
    if (speed > 0) {
      const drop = MOVE_FRICTION * dt;
      const newSpeed = Math.max(0, speed - drop);
      const scale = newSpeed / speed;
      DUNGEON_MOVE.velX *= scale;
      DUNGEON_MOVE.velY *= scale;
    }
  }

  const speed = Math.hypot(DUNGEON_MOVE.velX, DUNGEON_MOVE.velY);
  const maxSpeed = MOVE_MAX_SPEED * runMult;
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    DUNGEON_MOVE.velX *= scale;
    DUNGEON_MOVE.velY *= scale;
  }

  let nextX = playerPosX;
  let nextY = playerPosY;
  if (Math.abs(DUNGEON_MOVE.velX) > 0) {
    const candX = playerPosX + DUNGEON_MOVE.velX * dt;
    if (canOccupyPos(candX, playerPosY)) {
      nextX = candX;
    } else {
      DUNGEON_MOVE.velX = 0;
    }
  }
  if (Math.abs(DUNGEON_MOVE.velY) > 0) {
    const candY = playerPosY + DUNGEON_MOVE.velY * dt;
    if (canOccupyPos(nextX, candY)) {
      nextY = candY;
    } else {
      DUNGEON_MOVE.velY = 0;
    }
  }

  playerPosX = nextX;
  playerPosY = nextY;

  const speedAfter = Math.hypot(DUNGEON_MOVE.velX, DUNGEON_MOVE.velY);
  if (Number.isFinite(playerZTarget)) {
    if (!Number.isFinite(playerZ)) playerZ = playerZTarget;
    const zSmooth = Number.isFinite(window.WEBGL_Z_SMOOTH) ? window.WEBGL_Z_SMOOTH : Z_SMOOTH;
    const zLerp = 1 - Math.exp(-zSmooth * dt);
    playerZ += (playerZTarget - playerZ) * zLerp;
  }
  /*if (moveInput === 0 && speedAfter < 0.05) {
    const centerX = Math.floor(playerPosX) + 0.5;
    const centerY = Math.floor(playerPosY) + 0.5;
    const dx = centerX - playerPosX;
    const dy = centerY - playerPosY;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.001) {
      const step = Math.min(dist, SNAP_SPEED * dt);
      playerPosX += (dx / dist) * step;
      playerPosY += (dy / dist) * step;
    } else {
      playerPosX = centerX;
      playerPosY = centerY;
    }
  }*/

  syncPlayerTileFromPos();
  window.playerAngle = playerAngle;
  window.playerPosX = playerPosX;
  window.playerPosY = playerPosY;
  window.playerZ = playerZ;
  renderDungeonView();
  if (window.combatGame) {
    const scene = window.combatGame.scene.getScene('CombatScene');
    if (scene && scene.sys && scene.sys.game && scene.sys.game.loop) {
      scene.sys.game.loop.wake();
      if (scene.drawDungeonOverlay) {
        scene.drawDungeonOverlay();
      }
      if (scene._movementSleepTimer) {
        scene._movementSleepTimer.remove(false);
        scene._movementSleepTimer = null;
      }
    }
  }

  const centerDx = (Math.floor(playerPosX) + 0.5) - playerPosX;
  const centerDy = (Math.floor(playerPosY) + 0.5) - playerPosY;
  const stillSnapping = moveInput === 0 && strafeInput === 0 && speedAfter < 0.05 && Math.hypot(centerDx, centerDy) > 0.001;
  const zDelta = Number.isFinite(playerZTarget) ? Math.abs(playerZTarget - playerZ) : 0;
  return (
    moveInput !== 0 ||
    strafeInput !== 0 ||
    speedAfter > STOP_EPS ||
    turnInput !== 0 ||
    stillSnapping ||
    zDelta > 0.001
  );
}

function startDungeonMovementLoop() {
  if (DUNGEON_MOVE.active) return;
  DUNGEON_MOVE.active = true;
  DUNGEON_MOVE.lastTime = performance.now();
  if (window.combatGame) {
    const scene = window.combatGame.scene.getScene('CombatScene');
    if (scene && scene.sys && scene.sys.game && scene.sys.game.loop) {
      scene.sys.game.loop.wake();
    }
  }
  const step = (now) => {
    if (!DUNGEON_MOVE.active) return;
    const keepGoing = updateDungeonMovement(now);
    if (keepGoing) {
      DUNGEON_MOVE.raf = requestAnimationFrame(step);
    } else {
      DUNGEON_MOVE.active = false;
      DUNGEON_MOVE.raf = 0;
      if (window.combatGame) {
        const scene = window.combatGame.scene.getScene('CombatScene');
        if (scene && scene.time && scene.sys && scene.sys.game && scene.sys.game.loop) {
          scene._movementSleepTimer = scene.time.delayedCall(80, () => {
            scene.sys.game.loop.sleep();
            scene._movementSleepTimer = null;
          });
        }
      }
    }
  };
  DUNGEON_MOVE.raf = requestAnimationFrame(step);
}

class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
    }

    preload() {
        // Preload assets if needed
    }

    create(data) {
        
        this.input.setDefaultCursor('pointer');
        // Remove previous popup if it exists
        const existingPopup = document.getElementById('game-popup');
        if (existingPopup) {
            existingPopup.remove();
        }
                // Safely use the passed data or set defaults
        const roomName = data?.roomName || "Ruined Temple Entrance";
        const roomDescription = data?.roomDescription || "You find yourself standing in the first room of the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels and powerful demons...";
        const coordinates = data?.coordinates || "None";
        const objects = data?.objects || "None";
        // Render clickable objects
        const objectsInRoomProperties = data?.objectsInRoomProperties || "None";
        const exits = data?.exits || "None";
        const pc = data?.pc || "No PC data";
        const npcs = data?.npcs || "None";
        const inventory = data?.inventory || "Empty";
        const inventoryProperties = data?.inventoryProperties || "None";
        const monsters = data?.monsters || "None";
        const monstersState = data?.monstersState || "None";
        const puzzle = data?.puzzle || { inRoom: "No puzzle", solution: "No solution" };
        const currentQuest = data?.currentQuest || "None";
        const nextArtifact = data?.nextArtifact || "None";
        const nextBoss = data?.nextBoss || "None";
        const nextBossRoom = data?.nextBossRoom || "None";
        const bossCoordinates = data?.bossCoordinates || "None";
        const adjacentRooms = data?.adjacentRooms || "None";
        
        // In MainScene create method, before constructing fullText
        const imageHtml = (window.roomImages && window.roomImages[coordinates]) ? `<img src="${window.roomImages[coordinates]}" alt="Room Image" style="max-width:100%;"><br>` : `<img src="https://childrenofthegrave.com/test22/Tartarus.png" alt="Default Room Image" style="max-width:100%;"><br>`;
        
        let exitsHtml = exits;
        if (exits !== "None") {
            const exitList = exits.split(", ");
            exitsHtml = exitList.map(exit => `<span class="clickable-exit" data-exit="${exit}">${exit}</span>`).join(", ");
        }
        
        let objectsHtml = objects;
        if (objects !== "None") {
            const objectList = objects.split(", ");
            objectsHtml = objectList.map(object => `<span class="clickable-object" data-object="${object}">${object}</span>`).join(", ");
        }
        
        let inventoryHtml = inventory;
        if (inventory !== "Empty") {
            const inventoryList = inventory.split(", ");
            inventoryHtml = inventoryList.map(item => `<span class="clickable-inventory" data-object="${item}">${item}</span>`).join(", ");
        }
        
        let pcHtml = pc;
        if (pc !== "No PC data") {
            const pcName = pc.split("\n")[0]; // Get PC name
            const pcLines = pc.split("\n").map(line => line.trim()).filter(line => line); // Clean up and split into lines
            const pcEquippedLine = pc.match(/Equipped: (.+)/)?.[1]; // Extract the Equipped line
        
            let updatedPcBlock = pcLines.join("\n"); // Remove extra whitespace and reformat
        
            if (pcEquippedLine) {
                // Replace items in the Equipped line with clickable spans
                const clickableEquippedLine = pcEquippedLine.split(", ").map(item => {
                    const [slot, itemName] = item.split(":").map(part => part.trim());
                    if (itemName !== "None") {
                        return `${slot}: <span class="clickable-equipped" data-item="${itemName}" data-character="${pcName}">${itemName}</span>`;
                    }
                    return `${slot}: None`;
                }).join(", ");
        
                // Replace the Equipped line in the PC block
                updatedPcBlock = updatedPcBlock.replace(/Equipped: .+/, `Equipped: ${clickableEquippedLine}`);
            }
        
            // Wrap the PC block in a div with a class for indentation
            pcHtml = `<div class="pc-block">${updatedPcBlock}</div>`;
        }
        
        let npcsHtml = npcs;
        if (npcs !== "None") {
            const npcLines = npcs.split("\n").map(line => line.trim()).filter(line => line); // Clean up and split into lines
            const indentedNpcBlocks = []; // Array to hold NPC blocks with indentation
        
            for (let i = 0; i < npcLines.length; i += 14) {
                const npcBlock = npcLines.slice(i, i + 14).join("\n"); // Get the full block of NPC data
                const npcName = npcLines[i]; // NPC name is the first line of the block
                const npcEquippedLine = npcBlock.match(/Equipped: (.+)/)?.[1]; // Extract Equipped line
        
                let updatedNpcBlock = npcBlock;
        
                // Make the NPC name clickable
                const clickableNpcName = `<span class="clickable-npc" data-npc="${npcName}">${npcName}</span>`;
                updatedNpcBlock = updatedNpcBlock.replace(npcName, clickableNpcName);
        
                if (npcEquippedLine) {
                    // Replace items in the Equipped line with clickable spans
                    const clickableEquippedLine = npcEquippedLine.split(", ").map(item => {
                        const [slot, itemName] = item.split(":").map(part => part.trim());
                        if (itemName !== "None") {
                            return `${slot}: <span class="clickable-equipped" data-item="${itemName}" data-character="${npcName}">${itemName}</span>`;
                        }
                        return `${slot}: None`;
                    }).join(", ");
        
                    // Replace the Equipped line in the NPC block
                    updatedNpcBlock = updatedNpcBlock.replace(/Equipped: .+/, `Equipped: ${clickableEquippedLine}`);
                }
        
                // Wrap the updated NPC block in a div with a class for indentation
                indentedNpcBlocks.push(`<div class="npc-block">${updatedNpcBlock}</div>`);
            }
        
            // Combine the indented NPC blocks with the NPCs header
            npcsHtml = `${indentedNpcBlocks.join("\n")}`;
        }

        let monstersHtml = monsters;
        if (monsters !== "None") {
            const monsterLines = monsters.split("\n").map(line => line.trim()).filter(line => line); // Clean up and split into lines
            const indentedMonsterBlocks = []; // Array to hold monster blocks with indentation
        
            for (let i = 0; i < monsterLines.length; i += 14) {
                const monsterBlock = monsterLines.slice(i, i + 14).join("\n"); // Get the full block of monster data
                const monsterName = monsterLines[i]; // Monster name is the first line of the block
        
                // Make the monster name clickable
                const clickableMonsterName = `<span class="clickable-monster" data-monster="${monsterName}">${monsterName}</span>`;
                const updatedMonsterBlock = monsterBlock.replace(monsterName, clickableMonsterName);
        
                // Wrap the updated monster block in a div with a class for indentation
                indentedMonsterBlocks.push(`<div class="monster-block">${updatedMonsterBlock}</div>`);
            }
        
            monstersHtml = indentedMonsterBlocks.join("\n"); // Combine the blocks
        }

        // Combine all data into a single string for display
        const fullText = `
Room: ${roomName}

${imageHtml} 

Room Description: ${roomDescription}

Coordinates: ${coordinates}

Exits: ${exitsHtml}

Objects in Room: ${objectsHtml}

Objects in Room Properties: ${objectsInRoomProperties}

Inventory: ${inventoryHtml}

Inventory Properties: ${inventoryProperties}

PC:
${pcHtml}

NPCs:
${npcsHtml}

Monsters in Room:
${monstersHtml}

Monsters State: ${monstersState}

Puzzle: ${puzzle.inRoom}

Solution: ${puzzle.solution}

Current Quest: ${currentQuest}

Next Artifact: ${nextArtifact}

Next Boss: ${nextBoss}

Next Boss Room: ${nextBossRoom}

Boss Room Coordinates: ${bossCoordinates}

Adjacent Rooms:
${adjacentRooms}
        `;

        // Get the popup div
        const popupDiv = document.getElementById('phaser-popup');
        const contentDiv = document.getElementById('phaser-container');
    
        // Update the content inside the popup
        contentDiv.innerHTML = fullText;
    
        // Add event listener to clickable objects inside contentDiv
        contentDiv.addEventListener('click', (event) => {
            const target = event.target;
            if (target.classList.contains('clickable-object')) {
                const objectName = target.getAttribute('data-object');
                console.log(`Clicked on object: ${objectName}`);
        
                // Remove any existing popup
                const existingPopup = document.querySelector('.popup-container');
                if (existingPopup) {
                    existingPopup.remove();
                }
        
                // Create the popup container
                const popup = document.createElement('div');
                popup.classList.add('popup-container');
        
                // Add popup content
                popup.innerHTML = `
                    <p>Take ${objectName}?</p>
                    <button class="popup-button" id="take-button">Take</button>
                    <button class="popup-button" id="cancel-button">Cancel</button>
                `;
        
                // Append the popup to the body
                document.body.appendChild(popup);
        
                // Add event listeners for buttons
                document.getElementById('take-button').addEventListener('click', () => {
                    const chatInput = document.getElementById('chatuserinput');
                    chatInput.value = `take ${objectName}`;
                    chatbotprocessinput(); // Process the "take" command
                    popup.remove(); // Remove the popup
                });
        
                document.getElementById('cancel-button').addEventListener('click', () => {
                    popup.remove(); // Remove the popup
                });
            }
        });
        
                // Add event listener to clickable objects inside contentDiv
        contentDiv.addEventListener('click', (event) => {
            const target = event.target;
            if (target.classList.contains('clickable-inventory')) {
                const objectName = target.getAttribute('data-object');
                console.log(`Clicked on object: ${objectName}`);
        
                // Remove any existing popup
                const existingPopup = document.querySelector('.popup-container');
                if (existingPopup) {
                    existingPopup.remove();
                }
        
                // Create the popup container
                const popup = document.createElement('div');
                popup.classList.add('popup-container');
        
                // Add popup content
                popup.innerHTML = `
                    <p>Drop or Equip ${objectName}?</p>
                    <button class="popup-button" id="drop-button">Drop</button>
                    <button class="popup-button" id="equip-button">Equip</button>
                    <button class="popup-button" id="cancel-button">Cancel</button>
                `;
        
                // Append the popup to the body
                document.body.appendChild(popup);
        
                // Add event listeners for buttons
                document.getElementById('drop-button').addEventListener('click', () => {
                    const chatInput = document.getElementById('chatuserinput');
                    chatInput.value = `drop ${objectName}`;
                    chatbotprocessinput(); // Process the "take" command
                    popup.remove(); // Remove the popup
                });
               
                document.getElementById('equip-button').addEventListener('click', () => {
                    // Remove the current popup
                    popup.remove();
               
                    // Get PC and NPC names for the dropdown
                    const characters = [];
                    let pcName = null;
                    if (pc !== "No PC data") {
                        pcName = pc.split("\n")[0]; // Extract PC name
                        characters.push(pcName);
                    }
                    if (npcs !== "None") {
                        const npcLines = npcs.split("\n").map(line => line.trim()).filter(line => line); // Split into lines and clean up
                        for (let i = 0; i < npcLines.length; i += 14) {
                            characters.push(npcLines[i]); // Every 14th line is the name
                        }
                    }
               
                    // Create a new popup for character selection
                    const characterPopup = document.createElement('div');
                    characterPopup.classList.add('popup-container');
               
                    // Add dropdown content
                    const characterOptions = characters.map(name => `<option value="${name}">${name}</option>`).join("");
                    characterPopup.innerHTML = `
                        <p>Select a character to equip ${objectName}:</p>
                        <select id="character-select">${characterOptions}</select>
                        <button class="popup-button" id="confirm-equip">Equip</button>
                        <button class="popup-button" id="cancel-equip">Cancel</button>
                    `;
               
                    // Append the new popup to the body
                    document.body.appendChild(characterPopup);
               
                    // Add event listeners for buttons
                    document.getElementById('confirm-equip').addEventListener('click', () => {
                        const selectedCharacter = document.getElementById('character-select').value;
                        const chatInput = document.getElementById('chatuserinput');
               
                        // Determine if equipping the PC or an NPC
                        if (selectedCharacter === pcName) {
                            chatInput.value = `equip ${objectName}`; // Command for PC
                        } else {
                            chatInput.value = `equip ${objectName} to ${selectedCharacter}`; // Command for NPC
                        }
               
                        chatbotprocessinput(); // Process the "equip" command
                        characterPopup.remove(); // Remove the character selection popup
                    });
               
                    document.getElementById('cancel-equip').addEventListener('click', () => {
                        characterPopup.remove(); // Remove the character selection popup
                    });
                });
               
                document.getElementById('cancel-button').addEventListener('click', () => {
                    popup.remove(); // Remove the popup
                });
            }
        });
       
        contentDiv.addEventListener("click", (event) => {
            const target = event.target;
            if (target.classList.contains("clickable-equipped")) {
                const itemName = target.getAttribute("data-item");
                const characterName = target.getAttribute("data-character");
                console.log(`Clicked on equipped item: ${itemName} from ${characterName}`);
       
                // Remove any existing popup
                const existingPopup = document.querySelector(".popup-container");
                if (existingPopup) {
                    existingPopup.remove();
                }
       
                // Create the popup container
                const popup = document.createElement("div");
                popup.classList.add("popup-container");
                popup.innerHTML = `
                    <p>Unequip ${itemName}?</p>
                    <button class="popup-button" id="unequip-button">Unequip</button>
                    <button class="popup-button" id="cancel-button">Cancel</button>
                `;
                document.body.appendChild(popup);
       
                // Remove existing event listeners if buttons already exist
                const unequipButton = document.getElementById("unequip-button");
                const cancelButton = document.getElementById("cancel-button");
       
                if (unequipButton) {
                    unequipButton.replaceWith(unequipButton.cloneNode(true)); // Replace the button to remove old listeners
                }
                if (cancelButton) {
                    cancelButton.replaceWith(cancelButton.cloneNode(true)); // Replace the button to remove old listeners
                }
       
                // Attach new event listeners to buttons
                document.getElementById("unequip-button").addEventListener("click", () => {
                    const chatInput = document.getElementById("chatuserinput");
                    if (characterName === pc.split("\n")[0]) {
                        chatInput.value = `unequip ${itemName}`;
                    } else {
                        chatInput.value = `unequip ${itemName} from ${characterName}`;
                    }
                    chatbotprocessinput(); // Send the unequip command
                    popup.remove(); // Remove the popup
                });
       
                document.getElementById("cancel-button").addEventListener("click", () => {
                    popup.remove(); // Remove the popup
                });
            }
        });
        contentDiv.addEventListener("click", (event) => {
            const target = event.target;
            if (target.classList.contains("clickable-npc")) {
                const npcName = target.getAttribute("data-npc");
                console.log(`Clicked on NPC: ${npcName}`);
       
                // Remove any existing popup
                const existingPopup = document.querySelector(".popup-container");
                if (existingPopup) {
                    existingPopup.remove();
                }
       
                // Create the confirmation popup
                const popup = document.createElement("div");
                popup.classList.add("popup-container");
       
                // Add popup content
                popup.innerHTML = `
                    <p>Remove ${npcName} from the party?</p>
                    <button class="popup-button" id="remove-button">Remove</button>
                    <button class="popup-button" id="cancel-button">Cancel</button>
                `;
       
                // Append the popup to the body
                document.body.appendChild(popup);
       
                // Add event listeners for buttons
                document.getElementById("remove-button").addEventListener("click", () => {
                    const chatInput = document.getElementById("chatuserinput");
                    chatInput.value = `remove ${npcName} from party`; // Command to remove NPC
                    chatbotprocessinput(); // Process the command
                    popup.remove(); // Remove the popup
                });
       
                document.getElementById("cancel-button").addEventListener("click", () => {
                    popup.remove(); // Remove the popup
                });
            }
        });
       
        contentDiv.addEventListener("click", (event) => {
            const target = event.target;
            if (target.classList.contains("clickable-monster")) {
                const monsterName = target.getAttribute("data-monster");
                console.log(`Clicked on monster: ${monsterName}`);
       
                // Remove any existing popup
                const existingPopup = document.querySelector(".popup-container");
                if (existingPopup) {
                    existingPopup.remove();
                }
       
                // Create the confirmation popup
                const popup = document.createElement("div");
                popup.classList.add("popup-container");
       
                // Add popup content with both "Add" and "Attack" options
                popup.innerHTML = `
                    <p>What would you like to do with ${monsterName}?</p>
                    <button class="popup-button" id="add-button">Add to Party</button>
                    <button class="popup-button" id="attack-button">Attack</button>
                    <button class="popup-button" id="cancel-button">Cancel</button>
                `;
       
                // Append the popup to the body
                document.body.appendChild(popup);
       
                // Add event listeners for buttons
                document.getElementById("add-button").addEventListener("click", () => {
                    const chatInput = document.getElementById("chatuserinput");
                    chatInput.value = `add ${monsterName} to party`; // Command to add monster
                    chatbotprocessinput(); // Process the command
                    popup.remove(); // Remove the popup
                });
       
                document.getElementById("attack-button").addEventListener("click", () => {
                    const chatInput = document.getElementById("chatuserinput");
                    chatInput.value = `attack ${monsterName}`; // Command to attack monster
                    chatbotprocessinput(); // Process the command
                    popup.remove(); // Remove the popup
                });
       
                document.getElementById("cancel-button").addEventListener("click", () => {
                    popup.remove(); // Remove the popup
                });
            }
        });
        
        // ---- Exit click handler (equip-style flow; Unlock only when locked) ----
        contentDiv.addEventListener("click", (event) => {
          const target = event.target;
          if (!target.classList.contains("clickable-exit")) return;
        
          const exitDirection = target.getAttribute("data-exit");
          console.log(`Clicked on exit: ${exitDirection}`);
        
          // Remove any existing popup
          const existingPopup = document.querySelector(".popup-container");
          if (existingPopup) existingPopup.remove();
        
          // Resolve current room + exit status
          const coordKey = coordinatesToString(currentCoordinates);
          const currentRoom = roomNameDatabase.get(coordKey);
          const exitData = currentRoom && currentRoom.exits ? currentRoom.exits[exitDirection] : null;
        
          // Consider anything not "open" as locked (e.g., "sealed", "locked", etc.)
          const isLocked = !!(exitData && String(exitData.status || "").toLowerCase() !== "open");
          const requiredKeyHint = isLocked && exitData && exitData.key
            ? `<div style="margin:4px 0 8px 0;opacity:.85;">Requires: ${exitData.key}</div>`
            : "";
        
          // Create the popup container
          const popup = document.createElement("div");
          popup.classList.add("popup-container");
        
          // Base popup (Go / [Unlock] / Cancel). Unlock appears only when isLocked = true
          popup.innerHTML = `
            <p>Go ${exitDirection}?</p>
            <button class="popup-button" id="go-button">Go</button>
            ${isLocked ? `<button class="popup-button" id="unlock-button">Unlock</button>` : ""}
            <button class="popup-button" id="cancel-button">Cancel</button>
          `;
          document.body.appendChild(popup);
        
          // Go -> move
          document.getElementById("go-button").addEventListener("click", () => {
            const chatInput = document.getElementById("chatuserinput");
            chatInput.value = `${exitDirection}`;
            chatbotprocessinput();
            popup.remove();
          });
        
          // Unlock -> open inventory picker (same UX as Equip: second popup with <select>)
          const unlockBtn = document.getElementById("unlock-button");
          if (unlockBtn) {
            unlockBtn.addEventListener("click", () => {
              popup.remove();
        
              // Build inventory from updatedData + live fallback
              const updated = (window.latestUpdatedData && typeof window.latestUpdatedData.inventory === "string")
                ? window.latestUpdatedData.inventory
                : "";
              const fromUpdated = updated && updated.toLowerCase() !== "none"
                ? updated.split(", ").map(s => s.trim())
                : [];
              const live = Array.isArray(window.inventory)
                ? window.inventory.map(s => String(s).trim())
                : [];
              const inv = [...new Set([...live, ...fromUpdated].filter(s => s && s.toLowerCase() !== "none"))];
        
              const invPopup = document.createElement("div");
              invPopup.classList.add("popup-container");
              const options = inv.length
                ? inv.map(name => `<option value="${name.replace(/"/g, "&quot;")}">${name}</option>`).join("")
                : "";
        
              invPopup.innerHTML = `
                <p>Select an item to unlock ${exitDirection}:</p>
                <select id="inventory-select">${options}</select>
                <button class="popup-button" id="confirm-unlock"${inv.length ? "" : " disabled"}>Unlock</button>
                <button class="popup-button" id="cancel-unlock">Cancel</button>
                ${inv.length ? "" : '<div style="margin-top:8px;opacity:.85;">Your inventory is empty.</div>'}
              `;
              document.body.appendChild(invPopup);
        
              const confirm = document.getElementById("confirm-unlock");
              if (confirm) {
                confirm.addEventListener("click", () => {
                  const selected = document.getElementById("inventory-select").value;
                  const chatInput = document.getElementById("chatuserinput");
                  chatInput.value = `open door with ${selected}`;
                  chatbotprocessinput();
                  invPopup.remove();
                });
              }
              document.getElementById("cancel-unlock").addEventListener("click", () => invPopup.remove());
            });
          }
        
          // Cancel -> close
          document.getElementById("cancel-button").addEventListener("click", () => popup.remove());
        });
        // ---- End exit click handler ----

        let characters = [];
       /* if (pc && pc !== 'No PC data') {
            let pcName = pc.split('\n')[0];
            characters.push({ name: pcName, type: 'pc' });
        }*/
        if (pc && pc !== 'No PC data') {
            const pcName = pc.split('\n')[0];
            characters.push({ name: pcName, type: 'pc' });
            window.cotgPCName = pcName;   // <-- remember PC name for dungeon sync
        }
        if (npcs && npcs !== 'None') {
            let npcNames = npcs.split('\n').filter(line => line.trim() !== '');
            for (let i = 0; i < npcNames.length; i += 14) {
                let name = npcNames[i];
                characters.push({ name, type: 'npc' });
            }
        }
        if (monsters && monsters !== 'None') {
            let monsterNames = monsters.split('\n').filter(line => line.trim() !== '');
            for (let i = 0; i < monsterNames.length; i += 14) {
                let name = monsterNames[i];
                characters.push({ name, type: 'monster' });
            }
        }
       
        const initialCoords = "X: 0, Y: 0, Z: 0";
        const currentCoords = coordinates || initialCoords;
        if (!this.combatInitialized || currentCoords !== this.currentCoordinates) {
            // 🔁 SWITCH DUNGEON WHEN COORDINATES CHANGE
            switchDungeonForCoordinates(currentCoords);
            try {
                // Clear existing characters in CombatScene
                const combatScene = window.combatGame.scene.getScene('CombatScene');
                if (combatScene) {
                    // Destroy all existing character sprites and labels
                    Object.values(combatScene.characters).forEach(({ sprite, label }) => {
                        sprite?.destroy();
                        label?.destroy();
                    });
                    // Reset the characters object
                    combatScene.characters = {};
                    // Reset global combatCharacters
                    window.combatCharacters = [];
                }
                // Rebuild with new characters
                window.updateCombatScene(characters);
                this.currentCoordinates = currentCoords;
                this.combatInitialized = true;
                combatCharactersString = JSON.stringify(window.combatCharacters); // Ensure this is set
                console.log("Reset and initialized CombatScene with default positions:", characters);
            } catch (e) {
                console.error("Error initializing CombatScene:", e);
            }
        }
                // Make the popup visible
     // popupDiv.style.display = 'block';
   
        // Add event listener to the close button
        const closeButton = document.querySelector('#phaser-header button');
        closeButton.onclick = () => {
            popupDiv.style.display = 'none'; // Hide the popup
        };
    }
}
window.updateCombatScene = function(characters) {
    let combatScene = window.combatGame.scene.getScene('CombatScene');
    if (combatScene) {
        console.log("Updating CombatScene with characters:", characters);
        combatScene.updateCharacters(characters);
        combatCharactersString = JSON.stringify(window.combatCharacters);
    } else {
        console.warn("CombatScene not found!");
    }
};

    class CombatScene extends Phaser.Scene {
      constructor() {
        super({ key: 'CombatScene' });
        this.initialized = false;
      }
    
      create(data) {
        console.log("CombatScene.create called with data:", data);
    

        this.PIXEL_SCALE = 2;
        this.gridSize = 15;
        this.cellSize = 25;
    
        this.worldW = this.gridSize * this.cellSize;
        this.worldH = this.gridSize * this.cellSize;
        
        this.RT_CELL = this.cellSize / this.PIXEL_SCALE;
    
        // ─────────────────────────────────────────────
        // 🔽 LOW-RES RENDER TARGET
        // ─────────────────────────────────────────────
        const lowW = Math.floor(this.worldW / this.PIXEL_SCALE);
        const lowH = Math.floor(this.worldH / this.PIXEL_SCALE);
    
        this.renderRT = this.add.renderTexture(0, 0, lowW, lowH);
        this.renderRT.setOrigin(0);
        this.renderRT.setScale(this.PIXEL_SCALE);
        this.renderRT.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    
        // Camera shows only the RT
        const cam = this.cameras.main;
        cam.setBounds(0, 0, this.worldW, this.worldH);
        cam.startFollow(this.renderRT);
        cam.roundPixels = true;
        this.game.renderer.config.antialias = false;
    
        // DOM container
        this.domContainer = document.getElementById('combat-container');
        if (!this.domContainer) {
          console.error("combat-container not found!");
          return;
        }
        
        // Initial draw
        this.redrawCombatRT();
        
        // Initialize character positions and PC tracking
        this.characters = {};
        this.pcName = '';
        // Store characters in scene data and globally for access from game.php
        const characters = data.characters || [];
        this.data.set('characters', characters);
        window.combatCharacters = characters; // Expose to global scope for game.php
        // Get the DOM container for syncing
        this.domContainer = document.getElementById('combat-container');
        if (!this.domContainer) {
            console.error("combat-container not found!");
            return;
        }
        // Sync Phaser camera with DOM scroll position initially
        this.sys.game.loop.wake();
        this.syncCameraWithScroll();
        this.time.delayedCall(50, () => this.sys.game.loop.sleep());
        // Listen for scroll events on the DOM container to update the camera
        this.domContainer.addEventListener('scroll', () => this.syncCameraWithScroll(), { passive: true }); // Use passive for performance
        // Handle PC movement with arrow keys (up/down/left/right for grid position)
      /*  this.input.keyboard.on('keydown', (event) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
                this.sys.game.loop.wake(); // wake FIRST and don't sleep yet
       
                if (!this.pcName || !this.characters[this.pcName]) return;
       
                let pcData = this.characters[this.pcName];
                let newX = pcData.x;
                let newY = pcData.y;
       
                switch (event.key) {
                    case 'ArrowUp': newY = Math.max(0, newY - 1); break;
                    case 'ArrowDown': newY = Math.min(gridSize - 1, newY + 1); break;
                    case 'ArrowLeft': newX = Math.max(0, newX - 1); break;
                    case 'ArrowRight': newX = Math.min(gridSize - 1, newX + 1); break;
                }
       
                if (!this.isPositionOccupied(newX, newY, this.pcName)) {
                    pcData.x = newX;
                    pcData.y = newY;
                    pcData.sprite.setPosition(newX * cellSize + cellSize / 2, newY * cellSize + cellSize / 2);
                    pcData.label.setPosition(newX * cellSize + cellSize / 2, newY * cellSize + cellSize / 2 + 20);
                    this.centerCameraOn(pcData.x, pcData.y);
       
                    const pcInGlobal = window.combatCharacters.find(c => c.type === 'pc');
                    if (pcInGlobal) {
                        pcInGlobal.x = newX;
                        pcInGlobal.y = newY;
                        console.log(`Updated window.combatCharacters PC to (${newX}, ${newY})`);
                    }
                }
       
                // Wait a full frame before sleeping again
                this.time.delayedCall(100, () => {
                    this.sys.game.loop.sleep();
                });
            }
        });*/
        
    const isTypingTarget = (event) => {
      const t = event.target;
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
    };

    const setMoveKey = (event, isDown) => {
      const key = event.key;
      if (key === 'Shift') {
        DUNGEON_MOVE.keys.run = isDown;
        return;
      }
      if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        DUNGEON_MOVE.keys.forward = isDown;
      }
      if (key === 'ArrowDown' || key === 's' || key === 'S') {
        DUNGEON_MOVE.keys.backward = isDown;
      }
      if (key === 'q' || key === 'Q') {
        DUNGEON_MOVE.keys.strafeLeft = isDown;
      }
      if (key === 'e' || key === 'E') {
        DUNGEON_MOVE.keys.strafeRight = isDown;
      }
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
        DUNGEON_MOVE.keys.left = isDown;
      }
      if (key === 'ArrowRight' || key === 'd' || key === 'D') {
        DUNGEON_MOVE.keys.right = isDown;
      }
    };

    this.input.keyboard.on('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'q', 'e', 'W', 'A', 'S', 'D', 'Q', 'E', 'Shift'].includes(event.key)) return;
      if (isTypingTarget(event)) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      setMoveKey(event, true);
      startDungeonMovementLoop();
    });

    this.input.keyboard.on('keyup', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'q', 'e', 'W', 'A', 'S', 'D', 'Q', 'E', 'Shift'].includes(event.key)) return;
      if (isTypingTarget(event)) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      setMoveKey(event, false);
      startDungeonMovementLoop();
    });

    }
    
    redrawCombatRT() {
        if (!this.renderRT) return;
    
        const cs = this.RT_CELL;
        const gs = this.gridSize;
    
        this.renderRT.clear();
    
        // ── Grid
        const gridG = this.make.graphics({ add: false });
        gridG.lineStyle(1, 0xffffff, 0.5);
        for (let i = 0; i <= gs; i++) {
          gridG.moveTo(i * cs, 0);
          gridG.lineTo(i * cs, gs * cs);
          gridG.moveTo(0, i * cs);
          gridG.lineTo(gs * cs, i * cs);
        }
        gridG.strokePath();
        this.renderRT.draw(gridG);
        gridG.destroy();
    
        // ── Dungeon overlay
        if (currentDungeon) {
          const dg = this.make.graphics({ add: false });
          this.drawDungeonOverlayInto(dg);
          this.renderRT.draw(dg);
          dg.destroy();
        }
    }

  drawDungeonOverlayInto(gfx) {
    const half = Math.floor(this.gridSize / 2);
    const cs = this.RT_CELL;

    const wallColor  = 0x550000;
    const floorColor = 0x222222;

    const pos = getPlayerPosForMap();
    const cx = Math.floor(pos.x);
    const cy = Math.floor(pos.y);
    const offsetX = (pos.x - (cx + 0.5)) * cs;
    const offsetY = (pos.y - (cy + 0.5)) * cs;

    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const k = `${cx + dx},${cy + dy}`;
        const cell = currentDungeon.cells[k];
        if (!cell) continue;

        const gx = (dx + half) * cs - offsetX;
        const gy = (dy + half) * cs - offsetY;

          if (cell.tile === 'wall' || cell.tile === 'door' || cell.tile === 'pillar' || cell.tile === 'torch') {
          gfx.fillStyle(wallColor, 1);
          gfx.fillRect(gx, gy, cs, cs);
        } else {
          gfx.fillStyle(floorColor, 0.35);
          gfx.fillRect(gx, gy, cs, cs);
        }
      }
    }
  }
    

    drawDungeonOverlay() {
        if (!currentDungeon) return;

        const gridSize = 15;
        const cellSize = 25;

        const GRID_PIXEL_SCALE = 2;  // grid line lattice
        const WALL_PIXEL_SCALE = 4;  // wall blockiness

        const half = Math.floor(gridSize / 2);

        if (!this.dungeonGraphics) {
            this.dungeonGraphics = this.add.graphics();
            this.dungeonGraphics.setDepth(1);
        }
        this.dungeonGraphics.clear();

        const wallColor  = 0x550000;
        const floorColor = 0x222222;
        const torchColor = 0xffaa44;  // optional: distinct for torches
        const customColor = 0xaa44aa; // optional: for custom obstacles

        const pos = getPlayerPosForMap();
        const centerX = Math.floor(pos.x);
        const centerY = Math.floor(pos.y);
        const offsetX = (pos.x - (centerX + 0.5)) * cellSize;
        const offsetY = (pos.y - (centerY + 0.5)) * cellSize;

        for (let dy = -half; dy <= half; dy++) {
            for (let dx = -half; dx <= half; dx++) {

                const key = `${centerX + dx},${centerY + dy}`;
                const cell = currentDungeon.cells[key];
                if (!cell) continue;

                const gridX = dx + half;
                const gridY = dy + half;

                // Logical cell origin
                const rawX = gridX * cellSize - offsetX;
                const rawY = gridY * cellSize - offsetY;

                // SNAP TO GRID LINES (authoritative reference)
                const gx = Math.round(rawX / GRID_PIXEL_SCALE) * GRID_PIXEL_SCALE;
                const gy = Math.round(rawY / GRID_PIXEL_SCALE) * GRID_PIXEL_SCALE;

                // Wall size snapped to WALL lattice
                const size = Math.floor(cellSize / WALL_PIXEL_SCALE) * WALL_PIXEL_SCALE;

                const tile = cell.tile || 'floor';

                // Base floor for all open cells
                this.dungeonGraphics.fillStyle(floorColor, 0.35);
                this.dungeonGraphics.fillRect(gx, gy, size, size);

                // Solid walls/doors only (remove torch/pillar if they are walkable)
                if (tile === 'wall' || tile === 'door' || tile === 'pillar') {
                    this.dungeonGraphics.fillStyle(wallColor, 0.65);
                    this.dungeonGraphics.fillRect(
                        gx,
                        gy,
                        size + WALL_PIXEL_SCALE,
                        size + WALL_PIXEL_SCALE
                    );
                }

                // Optional: distinct markers for non-solid objects (better match 3D sprites)
                if (tile === 'torch') {
                    // Small orange dot or icon in center
                    const centerGx = gx + cellSize / 2;
                    const centerGy = gy + cellSize / 2;
                    this.dungeonGraphics.fillStyle(torchColor, 0.8);
                    this.dungeonGraphics.fillCircle(centerGx, centerGy, cellSize * 0.2);
                } else if (tile.startsWith('custom_')) {
                    // Purple marker or load actual small texture if you want
                    const centerGx = gx + cellSize / 2;
                    const centerGy = gy + cellSize / 2;
                    this.dungeonGraphics.fillStyle(customColor, 0.7);
                    this.dungeonGraphics.fillRect(
                        centerGx - cellSize * 0.2,
                        centerGy - cellSize * 0.2,
                        cellSize * 0.4,
                        cellSize * 0.4
                    );
                }
            }
        }
    }
    syncCameraWithScroll() {
        if (!this.domContainer) return;
        const scrollX = this.domContainer.scrollLeft;
        const scrollY = this.domContainer.scrollTop;
        this.cameras.main.scrollX = scrollX;
        this.cameras.main.scrollY = scrollY;
    }
    isPositionOccupied(x, y, excludeName) {
        return Object.entries(this.characters).some(([name, data]) => {
            return name !== excludeName && data.x === x && data.y === y;
        });
    }
    updateCharacters(characters) {
       // console.log("CombatScene.updateCharacters called with:", characters);
        this.sys.game.loop.wake();
        // Merge new characters with existing positions from window.combatCharacters
        characters.forEach(newChar => {
            const existingChar = window.combatCharacters.find(c => c.name === newChar.name) || newChar;
            if (existingChar.x !== undefined && existingChar.y !== undefined) {
                newChar.x = existingChar.x;
                newChar.y = existingChar.y;
            } else if (newChar.x === undefined || newChar.y === undefined) {
                // Assign default positions only if not provided
                const positioning = this.determinePositioning();
                const pcsAndNpcs = characters.filter(c => c.type === 'pc' || c.type === 'npc');
                const monsters = characters.filter(c => c.type === 'monster');
                this.positionCharacters(pcsAndNpcs, monsters, positioning);
            }
        });
   
        // Update window.combatCharacters with the merged character data, ensuring all positions are included
        window.combatCharacters = characters.map(char => ({
            name: char.name,
            type: char.type,
            x: char.x || 0, // Default to 0 if undefined
            y: char.y || 0 // Default to 0 if undefined
        }));
   
        // Update combatCharactersString globally for server communication
        window.combatCharactersString = JSON.stringify(window.combatCharacters);
     // console.log("Updated window.combatCharactersString:", window.combatCharactersString);
   
        // Destroy existing sprites and labels
        Object.values(this.characters).forEach(({ sprite, label }) => {
            sprite.destroy();
            label.destroy();
        });
        this.characters = {};
   
        // Create sprites and labels for all characters with their current positions
        characters.forEach((character, index) => {
            let sprite, color;
   
            if (character.type === 'pc') {
                color = 0x00ff00;
                sprite = this.add.triangle(character.x * 25 + 12.5, character.y * 25 + 12.5, 0, -6.25, -6.25, 6.25, 6.25, 6.25, color);
                this.pcName = character.name;
            } else if (character.type === 'npc') {
                color = 0x0000ff;
                sprite = this.add.circle(character.x * 25 + 12.5, character.y * 25 + 12.5, 6.25, color);
            } else if (character.type === 'monster') {
                color = 0xff0000;
                sprite = this.add.rectangle(character.x * 25 + 12.5, character.y * 25 + 12.5, 12.5, 12.5, color);
            }
   
            sprite.setOrigin(0.5, 0.5);
   
            let label = this.add.text(character.x * 25 + 12.5, character.y * 25 + 25, character.name, {
                fontSize: '12px',
                color: '#ffffff',
                align: 'center'
            });
            label.setOrigin(0.5, 0.5);
   
            this.characters[character.name] = { sprite, label, x: character.x, y: character.y };
        });
   
        // Center camera on PC if present
        const pc = characters.find(c => c.type === 'pc');
        if (pc) {
            this.centerCameraOn(pc.x, pc.y);
        }
       
        this.time.delayedCall(50, () => this.sys.game.loop.sleep());
    }
    determinePositioning() {
        const random = Math.random();
        if (random < 0.33) return 'melee';
        if (random < 0.66) return 'medium';
        return 'far';
    }
    positionCharacters(pcsAndNpcs, monsters, positioning) {
        const gridSize = 15; // Reduced to 15x15 grid
        const centerX = Math.floor(gridSize / 2); // Center of the 15x15 grid (7,7)
        if (positioning === 'melee') {
            const groupCenterY = Math.floor(gridSize / 2); // 7
            this.placeGroup(pcsAndNpcs, centerX, groupCenterY, 2);
            this.placeGroup(monsters, centerX + 3, groupCenterY, 2);
        } else if (positioning === 'medium') {
            const groupCenterY = Math.floor(gridSize / 2); // 7
            this.placeGroup(pcsAndNpcs, centerX - 3, groupCenterY, 2); // Adjusted for smaller grid
            this.placeGroup(monsters, centerX + 5, groupCenterY, 2); // Adjusted for smaller grid
        } else if (positioning === 'far') {
            const groupCenterY = Math.floor(gridSize / 2); // 7
            this.placeGroup(pcsAndNpcs, centerX - 5, groupCenterY, 2); // Adjusted for smaller grid
            this.placeGroup(monsters, centerX + 8, groupCenterY, 2); // Adjusted for smaller grid
        }
    }
    placeGroup(characters, centerX, centerY, radius) {
        let placed = new Set();
        characters.forEach((character, index) => {
            let attempts = 0;
            const maxAttempts = 100;
            let x, y;
            do {
                const angle = Math.random() * 2 * Math.PI;
                const distance = Math.random() * radius;
                x = Math.round(centerX + Math.cos(angle) * distance);
                y = Math.round(centerY + Math.sin(angle) * distance);
                attempts++;
            } while ((placed.has(`${x},${y}`) || x < 0 || x >= 15 || y < 0 || y >= 15) && attempts < maxAttempts); // Updated grid bounds
            if (attempts < maxAttempts) {
                placed.add(`${x},${y}`);
                character.x = x;
                character.y = y;
            } else {
                character.x = Math.min(14, Math.max(0, centerX + index)); // Updated to 14 (15-1)
                character.y = Math.min(14, Math.max(0, centerY));
            }
        });
  // console.log("Positions assigned:", characters.map(c => ({ name: c.name, x: c.x, y: c.y })));
        // Center the camera on the PC after placing characters
        const pc = characters.find(c => c.type === 'pc');
        if (pc) {
            this.centerCameraOn(pc.x, pc.y);
        }
    }
   
    updatePositions(characters) {
    // console.log("Updating CombatScene positions with:", characters);
        characters.forEach(character => {
            const charData = this.characters[character.name];
            if (charData) {
                charData.x = character.x;
                charData.y = character.y;
                charData.sprite.setPosition(character.x * 25 + 12.5, character.y * 25 + 12.5);
                charData.label.setPosition(character.x * 25 + 12.5, character.y * 25 + 25);
            } else {
                // Add new character if not present
                let sprite, color;
                if (character.type === 'pc') {
                    color = 0x00ff00;
                    sprite = this.add.triangle(character.x * 25 + 12.5, character.y * 25 + 12.5, 0, -6.25, -6.25, 6.25, 6.25, 6.25, color);
                    this.pcName = character.name;
                } else if (character.type === 'npc') {
                    color = 0x0000ff;
                    sprite = this.add.circle(character.x * 25 + 12.5, character.y * 25 + 12.5, 6.25, color);
                } else if (character.type === 'monster') {
                    color = 0xff0000;
                    sprite = this.add.rectangle(character.x * 25 + 12.5, character.y * 25 + 12.5, 12.5, 12.5, color);
                }
                sprite.setOrigin(0.5, 0.5);
                let label = this.add.text(character.x * 25 + 12.5, character.y * 25 + 25, character.name, {
                    fontSize: '12px',
                    color: '#ffffff',
                    align: 'center'
                });
                label.setOrigin(0.5, 0.5);
                this.characters[character.name] = { sprite, label, x: character.x, y: character.y };
            }
            // Update window.combatCharacters with the latest position
            const charInGlobal = window.combatCharacters.find(c => c.name === character.name);
            if (charInGlobal) {
                charInGlobal.x = character.x;
                charInGlobal.y = character.y;
            } else {
                window.combatCharacters.push({ name: character.name, type: character.type, x: character.x, y: character.y });
            }
        });
        // Remove characters no longer present from window.combatCharacters
        window.combatCharacters = window.combatCharacters.filter(c => characters.some(ch => ch.name === c.name));
        // Update combatCharactersString globally
        window.combatCharactersString = JSON.stringify(window.combatCharacters);
    // console.log("Updated window.combatCharactersString in updatePositions:", window.combatCharactersString);
        // Remove characters no longer present
        Object.keys(this.characters).forEach(name => {
            if (!characters.some(c => c.name === name)) {
                const charData = this.characters[name];
                charData.sprite.destroy();
                charData.label.destroy();
                delete this.characters[name];
            }
        });
    }
   
    centerCameraOn(x, y) {
        const cellSize = 25;
        const visibleWidth = 10 * cellSize; // 400px (for reference)
        const visibleHeight = 10 * cellSize; // 400px
        const totalWidth = 15 * cellSize; // 600px
        const totalHeight = 15 * cellSize; // 600px
        // Calculate target position to center on the given point
        const targetX = x * cellSize - visibleWidth / 2;
        const targetY = y * cellSize - visibleHeight / 2;
        const maxScrollX = totalWidth - visibleWidth; // 600 - 400 = 200
        const maxScrollY = totalHeight - visibleHeight; // 200
        // Set camera scroll position, clamped to bounds
        const newScrollX = Phaser.Math.Clamp(targetX, 0, maxScrollX);
        const newScrollY = Phaser.Math.Clamp(targetY, 0, maxScrollY);
        // Update Phaser camera
        this.cameras.main.scrollX = newScrollX;
        this.cameras.main.scrollY = newScrollY;
        // Sync DOM scroll position with camera
        if (this.domContainer) {
            this.domContainer.scrollLeft = newScrollX;
            this.domContainer.scrollTop = newScrollY;
     // console.log(`Centering on (${x}, ${y}), scrolling to (${newScrollX}, ${newScrollY})`);
        }
    }
}

const gameConfig = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'phaser-container',
    scene: MainScene,
    backgroundColor: '#222222',
    input: { activePointers: 2 },
};
window.game = new Phaser.Game(gameConfig);

window.combatGame = new Phaser.Game({
  type: Phaser.CANVAS,
  width: 375,
  height: 375,
  parent: 'combat-container',
  scene: CombatScene,
  backgroundColor: '#333333',
  pixelArt: true,

  // 🔽 THIS is the magic
//  resolution: 0.25,

  render: {
    antialias: false,
    roundPixels: true
  }
});

setTimeout(() => {
  applyCombatPixelScale();
}, 0); 

function clearAllCookies() {
    // Retrieve all cookies and split into individual cookies
    const cookies = document.cookie.split(";");

    // Loop through each cookie and delete by setting expiry to the past
    for (let cookie of cookies) {
        const eqPos = cookie.indexOf("=");
        const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    }
}

// Run this function on page load or when initializing the session
window.onload = clearAllCookies;

// generate a random ID for a conversation
function generateConversationId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

const dbName = 'myDatabase';
const request = window.indexedDB.open(dbName, 1);
let db;

request.onerror = function(event) {
  console.error("Database error: ", event.target.errorCode);
};

request.onsuccess = function(event) {
  console.log("Database opened successfully");
  db = event.target.result;
};

request.onupgradeneeded = function(event) {
  const db = event.target.result;
  const store = db.createObjectStore('conversation', {keyPath: 'id', autoIncrement:true});
  store.createIndex('conversationId', 'conversationId', {unique: false});
};


// get all prompts and responses from the database for a given conversation ID
function getPromptsAndResponsesForConversation(conversationId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['conversation'], 'readonly');
    const store = transaction.objectStore('conversation');
    const index = store.index('conversationId');
    const request = index.getAll(IDBKeyRange.only(conversationId));
    request.onsuccess = function(event) {
      resolve(event.target.result);
    };
    request.onerror = function(event) {
      reject("Error getting prompts and responses for conversation");
    };
  });
}

// Map to store room conversation histories based on coordinates
const roomConversationHistories = {};
  let roomEquipment = [];

// Function to save a room's conversation history on a per-coordinate basis
function saveRoomConversationHistory(coordinates, roomHistory, roomEquipment, objectMetadata, roomExits, adjacentRooms) {
  const coordinatesString = coordinatesToString(coordinates);

  if (!roomConversationHistories[coordinatesString]) {
    roomConversationHistories[coordinatesString] = [];
  }

  // Exclude lines containing specific keywords and meeting specified conditions
  const excludedKeywords = ["Current Game Information:", "Updated Game Information", "Seed:", "Room Description:", "Coordinates:", "Objects in Room:", "Exits:", "XP:", "Score:", "Artifacts Found:", "Quests Achieved:", "HP:", "Inventory:", "PC:", "NPCs:", "Rooms Visited:", "Turns:", "north", "south", "east", "west", "northeast", "southeast", "northwest", "southwest", "down"];

  const filteredSentences = roomHistory.response
    .split(/[.!?]/) // Split into sentences based on . ! or ?
    .map(sentence => sentence.trim()) // Trim whitespace from each sentence
    .filter(sentence => {
      const trimmedLine = sentence.trim();
      if (excludedKeywords.some(keyword => trimmedLine.includes(keyword))) {
        if (/[.?!]$/.test(trimmedLine) && !trimmedLine.includes('"') && trimmedLine.endsWith('?')) {
          // Line ends with a question mark and is not contained within quotation marks
          const hasExcludedKeyword = excludedKeywords.some(keyword => sentence.includes(keyword));
          return !hasExcludedKeyword;
        } else {
          // Line doesn't meet the criteria, remove entire line
          return false; // Return false to filter out this sentence
        }
      }
      return true; // Keep the sentence if no excluded keywords are found
    });

  const filteredRoomHistory = filteredSentences.join(". "); // Join filtered sentences with a period

  const filteredRoomEquipment = roomEquipment.join(", "); // Convert roomEquipment to a string

  roomConversationHistories[coordinatesString].push({
    prompt: prompt,
    response: filteredRoomHistory,
    roomEquipment: filteredRoomEquipment,
    objectMetadata: objectMetadata,
    roomExits: roomExits,// Store roomEquipment in the history entry
  });
}


// Function to retrieve the first response in a room's conversation history based on coordinates
function getFirstResponseForRoom(coordinates) {
  const coordinatesString = coordinatesToString(coordinates);

  const roomHistory = roomConversationHistories[coordinatesString];

  if (roomHistory && roomHistory.length > 0) {
    return roomHistory[0];
  }

  return null;
}

function updateRoomConversationFirstResponse(coordinates, serverGameConsole) {
    const coordinatesString = coordinatesToString(coordinates);

    if (!roomConversationHistories[coordinatesString]) {
        roomConversationHistories[coordinatesString] = [];
    }

    if (serverGameConsole) {
        // Safely extract room details from serverGameConsole
        const roomName = serverGameConsole.match(/Room Name: (.*?)\s*$/m)?.[1]?.trim();
        let roomHistory = serverGameConsole.match(/Room Description: (.*?)\s*$/m)?.[1]?.trim();
        let puzzleInRoom = serverGameConsole.match(/Puzzle in Room: (.*?)\s*$/m)?.[1]?.trim();
        let puzzleSolution = serverGameConsole.match(/Puzzle Solution: (.*?)\s*$/m)?.[1]?.trim();
        const roomEquipmentString = serverGameConsole.match(/Objects in Room: (.*?)\s*$/m)?.[1]?.trim();
        const roomEquipment = roomEquipmentString ? roomEquipmentString.split(', ').map(item => item.trim()) : [];
        const roomExitsString = serverGameConsole.match(/Exits: (.*?)\s*$/m)?.[1]?.trim();
        const roomExits = roomExitsString ? roomExitsString.split(', ').map(exit => exit.trim()) : [];
        const adjacentRoomsString = serverGameConsole.match(/Adjacent Rooms: (.*?)\s*$/m)?.[1]?.trim();
        const adjacentRooms = adjacentRoomsString ? adjacentRoomsString.split(/,\s+/).map(item => item.trim()) : [];
        let objectMetadata = serverGameConsole.match(/Objects in Room Properties: (.*?)\s*$/m)?.[1]?.trim();
        if (objectMetadata) {
            objectMetadata = objectMetadata.split(/(?<=\}),\s*(?={)/).map(str => {
                return str.trim();
            });
        } else {
            objectMetadata = [];
        }

        console.log(roomName);
        console.log(objectMetadata);

        // Define excluded keywords for cleanup
        const excludedKeywords = [
            "Current Game Information:", "Updated Game Information", "Seed:",
            "Room Description:", "Coordinates:", "Objects in Room:", "Objects in Room Properties:", "Exits:",
            "XP:", "Score:", "Artifacts Found:", "Quests Achieved:", "HP:",
            "Inventory:", "PC:", "NPCs:", "Rooms Visited:", "Turns:",
            "north", "south", "east", "west", "northeast", "southeast",
            "northwest", "southwest"
        ];

        // Remove excluded keywords from roomHistory if it's defined
        if (roomHistory) {
            excludedKeywords.forEach(keyword => {
                const regex = new RegExp(`${keyword}.*`, 'gi'); // Match the keyword and everything after it
                roomHistory = roomHistory.replace(regex, '').trim(); // Replace with empty and trim
            });

            // Remove line breaks and clean up spaces
            roomHistory = roomHistory.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
        }

        // Create a new conversation history entry with server game console details
        const newConversationEntry = {
            prompt: "",  // Add your actual prompt logic here
            response: "",
            roomEquipment,
            objectMetadata,
            roomExits,
            roomName,
            roomHistory,
            puzzleInRoom,
            puzzleSolution,
            monstersInRoom,
            monstersEquippedProperties,
            adjacentRooms
        };

        // Check if there's already a conversation history for these coordinates
        if (roomConversationHistories[coordinatesString].length > 0) {
            // Update the first entry
            roomConversationHistories[coordinatesString][0] = newConversationEntry;
        } else {
            // Add new entry if no history exists
            roomConversationHistories[coordinatesString].push(newConversationEntry);
        }
    }
}

// add a prompt, assistant prompt, system prompt, response, and personal narrative to the database
function addPromptAndResponse(prompt, assistantPrompt, systemPrompt, response, personalNarrative, conversationId, gameConsole) {
  const transaction = db.transaction(['conversation'], 'readwrite');
  const store = transaction.objectStore('conversation');

  // Format the prompt and response
  const formattedPrompt = `$.user \`${prompt}\``;
  const formattedResponse = `$.assistant \`${response}\``;

  const newPromptAndResponse = {
    prompt: formattedPrompt,
    assistantPrompt: `$.assistant \`${assistantPrompt}\``, // Format if necessary
    systemPrompt: `$.system \`${systemPrompt}\``, // Format if necessary
    response: formattedResponse,
    personalNarrative: `personalNarrative \`${personalNarrative}\``, // Format if you're storing this as a single entry
    conversationId: conversationId,
    gameConsole: gameConsole,
  };

  store.add(newPromptAndResponse);
  
// Extract room equipment from gameConsole
const roomEquipment = gameConsole.match(/Objects in Room: ([^\n]+)/) ? gameConsole.match(/Objects in Room: ([^\n]+)/)[1].split(", ") : [];

// Extract objectMetadata from gameConsole
const objectMetadata = gameConsole.match(/Objects in Room Properties: ([^\n]+)/) ? gameConsole.match(/Objects in Room Properties: ([^\n]+)/)[1].split(", ") : [];

// Extract room exits from gameConsole
const roomExitsString = gameConsole.match(/Exits: (.*?)\s*$/m)?.[1]?.trim();
const roomExits = roomExitsString ? roomExitsString.split(', ').map(exit => exit.trim()) : [];

// Extract room equipment from gameConsole
const adjacentRooms = gameConsole.match(/Adjacent Rooms: ([^\n]+)/) ? gameConsole.match(/Adjacent Rooms: ([^\n]+)/)[1].split(/,\s+/).map(item => item.trim()).join(', ') : [];


// Define the conversationHistory here
const roomHistory = {
    prompt: prompt,
    response: response,
    roomEquipment: roomEquipment,
    objectMetadata: objectMetadata,
    roomExits: roomExits,
    adjacentRooms: adjacentRooms,// Include objectMetadata in roomHistory
    prompts: [] // Add an array to store user prompts
};

// Push the user prompt into the prompts array
roomHistory.prompts.push(prompt);

// Save the conversation history in the room's conversation histories
saveRoomConversationHistory(currentCoordinates, roomHistory, roomEquipment, objectMetadata, roomExits, adjacentRooms); // Save with objectMetadata


  // If the room's conversation history entry doesn't exist yet, create it
  const coordinatesString = coordinatesToString(currentCoordinates);
  if (!roomConversationHistories[coordinatesString]) {
    roomConversationHistories[coordinatesString] = [];
  }

  // Save the conversation history in the room's conversation histories
  roomConversationHistories[coordinatesString].push(roomHistory);

  // Log all prompts, assistant prompt, system prompt, response, and personal narrative in the console
  getPromptsAndResponsesForConversation(conversationId)
    .then((promptsAndResponses) => {
      console.log("All prompts, assistant prompt, system prompt, response, and personal narrative for conversation " + conversationId + ":", promptsAndResponses);
    })
    .catch((error) => {
      console.error(error);
    });
}


// Initialize the currentCoordinates to the starting point
let currentCoordinates = { x: 0, y: 0, z: 0 };

var turns = 0;

// Map single-letter directions to their full names
const directionMap = {
  'n': 'north',
  's': 'south',
  'e': 'east',
  'w': 'west',
  'nw': 'northwest',
  'sw': 'southwest',
  'ne': 'northeast',
  'se': 'southeast',
  'u': 'up',
  'd': 'down',
};

// Function to find a matching console in the conversation history based on coordinates, excluding boss room coordinates
function findMatchingConsoleByCoordinates(conversationHistory, coordinates) {
  const regex = new RegExp(`(?<!Boss Room )Coordinates: X: ${coordinates.x}, Y: ${coordinates.y}, Z: ${coordinates.z}`);
  const matches = conversationHistory.match(regex);
  return matches ? matches[0] : null;
}


// Keep track of visited room coordinates
const visitedRooms = new Set();
// Set to keep track of unvisited rooms
const unvisitedRooms = new Set();

// Function to update the set of unvisited rooms based on roomNameDatabase and visitedRooms
function updateUnvisitedRoomsSet(currentCoordinates) {
    // Add all rooms from roomNameDatabase to unvisitedRooms set if not visited
    for (let coordinatesString of roomNameDatabase.keys()) {
        if (!Array.from(visitedRooms).some(visitedRoom => coordinatesToString(visitedRoom) === coordinatesString)) {
            unvisitedRooms.add(coordinatesString);
        }
    }
    // Remove visited rooms and current room from unvisitedRooms set
    for (let visitedRoom of visitedRooms) {
        const visitedRoomString = coordinatesToString(visitedRoom);
        if (unvisitedRooms.has(visitedRoomString)) {
            unvisitedRooms.delete(visitedRoomString);
        }
    }
    const currentCoordinatesString = coordinatesToString(currentCoordinates);
    if (unvisitedRooms.has(currentCoordinatesString)) {
        unvisitedRooms.delete(currentCoordinatesString);
    }
    console.log("Updated Unvisited Room Coordinates:", unvisitedRooms);
}


// Data structure to store room connections
const roomConnections = {};

// Set to keep track of connected and unconnected rooms
const connectedRooms = new Set();
const unconnectedRooms = new Set();


// Function to generate unique exits for a room based on its coordinates
function generateUniqueExits(coordinates, updatedGameConsole) {
  // For demonstration purposes, let's assume that the exits are randomly generated.
  // You should replace this with your actual exit generation logic.
  const possibleExits = ["north", "south", "east", "west", "northeast", "southeast", "northwest", "southwest", "up", "down"];
  const numExits = Math.min(Math.floor(Math.random() * 5) + 1, 5); // Random number of exits (1 to 3)
  const exits = new Set();

  // Get the most recent visited room's coordinates from the Set
  const recentCoordinates = Array.from(visitedRooms).pop();
  
  console.log('recentCoordinates:', recentCoordinates); // Log recentCoordinates every turn

  if (recentCoordinates) {
    // Determine the direction the player moved from the most recent coordinates to the updated coordinates
    const { x: prevX, y: prevY, z: prevZ } = recentCoordinates;
    const { x: currX, y: currY, z: currZ } = coordinates;

    // Determine the direction the player moved from the most recent coordinates to the updated coordinates
    const xDiff = currX - prevX;
    const yDiff = currY - prevY;
    const zDiff = currZ - prevZ;

    // Add the opposite direction of the player's movement to exits
    if (xDiff > 0 && yDiff === 0 && zDiff === 0) exits.add("west");
    else if (xDiff < 0 && yDiff === 0 && zDiff === 0) exits.add("east");

    else if (xDiff === 0 && yDiff > 0 && zDiff === 0) exits.add("south");
    else if (xDiff === 0 && yDiff < 0 && zDiff === 0) exits.add("north");
    // Additional diagonal directions
    else if (xDiff > 0 && yDiff > 0 && zDiff === 0) exits.add("southwest");
    else if (xDiff > 0 && yDiff < 0 && zDiff === 0) exits.add("northwest");
    else if (xDiff < 0 && yDiff > 0 && zDiff === 0) exits.add("southeast");
    else if (xDiff < 0 && yDiff < 0 && zDiff === 0) exits.add("northeast");
    else if (xDiff === 0 && yDiff === 0 && zDiff > 0) exits.add("down");
    else if (xDiff === 0 && yDiff === 0 && zDiff < 0) exits.add("up");

  }

// Get an array of visited room coordinates
const visitedRoomCoordinates = Array.from(visitedRooms);

console.log("Visited Room Coordinates:", visitedRoomCoordinates);

// Convert visited room coordinates to a Set of strings
const visitedRoomCoordinatesSet = new Set(visitedRoomCoordinates.map(coord => coordinatesToString(coord)));

// Get potential exits that haven't been visited
const potentialExits = possibleExits.filter(exitDirection => {
  const adjacentCoord = generateCoordinates(currentCoordinates, exitDirection);
  const adjacentCoordString = coordinatesToString(adjacentCoord);
  return !visitedRoomCoordinatesSet.has(adjacentCoordString);
});

console.log("Potential Exits:", potentialExits);

// Add at least one random exit to the set
const initialExitIndex = Math.floor(Math.random() * potentialExits.length);
const initialExit = potentialExits[initialExitIndex];
exits.add(initialExit);
console.log("Exits:", exits)

// Add random exits to the set
while (exits.size < numExits && potentialExits.length > 0) {
  const randomExitIndex = Math.floor(Math.random() * potentialExits.length);
  const randomExit = potentialExits[randomExitIndex];
  
  exits.add(randomExit);
  potentialExits.splice(randomExitIndex, 1); // Remove the used exit from potentialExits
}

console.log("Exits:", exits)

  // ✅✅✅ ONLY NEW LOGIC — FORCE 2 EXITS AT 0,0,0 ✅✅✅
  if (coordinates.x === 0 && coordinates.y === 0 && coordinates.z === 0) {
    const exitArray = Array.from(exits);
    if (exitArray.length < 2 && potentialExits.length > 0) {
      exits.add(potentialExits[Math.floor(Math.random() * potentialExits.length)]);
    }
  }
  
  // Check if the roomConnections entry doesn't exist for the current room
if (!roomConnections[coordinatesToString(currentCoordinates)]) {
  roomConnections[coordinatesToString(currentCoordinates)] = {
    coordinates: currentCoordinates,
    exits: [],
    connectedRooms: [],
    unconnectedRooms: Array.from(getAdjacentCoordinates(currentCoordinates)) // Initialize as an array
  };
}

 // Determine potentially adjacent coordinates
  const adjacentCoordinates = getAdjacentCoordinates(currentCoordinates);
    // Update the roomConnections data structure
    roomConnections[coordinatesToString(currentCoordinates)].exits = exits;

    exits.forEach(exit => {
      const adjacentCoord = generateCoordinates(currentCoordinates, exit);
      if (!roomConnections[coordinatesToString(adjacentCoord)]) {
        roomConnections[coordinatesToString(adjacentCoord)] = {
          coordinates: adjacentCoord,
          exits: [],
          connectedRooms: [],
          unconnectedRooms: getAdjacentCoordinates(adjacentCoord) // Get all potential adjacent coordinates
        };
      }
      roomConnections[coordinatesToString(currentCoordinates)].connectedRooms.push(adjacentCoord);
      roomConnections[coordinatesToString(adjacentCoord)].connectedRooms.push(currentCoordinates);

// Remove the adjacent room from the unconnected rooms set
roomConnections[coordinatesToString(currentCoordinates)].unconnectedRooms = Array.from(roomConnections[coordinatesToString(currentCoordinates)].unconnectedRooms).filter(room =>
  !areObjectsEqual(room, adjacentCoord)
);
roomConnections[coordinatesToString(adjacentCoord)].unconnectedRooms = Array.from(roomConnections[coordinatesToString(adjacentCoord)].unconnectedRooms).filter(room =>
  !areObjectsEqual(room, currentCoordinates)
);
    });

    // Remove the current room from the unconnected rooms set
    roomConnections[coordinatesToString(currentCoordinates)].unconnectedRooms = roomConnections[coordinatesToString(currentCoordinates)].unconnectedRooms.filter(room =>
      !areObjectsEqual(room, currentCoordinates)
    );



// Update roomConnections based on exits
exits.forEach(exit => {
  const adjacentCoord = generateCoordinates(currentCoordinates, exit);
  if (adjacentCoordinates.has(adjacentCoord)) {
    if (!roomConnections[adjacentCoord]) {
      roomConnections[adjacentCoord] = {
        coordinates: adjacentCoord,
        connectedRooms: [],
        unconnectedRooms: []
      };
    }
    roomConnections[currentCoordinates].connectedRooms.push(adjacentCoord);
    roomConnections[adjacentCoord].connectedRooms.push(currentCoordinates);
    
    // Remove adjacentCoord from the unconnectedRooms of currentCoordinates
    roomConnections[currentCoordinates].unconnectedRooms.delete(adjacentCoord);

    // Remove currentCoordinates from the unconnectedRooms of adjacentCoord
    roomConnections[adjacentCoord].unconnectedRooms.delete(currentCoordinates);
  }
});

  // Get the connected and unconnected rooms of the current coordinates
  const connectedRoomsOfCurrent = roomConnections[coordinatesToString(coordinates)].connectedRooms;
  const unconnectedRoomsOfCurrent = roomConnections[coordinatesToString(coordinates)].unconnectedRooms;
  console.log("Connected Rooms: ", connectedRoomsOfCurrent)
  
  // Add exits that lead to connected rooms
  for (const room of connectedRoomsOfCurrent) {
    const exitToConnected = getExitToCoordinate(coordinates, room);
    if (exitToConnected) {
      exits.add(exitToConnected);
    }
  }
 console.log(`Generated exits for coordinates (${coordinates.x}, ${coordinates.y}, ${coordinates.z}): ${Array.from(exits)}`);
  console.log("Exits:", exits)
  return Array.from(exits);
}

// Function to get the exit direction from one coordinate to another
function getExitToCoordinate(fromCoordinate, toCoordinate) {
    const offsets = [
        { offset: { x: 0, y: 1, z: 0 }, direction: "north" },
        { offset: { x: 0, y: -1, z: 0 }, direction: "south" },
        { offset: { x: 1, y: 0, z: 0 }, direction: "east" },
        { offset: { x: -1, y: 0, z: 0 }, direction: "west" },
        { offset: { x: 0, y: 0, z: 1 }, direction: "up" },
        { offset: { x: 0, y: 0, z: -1 }, direction: "down" }
    ];

    for (const { offset, direction } of offsets) {
        const adjacentCoord = {
            x: fromCoordinate.x + offset.x,
            y: fromCoordinate.y + offset.y,
            z: fromCoordinate.z + offset.z
        };

        if (areCoordinatesEqual(adjacentCoord, toCoordinate)) {
            return direction;
        }
    }

    return null; // No exit in this direction
}

// Function to check if two coordinates are equal
function areCoordinatesEqual(coord1, coord2) {
    return coord1.x === coord2.x && coord1.y === coord2.y && coord1.z === coord2.z;
}

// Function to generate new coordinates based on the valid direction
function generateCoordinates(currentCoordinates, validDirection) {
  // Convert the validDirection to its full name if it exists in the directionMap
  const direction = directionMap[validDirection] || validDirection;

  let { x, y, z } = currentCoordinates;

  if (direction === 'north') {
    y++;
  } else if (direction === 'south') {
    y--;
  } else if (direction === 'east') {
    x++;
  } else if (direction === 'west') {
    x--;
  } else if (direction === 'northwest') {
    x--;
    y++;
  } else if (direction === 'southwest') {
    x--;
    y--;
  } else if (direction === 'northeast') {
    x++;
    y++;
  } else if (direction === 'southeast') {
    x++;
    y--;
  } else if (direction === 'up') {
    z++;
  } else if (direction === 'down') {
    z--;
  }

  return { x, y, z };
}

// Updated function to connect boss room to nearest unvisited room
function connectBossRoomToNearestUnvisitedRoomWithDetails(bossCoordinates, nextBossRoom) {
    const bossRoomCoordinatesObj = {
        x: parseInt(bossCoordinates.match(/X: (-?\d+)/)?.[1], 10),
        y: parseInt(bossCoordinates.match(/Y: (-?\d+)/)?.[1], 10),
        z: parseInt(bossCoordinates.match(/Z: (-?\d+)/)?.[1], 10),
    };
    const bossRoomCoordinatesString = coordinatesToString(bossRoomCoordinatesObj);

    // Update unconnected rooms for boss room
    updateBossRoomUnconnectedRooms(bossRoomCoordinatesObj);

    if (!roomNameDatabase.has(bossRoomCoordinatesString)) {
        roomNameDatabase.set(bossRoomCoordinatesString, nextBossRoom);
        console.log(`Added Boss Room to roomNameDatabase: ${bossRoomCoordinatesString} -> ${nextBossRoom}`);

        const nearestUnvisitedRoomCoordinates = findNearestUnvisitedRoom(bossRoomCoordinatesObj);
        if (nearestUnvisitedRoomCoordinates) {
            const virtualRooms = generatePathToTarget(nearestUnvisitedRoomCoordinates, bossRoomCoordinatesObj);
            let previousRoom = nearestUnvisitedRoomCoordinates;

            for (let virtualRoom of virtualRooms) {
                const virtualRoomKey = coordinatesToString(virtualRoom);
               /* if (!roomNameDatabase.has(virtualRoomKey)) {
                    roomNameDatabase.set(virtualRoomKey, `Virtual Room (${virtualRoom.x},${virtualRoom.y},${virtualRoom.z})`);
                    console.log(`Added Virtual Room to roomNameDatabase: ${virtualRoomKey}`);
                }*/

                generateRoomDetails(virtualRoom);
                connectRooms(previousRoom, virtualRoom);
                previousRoom = virtualRoom;
            }

            connectRooms(previousRoom, bossRoomCoordinatesObj);
        }
    }

    updateBossRoomDetails(bossRoomCoordinatesObj, nextBossRoom);
}

// Function to generate full room details for a given room
function generateRoomDetails(coordinates) {
    const coordinatesString = coordinatesToString(coordinates);

    // Create room name and description
    const roomName = `Virtual Room (${coordinates.x}, ${coordinates.y}, ${coordinates.z})`;
    const roomDescription = `This is a virtual room located at coordinates (${coordinates.x}, ${coordinates.y}, ${coordinates.z}). It serves as an intermediate connection between important locations.`;

    // Generate random objects in the room
    const objectsInRoom = Math.random() < 0.5 ? ["Ancient Artifact", "Mysterious Scroll"] : ["Rusty Sword", "Old Shield"];
    const objectMetadata = objectsInRoom.map(item => ({ name: item, type: "artifact", value: Math.floor(Math.random() * 100) }));

    // Generate random puzzle in the room
    const puzzleInRoom = Math.random() < 0.3 ? "Solve the riddle of the stones" : null;
    const puzzleSolution = puzzleInRoom ? "Arrange the stones in ascending order of their markings" : null;

    // Add room details to the room conversation history
    saveRoomConversationHistory(coordinates, {
        response: roomDescription,
        roomEquipment: objectsInRoom,
        objectMetadata: objectMetadata,
        puzzleInRoom: puzzleInRoom,
        puzzleSolution: puzzleSolution
    }, objectsInRoom, objectMetadata, []);

    // Add room to roomConnections if not already present
    if (!roomConnections[coordinatesString]) {
        roomConnections[coordinatesString] = {
            coordinates: coordinates,
            exits: [],
            connectedRooms: [],
            unconnectedRooms: Array.from(getAdjacentCoordinates(coordinates)).map(coord => ({ x: coord.x, y: coord.y, z: coord.z })) // Initialize as an array of coordinate objects
        };
    }

    console.log(`Generated room details for ${coordinatesString}: ${roomDescription}`);
}

// Function to update unconnected rooms for given coordinates
function updateUnconnectedRooms(coordinates) {
    const coordinatesString = coordinatesToString(coordinates);

    if (!roomConnections[coordinatesString]) {
        roomConnections[coordinatesString] = {
            coordinates: coordinates,
            exits: [],
            connectedRooms: [],
            unconnectedRooms: Array.from(getAdjacentCoordinates(coordinates)),
        };
    }
}

// Helper function to remove a room from unconnectedRooms array
function removeFromUnconnectedRooms(room, targetRoomString) {
    const unconnectedRooms = room.unconnectedRooms;
    const index = unconnectedRooms.findIndex(coordinateString => coordinateString === targetRoomString);
    if (index !== -1) {
        unconnectedRooms.splice(index, 1);
    }
}

// Modified connectRooms function
function connectRooms(room1, room2) {
    const room1Key = coordinatesToString(room1);
    const room2Key = coordinatesToString(room2);

    // Ensure roomConnections for both rooms exist
    updateUnconnectedRooms(room1);
    updateUnconnectedRooms(room2);

    // Remove room2 from room1's unconnectedRooms
    removeFromUnconnectedRooms(roomConnections[room1Key], room2Key);
    // Remove room1 from room2's unconnectedRooms
    removeFromUnconnectedRooms(roomConnections[room2Key], room1Key);

    if (!roomConnections[room1Key].connectedRooms.includes(room2Key)) {
        roomConnections[room1Key].connectedRooms.push(room2);
    }

    if (!roomConnections[room2Key].connectedRooms.includes(room1Key)) {
        roomConnections[room2Key].connectedRooms.push(room1);
    }

    console.log(`Connected ${room1Key} to ${room2Key}`);
}

// Update unconnected rooms for boss room
function updateBossRoomUnconnectedRooms(bossRoomCoordinates) {
    const bossRoomKey = coordinatesToString(bossRoomCoordinates);

    if (!roomConnections[bossRoomKey]) {
        roomConnections[bossRoomKey] = {
            coordinates: bossRoomCoordinates,
            exits: [],
            connectedRooms: [],
            unconnectedRooms: Array.from(getAdjacentCoordinates(bossRoomCoordinates)),
        };
    }
}

// Function to update adjacent rooms for connected rooms
function updateAdjacentRooms(room1, room2) {
    const room1Key = coordinatesToString(room1);
    const room2Key = coordinatesToString(room2);

    if (!roomConnections[room1Key].adjacentRooms) {
        roomConnections[room1Key].adjacentRooms = {};
    }
    if (!roomConnections[room2Key].adjacentRooms) {
        roomConnections[room2Key].adjacentRooms = {};
    }

    const directionToRoom2 = getExitToCoordinate(room1, room2);
    const directionToRoom1 = getExitToCoordinate(room2, room1);

    if (directionToRoom2) {
        roomConnections[room1Key].adjacentRooms[directionToRoom2] = roomNameDatabase.get(room2Key).name;
    }
    if (directionToRoom1) {
        roomConnections[room2Key].adjacentRooms[directionToRoom1] = roomNameDatabase.get(room1Key).name;
    }
    console.log(`Updated adjacent rooms for ${room1Key} and ${room2Key}`);
}

// Updated function to generate a path to the target, excluding visited rooms, with support for navigating around visited rooms
function generatePathToTarget(startCoordinates, targetCoordinates) {
    const path = [];
    let currentCoordinates = { ...startCoordinates };

    const directions = [
        { x: 1, y: 0, z: 0 },  // east
        { x: -1, y: 0, z: 0 }, // west
        { x: 0, y: 1, z: 0 },  // north
        { x: 0, y: -1, z: 0 }, // south
        { x: 0, y: 0, z: 1 },  // up
        { x: 0, y: 0, z: -1 }, // down
        { x: 1, y: 1, z: 0 },  // northeast
        { x: -1, y: 1, z: 0 }, // northwest
        { x: 1, y: -1, z: 0 }, // southeast
        { x: -1, y: -1, z: 0 } // southwest
    ];

    while (currentCoordinates.x !== targetCoordinates.x || currentCoordinates.y !== targetCoordinates.y || currentCoordinates.z !== targetCoordinates.z) {
        let nextCoordinates = { ...currentCoordinates };
        let foundAlternative = false;

        // Determine the primary step direction
        if (currentCoordinates.x < targetCoordinates.x) {
            nextCoordinates.x++;
        } else if (currentCoordinates.x > targetCoordinates.x) {
            nextCoordinates.x--;
        } else if (currentCoordinates.y < targetCoordinates.y) {
            nextCoordinates.y++;
        } else if (currentCoordinates.y > targetCoordinates.y) {
            nextCoordinates.y--;
        } else if (currentCoordinates.z < targetCoordinates.z) {
            nextCoordinates.z++;
        } else if (currentCoordinates.z > targetCoordinates.z) {
            nextCoordinates.z--;
        }

        // If the next room is visited, find an alternative path
        if (visitedRooms.has(coordinatesToString(nextCoordinates))) {
            for (let direction of directions) {
                const alternativeCoordinates = {
                    x: currentCoordinates.x + direction.x,
                    y: currentCoordinates.y + direction.y,
                    z: currentCoordinates.z + direction.z
                };

                // Check if the alternative coordinates are unvisited and not already in the path
                if (!visitedRooms.has(coordinatesToString(alternativeCoordinates)) && !path.some(coord => coordinatesToString(coord) === coordinatesToString(alternativeCoordinates))) {
                    nextCoordinates = alternativeCoordinates;
                    foundAlternative = true;
                    break;
                }
            }

            // If no alternative is found, log a warning and break the loop to avoid infinite looping
            if (!foundAlternative) {
                console.warn("Unable to find an alternative path to target without visiting a visited room.");
                break;
            }
        }

        // Ensure the next coordinates are not already in the path to prevent looping
        if (!path.some(coord => coordinatesToString(coord) === coordinatesToString(nextCoordinates))) {
            path.push({ ...nextCoordinates });
            currentCoordinates = nextCoordinates;
        } else {
            console.warn("Encountered a loop while generating the path.");
            break;
        }
    }

    return path;
}

// Updated function to find the nearest unvisited room, excluding visited rooms and current coordinates
function findNearestUnvisitedRoom(targetCoordinates) {
    let nearestRoom = null;
    let minDistance = Infinity;

    // Iterate over all known rooms in the unvisitedRooms set
    for (let coordinatesString of unvisitedRooms) {
        // Skip the room if it is the current room or if it is the boss room itself
        if (coordinatesString === coordinatesToString(targetCoordinates) || coordinatesToString(currentCoordinates) === coordinatesString) {
            continue;
        }

        const currentCoordinatesObj = parseCoordinates(coordinatesString);
        if (!currentCoordinatesObj) {
            console.error("Failed to parse coordinates:", coordinatesString);
            continue;
        }

        // Calculate the distance between the target coordinates and the current coordinates
        const distance = calculateDistance(targetCoordinates, currentCoordinatesObj);

        // Update the nearest room if the distance is shorter
        if (distance < minDistance) {
            minDistance = distance;
            nearestRoom = currentCoordinatesObj;
        }
    }

    if (nearestRoom) {
        console.log(`Nearest unvisited room found: ${coordinatesToString(nearestRoom)} with distance ${minDistance}`);
    } else {
        console.warn("No valid unvisited room found.");
    }

    return nearestRoom;
}

// Function to calculate the distance between two coordinates
function calculateDistance(coord1, coord2) {
    if (!coord1 || !coord2) {
        console.error("Invalid coordinates for distance calculation:", coord1, coord2);
        return Infinity; // Return a very large value to indicate no valid distance
    }

    // Normal distance calculation if both coordinates are valid
    const dx = coord2.x - coord1.x;
    const dy = coord2.y - coord1.y;
    const dz = coord2.z - coord1.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Function to parse a string of coordinates in the format "x,y,z"
function parseCoordinates(coordinateString) {
    if (!coordinateString) {
        console.error("Invalid coordinate string provided:", coordinateString);
        return null;
    }

    const match = coordinateString.match(/^(-?\d+),(-?\d+),(-?\d+)$/);
    if (!match) {
        console.error("Failed to parse coordinates:", coordinateString);
        return null;
    }

    return {
        x: parseInt(match[1], 10),
        y: parseInt(match[2], 10),
        z: parseInt(match[3], 10)
    };
}

// Function to update the boss room details after connecting
function updateBossRoomDetails(bossRoomCoordinates, roomName) {
    const bossRoomKey = coordinatesToString(bossRoomCoordinates);
    if (!roomConnections[bossRoomKey]) {
        roomConnections[bossRoomKey] = {
            coordinates: bossRoomCoordinates,
            exits: [],
            connectedRooms: [],
            unconnectedRooms: Array.from(getAdjacentCoordinates(bossRoomCoordinates)).map(coord => ({ x: coord.x, y: coord.y, z: coord.z }))
        };
    }

    // Ensure the boss room has a name, exits, and connections properly populated
    roomConnections[bossRoomKey].roomName = roomName;

    const connectedRooms = roomConnections[bossRoomKey].connectedRooms;
    connectedRooms.forEach((connectedRoom) => {
        const connectedRoomCoordinates = connectedRoom;
        const direction = getExitToCoordinate(bossRoomCoordinates, connectedRoomCoordinates);
        if (direction && !roomConnections[bossRoomKey].exits.includes(direction)) {
            roomConnections[bossRoomKey].exits.push(direction);
        }

        // Ensure connected rooms also have corresponding exits
        const reverseDirection = getExitToCoordinate(connectedRoomCoordinates, bossRoomCoordinates);
        const connectedRoomKey = coordinatesToString(connectedRoomCoordinates);
        if (reverseDirection && roomConnections[connectedRoomKey] && !roomConnections[connectedRoomKey].exits.includes(reverseDirection)) {
            roomConnections[connectedRoomKey].exits.push(reverseDirection);
        }
    });

    // Generate exits using generateUniqueExits function to ensure consistency
   // generateUniqueExits(bossRoomCoordinates, updatedGameConsole);

    console.log(`Updated Boss Room Details: ${bossRoomKey}, Name: ${roomName}, Exits: ${roomConnections[bossRoomKey].exits}`);
}

const equipmentItems = ["candle", "candles", "torch", "oil flask", "flint & steel", "holy symbol", "holy water", "lock pick", "pouch of lock picks (20)", "key", "rope 50 ft.", "salt", "book", "journal", "diary", "tome", "parchment", "scroll", "spellbook", "paper", "canvas", "miner's pick", "poison (vial)", "pouch", "robes", "shovel", "helmet", "club", "dagger", "dagger +1", "knife", "greatclub", "handaxe", "javelin", "lance", "hammer", "mace", "morning star", "quarterstaff", "sickle", "spear", "crossbow", "darts (20)", "shortbow", "arrows (20)", "darts", "sling", "staff sling", "battleaxe", "flail", "glaive", "greataxe", "greatsword", "halberd", "lance", "longsword", "longsword +1", "longsword +2", "longsword +3", "scimitar", "broad sword", "two-handed sword", "two-handed sword +1", "two-handed sword +2", "two-handed sword +3", "maul", "morningstar", "pike", "rapier", "scimitar", "shortsword", "shortsword +1", "shortsword +2", "trident", "war pick", "warhammer", "whip", "scourge", "blowgun", "longbow", "net", "banded mail", "banded mail +1", "chain mail", "chain mail +1", "chain mail +3", "plate mail", "plate mail +1", "plate mail +2", "plate mail +3", "leather armor", "padded armor", "suit of armor", "armor", "ring mail", "scale mail", "shield", "studded leather armor", "splint mail", "bracers", "adamantine armor", "backpack", "sheath", "sack", "crystal", "vial", "healing potion", "potion of healing", "orb", "rod", "staff", "wand", "totem", "wooden staff", "wand of fireballs", "wand of magic missiles", "wand of ice storm", "wand of lightning", "alchemist's fire flask", "amulet", "locket", "lantern", "chest", "wooden box", "jug", "pot", "flask", "waterskin", "rations", "drum", "flute", "lute", "lyre", "horn", "pan flute", "paint brush", "saddle", "ale", "bread", "meat", "bottle of wine", "goblet", "cup", "chalice", "gold pieces", "silver pieces", "copper pieces", "platinum pieces", "gem", "jewelry", "ring", "amulet of health", "amulet of the planes", "arrow of slaying", "bag of holding", "girdle of giant strength", "berserker axe", "boots of speed", "broom", "satchel", "candle of invocation", "cloak of displacement", "cloak of protection", "crystal ball", "dragon scale mail", "dust of disappearance", "dwarven plate", "elemental gem", "elven chain mail", "feather", "figurine", "flame tongue sword", "gem of brightness", "giant slayer", "hammer of thunderbolts", "ioun stone", "javelin of lightning", "mithral armor", "necklace of missiles", "potion of animal friendship", "potion of giant strength", "potion of invisibility", "potion of resistance", "potion of speed", "ring of protection", "ring of fire", "ring of water", "ring of earth", "ring of air", "ring of invisibility", "ring of resistance", "ring of telekinesis", "robe of the archmagi", "shield +1", "shield +2", "shield +3", "scimitar of speed", "staff of fire", "staff of healing", "staff of the magi", "staff of thunder & lightning", "wand of fear", "wand of paralysis",  /* other equipment items */];

// Function to escape special characters in a string for use in a regular expression
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Array to store player's inventory
let inventory = [];
function removeNoneFromInventory(inventory) {
  // Remove "None" and "None " if they exist in the inventory array
  inventory = inventory.filter(item => item.trim() !== "None" && item.trim() !== "None ");
  return inventory;
}

// Define experienceToAdd
const experienceToAdd = getRandomInt(0, 1);

// Function to calculate XP based on character level
function calculateXP(level) {
  return level * 15000;
}

// Define a map to store generated monsters in visited rooms
const monstersInVisitedRooms = new Map();
const monstersEquippedPropertiesByRoom = new Map();
const monstersStateByRoom = new Map();

function generateMonstersForRoom(roomCoordinates, serverGameConsole) {
 //   if (!monstersInVisitedRooms.has(roomCoordinates)) {
        let monsters = [];
        let monstersEquippedProperties = [];
        let monstersState = "";

        // Update regex to ensure it captures the entire monsters section properly
        const monsterDataMatch = serverGameConsole.match(/Monsters in Room:([\s\S]+?)(?=Monsters Equipped Properites:|$)/);
        if (monsterDataMatch) {
            // Correctly split monster entries by looking for two consecutive newlines or start of a new monster entry
            const monstersStateMatch = serverGameConsole.match(/Monsters State:([\s\S]+?)(?=Rooms Visited:|$)/);
            if (monstersStateMatch) {
                monstersState = monstersStateMatch[1].trim(); // Extract the captured group
            }
            const monsterEntries = monsterDataMatch[1].trim().split(/\n(?=\w)/);
            monsters = monsterEntries.map(monsterBlock => {
                const lines = monsterBlock.split('\n').map(line => line.trim());
                if (lines.length < 13) {
                    console.error("Unexpected format in monsterBlock:", lines);
                    return null; // Skip improperly formatted blocks
                }

                // Parse equipped items correctly
                const equippedItems = parseEquippedItems(lines[9]);

                // Store equipped items properties
                for (const slot in equippedItems) {
                    const itemName = equippedItems[slot];
                    if (itemName !== "None") {
                        const itemProperties = serverGameConsole.match(new RegExp(`{name: "${itemName}".*?}`));
                        if (itemProperties) {
                            const props = itemProperties[0].replace(/[{}]/g, '').split(', ').reduce((acc, prop) => {
                                const [key, value] = prop.split(': ').map(str => str.trim().replace(/"/g, ''));
                                acc[key] = isNaN(value) ? value : Number(value);
                                return acc;
                            }, {});
                            monstersEquippedProperties.push(props);
                        } else {
                            // Fallback for missing properties
                            monstersEquippedProperties.push({
                                name: itemName,
                                type: slot,
                                attack_modifier: 0,
                                damage_modifier: 0,
                                ac: 0,
                                magic: 0
                            });
                        }
                    }
                }

                return {
                    Name: lines[0],
                    Sex: lines[1],
                    Race: lines[2],
                    Class: lines[3],
                    Level: parseInt(lines[4].split(' ')[1]),
                    AC: parseInt(lines[5].split(' ')[1]),
                    XP: parseInt(lines[6].split(' ')[1]),
                    HP: parseInt(lines[7].split(' ')[1]),
                    MaxHP: parseInt(lines[8].split(' ')[1]),
                    Equipped: equippedItems,
                    Attack: parseInt(lines[10].split(' ')[1]),
                    Damage: parseInt(lines[11].split(' ')[1]),
                    Armor: parseInt(lines[12].split(' ')[1]),
                    Magic: parseInt(lines[13].split(' ')[1])
                };
            }).filter(Boolean); // Remove any null entries

            monstersInVisitedRooms.set(roomCoordinates, monsters);
            monstersEquippedPropertiesByRoom.set(roomCoordinates, monstersEquippedProperties);
            monstersStateByRoom.set(roomCoordinates, monstersState);
            

            // Log the equipped properties for verification
            console.log(`Stored monsters equipped properties for room ${roomCoordinates}:`, monstersEquippedProperties);
        } else {
            console.log("No monster data found or regex failed to match.");
        }
//    }
}

// Helper function to parse monsters from the string
function parseMonsters(monstersString) {
    return monstersString.split(';').map(monster => {
        const details = monster.split(',').map(detail => detail.trim());
        return {
            Name: details[0],
            Sex: details[1],
            Race: details[2],
            Class: details[3],
            Level: parseInt(details[4], 10),
            AC: parseInt(details[5], 10),
            XP: parseInt(details[6], 10),
            HP: parseInt(details[7], 10),
            MaxHP: parseInt(details[8], 10),
            Equipped: parseInt(details[9], 10),
            Attack: parseInt(details[10], 10),
            Damage: parseInt(details[11], 10),
            Armor: parseInt(details[12], 10),
            Magic: parseInt(details[13], 10),
        };
    });
}

let equippedInventory = [];
let currentQuest = "None";
let nextArtifact = "None";
let nextBoss = "None";
let nextBossRoom = "None";
let bossCoordinates = "None";
let globalQuestsAchieved = 0;
let globalArtifactsFound = 0;
let score = 0;
let inventoryProperties = [];
let monstersInRoom = [];
let monstersEquippedProperties = [];
let monstersState = "";
let npcsInPartyString = [];
let npcsInParty = [];
let characters = [];
let npcs = [];

async function completeQuestIfArtifactFound() {
   
    const lowerCaseInventory = inventory.map(item => item.toLowerCase());
    const lowerCaseNextArtifact = nextArtifact.toLowerCase();

    // Check if the artifact specified in Next Artifact is in the inventory
    if (lowerCaseInventory.includes(lowerCaseNextArtifact)) {
        console.log(`Artifact ${nextArtifact} found in inventory. Completing quest.`);

        // Increment quests achieved and artifacts found
        globalQuestsAchieved += 1;
        globalArtifactsFound += 1;

        // Reset Current Quest and Next Artifact to blank
        currentQuest = "None";
        nextArtifact = "None";
        nextBoss = "None";
        nextBossRoom = "None";
        bossCoordinates = "None";

        // Log the updated global variables for debugging
        console.log(`Quests Achieved: ${globalQuestsAchieved}/15`);
        console.log(`Artifacts Found: ${globalArtifactsFound}/21`);
    }
}

// Function to parse equipped items from a line
function parseEquippedItems(line) {
    const equippedItems = {
        Weapon: "None",
        Armor: "None",
        Shield: "None",
        Other: "None"
    };
    const itemPairs = line.replace("Equipped:", "").split(",");
    itemPairs.forEach(pair => {
        const [type, item] = pair.split(":").map(str => str.trim());
        equippedItems[type] = item;
    });
    return equippedItems;
}

// Function to find item properties from monstersEquippedProperties
function findItemProperties(itemName) {
    return monstersEquippedProperties.find(item => item.name.toLowerCase() === itemName.toLowerCase());
}

// Define the extractDetails function
function extractDetails(details) {
    const lines = details.split('\n').map(line => line.trim());
    const characters = [];
    for (let i = 0; i < lines.length; i += 14) {
        const name = lines[i] || 'Unknown';
        const className = lines[i + 3] ? lines[i + 3].trim() : 'Unknown';
        const ac = lines[i + 5] ? parseInt(lines[i + 5].split(':')[1].trim()) : 0;
        const hp = lines[i + 7] ? parseInt(lines[i + 7].split(':')[1].trim()) : 0;
        const attack = lines[i + 10] ? parseInt(lines[i + 10].split(':')[1].trim()) : 0;
        const damage = lines[i + 11] ? parseInt(lines[i + 11].split(':')[1].trim()) : 0;

        if (name && className && !isNaN(ac) && !isNaN(hp) && !isNaN(attack) && !isNaN(damage)) {
            characters.push({
                name,
                className,
                ac,
                hp,
                attack,
                damage,
            });
        } else {
            console.error(`Failed to parse character details correctly at line ${i + 1}`);
        }
    }
    return characters;
}

// Function to roll a dice and sum results for each level above the current level
function rollTotalHP(currentLevel, newLevel, diceSize) {
  let hpTotal = 0;
  const levelsToRoll = newLevel - currentLevel;

  for (let i = 0; i < levelsToRoll; i++) {
    hpTotal += Math.floor(Math.random() * diceSize) + 1;
  }
  return hpTotal;
}

// Function to calculate XP thresholds that double per level until level 9, then increment at a fixed rate
function calculateXpThresholds(xpThreshold, level) {
    if (level < 9) {
        // Doubling per level until level 9
        return xpThreshold * Math.pow(2, level - 2);
    } else {
        // Fixed rate after level 9
        return xpThreshold * Math.pow(2, 7);
    }
}

// Function to determine the level based on XP
function calculateLevel(xp, xpThreshold, className) {
    let level = 1;
    let xpForNextLevel;

    while (true) {
        // Handle if xpThreshold is a function (for classes like "Assassin-Fighter-Necromancer-Goddess")
        if (typeof xpThreshold === 'function') {
            xpForNextLevel = xpThreshold(level);
        } else {
            xpForNextLevel = calculateXpThresholds(xpThreshold, level);
        }

        if (xp < xpForNextLevel) {
            break;
        }

        xp -= xpForNextLevel;
        level++;
    }

    return level;
}

const xpThresholds = {
    'Knight of Atinus': 1750,
    'Knight of Atricles': 2000,
    'Wizard': 2500,
    'Witch': 2500,
    'Necromancer': 2500,
    'Warlock': 3000,
    'Sorcerer': 3000,
    'Thief': 1500,
    'Assassin': 1500,
    'Barbarian': 2000,
    'Assassin-Fighter-Necromancer-Goddess': (level) => {
        if (level < 9) {
            return 3500 * Math.pow(2, level - 2);
        } else if (level >= 50 && level < 58) {
            return 3500 * Math.pow(2, level - 50); // Resetting thresholds
        } else {
            return 3500 * Math.pow(2, 7); // Fixed rate after level 9 or 57
        }
    }
};

// Define XP thresholds for different classes
/*const xpThresholds = {
    'Knight of Atinus': 12000,
    'Knight of Atricles': 13000,
    'Wizard': 14000,
    'Witch': 14000,
    'Necromancer': 14000,
    'Warlock': 16000,
    'Sorcerer': 16000,
    'Thief': 11000,
    'Assassin': 11000,
    'Barbarian': 12000,
    'Assassin-Fighter-Necromancer-Goddess': 15000,
    // Add other classes if needed
};*/

// Function to calculate increases based on the level difference
function calculateIncrease(currentLevel, newLevel, factor) {
    return Math.floor((newLevel - currentLevel) / factor);
}

// Ensure that PC properties exist and initialize them if not
function ensurePCProperties(char) {
    // Initialize the properties if not already set
    if (char.Attack === undefined) char.Attack = 0;
    if (char.Damage === undefined) char.Damage = 0;
    if (char.Armor === undefined) char.Armor = 0;
    if (char.Magic === undefined) char.Magic = 0;

    // Check if base modifiers have already been applied
    if (!char.baseModifiersApplied) {
        // Define base modifiers for each class
        const baseClassModifiers = {
            'Knight of Atinus': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Knight of Atricles': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Wizard': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Witch': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Necromancer': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Warlock': { Attack: 0, Damage: 0, Armor: 0, Magic: 3 },
            'Sorcerer': { Attack: 0, Damage: 0, Armor: 0, Magic: 3 },
            'Thief': { Attack: 0, Damage: 0, Armor: 1, Magic: 0 },
            'Assassin': { Attack: 1, Damage: 0, Armor: 0, Magic: 0 },
            'Barbarian': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Assassin-Fighter-Necromancer-Goddess': { Attack: 1, Damage: 1, Armor: -2, Magic: 5 },
            // Add other classes here
        };

        // Define base modifiers for each race
        const baseRaceModifiers = {
            'Human': { Attack: 0, Damage: 0, Armor: 0, Magic: 0 },
            'Dwarf': { Attack: 0, Damage: 1, Armor: 0, Magic: -1 },
            'High Elf': { Attack: -1, Damage: -1, Armor: 1, Magic: 2 },
            'Unseelie Elf': { Attack: -1, Damage:-1, Armor: 1, Magic: 2 },
            'Half-Elf': { Attack: -1, Damage: 0, Armor: 0, Magic: 1 },
            'Halfling': { Attack: -1, Damage: -1, Armor: 2, Magic: 0 },
            'Fey': { Attack: -1, Damage: -2, Armor: 0, Magic: 3 },
            'Raakshasa': { Attack: -1, Damage: 0, Armor: -1, Magic: 2 },
            'Gnome': { Attack: -1, Damage: -1, Armor: 0, Magic: 2 },
            // Add other races here
        };

        // Apply the base modifiers if the class and race are found
        const classModifiers = baseClassModifiers[char.Class];
        const raceModifiers = baseRaceModifiers[char.Race];

        if (classModifiers) {
            char.Attack += classModifiers.Attack;
            char.Damage += classModifiers.Damage;
            char.Armor += classModifiers.Armor;
            char.Magic += classModifiers.Magic;
        }

        if (raceModifiers) {
            char.Attack += raceModifiers.Attack;
            char.Damage += raceModifiers.Damage;
            char.Armor += raceModifiers.Armor;
            char.Magic += raceModifiers.Magic;
        }

        // Mark that base modifiers have been applied
        char.baseModifiersApplied = true;
    }
}

// Ensure that npc properties exist and initialize them if not
function ensureNPCProperties(npc) {
    // Initialize the properties if not already set
    if (npc.Attack === undefined) npc.Attack = 0;
    if (npc.Damage === undefined) npc.Damage = 0;
    if (npc.Armor === undefined) npc.Armor = 0;
    if (npc.Magic === undefined) npc.Magic = 0;

    // Check if base modifiers have already been applied
    if (!npc.baseModifiersApplied) {
        // Define base modifiers for each class
        const baseClassModifiers = {
            'Knight of Atinus': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Knight of Atricles': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Wizard': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Witch': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Necromancer': { Attack: 0, Damage: 0, Armor: 0, Magic: 2 },
            'Warlock': { Attack: 0, Damage: 0, Armor: 0, Magic: 3 },
            'Sorcerer': { Attack: 0, Damage: 0, Armor: 0, Magic: 3 },
            'Thief': { Attack: 0, Damage: 0, Armor: 1, Magic: 0 },
            'Assassin': { Attack: 1, Damage: 0, Armor: 0, Magic: 0 },
            'Barbarian': { Attack: 1, Damage: 1, Armor: 0, Magic: 0 },
            'Assassin-Fighter-Necromancer-Goddess': { Attack: 1, Damage: 1, Armor: -2, Magic: 5 },
            // Add other classes here
        };

        // Define base modifiers for each race
        const baseRaceModifiers = {
            'Human': { Attack: 0, Damage: 0, Armor: 0, Magic: 0 },
            'Dwarf': { Attack: 0, Damage: 1, Armor: 0, Magic: -1 },
            'High Elf': { Attack: -1, Damage: -1, Armor: 1, Magic: 2 },
            'Unseelie Elf': { Attack: -1, Damage:-1, Armor: 1, Magic: 2 },
            'Half-Elf': { Attack: -1, Damage: 0, Armor: 0, Magic: 1 },
            'Halfling': { Attack: -1, Damage: -1, Armor: 2, Magic: 0 },
            'Fey': { Attack: -1, Damage: -2, Armor: 0, Magic: 3 },
            'Raakshasa': { Attack: -1, Damage: 0, Armor: -1, Magic: 2 },
            'Gnome': { Attack: -1, Damage: -1, Armor: 0, Magic: 2 },
            // Add other races here
        };

        // Apply the base modifiers if the class and race are found
        const classModifiers = baseClassModifiers[npc.Class];
        const raceModifiers = baseRaceModifiers[npc.Race];

        if (classModifiers) {
            npc.Attack += classModifiers.Attack;
            npc.Damage += classModifiers.Damage;
            npc.Armor += classModifiers.Armor;
            npc.Magic += classModifiers.Magic;
        }

        if (raceModifiers) {
            npc.Attack += raceModifiers.Attack;
            npc.Damage += raceModifiers.Damage;
            npc.Armor += raceModifiers.Armor;
            npc.Magic += raceModifiers.Magic;
        }

        // Mark that base modifiers have been applied
        npc.baseModifiersApplied = true;
    }
}

function getReverseExit(exit) {
    const reverseDirections = {
        north: "south",
        south: "north",
        east: "west",
        west: "east",
        northeast: "southwest",
        southwest: "northeast",
        northwest: "southeast",
        southeast: "northwest",
        up: "down",
        down: "up"
    };

    return reverseDirections[exit] || null; // Return null if the direction is not found
}

function stringToCoordinates(coordString) {
    const [x, y, z] = coordString.split(',').map(Number); // Split and convert to numbers
    return { x, y, z };
}

function updateRoomConnections(currentCoordinates, exits) {
    const currentCoordString = coordinatesToString(currentCoordinates);

    // Ensure the current room exists and has properties in the correct order
    if (!roomConnections[currentCoordString]) {
        roomConnections[currentCoordString] = {
            coordinates: currentCoordinates,
            exits: new Set(), // Ensure exits is always a Set
            connectedRooms: [],
            unconnectedRooms: Array.from(getAdjacentCoordinates(currentCoordinates)),
        };
    }

    const currentRoom = roomConnections[currentCoordString];

    // Ensure exits is a Set
    if (!(currentRoom.exits instanceof Set)) {
        currentRoom.exits = new Set(currentRoom.exits || []);
    }

    // Iterate through each exit and its corresponding adjacent coordinate
    exits.forEach(exit => {
        const adjacentCoord = generateCoordinates(currentCoordinates, exit);
        const adjacentCoordString = coordinatesToString(adjacentCoord);

        // Ensure the adjacent room exists and has properties in the correct order
        if (!roomConnections[adjacentCoordString]) {
            roomConnections[adjacentCoordString] = {
                coordinates: adjacentCoord,
                exits: new Set(), // Initialize exits as a Set
                connectedRooms: [],
                unconnectedRooms: Array.from(getAdjacentCoordinates(adjacentCoord)),
            };
        }

        const adjacentRoom = roomConnections[adjacentCoordString];

        // Ensure exits is a Set
        if (!(adjacentRoom.exits instanceof Set)) {
            adjacentRoom.exits = new Set(adjacentRoom.exits || []);
        }

        // Add the current exit to the current room's exits
        currentRoom.exits.add(exit);

        // Add the reverse exit to the adjacent room's exits
        const reverseExit = getReverseExit(exit);
        adjacentRoom.exits.add(reverseExit);

        // Update connectedRooms with deduplication
        if (!currentRoom.connectedRooms.some(room => areObjectsEqual(room, adjacentCoord))) {
            currentRoom.connectedRooms.push(adjacentCoord);
        }
        if (!adjacentRoom.connectedRooms.some(room => areObjectsEqual(room, currentCoordinates))) {
            adjacentRoom.connectedRooms.push(currentCoordinates);
        }

        // Remove adjacentCoord from unconnectedRooms of currentCoordinates
        currentRoom.unconnectedRooms = currentRoom.unconnectedRooms.filter(room =>
            !areObjectsEqual(stringToCoordinates(room), adjacentCoord)
        );

        // Remove currentCoordinates from unconnectedRooms of adjacentCoord
        adjacentRoom.unconnectedRooms = adjacentRoom.unconnectedRooms.filter(room =>
            !areObjectsEqual(stringToCoordinates(room), currentCoordinates)
        );

        // Ensure unconnectedRooms for the adjacent room are populated correctly
        const potentialUnconnectedRooms = Array.from(getAdjacentCoordinates(adjacentCoord));
        adjacentRoom.unconnectedRooms = potentialUnconnectedRooms.filter(room =>
            !adjacentRoom.connectedRooms.some(connected => areObjectsEqual(connected, room)) &&
            !areObjectsEqual(room, currentCoordinates)
        );
    });

    // Deduplicate connectedRooms list (if needed for existing data)
    currentRoom.connectedRooms = currentRoom.connectedRooms.filter(
        (room, index, self) =>
            index === self.findIndex(other => areObjectsEqual(room, other))
    );
    
     console.log(`Generated exits for coordinates (${currentCoordinates.x}, ${currentCoordinates.y}, ${currentCoordinates.z}): ${Array.from(exits)}`);
     console.log("Exits:", exits)
}

// Function to update the game console based on user inputs and get the updated game console
function updateGameConsole(userInput, currentCoordinates, conversationHistory, itemToTake, serverGameConsole, equippedItems, characterStats) {

  // Initialize the coordinates
  let { x, y, z } = currentCoordinates;
  let objectsInRoomString = [];
  let itemsInRoom = [];
  
    // Get the most recent visited room's coordinates from the Set
  const recentCoordinates = Array.from(visitedRooms).pop();
  const coordinatesString = coordinatesToString(currentCoordinates);
  
  console.log('currentCoordinates:', currentCoordinates);
  console.log("Connected Rooms:", roomConnections);
  console.log("Visited Room Coordinates:", visitedRooms);
  console.log("Unvisited Room Coordinates:", unvisitedRooms);

  // Parse user input to check for valid directions
  const validDirections = ["north", "n", "south", "s", "east", "e", "west", "w", "northeast", "ne", "northwest", "nw", "southeast", "se", "southwest", "sw", "up", "u", "down", "d"];
 
  let userWords = userInput.split(/\s+/).map(word => word.toLowerCase());
  
  // Check if the updated coordinates are already present in the conversation history
  const matchingConsole = findMatchingConsoleByCoordinates(conversationHistory, currentCoordinates);
  let roomName = "";
  let roomHistory = "";
  let puzzleInRoom = "";
  let puzzleSolution = "";
//  const roomKey = coordinatesToString(currentCoordinates);
  let roomEquipment = [];
  let objectMetadata = [];
  let characterString = [];
const roomKey = coordinatesToString(currentCoordinates);
  let adjacentRooms = [];
let monstersInRoom = monstersInVisitedRooms.get(roomKey) || [];
let monstersEquippedProperties = monstersEquippedPropertiesByRoom.get(roomKey) || [];
let monstersState = monstersStateByRoom.get(roomKey) || "";

// Extract monsters data from the matchingConsole
if (matchingConsole) {
    const monstersRegex = /Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s;
    const monstersMatch = matchingConsole.match(monstersRegex);

    if (monstersMatch) {
        const monstersDataString = monstersMatch[1].trim();

        // Check if there are any monsters listed or if it's just "None"
        if (monstersDataString !== "None") {
            const monsterEntries = monstersDataString.split(/\n(?=\w)/);
            const monstersData = monsterEntries.map(monsterBlock => {
                const lines = monsterBlock.trim().split('\n').map(line => line.trim());
                const equippedItems = parseEquippedItems(lines[9]); // Parse equipped items

                const monster = {
                    Name: lines[0],
                    Sex: lines[1],
                    Race: lines[2],
                    Class: lines[3],
                    Level: parseInt(lines[4].split(':')[1].trim()),
                    AC: parseInt(lines[5].split(':')[1].trim()),
                    XP: parseInt(lines[6].split(':')[1].trim()),
                    HP: parseInt(lines[7].split(':')[1].trim()),
                    MaxHP: parseInt(lines[8].split(':')[1].trim()),
                    Equipped: equippedItems, // Use parsed equipped items
                    Attack: parseInt(lines[10].split(':')[1].trim()),
                    Damage: parseInt(lines[11].split(':')[1].trim()),
                    Armor: parseInt(lines[12].split(':')[1].trim()),
                    Magic: parseInt(lines[13].split(':')[1].trim()),
                };
                return monster;
            });
            monstersInRoom = monstersData;

        } else {
            monstersInRoom = []; // No monsters in the room
        }
    }

    // Extract monsters equipped properties from the matchingConsole
    const equippedPropertiesRegex = /Monsters Equipped Properties:(.*?)(?=Monsters State:|$)/s;
    const equippedPropertiesMatch = matchingConsole.match(equippedPropertiesRegex);

    if (equippedPropertiesMatch) {
        const equippedPropertiesString = equippedPropertiesMatch[1].trim();

        // Check if there are any equipped properties listed or if it's just "None"
        if (equippedPropertiesString !== "None") {
            monstersEquippedProperties = equippedPropertiesString.split(/},\s*{/).map(equip => {
                const props = equip.replace(/[{}]/g, '').split(', ').reduce((acc, prop) => {
                    const [key, value] = prop.split(': ').map(str => str.trim().replace(/"/g, ''));
                    acc[key] = isNaN(value) ? value : Number(value);
                    return acc;
                }, {});
                return props;
            });
        } else {
            monstersEquippedProperties = []; // No equipped properties
        }

        // Log the equipped properties for verification
        console.log(`Parsed monsters equipped properties from matchingConsole for room ${roomKey}:`, monstersEquippedProperties);
    }
}

// Log the parsed monsters to verify correct parsing
console.log("Parsed monsters from matchingConsole:", monstersInRoom);
console.log("Parsed monsters equipped properties from matchingConsole:", monstersEquippedProperties);

// Convert monster.Equipped to a string before rendering
monstersInRoom.forEach(monster => {
    console.log("Before conversion, monster.Equipped:", monster.Equipped);
    if (typeof monster.Equipped === 'object') {
        const equippedItemsString = Object.entries(monster.Equipped)
            .map(([slot, item]) => `${slot}: ${item}`)
            .join(", ");
        monster.Equipped = equippedItemsString;
    }
    console.log("After conversion, monster.Equipped:", monster.Equipped);
});

// Format the list of monsters in the current room as a string
let monstersInRoomString = monstersInRoom.length > 0
    ? monstersInRoom.map(monster => {
        return `${monster.Name}
        ${monster.Sex}
        ${monster.Race}
        ${monster.Class}
        Level: ${monster.Level}
        AC: ${monster.AC}
        XP: ${monster.XP}
        HP: ${monster.HP}
        MaxHP: ${monster.MaxHP}
        Equipped: ${monster.Equipped}
        Attack: ${monster.Attack}
        Damage: ${monster.Damage}
        Armor: ${monster.Armor}
        Magic: ${monster.Magic}`;
    }).join("\n")
    : "None";

let monstersEquippedPropertiesString = monstersEquippedProperties.length > 0
    ? monstersEquippedProperties.map(equip => `{name: "${equip.name}", type: "${equip.type}", attack_modifier: ${equip.attack_modifier}, damage_modifier: ${equip.damage_modifier}, ac: ${equip.ac}, magic: $equip.magic}}`).join(', ')
    : "None";

    console.log("Monsters in Room:", monstersInRoomString);

if (serverGameConsole && turns >= 0) {
    // Match and update PC details
    let pcMatch = serverGameConsole.match(/PC:([\s\S]*?)(?=(NPCs in Party|Rooms Visited))/);
    if (pcMatch && characters.length > 0) {
        const pcDetails = pcMatch[1].trim();
        const pcLines = pcDetails.split('\n').map(line => line.trim());
        
        if (pcLines.length >= 14) {
            const newLevel = parseInt(pcLines[4].split(': ')[1]); // Assuming Level is on line 4
            const newXP = parseInt(pcLines[6].split(': ')[1]);
            const newHP = parseInt(pcLines[7].split(': ')[1]);
            const newMaxHP = parseInt(pcLines[8].split(': ')[1]); // Assuming MaxHP is on line 8
            characters[0].Level = newLevel;  // Update the Level of the PC
            characters[0].XP = newXP;        // Update the XP of the PC
            characters[0].HP = newHP;        // Update the HP of the PC
            characters[0].MaxHP = newMaxHP;  // Update the MaxHP of the PC
        }
    }

    // Match and update NPCs in Party details
    let npcsMatch = serverGameConsole.match(/NPCs in Party:([\s\S]*?)(?=(Monsters in Room|Rooms Visited))/);
    if (npcsMatch && npcs.length > 0) {
        const npcsDetails = npcsMatch[1].trim();
        const npcsBlocks = npcsDetails.split(/\n(?=\w)/);  // Split by lines starting with a word character

        npcsBlocks.forEach((npcBlock, index) => {
            const lines = npcBlock.trim().split('\n').map(line => line.trim());
            
            if (lines.length >= 14 && index < npcs.length) {
                const newLevel = parseInt(lines[4].split(': ')[1]); // Assuming Level is on line 4
                const newXP = parseInt(lines[6].split(': ')[1]);
                const newHP = parseInt(lines[7].split(': ')[1]);
                const newMaxHP = parseInt(lines[8].split(': ')[1]); // Assuming MaxHP is on line 8
                npcs[index].Level = newLevel;  // Update the Level of each NPC
                npcs[index].XP = newXP;        // Update the XP of each NPC
                npcs[index].HP = newHP;        // Update the HP of each NPC
                npcs[index].MaxHP = newMaxHP;  // Update the MaxHP of each NPC
            }
        });
    }

characters.forEach(char => {
    ensurePCProperties(char);
    char.AC = 10 + Math.floor(char.Level / 10);
});

npcs.forEach(npc => {
    ensureNPCProperties(npc);
    npc.AC = 10 + Math.floor(npc.Level / 10);
});

}

    // Check if serverGameConsole is defined and has the expected content
    if (serverGameConsole) {
        let roomNameMatch = serverGameConsole.match(/Room Name: (.+)/);
        if (roomNameMatch) roomName = roomNameMatch[1];

        let roomHistoryMatch = serverGameConsole.match(/Room Description: (.+)/);
        if (roomHistoryMatch) roomHistory = roomHistoryMatch[1];
        
        let puzzleInRoomMatch = serverGameConsole.match(/Puzzle in Room: (.+)/);
        if (puzzleInRoomMatch) puzzleInRoom = puzzleInRoomMatch[1];
    
        let puzzleSolutionMatch = serverGameConsole.match(/Puzzle Solution: (.+)/);
        if (puzzleSolutionMatch) puzzleSolution = puzzleSolutionMatch[1];

        let currentQuestMatch = serverGameConsole.match(/Current Quest: (.+)/);
        if (currentQuestMatch) currentQuest = currentQuestMatch[1];

        let nextArtifactMatch = serverGameConsole.match(/Next Artifact: (.+)/);
        if (nextArtifactMatch) nextArtifact = nextArtifactMatch[1];
        
        let nextBossMatch = serverGameConsole.match(/Next Boss: (.+)/);
        if (nextBossMatch) nextBoss = nextBossMatch[1];
        
        let nextBossRoomMatch = serverGameConsole.match(/Next Boss Room: (.+)/);
        if (nextBossRoomMatch) nextBossRoom = nextBossRoomMatch[1];
        
        // Parsing the boss room coordinates from serverGameConsole
        let bossCoordinatesMatch = serverGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
        if (bossCoordinatesMatch) {
            bossCoordinates = `X: ${bossCoordinatesMatch[1]}, Y: ${bossCoordinatesMatch[2]}, Z: ${bossCoordinatesMatch[3]}`;
            console.log("Parsed boss room coordinates:", bossCoordinates);
        } else {
            console.error("Failed to parse boss room coordinates from serverGameConsole.");
        }
        
        // Add the boss room details to the roomNameDatabase and connect it to the nearest unvisited room
        if (bossCoordinates && nextBossRoom && bossCoordinates !== "None" && nextBossRoom !== "None") {
            // Extract coordinates from the bossCoordinates string
            const bossCoordinatesMatch = bossCoordinates.match(/X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
            if (!bossCoordinatesMatch) {
                console.error("Failed to parse boss room coordinates from serverGameConsole.");
            } else {
                // Create a properly formatted coordinate string
                const bossCoordinatesString = `${bossCoordinatesMatch[1]},${bossCoordinatesMatch[2]},${bossCoordinatesMatch[3]}`;
                const bossRoomCoordinatesObj = parseCoordinates(bossCoordinatesString);
        
                if (!bossRoomCoordinatesObj) {
                    console.error("Invalid boss room coordinates, skipping connection logic.");
                } else {
                    // Add the boss room to the database if not present
                    if (!roomNameDatabase.has(bossCoordinatesString)) {
                        roomNameDatabase.set(bossCoordinatesString, nextBossRoom);
                        console.log(`Added Boss Room to roomNameDatabase: ${bossCoordinatesString} -> ${nextBossRoom}`);
                    }
        
                    // Find the nearest unvisited room
                    const nearestUnvisitedRoom = findNearestUnvisitedRoom(bossRoomCoordinatesObj);
                    if (nearestUnvisitedRoom) {
                        const virtualRooms = generatePathToTarget(nearestUnvisitedRoom, bossRoomCoordinatesObj);
                        let previousRoom = nearestUnvisitedRoom;
        
                        // Connect rooms along the generated path
                        for (let virtualRoom of virtualRooms) {
                            const virtualRoomKey = coordinatesToString(virtualRoom);
                           /* if (!roomNameDatabase.has(virtualRoomKey)) {
                                roomNameDatabase.set(virtualRoomKey, "");
                                console.log(`Added Virtual Room to roomNameDatabase: ${virtualRoomKey}`);
                            }*/
        
                            connectRooms(previousRoom, virtualRoom);
                            previousRoom = virtualRoom;
                        }
        
                        // Finally, connect the last virtual room to the boss room
                        connectRooms(previousRoom, bossRoomCoordinatesObj);
                    } else {
                        console.warn("No unvisited room available to connect to the boss room.");
                    }
                }
            }
        } else {
            console.error("Invalid boss room details, skipping connection logic.");
        }

  // Extract adjacent rooms
  let adjacentRoomsMatch = serverGameConsole.match(/Adjacent Rooms: ([^\n]+)/);
  if (adjacentRoomsMatch) adjacentRooms = adjacentRoomsMatch ? adjacentRoomsMatch[1].split(', ').reduce((acc, room) => {
    const [direction, name] = room.split(': ');
    acc[direction] = name;
    return acc;
  }, {}) : {};
  
  // Populate the room name database
  populateRoomNameDatabase(currentCoordinates, adjacentRooms);
  
  // NEW: If any room lacks classification, log/warn (for debugging)
    for (const [key, room] of roomNameDatabase) {
      if (!room.classification || Object.keys(room.classification).length < 3) {  // e.g., missing shape
        console.warn(`Incomplete classification for ${key}:`, room.classification);
      }
    }
    
    // Serialize with full fidelity
    roomNameDatabaseString = JSON.stringify(mapToPlainObject(roomNameDatabase), null, 2);  // Pretty-print for debug
  
  console.log("roomNameDatabase:", roomNameDatabase);
  console.log("roomNameDatabasePlainObject:", roomNameDatabasePlainObject)
  console.log("roomNameDatabaseString:", roomNameDatabaseString);

        generateMonstersForRoom(roomKey, serverGameConsole);
        monstersInRoom = monstersInVisitedRooms.get(roomKey) || [];
        monstersEquippedProperties = monstersEquippedPropertiesByRoom.get(roomKey) || [];
        monstersState = monstersStateByRoom.get(roomKey) || "";

        // Extract monsters data from the serverGameConsole
        const monstersRegex = /Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s;
        const monstersMatch = serverGameConsole.match(monstersRegex);

        if (monstersMatch) {
            const monstersDataString = monstersMatch[1].trim();

            // Check if there are any monsters listed or if it's just "None"
            if (monstersDataString !== "None") {
                const monsterEntries = monstersDataString.split(/\n(?=\w)/);
                const monstersData = monsterEntries.map(monsterBlock => {
                    const lines = monsterBlock.trim().split('\n').map(line => line.trim());
                    const equippedItems = parseEquippedItems(lines[9]); // Parse equipped items

                    const monster = {
                        Name: lines[0],
                        Sex: lines[1],
                        Race: lines[2],
                        Class: lines[3],
                        Level: parseInt(lines[4].split(':')[1].trim()),
                        AC: parseInt(lines[5].split(':')[1].trim()),
                        XP: parseInt(lines[6].split(':')[1].trim()),
                        HP: parseInt(lines[7].split(':')[1].trim()),
                        MaxHP: parseInt(lines[8].split(':')[1].trim()),
                        Equipped: equippedItems, // Use parsed equipped items
                        Attack: parseInt(lines[10].split(':')[1].trim()),
                        Damage: parseInt(lines[11].split(':')[1].trim()),
                        Armor: parseInt(lines[12].split(':')[1].trim()),
                        Magic: parseInt(lines[13].split(':')[1].trim())
                    };
                    return monster;
                });
                monstersInRoom = monstersData;
            } else {
                monstersInRoom = []; // No monsters in the room
            }
        }

        // Extract monsters equipped properties from the serverGameConsole
        const equippedPropertiesRegex = /Monsters Equipped Properties:(.*?)(?=Monsters State:|$)/s;
        const equippedPropertiesMatch = serverGameConsole.match(equippedPropertiesRegex);

        if (equippedPropertiesMatch) {
            const equippedPropertiesString = equippedPropertiesMatch[1].trim();

            // Check if there are any equipped properties listed or if it's just "None"
            if (equippedPropertiesString !== "None") {
                monstersEquippedProperties = equippedPropertiesString.split('}, {').map(equip => {
                    const props = equip.replace(/[{|}]/g, '').split(', ').reduce((acc, prop) => {
                        const [key, value] = prop.split(': ').map(str => str.trim().replace(/"/g, ''));
                        acc[key] = isNaN(value) ? value : Number(value);
                        return acc;
                    }, {});
                    return props;
                });
            } else {
                monstersEquippedProperties = []; // No equipped properties
            }
        }
        
                // Extract monsters equipped properties from the serverGameConsole
        const monstersStateRegex = /Monsters State:(.*?)(?=Rooms Visited:|$)/s;
        const monstersStateMatch = serverGameConsole.match(monstersStateRegex);

        if (monstersStateMatch) {
                const monstersState = monstersStateMatch;
            } else {
                monstersState = "";
                }    
        
        // Log the parsed monsters to verify correct parsing
        console.log("Parsed monsters from serverGameConsole:", monstersInRoom);

        // Convert monster.Equipped to a string before rendering
        monstersInRoom.forEach(monster => {
            console.log("Before conversion, monster.Equipped:", monster.Equipped);
            if (typeof monster.Equipped === 'object') {
                const equippedItemsString = Object.entries(monster.Equipped)
                    .map(([slot, item]) => `${slot}: ${item}`)
                    .join(", ");
                monster.Equipped = equippedItemsString;
            }
            console.log("After conversion, monster.Equipped:", monster.Equipped);
        });

        // Format the list of monsters in the current room as a string
        monstersInRoomString = monstersInRoom.length > 0
            ? monstersInRoom.map(monster => {
                return `${monster.Name}
                ${monster.Sex}
                ${monster.Race}
                ${monster.Class}
                Level: ${monster.Level}
                AC: ${monster.AC}
                XP: ${monster.XP}
                HP: ${monster.HP}
                MaxHP: ${monster.MaxHP}
                Equipped: ${monster.Equipped}
                Attack: ${monster.Attack}
                Damage: ${monster.Damage}
                Armor: ${monster.Armor}
                Magic: ${monster.Magic}`;
            }).join("\n")
            : "None";
            
        console.log("Monsters in Room:", monstersInRoomString);
        
    // Update monsters in the room
    monstersInVisitedRooms.set(roomKey, monstersInRoom);

    }

    // Use monstersInRoom to set or update monsters in the visited rooms map


  
 // if (serverGameConsole) {
 //     monstersInRoomString = serverGameConsole.match(/Monsters in Room: (.+)/)?.[1];
 // }
      
      
      

  // Get the exits for the current room
let exits = [];
  if (currentCoordinates.x === 0 && currentCoordinates.y === 0 && currentCoordinates.z === 0 && !matchingConsole) {
    roomName = "Ruined Temple Entrance"
    roomHistory = "You find yourself standing in the first room of the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels and powerful demons..."; // Set preset value for specific coordinates
    exits = generateUniqueExits(currentCoordinates, conversationHistory);
    // Example usage: update unvisited rooms set whenever roomNameDatabase or visitedRooms changes
updateUnvisitedRoomsSet(currentCoordinates);
    // Check if there's a chance to add equipment to the room
// Check if there's a chance to add equipment to the room

// Inside the code where new items are randomly generated, add XP to PC and NPCs
if (Math.random() < 1.0) {
  const randomEquipment = equipmentItems[Math.floor(Math.random() * equipmentItems.length)];

  if (!roomEquipment.some(existingObject => areItemsEqual(existingObject, randomEquipment))) {
    roomEquipment.push(randomEquipment);

    // Add XP to PC
    characters.forEach(char => {
        char.XP += experienceToAdd; // Add XP to PC

    });

    // Add XP to NPCs
    npcs.forEach(npc => {
      npc.XP += experienceToAdd; // Add XP to NPCs
    });
  }
}
    // Update the visited rooms set with the current room's coordinates
    visitedRooms.add(currentCoordinates);
    // Print the visited rooms to the console
    console.log('Visited Rooms:', Array.from(visitedRooms));
    console.log('Room History:', roomConversationHistories);
  } else if (!matchingConsole) {
    const roomEntry = roomNameDatabase.get(coordinatesString);
    roomName = roomEntry ? roomEntry.name : `Room ${coordinatesString}`;
    exits = generateUniqueExits(currentCoordinates, conversationHistory);
    // Example usage: update unvisited rooms set whenever roomNameDatabase or visitedRooms changes
updateUnvisitedRoomsSet(currentCoordinates);
    
    // Populate adjacent rooms from the database
    let adjacentRoomsObject = populateAdjacentRoomsFromDatabase(currentCoordinates, exits);
    adjacentRooms = Object.entries(adjacentRoomsObject)
        .map(([direction, name]) => `${direction}: ${name}`) // This line should use backticks for template literals
        .join(', ');
    
    console.log("adjacentRooms:", adjacentRooms);

    // Check if there's a chance to add equipment to the room
    // Check if there's a chance to add equipment to the room

// Inside the code where new items are randomly generated, add XP to PC and NPCs
if (Math.random() < 1.0) {
  const randomEquipment = equipmentItems[Math.floor(Math.random() * equipmentItems.length)];

  if (!roomEquipment.some(existingObject => areItemsEqual(existingObject, randomEquipment))) {
    roomEquipment.push(randomEquipment);

    // Add XP to PC
    characters.forEach(char => {
   
        char.XP += experienceToAdd; // Add XP to PC
     
    });

    // Add XP to NPCs
    npcs.forEach(npc => {
      npc.XP += experienceToAdd; // Add XP to NPCs
    });
  }
}
    // Update the visited rooms set with the current room's coordinates
    visitedRooms.add(currentCoordinates);
    // Print the visited rooms to the console
    console.log('Visited Rooms:', Array.from(visitedRooms));
    console.log('Room History:', roomConversationHistories);
  } else {
  const lines = conversationHistory.split("\n");
  const coordinatesIndex = lines.indexOf(matchingConsole);
  if (coordinatesIndex !== -1 && lines.length >= coordinatesIndex + 4) {
    exits = lines[coordinatesIndex + 3].replace("Exits: ", "").split(", ");
   // Populate adjacent rooms from the database
   // adjacentRooms = populateAdjacentRoomsFromDatabase(currentCoordinates); 
    // Extract equipment from the conversation history
  updateRoomConversationFirstResponse(currentCoordinates, serverGameConsole);
  const roomHistoryObj = getFirstResponseForRoom(currentCoordinates); // Get the room's first response based on coordinates
if (roomHistoryObj) {
    // Ensure that roomName and roomHistory are updated based on the first response in the room's conversation history
    roomName = roomHistoryObj.roomName; // Provide a default if undefined
    roomHistory = roomHistoryObj.roomHistory;
    puzzleInRoom = roomHistoryObj.puzzleInRoom;
    puzzleSolution = roomHistoryObj.puzzleSolution;
    exits = roomHistoryObj.roomExits;

    if (roomHistoryObj.adjacentRooms) {
        const adjacentRoomsObject = roomHistoryObj.adjacentRooms;

        console.log("adjacentRooms before conversion:", adjacentRoomsObject);

        // Since adjacentRoomsObject is already an array, we just need to join it
        adjacentRooms = adjacentRoomsObject.join(', ');

        console.log("adjacentRooms after conversion:", adjacentRooms);
    }
    // Update roomConnections for connected and unconnected rooms
    updateRoomConnections(currentCoordinates, exits);
    
    // Ensure coordinates of connected rooms are updated
    if (roomConnections[coordinatesToString(currentCoordinates)]) {
        const connectedRoomsString = roomConnections[coordinatesToString(currentCoordinates)].connectedRooms
            .map(room => coordinatesToString(room))
            .join('; ');
        console.log("Connected Rooms String:", connectedRoomsString);
    }
    
    updateUnvisitedRoomsSet(currentCoordinates);
 //   monstersInRoomString = roomHistoryObj.monstersInRoom[1];// Provide a default if undefined
    console.log("Room History Object:", roomHistoryObj);
console.log("Full object inspection:", JSON.stringify(roomHistoryObj, null, 2));
}
    if (
  roomConversationHistories[coordinatesString] &&
  roomConversationHistories[coordinatesString].length > 0
) {
  // Get the last item in the room's conversation history
  const lastRoomHistory =
    roomConversationHistories[coordinatesString][
      roomConversationHistories[coordinatesString].length - 1
    ];

                    // Get second last history entry (where objectMetadata is expected)
                    const secondLastRoomHistory =
                        roomConversationHistories[coordinatesString][
                            roomConversationHistories[coordinatesString].length - 2
                        ];

                    // Update roomEquipment
                    if (lastRoomHistory.roomEquipment) {
                        roomEquipment = lastRoomHistory.roomEquipment;
                    }

                    // Update objectMetadata
                    if (secondLastRoomHistory.objectMetadata) {
                        objectMetadata = secondLastRoomHistory.objectMetadata;
                    } 
}

    // Check if the item to take is in the inventory
//    if (inventory.includes(itemToTake)) {
      // Remove the item from "Objects in Room"
//      roomEquipment = roomEquipment.filter(obj => obj !== itemToTake);
//    }
    
    visitedRooms.add(currentCoordinates);
    console.log('recentCoordinates:', recentCoordinates); // Log recentCoordinates every turn
    // Print the visited rooms to the console
    console.log('Visited Rooms:', Array.from(visitedRooms));
    console.log('Room History:', roomConversationHistories);
  } else {
      exits = [];
    }
  }
  
// Check if there are additional objects in the room's conversation history
if (roomConversationHistories[coordinatesString] && roomConversationHistories[coordinatesString].length > 0) {
  // Get the first response from the room's conversation history
  const firstResponse = roomConversationHistories[coordinatesString][0].response;

  // Create a regular expression pattern to match any equipment item from the list
  const equipmentPattern = new RegExp(`\\b(${equipmentItems.map(item => escapeRegExp(item)).join('|')})\\b`, 'gi');

  // Find all equipment items mentioned in the first response
//  const mentionedEquipment = Array.from(new Set(firstResponse.match(equipmentPattern) || []));

  // Filter out equipment that is already in the room's equipment or have a similar name
//  const newAdditionalEquipment = mentionedEquipment
 //   .map(item => item.trim()) // Remove leading and trailing whitespace
 //   .filter(item => !roomEquipment.some(existingItem => areItemsEqual(existingItem, item)));

// Create a new array to store the combined equipment
//const combinedEquipment = roomEquipment.concat(newAdditionalEquipment);

// Update roomEquipment with the combined equipment
//roomEquipment = combinedEquipment;
}

// Check if the last user input was "search room" based on userWords
/*const isSearchRoom = userWords.length >= 2 && userWords.slice(-2).join(" ").toLowerCase() === "search room";
console.log('userWords:', userWords);
console.log('isSearchRoom:', isSearchRoom);

if (isSearchRoom && roomConversationHistories[coordinatesToString(currentCoordinates)] && roomConversationHistories[coordinatesToString(currentCoordinates)].length > 0) {
  // Get the most recent response from the room's conversation history
  const mostRecentResponse = roomConversationHistories[coordinatesToString(currentCoordinates)][roomConversationHistories[coordinatesToString(currentCoordinates)].length - 1].response;

  // Create a regular expression pattern to match any equipment item from the list
  const equipmentPattern = new RegExp(`\\b(${equipmentItems.map(item => escapeRegExp(item)).join('|')})\\b`, 'gi');

  // Find all equipment items mentioned in the most recent response
  const mentionedEquipment = Array.from(new Set(mostRecentResponse.match(equipmentPattern) || []));
    
// Filter out equipment that is already in the room's equipment, have a similar name, or is in the player's inventory
const newAdditionalEquipment = mentionedEquipment
  .map(item => item.trim().toLowerCase()) // Convert to lowercase and remove leading/trailing whitespace
  .filter(item => {
    // Check if the item is not a substring of any existing equipment except the most recent room response
    return  !roomEquipment.slice(0, -1).some(existingItem => existingItem.toLowerCase().includes(item)) && !inventory.some(existingItem => existingItem.toLowerCase().includes(item)) || 
        !roomEquipment.includes(item) ||
        !roomEquipment.some(existingItem => existingItem.toLowerCase().includes(item)); // Check if the item is not similar to any existing equipment
  });


// Check if roomEquipment is empty
if (roomEquipment.length < 1) {
  // If it's empty, set roomEquipment to newAdditionalEquipment
  roomEquipment = newAdditionalEquipment;
} else {
  // If it's not empty, combine roomEquipment and newAdditionalEquipment
  roomEquipment = roomEquipment.concat(newAdditionalEquipment);
}

  let combinedEquipment = [...new Set(roomEquipment.concat(newAdditionalEquipment))];
  objectsInRoomString = combinedEquipment;
  if (objectsInRoomString.length > 0) {
  // Remove "None" or "None " if they exist in the array
  objectsInRoomString = objectsInRoomString.filter(item => item !== "None" && item !== "None ");
}
  itemsInRoom = objectsInRoomString;
  roomEquipment = objectsInRoomString;

  console.log('objectsInRoomString:', objectsInRoomString);
  console.log('itemsInRoom:', itemsInRoom);

  // Use the getFirstResponseForRoom function to get the first response
  const firstResponseForRoom = getFirstResponseForRoom(currentCoordinates);

  if (firstResponseForRoom) {
    // Add sentences to the first response about the newly found equipment
    const addedSentences = newAdditionalEquipment.map(item => `There is ${item} here.`);
    firstResponseForRoom.response = `${firstResponseForRoom.response} ${addedSentences.join(' ')}`;equip
  }
}

    // Include the equipped items in the game console
/*const equippedItemsString = characters[0].Equipped
    ? Object.entries(characters[0].Equipped)
        .map(([slot, item]) => `${slot}: ${item ? item.name : 'None'}`)
        .join(", ")
    : "None";
    console.log(`Equipped items string: ${equippedItemsString}`);*/

    // Format character stats for display
/*    const characterStatsString = `
        Attack: ${characters[0].Attack}
        Damage: ${characters[0].Damage}
        Armor: ${characters[0].Armor}
    `.trim().replace(/^\s+/gm, ''); // Trim and remove leading spaces*/

// Create the character based on the player's choice
let character = null;


// Construct a string to represent all characters in the characters array
let charactersString = characters.map((char, index) => {
    // Ensure char.Equipped is defined and is an object
    if (!char.Equipped) {
        char.Equipped = {
            Weapon: null,
            Armor: null,
            Shield: null,
            Other: null
        };
    }

    const equippedItemsString = Object.entries(char.Equipped)
        .map(([slot, item]) => `${slot}: ${item ? item.name : 'None'}`)
        .join(", ");
    const totalAC = char.AC + (char.Armor || 0);
    return `${char.Name}
      ${char.Sex}
      ${char.Race}
      ${char.Class}
      Level: ${char.Level}
      AC: ${totalAC}
      XP: ${char.XP}
      HP: ${char.HP}
      MaxHP: ${char.MaxHP}
      Equipped: ${equippedItemsString}
      Attack: ${char.Attack}
      Damage: ${char.Damage}
      Armor: ${char.Armor}
      Magic: ${char.Magic}`;
}).join("\n");

if (userInput === '1' && charactersString.length <= 0) {
  userInput = document.getElementById("chatuserinput").value;
  document.getElementById("chatuserinput").value = "";
  userWords = "";
  character = createMortaciaCharacter();
} else if (userInput === '2' && charactersString.length <= 0) {
  userInput = document.getElementById("chatuserinput").value;
  document.getElementById("chatuserinput").value = "";
  userWords = "";
  character = createSuzerainCharacter();
} else if (userInput === '3' && charactersString.length <= 0) {
    userInput = document.getElementById("chatuserinput").value;
  document.getElementById("chatuserinput").value = "";
  userWords = "";
    character = createCharacter();
}

// Create a string representing NPCs and Mortacia
let npcsString = npcs.length > 0
  ? npcs.map((char, index) => {
    // Ensure char.Equipped is defined and is an object
    if (!char.Equipped) {
        char.Equipped = {
            Weapon: null,
            Armor: null,
            Shield: null,
            Other: null
        };
    }

    const equippedItemsString = Object.entries(char.Equipped)
        .map(([slot, item]) => `${slot}: ${item ? item.name : 'None'}`)
        .join(", ");
    const totalAC = char.AC + (char.Armor || 0);
    return `${char.Name}
        ${char.Sex}
        ${char.Race}
        ${char.Class}
        Level: ${char.Level}
        AC: ${totalAC}
        XP: ${char.XP}
        HP: ${char.HP}
        MaxHP: ${char.MaxHP}
        Equipped: ${equippedItemsString}
        Attack: ${char.Attack || 0}
        Damage: ${char.Damage || 0}
        Armor: ${char.Armor || 0}
        Magic: ${char.Magic || 0}`;
  }).join('\n')
  : "None";



// Helper function to parse the Equipped string into an object
function parseEquippedString(equippedStr) {
    const equippedObj = {};
    const items = equippedStr.split(',').map(item => item.trim());
    items.forEach(item => {
        const [slot, itemName] = item.split(':').map(part => part.trim());
        equippedObj[slot] = itemName;
    });
    return equippedObj;
}

// Your modified code for adding monsters to NPCs
const addMonsterToPartyPattern = /^add\s+([a-zA-Z\s]+)\s+to\s+party$/i;

if (addMonsterToPartyPattern.test(userInput)) {
    const match = userInput.match(addMonsterToPartyPattern);
    const monsterName = match[1].trim(); // Extract the monster name

    // Find the index of the monster in monstersInRoom
    const monsterIndex = monstersInRoom.findIndex(
        (monster) => monster.Name.toLowerCase() === monsterName.toLowerCase()
    );

    if (monsterIndex !== -1) {
        // Get the monster details
        const monsterDetails = monstersInRoom[monsterIndex];

        console.log('Monster Details:', monsterDetails);

        // Parse the Equipped string into an object
        let equippedObj = {};
        if (typeof monsterDetails.Equipped === 'string') {
            equippedObj = parseEquippedString(monsterDetails.Equipped);
        } else if (typeof monsterDetails.Equipped === 'object') {
            equippedObj = monsterDetails.Equipped;
        }

        console.log('Parsed Equipped Object:', equippedObj);

        // Capture the equipped items before resetting them
        const equippedSlots = ["Weapon", "Armor", "Shield", "Other"];
        const itemsToTransfer = {};
        equippedSlots.forEach(slot => {
            const item = equippedObj[slot];
            if (item && item !== "None") {
                itemsToTransfer[slot] = item;
            }
        });

        console.log('Items to Transfer:', itemsToTransfer);

        // Transfer the items to inventory
        const itemsTransferred = [];
        for (const [slot, item] of Object.entries(itemsToTransfer)) {
            if (item !== "None" && item !== null) {
                // Add the item to the inventory
                inventory.push(item);
                itemsTransferred.push(item); // Keep track of the transferred items
                // Find the item's properties in monstersEquippedProperties
                const itemPropertiesIndex = monstersEquippedProperties.findIndex(prop => prop.name === item);
                if (itemPropertiesIndex !== -1) {
                    inventoryProperties.push(JSON.stringify(monstersEquippedProperties[itemPropertiesIndex]));
                    // Remove the item's properties from Monsters Equipped Properties
                    monstersEquippedProperties.splice(itemPropertiesIndex, 1);
                }
            }
        }

        console.log('Updated Inventory:', inventory);
        console.log('Updated Inventory Properties:', inventoryProperties);

        // Now reset the equipped items
        monsterDetails.AC = 10;
        monsterDetails.Attack = 0;
        monsterDetails.Damage = 0;
        monsterDetails.Armor = 0;
        monsterDetails.Magic = 0;
        monsterDetails.Equipped = {
            Weapon: null,
            Armor: null,
            Shield: null,
            Other: null
        };

        // Remove the monster from monstersInRoom
        monstersInRoom.splice(monsterIndex, 1);

        // Add the removed monster to npcs
        npcs.push(monsterDetails);

        // Equip the transferred items to the newly added NPC
        itemsTransferred.forEach(item => {
            const equipResult = equipItem(item, monsterName);
            console.log(equipResult);
            conversationHistory += `\n${equipResult}`;
        });

        // Format the list of monsters in the current room as a string
        const monstersInRoomStringUpdated = monstersInRoom
            .map((monster) => {
                let equippedItemsString = '';
                if (typeof monster.Equipped === 'object') {
                    equippedItemsString = Object.entries(monster.Equipped)
                        .map(([slot, item]) => `${slot}: ${item}`)
                        .join(", ");
                } else {
                    equippedItemsString = monster.Equipped;
                }
                return `${monster.Name}
                ${monster.Sex}
                ${monster.Race}
                ${monster.Class}
                Level: ${monster.Level}
                AC: ${monster.AC}
                XP: ${monster.XP}
                HP: ${monster.HP}
                MaxHP: ${monster.MaxHP}
                Equipped: ${equippedItemsString}
                Attack: ${monster.Attack}
                Damage: ${monster.Damage}
                Armor: ${monster.Armor}
                Magic: ${monster.Magic}`;
            })
            .join("\n");

        // Format the list of NPCs as a string
        const npcsStringUpdated = npcs
            .map((char, index) => {
                let equippedItemsString = '';
                if (typeof char.Equipped === 'object') {
                    equippedItemsString = Object.entries(char.Equipped)
                        .map(([slot, item]) => `${slot}: ${item}`)
                        .join(", ");
                } else {
                    equippedItemsString = char.Equipped;
                }
                return `${char.Name}
                ${char.Sex}
                ${char.Race}
                ${char.Class}
                Level: ${char.Level}
                AC: ${char.AC}
                XP: ${char.XP}
                HP: ${char.HP}
                MaxHP: ${char.MaxHP}
                Equipped: ${equippedItemsString}
                Attack: ${char.Attack}
                Damage: ${char.Damage}
                Armor: ${char.Armor}
                Magic ${char.Magic}`;
            })
            .join("\n");

        // Append the result to the conversation history
        conversationHistory += `\nYou added ${monsterName} to the party.\n`;
        conversationHistory += `\nMonsters in the room:\n${monstersInRoomStringUpdated}\n`;
        conversationHistory += `\nNPCs in the party:\n${npcsStringUpdated}\n`;
    } else {
        // Handle the case where the specified monster was not found in the room
        conversationHistory += `\n${monsterName} is not in the room.\n`;
    }
}

// Your code for removing a character from NPCs and putting it back in Monsters
const removeMonsterFromPartyPattern = /^remove\s+([a-zA-Z\s]+)\s+from\s+party$/i;

if (removeMonsterFromPartyPattern.test(userInput)) {
    const match = userInput.match(removeMonsterFromPartyPattern);
    const characterName = match[1].trim(); // Extract the character name

    // Find the index of the character in npcs
    const characterIndex = npcs.findIndex(
        (character) => character.Name.toLowerCase() === characterName.toLowerCase()
    );

    if (characterIndex !== -1) {
        // Get the character details
        const characterDetails = npcs[characterIndex];

        // Unequip all items from the character and store them in the inventory
        const equippedSlots = ["Weapon", "Armor", "Shield", "Other"];
        const unequippedItems = [];

        equippedSlots.forEach(slot => {
            const item = characterDetails.Equipped[slot];
            if (item) {
                const unequipResult = unequipItem(item.name, characterName);
                console.log(unequipResult);
                conversationHistory += `\n${unequipResult}`;
                unequippedItems.push(item.name);
            }
        });

        // Remove the character from npcs
        npcs.splice(characterIndex, 1);

        // Reset the modifiers for the new monster version
        characterDetails.Attack = 0;
        characterDetails.Damage = 0;
        characterDetails.Armor = 0;
        characterDetails.Magic = 0;

        // Add the removed character back to monstersInRoom
        monstersInRoom.push(characterDetails);

        // Transfer the unequipped items from inventory to the monster's Equipped slots and Monsters Equipped Properties
        unequippedItems.forEach(itemName => {
            // Find the item in the inventory
            const itemIndex = inventory.findIndex(item => item.toLowerCase() === itemName.toLowerCase());
            if (itemIndex === -1) {
                conversationHistory += `\nItem ${itemName} not found in inventory.`;
                return;
            }

            // Find the item's properties in the inventoryProperties
            const itemPropertyIndex = inventoryProperties.findIndex(prop => {
                const propObj = eval('(' + prop + ')');
                return propObj.name.toLowerCase() === itemName.toLowerCase();
            });

            if (itemPropertyIndex === -1) {
                conversationHistory += `\nProperties for ${itemName} not found in inventoryProperties.`;
                return;
            }

            const itemProperties = eval('(' + inventoryProperties[itemPropertyIndex] + ')');

            // Determine the slot for the item
            let slot;
            if (itemProperties.type === 'weapon') {
                slot = 'Weapon';
            } else if (itemProperties.type === 'armor') {
                slot = 'Armor';
            } else if (itemProperties.type === 'shield') {
                slot = 'Shield';
            } else {
                slot = 'Other';
            }

            // Equip the item back to the monster's Equipped slot
            characterDetails.Equipped[slot] = itemProperties;

            // Add the item properties back to Monsters Equipped Properties
            monstersEquippedProperties.push({
                name: itemProperties.name,
                type: itemProperties.type,
                attack_modifier: itemProperties.attack_modifier || 0,
                damage_modifier: itemProperties.damage_modifier || 0,
                ac: itemProperties.ac || 0,
                magic: itemProperties.magic || 0
            });

            // Apply the item's modifiers to the monster's stats
            characterDetails.Attack += itemProperties.attack_modifier || 0;
            characterDetails.Damage += itemProperties.damage_modifier || 0;
            characterDetails.Armor += itemProperties.ac || 0;
            characterDetails.Magic += itemProperties.magic || 0;

            // Remove the item from inventory and inventoryProperties
            inventory.splice(itemIndex, 1);
            inventoryProperties.splice(itemPropertyIndex, 1);
        });

        // Ensure that only the removed character's Equipped items are serialized for display
        const updatedMonster = monstersInRoom.find(monster => monster.Name === characterDetails.Name);
        if (updatedMonster) {
            const equippedItemsString = Object.entries(updatedMonster.Equipped)
                .map(([slot, item]) => `${slot}: ${item ? item.name : 'None'}`)
                .join(", ");
            updatedMonster.Equipped = equippedItemsString;
        }

        // Format the list of NPCs as a string
        const npcsStringUpdated = npcs
            .map((char, index) => {
                let equippedItemsString = '';
                if (char.Equipped && typeof char.Equipped === 'object') {
                    equippedItemsString = Object.entries(char.Equipped)
                        .map(([slot, item]) => `${slot}: ${item ? item.name || item : 'None'}`)
                        .join(", ");
                } else {
                    equippedItemsString = char.Equipped || 'None';
                }
                return `${char.Name}
                ${char.Sex}
                ${char.Race}
                ${char.Class}
                Level: ${char.Level}
                AC: ${char.AC}
                XP: ${char.XP}
                HP: ${char.HP}
                MaxHP: ${char.MaxHP}
                Equipped: ${equippedItemsString}
                Attack: ${char.Attack}
                Damage: ${char.Damage}
                Armor: ${char.Armor}
                Magic: ${char.Magic}`;
            })
            .join("\n");

        // Format the list of monsters in the current room as a string
        const monstersInRoomStringUpdated = monstersInRoom
            .map((monster) => {
                return `${monster.Name}
                ${monster.Sex}
                ${monster.Race}
                ${monster.Class}
                Level: ${monster.Level}
                AC: ${monster.AC}
                XP: ${monster.XP}
                HP: ${monster.HP}
                MaxHP: ${monster.MaxHP}
                Equipped: ${monster.Equipped}
                Attack: ${monster.Attack}
                Damage: ${monster.Damage}
                Armor: ${monster.Armor}
                Magic: ${monster.Magic}`;
            })
            .join("\n");

        // Append the result to the conversation history
        conversationHistory += `\nYou removed ${characterName} from the party.\n`;
        conversationHistory += `\nMonsters in the room:\n${monstersInRoomStringUpdated}\n`;
        conversationHistory += `\nNPCs in the party:\n${npcsStringUpdated}\n`;

        // Now, call the displayAllNPCData function to update the displayed data for all NPC slots
        for (let i = 0; i < 6; i++) {
            displayAllNPCData(npcsStringUpdated, i);
        }
    } else {
        // Handle the case where the specified character was not found in the party
        conversationHistory += `\n${characterName} is not in the party.\n`;
    }
}

  // Format the inventory as a string
  const inventoryString = inventory.length > 0 ? inventory.join(", ") : "Empty";
  // Format the exits as a string
  const exitsString = exits.join(", ");
  // Format the equipment items as a string
  const equipmentString = roomEquipment.length > 0 ? roomEquipment.map(item => item.trim()).join(", ") : "None";
  //  const metadataString = objectMetadata.length > 0 ? objectMetadata.map(item => item.trim()).join(", ") : "None";
 // const metadataString = objectMetadata.length > 0 ? objectMetadata.map(prop => JSON.stringify(prop)).join(", ") : "None";
   //  const inventoryPropertiesString = objectMetadata.length > 0 ? inventoryProperties.map(item => item.trim()).join(", ") : "None";
    const metadataString = objectMetadata.length > 0 ? objectMetadata.map(item => item.trim()).join(", ") : "None";
         // Format objectMetadata as a string of objects
  //  const metadataString = objectMetadata.length > 0 ? objectMetadata.join(', ') : "None";

    // Format inventoryProperties as a string of objects
    const inventoryPropertiesString = inventoryProperties.length > 0 ? inventoryProperties.join(', ') : "None";

    // Convert monstersEquippedProperties to a formatted string
    monstersEquippedPropertiesString = monstersEquippedProperties.length > 0
        ? monstersEquippedProperties.map(equip => `{name: "${equip.name}", type: "${equip.type}", attack_modifier: ${equip.attack_modifier}, damage_modifier: ${equip.damage_modifier}, ac: ${equip.ac}, magic: ${equip.magic}}`).join(', ')
        : "None";


 // const inventoryPropertiesString = inventoryProperties.length > 0 ? inventoryProperties.map(prop => JSON.stringify(prop)).join(", ") : "None";
    console.log("equipmentString:", equipmentString);
  console.log("metadataString:", metadataString);
  console.log("objectMetadata:", objectMetadata);
  console.log("inventoryPropertiesString:", inventoryPropertiesString);
  console.log("inventoryProperties:", inventoryProperties);
  
    // Use the object metadata directly as a plain text string
 // const metadataString = objectMetadata.length > 0 ? objectMetadata.map(prop => JSON.stringify(prop)).join(", ") : "None";
//  const inventoryPropertiesString = inventoryProperties.length > 0 ? inventoryProperties.map(prop => JSON.stringify(prop)).join(", ") : "None";

  // Calculate the number of visited rooms
  const numVisitedRooms = calculateNumVisitedRooms();
  // Calculate the connected rooms
  const connectedRooms = calculateConnectedRooms(currentCoordinates);

  // Format the list of connected rooms as a string
  const connectedRoomsString = connectedRooms.join("; ");

  // Display PC and NPC data

displayAllNPCData(npcsString, 0);
displayAllNPCData(npcsString, 1);
displayAllNPCData(npcsString, 2);
displayAllNPCData(npcsString, 3);
displayAllNPCData(npcsString, 4);
displayAllNPCData(npcsString, 5);
displayPCData(charactersString);

completeQuestIfArtifactFound();
score = (globalArtifactsFound * 55) + (globalQuestsAchieved * 55);

// Return the updated game console as a formatted string
  return `
Seed: 
Room Name: ${roomName}
Room Description: ${roomHistory}
Coordinates: X: ${x}, Y: ${y}, Z: ${z}
Objects in Room: ${equipmentString}
Objects in Room Properties: ${metadataString}
Exits: ${exitsString}
Score: ${score}
Puzzle in Room: ${puzzleInRoom}
Puzzle Solution: ${puzzleSolution}
Artifacts Found: ${globalArtifactsFound}/15
Quests Achieved: ${globalQuestsAchieved}/21
Next Artifact: ${nextArtifact}
Next Boss: ${nextBoss}
Next Boss Room: ${nextBossRoom}
Boss Room Coordinates: ${bossCoordinates}
Current Quest: ${currentQuest}
Inventory: ${inventoryString}
Inventory Properties: ${inventoryPropertiesString}
Turns: ${turns}
PC: ${charactersString}
NPCs in Party: ${npcsString}
Monsters in Room: ${monstersInRoomString}
Monsters Equipped Properties: ${monstersEquippedPropertiesString}
Monsters State: ${monstersState}
Rooms Visited: ${numVisitedRooms}
Adjacent Rooms: ${adjacentRooms}
Coordinates of Connected Rooms: ${connectedRoomsString}
`; // Add characters to the game console
return; 
}

// Function to display PC data in the PC column
function displayPCData(charactersString) {
  const pcColumn = document.querySelector('.character-column:nth-child(1)');

  // Clear the PC column first
  pcColumn.innerHTML = '';

  // Add the PC data
  pcColumn.innerHTML += `
    <b>PC:</b><br>
    ${charactersString.replace(/\n/g, '<br>')} <!-- Replace newlines with <br> tags -->
  `;
}

// Modify displayAllNPCData to append HTML instead of overwriting
function displayAllNPCData(npcsString, npcNumber, removedCharacterName, npcsStringUpdated) {
  // Check if npcsStringUpdated is available and use it as the first option
  if (npcsStringUpdated) {
    npcsString = npcsStringUpdated;
  }

  // Split the NPCs' data by lines
  let npcDataLines = npcsString.split('\n');

  // Calculate the number of lines per NPC dynamically (assuming each NPC has 8 lines)
  const linesPerNPC = 14;

  // Find the corresponding <td> element by index
  const npcDataElement = document.querySelectorAll('.character-column')[npcNumber + 1]; // +1 to account for the PC column

  // Clear the HTML content of the NPC slot
  npcDataElement.innerHTML = '';

  // Calculate the start and end indices for the desired NPC
  const startIndex = npcNumber * linesPerNPC; // Adjusted to start from 0
  const endIndex = startIndex + linesPerNPC;

  if (startIndex >= 0 && endIndex <= npcDataLines.length) {
    // Create an HTML string for the specified NPC
    const npcHTML = `
      <div class="npc-data">
      <b>NPCs:</b><br>
        ${npcDataLines.slice(startIndex, endIndex).join('<br>')}
      </div>
    `;

    // Append the generated HTML string to the <td> element's innerHTML
    npcDataElement.innerHTML += npcHTML;
  } else {
    // Display a message if the specified NPC number is out of range
    console.log('NPC not found.');
  }
}


function calculateNumVisitedRooms() {
  return visitedRooms.size;
}

function calculateConnectedRooms(currentCoordinates) {
  // Check if the roomConnections entry exists for the current room
  const roomConnection = roomConnections[coordinatesToString(currentCoordinates)];
  if (!roomConnection) {
    return [];
  }

  // Get the connected rooms for the current room and extract their coordinates
  const connectedRooms = roomConnection.connectedRooms.map(coordObj => coordinatesToString(coordObj));

  return connectedRooms;
}


function getAdjacentCoordinates(coordinates) {
  const adjacentCoordinates = new Set();
  const validOffsets = [
    { x: 0, y: 1, z: 0 }, // north
    { x: 0, y: -1, z: 0 },  // south
    { x: 1, y: 0, z: 0 },  // east
    { x: -1, y: 0, z: 0 }, // west
    { x: 1, y: 1, z: 0 },  // northeast
    { x: -1, y: 1, z: 0 }, // northwest
    { x: 1, y: -1, z: 0 }, // southeast
    { x: -1, y: -1, z: 0 },// southwest
    { x: 0, y: 0, z: 1 },  // up
    { x: 0, y: 0, z: -1 }, // down
  ];

  for (const offset of validOffsets) {
    const adjacentCoord = {
      x: coordinates.x + offset.x,
      y: coordinates.y + offset.y,
      z: coordinates.z + offset.z,
    };
    adjacentCoordinates.add(coordinatesToString(adjacentCoord)); // Convert to string for comparison
  }

  return adjacentCoordinates;
}

function mapToPlainObject(map) {
    const obj = {};
    for (const [key, value] of map.entries()) {
        obj[key] = value;
    }
    return obj;
}

// Initialize the roomNameDatabase as a Map
// Initialize the roomNameDatabase as a Map
// Initialize the roomNameDatabase as a Map
const roomNameDatabase = new Map();
let roomNameDatabasePlainObject = {};
let roomNameDatabaseString = "";
let combatCharactersString = "";

// Function to convert coordinates object to a string
function coordinatesToString(coordinates) {
  return `${coordinates.x},${coordinates.y},${coordinates.z}`;
}

// Helper function to sync keys from roomNameDatabase to room conversation history
function syncKeysToRoomObjects(coordinates, serverGameConsole) {
  const coordinatesString = coordinatesToString(coordinates);
  const roomData = roomNameDatabase.get(coordinatesString) || { objects: [] };
  const keys = roomData.objects.filter(obj => obj.unlocks) || [];

  const roomEquipmentString = serverGameConsole.match(/Objects in Room: ([^\n]+)/)?.[1]?.trim() || "None";
  const roomEquipment = roomEquipmentString !== "None" ? roomEquipmentString.split(', ').map(item => item.trim()) : [];
  let objectMetadataString = serverGameConsole.match(/Objects in Room Properties: ([^\n]+)/)?.[1]?.trim() || "None";
  let objectMetadata = objectMetadataString !== "None" ? 
    objectMetadataString.split(/(?<=\}),\s*(?={)/).map(str => {
      try {
        return JSON.parse(str);
      } catch (e) {
        console.error(`Failed to parse object metadata: ${str}`, e);
        return {};
      }
    }) : [];

  keys.forEach(key => {
    if (!roomEquipment.includes(key.name)) {
      roomEquipment.push(key.name);
      const keyMetadata = {
        name: key.name,
        type: "key",
        attack_modifier: key.properties.attack || 0,
        damage_modifier: key.properties.damage || 0,
        ac: key.properties.ac || 0,
        magic: key.properties.magic || 0
      };
      objectMetadata.push(keyMetadata);
    }
  });

  const updatedRoomEquipmentString = roomEquipment.length > 0 ? roomEquipment.join(', ') : "None";
  const updatedObjectMetadataString = objectMetadata.length > 0 ? 
    objectMetadata.map(obj => `{name: "${obj.name}", type: "${obj.type}", attack_modifier: ${obj.attack_modifier}, damage_modifier: ${obj.damage_modifier}, ac: ${obj.ac}, magic: ${obj.magic}}`).join(', ') : 
    "None";

  let updatedGameConsole = serverGameConsole;
  updatedGameConsole = updatedGameConsole.replace(/Objects in Room: [^\n]+/, `Objects in Room: ${updatedRoomEquipmentString}`);
  updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: [^\n]+/, `Objects in Room Properties: ${updatedObjectMetadataString}`);

  if (!roomConversationHistories[coordinatesString]) {
    roomConversationHistories[coordinatesString] = [];
  }

  const roomHistoryEntry = roomConversationHistories[coordinatesString][0] || {};
  roomHistoryEntry.roomEquipment = roomEquipment;
  roomHistoryEntry.objectMetadata = objectMetadata;

  if (roomConversationHistories[coordinatesString].length === 0) {
    roomConversationHistories[coordinatesString].push(roomHistoryEntry);
  }

  return updatedGameConsole;
}

// Function to convert coordinates object to a string
function coordinatesToString(coordinates) {
  return `${coordinates.x},${coordinates.y},${coordinates.z}`;
}
function populateRoomNameDatabase(coordinates, adjacentRooms) {
  // ← NEW: Define helpers for type normalization (handles LLM strings on client)
  const getNumeric = (val) => typeof val === 'number' ? val : (typeof val === 'string' ? parseInt(val) || null : null);
  const getBoolean = (val) => typeof val === 'boolean' ? val : (typeof val === 'string' ? (val === 'true' ? true : val === 'false' ? false : null) : null);

  // --- 0. Upgrade any legacy string entries to full room objects ---
  for (const [key, raw] of roomNameDatabase.entries()) {
    if (typeof raw === "string") {
      roomNameDatabase.set(key, {
        name: raw,
        exhaustionLimit: null,
        attemptedSearches: 0,
        trapTriggered: false,
        exits: {},
        objects: [],
        monsters: {
          inRoom: "None",
          equippedProperties: "None",
          state: "None",
        },
        indoor: null,
        classification: {},  // Empty—let server own
        isIndoor: null,
        isOutdoor: null,
      });
    }
  }

  const currKey = coordinatesToString(coordinates);
  const startKey = coordinatesToString({ x: 0, y: 0, z: 0 });

  // Helper: ensure a room object has the full schema and sensible defaults,
  // but DO NOT destroy any server-provided fields.
  function ensureFullSchema(key, baseNameIfNew) {
    let room = roomNameDatabase.get(key);

    if (!room || typeof room !== "object") {
      // Completely new room: build from scratch with MINIMAL skeleton
      room = {
        name: baseNameIfNew || "Unnamed Room",
        exhaustionLimit: null,
        attemptedSearches: 0,
        trapTriggered: false,
        exits: {},
        objects: [],
        monsters: {
          inRoom: "None",
          equippedProperties: "None",
          state: "None",
        },
        indoor: (key === startKey) ? true : null,
        classification: {},  // Empty—triggers server fill
        isIndoor: (key === startKey) ? true : null,
        isOutdoor: (key === startKey) ? false : null,
      };
    } else {
      // Shallow copy so we don't mutate in weird ways
      room = { ...room };

      // Core fields: Only fill if truly undefined
      if (!room.name) room.name = baseNameIfNew || "Unnamed Room";
      if (room.exhaustionLimit === undefined) room.exhaustionLimit = null;
      if (room.attemptedSearches === undefined) room.attemptedSearches = 0;
      if (room.trapTriggered === undefined) room.trapTriggered = false;

      if (!room.exits || typeof room.exits !== "object") {
        room.exits = {};
      }
      if (!Array.isArray(room.objects)) {
        room.objects = [];
      }

      // Monsters
      if (!room.monsters || typeof room.monsters !== "object") {
        room.monsters = {
          inRoom: "None",
          equippedProperties: "None",
          state: "None",
        };
      } else {
        room.monsters = {
          inRoom: room.monsters.inRoom !== undefined ? room.monsters.inRoom : "None",
          equippedProperties: room.monsters.equippedProperties !== undefined ? room.monsters.equippedProperties : "None",
          state: room.monsters.state !== undefined ? room.monsters.state : "None",
        };
      }

      // Indoor base flag; 0,0,0 is always indoor
      if (typeof room.indoor !== "boolean") {
        room.indoor = (key === startKey) ? true : null;
      }

      // Classification skeleton: PRESERVE server data
      if (!room.classification || typeof room.classification !== "object") {
        room.classification = {};
      }
      const c = room.classification;

      // PRESERVE: Only fill undefined; normalize types for safety
      if (c.indoor === undefined) {
        c.indoor = getBoolean(room.indoor) ?? (key === startKey ? true : null);  // ← NEW: Normalize bool
      } else {
        c.indoor = getBoolean(c.indoor) ?? c.indoor;  // ← NEW: Normalize if string
      }
      if (c.size === undefined) c.size = null;
      else c.size = getNumeric(c.size) ?? null;  // ← INSERTED: Normalize size (string → number)
      if (c.biome === undefined) c.biome = null;
      if (c.features === undefined || !Array.isArray(c.features)) c.features = [];
      if (c.skyTop === undefined) c.skyTop = null;
      if (c.skyBot === undefined) c.skyBot = null;
      if (c.floorColor === undefined) c.floorColor = null;
      if (c.wallColor === undefined) c.wallColor = null;

      // isIndoor / isOutdoor flags: Infer only if undefined
      if (typeof room.isIndoor !== "boolean") {
        room.isIndoor = getBoolean(room.indoor) ?? getBoolean(c.indoor) ?? (key === startKey ? true : null);
      }
      if (typeof room.isOutdoor !== "boolean") {
        room.isOutdoor = typeof room.isIndoor === "boolean" ? !room.isIndoor : (key === startKey ? false : null);
      }
    }

    roomNameDatabase.set(key, room);
    return room;
  }

  // --- 1. Ensure the current room has the full schema ---
  let currentRoom = ensureFullSchema(currKey);

  // --- 2. Ensure all adjacent rooms exist with full schema ---
  for (const direction in adjacentRooms) {
    const newCoordinates = getCoordinatesForDirection(coordinates, direction);
    const newKey = coordinatesToString(newCoordinates);
    const roomName = adjacentRooms[direction];

    // Make sure the adjacent room entry is present and fully shaped
    ensureFullSchema(newKey, roomName);

    // Ensure the CURRENT room has an exit to that adjacent room
    if (!currentRoom.exits) currentRoom.exits = {};
    if (!currentRoom.exits[direction]) {
      currentRoom.exits[direction] = {
        status: "open",
        targetCoordinates: newKey,
        key: null,
      };
      roomNameDatabase.set(currKey, currentRoom);
    }
  }

  if (window.dungeonTestingMode && currKey === startKey) {
    const firstDirection = Object.keys(adjacentRooms)[0];
    if (firstDirection) {
      const firstCoords = getCoordinatesForDirection(coordinates, firstDirection);
      const firstKey = coordinatesToString(firstCoords);
      const firstRoom = ensureFullSchema(firstKey, adjacentRooms[firstDirection]);
      if (typeof firstRoom.indoor !== "boolean") {
        firstRoom.indoor = false;
        firstRoom.isIndoor = false;
        firstRoom.isOutdoor = true;
        if (!firstRoom.classification || typeof firstRoom.classification !== "object") {
          firstRoom.classification = {};
        }
        if (typeof firstRoom.classification.indoor !== "boolean") {
          firstRoom.classification.indoor = false;
        }
        roomNameDatabase.set(firstKey, firstRoom);
      }
    }
  }

  // --- 3. Rebuild the plain object & JSON string without stripping any fields ---
  roomNameDatabasePlainObject = mapToPlainObject(roomNameDatabase);
  roomNameDatabaseString = JSON.stringify(roomNameDatabasePlainObject);

  // ← NEW: Optional debug/warn for incomplete classifications (remove in prod)
  for (const [key, room] of roomNameDatabase) {
    const c = room.classification || {};
    if (Object.keys(c).length < 3) {  // e.g., missing shape (indoor, size, biome)
      console.warn(`Incomplete classification for ${key}:`, c);
    }
  }
}

// Function to check existing adjacent rooms in the database and populate Adjacent Rooms
// Function to check existing adjacent rooms in the database and populate Adjacent Rooms
function populateAdjacentRoomsFromDatabase(coordinates, exits, adjacentRooms = {}) {
  const offsets = {
    north:     { x: 0,  y: 1,  z: 0 },
    south:     { x: 0,  y: -1, z: 0 },
    east:      { x: 1,  y: 0,  z: 0 },
    west:      { x: -1, y: 0,  z: 0 },
    up:        { x: 0,  y: 0,  z: 1 },
    down:      { x: 0,  y: 0,  z: -1 },
    northeast: { x: 1,  y: 1,  z: 0 },
    northwest: { x: -1, y: 1,  z: 0 },
    southeast: { x: 1,  y: -1, z: 0 },
    southwest: { x: -1, y: -1, z: 0 },
  };

  // 🔹 Very minimal legacy support:
  // If any entry is *just* a string (old format), upgrade it to a full object.
  // DO NOT touch entries that are already objects with classification/isIndoor/isOutdoor/etc.
  for (const [key, value] of roomNameDatabase.entries()) {
    if (typeof value === "string") {
      roomNameDatabase.set(key, {
        name: value,
        exhaustionLimit: null,
        attemptedSearches: 0,
        trapTriggered: false,
        exits: {},
        objects: [],
        monsters: {
          inRoom: "None",
          equippedProperties: "None",
          state: "None",
        },
        // Let server / populateRoomNameDatabase own the real classification
        classification: undefined,
        isIndoor: undefined,
        isOutdoor: undefined,
        indoor: null,
      });
    }
  }

  // 🔹 ORIGINAL FUNCTIONALITY: use offsets + exits to fill adjacentRooms
  for (const direction in offsets) {
    if (!exits.includes(direction)) continue;

    const newCoordinates = getCoordinatesForDirection(coordinates, direction);
    const newCoordinatesString = coordinatesToString(newCoordinates);

    if (roomNameDatabase.has(newCoordinatesString)) {
      const roomData = roomNameDatabase.get(newCoordinatesString);
      if (roomData && typeof roomData === "object") {
        adjacentRooms[direction] = roomData.name || "Unknown Room";
      }
    }
  }

  return adjacentRooms;
}


// Function to check if an exit is traversable
function isExitTraversable(coordinates, direction) {
  const roomKey = coordinatesToString(coordinates);
  const room = roomNameDatabase.get(roomKey);
  if (!room || !room.exits || !room.exits[direction]) {
    return { traversable: false, message: "You can't go that way." }; // No exit exists
  }
  const exit = room.exits[direction];
  if (exit.status === "open") {
    return { traversable: true };
  }
  // Check if the player has the required key
/*  if (exit.key && inventory.includes(exit.key)) {
    // Unlock the exit permanently
    room.exits[direction].status = "open";
    roomNameDatabase.set(roomKey, room);
    roomNameDatabasePlainObject = mapToPlainObject(roomNameDatabase);
    roomNameDatabaseString = JSON.stringify(roomNameDatabasePlainObject);
    sharedState.setRoomNameDatabase(roomNameDatabaseString);
    return { traversable: true, message: `The ${direction} exit is unlocked using the ${exit.key}.` };
  }*/
  return { traversable: false, message: `The ${direction} exit is ${exit.status}. ${exit.key ? `The ${exit.key} is required to unlock it.` : "It cannot be traversed."}` };
}


// Function to calculate new coordinates based on direction
function getCoordinatesForDirection(coordinates, direction) {
  const offsets = {
    north: { x: 0, y: 1, z: 0 },
    south: { x: 0, y: -1, z: 0 },
    east: { x: 1, y: 0, z: 0 },
    west: { x: -1, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    down: { x: 0, y: 0, z: -1 },
    northeast: { x: 1, y: 1, z: 0 },
    northwest: { x: -1, y: 1, z: 0 },
    southeast: { x: 1, y: -1, z: 0 },
    southwest: { x: -1, y: -1, z: 0 },
  };

  const offset = offsets[direction] || { x: 0, y: 0, z: 0 };
  return {
    x: coordinates.x + offset.x,
    y: coordinates.y + offset.y,
    z: coordinates.z + offset.z,
  };
}



function generateVirtualRooms(startCoordinates, endCoordinates) {
    let virtualRooms = [];
    let currentCoordinates = { ...startCoordinates };
    
    while (!areCoordinatesEqual(currentCoordinates, endCoordinates)) {
        // Move towards the boss room in each axis until we reach it
        if (currentCoordinates.x !== endCoordinates.x) {
            currentCoordinates.x += currentCoordinates.x < endCoordinates.x ? 1 : -1;
        } else if (currentCoordinates.y !== endCoordinates.y) {
            currentCoordinates.y += currentCoordinates.y < endCoordinates.y ? 1 : -1;
        } else if (currentCoordinates.z !== endCoordinates.z) {
            currentCoordinates.z += currentCoordinates.z < endCoordinates.z ? 1 : -1;
        }
        
        virtualRooms.push({ ...currentCoordinates });
    }
    
    return virtualRooms;
}

function connectBossRoom(bossCoordinates) {
    const nearestRoom = findNearestUnvisitedRoom(bossCoordinates);
    if (!nearestRoom) {
        console.error("No nearest room found to connect the boss room.");
        return;
    }

    const virtualRooms = generateVirtualRooms(nearestRoom, bossCoordinates);

    let previousRoom = nearestRoom;

    for (let virtualRoom of virtualRooms) {
        const virtualRoomKey = coordinatesToString(virtualRoom);
        if (!roomConnections[virtualRoomKey]) {
            roomConnections[virtualRoomKey] = {
                coordinates: virtualRoom,
                exits: [],
                connectedRooms: [],
                unconnectedRooms: [],
            };
        }

        // Connect previous room to this virtual room
        const directionToVirtualRoom = getExitToCoordinate(previousRoom, virtualRoom);
        roomConnections[coordinatesToString(previousRoom)].connectedRooms.push(virtualRoom);
        roomConnections[coordinatesToString(previousRoom)].exits.push(directionToVirtualRoom);

        const directionToPreviousRoom = getExitToCoordinate(virtualRoom, previousRoom);
        roomConnections[virtualRoomKey].connectedRooms.push(previousRoom);
        roomConnections[virtualRoomKey].exits.push(directionToPreviousRoom);

        previousRoom = virtualRoom;
    }

    // Finally, connect the last virtual room to the boss room
    const bossRoomKey = coordinatesToString(bossCoordinates);
    if (!roomConnections[bossRoomKey]) {
        roomConnections[bossRoomKey] = {
            coordinates: bossCoordinates,
            exits: [],
            connectedRooms: [],
            unconnectedRooms: [],
        };
    }

    const directionToBossRoom = getExitToCoordinate(previousRoom, bossCoordinates);
    roomConnections[coordinatesToString(previousRoom)].connectedRooms.push(bossCoordinates);
    roomConnections[coordinatesToString(previousRoom)].exits.push(directionToBossRoom);

    const directionToPreviousRoom = getExitToCoordinate(bossCoordinates, previousRoom);
    roomConnections[bossRoomKey].connectedRooms.push(previousRoom);
    roomConnections[bossRoomKey].exits.push(directionToPreviousRoom);
}


// Function to check if two objects are equal
function areObjectsEqual(obj1, obj2) {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    if (obj1[key] !== obj2[key]) {
      return false;
    }
  }

  return true;
}


// Function to perform dynamic search using TF-IDF
async function performDynamicSearch(query, maxWordCount = 700) {
  // Retrieve the conversation history from IndexedDB
  const conversationId = localStorage.getItem("conversationId");
  const promptAndResponses = await getPromptsAndResponsesForConversation(conversationId);

  // Get the last 8 prompts and responses from the end of the array
  const last8PromptAndResponses = promptAndResponses.slice(-8);

  // Extract the prompts and responses
  const prompts = last8PromptAndResponses.map(item => item.prompt);
  const responses = last8PromptAndResponses.map(item => item.response);
  console.log("Last 8 responses:", last8PromptAndResponses);

  // Keywords to exclude
  const excludeKeywords = [
    "Seed:", "Room Description:", "Coordinates:", "Objects in Room:", 
    "Exits:", "XP:", "Score:", "Artifacts Found:", 
    "Quests Achieved:", "HP:", "Inventory:", "PC:", 
    "NPCs:", "Rooms Visited:", "Turns:", "north", "south", "east", "west", "northeast", "southeast", "northwest", "southwest", "up", "down"
  ];

  // Function to check if a line includes any of the exclude keywords
const shouldExcludeLine = (line) => line && excludeKeywords.some(keyword => line.toLowerCase().trim().includes(keyword.toLowerCase()));

  // Filter out lines that include exclude keywords
const filteredResponses = last8PromptAndResponses.filter(promptAndResponse => {
  const excluded = shouldExcludeLine(promptAndResponse.response); // Access response as promptAndResponse.response.response
  console.log(`Response ${promptAndResponse.response.response} excluded? ${excluded}`);
  return !excluded;
});
  // Preprocess the query and filtered responses (lowercase and remove punctuation)
  const preprocessText = (text) => text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");

  // Tokenize the query and responses into words (unigrams)
  const wordsInQuery = preprocessText(query).split(/\s+/);
  const wordsInResponses = promptAndResponses.map(promptAndResponse =>
    preprocessText(promptAndResponse.response).split(/\s+/)
  );

  // Calculate the TF-IDF scores for each word in the query and responses
  const wordTFIDFScores = {};
  const queryWordCounts = {};
  wordsInQuery.forEach(word => {
    queryWordCounts[word] = (queryWordCounts[word] || 0) + 1;
  });

  // Calculate Term Frequency (TF) for the query
  const queryWordTFIDFScores = {};
  Object.keys(queryWordCounts).forEach(word => {
    const termFrequency = queryWordCounts[word] / wordsInQuery.length;
    const inverseDocumentFrequency = Math.log(promptAndResponses.length / wordsInResponses.filter(words => words.includes(word)).length);
    queryWordTFIDFScores[word] = termFrequency * inverseDocumentFrequency;
  });

  // Calculate TF-IDF scores for words in the responses
  wordsInResponses.forEach((responseWords, responseIndex) => {
    responseWords.forEach(word => {
      if (!wordTFIDFScores[word]) {
        const termFrequency = responseWords.filter(w => w === word).length / responseWords.length;
        const inverseDocumentFrequency = Math.log(promptAndResponses.length / wordsInResponses.filter(words => words.includes(word)).length);
        wordTFIDFScores[word] = termFrequency * inverseDocumentFrequency;
      }
    });
  });

// Calculate the relevance score for each response and prompt
const responsePromptRelevanceScores = last8PromptAndResponses.map(({ prompt, response, index }) => {
  const responseWords = preprocessText(response).split(/\s+/);
  const promptWords = preprocessText(prompt).split(/\s+/);

  let relevanceScore = 0;

  responseWords.forEach(word => {
    if (queryWordTFIDFScores[word]) {
      relevanceScore += queryWordTFIDFScores[word] * wordTFIDFScores[word];
    }
  });

  promptWords.forEach(word => {
    if (queryWordTFIDFScores[word]) {
      relevanceScore += queryWordTFIDFScores[word] * wordTFIDFScores[word];
    }
  });

  return { prompt, response, relevanceScore, index };
});

// Sort the responses and prompts in chronological order first and then by relevance score
responsePromptRelevanceScores.sort((a, b) => {
  if (a.index === b.index) {
    // If responses/prompts have the same index, sort by relevance score
    return b.relevanceScore - a.relevanceScore;
  }
  // Otherwise, sort by index (chronological order)
  return a.index - b.index;
});

  // Sort the responses by original index (chronological order)
  filteredResponses.sort((a, b) => a.index - b.index);

// Calculate the total word count of selected sentences
let currentWordCount = 0;
const selectedResponsesPrompts = [];

for (const { prompt, response } of responsePromptRelevanceScores) {
  const promptWords = prompt.split(/\s+/);
  const responseWords = response.split(/\s+/);

  if (currentWordCount + promptWords.length + responseWords.length <= maxWordCount) {
    selectedResponsesPrompts.push({ prompt, response });
    currentWordCount += promptWords.length + responseWords.length;
  } else {
    break;
  }
}

  console.log("filteredResponses:", filteredResponses); // Debug: Print filtered responses

  // ... (rest of the code)

  console.log("responseRelevanceScores:", responsePromptRelevanceScores); // Debug: Print relevance scores

  // ... (rest of the code)

  console.log("selectedResponses:", selectedResponsesPrompts); // Debug: Print selected responses


// Join the selected responses and prompts into a single string
const selectedResults = last8PromptAndResponses.map(({ prompt, response }) => `${prompt}\n${response}`).join("\n\n");

return selectedResults;
  
}

var previousResponse = [];

function scrollToBottom() {
  window.scrollTo(0, document.body.scrollHeight);
}

/*// Function to translate shorthand commands into full commands
function translateShorthandCommands(userInput) {
  const shorthandMap = {
    'n': 'north',
    's': 'south',
    'e': 'east',
    'w': 'west',
    'nw': 'northwest',
    'sw': 'southwest',
    'ne': 'northeast',
    'se': 'southeast',
    'u': 'up',
    'd': 'down',
    'l': 'look',
    //'i': 'inventory'
    // Add more shorthand translations as needed
  };

  const words = userInput.toLowerCase().split(/\s+/);
  const translatedWords = words.map(word => shorthandMap[word] || word);
  return translatedWords.join(' ');
}*/


  let character = {
    Name: '',
    Sex: '',
    Race: '',
    Class: '',
    Level: 1,
    AC: 10,
    XP: 0,
    HP: 0,
    MaxHP: 0,
    Equipped: '',
    Attack: 0,
    Damage: 0,
    Armor: 0,
    Magic: 0,
  };

console.log('characters:', characters);

// Define character classes and their respective stats
const characterClasses = [
  { name: 'Knight of Atinus', hp: '10 + 1d10', description: 'God of War' },
  { name: 'Knight of Atricles', hp: '10 + 1d12', description: 'God of Justice' },
  { name: 'Wizard', hp: '5 + 1d6', description: 'a student of magic and the arcane arts.' },
  { name: 'Witch', hp: '5 + 1d6', description: 'Worships Mortacia, goddess of death' },
  { name: 'Necromancer', hp: '5 + 1d6', description: 'Worships Mortacia, goddess of death' },
  { name: 'Warlock', hp: '5 + 1d6', description: 'Powers come from within through possession and use of dark magic' },
  { name: 'Sorcerer', hp: '5 + 1d6', description: 'Powers come from within through possession and use of light magic' },
  { name: 'Thief', hp: '6 + 1d8', description: '' },
  { name: 'Assassin', hp: '6 + 1d8', description: '' },
  { name: 'Barbarian', hp: '6 + 1d12', description: '' },
];

const characterRaces = [
    { name: 'Human', description: '.' },
    { name: 'Dwarf', description: 'who mine the mountains.'},
    { name: 'High Elf', description: 'of light magic.' },
    { name: 'Unseelie Elf', description: 'of dark magic.' },
    { name: 'Half-Elf', description: '.' },
    { name: 'Halfling', description: '.' },
    { name: 'Fey', description: 'pixie-like creatures related to the elves.'},
    { name: 'Raakshasa', description: 'cat-like beings who tend to be dark sorcerers and necromancers.' },
    { name: 'Gnome', description: 'humanoids who thrive at the arts of invention.' },
];

// Define monster races
const monsterRaces = [
  { name: 'Orc', description: 'Savage and brutal' },
  { name: 'Goblin', description: 'Small and cunning' },
  { name: 'Dragonborn', description: 'Dragon-like humanoids' },
  { name: 'Aboleth', description: 'Mind-controlling horrors' },
  { name: 'Aboleth Mage', description: 'Powerful aboleth spellcasters' },
  { name: 'Achaierai', description: 'Four-legged, beak-faced fiends' },
  { name: 'Allip', description: 'Tormented, babbling undead' },
  { name: 'Angel', description: 'Celestial beings of light' },
  { name: 'Angel, Astral Deva', description: 'Noble astral angels' },
  { name: 'Angel, Planetar', description: 'Mighty planetar angels' },
  { name: 'Angel, Solar', description: 'Radiant solar angels' },
  { name: 'Animated Object', description: 'Inanimate objects brought to life' },
  { name: 'Ankheg', description: 'Giant insectoid burrowers' },
  { name: 'Aranea', description: 'Shape-shifting spider folk' },
  { name: 'Archon', description: 'Celestial servants of law' },
  { name: 'Lantern Archon', description: 'Small celestial beings of light' },
  { name: 'Hound Archon', description: 'Celestial dog-like guardians' },
  { name: 'Hound Archon Hero', description: 'Mighty hero among hound archons' },
  { name: 'Trumpet Archon', description: 'Celestial horn-blowing warriors' },
  { name: 'Arrowhawk', description: 'Airborne elemental creatures' },
  { name: 'Assassin Vine', description: 'Lurking, deadly plant creatures' },
  { name: 'Athach', description: 'Three-armed, one-eyed brutes' },
  { name: 'Avoral', description: 'Eagle-headed celestial beings' },
  { name: 'Azer', description: 'Fire-loving dwarf-like creatures' },
  { name: 'Barghest', description: 'Fiendish wolf-like creatures' },
  { name: 'Greater Barghest', description: 'Mightier fiendish barghests' },
  { name: 'Basilisk', description: 'Stone-gazing reptilian monsters' },
  { name: 'Abyssal Greater Basilisk', description: 'Monstrous abyssal variant' },
  { name: 'Behir', description: 'Serpentine lightning-breathing creatures' },
  { name: 'Belker', description: 'Smoke-form elemental creatures' },
  { name: 'Blink Dog', description: 'Teleporting canine creatures' },
  { name: 'Bodak', description: 'Horrific undead beings' },
  { name: 'Bralani', description: 'Eladrin-like celestial creatures' },
  { name: 'Bugbear', description: 'Large, vicious goblinoids' },
  { name: 'Bulette', description: 'Burrowing, shark-like monsters' },
  { name: 'Celestial Creature', description: 'Celestial beings' },
  { name: 'Centaur', description: 'Humanoid with horse lower body' },
  { name: 'Chaos Beast', description: 'Ever-changing, chaotic creatures' },
  { name: 'Chimera', description: 'Multi-headed, hybrid monsters' },
  { name: 'Choker', description: 'Stalking, tentacled creatures' },
  { name: 'Chuul', description: 'Aquatic, crab-like monstrosities' },
  { name: 'Cloaker', description: 'Cloak-like, shadowy creatures' },
  { name: 'Cockatrice', description: 'Bird-like creatures with petrifying gaze' },
  { name: 'Couatl', description: 'Feathered serpentine celestial beings' },
  { name: 'Darkmantle', description: 'Ceiling-dwelling, dark creatures' },
  { name: 'Delver', description: 'Subterranean tunneling creatures' },
  { name: 'Demon', description: 'Chaotic evil fiends' },
  { name: 'Babau', description: 'Abyssal demon assassins' },
  { name: 'Balor', description: 'Demonic lords of destruction' },
  { name: 'Bebilith', description: 'Abyssal arachnid demons' },
  { name: 'Dretch', description: 'Lowly, chaotic demons' },
  { name: 'Glabrezu', description: 'Powerful, monstrous demons' },
  { name: 'Hezrou', description: 'Toad-like, foul demons' },
  { name: 'Marilith', description: 'Serpentine, multi-armed demons' },
  { name: 'Nalfeshnee', description: 'Grotesque, gluttonous demons' },
  { name: 'Quasit', description: 'Impish, chaotic demons' },
  { name: 'Retriever', description: 'Construct-like, demonic hunters' },
  { name: 'Succubus', description: 'Seductive, shape-shifting demons' },
  { name: 'Vrock', description: 'Vulture-like, chaotic demons' },
  { name: 'Derro', description: 'Mad, subterranean dwarf-like creatures' },
  { name: 'Destrachan', description: 'Sonic-wielding, blind subterranean creatures' },
  { name: 'Devil', description: 'Lawful evil fiends' },
  { name: 'Barbed Devil (Hamatula)', description: 'Thorn-covered devils' },
  { name: 'Bearded Devil (Barbazu)', description: 'Bearded, spear-wielding devils' },
  { name: 'Bone Devil (Osyluth)', description: 'Skeletal, manipulative devils' },
  { name: 'Chain Devil (Kyton)', description: 'Chain-wielding, torturous devils' },
  { name: 'Erinyes', description: 'Whip-wielding, tempting devils' },
  { name: 'Hellcat (Bezekira)', description: 'Fiendish cat-like creatures' },
  { name: 'Horned Devil (Cornugon)', description: 'Horned, brutal devils' },
  { name: 'Ice Devil (Gelugon)', description: 'Icy, spear-wielding devils' },
  { name: 'Imp', description: 'Tiny, mischievous devils' },
  { name: 'Lemure', description: 'Blob-like, lowly devils' },
  { name: 'Pit Fiend', description: 'Powerful, lordly devils' },
  { name: 'Devourer', description: 'Soul-consuming undead beings' },
  { name: 'Digester', description: 'Acid-spewing, monstrous creatures' },
  { name: 'Dinosaur', description: 'Prehistoric reptilian creatures' },
    { name: 'Deinonychus', description: 'Raptor-like, swift dinosaurs' },
  { name: 'Elasmosaurus', description: 'Long-necked, aquatic dinosaurs' },
  { name: 'Megaraptor', description: 'Giant, predatory theropods' },
  { name: 'Triceratops', description: 'Horned, herbivorous dinosaurs' },
  { name: 'Tyrannosaurus', description: 'Giant, fearsome carnivores' },
  { name: 'Dire Animal', description: 'Enormous, enhanced natural creatures' },
  { name: 'Dire Ape', description: 'Gigantic, powerful primates' },
  { name: 'Dire Badger', description: 'Huge, ferocious badgers' },
  { name: 'Dire Bat', description: 'Giant, winged mammals' },
  { name: 'Dire Bear', description: 'Massive, formidable bear creatures' },
  { name: 'Dire Boar', description: 'Huge, aggressive swine' },
  { name: 'Dire Lion', description: 'Majestic, enormous feline predators' },
  { name: 'Dire Rat', description: 'Giant, disease-carrying rodents' },
  { name: 'Dire Shark', description: 'Huge, ocean-dwelling predators' },
  { name: 'Dire Tiger', description: 'Powerful, immense tiger creatures' },
  { name: 'Dire Weasel', description: 'Large, deadly mustelids' },
  { name: 'Dire Wolf', description: 'Giant, pack-hunting wolves' },
  { name: 'Dire Wolverine', description: 'Ferocious, oversized weasels' },
  { name: 'Doppelganger', description: 'Shape-shifting, mimic creatures' },
  { name: 'Dragon, True', description: 'Majestic, elemental dragons' },
  { name: 'Chromatic Dragons', description: 'Evil-aligned elemental dragons' },
  { name: 'Black Dragon', description: 'Corrupting, swamp-dwelling dragons' },
  { name: 'Blue Dragon', description: 'Territorial, desert-dwelling dragons' },
  { name: 'Green Dragon', description: 'Deceptive, forest-dwelling dragons' },
  { name: 'Red Dragon', description: 'Destructive, volcanic dragons' },
  { name: 'White Dragon', description: 'Icy, cold-dwelling dragons' },
  { name: 'Metallic Dragons', description: 'Good-aligned elemental dragons' },
  { name: 'Brass Dragon', description: 'Talkative, desert-dwelling dragons' },
  { name: 'Bronze Dragon', description: 'Seafaring, ocean-dwelling dragons' },
  { name: 'Copper Dragon', description: 'Trickster, jungle-dwelling dragons' },
  { name: 'Gold Dragon', description: 'Noble, sun-dwelling dragons' },
  { name: 'Silver Dragon', description: 'Elegant, arctic-dwelling dragons' },
  { name: 'Dragon Turtle', description: 'Monstrous, aquatic dragonkin' },
  { name: 'Dragonne', description: 'Winged, lion-like creatures' },
  { name: 'Drider', description: 'Drow-spider hybrid creatures' },
  { name: 'Dryad', description: 'Woodland guardian spirits' },
  { name: 'Dwarf', description: 'Short and sturdy humanoids' },
  { name: 'Deep Dwarf', description: 'Subterranean, resilient dwarves' },
  { name: 'Duergar', description: 'Evil-aligned, dark dwarves' },
  { name: 'Mountain Dwarf', description: 'Highland-dwelling, stout dwarves' },
  { name: 'Eagle, Giant', description: 'Massive, majestic avian creatures' },
  { name: 'Elemental', description: 'Primordial elemental beings' },
  { name: 'Air Elemental', description: 'Whirling air creatures' },
  { name: 'Earth Elemental', description: 'Earthen, rocky creatures' },
  { name: 'Fire Elemental', description: 'Burning, fiery creatures' },
  { name: 'Water Elemental', description: 'Watery, fluid creatures' },
  { name: 'Elf', description: 'Graceful, long-lived humanoids' },
  { name: 'Half-Elf', description: 'Mixed elf and human heritage' },
  { name: 'Aquatic Elf', description: 'Sea-dwelling, aquatic elves' },
  { name: 'Drow', description: 'Dark-skinned, subterranean elves' },
  { name: 'Gray Elf', description: 'Mysterious, high elves' },
  { name: 'Wild Elf', description: 'Savage, primal forest elves' },
  { name: 'Wood Elf', description: 'Forest-dwelling, woodland elves' },
  { name: 'Ethereal Filcher', description: 'Dimension-hopping thieves' },
  { name: 'Ethereal Marauder', description: 'Ruthless ethereal raiders' },
  { name: 'Ettercap', description: 'Web-spinning, spider-like creatures' },
  { name: 'Ettin', description: 'Two-headed, brutish giants' },
  { name: 'Fiendish Creature', description: 'Creatures infused with fiendish essence' },
  { name: 'Formian', description: 'Ant-like insectoid creatures' },
  { name: 'Worker', description: 'Basic formian caste' },
  { name: 'Warrior', description: 'Formian warrior caste' },
  { name: 'Taskmaster', description: 'Formian taskmaster caste' },
  { name: 'Myrmarch', description: 'Formian ruler caste' },
  { name: 'Queen', description: 'Formian queen caste' },
  { name: 'Frost Worm', description: 'Icy, tunneling worm creatures' },
  { name: 'Fungus', description: 'Mushroom-like, fungal creatures' },
  { name: 'Shrieker', description: 'Audible alert fungal creatures' },
  { name: 'Violet Fungus', description: 'Tentacle-laden fungal creatures' },
  { name: 'Gargoyle', description: 'Stone guardians brought to life' },
  { name: 'Kapoacinth', description: 'Aquatic, stone-skinned creatures' },
  { name: 'Genie', description: 'Elemental beings of magic' },
  { name: 'Djinni', description: 'Air-dwelling genie beings' },
  { name: 'Noble Djinn', description: 'Mighty and noble air genies' },
  { name: 'Efreeti', description: 'Fire-dwelling genie beings' },
    { name: 'Ghaele', description: 'Celestial beings of beauty and grace' },
  { name: 'Ghost', description: 'Restless spirits of the deceased' },
  { name: 'Ghoul', description: 'Corpse-eating undead fiends' },
  { name: 'Lacedon', description: 'Aquatic, savage ghoul variant' },
  { name: 'Ghast', description: 'More powerful, horrifying undead' },
  { name: 'Giant', description: 'Enormous humanoid creatures' },
  { name: 'Cloud Giant', description: 'Sky-dwelling giants' },
  { name: 'Fire Giant', description: 'Molten lava-dwelling giants' },
  { name: 'Frost Giant', description: 'Glacial, ice-dwelling giants' },
  { name: 'Frost Giant Jarl', description: 'Mighty frost giant lords' },
  { name: 'Hill Giant', description: 'Huge, hill-dwelling giants' },
  { name: 'Stone Giant', description: 'Rock-skinned giants' },
  { name: 'Stone Giant Elders', description: 'Ancient, wise stone giants' },
  { name: 'Storm Giant', description: 'Majestic, storm-controlling giants' },
  { name: 'Gibbering Mouther', description: 'Mad, gibbering amalgamations' },
  { name: 'Girallon', description: 'Four-armed, gorilla-like creatures' },
  { name: 'Gnoll', description: 'Hyena-headed, savage humanoids' },
  { name: 'Gnome', description: 'Small, inventive humanoids' },
  { name: 'Svirfneblin', description: 'Subterranean deep gnomes' },
  { name: 'Forest Gnome', description: 'Nature-loving gnomes' },
  { name: 'Goblin', description: 'Small, mischievous humanoids' },
  { name: 'Golem', description: 'Artificial, construct creatures' },
  { name: 'Clay Golem', description: 'Mud and earth construct golems' },
  { name: 'Flesh Golem', description: 'Stitched together humanoid golems' },
  { name: 'Iron Golem', description: 'Metallic, powerful construct golems' },
  { name: 'Stone Golem', description: 'Rock and stone construct golems' },
  { name: 'Greater Stone Golem', description: 'Mighty stone construct golems' },
  { name: 'Gorgon', description: 'Metallic, bull-like creatures' },
  { name: 'Gray Render', description: 'Large, multi-limbed monstrosities' },
  { name: 'Grick', description: 'Tentacled, subterranean creatures' },
  { name: 'Griffon', description: 'Majestic, eagle-lion creatures' },
  { name: 'Grimlock', description: 'Blind, subterranean humanoids' },
  { name: 'Hag', description: 'Malevolent, monstrous spellcasters' },
  { name: 'Annis', description: 'Hideous, brute-like hags' },
  { name: 'Green Hag', description: 'Swamp-dwelling, cunning hags' },
  { name: 'Sea Hag', description: 'Oceanic, cruel hags' },
  { name: 'Half-Celestial', description: 'Celestial-infused mortals' },
  { name: 'Half-Dragon', description: 'Dragonblood-infused creatures' },
  { name: 'Half-Fiend', description: 'Fiendish-infused mortals' },
  { name: 'Halfling', description: 'Small, jovial humanoids' },
  { name: 'Tallfellow', description: 'Hobbit-like, stealthy halflings' },
  { name: 'Deep Halfling', description: 'Subterranean halfling variant' },
  { name: 'Harpy', description: 'Avian, seductive creatures' },
  { name: 'Harpy Archer', description: 'Harpy ranged attackers' },
  { name: 'Hell Hound', description: 'Infernal, fire-breathing hounds' },
  { name: 'Nessian Warhound', description: 'Hellish, inferno-dwelling hounds' },
  { name: 'Hippogriff', description: 'Horse-eagle hybrid creatures' },
  { name: 'Hobgoblin', description: 'Militaristic, goblinoid humanoids' },
  { name: 'Homunculus', description: 'Tiny, artificial humanoid constructs' },
  { name: 'Howler', description: 'Terrifying, sonic creatures' },
  { name: 'Hydra', description: 'Multi-headed, regenerating serpents' },
  { name: 'Pyrohydra', description: 'Fire-breathing, multi-headed hydra' },
  { name: 'Cryohydra', description: 'Cold-breathing, multi-headed hydra' },
  { name: 'Inevitable', description: 'Lawful enforcers of reality' },
  { name: 'Kolyarut', description: 'Inevitables of order and justice' },
  { name: 'Marut', description: 'Inevitables of final judgment' },
  { name: 'Zelekhut', description: 'Inevitables of pursuit and vengeance' },
  { name: 'Invisible Stalker', description: 'Unseen, air elemental creatures' },
  { name: 'Kobold', description: 'Small, cunning reptilian humanoids' },
  { name: 'Kraken', description: 'Gigantic, sea-dwelling monsters' },
  { name: 'Krenshar', description: 'Feline creatures with retractable faces' },
  { name: 'Lamia', description: 'Serpentine, enchanting monsters' },
  { name: 'Lammasu', description: 'Noble, celestial guardians' },
  { name: 'Golden Protector', description: 'Noble, golden lammasu' },
  { name: 'Leonal', description: 'Celestial lion guardians' },
  { name: 'Lich', description: 'Undead spellcasters seeking power' },
  { name: 'Lillend', description: 'Serpentine, musical celestial beings' },
  { name: 'Lizardfolk', description: 'Reptilian, tribal humanoids' },
    { name: 'Lizardfolk', description: 'Reptilian, tribal humanoids' },
  { name: 'Locathah', description: 'Aquatic, fish-like humanoids' },
  { name: 'Lycanthrope', description: 'Shape-changing, afflicted creatures' },
  { name: 'Werebear', description: 'Noble, bear-like lycanthropes' },
  { name: 'Wereboar', description: 'Savage, boar-like lycanthropes' },
  { name: 'Hill Giant Dire Wereboar', description: 'Monstrous hybrid' },
  { name: 'Wererat', description: 'Scheming, rat-like lycanthropes' },
  { name: 'Weretiger', description: 'Majestic, tiger-like lycanthropes' },
  { name: 'Werewolf', description: 'Savage, wolf-like lycanthropes' },
  { name: 'Werewolf Lord', description: 'Powerful alpha werewolves' },
  { name: 'Magmin', description: 'Fiery, elemental fire creatures' },
  { name: 'Manticore', description: 'Lion-bodied, spiked-tailed monsters' },
  { name: 'Medusa', description: 'Snake-haired, petrifying creatures' },
  { name: 'Mephit', description: 'Small, elemental creatures' },
  { name: 'Air Mephit', description: 'Airborne, mischievous mephits' },
  { name: 'Dust Mephit', description: 'Dust and sand-based mephits' },
  { name: 'Earth Mephit', description: 'Earthy and rocky mephits' },
  { name: 'Fire Mephit', description: 'Flaming and fiery mephits' },
  { name: 'Ice Mephit', description: 'Frosty and cold mephits' },
  { name: 'Magma Mephit', description: 'Molten lava-based mephits' },
  { name: 'Ooze Mephit', description: 'Slime and ooze-based mephits' },
  { name: 'Salt Mephit', description: 'Salt and desert-themed mephits' },
  { name: 'Steam Mephit', description: 'Steam and vapor-based mephits' },
  { name: 'Water Mephit', description: 'Aquatic and watery mephits' },
  { name: 'Merfolk', description: 'Aquatic, fish-like humanoids' },
  { name: 'Mimic', description: 'Shape-shifting, mimic creatures' },
  { name: 'Minotaur', description: 'Mighty, bull-headed creatures' },
  { name: 'Mohrg', description: 'Undead, corpse-animated creatures' },
  { name: 'Mummy', description: 'Ancient, desiccated undead' },
  { name: 'Mummy Lord', description: 'Mighty, lordly mummies' },
  { name: 'Naga', description: 'Serpentine, spellcasting beings' },
  { name: 'Dark Naga', description: 'Serpentine, deceitful spellcasters' },
  { name: 'Guardian Naga', description: 'Serpentine, protective beings' },
  { name: 'Spirit Naga', description: 'Serpentine, spirit-controlling beings' },
  { name: 'Water Naga', description: 'Serpentine, aquatic spellcasters' },
  { name: 'Night Hag', description: 'Evil, dream-invading hags' },
  { name: 'Nightmare', description: 'Nightmarish, demonic steeds' },
  { name: 'Cauchemar', description: 'Fiery, demonic nightmares' },
  { name: 'Nightshade', description: 'Shadowy, undead beings' },
  { name: 'Nightcrawler', description: 'Shadowy, stealthy undead' },
  { name: 'Nightwalker', description: 'Giant, shadowy undead' },
  { name: 'Nightwing', description: 'Abyssal, winged undead' },
  { name: 'Nymph', description: 'Enchanting, nature spirits' },
  { name: 'Ogre', description: 'Brutish, giant humanoids' },
  { name: 'Ogre Barbarian', description: 'Savage, raging ogres' },
  { name: 'Merrow', description: 'Aquatic, brutish ogres' },
  { name: 'Ogre Mage', description: 'Cunning, spellcasting ogres' },
  { name: 'Ooze', description: 'Amorphous, blob-like creatures' },
  { name: 'Black Pudding', description: 'Acidic, corrosive oozes' },
  { name: 'Elder Black Pudding', description: 'Mighty, acidic oozes' },
  { name: 'Gelatinous Cube', description: 'Translucent, cube-shaped oozes' },
  { name: 'Gray Ooze', description: 'Sluggish, gray-colored oozes' },
    { name: 'Ochre Jelly', description: 'Yellow, acidic oozes' },
  { name: 'Oracle', description: 'Divine seers and prophets' },
  { name: 'Orca', description: 'Gigantic, oceanic dolphins' },
  { name: 'Otyugh', description: 'Foul, scavenging aberrations' },
  { name: 'Owlbear', description: 'Bizarre owl-bear hybrid creatures' },
  { name: 'Pegasus', description: 'Winged, celestial horse creatures' },
  { name: 'Phantom Fungus', description: 'Ghostly, fungal specters' },
  { name: 'Phase Spider', description: 'Dimension-hopping arachnids' },
  { name: 'Phoenix', description: 'Resurrecting, fiery avian beings' },
  { name: 'Pixie', description: 'Tiny, mischievous nature spirits' },
  { name: 'Porpoise', description: 'Intelligent, aquatic dolphins' },
  { name: 'Purple Worm', description: 'Enormous, burrowing earthworms' },
  { name: 'Quaggoth', description: 'Savage, subterranean humanoids' },
  { name: 'Quasit', description: 'Impish, chaotic demons' },
  { name: 'Raakshasa', description: 'Deceptive, fiendish shape-shifters who often appear as cat-like humanoids.' },
  { name: 'Rat', description: 'Small, common rodents' },
  { name: 'Dire Rat', description: 'Giant, disease-carrying rodents' },
  { name: 'Ravid', description: 'Energetic, aberrant creatures' },
  { name: 'Remorhaz', description: 'Huge, fiery centipede-like creatures' },
  { name: 'Retriever', description: 'Construct-like, demonic hunters' },
  { name: 'Roc', description: 'Gigantic, legendary avian creatures' },
  { name: 'Roper', description: 'Stalactite-like, cave-dwelling creatures' },
  { name: 'Rust Monster', description: 'Metal-corroding, insect-like creatures' },
  { name: 'Sahuagin', description: 'Aquatic, shark-like humanoids' },
  { name: 'Salamander', description: 'Fire-dwelling, elemental beings' },
  { name: 'Flamebrother', description: 'Fiery, cruel salamanders' },
  { name: 'Noble Salamander', description: 'Mighty and regal salamanders' },
  { name: 'Savage Species', description: 'Creatures of wild nature' },
  { name: 'Scorpionfolk', description: 'Scorpion-like humanoid creatures' },
  { name: 'Sea Cat', description: 'Aquatic, seafaring feline creatures' },
  { name: 'Sea Hag', description: 'Oceanic, cruel hags' },
  { name: 'Shadow', description: 'Dark, shadowy incorporeal beings' },
  { name: 'Shadow Mastiff', description: 'Shadowy, hound-like creatures' },
  { name: 'Shambling Mound', description: 'Plant-based, swampy creatures' },
  { name: 'Shield Guardian', description: 'Construct guardians of magic' },
  { name: 'Shocker Lizard', description: 'Electricity-charging reptiles' },
  { name: 'Skeleton', description: 'Undead, animated skeletal remains' },
  { name: 'Skum', description: 'Aquatic, fish-like humanoid creatures' },
  { name: 'Slaad', description: 'Chaotic, amphibious outsiders' },
  { name: 'Blue Slaad', description: 'Chaos-infused amphibians' },
  { name: 'Death Slaad', description: 'Lethal, chaos-spreading slaad' },
  { name: 'Gray Slaad', description: 'Mad, spellcasting slaad' },
  { name: 'Green Slaad', description: 'Frog-like, disease-spreading slaad' },
  { name: 'Red Slaad', description: 'Fire-breathing, destructive slaad' },
  { name: 'Solar', description: 'Radiant, celestial angelic beings' },
  { name: 'Spectre', description: 'Malevolent, ghostly undead' },
  { name: 'Sphinx', description: 'Riddle-posing, enigmatic creatures' },
  { name: 'Androsphinx', description: 'Noble, lion-headed sphinxes' },
  { name: 'Criosphinx', description: 'Ram-headed, cunning sphinxes' },
  { name: 'Gynosphinx', description: 'Elegant, human-headed sphinxes' },
  { name: 'Hieracosphinx', description: 'Hawk-headed, vigilant sphinxes' },
  { name: 'Spider Eater', description: 'Arachnid-hunting, tentacled creatures' },
  { name: 'Sprite', description: 'Tiny, playful nature spirits' },
  { name: 'Grig', description: 'Tiny, cricket-like sprites' },
  { name: 'Nixie', description: 'Aquatic, water-loving sprites' },
  { name: 'Pixie', description: 'Tiny, mischievous nature sprites' },
  { name: 'Sprite, Dark', description: 'Shadowy and secretive sprites' },
  { name: 'Sprite, Pixie, Pixie Queen', description: 'Mighty pixie monarch' },
  { name: 'Sprite, Sprite, Sea', description: 'Maritime, water-loving sprites' },
  { name: 'Sprite, Snow', description: 'Cold-dwelling, winter sprites' },
  { name: 'Sprite, Twigjack', description: 'Plant-like, forest sprites' },
  { name: 'Squid, Giant', description: 'Massive, oceanic cephalopods' },
  { name: 'Stegosaurus', description: 'Herbivorous, plated dinosaurs' },
  { name: 'Stirge', description: 'Blood-drinking, bat-like creatures' },
  { name: 'Tarrasque', description: 'Legendary, world-devouring creature' },
  { name: 'Thoon Hulk', description: 'Aberrant, tentacled monstrosities' },
  { name: 'Thri-Kreen', description: 'Insectoid, mantis-like humanoids' },
  { name: 'Titan', description: 'Mighty, giant celestial beings' },
  { name: 'Toad, Giant', description: 'Enormous, amphibious creatures' },
  { name: 'Treant', description: 'Majestic, ancient tree guardians' },
  { name: 'Troglodyte', description: 'Reptilian, subterranean humanoids' },
  { name: 'Troll', description: 'Regenerating, monstrous humanoids' },
  { name: 'Scrag', description: 'Aquatic trolls with seaweed-like hair' },
  { name: 'True Troll', description: 'Mighty, advanced troll variants' },
  { name: 'Umber Hulk', description: 'Subterranean, tunneling horrors' },
  { name: 'Vampire', description: 'Undead, blood-drinking immortals' },
  { name: 'Vampire, Vampire Spawn', description: 'Newly created vampires' },
  { name: 'Vampire, Vampire Lord', description: 'Mighty vampire rulers' },
  { name: 'Vampire, Nosferatu', description: 'Hideous, monstrous vampires' },
  { name: 'Vargouille', description: 'Fiendish, bat-like head creatures' },
  { name: 'Violet Fungus', description: 'Tentacle-laden fungal creatures' },
  { name: 'Vrock', description: 'Vulture-like, chaotic demons' },
  { name: 'Water Weird', description: 'Aquatic, elemental water spirits' },
  { name: 'Wight', description: 'Undead, life-draining creatures' },
  { name: 'Will-o\'-Wisp', description: 'Mysterious, flickering lights' },
  { name: 'Winter Wolf', description: 'Cold-breathing, wolf-like creatures' },
  { name: 'Worg', description: 'Giant, wolf-like creatures' },
  { name: 'Wraith', description: 'Spectral, life-draining undead' },
  { name: 'Wyvern', description: 'Winged, dragon-like creatures' },
  { name: 'Xorn', description: 'Earth-dwelling, elemental creatures' },
  { name: 'Zombie', description: 'Shambling, undead reanimated corpses' },
  { name: 'Zombie Lord', description: 'Powerful, necromantic undead lords' },
  { name: 'Zuggtmoy', description: 'Fungal Demon Queen' },
  { name: 'Hedrack', description: 'High Priest of the Elder Elemental Eye' },
  { name: 'Obmi', description: 'Duergar Weaponsmith' },
  { name: 'Ultraloth', description: 'Servants of the yugoloths' },
  { name: 'Balor', description: 'Demonic, fiery terror' },
  // Add more monster races here
];

// Define monster classes
const monsterClasses = [
  { name: 'Warrior', hp: '10 + 1d8', description: 'Skilled in combat' },
  { name: 'Shaman', hp: '10 + 1d6', description: 'Mystical spellcasters' },
  { name: 'Assassin', hp: '10 + 1d8', description: 'Stealthy killers' },
        { name: 'Knight of Atinus', baseHP: 10 },
      { name: 'Knight of Atricles', baseHP: 11},
      { name: 'Knight of Urther', baseHP: 11},
      { name: 'Knight of Poena', baseHP: 10},
      { name: 'Knight of Atricles', baseHP: 11},
      { name: 'Wizard', baseHP: 6 },
      { name: 'Witch', baseHP: 6 }, 
      { name: 'Necromancer', baseHP: 6 }, 
      { name: 'Warlock', baseHP: 6 }, 
      { name: 'Sorcerer', baseHP: 6 }, 
      { name: 'Thief', baseHP: 8 }, 
      { name: 'Barbarian', baseHP: 11 },
      
  // Add more monster classes here
];


function getRandomRace() {
  const randomIndex = Math.floor(Math.random() * characterRaces.length);
  return characterRaces[randomIndex];
}

function getRandomClass() {
  const randomIndex = Math.floor(Math.random() * characterClasses.length);
  return characterClasses[randomIndex];
}

function areItemsEqual(itemA, itemB) {
  // Compare items after trimming whitespace and converting to lowercase
  return itemA.trim().toLowerCase() === itemB.trim().toLowerCase();
}

// Define a global variable to store user input for character creation
let characterCreationInput = '';
let characterCreationStep = 0;
// Initialize charactersString
//let charactersString = '';
// Initialize an array to store NPCs and Mortacia

// Function to initialize NPCs and Mortacia
function initializeNPCs() {
  // Create NPCs and Mortacia only if the npcs array is empty
  if (npcs.length === 0) {
    for (let i = 0; i < 5; i++) {
      const npc = createRandomNPC();
      npcs.push(npc);
    }

    // Create Mortacia
    const mortacia = createMortaciaNPC();
    npcs.push(mortacia);
  }
}

// Function to display the character creation menu
function displayCharacterCreationMenu(step) {
  switch (step) {
    case 1:
      return 'Step 1: Enter character name';
    case 2:
      return 'Step 2: Choose character sex (Male or Female)';
    case 3:
      return 'Step 3: Choose character race';
    case 4:
      return 'Step 4: Choose character class';
    case 5:
      return 'Press enter to begin the game in the Ruined Temple.';
    default:
      return 'Invalid character creation step';
  }
}




/*// Function to handle character creation
async function createCharacter(updatedUserInput, updatedUserWords) {
  // Local variables to store input for each step
  let stepUserInput = updatedUserInput;
  let stepUserWords = updatedUserWords;

  async function promptForInput(prompt) {
    displayMessage(prompt);

    // Use local variables within this function
    userInput = stepUserInput;
    userWords = stepUserWords;

    return userInput; // Return the input
  }
  
  if (characterCreationStep === 1){
      character.Name = updatedUserInput;

  }

  switch (characterCreationStep) {
    case 1:
          
     // character.Name = await promptForInput('Step 1: Enter character name');
      //characterCreationStep++;
     // break;
    case 2:
      character.Sex = await promptForInput('Step 2: Choose character sex (Male or Female)');
      //characterCreationStep++;
      break;
    case 3:
      character.Race = await promptForInput('Step 3: Choose character race (Enter the race number)');
      // Handle character's race selection

      // Display character's class selection as a single message
      let raceSelectionMessage = 'Choose character\'s race:\n';
      
      const raceIndex = parseInt(character.Race) - 1;
      const selectedRace = characterRaces[raceIndex];

      characterRaces.forEach((race, index) => {
        raceSelectionMessage += `${index + 1}) ${race.name} - ${race.description}\n`;
      });

      displayMessage(raceSelectionMessage);
      
      // Calculate character HP based on class
      calculateCharacterRace(character, selectedRace);
      //characterCreationStep++;
      break;
    case 4:
      character.Class = await promptForInput('Step 4: Choose character class (Enter the class number)');

      // Convert user input to class index (assuming user input is a valid class number)
      const classIndex = parseInt(character.Class) - 1;
      const selectedClass = characterClasses[classIndex];

      // Display character's class selection as a single message
      let classSelectionMessage = 'Choose character\'s class:\n';

      characterClasses.forEach((cls, index) => {
        classSelectionMessage += `${index + 1}) ${cls.name} - ${cls.description}\n`;
      });

      displayMessage(classSelectionMessage);
      
      // Calculate character HP based on class
      calculateCharacterHP(character, selectedClass);

      // Increment the character creation step here
      //characterCreationStep++;
      break;
    case 5:
      let beginGame = await promptForInput('Press enter to begin the game in the Ruined Temple.')
  }
  
  characterCreationStep++;

  // If character creation is complete, add the created character to the characters array
  if (characterCreationStep > 4) {
    characters.push(character);

    // Update charactersString with the new character data
    charactersString = characters.map((char, index) => {
      return `Character ${index + 1}:
        Name: ${char.Name}
        Sex: ${char.Sex}
        Race: ${char.Race}
        Class: ${char.Class}
        Level: ${char.Level}
        XP: ${char.XP}
        HP: ${char.HP}
        MaxHP: ${char.MaxHP}`;
    }).join('\n');

    // Reset characterCreationStep to 0 to indicate that character creation is complete
    characterCreationStep = 0;
  }

  // Return character, userInput, and userWords
  return { character, userInput, userWords };
}*/


// Function to check if character creation is in progress
function isCharacterCreationInProgress() {
  return characterCreationStep !== 0 && characterCreationStep < 5;
}
// Function to calculate character HP based on class
function calculateCharacterHP(character, selectedClass) {
  if (selectedClass && selectedClass.hp) {
    const hpRoll = Math.floor(Math.random() * 20) + 1; // Roll a 20-sided die
    const hpModifier = selectedClass.hp.match(/\d+/)[0]; // Extract the HP modifier from the class description
    character.Class = selectedClass.name;
    character.HP = eval(`${hpModifier} + ${hpRoll}`);
    character.MaxHP = character.HP;
  } else {
    // Handle the case where selectedClass or selectedClass.hp is undefined
    console.error("Invalid selectedClass:", selectedClass);
  }
}

// Function to calculate character HP based on class
function calculateCharacterRace(character, selectedRace, userInput) {
  character.Race = selectedRace.name;
}

// Function to create Mortacia character and add her to npcsString
function createMortaciaNPC() {
 // Calculate the initial HP value
  const initialHP = 120 + rollDice(20);
  const equipped = {
    Weapon: null,
    Armor: null,
    Shield: null,
    Other: null
  };

  const mortacia = {
    Name: 'Mortacia',
    Sex: 'Female',
    Race: 'Goddess',
    Class: 'Assassin-Fighter-Necromancer-Goddess',
    Level: 50,
    AC: 13,
    XP: 18816000,
    HP: initialHP,
    MaxHP: initialHP,
    Equipped: equipped,
    Attack: 0,
    Damage: 0,
    Armor: 0,
    Magic: 0,// Set MaxHP to the same value as HP
  };

    // Generate equipped items string
    const equippedItemsString = Object.values(mortacia.Equipped).some(item => item !== null)
        ? Object.entries(mortacia.Equipped)
            .map(([slot, item]) => `${slot}: ${item ? item.name : 'None'}`)
            .join(", ")
        : "None";

  // Calculate NPC HP based on class
  //calculateCharacterHP(mortacia);
  return mortacia;

}

// ...

// Function to create Mortacia character
function createMortaciaCharacter() {
    // Calculate the initial HP value
    const initialHP = 120 + rollDice(20);
    const equipped = {
        Weapon: null,
        Armor: null,
        Shield: null,
        Other: null
    };

    const character = {
        Name: 'Mortacia',
        Sex: 'Female',
        Race: 'Goddess',
        Class: 'Assassin-Fighter-Necromancer-Goddess',
        Level: 50,
        XP: 18816000,
        AC: 13,
        HP: initialHP,
        MaxHP: initialHP, // Set MaxHP to the same value as HP
        Equipped: equipped,
        Attack: 0,
        Damage: 0,
        Armor: 0,
        Magic: 0,
    };

    // Generate equipped items string
    const equippedItemsString = Object.values(character.Equipped).some(item => item !== null)
        ? Object.entries(character.Equipped)
            .map(([slot, item]) => `${slot}: ${item ? item.name : 'None'}`)
            .join(", ")
        : "None";

    // Add the character to the characters array
    characters.push(character);

    return character;
}

// Function to create Suzerain character
function createSuzerainCharacter() {
   // Calculate the initial HP value
  const initialHP = 80 + rollDice(20);
  const equipped = {
      Weapon: null,
      Armor: null,
      Shield: null,
      Other: null
      };
  const character = {
    Name: 'Suzerain',
    Sex: 'Male',
    Race: 'Human',
    Class: 'Knight of Atinus',
    Level: 15,
    AC: 11,
    XP: 168000,
    HP: initialHP, // HP = 80 + 1d20 hitpoints
    MaxHP: initialHP,
    Equipped: equipped,
    Attack: 4,
    Damage: 2,
    Armor: 1,
    Magic: 0,// Max HP can be calculated if needed
  };

    // Generate equipped items string
    const equippedItemsString = Object.values(character.Equipped).some(item => item !== null)
        ? Object.entries(character.Equipped)
            .map(([slot, item]) => `${slot}: ${item ? item.name : 'None'}`)
            .join(", ")
        : "None";

  // Add the character to the characters array
  characters.push(character);

  return character;
  return;
}

function equipItem(itemName, targetCharacterName = null) {
    // Find the item in the inventory
    const itemIndex = inventory.findIndex(item => item.toLowerCase() === itemName.toLowerCase());
    if (itemIndex === -1) {
        return `You don't have ${itemName} in your inventory.`;
    }

    // Find the item's properties in the inventoryProperties
    const itemPropertyIndex = inventoryProperties.findIndex(prop => {
        const propObj = eval('(' + prop + ')');
        return propObj.name.toLowerCase() === itemName.toLowerCase();
    });

    if (itemPropertyIndex === -1) {
        return `${itemName} cannot be equipped.`;
    }

    const itemProperties = eval('(' + inventoryProperties[itemPropertyIndex] + ')');

    // Determine the slot for the item
    let slot;
    if (itemProperties.type === 'weapon') {
        slot = 'Weapon';
    } else if (itemProperties.type === 'armor') {
        slot = 'Armor';
    } else if (itemProperties.type === 'shield') {
        slot = 'Shield';
    } else {
        slot = 'Other';
    }

    // Determine the character to equip the item to
    let character;
    if (targetCharacterName) {
        // Try to find the character by matching the full name or just the first name
        const matchingNpcs = npcs.filter(npc => npc.Name.toLowerCase().startsWith(targetCharacterName.toLowerCase()));

        if (matchingNpcs.length === 0) {
            return `${targetCharacterName} is not in the room.`;
        }

        if (matchingNpcs.length > 1) {
            const npcNamesList = matchingNpcs.map(npc => npc.Name).join(", ");
            return `Which do you mean? ${npcNamesList}`;
        }

        character = matchingNpcs[0]; // Use the first matched character
        targetCharacterName = character.Name; // Update targetCharacterName with the full name
    } else {
        character = characters[0]; // Default to the PC if no target character is specified
    }

    // Ensure the character has the Equipped object initialized
    if (!character.Equipped) {
        character.Equipped = {
            Weapon: "None",
            Armor: "None",
            Shield: "None",
            Other: "None"
        };
    }

    // Initialize Attack, Damage, and Armor if not already defined
    if (character.Attack === undefined) character.Attack = 0;
    if (character.Damage === undefined) character.Damage = 0;
    if (character.Armor === undefined) character.Armor = 0;

    // Equip the item to the character
    character.Equipped[slot] = itemProperties;
    console.log(`Equipped items for ${character.Name}:`, character.Equipped);

    // Update the character's stats
    character.Attack += itemProperties.attack_modifier || 0;
    character.Damage += itemProperties.damage_modifier || 0;
    character.Armor += itemProperties.ac || 0;
    character.Magic += itemProperties.magic || 0;
    console.log(`Updated character stats for ${character.Name} - Attack: ${character.Attack}, Damage: ${character.Damage}, Armor: ${character.Armor}, Magic: ${character.Magic}`);

    // Remove the item from inventory and inventoryProperties
    inventory.splice(itemIndex, 1);
    inventoryProperties.splice(itemPropertyIndex, 1);

    return `${itemName} has been equipped to ${slot} of ${character.Name}.`;
}

function unequipItem(itemName, targetCharacterName = null) {
    // Determine the character to unequip the item from
    let character;
    if (targetCharacterName) {
        // Try to find the character by matching the full name or just the first name
        const matchingNpcs = npcs.filter(npc => npc.Name.toLowerCase().startsWith(targetCharacterName.toLowerCase()));

        if (matchingNpcs.length === 0) {
            return `NPC named ${targetCharacterName} not found.`;
        }

        if (matchingNpcs.length > 1) {
            const npcNamesList = matchingNpcs.map(npc => npc.Name).join(", ");
            return `Which do you mean? ${npcNamesList}`;
        }

        character = matchingNpcs[0]; // Use the first matched character
        targetCharacterName = character.Name; // Update targetCharacterName with the full name
    } else {
        character = characters[0]; // Default to the PC if no target character is specified
    }

    // Ensure the character has the Equipped object initialized
    if (!character.Equipped) {
        return `${character.Name} has no items equipped.`;
    }

    // Find the item in the equipped slots
    let item = null;
    let slot = null;
    for (const [key, value] of Object.entries(character.Equipped)) {
        if (value && value.name.toLowerCase() === itemName.toLowerCase()) {
            item = value;
            slot = key;
            break;
        }
    }

    if (!item) {
        return `${character.Name} does not have ${itemName} equipped.`;
    }

    // Update the character's stats
    character.Attack -= item.attack_modifier || 0;
    character.Damage -= item.damage_modifier || 0;
    character.Armor -= item.ac || 0;
    character.Magic -= item.magic || 0;
    console.log(`Updated character stats for ${character.Name} - Attack: ${character.Attack}, Damage: ${character.Damage}, Armor: ${character.Armor}, Magic: ${character.Magic}`);

    // Add the item back to inventory and inventoryProperties
    inventory.push(item.name);
    inventoryProperties.push(`{name: "${item.name}", type: "${item.type}", attack_modifier: ${item.attack_modifier}, damage_modifier: ${item.damage_modifier}, ac: ${item.ac}, magic: ${item.magic}}`);

    // Remove the item from the character's equipped slot
    character.Equipped[slot] = null;

    return `${item.name} has been unequipped from ${slot} of ${character.Name}.`;
}


function rollDice(sides) {
  return Math.floor(Math.random() * sides) + 1;
}


// ...

// Function to handle the start menu and character creation
async function handleStartMenu(userInput) {

}

// Function to display a message in the chat log
function displayMessage(message) {
    let userInput = document.getElementById("chatuserinput").value;
  document.getElementById("chatuserinput").value = "";

  // Get the existing chat log
  const chatLog = document.getElementById("chatlog");
  const chatHistory = chatLog.innerHTML;
  
  let userWords = userInput.split(/\s+/).map(word => word.toLowerCase()); 

  // Update the chat log with the "Loading..." message below the existing content
  chatLog.innerHTML = chatHistory + "<br><br>Loading...";

  chatLog.innerHTML += "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
  scrollToBottom();
}

// Function to get a random integer between min and max (inclusive)
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Function to get a random sex (Male or Female)
function getRandomSex() {
  const sexes = ["Male", "Female"];
  const randomIndex = Math.floor(Math.random() * sexes.length);
  return sexes[randomIndex];
}

function generateMonsterName(sex) {
  // Define arrays of name components
  const prefixes = [
    "Gor", "Zog", "Thrak", "Skar", "Morg", "Drak", "Vor", "Xar", "Nar", "Grok",
    "Zur", "Krag", "Hark", "Grim", "Lurk", "Bor", "Snag", "Kor", "Ral", "Zar"
  ];

  const middleNames = [
    "na", "gul", "rok", "ash", "thok", "mok", "rak", "gok", "lug", "murg"
  ];

  const suffixes = [
    "or", "on", "ar", "og", "ok", "orak", "rak", "ur", "ogar", "krag", "rag", "lur"
  ];

  // Generate a random number of names (1 to 3)
  const numNames = getRandomInt(1, 3);

  // Initialize the name
  let name = "";

  // Generate each part of the name based on sex
  for (let i = 0; i < numNames; i++) {
    // Add a prefix
    name += prefixes[getRandomInt(0, prefixes.length - 1)];

    // If it's not the last name, add a middle name for variety
    if (i !== numNames - 1) {
      name += middleNames[getRandomInt(0, middleNames.length - 1)];
      
      // Add a space after each name except the last one
      name += " ";
    }
  }

  // Add a suffix
  name += suffixes[getRandomInt(0, suffixes.length - 1)];

  // If the sex is female, add a feminine-sounding suffix
  if (sex === "Female") {
    const feminineSuffixes = ["a", "ia", "ina"];
    name += feminineSuffixes[getRandomInt(0, feminineSuffixes.length - 1)];
  }

  return name;
}

function getRandomName(sex) {
  // Define arrays of name components
  const prefixes = [
    "Al", "Athr", "Aec", "Aed","Aer", "Ba", "Da", "Fa", "Ga", "Ha", "Ja", "Ka", "La", "Ma", "Na", "Pa", "Qa", "Ra", "Sa", "Ta", "Ua", "Va", "Wa", "Xa", "Ya", "Za", "Be", "De", "Fe", "Ge", "He", "Je", "Ke", "Le", "Me", "Ne", "Pe", "Qe", "Re", "Se", "Te", "Ue", "Ve", "We", "Xe", "Ye", "Ze", "Bi", "Di", "Fi", "Gi", "Hi", "Ji", "Ki", "Li", "Mi", "Ni", "Pi", "Qi", "Ri", "Si", "Ti", "Ui", "Vi", "Wi", "Xi", "Yi", "Zi", "Bo", "Do", "Fo", "Go", "Ho", "Jo", "Ko", "Lo", "Mo", "No", "Po", "Qo", "Ro", "So", "To", "Uo", "Vo", "Wo", "Xo", "Yo", "Zo", "Bu", "Du", "Fu", "Gu", "Hu", "Ju", "Ku", "Lu", "Mu", "Nu", "Pu", "Qu", "Ru", "Su", "Tu", "Uu", "Vu", "Wu", "Xu", "Yu", "Zu", "By", "Dy", "Fy", "Gy", "Hy", "Jy", "Ky", "Ly", "My", "Ny", "Py", "Qy", "Ry", "Sy", "Ty", "Vy", "Wy", "Xy", "Zy", "Bre", "Beck", "Bel", "Ca", "Cat", "Cadre", "Dav", "Dra", "Drac", "Drag", "Draca",  "El", "Thel", "Ar", "Bal", "Ber", "Cal", "Cael", "Dor", "Eil", "Fen", "Gael", "Hal", "Ili", "Kor", "Lan", "Mal", "Nel", "Ol", "Pra", "Plur", "Quin", "Ral", "Rom", "Romn", "Sel", "Tal", "Urm", "Var", "Vor", "Wil", "Xan", "Yel", "Zel", "Zal", "Xera", "Xena", "Zul", "Kaal", "Maal", "Now", "Jack", "Ver", "Gor", "Zog", "Thrak", "Skar", "Morg", "Drak", "Vor", "Xar", "Nar", "Grok", "Zur", "Krag", "Hark", "Grim", "Lurk", "Bor", "Snag", "Kor", "Ral", "Zar"
  ];

  const middleNames = [
    "a", "e", "i", "o", "u", "ae", "ei", "ea", "en", "in", "em", "ou", "ie", "oo", "ai", "al", "ui", "ul", "oi", "na", "gul", "rok", "ash", "thok", "mok", "rak", "gok", "lug", "murg"
  ];

  const suffixes = [
    "ar", "en", "on", "an", "or", "ir", "us", "ad", "el", "ell", "en", "em", "ia", "ius", "orin", "ius", "in", "ius", "th", "ius", "anor", "as", "elle", "len", "lyn", "ion", "ael", "aela", "ius", "tas", "or", "on", "ar", "og", "ok", "orak", "rak", "ur", "ogar", "krag", "rag", "lur"
  ];

  // Generate a random number of names (1 to 3)
  const numNames = getRandomInt(1, 3);

  // Initialize the name
  let name = "";

  // Generate each part of the name based on sex
  for (let i = 0; i < numNames; i++) {
    // Add a prefix
    name += prefixes[getRandomInt(0, prefixes.length - 1)];

    // If it's not the last name, add a middle name for variety
    if (i !== numNames - 1) {
      name += middleNames[getRandomInt(0, middleNames.length - 1)];
      
      // Add a space after each name except the last one
      name += " ";
    }
  }

  // Add a suffix
  name += suffixes[getRandomInt(0, suffixes.length - 1)];

  // If the sex is female, add a feminine suffix
  if (sex === "Female") {
    const feminineSuffixes = ["a", "ina", "elle", "aia", "ira"];
    name += feminineSuffixes[getRandomInt(0, feminineSuffixes.length - 1)];
  }

  return name;
}


// Function to create a random NPC character
function createRandomNPC() {
  const randomName = getRandomName(); // You need to define a function to generate random names
  const randomSex = getRandomSex(); // You need to define a function to generate random sexes
  const randomRaceIndex = Math.floor(Math.random() * characterRaces.length);
  const randomClassIndex = Math.floor(Math.random() * characterClasses.length);
  const randomRace = characterRaces[randomRaceIndex];
  const randomClass = characterClasses[randomClassIndex];
  const npc = {
    Name: randomName,
    Sex: randomSex,
    Race: randomRace.name,
    Class: randomClass.name,
    Level: 1,
    AC: 10,
    XP: 0,
  };
  // Calculate NPC HP based on class
  calculateCharacterHP(npc, randomClass);
  return npc;
}

// Define keywords to include
const includeKeywords = [ 
  "Coordinates:", "Exits:", "Objects in Room:", "Inventory:", "Turns:", // Add any other keywords you want to include
];

// Function to filter lines to include only those with the specified keywords
function includeOnlySpecifiedLines(text) {
  const lines = text.split('\n');
  const includedLines = lines.filter(line => includeKeywords.some(keyword => line.includes(keyword)));
  return includedLines.join('\n');
}
// Define keywords to exclude
/*const excludeKeywords = [ 
  "Seed:", "Room Description:", "Score:", "Artifacts Found:", "Quests Achieved:" , "PC:", "NPCs:", "Name:", "Sex:", "Race:", "Class:", "Level:", "XP:", "HP:", "MaxHP:", "Rooms Visited:", "Connected Rooms:"
];

// Assuming char is an object with properties
const char = {
  Name: "CharacterName",
  Sex: "CharacterSex",
  Race: "CharacterRace",
  Class: "CharacterClass"
};

// Extract property values and create an array to store variable values to exclude
const variablesToExclude = Object.values(char);

// Concatenate the two arrays
const allExcludedKeywords = excludeKeywords.concat(variablesToExclude);

// Function to remove lines with excluded keywords
function removeExcludedLines(text) {
  const lines = text.split('\n');
  const filteredLines = lines.filter(line => !allExcludedKeywords.some(keyword => line.includes(keyword)));
  return filteredLines.join('\n');
}*/

async function updateNpcsInParty(updatedGameConsole) {
    let conversationId = localStorage.getItem("conversationId");
    if (!conversationId) {
        conversationId = generateConversationId();
        localStorage.setItem("conversationId", conversationId);
    }

    // Retrieve all prompts and responses for the conversation from the database
    const promptAndResponses = await getPromptsAndResponsesForConversation(conversationId);

    // Find the most recent game console data
    let latestGameConsole = null;
    for (let i = promptAndResponses.length - 1; i >= 0; i--) {
        if (promptAndResponses[i].gameConsole) {
            latestGameConsole = promptAndResponses[i].gameConsole;
            break;
        }
    }

    // If a specific game console is provided, use it; otherwise, use the latest from the history
    const gameConsoleData = updatedGameConsole || latestGameConsole;

    if (!gameConsoleData) {
        console.error("No game console data found.");
        return;
    }

    // Extract NPCs in Party from the gameConsole string
    const npcsStringMatch = gameConsoleData.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim() || "";
    console.log("npcsStringMatch:", npcsStringMatch);

    npcsInPartyString = npcsStringMatch.split(/\n(?=\w)/);

    npcsInParty = npcsInPartyString.map(npcBlock => {
        const lines = npcBlock.trim().split('\n').map(line => line.trim());
        return {
            Name: lines[0],
            // Add more fields if necessary
        };
    });

    console.log("Updated npcsInPartyString:", npcsInPartyString);
    console.log("Updated npcsInParty:", npcsInParty);
}

let gameMode = [];

const retort = require('retort-js').retort;

const run = require('retort-js').run;

// Function to handle the "Still Loading..." interval
function startKeepAliveInterval(chatLog) {
  // Clear any existing interval
  if (window.keepAliveInterval) {
    clearInterval(window.keepAliveInterval);
  }

  // Start a new interval
  window.keepAliveInterval = setInterval(() => {
    if (!chatLog.innerHTML.includes("Loading...")) {
      chatLog.innerHTML += "Loading...";
    }
  }, 30000);
}

async function chatbotprocessinput(textin) {
  
    let userInput = document.getElementById("chatuserinput").value;
  document.getElementById("chatuserinput").value = "";
  
  if (!userInput) {
    updateChatLog("<br>Please enter a command.<br>");
    return;
  }

  const movementCommands = ["n", "s", "e", "w", "north", "south", "east", "west", "ne", "nw", "se", "sw", "u", "d", "up", "down"];
  const directionMap = {
    n: "north",
    s: "south",
    e: "east",
    w: "west",
    ne: "northeast",
    nw: "northwest",
    se: "southeast",
    sw: "southwest",
    u: "up",
    d: "down",
  };

  const direction = directionMap[userInput.toLowerCase()] || userInput.toLowerCase();

  // Get the existing chat log
  const chatLog = document.getElementById("chatlog");
  const chatHistory = chatLog.innerHTML;

  // Update the chat log with the "Loading..." message below the existing content
  chatLog.innerHTML = chatHistory + "<br><br>Loading...";
  
  startKeepAliveInterval(chatLog);
  
  // Generate a conversation ID or retrieve an existing one
  let conversationId = localStorage.getItem("conversationId");
  if (!conversationId) {
    conversationId = generateConversationId();
    localStorage.setItem("conversationId", conversationId);
  }

  // Retrieve all prompts and responses for the conversation from the database
  const promptAndResponses = await getPromptsAndResponsesForConversation(conversationId);
  

  // Check if the current room has been searched already
  const roomHistory = roomConversationHistories[coordinatesToString(currentCoordinates)];
  let userWords = userInput.split(/\s+/).map(word => word.toLowerCase());  
   
  // Define updatedUserInput and updatedUserWords
  let updatedUserInput = userInput;
  let updatedUserWords = userWords.slice(); // Copy the userWords array to avoid modifying the original
  // Check if the user input is "search room"

 /* if (userWords.includes("search") && userWords.includes("room")) {  
    // Filter out any other words except "search" and "room"
    const filteredWords = userWords.filter(word =>
      ["search", "room"].includes(word.toLowerCase())
    );
    
    // Replace userWords with the filtered words
    userWords.length = 0;
    userWords.push(...filteredWords);
    
    // Update userInput with the modified userWords
    userInput = userWords.join(" ");
    
    // Update the input field with the modified userInput
    document.getElementById("chatuserinput").value = userInput;
  } else if (["look", "investigate", "examine", "explore"].some(word =>
      userWords.includes(word)) && userWords.includes("room")) {
    // Replace synonymous words with "search" if "room" is present
    userWords[userWords.indexOf("room") - 1] = "search";
    userWords = userWords.filter(word =>
      ["search", "room"].includes(word.toLowerCase())
    );
    
    // Update userInput with the modified userWords
    userInput = userWords.join(" ");
    
    // Update the input field with the modified userInput
    document.getElementById("chatuserinput").value = userInput;
  }

if (userWords.length >= 2 && userWords.slice(-2).join(" ").toLowerCase() === "search room") {
    
      if (roomHistory && roomHistory.some(entry => entry.prompts && entry.prompts.includes("search room"))) {
    // Room has already been searched, display a message and prevent further execution
    const message = "You have already searched this room.";
    chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
    scrollToBottom();
    return;
  }
}*/

  // Extract the gameConsole data from the promptAndResponses array
  let gameConsoleData = null;
  for (let i = promptAndResponses.length - 1; i >= 0; i--) {
    if (promptAndResponses[i].gameConsole) {
      gameConsoleData = promptAndResponses[i].gameConsole;
      break;
    }
  }

  // If gameConsoleData is null, it means the gameConsole data was not found in the promptAndResponses
  // In this case, we'll assume that the gameConsole is at the end of the array
  if (!gameConsoleData && promptAndResponses.length > 0) {
    const lastItem = promptAndResponses[promptAndResponses.length - 1];
    gameConsoleData = lastItem.response || lastItem.systemPrompt || lastItem.personalNarrative || lastItem.assistantPrompt;
  }

  // Parse user input to check for valid directions
  const validDirections = ["north", "n", "south", "s", "east", "e", "west", "w", "northeast", "ne", "northwest", "nw", "southeast", "se", "southwest", "sw", "up", "u", "down", "d"];

  // Update the currentCoordinates with the new coordinates after the user input
  // Only update if there is a valid direction in the user input
  
// Initialize the conversation history
let conversationHistory = "";

// Construct the conversation history string
for (let i = 0; i < promptAndResponses.length; i++) {
  if (promptAndResponses[i].gameConsole) {
    conversationHistory += `${promptAndResponses[i].prompt}\n${promptAndResponses[i].response}\n${promptAndResponses[i].gameConsole}\n`;
  } else {
    conversationHistory += `${promptAndResponses[i].prompt}\n${promptAndResponses[i].response}\n`;
  }
}
  
//  let validDirection = validDirections.find(direction => userWords.includes(direction));

gameConsoleData = null;
let exitsMatch = null;

let gameConsoleIndex = -1;


for (let i = promptAndResponses.length - 1; i >= 0; i--) {
  if (promptAndResponses[i].gameConsole) {
    gameConsoleData = promptAndResponses[i].gameConsole;
    gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
    exitsMatch = gameConsoleData.match(/Exits: ([^\n]+)/);
    if (exitsMatch) {
      break; // Found the most recent gameConsole with exits
    }
  }
}

let recentExits = [];
if (exitsMatch) {
  recentExits = exitsMatch[1].split(", ");
}

  let validDirection = validDirections.find(direction => userWords.includes(direction));
  for (let i = promptAndResponses.length - 1; i >= 0; i--) {
    if (promptAndResponses[i].gameConsole) {
      gameConsoleData = promptAndResponses[i].gameConsole;
      gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
      exitsMatch = gameConsoleData.match(/Exits: ([^\n]+)/);
      if (exitsMatch) {
        break; // Found the most recent gameConsole with exits
      }
    }
  }
  
const unlockCommands = [
  "unlock door",
  "unlock door with",
  "open door",
  "open door with",
  "use to unlock door",
  "use to open door",
  "unlock with",
  "open with"
];

const userInputLower = userInput.toLowerCase();
const isUnlockIntent = unlockCommands.some(cmd => userInputLower.startsWith(cmd));

const currentRoom = roomNameDatabase.get(coordinatesToString(currentCoordinates));

if (currentRoom && currentRoom.exits && isUnlockIntent) {
  const matchedCmd = unlockCommands.find(cmd => userInputLower.startsWith(cmd));
  const rawArg = userInputLower.substring(matchedCmd.length).trim();
  const keyName = rawArg.replace(/^with\s+/, "").trim();

  // Parse console inventory (may lag)
  const inventoryMatch2 = gameConsoleData ? gameConsoleData.match(/Inventory: ([^\n]+)/) : [];
  const consoleInv = (inventoryMatch2 && inventoryMatch2[1])
    ? inventoryMatch2[1].split(", ").map(s => s.trim().toLowerCase())
    : [];

  // Use live in-memory inventory too (authoritative on client)
  const liveInv = Array.isArray(inventory) ? inventory.map(s => String(s).trim().toLowerCase()) : [];

  const invSet = new Set([...liveInv, ...consoleInv]);
  const norm = s => String(s || "").trim().toLowerCase();

  let foundLockedExit = false;

  for (const [direction, exit] of Object.entries(currentRoom.exits)) {
    if (!exit) continue;
    if (exit.status !== "open" && exit.key) {
      foundLockedExit = true;

      if (!keyName) {
        const msg = invSet.has(norm(exit.key))
          ? `Please specify the key with your command, e.g., "unlock door with ${exit.key}".`
          : `The ${direction} exit is ${exit.status}. The ${exit.key} is required to unlock it.`;
        updateChatLog(`<br><b>${msg}</b><br>`);
        chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput +
          "<br><br><b></b>" + msg.replace(/\n/g, "<br>");
        scrollToBottom();
        return; // HARD STOP
      }

      if (invSet.has(norm(keyName))) {
        if (norm(keyName) === norm(exit.key)) {
  //        const TIMEOUT_DURATION2 = 25000; 
          // Compute before changing
          const prevStatus = exit.status;

          // Open and persist locally
          currentRoom.exits[direction].status = "open";
          currentRoom.exits[direction].key = null;
          roomNameDatabase.set(coordinatesToString(currentCoordinates), currentRoom);

          // Rebuild strings from the Map
          roomNameDatabasePlainObject = mapToPlainObject(roomNameDatabase);
          roomNameDatabaseString = JSON.stringify(roomNameDatabasePlainObject);
          
          // Debug log to verify contents
          console.log("Updated roomNameDatabaseString:", roomNameDatabaseString);

          // Push to server (don't call sharedState here; it's server-side)
   /*       try {
            fetchWithTimeout2('/updateState7', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ roomNameDatabaseString })
            }).catch(err => console.error('updateState7 failed:', err));
          } catch (e) {
            console.error('updateState7 exception:', e);
          }*/

          const statusMessage = (prevStatus === "sealed" ? "unsealed" : "unlocked");
          const msg = `The ${direction} exit has been ${statusMessage} using the ${keyName}.`;
          updateChatLog(`<br><b>${msg}</b><br>`);
          chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput +
            "<br><br><b></b>" + msg.replace(/\n/g, "<br>");
          scrollToBottom();
          return; // HARD STOP
        } else {
          const msg = `The ${keyName} cannot unlock the ${direction} exit. The correct key is ${exit.key}.`;
          updateChatLog(`<br><b>${msg}</b><br>`);
          chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput +
            "<br><br><b></b>" + msg.replace(/\n/g, "<br>");
          scrollToBottom();
          return; // HARD STOP
        }
      }
      // specified key not owned; continue to check other exits
    }
  }

  if (!foundLockedExit) {
    const msg = "There is no locked exit here that needs a key.";
    updateChatLog(`<br><b>${msg}</b><br>`);
    chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput +
      "<br><br><b></b>" + msg.replace(/\n/g, "<br>");
    scrollToBottom();
    return; // HARD STOP
  } else {
    const msg = keyName
      ? `No locked exit can be unlocked with the ${keyName} in this room.`
      : `Please specify a key, e.g., "unlock door with &lt;keyname&gt;".`;
    updateChatLog(`<br><b>${msg}</b><br>`);
    chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput +
      "<br><br><b></b>" + msg.replace(/\n/g, "<br>");
    scrollToBottom();
    return; // HARD STOP
  }
}

  if (validDirection) {
  if (window.dungeonTestingMode) {
    currentCoordinates = generateCoordinates(currentCoordinates, validDirection, gameConsoleData);
  } else {
    if (!recentExits.includes(validDirection)) {
      // Respond with "You can't go that way." if direction is not in recentExits
      const message = "You can't go that way.";
      chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
      scrollToBottom();
      return; // Prevent further execution
    }
    // Calculate target coordinates
    const directionMap = {
      north: { x: 0, y: 1, z: 0 },
      south: { x: 0, y: -1, z: 0 },
      east: { x: 1, y: 0, z: 0 },
      west: { x: -1, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      down: { x: 0, y: 0, z: -1 },
      northeast: { x: 1, y: 1, z: 0 },
      northwest: { x: -1, y: 1, z: 0 },
      southeast: { x: 1, y: -1, z: 0 },
      southwest: { x: -1, y: -1, z: 0 }
    };
    const offset = directionMap[validDirection] || { x: 0, y: 0, z: 0 };
    const targetCoordinates = {
      x: currentCoordinates.x + offset.x,
      y: currentCoordinates.y + offset.y,
      z: currentCoordinates.z + offset.z
    };
    const room = roomNameDatabase.get(coordinatesToString(currentCoordinates));
    if (room && room.exits && room.exits[validDirection]) {
      const { traversable, message } = isExitTraversable(currentCoordinates, validDirection);
      if (!traversable) {
        updateChatLog(`<br><b>Error:</b> ${message}<br>`);
        chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
        scrollToBottom();
        return; // Prevent movement if not traversable
      }
      if (traversable) {
        currentCoordinates = generateCoordinates(currentCoordinates, validDirection, gameConsoleData);
      }
    }
  }
}  

gameConsoleData = null;
gameConsoleIndex = -1;
let objectsInRoomMatch = [];
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
  if (promptAndResponses[i].gameConsole) {
    gameConsoleData = promptAndResponses[i].gameConsole;
    gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
    objectsInRoomMatch = gameConsoleData.match(/Objects in Room: ([^\n]+)/) || []; // Ensure objectsInRoomMatch is an array
    if (objectsInRoomMatch.length > 0) {
      break; // Found the most recent gameConsole with "Objects in Room"
    }
  }
}


let objectsInRoomString = [];
if (Array.isArray(objectsInRoomMatch) && objectsInRoomMatch.length > 1) {
  objectsInRoomString = objectsInRoomMatch[1].split(',').map(item => item.trim());
  // Split by comma and trim each item
}

console.log('objectsInRoomString:', objectsInRoomString);

// ... previous code

//    let character = null;
// Construct a string to represent all characters in the characters array
// Inside the updateGameConsole function
let charactersString = characters.map((char, index) => {
//  let equippedItems = char.Equipped.join(', '); // Get the equipped items
//  if (equippedItems.length < 1) {
//    equippedItems = "None"; // Add "Equipped" prefix
//  }
  return `
    Name: ${char.Name}
    Sex: ${char.Sex}
    Race: ${char.Race}
    Class: ${char.Class}
    Level: ${char.Level}
    AC: ${char.AC}
    XP: ${char.XP}
    HP: ${char.HP}
    MaxHP: ${char.MaxHP}
    Equipped: {
        Weapon: null,
        Armor: null,
        Shield: null,
        Other: null
        }, 
    Attack: 
    Damage: 
    Armor: 
    Magic: `;  
}).join('\n');
  
let raceIndex = parseInt(character.Race) - 1;
let selectedRace = characterRaces[raceIndex];
let classIndex = parseInt(character.Class) - 1;
let selectedClass = characterClasses[classIndex];

if (!isCharacterCreationInProgress() && userWords[0] !== "start") { 
  if (userWords[0] === '1' && charactersString.length <= 0) {
    userInput = document.getElementById("chatuserinput").value;
    document.getElementById("chatuserinput").value = "";
    userWords = "";
    character = createMortaciaCharacter();
  } else if (userWords[0] === '2' && charactersString.length <= 0) {
    userInput = document.getElementById("chatuserinput").value;
    document.getElementById("chatuserinput").value = "";
    userWords = "";
    character = createSuzerainCharacter();
  } else if (userWords[0] === "3" && charactersString.length <= 0) {
    // Start character creation
    characterCreationStep = 1;
    displayMessage('Step 1: Enter character name'); 
    console.log('charactersString:', charactersString);
    console.log('character:', character);
    return;
  } else if (charactersString.length <= 0){
    // If the input is invalid, notify the user and re-display the start menu
    displayMessage('Invalid option. Please enter 1, 2, or 3.');
    displayMessage('Start Menu: \n \n 1) Play as Mortacia, goddess of death. \n 2) Play as Suzerain, knight of Atinus. \n 3) Create character and play as a party of 7 adventurers.');
    return;
  }
}

gameConsoleData = null;
gameConsoleIndex = -1;
objectsInRoomMatch = [];
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
  if (promptAndResponses[i].gameConsole) {
    gameConsoleData = promptAndResponses[i].gameConsole;
    gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
    objectsInRoomMatch = gameConsoleData.match(/Objects in Room: ([^\n]+)/) || []; // Ensure objectsInRoomMatch is an array
    if (objectsInRoomMatch.length > 0) {
      break; // Found the most recent gameConsole with "Objects in Room"
    }
  }
}


objectsInRoomString = [];
if (Array.isArray(objectsInRoomMatch) && objectsInRoomMatch.length > 1) {
  objectsInRoomString = objectsInRoomMatch[1].split(',').map(item => item.trim());
  // Split by comma and trim each item
}

// If character creation is in progress, continue it
if (isCharacterCreationInProgress()) {
  // Use characterCreationStep to determine which step to execute
  switch (characterCreationStep) {
    case 1:
      if (!userInput.trim()) {  // Check if the name is blank
        displayMessage('Name cannot be blank. Please enter a valid character name:');
        return;
      }
      character.Name = userInput.trim();
      displayMessage('Step 2: Choose character sex (Male or Female)');
      characterCreationStep++;
      break;

    case 2:
      if (!userInput.trim() /*|| !['Male', 'Female'].includes(userInput.trim())*/) {  // Validate sex input
        displayMessage('Please enter "Male" or "Female" for character sex:');
        return;
      }
      character.Sex = userInput.trim();
      displayMessage('Step 3: Choose character race (Enter the race number or name)');

      // Display character's race selection as a single message
      let raceSelectionMessage = 'Choose character\'s race:\n';
      characterRaces.forEach((race, index) => {
        raceSelectionMessage += `${index + 1}) ${race.name} - ${race.description}\n`;
      });
      displayMessage(raceSelectionMessage);

      characterCreationStep++;
      break;

    case 3:
      let raceInput = userInput.trim();
      raceIndex = isNaN(parseInt(raceInput)) ? -1 : parseInt(raceInput) - 1;

      if (raceIndex >= 0 && raceIndex < characterRaces.length) {
        selectedRace = characterRaces[raceIndex];
      } else {
        selectedRace = characterRaces.find(race => race.name.toLowerCase() === raceInput.toLowerCase());
      }

      if (!selectedRace) {  // Validate race input
        displayMessage('Invalid race. Please enter a valid race number or name:');
        return;
      }

      character.Race = selectedRace.name;

      // Call calculateCharacterRace now that selectedRace is defined
      calculateCharacterRace(character, selectedRace);

      // Display character's class selection as a single message
      let classSelectionMessage = 'Choose character\'s class:\n';
      characterClasses.forEach((cls, index) => {
        classSelectionMessage += `${index + 1}) ${cls.name} - ${cls.description}\n`;
      });
      displayMessage(classSelectionMessage);

      characterCreationStep++;
      break;

    case 4:
      let classInput = userInput.trim();
      classIndex = isNaN(parseInt(classInput)) ? -1 : parseInt(classInput) - 1;

      if (classIndex >= 0 && classIndex < characterClasses.length) {
        selectedClass = characterClasses[classIndex];
      } else {
        selectedClass = characterClasses.find(cls => cls.name.toLowerCase() === classInput.toLowerCase());
      }

      if (!selectedClass) {  // Validate class input
        displayMessage('Invalid class. Please enter a valid class number or name:');
        return;
      }

      character.Class = selectedClass.name;
      calculateCharacterHP(character, selectedClass); 
 // Character creation is complete, add the created character to the characters array
        characters.push(character);
        

      case 5:

        // Update charactersString with the new character data
        charactersString = characters.map((char, index) => {
          return `
            Name: ${char.Name}
            Sex: ${char.Sex}
            Race: ${char.Race}
            Class: ${char.Class}
            Level: ${char.Level}
            AC: ${char.AC}
            XP: ${char.XP}
            HP: ${char.HP}
            MaxHP: ${char.MaxHP}
            Equipped: 
            Attack: 
            Damage: 
            Armor: 
            Magic: `;
        }).join('\n');
        
               if (characters.length === 1) {
        // Player wants to add NPCs to the party
 //       const npcs = []; // Array to store NPCs

 //       for (let i = 0; i < 5; i++) {
//          const npc = createRandomNPC();
//          npcs.push(npc);
//        }
        
        // Create Mortacia
//        const mortacia = createMortaciaNPC();
 //       npcs.push(mortacia);

      // Call initializeNPCs once at the start of the game to populate the NPCs and Mortacia
initializeNPCs();
        
        const npcsString = npcs.map((char, index) => {
  return `
      Name: ${char.Name}
      Sex: ${char.Sex}
      Race: ${char.Race}
      Class: ${char.Class}
      Level: ${char.Level}
      AC: ${char.AC}
      XP: ${char.XP}
      HP: ${char.HP}
      MaxHP: ${char.MaxHP}
      Equipped: 
      Attack: 0 
      Damage: 0
      Armor: 0
      Magic: 0`;
}).join('\n');

        // Notify the user that NPCs have been added
        displayMessage('5 NPCs and Mortacia have joined your party.');

        // Include NPCs in charactersString
        charactersString += '\n' + npcs.map((char, index) => {
          return `NPC ${index + 1}:
            Name: ${char.Name}
            Sex: ${char.Sex}
            Race: ${char.Race}
            Class: ${char.Class}
            Level: ${char.Level}
            AC: ${char.AC}
            XP: ${char.XP}
            HP: ${char.HP}
            MaxHP: ${char.MaxHP}
            Equipped: 
            Attack: 0
            Damage: 0
            Armor: 0
            Magic: 0`;
        }).join('\n');
      }

        // Reset characterCreationStep to 0 to indicate that character creation is complete
        characterCreationStep = 0;

        // Inform the user that character creation is complete
        displayMessage('Character creation is complete. Press enter to begin the game in the Ruined Temple.');
        userInput = "Begin game with chosen character."
        break;
    }
    console.log('charactersString:', charactersString);
    console.log('character:', character);
    return;
  }

gameConsoleData = null;
gameConsoleIndex = -1;
objectsInRoomMatch = [];
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
  if (promptAndResponses[i].gameConsole) {
    gameConsoleData = promptAndResponses[i].gameConsole;
    gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
    objectsInRoomMatch = gameConsoleData.match(/Objects in Room: ([^\n]+)/) || []; // Ensure objectsInRoomMatch is an array
    if (objectsInRoomMatch.length > 0) {
      break; // Found the most recent gameConsole with "Objects in Room"
    }
  }
}


objectsInRoomString = [];
if (Array.isArray(objectsInRoomMatch) && objectsInRoomMatch.length > 1) {
  objectsInRoomString = objectsInRoomMatch[1].split(',').map(item => item.trim());
  // Split by comma and trim each item
}

if (userWords[0] === "start") {
  userInput = document.getElementById("chatuserinput").value;
  document.getElementById("chatuserinput").value = "";
  let character = null;
  let startMenuOption = null;

  // Display the start menu options in the chat log
  displayMessage('Start Menu: \n \n 1) Play as Mortacia, goddess of death. \n 2) Play as Suzerain, knight of Atinus. \n 3) Create character and play as a party of 7 adventurers. \n');

  // Handle the player's choice from the start menu
  switch (userInput) {
    case '1':
        userInput = document.getElementById("chatuserinput").value;
  document.getElementById("chatuserinput").value = "";
      startMenuOption = 'Mortacia';
      character = await createCharacter('1'); // Handle Mortacia character creation
        userWords = "";
  userInput = "";
      break;
      return;
    case '2':
        userInput = document.getElementById("chatuserinput").value;
  document.getElementById("chatuserinput").value = "";
      startMenuOption = 'Suzerain';
      character = await createCharacter('2'); // Handle Suzerain character creation
        userWords = "";
  userInput = "";
      break;
      return;
    case '3':
        userInput = document.getElementById("chatuserinput").value;
  document.getElementById("chatuserinput").value = "";
      startMenuOption = 'Create Character';
      character = await createCharacter('3'); // Handle character creation for a party of adventurers
      startMenuOption = null;
        userWords = "";
  userInput = "";
      break;
      return;
  }

  // Once character creation is complete, you can proceed with the game
  if (startMenuOption) {
    displayMessage(`You chose to ${startMenuOption}.`);
  }

  // Return the created character
  return character;
  }
  
if (userWords.length > 1 && userWords[0] === "take") {
    let itemsToTake = userWords.slice(1).join(" ").replace(/[.,]$/, "").trim();
    
    const roomKey = coordinatesToString(currentCoordinates);
    let monstersInRoom = monstersInVisitedRooms.get(roomKey) || [];
    let monstersState = monstersStateByRoom.get(roomKey) || "";
    console.log('monstersState:', monstersState);

    if (itemsToTake.toLowerCase() === "all") {
            
        // Check if Monsters State is Hostile and any monsters have HP > 0
        if (monstersState === "Hostile" && monstersInRoom.some(monster => monster.HP > 0)) {
            const message = "The monsters growl and block you from taking any items.";
            chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
            scrollToBottom();
            return;
        }
        
        const newAdditionalEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);
        const itemsToTakeArray = itemsToTake.split(/, | and /);

        const matchingConsoleData = promptAndResponses[gameConsoleIndex].gameConsole;
        let combinedEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);

        let objectsInRoomString = combinedEquipment.match(/Objects in Room: ([^\n]+)/);
        let objectsInRoomPropertiesString = combinedEquipment.match(/Objects in Room Properties: ([^\n]+)/);

        if (objectsInRoomString) {
            objectsInRoomString = objectsInRoomString[1];
        } else {
            objectsInRoomString = "None";
        }

        let itemsInRoom = objectsInRoomString.split(', ').map(item => item.trim());
        console.log('itemsInRoom:', itemsInRoom);

        if (objectsInRoomString.trim().toLowerCase() === "none" || !objectsInRoomString) {
            const message = `The room is empty.`;
            chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
            scrollToBottom();
            return;
        }

        if (objectsInRoomString || itemsInRoom) {
            const canTakeAllItems = itemsInRoom.every(item => {
                return inventory.includes(item) || newAdditionalEquipment.includes(item);
            });

            if (canTakeAllItems) {
                inventory.push(...itemsInRoom);
                inventory = removeNoneFromInventory(inventory);

                // Move properties to inventoryProperties
                if (objectsInRoomPropertiesString && objectsInRoomPropertiesString[1].trim()) {
                    let roomProperties = objectsInRoomPropertiesString[1]
                        .split(/(?<=\}),\s*(?={)/)
                        .map(str => str.endsWith('}') ? str : str + '}')
                        .filter(prop => prop !== null);

                    // Add properties of taken items to inventoryProperties
                    const updatedRoomProperties = roomProperties.filter(property => {
                        const propertyObj = eval('(' + property + ')'); // Treat the string as a regular object
                        if (itemsInRoom.includes(propertyObj.name)) {
                            inventoryProperties.push(property);
                            return false;
                        }
                        return true;
                    });

                    objectsInRoomPropertiesString = updatedRoomProperties.length > 0 ? updatedRoomProperties.join(', ') : "None";
                } else {
                    objectsInRoomPropertiesString = "None";
                }

                combinedEquipment = combinedEquipment
                    .split(/Objects in Room: ([^\n]+)/)
                    .map(part => {
                        if (part.includes("Objects in Room:")) {
                            const remainingItems = itemsInRoom.join(', ');
                            return `Objects in Room: ${remainingItems}`;
                        }
                        return part;
                    })
                    .join('');

                combinedEquipment = combinedEquipment
                    .split(/Objects in Room Properties: ([^\n]+)/)
                    .map(part => {
                        if (part.includes("Objects in Room Properties:")) {
                            return `Objects in Room Properties: ${objectsInRoomPropertiesString}`;
                        }
                        return part;
                    })
                    .join('');

                if (itemsInRoom.length === 0) {
                    objectsInRoomString = "None";
                }

                console.log('objectsInRoomString:', objectsInRoomString);

                const roomHistory = roomConversationHistories[coordinatesToString(currentCoordinates)];

                if (roomHistory) {
                    const firstResponseForRoom = getFirstResponseForRoom(currentCoordinates);

                    if (firstResponseForRoom) {
                        itemsInRoom.forEach(item => {
                            firstResponseForRoom.response = firstResponseForRoom.response.replace(new RegExp(`\\b${item}\\b`, 'gi'), '');
                        });

                        itemsInRoom = itemsInRoom.filter(item => !inventory.includes(item));

                        let updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
                        updatedGameConsole = gameConsoleData.replace(
                            /Objects in Room: ([^\n]+)/,
                            `Objects in Room: ${itemsInRoom.join(', ')}`
                        );

                        updatedGameConsole = updatedGameConsole.replace(
                            /Objects in Room Properties: ([^\n]+)/,
                            `Objects in Room Properties: ${objectsInRoomPropertiesString}`
                        );

                        // Convert inventoryProperties to a string format for display in the game console
                        const inventoryPropertiesString = inventoryProperties.join(', ');

                        updatedGameConsole = updatedGameConsole.replace(
                            /Inventory Properties: ([^\n]+)/,
                            `Inventory Properties: ${inventoryPropertiesString}`
                        );

                        promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;
                        conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

                        combinedEquipment = combinedEquipment.replace(new RegExp(`\\b${itemsInRoom.join('\\b|\\b')}\\b`, 'gi'), '');
                        itemsInRoom = itemsInRoom.length > 0 ? itemsInRoom : ["None"];
                        console.log('itemsInRoom:', itemsInRoom);

                        const combinedHistory = conversationHistory + "\n" + userInput;

                        let personalNarrative = await performDynamicSearch(combinedHistory);

                        const messages = [
                            { role: "assistant", content: "" },
                            { role: "system", content: "" },
                            { role: "user", content: userInput }
                        ];

                        const message = `Taken.`;
                        chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
                        scrollToBottom();
                        addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);

                        updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, itemsInRoom.join(', '));
                        conversationHistory = conversationHistory + "\n" + updatedGameConsole;
                        updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
                        
                        let newRoomName = updatedGameConsole.match(/Room Name: (.+)/)?.[1];
                        let newRoomHistory = updatedGameConsole.match(/Room Description: (.+)/)?.[1];
                        let newCoordinates = updatedGameConsole.match(/(?<!Boss Room )Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
                        let formattedCoordinates = newCoordinates
                            ? `X: ${newCoordinates[1]}, Y: ${newCoordinates[2]}, Z: ${newCoordinates[3]}`
                            : "None";
                        let newObjectsInRoomString = updatedGameConsole.match(/Objects in Room: (.+)/)?.[1];
                        let newObjectsInRoomPropertiesString = updatedGameConsole.match(/Objects in Room Properties: (.+)/)?.[1]?.trim();
                        let newExitsString = updatedGameConsole.match(/Exits: (.+)/)?.[1];
                        let charactersString = updatedGameConsole.match(/PC:(.*?)(?=NPCs in Party:|$)/s)?.[1]?.trim();
                        let npcsString = updatedGameConsole.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim();
                        let inventoryString = updatedGameConsole.match(/Inventory: (.+)/)?.[1];
                        let newInventoryPropertiesString = updatedGameConsole.match(/Inventory Properties: (.+)/)?.[1];
                        let newMonstersInRoomString = updatedGameConsole.match(/Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s)?.[1]?.trim();
                        let newMonstersEquippedPropertiesString = updatedGameConsole.match(/Monsters Equipped Properties: (.+)/)?.[1];
                        let newMonstersState = updatedGameConsole.match(/Monsters State: (.+)/)?.[1];
                        let currentQuest = updatedGameConsole.match(/Current Quest: (.+)/)?.[1];
                        let nextArtifact = updatedGameConsole.match(/Next Artifact: (.+)/)?.[1];
                        let nextBoss = updatedGameConsole.match(/Next Boss: (.+)/)?.[1];
                        let nextBossRoom = updatedGameConsole.match(/Next Boss Room: (.+)/)?.[1];
                        let bossCoordinates = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
                        if (bossCoordinates) {
                            bossCoordinates = `X: ${bossCoordinates[1]}, Y: ${bossCoordinates[2]}, Z: ${bossCoordinates[3]}`;
                            console.log("Parsed boss room coordinates:", bossCoordinates);
                        } else {
                            console.error("Failed to parse boss room coordinates from updatedGameConsole.");
                        }
                        let adjacentRooms = updatedGameConsole.match(/Adjacent Rooms: (.+)/)?.[1];
                        let puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: (.+)/)?.[1];
                        let puzzleSolution = updatedGameConsole.match(/Puzzle Solution: (.+)/)?.[1];
                        
                                // Construct updated data object
                        const updatedData = {
                            roomName: newRoomName,
                            roomDescription: newRoomHistory,
                            coordinates: formattedCoordinates,
                            objects: newObjectsInRoomString || "None",
                            objectsInRoomProperties: newObjectsInRoomPropertiesString || "None",
                            exits: newExitsString || "None",
                            pc: charactersString || "No PC data",
                            npcs: npcsString || "None",
                            inventory: inventoryString || "None",
                            inventoryProperties: newInventoryPropertiesString || "None",
                            monsters: newMonstersInRoomString || "None",
            				monstersState: newMonstersState || "None",
                            puzzle: {
                                inRoom: puzzleInRoom || "No puzzle",
                                solution: puzzleSolution || "No solution"
                            },
                            currentQuest: currentQuest || "None",
                            nextArtifact: nextArtifact || "None",
                            nextBoss: nextBoss || "None",
                            nextBossRoom: nextBossRoom || "None",
                            bossCoordinates: bossCoordinates || "None",
                            adjacentRooms: adjacentRooms || "None"
                        };
                        
                                // Ensure this runs inside chatbotprocessinput, right after you build `updatedData`
        window.latestUpdatedData = updatedData;
        if (typeof updatedData.inventory === "string" && updatedData.inventory.toLowerCase() !== "none") {
          window.inventory = updatedData.inventory.split(", ").map(s => s.trim()).filter(Boolean);
        }
                
                        console.log("Updated data for Phaser scene:", updatedData);
                
                        // Restart the Phaser scene with updated data
                        const activeScene = window.game.scene.getScene('MainScene');
                        if (activeScene) {
                            activeScene.scene.restart(updatedData);
                        }                        

                        console.log("Game Console:", updatedGameConsole);
                        console.log('itemsInRoom:', itemsInRoom);
                        turns++;
                        return;
                    }
                }
            }
        }
    } else if (itemsToTake.includes(',') || itemsToTake.includes(' and ')) {
    const itemsToTakeArray = itemsToTake
    .replace(/\s*,\s*and\s+/g, ', ')  // Convert "sword, shield, and lamp" → "sword, shield, lamp"
    .split(/\s*,\s*|\s* and\s+/)      // Then split properly on ", " and " and "
    .map(item => item.trim());        // Trim spaces

    let combinedEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);
    let objectsInRoomString = combinedEquipment.match(/Objects in Room: ([^\n]+)/);
    objectsInRoomString = objectsInRoomString ? objectsInRoomString[1].split(',').map(item => item.trim()) : ["None"];

    let objectsInRoomPropertiesString = combinedEquipment.match(/Objects in Room Properties: ([^\n]+)/);
    objectsInRoomPropertiesString = objectsInRoomPropertiesString ? objectsInRoomPropertiesString[1].trim() : "None";

    let itemsInRoom = objectsInRoomString.map(item => item.toLowerCase());
    let itemsTaken = [];
    let itemsNotFound = [];

    // Check for each requested item
    itemsToTakeArray.forEach(item => {
        let lowercaseItem = item.toLowerCase();
        if (itemsInRoom.includes(lowercaseItem)) {
            itemsTaken.push(item);
            inventory.push(item);
            objectsInRoomString = objectsInRoomString.filter(roomItem => roomItem.toLowerCase() !== lowercaseItem);
        } else {
            itemsNotFound.push(item);
        }
    });

    if (itemsTaken.length > 0) {
        inventory = removeNoneFromInventory(inventory);
    }

    // === Essential Game Console Updates ===
    if (itemsInRoom.some(item => itemsToTakeArray.includes(item))) {
        itemsToTakeArray.forEach(item => {
            itemsInRoom = itemsInRoom.filter(roomItem => !itemsToTakeArray.includes(roomItem));
            objectsInRoomString = objectsInRoomString.filter(roomItem => !roomItem.includes(item.trim()));
        });

        if (combinedEquipment.length === 0) {
            itemsInRoom = ["None"];
        }

        console.log('itemsInRoom:', itemsInRoom);

        // Move properties to inventoryProperties
        if (objectsInRoomPropertiesString && objectsInRoomPropertiesString.length > 0) {
            let roomProperties = objectsInRoomPropertiesString
                .split(/(?<=\}),\s*(?={)/)
                .map(str => str.endsWith('}') ? str : str + '}')
                .filter(prop => prop !== null);

            // Add properties of taken items to inventoryProperties
            const updatedRoomProperties = roomProperties.filter(property => {
                const propertyObj = eval('(' + property + ')'); // Convert string to object
                if (itemsToTakeArray.includes(propertyObj.name)) {
                    inventoryProperties.push(property);
                    return false;
                }
                return true;
            });

            objectsInRoomPropertiesString = updatedRoomProperties.length > 0 ? updatedRoomProperties.join(', ') : "None";
        } else {
            objectsInRoomPropertiesString = "None";
        }

        const roomHistory = roomConversationHistories[coordinatesToString(currentCoordinates)];
        if (roomHistory) {
            const firstResponseForRoom = getFirstResponseForRoom(currentCoordinates);

            if (firstResponseForRoom) {
                itemsToTakeArray.forEach(item => {
                    firstResponseForRoom.response = firstResponseForRoom.response.replace(new RegExp(`\\b${item}\\b`, 'gi'), '');
                });

                let updatedGameConsole = gameConsoleData.replace(
                    /Objects in Room: ([^\n]+)/,
                    `Objects in Room: ${objectsInRoomString.join(', ')}`
                );

                updatedGameConsole = updatedGameConsole.replace(
                    /Objects in Room Properties: ([^\n]+)/,
                    `Objects in Room Properties: ${objectsInRoomPropertiesString}`
                );

                // Convert inventoryProperties to a string format for display in the game console
                const inventoryPropertiesString = inventoryProperties.join(', ');

                updatedGameConsole = updatedGameConsole.replace(
                    /Inventory Properties: ([^\n]+)/,
                    `Inventory Properties: ${inventoryPropertiesString}`
                );

                promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;
                conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

                const combinedHistory = conversationHistory + "\n" + userInput;

                let personalNarrative = await performDynamicSearch(combinedHistory);

                const messages = [
                    { role: "assistant", content: "" },
                    { role: "system", content: "" },
                    { role: "user", content: userInput }
                ];
                function formatItemList(items) {
                    if (items.length === 1) return items[0]; // Single item, no need for "and"
                    if (items.length === 2) return items.join(" and "); // Two items: "sword and shield"
                    return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1]; // Three or more: "sword, shield, and lamp"
                }
                
                let message = ``;
                
                // === Display Messages for Items Taken & Not Found ===
                if (itemsTaken.length > 0) {
                    message += `You have taken the ${formatItemList(itemsTaken)}.`;
                }
                if (itemsNotFound.length > 0) {
                    message += `${itemsTaken.length > 0 ? " " : ""}There is no ${itemsNotFound.join(' or ')} here.`; // Add a space only if items were taken
                }
                chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
                scrollToBottom();
                addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);

                updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
                conversationHistory = conversationHistory + "\n" + updatedGameConsole;
                
                let newRoomName = updatedGameConsole.match(/Room Name: (.+)/)?.[1];
                let newRoomHistory = updatedGameConsole.match(/Room Description: (.+)/)?.[1];
                let newCoordinates = updatedGameConsole.match(/(?<!Boss Room )Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
                let formattedCoordinates = newCoordinates
                    ? `X: ${newCoordinates[1]}, Y: ${newCoordinates[2]}, Z: ${newCoordinates[3]}`
                    : "None";
                let newObjectsInRoomString = updatedGameConsole.match(/Objects in Room: (.+)/)?.[1];
                let newObjectsInRoomPropertiesString = updatedGameConsole.match(/Objects in Room Properties: (.+)/)?.[1]?.trim();
                let newExitsString = updatedGameConsole.match(/Exits: (.+)/)?.[1];
                let charactersString = updatedGameConsole.match(/PC:(.*?)(?=NPCs in Party:|$)/s)?.[1]?.trim();
                let npcsString = updatedGameConsole.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim();
                let inventoryString = updatedGameConsole.match(/Inventory: (.+)/)?.[1];
                let newInventoryPropertiesString = updatedGameConsole.match(/Inventory Properties: (.+)/)?.[1];
                let newMonstersInRoomString = updatedGameConsole.match(/Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s)?.[1]?.trim();
                let newMonstersEquippedPropertiesString = updatedGameConsole.match(/Monsters Equipped Properties: (.+)/)?.[1];
                let newMonstersState = updatedGameConsole.match(/Monsters State: (.+)/)?.[1];
                let currentQuest = updatedGameConsole.match(/Current Quest: (.+)/)?.[1];
                let nextArtifact = updatedGameConsole.match(/Next Artifact: (.+)/)?.[1];
                let nextBoss = updatedGameConsole.match(/Next Boss: (.+)/)?.[1];
                let nextBossRoom = updatedGameConsole.match(/Next Boss Room: (.+)/)?.[1];
                let bossCoordinates = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
                if (bossCoordinates) {
                    bossCoordinates = `X: ${bossCoordinates[1]}, Y: ${bossCoordinates[2]}, Z: ${bossCoordinates[3]}`;
                    console.log("Parsed boss room coordinates:", bossCoordinates);
                } else {
                    console.error("Failed to parse boss room coordinates from updatedGameConsole.");
                }
                let adjacentRooms = updatedGameConsole.match(/Adjacent Rooms: (.+)/)?.[1];
                let puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: (.+)/)?.[1];
                let puzzleSolution = updatedGameConsole.match(/Puzzle Solution: (.+)/)?.[1];
                
                        // Construct updated data object
                const updatedData = {
                    roomName: newRoomName,
                    roomDescription: newRoomHistory,
                    coordinates: formattedCoordinates,
                    objects: newObjectsInRoomString || "None",
                    objectsInRoomProperties: newObjectsInRoomPropertiesString || "None",
                    exits: newExitsString || "None",
                    pc: charactersString || "No PC data",
                    npcs: npcsString || "None",
                    inventory: inventoryString || "None",
                    inventoryProperties: newInventoryPropertiesString || "None",
                    monsters: newMonstersInRoomString || "None",
            		monstersState: newMonstersState || "None",
                    puzzle: {
                        inRoom: puzzleInRoom || "No puzzle",
                        solution: puzzleSolution || "No solution"
                    },
                    currentQuest: currentQuest || "None",
                    nextArtifact: nextArtifact || "None",
                    nextBoss: nextBoss || "None",
                    nextBossRoom: nextBossRoom || "None",
                    bossCoordinates: bossCoordinates || "None",
                    adjacentRooms: adjacentRooms || "None"
                };
                
                        // Ensure this runs inside chatbotprocessinput, right after you build `updatedData`
        window.latestUpdatedData = updatedData;
        if (typeof updatedData.inventory === "string" && updatedData.inventory.toLowerCase() !== "none") {
          window.inventory = updatedData.inventory.split(", ").map(s => s.trim()).filter(Boolean);
        }
        
                console.log("Updated data for Phaser scene:", updatedData);
        
                // Restart the Phaser scene with updated data
                const activeScene = window.game.scene.getScene('MainScene');
                if (activeScene) {
                    activeScene.scene.restart(updatedData);
                }  
                console.log("Game Console:", updatedGameConsole);
                turns++;
                return;
            }
        }
    }
} else {
        
        // Check if Monsters State is Hostile and any monsters have HP > 0
        if (monstersState === "Hostile" && monstersInRoom.some(monster => monster.HP > 0)) {
            const message = "The monsters growl and block you from taking any items.";
            chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
            scrollToBottom();
            return;
        }
        
        const itemsToTakeArray = itemsToTake.split(/, | and /).map(item => item.trim());

        const matchingConsoleData = promptAndResponses[gameConsoleIndex].gameConsole;
        let newAdditionalEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);
        let combinedEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);

        let objectsInRoomString = combinedEquipment.match(/Objects in Room: ([^\n]+)/);
        let objectsInRoomPropertiesString = combinedEquipment.match(/Objects in Room Properties: ([^\n]+)/);

        if (objectsInRoomString) {
            objectsInRoomString = objectsInRoomString[1].split(',').map(item => item.trim());
        } else {
            objectsInRoomString = ["None"];
        }
        let itemsInRoom = objectsInRoomString.join(', ').split(', ').map(item => item.trim());
        console.log('itemsInRoom:', itemsInRoom);

        const invalidItems = itemsToTakeArray.filter(itemToTake => {
            return !itemsInRoom.includes(itemToTake);
        });

        const itemsAlreadyInInventory = itemsToTakeArray.filter(item => inventory.includes(item));

        if (!itemsInRoom.some(item => itemsToTakeArray.includes(item)) && itemsAlreadyInInventory.length > 0) {
            const message = `You already have the ${itemsAlreadyInInventory.join(' and ')} in your inventory.`;
            chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
            scrollToBottom();
            return;
        }

        if (invalidItems.length > 0) {
            const message = `There is no ${invalidItems.join(' and ')} here.`;
            chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
            scrollToBottom();
            return;
        }

        console.log('itemsInRoom:', itemsInRoom);
        console.log('roomEquipment:', roomEquipment);
        console.log('objectsInRoomString:', objectsInRoomString);

        if (itemsInRoom.some(item => itemsToTakeArray.includes(item)) || newAdditionalEquipment.some(item => itemsToTakeArray.includes(item))) {
            itemsToTakeArray.forEach(item => {
                itemsInRoom = itemsInRoom.filter(roomItem => !itemsToTakeArray.includes(roomItem));
                objectsInRoomString = objectsInRoomString.filter(roomItem => !roomItem.includes(item.trim()));
            });

            if (combinedEquipment.length === 0) {
                itemsInRoom = ["None"];
            }

            console.log('itemsInRoom:', itemsInRoom);

            inventory.push(...itemsToTakeArray);
            inventory = removeNoneFromInventory(inventory);

            // Move properties to inventoryProperties
            if (objectsInRoomPropertiesString && objectsInRoomPropertiesString[1].trim()) {
                let roomProperties = objectsInRoomPropertiesString[1]
                    .split(/(?<=\}),\s*(?={)/)
                    .map(str => str.endsWith('}') ? str : str + '}')
                    .filter(prop => prop !== null);

                // Add properties of taken items to inventoryProperties
                const updatedRoomProperties = roomProperties.filter(property => {
                    const propertyObj = eval('(' + property + ')'); // Treat the string as a regular object
                    if (itemsToTakeArray.includes(propertyObj.name)) {
                        inventoryProperties.push(property);
                        return false;
                    }
                    return true;
                });

                objectsInRoomPropertiesString = updatedRoomProperties.length > 0 ? updatedRoomProperties.join(', ') : "None";
            } else {
                objectsInRoomPropertiesString = "None";
            }

            const roomHistory = roomConversationHistories[coordinatesToString(currentCoordinates)];
            if (roomHistory) {
                const firstResponseForRoom = getFirstResponseForRoom(currentCoordinates);

                if (firstResponseForRoom) {
                    itemsToTakeArray.forEach(item => {
                        firstResponseForRoom.response = firstResponseForRoom.response.replace(new RegExp(`\\b${item}\\b`, 'gi'), '');
                    });

                    let updatedGameConsole = gameConsoleData.replace(
                        /Objects in Room: ([^\n]+)/,
                        `Objects in Room: ${objectsInRoomString.join(', ')}`
                    );

                    updatedGameConsole = updatedGameConsole.replace(
                        /Objects in Room Properties: ([^\n]+)/,
                        `Objects in Room Properties: ${objectsInRoomPropertiesString}`
                    );

                    // Convert inventoryProperties to a string format for display in the game console
                    const inventoryPropertiesString = inventoryProperties.join(', ');

                    updatedGameConsole = updatedGameConsole.replace(
                        /Inventory Properties: ([^\n]+)/,
                        `Inventory Properties: ${inventoryPropertiesString}`
                    );

                    promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;
                    conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

                    const combinedHistory = conversationHistory + "\n" + userInput;

                    let personalNarrative = await performDynamicSearch(combinedHistory);

                    const messages = [
                        { role: "assistant", content: "" },
                        { role: "system", content: "" },
                        { role: "user", content: userInput }
                    ];

                    const message = `Taken.`;
                    chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
                    scrollToBottom();
                    addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);

                    updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
                    conversationHistory = conversationHistory + "\n" + updatedGameConsole;
                    
                    let newRoomName = updatedGameConsole.match(/Room Name: (.+)/)?.[1];
                    let newRoomHistory = updatedGameConsole.match(/Room Description: (.+)/)?.[1];
                    let newCoordinates = updatedGameConsole.match(/(?<!Boss Room )Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
                    let formattedCoordinates = newCoordinates
                        ? `X: ${newCoordinates[1]}, Y: ${newCoordinates[2]}, Z: ${newCoordinates[3]}`
                        : "None";
                    let newObjectsInRoomString = updatedGameConsole.match(/Objects in Room: (.+)/)?.[1];
                    let newObjectsInRoomPropertiesString = updatedGameConsole.match(/Objects in Room Properties: (.+)/)?.[1]?.trim();
                    let newExitsString = updatedGameConsole.match(/Exits: (.+)/)?.[1];
                    let charactersString = updatedGameConsole.match(/PC:(.*?)(?=NPCs in Party:|$)/s)?.[1]?.trim();
                    let npcsString = updatedGameConsole.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim();
                    let inventoryString = updatedGameConsole.match(/Inventory: (.+)/)?.[1];
                    let newInventoryPropertiesString = updatedGameConsole.match(/Inventory Properties: (.+)/)?.[1];
                    let newMonstersInRoomString = updatedGameConsole.match(/Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s)?.[1]?.trim();
                    let newMonstersEquippedPropertiesString = updatedGameConsole.match(/Monsters Equipped Properties: (.+)/)?.[1];
                    let newMonstersState = updatedGameConsole.match(/Monsters State: (.+)/)?.[1];
                    let currentQuest = updatedGameConsole.match(/Current Quest: (.+)/)?.[1];
                    let nextArtifact = updatedGameConsole.match(/Next Artifact: (.+)/)?.[1];
                    let nextBoss = updatedGameConsole.match(/Next Boss: (.+)/)?.[1];
                    let nextBossRoom = updatedGameConsole.match(/Next Boss Room: (.+)/)?.[1];
                    let bossCoordinates = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
                    if (bossCoordinates) {
                        bossCoordinates = `X: ${bossCoordinates[1]}, Y: ${bossCoordinates[2]}, Z: ${bossCoordinates[3]}`;
                        console.log("Parsed boss room coordinates:", bossCoordinates);
                    } else {
                        console.error("Failed to parse boss room coordinates from updatedGameConsole.");
                    }
                    let adjacentRooms = updatedGameConsole.match(/Adjacent Rooms: (.+)/)?.[1];
                    let puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: (.+)/)?.[1];
                    let puzzleSolution = updatedGameConsole.match(/Puzzle Solution: (.+)/)?.[1];
                    
                            // Construct updated data object
                    const updatedData = {
                        roomName: newRoomName,
                        roomDescription: newRoomHistory,
                        coordinates: formattedCoordinates,
                        objects: newObjectsInRoomString || "None",
                        objectsInRoomProperties: newObjectsInRoomPropertiesString || "None",
                        exits: newExitsString || "None",
                        pc: charactersString || "No PC data",
                        npcs: npcsString || "None",
                        inventory: inventoryString || "None",
                        inventoryProperties: newInventoryPropertiesString || "None",
                        monsters: newMonstersInRoomString || "None",
            			monstersState: newMonstersState || "None",
                        puzzle: {
                            inRoom: puzzleInRoom || "No puzzle",
                            solution: puzzleSolution || "No solution"
                        },
                        currentQuest: currentQuest || "None",
                        nextArtifact: nextArtifact || "None",
                        nextBoss: nextBoss || "None",
                        nextBossRoom: nextBossRoom || "None",
                        bossCoordinates: bossCoordinates || "None",
                        adjacentRooms: adjacentRooms || "None"
                    };
                    
                            // Ensure this runs inside chatbotprocessinput, right after you build `updatedData`
        window.latestUpdatedData = updatedData;
        if (typeof updatedData.inventory === "string" && updatedData.inventory.toLowerCase() !== "none") {
          window.inventory = updatedData.inventory.split(", ").map(s => s.trim()).filter(Boolean);
        }
            
                    console.log("Updated data for Phaser scene:", updatedData);
            
                    // Restart the Phaser scene with updated data
                    const activeScene = window.game.scene.getScene('MainScene');
                    if (activeScene) {
                        activeScene.scene.restart(updatedData);
                    }  
                    console.log("Game Console:", updatedGameConsole);
                    turns++;
                    return;
                }
            }
        }
    }
}

gameConsoleData = null;
gameConsoleIndex = -1;
objectsInRoomMatch = [];
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
  if (promptAndResponses[i].gameConsole) {
    gameConsoleData = promptAndResponses[i].gameConsole;
    gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
    objectsInRoomMatch = gameConsoleData.match(/Objects in Room: ([^\n]+)/) || []; // Ensure objectsInRoomMatch is an array
    if (objectsInRoomMatch.length > 0) {
      break; // Found the most recent gameConsole with "Objects in Room"
    }
  }
}


objectsInRoomString = [];
if (Array.isArray(objectsInRoomMatch) && objectsInRoomMatch.length > 1) {
  objectsInRoomString = objectsInRoomMatch[1].split(',').map(item => item.trim());
  // Split by comma and trim each item
}

console.log('objectsInRoomString:', objectsInRoomString);

if (userWords.length > 1 && userWords[0] === "drop") {
    const itemsToDrop = userWords.slice(1).join(" ").replace(/[.,]$/, "").trim();
    const itemsToDropArray = itemsToDrop.split(/, | and /); // Split by comma or "and"

    const isEquipped = (character, itemName) => {
        return Object.values(character.Equipped).some(equip => equip && equip.name.toLowerCase() === itemName.toLowerCase());
    };

    const invalidItems = itemsToDropArray.filter(item => {
        return !inventory.includes(item) && !isEquipped(characters[0], item) && !npcs.some(npc => isEquipped(npc, item));
    });

    const matchingConsoleData = promptAndResponses[gameConsoleIndex].gameConsole;
    let newAdditionalEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);
    let combinedEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);

    let objectsInRoomString = combinedEquipment.match(/Objects in Room: ([^\n]+)/);
    let objectsInRoomPropertiesString = combinedEquipment.match(/Objects in Room Properties: ([^\n]+)/);

    if (objectsInRoomString) {
        objectsInRoomString = objectsInRoomString[1].split(', ').map(item => item.trim());
    } else {
        objectsInRoomString = ["None"];
    }

    if (objectsInRoomPropertiesString) {
        objectsInRoomPropertiesString = objectsInRoomPropertiesString[1];
    } else {
        objectsInRoomPropertiesString = "None";
    }

    let objectsInRoomProperties = objectsInRoomPropertiesString !== "None" ? objectsInRoomPropertiesString.split(', ').map(item => item.trim()) : [];

    const unequipItem = (character, itemName) => {
        for (let slot in character.Equipped) {
            if (character.Equipped[slot] && character.Equipped[slot].name.toLowerCase() === itemName.toLowerCase()) {
                const itemProperties = character.Equipped[slot];

                // Update the character's stats
                character.Attack -= itemProperties.attack_modifier || 0;
                character.Damage -= itemProperties.damage_modifier || 0;
                character.Armor -= itemProperties.ac || 0;
                character.Magic -= itemProperties.magic || 0;

                // Add the item back to inventory and inventory properties
                inventory.push(itemProperties.name);
                inventoryProperties.push(`{name: "${itemProperties.name}", type: "${itemProperties.type}", attack_modifier: ${itemProperties.attack_modifier}, damage_modifier: ${itemProperties.damage_modifier}, ac: ${itemProperties.ac}, magic: ${itemProperties.magic}}`);

                // Remove the item from the equipped slot
                character.Equipped[slot] = null;

                return true;
            }
        }
        return false;
    };

    if (itemsToDrop.toLowerCase() === "all") {
        if (!inventory.length && !Object.values(characters[0].Equipped).some(equip => equip) && !npcs.some(npc => Object.values(npc.Equipped).some(equip => equip))) {
            const message = `Your inventory is empty.`;
            chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
            scrollToBottom();
            return;
        }

        // Unequip all items if equipped
        Object.values(characters[0].Equipped).forEach(equip => {
            if (equip) unequipItem(characters[0], equip.name);
        });

        npcs.forEach(npc => {
            Object.values(npc.Equipped).forEach(equip => {
                if (equip) unequipItem(npc, equip.name);
            });
        });

        // Append all items in inventory to existing objects in the room
        objectsInRoomString = objectsInRoomString.filter(item => item !== "None").concat(inventory); // Merge existing items and inventory

        // Move all inventory properties to room properties
        objectsInRoomProperties = objectsInRoomProperties.filter(prop => prop !== 'None').concat(inventoryProperties);

        inventory = []; // Clear the inventory
        inventoryProperties = []; // Clear the inventory properties

        // Update the game console data with the modified "Objects in Room"
        let updatedGameConsole = gameConsoleData.replace(
            /Objects in Room: ([^\n]+)/,
            `Objects in Room: ${objectsInRoomString.join(', ')}`
        );

        updatedGameConsole = updatedGameConsole.replace(
            /Objects in Room Properties: ([^\n]+)/,
            `Objects in Room Properties: ${objectsInRoomProperties.join(', ')}`
        );

        updatedGameConsole = updatedGameConsole.replace(
            /Inventory Properties: ([^\n]+)/,
            `Inventory Properties: ${inventoryProperties.join(', ')}`
        );

        // Update the promptAndResponses array with the modified game console data
        promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;

        // Update the conversation history with the modified game console data
        conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

        itemsInRoom = objectsInRoomString;

        // Combine the game console, conversation history, and user input
        const combinedHistory = conversationHistory + "\n" + userInput;

        // Perform dynamic search using the Sentence Transformer model
        let personalNarrative = await performDynamicSearch(combinedHistory);

        // Construct the input message, including the previous response if it exists
        const messages = [
            { role: "assistant", content: "" },
            { role: "system", content: "" },
            { role: "user", content: userInput }
        ];

        const message = `Dropped.`;
        chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
        scrollToBottom();
        // Add the user input, assistant prompt, system prompt, AI response, and personal narrative to the IndexedDB
        addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);
        // Pass the updated game console to the database
        // Update the game console based on user inputs and get the updated game console
        updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
        conversationHistory = conversationHistory + "\n" + updatedGameConsole;

        let newRoomName = updatedGameConsole.match(/Room Name: (.+)/)?.[1];
        let newRoomHistory = updatedGameConsole.match(/Room Description: (.+)/)?.[1];
        let newCoordinates = updatedGameConsole.match(/(?<!Boss Room )Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
        let formattedCoordinates = newCoordinates
            ? `X: ${newCoordinates[1]}, Y: ${newCoordinates[2]}, Z: ${newCoordinates[3]}`
            : "None";
        let newObjectsInRoomString = updatedGameConsole.match(/Objects in Room: (.+)/)?.[1];
        let newObjectsInRoomPropertiesString = updatedGameConsole.match(/Objects in Room Properties: (.+)/)?.[1]?.trim();
        let newExitsString = updatedGameConsole.match(/Exits: (.+)/)?.[1];
        let charactersString = updatedGameConsole.match(/PC:(.*?)(?=NPCs in Party:|$)/s)?.[1]?.trim();
        let npcsString = updatedGameConsole.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim();
        let inventoryString = updatedGameConsole.match(/Inventory: (.+)/)?.[1];
        let newInventoryPropertiesString = updatedGameConsole.match(/Inventory Properties: (.+)/)?.[1];
        let newMonstersInRoomString = updatedGameConsole.match(/Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s)?.[1]?.trim();
        let newMonstersEquippedPropertiesString = updatedGameConsole.match(/Monsters Equipped Properties: (.+)/)?.[1];
        let newMonstersState = updatedGameConsole.match(/Monsters State: (.+)/)?.[1];
        let currentQuest = updatedGameConsole.match(/Current Quest: (.+)/)?.[1];
        let nextArtifact = updatedGameConsole.match(/Next Artifact: (.+)/)?.[1];
        let nextBoss = updatedGameConsole.match(/Next Boss: (.+)/)?.[1];
        let nextBossRoom = updatedGameConsole.match(/Next Boss Room: (.+)/)?.[1];
        let bossCoordinates = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
        if (bossCoordinates) {
            bossCoordinates = `X: ${bossCoordinates[1]}, Y: ${bossCoordinates[2]}, Z: ${bossCoordinates[3]}`;
            console.log("Parsed boss room coordinates:", bossCoordinates);
        } else {
            console.error("Failed to parse boss room coordinates from updatedGameConsole.");
        }
        let adjacentRooms = updatedGameConsole.match(/Adjacent Rooms: (.+)/)?.[1];
        let puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: (.+)/)?.[1];
        let puzzleSolution = updatedGameConsole.match(/Puzzle Solution: (.+)/)?.[1];
        
                // Construct updated data object
        const updatedData = {
            roomName: newRoomName,
            roomDescription: newRoomHistory,
            coordinates: formattedCoordinates,
            objects: newObjectsInRoomString || "None",
            objectsInRoomProperties: newObjectsInRoomPropertiesString || "None",
            exits: newExitsString || "None",
            pc: charactersString || "No PC data",
            npcs: npcsString || "None",
            inventory: inventoryString || "None",
            inventoryProperties: newInventoryPropertiesString || "None",
            monsters: newMonstersInRoomString || "None",
            monstersState: newMonstersState || "None",
            puzzle: {
                inRoom: puzzleInRoom || "No puzzle",
                solution: puzzleSolution || "No solution"
            },
            currentQuest: currentQuest || "None",
            nextArtifact: nextArtifact || "None",
            nextBoss: nextBoss || "None",
            nextBossRoom: nextBossRoom || "None",
            bossCoordinates: bossCoordinates || "None",
            adjacentRooms: adjacentRooms || "None"
        };
        // Ensure this runs inside chatbotprocessinput, right after you build `updatedData`
        window.latestUpdatedData = updatedData;
        if (typeof updatedData.inventory === "string" && updatedData.inventory.toLowerCase() !== "none") {
          window.inventory = updatedData.inventory.split(", ").map(s => s.trim()).filter(Boolean);
        }
        console.log("Updated data for Phaser scene:", updatedData);

        // Restart the Phaser scene with updated data
        const activeScene = window.game.scene.getScene('MainScene');
        if (activeScene) {
            activeScene.scene.restart(updatedData);
        }          

        console.log("Game Console:", updatedGameConsole);
        console.log('itemsInRoom:', itemsInRoom);
        turns++;
        return;
    } else {
        itemsToDropArray.forEach(item => {
            // Unequip the item if equipped by the PC or any NPC
            unequipItem(characters[0], item);
            npcs.forEach(npc => unequipItem(npc, item));
        });

        if (inventory.some(item => itemsToDropArray.includes(item))) {
            inventory = inventory.filter(item => !itemsToDropArray.includes(item));

            if (invalidItems.length > 0) {
                const message = `You don't have the ${invalidItems.join(", ")}.`;
                chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
                scrollToBottom();
                return;
            }

            // Check if objectsInRoomString is ["None"] and update it accordingly
            if (objectsInRoomString.length === 1 && objectsInRoomString[0] === "None") {
                objectsInRoomString = itemsToDropArray.slice(); // Make a copy
            } else {
                // Update objectsInRoomString to include the dropped items
                itemsToDropArray.forEach(item => {
                    if (!objectsInRoomString.includes(item)) {
                        objectsInRoomString.push(item);
                    }
                });
            }

            // Move properties to objectsInRoomProperties
            if (inventoryProperties.length > 0) {
                const updatedInventoryProperties = inventoryProperties.filter(property => {
                    const propertyObj = eval('(' + property + ')'); // Treat the string as a regular object
                    if (itemsToDropArray.includes(propertyObj.name)) {
                        objectsInRoomProperties.push(property);
                        return false;
                    }
                    return true;
                });

                inventoryProperties = updatedInventoryProperties;
            }

            // Remove 'None' if objectsInRoomProperties is populated
            if (objectsInRoomProperties.length > 0) {
                objectsInRoomProperties = objectsInRoomProperties.filter(prop => prop !== 'None');
            }

            let updatedGameConsole = gameConsoleData.replace(
                /Objects in Room: ([^\n]+)/,
                `Objects in Room: ${objectsInRoomString.join(', ')}`
            );

            updatedGameConsole = updatedGameConsole.replace(
                /Objects in Room Properties: ([^\n]+)/,
                `Objects in Room Properties: ${objectsInRoomProperties.join(', ')}`
            );

            updatedGameConsole = updatedGameConsole.replace(
                /Inventory Properties: ([^\n]+)/,
                `Inventory Properties: ${inventoryProperties.join(', ')}`
            );

            // Update the promptAndResponses array with the modified game console data
            promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;

            // Update the conversation history with the modified game console data
            conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

            itemsInRoom = objectsInRoomString;

            // Combine the game console, conversation history, and user input
            const combinedHistory = conversationHistory + "\n" + userInput;

            // Perform dynamic search using the Sentence Transformer model
            let personalNarrative = await performDynamicSearch(combinedHistory);

            // Construct the input message, including the previous response if it exists
            const messages = [
                { role: "assistant", content: "" },
                { role: "system", content: "" },
                { role: "user", content: userInput }
            ];

            const message = `Dropped.`;
            chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
            scrollToBottom();

            // Add the user input, assistant prompt, system prompt, AI response, and personal narrative to the IndexedDB
            addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);

            // Pass the updated game console to the database
            // Update the game console based on user inputs and get the updated game console
            updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
            conversationHistory = conversationHistory + "\n" + updatedGameConsole;
            
            let newRoomName = updatedGameConsole.match(/Room Name: (.+)/)?.[1];
            let newRoomHistory = updatedGameConsole.match(/Room Description: (.+)/)?.[1];
            let newCoordinates = updatedGameConsole.match(/(?<!Boss Room )Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
            let formattedCoordinates = newCoordinates
                ? `X: ${newCoordinates[1]}, Y: ${newCoordinates[2]}, Z: ${newCoordinates[3]}`
                : "None";
            let newObjectsInRoomString = updatedGameConsole.match(/Objects in Room: (.+)/)?.[1];
            let newObjectsInRoomPropertiesString = updatedGameConsole.match(/Objects in Room Properties: (.+)/)?.[1]?.trim();
            let newExitsString = updatedGameConsole.match(/Exits: (.+)/)?.[1];
            let charactersString = updatedGameConsole.match(/PC:(.*?)(?=NPCs in Party:|$)/s)?.[1]?.trim();
            let npcsString = updatedGameConsole.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim();
            let inventoryString = updatedGameConsole.match(/Inventory: (.+)/)?.[1];
            let newInventoryPropertiesString = updatedGameConsole.match(/Inventory Properties: (.+)/)?.[1];
            let newMonstersInRoomString = updatedGameConsole.match(/Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s)?.[1]?.trim();
            let newMonstersEquippedPropertiesString = updatedGameConsole.match(/Monsters Equipped Properties: (.+)/)?.[1];
            let newMonstersState = updatedGameConsole.match(/Monsters State: (.+)/)?.[1];
            let currentQuest = updatedGameConsole.match(/Current Quest: (.+)/)?.[1];
            let nextArtifact = updatedGameConsole.match(/Next Artifact: (.+)/)?.[1];
            let nextBoss = updatedGameConsole.match(/Next Boss: (.+)/)?.[1];
            let nextBossRoom = updatedGameConsole.match(/Next Boss Room: (.+)/)?.[1];
            let bossCoordinates = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
            if (bossCoordinates) {
                bossCoordinates = `X: ${bossCoordinates[1]}, Y: ${bossCoordinates[2]}, Z: ${bossCoordinates[3]}`;
                console.log("Parsed boss room coordinates:", bossCoordinates);
            } else {
                console.error("Failed to parse boss room coordinates from updatedGameConsole.");
            }
            let adjacentRooms = updatedGameConsole.match(/Adjacent Rooms: (.+)/)?.[1];
            let puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: (.+)/)?.[1];
            let puzzleSolution = updatedGameConsole.match(/Puzzle Solution: (.+)/)?.[1];
            
                    // Construct updated data object
            const updatedData = {
                roomName: newRoomName,
                roomDescription: newRoomHistory,
                coordinates: formattedCoordinates,
                objects: newObjectsInRoomString || "None",
                objectsInRoomProperties: newObjectsInRoomPropertiesString || "None",
                exits: newExitsString || "None",
                pc: charactersString || "No PC data",
                npcs: npcsString || "None",
                inventory: inventoryString || "None",
                inventoryProperties: newInventoryPropertiesString || "None",
                monsters: newMonstersInRoomString || "None",
            	monstersState: newMonstersState || "None",
                puzzle: {
                    inRoom: puzzleInRoom || "No puzzle",
                    solution: puzzleSolution || "No solution"
                },
                currentQuest: currentQuest || "None",
                nextArtifact: nextArtifact || "None",
                nextBoss: nextBoss || "None",
                nextBossRoom: nextBossRoom || "None",
                bossCoordinates: bossCoordinates || "None",
                adjacentRooms: adjacentRooms || "None"
            };
    
            // Ensure this runs inside chatbotprocessinput, right after you build `updatedData`
        window.latestUpdatedData = updatedData;
        if (typeof updatedData.inventory === "string" && updatedData.inventory.toLowerCase() !== "none") {
          window.inventory = updatedData.inventory.split(", ").map(s => s.trim()).filter(Boolean);
        }
            console.log("Updated data for Phaser scene:", updatedData);
    
            // Restart the Phaser scene with updated data
            const activeScene = window.game.scene.getScene('MainScene');
            if (activeScene) {
                activeScene.scene.restart(updatedData);
            }  
            
            console.log("Game Console:", updatedGameConsole);
            console.log('itemsInRoom:', itemsInRoom);
            turns++;
            return;
        }
    }
}

gameConsoleData = null;
gameConsoleIndex = -1;
objectsInRoomMatch = [];
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
  if (promptAndResponses[i].gameConsole) {
    gameConsoleData = promptAndResponses[i].gameConsole;
    gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
    objectsInRoomMatch = gameConsoleData.match(/Objects in Room: ([^\n]+)/) || []; // Ensure objectsInRoomMatch is an array
    if (objectsInRoomMatch.length > 0) {
      break; // Found the most recent gameConsole with "Objects in Room"
    }
  }
}


objectsInRoomString = [];
if (Array.isArray(objectsInRoomMatch) && objectsInRoomMatch.length > 1) {
  objectsInRoomString = objectsInRoomMatch[1].split(',').map(item => item.trim());
  // Split by comma and trim each item
}

if (userWords.length > 1 && userWords[0] === "equip") {
    let itemName = userWords.slice(1).join(" ");
    let targetCharacterName = null;

    // Check if there is a target character specified
    if (userWords.includes("to")) {
        const toIndex = userWords.indexOf("to");
        targetCharacterName = userWords.slice(toIndex + 1).join(" ");
        itemName = userWords.slice(1, toIndex).join(" ");
    }

    const message = equipItem(itemName, targetCharacterName);

    // Update the game console
    const matchingConsoleData = promptAndResponses[gameConsoleIndex].gameConsole;
    let updatedGameConsole = matchingConsoleData;

    // Re-generate the equipped items string for the game console
    let combinedEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);

    // Update the conversation history with the modified game console data
    conversationHistory = conversationHistory.replace(matchingConsoleData, combinedEquipment);

    // Combine the game console, conversation history, and user input
    const combinedHistory = conversationHistory + "\n" + userInput;

    // Perform dynamic search using the Sentence Transformer model
    let personalNarrative = await performDynamicSearch(combinedHistory);

    // Construct the input message, including the previous response if it exists
    const messages = [
        { role: "assistant", content: "" },
        { role: "system", content: "" },
        { role: "user", content: userInput }
    ];

    chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
    scrollToBottom();

    // Add the user input, assistant prompt, system prompt, AI response, and personal narrative to the IndexedDB
    addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, combinedEquipment);

    // Update the game console based on user inputs and get the updated game console
    updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
    conversationHistory = conversationHistory + "\n" + updatedGameConsole;
    let newRoomName = updatedGameConsole.match(/Room Name: (.+)/)?.[1];
    let newRoomHistory = updatedGameConsole.match(/Room Description: (.+)/)?.[1];
    let newCoordinates = updatedGameConsole.match(/(?<!Boss Room )Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
    let formattedCoordinates = newCoordinates
        ? `X: ${newCoordinates[1]}, Y: ${newCoordinates[2]}, Z: ${newCoordinates[3]}`
        : "None";
    let newObjectsInRoomString = updatedGameConsole.match(/Objects in Room: (.+)/)?.[1];
    let newObjectsInRoomPropertiesString = updatedGameConsole.match(/Objects in Room Properties: (.+)/)?.[1]?.trim();
    let newExitsString = updatedGameConsole.match(/Exits: (.+)/)?.[1];
    let charactersString = updatedGameConsole.match(/PC:(.*?)(?=NPCs in Party:|$)/s)?.[1]?.trim();
    let npcsString = updatedGameConsole.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim();
    let inventoryString = updatedGameConsole.match(/Inventory: (.+)/)?.[1];
    let newInventoryPropertiesString = updatedGameConsole.match(/Inventory Properties: (.+)/)?.[1];
    let newMonstersInRoomString = updatedGameConsole.match(/Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s)?.[1]?.trim();
    let newMonstersEquippedPropertiesString = updatedGameConsole.match(/Monsters Equipped Properties: (.+)/)?.[1];
    let newMonstersState = updatedGameConsole.match(/Monsters State: (.+)/)?.[1];
    let currentQuest = updatedGameConsole.match(/Current Quest: (.+)/)?.[1];
    let nextArtifact = updatedGameConsole.match(/Next Artifact: (.+)/)?.[1];
    let nextBoss = updatedGameConsole.match(/Next Boss: (.+)/)?.[1];
    let nextBossRoom = updatedGameConsole.match(/Next Boss Room: (.+)/)?.[1];
    let bossCoordinates = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
    if (bossCoordinates) {
        bossCoordinates = `X: ${bossCoordinates[1]}, Y: ${bossCoordinates[2]}, Z: ${bossCoordinates[3]}`;
        console.log("Parsed boss room coordinates:", bossCoordinates);
    } else {
        console.error("Failed to parse boss room coordinates from updatedGameConsole.");
    }
    let adjacentRooms = updatedGameConsole.match(/Adjacent Rooms: (.+)/)?.[1];
    let puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: (.+)/)?.[1];
    let puzzleSolution = updatedGameConsole.match(/Puzzle Solution: (.+)/)?.[1];
    
            // Construct updated data object
    const updatedData = {
        roomName: newRoomName,
        roomDescription: newRoomHistory,
        coordinates: formattedCoordinates,
        objects: newObjectsInRoomString || "None",
        objectsInRoomProperties: newObjectsInRoomPropertiesString || "None",
        exits: newExitsString || "None",
        pc: charactersString || "No PC data",
        npcs: npcsString || "None",
        inventory: inventoryString || "None",
        inventoryProperties: newInventoryPropertiesString || "None",
        monsters: newMonstersInRoomString || "None",
        monstersState: newMonstersState || "None",
        puzzle: {
            inRoom: puzzleInRoom || "No puzzle",
            solution: puzzleSolution || "No solution"
        },
        currentQuest: currentQuest || "None",
        nextArtifact: nextArtifact || "None",
        nextBoss: nextBoss || "None",
        nextBossRoom: nextBossRoom || "None",
        bossCoordinates: bossCoordinates || "None",
        adjacentRooms: adjacentRooms || "None"
    };
    
            // Ensure this runs inside chatbotprocessinput, right after you build `updatedData`
        window.latestUpdatedData = updatedData;
        if (typeof updatedData.inventory === "string" && updatedData.inventory.toLowerCase() !== "none") {
          window.inventory = updatedData.inventory.split(", ").map(s => s.trim()).filter(Boolean);
        }

    console.log("Updated data for Phaser scene:", updatedData);

    // Restart the Phaser scene with updated data
    const activeScene = window.game.scene.getScene('MainScene');
    if (activeScene) {
        activeScene.scene.restart(updatedData);
    }  
    console.log("Game Console:", updatedGameConsole);
    turns++;
    return;
}

gameConsoleData = null;
gameConsoleIndex = -1;
objectsInRoomMatch = [];
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
  if (promptAndResponses[i].gameConsole) {
    gameConsoleData = promptAndResponses[i].gameConsole;
    gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
    objectsInRoomMatch = gameConsoleData.match(/Objects in Room: ([^\n]+)/) || []; // Ensure objectsInRoomMatch is an array
    if (objectsInRoomMatch.length > 0) {
      break; // Found the most recent gameConsole with "Objects in Room"
    }
  }
}


objectsInRoomString = [];
if (Array.isArray(objectsInRoomMatch) && objectsInRoomMatch.length > 1) {
  objectsInRoomString = objectsInRoomMatch[1].split(',').map(item => item.trim());
  // Split by comma and trim each item
}

// Handle unequip command
if (userWords.length > 1 && userWords[0] === "unequip") {
    const matchingConsoleData = promptAndResponses[gameConsoleIndex].gameConsole;
    let newAdditionalEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);
    let combinedEquipment = updateGameConsole(userInput, currentCoordinates, conversationHistory);

    let updatedGameConsole = gameConsoleData;

    let objectsInRoomString = combinedEquipment.match(/Objects in Room: ([^\n]+)/);
    let objectsInRoomPropertiesString = combinedEquipment.match(/Objects in Room Properties: ([^\n]+)/);

    let itemName = userWords.slice(1).join(" ");
    let targetCharacterName = null;

    // Check if there is a target character specified
    if (userWords.includes("from")) {
        const fromIndex = userWords.indexOf("from");
        targetCharacterName = userWords.slice(fromIndex + 1).join(" ");
        itemName = userWords.slice(1, fromIndex).join(" ");
    }

    const message = unequipItem(itemName, targetCharacterName);
    promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;

    // Update the conversation history with the modified game console data
    conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

    // Combine the game console, conversation history, and user input
    const combinedHistory = conversationHistory + "\n" + userInput;

    // Perform dynamic search using the Sentence Transformer model
    let personalNarrative = await performDynamicSearch(combinedHistory);

    // Construct the input message, including the previous response if it exists
    const messages = [
        { role: "assistant", content: "" },
        { role: "system", content: "" },
        { role: "user", content: userInput }
    ];

    chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
    scrollToBottom();

    // Add the user input, assistant prompt, system prompt, AI response, and personal narrative to the IndexedDB
    addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);

    // Update the game console based on user inputs and get the updated game console
    updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
    conversationHistory = conversationHistory + "\n" + updatedGameConsole;
    
    let newRoomName = updatedGameConsole.match(/Room Name: (.+)/)?.[1];
    let newRoomHistory = updatedGameConsole.match(/Room Description: (.+)/)?.[1];
    let newCoordinates = updatedGameConsole.match(/(?<!Boss Room )Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
    let formattedCoordinates = newCoordinates
        ? `X: ${newCoordinates[1]}, Y: ${newCoordinates[2]}, Z: ${newCoordinates[3]}`
        : "None";
    let newObjectsInRoomString = updatedGameConsole.match(/Objects in Room: (.+)/)?.[1];
    let newObjectsInRoomPropertiesString = updatedGameConsole.match(/Objects in Room Properties: (.+)/)?.[1]?.trim();
    let newExitsString = updatedGameConsole.match(/Exits: (.+)/)?.[1];
    let charactersString = updatedGameConsole.match(/PC:(.*?)(?=NPCs in Party:|$)/s)?.[1]?.trim();
    let npcsString = updatedGameConsole.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim();
    let inventoryString = updatedGameConsole.match(/Inventory: (.+)/)?.[1];
    let newInventoryPropertiesString = updatedGameConsole.match(/Inventory Properties: (.+)/)?.[1];
    let newMonstersInRoomString = updatedGameConsole.match(/Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s)?.[1]?.trim();
    let newMonstersEquippedPropertiesString = updatedGameConsole.match(/Monsters Equipped Properties: (.+)/)?.[1];
    let newMonstersState = updatedGameConsole.match(/Monsters State: (.+)/)?.[1];
    let currentQuest = updatedGameConsole.match(/Current Quest: (.+)/)?.[1];
    let nextArtifact = updatedGameConsole.match(/Next Artifact: (.+)/)?.[1];
    let nextBoss = updatedGameConsole.match(/Next Boss: (.+)/)?.[1];
    let nextBossRoom = updatedGameConsole.match(/Next Boss Room: (.+)/)?.[1];
    let bossCoordinates = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
    if (bossCoordinates) {
        bossCoordinates = `X: ${bossCoordinates[1]}, Y: ${bossCoordinates[2]}, Z: ${bossCoordinates[3]}`;
        console.log("Parsed boss room coordinates:", bossCoordinates);
    } else {
        console.error("Failed to parse boss room coordinates from updatedGameConsole.");
    }
    let adjacentRooms = updatedGameConsole.match(/Adjacent Rooms: (.+)/)?.[1];
    let puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: (.+)/)?.[1];
    let puzzleSolution = updatedGameConsole.match(/Puzzle Solution: (.+)/)?.[1];
    
            // Construct updated data object
    const updatedData = {
        roomName: newRoomName,
        roomDescription: newRoomHistory,
        coordinates: formattedCoordinates,
        objects: newObjectsInRoomString || "None",
        objectsInRoomProperties: newObjectsInRoomPropertiesString || "None",
        exits: newExitsString || "None",
        pc: charactersString || "No PC data",
        npcs: npcsString || "None",
        inventory: inventoryString || "None",
        inventoryProperties: newInventoryPropertiesString || "None",
        monsters: newMonstersInRoomString || "None",
        monstersState: newMonstersState || "None",
        puzzle: {
            inRoom: puzzleInRoom || "No puzzle",
            solution: puzzleSolution || "No solution"
        },
        currentQuest: currentQuest || "None",
        nextArtifact: nextArtifact || "None",
        nextBoss: nextBoss || "None",
        nextBossRoom: nextBossRoom || "None",
        bossCoordinates: bossCoordinates || "None",
        adjacentRooms: adjacentRooms || "None"
    };
    
            // Ensure this runs inside chatbotprocessinput, right after you build `updatedData`
        window.latestUpdatedData = updatedData;
        if (typeof updatedData.inventory === "string" && updatedData.inventory.toLowerCase() !== "none") {
          window.inventory = updatedData.inventory.split(", ").map(s => s.trim()).filter(Boolean);
        }

    console.log("Updated data for Phaser scene:", updatedData);

    // Restart the Phaser scene with updated data
    const activeScene = window.game.scene.getScene('MainScene');
    if (activeScene) {
        activeScene.scene.restart(updatedData);
    }  
    
    console.log("Game Console:", updatedGameConsole);
    turns++;
    return;
}

gameConsoleData = null;
gameConsoleIndex = -1;
objectsInRoomMatch = [];
 // New variable to hold the NPCs in Party string

// Search for the latest game console data and extract NPCs in Party
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
    if (promptAndResponses[i].gameConsole) {
        gameConsoleData = promptAndResponses[i].gameConsole;
        gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
        objectsInRoomMatch = gameConsoleData.match(/Objects in Room: ([^\n]+)/) || []; // Ensure objectsInRoomMatch is an array
 // Extract NPCs in Party
        if (objectsInRoomMatch.length > 0 ) {
            break; // Found the most recent gameConsole with "Objects in Room" or "NPCs in Party"
        }
    }
}

objectsInRoomString = [];
if (Array.isArray(objectsInRoomMatch) && objectsInRoomMatch.length > 1) {
    objectsInRoomString = objectsInRoomMatch[1].split(',').map(item => item.trim());
    // Split by comma and trim each item
}

// New code to access monsters in the room
const roomKey = coordinatesToString(currentCoordinates);
let monstersInRoom = monstersInVisitedRooms.get(roomKey) || [];

// Process adding a monster to the party
if (userWords.length > 3 && userWords[0] === "add" && userWords[userWords.length - 2] === "to" && userWords[userWords.length - 1] === "party") {
    
    // Extract Monsters State
    const monstersStateMatch = promptAndResponses[gameConsoleIndex].gameConsole.match(/Monsters State: ([^\n]+)/);
    let monstersState = monstersStateMatch ? monstersStateMatch[1].trim() : "";
        
    let monsterNameInput = userWords.slice(1, userWords.length - 2).join(" "); // Extract the monster name input

    // Capitalize the first letter of monsterNameInput
    monsterNameInput = monsterNameInput.charAt(0).toUpperCase() + monsterNameInput.slice(1);

    // Find all monsters that match the input name (case-insensitive comparison)
    const matchingMonsters = monstersInRoom.filter(
        (monster) => monster.Name.toLowerCase().startsWith(monsterNameInput.toLowerCase())
    );

    if (matchingMonsters.length === 0) {
        const message = `${monsterNameInput} is not in the room.`;
        chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
        scrollToBottom();
        return;
    }

    if (matchingMonsters.length > 1) {
        const monsterNamesList = matchingMonsters.map(monster => monster.Name).join(", ");
        const message = `Which do you mean? ${monsterNamesList}`;
        chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
        scrollToBottom();
        return;
    }

    const correctCasedMonsterName = matchingMonsters[0].Name;
    userInput = `add ${correctCasedMonsterName} to party`;

    // Check the state of the monster
    if (monstersState === "Hostile") {
        const message = `${correctCasedMonsterName} refuses to join your party. The monster is hostile and not willing to cooperate.`;
        chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
        scrollToBottom();
        return;
    } else if (monstersState === "Neutral") {
        const message = `${correctCasedMonsterName} declines your invitation. The monster seems indifferent and does not trust you enough to join.`;
        chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
        scrollToBottom();
        return;
    }

    // Proceed to add the monster to the party if the state is not Hostile or Neutral
    const matchingConsoleData = promptAndResponses[gameConsoleIndex].gameConsole;
    let updatedGameConsole = matchingConsoleData;

    updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
    console.log('updatedGameConsole:', updatedGameConsole);

    const message = `You added ${correctCasedMonsterName} to the party.`;

    promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;

    conversationHistory = conversationHistory.replace(matchingConsoleData, updatedGameConsole);

    itemsInRoom = objectsInRoomString;

    const combinedHistory = conversationHistory + "\n" + userInput;

    let personalNarrative = await performDynamicSearch(combinedHistory);
    // Construct the input message, including the previous response if it exists
    const messages = [
        { role: "assistant", content: "" },
        { role: "system", content: "" },
        { role: "user", content: userInput }
    ];

    chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
    scrollToBottom();

    addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);

    updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
    conversationHistory = conversationHistory + "\n" + updatedGameConsole;
    // Call the helper function to update npcsInParty and npcsInPartyString
    updateNpcsInParty(updatedGameConsole);

    let newRoomName = updatedGameConsole.match(/Room Name: (.+)/)?.[1];
    let newRoomHistory = updatedGameConsole.match(/Room Description: (.+)/)?.[1];
    let newCoordinates = updatedGameConsole.match(/(?<!Boss Room )Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
    let formattedCoordinates = newCoordinates
        ? `X: ${newCoordinates[1]}, Y: ${newCoordinates[2]}, Z: ${newCoordinates[3]}`
        : "None";
    let newObjectsInRoomString = updatedGameConsole.match(/Objects in Room: (.+)/)?.[1];
    let newObjectsInRoomPropertiesString = updatedGameConsole.match(/Objects in Room Properties: (.+)/)?.[1]?.trim();
    let newExitsString = updatedGameConsole.match(/Exits: (.+)/)?.[1];
    let charactersString = updatedGameConsole.match(/PC:(.*?)(?=NPCs in Party:|$)/s)?.[1]?.trim();
    let npcsString = updatedGameConsole.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim();
    let inventoryString = updatedGameConsole.match(/Inventory: (.+)/)?.[1];
    let newInventoryPropertiesString = updatedGameConsole.match(/Inventory Properties: (.+)/)?.[1];
    let newMonstersInRoomString = updatedGameConsole.match(/Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s)?.[1]?.trim();
    let newMonstersEquippedPropertiesString = updatedGameConsole.match(/Monsters Equipped Properties: (.+)/)?.[1];
    let newMonstersState = updatedGameConsole.match(/Monsters State: (.+)/)?.[1];
    let currentQuest = updatedGameConsole.match(/Current Quest: (.+)/)?.[1];
    let nextArtifact = updatedGameConsole.match(/Next Artifact: (.+)/)?.[1];
    let nextBoss = updatedGameConsole.match(/Next Boss: (.+)/)?.[1];
    let nextBossRoom = updatedGameConsole.match(/Next Boss Room: (.+)/)?.[1];
    let bossCoordinates = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
    if (bossCoordinates) {
        bossCoordinates = `X: ${bossCoordinates[1]}, Y: ${bossCoordinates[2]}, Z: ${bossCoordinates[3]}`;
        console.log("Parsed boss room coordinates:", bossCoordinates);
    } else {
        console.error("Failed to parse boss room coordinates from updatedGameConsole.");
    }
    let adjacentRooms = updatedGameConsole.match(/Adjacent Rooms: (.+)/)?.[1];
    let puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: (.+)/)?.[1];
    let puzzleSolution = updatedGameConsole.match(/Puzzle Solution: (.+)/)?.[1];
    
            // Construct updated data object
    const updatedData = {
        roomName: newRoomName,
        roomDescription: newRoomHistory,
        coordinates: formattedCoordinates,
        objects: newObjectsInRoomString || "None",
        objectsInRoomProperties: newObjectsInRoomPropertiesString || "None",
        exits: newExitsString || "None",
        pc: charactersString || "No PC data",
        npcs: npcsString || "None",
        inventory: inventoryString || "None",
        inventoryProperties: newInventoryPropertiesString || "None",
        monsters: newMonstersInRoomString || "None",
        monstersState: newMonstersState || "None",
        puzzle: {
            inRoom: puzzleInRoom || "No puzzle",
            solution: puzzleSolution || "No solution"
        },
        currentQuest: currentQuest || "None",
        nextArtifact: nextArtifact || "None",
        nextBoss: nextBoss || "None",
        nextBossRoom: nextBossRoom || "None",
        bossCoordinates: bossCoordinates || "None",
        adjacentRooms: adjacentRooms || "None"
    };
    
            // Ensure this runs inside chatbotprocessinput, right after you build `updatedData`
        window.latestUpdatedData = updatedData;
        if (typeof updatedData.inventory === "string" && updatedData.inventory.toLowerCase() !== "none") {
          window.inventory = updatedData.inventory.split(", ").map(s => s.trim()).filter(Boolean);
        }

    console.log("Updated data for Phaser scene:", updatedData);

    // Restart the Phaser scene with updated data
    const activeScene = window.game.scene.getScene('MainScene');
    if (activeScene) {
        activeScene.scene.restart(updatedData);
    }  
    
    console.log("Game Console:", updatedGameConsole);
    console.log('itemsInRoom:', itemsInRoom);
    turns++;
    return;
}

gameConsoleData = null;
gameConsoleIndex = -1;
objectsInRoomMatch = [];
 // New variable to hold the NPCs in Party string

// Search for the latest game console data and extract NPCs in Party
for (let i = promptAndResponses.length - 1; i >= 0; i--) {
    if (promptAndResponses[i].gameConsole) {
        gameConsoleData = promptAndResponses[i].gameConsole;
        gameConsoleIndex = i; // Save the index of the game console in promptAndResponses
        objectsInRoomMatch = gameConsoleData.match(/Objects in Room: ([^\n]+)/) || []; // Ensure objectsInRoomMatch is an array

        if (objectsInRoomMatch.length > 0 ) {
            break; // Found the most recent gameConsole with "Objects in Room" or "NPCs in Party"
        }
    }
}

objectsInRoomString = [];
if (Array.isArray(objectsInRoomMatch) && objectsInRoomMatch.length > 1) {
    objectsInRoomString = objectsInRoomMatch[1].split(',').map(item => item.trim());
    // Split by comma and trim each item
}

// Ensure npcsInPartyString is not undefined, null, or empty

console.log("npcsInParty:", npcsInParty);

// New code to access monsters in the room
monstersInRoom = monstersInVisitedRooms.get(roomKey) || [];


// Process removing an NPC from the party
if (userWords.length > 3 && userWords[0] === "remove" && userWords[userWords.length - 2] === "from" && userWords[userWords.length - 1] === "party") {
    
        // Proceed to add the monster to the party if the state is not Hostile or Neutral
    const matchingConsoleData = promptAndResponses[gameConsoleIndex].gameConsole;
    let updatedGameConsole = matchingConsoleData;
    
    let npcNameInput = userWords.slice(1, userWords.length - 2).join(" "); // Extract the NPC name input

    // Capitalize the first letter of npcNameInput
    npcNameInput = npcNameInput.charAt(0).toUpperCase() + npcNameInput.slice(1);

    npcsInPartyString = updatedGameConsole.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim() || "";

    if (npcsInPartyString) {
        try {
            const npcBlocks = npcsInPartyString.split(/\n(?=\w)/);
            npcsInParty = npcBlocks.map(npcBlock => {
                const lines = npcBlock.trim().split('\n').map(line => line.trim());
                return {
                    Name: lines[0]
                };
            });
        } catch (error) {
            console.error("Error parsing npcsInPartyString:", error);
        }
    }

    const matchingNpcs = npcsInParty.filter(
        (npc) => npc.Name.toLowerCase().startsWith(npcNameInput.toLowerCase())
    );

    if (matchingNpcs.length === 0) {
        const message = `${npcNameInput} is not in the party.`;
        chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
        scrollToBottom();
        return;
    }

    if (matchingNpcs.length > 1) {
        const npcNamesList = matchingNpcs.map(npc => npc.Name).join(", ");
        const message = `Which do you mean? ${npcNamesList}`;
        chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
        scrollToBottom();
        return;
    }

    const correctCasedNpcName = matchingNpcs[0].Name;
    userInput = `remove ${correctCasedNpcName} from party`;

    updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
    console.log('updatedGameConsole:', updatedGameConsole);

    const message = `You removed ${correctCasedNpcName} from the party.`;

    promptAndResponses[gameConsoleIndex].gameConsole = updatedGameConsole;

    conversationHistory = conversationHistory.replace(gameConsoleData, updatedGameConsole);

    itemsInRoom = objectsInRoomString;

    const combinedHistory = conversationHistory + "\n" + userInput;

    let personalNarrative = await performDynamicSearch(combinedHistory);
    // Construct the input message, including the previous response if it exists
    const messages = [
        { role: "assistant", content: "" },
        { role: "system", content: "" },
        { role: "user", content: userInput }
    ];

    chatLog.innerHTML = chatHistory + "<br><br><b> > </b>" + userInput + "<br><br><b></b>" + message.replace(/\n/g, "<br>");
    scrollToBottom();

    addPromptAndResponse(userInput, messages[0].content, messages[1].content, message, personalNarrative, conversationId, updatedGameConsole);

    updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
    conversationHistory = conversationHistory + "\n" + updatedGameConsole;
    
    let newRoomName = updatedGameConsole.match(/Room Name: (.+)/)?.[1];
    let newRoomHistory = updatedGameConsole.match(/Room Description: (.+)/)?.[1];
    let newCoordinates = updatedGameConsole.match(/(?<!Boss Room )Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
    let formattedCoordinates = newCoordinates
        ? `X: ${newCoordinates[1]}, Y: ${newCoordinates[2]}, Z: ${newCoordinates[3]}`
        : "None";
    let newObjectsInRoomString = updatedGameConsole.match(/Objects in Room: (.+)/)?.[1];
    let newObjectsInRoomPropertiesString = updatedGameConsole.match(/Objects in Room Properties: (.+)/)?.[1]?.trim();
    let newExitsString = updatedGameConsole.match(/Exits: (.+)/)?.[1];
    let charactersString = updatedGameConsole.match(/PC:(.*?)(?=NPCs in Party:|$)/s)?.[1]?.trim();
    let npcsString = updatedGameConsole.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim();
    let inventoryString = updatedGameConsole.match(/Inventory: (.+)/)?.[1];
    let newInventoryPropertiesString = updatedGameConsole.match(/Inventory Properties: (.+)/)?.[1];
    let newMonstersInRoomString = updatedGameConsole.match(/Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s)?.[1]?.trim();
    let newMonstersEquippedPropertiesString = updatedGameConsole.match(/Monsters Equipped Properties: (.+)/)?.[1];
    let newMonstersState = updatedGameConsole.match(/Monsters State: (.+)/)?.[1];
    let currentQuest = updatedGameConsole.match(/Current Quest: (.+)/)?.[1];
    let nextArtifact = updatedGameConsole.match(/Next Artifact: (.+)/)?.[1];
    let nextBoss = updatedGameConsole.match(/Next Boss: (.+)/)?.[1];
    let nextBossRoom = updatedGameConsole.match(/Next Boss Room: (.+)/)?.[1];
    let bossCoordinates = updatedGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
    if (bossCoordinates) {
        bossCoordinates = `X: ${bossCoordinates[1]}, Y: ${bossCoordinates[2]}, Z: ${bossCoordinates[3]}`;
        console.log("Parsed boss room coordinates:", bossCoordinates);
    } else {
        console.error("Failed to parse boss room coordinates from updatedGameConsole.");
    }
    let adjacentRooms = updatedGameConsole.match(/Adjacent Rooms: (.+)/)?.[1];
    let puzzleInRoom = updatedGameConsole.match(/Puzzle in Room: (.+)/)?.[1];
    let puzzleSolution = updatedGameConsole.match(/Puzzle Solution: (.+)/)?.[1];
    
            // Construct updated data object
    const updatedData = {
        roomName: newRoomName,
        roomDescription: newRoomHistory,
        coordinates: formattedCoordinates,
        objects: newObjectsInRoomString || "None",
        objectsInRoomProperties: newObjectsInRoomPropertiesString || "None",
        exits: newExitsString || "None",
        pc: charactersString || "No PC data",
        npcs: npcsString || "None",
        inventory: inventoryString || "None",
        inventoryProperties: newInventoryPropertiesString || "None",
        monsters: newMonstersInRoomString || "None",
        monstersState: newMonstersState || "None",
        puzzle: {
            inRoom: puzzleInRoom || "No puzzle",
            solution: puzzleSolution || "No solution"
        },
        currentQuest: currentQuest || "None",
        nextArtifact: nextArtifact || "None",
        nextBoss: nextBoss || "None",
        nextBossRoom: nextBossRoom || "None",
        bossCoordinates: bossCoordinates || "None",
        adjacentRooms: adjacentRooms || "None"
    };
    
            // Ensure this runs inside chatbotprocessinput, right after you build `updatedData`
        window.latestUpdatedData = updatedData;
        if (typeof updatedData.inventory === "string" && updatedData.inventory.toLowerCase() !== "none") {
          window.inventory = updatedData.inventory.split(", ").map(s => s.trim()).filter(Boolean);
        }

    console.log("Updated data for Phaser scene:", updatedData);

    // Restart the Phaser scene with updated data
    const activeScene = window.game.scene.getScene('MainScene');
    if (activeScene) {
        activeScene.scene.restart(updatedData);
    }  
    
    console.log("Game Console:", updatedGameConsole);
    console.log('itemsInRoom:', itemsInRoom);
    turns++;
    return;
}

  // Update the game console based on user inputs and get the updated game console
 let updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString);
  console.log('updatedGameConsole:', updatedGameConsole);
  
  conversationHistory = conversationHistory + "\n" + updatedGameConsole;

  // Combine the game console, conversation history, and user input
  const combinedHistory = conversationHistory + "\n" + userInput;

  // Perform dynamic search using the Sentence Transformer model
  let personalNarrative = await performDynamicSearch(combinedHistory);

    const messages = [
    { role: "assistant", content: "" },
    { role: "system", content: "" },
    { role: "user", content: userInput }
  ];
  
      // Add the personal narrative to the latest response (system prompt)
  if (personalNarrative) {
    messages[1].content;
  }
  
const TIMEOUT_DURATION = 480000; // 3 minutes in milliseconds

// Wrap fetch in a promise with timeout
function fetchWithTimeout(resource, options = {}, timeout = TIMEOUT_DURATION) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('Request timed out')), timeout);
        fetch(resource, options)
            .then(response => {
                clearTimeout(timeoutId);
                resolve(response);
            })
            .catch(err => {
                clearTimeout(timeoutId);
                reject(err);
            });
    });
}

function fetchWithTimeout2(resource, options = {}, timeout = TIMEOUT_DURATION2) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('Request timed out')), timeout);
        fetch(resource, options)
            .then(response => {
                clearTimeout(timeoutId);
                resolve(response);
            })
            .catch(err => {
                clearTimeout(timeoutId);
                reject(err);
            });
    });
}

const combatMode = window.combatMode;

fetchWithTimeout('/updateState7', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personalNarrative, updatedGameConsole, roomNameDatabaseString, combatCharactersString, combatMode }),
})
    .then(response => response.json())
    .then(data => console.log(data))
    .catch(error => console.error('Error:', error));

// Extend $.ajax with a timeout setting
$.ajax({
  url: '/processInput7',
  type: 'POST',
  contentType: 'application/json',
  data: JSON.stringify({ userInput: userInput }),
  timeout: 4800000, // Set timeout to 3 minutes (for the initial request)
  success: function(initialResponse) {
    clearInterval(window.keepAliveInterval);
    const taskId = initialResponse.taskId; // Get taskId from immediate 202 response

    // Start polling /poll-task/:taskId every 5 seconds
    const pollInterval = setInterval(function() {
      $.ajax({
        url: `/poll-task2/${taskId}`,
        type: 'GET',
        timeout: 30000, // Short timeout for polls
        // In game.js, within the $.ajax success callback in chatbotprocessinput:
        success: function(pollResponse) {
          console.log('Poll response:', pollResponse); // Debug the raw response
          if (pollResponse.status === 'processing') {
            console.log('Task still processing...');
          } else {
            clearInterval(pollInterval); // Stop polling on complete/error
        
            if (pollResponse.status === 'error') {
              console.error('Task error:', pollResponse.result);
              updateChatLog("<br><b>Error:</b> " + pollResponse.result + "<br>");
              return;
            }
        
            // Task complete: Process the response with error handling
            try {
              const result = pollResponse.result || {};
              let content = result.response;
              let imageUrl = result.imageUrl;
              let serverGameConsole = result.updatedGameConsole;
         //     window.lastGameConsoleText = serverGameConsole || window.lastGameConsoleText || "";
              let newCombatCharactersString = result.combatCharactersString;
              let serverRoomNameDatabaseString = result.roomNameDatabaseString; // Extract from server
              let serverCombatMode = result.combatMode;
        
              // NEW: Extract musicArrangement and isNewRoom
              let musicArrangement = result.musicArrangement;
              let isNewRoom = result.isNewRoom;
              
              // Parse coords from serverGameConsole (already doing this nearby)
                const m = serverGameConsole.match(/Coordinates:\s*X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/);
                const cx = m ? parseInt(m[1]) : 0;
                const cy = m ? parseInt(m[2]) : 0;
                const cz = m ? parseInt(m[3]) : 0;
                const coordsKey = `${cx},${cy},${cz}`;
                
                if (isNewRoom) {
                  // 1) ask server for JSON it has for this room
                  fetch(`/get-room-music?coords=${encodeURIComponent(coordsKey)}`)
                    .then(r => r.json())
                    .then(async ({ music }) => {
                      if (music) {
                        // 2) cache locally
                        await idbSetMusic(coordsKey, music);
                        // 3) tell server to write retort/current_room.json and render WAV
                        return fetch('/music/commit', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ coords: coordsKey })
                        });
                      } else {
                        // No JSON on server? try local cache
                        const local = await idbGetMusic(coordsKey);
                        if (!local) {
                          console.warn('No music JSON for room; skipping audio for now:', coordsKey);
                          return null;
                        }
                        return fetch('/music/commit', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ coords: coordsKey, musicJson: local })
                        });
                      }
                    })
                    .then(r => r && r.json ? r.json() : null)
                    .then(resp => {
                      if (resp?.ok && resp?.wav) {
                        // We’ll actually start playback on SSE "roomMusicReady" (it includes a cache-buster),
                        // but we can optimistic-play too:
                        playRoomWav(resp.wav + '?cb=' + Date.now());
                      }
                    })
                    .catch(err => console.error('room-music flow failed:', err));
                }

              console.log("serverGameConsole:", serverGameConsole);
              console.log("combatCharactersString from server:", newCombatCharactersString);
              console.log("musicArrangement:", musicArrangement);
              console.log("isNewRoom:", isNewRoom);
        
              // Update roomNameDatabase from server
              if (serverRoomNameDatabaseString) {
                roomNameDatabaseString = serverRoomNameDatabaseString;
                roomNameDatabasePlainObject = JSON.parse(roomNameDatabaseString);
                roomNameDatabase.clear();
                for (const [key, value] of Object.entries(roomNameDatabasePlainObject)) {
                  roomNameDatabase.set(key, value);
                }
                // Migration for bad keys
                let needsUpdate = false;
                for (const [key, value] of roomNameDatabase.entries()) {
                  if (key.startsWith('X:')) {
                    const cleanKey = key.replace(/X: |Y: |Z: /g, '').replace(/, /g, ',');
                    roomNameDatabase.set(cleanKey, value);
                    roomNameDatabase.delete(key);
                    needsUpdate = true;
                  }
                }
                if (needsUpdate) {
                  roomNameDatabasePlainObject = mapToPlainObject(roomNameDatabase);
                  roomNameDatabaseString = JSON.stringify(roomNameDatabasePlainObject);
                }
                console.log("Updated local roomNameDatabase from server");
              }
        
              // Update client combatMode and UI
              if (serverCombatMode) {
                window.combatMode = serverCombatMode;
                document.getElementById('combat-mode-select').value = serverCombatMode;
                const combatButton = document.getElementById('open-combat-button');
                combatButton.style.display = serverCombatMode === 'No Combat Map' ? 'none' : 'block';
                console.log(`Updated client combatMode to ${serverCombatMode}`);
              }
        
              // Parse new details from serverGameConsole
              let newRoomName = serverGameConsole.match(/Room Name: ([^\n]+)/)?.[1];
              let newRoomHistory = serverGameConsole.match(/Room Description: ([^\n]+)/)?.[1];
              let newCoordinates = serverGameConsole.match(/(?<!Boss Room )Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
              let formattedCoordinates = newCoordinates
                ? `X: ${newCoordinates[1]}, Y: ${newCoordinates[2]}, Z: ${newCoordinates[3]}`
                : "None";
              if (newCoordinates) {
                const coordsLine = `Coordinates: X: ${newCoordinates[1]}, Y: ${newCoordinates[2]}, Z: ${newCoordinates[3]}`;
                if (updatedGameConsole.match(/(^|\n)Coordinates: X: -?\d+, Y: -?\d+, Z: -?\d+/)) {
                  updatedGameConsole = updatedGameConsole.replace(
                    /(^|\n)Coordinates: X: -?\d+, Y: -?\d+, Z: -?\d+/,
                    `$1${coordsLine}`
                  );
                } else {
                  updatedGameConsole = `${coordsLine}\n${updatedGameConsole}`;
                }
              }
              let newObjectsInRoomString = serverGameConsole.match(/Objects in Room: ([^\n]+)/)?.[1];
              let newObjectsInRoomPropertiesString = serverGameConsole.match(/Objects in Room Properties: ([^\n]+)/)?.[1]?.trim();
              let newExitsString = serverGameConsole.match(/Exits: ([^\n]+)/)?.[1];
              let charactersString = serverGameConsole.match(/PC:(.*?)(?=NPCs in Party:|$)/s)?.[1]?.trim();
              let npcsString = serverGameConsole.match(/NPCs in Party:(.*?)(?=Monsters in Room:|$)/s)?.[1]?.trim();
              let inventoryString = serverGameConsole.match(/Inventory: ([^\n]+)/)?.[1];
              let inventoryPropertiesString = serverGameConsole.match(/Inventory Properties: ([^\n]+)/)?.[1];
              let newMonstersInRoomString = serverGameConsole.match(/Monsters in Room:(.*?)(?=Monsters Equipped Properties:|$)/s)?.[1]?.trim();
              let newMonstersEquippedPropertiesString = serverGameConsole.match(/Monsters Equipped Properties: ([^\n]+)/)?.[1];
              let newMonstersState = serverGameConsole.match(/Monsters State: ([^\n]+)/)?.[1];
              let currentQuest = serverGameConsole.match(/Current Quest: ([^\n]+)/)?.[1];
              let nextArtifact = serverGameConsole.match(/Next Artifact: ([^\n]+)/)?.[1];
              let nextBoss = serverGameConsole.match(/Next Boss: ([^\n]+)/)?.[1];
              let nextBossRoom = serverGameConsole.match(/Next Boss Room: ([^\n]+)/)?.[1];
              let bossCoordinates = serverGameConsole.match(/Boss Room Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
              if (bossCoordinates) {
                bossCoordinates = `X: ${bossCoordinates[1]}, Y: ${bossCoordinates[2]}, Z: ${bossCoordinates[3]}`;
                console.log("Parsed boss room coordinates:", bossCoordinates);
              } else {
                console.error("Failed to parse boss room coordinates from serverGameConsole.");
              }
              let adjacentRooms = serverGameConsole.match(/Adjacent Rooms: ([^\n]+)/)?.[1];
              let puzzleInRoom = serverGameConsole.match(/Puzzle in Room: ([^\n]+)/)?.[1];
              let puzzleSolution = serverGameConsole.match(/Puzzle Solution: ([^\n]+)/)?.[1];
              
              // NEW: Trigger music playback for new room
              if (musicArrangement && isNewRoom) {
                console.log('New room detected, playing music');
                playRoomMusic();
              }
        
              // Update the game console with new room details and exits
              updatedGameConsole = updatedGameConsole.replace(/Room Name: .*/, `Room Name: ${newRoomName}`);
              updatedGameConsole = updatedGameConsole.replace(/Room Description: .*/, `Room Description: ${newRoomHistory}`);
              updatedGameConsole = updatedGameConsole.replace(/Objects in Room: .*/, `Objects in Room: ${newObjectsInRoomString}`);
              updatedGameConsole = updatedGameConsole.replace(/Objects in Room Properties: .*/, `Objects in Room Properties: ${newObjectsInRoomPropertiesString}`);
              updatedGameConsole = updatedGameConsole.replace(/Exits: .*/, `Exits: ${newExitsString}`);
              updatedGameConsole = updatedGameConsole.replace(/Monsters in Room: .*/, `Monsters in Room: ${newMonstersInRoomString}`);
              updatedGameConsole = updatedGameConsole.replace(/Monsters Equipped Properties: .*/, `Monsters Equipped Properties: ${newMonstersEquippedPropertiesString}`);
              updatedGameConsole = updatedGameConsole.replace(/Monsters State: .*/, `Monsters State: ${newMonstersState}`);
              updatedGameConsole = updatedGameConsole.replace(/Next Artifact: .*/, `Next Artifact: ${nextArtifact}`);
              updatedGameConsole = updatedGameConsole.replace(/Next Boss: .*/, `Next Boss: ${nextBoss}`);
              updatedGameConsole = updatedGameConsole.replace(/Next Boss Room: .*/, `Next Boss Room: ${nextBossRoom}`);
              updatedGameConsole = updatedGameConsole.replace(/Boss Room Coordinates: .*/, `Boss Room Coordinates: ${bossCoordinates}`);
              updatedGameConsole = updatedGameConsole.replace(/Current Quest: .*/, `Current Quest: ${currentQuest}`);
              updatedGameConsole = updatedGameConsole.replace(/Adjacent Rooms: .*/, `Adjacent Rooms: ${adjacentRooms}`);
              updatedGameConsole = updatedGameConsole.replace(/Puzzle in Room: .*/, `Puzzle in Room: ${puzzleInRoom}`);
              updatedGameConsole = updatedGameConsole.replace(/Puzzle Solution: .*/, `Puzzle Solution: ${puzzleSolution}`);
                    // Construct updated data object
            const updatedData = {
                roomName: newRoomName,
                roomDescription: newRoomHistory,
                coordinates: formattedCoordinates,
                objects: newObjectsInRoomString || "None",
                objectsInRoomProperties: newObjectsInRoomPropertiesString || "None",
                exits: newExitsString || "None",
                pc: charactersString || "No PC data",
                npcs: npcsString || "None",
                inventory: inventoryString || "None",
                inventoryProperties: inventoryPropertiesString || "None",
                monsters: newMonstersInRoomString || "None",
                monstersState: newMonstersState || "None",
                puzzle: {
                    inRoom: puzzleInRoom || "No puzzle",
                    solution: puzzleSolution || "No solution"
                },
                currentQuest: currentQuest || "None",
                nextArtifact: nextArtifact || "None",
                nextBoss: nextBoss || "None",
                nextBossRoom: nextBossRoom || "None",
                bossCoordinates: bossCoordinates || "None",
                adjacentRooms: adjacentRooms || "None"
            };
            
            // Ensure this runs inside chatbotprocessinput, right after you build `updatedData`
            window.latestUpdatedData = updatedData;
            
            if (typeof updatedData.inventory === "string" && updatedData.inventory.toLowerCase() !== "none") {
              window.inventory = updatedData.inventory.split(", ").map(s => s.trim()).filter(Boolean);
            }
    
            console.log("Updated data for Phaser scene:", updatedData);
    
            // Restart the Phaser scene with updated data
            const activeScene = window.game.scene.getScene('MainScene');
            if (activeScene) {
                console.log("Restarting MainScene with updated data");
                activeScene.scene.restart(updatedData);
            } else {
                console.error("MainScene not found!");
            }
    
            // Update CombatScene with new combatCharactersString
            if (newCombatCharactersString) {
                const newCombatCharacters = JSON.parse(newCombatCharactersString);
                window.combatCharacters = newCombatCharacters;
                const combatScene = window.combatGame.scene.getScene('CombatScene');
                if (combatScene) {
                    if (!combatScene.initialized) {
                        console.log("Initializing CombatScene for the first time with:", newCombatCharacters);
                        window.updateCombatScene(newCombatCharacters);
                        combatScene.initialized = true;
                    } else if (window.currentCoordinates && window.currentCoordinates !== formattedCoordinates) {
                        console.log("Room coordinates changed, resetting CombatScene with:", newCombatCharacters);
                        window.updateCombatScene(newCombatCharacters);
                        window.currentCoordinates = formattedCoordinates;
                    } else {
                        console.log("Updating CombatScene positions only with:", newCombatCharacters);
                        combatScene.updatePositions(newCombatCharacters);
                    }
                } else {
                    console.warn("CombatScene not found, initializing skipped.");
                }
            }
    
            console.log("Server response content:", content);
            console.log("Formatted content:", formattedContent);
    
            addPromptAndResponse(userInput, messages[0].content, messages[1].content, content, personalNarrative, conversationId, updatedGameConsole);
    
            updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString, serverGameConsole);
            console.log(updatedGameConsole);
            conversationHistory = conversationHistory + "\n" + updatedGameConsole;
            turns++;
    
            const formattedUpdatedGameConsole = includeOnlySpecifiedLines(updatedGameConsole);
            console.log('formattedUpdatedGameConsole:', formattedUpdatedGameConsole);
    
            const formattedConsoleWithLineBreaks = formattedUpdatedGameConsole.replace(/\n/g, "<br>");
    
            var formattedContent = content.replace(/\n/g, '<br>');
    
            if (imageUrl) {
                // In the poll success callback, after parsing formattedCoordinates
                window.roomImages[formattedCoordinates] = result.imageUrl;
                updateChatLog("<br><br><b> > </b>" + userInput + "<br><br><img src='" + imageUrl + "' alt='Generated Image' style='max-width:100%; margin-bottom: 10px;'><br><br>" + formattedContent + "<br><br>" + formattedConsoleWithLineBreaks);
            } else { 
                updateChatLog("<br><br><b> > </b>" + userInput + "<br><br>" + formattedContent + "<br><br>" + formattedConsoleWithLineBreaks);
            }
    
            document.getElementById("chatuserinput").value = "";
            } catch (error) {
              console.error('Error processing poll response:', error);
              updateChatLog("<br><b>Error:</b> Failed to process server response. Check console for details.<br>");
            }
          }
        },
        error: function(error) {
          clearInterval(pollInterval);
          console.log('Polling error:', error);
          updateChatLog("<br><b>Error:</b> Unable to get a response from the server.<br>");
        }
      });
    }, 10000); // Reduced to 2 seconds for faster detection
  },
  error: function(error) {
    clearInterval(window.keepAliveInterval);
    console.log('Initial request error:', error);
    updateChatLog("<br><b>Error:</b> Unable to start the task.<br>");
  }
});
  } 

  $(document).ready(function() {
    // Attach the chatbotprocessinput function to the input field's enter key event
    $('#chatuserinput').keydown(function(event) {
      if (event.keyCode == 13) { // Enter key
        event.preventDefault(); // Prevent default action (new line)
        chatbotprocessinput(); // Call the processing function
      }
    });
  });
  
  
//const sharedState = require('./sharedState');

// Your game logic that updates personalNarrative and updatedGameConsole
// Example:
/*function updateGame(personalNarrative, updatedGameConsole) {
    // When you need to update the narrative or console data:
    sharedState.setPersonalNarrative("Updated personal narrative here");
    sharedState.setUpdatedGameConsole("Updated game console data here");

    // The rest of your game logic
}*/

attachMusicSSE();

module.exports = { chatbotprocessinput };
// Export any other functions or variables as needed

// Helper: Resolve custom tile URL from tile spec (geoKey from dungeon/currentCoords)
function resolveCustomTileURL(tile, index = 0) {
  if (!tile || !tile.type) return null;

  // Get geoKey from currentDungeon or fallback (e.g., from window.currentCoordinates or shared)
  let geoKey = '';
  if (currentDungeon && currentDungeon.geoKey) {
    geoKey = currentDungeon.geoKey; // Assume set in SSE data
    } else if (window.currentCoordinates && typeof window.currentCoordinates === 'string') {
      const m = window.currentCoordinates.match(/X:\s*(-?\d+), Y:\s*(-?\d+), Z:\s*(-?\d+)/);
      if (m) {
        geoKey = `${m[1]},${m[2]},${m[3]}`;
      } else {
        console.warn('[Raycast] Could not parse currentCoordinates:', window.currentCoordinates);
      }
    } else {
    console.warn('[Raycast] No geoKey for custom tile URL');
    geoKey = 'default'; // Fallback
  }

  const tileName = `custom_${tile.type}_${index}`;
  const filename = `${geoKey}_${tileName}.png`;
  const url = `/sid/sprites/${filename}?cb=${Date.now()}`; // Cache-bust

  console.log('[Raycast] Resolved custom URL:', url, 'for tile', tileName); // DEBUG
  return url;
}

// FIXED: Updated preload to use the helper (keeps original structure)
function preloadDungeonTextures() {
  dungeonTextures = {};
  if (!currentDungeon) return;
  // 1. Load regular dungeon tiles (legacy system)
  if (currentDungeon.tiles) {
    for (const [name, cfg] of Object.entries(currentDungeon.tiles)) {
      if (!cfg || !cfg.url) {
        console.warn('No URL for dungeon tile', name, cfg);
        continue;
      }
      const img = new Image();
      img.onload = () => console.log('Loaded dungeon texture:', name, cfg.url);
      img.onerror = () => console.warn('Failed to load dungeon texture:', name, cfg.url);
      img.src = cfg.url;
      dungeonTextures[name] = img;
    }
  }
  // 2. Load custom biome obstacle tiles
  // Format: [{type:"boulder", style:{shape:"jagged", branches:2}}, ...]
  if (Array.isArray(currentDungeon.customTiles)) {
    for (let i = 0; i < currentDungeon.customTiles.length; i++) {
      const tile = currentDungeon.customTiles[i];
      if (!tile || !tile.type) continue;
      const key = `custom_${tile.type}_${i}`; // FIXED: Use full key like server (not 'ob_')
      const url = resolveCustomTileURL(tile, i);
      if (!url) {
        console.warn('No resolved URL for custom tile', tile);
        continue;
      }
      const img = new Image();
      img.onload = () => console.log('Loaded custom tile:', key, url);
      img.onerror = () => console.warn('Failed custom tile load:', key, url);
      img.src = url;
      dungeonTextures[key] = img; // FIXED: Key matches cell.tile = key
    }
  }
}

function updatePlayerHeightFromCell() {
  if (!currentDungeon || !currentDungeon.cells) return;
  const key  = `${playerDungeonX},${playerDungeonY}`;
  const cell = currentDungeon.cells[key];
  const floorHeight =
    cell && typeof cell.floorHeight === 'number' ? cell.floorHeight : 0;
  playerZTarget = floorHeight + PLAYER_EYE_HEIGHT;
  if (!playerZInitialized || !Number.isFinite(playerZ)) {
    playerZ = playerZTarget;
    playerZInitialized = true;
  }
}

function isTextureReady(img) {
  return !!(
    img &&
    img.complete &&
    img.naturalWidth > 0 &&
    img.naturalHeight > 0
  );
}

// Ensure the player spawns on a walkable tile (not in a solid wall)
// by scanning outward from the server-provided start.
function findNearestWalkableStart(dungeon, start, maxRadius = 25) {
  if (!dungeon || !dungeon.cells) return start || { x: 0, y: 0 };

  const sx = (start && typeof start.x === 'number') ? start.x : 0;
  const sy = (start && typeof start.y === 'number') ? start.y : 0;

  const cells = dungeon.cells;
  const key = (x, y) => `${x},${y}`;
  const isWalkable = (cell) => cell && cell.tile && cell.tile !== 'wall';

  const indoorRooms = Array.isArray(dungeon.indoorRooms) ? dungeon.indoorRooms : null;
  const isIndoor = dungeon.classification && dungeon.classification.indoor !== false;

  const isInRoom = (x, y) => {
    if (!isIndoor || !indoorRooms) return false;
    for (const room of indoorRooms) {
      if (
        x >= room.x &&
        x < room.x + room.w &&
        y >= room.y &&
        y < room.y + room.h
      ) {
        return true;
      }
    }
    return false;
  };

  const floorNeighborCount = (x, y) => {
    const neighbors = [
      cells[`${x + 1},${y}`],
      cells[`${x - 1},${y}`],
      cells[`${x},${y + 1}`],
      cells[`${x},${y - 1}`]
    ];
    return neighbors.filter(n => n && n.tile === 'floor').length;
  };

  const floorDensity3x3 = (x, y) => {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = cells[`${x + dx},${y + dy}`];
        if (c && c.tile === 'floor') count++;
      }
    }
    return count;
  };

  const isCorridor = (x, y, cell) => {
    if (!isIndoor) return false;
    if (!cell || cell.tile !== 'floor') return false;
    if (indoorRooms) return !isInRoom(x, y);
    const neighbors = floorNeighborCount(x, y);
    if (neighbors < 2) return false;
    const density = floorDensity3x3(x, y);
    return density <= 5;
  };

  // Build the largest walkable connected component for traversal safety.
  const visitedAll = new Set();
  let largestComponent = null;
  let largestSize = 0;

  for (const cellKey of Object.keys(cells)) {
    if (visitedAll.has(cellKey)) continue;
    const cell = cells[cellKey];
    if (!isWalkable(cell)) {
      visitedAll.add(cellKey);
      continue;
    }

    const queue = [cellKey];
    const comp = [];
    visitedAll.add(cellKey);

    while (queue.length) {
      const k = queue.shift();
      comp.push(k);
      const [xStr, yStr] = k.split(',');
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      const neighborKeys = [
        key(x + 1, y),
        key(x - 1, y),
        key(x, y + 1),
        key(x, y - 1)
      ];
      for (const nk of neighborKeys) {
        if (visitedAll.has(nk)) continue;
        const nCell = cells[nk];
        if (!isWalkable(nCell)) {
          visitedAll.add(nk);
          continue;
        }
        visitedAll.add(nk);
        queue.push(nk);
      }
    }

    if (comp.length > largestSize) {
      largestSize = comp.length;
      largestComponent = new Set(comp);
    }
  }

  const inLargest = (x, y) => !largestComponent || largestComponent.has(key(x, y));
  const pickFirstFromLargest = () => {
    if (!largestComponent) return null;
    for (const k of largestComponent) {
      const [xStr, yStr] = k.split(',');
      return { x: parseInt(xStr, 10), y: parseInt(yStr, 10) };
    }
    return null;
  };

  const visited = new Set([key(sx, sy)]);
  const queue = [{ x: sx, y: sy, dist: 0 }];
  let nearestWalkable = null;

  while (queue.length) {
    const { x, y, dist } = queue.shift();
    const cell = cells[key(x, y)];

    if (isWalkable(cell) && inLargest(x, y)) {
      if (!nearestWalkable) {
        nearestWalkable = { x, y };
      }
      if (!isIndoor || isCorridor(x, y, cell)) {
        return { x, y };
      }
    }

    if (dist >= maxRadius) continue;

    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    ];

    for (const n of neighbors) {
      const k = key(n.x, n.y);
      if (!visited.has(k)) {
        visited.add(k);
        queue.push({ x: n.x, y: n.y, dist: dist + 1 });
      }
    }
  }

  if (largestComponent && isIndoor) {
    for (const k of largestComponent) {
      const [xStr, yStr] = k.split(',');
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      const cell = cells[k];
      if (isCorridor(x, y, cell)) {
        return { x, y };
      }
    }
  }

  return nearestWalkable || pickFirstFromLargest() || { x: sx, y: sy };
}

// Add this helper function if not already present
function shadeColor(colorStr, factor) {
  const match = colorStr.match(/rgb\((\d+), ?(\d+), ?(\d+)\)/);
  if (!match) return colorStr;
  let r = Math.floor(parseInt(match[1]) * factor);
  let g = Math.floor(parseInt(match[2]) * factor);
  let b = Math.floor(parseInt(match[3]) * factor);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}

// Updated bilinear wrapping sample function
function sampleFloorTexture(imageData, texW, texH, fracX, fracY) {
  if (!imageData || texW <= 1 || texH <= 1) {
    return 'rgb(0,0,0)';
  }

  // fracX / fracY should be [0,1); clamp to avoid tiny overshoot
  const u = Math.min(Math.max(fracX, 0), 0.999999);
  const v = Math.min(Math.max(fracY, 0), 0.999999);

  // Map into texel space
  const tx = u * (texW - 1);
  const ty = v * (texH - 1);

  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const x1 = Math.min(x0 + 1, texW - 1);
  const y1 = Math.min(y0 + 1, texH - 1);

  const fx = tx - x0;
  const fy = ty - y0;

  function getPixel(x, y) {
    const idx = (y * texW + x) * 4;
    return {
      r: imageData.data[idx],
      g: imageData.data[idx + 1],
      b: imageData.data[idx + 2]
    };
  }

  const p00 = getPixel(x0, y0);
  const p10 = getPixel(x1, y0);
  const p01 = getPixel(x0, y1);
  const p11 = getPixel(x1, y1);

  const rx0 = p00.r * (1 - fx) + p10.r * fx;
  const gx0 = p00.g * (1 - fx) + p10.g * fx;
  const bx0 = p00.b * (1 - fx) + p10.b * fx;

  const rx1 = p01.r * (1 - fx) + p11.r * fx;
  const gx1 = p01.g * (1 - fx) + p11.g * fx;
  const bx1 = p01.b * (1 - fx) + p11.b * fx;

  const r = rx0 * (1 - fy) + rx1 * fy;
  const g = gx0 * (1 - fy) + gx1 * fy;
  const b = bx0 * (1 - fy) + bx1 * fy;

  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// RGBA sampler for wall / sprite textures (keeps alpha)
function sampleTextureRGBA(imageData, texW, texH, fracX, fracY) {
  if (!imageData || texW <= 1 || texH <= 1) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const u = Math.min(Math.max(fracX, 0), 0.999999);
  const v = Math.min(Math.max(fracY, 0), 0.999999);

  const tx = u * (texW - 1);
  const ty = v * (texH - 1);

  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const x1 = Math.min(x0 + 1, texW - 1);
  const y1 = Math.min(y0 + 1, texH - 1);

  const fx = tx - x0;
  const fy = ty - y0;

  function getPixel(x, y) {
    const idx = (y * texW + x) * 4;
    return {
      r: imageData.data[idx],
      g: imageData.data[idx + 1],
      b: imageData.data[idx + 2],
      a: imageData.data[idx + 3]
    };
  }

  const p00 = getPixel(x0, y0);
  const p10 = getPixel(x1, y0);
  const p01 = getPixel(x0, y1);
  const p11 = getPixel(x1, y1);

  const rx0 = p00.r * (1 - fx) + p10.r * fx;
  const gx0 = p00.g * (1 - fx) + p10.g * fx;
  const bx0 = p00.b * (1 - fx) + p10.b * fx;
  const ax0 = p00.a * (1 - fx) + p10.a * fx;

  const rx1 = p01.r * (1 - fx) + p11.r * fx;
  const gx1 = p01.g * (1 - fx) + p11.g * fx;
  const bx1 = p01.b * (1 - fx) + p11.b * fx;
  const ax1 = p01.a * (1 - fx) + p11.a * fx;

  const r = rx0 * (1 - fy) + rx1 * fy;
  const g = gx0 * (1 - fy) + gx1 * fy;
  const b = bx0 * (1 - fy) + bx1 * fy;
  const a = ax0 * (1 - fy) + ax1 * fy;

  return {
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b),
    a: Math.round(a)
  };
}

function sampleTextureMask(maskData, texW, texH, fracX, fracY) {
  if (!maskData || texW <= 1 || texH <= 1) {
    return 0;
  }

  const u = Math.min(Math.max(fracX, 0), 0.999999);
  const v = Math.min(Math.max(fracY, 0), 0.999999);

  const tx = u * (texW - 1);
  const ty = v * (texH - 1);

  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const x1 = Math.min(x0 + 1, texW - 1);
  const y1 = Math.min(y0 + 1, texH - 1);

  const fx = tx - x0;
  const fy = ty - y0;

  const idx00 = y0 * texW + x0;
  const idx10 = y0 * texW + x1;
  const idx01 = y1 * texW + x0;
  const idx11 = y1 * texW + x1;

  const v00 = maskData[idx00];
  const v10 = maskData[idx10];
  const v01 = maskData[idx01];
  const v11 = maskData[idx11];

  const vx0 = v00 * (1 - fx) + v10 * fx;
  const vx1 = v01 * (1 - fx) + v11 * fx;
  const vxy = vx0 * (1 - fy) + vx1 * fy;

  return vxy;
}

function sampleTextureNormal(normalData, texW, texH, fracX, fracY) {
  if (!normalData || texW <= 1 || texH <= 1) {
    return { x: 0, y: 0, z: 1 };
  }

  const u = Math.min(Math.max(fracX, 0), 0.999999);
  const v = Math.min(Math.max(fracY, 0), 0.999999);

  const tx = u * (texW - 1);
  const ty = v * (texH - 1);

  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const x1 = Math.min(x0 + 1, texW - 1);
  const y1 = Math.min(y0 + 1, texH - 1);

  const fx = tx - x0;
  const fy = ty - y0;

  function getNormal(x, y) {
    const idx = (y * texW + x) * 3;
    return {
      x: normalData[idx],
      y: normalData[idx + 1],
      z: normalData[idx + 2]
    };
  }

  const n00 = getNormal(x0, y0);
  const n10 = getNormal(x1, y0);
  const n01 = getNormal(x0, y1);
  const n11 = getNormal(x1, y1);

  const nx0 = n00.x * (1 - fx) + n10.x * fx;
  const ny0 = n00.y * (1 - fx) + n10.y * fx;
  const nz0 = n00.z * (1 - fx) + n10.z * fx;

  const nx1 = n01.x * (1 - fx) + n11.x * fx;
  const ny1 = n01.y * (1 - fx) + n11.y * fx;
  const nz1 = n01.z * (1 - fx) + n11.z * fx;

  const nx = nx0 * (1 - fy) + nx1 * fy;
  const ny = ny0 * (1 - fy) + ny1 * fy;
  const nz = nz0 * (1 - fy) + nz1 * fy;

  return { x: nx, y: ny, z: nz };
}


  // --- Scale2x-style upscaler: doubles resolution without blur ---
  function scale2x(srcCtx, w, h) {
    const srcImage = srcCtx.getImageData(0, 0, w, h);
    const src = srcImage.data;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = w * 2;
    outCanvas.height = h * 2;
    const outCtx = outCanvas.getContext('2d');
    const outImage = outCtx.createImageData(w * 2, h * 2);
    const dst = outImage.data;

    const outW = w * 2;

    function idx(x, y) {
      // clamp edges
      if (x < 0) x = 0;
      if (x >= w) x = w - 1;
      if (y < 0) y = 0;
      if (y >= h) y = h - 1;
      return (y * w + x) * 4;
    }

    function same(i1, i2) {
      return (
        src[i1]     === src[i2] &&
        src[i1 + 1] === src[i2 + 1] &&
        src[i1 + 2] === src[i2 + 2] &&
        src[i1 + 3] === src[i2 + 3]
      );
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const iB = idx(x, y);       // center
        const iA = idx(x, y - 1);   // up
        const iD = idx(x - 1, y);   // left
        const iC = idx(x + 1, y);   // right
        const iE = idx(x, y + 1);   // down

        // default all four subpixels to B
        let e0 = iB, e1 = iB, e2 = iB, e3 = iB;

        // Scale2x rule: if opposite neighbors differ and left/right differ,
        // we can infer diagonal smoothing
        if (!same(iA, iE) && !same(iD, iC)) {
          if (same(iD, iA)) e0 = iD; // top-left
          if (same(iA, iC)) e1 = iC; // top-right
          if (same(iD, iE)) e2 = iD; // bottom-left
          if (same(iE, iC)) e3 = iC; // bottom-right
        }

        const ox = x * 2;
        const oy = y * 2;

        // helper to write a pixel
        function write(dstIndex, srcIndex) {
          dst[dstIndex]     = src[srcIndex];
          dst[dstIndex + 1] = src[srcIndex + 1];
          dst[dstIndex + 2] = src[srcIndex + 2];
          dst[dstIndex + 3] = src[srcIndex + 3];
        }

        // top-left
        let di = (oy * outW + ox) * 4;
        write(di, e0);

        // top-right
        di = (oy * outW + (ox + 1)) * 4;
        write(di, e1);

        // bottom-left
        di = ((oy + 1) * outW + ox) * 4;
        write(di, e2);

        // bottom-right
        di = ((oy + 1) * outW + (ox + 1)) * 4;
        write(di, e3);
      }
    }

    outCtx.putImageData(outImage, 0, 0);
    return outCanvas;
  }

var renderPerfStats = {
  lastLog: 0,
  frames: 0,
  totalMs: 0,
  floorMs: 0,
  wallMs: 0,
  spriteMs: 0,
  postMs: 0,
  floorRows: 0,
  floorPixels: 0,
  wallCols: 0,
  wallPixels: 0,
  spriteCount: 0,
  spritePixels: 0
};

// Replace the entire renderDungeonView function with this final fixed version
function renderDungeonViewCanvas(renderToOffscreen = false) {
  if (!currentDungeon) {
    console.warn('renderDungeonView called with no currentDungeon');
    return;
  }
  const popup = document.getElementById('dungeon-popup');
  const container = document.getElementById('dungeon-container');
  if (!popup || !container) {
    console.warn('Dungeon popup/container not found');
    return;
  }
  if (popup.style.display !== 'block') {
    popup.style.display = 'block';
  }

  let displayCanvas = null;
  let displayCtx = null;
  if (renderToOffscreen) {
    if (!window._dungeonOffscreenCanvas) {
      window._dungeonOffscreenCanvas = document.createElement('canvas');
      window._dungeonOffscreenCanvas.width = 640;
      window._dungeonOffscreenCanvas.height = 480;
    }
    displayCanvas = window._dungeonOffscreenCanvas;
    displayCtx = displayCanvas.getContext('2d');
  } else {
    displayCanvas = container.querySelector('canvas');
    if (!displayCanvas) {
      displayCanvas = document.createElement('canvas');
      displayCanvas.width = 640;
      displayCanvas.height = 480;
      container.innerHTML = '';
      container.appendChild(displayCanvas);
    }
    displayCtx = displayCanvas.getContext('2d');
  }

  const PIXEL_SCALE = 4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(displayCanvas.width / PIXEL_SCALE);
  canvas.height = Math.floor(displayCanvas.height / PIXEL_SCALE);

  const ctx = canvas.getContext('2d');
  const webglCanvas = window.webglDungeonRenderer && window.webglDungeonRenderer.canvas;
  if (window.DEBUG_DUNGEON_CANVAS || !ctx || !displayCtx) {
    console.log('[Raycast] canvas debug', {
      renderToOffscreen,
      displayCanvasTag: displayCanvas ? displayCanvas.tagName : null,
      displayCtx: !!displayCtx,
      ctx: !!ctx,
      canvasIsWebGL: displayCanvas === webglCanvas,
      webglCanvas: !!webglCanvas,
      webglContext: !!(window.webglDungeonRenderer && window.webglDungeonRenderer.gl)
    });
  }
  ctx.imageSmoothingEnabled = false;
  displayCtx.imageSmoothingEnabled = false;

  const W = canvas.width;
  const H = canvas.height;

  if (!renderPerfStats) {
    renderPerfStats = {
      lastLog: 0,
      frames: 0,
      totalMs: 0,
      floorMs: 0,
      wallMs: 0,
      spriteMs: 0,
      postMs: 0,
      floorRows: 0,
      floorPixels: 0,
      wallCols: 0,
      wallPixels: 0,
      spriteCount: 0,
      spritePixels: 0
    };
  }

  const frameStart = performance.now();

  const FOV = Math.PI / 3;
  const WALL_U_SCALE = 0.25;

  const dirX = Math.cos(playerAngle);
  const dirY = Math.sin(playerAngle);

  // True player world position (tile center) – used for sprite relative positions (fixed world coords)
  const playerWorldX = Number.isFinite(playerPosX) ? playerPosX : playerDungeonX + 0.5;
  const playerWorldY = Number.isFinite(playerPosY) ? playerPosY : playerDungeonY + 0.5;

  // Offset eye position – used ONLY for wall/floor raycasting (to see more floor)
  const EYE_BACK_OFFSET = Number.isFinite(window.WEBGL_EYE_BACK) ? window.WEBGL_EYE_BACK : 0.0;
  let posX = playerWorldX - dirX * EYE_BACK_OFFSET;
  let posY = playerWorldY - dirY * EYE_BACK_OFFSET;

  const playerKey = `${playerDungeonX},${playerDungeonY}`;
  const playerCell = currentDungeon.cells[playerKey] || {};
  const playerFloor = (typeof playerCell.floorHeight === 'number') ? playerCell.floorHeight : 0;
  const eyeZ = Number.isFinite(playerZ) ? playerZ : playerFloor + PLAYER_EYE_HEIGHT;

  const planeScale = Math.tan(FOV / 2);
  const planeX = -dirY * planeScale;
  const planeY = dirX * planeScale;

  const focalLength = H / (2 * Math.tan(FOV / 2));

  const lighting = normalizeLight(currentDungeon && (currentDungeon.lighting || currentDungeon.classification?.lighting));
  const TORCH_MOUNT_HEIGHT = 1.1;
  const TORCH_WALL_OFFSET = 0.49;
  const TORCH_MOUNT_RATIO = 0.55;
  const lightDirX = lighting.dirX;
  const lightDirY = lighting.dirY;
  const lightElev = lighting.elevation;
  const lightIntensity = lighting.intensity;

  const TORCH_LIGHT_RADIUS = 6.0;
  const TORCH_LIGHT_FALLOFF = 0.6;
  const TORCH_LIGHT_COLOR = { r: 255, g: 190, b: 130 };
  // Per-surface torch tuning knobs (1.0 = default).
  const TORCH_WALL_BOOST = 1.3;
  const TORCH_SIDE_BOOST = 1.1;
  const TORCH_FLOOR_BOOST = 1.4;
  const torchLights = [];
  const now = performance.now();
  let needsAnimation = false;

  const depthBuffer = new Float32Array(W * H);
  depthBuffer.fill(Infinity);

  // Floor texture setup (unchanged)
  const floorTex = dungeonTextures && dungeonTextures.floor;
  const hasFloorTexture = isTextureReady(floorTex);
  let floorImageData = null;
  let floorTexW = 0;
  let floorTexH = 0;
  if (hasFloorTexture) {
    const tempCanvas = document.createElement('canvas');
    floorTexW = floorTex.naturalWidth;
    floorTexH = floorTex.naturalHeight;
    tempCanvas.width = floorTexW;
    tempCanvas.height = floorTexH;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(floorTex, 0, 0);
    floorImageData = tempCtx.getImageData(0, 0, floorTexW, floorTexH);
  }

  const wallTexCache = {};
  const RENDER_CUSTOM_AS_WALLS = false;
  function getWallTextureData(texName, texImg) {
    if (!isTextureReady(texImg)) return null;
    let cached = wallTexCache[texName];
    if (!cached) {
      const w = texImg.naturalWidth;
      const h = texImg.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const tctx = c.getContext('2d');
      tctx.drawImage(texImg, 0, 0);
      const data = tctx.getImageData(0, 0, w, h);
      let lastOpaqueY = -1;
      for (let y = h - 1; y >= 0; y--) {
        const row = y * w * 4;
        let found = false;
        for (let x = 0; x < w; x++) {
          if (data.data[row + x * 4 + 3] > 10) {
            lastOpaqueY = y;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      let minL = 255;
      let maxL = 0;
      const len = w * h;
      for (let i = 0; i < len; i++) {
        const a = data.data[i * 4 + 3];
        if (a <= 10) continue;
        const r = data.data[i * 4];
        const g = data.data[i * 4 + 1];
        const b = data.data[i * 4 + 2];
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (l < minL) minL = l;
        if (l > maxL) maxL = l;
      }
      let mortarMask = null;
      let normalMap = null;
      if (maxL - minL > 6) {
        const threshold = minL + (maxL - minL) * 0.35;
        mortarMask = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          const a = data.data[i * 4 + 3];
          if (a <= 10) {
            mortarMask[i] = 0;
            continue;
          }
          const r = data.data[i * 4];
          const g = data.data[i * 4 + 1];
          const b = data.data[i * 4 + 2];
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          mortarMask[i] = l <= threshold ? 255 : 0;
        }
        normalMap = new Float32Array(len * 3);
        const heightScale = 0.6;
        const idx = (x, y) => ((y * w + x) | 0);
        const heightAt = (x, y) => {
          const mx = Math.max(0, Math.min(w - 1, x));
          const my = Math.max(0, Math.min(h - 1, y));
          const v = mortarMask[idx(mx, my)] / 255;
          return 1 - v;
        };
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const hL = heightAt(x - 1, y);
            const hR = heightAt(x + 1, y);
            const hU = heightAt(x, y - 1);
            const hD = heightAt(x, y + 1);
            const dx = (hR - hL) * 0.5;
            const dy = (hD - hU) * 0.5;
            let nx = -dx * heightScale;
            let ny = -dy * heightScale;
            let nz = 1;
            const nLen = Math.hypot(nx, ny, nz) || 1;
            nx /= nLen;
            ny /= nLen;
            nz /= nLen;
            const o = (y * w + x) * 3;
            normalMap[o] = nx;
            normalMap[o + 1] = ny;
            normalMap[o + 2] = nz;
          }
        }
      }
      cached = wallTexCache[texName] = {
        data,
        w,
        h,
        lastOpaqueY,
        mortarMask,
        normalMap
      };
    }
    return cached;
  }

  function normalizeLight(light) {
    const fallback = {
      dirX: -0.7,
      dirY: -0.7,
      elevation: 0.6,
      intensity: 0.6,
      color: '#FFFFFF'
    };
    if (!light) return fallback;
    let dirX = null;
    let dirY = null;
    if (typeof light.dir === 'string') {
      const d = light.dir.trim().toUpperCase();
      const map = {
        N:  [0, -1],
        NE: [0.7, -0.7],
        E:  [1, 0],
        SE: [0.7, 0.7],
        S:  [0, 1],
        SW: [-0.7, 0.7],
        W:  [-1, 0],
        NW: [-0.7, -0.7]
      };
      if (map[d]) {
        dirX = map[d][0];
        dirY = map[d][1];
      }
    } else if (Number.isFinite(light.dirX) && Number.isFinite(light.dirY)) {
      dirX = light.dirX;
      dirY = light.dirY;
    } else if (Number.isFinite(light.x) && Number.isFinite(light.y)) {
      dirX = light.x;
      dirY = light.y;
    } else if (Number.isFinite(light.angle)) {
      const a = light.angle * (Math.PI / 180);
      dirX = Math.cos(a);
      dirY = Math.sin(a);
    }
    if (!Number.isFinite(dirX) || !Number.isFinite(dirY)) {
      dirX = fallback.dirX;
      dirY = fallback.dirY;
    }
    const len = Math.hypot(dirX, dirY) || 1;
    dirX /= len;
    dirY /= len;
    const elevation = Number.isFinite(light.elevation) ? Math.max(0.05, Math.min(0.95, light.elevation)) : fallback.elevation;
    const intensity = Number.isFinite(light.intensity) ? Math.max(0, Math.min(1, light.intensity)) : fallback.intensity;
    const color = /^#[0-9a-fA-F]{6}$/.test(light.color || '') ? String(light.color).toUpperCase() : fallback.color;
    return { dirX, dirY, elevation, intensity, color };
  }


  // Sky (unchanged)
  let skyTop = '#050012';
  let skyBot = '#050012';
  if (currentDungeon) {
    if (currentDungeon.skyTop) {
      skyTop = currentDungeon.skyTop;
      skyBot = currentDungeon.skyBot || currentDungeon.skyTop;
    } else if (currentDungeon.classification && currentDungeon.classification.skyTop) {
      skyTop = currentDungeon.classification.skyTop;
      skyBot = currentDungeon.classification.skyBot || skyTop;
    }
  }
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
  skyGrad.addColorStop(0, skyTop);
  skyGrad.addColorStop(1, skyBot);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H / 2);

  // Helpers (unchanged)
  function isOccludingWall(x, y) {
    const key = `${x},${y}`;
    const cell = currentDungeon.cells[key];
    if (!cell) return true;
    const t = cell.tile || 'floor';
    return (
      t === 'wall' ||
      t === 'door' ||
      t === 'torch'
    );
  }

  function isWall(x, y) {
    const key = `${x},${y}`;
    const cell = currentDungeon.cells[key];
    if (!cell) return true;
    const t = cell.tile;
    return (
      t === 'wall' ||
      t === 'door' ||
      t === 'torch'
    );
  }

  function getCellHeights(x, y) {
    const key = `${x},${y}`;
    const cell = currentDungeon.cells[key] || {};
    return {
      floorHeight: typeof cell.floorHeight === 'number' ? cell.floorHeight : 0,
      ceilHeight: typeof cell.ceilHeight === 'number' ? cell.ceilHeight : 2,
      tile: cell.tile || 'floor'
    };
  }

  const layoutW = currentDungeon?.layout?.width || 32;
  const layoutH = currentDungeon?.layout?.height || 32;
  const maxDim = Math.max(layoutW, layoutH);
  const isOutdoor = currentDungeon && currentDungeon.classification && currentDungeon.classification.indoor === false;
  const HORIZON = Math.floor(H / 2);
  if (currentDungeon && !Number.isFinite(currentDungeon._minFloor)) {
    let minFloor = Infinity;
    for (const cell of Object.values(currentDungeon.cells || {})) {
      if (cell && typeof cell.floorHeight === 'number' && cell.floorHeight < minFloor) {
        minFloor = cell.floorHeight;
      }
    }
    currentDungeon._minFloor = Number.isFinite(minFloor) ? minFloor : 0;
  }
  const FAR_BAND_HEIGHT = 0;
  const FAR_BAND_DIST = 0;
  const FLOOR_X_STEP = 1;
  const MAX_FLOOR_DIST = isOutdoor
    ? 1000000
    : 18.0;

  const TORCH_FLICKER_SPEED = 0.6;

  function torchFlicker(seed, timeMs) {
    const t = timeMs * 0.001 * TORCH_FLICKER_SPEED;
    const speedMod = 0.65
      + 0.25 * Math.sin(t * (0.35 + seed * 0.12) + seed * 5.1)
      + 0.1 * Math.sin(t * (0.07 + seed * 0.03) + seed * 17.3);
    const tt = t * speedMod;
    const base = 0.72 + 0.08 * Math.sin(tt * (1.1 + seed * 0.4) + seed * 9.7);
    const pulse = Math.pow(Math.max(0, Math.sin(tt * (3.6 + seed * 1.4) + seed * 13.3)), 2) * 0.22;
    const crackle = Math.pow(Math.max(0, Math.sin(tt * (9.5 + seed * 3.1) + seed * 27.1)), 3) * 0.12;
    const jitter = Math.sin(tt * (17.0 + seed * 5.7) + seed * 41.0) * 0.04;
    return base + pulse + crackle + jitter;
  }

  function getTorchFacing(wx, wy, cell) {
    if (cell && cell.torchFacing) return cell.torchFacing;
    const checks = [
      { dir: 'N', x: wx, y: wy - 1 },
      { dir: 'S', x: wx, y: wy + 1 },
      { dir: 'W', x: wx - 1, y: wy },
      { dir: 'E', x: wx + 1, y: wy },
    ];
    for (const c of checks) {
      if (!isWall(c.x, c.y)) return c.dir;
    }
    return null;
  }

  function collectTorchLights() {
    const lights = [];
    const radius = Math.max(10, Math.min(18, Math.floor(maxDim / 10)));
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const wx = playerDungeonX + dx;
        const wy = playerDungeonY + dy;
        const cell = currentDungeon.cells[`${wx},${wy}`];
        if (!cell || cell.tile !== 'torch') continue;
        const seed = ((wx * 928371 + wy * 1237) % 1000) / 1000;
        const flicker = torchFlicker(seed, now);
        const floorH = typeof cell.floorHeight === 'number' ? cell.floorHeight : 0;
        const ceilH = typeof cell.ceilHeight === 'number' ? cell.ceilHeight : floorH + TORCH_MOUNT_HEIGHT;
        const wallH = Math.max(0.5, ceilH - floorH);
        lights.push({
          x: wx + 0.5,
          y: wy + 0.5,
          z: floorH + wallH * TORCH_MOUNT_RATIO,
          intensity: Math.max(0.25, Math.min(1.15, flicker)),
          seed,
          flicker
        });
      }
    }
    return lights;
  }

  function applyTorchLight(sample, shade, wx, wy, wz, normal, boost = 1.0) {
    if (!torchLights.length) {
      return {
        r: Math.round(sample.r * shade),
        g: Math.round(sample.g * shade),
        b: Math.round(sample.b * shade)
      };
    }
    let total = 0;
    for (const t of torchLights) {
      const dx = wx - t.x;
      const dy = wy - t.y;
      const dz = wz - t.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist >= TORCH_LIGHT_RADIUS) continue;
      const falloff = 1 - dist / TORCH_LIGHT_RADIUS;
      total += falloff * falloff * t.intensity * TORCH_LIGHT_FALLOFF;
    }
    if (total <= 0) {
      return {
        r: Math.round(sample.r * shade),
        g: Math.round(sample.g * shade),
        b: Math.round(sample.b * shade)
      };
    }
    const lit = Math.max(0, Math.min(1, total));
    const litScaled = Math.max(0, Math.min(1.5, lit * boost));
    const base = shade + litScaled * 0.5;
    const warmShift = 0.75 + 0.45 * litScaled;
    const r = Math.min(255, sample.r * base + TORCH_LIGHT_COLOR.r * litScaled * 0.35);
    const g = Math.min(255, sample.g * base + TORCH_LIGHT_COLOR.g * litScaled * 0.25 * warmShift);
    const b = Math.min(255, sample.b * base + TORCH_LIGHT_COLOR.b * litScaled * 0.2 * warmShift);
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  }

  torchLights.push(...collectTorchLights());
  // -----------------------------------
  // FLOOR PASS
  // -----------------------------------
  const floorStart = performance.now();
  if (hasFloorTexture && floorImageData) {
    for (let x = 0; x < W; x += FLOOR_X_STEP) {
      const cameraX = 2 * x / W - 1;
      const rayDirX = dirX + planeX * cameraX;
      const rayDirY = dirY + planeY * cameraX;
      if (Math.abs(rayDirX) < 1e-6 && Math.abs(rayDirY) < 1e-6) continue;

      const deltaDistX = Math.abs(1 / rayDirX);
      const deltaDistY = Math.abs(1 / rayDirY);
      let mapX = Math.floor(posX);
      let mapY = Math.floor(posY);
      let sideDistX, sideDistY, stepX, stepY;

      if (rayDirX < 0) {
        stepX    = -1;
        sideDistX = (posX - mapX) * deltaDistX;
      } else {
        stepX    = 1;
        sideDistX = (mapX + 1.0 - posX) * deltaDistX;
      }
      if (rayDirY < 0) {
        stepY    = -1;
        sideDistY = (posY - mapY) * deltaDistY;
      } else {
        stepY    = 1;
        sideDistY = (mapY + 1.0 - posY) * deltaDistY;
      }

      for (let sy = H - 1; sy > HORIZON; ) {
        const relY = sy - HORIZON;
        const tan_v = relY / focalLength;
        if (tan_v <= 0) {
          sy -= 1;
          continue;
        }
        const approxDist = Math.abs((eyeZ - playerFloor) / tan_v) || 0.001;
        const approxPixelSize = Math.abs(focalLength / approxDist);
        const rowStep = isOutdoor ? chooseRowStep(approxPixelSize) : 1;
        const drawStep = Math.min(rowStep, sy - HORIZON);
        renderPerfStats.floorRows += 1;

        // Restart DDA for this row
        let dda_mapX = mapX;
        let dda_mapY = mapY;
        let dda_sideDistX = sideDistX;
        let dda_sideDistY = sideDistY;
        let dda_stepX = stepX;
        let dda_stepY = stepY;
        let dda_deltaDistX = deltaDistX;
        let dda_deltaDistY = deltaDistY;

        let hitDist = Infinity;
        let hitFracX = 0;
        let hitFracY = 0;
        let hitCellX = 0;
        let hitCellY = 0;
        let foundHit = false;
        let surfaceH = 0;
        let currentD = 0.0;
        let loopCount = 0;
        const maxLoops = isOutdoor ? 400 : 64;

        const isBackStart_floor = (mapX !== playerDungeonX || mapY !== playerDungeonY);
        if (isBackStart_floor) {
          const d_exit = Math.min(dda_sideDistX, dda_sideDistY);
          if (dda_sideDistX < dda_sideDistY) {
            dda_sideDistX += dda_deltaDistX;
            dda_mapX += dda_stepX;
          } else {
            dda_sideDistY += dda_deltaDistY;
            dda_mapY += dda_stepY;
          }
          currentD = d_exit;
          loopCount = 1;
          if (isOccludingWall(dda_mapX, dda_mapY)) {
            continue; // blocked
          }
        }

        while (currentD < MAX_FLOOR_DIST && loopCount < maxLoops) {
          loopCount++;
          const d_exit = Math.min(dda_sideDistX, dda_sideDistY);
          const heights = getCellHeights(dda_mapX, dda_mapY);

          if (!isOccludingWall(dda_mapX, dda_mapY)) {
            surfaceH = heights.floorHeight;
            if (surfaceH < eyeZ) {
              const d_plane = (eyeZ - surfaceH) / tan_v;
              if (d_plane >= currentD && d_plane < d_exit) {
                const wx = posX + rayDirX * d_plane;
                const wy = posY + rayDirY * d_plane;
                hitCellX = Math.floor(wx);
                hitCellY = Math.floor(wy);
                if (hitCellX === dda_mapX && hitCellY === dda_mapY) {
                  hitDist = d_plane;
                  hitFracX = ((wx % 1) + 1) % 1;
                  hitFracY = ((wy % 1) + 1) % 1;
                  foundHit = true;
                  break;
                }
              }
            }
          }

          // Check next cell’s surface (floor if open, ceil if solid)
          const nextSide = dda_sideDistX < dda_sideDistY ? 0 : 1;
          let nextMapX = dda_mapX + (nextSide === 0 ? dda_stepX : 0);
          let nextMapY = dda_mapY + (nextSide === 1 ? dda_stepY : 0);
          const nextHeights = getCellHeights(nextMapX, nextMapY);
          const nextIsOpen = !isOccludingWall(nextMapX, nextMapY);
          let nextSurfaceH = nextIsOpen ? nextHeights.floorHeight : nextHeights.ceilHeight;

          if (nextSurfaceH < eyeZ) {
            const d_plane_next = (eyeZ - nextSurfaceH) / tan_v;
            if (d_plane_next >= currentD && d_plane_next < d_exit) {
              const wx = posX + rayDirX * d_plane_next;
              const wy = posY + rayDirY * d_plane_next;
              hitCellX = Math.floor(wx);
              hitCellY = Math.floor(wy);
              if (hitCellX === nextMapX && hitCellY === nextMapY) {
                hitDist = d_plane_next;
                surfaceH = nextSurfaceH;
                hitFracX = ((wx % 1) + 1) % 1;
                hitFracY = ((wy % 1) + 1) % 1;
                foundHit = true;
                break;
              }
            }
          }

          // Advance DDA
          let crossDist;
          if (dda_sideDistX < dda_sideDistY) {
            crossDist = dda_sideDistX;
            dda_sideDistX += dda_deltaDistX;
            dda_mapX += dda_stepX;
          } else {
            crossDist = dda_sideDistY;
            dda_sideDistY += dda_deltaDistY;
            dda_mapY += dda_stepY;
          }
          currentD = crossDist;
          if (isOccludingWall(dda_mapX, dda_mapY)) break;
        }

        if (foundHit && hitDist < Infinity) {
          if (isOutdoor) {
            const cellPixelSize = Math.abs(focalLength / hitDist);
            const lodFactor = chooseLodFactor(cellPixelSize);
            if (lodFactor > 1) {
              const lodSample = getLodSample(currentDungeon, hitCellX, hitCellY, lodFactor);
              if (lodSample) {
                surfaceH = lodSample.floorHeight;
                const fracStep = 1 / lodFactor;
                hitFracX = Math.min(0.999, Math.max(0, Math.floor(hitFracX / fracStep) * fracStep + fracStep * 0.5));
                hitFracY = Math.min(0.999, Math.max(0, Math.floor(hitFracY / fracStep) * fracStep + fracStep * 0.5));
              }
            }
          }

          const horizDist = Math.abs((eyeZ - surfaceH) * focalLength / relY);
          const shade = Math.max(0.2, 1.0 - horizDist / 10.0);
          const color = sampleFloorTexture(
            floorImageData,
            floorTexW,
            floorTexH,
            hitFracX,
            hitFracY
          );
          if (torchLights.length) {
            const m = color.match(/rgb\((\d+), ?(\d+), ?(\d+)\)/);
            const sample = m
              ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }
              : { r: 0, g: 0, b: 0 };
            const floorNormal = { x: 0, y: 0, z: 1 };
            const lit = applyTorchLight(sample, shade, hitCellX + hitFracX, hitCellY + hitFracY, surfaceH, floorNormal, TORCH_FLOOR_BOOST);
            ctx.fillStyle = `rgb(${lit.r},${lit.g},${lit.b})`;
          } else {
            const shaded = shadeColor(color, shade);
            ctx.fillStyle = shaded;
          }

          for (let by = 0; by < drawStep; by++) {
            const sy2 = sy - by;
            for (let ox = 0; ox < FLOOR_X_STEP; ox++) {
              const sx = x + ox;
              if (sx >= W) break;
              const idx = sy2 * W + sx;
              if (hitDist < depthBuffer[idx]) {
                depthBuffer[idx] = hitDist;
                ctx.fillRect(sx, sy2, 1, 1);
                renderPerfStats.floorPixels += 1;
              }
            }
          }
        }
        sy -= rowStep;
      }
    }
  } else {
    // flat color floor fallback
    ctx.fillStyle = '#220000';
    ctx.fillRect(0, HORIZON, W, H - HORIZON);
  }
  const floorEnd = performance.now();

  // -----------------------------------
  // WALL RAYCAST + FLOOR SIDE FACES
  // -----------------------------------
  const wallStart = performance.now();
  for (let x = 0; x < W; x++) {
    renderPerfStats.wallCols += 1;
    const cameraX = 2 * x / W - 1;
    const rayDirX = dirX + planeX * cameraX;
    const rayDirY = dirY + planeY * cameraX;

    let mapX = Math.floor(posX);
    let mapY = Math.floor(posY);
    const invRayDirX = (rayDirX === 0) ? 1e30 : 1 / rayDirX;
    const invRayDirY = (rayDirY === 0) ? 1e30 : 1 / rayDirY;
    const deltaDistX = Math.abs(invRayDirX);
    const deltaDistY = Math.abs(invRayDirY);

    let stepX, stepY;
    let sideDistX, sideDistY;

    if (rayDirX < 0) {
      stepX = -1;
      sideDistX = (posX - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1.0 - posX) * deltaDistX;
    }
    if (rayDirY < 0) {
      stepY = -1;
      sideDistY = (posY - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1.0 - posY) * deltaDistY;
    }

    let hit = false;
    let side = 0;
    let steps = 0;
    const MAX_STEPS = isOutdoor ? 400 : 64;

    const isBackStart_wall = (mapX !== playerDungeonX || mapY !== playerDungeonY);

    while (!hit && steps < MAX_STEPS) {
      const doRenderSide = !(isBackStart_wall && steps === 0);

      if (sideDistX < sideDistY) {
        const nextDist = sideDistX;
        const nextMapX = mapX + stepX;
        const nextMapY = mapY;

        // Floor side face (x-crossing)
        if (doRenderSide) {
          const currHeights = getCellHeights(mapX, mapY);
          const nextHeights = getCellHeights(nextMapX, nextMapY);
          if (!isOccludingWall(mapX, mapY) && !isOccludingWall(nextMapX, nextMapY)) {
            const dh = nextHeights.floorHeight - currHeights.floorHeight;
            if (dh !== 0) {
              const bottomZ = Math.min(currHeights.floorHeight, nextHeights.floorHeight);
              const topZ = Math.max(currHeights.floorHeight, nextHeights.floorHeight);
              const heightDiff = topZ - bottomZ;
              const perpDist = nextDist;
              if (perpDist > 0.001) {
                const crossWY = posY + rayDirY * perpDist;
                const wallXFrac = ((crossWY % 1) + 1) % 1;

                const ceilScreenY_raw = HORIZON - ((topZ - eyeZ) / perpDist) * focalLength;
                const floorScreenY_raw = HORIZON - ((bottomZ - eyeZ) / perpDist) * focalLength;
                const fullHeight = floorScreenY_raw - ceilScreenY_raw;

                if (fullHeight > 0) {
                  let drawStart = Math.max(0, Math.floor(ceilScreenY_raw));
                  let drawEnd = Math.min(H, Math.floor(floorScreenY_raw) + 1);
                  if (drawStart < drawEnd) {
                    const shade = Math.max(0.2, 1.0 - perpDist / 10);
                    const fracU = wallXFrac;

                    for (let sy = drawStart; sy < drawEnd; sy++) {
                      const idx = sy * W + x;
                      if (perpDist >= depthBuffer[idx]) continue;
                      depthBuffer[idx] = perpDist;

                      const v_frac = (sy - ceilScreenY_raw) / fullHeight;
                      const world_v = v_frac * heightDiff;
                      const fracV = ((bottomZ + world_v) % 1 + 1) % 1;

                      let color;
                      if (hasFloorTexture && floorImageData) {
                        color = sampleFloorTexture(
                          floorImageData,
                          floorTexW,
                          floorTexH,
                          fracU,
                          fracV
                        );
                      } else {
                        color = 'rgb(34,0,0)';
                      }
                      const shaded = shadeColor(color, shade);
                      ctx.fillStyle = shaded;
                      ctx.fillRect(x, sy, 1, 1);
                    }
                  }
                }
              }
            }
          }
        }

        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        const nextDist = sideDistY;
        const nextMapX = mapX;
        const nextMapY = mapY + stepY;

        // Floor side face (y-crossing)
        if (doRenderSide) {
          const currHeights = getCellHeights(mapX, mapY);
          const nextHeights = getCellHeights(nextMapX, nextMapY);
          if (!isOccludingWall(mapX, mapY) && !isOccludingWall(nextMapX, nextMapY)) {
            const dh = nextHeights.floorHeight - currHeights.floorHeight;
            if (dh !== 0) {
              const bottomZ = Math.min(currHeights.floorHeight, nextHeights.floorHeight);
              const topZ = Math.max(currHeights.floorHeight, nextHeights.floorHeight);
              const heightDiff = topZ - bottomZ;
              const perpDist = nextDist;
              if (perpDist > 0.001) {
                const crossWX = posX + rayDirX * perpDist;
                const wallXFrac = ((crossWX % 1) + 1) % 1;

                const ceilScreenY_raw = HORIZON - ((topZ - eyeZ) / perpDist) * focalLength;
                const floorScreenY_raw = HORIZON - ((bottomZ - eyeZ) / perpDist) * focalLength;
                const fullHeight = floorScreenY_raw - ceilScreenY_raw;

                if (fullHeight > 0) {
                  let drawStart = Math.max(0, Math.floor(ceilScreenY_raw));
                  let drawEnd = Math.min(H, Math.floor(floorScreenY_raw) + 1);
                  if (drawStart < drawEnd) {
                    const shade = Math.max(0.2, 1.0 - perpDist / 10);
                    const fracU = wallXFrac;

                    for (let sy = drawStart; sy < drawEnd; sy++) {
                      const idx = sy * W + x;
                      if (perpDist >= depthBuffer[idx]) continue;
                      depthBuffer[idx] = perpDist;

                      const v_frac = (sy - ceilScreenY_raw) / fullHeight;
                      const world_v = v_frac * heightDiff;
                      const fracV = ((bottomZ + world_v) % 1 + 1) % 1;

                      let color;
                      if (hasFloorTexture && floorImageData) {
                        color = sampleFloorTexture(
                          floorImageData,
                          floorTexW,
                          floorTexH,
                          fracU,
                          fracV
                        );
                      } else {
                        color = 'rgb(34,0,0)';
                      }
                      const shaded = shadeColor(color, shade);
                      ctx.fillStyle = shaded;
                      ctx.fillRect(x, sy, 1, 1);
                    }
                  }
                }
              }
            }
          }
        }

        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      steps++;
      if (isWall(mapX, mapY)) {
        hit = true;
      }
    }

if (!hit) continue;

    let perpWallDist;
    if (side === 0) {
      perpWallDist = (mapX - posX + (1 - stepX) / 2) / rayDirX;
    } else {
      perpWallDist = (mapY - posY + (1 - stepY) / 2) / rayDirY;
    }
    if (perpWallDist <= 0) perpWallDist = 0.001;

    const hitKey = `${mapX},${mapY}`;
    const hitCell = currentDungeon.cells[hitKey] || {};
    const floorH = (typeof hitCell.floorHeight === 'number') ? hitCell.floorHeight : 0;
    const ceilH = (typeof hitCell.ceilHeight === 'number') ? hitCell.ceilHeight : 2;

    const wallBase = floorH;
    const floorScreenY = Math.floor(HORIZON - ((wallBase - eyeZ) / perpWallDist) * focalLength);
    const ceilScreenY = Math.floor(HORIZON - ((ceilH - eyeZ) / perpWallDist) * focalLength);

    const lineTop = ceilScreenY;
    const lineBottom = floorScreenY;
    let lineHeight = lineBottom - lineTop;
    if (lineHeight <= 0) continue;

    let drawStart = lineTop;
    let drawEnd = lineBottom;

    let wallX;
    if (side === 0) {
      wallX = posY + perpWallDist * rayDirY;
    } else {
      wallX = posX + perpWallDist * rayDirX;
    }
    wallX -= Math.floor(wallX);

    let texName = hitCell.tile || 'wall';
    if (texName === 'floor') texName = 'wall';
    if (texName === 'torch') texName = 'wall';
    const isTorchWall = texName === 'torch';
    if (isTorchWall) texName = 'wall';
    
    // Completely skip any drawing for custom tiles in wall pass
    if (texName.startsWith('custom_') || texName === 'pillar') {
      continue; // Skip this column entirely – sprites will handle it
    }

    const texImg = dungeonTextures[texName];
    let u = wallX * WALL_U_SCALE;
    u = (u % 1 + 1) % 1;

    const shade_wall = Math.max(0.2, 1.0 - perpWallDist / 10);
    const sideFactor = (side === 1) ? 0.85 : 1.0;
    const finalShade = shade_wall * sideFactor;
    const nX = (side === 0) ? stepX : 0;
    const nY = (side === 1) ? stepY : 0;
    const dot = nX * lightDirX + nY * lightDirY;
    const lightFactor = Math.max(0.2, Math.min(1.2, 0.6 + 0.4 * dot));
    const litShade = finalShade * (1 - lightIntensity + lightIntensity * lightFactor);

    const texInfo = texImg ? getWallTextureData(texName, texImg) : null;

    const baseFloor = (currentDungeon && currentDungeon.blueprint && currentDungeon.blueprint.base &&
      Number.isFinite(currentDungeon.blueprint.base.floor))
      ? currentDungeon.blueprint.base.floor
      : 0;
    const minFloor = Number.isFinite(currentDungeon?._minFloor) ? currentDungeon._minFloor : baseFloor;
    const extendToZ = Math.min(floorH, minFloor);
    const needExtendWall = extendToZ < floorH;
    let extraBottomY = null;
    let extraTop = null;
    let extraBottom = null;
    let extraHeight = 0;
    let totalHeight = lineHeight;
    if (needExtendWall) {
      extraBottomY = Math.floor(HORIZON - ((extendToZ - eyeZ) / perpWallDist) * focalLength);
      extraTop = Math.max(drawEnd, drawStart);
      extraBottom = Math.min(H, extraBottomY);
      extraHeight = Math.max(0, extraBottom - extraTop);
      totalHeight = lineHeight + extraHeight;
    }
    const totalPixelHeight = totalHeight > 0 ? totalHeight : 1;
    const WALL_GRADIENT_MIN = 0.35;
    const WALL_GRADIENT_FALLOFF = 0.18;
    function wallVerticalGradient(sy) {
      const globalV = (sy - drawStart) / totalPixelHeight;
      const clamped = Math.max(0, Math.min(1, globalV));
      return Math.max(WALL_GRADIENT_MIN, 1 - WALL_GRADIENT_FALLOFF * clamped);
    }

    if (!texInfo) {
      // Flat wall
      for (let sy = drawStart; sy < drawEnd; sy++) {
        const idx = sy * W + x;
        if (perpWallDist >= depthBuffer[idx]) continue;
        depthBuffer[idx] = perpWallDist;

        const grad = wallVerticalGradient(sy);
        const rowShade = litShade * grad;
        const rr = Math.floor(180 * rowShade);
        const gg = Math.floor(30 * rowShade);
        const bb = Math.floor(30 * rowShade);
        ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
        ctx.fillRect(x, sy, 1, 1);
        renderPerfStats.wallPixels += 1;
      }
      if (needExtendWall && extraHeight > 0) {
        for (let sy = extraTop; sy < extraBottom; sy++) {
          const idx = sy * W + x;
          if (perpWallDist >= depthBuffer[idx]) continue;
          depthBuffer[idx] = perpWallDist;
          const grad = wallVerticalGradient(sy);
          const rowShade = litShade * grad;
          const rr = Math.floor(180 * rowShade);
          const gg = Math.floor(30 * rowShade);
          const bb = Math.floor(30 * rowShade);
          ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
          ctx.fillRect(x, sy, 1, 1);
          renderPerfStats.wallPixels += 1;
        }
      }
    } else {
      const texData = texInfo.data;
      const texW = texInfo.w;
      const texH = texInfo.h;
      const wallHeight = Math.max(0.001, ceilH - floorH);

      function drawTexturedSegment(startY, endY, label) {
        for (let sy = startY; sy < endY; sy++) {
          const idx = sy * W + x;
          if (perpWallDist >= depthBuffer[idx]) continue;

          const worldZ = eyeZ + (HORIZON - sy) * (perpWallDist / focalLength);
          let vRaw = (ceilH - worldZ) / wallHeight;
          let v = vRaw % 2;
          if (v < 0) v += 2;
          if (v > 1) v = 2 - v;
          v = Math.min(v, 0.999999);

          const sample = sampleTextureRGBA(texData, texW, texH, u, v);
          if (sample.a <= 5) continue;

          depthBuffer[idx] = perpWallDist;

          const grad = wallVerticalGradient(sy);
          const rowShade = litShade * grad;
          const mortarStrength = texInfo.mortarMask
            ? sampleTextureMask(texInfo.mortarMask, texW, texH, u, v) / 255
            : 0;
          const shaded = rowShade * (1 - mortarStrength) + rowShade * 0.72 * mortarStrength;
            const hitWX = posX + rayDirX * perpWallDist;
            const hitWY = posY + rayDirY * perpWallDist;
            const normalTex = texInfo.normalMap ? sampleTextureNormal(texInfo.normalMap, texW, texH, u, v) : { x: 0, y: 0, z: 1 };
            const tX = -nY;
            const tY = nX;
            const nWorld = {
              x: tX * normalTex.x + nX * normalTex.z,
              y: tY * normalTex.x + nY * normalTex.z,
              z: normalTex.y
            };
            const dirLen = Math.hypot(lightDirX, lightDirY, lightElev) || 1;
            const ldx = lightDirX / dirLen;
            const ldy = lightDirY / dirLen;
            const ldz = lightElev / dirLen;
            const ndotl = Math.max(0, nWorld.x * ldx + nWorld.y * ldy + nWorld.z * ldz);
            const normalShade = 0.6 + 0.4 * ndotl;
            const lit = applyTorchLight(sample, shaded * normalShade, hitWX, hitWY, worldZ, nWorld, TORCH_WALL_BOOST);
          const r = lit.r;
          const g = lit.g;
          const b = lit.b;

          ctx.fillStyle = `rgba(${r},${g},${b},${sample.a / 255})`;
          ctx.fillRect(x, sy, 1, 1);
          renderPerfStats.wallPixels += 1;

        }
      }

      // Main wall segment
      drawTexturedSegment(drawStart, drawEnd, 'main');

      // Extension segment (if any)
      if (needExtendWall && extraHeight > 0) {
        drawTexturedSegment(extraTop, extraBottom, 'ext');
      }
    }
  }
  const wallEnd = performance.now();
  
  const spriteStart = performance.now();
  let spriteEnd = spriteStart;
  if (!RENDER_CUSTOM_AS_WALLS) {
  // SPRITE PASS (fixed relative position + vertical flip)
    const sprites = [];
    const VIS_RADIUS = Math.max(10, Math.min(18, Math.floor(maxDim / 10)));
    const TORCH_VIS_RADIUS = Math.max(VIS_RADIUS, 64);
  const SPRITE_WORLD_HEIGHT = 1.8;
  const SPRITE_WIDTH_RATIO = 0.7;
  const TORCH_WORLD_HEIGHT = 1.3;
  const TORCH_WIDTH_RATIO = 0.6;
  const TORCH_MOUNT_HEIGHT = 1.1;
  const TORCH_DEPTH_BIAS = 0.6;
  const TORCH_FLAME_RATIO = 0.4;
  const TORCH_HALO_SLOP = 0.03;
  const TORCH_ANCHOR_RATIO = 0.78;
  const TORCH_HEIGHT_OFFSET = 0.0;

  function drawTorchGlowAndFlame(spr, timeMs, hasSconce = true) {
    const seed = spr.flickerSeed / (Math.PI * 2);
    const flicker = torchFlicker(seed, timeMs);
    const rawHeight = Math.max(1, spr.rawDrawEndY - spr.rawDrawStartY);
    const gx = Math.floor(spr.screenX);
    const gy = Math.floor(spr.rawDrawStartY + rawHeight * TORCH_FLAME_RATIO);
    const glowRadius = Math.max(4, Math.floor(rawHeight * (0.55 + 0.2 * flicker)));
    const flickerShift = Math.round((flicker - 0.8) * 2);
    const flameH = Math.max(3, Math.floor(rawHeight * (0.22 + 0.1 * flicker)));
    const flameW = Math.max(2, Math.floor(flameH * 0.55));
    const glowAlpha = Math.min(0.6, 0.22 + 0.25 * flicker);
    const torchDist = spr.dist - TORCH_DEPTH_BIAS;
    const depthEps = 0.02;
    const isVisibleSample = (x, y) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return false;
      const idx = y * W + x;
      return !Number.isFinite(depthBuffer[idx]) || depthBuffer[idx] >= torchDist - depthEps;
    };
    const torchWallIdx = gy * W + gx;
    const torchWallDist = Number.isFinite(depthBuffer[torchWallIdx])
      ? depthBuffer[torchWallIdx]
      : torchDist;
    const haloOccluded = (x, y) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return true;
      const idx = y * W + x;
      if (!Number.isFinite(depthBuffer[idx])) return false;
      return depthBuffer[idx] < torchWallDist - TORCH_HALO_SLOP;
    };
    const torchVisible =
      isVisibleSample(gx, gy) ||
      isVisibleSample(gx, gy - 2) ||
      isVisibleSample(gx - 1, gy) ||
      isVisibleSample(gx + 1, gy);
    if (!torchVisible) return;

    if (!hasSconce) {
      const postH = Math.max(3, Math.floor(rawHeight * 0.16));
      const postW = Math.max(2, Math.floor(postH * 0.35));
      for (let y = gy - Math.floor(postH * 0.15); y < gy - Math.floor(postH * 0.15) + postH; y++) {
        if (y < 0 || y >= H) continue;
        for (let x = gx - Math.floor(postW / 2); x < gx - Math.floor(postW / 2) + postW; x++) {
          if (x < 0 || x >= W) continue;
          const idx = y * W + x;
          ctx.fillStyle = "rgba(20,16,12,0.9)";
          ctx.fillRect(x, y, 1, 1);
        }
      }
      const barW = Math.floor(postW * 2.8);
      const barH = Math.max(1, Math.floor(postH * 0.25));
      const barX = gx - Math.floor(postW * 1.4);
      const barY = gy - Math.floor(postH * 0.1);
      for (let y = barY; y < barY + barH; y++) {
        if (y < 0 || y >= H) continue;
        for (let x = barX; x < barX + barW; x++) {
          if (x < 0 || x >= W) continue;
          const idx = y * W + x;
          ctx.fillStyle = "rgba(20,16,12,0.9)";
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    // Halo/glow with per-pixel depth test
    const gxc = gx;
    const gyc = gy + flickerShift;
    const radiusSq = glowRadius * glowRadius;
    for (let y = gyc - glowRadius; y <= gyc + glowRadius; y++) {
      if (y < 0 || y >= H) continue;
      const dy = y - gyc;
      for (let x = gxc - glowRadius; x <= gxc + glowRadius; x++) {
        if (x < 0 || x >= W) continue;
        const dx = x - gxc;
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSq) continue;
        if (haloOccluded(x, y)) continue;
        const idx = y * W + x;
        const t = Math.sqrt(distSq) / glowRadius;
        let a;
        if (t <= 0.45) {
          const tNorm = t / 0.45;
          a = (0.45 * glowAlpha) + (glowAlpha - 0.45 * glowAlpha) * tNorm;
        } else {
          const tNorm = (t - 0.45) / 0.55;
          a = glowAlpha * (1 - tNorm);
        }
        if (a <= 0) continue;
        const r = t <= 0.4 ? 255 : 255;
        const g = t <= 0.4 ? 210 : 180;
        const b = t <= 0.4 ? 130 : 90;
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Flame (pixelated rows)
    for (let row = 0; row < flameH; row++) {
      const t = row / Math.max(1, flameH - 1);
      const rowW = Math.max(1, Math.round(flameW * (1 - t * 0.7)));
      const y = gy - flameH + row + flickerShift;
      if (y < 0 || y >= H) continue;
      const x0 = gx - Math.floor(rowW / 2);
      const r = 255;
      const g = Math.round(140 + (1 - t) * 80);
      const b = Math.round(40 + (1 - t) * 30);
      for (let x = x0; x < x0 + rowW; x++) {
        if (x < 0 || x >= W) continue;
        const idx = y * W + x;
        ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Hot core
    const coreY = gy - Math.floor(flameH * 0.6) + flickerShift;
    for (let y = coreY; y < coreY + 2; y++) {
      if (y < 0 || y >= H) continue;
      const idx = y * W + gx;
      ctx.fillStyle = "rgba(255,245,220,0.9)";
      ctx.fillRect(gx, y, 1, 1);
    }
  }

  for (let dx = -TORCH_VIS_RADIUS; dx <= TORCH_VIS_RADIUS; dx++) {
    for (let dy = -TORCH_VIS_RADIUS; dy <= TORCH_VIS_RADIUS; dy++) {
      const wx = playerDungeonX + dx;
      const wy = playerDungeonY + dy;
      const key = `${wx},${wy}`;
      const cell = currentDungeon.cells[key];
      const tileName = cell?.tile;
      const isCustom = tileName === 'pillar' || (!!tileName && tileName.startsWith('custom_'));
      const isTorch = tileName === 'torch';
      const inSpriteRadius = Math.abs(dx) <= VIS_RADIUS && Math.abs(dy) <= VIS_RADIUS;
      if (!inSpriteRadius && !isTorch) continue;
      if (!isCustom && !isTorch) continue;

      const texName = tileName;
      const texImg = dungeonTextures[texName];
      const texInfo = getWallTextureData(texName, texImg);
      if (!texInfo && !isTorch) continue;

      let worldX = wx + 0.5;
      let worldY = wy + 0.5;
      if (isTorch) {
        const facing = getTorchFacing(wx, wy, cell);
        if (facing === 'N') worldY -= TORCH_WALL_OFFSET;
        if (facing === 'S') worldY += TORCH_WALL_OFFSET;
        if (facing === 'W') worldX -= TORCH_WALL_OFFSET;
        if (facing === 'E') worldX += TORCH_WALL_OFFSET;
      }

      // Keep torches anchored to the true player camera to avoid drift from eye-back offset.
      const spriteCamX = isTorch ? playerWorldX : posX;
      const spriteCamY = isTorch ? playerWorldY : posY;
      const dxp = worldX - spriteCamX;
      const dyp = worldY - spriteCamY;

      const distSq = dxp * dxp + dyp * dyp;
      if (!isTorch && (distSq < 0.04 || distSq > VIS_RADIUS * VIS_RADIUS)) continue;

      const invDet = 1.0 / (planeX * dirY - dirX * planeY);
      const transformX = invDet * (dirY * dxp - dirX * dyp);
      const transformY = invDet * (-planeY * dxp + planeX * dyp);
      if (transformY <= 0.001) continue;
      const safeTransformY = Math.max(0.001, transformY);

      const spriteScreenX = Math.floor((W / 2) * (1 + transformX / safeTransformY));
      const { floorHeight: spriteFloorH = 0, ceilHeight: spriteCeilH = 0 } = getCellHeights(wx, wy);

      let spriteWorldHeight = SPRITE_WORLD_HEIGHT;
      let spriteWidthRatio = SPRITE_WIDTH_RATIO;
      let spriteBaseZ = spriteFloorH;
      let allowPad = true;
      let allowShadow = true;
      let flickerSeed = 0;

      if (isTorch) {
        spriteWorldHeight = TORCH_WORLD_HEIGHT;
        spriteWidthRatio = TORCH_WIDTH_RATIO;
        if (Number.isFinite(spriteCeilH) && Number.isFinite(spriteFloorH) && spriteCeilH > spriteFloorH) {
          spriteBaseZ = spriteFloorH + (spriteCeilH - spriteFloorH) * TORCH_MOUNT_RATIO + TORCH_HEIGHT_OFFSET;
        } else {
          spriteBaseZ = spriteFloorH + TORCH_MOUNT_HEIGHT + TORCH_HEIGHT_OFFSET;
        }
        allowPad = false;
        allowShadow = false;
        const seed = ((wx * 928371 + wy * 1237) % 1000) / 1000;
        flickerSeed = seed * Math.PI * 2;
        needsAnimation = true;
      } else if (Number.isFinite(spriteCeilH) && Number.isFinite(spriteFloorH) && spriteCeilH > spriteFloorH) {
        spriteWorldHeight = Math.max(0.5, spriteCeilH - spriteFloorH);
      }

      const bottomScreenY = Math.floor(HORIZON + (eyeZ - spriteBaseZ) * focalLength / safeTransformY);
      let spriteScreenHeight = Math.floor(spriteWorldHeight * focalLength / safeTransformY);
      if (isTorch && spriteScreenHeight < 2) spriteScreenHeight = 2;

      let drawStartY;
      let drawEndY;
      if (isTorch) {
        drawStartY = Math.floor(bottomScreenY - spriteScreenHeight * TORCH_ANCHOR_RATIO);
        drawEndY = drawStartY + spriteScreenHeight;
      } else {
        drawStartY = bottomScreenY - spriteScreenHeight;
        drawEndY = bottomScreenY;
      }
      const rawDrawStartY = drawStartY;
      const rawDrawEndY = drawEndY;

      // If the sprite has transparent padding at the bottom, push it down to rest on the floor.
      if (allowPad && typeof texInfo?.lastOpaqueY === 'number' && texInfo.lastOpaqueY >= 0) {
        const padRatio = (texInfo.h - 1 - texInfo.lastOpaqueY) / texInfo.h;
        const padPx = Math.floor(spriteScreenHeight * padRatio);
        if (padPx > 0) {
          drawStartY += padPx;
          drawEndY += padPx;
        }
      }

      if (drawEndY < 0 || drawStartY >= H) continue;
      drawStartY = Math.max(0, drawStartY);
      drawEndY = Math.min(H, drawEndY);
      if (drawStartY >= drawEndY) continue;

      let spriteScreenWidth = Math.floor(spriteScreenHeight * spriteWidthRatio);
      if (isTorch && spriteScreenWidth < 1) spriteScreenWidth = 1;

      // Directional shadow projected onto the floor from a single light source.
      let shadow = null;
      if (allowShadow) {
        const elevAngle = (15 + lightElev * 60) * (Math.PI / 180);
        const shadowLen = spriteWorldHeight / Math.max(0.1, Math.tan(elevAngle));
        const shadowWorldX = worldX + lightDirX * shadowLen;
        const shadowWorldY = worldY + lightDirY * shadowLen;
        const sdxp = shadowWorldX - posX;
        const sdyp = shadowWorldY - posY;
        const shadowTransformX = invDet * (dirY * sdxp - dirX * sdyp);
        const shadowTransformY = invDet * (-planeY * sdxp + planeX * sdyp);
        if (shadowTransformY > 0.1) {
          const shadowScreenX = Math.floor((W / 2) * (1 + shadowTransformX / shadowTransformY));
          const shadowBottomY = Math.floor(HORIZON + (eyeZ - spriteFloorH) * focalLength / shadowTransformY);
          const shadowW = Math.max(2, Math.floor(spriteWorldHeight * focalLength / shadowTransformY * spriteWidthRatio));
          const shadowH = Math.max(1, Math.floor(shadowW * 0.2));
          shadow = {
            x: shadowScreenX,
            y: shadowBottomY,
            w: shadowW,
            h: shadowH,
            dist: shadowTransformY
          };
        }
      }

      sprites.push({
        type: isTorch ? 'torch' : 'custom',
        screenX: spriteScreenX,
        dist: safeTransformY,
        width: spriteScreenWidth,
        height: spriteScreenHeight,
        drawStartY,
        drawEndY,
        rawDrawStartY,
        rawDrawEndY,
        texName,
        texImg,
        texInfo,
        shadow,
        transformY: safeTransformY,
        flickerSeed
      });
      renderPerfStats.spriteCount += 1;
    }
  }

  sprites.sort((a, b) => b.dist - a.dist);

    for (const spr of sprites) {
      const texInfo = spr.texInfo;
      if (!texInfo && spr.type !== 'torch') continue;

      if (texInfo) {
        const texData = texInfo.data;
        const texW = texInfo.w;
        const texH = texInfo.h;

        if (spr.shadow) {
          const sx = Math.floor(spr.shadow.x);
          const sy = Math.floor(spr.shadow.y);
          if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
            const sIdx = sy * W + sx;
            if (depthBuffer[sIdx] >= spr.shadow.dist) {
              const alpha = Math.max(0.08, Math.min(0.45, 0.35 * lightIntensity * (1 - spr.shadow.dist / 18)));
              ctx.save();
              ctx.globalAlpha = alpha;
              ctx.fillStyle = '#000000';
              ctx.beginPath();
              ctx.ellipse(spr.shadow.x, spr.shadow.y, spr.shadow.w / 2, spr.shadow.h / 2, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          }
        }

        const drawLeft = Math.floor(spr.screenX - spr.width / 2);
        const drawRight = Math.floor(spr.screenX + spr.width / 2);

        let drewAny = false;
        for (let stripe = drawLeft; stripe < drawRight; stripe++) {
          if (stripe < 0 || stripe >= W) continue;

          const texX = Math.floor(((stripe - drawLeft) * 256 * texW) / spr.width / 256);
          if (texX < 0 || texX >= texW) continue;

          for (let y = spr.drawStartY; y < spr.drawEndY; y++) {
            if (y < 0 || y >= H) continue;

            // Base of texture aligns with floor (flip Y)
            const torchTexY = Math.floor(((spr.rawDrawEndY - y - 1) * texH) / Math.max(1, (spr.rawDrawEndY - spr.rawDrawStartY)));
            const baseTexY = Math.floor(((spr.drawEndY - y - 1) * texH) / spr.height);
            const texY = spr.type === 'torch'
              ? torchTexY
              : (spr.texName === 'pillar'
                ? (texH - 1 - baseTexY)
                : baseTexY);
            if (texY < 0 || texY >= texH) continue;

            const idx = y * W + stripe;

            const lateralOffset = stripe - spr.screenX;
            const spriteDist = spr.dist / Math.cos(Math.atan2(lateralOffset, focalLength));
            const depthBias = spr.type === 'torch' ? TORCH_DEPTH_BIAS : 0;
            const testDist = spriteDist - depthBias;
            if (testDist >= depthBuffer[idx]) continue;

            const sample = sampleTextureRGBA(texData, texW, texH, texX / texW, texY / texH);
            if (sample.a <= 10) continue;

            let shade = Math.max(0.25, 1.0 - spriteDist / 12);
            if (spr.type === 'torch') {
              const flicker = torchFlicker(spr.flickerSeed / (Math.PI * 2), now);
              shade = Math.max(0.75, shade * flicker);
            }
            const boost = spr.type === 'torch' ? 1.15 : 1.0;
            const r = Math.round(Math.min(255, sample.r * shade * boost));
            const g = Math.round(Math.min(255, sample.g * shade * boost));
            const b = Math.round(Math.min(255, sample.b * shade * boost));

            ctx.fillStyle = `rgba(${r},${g},${b},${sample.a / 255})`;
            ctx.fillRect(stripe, y, 1, 1);
            renderPerfStats.spritePixels += 1;

            depthBuffer[idx] = testDist;
            drewAny = true;
          }
        }

        if (spr.type === 'torch') {
          drawTorchGlowAndFlame(spr, now, drewAny);
        }
      } else if (spr.type === 'torch') {
        drawTorchGlowAndFlame(spr, now, false);
      }
  }

  }
  spriteEnd = performance.now();
  // Final blit (unchanged)
  const postStart = performance.now();
  const scaledCanvas = scale2x(ctx, W, H);
  displayCtx.imageSmoothingEnabled = false;
  displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
  displayCtx.drawImage(scaledCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height, 0, 0, displayCanvas.width, displayCanvas.height);
  const postEnd = performance.now();

  renderPerfStats.frames += 1;
  renderPerfStats.floorMs += floorEnd - floorStart;
  renderPerfStats.wallMs += wallEnd - wallStart;
  renderPerfStats.spriteMs += spriteEnd - spriteStart;
  renderPerfStats.postMs += postEnd - postStart;
  renderPerfStats.totalMs += postEnd - frameStart;

  const nowMs = postEnd;
  if (!renderPerfStats.lastLog) renderPerfStats.lastLog = nowMs;
  const elapsed = nowMs - renderPerfStats.lastLog;
  if (elapsed >= 1000) {
    const fps = Math.round((renderPerfStats.frames * 1000) / elapsed);
    const avgTotal = renderPerfStats.totalMs / renderPerfStats.frames;
    const avgFloor = renderPerfStats.floorMs / renderPerfStats.frames;
    const avgWall = renderPerfStats.wallMs / renderPerfStats.frames;
    const avgSprite = renderPerfStats.spriteMs / renderPerfStats.frames;
    const avgPost = renderPerfStats.postMs / renderPerfStats.frames;
    console.log(
      `[FPS] ${fps} | total ${avgTotal.toFixed(1)}ms ` +
      `floor ${avgFloor.toFixed(1)} wall ${avgWall.toFixed(1)} ` +
      `sprites ${avgSprite.toFixed(1)} post ${avgPost.toFixed(1)} ` +
      `rows ${renderPerfStats.floorRows} ` +
      `fpx ${renderPerfStats.floorPixels} ` +
      `wcols ${renderPerfStats.wallCols} ` +
      `wpx ${renderPerfStats.wallPixels} ` +
      `spr ${renderPerfStats.spriteCount} ` +
      `spx ${renderPerfStats.spritePixels}`
    );
    renderPerfStats.lastLog = nowMs;
    renderPerfStats.frames = 0;
    renderPerfStats.totalMs = 0;
    renderPerfStats.floorMs = 0;
    renderPerfStats.wallMs = 0;
    renderPerfStats.spriteMs = 0;
    renderPerfStats.postMs = 0;
    renderPerfStats.floorRows = 0;
    renderPerfStats.floorPixels = 0;
    renderPerfStats.wallCols = 0;
    renderPerfStats.wallPixels = 0;
    renderPerfStats.spriteCount = 0;
    renderPerfStats.spritePixels = 0;
  }

  if ((needsAnimation || torchLights.length) && popup.style.display === 'block') {
    if (!window._dungeonAnimPending) {
      window._dungeonAnimPending = true;
      window.requestAnimationFrame(() => {
        window._dungeonAnimPending = false;
        if (popup.style.display !== 'block') return;
        renderDungeonView();
      });
    }
  }

  // -----------------------------------
  // Minimap (drawn AFTER postprocess, so it stays crisp)
  // -----------------------------------
  const miniSize = 4;
  const miniScale = 2; // 2×2 tiles around player
  const miniX0 = 8;
  const miniY0 = 8;

  for (let dy = -miniScale; dy <= miniScale; dy++) {
    for (let dx = -miniScale; dx <= miniScale; dx++) {
      const mx = playerDungeonX + dx;
      const my = playerDungeonY + dy;
      const key = `${mx},${my}`;
      const cell = currentDungeon.cells[key];
      if (!cell) continue;

      if (cell.tile === 'wall' || cell.tile === 'door') {
        displayCtx.fillStyle = '#880000';
      } else {
        displayCtx.fillStyle = '#003366';
      }

      const sx = miniX0 + (dx + miniScale) * miniSize;
      const sy = miniY0 + (dy + miniScale) * miniSize;
      displayCtx.fillRect(sx, sy, miniSize, miniSize);
    }
  }

  // Player dot on minimap
  displayCtx.fillStyle = '#00ff00';
  displayCtx.fillRect(
    miniX0 + miniScale * miniSize,
    miniY0 + miniScale * miniSize,
    miniSize, miniSize
  );

  // NEW: keep the combat-map dungeon overlay in lockstep with the dungeon view
  if (window.combatGame) {
    const scene = window.combatGame.scene.getScene('CombatScene');
    if (scene && scene.drawDungeonOverlay) {
      scene.drawDungeonOverlay();
    }
  }
  return displayCanvas;
}

function renderDungeonView() {
  window.currentDungeon = currentDungeon;
  window.dungeonTextures = dungeonTextures;
  window.playerDungeonX = playerDungeonX;
  window.playerDungeonY = playerDungeonY;
  window.playerPosX = playerPosX;
  window.playerPosY = playerPosY;
  window.playerAngle = playerAngle;
  window.playerZ = playerZ;
  window.PLAYER_EYE_HEIGHT = PLAYER_EYE_HEIGHT;
  const container = document.getElementById('dungeon-container');
  if (!window.forceCanvasDungeon && window.useWebGLRenderer && window.webglDungeonRenderer && container) {
    if (!window.webglDungeonRenderer.gl) {
      window.webglDungeonRenderer.init(container);
    }
  }
  const hasWebGLRenderer = !!(window.webglDungeonRenderer && window.webglDungeonRenderer.gl);
  if (!window.forceCanvasDungeon && hasWebGLRenderer) {
      if (typeof window.webglDungeonRenderer.renderScene === 'function') {
        window.webglDungeonRenderer.renderScene();
        if (window.combatGame) {
          const scene = window.combatGame.scene.getScene('CombatScene');
          if (scene && scene.drawDungeonOverlay) {
            scene.drawDungeonOverlay();
          }
        }
        logDungeonCombatSync('render-webgl');
        return;
      }
    const rasterCanvas = renderDungeonViewCanvas(true);
    if (typeof window.webglDungeonRenderer.render === 'function') {
      window.webglDungeonRenderer.render(rasterCanvas);
      return;
    }
    }
    renderDungeonViewCanvas(false);
    logDungeonCombatSync('render-canvas');
  }


