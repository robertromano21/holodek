const EventEmitter = require('events');
const sharedStateEmitter = new EventEmitter();

let personalNarrative = "";
let updatedGameConsole = "";
let roomNameDatabaseString = "";
let combatCharactersString = "";
let combatMode = 'Combat Map-Based';
let currentQuest = "";
let currentTasks = [];
let currentTaskIndex = 0;
let questSeeded = false;
let lastQuestUpdate = "";
let questLog = [];
let roomMusicDatabase = {};
let roomDungeonDatabase = {};   // ← NEW: 3D dungeon per geo-room

let lastCoords = { x: 0, y: 0, z: 0 };

module.exports = {
  // --- existing getters/setters ---
  getPersonalNarrative: () => personalNarrative,
  setPersonalNarrative: (narrative) => { personalNarrative = narrative; },
  getUpdatedGameConsole: () => updatedGameConsole,
  setUpdatedGameConsole: (consoleData) => { updatedGameConsole = consoleData; },
  getRoomNameDatabase: () => roomNameDatabaseString,
  setRoomNameDatabase: (database) => { roomNameDatabaseString = database; },
  getCombatCharactersString: () => combatCharactersString,
  setCombatCharactersString: (characters) => { combatCharactersString = characters; },
  getCombatMode: () => {
    console.log('Current combatMode in sharedState:', combatMode);
    return combatMode;
  },
  setCombatMode: (mode) => {
    console.log('Setting combatMode to:', mode);
    combatMode = mode;
  },
  getCurrentQuest: () => currentQuest,
  setCurrentQuest: (quest) => {
    console.log('Setting currentQuest to:', quest);
    currentQuest = quest;
    sharedStateEmitter.emit('quest:currentQuest', quest);
  },
  getCurrentTasks: () => currentTasks,
  setCurrentTasks: (tasks) => {
    console.log('Setting currentTasks to:', tasks);
    currentTasks = tasks;
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
    console.log('Resetting quest state.');
    currentTasks = [];
    currentTaskIndex = 0;
    questSeeded = false;
    lastQuestUpdate = "";
    sharedStateEmitter.emit('quest:reset');
  },
  getLastCoords: () => lastCoords,
  setLastCoords: (coords) => {
    if (!coords || typeof coords !== 'object' || coords.x === undefined || coords.y === undefined || coords.z === undefined) {
      console.warn('setLastCoords: invalid coords, using default', coords);
      lastCoords = { x: 0, y: 0, z: 0 };
    } else {
      lastCoords = { x: coords.x, y: coords.y, z: coords.z };
      console.log('Updated lastCoords:', lastCoords);
    }
  },
  // Room music
  getRoomMusic: (coords) => {
    if (!coords || typeof coords !== 'object') return null;
    const key = `${coords.x},${coords.y},${coords.z}`;
    return roomMusicDatabase[key] || null;
  },
  setRoomMusic: (coords, musicJson) => {
    if (!coords || typeof coords !== 'object') return;
    const key = `${coords.x},${coords.y},${coords.z}`;
    roomMusicDatabase[key] = musicJson;
    sharedStateEmitter.emit('music:roomUpdate', { coords: key, music: musicJson });
  },
  // UPDATED: DUNGEON DATABASE (with customTiles support)
  getRoomDungeon: (coords) => {
    if (!coords || typeof coords !== 'object') return null;
    const key = `${coords.x},${coords.y},${coords.z}`;
    const dungeon = roomDungeonDatabase[key] || null;
    if (dungeon) {
      // Ensure customTiles is attached (backward compat)
      dungeon.customTiles = dungeon.customTiles || [];
    }
    return dungeon;
  },
  setRoomDungeon: (coords, dungeon, customTiles = []) => {
    if (!coords || typeof coords !== 'object') return;
    const key = `${coords.x},${coords.y},${coords.z}`;
    if (dungeon) {
      // Attach customTiles to dungeon for caching/reuse
      dungeon.customTiles = customTiles || [];
      roomDungeonDatabase[key] = dungeon;
      sharedStateEmitter.emit('dungeon:update', { key, dungeon });
      console.log('DUNGEON SEEDED FOR', key, `with ${customTiles.length} custom tiles`);
    }
  },
  emitter: sharedStateEmitter
};