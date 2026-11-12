'use strict';
// Named assemblies (presets) and a Lego-style assembler. Pieces snap at sockets.
// LLM may author a compact stack/attach/repeat list; only malformed assemblies are rejected.

const Pieces = require('./sceneryPieces');
const S = require('./scenerySprites');
const { paintPiece, isPieceType, sockets, parseVariant, PIECE_TYPES } = Pieces;

const CONDITIONS = Pieces.CONDITIONS;

const WEIGHT = {
  plinth: 0.14, floor: 0.12, wall_seg: 0.55, tower_body: 0.62, setback: 0.2,
  roof: 0.3, chimney: 0.18, column: 0.9, colonnade_bay: 1, arch: 1, archway: 1,
  stairs: 0.28, trunk: 0.65, foliage: 0.42, frond: 0.3, root: 0.18, rock: 0.5,
  ledge: 0.2, crystal: 0.4, panel: 0.4, dish: 0.35, antenna: 0.25, fence: 0.2,
  railing: 0.16, banner: 0.4, lantern: 0.25, door: 0.35, window: 0.25,
  balcony: 0.22, buttress: 0.5, awning: 0.2, pipe: 0.3, vent: 0.2, coil: 0.3,
  gear: 0.25, wheel: 0.2, blade: 0.4, branch: 0.25
};

const ATTACH_SIZE = {
  window: (b) => ({ w: Math.max(4, Math.round(b.w * 0.2)), h: Math.max(5, Math.round(b.h * 0.28)) }),
  door: (b) => ({ w: Math.max(5, Math.round(b.w * 0.22)), h: Math.max(8, Math.round(b.h * 0.48)) }),
  chimney: (b) => ({ w: Math.max(4, Math.round(b.w * 0.16)), h: Math.max(6, Math.round(b.h * 0.7)) }),
  balcony: (b) => ({ w: Math.max(8, Math.round(b.w * 0.55)), h: Math.max(5, Math.round(b.h * 0.28)) }),
  banner: (b) => ({ w: Math.max(5, Math.round(b.w * 0.18)), h: Math.max(10, Math.round(b.h * 0.7)) }),
  lantern: (b) => ({ w: Math.max(6, 8), h: Math.max(18, Math.round(Math.max(b.h, 48) * 0.38)) }),
  awning: (b) => ({ w: Math.max(8, Math.round(b.w * 0.7)), h: Math.max(5, Math.round(b.h * 0.28)) }),
  antenna: (b) => ({ w: Math.max(5, Math.round(b.w * 0.4)), h: Math.max(8, Math.round(b.h * 0.5)) }),
  pipe: (b) => ({ w: Math.max(3, Math.round(b.w * 0.14)), h: Math.max(8, Math.round(b.h * 0.5)) }),
  vent: (b) => ({ w: Math.max(5, Math.round(b.w * 0.22)), h: Math.max(4, Math.round(b.h * 0.2)) }),
  dish: (b) => ({ w: Math.max(8, Math.round(b.w * 0.7)), h: Math.max(6, Math.round(b.h * 0.45)) }),
  railing: (b) => ({ w: b.w, h: Math.max(4, Math.round(b.h * 0.2)) }),
  fence: (b) => ({ w: b.w, h: Math.max(6, Math.round(b.h * 0.4)) }),
  buttress: (b) => ({ w: Math.max(5, Math.round(b.w * 0.22)), h: Math.max(10, Math.round(b.h * 0.8)) }),
  stairs: (b) => ({ w: Math.max(8, Math.round(b.w * 0.45)), h: Math.max(8, Math.round(b.h * 0.45)) }),
  blade: (b) => ({ w: Math.max(10, Math.round(b.w * 1.6)), h: Math.max(5, Math.round(b.h * 0.22)) }),
  wheel: (b) => ({ w: Math.max(8, Math.round(Math.min(b.w, b.h) * 0.42)), h: Math.max(8, Math.round(Math.min(b.w, b.h) * 0.42)) }),
  trunk: (b) => ({ w: Math.max(6, Math.round(b.w * 0.55)), h: Math.max(8, Math.round(b.h * 0.35)) }),
  tower_body: (b) => ({ w: Math.max(8, Math.round(b.w * 0.28)), h: Math.max(16, Math.round(b.h * 1.15)) }),
  archway: (b) => ({ w: Math.max(10, Math.round(b.w * 0.55)), h: Math.max(10, Math.round(b.h * 0.62)) }),
  roof: (b) => ({ w: Math.max(8, Math.round(b.w * 1.1)), h: Math.max(6, Math.round(b.h * 0.22)) }),
  branch: (b) => ({ w: Math.max(8, Math.round(b.w * 0.7)), h: Math.max(6, Math.round(b.h * 0.4)) }),
  foliage: (b) => ({ w: Math.max(8, Math.round(b.w * 1.2)), h: Math.max(8, Math.round(b.h * 0.7)) }),
  frond: (b) => ({ w: Math.max(8, Math.round(b.w * 0.9)), h: Math.max(8, Math.round(b.h * 0.55)) }),
  root: (b) => ({ w: Math.max(8, Math.round(b.w * 1.2)), h: Math.max(5, Math.round(b.h * 0.3)) }),
  crystal: (b) => ({ w: Math.max(4, Math.round(b.w * 0.3)), h: Math.max(6, Math.round(b.h * 0.4)) }),
  antenna: (b) => ({ w: Math.max(4, Math.round(b.w * 0.35)), h: Math.max(7, Math.round(b.h * 0.45)) })
};

function Sref(piece, variant, extra) {
  return Object.assign({ piece, variant: variant || 'plain' }, extra || {});
}

// Named kind presets. Tweaks (roof, windows, material, condition) overlay these.
const PRESETS = {
  cottage: { stack: [Sref('wall_seg', 'plank_windowed', { id: 'wall', h: 0.62 }), Sref('roof', 'gable', { id: 'roof', h: 0.38 })], attach: [Sref('door', 'plank', { on: 'wall.front', at: 0.42 }), Sref('chimney', 'brick', { on: 'roof.top', at: 0.78 })] },
  hut: { stack: [Sref('wall_seg', 'adobe_plain', { id: 'wall', h: 0.58 }), Sref('roof', 'thatch', { id: 'roof', h: 0.42 })], attach: [Sref('door', 'plank', { on: 'wall.front', at: 0.4 })] },
  barn: { stack: [Sref('wall_seg', 'plank_plain', { id: 'wall', h: 0.62 }), Sref('roof', 'gable', { id: 'roof', h: 0.38 })], attach: [Sref('door', 'heavy', { on: 'wall.front', at: 0.38 }), Sref('window', 'slit', { on: 'wall.front', at: 0.72 })] },
  hall_house: { stack: [Sref('wall_seg', 'timber_windowed', { id: 'wall', h: 0.64 }), Sref('roof', 'gable', { id: 'roof', h: 0.36 })], attach: [Sref('door', 'plank', { on: 'wall.front', at: 0.45 }), Sref('chimney', 'stone', { on: 'roof.top', at: 0.8 })] },
  longhouse: { stack: [Sref('wall_seg', 'timber_plain', { id: 'wall', h: 0.6 }), Sref('roof', 'thatch', { id: 'roof', h: 0.4 })], attach: [Sref('door', 'plank', { on: 'wall.front', at: 0.15 }), Sref('door', 'plank', { on: 'wall.front', at: 0.7 })] },
  shopfront: { stack: [Sref('wall_seg', 'plank_windowed', { id: 'wall', h: 0.66 }), Sref('roof', 'flat', { id: 'roof', h: 0.2 }), Sref('awning', 'cloth', { id: 'awn', h: 0.14 })], attach: [Sref('door', 'plank', { on: 'wall.front', at: 0.15 })] },
  chapel: { stack: [Sref('wall_seg', 'stone_windowed', { id: 'wall', h: 0.55 }), Sref('roof', 'gable', { id: 'roof', h: 0.32 })], attach: [Sref('door', 'arched', { on: 'wall.front', at: 0.42 }), Sref('window', 'stained', { on: 'wall.front', at: 0.18 }), Sref('window', 'stained', { on: 'wall.front', at: 0.7 })] },
  shrine: { stack: [Sref('plinth', 'stone', { id: 'base', h: 0.18 }), Sref('wall_seg', 'stone_plain', { id: 'wall', h: 0.5 }), Sref('roof', 'hip', { id: 'roof', h: 0.32 })], attach: [Sref('door', 'arched', { on: 'wall.front', at: 0.4 })] },
  pagoda: { stack: [Sref('plinth', 'stone', { id: 'base', h: 0.1 }), Sref('tower_body', 'segmented', { id: 'shaft', h: 0.4 }), Sref('roof', 'pagoda', { id: 'roof', h: 0.5 })] },
  pagoda_gate: { stack: [Sref('archway', 'stone', { id: 'arch', h: 0.7 }), Sref('roof', 'pagoda', { id: 'roof', h: 0.3 })] },
  lighthouse: { stack: [Sref('plinth', 'stone', { id: 'base', h: 0.08 }), Sref('tower_body', 'tapered', { id: 'shaft', h: 0.58 }), Sref('setback', 'stone', { id: 'lantern', h: 0.14 }), Sref('roof', 'cone', { id: 'roof', h: 0.2 })], attach: [Sref('window', 'lit', { on: 'shaft.front', at: 0.4 }), Sref('window', 'arched_lit', { on: 'lantern.front', at: 0.3 })] },
  watchtower: { stack: [Sref('plinth', 'stone', { id: 'base', h: 0.1 }), Sref('tower_body', 'tapered', { id: 'shaft', h: 0.66 }), Sref('roof', 'battlement', { id: 'roof', h: 0.24 })], attach: [Sref('window', 'slit', { on: 'shaft.front', at: 0.28 }), Sref('window', 'slit', { on: 'shaft.front', at: 0.55 }), Sref('balcony', 'stone', { on: 'shaft.front', at: 0.35 })] },
  keep_tower: { stack: [Sref('tower_body', 'square', { id: 'shaft', h: 0.78 }), Sref('roof', 'battlement', { id: 'roof', h: 0.22 })], attach: [Sref('window', 'slit', { on: 'shaft.front', at: 0.3 }), Sref('window', 'slit', { on: 'shaft.front', at: 0.6 }), Sref('door', 'heavy', { on: 'shaft.front', at: 0.42 })] },
  clock_tower: { stack: [Sref('tower_body', 'square', { id: 'shaft', h: 0.7 }), Sref('roof', 'gable', { id: 'roof', h: 0.3 })], attach: [Sref('window', 'round', { on: 'shaft.front', at: 0.4 }), Sref('window', 'arched', { on: 'shaft.front', at: 0.2 })] },
  bell_tower: { stack: [Sref('tower_body', 'square', { id: 'shaft', h: 0.62 }), Sref('archway', 'stone', { id: 'belfry', h: 0.2 }), Sref('roof', 'hip', { id: 'roof', h: 0.18 })] },
  minaret: { stack: [Sref('tower_body', 'round', { id: 'shaft', h: 0.62 }), Sref('setback', 'stone', { id: 'gal', h: 0.12 }), Sref('roof', 'cone', { id: 'roof', h: 0.26 })], attach: [Sref('balcony', 'stone', { on: 'gal.front', at: 0.2 })] },
  stilt_house: { stack: [Sref('column', 'plain', { id: 'stilts', h: 0.28 }), Sref('floor', 'plank', { id: 'deck', h: 0.08 }), Sref('wall_seg', 'plank_windowed', { id: 'wall', h: 0.38 }), Sref('roof', 'thatch', { id: 'roof', h: 0.26 })], attach: [Sref('door', 'plank', { on: 'wall.front', at: 0.4 })] },
  granary: { stack: [Sref('tower_body', 'round', { id: 'shaft', h: 0.7 }), Sref('roof', 'cone', { id: 'roof', h: 0.3 })], attach: [Sref('door', 'plank', { on: 'shaft.front', at: 0.4 }), Sref('window', 'slit', { on: 'shaft.front', at: 0.35 })] },
  silo: { stack: [Sref('tower_body', 'round', { id: 'shaft', h: 0.78 }), Sref('roof', 'dome', { id: 'roof', h: 0.22 })] },
  mill: { stack: [Sref('wall_seg', 'stone_plain', { id: 'wall', h: 0.7 }), Sref('roof', 'gable', { id: 'roof', h: 0.3 })], attach: [Sref('wheel', 'wood', { on: 'wall.left', at: 0.3 }), Sref('door', 'plank', { on: 'wall.front', at: 0.45 })] },
  kiln: { stack: [Sref('wall_seg', 'brick_plain', { id: 'wall', h: 0.55 }), Sref('roof', 'dome', { id: 'roof', h: 0.3 }), Sref('chimney', 'brick', { id: 'stack', h: 0.15 })], attach: [Sref('door', 'heavy', { on: 'wall.front', at: 0.4 }), Sref('vent', 'brick', { on: 'wall.front', at: 0.75 })] },
  forge: { stack: [Sref('wall_seg', 'brick_plain', { id: 'wall', h: 0.6 }), Sref('roof', 'gable', { id: 'roof', h: 0.28 }), Sref('chimney', 'brick', { id: 'stack', h: 0.12 })], attach: [Sref('door', 'heavy', { on: 'wall.front', at: 0.35 }), Sref('vent', 'metal', { on: 'wall.front', at: 0.7 })] },
  chimney_stack: { stack: [Sref('chimney', 'brick', { id: 'stack', h: 1 })] },
  windmill: {
    stack: [Sref('tower_body', 'tapered', { id: 'shaft', h: 0.72 }), Sref('roof', 'cone', { id: 'roof', h: 0.16 })],
    attach: [
      Sref('window', 'square', { on: 'shaft.front', at: 0.4 }),
      Sref('door', 'plank', { on: 'shaft.front', at: 0.42 }),
      Sref('blade', 'canvas', { on: 'shaft.front', at: 0.05, wy: 0.12 }),
      Sref('blade', 'canvas', { on: 'shaft.front', at: 0.55, wy: 0.12 })
    ]
  },
  gate_wall: { stack: [Sref('wall_seg', 'stone_buttressed', { id: 'wall', h: 0.78 }), Sref('roof', 'battlement', { id: 'roof', h: 0.22 })], attach: [Sref('archway', 'stone', { on: 'wall.front', at: 0.3 })] },
  wall_gate: { stack: [Sref('wall_seg', 'stone_buttressed', { id: 'wall', h: 0.78 }), Sref('roof', 'battlement', { id: 'roof', h: 0.22 })], attach: [Sref('archway', 'stone', { on: 'wall.front', at: 0.3 })] },
  gatehouse: { stack: [Sref('wall_seg', 'stone_plain', { id: 'wall', h: 0.7 }), Sref('roof', 'battlement', { id: 'roof', h: 0.3 })], attach: [Sref('archway', 'stone', { on: 'wall.front', at: 0.28 }), Sref('window', 'slit', { on: 'wall.front', at: 0.12 }), Sref('window', 'slit', { on: 'wall.front', at: 0.78 })] },
  dome_building: { stack: [Sref('wall_seg', 'stone_windowed', { id: 'wall', h: 0.52 }), Sref('roof', 'dome', { id: 'roof', h: 0.48 })], attach: [Sref('door', 'arched', { on: 'wall.front', at: 0.4 })] },
  domed_hall: { stack: [Sref('wall_seg', 'stone_windowed', { id: 'wall', h: 0.52 }), Sref('roof', 'dome', { id: 'roof', h: 0.48 })], attach: [Sref('door', 'arched', { on: 'wall.front', at: 0.4 })] },
  dome_habitat: { stack: [Sref('wall_seg', 'metal_windowed', { id: 'wall', h: 0.45 }), Sref('roof', 'dome', { id: 'roof', h: 0.55 })], attach: [Sref('door', 'square', { on: 'wall.front', at: 0.4 }), Sref('antenna', 'metal', { on: 'roof.top', at: 0.7 })] },
  spire: { stack: [Sref('tower_body', 'tapered', { id: 'shaft', h: 0.55 }), Sref('roof', 'cone', { id: 'roof', h: 0.45 })], attach: [Sref('window', 'slit', { on: 'shaft.front', at: 0.4 })] },
  glass_spire: { stack: [Sref('tower_body', 'tapered', { id: 'shaft', h: 0.55, variant: 'crystal' }), Sref('roof', 'cone_crystal', { id: 'roof', h: 0.45 })], attach: [Sref('window', 'stained', { on: 'shaft.front', at: 0.4 })] },
  crystal_spire: { stack: [Sref('tower_body', 'tapered', { id: 'shaft', h: 0.5, variant: 'crystal' }), Sref('crystal', 'plain', { id: 'tip', h: 0.5 })] },
  landing_spire: { stack: [Sref('tower_body', 'tapered', { id: 'shaft', h: 0.6, variant: 'metal' }), Sref('roof', 'flat', { id: 'roof', h: 0.12 }), Sref('dish', 'metal', { id: 'dish', h: 0.28 })] },
  rust_tower: { stack: [Sref('tower_body', 'segmented', { id: 'shaft', h: 0.72, variant: 'metal_damaged' }), Sref('roof', 'battlement', { id: 'roof', h: 0.28, variant: 'metal' })], attach: [Sref('pipe', 'metal', { on: 'shaft.right', at: 0.2 }), Sref('vent', 'metal', { on: 'shaft.front', at: 0.6 })], condition: 'weathered' },
  hive_spire: { stack: [Sref('tower_body', 'segmented', { id: 'shaft', h: 0.7, variant: 'organic' }), Sref('roof', 'cone', { id: 'roof', h: 0.3, variant: 'organic' })], attach: [Sref('window', 'round', { on: 'shaft.front', at: 0.35 })] },
  spore_tower: { stack: [Sref('tower_body', 'tapered', { id: 'shaft', h: 0.65, variant: 'organic' }), Sref('foliage', 'clump', { id: 'cap', h: 0.35 })] },
  wind_catcher: { stack: [Sref('tower_body', 'square', { id: 'shaft', h: 0.7, variant: 'adobe' }), Sref('roof', 'flat', { id: 'roof', h: 0.12 }), Sref('vent', 'adobe', { id: 'v1', h: 0.18 })], attach: [Sref('vent', 'adobe', { on: 'shaft.front', at: 0.3 }), Sref('vent', 'adobe', { on: 'shaft.front', at: 0.65 })] },
  sky_anchor: { stack: [Sref('tower_body', 'tapered', { id: 'shaft', h: 0.55, variant: 'metal' }), Sref('antenna', 'metal', { id: 'mast', h: 0.2 }), Sref('dish', 'metal', { id: 'dish', h: 0.25 })] },
  warp_obelisk: { stack: [Sref('plinth', 'crystal', { id: 'base', h: 0.14 }), Sref('tower_body', 'tapered', { id: 'shaft', h: 0.7, variant: 'crystal' }), Sref('antenna', 'crystal', { id: 'tip', h: 0.16 })] },
  monolith_alien: { stack: [Sref('plinth', 'metal', { id: 'base', h: 0.12 }), Sref('wall_seg', 'metal_plain', { id: 'slab', h: 0.88 })], attach: [Sref('panel', 'metal', { on: 'slab.front', at: 0.35 })] },
  monument: { stack: [Sref('plinth', 'stone', { id: 'base', h: 0.2 }), Sref('tower_body', 'tapered', { id: 'shaft', h: 0.8, variant: 'stone' })] },
  standing_stone: { stack: [Sref('rock', 'plain', { id: 'slab', h: 1 })] },
  menhir: { stack: [Sref('rock', 'plain', { id: 'slab', h: 1 })] },
  market_stall: { stack: [Sref('wall_seg', 'plank_plain', { id: 'wall', h: 0.4 }), Sref('awning', 'cloth', { id: 'awn', h: 0.6 })] },
  canvas_tent: { stack: [Sref('roof', 'cone', { id: 'roof', h: 1, variant: 'thatch' })] },
  tent_pavilion: { stack: [Sref('column', 'plain', { id: 'posts', h: 0.35 }), Sref('roof', 'hip', { id: 'roof', h: 0.65, variant: 'thatch' })] },
  palisade: { stack: [Sref('fence', 'timber', { id: 'wall', h: 1 })] },
  pier: { stack: [Sref('floor', 'plank', { id: 'deck', h: 0.35 }), Sref('railing', 'plank', { id: 'rail', h: 0.25 })] },
  dock: { stack: [Sref('floor', 'plank', { id: 'deck', h: 0.4 }), Sref('railing', 'plank', { id: 'rail', h: 0.2 })] },
  walkway: { stack: [Sref('floor', 'stone', { id: 'deck', h: 0.45 }), Sref('railing', 'stone', { id: 'rail', h: 0.55 })] },
  colonnade: { repeat: [Sref('colonnade_bay', 'stone', { n: 5, along: 'right', id: 'bay' })] },
  temple: { stack: [Sref('plinth', 'stone', { id: 'base', h: 0.12 }), Sref('colonnade_bay', 'stone', { id: 'portico', h: 0.62 }), Sref('roof', 'gable', { id: 'roof', h: 0.26 })], repeat: [Sref('colonnade_bay', 'stone', { n: 4, along: 'right', id: 'bay' })] },
  castle: { stack: [Sref('wall_seg', 'stone_buttressed', { id: 'keep', h: 0.7 }), Sref('roof', 'battlement', { id: 'roof', h: 0.16 })], attach: [Sref('tower_body', 'square', { on: 'keep.left', at: 0 }), Sref('tower_body', 'square', { on: 'keep.right', at: 0 }), Sref('roof', 'battlement', { on: 'tower_body.top', at: 0 }), Sref('door', 'heavy', { on: 'keep.front', at: 0.42 }), Sref('window', 'slit', { on: 'keep.front', at: 0.2 }), Sref('window', 'slit', { on: 'keep.front', at: 0.7 })] },
  stone_bridge: { stack: [Sref('archway', 'stone', { id: 'arch', h: 0.7 }), Sref('floor', 'stone', { id: 'deck', h: 0.16 }), Sref('railing', 'stone', { id: 'rail', h: 0.14 })] },
  arch_ruin: { stack: [Sref('archway', 'stone_damaged', { id: 'arch', h: 1 })], condition: 'ruined' },
  column_ruin: { stack: [Sref('column', 'capital', { id: 'col', h: 1 })], condition: 'ruined' },
  throne_room_backdrop: {
    stack: [Sref('wall_seg', 'stone_plain', { id: 'wall', h: 0.22 }), Sref('colonnade_bay', 'stone', { id: 'portico', h: 0.78 })],
    repeat: [Sref('colonnade_bay', 'stone', { n: 6, along: 'right', id: 'bay' })],
    attach: [Sref('banner', 'swallowtail', { on: 'bay.front', at: 0.08 }), Sref('banner', 'swallowtail', { on: 'bay.front', at: 0.82 })]
  },
  chapel_portico: { repeat: [Sref('colonnade_bay', 'stone', { n: 5, along: 'right' })] },
  well_house: { stack: [Sref('wall_seg', 'stone_plain', { id: 'wall', h: 0.55 }), Sref('roof', 'hip', { id: 'roof', h: 0.45 })] },
  water_well: { stack: [Sref('tower_body', 'round', { id: 'shaft', h: 0.55 }), Sref('roof', 'cone', { id: 'roof', h: 0.45 })] },
  plaza_fountain: { stack: [Sref('plinth', 'stone', { id: 'base', h: 0.35 }), Sref('column', 'plain', { id: 'stem', h: 0.3 }), Sref('setback', 'stone', { id: 'bowl', h: 0.35 })] },
  fountain_bowl: { stack: [Sref('plinth', 'stone', { id: 'base', h: 0.4 }), Sref('setback', 'stone', { id: 'bowl', h: 0.6 })] },
  dais: { stack: [Sref('stairs', 'stone', { id: 'steps', h: 0.4 }), Sref('plinth', 'stone', { id: 'top', h: 0.6 })] },
  pine: { stack: [Sref('trunk', 'plain', { id: 'trunk', h: 0.28 }), Sref('foliage', 'needle', { id: 'crown', h: 0.72 })] },
  broadleaf: { stack: [Sref('trunk', 'plain', { id: 'trunk', h: 0.45 }), Sref('foliage', 'clump', { id: 'crown', h: 0.55 })], attach: [Sref('branch', 'plain', { on: 'trunk.left', at: 0.2 }), Sref('branch', 'plain', { on: 'trunk.right', at: 0.35 })] },
  dead_tree: { stack: [Sref('trunk', 'lean', { id: 'trunk', h: 0.7 })], attach: [Sref('branch', 'plain', { on: 'trunk.left', at: 0.15 }), Sref('branch', 'plain', { on: 'trunk.right', at: 0.3 })] },
  willow: { stack: [Sref('trunk', 'plain', { id: 'trunk', h: 0.4 }), Sref('foliage', 'hanging', { id: 'crown', h: 0.6 })] },
  palm_tree: { stack: [Sref('trunk', 'lean', { id: 'trunk', h: 0.62 })], attach: [Sref('frond', 'plain', { on: 'trunk.top', at: 0.05 }), Sref('frond', 'plain', { on: 'trunk.top', at: 0.45 }), Sref('frond', 'plain', { on: 'trunk.top', at: 0.75 })] },
  baobab: { stack: [Sref('root', 'plain', { id: 'roots', h: 0.12 }), Sref('trunk', 'plain', { id: 'trunk', h: 0.5, w: 0.55 }), Sref('foliage', 'clump', { id: 'crown', h: 0.38 })] },
  cactus: { stack: [Sref('trunk', 'plain', { id: 'trunk', h: 1, w: 0.34, variant: 'organic' })], attach: [Sref('trunk', 'organic', { on: 'trunk.left', at: 0.35, wy: 0.2 }), Sref('trunk', 'organic', { on: 'trunk.right', at: 0.5, wy: 0.2 })] },
  giant_fern: { stack: [Sref('trunk', 'organic', { id: 'stem', h: 0.25 })], attach: [Sref('frond', 'plain', { on: 'stem.top', at: 0.1 }), Sref('frond', 'plain', { on: 'stem.top', at: 0.5 }), Sref('frond', 'plain', { on: 'stem.top', at: 0.85 })] },
  reed_clump: { stack: [Sref('foliage', 'needle', { id: 'clump', h: 1, variant: 'organic' })] },
  kelp_stalk: { stack: [Sref('trunk', 'organic', { id: 'stalk', h: 0.7 }), Sref('frond', 'plain', { id: 'fronds', h: 0.3 })] },
  ivy_mass: { stack: [Sref('foliage', 'hanging', { id: 'mass', h: 1 })], condition: 'overgrown' },
  root_tangle: { stack: [Sref('root', 'plain', { id: 'a', h: 0.5 }), Sref('root', 'plain', { id: 'b', h: 0.5 })] },
  nest: { stack: [Sref('foliage', 'clump', { id: 'bowl', h: 0.7 }), Sref('branch', 'plain', { id: 'twig', h: 0.3 })] },
  termite_mound: { stack: [Sref('tower_body', 'tapered', { id: 'mound', h: 1, variant: 'adobe' })], attach: [Sref('window', 'slit', { on: 'mound.front', at: 0.4 })] },
  swamp_knoll: { stack: [Sref('rock', 'organic', { id: 'knoll', h: 0.7 }), Sref('foliage', 'clump', { id: 'tuft', h: 0.3 })] },
  coral_fan: { stack: [Sref('frond', 'plain', { id: 'fan', h: 0.7, variant: 'organic' }), Sref('crystal', 'plain', { id: 'tip', h: 0.3 })] },
  coral_spire: { stack: [Sref('tower_body', 'tapered', { id: 'shaft', h: 0.7, variant: 'organic' }), Sref('crystal', 'plain', { id: 'tip', h: 0.3 })] },
  chitin_hall: { stack: [Sref('wall_seg', 'organic_windowed', { id: 'wall', h: 0.6 }), Sref('roof', 'dome', { id: 'roof', h: 0.4, variant: 'organic' })] },
  bio_vent: { stack: [Sref('wall_seg', 'organic_plain', { id: 'base', h: 0.45 }), Sref('vent', 'organic', { id: 'vent', h: 0.25 }), Sref('coil', 'organic', { id: 'steam', h: 0.3 })] },
  rock_formation: { stack: [Sref('rock', 'plain', { id: 'a', h: 0.55 }), Sref('rock', 'plain', { id: 'b', h: 0.45 })] },
  boulder: { stack: [Sref('rock', 'plain', { id: 'rock', h: 1 })] },
  crag: { stack: [Sref('rock', 'plain', { id: 'a', h: 0.4 }), Sref('ledge', 'plain', { id: 'l', h: 0.2 }), Sref('rock', 'plain', { id: 'b', h: 0.4 })] },
  cliff: { stack: [Sref('rock', 'plain', { id: 'face', h: 0.7 }), Sref('ledge', 'plain', { id: 'l1', h: 0.15 }), Sref('ledge', 'plain', { id: 'l2', h: 0.15 })] },
  floating_rock: { stack: [Sref('rock', 'plain', { id: 'rock', h: 0.85 })] },
  cave_mouth: { stack: [Sref('archway', 'stone', { id: 'mouth', h: 1 }), Sref('rock', 'plain', { id: 'flank', h: 0.2 })] },
  crystal_cluster: { stack: [Sref('crystal', 'plain', { id: 'a', h: 0.55 })], attach: [Sref('crystal', 'plain', { on: 'a.left', at: 0.3 }), Sref('crystal', 'plain', { on: 'a.right', at: 0.15 })] },
  geode: { stack: [Sref('rock', 'plain', { id: 'shell', h: 0.7 }), Sref('crystal', 'plain', { id: 'core', h: 0.3 })] },
  ice_spike: { stack: [Sref('crystal', 'plain', { id: 'spike', h: 1 })] },
  mesa: { stack: [Sref('tower_body', 'square', { id: 'body', h: 0.75, variant: 'adobe' }), Sref('ledge', 'adobe', { id: 'top', h: 0.25 })] },
  butte: { stack: [Sref('tower_body', 'tapered', { id: 'body', h: 0.8, variant: 'adobe' }), Sref('ledge', 'adobe', { id: 'top', h: 0.2 })] },
  cairn: { stack: [Sref('rock', 'plain', { id: 'a', h: 0.35 }), Sref('rock', 'plain', { id: 'b', h: 0.35 }), Sref('rock', 'plain', { id: 'c', h: 0.3 })] },
  totem: { stack: [Sref('plinth', 'timber', { id: 'base', h: 0.12 }), Sref('wall_seg', 'timber_plain', { id: 'a', h: 0.28 }), Sref('wall_seg', 'timber_plain', { id: 'b', h: 0.28 }), Sref('wall_seg', 'timber_plain', { id: 'c', h: 0.32 })], attach: [Sref('banner', 'plain', { on: 'b.front', at: 0.3 })] },
  wagon: { stack: [Sref('wall_seg', 'plank_plain', { id: 'bed', h: 0.45 }), Sref('awning', 'cloth', { id: 'cover', h: 0.35 })], attach: [Sref('wheel', 'wood', { on: 'bed.front', at: 0.08, wy: 0.72 }), Sref('wheel', 'wood', { on: 'bed.front', at: 0.72, wy: 0.72 })] },
  hanging_lanterns: { stack: [Sref('railing', 'metal', { id: 'beam', h: 0.1, pin: 'top' })], attach: [Sref('lantern', 'plain', { on: 'beam.bottom', at: 0.15 }), Sref('lantern', 'plain', { on: 'beam.bottom', at: 0.5 }), Sref('lantern', 'plain', { on: 'beam.bottom', at: 0.8 })] },
  hanging_banner: { stack: [Sref('banner', 'swallowtail', { id: 'flag', h: 1 })] },
  wall_banner: { stack: [Sref('banner', 'square', { id: 'flag', h: 1 })] },
  tapestry: { stack: [Sref('banner', 'square', { id: 'flag', h: 1 })] },
  anvil: { stack: [Sref('plinth', 'stone', { id: 'block', h: 0.45 }), Sref('wall_seg', 'metal_plain', { id: 'body', h: 0.35 }), Sref('setback', 'metal', { id: 'horn', h: 0.2 })] },
  kiln_oven: { stack: [Sref('wall_seg', 'brick_plain', { id: 'wall', h: 0.7 }), Sref('roof', 'dome', { id: 'roof', h: 0.3 })] },
  pottery_wheel: { stack: [Sref('plinth', 'stone', { id: 'base', h: 0.45 }), Sref('wheel', 'wood', { id: 'wheel', h: 0.55 })] },
  machine_console: { stack: [Sref('panel', 'metal', { id: 'a', h: 0.6 }), Sref('coil', 'metal', { id: 'c', h: 0.2 }), Sref('panel', 'metal', { id: 'b', h: 0.2 })] },
  dish_antenna: { stack: [Sref('antenna', 'metal', { id: 'mast', h: 0.35 }), Sref('dish', 'metal', { id: 'dish', h: 0.65 })] },
  alien_pylon: { stack: [Sref('tower_body', 'tapered', { id: 'shaft', h: 0.65, variant: 'metal' }), Sref('crystal', 'plain', { id: 'core', h: 0.2 }), Sref('coil', 'metal', { id: 'ring', h: 0.15 })] },
  gantry: { stack: [Sref('panel', 'metal', { id: 'frame', h: 0.7 }), Sref('railing', 'metal', { id: 'rail', h: 0.3 })] },
  pipe_cluster: { stack: [Sref('pipe', 'metal', { id: 'a', h: 0.5 }), Sref('pipe', 'metal', { id: 'b', h: 0.5 })], attach: [Sref('vent', 'metal', { on: 'a.top', at: 0.3 })] },
  tank_sphere: { stack: [Sref('roof', 'dome', { id: 'tank', h: 0.85, variant: 'metal' }), Sref('pipe', 'metal', { id: 'leg', h: 0.15 })] },
  capsule: { stack: [Sref('tower_body', 'round', { id: 'body', h: 0.75, variant: 'metal' }), Sref('roof', 'dome', { id: 'nose', h: 0.25, variant: 'metal' })] },
  screen_panel: { stack: [Sref('panel', 'metal', { id: 'screen', h: 1 })] },
  solar_sail: { stack: [Sref('antenna', 'metal', { id: 'mast', h: 0.3 }), Sref('panel', 'metal', { id: 'sail', h: 0.7 })] },
  arcology_block: { stack: [Sref('wall_seg', 'metal_windowed', { id: 'a', h: 0.32 }), Sref('setback', 'metal', { id: 'b', h: 0.28 }), Sref('wall_seg', 'metal_windowed', { id: 'c', h: 0.28 }), Sref('roof', 'flat', { id: 'roof', h: 0.12, variant: 'metal' })] },
  organ_pipes: { stack: [Sref('pipe', 'metal', { id: 'a', h: 0.7 }), Sref('pipe', 'metal', { id: 'b', h: 0.3 })] },
  bellows: { stack: [Sref('wall_seg', 'plank_plain', { id: 'box', h: 0.55 }), Sref('awning', 'cloth', { id: 'bag', h: 0.45 })] },
  waterwheel: { stack: [Sref('wheel', 'wood', { id: 'wheel', h: 0.85 }), Sref('wall_seg', 'plank_plain', { id: 'hub', h: 0.15 })] },
  crane: { stack: [Sref('tower_body', 'square', { id: 'mast', h: 0.7, variant: 'timber' }), Sref('antenna', 'timber', { id: 'jib', h: 0.3 })] },
  fireplace: { stack: [Sref('wall_seg', 'brick_plain', { id: 'hearth', h: 0.82 }), Sref('chimney', 'brick', { id: 'stack', h: 0.18, w: 0.28 })], attach: [Sref('archway', 'brick', { on: 'hearth.front', at: 0.22, wy: 0.28 })] },
  hearth: { stack: [Sref('wall_seg', 'stone_plain', { id: 'hearth', h: 0.7 }), Sref('archway', 'stone', { id: 'mouth', h: 0.3 })] },
  lectern: { stack: [Sref('plinth', 'timber', { id: 'stem', h: 0.7 }), Sref('setback', 'plank', { id: 'desk', h: 0.3 })] },
  pew: { stack: [Sref('wall_seg', 'plank_plain', { id: 'seat', h: 0.55 }), Sref('railing', 'plank', { id: 'back', h: 0.45 })] },
  barrel: { stack: [Sref('tower_body', 'round', { id: 'body', h: 1, variant: 'plank' })] },
  amphora: { stack: [Sref('tower_body', 'tapered', { id: 'body', h: 0.8, variant: 'adobe' }), Sref('roof', 'dome', { id: 'neck', h: 0.2, variant: 'adobe' })] },
  vase: { stack: [Sref('tower_body', 'tapered', { id: 'body', h: 0.75, variant: 'adobe' }), Sref('setback', 'adobe', { id: 'rim', h: 0.25 })] },
  urn: { stack: [Sref('tower_body', 'round', { id: 'body', h: 0.7, variant: 'stone' }), Sref('roof', 'dome', { id: 'lid', h: 0.3 })] },
  cauldron: { stack: [Sref('plinth', 'metal', { id: 'feet', h: 0.2 }), Sref('roof', 'dome', { id: 'bowl', h: 0.8, variant: 'metal' })] },
  tool_rack: { stack: [Sref('wall_seg', 'plank_plain', { id: 'board', h: 0.7 }), Sref('railing', 'plank', { id: 'rail', h: 0.3 })] },
  loom: { stack: [Sref('wall_seg', 'timber_plain', { id: 'frame', h: 0.75 }), Sref('railing', 'timber', { id: 'heddle', h: 0.25 })] },
  bone_arch: { stack: [Sref('archway', 'organic', { id: 'arch', h: 1 })] },
  // ship / sky / water / figure kinds stay bespoke — listed in BESPOKE
};

// Aliases
PRESETS.well_house = PRESETS.well_house;
PRESETS.castle_keep = PRESETS.castle;
PRESETS.bridge = PRESETS.stone_bridge;

// Kinds that stay on sprite / generic painters because pieces cannot do them well.
const BESPOKE = [
  'ship', 'shipwreck', 'boat', 'airship', 'balloon', 'wreck_frame',
  'ringed_planet', 'comet', 'nebula', 'aurora_band', 'lenticular', 'thunderhead',
  'water_fall', 'geyser', 'volcano', 'glacier', 'iceberg',
  'candelabra', 'brazier_stand', 'royal_throne', 'throne',
  'book_case', 'workbench', 'anvil', 'stone_statue', 'mushroom',
  'flock', 'distant_figures',
  'windmill', 'pine', 'willow', 'palm_tree', 'broadleaf', 'dead_tree', 'cliff'
];

function hasPreset(kind) { return !!(kind && PRESETS[kind]); }

function handles(p) {
  if (!p || !p.kind) return false;
  if (p.assembly) return true;
  if (BESPOKE.includes(p.kind) && !p.assembly) return false;
  return hasPreset(p.kind);
}

function parsePieceRef(raw) {
  if (!raw) throw Error('Invalid assembly: empty piece.');
  if (typeof raw === 'object') {
    const piece = raw.piece || raw.type;
    if (!isPieceType(piece)) throw Error('Invalid assembly: unknown piece ' + piece + '.');
    const out = { piece, variant: raw.variant || 'plain' };
    for (const k of ['id', 'on', 'at', 'wy', 'h', 'w', 'n', 'along', 'condition', 'x', 'y', 'pin']) {
      if (raw[k] !== undefined) out[k] = raw[k];
    }
    return out;
  }
  const str = String(raw).trim();
  // piece:variant*n@id.socket:at   or piece:variant  or piece
  const re = /^([a-z_]+)(?::([a-z0-9_]+))?(?:\*(-?\d+))?(?:@([a-z0-9_]+)\.([a-z]+))?(?::([0-9]*\.?[0-9]+))?$/;
  const m = str.match(re);
  if (!m) throw Error('Invalid assembly: cannot parse ' + str + '.');
  if (!isPieceType(m[1])) throw Error('Invalid assembly: unknown piece ' + m[1] + '.');
  const out = { piece: m[1], variant: m[2] || 'plain' };
  if (m[3]) out.n = Math.abs(parseInt(m[3], 10));
  if (m[4] && m[5]) out.on = m[4] + '.' + m[5];
  if (m[6] !== undefined) out.at = Number(m[6]);
  return out;
}

function validateAssembly(raw) {
  if (raw === undefined || raw === null || raw === 'none') return undefined;
  let src = raw;
  if (typeof raw === 'string') {
    // compact "stack:a+b;attach:c@id.top;repeat:d*3@right;condition:ruined;roof:onion"
    src = parseCompact(raw);
  }
  if (Array.isArray(raw)) {
    src = { stack: raw };
  }
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw Error('Invalid assembly.');
  const out = {};
  if (src.preset !== undefined) {
    if (typeof src.preset !== 'string' || !/^[a-z][a-z0-9_]{0,40}$/.test(src.preset)) throw Error('Invalid assembly preset.');
    out.preset = src.preset;
  }
  for (const key of ['stack', 'attach', 'repeat', 'pieces']) {
    if (src[key] === undefined) continue;
    if (!Array.isArray(src[key])) throw Error('Invalid assembly: ' + key + ' must be a list.');
    if (src[key].length > 32) throw Error('Invalid assembly: too many ' + key + ' items.');
    out[key] = src[key].map(parsePieceRef);
  }
  if (src.condition !== undefined) {
    if (!CONDITIONS.includes(src.condition)) throw Error('Invalid assembly condition.');
    out.condition = src.condition;
  }
  for (const k of ['roof', 'windows', 'material', 'style']) {
    if (src[k] !== undefined) {
      if (typeof src[k] !== 'string' || src[k].length > 32) throw Error('Invalid assembly ' + k + '.');
      out[k] = src[k].toLowerCase().replace(/[/-]/g, '_');
    }
  }
  if (!out.stack && !out.attach && !out.repeat && !out.pieces && !out.preset && !out.roof && !out.windows && !out.material && !out.condition && !out.style) {
    throw Error('Invalid assembly: empty.');
  }
  return out;
}

function parseCompact(str) {
  const out = {};
  for (const part of String(str).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 'stack' || k === 'attach' || k === 'repeat') out[k] = v.split('+').map(s => s.trim()).filter(Boolean);
    else if (k === 'condition' || k === 'roof' || k === 'windows' || k === 'material' || k === 'preset' || k === 'style') out[k] = v;
  }
  return out;
}

function applyTweaks(preset, tweaks, p) {
  const a = JSON.parse(JSON.stringify(preset));
  const roof = tweaks.roof || (p && p.parts && p.parts.cap && p.parts.cap !== 'none' ? p.parts.cap : null);
  const windows = tweaks.windows;
  const material = tweaks.material || (p && p.material && (typeof p.material === 'string' ? p.material : p.material.name));
  const condition = tweaks.condition || (p && p.parts && p.parts.condition) || a.condition;
  if (roof && a.stack) {
    for (const it of a.stack) if (it.piece === 'roof') {
      const mat = (it.variant || '').split('_').find(t => Pieces.MATERIALS.includes(t));
      it.variant = mat ? roof + '_' + mat : roof;
    }
  }
  if (windows && a.attach) {
    for (const it of a.attach) if (it.piece === 'window') it.variant = windows;
  }
  if (material) {
    const applyMat = list => list && list.forEach(it => {
      if (['wall_seg', 'tower_body', 'floor', 'setback', 'plinth', 'column', 'colonnade_bay', 'archway', 'arch', 'chimney'].includes(it.piece)) {
        const style = (it.variant || '').split('_').filter(t => t !== 'plain' && !Pieces.MATERIALS.includes(t)).join('_');
        it.variant = material + (style ? '_' + style : '');
      }
    });
    applyMat(a.stack); applyMat(a.attach); applyMat(a.repeat); applyMat(a.pieces);
  }
  if (condition) a.condition = condition;
  return a;
}

function resolveRecipe(p) {
  const raw = p.assembly ? (typeof p.assembly === 'object' && !Array.isArray(p.assembly) ? p.assembly : validateAssembly(p.assembly)) : {};
  const presetName = raw.preset || (hasPreset(p.kind) ? p.kind : null);
  const base = presetName && PRESETS[presetName] ? PRESETS[presetName] : { stack: raw.stack, attach: raw.attach, repeat: raw.repeat, pieces: raw.pieces, condition: raw.condition };
  const merged = applyTweaks(Object.assign({ stack: [], attach: [], repeat: [], pieces: [] }, base, {
    stack: raw.stack || base.stack,
    attach: raw.attach || base.attach,
    repeat: raw.repeat || base.repeat,
    pieces: raw.pieces || base.pieces
  }), raw, p);
  return merged;
}

function idOf(item, fallback, used) {
  let id = item.id || fallback;
  let n = 1;
  while (used[id]) { id = (item.id || fallback) + '_' + (++n); }
  used[id] = true;
  return id;
}

function layoutStack(stack, box, used) {
  const items = (stack || []).map(s => typeof s === 'object' ? s : parsePieceRef(s));
  if (!items.length) return [];
  const weights = items.map(it => (it.h || WEIGHT[it.piece] || 0.3));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const fractional = sum <= 1.001 && items.length >= 1;
  let y = box.y + box.h;
  const placed = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let hh = fractional ? box.h * weights[i] : box.h * weights[i] / sum;
    let ww = box.w, xx = box.x;
    if (it.w && it.w <= 1) { ww = Math.max(3, box.w * it.w); xx = box.x + (box.w - ww) / 2; }
    if (it.piece === 'roof' && !(it.w && it.w <= 1)) { xx -= Math.round(box.w * 0.06); ww = box.w * 1.12; }
    if (it.piece === 'trunk' && !(it.w && it.w <= 1)) { ww = Math.max(4, box.w * 0.22); xx = box.x + (box.w - ww) / 2; }
    if (it.piece === 'chimney' && !(it.w && it.w <= 1)) { ww = Math.max(4, box.w * 0.28); xx = box.x + box.w * 0.62; }
    if (it.pin === 'top') {
      y = box.y;
    } else {
      y -= hh;
    }
    const id = idOf(it, it.piece, used);
    placed.push({ id, piece: it.piece, variant: it.variant, condition: it.condition, box: { x: xx, y, w: ww, h: hh }, order: 0 });
  }
  return placed;
}

function layoutRepeat(repeat, box, count, used, already) {
  const out = [];
  for (const it0 of (repeat || [])) {
    const it = typeof it0 === 'object' ? it0 : parsePieceRef(it0);
    const n = Math.max(1, Math.min(10, it.n || count || 5));
    const along = it.along || 'right';
    if (along === 'right' || along === 'left') {
      const bw = box.w / n;
      for (let i = 0; i < n; i++) {
        const x = along === 'right' ? box.x + i * bw : box.x + box.w - (i + 1) * bw;
        const id = idOf(it, (it.id || it.piece) + i, used);
        out.push({ id, piece: it.piece, variant: it.variant, condition: it.condition, box: { x, y: box.y, w: bw, h: box.h }, order: 0 });
      }
    } else {
      const bh = box.h / n;
      for (let i = 0; i < n; i++) {
        const id = idOf(it, (it.id || it.piece) + i, used);
        out.push({ id, piece: it.piece, variant: it.variant, condition: it.condition, box: { x: box.x, y: box.y + i * bh, w: box.w, h: bh }, order: 0 });
      }
    }
  }
  return out;
}

function findParent(placed, name) {
  return placed.find(p => p.id === name) || placed.find(p => p.piece === name) || placed[placed.length - 1] || placed[0];
}

function attachOne(it, parent, used) {
  const sockName = (it.on && it.on.split('.')[1]) || 'front';
  const pbox = parent.box;
  const sizeFn = ATTACH_SIZE[it.piece];
  const size = sizeFn ? sizeFn(pbox) : { w: Math.max(4, pbox.w * 0.3), h: Math.max(4, pbox.h * 0.3) };
  if (it.w) size.w = it.w * (it.w <= 1 ? pbox.w : 1);
  if (it.h && it.h <= 1 && sockName === 'front') size.h = it.h * pbox.h;
  const at = it.at != null ? Number(it.at) : 0.5;
  const wy = it.wy != null ? Number(it.wy) : (sockName === 'front' ? 0.28 : 0);
  let x, y, w = size.w, h = size.h;
  if (sockName === 'top') {
    x = pbox.x + at * Math.max(0, pbox.w - w);
    y = pbox.y - h;
  } else if (sockName === 'bottom') {
    x = pbox.x + at * Math.max(0, pbox.w - w);
    y = pbox.y + pbox.h;
  } else if (sockName === 'left') {
    x = pbox.x - w * 0.65;
    y = pbox.y + at * Math.max(0, pbox.h - h);
  } else if (sockName === 'right') {
    x = pbox.x + pbox.w - w * 0.35;
    y = pbox.y + at * Math.max(0, pbox.h - h);
  } else {
    x = pbox.x + at * Math.max(0, pbox.w - w);
    y = pbox.y + wy * pbox.h;
  }
  const id = idOf(it, it.piece, used);
  const order = sockName === 'front' ? 1 : 0;
  return { id, piece: it.piece, variant: it.variant, condition: it.condition, box: { x, y, w, h }, order };
}

function layoutPieces(list, box, used) {
  const placed = [];
  for (const it0 of (list || [])) {
    const it = typeof it0 === 'object' ? it0 : parsePieceRef(it0);
    if (!it.on && !placed.length) {
      const ww = it.w && it.w <= 1 ? box.w * it.w : (it.w || box.w);
      const hh = it.h && it.h <= 1 ? box.h * it.h : (it.h || box.h * 0.4);
      const id = idOf(it, it.piece, used);
      placed.push({ id, piece: it.piece, variant: it.variant, condition: it.condition, box: { x: box.x + (box.w - ww) / 2, y: box.y + box.h - hh, w: ww, h: hh }, order: 0 });
    } else {
      const parentName = it.on ? it.on.split('.')[0] : (placed[placed.length - 1] || {}).id;
      const parent = findParent(placed, parentName);
      if (!parent) continue;
      placed.push(attachOne(Object.assign({ on: it.on || (parent.id + '.top') }, it), parent, used));
    }
  }
  return placed;
}

function layout(p, recipe) {
  const box = { x: p.x, y: p.y, w: p.w, h: p.h };
  const used = {};
  let placed = [];
  if (recipe.pieces && recipe.pieces.length) placed = placed.concat(layoutPieces(recipe.pieces, box, used));
  if (recipe.repeat && recipe.repeat.length && !(recipe.stack && recipe.stack.length)) {
    placed = placed.concat(layoutRepeat(recipe.repeat, box, p.count, used));
  } else if (recipe.stack && recipe.stack.length) {
    placed = placed.concat(layoutStack(recipe.stack, box, used));
    if (recipe.repeat && recipe.repeat.length) {
      // repeat bays inside the portico slot if one is named, else full box
      const port = placed.find(q => q.id === 'portico' || q.piece === 'colonnade_bay');
      const rbox = port ? port.box : box;
      // replace single portico with repeated bays
      if (port) placed = placed.filter(q => q.id !== port.id);
      placed = placed.concat(layoutRepeat(recipe.repeat, rbox, p.count, used));
    }
  }
  for (const it of (recipe.attach || [])) {
    const parentName = it.on ? it.on.split('.')[0] : (placed[0] && placed[0].id);
    const parent = findParent(placed, parentName);
    if (!parent) continue;
    placed.push(attachOne(it, parent, used));
  }
  // castle side tower: attach tower_body on left needs a tall box
  placed.forEach(q => {
    if (q.piece === 'tower_body' && q.order === 0 && q.box.h < q.box.w) {
      // leave
    }
  });
  return placed;
}

function paint(p, tools, cols) {
  const recipe = resolveRecipe(p);
  const placed = layout(p, recipe);
  if (!placed.length) return false;
  const litL = tools.litLeft(p.x + p.w / 2);
  const sc = S.scaleOf(p);
  const condition = recipe.condition || (p.parts && p.parts.condition) || 'intact';
  // structures first, then front-attaches
  placed.sort((a, b) => a.order - b.order);
  for (const it of placed) {
    const box = { x: Math.round(it.box.x), y: Math.round(it.box.y), w: Math.max(3, Math.round(it.box.w)), h: Math.max(3, Math.round(it.box.h)) };
    paintPiece(it.piece, it.variant, tools, box, cols, litL, sc, it.condition || condition);
  }
  return true;
}

function presetNames() { return Object.keys(PRESETS).sort(); }

module.exports = {
  PRESETS, BESPOKE, WEIGHT,
  hasPreset, handles, paint, validateAssembly, parsePieceRef, parseCompact,
  resolveRecipe, layout, applyTweaks, presetNames, CONDITIONS
};
