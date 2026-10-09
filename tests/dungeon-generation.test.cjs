const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('../retort/dungeonGeneration');
const { applySceneArchitecture, makeNavigation, reachable } = require('../retort/sceneArchitecture');
const { applySceneRoofs } = require('../retort/sceneRoofs');
const { summarizeDungeon } = require('../dungeonDiagnostics');

const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
function builders() {
  const context = { Math, DungeonGeneration: G, IndoorBlueprint: require('../retort/indoorBlueprint'), BlueprintPillars: require('../retort/blueprintPillars'),
    console: { log() {}, info() {}, warn() {}, error() {} } };
  const begin = source.indexOf('function buildDungeonFromBlueprint(');
  vm.runInNewContext(source.slice(begin, source.indexOf('async function runDungeonTestingMode', begin)), context);
  const indoor = source.indexOf('function buildIndoorLayout(');
  vm.runInNewContext(source.slice(indoor, source.indexOf('function buildOutdoorLayout(', indoor)), context);
  return context;
}

function fixture(runId, size = 32, name = 'Ruined Temple Entrance') {
  const classification = { indoor: true, size, biome: 'temple' };
  const spec = { indoor: true, coords: { x: 0, y: 0, z: 0 }, textHash: 'same-room-description',
    source: { roomName: name, description: 'Cracked marble walls surround the ruined temple.' },
    wallMaterial: 'marble', floorMaterial: 'stone', landmarks: [], exits: ['east', 'north', 'up', 'down'],
    palette: { primary: '#b0aaa0', secondary: '#686058', floorPrimary: '#908478', shadow: '#282420' } };
  const generation = G.prepare(spec, classification, runId), n = generation.gridSize;
  const dungeon = { layout: { width: n, height: n }, start: { x: Math.floor(n / 2), y: n - Math.floor(n / 4) },
    classification, generation, cells: {}, tiles: {}, customTiles: [] };
  return { dungeon, spec };
}

function openRoom(d) {
  const { width, height } = d.layout;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) d.cells[`${x},${y}`] = {
    tile: x && y && x < width - 1 && y < height - 1 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 2.5
  };
}

test('indoor sizes start at 64, honor larger classifications, and remain bounded; outdoors stays unchanged', () => {
  for (const size of [undefined, NaN, -10, 16, 24, 32, 48, 64]) assert.equal(G.gridSize({ indoor: true, size }), 64);
  for (const size of [80, 96, 128, 160, 192]) assert.equal(G.gridSize({ indoor: true, size }), size);
  assert.equal(G.gridSize({ indoor: true, size: Infinity }), 64);
  assert.equal(G.gridSize({ indoor: true, size: 5000 }), 192);
  for (const size of [undefined, 24, 64, 96, 192, 5000]) assert.equal(G.gridSize({ indoor: false, size }), 512);
});

test('generation seed is campaign/coordinate-specific, not tied to repeated prose or LLM seed', () => {
  const a = fixture('game-a'), b = fixture('game-b'), again = fixture('game-a');
  assert.notEqual(a.dungeon.generation.seed, b.dungeon.generation.seed);
  assert.deepEqual(a.dungeon.generation, again.dungeon.generation);
  assert.equal(a.spec.textHash, 'same-room-description');
  const neighbor = structuredClone(a.spec);
  neighbor.coords.x = 1;
  assert.notEqual(G.prepare(neighbor, a.dungeon.classification, 'game-a').seed, a.dungeon.generation.seed);
  const blueprint = { seed: 'ruined_temple_entrance_001', indoorPlan: { roomCount: 6 } };
  const seeded = G.seedBlueprint(blueprint, a.spec.generation);
  assert.equal(seeded.seed, a.spec.generation.seed);
  assert.equal(seeded.designerSeed, blueprint.seed);
  assert.equal(blueprint.seed, 'ruined_temple_entrance_001', 'Do not mutate a saved designer blueprint');
  assert.equal(G.seedBlueprint(null, a.spec.generation), null);
});

test('identical designer blueprints and fallback construction are reproducible within a run and differ between runs', () => {
  const builder = builders();
  for (const method of ['blueprint', 'fallback']) {
    const a = fixture('game-a'), b = fixture('game-b'), again = fixture('game-a');
    for (const f of [a, b, again]) {
      if (method === 'blueprint') builder.buildDungeonFromBlueprint(f.dungeon, f.dungeon.classification,
        G.seedBlueprint({ seed: 'same-designer-seed', indoorPlan: { roomCount: 8 } }, f.spec.generation), []);
      else builder.buildIndoorLayout(f.dungeon, f.dungeon.classification);
    }
    assert.equal(JSON.stringify(a.dungeon.cells), JSON.stringify(again.dungeon.cells), method);
    assert.notEqual(JSON.stringify(a.dungeon.cells), JSON.stringify(b.dungeon.cells), method);
    assert.ok(a.dungeon.indoorRooms[0].w >= 8 && a.dungeon.indoorRooms[0].h >= 8, 'Spawn halls scale with the larger grid');
  }
});

test('new temple complexes have varied large footprints, side passages, courts and navigable gateways', () => {
  const layouts = new Set();
  for (let i = 0; i < 12; i++) {
    const { dungeon: d, spec } = fixture(`campaign-${i}`);
    openRoom(d);
    const result = applySceneArchitecture(d, spec);
    assert.equal(result.status, 'built', JSON.stringify(result));
    assert.ok(result.footprint.width >= 37 && result.footprint.height >= 43);
    assert.ok(result.zones.some(z => z.role === 'courtyard'));
    assert.ok(Object.values(d.cells).some(c => c.architectureRole === 'side-chapel-partition'));
    assert.ok(Object.values(d.cells).filter(c => c.tile === 'pillar').length < 30, 'Spaced columns, not pillar farms');
    assert.deepEqual(result.entrances.map(e => e.direction), ['east', 'north']);
    const nav = makeNavigation(d), connected = reachable(nav, d.start);
    for (const entrance of result.entrances) for (const point of [entrance, entrance.exterior]) {
      assert.ok(connected.seen[point.y * nav.width + point.x]);
    }
    layouts.add(JSON.stringify(d.cells));
    assert.equal(applySceneArchitecture(d, spec), result, 'Returning within this game must not rebuild');
    assert.deepEqual(JSON.parse(JSON.stringify(d)).cells, d.cells);
  }
  assert.equal(layouts.size, 12, 'Repeated text still creates twelve distinct campaign layouts');
});

test('large temple keeps supported pediments, a rotunda, tall roofs, and an open courtyard', () => {
  for (const name of ['Ruined Temple Entrance', 'Gothic Ruined Temple Entrance']) {
    const { dungeon: d, spec } = fixture('pediment-campaign', 64, name);
    openRoom(d);
    applySceneArchitecture(d, spec);
    const before = reachable(makeNavigation(d), d.start);
    const roof = applySceneRoofs(d, spec);
    assert.equal(roof.status, 'built');
    const shrine = roof.bays.find(b => b.role === 'shrine');
    assert.ok(shrine, JSON.stringify(roof.rejected));
    assert.equal(shrine.idiom, 'classical', 'Entrance includes a classical portico even in a Gothic complex');
    assert.ok(shrine.supports.length >= 4);
    assert.ok(d.sceneStructures.some(p => p.shape === 'pediment'));
    assert.ok(d.sceneStructures.some(p => p.shape === 'dome_shell'));
    assert.ok(d.sceneStructures.some(p => p.role === 'roof-shell' && p.position.z >= 5));
    const courtyard = d.sceneArchitecture.zones.find(z => z.role === 'courtyard');
    const cx = courtyard.x + Math.floor(courtyard.width / 2), cy = courtyard.y + Math.floor(courtyard.height / 2);
    assert.equal(d.cells[`${cx},${cy}`].roof, undefined);
    const nav = makeNavigation(d), after = reachable(nav, d.start);
    for (let i = 0; i < before.seen.length; i++) if (before.seen[i] && nav.passable[i]) assert.ok(after.seen[i]);
    for (const exit of d.sceneArchitecture.entrances) assert.ok(after.seen[exit.y * nav.width + exit.x]);
  }
});

test('material tones vary by campaign without replacing described materials or changing semantic hashes', () => {
  const a = fixture('game-a'), b = fixture('game-b'), again = fixture('game-a');
  const original = structuredClone(a.spec.palette);
  for (const { spec } of [a, b, again]) {
    G.varyPalette(spec);
    assert.equal(spec.wallMaterial, 'marble');
    assert.equal(spec.textHash, 'same-room-description');
  }
  assert.deepEqual(a.spec.palette, again.spec.palette);
  assert.notDeepEqual(a.spec.palette, b.spec.palette);
  for (const key of Object.keys(original)) for (const offset of [1, 3, 5]) {
    assert.ok(Math.abs(parseInt(a.spec.palette[key].slice(offset, offset + 2), 16) -
      parseInt(original[key].slice(offset, offset + 2), 16)) <= 25, 'Subtle material variation, not unrelated hues');
  }
  const varied = structuredClone(a.spec.palette);
  G.varyPalette(a.spec);
  assert.deepEqual(a.spec.palette, varied, 'Do not cumulatively tint an existing palette');
});

test('campaign construction is shared by normal/test flows and is recorded in diagnostics', () => {
  assert.equal((source.match(/DungeonGeneration\.prepare\(sceneSpec, classification, sharedState\.getDungeonRunId\(\)\)/g) || []).length, 2);
  assert.equal((source.match(/const size = sceneSpec\.generation\.gridSize/g) || []).length, 2);
  assert.equal((source.match(/generation: sceneSpec\.generation/g) || []).length, 2);
  const { dungeon } = fixture('logged-campaign');
  openRoom(dungeon);
  assert.deepEqual(summarizeDungeon(dungeon).generation, dungeon.generation);
});
