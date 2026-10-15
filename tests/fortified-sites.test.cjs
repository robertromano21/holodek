'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const Sites = require('../retort/fortifiedSites');
const Decor = require('../retort/fortifiedDecor'), Stairs = require('../retort/fortifiedStairs');
const Exterior = require('../retort/sceneExterior'), Campaign = require('../retort/campaignSetting');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const Economy = require('../retort/economy');
const Voxels = require('../assets/scenePropVoxels');
const Exits = require('../assets/dungeonExits');
const clone = structuredClone;
function database() { return { '8,8,0': { name: 'Vast Ashen Expanse', indoor: false, exits: {
  east: { status: 'open', targetCoordinates: '9,8,0' }, west: { status: 'open', targetCoordinates: '7,8,0' }
} }, '9,8,0': { name: 'Temple of Dyanetzia', indoor: true, environmentIntent: { template: 'deity_temple' } },
  '7,8,0': { name: 'Dunes Ahead', indoor: false } }; }
function design(patron = 'Dyanetzia', count = 4) { return { name: 'Sanctuary of the Returning Seed', patron,
  history: 'Wellkeepers sheltered the unburied here before the ash roads were settled.',
  purpose: 'A maintained sanctuary and archive serving the underworld settlements.',
  heraldry: 'The canonical curled dragon of Dyanetzia in clay and topaz.',
  floors: Array.from({ length: count }, (_, i) => ({ label: ['Memorial Vault', 'Sanctuary', 'Priests Gallery', 'Sacred Tower', 'Observatory'][i],
    flavor: 'A maintained chamber with carved records, stone stairs and a protected doorway.' })) }; }
function mock(answers, mutate) {
  let calls = 0;
  const assistant = async () => {};
  assistant.generation = async options => { assert.equal(options.strictParameters, true); mutate?.(); return { content: JSON.stringify(answers[Math.min(calls++, answers.length - 1)]) }; };
  return { assistant, user: async () => {}, calls: () => calls };
}
function dungeon(size = 64) {
  const d = { layout: { width: size, height: size }, start: { x: size / 2, y: size / 2 }, cells: {},
    tiles: { floor: { url: '/floor.png' }, wall: { url: '/wall.png' } }, sceneStructures: [] };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d.cells[`${x},${y}`] = {
    tile: x && y && x < size - 1 && y < size - 1 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 5 };
  return d;
}
function compiled(patron = 'Dyanetzia', template = 'deity_temple') {
  const db = database(); db['9,8,0'].name = patron ? `Temple of ${patron}` : 'Castle of the Ash Watch';
  db['9,8,0'].environmentIntent.template = template;
  const plan = Sites.route(db, '8,8,0', 'east', template);
  assert.ok(plan);
  const built = Sites.compile(db, plan, design(patron || 'none', plan.floors.length), 'test');
  Object.assign(db, built.rooms); return { db, built, plan };
}
test('all five site types compile reciprocal XYZ storeys without portable rewards, bosses or actors', () => {
  for (const type of Sites.TYPES) {
    const { db, built, plan } = compiled(type === 'deity_temple' ? 'Dyanetzia' : null, type);
    assert.equal(built.site.rooms.length, type === 'wizard_tower' ? 5 : 4);
    for (const [i, f] of plan.floors.entries()) {
      const r = db[f.key]; assert.equal(r.indoor, true); assert.ok(r.campaignSetting.building);
      assert.equal(r.fortifiedFloor.level, i - 1); assert.deepEqual(r.objects, []); assert.equal(r.inhabitants, undefined);
      if (i) assert.equal(r.exits.down.targetCoordinates, plan.floors[i - 1].key);
      if (i + 1 < plan.floors.length) assert.equal(r.exits.up.targetCoordinates, plan.floors[i + 1].key);
      assert.equal(!!r.exits.west, f.level === 0);
      assert.equal(r.bossGate, undefined);
    }
    assert.equal(db['7,8,0'].name, 'Dunes Ahead');
    assert.deepEqual(Sites.bossCandidates(db).map(r => r.coordinates), built.site.bossCandidates);
    assert.deepEqual(Sites.bossCandidates(db, { bossCoordinates: built.site.bossCandidates[0] }).map(r => r.coordinates), built.site.bossCandidates.slice(1));
  }
});
test('occupied, quest-bound, root, indoor and previously published routes cannot be overwritten', () => {
  for (const field of ['description', 'sceneSpec', 'visited', 'populationComplete', 'regionalSite', 'bossGate']) {
    const db = database(); db['9,8,0'][field] = field === 'description' ? 'Published' : true;
    assert.equal(Sites.route(db, '8,8,0', 'east', 'deity_temple'), null, field);
  }
  const db = database(); db['9,8,1'] = { name: 'Existing Room Above' };
  assert.equal(Sites.route(db, '8,8,0', 'east', 'deity_temple'), null);
  delete db['9,8,1'];
  assert.equal(Sites.route(db, '8,8,0', 'east', 'deity_temple', { bossCoordinates: '9,8,1' }), null);
  db['8,8,0'].indoor = true;
  assert.equal(Sites.route(db, '8,8,0', 'east', 'deity_temple'), null);
});
test('structured generation repairs invalid patron, commits once, preserves routes and detects stale world', async () => {
  const db = database(), p = Sites.route(db, '8,8,0', 'east', 'deity_temple');
  const $ = mock([design('Arithus'), design()]);
  const result = await Sites.seed($, db, p, { seed: 'test' });
  assert.equal(result.status, 'installed'); assert.equal($.calls(), 2);
  assert.equal(db['9,8,0'].fortifiedSite.patron, 'Dyanetzia');
  assert.equal(db['8,8,0'].exits.west.targetCoordinates, '7,8,0');
  assert.equal(Sites.route(db, '8,8,0', 'east', 'deity_temple'), null);
  const stale = database(), q = Sites.route(stale, '8,8,0', 'east', 'deity_temple');
  const late = await Sites.seed(mock([design()], () => { stale['9,8,1'] = { name: 'Concurrent Quest Room' }; }), stale, q);
  assert.equal(late.status, 'skipped'); assert.equal(stale['9,8,0'].fortifiedSite, undefined);
  const invalid = database();
  await assert.rejects(Sites.seed(mock([{}]), invalid, Sites.route(invalid, '8,8,0', 'east', 'deity_temple')), /generation failed/);
  assert.equal(invalid['9,8,0'].fortifiedSite, undefined);
});
test('vast outdoor extension adds one or two buildings, never replaces onward wilderness, and is idempotent', async () => {
  const db = database(); delete db['9,8,0']; delete db['8,8,0'].exits.east;
  const assistant = async () => {};
  let count = 0;
  assistant.generation = async ({ parameters }) => { const patron = parameters.patron.enum[0];
    const value = design(patron, 4); value.name = `Fortified Site ${++count}`;
    // Wizard towers have an additional observatory.
    const template = messages.at(-1)?.includes('wizard tower') ? 5 : 4;
    value.floors = design(patron, template).floors; return { content: JSON.stringify(value) }; };
  const messages = [], tag = async (strings, ...values) => messages.push(String.raw({ raw: strings }, ...values));
  tag.generation = assistant.generation;
  const $ = { assistant: tag, user: tag };
  const reports = await Sites.extend($, db, '8,8,0', { seed: 'test' });
  assert.ok(reports.length >= 1 && reports.length <= 2); assert.ok(reports.every(r => r.status === 'installed'));
  assert.deepEqual(db['8,8,0'].exits.west, { status: 'open', targetCoordinates: '7,8,0' });
  assert.deepEqual(await Sites.extend($, db, '8,8,0', { seed: 'test' }), []);
});
test('evil temple hostility uses canonical deity policy without spawning a deity', () => {
  for (const patron of ['Arithus', 'Dantuea', 'Sharlynn', 'Nameless Drake']) {
    const { db } = compiled(patron);
    for (const r of Object.values(db).filter(Sites.isFloor)) {
      assert.ok(Campaign.hostileTemple(r.campaignSetting, r.name));
      assert.equal(r.inhabitants, undefined); assert.equal(r.campaignSetting.hostilePatron, patron);
    }
  }
  const { db } = compiled(); assert.equal(Campaign.hostileTemple(db['9,8,0'].campaignSetting, db['9,8,0'].name), false);
});
test('browser sync cannot forge or delete a site, rename its floors or replace stair exits', () => {
  const { db } = compiled(), incoming = { '9,8,0': { name: 'Wrong', exits: { east: {} } },
    '5,5,0': { name: 'Forged', fortifiedFloor: { version: 1 } } };
  const result = JSON.parse(Economy.preserve(JSON.stringify(db), JSON.stringify(incoming)));
  assert.equal(result['9,8,0'].name, db['9,8,0'].name); assert.deepEqual(result['9,8,0'].exits, db['9,8,0'].exits);
  assert.equal(result['9,8,1'].fortifiedFloor.level, 1); assert.equal(result['5,5,0'].fortifiedFloor, undefined);
});
test('planning logs retain authored history and every exact XYZ floor binding', () => {
  const { db, built } = compiled('Arithus');
  const snapshot = require('../retort/campaignPlanningLog').snapshot({ getDungeonRunId: () => 'test', getRoomNameDatabase: () => JSON.stringify(db) });
  assert.equal(snapshot.fortifiedSites.length, 1);
  assert.equal(snapshot.fortifiedSites[0].history, built.site.history);
  assert.deepEqual(snapshot.fortifiedSites[0].floors.map(f => f.coordinates), built.site.rooms);
  assert.equal(snapshot.fortifiedSites[0].patron, 'Arithus');
});
test('the existing boss-gate engine locks the stair to an upper temple without seeding a key', () => {
  const { db } = compiled('Arithus'), target = db['9,8,2'];
  const report = require('../retort/bossGate').ensureBossGate(db,
    `Next Boss: Ash Regent\nNext Boss Room: ${target.name}\nBoss Room Coordinates: X: 9, Y: 8, Z: 2\nNext Artifact: Black Chalice`);
  assert.equal(report.gate.targetKey, '9,8,2');
  assert.equal(db['9,8,1'].exits.up.status, 'locked');
  assert.equal(report.gate.keySeeded, false);
  assert.ok(Object.values(db).every(r => !r.objects?.length));
});
test('new storeys have separate real, reachable stair wings and covered undersides, ordinary rooms untouched', () => {
  const { db } = compiled(), d = dungeon(), spec = { indoor: true, worldContext: { fortifiedFloor: db['9,8,0'].fortifiedFloor } };
  const result = Stairs.install(d, spec); assert.equal(result.routes.length, 2);
  const nav = makeNavigation(d), reached = reachable(nav, d.start);
  for (const r of result.routes) {
    assert.equal(Math.abs(r.totalRise), 4.2); assert.equal(r.flights.length, 2);
    assert.equal(d.cells[`${r.exit.x},${r.exit.y}`].complexExit, r.direction);
    assert.ok(reached.seen[r.exit.y * nav.width + r.exit.x]);
  }
  const up = result.routes.find(r => r.direction === 'up'), down = result.routes.find(r => r.direction === 'down');
  assert.notDeepEqual(up.start, down.start);
  assert.equal(Stairs.install(d, spec), result);
  Decor.cover(d, spec);
  assert.ok(Object.values(d.cells).filter(c => c.tile === 'floor').every(c => c.roof));
  assert.ok(d.sceneStructures.some(p => p.role === 'upper-storey-floor'));
  const ordinary = dungeon(), before = clone(ordinary); Stairs.install(ordinary, {}); Decor.cover(ordinary, {});
  assert.deepEqual(ordinary, before);
});
test('each deity has patron-specific geometry, sprites metadata and an effigy, with no lighting changes', () => {
  const signatures = new Set();
  for (const patron of ['Mortacia', 'Dyanetzia', 'Atinus', 'Arithus', 'Dantuea', 'Rama']) {
    const { db } = compiled(patron), lighting = { primary: 'torch', color: '#ffbb66' };
    const spec = { worldContext: { fortifiedFloor: db['9,8,0'].fortifiedFloor }, lighting: clone(lighting) };
    Decor.prepare(spec); const count = spec.landmarks.length; Decor.prepare(spec);
    assert.equal(spec.landmarks.length, count); assert.deepEqual(spec.lighting, lighting);
    assert.equal(spec.landmarks.find(l => l.type === 'statue').sculpture.deity, patron);
    assert.equal(spec.landmarks.find(l => l.type === 'altar').shrine.deity, patron);
    signatures.add(JSON.stringify(Voxels.build('patron_relief', 32, 0, { shrine: { deity: patron } })));
  }
  assert.equal(signatures.size, 6);
});
test('authored indoor plans retain their rooms while installing both storey stairs and a continuous overhead floor', () => {
  const B = require('../retort/indoorBlueprint'), A = require('../retort/sceneArchitecture'), Roofs = require('../retort/sceneRoofs');
  for (const patron of ['Dyanetzia', null]) {
    const { db } = compiled(patron, patron ? 'deity_temple' : 'medieval_castle');
    const d = dungeon(), plan = { rooms: [
      { x: .08, y: .08, w: .38, h: .38, role: 'hall' }, { x: .54, y: .08, w: .38, h: .38, role: 'chamber' },
      { x: .08, y: .54, w: .38, h: .38, role: 'courtyard' }, { x: .54, y: .54, w: .38, h: .38, role: 'entrance' }
    ], heightLevels: [0], corridors: [{ fromRoom: 0, toRoom: 1 }, { fromRoom: 1, toRoom: 3 }, { fromRoom: 3, toRoom: 2 }, { fromRoom: 2, toRoom: 0 }] };
    d.blueprint = { indoorPlan: plan }; B.build(d, plan, { floor: 0, ceil: 5, coveredStorey: true });
    const spec = { indoor: true, source: { roomName: db['9,8,0'].name }, worldContext: { fortifiedFloor: db['9,8,0'].fortifiedFloor }, exits: ['west', 'up', 'down'] };
    Decor.prepare(spec); A.applySceneArchitecture(d, spec); const stairs = Stairs.install(d, spec);
    assert.equal(stairs.routes.length, 2); assert.equal(d.indoorRooms.length, 4);
    assert.ok(!d.indoorRooms.some(r => r.role === 'courtyard'));
    Roofs.applySceneRoofs(d, spec); Decor.cover(d, spec); Exits.install(d, spec.exits);
    const nav = makeNavigation(d), reached = reachable(nav, d.start);
    for (const r of stairs.routes) assert.ok(reached.seen[r.exit.y * nav.width + r.exit.x]);
    assert.ok(Object.values(d.cells).filter(c => c.tile === 'floor').every(c => c.roof));
  }
});
test('intact temple exterior has canonical standards and reliefs, intact castles have piers, neither gets ruined mountain wings', () => {
  for (const [patron, type] of [['Arithus', 'deity_temple'], [null, 'medieval_castle']]) {
    const { db } = compiled(patron, type), d = dungeon(128);
    const spec = { coords: { x: 8, y: 8, z: 0 }, indoor: false, exits: ['east'] };
    Exterior.prepareSceneExteriors(spec, db, { seed: 'test' });
    Exits.install(d, spec.exits); const report = Exterior.applySceneExteriors(d, spec, { early: true });
    assert.equal(report.placed, 1, JSON.stringify(report.rejected));
    assert.ok(d.sceneStructures.some(p => p.role === 'exterior-upper-chambers'));
    assert.ok(!d.sceneStructures.some(p => p.role === 'exterior-mountain-backdrop'));
    if (patron) {
      const relief = d.sceneStructures.find(p => p.role === 'exterior-patron-relief'); assert.ok(relief);
      assert.equal(d.tiles[relief.tile].spriteSpec.shrine.deity, patron);
      assert.equal(relief.shape, 'patron_relief_side');
      assert.ok(relief.position.x < report.buildings[0].doorway.x, 'Emblem projects out of the facade, not inside its solid wall.');
    } else {
      assert.ok(d.sceneStructures.some(p => p.role === 'exterior-gate-pier'));
      assert.ok(!d.sceneStructures.some(p => p.shape === 'fluted_column'));
    }
  }
});
test('combat map reset distinguishes XYZ storeys and ignores turns from the previous floor', () => {
  const source = fs.readFileSync(require.resolve('../assets/combatTacticalUi'), 'utf8'), s = {
    renderRT: { clear() {} }, actorRT: { clear() {} }, redrawCombatRT() {}, domContainer: {}, _lastDungeonDraw: {} };
  const root = { combatGame: { scene: { getScene: () => s } } }, context = { window: root,
    document: { getElementById: () => null }, console };
  vm.runInNewContext(source, context); const ui = root.CombatTacticalUi;
  ui.changeFloor('9,8,0', true); ui.receive({ active: { kind: 'combat', turn: { geoKey: '9,8,0' } } });
  assert.equal(ui.active(), true); ui.changeFloor('9,8,1', true); assert.equal(ui.active(), false);
  assert.equal(s._lastDungeonDraw, null); assert.equal(s.domContainer.scrollTop, 0);
  ui.receive({ active: { kind: 'combat', turn: { geoKey: '9,8,0' } } }); assert.equal(ui.active(), false);
  ui.receive({ active: { kind: 'combat', turn: { geoKey: '9,8,1' } } }); assert.equal(ui.active(), true);
});
