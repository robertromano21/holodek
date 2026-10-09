const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSceneSpec } = require('../retort/sceneSpec');
const { applySceneArchitecture, makeNavigation, reachable, complexDimensions, compassExits } = require('../retort/sceneArchitecture');
const { applySceneRoofs, roofStyle } = require('../retort/sceneRoofs');
const { whollyRoofless } = require('../retort/indoorRoofPlan');
const V = require('../assets/scenePropVoxels');

function room(name, description, indoor = true) {
  const spec = buildSceneSpec({ roomName: name, description, indoorHint: indoor });
  const d = { layout: { width: 32, height: 32 }, start: { x: 16, y: 26 }, cells: {}, tiles: {},
    classification: { indoor }, customTiles: [] };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) d.cells[`${x},${y}`] = {
    tile: x && y && x < 31 && y < 31 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 3
  };
  applySceneArchitecture(d, spec);
  return { d, spec };
}

test('unrecognized indoor rooms get connected ceiling coverage without moving floors or protected content', () => {
  const { d, spec } = room('Hall of Lost Accounts', 'Rows of masonry surround a silent hall.');
  assert.equal(d.sceneArchitecture.status, 'skipped');
  d.cells['10,10'] = { tile: 'floor', interactable: { id: 'treasure' }, floorHeight: 0, ceilHeight: 3 };
  d.cells['0,10'] = { tile: 'torch', feature: 'torch', floorHeight: 0, ceilHeight: 3 };
  d.cells['16,0'] = { tile: 'door', exit: 'north', door: { isOpen: true }, floorHeight: 0, ceilHeight: 3 };
  const original = structuredClone(d.cells), before = reachable(makeNavigation(d), d.start);
  const roof = applySceneRoofs(d, spec), nav = makeNavigation(d), after = reachable(nav, d.start);
  assert.equal(roof.status, 'built');
  assert.equal(roof.roofEvidence, 'indoor-default');
  assert.ok(roof.coverage.ratio >= 0.75, JSON.stringify(roof.coverage));
  for (const [key, c] of Object.entries(d.cells)) assert.equal(c.floorHeight, original[key].floorHeight);
  for (const key of ['0,10', '16,0']) assert.deepEqual(d.cells[key], original[key]);
  assert.deepEqual(d.cells['10,10'].interactable, original['10,10'].interactable);
  for (let i = 0; i < before.seen.length; i++) if (before.seen[i] && nav.passable[i]) assert.ok(after.seen[i]);
  assert.equal(applySceneRoofs(d, spec), roof);
});

test('local roofless courtyards do not suppress covered neighboring halls', () => {
  const { d, spec } = room('Roman Bathhouse', 'A covered barrel-vaulted hall opens onto a roofless courtyard.');
  assert.equal(whollyRoofless(spec), false);
  const roof = applySceneRoofs(d, spec);
  assert.equal(roof.status, 'built');
  const courtyard = d.sceneArchitecture.zones.find(z => z.role === 'courtyard');
  for (let y = courtyard.y; y < courtyard.y + courtyard.height; y++) {
    for (let x = courtyard.x; x < courtyard.x + courtyard.width; x++) assert.equal(d.cells[`${x},${y}`].roof, undefined);
  }
});

test('explicitly roofless buildings override a dome or vault named in the room title', () => {
  for (const name of ['Roman Rotunda', 'Fan Vault Cathedral']) {
    const { d, spec } = room(name, 'The entire building has no roof.');
    const r = applySceneRoofs(d, spec);
    assert.equal(r.status, 'skipped', name);
    assert.equal(d.sceneStructures.length, 0, name);
    assert.ok(Object.values(d.cells).every(c => !c.roof));
  }
});

for (const [name, description, style, shape] of [
  ['Byzantine Basilica', 'Inside a Byzantine basilica, a pendentive dome covers the central hall.', 'pendentive', 'pendentive_transition'],
  ['Squinch Sanctuary', 'Inside a sanctuary, a squinch dome covers a square stone bay.', 'squinch', 'squinch_transition'],
  ['Romanesque Chapel', 'Inside a chapel, a groin vault covers the hall.', 'groin', 'groin_vault_shell'],
  ['Fan Vault Cathedral', 'Inside a Gothic cathedral, fan vaults crown clustered piers.', 'fan', 'fan_vault_shell'],
  ['Timber Basilica', 'Inside a basilica, a hammerbeam roof spans the hall.', 'hammerbeam', 'hammerbeam_truss'],
  ['Early Basilica', 'Inside a basilica, a boarded wooden ceiling covers the hall.', 'boarded', 'boarded_ceiling'],
  ['Imperial Basilica', 'Inside a basilica, a gold-coffered ceiling crowns the hall.', 'gold-coffered', 'gold_coffered_slab']
]) test(`${name} selects and actually constructs ${style} geometry`, () => {
  const { d, spec } = room(name, description);
  assert.equal(roofStyle(spec), style);
  const roof = applySceneRoofs(d, spec);
  assert.equal(roof.status, 'built', JSON.stringify(roof));
  assert.ok(d.sceneStructures.some(p => p.shape === shape), JSON.stringify(roof));
  assert.ok(d.sceneStructures.every(p => V.build(p.shape)), 'Every structural part has a real voxel mesh');
  assert.deepEqual(JSON.parse(JSON.stringify(d)).cells, d.cells);
});

for (const [name, variant] of [['Motte and Bailey Castle', 'motte-bailey'], ['Shell Keep Castle', 'shell-keep'],
  ['Stone Keep Castle', 'stone-keep'], ['Concentric Castle', 'concentric']]) {
  test(`${variant} has a distinct connected castle plan`, () => {
    const { d, spec } = room(name, 'A castle encloses a keep and an open bailey.');
    assert.equal(d.sceneArchitecture.status, 'built', JSON.stringify(d.sceneArchitecture));
    assert.equal(d.sceneArchitecture.variant, variant);
    assert.ok(d.sceneArchitecture.zones.some(z => z.role === 'courtyard'));
    const nav = makeNavigation(d), connected = reachable(nav, d.start);
    for (let i = 0; i < nav.passable.length; i++) if (nav.passable[i]) assert.ok(connected.seen[i]);
    applySceneRoofs(d, spec);
    if (variant === 'motte-bailey') {
      assert.ok(Object.values(d.cells).some(c => c.floorHeight > 0.5));
      assert.ok(Object.values(d.tiles).some(t => t.spriteSpec?.voxelShape === 'palisade'));
    }
    if (variant === 'concentric') assert.ok(Object.values(d.cells).some(c => c.architectureRole === 'inner-curtain'));
    if (variant === 'concentric') {
      const curtain = Object.values(d.cells).find(c => c.architectureRole === 'inner-curtain');
      const outer = Object.values(d.cells).find(c => c.architectureRole === 'shell');
      assert.ok(curtain.ceilHeight > outer.ceilHeight);
    }
  });
}

test('a classical pedimented shrine can be nested in a larger medieval castle', () => {
  const { d, spec } = room('Castle Gatehouse', 'A medieval castle contains a classical pedimented shrine in its court.');
  const r = applySceneRoofs(d, spec);
  assert.equal(d.sceneArchitecture.family, 'castle');
  assert.ok(r.bays.some(b => b.role === 'shrine' && b.idiom === 'classical'), JSON.stringify(r));
  assert.ok(d.sceneStructures.some(p => p.shape === 'pediment'));
});

for (const [name, family] of [['Roman Amphitheater', 'amphitheater'], ['Roman Theater', 'theater'],
  ['Roman Circus', 'circus'], ['Roman Forum', 'forum'], ['Roman Basilica', 'basilica'],
  ['Roman Horreum', 'warehouse'], ['Roman Domus', 'domus'], ['Roman Villa', 'villa'],
  ['Roman Insula', 'insula'], ['Roman Aqueduct', 'infrastructure']]) {
  test(`${name} constructs a navigable ${family} plan, not a renamed temple`, () => {
    const outdoor = ['amphitheater', 'theater', 'circus', 'forum', 'infrastructure'].includes(family);
    const { d, spec } = room(name, 'Ancient masonry encloses a physical building complex.', !outdoor);
    assert.equal(d.sceneArchitecture.status, 'built', JSON.stringify(d.sceneArchitecture));
    assert.equal(d.sceneArchitecture.family, family);
    const nav = makeNavigation(d), connected = reachable(nav, d.start);
    for (let i = 0; i < nav.passable.length; i++) if (nav.passable[i]) assert.ok(connected.seen[i]);
    const roof = applySceneRoofs(d, spec);
    assert.equal(roof.status, 'built', JSON.stringify(roof));
    if (family === 'circus') assert.ok(Object.values(d.cells).some(c => c.architectureRole === 'spina'));
    if (['domus', 'villa', 'forum'].includes(family)) assert.ok(d.sceneArchitecture.zones.some(z => z.role === 'courtyard'));
  });
}

for (const direction of ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']) {
  test(`listed ${direction} exit becomes a connected, reserved complex gateway and sky approach`, () => {
    const { d, spec } = room('Roman Temple', 'Inside a Roman temple, a covered sanctuary rises above a courtyard.');
    // Construct a fresh layout; built campaign architecture remains authoritative.
    for (const c of Object.values(d.cells)) Object.assign(c, { tile: 'floor', floorHeight: 0, ceilHeight: 3, feature: null });
    delete d.sceneArchitecture;
    spec.exits = [direction, 'up', 'down'];
    const a = applySceneArchitecture(d, spec);
    assert.equal(a.status, 'built', JSON.stringify(a));
    assert.deepEqual(a.entrances.map(e => e.direction), [direction]);
    const entrance = a.entrances[0], nav = makeNavigation(d), connected = reachable(nav, d.start);
    for (const point of [entrance, entrance.exterior]) {
      assert.ok(connected.seen[point.y * nav.width + point.x]);
      assert.equal(d.cells[`${point.x},${point.y}`].complexExit, direction);
      assert.equal(d.cells[`${point.x},${point.y}`].navigationReserved, true);
    }
    const dx = entrance.exterior.x - entrance.x, dy = entrance.exterior.y - entrance.y;
    assert.equal(Math.sign(dx), /east/.test(direction) ? 1 : /west/.test(direction) ? -1 : 0);
    assert.equal(Math.sign(dy), /south/.test(direction) ? 1 : /north/.test(direction) ? -1 : 0);
    const originalFloors = Object.fromEntries(Object.entries(d.cells).map(([key, c]) => [key, c.floorHeight]));
    const roof = applySceneRoofs(d, spec);
    assert.equal(roof.status, 'built', JSON.stringify(roof));
    const court = entrance.approach;
    for (let y = court.y; y < court.y + court.height; y++) for (let x = court.x; x < court.x + court.width; x++) {
      assert.equal(d.cells[`${x},${y}`].roof, undefined, `${x},${y}`);
      assert.equal(d.cells[`${x},${y}`].tile, 'floor', `${x},${y}`);
    }
    for (const [key, c] of Object.entries(d.cells)) assert.equal(c.floorHeight, originalFloors[key]);
    assert.ok(roof.coverage.openZones.some(z => z.role === 'complex-exterior'));
    assert.ok(roof.coverage.ratio > 0.5, JSON.stringify(roof.coverage));
    assert.equal(roof.coverage.targetMet, roof.coverage.ratio >= roof.coverage.target);
    assert.ok(roof.facadeParts > 0);
    if (['north', 'east', 'south', 'west'].includes(direction)) {
      assert.ok(roof.gateways.some(g => g.direction === direction), JSON.stringify(roof.rejectedGateways));
      assert.ok(d.sceneStructures.some(p => p.role === 'gateway-lintel'));
    }
    assert.deepEqual(JSON.parse(JSON.stringify(d.sceneArchitecture)), d.sceneArchitecture);
  });
}

test('entrance selection uses only declared directions and preserves protected gateway content', () => {
  assert.deepEqual(compassExits({ exits: ['NORTH', 'north', 'south-east', 'up', 'down', 'unknown', 'constructor', '__proto__'] }), ['north', 'southeast']);
  assert.deepEqual(compassExits({ source: { exits: { east: {}, south: {} } } }), ['east', 'south']);
  const { d, spec } = room('Roman Temple', 'A temple with marble walls.');
  for (const c of Object.values(d.cells)) Object.assign(c, { tile: 'floor', floorHeight: 0, ceilHeight: 3, feature: null });
  const footprint = d.sceneArchitecture.footprint;
  delete d.sceneArchitecture;
  spec.exits = ['north'];
  const key = `${footprint.x + Math.floor(footprint.width / 2)},${footprint.y + 2}`;
  const torch = { tile: 'torch', feature: 'torch', floorHeight: 0, ceilHeight: 3, torchMount: { face: 'south' } };
  d.cells[key] = torch;
  const a = applySceneArchitecture(d, spec);
  assert.equal(a.status, 'built', JSON.stringify(a));
  assert.equal(d.cells[key], torch);
  assert.equal(a.entrances.length, 0);
  assert.equal(a.rejectedEntrances[0].direction, 'north');
  applySceneRoofs(d, spec);
  assert.equal(d.cells[key], torch);
});

test('raised sanctuaries have real shared stair treads and taller supported roof spans', () => {
  const { d, spec } = room('Ruined Temple Entrance', 'Inside a vast hall, towering marble walls enclose a covered sanctuary.');
  const a = d.sceneArchitecture, terrace = a.terraces[0];
  assert.equal(a.dimensions.clearance, 7);
  const x = terrace.approach.x, y = terrace.approach.y;
  assert.deepEqual([0, 1, 2, 3].map(i => d.cells[`${x},${y - i}`].floorHeight), [0.25, 0.5, 0.75, 1]);
  const nav = makeNavigation(d), connected = reachable(nav, d.start);
  for (let i = 0; i < nav.passable.length; i++) if (nav.passable[i]) assert.ok(connected.seen[i]);
  const roof = applySceneRoofs(d, spec);
  assert.ok(roof.bays.every(b => b.springHeight >= 7));
  for (const b of roof.bays) for (const key of b.supports) {
    assert.ok(d.cells[key].ceilHeight >= b.springHeight || b.supportCaps.includes(key));
  }
  assert.equal(complexDimensions({ source: { roomName: 'Crypt' } }).clearance, 3);
  assert.equal(complexDimensions({ source: { roomName: 'Temple', description: 'A high stone ceiling spans the hall.' } }).clearance, 6);
});

test('up and down exits sit beyond multiple real stair flights, with all landings and routes preserved through roof construction', () => {
  const { d, spec } = room('Towering Citadel', 'Inside a great tower, high stone vaults span the keep.');
  delete d.sceneArchitecture;
  for (const c of Object.values(d.cells)) Object.assign(c, { tile: 'floor', floorHeight: 0, ceilHeight: 3, feature: null });
  spec.exits = ['north', 'east', 'up', 'down'];
  const architecture = applySceneArchitecture(d, spec), routes = architecture.verticalRoutes.routes;
  assert.equal(routes.length, 2, JSON.stringify(architecture.verticalRoutes));
  assert.deepEqual(routes.map(r => r.direction), ['up', 'down']);
  const beforeRoof = Object.fromEntries(Object.entries(d.cells).map(([key, c]) => [key, c.floorHeight]));
  applySceneRoofs(d, spec);
  const nav = makeNavigation(d), connected = reachable(nav, d.start);
  for (const route of routes) {
    assert.equal(route.flights.length, 2);
    assert.equal(route.landings.length, 3);
    const sign = route.direction === 'up' ? 1 : -1;
    assert.equal(route.exit.floorHeight, route.start.floorHeight + sign * 4.2);
    for (let y = route.start.y; y >= route.exit.y; y--) {
      const cell = d.cells[`${route.start.x},${y}`];
      assert.equal(cell.tile, 'floor');
      assert.equal(cell.navigationReserved, true);
      assert.equal(cell.floorHeight, beforeRoof[`${route.start.x},${y}`]);
      assert.ok(connected.seen[y * nav.width + route.start.x]);
      if (y < route.start.y) assert.ok(Math.abs(cell.floorHeight - d.cells[`${route.start.x},${y + 1}`].floorHeight) <= route.stepRise + 1e-9);
      if (y > route.exit.y) assert.notEqual(cell.complexExit, route.direction);
    }
    assert.equal(d.cells[`${route.exit.x},${route.exit.y}`].complexExit, route.direction);
  }
  assert.equal(applySceneArchitecture(d, spec), architecture, 'No rebuilding a saved multi-flight route');
});

test('an occupied stair wing is rejected atomically while the base complex and opposite stairs still build', () => {
  const { d, spec } = room('Citadel', 'Inside a citadel, a great tower rises above an open court.');
  const f = d.sceneArchitecture.footprint;
  delete d.sceneArchitecture;
  for (const c of Object.values(d.cells)) Object.assign(c, { tile: 'floor', floorHeight: 0, ceilHeight: 3, feature: null });
  const key = `${f.x + 4},${f.y + 10}`;
  const treasure = { tile: 'floor', interactable: { id: 'protected-shrine' }, floorHeight: 0, ceilHeight: 3 };
  d.cells[key] = treasure;
  spec.exits = ['up', 'down'];
  const architecture = applySceneArchitecture(d, spec);
  assert.equal(architecture.status, 'built');
  assert.equal(d.cells[key], treasure);
  assert.deepEqual(architecture.verticalRoutes.routes.map(r => r.direction), ['down']);
  assert.equal(architecture.verticalRoutes.rejected[0].direction, 'up');
  assert.ok(Object.values(d.cells).every(c => c.stairRoute !== 'up'));
  const nav = makeNavigation(d), connected = reachable(nav, d.start);
  assert.ok(connected.seen[(f.y + 10) * nav.width + f.x + 4]);
});
