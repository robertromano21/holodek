'use strict';
const I = require('../assets/dungeonInhabitants');
const Gear = require('../assets/equipmentRules');
const MOVE_TILES = 6;
function paths(space, actor, remaining) {
  const p = space?.point(actor); if (!p || remaining < 1) return new Map();
  const roster = space.syncRoster(JSON.parse(JSON.stringify(space.roster || [])));
  const occupied = new Set(roster.filter(a => a.name !== actor.name && (a.hp ?? 1) > 0 && space.point(a))
    .map(a => { const at = space.point(a); return `${Math.floor(at.x)},${Math.floor(at.y)}`; }));
  const start = { x: Math.floor(p.x), y: Math.floor(p.y), path: [] }, queue = [start], found = new Map();
  const seen = new Set([`${start.x},${start.y}`]);
  for (let i = 0; i < queue.length && i < 512; i++) {
    const current = queue[i]; if (current.path.length >= remaining) continue;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const next = { x: current.x + dx, y: current.y + dy }, key = `${next.x},${next.y}`;
      if (seen.has(key) || occupied.has(key) || !I.canTraverse(space.dungeon, current, next)) continue;
      seen.add(key); const entry = { ...next, path: [...current.path, next] };
      found.set(key, entry.path); queue.push(entry);
    }
  }
  return found;
}
function attach({ dice, state, space, actor, targets, refresh, step, opportunity, dead }) {
  const turn = dice.active.turn, action = dice.active;
  let remaining = MOVE_TILES, revision = 0, busy = false, closed = false;
  const usedOpportunities = new Set();
  function update() {
    const routes = paths(space, actor, remaining), at = space.point(actor);
    turn.tactical = true; turn.geoKey = action.geoKey; turn.runId = state.getDungeonRunId();
    turn.movement = { remaining, total: MOVE_TILES, revision, busy, position: at,
      tiles: [...routes].map(([key, path]) => { const [x, y] = key.split(',').map(Number); return { x, y, cost: path.length }; }) };
    turn.attackTargets = targets.filter(t => t.hp > 0 && space.canAttack(actor, t)).map(t => t.name);
    refresh?.(turn); dice.publish(); return routes;
  }
  async function move(input) {
    if (closed || busy || dice.active !== action || action.turn !== turn || dice.paused || state.getGamePaused?.() || actor.hp <= 0 ||
        input.runId !== turn.runId || input.geoKey !== turn.geoKey || input.actionId !== action.id || input.turnId !== turn.turnId ||
        input.combatant !== actor.name || input.revision !== revision || !Number.isInteger(input.x) || !Number.isInteger(input.y))
      throw Error('That movement is stale, paused or already resolving.');
    const route = paths(space, actor, remaining).get(`${input.x},${input.y}`);
    if (!route?.length) throw Error('Choose an unoccupied highlighted tile within your movement allowance.');
    busy = true; revision++; update();
    try {
      for (const tile of route) {
        await dice.waitUntilResumed();
        if (closed || dice.active !== action || actor.hp <= 0) break;
        const from = space.point(actor), to = { x: tile.x + .5, y: tile.y + .5 };
        for (const enemy of targets) {
          if (usedOpportunities.has(enemy.name) || enemy.hp <= 0 || !space.canStrike(enemy, actor) ||
              space.canStrikeFrom(enemy, space.point(enemy), to)) continue;
          usedOpportunities.add(enemy.name); await opportunity?.(enemy);
          if (actor.hp <= 0) break;
        }
        if (actor.hp <= 0) break;
        if (!I.canTraverse(space.dungeon, { x: Math.floor(from.x), y: Math.floor(from.y) }, tile)) break;
        space.move(actor, tile); remaining--; await step(tile);
      }
    } finally { busy = false; update(); if (actor.hp <= 0) dead?.(); }
    return { turn, dead: actor.hp <= 0 };
  }
  dice.moveCombatant = move; update();
  return { busy: () => busy, close() { closed = true; if (dice.moveCombatant === move) delete dice.moveCombatant; }, update };
}
module.exports = { MOVE_TILES, paths, attach, Gear };
