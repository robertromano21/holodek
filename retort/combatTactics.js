'use strict';
const I = require('../assets/dungeonInhabitants');
const Gear = require('../assets/equipmentRules');
const Footprint = require('../assets/combatFootprint');
const MOVE_TILES = 6;
function paths(space, actor, remaining) {
  const p = space?.point(actor); if (!p || remaining < 1) return new Map();
  const roster = space.syncRoster(JSON.parse(JSON.stringify(space.roster || [])));
  const occupied = new Set(roster.filter(a => a.name !== actor.name && (a.hp ?? 1) > 0 && space.point(a))
    .flatMap(a => Footprint.cells(a, space.point(a)).map(p => `${p.x},${p.y}`)));
  const start = { x: Math.floor(p.x), y: Math.floor(p.y), pointX: p.x, pointY: p.y, path: [] }, queue = [start], found = new Map();
  const seen = new Set([`${start.x},${start.y}`]);
  for (let i = 0; i < queue.length && i < 512; i++) {
    const current = queue[i]; if (current.path.length >= remaining) continue;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const next = { x: current.x + dx, y: current.y + dy }, key = `${next.x},${next.y}`;
      if (seen.has(key) || occupied.has(key) || !I.canTraverse(space.dungeon, current, next) ||
          space.canMoveTo && !space.canMoveTo(actor, current, next)) continue;
      seen.add(key); const entry = { ...next, path: [...current.path, next] };
      found.set(key, entry.path); queue.push(entry);
    }
  }
  return found;
}
function approachPlan(space, actor, target, remaining, routes = paths(space, actor, remaining)) {
  const at = space?.point(actor);
  if (!at || !space.point(target) || target.hp <= 0) return null;
  if (space.canAttack(actor, target)) return { x: Math.floor(at.x), y: Math.floor(at.y), cost: 0 };
  for (const path of routes.values()) {
    const tile = path.at(-1);
    if (space.canAttackFrom(actor, { x: tile.x + .5, y: tile.y + .5 }, target)) return { ...tile, cost: path.length };
  }
  return null;
}
function attach({ dice, state, space, actor, targets, refresh, step, opportunity, dead }) {
  const turn = dice.active.turn, action = dice.active;
  let remaining = MOVE_TILES, revision = 0, busy = false, closed = false;
  const usedOpportunities = new Set();
  const onFloor = () => {
    const c = state.getLastCoords?.();
    return !c || I.roomKey(typeof c === 'object' ? `${c.x},${c.y},${c.z}` : c) === action.geoKey;
  };
  function update() {
    const routes = paths(space, actor, remaining), at = space.point(actor);
    turn.tactical = true; turn.geoKey = action.geoKey; turn.runId = state.getDungeonRunId();
    turn.movement = { remaining, total: MOVE_TILES, revision, busy, position: at,
      tiles: [...routes].map(([key, path]) => { const [x, y] = key.split(',').map(Number); return { x, y, cost: path.length }; }) };
    turn.attackTargets = targets.filter(t => t.hp > 0 && space.canAttack(actor, t)).map(t => t.name);
    turn.approachTargets = targets.filter(t => t.hp > 0 && !turn.attackTargets.includes(t.name)).flatMap(target => {
      const plan = approachPlan(space, actor, target, remaining, routes);
      return plan ? [{ name: target.name, ...plan }] : [];
    });
    refresh?.(turn); dice.publish(); return routes;
  }
  async function move(input) {
    if (closed || busy || !onFloor() || dice.active !== action || action.turn !== turn || dice.paused || state.getGamePaused?.() || actor.hp <= 0 ||
        input.runId !== turn.runId || input.geoKey !== turn.geoKey || input.actionId !== action.id || input.turnId !== turn.turnId ||
        input.combatant !== actor.name || input.revision !== revision || !Number.isInteger(input.x) || !Number.isInteger(input.y))
      throw Error('That movement is stale, paused or already resolving.');
    const route = paths(space, actor, remaining).get(`${input.x},${input.y}`);
    if (!route?.length) throw Error('That square is not available. Choose an unoccupied tile within your movement allowance.');
    busy = true; revision++; update();
    try {
      for (const tile of route) {
        await dice.waitUntilResumed();
        if (closed || !onFloor() || dice.active !== action || actor.hp <= 0) break;
        const from = space.point(actor), to = { x: tile.x + .5, y: tile.y + .5 };
        for (const enemy of targets) {
          if (usedOpportunities.has(enemy.name) || enemy.hp <= 0 || !space.canStrike(enemy, actor) ||
              space.canStrikeFrom(enemy, space.point(enemy), to, actor)) continue;
          usedOpportunities.add(enemy.name); await opportunity?.(enemy);
          if (actor.hp <= 0) break;
        }
        if (actor.hp <= 0) break;
        const origin = { x: Math.floor(from.x), y: Math.floor(from.y), pointX: from.x, pointY: from.y };
        if (!I.canTraverse(space.dungeon, origin, tile) || space.canMoveTo && !space.canMoveTo(actor, origin, tile)) break;
        space.move(actor, tile); remaining--; await step(tile);
      }
    } finally { busy = false; update(); if (actor.hp <= 0) dead?.(); }
    return { turn, dead: actor.hp <= 0 };
  }
  dice.moveCombatant = move; update();
  async function approach(target) {
    if (closed || busy || !targets.includes(target) || !onFloor() || dice.active !== action || action.turn !== turn) return false;
    const plan = approachPlan(space, actor, target, remaining); if (!plan) return false;
    if (plan.cost) await move({ x: plan.x, y: plan.y, revision, runId: turn.runId, geoKey: turn.geoKey,
      actionId: action.id, turnId: turn.turnId, combatant: actor.name });
    return !closed && actor.hp > 0 && target.hp > 0 && onFloor() && dice.active === action && action.turn === turn && space.canAttack(actor, target);
  }
  return { approach, busy: () => busy, close() { closed = true; if (dice.moveCombatant === move) delete dice.moveCombatant; }, update };
}
module.exports = { MOVE_TILES, paths, approachPlan, attach, Gear };
