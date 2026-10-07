'use strict';

// Compile architecture into the same cells used by collision, 2D, and GPU uploads.
// Work on a bounded patch and commit only after checking the surrounding routes.
const ARCHITECTURE_VERSION = 1;
const MAX_STEP = 1.5; // Matches the current movement controller's tile transition limit.
const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function chooseArchitecture(spec = {}) {
  const source = spec.source || {};
  const name = String(source.roomName || '').toLowerCase();
  const families = [
    ['catacomb', /\b(catacombs?|crypts?|ossuar\w*|burial chambers?|tombs?)\b/],
    ['temple', /\b(temples?|chapels?|cathedrals?|sanctuar\w*)\b/],
    ['ruins', /\b(ruins?|ruined courtyards?|ruined halls?)\b/]
  ];
  for (const [family, re] of families) {
    if (re.test(name)) return { family, evidence: 'room-name', ruined: /ruin|broken|collapsed/.test(name) };
  }
  // Outdoor metaphors ("a sanctum of memory", "Mortacia's throne") are not buildings.
  const description = String(source.description || '').toLowerCase();
  for (const [family, re] of families) {
    const physical = description.split(/[.!?;]/).find(sentence =>
      re.test(sentence) && /\b(enter|inside|within|walls|doorway|entrance|nave|courtyard|burial|corridor)\b/.test(sentence)
      && !/\b(like|as if|beyond|distant|once|memory|metaphor)\b/.test(sentence));
    if (physical) return { family, evidence: 'physical-description', ruined: /ruin|collapsed/.test(physical) };
  }
  if (spec.indoor !== false) {
    const family = { temple: 'temple', crypt: 'catacomb', catacomb: 'catacomb', ruins: 'ruins' }[spec.architecture];
    if (family) return { family, evidence: 'indoor-level-spec', ruined: family === 'ruins' };
  }
  return null;
}

function walkable(cell) {
  return !!cell && (cell.tile === 'floor' || (cell.tile === 'door' && !cell.door?.locked));
}

function makeNavigation(dungeon) {
  const { width, height } = dungeon.layout;
  const passable = new Uint8Array(width * height);
  const floors = new Float64Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = dungeon.cells[`${x},${y}`];
    const i = y * width + x;
    passable[i] = walkable(cell) ? 1 : 0;
    floors[i] = Number.isFinite(cell?.floorHeight) ? cell.floorHeight : 0;
  }
  return { width, height, passable, floors };
}

function reachable(nav, start) {
  const { width, height, passable, floors } = nav;
  const seen = new Uint8Array(passable.length);
  const parent = new Int32Array(passable.length).fill(-1);
  const queue = new Int32Array(passable.length);
  const first = start.y * width + start.x;
  let head = 0, count = 0;
  if (!passable[first]) return { seen, parent, count };
  seen[first] = 1;
  queue[count++] = first;
  while (head < count) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    for (const [dx, dy] of DIRECTIONS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (seen[j] || !passable[j] || Math.abs(floors[j] - floors[i]) > MAX_STEP) continue;
      seen[j] = 1; parent[j] = i; queue[count++] = j;
    }
  }
  return { seen, parent, count };
}

function createTemplate(family, width, height, ruined) {
  const cells = new Map();
  const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
  const put = (x, y, tile, role, reserved = false) => cells.set(`${x},${y}`, { x, y, tile, role, reserved });
  const rect = (x0, y0, x1, y1, tile, role, reserved = false) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, tile, role, reserved);
  };
  const zones = [], anchors = [];
  // A service passage around the shell preserves connections to the original map.
  rect(1, 1, width - 2, height - 2, 'floor', 'perimeter', true);
  rect(2, 2, width - 3, height - 3, 'wall', 'shell');
  if (family === 'catacomb') {
    rect(cx - 1, 3, cx + 1, height - 3, 'floor', 'spine', true);
    for (const y of [4, height - 10]) {
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? 3 : cx + 3;
        const x1 = side < 0 ? cx - 3 : width - 4;
        rect(x0, y, x1, y + 3, 'floor', 'burial-chamber');
        rect(side < 0 ? cx - 2 : cx + 2, y + 1, side < 0 ? cx - 2 : cx + 2, y + 2, 'floor', 'threshold', true);
        zones.push({ role: 'burial-chamber', x: x0, y, width: x1 - x0 + 1, height: 4 });
        anchors.push({ role: 'tomb', x: Math.floor((x0 + x1) / 2), y });
      }
    }
    rect(3, height - 6, width - 4, height - 4, 'floor', 'vestibule');
    zones.push({ role: 'spine', x: cx - 1, y: 3, width: 3, height: height - 5 });
  } else {
    rect(3, 3, width - 4, height - 4, 'floor', family === 'temple' ? 'nave' : 'courtyard');
    if (family === 'temple') {
      rect(3, 7, width - 4, 7, 'wall', 'sanctum-partition');
      for (const y of [10, height - 7]) for (const x of [cx - 3, cx + 3]) put(x, y, 'pillar', 'colonnade');
      zones.push({ role: 'sanctum', x: 3, y: 3, width: width - 6, height: 4 });
      zones.push({ role: 'nave', x: cx - 2, y: 8, width: 5, height: height - 12 });
      anchors.push({ role: 'altar', x: cx + 3, y: 4 });
    } else {
      rect(cx - 4, 5, cx - 4, cy - 1, 'wall', 'broken-partition');
      rect(cx + 4, cy + 1, cx + 4, height - 6, 'wall', 'broken-partition');
      put(cx - 4, 6, 'floor', 'breach');
      put(cx + 4, height - 7, 'floor', 'breach');
      zones.push({ role: 'courtyard', x: 3, y: 3, width: width - 6, height: height - 6 });
      anchors.push({ role: 'rubble', x: cx - 3, y: 5 });
    }
  }
  // Three-cell openings suit the player radius and party navigation.
  rect(cx - 1, 1, cx + 1, height - 2, 'floor', 'main-passage', true);
  rect(1, cy, width - 2, cy + 1, 'floor', 'cross-passage', true);
  if (ruined && family !== 'catacomb') {
    rect(2, height - 7, 2, height - 6, 'floor', 'breach', true);
    rect(width - 3, 4, width - 3, 5, 'floor', 'breach', true);
  }
  anchors.push({ role: 'entrance', x: cx, y: height - 2 });
  return { cells: [...cells.values()], zones, anchors };
}

function applySceneArchitecture(dungeon, spec, options = {}) {
  const selection = chooseArchitecture(spec);
  const report = { version: ARCHITECTURE_VERSION, status: 'skipped', ...selection };
  const finish = reason => {
    report.reason = reason;
    if (dungeon) dungeon.sceneArchitecture = report;
    return report;
  };
  if (options.enabled === false) return finish('disabled');
  if (!selection) return finish('no-supported-physical-architecture');
  if (dungeon?.sceneArchitecture?.status === 'built') return dungeon.sceneArchitecture;
  const { width: w, height: h } = dungeon?.layout || {};
  const start = dungeon?.start;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w > 512 || h > 512 || w < 19 || h < 21 || !dungeon.cells ||
      !Number.isInteger(start?.x) || !Number.isInteger(start?.y) || start.x < 2 || start.y < 2 || start.x >= w - 2 || start.y >= h - 2) {
    return finish('layout-too-small-or-invalid');
  }
  const width = Math.min(19, w - 4), height = Math.min(23, h - 4);
  const x0 = Math.max(1, Math.min(w - width - 1, start.x - Math.floor(width / 2)));
  const y0 = Math.max(1, Math.min(h - height - 1, start.y - height + 3));
  report.footprint = { x: x0, y: y0, width, height };
  const nav = makeNavigation(dungeon);
  const before = reachable(nav, start);
  if (!before.count) return finish('spawn-not-walkable');
  const next = { ...nav, passable: nav.passable.slice(), floors: nav.floors.slice() };
  const base = nav.floors[start.y * w + start.x];
  const template = createTemplate(selection.family, width, height, selection.ruined);
  const patch = new Map();
  let preserved = 0;
  for (const cell of template.cells) {
    const x = x0 + cell.x, y = y0 + cell.y, key = `${x},${y}`;
    const old = dungeon.cells[key];
    if (!old) return finish('incomplete-cell-grid');
    // Existing props, torches, doors, exits, and interactive content retain identity and height.
    if (!['floor', 'wall'].includes(old.tile) || old.door || old.exit || old.interactable || old.feature) {
      preserved++;
      continue;
    }
    const distance = Math.min(cell.x, cell.y, width - 1 - cell.x, height - 1 - cell.y);
    const blend = Math.min(1, distance / 4);
    const floor = nav.floors[y * w + x] * (1 - blend) + base * blend;
    const clearance = selection.family === 'catacomb' ? 2.5 : 3.5;
    const spawnArea = Math.abs(x - start.x) <= 1 && Math.abs(y - start.y) <= 1;
    const tile = spawnArea ? 'floor' : cell.tile;
    patch.set(key, {
      ...old, tile, feature: tile === 'pillar' ? 'pillar' : null,
      floorHeight: spawnArea ? base : floor, ceilHeight: (spawnArea ? base : floor) + clearance,
      architectureRole: cell.role, navigationReserved: spawnArea || cell.reserved
    });
    next.passable[y * w + x] = tile === 'floor' ? 1 : 0;
    next.floors[y * w + x] = spawnArea ? base : floor;
  }
  const after = reachable(next, start);
  const conflicts = [];
  for (let i = 0; i < nav.passable.length; i++) {
    if (before.seen[i] && next.passable[i] && !after.seen[i]) {
      if (conflicts.length < 5) conflicts.push(`${i % w},${Math.floor(i / w)}`);
    }
  }
  for (const [key, cell] of patch) {
    const [x, y] = key.split(',').map(Number);
    if (cell.tile === 'floor' && !after.seen[y * w + x] && conflicts.length < 5) conflicts.push(key);
  }
  report.reachability = { before: before.count, after: after.count, conflicts };
  if (conflicts.length) return finish('would-disconnect-walkable-space');

  const anchors = [];
  const reserved = new Set();
  for (const anchor of template.anchors) {
    const desired = { x: x0 + anchor.x, y: y0 + anchor.y };
    const candidates = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = desired.x + dx, y = desired.y + dy, cell = patch.get(`${x},${y}`) || dungeon.cells[`${x},${y}`];
      if (x <= x0 || y <= y0 || x >= x0 + width - 1 || y >= y0 + height - 1 || cell?.tile !== 'floor' || !after.seen[y * w + x]) continue;
      candidates.push({ x, y, distance: Math.abs(dx) + Math.abs(dy) });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const target = candidates[0];
    if (!target) return finish(`no-reachable-${anchor.role}-anchor`);
    const targetIndex = target.y * w + target.x;
    const approachIndex = after.parent[targetIndex] < 0 ? targetIndex : after.parent[targetIndex];
    const approach = { x: approachIndex % w, y: Math.floor(approachIndex / w) };
    anchors.push({ role: anchor.role, x: target.x, y: target.y, approach });
    // The route to the approach stays free even after subsequent landmark placement.
    for (let i = approachIndex; i >= 0; i = after.parent[i]) reserved.add(`${i % w},${Math.floor(i / w)}`);
  }
  for (const key of reserved) {
    const cell = patch.get(key) || dungeon.cells[key];
    if (cell) patch.set(key, { ...cell, navigationReserved: true });
  }
  for (const [key, cell] of patch) dungeon.cells[key] = cell;
  report.status = 'built';
  report.changedCells = patch.size;
  report.preservedFeatures = preserved;
  report.anchors = anchors;
  report.zones = template.zones.map(zone => ({ ...zone, x: x0 + zone.x, y: y0 + zone.y }));
  dungeon.sceneArchitecture = report;
  return report;
}

module.exports = { applySceneArchitecture, chooseArchitecture, ARCHITECTURE_VERSION };
