const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const BlueprintPillars = require('../retort/blueprintPillars');
const { apply } = BlueprintPillars;

function realBuilder(pillars = BlueprintPillars) {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const start = source.indexOf('function buildDungeonFromBlueprint(');
  const end = source.indexOf('async function runDungeonTestingMode', start);
  assert.ok(start >= 0 && end > start, 'The production builder must be available for replay.');
  const reports = [];
  let seed = 7;
  const math = Object.create(Math);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const context = { Math: math, BlueprintPillars: pillars, console: {
    info(label, value) { if (label === '[BlueprintPillars]') reports.push(JSON.parse(value)); },
    log() {}, warn() {}, error() {}
  } };
  vm.runInNewContext(source.slice(start, end), context);
  return {
    reports,
    build(dungeon, classification, blueprint, customTiles = []) {
      seed = 7;
      context.buildDungeonFromBlueprint(dungeon, classification, blueprint, customTiles);
      return dungeon;
    }
  };
}

// Captured from logs/dungeons/0,0,-1-42056-1791509643154.json.gz; tests do not depend on local logs.
function ashlandsReplay() {
  const blueprint = {
    seed: 'whispering_ashlands_001', base: { floor: 0, ceil: 2.5 },
    heightfield: { amplitude: 1.2, roughness: 0.9, scale: 0.18, radial: 0.6, terrace: 0 },
    rooms: [{ x: 0.2, y: 0.2, w: 0.3, h: 0.2, floor: 0, ceil: 2.5 }],
    paths: [{ from: [0.1, 0.8], to: [0.9, 0.8], width: 0.08, flatten: true, ramp: true }],
    volumes: [
      { x: 0.35, y: 0.3, w: 0.1, h: 0.15, floor: 0, ceil: 2.5, tile: 'ruin_wall' },
      { x: 0.6, y: 0.4, w: 0.12, h: 0.12, floor: 0, ceil: 2.5, tile: 'pillar' }
    ],
    prefabs: [
      { type: 'mountain', x: 0.5, y: 0.5, w: 0.12, h: 0.12, height: 2.5, count: 3 },
      { type: 'statue', x: 0.25, y: 0.25, w: 0.1, h: 0.2, height: 2, count: 1 },
      { type: 'broken_columns', x: 0.7, y: 0.3, w: 0.15, h: 0.15, height: 1.5, count: 2 }
    ],
    props: [
      { type: 'ember_glass_shards', x: 0.55, y: 0.45, scale: 1 },
      { type: 'obsidian_thorned_shrubs', x: 0.4, y: 0.5, scale: 1.2 },
      { type: 'half_buried_rune_stones', x: 0.3, y: 0.35, scale: 0.8 },
      { type: 'twisted_trade_goods_fragments', x: 0.6, y: 0.6, scale: 0.7 }
    ],
    indoorPlan: {
      roomCount: 3,
      rooms: [{ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, { x: 0.5, y: 0.4, w: 0.15, h: 0.15 },
        { x: 0.75, y: 0.3, w: 0.1, h: 0.1 }],
      heightLevels: [0, 0.5, -0.5],
      corridors: [{ from: [0.3, 0.3], to: [0.55, 0.45], style: 'L' }, { from: [0.55, 0.45], to: [0.8, 0.35], style: 'H' }]
    }
  };
  const customTiles = [...blueprint.props.map(prop => prop.type), 'statue', 'broken_columns']
    .map((type, index) => ({ type, name: `custom_${type}_${index}` }));
  const classification = { indoor: false, size: 64, biome: 'wasteland', features: ['mountains', 'statues', 'broken_columns'] };
  const dungeon = { geoKey: '0,0,-1', layout: { width: 512, height: 512 }, start: { x: 256, y: 384 }, tiles: {}, customTiles };
  return { dungeon, classification, blueprint, customTiles };
}

const floor = (height = 0, more = {}) => ({ tile: 'floor', floorHeight: height, ceilHeight: height + 2.5, feature: null, ...more });
function room(width = 30, height = 30, more = {}) {
  const cells = {};
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells[`${x},${y}`] = floor();
  return { layout: { width, height }, start: { x: 1, y: 1 }, cells, tiles: {}, ...more };
}
const volume = (more = {}) => ({ tile: 'pillar', x: 0.2, y: 0.2, w: 0.6, h: 0.6, floor: 0, ceil: 2.5, ...more });
const one = (x, y, width = 30, height = 30, more = {}) => volume({ x: x / width, y: y / height, w: 1 / width, h: 1 / height, ...more });
function assertSpacing(columns) {
  for (let i = 0; i < columns.length; i++) for (let j = i + 1; j < columns.length; j++) {
    assert.ok(Math.max(Math.abs(columns[i].x - columns[j].x), Math.abs(columns[i].y - columns[j].y)) >= 3);
  }
}
function reachable(d) {
  const start = `${d.start.x},${d.start.y}`, seen = new Set([start]), queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head], [x, y] = key.split(',').map(Number), cell = d.cells[key];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const targetKey = `${x + dx},${y + dy}`, next = d.cells[targetKey];
      if (seen.has(targetKey) || !next || next.tile !== 'floor' && !(next.tile === 'door' && next.door?.isOpen) ||
          next.blocked || next.obstacle || Math.abs(next.floorHeight - cell.floorHeight) > 1.5) continue;
      seen.add(targetKey); queue.push(targetKey);
    }
  }
  return seen;
}

test('512-cell 12% pillar requests become bounded spaced colonnades, never thousands of pillars', () => {
  let reads = 0;
  const generated = {};
  const cells = new Proxy({}, {
    get(target, key) {
      if (!/^\d+,\d+$/.test(String(key))) return undefined;
      reads++;
      const [x, y] = key.split(',').map(Number);
      if (x >= 512 || y >= 512) return undefined;
      return generated[key] ||= floor();
    },
    ownKeys() { throw new Error('Pillar placement must not scan or allocate the parent room.'); }
  });
  const d = { layout: { width: 512, height: 512 }, start: { x: 256, y: 384 }, cells, tiles: {}, sceneStructures: [] };
  const report = apply(d, volume({ x: 0.6, y: 0.4, w: 0.12, h: 0.12 }));
  assert.deepEqual(report.requestedBounds, { x: 307, y: 204, w: 61, h: 61 });
  assert.deepEqual(report.actualBounds, { x: 325, y: 222, w: 24, h: 24 });
  assert.equal(report.cap, true);
  assert.equal(report.count, 36);
  assert.equal(Object.values(generated).filter(cell => cell.tile === 'pillar').length, 36);
  assert.ok(report.count <= 48);
  assert.ok(reads <= 28 * 28);
  assert.equal(reads, report.examined);
  assert.equal(d.pillarVolumes[0], report);
  assertSpacing(report.columns);
  for (const { x, y } of report.columns) {
    assert.ok(x >= 325 && x < 349 && y >= 222 && y < 246);
    assert.equal(generated[`${x},${y}`].floorHeight, 0);
    assert.equal(generated[`${x},${y}`].ceilHeight, 2.5);
  }
});

test('position conversion matches the real builder helper, including non-square layouts and clamping', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  assert.match(source, /function toGridX\(n\) \{ return Math\.max\(0, Math\.min\(w - 1, Math\.floor\(clamp01\(n\) \* w\)\)\); \}/);
  assert.match(source, /function toGridY\(n\) \{ return Math\.max\(0, Math\.min\(h - 1, Math\.floor\(clamp01\(n\) \* h\)\)\); \}/);
  for (const [x, y, expected] of [[0.6, 0.4, [24, 8]], [1, 1, [39, 19]], [-1, 2, [0, 19]]]) {
    const d = room(40, 20), report = apply(d, volume({ x, y, w: 0, h: 0 }));
    assert.equal(report.count, 1);
    assert.deepEqual([report.columns[0].x, report.columns[0].y], expected);
  }
});

test('a one-cell or sub-cell normalized rectangle places only its single intended pillar', () => {
  for (const size of [0, 0.0001, 1 / 30]) {
    const d = room(), original = structuredClone(d.cells);
    const report = apply(d, one(12, 15, 30, 30, { w: size, h: size }));
    assert.equal(report.count, 1);
    assert.deepEqual(report.requestedBounds, { x: 12, y: 15, w: 1, h: 1 });
    assert.deepEqual(report.columns, [{ x: 12, y: 15, key: '12,15' }]);
    for (const [key, cell] of Object.entries(d.cells)) if (key !== '12,15') assert.deepEqual(cell, original[key]);
  }
});

test('narrow volumes retain their intended line and have two-cell aisles between columns', () => {
  for (const vertical of [false, true]) {
    const d = room();
    const report = apply(d, volume({ x: 0.2, y: 0.2, w: vertical ? 1 / 30 : 0.6, h: vertical ? 0.6 : 1 / 30 }));
    assert.equal(report.count, 6);
    assertSpacing(report.columns);
    for (const point of report.columns) assert.equal(vertical ? point.x : point.y, 6);
    assert.equal(reachable(d).size, 900 - report.count);
  }
});

test('cap settings cannot exceed 24x24 or 48 columns and capped sites remain spread across the footprint', () => {
  for (const [maxColumns, expected] of [[4, 4], [48, 48], [9999, 48]]) {
    const d = room(60, 60), report = apply(d, volume({ w: 1, h: 1 }), { maxColumns, maxFootprint: 9999 });
    assert.equal(report.count, expected);
    assert.ok(report.actualBounds.w <= 24 && report.actualBounds.h <= 24);
    assert.equal(report.cap, true);
    assertSpacing(report.columns);
    assert.ok(Math.max(...report.columns.map(point => point.y)) >= report.actualBounds.y + 18);
  }
});

test('actual bounds and all modified coordinates remain inside the parent room at its bottom-right edge', () => {
  const d = room(12, 8), beforeKeys = Object.keys(d.cells);
  const report = apply(d, volume({ x: 1, y: 1, w: 0.5, h: 0.5 }));
  assert.deepEqual(report.requestedBounds, { x: 11, y: 7, w: 6, h: 4 });
  assert.deepEqual(report.actualBounds, { x: 11, y: 7, w: 1, h: 1 });
  assert.equal(report.count, 1);
  assert.equal(report.cap, true);
  assert.deepEqual(Object.keys(d.cells), beforeKeys);
});

test('existing irregular floors are unchanged and every ceiling uses its own floor plus relative volume height', () => {
  const d = room();
  for (const [key, cell] of Object.entries(d.cells)) {
    const [x, y] = key.split(',').map(Number);
    cell.floorHeight = x * 0.15 - y * 0.1;
    cell.ceilHeight = cell.floorHeight + 2.5;
    cell.custom = { preserved: key };
  }
  const before = structuredClone(d.cells), report = apply(d, volume({ floor: 10, ceil: 14.5 }));
  assert.equal(report.count, 36);
  for (const [key, cell] of Object.entries(d.cells)) {
    assert.equal(cell.floorHeight, before[key].floorHeight);
    assert.deepEqual(cell.custom, before[key].custom);
    assert.equal(cell.ceilHeight, before[key].floorHeight + (cell.tile === 'pillar' ? 4.5 : 2.5));
  }
  assert.equal(reachable(d).size, 900 - report.count);
});

test('default height is 2.5 and a supplied ceiling is relative to the supplied volume floor or zero', () => {
  for (const [more, height] of [[{ floor: undefined, ceil: undefined }, 2.5], [{ floor: 10, ceil: undefined }, 2.5],
    [{ floor: undefined, ceil: 4 }, 4], [{ floor: 7, ceil: 9 }, 2]]) {
    const d = room();
    d.cells['12,15'].floorHeight = 3;
    for (let y = 14; y <= 16; y++) for (let x = 11; x <= 13; x++) d.cells[`${x},${y}`].floorHeight = 3;
    const report = apply(d, one(12, 15, 30, 30, more));
    assert.equal(report.count, 1);
    assert.equal(d.cells['12,15'].floorHeight, 3);
    assert.equal(d.cells['12,15'].ceilHeight, 3 + height);
  }
});

test('fixed doors, walls, torches, pillars, custom features, interactive cells and reserved paths are never overwritten', () => {
  const cases = [{ tile: 'door', door: { isOpen: true, isLocked: false }, fixed: true }, { tile: 'wall' }, { tile: 'torch' },
    { tile: 'pillar' }, { tile: 'custom_altar' }, { feature: 'altar' }, { interactable: { id: 'chest' } }, { interactive: true },
    { fixed: true }, { immutable: true }, { blocked: true }, { obstacle: true }, { exit: 'north' }, { complexExit: 'west' },
    { navigationReserved: true }, { reserved: true }, { pathReserved: true }, { roof: { style: 'timber', height: 8 } }];
  for (const more of cases) {
    const d = room(), protectedCell = floor(0.7, more);
    d.cells['12,15'] = protectedCell;
    const before = JSON.stringify(protectedCell), report = apply(d, one(12, 15));
    assert.equal(report.count, 0, JSON.stringify(more));
    assert.equal(report.skipped, 1);
    assert.equal(d.cells['12,15'], protectedCell);
    assert.equal(JSON.stringify(protectedCell), before);
    if (more.navigationReserved || more.reserved || more.pathReserved) assert.equal(report.reserved, 1);
  }
});

test('the full radius-two spawn neighborhood is reserved without moving spawn or changing floors', () => {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const d = room(30, 30, { start: { x: 12, y: 15 } }), before = structuredClone(d.cells);
    const report = apply(d, one(12 + dx, 15 + dy));
    assert.equal(report.count, 0);
    assert.equal(report.reserved, 1);
    assert.deepEqual(d.cells, before);
    assert.deepEqual(d.start, { x: 12, y: 15 });
  }
});

test('existing columns enforce spacing across separate pillar volumes', () => {
  for (const custom of [false, true]) {
    const d = room();
    d.cells['10,15'].tile = custom ? 'custom_doric' : 'pillar';
    if (custom) d.tiles.custom_doric = { spriteSpec: { voxelShape: 'doric_column' } };
    const before = JSON.stringify(d.cells['10,15']), report = apply(d, one(12, 15));
    assert.equal(report.count, 0);
    assert.equal(report.skipReasons.spacing, 1);
    assert.equal(JSON.stringify(d.cells['10,15']), before);
  }
  const d = room();
  assert.equal(apply(d, one(12, 15)).count, 1);
  assert.equal(apply(d, one(14, 15)).count, 0);
  assert.equal(apply(d, one(15, 15)).count, 1);
});

test('a pillar cannot split a one-cell-wide corridor or a bottleneck between larger floor areas', () => {
  for (const bottleneck of [false, true]) {
    const d = room(15, 15, { start: { x: 1, y: 7 } });
    for (const cell of Object.values(d.cells)) cell.tile = 'wall';
    for (let x = 1; x <= 13; x++) d.cells[`${x},7`].tile = 'floor';
    if (bottleneck) for (let y = 3; y <= 11; y++) {
      for (let x = 1; x <= 13; x++) if (x < 6 || x > 8) d.cells[`${x},${y}`].tile = 'floor';
    }
    const before = reachable(d), original = JSON.stringify(d.cells['7,7']);
    const report = apply(d, one(7, 7, 15, 15));
    assert.equal(report.count, 0);
    assert.equal(report.skipReasons.connectivity, 1);
    assert.equal(JSON.stringify(d.cells['7,7']), original);
    assert.deepEqual(reachable(d), before);
  }
});

test('a geometric bypass with a height jump above 1.5 is not considered connected', () => {
  for (const [height, expected] of [[1.5, 1], [1.500001, 0], [-1.5, 1], [-1.500001, 0]]) {
    const d = room(15, 15, { start: { x: 1, y: 7 } });
    for (const cell of Object.values(d.cells)) cell.tile = 'wall';
    for (let x = 1; x <= 13; x++) d.cells[`${x},7`] = floor();
    for (const key of ['6,6', '7,6', '8,6']) d.cells[key] = floor(height);
    const report = apply(d, one(7, 7, 15, 15));
    assert.equal(report.count, expected, `bypass height ${height}`);
    if (!expected) assert.equal(report.skipReasons.connectivity, 1);
  }
});

test('protected interactive floor neighbors still count when testing whether a route would be severed', () => {
  const d = room(15, 15, { start: { x: 1, y: 7 } });
  for (const cell of Object.values(d.cells)) cell.tile = 'wall';
  for (let x = 1; x <= 13; x++) d.cells[`${x},7`] = floor();
  d.cells['6,7'].interactable = { id: 'floor-switch' };
  const before = structuredClone(d.cells), report = apply(d, one(7, 7, 15, 15));
  assert.equal(report.count, 0);
  assert.equal(report.skipReasons.connectivity, 1);
  assert.deepEqual(d.cells, before);
});

test('sequential columns preserve every remaining reachable floor in an open parent room', () => {
  const d = room(40, 40), before = reachable(d);
  const report = apply(d, volume({ x: 0, y: 0, w: 1, h: 1 }), { maxColumns: 48 });
  const after = reachable(d);
  assert.ok(report.count > 0);
  assert.equal(after.size, before.size - report.count);
  for (const key of before) if (d.cells[key].tile === 'floor') assert.ok(after.has(key), key);
});

test('disconnected existing height regions remain separate and are never flattened or filled wholesale', () => {
  const d = room();
  for (const [key, cell] of Object.entries(d.cells)) if (Number(key.split(',')[0]) >= 15) {
    cell.floorHeight = 8; cell.ceilHeight = 10.5;
  }
  const original = structuredClone(d.cells), before = reachable(d);
  const report = apply(d, volume());
  const after = reachable(d), removedReachable = report.columns.filter(point => before.has(point.key)).length;
  assert.equal(after.size, before.size - removedReachable);
  for (const [key, cell] of Object.entries(d.cells)) assert.equal(cell.floorHeight, original[key].floorHeight);
});

test('invalid pillar requests fail without changing cells or appending reports', () => {
  for (const request of [undefined, null, {}, volume({ x: NaN }), volume({ y: Infinity }), volume({ w: -1 }), volume({ h: -1 }),
    volume({ x: '0.5' }), volume({ w: undefined }), volume({ floor: NaN }), volume({ ceil: Infinity }),
    volume({ floor: 3, ceil: 2 }), volume({ floor: 2, ceil: 2 })]) {
    const d = room(), before = JSON.stringify(d);
    assert.equal(apply(d, request).changed, false);
    assert.equal(JSON.stringify(d), before);
  }
  for (const d of [null, {}, room(0, 30), room(30, 0), { layout: { width: 2.5, height: 3 }, cells: {} }]) {
    const before = JSON.stringify(d);
    assert.equal(apply(d, volume()).changed, false);
    assert.equal(JSON.stringify(d), before);
  }
});

test('disabled, cached and already-finalized rooms are left byte-for-byte unchanged', () => {
  for (const [more, options] of [[{}, { enabled: false }], [{}, { disabled: true }], [{}, { cached: true }],
    [{ _geometryStamp: 'saved' }, undefined], [{ _meta: { geometryStamp: 'saved' } }, undefined],
    [{ _meta: { cachedAt: 12345 } }, undefined], [{ loadedFromCache: true }, undefined]]) {
    const d = room(30, 30, more), before = JSON.stringify(d);
    const report = apply(d, volume(), options);
    assert.equal(report.changed, false);
    assert.equal(report.count, 0);
    assert.equal(JSON.stringify(d), before);
  }
});

test('non-pillar wall, floor, torch, door and custom volumes are untouched for the existing builder to process', () => {
  for (const tile of ['wall', 'floor', 'torch', 'door', 'custom_column', 'PILLAR']) {
    const d = room(), before = JSON.stringify(d), request = volume({ tile }), input = JSON.stringify(request);
    assert.equal(apply(d, request).reason, 'not-pillar');
    assert.equal(JSON.stringify(d), before);
    assert.equal(JSON.stringify(request), input);
  }
});

test('report history is bounded to the most recent 32 volumes and previous reports are not rewritten', () => {
  const d = room(), reports = [];
  for (let i = 0; i < 40; i++) {
    const report = apply(d, one(12, 15));
    reports.push(report);
    assert.ok(d.pillarVolumes.length <= 32);
  }
  assert.equal(d.pillarVolumes.length, 32);
  assert.deepEqual(d.pillarVolumes, reports.slice(-32));
  assert.equal(reports[0].count, 1);
  assert.equal(reports[1].skipReasons.protected, 1);
});

test('deterministic placement changes only pillar tiles, their ceilings and bounded reports', () => {
  const structures = Object.freeze([{ role: 'arch' }]), tiles = Object.freeze({ pillar: { spriteSpec: { profile: 'cylinder' } } });
  const left = room(30, 30, { tiles, sceneStructures: structures, custom: { preserved: true } }), right = structuredClone(left);
  const request = Object.freeze(volume()), before = JSON.stringify({ ...left, cells: undefined });
  const a = apply(left, request), b = apply(right, request);
  assert.deepEqual(a, b);
  assert.deepEqual(left.cells, right.cells);
  assert.equal(left.tiles, tiles);
  assert.equal(left.sceneStructures, structures);
  assert.equal(JSON.stringify({ ...left, cells: undefined, pillarVolumes: undefined }), before);
  assert.equal('_geometryStamp' in left, false);
  assert.equal('objects' in left, false);
  assert.equal('monsters' in left, false);
});

test('real builder replays the latest 512 Ashlands blueprint without filling the pillar rectangle or changing non-pillar terrain', () => {
  const fixture = ashlandsReplay(), builder = realBuilder();
  const inputBefore = JSON.stringify([fixture.blueprint, fixture.classification, fixture.customTiles]);
  const d = builder.build(fixture.dungeon, fixture.classification, fixture.blueprint, fixture.customTiles);
  assert.equal(Object.keys(d.cells).length, 512 * 512);
  assert.equal(d.pillarVolumes.length, 1);
  const report = d.pillarVolumes[0];
  assert.deepEqual(report.requestedBounds, { x: 307, y: 204, w: 61, h: 61 });
  assert.deepEqual(report.actualBounds, { x: 325, y: 222, w: 24, h: 24 });
  assert.equal(report.count, 36);
  assert.equal(report.cap, true);
  assert.ok(report.examined <= 28 * 28);
  assertSpacing(report.columns);
  assert.equal(builder.reports[0].geoKey, '0,0,-1');
  assert.equal(builder.reports[0].count, report.count);

  const baseline = ashlandsReplay();
  baseline.blueprint.volumes = baseline.blueprint.volumes.filter(request => request.tile !== 'pillar');
  builder.build(baseline.dungeon, baseline.classification, baseline.blueprint, baseline.customTiles);
  const columns = new Set(report.columns.map(point => point.key));
  let pillars = 0, differences = 0, rectangleFloors = 0, wallVolumeCells = 0, outsideFootprintFloors = 0;
  for (const [key, cell] of Object.entries(d.cells)) {
    const old = baseline.dungeon.cells[key], [x, y] = key.split(',').map(Number);
    assert.equal(cell.floorHeight, old.floorHeight, `Preserved terrain height at ${key}`);
    if (columns.has(key)) {
      assert.equal(cell.tile, 'pillar', 'Cliff processing must preserve the already-placed column.');
      if (cell.tile === 'pillar') {
        pillars++;
        assert.equal(cell.ceilHeight, cell.floorHeight + 2.5);
      }
      if (JSON.stringify(cell) !== JSON.stringify(old)) differences++;
    } else assert.equal(JSON.stringify(cell), JSON.stringify(old), `Non-pillar geometry at ${key}`);
    if (x >= 307 && x <= 368 && y >= 204 && y <= 266 && cell.tile === 'floor') {
      rectangleFloors++;
      if (x < 325 || x >= 349 || y < 222 || y >= 246) outsideFootprintFloors++;
    }
    if (cell.tile === 'ruin_wall') wallVolumeCells++;
  }
  assert.equal(pillars, report.count);
  assert.equal(differences, report.count);
  assert.ok(rectangleFloors > 3000, `The requested rectangle must stay mostly open, got ${rectangleFloors} floor cells`);
  assert.ok(outsideFootprintFloors > 2000);
  assert.ok(wallVolumeCells > 3000, 'The non-pillar ruin_wall volume must still use the original carveRect behavior.');
  for (const prop of fixture.blueprint.props) {
    const x = Math.floor(prop.x * 512), y = Math.floor(prop.y * 512);
    const tile = fixture.customTiles.find(entry => entry.type === prop.type).name;
    assert.equal(d.cells[`${x},${y}`].tile, tile);
  }
  for (let y = 383; y <= 385; y++) for (let x = 255; x <= 257; x++) assert.equal(d.cells[`${x},${y}`].tile, 'floor');
  assert.equal(JSON.stringify([fixture.blueprint, fixture.classification, fixture.customTiles]), inputBefore);
});

test('real builder pillar stage preserves reserved footprints, fixed features and roof ceilings without non-pillar side effects', () => {
  const fixture = ashlandsReplay();
  const protectedSites = [
    [325, 222, { navigationReserved: true }], [328, 222, { pathReserved: true }], [334, 222, { reserved: true }],
    [340, 222, { tile: 'door', fixed: true, door: { isOpen: false, isLocked: true, key: 'Keep This Key' } }],
    [346, 222, { tile: 'wall', fixed: true }], [325, 225, { tile: 'torch' }],
    [331, 225, { tile: 'custom_existing_altar', feature: 'altar' }], [337, 225, { interactable: { id: 'existing-urn' } }],
    [343, 225, { roof: { style: 'boarded', height: 8 }, ceilHeight: 8 }]
  ];
  function prepare(d) {
    for (const [x, y] of protectedSites) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      d.cells[`${x + dx},${y + dy}`].floorHeight = 0.25;
      d.cells[`${x + dx},${y + dy}`].ceilHeight = 2.75;
    }
    for (const [x, y, more] of protectedSites) Object.assign(d.cells[`${x},${y}`], more);
  }
  let calls = 0;
  const builder = realBuilder({ apply(d, request) {
    calls++;
    prepare(d);
    const before = protectedSites.map(([x, y]) => JSON.stringify(d.cells[`${x},${y}`]));
    const report = BlueprintPillars.apply(d, request);
    for (let i = 0; i < protectedSites.length; i++) {
      const [x, y] = protectedSites[i];
      assert.equal(JSON.stringify(d.cells[`${x},${y}`]), before[i], `Protected cell at the actual pillar stage: ${x},${y}`);
    }
    assert.equal(report.reserved, 3);
    assert.equal(report.skipReasons.protected, 6);
    return report;
  } });
  const structures = [{ role: 'existing-roof', position: { x: 343, y: 225, z: 8 }, size: { x: 1, y: 1, z: 0.3 } }];
  fixture.dungeon.sceneStructures = structures;
  const structuresBefore = JSON.stringify(structures);
  const d = builder.build(fixture.dungeon, fixture.classification, fixture.blueprint, fixture.customTiles);
  assert.equal(calls, 1);
  assert.ok(d.pillarVolumes[0].count > 0 && d.pillarVolumes[0].count <= 27);
  const baseline = ashlandsReplay();
  realBuilder({ apply(d) { prepare(d); return { count: 0 }; } })
    .build(baseline.dungeon, baseline.classification, baseline.blueprint, baseline.customTiles);
  for (const [x, y, more] of protectedSites) {
    const key = `${x},${y}`;
    assert.equal(JSON.stringify(d.cells[key]), JSON.stringify(baseline.dungeon.cells[key]), `Post-builder protection at ${key}`);
    assert.equal(d.cells[key].tile, more.tile || 'floor');
    assert.equal(d.cells[key].floorHeight, 0.25);
  }
  assert.equal(d.cells['343,225'].ceilHeight, 8);
  assert.equal(d.sceneStructures, structures);
  assert.equal(JSON.stringify(structures), structuresBefore);
});

test('real builder normalizes missing pillar heights and still delegates ordinary wall/floor volumes to carveRect', () => {
  const requests = [], builder = realBuilder({ apply(d, request) { requests.push({ ...request }); return BlueprintPillars.apply(d, request); } });
  const d = { layout: { width: 32, height: 32 }, start: { x: 3, y: 28 }, tiles: {} };
  const blueprint = {
    seed: 'height-defaults', base: { floor: 4, ceil: 3 }, heightfield: { amplitude: 0, radial: 0 },
    volumes: [
      { tile: 'wall', x: 0.6, y: 0.6, w: 0.1, h: 0.1, floor: 4.25, ceil: 7.25 },
      { tile: 'floor', x: 0.2, y: 0.2, w: 0.1, h: 0.1, floor: 4.25, ceil: 7.25 },
      { tile: 'pillar', x: 0.4, y: 0.4, w: 1 / 32, h: 1 / 32 }
    ]
  };
  builder.build(d, { indoor: false }, blueprint);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].floor, 4);
  assert.equal(requests[0].ceil, 7);
  assert.equal(d.pillarVolumes[0].count, 1);
  assert.equal(d.cells['12,12'].tile, 'pillar');
  assert.equal(d.cells['12,12'].floorHeight, 4);
  assert.equal(d.cells['12,12'].ceilHeight, 7);
  for (const [tile, x0, y0, x1, y1] of [['wall', 19, 19, 22, 22], ['floor', 6, 6, 9, 9]]) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cell = d.cells[`${x},${y}`];
      assert.equal(cell.tile, tile);
      assert.equal(cell.floorHeight, 4.25);
      assert.equal(cell.ceilHeight, 7.25);
    }
  }
});
