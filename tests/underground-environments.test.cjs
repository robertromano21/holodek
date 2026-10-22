'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Env = require('../retort/environmentIntents');
const C = require('../retort/campaignSetting');
const U = require('../retort/undergroundEnvironments');
const { buildSceneSpec } = require('../retort/sceneSpec');
const { deriveLevelSpecFromText, applyLevelSpecToScene } = require('../retort/levelSpec');
const B = require('../retort/indoorBlueprint');
const { enrich } = require('../retort/blueprintDesign');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const { applySceneRoofs } = require('../retort/sceneRoofs');
const V = require('../assets/scenePropVoxels');
const names = { cavern: 'Limestone Cavern', mine: 'Copper Mine', lava_tube: 'Basalt Lava Tube',
  fungal_cavern: 'Fungal Cavern', crystal_cavern: 'Crystal Grotto', underground_river: 'River Cavern',
  ice_cave: 'Frozen Grotto', crypt: 'Burial Crypt', catacomb: 'Old Catacombs' };

for (const [kind, name] of Object.entries(names)) test(`${kind}: real indoor biome, architecture and regional planning agree`, () => {
  const entry = Env.CATALOG[kind];
  assert.equal(entry.indoor, true);
  const spec = buildSceneSpec({ roomName: name, description: entry.physicalDescription });
  assert.equal(spec.indoor, true);
  assert.equal(spec.biome, entry.biome);
  const level = deriveLevelSpecFromText(spec.source);
  assert.equal(level.architecture, kind === 'catacomb' ? 'crypt' : entry.architecture);
  assert.equal(level.ceiling.kind, entry.biome === 'cave' ? 'rock' : 'vault');
  applyLevelSpecToScene(spec, level);
  const setting = C.plan({ targetKey: '3,4,-1', template: kind });
  assert.equal(setting.subterranean, true);
  assert.equal(setting.siteKind, kind);
  assert.ok(setting.underground.length > 50);
  assert.match(C.describe(setting), /site is underground/);
  assert.equal(C.inferKind({ name }), kind);
  assert.equal(C.frontierTemplate({ targetKey: '3,4,0', template: kind, sourceIndoor: true }), kind);
});

test('negative-depth neighbor choices and unavailable-model recovery cannot open into a surface biome', async () => {
  const base = { coords: { x: 4, y: 4, z: -1 }, sourceIndoor: false, directions: ['east', 'down', 'up'], seed: 'cave-run' };
  const plan = await Env.chooseEnvironmentIntents(null, base);
  for (const direction of ['east', 'down']) {
    const chosen = plan.intents[direction];
    assert.equal(chosen.indoor, true);
    assert.equal(U.isUndergroundTemplate(chosen.template), true);
    assert.equal(chosen.campaignSetting.subterranean, true);
  }
  assert.equal(plan.intents.up.targetKey, '4,4,0');
  assert.deepEqual(await Env.chooseEnvironmentIntents(null, base), plan);
  assert.equal(C.frontierTemplate({ targetKey: '4,4,-1', sourceIndoor: true, template: 'catacomb' }), 'catacomb');
});

test('Retort enum contains underground choices, rejects below-ground outdoors, and preserves exact protected rooms', async () => {
  let calls = 0, schema, prompt = '';
  const $ = { assistant: async (parts, ...args) => { prompt += String.raw({ raw: parts }, ...args); }, user: async () => {} };
  $.assistant.generation = async options => {
    calls++; schema = options.parameters;
    return { content: JSON.stringify({ directions: { east: { template: calls === 1 ? 'oasis' : 'mine', hint: 'A worked ore seam.' } } }) };
  };
  const db = { '4,5,-1': { exits: { east: {}, north: {}, south: {} } },
    '4,6,-1': { name: 'Existing Quest Crypt', objects: [{ name: 'exact key' }] } };
  const before = JSON.stringify(db);
  const plan = await Env.chooseEnvironmentIntents($, { database: db, coords: '4,5,-1', sourceIndoor: true,
    directions: ['east', 'north', 'south'], bossCoordinates: '4,4,-1' });
  assert.equal(calls, 2);
  assert.equal(plan.intents.east.template, 'mine');
  assert.equal(plan.intents.east.evidence.source, 'model');
  assert.equal(plan.intents.north, undefined);
  assert.equal(plan.intents.south, undefined);
  const allowed = schema.directions.type.east.type.template.enum;
  for (const kind of Object.keys(names)) assert.ok(allowed.includes(kind), kind);
  assert.ok(!allowed.includes('oasis'));
  assert.match(prompt, /local geology/);
  assert.equal(JSON.stringify(db), before);
});

test('atlas saves model-authored subterranean geography and supplies compatible layers for older atlases', async () => {
  const raw = { regions: C.REGIONS.map((r, i) => ({ ...r, underground: `Region ${i}: basalt mines link the wells to crypt galleries.` })), factions: C.FACTIONS };
  const accepted = C.validateAtlas(raw, 'atlas-test');
  assert.equal(accepted.regions[2].underground, raw.regions[2].underground);
  const old = C.validateAtlas({ regions: C.REGIONS, factions: C.FACTIONS }, 'old');
  assert.ok(old.regions.every(r => r.underground));
  let data = '{}', parameters, prompts = '';
  const state = { getDungeonRunId: () => 'underground-test', getRoomNameDatabase: () => data, setRoomNameDatabase: value => data = value };
  const $ = { user: async (parts, ...args) => { prompts += String.raw({ raw: parts }, ...args); },
    assistant: { generation: async options => { parameters = options.parameters; return { content: JSON.stringify(raw) }; } } };
  await C.prepareAtlas($, state);
  assert.equal(require('../retort/structuredSchema').toJSON(parameters).properties.regions.items.properties.underground.maxLength, 500);
  assert.match(prompts, /volcanic lava tubes/);
  assert.equal(JSON.parse(data)['0,0,0'].campaignAtlas.regions[2].underground, raw.regions[2].underground);
  const local = C.plan({ targetKey: '3,3,-1', template: 'mine', database: JSON.parse(data) });
  assert.equal(local.underground, raw.regions[0].underground);
});

function cavern(kind = 'cavern') {
  const input = { roomName: names[kind], description: Env.CATALOG[kind].physicalDescription };
  const spec = buildSceneSpec(input);
  applyLevelSpecToScene(spec, deriveLevelSpecFromText(input));
  const plan = { rooms: [{ x: .1, y: .1, w: .35, h: .35, role: 'entrance' },
    { x: .56, y: .54, w: .35, h: .35, role: 'chamber' }], corridors: [{ fromRoom: 0, toRoom: 1, width: 3 }] };
  const d = { layout: { width: 64, height: 64 }, start: { x: 10, y: 10 }, cells: {}, tiles: {},
    generation: { seed: 'subterranean' }, classification: { indoor: true, biome: spec.biome }, blueprint: { indoorPlan: plan } };
  B.build(d, plan, { ceil: 5, architecture: spec.architecture });
  return { d, spec, plan };
}

for (const kind of ['cavern', 'mine', 'lava_tube', 'ice_cave']) test(`${kind}: connected layout, complete rock canopy, no manufactured temple infill`, () => {
  const { d, spec, plan } = cavern(kind);
  assert.equal(d.indoorLayout.disconnectedRooms, 0);
  assert.equal(d.indoorRooms[0].shape, kind === 'mine' ? 'hall' : 'irregular');
  const before = reachable(makeNavigation(d), d.start);
  const snapshot = JSON.stringify(Object.values(d.cells).map(c => [c.tile, c.floorHeight]));
  const enriched = enrich(d.blueprint, { classification: d.classification, sceneSpec: spec, size: 64 });
  assert.equal(enriched.indoorPlan.modules, undefined);
  assert.equal(enriched.indoorPlan.rooms, plan.rooms);
  const roof = applySceneRoofs(d, spec);
  assert.equal(roof.style, 'rock');
  assert.equal(roof.skyDefault, false);
  assert.equal(roof.coverage.ratio, 1);
  assert.ok(Object.values(d.cells).every(c => c.roof));
  assert.ok(d.sceneStructures.every(p => p.shape === 'rock_ceiling'));
  assert.equal(JSON.stringify(Object.values(d.cells).map(c => [c.tile, c.floorHeight])), snapshot);
  assert.equal(reachable(makeNavigation(d), d.start).count, before.count);
  assert.equal(applySceneRoofs(d, spec), roof);
});

test('rock ceiling voxel has no through-holes across its footprint and keeps a rough underside', () => {
  const n = 16, grid = V.build('rock_ceiling', n);
  const lows = new Set();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let low = -1;
    for (let z = 0; z < n; z++) if (grid[x + y * n + z * n * n]) { low = z; break; }
    assert.ok(low >= 0);
    lows.add(low);
  }
  assert.ok(lows.size > 1);
});

test('surface cave approaches and outdoor burial grounds stay outdoors', () => {
  assert.equal(C.inferKind({ name: 'Copper Mine Approach', indoor: false }), 'wasteland');
  assert.equal(C.inferKind({ name: 'Graveyard of Empty Tombs', indoor: false }), 'graveyard');
  const { d, spec } = cavern();
  spec.indoor = false; d.classification.indoor = false;
  assert.equal(U.isNaturalUnderground(spec), false);
  applySceneRoofs(d, spec);
  assert.ok(!(d.sceneStructures || []).some(p => p.shape === 'rock_ceiling'));
});
