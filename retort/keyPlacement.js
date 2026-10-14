'use strict';
const DELTAS = { north: [0, 1, 0], south: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0],
  northeast: [1, 1, 0], northwest: [-1, 1, 0], southeast: [1, -1, 0], southwest: [-1, -1, 0], up: [0, 0, 1], down: [0, 0, -1] };
function choose(database, coordinates, lockedDirection, { random = Math.random, hostile = false } = {}) {
  const here = `${coordinates.x},${coordinates.y},${coordinates.z}`, room = database[here] || {};
  const candidates = [];
  for (const [direction, exit] of Object.entries(room.exits || {})) {
    if (direction === lockedDirection || !DELTAS[direction] || exit?.status !== 'open' || exit.bossGateId) continue;
    const delta = DELTAS[direction], expected = [coordinates.x, coordinates.y, coordinates.z].map((v, i) => v + delta[i]).join(',');
    const target = typeof exit.targetCoordinates === 'string' ? exit.targetCoordinates : exit.targetCoordinates &&
      `${exit.targetCoordinates.x},${exit.targetCoordinates.y},${exit.targetCoordinates.z}`;
    const adjacent = database[expected];
    if (target !== expected || !adjacent || adjacent.visited || adjacent.sceneSpec || adjacent.description || adjacent.roomDescription) continue;
    candidates.push(expected);
  }
  if (hostile || !candidates.length || random() < .6) return here;
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
}
module.exports = { choose };
