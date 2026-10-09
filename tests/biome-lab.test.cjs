'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { buildEnvironmentLab, descriptions, biomeExhibits } = require('../retort/environmentLab');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const Terrain = require('../retort/outdoorTerrain');
const Voxels = require('../assets/scenePropVoxels');
const Collision = require('../assets/voxelCollision');
const TerrainCamera = require('../assets/terrainCamera');

const kinds = Object.keys(biomeExhibits);
const outdoors = kinds.filter(kind => !biomeExhibits[kind].indoor);
const indoors = kinds.filter(kind => biomeExhibits[kind].indoor);

function geometry(d) {
  return createHash('sha256').update(JSON.stringify({
    cells: Object.entries(d.cells).map(([key, c]) => [key, d.tiles[c.tile]?.spriteSpec?.voxelShape || c.tile,
      c.floorHeight, c.ceilHeight, c.structureHeight, c.roof?.style, c.roof?.height, c.terrainRole, c.architectureRole]),
    parts: (d.sceneStructures || []).map(p => [p.shape, p.position, p.size])
  })).digest('hex');
}

function assertStanding(d, p) {
  const x = p.x + .5, y = p.y + .5;
  const cx = Math.floor(x), cy = Math.floor(y);
  const floor = Collision.surfaceAt(d, x, y).height;
  for (const dx of [-.2, .2]) for (const dy of [-.2, .2]) {
    const c = d.cells[`${Math.floor(x + dx)},${Math.floor(y + dy)}`];
    assert.equal(c?.tile, 'floor', `${d.geoKey}: standing pad ${p.x},${p.y}`);
    assert.ok(!c.blocked && !c.obstacle);
    assert.ok(Math.abs(c.floorHeight - floor) <= 1.5);
    if (c.roof) assert.ok(c.roof.height - floor > 1, 'Roof clears the standing player');
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const result = Collision.testCell(d, cx + dx, cy + dy, x, y, .2, .65, 1.5, floor);
    assert.ok(!result?.blocked, `${d.geoKey}: rendered voxels obstruct ${p.x},${p.y}`);
  }
}

function assertBounded(d) {
  const { width, height } = d.layout, bounds = d.environmentLab.bounds;
  assert.ok(width <= 96 && height <= 96);
  assert.equal(Object.keys(d.cells).length, width * height);
  for (const [key, c] of Object.entries(d.cells)) {
    const [x, y] = key.split(',').map(Number);
    assert.ok(Number.isInteger(x) && x >= 0 && x < width);
    assert.ok(Number.isInteger(y) && y >= 0 && y < height);
    assert.ok(Number.isFinite(c.floorHeight) && Number.isFinite(c.ceilHeight));
    assert.ok(c.floorHeight >= bounds.minHeight && c.ceilHeight <= bounds.maxHeight, key);
    assert.ok(c.ceilHeight > c.floorHeight, key);
    if (c.structureHeight != null) assert.ok(Number.isFinite(c.structureHeight) && c.structureHeight > 0 && c.floorHeight + c.structureHeight <= bounds.maxHeight);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) assert.equal(c.tile, 'wall', 'No unbounded edge escape');
    if (c.roof) assert.ok(Number.isFinite(c.roof.height) && c.roof.height > c.floorHeight && c.roof.height <= bounds.maxHeight);
  }
  for (const p of d.sceneStructures || []) {
    assert.ok([p.position.x, p.position.y, p.position.z, p.size.x, p.size.y, p.size.z].every(Number.isFinite));
    assert.ok(p.size.x > 0 && p.size.y > 0 && p.size.z > 0);
    assert.ok(p.position.x >= 0 && p.position.y >= 0 && p.position.x + p.size.x <= width && p.position.y + p.size.y <= height);
    assert.ok(p.position.z >= bounds.minHeight && p.position.z + p.size.z <= bounds.maxHeight);
    assert.ok(Voxels.build(p.shape).some(Boolean), `Existing roof voxel mesh: ${p.shape}`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d, 'Transport retains finite geometry and metadata');
}

test('six additional selectors retain every original exhibit and use constructor descriptions', () => {
  assert.equal(kinds.length, 6);
  const html = fs.readFileSync(require.resolve('../assets/environment-lab.html'), 'utf8');
  const options = [...html.matchAll(/<option value="([^"]+)">/g)].map(m => m[1]).filter(Boolean);
  const legacy = ['gallery', 'castle', 'citadel', 'geography', 'deadwood', 'exteriors', 'bathhouse', 'rubble',
    'temple', 'gothic', 'rotunda', 'obelisks', 'byzantine', 'squinch', 'fan', 'groin', 'hammerbeam', 'boarded',
    'gold', 'motte', 'shellkeep', 'stonekeep', 'concentric', 'amphitheater', 'theater', 'circus', 'forum',
    'warehouse', 'domus', 'villa', 'insula', 'aqueduct', 'forge', 'graves', 'grove'];
  assert.deepEqual(options, [...legacy, ...kinds]);
  for (const kind of options) assert.ok(Object.hasOwn(descriptions, kind), kind);
  assert.throws(() => buildEnvironmentLab('constructor'), /Unknown/);
  assert.throws(() => buildEnvironmentLab('unknown'), /Unknown/);
  assert.throws(() => buildEnvironmentLab('badlands', { seed: '' }), /seed/);
  assert.throws(() => buildEnvironmentLab('badlands', { seed: 'x'.repeat(161) }), /seed/);
});

test('new construction makes no network requests or sprite/room/cache writes', t => {
  const forbidden = () => { throw new Error('Unexpected network or filesystem mutation'); };
  t.mock.method(fs, 'writeFileSync', forbidden);
  t.mock.method(fs, 'mkdirSync', forbidden);
  t.mock.method(http, 'request', forbidden);
  t.mock.method(http, 'get', forbidden);
  t.mock.method(https, 'request', forbidden);
  t.mock.method(https, 'get', forbidden);
  t.mock.method(globalThis, 'fetch', forbidden);
  for (const kind of kinds) {
    const d = buildEnvironmentLab(kind);
    assert.match(d.tiles.floor.url, /^data:image\/png;base64,/);
    assert.match(d.tiles.wall.url, /^data:image\/png;base64,/);
    assert.equal(d.environmentLab.kind, kind);
    assert.equal(d.sceneSpec.source.description, descriptions[kind]);
  }
});

for (const kind of kinds) {
  test(`${kind}: actual engine cells, shapes, bounds and inspectable destinations`, () => {
    const d = buildEnvironmentLab(kind), nav = makeNavigation(d), connected = reachable(nav, d.start);
    assertBounded(d);
    assertStanding(d, d.start);
    assert.ok(connected.count > (biomeExhibits[kind].indoor ? 1000 : 6000), 'Useful area beyond spawn');
    for (const p of d.environmentLab.viewpoints) {
      assert.ok(connected.seen[p.y * nav.width + p.x], p.label);
      assertStanding(d, p);
    }
    assert.ok(d.environmentLab.props.length >= 8 && d.environmentLab.props.length <= 85);
    for (const p of d.environmentLab.props) {
      const c = d.cells[`${p.x},${p.y}`], spec = d.tiles[c.tile].spriteSpec;
      assert.equal(c.tile, p.tile);
      assert.ok(Voxels.shapes.includes(spec.voxelShape), 'Not a placeholder/recolored billboard');
      assert.ok(Voxels.build(spec.voxelShape).some(Boolean));
      assert.ok(c.floorHeight + c.structureHeight <= d.environmentLab.bounds.maxHeight);
      assert.ok(!c.navigationReserved, 'Dressing preserves all authored routes');
    }
  });

  test(`${kind}: independent, deterministic replay and a genuinely different seeded geometry`, () => {
    const a = buildEnvironmentLab(kind, { seed: 'biome-test-alpha' });
    const replay = buildEnvironmentLab(kind, { seed: 'biome-test-alpha' });
    const b = buildEnvironmentLab(kind, { seed: 'biome-test-beta' });
    assert.deepEqual(a, replay, 'Textures, props, cells and structures replay exactly');
    assert.notEqual(geometry(a), geometry(b), 'Compare physical geometry, excluding palettes and descriptive labels');
    a.cells[`${a.start.x},${a.start.y}`].tile = 'wall';
    assert.equal(replay.cells[`${replay.start.x},${replay.start.y}`].tile, 'floor', 'No shared mutable cached room');
    assert.equal(buildEnvironmentLab(kind, { seed: 'biome-test-alpha' }).cells[`${replay.start.x},${replay.start.y}`].tile, 'floor');
  });
}

test('outdoor exhibits have distinct landform silhouettes, ungraded relief and usable three-cell trails', () => {
  const signatures = new Set();
  for (const kind of outdoors) for (const seed of [undefined, 'trail-a', 'trail-b', 'trail-c']) {
    const d = buildEnvironmentLab(kind, { seed });
    const nav = makeNavigation(d), connected = reachable(nav, d.start);
    assert.equal(d.outdoorTerrain.design.authored, biomeExhibits[kind].landforms.length);
    assert.equal(d.outdoorTerrain.profile, { badlands: 'badlands', caldera: 'volcanic', uplands: 'glacial', leafless: 'forest' }[kind]);
    assert.equal(Terrain.heightAt(d.outdoorTerrain, d.start.x, d.start.y), 0);
    assert.ok(Object.values(d.cells).every(c => !c.roof), 'Outdoor exhibits remain open sky');
    const heights = Object.values(d.cells).map(c => c.floorHeight);
    assert.ok(Math.max(...heights) - Math.min(...heights) > (kind === 'leafless' ? 6 : 24));
    let ungraded = 0;
    for (let y = 1; y < nav.height - 1; y++) for (let x = 1; x < nav.width - 1; x++) {
      const c = d.cells[`${x},${y}`];
      if (!c.navigationReserved) { assert.equal(c.floorHeight, Terrain.heightAt(d.outdoorTerrain, x, y) || 0); ungraded++; }
    }
    assert.ok(ungraded > nav.width * nav.height * .70, 'Trails do not flatten the whole biome');
    for (const route of d.environmentLab.routes) {
      for (let i = 0; i < route.points.length; i++) {
        const p = route.points[i], c = d.cells[`${p.x},${p.y}`];
        assert.equal(c.terrainRole, 'trail');
        assert.equal(c.navigationReserved, true);
        assert.ok(connected.seen[p.y * nav.width + p.x]);
        assertStanding(d, p);
        if (i) {
          const previous = route.points[i - 1], old = d.cells[`${previous.x},${previous.y}`];
          assert.equal(Math.abs(previous.x - p.x) + Math.abs(previous.y - p.y), 1);
          assert.ok(Math.abs(old.floorHeight - c.floorHeight) <= 1.5, `${kind}: walkable step at ${p.x},${p.y}`);
          for (let t = .25; t < 1; t += .25) assertStanding(d, { x: previous.x + (p.x - previous.x) * t, y: previous.y + (p.y - previous.y) * t });
        }
      }
    }
    if (!seed) signatures.add(geometry(d));
  }
  assert.equal(signatures.size, 4);
});

test('landmark geometry makes the forest, caldera and frozen uplands recognizably different', () => {
  const forest = buildEnvironmentLab('leafless');
  const forestShapes = new Set(forest.environmentLab.props.map(p => forest.tiles[p.tile].spriteSpec.voxelShape));
  for (const shape of Object.keys(Voxels.vegetation)) if (!['ash_reeds'].includes(shape)) assert.ok(forestShapes.has(shape), shape);
  for (const shape of ['oak', 'pine', 'willow', 'cypress', 'mushroom_tree']) assert.ok(!forestShapes.has(shape));
  assert.ok(forest.environmentLab.props.filter(p => /tree|snag|willow|pine|yew/.test(p.type)).length >= 45, 'Dense leafless stands rather than scattered rocks');
  for (const [kind, material] of [['caldera', 'lava'], ['uplands', 'ice']]) {
    const d = buildEnvironmentLab(kind);
    const crust = d.environmentLab.props.filter(p => p.role === `${material}-crust`);
    assert.ok(crust.length >= 4);
    const spec = d.tiles[crust[0].tile].spriteSpec;
    assert.equal(spec.voxelShape, 'coffered_slab');
    assert.equal(spec.material, material);
    const palette = Object.fromEntries(Object.entries(spec.palette).map(([name, hex]) => [name, [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)]));
    const color = Voxels.color(spec.voxelShape, .5, .5, .5, [0, 0, 1], palette.primary, material, { palette });
    assert.ok(material === 'lava' ? color[0] > color[2] + .2 : color[2] > color[0], 'Actual voxel coloring, not ignored pool metadata');
  }
  const caldera = buildEnvironmentLab('caldera');
  const f = caldera.outdoorTerrain.features.find(f => f.kind === 'caldera' && f.source);
  assert.ok(Terrain.heightAt(caldera.outdoorTerrain, f.x + f.radiusX * .48, f.y) > Terrain.heightAt(caldera.outdoorTerrain, f.x, f.y) + 5, 'Crater center lies below its raised rim');
  const canyon = buildEnvironmentLab('badlands');
  assert.ok(Math.min(...Object.values(canyon.cells).map(c => c.floorHeight)) < -10);
  assert.ok(canyon.outdoorTerrain.features.some(f => f.kind === 'mesa' && f.source));
  assert.ok(canyon.outdoorTerrain.features.some(f => f.kind === 'hoodoo' && f.source));
});

test('modular interiors retain different room graphs, open courts, stairs and grounded ceilings', () => {
  const signatures = [];
  for (const kind of indoors) for (const seed of [undefined, 'interior-a', 'interior-b']) {
    const d = buildEnvironmentLab(kind, { seed }), a = d.sceneArchitecture, roof = d.sceneRoof;
    assert.equal(a.mode, 'blueprint-decoration');
    assert.equal(a.preservedLayout, true);
    assert.equal(a.chambers.length, d.blueprint.indoorPlan.rooms.length);
    assert.equal(a.modules.length, 5);
    assert.ok(a.modules.every(m => m.section && m.status === 'built'), JSON.stringify(a.modules));
    assert.equal(d.indoorLayout.repairedLinks, 0, 'The authored graph is connected without fallback links');
    const nav = makeNavigation(d), connected = reachable(nav, d.start);
    for (let i = 0; i < nav.passable.length; i++) if (nav.passable[i]) assert.ok(connected.seen[i], `${kind}: no isolated usable floor ${i}`);
    assert.equal(roof.status, 'built');
    assert.ok(roof.coverage.targetMet && roof.coverage.ratio >= .75, JSON.stringify(roof.coverage));
    for (const bay of roof.bays) {
      assert.ok(bay.supports.length >= bay.minimumSupports);
      for (const key of bay.supports) {
        const c = d.cells[key];
        assert.ok(c.tile === 'wall' || c.structureHeight > 0 || c.tile === 'pillar', key);
        assert.ok(c.ceilHeight >= bay.springHeight || bay.supportCaps.includes(key), 'Every ceiling has physical support up to spring height');
      }
    }
    for (const room of d.indoorRooms.filter(r => r.role === 'courtyard')) {
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) assert.equal(d.cells[`${x},${y}`].roof, undefined, 'Court remains open sky');
    }
    if (kind === 'modular-sanctuary') {
      for (const shape of ['dome_shell', 'groin_vault_shell', 'pediment']) assert.ok(d.sceneStructures.some(p => p.shape === shape), shape);
    } else {
      for (const shape of ['hammerbeam_truss', 'boarded_ceiling', 'groin_vault_shell']) assert.ok(d.sceneStructures.some(p => p.shape === shape), shape);
      const stairs = a.modules.find(m => m.type === 'staircase');
      const treads = Object.values(d.cells).filter(c => ['stair-tread', 'stair-landing'].includes(c.architectureRole));
      assert.ok(treads.length >= 40);
      assert.ok(Math.max(...treads.map(c => c.floorHeight)) >= 4.2);
      for (let y = stairs.y; y < stairs.y + stairs.height - 1; y++) assert.ok(Math.abs(d.cells[`${stairs.x},${y}`].floorHeight - d.cells[`${stairs.x},${y + 1}`].floorHeight) <= .351);
    }
    if (!seed) signatures.push(JSON.stringify({ rooms: d.indoorRooms.map(r => [r.x, r.y, r.w, r.h]), links: d.indoorLayout.corridors }));
  }
  assert.notEqual(signatures[0], signatures[1], 'Not two palettes on the same room arrangement');
});

test('lab movement helpers remain extractable and the real camera responds to downhill trails', () => {
  const source = fs.readFileSync(require.resolve('../assets/environment-lab.js'), 'utf8');
  const html = fs.readFileSync(require.resolve('../assets/environment-lab.html'), 'utf8');
  assert.match(html, /src="\/assets\/terrainCamera\.js"/);
  assert.match(source, /window\.TerrainCamera\?\.update/);
  const context = { window: { VoxelCollision: Collision } };
  vm.runInNewContext(source.slice(source.indexOf('  function clear(x, y)'), source.indexOf('  function draw()')), context);
  for (const kind of outdoors) {
    const d = buildEnvironmentLab(kind), camera = TerrainCamera.create();
    context.window.currentDungeon = d;
    let descent = false;
    for (const route of d.environmentLab.routes) for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], dx = b.x - a.x, dy = b.y - a.y;
      Object.assign(context.window, { playerPosX: a.x + .5, playerPosY: a.y + .5, playerDungeonX: a.x, playerDungeonY: a.y });
      for (let t = .125; t <= 1; t += .125) {
        const x = a.x + .5 + dx * t, y = a.y + .5 + dy * t;
        assert.equal(context.clear(x, y), true, `${kind}: actual lab movement at ${x},${y}`);
        Object.assign(context.window, { playerPosX: x, playerPosY: y, playerDungeonX: Math.floor(x), playerDungeonY: Math.floor(y) });
      }
      camera.reset();
      const shift = camera.update(d, { x: a.x + .5, y: a.y + .5, angle: Math.atan2(dy, dx), vx: dx * 2.5, vy: dy * 2.5 }, .05, true);
      assert.ok(Number.isFinite(shift) && shift >= -.1 && shift <= 0);
      if (shift < 0) descent = true;
    }
    assert.ok(descent, `${kind}: exercises gentle downhill assist on real graded relief`);
  }
});

test('actual lab UI loads new exhibits, jumps to viewpoints and supplies achieved velocity to the camera without HTTP', async () => {
  const html = fs.readFileSync(require.resolve('../assets/environment-lab.html'), 'utf8');
  const source = fs.readFileSync(require.resolve('../assets/environment-lab.js'), 'utf8');
  const map = require('canvas').createCanvas(280, 280);
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
    value: '', checked: true, children: [], handlers: {}, textContent: '', disabled: false,
    addEventListener(type, handler) { this.handlers[type] = handler; },
    replaceChildren() { this.children = []; }, append(child) { this.children.push(child); },
    getContext() { return map.getContext('2d'); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 280, height: 280 }; }
  }]));
  const frames = [], calls = [], camera = TerrainCamera.create(), requests = [];
  const window = { VoxelCollision: Collision, addEventListener() {},
    webglDungeonRenderer: { gl: {}, program: {}, voxelProgram: {}, renderScene() {} },
    TerrainCamera: { reset: camera.reset, update(d, input, dt, enabled) { calls.push({ input, enabled }); return camera.update(d, input, dt, enabled); } } };
  const context = { window, performance: { now: () => 0 }, requestAnimationFrame: callback => frames.push(callback),
    document: { getElementById: id => elements.get(id), createElement: () => ({}) },
    Image: class { set src(value) { assert.match(value, /^data:image\/png;base64,/); queueMicrotask(() => this.onload()); } },
    fetch: async url => {
      const parsed = new URL(url, 'http://lab.invalid'), kind = parsed.pathname.split('/').pop();
      requests.push(kind);
      return { ok: true, json: async () => ({ dungeon: buildEnvironmentLab(kind, { seed: parsed.searchParams.get('seed') ?? undefined }) }) };
    } };
  elements.get('exhibit').value = 'badlands';
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  for (const kind of kinds) {
    if (kind !== 'badlands') {
      elements.get('exhibit').value = kind;
      await elements.get('exhibit').onchange();
    }
    assert.match(elements.get('status').textContent, /^Ready/);
    assert.equal(window.currentDungeon.environmentLab.kind, kind);
    assert.match(elements.get('composition').textContent, /Seed:/);
    assert.equal(elements.get('viewpoint').children.length, window.currentDungeon.environmentLab.viewpoints.length + 1);
    assert.equal(elements.get('viewpoint').disabled, false);
    elements.get('viewpoint').value = '1';
    elements.get('viewpoint').onchange();
    const point = window.currentDungeon.environmentLab.viewpoints[0];
    assert.equal(window.playerPosX, point.x + .5);
    assert.equal(window.playerPosY, point.y + .5);
    assert.equal(window.dungeonViewShift, 0, 'Inspection jumps reset the terrain camera');
  }
  elements.get('exhibit').value = 'badlands';
  await elements.get('exhibit').onchange();
  const d = window.currentDungeon;
  const trail = d.environmentLab.routes[0].points;
  const i = trail.findIndex((p, index) => index + 1 < trail.length && d.cells[`${p.x},${p.y}`].floorHeight > d.cells[`${trail[index + 1].x},${trail[index + 1].y}`].floorHeight + .05);
  assert.ok(i >= 0);
  const a = trail[i], b = trail[i + 1];
  Object.assign(window, { playerPosX: a.x + .5, playerPosY: a.y + .5, playerDungeonX: a.x,
    playerDungeonY: a.y, playerAngle: Math.atan2(b.y - a.y, b.x - a.x) });
  elements.get('dungeon-container').handlers.keydown({ key: 'w', preventDefault() {} });
  frames.shift()(50);
  assert.ok(Math.hypot(calls.at(-1).input.vx, calls.at(-1).input.vy) > 2.4);
  assert.ok(window.dungeonViewShift < 0 && window.dungeonViewShift >= -.1);
  elements.get('terrain-assist').checked = false;
  frames.shift()(100);
  assert.equal(calls.at(-1).enabled, false);
  assert.deepEqual(requests, [...kinds, 'badlands']);
});
