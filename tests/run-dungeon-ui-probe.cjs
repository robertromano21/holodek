const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const continuedDialogue = require('./fixtures/continued-dialogue.cjs');
const zharokDialogue = require('./fixtures/zharok-dialogue.cjs');
const index = fs.readFileSync(path.join(root, 'assets/index.html'), 'utf8');
const css = [...index.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const menu = index.slice(index.indexOf('<button id="game-menu-toggle"'), index.indexOf('<!-- Music control button'));
const consoleToggle = index.slice(index.indexOf('function togglePopup()'), index.indexOf('function toggleDungeonPopup()'));
const logToggle = index.slice(index.indexOf('function toggleGameLogPopup()'), index.indexOf('function togglePartyPopup()'));
const inventoryStart = index.indexOf('<button id="dungeon-inventory-shortcut"');
const inventoryMarkup = index.slice(inventoryStart, index.indexOf('</section>', inventoryStart) + '</section>'.length);
const game = fs.readFileSync(path.join(root, 'assets/game.js'), 'utf8');
const actionStart = game.indexOf('// Add event listener to clickable objects inside contentDiv');
const actionHandlers = game.slice(actionStart, game.indexOf('// ---- Exit click handler', actionStart));
const equipmentFunctions = game.slice(game.indexOf('function equipItem('), game.indexOf('function rollDice(', game.indexOf('function equipItem(')));
const dialogueLogHook = game.slice(game.indexOf('window.appendDungeonDialogueLog ='), game.indexOf('// Function to create Mortacia character and add her to npcsString'));
const dungeonCacheFunctions = game.slice(game.indexOf('const DUNGEON_DB_NAME'), game.indexOf('let pendingLodPersist'));
const monsterRenderStart = game.indexOf('        let monstersHtml =');
const monsterRendering = game.slice(monsterRenderStart, game.indexOf('// Combine all data into a single string for display', monsterRenderStart));
const monsterSectionStart = game.indexOf('Monsters in Room:', monsterRenderStart);
const monsterSection = game.slice(monsterSectionStart, game.indexOf('Puzzle: ${puzzle.inRoom}', monsterSectionStart));
const consoleStateRefresh = game.slice(game.indexOf('window.refreshDungeonConsoleStates ='), game.indexOf('window.onDungeonPause ='));
const recentHistoryFunctions = game.slice(game.indexOf('function getRecentPromptsAndResponsesForConversation('), game.indexOf('var previousResponse ='));
const scripts = ['renderSceneItems', 'sceneObjectSync', 'partyRoster', 'dungeonCartography', 'landmarkCatalog', 'areaTitleUi', 'compassUi', 'explorationMapUi', 'inventoryUi', 'itemInteractionUi', 'mapShortcutUi', 'gameMenuUi', 'characterProfiles', 'dialogueAudience', 'dungeonInhabitants', 'campaignMemory', 'campaignMemoryUi', 'dialogueHistory', 'dungeonLifeUi', 'outdoorDiscovery'];
const page = String.raw`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
${scripts.map(name => `<script src="/assets/${name}.js"></script>`).join('')}
</head><body>${menu}<button id="play-music-btn" style="display:none">Play Music</button>
<div id="phaser-popup"><div id="phaser-header">Game Console</div><div id="phaser-container">Fixture room</div></div>
<div id="combat-popup"><div id="combat-header">Combat Map</div></div>
<div id="game-log-popup"><div id="game-log-header">Game Log</div></div>
<div id="chatbotcontainer"><p><textarea id="chatuserinput" placeholder="Type a command"></textarea></p><button>Command</button></div>
<button id="dungeon-map-shortcut" aria-controls="exploration-map-popup"><img src="/assets/adventurers-map.svg" alt=""></button>
${inventoryMarkup}
<div id="party-icon-dock"><div data-party-slot="0"><button class="party-icon-button" onclick="openPartySheet(0)">Mortacia</button></div><div data-party-slot="1"><button class="party-icon-button" onclick="openPartySheet(1)">Zarthul</button></div></div>
<div id="chatlog" hidden></div><pre id="results"></pre><script>
const probeFetch = window.fetch.bind(window);
function syncGameLogTranscript() {}
${consoleToggle}
${logToggle}
const makeCharacter = (Name, type) => ({ Name, type, HP: 20, MaxHP: 20, Attack: 0, Damage: 0, Armor: 0, Magic: 0,
  Equipped: { Weapon: null, Armor: null, Shield: null, Other: null } });
let characters = [makeCharacter('Mortacia', 'pc')], npcs = [makeCharacter('Zarthul the Veiled Sentinel', 'npc')];
const stock = [
  { name: 'bronze sword', type: 'weapon', attack_modifier: 1, damage_modifier: 2, ac: 0, magic: 0 },
  { name: 'iron sword', type: 'weapon', attack_modifier: 3, damage_modifier: 4, ac: 0, magic: 0 },
  { name: 'moon mail', type: 'armor', attack_modifier: 0, damage_modifier: 0, ac: 3, magic: 0 },
  { name: 'round shield', type: 'shield', attack_modifier: 0, damage_modifier: 0, ac: 2, magic: 0 },
  { name: 'silver amulet', type: 'other', attack_modifier: 0, damage_modifier: 0, ac: 0, magic: 2 },
  { name: 'silver dagger', type: 'weapon', attack_modifier: 1, damage_modifier: 1, ac: 0, magic: 0 }
];
let inventory = stock.slice(0, 5).map(item => item.name), inventoryProperties = stock.slice(0, 5).map(item => JSON.stringify(item));
let pc = '', npcText = '', roomItems = ['silver dagger'], pickupDungeon, sheetClicks = 0;
let db, currentDungeon;
let currentCoordinates = { x: 0, y: 0, z: 0 };
const roomConversationHistories = {};
const coordinatesToString = c => 'X: ' + c.x + ', Y: ' + c.y + ', Z: ' + c.z;
${recentHistoryFunctions}
let playerPosX = 32.5, playerPosY = 32.5;
const characterState = (actor, type = 'monster', fallback = 'Neutral') => DungeonInhabitants.state({ ...actor, type }, fallback);
${dungeonCacheFunctions}
${dialogueLogHook}
${consoleStateRefresh}
const commands = [], contentDiv = document.getElementById('phaser-container');
const renderMonsterSection = new Function('monsters', 'monstersState', 'escapedText', ${JSON.stringify(monsterRendering + '\nreturn `' + monsterSection + '`;')});
function sheet(character) { return [character.Name, 'Female', 'Human', 'Adventurer', 'Level: 1', 'AC: 10', 'XP: 0',
  'HP: ' + character.HP, 'MaxHP: ' + character.MaxHP, 'Equipped: ' + Object.entries(character.Equipped).map(([slot, item]) => slot + ': ' + (item?.name || 'None')).join(', '),
  'Attack: ' + character.Attack, 'Damage: ' + character.Damage, 'Armor: ' + character.Armor, 'Magic: ' + character.Magic].join('\n'); }
window.getPartyInfoEntries = () => [...characters, ...npcs].map(source => ({ label: source.Name, source: { ...source, sheet: sheet(source) } }));
function openPartySheet() { sheetClicks++; }
function refreshFixture() {
  pc = sheet(characters[0]); npcText = npcs.map(sheet).join('\n');
  contentDiv.replaceChildren();
  for (const [names, className, attribute] of [[inventory, 'clickable-inventory', 'data-object'], [roomItems, 'clickable-object', 'data-object']]) {
    for (const name of names) { const link = document.createElement('span'); link.className = className; link.setAttribute(attribute, name); link.textContent = name; contentDiv.appendChild(link); }
  }
  for (const character of [...characters, ...npcs]) for (const item of Object.values(character.Equipped).filter(Boolean)) {
    const link = document.createElement('span'); link.className = 'clickable-equipped'; link.dataset.item = item.name; link.dataset.character = character.Name; link.textContent = item.name; contentDiv.appendChild(link);
  }
  InventoryUi.update({ inventory: inventory.join(', ') || 'Empty', inventoryProperties: inventoryProperties.join(', ') || 'None', pc, npcs: npcText });
  if (pickupDungeon) SceneObjectSync.sync(pickupDungeon, 'Coordinates: X: 0, Y: 0, Z: 0\nObjects in Room: ' + (roomItems.join(', ') || 'None') + '\nObjects in Room Properties: ' + JSON.stringify(stock[5]));
}
${equipmentFunctions}
async function chatbotprocessinput() {
  const input = document.getElementById('chatuserinput').value; commands.push(input);
  if (input.startsWith('unequip ')) { const parts = input.slice(8).split(' from '); unequipItem(parts[0], parts[1] || null); }
  else if (input.startsWith('equip ')) { const parts = input.slice(6).split(' to '); equipItem(parts[0], parts[1] || null); }
  else if (input === 'take silver dagger') { roomItems = []; inventory.push(stock[5].name); inventoryProperties.push(JSON.stringify(stock[5])); }
  await Promise.resolve(); refreshFixture();
}
function bindOriginalActions() { const npcs = npcText; ${actionHandlers} }
window.addEventListener('DOMContentLoaded', async () => {
  const checks = {}, errors = [];
  const checkpoint = stage => { document.getElementById('results').textContent=JSON.stringify({ pass:false,stage,checks,errors }); };
  window.addEventListener('error', e => errors.push(e.message));
  try {
    checkpoint('initializing');
    window.dungeonRunId = 'ui-probe'; window.playerAngle = -Math.PI / 2;
    const d = { geoKey: '0,0,0', _meta: { runId: 'ui-probe' }, layout: { width: 64, height: 64 },
      start: { x: 32, y: 32 }, cells: {}, classification: { indoor: false }, sceneSpec: { source: { roomName: 'UI probe' } },
      roomExits: { markers: [{ direction: 'west', label: 'W', x: 45, y: 32 }, { direction: 'up', label: 'UP', x: 32, y: 15 }] } };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) d.cells[x + ',' + y] = { tile: 'floor', floorHeight: 0 };
    const player = { x: 32.5, y: 32.5 };
    const actors = [{ name: 'Mortacia', type: 'pc', hp: 20, mazeX: 32, mazeY: 32, mazeRoomKey: '0,0,0' },
      { name: 'Zarthul', type: 'npc', hp: 20, mazeX: 32, mazeY: 30, mazeRoomKey: '0,0,0' }];
    window.getDungeonLifeContext = () => ({ dungeon: d, actors, player, busy: true });
    currentDungeon = d;
    document.getElementById('phaser-popup').style.display = 'block';
    contentDiv.dataset.consoleGeoKey = d.geoKey;
    const residentSheets = Array.from({ length: 20 }, (_, i) => sheet(makeCharacter('Resident ' + i, 'monster')) + '\nState: Neutral').join('\n');
    const canonicalResidents = 'Coordinates: X: 0, Y: 0, Z: 0\nMonsters in Room:\n' + residentSheets + '\nMonsters Equipped Properties: None\nMonsters State: Neutral\nRooms Visited: 1';
    const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const renderResidents = value => {
      contentDiv.innerHTML = renderMonsterSection(value, 'Neutral', escapeHtml) + '<span id="monster-section-end">Puzzle: None</span>';
      window.refreshDungeonConsoleStates();
    };
    const sectionEnd = () => document.getElementById('monster-section-end').getBoundingClientRect().top;
    renderResidents('None');
    const emptyEnd = sectionEnd();
    checks.emptyRosterHasSingleNone = contentDiv.innerText.match(/\bNone\b/g)?.length === 2;
    currentDungeon = undefined;
    window.refreshDungeonConsoleStates();
    checks.emptyRosterStaysCompactBeforeDungeonLoads = !document.getElementById('nearby-monsters-none').hidden &&
      Math.abs(sectionEnd() - emptyEnd) < 1;
    currentDungeon = d;
    const residents = Array.from({ length: 20 }, (_, i) => ({ name: 'Resident ' + i, type: 'monster', hp: 20, state: 'Neutral',
      mazeRoomKey: d.geoKey, mazeX: 60, mazeY: 60 }));
    actors.push(...residents); window.combatCharacters = actors;
    renderResidents(residentSheets);
    checks.hiddenResidentsLeaveNoBlankLines = Math.abs(sectionEnd() - emptyEnd) < 1;
    checks.hiddenResidentsKeepFullSheets = contentDiv.querySelectorAll('[data-monster-name][hidden]').length === 20 &&
      DungeonInhabitants.parseSheets(canonicalResidents).length === 20;
    residents[9].mazeX = 33; residents[9].mazeY = 32;
    window.refreshDungeonConsoleStates();
    const oneVisibleEnd = sectionEnd();
    checks.nearbyResidentKeepsSheetOrder = contentDiv.querySelectorAll('[data-monster-name]:not([hidden])').length === 1 &&
      contentDiv.querySelector('[data-monster-name="Resident 9"]').innerText.split('\n').join('|') === residentSheets.split('\n').slice(9 * 15, 10 * 15).join('|') &&
      document.getElementById('nearby-monsters-none').hidden;
    residents[10].mazeX = 34; residents[10].mazeY = 32;
    window.refreshDungeonConsoleStates();
    checks.multipleNearbyResidentsKeepSeparateSheets = [...contentDiv.querySelectorAll('[data-monster-name]:not([hidden])')]
      .map(block => block.dataset.monsterName).join('|') === 'Resident 9|Resident 10';
    residents[10].mazeX = 60; residents[10].mazeY = 60;
    window.refreshDungeonConsoleStates();
    for (let i = 0; i < 5; i++) {
      residents[9].mazeX = 60; residents[9].mazeY = 60; window.refreshDungeonConsoleStates();
      checks.leavingResidentsRestoresCompactSection = Math.abs(sectionEnd() - emptyEnd) < 1;
      residents[9].mazeX = 33; residents[9].mazeY = 32; window.refreshDungeonConsoleStates();
      checks.repeatedDiscoveryDoesNotGrowSpacing = Math.abs(sectionEnd() - oneVisibleEnd) < 1 && contentDiv.querySelectorAll('[data-monster-name]').length === 20;
    }
    contentDiv.replaceChildren(); actors.splice(actors.length - residents.length, residents.length);
    const legacyCache = await new Promise((resolve, reject) => {
      const request = indexedDB.open('cotg-dungeons', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('rooms');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = legacyCache.transaction('rooms', 'readwrite');
      tx.objectStore('rooms').put(d, 'ui-probe:0,0,0');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    legacyCache.close();
    const migrated = await idbGetDungeon('0,0,0');
    checks.cacheUpgradePreservesGeometry = migrated.cells['32,32'].tile === 'floor' && (await openDungeonDB()).version === 2;
    const population = DungeonInhabitants.createPopulation('0,0,0', [{name:'Far Mason',allegiance:'Neutral'},{name:'Fallen Guard',allegiance:'Hostile'}], {indoor:false});
    population.actors['Far Mason'].position = {x:56,y:56}; population.actors['Fallen Guard'].position = {x:45,y:45};
    DungeonInhabitants.sync(population, [{name:'Far Mason',hp:20,state:'Neutral'},{name:'Fallen Guard',hp:0}]);
    let geometryWrites = 0;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'rooms') geometryWrites++; return originalPut.apply(this,args); };
    for (let i=0;i<3;i++) { population.revision++; await idbSetPopulation(population); }
    IDBObjectStore.prototype.put = originalPut;
    const revisited = await idbGetDungeon('0,0,0');
    checks.populationWritesDoNotRewriteGeometry = geometryWrites === 0 && JSON.stringify(revisited.cells) === JSON.stringify(d.cells);
    checks.populationRevisitKeepsDistantAndDead = revisited.inhabitants.actors['Far Mason'].position.x === 56 && revisited.inhabitants.actors['Fallen Guard'].state === 'Dead';
    window.dungeonRunId = 'other-run';
    checks.populationCacheIsRunScoped = await idbGetDungeon('0,0,0') === null;
    await idbSetPopulation({...population,geoKey:'2,0,0'});
    window.dungeonRunId = 'ui-probe';
    await discardPreviousDungeonRuns('ui-probe');
    const cache = await openDungeonDB();
    const removed = await new Promise((resolve,reject) => {
      const read=cache.transaction('inhabitants').objectStore('inhabitants').get('other-run:2,0,0');
      read.onsuccess=()=>resolve(read.result); read.onerror=()=>reject(read.error);
    });
    checks.populationCleanupKeepsCurrentRun = removed === undefined && (await idbGetDungeon('0,0,0')).inhabitants.actors['Far Mason'].state === 'Neutral';
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dialogue-probe', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('conversation', { keyPath: 'id', autoIncrement: true }).createIndex('conversationId', 'conversationId');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    checkpoint('history-open');
    localStorage.setItem('conversationId', 'dialogue-probe');
    const canonical = 'Coordinates: X: 0, Y: 0, Z: 0\nObjects in Room: silver dagger\nExits: west, up';
    await new Promise((resolve, reject) => {
      const tx = db.transaction('conversation', 'readwrite');
      tx.objectStore('conversation').add({ conversationId: 'dialogue-probe', prompt: 'look', response: 'A dagger waits. The old inscription says violet heron.', gameConsole: canonical });
      tx.objectStore('conversation').add({ conversationId: 'another-game', kind: 'ambient-dialogue', dialogue: [], gameConsole: '' });
      for(let i=0;i<300;i++)tx.objectStore('conversation').add({conversationId:'dialogue-probe',prompt:'Older command '+i,response:'An older turn.',gameConsole:canonical});
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    let scans=0;
    const originalCursor=IDBIndex.prototype.openCursor;
    IDBIndex.prototype.openCursor=function(...args){scans++;return originalCursor.apply(this,args);};
    for (let i=0; i<12; i++) await DungeonDialogueHistory.append(db,{conversationId:'dialogue-probe',geoKey:d.geoKey,speaker:'Zarthul',line:'Memory '+i});
    await Promise.all(Array.from({length:4},(_,i)=>DungeonDialogueHistory.append(db,{conversationId:'dialogue-probe',geoKey:d.geoKey,speaker:'Zarthul',line:'Concurrent '+i})));
    await window.appendDungeonDialogueLog('Zarthul','I still remember your promise.');
    checks.ambientHistoryScannedOnce=scans===1;
    IDBIndex.prototype.openCursor=originalCursor;
    const stored = await new Promise((resolve,reject) => {
      const request=db.transaction('conversation').objectStore('conversation').getAll(); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
    });
    checks.ambientHistoryPreservesConsole = stored.find(row=>row.prompt==='look')?.gameConsole===canonical && stored.some(row=>row.conversationId==='another-game');
    const ambient=stored.filter(row=>row.conversationId==='dialogue-probe'&&row.kind==='ambient-dialogue');
    checks.ambientHistoryBounded = ambient.length===1 && ambient[0].dialogue.length===6 && ambient[0].gameConsole==='';
    checks.ambientSpeechStored = ambient[0].response.includes('I still remember your promise.') && document.getElementById('chatlog').textContent.includes('I still remember your promise.');
    checks.concurrentSpeechPreserved=Array.from({length:4},(_,i)=>'Concurrent '+i).every(line=>ambient[0].response.includes(line));
    const recent = await getRecentPromptsAndResponsesForConversation('dialogue-probe');
    checks.recentHistoryReadsFifteen = recent.length === 15 && recent[0].prompt === 'Older command 286' && recent.at(-1).kind === 'ambient-dialogue';
    const recallPosts = [];
    window.fetch = async (url, options) => {
      if (url === '/campaign-memory/recall') { recallPosts.push(JSON.parse(options.body)); return { ok: true }; }
      return probeFetch(url, options);
    };
    const bounded = await performDynamicSearch('remember the promise');
    checks.recentHistoryWordBudget = (bounded.match(/\S+/g) || []).length <= 700 && bounded.length <= 8400;
    checks.recentHistoryKeepsDialogue = bounded.includes('I still remember your promise.') && !bounded.includes('Objects in Room:');
    const oldRecall = await DungeonCampaignMemory.search('violet heron', d.geoKey);
    checks.memoryRecallsOlderThanRecentWindow = oldRecall.some(row => row.text.includes('violet heron')) && !bounded.includes('violet heron');
    checks.memoryImportsAmbientWithoutConsole = recallPosts.some(post => post.records.some(row => row.speaker === 'Zarthul' && row.text.includes('remember your promise')));
    checks.memoryTransportBounded = recallPosts.length > 0 && recallPosts.every(post => post.records.length <= 6 && JSON.stringify(post.records).length <= 4800 && post.runId === 'ui-probe');
    const verifiedMemory = { id: 'verified-gate', runId: 'ui-probe', roomKey: d.geoKey, kind: 'quest', authority: 'state',
      text: 'The vermilion gate is still locked.', source: 'committed-game-state', witnesses: ['Mortacia'] };
    await DungeonCampaignMemory.receive({ runId: 'ui-probe', records: [verifiedMemory] });
    await DungeonCampaignMemory.receive({ runId: 'ui-probe', records: [{ ...verifiedMemory, authority: 'reported', text: 'The vermilion gate is open.' }] });
    const memoryDb = await new Promise((resolve, reject) => { const request = indexedDB.open('DungeonCampaignMemories', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const savedMemory = await new Promise((resolve, reject) => { const request = memoryDb.transaction('records').objectStore('records').get('ui-probe:verified-gate');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    checks.memoryArchiveKeepsStrongerEvidence = savedMemory?.text === verifiedMemory.text && savedMemory.authority === 'state';
    memoryDb.close();
    window.dungeonRunId = 'memory-other-run'; DungeonCampaignMemory.begin(window.dungeonRunId);
    checks.memoryBrowserRunsSeparated = (await DungeonCampaignMemory.search('violet heron', d.geoKey)).length === 0;
    await DungeonCampaignMemory.rememberRoomTurn({ runId: 'ui-probe', geoKey: d.geoKey, response: 'A stale session reply.', conversationId: 'dialogue-probe' });
    checks.staleMemoryReplyCannotSwitchCampaign = DungeonCampaignMemory.begin(window.dungeonRunId).runId === 'memory-other-run';
    window.dungeonRunId = 'ui-probe'; DungeonCampaignMemory.begin(window.dungeonRunId);
    checks.memorySurvivesReopen = (await DungeonCampaignMemory.search('violet heron', d.geoKey)).some(row => row.text.includes('violet heron'));
    roomConversationHistories['X: 3, Y: 0, Z: 0'] = [{ runId: 'memory-other-run', roomHistory: 'An unrelated cobalt wyvern.', roomName: 'Other campaign' },
      { runId: 'ui-probe', roomHistory: 'A scarlet phoenix adorns the shrine.', roomName: 'Shrine' }];
    await DungeonCampaignMemory.prepare('scarlet phoenix', { db, conversationId: 'dialogue-probe', roomHistories: roomConversationHistories });
    checks.memoryImportsNativeRoomHistory = (await DungeonCampaignMemory.search('scarlet phoenix', '3,0,0')).some(row => row.roomName === 'Shrine');
    checks.memoryIgnoresRoomHistoryFromOtherRun = (await DungeonCampaignMemory.search('cobalt wyvern', '3,0,0')).length === 0;
    window.dungeonRunId = 'memory-cold-run'; DungeonCampaignMemory.begin(window.dungeonRunId);
    const coldMemory = { ...verifiedMemory, id: '000-old-location', runId: window.dungeonRunId, text: 'The saffron griffin guards a ruined bridge.' };
    const largeArchive = [coldMemory, ...Array.from({ length: CampaignMemory.MAX_RECORDS + 1 }, (_, i) => ({ ...coldMemory,
      id: 'wall-' + i, text: 'An ordinary wall marking numbered ' + i + '.', authority: 'reported' }))];
    await DungeonCampaignMemory.receive({ runId: window.dungeonRunId, records: largeArchive });
    checks.memoryHotIndexBounded = DungeonCampaignMemory.begin(window.dungeonRunId).index.size() === CampaignMemory.MAX_RECORDS &&
      DungeonCampaignMemory.begin(window.dungeonRunId).index.get(coldMemory.id) === null;
    checks.memoryColdArchiveStillSearchable = (await DungeonCampaignMemory.search('saffron griffin', d.geoKey)).some(row => row.id === coldMemory.id);
    await DungeonCampaignMemory.receive({ runId: window.dungeonRunId, records: [{ ...coldMemory, authority: 'reported', text: 'The saffron griffin is already defeated.' }] });
    checks.memoryColdArchiveCannotDowngradeEvidence = (await DungeonCampaignMemory.search('saffron griffin', d.geoKey)).some(row => row.text === coldMemory.text && row.authority === 'state');
    await DungeonCampaignMemory.prepare('violet heron', { db, conversationId: 'dialogue-probe', roomHistories: roomConversationHistories });
    checks.memoryLegacyHistoryAdoptedOnce = (await DungeonCampaignMemory.search('violet heron', d.geoKey)).length === 0;
    window.dungeonRunId = 'ui-probe'; DungeonCampaignMemory.begin(window.dungeonRunId);
    checks.memoryDidNotAlterRoomGeometry = JSON.stringify((await idbGetDungeon(d.geoKey)).cells) === JSON.stringify(d.cells);
    checkpoint('history-verified');
    let pauseCalls = 0, focused = '';
    const recoveryPosts = [];
    window.focusDungeonSpeaker = name => { focused = name; };
    window.fetch = async (url, options) => {
      if (url === '/game/pause') { pauseCalls++; return { ok: true, json: async () => ({ paused: JSON.parse(options.body).paused, runId: 'ui-probe' }) }; }
      if (url === '/updateState7') recoveryPosts.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({}) };
    };
    DungeonLife.receiveDialogue({ geoKey: '0,0,0', runId: 'ui-probe', dialogue: [{ speaker: 'Zarthul', line: 'The old masons left a passage here.' }] });
    DungeonLife.tick();
    checks.characterSubtitles = !document.getElementById('dungeon-dialogue').hidden && document.getElementById('dungeon-dialogue-caption').textContent.includes('Zarthul') && focused === 'Zarthul';
    const displayedSubtitle = DungeonLife.subtitleDiagnostics().find(row => row.stage === 'displayed');
    checks.subtitleLogMatchesVisibleText = displayedSubtitle?.speaker === 'Zarthul' &&
      displayedSubtitle.line === document.getElementById('dungeon-dialogue-words').textContent;
    const speech = document.getElementById('dungeon-dialogue').getBoundingClientRect();
    const inputBounds = document.getElementById('chatuserinput').getBoundingClientRect();
    checks.dialogueAboveInput = speech.bottom < inputBounds.top && speech.left >= 0 && speech.right <= innerWidth;
    document.getElementById('chatuserinput').focus();
    document.getElementById('chatuserinput').dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 5));
    checks.typingPDoesNotPause = pauseCalls === 0 && !window.gamePaused;
    document.getElementById('chatuserinput').blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 5));
    checks.pPauses = window.gamePaused && !document.getElementById('dungeon-pause-status').hidden && document.getElementById('pause-game-button').getAttribute('aria-pressed') === 'true';
    document.getElementById('pause-game-button').click(); await new Promise(resolve => setTimeout(resolve, 5));
    checks.menuResumes = !window.gamePaused && document.getElementById('dungeon-pause-status').hidden;
    DungeonLife.reset();
    const delayed = {name:'Late Mason',type:'monster',hp:20,mazeX:33,mazeY:32,mazeRoomKey:'0,0,0'};
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[{speaker:'Late Mason',line:'I waited for you by the arch.'}]});
    actors.push(delayed); DungeonLife.tick();
    checks.earlySpeechSurvivesRosterInitialization=document.getElementById('dungeon-dialogue-words').textContent==='I waited for you by the arch.';
    DungeonLife.reset();
    const turnText='NPCs in Party: Zarthul\nMale\nWraith\nGuard\nLevel: 1\nAC: 10\nXP: 0\nHP: 20\nMaxHP: 20\nEquipped: None\nAttack: 1\nDamage: 1\nArmor: 0\nMagic: 0\nState: Friendly\nMonsters in Room: None';
    DungeonLife.receiveTurnDialogue('Zarthul says, "Stay close to the lantern."',{consoleText:turnText,geoKey:'0,0,0',runId:'ui-probe'});DungeonLife.tick();
    checks.ordinaryTurnDialogueBecomesSubtitles=document.getElementById('dungeon-dialogue-words').textContent==='Stay close to the lantern.';
    DungeonLife.reset();
    const proseQuote = 'Zarthul\u2019s eyes narrow, his voice a low murmur, \u201cThe path ahead is full of shadows.\u201d';
    const ordinarySpeech = { speaker: 'Zarthul', line: 'The path ahead is full of shadows.' };
    DungeonLife.receiveTurnDialogue(proseQuote, { consoleText: turnText, geoKey: d.geoKey, runId: 'ui-probe', dialogue: [] });
    DungeonLife.tick();
    checks.naturalTurnProseBecomesSubtitles = document.getElementById('dungeon-dialogue-words').textContent === ordinarySpeech.line;
    DungeonLife.reset();
    let subtitleCount = 0;
    const info = console.info;
    console.info = (...args) => { if (args[0] === '[DialogueSubtitle]') subtitleCount++; info.apply(console, args); };
    DungeonLife.receiveDialogue({ dialogue: [ordinarySpeech], geoKey: d.geoKey, runId: 'ui-probe' });
    DungeonLife.receiveTurnDialogue(proseQuote, { consoleText: turnText, geoKey: d.geoKey, runId: 'ui-probe', dialogue: [ordinarySpeech] });
    DungeonLife.tick(); console.info = info;
    checks.serverAndCommandSpeechDeliveredOnce = subtitleCount === 1 && document.getElementById('dungeon-dialogue-words').textContent === ordinarySpeech.line;
    checks.subtitleLoggingSeparatesDuplicates = DungeonLife.subtitleDiagnostics().filter(row => row.stage === 'displayed').length === 1 &&
      DungeonLife.subtitleDiagnostics().some(row => row.stage === 'duplicate');
    DungeonLife.reset();
    const fullSpeech = Array.from({ length: 12 }, (_, i) => 'Warning ' + i + ': keep close to the old temple walls and listen for the sound of moving stone.').join(' ');
    const loggedSpeeches = ${JSON.stringify({ loggedSpeech: continuedDialogue, zharokSpeech: zharokDialogue })};
    const speechCards = DungeonInhabitants.splitSpeech(fullSpeech), originalNow = Date.now;
    let subtitleClock = originalNow();
    try {
      Date.now = () => subtitleClock;
      DungeonLife.receiveTurnDialogue('Zarthul says, "' + fullSpeech + '"', { consoleText: turnText, geoKey: d.geoKey, runId: 'ui-probe' });
      DungeonLife.tick();
      checks.fullSpeechCardsReadable = true;
      for (let i = 0; i < speechCards.length; i++) {
        const card = document.getElementById('dungeon-dialogue-words'), bounds = document.getElementById('dungeon-dialogue').getBoundingClientRect();
        checks.fullSpeechCardsReadable &&= card.textContent === speechCards[i] &&
          !/\[\d+\/\d+\]/.test(document.getElementById('dungeon-dialogue-caption').textContent) && /[.!?]$/.test(card.textContent) &&
          card.scrollWidth <= card.clientWidth + 1 && bounds.top >= 0 && bounds.bottom < document.getElementById('chatbotcontainer').getBoundingClientRect().top;
        subtitleClock += 20000; DungeonLife.tick();
      }
      checks.fullSpeechReachesFinalCard = DungeonLife.subtitleDiagnostics().filter(row => row.stage === 'displayed').map(row => row.line).join(' ') === fullSpeech;
      DungeonLife.reset();
      const nativePlain = 'A familiar voice breaks the silence.\n\n"' + fullSpeech + '"\n\nThe lantern gutters.';
      const nativeResult = DungeonInhabitants.extractDialogue(nativePlain.replace(fullSpeech,
        '[[SPEECH:"Zarthul"]]' + fullSpeech + '[[/SPEECH]]'), ['Zarthul']);
      checks.nativeLabelsPreserveNarrative = nativeResult.content === nativePlain && nativeResult.dialogue[0].attribution === 'labelled';
      DungeonLife.receiveDialogue({ geoKey: d.geoKey, runId: 'ui-probe', dialogue: nativeResult.dialogue });
      DungeonLife.receiveTurnDialogue(nativeResult.content, { consoleText: turnText, geoKey: d.geoKey, runId: 'ui-probe', dialogue: nativeResult.dialogue });
      checks.nativeSpeechWithoutVisibleName = true;
      for (const text of speechCards) {
        checks.nativeSpeechWithoutVisibleName &&= document.getElementById('dungeon-dialogue-words').textContent === text &&
          document.getElementById('dungeon-dialogue-caption').textContent === 'Zarthul';
        subtitleClock += 20000; DungeonLife.tick();
      }
      checks.nativeSubtitleDeliveredOnce = DungeonLife.subtitleDiagnostics().filter(row => row.stage === 'displayed').map(row => row.line).join(' ') === fullSpeech;
      for (const [label, loggedSpeech] of Object.entries(loggedSpeeches)) {
        DungeonLife.reset();
        const loggedActor = { name: loggedSpeech.speaker, type: 'monster', hp: 20, state: 'Neutral', mazeX: 33, mazeY: 32, mazeRoomKey: d.geoKey };
        actors.push(loggedActor);
        const loggedConsole = 'NPCs in Party: None\nMonsters in Room:\n' + sheet(makeCharacter(loggedActor.name, 'monster')) + '\nState: Neutral\nMonsters Equipped Properties: None';
        DungeonLife.receiveTurnDialogue(loggedSpeech.prose, { consoleText: loggedConsole, geoKey: d.geoKey, runId: 'ui-probe',
          dialogue: [{ speaker: loggedActor.name, line: loggedSpeech.fragment || loggedSpeech.passages[0] }] });
        const loggedCards = DungeonInhabitants.splitSpeech(loggedSpeech.speech);
        checks[label + 'StartsImmediately'] = document.getElementById('dungeon-dialogue-words').textContent === loggedCards[0];
        checks[label + 'IsContinuous'] = true;
        for (const text of loggedCards) {
          const card = document.getElementById('dungeon-dialogue-words'), bounds = document.getElementById('dungeon-dialogue').getBoundingClientRect();
          checks[label + 'IsContinuous'] &&= !document.getElementById('dungeon-dialogue').hidden && card.textContent === text &&
            /[.!?]$/.test(card.textContent) && document.getElementById('dungeon-dialogue-caption').textContent === loggedActor.name &&
            card.scrollWidth <= card.clientWidth + 1 && bounds.top >= 0 && bounds.bottom < document.getElementById('chatbotcontainer').getBoundingClientRect().top;
          subtitleClock += 20000; DungeonLife.tick();
        }
        checks[label + 'ReachesLastSentence'] = DungeonLife.subtitleDiagnostics().filter(row => row.stage === 'displayed').map(row => row.line).join(' ') === loggedSpeech.speech;
        actors.splice(actors.indexOf(loggedActor), 1);
      }
    } finally { Date.now = originalNow; DungeonLife.reset(); }
    DungeonLife.reset();
    actors.splice(actors.indexOf(delayed),1);
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[
      {speaker:'Late Mason',line:'First, mind the broken step.'},{speaker:'Late Mason',line:'Then, follow the lanterns.'}]});
    actors.push(delayed); DungeonLife.tick();
    checks.delayedSpeechKeepsOrder = document.getElementById('dungeon-dialogue-words').textContent === 'First, mind the broken step.';
    DungeonLife.reset();
    delayed.state='Dead';
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[{speaker:'Late Mason',line:'A corpse must not speak.'}]});
    DungeonLife.tick();
    checks.deadStateCannotSpeak = document.getElementById('dungeon-dialogue').hidden;
    delete delayed.state;
    DungeonLife.reset();
    delayed.mazeX=36;
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[{speaker:'Late Mason',line:'I must not speak from four tiles away.',kind:'canned'}]});
    DungeonLife.tick();
    checks.distantResidentCannotStartSubtitle=document.getElementById('dungeon-dialogue').hidden;
    checks.subtitleDistanceRejectionLogged = DungeonLife.subtitleDiagnostics().some(row => row.stage === 'skipped' && row.reason === 'out-of-range');
    DungeonLife.reset();
    delayed.mazeX=35;
    window.getPartyEntryRenderMazePosition=actor=>actor===delayed?{x:36,y:32}:null;
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[{speaker:'Late Mason',line:'My logical destination is close, but I am still walking.'}]});
    DungeonLife.tick();
    checks.renderedResidentMustBeClose=document.getElementById('dungeon-dialogue').hidden;
    window.getPartyEntryRenderMazePosition=actor=>actor===delayed?{x:34.75,y:32}:null;
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[{speaker:'Late Mason',line:'Now you are close enough to hear me.'}]});
    DungeonLife.tick();
    checks.closeResidentStartsSubtitle=!document.getElementById('dungeon-dialogue').hidden&&
      document.getElementById('dungeon-dialogue-words').textContent==='Now you are close enough to hear me.';
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[{speaker:'Late Mason',line:'This queued line must not follow the player away.'}]});
    player.x=28.5;
    DungeonLife.tick();
    checks.walkingAwayStopsResidentSubtitle=document.getElementById('dungeon-dialogue').hidden;
    DungeonLife.reset();player.x=32.5;delayed.mazeX=33;delete window.getPartyEntryRenderMazePosition;
    const repairConsole = 'Coordinates: X: 0, Y: 0, Z: 0\nPC:\n'+sheet({...characters[0],HP:-9})+'\nNPCs in Party:\n'+sheet({...npcs[0],HP:0})+'\nMonsters in Room: None\nMonsters Equipped Properties: None\nMonsters State: None';
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('conversation','readwrite');
      tx.objectStore('conversation').add({conversationId:'dialogue-probe',prompt:'last battle',response:'The party fell.',gameConsole:repairConsole});
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
    window.getPromptsAndResponsesForConversation = async id => new Promise((resolve,reject)=>{
      const request=db.transaction('conversation').objectStore('conversation').getAll();
      request.onsuccess=()=>resolve(request.result.filter(row=>row.conversationId===id));request.onerror=()=>reject(request.error);
    });
    window.combatCharacters=[...actors,{name:'Untouched Guard',type:'monster',hp:8,state:'Hostile'}];
    const recoveryButton=document.getElementById('revive-party-button');
    checks.recoveryMenuButtonPresent = document.getElementById('game-menu').contains(recoveryButton) && recoveryButton.classList.contains('game-menu-button');
    checks.recoveryDoesNotRunAutomatically = recoveryPosts.length===0 && !window.reviveDungeonParty;
    const waitForRecovery=async()=>{
      const until=Date.now()+3000;
      while(recoveryButton.disabled&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));
      if(recoveryButton.disabled)throw Error('Party recovery menu action timed out.');
    };
    GameMenuUi.setOpen(true);
    window.actionDiceState={active:{kind:'combat'}};
    recoveryButton.click();await waitForRecovery();
    checks.recoveryRefusesActiveCombat = recoveryPosts.length===0 && document.getElementById('party-recovery-status').textContent.includes('Finish the pending combat');
    window.actionDiceState=null;
    recoveryButton.click();recoveryButton.click();await waitForRecovery();
    checks.recoveryClickIsSingleAction = recoveryPosts.length===1;
    checks.recoveryReportsResult = document.getElementById('party-recovery-status').textContent==='Restored 2 party members to full HP.' && !document.getElementById('game-menu').hidden;
    const repaired=(await getPromptsAndResponsesForConversation('dialogue-probe')).filter(row=>row.gameConsole).at(-1);
    checks.recoveryImportUsesRealSavedSheets = typeof window.reviveDungeonParty==='function' && DungeonInhabitants.parseSheets(repaired.gameConsole,'PC')[0].hp===20 && DungeonInhabitants.parseSheets(repaired.gameConsole,'NPCs in Party')[0].hp===20;
    checks.recoveryKeepsResidentRoster = window.combatCharacters.find(a=>a.name==='Untouched Guard').hp===8 && window.combatCharacters.some(a=>a.name==='Zarthul the Veiled Sentinel'&&a.hp===20);
    GameMenuUi.setOpen(false);
    DungeonLife.reset();
    DungeonCompass.setNavigation(d, player); DungeonCompass.update(playerAngle);
    DungeonExplorationMap.update(d, player, playerAngle, dungeonRunId);
    GameMenuUi.onDungeonReady(d);
    const ids = ['phaser-popup', 'combat-popup', 'game-log-popup'];
    checks.autoOpened = ids.every(id => document.getElementById(id).style.display === 'block');
    const c = document.getElementById('dungeon-compass').getBoundingClientRect(), command = document.getElementById('chatbotcontainer').getBoundingClientRect();
    checks.compassOutsideInput = c.right < command.left || c.bottom < command.top;
    checks.exitPins = document.querySelectorAll('.compass-exit-pin').length === 2;
    checks.distance = document.querySelector('.compass-exit-readout').textContent.includes('13 tiles');
    const log = document.getElementById('game-log-popup').getBoundingClientRect();
    checks.logBottomRight = Math.abs(innerWidth - log.right - 8.75) < 2 && Math.abs(innerHeight - log.bottom - 8.75) < 2;
    const combat = document.getElementById('combat-popup').getBoundingClientRect();
    checks.combatTopLeft = Math.abs(combat.left - 8.75) < 2 && Math.abs(combat.top - 73.5) < 2;
    checks.menuInitiallyHidden = document.getElementById('game-menu').hidden;
    document.getElementById('game-menu-toggle').click();
    checks.menuOpened = !document.getElementById('game-menu').hidden;
    checks.movedControls = document.getElementById('game-menu').contains(document.getElementById('combat-mode-toggle'));
    document.getElementById('open-exploration-map-button').click();
    checks.mapOpenedMenuClosed = document.getElementById('exploration-map-popup').style.display === 'block' && document.getElementById('game-menu').hidden;
    const map = document.getElementById('exploration-map-popup').getBoundingClientRect();
    checks.mapFitsViewport = map.left >= 0 && map.right <= innerWidth && map.bottom <= innerHeight;
    checks.mapCentered = Math.abs((map.left + map.right) / 2 - innerWidth / 2) < 2;
    checks.mapAboveCommand = map.bottom < command.top;
    const mapPanel = document.getElementById('exploration-map-popup');
    checks.mapFullyVisible = mapPanel.scrollHeight <= mapPanel.clientHeight + 1;
    if (innerWidth >= 1000) {
      const consoleBounds = document.getElementById('phaser-popup').getBoundingClientRect();
      checks.mapBetweenSidePanels = map.left > combat.right && map.right < consoleBounds.left;
    }
    const pixel = document.getElementById('exploration-map-canvas').getContext('2d').getImageData(320, 320, 1, 1).data;
    checks.mapPainted = pixel[0] > 8;
    const encounterPopulation = DungeonInhabitants.createPopulation(d.geoKey, [
      { name: 'Undiscovered Carver', allegiance: 'Neutral', encounterId: 'carvers' },
      { name: 'Undiscovered Hound', allegiance: 'Hostile', encounterId: 'hounds' }]);
    encounterPopulation.actors['Undiscovered Carver'].position = { x: 56, y: 56 };
    encounterPopulation.actors['Undiscovered Hound'].position = { x: 12, y: 12 };
    d.sceneExteriors = { buildings: [{ targetName: 'Ruined Temple Entrance', doorway: { x: 56, y: 56 } }] };
    d.sceneGeography = { features: [{ name: "Devil's Mountain", role: 'mountain', center: { x: 12, y: 12 } }] };
    d.sceneLandmarks = [{ type: 'altar', label: 'Altar of Lost Names', x: 50, y: 12 }];
    DungeonLife.receivePopulation({ population: encounterPopulation, runId: 'ui-probe' });
    const encounterSelect = document.getElementById('exploration-map-landmarks');
    checks.mapListsOnlyKnownLandmarks = encounterSelect.options.length === 3 && encounterSelect.options[0].textContent === 'Landmarks (2)' &&
      encounterSelect.textContent.includes('Ruined Temple Entrance') && !encounterSelect.textContent.includes('Altar of Lost Names') &&
      !encounterSelect.textContent.includes('Undiscovered Carver') && !encounterSelect.textContent.includes('Undiscovered Hound');
    document.getElementById('exploration-map-whole').click();
    const mapContext = document.getElementById('exploration-map-canvas').getContext('2d');
    const markerPixel = mapContext.getImageData(569, 565, 1, 1).data;
    const unexploredPixel = mapContext.getImageData(500, 500, 1, 1).data;
    checks.knownLandmarkPinPainted = markerPixel[0] > 100 && markerPixel[1] > 80;
    checks.landmarkPinsDoNotRevealTerrain = unexploredPixel[0] === 8 && unexploredPixel[1] === 8;
    const landmarks = LandmarkCatalog.catalog(d);
    encounterSelect.value = landmarks[0].id; encounterSelect.dispatchEvent(new Event('change'));
    checks.landmarkSelectorGivesDistanceAndBearing = /Ruined Temple Entrance: 34 tiles SE/.test(document.getElementById('exploration-map-caption').textContent);
    checks.landmarkFocusFitsAbovePrompt = mapPanel.getBoundingClientRect().bottom < command.top && mapPanel.scrollHeight <= mapPanel.clientHeight + 1;
    DungeonExplorationMap.markLandmark(landmarks[2].id, true);
    checks.discoveredLandmarkGetsName = encounterSelect.options.length === 4 && encounterSelect.textContent.includes('Altar of Lost Names');
    const mapCanvas = document.getElementById('exploration-map-canvas'), hoverBounds = mapCanvas.getBoundingClientRect();
    mapCanvas.dispatchEvent(new PointerEvent('pointermove', { clientX: hoverBounds.left + hoverBounds.width * 56.5 / 64,
      clientY: hoverBounds.top + hoverBounds.height * 56.5 / 64 }));
    checks.landmarkHoverShowsTitle = document.querySelector('#dungeon-area-title strong').textContent === 'Ruined Temple Entrance' &&
      !document.getElementById('dungeon-area-title').hidden && getComputedStyle(document.getElementById('dungeon-area-title')).pointerEvents === 'none';
    DungeonAreaTitles.reset();
    DungeonAreaTitles.update({ dungeon: d, roomName: 'The Echoing Flats', player });
    checks.roomEntryShowsCinematicTitle = document.querySelector('#dungeon-area-title strong').textContent === 'The Echoing Flats' &&
      document.querySelector('#dungeon-area-title small').textContent === 'Entering';
    for (let i = 0; i < 80 && !DungeonExplorationMap.ready(d.geoKey); i++) await new Promise(resolve => setTimeout(resolve, 5));
    const residentPortrait = document.createElement('canvas'); residentPortrait.width = 16; residentPortrait.height = 16;
    residentPortrait.getContext('2d').fillStyle = '#e7d070'; residentPortrait.getContext('2d').fillRect(0, 0, 16, 16);
    const knownMason = { name: 'Known Mason', type: 'monster', hp: 20, state: 'Friendly', mazeX: 34, mazeY: 32,
      mazeRoomKey: d.geoKey, sprite: { dataUrl: residentPortrait.toDataURL() } };
    const knownPopulation = DungeonInhabitants.createPopulation(d.geoKey, [
      { name: knownMason.name, allegiance: 'Friendly' }, { name: 'Undiscovered Carver', allegiance: 'Neutral' }
    ]);
    knownPopulation.actors[knownMason.name].position = { x: 34, y: 32 };
    knownPopulation.actors['Undiscovered Carver'].position = { x: 56, y: 56 };
    actors.push(knownMason);
    const firstSightings = [], originalEncounter = DungeonAreaTitles.encounter;
    DungeonAreaTitles.encounter = actor => { firstSightings.push(actor.name); originalEncounter(actor); };
    DungeonLife.receivePopulation({ population: knownPopulation, runId: 'ui-probe' }); DungeonLife.tick(); DungeonLife.tick();
    DungeonAreaTitles.encounter = originalEncounter;
    checks.firstEncounterAnnouncedOnce = firstSightings.filter(name => name === knownMason.name).length === 1;
    checks.mapAddsOnlySeenResident = encounterSelect.textContent.includes(knownMason.name) && !encounterSelect.textContent.includes('Undiscovered Carver');
    for (let i = 0; i < 40; i++) {
      const pixel = mapContext.getImageData(345, 325, 1, 1).data;
      if (pixel[0] === 231 && pixel[1] === 208) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const portraitPixel = mapContext.getImageData(345, 325, 1, 1).data;
    checks.encounterPortraitPainted = portraitPixel[0] === 231 && portraitPixel[1] === 208;
    encounterSelect.value = 'resident:' + knownMason.name; encounterSelect.dispatchEvent(new Event('change'));
    checks.encounterPinUsesLastSighting = /Known Mason: 2 tiles E \(last seen\)/.test(document.getElementById('exploration-map-caption').textContent);
    knownMason.mazeX = 56; knownMason.mazeY = 56; DungeonLife.tick(); DungeonExplorationMap.refresh();
    checks.encounterPinDoesNotTrackOffscreen = /Known Mason: 2 tiles E \(last seen\)/.test(document.getElementById('exploration-map-caption').textContent);
    mapCanvas.dispatchEvent(new PointerEvent('pointermove', { clientX: hoverBounds.left + hoverBounds.width * 34.5 / 64,
      clientY: hoverBounds.top + hoverBounds.height * 32.5 / 64 }));
    checks.encounterHoverShowsNameAndPortrait = document.querySelector('#dungeon-area-title strong').textContent === knownMason.name &&
      document.querySelector('#dungeon-area-title small').textContent === 'Friendly Encounter - Last Seen' &&
      document.querySelector('#dungeon-area-title img').src === knownMason.sprite.dataUrl && !document.querySelector('#dungeon-area-title img').hidden;
    document.getElementById('exploration-map-follow').click();
    document.getElementById('dungeon-map-shortcut').click();
    checks.parchmentClosesMap = document.getElementById('exploration-map-popup').style.display === 'none';
    document.getElementById('dungeon-map-shortcut').click();
    checks.parchmentOpensMap = document.getElementById('exploration-map-popup').style.display === 'block';
    document.getElementById('game-log-popup').style.display = 'none'; GameMenuUi.onDungeonReady(d);
    checks.userCloseRespected = document.getElementById('game-log-popup').style.display === 'none';
    DungeonExplorationMap.toggle(false);
    refreshFixture(); bindOriginalActions();
    const pack = document.getElementById('dungeon-inventory-shortcut').getBoundingClientRect(), parchment = document.getElementById('dungeon-map-shortcut').getBoundingClientRect();
    checks.inventoryAboveMap = Math.abs(pack.left - parchment.left) < 2 && pack.bottom < parchment.top && pack.top >= 0;
    document.getElementById('dungeon-inventory-shortcut').click();
    checks.inventoryOpened = !document.getElementById('inventory-popup').hidden;
    checks.inventoryGrouped = [...document.querySelectorAll('.inventory-category h3')].map(heading => heading.textContent).join('|') === 'Weapons (2)|Armor (1)|Shields (1)|Other (1)';
    const inventoryBounds = document.getElementById('inventory-popup').getBoundingClientRect();
    checks.inventoryFitsAboveInput = inventoryBounds.top >= 0 && inventoryBounds.bottom < command.top && inventoryBounds.right <= innerWidth;
    const itemCanvas = document.querySelector('.inventory-item canvas');
    checks.inventorySpritesPainted = itemCanvas.getContext('2d').getImageData(0, 0, 32, 32).data.some((value, i) => i % 4 === 3 && value > 0);
    const itemButton = name => [...document.querySelectorAll('.inventory-item')].find(button => button.dataset.inventoryItem === name);
    itemButton('bronze sword').click();
    document.querySelector('[data-party-slot="1"] .party-icon-button').click();
    checks.clickTargetPreselected = document.getElementById('character-select')?.value === 'Zarthul the Veiled Sentinel' && sheetClicks === 0 && commands.length === 0;
    document.getElementById('cancel-equip').click();
    checks.cancelDoesNothing = inventory.includes('bronze sword') && npcs[0].Equipped.Weapon === null && commands.length === 0;
    InventoryUi.toggle(true);
    const transfer = new DataTransfer();
    itemButton('bronze sword').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    document.querySelector('[data-party-slot="1"] .party-icon-button').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    checks.dragTargetPreselected = document.getElementById('character-select')?.value === 'Zarthul the Veiled Sentinel';
    document.getElementById('confirm-equip').click(); await new Promise(resolve => setTimeout(resolve, 5));
    checks.npcEquipUsesOriginalText = commands.at(-1) === 'equip bronze sword to Zarthul the Veiled Sentinel' && npcs[0].Equipped.Weapon?.name === 'bronze sword';
    InventoryUi.requestEquip('iron sword', 'Zarthul the Veiled Sentinel');
    checks.replacementStartsWithUnequip = !!document.getElementById('unequip-button') && !document.getElementById('confirm-equip');
    document.getElementById('cancel-button').click();
    checks.cancelReplacementPreservesGear = npcs[0].Equipped.Weapon.name === 'bronze sword' && inventory.includes('iron sword') && npcs[0].Attack === 1;
    InventoryUi.requestEquip('iron sword', 'Zarthul the Veiled Sentinel'); document.getElementById('unequip-button').click();
    await new Promise(resolve => setTimeout(resolve, 5));
    checks.unequipThenEquipPopup = commands.at(-1) === 'unequip bronze sword from Zarthul the Veiled Sentinel' && npcs[0].Equipped.Weapon === null &&
      inventory.includes('bronze sword') && document.getElementById('character-select')?.value === 'Zarthul the Veiled Sentinel';
    document.getElementById('confirm-equip').click(); await new Promise(resolve => setTimeout(resolve, 5));
    checks.replacementDoesNotStack = commands.at(-1) === 'equip iron sword to Zarthul the Veiled Sentinel' && npcs[0].Attack === 3 && npcs[0].Damage === 4 && inventory.includes('bronze sword');
    InventoryUi.requestEquip('bronze sword', 'Zarthul the Veiled Sentinel'); document.getElementById('unequip-button').click();
    await new Promise(resolve => setTimeout(resolve, 5)); document.getElementById('cancel-equip').click();
    checks.cancelSecondPromptDoesNotEquip = npcs[0].Equipped.Weapon === null && npcs[0].Attack === 0 && inventory.includes('bronze sword') && inventory.includes('iron sword');
    InventoryUi.toggle(true); itemButton('silver amulet').click(); document.querySelector('[data-party-slot="0"] .party-icon-button').click();
    document.getElementById('confirm-equip').click(); await new Promise(resolve => setTimeout(resolve, 5));
    checks.pcEquipUsesOriginalText = commands.at(-1) === 'equip silver amulet' && characters[0].Magic === 2;
    document.getElementById('chatuserinput').value = 'equip bronze sword to Zarthul the Veiled Sentinel';
    await chatbotprocessinput();
    checks.textInterfaceStillEquips = npcs[0].Equipped.Weapon?.name === 'bronze sword' && npcs[0].Attack === 1;
    pickupDungeon = { ...d, sceneObjects: [{ name: 'silver dagger', type: 'weapon', x: 32, y: 32 }], _geometryStamp: 'fixture' };
    const cellsBefore = JSON.stringify(pickupDungeon.cells), beforeCommands = commands.length;
    ItemInteractionUi.update(pickupDungeon, pickupDungeon.sceneObjects, player);
    checks.proximityAsksBeforeTake = !!document.getElementById('take-button') && commands.length === beforeCommands && pickupDungeon.sceneObjects.length === 1;
    document.getElementById('cancel-button').click();
    ItemInteractionUi.update(pickupDungeon, pickupDungeon.sceneObjects, player);
    checks.pickupCancelKeepsItem = !document.getElementById('take-button') && pickupDungeon.sceneObjects.length === 1;
    ItemInteractionUi.update(pickupDungeon, pickupDungeon.sceneObjects, { x: 30, y: 30 });
    ItemInteractionUi.update(pickupDungeon, pickupDungeon.sceneObjects, player);
    document.getElementById('take-button').click(); await new Promise(resolve => setTimeout(resolve, 5));
    checks.takeRemovesOnlyItem = commands.at(-1) === 'take silver dagger' && inventory.includes('silver dagger') && pickupDungeon.sceneObjects.length === 0 &&
      JSON.stringify(pickupDungeon.cells) === cellsBefore && pickupDungeon._geometryStamp === 'fixture';
    await new Promise(resolve => setTimeout(resolve, 20));
  } catch (error) { errors.push(error.stack); }
  const report = { pass: Object.values(checks).every(Boolean) && !errors.length, checks, errors };
  document.getElementById('results').textContent = JSON.stringify(report);
  await probeFetch('/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
});
</script></body></html>`;

for (const [, script] of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script.trim()) new vm.Script(script);

(async () => {
  let receiveReport;
  const reported = new Promise(resolve => { receiveReport = resolve; });
  const server = http.createServer((request, response) => {
    if (request.url === '/report' && request.method === 'POST') {
      let body = '';
      request.on('data', data => { body += data; });
      request.on('end', () => {
        try { receiveReport(JSON.parse(body)); response.end('ok'); }
        catch { response.writeHead(400); response.end(); }
      });
      return;
    }
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(page); return; }
    if (['/assets/adventurers-map.svg', '/assets/adventurers-pack.svg'].includes(request.url)) { response.setHeader('Content-Type', 'image/svg+xml'); response.end(fs.readFileSync(path.join(root, request.url.slice(1)))); return; }
    const name = /^\/assets\/(\w+)\.js$/.exec(request.url)?.[1];
    if (!scripts.includes(name) && name !== 'partyRecovery') { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'application/javascript'); response.end(fs.readFileSync(path.join(root, 'assets', name + '.js')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = process.env.GPU_PROBE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-ui-probe-'));
  const size = process.argv.includes('--narrow') ? '540,900' : '1680,950';
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=' + size,
    '--user-data-dir=' + profile, 'http://127.0.0.1:' + server.address().port], { windowsHide: true });
  let stderr = '', timeout;
  child.stdout.on('data', () => {}); child.stderr.on('data', data => { stderr += data; });
  const stopped = new Promise(resolve => {
    child.once('error', error => resolve({ pass:false,error:error.message }));
    child.once('close', (exitCode, signal) => resolve({ pass:false,error:'Browser exited before reporting.',exitCode,signal,stderr:stderr.slice(-2000) }));
  });
  const expired = new Promise(resolve => { timeout=setTimeout(()=>resolve({pass:false,error:'Browser probe timed out.',stderr:stderr.slice(-2000)}),30000); });
  // IndexedDB uses real asynchronous I/O; virtual-time dumping can finish before its transactions.
  const report = await Promise.race([reported, stopped, expired]);
  clearTimeout(timeout); child.kill(); server.close();
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.pass ? 0 : 1;
})();
