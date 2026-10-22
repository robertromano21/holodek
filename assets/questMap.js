// world1 quest map: objectives on the level map, exit labels for remote objectives, giver map reveals,
// and the first-time-on-foot exit lock. Pure helpers shared by the browser and the tests.
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QuestMap = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const flag = (flags, name) => !flags || flags[name] !== false;
  const parse = k => String(k || '').split(',').map(Number);
  const VECTORS = { north: [0, 1, 0], south: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 0, 1], down: [0, 0, -1],
    northeast: [1, 1, 0], northwest: [-1, 1, 0], southeast: [1, -1, 0], southwest: [-1, -1, 0] };
  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ---- Exits must be found on foot first -------------------------------------------------------------
  // Only campaigns created with FOOT_EXITS carry footExitsTracked on 0,0,0, so every exit of an old save counts as traversed.
  function tracked(db) { const start = db?.get ? db.get('0,0,0') : db?.['0,0,0']; return !!start?.footExitsTracked; }
  function exitLocked(db, geoKey, direction, flags) {
    if (!flag(flags, 'FOOT_EXITS') || !tracked(db) || !direction) return false;
    const room = db?.get ? db.get(geoKey) : db?.[geoKey];
    if (!room) return false;
    if (room.footExits && room.footExits[direction]) return false;
    const start = db?.get ? db.get('0,0,0') : db?.['0,0,0'];
    return !(start?.pendingFootExits?.[geoKey] || []).includes(direction); // return exit walked before this room was saved
  }
  const OPP = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up', northeast: 'southwest', southwest: 'northeast', northwest: 'southeast', southeast: 'northwest' };
  function neighbourKey(geoKey, direction) {
    const v = VECTORS[direction], c = parse(geoKey);
    return v && c.length === 3 && c.every(Number.isFinite) ? `${c[0] + v[0]},${c[1] + v[1]},${c[2] + v[2]}` : null;
  }
  // Walking through an exit on foot marks it and the return exit of the next room (stored as pending until that room exists).
  function markTraversed(db, geoKey, direction) {
    const get = k => db?.get ? db.get(k) : db?.[k], room = get(geoKey);
    if (!room) return null;
    room.footExits ||= {}; room.footExits[direction] = true;
    const target = neighbourKey(geoKey, direction), back = OPP[direction];
    if (!target || !back) return { target: null };
    const next = get(target);
    if (next) { next.footExits ||= {}; next.footExits[back] = true; }
    else { const start = get('0,0,0'); if (start) { start.pendingFootExits ||= {}; start.pendingFootExits[target] = [...new Set([...(start.pendingFootExits[target] || []), back])]; } }
    return { target, back };
  }
  const LOCK_MESSAGE = 'You have not yet found that way on foot. Walk to the passage first; once you have passed through it, the road is known.';

  // ---- Objectives -------------------------------------------------------------------------------------
  function missions(db) {
    const rooms = db?.entries ? [...db.entries()] : Object.entries(db || {});
    return rooms.flatMap(([key, room]) => Object.values(room?.minorMissions || {}).filter(m => m?.objective && m.status !== 'completed')
      .map(m => ({ ...m.objective, id: m.id, giverRoomKey: key })));
  }
  // Direction of the exit from fromKey that best heads toward toKey.
  function exitToward(markers, fromKey, toKey) {
    const a = parse(fromKey), b = parse(toKey), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let best = null, score = 0;
    for (const m of markers || []) {
      const v = VECTORS[m.direction]; if (!v) continue;
      const s = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2] * 3) / Math.hypot(...v);
      if (s > score) { score = s; best = m; }
    }
    return best;
  }
  // A spot in the room's own geography: a matching landmark if one exists, else a stable floor cell well away from the arrival.
  function localPoint(dungeon, seed, spot, landmarks = []) {
    const words = String(spot || '').toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const lm = landmarks.find(l => words.some(w => String(l.label || l.kind).toLowerCase().includes(w) || String(l.kind).toLowerCase().includes(w)));
    if (lm) return { x: Math.floor(lm.x), y: Math.floor(lm.y), landmarkId: lm.id };
    const w = dungeon?.layout?.width || 0, h = dungeon?.layout?.height || 0, start = dungeon?.start || { x: w / 2, y: h / 2 };
    const floors = [];
    for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
      const c = dungeon.cells?.[`${x},${y}`];
      if (c?.tile === 'floor' && !c.exitMarker && Math.hypot(x - start.x, y - start.y) >= Math.min(w, h) / 4) floors.push({ x, y });
    }
    return floors.length ? floors[hash(seed) % floors.length] : null;
  }
  // Markers for the per-room map, plus labels to add to exits that lead toward objectives elsewhere.
  function mapMarkers(dungeon, db, { flags, landmarks = [] } = {}) {
    if (!flag(flags, 'QUEST_LOCAL') || !dungeon?.geoKey) return { markers: [], exitLabels: {} };
    const markers = [], exitLabels = {};
    for (const o of missions(db)) {
      const text = `${o.name}: ${o.step}`.slice(0, 90);
      if (o.roomKey === dungeon.geoKey) {
        const p = o.local ? localPoint(dungeon, o.id, o.spot, landmarks) : null;
        if (p) markers.push({ id: `quest:${o.id}`, missionId: o.id, x: p.x + .5, y: p.y + .5, kind: 'quest', glyph: '!', color: '#f3d582', label: text, local: o.local, landmarkId: p.landmarkId });
      } else {
        const exit = exitToward(dungeon.roomExits?.markers, dungeon.geoKey, o.roomKey);
        if (exit) (exitLabels[exit.direction] ||= []).push(text);
      }
    }
    return { markers, exitLabels };
  }

  // ---- Giver reveals ----------------------------------------------------------------------------------
  // Returns cells the giver's marks expose: small discs at the objective and matching landmarks, and a thin path toward the route's exit.
  function revealCells(dungeon, room, { flags, landmarks = [] } = {}) {
    if (!flag(flags, 'QUEST_REVEALS') || !room?.mapReveals) return { cells: [], landmarkIds: [], applied: [] };
    const cells = [], landmarkIds = [], applied = [], disc = (p, r) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) cells.push({ x: p.x + x, y: p.y + y }); };
    for (const [missionId, rv] of Object.entries(room.mapReveals)) {
      if (!rv?.revealed) continue;
      for (const [i, item] of rv.items.entries()) {
        if (item.roomKey && item.roomKey !== dungeon.geoKey) continue;
        if (item.kind === 'route' && item.towardKey) {
          const exit = exitToward(dungeon.roomExits?.markers, dungeon.geoKey, item.towardKey), from = dungeon.start;
          if (!exit || !from) continue;
          const steps = Math.ceil(Math.hypot(exit.x - from.x, exit.y - from.y));
          for (let s = 0; s <= steps; s += 1) cells.push({ x: Math.round(from.x + (exit.x - from.x) * s / steps), y: Math.round(from.y + (exit.y - from.y) * s / steps) });
        } else {
          const p = localPoint(dungeon, item.kind === 'objective' ? missionId : `${missionId}:${i}`, `${item.kind} ${item.label}`, landmarks);
          if (!p) continue; disc(p, 3); if (p.landmarkId) landmarkIds.push(p.landmarkId);
        }
        applied.push(`${missionId}:${i}`);
      }
    }
    return { cells: cells.filter(c => dungeon.cells?.[`${c.x},${c.y}`]), landmarkIds, applied };
  }
  return { exitLocked, neighbourKey, markTraversed, OPP, tracked, LOCK_MESSAGE, missions, exitToward, localPoint, mapMarkers, revealCells, VECTORS };
});
