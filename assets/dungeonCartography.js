(function(root) {
  'use strict';
  const validPoint = p => Number.isFinite(p?.x) && Number.isFinite(p?.y);
  const seen = (state, index) => !!(state.bits[index >> 3] & (1 << (index & 7)));
  function mark(state, index) {
    if (seen(state, index)) return false;
    state.bits[index >> 3] |= 1 << (index & 7);
    state.count++;
    return true;
  }
  const opaque = c => !c || ['wall', 'torch'].includes(c.tile) || c.tile === 'door' && !c.door?.isOpen;
  function visible(dungeon, from, tx, ty) {
    const dx = tx + 0.5 - from.x, dy = ty + 0.5 - from.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 3));
    let px = Math.floor(from.x), py = Math.floor(from.y);
    for (let i = 1; i <= steps; i++) {
      const x = Math.floor(from.x + dx * i / steps), y = Math.floor(from.y + dy * i / steps);
      if (x !== px && y !== py && opaque(dungeon.cells[`${x},${py}`]) && opaque(dungeon.cells[`${px},${y}`])) return false;
      if (x === tx && y === ty) return true;
      if (opaque(dungeon.cells[`${x},${y}`])) return false;
      px = x; py = y;
    }
    return true;
  }
  function reveal(state, dungeon, player, radius = 8) {
    if (!validPoint(player)) return [];
    const cx = Math.floor(player.x), cy = Math.floor(player.y);
    if (cx < 0 || cy < 0 || cx >= state.width || cy >= state.height || !dungeon.cells[`${cx},${cy}`]) return [];
    const tile = `${cx},${cy}:${dungeon._geometryStamp || ''}`;
    if (state.lastTile === tile) return [];
    state.lastTile = tile;
    const changed = [];
    for (let y = Math.max(0, cy - radius); y <= Math.min(state.height - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(state.width - 1, cx + radius); x++) {
        const i = y * state.width + x;
        if (seen(state, i) || !dungeon.cells[`${x},${y}`] || Math.hypot(x - cx, y - cy) > radius || !visible(dungeon, player, x, y)) continue;
        if (mark(state, i)) changed.push(i);
      }
    }
    if (changed.length) state.revision++;
    return changed;
  }
  function bearings(dungeon, player, angle = 0) {
    if (!validPoint(player) || !Number.isFinite(angle)) return [];
    return (dungeon?.roomExits?.markers || []).filter(validPoint).map(marker => {
      const dx = marker.x + 0.5 - player.x, dy = marker.y + 0.5 - player.y;
      const relative = Math.atan2(dy, dx) - angle;
      return { ...marker, distance: Math.hypot(dx, dy), relative,
        ringX: Math.sin(relative), ringY: -Math.cos(relative) };
    }).sort((a, b) => a.distance - b.distance);
  }
  function createAtlas({ load = async () => null, save = async () => {}, onLoad = () => {}, onError = () => {}, limit = 8 } = {}) {
    const rooms = new Map();
    async function flush(state) {
      if (!state || state.revision === state.savedRevision) return;
      await state.ready;
      if (state.saving) { await state.saving; return flush(state); }
      const revision = state.revision;
      state.saving = (async () => {
        try {
          await save(state.key, { width: state.width, height: state.height, bits: state.bits.slice() });
          state.savedRevision = revision;
        } catch (error) { onError(error); }
        finally { state.saving = null; }
      })();
      await state.saving;
    }
    function get(dungeon, runId) {
      const { width, height } = dungeon?.layout || {};
      const geoKey = dungeon?.geoKey;
      if (!runId || !geoKey || dungeon._meta?.runId && dungeon._meta.runId !== runId ||
          !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 512 || height > 512) return null;
      const key = `${runId}:${geoKey}`;
      let state = rooms.get(key);
      if (state && (state.width !== width || state.height !== height)) { rooms.delete(key); state = null; }
      if (state) { rooms.delete(key); rooms.set(key, state); return state; }
      state = { key, width, height, bits: new Uint8Array(Math.ceil(width * height / 8)), count: 0,
        lastTile: null, revision: 0, savedRevision: 0, saving: null };
      rooms.set(key, state);
      state.ready = Promise.resolve().then(() => load(key)).then(saved => {
        if (saved?.width !== width || saved.height !== height || saved.bits?.length !== state.bits.length) return;
        let changed = false;
        for (let i = 0; i < state.bits.length; i++) {
          const merged = state.bits[i] | saved.bits[i];
          if (merged !== state.bits[i]) { state.bits[i] = merged; changed = true; }
        }
        if (changed) {
          state.count = 0;
          for (let i = 0; i < width * height; i++) if (seen(state, i)) state.count++;
          state.revision++;
          onLoad(state);
        }
      }).catch(onError);
      while (rooms.size > Math.max(1, limit)) {
        const oldest = rooms.keys().next().value;
        flush(rooms.get(oldest)); rooms.delete(oldest);
      }
      return state;
    }
    return { get, reveal, seen, flush, async flushAll() { for (const state of rooms.values()) await flush(state); },
      clear() { rooms.clear(); }, get size() { return rooms.size; } };
  }
  const api = { bearings, createAtlas, reveal, seen, visible };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DungeonCartography = api;
})(typeof window === 'undefined' ? globalThis : window);
