'use strict';

const MAX_FOOTPRINT = 24;
const MAX_COLUMNS = 48;
const MAX_REPORTS = 32;
const SPACING = 3;
const STEP_HEIGHT = 1.5;
const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const record = value => Object.prototype.toString.call(value) === '[object Object]';
const clamp01 = value => Math.max(0, Math.min(1, value));
// Match buildDungeonFromBlueprint's position helpers, without carveRect's inclusive minimum 2x2 fill.
const gridPosition = (value, size) => Math.max(0, Math.min(size - 1, Math.floor(clamp01(value) * size)));
const gridExtent = (value, size) => Math.max(1, Math.floor(clamp01(value) * size));
const heightOf = cell => cell?.floorHeight == null ? 0 : Number.isFinite(cell.floorHeight) ? cell.floorHeight : null;

function walkable(cell) {
  if (!cell || cell.blocked || cell.obstacle || cell.blocking || cell.collisionBlocking ||
      cell.walkable === false || heightOf(cell) === null) return false;
  if (cell.tile === 'floor') return !cell.door || cell.door.isOpen === true && !cell.door.locked && !cell.door.isLocked;
  return cell.tile === 'door' && cell.door?.isOpen === true && !cell.door.locked && !cell.door.isLocked;
}

function protectedCell(cell) {
  return cell.tile !== 'floor' || cell.door || cell.feature || cell.interactable || cell.interactive ||
    cell.fixed || cell.immutable || cell.blocked || cell.obstacle || cell.blocking || cell.collisionBlocking ||
    cell.walkable === false || cell.exit || cell.complexExit || cell.roof;
}

function optionLimit(value, fallback, max) {
  return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : fallback;
}

/** Generation-only: changes eligible floor cells and appends one bounded diagnostic report. */
function apply(dungeon, volume, options = {}) {
  const report = { changed: false, reason: null, requestedBounds: null, actualBounds: null,
    count: 0, skipped: 0, cap: false, reserved: 0, skipReasons: {}, columns: [], examined: 0 };
  const skip = reason => { report.reason = reason; return report; };
  if (!record(dungeon) || !record(dungeon.cells) || !record(dungeon.layout)) return skip('invalid-dungeon');
  if (!record(volume) || volume.tile !== 'pillar') return skip('not-pillar');
  options = options || {};
  if (options.enabled === false || options.disabled === true) return skip('disabled');
  if (options.cached === true || dungeon._geometryStamp != null || dungeon._meta?.geometryStamp != null ||
      dungeon._meta?.cachedAt != null || dungeon.loadedFromCache === true) return skip('cached-room');
  const { width, height } = dungeon.layout;
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) return skip('invalid-layout');
  if (!['x', 'y', 'w', 'h'].every(key => Number.isFinite(volume[key])) || volume.w < 0 || volume.h < 0 ||
      (volume.floor != null && !Number.isFinite(volume.floor)) || (volume.ceil != null && !Number.isFinite(volume.ceil))) return skip('invalid-volume');
  const columnHeight = volume.ceil == null ? 2.5 : volume.ceil - (volume.floor ?? 0);
  if (!Number.isFinite(columnHeight) || columnHeight <= 0) return skip('invalid-height');
  if (dungeon.pillarVolumes != null && !Array.isArray(dungeon.pillarVolumes)) return skip('invalid-reports');

  const maxFootprint = optionLimit(options.maxFootprint, MAX_FOOTPRINT, MAX_FOOTPRINT);
  const maxColumns = optionLimit(options.maxColumns, 36, MAX_COLUMNS);
  const requested = { x: gridPosition(volume.x, width), y: gridPosition(volume.y, height),
    w: gridExtent(volume.w, width), h: gridExtent(volume.h, height) };
  const clippedW = Math.min(requested.w, width - requested.x), clippedH = Math.min(requested.h, height - requested.y);
  const actual = { x: requested.x + Math.floor((clippedW - Math.min(clippedW, maxFootprint)) / 2),
    y: requested.y + Math.floor((clippedH - Math.min(clippedH, maxFootprint)) / 2),
    w: Math.min(clippedW, maxFootprint), h: Math.min(clippedH, maxFootprint) };
  report.requestedBounds = requested;
  report.actualBounds = actual;
  report.cap = actual.w < requested.w || actual.h < requested.h;

  const memo = new Map();
  function cellAt(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const key = `${x},${y}`;
    if (!memo.has(key)) memo.set(key, dungeon.cells[key]);
    return memo.get(key);
  }

  function nearbyColumn(x, y) {
    for (let dy = 1 - SPACING; dy < SPACING; dy++) for (let dx = 1 - SPACING; dx < SPACING; dx++) {
      const tile = cellAt(x + dx, y + dy)?.tile;
      const shape = dungeon.tiles?.[tile]?.spriteSpec?.voxelShape;
      if (tile === 'pillar' || typeof shape === 'string' && /_column$/.test(shape)) return true;
    }
    return false;
  }

  function preservesConnectivity(x, y, cell) {
    const neighbors = STEPS.map(([dx, dy]) => ({ x: x + dx, y: y + dy, cell: cellAt(x + dx, y + dy) }))
      .filter(point => walkable(point.cell) && Math.abs(heightOf(point.cell) - heightOf(cell)) <= STEP_HEIGHT);
    if (neighbors.length < 2) return true;
    // A local bypass for every original edge proves removing this cell cannot split the global floor graph.
    // If no bypass fits this bounded 5x5 neighborhood, conservatively leave the column site as floor.
    const seen = new Set([`${neighbors[0].x},${neighbors[0].y}`]), queue = [neighbors[0]];
    for (let head = 0; head < queue.length; head++) {
      const point = queue[head];
      for (const [dx, dy] of STEPS) {
        const nx = point.x + dx, ny = point.y + dy, key = `${nx},${ny}`;
        if ((nx === x && ny === y) || Math.abs(nx - x) > 2 || Math.abs(ny - y) > 2 || seen.has(key)) continue;
        const next = cellAt(nx, ny);
        if (!walkable(next) || Math.abs(heightOf(next) - heightOf(point.cell)) > STEP_HEIGHT) continue;
        seen.add(key);
        queue.push({ x: nx, y: ny, cell: next });
      }
    }
    return neighbors.every(point => seen.has(`${point.x},${point.y}`));
  }

  const candidates = [];
  for (let y = actual.y; y < actual.y + actual.h; y += SPACING) {
    for (let x = actual.x; x < actual.x + actual.w; x += SPACING) candidates.push({ x, y });
  }
  const candidateCount = Math.min(candidates.length, maxColumns);
  report.cap ||= candidates.length > maxColumns;
  const spawn = Number.isFinite(dungeon.start?.x) && Number.isFinite(dungeon.start?.y) ?
    { x: Math.floor(dungeon.start.x), y: Math.floor(dungeon.start.y) } : null;
  const reject = reason => {
    report.skipped++;
    report.skipReasons[reason] = (report.skipReasons[reason] || 0) + 1;
    if (reason === 'reserved') report.reserved++;
  };
  for (let i = 0; i < candidateCount; i++) {
    // Spread a capped count across the entire footprint rather than filling only its first rows.
    const { x, y } = candidates[Math.floor(i * candidates.length / candidateCount)], cell = cellAt(x, y);
    if (!cell) { reject('missing'); continue; }
    if (cell.navigationReserved || cell.reserved || cell.pathReserved ||
        (spawn && Math.abs(x - spawn.x) <= 2 && Math.abs(y - spawn.y) <= 2)) { reject('reserved'); continue; }
    if (protectedCell(cell)) { reject('protected'); continue; }
    const floor = heightOf(cell), ceil = floor == null ? null : floor + columnHeight;
    if (ceil == null || !Number.isFinite(ceil)) { reject('height'); continue; }
    if (nearbyColumn(x, y)) { reject('spacing'); continue; }
    if (!preservesConnectivity(x, y, cell)) { reject('connectivity'); continue; }
    cell.tile = 'pillar';
    cell.ceilHeight = ceil;
    report.columns.push({ x, y, key: `${x},${y}` });
    report.count++;
  }
  report.examined = memo.size;
  report.changed = report.count > 0;
  report.reason = report.changed ? 'applied' : 'no-safe-columns';
  dungeon.pillarVolumes = (dungeon.pillarVolumes || []).concat(report).slice(-MAX_REPORTS);
  return report;
}

module.exports = { apply };
