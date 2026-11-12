'use strict';
const { createHash } = require('node:crypto');
const OFFSETS = { north:[0,1,0], south:[0,-1,0], east:[1,0,0], west:[-1,0,0], northeast:[1,1,0], southeast:[1,-1,0], northwest:[-1,1,0], southwest:[-1,-1,0], up:[0,0,1], down:[0,0,-1] };
const coordinate = /^-?\d+,-?\d+,-?\d+$/;
const hash = value => createHash('sha256').update(value).digest().readUInt32LE();
function linkReturn(database, fromKey, direction, toKey) {
  if (!coordinate.test(fromKey) || !coordinate.test(toKey) || !OFFSETS[direction] || !database[toKey]) throw Error('Invalid return exit.');
  const from = fromKey.split(',').map(Number), expected = from.map((n, i) => n + OFFSETS[direction][i]).join(',');
  if (expected !== toKey) throw Error('Return exit does not match room coordinates.');
  const reverse = Object.keys(OFFSETS).find(d => OFFSETS[d].every((n, i) => n === -OFFSETS[direction][i]));
  const room = database[toKey]; room.exits ||= {};
  const existing = room.exits[reverse];
  if (existing && existing.targetCoordinates !== fromKey) throw Error('Return exit conflicts with an existing route.');
  for (const [d, exit] of Object.entries(room.exits)) {
    if (d !== reverse && d !== 'portal' && exit.targetCoordinates === fromKey && exit.kind !== 'portal') delete room.exits[d];
  }
  room.exits[reverse] = { ...existing, status:'open', targetCoordinates:fromKey, key:null };
  return room.exits[reverse];
}
function prepare(database, key, { seed = '', protectedKeys = new Set() } = {}) {
  if (!coordinate.test(key)) throw Error('Invalid room coordinate.');
  const room = database[key]; if (!room) throw Error('Unregistered room.');
  if (room.visited || room.populationComplete || room.preparedBuild || room.backgroundTopology?.version === 1 || room.builder?.mode === 'hand') return room;
  room.exits ||= {};
  const point = key.split(',').map(Number), target = direction => point.map((n,i) => n + OFFSETS[direction][i]).join(',');
  // A route's physical return is determined by coordinates, not by another generated name.
  for (const [otherKey, other] of Object.entries(database)) {
    const link = Object.values(other.exits || {}).find(e => e.targetCoordinates === key && e.kind !== 'portal');
    if (!coordinate.test(otherKey) || !link) continue;
    const direction = Object.keys(OFFSETS).find(d => target(d) === otherKey);
    if (direction && !room.exits[direction]) room.exits[direction] = { status:link.status || 'open', targetCoordinates:otherKey, key:link.key || null };
  }
  const fixed = room.fortifiedFloor?.version === 1 || room.villagePlan || room.villageBuilding || room.cityRoom || room.exits.portal && !room.planarRealm;
  // Living region (on by default; HOLODEK_LIVING_REGION=0 disables): marks a community room safe before population planning, then adds the exits a
  // planned route needs here, subject to the same reservations.
  if (!fixed) for (const add of require('./livingRegion').prepareRoom(database, key, { protectedKeys })) if (!room.exits[add.direction]) room.exits[add.direction] = add.exit;
  // A reserved living-region footprint is never linked into by unrelated rooms (its own links were added above).
  const reservedFootprint = require('./livingRegion').protectedKeys(database, key);
  if (!fixed) {
    const planar = room.planarRealm, anchor = planar?.anchorKey?.split(',').map(Number);
    const directions = Object.keys(OFFSETS).filter(d => {
      if ((planar || room.classification?.indoor === false || room.indoor === false) && ['up','down'].includes(d)) return false;
      if (room.exits[d]) return false;
      const k = target(d), other = database[k], p = k.split(',').map(Number);
      const back = Object.keys(OFFSETS).find(o => OFFSETS[o].every((n,i) => n === -OFFSETS[d][i]));
      if (other?.exits?.[back] && other.exits[back].targetCoordinates !== key) return false;
      if ((protectedKeys.has(k) || reservedFootprint.has(k)) && !Object.values(other?.exits || {}).some(exit => exit.targetCoordinates === key)) return false;
      if (planar && (p.some(n => n < 0 || n > 1000) || !anchor || Math.max(Math.abs(p[0]-anchor[0]),Math.abs(p[1]-anchor[1])) > 8 || other && other.planarRealm?.id !== planar.id)) return false;
      // Never punch a new route into an already constructed room that has no reciprocal opening.
      if (other && (other.visited || other.populationComplete || other.builder?.mode === 'hand') &&
          !Object.values(other.exits || {}).some(e => e.targetCoordinates === key)) return false;
      return true;
    }).sort((a,b) => hash(seed+'|'+key+'|'+a)-hash(seed+'|'+key+'|'+b));
    const size = Object.keys(room.exits).length;
    const wanted = planar ? room.exits.portal ? 3 : 2 : Math.max(size+1,2+hash(seed+'|'+key)%4);
    for (const direction of directions) {
      if (Object.keys(room.exits).length >= wanted) break;
      room.exits[direction] = { status:'open', targetCoordinates:target(direction), key:null };
    }
  }
  room.backgroundTopology = { version:1, key };
  return room;
}
module.exports = { prepare, linkReturn, OFFSETS };
