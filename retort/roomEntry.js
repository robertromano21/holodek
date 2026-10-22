'use strict';
const Arrival = require('../assets/roomArrival');
const Exits = require('../assets/dungeonExits');
const Intent = require('../assets/commandIntent');
const QuestMap = require('../assets/questMap');

function prepare(dungeon, { geoKey = dungeon?.geoKey, fromKey, input = '', flags = require('./worldFlags').snapshot() } = {}) {
  if (!dungeon?.cells || !dungeon.start) return null;
  const key = geoKey;
  dungeon.geoKey = key;
  let direction = fromKey && fromKey !== key ? Intent.travelDirection(input) : null;
  if (!direction && fromKey && fromKey !== key) direction = Object.keys(Arrival.OPPOSITE)
    .find(d => QuestMap.neighbourKey(fromKey, d) === key) || 'portal';
  dungeon._world1Start ||= { ...dungeon.start };
  const point = direction && Arrival.arrivalPoint(dungeon, direction,
    dungeon.sceneSpec?.exits ?? dungeon.sceneSpec?.source?.exits ?? [], Exits, flags);
  dungeon.start = Arrival.safeStart(dungeon, point || dungeon.start);
  dungeon.entryPlacement = { version: 1, fromKey: fromKey || null, direction: direction || null, start: { ...dungeon.start } };
  return dungeon.entryPlacement;
}

module.exports = { prepare };
