// world1 ARRIVAL_EDGES: entering a room through an exit places the party at the matching gate on the facing edge
// (north -> arrive at the south gate, east -> west gate, up -> the down stairs/portal, ...). Used for walking through
// a gate and for console quick travel alike. Pure helper, shared by the browser and the tests.
(function(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RoomArrival = api;
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict';
  const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up',
    northeast: 'southwest', southwest: 'northeast', northwest: 'southeast', southeast: 'northwest', portal: 'portal' };
  // Screen/grid vectors: north is -y in the room grid (the same convention as DungeonExits COMPASS).
  const GRID = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], northeast: [1, -1], northwest: [-1, -1], southeast: [1, 1], southwest: [-1, 1] };
  const walkable = c => c && ['floor', 'door', 'stairs'].includes(c.tile) && !c.object;
  function inward(dungeon, gate, origin) {
    // Stand 2 cells inside the gate, toward the room's interior, so the exit prompt does not fire on arrival.
    let best = null, score = Infinity;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = gate.x + dx, y = gate.y + dy, d = Math.hypot(dx, dy), c = dungeon.cells?.[`${x},${y}`];
      if (d < 1.9 || d > 3.2 || !walkable(c) || c.exitMarker) continue;
      const s = Math.hypot(x - origin.x, y - origin.y);
      if (s < score) { score = s; best = { x, y }; }
    }
    return best || { x: gate.x, y: gate.y };
  }
  // travelDirection: the direction the party moved to reach this room. Returns {x, y, gate} or null (keep the old start).
  function arrivalPoint(dungeon, travelDirection, raw, Exits = root.DungeonExits, flags = root.HolodekFlags) {
    if (flags && flags.ARRIVAL_EDGES === false) return null;
    const facing = OPPOSITE[travelDirection];
    if (!facing || !dungeon?.cells || !dungeon.layout || !dungeon.start || !Exits) return null;
    dungeon._world1Start ||= { x: dungeon.start.x, y: dungeon.start.y };
    const report = Exits.install(dungeon, raw);
    const origin = dungeon._world1Start, gate = (report?.markers || []).find(m => m.direction === facing);
    if (gate) return { ...inward(dungeon, gate, origin), gate: facing, marker: { x: gate.x, y: gate.y } };
    const v = GRID[facing];
    if (!v) return null; // up/down/portal with no matching stairs: keep the room's own start
    // No return exit was built (one-way link): use the farthest walkable cell on the facing edge.
    let best = null, score = -Infinity;
    const { width: w, height: h } = dungeon.layout;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = dungeon.cells[`${x},${y}`];
      if (!walkable(c)) continue;
      const s = (x - origin.x) * v[0] + (y - origin.y) * v[1] - Math.abs((x - origin.x) * v[1] - (y - origin.y) * v[0]) * 0.5;
      if (s > score) { score = s; best = { x, y }; }
    }
    return best ? { ...best, gate: facing, marker: null } : null;
  }
  function spawnBlocked(cell) {
    if (!cell || cell.blocked || cell.obstacle) return true;
    const tile = String(cell.tile || '');
    return tile === 'wall' || tile === 'torch' || tile === 'pillar' || tile.startsWith('custom_') ||
      tile === 'door' && !cell.door?.isOpen;
  }
  // Keep generation, return-gate travel and the browser's safety fallback on one spawn rule.
  function safeStart(dungeon, start, maxRadius = 25) {
    if (!dungeon?.cells) return start || { x: 0, y: 0 };
    const sx = Number.isFinite(start?.x) ? start.x : 0, sy = Number.isFinite(start?.y) ? start.y : 0;
    const cells = dungeon.cells, key = (x, y) => `${x},${y}`;
    const indoor = dungeon.classification && dungeon.classification.indoor !== false;
    const rooms = Array.isArray(dungeon.indoorRooms) ? dungeon.indoorRooms : null;
    const neighbors = (x, y) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    const corridor = (x, y) => {
      if (!indoor || cells[key(x, y)]?.tile !== 'floor') return false;
      if (rooms) return !rooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
      if (neighbors(x, y).filter(([a, b]) => cells[key(a, b)]?.tile === 'floor').length < 2) return false;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (cells[key(x + dx, y + dy)]?.tile === 'floor') count++;
      return count <= 5;
    };
    const visited = new Set(); let largest = null;
    for (const cellKey of Object.keys(cells)) {
      if (visited.has(cellKey)) continue;
      visited.add(cellKey);
      if (spawnBlocked(cells[cellKey])) continue;
      const component = [cellKey];
      for (let i = 0; i < component.length; i++) {
        const [x, y] = component[i].split(',').map(Number);
        for (const [a, b] of neighbors(x, y)) {
          const next = key(a, b);
          if (visited.has(next)) continue;
          visited.add(next);
          if (!spawnBlocked(cells[next])) component.push(next);
        }
      }
      if (!largest || component.length > largest.length) largest = component;
    }
    const connected = largest && new Set(largest), seen = new Set([key(sx, sy)]);
    const queue = [{ x: sx, y: sy, distance: 0 }]; let nearest = null;
    for (let i = 0; i < queue.length; i++) {
      const { x, y, distance } = queue[i];
      if (!spawnBlocked(cells[key(x, y)]) && (!connected || connected.has(key(x, y)))) {
        nearest ||= { x, y };
        if (!indoor || corridor(x, y)) return { x, y };
      }
      if (distance >= maxRadius) continue;
      for (const [a, b] of neighbors(x, y)) {
        const next = key(a, b);
        if (!seen.has(next)) { seen.add(next); queue.push({ x: a, y: b, distance: distance + 1 }); }
      }
    }
    if (largest && indoor) for (const cellKey of largest) {
      const [x, y] = cellKey.split(',').map(Number);
      if (corridor(x, y)) return { x, y };
    }
    const [x, y] = (largest?.[0] || key(sx, sy)).split(',').map(Number);
    return nearest || { x, y };
  }
  return { OPPOSITE, GRID, arrivalPoint, spawnBlocked, safeStart };
});
