// retort/sceneRoomBuilder.js
// Step 2 of the scene pipeline: turn a room's scene spec into room graphics.
//  - material-aware floor / wall textures with ground-cover overlays
//  - pixel-art custom_ landmark sprites (condition- and material-aware), reused through a
//    small sprite library so identical props share one PNG
//  - landmark placement on walkable cells, away from the start and doors, never cutting
//    the room's connectivity
//  - per-coordinate persistence so re-entering a room reuses the same dungeon and props
'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const { drawLandmarkSprite, resolveLandmarkDrawer, landmarkSpriteSpec } = require('../assets/renderSceneProps.js');
const { drawSceneSurface, hasMaterial } = require('../assets/renderSceneTextures.js');
const { select: selectVoxelShape } = require('../assets/scenePropVoxels.js');

const SPRITE_DIR = process.env.HOLODEK_SPRITE_DIR || path.join(__dirname, '../sid/sprites');
const LIBRARY_FILE = path.join(SPRITE_DIR, '_library.json');
const SCENE_GFX_VERSION = 3; // v3: invalidate persisted scene rooms after WebGL/scene sync fixes
const OUT_SIZE = 320;

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function hash(s) {
  let h = 2166136261;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function safeKey(k) { return String(k).replace(/[^0-9a-z,_-]/gi, '_'); }

// ---------------- sprite library ----------------
let libraryCache = null;
function loadLibrary() {
  if (libraryCache) return libraryCache;
  try { libraryCache = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8')); } catch (_) { libraryCache = {}; }
  return libraryCache;
}
function saveLibrary() {
  try { ensureDir(SPRITE_DIR); fs.writeFileSync(LIBRARY_FILE, JSON.stringify(libraryCache || {}, null, 2)); } catch (e) { console.warn('[SceneGfx] library save failed', e.message); }
}

/**
 * Return a URL for a sprite described by `descriptor`; draws it only if no identical sprite
 * exists yet. `filePrefix` keeps the catalog naming (custom_<type>_..., scene_floor_...).
 */
function librarySprite(descriptor, filePrefix, paint) {
  const lib = loadLibrary();
  const key = hash(JSON.stringify({ v: SCENE_GFX_VERSION, ...descriptor }));
  const existing = lib[key];
  if (existing && fs.existsSync(path.join(SPRITE_DIR, existing))) {
    return { url: `/sid/sprites/${existing}`, file: existing, reused: true };
  }
  const file = `${filePrefix}_${key}.png`;
  const canvas = createCanvas(OUT_SIZE, OUT_SIZE);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  paint(ctx);
  ensureDir(SPRITE_DIR);
  fs.writeFileSync(path.join(SPRITE_DIR, file), canvas.toBuffer());
  lib[key] = file;
  saveLibrary();
  return { url: `/sid/sprites/${file}`, file, reused: false };
}

// ---------------- materials for props ----------------
const PROP_MATERIAL_WORDS = {
  marble: /marble|alabaster/, obsidian: /obsidian|black glass|basalt/, bone: /\bbone|skull|ivory/,
  gold: /gold|gilded|golden/, metal: /iron|steel|bronze|brass|metal/, wood: /wood|oak|timber/,
  crystal: /crystal|quartz|amethyst/, ice: /\bice\b|frozen|icy/, ash: /\bash|charred|soot|burnt|scorched/,
  rust: /rust/, stone: /stone|granite/
};
const PROP_MATERIAL_FROM_ROOM = { stone: 'stone', marble: 'marble', bone: 'bone', obsidian: 'obsidian', ash: 'ash', ice: 'ice', crystal: 'crystal', metal: 'metal', brick: 'stone', sand: 'stone', sandstone: 'stone', earth: 'stone', roots: 'stone', wood: 'stone', flesh: 'bone', lava: 'obsidian' };
// Landmark types whose material is intrinsic (a bookshelf is wood whatever the walls are).
const INTRINSIC = new Set(['bookshelf', 'table', 'chest', 'barrel', 'crate', 'bed', 'pew', 'cage', 'chains', 'gate', 'brazier', 'tree', 'dead_tree', 'bone_pile', 'crystal_cluster', 'banner', 'tent', 'mushroom', 'ash_flora', 'campfire', 'torch_stand', 'candelabra', 'bridge']);

function landmarkMaterial(spec, landmark) {
  const key = resolveLandmarkDrawer(landmark.type);
  if (INTRINSIC.has(key)) return null; // renderSceneProps default
  const text = String(spec?.source?.description || '').toLowerCase();
  const label = String(landmark.label || landmark.type).toLowerCase();
  // material word in the same clause as the landmark ("a marble altar", "statues of black obsidian")
  const idx = text.indexOf(label);
  if (idx >= 0) {
    const clause = text.slice(Math.max(0, idx - 30), idx + label.length + 30).split(/[.;]/).find(c => c.includes(label)) || '';
    for (const [mat, re] of Object.entries(PROP_MATERIAL_WORDS)) if (re.test(clause)) return mat;
  }
  if (landmark.condition && landmark.condition.includes('burnt')) return 'ash';
  return PROP_MATERIAL_FROM_ROOM[spec.wallMaterial] || 'stone';
}

// ---------------- textures ----------------
function coverList(spec) {
  return (spec.groundCover || []).filter(g => (g.strength || 1) >= 0.3).map(g => g.type).slice(0, 3);
}

/**
 * Replace the room's floor/wall textures with material-aware ones and redraw every custom
 * landmark with a dedicated pixel-art drawer. Adds custom tiles for landmarks the LLM missed.
 */
function applySceneGraphics(dungeon, spec, { geoKey, customTiles }) {
  if (!dungeon || !spec) return { textures: [], landmarks: [] };
  const report = { textures: [], landmarks: [] };
  const cover = coverList(spec);
  const pal = spec.palette || {};
  const floorMat = spec.floorStyleMaterial || spec.floorMaterial || (spec.biome === 'cave' ? 'earth' : null);
  const wallMat = spec.wallStyleMaterial || spec.wallMaterial || (spec.biome === 'cave' ? 'earth' : null);

  if (floorMat && hasMaterial('floor', floorMat) || cover.length || (spec.scatter || []).length) {
    const material = floorMat && hasMaterial('floor', floorMat) ? floorMat : 'stone';
    const floorPalette = { primary: pal.floorPrimary || pal.primary, secondary: pal.floorSecondary || pal.secondary, highlight: pal.highlight, shadow: pal.shadow };
    const scatter = spec.scatter || [];
    const r = librarySprite({ kind: 'floor', material, cover, palette: floorPalette, scatter, ps: spec.paletteStrength || 0 }, `scene_floor_${material}`,
      ctx => drawSceneSurface(ctx, createCanvas, 'floor', { material, palette: floorPalette, groundCover: cover, scatter, seed: material, paletteStrength: spec.paletteStrength }));
    dungeon.tiles.floor = { ...(dungeon.tiles.floor || {}), url: r.url };
    report.textures.push({ tile: 'floor', material, cover, reused: r.reused });
  }
  if (wallMat && hasMaterial('wall', wallMat)) {
    const wallCover = cover.filter(c => ['water', 'moss', 'ash', 'blood', 'cobweb', 'snow', 'ice'].includes(c));
    const decals = spec.decals || [];
    const r = librarySprite({ kind: 'wall', material: wallMat, cover: wallCover, palette: pal, decals, ps: spec.paletteStrength || 0 }, `scene_wall_${wallMat}`,
      ctx => drawSceneSurface(ctx, createCanvas, 'wall', { material: wallMat, palette: pal, groundCover: wallCover, decals, seed: wallMat, paletteStrength: spec.paletteStrength }));
    dungeon.tiles.wall = { ...(dungeon.tiles.wall || {}), url: r.url };
    report.textures.push({ tile: 'wall', material: wallMat, cover: wallCover, reused: r.reused });
  }

  // Landmarks: make sure each spec landmark has a custom tile, then draw it.
  const tiles = Array.isArray(customTiles) ? customTiles : (dungeon.customTiles = []);
  const lightColor = spec.lighting && spec.lighting.color;
  const glowFromLight = spec.lighting && ['magic', 'crystal', 'fungus', 'sickly'].includes(spec.lighting.primary);
  for (const lm of spec.landmarks || []) {
    if (lm.type === 'pillar') continue; // uses the built-in cylinder pillar tile
    const drawer = resolveLandmarkDrawer(lm.type);
    let idx = tiles.findIndex(t => t && t.type && (t.type === lm.type || (!lm.prim && drawer && resolveLandmarkDrawer(t.type) === drawer)));
    if (idx < 0) {
      tiles.push({ type: lm.type, procedure: {}, spriteSpec: null, fromSceneSpec: true });
      idx = tiles.length - 1;
    }
    const tile = tiles[idx];
    tile.name = `custom_${tile.type}_${idx}`;
    tile.sceneLandmark = { type: lm.type, count: lm.count, condition: lm.condition || [], label: lm.label, prim: lm.prim || null, assembly: lm.assembly || (lm.prim && lm.prim.assembly) || null };
  }
  tiles.forEach((tile, idx) => {
    if (!tile || !tile.type) return;
    const prim = tile.sceneLandmark && tile.sceneLandmark.prim;
    const drawer = resolveLandmarkDrawer(tile.type) || (prim ? '_primitive' : null);
    if (!drawer) return; // keep the LLM-procedure sprite for unknown types
    const lm = tile.sceneLandmark || (spec.landmarks || []).find(l => resolveLandmarkDrawer(l.type) === drawer) || { type: tile.type, condition: [] };
    const condition = Array.from(new Set([...(lm.condition || []), ...(glowFromLight && ['obelisk', 'crystal_cluster', 'portal', 'statue'].includes(drawer) ? ['glowing'] : [])]));
    const material = landmarkMaterial(spec, lm);
    const name = `custom_${tile.type}_${idx}`;
    tile.name = name;
    const assembly = (tile.sceneLandmark && tile.sceneLandmark.assembly) || (prim && prim.assembly) || null;
    const descriptor = { kind: 'landmark', drawer, material, condition: condition.slice().sort(), light: lightColor || null, accent: pal.highlight || null, prim: prim || null, assembly };
    const r = librarySprite(descriptor, `custom_${assembly ? 'asm_' + assembly.kit + '_' + assembly.state : (prim ? 'prim_' + prim.shape : drawer)}`, ctx => drawLandmarkSprite(ctx, createCanvas, prim ? tile.type : drawer, {
      material: material || undefined, condition, light: lightColor, accent: drawer === 'portal' || drawer === 'obelisk' ? lightColor : undefined, seed: drawer, prim: prim || undefined, assembly: assembly || undefined
    }));
    const prevSpec = dungeon.tiles[name] && dungeon.tiles[name].spriteSpec;
    dungeon.tiles[name] = {
      url: r.url,
      // Retain sprites for the map/Canvas fallback; solid props use the GPU voxel pass.
      spriteSpec: { ...landmarkSpriteSpec(drawer, prim),
        ...(selectVoxelShape(tile.type, assembly, prim) ? {
          voxelShape: selectVoxelShape(tile.type, assembly, prim), material: material || (['dead_tree', 'roots'].includes(selectVoxelShape(tile.type, assembly, prim)) ? 'wood' : 'stone')
        } : {}),
        ...(prevSpec && prevSpec.collisionRadius ? { collisionRadius: prevSpec.collisionRadius } : {}) },
      landmark: { type: lm.type, drawer, material, condition, shape: prim ? prim.shape : null, label: lm.label || null }
    };
    report.landmarks.push({ tile: name, drawer, material, condition, voxelShape: dungeon.tiles[name].spriteSpec.voxelShape || null, reused: r.reused });
  });
  dungeon.customTiles = tiles;
  return report;
}

// ---------------- landmark placement ----------------
const WALKABLE = new Set(['floor', 'door']);
function isWalkable(cell) { return !!cell && WALKABLE.has(cell.tile); }

function bfsCount(cells, w, h, sx, sy) {
  const seen = new Uint8Array(w * h);
  const q = [sx + sy * w];
  if (!isWalkable(cells[`${sx},${sy}`])) return { count: 0, seen };
  seen[q[0]] = 1;
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = nx + ny * w;
      if (seen[j]) continue;
      if (!isWalkable(cells[`${nx},${ny}`])) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return { count: q.length, seen };
}

function nearDoor(cells, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = cells[`${x + dx},${y + dy}`];
    if (c && (c.tile === 'door' || c.door)) return true;
  }
  return false;
}
function openNeighbours(cells, x, y) {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    if (isWalkable(cells[`${x + dx},${y + dy}`])) n++;
  }
  return n;
}

/**
 * Place every spec landmark `count` times (minus ones the blueprint already placed).
 * Rules: walkable floor cell reachable from the start, >= 2 cells from the start, not next
 * to a door, in open space (>= 6 open neighbours, so corridors stay clear), and placing it
 * must not disconnect any walkable cell. Altars / thrones / sarcophagi go to the far end of
 * the room; statues flank the altar; everything else is spread out.
 */
function placeSceneLandmarks(dungeon, spec) {
  const placed = [];
  if (!dungeon || !spec || !dungeon.cells || !dungeon.layout) return { placed, missing: [] };
  const { width: w, height: h } = dungeon.layout;
  const cells = dungeon.cells;
  const sx = dungeon.start.x, sy = dungeon.start.y;
  const tiles = dungeon.customTiles || [];
  const missing = [];
  // stable pseudo-random from the room text so placement is reproducible
  let seed = parseInt(hash(`${spec.textHash}|place`), 16) >>> 0;
  const rnd = () => { seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9E3779B9) >>> 0; return seed / 4294967296; };

  const base = bfsCount(cells, w, h, sx, sy);
  if (!base.count) return { placed, missing: (spec.landmarks || []).map(l => l.type) };
  let reachable = base.count;

  const anchors = {}; // drawer -> [{x,y}]
  const all = [];
  const tileFor = (lm) => {
    if (lm.type === 'pillar') return 'pillar';
    const drawer = resolveLandmarkDrawer(lm.type);
    const idx = tiles.findIndex(t => t && t.type && (t.type === lm.type || (!lm.prim && drawer && resolveLandmarkDrawer(t.type) === drawer)));
    return idx >= 0 ? `custom_${tiles[idx].type}_${idx}` : null;
  };
  // count what the blueprint already put down
  const existing = {};
  for (const [k, c] of Object.entries(cells)) {
    if (!c || !c.tile) continue;
    existing[c.tile] = (existing[c.tile] || 0) + 1;
    if (String(c.tile).startsWith('custom_') || c.tile === 'pillar') {
      const [x, y] = k.split(',').map(Number);
      all.push({ x, y });
    }
  }

  // candidate pool
  let pool = [];
  const maxD = Math.max(w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const c = cells[`${x},${y}`];
    if (!c || c.tile !== 'floor' || c.navigationReserved) continue;
    if (!base.seen[x + y * w]) continue;
    if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) < 2) continue;
    if (nearDoor(cells, x, y)) continue;
    if (openNeighbours(cells, x, y) < 6) continue;
    pool.push({ x, y, d: Math.hypot(x - sx, y - sy) });
  }
  // outdoor maps are huge; keep placement inside the area the player actually sees first
  const viewR = spec.indoor === false ? 18 : maxD;
  const near = pool.filter(p => p.d <= viewR);
  if (near.length > 20) pool = near;

  // wall-hugging candidates (statues, vines, fungi, sand drifts, braziers): floor cells with a wall neighbour
  const isWallCell = (x, y) => { const c = cells[`${x},${y}`]; return !c || c.tile === 'wall' || c.tile === 'torch'; };
  const wallScore = (p) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => isWallCell(p.x + dx, p.y + dy)).length;
  let wallPool = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const c = cells[`${x},${y}`];
    if (!c || c.tile !== 'floor' || c.navigationReserved || !base.seen[x + y * w]) continue;
    if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) < 2 || nearDoor(cells, x, y)) continue;
    const p = { x, y, d: Math.hypot(x - sx, y - sy) };
    if (p.d > viewR) continue;
    if (wallScore(p) >= 1) wallPool.push(p);
  }
  const rubbleIdx = tiles.findIndex(t => t && t.sceneLandmark && t.sceneLandmark.prim && ['pile', 'mound'].includes(t.sceneLandmark.prim.shape));
  const rubbleTile = rubbleIdx >= 0 ? `custom_${tiles[rubbleIdx].type}_${rubbleIdx}` : null;
  const tryPlace = (p, tileName) => {
    const c = cells[`${p.x},${p.y}`];
    if (!c || c.tile !== 'floor' || c.navigationReserved) return false;
    const prev = { tile: c.tile, feature: c.feature };
    c.tile = tileName; c.feature = tileName;
    const after = bfsCount(cells, w, h, sx, sy);
    if (after.count !== reachable - 1) { c.tile = prev.tile; c.feature = prev.feature; return false; }
    reachable = after.count;
    return true;
  };
  const minDistTo = (p, list) => list.reduce((m, q) => Math.min(m, Math.hypot(p.x - q.x, p.y - q.y)), Infinity);

  // order: far-end anchors first, then flanking statues, then the rest
  const order = (spec.landmarks || []).slice().sort((a, b) => rank(a) - rank(b));
  function rank(lm) {
    if (lm.placement === 'far_end') return 0;
    if (lm.placement === 'rows') return 0.5;
    const d = resolveLandmarkDrawer(lm.type) || lm.type;
    if (['altar', 'throne', 'sarcophagus', 'portal', 'fountain'].includes(d)) return 0;
    if (d === 'statue') return 1;
    return 2;
  }

  for (const lm of order) {
    const tileName = tileFor(lm);
    if (!tileName) { missing.push(lm.type); continue; }
    const want = Math.max(1, lm.count || 1);
    let have = lm.type === 'pillar' ? Math.min(existing.pillar || 0, want) : (existing[tileName] || 0);
    const drawer = resolveLandmarkDrawer(lm.type) || lm.type;
    let guard = 0;
    while (have < want && guard++ < 40 && (pool.length || wallPool.length)) {
      let choice = null;
      const role = /sarcophag|coffin|tomb/.test(lm.type) ? 'tomb' : drawer;
      const structureAnchors = (dungeon.sceneArchitecture?.anchors || []).filter(a => a.role === role);
      if (structureAnchors.length) {
        const anchor = structureAnchors[have % structureAnchors.length];
        choice = pool.slice().sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y))[0] || null;
      }
      if (choice) { /* The room plan provides a physical destination for this landmark. */ }
      else if (lm.placement === 'rows') {
        // colonnade / arcade: two parallel rows along the room's long axis, evenly spaced (multi-cell structure)
        const horiz = w >= h;
        const lineA = Math.round((horiz ? h : w) / 3), lineB = Math.round((horiz ? h : w) * 2 / 3);
        const along = (p) => (horiz ? p.x : p.y), across = (p) => (horiz ? p.y : p.x);
        const step = Math.max(2, Math.floor((horiz ? w : h) / (Math.ceil(want / 2) + 1)));
        const slot = Math.floor(have / 2) + 1, line = have % 2 ? lineB : lineA;
        const target = slot * step;
        choice = (wallPool.concat(pool)).filter(p => Math.abs(across(p) - line) <= 1 && pool.concat(wallPool).includes(p))
          .sort((a, b) => Math.abs(along(a) - target) + Math.abs(across(a) - line) * 0.5 - Math.abs(along(b) - target) - Math.abs(across(b) - line) * 0.5)[0] || null;
      } else if (lm.placement === 'walls' || lm.placement === 'corners') {
        const src = wallPool.filter(p => minDistTo(p, all) >= 2);
        if (src.length) choice = lm.placement === 'corners' ? src.sort((a, b) => wallScore(b) - wallScore(a))[0] : src[Math.floor(rnd() * src.length)];
      } else if (lm.placement === 'center' && !anchors[lm.type]) {
        const cx0 = w / 2, cy0 = h / 2;
        choice = pool.slice().sort((a, b) => Math.hypot(a.x - cx0, a.y - cy0) - Math.hypot(b.x - cx0, b.y - cy0))[0] || null;
      }
      if (choice) { /* placement hint chose */ } else if (rank(lm) === 0) {
        // far end: the farthest candidate in the start's column band, else farthest overall
        const band = pool.filter(p => Math.abs(p.x - sx) <= Math.max(2, w * 0.15));
        const src = band.length ? band : pool;
        choice = src.reduce((a, b) => (b.d > a.d ? b : a));
        if (have > 0) choice = src.filter(p => minDistTo(p, anchors[drawer] || []) >= 3).sort((a, b) => b.d - a.d)[0] || choice;
      } else if (drawer === 'statue' && (anchors.altar || anchors.throne || anchors.sarcophagus)) {
        const a = (anchors.altar || anchors.throne || anchors.sarcophagus)[0];
        const side = have % 2 === 0 ? -1 : 1;
        const ring = 2 + Math.floor(have / 2);
        choice = pool.filter(p => Math.abs(p.y - a.y) <= 1 && Math.sign(p.x - a.x) === side && Math.abs(p.x - a.x) >= ring)
          .sort((p, q) => Math.abs(p.x - a.x) - Math.abs(q.x - a.x))[0] || null;
      }
      if (!choice) {
        // spread: best of a random sample by distance to other landmarks, mid-range from start
        let best = null, bestScore = -Infinity;
        for (let i = 0; i < 160 && pool.length; i++) {
          const p = pool[Math.floor(rnd() * pool.length)];
          const sep = Math.min(6, minDistTo(p, all));
          const mid = -Math.abs(p.d - Math.min(viewR, maxD) * 0.45) * 0.15;
          const score = sep + mid + rnd() * 0.5;
          if (score > bestScore) { bestScore = score; best = p; }
        }
        choice = best;
      }
      pool = pool.filter(p => p !== choice);
      wallPool = wallPool.filter(p => p !== choice);
      if (!choice) break;
      if (!tryPlace(choice, tileName)) continue;
      // collapsed pillars spill a fallen drum into a neighbouring cell (multi-cell structure)
      if (lm.prim && lm.prim.shape === 'broken_column' && rubbleTile) {
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: choice.x + dx, y: choice.y + dy }))
          .find(q => pool.some(p => p.x === q.x && p.y === q.y) || wallPool.some(p => p.x === q.x && p.y === q.y));
        if (nb && tryPlace(nb, rubbleTile)) { placed.push({ type: 'fallen_drum', tile: rubbleTile, x: nb.x, y: nb.y }); all.push(nb); }
      }
      have++;
      (anchors[drawer] = anchors[drawer] || []).push(choice);
      all.push(choice);
      // keep a one-cell walkway around each landmark
      pool = pool.filter(p => Math.max(Math.abs(p.x - choice.x), Math.abs(p.y - choice.y)) > 1);
      wallPool = wallPool.filter(p => Math.max(Math.abs(p.x - choice.x), Math.abs(p.y - choice.y)) > 1);
      placed.push({ type: lm.type, tile: tileName, x: choice.x, y: choice.y });
    }
    if (have < want) missing.push(`${lm.type} (${have}/${want})`);
  }
  dungeon.sceneLandmarks = placed;
  return { placed, missing };
}

// ---------------- Objects in Room: pickable floor items ----------------
/**
 * Put every "Objects in Room" entry on its own reachable floor cell (items do not block movement).
 * dungeon.sceneObjects = [{ id, name, type, magic, x, y }]; the client draws them in the 2D combat map and as
 * billboards in the 3D view, and hides any whose name is no longer in the console's Objects in Room list.
 * Prefers cells next to the room's anchor landmark (altar, throne...) for the first, most magical item, then
 * spreads the rest at mid distance from the start, >= 2 cells apart, never on the start cell or in a doorway.
 */
function placeSceneObjects(dungeon, spec) {
  const out = [];
  if (!dungeon || !dungeon.cells || !dungeon.layout || !spec) return out;
  const items = (spec.props || []).filter(p => p && p.name);
  if (!items.length) { dungeon.sceneObjects = out; return out; }
  const { width: w, height: h } = dungeon.layout;
  const cells = dungeon.cells;
  const sx = dungeon.start ? dungeon.start.x : 1, sy = dungeon.start ? dungeon.start.y : 1;
  const reach = bfsCount(cells, w, h, sx, sy);
  let seed = parseInt(hash(`${spec.textHash}|objects`), 16) >>> 0;
  const rnd = () => { seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9E3779B9) >>> 0; return seed / 4294967296; };
  const viewR = spec.indoor === false ? 12 : Math.max(w, h);
  let pool = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const c = cells[`${x},${y}`];
    if (!c || c.tile !== 'floor' || !reach.seen[x + y * w]) continue;
    const d = Math.hypot(x - sx, y - sy);
    if (d < 2 || d > viewR || nearDoor(cells, x, y)) continue;
    pool.push({ x, y, d });
  }
  if (!pool.length) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (reach.seen[x + y * w] && (x !== sx || y !== sy)) pool.push({ x, y, d: Math.hypot(x - sx, y - sy) });
  }
  const anchor = (dungeon.sceneLandmarks || []).find(p => /altar|throne|sarcophag|pedestal|shrine/.test(String(p.type)));
  const sorted = items.slice().sort((a, b) => (b.magic || 0) - (a.magic || 0));
  const taken = [];
  const farFrom = (p) => taken.reduce((m, q) => Math.min(m, Math.hypot(p.x - q.x, p.y - q.y)), 9);
  sorted.forEach((it, i) => {
    if (!pool.length) return;
    let best = null, bestScore = -Infinity;
    for (const p of pool) {
      let score = Math.min(4, farFrom(p)) * 1.2 - Math.abs(p.d - Math.min(viewR, Math.max(w, h)) * 0.35) * 0.25 + rnd() * 0.8;
      if (anchor && i === 0) score = -Math.hypot(p.x - anchor.x, p.y - anchor.y) * 3 + rnd();
      if (score > bestScore) { bestScore = score; best = p; }
    }
    taken.push(best);
    pool = pool.filter(p => p !== best);
    out.push({ id: it.id, name: it.name, type: it.declaredType || it.category || '', magic: it.magic || 0, assembly: it.assembly || null, x: best.x, y: best.y });
  });
  dungeon.sceneObjects = out;
  return out;
}

// ---------------- per-coordinate reuse ----------------
function layoutKey(spec) {
  // Objects can be taken without the room changing shape, so they don't invalidate the layout.
  const s = spec && spec.source ? spec.source : {};
  return hash(`${SCENE_GFX_VERSION}|${s.roomName || ''}|${s.description || ''}|${(s.exits || []).join(',')}`);
}

function saveStoredRoom(geoKey, dungeon) {
  // Room layouts are authoritative from the active generation turn and cached in browser IndexedDB.
  // Keep this helper inert so scene building can stay without persisting server-side layout JSON.
  return false;
}

function spriteExists(url) {
  if (!url) return false;
  const rel = String(url).split('?')[0].replace(/^\/sid\/sprites\//, '');
  return fs.existsSync(path.join(SPRITE_DIR, rel));
}

/** Server-side room layout reuse is disabled; browser IndexedDB owns room layout caching. */
function loadStoredRoom(geoKey, spec) {
  return null;
}

module.exports = { applySceneGraphics, placeSceneLandmarks, placeSceneObjects, saveStoredRoom, loadStoredRoom, layoutKey, SCENE_GFX_VERSION };
