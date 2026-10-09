'use strict';

// Compile architecture into the same cells used by collision, 2D, and GPU uploads.
// Work on a bounded patch and commit only after checking the surrounding routes.
const { random } = require('./dungeonGeneration');
const ARCHITECTURE_VERSION = 7;
const MAX_STEP = 1.5; // Matches the current movement controller's tile transition limit.
const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const COMPASS = { north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1],
  south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1] };

function complexDimensions(spec = {}, family = chooseArchitecture(spec)?.family) {
  const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''}`.toLowerCase();
  const clearance = { temple: 5, basilica: 5.5, rotunda: 5.5, castle: 4, catacomb: 3 }[family] || 3.5;
  const lofty = /\b(soaring|towering|vast hall|cavernous|citadel|great tower)\b/.test(text);
  const high = /\b(high|tall|lofty) (?:\w+ )?(?:ceiling|vault|dome|hall|walls)/.test(text);
  return { clearance: Math.max(clearance, lofty ? 7 : high ? 6 : 0), evidence: lofty || high ? 'description' : 'building-family' };
}

function declaredExits(spec = {}) {
  const raw = spec.exits ?? spec.source?.exits ?? [];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;]+/) : Object.keys(raw || {});
  return [...new Set(list.map(exit => String(exit?.direction || exit).toLowerCase().replace(/[\s-]/g, '')))];
}

function compassExits(spec = {}) {
  return declaredExits(spec).filter(exit => Object.hasOwn(COMPASS, exit));
}

function chooseArchitecture(spec = {}) {
  const source = spec.source || {};
  const name = String(source.roomName || '').toLowerCase();
  const families = [
    ['amphitheater', /\b(amphitheat(?:er|re)s?|colosseum|gladiatorial arenas?)\b/],
    ['theater', /\b(theat(?:er|re)s?)\b/],
    ['circus', /\b(circus(?:es)?|chariot tracks?)\b/],
    ['forum', /\b(forums?|fora|civic squares?)\b/],
    ['warehouse', /\b(horrea|horreum|granaries|granary|storehouses?|warehouses?)\b/],
    ['domus', /\b(domus|atrium houses?)\b/],
    ['villa', /\b(villas?|country estates?)\b/],
    ['insula', /\b(insulae?|apartment blocks?)\b/],
    ['basilica', /\b(basilicas?|civic halls?|law courts?)\b/],
    ['infrastructure', /\b(aqueducts?|stone bridges?|roman bridges?|triumphal arches?)\b/],
    ['rotunda', /\b(rotundas?|domed sanctuar\w*|circular temples?)\b/],
    ['castle', /\b(castles?|gatehouses?|forts?|fortresses?|citadels?|keeps?|watchtowers?|great towers?|wizard'?s? towers?|motte|bailey)\b/],
    ['bathhouse', /\b(bathhouses?|thermae|roman baths?)\b/],
    ['catacomb', /\b(catacombs?|crypts?|ossuar\w*|burial chambers?|tombs?)\b/],
    ['temple', /\b(temples?|chapels?|cathedrals?|sanctuar\w*|basilicas?|churches)\b/],
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
    const family = { castle: 'castle', gatehouse: 'castle', bathhouse: 'bathhouse', temple: 'temple', crypt: 'catacomb', catacomb: 'catacomb', ruins: 'ruins',
      basilica: 'basilica', forum: 'forum', villa: 'villa', domus: 'domus', warehouse: 'warehouse', amphitheater: 'amphitheater',
      theater: 'theater', circus: 'circus', insula: 'insula' }[spec.architecture];
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

function castleVariant(spec = {}) {
  const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''}`.toLowerCase();
  if (/watchtower|watch tower/.test(text)) return 'watchtower';
  if (/motte|bailey.*wooden keep/.test(text)) return 'motte-bailey';
  if (/shell[- ]keep/.test(text)) return 'shell-keep';
  if (/concentric|nested.*curtain/.test(text)) return 'concentric';
  if (/stone[- ]keep|great tower|square keep/.test(text)) return 'stone-keep';
  return 'gatehouse';
}

function campaignPlan(dungeon, spec) {
  const seed = dungeon.generation?.seed || spec.generation?.seed;
  if (!seed) return null;
  const rnd = random(`${seed}:architecture`);
  const { width: w, height: h } = dungeon.layout;
  const indoor = spec.indoor === true || spec.indoor !== false && dungeon.classification?.indoor !== false;
  const odd = value => 2 * Math.floor(value / 2) + 1;
  const width = indoor && w >= 48 ? Math.min(w - 6, 63, odd(w * (0.60 + rnd() * 0.14))) : Math.min(19, w - 4);
  const height = indoor && h >= 48 ? Math.min(h - 6, 79, odd(h * (0.68 + rnd() * 0.16))) : Math.min(23, h - 4);
  return { seed, width, height, sanctumDepth: 7 + Math.floor(rnd() * Math.min(8, height / 5)),
    aisleHalfWidth: width >= 31 ? 3 + Math.floor(rnd() * 2) : 2,
    columnSpacing: 6 + Math.floor(rnd() * 4), courtyardSide: rnd() < 0.5 ? -1 : 1,
    courtyardDepth: 7 + Math.floor(rnd() * 4) };
}

function modulePlan(seed, chamber, request, width, height, x, y) {
  // Independent streams keep a room's composition stable when other modules change.
  const key = `${seed}:module:${chamber.index}:${chamber.x},${chamber.y}:${request.type}:${x},${y}:${width}x${height}`;
  const rnd = random(key);
  const integer = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  return { seed: key, width, height,
    sanctumDepth: integer(7, Math.min(14, height - 12, Math.floor(height / 2) - 2)),
    aisleHalfWidth: integer(2, Math.min(5, Math.floor((width - 9) / 2))),
    columnSpacing: integer(4, 8), columnStart: integer(0, 2),
    courtyardSide: rnd() < .5 ? -1 : 1,
    courtyardOffset: integer(-1, 1), courtyardDepth: integer(5, Math.min(10, height - 10)),
    courtyardWidth: integer(3, Math.min(9, width - 12)),
    hallDepth: integer(3, 5), chamberDepth: integer(3, 5),
    rotundaRadius: integer(5, Math.max(5, Math.min(12, Math.floor(width / 2) - 3, Math.floor(height / 2) - 3))),
    arenaInset: integer(2, 4) };
}

function createTemplate(family, width, height, ruined, variant, exits = [], plan = null) {
  const cells = new Map();
  const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
  const put = (x, y, tile, role, reserved = false) => cells.set(`${x},${y}`, { x, y, tile, role, reserved });
  const rect = (x0, y0, x1, y1, tile, role, reserved = false) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, tile, role, reserved);
  };
  const zones = [], anchors = [], entrances = [], terraces = [];
  const sanctumEnd = family === 'temple' || family === 'basilica' ? Math.min(plan?.sanctumDepth || (family === 'temple' ? 7 : 8), height - 12) : 8;
  const half = Math.min(plan?.aisleHalfWidth || 2, cx - 4);
  const columnRows = (begin, end) => {
    if (!plan) return [begin, end];
    const rows = [];
    for (let y = begin + (plan.columnStart || 0); y <= end; y += plan.columnSpacing) rows.push(y);
    return rows;
  };
  // A service passage around the shell preserves connections to the original map.
  rect(1, 1, width - 2, height - 2, 'floor', 'perimeter', true);
  rect(2, 2, width - 3, height - 3, 'wall', 'shell');
  if (['amphitheater', 'theater', 'circus'].includes(family)) {
    rect(3, 3, width - 4, height - 4, 'floor', 'arena');
    const rx = cx - (plan?.arenaInset || 3), ry = family === 'circus' ? cy - (plan?.arenaInset || 2) : Math.min(cy - 3, rx + 2);
    for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
      const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (family === 'theater' && y > cy) continue;
      if (r > 0.66 && r < 1.1) {
        put(x, y, 'floor', 'seating-tier');
        cells.get(`${x},${y}`).floorOffset = Math.floor((r - 0.66) * 8) * 0.25;
      }
    }
    if (family === 'circus') rect(cx + 3, 5, cx + 3, height - 6, 'wall', 'spina');
    if (family === 'theater') rect(4, cy + 3, width - 5, cy + 4, 'floor', 'stage');
    zones.push({ role: 'courtyard', x: cx - rx, y: cy - ry, width: rx * 2 + 1, height: ry * 2 + 1 });
    zones.push({ role: 'arcade', x: 3, y: 3, width: width - 6, height: 2 });
    anchors.push({ role: 'altar', x: cx + 2, y: cy + 1 });
  } else if (family === 'infrastructure') {
    rect(3, 3, width - 4, height - 4, 'floor', 'crossing');
    for (const y of plan ? columnRows(4, height - 5) : [4, 8, 15, height - 5]) for (const x of [cx - half - 1, cx + half + 1]) put(x, y, 'pillar', 'arcade-pier');
    zones.push({ role: 'arcade', x: cx - 2, y: 3, width: 5, height: height - 6 });
  } else if (['forum', 'domus', 'villa', 'insula', 'warehouse', 'basilica'].includes(family)) {
    rect(3, 3, width - 4, height - 4, 'floor', 'hall');
    if (family === 'forum' || family === 'domus' || family === 'villa') {
      const courtWidth = Math.min(plan?.courtyardWidth || 5, half * 2 + 1);
      const courtHeight = plan?.courtyardDepth || 7;
      const court = { role: 'courtyard', x: cx - Math.floor(courtWidth / 2) + (plan?.courtyardOffset || 0),
        y: cy - Math.floor(courtHeight / 2), width: courtWidth, height: courtHeight };
      zones.push(court);
      for (const x of [court.x - 1, court.x + court.width]) for (const y of [court.y, court.y + court.height - 1]) put(x, y, 'pillar', 'peristyle');
      zones.push({ role: 'colonnaded-hall', x: 3, y: 3, width: width - 6, height: 4 });
      if (family !== 'forum') {
        for (const x of [cx - half - 2, cx + half + 2]) {
          rect(x, 3, x, height - 4, 'wall', 'domestic-partition');
          put(x, 5, 'floor', 'threshold', true); put(x, height - 6, 'floor', 'threshold', true);
        }
        zones.push({ role: 'residential-hall', x: 3, y: height - 8, width: width - 6, height: 4 });
      }
      anchors.push({ role: 'pool', x: cx + 1, y: cy - 1 });
    } else if (family === 'warehouse' || family === 'insula') {
      const depth = plan?.hallDepth || 4;
      for (const y of [depth + 3, height - depth - 4]) {
        rect(3, y, width - 4, y, 'wall', family === 'warehouse' ? 'store-partition' : 'apartment-partition');
        for (const x of [cx - 4, cx + 4]) put(x, y, 'floor', 'threshold', true);
      }
      zones.push({ role: 'storage-hall', x: 3, y: 3, width: width - 6, height: depth });
      zones.push({ role: 'storage-hall', x: 3, y: height - depth - 3, width: width - 6, height: depth });
    } else {
      for (const x of [cx - half - 1, cx + half + 1]) for (const y of plan ? columnRows(sanctumEnd + 2, height - 5) : [5, 9, 15, height - 5]) put(x, y, 'pillar', 'basilica-colonnade');
      zones.push({ role: 'civic-nave', x: cx - half, y: 3, width: half * 2 + 1, height: height - 6 });
      anchors.push({ role: 'altar', x: cx + 2, y: 4 });
    }
  } else if (family === 'castle' && variant !== 'gatehouse') {
    rect(3, 3, width - 4, height - 4, 'floor', 'bailey');
    const keepY = 7, radius = Math.min(5, cx - 3);
    if (variant === 'watchtower') {
      rect(cx - 4, cy - 4, cx + 4, cy + 4, 'wall', 'watchtower-shell');
      rect(cx - 3, cy - 3, cx + 3, cy + 3, 'floor', 'watchtower-hall');
      for (const c of cells.values()) if (c.role === 'watchtower-shell') {
        c.clearance = 10 + ((c.x + c.y) % 2 ? .5 : 0);
      }
      zones.push({ role: 'keep-hall', x: cx - 3, y: cy - 3, width: 7, height: 7, clearance: 10, roofStyle: 'timber' });
    } else if (variant === 'shell-keep') {
      for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
        const r = Math.hypot(x - cx, y - keepY);
        if (r <= radius + 0.6) put(x, y, r >= radius - 0.6 ? 'wall' : 'floor', 'shell-keep');
      }
      zones.push({ role: 'keep-hall', x: cx - 2, y: keepY - 2, width: 5, height: 4 });
    } else {
      const inset = variant === 'concentric' ? 4 : 5;
      rect(inset, 3, width - inset - 1, 11, 'wall', 'keep-curtain');
      rect(inset + 1, 4, width - inset - 2, 10, 'floor', 'keep-hall');
      zones.push({ role: 'keep-hall', x: inset + 1, y: 4, width: width - 2 * inset - 2, height: 7 });
      if (variant === 'concentric') {
        // A second curtain has real traversable space between it and the keep.
        rect(3, 12, width - 4, 12, 'wall', 'inner-curtain');
        for (const x of [4, width - 5]) rect(x, 4, x, 11, 'wall', 'inner-curtain');
      }
    }
    zones.push({ role: 'courtyard', x: 3, y: variant === 'watchtower' ? cy + 5 : 13,
      width: width - 6, height: variant === 'watchtower' ? height - cy - 9 : height - 17 });
    if (variant === 'motte-bailey') for (const c of cells.values()) {
      if (c.y < 13) c.floorOffset = Math.max(0, 1.2 - Math.max(Math.abs(c.x - cx), Math.abs(c.y - keepY)) * 0.25);
    }
    anchors.push({ role: 'entrance', x: cx, y: 12 });
  } else if (family === 'castle' || family === 'bathhouse') {
    rect(3, 3, width - 4, height - 4, 'floor', 'courtyard');
    const divider = family === 'castle' ? height - ((plan?.hallDepth || 4) + 4) : (plan?.hallDepth || 4) + 3;
    rect(3, divider, width - 4, divider, 'wall', 'hall-partition');
    zones.push({ role: 'courtyard', x: 3, y: family === 'castle' ? 3 : divider + 1,
      width: width - 6, height: family === 'castle' ? divider - 3 : height - divider - 5 });
    zones.push({ role: family === 'castle' ? 'gate-hall' : 'bathing-hall', x: 3,
      y: family === 'castle' ? divider + 1 : 3, width: width - 6, height: family === 'castle' ? height - divider - 4 : divider - 3 });
    if (family === 'castle') {
      // Paired gate chambers flank, rather than obstruct, the main approach.
      for (const x of [cx - 4, cx + 4]) {
        rect(x, divider + 1, x, height - 4, 'wall', 'gate-chamber');
        put(x, height - 6, 'floor', 'threshold', true);
      }
    } else {
      for (const x of [cx - 4, cx + 4]) for (const y of [10, height - 7]) put(x, y, 'pillar', 'peristyle');
      anchors.push({ role: 'pool', x: cx + 3, y: 4 });
    }
  } else if (family === 'catacomb') {
    rect(cx - 1, 3, cx + 1, height - 3, 'floor', 'spine', true);
    const depth = plan?.chamberDepth || 4;
    for (const y of [(plan?.hallDepth || 3) + 1, height - depth - 6]) {
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? 3 : cx + 3;
        const x1 = side < 0 ? cx - 3 : width - 4;
        rect(x0, y, x1, y + depth - 1, 'floor', 'burial-chamber');
        rect(side < 0 ? cx - 2 : cx + 2, y + 1, side < 0 ? cx - 2 : cx + 2, y + 2, 'floor', 'threshold', true);
        zones.push({ role: 'burial-chamber', x: x0, y, width: x1 - x0 + 1, height: depth });
        anchors.push({ role: 'tomb', x: Math.floor((x0 + x1) / 2), y });
      }
    }
    rect(3, height - 6, width - 4, height - 4, 'floor', 'vestibule');
    zones.push({ role: 'spine', x: cx - 1, y: 3, width: 3, height: height - 5 });
  } else if (family === 'rotunda') {
    const radius = Math.min(cx - 3, cy - 3, plan?.rotundaRadius || 7);
    for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r <= radius + 0.7) put(x, y, r > radius - 0.7 ? 'wall' : 'floor', 'rotunda');
    }
    zones.push({ role: 'rotunda', x: cx - radius, y: cy - radius,
      width: radius * 2 + 1, height: radius * 2 + 1 });
    anchors.push({ role: 'altar', x: cx + 2, y: cy - 2 });
  } else {
    rect(3, 3, width - 4, height - 4, 'floor', family === 'temple' ? 'nave' : 'courtyard');
    if (family === 'temple') {
      rect(3, sanctumEnd, width - 4, sanctumEnd, 'wall', 'sanctum-partition');
      const rows = plan ? [] : [10, height - 7];
      if (plan) rows.push(...columnRows(sanctumEnd + 3, height - 7));
      for (const y of rows) for (const x of [cx - half - 1, cx + half + 1]) put(x, y, 'pillar', 'colonnade');
      zones.push({ role: 'sanctum', x: 3, y: 3, width: width - 6, height: sanctumEnd - 3 });
      zones.push({ role: 'nave', x: cx - half, y: sanctumEnd + 1, width: half * 2 + 1, height: height - sanctumEnd - 5 });
      if (plan && width >= 31) {
        for (const side of [-1, 1]) {
          const x = cx + side * (half + 4);
          rect(x, sanctumEnd + 1, x, height - 5, 'wall', 'side-chapel-partition');
          for (const y of [sanctumEnd + 4, height - 8]) rect(x, y - 1, x, y + 1, 'floor', 'threshold', true);
        }
        if (ruined) zones.push({ role: 'courtyard', x: plan.courtyardSide < 0 ? 3 : cx + half + 5,
          y: sanctumEnd + 5, width: cx - half - 7, height: Math.min(plan.courtyardDepth, height - sanctumEnd - 9) });
      }
      anchors.push({ role: 'altar', x: cx + half + 1, y: 4 });
    } else {
      const offset = plan ? half + 2 : 4, begin = (plan?.hallDepth || 3) + 2;
      rect(cx - offset, begin, cx - offset, cy - 1, 'wall', 'broken-partition');
      rect(cx + offset, cy + 1, cx + offset, height - begin - 1, 'wall', 'broken-partition');
      put(cx - offset, begin + 1, 'floor', 'breach');
      put(cx + offset, height - begin - 2, 'floor', 'breach');
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
  if (family === 'castle' && variant === 'motte-bailey') for (const c of cells.values()) {
    // Include later aisle cuts in the same gradual ramp as the keep plateau.
    if (c.y < 13) c.floorOffset = Math.max(0, 1.2 - Math.max(Math.abs(c.x - cx), Math.abs(c.y - 7)) * 0.25);
  }
  for (const direction of exits) {
    const [dx, dy] = COMPASS[direction];
    const x = dx ? dx < 0 ? 2 : width - 3 : cx;
    const y = dy ? dy < 0 ? 2 : height - 3 : cy;
    // Diagonals use a corner vestibule with an L-shaped route, not diagonal-only navigation.
    rect(Math.min(x, cx) - 1, y - 1, Math.max(x, cx) + 1, y + 1, 'floor', 'entrance-passage', true);
    rect(cx - 1, Math.min(y, cy), cx + 1, Math.max(y, cy), 'floor', 'entrance-passage', true);
    const court = { role: 'exterior-approach', direction,
      x: dx < 0 ? 0 : dx > 0 ? width - 2 : cx - 2,
      y: dy < 0 ? 0 : dy > 0 ? height - 2 : cy - 2,
      width: dx ? 2 : 5, height: dy ? 2 : 5 };
    rect(court.x, court.y, court.x + court.width - 1, court.y + court.height - 1, 'floor', 'exterior-approach', true);
    zones.push(court);
    entrances.push({ direction, x, y, exterior: { x: dx ? x + dx * 2 : x, y: dy ? y + dy * 2 : y },
      width: 3, approach: court });
  }
  if (family === 'temple' || family === 'basilica') {
    // Apply after aisle cuts so the actual approach retains its stair treads.
    const end = sanctumEnd;
    for (const c of cells.values()) if (c.x >= 3 && c.x < width - 3 && c.y >= 3 && c.y <= end) {
      c.floorOffset = Math.min(1, (end + 1 - c.y) * 0.25);
      if (c.tile === 'floor') c.role = c.floorOffset < 1 ? 'sanctuary-step' : 'sanctuary-terrace';
    }
    terraces.push({ role: 'sanctuary-terrace', x: 3, y: 3, width: width - 6, height: end - 5,
      rise: 1, stepRise: 0.25, approach: { x: cx, y: end } });
  }
  anchors.push({ role: 'entrance', x: cx, y: height - 2 });
  return { cells: [...cells.values()], zones, anchors, entrances, terraces };
}

function addVerticalRoutes(dungeon, spec, architecture, mutableKeys) {
  const routes = [], rejected = [];
  const f = architecture.footprint;
  for (const direction of declaredExits(spec).filter(exit => exit === 'up' || exit === 'down')) {
    if (f.height < 20) { rejected.push({ direction, reason: 'layout-too-short-for-two-flights' }); continue; }
    const sign = direction === 'up' ? 1 : -1;
    const x0 = f.x + (sign > 0 ? 3 : f.width - 6), y0 = f.y + f.height - 5;
    const base = dungeon.cells[`${x0 + 1},${y0}`]?.floorHeight || 0;
    const patch = new Map();
    let conflict = null;
    for (let i = 0; i <= 15 && !conflict; i++) for (let dx = 0; dx < 3; dx++) {
      const x = x0 + dx, y = y0 - i, key = `${x},${y}`, c = dungeon.cells[key];
      // New modular partitions/posts may yield to a stair wing; preserved scene content may not.
      const plannedMasonry = mutableKeys.has(key) && (c?.tile === 'wall' || c?.tile === 'pillar' && c.feature === 'pillar');
      if (!c || c.tile !== 'floor' && !plannedMasonry || c.feature && !plannedMasonry || c.door || c.exit || c.complexExit || c.interactable || c.blocked || c.obstacle ||
          Math.hypot(x - dungeon.start.x, y - dungeon.start.y) < 2) {
        conflict = key; break;
      }
      const treads = i <= 6 ? i : i <= 8 ? 6 : Math.min(12, i - 2);
      const floorHeight = Number((base + sign * treads * 0.35).toFixed(3));
      patch.set(key, { ...c, tile: 'floor', feature: null, floorHeight, ceilHeight: floorHeight + architecture.dimensions.clearance,
        navigationReserved: true, architectureRole: i === 0 || i >= 6 && i <= 8 || i >= 14 ? 'stair-landing' : 'stair-tread',
        stairRoute: direction });
    }
    if (conflict) { rejected.push({ direction, reason: 'protected-or-occupied-stair-site', key: conflict }); continue; }
    const nav = makeNavigation(dungeon), before = reachable(nav, dungeon.start);
    const next = { ...nav, passable: nav.passable.slice(), floors: nav.floors.slice() };
    for (const [key, c] of patch) {
      const [x, y] = key.split(',').map(Number);
      next.floors[y * nav.width + x] = c.floorHeight;
      next.passable[y * nav.width + x] = 1;
    }
    const after = reachable(next, dungeon.start);
    const disconnected = before.seen.some((seen, i) => seen && !after.seen[i]);
    const inaccessibleTread = [...patch.keys()].some(key => {
      const [x, y] = key.split(',').map(Number);
      return !after.seen[y * nav.width + x];
    });
    if (disconnected || inaccessibleTread) {
      rejected.push({ direction, reason: 'would-disconnect-stair-route' }); continue;
    }
    const exit = { x: x0 + 1, y: y0 - 15, floorHeight: patch.get(`${x0 + 1},${y0 - 15}`).floorHeight };
    patch.get(`${exit.x},${exit.y}`).complexExit = direction;
    for (const [key, c] of patch) dungeon.cells[key] = c;
    routes.push({ direction, width: 3, stepRise: 0.35, totalRise: sign * 4.2,
      start: { x: x0 + 1, y: y0, floorHeight: base }, exit,
      flights: [{ treads: 6, fromHeight: base, toHeight: base + sign * 2.1 },
        { treads: 6, fromHeight: base + sign * 2.1, toHeight: exit.floorHeight }],
      landings: [0, 7, 15].map(i => ({ x: x0 + 1, y: y0 - i, floorHeight: patch.get(`${x0 + 1},${y0 - i}`).floorHeight })),
      surfaceModel: 'single-surface-stair-wing' });
  }
  return { routes, rejected };
}

function sectionTemplate(type, width, height, request, chamber) {
  const role = { portico: 'shrine', shrine: 'shrine', sanctuary: 'sanctum', courtyard: 'courtyard',
    rotunda_section: 'rotunda', colonnade: 'colonnaded-hall', vaulted_bay: 'interior-hall',
    apsidal_chapel: 'sanctum', switchback_stair: 'interior-hall', split_raised_gallery: 'interior-hall' }[type];
  const roofs = ['stone', 'coffered', 'barrel', 'groin', 'ribbed', 'fan', 'timber', 'hammerbeam', 'boarded', 'gold-coffered', 'pendentive', 'squinch', 'domed', 'pitched'];
  const style = roofs.includes(request.roofStyle) ? request.roofStyle : chamber.roofStyle;
  const order = ['doric', 'ionic', 'corinthian'].includes(request.columnOrder) ? request.columnOrder : chamber.columnOrder;
  const zones = role ? [{ role, x: 0, y: 0, width, height, compact: ['shrine', 'rotunda'].includes(role),
    ...(style ? { roofStyle: style } : {}), ...(order ? { columnOrder: order } : {}),
    ...(Number.isFinite(chamber.clearance) ? { clearance: chamber.clearance } : {}) }] : [];
  const cells = [];
  const terraces = [];
  const zone = (role, x, y, w, h) => ({ role, x, y, width: w, height: h,
    ...(style ? { roofStyle: style } : {}), ...(order ? { columnOrder: order } : {}),
    ...(Number.isFinite(chamber.clearance) ? { clearance: chamber.clearance } : {}) });
  if (type === 'cloister') {
    zones.push(zone('courtyard', 3, 3, width - 6, height - 6),
      zone('colonnaded-hall', 1, 1, width - 2, 2), zone('colonnaded-hall', 1, height - 3, width - 2, 2),
      zone('colonnaded-hall', 1, 3, 2, height - 6), zone('colonnaded-hall', width - 3, 3, 2, height - 6));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pier = [2, width - 3].includes(x) && y >= 3 && y <= height - 4 && (y - 3) % 3 === 0;
      cells.push({ x, y, tile: pier ? 'pillar' : 'floor', role: pier ? 'cloister-pier' :
        x >= 3 && x < width - 3 && y >= 3 && y < height - 3 ? 'courtyard' : 'cloister-gallery' });
    }
  } else if (type === 'apsidal_chapel') {
    const cx = Math.floor(width / 2), depth = Math.min(5, Math.floor(height / 3));
    zones.splice(0, zones.length, zone('sanctum', 2, 1, width - 4, depth),
      zone('interior-hall', 2, depth + 1, width - 4, height - depth - 2));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const arc = y >= 1 && y <= depth && x >= 1 && x < width - 1 &&
        Math.hypot((x - cx) / (cx - 1), (y - depth) / depth) > .95;
      cells.push({ x, y, tile: arc ? 'wall' : 'floor', role: arc ? 'apse-wall' : y <= depth ? 'apse' : 'chapel-nave',
        reserved: !arc && x === cx });
    }
  } else if (type === 'switchback_stair') {
    const horizontal = ['east', 'west'].includes(request.direction);
    const w = horizontal ? height : width, h = horizontal ? width : height;
    const rise = Number.isFinite(request.rise) ? Math.max(-4.2, Math.min(4.2, request.rise)) : 4.2;
    const point = (x, y) => request.direction === 'east' ? { x: h - 1 - y, y: x } :
      request.direction === 'west' ? { x: y, y: w - 1 - x } :
        request.direction === 'south' ? { x: w - 1 - x, y: h - 1 - y } : { x, y };
    zones.splice(0, zones.length, zone('interior-hall', 1, 1, width - 2, height - 2));
    // The return flight occupies a different XY strip, joined by a level U-turn.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const left = x >= 1 && x <= 3, right = x >= w - 4 && x <= w - 2;
      const turn = y >= 1 && y <= 2 && x >= 1 && x < w - 1;
      const flight = (left || right) && y >= 3;
      const divider = x >= 4 && x <= w - 5 && y >= 3;
      const progress = Math.max(0, Math.min(1, (h - 2 - y) / (h - 4)));
      const offset = turn ? rise / 2 : flight ? left ? rise / 2 * progress : rise * (1 - progress / 2) : 0;
      cells.push({ ...point(x, y), tile: divider ? 'wall' : 'floor', floorOffset: Number(offset.toFixed(6)),
        role: divider ? 'stair-divider' : turn || flight && y >= h - 2 ? 'stair-landing' : flight ? 'stair-tread' : 'stair-surround',
        reserved: turn || flight });
    }
    terraces.push({ role: type, x: 0, y: 0, width, height, rise, stepRise: Math.abs(rise) / (2 * (h - 4)),
      approach: point(2, h - 1), landing: point(w - 3, h - 1), surfaceModel: 'single-surface-switchback' });
  } else if (type === 'split_raised_gallery') {
    const cx = Math.floor(width / 2);
    const rise = Number.isFinite(request.rise) ? Math.max(-2, Math.min(2, request.rise)) : 1;
    zones.splice(0, zones.length, zone('colonnaded-hall', 1, 1, cx - 3, height - 2),
      zone('colonnaded-hall', cx + 3, 1, width - cx - 4, height - 2));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const wing = x >= 1 && x <= cx - 2 || x >= cx + 2 && x <= width - 2;
      const offset = wing ? Math.sign(rise) * Math.min(Math.abs(rise), Math.min(y, height - 1 - y) * .25) : 0;
      // Leave a grounded support strip between each reserved gallery and the aisle.
      const supportEdge = x === cx - 2 || x === cx + 2;
      cells.push({ x, y, tile: 'floor', floorOffset: offset, reserved: wing && !supportEdge || Math.abs(x - cx) <= 1,
        role: !wing ? 'gallery-aisle' : Math.abs(offset) < Math.abs(rise) ? 'gallery-step' : 'raised-gallery' });
    }
    for (const z of zones) terraces.push({ role: type, x: z.x, y: z.y, width: z.width, height: z.height,
      rise, stepRise: .25, approach: { x: z.x + Math.floor(z.width / 2), y: 0 } });
  } else if (['sanctuary', 'terrace', 'staircase', 'raised_gallery'].includes(type)) {
    const rise = Number.isFinite(request.rise) ? Math.max(-4.2, Math.min(4.2, request.rise)) : type === 'staircase' ? 4.2 : 1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const horizontal = ['east', 'west'].includes(request.direction);
      const i = horizontal ? request.direction === 'east' ? x : width - x - 1 : request.direction === 'south' ? y : height - y - 1;
      const span = horizontal ? width : height;
      const treads = type === 'staircase' ? Math.min(12, i <= 6 ? i : i <= 8 ? 6 : i - 2) : Math.min(Math.abs(rise) / .25, i);
      const step = type === 'staircase' ? rise / 12 : Math.sign(rise) * .25;
      cells.push({ x, y, tile: 'floor', floorOffset: treads * step,
        role: type === 'staircase' ? i === 0 || i >= span - 2 || i >= 6 && i <= 8 ? 'stair-landing' : 'stair-tread' :
          treads * .25 >= Math.abs(rise) ? 'sanctuary-terrace' : 'sanctuary-step' });
    }
  } else {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.push({ x, y, tile: 'floor', role: role || type });
  }
  return { cells, zones, terraces: terraces.length ? terraces : cells.some(c => c.floorOffset) ? [{ role: type, x: 0, y: 0, width, height }] : [] };
}

function decorateBlueprintLayout(dungeon, spec, report, nav, connected) {
  const outdoor = spec.indoor === false || spec.indoor !== true && dungeon.classification?.indoor === false;
  const seed = dungeon.generation?.seed || spec.generation?.seed || spec.textHash || 'architecture';
  const rnd = random(`${seed}:chamber-architecture`);
  const beforeCount = connected.count;
  const buildings = Array.isArray(dungeon.blueprint?.buildings) ? dungeon.blueprint.buildings.slice(0, 4) : [];
  const plannedRooms = outdoor ? buildings.filter(r => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0).map(r => {
    const w = Math.max(3, Math.min(63, Math.floor(r.w * nav.width))), h = Math.max(3, Math.min(79, Math.floor(r.h * nav.height)));
    return { x: Math.max(1, Math.min(nav.width - w - 1, Math.floor(r.x * nav.width))),
      y: Math.max(1, Math.min(nav.height - h - 1, Math.floor(r.y * nav.height))), w, h, type: r.type, variant: r.variant, ruined: r.ruined };
  }) : dungeon.indoorRooms || [];
  const chambers = plannedRooms.filter(r => r && [r.x, r.y, r.w, r.h].every(Number.isInteger) &&
    r.w > 0 && r.h > 0 && r.x >= 1 && r.y >= 1 && r.x + r.w < nav.width && r.y + r.h < nav.height)
    .map((r, index) => ({ ...r, index, width: r.w, height: r.h, role: r.role || 'chamber' }));
  const zones = [], anchors = [];
  const footprint = chambers.length ? {
    x: Math.min(...chambers.map(r => r.x)), y: Math.min(...chambers.map(r => r.y)),
    width: Math.max(...chambers.map(r => r.x + r.w)) - Math.min(...chambers.map(r => r.x)),
    height: Math.max(...chambers.map(r => r.y + r.h)) - Math.min(...chambers.map(r => r.y))
  } : { x: 1, y: 1, width: nav.width - 2, height: nav.height - 2 };
  let reserved = 0;
  const modules = [];
  const terraces = [];
  const verticalRoutes = { routes: [], rejected: [], source: 'blueprint-elevations-and-local-stair-modules' };
  const families = new Set(['temple', 'basilica', 'castle', 'rotunda', 'bathhouse', 'catacomb', 'ruins',
    'amphitheater', 'theater', 'circus', 'forum', 'domus', 'villa', 'insula', 'warehouse', 'infrastructure']);
  const requestedModules = outdoor ? chambers.map((r, room) => ({ type: r.type, room, variant: r.variant, ruined: r.ruined })) : dungeon.blueprint?.indoorPlan?.modules;
  const sections = new Set(['portico', 'shrine', 'sanctuary', 'rotunda_section', 'colonnade', 'vaulted_bay', 'courtyard', 'terrace', 'staircase', 'raised_gallery',
    'cloister', 'apsidal_chapel', 'switchback_stair', 'split_raised_gallery']);
  for (const request of (Array.isArray(requestedModules) ? requestedModules : []).slice(0, 8)) {
    const chamber = chambers[request?.room];
    const section = sections.has(request?.type);
    if (!chamber || !section && !families.has(request.type)) { modules.push({ type: request?.type || null, status: 'rejected', reason: 'invalid-module-or-room' }); continue; }
    const horizontalStairs = ['staircase', 'switchback_stair'].includes(request.type) && ['east', 'west'].includes(request.direction);
    const galleryRise = Number.isFinite(request.rise) ? Math.min(2, Math.abs(request.rise)) : 1;
    const galleryHeight = Math.max(9, 2 * Math.ceil(galleryRise / .25) + 1);
    const defaults = { rotunda_section: [9, 9], staircase: horizontalStairs ? [16, 3] : [3, 16],
      cloister: [11, 13], apsidal_chapel: [11, 13], switchback_stair: horizontalStairs ? [11, 9] : [9, 11],
      split_raised_gallery: [13, Math.max(13, galleryHeight)] }[request.type] || (section ? [5, 6] : [19, 23]);
    let width = Math.min(chamber.w - 2, Math.max(section ? 3 : 19, Math.min(section ? 19 : 63, Math.floor(Number.isFinite(request.width) ? request.width : defaults[0]))));
    let height = Math.min(chamber.h - 2, Math.max(section ? 3 : 23, Math.min(section ? 23 : 79, Math.floor(Number.isFinite(request.height) ? request.height : defaults[1]))));
    if (request.type === 'rotunda_section') width = height = Math.min(width, height);
    const minimum = { rotunda_section: [7, 7], staircase: horizontalStairs ? [16, 3] : [3, 16],
      cloister: [9, 9], apsidal_chapel: [9, 11], switchback_stair: horizontalStairs ? [11, 9] : [9, 11],
      split_raised_gallery: [13, galleryHeight] }[request.type] || (section ? [3, 4] : [19, 23]);
    if (width < minimum[0] || height < minimum[1]) {
      modules.push({ type: request.type, room: request.room, status: 'rejected', reason: 'insufficient-room-footprint' }); continue;
    }
    const fraction = v => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : .5;
    const x0 = chamber.x + 1 + Math.floor((chamber.w - width - 2) * fraction(request.x));
    const y0 = chamber.y + 1 + Math.floor((chamber.h - height - 2) * fraction(request.y));
    const variant = request.type === 'castle' && ['motte-bailey', 'shell-keep', 'stone-keep', 'concentric', 'gatehouse', 'watchtower'].includes(request.variant) ? request.variant : 'gatehouse';
    const plan = section ? null : modulePlan(seed, chamber, request, width, height, x0, y0);
    const template = section ? sectionTemplate(request.type, width, height, request, chamber) :
      createTemplate(request.type, width, height, request.ruined === true, variant, [], plan);
    const base = dungeon.cells[`${x0},${y0}`]?.floorHeight || 0;
    const patch = new Map();
    let conflict = false;
    for (const c of template.cells) {
      const key = `${x0 + c.x},${y0 + c.y}`, old = dungeon.cells[key];
      // A module cannot erase existing dividing walls, corridors, doors or content.
      if (old?.tile !== 'floor' || old.feature || old.door || old.exit || old.complexExit || old.interactable || old.blocked || old.obstacle || old.trail ||
          Math.abs((old.floorHeight || 0) - base) > 0.5) { conflict = true; break; }
      if (old.navigationReserved || Math.hypot(x0 + c.x - dungeon.start.x, y0 + c.y - dungeon.start.y) < 2) {
        if (c.floorOffset) { conflict = true; break; }
        continue;
      }
      patch.set(key, { ...old, tile: c.tile, feature: c.tile === 'pillar' ? 'pillar' : null,
        architectureRole: c.role, floorHeight: base + (c.floorOffset || 0),
        ceilHeight: base + (c.floorOffset || 0) + Math.max(report.dimensions.clearance, chamber.clearance || 0, c.clearance || 0),
        navigationReserved: c.reserved || false });
    }
    const next = { ...nav, passable: nav.passable.slice(), floors: nav.floors.slice() };
    for (const [key, c] of patch) {
      const [x, y] = key.split(',').map(Number), i = y * nav.width + x;
      next.passable[i] = c.tile === 'floor' ? 1 : 0; next.floors[i] = c.floorHeight;
    }
    const after = reachable(next, dungeon.start);
    const inaccessibleFloor = template.cells.some(c => {
      const x = x0 + c.x, y = y0 + c.y;
      return next.passable[y * nav.width + x] && !after.seen[y * nav.width + x];
    });
    const blocksRoute = connected.seen.some((seen, i) => seen && next.passable[i] && !after.seen[i]);
    if (conflict || blocksRoute || inaccessibleFloor) {
      modules.push({ type: request.type, room: request.room, status: 'rejected',
        reason: conflict ? 'occupied-module-site' : blocksRoute ? 'would-block-route' : 'unreachable-module-site' }); continue;
    }
    for (const [key, c] of patch) dungeon.cells[key] = c;
    nav = next; connected = after;
    const pending = declaredExits(spec).filter(d => ['up', 'down'].includes(d) && !verticalRoutes.routes.some(r => r.direction === d));
    const stairs = section ? { routes: [], rejected: [] } : addVerticalRoutes(dungeon, { ...spec, exits: pending }, {
      footprint: { x: x0, y: y0, width, height }, dimensions: report.dimensions
    }, new Set(patch.keys()));
    verticalRoutes.routes.push(...stairs.routes); verticalRoutes.rejected.push(...stairs.rejected);
    nav = makeNavigation(dungeon); connected = reachable(nav, dungeon.start);
    zones.push(...template.zones.map(z => ({ ...z, ...(section ? {} : { moduleFamily: request.type }), x: x0 + z.x, y: y0 + z.y,
      ...(chamber.columnOrder && !z.columnOrder ? { columnOrder: chamber.columnOrder } : {}),
      ...(Number.isFinite(chamber.clearance) && !Number.isFinite(z.clearance) ? { clearance: Math.max(report.dimensions.clearance, chamber.clearance) } : {}) })));
    terraces.push(...template.terraces.map(t => ({ ...t, x: x0 + t.x, y: y0 + t.y,
      ...(t.approach ? { approach: { x: x0 + t.approach.x, y: y0 + t.approach.y } } : {}),
      ...(t.landing ? { landing: { x: x0 + t.landing.x, y: y0 + t.landing.y } } : {}) })));
    modules.push({ type: request.type, ...(request.type === 'castle' ? { variant } : {}), ...(plan ? { plan } : {}),
      section, room: request.room, status: 'built', x: x0, y: y0, width, height, changedCells: patch.size });
  }
  for (const r of chambers) {
    if (r.role === 'courtyard') { zones.push({ ...r }); continue; }
    const cx = r.x + Math.floor(r.w / 2), cy = r.y + Math.floor(r.h / 2);
    const key = `${cx},${cy}`, c = dungeon.cells[key];
    if (c?.tile === 'floor' && connected.seen[cy * nav.width + cx]) {
      anchors.push({ role: r.role === 'crypt' ? 'tomb' : 'altar', x: cx, y: cy,
        approach: { x: cx, y: cy }, chamber: r.index });
      for (let i = cy * nav.width + cx; i >= 0; i = connected.parent[i]) {
        const cell = dungeon.cells[`${i % nav.width},${Math.floor(i / nav.width)}`];
        if (cell && !cell.navigationReserved) { cell.navigationReserved = true; reserved++; }
      }
    }
    if (outdoor || !['shrine', 'sanctum', 'rotunda'].includes(r.role)) continue;
    const dome = r.role === 'rotunda';
    const width = dome ? Math.min(9, r.w - 2, r.h - 2) : Math.min(5, r.w - 2);
    const height = dome ? width : Math.min(6, r.h - 2);
    if (width < (dome ? 7 : 3) || height < 4) continue;
    const positions = [];
    for (let y = r.y + 1; y <= r.y + r.h - height - 1; y++) {
      for (let x = r.x + 1; x <= r.x + r.w - width - 1; x++) positions.push({ x, y, rank: rnd() });
    }
    positions.sort((a, b) => a.rank - b.rank);
    for (const p of positions) {
      const zone = { ...p, role: dome ? 'rotunda' : 'shrine', width, height, compact: true,
        ...(r.roofStyle ? { roofStyle: r.roofStyle } : {}), ...(r.columnOrder ? { columnOrder: r.columnOrder } : {}) };
      delete zone.rank;
      let valid = true;
      const floors = [];
      for (let dy = 0; dy < height && valid; dy++) for (let dx = 0; dx < width; dx++) {
        const x = p.x + dx, y = p.y + dy, cell = dungeon.cells[`${x},${y}`];
        if (cell?.tile !== 'floor' || cell.feature || cell.exit || cell.door || cell.interactable ||
            !connected.seen[y * nav.width + x] || zones.some(z => x >= z.x && y >= z.y && x < z.x + z.width && y < z.y + z.height)) {
          valid = false; break;
        }
        floors.push(cell.floorHeight || 0);
      }
      if (valid && Math.max(...floors) - Math.min(...floors) <= 0.5) { zones.push(zone); break; }
    }
  }
  Object.assign(report, { status: 'built', mode: outdoor ? 'landscape-decoration' : 'blueprint-decoration', layoutSource: outdoor ? 'llm-landscape' : dungeon.indoorLayout?.source || 'existing-indoor-layout',
    footprint, chambers, zones, anchors, entrances: [], rejectedEntrances: [], terraces, exteriorZones: [],
    modules, verticalRoutes,
    changedCells: reserved + modules.reduce((n, m) => n + (m.changedCells || 0), 0), preservedLayout: true,
    reachability: { before: beforeCount, after: connected.count, conflicts: [] } });
  dungeon.sceneArchitecture = report;
  return report;
}

function applySceneArchitecture(dungeon, spec, options = {}) {
  const selection = chooseArchitecture(spec) || (Array.isArray(dungeon?.blueprint?.buildings) && dungeon.blueprint.buildings.length ?
    { family: 'ruins', evidence: 'blueprint-buildings' } : null);
  const report = { version: ARCHITECTURE_VERSION, status: 'skipped', ...selection };
  const finish = reason => {
    report.reason = reason;
    if (dungeon) dungeon.sceneArchitecture = report;
    return report;
  };
  if (options.enabled === false) return finish('disabled');
  if (dungeon?.sceneArchitecture?.status === 'built') return dungeon.sceneArchitecture;
  if (!selection) return finish('no-supported-physical-architecture');
  const { width: w, height: h } = dungeon?.layout || {};
  const start = dungeon?.start;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w > 512 || h > 512 || w < 19 || h < 21 || !dungeon.cells ||
      !Number.isInteger(start?.x) || !Number.isInteger(start?.y) || start.x < 2 || start.y < 2 || start.x >= w - 2 || start.y >= h - 2) {
    return finish('layout-too-small-or-invalid');
  }
  const plan = campaignPlan(dungeon, spec);
  const width = plan?.width || Math.min(19, w - 4), height = plan?.height || Math.min(23, h - 4);
  const x0 = Math.max(1, Math.min(w - width - 1, start.x - Math.floor(width / 2)));
  const y0 = Math.max(1, Math.min(h - height - 1, start.y - height + 3));
  report.footprint = { x: x0, y: y0, width, height };
  if (plan) report.plan = plan;
  report.dimensions = complexDimensions(spec, selection.family);
  report.requestedEntrances = compassExits(spec);
  report.requestedVerticalExits = declaredExits(spec).filter(exit => exit === 'up' || exit === 'down');
  if (selection.family === 'castle') report.variant = castleVariant(spec);
  const nav = makeNavigation(dungeon);
  const before = reachable(nav, start);
  if (!before.count) return finish('spawn-not-walkable');
  // Real indoor blueprints and legacy mazes own their topology. Templates are only
  // for unplanned exhibits and stand-alone outdoor buildings, never room replacement.
  const indoor = spec.indoor === true || spec.indoor !== false && dungeon.classification?.indoor === true;
  if (indoor && (Array.isArray(dungeon.indoorRooms) || dungeon.blueprint?.indoorPlan || dungeon.indoorLayout)) {
    return decorateBlueprintLayout(dungeon, spec, report, nav, before);
  }
  if (!indoor && dungeon.classification?.indoor === false && dungeon.blueprint) {
    return decorateBlueprintLayout(dungeon, spec, report, nav, before);
  }
  const next = { ...nav, passable: nav.passable.slice(), floors: nav.floors.slice() };
  const base = nav.floors[start.y * w + start.x];
  const template = createTemplate(selection.family, width, height, selection.ruined, report.variant, report.requestedEntrances, plan);
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
    const floor = nav.floors[y * w + x] * (1 - blend) + base * blend + (cell.floorOffset || 0);
    const clearance = Math.max(cell.clearance || 0, report.dimensions.clearance + (selection.family === 'castle' ?
      cell.role === 'keep-curtain' ? 2 : cell.role === 'inner-curtain' ? 1 : 0 : 0));
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

  const entrances = [], rejectedEntrances = [];
  for (const entrance of template.entrances) {
    const x = x0 + entrance.x, y = y0 + entrance.y;
    const exterior = { x: x0 + entrance.exterior.x, y: y0 + entrance.exterior.y };
    const [dx, dy] = COMPASS[entrance.direction];
    // Both sides and the complete three-cell throat must be usable after feature preservation.
    const throat = [-1, 0, 1].every(offset => {
      const px = x + (dx ? 0 : offset), py = y + (dx ? offset : 0);
      return next.passable[py * w + px] && after.seen[py * w + px];
    });
    if (!throat || !after.seen[exterior.y * w + exterior.x]) {
      rejectedEntrances.push({ direction: entrance.direction, reason: 'protected-feature-or-disconnected-approach' });
      continue;
    }
    const approach = { ...entrance.approach, x: x0 + entrance.approach.x, y: y0 + entrance.approach.y };
    entrances.push({ direction: entrance.direction, x, y, exterior, width: entrance.width, approach });
    for (const p of [{ x, y }, exterior]) {
      const key = `${p.x},${p.y}`, c = patch.get(key) || dungeon.cells[key];
      if (c?.tile === 'floor') patch.set(key, { ...c, navigationReserved: true, complexExit: entrance.direction });
    }
  }

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
  report.entrances = entrances;
  report.rejectedEntrances = rejectedEntrances;
  report.terraces = template.terraces.map(t => ({ ...t, x: x0 + t.x, y: y0 + t.y,
    approach: { x: x0 + t.approach.x, y: y0 + t.approach.y } }));
  if (entrances.length && ['temple', 'basilica', 'castle', 'rotunda', 'bathhouse', 'domus', 'villa'].includes(selection.family)) {
    // The rest of this bounded building's map is its exterior, not a floating ceiling field.
    report.exteriorZones = [
      { x: 0, y: 0, width: w, height: y0 + 2 },
      { x: 0, y: y0 + height - 2, width: w, height: h - y0 - height + 2 },
      { x: 0, y: y0 + 2, width: x0 + 2, height: height - 4 },
      { x: x0 + width - 2, y: y0 + 2, width: w - x0 - width + 2, height: height - 4 }
    ].map(z => ({ role: 'complex-exterior', ...z }));
  }
  report.zones = template.zones.map(zone => ({ ...zone, x: x0 + zone.x, y: y0 + zone.y }));
  report.verticalRoutes = addVerticalRoutes(dungeon, spec, report, new Set(patch.keys()));
  report.reachability.after = reachable(makeNavigation(dungeon), start).count;
  dungeon.sceneArchitecture = report;
  return report;
}

module.exports = { applySceneArchitecture, chooseArchitecture, castleVariant, complexDimensions, compassExits, ARCHITECTURE_VERSION, makeNavigation, reachable };
