'use strict';

const { porticoSupports } = require('./sceneRoofs');
const { makeNavigation, reachable } = require('./sceneArchitecture');
const Footprint = require('../assets/combatFootprint');

function protectPoints(value, keys, margin = 0) {
  if (!value || typeof value !== 'object') return;
  const x = value.mazeX ?? value.x, y = value.mazeY ?? value.y;
  if (Number.isFinite(x) && Number.isFinite(y)) {
    const size = Footprint.size(value);
    for (let dy = -margin; dy < size.height + margin; dy++) for (let dx = -margin; dx < size.width + margin; dx++)
      keys.add(`${Math.floor(x) + dx},${Math.floor(y) + dy}`);
  }
  for (const child of Object.values(value)) if (child && typeof child === 'object') protectPoints(child, keys, margin);
}

// Only add grounded columns. Never move an old column or regenerate roofs/terrain.
function upgradePorticos(dungeon, { actors = [], player } = {}) {
  const result = { changed: false, added: [], upgraded: 0, skipped: [] };
  if (!dungeon?.cells || !dungeon.layout || !dungeon.start || dungeon.sceneRoof?.status !== 'built' ||
      dungeon.sceneArchitecture?.reason === 'disabled') return result;
  const protectedKeys = new Set();
  protectPoints(actors, protectedKeys, 1); protectPoints(player, protectedKeys, 1);
  for (const value of [dungeon.sceneObjects, dungeon.physicalPuzzle, dungeon.secretDoors]) protectPoints(value, protectedKeys);
  let nav = null, before = null;
  for (const bay of dungeon.sceneRoof.bays || []) {
    if (bay.role !== 'shrine' || (bay.idiom || dungeon.sceneRoof.idiom) !== 'classical' ||
        !['pitched', 'open-portico'].includes(bay.style)) continue;
    const old = [...new Set(bay.supports || [])];
    if (old.length >= 10) continue;
    const skip = reason => result.skipped.push({ x: bay.x, y: bay.y, reason });
    const points = porticoSupports(bay, dungeon.start);
    const spring = bay.springHeight;
    if (!points.length || !Number.isFinite(spring) || old.length < 4 || !old.every(key => {
      const c = dungeon.cells[key], shape = dungeon.tiles?.[c?.tile]?.spriteSpec?.voxelShape;
      return c?.architectureRole === 'roof-support' && (c.tile === 'pillar' || /^(doric|ionic|corinthian)_column$/.test(shape)) &&
        c.ceilHeight >= spring && c.structureHeight > 0;
    })) { skip('incompatible-supports'); continue; }
    nav ||= makeNavigation(dungeon);
    before ||= reachable(nav, dungeon.start);
    if (!before.count) { skip('unreachable-start'); continue; }
    const candidates = points.map(p => `${p.x},${p.y}`).filter(key => {
      const c = dungeon.cells[key];
      const [x, y] = key.split(',').map(Number);
      return !old.includes(key) && c?.tile === 'floor' && !c.blocked && !c.obstacle && !c.structureHeight &&
        !c.navigationReserved && !c.feature && !c.exit && !c.door && !c.interactable && !c.secretDoorId && !c.complexExit &&
        !/stair|puzzle|mechanism/.test(c.architectureRole || '') && !protectedKeys.has(key) &&
        Math.hypot(x - dungeon.start.x, y - dungeon.start.y) > 2 && before.seen[y * nav.width + x] &&
        spring - (c.floorHeight || 0) > 0 && Math.abs((c.floorHeight || 0) - (dungeon.cells[old[0]].floorHeight || 0)) <= .5;
    });
    const needed = 10 - old.length;
    // Legacy nine-column plans retain their middle rear pillar; either adjacent rear slot may complete them.
    let accepted = null, attempts = 0;
    function choose(index, keys) {
      if (accepted || attempts >= 64 || candidates.length - index < needed - keys.length) return;
      if (keys.length === needed) {
        attempts++;
        const next = { ...nav, passable: nav.passable.slice() };
        for (const key of keys) { const [x, y] = key.split(',').map(Number); next.passable[y * nav.width + x] = 0; }
        const after = reachable(next, dungeon.start);
        if (!before.seen.some((seen, i) => seen && next.passable[i] && !after.seen[i])) accepted = { keys, next, after };
        return;
      }
      for (let i = index; i < candidates.length && !accepted; i++) choose(i + 1, [...keys, candidates[i]]);
    }
    choose(0, []);
    if (!accepted) { skip(candidates.length < needed ? 'protected-or-occupied' : 'would-block-route'); continue; }
    for (const key of accepted.keys) {
      const c = dungeon.cells[key];
      dungeon.cells[key] = { ...c, tile: dungeon.cells[old[0]].tile, feature: 'pillar', ceilHeight: spring,
        structureHeight: spring - (c.floorHeight || 0), architectureRole: 'roof-support' };
    }
    bay.supports = [...old, ...accepted.keys]; bay.minimumSupports = 10;
    result.added.push(...accepted.keys); result.upgraded++; result.changed = true;
    nav = accepted.next; before = accepted.after;
  }
  if (result.changed) {
    dungeon.sceneRoof.porticoUpgrade = { version: 1, targetPillars: 10 };
    delete dungeon._lodCache; delete dungeon._minFloor;
  }
  return result;
}

// Call only at a complete-room delivery boundary, never while publishing an action delta.
function prepareRoom(state, geoKey, { finalize, player, actors = [] } = {}) {
  const [x, y, z] = geoKey.split(',').map(Number), coords = { x, y, z };
  const dungeon = state.getRoomDungeon(coords);
  if (!dungeon) return null;
  const roster = JSON.parse(state.getCombatCharactersString() || '[]').filter(a => !a.mazeRoomKey || a.mazeRoomKey === geoKey);
  const population = state.getRoomPopulation(geoKey);
  const live = state.getLiveWorldState();
  const result = upgradePorticos(dungeon, { player, actors: [roster, population?.actors, actors,
    live?.roomKey === geoKey ? live : null] });
  if (!result.changed) return dungeon;
  const finalized = finalize(geoKey, dungeon, dungeon.customTiles);
  state.setRoomDungeon(coords, finalized, finalized.customTiles);
  console.info('[PorticoUpgrade]', JSON.stringify({ geoKey, upgraded: result.upgraded, added: result.added, skipped: result.skipped }));
  return finalized;
}

module.exports = { upgradePorticos, prepareRoom };
