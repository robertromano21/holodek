const Inhabitants = require('../assets/dungeonInhabitants');
const Gear = require('../assets/equipmentRules');
const Footprint = require('../assets/combatFootprint');
function roomKey(value) {
  const numbers = String(value || '').match(/-?\d+/g);
  return numbers?.length === 3 ? numbers.map(Number).join(',') : null;
}

function position(actor, geoKey) {
  if (!actor || !roomKey(geoKey) || roomKey(actor.mazeRoomKey) !== roomKey(geoKey) || !Number.isFinite(actor.mazeX) || !Number.isFinite(actor.mazeY)) return null;
  if(actor.type==='pc' && Number.isFinite(actor.mazePoint?.x) && Number.isFinite(actor.mazePoint?.y) &&
      Math.floor(actor.mazePoint.x)===actor.mazeX && Math.floor(actor.mazePoint.y)===actor.mazeY) return {...actor.mazePoint};
  return { x: actor.mazeX + 0.5, y: actor.mazeY + 0.5 };
}

function solid(cell) {
  return !cell || !['floor', 'door'].includes(cell.tile) || !!cell.obstacle || !!cell.blocked ||
    (cell.tile === 'door' && !cell.door?.isOpen);
}

function lineClear(dungeon, a, b) {
  if (!a || !b) return false;
  const floorA = dungeon.cells[`${Math.floor(a.x)},${Math.floor(a.y)}`]?.floorHeight || 0;
  const floorB = dungeon.cells[`${Math.floor(b.x)},${Math.floor(b.y)}`]?.floorHeight || 0;
  const clear = (x, y, t0, t1) => {
    const cell = dungeon.cells[`${x},${y}`];
    const z0 = floorA + (floorB - floorA) * t0 + 0.65;
    const z1 = floorA + (floorB - floorA) * t1 + 0.65;
    const clearBody=cell && (['floor','door'].includes(cell.tile) ? Inhabitants.walkable(dungeon,x,y) : Inhabitants.lineClear(dungeon,a,b));
    return clearBody && Math.min(z0, z1) >= (cell.floorHeight || 0) && Math.max(z0, z1) < Inhabitants.ceilingHeight(dungeon, cell);
  };
  const dx = b.x - a.x, dy = b.y - a.y;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const stepX = dx ? Math.abs(1 / dx) : Infinity, stepY = dy ? Math.abs(1 / dy) : Infinity;
  let x = Math.floor(a.x), y = Math.floor(a.y), t = 0;
  let tx = dx ? ((sx > 0 ? x + 1 : x) - a.x) / dx : Infinity;
  let ty = dy ? ((sy > 0 ? y + 1 : y) - a.y) / dy : Infinity;
  // Supercover traversal includes both cells touching a diagonal corner.
  for (let guard = 0; guard < 1024; guard++) {
    const end = Math.min(1, tx, ty);
    if (!clear(x, y, t, end)) return false;
    if (end >= 1) return true;
    if (Math.abs(tx - ty) < 1e-9) {
      if (!clear(x + sx, y, end, end) || !clear(x, y + sy, end, end)) return false;
      x += sx; y += sy; tx += stepX; ty += stepY;
    } else if (tx < ty) { x += sx; tx += stepX; }
    else { y += sy; ty += stepY; }
    t = end;
  }
  return false;
}

function createCombatSpace(dungeon, roster, geoKey) {
  const actors = new Map(roster.map(c => [String(c.name || c.Name).toLowerCase(), c]));
  const entry = actor => actor && actors.get(String(actor.name || actor.Name).toLowerCase());
  const point = actor => position(entry(actor), geoKey);
  const bodyPoints = (actor, at = point(actor)) => !at ? [] : Footprint.cells(entry(actor) || actor, at)
    .map(c => ({ x: at.x + c.x - Math.floor(at.x), y: at.y + c.y - Math.floor(at.y) }));
  const pairs = (a, p, b, q) => bodyPoints(a, p).flatMap(from => bodyPoints(b, q).map(to => ({ from, to, distance: Math.hypot(from.x - to.x, from.y - to.y) })))
    .sort((a, b) => a.distance - b.distance);
  function distance(a, b) {
    const p = point(a), q = point(b);
    return p && q ? pairs(a, p, b, q)[0]?.distance ?? Infinity : Infinity;
  }
  function reachOf(a) {
    return Gear.reach(a);
  }
  function canAttackFrom(a, p, b) {
    const q = point(b);
    return p && q && pairs(a, p, b, q).some(pair => pair.distance <= reachOf(a) && lineClear(dungeon, pair.from, pair.to));
  }
  const canAttack = (a, b) => !!canAttackFrom(a, point(a), b);
  const canStrikeFrom = (a, p, q, target) => !!(p && q && !Gear.ranged(a) &&
    pairs(a, p, target, q).some(pair => pair.distance <= reachOf(a) && lineClear(dungeon, pair.from, pair.to)));
  const canStrike = (a, b) => canStrikeFrom(a, point(a), point(b), b);
  function canMoveTo(a, from, to) {
    const moving = entry(a) || a;
    const blocked = new Set([...actors.values()].filter(c => c !== moving && (c.hp ?? 1) > 0 && position(c, geoKey))
      .flatMap(c => Footprint.cells(c).map(p => `${p.x},${p.y}`)));
    const dx = to.x - from.x, dy = to.y - from.y;
    return Footprint.cells(moving, to).every(p => !blocked.has(`${p.x},${p.y}`) &&
      Inhabitants.canTraverse(dungeon, { x: p.x - dx, y: p.y - dy,
        ...(Number.isFinite(from.pointX) ? { pointX: from.pointX + p.x - to.x, pointY: from.pointY + p.y - to.y } : {}) }, p));
  }
  function rangedPenalty(a) {
    if (!Gear.ranged(a)) return 0;
    const friendly = a.type === 'pc' || a.type === 'npc' || Inhabitants.allegiance(a) === 'Friendly';
    return [...actors.values()].some(b => (b.hp ?? 1) > 0 && b.name !== a.name &&
      (friendly ? Inhabitants.allegiance(b) === 'Hostile' : b.type === 'pc' || b.type === 'npc' || Inhabitants.allegiance(b) === 'Friendly') &&
      pairs(a, point(a), b, point(b)).some(pair => pair.distance <= 1.5 && lineClear(dungeon, pair.from, pair.to))) ? 4 : 0;
  }
  function setHealth(combatants) {
    combatants.forEach(actor => { const c = entry(actor); if (c) c.hp = actor.hp; });
  }
  function syncRoster(list) {
    list.forEach(actor => {
      const c = entry(actor);
      if (!position(c, geoKey)) return;
      Object.assign(actor, { mazeX: c.mazeX, mazeY: c.mazeY, mazeRoomKey: c.mazeRoomKey, hp: c.hp });
      if (c.mazePoint) actor.mazePoint=c.mazePoint;
    });
    return list;
  }
  // Find an attack position in maze space, never in the rotated screen-space combat grid.
  function pursuitPath(a, b, maxSteps = Infinity) {
    const p = point(a), q = point(b);
    if (!p || !q || canAttack(a, b)) return [];
    const start = { x: Math.floor(p.x), y: Math.floor(p.y), pointX:p.x,pointY:p.y,parent: null };
    const queue = [start], seen = new Set([`${start.x},${start.y}`]);
    for (let i = 0; i < queue.length && i < 4096; i++) {
      const current = queue[i];
      if (canAttackFrom(a, { x: current.x + 0.5, y: current.y + 0.5 }, b)) {
        const path = [];
        for (let node = current; node.parent; node = node.parent) path.unshift({ x: node.x, y: node.y });
        return path.slice(0, maxSteps);
      }
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const x = current.x + dx, y = current.y + dy, key = `${x},${y}`;
        if (seen.has(key) || !canMoveTo(a, current, { x, y })) continue;
        const from = dungeon.cells[`${current.x},${current.y}`], to = dungeon.cells[key];
        if (!Inhabitants.canTraverse(dungeon, current, { x, y }) ||
            Inhabitants.ceilingHeight(dungeon, to) - (to.floorHeight || 0) <= 0.65) continue;
        seen.add(key);
        queue.push({ x, y, parent: current });
      }
    }
    return [];
  }
  function move(a, step) {
    const c = entry(a);
    if (!c || !position(c, geoKey)) return false;
    c.mazeX = step.x; c.mazeY = step.y;
    if(c.type==='pc')c.mazePoint={x:step.x+0.5,y:step.y+0.5};
    return true;
  }
  return { dungeon, roster, distance, canAttack, canAttackFrom, canStrike, canStrikeFrom, canMoveTo, rangedPenalty, point, pursuitPath, move, syncRoster, setHealth };
}

module.exports = { roomKey, position, solid, lineClear, createCombatSpace };
