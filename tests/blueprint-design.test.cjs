const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../retort/blueprintDesign');
const G = require('../retort/dungeonGeneration');
const T = require('../retort/outdoorTerrain');
const { applySceneArchitecture, makeNavigation, reachable } = require('../retort/sceneArchitecture');

test('missing indoor modules receive a fitting seeded section without replacing authored rooms or corridors', () => {
  const blueprint = { indoorPlan: { rooms: [{ x: .1, y: .1, w: .3, h: .3, role: 'hall' },
    { x: .4, y: .7, w: .2, h: .2, role: 'entrance' }, { x: .7, y: .1, w: .2, h: .2, role: 'courtyard' }], corridors: [{ fromRoom: 0, toRoom: 1 }] } };
  const before = structuredClone(blueprint), signatures = new Set();
  for (let i = 0; i < 12; i++) {
    const options = { classification: { indoor: true }, size: 128, generation: { seed: `run-${i}` }, description: 'A Roman temple.' };
    const d = D.enrich(blueprint, options);
    assert.deepEqual(d, D.enrich(blueprint, options));
    assert.equal(d.indoorPlan.modules.length, 1); assert.equal(d.indoorPlan.modules[0].room, 0);
    assert.deepEqual(d.indoorPlan.rooms, blueprint.indoorPlan.rooms); assert.deepEqual(d.indoorPlan.corridors, blueprint.indoorPlan.corridors);
    assert.equal(D.enrich(d, options), d, 'An enriched/saved blueprint is not redesigned');
    signatures.add(JSON.stringify(d.indoorPlan.modules));
  }
  assert.ok(signatures.size > 4); assert.deepEqual(blueprint, before);
});

test('authored modules, shrine roles, small room plans and existing buildings are not overwritten to satisfy a quota', () => {
  for (const plan of [
    { rooms: [{ x: .1, y: .1, w: .3, h: .3 }], modules: [{ type: 'portico', room: 0, x: .2 }] },
    { rooms: [{ x: .1, y: .1, w: .3, h: .3, role: 'rotunda' }] },
    { rooms: [{ x: .1, y: .1, w: .02, h: .02 }] }
  ]) {
    const b = { indoorPlan: plan }, d = D.enrich(b, { classification: { indoor: true }, size: 128 });
    assert.deepEqual(d.indoorPlan, b.indoorPlan); assert.equal(d.designContract.added.length, 0);
  }
  const b = { buildings: [{ type: 'temple', x: .1, y: .2, w: .1, h: .1, ruined: true }], paths: [{ from: [0, 0], to: [.1, .2] }] };
  const d = D.enrich(b, { classification: { indoor: false, biome: 'wasteland' } });
  assert.deepEqual(d.buildings, b.buildings); assert.deepEqual(d.paths, b.paths);
  assert.equal(d.designContract.added.length, 0);
});

test('bare wastelands get bounded varied ruin sites and a local approach, while untouched forests and gardens stay natural', () => {
  const shapes = new Set(), positions = new Set();
  for (let i = 0; i < 24; i++) {
    const options = { classification: { indoor: false, biome: 'wasteland' }, size: 512, generation: { seed: `world-${i}` } };
    const d = D.enrich({}, options), b = d.buildings[0];
    assert.deepEqual(d, D.enrich({}, options));
    assert.ok(b.x > 0 && b.y > 0 && b.x + b.w < 1 && b.y + b.h < 1);
    assert.ok(b.w * 512 >= 21 && b.h * 512 >= 25);
    assert.ok(!(.5 >= b.x && .5 <= b.x + b.w && .75 >= b.y && .75 <= b.y + b.h));
    assert.equal(d.paths.length, 1); assert.equal(d.paths[0].widthTiles, 3); assert.equal(d.paths[0].ramp, true);
    shapes.add(`${b.type}:${b.variant || ''}`); positions.add(`${b.x},${b.y}`);
  }
  assert.ok(shapes.size >= 3 && positions.size > 12);
  for (const [biome, description] of [['forest', 'Untouched forest.'], ['garden', 'A sacred garden.'], ['wasteland', 'No buildings disturb these wastes.']]) {
    const d = D.enrich({}, { classification: { indoor: false, biome }, description });
    assert.equal(d.buildings, undefined); assert.equal(d.designContract.added.length, 0);
  }
});

test('automatic building sites survive real terrain construction and safe architectural placement', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const start = source.indexOf('function buildDungeonFromBlueprint(');
  const context = { Math, DungeonGeneration: G, OutdoorTerrain: T, BlueprintPillars: require('../retort/blueprintPillars'), console: { info() {}, log() {}, warn() {}, error() {} } };
  vm.runInNewContext(source.slice(start, source.indexOf('async function runDungeonTestingMode', start)), context);
  for (const seed of ['world-0', 'world-1', 'world-2', 'world-3']) {
    const spec = { indoor: false, biome: 'wasteland', source: { roomName: 'Ash Wastes' }, generation: { seed } };
    const blueprint = D.enrich({}, { classification: spec, size: 128, generation: spec.generation });
    const d = { layout: { width: 128, height: 128 }, start: { x: 64, y: 96 }, cells: {}, tiles: {}, blueprint,
      generation: spec.generation, classification: spec, outdoorTerrain: T.plan(spec, 128) };
    context.buildDungeonFromBlueprint(d, spec, blueprint, []);
    const a = applySceneArchitecture(d, spec);
    assert.equal(a.modules[0].status, 'built', `${seed}: ${JSON.stringify(a.modules)}`);
    const nav = makeNavigation(d), connected = reachable(nav, d.start), site = a.modules[0];
    assert.ok(connected.seen[(site.y + site.height - 2) * nav.width + site.x + Math.floor(site.width / 2)]);
  }
});
