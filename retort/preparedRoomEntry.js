'use strict';
// Persistent visitors and cross-room contracts are entry effects, not remote construction writes.
function activate(state, key, text) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), room = db[key];
  if (room?.pendingCommunityActivation?.version !== 1) return { changed: false, text };
  const Build = require('./roomBuildState'), Economy = require('./economy');
  const population = room.inhabitants;
  if (!room.populationComplete || !population?.actors || population.geoKey !== key ||
      require('../assets/dungeonInhabitants').roomKey(Economy.field(text, 'Coordinates')) !== key)
    throw Error('Prepared community activation requires entry to its completed room.');
  Economy.activateRoom(db, key, population, state.getDungeonRunId(), text);
  require('./roomCast').install(db, key, population, state.getDungeonRunId());
  require('./spellSystem').adoptRoomRecipes(db, key, state);
  state.setRoomNameDatabase(JSON.stringify(db)); state.setRoomPopulation(key, population);
  const projected = Build.projectConsole(text, room, key, db);
  state.setUpdatedGameConsole(projected);
  return { changed: true, text: projected };
}
module.exports = { activate };
