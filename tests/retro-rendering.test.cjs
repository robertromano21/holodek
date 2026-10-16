'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createCanvas } = require('canvas'), C = require('../assets/renderCharacterProcedural'), S = require('../assets/renderCharacterSprite');
const motion = require('../assets/characterMotion3d');
const Retro = require('../assets/retroGraphics');
const webgl = fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8');
const webgpu = fs.readFileSync(require.resolve('../assets/rendererWebGPU'), 'utf8');
function harness() {
  let retro = true, nextTexture = 0;
  const uniforms = [], root = { ProceduralCharacters: C, CharacterMotion3D: motion,
    RetroGraphics: { fullbright: () => retro, worldCharacterPixels: Retro.worldCharacterPixels,
      environment: Retro.environment, treasurePixels: Retro.treasurePixels,
      palettePixels: Retro.palettePixels },
    createCharacterSpriteSheetCanvas: S.createCharacterSpriteSheetCanvas, WEBGPU_VOXEL_PREWARM: false };
  const document = { createElement: () => createCanvas(1, 1), getElementById: id => id === 'dungeon-popup' ? { style: { display: 'block' } } : {} };
  const context = { window: root, document, console, Date, performance, clearTimeout };
  vm.runInNewContext(webgl, context);
  const renderer = root.webglDungeonRenderer;
  renderer.gl = new Proxy({ createTexture: () => ({ id: ++nextTexture }),
    uniform1f: (key, value) => uniforms.push([key, value]), getParameter: () => false, isEnabled: () => false }, {
    get: (target, key) => key in target ? target[key] : /^[A-Z_0-9]+$/.test(key) ? key : () => {}
  });
  return { root, document, context, renderer, uniforms, setRetro: value => { retro = value; } };
}
test('retro characters retain every pixel of their existing world silhouette, pose and stature instead of using map art', () => {
  const h = harness();
  for (const race of ['Human', 'Elf', 'Dwarf', 'Halfling', 'Ash serpent', 'Mortacia']) {
    const spec = race === 'Mortacia' ? C.getPresetProceduralSpec(race) : C.buildProceduralSpriteSpec({ name: 'Retro ' + race, race, class: 'Fighter' });
    const actor = { name: spec.name, type: 'monster', mazeX: 1, mazeY: 1, sprite: { spec } }, before = JSON.stringify(actor);
    const bb = h.renderer._getCharacterBillboard(actor, 1.5, 1.5, 0, 0, 0);
    const expected = C.renderBillboardPixels(spec, { frame: 0, view: bb.view, facing: bb.facing });
    assert.equal(bb.pixels.w, expected.w); assert.equal(bb.pixels.h, expected.h);
    assert.equal(JSON.stringify(bb.pixels.bounds), JSON.stringify(expected.bounds));
    assert.ok(bb.pixels.data.every((value, i) => i % 4 !== 3 || value === expected.data[i]), 'Alpha coverage is identical');
    const bodyHeight = bb.pixels.bodyHeight || bb.pixels.bounds.maxY - bb.pixels.bounds.minY + 1;
    const stature = C.humanoidWorldStature(spec);
    if (stature > 0) assert.ok(Math.abs(bb.worldHeight * bodyHeight / bb.pixels.h - stature) < 1e-6);
    assert.equal(JSON.stringify(actor), before);
    actor.type = 'npc'; assert.equal(h.renderer._getCharacterBillboard(actor, 1.5, 1.5, 0, 0, 0).tex, bb.tex);
    h.setRetro(false); const modern = h.renderer._getCharacterBillboard(actor, 1.5, 1.5, 0, 0, 0);
    assert.notEqual(modern.tex, bb.tex, 'Modern uses its own undisturbed art cache');
    assert.equal(modern.worldHeight, bb.worldHeight); assert.equal(modern.footInset, bb.footInset);
    h.setRetro(true); assert.equal(h.renderer._getCharacterBillboard(actor, 1.5, 1.5, 0, 0, 0).tex, bb.tex);
  }
});

test('real combat-map redraw assigns distinct gray grid/floor and solid red walls only in retro mode', () => {
  const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  let retro = false;
  const calls = [], graphics = () => new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); } });
  const context = { window: { RetroGraphics: { fullbright: () => retro }, combatCharacters: [] }, Phaser: { Scene: class {} },
    currentDungeon: { cells: { '0,0': { tile: 'floor' }, '1,0': { tile: 'wall' } } }, dungeonTextures: {},
    getPlayerPosForMap: () => ({ x: .5, y: .5 }), getCombatMapRotationAngle: () => 0,
    isBlockedDungeonCell: c => c.tile === 'wall', isDungeonCliffEdge: () => false, isObstacleTile: () => false,
    syncCombatActorOverlayFromMaze() {}, drawDungeonExitMapMarkers() {}, setCombatPlayerTokenOwner() {} };
  vm.runInNewContext(source.slice(source.indexOf('class CombatScene extends'), source.indexOf('const gameConfig =')) + '\nthis.CombatScene=CombatScene;', context);
  const scene = new context.CombatScene();
  Object.assign(scene, { characters: {}, pcName: '', gridSize: 3, cellSize: 25, PIXEL_SCALE: 2, RT_CELL: 12.5,
    renderRT: { clear() {}, draw() {} }, make: { graphics }, textures: { exists: () => false } });
  for (const enabled of [true, false]) {
    retro = enabled; calls.length = 0; scene.redrawCombatRT();
    assert.ok(calls.some(c => c[0] === 'fillStyle' && c[1] === (enabled ? 0x474747 : 0x222222)));
    assert.ok(calls.some(c => c[0] === 'fillStyle' && c[1] === (enabled ? 0x96282e : 0x550000) && c[2] === (enabled ? 1 : .7)));
    assert.ok(calls.some(c => c[0] === 'lineStyle' && c[2] === (enabled ? 0xaeaeae : 0x888888) && c[3] === (enabled ? 1 : .35)));
  }
});
test('retro torch guides and flames are steady; Modern retains its original flicker', () => {
  let retro = true;
  const body = webgl.match(/function torchFlicker\(seed, timeMs\) \{([\s\S]*?)\n  \}/)[1];
  const context = { window: { RetroGraphics: { fullbright: () => retro } }, TORCH_FLICKER_SPEED: .6 };
  vm.runInNewContext('function torchFlicker(seed,timeMs){' + body + '\n}', context);
  const values = [];
  for (let time = 0; time < 10000; time += 157) assert.equal(context.torchFlicker(.7, time), .85);
  retro = false;
  for (let time = 0; time < 10000; time += 157) values.push(context.torchFlicker(.7, time));
  assert.ok(new Set(values).size > 10);
});
test('real frame sets bright world/sprite/voxel uniforms and restores them without changing the dungeon', () => {
  const h = harness(), r = h.renderer, d = { geoKey: '0,0,0', _geometryStamp: 'retro-test', layout: { width: 6, height: 6 },
    classification: { indoor: true }, lighting: { dir: 'NW', intensity: .6 }, cells: {}, tiles: {} };
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) d.cells[`${x},${y}`] = { tile: x === 3 && y === 2 ? 'pillar' : 'floor', floorHeight: 0, ceilHeight: 2.5 };
  Object.assign(h.root, { currentDungeon: d, dungeonTextures: {}, playerDungeonX: 1, playerDungeonY: 2,
    playerPosX: 1.5, playerPosY: 2.5, playerAngle: 0, playerZ: .65 });
  r.canvas = { width: 160, height: 120 }; r.cellTex = {}; r.roofCellsTex = {}; r.voxelProgram = {};
  r.uniformLocations = { fullbright: 'world' }; r.spriteUniforms = { fullbright: 'sprites' }; r.voxelUniforms = { unlit: 'voxels', retroSurface: 'material', retroInk: 'ink' };
  r.getVoxelMesh = () => ({ count: 6 }); r.buildHaloTexture = r.buildBlobShadowTexture = r.buildFlameTexture = () => {};
  const before = JSON.stringify(d);
  for (const enabled of [false, true, false]) {
    h.setRetro(enabled); h.uniforms.length = 0; r.renderScene();
    assert.ok(h.uniforms.some(([key, value]) => key === 'world' && value === (enabled ? 1 : 0)));
    assert.ok(h.uniforms.some(([key, value]) => key === 'sprites' && value === (enabled ? 1 : 0)));
    assert.ok(h.uniforms.some(([key, value]) => key === 'voxels' && value === (enabled ? 2 : 0)));
    assert.ok(h.uniforms.some(([key, value]) => key === 'material' && value === (enabled ? 1 : 0)));
    assert.equal(h.uniforms.some(([key, value]) => key === 'ink' && value === 1), enabled);
    if (enabled) assert.deepEqual(h.uniforms.filter(([key]) => key === 'ink').map(([, value]) => value), [1, 0]);
    assert.equal(JSON.stringify(d), before);
  }
});

test('large characters retain world height when approached in Modern and Retro; only perspective grows them', () => {
  const h = harness(), r = h.renderer, d = { geoKey: 'size-test', _geometryStamp: 'size-test', layout: { width: 9, height: 9 },
    classification: { indoor: true }, cells: {}, tiles: {} };
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 5 };
  const spec = C.buildProceduralSpriteSpec({ name: 'Large Visitor', race: 'Giant', class: 'Warrior' });
  const actor = { name: spec.name, type: 'monster', hp: 100, state: 'Friendly', mazeX: 5, mazeY: 4, sprite: { spec } };
  let targets;
  Object.assign(h.root, { currentDungeon: d, dungeonTextures: {}, combatCharacters: [actor], gamePaused: true,
    playerDungeonY: 4, playerPosY: 4.5, playerAngle: 0, playerZ: .65,
    WorldInteractionUi: { updateFrame(_d, camera) { targets = camera.billboards; } } });
  r.canvas = { width: 160, height: 120 }; r.cellTex = {}; r.roofCellsTex = {}; r.voxelProgram = {};
  r.uniformLocations = {}; r.spriteUniforms = {}; r.voxelUniforms = {};
  r.buildHaloTexture = r.buildBlobShadowTexture = r.buildFlameTexture = () => {};
  r._getCharacterBillboard = () => ({ tex: {}, worldHeight: 4, footInset: .04,
    motion: { heightScale: 1, upperShift: 0 }, pixels: { w: 1, h: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) } });
  const before = JSON.stringify(actor);
  for (const retro of [false, true]) {
    h.setRetro(retro); let invariant, previous = 0;
    for (const distance of [4, 3, 2, 1, .5]) {
      h.root.playerPosX = 5.5 - distance; h.root.playerDungeonX = Math.floor(h.root.playerPosX);
      r.renderScene();
      const target = targets.find(t => t.type === 'character' && t.character === actor);
      assert.ok(target);
      const screenHeight = target.screen.bottom - target.screen.top;
      assert.ok(screenHeight > previous); previous = screenHeight;
      invariant ??= screenHeight * distance;
      assert.ok(Math.abs(screenHeight * distance - invariant) < 1e-8, 'No distance-dependent shrinking to fit the viewport');
      assert.equal(JSON.stringify(actor), before, 'Movement coordinates and sprite data are unchanged');
    }
  }
});
test('WebGPU uses the complete bright legacy frame without bloom or smoky overlays and restores all Modern options', () => {
  const h = harness();
  Object.assign(h.root, { WEBGPU_NATIVE_WORLD: true, WEBGPU_GPU_HALO_FLAME: true, WEBGPU_BLOOM: true, WEBGPU_POST_TORCH_MASK: true });
  vm.runInNewContext(webgpu, { ...h.context, navigator: {} });
  const gpu = h.root.webgpuDungeonRenderer; gpu.mode = 'webgpu';
  for (const enabled of [false, true, false]) {
    h.setRetro(enabled);
    assert.equal(gpu.shouldUseNativeWorld(), !enabled);
    assert.equal(gpu.shouldDriveHaloFlame(), !enabled);
    assert.equal(gpu.shouldDriveSpriteTorch(), !enabled);
    assert.equal(gpu.getDebugState().bloomEnabled, !enabled);
    assert.equal(h.root.WEBGPU_BLOOM, true); assert.equal(h.root.WEBGPU_GPU_HALO_FLAME, true);
  }
});

test('props retain their original meshes, including image-free shapes; only render-time material policies change', () => {
  const h = harness();
  const d = { visualStyle: { palette: { primary: '#c09048', highlight: '#efefbb', secondary: '#70452b' } }, tiles: {
    custom_archway: { spriteSpec: { voxelShape: 'archway', heightRatio: 1, baseWidth: .9 } },
    pillar: { spriteSpec: { voxelShape: 'doric_column', material: 'stone' } }
  } };
  const before = JSON.stringify(d), r = h.renderer;
  assert.equal(r._getRetroPropImage, undefined);
  assert.equal(r._retroSurfaceKind('pillar', d.tiles.pillar.spriteSpec), 1);
  assert.equal(r._retroSurfaceKind('temple_pediment'), 1);
  assert.equal(r._retroSurfaceKind('coffered_roof'), 2);
  assert.equal(r._retroSurfaceKind('dead_tree'), 0, 'Trees retain their original palette without the recoloring ramp');
  assert.equal(r._retroSurfaceKind('custom_pine', { voxelShape: 'pine' }), 0);
  assert.equal(r._retroSurfaceKind('custom_archway', d.tiles.custom_archway.spriteSpec), 4);
  assert.equal(r._retroSurfaceKind('pillar', { inscription: { text: 'A real clue' } }), 0);
  assert.equal(r._retroSurfaceKind('control', { voxelShape: 'puzzle_lever' }), 0);
  const mesh = r.getVoxelMesh('custom_archway', d);
  assert.ok(mesh.count > 0);
  h.setRetro(false); assert.equal(r.getVoxelMesh('custom_archway', d), mesh);
  assert.equal(JSON.stringify(d), before);
});
