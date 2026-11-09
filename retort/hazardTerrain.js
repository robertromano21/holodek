'use strict';
// Chasm and canyon terrain for the collapsing-bridge hazard. It reads the room's existing biome decisions
// (outdoorTerrain profile, biomeRecipes, the biome prop catalog in scenePropVoxels) rather than inventing a biome:
// cliff strata, rim plants, canyon floor, fog and bridge materials all follow the current biome and genre.
const V = require('../assets/scenePropVoxels');
const INDOOR_DEPTH = 14, OUTDOOR_DEPTH = 30;
const K = (x, y) => `${x},${y}`;
const I = require('../assets/dungeonInhabitants');
// Shared traversal rule, with a larger budget than the placement scan so a split region is always noticed.
function bfs(dungeon, origin, cap) {
  const start = { x: Math.floor(origin.x), y: Math.floor(origin.y) }, seen = new Set([K(start.x, start.y)]), queue = [start];
  for (let i = 0; i < queue.length && i < cap; i++) {
    const a = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = { x: a.x + dx, y: a.y + dy }, k = K(b.x, b.y);
      if (seen.has(k) || !I.canTraverse(dungeon, a, b)) continue;
      seen.add(k); queue.push(b);
    }
  }
  return seen;
}
// Outdoor terrain profiles whose relief can hold a canyon (outdoorTerrain.plan builds no relief for the others).
const NO_CANYON = new Set(['flat', 'wetland', 'urban', 'garden']);
const CLIMATES = {
  indoor:     { cliff: ['#5d5850', '#6f695f', '#2e2b27', '#48443d'], floor: 'abyss', floorPal: ['#141518', '#0b0c0e', '#3a3f48', '#050506'], fog: '#07080a', bridge: 'rope', props: null },
  forest:     { cliff: ['#6b675a', '#7c7766', '#3b3a33', '#4f6b3a'], floor: 'river', floorPal: ['#2f5f73', '#3f7f95', '#a9d3de', '#14262e'], fog: '#5d6a66', bridge: 'rope', props: 'forest' },
  jungle:     { cliff: ['#5f6150', '#707259', '#33352b', '#3f7a35'], floor: 'river', floorPal: ['#2d5a4f', '#3c7a68', '#a5d6c4', '#12261f'], fog: '#4f6a5a', bridge: 'rope', props: 'forest' },
  arid:       { cliff: ['#b8693f', '#d9a273', '#7d3f26', '#ead2ab'], floor: 'scree', floorPal: ['#c79b6d', '#a8774f', '#e7caa0', '#5e3d28'], fog: '#c9a57e', bridge: 'bleached', props: 'badlands' },
  icy:        { cliff: ['#8d9aa6', '#c4d2de', '#5f6b77', '#f2f8ff'], floor: 'ice', floorPal: ['#b9d8ea', '#8db6cf', '#f2fbff', '#4d6f84'], fog: '#c8d6e0', bridge: 'iced', props: 'icy' },
  volcanic:   { cliff: ['#35302d', '#4b423c', '#1b1715', '#c2471f'], floor: 'lava', floorPal: ['#ff6a1f', '#c8380f', '#ffd27a', '#3a120a'], fog: '#4a2418', bridge: 'charred', props: 'volcanic' },
  geothermal: { cliff: ['#8b8a78', '#b9b49a', '#55534a', '#d8d06a'], floor: 'mist', floorPal: ['#c9cdbf', '#9ea394', '#f0f2e6', '#5d6158'], fog: '#b8bcae', bridge: 'rope', props: 'volcanic' },
  wetland:    { cliff: ['#5d6455', '#6f7765', '#343a31', '#5a7346'], floor: 'river', floorPal: ['#3a5a52', '#4c7468', '#a8cbbf', '#18271f'], fog: '#6a7a70', bridge: 'rope', props: 'wetland' },
  temperate:  { cliff: ['#77736a', '#8a857a', '#46433d', '#5f7347'], floor: 'river', floorPal: ['#2f5f73', '#3f7f95', '#a9d3de', '#14262e'], fog: '#6f7a7c', bridge: 'rope', props: 'forest' }
};
const BRIDGES = {
  rope:     { label: 'rope-and-plank bridge', material: 'wood', pal: ['#8a6239', '#5c3f24', '#c9a56b', '#2e2014'] },
  bleached: { label: 'sun-bleached rope bridge', material: 'wood', pal: ['#d8c7a2', '#b49f78', '#efe4c8', '#6e5d43'] },
  iced:     { label: 'ice-rimed rope bridge', material: 'wood', pal: ['#7d8a93', '#5d6971', '#e8f6ff', '#2e383f'] },
  charred:  { label: 'scorched rope bridge', material: 'wood', pal: ['#5a4434', '#3a2b21', '#b8946a', '#1a130e'] },
  gantry:   { label: 'sagging steel gantry', material: 'metal', pal: ['#7b8188', '#4a4f55', '#c3c9cf', '#1d2125'] }
};
function text(dungeon) {
  const s = dungeon?.sceneSpec || {};
  return [dungeon?.classification?.biome, s.biome, s.source?.roomName, s.source?.description].filter(Boolean).join(' ').toLowerCase();
}
function context(dungeon, { genre = 'fantasy', tech = false } = {}) {
  const spec = dungeon?.sceneSpec || {}, t = text(dungeon);
  const outdoor = dungeon?.classification?.indoor === false || spec.indoor === false || !!dungeon?.outdoorTerrain;
  let recipe = null; try { recipe = require('./biomeRecipes').resolve({ ...spec, indoor: outdoor ? false : spec.indoor }); } catch { /* no setting layer */ }
  const urban = !!dungeon?.cityFloorContext || !!spec.city || spec.biome === 'city' || dungeon?.classification?.biome === 'city';
  const profile = !outdoor ? 'indoor' : urban ? 'urban' : dungeon?.outdoorTerrain?.profile || recipe?.terrain || 'wasteland';
  const climate = !outdoor ? 'indoor'
    : profile === 'glacial' || /\b(icy|ice|frozen|frost\w*|glaci\w*|snow\w*|tundra|rime|permafrost)\b/.test(t) ? 'icy'
    : profile === 'volcanic' || /\b(lava|magma|volcan\w*|cinder)\b/.test(t) ? 'volcanic'
    : profile === 'geothermal' ? 'geothermal'
    : profile === 'badlands' || /\b(desert|arid|dunes?|wadi|mesas?|sandstone|badlands?)\b/.test(t) ? 'arid'
    : profile === 'wetland' ? 'wetland'
    : /\b(jungle|rainforest)\b/.test(t) ? 'jungle'
    : profile === 'forest' || /\b(forest|woodland|grove)\b/.test(t) ? 'forest' : 'temperate';
  return { outdoor, urban, profile, climate, recipe: recipe?.id || null, genre, tech: !!tech };
}
function canyonAllowed(ctx) { return !!ctx?.outdoor && !NO_CANYON.has(ctx.profile); }
function materials(ctx) {
  const c = CLIMATES[ctx?.climate] || CLIMATES.temperate, style = ctx?.tech ? 'gantry' : c.bridge;
  return { climate: ctx?.climate || 'temperate', cliff: c.cliff, floor: c.floor, floorPal: c.floorPal, fog: c.fog,
    bridgeStyle: style, bridge: BRIDGES[style], rimProps: c.props && !ctx?.tech ? V.biomeShapes.filter(s => V.biomeProps[s].biomes.includes(c.props)) : [],
    depth: ctx?.outdoor ? OUTDOOR_DEPTH : INDOOR_DEPTH };
}
// Carve a rift across the whole reachable floor, perpendicular to travel, with one long bridge as the crossing
// (or a narrow ledge detour when the description gives one). Returns null when no band keeps the room traversable.
function carve(dungeon, ctx, o) {
  const { origin, base, hard, reserved, reach, id } = o, mats = materials(ctx);
  const w = dungeon.layout.width, h = dungeon.layout.height;
  const width = ctx.outdoor ? Math.max(10, Math.min(32, Math.round(Math.min(w, h) * .2))) : Math.max(6, Math.min(12, Math.round(Math.min(w, h) * .2)));
  const cells = [...base].map(k => k.split(',').map(Number));
  // Split the room across its longer reach from the entrance, so the bridge runs the way the party travels.
  const farDist = axis => { const v = cells.map(p => axis === 'x' ? p[0] : p[1]), oa = axis === 'x' ? origin.x : origin.y; return Math.max(Math.max(...v) - oa, oa - Math.min(...v)); };
  for (const axis of o.axes || ['x', 'y'].sort((a, b) => farDist(b) - farDist(a))) {
    const A = p => axis === 'x' ? p[0] : p[1], B = p => axis === 'x' ? p[1] : p[0];
    const key = (a, b) => axis === 'x' ? K(a, b) : K(b, a);
    const along = cells.map(A), lo = Math.min(...along), hi = Math.max(...along), oa = axis === 'x' ? origin.x : origin.y;
    const far = Math.abs(hi - oa) >= Math.abs(oa - lo) ? hi : lo, mid = Math.round((oa + far) / 2 - width / 2);
    const tries = [];
    for (let d = 0; d <= Math.max(hi - lo, 1) && tries.length < 14; d++) for (const c of d ? [mid + d, mid - d] : [mid]) tries.push(c);
    for (const c of tries) {
      if (c < lo + 3 || c + width > hi - 2 || (oa >= c - 3 && oa <= c + width + 2)) continue;
      const band = cells.filter(p => A(p) >= c && A(p) < c + width).map(p => K(p[0], p[1]));
      if (!band.length || band.some(k => hard(k))) continue;
      const perp = [...new Set(band.map(k => B(k.split(',').map(Number))))].sort((x, y) => x - y);
      const median = perp[Math.floor(perp.length / 2)];
      const columns = perp.slice().sort((x, y) => Math.abs(x - median) - Math.abs(y - median)).slice(0, 6);
      for (const b of columns) {
        const span = []; for (let a = c; a < c + width; a++) span.push(key(a, b));
        const ends = [key(c - 1, b), key(c + width, b)];
        if (!span.every(k => base.has(k)) || !ends.every(k => base.has(k) && !reserved.has(k) && !hard(k))) continue;
        const h0 = dungeon.cells[ends[0]].floorHeight || 0, h1 = dungeon.cells[ends[1]].floorHeight || 0;
        if (Math.abs(h1 - h0) > width * .3) continue;
        const ledge = o.detour ? band.filter(k => B(k.split(',').map(Number)) === perp.at(-1) && !span.includes(k)) : [];
        const chasm = band.filter(k => !span.includes(k) && !ledge.includes(k));
        const bottom = Math.min(...band.map(k => dungeon.cells[k].floorHeight || 0)) - mats.depth;
        const trial = { ...dungeon, cells: { ...dungeon.cells } };
        const sag = ctx.outdoor ? Math.min(1.4, width * .07) : Math.min(.35, width * .05);
        span.forEach((k, i) => {
          const t = (i + 1) / (width + 1), top = h0 + (h1 - h0) * t - sag * Math.sin(Math.PI * t);
          trial.cells[k] = { ...trial.cells[k], tile: axis === 'x' ? 'custom_hazard_bridge' : 'custom_hazard_bridge_y', hazardId: id, hazardAxis: axis,
            floorHeight: Number(top.toFixed(3)), hazardTopHeight: Number(top.toFixed(3)), structureHeight: .4, hazardRiftBridge: true };
        });
        const inBand = new Set(band);
        for (const k of chasm) {
          const [x, y] = k.split(',').map(Number), top = dungeon.cells[k].floorHeight || 0;
          const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => K(x + dx, y + dy)).filter(n => dungeon.cells[n] && (!inBand.has(n) || ledge.includes(n)));
          const nearBridge = Math.abs(B([x, y]) - b) <= 1;
          const rimTop = rim.length ? Math.max(...rim.map(n => dungeon.cells[n].floorHeight || 0)) : top;
          const cliff = rim.length && !nearBridge;
          trial.cells[k] = { ...dungeon.cells[k], tile: cliff ? 'custom_hazard_cliff' : 'custom_hazard_abyss', floorHeight: Number(bottom.toFixed(3)),
            hazardTopHeight: top, structureHeight: cliff ? Math.max(1, rimTop - bottom - .35) : 1.6, feature: 'hazard', hazardGap: true, hazardRift: true, hazardId: id };
        }
        const after = bfs(trial, origin, base.size * 3 + 5000);
        if ([...base].some(k => !inBand.has(k) && !after.has(k)) || !ends.every(k => after.has(k))) continue;
        Object.assign(dungeon.cells, trial.cells);
        const decor = ctx.outdoor ? plantRims(dungeon, { band: inBand, ends, span, mats, reach, origin, base, hard, reserved, rnd: o.rnd }) : [];
        return { keys: span, gap: chasm, zone: span, axis, ends, ledge,
          rift: { width, depth: mats.depth, bottom: Number(bottom.toFixed(3)), climate: mats.climate, floor: mats.floor, fog: mats.fog,
            bridgeStyle: mats.bridgeStyle, outdoor: ctx.outdoor, profile: ctx.profile, rimPlants: decor.length, decor, detour: ledge.length > 0 } };
      }
    }
  }
  return null;
}
// Biome plants or rocks on the rims, from the same prop catalog the biome system uses, never on the path.
function plantRims(dungeon, { band, ends, span, mats, reach, origin, base, hard, reserved, rnd = Math.random }) {
  if (!mats.rimProps.length) return [];
  const near = new Set(); for (const k of [...ends, ...span]) { const [x, y] = k.split(',').map(Number); for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) near.add(K(x + dx, y + dy)); }
  const rim = [...base].filter(k => !band.has(k) && !near.has(k) && !hard(k) && !reserved.has(k) && dungeon.cells[k]?.tile === 'floor' && !dungeon.cells[k].feature &&
    (() => { const [x, y] = k.split(',').map(Number); return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => band.has(K(x + dx, y + dy))); })());
  const placed = [];
  for (const k of rim.sort(() => rnd() - .5)) {
    if (placed.length >= 8) break;
    const shape = mats.rimProps[Math.floor(rnd() * mats.rimProps.length)], meta = V.biomeProps[shape], tile = `custom_hazard_rim_${shape}`;
    dungeon.tiles[tile] ||= { hazardTile: true, url: '', spriteSpec: { voxelShape: shape, material: meta.material, gridWidth: 1, baseWidth: meta.baseWidth,
      heightRatio: meta.heightRatio, palette: { primary: meta.palette[0], secondary: meta.palette[1] || meta.palette[0] } } };
    // A single prop with an open ring of walkable non-chasm cells around it cannot cut any route.
    const [px, py] = k.split(',').map(Number); let ring = 0, open = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const n = K(px + dx, py + dy); if (band.has(n)) continue; ring++;
      if (base.has(n) && dungeon.cells[n]?.tile === 'floor' && !dungeon.cells[n].feature && !dungeon.cells[n].vegetationRole) open++; }
    if (open !== ring || ring < 5) continue;
    dungeon.cells[k] = { ...dungeon.cells[k], tile, feature: tile, structureHeight: meta.heightRange?.[0] || 1.2, vegetationRole: 'canyon-rim' };
    placed.push(k);
  }
  return placed;
}
module.exports = { context, canyonAllowed, materials, carve, CLIMATES, BRIDGES, INDOOR_DEPTH, OUTDOOR_DEPTH, NO_CANYON };
