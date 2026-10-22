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
const css = ['gameUiFonts.css','gameUiPixels.css','artViewerUi.css'].map(file=>fs.readFileSync(path.join(root,'assets',file),'utf8')).join('\n') + '\n' +
  [...index.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const menu = index.slice(index.indexOf('<button id="game-menu-toggle"'), index.indexOf('<!-- Music control button'));
const consoleToggle = index.slice(index.indexOf('function togglePopup()'), index.indexOf('function toggleDungeonPopup()'));
const logToggle = index.slice(index.indexOf('function toggleGameLogPopup()'), index.indexOf('function togglePartyPopup()'));
const partySheetFunctions=index.slice(index.indexOf('function togglePartyPopup()'),index.indexOf('function setDungeonFullscreenUiState('));
const partySheetOpen=index.slice(index.indexOf('function openPartySheet('),index.indexOf('function drawPartySpriteCanvas('));
const partyDockFunctions=index.slice(index.indexOf('function drawPartySpriteCanvas('),index.indexOf('function renderPartyInfoPopup('));
const partySheetMarkup=index.slice(index.indexOf('<div id="party-popup">'),index.indexOf('<div id="combat-popup">'));
const inventoryStart = index.indexOf('<button id="dungeon-inventory-shortcut"');
const inventoryMarkup = index.slice(inventoryStart, index.indexOf('</section>', inventoryStart) + '</section>'.length);
const game = fs.readFileSync(path.join(root, 'assets/game.js'), 'utf8');
const roomArtPresentation = game.slice(game.indexOf('function presentRoomIllustration('), game.indexOf('async function switchDungeonForCoordinates('));
const actionStart = game.indexOf('// Add event listener to clickable objects inside contentDiv');
const actionHandlers = game.slice(actionStart, game.indexOf('// ---- Exit click handler', actionStart));
const exitHandlers=game.slice(game.indexOf('// ---- Exit click handler'),game.indexOf('// ---- End exit click handler ----'));
const exitNames=game.slice(game.indexOf('function consoleExitDestinationName('),game.indexOf('\n}',game.indexOf('function getCoordinatesForDirection('))+2);
const readableLookup=game.slice(game.indexOf('window.getReadableItemMetadata ='),game.indexOf('window.getInventoryGiveItems ='));
const equipmentFunctions = game.slice(game.indexOf('function equipItem('), game.indexOf('function rollDice(', game.indexOf('function equipItem(')));
const dialogueLogHook = game.slice(game.indexOf('window.appendDungeonDialogueLog ='), game.indexOf('// Function to create Mortacia character and add her to npcsString'));
const dungeonCacheFunctions = game.slice(game.indexOf('const DUNGEON_DB_NAME'), game.indexOf('let pendingLodPersist'));
const monsterRenderStart = game.indexOf('        let monstersHtml =');
const monsterRendering = game.slice(monsterRenderStart, game.indexOf('// Combine all data into a single string for display', monsterRenderStart));
const monsterSectionStart = game.indexOf('Monsters in Room:', monsterRenderStart);
const monsterSection = game.slice(monsterSectionStart, game.indexOf('Puzzle: ${puzzle.inRoom}', monsterSectionStart));
const consoleStateRefresh = game.slice(game.indexOf('window.refreshDungeonConsoleStates ='), game.indexOf('window.onDungeonPause ='));
const questSection = game.slice(game.indexOf('Current Quest: ${currentQuest}'), game.indexOf('\nNext Artifact: ${nextArtifact}'));
const recentHistoryFunctions = game.slice(game.indexOf('function getRecentPromptsAndResponsesForConversation('), game.indexOf('var previousResponse ='));
const travelDetection = game.slice(game.indexOf('async function chatbotprocessinput(')).match(/^\s*let validDirection = ([^;]+);/m)[1];
const scripts = ['renderCharacterProcedural', 'puzzleModules', 'puzzleMotion', 'shrineIconography', 'artCharacters', 'sculptureForms', 'frescoDesigns', 'frescoFigures', 'surfaceArt', 'readableItems', 'physicalPuzzles', 'commandIntent', 'worldInteractionUi', 'renderSceneItems', 'sceneObjectSync', 'partyRoster', 'dungeonCartography', 'landmarkCatalog', 'areaTitleUi', 'compassUi', 'explorationMapUi', 'inventoryUi', 'itemInteractionUi', 'mapShortcutUi', 'gameMenuUi', 'characterProfiles', 'dialogueAudience', 'dungeonInhabitants', 'campaignMemory', 'campaignMemoryUi', 'dialogueHistory', 'dungeonLifeUi', 'actionNoticeUi', 'commandGate', 'outdoorDiscovery'];
scripts.splice(scripts.indexOf('renderCharacterProcedural')+1,0,'renderCharacterSprite');
scripts.splice(scripts.indexOf('sculptureForms'),0,'sculptureAnatomy','stoneCarvings');
scripts.splice(scripts.indexOf('surfaceArt'),0,'ancientScripts','mosaicDesigns');
scripts.splice(scripts.indexOf('frescoFigures'),0,'frescoSerpents');
scripts.splice(scripts.indexOf('surfaceArt')+1,0,'artPresentation');
scripts.push('combatCharacterUi');
scripts.push('combatTurnUi', 'itemGiveUi', 'actionDiceUi');
scripts.push('gameModelUi');
scripts.push('retroGraphics');
scripts.push('gameUiPixels');
const page = String.raw`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
${scripts.map(name => `<script src="/assets/${name}.js"></script>`).join('')}
</head><body>${menu}<button id="play-music-btn" style="display:none">Play Music</button>
<div id="phaser-popup"><div id="phaser-header">Game Console</div><div id="phaser-container">Fixture room</div></div>
<div id="combat-popup"><div id="combat-header">Combat Map</div><div id="combat-container"></div></div>
<div id="game-log-popup"><div id="game-log-header">Game Log</div></div>
${partySheetMarkup}
<div id="chatbotcontainer"><p><textarea id="chatuserinput" placeholder="Type a command"></textarea></p><button>Command</button></div>
<button id="dungeon-map-shortcut" aria-controls="exploration-map-popup"><img src="/assets/adventurers-map.svg" alt=""></button>
${inventoryMarkup}
<div id="party-icon-dock"><div data-party-slot="0"><button class="party-icon-button" onclick="openPartySheet(0)">Mortacia</button></div><div data-party-slot="1"><button class="party-icon-button" onclick="openPartySheet(1)">Zarthul</button></div></div>
<div id="chatlog" hidden></div><pre id="results"></pre><script>
const probeFetch = window.fetch.bind(window);
function syncGameLogTranscript() {}
${consoleToggle}
${logToggle}
${partySheetFunctions}
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
const roomNameDatabase=new Map();
${readableLookup}
const escapedText=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
${exitNames}
${recentHistoryFunctions}
let playerPosX = 32.5, playerPosY = 32.5;
const characterState = (actor, type = 'monster', fallback = 'Neutral') => DungeonInhabitants.state({ ...actor, type }, fallback);
${dungeonCacheFunctions}
${dialogueLogHook}
${consoleStateRefresh}
const commands = [], contentDiv = document.getElementById('phaser-container');
const detectTravel = new Function('userInput','window',${JSON.stringify('return ' + travelDetection)});
const renderMonsterSection = new Function('monsters', 'monstersState', 'escapedText', ${JSON.stringify(monsterRendering + '\nreturn `' + monsterSection + '`;')});
const renderQuestSection = new Function('currentQuest', 'questProgress', 'questRequirements', 'escapedText', 'data', ${JSON.stringify('return `' + questSection + '`;')});
function sheet(character) { return [character.Name, 'Female', 'Human', 'Adventurer', 'Level: 1', 'AC: 10', 'XP: 0',
  'HP: ' + character.HP, 'MaxHP: ' + character.MaxHP, 'Equipped: ' + Object.entries(character.Equipped).map(([slot, item]) => slot + ': ' + (item?.name || 'None')).join(', '),
  'Attack: ' + character.Attack, 'Damage: ' + character.Damage, 'Armor: ' + character.Armor, 'Magic: ' + character.Magic].join('\n'); }
window.getPartyInfoEntries = () => [...characters, ...npcs].map(source => ({ label: source.Name, source: { ...source, sheet: sheet(source) } }));
function renderPartyInfoPopup(){
  const entry=window._combatSheetEntry||getPartyInfoEntries()[window._partyPanelIndex||0];
  document.getElementById('party-popup-name').textContent=entry?.label||'';
  document.getElementById('party-popup-sheet').textContent=entry?.source.sheet||'';
}
function setPartyPanelIndex(index){sheetClicks++;window._partyPanelIndex=index;renderPartyInfoPopup();}
${partySheetOpen}
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
  if (window.currentDungeon?.physicalPuzzle && PhysicalPuzzles.intent(input,window.currentDungeon.physicalPuzzle.definition) && detectTravel(input,window))
    throw Error('A puzzle control command was routed to travel.');
  if (input.startsWith('unequip ')) { const parts = input.slice(8).split(' from '); unequipItem(parts[0], parts[1] || null); }
  else if (input.startsWith('equip ')) { const parts = input.slice(6).split(' to '); equipItem(parts[0], parts[1] || null); }
  else if (input === 'take silver dagger') { roomItems = []; inventory.push(stock[5].name); inventoryProperties.push(JSON.stringify(stock[5])); }
  else if (window.currentDungeon?.physicalPuzzle) {
    const d = window.currentDungeon, e = d.physicalPuzzle, action = PhysicalPuzzles.intent(input, e.definition);
    if (action && !action.inspect) {
      const state = PhysicalPuzzles.step(e.definition, e.state, action.controlId, action.value);
      const delta = PhysicalPuzzles.applyVisualState(d, state); PhysicalPuzzles.beginMotion(d,e,delta.physicalPuzzle); Object.assign(d.cells, delta.cells); d.physicalPuzzle = delta.physicalPuzzle;
    }
    document.getElementById('chatuserinput').value = '';
  }
  await Promise.resolve(); refreshFixture();
}
function bindOriginalActions() { const npcs = npcText; ${actionHandlers} ${exitHandlers} }
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
    const requiredText = '1. Give "shroud of eternal echoes" to Grelma Voss in Hall of Quiet Descent (0,1,0). Item source: Hall of Eternal Echoes (-1,1,0). 2. Solve the physical puzzle in Hall of Quiet Descent. 3. Have "<emerald> & crown" in your inventory.';
    contentDiv.innerHTML = renderQuestSection('Recover the records.', 'Step 1/3: In Progress', requiredText, escapedText);
    checks.questRequirementsShowExactItemAndRecipient = contentDiv.innerText.includes('shroud of eternal echoes') && contentDiv.innerText.includes('Grelma Voss');
    checks.questRequirementsShowSourceAndActualPuzzle = contentDiv.innerText.includes('Hall of Eternal Echoes (-1,1,0)') && contentDiv.innerText.includes('Solve the physical puzzle');
    checks.questRequirementsWrapWithoutClippingNames = contentDiv.scrollWidth <= contentDiv.clientWidth + 1;
    checks.questRequirementNamesAreEscaped = contentDiv.innerText.includes('<emerald> & crown') && !contentDiv.querySelector('emerald');
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
    const subtitleClose = document.getElementById('dungeon-dialogue-close'), subtitleCloseBounds = subtitleClose.getBoundingClientRect();
    checks.subtitleCloseHasAccessibleLabel = subtitleClose.getAttribute('aria-label') === 'Dismiss subtitle';
    checks.subtitleCloseIsClickable = getComputedStyle(subtitleClose).pointerEvents === 'auto' &&
      document.elementFromPoint(subtitleCloseBounds.left + subtitleCloseBounds.width / 2, subtitleCloseBounds.top + subtitleCloseBounds.height / 2) === subtitleClose;
    const dismissCommands = commands.length; let dismissBubbles = 0;
    const trackDismiss = () => dismissBubbles++; document.addEventListener('click', trackDismiss);
    subtitleClose.click(); document.removeEventListener('click', trackDismiss);
    checks.subtitleXHidesImmediately = document.getElementById('dungeon-dialogue').hidden;
    checks.subtitleXDoesNotClickThrough = dismissBubbles === 0 && commands.length === dismissCommands;
    GameCommandGate.transportStarted('/processInput7');
    DungeonLife.receiveDialogue({ geoKey: d.geoKey, runId: 'ui-probe', dialogue: [{ speaker: 'Zarthul', line: 'Stay ready while the room settles.' }] });
    subtitleClose.click(); checks.subtitleXWorksDuringLoading = document.getElementById('dungeon-dialogue').hidden && GameCommandGate.busy();
    GameCommandGate.transportFinished('/processInput7', { completedStartResult: {} });
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
      DungeonLife.receiveTurnDialogue('Zarthul says, "' + fullSpeech + '"', { consoleText: turnText, geoKey: d.geoKey, runId: 'ui-probe' });
      checks.subtitleXPreservesUnreadSpeech = true;
      for (const text of speechCards) {
        checks.subtitleXPreservesUnreadSpeech &&= document.getElementById('dungeon-dialogue-words').textContent === text;
        subtitleClose.click(); checks.subtitleXPreservesUnreadSpeech &&= document.getElementById('dungeon-dialogue').hidden;
        DungeonLife.tick();
      }
      checks.subtitleXPreservesUnreadSpeech &&= DungeonLife.subtitleDiagnostics().filter(row => row.stage === 'displayed').map(row => row.line).join(' ') === fullSpeech;
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
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[{speaker:'Late Mason',line:'A corpse must not speak.',kind:'canned'}]});
    DungeonLife.tick();
    checks.deadStateCannotSpeak = document.getElementById('dungeon-dialogue').hidden;
    delete delayed.state;
    DungeonLife.reset();
    delayed.mazeX=Math.floor(player.x+DungeonInhabitants.MONSTER_DIALOGUE_RANGE+2);
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[{speaker:'Late Mason',line:'I must not speak from four tiles away.',kind:'canned'}]});
    DungeonLife.tick();
    checks.distantResidentCannotStartSubtitle=document.getElementById('dungeon-dialogue').hidden;
    checks.subtitleDistanceRejectionLogged = DungeonLife.subtitleDiagnostics().some(row => row.stage === 'skipped' && row.reason === 'out-of-range');
    DungeonLife.reset();
    delayed.mazeX=Math.floor(player.x+DungeonInhabitants.MONSTER_DIALOGUE_RANGE-.5);
    window.getPartyEntryRenderMazePosition=actor=>actor===delayed?{x:delayed.mazeX+1,y:32}:null;
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[{speaker:'Late Mason',line:'My logical destination is close, but I am still walking.',kind:'canned'}]});
    DungeonLife.tick();
    checks.renderedResidentMustBeClose=document.getElementById('dungeon-dialogue').hidden;
    delayed.mazeX=35;
    window.getPartyEntryRenderMazePosition=actor=>actor===delayed?{x:34.75,y:32}:null;
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[{speaker:'Late Mason',line:'Now you are close enough to hear me.',kind:'canned'}]});
    DungeonLife.tick();
    checks.closeResidentStartsSubtitle=!document.getElementById('dungeon-dialogue').hidden&&
      document.getElementById('dungeon-dialogue-words').textContent==='Now you are close enough to hear me.';
    DungeonLife.receiveDialogue({geoKey:'0,0,0',runId:'ui-probe',dialogue:[{speaker:'Late Mason',line:'This queued line must not follow the player away.',kind:'canned'}]});
    player.x=34.75-DungeonInhabitants.MONSTER_DIALOGUE_RANGE-2;
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
    const carvedToggle=document.getElementById('carved-stonework-toggle');
    checks.carvedStoneworkMenuControl = document.getElementById('game-menu').contains(carvedToggle) && typeof GameMenuUi.setStonework==='function';
    for(let i=0;i<3;i++){GameMenuUi.setOpen(false);GameMenuUi.setOpen(true);}
    GameMenuUi.setStonework(true);carvedToggle.click();
    checks.carvedStoneworkFallback = window.ARCHITECTURAL_CARVINGS===false && carvedToggle.textContent.includes('OFF') && localStorage.getItem('holodek.architecturalCarvings')==='off';
    GameMenuUi.setOpen(true);carvedToggle.click();
    checks.carvedStoneworkRestore = window.ARCHITECTURAL_CARVINGS===true && carvedToggle.getAttribute('aria-pressed')==='true';
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
    const hudScale=parseFloat(getComputedStyle(document.body).zoom);
    checks.defaultHudMatchesPrevious75PercentZoom=Math.abs(hudScale-1.75*.75)<.0001;
    const consoleBounds=document.getElementById('phaser-popup').getBoundingClientRect();
    checks.defaultConsoleIs25PercentSmaller=Math.abs(consoleBounds.width-200*1.75*.75)<1;
    checks.consolePanelsFitAtNormalBrowserZoom=ids.every(id=>{
      const r=document.getElementById(id).getBoundingClientRect();
      return r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight;
    });
    const c = document.getElementById('dungeon-compass').getBoundingClientRect(), command = document.getElementById('chatbotcontainer').getBoundingClientRect();
    checks.compassOutsideInput = c.right < command.left || c.bottom < command.top;
    checks.exitPins = document.querySelectorAll('.compass-exit-pin').length === 2;
    checks.distance = document.querySelector('.compass-exit-readout').textContent.includes('13 tiles');
    const log = document.getElementById('game-log-popup').getBoundingClientRect();
    checks.logBottomRight = Math.abs(innerWidth - log.right - 5*hudScale) < 2 && Math.abs(innerHeight - log.bottom - 5*hudScale) < 2;
    checks.consoleAndLogDoNotOverlap=consoleBounds.bottom<log.top;
    const combat = document.getElementById('combat-popup').getBoundingClientRect();
    checks.combatTopLeft = Math.abs(combat.left - 5*hudScale) < 2 && Math.abs(combat.top - 42*hudScale) < 2;
    const combatPanel=document.getElementById('combat-popup'),originalCombatHeight=combatPanel.style.height;
    const originalMapHeight=document.getElementById('combat-container').getBoundingClientRect().height;
    combatPanel.style.height=innerHeight*.7/hudScale+'px';
    const expandedCombat=combatPanel.getBoundingClientRect();
    checks.combatMapResizesVerticallyBeyondHalfScreen=expandedCombat.height>innerHeight*.6&&expandedCombat.bottom<=innerHeight&&getComputedStyle(combatPanel).resize==='both';
    checks.combatMapContentGrowsWithPanel=document.getElementById('combat-container').getBoundingClientRect().height>originalMapHeight;
    checks.consoleAndLogKeepCompactHeightLimits=parseFloat(getComputedStyle(document.getElementById('phaser-popup')).maxHeight)<parseFloat(getComputedStyle(combatPanel).maxHeight);
    combatPanel.style.height=originalCombatHeight;
    checks.characterSheetInitiallyHidden=getComputedStyle(document.getElementById('party-popup')).display==='none';
    document.querySelector('[data-party-slot="1"] .party-icon-button').click();
    const characterPanel=document.getElementById('party-popup'),characterBounds=characterPanel.getBoundingClientRect();
    checks.characterClickCentersSheet=Math.abs((characterBounds.left+characterBounds.right)/2-innerWidth/2)<2&&
      Math.abs((characterBounds.top+characterBounds.bottom)/2-innerHeight/2)<2;
    checks.characterSheetFitsViewport=characterBounds.left>=0&&characterBounds.top>=0&&characterBounds.right<=innerWidth&&characterBounds.bottom<=innerHeight;
    checks.characterSheetAboveCombatMap=parseInt(getComputedStyle(characterPanel).zIndex)>parseInt(getComputedStyle(combatPanel).zIndex)&&
      characterPanel.contains(document.elementFromPoint((characterBounds.left+characterBounds.right)/2,(characterBounds.top+characterBounds.bottom)/2));
    characterPanel.style.left='0px';characterPanel.style.top='0px';
    document.querySelector('[data-party-slot="0"] .party-icon-button').click();
    const recentered=characterPanel.getBoundingClientRect();
    checks.nextCharacterRecentersSheet=document.getElementById('party-popup-name').textContent==='Mortacia'&&Math.abs((recentered.left+recentered.right)/2-innerWidth/2)<2;
    document.getElementById('party-popup-close').click();
    checks.characterSheetCloseWorks=getComputedStyle(characterPanel).display==='none';sheetClicks=0;
    const originalActors=window.combatCharacters;
    const clickedPc={name:'Mortacia',type:'pc'},clickedNpc={name:'Zarthul the Veiled Sentinel',type:'npc'};
    const clickedMonster={name:'Probe Dragon',type:'monster',hp:17};
    window.combatCharacters=[clickedPc,clickedNpc,clickedMonster];
    window._combatMonsterSheets=sheet(makeCharacter(clickedMonster.name,'monster'));
    document.getElementById('chatuserinput').value='';
    const actionButton=label=>[...document.querySelectorAll('.combat-character-actions button')].find(b=>b.textContent===label);
    CombatCharacterUi.open(clickedPc);
    checks.mapPcOpensSheetWithoutActions=document.getElementById('party-popup-name').textContent==='Mortacia'&&!document.querySelector('.combat-character-actions');
    CombatCharacterUi.open(clickedNpc);
    checks.mapNpcHasCenteredSheetAndRemove=document.getElementById('party-popup-name').textContent===clickedNpc.name&&!!actionButton('Remove')&&commands.length===0;
    actionButton('Remove').click();await new Promise(resolve=>setTimeout(resolve,5));
    checks.mapRemoveRequiresConfirmation=commands.at(-1)==='remove '+clickedNpc.name+' from party';
    document.getElementById('chatuserinput').value='';
    CombatCharacterUi.open(clickedMonster);
    const monsterBounds=characterPanel.getBoundingClientRect();
    checks.mapMonsterShowsActualSheetAndActions=document.getElementById('party-popup-sheet').textContent.includes('HP: 17')&&!!actionButton('Attack')&&!!actionButton('Add to Party');
    checks.mapMonsterSheetCentered=Math.abs((monsterBounds.left+monsterBounds.right)/2-innerWidth/2)<2&&Math.abs((monsterBounds.top+monsterBounds.bottom)/2-innerHeight/2)<2;
    actionButton('Cancel').click();checks.mapCancelDoesNotAttack=commands.length===1;
    CombatCharacterUi.open(clickedMonster);document.getElementById('chatuserinput').value='unfinished dialogue';actionButton('Attack').click();
    checks.mapActionsPreserveDraft=commands.length===1&&document.getElementById('chatuserinput').value==='unfinished dialogue';
    document.getElementById('chatuserinput').value='';actionButton('Attack').click();await new Promise(resolve=>setTimeout(resolve,5));
    checks.mapAttackUsesOriginalCommand=commands.at(-1)==='attack '+clickedMonster.name;
    CombatCharacterUi.open(clickedMonster);document.getElementById('chatuserinput').value='';actionButton('Add to Party').click();await new Promise(resolve=>setTimeout(resolve,5));
    checks.mapRecruitUsesOriginalCommand=commands.at(-1)==='add '+clickedMonster.name+' to party';
    openPartySheet(0);checks.partySheetNavigationClearsMonsterInspection=!window._combatSheetEntry&&!document.querySelector('.combat-character-actions');
    document.getElementById('party-popup-close').click();window.combatCharacters=originalActors;sheetClicks=0;commands.length=0;document.getElementById('chatuserinput').value='';
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
      checks.mapUsesReadableCanvas = document.getElementById('exploration-map-canvas').getBoundingClientRect().width >= Math.min(300,innerHeight*.3);
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
    checks.mapListsOnlyKnownLandmarks = encounterSelect.options.length === 3 && encounterSelect.options[0].textContent === 'Known places, people & items (2)' &&
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
    checks.landmarkHoverShowsTitle = document.getElementById('exploration-map-hover').textContent === 'Ruined Temple Entrance' &&
      !document.getElementById('exploration-map-hover').hidden && getComputedStyle(document.getElementById('exploration-map-hover')).pointerEvents === 'none';
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
    const residentHoverBounds = mapCanvas.getBoundingClientRect();
    mapCanvas.dispatchEvent(new PointerEvent('pointermove', { clientX: residentHoverBounds.left + residentHoverBounds.width * 34.5 / 64,
      clientY: residentHoverBounds.top + residentHoverBounds.height * 32.5 / 64 }));
    checks.encounterHoverShowsLastSeenName = document.getElementById('exploration-map-hover').textContent === knownMason.name + ' (last seen)' &&
      !document.getElementById('exploration-map-hover').hidden;
    const priorObjects = d.sceneObjects, priorDiscoveries = d.objectDiscoveries;
    d.objectDiscoveries = { names: ['silver dagger'] };
    d.sceneObjects = [{ ...stock[5], x: 38, y: 30 }, { name: 'hidden crown', x: 39, y: 30 }];
    DungeonExplorationMap.refresh();
    checks.mapListsDiscoveredItemsOnly = encounterSelect.textContent.includes('silver dagger') && !encounterSelect.textContent.includes('hidden crown');
    checks.discoveredItemsHaveNumberedNames = [...encounterSelect.options].some(o=>/^1\. silver dagger$/.test(o.textContent));
    const iconPixel = mapContext.getImageData(385, 305, 1, 1).data;
    checks.mapDrawsDiscoveredItemIcon = iconPixel[0] !== 8 || iconPixel[1] !== 8;
    const itemHoverBounds = mapCanvas.getBoundingClientRect();
    mapCanvas.dispatchEvent(new PointerEvent('pointermove', { clientX: itemHoverBounds.left + itemHoverBounds.width * 38.5 / 64,
      clientY: itemHoverBounds.top + itemHoverBounds.height * 30.5 / 64 }));
    checks.itemHoverShowsName = document.getElementById('exploration-map-hover').textContent === 'silver dagger';
    d.sceneObjects.shift(); DungeonExplorationMap.refresh();
    checks.mapRemovesPickedUpItem = !encounterSelect.textContent.includes('silver dagger');
    d.sceneObjects = priorObjects; d.objectDiscoveries = priorDiscoveries; DungeonExplorationMap.refresh();
    document.getElementById('exploration-map-follow').click();
    document.getElementById('dungeon-map-shortcut').click();
    checks.parchmentClosesMap = document.getElementById('exploration-map-popup').style.display === 'none';
    document.getElementById('dungeon-map-shortcut').click();
    checks.parchmentOpensMap = document.getElementById('exploration-map-popup').style.display === 'block';
    document.getElementById('game-log-popup').style.display = 'none'; GameMenuUi.onDungeonReady(d);
    checks.userCloseRespected = document.getElementById('game-log-popup').style.display === 'none';
    DungeonExplorationMap.toggle(false);
    refreshFixture(); bindOriginalActions();
    roomNameDatabase.set(coordinatesToString(currentCoordinates),{exits:{west:{status:'open',targetCoordinates:'-1,0,0'}}});
    roomNameDatabase.set('-1,0,0',{name:'Archive of <Ash>'});
    const exitLink=document.createElement('span');exitLink.className='clickable-exit';exitLink.dataset.exit='west';contentDiv.appendChild(exitLink);exitLink.click();
    checks.exitConfirmationNamesDestination=document.querySelector('.popup-container')?.textContent.includes('Go west to Archive of <Ash>?')&&!document.querySelector('.popup-container ash');
    document.getElementById('cancel-button').click();checks.exitNameInspectionDoesNotTravel=commands.length===0;
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
    checks.inventoryClickShowsPurposeAndDropEquip=document.getElementById('inventory-detail').textContent.includes('Equip as a weapon')&&!!document.getElementById('drop-button')&&!!document.getElementById('equip-button');
    const inventoryActions=document.querySelector('[data-inventory-details]'),actionsBounds=inventoryActions.getBoundingClientRect();
    checks.inventoryActionButtonsNotCovered=document.getElementById('inventory-popup').contains(inventoryActions)&&document.elementFromPoint(actionsBounds.left+actionsBounds.width/2,actionsBounds.top+actionsBounds.height/2)?.closest('[data-inventory-details]')===inventoryActions;
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
    const testBook={name:'chronicle of the pale court',type:'other',attack_modifier:0,damage_modifier:0,ac:1,magic:2};
    const testScroll={...testBook,name:'keeper scroll of the pale court'};
    const blankScroll={...testBook,name:'blank scroll'};
    roomNameDatabase.set('readable-source',{readables:[
      {name:testBook.name,kind:'book',chapters:[{title:'Records',text:'The pale court preserved the departed.'}]},
      {name:testScroll.name,kind:'scroll',chapters:[{title:'Keeper notes',text:'The keeper recorded the passage.'}]},
      {name:blankScroll.name,kind:'scroll',backstory:'A weathered scroll.',chapters:[{title:'Blank',text:' \n '}]}
    ]});
    document.getElementById('chatuserinput').value='';const equippedBeforeRead=JSON.stringify(characters[0].Equipped);
    inventory.push(testBook.name);inventoryProperties.push(JSON.stringify(testBook));refreshFixture();
    InventoryUi.toggle(true);document.querySelector('[data-inventory-item="'+testBook.name+'"]').click();
    const readBook=document.getElementById('inventory-read');
    checks.readableOtherHasReadAction=!readBook.hidden&&!readBook.disabled;
    const beforeReadCommands=commands.length;readBook.click();await new Promise(resolve=>setTimeout(resolve,5));
    checks.inventoryReadUsesLiteralCommand=commands.at(-1)==='read '+testBook.name&&commands.length===beforeReadCommands+1&&!InventoryUi.isOpen();
    checks.readingDoesNotConsumeOrEquipBook=inventory.includes(testBook.name)&&JSON.stringify(characters[0].Equipped)===equippedBeforeRead;
    document.getElementById('chatuserinput').value='unfinished dialogue';
    checks.readKeepsUnsubmittedDraft=await WorldInteractionUi.requestRead(testBook.name)===false&&document.getElementById('chatuserinput').value==='unfinished dialogue';
    document.getElementById('chatuserinput').value='';GameCommandGate.transportStarted('/processInput7');
    checks.readingBlockedWhileLoading=await WorldInteractionUi.requestRead(testBook.name)===false&&commands.length===beforeReadCommands+1;
    GameCommandGate.transportFinished('/processInput7',{completedStartResult:{}});
    for(const item of [testBook,testScroll]){
      document.getElementById('chatuserinput').value='';
      if(!inventory.includes(item.name)){inventory.push(item.name);inventoryProperties.push(JSON.stringify(item));refreshFixture();}
      InventoryUi.toggle(true);document.querySelector('[data-inventory-item="'+item.name+'"]').click();
      const popupRead=document.querySelector('#inventory-popup #read-item-button');
      checks['inventoryPopupRead-'+item.name]=!!popupRead&&!!document.querySelector('#inventory-popup #drop-button')&&!!document.querySelector('#inventory-popup #equip-button');
      popupRead.click();await new Promise(resolve=>setTimeout(resolve,5));
      checks['inventoryPopupReadsWithoutConsuming-'+item.name]=commands.at(-1)==='read '+item.name&&inventory.includes(item.name)&&!InventoryUi.isOpen();
      document.getElementById('chatuserinput').value='';
      document.querySelector('.clickable-inventory[data-object="'+item.name+'"]').click();
      const consoleRead=document.getElementById('read-item-button');
      checks['consoleInventoryRead-'+item.name]=!!consoleRead;
      consoleRead.click();await new Promise(resolve=>setTimeout(resolve,5));
      checks['consoleInventoryReads-'+item.name]=commands.at(-1)==='read '+item.name&&inventory.includes(item.name);
    }
    document.getElementById('chatuserinput').value='';inventory.push(blankScroll.name);inventoryProperties.push(JSON.stringify(blankScroll));refreshFixture();
    InventoryUi.toggle(true);document.querySelector('[data-inventory-item="'+blankScroll.name+'"]').click();
    checks.blankScrollHasNoReadInInventory=!document.querySelector('#inventory-popup #read-item-button')&&document.getElementById('inventory-read').hidden;
    InventoryUi.toggle(false);document.querySelector('.clickable-inventory[data-object="'+blankScroll.name+'"]').click();
    checks.blankScrollHasNoReadInConsole=!document.getElementById('read-item-button');document.getElementById('cancel-button').click();
    inventory=inventory.filter(n=>![testScroll.name,blankScroll.name].includes(n));inventoryProperties=inventoryProperties.filter(p=>![testScroll.name,blankScroll.name].includes(InventoryUi.parseProperties([p])[0]?.name));
    inventory=inventory.filter(n=>n!==testBook.name);inventoryProperties=inventoryProperties.filter(p=>InventoryUi.parseProperties([p])[0]?.name!==testBook.name);refreshFixture();
    checkpoint('physical-world-interactions');
    InventoryUi.toggle(false);
    const pd = { ...d, tiles: {}, cells: JSON.parse(JSON.stringify(d.cells)), sceneObjects: [], sceneLandmarks: [] };
    const design = PhysicalPuzzles.compile({ kind:'alignment',title:'Probe instrument',context:'A survey instrument stands here.',lore:'An old route is recorded.',
      controls:[{id:'west',label:'West dial',mark:'Crown',options:['Sun','Moon','Wave'],initial:0,goal:1},
        {id:'east',label:'East dial',mark:'Eye',options:['Sun','Moon','Wave'],initial:0,goal:2}] });
    PhysicalPuzzles.install(pd,{puzzleMechanism:design}); window.currentDungeon = pd;
    const pf = pd.physicalPuzzle.fixtures[0], xy = pf.key.split(',').map(Number);
    const eye = {x:xy[0]+1.5,y:xy[1]+.5}, camera={...eye,eyeZ:.65,dirX:-1,dirY:0,planeScale:Math.tan(Math.PI/6),verticalScale:1.3,viewShift:0};
    const view = document.createElement('canvas'); view.width=240;view.height=180;
    view.style.cssText='position:fixed;left:80px;top:100px;width:240px;height:180px;z-index:12000'; document.body.appendChild(view);
    const rect=view.getBoundingClientRect(), at={clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,bubbles:true};
    document.getElementById('chatuserinput').value='';
    WorldInteractionUi.updateFrame(pd,camera,view,eye); view.dispatchEvent(new PointerEvent('pointermove',at));
    checks.reachableControlShowsHandAndName=view.style.cursor==='pointer' && document.getElementById('world-interaction-caption').textContent.includes('West dial | Crown: Sun');
    const popupCount=document.querySelectorAll('.popup-container').length;
    view.dispatchEvent(new MouseEvent('click',at)); await new Promise(resolve=>setTimeout(resolve,5));
    checks.puzzleClickUsesOriginalText=commands.at(-1)==='turn West dial' && pd.physicalPuzzle.state.values[0]===1;
    checks.puzzleClickCreatesNoMenu=document.querySelectorAll('.popup-container').length===popupCount;
    document.getElementById('chatuserinput').value='turn West dial'; await chatbotprocessinput();
    checks.textPuzzleCommandDoesNotTravel=commands.at(-1)==='turn West dial' && pd.physicalPuzzle.state.values[0]===2;
    document.getElementById('chatuserinput').value='my unfinished command';
    const commandCount=commands.length; view.dispatchEvent(new MouseEvent('click',at)); await new Promise(resolve=>setTimeout(resolve,5));
    checks.worldClickPreservesTypedDraft=commands.length===commandCount && document.getElementById('chatuserinput').value==='my unfinished command';
    document.getElementById('chatuserinput').value=''; window.gamePaused=true;
    view.dispatchEvent(new PointerEvent('pointermove',at)); view.dispatchEvent(new MouseEvent('click',at));
    checks.pausedWorldDoesNotInteract=commands.length===commandCount && view.style.cursor==='default'; window.gamePaused=false;
    const loadingCount = commands.length;
    GameCommandGate.transportStarted('/processInput7');
    checks.loadingDisablesCommandButton = document.querySelector('#chatbotcontainer button').disabled;
    view.dispatchEvent(new PointerEvent('pointermove',at)); view.dispatchEvent(new MouseEvent('click',at));
    document.getElementById('chatuserinput').value='turn West dial'; await chatbotprocessinput();
    checks.loadingBlocksDirectAndPropCommands = commands.length===loadingCount && view.style.cursor==='default';
    contentDiv.querySelector('.clickable-object')?.click();
    checks.loadingBlocksConsoleLinks = !document.getElementById('take-button');
    checks.loadingDoesNotPauseWorld = !window.gamePaused && !window._combatCommandPending;
    GameCommandGate.transportFinished('/poll-task2/probe',{status:'processing'});
    checks.processingKeepsCommandLocked = document.querySelector('#chatbotcontainer button').disabled;
    GameCommandGate.transportFinished('/poll-task2/probe',{status:'complete'});
    checks.completedCommandUnlocksUi = !document.querySelector('#chatbotcontainer button').disabled;
    document.getElementById('chatuserinput').value='';
    DungeonActionNotices.reset();
    const notice = {id:'probe-solve',runId:'ui-probe',geoKey:'0,0,0',kind:'puzzle-complete',title:'Survey Archive',
      message:'The reading cabinet opens. 250 XP awarded. Check the Game Log for the full details.'};
    checks.puzzleCompletionNoticeAccepted = DungeonActionNotices.receive(notice);
    const noticePanel=document.getElementById('dungeon-action-notice'), noticeRect=noticePanel.getBoundingClientRect();
    checks.completionNoticeHasLogCue = noticePanel.textContent.includes('Puzzle Solved') && noticePanel.textContent.includes('250 XP') && noticePanel.textContent.includes('Game Log');
    checks.actionNoticeStaysAbovePrompt = noticeRect.bottom <= document.getElementById('chatuserinput').getBoundingClientRect().top;
    checks.actionNoticeFitsViewport = noticeRect.left>=0 && noticeRect.top>=0 && noticeRect.right<=innerWidth && noticeRect.bottom<=innerHeight;
    checks.actionNoticesRejectDuplicates = !DungeonActionNotices.receive(notice);
    const noticeClose=document.getElementById('dungeon-action-notice-close'), noticeCloseBounds=noticeClose.getBoundingClientRect();
    checks.actionNoticeCloseIsClickable = noticeClose.getAttribute('aria-label')==='Dismiss action notice' && getComputedStyle(noticeClose).pointerEvents==='auto' &&
      document.elementFromPoint(noticeCloseBounds.left+noticeCloseBounds.width/2,noticeCloseBounds.top+noticeCloseBounds.height/2)===noticeClose;
    if(!checks.actionNoticeCloseIsClickable)window.probeDiagnostics={noticeCloseBounds,noticeRect,hit:document.elementFromPoint(noticeCloseBounds.left+noticeCloseBounds.width/2,noticeCloseBounds.top+noticeCloseBounds.height/2)?.outerHTML?.slice(0,500)};
    GameCommandGate.transportStarted('/processInput7');
    const noticeCommands=commands.length;
    noticeClose.click();
    checks.actionNoticeXWorksDuringLoading = noticePanel.hidden && GameCommandGate.busy() && commands.length===noticeCommands;
    GameCommandGate.transportFinished('/processInput7',{completedStartResult:{}});
    DungeonActionNotices.reset();
    actors.push({name:'Defeated probe guard',type:'monster',hp:0,state:'Dead',sprite:{dataUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="gold" d="M4 2h16v20H4z"/></svg>')}});
    DungeonActionNotices.receive({...notice,id:'probe-kill',kind:'defeat',title:'Defeated probe guard',subject:'Defeated probe guard',actor:'Mortacia',result:'defeated',message:'Killed by Mortacia.'});
    checks.defeatedActorNoticeKeepsPortrait = !noticePanel.hidden && noticePanel.textContent.includes('Killed by Mortacia') && noticePanel.querySelector('img').src.startsWith('data:image/svg+xml,');
    DungeonActionNotices.reset(); actors.pop();
    DungeonActionNotices.receive({...notice,id:'probe-reading',kind:'document-read',result:'observed',title:'An Unfinished Covenant',
      message:'Retrieve the verdant graveplate. Defeat the sentries or recruit them, then speak with Nera. '.repeat(7)});
    DungeonActionNotices.receive({...notice,id:'probe-after-reading',kind:'item-taken',title:'A later pickup',message:'Added to your backpack.'});
    const actualTime=DungeonLife.time;DungeonLife.time=()=>actualTime()+3600000;
    try{DungeonActionNotices.tick();}finally{DungeonLife.time=actualTime;}
    checks.readingWaitsForX=!noticePanel.hidden&&noticePanel.dataset.dismissal==='manual'&&noticePanel.textContent.includes('An Unfinished Covenant')&&noticePanel.textContent.includes('Close with X');
    const readingRect=noticePanel.getBoundingClientRect(),readingBody=noticePanel.querySelector('.dungeon-action-content');
    checks.readingFitsViewport=readingRect.left>=0&&readingRect.top>=0&&readingRect.right<=innerWidth+1&&readingRect.bottom<=innerHeight+1;
    checks.readingCanScroll=getComputedStyle(readingBody).overflowY==='auto'&&getComputedStyle(noticePanel).pointerEvents==='auto';
    const readingClose=noticeClose.getBoundingClientRect();
    checks.longReadingXAccessible=document.elementFromPoint(readingClose.left+readingClose.width/2,readingClose.top+readingClose.height/2)===noticeClose;
    noticeClose.click();checks.readingXClosesImmediately=noticePanel.hidden;
    DungeonActionNotices.tick();checks.nextNoticeWaitedForReading=noticePanel.textContent.includes('A later pickup');DungeonActionNotices.reset();
    pd.cells[pf.key].tile='custom_probe_prop'; delete pd.cells[pf.key].puzzleFixture; delete pd.physicalPuzzle;
    pd.tiles.custom_probe_prop={landmark:{label:'Weathered survey pedestal'},spriteSpec:{baseWidth:.7,heightRatio:.4}}; pd._geometryStamp='new-prop';
    WorldInteractionUi.updateFrame(pd,camera,view,eye); view.dispatchEvent(new PointerEvent('pointermove',at));
    checks.decorativePropShowsNameWithoutHand=view.style.cursor==='default' && document.getElementById('world-interaction-caption').textContent.includes('Weathered survey pedestal');
    const caption=document.getElementById('world-interaction-caption'), labelRect=caption.getBoundingClientRect();
    checks.worldLabelStaysOnScreenAtPageZoom=!caption.hidden && labelRect.left>=0 && labelRect.top>=0 && labelRect.right<=innerWidth && labelRect.bottom<=innerHeight;
    checks.worldLabelFollowsPointerAtPageZoom=Math.abs(labelRect.top-(at.clientY+18))<3;
    pd.surfaceArt=[{key:pf.key,label:'Mortacia shrine inscription',description:'The White Lady remembers the departed.',text:'Memory endures.',
      surface:'wall',position:{x:xy[0]+.84,y:xy[1]+.18,z:.4},size:{x:.02,y:.64,z:.5}}];
    WorldInteractionUi.updateFrame(pd,camera,view,eye);view.dispatchEvent(new PointerEvent('pointermove',at));
    checks.artworkShowsHandAndMeaning=view.style.cursor==='pointer'&&caption.textContent.includes('The White Lady remembers');
    const beforeArtCommands=commands.length;view.dispatchEvent(new MouseEvent('click',at));
    checks.artworkReadsWithoutApi=commands.length===beforeArtCommands&&!noticePanel.hidden&&noticePanel.textContent.includes('Memory endures.');
    noticeClose.click();checks.artworkReadCanBeDismissed=noticePanel.hidden;
    GameCommandGate.transportStarted('/processInput7');view.dispatchEvent(new MouseEvent('click',at));
    checks.loadingBlocksArtworkRead=noticePanel.hidden&&commands.length===beforeArtCommands;
    GameCommandGate.transportFinished('/processInput7',{completedStartResult:{}});pd.surfaceArt=[];
    pd.tiles.custom_probe_prop.spriteSpec.inscription={id:'inscription_0',name:'tablet of the departed'};
    pd._geometryStamp='inscription-probe';document.getElementById('chatuserinput').value='';
    WorldInteractionUi.updateFrame(pd,camera,view,eye);view.dispatchEvent(new PointerEvent('pointermove',at));
    checks.inscriptionShowsHandAndReadHint=view.style.cursor==='pointer'&&caption.textContent.includes('read inscription');
    view.dispatchEvent(new MouseEvent('click',at));await new Promise(resolve=>setTimeout(resolve,5));
    checks.inscriptionClickUsesLiteralRead=commands.at(-1)==='read tablet of the departed';
    const inscriptionCommands=commands.length;document.getElementById('chatuserinput').value='';
    GameCommandGate.transportStarted('/processInput7');view.dispatchEvent(new MouseEvent('click',at));
    checks.loadingBlocksInscriptionRead=commands.length===inscriptionCommands;
    GameCommandGate.transportFinished('/processInput7',{completedStartResult:{}});
    delete pd.tiles.custom_probe_prop.spriteSpec.inscription;
    for (const cell of Object.values(pd.cells)) if (cell.puzzleFixture) { cell.tile='floor'; delete cell.puzzleFixture; }
    pd.cells[pf.key].tile='floor'; pd._geometryStamp='item-probe'; roomItems=['silver dagger']; refreshFixture(); bindOriginalActions();
    window.getVisibleSceneObjects=()=>[{name:'silver dagger',x:xy[0],y:xy[1]}];
    const itemAt={...at,clientY:rect.top+rect.height*.65};
    WorldInteractionUi.updateFrame(pd,camera,view,eye); view.dispatchEvent(new PointerEvent('pointermove',itemAt));
    checks.reachableItemShowsHand=view.style.cursor==='pointer';
    view.dispatchEvent(new PointerEvent('pointerdown',{...itemAt,bubbles:true,cancelable:true,pointerId:70,isPrimary:true,button:0,buttons:1}));
    view.dispatchEvent(new PointerEvent('pointerup',{...itemAt,bubbles:true,cancelable:true,pointerId:70,isPrimary:true,button:0,buttons:0}));
    view.dispatchEvent(new MouseEvent('click',itemAt)); await new Promise(resolve=>setTimeout(resolve,5));
    checks.worldItemClickUsesExistingTakeConfirmation=!!document.getElementById('take-button');
    document.getElementById('take-button')?.click(); await new Promise(resolve=>setTimeout(resolve,5));
    checks.worldPickupUsesOriginalTakeCommand=commands.at(-1)==='take silver dagger' && roomItems.length===0;
    roomItems=['silver dagger']; refreshFixture(); bindOriginalActions();
    view.dispatchEvent(new PointerEvent('pointermove',itemAt));
    checks.worldCanvasCannotDragScreen = !view.draggable && !view.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));
    function dragItemToPack(canvas, start, id) {
      const pack = document.getElementById('dungeon-inventory-shortcut'), bounds=pack.getBoundingClientRect();
      const dropAt = {clientX:bounds.left+bounds.width/2,clientY:bounds.top+bounds.height/2,bubbles:true,cancelable:true,pointerId:id,isPrimary:true,button:0,buttons:1};
      canvas.dispatchEvent(new PointerEvent('pointerdown',{...start,bubbles:true,cancelable:true,pointerId:id,isPrimary:true,button:0,buttons:1}));
      canvas.dispatchEvent(new PointerEvent('pointermove',dropAt));
      checks.itemOnlyDragPreview = (checks.itemOnlyDragPreview ?? true) && !!document.getElementById('world-item-drag-preview')?.querySelector('img') &&
        document.getElementById('world-item-drag-preview').textContent.includes('silver dagger');
      checks.backpackHighlightsForWorldDrop = (checks.backpackHighlightsForWorldDrop ?? true) && pack.classList.contains('world-item-drop-hover');
      const previewBounds=document.getElementById('world-item-drag-preview').getBoundingClientRect();
      checks.itemDragPreviewFitsViewport = (checks.itemDragPreviewFitsViewport ?? true) && previewBounds.left>=0 && previewBounds.top>=0 &&
        previewBounds.right<=innerWidth && previewBounds.bottom<=innerHeight;
      pack.querySelector('img').dispatchEvent(new PointerEvent('pointerup',{...dropAt,buttons:0}));
      canvas.dispatchEvent(new MouseEvent('click',start));
      checks.worldDragPreviewClearedOnDrop = !document.getElementById('world-item-drag-preview') && !pack.classList.contains('world-item-drop-hover');
    }
    dragItemToPack(view,itemAt,71);
    await new Promise(resolve=>setTimeout(resolve,5));
    checks.dragWorldItemToBackpackAsksBeforeTaking=!!document.getElementById('take-button');
    document.getElementById('cancel-button')?.click();
    checks.cancelWorldDragKeepsItem=roomItems.includes('silver dagger');
    const packBounds=document.getElementById('dungeon-inventory-shortcut').getBoundingClientRect();
    const packPoint={clientX:packBounds.left+packBounds.width/2,clientY:packBounds.top+packBounds.height/2,bubbles:true,cancelable:true,isPrimary:true,button:0,buttons:1};
    function startItemDrag(id) {
      view.dispatchEvent(new PointerEvent('pointerdown',{...itemAt,bubbles:true,cancelable:true,pointerId:id,isPrimary:true,button:0,buttons:1}));
      view.dispatchEvent(new PointerEvent('pointermove',{...packPoint,pointerId:id}));
    }
    startItemDrag(74); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    view.dispatchEvent(new PointerEvent('pointerup',{...itemAt,pointerId:74,isPrimary:true,bubbles:true,button:0,buttons:0}));
    view.dispatchEvent(new MouseEvent('click',itemAt));
    checks.escapeCancelsWorldDrag = !document.getElementById('world-item-drag-preview') && !document.getElementById('take-button') && roomItems.includes('silver dagger');
    startItemDrag(75); GameCommandGate.transportStarted('/processInput7');
    document.getElementById('dungeon-inventory-shortcut').dispatchEvent(new PointerEvent('pointerup',{...packPoint,pointerId:75,buttons:0}));
    view.dispatchEvent(new MouseEvent('click',itemAt));
    checks.loadingCancelsWorldDrop = !document.getElementById('take-button') && !document.getElementById('world-item-drag-preview');
    GameCommandGate.transportFinished('/processInput7',{completedStartResult:{}});
    startItemDrag(76);
    WorldInteractionUi.updateFrame(pd,{...camera,x:xy[0]+4.5},view,{...eye,x:xy[0]+4.5});
    document.getElementById('dungeon-inventory-shortcut').dispatchEvent(new PointerEvent('pointerup',{...packPoint,pointerId:76,buttons:0}));
    view.dispatchEvent(new MouseEvent('click',itemAt));
    checks.worldDropRechecksPickupReach = !document.getElementById('take-button') && !document.getElementById('world-item-drag-preview') && roomItems.includes('silver dagger');
    WorldInteractionUi.updateFrame(pd,camera,view,eye);
    const furtherEye={...eye,x:xy[0]+2.75}, furtherCamera={...camera,...furtherEye};
    WorldInteractionUi.updateFrame(pd,furtherCamera,view,furtherEye); view.dispatchEvent(new PointerEvent('pointermove',itemAt));
    checks.longerPickupReachShowsHand = view.style.cursor==='pointer' && !caption.textContent.includes('Walk closer');
    view.dispatchEvent(new MouseEvent('click',itemAt)); await new Promise(resolve=>setTimeout(resolve,5));
    checks.longerPickupReachUsesTakeConfirmation = !!document.getElementById('take-button'); document.getElementById('cancel-button')?.click();
    dragItemToPack(view,itemAt,72); await new Promise(resolve=>setTimeout(resolve,5));
    checks.longerPickupReachAllowsBackpackDrag = !!document.getElementById('take-button'); document.getElementById('cancel-button')?.click();
    WorldInteractionUi.updateFrame(pd,camera,view,eye);
    checkpoint('webgpu-world-interactions');
    roomItems=['chronicle of the pale court'];refreshFixture();bindOriginalActions();document.getElementById('chatuserinput').value='';
    document.querySelector('.clickable-object[data-object="chronicle of the pale court"]').click();
    checks.consoleGroundBookHasReadAndTake=!!document.getElementById('read-item-button')&&!!document.getElementById('take-button');
    document.getElementById('read-item-button').click();await new Promise(resolve=>setTimeout(resolve,5));
    checks.consoleGroundBookReadsWithoutTaking=commands.at(-1)==='read chronicle of the pale court'&&roomItems.length===1;
    document.getElementById('chatuserinput').value='';
    window.getVisibleSceneObjects=()=>[{name:roomItems[0],type:'other',x:xy[0],y:xy[1]}];
    WorldInteractionUi.updateFrame(pd,camera,view,eye);view.dispatchEvent(new PointerEvent('pointermove',itemAt));
    view.dispatchEvent(new MouseEvent('click',itemAt));await new Promise(resolve=>setTimeout(resolve,5));
    checks.groundBookHasReadAndTake=!!document.getElementById('read-item-button')&&!!document.getElementById('take-button');
    document.getElementById('read-item-button')?.click();await new Promise(resolve=>setTimeout(resolve,5));
    checks.groundBookReadDoesNotTakeIt=commands.at(-1)==='read chronicle of the pale court'&&roomItems.length===1&&!document.getElementById('take-button');
    roomItems=['silver dagger'];refreshFixture();bindOriginalActions();document.getElementById('chatuserinput').value='';
    window.getVisibleSceneObjects=()=>[{name:'silver dagger',x:xy[0],y:xy[1]}];
    const viewport=document.createElement('div'); viewport.id='dungeon-container';
    viewport.style.cssText='position:fixed;left:80px;top:100px;width:240px;height:180px;z-index:12000';
    document.body.appendChild(viewport); view.style.cssText=''; viewport.appendChild(view);
    window.webglDungeonRenderer={canvas:view,init(){},renderScene(){WorldInteractionUi.updateFrame(pd,camera,view,eye);}};
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/assets/rendererWebGPU.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});
    const gpu=window.webgpuDungeonRenderer; gpu._container=viewport; gpu.mode='webgpu'; gpu._presentedAtLeastOnce=true;
    const presented=gpu._createPresentationCanvas(); gpu._attachWebGPUViewport();
    const gpuRect=presented.getBoundingClientRect(), gpuAt={...at,clientX:gpuRect.left+gpuRect.width/2,clientY:gpuRect.top+gpuRect.height*.65};
    gpu.renderScene(); presented.dispatchEvent(new PointerEvent('pointermove',gpuAt));
    checks.webgpuItemHoverUsesPresentedCanvas=presented.style.cursor==='pointer' && !caption.hidden && caption.textContent.includes('silver dagger');
    gpu.renderScene();
    checks.webgpuSourceFramesKeepPresentedHover=presented.style.cursor==='pointer' && !caption.hidden && view.parentNode!==viewport;
    presented.dispatchEvent(new MouseEvent('click',gpuAt)); await new Promise(resolve=>setTimeout(resolve,5));
    checks.webgpuItemClickUsesExistingTakeConfirmation=!!document.getElementById('take-button');
    document.getElementById('cancel-button')?.click();
    view.dispatchEvent(new PointerEvent('pointermove',itemAt)); view.dispatchEvent(new MouseEvent('click',itemAt));
    checks.hiddenWebglSourceDoesNotInteract=caption.hidden && !document.getElementById('take-button');
    presented.dispatchEvent(new PointerEvent('pointermove',gpuAt));
    checks.webgpuCanvasCannotDragScreen = !presented.draggable && !presented.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));
    dragItemToPack(presented,gpuAt,73);
    await new Promise(resolve=>setTimeout(resolve,5));
    checks.webgpuDragToBackpackUsesTakeConfirmation=!!document.getElementById('take-button');
    document.getElementById('cancel-button')?.click();
    gpu._restoreLegacyViewport('UI probe'); gpu.renderScene();
    const legacyRect=view.getBoundingClientRect(), legacyAt={...gpuAt,clientX:legacyRect.left+legacyRect.width/2,clientY:legacyRect.top+legacyRect.height*.65};
    view.dispatchEvent(new PointerEvent('pointermove',legacyAt)); view.dispatchEvent(new MouseEvent('click',legacyAt));
    await new Promise(resolve=>setTimeout(resolve,5));
    checks.webgpuFallbackRestoresWorldPicking=view.parentNode===viewport && !!document.getElementById('take-button');
    document.getElementById('cancel-button')?.click();
    pd.cells[pf.key].tile='custom_probe_prop'; pd._geometryStamp='gpu-prop'; window.getVisibleSceneObjects=()=>[];
    gpu.mode='webgpu'; gpu._presentedAtLeastOnce=true; gpu._attachWebGPUViewport(); gpu.renderScene();
    const propAt={...gpuAt,clientY:gpuRect.top+gpuRect.height/2};
    presented.dispatchEvent(new PointerEvent('pointermove',propAt));
    checks.webgpuPropHoverShowsName=!caption.hidden && caption.textContent.includes('Weathered survey pedestal');
    window.WEBGPU_NATIVE_WORLD=true; gpu.renderScene();
    checks.nativeWebgpuKeepsWorldPicking=!caption.hidden && caption.textContent.includes('Weathered survey pedestal');

    // Use actual projected footprints, not placeholder item boxes, for character and loot interactions.
    pd.cells[pf.key].tile='floor'; pd._geometryStamp='billboard-interactions'; pd.surfaceArt=[];
    const worldMonster={name:'World Dragon',type:'monster',hp:20};
    const worldNpc={name:'Zarthul the Veiled Sentinel',type:'npc',hp:20};
    window.combatCharacters=[worldMonster,worldNpc]; window._combatMonsterSheets=sheet(makeCharacter(worldMonster.name,'monster'));
    const pixels={w:4,h:4,data:new Uint8ClampedArray(64).fill(255)};
    const footprint={type:'character',label:worldMonster.name,character:worldMonster,key:pf.key,enabled:true,command:'inspect',distance:1,
      pixels,screen:{left:.3,right:.7,top:.2,bottom:.8}};
    camera.billboards=[footprint]; gpu.renderScene();
    presented.dispatchEvent(new PointerEvent('pointermove',propAt));
    checks.worldCharacterHoverShowsName=!caption.hidden&&caption.textContent.includes(worldMonster.name);
    presented.dispatchEvent(new MouseEvent('click',propAt));
    checks.worldMonsterClickShowsSheetAndActions=document.getElementById('party-popup-name').textContent===worldMonster.name&&!!actionButton('Attack')&&!!actionButton('Give Item');
    document.getElementById('party-popup-close').click();
    checks.closingWorldSheetWithXClearsActions=!document.querySelector('.combat-character-actions');
    for(let i=0;i<3;i++){
      presented.dispatchEvent(new PointerEvent('pointermove',propAt));
      presented.dispatchEvent(new MouseEvent('click',propAt));
      checks.worldMonsterReopensAfterX=(checks.worldMonsterReopensAfterX??true)&&getComputedStyle(document.getElementById('party-popup')).display!=='none'&&!!actionButton('Attack');
      if(getComputedStyle(document.getElementById('party-popup')).display!=='none')document.getElementById('party-popup-close').click();
    }
    camera.billboards=[{...footprint,label:worldNpc.name,character:worldNpc}];gpu.renderScene();
    presented.dispatchEvent(new MouseEvent('click',propAt));
    checks.worldCompanionClickShowsRemove=!!actionButton('Remove');
    document.getElementById('party-popup-close').click();
    presented.dispatchEvent(new PointerEvent('pointermove',propAt));presented.dispatchEvent(new MouseEvent('click',propAt));
    checks.worldCompanionReopensAfterX=!!actionButton('Remove');
    document.getElementById('party-popup-close').click();
    const staleActions=document.createElement('div');staleActions.className='popup-container combat-character-actions';
    document.getElementById('party-popup').appendChild(staleActions);
    presented.dispatchEvent(new PointerEvent('pointermove',propAt));presented.dispatchEvent(new MouseEvent('click',propAt));
    checks.hiddenStaleActionsDoNotBlockWorldClicks=!!actionButton('Remove')&&caption.textContent.includes(worldNpc.name);
    document.getElementById('party-popup-close').click();

    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/assets/objectDiscovery.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});
    const lootLink=contentDiv.querySelector('.clickable-object');
    const itemList=document.createElement('span');itemList.dataset.roomObjectList='';
    const itemEntry=document.createElement('span');itemEntry.dataset.roomObject='silver dagger';itemEntry.hidden=true;
    const comma=document.createElement('span');comma.dataset.objectComma='';comma.textContent=', ';itemEntry.appendChild(comma);itemEntry.appendChild(lootLink);
    const empty=document.createElement('span');empty.dataset.noVisibleObjects='';empty.textContent='None in view';itemList.append(itemEntry,empty);contentDiv.appendChild(itemList);
    const itemProperties=document.createElement('span');itemProperties.dataset.roomObjectProperties='';contentDiv.appendChild(itemProperties);
    const remainingObjects=document.createElement('span');remainingObjects.dataset.roomObjectCount='';contentDiv.append('Objects in Room Remaining: ',remainingObjects);
    contentDiv.dataset.roomObjectProperties=JSON.stringify(stock[5]);
    contentDiv.dataset.roomObjects='silver dagger, hidden key';
    DungeonActionNotices.reset();ObjectDiscovery.reset();
    const loot={...footprint,type:'item',character:undefined,label:'silver dagger',item:{name:'silver dagger',x:xy[0],y:xy[1]}};
    camera.billboards=[loot];gpu.renderScene();
    checks.visibleLootDiscoveredOnce=!itemEntry.hidden&&ObjectDiscovery.hasDiscovered(pd,'silver dagger')&&noticePanel.textContent.includes('Object Discovered');
    checks.discoveredLootPropertiesVisible=itemProperties.textContent.includes('silver dagger');
    checks.remainingObjectsIncludesUnseenLoot=remainingObjects.textContent==='2'&&!itemProperties.textContent.includes('hidden key');
    const pendingItem=document.createElement('div');pendingItem.className='popup-container';pendingItem.dataset.dungeonItem='silver dagger';document.body.appendChild(pendingItem);
    camera.billboards=[];gpu.renderScene();
    checks.lookingAwayHidesLootAndClosesStaleActions=itemEntry.hidden&&!itemProperties.textContent.includes('silver dagger')&&!pendingItem.isConnected;
    checks.lookingAwayDoesNotReduceRemainingLoot=remainingObjects.textContent==='2';
    contentDiv.dataset.roomObjects='hidden key';ObjectDiscovery.refreshConsole();
    checks.remainingObjectsUpdatesAfterPickup=remainingObjects.textContent==='1';
    contentDiv.dataset.roomObjects='hidden key, dropped sword';ObjectDiscovery.refreshConsole();
    checks.remainingObjectsUpdatesAfterDrop=remainingObjects.textContent==='2';
    contentDiv.dataset.roomObjects='None';ObjectDiscovery.refreshConsole();
    checks.emptyRoomHasZeroRemainingObjects=remainingObjects.textContent==='0';
    contentDiv.dataset.roomObjects='silver dagger, hidden key';ObjectDiscovery.refreshConsole();
    DungeonActionNotices.reset();camera.billboards=[loot];gpu.renderScene();
    checks.rediscoveryDoesNotNotifyOrPickUp=pd.objectDiscoveries.names.length===1&&noticePanel.hidden&&roomItems.includes('silver dagger');
    camera.billboards=[];gpu.renderScene();

    const turnPosts=[], previousFetch=window.fetch;
    window.fetch=async(url,options)=>{if(url==='/submit-target2'){turnPosts.push(JSON.parse(options.body));return{ok:true,json:async()=>({status:'success'})};}return previousFetch(url,options);};
    const turn={allowRetreat:true,turnId:'player-turn',actionId:'combat',round:2,combatant:'Mortacia',targets:[worldMonster.name],initiative:[{name:'Mortacia',roll:18}],
      care:[{kind:'bandage',target:worldNpc.name,label:'Bandage '+worldNpc.name}]};
    window.renderPartyIconDock=()=>{
      const dock=document.getElementById('party-icon-dock');
      dock.querySelectorAll('.combat-target-controls,.party-roll-status,.combat-end-controls').forEach(n=>n.remove());window.renderPartyDice(dock,[]);
    };
    window.actionDiceState={active:{id:'combat',kind:'combat',turn},paused:false};CombatTurnUi.receive(turn);
    const combatNames=document.createElement('div');combatNames.innerHTML='<span class="clickable-npc" data-npc="'+worldNpc.name+'">'+worldNpc.name+'</span><span class="clickable-monster" data-monster="'+worldMonster.name+'">'+worldMonster.name+'</span>';
    contentDiv.appendChild(combatNames);GameCommandGate.transportStarted('/processInput7');
    combatNames.querySelector('.clickable-npc').click();
    checks.consoleCanSelectObscuredAllyDuringCombat=!!document.querySelector('.combat-target-actions')?.textContent.includes('Bandage '+worldNpc.name)&&!document.getElementById('remove-button');
    document.querySelector('.combat-target-actions button:last-child')?.click();
    openPartySheet(1);
    checks.partyPortraitOpensCombatCare=!!document.querySelector('.combat-target-actions')?.textContent.includes('Bandage '+worldNpc.name)&&document.getElementById('party-popup').style.display==='none';
    document.querySelector('.combat-target-actions button:last-child')?.click();
    combatNames.querySelector('.clickable-monster').click();
    checks.consoleMonsterUsesTurnScopedAttack=!!document.querySelector('.combat-target-actions')?.textContent.includes('Attack '+worldMonster.name)&&turnPosts.length===0;
    document.querySelector('.combat-target-actions button:last-child')?.click();
    openPartySheet(1);document.querySelector('.combat-target-actions .popup-button')?.click();await new Promise(resolve=>setTimeout(resolve,5));
    checks.avatarBandageUsesPublishedTurn=turnPosts.at(-1)?.action==='care'&&turnPosts.at(-1)?.target===worldNpc.name&&turnPosts.at(-1)?.turnId===turn.turnId;
    turnPosts.length=0;CombatTurnUi.receive(turn);combatNames.remove();GameCommandGate.transportFinished('/processInput7',{completedStartResult:{}});
    document.getElementById('combat-attack-button').click();
    const enemySelect=document.getElementById('combat-attack-select');enemySelect.value=worldMonster.name;enemySelect.dispatchEvent(new Event('change'));
    checks.attackDropdownIsLowerLeft=!!enemySelect.closest('#party-icon-dock');document.getElementById('combat-attack-confirm').click();
    await new Promise(resolve=>setTimeout(resolve,5));
    checks.attackDropdownSubmitsWithoutRedundantPopup=turnPosts.length===1&&turnPosts[0].action==='attack'&&turnPosts[0].target===worldMonster.name&&turnPosts[0].turnId===turn.turnId&&!document.querySelector('.combat-target-actions');
    turnPosts.length=0;
    const approachTurn={...turn,turnId:'approach-turn',tactical:true,movement:{remaining:6,total:6},attackTargets:[],approachTargets:[{name:worldMonster.name,cost:3}]};
    CombatTurnUi.receive(approachTurn);document.getElementById('combat-attack-button').click();
    checks.approachDropdownOffersDirectMoveAttack=document.getElementById('combat-attack-confirm').textContent==='Move + Attack';
    document.getElementById('combat-attack-confirm').click();await new Promise(resolve=>setTimeout(resolve,5));
    checks.approachDropdownSubmitsOnce=turnPosts.length===1&&turnPosts[0].action==='attack'&&turnPosts[0].turnId===approachTurn.turnId&&!document.querySelector('.combat-target-actions');
    turnPosts.length=0;
    const spellTurn={...turn,turnId:'spell-turn',tactical:true,movement:{remaining:6,total:6},attackTargets:[],approachTargets:[],spells:[{name:'Ranged Test Spell',target:worldMonster.name,cost:1,itemName:'staff',magic:3}]};
    CombatTurnUi.receive(spellTurn);document.getElementById('combat-attack-button').click();
    checks.spellOnlyTargetOffersSpellChoice=document.getElementById('combat-attack-confirm').textContent==='Choose Spell';
    document.getElementById('combat-attack-confirm').click();
    checks.spellOnlyTargetKeepsActionOptions=turnPosts.length===0&&document.querySelector('.combat-target-actions')?.textContent.includes('Ranged Test Spell');
    document.querySelector('.combat-target-actions button:last-child')?.click();CombatTurnUi.receive(turn);
    const threeControls=[...document.querySelectorAll('.combat-end-controls > button')];
    checks.threeCombatControlsShareOneRow=threeControls.length===3&&threeControls.every(b=>Math.abs(b.getBoundingClientRect().top-threeControls[0].getBoundingClientRect().top)<2);
    const turnPanel=document.getElementById('combat-turn-popup'),turnBounds=turnPanel.getBoundingClientRect();
    checks.playerTurnPopupCentered=Math.abs((turnBounds.left+turnBounds.right)/2-innerWidth/2)<2&&Math.abs((turnBounds.top+turnBounds.bottom)/2-innerHeight/2)<2;
    checks.playerTurnHasInitiativeAndRetreat=turnPanel.textContent.includes('Mortacia (18)')&&!turnPanel.querySelector('button')&&!!document.getElementById('combat-retreat-button')?.closest('#party-icon-dock');
    window.gamePaused=true;CombatTurnUi.receive(turn);document.getElementById('combat-retreat-button').click();
    checks.pausedTurnCannotRetreat=turnPosts.length===0;
    window.gamePaused=false;CombatTurnUi.receive(turn);document.getElementById('combat-retreat-button').click();
    await new Promise(resolve=>setTimeout(resolve,5));
    checks.retreatCarriesScopedTurnId=turnPosts[0]?.action==='retreat'&&turnPosts[0]?.turnId===turn.turnId&&turnPanel.hidden;
    window.renderPartyIconDock=()=>{
      const dock=document.getElementById('party-icon-dock');
      dock.querySelectorAll('.combat-target-controls,.party-roll-status,.combat-end-controls').forEach(n=>n.remove());window.renderPartyDice(dock,[]);
    };
    const npcTurn={...turn,allowRetreat:false,turnId:'npc-turn',combatant:'Companion'};
    window.receiveDiceState({type:'dice_state',epoch:'probe-turns',revision:1,active:{id:'combat',kind:'combat',turn:npcTurn},results:[],paused:false});
    const npcChoices=document.querySelector('.combat-target-controls');
    checks.reconnectedNpcTurnRestoresScopedChoices=!!npcChoices&&npcChoices.textContent.includes('Companion')&&!turnPanel.querySelector('button');
    npcChoices.querySelector('button').click();await new Promise(resolve=>setTimeout(resolve,5));
    checks.npcAttackCarriesScopedTurnId=turnPosts.at(-1)?.turnId==='npc-turn'&&turnPosts.at(-1)?.action==='attack';
    window.receiveDiceState({type:'dice_state',epoch:'probe-turns',revision:2,active:null,results:[],paused:false});window.fetch=previousFetch;
    window.getInventoryGiveItems=()=>InventoryUi.inventoryItems(inventory,inventoryProperties);
    const giveCommands=commands.length;document.getElementById('chatuserinput').value='preserved draft';ItemGiveUi.open(worldMonster.name);
    checks.giveItemRequiresConfirmation=!!document.getElementById('confirm-give-item')&&commands.length===giveCommands;
    document.getElementById('confirm-give-item').click();
    checks.giveItemPreservesCommandDraft=document.getElementById('chatuserinput').value==='preserved draft'&&commands.length===giveCommands&&document.querySelector('.item-give-actions').textContent.includes('draft was preserved');
    document.getElementById('chatuserinput').value='';
    document.getElementById('confirm-give-item').click();await new Promise(resolve=>setTimeout(resolve,5));
    checks.giveItemUsesActualInventory=commands.length===giveCommands+1&&commands.at(-1).startsWith('give ');
    const dockEntries=['Benedict','Uarak Marrowshade','Aecal Zorvath','Theliuse','Jethok Farrows','Selui Zendar','Mortacia'].map(label=>({label,hp:'133/133'}));
    const dockApi=new Function('getPartyInfoEntries',${JSON.stringify(partyDockFunctions + ';return {render:renderPartyIconDock,position:positionPartyIconDock,draw:drawPartySpriteCanvas};')})(()=>dockEntries);
    window.positionPartyIconDock=dockApi.position;dockApi.render();
    const dock=document.getElementById('party-icon-dock'),names=[...dock.querySelectorAll('.party-icon-name')];
    checks.partyDockShowsFullNames=names.every((n,i)=>n.textContent===dockEntries[i].label&&n.scrollWidth<=n.clientWidth+1&&n.scrollHeight<=n.clientHeight+1);
    checks.partyDockKeepsIconsAndFitsPixelLabels=[...dock.querySelectorAll('canvas')].every(c=>c.width===36&&c.height===36)&&names.every(n=>parseFloat(getComputedStyle(n).fontSize)===6);
    const mortaciaAvatar=dock.querySelector('#party-icon-canvas-6'),avatarPixels=mortaciaAvatar.getContext('2d').getImageData(0,0,36,36).data;
    let bladePixels=0;for(let i=0;i<avatarPixels.length;i+=4)if(avatarPixels[i]===244&&avatarPixels[i+1]===206&&avatarPixels[i+2]===142&&avatarPixels[i+3]===255)bladePixels++;
    checks.partyMortaciaSwordVisibleBeforeStartup=bladePixels>=10;
    const avatarBefore=mortaciaAvatar.toDataURL();dockApi.draw(mortaciaAvatar,{label:'Mortacia',source:{name:'Mortacia',type:'pc'},sprite:{dataUrl:'data:stale',artRevision:'old'}});
    checks.partyMortaciaAvatarMatchesAfterStartup=mortaciaAvatar.toDataURL()===avatarBefore;
    const dockBounds=dock.getBoundingClientRect();
    checks.partyDockFitsViewport=dockBounds.top>=0&&dockBounds.bottom<=innerHeight&&dockBounds.right<=innerWidth;
    checks.partyDockDoesNotSquishCommandOrCompass=['chatbotcontainer','dungeon-compass'].every(id=>{
      const r=document.getElementById(id).getBoundingClientRect();return dockBounds.right<=r.left||dockBounds.left>=r.right||dockBounds.bottom<=r.top||dockBounds.top>=r.bottom;
    });
    const dockScale=dockBounds.width/dock.offsetWidth;
    const dockLeftSpace=Math.min(...['chatbotcontainer','dungeon-compass'].map(id=>document.getElementById(id).getBoundingClientRect().left))-dockBounds.left;
    if(dockLeftSpace>=106*dockScale) checks.partyDockStaysInBottomLeft=innerHeight-dockBounds.bottom<=7*dockScale;
    const mapBounds=document.getElementById('combat-popup').getBoundingClientRect();
    if(dockBounds.bottom-mapBounds.bottom>=80*dockScale) checks.partyDockStaysBelowCombatMap=dockBounds.top>=mapBounds.bottom;
    const compassBounds=document.getElementById('dungeon-compass').getBoundingClientRect(),dial=document.querySelector('.compass-dial').getBoundingClientRect();
    checks.smallerCompassStaysCircular=Math.abs(dial.width-dial.height)<1&&parseFloat(getComputedStyle(document.getElementById('dungeon-compass')).width)===88;
    if(compassBounds.right<document.getElementById('chatbotcontainer').getBoundingClientRect().left){
      const gap=document.getElementById('chatbotcontainer').getBoundingClientRect().left-compassBounds.right;
      checks.compassCloserToCommand=gap>0&&gap<8;
    }
    window.combatCharacters=originalActors;
    viewport.remove(); gpu._hiddenHost?.remove(); window.currentDungeon=undefined;
  } catch (error) { errors.push(error.stack); }
  const report = { pass: Object.values(checks).every(Boolean) && !errors.length, checks, errors, diagnostics:window.probeDiagnostics };
  document.getElementById('results').textContent = JSON.stringify(report);
  await probeFetch('/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
});
</script></body></html>`;

const journalStart=index.indexOf('<section id="journal-popup"'),journalMarkup=index.slice(journalStart,index.indexOf('</section>',journalStart)+10);
const journalPage=String.raw`<!doctype html><html><head><meta charset="utf-8"><style>${css}
#chatbotcontainer{position:fixed;left:25%;bottom:8px;width:45%;padding:8px}#game-log-popup{position:fixed;right:8px;top:12px;width:20%}
</style><script src="/assets/adventureJournalUi.js"></script><script src="/assets/mapShortcutUi.js"></script></head><body>
<div id="chatbotcontainer"><textarea id="chatuserinput">unfinished draft</textarea><button>Command</button></div><div id="game-log-popup">Game Log</div>
<button id="dungeon-map-shortcut"><img src="/assets/adventurers-map.svg" alt=""></button>
<button id="dungeon-journal-shortcut"><img src="/assets/adventurers-journal.svg" alt=""></button>
<button id="dungeon-spellbook-shortcut" aria-label="Open party spellbook"><img src="/assets/adventurers-spellbook.svg" alt=""></button>
<button id="dungeon-inventory-shortcut"><img src="/assets/adventurers-pack.svg" alt=""></button>${journalMarkup}
<script>
window.dungeonRunId='journal-probe';window.gamePaused=true;const realFetch=window.fetch.bind(window),posts=[];
let spellbookClicks=0,quickcastClicks=0;window.PartySpellbookUi={open(){spellbookClicks++;},openQuick(){quickcastClicks++;}};
window.fetch=async(url,options)=>{posts.push({url,body:JSON.parse(options.body)});return{ok:true,json:async()=>({runId:'journal-probe',step:1,quest:'The Water Debt',
objective:{title:'Rescue the keeper',description:'Escort the keeper alive to Amber Spring Gardens.',requirements:'Actual arrival and faction resolution required.'},
route:[{status:'Current',room:'Amber Spring Gardens',roomKey:'1,1,0',actor:'Senna'}],facts:[{title:'Burial record',text:'The keeper refused the levy.',room:'Crown Graves'}],
rumors:[{source:'Edrin',text:'The keeper sold the well.',status:'Unverified'}],factions:{factions:[{name:'Cistern Compact',standing:'Trusted',score:2}],decisions:[]},contracts:[],history:[]})};};
document.addEventListener('DOMContentLoaded',async()=>{
  const checks={},errors=[];
  try {
    for(const zoom of [1,1.75,2]) {
      document.body.style.zoom=zoom;window.dispatchEvent(new Event('resize'));
      await window.AdventureJournalUi.toggle(true);
      const popup=document.getElementById('journal-popup'),r=popup.getBoundingClientRect();
      checks['journalFits-'+zoom]=r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;
      checks['journalContent-'+zoom]=popup.textContent.includes('Confirmed Facts')&&popup.textContent.includes('Unverified')&&popup.textContent.includes('Trusted (+2)');
      await window.AdventureJournalUi.toggle(false);
      const map=document.getElementById('dungeon-map-shortcut').getBoundingClientRect(),journal=document.getElementById('dungeon-journal-shortcut').getBoundingClientRect(),pack=document.getElementById('dungeon-inventory-shortcut').getBoundingClientRect();
      checks['shortcutStack-'+zoom]=pack.top>=0&&pack.bottom<journal.top&&journal.bottom<map.top&&Math.abs(pack.left-map.left)<1;
      const book=document.getElementById('dungeon-spellbook-shortcut').getBoundingClientRect(),command=document.getElementById('chatbotcontainer').getBoundingClientRect();
      checks['upsideDownL-'+zoom]=Math.abs(book.top-pack.top)<1&&book.right<pack.left&&book.bottom<=command.top&&book.left>=0&&pack.right<=innerWidth;
      checks['iconsUnchanged-'+zoom]=Math.abs(book.width-pack.width)<1&&Math.abs(book.height-pack.height)<1;
    }
    const spellbook=document.getElementById('dungeon-spellbook-shortcut');
    spellbook.click();await new Promise(resolve=>setTimeout(resolve,340));
    checks.spellbookSingleTapQuickcasts=quickcastClicks===1&&spellbookClicks===0;
    spellbook.click();spellbook.click();await new Promise(resolve=>setTimeout(resolve,340));
    checks.spellbookDoubleTapFullBook=spellbookClicks===1&&quickcastClicks===1;
    for(const id of ['dungeon-map-shortcut','dungeon-journal-shortcut','dungeon-spellbook-shortcut','dungeon-inventory-shortcut']) {
      const image=document.querySelector('#'+id+' img');await image.decode();
      checks['dockIconLoaded-'+id]=image.complete&&image.naturalWidth>0&&image.naturalHeight>0;
    }
    checks.readOnly=posts.every(p=>p.url==='/journal/view'&&p.body.runId==='journal-probe');
    checks.draftPreserved=document.getElementById('chatuserinput').value==='unfinished draft';
  }catch(error){errors.push(error.stack);}
  await realFetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:Object.values(checks).every(Boolean)&&!errors.length,checks,errors})});
});
</script></body></html>`;
const startupModelPage=String.raw`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><script src="/assets/modelSelectUi.js"></script></head><body><script>
const realFetch=window.fetch.bind(window),requests=[],checks={},errors=[];
localStorage.setItem('holodek.gameModel','grok-4');
window.fetch=async(url,options={})=>{
  requests.push({url,method:options.method||'GET'});
  if(url!=='/game-models'||options.method==='POST')throw Error('Unexpected request in read-only model chooser probe: '+url);
  return {ok:true,json:async()=>({current:{id:'grok-4',revision:5},all:[
    {id:'grok-4',name:'Grok',provider:'xai',status:'ready'},
    {id:'gpt-6-luna',name:'Luna',provider:'openai',status:'ready'},
    {id:'groq-test',name:'Groq test',provider:'groq',status:'ready'},
    {id:'holodek-1',name:'PC model',provider:'local',status:'ready'}]})};
};
document.addEventListener('DOMContentLoaded',async()=>{
  try{
    for(let i=0;i<100&&!document.querySelector('#model-select-screen input:checked');i++)await new Promise(resolve=>setTimeout(resolve,10));
    const dialog=document.getElementById('model-select-screen'),checked=dialog.querySelector('input:checked');
    checks.newGameDefaultsLunaDespiteSavedGrok=checked?.value==='gpt-6-luna'&&localStorage.getItem('holodek.gameModel')==='grok-4';
    const groups=Array.from(dialog.querySelectorAll('fieldset')).filter(group=>group.querySelector('input')).map(group=>group.querySelector('legend').textContent);
    checks.providerOrdering=groups.join('|')==='Grok (xAI)|OpenAI|Groq · Open-weight models';
    checks.pcModelHidden=!dialog.querySelector('input[value="holodek-1"]');
    checks.noCredentialOrModelWrites=requests.length===1&&requests[0].url==='/game-models'&&requests[0].method==='GET'&&!document.getElementById('provider-key-prompt');
    checks.modal=dialog.open&&dialog.matches(':modal');
  }catch(error){errors.push(error.stack);}
  await realFetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:Object.values(checks).every(Boolean)&&!errors.length,checks,errors})});
});
</script></body></html>`;
const tacticalPage=fs.readFileSync(path.join(__dirname,'tactical-ui-probe.html'),'utf8').replace('__GAME_CSS__',css)
  .replace('__PARTY_DOCK_LAYOUT__',index.slice(index.indexOf('function positionPartyIconDock()'),index.indexOf('function renderPartyInfoPopup()')));
const modelPage = String.raw`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
<script src="/assets/gameMenuUi.js"></script><script src="/assets/gameModelUi.js"></script></head><body>${menu}
<textarea id="draft">unfinished command</textarea><script>
const originalFetch=window.fetch.bind(window), checks={}, errors=[], posts=[];
let current={id:'original',name:'Original settings',revision:0},rejectNext=false;
const models=[{id:'gpt-6-luna',name:'GPT-6 Luna',description:'Efficient model'}, {id:'gpt-4.1-mini',name:'GPT-4.1 Mini',description:'Original model',shutdownDate:'2027-01-14'}];
window.fetch=async(url,options={})=>{
  if(String(url).startsWith('/game-models')){
    if(options.method==='POST'){
      posts.push(JSON.parse(options.body));
      if(rejectNext){rejectNext=false;return new Response(JSON.stringify({error:'Access no longer verified.'}),{status:409});}
      const id=JSON.parse(options.body).id;
      current={id,name:models.find(row=>row.id===id)?.name||'Original settings',revision:current.revision+1};
      return new Response(JSON.stringify({current}));
    }
    return new Response(JSON.stringify({current,models,reasoning:'off'}));
  }
  return originalFetch(url,options);
};
window.addEventListener('error',event=>errors.push(event.message));
document.addEventListener('DOMContentLoaded',async()=>{
  const wait=async predicate=>{for(let i=0;i<200&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,10));if(!predicate())throw Error('UI wait timed out.');};
  try{
    const panel=document.getElementById('game-model-popup'),select=document.getElementById('game-model-select'),apply=document.getElementById('game-model-apply'),status=document.getElementById('game-model-status');
    document.getElementById('game-menu-toggle').click();
    checks.hamburgerContainsModel=!document.getElementById('game-menu').hidden&&!!document.getElementById('open-game-model-button');
    document.getElementById('open-game-model-button').click();await wait(()=>!select.disabled);
    checks.modal=panel.open&&panel.matches(':modal')&&document.getElementById('game-menu').hidden;
    checks.originalDefault=select.value==='original'&&apply.disabled;
    checks.availableModels=select.options.length===3&&select.options[1].value==='gpt-6-luna';
    const bounds=panel.getBoundingClientRect();checks.fitsViewport=bounds.left>=0&&bounds.top>=0&&bounds.right<=innerWidth+1&&bounds.bottom<=innerHeight+1;
    select.value='gpt-6-luna';select.dispatchEvent(new Event('change'));checks.canApply=!apply.disabled;
    apply.click();await wait(()=>status.textContent.includes('selected.'));
    checks.appliesNextAction=posts.length===1&&posts[0].revision===0&&current.id==='gpt-6-luna'&&status.textContent.includes('next action');
    checks.menuReflectsSelection=document.getElementById('open-game-model-button').textContent.includes('GPT-6 Luna');
    select.value='gpt-4.1-mini';select.dispatchEvent(new Event('change'));rejectNext=true;apply.click();await wait(()=>status.textContent.includes('no longer verified'));
    checks.failedSelectionRetainsCurrent=current.id==='gpt-6-luna'&&select.value==='gpt-6-luna';
    select.value='original';select.dispatchEvent(new Event('change'));apply.click();await wait(()=>current.id==='original'&&!select.disabled);
    checks.rollback=current.id==='original'&&posts.at(-1).id==='original';
    select.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await wait(()=>!panel.open&&document.activeElement.id==='game-menu-toggle');
    checks.escapeCloses=!panel.open&&document.activeElement.id==='game-menu-toggle';
    checks.draftUnchanged=document.getElementById('draft').value==='unfinished command';
  }catch(error){errors.push(error.stack);}
  await originalFetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:Object.values(checks).every(Boolean)&&!errors.length,checks,errors})});
});
</script></body></html>`;
const fontsPage = String.raw`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
<script src="/assets/consoleFontUi.js"></script><script src="/assets/gameMenuUi.js"></script><script src="/assets/retroGraphics.js"></script><script src="/assets/compassUi.js"></script><script src="/assets/gameUiPixels.js"></script></head><body>${menu}
<div id="phaser-popup" style="display:block"><div id="phaser-header">Game Console</div><div id="phaser-container">${['Room: Ruined Temple Entrance','','Room Description: You find yourself standing in the first room of the afterlife at the Ruined Temple.','','PC:','Mortacia','Female','Goddess','Assassin-Fighter-Necromancer-Goddess','Level: 51','AC: 13','XP: 18817882','HP: 138','MaxHP: 138','Equipped: Weapon: None, Armor: None, Shield: None, Other: None','Attack: 0','Damage: 0','Armor: 0','Magic: 7','State: Alive','','Coordinates: X: 0, Y: 0, Z: 0','Exits: north, east, up'].join('\n')}</div></div>
<div id="game-log-popup" style="display:block"><div id="game-log-header">Game Log</div><div id="game-log-container">Mortacia misses Dantuea.</div></div>
<section class="popup-container" style="font:17px Georgia,serif;width:240px;position:absolute;left:10px;bottom:10px"><strong>Attack Party Member?</strong><button>Cancel</button></section>
<div id="chatlog-background-panel"><div id="chatlog-background-content"><img src="/assets/children-of-the-grave-logo.png" style="width:75%;display:block;margin:10px auto 30px">You find yourself standing in the first room of the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise), high magical beings and other entities of pure energy and form, angels and powerful demons...<br><br>The game begins in the Ruined Temple. Good luck, adventurer! Type 'Start' with nothing else in the sentence and then choose a game mode from the start menu.</div></div>
<div id="chatbotcontainer"><textarea id="chatuserinput" placeholder="Type a command">unfinished command</textarea><button id="chatbotbutton">Command</button></div>
<button id="dungeon-map-shortcut" aria-label="Open exploration map"><img src="/assets/adventurers-map.svg" alt=""></button>
<button id="dungeon-inventory-shortcut" aria-label="Inventory" style="left:auto;right:15px;bottom:60px"><img src="/assets/adventurers-pack.svg" alt=""></button>
<button id="dungeon-journal-shortcut" aria-label="Journal" style="left:auto;right:65px;bottom:60px"><img src="/assets/adventurers-journal.svg" alt=""></button>
<button id="dungeon-spellbook-shortcut" aria-label="Spellbook" style="left:auto;right:115px;bottom:60px"><img src="/assets/adventurers-spellbook.svg" alt=""></button>
<div id="party-icon-dock"><div class="party-icon-slot"><button class="party-icon-button"><canvas class="party-icon-canvas" width="36" height="36"></canvas><span class="party-icon-name">Mortacia</span><span class="party-icon-hp">129/129</span></button><div class="party-dice-wrap"><button class="party-d20">d20</button></div></div><span class="party-roll-history">Attack: d20 18 + 3 = 21</span><div class="party-roll-status">Mortacia: Attack - Dantuea. Roll d20.<br>AC 22. Click Roll.</div></div>
<script>
window.addEventListener('DOMContentLoaded', async () => {
  const checks = {}, errors = [];
  window.addEventListener('error', e => errors.push(e.message));
  const family = element => getComputedStyle(element).fontFamily;
  const fits = element => { const r=element.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1; };
  try {
    await document.fonts.load('10px "Grave Retro"'); await document.fonts.ready;
    checks.sharedFontLoaded = document.fonts.check('10px "Grave Retro"');
    const modern = document.documentElement.dataset.gameGraphics;
    checks.startsModern = modern==='modern' && family(document.getElementById('phaser-header')).includes('Grave Retro');
    checks.dynamicPopupUsesPixelFace = family(document.querySelector('.popup-container')).includes('Grave Retro') && family(document.querySelector('.popup-container button')).includes('Grave Retro');
    for (const mode of ['modern','retro','modern']) {
      if (document.documentElement.dataset.gameGraphics!==mode) {
        GameMenuUi.setOpen(true); document.getElementById('retro-graphics-toggle').click();
      }
      GameMenuUi.setOpen(true);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const expected='Grave Retro',menu=document.getElementById('game-menu');
      checks[mode+'Face']=[menu,document.getElementById('phaser-header'),document.getElementById('game-log-header'),document.getElementById('phaser-container'),document.querySelector('.popup-container button')].every(e=>family(e).includes(expected));
      checks[mode+'MenuFits']=fits(menu)&&menu.scrollWidth<=menu.clientWidth+1;
      checks[mode+'ButtonsWrap']=Array.from(menu.querySelectorAll('button')).every(e=>e.scrollWidth<=e.clientWidth+1);
      checks[mode+'ConsoleColors']=['phaser-container','game-log-container'].every(id=>{
        const c=getComputedStyle(document.getElementById(id));return c.color==='rgb(255, 255, 255)'&&c.backgroundColor==='rgb(0, 0, 0)';
      });
      checks[mode+'CompactReadableTranscript']=['phaser-container','game-log-container'].every(id=>{
        const c=getComputedStyle(document.getElementById(id));return c.fontSize==='6px'&&parseFloat(c.lineHeight)>=11&&parseFloat(c.lineHeight)<12;
      });
      checks[mode+'CrispPixelBorders']=['phaser-popup','game-log-popup','chatbotcontainer','dungeon-map-shortcut'].every(id=>{
        const c=getComputedStyle(document.getElementById(id));return c.borderImageSource.includes('ui-pixel-frame.svg')&&c.borderRadius==='0px'&&c.filter==='none';
      });
    }
    const title=getComputedStyle(document.getElementById('chatlog-background-content'));
    checks.titleSmallerAndSpaced=title.fontSize==='15px'&&parseFloat(title.lineHeight)>=25;
    checks.commandDraftUnchanged=document.getElementById('chatuserinput').value==='unfinished command'&&getComputedStyle(document.getElementById('chatuserinput')).fontSize==='11px';
    checks.compassUsesSharedFace=[document.getElementById('dungeon-compass'),...document.querySelectorAll('#dungeon-compass span, #dungeon-compass small, #dungeon-compass select')].every(e=>family(e).includes('Grave Retro'));
    checks.rollLogsRetainMonospace=Array.from(document.querySelectorAll('.party-roll-history,.party-roll-status')).every(e=>family(e)==='monospace');
    document.getElementById('console-font-toggle').click();
    checks.classicFontRestoresTranscriptOnly=['phaser-container','game-log-container'].every(id=>family(document.getElementById(id))==='monospace'&&getComputedStyle(document.getElementById(id)).fontSize==='8px')&&family(document.getElementById('phaser-header')).includes('Grave Retro')&&family(document.getElementById('dungeon-compass')).includes('Grave Retro');
    checks.classicFontRemembered=localStorage.getItem('holodek.consoleFont')==='classic'&&ConsoleFontUi.restore()==='classic';
    document.getElementById('console-font-toggle').click();
    checks.retroFontRestored=family(document.getElementById('phaser-container')).includes('Grave Retro')&&document.documentElement.dataset.consoleFont==='retro';
    checks.partyLabelsFit=Array.from(document.querySelectorAll('.party-icon-name,.party-icon-hp')).every(e=>{
      const c=getComputedStyle(e);return c.fontSize==='6px'&&e.scrollWidth<=e.clientWidth&&e.getBoundingClientRect().height<20;
    });
    for(let n=0;n<100&&!document.querySelector('.ui-pixel-icon');n++)await new Promise(r=>setTimeout(r,10));
    const icon=document.querySelector('.ui-pixel-icon');checks.iconActuallyRasterized=!!icon&&icon.width===24&&icon.height===24&&icon.getContext('2d').getImageData(0,0,24,24).data.some(x=>x);
    checks.pixelIconDoesNotInterceptClicks=!!icon&&getComputedStyle(icon).pointerEvents==='none';
    checks.noExternalFontRequests = performance.getEntriesByType('resource').filter(r=>/\.(ttf|woff)/.test(r.name)).every(r=>new URL(r.name).origin===location.origin);
  } catch(error) { errors.push(error.stack); }
  await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:Object.values(checks).every(Boolean)&&!errors.length,checks,errors})});
});
</script></body></html>`;
const artDependencies=['renderCharacterProcedural','puzzleModules','shrineIconography','pantheonCharacters','artCharacters','sculptureAnatomy','sculptureForms','frescoDesigns','frescoSerpents','frescoFigures','stoneCarvings','ancientScripts','mosaicDesigns','surfaceArt','roomIllustration','artViewerUi','roomArtUi','retroGraphics','consoleFontUi','renderSceneItems','worldInteractionUi'];
const artPage=String.raw`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
${artDependencies.map(name=>'<script src="/assets/'+name+'.js"></script>').join('')}</head><body>
<div id="phaser-popup" style="display:block"><div id="phaser-header">Game Console</div><div id="phaser-container"></div></div>
<div id="game-log-popup" style="display:block"><div id="game-log-header">Game Log</div><div id="game-log-container"></div></div>
<div id="chatlog" hidden></div><textarea id="draft">unfinished command</textarea>
<script>
window.addEventListener('DOMContentLoaded',async()=>{
  const realFetch=window.fetch.bind(window),checks={},errors=[],calls=[],saved=[],plans=${JSON.stringify([require('./fixtures/room-art.cjs').temple(),require('./fixtures/room-art.cjs').spring(),require('./fixtures/room-art.cjs').alien(),require('./fixtures/room-art.cjs').vista()])};
  window.addEventListener('error',e=>errors.push(e.message));
  const rooms=[{coordinates:'X: 0, Y: 0, Z: 0',name:'The Remembered Portico',description:'Fluted pillars frame a dark doorway and brightly painted masonry.'},
    {coordinates:'1,0,0',name:'The Spring of Unburied Green',description:'A clear spring breaks through grey ashes beneath the yellow sky.'},
    {coordinates:'2,0,0',name:'The Violet Interval',description:'Cyan crystals gather beside an open purple arch in a blue cavern.'},
    {coordinates:'3,0,0',name:'The Amber Citadel',description:'A tiered citadel stands among ruined pillars, golden dunes and jagged mountains beneath a vast sun and amber clouds.'}];
  const wait=async fn=>{for(let i=0;i<200&&!fn();i++)await new Promise(r=>setTimeout(r,10));if(!fn())throw Error('Art UI wait timed out');};
  window.dungeonRunId='art-probe';
  window.updateChatLog=html=>{document.getElementById('chatlog').innerHTML+=html;syncGameLogTranscript();};
  window.syncGameLogTranscript=()=>{document.getElementById('game-log-container').innerHTML=document.getElementById('chatlog').innerHTML;};
  let delay=false,release;
  window.fetch=async(url,options)=>{
    if(url!=='/room-illustration')return realFetch(url,options);
    const body=JSON.parse(options.body);calls.push(body);const i=Number(body.geoKey.split(',')[0]);
    if(delay&&i===2)await new Promise(r=>{release=r;});
    return new Response(JSON.stringify({...body,illustration:{version:1,source:String(i+1).repeat(64),plan:plans[i]}}));
  };
  const visit=i=>{const r=rooms[i],box=document.getElementById('phaser-container');box.innerHTML='<div id="room-art-slot">'+RoomArtUi.markup(r)+'</div>';
    RoomArtUi.visit({...r,onSave:record=>saved.push(record)});};
  try{
    await document.fonts.load('10px "Grave Retro"');
    const box=document.getElementById('phaser-container');
    box.innerHTML='<div id="room-art-slot">'+RoomArtUi.markup({coordinates:'None',name:'Ruined Temple Entrance',description:'Initial title-screen prose.'})+'</div>';
    checks.startupNeverShowsLogo=!box.querySelector('img')&&!box.textContent.includes('Children of the Grave');
    let currentDungeon={geoKey:'0,0,0',_meta:{runId:'art-probe'},sceneSpec:{source:{roomName:rooms[0].name,description:rooms[0].description}}};
    const roomNameDatabase=new Map([['0,0,0',{name:rooms[0].name}]]);
    let roomNameDatabasePlainObject,roomNameDatabaseString;
    const mapToPlainObject=map=>Object.fromEntries(map);
    ${roomArtPresentation}
    presentRoomIllustration();presentRoomIllustration();await wait(()=>document.querySelector('#phaser-container .room-art img'));
    checks.dungeonReadyStartsArtBeforeConsoleUpdate=calls.length===1&&document.querySelector('#phaser-container img').alt===rooms[0].name;
    checks.startupArtSavedOnLatestRoom=!!JSON.parse(roomNameDatabaseString)['0,0,0'].illustration;
    saved.push(roomNameDatabase.get('0,0,0').illustration);
    visit(0);await wait(()=>document.querySelector('#phaser-container .room-art img'));
    checks.entryIsIllustrated=calls.length===1&&document.querySelectorAll('#chatlog .room-art').length===1&&saved.length>0;
    const image=document.querySelector('#phaser-container .room-art img');await image.decode();
    checks.actualPixelImage=image.naturalWidth===320&&image.naturalHeight===200&&getComputedStyle(image).imageRendering==='pixelated';
    checks.consoleAndLogIdentical=image.src===document.querySelector('#game-log-container .room-art img').src;
    document.querySelector('#phaser-container .room-art button').focus();document.activeElement.click();
    let popup=document.getElementById('art-viewer-popup');
    checks.consoleOpensViewer=popup.open&&popup.matches(':modal')&&popup.querySelector('img').src===image.src;
    let bounds=popup.getBoundingClientRect();checks.viewerFitsViewport=bounds.left>=0&&bounds.top>=0&&bounds.right<=innerWidth+1&&bounds.bottom<=innerHeight+1;
    popup.querySelector('button').click();
    checks.closeRestoresFocus=!document.getElementById('art-viewer-popup')&&document.activeElement.classList.contains('room-art-open');
    document.querySelector('#game-log-container .room-art button').click();
    checks.logOpensSameViewer=document.getElementById('art-viewer-popup')?.querySelector('img').src===image.src;ArtViewerUi.close();
    visit(1);await wait(()=>document.querySelector('#phaser-container img'));visit(0);await wait(()=>document.querySelector('#phaser-container img'));
    checks.reentryReusesPainting=calls.length===2&&document.querySelectorAll('#chatlog .room-art').length===3&&document.querySelector('#phaser-container img').src===image.src;
    delay=true;visit(2);await wait(()=>release);visit(1);release();await wait(()=>document.querySelectorAll('#chatlog img').length===5);
    checks.lateArtDoesNotReplaceCurrent=document.querySelector('#phaser-container img').alt===rooms[1].name;
    checks.oldEntryStillGetsItsPainting=Array.from(document.querySelectorAll('#chatlog img')).some(img=>img.alt===rooms[2].name);
    const surface=SurfaceArt.plan({indoor:true,source:{roomName:'Ruined Temple Entrance',description:'An ancient fresco watches over a mosaic pavement.'}});
    const fresco=surface.find(a=>a.kind==='fresco'),mosaic=surface.find(a=>a.kind==='mosaic'&&a.surface==='floor');
    for(const art of [fresco,mosaic]){
      const before=JSON.stringify(art);await WorldInteractionUi.activate({type:'art',enabled:true,art,label:art.label});popup=document.getElementById('art-viewer-popup');
      const native=SurfaceArt.rasterSize(art),c=document.createElement('canvas');c.width=native.width;c.height=native.height;
      SurfaceArt.paint(c.getContext('2d'),(w,h)=>{const v=document.createElement('canvas');v.width=w;v.height=h;return v;},art);
      checks[art.kind+'UsesSameUnlitViewer']=popup.open&&popup.querySelector('img').src===c.toDataURL()&&getComputedStyle(popup.querySelector('img')).filter==='none';
      checks[art.kind+'Preserved']=JSON.stringify(art)===before;ArtViewerUi.close();
    }
    checks.draftUnchanged=document.getElementById('draft').value==='unfinished command';
    checks.rejectsRemoteAndScriptImages=ArtViewerUi.open({src:'https://example.com/art.png'})===false&&ArtViewerUi.open({src:'javascript:alert(1)'})===false;
    visit(3);await wait(()=>document.querySelector('#phaser-container img'));const original=document.querySelector('#phaser-container img').src,callCount=calls.length;
    RetroGraphics.setMode('c64_glazed');const retro=document.querySelector('#phaser-container img').src;
    checks.retroPaintingIsSeparate=original!==retro&&Array.from(document.querySelectorAll('#game-log-container .room-art img')).at(-1)?.src===retro;
    const decoded=new Image();decoded.src=retro;await decoded.decode();const quant=document.createElement('canvas');quant.width=320;quant.height=200;quant.getContext('2d').drawImage(decoded,0,0);
    const rgba=quant.getContext('2d').getImageData(0,0,320,200).data,legal=new Set(RetroGraphics.palette.map(c=>c.join(',')));
    checks.retroPaintingUsesOnlyC64Colors=true;for(let i=0;i<rgba.length;i+=4)if(!legal.has(Array.from(rgba.slice(i,i+3)).join(',')))checks.retroPaintingUsesOnlyC64Colors=false;
    RetroGraphics.setMode('modern');checks.modernPaintingRestoredUnchanged=document.querySelector('#phaser-container img').src===original&&calls.length===callCount;
    document.querySelector('#phaser-container .room-art button').click();
    popup=document.getElementById('art-viewer-popup');await popup.querySelector('img').decode();
  }catch(error){errors.push(error.stack);}
  await realFetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:Object.values(checks).every(Boolean)&&!errors.length,checks,errors})});
});
</script></body></html>`;
for (const html of [page,journalPage,tacticalPage,modelPage,startupModelPage,fontsPage,artPage])for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script.trim()) new vm.Script(script);

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
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(process.argv.includes('--startup-model-only')?startupModelPage:process.argv.includes('--art-only')?artPage:process.argv.includes('--fonts-only')?fontsPage:process.argv.includes('--model-only')?modelPage:process.argv.includes('--tactical-only')?tacticalPage:process.argv.includes('--journal-only')?journalPage:page); return; }
    if (/^\/assets\/fonts\/(PixelifySans|PressStart2P)\.ttf$/.test(request.url)) {
      response.setHeader('Content-Type','font/ttf'); response.end(fs.readFileSync(path.join(root,request.url.slice(1)))); return;
    }
    if (['/assets/ui-pixel-frame.svg','/assets/ui-compass-dial.svg'].includes(request.url)) {
      response.setHeader('Content-Type','image/svg+xml'); response.end(fs.readFileSync(path.join(root,request.url.slice(1)))); return;
    }
    if (request.url==='/assets/children-of-the-grave-logo.png') { response.setHeader('Content-Type','image/png');response.end(fs.readFileSync(path.join(root,request.url.slice(1))));return; }
    if (['/assets/adventurers-map.svg', '/assets/adventurers-pack.svg','/assets/adventurers-journal.svg','/assets/adventurers-spellbook.svg'].includes(request.url)) { response.setHeader('Content-Type', 'image/svg+xml'); response.end(fs.readFileSync(path.join(root, request.url.slice(1)))); return; }
    const name = /^\/assets\/(\w+)\.js$/.exec(request.url)?.[1];
    if (!scripts.includes(name) && !artDependencies.includes(name) && !['partyRecovery','rendererWebGPU','objectDiscovery','adventureJournalUi','combatTacticalUi','partySpellbookUi','modelSelectUi'].includes(name)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'application/javascript'); response.end(fs.readFileSync(path.join(root, 'assets', name + '.js')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = process.env.GPU_PROBE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-ui-probe-'));
  const customSize=process.argv.find(arg=>/^--size=\d+,\d+$/.test(arg))?.slice(7);
  const size = customSize || (process.argv.includes('--narrow') ? '540,900' : '1680,950');
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--window-size=' + size,
    ...(process.argv.includes('--screenshot')?['--remote-debugging-port=0']:[]),
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
  if(report.pass&&process.argv.includes('--screenshot')){
    const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);
    const pages=await fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json());
    const target=pages.find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:'+server.address().port));
    if(!target)throw Error('Isolated UI preview page was not found.');
    const socket=new(require('ws'))(target.webSocketDebuggerUrl);
    try{
      await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
      const result=await new Promise((resolve,reject)=>{
        socket.on('message',raw=>{const d=JSON.parse(raw);if(d.id===1)d.error?reject(Error(d.error.message)):resolve(d.result);});
        socket.send(JSON.stringify({id:1,method:'Page.captureScreenshot',params:{format:'png',captureBeyondViewport:false}}));
      });
      const directory=path.join(root,'logs/probes');fs.mkdirSync(directory,{recursive:true});
      report.preview=path.join(directory,(process.argv.includes('--art-only')?'room-art-':'pixel-ui-')+(process.argv.includes('--narrow')?'narrow':'desktop')+'.png');
      fs.writeFileSync(report.preview,Buffer.from(result.data,'base64'));
    }finally{socket.close();}
  }
  clearTimeout(timeout); child.kill(); server.close();
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.pass ? 0 : 1;
})();
