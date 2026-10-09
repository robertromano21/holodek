const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const B = require('../retort/indoorBlueprint');
const { applySceneArchitecture, makeNavigation, reachable } = require('../retort/sceneArchitecture');
const { applySceneRoofs } = require('../retort/sceneRoofs');
const T = require('../retort/outdoorTerrain');

function fixture(seed = 'complex-a', modules = []) {
  const plan = { rooms: [
    { x: .41, y: .70, w: .18, h: .18, role: 'entrance' },
    { x: .05, y: .05, w: .34, h: .40, role: 'hall', roofStyle: 'coffered', clearance: 7 },
    { x: .56, y: .07, w: .25, h: .25, role: 'rotunda', roofStyle: 'domed', columnOrder: 'ionic' },
    { x: .54, y: .38, w: .22, h: .22, role: 'shrine' },
    { x: .10, y: .49, w: .24, h: .19, role: 'courtyard' },
    { x: .07, y: .78, w: .22, h: .15, role: 'crypt', roofStyle: 'barrel' }
  ], heightLevels: [0, .5, 1], modules, corridors: [
    { fromRoom: 0, toRoom: 4, style: 'H', width: 2 },
    { fromRoom: 4, toRoom: 1, style: 'V', width: 2 },
    { fromRoom: 1, toRoom: 2, style: 'H', width: 2 },
    { fromRoom: 2, toRoom: 3, style: 'V', width: 2 },
    { fromRoom: 3, toRoom: 0, style: 'V', width: 2 },
    { fromRoom: 0, toRoom: 5, style: 'H', width: 2 }
  ] };
  const d = { layout: { width: 64, height: 64 }, start: { x: 32, y: 48 }, cells: {}, tiles: {},
    generation: { seed }, classification: { indoor: true }, blueprint: { indoorPlan: plan } };
  const spec = { indoor: true, architecture: 'temple', source: { roomName: 'Ruined Temple Entrance',
    description: 'A Roman temple complex contains a grand columned hall, a domed rotunda, a shrine, a sky courtyard and burial corridors.' },
    exits: ['east', 'up'], wallStyleMaterial: 'marble' };
  B.build(d, plan, { floor: 0, ceil: 5 });
  return { d, spec, plan };
}

test('authored rooms, loops, elevations and roles survive the initial build without an extra stock spawn hall', () => {
  const { d, plan } = fixture();
  assert.equal(d.indoorRooms.length, plan.rooms.length);
  assert.equal(d.indoorLayout.source, 'llm-blueprint');
  assert.equal(d.indoorLayout.corridors.length, plan.corridors.length);
  assert.equal(d.indoorLayout.repairedLinks, 0);
  assert.equal(d.indoorLayout.disconnectedRooms, 0);
  assert.equal(d.indoorRooms[1].clearance, 7);
  assert.equal(d.indoorRooms[2].columnOrder, 'ionic');
  assert.deepEqual(d.indoorHeightLevels, [0, .5, 1, 0, .5, 1]);
});

test('indoor architecture decorates the blueprint instead of erasing its maze, doors or objects', () => {
  const { d, spec } = fixture();
  d.cells['35,48'].interactable = { id: 'sealed-chest' };
  const original = structuredClone(d.cells);
  const a = applySceneArchitecture(d, spec);
  assert.equal(a.mode, 'blueprint-decoration');
  assert.equal(a.preservedLayout, true);
  assert.equal(a.chambers.length, 6);
  for (const [key, c] of Object.entries(d.cells)) {
    assert.equal(c.tile, original[key].tile, key);
    assert.equal(c.floorHeight, original[key].floorHeight, key);
  }
  assert.deepEqual(d.cells['35,48'].interactable, { id: 'sealed-chest' });
  assert.equal(a.exteriorZones.length, 0, 'Do not classify every floor outside a template rectangle as outdoor');
  assert.equal(applySceneArchitecture(d, spec), a, 'Cached rooms are not redesigned');
});

test('hybrid complexes retain grounded grand ceilings, pediments, a dome, open court and all remaining routes', () => {
  const { d, spec } = fixture();
  applySceneArchitecture(d, spec);
  const before = reachable(makeNavigation(d), d.start);
  const floors = Object.fromEntries(Object.entries(d.cells).map(([key, c]) => [key, c.floorHeight]));
  const roof = applySceneRoofs(d, spec);
  assert.equal(roof.status, 'built');
  assert.ok(d.sceneStructures.some(p => p.shape === 'pediment'));
  assert.ok(d.sceneStructures.some(p => p.shape === 'dome_shell'));
  assert.ok(roof.bays.some(b => b.springHeight >= 7));
  for (const b of roof.bays) for (const key of b.supports) {
    assert.ok(d.cells[key].ceilHeight >= b.springHeight || b.supportCaps.includes(key), key);
  }
  const court = d.indoorRooms[4];
  for (let y = court.y; y < court.y + court.h; y++) for (let x = court.x; x < court.x + court.w; x++) assert.equal(d.cells[`${x},${y}`].roof, undefined);
  const nav = makeNavigation(d), after = reachable(nav, d.start);
  for (let i = 0; i < before.seen.length; i++) if (before.seen[i] && nav.passable[i]) assert.ok(after.seen[i]);
  for (const [key, c] of Object.entries(d.cells)) assert.equal(c.floorHeight, floors[key], key);
});

test('a full temple module fits inside a selected hall without replacing exterior chambers and includes its terrace and portico', () => {
  const { d, spec } = fixture('module-game', [{ type: 'temple', room: 1, ruined: true }]);
  const old = structuredClone(d.cells);
  const a = applySceneArchitecture(d, spec);
  const m = a.modules[0];
  assert.equal(m.status, 'built', JSON.stringify(m));
  for (const [key, c] of Object.entries(d.cells)) {
    const [x, y] = key.split(',').map(Number);
    if (x < m.x || y < m.y || x >= m.x + m.width || y >= m.y + m.height) {
      assert.equal(c.tile, old[key].tile); assert.equal(c.floorHeight, old[key].floorHeight);
    }
    if (old[key].tile === 'wall') assert.equal(c.tile, 'wall', 'No existing maze wall is erased');
  }
  assert.ok(Object.values(d.cells).some(c => c.architectureRole === 'sanctuary-step'));
  assert.ok(Object.values(d.cells).some(c => c.architectureRole === 'sanctuary-terrace'));
  applySceneRoofs(d, spec);
  assert.ok(d.sceneStructures.some(p => p.shape === 'pediment'));
});

test('an occupied or undersized module is rejected atomically while its blueprint survives', () => {
  for (const request of [{ type: 'temple', room: 0 }, { type: 'castle', room: 1 }]) {
    const { d, spec } = fixture('occupied', [request]);
    if (request.room === 1) d.cells['15,12'].interactable = { id: 'puzzle' };
    const original = structuredClone(d.cells);
    const a = applySceneArchitecture(d, spec);
    assert.equal(a.modules[0].status, 'rejected');
    for (const [key, c] of Object.entries(d.cells)) assert.equal(c.tile, original[key].tile);
    assert.deepEqual(d.cells['15,12'].interactable, original['15,12'].interactable);
  }
});

test('template sections can be combined without installing a whole building shell', () => {
  const { d, spec } = fixture('sections', [{ type: 'portico', room: 1, x: 0, y: 1, width: 5, height: 6, columnOrder: 'corinthian' },
    { type: 'vaulted_bay', room: 1, x: 1, y: 0, width: 5, height: 6, roofStyle: 'groin' },
    { type: 'courtyard', room: 1, x: 1, y: 1, width: 5, height: 5 }]);
  const old = structuredClone(d.cells);
  const a = applySceneArchitecture(d, spec);
  assert.ok(a.modules.every(m => m.section && m.status === 'built'), JSON.stringify(a.modules));
  for (const [key, c] of Object.entries(d.cells)) {
    assert.equal(c.tile, old[key].tile, 'No temple shell or fixed partition is imposed');
    assert.equal(c.floorHeight, old[key].floorHeight);
  }
  applySceneRoofs(d, spec);
  assert.ok(d.sceneStructures.some(p => p.shape === 'groin_vault_shell'));
  assert.ok(d.sceneStructures.some(p => p.shape === 'pediment'));
});

test('the required first-room portico varies between seeds even with an identical designer plan', () => {
  const locations = new Set();
  for (let i = 0; i < 8; i++) {
    const { d, spec } = fixture(`portico-${i}`);
    applySceneArchitecture(d, spec);
    const roof = applySceneRoofs(d, spec);
    const shrine = roof.bays.find(b => b.role === 'shrine');
    assert.ok(shrine, JSON.stringify(roof.rejected));
    assert.ok(d.sceneStructures.some(p => p.shape === 'pediment'));
    locations.add(`${shrine.x},${shrine.y}`);
  }
  assert.ok(locations.size > 1, 'Not a fixed portico at a fixed coordinate');
});

test('outdoor architecture builds only at blueprint-selected building sites, not over the landscape', () => {
  const d = { layout: { width: 96, height: 96 }, start: { x: 48, y: 72 }, cells: {}, tiles: {},
    classification: { indoor: false }, generation: { seed: 'outdoor-buildings' },
    blueprint: { buildings: [{ type: 'temple', x: .1, y: .1, w: .3, h: .3, ruined: true }] } };
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 5 };
  const old = structuredClone(d.cells);
  const a = applySceneArchitecture(d, { indoor: false, source: { roomName: 'Tartarus Wastes' } });
  assert.equal(a.mode, 'landscape-decoration');
  assert.equal(a.modules[0].status, 'built');
  const site = a.modules[0];
  for (const [key, c] of Object.entries(d.cells)) {
    const [x, y] = key.split(',').map(Number);
    if (x < site.x || y < site.y || x >= site.x + site.width || y >= site.y + site.height) {
      assert.equal(c.tile, old[key].tile); assert.equal(c.floorHeight, old[key].floorHeight);
    }
  }
});

test('a planned wasteland watchtower has a tall supported shell, an accessible hall and unchanged surrounding terrain', () => {
  const d = { layout: { width: 96, height: 96 }, start: { x: 48, y: 72 }, cells: {}, tiles: {},
    classification: { indoor: false }, generation: { seed: 'watchtower' },
    blueprint: { buildings: [{ type: 'castle', variant: 'watchtower', x: .1, y: .1, w: .3, h: .3, ruined: true }] } };
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 3, ceilHeight: 6 };
  const spec = { indoor: false, source: { roomName: 'Ash Wastes', description: 'A ruined watchtower overlooks the trails.' } };
  const a = applySceneArchitecture(d, spec);
  assert.equal(a.modules[0].status, 'built'); assert.equal(a.modules[0].variant, 'watchtower');
  const walls = Object.values(d.cells).filter(c => c.architectureRole === 'watchtower-shell');
  assert.ok(walls.length > 8 && walls.every(c => c.ceilHeight - c.floorHeight >= 10));
  const hall = a.zones.find(z => z.role === 'keep-hall'); assert.equal(hall.clearance, 10);
  const nav = makeNavigation(d), connected = reachable(nav, d.start);
  for (let i = 0; i < nav.passable.length; i++) if (nav.passable[i]) assert.ok(connected.seen[i]);
  const roof = applySceneRoofs(d, spec); assert.equal(roof.status, 'built');
  assert.ok(roof.bays.some(b => b.springHeight >= 13), 'The roof rises with the tower, not the surrounding courtyard');
  assert.equal(d.cells['80,80'].tile, 'floor'); assert.equal(d.cells['80,80'].floorHeight, 3);
});

test('partial corridor plans are honored and only their missing links are repaired', () => {
  const { d, plan } = fixture();
  const partial = { ...plan, corridors: plan.corridors.slice(0, 1) };
  B.build(d, partial, { floor: 0, ceil: 5 });
  assert.equal(d.indoorLayout.corridors[0].repaired, false);
  assert.ok(d.indoorLayout.repairedLinks > 0);
  assert.equal(d.indoorLayout.disconnectedRooms, 0);
});

test('fallback complexes remain seeded, varied and safe, including malformed module lists', () => {
  const { d, spec } = fixture();
  const a = structuredClone(d), b = structuredClone(d);
  B.build(a, {}, { ceil: 5 }); B.build(b, {}, { ceil: 5 });
  assert.deepEqual(a.cells, b.cells);
  b.generation.seed = 'different-game'; B.build(b, {}, { ceil: 5 });
  assert.notDeepEqual(a.cells, b.cells);
  d.blueprint.indoorPlan.modules = {};
  assert.equal(applySceneArchitecture(d, spec).mode, 'blueprint-decoration');
});

test('outdoor landforms are designed into the initial heightfield while seeded relief and spawn safety remain', () => {
  const base = T.plan({ indoor: false, generation: { seed: 'wastes' } });
  const old = structuredClone(base);
  const designed = T.design(base, { landforms: [{ kind: 'cliff', x: .8, y: .3, radiusX: .1, radiusY: .2, rise: 60, angle: 30 },
    { kind: 'canyon', x: .2, y: .4, radiusX: .09, radiusY: .3, rise: 35 }] });
  assert.deepEqual(base, old);
  assert.equal(designed.features.length, base.features.length + 2);
  assert.equal(designed.design.authored, 2);
  assert.ok(designed.features.at(-1).rise < 0);
  assert.equal(T.heightAt(designed, designed.spawn.x, designed.spawn.y), 0);
  const peak = designed.features.at(-2);
  assert.ok(T.heightAt(designed, peak.x, peak.y) > T.heightAt(base, peak.x, peak.y) + 50);
  assert.equal(T.design(base, {}), base, 'Omitted design leaves existing fallback intact');
});

test('the production blueprint prompt receives prose, scenery, modules, outdoor tools and a complete response budget', async () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const start = source.indexOf('async function generateDungeonBlueprint(');
  const context = { DungeonGeneration: require('../retort/dungeonGeneration'), BlueprintDesign: require('../retort/blueprintDesign'), console: { info() {} } };
  vm.runInNewContext(source.slice(start, source.indexOf('function buildDungeonFromBlueprint(', start)), context);
  for (const indoor of [true, false]) {
    let prompt, tokens;
    const $ = { user(parts, ...values) { prompt = parts.map((p, i) => p + (values[i] ?? '')).join(''); },
      assistant: { generation(options) { tokens = options.maxTokens; return { content: '{"indoorPlan":{"rooms":[]}}' }; } } };
    await context.generateDungeonBlueprint($, 'Crimson vaulted rooms overlook a broken canyon.', '', { indoor }, 64, [], { seed: 'campaign-seed' },
      { architecture: 'temple', exits: ['east'], landmarks: [{ type: 'obelisk', count: 2 }] });
    assert.ok(prompt.includes('Crimson vaulted rooms overlook a broken canyon.'));
    assert.ok(prompt.includes('master mason') && prompt.includes('load path') && prompt.includes('arrival sequence'));
    assert.ok(prompt.includes('not a reason to erase its chambers or corridors'));
    for (const word of ['rotunda', 'coffered', 'temple', 'corridors', 'landforms', 'thorn', 'obelisk', 'heightLevels', 'modules', 'mesa', 'butte', 'hoodoo', 'caldera', 'watchtower']) assert.ok(prompt.includes(word), word);
    assert.equal(tokens, indoor ? 6144 : 4096);
    const schema = prompt.slice(prompt.indexOf('Schema for THIS room only'), prompt.indexOf('Rules:'));
    if (indoor) assert.ok(schema.includes('indoorPlan') && !schema.includes('landforms'));
    else {
      assert.ok(schema.includes('landforms') && !schema.includes('indoorPlan') && !schema.includes('roomCount'));
      assert.ok(schema.includes('widthTiles'));
      assert.ok(prompt.includes('(0.5, 0.75)'));
    }
  }
});
