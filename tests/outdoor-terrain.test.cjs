const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('../retort/dungeonGeneration');
const T = require('../retort/outdoorTerrain');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const { summarizeDungeon } = require('../dungeonDiagnostics');

function spec(seed, description = 'Dead trees stand in the wild rocky wasteland.') {
  return { indoor: false, biome: 'wasteland', source: { roomName: 'Ash Wastes', description }, generation: { seed } };
}
test('broad ridges and basins vary between campaigns but remain reproducible for each room', () => {
  const signatures = new Set();
  for (let i = 0; i < 12; i++) {
    const p = T.plan(spec(`run-${i}`));
    assert.deepEqual(p, T.plan(spec(`run-${i}`)));
    assert.ok(p.features.length >= 5 && p.features.length <= 8);
    assert.equal(p.features.filter(f => f.kind === 'basin').length, 2);
    assert.ok(p.features.filter(f => f.kind === 'hill').length >= 2, 'Keep multiple broad hills in the backing landscape');
    const heights = [];
    for (let y = 0; y < 512; y += 8) for (let x = 0; x < 512; x += 8) heights.push(T.heightAt(p, x, y));
    assert.ok(Math.max(...heights) > 10, `Visible relief for campaign ${i}`);
    assert.ok(Math.min(...heights) < -2);
    assert.equal(T.heightAt(p, p.spawn.x, p.spawn.y), 0);
    signatures.add(JSON.stringify(heights));
  }
  assert.equal(signatures.size, 12);
});
test('named flat plains, wetlands and urban rooms retain their geographic character', () => {
  for (const [description, profile] of [['Flat plains spread beyond the frozen lake.', 'flat'],
    ['A bog and marsh surround a wetland.', 'wetland'], ['A city street meets a forum.', 'urban']]) {
    const p = T.plan(spec('same-run', description));
    assert.equal(p.profile, profile);
    assert.equal(p.features.length, 0);
    assert.ok(Math.abs(T.heightAt(p, 200, 200)) < 1);
  }
  assert.equal(T.plan({ ...spec('x'), indoor: true }), null);
  assert.equal(T.plan({ indoor: false }), null);
});
test('real blueprint and fallback builders use the new heightfield, preserve safe spawn and do not mutate source plans', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const context = { Math, DungeonGeneration: G, OutdoorTerrain: T, BlueprintPillars: require('../retort/blueprintPillars'), console: { info() {}, log() {}, warn() {}, error() {} } };
  const start = source.indexOf('function buildDungeonFromBlueprint(');
  vm.runInNewContext(source.slice(start, source.indexOf('async function runDungeonTestingMode', start)), context);
  const outdoor = source.indexOf('function buildOutdoorLayout(');
  vm.runInNewContext(source.slice(outdoor, source.indexOf('async function handleBossRoom(', outdoor)), context);
  for (const mode of ['blueprint', 'fallback']) {
    const shapes = [];
    for (const seed of ['a', 'b', 'a']) {
      const s = spec(seed), terrain = T.plan(s, 80), d = { layout: { width: 80, height: 80 },
        start: { x: 40, y: 60 }, cells: {}, generation: s.generation, outdoorTerrain: terrain };
      const before = JSON.stringify(terrain);
      if (mode === 'blueprint') context.buildDungeonFromBlueprint(d, { indoor: false }, { heightfield: { amplitude: 0 }, seed: 'same-LLM-seed' }, []);
      else context.buildOutdoorLayout(d, { indoor: false }, []);
      assert.equal(d.cells['40,60'].tile, 'floor');
      assert.equal(d.cells['40,60'].floorHeight, 0);
      const nav = makeNavigation(d), connected = reachable(nav, d.start);
      assert.ok(connected.count > 300, `${mode}: spawn can reach more than its own safe pad (${connected.count})`);
      assert.equal(Object.keys(d.cells).length, 6400);
      assert.equal(JSON.stringify(terrain), before);
      assert.equal(summarizeDungeon(d).outdoorTerrain, terrain);
      shapes.push(JSON.stringify(d.cells));
    }
    assert.notEqual(shapes[0], shapes[1], mode);
    assert.equal(shapes[0], shapes[2], mode);
  }
});

test('the restored small-scale hill layer adds detail without replacing broad or designer landforms', () => {
  const p = T.plan(spec('hybrid-relief'), 96);
  const coarse = { ...p, detail: undefined };
  const samples = [];
  for (let y = 0; y < 96; y += 4) for (let x = 0; x < 96; x += 4) samples.push(Math.abs(T.heightAt(p, x, y) - T.heightAt(coarse, x, y)));
  assert.ok(samples.some(d => d > .3));
  assert.ok(samples.every(d => d <= 1.81));
  const combined = T.design(p, { landforms: [{ kind: 'canyon', x: .6, y: .2, radiusX: .1, radiusY: .2, rise: 15 }] }, 96);
  assert.deepEqual(combined.detail, p.detail);
  assert.equal(combined.features.length, p.features.length + 1);
  assert.equal(T.heightAt(p, p.spawn.x, p.spawn.y), 0);
});

test('bounded old-style ruin and prop dressing is seeded and preserves protected design and reachable routes', () => {
  function fixture(seed) {
    const d = { layout: { width: 128, height: 128 }, start: { x: 64, y: 96 }, cells: {}, generation: { seed },
      tiles: { custom_boulder: { spriteSpec: { voxelShape: 'boulder' } } } };
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 2.5 };
    for (let y = 0; y < 128; y++) d.cells[`64,${y}`].navigationReserved = true;
    for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) d.cells[`${x},${y}`].outdoorFoundation = true;
    d.cells['30,70'].interactable = { id: 'seal' };
    return d;
  }
  const a = fixture('dressing-a'), again = fixture('dressing-a'), b = fixture('dressing-b');
  const old = structuredClone(a.cells), before = reachable(makeNavigation(a), a.start);
  const report = T.decorate(a);
  T.decorate(again); T.decorate(b);
  assert.deepEqual(a.cells, again.cells);
  assert.notDeepEqual(a.cells, b.cells);
  assert.ok(report.walls > 0 && report.props > 0, JSON.stringify(report));
  assert.ok(report.placed <= report.budget && report.budget <= 80);
  assert.equal(T.decorate(a), report, 'Saved rooms are not redressed');
  for (const [key, c] of Object.entries(a.cells)) {
    assert.equal(c.floorHeight, old[key].floorHeight);
    if (old[key].navigationReserved || old[key].outdoorFoundation || old[key].interactable) assert.deepEqual(c, old[key]);
  }
  const nav = makeNavigation(a), after = reachable(nav, a.start);
  for (let i = 0; i < before.seen.length; i++) if (before.seen[i] && nav.passable[i]) assert.ok(after.seen[i]);
});

test('outdoor trail grading retains local heights and legacy clearing rectangles no longer excavate global-zero pits', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const context = { Math, DungeonGeneration: G, BlueprintPillars: require('../retort/blueprintPillars'),
    OutdoorTerrain: { design: p => p, heightAt: (_, x, y) => 10 + y * .1 }, console: { info() {}, log() {}, warn() {}, error() {} } };
  const start = source.indexOf('function buildDungeonFromBlueprint(');
  vm.runInNewContext(source.slice(start, source.indexOf('async function runDungeonTestingMode', start)), context);
  const d = { layout: { width: 80, height: 80 }, start: { x: 40, y: 60 }, tiles: {}, generation: { seed: 'graded' }, outdoorTerrain: {} };
  const blueprint = { rooms: [{ x: .7, y: .2, w: .1, h: .1, floor: 0, ceil: 2.5 }],
    paths: [{ from: [.2, .2], to: [.6, .2], width: .08, flatten: true, ramp: true }] };
  context.buildDungeonFromBlueprint(d, { indoor: false }, blueprint, []);
  assert.ok(d.cells['30,16'].floorHeight > 10);
  assert.equal(d.cells['30,16'].terrainRole, 'trail');
  assert.equal(d.cells['30,22'].floorHeight, 12.2, 'An eight-percent path no longer carves an enormous zero-height swath');
  assert.equal(d.cells['58,18'].floorHeight, 11.8, 'Outdoor clearings preserve the local terrain');
  const grounded = { ...d, outdoorTerrain: {}, blueprint: undefined };
  context.buildDungeonFromBlueprint(grounded, { indoor: false }, {
    paths: [{ from: [.2, .2], to: [.6, .2], widthTiles: 3, ramp: true }],
    volumes: [{ x: .3, y: .2, w: .05, h: .05, tile: 'wall', ceil: 3 },
      { x: .7, y: .4, w: .05, h: .05, tile: 'wall', ceil: 3 }],
    prefabs: [{ type: 'ruin_wall', x: .2, y: .4, w: .05, h: .05, height: 4 }]
  }, []);
  assert.equal(grounded.cells['25,16'].tile, 'floor', 'Wall volumes cannot overwrite a reserved trail');
  assert.equal(grounded.cells['58,32'].floorHeight, 13.2, 'Unspecified floors remain on local terrain');
  assert.equal(grounded.cells['58,32'].ceilHeight, 16.2, 'Wall clearance is relative to local terrain');
  assert.equal(grounded.cells['18,32'].ceilHeight, 17.2, 'Legacy ruin prefabs are grounded too');
});

test('designer geology has distinct silhouettes, terraces, winding canyon walls and mineral rims', () => {
  const base = { ...T.plan(spec('geology'), 256), features: [], roll: 0, detail: null, safeRadius: 1 };
  const kinds = ['hill', 'ridge', 'mountain', 'mesa', 'butte', 'hoodoo', 'terraces', 'basin', 'cliff', 'canyon', 'thermal_basin', 'caldera'];
  const plans = Object.fromEntries(kinds.map(kind => [kind, T.design(base, { landforms: [
    { kind, x: .5, y: .25, radiusX: .25, radiusY: .25, rise: 32, angle: 0 }
  ] }, 256)]));
  const at = (kind, dx = 0, dy = 0) => { const p = plans[kind], f = p.features[0]; return T.heightAt(p, f.x + dx, f.y + dy); };
  assert.equal(at('mesa'), at('mesa', 20), 'A mesa has a broad flat cap');
  assert.ok(at('hill', 20) < at('hill') - 5, 'A hill remains rounded');
  assert.ok(at('butte', 28) < at('mesa', 28) - 15, 'Buttes have narrower tops');
  assert.ok(at('hoodoo', 20) < at('butte', 20) - 15, 'Hoodoos have a slender spire');
  assert.equal(at('terraces', 21), at('terraces', 24), 'Terraces have real shelves');
  assert.equal(at('cliff', -20), 0); assert.equal(at('cliff', 20), 32, 'A cliff has an abrupt one-sided escarpment');
  assert.ok(at('canyon') < -25 && at('canyon', 58) > -8, 'A canyon has deep low ground and steep sides');
  assert.ok(at('thermal_basin') < -25 && at('thermal_basin', 54) > 4, 'Thermal bowls have raised mineral rims');
  assert.ok(at('caldera', 29) > at('caldera') + 10, 'A caldera has a crater instead of a cone peak');
  for (const [kind, p] of Object.entries(plans)) {
    assert.equal(p.design.authored, 1, kind);
    assert.equal(T.heightAt(p, p.spawn.x, p.spawn.y), 0);
    const f = p.features[0];
    assert.equal(T.heightAt(p, f.x + f.radiusX * 2, f.y), 0, `${kind}: bounded footprint`);
    for (let y = 0; y < 256; y += 8) for (let x = 0; x < 256; x += 8) assert.ok(Number.isFinite(T.heightAt(p, x, y)), kind);
  }
});

test('biome-aware backing terrain keeps gardens gentle and selects forests, ice, volcanic and badlands features', () => {
  for (const [description, profile, kind] of [
    ['A sacred garden with quiet paths.', 'garden', null], ['A leafless forest with twisted trees.', 'forest', 'hill'],
    ['An icy mountaintop above a glacier.', 'glacial', 'hill'], ['A volcano and its ash-filled crater.', 'volcanic', 'caldera'],
    ['A deep canyon beneath buttes.', 'badlands', 'canyon'], ['Sulfur hot springs and mineral terraces.', 'geothermal', 'thermal_basin']
  ]) {
    const p = T.plan(spec('biome-run', description));
    assert.equal(p.profile, profile, description);
    assert.deepEqual(p, T.plan(spec('biome-run', description)));
    if (kind) assert.ok(p.features.some(f => f.kind === kind), description);
    else { assert.equal(p.features.length, 0); assert.ok(Math.abs(T.heightAt(p, 300, 100)) < 1); }
  }
  const ordinary = T.plan(spec('plain-run', 'The endless plain of ash stretches beneath the jaundiced sky.'));
  assert.equal(ordinary.profile, 'wasteland', 'Plain alone does not erase the outdoor relief');
  assert.ok(ordinary.features.filter(f => f.kind === 'hill').length >= 2);
});

test('new landform requests are capped and validated without mutating the base plan', () => {
  const base = T.plan(spec('bounded-geology')), old = structuredClone(base);
  const f = { kind: 'mesa', x: 5, y: -5, radiusX: 8, radiusY: 8, rise: 800 };
  const d = T.design(base, { landforms: Array(100).fill(f) });
  assert.equal(d.design.authored, 8);
  assert.deepEqual(base, old);
  assert.ok(d.features.slice(base.features.length).every(f => f.rise === 80 && f.x === 511 && f.y === 0));
  const invalid = T.design(base, { landforms: [{ ...f, kind: 'invented' }, { ...f, rise: Infinity }, { ...f, radiusX: 0 }] });
  assert.equal(invalid.design.authored, 0); assert.equal(invalid.design.rejected.length, 3);
});
