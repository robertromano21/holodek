(function(root, factory) {
  const node = typeof module === 'object' && module.exports;
  const enabled = node ? require('../retort/worldFlags').on('GENRE_EXPANSION') || require('../retort/worldFlags').on('ARCHITECTURE_EXPANSION') : root.HolodekFlags?.GENRE_EXPANSION || root.HolodekFlags?.ARCHITECTURE_EXPANSION;
  const api = factory(node ? require('./designCatalog') : root.DesignCatalog, node ? require('./genreExpansion') : root.GenreExpansion, enabled);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.GenreKits = api;
})(typeof window === 'object' ? window : globalThis, function(Catalog, Expansion, expanded) {
  'use strict';
  // world1 genre layer (flag GENRE_KITS). Extends, never replaces:
  //  - characters: specs for the existing createSemanticCharacterVoxelFrame (parts keywords it already reads + its design params);
  //    genre held items/gear are drawn by gearHook() inside that function, using its own fillBox/drawLine/handX/handZ (weapon-hand lock).
  //  - props/building pieces: the CityKit integration pattern in ScenePropVoxels (has/build/color, same occupancy grid + shading).
  //  - colours: every genre palette is snapped to the game's DesignCatalog palette set (palette discipline).
  //  - portal realms: the planarPortals realm palette/biome/crystal feature is the base; genre adds on top (resolve()).
  const GAME = Object.values(Catalog?.PALETTES || {}).flat();
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const snap = h => GAME.length ? GAME.reduce((b, c) => { const d = rgb(c).reduce((s, v, i) => s + (v - rgb(h)[i]) ** 2, 0); return d < b[0] ? [d, c] : b; }, [Infinity, h])[1] : h;
  const pal = (...hex) => Object.fromEntries(['primary', 'secondary', 'highlight', 'shadow', 'skin', 'accent'].map((k, i) => [k, snap(hex[i])]));
  // body plans -> existing design params (head_size, torso_width, leg_height, arm_length...)
  const PLANS = { lean: { torso_width: 5, leg_height: 12 }, stocky: { torso_width: 7, leg_height: 9 }, tall: { leg_height: 13, torso_height: 6 }, hunched: { torso_height: 4, leg_height: 9, head_size: 5 },
    augmented: { torso_width: 7, arm_length: 6 }, gaunt: { torso_width: 5, head_size: 5, leg_height: 12 }, brute: { torso_width: 8, torso_height: 7, arm_length: 6 } };
  const G = (o) => o;
  const GENRES = {
    fantasy: G({ cotg: true, palette: pal('#4a3c2f', '#8b5a2b', '#e7b45a', '#22110a', '#e8c39e', '#2a4ea0'), plans: ['lean', 'stocky', 'tall'],
      clothing: { head: ['normal_human', 'hooded_cowl', 'plumed_helmet'], torso: ['tunic', 'chain_shirt', 'flowing_robe'], legs: ['striding_boots'] }, gear: ['flowing_cape', 'satchel', 'rune_amulet'],
      held: ['sword_broad', 'staff_crook', 'bow', 'crossbow', 'sling', 'throwing_axe', 'wand', 'lantern_hand'], creatures: ['ash_ghoul', 'cave_troll', 'barrow_wight', 'giant_spider'],
      props: ['g_candle_stand', 'g_rune_stone', 'g_crystal_lamp', 'g_book_lectern', 'brazier', 'altar'], building: ['g_ruined_wall', 'g_rune_arch'], voxel: 'stone', textures: { floor: 'stone', wall: 'brick' }, lights: ['candle', 'rune_glow', 'crystal_glow', 'brazier_moon'] }),
    'dark-fantasy': G({ cotg: true, palette: pal('#3a2a48', '#545a61', '#b49ac8', '#140c1c', '#d8d4c0', '#a04060'), plans: ['gaunt', 'tall', 'hunched'],
      clothing: { head: ['hooded_skull', 'iron_mask', 'crowned_hair'], torso: ['plate_armor', 'flowing_robe', 'corset_dress'], legs: ['armored_greaves', 'flowing_skirt'] }, gear: ['flowing_cape', 'bone_charm', 'chain_censer'],
      held: ['scythe_long', 'sword_broad', 'crossbow', 'throwing_knives', 'wand', 'censer'], creatures: ['grave_hound', 'veiled_revenant', 'bone_colossus', 'night_gaunt'],
      props: ['g_candle_stand', 'g_gibbet', 'g_eldritch_obelisk', 'gravestone', 'sarcophagus', 'g_book_lectern'], building: ['g_ruined_wall', 'g_gothic_window'], voxel: 'obsidian', textures: { floor: 'bone', wall: 'obsidian' }, lights: ['candle', 'eldritch_fantasy', 'brazier_moon', 'rune_glow'] }),
    'sci-fi': G({ palette: pal('#b8c8d8', '#545a61', '#90d0ff', '#1a2430', '#e8c39e', '#e0542a'), plans: ['lean', 'augmented', 'tall'],
      clothing: { head: ['visor_helmet', 'normal_human', 'sealed_helm'], torso: ['flight_suit_tunic', 'hard_suit_armor', 'chain_mesh_vest'], legs: ['mag_boots'] }, gear: ['oxygen_pack', 'shoulder_lamp', 'data_wrist'],
      held: ['blaster_pistol', 'blaster_rifle', 'stun_baton', 'scanner'], creatures: ['hull_crawler', 'drone_sentry', 'void_mite', 'rogue_android'],
      props: ['g_console', 'g_cargo_pod', 'g_beacon_post', 'g_pipe_cluster'], building: ['g_bulkhead_panel', 'g_airlock_frame'], voxel: 'metal', textures: { floor: 'metal', wall: 'metal' }, lights: ['beacon_rotating', 'emergency_strobe', 'fluorescent'] }),
    cyberpunk: G({ palette: pal('#2e3236', '#6a4a7a', '#e8c8f0', '#121416', '#e8c39e', '#a04060'), plans: ['lean', 'augmented'],
      clothing: { head: ['visor_mask', 'cropped_hair', 'hooded_cowl'], torso: ['street_jacket_tunic', 'armor_vest', 'long_coat_flowing'], legs: ['striding_boots'] }, gear: ['neon_collar', 'cyber_arm', 'cable_pack'],
      held: ['smartgun', 'mono_blade', 'compact_smg', 'deck'], creatures: ['street_enforcer', 'chrome_hound', 'glitch_drone', 'arcology_guard'],
      props: ['g_neon_sign', 'g_vending_machine', 'g_cable_bundle', 'g_console'], building: ['g_shutter_front', 'g_neon_arch'], voxel: 'metal', textures: { floor: 'metal', wall: 'brick' }, lights: ['neon_buzz', 'fluorescent'] }),
    'post-apocalyptic': G({ palette: pal('#8b6331', '#4b3219', '#e0c37a', '#1c130c', '#c79a52', '#c26a2a'), plans: ['gaunt', 'stocky', 'hunched'],
      clothing: { head: ['gas_mask', 'scarf_hooded_cowl', 'normal_human'], torso: ['patched_tunic', 'scrap_plate_armor', 'duster_flowing'], legs: ['striding_boots'] }, gear: ['scrap_shoulder', 'canteen', 'goggles'],
      held: ['scrap_rifle', 'pipe_club', 'crossbow', 'flashlight'], creatures: ['ash_mutant', 'scrap_crawler', 'rad_hound', 'raider_brute'],
      props: ['g_barrel_fire', 'g_scrap_heap', 'g_wreck_panel', 'barrel'], building: ['g_scrap_wall', 'g_rebar_arch'], voxel: 'rust', textures: { floor: 'ash', wall: 'metal' }, lights: ['sodium_sick', 'dying_flashlight'] }),
    steampunk: G({ palette: pal('#b07a32', '#6a4418', '#e8c070', '#20140a', '#e8c39e', '#5a9a88'), plans: ['stocky', 'lean', 'augmented'],
      clothing: { head: ['top_hat_hair', 'goggle_helm', 'normal_human'], torso: ['waistcoat_tunic', 'brass_plate_armor', 'greatcoat_flowing'], legs: ['striding_boots'] }, gear: ['brass_pack', 'gauge_belt', 'clockwork_arm'],
      held: ['air_rifle', 'arc_pistol', 'wrench_mace', 'cane_sword'], creatures: ['clockwork_sentinel', 'steam_golem', 'sewer_eel', 'automaton_hound'],
      props: ['g_boiler', 'g_gear_wheel', 'g_pipe_cluster', 'g_arc_lamp'], building: ['g_iron_girder', 'g_foundry_arch'], voxel: 'brass', textures: { floor: 'brick', wall: 'metal' }, lights: ['arc_spark', 'oil_lantern'] }),
    western: G({ palette: pal('#d9a86a', '#8a5a32', '#f0dca0', '#3b2617', '#e8c39e', '#a83a22'), plans: ['lean', 'stocky'],
      clothing: { head: ['wide_hat_hair', 'normal_human', 'bandana_mask'], torso: ['vest_tunic', 'duster_flowing', 'shirt_tunic'], legs: ['striding_boots'] }, gear: ['bandolier', 'saddle_bag', 'poncho_cape'],
      held: ['revolver', 'lever_rifle', 'shotgun', 'throwing_knives', 'lantern_hand'], creatures: ['dust_coyote', 'claim_jumper', 'canyon_rattler', 'ghost_rider'],
      props: ['g_hitching_post', 'g_water_tower', 'g_saloon_sign', 'barrel', 'crate'], building: ['g_boardwalk', 'g_false_front'], voxel: 'wood', textures: { floor: 'wood', wall: 'wood' }, lights: ['oil_lantern', 'candle'] }),
    modern: G({ palette: pal('#d8d4c0', '#545a61', '#c8d8ff', '#1c1c18', '#e8c39e', '#3a7aa0'), plans: ['lean', 'stocky', 'tall'],
      clothing: { head: ['cropped_hair', 'cap_hair', 'normal_human'], torso: ['jacket_tunic', 'armor_vest', 'coat_flowing'], legs: ['striding_boots'] }, gear: ['backpack', 'radio_shoulder', 'badge'],
      held: ['pistol', 'rifle', 'baton', 'flashlight', 'phone'], creatures: ['feral_dog', 'security_guard', 'subway_stalker', 'riot_unit'],
      props: ['g_street_lamp', 'g_vending_machine', 'g_dumpster', 'g_bench'], building: ['g_concrete_wall', 'g_storefront'], voxel: 'concrete', textures: { floor: 'stone', wall: 'brick' }, lights: ['fluorescent', 'neon_buzz'] }),
    'cosmic-horror': G({ palette: pal('#2f7a78', '#1c4746', '#7fd3c6', '#0b1a1a', '#d8d4c0', '#6a4a8a'), plans: ['gaunt', 'hunched', 'tall'],
      clothing: { head: ['hooded_cowl', 'veil_mask', 'normal_human'], torso: ['flowing_robe', 'coat_flowing', 'tunic'], legs: ['flowing_skirt', 'striding_boots'] }, gear: ['tentacle_mass', 'eye_charm', 'tome_belt'],
      held: ['ritual_knife', 'revolver', 'tome', 'lantern_hand'], creatures: ['deep_spawn', 'star_polyp', 'faceless_choir', 'tide_horror'],
      props: ['g_eldritch_obelisk', 'g_tentacle_growth', 'g_book_lectern', 'g_ritual_circle'], building: ['g_non_euclid_arch', 'g_ruined_wall'], voxel: 'obsidian', textures: { floor: 'flesh', wall: 'obsidian' }, lights: ['eldritch_breath', 'candle'] }),
    nautical: G({ palette: pal('#2a4ea0', '#8a5a32', '#f5e6b0', '#141a33', '#e8c39e', '#a83a22'), plans: ['stocky', 'lean'],
      clothing: { head: ['tricorn_hair', 'bandana_hair', 'normal_human'], torso: ['coat_flowing', 'shirt_tunic', 'vest_tunic'], legs: ['striding_boots'] }, gear: ['sash', 'spyglass_belt', 'parrot_shoulder'],
      held: ['cutlass', 'flintlock', 'harpoon', 'lantern_hand'], creatures: ['drowned_sailor', 'reef_crab', 'sea_serpent', 'gull_swarm'],
      props: ['g_ship_wheel', 'g_cannon', 'g_rope_coil', 'barrel', 'crate'], building: ['g_hull_plank_wall', 'g_mast'], voxel: 'wood', textures: { floor: 'wood', wall: 'wood' }, lights: ['oil_lantern', 'beacon_rotating'] }),
    mythic: G({ cotg: true, palette: pal('#f1e7d0', '#c9b48e', '#e7b45a', '#3d3024', '#c79a52', '#7aa0c9'), plans: ['tall', 'brute', 'lean'],
      clothing: { head: ['crested_helmet', 'laurel_hair', 'crowned_hair'], torso: ['tunic', 'gallant_plate', 'flowing_robe'], legs: ['armored_greaves', 'striding_boots'] }, gear: ['flowing_cape', 'round_shield', 'laurel'],
      held: ['spear', 'sword_broad', 'bow', 'sling', 'javelin'], creatures: ['bronze_colossus', 'harpy', 'serpent_hydra', 'minotaur_brute'],
      props: ['g_moon_brazier', 'fluted_column', 'altar', 'obelisk', 'g_amphora'], building: ['g_temple_step', 'g_column_ruin'], voxel: 'marble', textures: { floor: 'marble', wall: 'marble' }, lights: ['brazier_moon', 'candle'] }),
    noir: G({ palette: pal('#1c1c18', '#545a61', '#d8d4c0', '#0a0606', '#e8c39e', '#a83a22'), plans: ['lean', 'stocky'],
      clothing: { head: ['fedora_hair', 'normal_human', 'cropped_hair'], torso: ['trench_coat_flowing', 'suit_tunic', 'vest_tunic'], legs: ['striding_boots'] }, gear: ['shoulder_holster', 'cigarette', 'notebook'],
      held: ['revolver', 'tommy_gun', 'flashlight', 'blackjack'], creatures: ['mob_heavy', 'alley_cat', 'crooked_cop', 'hired_gun'],
      props: ['g_desk', 'g_street_lamp', 'g_bench', 'g_hanging_bulb'], building: ['g_blind_window', 'g_concrete_wall'], voxel: 'concrete', textures: { floor: 'wood', wall: 'brick' }, lights: ['blind_shafts', 'bulb_sway'] })
  };
  if (expanded && Expansion) {
    for (const [genre, kit] of Object.entries(Expansion.NEW_GENRES)) GENRES[genre] = { ...kit, palette: pal(...kit.palette) };
    for (const [genre, kit] of Object.entries(GENRES)) {
      kit.building = [...new Set([...kit.building, ...['house','hall','gate','tower','column','shrine'].map(role => `x_${genre}_${role}`)])];
      kit.props = [...new Set([...kit.props, `x_${genre}_stall`, `x_${genre}_utility`])];
    }
    for (const [name, genre] of Object.entries(Expansion.COTG)) GENRES[genre].building.push(`x_${name}`);
  }
  const ALIASES = { 'gothic horror': 'dark-fantasy', horror: 'dark-fantasy', gothic: 'dark-fantasy', 'space station': 'sci-fi', space: 'sci-fi', dystopian: 'cyberpunk', urban: 'modern', eldritch: 'cosmic-horror', pirate: 'nautical', ancient: 'mythic', ...(expanded ? Expansion?.ALIASES : {}) };
  const genreOf = g => { const k = String(g || '').toLowerCase().trim(); return GENRES[k] ? k : ALIASES[k] || null; };
  const COTG_ALLOWED = ['fantasy', 'dark-fantasy', 'mythic'];
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const pick = (a, s, n = 0) => a[(s >>> (n * 3)) % a.length];
  // Setting-aware: Children of the Grave (no homebrew bible) locks to fantasy-family genres, including portal rooms.
  function resolve(room = {}, setting = null) {
    const homebrew = !!(setting && setting.seed && setting.genres);
    // Weighted list: homebrew bible (primary first) or the room/realm's own genre; CotG locks to fantasy-family.
    let mix = homebrew ? (setting.genreWeights || setting.genres.map(g => ({ genre: g, weight: 1 / setting.genres.length }))).map(x => ({ genre: genreOf(x.genre), weight: x.weight })).filter(x => x.genre) : [];
    const own = genreOf(room.genreKit?.genre || room.planarRealm?.genre || room.genre);
    if (own && (homebrew || COTG_ALLOWED.includes(own))) mix = [{ genre: own, weight: 1 }, ...mix.filter(x => x.genre !== own).map(x => ({ ...x, weight: x.weight * .5 }))];
    if (!homebrew) mix = mix.filter(x => COTG_ALLOWED.includes(x.genre));
    if (!mix.length) mix = [{ genre: room.planarRealm && own ? 'dark-fantasy' : 'fantasy', weight: 1 }];
    const total = mix.reduce((t, x) => t + x.weight, 0); mix = mix.map(x => ({ ...x, weight: x.weight / total }));
    const genre = mix[0].genre, k = GENRES[genre], base = room.planarRealm ? { palette: room.planarRealm.palette, features: ['crystal_cluster'], arch: 'portal_arch', archColor: '#a050e0', lights: ['crystal_glow'] } : null;
    // Blend: each list takes items from every genre in proportion to its weight (primary first), no duplicates.
    const blend = (field, n) => { const out = []; for (const x of mix) { const take = Math.max(1, Math.round(n * x.weight)); for (const v of GENRES[x.genre][field].slice(0, take)) if (!out.includes(v)) out.push(v); } return out; };
    return { genre, mix, homebrew, locked: !homebrew, base, palette: k.palette, voxel: k.voxel, textures: k.textures,
      lights: [...new Set([...(base?.lights || []), ...blend('lights', 4)])], props: blend('props', 6), building: blend('building', 3), creatures: blend('creatures', 4), held: blend('held', 6) };
  }
  // Character spec for the existing semantic voxel generator / sprite review (parts keywords + design params it already reads).
  function characterSpec(genre, role = 'npc', seed = 0) {
    const g = GENRES[genreOf(genre) || 'fantasy'], s = hash(`${genre}:${role}:${seed}`), creature = role === 'creature' || role === 'monster';
    const plan = creature ? pick(['hunched', 'brute', 'gaunt'], s) : pick(g.plans, s);
    const name = creature ? pick(g.creatures, s, 2) : `${genre} ${role}`;
    return { kind: 'semantic', genre: genreOf(genre), name, palette: { ...g.palette }, design: { ...PLANS[plan], pose: 'ready' },
      parts: { head: pick(g.clothing.head, s, 1), torso: pick(g.clothing.torso, s, 2), legs: pick(g.clothing.legs, s, 3), weapon: pick(g.held, s, 4), accessory: pick(g.gear, s, 5) },
      genreGear: { held: pick(g.held, s, 4), accessory: pick(g.gear, s, 5), emissive: /neon|visor|cyber|eldritch|eye|beacon|lamp|lantern/.test(pick(g.gear, s, 5) + pick(g.clothing.head, s, 1)), creature: creature ? name : null }, plan };
  }
  // Held items beyond the existing sword/staff/bow/spear/axe/mace/scythe/wand set, drawn at the locked weapon hand.
  const HELD = { pistol: 'gun', revolver: 'gun', flintlock: 'gun', blaster_pistol: 'gun', arc_pistol: 'gun', smartgun: 'long', blaster_rifle: 'long', rifle: 'long', lever_rifle: 'long', air_rifle: 'long', scrap_rifle: 'long', shotgun: 'long', tommy_gun: 'long', compact_smg: 'gun',
    crossbow: 'xbow', sling: 'sling', throwing_axe: 'small', throwing_knives: 'small', javelin: 'pole', harpoon: 'pole', cutlass: 'blade', mono_blade: 'blade', cane_sword: 'blade', ritual_knife: 'small',
    lantern_hand: 'lamp', flashlight: 'lamp', scanner: 'box', deck: 'box', phone: 'box', tome: 'box', censer: 'lamp', stun_baton: 'club', baton: 'club', pipe_club: 'club', wrench_mace: 'club', blackjack: 'club' };
  function gearHook(spec, k) { // k: { fillBox, drawLine, handX, handZ, centerY, frontDir, color(hex), torso:{x0,x1,z0,z1}, head:{x0,x1,z0,z1} }
    const gg = spec?.genreGear; if (!gg) return 0; let n = 0; const P = spec.palette || {}, c = h => k.color(h), dark = c(P.shadow || '#22110a'), metal = c(P.secondary || '#545a61'), glow = c(P.highlight || '#ffdd66');
    const f = k.frontDir, hx = k.handX, hz = k.handZ, y = k.centerY, kind = HELD[gg.held];
    if (kind === 'gun') { k.fillBox(hx + f, hx + f * 3, y, y, hz, hz, metal); k.fillBox(hx, hx, y, y, hz - 1, hz, dark); n++; }
    else if (kind === 'long') { k.fillBox(hx - f, hx + f * 5, y, y, hz, hz, metal); k.fillBox(hx - f * 2, hx - f, y, y, hz - 1, hz, dark); if (/blaster|smart|arc/.test(gg.held)) k.fillBox(hx + f * 5, hx + f * 5, y, y, hz, hz, glow); n++; }
    else if (kind === 'xbow') { k.fillBox(hx, hx + f * 3, y, y, hz, hz, c(P.secondary)); k.fillBox(hx + f * 2, hx + f * 2, y - 2, y + 2, hz, hz, dark); n++; }
    else if (kind === 'sling') { k.drawLine(hx, y, hz, hx, y, hz - 3, 1, c(P.secondary)); k.fillBox(hx, hx, y, y, hz - 4, hz - 4, dark); n++; }
    else if (kind === 'small') { k.fillBox(hx + f, hx + f * 2, y, y, hz, hz + 1, metal); n++; }
    else if (kind === 'pole') { k.drawLine(hx, y, hz - 3, hx + f, y, hz + 7, 1, c(P.secondary)); k.fillBox(hx + f, hx + f, y, y, hz + 7, hz + 8, metal); n++; }
    else if (kind === 'blade') { k.fillBox(hx + f, hx + f, y, y, hz, hz + 6, metal); k.fillBox(hx, hx + f * 2, y, y, hz, hz, dark); n++; }
    else if (kind === 'lamp') { k.fillBox(hx + f, hx + f, y, y, hz - 2, hz - 1, glow); k.fillBox(hx + f, hx + f, y, y, hz, hz, dark); n++; }
    else if (kind === 'box') { k.fillBox(hx + f, hx + f * 2, y, y + 1, hz - 1, hz, /tome/.test(gg.held) ? c(P.accent) : metal); n++; }
    else if (kind === 'club') { k.fillBox(hx + f, hx + f, y, y, hz, hz + 4, metal); n++; }
    const t = k.torso, h = k.head;
    if (t && /pack|tank|bag|backpack|brass_pack|oxygen|cable/.test(gg.accessory)) { k.fillBox(t.x0 - f * 2, t.x0 - f, y - 1, y + 1, t.z0 + 1, t.z1, metal); n++; }
    if (t && /bandolier|sash|belt|holster/.test(gg.accessory)) { k.drawLine(t.x0, y - 1, t.z1, t.x1, y - 1, t.z0 + 1, 1, c(P.accent)); n++; }
    if (t && /tentacle/.test(gg.accessory)) { for (let i = -1; i <= 1; i++) k.drawLine(t.x0, y + i * 2, t.z0, t.x0 - f * 2, y + i * 3, t.z0 - 4, 1, c(P.accent)); n++; }
    if (h && gg.emissive) { k.fillBox(h.x0, h.x1, y - 1, y - 1, Math.round((h.z0 + h.z1) / 2), Math.round((h.z0 + h.z1) / 2), glow); n++; }
    return n;
  }
  // ---- Props / building pieces: box compositions in unit space -> occupancy grid (material ids 1..3) like ScenePropVoxels.build
  const B = (x0, y0, z0, x1, y1, z1, m = 1) => ({ x0, y0, z0, x1, y1, z1, m });
  const PARTS = {
    g_candle_stand: [B(.42, .42, 0, .58, .58, .7, 1), B(.3, .3, .7, .7, .7, .76, 1), B(.47, .47, .76, .53, .53, .92, 3)],
    g_rune_stone: [B(.3, .38, 0, .7, .62, .85, 1), B(.36, .37, .3, .64, .38, .7, 3)], g_crystal_lamp: [B(.4, .4, 0, .6, .6, .5, 1), B(.36, .36, .5, .64, .64, .9, 3)],
    g_book_lectern: [B(.44, .44, 0, .56, .56, .6, 2), B(.25, .3, .6, .75, .7, .7, 2), B(.3, .34, .7, .7, .66, .76, 3)],
    g_ruined_wall: [B(0, .4, 0, 1, .6, .55, 1), B(0, .4, .55, .55, .6, .8, 1), B(.62, .1, 0, .8, .3, .15, 1)], g_rune_arch: [B(0, .4, 0, .2, .6, 1, 1), B(.8, .4, 0, 1, .6, 1, 1), B(0, .4, .82, 1, .6, 1, 1), B(.4, .39, .88, .6, .4, .96, 3)],
    g_gibbet: [B(.45, .45, 0, .55, .55, 1, 2), B(.45, .45, .9, .9, .55, 1, 2), B(.72, .42, .45, .88, .58, .75, 1)], g_eldritch_obelisk: [B(.35, .35, 0, .65, .65, .95, 1), B(.34, .34, .4, .66, .35, .6, 3)],
    g_gothic_window: [B(0, .45, 0, .2, .55, 1, 1), B(.8, .45, 0, 1, .55, 1, 1), B(.2, .45, .9, .8, .55, 1, 1), B(.2, .48, .2, .8, .52, .9, 3)],
    g_console: [B(.15, .3, 0, .85, .7, .5, 2), B(.15, .55, .5, .85, .7, .8, 2), B(.2, .54, .55, .8, .55, .75, 3)], g_cargo_pod: [B(.1, .2, 0, .9, .8, .6, 2), B(.1, .19, .25, .9, .2, .32, 3)],
    g_beacon_post: [B(.45, .45, 0, .55, .55, .8, 2), B(.38, .38, .8, .62, .62, .92, 3)], g_pipe_cluster: [B(.1, .4, 0, .25, .55, 1, 2), B(.35, .4, 0, .5, .55, 1, 2), B(.1, .4, .6, .9, .55, .72, 2)],
    g_bulkhead_panel: [B(0, .4, 0, 1, .6, 1, 2), B(.1, .39, .1, .9, .4, .14, 3), B(.1, .39, .86, .9, .4, .9, 3)], g_airlock_frame: [B(0, .4, 0, .2, .6, 1, 2), B(.8, .4, 0, 1, .6, 1, 2), B(0, .4, .8, 1, .6, 1, 2), B(.2, .45, .78, .8, .55, .8, 3)],
    g_neon_sign: [B(.1, .45, .55, .9, .55, .9, 2), B(.15, .44, .6, .85, .45, .85, 3), B(.48, .48, 0, .52, .52, .55, 2)], g_vending_machine: [B(.2, .3, 0, .8, .7, .95, 2), B(.25, .29, .4, .75, .3, .88, 3)],
    g_cable_bundle: [B(0, .45, .7, 1, .55, .78, 2), B(.3, .45, .4, .36, .55, .7, 2)], g_shutter_front: [B(0, .4, 0, 1, .6, 1, 2), B(0, .39, 0, 1, .4, .6, 1), B(0, .39, .8, 1, .4, .9, 3)], g_neon_arch: [B(0, .45, 0, .12, .55, 1, 2), B(.88, .45, 0, 1, .55, 1, 2), B(0, .45, .88, 1, .55, 1, 3)],
    g_barrel_fire: [B(.3, .3, 0, .7, .7, .55, 2), B(.36, .36, .55, .64, .64, .7, 3)], g_scrap_heap: [B(.1, .2, 0, .9, .8, .3, 2), B(.25, .3, .3, .7, .7, .55, 1), B(.4, .4, .55, .55, .55, .7, 2)],
    g_wreck_panel: [B(.1, .45, 0, .9, .55, .7, 2), B(.6, .44, .5, .9, .45, .7, 1)], g_scrap_wall: [B(0, .4, 0, 1, .6, .7, 2), B(.2, .4, .7, .7, .6, .9, 1)], g_rebar_arch: [B(0, .45, 0, .1, .55, 1, 2), B(.9, .45, 0, 1, .55, 1, 2), B(0, .45, .9, 1, .55, 1, 2)],
    g_boiler: [B(.2, .25, 0, .8, .75, .8, 2), B(.4, .4, .8, .55, .55, 1, 1), B(.25, .24, .3, .45, .25, .5, 3)], g_gear_wheel: [B(.1, .45, .1, .9, .55, .9, 2), B(.4, .44, .4, .6, .45, .6, 1)],
    g_arc_lamp: [B(.45, .45, 0, .55, .55, .85, 2), B(.4, .4, .85, .6, .6, .95, 3)], g_iron_girder: [B(0, .4, .85, 1, .6, 1, 2), B(.1, .45, 0, .2, .55, .85, 2), B(.8, .45, 0, .9, .55, .85, 2)], g_foundry_arch: [B(0, .4, 0, .2, .6, 1, 1), B(.8, .4, 0, 1, .6, 1, 1), B(0, .4, .8, 1, .6, 1, 2)],
    g_hitching_post: [B(.1, .45, 0, .18, .55, .5, 2), B(.82, .45, 0, .9, .55, .5, 2), B(.1, .45, .42, .9, .55, .5, 2)], g_water_tower: [B(.2, .2, .5, .8, .8, 1, 2), B(.22, .22, 0, .3, .3, .5, 2), B(.7, .7, 0, .78, .78, .5, 2)],
    g_saloon_sign: [B(.1, .45, .6, .9, .55, .85, 2), B(.15, .44, .65, .85, .45, .8, 3)], g_boardwalk: [B(0, 0, 0, 1, 1, .12, 2)], g_false_front: [B(0, .4, 0, 1, .6, 1, 2), B(.3, .39, 0, .7, .4, .6, 1)],
    g_street_lamp: [B(.46, .46, 0, .54, .54, .9, 2), B(.4, .4, .9, .7, .6, .96, 3)], g_dumpster: [B(.1, .25, 0, .9, .75, .5, 2)], g_bench: [B(.1, .35, .25, .9, .65, .32, 2), B(.15, .4, 0, .2, .6, .25, 2), B(.8, .4, 0, .85, .6, .25, 2)],
    g_concrete_wall: [B(0, .4, 0, 1, .6, 1, 1)], g_storefront: [B(0, .4, 0, 1, .6, 1, 1), B(.15, .39, .1, .85, .4, .7, 3)],
    g_tentacle_growth: [B(.4, .4, 0, .6, .6, .5, 1), B(.3, .45, .4, .4, .55, .8, 3), B(.6, .45, .3, .7, .55, .7, 3)], g_ritual_circle: [B(.1, .1, 0, .9, .9, .03, 3)], g_non_euclid_arch: [B(0, .4, 0, .2, .6, .8, 1), B(.75, .35, .1, .95, .55, 1, 1), B(0, .45, .8, .9, .6, .95, 3)],
    g_ship_wheel: [B(.2, .45, .25, .8, .55, .85, 2), B(.45, .4, 0, .55, .6, .5, 2)], g_cannon: [B(.1, .4, .2, .9, .6, .4, 1), B(.2, .3, 0, .5, .7, .25, 2)], g_rope_coil: [B(.25, .25, 0, .75, .75, .15, 2)],
    g_hull_plank_wall: [B(0, .4, 0, 1, .6, 1, 2), B(0, .39, .3, 1, .4, .33, 1), B(0, .39, .66, 1, .4, .69, 1)], g_mast: [B(.45, .45, 0, .55, .55, 1, 2), B(.1, .45, .7, .9, .55, .75, 2)],
    g_moon_brazier: [B(.4, .4, 0, .6, .6, .55, 1), B(.25, .25, .55, .75, .75, .7, 1), B(.35, .35, .7, .65, .65, .8, 3)], g_amphora: [B(.38, .38, 0, .62, .62, .55, 2), B(.44, .44, .55, .56, .56, .7, 2)],
    g_temple_step: [B(0, 0, 0, 1, 1, .15, 1), B(.1, .1, .15, .9, .9, .3, 1)], g_column_ruin: [B(.35, .35, 0, .65, .65, .55, 1), B(.3, .3, 0, .7, .7, .08, 1)],
    g_desk: [B(.1, .3, .4, .9, .7, .48, 2), B(.12, .32, 0, .2, .4, .4, 2), B(.8, .6, 0, .88, .68, .4, 2), B(.6, .4, .48, .7, .5, .56, 3)], g_hanging_bulb: [B(.49, .49, .7, .51, .51, 1, 2), B(.45, .45, .62, .55, .55, .7, 3)],
    g_blind_window: [B(0, .45, 0, 1, .55, 1, 1), ...[.25, .35, .45, .55, .65].map(z => B(.15, .44, z, .85, .45, z + .05, 3))]
  };
  const OWNER = {}; for (const [g, k] of Object.entries(GENRES)) for (const s of [...k.props, ...k.building]) if (PARTS[s]) (OWNER[s] ||= []).push(g);
  // Thin trim strips can collapse into the wall at 16^3; give any colliding piece a small unique relief so every shape keeps distinct geometry.
  { const seen = new Set(), key = sh => { const v = new Uint8Array(4096); for (const b of PARTS[sh]) for (let z = Math.floor(b.z0 * 16); z < Math.max(Math.floor(b.z0 * 16) + 1, Math.ceil(b.z1 * 16)); z++) for (let y = Math.floor(b.y0 * 16); y < Math.max(Math.floor(b.y0 * 16) + 1, Math.ceil(b.y1 * 16)); y++) for (let x = Math.floor(b.x0 * 16); x < Math.max(Math.floor(b.x0 * 16) + 1, Math.ceil(b.x1 * 16)); x++) if (x < 16 && y < 16 && z < 16) v[x + y * 16 + z * 256] = 1; return v.join(''); };
    let i = 0; for (const sh of Object.keys(PARTS)) { let k = key(sh); while (seen.has(k)) { const x = (i % 12 + 2) / 16, z = (Math.floor(i / 12) % 12 + 2) / 16; PARTS[sh].push(B(x, .3, z, x + .07, .4, z + .07, 3)); i++; k = key(sh); } seen.add(k); } }
  if (expanded && Expansion) for (const [name, spec] of Object.entries(Expansion.SHAPES)) OWNER[name] = [spec.genre];
  const SHAPES = [...Object.keys(PARTS), ...(expanded && Expansion ? Object.keys(Expansion.SHAPES) : [])];
  const has = s => !!PARTS[s] || !!(expanded && Expansion?.has(s));
  function build(shape, size = 16) {
    if (expanded && Expansion?.has(shape)) return Expansion.build(shape, size);
    const v = new Uint8Array(size ** 3), boxes = PARTS[shape]; if (!boxes) return null;
    for (const b of boxes) for (let z = Math.floor(b.z0 * size); z < Math.max(Math.floor(b.z0 * size) + 1, Math.ceil(b.z1 * size)); z++)
      for (let y = Math.floor(b.y0 * size); y < Math.max(Math.floor(b.y0 * size) + 1, Math.ceil(b.y1 * size)); y++)
        for (let x = Math.floor(b.x0 * size); x < Math.max(Math.floor(b.x0 * size) + 1, Math.ceil(b.x1 * size)); x++) if (x < size && y < size && z < size) v[x + y * size + z * size * size] = 1; // binary occupancy (scenePropVoxels contract); material comes from matAt() in color()
    return v;
  }
  // Material id at a unit-space point (for color()): last box wins, like build().
  const matAt = (shape, x, y, z) => { let m = 1; for (const b of PARTS[shape] || []) if (x >= b.x0 - .02 && x <= b.x1 + .02 && y >= b.y0 - .02 && y <= b.y1 + .02 && z >= b.z0 - .02 && z <= b.z1 + .02) m = b.m; return m; };
  function color(shape, x, y, z, normal, base, material, options = {}) { // same face shading bands as the pyramid/city path
    if (expanded && Expansion?.has(shape)) return Expansion.color(shape, x, y, z, normal);
    const g = GENRES[options.genre] || GENRES[OWNER[shape]?.[0]] || GENRES.fantasy, P = g.palette, m = matAt(shape, x, y, z);
    const hex = m === 3 ? P.highlight : m === 2 ? P.secondary : P.primary;
    const k = (normal[2] > .5 ? 1.08 : normal[0] + normal[1] > 0 ? .92 : .78) * (m === 3 ? 1.15 : 1) * (Math.floor((x + y + z) * 16) % 7 === 0 ? .9 : 1);
    return rgb(hex).map(v => Math.min(1, v / 255 * k));
  }
  const emissive = shape => (PARTS[shape] || []).some(b => b.m === 3) && /lamp|candle|neon|beacon|rune|crystal|brazier|fire|bulb|sign|eldritch|console|arc/.test(shape);
  // Children of the Grave compatibility: a prefab is tagged when every genre that owns it is fantasy-family.
  const COTG_TAGS = SHAPES.filter(s => (OWNER[s] || []).some(g => COTG_ALLOWED.includes(g)) && !/console|neon|vending|cargo|bulkhead|airlock|beacon|pipe|street_lamp|dumpster|bench|storefront|concrete|desk|bulb|blind|scrap|wreck|rebar|barrel_fire|boiler|gear|girder|foundry|arc_lamp|saloon|water_tower|hitching|boardwalk|false_front|cannon|ship_wheel/.test(s));
  return { GENRES, ALIASES, PLANS, HELD, PARTS, SHAPES, OWNER, COTG_ALLOWED, COTG_TAGS, genreOf, resolve, characterSpec, gearHook, has, build, color, emissive, snap };
});
