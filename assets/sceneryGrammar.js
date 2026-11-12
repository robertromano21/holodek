'use strict';
const Sprites = require('./scenerySprites');
const Layout = require('./sceneryLayout');
const Assemblies = require('./sceneryAssemblies');
// Compositional scenery grammar for preview room art. Gated behind richer recipe fields.
// Unknown kind names are composed from parts / name tokens (deterministic, no stock fallback).

const PROFILES = ['block', 'taper', 'cylinder', 'mound', 'spire', 'pyramid', 'hull', 'arch', 'dome', 'slab', 'cluster', 'stalk'];
const BODIES = ['shaft', 'hall', 'cottage', 'keep', 'trunk', 'tank', 'stall', 'hut', 'hull_body', 'chamber'];
const CAPS = ['none', 'gable', 'hip', 'flat', 'dome', 'cone', 'battlement', 'lantern_house', 'blades', 'canopy', 'onion', 'dish', 'spire_cap', 'thatch', 'snow'];
const OPENINGS = ['none', 'door', 'windows', 'arcade', 'portholes', 'oculus', 'door_and_windows'];
const TRIMS = ['none', 'cornice', 'banding', 'railing', 'pilasters', 'gallery'];
const ATTACH = ['none', 'chimney', 'banner', 'antenna', 'stairs', 'dock', 'lantern', 'vines', 'roots', 'balcony', 'mast', 'wheel', 'rail', 'buttress'];
const TEXTURES = ['plain', 'masonry', 'planks', 'stipple', 'rivets', 'bark', 'coral', 'facets', 'scales'];
const CONDITIONS = ['intact', 'weathered', 'ruined', 'overgrown'];
const FACINGS = ['left', 'right', 'front', 'three_quarter'];
const PART_SLOTS = ['profile', 'body', 'cap', 'openings', 'trim', 'attachments', 'texture', 'condition', 'facing', 'scale'];
const PART_VARIANTS = { profile: PROFILES, body: BODIES, cap: CAPS, openings: OPENINGS, trim: TRIMS, attachments: ATTACH, texture: TEXTURES, condition: CONDITIONS, facing: FACINGS, scale: ['tiny', 'small', 'normal', 'large', 'huge'] };

function K(profile, body, cap, openings, trim, attachments, texture, condition) {
  return { profile, body, cap, openings, trim, attachments, texture, condition: condition || 'intact' };
}

// Named shortcuts. Descriptive scenery only — no characters, gameplay doors, treasure or clues.
const KIND_LIBRARY = {

  broadleaf: K('stalk', 'trunk', 'canopy', 'none', 'none', 'none', 'bark', 'intact'),
  gate_wall: K('slab', 'hall', 'battlement', 'arcade', 'none', 'none', 'masonry', 'intact'),
  wall_gate: K('slab', 'hall', 'battlement', 'arcade', 'none', 'none', 'masonry', 'intact'),
  stone_bridge: K('slab', 'hall', 'none', 'arcade', 'railing', 'none', 'masonry', 'intact'),
  stone_statue: K('taper', 'shaft', 'none', 'none', 'none', 'none', 'masonry', 'intact'),
  plaza_fountain: K('cylinder', 'tank', 'none', 'none', 'banding', 'none', 'masonry', 'intact'),
  water_well: K('cylinder', 'hut', 'hip', 'none', 'none', 'none', 'masonry', 'intact'),
  dome_building: K('dome', 'chamber', 'dome', 'windows', 'banding', 'none', 'masonry', 'intact'),
  domed_hall: K('dome', 'chamber', 'dome', 'windows', 'banding', 'none', 'masonry', 'intact'),
  spire: K('spire', 'shaft', 'spire_cap', 'windows', 'none', 'none', 'masonry', 'intact'),
  canvas_tent: K('block', 'stall', 'cone', 'none', 'none', 'none', 'plain', 'intact'),
  palm_tree: K('stalk', 'trunk', 'canopy', 'none', 'none', 'none', 'bark', 'intact'),
  rock_formation: K('mound', 'keep', 'none', 'none', 'none', 'none', 'facets', 'weathered'),
  cliff: K('slab', 'keep', 'none', 'none', 'none', 'none', 'facets', 'weathered'),
  water_fall: K('slab', 'keep', 'none', 'none', 'none', 'none', 'facets', 'intact'),
  crystal_cluster: K('spire', 'shaft', 'none', 'none', 'none', 'none', 'facets', 'intact'),
  royal_throne: K('block', 'chamber', 'none', 'none', 'pilasters', 'none', 'masonry', 'intact'),
  stone_altar: K('block', 'chamber', 'flat', 'none', 'cornice', 'none', 'masonry', 'intact'),
  book_case: K('slab', 'hall', 'none', 'none', 'none', 'none', 'planks', 'intact'),
  brazier_stand: K('cylinder', 'tank', 'none', 'none', 'none', 'none', 'rivets', 'weathered'),
  hanging_banner: K('slab', 'hall', 'none', 'none', 'none', 'banner', 'plain', 'intact'),
  wall_banner: K('slab', 'hall', 'none', 'none', 'none', 'banner', 'plain', 'intact'),
  machine_console: K('block', 'keep', 'flat', 'windows', 'banding', 'antenna', 'rivets', 'intact'),
  // natural
  crag: K('spire', 'keep', 'none', 'none', 'none', 'none', 'facets', 'weathered'),
  butte: K('slab', 'keep', 'flat', 'none', 'none', 'none', 'masonry', 'weathered'),
  mesa: K('slab', 'hall', 'flat', 'none', 'none', 'none', 'stipple', 'weathered'),
  volcano: K('mound', 'keep', 'cone', 'none', 'none', 'none', 'facets', 'weathered'),
  glacier: K('mound', 'hall', 'snow', 'none', 'none', 'none', 'facets', 'intact'),
  iceberg: K('cluster', 'keep', 'snow', 'none', 'none', 'none', 'facets', 'intact'),
  boulder: K('mound', 'tank', 'none', 'none', 'none', 'none', 'facets', 'weathered'),
  standing_stone: K('slab', 'shaft', 'none', 'none', 'none', 'none', 'facets', 'weathered'),
  menhir: K('taper', 'shaft', 'none', 'none', 'none', 'none', 'masonry', 'weathered'),
  cave_mouth: K('arch', 'chamber', 'none', 'oculus', 'none', 'none', 'stipple', 'weathered'),
  coral_spire: K('spire', 'shaft', 'none', 'none', 'none', 'none', 'coral', 'intact'),
  coral_fan: K('cluster', 'stalk', 'none', 'none', 'none', 'none', 'coral', 'intact'),
  kelp_stalk: K('stalk', 'trunk', 'canopy', 'none', 'none', 'none', 'scales', 'intact'),
  mushroom: K('stalk', 'trunk', 'dome', 'none', 'none', 'none', 'scales', 'intact'),
  giant_fern: K('stalk', 'trunk', 'canopy', 'none', 'none', 'none', 'stipple', 'intact'),
  dead_tree: K('stalk', 'trunk', 'none', 'none', 'none', 'roots', 'bark', 'ruined'),
  willow: K('stalk', 'trunk', 'canopy', 'none', 'none', 'vines', 'bark', 'intact'),
  pine: K('stalk', 'trunk', 'spire_cap', 'none', 'none', 'none', 'bark', 'intact'),
  baobab: K('cylinder', 'trunk', 'canopy', 'none', 'none', 'roots', 'bark', 'weathered'),
  cactus: K('cylinder', 'shaft', 'none', 'none', 'none', 'none', 'scales', 'intact'),
  reed_clump: K('cluster', 'stalk', 'none', 'none', 'none', 'none', 'stipple', 'intact'),
  geyser: K('mound', 'shaft', 'none', 'none', 'none', 'none', 'stipple', 'weathered'),
  ice_spike: K('spire', 'shaft', 'snow', 'none', 'none', 'none', 'facets', 'intact'),
  crystal_spire: K('spire', 'shaft', 'spire_cap', 'none', 'none', 'none', 'facets', 'intact'),
  geode: K('mound', 'chamber', 'none', 'oculus', 'none', 'none', 'facets', 'intact'),
  root_tangle: K('cluster', 'trunk', 'none', 'none', 'none', 'roots', 'bark', 'overgrown'),
  swamp_knoll: K('mound', 'hut', 'canopy', 'none', 'none', 'vines', 'stipple', 'overgrown'),
  termite_mound: K('mound', 'keep', 'spire_cap', 'none', 'none', 'none', 'stipple', 'weathered'),
  nest: K('mound', 'hut', 'none', 'none', 'none', 'none', 'stipple', 'intact'),
  ivy_mass: K('cluster', 'hall', 'none', 'none', 'none', 'vines', 'stipple', 'overgrown'),
  // built
  cottage: K('block', 'cottage', 'gable', 'door_and_windows', 'cornice', 'chimney', 'planks', 'intact'),
  hall_house: K('block', 'hall', 'gable', 'windows', 'cornice', 'none', 'masonry', 'intact'),
  barn: K('block', 'hall', 'gable', 'door', 'none', 'none', 'planks', 'weathered'),
  mill: K('block', 'keep', 'gable', 'windows', 'banding', 'wheel', 'masonry', 'intact'),
  windmill: K('taper', 'shaft', 'cone', 'windows', 'gallery', 'blades' in ATTACH ? 'wheel' : 'wheel', 'masonry', 'intact'),
  lighthouse: K('taper', 'shaft', 'lantern_house', 'windows', 'gallery', 'rail', 'masonry', 'intact'),
  watchtower: K('taper', 'shaft', 'battlement', 'windows', 'cornice', 'balcony', 'masonry', 'intact'),
  keep_tower: K('block', 'keep', 'battlement', 'windows', 'cornice', 'buttress', 'masonry', 'intact'),
  pagoda: K('taper', 'keep', 'hip', 'windows', 'cornice', 'none', 'planks', 'intact'),
  minaret: K('taper', 'shaft', 'onion', 'windows', 'gallery', 'none', 'masonry', 'intact'),
  granary: K('cylinder', 'tank', 'cone', 'door', 'banding', 'none', 'planks', 'intact'),
  silo: K('cylinder', 'tank', 'dome', 'none', 'banding', 'none', 'planks', 'intact'),
  hut: K('block', 'hut', 'thatch', 'door', 'none', 'none', 'planks', 'weathered'),
  longhouse: K('slab', 'hall', 'thatch', 'door_and_windows', 'none', 'none', 'planks', 'intact'),
  stilt_house: K('block', 'cottage', 'hip', 'windows', 'none', 'stairs', 'planks', 'intact'),
  market_stall: K('block', 'stall', 'thatch', 'none', 'none', 'none', 'planks', 'intact'),
  shopfront: K('block', 'hall', 'flat', 'door_and_windows', 'cornice', 'awning' , 'masonry', 'intact'),
  chapel: K('block', 'hall', 'gable', 'windows', 'pilasters', 'none', 'masonry', 'intact'),
  shrine: K('block', 'hut', 'gable', 'door', 'pilasters', 'lantern', 'masonry', 'intact'),
  bell_tower: K('taper', 'shaft', 'spire_cap', 'arcade', 'cornice', 'none', 'masonry', 'intact'),
  clock_tower: K('taper', 'shaft', 'gable', 'windows', 'cornice', 'none', 'masonry', 'intact'),
  fountain_bowl: K('cylinder', 'tank', 'none', 'none', 'banding', 'none', 'masonry', 'intact'),
  well_house: K('cylinder', 'hut', 'hip', 'none', 'none', 'none', 'masonry', 'intact'),
  pier: K('slab', 'hall', 'none', 'none', 'railing', 'dock', 'planks', 'weathered'),
  dock: K('slab', 'hall', 'none', 'none', 'railing', 'dock', 'planks', 'weathered'),
  ship: K('hull', 'hull_body', 'none', 'portholes', 'none', 'mast', 'planks', 'intact'),
  shipwreck: K('hull', 'hull_body', 'none', 'portholes', 'none', 'mast', 'planks', 'ruined'),
  boat: K('hull', 'hull_body', 'none', 'none', 'none', 'none', 'planks', 'intact'),
  wagon: K('block', 'stall', 'none', 'none', 'none', 'wheel', 'planks', 'weathered'),
  crane: K('taper', 'shaft', 'none', 'none', 'none', 'antenna', 'planks', 'weathered'),
  chimney_stack: K('taper', 'shaft', 'none', 'none', 'banding', 'chimney', 'masonry', 'weathered'),
  kiln: K('dome', 'tank', 'dome', 'door', 'none', 'chimney', 'masonry', 'weathered'),
  forge: K('block', 'hut', 'flat', 'door', 'none', 'chimney', 'masonry', 'weathered'),
  waterwheel: K('cylinder', 'shaft', 'none', 'none', 'none', 'wheel', 'planks', 'weathered'),
  palisade: K('slab', 'hall', 'none', 'none', 'none', 'none', 'planks', 'weathered'),
  gatehouse: K('block', 'keep', 'battlement', 'arcade', 'cornice', 'none', 'masonry', 'intact'),
  tent_pavilion: K('block', 'stall', 'cone', 'none', 'none', 'banner', 'plain', 'intact'),
  monument: K('taper', 'shaft', 'spire_cap', 'none', 'plinth' in TRIMS ? 'cornice' : 'cornice', 'none', 'masonry', 'intact'),
  cairn: K('cluster', 'mound', 'none', 'none', 'none', 'none', 'facets', 'weathered'),
  totem: K('taper', 'shaft', 'none', 'none', 'banding', 'none', 'planks', 'weathered'),
  column_ruin: K('taper', 'shaft', 'none', 'none', 'none', 'none', 'masonry', 'ruined'),
  arch_ruin: K('arch', 'hall', 'none', 'arcade', 'none', 'none', 'masonry', 'ruined'),
  wind_catcher: K('taper', 'shaft', 'flat', 'none', 'banding', 'none', 'masonry', 'intact'),
  pagoda_gate: K('arch', 'hall', 'hip', 'arcade', 'cornice', 'none', 'planks', 'intact'),
  // interior scenery (not treasure, not gameplay doors)
  throne: K('block', 'chamber', 'none', 'none', 'pilasters', 'none', 'masonry', 'intact'),
  dais: K('slab', 'hall', 'none', 'none', 'cornice', 'stairs', 'masonry', 'intact'),
  lectern: K('taper', 'shaft', 'flat', 'none', 'none', 'none', 'planks', 'intact'),
  pew: K('slab', 'stall', 'none', 'none', 'none', 'none', 'planks', 'intact'),
  banquet_table: K('slab', 'hall', 'none', 'none', 'none', 'none', 'planks', 'intact'),
  workbench: K('slab', 'stall', 'none', 'none', 'none', 'none', 'planks', 'weathered'),
  anvil: K('block', 'tank', 'none', 'none', 'none', 'none', 'rivets', 'weathered'),
  loom: K('block', 'stall', 'none', 'none', 'none', 'none', 'planks', 'intact'),
  cauldron: K('cylinder', 'tank', 'none', 'none', 'none', 'none', 'rivets', 'weathered'),
  candelabra: K('stalk', 'shaft', 'none', 'none', 'none', 'lantern', 'plain', 'intact'),
  fireplace: K('arch', 'chamber', 'flat', 'none', 'cornice', 'chimney', 'masonry', 'weathered'),
  hearth: K('slab', 'chamber', 'none', 'none', 'banding', 'none', 'masonry', 'weathered'),
  tapestry: K('slab', 'hall', 'none', 'none', 'none', 'banner', 'plain', 'intact'),
  screen_panel: K('slab', 'hall', 'none', 'none', 'pilasters', 'none', 'planks', 'intact'),
  organ_pipes: K('cluster', 'shaft', 'none', 'none', 'none', 'none', 'rivets', 'intact'),
  barrel: K('cylinder', 'tank', 'none', 'none', 'banding', 'none', 'planks', 'weathered'),
  amphora: K('taper', 'tank', 'cone', 'none', 'none', 'none', 'plain', 'intact'),
  vase: K('taper', 'tank', 'none', 'none', 'banding', 'none', 'plain', 'intact'),
  urn: K('cylinder', 'tank', 'dome', 'none', 'banding', 'none', 'masonry', 'intact'),
  bellows: K('hull', 'stall', 'none', 'none', 'none', 'none', 'plain', 'weathered'),
  tool_rack: K('slab', 'hall', 'none', 'none', 'none', 'none', 'planks', 'weathered'),
  pottery_wheel: K('cylinder', 'stall', 'none', 'none', 'none', 'wheel', 'planks', 'weathered'),
  // sci-fi / other-worldly
  alien_pylon: K('taper', 'shaft', 'spire_cap', 'none', 'banding', 'antenna', 'facets', 'intact'),
  monolith_alien: K('slab', 'shaft', 'none', 'none', 'none', 'none', 'facets', 'intact'),
  landing_spire: K('taper', 'shaft', 'dish', 'none', 'gallery', 'antenna', 'rivets', 'intact'),
  dome_habitat: K('dome', 'chamber', 'dome', 'portholes', 'banding', 'none', 'rivets', 'intact'),
  dish_antenna: K('stalk', 'shaft', 'dish', 'none', 'none', 'antenna', 'rivets', 'intact'),
  pipe_cluster: K('cluster', 'shaft', 'none', 'none', 'none', 'none', 'rivets', 'weathered'),
  tank_sphere: K('dome', 'tank', 'dome', 'none', 'banding', 'none', 'rivets', 'intact'),
  gantry: K('slab', 'hall', 'flat', 'none', 'railing', 'antenna', 'rivets', 'weathered'),
  walkway: K('slab', 'hall', 'none', 'none', 'railing', 'none', 'rivets', 'intact'),
  spore_tower: K('taper', 'shaft', 'canopy', 'none', 'none', 'none', 'coral', 'overgrown'),
  hive_spire: K('spire', 'keep', 'onion', 'none', 'banding', 'none', 'scales', 'overgrown'),
  bone_arch: K('arch', 'hall', 'none', 'arcade', 'none', 'none', 'facets', 'weathered'),
  chitin_hall: K('block', 'hall', 'dome', 'arcade', 'banding', 'none', 'scales', 'intact'),
  floating_rock: K('mound', 'keep', 'none', 'none', 'none', 'none', 'facets', 'intact'),
  sky_anchor: K('taper', 'shaft', 'dish', 'none', 'none', 'antenna', 'rivets', 'intact'),
  warp_obelisk: K('taper', 'shaft', 'spire_cap', 'none', 'banding', 'none', 'facets', 'intact'),
  capsule: K('cylinder', 'tank', 'dome', 'portholes', 'banding', 'none', 'rivets', 'intact'),
  solar_sail: K('slab', 'hall', 'none', 'none', 'none', 'antenna', 'plain', 'intact'),
  arcology_block: K('block', 'keep', 'flat', 'windows', 'banding', 'antenna', 'rivets', 'intact'),
  bio_vent: K('mound', 'tank', 'none', 'none', 'none', 'none', 'coral', 'overgrown'),
  glass_spire: K('spire', 'shaft', 'spire_cap', 'windows', 'none', 'none', 'facets', 'intact'),
  rust_tower: K('taper', 'shaft', 'battlement', 'windows', 'banding', 'antenna', 'rivets', 'ruined'),
  wreck_frame: K('cluster', 'hull_body', 'none', 'none', 'none', 'antenna', 'rivets', 'ruined'),
  // sky
  thunderhead: K('cluster', 'hall', 'dome', 'none', 'none', 'none', 'stipple', 'intact'),
  lenticular: K('dome', 'hall', 'dome', 'none', 'none', 'none', 'stipple', 'intact'),
  aurora_band: K('slab', 'hall', 'none', 'none', 'none', 'none', 'plain', 'intact'),
  comet: K('spire', 'shaft', 'none', 'none', 'none', 'none', 'plain', 'intact'),
  ringed_planet: K('dome', 'tank', 'none', 'none', 'banding', 'none', 'plain', 'intact'),
  nebula: K('cluster', 'hall', 'none', 'none', 'none', 'none', 'stipple', 'intact'),
  airship: K('hull', 'hull_body', 'gondola' , 'portholes', 'none', 'antenna', 'planks', 'intact'),
  balloon: K('dome', 'tank', 'none', 'none', 'none', 'none', 'plain', 'intact'),
  hanging_lanterns: K('cluster', 'stalk', 'none', 'none', 'none', 'lantern', 'plain', 'intact'),
  flock: K('cluster', 'stalk', 'none', 'none', 'none', 'none', 'plain', 'intact'),
  distant_figures: K('cluster', 'stalk', 'none', 'none', 'none', 'none', 'plain', 'intact')
};

// Fix any typo keys from the compact initializer (shopfront awning, windmill, airship gondola, monument)
KIND_LIBRARY.windmill = K('taper', 'shaft', 'cone', 'windows', 'gallery', 'wheel', 'masonry', 'intact');
KIND_LIBRARY.shopfront = K('block', 'hall', 'flat', 'door_and_windows', 'cornice', 'balcony', 'masonry', 'intact');
KIND_LIBRARY.monument = K('taper', 'shaft', 'spire_cap', 'none', 'cornice', 'none', 'masonry', 'intact');
KIND_LIBRARY.airship = K('hull', 'hull_body', 'none', 'portholes', 'none', 'antenna', 'planks', 'intact');

const TOKEN_HINTS = [
  [/pylon|obelisk|minaret|lighthouse|spire|steeple|needle/, { profile: 'taper', body: 'shaft', cap: 'spire_cap' }],
  [/tower|keep|turret|watch/, { profile: 'taper', body: 'keep', cap: 'battlement', openings: 'windows' }],
  [/house|hall|cottage|home|lodge|inn|tavern/, { profile: 'block', body: 'cottage', cap: 'gable', openings: 'door_and_windows' }],
  [/barn|shed|warehouse|mill/, { profile: 'block', body: 'hall', cap: 'gable', openings: 'door' }],
  [/stall|booth|kiosk|stand|market/, { profile: 'block', body: 'stall', cap: 'thatch' }],
  [/hut|shack|cabin/, { profile: 'block', body: 'hut', cap: 'thatch', openings: 'door' }],
  [/tent|pavilion|awning|canopy/, { profile: 'block', body: 'stall', cap: 'cone' }],
  [/ship|boat|wreck|barge|galley|skiff/, { profile: 'hull', body: 'hull_body', attachments: 'mast' }],
  [/pier|dock|wharf|jetty/, { profile: 'slab', body: 'hall', trim: 'railing', attachments: 'dock' }],
  [/tree|pine|oak|willow|fir|grove/, { profile: 'stalk', body: 'trunk', cap: 'canopy', texture: 'bark' }],
  [/mushroom|fungus|spore|toadstool/, { profile: 'stalk', body: 'trunk', cap: 'dome', texture: 'scales' }],
  [/coral|reef|anemone/, { profile: 'spire', body: 'shaft', texture: 'coral' }],
  [/rock|crag|cliff|boulder|stone|menhir/, { profile: 'mound', body: 'keep', texture: 'facets' }],
  [/mountain|peak|butte|mesa|volcano|glacier/, { profile: 'pyramid', body: 'keep', cap: 'none', texture: 'facets' }],
  [/cloud|nebula|mist|vapor/, { profile: 'cluster', body: 'hall', texture: 'stipple' }],
  [/dome|habitat|sphere|planet/, { profile: 'dome', body: 'chamber', cap: 'dome' }],
  [/antenna|dish|radar|array/, { profile: 'stalk', body: 'shaft', cap: 'dish', attachments: 'antenna', texture: 'rivets' }],
  [/pipe|tank|silo|cistern|capsule/, { profile: 'cylinder', body: 'tank', cap: 'dome', texture: 'rivets' }],
  [/arch|gatehouse|portal|bridge/, { profile: 'arch', body: 'hall', openings: 'arcade' }],
  [/throne|dais|altar|seat/, { profile: 'block', body: 'chamber', trim: 'pilasters' }],
  [/chimney|stack|kiln|forge|hearth|fireplace/, { profile: 'taper', body: 'shaft', attachments: 'chimney', texture: 'masonry' }],
  [/wagon|cart|carriage/, { profile: 'block', body: 'stall', attachments: 'wheel', texture: 'planks' }],
  [/lantern|lamp|candelabra|brazier/, { profile: 'stalk', body: 'shaft', attachments: 'lantern' }],
  [/ruin|wreck|broken|rubble/, { condition: 'ruined' }],
  [/overgrown|ivy|vine|wild/, { condition: 'overgrown', attachments: 'vines' }],
  [/snow|ice|frost|glacier/, { cap: 'snow', texture: 'facets' }],
  [/alien|warp|crystal|glass/, { texture: 'facets', cap: 'spire_cap' }]
];

function isKindName(kind) {
  return typeof kind === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(kind);
}
function isLibraryKind(kind) { return !!(kind && KIND_LIBRARY[kind]); }

function validateParts(raw) {
  if (raw == null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid component parts.');
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!PART_SLOTS.includes(key)) throw Error('Invalid component part slot.');
    const val = raw[key];
    if (val === 'none' || val == null) continue;
    if (key === 'attachments') {
      const list = Array.isArray(val) ? val : [val];
      if (!list.length || list.length > 6 || list.some(v => typeof v !== 'string' || (!ATTACH.includes(v) && v !== 'none' && !/^[a-z][a-z0-9_]{0,30}$/.test(v)))) throw Error('Invalid component attachments.');
      const clean = list.filter(v => v && v !== 'none');
      if (clean.length) out.attachments = clean.length === 1 ? clean[0] : clean;
      continue;
    }
    if (key === 'scale') {
      if (typeof val === 'number' && val > 0 && val <= 8) { out.scale = val; continue; }
      if (typeof val === 'string' && (PART_VARIANTS.scale.includes(val) || /^[a-z][a-z0-9_]{0,20}$/.test(val))) { out.scale = val; continue; }
      throw Error('Invalid component scale.');
    }
    if (typeof val !== 'string' || val.length > 40) throw Error('Invalid component part.');
    const known = PART_VARIANTS[key];
    if (known && !known.includes(val) && !/^[a-z][a-z0-9_]{0,30}$/.test(val)) throw Error('Invalid component part variant.');
    out[key] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

function tokenize(kind) { return String(kind || '').toLowerCase().split(/[_-]+/).filter(Boolean); }

function inferFromName(kind, hashFn) {
  const tokens = tokenize(kind);
  const parts = {};
  for (const [re, hint] of TOKEN_HINTS) if (tokens.some(t => re.test(t)) || re.test(kind)) Object.assign(parts, hint);
  // Deterministic unique composition from the name itself — not a single stock object.
  const h = (hashFn || (s => { let x = 2166136261; for (const c of String(s)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; }))(kind);
  const pick = (arr, salt) => arr[(h + salt) % arr.length];
  if (!parts.profile) parts.profile = pick(PROFILES, 3);
  if (!parts.body) parts.body = pick(BODIES, 11);
  if (!parts.cap) parts.cap = pick(CAPS.filter(c => c !== 'none'), 19);
  if (!parts.openings) parts.openings = (h & 3) ? 'none' : pick(['windows', 'door', 'none'], 29);
  if (!parts.trim) parts.trim = (h & 5) ? 'none' : pick(TRIMS, 41);
  if (!parts.attachments) parts.attachments = 'none';
  if (!parts.texture) parts.texture = pick(TEXTURES, 53);
  if (!parts.condition) parts.condition = 'intact';
  return parts;
}

function composeParts(p, hashFn) {
  const lib = KIND_LIBRARY[p.kind] ? { ...KIND_LIBRARY[p.kind] } : inferFromName(p.kind, hashFn);
  const over = p.parts || {};
  const out = { ...lib };
  for (const k of PART_SLOTS) if (over[k] !== undefined && over[k] !== 'none') out[k] = over[k];
  if (over.attachments === 'none') out.attachments = 'none';
  if (over.cap === 'none') out.cap = 'none';
  return out;
}

function midShadow(c, s, mixHex, lumaOf) {
  const cand = mixHex(s, c, 0.4);
  const midL = lumaOf(c), shL = lumaOf(cand);
  const floor = Math.max(36, midL * 0.48);
  if (shL < floor) {
    const t = Math.min(0.7, (floor - shL) / Math.max(1, midL - shL));
    return mixHex(cand, c, t);
  }
  return cand;
}

function attachList(v) { return !v || v === 'none' ? [] : [].concat(v); }

function paintScenery(p, cols, tools) {
  if (Assemblies.handles(p)) { Assemblies.paint(p, tools, cols); return; }
  if (Sprites.handles(p.kind)) { Sprites.paint(p.kind, tools, p, cols); return; }
  const { rect, line, poly, ellipse, mixHex, lumaOf, hash, litLeft } = tools;
  const { x, y, w, h, count } = p;
  const c = cols.c, s0 = cols.s, d = cols.d;
  const s = midShadow(c, s0, mixHex, lumaOf);
  const deep = mixHex(s0, '#000000', 0.35);
  const parts = composeParts(p, hash);
  const litL = parts.facing === 'left' ? true : parts.facing === 'right' ? false : litLeft(x + w / 2);
  const lit = mixHex(c, d, 0.4), shade = s;
  const cx = x + w / 2, baseY = y + h;

  function bodyPoly(pts) {
    poly(pts, shade, deep);
    // lit face: left or right half-ish
    const litPts = pts.map(([px, py]) => [litL ? Math.min(px, cx) : Math.max(px, cx), py]);
    // only draw if it has area
    if (litPts.some((q, i) => q[0] !== pts[i][0])) {
      const mid = litL
        ? [[cx, y], [cx, baseY]]
        : [[cx, baseY], [cx, y]];
      // simpler: a vertical lit band
    }
    const band = Math.max(2, Math.round(w * 0.22));
    // filled after main poly: overlay lit wedge from bbox
  }

  function profileFill() {
    const pr = parts.profile;
    if (pr === 'taper' || pr === 'spire') {
      const topW = pr === 'spire' ? Math.max(2, w * 0.12) : Math.max(3, w * 0.32);
      poly([[x, baseY], [cx - topW / 2, y], [cx + topW / 2, y], [x + w, baseY]], shade, deep);
      if (litL) poly([[x, baseY], [cx - topW / 2, y], [cx, y], [cx, baseY]], lit);
      else poly([[cx, y], [cx + topW / 2, y], [x + w, baseY], [cx, baseY]], lit);
    } else if (pr === 'pyramid') {
      poly([[x, baseY], [cx, y], [x + w, baseY]], shade, deep);
      const litW = Math.max(3, w * 0.28);
      if (litL) poly([[cx - litW, baseY], [cx, y], [cx + 1, baseY]], lit);
      else poly([[cx - 1, baseY], [cx, y], [cx + litW, baseY]], lit);
    } else if (pr === 'mound') {
      const pts = [[x, baseY]];
      const n = 5;
      for (let i = 0; i <= n; i++) {
        const px = x + i * w / n, t = i / n;
        const rise = Math.sin(t * Math.PI) * h * (0.75 + (hash(p.kind + i + x) % 20) / 100);
        pts.push([px, baseY - rise]);
      }
      pts.push([x + w, baseY]);
      poly(pts, shade, deep);
    } else if (pr === 'dome') {
      ellipse(x, y, w, h, shade);
      ellipse(x + 1, y + 1, w - 2, h - 2, c);
      if (litL) ellipse(x + 1, y + 1, w * 0.45, h * 0.85, lit);
      else ellipse(x + w * 0.5, y + 1, w * 0.45, h * 0.85, lit);
    } else if (pr === 'hull') {
      const midY = y + h * 0.45;
      poly([[x + w * 0.08, midY], [x + w * 0.2, y + h * 0.15], [x + w * 0.8, y + h * 0.15], [x + w * 0.92, midY], [x + w * 0.85, baseY], [x + w * 0.15, baseY]], shade, deep);
      poly([[x + w * 0.2, y + h * 0.15], [x + w * 0.8, y + h * 0.15], [x + w * 0.75, midY], [x + w * 0.25, midY]], litL ? lit : shade);
    } else if (pr === 'arch') {
      rect(x, y + h * 0.15, w, h * 0.85, deep);
      rect(x + 1, y + h * 0.15 + 1, w - 2, h * 0.85 - 2, c);
      const aw = w * 0.62, ax = cx - aw / 2, ah = h * 0.7, ay = y + h * 0.2;
      ellipse(ax, ay, aw, ah, 0);
      rect(ax + 2, ay + ah * 0.45, aw - 4, h - (ay + ah * 0.45 - y), 0);
      if (litL) rect(x + 1, y + h * 0.15 + 1, Math.max(2, w * 0.18), h * 0.85 - 2, lit);
      else rect(x + w - 1 - Math.max(2, w * 0.18), y + h * 0.15 + 1, Math.max(2, w * 0.18), h * 0.85 - 2, lit);
    } else if (pr === 'cluster') {
      const n = Math.max(3, Math.min(count || 3, 7));
      for (let i = 0; i < n; i++) {
        const ww = w / n * 1.4, xx = x + i * (w - ww * 0.6) / Math.max(1, n - 1);
        const hh = h * (0.55 + (hash('cl' + i + x + p.kind) % 40) / 100);
        const yy = baseY - hh;
        poly([[xx, baseY], [xx + ww * 0.5, yy], [xx + ww, baseY]], i % 2 ? shade : c, deep);
        if (litL) poly([[xx, baseY], [xx + ww * 0.5, yy], [xx + ww * 0.5, baseY]], lit);
      }
    } else if (pr === 'stalk') {
      const sw = Math.max(2, w * 0.18);
      rect(cx - sw / 2 - 1, y + h * 0.25, sw + 2, h * 0.75, deep);
      rect(cx - sw / 2, y + h * 0.25, sw, h * 0.75, c);
      if (litL) rect(cx - sw / 2, y + h * 0.25, Math.max(1, sw * 0.4), h * 0.75, lit);
      else rect(cx + sw / 2 - Math.max(1, sw * 0.4), y + h * 0.25, Math.max(1, sw * 0.4), h * 0.75, lit);
    } else if (pr === 'cylinder') {
      ellipse(x, y + h * 0.72, w, h * 0.28, shade);
      rect(x, y + h * 0.15, w, h * 0.7, shade);
      rect(x + 1, y + h * 0.15, w - 2, h * 0.7, c);
      ellipse(x, y, w, h * 0.3, c);
      const band = Math.max(2, Math.round(w * 0.2));
      if (litL) rect(x + 1, y + h * 0.15, band, h * 0.7, lit);
      else rect(x + w - 1 - band, y + h * 0.15, band, h * 0.7, lit);
      ellipse(x + 2, y + 2, w * 0.45, h * 0.18, lit);
    } else if (pr === 'slab') {
      const inset = Math.max(0, w * 0.04);
      poly([[x + inset, baseY], [x, y], [x + w, y], [x + w - inset, baseY]], shade, deep);
      rect(x + 1, y + 1, w - 2, h - 2, c);
      const band = Math.max(2, Math.round(w * 0.18));
      if (litL) rect(x + 1, y + 1, band, h - 2, lit);
      else rect(x + w - 1 - band, y + 1, band, h - 2, lit);
    } else {
      // block
      rect(x, y, w, h, deep);
      rect(x + 1, y + 1, w - 2, h - 2, c);
      const band = Math.max(2, Math.round(w * 0.2));
      if (litL) rect(x + 1, y + 1, band, h - 2, lit);
      else rect(x + w - 1 - band, y + 1, band, h - 2, lit);
    }
  }

  function drawCap() {
    const cap = parts.cap;
    if (!cap || cap === 'none') return;
    const cy = y, ch = Math.max(4, Math.round(h * 0.28)), cw = w;
    if (cap === 'gable' || cap === 'hip') {
      const peakX = litL ? x + w * 0.42 : x + w * 0.58;
      poly([[x - 2, y + ch], [peakX, y], [x + w + 2, y + ch]], shade, deep);
      if (litL) poly([[x - 2, y + ch], [peakX, y], [peakX, y + ch]], lit);
      else poly([[peakX, y], [x + w + 2, y + ch], [peakX, y + ch]], lit);
    } else if (cap === 'cone' || cap === 'spire_cap' || cap === 'onion') {
      const top = cap === 'spire_cap' ? y - h * 0.06 : y;
      if (cap === 'onion') {
        ellipse(x + w * 0.15, y, w * 0.7, ch * 1.2, shade);
        ellipse(x + w * 0.22, y + 1, w * 0.4, ch * 0.7, lit);
        rect(cx - 1, y - 2, 2, 5, deep);
      } else {
        poly([[x, y + ch], [cx, top], [x + w, y + ch]], shade, deep);
        if (litL) poly([[x, y + ch], [cx, top], [cx, y + ch]], lit);
        else poly([[cx, top], [x + w, y + ch], [cx, y + ch]], lit);
      }
    } else if (cap === 'dome') {
      ellipse(x, y, w, ch * 1.6, shade);
      ellipse(x + 2, y + 1, w * 0.5, ch, lit);
    } else if (cap === 'battlement') {
      rect(x - 2, y, w + 4, Math.max(4, ch * 0.6), deep);
      rect(x - 1, y + 1, w + 2, Math.max(3, ch * 0.6 - 1), c);
      const merlons = Math.max(3, Math.min(count || 3, 7));
      for (let i = 0; i < merlons; i++) rect(x + i * w / merlons, y - 3, Math.max(2, w / merlons * 0.45), 4, i % 2 ? c : shade);
    } else if (cap === 'lantern_house') {
      const lw = Math.max(6, w * 0.55), lx = cx - lw / 2, lh = Math.max(6, ch);
      rect(lx, y, lw, lh, deep);
      rect(lx + 1, y + 1, lw - 2, lh - 2, d);
      poly([[lx - 2, y], [cx, y - ch * 0.5], [lx + lw + 2, y]], shade, deep);
      rect(lx + 2, y + 2, lw - 4, 2, mixHex(d, '#fff6c8', 0.4));
    } else if (cap === 'blades') {
      const n = 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.3;
        line(cx, y + ch, cx + Math.cos(a) * w * 0.7, y + ch + Math.sin(a) * h * 0.45, deep);
        line(cx, y + ch, cx + Math.cos(a) * w * 0.55, y + ch + Math.sin(a) * h * 0.35, c);
      }
    } else if (cap === 'canopy') {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const ww = w * (0.45 + (i % 3) * 0.12), xx = x + (i / (n - 1)) * (w - ww), hh = h * (0.28 + (hash('can' + i + x) % 20) / 100);
        ellipse(xx, y, ww, hh, i % 2 ? c : shade);
      }
    } else if (cap === 'dish') {
      ellipse(x, y, w, ch * 1.4, shade);
      ellipse(x + 2, y + 1, w - 4, ch, lit);
      line(cx, y, cx, y + ch, deep);
    } else if (cap === 'thatch') {
      poly([[x - 3, y + ch], [cx, y], [x + w + 3, y + ch]], shade, deep);
      for (let i = 0; i < 5; i++) line(x + i * w / 5, y + ch - 1, cx, y + 2, mixHex(c, s, 0.3));
    } else if (cap === 'snow') {
      poly([[x + w * 0.2, y + ch], [cx, y], [x + w * 0.8, y + ch * 0.8]], d);
    } else if (cap === 'flat') {
      rect(x - 2, y, w + 4, Math.max(3, ch * 0.4), deep);
      rect(x - 1, y + 1, w + 2, Math.max(2, ch * 0.4 - 1), c);
    }
  }

  function drawOpenings() {
    const o = parts.openings;
    if (!o || o === 'none') return;
    const bodyY = y + h * 0.32, bodyH = h * 0.68;
    if (o === 'door' || o === 'door_and_windows') {
      const dw = Math.max(3, Math.round(w * 0.18)), dh = Math.max(6, Math.round(h * 0.32));
      const dx = Math.round(cx - dw / 2), dy = baseY - dh;
      rect(dx, dy, dw, dh, deep);
      rect(dx + 1, dy + 1, dw - 2, dh - 2, s0);
    }
    if (o === 'windows' || o === 'door_and_windows') {
      const nw = Math.min(4, Math.max(1, count || 2));
      for (let i = 1; i <= nw; i++) {
        const wx = Math.round(x + i * w / (nw + 1) - 2), wy = Math.round(y + h * 0.4);
        if (wx < x + 2 || wx + 4 > x + w - 2) continue;
        rect(wx, wy, 4, 5, deep);
        rect(wx + 1, wy + 1, 2, 3, d);
      }
    }
    if (o === 'arcade') {
      const n = Math.max(2, Math.min(count || 3, 5));
      for (let i = 0; i < n; i++) {
        const aw = w / n * 0.7, ax = x + i * w / n + w / n * 0.15, ah = h * 0.45, ay = baseY - ah;
        ellipse(ax, ay, aw, ah, 0);
        rect(ax + 1, ay + ah * 0.45, aw - 2, ah * 0.55, 0);
      }
    }
    if (o === 'portholes') {
      const n = Math.max(2, Math.min(count || 3, 5));
      for (let i = 0; i < n; i++) {
        const px = x + (i + 0.7) * w / (n + 1), py = y + h * 0.45;
        ellipse(px, py, 4, 4, deep);
        ellipse(px + 1, py + 1, 2, 2, d);
      }
    }
    if (o === 'oculus') {
      ellipse(cx - 4, y + h * 0.4, 8, 6, deep);
      ellipse(cx - 3, y + h * 0.4 + 1, 6, 4, d);
    }
  }

  function drawTrim() {
    const t = parts.trim;
    if (!t || t === 'none') return;
    if (t === 'cornice' || t === 'gallery') {
      rect(x - 2, y + h * 0.28, w + 4, 3, deep);
      rect(x - 1, y + h * 0.28 + 1, w + 2, 1, d);
    }
    if (t === 'banding') {
      for (const f of [0.45, 0.7]) line(x + 1, y + h * f, x + w - 2, y + h * f, mixHex(c, s, 0.4));
    }
    if (t === 'railing') {
      line(x, y + h * 0.15, x + w, y + h * 0.15, deep);
      for (let i = 0; i <= 6; i++) line(x + i * w / 6, y + h * 0.15, x + i * w / 6, y + h * 0.28, s0);
    }
    if (t === 'pilasters') {
      rect(x + 1, y + h * 0.3, 2, h * 0.7, lit);
      rect(x + w - 3, y + h * 0.3, 2, h * 0.7, s0);
    }
  }

  function drawAttachments() {
    for (const a of attachList(parts.attachments)) {
      if (a === 'chimney') {
        const cw = Math.max(3, w * 0.12), cx2 = x + w * 0.78;
        rect(cx2, y - 4, cw, h * 0.28, deep);
        rect(cx2 + 1, y - 3, cw - 2, h * 0.26, c);
      } else if (a === 'banner') {
        rect(x + w * 0.7, y + h * 0.2, 1, h * 0.5, deep);
        poly([[x + w * 0.7, y + h * 0.2], [x + w * 0.95, y + h * 0.28], [x + w * 0.7, y + h * 0.36]], d, deep);
      } else if (a === 'antenna') {
        line(cx, y, cx, y - h * 0.2, deep);
        line(cx, y - h * 0.12, cx + w * 0.2, y - h * 0.18, s0);
      } else if (a === 'stairs') {
        const n = 4;
        for (let i = 0; i < n; i++) rect(x - 4 + i, baseY - (i + 1) * (h * 0.08), w * 0.25, 2, i % 2 ? c : s);
      } else if (a === 'dock') {
        rect(x, baseY - 3, w, 3, s0);
        for (let i = 0; i < 4; i++) rect(x + i * w / 4, baseY, 2, 4, deep);
      } else if (a === 'lantern') {
        ellipse(cx - 2, y + h * 0.1, 5, 5, d);
        rect(cx - 1, y + h * 0.1 + 5, 2, 3, s0);
      } else if (a === 'vines' || a === 'roots') {
        for (let i = 0; i < 5; i++) {
          const xx = x + (hash('v' + i + x + p.kind) % Math.max(2, w));
          line(xx, a === 'roots' ? baseY : y + h * 0.3, xx + (i % 2 ? 3 : -3), a === 'roots' ? y + h * 0.7 : baseY, mixHex(c, '#2a4a28', 0.4));
        }
      } else if (a === 'balcony') {
        rect(x + w * 0.15, y + h * 0.4, w * 0.7, 3, deep);
        line(x + w * 0.15, y + h * 0.34, x + w * 0.85, y + h * 0.34, s0);
      } else if (a === 'mast') {
        line(cx, y - h * 0.15, cx, baseY - h * 0.2, deep);
        poly([[cx, y - h * 0.1], [cx + w * 0.35, y + h * 0.15], [cx, y + h * 0.12]], mixHex(c, d, 0.3), deep);
      } else if (a === 'wheel') {
        const wr = Math.max(6, Math.min(w, h) * 0.45), wx = x - wr * 0.2, wy = baseY - wr;
        ellipse(wx, wy, wr, wr, deep);
        ellipse(wx + 2, wy + 2, wr - 4, wr - 4, c);
        line(wx + wr / 2, wy, wx + wr / 2, wy + wr, s0);
        line(wx, wy + wr / 2, wx + wr, wy + wr / 2, s0);
      } else if (a === 'rail') {
        rect(x - 2, y + h * 0.2, w + 4, 2, deep);
      } else if (a === 'buttress') {
        poly([[x - w * 0.15, baseY], [x, y + h * 0.4], [x, baseY]], shade, deep);
        poly([[x + w, baseY], [x + w, y + h * 0.4], [x + w + w * 0.15, baseY]], shade, deep);
      }
    }
  }

  function drawTexture() {
    const t = parts.texture;
    if (!t || t === 'plain') return;
    const n = t === 'stipple' ? 18 : t === 'masonry' ? 0 : 10;
    if (t === 'masonry') {
      for (let yy = y + 4; yy < baseY - 3; yy += 5)
        for (let xx = x + 2 + ((yy / 5) & 1) * 3; xx < x + w - 4; xx += 7) {
          line(xx, yy, Math.min(x + w - 3, xx + 5), yy, mixHex(c, s, 0.35));
        }
    } else if (t === 'planks') {
      for (let yy = y + 4; yy < baseY - 2; yy += 4) line(x + 2, yy, x + w - 3, yy, mixHex(c, s, 0.3));
    } else if (t === 'rivets') {
      for (let i = 0; i < 8; i++) rect(x + 2 + (hash('rv' + i + x) % Math.max(2, w - 4)), y + 3 + (hash('ry' + i + x) % Math.max(2, h - 6)), 1, 1, d);
    } else if (t === 'bark' || t === 'stipple' || t === 'coral' || t === 'scales' || t === 'facets') {
      for (let i = 0; i < (t === 'stipple' ? 22 : 12); i++) {
        const xx = x + 1 + (hash('tx' + i + x + p.kind) % Math.max(2, w - 2));
        const yy = y + 1 + (hash('ty' + i + x + p.kind) % Math.max(2, h - 2));
        rect(xx, yy, t === 'facets' ? 2 : 1, 1, i % 3 ? mixHex(c, s, 0.4) : d);
      }
    }
  }

  function drawCondition() {
    const cd = parts.condition;
    if (!cd || cd === 'intact') return;
    if (cd === 'weathered' || cd === 'ruined') {
      const n = cd === 'ruined' ? 8 : 4;
      for (let i = 0; i < n; i++) {
        const xx = x + (hash('cd' + i + x + p.kind) % Math.max(2, w));
        const yy = y + (hash('cy' + i + x) % Math.max(2, h));
        line(xx, yy, xx + 2 + (i % 3), yy + 3, deep);
      }
      if (cd === 'ruined' && h > 12) rect(x + w * 0.55, y, w * 0.35, 3, 0);
    }
    if (cd === 'overgrown') {
      for (let i = 0; i < 6; i++) {
        const xx = x + (hash('og' + i + x) % Math.max(2, w));
        line(xx, baseY, xx + (i % 2 ? 2 : -2), baseY - h * 0.3, mixHex(c, '#3a5a30', 0.5));
      }
    }
  }

  const plantKind = /^(pine|willow|dead_tree|giant_fern|cactus|mushroom|kelp_stalk)$/.test(p.kind);
  if (plantKind || (parts.profile === 'stalk' && (parts.cap === 'canopy' || parts.cap === 'spire_cap'))) {
    const sw = Math.max(3, Math.round(w * (p.kind === 'baobab' ? 0.28 : 0.16)));
    rect(cx - sw / 2 - 1, y + h * 0.45, sw + 2, h * 0.55, deep);
    rect(cx - sw / 2, y + h * 0.45, sw, h * 0.55, c);
    if (litL) rect(cx - sw / 2, y + h * 0.45, Math.max(1, sw * 0.4), h * 0.55, lit);
    if (p.kind === 'pine' || parts.cap === 'spire_cap') {
      const layersN = 4;
      for (let i = 0; i < layersN; i++) {
        const t = i / layersN, ww = w * (0.95 - t * 0.55), hh = h * 0.22, yy = y + t * h * 0.48;
        poly([[cx - ww / 2, yy + hh], [cx, yy], [cx + ww / 2, yy + hh]], i % 2 ? shade : c, deep);
        if (litL) poly([[cx - ww / 2, yy + hh], [cx, yy], [cx, yy + hh]], lit);
      }
    } else if (p.kind === 'willow' || parts.cap === 'canopy') {
      ellipse(x, y, w, h * 0.48, shade);
      ellipse(x + 2, y + 2, w * 0.55, h * 0.32, lit);
      for (let i = 0; i < 6; i++) {
        const xx = x + 4 + i * (w - 8) / 5;
        line(xx, y + h * 0.28, xx + (i % 2 ? 2 : -2), y + h * 0.62, mixHex(c, s0, 0.3));
      }
    } else if (p.kind === 'mushroom') {
      ellipse(x, y, w, h * 0.45, shade);
      ellipse(x + 2, y + 2, w * 0.55, h * 0.28, lit);
    }
    drawAttachments();
    drawCondition();
    line(x, baseY - 1, x + w, baseY - 1, deep);
    return;
  }
  profileFill();
  drawCap();
  drawOpenings();
  drawTrim();
  drawTexture();
  drawAttachments();
  drawCondition();
  line(x, baseY - 1, x + w, baseY - 1, deep);
}

function shouldPaint(p, richer, knownKinds) {
  if (!p || !p.kind) return false;
  if (p.parts || p.assembly) return true;
  const known = knownKinds || [];
  if (known.includes(p.kind)) return false;
  if (Assemblies.hasPreset(p.kind) || isLibraryKind(p.kind)) return !!richer;
  return false;
}

function variantCount() {
  return Object.values(PART_VARIANTS).reduce((n, a) => n + a.length, 0);
}

module.exports = {
  PART_SLOTS, PART_VARIANTS, KIND_LIBRARY, CONDITIONS, FACINGS,
  isKindName, isLibraryKind, validateParts, composeParts, inferFromName,
  paintScenery, shouldPaint, midShadow, applyLayout: Layout.applyLayout,
  validateAssembly: Assemblies.validateAssembly,
  hasPreset: Assemblies.hasPreset,
  pieceTypes: require('./sceneryPieces').PIECE_TYPES,
  presetNames: Assemblies.presetNames,
  bespokeKinds: Assemblies.BESPOKE,
  libraryKindNames: Object.keys(KIND_LIBRARY).sort(),
  libraryKindCount: Object.keys(KIND_LIBRARY).length,
  variantCount: variantCount()
};
