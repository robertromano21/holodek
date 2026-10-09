function roomKey(value) {
  const numbers = String(value || '').match(/-?\d+/g);
  return numbers?.length === 3 ? numbers.map(Number).join(',') : null;
}

function position(actor, geoKey) {
  if (!actor || !roomKey(geoKey) || roomKey(actor.mazeRoomKey) !== roomKey(geoKey) || !Number.isFinite(actor.mazeX) || !Number.isFinite(actor.mazeY)) return null;
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
    return !solid(cell) && Math.min(z0, z1) >= (cell.floorHeight || 0) && Math.max(z0, z1) < (cell.ceilHeight ?? Infinity);
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
  const entry = actor => actors.get(String(actor.name || actor.Name).toLowerCase());
  const point = actor => position(entry(actor), geoKey);
  function distance(a, b) {
    const p = point(a), q = point(b);
    return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : Infinity;
  }
  function reachOf(a) {
    const weapon = String(a.equipped?.Weapon || a.equipped?.weapon || '');
    return /\b(bow|longbow|shortbow|crossbow|sling)\b/i.test(weapon) ? 8 : /\b(spear|pike|halberd)\b/i.test(weapon) ? 2 : 1.5;
  }
  function canAttackFrom(a, p, b) {
    const q = point(b);
    return p && q && Math.hypot(p.x - q.x, p.y - q.y) <= reachOf(a) && lineClear(dungeon, p, q);
  }
  const canAttack = (a, b) => !!canAttackFrom(a, point(a), b);
  function setHealth(combatants) {
    combatants.forEach(actor => { const c = entry(actor); if (c) c.hp = actor.hp; });
  }
  function syncRoster(list) {
    list.forEach(actor => {
      const c = entry(actor);
      if (!position(c, geoKey)) return;
      Object.assign(actor, { mazeX: c.mazeX, mazeY: c.mazeY, mazeRoomKey: c.mazeRoomKey, hp: c.hp });
    });
    return list;
  }
  // Find an attack position in maze space, never in the rotated screen-space combat grid.
  function pursuitPath(a, b, maxSteps = Infinity) {
    const p = point(a), q = point(b);
    if (!p || !q || canAttack(a, b)) return [];
    const blocked = new Set([...actors.values()].filter(c => c !== entry(a) && (c.hp ?? 1) > 0 && position(c, geoKey))
      .map(c => `${c.mazeX},${c.mazeY}`));
    const start = { x: Math.floor(p.x), y: Math.floor(p.y), parent: null };
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
        if (seen.has(key) || blocked.has(key)) continue;
        const from = dungeon.cells[`${current.x},${current.y}`], to = dungeon.cells[key];
        if (solid(to) || Math.abs((to.floorHeight || 0) - (from?.floorHeight || 0)) > 1.5 ||
            (to.ceilHeight ?? Infinity) - (to.floorHeight || 0) <= 0.65) continue;
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
    return true;
  }
  return { distance, canAttack, point, pursuitPath, move, syncRoster, setHealth };
}

module.exports = { roomKey, position, solid, lineClear, createCombatSpace };
