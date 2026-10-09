const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const V = require('../assets/scenePropVoxels');
const C = require('../assets/voxelCollision');
const { prepareSceneVegetation, applySceneVegetation } = require('../retort/sceneVegetation');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const Exits = require('../assets/dungeonExits');
const { buildEnvironment } = require('../assets/dungeonEnvironment');
function room(size = 128) {
  const d = { geoKey: '1,0,0', layout: { width: size, height: size }, start: { x: size / 2, y: size / 2 }, tiles: {}, customTiles: [], cells: {} };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d.cells[`${x},${y}`] = { tile: x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 2.5 };
  for (const shape of [...V.deadTrees, ...V.scrubShapes]) {
    const index = d.customTiles.length, tile = `custom_${shape}_${index}`;
    d.customTiles.push({ type: shape, name: tile });
    d.tiles[tile] = { spriteSpec: { voxelShape: shape, ...V.vegetation[shape] }, landmark: { type: shape, label: shape } };
  }
  return d;
}
test('seven new leafless silhouettes use deterministic procedural branches, not recolors', () => {
  assert.equal(V.deadTrees.length, 7);
  const seen = new Set();
  for (const shape of V.deadTrees) for (const seed of ['a', 'b', 'c', 'd']) {
    const grid = V.build(shape, 16, seed);
    assert.deepEqual(grid, V.build(shape, 16, seed));
    const hash = crypto.createHash('sha256').update(grid).digest('hex');
    assert.ok(!seen.has(hash), `${shape}:${seed}`); seen.add(hash);
    assert.ok(grid.some(Boolean) && grid.some(v => !v));
  }
});

test('leafless crowns stay slender and open at the existing 16-cube resolution', () => {
  for (const shape of [...V.deadTrees, 'dead_tree', 'bone_tree', 'charred_tree']) for (const seed of ['a', 'b', 'c', 'd']) {
    const grid = V.build(shape, 16, seed);
    const crown = grid.slice(7 * 256), count = crown.reduce((n, v) => n + v, 0);
    assert.ok(count > 40 && count < 240, `${shape}:${seed} retains an open branching crown (${count})`);
    assert.equal(grid.length, 16 ** 3, 'No increase in renderer or collision resolution');
    for (let z = 7; z < 16; z++) for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
      let filled = 0;
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) filled += grid[x + dx + (y + dy) * 16 + z * 256];
      assert.ok(filled < 9, `${shape}:${seed} has no solid 3x3 branch blocks in its upper crown`);
    }
  }
});
test('saved branch seeds drive both real voxel geometry and body collision', () => {
  for (const seed of ['a', 'b', 'c', 'd']) {
    const shape = 'wind_bent_tree', grid = V.build(shape, 16, seed);
    const d = { tiles: { custom_tree: { spriteSpec: { voxelShape: shape, voxelSeed: seed, baseWidth: 1 } } },
      cells: { '0,0': { tile: 'custom_tree', floorHeight: 0, ceilHeight: 1, structureHeight: 1 } } };
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const result = C.testCell(d, 0, 0, (x + 0.5) / 16, (y + 0.5) / 16, 0.002, 8.5 / 16, 1.5, 0);
      assert.equal(result.blocked, !!grid[x + y * 16 + 8 * 256], `${seed}:${x},${y}`);
    }
  }
});
test('outdoor groves are bounded batches that preserve heights, route access, objects and saved rooms', () => {
  const spec = { indoor: false, textHash: 'tartarus', source: { description: 'A dead forest with thorn thickets.' }, exits: ['east', 'north'] };
  const plan = prepareSceneVegetation(spec); assert.equal(plan.profile, 'grove');
  const a = room(), b = room(); a.sceneObjects = b.sceneObjects = [{ x: 70, y: 70, name: 'rope' }];
  for (const d of [a, b]) Exits.install(d, spec.exits);
  const before = reachable(makeNavigation(a), a.start).count;
  const report = applySceneVegetation(a, spec); applySceneVegetation(b, spec);
  assert.equal(report.status, 'built', JSON.stringify(report));
  assert.ok(report.placed > 40 && report.placed <= 144, JSON.stringify(report));
  assert.ok(report.meshVariants <= 40);
  assert.deepEqual(a.cells, b.cells);
  assert.equal(reachable(makeNavigation(a), a.start).count, before - report.placed);
  assert.equal(a.cells['70,70'].tile, 'floor');
  for (const c of Object.values(a.cells)) { assert.equal(c.floorHeight, 0); assert.equal(c.ceilHeight, 2.5); if (c.navigationReserved) assert.equal(c.tile, 'floor'); }
  for (const shape of V.deadTrees) assert.ok(report.counts[shape], `${shape}: ${JSON.stringify(report.counts)}`);
  const saved = JSON.parse(JSON.stringify(a));
  assert.deepEqual(applySceneVegetation(saved, spec), report);
  assert.ok(buildEnvironment(a).cues.some(c => c.text.includes('branches')));
});
test('indoor, explicitly treeless and disabled rooms do not get background trees', () => {
  for (const spec of [{ indoor: true }, { indoor: false, source: { description: 'A treeless desert.' } }]) {
    assert.equal(prepareSceneVegetation(spec).enabled, false);
    const d = room(); const before = JSON.stringify(d.cells); applySceneVegetation(d, spec); assert.equal(JSON.stringify(d.cells), before);
  }
  assert.equal(prepareSceneVegetation({ indoor: false }, { enabled: false }).enabled, false);
});
test('production has vegetation preparation and commit in both generation paths', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  assert.equal((source.match(/prepareSceneVegetation\(sceneSpec,/g) || []).length, 2);
  assert.equal((source.match(/applySceneVegetation\(dungeon, sceneSpec\)/g) || []).length, 2);
});
test('deadwood lab contains actual canonical voxel trees, branch variants, scrub and marked exits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-deadwood-')), prior = process.env.HOLODEK_SPRITE_DIR;
  process.env.HOLODEK_SPRITE_DIR = dir;
  try {
    const { buildEnvironmentLab } = require('../retort/environmentLab');
    const d = buildEnvironmentLab('deadwood');
    assert.equal(d.sceneVegetation.status, 'built');
    for (const shape of V.deadTrees) assert.ok(Object.values(d.cells).some(c => d.tiles[c.tile]?.spriteSpec?.voxelShape === shape), shape);
    assert.equal(d.roomExits.markers.length, 3);
    assert.ok(Object.values(d.cells).some(c => d.tiles[c.tile]?.spriteSpec?.voxelSeed));
  } finally {
    if (prior === undefined) delete process.env.HOLODEK_SPRITE_DIR; else process.env.HOLODEK_SPRITE_DIR = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
