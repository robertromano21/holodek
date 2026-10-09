(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.OutdoorRoutes = factory();
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';

  // World coordinates, not the renderer's screen coordinates: north is +y.
  const OFFSETS = {
    north: [0, 1, 0], northeast: [1, 1, 0], east: [1, 0, 0], southeast: [1, -1, 0],
    south: [0, -1, 0], southwest: [-1, -1, 0], west: [-1, 0, 0], northwest: [-1, 1, 0],
    up: [0, 0, 1], down: [0, 0, -1]
  };
  const HORIZONTAL = Object.keys(OFFSETS).slice(0, 8);
  const REVERSE = {
    north: 'south', northeast: 'southwest', east: 'west', southeast: 'northwest',
    south: 'north', southwest: 'northeast', west: 'east', northwest: 'southeast', up: 'down', down: 'up'
  };
  const ALIASES = { n: 'north', ne: 'northeast', e: 'east', se: 'southeast', s: 'south',
    sw: 'southwest', w: 'west', nw: 'northwest', u: 'up', d: 'down', dn: 'down' };
  const OUTDOOR_BIOMES = new Set(['wasteland', 'badlands', 'ruins', 'forest', 'woodland', 'desert',
    'plains', 'grassland', 'tundra', 'mountain', 'mountains', 'canyon', 'ravine', 'swamp', 'marsh',
    'wetland', 'coast', 'beach', 'ocean', 'lake', 'river', 'city_street', 'volcanic']);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const record = value => Object.prototype.toString.call(value) === '[object Object]';

  function direction(value) {
    if (record(value)) value = value.direction;
    if (typeof value !== 'string') return null;
    const normalized = value.toLowerCase().replace(/[\s_-]/g, '');
    const result = own(ALIASES, normalized) ? ALIASES[normalized] : normalized;
    return own(OFFSETS, result) ? result : null;
  }

  function coordinates(value) {
    let parts = record(value) ? [value.x, value.y, value.z] : [];
    if (typeof value === 'string' && value.length <= 150 && !/[\r\n]/.test(value)) {
      const match = value.trim().match(/^([-+]?\d+)\s*,\s*([-+]?\d+)\s*,\s*([-+]?\d+)$/) ||
        value.trim().match(/^X:\s*([-+]?\d+)\s*,\s*Y:\s*([-+]?\d+)\s*,\s*Z:\s*([-+]?\d+)$/i);
      if (match) parts = match.slice(1);
    }
    if (parts.length !== 3) return null;
    const numbers = parts.map(part => typeof part === 'string' && /^[-+]?\d+$/.test(part.trim()) ? Number(part) : part);
    if (!numbers.every(Number.isSafeInteger)) return null;
    return { x: numbers[0], y: numbers[1], z: numbers[2] };
  }
  const keyOf = coords => `${coords.x},${coords.y},${coords.z}`;
  const distance = (coords, origin) => Math.abs(coords.x - origin.x) + Math.abs(coords.y - origin.y) + Math.abs(coords.z - origin.z);

  function indoor(room) {
    if (!record(room)) return null;
    if (typeof room.indoor === 'boolean') return room.indoor;
    if (typeof room.classification?.indoor === 'boolean') return room.classification.indoor;
    if (typeof room.isIndoor === 'boolean') return room.isIndoor;
    if (typeof room.isOutdoor === 'boolean') return !room.isOutdoor;
    if (typeof room.sceneSpec?.indoor === 'boolean') return room.sceneSpec.indoor;
    return null;
  }

  function exitArray(raw) {
    if (Object.prototype.toString.call(raw) === '[object Map]') return Array.from(raw.keys());
    if (Array.isArray(raw)) return raw.slice();
    if (typeof raw === 'string') return raw.split(/[,;]+/).map(value => value.trim()).filter(Boolean);
    if (record(raw)) return direction(raw) ? [raw] : Object.keys(raw);
    return [];
  }

  function exitEntries(raw) {
    if (Object.prototype.toString.call(raw) === '[object Map]') {
      return Array.from(raw, ([value, info]) => ({ direction: direction(value), info }));
    }
    if (record(raw) && !direction(raw)) {
      return Object.keys(raw).map(value => ({ direction: direction(value), info: raw[value] }));
    }
    return exitArray(raw).map(value => ({ direction: direction(value), info: record(value) ? value : undefined }));
  }

  function open(info) {
    if (info === null || info === false) return false;
    if (typeof info === 'string') return info.trim().toLowerCase() === 'open';
    if (!record(info)) return true;
    const locked = value => value === true || value === 1 || value === 'true';
    if (locked(info.locked) || locked(info.isLocked) || locked(info.door?.locked) || locked(info.door?.isLocked)) return false;
    return !own(info, 'status') || typeof info.status === 'string' && info.status.trim().toLowerCase() === 'open';
  }

  function neighbor(coords, dir) {
    const offset = OFFSETS[dir];
    return coordinates({ x: coords.x + offset[0], y: coords.y + offset[1], z: coords.z + offset[2] });
  }

  function targetKey(entries, coords, dir) {
    let explicit = null;
    for (const { info } of entries) {
      if (!record(info) || !own(info, 'targetCoordinates')) continue;
      const target = coordinates(info.targetCoordinates);
      if (!target || explicit !== null && explicit !== keyOf(target)) return null;
      explicit = keyOf(target);
    }
    const adjacent = neighbor(coords, dir);
    return explicit || (adjacent ? keyOf(adjacent) : null);
  }

  function resolveExit(coords, dir, raw, extra) {
    coords = coordinates(coords);
    dir = direction(dir);
    if (!coords || !dir) return { targetKey: null, status: 'closed' };
    const entries = exitEntries(raw).concat(exitEntries(extra)).filter(entry => entry.direction === dir);
    const blocked = entries.find(entry => !open(entry.info));
    const info = blocked?.info;
    const status = !blocked ? 'open' : typeof info === 'string' ? info.trim().toLowerCase() :
      typeof info?.status === 'string' && info.status.trim().toLowerCase() !== 'open' ? info.status.trim().toLowerCase() :
        record(info) ? 'locked' : 'closed';
    const target = targetKey(entries, coords, dir);
    return { targetKey: target, status: target ? status : 'closed' };
  }

  function coordinateKeys(values) {
    const single = coordinates(values);
    const list = single ? [single] : values && typeof values !== 'string' && typeof values[Symbol.iterator] === 'function' ? values : [];
    const keys = new Set();
    for (const value of list) {
      const parsed = coordinates(value);
      if (parsed) keys.add(keyOf(parsed));
    }
    return keys;
  }

  // A read index, not a database repair: retain original keys and reject ambiguous aliases.
  function indexDatabase(database) {
    if (typeof database === 'string') { try { database = JSON.parse(database); } catch { database = {}; } }
    const isMap = Object.prototype.toString.call(database) === '[object Map]';
    const entries = isMap ? database : record(database) ? Object.entries(database) : [];
    const rooms = new Map(), keys = new Map(), ambiguous = new Set();
    const unknown = Object.freeze({ classification: Object.freeze({}), coordinateAmbiguous: true });
    for (const [rawKey, room] of entries) {
      const parsed = coordinates(rawKey);
      if (!parsed) continue;
      const key = keyOf(parsed);
      if (rooms.has(key)) { rooms.set(key, unknown); ambiguous.add(key); }
      else { rooms.set(key, room); keys.set(key, rawKey); }
    }
    return { database, isMap, rooms, keys, ambiguous };
  }

  function empty(value) {
    if (value == null || value === '' || value === false || value === 0) return true;
    if (Array.isArray(value)) return value.length === 0;
    return record(value) && Object.values(value).every(empty);
  }

  function emptyUnknownStub(room) {
    if (room == null) return true;
    if (!record(room) || indoor(room) !== null) return false;
    // A named, classified, visited, or populated room is never an empty coordinate.
    if (room.classification != null || room.sceneSpec != null || room.dungeon != null || room.visitedAt != null || room.lastVisitedAt != null) return false;
    if (exitEntries(room.exits).length) return false;
    return Object.values(room).every(empty);
  }

  function hash(value) {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
    return result >>> 0;
  }

  function wastelandName(seed, key) {
    const adjectives = ['Ashen', 'Silent', 'Sundered', 'Bleached', 'Ember', 'Hollow', 'Forsaken', 'Windworn'];
    const stamp = hash(`${seed}:${key}`);
    // Coordinates guarantee uniqueness without scanning the database or keeping a counter.
    return `${adjectives[stamp % adjectives.length]} Wasteland Reach ${stamp.toString(16)} (${key})`;
  }

  function biome(room) {
    for (const value of [room.biome, room.classification?.biome]) {
      if (typeof value === 'string' && OUTDOOR_BIOMES.has(value.trim().toLowerCase())) return value.trim().toLowerCase();
    }
    return 'wasteland';
  }

  function addExit(room, dir, info) {
    if (Object.prototype.toString.call(room.exits) === '[object Map]') room.exits.set(dir, info);
    else if (Array.isArray(room.exits) || typeof room.exits === 'string' || direction(room.exits)) {
      room.exits = exitArray(room.exits).concat({ direction: dir, ...info });
    } else {
      if (!record(room.exits)) room.exits = {};
      room.exits[dir] = info;
    }
  }

  /** Supplement exit metadata only. protectedKeys excludes both existing routes and new/reserved targets. */
  function ensureContinuation(roomDatabase, coords, exits, options = {}) {
    const resultExits = exitArray(exits);
    const finish = (reason, added = false, dir = null, key = null) => {
      if (dir && !resultExits.some(value => direction(value) === dir)) resultExits.push(dir);
      return { exits: resultExits, added, direction: dir, targetKey: key, reason };
    };
    const isMap = Object.prototype.toString.call(roomDatabase) === '[object Map]';
    if (!isMap && !record(roomDatabase)) return finish('invalid-database');
    const get = key => isMap ? roomDatabase.get(key) : own(roomDatabase, key) ? roomDatabase[key] : undefined;
    const set = (key, room) => { if (isMap) roomDatabase.set(key, room); else roomDatabase[key] = room; };
    coords = coordinates(coords);
    if (!coords) return finish('invalid-coordinates');
    const sourceKey = keyOf(coords), current = get(sourceKey);
    if (current == null) return finish('missing-room');
    if (indoor(current) !== false) return finish('not-outdoor');

    options = options || {};
    const protectedKeys = coordinateKeys(options.protectedKeys);
    const gateTarget = coordinates(current.bossGate?.targetKey);
    if (gateTarget) protectedKeys.add(keyOf(gateTarget));
    if (protectedKeys.has(sourceKey) || record(current.bossGate) && (!gateTarget || keyOf(gateTarget) === sourceKey)) {
      return finish('protected-source');
    }
    const origin = coordinates(options.origin ?? current.outdoorRegionOrigin ?? { x: 0, y: 0, z: 0 });
    if (!origin) return finish('invalid-origin');
    const sourceDistance = distance(coords, origin);
    const sourceDepth = Number.isSafeInteger(current.outdoorRegionDepth) && current.outdoorRegionDepth >= 0 ?
      current.outdoorRegionDepth : sourceDistance;
    const from = coordinates(options.fromKey), fromKey = from ? keyOf(from) : null;
    const visited = new Set();
    if (options.visitedKeys && typeof options.visitedKeys[Symbol.iterator] === 'function') {
      for (const value of options.visitedKeys) {
        const parsed = coordinates(value);
        if (parsed) visited.add(keyOf(parsed));
      }
    }
    const unvisited = (key, room) => key !== sourceKey && key !== fromKey && !protectedKeys.has(key) &&
      !record(room?.bossGate) && !visited.has(key) && !room?.visited && !room?.visitCount;
    const groups = new Map(), stored = exitEntries(current.exits);
    for (const entry of stored.concat(exitEntries(exits))) {
      if (!entry.direction) continue;
      if (!groups.has(entry.direction)) groups.set(entry.direction, []);
      groups.get(entry.direction).push(entry);
    }
    const deeper = (key, room) => {
      const target = coordinates(key);
      return target && (distance(target, origin) > sourceDistance ||
        Number.isSafeInteger(room?.outdoorRegionDepth) && room.outdoorRegionDepth > sourceDepth);
    };

    for (const [dir, entries] of groups) {
      if (!entries.every(entry => open(entry.info))) continue;
      const key = targetKey(entries, coords, dir), target = key && get(key);
      if (key && unvisited(key, target) && indoor(target) === false && deeper(key, target)) {
        return finish('existing-deeper-outdoor-exit', false, dir, key);
      }
    }

    function eligible(dir, reserved) {
      const entries = groups.get(dir) || [];
      if ((!reserved && entries.length) || !entries.every(entry => open(entry.info))) return null;
      const key = targetKey(entries, coords, dir);
      if (!key) return null;
      const target = get(key), targetCoords = coordinates(key);
      // Never invent depth for an inward/sideways new route just to satisfy the rule.
      if (!unvisited(key, target) || distance(targetCoords, origin) <= sourceDistance) return null;
      const emptyTarget = emptyUnknownStub(target);
      if (!emptyTarget && !(reserved && indoor(target) === false)) return null;
      if (!emptyTarget && (target.description || target.roomDescription || target.sceneSpec || target.dungeon || target.generated)) return null;
      if (target?.outdoorContinuationSource != null && target.outdoorContinuationSource !== sourceKey) return null;
      const reverse = REVERSE[dir];
      const reverseEntries = exitEntries(target?.exits).filter(entry => entry.direction === reverse);
      if (reverseEntries.length && (!reverseEntries.every(entry => open(entry.info)) ||
          targetKey(reverseEntries, targetCoords, reverse) !== sourceKey)) return null;
      return { dir, key, target, emptyTarget, reverse, reverseExists: reverseEntries.length > 0 };
    }

    const reserved = new Set();
    const savedDirection = direction(current.outdoorContinuation);
    if (savedDirection) reserved.add(savedDirection);
    for (const [dir, entries] of groups) {
      if (entries.some(entry => entry.info?.outdoorContinuation === true)) reserved.add(dir);
    }
    let candidate = null, reused = false;
    for (const dir of reserved) {
      candidate = eligible(dir, true);
      if (candidate) { reused = true; break; }
    }
    if (!candidate) {
      const seed = String(options.seed ?? 'outdoor-routes');
      const start = hash(seed) % HORIZONTAL.length;
      const horizontal = HORIZONTAL.slice(start).concat(HORIZONTAL.slice(0, start));
      for (const directions of [horizontal, ['up', 'down']]) {
        const candidates = directions.map(dir => eligible(dir, false)).filter(Boolean);
        candidate = candidates.find(value => value.target == null) || candidates[0];
        if (candidate) break;
      }
    }
    if (!candidate) return finish('no-available-outward-route');

    const { dir, key, reverse, reverseExists, emptyTarget } = candidate;
    const target = record(candidate.target) ? candidate.target : {};
    if (emptyTarget) {
      target.name = wastelandName(String(options.seed ?? 'outdoor-routes'), key);
      target.indoor = false;
      target.isIndoor = false;
      target.isOutdoor = true;
      target.classification = { ...(record(target.classification) ? target.classification : {}), indoor: false, biome: biome(current) };
      target.outdoorRegionOrigin = { ...origin };
      target.outdoorRegionDepth = sourceDepth + distance(coordinates(key), origin) - sourceDistance;
    }
    if (!stored.some(entry => entry.direction === dir)) {
      addExit(current, dir, { status: 'open', targetCoordinates: key, key: null, outdoorContinuation: true });
    }
    if (!reverseExists) addExit(target, reverse, { status: 'open', targetCoordinates: sourceKey, key: null, outdoorContinuation: true });
    target.outdoorContinuationSource = sourceKey;
    if (target.outdoorRegionOrigin == null) target.outdoorRegionOrigin = { ...origin };
    if (target.outdoorRegionDepth == null) target.outdoorRegionDepth = sourceDepth + distance(coordinates(key), origin) - sourceDistance;
    current.outdoorContinuation = dir;
    if (current.outdoorRegionOrigin == null) current.outdoorRegionOrigin = { ...origin };
    if (current.outdoorRegionDepth == null) current.outdoorRegionDepth = sourceDepth;
    set(key, target);
    set(sourceKey, current);
    return finish(reused ? 'reused-reserved-continuation' : 'added-outward-continuation', true, dir, key);
  }

  return { ensureContinuation, coordinates, keyOf, direction, exitEntries, resolveExit, coordinateKeys, indexDatabase, indoor };
});
