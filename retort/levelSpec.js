// retort/levelSpec.js
// Room text -> structured LEVEL spec (architecture, materials/colours, structures with counts + placement hints,
// wall decals, floor scatter, lighting, atmosphere). Reads BOTH the Room Description and the Puzzle text (the
// puzzle is usually the richest physical description).
//  - gpt-4.1-mini, JSON mode, up to 3 attempts with the validation problems fed back (same pattern as
//    characterTraitSpec.js); cached on disk by text hash (.retort-data/level-specs.json)
//  - when no key / all attempts fail, a deterministic keyword parser produces the same structure so the room
//    still gets its props, and a background retry upgrades the cache for the next visit
//  - every structure carries a generic drawing primitive (shape/size/colours/material/glow), so invented props
//    the LLM names are still drawable (renderSceneProps.js DRAW._primitive), nothing is word-matched only
'use strict';
const fs = require('fs');
const path = require('path');
const AV = require('./assemblyVocab.js');

const MODEL = process.env.HOLODEK_LEVEL_MODEL || 'gpt-4.1-mini';
const CACHE_FILE = process.env.HOLODEK_LEVEL_CACHE || path.join(__dirname, '..', '.retort-data', 'level-specs.json');
const MAX_ATTEMPTS = 3;
const LEVEL_SPEC_VERSION = 3; // v3: concrete voxel scenery and bounded local points of interest
const SHAPES = ['column', 'broken_column', 'arch', 'block', 'slab', 'statue', 'mound', 'spire', 'cluster', 'tree', 'orb', 'pool', 'bowl', 'frame', 'hanging', 'banner', 'pile', 'crystal', 'stalagmite', 'table', 'barrel'];
const PLACEMENTS = ['center', 'far_end', 'walls', 'corners', 'scattered', 'rows', 'entrance'];
const PARTICLES = ['none', 'dust', 'sand', 'snow', 'rain', 'spores', 'embers', 'mist', 'ash', 'bubbles'];
const DECALS = ['glyphs', 'vines', 'tapestry', 'cracks', 'moss', 'roots', 'frost', 'banners', 'blood', 'murals', 'cobwebs', 'water_stains', 'shelves'];
const SCATTER = ['sand', 'bones', 'coins', 'petals', 'fungi', 'leaves', 'puddles', 'snow', 'straw', 'ash', 'rubble', 'moss', 'blood', 'glass', 'embers', 'reeds'];

function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const clamp = (v, a, b, d) => (Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : d);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'prop';

// ---------------- cache ----------------
let cache = null;
function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')).entries || {}; } catch (_) { cache = {}; }
  return cache;
}
function saveCache() {
  try { fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true }); fs.writeFileSync(CACHE_FILE + '.tmp', JSON.stringify({ version: LEVEL_SPEC_VERSION, entries: cache })); fs.renameSync(CACHE_FILE + '.tmp', CACHE_FILE); } catch (e) { console.warn('[level] cache save failed', e.message); }
}

// ---------------- schema / validation ----------------
const SCHEMA = {
  architecture: 'temple|cave|crypt|forest|swamp|city_street|tavern|castle|ice_cave|desert|dungeon|mine|library|palace|ship|village|other',
  shape: 'hall|round|cross|irregular|corridor|open|courtyard', size: 'small|medium|large',
  layoutFeatures: ['short phrases e.g. "central aisle", "raised dais at far end", "collapsed north corner"'],
  wall: { material: 'stone|brick|marble|bone|obsidian|wood|metal|ice|sandstone|earth|roots|crystal|flesh|ash', color: '#rrggbb', color2: '#rrggbb' },
  floor: { material: 'stone|brick|marble|bone|obsidian|wood|metal|ice|sand|earth|roots|crystal|ash|lava|flesh', color: '#rrggbb', color2: '#rrggbb' },
  ceiling: { kind: 'vault|beams|rock|open_sky|canopy|none', color: '#rrggbb' },
  wallStyle: AV.WALL_STYLES.join('|') + ' (room-wide masonry language)',
  floorTreat: AV.FLOOR_TREAT.join('|') + ' (room-wide floor treatment)',
  structures: [{ name: 'free text e.g. "cracked sandstone arch"', count: '1-12', placement: PLACEMENTS.join('|'), blocking: true,
    // assembly options (LLM picks from the vocabulary — drawers assemble the figure; do not invent freeform shapes)
    assembly: AV.SCHEMA_STRUCTURE_ASSEMBLY,
    // legacy shape kept for back-compat; prefer assembly.kit
    shape: SHAPES.join('|'), width: '0.2-1', height: '0.2-1.4', color: '#rrggbb', color2: '#rrggbb', material: 'word', glow: '#rrggbb or null', condition: ['broken|burnt|overgrown|flooded|bloody|glowing'] }],
  decals: [{ kind: DECALS.join('|'), color: '#rrggbb', density: '0-1' }],
  scatter: [{ kind: SCATTER.join('|'), color: '#rrggbb', density: '0-1', glow: '#rrggbb or null' }],
  lighting: { color: '#rrggbb', level: '0.1-1', sources: ['torch|fungus|sun|moon|magic|fire|crystal|candle|lava|none'] },
  atmosphere: { particles: PARTICLES.join('|'), color: '#rrggbb', density: '0-1', grade: '#rrggbb (colour grading tint)' }
};
function validate(raw) {
  const p = [];
  if (!raw || typeof raw !== 'object') return ['not an object'];
  if (!Array.isArray(raw.structures) || !raw.structures.length) p.push('structures must be a non-empty array');
  (raw.structures || []).forEach((s, i) => { if (!s || !s.name) p.push(`structures[${i}].name missing`); if (s && !SHAPES.includes(s.shape)) p.push(`structures[${i}].shape must be one of ${SHAPES.join('|')}`); });
  if (!raw.wall || !raw.floor) p.push('wall and floor required');
  return p;
}
function normalize(raw) {
  const out = {
    v: LEVEL_SPEC_VERSION, architecture: String(raw.architecture || 'dungeon'), shape: String(raw.shape || 'hall'), size: String(raw.size || 'medium'),
    layoutFeatures: (raw.layoutFeatures || []).slice(0, 8).map(String),
    wall: { material: String(raw.wall?.material || 'stone'), color: isHex(raw.wall?.color) ? raw.wall.color : null, color2: isHex(raw.wall?.color2) ? raw.wall.color2 : null },
    floor: { material: String(raw.floor?.material || 'stone'), color: isHex(raw.floor?.color) ? raw.floor.color : null, color2: isHex(raw.floor?.color2) ? raw.floor.color2 : null },
    ceiling: { kind: String(raw.ceiling?.kind || 'vault'), color: isHex(raw.ceiling?.color) ? raw.ceiling.color : null },
    structures: (raw.structures || []).slice(0, 16).map((s) => {
      const assembly = AV.normalizeStructureAssembly(s.assembly || {
        kit: s.shape, state: (s.condition || [])[0], material: s.material, color: s.color, color2: s.color2, glow: s.glow
      }, s.shape, s.name);
      const wh = AV.sizeToWH(assembly.size, assembly.kit);
      const shape = AV.kitToShape(assembly.kit);
      const cond = Array.isArray(s.condition) ? s.condition.map(String) : [];
      if (assembly.state === 'collapsed' || assembly.state === 'ruined' || assembly.state === 'cracked') if (!cond.includes('broken')) cond.push('broken');
      if (assembly.state === 'overgrown') if (!cond.includes('overgrown')) cond.push('overgrown');
      if (assembly.state === 'burnt') if (!cond.includes('burnt')) cond.push('burnt');
      if (assembly.state === 'glowing' || assembly.glow) if (!cond.includes('glowing')) cond.push('glowing');
      return {
        name: String(s.name).slice(0, 60), type: slug(s.name), shape: SHAPES.includes(shape) ? shape : 'block',
        count: clamp(s.count, 1, 12, 1) | 0, placement: PLACEMENTS.includes(s.placement) ? s.placement : 'scattered',
        blocking: s.blocking !== false,
        width: clamp(s.width, 0.2, 1, wh.width), height: clamp(s.height, 0.2, 1.4, wh.height),
        color: isHex(s.color) ? s.color : assembly.color, color2: isHex(s.color2) ? s.color2 : assembly.color2,
        material: assembly.material, glow: isHex(s.glow) ? s.glow : assembly.glow, condition: cond.slice(0, 4),
        assembly
      };
    }),
    wallStyle: AV.pick(AV.WALL_STYLES, raw.wallStyle, null),
    floorTreat: AV.pick(AV.FLOOR_TREAT, raw.floorTreat, null),
    decals: (raw.decals || []).filter((d) => d && DECALS.includes(d.kind)).slice(0, 4).map((d) => ({ kind: d.kind, color: isHex(d.color) ? d.color : null, density: clamp(d.density, 0, 1, 0.5) })),
    scatter: (raw.scatter || []).filter((d) => d && SCATTER.includes(d.kind)).slice(0, 5).map((d) => ({ kind: d.kind, color: isHex(d.color) ? d.color : null, density: clamp(d.density, 0, 1, 0.5), glow: isHex(d.glow) ? d.glow : null })),
    lighting: { color: isHex(raw.lighting?.color) ? raw.lighting.color : null, level: clamp(raw.lighting?.level, 0.1, 1, 0.5), sources: (raw.lighting?.sources || []).map(String).slice(0, 4) },
    atmosphere: { particles: PARTICLES.includes(raw.atmosphere?.particles) ? raw.atmosphere.particles : 'none', color: isHex(raw.atmosphere?.color) ? raw.atmosphere.color : '#c8b890', density: clamp(raw.atmosphere?.density, 0, 1, 0.4), grade: isHex(raw.atmosphere?.grade) ? raw.atmosphere.grade : null }
  };
  return out;
}

// ---------------- deterministic fallback parser ----------------
// [regex, structure template]; counts come from number words near the match, plurals default to 3.
const VOCAB = [
  [/\b(cracked |crumbling |ruined |broken )?(sandstone |stone |marble )?arch(es|way|ways)?\b/, { shape: 'arch', placement: 'rows', width: 0.9, height: 1.1 }],
  [/\bcollapsed (pillars?|columns?)|broken (pillars?|columns?)|fallen (pillars?|columns?)/, { shape: 'broken_column', placement: 'scattered', width: 0.8, height: 0.6, condition: ['broken'] }],
  [/\b(colonnade|pillars|columns)\b/, { shape: 'column', placement: 'rows', width: 0.4, height: 1.0 }],
  [/\b(pillar|column)\b/, { shape: 'column', placement: 'rows', width: 0.4, height: 1.0 }],
  [/\baltar\b/, { shape: 'slab', placement: 'far_end', width: 0.8, height: 0.55 }],
  [/\b(statue|idol|effigy|colossus)s?\b/, { shape: 'statue', placement: 'walls', width: 0.5, height: 1.1 }],
  [/\b(sarcophag|coffin|tomb)/, { shape: 'slab', placement: 'walls', width: 0.9, height: 0.5 }],
  [/\b(throne)\b/, { shape: 'frame', placement: 'far_end', width: 0.6, height: 0.9 }],
  [/\b(obelisk|monolith|standing stones?)\b/, { shape: 'spire', placement: 'center', width: 0.4, height: 1.2 }],
  [/\b(rubble|debris|fallen stones?)\b/, { shape: 'pile', placement: 'scattered', width: 0.8, height: 0.4 }],
  [/\b(iridescent |glowing |luminous |phosphorescent )?(fungi|fungus|mushrooms?|toadstools?)( clusters?)?/, { shape: 'cluster', placement: 'walls', width: 0.6, height: 0.5, glow: '#9a7aff' }],
  [/\b(skeletal |thorny |creeping )?vines?\b/, { shape: 'hanging', placement: 'walls', width: 0.6, height: 1.0, blocking: false }],
  [/\b(tapestr(y|ies)|banners?|flags?)\b/, { shape: 'banner', placement: 'walls', width: 0.6, height: 1.0 }],
  [/\b(sand ?drifts?|dunes?|sand piles?|mounds? of sand)\b/, { shape: 'mound', placement: 'walls', width: 1, height: 0.35 }],
  [/\b(bones|skeletons?|skulls|bone piles?|remains)\b/, { shape: 'pile', placement: 'scattered', width: 0.7, height: 0.35 }],
  [/\b(brazier|firepit|fire pit|hearth)s?\b/, { shape: 'bowl', placement: 'walls', width: 0.5, height: 0.7, glow: '#ffa040' }],
  [/\b(fountain|basin|font)s?\b/, { shape: 'bowl', placement: 'center', width: 0.8, height: 0.7 }],
  [/\b(pool|pond|puddles?|bog|marsh)\b/, { shape: 'pool', placement: 'center', width: 1, height: 0.25, blocking: true }],
  [/\b(trees?|trunks?|cypress|willows?)\b/, { shape: 'tree', placement: 'scattered', width: 0.7, height: 1.3 }],
  [/\b(crystals?|geodes?|shards)\b/, { shape: 'crystal', placement: 'walls', width: 0.6, height: 0.9, glow: '#9ad8ff' }],
  [/\b(stalagmites?|stalactites?|icicles?)\b/, { shape: 'stalagmite', placement: 'scattered', width: 0.5, height: 0.9 }],
  [/\b(tables?|benches|counter|bar)\b/, { shape: 'table', placement: 'scattered', width: 0.8, height: 0.5 }],
  [/\b(barrels?|kegs?|casks?)\b/, { shape: 'barrel', placement: 'walls', width: 0.5, height: 0.6 }],
  [/\b(bookshel(f|ves)|shelves)\b/, { shape: 'frame', placement: 'walls', width: 0.8, height: 1.0 }],
  [/\b(boulders?|rocks?)\b/, { shape: 'mound', placement: 'scattered', width: 0.8, height: 0.6 }],
  [/\b(orbs?|spheres?)\b/, { shape: 'orb', placement: 'center', width: 0.5, height: 0.8, glow: '#a0c8ff' }]
];
const NUM = { a: 1, an: 1, one: 1, single: 1, two: 2, twin: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, several: 3, few: 3, many: 5, numerous: 5, rows: 6, clusters: 3 };
const MAT_WORDS = [['sandstone', /sandstone/], ['marble', /marble|alabaster/], ['obsidian', /obsidian|basalt/], ['bone', /\bbone (walls?|pillars?|arch)|walls? of bones?|ossuary/], ['ice', /\bice\b|frozen|glacial/], ['wood', /\bwood|timber|plank/], ['brick', /brick/], ['earth', /\bmud|earthen|dirt\b|soil/], ['crystal', /crystal/], ['metal', /\biron\b|steel/], ['stone', /stone|granite/]];
const MAT_COLORS = { sandstone: ['#b08a5e', '#94724c'], marble: ['#d8d4cc', '#b8b2a8'], obsidian: ['#25212b', '#18151c'], bone: ['#cfc6a8', '#a99f82'], ice: ['#a6d2ea', '#86b8d6'], wood: ['#6a4a2e', '#553a22'], brick: ['#7a4a3a', '#5a3428'], earth: ['#5e4630', '#4a3624'], crystal: ['#5a4480', '#463466'], metal: ['#5e646c', '#484d54'], stone: ['#6e6a64', '#4e4a45'] };
const COLOR_WORDS = [[/ochre/, '#b8862e'], [/crimson|blood/, '#8a1c1c'], [/emerald|verdant/, '#2e7a3e'], [/azure|cerulean/, '#3a6ab0'], [/violet|purple|amethyst/, '#6a3a9a'], [/golden|gilded/, '#c8a040'], [/iridescent/, '#9a7aff'], [/ashen|grey|gray/, '#7a7874'], [/black|ebon/, '#2a2628'], [/white|pale|bleached/, '#e0dccc'], [/rust/, '#8a4a2a'], [/moss|green/, '#4a6a32'], [/teal/, '#2a8a8a'], [/amber/, '#d0902a']];
function colorNear(text, idx) { const win = text.slice(Math.max(0, idx - 40), idx + 40); for (const [re, c] of COLOR_WORDS) if (re.test(win)) return c; return null; }
function countNear(text, idx, plural) { const before = text.slice(Math.max(0, idx - 20), idx).split(/\s+/).filter(Boolean).slice(-2); for (const w of before) { const n = NUM[w.replace(/[^a-z]/g, '')]; if (n) return n; const d = parseInt(w, 10); if (d > 0 && d < 13) return d; } return plural ? 3 : 1; }

function deriveLevelSpecFromText({ roomName = '', description = '', puzzle = '' } = {}) {
  const text = `${roomName}. ${description} ${puzzle}`.toLowerCase();
  const structures = []; const seen = new Set();
  for (const [re, tpl] of VOCAB) {
    const g = new RegExp(re.source, 'g'); let m; let total = 0; let first = null;
    while ((m = g.exec(text))) {
      if (tpl.shape === 'column' && /(collapsed|broken|fallen|toppled)\s*$/.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
      if (!first) first = m; total++;
    }
    if (!first) continue;
    const name = first[0].trim();
    const key = tpl.shape + '|' + (tpl.shape === 'column' ? 'col' : name.replace(/s$/, ''));
    if (seen.has(key)) continue; seen.add(key);
    const plural = /s\b|ies\b|fungi|clusters?/.test(name) || total > 1;
    let matWord = null; const win = text.slice(Math.max(0, first.index - 30), first.index + name.length + 10); for (const [mm, r] of MAT_WORDS) if (r.test(win)) { matWord = mm; break; }
    const cond = []; if (/cracked|broken|collapsed|crumbl|shatter|ruin|fractur/.test(win)) cond.push('broken'); if (/overgrown|vine|moss/.test(win)) cond.push('overgrown');
    if (tpl.glow || /glow|lumin|pulsing|phosphor/.test(win)) cond.push('glowing');
    const count = Math.min(8, countNear(text, first.index, plural) * (tpl.placement === 'rows' && plural ? 2 : 1));
    const color = (matWord ? MAT_COLORS[matWord][0] : null) || colorNear(text.slice(first.index - 25 < 0 ? 0 : first.index - 25, first.index + name.length + 5), Math.min(25, first.index));
    const assembly = AV.normalizeStructureAssembly({
      kit: tpl.shape === 'broken_column' ? 'broken_pillar' : tpl.shape === 'column' ? 'pillar' : tpl.shape === 'cluster' ? 'fungi' : tpl.shape === 'hanging' ? 'vines' : tpl.shape === 'mound' ? 'rubble' : tpl.shape === 'pile' ? 'bones' : tpl.shape === 'slab' ? 'altar' : tpl.shape === 'bowl' ? 'brazier' : tpl.shape,
      state: (cond[0] === 'broken' ? (/collaps|fallen|toppl/.test(name) ? 'collapsed' : 'cracked') : (cond.includes('glowing') ? 'glowing' : (cond.includes('overgrown') ? 'overgrown' : 'intact'))),
      material: matWord || undefined, color, glow: tpl.glow || undefined
    }, tpl.shape, name);
    structures.push({ name, shape: tpl.shape, count, placement: tpl.placement, blocking: tpl.blocking !== false,
      width: tpl.width, height: tpl.height, color, color2: null, material: matWord || '', glow: tpl.glow || null, condition: tpl.condition || cond, assembly });
  }
  if (!structures.length) structures.push({ name: 'rubble', shape: 'pile', count: 2, placement: 'scattered', blocking: true, width: 0.7, height: 0.4, color: null, material: '', glow: null, condition: [] });
  let wallMat = 'stone'; for (const [m, r] of MAT_WORDS) if (r.test(text)) { wallMat = m; break; }
  if (wallMat === 'stone' && /swamp|bog|marsh|mire|forest|grove|woods/.test(text) && !/stone wall|walls of stone/.test(text)) wallMat = /root|cypress|tree|wood/.test(text) ? 'roots' : 'earth';
  const floorMat = /\bsand|dune|desert/.test(text) ? 'sand' : /\bmud|bog|swamp|marsh/.test(text) ? 'earth' : /\bice|frozen|snow/.test(text) ? 'ice' : /plank|tavern|wooden floor/.test(text) ? 'wood' : wallMat === 'sandstone' ? 'sand' : wallMat;
  const arch = /temple|shrine|sanctum|necropolis/.test(text) ? 'temple' : /crypt|tomb|catacomb|ossuary/.test(text) ? 'crypt' : /swamp|bog|marsh|mire/.test(text) ? 'swamp' : /tavern|inn\b|alehouse/.test(text) ? 'tavern' : /ice cave|glacier|frozen cave/.test(text) ? 'ice_cave' : /cave|cavern|grotto/.test(text) ? 'cave' : /forest|woods|grove/.test(text) ? 'forest' : /street|alley|market|plaza/.test(text) ? 'city_street' : /castle|keep|fortress/.test(text) ? 'castle' : 'dungeon';
  const decals = [];
  if (/glyph|rune|sigil|inscription|etched|carving/.test(text)) decals.push({ kind: 'glyphs', color: /gold/.test(text) ? '#c8a040' : '#3a2a1a', density: 0.6 });
  if (/vine|creeper|ivy/.test(text)) decals.push({ kind: 'vines', color: /skeletal|dead|withered|dry/.test(text) ? '#8a7a5a' : '#3a6a2a', density: 0.6 });
  if (/mural|fresco/.test(text)) decals.push({ kind: 'murals', color: '#8a2a2a', density: 0.3 });
  if (/crack|fractur|crumbl/.test(text)) decals.push({ kind: 'cracks', color: '#1a1410', density: 0.6 });
  if (/frost|rime|icicle/.test(text)) decals.push({ kind: 'frost', color: '#e8f6ff', density: 0.6 });
  if (/cobweb|spider ?web/.test(text)) decals.push({ kind: 'cobwebs', color: '#d0d0d0', density: 0.5 });
  const scatter = [];
  const addS = (re, kind, color, glow) => { if (re.test(text) && !scatter.some((s) => s.kind === kind)) scatter.push({ kind, color, density: 0.6, glow: glow || null }); };
  addS(/\bsand|dust|dune/, 'sand', /ochre/.test(text) ? '#c08a3a' : '#c8aa78'); addS(/\bbones?\b|skeleton|skull/, 'bones', '#e0d6c0'); addS(/\bcoins?\b|treasure/, 'coins', /rust/.test(text) ? '#8a5a2a' : '#d8b040');
  addS(/petal|blossom|flower/, 'petals', /bone-dry|dry|wither/.test(text) ? '#b89a7a' : '#c84a6a'); addS(/fungi|fungus|mushroom|spore/, 'fungi', '#9a7aff', /glow|iridescent|lumin|puls/.test(text) ? '#b89aff' : null);
  addS(/\bleaves|leaf\b/, 'leaves', '#7a5a2a'); addS(/puddle|water|damp|bog|swamp/, 'puddles', '#2e5a7a'); addS(/\bsnow/, 'snow', '#eef6ff'); addS(/straw|hay|sawdust/, 'straw', '#c8aa5a'); addS(/\bash\b|cinder|soot/, 'ash', '#6a6866'); addS(/rubble|debris|fallen stone/, 'rubble', '#6e6a64');
  addS(/broken glass|shards of glass/, 'glass', '#c8e8f0'); addS(/reeds|rushes/, 'reeds', '#7a8a3a');
  const particles = /sandstorm|sand-laden|swirling sand/.test(text) ? 'sand' : /snow|blizzard/.test(text) ? 'snow' : /rain|drizzle|downpour/.test(text) ? 'rain' : /spore/.test(text) ? 'spores' : /ember|sparks|smoulder/.test(text) ? 'embers' : /mist|fog|vapou?r/.test(text) ? 'mist' : /\bash\b|cinder/.test(text) ? 'ash' : /dust/.test(text) ? 'dust' : 'none';
  const pColor = { sand: /ochre/.test(text) ? '#c8964a' : '#d0b080', snow: '#f0f8ff', rain: '#8aa8c8', spores: '#b8a0ff', embers: '#ffa040', mist: '#c8d0d8', ash: '#8a8884', dust: '#c8b890', none: '#ffffff' }[particles];
  const lightColor = /torch|brazier|fire|lantern|hearth/.test(text) ? '#ffc070' : /fungi|fungus|iridescent/.test(text) ? '#ecdcff' : /torch|brazier|fire|lantern|hearth/.test(text) ? '#ffc070' : /moon/.test(text) ? '#a8c0ff' : /sun|daylight/.test(text) ? '#fff0d0' : /ice|frost/.test(text) ? '#c8e8ff' : '#ffd8a0';
  const wc = MAT_COLORS[wallMat] || MAT_COLORS.stone; const fc = MAT_COLORS[floorMat] || (floorMat === 'sand' ? ['#b89a68', '#a0845a'] : wc);
  const wallStyle = /sandstone/.test(text) ? 'sandstone_block' : /brick/.test(text) ? 'brick' : /timber|plank|wood/.test(text) ? 'timber' : /ice/.test(text) ? 'ice_block' : /root|vine.?woven/.test(text) ? 'root_woven' : /crystal/.test(text) ? 'crystal_facet' : /bone/.test(text) ? 'bone_stack' : /marble/.test(text) ? 'ashlar' : /cyclopean|huge.?block/.test(text) ? 'cyclopean' : 'rough_hewn';
  const floorTreat = floorMat === 'sand' ? 'sand' : floorMat === 'earth' ? (/mud|bog|swamp/.test(text) ? 'mud' : 'packed_earth') : floorMat === 'ice' ? 'ice' : floorMat === 'wood' ? 'planks' : floorMat === 'ash' ? 'ash' : /mosaic|tile/.test(text) ? 'mosaic' : /flag|cobble/.test(text) ? 'flagstone' : 'flagstone';
  return normalize({
    architecture: arch, shape: /round|circular/.test(text) ? 'round' : /corridor|passage|tunnel/.test(text) ? 'corridor' : 'hall', size: /vast|huge|sprawl|great hall|enormous/.test(text) ? 'large' : 'medium',
    layoutFeatures: [], wallStyle, floorTreat, wall: { material: wallMat, color: colorNear(text, text.indexOf(wallMat)) || wc[0], color2: wc[1] }, floor: { material: floorMat, color: fc[0], color2: fc[1] },
    ceiling: { kind: /open sky|sky above|outdoors/.test(text) ? 'open_sky' : /cave|cavern/.test(text) ? 'rock' : 'vault', color: null },
    structures, decals, scatter, lighting: { color: lightColor, level: /dark|gloom|shadow/.test(text) ? 0.35 : 0.55, sources: [] },
    atmosphere: { particles, color: pColor, density: particles === 'none' ? 0 : /storm|howl|blizzard|thick/.test(text) ? 0.7 : 0.4, grade: particles === 'sand' ? '#c89a5a' : null }
  });
}

// ---------------- LLM ----------------
let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.OPENAI_API_KEY) return null;
  try { const { OpenAI } = require('openai'); client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000 }); } catch (_) { client = null; }
  return client;
}
function buildMessages(input, problems) {
  const sys = ['You are the level designer for a retro first-person dungeon crawler with real voxel scenery on a heightfield grid.',
    'Use physical architecture and recognizable objects, not only walls, torches and pillars. When justified by the text, prioritize dead trees, gravestones, furnaces, roots, broken arches, altars, rubble and basins.',
    'Keep each landmark count modest (1-6), clustered into a local point of interest. Do not turn a single object into thousands of repeated tiles. Use a recognizable canonical noun in every structure name.',
    'The engine supports one walkable height per XY cell. Do not promise stacked rooms, a passable arch inside a blocking prop tile, rope physics or moving platforms. Interactive seal puzzles are supplied by code; do not invent new puzzle commands or rewards.',
    'Turn the room text into a JSON level spec. Read BOTH the room description and the puzzle text; the puzzle text often holds the most',
    'physical detail. List EVERY physical structure the text mentions, with realistic counts and a placement hint, and invent 1-3 fitting extras',
    'if the room would feel empty. For EACH structure fill "assembly" by PICKING from the given enums (kit, state, base, ornament, material, size)',
    '— the renderer assembles a figure from those options, so choose combinations that match the words (e.g. cracked sandstone arch -> kit:arch,',
    'state:cracked, material:sandstone, ornament:cracks). Also pick room-wide wallStyle and floorTreat. Strong hex colours from the words.',
    'Non-physical text (lore, quotes, abstract mood) must be ignored. Named characters are NOT props.',
    'Respond with ONE JSON object with exactly these keys:', JSON.stringify(SCHEMA)].join(' ');
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ roomName: input.roomName, description: input.description, puzzle: input.puzzle }) }];
  if (problems && problems.length) msgs.push({ role: 'user', content: 'Your previous answer failed validation: ' + problems.join('; ') + '. Return a corrected JSON object.' });
  return msgs;
}
async function callModel(input) {
  const c = getClient(); if (!c) return null;
  let problems = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await c.chat.completions.create({ model: MODEL, messages: buildMessages(input, problems), response_format: { type: 'json_object' }, temperature: 0.6, max_tokens: 1800 });
      const raw = JSON.parse(r.choices[0].message.content || '{}');
      const found = validate(raw);
      if (!found.length) return normalize(raw);
      problems = found;
    } catch (e) { problems = null; console.warn(`[level] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${e.message}`); }
    if (attempt < MAX_ATTEMPTS) await new Promise((res) => setTimeout(res, 600 * Math.pow(2, attempt - 1)));
  }
  return null;
}
const retrying = new Set();
function scheduleBackgroundRetry(key, input, delay = 30000) {
  if (retrying.has(key) || !getClient()) return;
  retrying.add(key);
  setTimeout(async () => {
    const spec = await callModel(input).catch(() => null);
    retrying.delete(key);
    if (spec) { loadCache()[key] = { spec, source: 'llm', at: Date.now() }; saveCache(); }
    else scheduleBackgroundRetry(key, input, Math.min(900000, delay * 3));
  }, delay).unref?.();
}

/** Level spec for the room text: cached LLM spec, else a fresh LLM call, else the deterministic parser. */
async function getLevelSpec(input = {}) {
  const key = hash(`${LEVEL_SPEC_VERSION}|${input.roomName || ''}|${input.description || ''}|${input.puzzle || ''}`);
  const c = loadCache();
  if (c[key] && c[key].source === 'llm') return { ...c[key].spec, source: 'llm', key };
  const spec = await callModel(input).catch(() => null);
  if (spec) { c[key] = { spec, source: 'llm', at: Date.now() }; saveCache(); return { ...spec, source: 'llm', key }; }
  scheduleBackgroundRetry(key, input);
  return { ...deriveLevelSpecFromText(input), source: 'text', key };
}

/** Merge a level spec into the scene spec (structures -> landmarks with drawing primitives, materials, lighting...). */
function applyLevelSpecToScene(sceneSpec, level) {
  if (!sceneSpec || !level) return sceneSpec;
  sceneSpec.level = level;
  const wallMats = ['stone', 'brick', 'marble', 'bone', 'obsidian', 'wood', 'metal', 'ice', 'sandstone', 'earth', 'roots', 'crystal', 'flesh', 'ash', 'lava'];
  const floorMats = ['stone', 'brick', 'marble', 'bone', 'obsidian', 'wood', 'metal', 'ice', 'sand', 'earth', 'roots', 'crystal', 'ash', 'lava', 'flesh'];
  if (wallMats.includes(level.wall.material)) sceneSpec.wallStyleMaterial = level.wall.material;
  if (floorMats.includes(level.floor.material)) sceneSpec.floorStyleMaterial = level.floor.material;
  const pal = sceneSpec.palette = { ...(sceneSpec.palette || {}) };
  if (level.wall.color) pal.primary = level.wall.color;
  if (level.wall.color2) pal.secondary = level.wall.color2;
  if (level.floor.color) pal.floorPrimary = level.floor.color;
  if (level.floor.color2) pal.floorSecondary = level.floor.color2;
  sceneSpec.paletteStrength = 0.6;
  if (level.lighting && level.lighting.color) sceneSpec.lighting = { ...(sceneSpec.lighting || {}), color: level.lighting.color, level: level.lighting.level };
  // structures replace the keyword landmarks of the same kind; keep text landmarks the level spec missed
  if (level.wallStyle) sceneSpec.wallStyle = level.wallStyle;
  if (level.floorTreat) sceneSpec.floorTreat = level.floorTreat;
  const lms = level.structures.map((s) => ({ type: s.type, label: s.name, count: s.count, condition: s.condition, placement: s.placement, assembly: s.assembly || null, prim: { shape: s.shape, width: s.width, height: s.height, color: s.color, color2: s.color2, material: s.material, glow: s.glow, blocking: s.blocking, assembly: s.assembly || null }, fromLevelSpec: true }));
  const shapesCovered = new Set(lms.map((l) => l.prim.shape));
  const keep = (sceneSpec.landmarks || []).filter((l) => !lms.some((m) => m.type.includes(l.type) || l.type.includes(m.type)) && !(l.type === 'pillar' && shapesCovered.has('column')));
  sceneSpec.landmarks = [...lms, ...keep].slice(0, 18);
  sceneSpec.decals = level.decals;
  sceneSpec.scatter = level.scatter;
  sceneSpec.atmosphere = level.atmosphere;
  sceneSpec.architecture = level.architecture;
  return sceneSpec;
}

module.exports = { getLevelSpec, deriveLevelSpecFromText, applyLevelSpecToScene, normalize, validate, SHAPES, LEVEL_SPEC_VERSION, AV };
