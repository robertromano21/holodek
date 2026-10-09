'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const OFFSETS = { north: [0, 1, 0], northeast: [1, 1, 0], east: [1, 0, 0], southeast: [1, -1, 0],
  south: [0, -1, 0], southwest: [-1, -1, 0], west: [-1, 0, 0], northwest: [-1, 1, 0],
  up: [0, 0, 1], down: [0, 0, -1] };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => record(value) && Object.hasOwn(value, key) ? value[key] : undefined;
const hash = value => createHash('sha256').update(value).digest('hex');
const BOSS_KEY_NAME = /^[a-z0-9 ]+ seal key [a-f0-9]{12}$/;

function coordinates(value) {
  let parts;
  if (record(value)) parts = [value.x, value.y, value.z];
  else if (typeof value === 'string' && !/[\r\n]/.test(value)) {
    const match = value.trim().match(/^(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)$/) ||
      value.trim().match(/^X:\s*(-?\d+)\s*,\s*Y:\s*(-?\d+)\s*,\s*Z:\s*(-?\d+)$/);
    if (match) parts = match.slice(1).map(Number);
  }
  return parts?.every(Number.isSafeInteger) ? parts.join(',') : null;
}

function consoleLine(text, label) {
  const matches = [...text.matchAll(new RegExp(`^[ \\t]*${label}:[ \\t]*([^\\r\\n]*)`, 'gm'))];
  return matches.length === 1 ? matches[0][1].trim() : '';
}

/** Read-only binding lookup for a caller that is already creating an ordinary exit target. */
function bossRoomNameForTarget(consoleText, targetKey) {
  if (typeof consoleText !== 'string') return null;
  const target = coordinates(targetKey), bound = coordinates(consoleLine(consoleText, 'Boss Room Coordinates'));
  const boss = consoleLine(consoleText, 'Next Boss'), room = consoleLine(consoleText, 'Next Boss Room');
  if (!target || target !== bound || !boss || !room || /^none$/i.test(boss) || /^none$/i.test(room)) return null;
  return room;
}

function roomIndex(database) {
  const rooms = new Map();
  for (const [key, room] of Object.entries(database)) {
    const normalized = coordinates(key);
    if (normalized && record(room)) {
      // Ambiguous aliases are not permission to pick or create a different room.
      rooms.set(normalized, rooms.has(normalized) ? null : { key, room });
    }
  }
  return rooms;
}

function exitTarget(sourceKey, direction, exit) {
  if (!record(exit)) return null;
  if (Object.hasOwn(exit, 'targetCoordinates')) return coordinates(exit.targetCoordinates);
  const source = coordinates(sourceKey), offset = own(OFFSETS, direction);
  return source && offset ? coordinates(source.split(',').map(Number).map((n, i) => n + offset[i]).join(',')) : null;
}

function inboundExits(database, targetKey) {
  const entries = [];
  for (const sourceKey of Object.keys(database).sort()) {
    const room = database[sourceKey];
    if (!record(own(room, 'exits'))) continue;
    for (const direction of Object.keys(room.exits).sort()) {
      const exit = room.exits[direction];
      if (exitTarget(sourceKey, direction, exit) === targetKey) entries.push({ sourceKey, direction, exit });
    }
  }
  return entries;
}

function primaryEntry(entries, rooms, targetKey) {
  return entries.find(entry => {
    const key = coordinates(entry.sourceKey);
    return key && key !== targetKey && rooms.get(key)?.key === entry.sourceKey;
  }) || null;
}

function nameInUse(database, name) {
  const matches = value => typeof value === 'string' && value.trim().toLowerCase() === name;
  return Object.values(database).some(room => record(room) && (
    matches(own(own(room, 'bossGate'), 'keyName')) ||
    Array.isArray(room.objects) && room.objects.some(item => matches(typeof item === 'string' ? item : item?.name)) ||
    record(room.exits) && Object.values(room.exits).some(exit => matches(own(exit, 'key')))
  ));
}

function keyNameFor(database, roomName, identity) {
  const readable = roomName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim() || 'boss room';
  for (let attempt = 0; ; attempt++) {
    const suffix = ` seal key ${hash(attempt ? `${identity}:${attempt}` : identity).slice(0, 12)}`;
    const name = `${readable.slice(0, 96 - suffix.length).trimEnd()}${suffix}`;
    if (!nameInUse(database, name)) return name;
  }
}

function validGate(gate) {
  return record(gate) && gate.version === 1 && typeof gate.id === 'string' && gate.id.startsWith('boss-gate:') &&
    typeof gate.keyName === 'string' && gate.keyName.length <= 96 && BOSS_KEY_NAME.test(gate.keyName) &&
    typeof gate.bossName === 'string' && !!gate.bossName.trim() &&
    typeof gate.bossRoomName === 'string' && !!gate.bossRoomName.trim() &&
    typeof gate.targetKey === 'string' && coordinates(gate.targetKey) === gate.targetKey && typeof gate.keySeeded === 'boolean' &&
    (gate.keyPlacement === null || coordinates(gate.keyPlacement) === gate.keyPlacement && gate.keyPlacement !== gate.targetKey);
}

/** Reserved at every stage: only seedBossKey may create these items, never model discoveries. */
function isReservedBossKeyName(database, name) {
  if (typeof name !== 'string' || !name.trim()) return false;
  const normalized = name.trim().toLowerCase();
  // Reserve the generated namespace even before the boss initializer creates its record.
  if (normalized.length <= 96 && BOSS_KEY_NAME.test(normalized)) return true;
  if (!record(database)) return false;
  const matches = value => typeof value === 'string' && value.trim().toLowerCase() === normalized;
  const gateId = value => typeof value === 'string' && value.startsWith('boss-gate:');
  return Object.values(database).some(room => record(room) && (
    matches(own(own(room, 'bossGate'), 'keyName')) ||
    record(room.exits) && Object.values(room.exits).some(exit => gateId(own(exit, 'bossGateId')) && matches(own(exit, 'key'))) ||
    Array.isArray(room.objects) && room.objects.some(item => gateId(item?.questGateId) && matches(item?.name))
  ));
}

/**
 * Deterministic, in-memory supplement: mutates only bossGate and inbound exit
 * status/key/bossGateId on the supplied database. No I/O, console edits or seeding.
 */
function ensureBossGate(database, consoleText, options = {}) {
  const result = { gate: null, status: 'skipped', reason: null, created: false, changed: false,
    lockedExits: [], preservedOpenExits: [] };
  if (!record(database) || typeof consoleText !== 'string') return { ...result, reason: 'invalid-input' };
  const bossName = consoleLine(consoleText, 'Next Boss'), bossRoomName = consoleLine(consoleText, 'Next Boss Room');
  if (!bossName || !bossRoomName || /^none$/i.test(bossName) || /^none$/i.test(bossRoomName)) {
    return { ...result, reason: 'missing-boss-binding' };
  }
  const targetKey = coordinates(consoleLine(consoleText, 'Boss Room Coordinates'));
  if (!targetKey) return { ...result, reason: 'invalid-boss-coordinates' };
  const rooms = roomIndex(database), bossRoom = rooms.get(targetKey)?.room;
  if (!bossRoom) return { ...result, status: 'pending', reason: 'missing-boss-record' };
  const questId = own(options, 'questId');
  if (questId !== undefined && (typeof questId !== 'string' || !questId.trim())) {
    return { ...result, reason: 'invalid-quest-id' };
  }
  const identity = JSON.stringify([targetKey, bossName, consoleLine(consoleText, 'Next Artifact'), questId ?? null]);
  const id = `boss-gate:${hash(identity)}`;
  let gate = own(bossRoom, 'bossGate');
  // Reuse the persisted seeded flag even when the key has left the room database.
  if (!(validGate(gate) && gate.id === id && gate.bossName === bossName &&
      gate.bossRoomName === bossRoomName && gate.targetKey === targetKey)) {
    gate = { version: 1, id, keyName: keyNameFor(database, bossRoomName, identity), bossName, bossRoomName,
      targetKey, keyPlacement: null, keySeeded: false };
    bossRoom.bossGate = gate;
    result.created = result.changed = true;
  }
  result.gate = gate;
  const entries = inboundExits(database, targetKey);
  for (const { sourceKey, direction, exit } of entries) {
    // Legacy unlocking clears exit.key. The gate ID, not the retained key, proves identity.
    if (exit.bossGateId === gate.id && exit.status === 'open') {
      result.preservedOpenExits.push({ coordinates: sourceKey, direction });
      continue;
    }
    if (exit.status === 'locked' && exit.key === gate.keyName && exit.bossGateId === gate.id) continue;
    exit.status = 'locked';
    exit.key = gate.keyName;
    exit.bossGateId = gate.id;
    result.changed = true;
    result.lockedExits.push({ coordinates: sourceKey, direction });
  }
  result.status = primaryEntry(entries, rooms, targetKey) ? 'ready' : 'pending';
  if (result.status === 'pending') result.reason = 'missing-boss-entry';
  return result;
}

// Directed, open, existing links only. Neither adjacency nor the boss room is a shortcut.
function reachable(rooms, sourceKey, placementKey, bossKey) {
  const start = coordinates(sourceKey), seen = new Set([start]), queue = [start];
  for (let index = 0; index < queue.length; index++) {
    const key = queue[index];
    if (key === placementKey) return true;
    const exits = rooms.get(key)?.room.exits;
    if (!record(exits)) continue;
    for (const [direction, exit] of Object.entries(exits)) {
      if (!record(exit) || exit.status !== undefined && exit.status !== 'open') continue;
      const target = exitTarget(key, direction, exit);
      if (!target || target === bossKey || seen.has(target) || !rooms.get(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return false;
}

/**
 * Caller invokes ONLY when choosing stage 1 after stage 0 completes. Placement is
 * caller-selected, never auto-chosen. Reachability is from the primary existing
 * boss approach and, when supplied, playerRoomKey. No inventory or quest-index dependency.
 */
function seedBossKey(database, gate, placementKey, options = {}) {
  const result = { gate: null, status: 'skipped', reason: null, seeded: false, changed: false };
  if (!record(database) || !validGate(gate)) return { ...result, reason: 'invalid-gate' };
  const rooms = roomIndex(database), persisted = own(rooms.get(gate.targetKey)?.room, 'bossGate');
  if (!validGate(persisted) || ['id', 'keyName', 'bossName', 'bossRoomName', 'targetKey'].some(key => persisted[key] !== gate[key])) {
    return { ...result, reason: 'missing-bound-gate' };
  }
  result.gate = persisted;
  if (persisted.keySeeded) return { ...result, status: 'already-seeded' };
  const placement = coordinates(placementKey), room = rooms.get(placement)?.room;
  if (!placement || !room) return { ...result, reason: 'unknown-placement' };
  if (placement === persisted.targetKey) return { ...result, reason: 'boss-room-placement' };
  const entry = primaryEntry(inboundExits(database, persisted.targetKey), rooms, persisted.targetKey);
  if (!entry) return { ...result, status: 'pending', reason: 'missing-boss-entry' };
  if (!reachable(rooms, entry.sourceKey, placement, persisted.targetKey)) {
    return { ...result, reason: 'unreachable-placement' };
  }
  const playerRoomKey = own(options, 'playerRoomKey');
  if (playerRoomKey !== undefined) {
    const player = coordinates(playerRoomKey);
    if (!player || !rooms.get(player)) return { ...result, reason: 'unknown-player-room' };
    if (player === persisted.targetKey || !reachable(rooms, player, placement, persisted.targetKey)) {
      return { ...result, reason: 'unreachable-from-player' };
    }
  }
  if (room.objects != null && !Array.isArray(room.objects)) return { ...result, reason: 'invalid-room-objects' };
  const item = { name: persisted.keyName, type: 'key', properties: { attack: 0, damage: 0, ac: 0, magic: 0 },
    unlocks: { coordinates: entry.sourceKey, direction: entry.direction }, questGateId: persisted.id };
  const existing = [];
  for (const [key, candidate] of Object.entries(database)) {
    if (!Array.isArray(candidate?.objects)) continue;
    for (const object of candidate.objects) {
      const name = typeof object === 'string' ? object : object?.name;
      if (object?.questGateId === persisted.id || typeof name === 'string' && name.trim().toLowerCase() === persisted.keyName) {
        existing.push({ key, object });
      }
    }
  }
  if (existing.length && (existing.length !== 1 || coordinates(existing[0].key) !== placement ||
      !isDeepStrictEqual(existing[0].object, item))) return { ...result, reason: 'key-conflict' };
  if (!existing.length) {
    room.objects ??= [];
    room.objects.push(item);
    result.seeded = true;
  }
  persisted.keyPlacement = placement;
  persisted.keySeeded = true;
  return { ...result, status: 'seeded', changed: true };
}

/** Stage-1 Fetch data only; unique seal ownership is independent of the pickup location. */
function makeBossKeyTask(gate, placementKey) {
  const placement = coordinates(placementKey);
  if (!validGate(gate) || !placement || placement === gate.targetKey ||
      gate.keyPlacement !== null && gate.keyPlacement !== placement) return null;
  return {
    type: 'Fetch',
    desc: `Retrieve ${gate.keyName} at ${placement} to unlock ${gate.bossRoomName} for the confrontation with ${gate.bossName}.`,
    metrics: `${gate.keyName} in Inventory regardless of current room`,
    requiredElements: [{ type: 'key', name: gate.keyName, placement }],
    actionKind: 'take_item',
    hardRequirements: [{ check: 'inventory_contains', value: gate.keyName }],
    actionRequirements: [],
    status: 'Pending',
    bossGateId: gate.id
  };
}

module.exports = { ensureBossGate, seedBossKey, makeBossKeyTask, isReservedBossKeyName, bossRoomNameForTarget };
