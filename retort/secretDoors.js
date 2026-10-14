'use strict';
const { randomInt } = require('node:crypto');
const { random } = require('./dungeonGeneration');
const { makeNavigation, reachable } = require('./sceneArchitecture');
const Reach = require('./dungeonReach'), I = require('../assets/dungeonInhabitants');
const VERSION = 1, SEARCH_RADIUS = 2.5, SEARCH_DC = 5;
const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const tileKey = p => `${p.x},${p.y}`;
function install(dungeon) {
  if (dungeon.secretDoors || !dungeon.layout || !dungeon.start || !dungeon.cells) return dungeon.secretDoors;
  const rng = random(`${dungeon.generation?.seed || dungeon.geoKey || 'dungeon'}:secret-doors-v${VERSION}`);
  const target = 2 + Math.floor(rng() * 5), doors = [], { width, height } = dungeon.layout;
  const origin = { x: Math.floor(dungeon.start.x), y: Math.floor(dungeon.start.y) };
  let connected = reachable(makeNavigation(dungeon), origin);
  const occupied = new Set((dungeon.sceneObjects || []).map(o => `${Math.floor(o.x)},${Math.floor(o.y)}`));
  const protectedCell = (k, c) => !c || occupied.has(k) || c.feature || c.exit || c.complexExit || c.door || c.navigationReserved ||
    c.puzzleFixture || c.interactable || c.blocked || c.obstacle || c.trail || c.exteriorRole || c.vegetationRole || c.secretChamber;
  const walls = [], floors = [];
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const c = dungeon.cells[`${x},${y}`];
    if (c?.tile === 'wall' && !protectedCell(`${x},${y}`, c)) {
      for (const [dx, dy] of dirs) if (connected.seen[(y - dy) * width + x - dx]) walls.push({ x, y, dx, dy });
    } else if (c?.tile === 'floor' && connected.seen[y * width + x]) floors.push({ x, y });
  }
  for (let i = walls.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [walls[i], walls[j]] = [walls[j], walls[i]]; }
  // Prefer chambers carved out of existing wall mass; outdoors, use small sealed stone vaults.
  const sites = walls.slice(0, 1000);
  for (let i = 0; i < 500 && floors.length; i++) {
    const p = floors[Math.floor(rng() * floors.length)], [dx, dy] = dirs[Math.floor(rng() * 4)]; sites.push({ ...p, dx, dy, enclosure: true });
  }
  for (const site of sites) {
    if (doors.length >= target) break;
    const { x, y, dx, dy, enclosure } = site;
    const entry = { x: x - dx, y: y - dy }, e = dungeon.cells[tileKey(entry)];
    if (!e || !connected.seen[entry.y * width + entry.x] || !I.walkable(dungeon, entry.x, entry.y) ||
        Math.hypot(x - origin.x, y - origin.y) < 7 || doors.some(d => Math.hypot(x - d.x, y - d.y) < 9)) continue;
    const patch = {}, old = {}, floor = e.floorHeight || 0, ceil = Math.max(floor + 2.5, Math.min(floor + 4, e.ceilHeight || floor + 3));
    let valid = true;
    for (let depth = 0; depth <= 4; depth++) for (let side = -2; side <= 2; side++) {
      const px = x + dx * depth - dy * side, py = y + dy * depth + dx * side, k = `${px},${py}`, c = dungeon.cells[k];
      if (px < 1 || py < 1 || px >= width - 1 || py >= height - 1 || protectedCell(k, c) ||
          c.tile !== (enclosure ? 'floor' : 'wall') || enclosure && Math.abs((c.floorHeight || 0) - floor) > .1 ||
          px === origin.x && py === origin.y) { valid = false; continue; }
      const inside = depth > 0 && depth < 4 && Math.abs(side) < 2;
      old[k] = c;
      patch[k] = { tile: inside ? 'floor' : 'wall', floorHeight: floor, ceilHeight: ceil,
        secretChamber: `secret:${x},${y}`, ...(inside && e.roof ? { roof: { ...e.roof } } : {}) };
    }
    if (!valid) continue;
    Object.assign(dungeon.cells, patch);
    const after = reachable(makeNavigation(dungeon), origin);
    const blocksRoute = connected.seen.some((seen, i) => seen && !old[`${i % width},${Math.floor(i / width)}`] && !after.seen[i]);
    if (blocksRoute) { Object.assign(dungeon.cells, old); continue; }
    const key = `${x},${y}`, id = `secret:${key}`;
    patch[key].secretDoorId = id;
    doors.push({ id, key, x, y, entry, chamber: Object.keys(patch).filter(k => patch[k].tile === 'floor'), discovered: false, open: false });
    connected = after;
  }
  dungeon.tiles ||= {};
  dungeon.tiles.custom_secret_wall = { spriteSpec: { voxelShape: 'secret_wall', material: 'stone', gridWidth: 1, heightRatio: 1,
    palette: { primary: dungeon.sceneSpec?.palette?.wall || '#80705b', secondary: '#645545', highlight: '#aa9679', shadow: '#41372e' } } };
  dungeon.secretDoors = { version: VERSION, target, revision: 0, doors, receipts: [] };
  return dungeon.secretDoors;
}
function nearby(dungeon, point, radius = SEARCH_RADIUS) {
  if (!point || !I.walkable(dungeon, Math.floor(point.x), Math.floor(point.y))) return [];
  const floor = dungeon.cells[`${Math.floor(point.x)},${Math.floor(point.y)}`]?.floorHeight || 0;
  return (dungeon.secretDoors?.doors || []).filter(d => !d.open &&
    Math.hypot(point.x - d.x - .5, point.y - d.y - .5) <= radius &&
    Math.abs((dungeon.cells[d.key]?.floorHeight || 0) - floor) <= 1.5 &&
    Reach.lineClear(dungeon, point, { x: d.entry.x + .5, y: d.entry.y + .5 }));
}
function act(state, input, { natural = () => randomInt(1, 21) } = {}) {
  try {
    const coords = state.getLastCoords(), geoKey = `${coords.x},${coords.y},${coords.z}`;
    if (input.runId !== state.getDungeonRunId() || input.geoKey !== geoKey || state.getGamePaused?.()) throw Error('That passage action is unavailable in this room.');
    if (!['search', 'open'].includes(input.kind) || !/^[\w:-]{8,100}$/.test(input.nonce || '')) throw Error('Choose a valid passage action.');
    const dungeon = state.getRoomDungeon(coords); if (!dungeon) throw Error('The room is not ready.');
    const secrets = dungeon.secretDoors; if (!secrets) throw Error('This level has no secret passages.');
    const request = JSON.stringify([input.kind, input.key || null]);
    const prior = secrets.receipts.find(r => r.nonce === input.nonce);
    if (prior) { if (prior.request !== request) throw Error('That search transaction was already used.'); return { ...prior.result, duplicate: true }; }
    const roster = JSON.parse(state.getCombatCharactersString() || '[]');
    const pc = I.parseSheets(state.getUpdatedGameConsole(), 'PC')[0];
    if (!pc || !I.canAct(pc)) throw Error('The player must be conscious to search or open a passage.');
    const point = Reach.position(roster.find(a => a.type === 'pc' && a.name === pc.name), geoKey);
    const nearbyDoors = nearby(dungeon, point, input.kind === 'open' ? 1.6 : SEARCH_RADIUS);
    const cells = {}, found = [], rolls = [];
    if (input.kind === 'search') {
      for (const d of nearbyDoors.filter(d => !d.discovered)) {
        const roll = natural(); if (!Number.isInteger(roll) || roll < 1 || roll > 20) throw Error('Invalid search roll.');
        rolls.push({ natural: roll, difficulty: SEARCH_DC, success: roll >= SEARCH_DC });
        if (roll >= SEARCH_DC) { d.discovered = true; found.push(d.key); }
      }
    } else {
      const candidates = nearbyDoors.filter(d => !input.key || input.key === d.key).filter(d =>
        Math.abs(Math.floor(point.x) - d.x) + Math.abs(Math.floor(point.y) - d.y) === 1);
      if (candidates.length !== 1) throw Error(candidates.length ? 'Face one secret panel and try again.' : 'Stand directly beside the secret panel first.');
      const d = candidates[0]; d.discovered = true; d.open = true; found.push(d.key);
      cells[d.key] = { ...dungeon.cells[d.key], tile: 'door', door: { isDoor: true, isOpen: true, secret: true } };
      dungeon.cells[d.key] = cells[d.key];
    }
    secrets.revision++;
    const content = input.kind === 'open' ? 'The concealed stone panel slides upward, revealing a hidden chamber.' : found.length ?
      `You discover ${found.length === 1 ? 'a secret panel' : found.length + ' secret panels'} nearby (${found.join('; ')}). Stand beside it and press Space to open it.` :
      nearbyDoors.some(d => d.discovered) ? 'The secret panel you found is still here. Stand beside it and press Space.' : 'Your search reveals no new passage nearby.';
    const result = { content, found, rolls, kind: input.kind };
    secrets.receipts.push({ nonce: input.nonce, request, result }); if (secrets.receipts.length > 256) secrets.receipts.shift();
    return { ...result, dungeon, cells, previousStamp: dungeon._geometryStamp };
  } catch (error) { return { error: error.message }; }
}
function persist(state, dungeon) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}');
  if (db[dungeon.geoKey]) { db[dungeon.geoKey].secretDoors = dungeon.secretDoors; state.setRoomNameDatabase(JSON.stringify(db)); }
}
function preserve(current, incoming) {
  const saved = JSON.parse(current), next = JSON.parse(incoming);
  for (const [key, room] of Object.entries(saved)) if (room?.secretDoors && next[key]) next[key].secretDoors = room.secretDoors;
  return JSON.stringify(next);
}
module.exports = { VERSION, SEARCH_RADIUS, SEARCH_DC, install, nearby, act, persist, preserve };
