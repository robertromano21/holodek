(function (root) {
  'use strict';
  if (root.HolodekSaveGame?.version >= 4) { root.HolodekSaveGame.open(); return; }
  root.document.getElementById('save-game-dialog')?.remove();
  root.document.getElementById('open-save-game-button')?.remove();
  let panel, status, rows, working = false;
  const copy = value => JSON.parse(JSON.stringify(value, (key, v) => {
    if (['_lodCache', '_minFloor', '_webglCache', '_webgpuCache'].includes(key) || typeof v === 'function') return undefined;
    if (v instanceof Map) return Object.fromEntries(v);
    if (v instanceof Set || ArrayBuffer.isView(v)) return Array.from(v);
    return v;
  }));
  const sleep = ms => new Promise(resolve => root.setTimeout(resolve, ms));
  async function roomPictures() {
    const out = {};
    for (const [key, url] of Object.entries(root.roomImages || {})) {
      if (!url || url.startsWith('data:image/')) { out[key] = url; continue; }
      // Preserve legacy image-service illustrations too. New Grave Master art
      // has a portable component recipe in each room's illustration field.
      const response = await root.fetch(url);
      if (!response.ok) throw Error('Cannot preserve room illustration: ' + key);
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size > 16 * 1024 * 1024) throw Error('Invalid room illustration: ' + key);
      out[key] = await new Promise((resolve, reject) => { const r = new root.FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
    }
    return out;
  }
  async function api(url, body) {
    const r = await root.fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const data = await r.json().catch(() => ({})); throw Error(data.error || (r.status === 404 ? 'Save support is not installed in this server yet. Do not restart this adventure.' : 'Save request failed: ' + r.status)); }
    return r.json();
  }
  function idle() {
    const c = root.getDungeonLifeContext?.();
    if (!c?.dungeon || !root.dungeonRunId) throw Error('Enter the adventure before saving.');
    if (c.busy || root.actionDiceState?.active || root._combatCommandPending || root.GameCommandGate?.busy()) throw Error('Finish the current command and combat round first.');
    return c;
  }
  async function database(name) {
    return new Promise((resolve, reject) => {
      const r = root.indexedDB.open(name);
      r.onupgradeneeded = () => {
        if (name === 'cotg-exploration') r.result.createObjectStore('rooms');
        else if (name === 'DungeonCampaignMemories') { const s = r.result.createObjectStore('records', { keyPath: 'key' }); s.createIndex('runId', 'runId'); s.createIndex('room', ['runId', 'roomKey']); }
        else { r.transaction.abort(); reject(Error('Browser archive is not ready: ' + name)); }
      };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  async function archive(name, store, accept) {
    const db = await database(name);
    try { return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly'), out = [], cursor = tx.objectStore(store).openCursor();
      cursor.onsuccess = () => { const c = cursor.result; if (!c) return; if (accept(c.key, c.value)) out.push({ key: c.key, value: c.value }); c.continue(); };
      tx.oncomplete = () => resolve(out); tx.onerror = tx.onabort = () => reject(tx.error || Error('Archive read failed.'));
    }); } finally { db.close(); }
  }
  async function replaceArchive(name, storeName, accept, entries) {
    const db = await database(name);
    try { await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite'), store = tx.objectStore(storeName), cursor = store.openCursor();
      cursor.onsuccess = () => { const c = cursor.result; if (c) { if (accept(c.key, c.value)) c.delete(); c.continue(); }
        else for (const entry of entries) { if (store.keyPath) store.put(entry.value); else store.put(entry.value, entry.key); } };
      tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error || Error('Archive restore failed.'));
    }); } finally { db.close(); }
  }
  async function capture() {
    const context = idle(), runId = root.dungeonRunId, geoKey = context.dungeon.geoKey;
    const id = root.localStorage.getItem('conversationId');
    if (!id) throw Error('The current conversation is not ready.');
    const conversation = { id, rows: await getPromptsAndResponsesForConversation(id) };
    // New builds flush immediately. The live pre-feature tab needs its existing
    // two-second map debounce to finish before reading the archive.
    if (root.DungeonExplorationMap?.flushForSave) await root.DungeonExplorationMap.flushForSave(); else await sleep(2100);
    const exploration = await archive('cotg-exploration', 'rooms', key => String(key).startsWith(runId + ':'));
    const memories = await archive('DungeonCampaignMemories', 'records', (key, v) => v.runId === runId);
    const roomImages = await roomPictures();
    if (root.dungeonRunId !== runId || root.getDungeonLifeContext()?.dungeon?.geoKey !== geoKey) throw Error('The room changed during saving. Try again.');
    const data = { characters, npcs, inventory, inventoryProperties, equippedInventory,
      roomConversationHistories, roomConnections, visitedRooms, unvisitedRooms, connectedRooms, unconnectedRooms,
      monstersInVisitedRooms: Array.from(monstersInVisitedRooms), monstersEquippedPropertiesByRoom: Array.from(monstersEquippedPropertiesByRoom), monstersStateByRoom: Array.from(monstersStateByRoom),
      turns, globalQuestsAchieved, globalArtifactsFound, score, gameMode,
      combatCharacters: context.actors, latestUpdatedData: root.latestUpdatedData || {},
      partyRegistry: root._partyCharacterRegistry || {}, spriteRegistry: root._partySpriteRegistry || {}, selectedPCSprite: root._selectedPCSprite || null,
      characterTraits: root._characterTraitSpecs || {}, characterSheets: root._characterSheetIndex || {},
      roomImages, gameOver: !!root._gameOver, gameLogFormat: 'text-v2', gameLogText: root.SaveGameTranscript.capture(root.document.getElementById('chatlog')),
      audioCheckpoint: root.HolodekSfx?.checkpoint?.() || (() => { const elements = [...root.document.querySelectorAll('audio')]; const a = elements.find(a => !a.paused) || elements.find(a => a.currentTime > 0); return { time: a?.currentTime || 0, paused: !!root.HolodekSfx?.settings?.userPaused }; })(),
      audioSettings: root.HolodekSfx?.settings || null };
    return copy({ version: 1, runId, geoKey, conversation, exploration, memories, data,
      position: { x: context.player.x, y: context.player.y, angle: root.playerAngle, z: root.playerZ ?? null } });
  }
  async function save(slot, label, options = {}) {
    if (working) throw Error('Wait for the current save or load.'); idle(); working = true;
    const paused = !!root.gamePaused;
    try {
      if (!paused) await api('/game/pause', { runId: root.dungeonRunId, paused: true });
      root.DungeonLife?.setPaused({ runId: root.dungeonRunId, paused: true });
      root.gamePaused = true;
      const browser = await capture();
      return await api('/game-saves/' + slot, { runId: browser.runId, browser, label, ...options });
    } finally {
      // A failed save must not silently claim success or strand an otherwise
      // running adventure in pause. An existing user pause remains untouched.
      try { if (!paused) { await api('/game/pause', { runId: root.dungeonRunId, paused: false }); root.DungeonLife?.setPaused({ runId: root.dungeonRunId, paused: false }); root.gamePaused = false; } }
      catch (e) { console.warn('[GameSavePause]', 'The game remains paused. Use P to resume:', e.message); }
      finally { working = false; }
    }
  }
  const assignObject = (target, source) => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, source || {}); };
  const assignSet = (target, source) => { target.clear(); for (const v of source || []) target.add(v); };
  const assignMap = (target, source) => { target.clear(); for (const [k, v] of source || []) target.set(k, v); };
  function restoreLog(browser) {
    const log = root.document.getElementById('chatlog'), story = root.document.createElement('div'); story.style.whiteSpace = 'pre-wrap';
    const transcript = root.SaveGameTranscript.restore(browser);
    story.textContent = root.GameLogContent?.withoutLootLists(transcript) ?? transcript; log?.replaceChildren(story);
    root.syncGameLogTranscript?.(); root.syncBackgroundChatLog?.();
  }
  async function repairPresentation() {
    idle();
    const id = root.localStorage.getItem('conversationId'), rows = await getPromptsAndResponsesForConversation(id);
    const text = root.lastServerGameConsole;
    if (!text) throw Error('The current game console is not ready.');
    root.latestUpdatedData = root.DungeonInhabitants.consoleView(text, root.latestUpdatedData);
    root._partyInfoPCString = root.latestUpdatedData.pc; root._partyInfoNPCString = root.latestUpdatedData.npcs;
    root._combatMonsterSheets = root.latestUpdatedData.monsters;
    root.SpellUi?.hydrate(text);
    restoreLog({ conversation: { rows }, data: { gameLogText: '' } });
    root.game?.scene?.getScene('MainScene')?.scene.restart(root.latestUpdatedData);
    root.renderPartyIconDock?.();
    return { repaired: true, historyRows: rows.length };
  }
  async function restoreBrowser(loaded) {
    const b = loaded.browser, d = b.data;
    if (b.runId !== loaded.runId || b.geoKey !== loaded.roomKey || !loaded.dungeon) throw Error('Loaded server and browser state disagree. The game remains paused.');
    root.gamePaused = true;
    root.HolodekSfx?.stopSpeech(); root.DungeonLife?.reset({ paused: true }); root.InventoryUi?.reset(); root.ItemInteractionUi?.reset(); root.ObjectDiscovery?.reset();
    root.dungeonRunId = loaded.runId;
    await root.DungeonExplorationMap?.flushForSave?.(); root.DungeonExplorationMap?.reset({ discard: true });
    await replaceArchive('cotg-exploration', 'rooms', key => String(key).startsWith(loaded.runId + ':'), b.exploration);
    await replaceArchive('DungeonCampaignMemories', 'records', (key, v) => v.runId === loaded.runId, b.memories);
    await openDungeonDB(); await openMusicDB();
    for (const name of ['rooms', 'inhabitants']) await replaceArchive('cotg-dungeons', name, key => String(key).startsWith(loaded.runId + ':'), []);
    await replaceArchive('cotg-music', 'rooms', (key, value) => value.__runId === loaded.runId, []);
    if (pendingLodPersist) { root.clearTimeout(pendingLodPersist); pendingLodPersist = null; }
    const cid = 'loaded-' + root.crypto.randomUUID();
    // New conversation IDs keep other adventures' history intact and prevent
    // later turns in this timeline leaking into an earlier saved checkpoint.
    await new Promise((resolve, reject) => {
      const tx = db.transaction('conversation', 'readwrite'), store = tx.objectStore('conversation');
      for (const row of b.conversation.rows) { const next = { ...row, conversationId: cid }; delete next.id; store.add(next); }
      tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error || Error('Conversation restore failed.'));
    });
    root.localStorage.setItem('conversationId', cid);
    characters = d.characters; npcs = d.npcs; inventory = d.inventory; inventoryProperties = d.inventoryProperties; equippedInventory = d.equippedInventory;
    Object.assign(root, { characters, npcs, inventory: inventory.slice(), roomImages: d.roomImages, _partyCharacterRegistry: d.partyRegistry,
      _partySpriteRegistry: d.spriteRegistry, _selectedPCSprite: d.selectedPCSprite, _statsRolled: true,
      _characterStartupPending: false, _combatCommandPending: false, _combatRoundActiveUntil: 0, gamePaused: true });
    if (root._traitRequestTimer) root.clearTimeout(root._traitRequestTimer);
    root._traitRequestTimer = null; root._traitRequestQueue = new Map(); root._traitRequested = {}; root._traitReadyWaiters = [];
    root._proceduralSpriteCache = {}; root._characterSheetIndex = d.characterSheets || {};
    root._characterTraitSpecs = Object.fromEntries(Object.values(loaded.characterTraits || d.characterTraits || {}).map(v => [v.name.toLowerCase().trim(), v]));
    root._lastSheetConsoleText = '';
    root._pendingStartingCharacter = characters[0] || null;
    root._gameOver = !!d.gameOver;
    assignObject(roomConversationHistories, d.roomConversationHistories); assignObject(roomConnections, d.roomConnections);
    assignSet(visitedRooms, d.visitedRooms); assignSet(unvisitedRooms, d.unvisitedRooms); assignSet(connectedRooms, d.connectedRooms); assignSet(unconnectedRooms, d.unconnectedRooms);
    assignMap(monstersInVisitedRooms, d.monstersInVisitedRooms); assignMap(monstersEquippedPropertiesByRoom, d.monstersEquippedPropertiesByRoom); assignMap(monstersStateByRoom, d.monstersStateByRoom);
    turns = d.turns; globalQuestsAchieved = d.globalQuestsAchieved; globalArtifactsFound = d.globalArtifactsFound; score = d.score; gameMode = d.gameMode;
    roomNameDatabaseString = loaded.roomNameDatabaseString; roomNameDatabasePlainObject = JSON.parse(roomNameDatabaseString);
    assignMap(roomNameDatabase, Object.entries(roomNameDatabasePlainObject)); roomDatabaseSyncClient.reset();
    const [x, y, z] = loaded.roomKey.split(',').map(Number); currentCoordinates = { x, y, z };
    root.currentCoordinates = `X: ${x}, Y: ${y}, Z: ${z}`;
    currentDungeon = ensureDungeonGeometryStamp(loaded.dungeon, loaded.roomKey); currentDungeon.geoKey = loaded.roomKey;
    lastDungeonGeoKey = loaded.roomKey; dungeonSwitchRequest++;
    playerPosX = b.position.x; playerPosY = b.position.y; playerDungeonX = Math.floor(playerPosX); playerDungeonY = Math.floor(playerPosY); playerAngle = b.position.angle;
    playerZInitialized = false; updatePlayerHeightFromCell();
    if (Number.isFinite(b.position.z)) { playerZ = playerZTarget = b.position.z; playerZInitialized = true; }
    Object.assign(root, { playerPosX, playerPosY, playerAngle, playerZ });
    const canonical = JSON.parse(loaded.combatCharactersString), oldActors = d.combatCharacters || [];
    root.combatCharacters = canonical.map(a => { const old = oldActors.find(o => o.name === a.name) || {};
      const result = { ...old, ...a, sprite: old.sprite || a.sprite, voiceSpec: old.voiceSpec || a.voiceSpec };
      for (const k of ['mazeX', 'mazeY', 'mazeRoomKey', 'facingAngle', 'facingX', 'facingY']) if (old[k] != null) result[k] = old[k]; return result; });
    combatCharactersString = JSON.stringify(root.combatCharacters); root.combatCharactersString = combatCharactersString;
    root.lastServerGameConsole = loaded.updatedGameConsole; root.dungeonItemConsole = null;
    root.applySpellEquipment(loaded.updatedGameConsole); updateCharacterSheetsFromConsole(loaded.updatedGameConsole);
    root.latestUpdatedData = root.DungeonInhabitants.consoleView(loaded.updatedGameConsole, d.latestUpdatedData);
    root._partyInfoPCString = root.latestUpdatedData.pc;
    root._partyInfoNPCString = root.latestUpdatedData.npcs;
    root._combatMonsterSheets = root.latestUpdatedData.monsters;
    root.SpellUi?.hydrate(loaded.updatedGameConsole);
    currentQuest = root.latestUpdatedData.currentQuest; nextArtifact = root.latestUpdatedData.nextArtifact; nextBoss = root.latestUpdatedData.nextBoss;
    nextBossRoom = root.latestUpdatedData.nextBossRoom; bossCoordinates = root.latestUpdatedData.bossCoordinates;
    root.questProgressText = root.latestUpdatedData.questProgress; root.questRequirementsText = root.latestUpdatedData.questRequirements;
    root.silverPieces = root.latestUpdatedData.silverPieces;
    restoreLog(b);
    const command = root.document.getElementById('chatuserinput'); if (command?.value.trim().toLowerCase() === 'start') command.value = '';
    ensureKnownSpritesInCombatList(root.combatCharacters); ensurePartyMazeIdleInterval(); preloadDungeonTextures();
    root.DungeonCampaignMemory?.begin('restore-' + root.crypto.randomUUID()); root.DungeonCampaignMemory?.begin(loaded.runId);
    if (loaded.population) {
      const receive = root.DungeonLife?.restorePopulation || root.DungeonLife?.receivePopulation;
      receive?.({ population: loaded.population, runId: loaded.runId });
    }
    root.DungeonLife?.setPaused({ runId: loaded.runId, paused: true });
    root.game?.scene?.getScene('MainScene')?.scene.restart(root.latestUpdatedData);
    root.combatGame?.scene?.getScene('CombatScene')?.updateCharacters(root.combatCharacters);
    await idbSetDungeon(loaded.roomKey, currentDungeon);
    root.renderPartyIconDock?.(); renderDungeonView();
    await root.HolodekSfx?.restoreCheckpoint?.(d.audioCheckpoint, d.audioSettings, loaded.audio, loaded.roomKey, loaded.runId);
    root.HolodekSfx?.roomShown(loaded.roomKey);
  }
  async function load(slot, checksum) {
    if (working) throw Error('Wait for the current save or load.'); working = true;
    const paused = !!root.gamePaused;
    try {
      if (root.getDungeonLifeContext?.()?.busy || root.actionDiceState?.active) throw Error('Finish the current command before loading.');
      // The renderer and idle callbacks must not mutate the old timeline while
      // the server and IndexedDB archives are being replaced.
      await api('/game/pause', { runId: root.dungeonRunId, paused: true }); root.gamePaused = true;
      const loaded = await api('/game-saves/' + slot + '/load', { runId: root.dungeonRunId, checksum });
      await restoreBrowser(loaded); return loaded;
    } catch (e) { if (!paused) console.warn('[GameLoad]', 'The game is paused after the interrupted load.'); throw e; }
    finally { working = false; }
  }
  async function refresh() {
    const data = await api('/game-saves'); rows.replaceChildren();
    for (const slot of data.slots) {
      const row = root.document.createElement('div'); row.className = 'save-slot';
      const label = root.document.createElement('input'); label.maxLength = 80; label.value = slot.label || ''; label.placeholder = 'Name this save'; label.setAttribute('aria-label', 'Save slot ' + slot.slot + ' name');
      const info = root.document.createElement('div'); info.textContent = slot.occupied ? slot.damaged ? 'Damaged save: ' + slot.error : `${slot.roomName} | Turn ${slot.turns} | ${new Date(slot.savedAt).toLocaleString()}` : 'Empty slot';
      const heading = root.document.createElement('strong'); heading.textContent = 'Slot ' + slot.slot;
      const saveButton = root.document.createElement('button'); saveButton.textContent = 'Save';
      const loadButton = root.document.createElement('button'); loadButton.textContent = 'Load'; loadButton.disabled = !slot.occupied || slot.damaged || !data.canLoad;
      saveButton.onclick = async () => {
        if (slot.occupied && !root.confirm('Replace save slot ' + slot.slot + '? The previous version will be kept as a backup.')) return;
        try { status.textContent = 'Saving both halves of the adventure...';
          await save(slot.slot, label.value, { overwrite: slot.occupied, expectedChecksum: slot.checksum }); status.textContent = 'Saved and verified on disk. You can continue playing.'; await refresh();
        } catch (e) { status.textContent = 'Not saved: ' + e.message; }
      };
      loadButton.onclick = async () => {
        if (!root.confirm('Load slot ' + slot.slot + '? Unsaved progress will be replaced.')) return;
        try { status.textContent = 'Restoring the adventure and rebuilding this room...'; const result = await load(slot.slot, slot.checksum); status.textContent = result.warning || 'Loaded. The game is paused; press P when ready.'; }
        catch (e) { status.textContent = 'Load stopped: ' + e.message; }
      };
      row.append(heading, label, saveButton, loadButton, info); rows.appendChild(row);
    }
    if (data.liveBridge) status.textContent += ' Save support is live without restarting. Loading becomes available after a server restart.';
  }
  async function open() {
    init(); if (!panel) throw Error('Game menu is not ready.'); if (!panel.open) panel.showModal();
    try { status.textContent = 'Ten local save slots. Files stay on this machine.'; await refresh(); } catch (e) { status.textContent = e.message; }
  }
  function init() {
    if (panel || !root.document.getElementById('game-menu')) return;
    const button = root.document.createElement('button'); button.className = 'game-menu-button'; button.id = 'open-save-game-button'; button.textContent = 'Save / Load Game'; button.onclick = open;
    root.document.getElementById('game-menu').appendChild(button);
    panel = root.document.createElement('dialog'); panel.id = 'save-game-dialog'; panel.setAttribute('aria-label', 'Save and load adventure');
    const heading = root.document.createElement('h2'); heading.textContent = 'Your Adventures';
    const close = root.document.createElement('button'); close.textContent = 'Close'; close.onclick = () => panel.close();
    status = root.document.createElement('p'); status.setAttribute('role', 'status'); rows = root.document.createElement('div');
    panel.append(heading, close, status, rows); root.document.body.appendChild(panel);
    const style = root.document.createElement('style'); style.textContent = '#save-game-dialog{background:#171510;color:#ead5a6;border:2px solid #9b8556;border-radius:10px;padding:22px;width:min(850px,90vw);max-height:82vh;overflow:auto;font:17px Georgia,serif}#save-game-dialog::backdrop{background:#0009}#save-game-dialog h2{margin:0 0 12px}#save-game-dialog p{line-height:1.4}#save-game-dialog button,#save-game-dialog input{font:inherit;padding:7px;background:#33312b;color:#f5e4bb;border:1px solid #89764e;border-radius:4px}#save-game-dialog button{cursor:pointer}#save-game-dialog button:disabled{opacity:.4;cursor:default}.save-slot{display:grid;grid-template-columns:64px minmax(100px,1fr) auto auto;gap:8px;padding:12px 0;border-top:1px solid #665a41;align-items:center}.save-slot div{grid-column:2 / -1;font-size:13px;color:#c8bfae}.save-slot input{min-width:0}@media(max-width:500px){.save-slot{grid-template-columns:54px minmax(65px,1fr) auto auto;font-size:14px}}';
    root.document.head.appendChild(style);
    for (const name of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click', 'wheel']) panel.addEventListener(name, e => e.stopPropagation());
    panel.addEventListener('cancel', e => { if (working) e.preventDefault(); });
  }
  root.HolodekSaveGame = { open, save, load, capture, restoreBrowser, repairPresentation, version: 4 };
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init); else init();
})(window);
