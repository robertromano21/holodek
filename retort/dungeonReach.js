function position(actor, geoKey) {
  if (!actor || actor.mazeRoomKey !== geoKey || !Number.isFinite(actor.mazeX) || !Number.isFinite(actor.mazeY)) return null;
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
  const point = actor => position(actors.get(String(actor.name || actor.Name).toLowerCase()), geoKey);
  function distance(a, b) {
    const p = point(a), q = point(b);
    return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : Infinity;
  }
  function canAttack(a, b) {
    const weapon = String(a.equipped?.Weapon || a.equipped?.weapon || '');
    const reach = /\b(bow|longbow|shortbow|crossbow|sling)\b/i.test(weapon) ? 8 : /\b(spear|pike|halberd)\b/i.test(weapon) ? 2 : 1.5;
    return distance(a, b) <= reach && lineClear(dungeon, point(a), point(b));
  }
  return { distance, canAttack };
}

module.exports = { position, solid, lineClear, createCombatSpace };
