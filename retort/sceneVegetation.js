'use strict';
const V = require('../assets/scenePropVoxels');
const { makeNavigation, reachable } = require('./sceneArchitecture');
const VERSION = 1;

function prepareSceneVegetation(spec = {}, options = {}) {
  const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''} ${spec.source?.puzzle || ''} ${(spec.level?.layoutFeatures || []).join(' ')}`.toLowerCase();
  const profile = /grove|forest|woodland|thicket|overgrown/.test(text) ? 'grove' :
    /mire|swamp|marsh|river|stream|wetland/.test(text) ? 'wetland' :
    /lava|volcanic|furnace|ember|scorched/.test(text) ? 'scorched' :
    /sand dune|desert|sandstorm/.test(text) ? 'arid' : 'wasteland';
  const enabled = options.enabled !== false && spec.indoor === false &&
    !/\b(barren of vegetation|no trees|treeless|no plants|without vegetation)\b/.test(text);
  spec.vegetationPlan = { version: VERSION, enabled, profile,
    evidence: /tree|grove|thorn|bramble|forest|reeds/.test(text) ? 'description' : 'outdoor-biome',
    species: V.deadTrees, scrub: V.scrubShapes, variantsPerSpecies: 4, maxPlants: profile === 'grove' ? 144 : profile === 'arid' ? 64 : 112 };
  if (!enabled) return spec.vegetationPlan;
  spec.landmarks ||= [];
  for (const type of [...V.deadTrees, ...V.scrubShapes]) {
    if (!spec.landmarks.some(l => l.type === type)) spec.landmarks.push({ type, label: type.replace(/_/g, ' '),
      count: 1, condition: [], placement: 'groves', fromVegetation: true });
  }
  return spec.vegetationPlan;
}

function applySceneVegetation(dungeon, spec = {}) {
  if (dungeon.sceneVegetation) return dungeon.sceneVegetation;
  const plan = spec.vegetationPlan;
  const { width: w, height: h } = dungeon.layout || {};
  if (!plan?.enabled || !dungeon.start || !(w > 12 && h > 12 && w <= 512 && h <= 512))
    return { status: 'skipped', reason: 'no-outdoor-vegetation-plan' };
  const nav = makeNavigation(dungeon), before = reachable(nav, dungeon.start);
  if (!before.count) return { status: 'skipped', reason: 'unreachable-spawn' };
  const rnd = V.random(`${spec.generation?.seed || spec.textHash || dungeon.geoKey}:vegetation`);
  const customTiles = (dungeon.customTiles || []).slice(), tiles = { ...(dungeon.tiles || {}) };
  const blocked = new Set(), occupied = new Set(), placed = [], variants = new Map();
  for (const object of dungeon.sceneObjects || []) occupied.add(`${object.x},${object.y}`);
  const safe = (x, y) => {
    if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3 || Math.hypot(x - dungeon.start.x, y - dungeon.start.y) < 5) return false;
    const floor = nav.floors[x + y * w];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const key = `${x + dx},${y + dy}`, c = dungeon.cells[key];
      if (!c || c.tile !== 'floor' || c.feature || c.roof || c.navigationReserved || c.architectureRole || c.complexExit ||
          c.exit || c.door || c.interactable || c.blocked || c.obstacle || occupied.has(key) || blocked.has(key) ||
          !before.seen[x + dx + (y + dy) * w] || Math.abs((c.floorHeight || 0) - floor) > 0.5) return false;
    }
    return true;
  };
  const tileFor = (shape, variant) => {
    const id = `${shape}:${variant}`;
    if (variants.has(id)) return variants.get(id);
    const original = Object.entries(tiles).find(([, meta]) => meta.spriteSpec?.voxelShape === shape);
    if (!original || customTiles.length >= 232) return null;
    const type = `${shape}_branch_${variant}`, index = customTiles.length, name = `custom_${type}_${index}`;
    const seed = `${spec.generation?.seed || spec.textHash || dungeon.geoKey}:${id}`;
    const meta = original[1];
    customTiles.push({ type, name, fromVegetation: true });
    tiles[name] = { ...meta, spriteSpec: { ...meta.spriteSpec, voxelSeed: seed },
      landmark: { ...meta.landmark, type: shape, label: shape.replace(/_/g, ' ') } };
    variants.set(id, name);
    return name;
  };
  const radius = Math.min(112, Math.max(w, h) * 0.4);
  const clusterCount = Math.min(14, Math.max(3, Math.floor(before.count / 800)));
  const patches = [];
  // Sites are sampled in clumps, not a uniform carpet; work is capped independently of map size.
  for (let group = 0; group < clusterCount; group++) {
    let center;
    for (let attempt = 0; attempt < 40; attempt++) {
      const a = rnd() * Math.PI * 2, r = 9 + rnd() * Math.max(1, Math.min(radius, group < 7 ? 48 : radius) - 9);
      const x = Math.round(dungeon.start.x + Math.cos(a) * r), y = Math.round(dungeon.start.y + Math.sin(a) * r);
      if (safe(x, y)) { center = { x, y }; break; }
    }
    if (!center) continue;
    const patch = { ...center, profile: plan.profile, trees: 0, scrub: 0 };
    const patchLimit = Math.ceil(plan.maxPlants / clusterCount);
    for (let attempt = 0; attempt < 80 && patch.trees + patch.scrub < patchLimit && placed.length < plan.maxPlants; attempt++) {
      const x = Math.round(center.x + (rnd() - 0.5) * 24), y = Math.round(center.y + (rnd() - 0.5) * 24);
      if (!safe(x, y)) continue;
      const isTree = rnd() < (plan.profile === 'grove' ? 0.65 : 0.5);
      const species = isTree ? plan.species : plan.profile === 'wetland' ? ['ash_reeds', 'bramble_patch', 'thorn_bush'] : ['thorn_bush', 'bramble_patch'];
      // Rotate the first tree in each patch through the seven silhouettes, then vary freely.
      const shape = species[isTree && patch.trees === 0 ? group % species.length : Math.floor(rnd() * species.length)];
      const variant = Math.floor(rnd() * plan.variantsPerSpecies), tile = tileFor(shape, variant);
      if (!tile) continue;
      const key = `${x},${y}`;
      const height = isTree ? 3.2 + rnd() * 2.6 : 0.45 + rnd() * 0.6;
      blocked.add(key); nav.passable[x + y * w] = 0;
      placed.push({ key, shape, tile, variant, height: Math.round(height * 100) / 100, patch: patches.length });
      patch[isTree ? 'trees' : 'scrub']++;
    }
    if (patch.trees + patch.scrub) patches.push(patch);
  }
  const after = reachable(nav, dungeon.start);
  // Conservative navigation treats each trunk cell as solid, even when voxel gaps permit passage.
  if (after.count !== before.count - placed.length) {
    return dungeon.sceneVegetation = { version: VERSION, status: 'rejected', reason: 'connectivity-changed', profile: plan.profile,
      attempted: placed.length, reachableBefore: before.count, reachableAfter: after.count };
  }
  const counts = {};
  // Preserve the shared custom tile array used by the room finalizer, but only on commit.
  dungeon.customTiles ||= [];
  dungeon.customTiles.push(...customTiles.slice(dungeon.customTiles.length));
  dungeon.tiles = tiles;
  for (const p of placed) {
    dungeon.cells[p.key] = { ...dungeon.cells[p.key], tile: p.tile, feature: p.tile, structureHeight: p.height, vegetationRole: p.shape };
    counts[p.shape] = (counts[p.shape] || 0) + 1;
  }
  return dungeon.sceneVegetation = { version: VERSION, status: placed.length ? 'built' : 'skipped',
    profile: plan.profile, evidence: plan.evidence, counts, patches, placed: placed.length,
    meshVariants: variants.size, maxPlants: plan.maxPlants, reachableBefore: before.count, reachableAfter: after.count };
}
module.exports = { prepareSceneVegetation, applySceneVegetation };
