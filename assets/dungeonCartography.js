(function(root) {
  'use strict';
  const validPoint = p => Number.isFinite(p?.x) && Number.isFinite(p?.y);
  const Catalog = typeof module !== 'undefined' && module.exports ? require('./landmarkCatalog') : null;
  const Residents = typeof module !== 'undefined' && module.exports ? require('./dungeonInhabitants') : null;
  function landmarks(dungeon, state) {
    const known = new Set(state?.knownLandmarks || []);
    return (Catalog || root.LandmarkCatalog)?.catalog(dungeon).filter(marker => marker.knownOnArrival || known.has(marker.id)) || [];
  }
  function observeResident(state, dungeon, actor, player, at = Date.now()) {
    const key = String(actor?.mazeRoomKey || '').replace(/[XYZ:\s]/gi, '');
    if (!state || actor?.type !== 'monster' || key !== dungeon?.geoKey || actor.discoveryState === 'pending' ||
        actor.state === 'Dead' || (actor.hp ?? 1) <= 0 || !Number.isFinite(actor.mazeX) || !Number.isFinite(actor.mazeY) ||
        !dungeon.cells?.[`${actor.mazeX},${actor.mazeY}`] || typeof actor.name !== 'string' || !validPoint(player) ||
        Math.hypot(actor.mazeX + .5 - player.x, actor.mazeY + .5 - player.y) > 8 ||
        !visible(dungeon, player, actor.mazeX, actor.mazeY)) return { fresh: false, changed: false };
    const residents = Residents || root.DungeonInhabitants;
    if (residents && !residents.lineClear(dungeon, player, { x: actor.mazeX + .5, y: actor.mazeY + .5 })) return { fresh: false, changed: false };
    state.knownResidents ||= [];
    const previous = state.knownResidents.find(row => row.name === actor.name), fresh = !previous;
    const x = actor.mazeX + .5, y = actor.mazeY + .5, allegiance = actor.allegiance || actor.state || 'Neutral';
    if (previous && previous.x === x && previous.y === y && previous.allegiance === allegiance) return { fresh, changed: false };
    const row = { name: actor.name.slice(0, 70), x, y, allegiance, firstSeenAt: previous?.firstSeenAt || at, lastSeenAt: at };
    if (previous) Object.assign(previous, row); else state.knownResidents.push(row);
    if (state.knownResidents.length > 32) state.knownResidents.shift();
    state.revision++; return { fresh, changed: true };
  }
  function knownEncounters(dungeon, state, population, roster = []) {
    if (!dungeon || population?.geoKey !== dungeon.geoKey) return [];
    const party = new Set(roster.filter(a => a.type === 'npc').map(a => a.name));
    return (state?.knownResidents || []).flatMap(row => {
      const record = population.actors?.[row.name], actor = roster.find(a => a.name === row.name);
      if (!record || record.status !== 'present' || record.discoveryState === 'pending' || record.state === 'Dead' || (record.hp ?? 1) <= 0 ||
          actor?.state === 'Dead' || (actor?.hp ?? 1) <= 0 || party.has(row.name) || !validPoint(row)) return [];
      return [{ id: `resident:${row.name}`, name: row.name, label: row.name, x: row.x, y: row.y, kind: 'encounter',
        allegiance: row.allegiance, lastSeenAt: row.lastSeenAt,
        glyph: { Friendly: 'F', Neutral: 'N', Hostile: 'H' }[row.allegiance] || '?',
        color: { Friendly: '#8ecba6', Neutral: '#91bcdd', Hostile: '#de8174' }[row.allegiance] || '#dbb879' }];
    });
  }
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
  function encounters(dungeon, population, roster = []) {
    if (!dungeon || population?.geoKey !== dungeon.geoKey || !Array.isArray(population.groups)) return [];
    const { width, height } = dungeon.layout || {};
    roster = Array.isArray(roster) ? roster : [];
    const party = new Set(roster.filter(a => a?.type === 'npc').map(a => a.name));
    const actors = new Map(roster.filter(a => a?.type === 'monster' && a.mazeRoomKey &&
      String(a.mazeRoomKey).replace(/[XYZ:\s]/gi, '') === dungeon.geoKey).map(a => [a.name, a]));
    return population.groups.slice(0, 20).flatMap((group, index) => {
      if (group.status === 'exhausted') return [];
      const living = (group.members || []).slice(0, 4).map(name => population.actors?.[name]).filter(a =>
        a?.status === 'present' && !party.has(a.name) && a.state !== 'Dead' && (a.hp ?? 1) > 0 &&
        (actors.get(a.name)?.hp ?? 1) > 0 && actors.get(a.name)?.state !== 'Dead');
      const points = living.map(a => {
        const actor = actors.get(a.name);
        return Number.isFinite(actor?.mazeX) && Number.isFinite(actor?.mazeY) ? { x: actor.mazeX, y: actor.mazeY } : a.position;
      }).filter(p => validPoint(p) && p.x >= 0 && p.y >= 0 && p.x < width && p.y < height && dungeon.cells?.[`${p.x},${p.y}`]);
      if (!points.length) return [];
      const known = ['discovered', 'engaged'].includes(group.status), questContact = living.some(a => a.name === population.questIntroduction?.speaker);
      const states = new Set(living.map(a => a.allegiance || a.state || 'Neutral'));
      const allegiance = known ? states.size === 1 ? [...states][0] : 'Mixed' : null;
      return [{ id: group.id, x: points.reduce((sum, p) => sum + p.x + .5, 0) / points.length,
        y: points.reduce((sum, p) => sum + p.y + .5, 0) / points.length, known, questContact, allegiance,
        label: known ? living.map(a => a.name).join(', ').slice(0, 90) : questContact ? 'Quest contact' : `Encounter ${index + 1}`,
        glyph: questContact ? '!' : !known ? '?' : { Friendly: 'F', Neutral: 'N', Hostile: 'H' }[allegiance] || '?',
        color: questContact ? '#f3d582' : !known ? '#dbb879' : { Friendly: '#8ecba6', Neutral: '#91bcdd', Hostile: '#de8174' }[allegiance] || '#dbb879' }];
    });
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
          await save(state.key, { width: state.width, height: state.height, bits: state.bits.slice(),
            knownLandmarks: state.knownLandmarks.slice(), announcedLandmarks: state.announcedLandmarks.slice(),
            knownResidents: state.knownResidents.map(row => ({ ...row })) });
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
        knownLandmarks: [], announcedLandmarks: [], knownResidents: [], loaded: false,
        lastTile: null, revision: 0, savedRevision: 0, saving: null };
      rooms.set(key, state);
      state.ready = Promise.resolve().then(() => load(key)).then(saved => {
        if (saved?.width !== width || saved.height !== height || saved.bits?.length !== state.bits.length) return;
        state.knownLandmarks = [...new Set([...state.knownLandmarks, ...(Array.isArray(saved.knownLandmarks) ? saved.knownLandmarks : []).filter(id => typeof id === 'string')])].slice(-64);
        state.announcedLandmarks = [...new Set([...state.announcedLandmarks, ...(Array.isArray(saved.announcedLandmarks) ? saved.announcedLandmarks : []).filter(id => typeof id === 'string')])].slice(-64);
        for (const row of (Array.isArray(saved.knownResidents) ? saved.knownResidents : []).slice(0, 32)) {
          if (!row || typeof row.name !== 'string' || row.name.length > 70 || !validPoint(row) || row.x < 0 || row.y < 0 ||
              row.x >= width || row.y >= height || !['Friendly', 'Neutral', 'Hostile'].includes(row.allegiance) ||
              state.knownResidents.some(known => known.name === row.name)) continue;
          state.knownResidents.push({ name: row.name, x: row.x, y: row.y, allegiance: row.allegiance,
            firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt });
        }
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
      }).catch(onError).then(() => { state.loaded = true; });
      while (rooms.size > Math.max(1, limit)) {
        const oldest = rooms.keys().next().value;
        flush(rooms.get(oldest)); rooms.delete(oldest);
      }
      return state;
    }
    return { get, reveal, seen, flush, async flushAll() { for (const state of rooms.values()) await flush(state); },
      clear() { rooms.clear(); }, get size() { return rooms.size; } };
  }
  const api = { bearings, encounters, landmarks, observeResident, knownEncounters, createAtlas, reveal, seen, visible };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DungeonCartography = api;
})(typeof window === 'undefined' ? globalThis : window);
