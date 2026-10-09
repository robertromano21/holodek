// sceneSpec.js
// Room text is the source of truth for the 3D view.
// Parses the room name, written description, exits, and "Objects in Room" into a
// structured scene spec. The same spec drives dungeon classification, the visual
// style (textures/light/palette), the required prop tiles, and the prose check.
// Deterministic (no API calls) so it is cheap, repeatable, and identical per coordinate.

'use strict';
const AV = require('./assemblyVocab.js');

const SCENE_SPEC_VERSION = 1;

// ---------- small helpers ----------
const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, single: 1, lone: 1, solitary: 1,
  two: 2, twin: 2, pair: 2, both: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, several: 3, few: 3, many: 5,
  numerous: 5, dozens: 8, rows: 6, row: 4, ring: 6, circle: 6
};

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'object';
}

function hasAny(text, words) {
  return words.some(w => new RegExp(`\\b${w}`, 'i').test(text));
}

function countHits(text, words) {
  let n = 0;
  for (const w of words) {
    const m = text.match(new RegExp(`\\b${w}`, 'gi'));
    if (m) n += m.length;
  }
  return n;
}

function splitList(line) {
  const t = String(line || '').trim();
  if (!t || /^none\.?$/i.test(t)) return [];
  return t.split(/\s*,\s*/).map(s => s.trim()).filter(s => s && !/^none\.?$/i.test(s));
}

// ---------- vocabularies ----------
// Each entry: canonical value -> trigger words (regex word-prefixes).
const BIOMES = {
  crypt: ['crypt', 'tomb', 'ossuar', 'catacomb', 'sepulch', 'mausole', 'grave', 'burial', 'sarcophag', 'coffin'],
  temple: ['temple', 'chapel', 'shrine', 'sanctum', 'sanctuar', 'cathedral', 'altar', 'nave', 'reliquar'],
  cave: ['cave', 'cavern', 'grotto', 'tunnel', 'burrow', 'stalactite', 'stalagmite', 'mine\\b', 'chasm'],
  fortress: ['fortress', 'keep\\b', 'barrack', 'armory', 'armoury', 'rampart', 'battlement', 'garrison', 'citadel', 'gatehouse'],
  palace: ['palace', 'throne', 'hall of', 'court\\b', 'ballroom', 'gallery', 'royal'],
  ruins: ['ruin', 'collapsed', 'crumbl', 'rubble', 'shattered', 'toppled', 'broken column'],
  wasteland: ['wasteland', 'plain', 'desert', 'dune', 'barren', 'field', 'expanse', 'badland', 'steppe', 'heath']
};

const OUTDOOR_WORDS = ['sky', 'open air', 'horizon', 'wasteland', 'plain', 'desert', 'dune', 'field', 'forest', 'meadow', 'hillside', 'valley', 'shore', 'beach', 'riverbank', 'courtyard', 'garden', 'outside', 'beneath the stars', 'under the sky', 'clouds', 'sun\\b', 'moon\\b'];
const INDOOR_WORDS = ['room', 'chamber', 'hall', 'corridor', 'passage', 'ceiling', 'vault', 'crypt', 'chapel', 'cell', 'cellar', 'tunnel', 'cave', 'cavern', 'stair', 'library', 'kitchen', 'interior', 'doorway', 'walls', 'barrack', 'armory', 'armoury', 'bunk', 'shrine', 'temple', 'tomb', 'sanctum'];

const MATERIALS = {
  // value: [triggers]; order = priority when tied
  bone: ['bone', 'skull', 'ossuar', 'ribcage', 'femur', 'skeletal'],
  flesh: ['flesh', 'sinew', 'pulsing', 'membrane', 'meat', 'veined'],
  ice: ['ice', 'icy', 'frozen', 'frost', 'glacier', 'rime'],
  lava: ['lava', 'magma', 'molten', 'ember', 'brimstone'],
  obsidian: ['obsidian', 'black glass', 'volcanic glass', 'basalt'],
  marble: ['marble', 'alabaster', 'polished stone', 'porcelain'],
  metal: ['iron', 'steel', 'bronze', 'brass', 'copper', 'metal', 'rust', 'chain', 'grate', 'grating'],
  wood: ['wood', 'timber', 'plank', 'beam', 'oak', 'pine', 'log\\b', 'rafters'],
  roots: ['root', 'vine', 'moss', 'fungus', 'fungal', 'lichen', 'overgrown', 'ivy'],
  ash: ['ash', 'ashen', 'soot', 'cinder', 'charred', 'burnt', 'burned', 'scorched'],
  sand: ['sand', 'dune', 'dust'],
  earth: ['dirt', 'earth', 'mud', 'clay', 'soil'],
  crystal: ['crystal', 'gem', 'quartz', 'amethyst', 'glowing shard'],
  brick: ['brick', 'masonry', 'mortar'],
  stone: ['stone', 'granite', 'rock', 'flagstone', 'cobble', 'slate']
};

// Surface materials the texture generator understands (renderSprite_poke drawWall/drawFloor).
// Every detected material is a valid surface; earth/sand fall back to rough stone patterns.
const WALL_MATERIAL_MAP = { bone: 'bone', flesh: 'flesh', ice: 'ice', lava: 'obsidian', obsidian: 'obsidian', marble: 'marble', metal: 'metal', wood: 'wood', roots: 'roots', ash: 'ash', sand: 'sandstone', earth: 'earth', crystal: 'crystal', brick: 'brick', stone: 'stone' };
const FLOOR_MATERIAL_MAP = { bone: 'bone', flesh: 'flesh', ice: 'ice', lava: 'lava', obsidian: 'obsidian', marble: 'marble', metal: 'metal', wood: 'wood', roots: 'roots', ash: 'ash', sand: 'sand', earth: 'earth', crystal: 'crystal', brick: 'brick', stone: 'stone' };

const WALL_CONTEXT = /\b(wall|walls|ceiling|vault|arch|carved|hewn|built|masonry|brick|lined|panel)/i;
const FLOOR_CONTEXT = /\b(floor|ground|underfoot|flagstones|tiles|paved|carpet|covered|strewn|littered|knee-deep|ankle-deep|pool|puddle)/i;

// Ground cover / atmosphere that the view must show.
const GROUND_COVER = {
  water: ['flood', 'water', 'pool', 'puddle', 'submerged', 'drenched', 'wet', 'damp', 'drip', 'stream', 'river', 'lake', 'brine', 'swamp', 'marsh', 'bog'],
  ash: ['ash', 'ashen', 'soot', 'cinder'],
  blood: ['blood', 'gore', 'bloodstain'],
  lava: ['lava', 'magma', 'molten'],
  snow: ['snow', 'snowdrift'],
  ice: ['ice', 'frozen', 'frost'],
  bones: ['bones', 'skull', 'skeleton', 'remains'],
  sand: ['sand', 'dune'],
  moss: ['moss', 'lichen', 'fungus', 'fungal', 'mold', 'mould'],
  rubble: ['rubble', 'debris', 'fallen stone', 'collapsed', 'shards'],
  cobweb: ['cobweb', 'web', 'spider silk']
};

const WEATHER = {
  fog: ['fog', 'mist', 'haze', 'murk', 'vapor', 'vapour', 'steam'],
  smoke: ['smoke', 'smoky', 'smoulder', 'smolder', 'fume'],
  rain: ['rain', 'drizzle', 'downpour', 'storm'],
  snow: ['snowfall', 'snowing', 'blizzard', 'falling snow'],
  wind: ['wind', 'gust', 'draft', 'draught', 'howl', 'breeze'],
  embers: ['ember', 'spark', 'cinders drift', 'falling ash', 'ash falls', 'ash drifts'],
  dust: ['dust', 'dusty'],
  drip: ['drip', 'dripping', 'trickl']
};

const LIGHT_SOURCES = {
  torch: { words: ['torch', 'sconce', 'brazier'], color: '#FFB060' },
  candle: { words: ['candle', 'taper', 'candelabr'], color: '#FFD080' },
  fire: { words: ['fire', 'flame', 'hearth', 'pyre', 'burning'], color: '#FF8040' },
  lava: { words: ['lava', 'magma', 'molten'], color: '#FF5020' },
  magic: { words: ['glow', 'luminous', 'phosphor', 'eldritch', 'arcane', 'rune', 'witchlight', 'spectral'], color: '#80C0FF' },
  fungus: { words: ['fungal glow', 'bioluminesc', 'glowing fung', 'glowing moss'], color: '#80FFB0' },
  sun: { words: ['sunlight', 'sunlit', 'daylight', 'sun\\b', 'dawn', 'noon'], color: '#FFF4D0' },
  moon: { words: ['moonlight', 'moonlit', 'moon\\b', 'starlight'], color: '#B0C4FF' },
  crystal: { words: ['crystal', 'gem'], color: '#C080FF' },
  sickly: { words: ['sickly', 'green light', 'verdant glow', 'ghostly'], color: '#90FF90' }
};
const DARK_WORDS = ['dark', 'darkness', 'gloom', 'shadow', 'pitch', 'black', 'dim', 'murk', 'unlit', 'lightless'];
const BRIGHT_WORDS = ['bright', 'brilliant', 'blazing', 'radiant', 'sunlit', 'dazzling', 'well-lit', 'lit by'];

// Landmarks are big room features the view must contain (they become custom_ prop tiles).
// type -> trigger words. Matching is on the singular/plural stem.
const LANDMARKS = {
  fallen_arch: ['fallen arch', 'collapsed arch'],
  broken_masonry: ['broken masonry', 'masonry rubble', 'brick rubble'],
  scree: ['scree', 'rockfall', 'loose stones'],
  portcullis: ['portcullis', 'iron gate', 'barred gate'],
  timber_gate: ['timber gate', 'wooden gate'],
  buttress: ['buttress'],
  battlement: ['battlement', 'crenellat', 'parapet'],
  arrow_slit: ['arrow slit', 'arrow loop', 'loophole'],
  fluted_column: ['fluted column', 'classical column', 'roman column'],
  doric_column: ['doric column', 'doric pillar'],
  ionic_column: ['ionic column', 'ionic pillar'],
  corinthian_column: ['corinthian column', 'corinthian pillar'],
  pointed_arch: ['pointed arch', 'gothic arch'],
  oak: ['oak'], pine: ['pine'], willow: ['willow'], cypress: ['cypress'],
  bone_tree: ['bone tree'], charred_tree: ['charred tree'], mushroom_tree: ['mushroom tree', 'giant mushroom'],
  pale_hollow_tree: ['pale hollow tree', 'white dead tree', 'hollow dead tree'],
  split_snag: ['split snag', 'lightning-split tree'], wind_bent_tree: ['wind-bent tree', 'windswept dead tree'],
  dead_willow: ['dead willow'], skeletal_pine: ['skeletal pine', 'dead conifer'],
  twisted_yew: ['twisted yew', 'dead yew'], rootbound_tree: ['rootbound tree', 'root-tangled tree'],
  thorn_bush: ['thorn bush', 'thorn scrub'], bramble_patch: ['bramble', 'thorn thicket'], ash_reeds: ['ash reed'],
  roots: ['calcified root', 'exposed root', 'tangled root'], stump: ['stump'],
  altar: ['altar'],
  statue: ['statue', 'idol', 'effigy', 'figure carved', 'stone figure', 'colossus'],
  broken_columns: ['broken column', 'broken pillar', 'shattered column', 'toppled column', 'fallen column', 'cracked column', 'cracked pillar', 'collapsed column'],
  pillar: ['pillar', 'column', 'colonnade'],
  sarcophagus: ['sarcophag', 'coffin', 'casket', 'bier'],
  obelisk: ['obelisk', 'monolith', 'standing stone', 'menhir'],
  archway: ['archway', 'arch\\b', 'arches'],
  throne: ['throne'],
  fountain: ['fountain', 'basin'],
  well: ['well\\b'],
  brazier: ['brazier'],
  furnace: ['furnace', 'kiln', 'smelter'],
  crystal_cluster: ['crystal', 'crystals', 'geode'],
  bookshelf: ['bookshel', 'bookcase', 'shelves of books', 'tome', 'library'],
  table: ['table', 'desk', 'workbench'],
  chest: ['chest', 'coffer', 'strongbox'],
  barrel: ['barrel', 'cask', 'keg'],
  crate: ['crate'],
  cage: ['cage', 'gibbet'],
  chains: ['chains', 'shackle', 'manacle'],
  tree: ['tree', 'trunk'],
  dead_tree: ['dead tree', 'withered tree', 'petrified tree', 'blackened tree'],
  bone_pile: ['pile of bones', 'bone pile', 'heap of bones', 'skulls'],
  rubble: ['rubble', 'debris', 'collapsed'],
  stairs: ['stair', 'steps'],
  pool: ['pool', 'pond'],
  ash_flora: ['ash flora', 'ash-flower', 'ashen plant', 'ash plant', 'ash tree', 'cinder bloom', 'ash weed'],
  banner: ['banner', 'tapestr', 'flag'],
  tomb: ['tomb\\b', 'grave\\b', 'headstone', 'gravestone', 'crypt door'],
  mirror: ['mirror'],
  bed: ['bed\\b', 'cot\\b', 'pallet'],
  pew: ['pew', 'bench'],
  candelabra: ['candelabr', 'candles'],
  torch_stand: ['torch stand', 'standing torch'],
  gate: ['gate', 'portcullis'],
  portal: ['portal', 'rift', 'gateway of light'],
  bridge: ['bridge'],
  tent: ['tent'],
  campfire: ['campfire', 'fire pit', 'firepit'],
  mushroom: ['mushroom', 'toadstool', 'fungi', 'fungus'],
  boulder: ['boulder', 'rock formation'],
  rock_face: ['rock face', 'cliff face', 'rocky escarpment'],
  stalagmite: ['stalagmite', 'stalactite']
};
// Mass nouns / one-per-room features: plural wording doesn't mean two of them.
const SINGLE_FEATURE_TYPES = new Set(['stairs', 'rubble', 'chains', 'pool', 'bone_pile', 'candelabra', 'bookshelf', 'mushroom', 'stalagmite', 'crystal_cluster', 'bridge', 'portal', 'gate', 'well', 'fountain', 'throne']);
// Words that only describe the room shell, not standalone props.
const LANDMARK_SKIP_IF_SHELL = { pillar: /\b(pillar|column)s? of (light|smoke|fire|ash|flame|darkness|shadow)/i };

const CONDITION_WORDS = {
  broken: ['broken', 'shattered', 'cracked', 'toppled', 'fallen', 'smashed', 'split', 'ruined', 'crumbling', 'collapsed'],
  burnt: ['charred', 'burnt', 'burned', 'scorched', 'blackened'],
  flooded: ['flooded', 'submerged', 'half-sunk', 'sunken', 'drowned'],
  bloody: ['bloody', 'bloodstained', 'blood-soaked'],
  glowing: ['glowing', 'luminous', 'shining', 'radiant'],
  ancient: ['ancient', 'weathered', 'worn', 'old', 'eroded'],
  overgrown: ['overgrown', 'moss-covered', 'vine-choked']
};

// Object (inventory item) -> prop category used for billboards.
const OBJECT_CATEGORIES = {
  weapon: ['sword', 'blade', 'axe', 'dagger', 'mace', 'hammer', 'spear', 'bow', 'crossbow', 'flail', 'scythe', 'halberd', 'staff', 'club', 'whip', 'knife', 'scimitar', 'rapier', 'glaive', 'trident', 'sling'],
  armor: ['armor', 'armour', 'mail', 'plate', 'helm', 'helmet', 'shield', 'gauntlet', 'greave', 'breastplate', 'boots', 'cloak', 'robe', 'bracer', 'buckler'],
  potion: ['potion', 'vial', 'flask', 'elixir', 'philter', 'draught', 'tonic'],
  scroll: ['scroll', 'parchment', 'map', 'letter', 'note'],
  book: ['book', 'tome', 'grimoire', 'codex', 'journal', 'diary'],
  key: ['key'],
  jewelry: ['ring', 'amulet', 'necklace', 'pendant', 'crown', 'circlet', 'brooch', 'talisman', 'bracelet'],
  gem: ['gem', 'jewel', 'ruby', 'emerald', 'sapphire', 'diamond', 'crystal', 'orb', 'shard', 'stone'],
  treasure: ['coin', 'gold', 'silver', 'treasure', 'chalice', 'goblet', 'idol', 'relic', 'artifact', 'artefact'],
  container: ['chest', 'box', 'bag', 'pouch', 'sack', 'urn', 'jar', 'casket', 'coffer'],
  light: ['torch', 'lantern', 'candle', 'lamp'],
  tool: ['rope', 'pick', 'shovel', 'lockpick', 'tool', 'hook', 'chain'],
  remains: ['bone', 'skull', 'corpse', 'remains', 'skeleton'],
  food: ['bread', 'meat', 'ration', 'apple', 'cheese', 'wine', 'water skin', 'waterskin']
};

// ---------- palettes ----------
const BASE_PALETTES = {
  stone:    { primary: '#6E6A64', secondary: '#3A3733', highlight: '#A8A196', shadow: '#1A1816' },
  brick:    { primary: '#7A4A3A', secondary: '#3E2620', highlight: '#B07A5E', shadow: '#1C100C' },
  bone:     { primary: '#CFC6A8', secondary: '#8E856A', highlight: '#F2ECD6', shadow: '#3A3426' },
  flesh:    { primary: '#8E3A44', secondary: '#4A1A22', highlight: '#D07080', shadow: '#1E0A0E' },
  ice:      { primary: '#9CC8E0', secondary: '#4E7A96', highlight: '#E8F6FF', shadow: '#1C3446' },
  lava:     { primary: '#3A1E18', secondary: '#1A0C0A', highlight: '#FF6A20', shadow: '#0A0404' },
  obsidian: { primary: '#2A2630', secondary: '#141218', highlight: '#6A5A8A', shadow: '#060508' },
  marble:   { primary: '#D8D4CC', secondary: '#9C978E', highlight: '#FFFFFF', shadow: '#4A4640' },
  metal:    { primary: '#5E646C', secondary: '#2E3236', highlight: '#A8B0BA', shadow: '#121416' },
  wood:     { primary: '#6A4A2E', secondary: '#3A2616', highlight: '#9C7448', shadow: '#1A1008' },
  roots:    { primary: '#4A5A32', secondary: '#26301A', highlight: '#7E9454', shadow: '#0E140A' },
  ash:      { primary: '#5A5856', secondary: '#2C2B2A', highlight: '#9A9690', shadow: '#121212' },
  sand:     { primary: '#B89A68', secondary: '#7A6240', highlight: '#E6CC98', shadow: '#3A2E1C' },
  earth:    { primary: '#5E4630', secondary: '#33261A', highlight: '#8E6E4C', shadow: '#150F0A' },
  crystal:  { primary: '#6A4E8E', secondary: '#33244A', highlight: '#C8A8FF', shadow: '#120C1C' }
};

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return a || b;
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
function scaleHex(a, f) {
  const A = hexToRgb(a);
  if (!A) return a;
  return rgbToHex(A[0] * f, A[1] * f, A[2] * f);
}

// ---------- parsing pieces ----------
function sentences(text) {
  return String(text || '').split(/(?<=[.!?;])\s+/).map(s => s.trim()).filter(Boolean);
}

function detectMaterialFor(textSentences, contextRe, fallbackText, nameText = '') {
  // Prefer materials mentioned in sentences that talk about walls (or floors),
  // weighted by how close they sit to the surface word ("the floor is polished marble").
  const scored = {};
  const scan = (txt, weight, anchor = -1) => {
    for (const [mat, words] of Object.entries(MATERIALS)) {
      for (const w of words) {
        const re = new RegExp(`\\b${w}`, 'gi');
        let m;
        while ((m = re.exec(txt))) {
          let wgt = weight;
          if (anchor >= 0) {
            const dist = Math.abs(txt.slice(Math.min(anchor, m.index), Math.max(anchor, m.index)).split(/\s+/).length - 1);
            wgt *= 1 + 6 / (1 + dist * dist);
          }
          scored[mat] = (scored[mat] || 0) + wgt;
        }
      }
    }
  };
  for (const s of textSentences) {
    const low = s.toLowerCase();
    const m = contextRe.exec(low);
    contextRe.lastIndex = 0;
    if (m) scan(low, 1, m.index);
  }
  // Only fall back to the whole text when no sentence talks about this surface.
  if (!Object.keys(scored).length) { scan(fallbackText, 1); scan(nameText, 0.5); }
  const order = Object.keys(MATERIALS);
  let best = null;
  for (const mat of order) {
    if (!scored[mat]) continue;
    if (!best || scored[mat] > scored[best]) best = mat;
  }
  return best;
}

function quantityBefore(text, index) {
  // Look at up to 4 words before a match for a number word or digit.
  const before = text.slice(Math.max(0, index - 40), index).toLowerCase();
  const words = before.split(/[^a-z0-9-]+/).filter(Boolean).slice(-4).reverse();
  for (const w of words) {
    if (/^\d+$/.test(w)) return Math.min(12, parseInt(w, 10));
    if (NUMBER_WORDS[w] !== undefined) return NUMBER_WORDS[w];
  }
  return null;
}

function conditionNear(text, index, length) {
  // Adjectives sit right before the noun ("a broken altar", "two charred statues"),
  // or right after it ("the altar, cracked and ..."). Stay inside the clause.
  const before = text.slice(Math.max(0, index - 40), index).toLowerCase().split(/[,.;:!?]| and | with | of /).pop();
  const beforeWords = before.split(/\s+/).filter(Boolean).slice(-3).join(' ');
  const after = text.slice(index + length, index + length + 24).toLowerCase().split(/[.;:!?]| and | with /)[0];
  const windowText = `${beforeWords} ${/^,/.test(after.trim()) ? after : ''}`;
  const found = [];
  for (const [cond, words] of Object.entries(CONDITION_WORDS)) {
    if (hasAny(windowText, words)) found.push(cond);
  }
  return found;
}

function detectLandmarks(text, exclude = new Set()) {
  const found = new Map();
  const lower = text.toLowerCase();
  const claimed = []; // [start,end] ranges already used by a more specific landmark
  // Longer trigger phrases first so "broken column" wins over "column".
  const entries = [];
  for (const [type, words] of Object.entries(LANDMARKS)) {
    for (const w of words) entries.push({ type, w });
  }
  entries.sort((a, b) => b.w.length - a.w.length);
  for (const { type, w } of entries) {
    if (exclude.has(type)) continue;
    if (LANDMARK_SKIP_IF_SHELL[type] && LANDMARK_SKIP_IF_SHELL[type].test(lower)) continue;
    const re = new RegExp(`\\b${w}[a-z]*`, 'gi');
    let m;
    while ((m = re.exec(lower))) {
      const start = m.index, end = m.index + m[0].length;
      if (claimed.some(([s, e]) => start < e && end > s)) continue;
      claimed.push([start, end]);
      const plural = /s$/.test(m[0]) && !/ss$/.test(m[0]);
      let qty = quantityBefore(lower, start);
      if (qty === null) qty = plural ? 2 : 1;
      if (SINGLE_FEATURE_TYPES.has(type)) qty = 1;
      const conds = conditionNear(lower, start, m[0].length);
      const prev = found.get(type);
      if (prev) {
        prev.count = Math.max(prev.count, qty);
        prev.condition = Array.from(new Set([...prev.condition, ...conds]));
        prev.mentions += 1;
      } else {
        found.set(type, { type, label: m[0], count: qty, condition: conds, mentions: 1 });
      }
    }
  }
  // A broken altar is still an altar; keep condition on it.
  return Array.from(found.values()).map(l => ({ ...l, count: Math.max(1, Math.min(8, l.count)) }));
}

function categorizeObject(name) {
  const n = norm(name);
  for (const [cat, words] of Object.entries(OBJECT_CATEGORIES)) {
    if (hasAny(n, words)) return cat;
  }
  return 'item';
}

function parseObjectProperties(line) {
  // "Objects in Room Properties: {name: "X", type: "weapon", ...}, {...}"
  const out = {};
  const t = String(line || '');
  const re = /name:\s*"([^"]+)"\s*,\s*type:\s*"([^"]*)"/gi;
  let m;
  while ((m = re.exec(t))) out[norm(m[1])] = m[2];
  return out;
}

// ---------- main builder ----------
/**
 * Build a scene spec from the game console text (or explicit fields).
 * @param {object} input { roomName, description, exits, objects, objectProperties, puzzle, coords, indoorHint }
 */
function buildSceneSpec(input = {}) {
  const roomName = String(input.roomName || '').trim();
  const description = String(input.description || '').trim();
  const puzzle = String(input.puzzle || '').trim();
  const exits = Array.isArray(input.exits) ? input.exits : splitList(input.exits);
  const objects = Array.isArray(input.objects) ? input.objects : splitList(input.objects);
  const objTypes = input.objectProperties && typeof input.objectProperties === 'object'
    ? input.objectProperties
    : parseObjectProperties(input.objectProperties);

  const full = `${roomName}. ${description}`.trim();
  // Colour compounds ("blood-red sky", "bone-white") are not materials or ground cover.
  const lower = norm(full).replace(/\b(blood|bone|ash|ice|iron|copper|bronze|ember|sand|moss|rust|lava)[- ](red|white|grey|gray|black|blue|green|pale|colou?red|hued|tinted)\b/g, '$2');
  const sents = sentences(description);

  // Biome: score each biome, room name counts double.
  const nameLower = norm(roomName);
  let biome = null, biomeScore = 0;
  for (const [b, words] of Object.entries(BIOMES)) {
    const s = countHits(lower, words) + countHits(nameLower, words) * 2;
    if (s > biomeScore) { biome = b; biomeScore = s; }
  }

  // Indoor / outdoor
  const outdoorHits = countHits(lower, OUTDOOR_WORDS);
  const indoorHits = countHits(lower, INDOOR_WORDS);
  let indoor = null;
  if (typeof input.indoorHint === 'boolean') indoor = input.indoorHint;
  else if (outdoorHits > indoorHits) indoor = false;
  else if (indoorHits > 0) indoor = true;
  if (!biome) biome = indoor === false ? 'wasteland' : null;

  // Materials
  const descLower = norm(description);
  const wallMatRaw = detectMaterialFor(sents, WALL_CONTEXT, descLower, nameLower);
  const floorMatRaw = detectMaterialFor(sents, FLOOR_CONTEXT, descLower, nameLower);

  // Ground cover + weather
  const groundCover = [];
  for (const [g, words] of Object.entries(GROUND_COVER)) {
    const hits = countHits(lower, words);
    if (hits) groundCover.push({ type: g, strength: Math.min(1, 0.35 + hits * 0.2) });
  }
  groundCover.sort((a, b) => b.strength - a.strength);
  const weather = [];
  for (const [w, words] of Object.entries(WEATHER)) {
    if (hasAny(lower, words)) weather.push(w);
  }

  // Lighting
  const sources = [];
  for (const [src, def] of Object.entries(LIGHT_SOURCES)) {
    if (hasAny(lower, def.words)) sources.push(src);
  }
  const darkHits = countHits(lower, DARK_WORDS);
  const brightHits = countHits(lower, BRIGHT_WORDS);
  let level = indoor === false ? 0.75 : 0.5;
  level += brightHits * 0.12 - darkHits * 0.08;
  if (sources.includes('sun')) level += 0.15;
  if (sources.length === 0 && indoor !== false) level -= 0.1;
  level = Math.max(0.15, Math.min(1, level));
  const primarySource = sources[0] || (indoor === false ? 'sun' : 'torch');
  let lightColor = (LIGHT_SOURCES[primarySource] || LIGHT_SOURCES.torch).color;
  if (sources.length > 1) {
    lightColor = mixHex(lightColor, LIGHT_SOURCES[sources[1]].color, 0.3);
  }
  const lighting = {
    level: Math.round(level * 100) / 100,
    color: lightColor,
    sources,
    primary: primarySource,
    mood: level < 0.35 ? 'dark' : level > 0.75 ? 'bright' : 'dim',
    flicker: sources.some(s => ['torch', 'candle', 'fire', 'lava'].includes(s))
  };

  // Landmarks from description and room name (not from the item list).
  const landmarks = detectLandmarks(full);

  // Props = every Objects in Room entry, one placed prop each.
  const magicOf = {};
  if (typeof input.objectProperties === 'string') {
    const re = /\{([^}]*)\}/g; let mm;
    while ((mm = re.exec(input.objectProperties))) {
      const nm = (mm[1].match(/name:\s*"([^"]+)"/) || [])[1];
      if (nm) magicOf[norm(nm)] = +((mm[1].match(/magic:\s*(-?\d+)/) || [])[1] || 0);
    }
  }
  const props = objects.map((name, i) => {
    const declared = objTypes[norm(name)];
    const category = declared ? String(declared).toLowerCase() : categorizeObject(name);
    return {
      id: `obj_${i}_${slug(name)}`,
      name,
      label: name,
      type: slug(name),
      category,
      declaredType: declared || '',
      magic: magicOf[norm(name)] || 0,
      assembly: AV.normalizeItemAssembly(null, { name, type: declared || category, magic: magicOf[norm(name)] || 0 }),
      source: 'objects_in_room'
    };
  });

  // Palette: start from wall material, tint toward light + ground cover.
  const baseKey = wallMatRaw || floorMatRaw || (biome === 'cave' ? 'earth' : biome === 'wasteland' ? 'sand' : 'stone');
  const base = { ...(BASE_PALETTES[baseKey] || BASE_PALETTES.stone) };
  const floorBase = BASE_PALETTES[floorMatRaw || baseKey] || base;
  const lightT = 0.12 + 0.12 * lighting.level;
  const palette = {
    primary: mixHex(base.primary, lightColor, lightT),
    secondary: base.secondary,
    highlight: mixHex(base.highlight, lightColor, 0.35),
    shadow: base.shadow,
    floorPrimary: mixHex(floorBase.primary, lightColor, lightT * 0.8),
    floorSecondary: floorBase.secondary
  };
  const topCover = groundCover[0] && groundCover[0].type;
  if (topCover === 'water') {
    palette.floorPrimary = mixHex(palette.floorPrimary, '#2E5A7A', 0.45);
    palette.floorSecondary = mixHex(palette.floorSecondary, '#173246', 0.45);
  } else if (topCover === 'ash') {
    palette.floorPrimary = mixHex(palette.floorPrimary, '#6A6866', 0.5);
  } else if (topCover === 'blood') {
    palette.floorPrimary = mixHex(palette.floorPrimary, '#6A1418', 0.35);
  } else if (topCover === 'lava') {
    palette.highlight = mixHex(palette.highlight, '#FF5A1A', 0.5);
  } else if (topCover === 'snow' || topCover === 'ice') {
    palette.floorPrimary = mixHex(palette.floorPrimary, '#DDEEFF', 0.45);
  } else if (topCover === 'moss') {
    palette.floorPrimary = mixHex(palette.floorPrimary, '#4A6A32', 0.3);
  }
  if (lighting.mood === 'dark') {
    palette.primary = scaleHex(palette.primary, 0.8);
    palette.floorPrimary = scaleHex(palette.floorPrimary, 0.8);
  }

  return {
    version: SCENE_SPEC_VERSION,
    coords: input.coords || null,
    source: { roomName, description, exits, objects, puzzle },
    biome,
    indoor,
    lighting,
    wallMaterial: wallMatRaw || null,
    floorMaterial: floorMatRaw || null,
    wallStyleMaterial: wallMatRaw ? WALL_MATERIAL_MAP[wallMatRaw] : null,
    floorStyleMaterial: floorMatRaw ? FLOOR_MATERIAL_MAP[floorMatRaw] : null,
    groundCover,
    weather,
    landmarks,
    props,
    exits,
    palette,
    textHash: simpleHash(`${roomName}|${description}|${exits.join(',')}|${objects.join(',')}`)
  };
}

function simpleHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** Pull the fields buildSceneSpec needs out of the game console text. */
function sceneInputFromConsole(gameConsole, extra = {}) {
  const t = String(gameConsole || '');
  const grab = re => (t.match(re)?.[1] || '').trim();
  const cm = t.match(/Coordinates: X: (-?\d+), Y: (-?\d+), Z: (-?\d+)/);
  return {
    roomName: grab(/Room Name: ([^\n]+)/),
    description: grab(/Room Description: ([^\n]+)/),
    exits: grab(/Exits: ([^\n]+)/),
    objects: grab(/Objects in Room: ([^\n]+)/),
    objectProperties: grab(/Objects in Room Properties: ([^\n]+)/),
    puzzle: grab(/Puzzle in Room: ([^\n]+)/) || grab(/Puzzle: ([^\n]+)/),
    coords: cm ? { x: +cm[1], y: +cm[2], z: +cm[3] } : null,
    ...extra
  };
}

// ---------- spec -> existing pipeline ----------
/** The text wins over the LLM classifier wherever the text is explicit. */
function applySceneSpecToClassification(spec, classification) {
  const c = { ...(classification || {}) };
  if (!spec) return c;
  if (spec.biome && ['wasteland', 'temple', 'ruins', 'cave', 'fortress', 'palace', 'crypt'].includes(spec.biome)) {
    c.biome = spec.biome;
  }
  if (typeof c.indoor !== 'boolean' && typeof spec.indoor === 'boolean') c.indoor = spec.indoor;
  const feats = new Set((c.features || []).map(f => String(f).toLowerCase()));
  for (const l of spec.landmarks || []) {
    if (l.type === 'pillar') feats.add('pillars');
    else feats.add(l.type);
  }
  c.features = Array.from(feats);
  if (spec.palette) {
    if (!/^#[0-9a-f]{6}$/i.test(c.floorColor || '')) c.floorColor = spec.palette.floorPrimary || c.floorColor;
    if (!/^#[0-9a-f]{6}$/i.test(c.wallColor || '')) c.wallColor = spec.palette.primary || c.wallColor;
  }
  c.sceneSpecHash = spec.textHash;
  return c;
}

/** Preserve the description's generated palette; semantic material colors are fallbacks. */
function applySceneSpecToVisualStyle(spec, style) {
  if (!spec) return style;
  const s = style ? JSON.parse(JSON.stringify(style)) : {};
  s.palette = { ...(s.palette || {}) };
  s.floor = { ...(s.floor || {}) };
  s.wall = { ...(s.wall || {}) };
  s.torch = { ...(s.torch || {}) };
  s.lighting = { dir: 'NW', elevation: 0.6, intensity: 0.6, color: '#FFFFFF', ...(s.lighting || {}) };
  s.door = { material: 'wood', bands: 'iron', handle: 'ring', ...(s.door || {}) };
  s.motifs = s.motifs || [];
  const p = spec.palette || {};
  for (const key of ['primary', 'secondary', 'highlight', 'shadow']) {
    if (!/^#[0-9a-f]{6}$/i.test(s.palette[key] || '')) s.palette[key] = p[key];
  }
  if (spec.wallStyleMaterial) s.wall.material = spec.wallStyleMaterial;
  if (spec.floorStyleMaterial) s.floor.material = spec.floorStyleMaterial;
  // Floor palette is carried separately so floor and wall can differ.
  s.floorPalette = {
    primary: s.floorPalette?.primary || (spec.floorStyleMaterial && spec.floorStyleMaterial !== spec.wallStyleMaterial ? p.floorPrimary : null) || s.palette.primary,
    secondary: s.floorPalette?.secondary || (spec.floorStyleMaterial && spec.floorStyleMaterial !== spec.wallStyleMaterial ? p.floorSecondary : null) || s.palette.secondary,
    highlight: s.palette.highlight,
    shadow: s.palette.shadow
  };
  s.groundCover = (spec.groundCover || []).map(g => g.type);
  s.weather = spec.weather || [];
  if (spec.lighting) {
    s.lighting.color = spec.lighting.color;
    s.lighting.intensity = spec.lighting.level;
    s.torch.hasTorch = spec.lighting.sources.includes('torch') || s.torch.hasTorch === true;
    s.wall.torches = s.torch.hasTorch;
    if (spec.lighting.flicker && spec.lighting.color) s.torch.flameColor = spec.lighting.color;
  }
  s.sceneSpecHash = spec.textHash;
  return s;
}

/** Landmark types the custom-tile generator must produce (one tile type each). */
function sceneRequiredCustomTypes(spec) {
  if (!spec) return [];
  return Array.from(new Set((spec.landmarks || [])
    .filter(l => l.type !== 'pillar') // plain pillars use the built-in pillar tile
    .map(l => l.type)));
}

// ---------- prose check ----------
/**
 * Compare the built dungeon against the spec. Returns what the text promised
 * that the view is missing, so the caller can log or repair it.
 */
function checkSceneAgainstDungeon(spec, dungeon) {
  const result = { ok: true, present: [], missing: [], notes: [] };
  if (!spec || !dungeon) { result.ok = false; result.notes.push('no spec or dungeon'); return result; }
  const counts = {};
  for (const cell of Object.values(dungeon.cells || {})) {
    const t = String(cell && cell.tile || '');
    if (!t) continue;
    const m = t.match(/^custom_(.+)_\d+$/);
    const key = cell.architectureRole === 'roof-support' && cell.feature === 'pillar' ? 'pillar' : m ? m[1] : t;
    counts[key] = (counts[key] || 0) + 1;
  }
  // Tiles may carry the model's own names ("broken_column"); compare by the sprite
  // drawer each name resolves to so synonyms count.
  let resolveDrawer = null;
  try { resolveDrawer = require('../assets/renderSceneProps.js').resolveLandmarkDrawer; } catch (_) {}
  const canon = (k) => (resolveDrawer && resolveDrawer(k)) || k;
  const canonCounts = {};
  for (const [k, n] of Object.entries(counts)) canonCounts[canon(k)] = (canonCounts[canon(k)] || 0) + n;
  for (const l of spec.landmarks || []) {
    if (l.fromVegetation) continue; // Ambient grove counts are reported separately, not promised by the prose.
    const have = Math.max(counts[l.type] || 0, canonCounts[canon(l.type)] || 0);
    const entry = { kind: 'landmark', type: l.type, want: l.count, have };
    if (have >= l.count) result.present.push(entry); else result.missing.push(entry);
  }
  const placed = Array.isArray(dungeon.sceneObjects) ? dungeon.sceneObjects : (Array.isArray(dungeon.props) ? dungeon.props : []);
  for (const p of spec.props || []) {
    const hit = placed.find(q => q && (q.id === p.id || norm(q.name) === norm(p.name)));
    const entry = { kind: 'object', name: p.name, have: hit ? 1 : 0, want: 1 };
    if (hit || p.taken) result.present.push(entry); else result.missing.push(entry);
  }
  const vs = dungeon.visualStyle || {};
  if (spec.wallStyleMaterial && vs.wall && vs.wall.material !== spec.wallStyleMaterial) {
    result.missing.push({ kind: 'wallMaterial', want: spec.wallStyleMaterial, have: vs.wall.material });
  }
  if (spec.floorStyleMaterial && vs.floor && vs.floor.material !== spec.floorStyleMaterial) {
    result.missing.push({ kind: 'floorMaterial', want: spec.floorStyleMaterial, have: vs.floor.material });
  }
  result.ok = result.missing.length === 0;
  return result;
}

/** One-line human summary for logs and the console. */
function describeSceneSpec(spec) {
  if (!spec) return '(no scene spec)';
  const lm = (spec.landmarks || []).map(l => `${l.count}x ${l.condition.length ? l.condition.join('/') + ' ' : ''}${l.type}`).join(', ') || 'none';
  const gc = (spec.groundCover || []).map(g => g.type).join(', ') || 'none';
  return `biome=${spec.biome || '?'} indoor=${spec.indoor} walls=${spec.wallMaterial || '?'} floor=${spec.floorMaterial || '?'} ` +
    `light=${spec.lighting.mood}/${spec.lighting.primary} ground=${gc} weather=${spec.weather.join(',') || 'none'} ` +
    `landmarks=${lm} props=${(spec.props || []).map(p => p.name).join(', ') || 'none'}`;
}

module.exports = {
  SCENE_SPEC_VERSION,
  buildSceneSpec,
  sceneInputFromConsole,
  applySceneSpecToClassification,
  applySceneSpecToVisualStyle,
  sceneRequiredCustomTypes,
  checkSceneAgainstDungeon,
  describeSceneSpec
};
