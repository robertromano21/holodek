(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.GenreWardrobe = api;
})(typeof window === 'object' ? window : globalThis, function(root) {
  'use strict';
  // Genre wardrobe: every garb piece (headwear, hair pieces, coats/robes/armor, cloaks, belts, accessories) carries the
  // list of genres it belongs to. Selection and rendering both filter by the current world:
  //  - the built-in campaign (no homebrew bible) only ever shows fantasy-family pieces;
  //  - a homebrew world only shows pieces tagged for its genres;
  //  - a stored garb from another world (old cache / old save) is dropped or trimmed, never drawn out of genre.
  // The base procedural outfit (robe / plate / leather / rags...) is always the in-genre fallback when garb is removed.
  const COTG = ['fantasy', 'dark-fantasy', 'mythic'];
  const SLOTS = ['hat', 'hair', 'coat', 'cloak', 'belt', 'extra', 'wrong'];
  const F = ['fantasy'], DF = ['dark-fantasy'], MY = ['mythic'];
  const FANTASY = ['fantasy', 'dark-fantasy', 'mythic', 'desert-fantasy'];
  const HORROR = ['dark-fantasy', 'gothic-horror', 'cosmic-horror'];
  const SPIRIT = ['fantasy', 'dark-fantasy', 'mythic', 'desert-fantasy', 'gothic-horror', 'cosmic-horror'];
  const TECH = ['sci-fi', 'cyberpunk'];
  const uniq = a => [...new Set(a)];

  // ---- tags for the garb pieces that already existed (drawn by GenreArchitecture.drawGarb's own switch) ----
  const LEGACY = {
    hat: { wide_brim: ['western'], miner: ['western', 'dieselpunk'], flat: ['western', 'cosmic-horror', 'post-apocalyptic', 'noir'], top: ['steampunk', 'gothic-horror', 'noir'],
      tricorn: ['nautical'], fedora: ['noir', 'dieselpunk', 'cosmic-horror'], cap: ['modern', 'dieselpunk', 'solarpunk'], bandana: ['nautical', 'western', 'post-apocalyptic'],
      visor: TECH, helmet: ['sci-fi', 'cyberpunk', 'underwater'], gasmask: ['post-apocalyptic', 'dieselpunk'], goggles: ['steampunk', 'post-apocalyptic', 'dieselpunk'],
      hood: uniq([...FANTASY, ...HORROR, 'post-apocalyptic', 'cyberpunk']), laurel: MY, sunhat: ['solarpunk', 'western'], turban: ['desert-fantasy'], feather: ['prehistoric'], bubble: ['underwater'] },
    coat: { duster: ['western', 'post-apocalyptic'], trench: ['noir', 'cyberpunk', 'cosmic-horror', 'dieselpunk'], greatcoat: ['steampunk', 'nautical', 'gothic-horror', 'dieselpunk'],
      poncho: ['western', 'post-apocalyptic', 'prehistoric'], vest: ['western', 'noir', 'steampunk', 'nautical', 'fantasy', 'dark-fantasy'], robe_hem: uniq([...FANTASY, ...HORROR]),
      suit_stripe: ['sci-fi', 'underwater'], jacket: ['modern', 'cyberpunk', 'solarpunk'], chiton: MY },
    belt: { gunbelt: ['western'], tool: null, bandolier: ['western', 'post-apocalyptic'], sash: ['nautical', 'desert-fantasy', 'fantasy', 'mythic'] },
    extra: { lamp: ['western', 'dieselpunk'], bandana: ['western', 'post-apocalyptic'], neon: ['cyberpunk'], pack: ['sci-fi', 'underwater'], goggles: ['steampunk', 'dieselpunk'],
      eye: ['cosmic-horror', 'dark-fantasy', 'gothic-horror'], tendrils: ['cosmic-horror'] },
    wrong: { eye: null, tendrils: null } // horror taint layer: only ever stamped when a horror genre is in the world mix
  };

  // ---- new pieces. draw(A, r): A = anchors measured on the drawn body, r(x, y, w, h, colour) paints native cells. ----
  // A: hl/hr/hw head span, top/ct crown rows, headRow eye row, tl/tr/tw torso span, hipY, bl/br leg span, bot feet row, H height,
  //    plus colours dark/leather/brass/cloth/metal/pale/glow and mix(a, b, t).
  const P = {};
  const def = (slot, id, genres, draw, extra = {}) => { P[`${slot}:${id}`] = { slot, id, genres, draw, ...extra }; };
  const cone = (A, r, c, n = 4) => { for (let i = 0; i < n; i++) r(A.hl + i, A.top - i, Math.max(1, A.hw - i * 2), 1, c); };
  // headwear
  def('hat', 'circlet', ['fantasy', 'mythic', 'desert-fantasy'], (A, r) => { r(A.hl, A.top + 1, A.hw, 1, A.brass); r(A.hl + (A.hw >> 1), A.top + 1, 1, 1, A.glow); });
  def('hat', 'wizard_peak', F, (A, r) => { r(A.hl - 2, A.top + 1, A.hw + 4, 1, A.cloth); cone(A, r, A.cloth, 5); r(A.hl + (A.hw >> 1), A.top - 4, 1, 1, A.brass); });
  def('hat', 'kettle_helm', ['fantasy', 'dark-fantasy'], (A, r) => { r(A.hl - 1, A.ct, A.hw + 2, A.top + 2 - A.ct, A.metal); r(A.hl - 2, A.top + 1, A.hw + 4, 1, A.metal); });
  def('hat', 'horned_helm', ['fantasy', 'dark-fantasy', 'prehistoric'], (A, r) => { r(A.hl, A.ct, A.hw, A.top + 2 - A.ct, A.metal); r(A.hl - 1, A.top - 1, 1, 2, A.pale); r(A.hr + 1, A.top - 1, 1, 2, A.pale); });
  def('hat', 'spiked_crown', ['fantasy', 'dark-fantasy', 'mythic'], (A, r) => { r(A.hl, A.top + 1, A.hw, 1, A.brass); for (let x = A.hl; x < A.hl + A.hw; x += 2) r(x, A.top, 1, 1, A.brass); });
  def('hat', 'deep_cowl', ['fantasy', 'dark-fantasy', 'gothic-horror', 'desert-fantasy'], (A, r) => { r(A.hl - 1, A.ct, A.hw + 2, A.top + 3 - A.ct, A.dark); r(A.hl - 1, A.top, 1, 5, A.dark); r(A.hr + 1, A.top, 1, 5, A.dark); });
  def('hat', 'veil', ['desert-fantasy', 'dark-fantasy', 'gothic-horror', 'cosmic-horror'], (A, r) => r(A.hl, A.headRow + 1, A.hw, 2, A.cloth));
  def('hat', 'feathered_cap', ['fantasy', 'nautical'], (A, r) => { r(A.hl, A.ct, A.hw, A.top + 1 - A.ct, A.cloth); r(A.hr, A.top - 2, 1, 3, A.pale); });
  def('hat', 'antler_headdress', ['prehistoric', 'dark-fantasy', 'fantasy'], (A, r) => { r(A.hl, A.top + 1, A.hw, 1, A.leather); r(A.hl - 1, A.top - 2, 1, 3, A.pale); r(A.hr + 1, A.top - 2, 1, 3, A.pale); r(A.hl - 2, A.top - 2, 1, 1, A.pale); r(A.hr + 2, A.top - 2, 1, 1, A.pale); });
  def('hat', 'bone_crown', ['dark-fantasy', 'gothic-horror'], (A, r) => { r(A.hl, A.top + 1, A.hw, 1, A.pale); for (let x = A.hl; x < A.hl + A.hw; x += 2) r(x, A.top - 1, 1, 2, A.pale); }, { spirit: true });
  def('hat', 'wraith_halo', SPIRIT, (A, r) => { r(A.hl, Math.max(0, A.top - 2), A.hw, 1, A.glow); }, { spirit: true });
  def('hat', 'crested_helm', MY, (A, r) => { r(A.hl - 1, A.ct, A.hw + 2, A.top + 2 - A.ct, A.brass); r(A.hl, A.top - 2, A.hw, 2, '#a83a22'); });
  def('hat', 'headscarf', ['desert-fantasy', 'post-apocalyptic', 'western'], (A, r) => { r(A.hl, A.ct, A.hw, A.top + 2 - A.ct, A.cloth); r(A.hr + 1, A.headRow, 1, 3, A.cloth); });
  def('hat', 'straw_hat', ['solarpunk', 'western', 'fantasy', 'prehistoric'], (A, r) => { r(A.hl - 2, A.top + 1, A.hw + 4, 1, '#d6bd79'); r(A.hl, A.ct, A.hw, A.top + 1 - A.ct, '#c8a860'); });
  def('hat', 'bowler', ['noir', 'steampunk', 'dieselpunk'], (A, r) => { r(A.hl - 1, A.top + 1, A.hw + 2, 1, A.dark); r(A.hl, A.ct, A.hw, A.top + 1 - A.ct, A.dark); });
  def('hat', 'beret', ['modern', 'dieselpunk', 'noir'], (A, r) => { r(A.hl - 1, A.top, A.hw + 1, 2, A.cloth); });
  def('hat', 'pilot_cap', ['dieselpunk', 'steampunk'], (A, r) => { r(A.hl, A.ct, A.hw, A.top + 2 - A.ct, A.leather); r(A.hl, A.headRow, A.hw, 1, '#e0b060'); });
  def('hat', 'hard_hat', ['modern', 'dieselpunk'], (A, r) => { r(A.hl - 1, A.ct, A.hw + 2, A.top + 2 - A.ct, '#e0b030'); });
  def('hat', 'headset', ['sci-fi', 'cyberpunk', 'modern'], (A, r) => { r(A.hl - 1, A.headRow, 1, 2, A.metal); r(A.hl - 1, A.top, A.hw + 2, 1, A.metal); r(A.hl, A.headRow + 2, 2, 1, A.glow); });
  def('hat', 'respirator', ['cyberpunk', 'sci-fi', 'dieselpunk', 'post-apocalyptic'], (A, r) => { r(A.hl + 1, A.headRow + 2, A.hw - 2, 2, A.metal); r(A.hl, A.headRow + 3, 1, 1, A.dark); });
  def('hat', 'diving_helm', ['underwater', 'steampunk'], (A, r) => { r(A.hl - 1, A.ct, A.hw + 2, A.headRow + 3 - A.ct, A.brass); r(A.hl, A.headRow, A.hw, 2, '#7ac6d0'); });
  def('hat', 'glow_visor', ['cyberpunk'], (A, r) => { r(A.hl, A.headRow, A.hw, 1, '#e8c8f0'); r(A.hl - 1, A.headRow, 1, 1, '#90d0ff'); });
  def('hat', 'dome_helmet', ['sci-fi'], (A, r) => { r(A.hl - 2, A.ct, A.hw + 4, 1, '#c0ccd8'); r(A.hl - 2, A.top, 1, 5, '#c0ccd8'); r(A.hr + 2, A.top, 1, 5, '#e8f4ff'); });
  def('hat', 'tribal_mask', ['prehistoric'], (A, r) => { r(A.hl, A.headRow - 1, A.hw, 3, '#b7583d'); r(A.hl + 1, A.headRow, 1, 1, A.dark); r(A.hr - 1, A.headRow, 1, 1, A.dark); });
  def('hat', 'beaked_mask', ['gothic-horror', 'dark-fantasy'], (A, r) => { r(A.hl, A.headRow, A.hw, 2, A.leather); r(A.hr + 1, A.headRow + 1, 2, 1, A.leather); r(A.hl + 1, A.headRow, 1, 1, '#d8d4c0'); });
  def('hat', 'jester_cap', F, (A, r) => { r(A.hl, A.ct, A.hw, A.top + 1 - A.ct, '#a83a22'); r(A.hl - 2, A.top - 1, 2, 1, '#2a4ea0'); r(A.hr + 1, A.top - 1, 2, 1, '#2a4ea0'); r(A.hl - 2, A.top, 1, 1, A.brass); r(A.hr + 2, A.top, 1, 1, A.brass); });
  def('hat', 'wimple', ['gothic-horror', 'dark-fantasy'], (A, r) => { r(A.hl - 1, A.ct, A.hw + 2, A.top + 2 - A.ct, A.pale); r(A.hl - 1, A.top + 2, 1, 4, A.dark); r(A.hr + 1, A.top + 2, 1, 4, A.dark); });
  def('hat', 'kelp_crown', ['underwater'], (A, r) => { for (let x = A.hl; x < A.hl + A.hw; x += 2) r(x, A.top - 1, 1, 2, '#4f8a6a'); });
  def('hat', 'flower_crown', ['solarpunk', 'fantasy'], (A, r) => { r(A.hl, A.top + 1, A.hw, 1, '#6a8a42'); for (let x = A.hl; x < A.hl + A.hw; x += 2) r(x, A.top, 1, 1, '#e86aa0'); });
  // hair pieces (layered over the trait hair; they never replace it)
  def('hair', 'long_braids', ['fantasy', 'prehistoric', 'mythic', 'western'], (A, r) => { r(A.hl - 1, A.headRow, 1, 6, A.hairC); r(A.hr + 1, A.headRow, 1, 6, A.hairC); });
  def('hair', 'topknot_tie', ['fantasy', 'desert-fantasy', 'mythic'], (A, r) => { r(A.hl + (A.hw >> 1) - 1, Math.max(0, A.top - 2), 2, 2, A.hairC); r(A.hl + (A.hw >> 1) - 1, A.top, 2, 1, A.brass); });
  def('hair', 'wild_mane', ['prehistoric', 'post-apocalyptic', 'dark-fantasy'], (A, r) => { r(A.hl - 2, A.top, A.hw + 4, 2, A.hairC); r(A.hl - 2, A.top + 2, 1, 4, A.hairC); r(A.hr + 2, A.top + 2, 1, 4, A.hairC); });
  def('hair', 'shaved_sides', ['cyberpunk', 'post-apocalyptic', 'modern'], (A, r) => { r(A.hl + 1, Math.max(0, A.top - 1), A.hw - 2, 2, A.hairC); });
  def('hair', 'powdered_wig', ['steampunk', 'nautical'], (A, r) => { r(A.hl - 1, A.top, A.hw + 2, 2, '#e6e3dc'); r(A.hl - 1, A.headRow, 1, 3, '#e6e3dc'); r(A.hr + 1, A.headRow, 1, 3, '#e6e3dc'); });
  def('hair', 'locks', ['solarpunk', 'post-apocalyptic', 'prehistoric'], (A, r) => { for (let x = A.hl - 1; x <= A.hr + 1; x += 2) r(x, A.top + 1, 1, 5, A.hairC); });
  def('hair', 'drifting_strands', SPIRIT, (A, r) => { for (let x = A.hl - 1; x <= A.hr + 1; x += 3) r(x, A.top + 1, 1, 7, A.glow); }, { spirit: true });
  // body garments, robes and armour
  const torso = (A, r, c, top = 6) => r(A.tl, A.hipY - top, A.tw, top, c);
  const hem = (A, r, c, len = 4, step = 1) => { for (let x = A.bl - 1; x <= A.br + 1; x += step) r(x, A.hipY, 1, Math.min(len, Math.max(1, A.bot - A.hipY - 1)), c); };
  const tatter = (A, r, c) => { for (let x = A.bl - 1; x <= A.br + 1; x++) r(x, A.hipY, 1, Math.max(1, Math.min(A.bot - A.hipY - 1, 2 + ((x * 7) % 4))), c); };
  def('coat', 'tabard', ['fantasy', 'mythic', 'dark-fantasy'], (A, r) => { const w = Math.max(2, A.tw / 3 | 0), x = A.tl + ((A.tw - w) >> 1); r(x, A.hipY - 6, w, Math.min(A.bot - A.hipY + 3, 10), A.cloth); r(x, A.hipY - 6, w, 1, A.brass); });
  def('coat', 'crossed_surcoat', F, (A, r) => { torso(A, r, A.pale, 6); const cx = A.tl + (A.tw >> 1); r(cx, A.hipY - 6, 1, 6, '#a83a22'); r(A.tl, A.hipY - 4, A.tw, 1, '#a83a22'); });
  def('coat', 'chainmail', ['fantasy', 'dark-fantasy', 'mythic'], (A, r) => { for (let y = A.hipY - 6; y < A.hipY + 1; y++) for (let x = A.tl; x < A.tl + A.tw; x++) if ((x + y) % 2) r(x, y, 1, 1, A.metal); });
  def('coat', 'breastplate', ['fantasy', 'dark-fantasy', 'mythic'], (A, r) => { torso(A, r, A.metal, 5); r(A.tl + 1, A.hipY - 5, 1, 4, A.pale); });
  def('coat', 'brigandine', ['fantasy', 'dark-fantasy'], (A, r) => { torso(A, r, A.leather, 6); for (let y = A.hipY - 5; y < A.hipY; y += 2) for (let x = A.tl + 1; x < A.tl + A.tw - 1; x += 2) r(x, y, 1, 1, A.brass); });
  def('coat', 'leather_jerkin', ['fantasy', 'western', 'post-apocalyptic', 'prehistoric'], (A, r) => { torso(A, r, A.leather, 6); r(A.tl + (A.tw >> 1), A.hipY - 6, 1, 3, A.dark); });
  def('coat', 'starry_robe', F, (A, r) => { torso(A, r, A.cloth, 6); hem(A, r, A.cloth, 6); for (let i = 0; i < 4; i++) r(A.tl + (i * 3) % Math.max(1, A.tw), A.hipY - 5 + i * 2, 1, 1, A.glow); });
  def('coat', 'monk_robe', ['fantasy', 'desert-fantasy', 'mythic'], (A, r) => { torso(A, r, '#8a6a48', 6); hem(A, r, '#8a6a48', 5); r(A.tl, A.hipY - 1, A.tw, 1, A.leather); });
  def('coat', 'burial_wraps', ['dark-fantasy', 'gothic-horror', 'desert-fantasy'], (A, r) => { for (let y = A.hipY - 6; y < A.bot - 1; y += 2) r(A.bl - 1, y, Math.max(A.tw, A.br - A.bl + 3), 1, '#d6c8a0'); }, { spirit: true });
  def('coat', 'grave_shroud', SPIRIT, (A, r) => { torso(A, r, A.pale, 7); tatter(A, r, A.pale); }, { spirit: true });
  def('coat', 'spectral_tatters', SPIRIT, (A, r) => { tatter(A, r, A.glow); r(A.tl - 1, A.hipY - 6, 1, 6, A.glow); r(A.tr + 1, A.hipY - 6, 1, 6, A.glow); }, { spirit: true });
  def('coat', 'toga', MY, (A, r) => { torso(A, r, '#f1e7d0', 6); for (let i = 0; i < Math.min(A.tw, 6); i++) r(A.tl + i, A.hipY - 6 + i, 1, 1, '#c9b48e'); hem(A, r, '#f1e7d0', 3); });
  def('coat', 'lamellar', ['mythic', 'desert-fantasy'], (A, r) => { for (let y = A.hipY - 6; y < A.hipY + 2; y += 2) r(A.tl, y, A.tw, 1, A.brass); });
  def('coat', 'fur_mantle', ['prehistoric', 'fantasy', 'dark-fantasy'], (A, r) => { r(A.tl - 1, A.hipY - 7, A.tw + 2, 2, '#8a6a48'); for (let x = A.tl - 1; x < A.tl + A.tw + 1; x += 2) r(x, A.hipY - 5, 1, 1, '#6e4e30'); });
  def('coat', 'hide_wrap', ['prehistoric'], (A, r) => { r(A.tl, A.hipY - 3, A.tw, 4, '#a07a52'); for (let x = A.tl; x < A.tl + A.tw; x += 2) r(x, A.hipY + 1, 1, 1, '#6e4e30'); });
  def('coat', 'laced_corset', ['gothic-horror', 'steampunk', 'dark-fantasy'], (A, r) => { r(A.tl, A.hipY - 5, A.tw, 4, A.dark); for (let y = A.hipY - 5; y < A.hipY - 1; y++) r(A.tl + (A.tw >> 1), y, 1, 1, A.pale); });
  def('coat', 'frock_coat', ['steampunk', 'gothic-horror', 'nautical'], (A, r) => { torso(A, r, A.dark, 6); r(A.bl - 1, A.hipY, 1, 4, A.dark); r(A.br + 1, A.hipY, 1, 4, A.dark); r(A.tl + 1, A.hipY - 6, 1, 1, A.brass); });
  def('coat', 'naval_jacket', ['nautical'], (A, r) => { torso(A, r, '#2a4ea0', 6); for (let y = A.hipY - 5; y < A.hipY; y += 2) r(A.tl + (A.tw >> 1), y, 1, 1, A.brass); r(A.tl - 1, A.hipY - 6, 1, 1, A.brass); r(A.tr + 1, A.hipY - 6, 1, 1, A.brass); });
  def('coat', 'flight_jacket', ['dieselpunk', 'modern'], (A, r) => { torso(A, r, '#6a4418', 6); r(A.tl, A.hipY - 6, A.tw, 1, '#d8ccb0'); });
  def('coat', 'hoodie', ['modern', 'cyberpunk'], (A, r) => { torso(A, r, A.cloth, 6); r(A.tl + 1, A.hipY - 3, A.tw - 2, 1, A.dark); });
  def('coat', 'tactical_vest', ['modern', 'cyberpunk', 'post-apocalyptic', 'sci-fi'], (A, r) => { r(A.tl, A.hipY - 6, A.tw, 5, '#3a4038'); r(A.tl + 1, A.hipY - 4, 1, 2, A.dark); r(A.tr - 1, A.hipY - 4, 1, 2, A.dark); });
  def('coat', 'exo_frame', TECH, (A, r) => { r(A.tl - 1, A.hipY - 6, 1, 8, A.metal); r(A.tr + 1, A.hipY - 6, 1, 8, A.metal); r(A.tl, A.hipY - 6, A.tw, 1, A.metal); r(A.tl + (A.tw >> 1), A.hipY - 4, 1, 1, A.glow); });
  def('coat', 'pressure_suit', ['underwater', 'sci-fi'], (A, r) => { torso(A, r, '#d8ccb0', 6); r(A.tl, A.hipY - 3, A.tw, 1, '#e0542a'); });
  def('coat', 'lab_coat', ['sci-fi', 'modern', 'cosmic-horror'], (A, r) => { torso(A, r, '#e6e3dc', 6); r(A.bl - 1, A.hipY, 1, 4, '#e6e3dc'); r(A.br + 1, A.hipY, 1, 4, '#e6e3dc'); });
  def('coat', 'vine_wrap', ['solarpunk'], (A, r) => { for (let i = 0; i < Math.min(A.tw, 7); i++) r(A.tl + i, A.hipY - 6 + (i % 3) * 2, 1, 1, '#4f9a3a'); });
  def('coat', 'wrap_robe', ['desert-fantasy', 'fantasy'], (A, r) => { torso(A, r, A.cloth, 6); for (let i = 0; i < Math.min(A.tw, 6); i++) r(A.tl + i, A.hipY - 6 + i, 1, 1, A.brass); hem(A, r, A.cloth, 4); });
  def('coat', 'scale_mail', ['fantasy', 'desert-fantasy', 'mythic'], (A, r) => { for (let y = A.hipY - 6; y < A.hipY + 1; y++) for (let x = A.tl + (y % 2); x < A.tl + A.tw; x += 2) r(x, y, 1, 1, A.brass); });
  def('coat', 'bone_armor', ['dark-fantasy', 'prehistoric'], (A, r) => { for (let y = A.hipY - 6; y < A.hipY; y += 2) r(A.tl, y, A.tw, 1, A.pale); }, { spirit: true });
  def('coat', 'rusted_plate', ['post-apocalyptic', 'dark-fantasy'], (A, r) => { torso(A, r, '#8b6331', 5); r(A.tl + 1, A.hipY - 4, 1, 1, '#c26a2a'); r(A.tr - 1, A.hipY - 2, 1, 1, '#c26a2a'); });
  def('coat', 'neon_jacket', ['cyberpunk'], (A, r) => { torso(A, r, A.dark, 6); r(A.tl, A.hipY - 6, 1, 6, '#e8c8f0'); r(A.tr, A.hipY - 6, 1, 6, '#90d0ff'); });
  def('coat', 'rain_slicker', ['noir', 'nautical', 'cyberpunk'], (A, r) => { torso(A, r, '#e0b030', 6); r(A.bl - 1, A.hipY, A.br - A.bl + 3, 3, '#e0b030'); });
  def('coat', 'mourning_dress', ['gothic-horror', 'dark-fantasy'], (A, r) => { torso(A, r, A.dark, 6); hem(A, r, A.dark, 8); r(A.tl, A.hipY - 6, A.tw, 1, A.pale); });
  def('coat', 'sand_robes', ['desert-fantasy', 'post-apocalyptic'], (A, r) => { torso(A, r, '#c49a6a', 6); hem(A, r, '#c49a6a', 6, 1); });
  // cloaks (drawn outside the body so the silhouette widens like a cape)
  const sides = (A, r, c, len, w = 1) => { const y = A.hipY - 7; r(A.tl - w, y, w, len, c); r(A.tr + 1, y, w, len, A.mix(c, '#000000', .3)); };
  def('cloak', 'short_cape', ['fantasy', 'mythic', 'steampunk', 'nautical'], (A, r) => sides(A, r, A.cloth, 7));
  def('cloak', 'long_cloak', ['fantasy', 'dark-fantasy', 'desert-fantasy', 'gothic-horror'], (A, r) => sides(A, r, A.dark, Math.max(8, A.bot - A.hipY + 6), 2));
  def('cloak', 'fur_cloak', ['fantasy', 'prehistoric', 'dark-fantasy'], (A, r) => { sides(A, r, '#8a6a48', 9, 2); r(A.tl - 2, A.hipY - 8, A.tw + 4, 1, '#d8ccb0'); });
  def('cloak', 'tattered_cloak', ['dark-fantasy', 'gothic-horror', 'fantasy', 'post-apocalyptic'], (A, r) => { const y = A.hipY - 7; for (let i = 0; i < 9; i++) if (i % 3 !== 2) { r(A.tl - 1, y + i, 1, 1, A.dark); r(A.tr + 1, y + i, 1, 1, A.dark); } }, { spirit: true });
  def('cloak', 'feather_cloak', ['prehistoric', 'mythic'], (A, r) => { for (let i = 0; i < 8; i++) { r(A.tl - 1 - (i % 2), A.hipY - 7 + i, 1, 1, i % 2 ? '#b7583d' : '#e0b060'); r(A.tr + 1 + (i % 2), A.hipY - 7 + i, 1, 1, i % 2 ? '#e0b060' : '#b7583d'); } });
  def('cloak', 'spectral_trail', SPIRIT, (A, r) => { sides(A, r, A.glow, Math.max(6, A.bot - A.hipY + 4)); for (let x = A.bl; x <= A.br; x += 2) r(x, A.bot - 1, 1, 1, A.glow); }, { spirit: true });
  def('cloak', 'thermal_cape', ['sci-fi'], (A, r) => sides(A, r, '#c0ccd8', 8));
  def('cloak', 'high_collar_cape', ['gothic-horror', 'dark-fantasy'], (A, r) => { sides(A, r, A.dark, 10, 2); r(A.hl - 2, A.headRow + 2, 1, 3, '#a04060'); r(A.hr + 2, A.headRow + 2, 1, 3, '#a04060'); });
  def('cloak', 'dust_cloak', ['desert-fantasy', 'post-apocalyptic', 'western'], (A, r) => sides(A, r, '#a8865a', 9, 2));
  def('cloak', 'kelp_shawl', ['underwater'], (A, r) => sides(A, r, '#4f8a6a', 6));
  // belts
  def('belt', 'rope_belt', ['fantasy', 'prehistoric', 'desert-fantasy', 'mythic'], (A, r) => { r(A.tl, A.hipY - 1, A.tw, 1, '#c8a878'); r(A.tl + 1, A.hipY, 1, 2, '#c8a878'); });
  def('belt', 'pouch_belt', ['fantasy', 'western', 'post-apocalyptic', 'dark-fantasy'], (A, r) => { r(A.tl, A.hipY - 1, A.tw, 1, A.leather); r(A.tl, A.hipY, 2, 2, A.leather); });
  def('belt', 'scabbard', ['fantasy', 'dark-fantasy', 'mythic', 'nautical', 'desert-fantasy'], (A, r) => { r(A.tl, A.hipY - 1, A.tw, 1, A.leather); r(A.tl - 1, A.hipY, 1, 5, A.leather); r(A.tl - 1, A.hipY - 1, 1, 1, A.brass); });
  def('belt', 'utility_harness', ['sci-fi', 'cyberpunk', 'modern'], (A, r) => { r(A.tl, A.hipY - 1, A.tw, 1, A.dark); for (let x = A.tl; x < A.tl + A.tw; x += 3) r(x, A.hipY, 1, 1, A.metal); });
  def('belt', 'chain_belt', ['dark-fantasy', 'gothic-horror', 'cyberpunk'], (A, r) => { for (let x = A.tl; x < A.tl + A.tw; x++) r(x, A.hipY - 1, 1, 1, x % 2 ? A.metal : A.dark); });
  def('belt', 'brass_buckle', ['steampunk', 'western', 'dieselpunk'], (A, r) => { r(A.tl, A.hipY - 1, A.tw, 1, A.leather); r(A.tl + (A.tw >> 1), A.hipY - 1, 1, 1, A.brass); });
  def('belt', 'kelp_belt', ['underwater'], (A, r) => r(A.tl, A.hipY - 1, A.tw, 1, '#4f8a6a'));
  def('belt', 'potion_belt', F, (A, r) => { r(A.tl, A.hipY - 1, A.tw, 1, A.leather); r(A.tl + 1, A.hipY, 1, 1, '#c2183a'); r(A.tl + 3, A.hipY, 1, 1, '#2a5fd6'); });
  def('belt', 'ammo_belt', ['dieselpunk', 'post-apocalyptic', 'modern'], (A, r) => { for (let x = A.tl; x < A.tl + A.tw; x++) r(x, A.hipY - 1, 1, 1, x % 2 ? A.brass : A.leather); });
  def('belt', 'skull_belt', ['dark-fantasy', 'gothic-horror'], (A, r) => { r(A.tl, A.hipY - 1, A.tw, 1, A.dark); r(A.tl + (A.tw >> 1), A.hipY - 1, 1, 1, A.pale); });
  // accessories / small props
  const chest = A => ({ x: A.tl + (A.tw >> 1), y: A.hipY - 5 });
  def('extra', 'amulet', ['fantasy', 'dark-fantasy', 'mythic', 'desert-fantasy'], (A, r) => { const c = chest(A); r(c.x, c.y, 1, 1, A.glow); });
  def('extra', 'holy_symbol', ['fantasy', 'mythic'], (A, r) => { const c = chest(A); r(c.x, c.y - 1, 1, 3, A.brass); r(c.x - 1, c.y, 3, 1, A.brass); });
  def('extra', 'spellbook', F, (A, r) => { r(A.tr + 1, A.hipY - 3, 2, 3, '#7b3fb0'); r(A.tr + 1, A.hipY - 3, 2, 1, A.brass); });
  def('extra', 'hand_lantern', ['fantasy', 'gothic-horror', 'nautical', 'western'], (A, r) => { r(A.tr + 1, A.hipY, 1, 2, '#ffe8a0'); r(A.tr + 1, A.hipY - 1, 1, 1, A.dark); });
  def('extra', 'soul_lantern', ['dark-fantasy', 'gothic-horror', 'fantasy'], (A, r) => { r(A.tr + 1, A.hipY, 1, 2, '#7dffb0'); r(A.tr + 1, A.hipY - 1, 1, 1, A.dark); }, { spirit: true });
  def('extra', 'chain_fetters', ['fantasy', 'dark-fantasy', 'gothic-horror'], (A, r) => { r(A.tl - 1, A.hipY - 2, 1, 1, A.metal); r(A.tr + 1, A.hipY - 2, 1, 1, A.metal); for (let x = A.bl; x <= A.br; x += 2) r(x, A.bot - 2, 1, 1, A.metal); }, { spirit: true });
  def('extra', 'wisp_motes', ['fantasy', 'dark-fantasy', 'mythic', 'cosmic-horror', 'gothic-horror'], (A, r) => { r(A.tl - 2, A.hipY - 6, 1, 1, A.glow); r(A.tr + 2, A.hipY - 2, 1, 1, A.glow); r(A.hl - 2, A.top + 1, 1, 1, A.glow); }, { spirit: true });
  def('extra', 'pauldrons', ['fantasy', 'dark-fantasy', 'mythic', 'post-apocalyptic'], (A, r) => { r(A.tl - 1, A.hipY - 7, 2, 2, A.metal); r(A.tr, A.hipY - 7, 2, 2, A.metal); });
  def('extra', 'bracers', ['fantasy', 'mythic', 'prehistoric'], (A, r) => { r(A.tl - 1, A.hipY - 2, 1, 2, A.leather); r(A.tr + 1, A.hipY - 2, 1, 2, A.leather); });
  def('extra', 'quiver', ['fantasy', 'prehistoric', 'mythic'], (A, r) => { r(A.tr + 1, A.hipY - 8, 1, 5, A.leather); r(A.tr + 1, A.hipY - 9, 1, 1, A.pale); });
  def('extra', 'back_shield', ['fantasy', 'mythic', 'dark-fantasy'], (A, r) => r(A.tl - 2, A.hipY - 6, 2, 4, A.metal));
  def('extra', 'scroll_case', ['fantasy', 'desert-fantasy'], (A, r) => r(A.tl - 1, A.hipY - 6, 1, 4, A.brass));
  def('extra', 'pocket_watch', ['steampunk', 'noir'], (A, r) => { r(A.tl + 1, A.hipY - 3, 1, 1, A.brass); r(A.tl + 2, A.hipY - 4, 1, 1, A.brass); });
  def('extra', 'cyber_eye', ['cyberpunk', 'sci-fi'], (A, r) => r(A.hr - 1, A.headRow, 1, 1, '#e0542a'));
  def('extra', 'data_cable', ['cyberpunk'], (A, r) => { r(A.hl - 1, A.headRow + 1, 1, 4, A.metal); r(A.hl - 1, A.headRow + 5, 1, 1, '#90d0ff'); });
  def('extra', 'holo_badge', ['sci-fi'], (A, r) => r(A.tl + 1, A.hipY - 5, 1, 1, '#90d0ff'));
  def('extra', 'air_tank', ['underwater', 'sci-fi'], (A, r) => r(A.tl - 2, A.hipY - 7, 2, 5, '#c0ccd8'));
  def('extra', 'solar_pack', ['solarpunk'], (A, r) => { r(A.tl - 2, A.hipY - 7, 2, 4, '#3a64b8'); r(A.tl - 2, A.hipY - 7, 2, 1, '#e0b060'); });
  def('extra', 'seed_satchel', ['solarpunk', 'fantasy'], (A, r) => r(A.tr, A.hipY, 2, 2, '#6a8a42'));
  def('extra', 'bone_necklace', ['prehistoric', 'dark-fantasy'], (A, r) => { for (let x = A.tl + 1; x < A.tl + A.tw - 1; x += 2) r(x, A.hipY - 6, 1, 1, A.pale); });
  def('extra', 'gas_canister', ['post-apocalyptic', 'dieselpunk'], (A, r) => r(A.tr + 1, A.hipY - 1, 1, 3, '#6a8a42'));
  def('extra', 'press_camera', ['modern', 'noir'], (A, r) => r(A.tl + 1, A.hipY - 4, 2, 2, A.dark));
  def('extra', 'lawman_badge', ['noir', 'modern', 'western'], (A, r) => r(A.tl + 1, A.hipY - 5, 1, 1, A.brass));
  def('extra', 'clockwork_gears', ['steampunk'], (A, r) => { r(A.tr - 1, A.hipY - 5, 1, 1, A.brass); r(A.tr, A.hipY - 4, 1, 1, A.brass); });
  def('extra', 'ritual_dagger', ['cosmic-horror', 'dark-fantasy'], (A, r) => { r(A.tr + 1, A.hipY - 1, 1, 3, A.metal); r(A.tr + 1, A.hipY - 2, 1, 1, A.dark); });
  def('extra', 'starfish_charm', ['underwater'], (A, r) => r(A.tl + 1, A.hipY - 5, 1, 1, '#e09a2a'));
  def('extra', 'grave_dirt', ['dark-fantasy', 'gothic-horror', 'fantasy'], (A, r) => { for (let x = A.bl; x <= A.br; x += 3) r(x, A.bot - 1, 1, 1, '#5a4836'); }, { spirit: true });

  const Expansion = typeof module === 'object' && module.exports ? require('./spriteExpansion') : root.SpriteExpansion;
  for (const [genre,g] of Object.entries(Expansion?.CATALOG || {})) {
    const [coat,hat,extra,belt]=g.pieces, mark=Object.keys(Expansion.CATALOG).indexOf(genre);
    def('coat',coat,[genre],(A,r)=>{torso(A,r,A.cloth,6);r(A.tl,A.hipY-6,A.tw,1,A.mix(A.cloth,'#ffffff',.22));for(let y=A.hipY-5;y<A.hipY;y++){if(mark%3===0)r(A.tl+((y+mark+24)%Math.max(1,A.tw)),y,1,1,A.brass);else if(mark%3===1)r(A.tl+(A.tw>>1),y,1,1,A.dark);else if(y%2===0)r(A.tl+1,y,Math.max(1,A.tw-2),1,A.mix(A.cloth,A.dark,.25));}},{expansion:true});
    def('hat',hat,[genre],(A,r)=>{r(A.hl,A.top+1,A.hw,1,A.cloth);if(['western','noir','solarpunk'].includes(genre))r(A.hl-2,A.top+1,A.hw+4,1,A.cloth);else if(genre==='modern'){r(A.hl,A.ct,A.hw,2,A.cloth);r(A.hr,A.top+1,2,1,A.cloth);}else if(['sci-fi','cyberpunk','dieselpunk','steampunk','underwater'].includes(genre))r(A.hl-1,A.headRow,1,2,A.metal);else{r(A.hl,A.ct,1,3,A.cloth);r(A.hr,A.ct,1,3,A.mix(A.cloth,A.dark,.3));}r(A.hl+(A.hw>>1),A.top+1,1,1,A.brass);},{expansion:true});
    def('extra',extra,[genre],(A,r)=>{r(A.tr+1,A.hipY-3,2,3,A.leather);r(A.tr+1,A.hipY-3,2,1,A.brass);if(['sci-fi','cyberpunk','solarpunk','dieselpunk','underwater'].includes(genre))r(A.tr+1,A.hipY-2,1,1,A.glow);},{expansion:true});
    def('belt',belt,[genre],(A,r)=>{r(A.tl,A.hipY-1,A.tw,1,A.leather);r(A.tl+(A.tw>>1),A.hipY-1,1,1,A.brass);r(A.tl+1,A.hipY,1,2,A.cloth);},{expansion:true});
  }
  for (const [slot, table] of Object.entries(LEGACY)) for (const [id, genres] of Object.entries(table)) if (!P[`${slot}:${id}`]) P[`${slot}:${id}`] = { slot, id, genres, legacy: true };
  const piece = (slot, id) => P[`${slot}:${id}`] || null;
  const tagsOf = (slot, id) => { const p = piece(slot, id); return p ? p.genres : undefined; };

  // ---- outfits: each genre gets new combinations of its own tagged pieces (and spirit/undead variants) ----
  const ofGenre = (slot, genre, spirit) => Object.values(P).filter(p => p.slot === slot && !p.legacy && !p.expansion && (!p.genres || p.genres.includes(genre)) && (spirit ? true : !p.spirit));
  const spiritOf = (slot, genre) => Object.values(P).filter(p => p.slot === slot && !p.legacy && p.spirit && p.genres.includes(genre));
  function outfitsFor(genre, n = 6) {
    const hats = ofGenre('hat', genre), coats = ofGenre('coat', genre), belts = ofGenre('belt', genre), extras = ofGenre('extra', genre), cloaks = ofGenre('cloak', genre), hair = ofGenre('hair', genre);
    if (!hats.length && !coats.length) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const o = { genre };
      if (hats.length) o.hat = hats[i % hats.length].id;
      if (coats.length) o.coat = coats[(i * 3 + 1) % coats.length].id;
      if (belts.length) o.belt = belts[(i * 2) % belts.length].id;
      if (extras.length && i % 2 === 0) o.extra = extras[(i * 5) % extras.length].id;
      if (cloaks.length && i % 3 === 1) o.cloak = cloaks[i % cloaks.length].id;
      if (hair.length && i % 3 === 2) o.hair = hair[i % hair.length].id;
      out.push(o);
    }
    return out;
  }
  function spiritOutfitsFor(genre) {
    const coats = spiritOf('coat', genre); if (!coats.length) return [];
    const hats = spiritOf('hat', genre), cloaks = spiritOf('cloak', genre), extras = spiritOf('extra', genre), hair = spiritOf('hair', genre);
    return coats.map((c, i) => ({ genre, spirit: true, coat: c.id, ...(hats.length ? { hat: hats[i % hats.length].id } : {}),
      ...(cloaks.length ? { cloak: cloaks[i % cloaks.length].id } : {}), ...(extras.length ? { extra: extras[i % extras.length].id } : {}), ...(hair.length && i % 2 ? { hair: hair[0].id } : {}) }));
  }
  const ALL_GENRES = () => uniq(Object.values(P).flatMap(p => p.genres || []));

  // ---- world context ----
  function canonicalGenres(list) { return uniq((list || []).map(g => String(g || '').toLowerCase().trim()).filter(Boolean)); }
  function context(explicit) {
    if (explicit) return explicit;
    try {
      if (typeof window === 'object' && root.HolodekFlags && 'HOMEBREW_ACTIVE' in root.HolodekFlags) {
        const f = root.HolodekFlags;
        if (!f.HOMEBREW_ACTIVE) return { homebrew: false, genres: COTG.slice() };
        return { homebrew: true, genres: Array.isArray(f.HOMEBREW_GENRES) ? canonicalGenres(f.HOMEBREW_GENRES) : null };
      }
    } catch (e) { /* no world known */ }
    return { homebrew: null, genres: null }; // unknown world (tools/tests): only check each piece against the garb's own genre
  }
  const allowed = (tags, genre, genres) => tags === null || (Array.isArray(tags) && (!genre || tags.includes(genre)) && (!genres || tags.some(t => genres.includes(t))));
  // Returns a trimmed copy, or null when nothing in-genre is left (the base outfit then shows on its own).
  function sanitizeGarb(garb, ctx) {
    if (!garb || typeof garb !== 'object') return null;
    const c = context(ctx), genres = c.genres && c.genres.length ? c.genres : null;
    const genre = garb.genre ? String(garb.genre).toLowerCase() : null;
    if (genres && genre && !genres.includes(genre)) return null;
    if (!genre && !genres) return null;
    const out = { genre: genre || genres[0] };
    let kept = 0;
    for (const slot of SLOTS) {
      const id = garb[slot]; if (id == null || id === 'none') continue;
      const tags = tagsOf(slot, id);
      if (tags !== undefined && allowed(tags, out.genre, genres)) { out[slot] = id; if (tags !== null) kept++; }
    }
    if (garb.spirit) out.spirit = true;
    return kept ? out : null;
  }
  function sanitizeTraits(traits, ctx) {
    if (!traits || !traits.genreGarb) return traits;
    const garb = sanitizeGarb(traits.genreGarb, ctx), copy = { ...traits };
    if (garb) copy.genreGarb = garb; else delete copy.genreGarb;
    return copy;
  }
  function stripGarb(traits) { if (!traits || !traits.genreGarb) return traits; const copy = { ...traits }; delete copy.genreGarb; return copy; }

  // Draw any wardrobe-only slot or new piece. Legacy pieces stay with drawGarb's own switch.
  function drawPieces(garb, A, rect, slots) {
    let n = 0;
    const r = (x, y, w, h, c) => { const y0 = Math.max(0, Math.round(y)), y1 = Math.round(y + h); if (w > 0 && y1 > y0) rect(Math.round(x), y0, Math.round(w), y1 - y0, c); };
    for (const slot of slots || SLOTS) {
      const p = garb && garb[slot] != null ? piece(slot, garb[slot]) : null;
      if (p && p.draw) { try { p.draw(A, r); n++; } catch (e) { /* one bad piece never breaks the sprite */ } }
    }
    return n;
  }
  const counts = () => { const out = {}; for (const p of Object.values(P)) if (!p.legacy) { out[p.slot] = (out[p.slot] || 0) + 1; } return out; };
  const genreCounts = () => { const out = {}; for (const p of Object.values(P)) if (!p.legacy) for (const g of p.genres || []) out[g] = (out[g] || 0) + 1; return out; };
  return { COTG, SLOTS, PIECES: P, LEGACY, piece, tagsOf, outfitsFor, spiritOutfitsFor, context, sanitizeGarb, sanitizeTraits, stripGarb, drawPieces, counts, genreCounts, allGenres: ALL_GENRES };
});
