'use strict';
const FIELDS = ['personalNarrative', 'updatedGameConsole', 'roomNameDatabaseString', 'combatCharactersString', 'liveWorldState',
  'npcAutonomyFeed', 'combatMode', 'dungeonTestingMode', 'currentQuest', 'currentTasks', 'currentTaskIndex', 'questSeeded',
  'lastQuestUpdate', 'questLog', 'roomMusicDatabase', 'roomDungeonDatabase', 'dungeonRunId', 'roomPopulations', 'gamePaused',
  'dialogueMemory', 'campaignMemory', 'lastAdjudication', 'lastCoords', 'currentPC', 'characterGenerationInProgress', 'pendingCharacterForReview'];
const record = x => x && typeof x === 'object' && !Array.isArray(x);
const coordinate = /^-?\d+,-?\d+,-?\d+$/;
const transient = new Set(['_lodCache', '_minFloor', '_webglCache', '_webgpuCache']);
function clone(value) {
  return JSON.parse(JSON.stringify(value, (key, v) => {
    if (transient.has(key) || typeof v === 'function') return undefined;
    if (v instanceof Map) return Object.fromEntries(v);
    if (v instanceof Set || ArrayBuffer.isView(v)) return Array.from(v);
    return v;
  }));
}
function validate(value) {
  if (!record(value) || FIELDS.some(k => !Object.hasOwn(value, k))) throw Error('Incomplete server checkpoint.');
  if (typeof value.dungeonRunId !== 'string' || !value.dungeonRunId || value.dungeonRunId.length > 100) throw Error('Invalid adventure identity.');
  for (const key of ['personalNarrative', 'updatedGameConsole', 'roomNameDatabaseString', 'combatCharactersString', 'currentQuest', 'lastQuestUpdate'])
    if (typeof value[key] !== 'string') throw Error('Invalid checkpoint text: ' + key);
  const database = JSON.parse(value.roomNameDatabaseString), roster = JSON.parse(value.combatCharactersString);
  if (!record(database) || !Array.isArray(roster)) throw Error('Invalid room database or roster.');
  for (const key of ['roomDungeonDatabase', 'roomMusicDatabase', 'roomPopulations']) {
    if (!record(value[key]) || Object.keys(value[key]).some(k => !coordinate.test(k))) throw Error('Invalid checkpoint room collection: ' + key);
  }
  if (Object.keys(database).some(k => !coordinate.test(k))) throw Error('Invalid room database coordinates.');
  if (!Array.isArray(value.currentTasks) || !Array.isArray(value.questLog) || !Array.isArray(value.npcAutonomyFeed) ||
      !Number.isInteger(value.currentTaskIndex) || value.currentTaskIndex < 0 || value.currentTaskIndex > value.currentTasks.length) throw Error('Invalid quest checkpoint.');
  if (!record(value.lastCoords) || !['x', 'y', 'z'].every(k => Number.isSafeInteger(value.lastCoords[k]))) throw Error('Invalid saved coordinates.');
  const key = `${value.lastCoords.x},${value.lastCoords.y},${value.lastCoords.z}`;
  if (!database[key] || !value.roomDungeonDatabase[key]) throw Error('Current room geometry is missing from the checkpoint.');
  const room = String(value.updatedGameConsole).match(/^Coordinates:\s*X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/m);
  if (!room || room.slice(1).map(Number).join(',') !== key) throw Error('Server console and saved room disagree.');
  if (!record(value.dialogueMemory) || !record(value.campaignMemory) || value.campaignMemory.runId !== value.dungeonRunId) throw Error('Invalid campaign memory.');
  if (value.characterGenerationInProgress) throw Error('Finish character creation before saving.');
  for (const k of ['gamePaused', 'dungeonTestingMode', 'questSeeded', 'characterGenerationInProgress']) if (typeof value[k] !== 'boolean') throw Error('Invalid checkpoint flag.');
  return value;
}
module.exports = { FIELDS, clone, validate, coordinate };
