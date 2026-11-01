'use strict';
const Build = require('./roomBuildState'), Arrival = require('./roomEntry'), I = require('../assets/dungeonInhabitants');

// Persistent visitors and cross-room contracts are entry effects, not remote construction writes.
function activate(state, key, text) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), room = db[key];
  if (room?.pendingCommunityActivation?.version !== 1) return { changed: false, text };
  const Economy = require('./economy'), population = room.inhabitants;
  if (!room.populationComplete || !population?.actors || population.geoKey !== key ||
      I.roomKey(Economy.field(text, 'Coordinates')) !== key)
    throw Error('Prepared community activation requires entry to its completed room.');
  Economy.activateRoom(db, key, population, state.getDungeonRunId(), text);
  require('./roomCast').install(db, key, population, state.getDungeonRunId());
  require('./spellSystem').adoptRoomRecipes(db, key, state);
  state.setRoomNameDatabase(JSON.stringify(db)); state.setRoomPopulation(key, population);
  const projected = Build.projectConsole(text, room, key, db);
  state.setUpdatedGameConsole(projected);
  return { changed: true, text: projected };
}

function publish(state, { key, input, model, broadcast, createPopulation = require('./roomPopulation').createPopulationService }) {
  const from = state.getLastCoords(), fromKey = `${from.x},${from.y},${from.z}`;
  if (key === fromKey || key === '0,0,0') return null;
  if (require('./openingQuestPreparation').entryPending(state)) return null;
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), room = db[key], receipt = room?.preparedBuild;
  if (!receipt?.ready || receipt.stage !== 'complete' || receipt.runId !== state.getDungeonRunId() || receipt.model !== model || !room.populationComplete) return null;
  const [x, y, z] = key.split(',').map(Number), coords = { x, y, z };
  const saved = state.getRoomDungeonForSimulation(coords);
  if (saved?.geoKey !== key || !saved.cells || !saved.layout || !saved._geometryStamp ||
      saved.sceneSpec?.source?.roomName !== room.name || saved.sceneSpec.source.description !== Build.description(room)) return null;
  const task = state.getCurrentTasks?.()?.[state.getCurrentTaskIndex?.() || 0];
  const dungeon = task ? require('./openingQuestPreparation').installPhysical(saved, room, task, key) : structuredClone(saved);
  let text = Build.projectConsole(state.getUpdatedGameConsole(), room, key, db);
  let database = JSON.stringify(db), characters = state.getCombatCharactersString();
  let residents = structuredClone(state.getRoomPopulation?.(key) || room.inhabitants);
  const staged = { ...state, getLastCoords: () => coords, getUpdatedGameConsole: () => text, setUpdatedGameConsole: t => { text = t; },
    getRoomNameDatabase: () => database, setRoomNameDatabase: value => { database = value; },
    getCombatCharactersString: () => characters, setCombatCharactersString: value => { characters = value; },
    getRoomPopulation: target => target === key ? residents : state.getRoomPopulation?.(target),
    setRoomPopulation: (target, value) => { if (target !== key) throw Error('Entry cannot modify another population.'); residents = value; } };
  Arrival.prepare(dungeon, { geoKey: key, fromKey, input });
  require('../assets/dungeonGeometryStamp').stamp(dungeon, key);
  residents = createPopulation(staged).prepare(text, dungeon);
  text = I.withStates(text, residents);
  const roster = JSON.parse(characters || '[]');
  for (const actor of roster) if (actor.type === 'pc' || actor.type === 'npc') {
    Object.assign(actor, { mazeX: dungeon.start.x, mazeY: dungeon.start.y, mazeRoomKey: key });
    delete actor.mazePoint;
  }
  state.setRoomNameDatabase(database); state.setUpdatedGameConsole(text);
  state.setCombatCharactersString(JSON.stringify(roster)); state.setLastCoords(coords);
  state.setRoomPopulation(key, residents);
  dungeon.inhabitants = residents;
  state.setRoomDungeon(coords, dungeon, dungeon.customTiles || []);
  const entryReady = { runId: state.getDungeonRunId(), geoKey: key, updatedGameConsole: text,
    roomNameDatabaseString: state.getRoomNameDatabase(), combatCharactersString: state.getCombatCharactersString() };
  broadcast({ type: 'dungeonLoaded', geoKey: key, dungeon, entryReady });
  console.info('[PreparedRoomEntry]', JSON.stringify({ phase: 'display-ready', runId: entryReady.runId, geoKey: key, fromKey, questPending: true }));
  return { geoCoords: coords, geoKey: key, entryPrevious: from };
}
module.exports = { activate, publish };
