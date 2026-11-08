'use strict';
const Build = require('./roomBuildState'), I = require('../assets/dungeonInhabitants');
const keyOf = point => point && [point.x, point.y, point.z].every(Number.isSafeInteger) ? `${point.x},${point.y},${point.z}` : null;
function capture(state) {
  return { runId: state.getDungeonRunId(), originKey: keyOf(state.getLastCoords()),
    floor: state.getActiveCityFloor?.() || null };
}
function recover(state, attempt) {
  if (!attempt?.originKey || attempt.runId !== state.getDungeonRunId() || attempt.floor || state.getActiveCityFloor?.()) return null;
  const coords = state.getLastCoords(), key = keyOf(coords), text = state.getUpdatedGameConsole();
  if (key !== attempt.originKey || I.roomKey(text?.match(/^Coordinates:[ \t]*(.*)$/m)?.[1]) === key) return null;
  const database = state.getRoomNameDatabase(), db = JSON.parse(database || '{}'), room = db[key];
  const dungeon = state.getRoomDungeonForSimulation(coords);
  if (!room?.populationComplete || dungeon?.geoKey !== key || !dungeon.cells) return null;
  const population = state.getRoomPopulation?.(key) || room.inhabitants;
  const projected = I.withStates(Build.projectConsole(text, room, key, db), population);
  const roster = JSON.parse(state.getCombatCharactersString() || '[]').filter(actor =>
    actor.type !== 'monster' || population?.actors?.[actor.name] && I.roomKey(actor.mazeRoomKey) === key);
  // Keep completed neighbors, discoveries, inventory and quest work; only undo the uncommitted room cursor.
  state.setUpdatedGameConsole(projected);
  state.setCombatCharactersString(JSON.stringify(roster));
  return { runId: attempt.runId, geoKey: key, updatedGameConsole: projected,
    roomNameDatabaseString: database, combatCharactersString: JSON.stringify(roster) };
}
module.exports = { capture, recover };
