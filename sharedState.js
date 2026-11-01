const EventEmitter = require('events');
const { randomUUID } = require('node:crypto');
const { isMainThread } = require('node:worker_threads');
const sharedStateEmitter = new EventEmitter();

let personalNarrative = "";
let updatedGameConsole = "";
let roomNameDatabaseString = "";
let combatCharactersString = "";
let liveWorldState = null;
let npcAutonomyFeed = [];
let combatMode = 'Combat Map-Based';
let dungeonTestingMode = false;
let currentQuest = "";
let currentTasks = [];
let currentTaskIndex = 0;
let questSeeded = false;
let lastQuestUpdate = "";
let questLog = [];
let roomMusicDatabase = {};
let graphicsRebuildPending = new Set();
let roomDungeonDatabase = {};   // ← NEW: 3D dungeon per geo-room
let dungeonRunId = randomUUID();
let restoreRevision = 0;
let roomPopulations = new Map();
let gamePaused = false;
let dialogueMemory = { characters: {}, recent: [] };
let campaignMemory = { version: 1, runId: dungeonRunId, records: [], sequence: 0 };
let lastAdjudication = null;

let lastCoords = { x: 0, y: 0, z: 0 };
let activeCityFloor = null;
let cityFloorEpoch = randomUUID();
const Floors = require('./retort/hostLocalFloors');
let floorDatabaseText, floorDatabaseCache, floorRuntime;
function floorDatabase(){
  if(floorDatabaseText!==roomNameDatabaseString){floorDatabaseCache=JSON.parse(roomNameDatabaseString||'{}');floorDatabaseText=roomNameDatabaseString;}
  return floorDatabaseCache;
}
function floorBundle(key){
  if(activeCityFloor?.hostKey!==key)return null;
  const saved=Floors.bundle(floorDatabase(),activeCityFloor);if(!saved)return null;
  const id=Floors.identity(activeCityFloor);
  if(floorRuntime?.id!==id)floorRuntime={id,population:saved.population,dungeon:saved.dungeon};
  else{
    if(saved.population&&saved.population!==floorRuntime.population){
      if(floorRuntime.population){for(const k of Object.keys(floorRuntime.population))delete floorRuntime.population[k];Object.assign(floorRuntime.population,saved.population);}
      else floorRuntime.population=saved.population;
    }
    if(saved.dungeon?._geometryStamp!==floorRuntime.dungeon?._geometryStamp)floorRuntime.dungeon=saved.dungeon;
  }
  saved.population=floorRuntime.population;saved.room.inhabitants=saved.population;saved.dungeon=floorRuntime.dungeon;return saved;
}

function cloneDungeonForStorage(dungeon) {
  if (!dungeon) return null;
  return JSON.parse(JSON.stringify(dungeon, (key, value) => {
    // Renderer/runtime caches are client-local and can desync stored room geometry.
    if (key === '_lodCache' || key === '_minFloor') return undefined;
    return value;
  }));
}
function savedDungeon(key){
  const floor=floorBundle(key);if(floor)return floor.dungeon||null;
  if(roomDungeonDatabase[key])return roomDungeonDatabase[key];
  const cached=require('./retort/cityArchitecture').cachedLayer(JSON.parse(roomNameDatabaseString||'{}'),roomDungeonDatabase,key);
  if(cached){roomDungeonDatabase[key]=cached;graphicsRebuildPending.add(key);}
  return cached;
}

let currentPC = null;   // The finalized player character (with sprite) chosen at the start menu

// Character generation phase (separate from main dungeon Retort flow)
let characterGenerationInProgress = false;
let pendingCharacterForReview = null;

module.exports = {
  exportSaveState: () => require('./saveGameState').clone({ personalNarrative, updatedGameConsole,
    roomNameDatabaseString: activeCityFloor?JSON.stringify(floorDatabase()):roomNameDatabaseString,
    combatCharactersString, liveWorldState, npcAutonomyFeed, combatMode, dungeonTestingMode, currentQuest, currentTasks,
    currentTaskIndex, questSeeded, lastQuestUpdate, questLog, roomMusicDatabase, roomDungeonDatabase, dungeonRunId,
    roomPopulations, gamePaused, dialogueMemory, campaignMemory, lastAdjudication, lastCoords, currentPC,
    characterGenerationInProgress, pendingCharacterForReview, activeCityFloor, cityFloorEpoch }),
  importSaveState: (snapshot, { graphicsReady = [] } = {}) => {
    const next = require('./saveGameState').clone(require('./saveGameState').validate(snapshot));
    if(next.activeCityFloor){
      const database=JSON.parse(next.roomNameDatabaseString),floor=Floors.bundle(database,next.activeCityFloor);
      require('./assets/dungeonGeometryStamp').stamp(floor.dungeon,next.activeCityFloor.hostKey);
      next.roomNameDatabaseString=JSON.stringify(database);
    }
    ({ personalNarrative, updatedGameConsole, roomNameDatabaseString, combatCharactersString, liveWorldState, npcAutonomyFeed,
      combatMode, dungeonTestingMode, currentQuest, currentTasks, currentTaskIndex, questSeeded, lastQuestUpdate, questLog,
      roomMusicDatabase, roomDungeonDatabase, dungeonRunId, gamePaused, dialogueMemory, campaignMemory, lastAdjudication,
      lastCoords, currentPC, characterGenerationInProgress, pendingCharacterForReview } = next);
    roomPopulations = new Map(Object.entries(next.roomPopulations));
    activeCityFloor=next.activeCityFloor||null;cityFloorEpoch=next.cityFloorEpoch||randomUUID();
    floorDatabaseText=null;floorDatabaseCache=null;floorRuntime=null;
    graphicsRebuildPending = new Set(Object.keys(roomDungeonDatabase).filter(key => !graphicsReady.includes(key)));
    restoreRevision++;
  },
  // --- existing getters/setters ---
  getDungeonRunId: () => dungeonRunId,
  getRestoreRevision: () => restoreRevision,
  getActiveCityFloor: () => activeCityFloor && { ...activeCityFloor },
  getCityFloorEpoch: () => cityFloorEpoch,
  beginDungeonRun: () => {
    restoreRevision++;
    dungeonRunId = randomUUID();
    roomDungeonDatabase = {};
    graphicsRebuildPending.clear();
    roomMusicDatabase = {};
    roomPopulations.clear();
    gamePaused = false;
    liveWorldState = null;
    npcAutonomyFeed = [];
    dialogueMemory = { characters: {}, recent: [] };
    campaignMemory = { version: 1, runId: dungeonRunId, records: [], sequence: 0 };
    lastAdjudication = null;
    lastCoords = { x: 0, y: 0, z: 0 };
    activeCityFloor=null;cityFloorEpoch=randomUUID();floorRuntime=null;
    console.info('[DungeonRunStarted]', JSON.stringify({ runId: dungeonRunId }));
    return dungeonRunId;
  },
  getPersonalNarrative: () => personalNarrative,
  getGamePaused: () => gamePaused,
  getDialogueMemory: () => dialogueMemory,
  getCampaignMemory: () => campaignMemory,
  getLastAdjudication: () => lastAdjudication && structuredClone(lastAdjudication),
  setLastAdjudication: value => { lastAdjudication = value && typeof value === 'object' ? structuredClone(value) : null; },
  setGamePaused: value => { gamePaused = value === true; },
  getRoomPopulation: key => floorBundle(key) ? floorBundle(key).population||null : roomPopulations.get(key)||null,
  setRoomPopulation: (key, value) => {
    const floor=floorBundle(key);
    if(floor){const db=floorDatabase();const saved=Floors.bundle(db,activeCityFloor);saved.population=value;floorRuntime.population=value;saved.room.inhabitants=value;roomNameDatabaseString=JSON.stringify(db);}
    else roomPopulations.set(key,value);
  },
  setPersonalNarrative: (narrative) => { personalNarrative = narrative; },
  getUpdatedGameConsole: () => updatedGameConsole,
  setUpdatedGameConsole: (consoleData) => { updatedGameConsole = consoleData; },
  getRoomNameDatabase: () => {
    if(activeCityFloor)floorBundle(activeCityFloor.hostKey);
    return activeCityFloor||roomNameDatabaseString.includes('"cityFloors"')?JSON.stringify(Floors.project(floorDatabase(),activeCityFloor)):roomNameDatabaseString;
  },
  setRoomNameDatabase: (database) => {
    if(activeCityFloor||roomNameDatabaseString.includes('"cityFloors"'))database=JSON.stringify(Floors.absorb(floorDatabase(),JSON.parse(database),activeCityFloor));
    roomNameDatabaseString = require('./retort/roomBuildState').protectDatabase(roomNameDatabaseString, database, dungeonRunId);
  },
  getCombatCharactersString: () => combatCharactersString,
  setCombatCharactersString: (characters) => { combatCharactersString = characters; },
  getLiveWorldState: () => liveWorldState,
  setLiveWorldState: (state) => { liveWorldState = state || null; },
  getNpcAutonomyFeed: () => npcAutonomyFeed.slice(),
  appendNpcAutonomyFeed: (entry) => {
    if (!entry) return;
    npcAutonomyFeed.push(entry);
    if (npcAutonomyFeed.length > 12) {
      npcAutonomyFeed = npcAutonomyFeed.slice(-12);
    }
  },
  clearNpcAutonomyFeed: () => { npcAutonomyFeed = []; },
  getCombatMode: () => {
    console.log('Current combatMode in sharedState:', combatMode);
    return combatMode;
  },
  setCombatMode: (mode) => {
    console.log('Setting combatMode to:', mode);
    combatMode = mode;
  },
  getDungeonTestingMode: () => dungeonTestingMode,
  setDungeonTestingMode: (enabled) => {
    dungeonTestingMode = !!enabled;
    console.log('Setting dungeonTestingMode to:', dungeonTestingMode);
  },
  getCurrentQuest: () => currentQuest,
  setCurrentQuest: (quest) => {
    console.log('Setting currentQuest to:', quest);
    currentQuest = quest;
    sharedStateEmitter.emit('quest:currentQuest', quest);
  },
  getCurrentTasks: () => currentTasks,

  // Character customization phase support
  getCurrentPC: () => currentPC,
  setCurrentPC: (pc) => { currentPC = pc; },

  // Separate character generation phase (before main Retort dungeon flow)
  isCharacterGenerationInProgress: () => characterGenerationInProgress,
  setCharacterGenerationInProgress: (val) => { characterGenerationInProgress = !!val; },
  getPendingCharacterForReview: () => pendingCharacterForReview,
  setPendingCharacterForReview: (char) => { pendingCharacterForReview = char; },
  setCurrentTasks: (tasks) => {
    console.log('Setting currentTasks to:', tasks);
    currentTasks = activeCityFloor ? Floors.bindTasks(tasks,activeCityFloor) : tasks;
    sharedStateEmitter.emit('quest:tasks', tasks);
  },
  getCurrentTaskIndex: () => currentTaskIndex,
  setCurrentTaskIndex: (index) => {
    console.log('Setting currentTaskIndex to:', index);
    currentTaskIndex = index;
    sharedStateEmitter.emit('quest:taskIndex', index);
  },
  getQuestSeeded: () => questSeeded,
  setQuestSeeded: (seeded) => {
    console.log('Setting questSeeded to:', seeded);
    questSeeded = seeded;
    sharedStateEmitter.emit('quest:seeded', seeded);
  },
  getActiveTask: () => currentTasks[currentTaskIndex] || null,
  getLastQuestUpdate: () => lastQuestUpdate,
  setLastQuestUpdate: (update) => {
    const val = (update || "").toString();
    console.log('Setting lastQuestUpdate to:', val);
    lastQuestUpdate = val;
    sharedStateEmitter.emit('quest:lastUpdate', { update: val, index: currentTaskIndex });
  },
  appendQuestLog: (entry) => {
    try {
      const e = { ts: Date.now(), ...entry };
      questLog.push(e);
      sharedStateEmitter.emit('quest:log', e);
      console.log('Appended quest log entry:', e);
    } catch (err) {
      console.warn('appendQuestLog failed:', err);
    }
  },
  getQuestLog: () => questLog.slice(-50),
  clearQuestLog: () => { questLog = []; },
  resetQuestState: () => {
    lastAdjudication = null;
    console.log('Resetting quest state.');
    currentTasks = [];
    currentTaskIndex = 0;
    questSeeded = false;
    lastQuestUpdate = "";
    sharedStateEmitter.emit('quest:reset');
  },
  getLastCoords: () => lastCoords,
  setLastCoords: (coords) => {
    if (!coords || typeof coords !== 'object') {
      console.warn('setLastCoords: invalid coords, using default', coords);
      lastCoords = { x: 0, y: 0, z: 0 };
      return;
    }
    // Support both {x,y,z} objects and [x,y,z] arrays for robustness
    let x, y, z;
    if (Array.isArray(coords)) {
      x = coords[0]; y = coords[1]; z = coords[2];
    } else {
      x = coords.x; y = coords.y; z = coords.z;
    }
    if (x === undefined || y === undefined || z === undefined) {
      console.warn('setLastCoords: invalid coords (missing x/y/z), using default', coords);
      lastCoords = { x: 0, y: 0, z: 0 };
    } else {
      if(activeCityFloor&&`${Number(x)},${Number(y)},${Number(z)}`!==activeCityFloor.hostKey){activeCityFloor=null;cityFloorEpoch=randomUUID();}
      lastCoords = { x: Number(x), y: Number(y), z: Number(z) };
      console.log('Updated lastCoords:', lastCoords);
      // Room workers move only their scratch cursor; respawn history belongs to the live PC.
      if (isMainThread && !activeCityFloor) {
        const key = [lastCoords.x, lastCoords.y, lastCoords.z].join(',');
        const db = JSON.parse(roomNameDatabaseString || '{}');
        if (require('./retort/playerRespawn').noteLevelSpawn(db, dungeonRunId, key, roomDungeonDatabase[key]))
          roomNameDatabaseString = JSON.stringify(db);
      }
    }
  },
  // Room music
  getRoomMusic: (coords) => {
    if (!coords || typeof coords !== 'object') return null;
    const key = `${coords.x},${coords.y},${coords.z}`;
    if(floorBundle(key))return floorBundle(key).music||null;
    return roomMusicDatabase[key] || null;
  },
  getRecentRoomMusic: (excludeKey, limit = 8) => Object.entries(roomMusicDatabase)
    .filter(([key, song]) => key !== excludeKey && song && typeof song === 'object').slice(-Math.max(1, Math.min(8, Number(limit) || 8)))
    .map(([roomKey, song]) => ({ roomKey, song: structuredClone({ title: song.title, key: song.key,
      scale: song.scale, bpm: song.bpm, plan: song.plan,
      composition: song.composition && { acceptedPlan: song.composition.acceptedPlan,
        realizedMotifSignature: song.composition.realizedMotifSignature } }) })),
  setRoomMusic: (coords, musicJson) => {
    if (!coords || typeof coords !== 'object') return;
    const key = `${coords.x},${coords.y},${coords.z}`;
    if(floorBundle(key)){const db=JSON.parse(roomNameDatabaseString);Floors.bundle(db,activeCityFloor).music=musicJson;roomNameDatabaseString=JSON.stringify(db);return;}
    roomMusicDatabase[key] = musicJson;
    sharedStateEmitter.emit('music:roomUpdate', { coords: key, music: musicJson });
  },
  // UPDATED: DUNGEON DATABASE (with customTiles support)
  getRoomDungeonForSimulation: (coords) => coords ? savedDungeon(`${coords.x},${coords.y},${coords.z}`) : null,
  setRoomCrowd: (coords,crowd) => {
    if(!coords)return false;
    const dungeon=savedDungeon(`${coords.x},${coords.y},${coords.z}`);if(!dungeon)return false;
    // Crowd-only motion must not serialize or replace the city's large geometry grid.
    dungeon.cityCrowd=structuredClone(crowd);return true;
  },
  getRoomDungeon: (coords) => {
    if (!coords || typeof coords !== 'object') return null;
    const key = `${coords.x},${coords.y},${coords.z}`;
    savedDungeon(key);
    if (graphicsRebuildPending.has(key)) {
      require('./saveGameAssets').rebuildRoom(savedDungeon(key), key);
      graphicsRebuildPending.delete(key);
    }
    const dungeon = savedDungeon(key) || null;
    if (dungeon) {
      // Ensure customTiles is attached (backward compat)
      dungeon.customTiles = dungeon.customTiles || [];
    }
    return cloneDungeonForStorage(dungeon);
  },
  setRoomDungeon: (coords, dungeon, customTiles = []) => {
    if (!coords || typeof coords !== 'object') return;
    const key = `${coords.x},${coords.y},${coords.z}`;
    if (dungeon) {
      // Attach customTiles to dungeon for caching/reuse
      dungeon.customTiles = customTiles || [];
      const storedDungeon = cloneDungeonForStorage(dungeon);
      if(floorBundle(key)){
        if(Floors.identity(storedDungeon.cityFloorContext)!==Floors.identity(activeCityFloor))throw Error('A stale floor cannot replace current geometry.');
        const db=floorDatabase();Floors.bundle(db,activeCityFloor).dungeon=storedDungeon;floorRuntime.dungeon=storedDungeon;roomNameDatabaseString=JSON.stringify(db);
        graphicsRebuildPending.delete(key);sharedStateEmitter.emit('dungeon:update',{key,dungeon:cloneDungeonForStorage(storedDungeon)});return;
      }
      if(roomDungeonDatabase[key]?.cityInteriorLayers)storedDungeon.cityInteriorLayers=roomDungeonDatabase[key].cityInteriorLayers;
      if(isMainThread&&storedDungeon.cityArchitecture){
        const database=JSON.parse(roomNameDatabaseString||'{}');
        if(require('./retort/cityArchitecture').persist(database,key,storedDungeon))roomNameDatabaseString=JSON.stringify(database);
      }
      roomDungeonDatabase[key] = storedDungeon;
      if(isMainThread)require('./retort/cityArchitecture').cacheLayer(JSON.parse(roomNameDatabaseString||'{}'),roomDungeonDatabase,key,storedDungeon);
      graphicsRebuildPending.delete(key);
      sharedStateEmitter.emit('dungeon:update', { key, dungeon: cloneDungeonForStorage(storedDungeon) });
      console.log('DUNGEON SEEDED FOR', key, `with ${customTiles.length} custom tiles`);
    }
  },
  emitter: sharedStateEmitter
};
