'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const V = require('../assets/scenePropVoxels');
const { prepareSceneBiomeProps: prepare, applySceneBiomeProps: apply, LIMITS, biomeProps } = require('../retort/sceneBiomeProps');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const copy = data => JSON.parse(JSON.stringify(data));

function spec(description, seed = 'a', extra = {}) {
  const s = { indoor: false, generation: { seed }, source: { roomName: 'Test landscape', description }, ...extra };
  prepare(s);
  return s;
}

function room(s, size = 96) {
  const d = { geoKey: 'test,0,0', layout: { width: size, height: size },
    start: { x: Math.floor(size / 2), y: Math.floor(size / 2) }, cells: {}, tiles: {}, customTiles: [] };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    d.cells[`${x},${y}`] = { tile: x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 'wall' : 'floor',
      floorHeight: x * .035 + y * .02, ceilHeight: 8 + x * .035 + y * .02 };
  }
  for (const lm of s.landmarks || []) {
    const meta = V.biomeProps[lm.type];
    if (!meta) continue;
    const index = d.customTiles.length, tile = `custom_${lm.type}_${index}`;
    d.customTiles.push({ type: lm.type, name: tile });
    d.tiles[tile] = { url: `/fixtures/${meta.drawer}.png`, spriteSpec: { voxelShape: lm.type, ...meta },
      landmark: { type: lm.type, label: lm.label } };
  }
  return d;
}

function checkConservation(d, prior, report) {
  const before = reachable(makeNavigation(prior), prior.start), after = reachable(makeNavigation(d), d.start);
  assert.equal(after.count, before.count - report.placed);
  let changed = 0;
  for (const [key, original] of Object.entries(prior.cells)) {
    const cell = d.cells[key], [x, y] = key.split(',').map(Number), i = x + y * d.layout.width;
    assert.equal(cell.floorHeight, original.floorHeight, key);
    assert.equal(cell.ceilHeight, original.ceilHeight, key);
    if (cell.biomePropRole) {
      changed++;
      assert.equal(original.tile, 'floor');
      assert.equal(before.seen[i], 1, key);
      assert.equal(cell.feature, cell.tile);
      const meta = d.tiles[cell.tile].spriteSpec;
      assert.equal(meta.voxelShape, cell.biomePropRole);
      assert.ok(meta.baseWidth <= 1);
      assert.equal(meta.collisionBlocking, true);
      assert.ok(cell.structureHeight > 0 && cell.structureHeight < cell.ceilHeight - cell.floorHeight);
    } else {
      assert.deepEqual(cell, original, key);
      if (before.seen[i]) assert.equal(after.seen[i], 1, `isolated previously reachable cell ${key}`);
    }
  }
  assert.equal(changed, report.placed);
}

test('22 catalog entries expose bounded natural geometry metadata and stable selection', () => {
  assert.equal(V.biomeShapes.length, 22);
  assert.equal(biomeProps, V.biomeProps);
  assert.ok(Object.isFrozen(biomeProps));
  for (const shape of V.biomeShapes) {
    const m = biomeProps[shape];
    assert.ok(V.shapes.includes(shape));
    assert.ok(m.drawer && m.material && m.biomes.length && typeof m.organic === 'boolean', shape);
    assert.equal(m.variants, LIMITS.variantsPerShape);
    assert.ok(m.baseWidth > .2 && m.baseWidth <= 1 && m.heightRange[0] > 0 && m.heightRange[1] >= m.heightRange[0]);
    assert.equal(V.select(shape), shape);
    assert.equal(V.select(`custom_${shape}_biome_2_35`), shape);
    assert.equal(V.usesRoomPalette(shape), false, 'natural shapes must not get masonry bonds');
    for (const textures of [false, true]) {
      const color = V.color(shape, .3, .4, .7, [0, 0, 1], [.5, .5, .5], m.material, { textures });
      assert.ok(color.every(c => Number.isFinite(c) && c >= 0 && c <= 1), shape);
    }
  }
  for (const legacy of ['scree', 'roots', 'stump', 'boulder', 'arch', 'dead_willow', 'wind_bent_tree']) {
    assert.ok(V.build(legacy));
    assert.equal(V.select(legacy), legacy);
  }
  assert.equal(V.select('fallen_log'), 'stump', 'legacy aliases are unchanged');
});

test('real meshes are grounded, non-box, repeatable and distinct across shapes and seeded variants', () => {
  const seen = new Set();
  for (const shape of V.biomeShapes) {
    const variants = new Set();
    for (const seed of ['a', 'b', 'c']) {
      const grid = V.build(shape, 16, seed), fingerprint = hash(grid);
      assert.deepEqual(grid, V.build(shape, 16, seed));
      assert.ok(!seen.has(fingerprint), `${shape}:${seed} is a genuinely distinct silhouette`);
      seen.add(fingerprint); variants.add(fingerprint);
      assert.ok(grid.every(v => v === 0 || v === 1));
    }
    assert.equal(variants.size, 3);
    for (const size of [8, 16, 32]) {
      const grid = V.build(shape, size, 'a'), filled = grid.reduce((n, v) => n + v, 0);
      assert.equal(grid.length, size ** 3);
      assert.ok(grid.slice(0, size * size).some(Boolean), `${shape} at ${size} has a base`);
      assert.ok(filled > 15 && filled < size ** 3 * .7, `${shape}: volume=${filled}`);
      const layers = Array.from({ length: size }, (_, z) => grid.slice(z * size ** 2, (z + 1) * size ** 2).reduce((n, v) => n + v, 0));
      assert.ok(new Set(layers).size >= 3, `${shape} has real height variation`);
    }
  }
  const at = (shape, x, y, z) => V.build(shape, 16, 'a')[x + y * 16 + z * 256];
  assert.equal(at('hollow_log', 2, 8, 5), 0, 'log has a real bore');
  assert.equal(at('wind_carved_arch', 8, 8, 5), 0, 'arch has an open passage');
  assert.equal(at('fumarole_vent', 8, 8, 4), 0, 'vent throat is hollow');
  assert.equal(at('mineral_cone', 8, 8, 8), 0, 'mineral cone has an open chimney');
  assert.equal(at('toadstool_ring', 8, 8, 4), 0, 'fungal ring has an open center');
  assert.notEqual(hash(V.build('glacial_erratic')), hash(V.build('boulder')));
});

test('browser export includes exactly the same catalog and meshes', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/scenePropVoxels'), 'utf8'), context);
  const browser = context.window.ScenePropVoxels;
  assert.deepEqual(Array.from(browser.biomeShapes), V.biomeShapes);
  for (const shape of V.biomeShapes) assert.deepEqual(Array.from(browser.build(shape, 16, 'browser')), Array.from(V.build(shape, 16, 'browser')));
});

test('the unchanged renderer and collision consume the new saved voxel seeds', () => {
  const C = require('../assets/voxelCollision');
  const context = { window: { ScenePropVoxels: V }, console, clearTimeout };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8'), context);
  for (const shape of ['hollow_log', 'fumarole_vent', 'ice_spires', 'buttress_roots']) {
    const d = { tiles: { custom_prop: { spriteSpec: { voxelShape: shape, voxelSeed: 'saved-biome', baseWidth: 1 } } },
      cells: { '0,0': { tile: 'custom_prop', floorHeight: 0, ceilHeight: 1, structureHeight: 1 } } };
    const grid = V.build(shape, 16, 'saved-biome');
    assert.deepEqual(context.window.webglDungeonRenderer.buildVoxelGrid('custom_prop', d), grid);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      assert.equal(C.testCell(d, 0, 0, (x + .5) / 16, (y + .5) / 16, .002, 8.5 / 16, 1.5, 0).blocked,
        !!grid[x + y * 16 + 8 * 256], `${shape}:${x},${y}`);
    }
  }
});

test('preparation chooses a biome subset, preserves authored landmarks, and is idempotent', () => {
  const s = spec('Eroded sandstone badlands.');
  const plan = s.biomePropsPlan;
  assert.deepEqual(plan.profiles, ['badlands']);
  assert.ok(plan.shapes.length >= 6 && plan.shapes.length < V.biomeShapes.length);
  assert.ok(s.landmarks.every(l => l.fromBiomeProps && l.fromVegetation && l.prim && V.select(l.type) === l.type));
  const snapshot = copy(s);
  prepare(s); assert.deepEqual(s, snapshot);
  const authored = { type: 'hollow_log', count: 2, placement: 'named-site' };
  s.landmarks.push(authored);
  s.source.description = 'A woodland garden.';
  prepare(s);
  assert.equal(s.landmarks.filter(l => l.type === 'hollow_log').length, 1);
  assert.equal(s.landmarks.find(l => l.type === 'hollow_log'), authored);
  assert.ok(!s.landmarks.some(l => l.fromBiomeProps && l.type === 'eroded_hoodoo'));
  prepare(s, { enabled: false });
  assert.deepEqual(s.landmarks, [authored]);
});

test('single and mixed profile selection uses source, biome, floor and level clues without priority masking', () => {
  for (const [description, profile] of [['A basalt geothermal field.', 'volcanic'], ['A frozen glacier.', 'icy'],
    ['A forest garden.', 'forest'], ['A marsh beside a river.', 'wetland']]) {
    assert.deepEqual(spec(description).biomePropsPlan.profiles, [profile]);
  }
  const mixed = spec('Eroded badlands meet a fungal forest at a marsh, below frozen ridges with geothermal vents.');
  assert.deepEqual(mixed.biomePropsPlan.profiles, ['badlands', 'volcanic', 'forest', 'wetland', 'icy']);
  assert.equal(mixed.biomePropsPlan.profile, 'mixed');
  assert.equal(mixed.biomePropsPlan.shapes.length, 22);
  assert.deepEqual(spec('', 'a', { biome: 'wetland', floorMaterial: 'ice', level: { layoutFeatures: ['basalt'] } })
    .biomePropsPlan.profiles, ['volcanic', 'wetland', 'icy']);
});

test('explicit vegetation and fungus exclusions filter organic landmarks and placements', () => {
  for (const exclusion of ['treeless', 'no plants', 'without vegetation', 'barren of vegetation', 'no trees']) {
    const s = spec(`A forest beside eroded badlands, ${exclusion}.`);
    assert.ok(s.biomePropsPlan.organicExcluded);
    assert.ok(s.biomePropsPlan.shapes.every(shape => !V.biomeProps[shape].organic));
    const d = room(s), report = apply(d, s);
    assert.equal(report.status, 'built');
    assert.ok(Object.keys(report.counts).every(shape => !V.biomeProps[shape].organic));
  }
  const s = spec('A forest with no fungi.');
  assert.ok(!s.biomePropsPlan.shapes.includes('shelf_fungi') && !s.biomePropsPlan.shapes.includes('toadstool_ring'));
  const disabled = spec('A forest beside a wetland.', 'off');
  disabled.vegetationPlan = { enabled: false };
  const d = room(disabled), report = apply(d, disabled);
  assert.equal(report.status, 'built');
  assert.ok(report.organicExcluded && Object.keys(report.counts).every(shape => !V.biomeProps[shape].organic));
  prepare(disabled);
  assert.ok(disabled.biomePropsPlan.organicExcluded && disabled.biomePropsPlan.shapes.every(shape => !V.biomeProps[shape].organic));
});

test('seeded clustered placement replays exactly and retains every other reachable floor', () => {
  const s = spec('A forest garden beside a river marsh.');
  const a = room(s), b = room(s), prior = copy(a), shared = a.customTiles;
  const report = apply(a, s);
  assert.equal(report.status, 'built', JSON.stringify(report));
  assert.ok(report.placed >= 25 && report.placed <= LIMITS.maxProps, JSON.stringify(report));
  assert.deepEqual(apply(b, s), report);
  assert.deepEqual(a, b);
  assert.equal(a.customTiles, shared, 'finalizer keeps its original array reference');
  checkConservation(a, prior, report);
  assert.ok(report.patches.length <= LIMITS.maxClusters);
  assert.ok(report.meshVariants <= V.biomeShapes.length * 3);
  for (const [key, cell] of Object.entries(a.cells)) {
    if (!cell.biomePropRole) continue;
    const [x, y] = key.split(',').map(Number), patch = report.patches[cell.biomePropPatch];
    assert.ok(Math.hypot(x - patch.x, y - patch.y) <= patch.radius + 1);
    assert.ok(V.biomeProps[cell.biomePropRole].biomes.includes(patch.profile));
  }
  const saved = copy(a), snapshot = copy(saved);
  assert.deepEqual(apply(saved, spec('An icy wasteland.', 'different')), report);
  assert.deepEqual(saved, snapshot, 'saved compiled room never changes');
});

test('different seeds vary sites, bounded mesh variants and heights', () => {
  const outcomes = new Set(), geometry = new Set();
  for (const seed of ['a', 'b', 'c', 'd', 0]) {
    const s = spec('Badlands, volcanic basalt and ice formations.', seed), d = room(s);
    const prior = copy(d), report = apply(d, s);
    assert.equal(report.status, 'built');
    checkConservation(d, prior, report);
    outcomes.add(hash(JSON.stringify(d.cells)));
    for (const c of Object.values(d.cells)) if (c.biomePropRole) {
      const m = d.tiles[c.tile].spriteSpec;
      geometry.add(hash(V.build(m.voxelShape, 16, m.voxelSeed)));
    }
  }
  assert.equal(outcomes.size, 5);
  assert.ok(geometry.size > 40);
});

test('mixed biomes occupy coherent bands, including shared-species ecotones, rather than global scatter', () => {
  const s = spec('A forest meets a river wetland.'), d = room(s), report = apply(d, s);
  assert.equal(report.status, 'built');
  assert.ok(report.patches.some(p => p.profile === 'forest') && report.patches.some(p => p.profile === 'wetland'));
  assert.ok(report.patches.some(p => p.ecotones.length), 'boundary patches record ecotones');
  for (const [key, cell] of Object.entries(d.cells)) {
    if (!cell.biomePropRole) continue;
    const [x, y] = key.split(',').map(Number), p = report.patches[cell.biomePropPatch];
    const projected = (x - report.origin.x) * report.axis.x + (y - report.origin.y) * report.axis.y;
    const sorted = report.regions.map(r => ({ ...r, distance: Math.abs(projected - r.offset) })).sort((a, b) => a.distance - b.distance);
    assert.equal(p.profile, sorted[0].profile);
    if (sorted[1].distance - sorted[0].distance < 8) assert.ok(V.biomeProps[cell.biomePropRole].biomes.includes(sorted[1].profile));
  }
  const all = spec('Badlands border volcanic terrain, forests, marshes and a frozen glacier.', 'all');
  const big = room(all, 192), mixed = apply(big, all);
  assert.equal(mixed.status, 'built');
  assert.equal(new Set(mixed.patches.map(p => p.profile)).size, 5);
});

test('routes, foundations, supports, structures, doors, fixtures and scene objects get untouched buffers', () => {
  const s = spec('A forest beside a river marsh.'), d = room(s);
  const protectedKeys = [];
  for (let y = 1; y < 95; y++) for (const x of [30, 65]) {
    const key = `${x},${y}`; d.cells[key].navigationReserved = true; protectedKeys.push(key);
  }
  for (const [i, field] of ['outdoorFoundation', 'foundation', 'support', 'roof', 'exit', 'door', 'interactable', 'feature',
    'architectureRole', 'vegetationExcluded', 'noVegetation', 'biomePropsExcluded', 'object'].entries()) {
    const x = 12 + i * 5, key = `${x},25`;
    d.cells[key][field] = field === 'architectureRole' ? 'roof-support' : true;
    protectedKeys.push(key);
  }
  d.sceneObjects = [{ x: 50.5, y: 70.5, name: 'rope' }]; protectedKeys.push('50,70');
  d.sceneStructures = [{ position: { x: 10, y: 60, z: 0 }, size: { x: 6, y: 6, z: 4 } }];
  for (let y = 60; y < 66; y++) for (let x = 10; x < 16; x++) protectedKeys.push(`${x},${y}`);
  const prior = copy(d), report = apply(d, s);
  assert.equal(report.status, 'built');
  checkConservation(d, prior, report);
  for (const key of protectedKeys) {
    const [x, y] = key.split(',').map(Number);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      assert.ok(!d.cells[`${x + dx},${y + dy}`]?.biomePropRole, `buffer around ${key}`);
    }
  }
});

test('indoor placement is fresh, explicit, roofless and confined to demonstrated garden cells', () => {
  for (const description of ['A frozen temple.', 'A chamber with a painted forest.', 'A woodland.']) {
    const s = spec(description, 'a', { indoor: true }), d = room(s), prior = copy(d);
    assert.equal(s.biomePropsPlan.enabled, false);
    assert.equal(apply(d, s).status, 'skipped'); assert.deepEqual(d, prior);
  }
  const s = spec('An indoor garden court with fungi and roots.', 'garden', { indoor: true }), d = room(s, 64);
  assert.equal(s.biomePropsPlan.maxProps, 16);
  const empty = copy(d);
  assert.equal(apply(empty, s).placed, 0, 'text alone is not a demonstrably safe garden');
  d.sceneArchitecture = { zones: [{ role: 'courtyard', x: 8, y: 8, width: 25, height: 25 }] };
  for (let y = 8; y < 33; y++) for (let x = 8; x < 33; x++) d.cells[`${x},${y}`].architectureRole = 'courtyard';
  d.cells['18,18'].roof = { height: 6 };
  const prior = copy(d), report = apply(d, s);
  assert.equal(report.status, 'built', JSON.stringify(report));
  assert.ok(report.placed > 0 && report.placed <= 16);
  checkConservation(d, prior, report);
  for (const [key, c] of Object.entries(d.cells)) if (c.biomePropRole) {
    const [x, y] = key.split(',').map(Number);
    assert.ok(x >= 10 && y >= 10 && x <= 30 && y <= 30);
    assert.equal(c.architectureRole, 'courtyard');
  }
});

test('unsafe, unreachable, steep and saved rooms are not modified', () => {
  const s = spec('Frozen badlands.');
  for (const alter of [d => { d.saved = true; }, d => { d.sceneSpec = { version: 1 }; },
    d => { d.classification = { indoor: true }; },
    d => { d.start.x = -1; }, d => { d.layout.width = 513; }, d => { d.cells['48,48'].tile = 'wall'; },
    d => { for (const c of Object.values(d.cells)) c.outdoorFoundation = true; },
    d => { for (const c of Object.values(d.cells)) c.ceilHeight = c.floorHeight + .15; },
    d => { for (const [key, c] of Object.entries(d.cells)) c.floorHeight = Number(key.split(',')[0]) % 2 * 3; }]) {
    const d = room(s); alter(d); const prior = copy(d), report = apply(d, s);
    assert.equal(report.status, 'skipped');
    assert.deepEqual(d.cells, prior.cells); assert.deepEqual(d.tiles, prior.tiles); assert.deepEqual(d.customTiles, prior.customTiles);
  }
  const d = room(s);
  for (let y = 1; y < 95; y++) d.cells[`60,${y}`].tile = 'wall';
  const prior = copy(d), report = apply(d, s);
  assert.equal(report.status, 'built'); checkConservation(d, prior, report);
  for (let y = 1; y < 95; y++) for (let x = 61; x < 95; x++) assert.deepEqual(d.cells[`${x},${y}`], prior.cells[`${x},${y}`]);
});

test('placement, cluster and tile budgets stay capped even with oversized plan values', () => {
  const s = spec('Badlands, forests, volcanic basalt, icy shores and wetlands.');
  prepare(s, { maxProps: 10000, maxClusters: 10000 });
  assert.equal(s.biomePropsPlan.maxProps, LIMITS.maxProps);
  assert.equal(s.biomePropsPlan.maxClusters, LIMITS.maxClusters);
  for (const budget of [LIMITS.maxCustomTiles, LIMITS.maxCustomTiles - 1, LIMITS.maxCustomTiles - 4]) {
    const d = room(s), shared = d.customTiles;
    while (d.customTiles.length < budget) d.customTiles.push({ type: 'authored-fixture' });
    s.biomePropsPlan.maxProps = 10000; s.biomePropsPlan.maxClusters = 10000;
    const prior = copy(d), report = apply(d, s);
    assert.ok(d.customTiles.length <= LIMITS.maxCustomTiles);
    assert.equal(d.customTiles, shared);
    assert.ok(report.placed <= LIMITS.maxProps && (report.patches?.length || 0) <= LIMITS.maxClusters);
    assert.ok((report.meshVariants || 0) <= LIMITS.maxCustomTiles - budget);
    checkConservation(d, prior, report);
  }
  const zero = spec('A forest.'); prepare(zero, { maxProps: 0 });
  const d = room(zero), prior = copy(d);
  assert.equal(apply(d, zero).reason, 'zero-budget'); assert.deepEqual(d, prior);
  const noTemplates = room(zero); noTemplates.tiles = {}; zero.biomePropsPlan.maxProps = 12;
  assert.equal(apply(noTemplates, zero).reason, 'missing-voxel-templates');
});

test('navigation rejection rolls back staged cells and custom meshes as one batch', () => {
  const source = fs.readFileSync(require.resolve('../retort/sceneBiomeProps'), 'utf8');
  let calls = 0;
  const context = { module: { exports: {} }, require: name => name.includes('scenePropVoxels') ? V : {
    makeNavigation, reachable: (nav, start) => {
      const result = reachable(nav, start);
      if (++calls === 2) result.count--;
      return result;
    }
  } };
  vm.runInNewContext(source, context);
  const s = spec('A forest garden.'), d = room(s), prior = copy(d), shared = d.customTiles;
  const report = context.module.exports.applySceneBiomeProps(d, s);
  assert.equal(report.status, 'rejected'); assert.ok(report.attempted > 0);
  assert.deepEqual(d.cells, prior.cells); assert.deepEqual(d.tiles, prior.tiles); assert.deepEqual(d.customTiles, prior.customTiles);
  assert.equal(d.customTiles, shared);
});
