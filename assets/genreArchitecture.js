(function(root, factory) {
  const node = typeof module === 'object' && module.exports;
  const enabled = node ? require('../retort/worldFlags').on('GENRE_EXPANSION') || require('../retort/worldFlags').on('ARCHITECTURE_EXPANSION') : root.HolodekFlags?.GENRE_EXPANSION || root.HolodekFlags?.ARCHITECTURE_EXPANSION;
  const api = factory(node ? require('./genreExpansion') : root.GenreExpansion, enabled);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.GenreArchitecture = api;
})(typeof window === 'object' ? window : globalThis, function(Expansion, expanded) {
  'use strict';
  // world1 GENRE_ARCH: per-genre building styles, room shapes, town/street rules and character garb.
  // ADDITIVE ONLY. Nothing here replaces existing art:
  //  - new wall/floor painters are merged into renderSceneTextures' WALL/FLOOR tables under NEW names only
  //    (same 32x32 tile-wrapping painter, same 4-colour material ramp, same nearest-neighbour upscale);
  //  - fantasy / dark-fantasy / mythic keep the Ruined Temple stone kit (style.keep = true -> no override),
  //    and Children of the Grave (no homebrew bible) never reaches this module (genreLayer/resolve lock it);
  //  - room shapes are plans for the existing IndoorBlueprint.build (its hall/round/irregular carving + corridor repair);
  //  - garb is drawn after the existing c64 humanoid body, before its outline/colour-limit passes.
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = seed => { let a = hash(seed); return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const hx = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16) || 0);
  const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = hx(a), B = hx(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
  const HORROR = ['cosmic-horror', 'dark-fantasy'];

  // ---- materials: base ramps [base, dark, light, deep] (merged into renderSceneTextures MAT for NEW names only) ----
  const MAT = {
    clapboard: ['#a07a52', '#6e4e30', '#c8a070', '#2e1e12'], boardwalk: ['#8a6440', '#5c4028', '#b08658', '#24170c'],
    dirt_street: ['#a8865a', '#806240', '#c8a878', '#4a3420'], adobe: ['#c49a6a', '#9a7448', '#e0bc8a', '#5a4028'],
    timber_frame: ['#d8ccb0', '#4a3020', '#efe4c8', '#20140a'], pit_prop: ['#5e4c3c', '#3a2c20', '#8a6a48', '#140e08'],
    mine_floor: ['#5a4836', '#3a2c20', '#7a6a58', '#16100a'], polyp_prop: ['#2f5a58', '#1c3a3a', '#9fe0d0', '#081414'],
    alien_stone: ['#2a4a48', '#16302e', '#7fd3c6', '#060e0e'], ichor_floor: ['#24302e', '#141c1c', '#5a9a88', '#040808'],
    bulkhead: ['#8a96a2', '#5a6672', '#c0ccd8', '#1a2430'], deck_grate: ['#5a6470', '#343c46', '#8a96a2', '#10161c'],
    neon_brick: ['#3a3640', '#24222a', '#e8c8f0', '#0e0c12'], wet_asphalt: ['#2a2c30', '#1a1c20', '#6a6e78', '#08090a'],
    scrap_sheet: ['#7a6248', '#4a3a2a', '#a8865a', '#1c140c'], cracked_tarmac: ['#4a4842', '#323028', '#6e6a60', '#14130f'],
    riveted_brass: ['#a87a3a', '#6a4a20', '#e0b060', '#24160a'], cog_tile: ['#5a4a3a', '#3a2c20', '#b08a4a', '#16100a'],
    concrete_block: ['#9a9890', '#74726a', '#bebcb2', '#3a3a34'], linoleum: ['#b8b4a4', '#6a6a60', '#dcd8c8', '#2a2a26'],
    hull_plank: ['#6e5038', '#4a3424', '#94704c', '#1a120a'], deck_plank: ['#9a7a54', '#6a5238', '#c09c70', '#2a1e12'],
    fluted_marble: ['#e4ded0', '#bcb4a2', '#f8f4ea', '#8a8270'], mosaic_floor: ['#d8cfb8', '#a0583a', '#e7b45a', '#3a4a6a'],
    damask_paper: ['#4a2a2e', '#2e1a1c', '#8a5a4a', '#120a0a'], checker_tile: ['#d8d4c8', '#1c1c1c', '#f0ece0', '#0a0a0a'],
    door_plank: ['#7a5636', '#4a3220', '#a07a4e', '#1a1008'], door_hatch: ['#7a8692', '#4a5662', '#c0ccd8', '#141c24'],
    door_iron: ['#5a5650', '#36332f', '#8a857c', '#100f0d'], door_brass: ['#a87a3a', '#6a4a20', '#e0b060', '#24160a'],
    door_glass: ['#4a3a2a', '#2a2018', '#a8c8d8', '#0e0a06'], door_sigil: ['#24302e', '#141c1c', '#7fd3c6', '#040808']
  };
  // ---- painters (P: px/rect/fill on the wrapping 32x32 grid; c: material ramp; r: rng) ----
  const planks = (P, c, r, vertical, n, gap) => { for (let k = 0; k < n; k++) { const a = Math.floor(k * 32 / n), w = Math.floor((k + 1) * 32 / n) - a - gap;
    for (let i = 0; i < w; i++) for (let j = 0; j < 32; j++) { const col = (k + Math.floor(j / 16)) % 3 === 0 ? c[1] : c[0]; vertical ? P.px(a + i, j, col) : P.px(j, a + i, col); }
    for (let i = 0; i < 5; i++) { const g = Math.floor(r() * 32); vertical ? P.px(a + Math.floor(r() * w), g, mix(c[1], c[3], .4)) : P.px(g, a + Math.floor(r() * w), mix(c[1], c[3], .4)); } } };
  const rivets = (P, c, step, off = 2) => { for (let y = off; y < 32; y += step) for (let x = off; x < 32; x += step) { P.px(x, y, c[2]); P.px(x + 1, y + 1, c[3]); } };
  const WALL = {
    clapboard(P, c, r) { P.fill(c[0]); for (let y = 0; y < 32; y += 4) { P.rect(0, y, 32, 1, c[2]); P.rect(0, y + 3, 32, 1, c[3]); for (let i = 0; i < 3; i++) P.px(r() * 32, y + 1 + Math.floor(r() * 2), c[1]); }
      for (let y = 0; y < 32; y++) if (r() < .25) P.px(r() * 32, y, mix(c[0], '#e8dcc0', .35)); P.rect(0, 0, 2, 32, c[1]); }, // weathered paint flecks + corner board
    adobe(P, c, r) { P.fill(c[0]); for (let i = 0; i < 70; i++) P.px(r() * 32, r() * 32, r() < .5 ? c[1] : c[2]); for (let k = 0; k < 3; k++) { let x = r() * 32, y = r() * 32; for (let i = 0; i < 6; i++) { P.px(x, y, c[1]); x += r() < .5 ? 1 : 0; y++; } } P.rect(0, 30, 32, 2, c[1]); },
    timber_frame(P, c, r) { P.fill(c[0]); for (let i = 0; i < 40; i++) P.px(r() * 32, r() * 32, c[2]); P.rect(0, 0, 32, 2, c[1]); P.rect(0, 15, 32, 2, c[1]); P.rect(0, 30, 32, 2, c[1]); P.rect(0, 0, 2, 32, c[1]); P.rect(16, 0, 2, 32, c[1]);
      for (let i = 0; i < 13; i++) { P.px(2 + i, 2 + i, c[1]); P.px(3 + i, 2 + i, c[1]); } for (let i = 0; i < 13; i++) { P.px(29 - i, 17 + i, c[1]); P.px(30 - i, 17 + i, c[1]); } },
    pit_prop(P, c, r) { P.fill(c[1]); for (let i = 0; i < 120; i++) P.px(r() * 32, r() * 32, r() < .5 ? c[0] : c[3]); for (let k = 0; k < 4; k++) { const x = r() * 32, y = r() * 32; P.rect(x, y, 3, 2, c[0]); P.px(x, y, mix(c[0], '#c8b090', .3)); }
      const wood = '#6e4e30', dark = '#3a2616'; P.rect(3, 0, 4, 32, wood); P.rect(25, 0, 4, 32, wood); P.rect(0, 0, 32, 4, wood); P.rect(3, 4, 1, 28, dark); P.rect(0, 4, 32, 1, dark); for (let y = 8; y < 32; y += 7) { P.px(5, y, dark); P.px(27, y + 3, dark); } },
    polyp_prop(P, c, r) { WALL.pit_prop(P, ['#4a5a56', '#283634', '#6a8a84', '#0a1212'], r); for (let k = 0; k < 9; k++) { const x = r() * 32, y = r() * 32, s = 1 + Math.floor(r() * 2); P.rect(x, y, s + 1, s + 1, c[0]); P.px(x + s, y, c[2]); } for (let k = 0; k < 3; k++) { let x = r() * 32; for (let y = 0; y < 32; y++) { x += r() < .5 ? -.7 : .7; P.px(x, y, c[2]); } } },
    alien_stone(P, c, r) { P.fill(c[0]); for (let y = 0; y < 32; y++) { const o = Math.round(3 * Math.sin(y * .45)); for (let x = 0; x < 32; x += 6) P.px(x + o + (y % 12 < 6 ? 0 : 3), y, c[1]); }
      for (let k = 0; k < 4; k++) { let x = r() * 32, y = r() * 32; for (let i = 0; i < 14; i++) { P.px(x, y, c[2]); x += Math.round(r() * 2 - 1); y += Math.round(r() * 2 - .6); } } P.px(r() * 32, r() * 32, '#e8f0c0'); },
    bulkhead(P, c, r) { P.fill(c[0]); P.rect(0, 0, 32, 1, c[2]); P.rect(0, 15, 32, 2, c[3]); P.rect(15, 0, 2, 32, c[3]); rivets(P, c, 8, 3); P.rect(4, 24, 24, 2, '#e0542a'); for (let x = 4; x < 28; x += 4) P.px(x, 24, '#1a2430'); P.rect(20, 5, 6, 4, c[1]); P.px(21, 6, '#90d0ff'); },
    neon_brick(P, c, r) { P.fill(c[3]); for (let y = 0; y < 32; y += 4) for (let x = (y / 4 % 2) * 4; x < 32; x += 8) P.rect(x, y, 7, 3, r() < .2 ? c[1] : c[0]); const n = r() < .5 ? '#e8c8f0' : '#90d0ff'; P.rect(0, 12, 32, 1, n); P.rect(0, 13, 32, 1, mix(n, c[3], .6));
      for (let k = 0; k < 3; k++) { const x = r() * 28, y = 18 + r() * 10; P.rect(x, y, 3, 1, '#a04060'); P.px(x + 1, y + 1, '#a04060'); } },
    scrap_sheet(P, c, r) { P.fill(c[0]); for (let x = 0; x < 32; x += 3) P.rect(x, 0, 1, 32, c[1]); for (let k = 0; k < 6; k++) { const x = r() * 32, y = r() * 32, w = 2 + r() * 6; P.rect(x, y, w, 2 + r() * 4, '#8b4a22'); } P.rect(0, 10, 32, 1, c[3]); P.rect(0, 22, 32, 1, c[3]); for (let x = 1; x < 32; x += 6) { P.px(x, 9, c[2]); P.px(x + 2, 21, c[2]); } },
    riveted_brass(P, c, r) { P.fill(c[0]); P.rect(0, 0, 32, 2, c[2]); P.rect(0, 30, 32, 2, c[3]); for (let x = 0; x < 32; x += 8) P.rect(x, 0, 1, 32, c[1]); rivets(P, c, 8, 4); for (let i = 0; i < 30; i++) P.px(r() * 32, r() * 32, mix(c[0], '#5a9a88', .5)); },
    concrete_block(P, c, r) { P.fill(c[0]); for (let y = 0; y < 32; y += 8) { P.rect(0, y, 32, 1, c[1]); for (let x = (y / 8 % 2) * 8; x < 32; x += 16) P.rect(x, y, 1, 8, c[1]); } for (let i = 0; i < 60; i++) P.px(r() * 32, r() * 32, r() < .5 ? c[2] : c[1]); },
    hull_plank(P, c, r) { planks(P, c, r, false, 8, 1); for (let x = 0; x < 32; x += 10) P.rect(x, 0, 2, 32, c[3]); for (let y = 2; y < 32; y += 4) P.px(1, y, '#c8b080'); },
    fluted_marble(P, c, r) { P.fill(c[0]); for (let x = 1; x < 32; x += 5) { P.rect(x, 3, 1, 26, c[1]); P.rect(x + 1, 3, 1, 26, c[2]); } P.rect(0, 0, 32, 3, c[2]); P.rect(0, 29, 32, 3, c[1]); for (let x = 0; x < 32; x += 4) P.px(x, 1, c[3]); },
    damask_paper(P, c, r) { P.fill(c[0]); for (let y = 2; y < 32; y += 8) for (let x = (y % 16 < 8 ? 0 : 4); x < 32; x += 8) { P.px(x + 2, y, c[2]); P.px(x + 1, y + 1, c[2]); P.px(x + 3, y + 1, c[2]); P.px(x + 2, y + 2, c[2]); } for (let x = 0; x < 32; x += 8) P.rect(x, 0, 1, 32, c[1]); P.rect(0, 26, 32, 6, '#3a2418'); P.rect(0, 26, 32, 1, '#6a4a30'); },
    // doors (painted as a wall-kind texture into dungeon.tiles.door)
    door_plank(P, c, r) { P.fill(c[3]); planks(P, c, r, true, 5, 1); P.rect(2, 6, 28, 2, c[3]); P.rect(2, 24, 28, 2, c[3]); P.rect(24, 15, 2, 2, '#c8b080'); },
    door_hatch(P, c, r) { P.fill(c[0]); P.rect(3, 3, 26, 26, c[1]); P.rect(5, 5, 22, 22, c[0]); rivets(P, c, 6, 6); P.rect(14, 14, 4, 4, c[3]); P.rect(5, 28, 22, 1, '#e0542a'); },
    door_iron(P, c, r) { P.fill(c[0]); for (let x = 0; x < 32; x += 8) P.rect(x, 0, 2, 32, c[1]); rivets(P, c, 8, 4); P.rect(22, 14, 3, 4, c[2]); },
    door_brass(P, c, r) { WALL.riveted_brass(P, c, r); for (let a = 0; a < 6.28; a += .5) P.px(16 + 6 * Math.cos(a), 16 + 6 * Math.sin(a), c[3]); P.rect(15, 15, 3, 3, c[2]); },
    door_glass(P, c, r) { P.fill(c[0]); P.rect(5, 4, 22, 12, c[2]); P.rect(5, 4, 22, 1, c[3]); P.rect(15, 4, 2, 12, c[0]); P.rect(5, 20, 22, 8, c[1]); P.rect(24, 18, 2, 2, '#e7b45a'); },
    door_sigil(P, c, r) { P.fill(c[0]); for (let i = 0; i < 12; i++) { P.px(16 + i * Math.cos(i), 16 + i * Math.sin(i * 1.3), c[2]); } P.rect(14, 14, 4, 4, c[2]); P.px(15, 15, '#e8f0c0'); }
  };
  const FLOOR = {
    boardwalk(P, c, r) { P.fill(c[3]); planks(P, c, r, false, 6, 1); for (let y = 2; y < 32; y += 5) { P.px(4, y, '#2a2018'); P.px(20, y, '#2a2018'); } },
    dirt_street(P, c, r) { P.fill(c[0]); for (let i = 0; i < 160; i++) P.px(r() * 32, r() * 32, r() < .5 ? c[1] : c[2]); for (let k = 0; k < 2; k++) { const y = 8 + k * 14; for (let x = 0; x < 32; x++) P.px(x, y + Math.round(Math.sin(x * .4 + k)), c[1]); } for (let k = 0; k < 4; k++) P.rect(r() * 32, r() * 32, 2, 1, c[3]); },
    mine_floor(P, c, r) { P.fill(c[0]); for (let i = 0; i < 110; i++) P.px(r() * 32, r() * 32, r() < .5 ? c[1] : c[2]); for (let y = 2; y < 32; y += 6) P.rect(6, y, 20, 2, '#5a3e26'); P.rect(9, 0, 1, 32, '#8a8a90'); P.rect(22, 0, 1, 32, '#8a8a90'); },
    ichor_floor(P, c, r) { P.fill(c[0]); for (let i = 0; i < 90; i++) P.px(r() * 32, r() * 32, c[1]); for (let k = 0; k < 3; k++) { const x = r() * 32, y = r() * 32; P.rect(x, y, 5, 3, c[2]); P.rect(x + 1, y + 1, 3, 1, mix(c[2], '#e8f0c0', .4)); } },
    deck_grate(P, c, r) { P.fill(c[3]); for (let y = 0; y < 32; y += 4) for (let x = 0; x < 32; x += 4) P.rect(x, y, 3, 3, c[0]); P.rect(0, 15, 32, 2, c[1]); P.rect(0, 0, 32, 1, '#e0542a'); },
    wet_asphalt(P, c, r) { P.fill(c[0]); for (let i = 0; i < 90; i++) P.px(r() * 32, r() * 32, c[1]); for (let k = 0; k < 3; k++) { const x = r() * 28, y = r() * 28; P.rect(x, y, 6, 2, c[2]); P.px(x + 2, y, '#e8c8f0'); } P.rect(0, 30, 32, 1, '#d8c870'); },
    cracked_tarmac(P, c, r) { P.fill(c[0]); for (let i = 0; i < 80; i++) P.px(r() * 32, r() * 32, c[1]); for (let k = 0; k < 4; k++) { let x = r() * 32, y = r() * 32; for (let i = 0; i < 10; i++) { P.px(x, y, c[3]); x += r() < .5 ? 1 : -1; y += 1; } } for (let i = 0; i < 6; i++) P.px(r() * 32, r() * 32, '#6a8a42'); },
    cog_tile(P, c, r) { P.fill(c[0]); for (let y = 0; y < 32; y += 16) for (let x = 0; x < 32; x += 16) { for (let a = 0; a < 6.28; a += .35) P.px(x + 8 + 5 * Math.cos(a), y + 8 + 5 * Math.sin(a), c[2]); for (let a = 0; a < 6.28; a += .79) P.px(x + 8 + 7 * Math.cos(a), y + 8 + 7 * Math.sin(a), c[2]); P.rect(x + 7, y + 7, 2, 2, c[3]); } },
    linoleum(P, c, r) { P.fill(c[0]); for (let y = 0; y < 32; y += 8) for (let x = 0; x < 32; x += 8) if ((x + y) / 8 % 2) P.rect(x, y, 8, 8, mix(c[0], c[1], .35)); for (let i = 0; i < 20; i++) P.px(r() * 32, r() * 32, c[2]); },
    deck_plank(P, c, r) { P.fill(c[3]); planks(P, c, r, true, 6, 1); for (let x = 2; x < 32; x += 5) { P.px(x, 6, '#2a2018'); P.px(x, 22, '#2a2018'); } },
    mosaic_floor(P, c, r) { P.fill(c[0]); for (let y = 0; y < 32; y += 2) for (let x = 0; x < 32; x += 2) if (r() < .12) P.rect(x, y, 2, 2, [c[1], c[2], c[3]][Math.floor(r() * 3)]); P.rect(0, 0, 32, 2, c[1]); P.rect(0, 30, 32, 2, c[1]); for (let x = 0; x < 32; x += 4) P.rect(x, 0, 2, 2, c[2]); },
    checker_tile(P, c) { for (let y = 0; y < 32; y += 4) for (let x = 0; x < 32; x += 4) P.rect(x, y, 4, 4, (x + y) / 4 % 2 ? c[1] : c[0]); }
  };
  // Window / trim overlays painted onto the chosen wall (decal-style, same painter).
  const WINDOW = {
    sash(P, r) { P.rect(10, 6, 12, 12, '#2a2018'); P.rect(11, 7, 10, 10, '#8ab0c0'); P.rect(16, 7, 1, 10, '#2a2018'); P.rect(11, 12, 10, 1, '#2a2018'); P.px(12, 8, '#e8f4ff'); },
    lancet(P, r) { P.rect(13, 5, 6, 16, '#20140a'); P.rect(14, 6, 4, 14, '#b49ac8'); P.px(15, 5, '#20140a'); P.px(16, 4, '#20140a'); P.rect(15, 9, 2, 1, '#e7b45a'); },
    porthole(P, r) { for (let a = 0; a < 6.28; a += .3) P.px(16 + 5 * Math.cos(a), 11 + 5 * Math.sin(a), '#c0ccd8'); P.rect(13, 8, 6, 6, '#3a7aa0'); P.px(14, 9, '#e8f4ff'); },
    shuttered(P, r) { P.rect(10, 6, 12, 12, '#3a2418'); for (let y = 7; y < 18; y += 2) P.rect(11, y, 10, 1, '#6a4a30'); },
    neon(P, r) { P.rect(8, 6, 16, 8, '#121416'); P.rect(9, 7, 14, 1, '#e8c8f0'); P.rect(9, 12, 14, 1, '#90d0ff'); },
    blind(P, r) { P.rect(9, 5, 14, 14, '#c8d8ff'); for (let y = 6; y < 19; y += 2) P.rect(9, y, 14, 1, '#545a61'); },
    boarded(P, r) { P.rect(10, 6, 12, 12, '#14100c'); P.rect(9, 8, 14, 2, '#8a5a32'); P.rect(9, 14, 14, 2, '#6e4e30'); }
  };
  const TRIM = {
    cornice(P, c) { P.rect(0, 0, 32, 2, c[2]); P.rect(0, 2, 32, 1, c[3]); for (let x = 0; x < 32; x += 4) P.px(x, 3, c[3]); },
    baseboard(P, c) { P.rect(0, 29, 32, 3, c[1]); P.rect(0, 29, 32, 1, c[2]); },
    hazard(P) { for (let x = 0; x < 32; x++) P.px(x, 31, ((x >> 2) & 1) ? '#e0c37a' : '#1a2430'); },
    pipe(P) { P.rect(0, 3, 32, 2, '#6a4418'); P.rect(0, 3, 32, 1, '#e8c070'); for (let x = 6; x < 32; x += 12) P.rect(x, 2, 2, 4, '#b07a32'); },
    rope(P) { for (let x = 0; x < 32; x++) P.px(x, 2 + ((x >> 1) & 1), '#c8b080'); },
    meander(P, c) { for (let x = 0; x < 32; x += 4) { P.rect(x, 1, 3, 1, c[1]); P.rect(x + 2, 1, 1, 3, c[1]); } },
    none() {}
  };
  // ---- styles: per genre. keep:true -> existing Ruined Temple stone kit stays (no override). zones by room keywords. ----
  const S = (o) => o;
  const STYLES = {
    fantasy: S({ keep: true, label: 'Ruined Temple stone (default)', shapes: ['hall', 'temple_court'], street: 'winding_lanes' }),
    'dark-fantasy': S({ keep: true, label: 'Ruined Temple stone, gothic', shapes: ['hall', 'church_nave'], street: 'winding_lanes', corrupts: {} }),
    mythic: S({ label: 'Marble colonnade', wall: 'fluted_marble', floor: 'mosaic_floor', ceiling: 'stone', door: 'door_iron', window: null, trim: 'meander', shapes: ['temple_court', 'hall'], street: 'agora_grid', props: ['g_moon_brazier', 'altar'], keepOnLocked: true }),
    western: S({ label: 'Frontier clapboard and timber', wall: 'clapboard', floor: 'boardwalk', ceiling: 'wood', door: 'door_plank', window: 'sash', trim: 'cornice', shapes: ['storefront', 'main_street'], street: 'main_street',
      props: ['g_hitching_post', 'g_water_tower', 'g_saloon_sign', 'barrel', 'crate'],
      zones: { street: { wall: 'clapboard', floor: 'dirt_street', shape: 'main_street', trim: 'cornice' }, church: { wall: 'timber_frame', floor: 'deck_plank', window: 'lancet', shape: 'church_nave', door: 'door_plank' },
        mine: { wall: 'pit_prop', floor: 'mine_floor', window: null, trim: 'none', shape: 'mine_tunnel', door: 'door_plank' }, jail: { wall: 'adobe', floor: 'boardwalk', window: 'boarded', door: 'door_iron' }, house: { wall: 'adobe', window: 'shuttered' } } }),
    'cosmic-horror': S({ label: 'Older-than-stars masonry', wall: 'alien_stone', floor: 'ichor_floor', ceiling: 'obsidian', door: 'door_sigil', window: 'lancet', trim: 'none', shapes: ['mine_tunnel', 'church_nave'], street: 'drowned_lanes', props: ['g_eldritch_obelisk', 'g_tentacle_growth', 'g_ritual_circle'],
      corrupts: { pit_prop: 'polyp_prop', mine_floor: 'ichor_floor', timber_frame: 'alien_stone', clapboard: 'alien_stone', boardwalk: 'ichor_floor', deck_plank: 'ichor_floor', bulkhead: 'alien_stone', hull_plank: 'alien_stone', door_plank: 'door_sigil' } }),
    'sci-fi': S({ label: 'Station bulkheads', wall: 'bulkhead', floor: 'deck_grate', ceiling: 'metal', door: 'door_hatch', window: 'porthole', trim: 'hazard', shapes: ['corridor_grid', 'hall'], street: 'ring_corridor', props: ['g_console', 'g_cargo_pod', 'g_pipe_cluster'] }),
    cyberpunk: S({ label: 'Neon arcology', wall: 'neon_brick', floor: 'wet_asphalt', ceiling: 'metal', door: 'door_hatch', window: 'neon', trim: 'hazard', shapes: ['main_street', 'corridor_grid'], street: 'alley_grid', props: ['g_neon_sign', 'g_vending_machine', 'g_cable_bundle'] }),
    'post-apocalyptic': S({ label: 'Scrap shanty', wall: 'scrap_sheet', floor: 'cracked_tarmac', ceiling: 'metal', door: 'door_iron', window: 'boarded', trim: 'none', shapes: ['shanty_ring', 'hall'], street: 'shanty_ring', props: ['g_barrel_fire', 'g_scrap_heap', 'g_wreck_panel'] }),
    steampunk: S({ label: 'Brass and rivet foundry', wall: 'riveted_brass', floor: 'cog_tile', ceiling: 'metal', door: 'door_brass', window: 'porthole', trim: 'pipe', shapes: ['hall', 'corridor_grid'], street: 'canal_grid', props: ['g_boiler', 'g_gear_wheel', 'g_arc_lamp'] }),
    modern: S({ label: 'Concrete and storefront', wall: 'concrete_block', floor: 'linoleum', ceiling: 'stone', door: 'door_glass', window: 'blind', trim: 'baseboard', shapes: ['corridor_grid', 'storefront'], street: 'block_grid', props: ['g_street_lamp', 'g_vending_machine', 'g_bench'] }),
    nautical: S({ label: 'Ship hull and dock', wall: 'hull_plank', floor: 'deck_plank', ceiling: 'wood', door: 'door_plank', window: 'porthole', trim: 'rope', shapes: ['ship_deck', 'hall'], street: 'harbor_quay', props: ['g_ship_wheel', 'g_cannon', 'g_rope_coil'] }),
    noir: S({ label: 'Rain-dark offices', wall: 'damask_paper', floor: 'checker_tile', ceiling: 'stone', door: 'door_glass', window: 'blind', trim: 'baseboard', shapes: ['corridor_grid', 'storefront'], street: 'block_grid', props: ['g_hanging_bulb', 'g_blind_window'] })
  };
  const ZONE_WORDS = { mine: /\b(mine|mines|shaft|adit|tunnel|pit|drift|stope|dig|quarry|cave|cavern|deep)\b/i, church: /\b(church|chapel|bell|steeple|parish|shrine|temple|graveyard|cemetery|crypt)\b/i,
    street: /\b(street|main|road|square|plaza|avenue|lane|boardwalk|crossing|town|market|yard)\b/i, jail: /\b(jail|sheriff|marshal|lockup|cell)\b/i, house: /\b(house|home|cabin|shack|parlor|boarding)\b/i };
  const HORROR_WORDS = /\b(mine|shaft|pit|deep|church|chapel|bell|crypt|grave|cellar|cave|older|star|void|rift|altar)\b/gi;
  function zoneOf(name = '') { for (const [z, re] of Object.entries(ZONE_WORDS)) if (re.test(name)) return z; return 'interior'; }
  if (expanded && Expansion) {
    Object.assign(MAT, Expansion.MAT); Object.assign(WALL, Expansion.WALL); Object.assign(FLOOR, Expansion.FLOOR);
    for (const [genre, style] of Object.entries(Expansion.STYLES)) if (!STYLES[genre]) STYLES[genre] = style;
  }
  // Blend genre weights for one room: horror share grows near mine/church words and with depth below ground.
  function roomMix(mix, ctx = {}) {
    const hits = (String(ctx.name || '').match(HORROR_WORDS) || []).length, depth = Math.max(0, -(Number(ctx.z) || 0));
    let out = (mix || []).filter(x => STYLES[x.genre]).map(x => ({ ...x, weight: x.weight * (HORROR.includes(x.genre) ? 1 + 1.1 * hits + .6 * depth : 1) }));
    const t = out.reduce((a, x) => a + x.weight, 0) || 1; out = out.map(x => ({ ...x, weight: x.weight / t }));
    return { mix: out, horror: out.filter(x => HORROR.includes(x.genre)).reduce((a, x) => a + x.weight, 0) };
  }
  const draw = (mix, r) => { let v = r(); for (const x of mix) if ((v -= x.weight) <= 0) return x.genre; return mix[mix.length - 1]?.genre; };
  // style(): per-room building style. null => keep existing art (fantasy family / CotG / flag off decided by caller).
  function style(mix, ctx = {}) {
    const m = roomMix(mix, ctx); if (!m.mix.length) return null;
    // The building frame (walls, floor, ceiling, shape) follows the world's PRIMARY genre (unboosted weights), so a
    // western world stays a frontier town; the other genres add doors/windows/trim/props piece by piece and creep in as taint.
    const base = (mix || []).filter(x => STYLES[x.genre]).slice().sort((a, b) => b.weight - a.weight);
    const frameGenre = (base.find(x => !STYLES[x.genre].keep) || base[0]).genre, P = STYLES[frameGenre];
    if (P.keep) return null; // fantasy family only -> Ruined Temple stone stays
    const zone = zoneOf(ctx.name), r = rng(`${ctx.seed || ''}|${ctx.name || ''}|arch`), Z = P.zones?.[zone] || {};
    const own = f => Z[f] !== undefined ? Z[f] : P[f];
    const pick = { wall: own('wall'), floor: own('floor'), ceiling: own('ceiling') || null };
    for (const f of ['door', 'window', 'trim']) { const g = draw(m.mix, r), st = STYLES[g]; const v = st.keep ? undefined : (st.zones?.[zone]?.[f] !== undefined ? st.zones[zone][f] : st[f]); pick[f] = g === frameGenre || v === undefined || (HORROR.includes(g) && m.horror < .45) ? own(f) : v; } // horror pieces only where its share has grown
    // Horror corruption: past the threshold (deep mine, the church after dark) the frontier pieces themselves turn alien.
    const C = STYLES['cosmic-horror'].corrupts, hasCH = m.mix.some(x => x.genre === 'cosmic-horror') && frameGenre !== 'cosmic-horror';
    const corrupt = hasCH && m.horror > (zone === 'mine' ? .55 : .62);
    if (corrupt) for (const k of Object.keys(pick)) if (C[pick[k]]) pick[k] = C[pick[k]];
    const props = [...new Set(m.mix.flatMap(x => (STYLES[x.genre].props || []).slice(0, Math.max(1, Math.round(4 * x.weight)))))];
    const taint = !hasCH && frameGenre !== 'cosmic-horror' ? 0 : frameGenre === 'cosmic-horror' ? 1 : corrupt ? Math.min(1, m.horror) : +(m.horror * .5).toFixed(3);
    return { genre: frameGenre, zone, mix: m.mix, horror: +m.horror.toFixed(3), corrupt, label: P.label, ...pick, shape: Z.shape || P.shapes?.[0] || 'hall', street: P.street, props, taint };
  }
  // Taint overlay: cosmic-horror creeping onto any surface (veins, polyps, a single eye), density by share.
  function taint(P, r, amount) { if (!(amount > 0)) return; const n = Math.round(amount * 6);
    for (let k = 0; k < n; k++) { let x = r() * 32, y = r() * 32; for (let i = 0; i < 8; i++) { P.px(x, y, '#2f7a78'); x += Math.round(r() * 2 - 1); y += 1; } }
    if (amount > .45) { const x = r() * 28, y = r() * 28; P.rect(x, y, 3, 2, '#d8d4c0'); P.px(x + 1, y, '#0b1a1a'); P.px(x + 1, y + 1, '#6a4a8a'); } }
  // ---- room shapes -> IndoorBlueprint plans (fractions of the grid; existing carving + corridor repair do the rest) ----
  function roomPlan(shape, seed = '') {
    const r = rng(seed + '|shape'), j = (v, s = .03) => v + (r() - .5) * s;
    const P = (rooms, corridors = []) => ({ rooms, corridors, genreShape: shape });
    switch (shape) {
      case 'main_street': { const rooms = [{ x: .03, y: j(.42), w: .94, h: .16, shape: 'hall', role: 'courtyard', roofStyle: 'timber' }]; // the street
        for (let i = 0; i < 4; i++) { rooms.push({ x: .05 + i * .23, y: .12, w: .18, h: .24, shape: 'hall', role: 'chamber', roofStyle: 'pitched' }); rooms.push({ x: .05 + i * .23, y: .64, w: .18, h: .24, shape: 'hall', role: 'chamber', roofStyle: 'pitched' }); }
        return P(rooms, rooms.slice(1).map((_, i) => ({ fromRoom: i + 1, toRoom: 0, style: 'V', width: 2 }))); }
      case 'storefront': return P([{ x: .1, y: .3, w: .8, h: .45, shape: 'hall', role: 'entrance', roofStyle: 'timber' }, { x: .1, y: .08, w: .8, h: .14, shape: 'hall', role: 'courtyard' }, { x: .55, y: .78, w: .3, h: .16, shape: 'hall', role: 'chamber' }],
        [{ fromRoom: 1, toRoom: 0, style: 'V', width: 3 }, { fromRoom: 0, toRoom: 2, style: 'V', width: 1 }]);
      case 'church_nave': return P([{ x: .38, y: .1, w: .24, h: .78, shape: 'hall', role: 'hall', roofStyle: 'hammerbeam' }, { x: .18, y: .25, w: .64, h: .16, shape: 'hall', role: 'chapel', roofStyle: 'timber' }, { x: .42, y: .03, w: .16, h: .1, shape: 'round', role: 'sanctum' }],
        [{ fromRoom: 0, toRoom: 2, style: 'V', width: 2 }]);
      case 'mine_tunnel': { const rooms = []; let x = .08, y = j(.5, .2); for (let i = 0; i < 6; i++) { rooms.push({ x, y, w: .14, h: .14, shape: 'irregular', role: i ? 'chamber' : 'entrance', clearance: 3, floor: -i * .5 }); x += .14; y = Math.max(.08, Math.min(.78, y + (r() - .5) * .35)); }
        return P(rooms, rooms.slice(1).map((_, i) => ({ fromRoom: i, toRoom: i + 1, width: 1 }))); }
      case 'corridor_grid': { const rooms = [{ x: .03, y: .45, w: .94, h: .1, shape: 'hall', role: 'hall' }]; for (let i = 0; i < 3; i++) for (const yy of [.15, .62]) rooms.push({ x: .06 + i * .32, y: yy, w: .24, h: .22, shape: 'hall', role: 'chamber' });
        return P(rooms, rooms.slice(1).map((_, i) => ({ fromRoom: i + 1, toRoom: 0, style: 'V', width: 1 }))); }
      case 'ship_deck': return P([{ x: .2, y: .1, w: .6, h: .8, shape: 'round', role: 'hall' }, { x: .35, y: .05, w: .3, h: .12, shape: 'hall', role: 'chamber' }, { x: .35, y: .8, w: .3, h: .14, shape: 'hall', role: 'chamber' }]);
      case 'shanty_ring': { const rooms = [{ x: .35, y: .35, w: .3, h: .3, shape: 'round', role: 'courtyard' }]; for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; rooms.push({ x: .42 + .32 * Math.cos(a), y: .42 + .32 * Math.sin(a), w: .14, h: .14, shape: 'irregular', role: 'chamber' }); }
        return P(rooms.map(q => ({ ...q, x: Math.max(.02, Math.min(.84, q.x)), y: Math.max(.02, Math.min(.84, q.y)) })), rooms.slice(1).map((_, i) => ({ fromRoom: i + 1, toRoom: 0, width: 2 }))); }
      case 'temple_court': return P([{ x: .25, y: .25, w: .5, h: .5, shape: 'hall', role: 'courtyard' }, { x: .38, y: .05, w: .24, h: .18, shape: 'hall', role: 'sanctum' }]);
      default: return null;
    }
  }
  // Town / street layout rules (for the city map + preview): lot arrangement per genre style.
  const STREETS = { main_street: { axis: 'single', lots: 'false_front_row', both: true, anchor: ['church', 'mine'] }, winding_lanes: { axis: 'organic', lots: 'clustered' }, agora_grid: { axis: 'grid', lots: 'colonnade', plaza: true },
    drowned_lanes: { axis: 'organic', lots: 'leaning', fog: true }, ring_corridor: { axis: 'ring', lots: 'module' }, alley_grid: { axis: 'grid', lots: 'stacked', narrow: true }, shanty_ring: { axis: 'ring', lots: 'scrap_huts' },
    canal_grid: { axis: 'grid', lots: 'terrace', canal: true }, block_grid: { axis: 'grid', lots: 'storefront' }, harbor_quay: { axis: 'single', lots: 'warehouse', water: true } };
  function streetPlan(styleName, seed = '', size = 24) { // returns a char grid: '=' street, '#' building, '+' door, '~' water, 'C' church, 'M' mine, '.' open
    const rule = STREETS[styleName] || STREETS.winding_lanes, r = rng(seed + '|street'), g = Array.from({ length: size }, () => Array(size).fill('.')), mid = size >> 1;
    const lot = (x, y, w, h, ch = '#') => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j]?.[i] !== undefined) g[j][i] = ch; };
    if (rule.axis === 'single') { for (let x = 0; x < size; x++) { g[mid][x] = '='; g[mid + 1][x] = '='; } for (let x = 2; x < size - 3; x += 4) { lot(x, mid - 4, 3, 3); g[mid - 1][x + 1] = '+'; if (rule.both) { lot(x, mid + 3, 3, 3); g[mid + 2][x + 1] = '+'; } }
      if (rule.anchor) { lot(0, mid - 3, 2, 6, 'C'); lot(size - 2, mid - 3, 2, 6, 'M'); } if (rule.water) for (let x = 0; x < size; x++) g[size - 1][x] = g[size - 2][x] = '~'; }
    else if (rule.axis === 'grid') { for (let i = 0; i < size; i += 6) for (let k = 0; k < size; k++) { g[i][k] = '='; g[k][i] = '='; } for (let y = 1; y < size; y += 6) for (let x = 1; x < size; x += 6) { lot(x + 1, y + 1, 3, 3); g[y][x + 2] = '+'; } if (rule.canal) for (let k = 0; k < size; k++) g[mid][k] = '~'; }
    else if (rule.axis === 'ring') { for (let a = 0; a < 6.28; a += .05) g[Math.round(mid + 8 * Math.sin(a))][Math.round(mid + 8 * Math.cos(a))] = '='; for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; lot(Math.round(mid + 10 * Math.cos(a)) - 1, Math.round(mid + 10 * Math.sin(a)) - 1, 2, 2); } }
    else { let x = 0, y = mid; while (x < size) { g[y][x] = '='; if (r() < .3) y = Math.max(1, Math.min(size - 2, y + (r() < .5 ? -1 : 1))); else x++; } for (let k = 0; k < 8; k++) lot(Math.floor(r() * (size - 3)), Math.floor(r() * (size - 3)), 3, 2); }
    return { rule, rows: g.map(row => row.join('')) };
  }
  // ---- character garb (c64 trait sprites): per-genre clothing / silhouettes / gear layered after the body ----
  const GARB = {
    western: [{ hat: 'wide_brim', coat: 'duster', belt: 'gunbelt' }, { hat: 'wide_brim', coat: 'vest', belt: 'gunbelt', extra: 'bandana' }, { hat: 'miner', coat: 'none', belt: 'tool', extra: 'lamp' }, { hat: 'flat', coat: 'poncho', belt: 'bandolier' }],
    'cosmic-horror': [{ hat: 'hood', coat: 'robe_hem', extra: 'eye' }, { hat: 'flat', coat: 'trench', extra: 'tendrils' }],
    'sci-fi': [{ hat: 'visor', coat: 'suit_stripe', belt: 'tool' }, { hat: 'helmet', coat: 'suit_stripe', extra: 'pack' }],
    cyberpunk: [{ hat: 'visor', coat: 'trench', extra: 'neon' }, { hat: 'none', coat: 'jacket', extra: 'neon' }],
    'post-apocalyptic': [{ hat: 'gasmask', coat: 'poncho', belt: 'bandolier' }, { hat: 'goggles', coat: 'duster', belt: 'tool' }],
    steampunk: [{ hat: 'top', coat: 'greatcoat', extra: 'goggles' }, { hat: 'goggles', coat: 'vest', belt: 'tool' }],
    modern: [{ hat: 'cap', coat: 'jacket' }, { hat: 'none', coat: 'jacket', belt: 'tool' }],
    nautical: [{ hat: 'tricorn', coat: 'greatcoat', belt: 'sash' }, { hat: 'bandana', coat: 'vest', belt: 'sash' }],
    noir: [{ hat: 'fedora', coat: 'trench' }, { hat: 'fedora', coat: 'vest' }],
    mythic: [{ hat: 'laurel', coat: 'chiton' }], fantasy: [], 'dark-fantasy': []
  };
  if (expanded && Expansion) for (const [genre, list] of Object.entries(Expansion.GARB)) GARB[genre] = [...(GARB[genre] || []), ...list];
  function garbFor(mix, seed = 0) { const m = (mix || []).filter(x => GARB[x.genre]); if (!m.length) return null; const r = rng('garb|' + seed), g = draw(m, r), list = GARB[g];
    if (!list?.length) return null; const horror = m.filter(x => HORROR.includes(x.genre)).reduce((a, x) => a + x.weight, 0), base = { ...list[Math.floor(r() * list.length)], genre: g };
    if (g !== 'cosmic-horror' && horror > 0 && r() < horror * 1.2) base.wrong = r() < .5 ? 'eye' : 'tendrils'; // a few townsfolk look slightly wrong
    return base; }
  // ctx: { grid (cells), rect(x,y,w,h,color) in cells, filled(x,y) }, pal: c64 palette
  function drawGarb(k, garb, pal) {
    if (!garb || !k) return false; const { grid, rect, filled } = k; let top = -1, bot = -1, L = grid, R = -1;
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) if (filled(x, y)) { if (top < 0) top = y; bot = y; }
    if (top < 0) return false; const H = bot - top + 1; if (H < 10) return false;
    const span = y => { let a = grid, b = -1; for (let x = 0; x < grid; x++) if (filled(x, y)) { a = Math.min(a, x); b = x; } return [a, b]; };
    // Head span over its first rows (the crown row alone is narrow at 24 cells); hats sit ON the head, not above it,
    // so they never clip at the canvas top.
    let hl = grid, hr = -1; for (let y = top; y < top + 4; y++) { const [a, b] = span(y); if (b >= 0) { hl = Math.min(hl, a); hr = Math.max(hr, b); } }
    const headRow = top + 2, hipY = top + Math.round(H * .55), [tl, tr] = span(hipY - 2), [bl, br] = span(hipY);
    const dark = mix(pal.outfit2 || '#3a2a1a', '#000000', .35), leather = '#5a3a20', brass = pal.trim || '#c9a64a', cloth = pal.outfit || '#6a5a4a', metal = pal.metal || '#9aa3ad';
    const hw = Math.max(3, hr - hl + 1), ct = Math.max(0, top - 1); // crown top
    switch (garb.hat) {
      case 'wide_brim': rect(hl - 2, top + 1, hw + 4, 1, dark); rect(hl, ct, hw, top + 1 - ct, dark); rect(hl, top, hw, 1, mix(dark, brass, .35)); break;
      case 'miner': rect(hl - 1, top + 1, hw + 2, 1, '#7a6a3a'); rect(hl, ct, hw, top + 1 - ct, '#9a8a4a'); break;
      case 'flat': rect(hl - 1, top + 1, hw + 2, 1, dark); rect(hl, ct, hw, top + 1 - ct, dark); break;
      case 'top': rect(hl - 1, top + 1, hw + 2, 1, dark); rect(hl, 0, hw, top + 1, dark); rect(hl, top, hw, 1, brass); break;
      case 'tricorn': rect(hl - 2, top + 1, hw + 4, 1, dark); rect(hl - 1, ct, hw + 2, top + 1 - ct, dark); rect(hl - 2, top, 1, 1, brass); rect(hr + 2, top, 1, 1, brass); break;
      case 'fedora': rect(hl - 1, top + 1, hw + 2, 1, dark); rect(hl, ct, hw, top + 1 - ct, dark); rect(hl, top, hw, 1, '#2a1a10'); break;
      case 'cap': rect(hl, ct, hw, top + 1 - ct, cloth); rect(hr, top + 1, 2, 1, cloth); break;
      case 'bandana': rect(hl, ct, hw, top + 1 - ct, '#a83a22'); rect(hl - 1, top + 1, 1, 2, '#a83a22'); break;
      case 'visor': rect(hl, headRow, hw, 1, '#90d0ff'); rect(hr, headRow, 1, 1, '#e8f4ff'); break;
      case 'helmet': rect(hl - 1, ct, hw + 2, top + 2 - ct, metal); rect(hl, headRow, hw, 1, '#90d0ff'); break;
      case 'gasmask': rect(hl + 1, headRow + 1, hw - 1, 2, '#3a3a34'); rect(hr, headRow + 2, 2, 2, '#545a61'); break;
      case 'goggles': rect(hl, headRow, hw, 1, leather); rect(hr - 1, headRow, 2, 1, '#e0b060'); break;
      case 'hood': rect(hl - 1, ct, hw + 2, top + 2 - ct, dark); rect(hl - 1, top, 1, 4, dark); break;
      case 'laurel': for (let x = hl; x < hl + hw; x += 2) rect(x, top, 1, 1, '#6a8a42'); break;
      case 'sunhat': rect(hl - 2, top + 1, hw + 4, 1, '#d6bd79'); rect(hl, ct, hw, 2, '#e7d7a7'); break;
      case 'turban': rect(hl - 1, ct, hw + 2, 3, cloth); rect(hl, top + 1, hw, 1, brass); rect(hr + 1, headRow, 1, 4, cloth); break;
      case 'feather': rect(hl, top, hw, 1, leather); for (let i = 0; i < 4; i++) rect(hr - 1, Math.max(0, top - i), 1, 1, i % 2 ? brass : '#b7583d'); break;
      case 'bubble': rect(hl - 2, ct, hw + 4, 1, '#7ac6d0'); rect(hl - 2, top, 1, 5, '#7ac6d0'); rect(hr + 2, top, 1, 5, '#d2eee5'); rect(hl - 1, top + 4, hw + 2, 1, metal); break;
    }
    const tw = Math.max(3, tr - tl + 1), legTop = hipY + 1;
    switch (garb.coat) {
      case 'duster': case 'trench': case 'greatcoat': { const col = garb.coat === 'duster' ? '#8a6a48' : garb.coat === 'trench' ? '#7a6a52' : '#3a3a52'; for (let y = hipY - 1; y < Math.min(bot - 1, legTop + Math.round(H * .3)); y++) { const f = Math.floor((y - legTop) / 3) + 1; rect(bl - f, y, f, 1, col); rect(br + 1, y, f, 1, mix(col, '#000000', .25)); }
        rect(tl - 1, hipY - Math.round(H * .25), 1, Math.round(H * .25), col); rect(tr + 1, hipY - Math.round(H * .25), 1, Math.round(H * .25), mix(col, '#000000', .3)); break; }
      case 'poncho': for (let i = 0; i < 4; i++) rect(tl - i, hipY - 6 + i, tw + 2 * i, 1, i % 2 ? '#a83a22' : '#d9a86a'); break;
      case 'vest': rect(tl, hipY - 5, 1, 4, leather); rect(tr, hipY - 5, 1, 4, leather); break;
      case 'robe_hem': for (let x = bl - 1; x <= br + 1; x++) if (x % 2) rect(x, bot - 2, 1, 1, dark); break;
      case 'suit_stripe': rect(tl, hipY - 5, tw, 1, '#e0542a'); break;
      case 'jacket': rect(tl, hipY - 6, 1, 6, dark); rect(tr, hipY - 6, 1, 6, dark); rect(tl + 1, hipY - 6, 1, 1, metal); break;
      case 'chiton': rect(tl, hipY - 6, tw, 1, '#f1e7d0'); for (let y = hipY - 6; y < hipY; y += 2) rect(tl + (y % 3), y, 1, 1, '#c9b48e'); break;
    }
    switch (garb.belt) {
      case 'gunbelt': rect(tl, hipY - 1, tw, 1, leather); for (let x = tl; x < tl + tw; x += 2) rect(x, hipY - 1, 1, 1, brass); rect(tr, hipY, 2, 3, '#3a2616'); rect(tr + 1, hipY - 1, 1, 1, metal); break;
      case 'tool': rect(tl, hipY - 1, tw, 1, leather); rect(tl, hipY, 1, 2, metal); break;
      case 'bandolier': for (let i = 0; i < Math.min(tw, 6); i++) rect(tl + i, hipY - 7 + i, 1, 1, i % 2 ? brass : leather); break;
      case 'sash': rect(tl, hipY - 1, tw, 1, '#a83a22'); rect(tl, hipY, 1, 3, '#a83a22'); break;
    }
    const wrong = garb.extra === 'eye' || garb.extra === 'tendrils' ? garb.extra : garb.wrong;
    if (garb.extra === 'lamp') { rect(hr, top - 1, 1, 1, '#ffe8a0'); rect(hr + 1, top - 1, 1, 1, '#f0dca0'); }
    if (garb.extra === 'bandana') rect(hl + 1, headRow + 3, hw - 1, 1, '#a83a22');
    if (garb.extra === 'neon') { rect(tl, hipY - 4, tw, 1, '#e8c8f0'); rect(hl - 1, headRow + 1, 1, 1, '#90d0ff'); }
    if (garb.extra === 'pack' || garb.extra === 'goggles') rect(tl - 2, hipY - 6, 2, 4, garb.extra === 'pack' ? metal : leather);
    if (wrong === 'eye') { rect(tl + (tw >> 1), hipY - 4, 1, 1, '#d8d4c0'); rect(tl + (tw >> 1) + 1, hipY - 4, 1, 1, '#6a4a8a'); }
    if (wrong === 'tendrils') for (let x = bl; x <= br; x += 2) rect(x, bot - 1 - (x % 3 === 0 ? 1 : 0), 1, 1, '#2f7a78');
    return true;
  }
  return { MAT, WALL, FLOOR, WINDOW, TRIM, STYLES, STREETS, GARB, HORROR, zoneOf, roomMix, style, taint, roomPlan, streetPlan, garbFor, drawGarb, rng };
});
