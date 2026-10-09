'use strict';

const { random } = require('./dungeonGeneration');
const { makeNavigation, reachable } = require('./sceneArchitecture');
const ROLES = new Set(['entrance', 'hall', 'chapel', 'sanctum', 'shrine', 'rotunda', 'courtyard', 'chamber', 'gallery', 'crypt', 'keep']);
const ROOFS = new Set(['stone', 'barrel', 'groin', 'ribbed', 'fan', 'timber', 'hammerbeam', 'boarded', 'coffered', 'gold-coffered', 'pendentive', 'squinch', 'domed', 'pitched']);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
const center = r => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });
const inside = (r, p) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

function build(dungeon, plan = {}, base = {}) {
  if (!plan || typeof plan !== 'object') plan = {};
  const { width, height } = dungeon.layout;
  const rng = random(`${dungeon.generation?.seed || dungeon.blueprint?.seed || 'indoor'}:blueprint`);
  const floor = finite(base.floor, 0), clearance = clamp(finite(base.ceil, 2.5), 2, 14);
  const cells = dungeon.cells;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells[`${x},${y}`] = {
    tile: 'wall', feature: null, floorHeight: floor, ceilHeight: floor + clearance
  };
  const rooms = [];
  const authored = Array.isArray(plan.rooms) ? plan.rooms : [];
  const levels = Array.isArray(plan.heightLevels) ? plan.heightLevels : [];
  for (const r of authored.slice(0, 16)) {
    if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) continue;
    const w = clamp(Math.floor(r.w * width), 3, width - 2), h = clamp(Math.floor(r.h * height), 3, height - 2);
    rooms.push({ x: clamp(Math.floor(r.x * (width - 1)), 1, width - w - 1),
      y: clamp(Math.floor(r.y * (height - 1)), 1, height - h - 1), w, h,
      role: ROLES.has(r.role) ? r.role : 'chamber',
      ...(ROOFS.has(r.roofStyle) ? { roofStyle: r.roofStyle } : {}),
      ...(['doric', 'ionic', 'corinthian'].includes(r.columnOrder) ? { columnOrder: r.columnOrder } : {}),
      floor: floor + clamp(finite(r.floor, finite(levels[rooms.length % (levels.length || 1)], 0)), -8, 12),
      clearance: clamp(finite(r.clearance, clearance), 2, 14) });
  }
  if (!rooms.length) {
    const count = clamp(Math.floor(finite(plan.roomCount, 8)), 4, 12);
    const scale = clamp(Math.min(width, height) / 32, 1, 3);
    for (let attempt = 0; rooms.length < count && attempt < count * 40; attempt++) {
      const w = clamp(Math.floor((4 + rng() * 6) * scale), 3, width - 2);
      const h = clamp(Math.floor((4 + rng() * 6) * scale), 3, height - 2);
      const r = { x: rooms.length ? 1 + Math.floor(rng() * (width - w - 2)) :
        clamp(dungeon.start.x - Math.floor(w / 2), 1, width - w - 1),
      y: rooms.length ? 1 + Math.floor(rng() * (height - h - 2)) :
        clamp(dungeon.start.y - Math.floor(h / 2), 1, height - h - 1), w, h,
      role: rooms.length ? 'chamber' : 'entrance', clearance,
      floor: floor + finite(levels[rooms.length % (levels.length || 1)], rooms.length ? Math.floor(rng() * 5) * 0.5 - 1 : 0) };
      if (rooms.some(a => r.x <= a.x + a.w && r.x + r.w >= a.x && r.y <= a.y + a.h && r.y + r.h >= a.y)) continue;
      rooms.push(r);
    }
  }
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    Object.assign(cells[`${x},${y}`], { tile: 'floor', floorHeight: r.floor, ceilHeight: r.floor + r.clearance });
  }
  const entrance = rooms.find(r => r.role === 'entrance') || rooms.find(r => inside(r, dungeon.start)) || rooms[0];
  if (!rooms.some(r => inside(r, dungeon.start))) dungeon.start = center(entrance);
  const corridors = [];
  const endpoint = (value, index) => {
    if (Number.isInteger(index) && rooms[index]) return center(rooms[index]);
    if (Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)) return {
      x: clamp(Math.floor(value[0] * (width - 1)), 1, width - 2),
      y: clamp(Math.floor(value[1] * (height - 1)), 1, height - 2) };
    return null;
  };
  function connect(from, to, request = {}, repaired = false) {
    const points = [{ ...from }];
    const horizontal = request.style === 'H' || request.style !== 'V' && rng() < 0.5;
    let { x, y } = from;
    while (x !== to.x || y !== to.y) {
      if (horizontal ? x !== to.x : y === to.y) x += Math.sign(to.x - x);
      else y += Math.sign(to.y - y);
      points.push({ x, y });
    }
    const a = cells[`${from.x},${from.y}`].floorHeight, b = cells[`${to.x},${to.y}`].floorHeight;
    const passage = points.map((p, i) => cells[`${p.x},${p.y}`].tile !== 'floor' ? i : -1).filter(i => i >= 0);
    const begin = passage.length ? passage[0] - 1 : 0, end = passage.length ? passage[passage.length - 1] + 1 : points.length - 1;
    const span = clamp(Math.round(finite(request.width, 2)), 1, 4);
    points.forEach((p, i) => {
      const z = a + (b - a) * clamp((i - begin) / Math.max(1, end - begin), 0, 1);
      for (let dy = -Math.floor(span / 2); dy < Math.ceil(span / 2); dy++) {
        for (let dx = -Math.floor(span / 2); dx < Math.ceil(span / 2); dx++) {
          const px = p.x + dx, py = p.y + dy;
          if (px < 1 || py < 1 || px >= width - 1 || py >= height - 1) continue;
          const c = cells[`${px},${py}`];
          // Room interiors keep their designed elevation; only the linking passage ramps.
          if (c.tile !== 'floor') Object.assign(c, { tile: 'floor', floorHeight: z, ceilHeight: z + clearance });
          c.navigationReserved = true;
        }
      }
    });
    corridors.push({ from, to, width: span, repaired });
  }
  for (const c of (Array.isArray(plan.corridors) ? plan.corridors : []).slice(0, 32)) {
    const from = endpoint(c?.from, c?.fromRoom), to = endpoint(c?.to, c?.toRoom);
    if (from && to) connect(from, to, c);
  }
  // Repair only missing links, rather than replacing the designer's corridor network.
  let connected = reachable(makeNavigation(dungeon), dungeon.start);
  for (const r of rooms) {
    const to = center(r);
    if (connected.seen[to.y * width + to.x]) continue;
    const linked = rooms.map(center).filter(p => connected.seen[p.y * width + p.x]);
    linked.sort((a, b) => Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y));
    connect(linked[0] || dungeon.start, to, {}, true);
    connected = reachable(makeNavigation(dungeon), dungeon.start);
  }
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const c = cells[`${x},${y}`];
    if (c.tile !== 'wall') continue;
    const adjacent = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => cells[`${x + dx},${y + dy}`]).filter(n => n.tile === 'floor');
    if (!adjacent.length) continue;
    c.floorHeight = Math.min(floor, ...adjacent.map(n => n.floorHeight));
    c.ceilHeight = Math.max(floor + clearance, ...adjacent.map(n => n.ceilHeight));
  }
  dungeon.indoorRooms = rooms;
  dungeon.indoorHeightLevels = rooms.map(r => r.floor - floor);
  dungeon.indoorLayout = { version: 1, source: rooms.length && authored.length ? 'llm-blueprint' : 'seeded-fallback',
    rooms: rooms.length, corridors, repairedLinks: corridors.filter(c => c.repaired).length,
    reachableCells: connected.count, disconnectedRooms: rooms.filter(r => { const p = center(r); return !connected.seen[p.y * width + p.x]; }).length };
  return dungeon.indoorLayout;
}

module.exports = { build, ROLES, ROOFS };
