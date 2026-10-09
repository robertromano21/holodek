const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const shapes = require('../assets/scenePropVoxels');

test('solid scenery has deterministic volume, depth and non-box silhouettes', () => {
  for (const shape of ['dead_tree', 'tomb', 'furnace']) {
    for (const size of [8, 16, 32]) {
      const grid = shapes.build(shape, size);
      assert.deepEqual(grid, shapes.build(shape, size));
      const layers = Array.from({ length: size }, (_, z) => grid.slice(z * size ** 2, (z + 1) * size ** 2).reduce((a, b) => a + b, 0));
      assert.ok(layers[0] > 0, `${shape} must be grounded`);
      assert.ok(layers.at(-1) > 0);
      assert.ok(new Set(layers).size > 2);
      const ys = new Set();
      grid.forEach((v, i) => { if (v) ys.add(Math.floor(i / size) % size); });
      assert.ok(ys.size > size / 2, `${shape} must have actual depth`);
      const volume = grid.reduce((a, b) => a + b, 0);
      const minimum = shape === 'dead_tree' ? size ** 2 * .5 : size ** 2;
      assert.ok(volume > minimum && volume < size ** 3 * 0.7, `${shape}: slender branches remain volumetric`);
    }
  }
});

test('furnace has an open mouth, back wall and hollow chimney', () => {
  const grid = shapes.build('furnace', 16);
  const at = (x, y, z) => grid[x + y * 16 + z * 256];
  assert.equal(at(8, 2, 5), 0);
  assert.equal(at(8, 13, 5), 1);
  assert.equal(at(12, 11, 15), 0);
  assert.equal(at(9, 11, 15), 1);
});

test('existing GPU renderer consumes the shapes without changing legacy props', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/rendererWebGL.js'), 'utf8');
  const context = { window: { ScenePropVoxels: shapes }, console, clearTimeout };
  vm.runInNewContext(source, context);
  const renderer = context.window.webglDungeonRenderer;
  const dungeon = { tiles: { custom_tree_0: { spriteSpec: { voxelShape: 'dead_tree' } }, pillar: {} } };
  assert.deepEqual(renderer.buildVoxelGrid('custom_tree_0', dungeon), shapes.build('dead_tree'));
  const legacy = Array.from(renderer.buildVoxelGrid('pillar', dungeon));
  dungeon.tiles.pillar.spriteSpec = { voxelShape: 'unsupported' };
  assert.deepEqual(Array.from(renderer.buildVoxelGrid('pillar', dungeon)), legacy);
  assert.equal(shapes.build('unsupported'), null);
  assert.throws(() => shapes.build('tomb', 1024), RangeError);
});
