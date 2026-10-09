'use strict';

const { chooseArchitecture, makeNavigation, reachable } = require('./sceneArchitecture');
const Voxels = require('../assets/scenePropVoxels');

const EXTERIOR_VERSION = 1;
const MAX_HEIGHT = 18;
const MAX_BUILDINGS = 2;
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
  const maxBuildings = Number.isInteger(options.maxBuildings) ? Math.max(0, Math.min(MAX_BUILDINGS, options.maxBuildings)) : MAX_BUILDINGS;
  const plan = { version: EXTERIOR_VERSION, enabled: options.enabled !== false && spec.indoor === false,
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
    const scene = room.sceneSpec || {};
    const roomName = String(room.name || room.roomName || scene.source?.roomName || '');
    const description = String(room.description || scene.source?.description || '');
    const indoor = indoorMetadata(room);
    const rootTemple = targetKey === '0,0,0' && roomName === 'Ruined Temple Entrance';
    if (!rootTemple && indoor.value !== true) { reject(indoor.value === false ? 'outdoor-destination' : 'unknown-indoor-metadata'); continue; }
    const selection = rootTemple ? { family: 'temple', evidence: 'known-root-temple-name', ruined: true } :
      chooseArchitecture({ ...scene, indoor: true, source: { roomName, description },
        architecture: scene.architecture || room.architecture || room.classification?.architecture });
    if (!selection || !BUILDINGS.has(selection.family)) { reject('no-building-evidence'); continue; }
    const complexIdentity = String(room.complexId || room.siteId || (rootTemple ? 'ruined-temple' : targetKey));
    const random = Voxels.random(`${EXTERIOR_VERSION}:${plan.seed}:${complexIdentity}`);
    const roofless = /\b(roofless|unroofed|without (?:a )?roof|no roof|collapsed roof|open[- ]sky)\b/i.test(description);
    const roofs = selection.family === 'rotunda' ? ['domed', 'domed', 'flat'] :
      selection.family === 'castle' ? ['pitched', 'flat', 'open'] : ['pitched', 'barrel', 'flat', 'open'];
    const roofFamily = roofless ? 'open' : roofs[Math.floor(random() * roofs.length)];
    const transverse = 13 + 2 * Math.floor(random() * 4), depth = 11 + 2 * Math.floor(random() * 3);
    const forecourtDepth = 2 + Math.floor(random() * 3), wallHeight = 5 + Math.floor(random() * 3);
    plan.buildings.push({ direction: name, targetKey, targetName: roomName, targetIndoor: indoor.value, complexIdentity,
      family: selection.family, ruined: !!selection.ruined, roofFamily, transverse, depth, forecourtDepth,
      wallHeight, towerHeight: wallHeight + 2 + Math.floor(random() * 3),
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
  if (plan.buildings.length) plan.requiredShapes = [...new Set(['entablature', 'pediment', 'pediment_side', 'battlement',
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

function stageSite(dungeon, building, door, marker, nav, before, occupied) {
  const { point, half, forward, footprint } = siteGeometry(building, door);
  const { width, height } = nav;
  const perimeter = { x: footprint.x - RING_WIDTH, y: footprint.y - RING_WIDTH,
    width: footprint.width + RING_WIDTH * 2, height: footprint.height + RING_WIDTH * 2 };
  if (footprint.width > 21 || footprint.height > 21 || perimeter.width > 25 || perimeter.height > 25 || perimeter.x < 1 || perimeter.y < 1 ||
    perimeter.x + perimeter.width >= width || perimeter.y + perimeter.height >= height ||
    occupied.some(box => box.markerDirection !== building.direction && overlaps(perimeter, box))) return { reason: 'protected-or-out-of-bounds-site' };
  const site = [], patch = new Map(), walls = [], doorway = [], supports = [];
  const start = dungeon.start;
  for (let v = -building.forecourtDepth; v < building.depth; v++) for (let u = -half; u <= half; u++) {
    const p = point(u, v), key = `${p.x},${p.y}`, c = dungeon.cells[key];
    const index = p.y * width + p.x;
    const shell = v >= 0 && (Math.abs(u) === half || v === 0 || v === building.depth - 1);
    const tower = v >= 0 && v < 2 && Math.abs(u) >= half - 1;
    const throat = v === 0 && Math.abs(u) <= 1;
    const wall = (shell || tower) && !throat;
    const plannedExit = c?.complexExit && c.complexExit !== building.direction;
    if (fixedContent(c) || plannedExit || !before.seen[index] || Math.hypot(p.x - start.x, p.y - start.y) < 4 ||
      wall && (c.navigationReserved || c.complexExit || key === marker.key) ||
      throat && c.complexExit && c.complexExit !== building.direction) return { reason: 'protected-or-disconnected-site' };
    site.push({ ...p, key, u, v, wall, tower, throat, old: c, floor: nav.floors[index] });
  }
  const floors = site.map(p => p.floor), base = Math.max(...floors);
  if (Math.min(...floors) < -MAX_HEIGHT || base - Math.min(...floors) > 0.5 ||
    base + Math.max(building.towerHeight + 0.7, building.wallHeight + 2.5) > MAX_HEIGHT) return { reason: 'uneven-or-height-limited-site' };
  const ring = [];
  for (let y = perimeter.y; y < perimeter.y + perimeter.height; y++) for (let x = perimeter.x; x < perimeter.x + perimeter.width; x++) {
    if (x >= footprint.x && x < footprint.x + footprint.width && y >= footprint.y && y < footprint.y + footprint.height) continue;
    const key = `${x},${y}`, c = dungeon.cells[key], index = y * width + x;
    if (fixedContent(c) || !before.seen[index] || Math.abs(nav.floors[index] - base) > 0.5 ||
      Math.hypot(x - start.x, y - start.y) < 4) return { reason: 'no-clear-level-walking-perimeter' };
    ring.push({ x, y, key });
    if (!c.navigationReserved && !c.complexExit) patch.set(key, { ...c, navigationReserved: true });
  }
  const next = { ...nav, passable: nav.passable.slice() };
  for (const p of site) {
    if (p.wall) {
      const top = base + (p.tower ? building.towerHeight : building.wallHeight);
      patch.set(p.key, { ...p.old, tile: 'wall', ceilHeight: top, structureHeight: top - p.floor,
        exteriorRole: p.tower ? 'tower' : 'shell-wall', exteriorDestination: building.targetKey });
      next.passable[p.y * width + p.x] = 0;
      walls.push({ ...p, top });
      if (p.v === 0 && Math.abs(p.u) === 2) supports.push(p.key);
    } else {
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
    const key = `${i % width},${Math.floor(i / width)}`, c = patch.get(key) || dungeon.cells[key];
    if (c?.tile === 'floor' && !fixedContent(c) && !c.navigationReserved && !c.complexExit &&
      Math.hypot(i % width - start.x, Math.floor(i / width) - start.y) >= 4)
      patch.set(key, { ...c, navigationReserved: true });
  }
  return { patch, site, walls, supports, doorway, approach, footprint, perimeter, ring, forward, base, before, after };
}

function stageParts(dungeon, building, stage) {
  const parts = [], tiles = {}, unavailable = [];
  const tileFor = shape => {
    if (!Voxels.architecture[shape]) return null;
    const existing = Object.entries(dungeon.tiles || {}).find(([, meta]) => meta?.spriteSpec?.voxelShape === shape);
    if (existing) return existing[0];
    const tile = `custom_exterior_v${EXTERIOR_VERSION}_${shape}`;
    if (Object.hasOwn(dungeon.tiles || {}, tile)) return null;
    // Structural instances use canonical meshes, not a texture pretending to be a wall or doorway.
    tiles[tile] ||= { url: dungeon.tiles.wall.url, spriteSpec: { voxelShape: shape,
      material: Voxels.architecture[shape].material || 'stone', profile: 'flat', heightRatio: 1, baseWidth: 1, gridWidth: 1 } };
    return tile;
  };
  const part = (shape, position, size, role) => {
    const tile = tileFor(shape);
    if (!tile || position.z + size.z > MAX_HEIGHT || size.z > MAX_HEIGHT) { unavailable.push({ shape, role }); return false; }
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
    if (first.tower) part('battlement', { x: first.x, y: first.y, z: first.top },
      { x: end - i, y: 1, z: 0.7 }, 'exterior-tower-crown');
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
        { x: lintelSize.x, y: lintelSize.y, z: 1.2 }, 'exterior-pediment');
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

function applySceneExteriors(dungeon, spec = {}) {
  // Saved reports of any version are authoritative: revisiting is never a compiler migration.
  if (dungeon?.sceneExteriors) return dungeon.sceneExteriors;
  const plan = spec.exteriorPlan;
  const report = { version: EXTERIOR_VERSION, status: 'skipped', buildings: [], rejected: [],
    requested: plan?.buildings?.length || 0, placed: 0, changedCells: 0, parts: 0,
    surfaceModel: 'shared-wall-cells-and-canonical-voxel-parts', maxHeight: MAX_HEIGHT, maxFootprint: 21,
    maxSite: 25, ringWidth: RING_WIDTH };
  report.groups = report.buildings;
  const finish = reason => { report.reason = reason; if (dungeon) dungeon.sceneExteriors = report; return report; };
  if (spec.indoor !== false || !plan?.enabled || plan.version !== EXTERIOR_VERSION) return finish('no-outdoor-exterior-plan');
  const { width, height } = dungeon?.layout || {};
  if (!dungeon?.cells || !Number.isInteger(width) || !Number.isInteger(height) || width < 19 || height < 19 ||
    width > 512 || height > 512 || !validPoint(dungeon.start, width, height)) return finish('invalid-layout-or-start');
  if (!dungeon.tiles?.wall) return finish('missing-wall-tile');
  if (!Array.isArray(dungeon.roomExits?.markers)) return finish('missing-exit-markers');
  report.seed = plan.seed;
  report.sourceKey = plan.sourceKey;
  report.planningRejected = plan.rejected;
  const occupied = occupiedSites(dungeon);
  for (const building of plan.buildings.slice(0, MAX_BUILDINGS)) {
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
    for (const candidate of candidateSites(building, marker)) {
      attempts++;
      const stage = stageSite(dungeon, building, candidate, marker, nav, before, occupied);
      if (!stage.patch) { reason = stage.reason; siteRejections[reason] = (siteRejections[reason] || 0) + 1; continue; }
      accepted = stage; door = candidate; break;
    }
    if (!accepted) { reject(reason, attempts, siteRejections); continue; }
    const structural = stageParts(dungeon, building, accepted);
    // Coarse wall/tower geometry is mandatory; no partially supported building can leak out of staging.
    if (structural.unavailable.some(p => p.role === 'exterior-wall-box' || p.role === 'exterior-tower-box')) {
      reject('missing-canonical-wall-mesh', attempts); continue;
    }
    for (const [key, cell] of accepted.patch) dungeon.cells[key] = cell;
    Object.assign(dungeon.tiles, structural.tiles);
    const oldMarker = relocateMarker(dungeon, marker, door, nav.floors[door.y * width + door.x]);
    dungeon.sceneStructures ||= [];
    dungeon.sceneStructures.push(...structural.parts);
    occupied.push(accepted.footprint);
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
        roofParts: structural.roofParts, structuralParts: structural.parts.length },
      omittedParts: structural.unavailable, reachableBefore: before.count, reachableAfter: accepted.after.count,
      preservedReachability: true, roofBuilt: structural.roofParts > 0 });
    report.changedCells += accepted.patch.size;
    report.parts += structural.parts.length;
  }
  report.placed = report.buildings.length;
  report.status = report.placed ? 'built' : 'skipped';
  return finish(report.placed ? 'committed-safe-destination-facades' : 'no-safe-destination-facade');
}

module.exports = { prepareSceneExteriors, applySceneExteriors, EXTERIOR_VERSION };
