'use strict';

const { chooseArchitecture, makeNavigation, reachable } = require('./sceneArchitecture');
const Voxels = require('../assets/scenePropVoxels');
const Materials = require('../assets/voxelMaterials');
const Exits = require('../assets/dungeonExits');
const Details = require('../assets/sceneExteriorDetails');

const EXTERIOR_VERSION = 1;
const MAX_HEIGHT = 18;
const MAX_BUILDINGS = 4;
const MAX_CANDIDATES = 30;
const RING_WIDTH = 2;
const COMPASS = { north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1],
  south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1] };
// Campaign coordinates are north-positive; rendered cell rows are north-negative.
const GEO_OFFSETS = { north: [0, 1], northeast: [1, 1], east: [1, 0], southeast: [1, -1],
  south: [0, -1], southwest: [-1, -1], west: [-1, 0], northwest: [-1, 1] };
const ALIASES = { n: 'north', ne: 'northeast', e: 'east', se: 'southeast', s: 'south',
  sw: 'southwest', w: 'west', nw: 'northwest', u: 'up', d: 'down' };
const BUILDINGS = new Set(['temple', 'castle', 'rotunda', 'basilica', 'bathhouse', 'domus',
  'villa', 'insula', 'warehouse', 'ruins']);
const ROOF_SHAPES = { pitched: 'pitched_roof_shell', barrel: 'barrel_vault_shell',
  flat: 'coffered_slab', domed: 'dome_shell' };

function direction(value) {
  const key = String(value || '').toLowerCase().replace(/[\s_-]/g, '');
  return ALIASES[key] || key;
}

function coordinates(value) {
  let values;
  if (typeof value === 'string') {
    const match = value.trim().match(/^(?:X:\s*)?(-?\d+)\s*,\s*(?:Y:\s*)?(-?\d+)\s*,\s*(?:Z:\s*)?(-?\d+)$/i);
    if (!match) return null;
    values = match.slice(1).map(Number);
  } else if (Array.isArray(value)) values = value;
  else if (value && typeof value === 'object') values = [value.x, value.y, value.z];
  if (!values || values.length !== 3 || !values.every(Number.isSafeInteger)) return null;
  return { x: values[0], y: values[1], z: values[2] };
}

const coordinateKey = c => c ? `${c.x},${c.y},${c.z}` : null;

function database(raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  const result = new Map();
  const entries = raw instanceof Map ? raw.entries() : raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.entries(raw) : [];
  for (const [key, room] of entries) {
    const normalized = coordinateKey(coordinates(key));
    if (normalized && room && typeof room === 'object' && !Array.isArray(room)) result.set(normalized, room);
  }
  return result;
}

function exits(raw) {
  const result = new Map();
  if (typeof raw === 'string') raw = raw.split(/[,;]+/);
  const entries = Array.isArray(raw) ? raw.map(exit => [exit?.direction || exit, exit]) :
    raw && typeof raw === 'object' ? Object.entries(raw) : [];
  for (const [name, exit] of entries) {
    const normalized = direction(name);
    if (Object.hasOwn(COMPASS, normalized) || normalized === 'up' || normalized === 'down') result.set(normalized, exit);
  }
  return result;
}

function explicitTarget(exit) {
  if (exit && typeof exit === 'object') {
    for (const key of ['targetCoordinates', 'targetCoords', 'target']) {
      if (Object.hasOwn(exit, key)) return { declared: true, coords: coordinates(exit[key]) };
    }
  }
  const coords = coordinates(exit);
  return { declared: !!coords, coords };
}

function indoorMetadata(room) {
  for (const [source, value] of [['indoor', room.indoor], ['classification.indoor', room.classification?.indoor],
    ['sceneSpec.indoor', room.sceneSpec?.indoor], ['isIndoor', room.isIndoor]]) {
    if (typeof value === 'boolean') return { value, source };
  }
  if (typeof room.isOutdoor === 'boolean') return { value: !room.isOutdoor, source: 'isOutdoor' };
  return { value: null, source: null };
}

// Preparation only annotates the new spec. It never annotates destination records or their cached scenes.
function prepareSceneExteriors(spec = {}, roomDatabase = {}, options = {}) {
  const db = database(roomDatabase);
  const coords = coordinates(spec.coords) || coordinates(spec.source?.coords);
  const sourceKey = coordinateKey(coords);
  const current = db.get(sourceKey) || {};
  const rawExits = exits(spec.exits ?? spec.source?.exits ?? current.exits);
  const storedExits = exits(current.exits);
  const village = current.villagePlan || spec.worldContext?.village;
  const cavernVillage = village?.container === 'vast-cavern';
  const cap = village ? 4 : 2;
  const maxBuildings = Number.isInteger(options.maxBuildings) ? Math.max(0, Math.min(cap, options.maxBuildings)) : cap;
  const plan = { version: EXTERIOR_VERSION, enabled: options.enabled !== false && (spec.indoor === false || cavernVillage), cavernVillage,
    seed: String(options.seed ?? options.campaignSeed ?? spec.campaignSeed ?? spec.seed ?? '0'),
    sourceKey, maxBuildings, maxHeight: MAX_HEIGHT, maxFootprint: 21, buildings: [], rejected: [], requiredShapes: [] };
  if (!plan.enabled) { plan.reason = options.enabled === false ? 'disabled' : 'not-outdoor'; return (spec.exteriorPlan = plan); }
  for (const [name, exit] of [...rawExits].sort(([a], [b]) => a.localeCompare(b))) {
    if (!Object.hasOwn(COMPASS, name)) { plan.rejected.push({ direction: name, reason: 'vertical-exit' }); continue; }
    const local = explicitTarget(exit), stored = explicitTarget(storedExits.get(name));
    const target = local.declared ? local : stored;
    const offset = GEO_OFFSETS[name];
    const targetKey = coordinateKey(target.declared ? target.coords : coords ?
      { x: coords.x + offset[0], y: coords.y + offset[1], z: coords.z } : null);
    const room = db.get(targetKey);
    const reject = reason => plan.rejected.push({ direction: name, targetKey, reason });
    if (!room) { reject(target.declared && !target.coords ? 'invalid-target-coordinates' : 'unknown-destination'); continue; }
    if (cavernVillage && room.villageBuilding?.hubKey !== sourceKey) { reject('cavern-passage-not-building'); continue; }
    const scene = room.sceneSpec || {};
    const roomName = String(room.name || room.roomName || scene.source?.roomName || '');
    const description = String(room.description || scene.source?.description || '');
    const indoor = indoorMetadata(room);
    const rootTemple = targetKey === '0,0,0' && roomName === 'Ruined Temple Entrance';
    if (!rootTemple && indoor.value !== true) { reject(indoor.value === false ? 'outdoor-destination' : 'unknown-indoor-metadata'); continue; }
    const selection = rootTemple ? { family: 'temple', evidence: 'known-root-temple-name', ruined: true } :
      chooseArchitecture({ ...scene, indoor: true, source: { roomName, description },
        worldContext: { ...scene.worldContext, fortifiedFloor: room.fortifiedFloor },
        architecture: scene.architecture || room.architecture || room.classification?.architecture || room.environmentIntent?.architecture });
    if (!selection || !BUILDINGS.has(selection.family)) { reject('no-building-evidence'); continue; }
    const complexIdentity = String(room.complexId || room.siteId || (rootTemple ? 'ruined-temple' : targetKey));
    const random = Voxels.random(`${EXTERIOR_VERSION}:${plan.seed}:${complexIdentity}`);
    const roofless = /\b(roofless|unroofed|without (?:a )?roof|no roof|collapsed roof|open[- ]sky)\b/i.test(description);
    const roofs = selection.family === 'rotunda' ? ['domed', 'domed', 'flat'] :
      selection.family === 'castle' ? ['pitched', 'flat', 'open'] : ['pitched', 'barrel', 'flat', 'open'];
    const site = room.fortifiedSite;
    const roofFamily = cavernVillage ? 'flat' : site ? site.patron ? 'domed' : 'pitched' : roofless ? 'open' : roofs[Math.floor(random() * roofs.length)];
    const transverse = 13 + 2 * Math.floor(random() * 4), depth = 11 + 2 * Math.floor(random() * 3);
    const forecourtDepth = 2 + Math.floor(random() * 3), wallHeight = 5 + Math.floor(random() * 3);
    const sacred = site?.patron && require('../assets/shrineIconography').pantheon[site.patron];
    const palette = Materials.tintPalette({ primary: room.classification?.wallColor || '#81988c',
      secondary: room.classification?.floorColor || '#496656', highlight: '#eadfc6', shadow: '#30352f' }, scene.palette || {}, 'marble');
    if (sacred) Object.assign(palette, { secondary: sacred.color, highlight: sacred.glow || sacred.color });
    plan.buildings.push({ direction: name, targetKey, targetName: roomName, targetIndoor: indoor.value, complexIdentity,
      family: selection.family, ruined: !!selection.ruined, roofFamily, transverse, depth, forecourtDepth,
      wallHeight: cavernVillage ? 4 : wallHeight, towerHeight: cavernVillage ? 5 : wallHeight + 2 + Math.floor(random() * 3), cavernVillage,
      entrance: 'closed-gate', palette,
      ...(site ? { fortifiedSite: { id: site.id, template: site.template, levels: site.levels, patron: site.patron },
        monumental: { transverse: site.template === 'wizard_tower' ? 19 : 29, depth: 23,
          wallHeight: 10, towerHeight: Math.min(35, 10 + site.levels * 4) } } : {}),
      ...(rootTemple ? { monumental: { transverse: 29 + 2 * Math.floor(random() * 4), depth: 19 + 2 * Math.floor(random() * 3),
        wallHeight: 12 + Math.floor(random() * 4), towerHeight: 20 + Math.floor(random() * 5) } } : {}),
      evidence: { databaseKey: targetKey, roomName, description, indoorSource: indoor.source,
        architectureSource: selection.evidence, targetSource: target.declared ? 'exit-target-coordinates' : 'direction-offset',
        identitySource: room.complexId ? 'complexId' : room.siteId ? 'siteId' : rootTemple ? 'known-root-temple-name' : 'destination-coordinates' } });
  }
  // Prefer the campaign entrance if more than two known buildings share the outdoor room.
  plan.buildings.sort((a, b) => Number(b.targetKey === '0,0,0') - Number(a.targetKey === '0,0,0') || a.direction.localeCompare(b.direction));
  for (const building of plan.buildings.slice(maxBuildings)) plan.rejected.push({ direction: building.direction,
    targetKey: building.targetKey, reason: 'building-limit' });
  plan.knownDestinations = plan.buildings.length;
  plan.buildings = plan.buildings.slice(0, maxBuildings);
  if (plan.buildings.length) plan.requiredShapes = [...new Set(['entablature', 'pediment', 'pediment_side', 'battlement', 'grand_gate', 'grand_gate_side',
    ...plan.buildings.map(b => ROOF_SHAPES[b.roofFamily]).filter(Boolean)])];
  plan.reason = plan.buildings.length ? 'known-adjacent-buildings' : 'no-known-adjacent-building';
  return (spec.exteriorPlan = plan);
}

function validPoint(p, width, height) {
  return Number.isInteger(p?.x) && Number.isInteger(p?.y) && p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
}

function navigation(dungeon) {
  const nav = makeNavigation(dungeon);
  for (let y = 0; y < nav.height; y++) for (let x = 0; x < nav.width; x++) {
    const c = dungeon.cells[`${x},${y}`];
    if (c?.blocked || c?.obstacle || c?.door?.isLocked || c?.door?.locked ||
      c?.floorHeight != null && !Number.isFinite(c.floorHeight)) nav.passable[y * nav.width + x] = 0;
  }
  return nav;
}

function occupiedSites(dungeon) {
  const boxes = [];
  for (const name of ['sceneObjects', 'objects', 'sceneProps', 'props', 'sceneLandmarks', 'entities']) {
    const raw = dungeon[name];
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
    for (const object of list) {
      const p = object?.position || object;
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) boxes.push({ x: Math.floor(p.x), y: Math.floor(p.y), width: 1, height: 1 });
    }
  }
  for (const part of dungeon.sceneStructures || []) {
    const p = part?.position, s = part?.size;
    if (p && s && [p.x, p.y, s.x, s.y].every(Number.isFinite)) boxes.push({ x: p.x, y: p.y, width: s.x, height: s.y,
      ...(part.role === 'journey-exit-marker' ? { markerDirection: direction(part.direction) } : {}) });
  }
  for (const marker of dungeon.roomExits?.markers || []) boxes.push({ x: marker.x, y: marker.y, width: 1, height: 1,
    markerDirection: direction(marker.direction) });
  return boxes;
}

const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const fixedContent = c => !c || c.tile !== 'floor' || c.feature || c.door || c.exit || c.interactable ||
  c.blocked || c.obstacle || c.roof || c.architectureRole || c.exteriorRole || c.structureHeight || c.object || c.prop;

function orientation(name) {
  const [dx, dy] = COMPASS[name];
  // Diagonal exits use a cardinal throat; their existing orthogonal approach is retained.
  const forward = dy ? { x: 0, y: dy } : { x: dx, y: 0 };
  return { forward, cross: { x: -forward.y, y: forward.x } };
}

function siteGeometry(building, door) {
  const { forward: f, cross: c } = orientation(building.direction);
  const point = (u, v) => ({ x: door.x + c.x * u + f.x * v, y: door.y + c.y * u + f.y * v });
  const half = Math.floor(building.transverse / 2);
  const corners = [point(-half, -building.forecourtDepth), point(half, building.depth - 1)];
  const footprint = { x: Math.min(...corners.map(p => p.x)), y: Math.min(...corners.map(p => p.y)),
    width: f.x ? building.depth + building.forecourtDepth : building.transverse,
    height: f.y ? building.depth + building.forecourtDepth : building.transverse };
  return { point, half, forward: f, footprint };
}

function candidateSites(building, marker) {
  const { forward: f, cross: c } = orientation(building.direction);
  const result = [];
  const half = Math.floor(building.transverse / 2);
  // The last band allows an edge/corner marker to remain outside the new shell.
  for (const distance of [...new Set([2, 6, building.depth - 1, building.depth + RING_WIDTH + 1])]) {
    for (const lateral of [0, -1, 1, -half - 3, half + 3, -half - 5, half + 5]) {
      result.push({ x: marker.x - f.x * distance + c.x * lateral, y: marker.y - f.y * distance + c.y * lateral });
    }
  }
  return result.slice(0, MAX_CANDIDATES);
}

function stageFoundation(dungeon, building, door, nav, options) {
  const { footprint } = siteGeometry(building, door), apron = building.large ? 14 : 7, patch = new Map();
  const floors = nav.floors.slice(), passable = nav.passable.slice();
  const base = nav.floors[door.y * nav.width + door.x];
  if (!Number.isFinite(base)) return { reason: 'foundation-invalid-floor' };
  for (let y = footprint.y - apron; y < footprint.y + footprint.height + apron; y++) {
    for (let x = footprint.x - apron; x < footprint.x + footprint.width + apron; x++) {
      if (x < 1 || y < 1 || x >= nav.width - 1 || y >= nav.height - 1) continue;
      const key = `${x},${y}`, c = dungeon.cells[key], index = y * nav.width + x;
      const distance = Math.max(footprint.x - x, x - (footprint.x + footprint.width - 1),
        footprint.y - y, y - (footprint.y + footprint.height - 1), 0);
      const core = distance <= RING_WIDTH;
      const bareWall = c?.tile === 'wall' && !c.feature && !c.structureHeight && (c.ceilHeight - c.floorHeight) <= 3;
      const protectedCell = !c || c.tile !== 'floor' && !bareWall || c.feature || c.roof || c.door || c.exit || c.interactable ||
        c.blocked || c.obstacle || c.architectureRole || c.exteriorRole || c.geographyRole || c.routeReserved || c.outdoorFoundation || c.object || c.prop ||
        options.reservedRoutes?.has(key) || c.complexExit && c.complexExit !== building.direction ||
        Math.hypot(x - dungeon.start.x, y - dungeon.start.y) < 4;
      if (protectedCell) { if (core) return { reason: 'foundation-protected-cell', key }; continue; }
      const oldFloor = nav.floors[index], delta = base - oldFloor;
      if (Math.abs(delta) > (building.large ? 12 : 6)) { if (core) return { reason: 'foundation-excessive-grade', key }; continue; }
      const blend = core ? 1 : Math.max(0, 1 - (distance - RING_WIDTH) / (apron - RING_WIDTH));
      const floor = core ? base : oldFloor + delta * blend;
      if (!core && (!blend || bareWall)) continue;
      const clearance = bareWall ? 2.5 : Math.max(1, c.ceilHeight - oldFloor);
      patch.set(key, { ...c, tile: 'floor', floorHeight: floor, ceilHeight: floor + clearance,
        navigationReserved: true, exteriorFoundation: building.targetKey });
      floors[index] = floor; passable[index] = 1;
    }
  }
  return { patch, nav: { ...nav, floors, passable } };
}

function stageSite(dungeon, building, door, marker, nav, before, occupied, options = {}) {
  const { point, half, forward, footprint } = siteGeometry(building, door);
  const { width, height } = nav;
  const perimeter = { x: footprint.x - RING_WIDTH, y: footprint.y - RING_WIDTH,
    width: footprint.width + RING_WIDTH * 2, height: footprint.height + RING_WIDTH * 2 };
  const limit = building.large ? 41 : 21;
  if (footprint.width > limit || footprint.height > limit || perimeter.width > limit + 4 || perimeter.height > limit + 4 || perimeter.x < 1 || perimeter.y < 1 ||
    perimeter.x + perimeter.width >= width || perimeter.y + perimeter.height >= height ||
    occupied.some(box => box.markerDirection !== building.direction && overlaps(perimeter, box))) return { reason: 'protected-or-out-of-bounds-site' };
  const foundation = options.early ? stageFoundation(dungeon, building, door, nav, options) : null;
  if (options.early && !foundation?.patch) return { reason: foundation?.reason || 'no-safe-terraced-foundation' };
  if (foundation) nav = foundation.nav;
  const cellAt = key => foundation?.patch.get(key) || dungeon.cells[key];
  const site = [], patch = new Map(foundation?.patch), walls = [], doorway = [], supports = [], gate = [];
  const start = dungeon.start;
  for (let v = -building.forecourtDepth; v < building.depth; v++) for (let u = -half; u <= half; u++) {
    const p = point(u, v), key = `${p.x},${p.y}`, c = cellAt(key);
    const index = p.y * width + p.x;
    const shell = v >= 0 && (Math.abs(u) === half || v === 0 || v === building.depth - 1);
    const tower = v >= 0 && v < 2 && Math.abs(u) >= half - 1;
    const throat = v === 0 && Math.abs(u) <= 1;
    const wall = (shell || tower) && !throat;
    const plannedExit = c?.complexExit && c.complexExit !== building.direction;
    if (fixedContent(c) || plannedExit || !before.seen[index] && !foundation?.patch.has(key) || Math.hypot(p.x - start.x, p.y - start.y) < 4 ||
      wall && (c.navigationReserved && !foundation?.patch.has(key) || c.complexExit || key === marker.key) ||
      throat && c.complexExit && c.complexExit !== building.direction) return { reason: 'protected-or-disconnected-site' };
    site.push({ ...p, key, u, v, wall, tower, throat, old: c, floor: nav.floors[index] });
  }
  const floors = site.map(p => p.floor), base = Math.max(...floors);
  if (building.cavernVillage && site.some(p => p.old.ceilHeight < base + building.towerHeight + 4))
    return { reason: 'insufficient-cavern-headroom' };
  const heightLimit = building.large ? 64 : MAX_HEIGHT;
  if (Math.min(...floors) < -heightLimit || base - Math.min(...floors) > 0.5 ||
    base + Math.max(building.towerHeight + 0.7, building.wallHeight + 2.5) > heightLimit) return { reason: 'uneven-or-height-limited-site' };
  const ring = [];
  for (let y = perimeter.y; y < perimeter.y + perimeter.height; y++) for (let x = perimeter.x; x < perimeter.x + perimeter.width; x++) {
    if (x >= footprint.x && x < footprint.x + footprint.width && y >= footprint.y && y < footprint.y + footprint.height) continue;
    const key = `${x},${y}`, c = cellAt(key), index = y * width + x;
    if (fixedContent(c) || !before.seen[index] && !foundation?.patch.has(key) || Math.abs(nav.floors[index] - base) > 0.5 ||
      Math.hypot(x - start.x, y - start.y) < 4) return { reason: 'no-clear-level-walking-perimeter' };
    ring.push({ x, y, key });
    if (!c.navigationReserved && !c.complexExit) patch.set(key, { ...c, navigationReserved: true });
  }
  const next = { ...nav, passable: nav.passable.slice() };
  for (const p of site) {
    if (p.wall) {
      const top = base + (p.tower ? building.towerHeight : building.large && p.v === building.depth - 1 ? building.wallHeight + 6 : building.wallHeight);
      const torch = Details.torchAt(p.u, p.v, half, building.depth);
      patch.set(p.key, { ...p.old, tile: torch ? 'torch' : 'wall', ceilHeight: top, structureHeight: top - p.floor,
        exteriorRole: p.tower ? 'tower' : 'shell-wall', exteriorDestination: building.targetKey,
        ...(torch ? { feature: 'torch', torchMountHeight: Details.mountHeight(top - p.floor) } : {}) });
      next.passable[p.y * width + p.x] = 0;
      walls.push({ ...p, top });
      if (p.v === 0 && Math.abs(p.u) === 2) supports.push(p.key);
    } else {
      if (building.entrance === 'closed-gate' && p.v > 0) {
        patch.set(p.key, { ...p.old, blocked: true, obstacle: true, navigationReserved: true,
          exteriorRole: p.v === 1 && Math.abs(p.u) <= 1 ? 'closed-gate' : 'sealed-interior', exteriorDestination: building.targetKey });
        next.passable[p.y * width + p.x] = 0;
        if (p.v === 1 && Math.abs(p.u) <= 1) gate.push(p);
        continue;
      }
      // Reserved approach/exit cells keep their original identity, except for the planned throat.
      if (!p.old.navigationReserved && !p.old.complexExit || p.throat) patch.set(p.key, { ...p.old,
        exteriorRole: p.v < 0 ? 'forecourt' : p.throat ? 'doorway' : 'building-floor',
        exteriorDestination: building.targetKey, navigationReserved: true,
        ...(p.throat ? { complexExit: building.direction } : {}) });
      if (p.throat) doorway.push({ x: p.x, y: p.y, key: p.key });
    }
  }
  const after = reachable(next, start);
  // Removing masonry cells is allowed; losing ANY surviving reachable cell is not.
  if (before.seen.some((seen, i) => seen && next.passable[i] && !after.seen[i]) ||
    !after.seen[door.y * width + door.x]) return { reason: 'would-disconnect-existing-routes' };
  const approach = point(0, -1);
  if (!after.seen[approach.y * width + approach.x]) return { reason: 'unreachable-doorway-approach' };
  // Keep the actual path to the new doorway free of subsequent ambient placements.
  for (let i = approach.y * width + approach.x; i >= 0; i = after.parent[i]) {
    const key = `${i % width},${Math.floor(i / width)}`, c = patch.get(key) || cellAt(key);
    if (c?.tile === 'floor' && !fixedContent(c) && !c.navigationReserved && !c.complexExit &&
      Math.hypot(i % width - start.x, Math.floor(i / width) - start.y) >= 4)
      patch.set(key, { ...c, navigationReserved: true });
  }
  return { patch, site, walls, supports, doorway, gate, approach, footprint, perimeter, ring, forward, half, base, before, after,
    foundationCells: foundation?.patch.size || 0, heightLimit };
}

function stageParts(dungeon, building, stage) {
  const parts = [], tiles = {}, unavailable = [];
  const tileFor = (shape, finish) => {
    if (!Voxels.architecture[shape]) return null;
    const canonical = dungeon.tiles?.[`custom_exterior_v${EXTERIOR_VERSION}_${shape}`];
    if (canonical && canonical.spriteSpec?.voxelShape !== shape) return null;
    const identity = String(building.complexIdentity).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    const colorKey = Object.values(building.palette || {}).join('').replace(/[^a-z0-9]/gi, '');
    const tile = `custom_exterior_v${EXTERIOR_VERSION}_${identity}_${shape}_${finish}_${colorKey}`;
    if (dungeon.tiles?.[tile]?.spriteSpec?.voxelShape === shape) return tile;
    if (Object.hasOwn(dungeon.tiles || {}, tile)) return null;
    // Structural instances use canonical meshes, not a texture pretending to be a wall or doorway.
    const palette = finish === 'terrain' ? dungeon.visualStyle?.palette : finish === 'trim' ?
      { ...building.palette, primary: building.palette?.secondary } : building.palette;
    tiles[tile] ||= { url: dungeon.tiles.wall.url, spriteSpec: { voxelShape: shape,
      material: finish === 'stone' ? building.family === 'castle' && building.fortifiedSite ? 'stone' : 'marble' : Voxels.architecture[shape].material || 'stone',
      ...(building.fortifiedSite?.patron ? { shrine: { deity: building.fortifiedSite.patron }, inscription: { motif: building.fortifiedSite.patron } } : {}),
      ...(palette ? { palette } : {}), profile: 'flat', heightRatio: 1, baseWidth: 1, gridWidth: 1 } };
    return tile;
  };
  const part = (shape, position, size, role, finish = 'stone') => {
    const tile = tileFor(shape, finish);
    if (!tile || position.z + size.z > stage.heightLimit || size.z > stage.heightLimit) { unavailable.push({ shape, role }); return false; }
    parts.push({ tile, shape, position, size, role, skyline: true, exteriorDestination: building.targetKey });
    return true;
  };
  // Coalesce masonry into coarse horizontal runs; these duplicate the shared collision shell at distance.
  const walls = stage.walls.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < walls.length;) {
    const first = walls[i];
    let end = i + 1;
    while (end < walls.length && walls[end].y === first.y && walls[end].x === walls[end - 1].x + 1 &&
      walls[end].floor === first.floor && walls[end].top === first.top && walls[end].tower === first.tower) end++;
    part('entablature', { x: first.x, y: first.y, z: first.floor },
        { x: end - i, y: 1, z: first.top - first.floor }, first.tower ? 'exterior-tower-box' : 'exterior-wall-box');
    if (first.v === 0) part('entablature', { x: first.x, y: first.y, z: first.floor + building.wallHeight * 0.7 },
      { x: end - i, y: 1, z: 0.3 }, 'exterior-colored-frieze', 'trim');
    if (first.tower || building.fortifiedSite && building.family === 'castle') part('battlement', { x: first.x, y: first.y, z: first.top },
      { x: end - i, y: 1, z: 0.7 }, 'exterior-tower-crown', 'trim');
    i = end;
  }
  const spring = stage.base + building.wallHeight;
  const supports = stage.supports.map(key => { const p = stage.patch.get(key); return { key, cell: p }; });
  if (supports.length === 2 && supports.every(p => p.cell.ceilHeight >= spring)) {
    const points = stage.doorway.map(p => ({ x: p.x, y: p.y }));
    const x = Math.min(...points.map(p => p.x)) - (stage.forward.y ? 1 : 0);
    const y = Math.min(...points.map(p => p.y)) - (stage.forward.x ? 1 : 0);
    const lintelSize = { x: stage.forward.y ? 5 : 1, y: stage.forward.x ? 5 : 1, z: 0.35 };
    if (part('entablature', { x, y, z: spring }, lintelSize, 'exterior-doorway-lintel') &&
      ['temple', 'basilica', 'rotunda', 'villa', 'domus'].includes(building.family)) {
      part(stage.forward.y ? 'pediment' : 'pediment_side', { x, y, z: spring + 0.35 },
        { x: lintelSize.x, y: lintelSize.y, z: 1.2 }, 'exterior-pediment', 'trim');
    }
    for (const p of stage.site.filter(p => supports.some(s => s.key === p.key))) {
      part(building.family === 'castle' ? 'entablature' : 'fluted_column', { x: p.x, y: p.y, z: stage.base },
        { x: 1, y: 1, z: building.wallHeight }, building.family === 'castle' ? 'exterior-gate-pier' : 'exterior-portico-column');
    }
  }
  if (stage.gate.length) {
    const x = Math.min(...stage.gate.map(p => p.x)), y = Math.min(...stage.gate.map(p => p.y));
    part(stage.forward.y ? 'grand_gate' : 'grand_gate_side', { x, y, z: stage.base },
      { x: stage.forward.y ? 3 : 1, y: stage.forward.x ? 3 : 1, z: building.wallHeight }, 'exterior-closed-gate', 'gate');
  }
  if (building.fortifiedSite) {
    const patron = building.fortifiedSite.patron;
    const front = stage.site.find(p => p.v === 0 && p.u === 3);
    if (patron && front) {
      const side = stage.forward.x ? '_side' : '';
      part('patron_relief' + side, { x: front.x - stage.forward.x * .7, y: front.y - stage.forward.y * .7, z: stage.base + building.wallHeight * .55 },
        { x: 1, y: 1, z: 2 }, 'exterior-patron-relief', 'trim');
      for (const p of stage.site.filter(p => p.v === -1 && Math.abs(p.u) === stage.half - 2))
        part('patron_standard' + side, { x: p.x, y: p.y, z: stage.base }, { x: 1, y: 1, z: 4 }, 'exterior-patron-standard', 'trim');
    }
    // Roofed upper chambers give the intact building a multi-storey silhouette.
    const rear = stage.site.filter(p => p.v >= building.depth - 6 && Math.abs(p.u) <= 3);
    if (rear.length) {
      const x = Math.min(...rear.map(p => p.x)), y = Math.min(...rear.map(p => p.y));
      const w = Math.max(...rear.map(p => p.x)) - x + 1, h = Math.max(...rear.map(p => p.y)) - y + 1;
      part('entablature', { x, y, z: stage.base }, { x: w, y: h, z: building.towerHeight - 2 }, 'exterior-upper-chambers');
      part(patron ? 'dome_shell' : 'pitched_roof_shell', { x, y, z: stage.base + building.towerHeight - 2 },
        { x: w, y: h, z: 2 }, 'exterior-upper-chamber-roof');
    }
  }
  if (building.large && !building.fortifiedSite) {
    const rear = stage.site.filter(p => p.v >= building.depth - 6 && Math.abs(p.u) < stage.half);
    // A handful of coarse masses implies buried wings and mountain masonry without thousands of voxel props.
    for (const side of [-1, 1]) {
      const flank = rear.filter(p => p.u * side > 2);
      if (!flank.length) continue;
      const x = Math.min(...flank.map(p => p.x)), y = Math.min(...flank.map(p => p.y));
      const w = Math.max(...flank.map(p => p.x)) - x + 1, h = Math.max(...flank.map(p => p.y)) - y + 1;
      part('rock_face', { x, y, z: stage.base }, { x: w, y: h, z: building.towerHeight + 8 }, 'exterior-mountain-backdrop', 'terrain');
    }
    for (const p of stage.walls.filter(p => p.v === building.depth - 1 && p.u === 0)) {
      part('entablature', { x: p.x - (stage.forward.y ? 3 : 0), y: p.y - (stage.forward.x ? 3 : 0), z: stage.base },
        { x: stage.forward.y ? 7 : 1, y: stage.forward.x ? 7 : 1, z: building.towerHeight + 5 }, 'exterior-distant-sanctum');
      part('battlement', { x: p.x - (stage.forward.y ? 3 : 0), y: p.y - (stage.forward.x ? 3 : 0), z: stage.base + building.towerHeight + 5 },
        { x: stage.forward.y ? 7 : 1, y: stage.forward.x ? 7 : 1, z: 0.7 }, 'exterior-sanctum-crown', 'trim');
    }
  }
  const shape = ROOF_SHAPES[building.roofFamily];
  let roofParts = 0;
  if (shape) {
    const inner = stage.site.filter(p => p.v > 0 && p.v < building.depth - 1 && Math.abs(p.u) < Math.floor(building.transverse / 2));
    const x = Math.min(...inner.map(p => p.x)), y = Math.min(...inner.map(p => p.y));
    const width = Math.max(...inner.map(p => p.x)) - x + 1, height = Math.max(...inner.map(p => p.y)) - y + 1;
    const size = building.roofFamily === 'domed' ? { x: Math.min(width, height), y: Math.min(width, height), z: 2 } :
      { x: width + 2, y: height + 2, z: building.roofFamily === 'flat' ? 0.25 : 1.5 };
    const position = building.roofFamily === 'domed' ? { x: x + (width - size.x) / 2, y: y + (height - size.y) / 2, z: spring + 0.35 } :
      { x: x - 1, y: y - 1, z: spring + 0.35 };
    // The full-width transfer beam bears on the real shell, supporting the inset dome.
    const ring = building.roofFamily !== 'domed' || part('entablature',
      { x: x - 1, y: y - 1, z: spring }, { x: width + 2, y: height + 2, z: 0.35 }, 'exterior-dome-support');
    if (ring && part(shape, position, size, 'exterior-roof-shell')) roofParts++;
  }
  return { parts, tiles, unavailable, roofParts };
}

function relocateMarker(dungeon, marker, door, floor) {
  const old = { x: marker.x, y: marker.y, key: marker.key, floor: marker.floor };
  for (const part of dungeon.sceneStructures || []) {
    if (part.role !== 'journey-exit-marker' || direction(part.direction) !== direction(marker.direction) || !part.position) continue;
    // Preserve the marker object and mesh metadata used by the installer's signature/stamp cache.
    part.position = { ...part.position, x: part.position.x + door.x - old.x,
      y: part.position.y + door.y - old.y, z: part.position.z + floor - old.floor };
  }
  Object.assign(marker, { x: door.x, y: door.y, key: `${door.x},${door.y}`, floor, kind: 'architectural-exit' });
  return old;
}

function applySceneExteriors(dungeon, spec = {}, options = {}) {
  // Saved reports of any version are authoritative: revisiting is never a compiler migration.
  if (dungeon?.sceneExteriors) return dungeon.sceneExteriors;
  const plan = spec.exteriorPlan;
  const report = { version: EXTERIOR_VERSION, status: 'skipped', buildings: [], rejected: [],
    requested: plan?.buildings?.length || 0, placed: 0, changedCells: 0, parts: 0,
    surfaceModel: 'shared-wall-cells-and-canonical-voxel-parts', maxHeight: MAX_HEIGHT, maxFootprint: 21,
    maxSite: 25, ringWidth: RING_WIDTH };
  report.groups = report.buildings;
  const finish = reason => { report.reason = reason; if (dungeon) dungeon.sceneExteriors = report; return report; };
  if (spec.indoor !== false && !plan?.cavernVillage || !plan?.enabled || plan.version !== EXTERIOR_VERSION) return finish('no-outdoor-exterior-plan');
  const { width, height } = dungeon?.layout || {};
  if (!dungeon?.cells || !Number.isInteger(width) || !Number.isInteger(height) || width < 19 || height < 19 ||
    width > 512 || height > 512 || !validPoint(dungeon.start, width, height)) return finish('invalid-layout-or-start');
  if (!dungeon.tiles?.wall) return finish('missing-wall-tile');
  if (!Array.isArray(dungeon.roomExits?.markers)) return finish('missing-exit-markers');
  report.seed = plan.seed;
  report.sourceKey = plan.sourceKey;
  report.planningRejected = plan.rejected;
  const occupied = occupiedSites(dungeon);
  for (const planned of plan.buildings.slice(0, MAX_BUILDINGS)) {
    let building = planned.monumental && width >= 128 && height >= 128 ? { ...planned, ...planned.monumental, large: true } : planned;
    const marker = dungeon.roomExits.markers.find(m => direction(m.direction) === building.direction);
    const reject = (reason, attempts = 0, siteRejections) => report.rejected.push({ direction: building.direction,
      targetKey: building.targetKey, evidence: building.evidence, reason, attempts,
      ...(siteRejections ? { siteRejections } : {}) });
    if (!validPoint(marker, width, height) || marker.key !== `${marker.x},${marker.y}` || !Number.isFinite(marker.floor)) {
      reject('missing-or-invalid-exit-marker'); continue;
    }
    const nav = navigation(dungeon), before = reachable(nav, dungeon.start);
    if (!before.seen[marker.y * width + marker.x] || Math.abs(nav.floors[marker.y * width + marker.x] - marker.floor) > 0.01) {
      reject('unreachable-or-stale-exit-marker'); continue;
    }
    let accepted, door, attempts = 0, reason = 'no-safe-site';
    const siteRejections = {};
    // On steep mountains retain the tall skyline but fit a narrower gatehouse instead of omitting the temple.
    const variants = options.early && building.large ? [building,
      { ...building, transverse: planned.transverse, depth: planned.depth, siteVariant: 'hillside-gatehouse' },
      { ...building, transverse: 9, depth: 7, forecourtDepth: 2, siteVariant: 'mountain-gate' }] : [building];
    for (const variant of variants) {
      const candidates = candidateSites(variant, marker);
      if (options.early) {
        const { forward: f, cross: c } = orientation(variant.direction);
        for (const distance of [variant.depth + 12, variant.depth + 24, variant.depth + 36]) {
          for (const lateral of [0, -12, 12, -24, 24, -36, 36]) candidates.push({ x: marker.x - f.x * distance + c.x * lateral,
            y: marker.y - f.y * distance + c.y * lateral });
        }
      }
      for (const candidate of candidates.slice(0, variants.length > 1 ? 32 : options.early ? 64 : MAX_CANDIDATES)) {
        attempts++;
        const stage = stageSite(dungeon, variant, candidate, marker, nav, before, occupied, options);
        if (!stage.patch) { reason = stage.reason; siteRejections[reason] = (siteRejections[reason] || 0) + 1; continue; }
        accepted = stage; door = candidate; building = variant; break;
      }
      if (accepted) break;
    }
    if (!accepted) { reject(reason, attempts, siteRejections); continue; }
    const structural = stageParts(dungeon, building, accepted);
    // Coarse wall/tower geometry is mandatory; no partially supported building can leak out of staging.
    if (structural.unavailable.some(p => p.role === 'exterior-wall-box' || p.role === 'exterior-tower-box' || p.role === 'exterior-closed-gate')) {
      reject('missing-canonical-wall-mesh', attempts); continue;
    }
    for (const [key, cell] of accepted.patch) dungeon.cells[key] = cell;
    Object.assign(dungeon.tiles, structural.tiles);
    const oldMarker = relocateMarker(dungeon, marker, door, accepted.base);
    dungeon.sceneStructures ||= [];
    dungeon.sceneStructures.push(...structural.parts);
    occupied.push(accepted.footprint);
    if (require('./worldFlags').on('INDOOR_EXTERIORS')) report.kitParts = (report.kitParts || 0) + biomeKit(dungeon, building, accepted);
    const forecourt = accepted.site.filter(p => p.v < 0);
    report.buildings.push({ ...building, footprint: accepted.footprint, perimeter: accepted.perimeter,
      walkableRingCells: accepted.ring.length, ringWidth: RING_WIDTH, attempts,
      doorway: { ...door, width: 3, floor: marker.floor, direction: building.direction,
        facing: accepted.forward.y ? accepted.forward.y < 0 ? 'south' : 'north' : accepted.forward.x < 0 ? 'east' : 'west',
        cells: accepted.doorway, approach: accepted.approach, supports: accepted.supports }, oldMarker,
      forecourt: { x: Math.min(...forecourt.map(p => p.x)), y: Math.min(...forecourt.map(p => p.y)),
        width: accepted.forward.y ? building.transverse : building.forecourtDepth,
        height: accepted.forward.x ? building.transverse : building.forecourtDepth, outdoor: true },
      changedCells: accepted.patch.size, counts: { walls: accepted.walls.filter(p => !p.tower).length,
        towerCells: accepted.walls.filter(p => p.tower).length, towers: 2, doorwayCells: accepted.doorway.length,
        gateCells: accepted.gate.length, foundationCells: accepted.foundationCells,
        roofParts: structural.roofParts, structuralParts: structural.parts.length },
      omittedParts: structural.unavailable, reachableBefore: before.count, reachableAfter: accepted.after.count,
      preservedReachability: true, roofBuilt: structural.roofParts > 0 });
    report.changedCells += accepted.patch.size;
    report.parts += structural.parts.length;
    report.maxHeight = Math.max(report.maxHeight, accepted.heightLimit);
    report.maxFootprint = Math.max(report.maxFootprint, building.large ? 41 : 21);
    report.maxSite = Math.max(report.maxSite, building.large ? 45 : 25);
  }
  report.placed = report.buildings.length;
  report.status = report.placed ? 'built' : 'skipped';
  return finish(report.placed ? 'committed-safe-destination-facades' : 'no-safe-destination-facade');
}

// world1 INDOOR_EXTERIORS: a biome-specific kit (colonnades, outbuildings, braziers, standards, paving) around the
// facade of every indoor destination. Decorative, non-blocking, capped at 24 parts per building for performance.
const KITS = {
  temple: { rows: 'corinthian_column', accents: ['statue', 'candelabra'], outbuilding: 'pediment' },
  basilica: { rows: 'ionic_column', accents: ['candelabra', 'statue'], outbuilding: 'pediment' },
  rotunda: { rows: 'fluted_column', accents: ['statue'], outbuilding: 'pediment' },
  castle: { rows: 'battlement', accents: ['patron_standard'], outbuilding: 'buttress' },
  domus: { rows: 'timber_post', accents: ['candelabra'], outbuilding: 'pediment' },
  bathhouse: { rows: 'doric_column', accents: ['candelabra'], outbuilding: 'pediment' },
  default: { rows: 'doric_column', accents: ['candelabra'], outbuilding: 'buttress' }
};
function biomeKit(dungeon, building, accepted) {
  const family = String(building.family || building.kind || building.name || '').toLowerCase();
  const kit = KITS[Object.keys(KITS).find(k => family.includes(k))] || KITS.default;
  const shapes = Voxels.architecture || {}, blocked = new Set([...[].concat(accepted.approach || []), ...[].concat(accepted.doorway || [])].map(p => `${p.x},${p.y}`));
  const site = (accepted.site || []).filter(p => p.v < 0 && !p.wall && !p.tower && !p.throat && !blocked.has(`${p.x},${p.y}`) && !dungeon.cells[`${p.x},${p.y}`]?.navigationReserved);
  if (!site.length) return 0;
  const tileFor = shape => {
    if (!shapes[shape]) return null;
    const tile = `world1_kit_${shape}`;
    dungeon.tiles[tile] ||= { url: dungeon.tiles.wall?.url, spriteSpec: { voxelShape: shape, material: shapes[shape].material || 'stone',
      collisionBlocking: false, ...(building.palette ? { palette: building.palette } : {}), profile: 'flat', heightRatio: 1, baseWidth: 1, gridWidth: 1 } };
    return tile;
  };
  const xs = site.map(p => p.x), ys = site.map(p => p.y), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const floorAt = p => dungeon.cells[`${p.x},${p.y}`]?.floorHeight || 0, parts = [];
  const push = (shape, p, h, role) => { const tile = tileFor(shape); if (!tile || parts.length >= 24) return;
    parts.push({ tile, shape, role, position: { x: p.x + .1, y: p.y + .1, z: floorAt(p) }, size: { x: .8, y: .8, z: h }, world1Kit: true, exteriorDestination: building.targetKey }); };
  // Colonnade: columns along the two long edges of the forecourt, every third cell.
  for (const p of site) {
    const edge = (p.x === minX || p.x === maxX) && (maxY - minY) >= (maxX - minX) || (p.y === minY || p.y === maxY) && (maxX - minX) > (maxY - minY);
    if (edge && (p.x + p.y) % 3 === 0) push(kit.rows, p, 3, 'world1-colonnade');
    dungeon.cells[`${p.x},${p.y}`].pathPaving = true;
  }
  // Accents and an outbuilding at the forecourt corners.
  const corners = [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]].map(([x, y]) => site.find(p => p.x === x && p.y === y)).filter(Boolean);
  corners.forEach((p, i) => push(i === 3 ? kit.outbuilding : kit.accents[i % kit.accents.length], p, i === 3 ? 2.5 : 1.6, 'world1-accent'));
  dungeon.sceneStructures.push(...parts);
  return parts.length;
}

function buildSceneExteriorSites(dungeon, spec = {}) {
  if (dungeon?.sceneExteriors || !spec.exteriorPlan?.enabled || !spec.exteriorPlan.buildings?.length) return dungeon?.sceneExteriors;
  const reservedRoutes = new Set(Object.entries(dungeon.cells || {}).filter(([, c]) => c.navigationReserved).map(([key]) => key));
  Exits.install(dungeon, spec.exits);
  return applySceneExteriors(dungeon, spec, { early: true, reservedRoutes });
}

module.exports = { prepareSceneExteriors, buildSceneExteriorSites, applySceneExteriors, EXTERIOR_VERSION };
