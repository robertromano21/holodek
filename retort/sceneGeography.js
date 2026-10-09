'use strict';

const { makeNavigation, reachable } = require('./sceneArchitecture');
const { random } = require('./dungeonGeneration');
const VERSION = 2;
const OFFSETS = { up: [0, 0, 1], down: [0, 0, -1] };

function planVerticalTransitions(spec = {}, roomDatabase = {}) {
  let db = roomDatabase;
  if (typeof db === 'string') {
    try { db = JSON.parse(db); } catch { db = {}; }
  }
  db = db && typeof db === 'object' ? db : {};
  const coords = spec.coords || {}, current = db[`${coords.x},${coords.y},${coords.z}`] || {};
  const exits = Array.isArray(spec.exits) ? spec.exits : [];
  return exits.filter(direction => Object.hasOwn(OFFSETS, direction)).map(direction => {
    const offset = OFFSETS[direction];
    const fallback = [coords.x, coords.y, coords.z].every(Number.isFinite) ?
      `${coords.x + offset[0]},${coords.y + offset[1]},${coords.z + offset[2]}` : null;
    const targetKey = current.exits?.[direction]?.targetCoordinates || fallback;
    const target = db[targetKey] || {};
    const indoor = typeof target.indoor === 'boolean' ? target.indoor : typeof target.classification?.indoor === 'boolean' ?
      target.classification.indoor : typeof target.sceneSpec?.indoor === 'boolean' ? target.sceneSpec.indoor : null;
    const name = String(target.name || target.sceneSpec?.source?.roomName || '');
    const text = `${name} ${target.sceneSpec?.source?.description || ''}`.toLowerCase();
    let kind = 'portal';
    if (/portal|rift|planar|gateway between worlds/.test(text)) kind = 'portal';
    else if (/floating|celestial|skyborne|suspended.*citadel/.test(text) && direction === 'up') kind = 'celestial-stairway';
    else if (indoor !== null) kind = spec.indoor !== false ? indoor ? 'interior-stair' : 'exterior-stair' :
      direction === 'down' ? indoor ? 'cave-descent' : 'canyon-descent' : indoor ? 'hillside-entrance' : 'mountain-ascent';
    return { direction, kind, targetKey, targetName: name, targetIndoor: indoor,
      targetBiome: target.classification?.biome || target.sceneSpec?.biome || null,
      evidence: indoor === null ? 'unknown-destination' : target.sceneSpec ? 'destination-scene' : 'destination-skeleton',
      status: current.exits?.[direction]?.status || 'open' };
  });
}

function planTerrainRequests(spec = {}, options = {}) {
  const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''} ${spec.source?.puzzle || ''} ${(spec.level?.layoutFeatures || []).join(' ')}`.toLowerCase();
  const setting = `${spec.biome || ''} ${spec.architecture || ''} ${spec.source?.roomName || ''}`.toLowerCase();
  const flat = /\b(flat|level) (?:\w+ )?(plains?|wastes?|terrain|ground|court|plateau)|\b(frozen lake|salt flat)/.test(text) || /\bplains?\b/.test(setting);
  const wetland = /swamp|bog|marsh|mire|wetland|lake/.test(setting);
  const urban = /city|street|town|village|forum|amphitheater|theater|circus|harbour|harbor/.test(setting);
  const requests = (spec.verticalTransitions || []).filter(t => !['portal', 'celestial-stairway'].includes(t.kind))
    .map(t => ({ ...t, role: t.direction === 'up' ? 'mountain' : 'canyon', exitRequested: true }));
  if (!requests.some(r => r.direction === 'up') && /mountain|crag|ridge|cliff/.test(text)) {
    requests.push({ direction: 'up', role: 'mountain', evidence: 'description-or-level-detail', exitRequested: false });
  }
  if (!requests.some(r => r.direction === 'down') && /canyon|ravine|gorge|chasm/.test(text)) {
    requests.push({ direction: 'down', role: 'canyon', evidence: 'description-or-level-detail', exitRequested: false });
  }
  const background = spec.indoor === false && options.backgroundTerrain !== false && !flat && !wetland && !urban;
  if (background && !requests.some(r => r.direction === 'up')) {
    requests.push({ direction: 'up', role: 'mountain', kind: 'background-upland',
      evidence: 'outdoor-world-profile', exitRequested: false });
  }
  return { profile: flat ? 'flat' : wetland ? 'wetland' : urban ? 'urban' : 'uplands', background, requests: requests.slice(0, 2) };
}

function prepareSceneGeography(spec = {}, roomDatabase = {}, options = {}) {
  spec.verticalTransitions = planVerticalTransitions(spec, roomDatabase);
  spec.terrainPlan = planTerrainRequests(spec, options);
  if (spec.indoor === false) {
    spec.landmarks ||= [];
    const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''}`;
    if (/mountain|canyon|ravine|cliff|rocky|crag|boulder/i.test(text) || spec.terrainPlan.requests.length) {
      for (const [type, count] of [['boulder', 3], ['rock_face', 2]]) {
        if (!spec.landmarks.some(l => l.type === type)) spec.landmarks.push({ type, count, label: type,
          condition: [], placement: 'scattered' });
      }
    }
  }
  return spec.verticalTransitions;
}

function applySceneGeography(dungeon, spec = {}, options = {}) {
  // A compiler upgrade does not silently reshape an already-saved campaign room.
  if (dungeon?.sceneGeography?.version) return dungeon.sceneGeography;
  const report = { version: VERSION, status: 'skipped', features: [], rejected: [], surfaceModel: 'shared-floor-heightfield' };
  report.deferredTransitions = (spec.verticalTransitions || []).filter(t => ['portal', 'celestial-stairway'].includes(t.kind));
  const finish = reason => { report.reason = reason; if (dungeon) dungeon.sceneGeography = report; return report; };
  if (options.enabled === false) return finish('disabled');
  if (spec.indoor !== false || !dungeon?.cells || !dungeon.start || !dungeon.layout) return finish('not-outdoor');
  const { width, height } = dungeon.layout;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width > 512 || height > 512 || width < 19 || height < 19) return finish('invalid-layout');
  if (!Number.isInteger(dungeon.start.x) || !Number.isInteger(dungeon.start.y) || dungeon.start.x < 0 || dungeon.start.y < 0 ||
      dungeon.start.x >= width || dungeon.start.y >= height) return finish('invalid-start');
  const clearance = (c, floor) => Number.isFinite(c.ceilHeight) ? Math.max(0.5, c.ceilHeight - floor) : 2.5;
  const plan = spec.terrainPlan || planTerrainRequests(spec, options);
  report.requestPlan = plan;
  const requests = plan.requests;
  if (!requests.length) return finish('no-geographic-evidence');
  // Each feature is bounded near spawn, and never moves existing walls, props or fixtures.
  const protectedCells = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = dungeon.cells[`${x},${y}`];
    if (!c || c.tile !== 'floor' || c.feature || c.exit || c.door || c.interactable || c.blocked || c.obstacle || c.navigationReserved || c.architectureRole) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) protectedCells[ny * width + nx] = 1;
      }
    }
    if (Math.hypot(x - dungeon.start.x, y - dungeon.start.y) < 4) protectedCells[y * width + x] = 1;
  }
  for (const request of requests.slice(0, 2)) {
    const nav = makeNavigation(dungeon), before = reachable(nav, dungeon.start);
    const axes = request.direction === 'up' ? [[1, 0], [0, -1], [-1, 0], [0, 1]] : [[-1, 0], [0, 1], [1, 0], [0, -1]];
    if (dungeon.generation?.seed) {
      const turn = Math.floor(random(`${dungeon.generation.seed}:${request.role}:approach`)() * 4);
      axes.push(...axes.splice(0, turn));
    }
    let route;
    search: for (const distance of [5, 10, 16]) for (const [dx, dy] of axes) {
      const x = dungeon.start.x + dx * distance, y = dungeon.start.y + dy * distance;
      const available = dx > 0 ? width - 4 - x : dx < 0 ? x - 3 : dy > 0 ? height - 4 - y : y - 3;
      const length = Math.min(18, available);
      if (length < 6) continue;
      const cells = [];
      candidate: for (let i = 0; i <= length; i++) for (let cross = -1; cross <= 1; cross++) {
        const px = x + dx * i - dy * cross, py = y + dy * i + dx * cross;
        if (px < 3 || py < 3 || px >= width - 3 || py >= height - 3 || protectedCells[py * width + px] || !before.seen[py * width + px]) {
          cells.length = 0; break candidate;
        }
        cells.push({ x: px, y: py, i });
      }
      if (cells.length !== (length + 1) * 3) continue;
      route = { x, y, dx, dy, length, cells }; break search;
    }
    if (!route) { report.rejected.push({ ...request, reason: 'no-clear-connected-terrain-route' }); continue; }
    const sign = request.direction === 'up' ? 1 : -1;
    const amplitude = Math.min(request.role === 'mountain' ? 8 : 7, route.length * 0.5);
    const center = { x: route.x + route.dx * route.length, y: route.y + route.dy * route.length };
    let accepted;
    for (const terraced of [true, false]) {
      const patch = new Map(), next = { ...nav, floors: nav.floors.slice() };
      for (let y = Math.max(3, center.y - route.length); y <= Math.min(height - 4, center.y + route.length); y++) {
        for (let x = Math.max(3, center.x - route.length); x <= Math.min(width - 4, center.x + route.length); x++) {
          if (protectedCells[y * width + x] || !before.seen[y * width + x]) continue;
          const raw = amplitude * Math.max(0, 1 - Math.hypot(x - center.x, y - center.y) / route.length);
          const offset = sign * (terraced ? Math.floor(raw / 2) * 2 : raw);
          if (Math.abs(offset) < 0.02) continue;
          const c = dungeon.cells[`${x},${y}`], floorHeight = Number((nav.floors[y * width + x] + offset).toFixed(3));
          patch.set(`${x},${y}`, { ...c, floorHeight, ceilHeight: floorHeight + clearance(c, nav.floors[y * width + x]), geographyRole: request.role });
          next.floors[y * width + x] = floorHeight;
        }
      }
      const base = nav.floors[route.y * width + route.x];
      for (const p of route.cells) {
        const key = `${p.x},${p.y}`, c = dungeon.cells[key];
        const floorHeight = Number((base + sign * amplitude * p.i / route.length).toFixed(3));
        patch.set(key, { ...c, floorHeight, ceilHeight: floorHeight + clearance(c, nav.floors[p.y * width + p.x]),
          geographyRole: `${request.role}-approach`, navigationReserved: true });
        next.floors[p.y * width + p.x] = floorHeight;
      }
      const after = reachable(next, dungeon.start);
      if (before.seen.some((seen, i) => seen && !after.seen[i])) continue;
      // Reserve an actual route to the foot of the climb/descent before prop scatter.
      for (let i = route.y * width + route.x; i >= 0; i = after.parent[i]) {
        const key = `${i % width},${Math.floor(i / width)}`;
        patch.set(key, { ...(patch.get(key) || dungeon.cells[key]), navigationReserved: true });
      }
      if (request.exitRequested) patch.get(`${center.x},${center.y}`).complexExit = request.direction;
      accepted = { patch, terraced, after }; break;
    }
    if (!accepted) { report.rejected.push({ ...request, reason: 'would-disconnect-terrain-or-existing-content' }); continue; }
    for (const [key, c] of accepted.patch) {
      dungeon.cells[key] = c;
      const [x, y] = key.split(',').map(Number);
      protectedCells[y * width + x] = 1;
    }
    report.features.push({ ...request, center, rise: sign * amplitude, terraced: accepted.terraced,
      implementation: 'heightfield-approach',
      changedCells: accepted.patch.size, approach: { x: route.x, y: route.y, width: 3, length: route.length },
      endpointHeight: dungeon.cells[`${center.x},${center.y}`].floorHeight, reachableBefore: before.count, reachableAfter: accepted.after.count });
  }
  report.status = report.features.length ? 'built' : 'skipped';
  return finish(report.features.length ? 'committed-connected-heightfield' : 'no-safe-feature-site');
}

module.exports = { prepareSceneGeography, planVerticalTransitions, planTerrainRequests, applySceneGeography };
