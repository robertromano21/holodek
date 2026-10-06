// retort/assemblyVocab.js
// Shared assembly-option vocabulary for levels and Objects in Room — same idea as characterTraitSpec's checklist:
// the LLM (or the keyword fallback) picks from fixed enums; drawers assemble a voxel/pixel figure from those choices
// so every room/item varies on the theme instead of one fixed look.
'use strict';

// ---------- architectural kit (structures / landmarks) ----------
const ARCH_KITS = ['arch', 'pillar', 'broken_pillar', 'altar', 'statue', 'obelisk', 'sarcophagus', 'brazier', 'fountain', 'pool', 'tree', 'dead_tree', 'fungi', 'vines', 'banner', 'tapestry', 'rubble', 'bones', 'crystal', 'stalagmite', 'bookshelf', 'table', 'barrel', 'chest', 'generic'];
const WALL_STYLES = ['ashlar', 'cyclopean', 'brick', 'timber', 'adobe', 'ice_block', 'root_woven', 'crystal_facet', 'bone_stack', 'metal_plate', 'sandstone_block', 'rough_hewn'];
const FLOOR_TREAT = ['flagstone', 'packed_earth', 'sand', 'mosaic', 'planks', 'ice', 'mud', 'marble_tile', 'bone_dust', 'ash', 'leaf_litter', 'cobble'];
const PILLAR_STATES = ['intact', 'cracked', 'collapsed', 'toppled', 'half', 'banded'];
const ARCH_TYPES = ['round', 'pointed', 'flat', 'broken', 'ruined'];
const BASES = ['none', 'plinth', 'rubble', 'steps', 'roots', 'sand_drift'];
const ORNAMENTS = ['none', 'glyphs', 'vines', 'moss', 'cracks', 'gold_trim', 'blood', 'frost', 'cobwebs', 'runes', 'relief'];
const MATERIALS = ['stone', 'sandstone', 'marble', 'brick', 'wood', 'bone', 'obsidian', 'metal', 'ice', 'crystal', 'earth', 'ash', 'cloth', 'flesh'];
const SIZES = ['small', 'medium', 'large', 'huge'];

// ---------- item assembly (Objects in Room) ----------
const ITEM_KINDS = ['sword', 'dagger', 'axe', 'hammer', 'spear', 'staff', 'bow', 'shield', 'amulet', 'ring', 'book', 'scroll', 'potion', 'gem', 'orb', 'key', 'coins', 'skull', 'lantern', 'chest', 'boots', 'helm', 'armor', 'bundle'];
const SHAFTS = ['none', 'wood', 'bone', 'iron', 'steel', 'bronze', 'crystal', 'shadow', 'vine', 'gold'];
const HEADS = ['none', 'blade', 'curved_blade', 'axe_head', 'hammer_head', 'spear_point', 'orb', 'crystal', 'skull', 'gem', 'cross', 'flame', 'horn', 'book_cover', 'vial', 'key_bit', 'coin_pile', 'lantern_cage'];
const ITEM_ORNAMENTS = ['none', 'runes', 'wrap', 'chain', 'feathers', 'spikes', 'gems', 'ribbon', 'rust', 'holy_sigil', 'shadow_wisp'];
const GLOW_HINTS = ['none', 'soul', 'fire', 'frost', 'holy', 'venom', 'shadow', 'arcane'];

const SCHEMA_STRUCTURE_ASSEMBLY = {
  kit: ARCH_KITS.join('|'),
  wallStyle: WALL_STYLES.join('|') + ' (hint for nearby walls; optional)',
  state: PILLAR_STATES.concat(ARCH_TYPES).concat(['intact', 'ruined', 'overgrown', 'burnt', 'glowing']).filter((v, i, a) => a.indexOf(v) === i).join('|'),
  base: BASES.join('|'),
  ornament: ORNAMENTS.join('|'),
  material: MATERIALS.join('|'),
  size: SIZES.join('|'),
  color: '#rrggbb', color2: '#rrggbb or null', glow: '#rrggbb or null'
};
const SCHEMA_ITEM_ASSEMBLY = {
  kind: ITEM_KINDS.join('|'),
  shaft: SHAFTS.join('|'),
  head: HEADS.join('|'),
  material: MATERIALS.join('|'),
  size: SIZES.join('|'),
  ornament: ITEM_ORNAMENTS.join('|'),
  glow: GLOW_HINTS.join('|') + ' or #rrggbb',
  color: '#rrggbb', accent: '#rrggbb'
};

function pick(list, v, fallback) {
  if (v == null || v === '') return fallback;
  const s = String(v).toLowerCase().trim();
  if (!s) return fallback;
  if (list.includes(s)) return s;
  // loose contains (require meaningful length so '' never matches everything)
  const hit = list.find((x) => s.length >= 3 && (s.includes(x) || (x.length >= 3 && x.includes(s))));
  return hit || fallback;
}
function isHex(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); }

const GLOW_COLORS = { soul: '#a8c8ff', fire: '#ffb040', frost: '#a0e8ff', holy: '#fff0a0', venom: '#9aff6a', shadow: '#b070ff', arcane: '#c890ff', none: null };

/** Normalize a structure's assembly block; fill gaps from name/shape keywords. */
function normalizeStructureAssembly(raw, shapeHint, name) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const n = String(name || '').toLowerCase();
  let kit = pick(ARCH_KITS, a.kit, null);
  if (!kit) {
    if (/arch/.test(n) || shapeHint === 'arch') kit = 'arch';
    else if (/collapsed|broken.?column|broken.?pillar|toppled/.test(n) || shapeHint === 'broken_column') kit = 'broken_pillar';
    else if (/pillar|column|colonnade/.test(n) || shapeHint === 'column') kit = 'pillar';
    else if (/altar|shrine/.test(n) || shapeHint === 'slab') kit = 'altar';
    else if (/statue|idol|effigy/.test(n) || shapeHint === 'statue') kit = 'statue';
    else if (/obelisk|monolith|spire/.test(n) || shapeHint === 'spire') kit = 'obelisk';
    else if (/fungi|fungus|mushroom|toadstool/.test(n) || shapeHint === 'cluster') kit = 'fungi';
    else if (/vine/.test(n) || shapeHint === 'hanging') kit = 'vines';
    else if (/tapestry/.test(n)) kit = 'tapestry';
    else if (/banner|flag/.test(n) || shapeHint === 'banner') kit = 'banner';
    else if (/bone|skull/.test(n) || shapeHint === 'pile') kit = 'bones';
    else if (/rubble|debris|sand.?drift|mound/.test(n) || shapeHint === 'mound' || shapeHint === 'pile') kit = 'rubble';
    else if (/crystal|geode/.test(n) || shapeHint === 'crystal') kit = 'crystal';
    else if (/tree|cypress|willow/.test(n) || shapeHint === 'tree') kit = /dead|wither|petrif/.test(n) ? 'dead_tree' : 'tree';
    else if (/brazier|firepit|hearth/.test(n) || shapeHint === 'bowl') kit = 'brazier';
    else if (/fountain|basin|font/.test(n)) kit = 'fountain';
    else if (/pool|pond|bog/.test(n) || shapeHint === 'pool') kit = 'pool';
    else if (/barrel|keg/.test(n) || shapeHint === 'barrel') kit = 'barrel';
    else if (/table|bench|desk/.test(n) || shapeHint === 'table') kit = 'table';
    else if (/bookshelf|shelf/.test(n) || shapeHint === 'frame') kit = 'bookshelf';
    else if (/stalagm|stalact|icicle/.test(n) || shapeHint === 'stalagmite') kit = 'stalagmite';
    else kit = 'generic';
  }
  let state = pick(PILLAR_STATES.concat(ARCH_TYPES).concat(['intact', 'ruined', 'overgrown', 'burnt', 'glowing']), a.state, null);
  if (!state) {
    if (/collaps|toppl|fallen|shatter/.test(n)) state = 'collapsed';
    else if (/crack|fractur|crumbl/.test(n)) state = 'cracked';
    else if (/ruin|broken/.test(n)) state = 'ruined';
    else if (/overgrown|vine|moss/.test(n)) state = 'overgrown';
    else if (/burnt|charred|scorch/.test(n)) state = 'burnt';
    else if (/glow|lumin|iridescent|puls/.test(n)) state = 'glowing';
    else if (kit === 'arch' && /pointed|gothic/.test(n)) state = 'pointed';
    else if (kit === 'arch' && /round|roman/.test(n)) state = 'round';
    else state = 'intact';
  }
  let material = pick(MATERIALS, a.material, null);
  if (!material) {
    for (const m of MATERIALS) if (new RegExp('\\b' + m).test(n)) { material = m; break; }
    if (!material) {
      if (kit === 'tapestry' || kit === 'banner') material = 'cloth';
      else if (kit === 'bones') material = 'bone';
      else if (kit === 'tree' || kit === 'dead_tree' || kit === 'vines') material = 'wood';
      else if (kit === 'fungi') material = 'crystal';
      else if (kit === 'crystal') material = 'crystal';
      else material = /sand/.test(n) ? 'sandstone' : 'stone';
    }
  }
  let ornament = pick(ORNAMENTS, a.ornament, null);
  if (!ornament) {
    if (/glyph|rune|sigil|inscription/.test(n)) ornament = 'glyphs';
    else if (/vine|ivy/.test(n)) ornament = 'vines';
    else if (/moss/.test(n)) ornament = 'moss';
    else if (/gold|gilded/.test(n)) ornament = 'gold_trim';
    else if (/frost|rime|ice/.test(n)) ornament = 'frost';
    else if (/cobweb/.test(n)) ornament = 'cobwebs';
    else if (/crack/.test(n)) ornament = 'cracks';
    else if (kit === 'vines') ornament = 'vines';
    else ornament = 'none';
  }
  const base = pick(BASES, a.base, /altar|statue|obelisk|sarcophag/.test(n) ? 'plinth' : (kit === 'rubble' || kit === 'bones' ? 'none' : 'none'));
  const size = pick(SIZES, a.size, /huge|colossal|great/.test(n) ? 'large' : (/small|tiny/.test(n) ? 'small' : 'medium'));
  return {
    kit, state, base, ornament, material, size,
    wallStyle: pick(WALL_STYLES, a.wallStyle, null),
    color: isHex(a.color) ? a.color : null,
    color2: isHex(a.color2) ? a.color2 : null,
    glow: isHex(a.glow) ? a.glow : (state === 'glowing' ? '#9a7aff' : null)
  };
}

/** Normalize an item's assembly; fill from name/type/magic. */
function normalizeItemAssembly(raw, item) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const n = String(item && item.name || '').toLowerCase();
  const t = String(item && item.type || '').toLowerCase();
  let kind = pick(ITEM_KINDS, a.kind, null);
  if (!kind) {
    const map = [
      ['sword', /sword|blade|sabre|scimitar|katana|claymore|rapier/], ['dagger', /dagger|knife|dirk|stiletto/],
      ['axe', /axe|hatchet|cleaver/], ['hammer', /hammer|maul|mace|morningstar|flail|club/],
      ['spear', /spear|lance|pike|halberd|trident|glaive/], ['staff', /staff|rod|wand|sceptre|scourge|cane/],
      ['bow', /bow|crossbow/], ['shield', /shield|buckler|aegis/], ['amulet', /amulet|necklace|pendant|talisman|locket|medallion/],
      ['ring', /ring|band|signet/], ['book', /book|tome|ledger|grimoire|codex|journal|manual|chronicle/],
      ['scroll', /scroll|parchment|map|letter|deed/], ['potion', /potion|vial|flask|elixir|philter|tonic|brew/],
      ['gem', /gem|jewel|shard|crystal|diamond|ruby|emerald|sapphire/], ['orb', /orb|sphere|globe/],
      ['key', /\bkey\b|keystone/], ['coins', /coin|gold|purse|treasure/], ['skull', /skull|idol|fetish|relic|figurine/],
      ['lantern', /lantern|lamp|candle|torch/], ['chest', /chest|box|casket|coffer|chalice|goblet/],
      ['boots', /boot|greave|sandal|glove|gauntlet|bracer/], ['helm', /helm|helmet|crown|circlet|tiara|mask/],
      ['armor', /armou?r|mail|breastplate|cuirass|robe|cloak|mantle/]
    ];
    for (const [k, re] of map) if (re.test(n)) { kind = k; break; }
    if (!kind) kind = /weapon/.test(t) ? 'sword' : /potion/.test(t) ? 'potion' : 'bundle';
  }
  let shaft = pick(SHAFTS, a.shaft, null);
  if (!shaft) {
    if (['sword', 'dagger', 'axe', 'hammer', 'spear', 'staff', 'bow', 'lantern'].includes(kind)) {
      if (/bone|ivory/.test(n)) shaft = 'bone';
      else if (/crystal|glass/.test(n)) shaft = 'crystal';
      else if (/gold|gilded/.test(n)) shaft = 'gold';
      else if (/shadow|void|night/.test(n)) shaft = 'shadow';
      else if (/iron|steel|metal/.test(n)) shaft = 'steel';
      else if (/bronze|brass|copper/.test(n)) shaft = 'bronze';
      else if (/vine|root|thorn/.test(n)) shaft = 'vine';
      else shaft = ['staff', 'spear', 'bow', 'axe', 'hammer'].includes(kind) ? 'wood' : 'steel';
    } else shaft = 'none';
  }
  let head = pick(HEADS, a.head, null);
  if (!head) {
    const hm = {
      sword: 'blade', dagger: 'blade', axe: 'axe_head', hammer: 'hammer_head', spear: 'spear_point',
      staff: /skull/.test(n) ? 'skull' : (/flame|fire|ember/.test(n) ? 'flame' : (/crystal|gem/.test(n) ? 'crystal' : 'orb')),
      bow: 'none', shield: 'none', amulet: 'gem', ring: 'gem', book: 'book_cover', scroll: 'none',
      potion: 'vial', gem: 'gem', orb: 'orb', key: 'key_bit', coins: 'coin_pile', skull: 'skull',
      lantern: 'lantern_cage', chest: 'none', boots: 'none', helm: 'none', armor: 'none', bundle: 'none'
    };
    head = hm[kind] || 'none';
    if (/skull|bone head/.test(n)) head = 'skull';
    if (/flame|fire|ember/.test(n) && kind === 'staff') head = 'flame';
    if (/cross|holy|atinus/.test(n)) head = 'cross';
    if (/curved|scimitar|falchion/.test(n)) head = 'curved_blade';
  }
  let material = pick(MATERIALS, a.material, null);
  if (!material) {
    for (const m of MATERIALS) if (new RegExp('\\b' + m).test(n)) { material = m; break; }
    if (!material) {
      if (shaft === 'wood' || shaft === 'vine') material = 'wood';
      else if (shaft === 'bone') material = 'bone';
      else if (shaft === 'crystal') material = 'crystal';
      else if (shaft === 'gold' || shaft === 'steel' || shaft === 'iron' || shaft === 'bronze') material = 'metal';
      else if (shaft === 'shadow') material = 'obsidian';
      else if (kind === 'book' || kind === 'scroll') material = 'cloth';
      else if (kind === 'potion') material = 'crystal';
      else material = 'metal';
    }
  }
  let ornament = pick(ITEM_ORNAMENTS, a.ornament, null);
  if (!ornament) {
    if (/rune|glyph|sigil/.test(n)) ornament = 'runes';
    else if (/wrap|bound|cord|leather wrap/.test(n)) ornament = 'wrap';
    else if (/chain|link/.test(n) || kind === 'amulet') ornament = 'chain';
    else if (/feather|plume/.test(n)) ornament = 'feathers';
    else if (/spike|thorn|barbed/.test(n)) ornament = 'spikes';
    else if (/gem|jewel|inset/.test(n)) ornament = 'gems';
    else if (/rust|rusted|corrod/.test(n)) ornament = 'rust';
    else if (/holy|atinus|sacred|divine/.test(n)) ornament = 'holy_sigil';
    else if (/shadow|wraith|soul|echo|spectr/.test(n)) ornament = 'shadow_wisp';
    else ornament = 'none';
  }
  let glow = a.glow;
  if (typeof glow === 'string' && !isHex(glow)) glow = GLOW_COLORS[glow.toLowerCase()] || null;
  if (!isHex(glow)) {
    glow = null;
    for (const [k, c] of Object.entries(GLOW_COLORS)) if (k !== 'none' && new RegExp(k).test(n)) { glow = c; break; }
    if (!glow && (item && item.magic > 0)) glow = GLOW_COLORS.arcane;
  }
  const size = pick(SIZES, a.size, /great|long|tower|massive/.test(n) ? 'large' : (/small|short|tiny/.test(n) ? 'small' : 'medium'));
  // colours from words
  let color = isHex(a.color) ? a.color : null;
  let accent = isHex(a.accent) ? a.accent : null;
  if (!color) {
    const MATC = { gold: '#d8b040', silver: '#c8ccd8', bone: '#e0d6bc', wood: '#7a5434', iron: '#8a909a', steel: '#b8bcc8', bronze: '#b0703c', crystal: '#9ad0e8', shadow: '#4a4058', cloth: '#6a2a2a', stone: '#8a8580', sandstone: '#b08a5e', marble: '#d8d4cc', ice: '#a6d2ea', metal: '#9aa0aa' };
    if (/gold|golden|gilded/.test(n)) color = MATC.gold;
    else if (/silver|mithril/.test(n)) color = MATC.silver;
    else if (/bone|ivory/.test(n)) color = MATC.bone;
    else if (/rust/.test(n)) color = '#8a4a2a';
    else if (/obsidian|black|shadow|void|night/.test(n)) color = MATC.shadow;
    else if (/blood|crimson|scarlet/.test(n)) color = '#b8382c';
    else color = MATC[material] || MATC[shaft] || '#9aa0aa';
  }
  if (!accent) accent = glow || (ornament === 'holy_sigil' ? '#c8a450' : '#c8a040');
  return { kind, shaft, head, material, size, ornament, glow: glow || null, color, accent };
}

/** Map assembly kit → existing DRAW shape used by the primitive / landmark drawers. */
function kitToShape(kit) {
  const m = {
    arch: 'arch', pillar: 'column', broken_pillar: 'broken_column', altar: 'slab', statue: 'statue', obelisk: 'spire',
    sarcophagus: 'slab', brazier: 'bowl', fountain: 'bowl', pool: 'pool', tree: 'tree', dead_tree: 'tree', fungi: 'cluster',
    vines: 'hanging', banner: 'banner', tapestry: 'banner', rubble: 'mound', bones: 'pile', crystal: 'crystal',
    stalagmite: 'stalagmite', bookshelf: 'frame', table: 'table', barrel: 'barrel', chest: 'block', generic: 'block'
  };
  return m[kit] || 'block';
}

/** Size enum → width/height for world sprites. */
function sizeToWH(size, kit) {
  const s = size === 'huge' ? 1.15 : size === 'large' ? 1.0 : size === 'small' ? 0.7 : 0.85;
  const base = {
    arch: [0.9, 1.1], pillar: [0.4, 1.0], broken_pillar: [0.8, 0.6], altar: [0.8, 0.55], statue: [0.5, 1.1],
    obelisk: [0.4, 1.2], fungi: [0.6, 0.5], vines: [0.6, 1.0], banner: [0.6, 1.0], tapestry: [0.7, 1.0],
    rubble: [0.8, 0.4], bones: [0.7, 0.35], brazier: [0.5, 0.7], pool: [1.0, 0.25], tree: [0.7, 1.3],
    crystal: [0.6, 0.9], table: [0.8, 0.5], barrel: [0.5, 0.6], bookshelf: [0.8, 1.0]
  }[kit] || [0.6, 0.8];
  return { width: Math.min(1, base[0] * s), height: Math.min(1.4, base[1] * s) };
}

module.exports = {
  ARCH_KITS, WALL_STYLES, FLOOR_TREAT, PILLAR_STATES, ARCH_TYPES, BASES, ORNAMENTS, MATERIALS, SIZES,
  ITEM_KINDS, SHAFTS, HEADS, ITEM_ORNAMENTS, GLOW_HINTS, GLOW_COLORS,
  SCHEMA_STRUCTURE_ASSEMBLY, SCHEMA_ITEM_ASSEMBLY,
  normalizeStructureAssembly, normalizeItemAssembly, kitToShape, sizeToWH, pick, isHex
};
