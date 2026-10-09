const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const V = require('../assets/scenePropVoxels');
const M = require('../assets/masonryPatterns');
const { buildAtlas, kind } = require('../assets/voxelMaterials');
const { buildSceneSpec } = require('../retort/sceneSpec');
const { applySceneArchitecture } = require('../retort/sceneArchitecture');
const { applySceneRoofs, roofStyle } = require('../retort/sceneRoofs');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');

test('all voxel shapes are bounded, deterministic and have distinct geometry', () => {
  const geometries = new Map();
  for (const shape of V.shapes) {
    const grid = V.build(shape, 16);
    assert.deepEqual(grid, V.build(shape, 16));
    assert.equal(grid.length, 4096);
    assert.ok(grid.some(v => v === 1) && grid.some(v => v === 0), shape);
    assert.ok(grid.every(v => v === 0 || v === 1));
    // These intentionally share a branching skeleton, differentiated by material.
    if (!['bone_tree', 'charred_tree'].includes(shape)) {
      assert.ok(!geometries.has(hash(grid)), `${shape} duplicates ${geometries.get(hash(grid))}`);
      geometries.set(hash(grid), shape);
    }
    const rgb = V.color(shape, 0.4, 0.3, 0.65, [0, 0, 1], [0.5, 0.5, 0.5], 'stone');
    assert.ok(rgb.length === 3 && rgb.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  }
});

test('material atlas has distinct opaque tiles and correct routing', () => {
  const a = buildAtlas(), b = buildAtlas();
  assert.deepEqual(a, b);
  assert.equal(a.width, (8 + M.names.length) * 32);
  const seen = new Set();
  for (let tile = 0; tile < a.width / 32; tile++) {
    const bytes = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * a.width + tile * 32 + x) * 4;
      assert.equal(a.data[i + 3], 255); bytes.push(a.data[i]);
    }
    seen.add(hash(Buffer.from(bytes)));
  }
  assert.equal(seen.size, a.width / 32);
  assert.equal(kind('charred_tree', 'wood'), 7);
  assert.equal(kind('portcullis', 'metal'), 3);
  for (const [i, name] of M.names.entries()) {
    assert.equal(kind('buttress', name), i + 8);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      assert.equal(M.sample(name, x, y), M.sample(name, x + 32, y + 32));
    }
  }
});

test('roofless prose stays sky; described roofs cover halls but not courtyards', () => {
  assert.equal(roofStyle({ source: { description: 'A roofless temple beneath yellow sky.' } }), null);
  assert.equal(roofStyle({ source: { description: 'There is no roof.' } }), null);
  const spec = buildSceneSpec({ roomName: 'Roman Bathhouse', description: 'A barrel-vaulted hall stands beside an open courtyard.' });
  const dungeon = { layout: { width: 32, height: 32 }, start: { x: 16, y: 26 }, cells: {} };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
  assert.equal(applySceneArchitecture(dungeon, spec).status, 'built');
  const before = Object.fromEntries(Object.entries(dungeon.cells).map(([k, c]) => [k, [c.tile, c.floorHeight, c.ceilHeight]]));
  const roof = applySceneRoofs(dungeon, spec);
  assert.equal(roof.status, 'built'); assert.ok(roof.coveredCells > 0);
  const courtyard = dungeon.sceneArchitecture.zones.find(z => z.role === 'courtyard');
  for (let y = courtyard.y; y < courtyard.y + courtyard.height; y++) for (let x = courtyard.x; x < courtyard.x + courtyard.width; x++) assert.equal(dungeon.cells[`${x},${y}`].roof, undefined);
  const supports = new Set(roof.bays.flatMap(b => b.supports));
  for (const [k, c] of Object.entries(dungeon.cells)) {
    assert.equal(c.floorHeight, before[k][1], 'construction never shifts the ground');
    if (!supports.has(k)) assert.deepEqual([c.tile, c.floorHeight, c.ceilHeight], before[k]);
  }
  assert.equal(applySceneRoofs(dungeon, spec), roof);
  assert.deepEqual(JSON.parse(JSON.stringify(dungeon)).cells, dungeon.cells);
});

test('production builder keeps variants and builds all isolated exhibits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-material-test-'));
  const prior = process.env.HOLODEK_SPRITE_DIR;
  process.env.HOLODEK_SPRITE_DIR = dir;
  try {
    const { buildEnvironmentLab, descriptions } = require('../retort/environmentLab');
    for (const name of Object.keys(descriptions)) {
      const room = buildEnvironmentLab(name);
      assert.ok(Object.values(room.tiles).some(t => t.spriteSpec?.voxelShape), name);
      const types = room.customTiles.map(t => t.type);
      if (name === 'gallery') for (const type of ['oak', 'pine', 'willow', 'cypress', 'bone_tree', 'charred_tree', 'mushroom_tree']) assert.ok(types.includes(type), type);
      if (['castle', 'bathhouse', 'temple', 'gothic', 'rotunda'].includes(name)) {
        assert.equal(room.sceneArchitecture.status, 'built', JSON.stringify(room.sceneArchitecture));
        assert.equal(room.sceneRoof.status, 'built');
      }
      if (['byzantine', 'squinch', 'fan', 'hammerbeam', 'boarded', 'gold', 'groin', 'motte', 'shellkeep',
        'stonekeep', 'concentric', 'amphitheater', 'theater', 'circus', 'forum', 'warehouse', 'domus', 'villa', 'insula', 'aqueduct'].includes(name)) {
        assert.equal(room.sceneArchitecture.status, 'built', `${name}: ${JSON.stringify(room.sceneArchitecture)}`);
        assert.equal(room.sceneRoof.status, 'built', name);
      }
      const requiredShape = { byzantine: 'pendentive_transition', squinch: 'squinch_transition', fan: 'fan_vault_shell',
        hammerbeam: 'hammerbeam_truss', boarded: 'boarded_ceiling', gold: 'gold_coffered_slab', groin: 'groin_vault_shell' }[name];
      if (requiredShape) assert.ok(room.sceneStructures.some(p => p.shape === requiredShape), `${name}: ${requiredShape} missing`);
      if (name === 'citadel') {
        assert.equal(room.sceneArchitecture.family, 'castle');
        assert.equal(room.sceneArchitecture.verticalRoutes.routes.length, 2, JSON.stringify(room.sceneArchitecture.verticalRoutes));
        assert.equal(room.sceneArchitecture.entrances.length, 2);
        assert.ok(room.sceneStructures.some(p => p.role === 'exterior-battlement'));
        assert.ok(Object.values(room.cells).some(c => c.complexExit === 'up' && c.floorHeight > 4));
        assert.ok(Object.values(room.cells).some(c => c.complexExit === 'down' && c.floorHeight < -4));
      }
      if (name === 'geography') {
        assert.equal(room.sceneGeography.status, 'built', JSON.stringify(room.sceneGeography));
        assert.equal(room.sceneGeography.features.length, 2);
        assert.ok(Object.values(room.tiles).some(t => t.spriteSpec?.voxelShape === 'boulder'));
        assert.ok(Object.values(room.tiles).some(t => t.spriteSpec?.voxelShape === 'rock_face'));
      }
      if (name === 'rubble') for (const shape of ['broken_masonry', 'fallen_arch', 'scree']) assert.ok(Object.values(room.tiles).some(t => t.spriteSpec?.voxelShape === shape), shape);
      assert.deepEqual(JSON.parse(JSON.stringify(room)).cells, room.cells);
    }
  } finally {
    if (prior === undefined) delete process.env.HOLODEK_SPRITE_DIR; else process.env.HOLODEK_SPRITE_DIR = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
