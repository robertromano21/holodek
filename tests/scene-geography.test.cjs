const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { planVerticalTransitions, planTerrainRequests, prepareSceneGeography, applySceneGeography } = require('../retort/sceneGeography');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const Collision = require('../assets/voxelCollision');

function fixture(size = 80) {
  const d = { layout: { width: size, height: size }, start: { x: size / 2, y: size / 2 }, cells: {} };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d.cells[`${x},${y}`] = {
    tile: x && y && x < size - 1 && y < size - 1 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 2.5
  };
  const spec = { indoor: false, coords: { x: 0, y: 0, z: 0 }, source: { roomName: 'Mountain Canyon' }, exits: ['up', 'down'], landmarks: [] };
  const db = { '0,0,1': { name: 'Mountain Summit', indoor: false }, '0,0,-1': { name: 'Crypt', indoor: true } };
  prepareSceneGeography(spec, db);
  return { d, spec, db };
}

test('vertical approaches use the NEXT room classification, preserve locks, and do not generate or modify destination rooms', () => {
  const { spec, db } = fixture();
  db['0,0,0'] = { exits: { down: { targetCoordinates: '2,3,-1', status: 'sealed' } } };
  db['2,3,-1'] = { name: 'Lower Canyon', classification: { indoor: false, biome: 'canyon' } };
  const original = JSON.stringify(db), plan = planVerticalTransitions(spec, db);
  assert.equal(plan[0].kind, 'mountain-ascent');
  assert.equal(plan[1].kind, 'canyon-descent');
  assert.equal(plan[1].targetKey, '2,3,-1');
  assert.equal(plan[1].status, 'sealed');
  db['2,3,-1'].classification.indoor = true;
  assert.equal(planVerticalTransitions(spec, db)[1].kind, 'cave-descent');
  db['2,3,-1'].classification.indoor = false;
  assert.equal(JSON.stringify(db), original);
  assert.deepEqual(planVerticalTransitions(spec, JSON.stringify(db)), plan);
  const unknown = planVerticalTransitions(spec, {});
  assert.ok(unknown.every(t => t.kind === 'portal' && t.targetIndoor === null));
  db['0,0,1'].name = 'Floating Celestial Citadel';
  assert.equal(planVerticalTransitions(spec, db)[0].kind, 'celestial-stairway');
  db['0,0,1'].name = 'Planar Portal';
  assert.equal(planVerticalTransitions(spec, db)[0].kind, 'portal');
});

test('mountains and canyons are actual shared floor heights, with steep faces and reserved navigable approaches', () => {
  const { d, spec } = fixture();
  const before = reachable(makeNavigation(d), d.start), report = applySceneGeography(d, spec);
  assert.equal(report.status, 'built', JSON.stringify(report));
  assert.deepEqual(report.features.map(f => f.role), ['mountain', 'canyon']);
  const nav = makeNavigation(d), after = reachable(nav, d.start);
  assert.equal(after.count, before.count);
  assert.equal(d.cells['40,40'].floorHeight, 0, 'Spawn is unchanged');
  assert.ok(Object.values(d.cells).some(c => c.floorHeight >= 8));
  assert.ok(Object.values(d.cells).some(c => c.floorHeight <= -7));
  let steep = 0;
  for (let y = 1; y < 79; y++) for (let x = 1; x < 78; x++) {
    if (Math.abs(d.cells[`${x},${y}`].floorHeight - d.cells[`${x + 1},${y}`].floorHeight) > 1.5) steep++;
  }
  assert.ok(steep > 0, 'Rock faces cannot be casually stepped across');
  for (const feature of report.features) {
    assert.equal(d.cells[`${feature.center.x},${feature.center.y}`].complexExit, feature.direction);
    assert.ok(after.seen[feature.center.y * 80 + feature.center.x]);
    assert.ok(feature.changedCells < 1600, 'Changes are bounded, not a whole-world flattening');
  }
  for (const c of Object.values(d.cells)) assert.ok(Math.abs(c.ceilHeight - c.floorHeight - 2.5) < 1e-9);
  assert.equal(applySceneGeography(d, spec), report);
  assert.deepEqual(JSON.parse(JSON.stringify(d)).cells, d.cells);
});

test('terrain does not move existing torch walls, props, interactive content or reserved architectural paths', () => {
  const { d, spec } = fixture();
  const fixtures = {
    '55,50': { tile: 'torch', feature: 'torch', floorHeight: 0, ceilHeight: 2.5 },
    '60,55': { tile: 'pillar', feature: 'pillar', floorHeight: 0, ceilHeight: 3.5 },
    '28,50': { tile: 'floor', interactable: { id: 'treasure' }, floorHeight: 0, ceilHeight: 2.5 },
    '30,55': { tile: 'floor', architectureRole: 'courtyard', navigationReserved: true, floorHeight: 0, ceilHeight: 2.5 }
  };
  Object.assign(d.cells, fixtures);
  const before = reachable(makeNavigation(d), d.start), report = applySceneGeography(d, spec);
  assert.equal(report.status, 'built', JSON.stringify(report));
  for (const [key, c] of Object.entries(fixtures)) assert.equal(d.cells[key], c, key);
  const after = reachable(makeNavigation(d), d.start);
  for (let i = 0; i < before.seen.length; i++) if (before.seen[i]) assert.ok(after.seen[i]);
});

test('indoor rooms, disabled geography, insufficient sites and unclassified destinations never force terrain regeneration', () => {
  for (const mode of ['indoor', 'disabled', 'occupied', 'unknown']) {
    const { d, spec } = fixture(), options = {};
    if (mode === 'indoor') spec.indoor = true;
    if (mode === 'disabled') options.enabled = false;
    if (mode === 'occupied') for (const c of Object.values(d.cells)) c.navigationReserved = true;
    if (mode === 'unknown') { spec.source.roomName = 'Quiet Plains'; prepareSceneGeography(spec, {}); }
    const original = JSON.stringify(d.cells), report = applySceneGeography(d, spec, options);
    assert.equal(report.status, 'skipped', mode);
    assert.equal(JSON.stringify(d.cells), original, mode);
    if (mode === 'unknown') assert.equal(report.deferredTransitions.length, 2);
  }
});

test('boulders and rock faces remain real blocking voxel props, not climbable or billboard placeholders', () => {
  for (const shape of ['boulder', 'rock_face']) {
    const d = { cells: { '0,0': { tile: 'custom_rock', floorHeight: 0, ceilHeight: 3.5 } },
      tiles: { custom_rock: { spriteSpec: { voxelShape: shape, baseWidth: 1.5, heightRatio: 1.2 } } } };
    assert.equal(Collision.testCell(d, 0, 0, 0.5, 0.5).blocked, true, shape);
    assert.equal(Collision.surfaceAt(d, 0.5, 0.5).height, 0, 'No automatic rock climbing');
  }
});

test('normal and dungeon-test construction both plan destination transitions and deform the shared grid before scatter', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  assert.equal((source.match(/prepareSceneGeography\(sceneSpec,/g) || []).length, 2);
  for (const prepare of source.matchAll(/prepareSceneGeography\(sceneSpec,/g)) {
    const level = source.lastIndexOf('applyLevelSpecToScene(sceneSpec, levelSpec)', prepare.index);
    const next = source.indexOf('applySceneGraphics(dungeon, sceneSpec', prepare.index);
    assert.ok(level >= 0 && prepare.index - level < 500);
    assert.ok(next > prepare.index, 'Prepare terrain before its rock sprites are built');
  }
  const runs = [...source.matchAll(/applySceneGeography\(dungeon, sceneSpec,/g)];
  assert.equal(runs.length, 2);
  for (const run of runs) {
    const next = source.indexOf('placeSceneLandmarks(dungeon, sceneSpec)', run.index);
    assert.ok(next > run.index);
  }
  const diagnostics = fs.readFileSync(require.resolve('../dungeonDiagnostics'), 'utf8');
  assert.match(diagnostics, /geography: dungeon.sceneGeography/);
  assert.match(diagnostics, /verticalTransitions: dungeon.sceneSpec/);
});

test('abstract outdoor descriptions with only a down exit still get visible uplands, without inventing an up exit', () => {
  const { d, spec, db } = fixture();
  spec.biome = 'temple';
  spec.source = { roomName: 'Veil of Forgotten Whispers', description: 'Fragments of ancient oaths linger as dense electric silences.' };
  spec.exits = ['west', 'down', 'southeast', 'northeast', 'southwest'];
  prepareSceneGeography(spec, db);
  assert.equal(spec.terrainPlan.profile, 'uplands');
  assert.deepEqual(spec.terrainPlan.requests.map(r => r.role), ['canyon', 'mountain']);
  const report = applySceneGeography(d, spec);
  assert.equal(report.status, 'built');
  const mountain = report.features.find(f => f.role === 'mountain');
  assert.equal(mountain.evidence, 'outdoor-world-profile');
  assert.equal(mountain.exitRequested, false);
  assert.equal(mountain.endpointHeight, 8);
  assert.ok(Object.values(d.cells).every(c => c.complexExit !== 'up'));
  assert.equal(report.features[0].reachableAfter, report.features[1].reachableAfter);
});

test('flat plains, wetlands, urban exhibits, indoor rooms and saved terrain are not silently made mountainous', () => {
  for (const spec of [
    { indoor: false, biome: 'wasteland', source: { description: 'Flat ground stretches across the silent wastes.' } },
    { indoor: false, biome: 'swamp', source: { roomName: 'Whispering Marsh' } },
    { indoor: false, biome: 'city_street', source: { roomName: 'Ancient Forum' } },
    { indoor: true, biome: 'temple', source: { roomName: 'Temple' } }
  ]) assert.ok(planTerrainRequests(spec).requests.every(r => r.kind !== 'background-upland'));
  assert.equal(planTerrainRequests({ indoor: false }, { backgroundTerrain: false }).requests.length, 0);
  const { d, spec } = fixture();
  const old = { version: 1, status: 'built', features: [{ role: 'canyon' }] };
  d.sceneGeography = old;
  const original = JSON.stringify(d.cells);
  assert.equal(applySceneGeography(d, spec), old);
  assert.equal(JSON.stringify(d.cells), original);
});

test('physical terrain in puzzle and level-detail text reaches the geography compiler', () => {
  const spec = { indoor: false, source: { roomName: 'Quiet Basin', puzzle: 'A ridge rises behind the weathered rune stones.' },
    level: { layoutFeatures: ['a deep canyon beside the ruined crossing'] } };
  const plan = planTerrainRequests(spec, { backgroundTerrain: false });
  assert.deepEqual(plan.requests.map(r => r.role), ['mountain', 'canyon']);
  assert.ok(plan.requests.every(r => r.evidence === 'description-or-level-detail'));
});

test('real outdoor blueprint construction with shallow copied settings still deploys a canyon and skyline relief', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const start = source.indexOf('function buildDungeonFromBlueprint('), end = source.indexOf('async function runDungeonTestingMode', start);
  let seed = 7;
  const math = Object.create(Math);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const context = { Math: math, BlueprintPillars: require('../retort/blueprintPillars') };
  vm.runInNewContext(source.slice(start, end), context);
  const d = { layout: { width: 512, height: 512 }, start: { x: 256, y: 384 }, customTiles: [] };
  const blueprint = {
    seed: 'veil_of_forgotten_whispers_001', base: { floor: 0, ceil: 2.5 },
    heightfield: { amplitude: 1.2, roughness: 0.9, scale: 0.18, radial: 0.6, terrace: 0 },
    rooms: [{ x: 0.2, y: 0.2, w: 0.3, h: 0.2, floor: 0, ceil: 2.5 }],
    paths: [{ from: [0.1, 0.8], to: [0.9, 0.8], width: 0.08, flatten: true, ramp: true }],
    volumes: [{ x: 0.45, y: 0.35, w: 0.05, h: 0.05, floor: 0, ceil: 2.5, tile: 'pillar' }],
    prefabs: [{ type: 'ruin_wall', x: 0.3, y: 0.25, w: 0.2, h: 0.05, height: 2.5, count: 1 }]
  };
  context.buildDungeonFromBlueprint(d, { indoor: false, biome: 'temple' }, blueprint, []);
  const spec = { indoor: false, biome: 'temple', coords: { x: 1, y: 0, z: 0 },
    source: { roomName: 'Veil of Forgotten Whispers', description: 'Silences and broken promises drift through this place.' }, exits: ['down'] };
  prepareSceneGeography(spec, { '1,0,-1': { name: 'Obsidian Egress', indoor: true } });
  const before = reachable(makeNavigation(d), d.start), report = applySceneGeography(d, spec);
  assert.equal(report.features.length, 2, JSON.stringify(report));
  assert.deepEqual(report.features.map(f => f.endpointHeight), [-7, 8]);
  assert.equal(reachable(makeNavigation(d), d.start).count, before.count);
  assert.ok(report.features.every(f => f.changedCells < 1600));
});
