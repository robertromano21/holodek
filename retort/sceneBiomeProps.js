'use strict';

const V = require('../assets/scenePropVoxels');
const { makeNavigation, reachable } = require('./sceneArchitecture');
const VERSION = 1;
const LIMITS = Object.freeze({ maxProps: 80, maxClusters: 10, variantsPerShape: 3,
  maxCustomTiles: 232, centerAttempts: 48, placementAttempts: 96 });
const PROFILE_RULES = {
  badlands: /\b(badlands?|wastelands?|deserts?|arid|sandstone|canyons?|rocky|eroded|scree|barren|salt flats?)\b/,
  volcanic: /\b(volcanic|volcano\w*|lava|magma|geothermal|fumaroles?|geysers?|basalt|sulfur|sulphur|hot springs?|mineral cones?)\b/,
  forest: /\b(forests?|woodlands?|groves?|gardens?|overgrown|thickets?|fungi|fungal|mushrooms?|logs?|roots?)\b/,
  wetland: /\b(wetlands?|wet|swamps?|marsh\w*|bogs?|mires?|rivers?|riverbanks?|streams?|shores?|lakes?|driftwood|reeds?|mangroves?)\b/,
  icy: /\b(icy|ice|frozen|frost\w*|glaci\w*|snow\w*|tundra|permafrost|rime)\b/
};
const GARDEN = /\b(gardens?|courtyards?|courts?)\b/;
const NO_ORGANIC = /\b(barren of vegetation|no trees|treeless|no plants|no vegetation|without vegetation|without plants|without trees)\b/;
const GARDEN_ROLES = new Set(['garden', 'courtyard', 'planted-court']);
const PROTECTED = ['feature', 'roof', 'navigationReserved', 'routeReserved', 'routeRole', 'outdoorRoute',
  'outdoorFoundation', 'foundation', 'support', 'supports', 'structureHeight', 'complexExit', 'exit', 'door',
  'interactable', 'blocked', 'obstacle', 'object', 'sceneObject', 'hazard', 'biomePropsExcluded',
  'vegetationExcluded', 'noVegetation'];

function sceneText(spec) {
  const list = value => Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
  return `${spec.source?.roomName || ''} ${spec.source?.description || ''} ${spec.source?.puzzle || ''} ` +
    `${spec.biome || ''} ${spec.floorMaterial || ''} ${list(spec.groundCover)} ${list(spec.level?.layoutFeatures)}`;
}

function bounded(value, fallback, cap) {
  return Math.max(0, Math.min(cap, Math.floor(Number.isFinite(value) ? value : fallback)));
}

function excludesOrganic(spec, text) {
  return NO_ORGANIC.test(text) || spec.vegetationExcluded === true ||
    spec.indoor === false && spec.vegetationPlan?.enabled === false;
}

function prepareSceneBiomeProps(spec = {}, options = {}) {
  const text = sceneText(spec).toLowerCase();
  const gardenRequested = GARDEN.test(text);
  const organicExcluded = excludesOrganic(spec, text) || options.vegetation === false;
  const profiles = Object.keys(PROFILE_RULES).filter(profile => PROFILE_RULES[profile].test(text));
  const shapes = V.biomeShapes.filter(shape => {
    const meta = V.biomeProps[shape];
    return profiles.some(profile => meta.biomes.includes(profile)) && !(organicExcluded && meta.organic) &&
      !(/\b(no fungi|no mushrooms|without fungi)\b/.test(text) && /fungi|toadstool/.test(shape));
  });
  const indoor = spec.indoor !== false;
  const enabled = options.enabled !== false && (!indoor || gardenRequested) && shapes.length > 0;
  const plan = spec.biomePropsPlan = { version: VERSION, enabled, profiles,
    profile: profiles.length > 1 ? 'mixed' : profiles[0] || null, evidence: 'scene-biome-clues',
    gardenRequested, organicExcluded, shapes, variantsPerShape: LIMITS.variantsPerShape,
    maxProps: bounded(options.maxProps, profiles.length > 1 ? 80 : 64, indoor ? 16 : LIMITS.maxProps),
    maxClusters: bounded(options.maxClusters, indoor ? 3 : 8, LIMITS.maxClusters) };
  // Repreparation removes only our own prior additions, never authored landmarks.
  if (Array.isArray(spec.landmarks)) spec.landmarks = spec.landmarks.filter(lm => !lm.fromBiomeProps);
  if (!enabled) return plan;
  spec.landmarks ||= [];
  for (const type of shapes) {
    if (spec.landmarks.some(lm => lm.type === type)) continue;
    const meta = V.biomeProps[type];
    const primitive = { archway: 'arch', dead_tree: 'tree', vines: 'tree', mushroom: 'cluster',
      crystal_cluster: 'crystal', stalagmite: 'spire', ash_flora: 'tree', rubble: 'pile' }[meta.drawer] || 'mound';
    spec.landmarks.push({ type, label: type.replace(/_/g, ' '), count: 1, condition: [],
      placement: 'biome-clusters', fromBiomeProps: true,
      // Existing placeSceneLandmarks already defers fromVegetation ambient tiles.
      fromVegetation: true, prim: { shape: primitive, width: meta.baseWidth, height: meta.heightRatio,
        color: meta.palette[0], color2: meta.palette[1], blocking: true } });
  }
  return plan;
}

function applySceneBiomeProps(dungeon, spec = {}) {
  if (dungeon?.sceneBiomeProps) return dungeon.sceneBiomeProps;
  const skip = reason => ({ version: VERSION, status: 'skipped', reason, placed: 0 });
  // Fresh-only: never migrate a finalized/saved room just because a new hook exists.
  if (dungeon?.sceneSpec || dungeon?.saved === true) return skip('saved-room');
  const plan = spec.biomePropsPlan;
  if (!plan?.enabled) return skip('no-biome-prop-plan');
  const indoor = spec.indoor !== false || dungeon?.classification?.indoor === true;
  const text = sceneText(spec).toLowerCase();
  if (indoor && (!plan.gardenRequested || !GARDEN.test(text))) return skip('not-explicit-garden');
  const { width: w, height: h } = dungeon?.layout || {};
  if (!dungeon?.cells || !Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 || w > 512 || h > 512)
    return skip('invalid-layout');
  const start = dungeon.start;
  if (!Number.isInteger(start?.x) || !Number.isInteger(start?.y) || start.x < 0 || start.y < 0 || start.x >= w || start.y >= h)
    return skip('invalid-start');
  const organicExcluded = plan.organicExcluded || excludesOrganic(spec, text);
  const shapes = V.biomeShapes.filter(shape => Array.isArray(plan.shapes) && plan.shapes.includes(shape) &&
    !(organicExcluded && V.biomeProps[shape].organic) &&
    !(/\b(no fungi|no mushrooms|without fungi)\b/.test(text) && /fungi|toadstool/.test(shape)));
  const profiles = Object.keys(PROFILE_RULES).filter(profile => plan.profiles?.includes(profile) &&
    shapes.some(shape => V.biomeProps[shape].biomes.includes(profile)));
  if (!profiles.length) return skip('no-eligible-shapes');
  const maxProps = bounded(plan.maxProps, 64, indoor ? 16 : LIMITS.maxProps);
  const maxClusters = bounded(plan.maxClusters, 8, LIMITS.maxClusters);
  if (!maxProps || !maxClusters) return skip('zero-budget');
  const nav = makeNavigation(dungeon), before = reachable(nav, start);
  if (!before.count) return skip('unreachable-spawn');
  const seed = spec.generation?.seed ?? spec.textHash ?? dungeon.generation?.seed ?? dungeon.geoKey ?? 'biome';
  const rnd = V.random(`${seed}:biome-props`);
  const occupied = new Uint8Array(w * h), blocked = new Uint8Array(w * h);
  const mark = (x, y) => {
    if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < w && y < h)
      occupied[Math.floor(x) + Math.floor(y) * w] = 1;
  };
  for (const list of [dungeon.sceneObjects, dungeon.objects, dungeon.monsters]) {
    if (Array.isArray(list)) for (const object of list) mark(object.x ?? object.position?.x, object.y ?? object.position?.y);
  }
  for (const part of dungeon.sceneStructures || []) {
    const p = part.position, size = part.size;
    if (![p?.x, p?.y, size?.x, size?.y].every(Number.isFinite)) continue;
    for (let y = Math.max(0, Math.floor(p.y)); y < Math.min(h, Math.ceil(p.y + size.y)); y++) {
      for (let x = Math.max(0, Math.floor(p.x)); x < Math.min(w, Math.ceil(p.x + size.x)); x++) mark(x, y);
    }
  }
  const gardens = (dungeon.sceneArchitecture?.zones || []).filter(zone => GARDEN_ROLES.has(zone.role) &&
    [zone.x, zone.y, zone.width, zone.height].every(Number.isFinite) && zone.width > 0 && zone.height > 0);
  const inGarden = (x, y, cell) => GARDEN_ROLES.has(cell.architectureRole) ||
    gardens.some(z => x >= z.x && y >= z.y && x < z.x + z.width && y < z.y + z.height);
  const safe = (x, y) => {
    if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3 || Math.hypot(x - start.x, y - start.y) < 6) return false;
    const floor = nav.floors[x + y * w];
    // A clear, nearly level 5x5 ring both protects content and leaves a walk-around.
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy, i = nx + ny * w, cell = dungeon.cells[`${nx},${ny}`];
      if (!cell || cell.tile !== 'floor' || PROTECTED.some(key => cell[key]) || occupied[i] || blocked[i] ||
          !before.seen[i] || !Number.isFinite(cell.floorHeight ?? 0) || Math.abs(nav.floors[i] - floor) > .5 ||
          cell.architectureRole && !(indoor && GARDEN_ROLES.has(cell.architectureRole)) || indoor && !inGarden(nx, ny, cell)) return false;
    }
    return true;
  };
  const originals = new Map();
  for (const [tile, meta] of Object.entries(dungeon.tiles || {})) {
    if (shapes.includes(meta?.spriteSpec?.voxelShape) && !originals.has(meta.spriteSpec.voxelShape))
      originals.set(meta.spriteSpec.voxelShape, { tile, meta });
  }
  if (!originals.size) return skip('missing-voxel-templates');
  const customTiles = (dungeon.customTiles || []).slice(), tiles = { ...(dungeon.tiles || {}) };
  const variants = new Map(), placed = [], patches = [];
  const tileFor = (shape, variant) => {
    const id = `${shape}:${variant}`;
    if (variants.has(id)) return variants.get(id);
    const original = originals.get(shape);
    if (!original || customTiles.length >= LIMITS.maxCustomTiles) return null;
    const meta = V.biomeProps[shape], type = `${shape}_biome_${variant}`;
    const index = customTiles.length, name = `custom_${type}_${index}`;
    customTiles.push({ type, name, fromBiomeProps: true, fromVegetation: true });
    tiles[name] = { ...original.meta, spriteSpec: { ...original.meta.spriteSpec,
      voxelShape: shape, voxelSeed: `${seed}:biome:${id}`, material: meta.material,
      baseWidth: meta.baseWidth, gridWidth: meta.baseWidth, depth: meta.baseWidth,
      heightRatio: meta.heightRatio, collisionRadius: .18, collisionBlocking: true },
      landmark: { ...original.meta.landmark, type: shape, label: shape.replace(/_/g, ' ') } };
    variants.set(id, name);
    return name;
  };
  // Biomes occupy neighboring geographic bands along one seeded axis. Only shared
  // species mix at a boundary; hot vents and ice never randomly cross an ecotone.
  const angle = rnd() * Math.PI * 2, axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const origin = { x: (w - 1) / 2, y: (h - 1) / 2 };
  const extent = Math.min(96, Math.min(w, h) * .32);
  const regions = profiles.map((profile, i) => {
    const offset = profiles.length === 1 ? 0 : extent * (2 * i / (profiles.length - 1) - 1);
    return { profile, offset, x: Math.round(origin.x + axis.x * offset), y: Math.round(origin.y + axis.y * offset) };
  });
  const regionAt = (x, y) => {
    const projection = (x - origin.x) * axis.x + (y - origin.y) * axis.y;
    const ranked = regions.map(region => ({ region, distance: Math.abs(projection - region.offset) }))
      .sort((a, b) => a.distance - b.distance);
    const near = ranked[1] && ranked[1].distance - ranked[0].distance < 8;
    return { profile: ranked[0].region.profile, neighbor: near ? ranked[1].region.profile : null };
  };
  const clusterCount = Math.min(maxClusters, Math.max(profiles.length, Math.min(8, Math.ceil(before.count / 700))));
  for (let group = 0; group < clusterCount && placed.length < maxProps; group++) {
    const region = regions[group % regions.length];
    let center;
    for (let attempt = 0; attempt < LIMITS.centerAttempts; attempt++) {
      const x = attempt < 24 ? Math.round(region.x + (rnd() - .5) * Math.min(40, w * .5)) : 3 + Math.floor(rnd() * (w - 6));
      const y = attempt < 24 ? Math.round(region.y + (rnd() - .5) * Math.min(40, h * .5)) : 3 + Math.floor(rnd() * (h - 6));
      if (safe(x, y) && regionAt(x, y).profile === region.profile &&
          patches.every(patch => Math.hypot(x - patch.x, y - patch.y) > 12)) { center = { x, y }; break; }
    }
    if (!center) continue;
    const patch = { ...center, profile: region.profile, radius: 7 + Math.floor(rnd() * 3), placed: 0, ecotones: [] };
    const patchLimit = Math.ceil(maxProps / clusterCount);
    for (let attempt = 0; attempt < LIMITS.placementAttempts && patch.placed < patchLimit && placed.length < maxProps; attempt++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * patch.radius;
      const x = Math.round(center.x + Math.cos(a) * r), y = Math.round(center.y + Math.sin(a) * r);
      if (!safe(x, y)) continue;
      const local = regionAt(x, y);
      if (local.profile !== patch.profile) continue;
      let species = shapes.filter(shape => originals.has(shape) && V.biomeProps[shape].biomes.includes(local.profile));
      if (local.neighbor) {
        const shared = species.filter(shape => V.biomeProps[shape].biomes.includes(local.neighbor));
        if (shared.length) species = shared;
      }
      if (!species.length) continue;
      const shape = species[Math.floor(rnd() * species.length)], meta = V.biomeProps[shape];
      const variant = Math.floor(rnd() * LIMITS.variantsPerShape);
      const height = Math.round((meta.heightRange[0] + rnd() * (meta.heightRange[1] - meta.heightRange[0])) * 100) / 100;
      const cell = dungeon.cells[`${x},${y}`], floor = nav.floors[x + y * w];
      if (Number.isFinite(cell.ceilHeight) && cell.ceilHeight - floor < height + .15) continue;
      const tile = tileFor(shape, variant);
      if (!tile) continue;
      const i = x + y * w;
      blocked[i] = 1; nav.passable[i] = 0;
      placed.push({ key: `${x},${y}`, shape, tile, variant, height, patch: patches.length,
        profile: local.profile, ecotone: local.neighbor });
      patch.placed++;
      if (local.neighbor && !patch.ecotones.includes(local.neighbor)) patch.ecotones.push(local.neighbor);
    }
    if (patch.placed) patches.push(patch);
  }
  const after = reachable(nav, start);
  const conserved = after.count === before.count - placed.length &&
    before.seen.every((seen, i) => !seen || blocked[i] || after.seen[i]);
  if (!conserved) return dungeon.sceneBiomeProps = { version: VERSION, status: 'rejected', reason: 'connectivity-changed',
    attempted: placed.length, placed: 0, reachableBefore: before.count, reachableAfter: after.count };
  if (!placed.length) return dungeon.sceneBiomeProps = { ...skip('no-safe-sites-or-tile-budget'), profiles,
    maxProps, maxClusters, reachableBefore: before.count, reachableAfter: after.count };
  // Commit only once, preserving the custom array shared with the room finalizer.
  dungeon.customTiles ||= [];
  dungeon.customTiles.push(...customTiles.slice(dungeon.customTiles.length));
  dungeon.tiles = tiles;
  const counts = {};
  for (const p of placed) {
    dungeon.cells[p.key] = { ...dungeon.cells[p.key], tile: p.tile, feature: p.tile,
      structureHeight: p.height, biomePropRole: p.shape, biomePropPatch: p.patch };
    counts[p.shape] = (counts[p.shape] || 0) + 1;
  }
  return dungeon.sceneBiomeProps = { version: VERSION, status: 'built', profiles, counts, patches,
    regions, axis, origin, placed: placed.length, meshVariants: variants.size, maxProps, maxClusters,
    variantsPerShape: LIMITS.variantsPerShape, organicExcluded,
    reachableBefore: before.count, reachableAfter: after.count };
}

module.exports = { prepareSceneBiomeProps, applySceneBiomeProps, VERSION, LIMITS,
  biomeProps: V.biomeProps, biomeShapes: V.biomeShapes };
