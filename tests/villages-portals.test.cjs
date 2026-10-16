'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const V = require('../retort/villages'), P = require('../retort/planarPortals'), C = require('../retort/campaignSetting');
const Routes = require('../assets/outdoorRoutes'), Exits = require('../assets/dungeonExits');
const Env = require('../retort/environmentIntents'), Exterior = require('../retort/sceneExterior');
const Indoor = require('../retort/indoorBlueprint'), World = require('../retort/worldContext');
const Economy = require('../retort/economy'), Voxels = require('../assets/scenePropVoxels');
const sourceKey = '4,4,0';
function database(cavern = false) {
  return { [sourceKey]: { name: cavern ? 'Vast Shelter Cavern' : 'Ash Refuge Approach', indoor: cavern,
    classification: { indoor: cavern, biome: cavern ? 'cave' : 'wasteland', size: cavern ? 192 : 96 },
    environmentIntent: Env.CATALOG[cavern ? 'cavern_village' : 'village'],
    exits: { north: { status: 'open', targetCoordinates: '4,5,0', key: null } }, objects: [] },
    '4,5,0': { name: 'Onward Route', indoor: cavern, exits: {} } };
}
const village = () => ({ village: true, name: 'The Uncounted Hearths', history: 'Displaced shades built a shelter beside a maintained cistern.',
  sustenance: 'Cistern keepers trade repairs for caravan provisions.', pressure: 'Watch guards demand disputed registration levies.',
  population: 'Mostly neutral shades and humanoid artisans, with coercive demon watch guards and a sympathetic spirit.',
  buildings: [{ direction: 'east', template: 'shade_refuge', name: 'The Last Warm Room', purpose: 'Shelter for displaced shades.' },
    { direction: 'west', template: 'soul_registry', name: 'The Uncounted Archive', purpose: 'Resolve contested identities.' },
    { direction: 'southeast', template: 'watch_house', name: 'The Cinder Watch', purpose: 'Inspect traffic and enforce levies.' }] });
const portal = () => ({ portal: true, planeName: 'The Violet Interval', roomName: 'The Inverted Orchard',
  nature: 'A purple alien sky covers crystal trunks and mineral terraces; translucent branches refract distant shapes.',
  population: 'Independent crystalline grazers and an unaware conclave of glass-bodied custodians.', indoor: false, biome: 'wasteland',
  skyTop: '#5c227e', skyBot: '#b763d3', floorColor: '#405f91', wallColor: '#86d6ce',
  factions: [{ name: 'The Facet Assembly', nature: 'Custodians concerned with crystal resonance, not the war.', relation: 'unaware' }],
  gods: [{ name: 'Vorelith', nature: 'A local divinity of refraction and unfinished forms.', relation: 'independent' }] });
function agent(reply, onCall = () => {}) {
  const prompts = []; return { prompts, user(p, ...v) { prompts.push(typeof p === 'string' ? p : String.raw({ raw: p }, ...v)); },
    assistant: { async generation(options) { onCall(options); return { content: JSON.stringify(reply) }; } } };
}

test('LLM-selected villages get real, distinct walk-in rooms while every existing route survives', () => {
  const db = database(), old = JSON.stringify(db['4,5,0']), route = structuredClone(db[sourceKey].exits.north), plan = V.candidates(db, sourceKey);
  assert.equal(V.install(db, plan, village(), { seed: 'run' }), true);
  assert.deepEqual(db[sourceKey].exits.north, route); assert.equal(JSON.stringify(db['4,5,0']), old);
  assert.equal(db[sourceKey].villagePlan.buildings.length, 3);
  for (const row of db[sourceKey].villagePlan.buildings) {
    const entry = db[row.entryKey]; assert.equal(entry.indoor, true); assert.equal(entry.villageBuilding.hubKey, sourceKey);
    assert.equal(entry.name, row.name); assert.equal(Object.values(entry.exits)[0].targetCoordinates, sourceKey);
    assert.equal(entry.monsters.inRoom, 'None'); assert.deepEqual(entry.objects, []);
  }
  const context = World.buildRoomWorldContext(db, { x: 4, y: 4, z: 0 });
  assert.equal(context.neighbors.filter(n => n.connection === 'building-entrance').length, 3);
  assert.equal(V.candidates(db, sourceKey), null);
});

test('village placement protects pending routes, quest coordinates, visited scenes and cramped caves', () => {
  const db = database(), options = { reservedDirections: ['east'], tasks: [{ requiredElements: [{ placement: '3,4,0', name: 'bound relic' }] }] };
  const planned = V.candidates(db, sourceKey, options);
  assert.ok(!planned.sites.some(s => ['east', 'west'].includes(s.direction)));
  const before = JSON.stringify(db);
  assert.equal(V.install(db, planned, village(), options), false); assert.equal(JSON.stringify(db), before);
  db[sourceKey].sceneSpec = {}; assert.equal(V.candidates(db, sourceKey), null);
  const cave = database(true); cave[sourceKey].classification.size = 64; cave[sourceKey].environmentIntent = Env.CATALOG.cavern;
  assert.equal(V.candidates(cave, sourceKey), null);
});

test('an optional village can be declined and stale answers never publish partial buildings', async () => {
  const db = database(), a = agent({ village: false });
  assert.equal((await V.prepare(a, db, sourceKey)).status, 'declined');
  assert.equal(Object.keys(db).length, 2); assert.equal(db[sourceKey].villageScan, 1);
  assert.match(a.prompts[0], /LLM|You choose/); assert.match(a.prompts[0], /frightened|shades/);
  const changed = database(), b = agent(village(), () => { changed[sourceKey].visited = true; });
  assert.equal((await V.prepare(b, changed, sourceKey)).reason, 'world-changed'); assert.equal(Object.keys(changed).length, 2);
});

test('cavern villages use a large continuous rock-roofed chamber and fit several physical building facades', () => {
  const db = database(true), planned = V.candidates(db, sourceKey);
  assert.equal(V.install(db, planned, village()), true); assert.equal(db[sourceKey].classification.size, 192);
  const spec = { coords: { x: 4, y: 4, z: 0 }, indoor: true, biome: 'cave', architecture: 'cave', exits: Object.keys(db[sourceKey].exits),
    worldContext: World.buildRoomWorldContext(db, { x: 4, y: 4, z: 0 }) };
  Exterior.prepareSceneExteriors(spec, db, { seed: 'cavern' });
  assert.equal(spec.exteriorPlan.enabled, true); assert.equal(spec.exteriorPlan.buildings.length, 3);
  const d = { geoKey: sourceKey, cells: {}, layout: { width: 192, height: 192 }, start: { x: 96, y: 145 },
    classification: { indoor: true, biome: 'cave' }, tiles: { wall: {} }, sceneSpec: spec };
  Indoor.build(d, {}, { architecture: 'cave', cavernVillage: true });
  const floors = Object.values(d.cells).filter(c => c.tile === 'floor');
  assert.ok(floors.length > 18000); assert.ok(floors.every(c => c.ceilHeight === 14));
  const report = Exterior.buildSceneExteriorSites(d, spec);
  assert.ok(report.placed >= 2, JSON.stringify(report.rejected));
  assert.ok(report.buildings.every(b => b.preservedReachability && b.towerHeight < 14));
  assert.ok(report.buildings.every(b => b.footprint.width < d.layout.width / 4));
});

test('portal coordinates are random unused high-plane locations up to 1000 with a saved reciprocal return link', () => {
  const db = database(), result = P.install(db, sourceKey, portal(), { random: () => 1000, seed: 'run' });
  assert.equal(result.targetKey, '1000,1000,1000');
  const exit = db[sourceKey].exits.portal, target = db[result.targetKey];
  assert.equal(exit.kind, 'portal'); assert.equal(target.exits.portal.targetCoordinates, sourceKey);
  assert.equal(exit.portalId, target.exits.portal.portalId); assert.equal(target.classification.skyTop, '#5c227e');
  assert.equal(Routes.resolveExit({ x: 4, y: 4, z: 0 }, 'portal', db[sourceKey].exits).targetKey, result.targetKey);
  assert.equal(Routes.resolveExit({ x: 4, y: 4, z: 0 }, 'portal', {}).targetKey, null);
  assert.equal(P.destination(db, {}, () => 1000), null);
  const setting = C.plan({ database: db, targetKey: result.targetKey, template: 'wasteland' });
  assert.equal(setting.region, portal().planeName); assert.equal(setting.chapter, undefined);
  assert.equal(setting.planarRealm.factions[0].relation, 'unaware');
  assert.equal(Routes.ensureContinuation(db, result.targetKey, ['portal']).reason, 'separate-plane');
});

test('portal plans reject canonical god replacements, invalid palettes, collisions and edits to saved rooms', () => {
  const db = database(), before = JSON.stringify(db), raw = portal(); raw.gods[0].name = 'Dantuea';
  assert.throws(() => P.install(db, sourceKey, raw), /canonical/); assert.equal(JSON.stringify(db), before);
  raw.gods[0].name = 'Vorelith'; raw.skyTop = 'purple'; assert.throws(() => P.validate(raw, db), /RRGGBB/);
  db[sourceKey].description = 'Saved scenery'; assert.equal(P.install(db, sourceKey, portal()), null);
});

test('portals produce a purple pass-through voxel arch and valid nearby travel markers', () => {
  const d = { geoKey: sourceKey, cells: {}, layout: { width: 40, height: 40 }, start: { x: 20, y: 20 }, classification: { indoor: false } };
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 5 };
  const result = Exits.install(d, ['portal', 'north']);
  const marker = result.markers.find(m => m.direction === 'portal');
  assert.equal(marker.kind, 'planar-portal'); assert.ok(Voxels.architecture.portal_arch);
  assert.equal(d.tiles.planar_portal_arch.spriteSpec.palette.primary, '#9537c9');
  assert.equal(d.sceneStructures.filter(p => p.role === 'planar-portal-arch').length, 1);
  assert.equal(Exits.nearby(d, { x: marker.x + .5, y: marker.y + .5 }).direction, 'portal');
  for (const input of ['portal', 'enter portal', 'step through the portal']) assert.equal(require('../assets/commandIntent').travelDirection(input), 'portal');
  assert.equal(require('../assets/commandIntent').travelDirection('ask about the portal'), null);
});

test('client travel honors explicit destinations instead of interpolating a long corridor to a portal', () => {
  const source = fs.readFileSync(require.resolve('../assets/game.js'), 'utf8'), code = source.slice(source.indexOf('function generateCoordinates('), source.indexOf('// Updated function to connect boss room'));
  const db = database(), result = P.install(db, sourceKey, portal(), { random: () => 777 });
  const context = { directionMap: {}, window: { OutdoorRoutes: Routes }, roomNameDatabase: new Map(Object.entries(db)), coordinatesToString: Routes.keyOf };
  vm.runInNewContext(code, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.generateCoordinates({ x: 4, y: 4, z: 0 }, 'portal'))), { x: 777, y: 777, z: 777 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.generateCoordinates({ x: 777, y: 777, z: 777 }, 'portal'))), { x: 4, y: 4, z: 0 });
  assert.ok(result);
});

test('browser sync preserves village links and planar identity and cannot forge new portals', () => {
  const db = database(); V.install(db, V.candidates(db, sourceKey), village());
  const result = P.install(db, sourceKey, portal(), { random: () => 900 });
  const changed = structuredClone(db); changed[sourceKey].exits = {}; changed[result.targetKey].planarRealm = null;
  delete changed['5,4,0']; changed['4,5,0'].exits = { portal: { kind: 'portal', targetCoordinates: '0,0,0' } };
  const merged = JSON.parse(Economy.preserve(JSON.stringify(db), JSON.stringify(changed)));
  assert.equal(merged[sourceKey].exits.portal.targetCoordinates, result.targetKey);
  assert.equal(merged[sourceKey].exits.east.targetCoordinates, '5,4,0');
  assert.equal(merged[result.targetKey].planarRealm.id, result.realm.id);
  assert.ok(merged['5,4,0'].villageBuilding); assert.equal(merged['4,5,0'].exits.portal, undefined);
});
