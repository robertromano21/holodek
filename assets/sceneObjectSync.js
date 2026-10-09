(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./renderSceneItems'));
  else if (typeof define === 'function' && define.amd) define(['./renderSceneItems'], items => factory(items, root));
  else root.SceneObjectSync = factory(null, root);
})(typeof window === 'undefined' ? globalThis : window, function(dependency, root) {
  'use strict';

  const cache = new WeakMap();
  const EMPTY = Object.freeze([]);
  const STEP_HEIGHT = 1.5;
  const POOL_LIMIT = 64;
  const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  function coordinateKey(value) {
    const parts = typeof value === 'string' ? value.split(',') : value && typeof value === 'object' ? [value.x, value.y, value.z] : [];
    if (parts.length !== 3) return null;
    const numbers = parts.map(part => typeof part === 'string' && /^[-+]?\d+$/.test(part.trim()) ? Number(part) : part);
    return numbers.every(Number.isSafeInteger) ? numbers.join(',') : null;
  }

  function fields(text, label) {
    const pattern = new RegExp(`^[ \\t]*${label}:[ \\t]*([^\\r\\n]*)`, 'gm');
    return Array.from(text.matchAll(pattern), match => match[1].trim());
  }

  function consoleKey(text) {
    const lines = fields(text, 'Coordinates');
    if (lines.length !== 1) return null;
    const match = lines[0].match(/^X:\s*([-+]?\d+)\s*,\s*Y:\s*([-+]?\d+)\s*,\s*Z:\s*([-+]?\d+)$/);
    return match ? coordinateKey(match.slice(1).join(',')) : null;
  }

  function hash(value) {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
    return (result >>> 0).toString(16).padStart(8, '0');
  }

  function propertyFields(text, items) {
    const result = new Map();
    for (const match of text.matchAll(/\{([^}]*)\}/g)) {
      const body = match[1], name = body.match(/name:\s*"([^"]+)"/);
      if (!name) continue;
      const magic = body.match(/(?:^|,)\s*magic:\s*(-?\d+)(?=\s*(?:,|$))/);
      result.set(items.normName(name[1]), {
        type: /(?:^|,)\s*type:\s*"[^"]*"/.test(body),
        magic: !!magic && Number.isSafeInteger(Number(magic[1]))
      });
    }
    return result;
  }

  function fingerprint(objects) {
    return JSON.stringify(objects.map(item => item ? [item.id, item.name, item.type, item.magic, item.x, item.y, item.geoKey, item.roomKey] : null));
  }

  function limit(value, fallback, min, max) {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
  }

  function playerPoint(dungeon, override) {
    const point = override === undefined ? dungeon.player ?? dungeon.start : override;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        !Number.isSafeInteger(Math.floor(point.x)) || !Number.isSafeInteger(Math.floor(point.y))) return null;
    return { x: point.x, y: point.y, tileX: Math.floor(point.x), tileY: Math.floor(point.y) };
  }

  function floorHeight(cell) {
    return cell.floorHeight == null ? 0 : Number.isFinite(cell.floorHeight) ? cell.floorHeight : null;
  }

  function passable(dungeon, cell) {
    if (!cell || !['floor', 'door'].includes(cell.tile) || cell.blocked || cell.obstacle || cell.blocking ||
        cell.collisionBlocking || cell.walkable === false || cell.feature || cell.interactable || floorHeight(cell) === null) return false;
    const tile = dungeon.tiles?.[cell.tile];
    if (tile?.collisionBlocking === true || tile?.spriteSpec?.collisionBlocking === true) return false;
    if (cell.tile === 'door' || cell.door) {
      const door = cell.door;
      if (!door || door.isOpen !== true || door.isLocked || door.locked || door.status === 'locked') return false;
    }
    return true;
  }

  function placementFloor(dungeon, cell) {
    return passable(dungeon, cell) && cell.tile === 'floor' && !cell.door && !cell.exit && !cell.complexExit;
  }

  function occupiedCells(objects) {
    const occupied = new Set();
    for (const item of objects) {
      if (item && Number.isFinite(item.x) && Number.isFinite(item.y)) occupied.add(`${Math.floor(item.x)},${Math.floor(item.y)}`);
    }
    return occupied;
  }

  function search(dungeon, player, occupied, policy) {
    const pool = [], queue = [], seen = new Set(), memo = new Map();
    let searched = 0, preferred = 0, fallback = 0;
    if (!player || !dungeon.cells) return { pool, searched };
    const read = (x, y) => {
      const key = `${x},${y}`;
      if (memo.has(key)) return memo.get(key);
      if (searched >= policy.maxSearchNodes) return null;
      searched++;
      const cell = dungeon.cells[key];
      memo.set(key, cell);
      return cell;
    };
    const first = read(player.tileX, player.tileY);
    if (!passable(dungeon, first)) return { pool, searched };
    queue.push({ x: player.tileX, y: player.tileY, cell: first });
    seen.add(`${player.tileX},${player.tileY}`);
    for (let head = 0; head < queue.length && preferred < POOL_LIMIT; head++) {
      const point = queue[head], key = `${point.x},${point.y}`;
      const d = Math.hypot(point.x + 0.5 - player.x, point.y + 0.5 - player.y);
      if (placementFloor(dungeon, point.cell) && !occupied.has(key) &&
          (point.x !== player.tileX || point.y !== player.tileY)) {
        const near = d <= policy.preferredRadius;
        if (near || fallback < POOL_LIMIT) {
          pool.push({ x: point.x, y: point.y, distance: d, preferred: near, floor: floorHeight(point.cell) });
          if (near) preferred++;
          else fallback++;
        }
      }
      for (const [dx, dy] of STEPS) {
        const x = point.x + dx, y = point.y + dy, nextKey = `${x},${y}`;
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || seen.has(nextKey) ||
            Math.hypot(x + 0.5 - player.x, y + 0.5 - player.y) > policy.fallbackRadius) continue;
        const cell = read(x, y);
        if (!passable(dungeon, cell) || Math.abs(floorHeight(cell) - floorHeight(point.cell)) > STEP_HEIGHT) continue;
        seen.add(nextKey);
        queue.push({ x, y, cell });
      }
    }
    pool.sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.distance - b.distance || a.y - b.y || a.x - b.x);
    return { pool: pool.slice(0, POOL_LIMIT), searched };
  }

  /** Only sceneObjects changes. options.player overrides the cached anchor; revision tracks collision changes. */
  function sync(dungeon, consoleText, options = {}) {
    const original = Array.isArray(dungeon?.sceneObjects) ? dungeon.sceneObjects : EMPTY;
    const report = (reason, more = {}) => ({ objects: original, changed: false, added: 0, removed: 0, updated: 0,
      pending: [], searched: 0, cacheHit: false, reason, ...more });
    if (!dungeon || typeof dungeon !== 'object') return report('missing-dungeon');
    const geoKey = dungeon.geoKey != null ? coordinateKey(dungeon.geoKey) :
      coordinateKey(dungeon.sceneSpec?.coords ?? dungeon.spec?.coords);
    const text = typeof consoleText === 'string' ? consoleText : '';
    const currentKey = consoleKey(text);
    if (!geoKey) return report('missing-dungeon-coordinates');
    if (!currentKey) return report('missing-console-coordinates', { geoKey });
    if (currentKey !== geoKey) return report('room-mismatch', { geoKey, consoleKey: currentKey });
    const lines = fields(text, 'Objects in Room');
    if (lines.length !== 1) return report(lines.length ? 'ambiguous-objects-line' : 'missing-objects-line', { geoKey });
    if (!lines[0]) return report('empty-objects-line', { geoKey });
    const props = fields(text, 'Objects in Room Properties');
    if (props.length > 1) return report('ambiguous-properties-line', { geoKey });
    const items = dependency || root?.SceneItems;
    if (typeof items?.parseRoomObjects !== 'function' || typeof items?.normName !== 'function') return report('missing-scene-items', { geoKey });

    options = options || {};
    const policy = {
      maxAdded: limit(options.maxAdded, 32, 0, 64),
      preferredRadius: limit(options.preferredRadius, 16, 1, 16),
      fallbackRadius: limit(options.fallbackRadius, 32, 1, 32),
      maxSearchNodes: limit(options.maxSearchNodes, 4096, 1, 4096)
    };
    policy.fallbackRadius = Math.max(policy.preferredRadius, policy.fallbackRadius);
    const signature = JSON.stringify([geoKey, lines[0], props[0] || '', policy]);
    const stateSignature = fingerprint(original), player = playerPoint(dungeon, options.player);
    const playerKey = player ? `${player.tileX},${player.tileY}` : null;
    const revision = options.revision ?? dungeon._geometryStamp ?? dungeon._meta?.geometryStamp ?? null;
    const previous = cache.get(dungeon);
    if (previous?.signature === signature && previous.items === items && previous.objects === original &&
        previous.stateSignature === stateSignature && previous.cells === dungeon.cells && previous.tiles === dungeon.tiles &&
        Object.is(previous.revision, revision) && (!previous.pending.length || previous.playerKey === playerKey)) {
      return report(previous.pending.length ? 'pending' : 'unchanged', {
        geoKey, cacheHit: true, pending: previous.pending.map(value => ({ ...value }))
      });
    }

    // Parse only exact room fields, never an inventory line or another room's embedded console text.
    const parsed = items.parseRoomObjects(`Objects in Room: ${lines[0]}\nObjects in Room Properties: ${props[0] || ''}`);
    if (!Array.isArray(parsed)) return report('missing-objects-line', { geoKey });
    const authoritative = propertyFields(props[0] || '', items), wanted = new Map();
    for (const item of parsed) {
      const name = items.normName(item.name);
      const declared = authoritative.get(name);
      if (name && !wanted.has(name)) wanted.set(name, {
        name: item.name, type: declared?.type && typeof item.type === 'string' ? item.type : '',
        magic: declared?.magic && Number.isSafeInteger(item.magic) ? item.magic : 0
      });
    }
    if (!wanted.size && !/^(none\.?|nothing)$/i.test(lines[0])) return report('invalid-objects-line', { geoKey });

    let removed = 0, updated = 0;
    const objects = [], present = new Set();
    for (const item of original) {
      const itemRoom = item?.geoKey ?? item?.roomKey;
      if (itemRoom != null && coordinateKey(itemRoom) !== geoKey) { objects.push(item); continue; }
      const name = items.normName(item?.name), current = wanted.get(name);
      if (!current) { removed++; continue; }
      present.add(name);
      const declared = authoritative.get(name), patch = {};
      if (declared?.type && item.type !== current.type) patch.type = current.type;
      if (declared?.magic && Number.isSafeInteger(current.magic) && item.magic !== current.magic) patch.magic = current.magic;
      if (Object.keys(patch).length) { objects.push({ ...item, ...patch }); updated++; }
      else objects.push(item);
    }
    const missing = Array.from(wanted, ([name, item]) => ({ name, item })).filter(value => !present.has(value.name));
    const occupied = occupiedCells(objects);
    const placement = missing.length && policy.maxAdded ? search(dungeon, player, occupied, policy) : { pool: [], searched: 0 };
    const available = placement.pool.slice();
    let added = 0;
    const pending = [];
    for (const { name, item } of missing) {
      if (added >= policy.maxAdded) { pending.push({ ...item, reason: 'addition-cap' }); continue; }
      // Recheck the cell before publishing coordinates; never keep a failed placement as a scene item.
      let point = null;
      while (available.length && !point) {
        const near = available.filter(value => value.preferred), pool = near.length ? near : available;
        const candidate = pool[parseInt(hash(`${geoKey}|${name}`), 16) % pool.length];
        available.splice(available.indexOf(candidate), 1);
        const key = `${candidate.x},${candidate.y}`, cell = dungeon.cells?.[key];
        if (!occupied.has(key) && placementFloor(dungeon, cell) && floorHeight(cell) === candidate.floor) point = candidate;
      }
      if (!point) { pending.push({ ...item, reason: 'no-reachable-floor' }); continue; }
      objects.push({ id: `scene-item-${hash(`${geoKey}\0${name}`)}-${hash(`${name}\0${geoKey}`)}`,
        name: item.name, type: item.type, magic: item.magic, x: point.x, y: point.y });
      occupied.add(`${point.x},${point.y}`);
      added++;
    }
    const changed = !!(added || removed || updated);
    if (changed) dungeon.sceneObjects = objects;
    const finalObjects = changed ? objects : original;
    cache.set(dungeon, { signature, items, objects: finalObjects, stateSignature: fingerprint(finalObjects),
      cells: dungeon.cells, tiles: dungeon.tiles, revision, playerKey, pending: pending.map(value => ({ ...value })) });
    return report(pending.length ? 'pending' : changed ? 'synced' : 'unchanged', {
      objects: finalObjects, changed, added, removed, updated, pending, searched: placement.searched, geoKey
    });
  }

  return { sync };
});
