'use strict';

function whollyRoofless(spec = {}) {
  return String(spec.source?.description || '').toLowerCase().split(/[.!?;]/).some(clause =>
    /roofless|unroofed|no roof|without (?:a )?roof|collapsed roof|fallen roof/.test(clause) &&
    (/\b(?:roofless|unroofed) (?:temple|hall|castle|church|chamber|room)\b/.test(clause) ||
      !/courtyard|section|wing|part of|some of|opening|breach/.test(clause)));
}

function inside(zone, x, y) {
  return x >= zone.x && y >= zone.y && x < zone.x + zone.width && y < zone.y + zone.height;
}

// Partition actual reachable interior floors, not a second independently generated map.
function planIndoorRoofs(dungeon, spec, connected, occupied = []) {
  const { width, height } = dungeon.layout;
  const indoor = spec.indoor === true || spec.indoor !== false && dungeon.classification?.indoor === true;
  if (!indoor || whollyRoofless(spec)) return { indoor, zones: [], open: [], eligible: 0, target: 0 };
  const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''}`;
  const architecture = dungeon.sceneArchitecture;
  const open = (architecture?.zones || []).filter(z => z.role === 'courtyard' &&
    (architecture.family !== 'ruins' || /courtyard|open.air/.test(text.toLowerCase())) || z.role === 'exterior-approach').map(z => ({ ...z }));
  open.push(...(architecture?.exteriorZones || []));
  const candidates = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!connected.seen[y * width + x] || dungeon.cells[`${x},${y}`]?.tile !== 'floor') continue;
    candidates.push({ x, y });
  }
  // A coherent sky court or ruined opening, rather than random holes in every roof bay.
  if (!open.length && /courtyard|ruin|collapsed|fractured|broken/.test(text.toLowerCase()) && candidates.length > 80) {
    const anchor = architecture?.footprint || { x: dungeon.start.x - 8, y: dungeon.start.y - 12, width: 16, height: 16 };
    const locations = [{ x: anchor.x + 3, y: anchor.y + 9 },
      { x: anchor.x + anchor.width - 8, y: anchor.y + 9 }, ...candidates];
    findOpening: for (const size of [5, 3]) for (const p of locations) {
      let valid = true;
      for (let dy = 0; dy < size && valid; dy++) for (let dx = 0; dx < size; dx++) {
        const x = p.x + dx, y = p.y + dy;
        if (x >= width || y >= height || !connected.seen[y * width + x] ||
            dungeon.cells[`${x},${y}`]?.tile !== 'floor' || occupied.some(z => inside(z, x, y))) {
          valid = false; break;
        }
      }
      if (valid) { open.push({ role: 'ruined-opening', ...p, width: size, height: size }); break findOpening; }
    }
  }
  const available = new Uint8Array(width * height);
  let eligible = 0;
  for (const { x, y } of candidates) {
    if (open.some(z => inside(z, x, y))) continue;
    eligible++;
    if (!occupied.some(z => inside(z, x, y))) available[y * width + x] = 1;
  }
  const zones = [];
  for (const { x, y } of candidates) {
    if (!available[y * width + x]) continue;
    let w = 0, h = 1;
    const chamber = architecture?.chambers?.find(r => inside(r, x, y));
    const boundaryX = chamber ? chamber.x + chamber.width : width;
    const boundaryY = chamber ? chamber.y + chamber.height : height;
    while (w < 10 && x + w < boundaryX && available[y * width + x + w]) w++;
    while (h < 10 && y + h < boundaryY) {
      let full = true;
      for (let dx = 0; dx < w; dx++) if (!available[(y + h) * width + x + dx]) { full = false; break; }
      if (!full) break;
      h++;
    }
    zones.push({ role: w <= 2 || h <= 2 ? 'covered-corridor' : 'interior-hall', x, y, width: w, height: h,
      infill: true, ...(chamber?.roofStyle ? { roofStyle: chamber.roofStyle } : {}),
      ...(chamber?.columnOrder ? { columnOrder: chamber.columnOrder } : {}),
      ...(Number.isFinite(chamber?.clearance) ? { clearance: chamber.clearance } : {}) });
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) available[(y + dy) * width + x + dx] = 0;
    if (zones.length === 192) break;
  }
  return { indoor, zones, open, eligible, target: 0.75, limitReached: zones.length === 192 };
}

module.exports = { planIndoorRoofs, whollyRoofless, inside };
