'use strict';
process.env.HOLODEK_GENRE_EXPANSION = '1';
process.env.HOLODEK_ARCHITECTURE_EXPANSION = '1';
process.env.HOLODEK_SPRITE_DIR = require('node:path').resolve('.retort-data/genre-assets-tests/sprites');
const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../retort/settingLayer'), K = require('../assets/genreKits');
const P = require('../retort/genreAssetPolicy'), L = require('../retort/levelSpec');
const B = require('../retort/indoorBlueprint'), Design = require('../retort/blueprintDesign');
const { applySceneArchitecture } = require('../retort/sceneArchitecture');
const { applySceneRoofs } = require('../retort/sceneRoofs');
const world = genres => ({ kind: 'homebrew', seed: 'approved-assets', genres,
  genreWeights: genres.map(genre => ({ genre, weight: 1 / genres.length })) });
test.afterEach(() => S.setActive(null));

test('all 18 genre catalogs contain only registered native assets and explicitly shared assets', () => {
  assert.equal(Object.keys(K.GENRES).length, 18);
  for (const genre of Object.keys(K.GENRES)) {
    const c = P.catalog({}, world([genre]));
    assert.ok(c.shapes.length > 3, genre);
    for (const shape of c.shapes.filter(K.has)) assert.ok(K.OWNER[shape].includes(genre), `${genre}: ${shape}`);
    for (const role of ['support','beam','roof_panel']) {
      const id = `g_${genre}_${role}`;
      assert.ok(c.shapes.includes(id)); assert.ok(K.build(id, 16).some(Boolean));
    }
  }
});

test('a station cannot select a gothic window, classical column, western prop or invented shape', () => {
  S.setActive(world(['sci-fi']));
  const c = P.catalog(), schema = L.schemaFor();
  for (const bad of ['g_gothic_window','doric_column','g_saloon_sign','invented_spaceship']) {
    assert.ok(!c.shapes.includes(bad)); assert.ok(!schema.structures[0].shape.split('|').includes(bad));
    assert.match(L.validate({ wall: {}, floor: {}, structures: [{ name: 'Bad', shape: bad, assembly: { kit: 'generic' } }] }).join(' '), /unsupported/);
  }
  assert.deepEqual(c.roofs, ['panel']); assert.deepEqual(c.columns, ['plain']);
  assert.ok(c.held.includes('blaster_rifle')); assert.ok(!c.held.includes('scythe_long'));
  assert.ok(!schema.structures[0].assembly.kit.includes('altar'));
  assert.match(L.buildMessages({}).at(-1).content, /APPROVED PROCEDURAL ASSETS/);
});

test('intentional genre blends and explicit portal realms are allowed; stale room metadata cannot add a genre', () => {
  const setting = world(['sci-fi','noir']);
  const c = P.catalog({ genreKit: { genre: 'fantasy' } }, setting);
  assert.equal(c.genre, 'sci-fi'); assert.ok(c.shapes.includes('g_blind_window'));
  assert.ok(c.shapes.includes('g_console')); assert.ok(!c.shapes.includes('g_gothic_window'));
  const portal = P.catalog({ planarRealm: { genre: 'western' } }, setting);
  assert.equal(portal.genre, 'western'); assert.ok(portal.shapes.includes('g_saloon_sign'));
});

test('canonical Children of the Grave preserves its architecture and never exposes technological kits', () => {
  const c = P.catalog({}, null);
  assert.equal(c.strict, false); assert.ok(c.shapes.includes('doric_column'));
  assert.ok(!c.shapes.includes('g_console'));
  const d = { cells: { '1,1': { tile: 'pillar' } }, tiles: { pillar: { spriteSpec: { voxelShape: 'doric_column' } } } };
  const before = structuredClone(d); P.enforceDungeon(d, {}, null); assert.deepEqual(d, before);
});

test('legacy scene keywords and assemblers cannot override an approved native shape', () => {
  S.setActive(world(['sci-fi']));
  const level = L.deriveLevelSpecFromText({ description: 'Inside a pressure habitat, support columns stand beside an airlock.' });
  assert.ok(level.structures.every(s => P.catalog().shapes.includes(s.shape)));
  const scene = { indoor: true, landmarks: [{ type: 'tomb', label: 'archive storage', assembly: { kit: 'sarcophagus' } }] };
  L.applyLevelSpecToScene(scene, level);
  for (const lm of scene.landmarks) {
    assert.ok(P.catalog().shapes.includes(lm.prim.shape));
    if (K.has(lm.prim.shape)) assert.equal(lm.assembly.kit, 'generic');
  }
});

test('old rooms receive a visual-only upgrade while retaining collision, positions, controls and loot', () => {
  S.setActive(world(['sci-fi']));
  const d = { cells: { '1,1': { tile: 'pillar', floorHeight: 2, ceilHeight: 6, structureHeight: 4 } },
    sceneSpec: { indoor: true }, sceneObjects: [{ name: 'Quest ledger', x: 3, y: 4 }],
    tiles: { pillar: { spriteSpec: { profile: 'cylinder' } }, lintel: { spriteSpec: { voxelShape: 'entablature' } },
      roof: { spriteSpec: { voxelShape: 'barrel_vault_shell' } }, puzzle: { spriteSpec: { voxelShape: 'puzzle_dial_0' } },
      exit: { spriteSpec: { voxelShape: 'exit_gate' } } },
    sceneStructures: [{ tile: 'roof', shape: 'barrel_vault_shell', position: { x: 3, y: 4, z: 6 }, size: { x: 5, y: 6, z: 1 } }] };
  const cells = structuredClone(d.cells), objects = structuredClone(d.sceneObjects), part = structuredClone(d.sceneStructures[0]);
  const result = P.enforceDungeon(d);
  assert.equal(result.changed, 3);
  assert.deepEqual(d.cells, cells); assert.deepEqual(d.sceneObjects, objects);
  assert.deepEqual(d.sceneStructures[0].position, part.position); assert.deepEqual(d.sceneStructures[0].size, part.size);
  assert.equal(d.tiles.pillar.spriteSpec.voxelShape, 'g_sci-fi_support');
  assert.equal(d.sceneStructures[0].shape, 'g_sci-fi_roof_panel');
  assert.match(d.tiles.pillar.url, /^data:image\/png;base64,/);
  assert.equal(d.tiles.puzzle.spriteSpec.voxelShape, 'puzzle_dial_0');
  assert.equal(d.tiles.exit.spriteSpec.voxelShape, 'exit_gate');
  assert.equal(P.enforceDungeon(d).changed, 0, 'upgrades are idempotent');
});

test('blueprint scope prevents classical modules from returning through omitted-design enrichment', () => {
  S.setActive(world(['sci-fi']));
  const raw = { indoorPlan: { rooms: [{ x: .05, y: .05, w: .4, h: .4, roofStyle: 'barrel' }], modules: [{ type: 'portico' }, { type: 'staircase' }] } };
  const result = Design.enrich(raw, { classification: { indoor: true }, size: 64 });
  assert.deepEqual(result.indoorPlan.modules.map(m => m.type), ['staircase']);
  assert.equal(result.indoorPlan.rooms[0].roofStyle, 'panel');
  assert.equal(raw.indoorPlan.rooms[0].roofStyle, 'barrel', 'no mutation of saved source plans');
});

test('compiled station roof and supports use native meshes rather than temple silhouettes', () => {
  S.setActive(world(['sci-fi']));
  const plan = { rooms: [{ x: .08, y: .08, w: .8, h: .8, role: 'entrance', roofStyle: 'panel', clearance: 5 }], corridors: [] };
  const d = { layout: { width: 32, height: 32 }, start: { x: 16, y: 24 }, cells: {}, tiles: {},
    classification: { indoor: true }, generation: { seed: 'station-roof' }, blueprint: { indoorPlan: plan } };
  const spec = { indoor: true, architecture: 'ship', source: { roomName: 'Docking Ring', description: 'Inside a sealed pressure habitat.' } };
  B.build(d, plan, { ceil: 5 }); applySceneArchitecture(d, spec); applySceneRoofs(d, spec); P.enforceDungeon(d, spec);
  assert.ok(d.sceneStructures.length > 0);
  assert.ok(d.sceneStructures.every(p => P.catalog().shapes.includes(p.shape)));
  assert.ok(d.sceneStructures.some(p => p.shape === 'g_sci-fi_roof_panel'));
  assert.ok(!JSON.stringify(d.sceneStructures).match(/doric_column|barrel_vault_shell|entablature/));
  assert.ok(Object.values(d.cells).some(c => c.roof?.style === 'panel'));
});

test('the same approved assets paint nonempty map sprites and voxel meshes', () => {
  const { createCanvas } = require('canvas');
  for (const shape of ['g_console','g_sci-fi_support','g_sci-fi_roof_panel','x_sci-fi_hall']) {
    const canvas = createCanvas(96, 96), ctx = canvas.getContext('2d');
    assert.equal(K.paint(ctx, shape, 0, 0, 96, 96), true);
    assert.ok(ctx.getImageData(0, 0, 96, 96).data.some((v, i) => i % 4 === 3 && v > 0), shape);
    assert.ok(K.build(shape, 16).some(Boolean));
  }
});

test('all-model custom scenery requests expose an enum, not executable programs or foreign IDs', async () => {
  S.setActive(world(['sci-fi']));
  const requests = [], prompts = [];
  const $ = { user: async text => prompts.push(text), assistant: { generation: async options => {
    requests.push(options);
    assert.deepEqual(Object.keys(options.parameters), ['shape']);
    assert.ok(options.parameters.shape.enum.includes('g_console'));
    assert.ok(!options.parameters.shape.enum.includes('g_saloon_sign'));
    return { content: JSON.stringify({ shape: 'g_console' }) };
  } } };
  const tiles = await P.generateTiles($, { roomDesc: 'A docking ring', requiredTypes: ['navigation_console'] });
  assert.equal(requests.length, 1); assert.equal(tiles[0].type, 'navigation_console');
  assert.equal(tiles[0].spriteSpec.voxelShape, 'g_console'); assert.deepEqual(tiles[0].procedure.program, []);
  assert.ok(prompts.some(text => text.includes('approved')));
});

test('every genre has twenty-six labeled furnishing families with drawable meshes', () => {
  const F = require('../assets/genreFurnishings'), hashes = new Set(), crypto = require('node:crypto');
  assert.equal(Object.keys(F.SHAPES).length, 468);
  for (const genre of Object.keys(K.GENRES)) {
    const c = P.catalog({}, world([genre])), suite = [];
    for (const role of F.ROLES) {
      const id = `f_${genre}_${role}`;
      assert.ok(c.shapes.includes(id), id);
      assert.ok(K.GENRES[genre].props.includes(id), id);
      assert.ok(F.SHAPES[id].label.length > 3);
      const voxels = K.build(id, 16);
      assert.ok(voxels.some(Boolean), id); suite.push(voxels);
    }
    const signature = crypto.createHash('sha256').update(Buffer.concat(suite.map(v => Buffer.from(v)))).digest('hex');
    assert.ok(!hashes.has(signature), genre + ' must not be a whole-suite palette swap'); hashes.add(signature);
  }
});

test('expanded genres have authored wardrobes, not one shared fantasy outfit', () => {
  const { WARDROBES } = require('../assets/genreExpansion');
  for (const [genre, wardrobe] of Object.entries(WARDROBES)) {
    assert.deepEqual(K.GENRES[genre].clothing.head, wardrobe.head);
    assert.ok(wardrobe.head.length >= 3); assert.ok(wardrobe.torso.length >= 3);
  }
  assert.ok(K.GENRES.underwater.gear.includes('oxygen_pack'));
  assert.ok(K.GENRES.dieselpunk.held.includes('rifle'));
  assert.ok(!K.GENRES.prehistoric.held.includes('scanner'));
});

test('genre sprites have shape-specific cache keys rather than sharing the first generic image', () => {
  S.setActive(world(['sci-fi']));
  const { applySceneGraphics } = require('../retort/sceneRoomBuilder');
  const d = { tiles: {}, cells: {}, generation: { seed: 'native-sprite-cache' } };
  const spec = { indoor: true, architecture: 'ship', source: { roomName: 'Workshop', description: 'A station workshop.' },
    landmarks: ['g_console','f_sci-fi_storage'].map(type => ({ type, count: 1, prim: { shape: type } })) };
  applySceneGraphics(d, spec, { geoKey: '0,0,0', customTiles: [] });
  const tiles = d.customTiles.map(t => d.tiles[t.name]);
  assert.equal(tiles.length, 2); assert.notEqual(tiles[0].url, tiles[1].url);
  assert.ok(tiles.every(t => K.has(t.spriteSpec.voxelShape)));
});

test('browser loads the furnishing registry before expansion, kits and voxel renderers', () => {
  const fs = require('node:fs'), html = fs.readFileSync('assets/index.html', 'utf8');
  const offsets = ['genreFurnishings.js','genreExpansion.js','genreKits.js','scenePropVoxels.js'].map(file => html.indexOf('/assets/' + file));
  assert.ok(offsets.every(n => n >= 0));
  assert.deepEqual(offsets, [...offsets].sort((a,b) => a-b));
});
