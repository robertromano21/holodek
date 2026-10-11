'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../retort/sceneExterior');
const X = require('../assets/dungeonExits');
const V = require('../assets/scenePropVoxels');
const G = require('../retort/dungeonGeneration');
const T = require('../retort/outdoorTerrain');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
function fixture(seed, size = 128) {
  const spec = { indoor: false, coords: { x: -1, y: -1, z: 0 }, exits: ['northeast', 'south'],
    source: { roomName: 'Shifting Cairns', description: 'Rolling ash hills and dead trees surround ruined temple walls.' },
    generation: { seed, gridSize: size } };
  E.prepareSceneExteriors(spec, { '0,0,0': { name: 'Ruined Temple Entrance', indoor: true,
    classification: { wallColor: '#547b88', floorColor: '#52624c' } } }, { seed });
  const d = { layout: { width: size, height: size }, start: { x: size / 2, y: size * .75 }, cells: {},
    tiles: { floor: { url: '/floor.png' }, wall: { url: '/wall.png' } }, sceneStructures: [],
    generation: spec.generation, outdoorTerrain: T.plan(spec, size), geoKey: '-1,-1,0', visualStyle: { palette: { primary: '#805b38' } } };
  return { d, spec };
}
function build(d, spec, blueprint = {}) {
  const start = source.indexOf('function buildDungeonFromBlueprint(');
  const context = { Math, DungeonGeneration: G, OutdoorTerrain: T, BlueprintPillars: require('../retort/blueprintPillars'),
    buildSceneExteriorSites: E.buildSceneExteriorSites, console: { info() {}, log() {}, warn() {}, error() {} } };
  vm.runInNewContext(source.slice(start, source.indexOf('async function runDungeonTestingMode', start)), context);
  context.buildDungeonFromBlueprint(d, { indoor: false, biome: 'wasteland' }, blueprint, [], spec);
}

for (const seed of ['mountain-temple-a', 'mountain-temple-b', 'mountain-temple-c']) {
  test(`source blueprint reserves a colorful monumental temple before props and cliff dressing (${seed})`, () => {
    const { d, spec } = fixture(seed);
    build(d, spec, { props: [{ type: 'unused', x: .7, y: .4 }] });
    const report = d.sceneExteriors;
    assert.equal(report.placed, 1, JSON.stringify(report));
    const b = report.buildings[0], m = d.roomExits.markers.find(m => m.direction === 'northeast');
    assert.ok((b.transverse >= 29 || b.siteVariant) && b.wallHeight >= 12 && b.towerHeight >= 20);
    assert.ok(b.attempts <= 96, 'Foundation search stays bounded even on steep terrain');
    assert.ok(b.counts.foundationCells > 0 && b.counts.structuralParts < 100);
    assert.equal(m.key, `${b.doorway.x},${b.doorway.y}`);
    assert.equal(m.floor, d.cells[m.key].floorHeight);
    assert.equal(X.nearby(d, { x: m.x + .5, y: m.y + .5 }, .05), m);
    const nav = reachable(makeNavigation(d), d.start);
    for (const exit of d.roomExits.markers) assert.ok(nav.seen[exit.y * d.layout.width + exit.x], exit.direction);
    const gate = d.sceneStructures.find(p => p.role === 'exterior-closed-gate');
    assert.ok(gate && gate.position.z === m.floor);
    const fx = b.doorway.x - b.doorway.approach.x, fy = b.doorway.y - b.doorway.approach.y;
    assert.equal(d.cells[`${m.x + fx},${m.y + fy}`].blocked, true);
    assert.ok(d.sceneStructures.some(p => p.role === 'exterior-mountain-backdrop'));
    assert.ok(d.sceneStructures.some(p => p.role === 'exterior-distant-sanctum'));
    assert.ok(b.doorway.supports.every(key => d.cells[key].tile === 'torch' && d.cells[key].feature === 'torch'));
    assert.equal(d.tiles[d.sceneStructures.find(p => p.role === 'exterior-wall-box').tile].spriteSpec.palette.primary, b.palette.primary);
    assert.notEqual(b.palette.primary, d.visualStyle.palette.primary, 'Use the destination temple colors, not brown wasteland colors');
    for (const p of d.sceneStructures.filter(p => p.exteriorDestination)) {
      assert.ok(p.position.z + p.size.z <= report.maxHeight);
      assert.ok(V.build(p.shape), p.shape);
    }
    const before = JSON.stringify(d);
    assert.equal(E.buildSceneExteriorSites(d, spec), report);
    assert.equal(E.applySceneExteriors(d, spec), report);
    assert.equal(JSON.stringify(d), before);
  });
}

test('later blueprint platforms and mountain prefabs cannot overwrite an already planned exit foundation', () => {
  const a = fixture('protected-foundation'), b = fixture('protected-foundation');
  build(a.d, a.spec);
  const door = a.d.sceneExteriors.buildings[0].doorway;
  const p = { x: door.x / 128, y: door.y / 128, w: .08, h: .08, height: 60 };
  build(b.d, b.spec, { prefabs: [{ ...p, type: 'platform' }, { ...p, type: 'mountain' }],
    volumes: [{ ...p, tile: 'wall', ceil: 90 }] });
  for (const [key, c] of Object.entries(a.d.cells).filter(([, c]) => c.exteriorFoundation || c.exteriorRole)) {
    assert.deepEqual(b.d.cells[key], c, key);
  }
});

test('the 3D exit frame is raised above sloping ground and remains nonblocking', () => {
  const { d } = fixture('exit-visibility', 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: x * .02 + y * .01, ceilHeight: 4 };
  X.install(d, ['east']);
  const marker = d.roomExits.markers[0], frame = d.sceneStructures[0];
  assert.ok(frame.position.z > marker.floor);
  assert.ok(frame.size.z * .6 >= .2, 'The old 3.6cm frame disappeared into the floor');
  assert.equal(d.tiles[frame.tile].spriteSpec.collisionBlocking, false);
  assert.equal(X.nearby(d, { x: marker.x + .5, y: marker.y + .5 }), marker);
});

test('old saved exterior reports remain authoritative without geometry or IndexedDB migrations', () => {
  const { d, spec } = fixture('saved');
  d.sceneExteriors = { version: 1, status: 'skipped', requested: 1, placed: 0 };
  const before = JSON.stringify(d);
  assert.equal(E.buildSceneExteriorSites(d, spec), d.sceneExteriors);
  assert.equal(JSON.stringify(d), before);
});
