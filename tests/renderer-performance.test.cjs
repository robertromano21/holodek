'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8');

function harness() {
  const counters = { canvases: 0, atlasDraws: 0, voxelDraws: 0 };
  const popup = { style: { display: 'block' } };
  const document = {
    getElementById: id => id === 'dungeon-popup' ? popup : {},
    createElement: () => { counters.canvases++; return { getContext: () => ({ drawImage: () => { counters.atlasDraws++; } }) }; }
  };
  const context = { window: { WEBGPU_VOXEL_PREWARM: false }, document, console, performance, clearTimeout };
  vm.runInNewContext(source, context);
  const renderer = context.window.webglDungeonRenderer;
  renderer.gl = new Proxy({ getParameter: () => false, isEnabled: () => false,
    drawElements: () => { counters.voxelDraws++; } }, {
    get(target, key) { return key in target ? target[key] : /^[A-Z_0-9]+$/.test(key) ? key : () => {}; }
  });
  renderer.canvas = { width: 160, height: 120 };
  renderer.cellTex = {}; renderer.roofCellsTex = {};
  return { renderer, context, counters };
}
const room = () => ({ geoKey: '0,0,0', _geometryStamp: 'a', layout: { width: 8, height: 8 },
  cells: { '1,1': { tile: 'floor', floorHeight: -7, ceilHeight: -4.5 },
    '2,2': { tile: 'wall', floorHeight: 0, ceilHeight: -9 } } });
const image = () => ({ complete: true, naturalWidth: 16, naturalHeight: 16, src: 'wall.png' });

test('floor minimum is computed on geometry rebuild, not from ceiling bounds or on every frame', () => {
  const { renderer } = harness(), dungeon = room();
  renderer.rebuildDungeonTextures(dungeon, {});
  assert.equal(renderer.minFloor, -7);
  assert.equal(renderer.heightMin, -9, 'Wall/ceiling encoding retains its independent range');
  let enumerations = 0;
  dungeon.cells = new Proxy(dungeon.cells, { ownKeys: target => { enumerations++; return Reflect.ownKeys(target); } });
  renderer.rebuildDungeonTextures(dungeon, {});
  assert.equal(enumerations, 0, 'Stable rooms must not rescan cells');
  dungeon.cells['1,1'].floorHeight = -12; dungeon._geometryStamp = 'b';
  renderer.rebuildDungeonTextures(dungeon, {});
  assert.equal(renderer.minFloor, -12);
  assert.ok(enumerations > 0);
  const other = { ...dungeon, cells: { '1,1': { tile: 'floor', floorHeight: 2, ceilHeight: 5 } } };
  renderer.rebuildDungeonTextures(other, {});
  assert.equal(renderer.minFloor, 2, 'New room identity invalidates even a reused stamp');
});

test('atlas draws once for stable images but refreshes for replacements, loading, dimensions and revisions', () => {
  const { renderer, counters } = harness(), dungeon = room(), wall = image(), textures = { wall };
  renderer.rebuildDungeonTextures(dungeon, textures);
  const originalVersion = renderer.sceneResourceVersion;
  for (let n = 0; n < 20; n++) renderer.rebuildDungeonTextures(dungeon, textures);
  assert.equal(counters.canvases, 1); assert.equal(counters.atlasDraws, 1);
  textures.wall = image(); renderer.rebuildDungeonTextures(dungeon, textures);
  assert.equal(counters.canvases, 2);
  assert.notEqual(renderer.sceneResourceVersion, originalVersion, 'WebGPU must see same-name texture replacement');
  textures.wall._revision = 1; renderer.rebuildDungeonTextures(dungeon, textures);
  assert.equal(counters.canvases, 3);
  textures.wall.naturalWidth = 32; renderer.rebuildDungeonTextures(dungeon, textures);
  assert.equal(counters.canvases, 4);
  textures.wall.complete = false; renderer.rebuildDungeonTextures(dungeon, textures);
  assert.equal(renderer.atlasReady, false);
  textures.wall.complete = true; renderer.rebuildDungeonTextures(dungeon, textures);
  assert.equal(counters.canvases, 5); assert.equal(renderer.atlasReady, true);
  textures.wall.src = 'another-wall.png'; renderer.rebuildDungeonTextures(dungeon, textures);
  assert.equal(counters.canvases, 6);
});

const camera = { x: 0, y: 0, dirX: 1, dirY: 0, eyeZ: 0.65,
  planeScale: Math.tan(Math.PI / 6), verticalScale: 1 / Math.tan(Math.PI / 6) };

test('frustum rejects off-screen volumes but retains roofs, wide arches and near-plane crossing geometry', () => {
  const { renderer } = harness(), box = (p, s = { x: 1, y: 1, z: 3 }) => renderer.isVoxelBoxVisible(p, s, camera);
  assert.equal(box({ x: 10, y: -0.5, z: 0 }), true);
  assert.equal(box({ x: -5, y: 0, z: 0 }), false);
  assert.equal(box({ x: 10, y: 20, z: 0 }), false);
  assert.equal(box({ x: 10, y: 0, z: 100 }), false);
  assert.equal(box({ x: -0.5, y: -0.5, z: 0 }), true);
  assert.equal(box({ x: -10, y: -1, z: 2 }, { x: 20, y: 2, z: 1 }), true, 'Overhead footprint crosses the camera');
  assert.equal(box({ x: 10, y: -20, z: 0 }, { x: 2, y: 40, z: 5 }), true, 'Do not cull by center alone');
  assert.equal(box({ x: NaN, y: 0, z: 0 }), true, 'Invalid inputs fail conservatively');
});

test('frustum never discards an AABB containing a vertex inside the production homogeneous clip planes', () => {
  const { renderer } = harness();
  let seed = 123;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  for (let n = 0; n < 1000; n++) {
    const angle = random() * Math.PI * 2;
    const c = { ...camera, dirX: Math.cos(angle), dirY: Math.sin(angle), viewShift: -random() * .1 };
    const p = { x: random() * 60 - 30, y: random() * 60 - 30, z: random() * 20 - 10 };
    const s = { x: random() * 10, y: random() * 10, z: random() * 10 };
    let cornerVisible = false;
    for (const x of [p.x, p.x + s.x]) for (const y of [p.y, p.y + s.y]) for (const z of [p.z, p.z + s.z]) {
      const forward = x * c.dirX + y * c.dirY, right = -x * c.dirY + y * c.dirX;
      if (forward >= 0.02 && Math.abs(right) <= forward * c.planeScale &&
          Math.abs((z - c.eyeZ) * c.verticalScale - 2 * c.viewShift * forward) <= forward) cornerVisible = true;
    }
    if (cornerVisible) assert.equal(renderer.isVoxelBoxVisible(p, s, c), true);
  }
});

function torchFrame(dungeon, lights, stamp = 'a') {
  const byId = new Map(); lights.forEach((light, order) => { light.order = order; byId.set(`${light.x},${light.y},${light.radius}`, light); });
  return { dungeon, lights, stamp, byId, membership: [...byId.keys()].sort().join('|') };
}
test('static torch visibility is cached while flicker and camera tie ordering remain current', () => {
  const { renderer } = harness(), dungeon = {}, stats = { hits: 0, losTests: 0 };
  let los = 0;
  const visible = () => { los++; return true; };
  const first = [{ x: -1, y: 0, radius: 6, intensity: 0.3 }, { x: 1, y: 0, radius: 6, intensity: 0.4 }];
  renderer.getCachedTorchLights(torchFrame(dungeon, first), 0, 0, 1, visible, stats);
  const next = [{ ...first[1], intensity: 1 }, { ...first[0], intensity: 0.7 }];
  const selected = renderer.getCachedTorchLights(torchFrame(dungeon, next), 0, 0, 1, visible, stats);
  assert.equal(los, 2); assert.equal(stats.hits, 1);
  assert.deepEqual(Array.from(selected, item => item.t.intensity), [1, 0.7]);
  assert.equal(selected[0].t, next[0], 'Equal-distance lights follow current input order, not stale camera ordering');
});

test('torch windows reuse known LOS, while new lights, moved targets and changed geometry invalidate correctly', () => {
  const { renderer } = harness(), dungeon = {};
  let checks = 0, blocked = false;
  const los = () => { checks++; return !blocked; };
  const a = { x: 1, y: 1, radius: 6 }, b = { x: 2, y: 1, radius: 6 };
  renderer.getCachedTorchLights(torchFrame(dungeon, [a]), 0, 0, 1, los);
  renderer.getCachedTorchLights(torchFrame(dungeon, [a, b]), 0, 0, 1, los);
  assert.equal(checks, 2, 'Only the new torch needs another LOS trace');
  renderer.getCachedTorchLights(torchFrame(dungeon, [a, b]), 0.5, 0, 1, los);
  assert.equal(checks, 4);
  blocked = true;
  assert.equal(renderer.getCachedTorchLights(torchFrame(dungeon, [a, b], 'door-changed'), 0, 0, 1, los).length, 0);
  assert.equal(checks, 6);
  renderer.getCachedTorchLights(torchFrame({}, [a, b], 'door-changed'), 0, 0, 1, los);
  assert.equal(checks, 8, 'Room replacement with the same stamp must reset cached visibility');
});

test('torch selection preserves nearest-light semantics and bounded cache size', () => {
  const { renderer } = harness(), dungeon = {};
  const lights = Array.from({ length: 90 }, (_, i) => ({ x: (i % 10) / 10, y: Math.floor(i / 10) / 10, radius: 6 }));
  const selected = renderer.getCachedTorchLights(torchFrame(dungeon, lights), 0, 0, 1, () => true);
  assert.equal(selected.length, 90, 'The existing packer, not this cache, applies the 64-light cap');
  for (let n = 1; n < selected.length; n++) assert.ok(selected[n].dist2 >= selected[n - 1].dist2);
  const empty = torchFrame(dungeon, []);
  for (let n = 0; n < 4200; n++) renderer.getCachedTorchLights(empty, n, 0, 1, () => true);
  assert.equal(renderer._torchVisibilityCache.size, 4096);
});

test('a pillar selects only in-range torches with line of sight from the torch to that pillar', () => {
  const { renderer } = harness(), calls = [];
  const lights = [{ x: 1, y: 0, radius: 6 }, { x: -1, y: 0, radius: 6 }, { x: 100, y: 0, radius: 6 }];
  const selected = renderer.getCachedTorchLights(torchFrame({}, lights), 0, 0, 1, (x0, y0, x1, y1) => {
    calls.push([x0, y0, x1, y1]); return x0 > 0;
  });
  assert.deepEqual(calls, [[1, 0, 0, 0], [-1, 0, 0, 0]], 'No trace for a light outside the radius');
  assert.equal(selected.length, 1); assert.equal(selected[0].t, lights[0]);
});

test('dense-frame diagnostics are CPU-only, bounded and throttled on the existing server endpoint', async () => {
  const { renderer, context } = harness(), sent = [];
  context.window.location = { protocol: 'http:' };
  context.Blob = Blob;
  context.navigator = { sendBeacon: (url, body) => { sent.push({ url, body }); } };
  const report = { geoKey: '0,0,-1', geometryStamp: 'farm', cpuMs: 12, voxelDrawCalls: 1200 };
  renderer.reportFramePerformance(report, 10);
  renderer.reportFramePerformance(report, 20);
  assert.equal(sent.length, 1);
  renderer.reportFramePerformance(report, 5010);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, '/debug/dungeon-rendering');
  const body = JSON.parse(await sent[0].body.text());
  assert.equal(body.reason, 'renderer-performance'); assert.deepEqual(body.samples, []);
  assert.deepEqual(body.performance, report);
  const method = renderer.reportFramePerformance.toString();
  assert.doesNotMatch(method, /readPixels|getParameter|finish\(/);
  assert.equal(context.window.debugDungeonPerformance(), null);
  renderer.lastFrameStats = report;
  assert.equal(context.window.debugDungeonPerformance(), report);
});

test('real dense-farm frame culls submissions without scanning the full room again or changing its cells', () => {
  const { renderer, context, counters } = harness();
  const cells = {};
  for (let y = 0; y < 70; y++) for (let x = 0; x < 70; x++) cells[`${x},${y}`] = {
    tile: x >= 18 && x <= 50 && y >= 18 && y <= 50 ? 'pillar' : 'floor', floorHeight: 0, ceilHeight: 2.5
  };
  let enumerations = 0;
  const dungeon = { geoKey: '0,0,0', _geometryStamp: 'farm', layout: { width: 70, height: 70 },
    classification: { indoor: false }, cells: new Proxy(cells, { ownKeys: target => { enumerations++; return Reflect.ownKeys(target); } }),
    tiles: { pillar: { spriteSpec: { baseWidth: 0.5 } } } };
  Object.assign(context.window, { currentDungeon: dungeon, dungeonTextures: {}, dungeonTexturesMeta: { pillar: { baseWidth: 0.5 } },
    playerDungeonX: 34, playerDungeonY: 34, playerPosX: 34.5, playerPosY: 34.5, playerZ: 0.65, playerAngle: 0 });
  let meshQueries = 0;
  const mesh = { passes: Array.from({ length: 3 }, () => ({ count: 6 })) };
  renderer.getVoxelMesh = () => { meshQueries++; renderer.voxelMeshes.pillar = mesh; return mesh; };
  renderer.voxelProgram = {};
  renderer.buildHaloTexture = renderer.buildBlobShadowTexture = renderer.buildFlameTexture = () => {};
  const geometry = JSON.stringify(cells);
  renderer.renderScene();
  assert.ok(renderer.lastFrameStats.culledVoxels > 650, JSON.stringify(renderer.lastFrameStats));
  assert.equal(renderer.lastFrameStats.voxelInstances + renderer.lastFrameStats.culledVoxels, 1089);
  assert.equal(counters.voxelDraws, renderer.lastFrameStats.voxelInstances * 3, 'Keep every visible column pass');
  const scanned = enumerations;
  meshQueries = 0;
  renderer.renderScene();
  assert.equal(meshQueries, renderer.lastFrameStats.voxelInstances, 'Known off-screen columns skip mesh lookup and projection');
  assert.equal(enumerations, scanned, 'Second real frame must not enumerate 512-room-style cells');
  assert.equal(JSON.stringify(cells), geometry);
});
