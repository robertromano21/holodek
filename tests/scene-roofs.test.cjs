const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { applySceneArchitecture, makeNavigation, reachable } = require('../retort/sceneArchitecture');
const { applySceneRoofs, roofProfile, columnOrder, architecturalStyle } = require('../retort/sceneRoofs');
const { buildSceneSpec } = require('../retort/sceneSpec');
const { placeSceneLandmarks } = require('../retort/sceneRoomBuilder');
const V = require('../assets/scenePropVoxels');

function room(name, description) {
  const spec = buildSceneSpec({ roomName: name, description });
  const dungeon = { layout: { width: 32, height: 32 }, start: { x: 16, y: 26 }, cells: {},
    tiles: { wall: { url: '/wall.png' }, pillar: { url: '/pillar.png' } }, customTiles: [] };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) dungeon.cells[`${x},${y}`] = {
    tile: x && y && x < 31 && y < 31 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 3
  };
  assert.equal(applySceneArchitecture(dungeon, spec).status, 'built');
  return { dungeon, spec };
}

for (const [name, description, idiom, style] of [
  ['Roman Temple', 'Inside a Roman temple, Corinthian columns support a coffered ceiling and a pedimented shrine beside an open courtyard.', 'classical', 'coffered'],
  ['Roman Bathhouse', 'Inside a Roman bathhouse, a barrel-vaulted hall opens into a courtyard.', 'classical', 'barrel'],
  ['Gothic Cathedral', 'Inside a Gothic cathedral, ribbed vaults cover the nave.', 'gothic', 'ribbed'],
  ['Castle Gatehouse', 'Inside a medieval castle, a timber roof covers the gate hall beside the courtyard.', 'medieval', 'timber'],
  ['Roman Rotunda', 'Inside a Roman rotunda, Ionic columns carry a stone dome with an open oculus.', 'classical', 'domed']
]) {
  test(`${name}: supported roofs preserve ground, reserved passages and connected routes`, () => {
    const { dungeon: d, spec } = room(name, description);
    const before = reachable(makeNavigation(d), d.start);
    const floors = Object.fromEntries(Object.entries(d.cells).map(([k, c]) => [k, c.floorHeight]));
    const protectedCells = Object.entries(d.cells).filter(([, c]) => c.navigationReserved);
    const roof = applySceneRoofs(d, spec);
    assert.equal(roof.status, 'built', JSON.stringify(roof));
    assert.equal(roof.idiom, idiom); assert.equal(roof.style, style);
    const after = reachable(makeNavigation(d), d.start);
    for (const [key, c] of Object.entries(d.cells)) {
      assert.equal(c.floorHeight, floors[key]);
      if (c.tile === 'floor') {
        const [x, y] = key.split(',').map(Number), i = y * 32 + x;
        if (before.seen[i]) assert.ok(after.seen[i], key);
      }
      if (c.structureHeight) assert.equal(c.floorHeight + c.structureHeight, c.ceilHeight);
    }
    for (const [key, c] of protectedCells) assert.equal(d.cells[key].tile, c.tile, key);
    for (const bay of roof.bays) {
      assert.ok(bay.supports.length >= (bay.minimumSupports || 4));
      for (const key of bay.supports) assert.ok(d.cells[key].ceilHeight >= bay.springHeight || bay.supportCaps.includes(key));
    }
    for (const p of d.sceneStructures) {
      assert.ok(V.build(p.shape), p.shape);
      assert.ok(p.role === 'flying-buttress' ? p.position.z === 0 : p.position.z >= 3.5);
      assert.ok(Object.values(p.size).every(n => n > 0));
    }
    assert.equal(applySceneRoofs(d, spec), roof);
    assert.deepEqual(JSON.parse(JSON.stringify(d)).cells, d.cells);
    if (name === 'Roman Temple') {
      assert.equal(roof.columnOrder, 'corinthian');
      assert.ok(roof.bays.some(b => b.role === 'shrine'));
      assert.ok(d.sceneStructures.some(p => p.shape === 'pediment'));
    }
    if (name === 'Roman Rotunda') {
      assert.ok(d.sceneStructures.some(p => p.shape === 'dome_shell'));
      assert.ok(Object.values(d.cells).some(c => c.structureHeight && d.tiles[c.tile].spriteSpec.voxelShape === 'ionic_column'));
    }
  });
}

test('vault segments meet exactly at edges and roof rejection is atomic', () => {
  for (const style of ['barrel', 'ribbed', 'timber', 'pitched']) {
    for (const width of [3, 5, 13]) {
      const { dungeon: d, spec } = room('Roman Temple', 'Inside a Roman temple, a barrel vault covers the nave.');
      const z = d.sceneArchitecture.zones.find(z => z.role === 'nave');
      z.width = width;
      const a = roofProfile(style, 0, width), b = roofProfile(style, width, width);
      assert.ok(Math.abs(a) < 1e-9 && Math.abs(b) < 1e-9);
      applySceneRoofs(d, spec);
      for (const bay of d.sceneRoof.bays) for (let dx = 0; dx < bay.width - 1; dx++) {
        const c0 = d.cells[`${bay.x + dx},${bay.y}`].roof;
        const c1 = d.cells[`${bay.x + dx + 1},${bay.y}`].roof;
        if (c0 && c1) assert.ok(Math.abs(c0.height + c0.slopeX / 2 - c1.height + c1.slopeX / 2) < 1e-9);
      }
    }
  }
  const { dungeon: d, spec } = room('Roman Temple', 'A stone roof covers the temple.');
  spec.indoor = false; d.classification = { indoor: false };
  for (const c of Object.values(d.cells)) if (c.tile === 'floor') c.navigationReserved = true;
  d.sceneArchitecture.zones = [{ role: 'unsupported-hall', x: 12, y: 14, width: 4, height: 4 }];
  const before = JSON.stringify(d.cells);
  assert.equal(applySceneRoofs(d, spec).status, 'skipped');
  assert.equal(JSON.stringify(d.cells), before);
  assert.equal(d.sceneStructures.length, 0);
});

test('roofless courtyards remain sky and physical column styles are selected from prose', () => {
  const { dungeon: d, spec } = room('Ruined Temple', 'A roofless temple surrounds an open courtyard.');
  assert.equal(applySceneRoofs(d, spec).status, 'skipped');
  assert.ok(Object.values(d.cells).every(c => !c.roof));
  assert.equal(columnOrder({ source: { description: 'Ionic volutes' } }), 'ionic');
  assert.equal(columnOrder({ source: { description: 'Corinthian acanthus capitals' } }), 'corinthian');
  assert.equal(architecturalStyle({ source: { roomName: 'Gothic Cathedral' } }), 'gothic');
  for (const order of ['doric', 'ionic', 'corinthian']) {
    const s = buildSceneSpec({ description: `Four ${order} columns frame the altar.` });
    assert.ok(s.landmarks.some(l => l.type === `${order}_column`));
  }
});

test('obelisk is tapered, capped, solid, and routed from the existing narrative landmark', () => {
  assert.equal(V.select('obelisk'), 'obelisk');
  const spec = buildSceneSpec({ description: 'Three inscribed obsidian obelisks stand in the court.' });
  assert.ok(spec.landmarks.some(l => l.type === 'obelisk'));
  const g = V.build('obelisk', 32);
  const slice = z => g.slice(z * 1024, (z + 1) * 1024).reduce((a, b) => a + b, 0);
  assert.ok(slice(3) > slice(10));
  assert.ok(slice(10) > slice(24));
  assert.ok(slice(24) > slice(31));
  assert.equal(g[16 + 16 * 32 + 15 * 1024], 1);
});

test('temple entrances get a localized pedimented shrine without a roof keyword', () => {
  const { dungeon: d, spec } = room('Ruined Temple Entrance',
    'Fractured pillars frame an inner court, with ancient inscriptions in the masonry.');
  const roof = applySceneRoofs(d, spec);
  assert.equal(roof.shrines.requested, 1);
  assert.equal(roof.shrines.placed, 1, JSON.stringify(roof));
  assert.equal(roof.shrines.evidence, 'temple-entrance');
  assert.equal(roof.roofEvidence, 'building-family');
  assert.ok(d.sceneStructures.some(p => p.shape === 'pediment'));
  assert.ok(d.sceneStructures.some(p => p.shape === 'pitched_roof_shell'));
  assert.equal(roof.rotundas.placed, 1, JSON.stringify(roof));
  assert.ok(d.sceneStructures.some(p => p.shape === 'dome_shell'));
  assert.ok(d.sceneStructures.some(p => p.role === 'rotunda-pediment'));
  assert.ok(roof.coverage.covered >= roof.coverage.eligible * 0.75, JSON.stringify(roof.coverage));
  assert.ok(roof.coverage.openZones.length);
});

test('named architecture supplies local roof defaults without covering courtyards', () => {
  for (const [name, style] of [['Roman Temple', 'coffered'], ['Castle Gatehouse', 'timber'],
    ['Roman Bathhouse', 'barrel'], ['Catacombs', 'barrel'], ['Roman Rotunda', 'domed']]) {
    const { dungeon: d, spec } = room(name, 'Ancient masonry surrounds the entrance.');
    const roof = applySceneRoofs(d, spec);
    assert.equal(roof.status, 'built', name);
    assert.equal(roof.style, style, name);
    assert.ok(['building-family', 'room-name'].includes(roof.roofEvidence));
    assert.ok(roof.bays.every(b => b.role !== 'courtyard' && b.role !== 'perimeter' && b.role !== 'nave'));
  }
});

function outdoorRoom(description = 'Scattered altar remnants lie among the wasteland dunes.') {
  const spec = buildSceneSpec({ roomName: 'Whispering Dunes', description });
  spec.indoor = false; spec.biome = 'wasteland';
  const d = { layout: { width: 80, height: 80 }, start: { x: 40, y: 40 }, tiles: {}, cells: {},
    classification: { indoor: false, biome: 'wasteland' } };
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) d.cells[`${x},${y}`] = {
    tile: x && y && x < 79 && y < 79 ? 'floor' : 'wall', floorHeight: 0.25, ceilHeight: 2.75,
    navigationReserved: x === 40
  };
  applySceneArchitecture(d, spec);
  return { d, spec };
}

test('outdoor ruins use shared cells, preserve terrain and protected features, and stay bounded', () => {
  const { d, spec } = outdoorRoom();
  assert.equal(d.sceneArchitecture.status, 'skipped');
  d.cells['48,40'] = { tile: 'torch', feature: 'torch', floorHeight: 0.25, ceilHeight: 2.75 };
  d.cells['38,30'] = { tile: 'door', exit: 'north', door: { isOpen: true }, floorHeight: 0.25, ceilHeight: 2.75 };
  d.cells['30,38'] = { tile: 'floor', interactable: { id: 'quest-item' }, floorHeight: 0.25, ceilHeight: 2.75 };
  const original = structuredClone(d.cells), before = reachable(makeNavigation(d), d.start);
  const roof = applySceneRoofs(d, spec);
  assert.equal(roof.shrines.placed, 2, JSON.stringify(roof));
  assert.equal(roof.rotundas.placed, 1);
  assert.equal(roof.bays.length, 3);
  assert.equal(roof.parts, 17);
  assert.ok(d.sceneStructures.some(p => p.role === 'rotunda-portico'));
  assert.ok(d.sceneStructures.some(p => p.role === 'rotunda-pediment'));
  assert.equal(roof.bays.filter(b => b.openPortico).length, 1);
  const nav = makeNavigation(d), after = reachable(nav, d.start);
  for (const [key, c] of Object.entries(d.cells)) {
    assert.equal(c.floorHeight, original[key].floorHeight, key);
    if (original[key].navigationReserved) assert.equal(c.tile, original[key].tile, key);
    if (original[key].exit || original[key].interactable || original[key].tile === 'torch') {
      assert.deepEqual(c, original[key], key);
    }
  }
  for (let i = 0; i < before.seen.length; i++) if (before.seen[i] && nav.passable[i]) assert.ok(after.seen[i]);
  for (const b of roof.bays) {
    assert.ok(b.supports.length >= 4);
    assert.ok(Math.hypot(b.x + 2 - d.start.x, b.y + 2 - d.start.y) >= 6);
    for (const other of roof.bays) if (other !== b) assert.ok(Math.hypot(b.x - other.x, b.y - other.y) >= 12);
    for (const key of b.supports) assert.equal(d.cells[key].architectureRole, 'roof-support');
    if (b.role === 'rotunda') {
      const center = (b.y + Math.floor(b.height / 2)) * nav.width + b.x + Math.floor(b.width / 2);
      assert.ok(after.seen[center], 'The rotunda interior must remain reachable');
    }
    if (b.openPortico) for (let y = b.y; y < b.y + b.height; y++) {
      for (let x = b.x; x < b.x + b.width; x++) assert.equal(d.cells[`${x},${y}`].roof, undefined);
    }
  }
  const snapshot = JSON.stringify(d);
  assert.equal(applySceneRoofs(d, spec), roof);
  assert.equal(JSON.stringify(d), snapshot);
});

test('ruin sites reject protected terrain and honor the architecture-disable switch', () => {
  const { d, spec } = outdoorRoom();
  for (const c of Object.values(d.cells)) c.navigationReserved = true;
  const snapshot = JSON.stringify(d.cells);
  const roof = applySceneRoofs(d, spec);
  assert.equal(roof.status, 'skipped');
  assert.equal(roof.shrines.placed, 0);
  assert.ok(roof.rejected.some(r => r.reason === 'no-safe-connected-site'));
  assert.equal(JSON.stringify(d.cells), snapshot);
  delete d.sceneRoof;
  d.sceneArchitecture.reason = 'disabled';
  assert.equal(applySceneRoofs(d, spec).reason, 'no-architecture');
  assert.equal(d.sceneRoof, undefined);
});

test('structural placement precedes scatter; protected torches and exits retain their mount data', () => {
  const { dungeon: d, spec } = room('Roman Temple', 'A coffered roof covers the temple nave.');
  const nave = d.sceneArchitecture.zones.find(z => z.role === 'nave');
  const torchKey = `${nave.x - 1},${nave.y}`;
  const torch = { tile: 'torch', feature: 'torch', floorHeight: 0, ceilHeight: 2.5 };
  d.cells[torchKey] = torch;
  const exitKey = `${nave.x + nave.width},${nave.y}`;
  const door = { tile: 'door', floorHeight: 0, ceilHeight: 2.5, exit: 'east', door: { isOpen: true } };
  d.cells[exitKey] = door;
  applySceneRoofs(d, spec);
  assert.equal(d.cells[torchKey], torch);
  assert.equal(d.cells[exitKey], door);
  assert.equal(torch.ceilHeight, 2.5); assert.equal(door.ceilHeight, 2.5);
  const columns = Object.entries(d.cells).filter(([, c]) => c.structureHeight);
  const columnCount = Object.values(d.cells).filter(c => c.tile === 'pillar' || c.structureHeight).length;
  const result = placeSceneLandmarks(d, { ...spec, landmarks: [{ type: 'pillar', count: 30 }] });
  assert.equal(Object.values(d.cells).filter(c => c.tile === 'pillar' || c.structureHeight).length, columnCount);
  if (columnCount < 30) assert.ok(result.missing.some(s => /architectural bays/.test(s)));
  for (const [key, c] of columns) assert.equal(d.cells[key], c);
});

test('legacy GPU upload retains collision orientation and consumes roofs as ordinary voxel instances', () => {
  const source = fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8');
  const context = { window: {}, document: {}, console, performance: { now: () => 0 }, Uint8Array, Float32Array };
  vm.runInNewContext(source, context);
  const r = context.window.webglDungeonRenderer, uploads = [];
  const gl = new Proxy({ RGBA32F: 'RGBA32F', FLOAT: 'FLOAT', texImage2D: (...args) => uploads.push(args) }, {
    get: (o, key) => o[key] ?? (() => {})
  });
  Object.assign(r, { gl, roofProfilesTex: {}, roofCellsTex: {}, wallAtlasTex: {}, floorTex: {}, cellTex: {} });
  const d = { layout: { width: 2, height: 2 }, tiles: {}, cells: {
    '0,0': { tile: 'floor', floorHeight: 0, ceilHeight: 3, roof: { height: 4.35, slopeX: 0.4, slopeY: 0, style: 'barrel' } },
    '1,1': { tile: 'wall', floorHeight: 0.5, ceilHeight: 3.5 }
  }, sceneStructures: [{ shape: 'pediment' }] };
  r.rebuildDungeonTextures(d, {});
  const packed = r.sceneCellData;
  assert.equal(packed.length, 16);
  assert.equal(packed[3], 0);
  assert.equal(packed[15], 255);
  assert.ok(!uploads.some(a => a[2] === 'RGBA32F'));
  assert.equal(r.hasStructures, true);
  assert.ok(!source.includes('const roofFsSource'));
  assert.match(source, /voxelInstances\.push\(\{ tileName: part\.tile, mesh, modelPos: p, modelScale: s \}\)/);
  gl.getParameter = gl.getUniform = gl.readPixels = () => { throw Error('Automatic diagnostics must not query the GPU'); };
  const report = r.getRenderingDiagnostics(d, { gpuReadback: false });
  assert.equal(report.cpuToPackedMismatches, 0);
  assert.equal(report.gpuReadback, false);
  assert.equal(report.gpuUploadByteMismatches, null);
});

test('overhead architecture matches column range, including diagonal and extended footprints', () => {
  const source = fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8');
  const start = source.indexOf('for (const part of dungeon.sceneStructures || [])');
  const end = source.indexOf('voxelInstances.push(...actorVoxelInstances)', start);
  assert.ok(start > 0 && end > start);
  const parts = [
    { tile: 'roof', position: { x: 12, y: 12, z: 4 }, size: { x: 4, y: 5, z: 1 } },
    { tile: 'pediment', position: { x: 60, y: 60, z: 4 }, size: { x: 4, y: 1, z: 1 } },
    { tile: 'dome', position: { x: 50, y: 50, z: 4 }, size: { x: 30, y: 30, z: 2 } },
    { tile: 'far-roof', position: { x: 130, y: 130, z: 4 }, size: { x: 4, y: 5, z: 1 } },
    { tile: 'extended-roof', position: { x: -80, y: 0, z: 4 }, size: { x: 20, y: 5, z: 1 } },
    { tile: 'invalid', position: { x: NaN, y: 0, z: 4 }, size: { x: 4, y: 5, z: 1 } },
    { tile: 'invalid', position: { x: 20, y: 20, z: 4 }, size: { x: 4, y: 5, z: 0 } }
  ];
  for (const [playerX, playerY, expected] of [
    [0, 0, ['roof', 'pediment', 'dome', 'extended-roof']],
    [100, 100, ['pediment', 'dome', 'far-roof']],
    [500, 500, []]
  ]) {
    const instances = [], fetched = [];
    const context = { dungeon: { sceneStructures: parts }, voxelInstances: instances, playerX, playerY,
      VIS_RADIUS: 10, VOXEL_VIS_RADIUS: 64,
      renderer: { getVoxelMesh(tile) { fetched.push(tile); return { tile }; } } };
    vm.runInNewContext(`(function() { ${source.slice(start, end)} }).call(renderer)`, context);
    assert.deepEqual(fetched, expected);
    assert.deepEqual(instances.map(i => i.tileName), fetched);
    for (const instance of instances) {
      const part = parts.find(p => p.tile === instance.tileName);
      assert.equal(instance.modelPos, part.position);
      assert.equal(instance.modelScale, part.size);
    }
  }
});

test('all ground voxel shapes use the original column range, not the short billboard range', () => {
  const source = fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8');
  assert.match(source, /const VOXEL_VIS_RADIUS = Math.max\(VIS_RADIUS, 64\)/);
  const start = source.indexOf('for (let dx = -VOXEL_VIS_RADIUS');
  const end = source.indexOf('// Views:', start);
  assert.ok(start > 0 && end > start);
  const cells = {
    '0,0': { tile: 'pillar', floorHeight: 0, ceilHeight: 3 },
    '64,64': { tile: 'custom_tree', floorHeight: 0, ceilHeight: 3 },
    '-64,64': { tile: 'custom_altar', floorHeight: 0, ceilHeight: 3 },
    '64,-64': { tile: 'custom_obelisk', floorHeight: 0, ceilHeight: 3 },
    '65,0': { tile: 'custom_outside', floorHeight: 0, ceilHeight: 3 }
  };
  const instances = [], fetched = [];
  const context = { dungeon: { cells, tiles: {} }, window: {}, voxelInstances: instances,
    VOXEL_VIS_RADIUS: 64, TORCH_VIS_RADIUS: 64, VIS_RADIUS: 10,
    playerX: 0, playerY: 0, camX: 0, camY: 0, width: 320, height: 180, horizon: 90, eyeZ: 0.65,
    dirX: 1, dirY: 0, planeX: 0, planeY: 0.66, focalLength: 160,
    SPRITE_WORLD_HEIGHT: 1, SPRITE_WIDTH_RATIO: 0.6, collectVoxelTorchRectsForWebGPU: false,
    renderer: { voxelProgram: {}, voxelMeshes: {}, getVoxelMesh(tile) { fetched.push(tile); return { tile }; } } };
  vm.runInNewContext(`(function() { ${source.slice(start, end)} }).call(renderer)`, context);
  assert.deepEqual(fetched.sort(), ['custom_altar', 'custom_obelisk', 'custom_tree', 'pillar']);
  assert.equal(instances.length, 4);
});

test('legacy shaders retain lighting and clipping apart from explicit height traversal and downhill view shift', () => {
  const source = fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8').replace(/\r\n/g, '\n');
  // World/fragment programs recorded from 284bd86; vertex hash includes the near-plane clipping fix.
  for (const [name, expected] of Object.entries({
    fsSource: '9d4d4a138f4d9029854dc4df4273ff03a065a66060c339778e55474d60c2e73d',
    voxelVs: 'fc9a5f376a5e6a8ef7e00cc9b22bfaa76988951b9897d6d3c2b904b504ebefaf',
    voxelFs: 'b4e7dbef445ea5ae5fecc80e84d769f699c4cc0913a51555bd98b36b32ec6835'
  })) {
    const start = source.indexOf(`const ${name} = `);
    const end = name === 'voxelVs' ? source.indexOf(';', source.indexOf('].join', start)) + 1 : source.indexOf('`;', start) + 2;
    let program = source.slice(start, end);
    if (name === 'fsSource') {
      assert.match(program, /if \(wallHit\) break;/);
      assert.match(program, /fCurrDist >= wallDist \|\| \(sideHit && fCurrDist >= sideDistClosest\)/);
      assert.match(program, /float horizon = u_resolution.y \* \(0.5 \+ u_viewShift\)/);
      // Undo only the deliberate view-shift and termination fixes; lighting stays byte-pinned.
      program = program.replace("      // A wall outside this pixel's vertical span cannot hide a taller surface behind it.\n      if (wallHit) break;", '      break;')
        .replace('if (!inBounds(fMapX, fMapY) || fCurrDist >= wallDist || (sideHit && fCurrDist >= sideDistClosest)) break;',
          'if (!inBounds(fMapX, fMapY) || fetchCell(fMapX, fMapY).a >= 0.5) break;')
        .replace('uniform float u_viewShift;\n', '')
        .replace('float horizon = u_resolution.y * (0.5 + u_viewShift);', 'float horizon = u_resolution.y * 0.5;');
    } else if (name === 'voxelVs') {
      assert.match(program, /- 2.0 \* u_viewShift \* transformY/);
      program = program.replace("        'uniform float u_viewShift;',\n", '')
        .replace('(2.0 * u_focalLength / u_resolution.y) - 2.0 * u_viewShift * transformY;', '(2.0 * u_focalLength / u_resolution.y);');
    }
    assert.equal(crypto.createHash('sha256').update(program).digest('hex'), expected, name);
  }
  assert.match(source, /const MAX_TORCH_LIGHTS = 64/);
});

test('startup stage logging is bounded, CPU-only, and identifies the room/run without exporting its grid', async () => {
  const source = fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8');
  const calls = [];
  const context = { window: { location: { protocol: 'http:' }, currentDungeon: {
    geoKey: '0,0,0', _geometryStamp: 'test-stamp', _meta: { runId: 'test-run' }, cells: { huge: 'not exported' }
  } }, navigator: { sendBeacon: (url, body) => { calls.push({ url, body }); return true; } }, Blob,
    console: { info() {}, log() {}, warn() {} } };
  vm.runInNewContext(source, context);
  const renderer = context.window.webglDungeonRenderer;
  renderer.gl = new Proxy({}, { get() { throw Error('Startup telemetry must not query GL'); } });
  renderer.startupStartedAt = Date.now();
  for (let i = 0; i < 30; i++) renderer.reportStartupStage('world-link-start');
  assert.equal(renderer.startupEvents.length, 24);
  const record = JSON.parse(await calls[0].body.text());
  assert.equal(calls[0].url, '/debug/dungeon-rendering');
  assert.equal(record.runId, 'test-run'); assert.equal(record.geoKey, '0,0,0');
  assert.equal(record.stage, 'world-link-start');
  assert.equal(record.shaderBaseline, 'legacy-284bd86');
  assert.deepEqual(record.samples, []); assert.equal(record.cells, undefined);
  assert.ok(calls[0].body.size < 500);
});
