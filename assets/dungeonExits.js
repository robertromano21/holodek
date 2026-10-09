(function(root) {
  'use strict';
  const COMPASS = { north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1],
    south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1] };
  const LABELS = { north: 'N', northeast: 'NE', east: 'E', southeast: 'SE', south: 'S', southwest: 'SW', west: 'W', northwest: 'NW', up: 'UP', down: 'DN' };
  const cache = new WeakMap();
  const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  function normalize(raw) {
    const aliases = { n: 'north', ne: 'northeast', e: 'east', se: 'southeast', s: 'south', sw: 'southwest', w: 'west', nw: 'northwest', u: 'up', d: 'down' };
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;]+/) : Object.keys(raw || {});
    return [...new Set(list.map(v => String(v?.direction || v).toLowerCase().replace(/[\s-]/g, '')).map(v => aliases[v] || v)
      .filter(v => LABELS[v]))];
  }
  const passable = c => !!c && !c.blocked && !c.obstacle && (c.tile === 'floor' || c.tile === 'door' && !c.door?.isLocked && !c.door?.locked);
  function install(dungeon, raw = dungeon?.sceneSpec?.exits ?? dungeon?.sceneSpec?.source?.exits ?? []) {
    if (!dungeon?.cells || !dungeon.layout || !dungeon.start) return { status: 'skipped', markers: [] };
    const directions = normalize(raw), signature = directions.slice().sort().join(','), stamp = dungeon._geometryStamp;
    const previous = cache.get(dungeon);
    if (previous?.signature === signature && previous.stamp === stamp) return dungeon.roomExits;
    const { width: w, height: h } = dungeon.layout, { x: sx, y: sy } = dungeon.start;
    if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 512 && h <= 512)) return { status: 'skipped', markers: [] };
    const seen = new Uint8Array(w * h), parents = new Int32Array(w * h).fill(-1), q = new Int32Array(w * h);
    const first = sx + sy * w;
    let count = 0, head = 0;
    if (passable(dungeon.cells[`${sx},${sy}`])) { seen[first] = 1; q[count++] = first; }
    while (head < count) {
      const i = q[head++], x = i % w, y = Math.floor(i / w), floor = dungeon.cells[`${x},${y}`].floorHeight || 0;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx, ny = y + dy, j = nx + ny * w, c = dungeon.cells[`${nx},${ny}`];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[j] || !passable(c) || Math.abs((c.floorHeight || 0) - floor) > 1.5) continue;
        seen[j] = 1; parents[j] = i; q[count++] = j;
      }
    }
    const markers = [], missing = [];
    for (const direction of directions) {
      let best = null, score = -Infinity;
      const v = COMPASS[direction];
      for (let n = 0; n < count; n++) {
        const i = q[n], x = i % w, y = Math.floor(i / w), c = dungeon.cells[`${x},${y}`];
        const dx = x - sx, dy = y - sy, d = Math.hypot(dx, dy);
        if (d < 4 || c.tile !== 'floor' || c.feature || c.interactable || markers.some(m => Math.hypot(x - m.x, y - m.y) < 3)) continue;
        const planned = c.complexExit === direction || c.exit === direction || c.exit?.direction === direction;
        const dot = v ? (dx * v[0] + dy * v[1]) / Math.hypot(...v) : 0;
        if (!planned && (d > 80 || v && dot < d * 0.75)) continue;
        const s = planned ? 10000 - d : v ? dot - Math.abs(dx * v[1] - dy * v[0]) * 1.5 : -Math.abs(d - 15);
        if (s > score) { score = s; best = { direction, label: LABELS[direction], key: `${x},${y}`, x, y,
          floor: c.floorHeight || 0, kind: planned ? 'architectural-exit' : v ? 'directional-route' : 'portal-landing', i }; }
      }
      // A narrow or curved complex may not have a floor tile in that compass sector.
      if (!best) for (let n = count - 1; n >= 0; n--) {
        const i = q[n], x = i % w, y = Math.floor(i / w), c = dungeon.cells[`${x},${y}`];
        if (c.tile !== 'floor' || c.feature || c.interactable || Math.hypot(x - sx, y - sy) < 3 || markers.some(m => m.key === `${x},${y}`)) continue;
        best = { direction, label: LABELS[direction], key: `${x},${y}`, x, y, floor: c.floorHeight || 0, kind: 'portal-landing', i }; break;
      }
      if (!best) { missing.push(direction); continue; }
      // Reserve the existing route. Never carve a shortcut through a wall or change its elevation.
      let i = best.i;
      while (i >= 0) {
        const x = i % w, y = Math.floor(i / w), c = dungeon.cells[`${x},${y}`];
        if (c) c.navigationReserved = true;
        i = parents[i];
      }
      delete best.i;
      markers.push(best);
    }
    dungeon.tiles ||= {};
    dungeon.tiles.journey_exit_marker = { spriteSpec: { voxelShape: 'exit_marker', material: 'wood', collisionBlocking: false },
      landmark: { type: 'exit_marker', label: 'Journey threshold' } };
    dungeon.sceneStructures = (dungeon.sceneStructures || []).filter(p => p.role !== 'journey-exit-marker');
    for (const marker of markers) dungeon.sceneStructures.push({ role: 'journey-exit-marker', shape: 'exit_marker', tile: 'journey_exit_marker',
      direction: marker.direction, position: { x: marker.x + 0.05, y: marker.y + 0.05, z: marker.floor + 0.01 }, size: { x: 0.9, y: 0.9, z: 0.06 } });
    dungeon.roomExits = { version: 1, signature, status: missing.length ? 'partial' : 'built', markers, missing, reachable: count };
    cache.set(dungeon, { signature, stamp });
    return dungeon.roomExits;
  }
  function nearby(dungeon, player, radius = 1) {
    if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return null;
    const current = dungeon.cells?.[`${Math.floor(player.x)},${Math.floor(player.y)}`];
    const floor = current?.floorHeight || 0;
    return (dungeon.roomExits?.markers || []).filter(m => {
      const dx = m.x + 0.5 - player.x, dy = m.y + 0.5 - player.y, d = Math.hypot(dx, dy);
      if (d > radius || Math.abs(m.floor - floor) > 0.75) return false;
      const steps = Math.max(1, Math.ceil(d * 8));
      for (let i = 0; i <= steps; i++) {
        const c = dungeon.cells?.[`${Math.floor(player.x + dx * i / steps)},${Math.floor(player.y + dy * i / steps)}`];
        if (!passable(c) || c.tile === 'door' && !c.door?.isOpen || Math.abs((c.floorHeight || 0) - floor) > 1.5) return false;
      }
      return true;
    }).sort((a, b) => Math.hypot(a.x + 0.5 - player.x, a.y + 0.5 - player.y) - Math.hypot(b.x + 0.5 - player.x, b.y + 0.5 - player.y))[0] || null;
  }
  const api = { install, normalize, nearby, LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DungeonExits = api;
})(typeof window === 'undefined' ? globalThis : window);
