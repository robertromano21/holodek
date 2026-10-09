const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const T = require('../assets/terrainCamera');
const dungeon = () => ({ cells: { '1,1': { tile: 'floor', floorHeight: 4 }, '2,1': { tile: 'floor', floorHeight: 3 } } });
const camera = { x: 1.2, y: 1.5, angle: 0, vx: 1, vy: 0 };

test('downhill assist is gentle, bounded, smoothed and decays when the player stops', () => {
  const d = dungeon(), t = T.create(), first = t.update(d, camera, .05);
  assert.ok(first < 0 && first > -.02);
  let shift = first;
  for (let i = 0; i < 50; i++) shift = t.update(d, camera, .05);
  assert.ok(shift < -.05 && shift > -.1);
  d.cells['2,1'].floorHeight = -40;
  for (let i = 0; i < 50; i++) shift = t.update(d, camera, .05);
  assert.ok(shift >= -.1);
  for (let i = 0; i < 80; i++) shift = t.update(d, { ...camera, vx: 0 }, .05);
  assert.equal(shift, 0);
  assert.equal(d.cells['1,1'].floorHeight, 4, 'The camera never alters elevation or collision');
});

test('uphill, strafing, backward movement, blocked drops and disabled assist keep a level view', () => {
  for (const mode of ['uphill', 'flat', 'strafe', 'backward', 'wall', 'disabled', 'invalid']) {
    const d = dungeon(), t = T.create(), c = { ...camera };
    if (mode === 'uphill') d.cells['2,1'].floorHeight = 5;
    if (mode === 'flat') d.cells['2,1'].floorHeight = 4;
    if (mode === 'wall') d.cells['2,1'].tile = 'wall';
    if (mode === 'strafe') { c.vx = 0; c.vy = 1; }
    if (mode === 'backward') c.vx = -1;
    if (mode === 'invalid') c.x = NaN;
    assert.equal(t.update(d, c, .05, mode !== 'disabled'), 0, mode);
  }
  const t = T.create(), d = dungeon(); t.update(d, camera, .05);
  assert.equal(t.update(dungeon(), { ...camera, vx: 0 }, .05), 0, 'New rooms reset old view bias');
  t.update(d, camera, .05); t.reset(); assert.equal(t.update(d, { ...camera, vx: 0 }, .05), 0);
});

test('renderer exports and WebGPU uploads the same view shift for world and torch projection', () => {
  const source = fs.readFileSync(require.resolve('../assets/rendererWebGPU'), 'utf8');
  const context = { window: { console, webglDungeonRenderer: { init() {}, renderScene() {} } }, navigator: {}, console, setTimeout, clearTimeout };
  vm.runInNewContext(source, context);
  const r = context.window.webgpuDungeonRenderer;
  assert.ok(r);
  r.updateTorchFrame({ viewShift: -.08, width: 160, height: 120, lights: [], spriteVoxelRects: [] });
  assert.equal(r._torchParamsFrame.viewShift, -.08);
  r._device = { queue: { writeBuffer() {} } }; r._worldParamsBuffer = {};
  r.getLegacySceneSnapshot = () => ({ gridW: 8, gridH: 8, heightMin: 0, heightRange: 8, atlasCols: 1, atlasRows: 1 });
  r._uploadWorldParams();
  assert.ok(Math.abs(new DataView(r._worldParamArrayBuffer).getFloat32(116, true) + .08) < 1e-6);
  assert.match(source, /0.5 \+ params.viewShift -/);
  assert.match(source, /resolution.y \* \(0.5 \+ params.depthFar.y\)/);
});

test('game movement and fallback share the camera helper without changing command processing', () => {
  const game = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  assert.match(game, /TerrainCamera\?\.update\(currentDungeon/);
  assert.match(game, /DUNGEON_AUTO_LOOK_DOWN !== false/);
  assert.match(game, /zDelta > 0.001 \|\|\s*viewSettling/);
  assert.match(game, /const HORIZON = Math.floor\(H \* \(\.5 \+ viewShift\)\)/);
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
  assert.ok(html.indexOf('terrainCamera.js') < html.indexOf('game.js'));
});
