'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../retort/indoorBlueprint');
const { applySceneArchitecture, makeNavigation, reachable } = require('../retort/sceneArchitecture');
const { applySceneRoofs } = require('../retort/sceneRoofs');
const V = require('../assets/scenePropVoxels');

function fixture(seed = 'variation', modules = [], size = 96) {
  const plan = { rooms: [
    { x: .80, y: .80, w: .15, h: .15, role: 'entrance', floor: 0 },
    { x: .04, y: .04, w: .72, h: .72, role: 'hall', floor: .75, clearance: 7, roofStyle: 'coffered' }
  ], modules, corridors: [{ fromRoom: 0, toRoom: 1, style: 'H', width: 2 }] };
  const d = { layout: { width: size, height: size }, start: { x: Math.floor(size * .87), y: Math.floor(size * .87) },
    cells: {}, tiles: {}, classification: { indoor: true }, generation: { seed }, blueprint: { indoorPlan: plan } };
  const spec = { indoor: true, architecture: 'temple', source: { roomName: 'Temple Complex',
    description: 'Inside masonry halls, supported coffered ceilings shelter the sanctuary.' }, wallStyleMaterial: 'marble' };
  B.build(d, plan, { floor: 0, ceil: 5 });
  return { d, spec, plan };
}

function build(seed, request, size) {
  const f = fixture(seed, [request], size);
  f.original = structuredClone(f.d.cells);
  f.originalLayout = structuredClone(f.d.indoorLayout);
  f.originalRooms = structuredClone(f.d.indoorRooms);
  f.a = applySceneArchitecture(f.d, f.spec);
  f.m = f.a.modules[0];
  assert.equal(f.m.status, 'built', JSON.stringify(f.m));
  return f;
}

function allReachable(d) {
  const nav = makeNavigation(d), seen = reachable(nav, d.start).seen;
  for (let i = 0; i < nav.passable.length; i++) if (nav.passable[i]) {
    assert.ok(seen[i], `unreachable floor ${i % nav.width},${Math.floor(i / nav.width)}`);
  }
}

function layoutSignature(d, m) {
  const cells = [];
  for (let y = m.y; y < m.y + m.height; y++) for (let x = m.x; x < m.x + m.width; x++) {
    const c = d.cells[`${x},${y}`];
    cells.push([c.tile, c.floorHeight, c.architectureRole || null]);
  }
  return JSON.stringify(cells);
}

function preserved(f) {
  const { d, a, original } = f;
  const built = a.modules.filter(m => m.status === 'built');
  assert.deepEqual(d.indoorLayout, f.originalLayout);
  assert.deepEqual(d.indoorRooms, f.originalRooms);
  for (const [key, c] of Object.entries(d.cells)) {
    const old = original[key], [x, y] = key.split(',').map(Number);
    const inside = built.some(m => x >= m.x && y >= m.y && x < m.x + m.width && y < m.y + m.height);
    if (!inside || old.navigationReserved) {
      assert.equal(c.tile, old.tile, key);
      assert.equal(c.floorHeight, old.floorHeight, key);
    }
    if (old.navigationReserved) assert.equal(c.navigationReserved, true, key);
    if (old.tile === 'wall') assert.equal(c.tile, 'wall', `authored wall ${key}`);
  }
  allReachable(d);
}

function supportedRoofs(f) {
  const { d, spec } = f;
  const before = structuredClone(d.cells);
  const roof = applySceneRoofs(d, spec);
  assert.equal(roof.status, 'built');
  assert.ok(roof.bays.length > 0);
  assert.ok(d.sceneStructures.length > 0 && d.sceneStructures.length < 3500);
  for (const bay of roof.bays) {
    assert.ok(bay.supports.length >= bay.minimumSupports);
    for (const key of bay.supports) {
      const c = d.cells[key];
      assert.ok(c.ceilHeight >= bay.springHeight || bay.supportCaps.includes(key), key);
      assert.ok(c.tile === 'wall' || c.feature === 'pillar' || c.structureHeight || c.tile === 'torch', key);
    }
  }
  for (const part of d.sceneStructures) {
    assert.ok(V.build(part.shape), part.shape);
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(part.position[axis]) && Number.isFinite(part.size[axis]));
      assert.ok(part.size[axis] > 0);
    }
    assert.ok(part.position.x >= 0 && part.position.y >= 0);
    assert.ok(part.position.x + part.size.x <= d.layout.width);
    assert.ok(part.position.y + part.size.y <= d.layout.height);
    assert.ok(part.size.x <= 65 && part.size.y <= 81, JSON.stringify(part));
  }
  for (const [key, c] of Object.entries(d.cells)) {
    assert.equal(c.floorHeight, before[key].floorHeight, `roof changed floor ${key}`);
    if (before[key].navigationReserved) assert.equal(c.tile, before[key].tile, `roof blocked ${key}`);
  }
  for (const z of f.a.zones.filter(z => z.role === 'courtyard')) {
    for (let y = z.y; y < z.y + z.height; y++) for (let x = z.x; x < z.x + z.width; x++) {
      assert.equal(d.cells[`${x},${y}`].roof, undefined, `covered courtyard ${x},${y}`);
    }
  }
  allReachable(d);
  return roof;
}

for (const type of ['temple', 'basilica', 'forum', 'domus', 'villa', 'catacomb', 'bathhouse', 'warehouse',
  'insula', 'rotunda', 'infrastructure', 'amphitheater', 'theater', 'circus', 'ruins', 'castle']) {
  test(`${type} full modules vary actual internal layouts, not authored chambers or corridors`, () => {
    const signatures = new Set();
    for (let i = 0; i < 8; i++) {
      const f = build(`composition-${i}`, { type, room: 1, x: 0, y: 0, width: 35, height: 45, ruined: true });
      signatures.add(layoutSignature(f.d, f.m));
      assert.equal(f.m.width, 35);
      assert.equal(f.m.height, 45);
      preserved(f);
      if (i === 0) supportedRoofs(f);
    }
    assert.ok(signatures.size >= 3, `${type} produced only ${signatures.size} real compositions`);
  });
}

test('composition is deterministic per room and independent of unrelated module ordering', () => {
  const request = { type: 'temple', room: 1, width: 35, height: 45, x: 0, y: 0 };
  const a = build('deterministic', request), b = build('deterministic', request);
  assert.deepEqual(a.d.cells, b.d.cells);
  assert.deepEqual(a.a, b.a);
  const extra = { type: 'courtyard', room: 1, x: 1, y: 1 };
  const f = fixture('deterministic', [extra, request]);
  const report = applySceneArchitecture(f.d, f.spec);
  assert.equal(report.modules[1].status, 'built');
  assert.deepEqual(report.modules[1].plan, a.m.plan);
  assert.equal(layoutSignature(f.d, report.modules[1]), layoutSignature(a.d, a.m));
  const saved = JSON.parse(JSON.stringify(a.d));
  const snapshot = structuredClone(saved);
  saved.generation.seed = 'different-new-campaign';
  saved.sceneArchitecture.version = 6;
  const cached = saved.sceneArchitecture;
  assert.equal(applySceneArchitecture(saved, { ...a.spec, source: { roomName: 'Castle' } }), cached);
  assert.equal(applySceneArchitecture(saved, { source: { roomName: 'Accounts' } }), cached);
  assert.deepEqual(saved.cells, snapshot.cells);
});

test('different chambers receive independent seeded compositions in the same campaign', () => {
  const f = fixture('per-room', [], 128);
  f.plan.rooms[1] = { x: .04, y: .04, w: .4, h: .7, role: 'hall', floor: .75 };
  f.plan.rooms.push({ x: .52, y: .04, w: .4, h: .7, role: 'hall', floor: .75 });
  f.plan.corridors.push({ fromRoom: 1, toRoom: 2, style: 'H', width: 2 });
  B.build(f.d, f.plan, { floor: 0, ceil: 5 });
  f.plan.modules = [1, 2].map(room => ({ type: 'temple', room, x: 0, y: 0, width: 35, height: 35 }));
  const a = applySceneArchitecture(f.d, f.spec);
  assert.equal(a.modules[0].status, 'built');
  assert.equal(a.modules[1].status, 'built');
  assert.notEqual(a.modules[0].plan.seed, a.modules[1].plan.seed);
  assert.notEqual(layoutSignature(f.d, a.modules[0]), layoutSignature(f.d, a.modules[1]));
  allReachable(f.d);
});

test('full-module sizes keep defaults, accept explicit sizes, and clamp to footprint and 63x79 bounds', () => {
  for (const [fields, expected] of [
    [{}, [19, 23]], [{ width: 1, height: -5 }, [19, 23]],
    [{ width: 36.9, height: 46.9 }, [36, 46]],
    [{ width: 1e6, height: 1e6 }, [63, 79]],
    [{ width: Infinity, height: NaN }, [19, 23]]
  ]) {
    const f = build('sizes', { type: 'temple', room: 1, x: -5, y: 8, ...fields }, 128);
    assert.deepEqual([f.m.width, f.m.height], expected);
    const r = f.d.indoorRooms[1];
    assert.ok(f.m.x > r.x && f.m.y > r.y);
    assert.ok(f.m.x + f.m.width < r.x + r.w && f.m.y + f.m.height < r.y + r.h);
    assert.ok(f.m.changedCells <= 63 * 79);
    for (const z of f.a.zones) {
      assert.ok(z.width > 0 && z.height > 0);
      assert.ok(z.x >= f.m.x && z.y >= f.m.y && z.x + z.width <= f.m.x + f.m.width && z.y + z.height <= f.m.y + f.m.height);
    }
    preserved(f);
    if (expected[1] === 79) supportedRoofs(f);
  }
  const f = build('chamber-bounds', { type: 'temple', room: 1, width: 1e6, height: 1e6 }, 64);
  assert.deepEqual([f.m.width, f.m.height], [44, 44]);
  preserved(f);
});

test('temple sanctuary heights join at the reported, world-space terrace approach across seeds', () => {
  const depths = new Set(), aisles = new Set(), columns = new Set();
  for (let i = 0; i < 12; i++) {
    const f = build(`terrace-${i}`, { type: 'temple', room: 1, x: 0, y: 0, width: 35, height: 45 });
    const t = f.a.terraces[0], { x, y } = t.approach, base = f.original[`${f.m.x},${f.m.y}`].floorHeight;
    assert.deepEqual([1, 0, -1, -2, -3].map(dy => f.d.cells[`${x},${y + dy}`].floorHeight),
      [base, base + .25, base + .5, base + .75, base + 1]);
    depths.add(t.height);
    aisles.add(f.a.zones.find(z => z.role === 'nave').width);
    columns.add(Object.entries(f.d.cells).filter(([, c]) => c.architectureRole === 'colonnade').map(([key]) => key).join('|'));
    if (i < 3) supportedRoofs(f);
  }
  for (const variation of [depths, aisles, columns]) assert.ok(variation.size >= 3);
});

for (const type of ['cloister', 'apsidal_chapel', 'switchback_stair', 'split_raised_gallery']) {
  test(`${type} is a connected local section with supported roofs and bounded geometry`, () => {
    for (let i = 0; i < 3; i++) {
      const f = build(`section-${i}`, { type, room: 1, x: 0, y: 0 });
      assert.equal(f.m.section, true);
      assert.ok(f.m.width <= 19 && f.m.height <= 23);
      preserved(f);
      const roof = supportedRoofs(f);
      const covered = f.a.zones.filter(z => z.role !== 'courtyard');
      assert.ok(covered.some(z => roof.bays.some(b => b.role === z.role && b.x === z.x && b.y === z.y)),
        `${type} has no supported section-specific bay`);
      const roles = { cloister: 'cloister-pier', apsidal_chapel: 'apse-wall', switchback_stair: 'stair-divider',
        split_raised_gallery: 'raised-gallery' };
      assert.ok(Object.values(f.d.cells).some(c => c.architectureRole === roles[type]));
      if (type === 'cloister') {
        assert.ok(f.a.zones.some(z => z.role === 'courtyard'));
        assert.ok(roof.bays.some(b => b.role === 'colonnaded-hall'));
      }
    }
  });
}

function switchbackPath(m, direction) {
  const horizontal = ['east', 'west'].includes(direction);
  const w = horizontal ? m.height : m.width, h = horizontal ? m.width : m.height;
  const p = (x, y) => direction === 'east' ? { x: h - 1 - y, y: x } : direction === 'west' ? { x: y, y: w - 1 - x } :
    direction === 'south' ? { x: w - 1 - x, y: h - 1 - y } : { x, y };
  const points = [];
  for (let y = h - 1; y >= 1; y--) points.push(p(2, y));
  for (let x = 3; x <= w - 3; x++) points.push(p(x, 1));
  for (let y = 2; y < h; y++) points.push(p(w - 3, y));
  return points.map(p => ({ x: m.x + p.x, y: m.y + p.y }));
}

for (const direction of ['north', 'east', 'south', 'west']) {
  test(`switchback ${direction} has two joined flights and an equal-height turning landing for either rise sign`, () => {
    for (const rise of [4.2, -4.2, 1.3, 0, 100]) {
      const f = build('stairs', { type: 'switchback_stair', room: 1, x: 0, y: 0, direction, rise });
      const path = switchbackPath(f.m, direction), heights = path.map(p => f.d.cells[`${p.x},${p.y}`].floorHeight);
      const t = f.a.terraces[0], effective = Math.max(-4.2, Math.min(4.2, rise));
      assert.deepEqual(t.approach, path[0]);
      assert.deepEqual(t.landing, path.at(-1));
      assert.ok(Math.abs(heights.at(-1) - heights[0] - effective) < 1e-6);
      for (let i = 1; i < heights.length; i++) {
        assert.ok(Math.abs(heights[i] - heights[i - 1]) <= t.stepRise + 1e-6);
        assert.ok(Math.sign(effective) * (heights[i] - heights[i - 1]) >= -1e-6);
      }
      for (const p of path) assert.equal(f.d.cells[`${p.x},${p.y}`].navigationReserved, true);
      supportedRoofs(f);
    }
  });
}

test('split galleries retain a ground-level central aisle and quarter-height joins at both ends', () => {
  for (const rise of [-2, -1, 1, 2, 20]) {
    const f = build('split-gallery', { type: 'split_raised_gallery', room: 1, x: 0, y: 0, rise, height: 19 });
    const { m, d } = f, cx = m.x + Math.floor(m.width / 2), base = f.original[`${m.x},${m.y}`].floorHeight;
    for (let y = m.y; y < m.y + m.height; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      assert.equal(d.cells[`${x},${y}`].floorHeight, base);
      assert.equal(d.cells[`${x},${y}`].tile, 'floor');
    }
    for (const x of [m.x + 2, m.x + m.width - 3]) {
      const heights = Array.from({ length: m.height }, (_, y) => d.cells[`${x},${m.y + y}`].floorHeight);
      assert.equal(heights[0], base);
      assert.equal(heights.at(-1), base);
      assert.equal(heights[Math.floor(m.height / 2)], base + Math.max(-2, Math.min(2, rise)));
      for (let i = 1; i < heights.length; i++) assert.ok(Math.abs(heights[i] - heights[i - 1]) <= .25);
    }
    supportedRoofs(f);
  }
  const automatic = build('gallery-default', { type: 'split_raised_gallery', room: 1, rise: 2, x: 0, y: 0 });
  assert.equal(automatic.m.height, 17, 'The default run grows enough to reach an explicit rise');
  supportedRoofs(automatic);
});

test('new sections support their minimum and maximum footprints without exceeding their parent room', () => {
  for (const [type, sizes] of [
    ['cloister', [[9, 9], [19, 23]]], ['apsidal_chapel', [[9, 11], [19, 23]]],
    ['switchback_stair', [[9, 11], [19, 23]]], ['split_raised_gallery', [[13, 9], [19, 23]]]
  ]) for (const [width, height] of sizes) {
    const f = build('section-bounds', { type, room: 1, x: 0, y: 0, width, height });
    assert.deepEqual([f.m.width, f.m.height], [width, height]);
    assert.ok(f.m.changedCells <= 19 * 23);
    for (const z of f.a.zones) {
      assert.ok(z.width > 0 && z.height > 0);
      assert.ok(z.x >= f.m.x && z.y >= f.m.y && z.x + z.width <= f.m.x + width && z.y + z.height <= f.m.y + height);
    }
    preserved(f);
    supportedRoofs(f);
  }
});

test('new sections compose at requested chamber offsets without scattering additional rooms', () => {
  const requests = [{ type: 'cloister', x: 0, y: 0 }, { type: 'apsidal_chapel', x: 1, y: 0 },
    { type: 'switchback_stair', x: 0, y: 1 }, { type: 'split_raised_gallery', x: 1, y: 1 }].map(r => ({ ...r, room: 1 }));
  const f = fixture('composition', requests);
  f.original = structuredClone(f.d.cells);
  f.originalLayout = structuredClone(f.d.indoorLayout);
  f.originalRooms = structuredClone(f.d.indoorRooms);
  f.a = applySceneArchitecture(f.d, f.spec);
  assert.equal(f.a.modules.length, 4);
  assert.ok(f.a.modules.every(m => m.status === 'built'), JSON.stringify(f.a.modules));
  preserved(f);
  supportedRoofs(f);
});

test('protected content, trails, reserved elevation routes, and undersized sections reject atomically', () => {
  for (const fields of [{ interactable: { id: 'chest' } }, { door: { locked: false } }, { exit: 'east' },
    { complexExit: 'up' }, { feature: 'torch' }, { blocked: true }, { obstacle: true }, { trail: true }]) {
    const f = fixture('occupied', [{ type: 'cloister', room: 1, x: 0, y: 0 }]);
    const r = f.d.indoorRooms[1], key = `${r.x + 3},${r.y + 3}`;
    Object.assign(f.d.cells[key], fields);
    const old = structuredClone(f.d.cells), protectedCell = f.d.cells[key];
    const a = applySceneArchitecture(f.d, f.spec);
    assert.equal(a.modules[0].reason, 'occupied-module-site');
    assert.equal(f.d.cells[key], protectedCell);
    for (const [key, c] of Object.entries(f.d.cells)) {
      assert.equal(c.tile, old[key].tile);
      assert.equal(c.floorHeight, old[key].floorHeight);
      assert.equal(c.architectureRole, old[key].architectureRole);
    }
  }
  for (const request of [{ type: 'cloister', width: 8 }, { type: 'apsidal_chapel', height: 10 },
    { type: 'switchback_stair', width: 8 }, { type: 'switchback_stair', direction: 'east', width: 10 },
    { type: 'split_raised_gallery', rise: 2, height: 9 }]) {
    const f = fixture('undersized', [{ ...request, room: 1 }]);
    const a = applySceneArchitecture(f.d, f.spec);
    assert.equal(a.modules[0].reason, 'insufficient-room-footprint');
    assert.ok(Object.values(f.d.cells).every(c => !c.architectureRole));
  }
  const f = fixture('reserved-stairs', [{ type: 'switchback_stair', room: 1, x: 0, y: 0 }]);
  const r = f.d.indoorRooms[1];
  f.d.cells[`${r.x + 3},${r.y + 3}`].navigationReserved = true;
  assert.equal(applySceneArchitecture(f.d, f.spec).modules[0].reason, 'occupied-module-site');
});

test('previously reachable reserved floors cannot be stranded by new partitions', () => {
  const f = fixture('route-check', [{ type: 'catacomb', room: 1, x: 0, y: 0, width: 35, height: 45 }]);
  const r = f.d.indoorRooms[1], key = `${r.x + 6},${r.y + 16}`;
  f.d.cells[key].navigationReserved = true;
  const original = structuredClone(f.d.cells), identities = { ...f.d.cells };
  const a = applySceneArchitecture(f.d, f.spec);
  assert.equal(a.modules[0].status, 'rejected');
  assert.equal(a.modules[0].reason, 'would-block-route');
  assert.equal(a.zones.length, 0);
  for (const [key, c] of Object.entries(f.d.cells)) {
    assert.equal(c, identities[key]);
    assert.equal(c.tile, original[key].tile);
    assert.equal(c.floorHeight, original[key].floorHeight);
    assert.equal(c.ceilHeight, original[key].ceilHeight);
    assert.equal(c.architectureRole, original[key].architectureRole);
  }
  allReachable(f.d);
});

test('an isolated raised foundation is rejected as unreachable without any terrain mutation', () => {
  for (const type of ['castle', 'temple']) {
    const size = 64, d = { layout: { width: size, height: size }, start: { x: 50, y: 50 }, cells: {},
      classification: { indoor: false }, generation: { seed: 'world-13' },
      blueprint: { buildings: [{ type, variant: 'watchtower', x: .1, y: .1, w: .4, h: .45 }] } };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const raised = x >= 5 && x <= 32 && y >= 5 && y <= 37;
      d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: raised ? 12 : 0, ceilHeight: raised ? 17 : 5 };
    }
    const original = structuredClone(d.cells), identities = { ...d.cells };
    const a = applySceneArchitecture(d, { indoor: false, source: { roomName: 'Wastes' } });
    assert.equal(a.modules[0].status, 'rejected');
    assert.equal(a.modules[0].reason, 'unreachable-module-site');
    assert.deepEqual(d.cells, original);
    for (const key of Object.keys(d.cells)) assert.equal(d.cells[key], identities[key]);
    assert.equal(a.zones.length, 0);
    assert.equal(a.terraces.length, 0);
    assert.equal(a.verticalRoutes.routes.length, 0);
  }
});
