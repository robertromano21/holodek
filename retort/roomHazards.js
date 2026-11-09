'use strict';
// Environmental hazards and reactive traps. Same contract as the Tartarus encounter catalog:
// literal description evidence -> compiled voxel geometry -> validated choices -> explicit dice checks
// -> persistent cell changes. Legacy evidence and required new-room quotas share the same mechanics.
const { randomInt } = require('node:crypto');
const I = require('../assets/dungeonInhabitants');
const Terrain = require('./hazardTerrain');
const VERSION = 1, MAX_PER_ROOM = 2, PIT_DEPTH = 6, REACH = 2.5, NEAR_MISS = 3, MAX_BRIDGE_DC = 18;
const NIMBLE = /\b(thief|assassin|rogue|scout|acrobat|ranger|monk)\b/i, ARCANE = /\b(wizard|witch|necromancer|warlock|sorcerer|mage|priest|cleric)\b/i;
const TECH = ['sci-fi', 'cyberpunk', 'modern', 'noir', 'dieselpunk', 'steampunk', 'underwater'];
const METAPHOR = /^\s+of\s+(?:despair|sorrow|grief|doubt|silence|time|memory|memories|dreams?|madness|hope|regret|souls?)\b/i;
const CATALOG = {
  collapsing_bridge: {
    evidence: [/\b(?:rope|plank|wooden|rickety|rotten|swaying|hanging|narrow|crumbling|rusted|metal|steel|old)?\s*(?:foot)?(?:bridge|gantry|catwalk|walkway|span)\b/i],
    alsoNeeds: /\b(?:chasm|ravine|gorge|canyon|abyss|crevasse|gap|pit|drop|shaft|fissure|rift|cleft)\b/i,
    flavor: { fantasy: 'rope-and-plank bridge', tech: 'sagging steel gantry' },
    check: { label: 'Keep Balance', dc: 11, carefulDc: 7 }, damage: '2d6', trigger: 'enter',
    choices: ['cross (automatic balance check)', 'cross carefully (lower DC)', 'inspect', 'go around'],
    outcome: { success: 'keeps balance on the swaying planks', failure: 'a plank snaps and drops into the chasm below' } },
  gas_vent: {
    evidence: [/\b(?:gas|steam|plasma|toxic|sulfur(?:ous)?|sulphur(?:ous)?|noxious|poison(?:ous)?|choking|acrid)\s+(?:vents?|fumes|fissures?|jets?|clouds?|vapou?rs?)\b/i,
      /\bvents?\b[^.]{0,40}\b(?:fumes|gas|steam|vapou?r)\b/i, /\bfumaroles?\b/i],
    flavor: { fantasy: 'sulfur gas vent', tech: 'ruptured plasma vent', steampunk: 'ruptured steam vent', western: 'sulfur gas vent' },
    check: { label: 'Seal Vent', dc: 13 }, damage: '1d4', trigger: 'zone',
    choices: ['walk through (automatic damage, no roll)', 'hold breath and cross (no damage next pass)', 'seal the vent (check)', 'inspect', 'go around'],
    outcome: { success: 'chokes the vent shut', failure: 'takes a lungful of searing fumes' } },
  unstable_floor: {
    evidence: [/\b(?:unstable|cracked|crumbling|rotten|rotting|sagging|buckled|weakened|collapsing|fractured|loose|splintered)\s+(?:floor(?:boards?)?|flagstones?|tiles?|stones|planks|deck(?:ing| plating)?|ground|paving)\b/i,
      /\bfloor\b[^.]{0,30}\b(?:cracked|crumbl\w*|sags?|gives? way|unstable)\b/i],
    flavor: { fantasy: 'cracked flagstones', tech: 'buckled deck plating' },
    check: { label: 'Keep Footing', dc: 12, carefulDc: 8 }, damage: '1d6+1', trigger: 'enter',
    choices: ['walk on (automatic footing check)', 'test the floor (lower DC)', 'inspect', 'go around'],
    outcome: { success: 'keeps footing as the floor groans', failure: 'the floor gives way and falls into the void below' } },
  ward_stone: {
    evidence: [/\b(?:ward(?:ing)?[\s-]*stones?|rune[\s-]*stones?|warding\s+(?:runes?|glyphs?|circle|sigils?)|glowing\s+(?:runes?|glyphs?|sigils?))\b/i,
      /\bstanding\s+stones?\b[^.]{0,40}\b(?:glow\w*|runes?|wards?)\b/i, /\b(?:energy|force|security|arc|defen[cs]e)\s+pylons?\b/i],
    flavor: { fantasy: 'ward stone', tech: 'energy pylon', steampunk: 'arc pylon' },
    check: { label: 'Dispel Ward', dc: 14 }, damage: '1d6', trigger: 'zone',
    choices: ['enter its radius (automatic pulse, no roll)', 'dispel the ward (check)', 'inspect', 'go around'],
    outcome: { success: 'unravels the ward; the stone goes dark', failure: 'the ward flares and hurls the intruder back' } }
};
Object.assign(CATALOG, require('./environmentHazardCatalog').CATALOG);
const KINDS = Object.keys(CATALOG);
const genreOf = (dungeon, opts = {}) => {
  let g = opts.genre || dungeon?.genre || dungeon?.sceneSpec?.genre;
  if (!g) try { const s = require('./settingLayer').current?.(); g = s?.genre || s?.genres?.[0]; } catch { /* legacy world */ }
  return String(g || 'fantasy').toLowerCase();
};
const flavorOf = (kind, genre) => { const f = CATALOG[kind].flavor; return f[genre] || (TECH.includes(genre) ? f.tech : f.fantasy); };
const technical = genre => TECH.includes(genre);
function evidence(text) {
  const source = String(text || ''), found = [];
  for (const kind of KINDS) {
    const entry = CATALOG[kind];
    for (const re of entry.evidence) {
      const g = new RegExp(re.source, 'gi'); let m;
      while ((m = g.exec(source))) {
        const before=source.slice(Math.max(0,m.index-70),m.index).split(/[.!?;]/).at(-1);
        if(/\b(?:no|without|never|neither)\b[^,;.!?]{0,35}$|\bno longer\b[^,;.!?]{0,35}$/i.test(before))continue;
        if (METAPHOR.test(source.slice(m.index + m[0].length, m.index + m[0].length + 24))) continue;
        if (entry.alsoNeeds) {
          const gap = new RegExp(entry.alsoNeeds.source, 'gi'); let n, literal = null;
          while ((n = gap.exec(source))) if (!METAPHOR.test(source.slice(n.index + n[0].length, n.index + n[0].length + 24))) { literal = n; break; }
          if (!literal) continue;
        }
        found.push({ kind, phrase: m[0].trim(), index: m.index }); break;
      }
      if (found.some(f => f.kind === kind)) break;
    }
  }
  return found.sort((a, b) => a.index - b.index);
}
function hashSeed(text) { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function rngFrom(seed) { let s = hashSeed(seed) || 1; return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9E3779B9) >>> 0; return s / 4294967296; }; }
const K = (x, y) => `${x},${y}`;
const P = key => { const [x, y] = key.split(',').map(Number); return { x, y }; };
function protectedCell(dungeon, key, c, occupied) {
  return !c || c.tile !== 'floor' || occupied.has(key) || c.feature || c.exit || c.complexExit || c.door || c.navigationReserved ||
    c.puzzleFixture || c.interactable || c.blocked || c.obstacle || c.trail || c.exteriorRole || c.vegetationRole || c.secretChamber ||
    c.secretDoorId || c.hazardId || c.architectureRole || c.roofSupport;
}
// Reachability through the shared traversal rule (2D map, combat paths and NPCs use the same test).
function reach(dungeon, origin, blocked = new Set()) {
  const start = { x: Math.floor(origin.x), y: Math.floor(origin.y) }, seen = new Set([K(start.x, start.y)]), queue = [start];
  for (let i = 0; i < queue.length && i < 20000; i++) {
    const a = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = { x: a.x + dx, y: a.y + dy }, k = K(b.x, b.y);
      if (seen.has(k) || blocked.has(k) || !I.canTraverse(dungeon, a, b)) continue;
      seen.add(k); queue.push(b);
    }
  }
  return seen;
}
function keepsConnected(dungeon, origin, base, blocked) {
  const after = reach(dungeon, origin, blocked);
  for (const k of base) if (!blocked.has(k) && !after.has(k)) return false;
  return true;
}
const palettes = {
  fantasy: { collapsing_bridge: ['#8a6239', '#5c3f24', '#c9a56b', '#2e2014'], gas_vent: ['#5a5650', '#3a3833', '#c8d070', '#1d1c19'],
    unstable_floor: ['#8d8576', '#5e584e', '#b5ad9b', '#2c2925'], ward_stone: ['#7d8088', '#4f525a', '#8fe0ff', '#24262b'] },
  tech: { collapsing_bridge: ['#7b8188', '#4a4f55', '#c3c9cf', '#1d2125'], gas_vent: ['#5b6168', '#33383d', '#ff9a4a', '#16191c'],
    unstable_floor: ['#868c92', '#555b61', '#b8bec4', '#24282c'], ward_stone: ['#5b6470', '#353c45', '#7fd8ff', '#151a20'] }
};
const SHAPES = { collapsing_bridge: 'hazard_bridge', gas_vent: 'hazard_vent', unstable_floor: 'hazard_cracked_floor', ward_stone: 'hazard_ward_stone' };
for(const kind of KINDS)if(CATALOG[kind].shape)SHAPES[kind]=CATALOG[kind].shape;
function svgTile(shape, pal) {
  const [a, b, c, d] = pal, body = {
    hazard_bridge: `<rect x='0' y='10' width='64' height='44' fill='${d}'/>${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect x='${2 + i * 9}' y='12' width='7' height='40' fill='${i % 3 ? a : b}'/>`).join('')}<rect x='0' y='12' width='64' height='3' fill='${c}'/><rect x='0' y='49' width='64' height='3' fill='${c}'/>`,
    hazard_bridge_y: `<rect x='10' y='0' width='44' height='64' fill='${d}'/>${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect x='12' y='${2 + i * 9}' width='40' height='7' fill='${i % 3 ? a : b}'/>`).join('')}<rect x='12' y='0' width='3' height='64' fill='${c}'/><rect x='49' y='0' width='3' height='64' fill='${c}'/>`,
    hazard_bridge_broken: `<rect width='64' height='64' fill='${d}'/><rect x='0' y='30' width='64' height='4' fill='${b}'/><rect x='0' y='12' width='64' height='3' fill='${c}'/><rect x='0' y='49' width='64' height='3' fill='${c}'/>`,
    hazard_bridge_broken_y: `<rect width='64' height='64' fill='${d}'/><rect x='30' y='0' width='4' height='64' fill='${b}'/><rect x='12' y='0' width='3' height='64' fill='${c}'/><rect x='49' y='0' width='3' height='64' fill='${c}'/>`,
    hazard_cliff: `<rect width='64' height='64' fill='${d}'/>${[0, 1, 2, 3].map(i => `<rect x='0' y='${4 + i * 16}' width='64' height='6' fill='${i % 2 ? a : b}'/>`).join('')}`,
    hazard_abyss: `<rect width='64' height='64' fill='${d}'/><circle cx='22' cy='26' r='12' fill='${b}' opacity='.6'/><circle cx='42' cy='40' r='14' fill='${a}' opacity='.45'/>`,
    hazard_vent: `<rect x='8' y='8' width='48' height='48' fill='${b}'/>${[0, 1, 2, 3, 4].map(i => `<rect x='12' y='${13 + i * 8}' width='40' height='4' fill='${d}'/>`).join('')}<circle cx='32' cy='30' r='11' fill='${c}' opacity='.55'/>`,
    hazard_vent_sealed: `<rect x='8' y='8' width='48' height='48' fill='${b}'/><rect x='12' y='12' width='40' height='40' fill='${a}'/>`,
    hazard_cracked_floor: `<rect width='64' height='64' fill='${a}'/><path d='M4 30 L20 26 L28 36 L42 30 L60 38 M28 36 L24 56 M42 30 L48 6 M20 26 L14 8' stroke='${d}' stroke-width='3' fill='none'/>`,
    hazard_ward_stone: `<ellipse cx='32' cy='34' rx='20' ry='24' fill='${a}'/><path d='M32 18 L32 48 M22 28 L42 28 M24 40 L40 40' stroke='${c}' stroke-width='4'/><circle cx='32' cy='34' r='28' fill='none' stroke='${c}' stroke-width='2' opacity='.6'/>`,
    hazard_ward_stone_dormant: `<ellipse cx='32' cy='34' rx='20' ry='24' fill='${b}'/><path d='M32 18 L32 48 M22 28 L42 28' stroke='${d}' stroke-width='3'/>`,
    hazard_debris: `<rect width='64' height='64' fill='${d}'/><rect x='8' y='14' width='18' height='14' fill='${b}'/><rect x='32' y='30' width='22' height='16' fill='${a}'/><rect x='14' y='40' width='12' height='12' fill='${b}'/>`,
    hazard_gas_puff: `<circle cx='32' cy='32' r='22' fill='${c}' opacity='.5'/>`,
    hazard_flames: `<path d='M8 57 L16 27 L25 38 L34 5 L43 36 L51 22 L58 57Z' fill='${a}'/><path d='M22 57 L34 26 L45 57Z' fill='${c}'/>`,
    hazard_pool: `<ellipse cx='32' cy='34' rx='29' ry='23' fill='${a}'/><circle cx='24' cy='25' r='6' fill='${c}'/><circle cx='43' cy='39' r='4' fill='${b}'/>`,
    hazard_sand: `<rect width='64' height='64' fill='${a}'/><ellipse cx='32' cy='32' rx='25' ry='18' stroke='${b}' stroke-width='4' fill='none'/><ellipse cx='32' cy='32' rx='12' ry='8' fill='${d}'/>`,
    hazard_ice: `<rect width='64' height='64' fill='${a}'/><path d='M2 42 L26 16 L48 29 L62 4 M26 16 L38 62' stroke='${c}' stroke-width='4' fill='none'/>`,
    hazard_heat: `<rect width='64' height='64' fill='${b}'/><path d='M10 56 Q30 40 12 28 T20 4 M32 56 Q52 40 34 28 T42 4' stroke='${c}' stroke-width='5' fill='none'/>`,
    hazard_sparks: `<rect width='64' height='64' fill='${b}'/><path d='M38 4 L14 34 L31 34 L23 60 L52 24 L35 24Z' fill='${c}'/>`,
    hazard_geyser: `<ellipse cx='32' cy='50' rx='27' ry='12' fill='${b}'/><path d='M18 48 L26 4 L34 24 L43 9 L47 48Z' fill='${c}'/>`,
    hazard_mist: `<circle cx='22' cy='37' r='18' fill='${a}'/><circle cx='39' cy='26' r='20' fill='${c}' opacity='.7'/>`,
    hazard_machinery: `<rect x='6' y='4' width='52' height='56' fill='${b}'/><path d='M14 12 H50 V24 H36 V52 H26 V24 H14Z' fill='${a}'/><path d='M8 55 H56' stroke='${c}' stroke-width='6'/>`
  }[shape] || `<rect width='64' height='64' fill='${a}'/>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'>${body}</svg>`);
}
function defineTiles(dungeon, genre) {
  const set = technical(genre) ? palettes.tech : palettes.fantasy, material = technical(genre) ? 'metal' : 'stone';
  const t = (shape, kind, extra) => {
    const pal = set[kind];
    dungeon.tiles[`custom_${shape}`] = { url: svgTile(shape, pal), hazardTile: true,
      spriteSpec: { voxelShape: shape, material: kind === 'collapsing_bridge' && !technical(genre) ? 'wood' : material, gridWidth: 1, baseWidth: 1,
        heightRatio: .2, palette: { primary: pal[0], secondary: pal[1], highlight: pal[2], shadow: pal[3] }, ...extra } };
  };
  dungeon.tiles ||= {};
  t('hazard_bridge', 'collapsing_bridge', { collisionBlocking: false });
  t('hazard_bridge_y', 'collapsing_bridge', { collisionBlocking: false });
  t('hazard_bridge_broken', 'collapsing_bridge', { collisionBlocking: false });
  t('hazard_bridge_broken_y', 'collapsing_bridge', { collisionBlocking: false });
  t('hazard_vent', 'gas_vent', { collisionBlocking: false, emissive: true });
  t('hazard_vent_sealed', 'gas_vent', { collisionBlocking: false });
  t('hazard_cracked_floor', 'unstable_floor', { collisionBlocking: false });
  t('hazard_ward_stone', 'ward_stone', { baseWidth: .7, collisionRadius: .32, emissive: true });
  t('hazard_ward_stone_dormant', 'ward_stone', { baseWidth: .7, collisionRadius: .32 });
  t('hazard_debris', 'unstable_floor', { collisionBlocking: false });
  t('hazard_gas_puff', 'gas_vent', { collisionBlocking: false, emissive: true });
  for(const [kind,entry] of Object.entries(CATALOG).filter(([,e])=>e.shape)){
    const pal=entry.palette;
    // Per-kind tile identities retain acid/ice/industrial colours even when shapes are shared.
    dungeon.tiles[`custom_hazard_${kind}`]={url:svgTile(entry.shape,pal),hazardTile:true,
      spriteSpec:{voxelShape:entry.shape,material:entry.damageType==='crushing'?'metal':'stone',gridWidth:1,baseWidth:1,
        heightRatio:entry.height,collisionBlocking:false,palette:{primary:pal[0],secondary:pal[1],highlight:pal[2],shadow:pal[3]}}};
  }
}
const HEIGHT = { hazard_bridge: .4, hazard_bridge_y: .4, hazard_vent: .18, hazard_vent_sealed: .14, hazard_cracked_floor: .1, hazard_ward_stone: 1.7, hazard_ward_stone_dormant: 1.7, hazard_debris: .7 };
function setTile(cell, shape, id) { return { ...cell, tile: `custom_${shape}`, hazardId: id, structureHeight: HEIGHT[shape] }; }
function pitCell(cell, id, debris = true) {
  const top = cell.hazardTopHeight ?? (cell.floorHeight || 0);
  return { ...cell, tile: debris ? 'custom_hazard_debris' : 'floor', floorHeight: top - PIT_DEPTH, hazardTopHeight: top, ...(debris ? { structureHeight: HEIGHT.hazard_debris } : {}),
    feature: 'hazard', hazardGap: true, hazardId: id };
}
function riftTiles(dungeon, mats) {
  const P4 = p => ({ primary: p[0], secondary: p[1], highlight: p[2], shadow: p[3] }), bp = mats.bridge.pal;
  for (const shape of ['hazard_bridge', 'hazard_bridge_y', 'hazard_bridge_broken', 'hazard_bridge_broken_y'])
    dungeon.tiles['custom_' + shape] = { url: svgTile(shape, bp), hazardTile: true, spriteSpec: { voxelShape: shape, material: mats.bridge.material,
      gridWidth: 1, baseWidth: 1, heightRatio: .2, collisionBlocking: false, bridgeStyle: mats.bridgeStyle, palette: P4(bp) } };
  dungeon.tiles.custom_hazard_cliff = { url: svgTile('hazard_cliff', mats.cliff), hazardTile: true, spriteSpec: { voxelShape: 'hazard_cliff', material: 'stone',
    gridWidth: 1, baseWidth: 1, heightRatio: 1, collisionBlocking: false, climate: mats.climate, palette: P4(mats.cliff) } };
  dungeon.tiles.custom_hazard_abyss = { url: svgTile('hazard_abyss', mats.floorPal), hazardTile: true, spriteSpec: { voxelShape: 'hazard_abyss', material: 'stone',
    gridWidth: 1, baseWidth: 1, heightRatio: .3, collisionBlocking: false, chasmFloor: mats.floor, fog: mats.fog, palette: P4(mats.floorPal) } };
  for (const [key, tile] of Object.entries(dungeon.tiles)) if (key.startsWith('custom_hazard_rim_') && !tile.url)
    tile.url = svgTile('hazard_debris', [tile.spriteSpec.palette.primary, tile.spriteSpec.palette.secondary, tile.spriteSpec.palette.primary, '#1d1c19']);
}
const DETOUR = /\b(?:go(?:es|ing)? around|ledges?|detours?|path around|skirts?|skirting)\b/i;
function softRoute(c) { return !!(c && (c.trail || c.vegetationRole || c.routeRole || c.outdoorRoute)); }
// Candidate footprints, tried nearest the middle distance from the entrance so hazards sit on the way, not in corners.
function sites(dungeon, base, origin, rnd, occupied) {
  const list = [];
  for (const k of base) {
    const p = P(k), d = Math.hypot(p.x - origin.x, p.y - origin.y);
    if (d < 4 || protectedCell(dungeon, k, dungeon.cells[k], occupied)) continue;
    list.push({ ...p, d, r: rnd() });
  }
  return list.sort((a, b) => a.r - b.r).slice(0, 400);
}
function uniform(dungeon, keys, occupied) {
  const z = dungeon.cells[keys[0]]?.floorHeight || 0;
  return keys.every(k => !protectedCell(dungeon, k, dungeon.cells[k], occupied) && Math.abs((dungeon.cells[k].floorHeight || 0) - z) < .05);
}
function zoneAround(dungeon, x, y, radius, base) {
  const out = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const k = K(x + dx, y + dy); if (base.has(k)) out.push(k);
  }
  return out;
}
const builders = {
  collapsing_bridge(dungeon, s, ctx, id) {
    // First choice: a rift that splits the room (indoors) or a vast biome canyon (outdoors), crossed by one long bridge.
    if (ctx.rift === undefined) {
      const genre = ctx.genre || genreOf(dungeon), tc = Terrain.context(dungeon, { genre, tech: technical(genre) });
      ctx.rift = null;
      if (!tc.outdoor || Terrain.canyonAllowed(tc)) {
        const hard = k => { const c = dungeon.cells[k];
          return !c || c.exit || c.complexExit || c.door || c.navigationReserved || c.puzzleFixture || c.interactable || c.secretChamber || c.secretDoorId ||
            c.hazardId || c.outdoorFoundation || c.architectureRole || c.roofSupport || c.exteriorRole || ctx.occupied.has(k) ||
            (c.feature && !c.vegetationRole) || (c.tile !== 'floor' && !c.vegetationRole) || (ctx.reserved.has(k) && !softRoute(c)); };
        const text = [dungeon.sceneSpec?.source?.description, ctx.text].filter(Boolean).join(' ');
        const built = Terrain.carve(dungeon, tc, { origin: ctx.origin, base: ctx.base, hard, reserved: ctx.reserved, reach, id, detour: DETOUR.test(text),
          rnd: rngFrom(`${dungeon.generation?.seed || dungeon.geoKey}:rift`) });
        if (built) { riftTiles(dungeon, Terrain.materials(tc)); ctx.rift = { ...built, label: Terrain.materials(tc).bridge.label }; return ctx.rift; }
      }
      if (tc.outdoor) { ctx.noSmall = true; return null; } // outdoors the bridge only exists across a real canyon
    }
    if (ctx.rift || ctx.noSmall) return null;
    for (const axis of ['x', 'y']) {
      const along = i => axis === 'x' ? [s.x + i, s.y] : [s.x, s.y + i], across = (i, j) => axis === 'x' ? [s.x + i, s.y + j] : [s.x + j, s.y + i];
      const bridge = [0, 1, 2].map(i => K(...along(i))), chasm = [];
      for (let i = 0; i < 3; i++) for (const j of [-2, -1, 1, 2]) chasm.push(K(...across(i, j)));
      const ends = [K(...along(-1)), K(...along(3))];
      if (!uniform(dungeon, [...bridge, ...chasm], ctx.occupied) || !ends.every(k => ctx.base.has(k) && !ctx.reserved.has(k))) continue;
      const blocked = new Set([...bridge, ...chasm]);
      if ([...blocked].some(k => ctx.reserved.has(k)) || !keepsConnected(dungeon, ctx.origin, ctx.base, blocked)) continue;
      for (const k of chasm) dungeon.cells[k] = pitCell(dungeon.cells[k], id, false);
      for (const k of bridge) dungeon.cells[k] = { ...setTile(dungeon.cells[k], axis === 'x' ? 'hazard_bridge' : 'hazard_bridge_y', id), hazardAxis: axis };
      return { keys: bridge, gap: chasm, zone: bridge, axis, ends };
    }
    return null;
  },
  unstable_floor(dungeon, s, ctx, id) {
    const keys = [K(s.x, s.y), K(s.x + 1, s.y), K(s.x, s.y + 1), K(s.x + 1, s.y + 1)];
    if (!uniform(dungeon, keys, ctx.occupied) || keys.some(k => ctx.reserved.has(k)) || !keepsConnected(dungeon, ctx.origin, ctx.base, new Set(keys))) return null;
    for (const k of keys) dungeon.cells[k] = setTile(dungeon.cells[k], 'hazard_cracked_floor', id);
    return { keys, gap: [], zone: keys };
  },
  gas_vent(dungeon, s, ctx, id) {
    const k = K(s.x, s.y), zone = zoneAround(dungeon, s.x, s.y, 1, ctx.base);
    if (!uniform(dungeon, [k], ctx.occupied) || zone.length < 6 || zone.some(z => ctx.reserved.has(z))) return null;
    dungeon.cells[k] = setTile(dungeon.cells[k], 'hazard_vent', id);
    return { keys: [k], gap: [], zone };
  },
  ward_stone(dungeon, s, ctx, id) {
    const k = K(s.x, s.y), zone = zoneAround(dungeon, s.x, s.y, 2, ctx.base).filter(z => z !== k);
    if (!uniform(dungeon, [k], ctx.occupied) || zone.length < 12 || zone.some(z => ctx.reserved.has(z)) ||
        !keepsConnected(dungeon, ctx.origin, ctx.base, new Set([k]))) return null;
    dungeon.cells[k] = { ...setTile(dungeon.cells[k], 'hazard_ward_stone', id), navigationReserved: true };
    return { keys: [k], gap: [], zone };
  }
};
for(const kind of KINDS.filter(k=>CATALOG[k].shape))builders[kind]=(dungeon,s,ctx,id)=>{
  const keys=[K(s.x,s.y),K(s.x+1,s.y),K(s.x,s.y+1),K(s.x+1,s.y+1)];
  if(!uniform(dungeon,keys,ctx.occupied)||keys.some(k=>ctx.reserved.has(k))||!keepsConnected(dungeon,ctx.origin,ctx.base,new Set(keys)))return null;
  for(const k of keys)dungeon.cells[k]={...dungeon.cells[k],tile:`custom_hazard_${kind}`,hazardId:id,structureHeight:CATALOG[kind].height};
  return{keys,gap:[],zone:[...keys]};
};
function install(dungeon, opts = {}) {
  if (!dungeon?.cells || !dungeon.layout || !dungeon.start) return null;
  // Saved decisions and collapsed/sealed hazards are authoritative across catalog expansions.
  if (dungeon.roomHazards) return dungeon.roomHazards;
  const text = opts.text ?? [dungeon.sceneSpec?.source?.roomName, dungeon.sceneSpec?.source?.description].filter(Boolean).join('. ');
  const found = evidence(text), genre = genreOf(dungeon, opts);
  const report = { version: VERSION, revision: 0, genre, hazards: [], rejected: [], alarm: false, receipts: [] };
  if (!found.length) { dungeon.roomHazards = report; return report; }
  const origin = { x: Math.floor(dungeon.start.x), y: Math.floor(dungeon.start.y) };
  const occupied = new Set((dungeon.sceneObjects || []).map(o => K(Math.floor(o.x), Math.floor(o.y))));
  occupied.add(K(origin.x, origin.y));
  const rnd = rngFrom(`${dungeon.generation?.seed || dungeon.geoKey || 'room'}:hazards-v${VERSION}`);
  defineTiles(dungeon, genre);
  const reserved = new Set();
  for (const ev of found.filter(ev=>!CATALOG[ev.kind].genres||CATALOG[ev.kind].genres.includes(genre))) {
    if(report.hazards.length>=MAX_PER_ROOM)break;
    const base = reach(dungeon, origin), id = `hazard:${ev.kind}:${report.hazards.length}`;
    const ctx = { base, origin, occupied, reserved, genre, text };
    let built = null;
    for (const s of sites(dungeon, base, origin, rnd, occupied)) { built = builders[ev.kind](dungeon, s, ctx, id); if (built) break; }
    if (!built) { report.rejected.push({ kind: ev.kind, phrase: ev.phrase, reason: 'no connected site keeps every route open' }); continue; }
    for (const k of [...built.keys, ...built.gap, ...built.zone, ...(built.ends || [])]) {
      const p = P(k); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) reserved.add(K(p.x + dx, p.y + dy));
    }
    const entry = CATALOG[ev.kind];
    report.hazards.push({ id, kind: ev.kind, label: built.label || flavorOf(ev.kind, genre), evidence: ev.phrase, state: 'armed',
      keys: built.keys, gap: built.gap, zone: built.zone, ...(built.axis ? { axis: built.axis } : {}), ...(built.rift ? { rift: built.rift, ends: built.ends } : {}),
      check: { ...entry.check }, damage: entry.damage, trigger: entry.trigger, choices: entry.choices, careful: {}, tested: false });
    report.hazards.at(-1).commands=commands(report.hazards.at(-1));
  }
  dungeon.roomHazards = report;
  return report;
}
function requiredQuota(dungeon) {
  const indoor = dungeon.classification?.indoor !== false && dungeon.sceneSpec?.indoor !== false;
  if (dungeon.geoKey === '0,0,0' && !dungeon.cityFloorContext) return { version:1, indoor, count:0, starter:true };
  const described = evidence(dungeon.sceneSpec?.source?.description).length;
  const count = indoor ? Math.max(1,Math.min(2,described)) : Math.max(Math.min(5,described),2 + hashSeed(`${dungeon.generation?.seed || dungeon.geoKey}:hazard-quota-v1`) % 4);
  return { version: 1, indoor, count };
}
function eligibleKinds(dungeon, genre) {
  const text = JSON.stringify([dungeon.classification?.biome, dungeon.sceneSpec?.source?.description]);
  const described = new Set(evidence(dungeon.sceneSpec?.source?.description).map(e => e.kind));
  const tc = Terrain.context(dungeon, { genre, tech: technical(genre) });
  const plausible = kind => described.has(kind) || !tc.outdoor ||
    (kind === 'collapsing_bridge' ? Terrain.canyonAllowed(tc) :
     kind === 'gas_vent' ? ['wetland', 'volcanic', 'geothermal'].includes(tc.climate) || /swamp|marsh|bog|mire|volcan|sulph?ur|fumarole|vent/i.test(text) :
     kind === 'unstable_floor' ? tc.urban || /\b(?:ruin\w*|temples?|abandoned|collapsed|crumbl\w*|tombs?|old (?:city|town|fort))\b/i.test(text) : true);
  const cold = /\b(?:ice|icy|snow\w*|frost\w*|frozen|freez\w*|glaci\w*|tundra|winter\w*)\b/i.test(text);
  return KINDS.filter(kind => plausible(kind) && (!CATALOG[kind].genres || CATALOG[kind].genres.includes(genre)) &&
    (!['moving_machinery','volatile_leak'].includes(kind) || technical(genre) || genre==='post-apocalyptic' || /machin|clockwork|foundry|factory|fuel/i.test(text)) &&
    (!['freezing_cold','slick_ice'].includes(kind) || cold) && (kind !== 'extreme_heat' || !cold));
}
// Mechanics are selected only after a safe site exists. Names/descriptions are authored
// separately, before this draft is committed or sent to the browser.
function requiredDraft(dungeon, opts = {}) {
  const quota = requiredQuota(dungeon), genre = genreOf(dungeon, opts);
  if (!dungeon?.cells || !dungeon.start) throw Error('Hazard quotas need constructed room geometry.');
  const draft = { ...dungeon, cells: { ...dungeon.cells }, tiles: { ...dungeon.tiles } };
  const report = { version: VERSION, source: 'required-room-hazards-v1', quota, revision: 0, genre,
    hazards: [], rejected: [], alarm: false, receipts: [] };
  const origin = { x: Math.floor(dungeon.start.x), y: Math.floor(dungeon.start.y) };
  const occupied = new Set((dungeon.sceneObjects || []).map(o => K(Math.floor(o.x), Math.floor(o.y))));
  occupied.add(K(origin.x, origin.y));
  const rnd = rngFrom(`${dungeon.generation?.seed || dungeon.geoKey}:required-hazards-v1`), reserved = new Set();
  if(!quota.count){draft.roomHazards=report;return draft;}
  const eligible = eligibleKinds(dungeon, genre), preferred = evidence(dungeon.sceneSpec?.source?.description).map(e => e.kind);
  defineTiles(draft, genre);
  for (let slot = 0; slot < quota.count; slot++) {
    const score = kind => report.hazards.some(h=>h.kind===kind) ? 0 : preferred.includes(kind) ? 3 : 1;
    const base = reach(draft, origin), options = eligible.map(kind => ({ kind, r: rnd() }))
      .sort((a,b) => score(b.kind) - score(a.kind) || a.r - b.r);
    if(slot===0)for(const k of base)if(protectedCell(draft,k,draft.cells[k],occupied))reserved.add(k);
    for(const k of occupied)reserved.add(k);
    let accepted;
    for (const { kind } of options) {
      const ctx = { base, origin, occupied, reserved, genre }, id = `hazard:${kind}:${slot}`;
      const candidates = sites(draft, base, origin, rnd, occupied);
      let built;
      for (const site of candidates) { built = builders[kind](draft, site, ctx, id); if (built) break; }
      // Narrow rooms can use a smaller patch of the same danger, but never sacrifice a route.
      if (!built && (CATALOG[kind].shape || kind === 'unstable_floor')) for (const site of candidates) {
        const k = K(site.x, site.y);
        if (reserved.has(k) || !uniform(draft,[k],occupied) || !keepsConnected(draft,origin,base,new Set([k]))) continue;
        draft.cells[k] = CATALOG[kind].shape ? { ...draft.cells[k], tile:`custom_hazard_${kind}`, hazardId:id,
          structureHeight:CATALOG[kind].height } : setTile(draft.cells[k],'hazard_cracked_floor',id);
        built = { keys:[k], gap:[], zone:[k] }; break;
      }
      if (!built) continue;
      const entry = CATALOG[kind];
      accepted = { id, kind, state:'armed', keys:built.keys, gap:built.gap, zone:built.zone,
        ...(built.axis ? { axis:built.axis } : {}), ...(built.rift ? { rift:built.rift, ends:built.ends } : {}), check:{...entry.check}, damage:entry.damage,
        trigger:entry.trigger, choices:entry.choices, careful:{}, tested:false };
      for (const k of [...built.keys,...built.gap,...built.zone,...(built.ends || [])]) {
        const p = P(k); for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) reserved.add(K(p.x+dx,p.y+dy));
      }
      break;
    }
    if (!accepted) throw Error(`Room ${dungeon.geoKey} cannot safely fit its required ${quota.count} hazards; room not delivered.`);
    report.hazards.push(accepted);
  }
  draft.roomHazards = report;
  return draft;
}
// ---------------- resolution ----------------
function rollDice(spec, rng = sides => randomInt(1, sides + 1)) {
  const m = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(spec); if (!m) return 0;
  let total = Number(m[3] || 0); for (let i = 0; i < Number(m[1]); i++) total += rng(Number(m[2]));
  return total;
}
const live = h => h && !['collapsed', 'sealed', 'dormant', 'broken', 'cleared'].includes(h.state);
function hazardAt(dungeon, x, y) {
  const k = K(Math.floor(x), Math.floor(y));
  return (dungeon?.roomHazards?.hazards || []).filter(h => live(h) && h.zone.includes(k));
}
// Entering is the trigger. Returns the plan: whether a die roll is needed (the only pause), and its DC.
function planEnter(dungeon, hazardId, actorName, to, from = null) {
  const h = dungeon?.roomHazards?.hazards.find(h => h.id === hazardId);
  if (!live(h) || !actorName) return null;
  const k = K(Math.floor(to.x), Math.floor(to.y));
  if (!h.zone.includes(k)) return null;
  if (from && h.zone.includes(K(Math.floor(from.x), Math.floor(from.y)))) return null; // only on entering, not every step inside
  const careful = !!h.careful?.[actorName];
  if(CATALOG[h.kind].shape)return{hazard:h,actor:actorName,kind:'enter',key:k,careful,from,
    check:{label:h.check.label,difficulty:careful?h.check.carefulDc:h.check.dc}};
  if (h.kind === 'gas_vent') return { hazard: h, actor: actorName, kind: 'enter', key: k, check: null, careful };
  if (h.kind === 'ward_stone') return { hazard: h, actor: actorName, kind: 'enter', key: k, check: null };
  const dc = careful || (h.kind === 'unstable_floor' && h.tested) ? h.check.carefulDc : h.check.dc;
  return { hazard: h, actor: actorName, kind: 'enter', key: k, careful, check: { label: h.check.label, difficulty: dc } };
}
// Optional deliberate actions (click or text). Never required for movement.
function planAction(dungeon, hazardId, actorName, kind, point) {
  const h = dungeon?.roomHazards?.hazards.find(h => h.id === hazardId);
  if (!h) return { error: 'There is no such hazard here.' };
  if (!point || Math.min(...[...h.keys, ...h.zone].map(k => { const p = P(k); return Math.hypot(p.x + .5 - point.x, p.y + .5 - point.y); })) > REACH + 1.5)
    return { error: `Walk closer to the ${h.label} first.` };
  if (kind === 'inspect') return { hazard: h, actor: actorName, kind, check: null };
  if (!live(h)) return { error: `The ${h.label} is no longer a threat.` };
  const allowed = CATALOG[h.kind].actions || { collapsing_bridge: ['careful'], unstable_floor: ['careful'], gas_vent: ['careful', 'disarm'], ward_stone: ['disarm'] }[h.kind];
  if (!allowed.includes(kind)) return { error: `That approach does not apply to the ${h.label}.` };
  if (kind === 'careful') return { hazard: h, actor: actorName, kind, check: null };
  return { hazard: h, actor: actorName, kind, check: { label: CATALOG[h.kind].disarmLabel||h.check.label, difficulty: CATALOG[h.kind].disarmDc||h.check.dc } };
}
function nearestSafe(dungeon, fromKey, avoid) {
  const p = P(fromKey), queue = [p], seen = new Set([fromKey]);
  for (let i = 0; i < queue.length && i < 4000; i++) {
    const a = queue[i], k = K(a.x, a.y), c = dungeon.cells[k];
    if (!avoid.has(k) && c && I.walkable(dungeon, a.x, a.y) && !c.hazardGap) return a;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = { x: a.x + dx, y: a.y + dy }, bk = K(b.x, b.y);
      if (seen.has(bk) || !dungeon.cells[bk]) continue; seen.add(bk); queue.push(b);
    }
  }
  return null;
}
// Apply a resolved plan. `success` is null when no check was rolled. Mutates `dungeon` (caller passes a copy).
function outcome(dungeon, plan, success, { rng, margin = success ? 0 : -99 } = {}) {
  const h = dungeon.roomHazards.hazards.find(x => x.id === plan.hazard.id), cells = {}, damage = {}, relocate = {}, effects = [];
  const entry = CATALOG[h.kind], name = plan.actor;
  let message = '';
  const hurt = (amount, why) => { damage[name] = (damage[name] || 0) + amount; message += ` ${name} takes ${amount} ${why} damage.`; };
  const collapse = keys => {
    for (const k of keys) { dungeon.cells[k] = pitCell(dungeon.cells[k], h.id); cells[k] = dungeon.cells[k]; }
    effects.push({ type: 'collapse', keys: [...keys] });
  };
  if (plan.kind === 'inspect') {
    message = (h.description ? h.description + ' ' : '') + `${h.label[0].toUpperCase() + h.label.slice(1)}: ${h.state === 'armed' ? 'still dangerous.' : h.state + '.'} Options: ${h.choices.join('; ')}.` +
      (h.check ? ` ${h.check.label} DC ${h.check.dc}${h.check.carefulDc ? ` (DC ${h.check.carefulDc} with care)` : ''}.` : '');
  } else if (entry.shape) {
    if(plan.kind==='careful'){
      h.careful={...h.careful,[name]:true};message=`${name} prepares a careful crossing of the ${h.label} (DC ${h.check.carefulDc}).`;
    }else{
      if(plan.kind==='enter'&&plan.careful)h.careful={...h.careful,[name]:false};
      if((plan.kind==='disarm'&&success)||(plan.kind==='enter'&&entry.oneShot)){
        h.state='cleared';
        for(const k of h.keys){dungeon.cells[k]={...dungeon.cells[k],tile:'floor',structureHeight:0};cells[k]=dungeon.cells[k];}
        effects.push({type:'sealed',keys:h.keys});
      }
      if(success)message=plan.kind==='disarm'?`${name} makes the ${h.label} safe.`:`${name} crosses the ${h.label} safely.`;
      else{
        message=`${name} cannot safely ${plan.kind==='disarm'?'neutralize':'cross'} the ${h.label}.`;
        const amount=rollDice(h.damage,rng);if(amount)hurt(amount,entry.damageType);
        if(entry.rebound&&plan.kind==='enter'){
          const safe=nearestSafe(dungeon,plan.from?K(Math.floor(plan.from.x),Math.floor(plan.from.y)):plan.key,new Set(h.zone));
          if(safe){relocate[name]=safe;message+=` ${name} retreats to safe ground.`;}
        }
      }
      effects.push({type:entry.shape==='hazard_mist'?'gas':entry.damageType==='impact'?'creak':'pulse',keys:h.keys});
    }
  } else if (plan.kind === 'careful') {
    h.careful = { ...h.careful, [name]: true };
    if (h.kind === 'unstable_floor') h.tested = true;
    message = h.kind === 'gas_vent' ? `${name} draws a deep breath and will cross the fumes unharmed.` :
      h.kind === 'unstable_floor' ? `${name} probes the ${h.label} and marks the sound stones (footing DC ${h.check.carefulDc}).` :
      `${name} tests each plank and will cross carefully (balance DC ${h.check.carefulDc}).`;
  } else if (plan.kind === 'disarm') {
    if (success) {
      h.state = h.kind === 'gas_vent' ? 'sealed' : 'dormant';
      for (const k of h.keys) { dungeon.cells[k] = { ...dungeon.cells[k], tile: h.kind === 'gas_vent' ? 'custom_hazard_vent_sealed' : 'custom_hazard_ward_stone_dormant' }; cells[k] = dungeon.cells[k]; }
      message = `${name} ${entry.outcome.success}.`; effects.push({ type: h.kind === 'gas_vent' ? 'sealed' : 'dispelled', keys: h.keys });
    } else {
      message = `${name} fails: ${entry.outcome.failure}.`; hurt(rollDice(h.damage, rng), h.kind === 'gas_vent' ? 'poison' : 'arcane');
      effects.push({ type: h.kind === 'gas_vent' ? 'gas' : 'pulse', keys: h.keys });
    }
  } else if (h.kind === 'gas_vent') {
    if (plan.careful) { message = `${name} crosses the fumes holding breath.`; h.careful = { ...h.careful, [name]: false }; }
    else { message = `${name} walks into the ${h.label}'s fumes.`; hurt(rollDice(h.damage, rng), 'poison'); }
    effects.push({ type: 'gas', keys: h.keys });
  } else if (h.kind === 'ward_stone') {
    message = `The ${h.label} pulses as ${name} enters its circle.`; hurt(rollDice(h.damage, rng), 'arcane');
    dungeon.roomHazards.alarm = true;
    const stone = P(h.keys[0]), at = P(plan.key), dx = Math.sign(at.x - stone.x), dy = Math.sign(at.y - stone.y);
    const back = { x: at.x + dx, y: at.y + dy };
    if ((dx || dy) && I.canTraverse(dungeon, at, back)) { relocate[name] = back; message += ` The blast throws ${name} back.`; }
    message += ' The ward rings out an alarm.';
    effects.push({ type: 'pulse', keys: h.keys });
  } else if (h.kind === 'collapsing_bridge' && (success || margin >= -NEAR_MISS)) {
    // The bridge is a real chance, never an automatic collapse: success crosses safely; a near miss drops a loose
    // section the crosser clings past. Either way the walkable planks stay, but each crossing makes it more fragile.
    if (plan.careful) h.careful = { ...h.careful, [name]: false };
    h.crossings = (h.crossings || 0) + 1;
    const strain = success ? 1 : 2;
    h.check = { ...h.check, dc: Math.min(MAX_BRIDGE_DC, h.check.dc + strain), carefulDc: Math.min(MAX_BRIDGE_DC - 4, h.check.carefulDc + strain) };
    if (success) message = `${name} ${entry.outcome.success} and crosses safely. The bridge creaks (balance DC now ${h.check.dc}).`;
    else { message = `A loose section drops away beneath ${name}, who grabs the hand rope and hauls up onto the planks.`; hurt(rollDice('1d3', rng), 'bruising'); }
    effects.push({ type: 'creak', keys: [plan.key] });
  } else if (h.kind === 'collapsing_bridge' && h.rift && !success) {
    if (plan.careful) h.careful = { ...h.careful, [name]: false };
    const k = plan.key, c = dungeon.cells[k], axis = c?.hazardAxis || h.axis || 'x';
    dungeon.cells[k] = { ...c, tile: axis === 'x' ? 'custom_hazard_bridge_broken' : 'custom_hazard_bridge_broken_y', hazardBroken: true };
    cells[k] = dungeon.cells[k];
    h.broken = true; h.check = { ...h.check, dc: Math.min(MAX_BRIDGE_DC, h.check.dc + 3), carefulDc: Math.min(MAX_BRIDGE_DC - 4, h.check.carefulDc + 3) };
    effects.push({ type: 'collapse', keys: [k], keep: true });
    const top = c?.floorHeight || 0, depth = Number((top - h.rift.bottom).toFixed(2));
    message = `${name}: ${entry.outcome.failure}! ${name} plunges ${Math.round(depth)} metres and slams onto a ledge far below.`;
    hurt(rollDice(h.damage, rng), 'falling');
    const from = plan.from && K(Math.floor(plan.from.x), Math.floor(plan.from.y));
    const end = (h.ends || []).slice().sort((a, b) => { const p = P(k), A = P(a), B = P(b);
      return (from && a === from ? -1 : from && b === from ? 1 : 0) || Math.hypot(A.x - p.x, A.y - p.y) - Math.hypot(B.x - p.x, B.y - p.y); })[0];
    const safe = end && I.walkable(dungeon, P(end).x, P(end).y) ? P(end) : nearestSafe(dungeon, k, new Set(h.zone));
    if (safe) { relocate[name] = safe; message += ` ${name} climbs the hanging rope back up to the rim. The broken span can still be crossed hand over hand (balance DC now ${h.check.dc}).`; }
    effects.push({ type: 'fall', actor: name, key: k, depth, landing: h.rift.bottom, fog: h.rift.fog, climate: h.rift.climate, pulledUp: !!safe });
  } else {
    if (plan.careful) h.careful = { ...h.careful, [name]: false };
    if (success) message = `${name} ${entry.outcome.success}.`;
    else {
      const broken = h.kind === 'unstable_floor' ? [...h.keys] : [plan.key];
      collapse(broken);
      if (h.kind === 'unstable_floor') h.state = 'collapsed';
      else { h.keys = h.keys.filter(k => !broken.includes(k)); h.zone = h.zone.filter(k => !broken.includes(k)); h.gap = [...h.gap, ...broken]; h.state = h.keys.length ? 'broken-span' : 'collapsed'; if (h.state === 'broken-span') h.state = 'armed'; h.broken = true; }
      message = `${name}: ${entry.outcome.failure}! ${name} falls ${PIT_DEPTH} metres onto the debris.`;
      hurt(rollDice(h.damage, rng), 'falling');
      const safe = nearestSafe(dungeon, plan.key, new Set(h.zone));
      if (safe) { relocate[name] = safe; message += ` ${name} climbs out at ${safe.x},${safe.y}.`; }
      effects.push({ type: 'fall', actor: name, key: plan.key, depth: PIT_DEPTH, landing: (dungeon.cells[plan.key]?.floorHeight ?? -PIT_DEPTH), pulledUp: !!safe });
    }
  }
  dungeon.roomHazards.revision++;
  return { hazard: h, cells, damage, relocate, effects, message: message.trim(), roomHazards: dungeon.roomHazards };
}
// Existing sheet modifiers only: the level-based save bonus, plus a +2 knack for nimble classes on footing and balance
// checks and for arcane classes on dispelling a ward.
function checkModifier(plan, sheet, saveBonus = () => 0) {
  if (!plan?.check || !sheet) return 0;
  const cls = String(sheet.className || sheet.class || sheet.Class || '');
  const base = Number(saveBonus(sheet)) || 0;
  if (plan.kind === 'enter') return base + (!CATALOG[plan.hazard.kind].endurance&&NIMBLE.test(cls) ? 2 : 0);
  if (plan.hazard.kind === 'ward_stone') return base + (ARCANE.test(cls) ? 2 : 0);
  return base;
}
// Text-parser intents; the click options submit these same commands.
function intent(input, dungeon) {
  const text = String(input || '').toLowerCase(), hazards = dungeon?.roomHazards?.hazards || [];
  if (!hazards.length) return null;
  const noun = { collapsing_bridge: /\b(bridge|gantry|catwalk|planks?|span)\b/, gas_vent: /\b(vent|fumes|gas|steam|plasma)\b/,
    unstable_floor: /\b(floor|flagstones?|plating|deck|cracks?)\b/, ward_stone: /\b(ward|stone|pylon|runes?)\b/ };
  const named = hazards.filter(h => text.includes(h.label.toLowerCase())).sort((a,b)=>b.label.length-a.label.length);
  const generic = hazards.filter(h => noun[h.kind]?.test(text));
  const h = named[0] || (generic.length === 1 ? generic[0] : null);
  if (!h) return null;
  if (/\b(inspect|examine|look at|study)\b/.test(text)) return { hazardId: h.id, kind: 'inspect' };
  if (/\b(dispel|disarm|deactivate|break the ward|seal|plug|block|shut|extinguish|neutralize|ground|stop|contain)\b/.test(text)) return { hazardId: h.id, kind: 'disarm' };
  if (/\b(test|probe|carefully|cautiously|hold (?:my |your )?breath|careful)\b/.test(text)) return { hazardId: h.id, kind: 'careful' };
  return null;
}
function commands(h) {
  const n = h.label;
  const entry=CATALOG[h.kind];
  if(entry?.shape)return{inspect:`inspect the ${n}`,...(live(h)?{careful:`cross the ${n} carefully`,
    ...(entry.disarmVerb?{disarm:`${entry.disarmVerb} the ${n}`}:{})}:{})};
  return { inspect: `inspect the ${n}`, ...(live(h) ? { collapsing_bridge: { careful: `cross the ${n} carefully` }, unstable_floor: { careful: `test the ${n}` },
    gas_vent: { careful: `hold breath near the ${n}`, disarm: `seal the ${n}` }, ward_stone: { disarm: `dispel the ${n}` } }[h.kind] : {}) };
}
function persist(state, dungeon) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}');
  if (db[dungeon.geoKey]) { db[dungeon.geoKey].roomHazards = dungeon.roomHazards; state.setRoomNameDatabase(JSON.stringify(db)); }
}
function preserve(current, incoming) {
  const saved = JSON.parse(current), next = JSON.parse(incoming);
  for (const [key, room] of Object.entries(saved)) if (room?.roomHazards && next[key] && !next[key].roomHazards) next[key].roomHazards = room.roomHazards;
  return JSON.stringify(next);
}
// Player preference from the options panel; off by default (rolls resolve automatically while travelling).
const settings = { pauseRolls: false };
module.exports = { settings, checkModifier, NEAR_MISS, VERSION, MAX_PER_ROOM, PIT_DEPTH, CATALOG, KINDS, SHAPES, evidence, install, requiredQuota, eligibleKinds, requiredDraft, planEnter, planAction, outcome, hazardAt, intent, commands,
  rollDice, reach, persist, preserve, flavorOf, live };

