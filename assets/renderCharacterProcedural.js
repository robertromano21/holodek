// assets/renderCharacterProcedural.js
// Deterministic procedural pixel-art character generator (browser + node, UMD).
//
// Pipeline:
//   console text --parseConsoleCharacterSheets--> sheets {name, sex, race, class, level, equipped, hp, maxHp, isMonster}
//   sheet --deriveFallbackTraits--> trait spec (keyword / word-part tables, seeded coherent defaults for unknown words)
//   (server) sheet --LLM (retort/characterTraitSpec.js)--> raw JSON --normalizeTraitSpec--> trait spec (same schema)
//   sheet + traits + salt/variant --buildProceduralSpriteSpec--> spriteSpec {kind:'procedural', ...}
//   spriteSpec --renderProceduralPixels--> 48x48 RGBA pixel buffer (outlined, shaded, glows) per animation frame
//   pixels --createProceduralCharacterCanvas / SheetCanvas / DataUrl--> nearest-neighbour upscaled canvases
// Uniqueness: perceptual hash of the rendered pixels + trait signature; ensureDistinctSpriteSpec re-rolls the
// variation (proportions, hue shifts, accessories, markings) until the sprite is far enough from known ones.
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.ProceduralCharacters = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const GRID = 64; // enlarged so hanging dragon wings / tip-up swords are not cropped
  const DEFAULT_SCALE = 4;
  const SPEC_VERSION = 3;

  // ---------------------------------------------------------------- canvas
  let nodeCreateCanvas = null;
  if (typeof window === 'undefined' && typeof require === 'function') {
    try { nodeCreateCanvas = require('canvas').createCanvas; } catch (e) { nodeCreateCanvas = null; }
  }
  function createCanvas(w, h) {
    if (nodeCreateCanvas) return nodeCreateCanvas(w, h);
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w; c.height = h; return c;
    }
    return null;
  }

  // ---------------------------------------------------------------- rng / hashing
  function hashString(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    return h >>> 0;
  }
  function makeRng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    const next = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length) % arr.length];
    next.chance = (p) => next() < p;
    next.range = (lo, hi) => lo + next() * (hi - lo);
    return next;
  }

  // ---------------------------------------------------------------- colour helpers
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function hexToRgb(hex, fallback) {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex || '').trim());
    if (!m) return fallback ? hexToRgb(fallback) : [128, 128, 128];
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(c) {
    return '#' + c.slice(0, 3).map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  function rgbToHsl(c) {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function lighten(c, t) { return mix(c, [255, 255, 255], t); }
  function darken(c, t) { return mix(c, [0, 0, 0], t); }
  function shiftHue(c, deg, satMul, lightAdd) {
    const hsl = rgbToHsl(c);
    return hslToRgb(hsl[0] + deg, clamp(hsl[1] * (satMul || 1), 0, 1), clamp(hsl[2] + (lightAdd || 0), 0, 1));
  }
  function luminance(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
  // Shade ramp with hue shifting (warm highlights, cool shadows) — classic pixel-art trick.
  function rampLight(c, t) { return shiftHue(lighten(c, t), -8, 1.02, 0); }
  function rampDark(c, t) { return shiftHue(darken(c, t), 10, 1.08, 0); }

  // ---------------------------------------------------------------- schema
  const BODY_PLANS = ['humanoid', 'beast', 'serpent', 'insectoid', 'spider', 'ooze', 'elemental', 'spectral', 'skeletal', 'draconic', 'giant'];
  const SIZES = { tiny: 0.62, small: 0.8, medium: 1, large: 1.12, huge: 1.26 };
  const BUILDS = ['slender', 'average', 'heavy'];
  const COVERINGS = ['skin', 'fur', 'scales', 'chitin', 'bone', 'slime', 'flame', 'stone', 'mist', 'feathers', 'bark', 'metal', 'crystal', 'water', 'shadow'];
  const HEADS = ['human', 'beast', 'skull', 'reptile', 'insect', 'bird', 'demon', 'eyeless', 'none'];
  const HORNS = ['none', 'nubs', 'curved', 'ram', 'antlers', 'long', 'crown'];
  const WINGS = ['none', 'bat', 'feather', 'insect', 'bone', 'spectral', 'flame'];
  const TAILS = ['none', 'thin', 'thick', 'scaled', 'tentacle', 'flame', 'wisp', 'stinger'];
  const EARS = ['none', 'human', 'pointed', 'long', 'animal', 'fin'];
  const HAIRS = ['none', 'short', 'long', 'flowing', 'braid', 'mohawk', 'topknot', 'snakes', 'flame'];
  const EYE_STYLES = ['normal', 'slit', 'hollow', 'compound', 'cyclops', 'glowing'];
  const MARKINGS = ['none', 'stripes', 'spots', 'runes', 'veins', 'cracks', 'scales'];
  const ELEMENTS = ['none', 'fire', 'frost', 'storm', 'shadow', 'void', 'earth', 'water', 'poison', 'holy', 'blood', 'sand', 'arcane', 'bone'];
  const OUTFITS = ['none', 'robe', 'plate', 'leather', 'cloak', 'rags', 'tabard', 'furs', 'gi', 'dress', 'mail'];
  const HELMS = ['none', 'hood', 'open', 'closed', 'horned', 'crown', 'circlet', 'cowl'];
  const SYMBOLS = ['none', 'holy', 'skull', 'eye', 'rune', 'sun', 'moon', 'flame', 'star'];
  const ITEM_TYPES = ['sword', 'greatsword', 'scimitar', 'axe', 'staff', 'bow', 'crossbow', 'dagger', 'mace', 'hammer', 'flail', 'spear', 'trident', 'scythe', 'sickle', 'wand', 'whip', 'claws', 'orb', 'crystal', 'amulet', 'crown', 'tome', 'lantern', 'ring', 'skull', 'horn', 'banner', 'shield'];
  const ITEM_SLOTS = ['weapon', 'shield', 'armor', 'other'];
  const SHIELD_SHAPES = ['round', 'kite', 'tower', 'heater', 'buckler', 'spiked'];
  const PALETTE_KEYS = ['skin', 'skin2', 'hair', 'outfit', 'outfit2', 'trim', 'metal', 'eye', 'glow', 'aura'];

  function traitSchemaDescription() {
    return {
      bodyPlan: BODY_PLANS, size: Object.keys(SIZES), build: BUILDS, covering: COVERINGS, head: HEADS,
      horns: HORNS, wings: WINGS, tail: TAILS, ears: EARS, hair: HAIRS,
      eyes: { count: '1-8', style: EYE_STYLES, glow: 'boolean' },
      extraArms: '0-2', tentacles: '0-8', spikes: 'boolean', mane: 'boolean', beard: 'boolean', tusks: 'boolean', fangs: 'boolean',
      translucency: '0-0.7', tattered: 'boolean', floating: 'boolean', halo: 'boolean', markings: MARKINGS, element: ELEMENTS,
      palette: PALETTE_KEYS.reduce((o, k) => { o[k] = '#rrggbb'; return o; }, {}),
      outfit: { style: OUTFITS, hood: 'boolean', cape: 'boolean', helm: HELMS, symbol: SYMBOLS },
      items: [{ slot: ITEM_SLOTS, type: ITEM_TYPES, name: 'string', color: '#rrggbb', accent: '#rrggbb', glow: 'boolean', shape: SHIELD_SHAPES }],
      aura: { color: '#rrggbb', strength: '0-1' }
    };
  }

  // ---------------------------------------------------------------- console sheet parsing
  const SHEET_STAT_KEYS = /^(Level|AC|XP|HP|MaxHP|Max HP|Equipped|Attack|Damage|Armor|Magic|Inventory|Gold|Status|State|Alignment|Speed)\s*:/i;
  function cleanItemName(v) {
    const s = String(v || '').trim().replace(/^["']|["']$/g, '');
    return (!s || /^none$/i.test(s) || /^n\/?a$/i.test(s)) ? '' : s;
  }
  function parseEquippedLine(text) {
    const out = { weapon: '', armor: '', shield: '', other: '' };
    const s = String(text || '');
    const grab = (key) => {
      const m = new RegExp(key + '\\s*:\\s*([^,]*?)(?=,\\s*(?:Weapon|Armor|Shield|Other)\\s*:|$)', 'i').exec(s);
      return m ? cleanItemName(m[1]) : '';
    };
    out.weapon = grab('Weapon'); out.armor = grab('Armor'); out.shield = grab('Shield'); out.other = grab('Other');
    return out;
  }
  function parseSheetBlock(text, opts) {
    const options = opts || {};
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length) lines[0] = lines[0].replace(/^(PC|NPCs in Party|Monsters in Room)\s*:\s*/i, '').trim();
    while (lines.length && !lines[0]) lines.shift();
    if (!lines.length || /^none\.?$/i.test(lines[0])) return [];
    const records = [];
    let cur = null;
    const freeFields = ['name', 'sex', 'race', 'class'];
    for (const line of lines) {
      if (!line) continue;
      if (SHEET_STAT_KEYS.test(line)) {
        if (!cur) continue;
        cur._stats = true;
        const idx = line.indexOf(':');
        const key = line.slice(0, idx).trim().toLowerCase().replace(/\s+/g, '');
        const val = line.slice(idx + 1).trim();
        if (key === 'equipped') cur.equipped = parseEquippedLine(val);
        else if (key === 'level') cur.level = parseInt(val, 10) || 1;
        else if (key === 'hp') cur.hp = parseInt(val, 10) || 0;
        else if (key === 'maxhp') cur.maxHp = parseInt(val, 10) || 0;
        else if (key === 'ac') cur.ac = parseInt(val, 10) || 0;
        continue;
      }
      if (/^[A-Za-z][A-Za-z ]{2,40}:\s/.test(line) && cur && cur._stats) continue; // unknown stat line
      if (/^[-+]?\d+(\s*\/\s*\d+)?$/.test(line)) { if (cur && cur._free >= 1) cur._stats = true; continue; } // bare number = stat, never a name
      if (!cur || cur._free >= 4 || (cur._stats && cur._free >= 1)) {
        cur = { name: '', sex: '', race: '', class: '', level: 1, equipped: { weapon: '', armor: '', shield: '', other: '' }, hp: 0, maxHp: 0, isMonster: !!options.isMonster, role: options.role || (options.isMonster ? 'monster' : 'npc'), _free: 0, _stats: false };
        records.push(cur);
      }
      cur[freeFields[cur._free]] = line;
      cur._free++;
    }
    return records.filter((r) => r.name).map((r) => { delete r._free; delete r._stats; return r; });
  }
  function sliceConsoleBlock(text, header) {
    const src = String(text || '');
    const re = new RegExp('(^|\\n)\\s*' + header + '\\s*:', 'i');
    const m = re.exec(src);
    if (!m) return '';
    const start = m.index + m[0].length;
    const rest = src.slice(start);
    const lines = rest.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (i > 0 && /^\S/.test(raw) && /^[A-Za-z][A-Za-z ]{1,40}:/.test(trimmed) && !SHEET_STAT_KEYS.test(trimmed)) break;
      out.push(raw);
    }
    return out.join('\n');
  }
  function parseEquippedProperties(text) {
    const map = {};
    const re = /\{\s*name:\s*"([^"]+)"\s*,\s*type:\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(String(text || '')))) map[m[1].toLowerCase()] = m[2].toLowerCase();
    return map;
  }
  function parseConsoleCharacterSheets(consoleText) {
    const text = String(consoleText || '');
    const pc = parseSheetBlock(sliceConsoleBlock(text, 'PC'), { role: 'pc' }).slice(0, 1);
    const npcs = parseSheetBlock(sliceConsoleBlock(text, 'NPCs in Party'), { role: 'npc' });
    const monsters = parseSheetBlock(sliceConsoleBlock(text, 'Monsters in Room'), { role: 'monster', isMonster: true });
    const propLine = /Monsters Equipped Properties:\s*([^\n]*)/i.exec(text);
    const props = parseEquippedProperties(propLine ? propLine[1] : '');
    const stateLine = /Monsters State:\s*([^\n]*)/i.exec(text);
    const hostile = stateLine ? /hostile|aggress|attack|angry|enrag/i.test(stateLine[1]) : false;
    monsters.forEach((m) => { m.itemTypes = props; m.hostile = hostile; });
    return { pc, npcs, monsters, all: pc.concat(npcs, monsters) };
  }

  // ---------------------------------------------------------------- keyword tables
  // Materials / elements: colour a role (skin for race words, item colour for item words, accents for class words).
  const MAT = {};
  function defMat(keys, def) { keys.split(' ').forEach((k) => { MAT[k] = def; }); }
  defMat('sand dune desert dust', { c: '#d6b27a', c2: '#a27a48', glow: '#ffe6a6', el: 'sand' });
  defMat('shadow shade gloom dusk umbral umbra murk', { c: '#3d3552', c2: '#221c33', glow: '#a77bff', el: 'shadow' });
  defMat('night dark', { c: '#2c2a40', c2: '#17162a', glow: '#8d8dff', el: 'shadow' });
  defMat('glass mirror mirage', { c: '#bfe6ee', c2: '#7fb3c6', glow: '#eaffff', glassy: true });
  defMat('storm thunder lightning tempest gale squall', { c: '#4e76b6', c2: '#2a3d70', glow: '#fff27a', el: 'storm' });
  defMat('vein', { c: '#8a2e4a', c2: '#521834', glow: '#ff5f86', mark: 'veins' });
  defMat('blood crimson scarlet gore sanguine', { c: '#9a1d29', c2: '#540c15', glow: '#ff3b4a', el: 'blood' });
  defMat('bone ivory marrow', { c: '#e2dbc3', c2: '#a69d82', glow: '#dcffe9', el: 'bone' });
  defMat('gold golden gilded aureate', { c: '#e6b53f', c2: '#9b6b14', glow: '#fff1a6' });
  defMat('silver mithril moonsilver', { c: '#cbd3dd', c2: '#7e8898', glow: '#ffffff' });
  defMat('iron steel', { c: '#8d939b', c2: '#4e535b' });
  defMat('rust', { c: '#9b5a2c', c2: '#5c3218' });
  defMat('bronze copper brass', { c: '#b87a3c', c2: '#74461c', glow: '#ffd08a' });
  defMat('frost ice rime winter glacial snow cryo hoar frozen', { c: '#aee5ff', c2: '#5c9ed0', glow: '#e8fcff', el: 'frost' });
  defMat('flame fire ember blaze inferno cinder pyre burn burning magma lava scorch hellfire', { c: '#ff7a22', c2: '#b5330f', glow: '#ffe066', el: 'fire' });
  defMat('ash ashen soot', { c: '#7f7874', c2: '#4c4744', glow: '#ff9a52' });
  defMat('void null oblivion', { c: '#2b1848', c2: '#130920', glow: '#e05cff', el: 'void' });
  defMat('abyss deep depth', { c: '#1d3160', c2: '#0e1633', glow: '#4ff2d8', el: 'void' });
  defMat('venom poison toxic blight plague rot bile', { c: '#6dbd3b', c2: '#356a1b', glow: '#c8ff5c', el: 'poison' });
  defMat('holy celestial divine radiant sacred dawn hallowed blessed', { c: '#fff1c4', c2: '#d8b45a', glow: '#fffbe0', el: 'holy' });
  defMat('sun solar', { c: '#ffd254', c2: '#d48a1c', glow: '#fff6b0', el: 'holy' });
  defMat('thorn briar vine moss root bark wood grove fung spore bloom leaf verdant', { c: '#56723a', c2: '#2f421c', glow: '#b8ff6c', el: 'earth' });
  defMat('stone rock granite earth clay boulder', { c: '#8b847a', c2: '#55504a', glow: '#ffb35a', el: 'earth' });
  defMat('obsidian onyx ebon jet', { c: '#28232f', c2: '#131017', glow: '#ff5a3a' });
  defMat('crystal gem amethyst prism quartz', { c: '#b78cff', c2: '#6a45c2', glow: '#f3dcff', el: 'arcane' });
  defMat('arcane mystic astral aether ether rune runic eldritch', { c: '#6b5bd0', c2: '#3a2f80', glow: '#b9a8ff', el: 'arcane' });
  defMat('star moon lunar', { c: '#cfd8f2', c2: '#7a86b4', glow: '#eef4ff', el: 'arcane' });
  defMat('sea tide brine water coral drown wave river', { c: '#3f8fa8', c2: '#1f4f66', glow: '#8ff3ff', el: 'water' });
  defMat('mist fog smoke vapor haze cloud', { c: '#a9afbc', c2: '#6c7281', glow: '#e1e8ff' });
  defMat('grave tomb crypt death necro soul dread doom hex curse wither barrow', { c: '#4b5064', c2: '#2a2d3b', glow: '#7dffb0', el: 'shadow' });
  defMat('jade emerald', { c: '#2fa36b', c2: '#17603c', glow: '#9dffcf' });
  defMat('ruby', { c: '#c2183a', c2: '#6e0b20', glow: '#ff7a95' });
  defMat('sapphire azure cobalt', { c: '#2a5fd6', c2: '#163378', glow: '#9ec2ff' });
  defMat('amber', { c: '#e09a2a', c2: '#8d5a10', glow: '#ffd58a' });
  defMat('pale white', { c: '#e6e3dc', c2: '#a9a59c' });
  defMat('grey gray', { c: '#85848a', c2: '#4f4e55' });
  defMat('black', { c: '#26242b', c2: '#121116' });
  defMat('violet purple', { c: '#7b3fb0', c2: '#45206a', glow: '#d6a8ff' });
  defMat('green', { c: '#4f9a3a', c2: '#2b5a1f' });
  defMat('red', { c: '#b0302c', c2: '#621816' });
  defMat('blue', { c: '#3a64b8', c2: '#20376a' });
  const GLOW_WORDS = /(glow|rune|eternal|ember|storm|void|soul|spirit|astral|arcane|blaze|radian|lumin|shining|bright|burning|crackl|living|cursed|ethereal|phantom|star|moon|orb|crystal)/i;

  // Creature / race words. plan: [plan, priority]. hy: plan demoted to humanoid in compounds like "-kin/-spawn/-born".
  const CRE = {};
  function defCre(keys, def) { keys.split(' ').forEach((k) => { CRE[k] = def; }); }
  defCre('human man woman mortal', { plan: ['humanoid', 1], skin: 'human' });
  defCre('elf elven eladrin sylvari', { plan: ['humanoid', 1], ears: 'pointed', build: 'slender', skin: 'human' });
  defCre('drow', { plan: ['humanoid', 1], ears: 'pointed', build: 'slender', c: '#4c3f61', c2: '#2c2340', hairC: '#eeeef5' });
  defCre('dwarf dwarven duergar', { plan: ['humanoid', 1], size: 'small', build: 'heavy', beard: true, skin: 'human' });
  defCre('halfling hobbit gnome', { plan: ['humanoid', 1], size: 'small', ears: 'pointed', skin: 'human' });
  defCre('orc ork uruk', { plan: ['humanoid', 2], build: 'heavy', tusks: true, ears: 'pointed', c: '#5f8a3c', c2: '#38561f' });
  defCre('goblin', { plan: ['humanoid', 2], size: 'small', ears: 'long', c: '#7d9c3b', c2: '#4b6420', fangs: true });
  defCre('hobgoblin', { plan: ['humanoid', 2], ears: 'long', c: '#b0623a', c2: '#6d3820' });
  defCre('kobold', { plan: ['humanoid', 2], size: 'small', head: 'reptile', covering: 'scales', tail: 'thin', c: '#b0563a', c2: '#6b2f1c' });
  defCre('troll', { plan: ['humanoid', 3], size: 'large', build: 'heavy', tusks: true, ears: 'long', c: '#6c8c5c', c2: '#3e5634', hair: 'mohawk' });
  defCre('ogre', { plan: ['giant', 3], size: 'large', build: 'heavy', tusks: true, c: '#a08a5a', c2: '#64532f' });
  defCre('giant titan colossus goliath jotun behemoth', { plan: ['giant', 3], size: 'huge', build: 'heavy', skin: 'human' });
  defCre('cyclops', { plan: ['giant', 3], size: 'huge', build: 'heavy', eyeStyle: 'cyclops', eyes: 1, skin: 'human' });
  defCre('tiefling', { plan: ['humanoid', 2], horns: 'curved', tail: 'thin', c: '#a3404e', c2: '#622030' });
  defCre('demon devil fiend daemon infernal hellspawn balor', { plan: ['humanoid', 3], size: 'large', horns: 'ram', wings: 'bat', tail: 'thin', c: '#a3262a', c2: '#5e1216', eye: '#ffe14a', eyeGlow: true, fangs: true, el: 'fire', aura: 0.3 });
  defCre('imp', { plan: ['humanoid', 3], size: 'tiny', horns: 'nubs', wings: 'bat', tail: 'thin', c: '#c0402a', c2: '#6e1e12', eye: '#ffe14a', eyeGlow: true });
  defCre('angel seraph seraphim archon cherub aasimar', { plan: ['humanoid', 2], wings: 'feather', halo: true, skin: 'fair', el: 'holy', aura: 0.35 });
  defCre('god goddess deity avatar demigod immortal', { plan: ['humanoid', 2], skin: 'fair', aura: 0.6, halo: true, size: 'large' });
  defCre('vampire vampiric nosferatu', { plan: ['humanoid', 2], c: '#ddd3dc', c2: '#a79aa6', eye: '#ff2a3a', eyeGlow: true, fangs: true, cape: true, hairC: '#1b1420' });
  defCre('zombie ghoul corpse rotting draugr wight revenant undead risen', { plan: ['humanoid', 3], c: '#7f8f6a', c2: '#4d5a3e', eye: '#c8ff7a', eyeGlow: true, tattered: true, outfitHint: 'rags', mark: 'cracks' });
  defCre('skeleton skeletal bones boneborn', { plan: ['skeletal', 5], covering: 'bone', head: 'skull', c: '#e2dbc3', c2: '#a69d82', eye: '#ff4a3a', eyeGlow: true });
  defCre('lich dracolich', { plan: ['skeletal', 6], covering: 'bone', head: 'skull', c: '#d8d0b4', c2: '#968d70', eye: '#5affc8', eyeGlow: true, outfitHint: 'robe', helmHint: 'crown', aura: 0.45, el: 'shadow' });
  defCre('mummy', { plan: ['humanoid', 3], c: '#d6c8a0', c2: '#9a8a62', mark: 'stripes', eye: '#7affd2', eyeGlow: true, tattered: true });
  defCre('wraith ghost specter spectre phantom spirit banshee wisp apparition haunt poltergeist geist phantasm spectral ghostly shade', { plan: ['spectral', 5], translucency: 0.42, tattered: true, floating: true, eye: '#9ff3ff', eyeGlow: true, c: '#b9c6d8', c2: '#7584a0' });
  defCre('dragon wyrm wyvern draconic', { plan: ['draconic', 5], hy: true, wings: 'bat', horns: 'long', tail: 'scaled', covering: 'scales', head: 'reptile', size: 'huge', eye: '#ffd23a', eyeGlow: true, c: '#4f8a3a', c2: '#2b521d' });
  defCre('drake dracon', { plan: ['draconic', 4], hy: true, wings: 'bat', horns: 'curved', tail: 'scaled', covering: 'scales', head: 'reptile', size: 'large', eye: '#ffb02a', c: '#7a5a3a', c2: '#4a3420' });
  defCre('dragonborn dragonkin drakekin', { plan: ['humanoid', 3], horns: 'long', tail: 'scaled', covering: 'scales', head: 'reptile', c: '#8a3a2a', c2: '#52201a' });
  defCre('lizard lizardfolk saurian reptil croc gator salamander', { plan: ['humanoid', 2], head: 'reptile', covering: 'scales', tail: 'thick', c: '#5a8a4a', c2: '#34562a' });
  defCre('serpent snake viper cobra asp basilisk', { plan: ['serpent', 5], hy: true, head: 'reptile', covering: 'scales', c: '#5f8f3a', c2: '#35561d', eye: '#ffd23a' });
  defCre('naga lamia yuan', { plan: ['serpent', 5], nagaTorso: true, covering: 'scales', c: '#4f8a6a', c2: '#2a503c' });
  defCre('medusa gorgon', { plan: ['humanoid', 3], hair: 'snakes', c: '#7a9a6a', c2: '#4a6040', eye: '#ffde3a', eyeGlow: true });
  defCre('wolf hound dog jackal hyena fox coyote warg worg', { plan: ['beast', 4], hy: true, head: 'beast', ears: 'animal', covering: 'fur', tail: 'thick', c: '#6e6458', c2: '#423b33', eye: '#ffcf3a' });
  defCre('werewolf lycan lycanthrope werebeast wolfman', { plan: ['humanoid', 4], head: 'beast', ears: 'animal', covering: 'fur', tail: 'thick', size: 'large', build: 'heavy', claws: true, c: '#6a5a4a', c2: '#3e342a', eye: '#ffcf3a', eyeGlow: true, mane: true });
  defCre('bear ursine owlbear', { plan: ['beast', 4], hy: true, head: 'beast', ears: 'animal', covering: 'fur', build: 'heavy', size: 'large', c: '#6b4a2e', c2: '#3f2a18' });
  defCre('lion tiger panther leopard feline lynx sabretooth sabertooth jaguar', { plan: ['beast', 4], hy: true, head: 'beast', ears: 'animal', covering: 'fur', tail: 'thin', c: '#c08a3a', c2: '#7a5420', mark: 'stripes' });
  defCre('manticore chimera', { plan: ['beast', 4], head: 'beast', mane: true, wings: 'bat', tail: 'stinger', covering: 'fur', size: 'large', c: '#b06a3a', c2: '#6a3a1c' });
  defCre('boar swine bull bison', { plan: ['beast', 4], hy: true, head: 'beast', horns: 'curved', tusks: true, covering: 'fur', build: 'heavy', c: '#6a4a3a', c2: '#3a2820' });
  defCre('minotaur', { plan: ['humanoid', 3], head: 'beast', horns: 'curved', size: 'large', build: 'heavy', covering: 'fur', c: '#6a4430', c2: '#3c2418' });
  defCre('rat rodent vermin ratkin', { plan: ['beast', 4], hy: true, head: 'beast', ears: 'animal', tail: 'thin', size: 'small', covering: 'fur', c: '#7a6a5a', c2: '#4a3e34' });
  defCre('spider arachnid arachne broodmother tarantula widow', { plan: ['spider', 6], hy: true, covering: 'chitin', eyes: 8, eyeStyle: 'compound', c: '#3a2e2e', c2: '#1d1616', eye: '#ff2a2a', eyeGlow: true, mark: 'spots' });
  defCre('scorpion', { plan: ['spider', 6], covering: 'chitin', tail: 'stinger', eyes: 4, c: '#8a5a2a', c2: '#4e3014' });
  defCre('insect insectoid mantis beetle wasp hornet hive locust roach moth termite chitin carapace swarm', { plan: ['insectoid', 5], hy: true, covering: 'chitin', head: 'insect', extraArms: 1, eyeStyle: 'compound', c: '#5a7a3a', c2: '#33461e' });
  defCre('ooze slime jelly pudding blob gel sludge muck goo protoplasm amoeba gelatinous', { plan: ['ooze', 6], covering: 'slime', translucency: 0.3, c: '#5fcf6a', c2: '#2f7f3a', eye: '#ffffff' });
  defCre('elemental elementalkin', { plan: ['elemental', 6], floating: false });
  defCre('golem construct automaton clockwork colossus', { plan: ['giant', 4], covering: 'stone', head: 'eyeless', build: 'heavy', size: 'large', eye: '#ffb03a', eyeGlow: true, mark: 'cracks', c: '#8b847a', c2: '#55504a' });
  defCre('treant ent dryad myconid fungal shroom plant thornling', { plan: ['humanoid', 3], covering: 'bark', mark: 'cracks', c: '#6a5236', c2: '#3c2d1c', hairC: '#4f8a3a', hair: 'long' });
  defCre('gargoyle', { plan: ['humanoid', 3], covering: 'stone', wings: 'bat', horns: 'curved', tail: 'thin', c: '#7d7a76', c2: '#4b4946' });
  defCre('harpy avian bird raven crow owl hawk eagle griffon gryphon aarakocra kenku tengu', { plan: ['humanoid', 3], head: 'bird', wings: 'feather', covering: 'feathers', c: '#5a4a6a', c2: '#33283f' });
  defCre('phoenix', { plan: ['humanoid', 3], head: 'bird', wings: 'flame', covering: 'feathers', el: 'fire', c: '#ff8a2a', c2: '#c2401a', aura: 0.4 });
  defCre('kraken squid octo tentacle aberration horror mindflayer illithid cthonian', { plan: ['humanoid', 3], tentacles: 4, eyes: 2, eyeStyle: 'slit', c: '#7a5a8a', c2: '#46304f', eye: '#d0ff5a', eyeGlow: true });
  defCre('beholder gazer watcher eyeball', { plan: ['ooze', 6], eyeStyle: 'cyclops', eyes: 1, tentacles: 6, floating: true, c: '#8a4a6a', c2: '#4e2a3c' });
  defCre('djinn genie efreet ifrit marid', { plan: ['spectral', 4], floating: true, translucency: 0.08, c: '#4a7ad0', c2: '#2a4680', aura: 0.3 });
  defCre('fairy fae faerie pixie sprite sylph', { plan: ['humanoid', 2], size: 'tiny', wings: 'insect', ears: 'pointed', aura: 0.3 });
  defCre('nymph siren mermaid merfolk triton', { plan: ['humanoid', 2], ears: 'fin', c: '#7ab8c8', c2: '#4a7a8a', hair: 'flowing' });
  defCre('satyr faun', { plan: ['humanoid', 2], horns: 'curved', ears: 'animal', skin: 'human' });
  defCre('yeti sasquatch ape gorilla', { plan: ['humanoid', 3], head: 'beast', covering: 'fur', build: 'heavy', size: 'large', c: '#d8dce4', c2: '#9aa0ac' });
  defCre('thorn briar bramble thistle', { plan: ['humanoid', 2], covering: 'bark', spikes: true, c: '#5d6b36', c2: '#353f1c', hairC: '#3f7a2e', hair: 'long', eye: '#c8ff6a', eyeGlow: true });
  defCre('quill spine spike barb', { plan: ['humanoid', 1], spikes: true });
  defCre('maw fang tusk', { plan: ['humanoid', 1], fangs: true });
  defCre('mire bog swamp marsh fen lurk lurker', { plan: ['humanoid', 2], c: '#5a6a4a', c2: '#34402a', covering: 'scales', mark: 'spots' });
  defCre('hollow husk', { plan: ['humanoid', 1], eyeStyle: 'hollow', eyeGlow: true });
  defCre('wraithkin', { plan: ['spectral', 5], translucency: 0.35, tattered: true, floating: true });
  const HYBRID_SUFFIX = /(kin|born|spawn|blood|folk|touched|kith|kind|ling|man|men|blooded|scion|get|child|sworn)$/;
  const SMALL_SUFFIX = /(ling|let)$/;

  // Class words -> outfit / colours / props.
  const CLS = {};
  function defCls(keys, def) { keys.split(' ').forEach((k) => { CLS[k] = def; }); }
  defCls('seer oracle prophet augur visionary diviner mystic oathseer soothsayer', { style: 'robe', hood: true, symbol: 'eye', handGlow: true, prio: 3 });
  defCls('mage wizard sorcerer sorceress sorcer magus arcanist enchanter conjurer illusionist evoker archmage magician', { style: 'robe', symbol: 'star', handGlow: true, prio: 3 });
  defCls('warlock witch hexer hexblade binder veilbinder voidbinder cultist occultist', { style: 'robe', hood: true, symbol: 'rune', handGlow: true, prio: 3 });
  defCls('necromancer necro deathcaller gravecaller bonecaller deathspeaker', { style: 'robe', hood: true, symbol: 'skull', handGlow: true, glow: '#7dffb0', prio: 3 });
  defCls('shaman druid witchdoctor totem geomancer', { style: 'furs', symbol: 'moon', handGlow: true, prio: 2 });
  defCls('priest priestess chaplain acolyte friar bishop', { style: 'robe', symbol: 'holy', prio: 3 });
  defCls('cleric', { style: 'tabard', symbol: 'holy', helm: 'none', prio: 3 });
  defCls('paladin crusader templar inquisitor', { style: 'plate', symbol: 'sun', cape: true, helm: 'open', prio: 4 });
  defCls('knight cavalier champion warlord sentinel guardian warden defender vanguard legionnaire centurion', { style: 'plate', helm: 'closed', cape: true, prio: 4 });
  defCls('warrior fighter soldier mercenary gladiator brute sellsword guard', { style: 'mail', helm: 'open', prio: 2 });
  defCls('duelist swashbuckler fencer', { style: 'leather', cape: true, prio: 2 });
  defCls('barbarian berserker marauder raider savage ravager', { style: 'furs', helm: 'none', prio: 3 });
  defCls('reaver slayer executioner headsman butcher', { style: 'leather', hood: true, prio: 2 });
  defCls('rogue thief burglar cutpurse bandit scoundrel smuggler', { style: 'leather', hood: true, prio: 3 });
  defCls('assassin stalker shadowblade nightblade cutthroat ninja infiltrator killer', { style: 'leather', hood: true, helm: 'cowl', dark: true, prio: 4 });
  defCls('ranger hunter archer scout tracker trapper strider marksman bowman', { style: 'leather', hood: true, cape: true, green: true, prio: 3 });
  defCls('bard minstrel skald troubadour jester', { style: 'leather', cape: true, bright: true, prio: 2 });
  defCls('monk ascetic mendicant disciple', { style: 'gi', prio: 3 });
  defCls('alchemist artificer tinker engineer inventor', { style: 'leather', prio: 2 });
  defCls('king queen emperor empress monarch prince princess noble regent sovereign suzerain lord lady', { style: 'tabard', helm: 'crown', cape: true, prio: 3 });
  defCls('goddess god deity', { style: 'dress', aura: 0.5, prio: 1 });
  defCls('summoner caller channeler medium weaver scribe sage scholar loremaster', { style: 'robe', handGlow: true, prio: 2 });
  defCls('pirate corsair buccaneer', { style: 'leather', prio: 2 });
  defCls('dancer courtesan', { style: 'dress', prio: 2 });

  const ITEM_WORDS = [
    ['greatsword', /(greatsword|claymore|zweihander|great ?blade|warblade)/],
    ['scimitar', /(scimitar|sabre|saber|cutlass|falchion|khopesh|katana|tulwar|reaver)/],
    ['sword', /(sword|blade|brand|rapier|longsword|edge|glaive?blade)/],
    ['axe', /(axe|hatchet|cleaver|bardiche)/],
    ['scythe', /(scythe|reaper)/],
    ['sickle', /(sickle)/],
    ['staff', /(staff|stave|rod|sceptre|scepter|crook|crozier)/],
    ['wand', /(wand|baton)/],
    ['crossbow', /(crossbow|arbalest)/],
    ['bow', /(bow)/],
    ['dagger', /(dagger|knife|dirk|stiletto|kris|shiv|fang|athame|kukri)/],
    ['hammer', /(hammer|maul)/],
    ['flail', /(flail|morningstar|chain)/],
    ['mace', /(mace|club|cudgel|scourge)/],
    ['trident', /(trident)/],
    ['spear', /(spear|lance|pike|halberd|glaive|javelin|polearm|partisan)/],
    ['whip', /(whip|lash)/],
    ['claws', /(claw|talon|gauntlet)/],
    ['shield', /(shield|aegis|buckler|bulwark|pavise)/],
    ['crown', /(crown|circlet|diadem|tiara)/],
    ['amulet', /(amulet|pendant|necklace|talisman|medallion|locket|charm|torc|phylactery|sigil|brooch)/],
    ['tome', /(tome|book|grimoire|codex|scroll|libram|manuscript)/],
    ['lantern', /(lantern|lamp|candle|torch)/],
    ['ring', /(ring|band)/],
    ['skull', /(skull)/],
    ['horn', /(horn)/],
    ['banner', /(banner|standard|flag)/],
    ['crystal', /(crystal|shard|gem|prism|geode)/],
    ['orb', /(orb|sphere|globe|eye|ember|heart|core|pearl|stone|egg|idol|relic|seed|focus)/]
  ];
  function itemTypeFromName(name, slot) {
    const n = String(name || '').toLowerCase();
    if (!n) return '';
    if (slot === 'shield') return 'shield';
    for (const [type, re] of ITEM_WORDS) {
      if (re.test(n)) {
        if (slot === 'weapon' && type === 'orb') continue;
        return type;
      }
    }
    if (slot === 'weapon') return 'sword';
    if (slot === 'other') return 'orb';
    return '';
  }
  // Word-part matching. Short keys only match whole words; others match anywhere in compounds.
  function splitWords(text) {
    return String(text || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/[\s'-]+/).filter(Boolean);
  }
  const STOP_FRAGMENTS = { ant: 1, cat: 1, bat: 1, ape: 1, ox: 1, rat: 1, orc: 1, elf: 1, imp: 1, eye: 1, ent: 1, man: 1, god: 1, ice: 1, red: 1, sun: 1, ash: 1, ork: 1, fae: 1, dog: 1, fox: 1, owl: 1, sea: 1, fog: 1, gel: 1, goo: 1, ink: 1, war: 1, fly: 1, bug: 1, ent2: 1 };
  function matchTable(word, table) {
    const keys = Object.keys(table).sort((a, b) => b.length - a.length);
    const hits = [];
    let remaining = word;
    for (const k of keys) {
      if (k.length <= 3 || STOP_FRAGMENTS[k]) {
        if (word === k || word === k + 's') hits.push(k);
        continue;
      }
      const idx = remaining.indexOf(k);
      if (idx >= 0) {
        hits.push(k);
        remaining = remaining.slice(0, idx) + '#'.repeat(k.length) + remaining.slice(idx + k.length);
      }
    }
    // also allow short keys as compound prefix/suffix (e.g. "orcblood", "ratkin", "elfborn")
    for (const k of keys) {
      if (!(k.length <= 3 || STOP_FRAGMENTS[k]) || hits.indexOf(k) >= 0) continue;
      const rest = word.slice(k.length);
      if (word.startsWith(k) && (HYBRID_SUFFIX.test(rest) || keys.some((k2) => k2.length > 3 && rest.startsWith(k2)))) hits.push(k);
    }
    return hits;
  }

  // ---------------------------------------------------------------- trait derivation (offline fallback)
  const HUMAN_SKINS = ['#f2d0b0', '#e8b896', '#d69e78', '#c08660', '#a06a48', '#7e4e32', '#5e3a26', '#f5dcc8'];
  const FAIR_SKINS = ['#f7e2d0', '#f2d6c0', '#ecd0c4', '#f8e8dc'];
  const HAIR_COLORS = ['#1c1418', '#3a2618', '#5a3a1e', '#8a4a22', '#b07a3a', '#d8b860', '#e8e4d8', '#9aa0aa', '#6a1c1c', '#2a2440'];
  const ROBE_COLORS = ['#3d2a6a', '#1f2f5e', '#6a1f2a', '#232030', '#1f4f52', '#6a4a1f', '#4a1f4f', '#2f3f2a'];
  const LEATHER_COLORS = ['#6a4a2e', '#5a3c26', '#4a3a2e', '#7a5634', '#3e3428'];
  const TABARD_COLORS = ['#e8e4d8', '#2f4f9a', '#9a2a2a', '#2a6a3a', '#5a2a7a'];
  const DRESS_COLORS = ['#26202e', '#5a1f3a', '#3a2a6a', '#7a1f1f', '#1f3f4f'];

  function normalizeSheet(sheet) {
    const s = sheet || {};
    const eq = s.equipped || s.Equipped || {};
    const equipped = typeof eq === 'string' ? parseEquippedLine(eq) : {
      weapon: cleanItemName(eq.weapon || eq.Weapon), armor: cleanItemName(eq.armor || eq.Armor),
      shield: cleanItemName(eq.shield || eq.Shield), other: cleanItemName(eq.other || eq.Other)
    };
    const name = String(s.name || s.Name || 'Unknown').trim();
    const isMonster = !!(s.isMonster || s.type === 'monster' || s.role === 'monster');
    return {
      name,
      sex: String(s.sex || s.Sex || '').trim(),
      race: String(s.race || s.Race || '').trim(),
      class: String(s.class || s.Class || '').trim(),
      level: Math.max(1, Math.min(99, parseInt(s.level || s.Level, 10) || 1)),
      hp: parseInt(s.hp || s.HP, 10) || 0,
      maxHp: parseInt(s.maxHp || s.MaxHP, 10) || 0,
      equipped,
      isMonster,
      role: s.role || (isMonster ? 'monster' : (s.type === 'pc' ? 'pc' : 'npc')),
      itemTypes: s.itemTypes || null
    };
  }
  function sexCue(sex) {
    const v = String(sex || '').toLowerCase();
    if (/^(f|female|woman|girl|she)/.test(v)) return 'female';
    if (/^(m|male|man|boy|he)/.test(v)) return 'male';
    return 'neutral';
  }
  function baseTraits() {
    return {
      v: 1, bodyPlan: 'humanoid', size: 'medium', build: 'average', covering: 'skin', head: 'human',
      horns: 'none', wings: 'none', tail: 'none', ears: 'human', hair: 'short',
      eyes: { count: 2, style: 'normal', glow: false },
      extraArms: 0, tentacles: 0, spikes: false, mane: false, beard: false, tusks: false, fangs: false, claws: false,
      translucency: 0, tattered: false, floating: false, halo: false, nagaTorso: false,
      markings: 'none', element: 'none',
      palette: { skin: '#d69e78', skin2: '#a87454', hair: '#3a2618', outfit: '#5a4a3a', outfit2: '#3a2e24', trim: '#c9a64a', metal: '#9aa3ad', eye: '#2a1c14', glow: '#ffe8a0', aura: '#ffe8a0' },
      outfit: { style: 'leather', hood: false, cape: false, helm: 'none', symbol: 'none' },
      items: [],
      aura: { color: '#ffe8a0', strength: 0 },
      handGlow: false
    };
  }
  function matColor(mats, key, fallback) {
    for (const m of mats) if (m && m[key]) return m[key];
    return fallback;
  }
  function deriveFallbackTraits(sheetIn) {
    const sheet = normalizeSheet(sheetIn);
    const raceKey = sheet.race.toLowerCase();
    const rng = makeRng(hashString('traits|' + raceKey + '|' + sheet.class.toLowerCase() + '|' + sheet.name.toLowerCase()));
    const raceRng = makeRng(hashString('race|' + raceKey));
    const t = baseTraits();
    const sex = sexCue(sheet.sex);
    const raceWords = splitWords(sheet.race);
    const classWords = splitWords(sheet.class);
    let planPrio = -1;
    let creatureHits = 0;
    let primaryWord = null, primaryMat = null;
    let creatureColor = null, creatureColor2 = null, hairC = null, skinKind = null, outfitHint = null, helmHint = null, capeHint = false;
    const raceMats = [];
    const sizeVotes = [];
    for (const word of raceWords) {
      const creHits = matchTable(word, CRE);
      const hybrid = creHits.length > 0 && !CRE[word] && HYBRID_SUFFIX.test(word);
      for (const k of creHits) {
        const d = CRE[k];
        creatureHits++;
        let plan = d.plan[0];
        if (hybrid && d.hy) plan = 'humanoid';
        if (d.plan[1] > planPrio || (d.plan[1] === planPrio && plan !== 'humanoid')) { t.bodyPlan = plan; planPrio = d.plan[1]; if (d.c) { primaryWord = word; creatureColor = d.c; creatureColor2 = d.c2; } }
        if (d.horns) t.horns = d.horns;
        if (d.wings) t.wings = d.wings;
        if (d.tail) t.tail = d.tail;
        if (d.ears) t.ears = d.ears;
        if (d.hair) t.hair = d.hair;
        if (d.head && !(hybrid && d.hy)) t.head = d.head;
        if (d.head === 'reptile' && hybrid) t.eyes.style = 'slit';
        if (d.covering) t.covering = (hybrid && d.hy && d.covering === 'scales') ? t.covering : d.covering;
        if (d.covering === 'scales') t.markings = 'scales';
        if (d.size) sizeVotes.push(hybrid && d.size === 'huge' ? 'medium' : (hybrid && d.size === 'large' ? 'medium' : d.size));
        if (d.build) t.build = d.build;
        ['beard', 'tusks', 'fangs', 'claws', 'mane', 'halo', 'tattered', 'floating', 'nagaTorso'].forEach((f) => { if (d[f]) t[f] = true; });
        if (d.translucency) t.translucency = Math.max(t.translucency, d.translucency);
        if (d.extraArms) t.extraArms = Math.max(t.extraArms, d.extraArms);
        if (d.tentacles) t.tentacles = Math.max(t.tentacles, d.tentacles);
        if (d.eyes) t.eyes.count = d.eyes;
        if (d.eyeStyle) t.eyes.style = d.eyeStyle;
        if (d.eye) t.palette.eye = d.eye;
        if (d.eyeGlow) t.eyes.glow = true;
        if (d.mark) t.markings = d.mark;
        if (d.el) t.element = d.el;
        if (d.aura) t.aura.strength = Math.max(t.aura.strength, d.aura);
        if (d.c) { creatureColor = creatureColor || d.c; creatureColor2 = creatureColor2 || d.c2; }
        if (d.skin) skinKind = skinKind || d.skin;
        if (d.hairC) hairC = d.hairC;
        if (d.outfitHint) outfitHint = d.outfitHint;
        if (d.helmHint) helmHint = d.helmHint;
        if (d.cape) capeHint = true;
      }
      if (SMALL_SUFFIX.test(word) && creHits.length) sizeVotes.push('small');
      for (const k of matchTable(word, MAT)) { raceMats.push(MAT[k]); if (word === primaryWord && !primaryMat) primaryMat = MAT[k]; }
    }
    if (primaryWord && !primaryMat) { for (const k of matchTable(primaryWord, MAT)) { primaryMat = MAT[k]; break; } }
    // Unknown race words: seeded but coherent defaults.
    if (!creatureHits) {
      if (sheet.isMonster) {
        const roll = raceRng();
        const table = [['humanoid', 0.34], ['beast', 0.12], ['spectral', 0.1], ['insectoid', 0.08], ['elemental', 0.07], ['skeletal', 0.07], ['serpent', 0.06], ['ooze', 0.06], ['draconic', 0.05], ['spider', 0.05]];
        let acc = 0;
        for (const [plan, w] of table) { acc += w; if (roll <= acc) { t.bodyPlan = plan; break; } }
        if (t.bodyPlan === 'beast') { t.head = 'beast'; t.ears = 'animal'; t.covering = 'fur'; t.tail = 'thick'; }
        if (t.bodyPlan === 'spectral') { t.translucency = 0.38; t.tattered = true; t.floating = true; t.eyes.glow = true; }
        if (t.bodyPlan === 'skeletal') { t.covering = 'bone'; t.head = 'skull'; t.eyes.glow = true; }
        if (t.bodyPlan === 'insectoid') { t.covering = 'chitin'; t.head = 'insect'; t.extraArms = 1; }
        if (t.bodyPlan === 'serpent') { t.covering = 'scales'; t.head = 'reptile'; t.nagaTorso = raceRng.chance(0.5); }
        if (t.bodyPlan === 'ooze') { t.covering = 'slime'; t.translucency = 0.3; }
        if (t.bodyPlan === 'draconic') { t.wings = 'bat'; t.horns = 'long'; t.tail = 'scaled'; t.covering = 'scales'; t.head = 'reptile'; sizeVotes.push('large'); }
        if (t.bodyPlan === 'spider') { t.covering = 'chitin'; t.eyes.count = 8; t.eyes.glow = true; }
        if (t.bodyPlan === 'humanoid') {
          if (raceRng.chance(0.45)) t.horns = raceRng.pick(['nubs', 'curved', 'ram', 'long', 'antlers']);
          if (raceRng.chance(0.3)) t.tail = raceRng.pick(['thin', 'thick', 'scaled']);
          if (raceRng.chance(0.18)) t.wings = raceRng.pick(['bat', 'feather', 'bone']);
          if (raceRng.chance(0.35)) t.ears = raceRng.pick(['pointed', 'long', 'fin']);
          if (raceRng.chance(0.25)) t.covering = raceRng.pick(['scales', 'fur', 'stone', 'bark', 'chitin']);
          if (raceRng.chance(0.3)) t.head = raceRng.pick(['beast', 'reptile', 'demon']);
        }
        t.eyes.glow = t.eyes.glow || raceRng.chance(0.55);
        if (raceRng.chance(0.4)) t.markings = raceRng.pick(['stripes', 'spots', 'runes', 'veins', 'cracks']);
        sizeVotes.push(raceRng.pick(['small', 'medium', 'medium', 'large']));
      } else {
        skinKind = 'human';
        if (raceRng.chance(0.25)) t.ears = 'pointed';
        if (raceRng.chance(0.12)) t.horns = 'nubs';
      }
    }
    if (t.bodyPlan === 'skeletal') { t.head = 'skull'; t.covering = 'bone'; t.hair = 'none'; }
    if (t.bodyPlan === 'elemental' && t.element === 'none') {
      const el = matColor(raceMats, 'el', null) || raceRng.pick(['fire', 'frost', 'storm', 'earth', 'water', 'shadow']);
      t.element = el;
    }
    if (t.bodyPlan === 'elemental') t.covering = { fire: 'flame', frost: 'crystal', storm: 'mist', earth: 'stone', water: 'water', shadow: 'shadow', void: 'shadow', sand: 'stone', poison: 'slime' }[t.element] || 'mist';
    if (sizeVotes.length) {
      const order = Object.keys(SIZES);
      t.size = sizeVotes.reduce((best, v) => (order.indexOf(v) > order.indexOf(best) ? v : best), sizeVotes[0]);
      if (sizeVotes.includes('tiny')) t.size = 'tiny';
    }
    if (raceMats.length) {
      const el = matColor(raceMats, 'el', null);
      if (el && t.element === 'none') t.element = el;
      const mk = matColor(raceMats, 'mark', null);
      if (mk) t.markings = mk;
    }
    // Skin / covering colours.
    let skin, skin2;
    if (creatureColor && t.bodyPlan !== 'skeletal') {
      const m = primaryMat || (raceWords.find((w) => MAT[w]) ? MAT[raceWords.find((w) => MAT[w])] : null) || raceMats[0] || null;
      const adjective = raceWords.find((w) => MAT[w]);
      const wgt = primaryMat ? 0.65 : (adjective ? 0.85 : 0.35);
      skin = m ? rgbToHex(mix(hexToRgb(creatureColor), hexToRgb(m.c), wgt)) : creatureColor;
      skin2 = m ? rgbToHex(mix(hexToRgb(creatureColor2 || creatureColor), hexToRgb(m.c2 || m.c), wgt)) : creatureColor2;
    }
    else if (raceMats.length && t.bodyPlan !== 'skeletal') { skin = raceMats[0].c; skin2 = raceMats[0].c2; }
    else if (creatureColor) { skin = creatureColor; skin2 = creatureColor2; }
    else if (skinKind === 'fair') { skin = rng.pick(FAIR_SKINS); }
    else if (skinKind === 'human') { skin = rng.pick(HUMAN_SKINS); }
    else { skin = rgbToHex(hslToRgb(raceRng() * 360, 0.25 + raceRng() * 0.35, 0.36 + raceRng() * 0.22)); }
    if (t.bodyPlan === 'skeletal' && raceMats.length) skin = rgbToHex(mix(hexToRgb('#e2dbc3'), hexToRgb(raceMats[0].c), 0.35));
    if (!skin2) skin2 = rgbToHex(rampDark(hexToRgb(skin), 0.3));
    t.palette.skin = skin;
    t.palette.skin2 = skin2;
    t.palette.hair = hairC || (t.covering === 'fur' ? rgbToHex(darken(hexToRgb(skin), 0.25)) : rng.pick(HAIR_COLORS));
    const glowMat = matColor(raceMats, 'glow', null);
    if (glowMat) { t.palette.glow = glowMat; if (t.eyes.glow) t.palette.eye = glowMat; }
    if (raceMats.length > 1 && raceMats[1].glow) t.palette.glow = raceMats[1].glow;
    if (t.eyes.glow && t.palette.eye === '#2a1c14') t.palette.eye = t.palette.glow;
    if (t.element === 'holy') t.halo = t.halo || false;
    // Hair defaults by sex/plan.
    if (t.bodyPlan === 'humanoid' || t.bodyPlan === 'giant' || t.bodyPlan === 'spectral' || (t.bodyPlan === 'serpent' && t.nagaTorso)) {
      if (t.hair === 'short' && !CRE_HAIR_SET(raceWords)) {
        if (sex === 'female') t.hair = rng.pick(['long', 'long', 'flowing', 'braid', 'topknot']);
        else t.hair = rng.pick(['short', 'short', 'none', 'long', 'mohawk', 'topknot']);
      }
      if (t.head === 'beast' || t.head === 'bird' || t.head === 'insect' || t.head === 'reptile' || t.head === 'skull' || t.head === 'eyeless') t.hair = t.mane ? 'long' : 'none';
      if (t.beard && sex === 'female') t.beard = false;
      if (!t.beard && sex === 'male' && t.head === 'human' && rng.chance(0.18)) t.beard = true;
    } else {
      t.hair = 'none';
    }
    // Outfit from class.
    let clsPrio = -1;
    const classMats = [];
    let clsFlags = {};
    for (const word of classWords) {
      for (const k of matchTable(word, CLS)) {
        const d = CLS[k];
        if (d.prio > clsPrio) { clsPrio = d.prio; t.outfit.style = d.style; if (d.helm) t.outfit.helm = d.helm; }
        if (d.hood) t.outfit.hood = true;
        if (d.cape) t.outfit.cape = true;
        if (d.symbol) t.outfit.symbol = d.symbol;
        if (d.handGlow) t.handGlow = true;
        if (d.helm === 'crown') t.outfit.helm = 'crown';
        if (d.aura) t.aura.strength = Math.max(t.aura.strength, d.aura);
        if (d.glow) t.palette.glow = d.glow;
        clsFlags = Object.assign(clsFlags, d);
      }
      for (const k of matchTable(word, MAT)) classMats.push(MAT[k]);
      for (const k of matchTable(word, CRE)) {
        const d = CRE[k];
        if (d.wings && t.wings === 'none' && k !== 'god' && k !== 'goddess') t.wings = d.wings;
      }
    }
    if (clsPrio < 0) {
      if (sheet.isMonster && t.bodyPlan !== 'humanoid' && t.bodyPlan !== 'giant') t.outfit.style = 'none';
      else t.outfit.style = rng.pick(sheet.isMonster ? ['rags', 'leather', 'robe', 'none', 'furs', 'mail'] : ['leather', 'robe', 'mail', 'tabard']);
      if (rng.chance(0.3)) t.outfit.hood = true;
      if (rng.chance(0.35)) t.handGlow = true;
    }
    if (t.bodyPlan === 'spectral' && (clsPrio < 0 || !['robe', 'rags', 'cloak', 'dress'].includes(t.outfit.style)) && !raceWords.some((w) => /djinn|genie|efreet|ifrit|marid/.test(w))) { t.outfit.style = clsPrio >= 3 && ['plate', 'mail'].includes(t.outfit.style) ? t.outfit.style : 'robe'; if (clsPrio < 0 || rng.chance(0.6)) t.outfit.hood = true; }
    if (outfitHint && (clsPrio < 3 || t.bodyPlan === 'skeletal')) t.outfit.style = outfitHint === 'rags' && clsPrio >= 2 ? t.outfit.style : outfitHint;
    if (helmHint) t.outfit.helm = helmHint;
    if (sheet.isMonster && t.outfit.helm === 'closed' && creatureHits && (t.head !== 'human' || t.covering !== 'skin' || t.horns !== 'none' || primaryWord)) t.outfit.helm = t.horns !== 'none' ? 'none' : 'open';
    if (capeHint) t.outfit.cape = true;
    if (['beast', 'spider', 'ooze', 'draconic', 'elemental'].includes(t.bodyPlan)) { t.outfit.style = 'none'; t.outfit.hood = false; t.outfit.cape = false; t.outfit.helm = 'none'; }
    if (t.bodyPlan === 'serpent' && !t.nagaTorso) { t.outfit.style = 'none'; t.outfit.hood = false; t.outfit.cape = false; t.outfit.helm = 'none'; }
    // Outfit colours.
    const style = t.outfit.style;
    let outfit;
    const accentMat = classMats[0] || raceMats[raceMats.length - 1] || null;
    if ((style === 'robe' || style === 'cloak') && t.bodyPlan === 'spectral' && !classMats.length) outfit = rgbToHex(shiftHue(rampDark(hexToRgb(skin), 0.42), rng.range(-20, 20)));
    else if (style === 'robe' || style === 'cloak') outfit = accentMat ? rgbToHex(darken(hexToRgb(accentMat.c), 0.25)) : rng.pick(ROBE_COLORS);
    else if (style === 'leather') outfit = clsFlags.dark ? '#2a2630' : (clsFlags.green ? rng.pick(['#3f5a2e', '#4a5a34', '#34502e']) : (clsFlags.bright ? rng.pick(['#9a2a5a', '#2a6a9a', '#9a7a2a']) : rng.pick(LEATHER_COLORS)));
    else if (style === 'plate' || style === 'mail') outfit = rng.pick(['#8a1f24', '#1f3a7a', '#2a2a32', '#5a1f6a', '#1f5a3a']);
    else if (style === 'tabard') outfit = sheet.isMonster ? rng.pick(['#3a1f2a', '#2a2a3a', '#5a1f1f', '#2a3a2a']) : rng.pick(TABARD_COLORS);
    else if (style === 'furs') outfit = rng.pick(['#7a5a3a', '#8a7a64', '#5a4430']);
    else if (style === 'gi') outfit = rng.pick(['#d08a2a', '#e8e0cc', '#7a2a2a', '#2a3a5a']);
    else if (style === 'dress') outfit = accentMat ? rgbToHex(darken(hexToRgb(accentMat.c), 0.3)) : rng.pick(DRESS_COLORS);
    else if (style === 'rags') outfit = rng.pick(['#6a6052', '#5a5046', '#4a463e']);
    else outfit = rgbToHex(darken(hexToRgb(skin), 0.3));
    if (accentMat && (style === 'plate' || style === 'mail' || style === 'leather' || style === 'tabard')) outfit = rgbToHex(mix(hexToRgb(outfit), hexToRgb(accentMat.c), 0.5));
    t.palette.outfit = outfit;
    t.palette.outfit2 = rgbToHex(rampDark(hexToRgb(outfit), 0.35));
    t.palette.trim = (classMats[0] && classMats[0].glow) || (accentMat && accentMat.glow) || rng.pick(['#d8b04a', '#c8ccd4', '#b8763a', '#e8e0c8']);
    t.palette.metal = (classMats.find((m) => /e6b53f|ffd254/.test(m.c)) ? '#e6b53f' : rng.pick(['#9aa3ad', '#a8b0b8', '#8a8e96', '#b8bcc4']));
    if (classMats.length && classMats[0].glow) t.palette.glow = classMats[0].glow;
    // Items from equipment.
    const eq = sheet.equipped;
    const slots = [['weapon', eq.weapon], ['shield', eq.shield], ['armor', eq.armor], ['other', eq.other]];
    for (const [slot, name] of slots) {
      if (!name) continue;
      const hinted = sheet.itemTypes && sheet.itemTypes[name.toLowerCase()];
      let type = itemTypeFromName(name, slot);
      if (slot === 'armor') {
        const n = name.toLowerCase();
        if (/(plate|cuirass|breastplate|harness|carapace)/.test(n) && !['robe', 'dress'].includes(t.outfit.style)) t.outfit.style = t.outfit.style === 'none' ? 'plate' : (t.outfit.style === 'leather' || t.outfit.style === 'rags' ? 'plate' : t.outfit.style);
        else if (/(mail|chain|scale|hauberk|brigandine)/.test(n) && ['leather', 'rags', 'none'].includes(t.outfit.style)) t.outfit.style = 'mail';
        else if (/(hide|leather|jerkin|studded|vest)/.test(n) && ['rags', 'none'].includes(t.outfit.style)) t.outfit.style = 'leather';
        else if (/(robe|vestment|garb|gown)/.test(n)) t.outfit.style = 'robe';
        if (/(cloak|mantle|cape|shroud)/.test(n)) t.outfit.cape = true;
        const am = splitWords(name).flatMap((w) => matchTable(w, MAT)).map((k) => MAT[k]);
        if (am.length) { t.palette.outfit = rgbToHex(mix(hexToRgb(t.palette.outfit), hexToRgb(am[0].c), 0.65)); t.palette.outfit2 = rgbToHex(rampDark(hexToRgb(t.palette.outfit), 0.35)); }
        if (/drake|dragon|scale/.test(n)) t.markings = t.markings === 'none' ? 'scales' : t.markings;
        if (type !== 'shield' && type !== 'amulet' && type !== 'crown' && type !== 'ring') continue;
      }
      if (hinted === 'shield') type = 'shield';
      const mats = splitWords(name).flatMap((w) => matchTable(w, MAT)).map((k) => MAT[k]);
      const item = { slot, type, name, color: '', accent: '', glow: false, shape: '' };
      const defaults = { sword: '#c8d0da', greatsword: '#c8d0da', scimitar: '#d0d6de', axe: '#a8aeb6', dagger: '#d0d6de', staff: '#7a5434', wand: '#5a3a24', bow: '#8a5a30', crossbow: '#6a4a2a', mace: '#9aa0a8', hammer: '#8a9098', flail: '#8a9098', spear: '#b8c0c8', trident: '#c8b060', scythe: '#b8c0c8', sickle: '#c0c8d0', whip: '#5a3a24', claws: '#e8e0d0', orb: '#9ad8ff', crystal: '#c8a0ff', amulet: '#e6b53f', crown: '#e6b53f', tome: '#6a2a2a', lantern: '#e6b53f', ring: '#e6b53f', skull: '#e2dbc3', horn: '#d8c8a0', banner: '#9a2a2a', shield: '#7a5a3a' };
      item.color = mats[0] ? mats[0].c : (defaults[type] || '#a0a0a0');
      item.accent = mats[1] ? (mats[1].glow || mats[1].c) : (mats[0] && mats[0].glow ? mats[0].glow : t.palette.trim);
      if (mats[0] && mats[0].glassy) item.color = mats[1] ? mats[1].c : item.color;
      item.glow = !!((mats.some((m) => m.glow && m.el) || GLOW_WORDS.test(name)) && (type !== 'shield' || mats.some((m) => m.el)));
      if (type === 'shield') {
        const n = name.toLowerCase();
        item.shape = /tower|bulwark|pavise|wall/.test(n) ? 'tower' : /kite/.test(n) ? 'kite' : /buckler/.test(n) ? 'buckler' : /round|disc|targe/.test(n) ? 'round' : /spik|thorn/.test(n) ? 'spiked' : rng.pick(['heater', 'round', 'kite', 'heater']);
      }
      t.items.push(item);
    }
    if (sheet.isMonster && !t.items.some((i) => i.slot === 'weapon') && ['humanoid', 'giant', 'insectoid'].includes(t.bodyPlan) && (t.head !== 'human' || t.covering !== 'skin')) t.claws = true;
    if (t.handGlow && t.palette.glow === '#ffe8a0' && raceMats.length) t.palette.glow = raceMats[0].glow || t.palette.glow;
    t.aura.color = t.palette.glow;
    t.planConfidence = creatureHits ? Math.max(0, planPrio) : 0;
    return t;
  }
  function CRE_HAIR_SET(words) {
    return words.some((w) => matchTable(w, CRE).some((k) => CRE[k].hair));
  }

  // ---------------------------------------------------------------- validation / normalization (shared with server LLM path)
  const ENUM_SYNONYMS = {
    bodyPlan: { quadruped: 'beast', animal: 'beast', amorphous: 'ooze', slime: 'ooze', blob: 'ooze', undead: 'skeletal', skeleton: 'skeletal', floating: 'spectral', ghost: 'spectral', winged: 'draconic', dragon: 'draconic', insect: 'insectoid', arachnid: 'spider', snake: 'serpent', naga: 'serpent', colossal: 'giant', biped: 'humanoid', human: 'humanoid' },
    size: { gargantuan: 'huge', colossal: 'huge', big: 'large', little: 'small', average: 'medium', normal: 'medium' },
    covering: { hide: 'skin', flesh: 'skin', scale: 'scales', shell: 'chitin', carapace: 'chitin', rock: 'stone', fire: 'flame', smoke: 'mist', fog: 'mist', ice: 'crystal', wood: 'bark', feather: 'feathers', ooze: 'slime' },
    outfit: { robes: 'robe', armor: 'plate', armour: 'plate', chainmail: 'mail', hide: 'leather', cape: 'cloak', tattered: 'rags', fur: 'furs', gown: 'dress' }
  };
  function pickEnum(value, allowed, synonyms, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (value === true) return allowed.includes('small') ? fallback : (allowed[1] || fallback);
    if (value === false) return allowed.includes('none') ? 'none' : fallback;
    const v = String(value).toLowerCase().trim();
    if (allowed.includes(v)) return v;
    if (synonyms && synonyms[v]) return synonyms[v];
    const partial = allowed.find((a) => v.includes(a));
    return partial || fallback;
  }
  function pickHex(value, fallback) {
    const s = String(value || '').trim();
    return /^#?[0-9a-f]{6}$/i.test(s) ? ('#' + s.replace('#', '').toLowerCase()) : (/^#?[0-9a-f]{3}$/i.test(s) ? rgbToHex(hexToRgb(s)) : fallback);
  }
  function pickBool(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'string') return /^(true|yes|1)$/i.test(value.trim()) ? true : (/^(false|no|0|none)$/i.test(value.trim()) ? false : fallback);
    return fallback;
  }
  function pickNum(value, lo, hi, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
  }
  function validateTraitSpec(raw) {
    const problems = [];
    if (!raw || typeof raw !== 'object') return ['not an object'];
    if (!BODY_PLANS.includes(String(raw.bodyPlan || '').toLowerCase()) && !(ENUM_SYNONYMS.bodyPlan[String(raw.bodyPlan || '').toLowerCase()])) problems.push('bodyPlan must be one of ' + BODY_PLANS.join('|'));
    if (!raw.palette || typeof raw.palette !== 'object') problems.push('palette object missing');
    else {
      const bad = PALETTE_KEYS.filter((k) => raw.palette[k] !== undefined && !/^#?[0-9a-f]{6}$/i.test(String(raw.palette[k])));
      if (bad.length) problems.push('palette colours must be #rrggbb: ' + bad.join(','));
      if (!raw.palette.skin) problems.push('palette.skin missing');
    }
    if (raw.size && !SIZES[String(raw.size).toLowerCase()] && !ENUM_SYNONYMS.size[String(raw.size).toLowerCase()]) problems.push('size must be one of ' + Object.keys(SIZES).join('|'));
    if (raw.items && !Array.isArray(raw.items)) problems.push('items must be an array');
    return problems;
  }
  function normalizeTraitSpec(raw, sheet) {
    const base = sheet ? deriveFallbackTraits(sheet) : baseTraits();
    if (!raw || typeof raw !== 'object') return base;
    const t = JSON.parse(JSON.stringify(base));
    t.bodyPlan = pickEnum(raw.bodyPlan, BODY_PLANS, ENUM_SYNONYMS.bodyPlan, base.bodyPlan);
    t.size = pickEnum(raw.size, Object.keys(SIZES), ENUM_SYNONYMS.size, base.size);
    t.build = pickEnum(raw.build, BUILDS, { thin: 'slender', lean: 'slender', bulky: 'heavy', stocky: 'heavy', muscular: 'heavy' }, base.build);
    t.covering = pickEnum(raw.covering || raw.skin, COVERINGS, ENUM_SYNONYMS.covering, base.covering);
    t.head = pickEnum(raw.head, HEADS, { animal: 'beast', wolf: 'beast', dragon: 'reptile', lizard: 'reptile', bone: 'skull', avian: 'bird', faceless: 'eyeless' }, base.head);
    const f = raw.features && typeof raw.features === 'object' && !Array.isArray(raw.features) ? Object.assign({}, raw, raw.features) : raw;
    const flist = Array.isArray(raw.features) ? raw.features.map((x) => String(x).toLowerCase()) : [];
    const has = (w) => flist.some((x) => x.includes(w));
    t.horns = pickEnum(f.horns, HORNS, { yes: 'curved', horn: 'curved', small: 'nubs', spiral: 'ram', antler: 'antlers' }, has('horn') ? 'curved' : base.horns);
    t.wings = pickEnum(f.wings, WINGS, { yes: 'bat', dragon: 'bat', membrane: 'bat', leathery: 'bat', feathered: 'feather', angel: 'feather', bird: 'feather', fly: 'insect', ghost: 'spectral', fire: 'flame' }, has('wing') ? 'bat' : base.wings);
    t.tail = pickEnum(f.tail, TAILS, { yes: 'thin', long: 'thin', reptile: 'scaled', dragon: 'scaled', scorpion: 'stinger', smoke: 'wisp', fire: 'flame' }, has('tail') ? 'thin' : base.tail);
    t.ears = pickEnum(f.ears, EARS, { elf: 'pointed', elven: 'pointed', wolf: 'animal', cat: 'animal', fins: 'fin' }, base.ears);
    t.hair = pickEnum(f.hair, HAIRS, { bald: 'none', mane: 'long', braided: 'braid', ponytail: 'braid', serpents: 'snakes', fire: 'flame' }, base.hair);
    const eyes = f.eyes && typeof f.eyes === 'object' ? f.eyes : { count: f.eyes };
    t.eyes = {
      count: Math.round(pickNum(eyes.count !== undefined ? eyes.count : f.eyeCount, 1, 8, base.eyes.count)),
      style: pickEnum(eyes.style, EYE_STYLES, { reptilian: 'slit', empty: 'hollow', insect: 'compound', single: 'cyclops', glow: 'glowing' }, base.eyes.style),
      glow: pickBool(eyes.glow, base.eyes.glow || has('glow'))
    };
    t.extraArms = Math.round(pickNum(f.extraArms, 0, 2, has('extra arm') || has('four arm') ? 1 : base.extraArms));
    t.tentacles = Math.round(pickNum(f.tentacles, 0, 8, has('tentacle') ? 4 : base.tentacles));
    ['spikes', 'mane', 'beard', 'tusks', 'fangs', 'claws', 'tattered', 'floating', 'halo', 'nagaTorso'].forEach((k) => { t[k] = pickBool(f[k], base[k] || has(k.toLowerCase())); });
    t.translucency = pickNum(f.translucency, 0, 0.7, has('transluc') || has('ghost') ? 0.4 : base.translucency);
    t.markings = pickEnum(f.markings, MARKINGS, { tattoos: 'runes', glyphs: 'runes', scaled: 'scales', striped: 'stripes', spotted: 'spots', cracked: 'cracks' }, base.markings);
    t.element = pickEnum(f.element, ELEMENTS, { flame: 'fire', ice: 'frost', lightning: 'storm', dark: 'shadow', light: 'holy', necrotic: 'shadow', acid: 'poison', nature: 'earth' }, base.element);
    const pal = raw.palette && typeof raw.palette === 'object' ? raw.palette : {};
    PALETTE_KEYS.forEach((k) => { t.palette[k] = pickHex(pal[k], base.palette[k]); });
    if (!pal.skin2 && pal.skin) t.palette.skin2 = rgbToHex(rampDark(hexToRgb(t.palette.skin), 0.3));
    if (!pal.outfit2 && pal.outfit) t.palette.outfit2 = rgbToHex(rampDark(hexToRgb(t.palette.outfit), 0.35));
    const o = raw.outfit && typeof raw.outfit === 'object' ? raw.outfit : { style: raw.outfit };
    t.outfit = {
      style: pickEnum(o.style, OUTFITS, ENUM_SYNONYMS.outfit, base.outfit.style),
      hood: pickBool(o.hood, base.outfit.hood),
      cape: pickBool(o.cape, base.outfit.cape),
      helm: pickEnum(o.helm, HELMS, { helmet: 'open', visor: 'closed', mask: 'cowl', tiara: 'circlet', diadem: 'circlet' }, base.outfit.helm),
      symbol: pickEnum(o.symbol, SYMBOLS, { cross: 'holy', ankh: 'holy', death: 'skull', fire: 'flame', glyph: 'rune' }, base.outfit.symbol)
    };
    if (Array.isArray(raw.items)) {
      const items = [];
      for (const it of raw.items.slice(0, 5)) {
        if (!it || typeof it !== 'object') continue;
        const slot = pickEnum(it.slot, ITEM_SLOTS, { offhand: 'other', hand: 'weapon', accessory: 'other', body: 'armor' }, 'other');
        let type = pickEnum(it.type, ITEM_TYPES, { blade: 'sword', longsword: 'sword', sabre: 'scimitar', saber: 'scimitar', rod: 'staff', sceptre: 'staff', scepter: 'staff', knife: 'dagger', book: 'tome', grimoire: 'tome', necklace: 'amulet', pendant: 'amulet', talisman: 'amulet', circlet: 'crown', sphere: 'orb', gem: 'crystal', lamp: 'lantern', polearm: 'spear', halberd: 'spear' }, '');
        if (!type) type = itemTypeFromName(it.name || it.type, slot);
        if (!type) continue;
        if (slot === 'armor' && !['shield', 'amulet', 'crown', 'ring'].includes(type)) continue;
        const baseItem = base.items.find((b) => b.slot === slot) || {};
        items.push({
          slot, type, name: String(it.name || baseItem.name || type).slice(0, 60),
          color: pickHex(it.color, baseItem.color || '#a0a0a0'),
          accent: pickHex(it.accent, baseItem.accent || t.palette.trim),
          glow: pickBool(it.glow, !!baseItem.glow),
          shape: type === 'shield' ? pickEnum(it.shape, SHIELD_SHAPES, { square: 'tower', oval: 'round', triangle: 'kite' }, baseItem.shape || 'heater') : ''
        });
      }
      // never drop equipment that is on the sheet
      for (const b of base.items) if (!items.some((i) => i.slot === b.slot)) items.push(b);
      t.items = items;
    }
    const aura = raw.aura && typeof raw.aura === 'object' ? raw.aura : { strength: raw.aura };
    t.aura = { color: pickHex(aura.color, t.palette.aura || base.aura.color), strength: pickNum(aura.strength, 0, 1, base.aura.strength) };
    t.handGlow = pickBool(raw.handGlow, base.handGlow);
    // keyword certainties survive an LLM that forgot them (e.g. 'Drakespawn' always has wings/horns/tail)
    if (sheet && base.planConfidence >= 5 && t.bodyPlan === 'humanoid' && base.bodyPlan !== 'humanoid') t.bodyPlan = base.bodyPlan;
    if (sheet && base.planConfidence >= 2) {
      ['horns', 'wings', 'tail'].forEach((k) => { if (t[k] === 'none' && base[k] !== 'none') t[k] = base[k]; });
      t.translucency = Math.max(t.translucency, base.translucency);
    }
    if (t.bodyPlan === 'humanoid' && t.tattered && t.translucency >= 0.3) t.bodyPlan = 'spectral';
    t.planConfidence = base.planConfidence || 0;
    if (t.bodyPlan === 'skeletal') { t.head = 'skull'; t.hair = 'none'; }
    if (t.bodyPlan === 'spectral') t.floating = true;
    return t;
  }

  // Built-in presets: the same fixed hand-authored traits as their 3D world figure (PRESET_TRAITS below).
  const SIGNATURE = {
    mortacia: (t) => Object.assign(t, JSON.parse(JSON.stringify(PRESET_TRAITS.mortacia.traits))),
    suzerain: (t) => Object.assign(t, JSON.parse(JSON.stringify(PRESET_TRAITS.suzerain.traits)))
  };

  // ---------------------------------------------------------------- pixel buffer
  const F_GLOW = 1, F_NOSHADE = 2, F_TRANS = 4, F_NOOUTLINE = 8;
  function Pix(w, h) {
    this.w = w; this.h = h;
    this.c = new Float32Array(w * h * 4);
    this.part = new Uint8Array(w * h);
    this.fl = new Uint8Array(w * h);
  }
  Pix.prototype.alpha = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.c[(y * this.w + x) * 4 + 3];
  };
  Pix.prototype.partAt = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.c[(y * this.w + x) * 4 + 3] > 0 ? this.part[y * this.w + x] : 0;
  };
  Pix.prototype.colorAt = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const o = (y * this.w + x) * 4;
    return [this.c[o], this.c[o + 1], this.c[o + 2]];
  };
  Pix.prototype.put = function (x, y, col, part, fl, alpha) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !col) return;
    const i = y * this.w + x, o = i * 4;
    const a = alpha === undefined || alpha === null ? 1 : alpha;
    if (a <= 0) return;
    if (a >= 1 || this.c[o + 3] <= 0) {
      this.c[o] = col[0]; this.c[o + 1] = col[1]; this.c[o + 2] = col[2]; this.c[o + 3] = a;
    } else {
      const ea = this.c[o + 3];
      const na = a + ea * (1 - a);
      this.c[o] = (col[0] * a + this.c[o] * ea * (1 - a)) / na;
      this.c[o + 1] = (col[1] * a + this.c[o + 1] * ea * (1 - a)) / na;
      this.c[o + 2] = (col[2] * a + this.c[o + 2] * ea * (1 - a)) / na;
      this.c[o + 3] = na;
    }
    this.part[i] = part || 0;
    this.fl[i] = fl || 0;
  };
  Pix.prototype.get = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const o = (y * this.w + x) * 4;
    return this.c[o + 3] > 0 ? [this.c[o], this.c[o + 1], this.c[o + 2], this.c[o + 3]] : null;
  };
  Pix.prototype.clear = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.c[i * 4 + 3] = 0; this.part[i] = 0; this.fl[i] = 0;
  };
  Pix.prototype.rect = function (x, y, w, h, col, part, fl, a) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.put(xx, yy, col, part, fl, a);
  };
  // centred horizontal span: covers [cx - w/2, cx + w/2) around canvas centre line
  Pix.prototype.span = function (cx, y, w, col, part, fl, a) {
    const x0 = Math.round(cx - w / 2);
    for (let x = x0; x < x0 + Math.round(w); x++) this.put(x, y, col, part, fl, a);
  };
  Pix.prototype.ellipse = function (cx, cy, rx, ry, col, part, fl, a) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x + 0.5 - cx) / Math.max(0.5, rx), dy = (y + 0.5 - cy) / Math.max(0.5, ry);
        if (dx * dx + dy * dy <= 1) this.put(x, y, col, part, fl, a);
      }
    }
  };
  // ball shading with a 4-tone ramp (light from upper-left)
  Pix.prototype.ball = function (cx, cy, rx, ry, col, part, fl, a, hiAmt) {
    const hi = rampLight(col, hiAmt || 0.28), lo = rampDark(col, 0.25), lo2 = rampDark(col, 0.45), spec = rampLight(col, 0.6);
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x + 0.5 - cx) / Math.max(0.5, rx), dy = (y + 0.5 - cy) / Math.max(0.5, ry);
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        const l = -0.62 * dx - 0.78 * dy;
        let c = col;
        if (l > 0.72 && d < 0.5) c = spec; else if (l > 0.32) c = hi; else if (l < -0.62) c = lo2; else if (l < -0.12) c = lo;
        this.put(x, y, c, part, (fl || 0) | F_NOSHADE, a);
      }
    }
  };
  Pix.prototype.line = function (x0, y0, x1, y1, col, part, fl, a) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 200; n++) {
      this.put(x0, y0, col, part, fl, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  Pix.prototype.poly = function (pts, col, part, fl, a) {
    let minY = Infinity, maxY = -Infinity;
    pts.forEach((p) => { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        if ((p[1] <= yc && q[1] > yc) || (q[1] <= yc && p[1] > yc)) xs.push(p[0] + (yc - p[1]) / (q[1] - p[1]) * (q[0] - p[0]));
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) this.put(x, y, col, part, fl, a);
      }
    }
  };
  // thick tapered curve through control points (quadratic segments)
  Pix.prototype.curve = function (pts, r0, r1, col, part, fl, a, colorFn) {
    const samples = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const steps = Math.max(2, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * 2));
      for (let s = 0; s < steps; s++) samples.push([p[0] + (q[0] - p[0]) * s / steps, p[1] + (q[1] - p[1]) * s / steps]);
    }
    samples.push(pts[pts.length - 1]);
    samples.forEach((p, i) => {
      const tt = i / Math.max(1, samples.length - 1);
      const r = r0 + (r1 - r0) * tt;
      const c = colorFn ? colorFn(tt) : col;
      if (r <= 0.6) this.put(p[0], p[1], c, part, fl, a);
      else this.ellipse(p[0] + 0.5, p[1] + 0.5, r, r, c, part, fl, a);
    });
  };

  // ---------------------------------------------------------------- post passes
  function passShading(px, amount) {
    const amt = Number.isFinite(amount) ? amount : 1;
    const w = px.w, h = px.h;
    const src = new Float32Array(px.c);
    const sameAt = (x, y, p) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0 && px.part[y * w + x] === p;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, o = i * 4;
        if (src[o + 3] <= 0 || (px.fl[i] & (F_GLOW | F_NOSHADE))) continue;
        const p = px.part[i];
        const col = [src[o], src[o + 1], src[o + 2]];
        let runL = 0, runR = 0;
        while (runL < 8 && sameAt(x - runL - 1, y, p)) runL++;
        while (runR < 8 && sameAt(x + runR + 1, y, p)) runR++;
        const width = runL + runR + 1;
        const topEdge = !sameAt(x, y - 1, p);
        const botEdge = !sameAt(x, y + 1, p);
        let c = col;
        if (width >= 3 && runR === 0) c = rampDark(col, 0.24 * amt);
        else if (width >= 7 && runR === 1) c = rampDark(col, 0.12 * amt);
        else if (width >= 3 && runL === 0) c = rampLight(col, 0.16 * amt);
        if (topEdge && runR > 0) c = rampLight(c, 0.12 * amt);
        if (botEdge && !topEdge && width >= 3) c = rampDark(c, 0.12 * amt);
        px.c[o] = c[0]; px.c[o + 1] = c[1]; px.c[o + 2] = c[2];
      }
    }
  }
  function passOutline(px, outlineBase, soft) {
    const w = px.w, h = px.h;
    const src = new Float32Array(px.c);
    const fl = new Uint8Array(px.fl);
    const ink = outlineBase || [18, 12, 26];
    // soft = Prince of Persia gesture: thin silhouette ink that follows the neighbour colour, not a thick black cartoon outline
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i * 4 + 3] > 0) continue;
        let best = -1, bestA = 0;
        const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (src[j * 4 + 3] > 0.05 && !(fl[j] & F_NOOUTLINE) && src[j * 4 + 3] > bestA) { best = j; bestA = src[j * 4 + 3]; }
        }
        if (best < 0) continue;
        const nc = [src[best * 4], src[best * 4 + 1], src[best * 4 + 2]];
        const isGlow = fl[best] & F_GLOW;
        const oc = soft
          ? (isGlow ? mix(darken(nc, 0.25), ink, 0.2) : mix(darken(nc, 0.42), ink, 0.28))
          : (isGlow ? mix(darken(nc, 0.45), ink, 0.35) : mix(darken(nc, 0.7), ink, 0.55));
        px.put(x, y, oc, 99, F_NOSHADE | (fl[best] & F_TRANS), Math.min(1, bestA * (isGlow ? 0.9 : (soft ? 0.85 : 1))));
      }
    }
  }
  function passItemOutline(px) {
    const fg = { 17: 1, 20: 1, 21: 1, 22: 1, 46: 1 };
    const w = px.w, h = px.h;
    const part = new Uint8Array(px.part);
    const alive = (x, y) => x >= 0 && y >= 0 && x < w && y < h && px.c[(y * w + x) * 4 + 3] > 0;
    const marks = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!alive(x, y) || fg[part[y * w + x]] || part[y * w + x] === 23) continue;
      const near = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => alive(nx, ny) && fg[part[ny * w + nx]] && !(px.fl[ny * w + nx] & F_GLOW));
      if (near) marks.push(y * w + x);
    }
    marks.forEach((i) => { const o = i * 4; const c = mix([px.c[o], px.c[o + 1], px.c[o + 2]], INK, 0.65); px.c[o] = c[0]; px.c[o + 1] = c[1]; px.c[o + 2] = c[2]; });
  }
  function passGlow(px, strength) {
    const w = px.w, h = px.h;
    const src = new Float32Array(px.c);
    const fl = new Uint8Array(px.fl);
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!(fl[i] & F_GLOW) || src[i * 4 + 3] <= 0) continue;
      const c = [src[i * 4], src[i * 4 + 1], src[i * 4 + 2]];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (!d) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (src[(ny * w + nx) * 4 + 3] > 0) continue;
        add.push([nx, ny, c, d === 1 ? 0.42 * strength : 0.16 * strength]);
      }
    }
    add.forEach(([x, y, c, a]) => px.put(x, y, lighten(c, 0.15), 98, F_NOSHADE | F_NOOUTLINE, a));
  }
  // World-look aura for the 3D actors (presets): no soft alpha halo (would voxelize into a slab) but a solid
  // 1px rim of aura colour hugging the outline + a few rising motes attached to the rim, animated per frame.
  function passWorldAura(px, col, strength, frame, motesOnly) {
    const w = px.w, h = px.h;
    const solid = (i) => px.c[i * 4 + 3] > 0.3;
    const rim = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (solid(i)) continue;
      if (solid(i - 1) || solid(i + 1) || solid(i - w) || solid(i + w)) rim.push(i);
    }
    const dark = mix(col, [20, 12, 30], 0.35);
    if (!motesOnly) rim.forEach((i) => {
      const x = i % w, y = (i / w) | 0;
      // pulse: rim shimmers between aura and a darker tone, travelling upward with the frame
      const c = ((y + frame * 2) % 6) < 3 ? col : dark;
      px.put(x, y, c, PART.DETAIL, F_GLOW | F_NOOUTLINE | F_NOSHADE, 1);
    });
    // motes: short vertical sparks just outside the rim, rising with the frame
    const n = Math.round(4 + strength * 6);
    for (let k = 0; k < n; k++) {
      const i = rim[(k * 7919 + 13) % Math.max(1, rim.length)];
      if (i === undefined) continue;
      const x = i % w, y = ((i / w) | 0) - ((frame + k) % 2);
      if (y > 1 && !solid(y * w + x)) px.put(x, y, mix(col, [255, 255, 255], 0.3), PART.DETAIL, F_GLOW | F_NOOUTLINE | F_NOSHADE, 1);
    }
  }
  function passAura(px, col, strength, frame) {
    if (!(strength > 0.05)) return;
    const w = px.w, h = px.h;
    const dist = new Uint8Array(w * h).fill(255);
    const q = [];
    for (let i = 0; i < w * h; i++) if (px.c[i * 4 + 3] > 0.3) { dist[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % w, y = (i / w) | 0, d = dist[i];
      if (d >= 4) continue;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const j = ny * w + nx;
        if (dist[j] > d + 1) { dist[j] = d + 1; q.push(j); }
      });
    }
    const maxD = strength > 0.5 ? 4 : 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = dist[i];
      if (d < 2 || d > maxD || px.c[i * 4 + 3] > 0) continue;
      const checker = ((x + y + frame) & 1) === 0;
      if (d === maxD && !checker) continue;
      const a = (d === 2 ? 0.34 : 0.2) * Math.min(1, strength + 0.2);
      px.put(x, y, col, 97, F_NOSHADE | F_NOOUTLINE, a);
    }
  }
  function passTranslucency(px, amount, fadeFromY, fadeToY) {
    if (!(amount > 0)) return;
    for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) {
      const i = y * px.w + x;
      if (!(px.fl[i] & F_TRANS) || px.c[i * 4 + 3] <= 0) continue;
      let a = 1 - amount;
      if (fadeFromY !== undefined && y > fadeFromY) a *= clamp(1 - (y - fadeFromY) / Math.max(1, fadeToY - fadeFromY) * 0.7, 0.2, 1);
      px.c[i * 4 + 3] *= a;
    }
  }

  // ---------------------------------------------------------------- drawing context
  const PART = { WING_L: 2, WING_R: 3, CAPE: 4, TAIL: 5, HAIRBACK: 6, LEG_L: 7, LEG_R: 8, TORSO: 9, SKIRT: 10, ARM_L: 11, ARM_R: 12, HAND_L: 13, HAND_R: 14, HEAD: 15, HAIR: 16, HORN: 17, EAR: 18, HELM: 19, ITEM: 20, SHIELD: 21, ORB: 22, DETAIL: 23, EYE: 24, BELT: 25, PAUL_L: 26, PAUL_R: 27, HOOD: 28, ABDOMEN: 29, BODY: 30, BODY2: 31, LEG_BL: 32, LEG_BR: 33, NECK: 34, SNOUT: 35, ARM2_L: 36, ARM2_R: 37, BOOT_L: 38, BOOT_R: 39, BEARD: 40, MANTLE: 41, COIL1: 42, COIL2: 43, COIL3: 44, TAB: 45, ITEM2: 46 };
  const CX = 32; // GRID/2
  const INK = [20, 14, 28];

  function buildContext(spec, frame) {
    // (hood can be dropped by the variation for generic spectral sheets; see below)
    let t = spec.traits;
    const vr = makeRng(spec.seed >>> 0);
    const v = {
      skinHue: vr.range(-9, 9), outfitHue: vr.range(-26, 26), outfitLight: vr.range(-0.08, 0.08),
      shoulder: vr.int(-1, 1), head: vr.int(-1, 0), leg: vr.int(-1, 1), height: vr.int(-2, 1),
      tailDir: vr.chance(0.5) ? 1 : -1, eyeSpread: vr.int(0, 1), belt: vr.int(0, 2), emblem: vr.int(0, 5),
      capeLen: vr.int(-2, 1), hornTilt: vr.int(0, 1), facePaint: vr.chance(0.22), scar: vr.chance(0.14),
      earring: vr.chance(0.2), bladeLen: vr.int(-1, 2), pauldron: vr.int(0, 2), trim: vr.int(0, 2),
      fringe: vr.int(0, 3), hornColor: vr.int(0, 2), markSeed: vr.int(1, 1e9), plume: vr.chance(0.45),
      hood: vr.int(0, 1), wingSpread: vr.range(0.9, 1.1), stance: vr.int(0, 1), mouth: vr.int(0, 2),
      bodyW: vr.int(-2, 2), detailSeed: vr.int(1, 1e9), sleeve: vr.int(0, 1),
      acc: vr.int(0, 4), tintHue: vr.range(0, 360), hoodOff: vr.chance(0.4), heightM: vr.int(-3, 2)
    };
    if (spec.isMonster) v.height = v.heightM;
    const P = {};
    PALETTE_KEYS.forEach((k) => { P[k] = hexToRgb(t.palette[k]); });
    P.skin = shiftHue(P.skin, v.skinHue);
    P.skin2 = shiftHue(P.skin2, v.skinHue);
    P.outfit = shiftHue(P.outfit, v.outfitHue, 1, v.outfitLight);
    P.outfit2 = shiftHue(P.outfit2, v.outfitHue, 1, v.outfitLight);
    if (rgbToHsl(P.outfit)[1] < 0.18 && rgbToHsl(P.outfit)[2] > 0.24 && rgbToHsl(P.outfit)[2] < 0.78 && !t.signature) {
      const l = rgbToHsl(P.outfit)[2];
      P.outfit = hslToRgb(v.tintHue, 0.22 + (v.detailSeed % 10) / 80, clamp(l + v.outfitLight * 1.6, 0.12, 0.8));
      P.outfit2 = rampDark(P.outfit, 0.35);
    }
    P.belly = mix(lighten(P.skin, 0.25), [240, 220, 170], 0.25);
    P.hornC = t.hornColor ? hexToRgb(t.hornColor) : [[226, 214, 186], [60, 52, 56], rampDark(P.skin2, 0.25)][v.hornColor];
    if (t.element === 'void' || t.element === 'shadow') P.hornC = [44, 38, 52];
    P.capeC = t.capeColor ? hexToRgb(t.capeColor) : (t.outfit.style === 'plate' ? shiftHue([150, 30, 34], v.outfitHue * 0.6) : rampDark(P.outfit, 0.15));
    P.wingC = t.wingColor ? hexToRgb(t.wingColor) : (t.wings === 'feather' ? (t.element === 'holy' || t.halo ? [244, 240, 228] : lighten(P.hair, 0.15)) : shiftHue(mix(P.skin, P.skin2, 0.45), 6, 0.9, t.bodyPlan === 'spectral' ? 0.08 : 0));
    P.leather = [92, 62, 40];
    P.boot = rampDark(t.outfit.style === 'leather' ? P.outfit : [70, 50, 36], 0.35);
    const level = spec.level || 1;
    const sizeScale = (SIZES[t.size] || 1) * (1 + Math.min(30, level) / 30 * (spec.isMonster ? 0.06 : 0.025));
    const fr = { i: frame, bob: frame === 2 ? 1 : 0, step: frame === 1 ? 1 : (frame === 3 ? -1 : 0), flap: frame % 2 === 1 ? 1 : 0, rng: makeRng((spec.seed ^ (frame * 2654435761)) >>> 0) };
    const auraStrength = Math.max(t.aura.strength || 0, level >= 10 ? 0.22 + Math.min(level, 40) / 90 : 0);
    let hoodOff = t.bodyPlan === 'spectral' && v.hoodOff && t.outfit.symbol === 'none' && t.outfit.helm !== 'cowl';
    if (hoodOff) { t = JSON.parse(JSON.stringify(t)); t.outfit.hood = false; if (t.hair === 'none' || t.hair === 'short') t.hair = 'flowing'; P.hair = lighten(P.skin, 0.35); }
    return { spec, t, v, P, px: new Pix(GRID, GRID), fr, s: sizeScale, hoodOff, level, auraStrength, female: sexCue(spec.sex) === 'female', rngD: makeRng(v.detailSeed) };
  }
  function even(n) { n = Math.round(n); return n % 2 ? n + 1 : n; }

  // ---------------------------------------------------------------- humanoid layout
  function layoutHumanoid(D) {
    const t = D.t, v = D.v;
    let s = D.s;
    if (t.bodyPlan === 'giant') s = Math.max(s, 1.12);
    const slender = t.build === 'slender', heavy = t.build === 'heavy' || t.bodyPlan === 'giant';
    const hornRoom = (t.horns !== 'none' || t.outfit.helm === 'crown' || t.hair === 'mohawk') ? 3 : 0;
    let H = Math.round(35 * s) + v.height;
    H = clamp(H, 18, GRID - 5 - hornRoom);
    let headH = clamp(Math.round(9 * Math.pow(s, 0.45)) + v.head, 6, 11);
    if (t.head === 'beast' || t.head === 'reptile') headH += 1;
    let headW = even(headH - (D.female && t.head === 'human' ? 1 : 0));
    if (t.head === 'beast' || t.head === 'demon') headW += 2;
    const gesture = t.heroic || t.gesture;
    const natural = !!(t.naturalLimbs || t.statuesque); // presets: no 1px stick limbs
    if (gesture) {
      // lean silhouette + headroom for wing peaks / tip-up swords; statuesque = taller Number-Six read
      const wingRoom = (t.wings !== 'none' && (t.wingHang || t.raggedWings || (t.wingScale || 1) > 1)) ? 12 : 0;
      H = clamp(Math.round((t.statuesque ? 44 : 40) * s) + v.height, 18, GRID - 2 - hornRoom - (t.headroom || 0) - wingRoom);
      headH = clamp(Math.round(headH * (t.statuesque ? 0.62 : 0.68)), 5, 8);
      headW = even(Math.max(4, headH - (D.female && t.head === 'human' ? 2 : 1)));
    }
    const legRatio = t.statuesque ? 0.64 : (gesture ? (slender && !natural ? 0.56 : 0.55) : 0.47);
    const legH = Math.round((H - headH) * legRatio) + v.leg;
    const torsoH = H - headH - legH;
    // statuesque = tall athletic sexy (Number Six): slim shoulders, tiny waist, hips only slightly fuller — NOT a wide rectangle
    let shoulderW = even((D.female ? (t.statuesque ? 8 : 10) : (natural && heavy ? 11 : 12)) * s + (slender || t.statuesque ? -2 : 0) + (heavy && !natural ? 2 : 0) + v.shoulder - (gesture && !natural ? 1 : 0));
    shoulderW = Math.max(4, shoulderW);
    const waistW = Math.max(2, even(shoulderW - (D.female ? (t.statuesque ? 5 : (t.heroic ? 5 : 4)) : 2) - (heavy && !natural ? -1 : 0)));
    const hipW = Math.max(3, even(D.female ? (t.statuesque ? shoulderW : (t.heroic ? shoulderW + 2 : shoulderW - (gesture ? 0 : 1))) : shoulderW - (heavy ? 1 : 2)));
    // Slender natural limbs: never 1px sticks, but NOT chunky — lean volumes for presets.
    const armBase = natural ? (heavy ? 2.4 : 2.0) : (gesture ? 2.0 : 2.6);
    const armW = clamp(Math.round(armBase * s) + (heavy && !natural ? 1 : 0) - (t.bodyPlan === 'skeletal' || t.bodyPlan === 'insectoid' ? 1 : 0), 2, natural ? 3 : 4);
    const legW = Math.max(2, Math.floor(hipW / 2) - 1 - (t.bodyPlan === 'skeletal' ? 1 : 0) + (natural && heavy ? 0 : 0));
    const floating = t.floating || t.bodyPlan === 'spectral';
    const ground = GRID - 2 - (floating ? 2 + (D.fr.i % 2) : 0);
    const yLegTop = ground - legH + 1;
    const yTorsoTop = yLegTop - torsoH + D.fr.bob;
    const yHeadBottom = yTorsoTop - 1;
    const yHeadTop = yHeadBottom - headH + 1;
    return { s, H, headH, headW, legH, torsoH, shoulderW, waistW, hipW, armW, legW, ground, yLegTop, yTorsoTop, yHeadTop, yHeadBottom, heavy, slender, floating, armLen: torsoH + 1 };
  }
  function torsoWidthAt(L, row) {
    const tt = row / Math.max(1, L.torsoH - 1);
    if (tt < 0.15) return L.shoulderW;
    if (tt < 0.6) return Math.round(L.shoulderW + (L.waistW - L.shoulderW) * ((tt - 0.15) / 0.45));
    return Math.round(L.waistW + (L.hipW - L.waistW) * ((tt - 0.6) / 0.4));
  }

  // ---------------------------------------------------------------- symbols & small motifs
  function drawSymbol(px, kind, cx, cy, col, fl) {
    const p = (dx, dy) => px.put(cx + dx, cy + dy, col, PART.DETAIL, (fl || 0) | F_NOSHADE);
    switch (kind) {
      case 'holy': p(0, -1); p(-1, 0); p(0, 0); p(1, 0); p(0, 1); p(0, 2); break;
      case 'skull': p(-1, -1); p(0, -1); p(1, -1); p(-1, 0); p(1, 0); p(0, 1); break;
      case 'eye': p(-1, 0); p(1, 0); p(0, -1); p(0, 1); px.put(cx, cy, [20, 10, 30], PART.DETAIL, F_NOSHADE); break;
      case 'rune': p(0, -1); p(0, 0); p(0, 1); p(-1, -1); p(1, 1); break;
      case 'sun': p(0, 0); p(-1, -1); p(1, -1); p(-1, 1); p(1, 1); p(0, -1); p(0, 1); p(-1, 0); p(1, 0); break;
      case 'moon': p(-1, -1); p(-1, 0); p(-1, 1); p(0, -1); p(0, 1); break;
      case 'flame': p(0, -1); p(-1, 0); p(0, 0); p(1, 0); p(0, 1); break;
      case 'star': p(0, -1); p(-1, 0); p(1, 0); p(0, 1); p(0, 0); break;
      default: break;
    }
  }
  function textureCovering(D, part, x0, y0, x1, y1) {
    const px = D.px, t = D.t, P = D.P;
    const r = makeRng(D.v.markSeed + part * 977);
    const cov = t.covering, mark = t.markings;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (px.partAt(x, y) !== part) continue;
      const base = px.get(x, y);
      if (!base) continue;
      const c = [base[0], base[1], base[2]];
      if (cov === 'scales' || mark === 'scales') {
        if (((x + (y % 2 ? 1 : 0)) % 2 === 0) && y % 2 === 0) px.put(x, y, rampDark(c, 0.18), part, px.fl[y * px.w + x]);
        else if (((x + 1 + (y % 2)) % 3 === 0) && r.chance(0.35)) px.put(x, y, rampLight(c, 0.12), part, px.fl[y * px.w + x]);
      } else if (cov === 'fur') {
        if (r.chance(0.22)) px.put(x, y, rampDark(c, 0.16), part, px.fl[y * px.w + x]);
      } else if (cov === 'chitin') {
        if (y % 3 === 0) px.put(x, y, rampDark(c, 0.25), part, px.fl[y * px.w + x]);
      } else if (cov === 'stone') {
        if (r.chance(0.12)) px.put(x, y, rampDark(c, 0.2), part, px.fl[y * px.w + x]);
      } else if (cov === 'bark') {
        if ((x + Math.floor(y / 3)) % 3 === 0) px.put(x, y, rampDark(c, 0.22), part, px.fl[y * px.w + x]);
      } else if (cov === 'feathers') {
        if ((y % 3 === 0 && x % 2 === 0) || (y % 3 === 1 && x % 2 === 1)) px.put(x, y, rampDark(c, 0.14), part, px.fl[y * px.w + x]);
      } else if (cov === 'crystal') {
        if ((x + y) % 4 === 0) px.put(x, y, rampLight(c, 0.25), part, px.fl[y * px.w + x]);
      }
      if (mark === 'stripes' && (y % 4 === 0) && r.chance(0.8)) px.put(x, y, rampDark(c, 0.35), part, px.fl[y * px.w + x]);
      if (mark === 'spots' && r.chance(0.07)) px.put(x, y, rampDark(c, 0.32), part, px.fl[y * px.w + x]);
    }
    if (mark === 'veins' || mark === 'cracks' || mark === 'runes') {
      const col = mark === 'cracks' && !t.eyes.glow ? rampDark(P.skin, 0.4) : P.glow;
      const fl = (mark === 'cracks' && !t.eyes.glow) ? F_NOSHADE : F_GLOW;
      const n = mark === 'runes' ? 2 : 2;
      for (let k = 0; k < n; k++) {
        let x = r.int(x0 + 1, Math.max(x0 + 1, x1 - 1)), y = r.int(y0 + 1, Math.max(y0 + 1, y1 - 1));
        if (mark === 'runes') {
          if (px.partAt(x, y) === part) { drawSymbol(px, 'rune', x, y, col, fl); }
          continue;
        }
        for (let s = 0; s < 6; s++) {
          if (px.partAt(x, y) === part) px.put(x, y, col, part, fl | F_NOSHADE);
          x += r.int(-1, 1); y += 1;
        }
      }
    }
  }

  // ---------------------------------------------------------------- shared appendages
  // Torn membrane: notch the trailing edge and punch a few holes (presets, e.g. Mortacia's dragon wings).
  function raggedWingEdges(D) {
    const px = D.px, w = px.w, h = px.h;
    const isWing = (x, y) => x >= 0 && y >= 0 && x < w && y < h && (px.partAt(x, y) === PART.WING_L || px.partAt(x, y) === PART.WING_R);
    const cuts = [];
    for (let x = 0; x < w; x++) for (let y = h - 2; y >= 0; y--) {
      if (!isWing(x, y)) continue;
      if (!isWing(x, y + 1)) {
        const hsh = (x * 73856093) ^ (y * 19349663);
        if (x % 3 === 0 && (hsh & 1)) { cuts.push([x, y]); cuts.push([x, y - 1]); } else if (x % 3 === 1 && (hsh & 2)) cuts.push([x, y]);
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!isWing(x, y) || !isWing(x - 1, y) || !isWing(x + 1, y) || !isWing(x, y - 1) || !isWing(x, y + 1)) continue;
      if ((((x * 2654435761) ^ (y * 40503)) >>> 0) % 61 === 0) cuts.push([x, y]);
    }
    cuts.forEach(([x, y]) => px.clear(x, y));
  }
  function drawWings(D, ax, ay, span, height, kind) {
    const px = D.px, P = D.P, fr = D.fr;
    const flap = fr.flap ? -2 : 0;
    const mem = kind === 'feather' ? P.wingC : P.wingC;
    const bone = kind === 'feather' ? rampDark(P.wingC, 0.2) : rampDark(P.wingC, 0.35);
    [-1, 1].forEach((side) => {
      const part = side < 0 ? PART.WING_L : PART.WING_R;
      const sx = ax + side * 1;
      const elbow = [sx + side * span * 0.5, ay - height * 0.75 + flap];
      const tip = [sx + side * span, ay - height * 0.45 + flap * 1.5];
      const transFlag = (kind === 'insect' || kind === 'spectral') ? F_TRANS : 0;
      if (kind === 'bat' || kind === 'bone' || kind === 'spectral' || kind === 'flame') {
        // triangular dragon silhouette when wingHang/raggedWings: high bone leading edge, membranes hang to shin level
        const hang = (D.t.wingHang || (D.t.raggedWings ? 0.55 : 0.32));
        // X-clamp only — never flatten Y (that made cropped-looking wing tops). Height is pre-fitted by caller.
        const clampPt = (p) => [clamp(Math.round(p[0]), 1, GRID - 2), Math.round(p[1])];
        // Annotated: sharp high tip; outer edge VERTICAL then taper to sharp ankle point, then angle UP to hands
        const ankleY = D.ankleY != null ? D.ankleY : Math.min(GRID - 3, ay + Math.round(height * Math.max(hang, 0.9)));
        const handY = D.handAimY != null ? D.handAimY : ay + Math.round(height * 0.35);
        const tipX = sx + side * span * 0.78;
        const tipY = ay - height * 1.08 + flap;
        const outerX = sx + side * span * 1.02; // vertical outer edge under the tip
        let pts = (D.t.wingHang || D.t.raggedWings) ? [
          [sx, ay - 1],                                      // shoulder root
          [tipX, tipY],                                      // SHARP high tip
          [outerX, tipY + Math.round(height * 0.35)],        // vertical outer (high)
          [outerX, Math.round((tipY + ankleY) * 0.55)],      // vertical outer (mid)
          [sx + side * span * 0.92, ankleY],                 // TAPER to sharp ankle point
          [sx + side * span * 0.55, Math.round(ankleY - (ankleY - handY) * 0.35)], // angle UP
          [sx + side * span * 0.22, handY],                  // toward hands
          [sx + side * 2, ay + 2]                            // back to shoulder
        ] : [[sx, ay - 2], elbow, tip,
          [sx + side * span * 0.86, ay + height * 0.12], [sx + side * span * 0.66, ay - height * 0.02],
          [sx + side * span * 0.5, ay + height * 0.26], [sx + side * span * 0.3, ay + height * 0.1],
          [sx + side * span * 0.14, ay + height * 0.32], [sx, ay + height * 0.22]];
        pts = pts.map(clampPt);
        if (kind === 'flame') {
          px.poly(pts, [255, 140, 40], part, F_GLOW);
          px.poly(pts.map((p) => [sx + (p[0] - sx) * 0.7, ay + (p[1] - ay) * 0.7]), [255, 214, 90], part, F_GLOW);
        } else if (kind !== 'bone') {
          px.poly(pts, kind === 'spectral' ? lighten(mem, 0.3) : mem, part, transFlag | (kind === 'spectral' ? F_NOSHADE : 0), kind === 'spectral' ? 0.6 : 1);
        }
        // Annotated: black EDGE outline (flat silhouette — no folded look) + THREE bones from peak
        const tipPt = (D.t.wingHang || D.t.raggedWings) ? pts[1] : tip;
        const ink = [8, 8, 10];
        if (D.t.wingHang || D.t.raggedWings) {
          // crisp black outline around the whole wing polygon
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            px.line(a[0], a[1], b[0], b[1], ink, PART.DETAIL, F_NOSHADE);
            px.line(a[0], a[1] + 1, b[0], b[1] + 1, ink, PART.DETAIL, F_NOSHADE);
          }
          // lead-in shoulder → peak, then THREE bones radiating down from the peak
          px.line(sx, ay - 1, tipPt[0], tipPt[1], ink, PART.DETAIL, F_NOSHADE);
          px.line(sx, ay, tipPt[0], tipPt[1] + 1, ink, PART.DETAIL, F_NOSHADE);
          const ends = [
            pts[4], // ankle point
            [Math.round((pts[3][0] + pts[5][0]) / 2), Math.round((pts[3][1] + pts[5][1]) / 2)],
            pts[6]  // toward hands
          ];
          ends.forEach((ep) => {
            px.line(tipPt[0], tipPt[1], ep[0], ep[1], ink, PART.DETAIL, F_NOSHADE);
            px.line(tipPt[0] - side, tipPt[1] + 1, ep[0] - side, ep[1], ink, PART.DETAIL, F_NOSHADE);
          });
          px.put(tipPt[0], tipPt[1], ink, PART.DETAIL, F_NOSHADE);
        } else {
          const e0 = pts[1], t0 = pts[2];
          px.line(sx, ay - 2, e0[0], e0[1], bone, PART.DETAIL, F_NOSHADE);
          px.line(e0[0], e0[1], t0[0], t0[1], bone, PART.DETAIL, F_NOSHADE);
          for (let k = 3; k < Math.min(pts.length - 1, 6); k++) px.line(e0[0], e0[1], pts[k][0], pts[k][1], bone, PART.DETAIL, F_NOSHADE);
          px.put(tipPt[0], tipPt[1], rampLight(P.hornC, 0.2), PART.DETAIL, F_NOSHADE);
        }
      } else if (kind === 'feather') {
        const pts = [[sx, ay - 2], [sx + side * span * 0.45, ay - height * 0.85 + flap], [sx + side * span, ay - height * 0.6 + flap * 1.5],
          [sx + side * span * 0.95, ay - height * 0.1], [sx + side * span * 0.7, ay + height * 0.25], [sx + side * span * 0.4, ay + height * 0.35], [sx, ay + height * 0.15]];
        px.poly(pts, mem, part, 0);
        // feather rows
        for (let k = 0; k < 4; k++) {
          const fx = sx + side * span * (0.35 + k * 0.17);
          const fy0 = ay - height * (0.45 - k * 0.07) + flap;
          px.line(fx, fy0, fx - side * 1, fy0 + height * 0.5, rampDark(mem, 0.22), PART.DETAIL, F_NOSHADE);
        }
        px.line(sx, ay - 2, sx + side * span * 0.45, ay - height * 0.85 + flap, rampLight(mem, 0.25), PART.DETAIL, F_NOSHADE);
      } else if (kind === 'insect') {
        const c = mix(lighten(P.glow, 0.4), [220, 240, 255], 0.5);
        px.ellipse(sx + side * span * 0.5, ay - height * 0.35 + flap, span * 0.52, height * 0.42, c, part, F_TRANS | F_NOSHADE, 0.55);
        px.ellipse(sx + side * span * 0.38, ay + height * 0.15, span * 0.36, height * 0.26, c, part, F_TRANS | F_NOSHADE, 0.5);
        px.line(sx, ay - 1, sx + side * span * 0.85, ay - height * 0.5 + flap, lighten(c, 0.3), PART.DETAIL, F_NOSHADE | F_TRANS, 0.8);
      }
    });
  }
  function drawTail(D, x0, y0, dir, len, kind, groundY) {
    const px = D.px, P = D.P, t = D.t, fr = D.fr;
    const sway = fr.step;
    let pts, r0 = 1.6, r1 = 0.5;
    if (kind === 'stinger') {
      pts = [[x0, y0], [x0 + dir * len * 0.6, y0 - 2], [x0 + dir * len * 0.85, y0 - len * 0.8], [x0 + dir * len * 0.45, y0 - len * 1.2]];
      r0 = 1.5; r1 = 1;
    } else {
      pts = [[x0, y0], [x0 + dir * len * 0.45, Math.min(groundY - 2, y0 + len * 0.45)], [x0 + dir * len * 0.85, groundY - 1], [x0 + dir * (len + 1), groundY - 4 - sway]];
    }
    if (kind === 'thick' || kind === 'scaled') r0 = 2.2;
    if (kind === 'thin') r0 = 1.1;
    const col = kind === 'flame' ? [255, 130, 40] : (kind === 'wisp' ? lighten(P.skin, 0.3) : P.skin);
    const fl = kind === 'flame' ? F_GLOW : (kind === 'wisp' ? F_TRANS : 0);
    px.curve(pts, r0, r1, col, PART.TAIL, fl, kind === 'wisp' ? 0.65 : 1);
    if (kind === 'scaled' || t.spikes) {
      for (let k = 1; k < 6; k++) {
        const tt = k / 6;
        const seg = Math.min(pts.length - 2, Math.floor(tt * (pts.length - 1)));
        const lt = tt * (pts.length - 1) - seg;
        const p = [pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * lt, pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * lt];
        px.put(p[0], p[1] - (r0 * (1 - tt) + 1), rampDark(P.skin2, 0.15), PART.DETAIL, F_NOSHADE);
      }
    }
    if (kind === 'stinger') {
      const tip = pts[pts.length - 1];
      px.put(tip[0] - dir, tip[1] + 1, [230, 220, 200], PART.DETAIL, F_NOSHADE);
      px.put(tip[0] - dir * 2, tip[1] + 2, [230, 220, 200], PART.DETAIL, F_NOSHADE);
    }
  }
  function drawHornsAt(D, cx, top, halfW, kind, scale) {
    const px = D.px, P = D.P, v = D.v;
    const hc = P.hornC, tip = rampLight(hc, 0.3), dk = rampDark(hc, 0.25);
    const sc = scale || 1;
    [-1, 1].forEach((side) => {
      const bx = side < 0 ? cx - halfW : cx + halfW - 1;
      const p = (dx, dy, c) => px.put(bx + side * dx, top + dy, c || hc, PART.HORN, 0);
      if (kind === 'nubs') { p(0, 0); p(0, -1, tip); }
      else if (kind === 'curved') { p(0, 1); p(0, 0); p(1, 0); p(1, -1); p(1, -2); p(2, -2, dk); p(2, -3); p(2, -4, tip); if (sc > 1.05) { p(3, -5, tip); } if (v.hornTilt) p(1, 1, dk); }
      else if (kind === 'ram') { p(0, 0); p(1, 0); p(2, 1); p(2, 2); p(2, 3, dk); p(1, 4); p(0, 3, tip); p(1, -1); }
      else if (kind === 'antlers') { p(0, 0); p(0, -1); p(1, -2); p(1, -3); p(2, -4, tip); p(0, -3); p(-0, -4, tip); p(2, -2); p(3, -3, tip); }
      else if (kind === 'long') { const n = Math.round(5 * sc); for (let k = 0; k < n; k++) { p(Math.floor(k / 2) + 1, -k, k === n - 1 ? tip : (k % 2 ? dk : hc)); if (k < 2) p(Math.floor(k / 2), -k); } }
      else if (kind === 'crown') { p(0, 0); p(0, -1, tip); p(-2, 0); p(-2, -2, tip); p(-2, -1); }
    });
  }

  // ---------------------------------------------------------------- humanoid parts
  function drawCape(D, L) {
    const px = D.px, P = D.P, t = D.t;
    const top = L.yTorsoTop + 1;
    const bottom = Math.min(L.ground - 1, L.yLegTop + L.legH - 2 + D.v.capeLen);
    const wTop = L.shoulderW, wBot = L.shoulderW + 6;
    const pts = [[CX - wTop / 2, top], [CX + wTop / 2, top], [CX + wBot / 2 + D.fr.step * 0.5, bottom], [CX - wBot / 2 + D.fr.step * 0.5, bottom]];
    px.poly(pts, P.capeC, PART.CAPE, 0);
    if (t.tattered) for (let x = Math.round(CX - wBot / 2); x < CX + wBot / 2; x += 2) px.clear(x, bottom);
    for (let x = Math.round(CX - wBot / 2) + 2; x < CX + wBot / 2 - 1; x += 3) px.put(x, bottom - 1, rampDark(P.capeC, 0.25), PART.CAPE, 0);
  }
  function drawHairBack(D, L) {
    const px = D.px, P = D.P, t = D.t;
    if (!['long', 'flowing', 'braid', 'snakes'].includes(t.hair) || t.outfit.helm === 'closed' || t.outfit.hood) return;
    const len = t.hair === 'flowing' ? Math.round(L.torsoH * 0.85) : (t.hair === 'long' ? Math.round(L.torsoH * 0.45) : 2);
    const w = L.headW + 2;
    for (let y = L.yHeadTop + 2; y <= L.yHeadBottom + len; y++) {
      const taper = y > L.yHeadBottom + len - 2 ? 2 : 0;
      px.span(CX, y, w - taper, P.hair, PART.HAIRBACK, 0);
    }
  }
  function drawLegs(D, L) {
    const px = D.px, P = D.P, t = D.t, fr = D.fr;
    const style = t.outfit.style;
    const skel = t.bodyPlan === 'skeletal';
    // fighting / ready: statuesque keeps legs CLOSE (hips centered); others may widen slightly
    const closeStance = !!t.statuesque;
    const gap = skel ? 2 : (closeStance ? 1 : (D.fightStance ? Math.max(3, L.hipW - L.legW * 2 + 1) : (L.hipW - L.legW * 2 >= 2 ? 2 : 1)));
    let legCol = P.skin;
    if (style === 'plate') legCol = P.metal;
    else if (style === 'mail' || style === 'leather' || style === 'tabard') legCol = rampDark(style === 'leather' ? P.outfit2 : [74, 64, 58], 0.1);
    else if (style === 'gi') legCol = lighten(P.outfit, 0.2);
    else if (style === 'robe' || style === 'cloak') legCol = P.outfit2;
    if (t.covering !== 'skin' && ['none', 'rags', 'furs'].includes(style)) legCol = P.skin;
    [-1, 1].forEach((side) => {
      const part = side < 0 ? PART.LEG_L : PART.LEG_R;
      const lift = (fr.step === side) ? 1 : 0;
      // no outward hip flare for statuesque — keep hips centered / legs together
      const out = (D.fightStance && !closeStance) ? (side > 0 ? 1 : 0) : 0;
      const x0 = (side < 0 ? CX - gap / 2 - L.legW : CX + gap / 2) + side * out;
      const yTop = L.yLegTop + (skel ? 1 : 0);
      const yBot = L.ground - lift;
      if (skel) {
        px.rect(x0, yTop, L.legW, yBot - yTop + 1, P.skin, part, 0);
        const knee = Math.round((yTop + yBot) / 2);
        px.rect(x0 - (side < 0 ? 1 : 0), knee, L.legW + 1, 1, rampLight(P.skin, 0.1), part, 0);
        px.rect(x0 + (side < 0 ? -1 : 0), yBot, L.legW + 1, 1, P.skin, PART.BOOT_L + (side > 0 ? 1 : 0), 0);
        return;
      }
      const bootH = Math.max(2, Math.round(L.legH * (t.bootHeight || 0.28)));
      const bootTop = yBot - bootH + 1;
      const highCut = !!(D.t.garment && D.t.garment.highCut) || !!D.t.thighs;
      // Continuous natural thighs: no offset taper gaps, no conflicting highCut overlay rect.
      if (highCut && style === 'none') {
        const thighEnd = bootTop - 1;
        const kneeY = yTop + Math.round((thighEnd - yTop) * 0.45);
        const thighW0 = Math.max(L.legW, Math.round(L.hipW * (D.t.statuesque ? 0.26 : 0.32)));
        for (let y = yTop; y <= thighEnd; y++) {
          const tt = (y - yTop) / Math.max(1, thighEnd - yTop);
          const w = y < kneeY
            ? Math.max(L.legW, Math.round(thighW0 * (1 - tt * 0.2)))
            : Math.max(L.legW, Math.round(L.legW + (thighW0 - L.legW) * (1 - (y - kneeY) / Math.max(1, thighEnd - kneeY)) * 0.35));
          px.span(x0 + L.legW / 2, y, w, P.skin, part, 0);
        }
        px.span(x0 + L.legW / 2, kneeY, Math.max(2, L.legW), rampLight(P.skin, 0.12), PART.DETAIL, F_NOSHADE);
      } else if (D.fightStance) {
        const kneeY = yTop + Math.round((yBot - yTop) * 0.42);
        const thighW = Math.max(L.legW + (L.heavy ? 1 : 0), L.legW + (D.female ? 1 : 0));
        for (let y = yTop; y < kneeY; y++) {
          const tt = (y - yTop) / Math.max(1, kneeY - yTop);
          const w = Math.max(L.legW, Math.round(thighW * (1 - tt * 0.2)));
          px.span(x0 + L.legW / 2, y, w, legCol, part, 0);
        }
        for (let y = kneeY; y <= yBot; y++) px.span(x0 + L.legW / 2, y, L.legW + (L.heavy ? 1 : 0), legCol, part, 0);
        px.put(x0 + (side < 0 ? 0 : L.legW - 1), kneeY, rampLight(legCol, 0.2), PART.DETAIL, F_NOSHADE);
      } else {
        px.rect(x0, yTop, L.legW + (L.heavy ? 1 : 0), yBot - yTop + 1, legCol, part, 0);
      }
      // footwear
      const bootPart = side < 0 ? PART.BOOT_L : PART.BOOT_R;
      const ext = side < 0 ? -1 : 0;
      let bootCol = P.boot;
      if (style === 'plate') bootCol = rampDark(P.metal, 0.18);
      if (t.bootColor) bootCol = hexToRgb(t.bootColor);
      if (style === 'furs') bootCol = [120, 96, 70];
      if (['none', 'rags'].includes(style) && t.covering !== 'skin') bootCol = null;
      if (t.horns === 'curved' && /demon|devil|satyr|faun|fiend/i.test(D.spec.race)) bootCol = [40, 30, 30];
      if (bootCol) {
        const bw = L.legW + (L.heavy ? 1 : 0);
        px.rect(x0, bootTop, bw, bootH, bootCol, bootPart, 0);
        if (!((t.heroic || t.gesture) && t.bootHeight > 0.4)) px.rect(x0 + ext, yBot, bw + 1, 1, bootCol, bootPart, 0);
        if (t.bootHeight > 0.4) {
          px.rect(x0 + ext, bootTop, bw + 1, 1, rampLight(bootCol, 0.22), bootPart, 0);
          // one clean garter/cuff join above boot — attached, no floating mid-thigh straps
          if (highCut && D.female) px.rect(x0, bootTop - 1, bw, 1, rampDark(bootCol, 0.15), PART.DETAIL, F_NOSHADE);
        }
      } else {
        px.rect(x0 + ext, yBot, L.legW + 1, 1, rampDark(legCol, 0.15), bootPart, 0);
        if (t.claws || t.covering === 'scales') px.put(x0 + (side < 0 ? -1 : L.legW), yBot, [236, 230, 214], PART.DETAIL, F_NOSHADE);
      }
      if (style === 'plate') px.put(x0 + (side < 0 ? 0 : L.legW - 1), Math.round((yTop + yBot) / 2), rampLight(P.metal, 0.35), PART.DETAIL, F_NOSHADE);
      if (t.plateSegments && style === 'plate') {
        // segmented cuisses / greaves + knee cop
        const knee = Math.round((yTop + yBot) / 2);
        for (let y = yTop + 1; y < yBot - 1; y += 3) if (Math.abs(y - knee) > 1) px.rect(x0, y, L.legW, 1, rampDark(P.metal, 0.3), PART.DETAIL, F_NOSHADE);
        px.rect(x0, knee - 1, L.legW, 3, rampLight(P.metal, 0.12), part, 0);
        px.put(x0 + (side < 0 ? 0 : L.legW - 1), knee, rampLight(P.metal, 0.45), PART.DETAIL, F_NOSHADE);
      }
    });
  }
  function drawSpectralLower(D, L) {
    const px = D.px, P = D.P, t = D.t, fr = D.fr;
    const top = L.yLegTop - 1;
    const len = L.legH + 1;
    const col = t.outfit.style === 'none' ? lighten(P.skin, 0.1) : P.outfit;
    const wTop = L.hipW + 2;
    const r = makeRng(D.v.markSeed + 31);
    const tendrils = 3 + (r() * 2 | 0);
    for (let y = top; y < top + len; y++) {
      const tt = (y - top) / len;
      const w = Math.max(2, Math.round(wTop * (1 - tt * 0.55)));
      const sway = Math.round(Math.sin(tt * 3 + fr.i * 1.6) * tt * 1.5);
      px.span(CX + sway, y, w, col, PART.SKIRT, F_TRANS);
    }
    // tattered tendril ends
    for (let k = 0; k < tendrils; k++) {
      const x = Math.round(CX - wTop * 0.3 + (wTop * 0.6) * (k / Math.max(1, tendrils - 1)));
      const extra = r.int(1, 4);
      for (let e = 0; e < extra; e++) px.put(x + (e % 2 ? Math.sign(x - CX) : 0) + ((fr.i + k) % 2 ? 1 : 0), top + len + e, col, PART.SKIRT, F_TRANS);
    }
    // tear gaps
    if (t.tattered) for (let k = 0; k < 3; k++) px.clear(CX - 2 + r.int(-2, 4), top + len - 1 - r.int(0, 2));
  }
  function drawTorso(D, L) {
    const px = D.px, P = D.P, t = D.t, v = D.v;
    const style = t.outfit.style;
    const skel = t.bodyPlan === 'skeletal';
    const top = L.yTorsoTop, H = L.torsoH;
    const spectral = t.bodyPlan === 'spectral';
    const trans = spectral ? F_TRANS : 0;
    let base = P.outfit;
    if (style === 'plate') base = t.darkTorso ? P.outfit : P.metal;
    if (style === 'mail' || style === 'tabard') base = rampDark(P.metal, 0.08);
    if (['none', 'furs'].includes(style) || (style === 'rags' && false)) base = P.skin;
    if (skel) {
      // ribcage + spine
      const ribRows = Math.round(H * 0.55);
      for (let r = 0; r < H; r++) {
        const y = top + r;
        const w = torsoWidthAt(L, r) - 2;
        if (r < ribRows) {
          if (r % 2 === 0) px.span(CX, y, Math.max(3, w - Math.floor(r / 3)), P.skin, PART.TORSO, trans);
          else px.span(CX, y, Math.max(3, w - 2 - Math.floor(r / 3)), [44, 36, 40], PART.BODY2, F_NOSHADE | trans);
        }
        px.span(CX, y, 2, rampDark(P.skin, 0.08), PART.NECK, trans);
      }
      const pelvisY = top + H - 2;
      px.span(CX, pelvisY, L.hipW - 2, P.skin, PART.BELT, trans);
      px.span(CX, pelvisY + 1, L.hipW - 4, rampDark(P.skin, 0.15), PART.BELT, trans);
      if (style === 'robe' || style === 'rags' || style === 'cloak') {
        // tattered robe from the waist down + shoulder mantle
        for (let y = top + ribRows; y < L.ground - 1; y++) {
          const w = L.hipW + Math.round((y - top - ribRows) * 0.35);
          px.span(CX, y, w, P.outfit, PART.SKIRT, trans);
        }
        for (let x = CX - L.hipW; x < CX + L.hipW + 4; x += 2) px.clear(x, L.ground - 2);
        px.span(CX, top, L.shoulderW + 2, P.outfit, PART.MANTLE, trans);
        px.span(CX, top + 1, L.shoulderW, P.outfit, PART.MANTLE, trans);
        px.put(CX - 1, top + 1, P.trim, PART.DETAIL, F_NOSHADE); px.put(CX, top + 1, P.trim, PART.DETAIL, F_NOSHADE);
      }
      if (style === 'plate' || style === 'mail') {
        px.span(CX, pelvisY - 1, L.hipW, P.leather, PART.BELT, 0);
      }
      return;
    }
    for (let r = 0; r < H; r++) {
      const y = top + r;
      px.span(CX, y, torsoWidthAt(L, r), base, PART.TORSO, trans);
    }
    const waistY = top + Math.round(H * 0.6);
    const beltY = waistY;
    // skin textures on bare torsos
    if (base === P.skin) {
      textureCovering(D, PART.TORSO, CX - L.shoulderW, top, CX + L.shoulderW, top + H);
      if (t.covering === 'skin' || t.covering === 'scales' || t.covering === 'fur') {
        const belly = t.covering === 'skin' ? rampDark(P.skin, 0.1) : P.belly;
        if (t.covering !== 'skin') for (let y = top + 2; y < top + H - 1; y++) px.span(CX, y, Math.max(2, L.waistW - 4), belly, PART.BODY2, trans);
        else { px.put(CX - 2, top + 3, belly, PART.DETAIL, F_NOSHADE); px.put(CX + 1, top + 3, belly, PART.DETAIL, F_NOSHADE); px.put(CX - 1, top + 5, belly, PART.DETAIL, F_NOSHADE); px.put(CX, top + 5, belly, PART.DETAIL, F_NOSHADE); }
      }
    }
    if (style === 'plate') {
      px.rect(CX - 1, top + 1, 2, H - 3, t.darkTorso ? rampLight(P.outfit, 0.15) : rampLight(P.metal, 0.22), PART.DETAIL, F_NOSHADE | trans);
      px.rect(CX - 1, top + 1, 1, H - 3, t.darkTorso ? rampLight(P.outfit, 0.25) : rampLight(P.metal, 0.35), PART.DETAIL, F_NOSHADE | trans);
      px.span(CX, beltY, L.waistW, P.leather, PART.BELT, trans);
      px.put(CX, beltY, P.trim, PART.DETAIL, F_NOSHADE);
      // faulds
      for (let y = beltY + 1; y < top + H; y++) px.span(CX, y, L.hipW, rampDark(P.metal, 0.12), PART.SKIRT, trans);
      if (t.outfit.symbol !== 'none') drawSymbol(px, t.outfit.symbol, CX, top + 3, P.trim, 0);
      if (t.tabard) {
        // surcoat over the plate (preset holy knights): long panel with trimmed edges + big sigil
        const tc = hexToRgb(t.tabard.color), tt = hexToRgb(t.tabard.trim || t.palette.trim);
        const tw = Math.max(4, even(L.shoulderW * 0.7));
        const bottom = top + H + Math.round(L.legH * 0.55);
        for (let y = top + 1; y < bottom; y++) px.span(CX, y, tw + (y > top + H ? 0 : 0), tc, PART.TAB, trans);
        for (let y = top + 1; y < bottom; y++) { px.put(CX - tw / 2, y, tt, PART.DETAIL, F_NOSHADE); px.put(CX + tw / 2 - 1, y, tt, PART.DETAIL, F_NOSHADE); }
        px.span(CX, bottom - 1, tw, tt, PART.DETAIL, F_NOSHADE);
        px.span(CX, beltY, tw, P.leather, PART.BELT, trans);
        px.put(CX, beltY, tt, PART.DETAIL, F_NOSHADE);
        const sc = hexToRgb(t.tabard.symbolColor || t.palette.trim);
        const sy = top + Math.round(H * 0.35);
        if ((t.tabard.symbol || 'holy') === 'holy') {
          // large cross: 3 wide arm, 6 tall
          for (let y = sy - 2; y <= sy + 3; y++) px.put(CX - 1, y, sc, PART.DETAIL, F_NOSHADE), px.put(CX, y, sc, PART.DETAIL, F_NOSHADE);
          px.span(CX, sy, Math.min(tw - 2, 6), sc, PART.DETAIL, F_NOSHADE);
        } else drawSymbol(px, t.tabard.symbol, CX, sy, sc, 0);
      }
    } else if (style === 'mail' || style === 'tabard') {
      for (let y = top; y < top + H; y++) for (let x = CX - L.shoulderW; x < CX + L.shoulderW; x++) if (px.partAt(x, y) === PART.TORSO && (x + y) % 2 === 0) px.put(x, y, rampDark(P.metal, 0.3), PART.TORSO, trans);
      if (style === 'mail') {
        for (let y = beltY; y < top + H + Math.round(L.legH * 0.35); y++) px.span(CX, y, L.hipW + (y > top + H ? 1 : 0), P.outfit, PART.SKIRT, trans);
        for (let y = top + 1; y < beltY; y++) px.span(CX, y, Math.max(2, L.waistW - 4), P.outfit, PART.TAB, trans);
      } else {
        const tw = Math.max(4, even(L.shoulderW * 0.55));
        for (let y = top; y < top + H + Math.round(L.legH * 0.6); y++) px.span(CX, y, tw, P.outfit, PART.TAB, trans);
        for (let y = top; y < top + H + Math.round(L.legH * 0.6); y++) { px.put(CX - tw / 2, y, P.trim, PART.DETAIL, F_NOSHADE); px.put(CX + tw / 2 - 1, y, P.trim, PART.DETAIL, F_NOSHADE); }
        drawSymbol(px, t.outfit.symbol === 'none' ? 'holy' : t.outfit.symbol, CX, top + Math.round(H * 0.35), P.trim, 0);
      }
      px.span(CX, beltY, L.waistW, P.leather, PART.BELT, trans);
    } else if (style === 'robe') {
      // V neck
      px.put(CX - 1, top, P.skin, PART.DETAIL, 0); px.put(CX, top, P.skin, PART.DETAIL, 0); px.put(CX, top + 1, P.skin, PART.DETAIL, 0);
      if (!spectral) {
        for (let y = beltY; y <= L.ground - 1; y++) {
          const w = L.hipW + 1 + Math.round((y - beltY) * 0.32);
          px.span(CX, y, w, P.outfit, PART.SKIRT, trans);
        }
        if (D.level >= 5 || v.trim) px.span(CX, L.ground - 1, L.hipW + 1 + Math.round((L.ground - 1 - beltY) * 0.32), P.trim, PART.DETAIL, F_NOSHADE);
        px.rect(CX, beltY + 1, 1, L.ground - beltY - 2, rampDark(P.outfit, 0.25), PART.DETAIL, F_NOSHADE);
        // feet peeking out
        px.put(CX - 3, L.ground, P.boot, PART.BOOT_L, 0); px.put(CX - 2, L.ground, P.boot, PART.BOOT_L, 0);
        px.put(CX + 1, L.ground, P.boot, PART.BOOT_R, 0); px.put(CX + 2, L.ground, P.boot, PART.BOOT_R, 0);
      }
      if (v.trim !== 1 || D.level >= 8) for (let y = top + 2; y < beltY; y++) px.put(CX, y, P.trim, PART.DETAIL, F_NOSHADE | trans);
      px.span(CX, beltY, L.waistW, P.outfit2, PART.BELT, trans);
      if (v.belt === 2) { px.put(CX + 1, beltY + 1, P.outfit2, PART.DETAIL, 0); px.put(CX + 1, beltY + 2, P.outfit2, PART.DETAIL, 0); }
      if (t.outfit.symbol !== 'none' && D.level >= 3) drawSymbol(px, t.outfit.symbol, CX - (L.shoulderW >= 12 ? 3 : 0), top + 3, P.trim, t.handGlow ? F_GLOW : 0);
    } else if (style === 'leather' || style === 'cloak') {
      for (let y = beltY; y < top + H + Math.round(L.legH * 0.3); y++) px.span(CX, y, L.hipW + 1, P.outfit, PART.SKIRT, trans);
      for (let k = 0; k < H - 1; k++) px.put(CX - L.shoulderW / 2 + 1 + Math.round(k * (L.shoulderW - 2) / H), top + k, rampDark(P.outfit, 0.35), PART.DETAIL, F_NOSHADE | trans);
      px.span(CX, beltY, L.waistW, P.leather, PART.BELT, trans);
      px.put(CX, beltY, P.trim, PART.DETAIL, F_NOSHADE);
      px.put(CX - 1, top, rampDark(P.skin, 0.1), PART.DETAIL, 0); px.put(CX, top, rampDark(P.skin, 0.1), PART.DETAIL, 0);
    } else if (style === 'furs') {
      for (let y = beltY; y < top + H + Math.round(L.legH * 0.3); y++) px.span(CX, y, L.hipW, P.outfit2, PART.SKIRT, trans);
      px.span(CX, beltY, L.waistW, P.leather, PART.BELT, trans);
    } else if (style === 'gi') {
      for (let k = 0; k < Math.round(H * 0.45); k++) { px.put(CX - 1 - Math.floor(k / 2) + (k > 3 ? 1 : 0), top + k, P.skin, PART.DETAIL, 0); }
      px.span(CX, beltY, L.waistW, [30, 26, 30], PART.BELT, trans);
      for (let y = beltY + 1; y < top + H + 1; y++) px.span(CX, y, L.hipW + 1, P.outfit, PART.SKIRT, trans);
    } else if (style === 'dress') {
      px.span(CX, top, Math.max(2, L.shoulderW - 6), P.skin, PART.DETAIL, 0);
      px.span(CX, top + 1, 2, P.skin, PART.DETAIL, 0);
      px.span(CX, beltY, L.waistW, P.trim, PART.BELT, F_NOSHADE);
      const hem = t.thighs ? L.yLegTop + Math.round(L.legH * 0.25) : L.ground - 1;
      for (let y = beltY + 1; y <= hem; y++) {
        const w = L.hipW + Math.round((y - beltY) * (t.thighs ? 0.25 : 0.45));
        px.span(CX, y, w, P.outfit, PART.SKIRT, trans);
      }
      for (let y = beltY + 2; y <= hem; y += 1) if ((y - beltY) % 3 !== 0) px.put(CX - 2, y, rampDark(P.outfit, 0.3), PART.DETAIL, F_NOSHADE);
    } else if (style === 'rags') {
      const r = makeRng(D.v.markSeed + 7);
      for (let y = beltY; y < top + H + Math.round(L.legH * 0.4); y++) px.span(CX, y, L.hipW + 1, P.outfit, PART.SKIRT, trans);
      const hemY = top + H + Math.round(L.legH * 0.4) - 1;
      for (let x = CX - L.hipW / 2; x < CX + L.hipW / 2 + 1; x++) if (r.chance(0.5)) px.clear(x, hemY);
      for (let k = 0; k < 3; k++) px.put(CX + r.int(-L.shoulderW / 2 + 1, L.shoulderW / 2 - 2), top + r.int(1, H - 2), P.skin, PART.DETAIL, 0);
      px.span(CX, beltY, L.waistW, P.leather, PART.BELT, trans);
    } else if (style === 'none' && t.covering === 'skin' && D.spec.isMonster) {
      for (let y = beltY + 2; y < top + H + 2; y++) px.span(CX, y, L.hipW, [92, 70, 48], PART.SKIRT, trans);
    }
    if (D.female && ['plate', 'mail', 'leather', 'robe', 'dress', 'gi', 'tabard'].includes(style)) {
      const by = top + Math.round(H * 0.32);
      px.put(CX - 2, by, rampDark(base, 0.25), PART.DETAIL, F_NOSHADE | trans); px.put(CX + 1, by, rampDark(base, 0.25), PART.DETAIL, F_NOSHADE | trans);
    }
    // amulet
    const amulet = t.items.find((i) => i.type === 'amulet');
    if (amulet) {
      const ac = hexToRgb(amulet.color);
      px.put(CX - 2, top, P.trim, PART.DETAIL, F_NOSHADE); px.put(CX + 1, top, P.trim, PART.DETAIL, F_NOSHADE);
      px.put(CX - 1, top + 1, P.trim, PART.DETAIL, F_NOSHADE); px.put(CX, top + 1, P.trim, PART.DETAIL, F_NOSHADE);
      px.put(CX - 1, top + 2, ac, PART.DETAIL, amulet.glow ? F_GLOW : F_NOSHADE); px.put(CX, top + 2, rampDark(ac, 0.2), PART.DETAIL, amulet.glow ? F_GLOW : F_NOSHADE);
    }
    if (D.level >= 10 && style !== 'none') px.put(CX - 1, beltY, P.glow, PART.DETAIL, F_GLOW);
    // pauldrons / mantle
    if (style === 'plate' || (style === 'mail' && v.pauldron)) {
      [-1, 1].forEach((side) => {
        const x = side < 0 ? CX - L.shoulderW / 2 - 0.5 : CX + L.shoulderW / 2 - 0.5;
        const rx = L.armW / 2 + 1.5 + (v.pauldron === 2 ? 0.5 : 0);
        px.ball(x + 0.5 + side * 0.5, top + 1.6, rx, 2.2, P.metal, side < 0 ? PART.PAUL_L : PART.PAUL_R, trans);
        if (D.level >= 15) px.put(x + side, top + 1, P.glow, PART.DETAIL, F_GLOW);
      });
    }
    if (style === 'furs') {
      const r = makeRng(D.v.markSeed + 3);
      for (let y = top - 1; y < top + 3; y++) {
        const w = L.shoulderW + 4 - (y - top + 1);
        for (let x = Math.round(CX - w / 2); x < CX + w / 2; x++) {
          const c = (x + y) % 2 ? P.outfit : rampLight(P.outfit, 0.15);
          if (y === top + 2 && r.chance(0.5)) continue;
          px.put(x, y, c, PART.MANTLE, F_NOSHADE | trans);
        }
      }
    }
  }

  // ---------------------------------------------------------------- items
  function itemFlags(item) { return item && item.glow ? F_GLOW : 0; }
  function drawWeapon(D, item, hx, hy, side, L) {
    const px = D.px, v = D.v;
    const c = hexToRgb(item.color), acc = hexToRgb(item.accent || '#d8b04a');
    const hi = rampLight(c, 0.35), dk = rampDark(c, 0.3);
    const wood = [112, 78, 46];
    const gf = itemFlags(item);
    const bl = clamp(Math.round(L.torsoH * (D.t.longBlade ? 1.45 : 0.85) + v.bladeLen + (L.s > 1.1 ? 2 : 0) + (D.t.longBlade ? 6 : 0)), 6, D.t.longBlade ? 34 : 17);
    const P = PART.ITEM;
    const x = hx;
    switch (item.type) {
      case 'sword': case 'greatsword': case 'scimitar': {
        const wide = item.type === 'greatsword';
        const tipDown = !!D.tipDown; // resting pose: tip on the floor, hilt in the hand
        px.rect(x, tipDown ? hy : hy, 1, tipDown ? 1 : 2, [70, 44, 30], P, F_NOSHADE);
        px.rect(x - 1 - (wide ? 1 : 0), tipDown ? hy + 1 : hy - 1, 3 + (wide ? 2 : 0), 1, acc, P, F_NOSHADE);
        // tip-up: never crop the tip — length fits remaining headroom above the grip
        const len = tipDown ? Math.min(bl + 1, Math.max(5, L.ground - hy - 1)) : Math.min(wide ? bl + 2 : bl, Math.max(4, hy - 2));
        for (let k = 0; k < len; k++) {
          const y = tipDown ? hy + 2 + k : hy - 2 - k;
          const curve = item.type === 'scimitar' ? Math.round(Math.pow(k / Math.max(1, len), 2) * 2) * side : 0;
          px.put(x + curve, y, k === len - 1 ? hi : hi, P, F_NOSHADE | (gf && k % 3 === 0 ? F_GLOW : 0));
          if (k < len - 1 || wide) px.put(x + curve - side, y, k === len - 1 ? c : dk, P, F_NOSHADE | gf);
          if (wide && k < len - 1) px.put(x + curve + side, y, c, P, F_NOSHADE);
        }
        if (gf) for (let k = 2; k < len; k += 3) px.put(x, tipDown ? hy + 2 + k : hy - 2 - k, acc, P, F_GLOW);
        px.put(x, tipDown ? hy - 1 : hy + 2, acc, P, F_NOSHADE);
        break;
      }
      case 'dagger': case 'sickle': {
        px.rect(x, hy, 1, 1, [70, 44, 30], P, F_NOSHADE);
        px.rect(x - 1, hy - 1, 3, 1, acc, P, F_NOSHADE);
        for (let k = 0; k < 4; k++) px.put(x + (item.type === 'sickle' && k > 1 ? -side * (k - 1) : 0), hy - 2 - k, k === 3 ? c : hi, P, F_NOSHADE | gf);
        break;
      }
      case 'axe': {
        px.rect(x, hy - bl + 1, 1, bl + 3, wood, P, F_NOSHADE);
        const top = hy - bl + 1;
        for (let r = 0; r < 5; r++) {
          const w = r === 0 || r === 4 ? 2 : 3 + (r === 2 ? 1 : 0);
          for (let k = 1; k <= w; k++) px.put(x + side * k, top + r, k === w ? hi : c, P, F_NOSHADE | gf);
        }
        break;
      }
      case 'staff': case 'spear': case 'trident': case 'scythe': case 'banner': {
        const top = Math.max(1, L.yHeadTop - 3);
        const bottom = Math.min(GRID - 2, hy + Math.round(L.legH * 0.8));
        px.rect(x, top, 1, bottom - top + 1, item.type === 'staff' ? wood : rampDark(wood, 0.1), P, F_NOSHADE);
        if (item.type === 'staff') {
          const oc = hexToRgb(item.accent || '#9ad8ff');
          const glowy = item.glow || /crystal|orb|gem|star/i.test(item.name) || D.t.handGlow;
          if (v.emblem % 2 === 0) { px.ball(x + 0.5, top - 1, 1.8, 1.8, oc, PART.ORB, glowy ? F_GLOW : 0); }
          else { px.put(x, top - 1, oc, PART.ORB, glowy ? F_GLOW : 0); px.put(x - side, top - 2, wood, P, F_NOSHADE); px.put(x - side * 2, top - 1, wood, P, F_NOSHADE); px.put(x - side * 2, top, wood, P, F_NOSHADE); }
          px.put(x, top + 2, acc, P, F_NOSHADE);
        } else if (item.type === 'spear') {
          px.put(x, top - 1, hi, P, F_NOSHADE | gf); px.put(x, top - 2, hi, P, F_NOSHADE | gf); px.put(x - 1, top, c, P, F_NOSHADE); px.put(x + 1, top, c, P, F_NOSHADE); px.put(x, top - 3, c, P, F_NOSHADE | gf);
        } else if (item.type === 'trident') {
          px.rect(x - 2, top, 5, 1, c, P, F_NOSHADE);
          [-2, 0, 2].forEach((d) => { px.put(x + d, top - 1, hi, P, F_NOSHADE | gf); px.put(x + d, top - 2, hi, P, F_NOSHADE | gf); });
        } else if (item.type === 'scythe') {
          const dir = side < 0 ? 1 : -1;
          for (let k = 0; k < 7; k++) px.put(x + dir * (k + 1), top + Math.round(Math.pow(k / 6, 2) * 3), k > 4 ? c : hi, P, F_NOSHADE | gf);
          for (let k = 0; k < 5; k++) px.put(x + dir * (k + 1), top + 1 + Math.round(Math.pow(k / 6, 2) * 3), dk, P, F_NOSHADE);
        } else {
          const dir = side < 0 ? -1 : 1;
          px.rect(dir < 0 ? x - 5 : x + 1, top, 5, 6, hexToRgb(item.color), P, 0);
          px.put(dir < 0 ? x - 3 : x + 3, top + 2, acc, P, F_NOSHADE);
        }
        break;
      }
      case 'wand': {
        for (let k = 0; k < 5; k++) px.put(x - side * Math.floor(k / 2) * 0, hy - k, wood, P, F_NOSHADE);
        px.put(x, hy - 5, acc, PART.ORB, F_GLOW);
        break;
      }
      case 'bow': case 'crossbow': {
        if (item.type === 'crossbow') {
          px.rect(x - 3, hy, 7, 1, wood, P, F_NOSHADE);
          px.rect(x - 3, hy - 1, 1, 3, c, P, F_NOSHADE); px.rect(x + 3, hy - 1, 1, 3, c, P, F_NOSHADE);
          break;
        }
        const h = Math.round(L.torsoH * 1.1);
        for (let k = -Math.floor(h / 2); k <= Math.floor(h / 2); k++) {
          const bulge = Math.round((1 - Math.pow(k / (h / 2), 2)) * 2.2);
          px.put(x + side * bulge, hy + k, c, P, F_NOSHADE | gf);
          px.put(x, hy + k, [230, 226, 214], PART.DETAIL, F_NOSHADE);
        }
        break;
      }
      case 'mace': case 'hammer': case 'flail': {
        const len = item.type === 'flail' ? 4 : Math.round(bl * 0.75);
        px.rect(x, hy - len + 1, 1, len + 2, wood, P, F_NOSHADE);
        const top = hy - len;
        if (item.type === 'hammer') { px.rect(x - 2, top - 2, 5, 3, c, P, 0); px.put(x - 2, top - 2, hi, P, F_NOSHADE); }
        else if (item.type === 'mace') { px.ball(x + 0.5, top - 0.5, 1.8, 1.8, c, P, gf); px.put(x - 2, top - 1, dk, P, F_NOSHADE); px.put(x + 2, top - 1, dk, P, F_NOSHADE); px.put(x, top - 3, dk, P, F_NOSHADE); }
        else { px.put(x - side, top - 1, c, P, F_NOSHADE); px.put(x - side * 2, top - 2, c, P, F_NOSHADE); px.ball(x - side * 3 + 0.5, top - 3.5, 1.6, 1.6, c, P, gf); }
        break;
      }
      case 'whip': {
        for (let k = 0; k < 10; k++) px.put(x + Math.round(Math.sin(k * 0.9 + D.fr.i) * 1.5) + side * Math.floor(k / 3), hy + 1 + k, [90, 60, 40], P, F_NOSHADE);
        break;
      }
      case 'claws': {
        [-1, 0, 1].forEach((d) => px.put(x + d, hy + 2, [236, 230, 214], P, F_NOSHADE));
        break;
      }
      default: drawHeldOther(D, item, hx, hy, side, L);
    }
  }
  function drawHeldOther(D, item, hx, hy, side, L, floating) {
    const px = D.px;
    const c = hexToRgb(item.color), acc = hexToRgb(item.accent || '#ffe8a0');
    const gf = itemFlags(item);
    const bobY = floating ? (D.fr.i % 2 ? -1 : 0) : 0;
    switch (item.type) {
      case 'orb': {
        const oy = hy - (floating ? 4 : 2) + bobY;
        px.ball(hx + 0.5, oy + 0.5, 2.3, 2.3, c, PART.ORB, gf || F_GLOW, 1, 0.4);
        px.put(hx - 1, oy - 1, lighten(acc, 0.5), PART.DETAIL, F_GLOW);
        if (/glass|crystal|mirror/i.test(item.name)) px.put(hx + 1, oy + 1, [230, 250, 255], PART.DETAIL, F_GLOW);
        break;
      }
      case 'crystal': {
        const oy = hy - 3 + bobY;
        px.poly([[hx + 0.5, oy - 3], [hx + 2.5, oy], [hx + 0.5, oy + 3], [hx - 1.5, oy]], c, PART.ORB, F_GLOW);
        px.put(hx, oy - 1, lighten(c, 0.5), PART.DETAIL, F_GLOW);
        break;
      }
      case 'tome': {
        px.rect(hx - 2, hy - 2, 4, 5, c, PART.ITEM, 0);
        px.rect(hx + (side < 0 ? 1 : -2), hy - 2, 1, 5, [236, 228, 200], PART.DETAIL, F_NOSHADE);
        px.put(hx - 1, hy, acc, PART.DETAIL, gf || F_NOSHADE);
        break;
      }
      case 'lantern': {
        px.put(hx, hy + 1, [60, 50, 40], PART.ITEM, F_NOSHADE);
        px.rect(hx - 1, hy + 2, 3, 4, rampDark(c, 0.2), PART.ITEM, 0);
        px.put(hx, hy + 3, [255, 224, 120], PART.ORB, F_GLOW); px.put(hx, hy + 4, [255, 190, 80], PART.ORB, F_GLOW);
        break;
      }
      case 'skull': {
        px.rect(hx - 1, hy - 3, 3, 3, [226, 218, 196], PART.ITEM, 0);
        px.put(hx - 1, hy - 2, [30, 20, 20], PART.DETAIL, F_NOSHADE); px.put(hx + 1, hy - 2, [30, 20, 20], PART.DETAIL, F_NOSHADE);
        if (gf) { px.put(hx - 1, hy - 2, acc, PART.DETAIL, F_GLOW); px.put(hx + 1, hy - 2, acc, PART.DETAIL, F_GLOW); }
        break;
      }
      case 'horn': {
        px.put(hx, hy, c, PART.ITEM, 0); px.put(hx + 1, hy - 1, c, PART.ITEM, 0); px.put(hx + 2, hy - 1, rampLight(c, 0.2), PART.ITEM, 0); px.put(hx - 1, hy + 1, rampDark(c, 0.2), PART.ITEM, 0);
        break;
      }
      case 'ring': px.put(hx, hy + 1, acc, PART.DETAIL, F_GLOW); break;
      default: {
        px.ball(hx + 0.5, hy - 1.5, 1.8, 1.8, c, PART.ORB, gf);
      }
    }
  }
  function drawShield(D, item, cx, cy, L) {
    const px = D.px, v = D.v;
    const face = hexToRgb(item.color);
    const rim = rampDark(mix(face, D.P.metal, 0.35), 0.25);
    const acc = hexToRgb(item.accent || '#ffe066');
    const nm = String(item.name || '').toLowerCase().split(/[^a-z]+/).flatMap((w) => matchTable(w, MAT)).map((k) => MAT[k]);
    const acc1 = nm[0] && nm[0].glow ? hexToRgb(nm[0].glow) : acc;
    const acc2 = nm[1] && nm[1].glow ? hexToRgb(nm[1].glow) : acc;
    const s = L.s;
    let w = Math.max(5, Math.round(8 * s)), h = Math.max(6, Math.round(10 * s));
    const shape = item.shape || 'heater';
    if (shape === 'buckler') { w = Math.max(4, Math.round(5 * s)); h = w; }
    if (shape === 'tower') { w = Math.max(6, Math.round(8 * s)); h = Math.round(13 * s); }
    const x0 = cx - w / 2, y0 = cy - h / 2;
    const outline = (inset) => {
      const a = x0 + inset, b = x0 + w - inset, top = y0 + inset, bot = y0 + h - inset;
      if (shape === 'round' || shape === 'buckler' || shape === 'spiked') return null;
      if (shape === 'kite') return [[a, top], [b, top], [b, top + (bot - top) * 0.35], [(a + b) / 2, bot], [a, top + (bot - top) * 0.35]];
      if (shape === 'tower') return [[a, top], [b, top], [b, bot - 1], [(a + b) / 2, bot], [a, bot - 1]];
      return [[a, top], [b, top], [b, top + (bot - top) * 0.55], [(a + b) / 2, bot], [a, top + (bot - top) * 0.55]];
    };
    if (!outline(0)) {
      px.ellipse(cx, cy, w / 2, h / 2, rim, PART.SHIELD, 0);
      px.ball(cx, cy, w / 2 - 1, h / 2 - 1, face, PART.SHIELD, 0, 1, 0.22);
      if (shape === 'spiked') [[0, -h / 2 - 1], [0, h / 2], [-w / 2 - 1, 0], [w / 2, 0]].forEach(([dx, dy]) => px.put(cx + dx, cy + dy, rim, PART.DETAIL, F_NOSHADE));
    } else {
      px.poly(outline(0), rim, PART.SHIELD, 0);
      px.poly(outline(1), face, PART.ITEM2, 0);
    }
    // emblem from material words
    const n = String(item.name || '').toLowerCase();
    const ef = item.glow ? F_GLOW : F_NOSHADE;
    const ex = Math.round(cx) - 1, ey = Math.round(cy);
    let drew = false;
    if (/storm|thunder|lightning|tempest|volt/.test(n)) {
      [[1, -3], [0, -2], [-1, -1], [0, -1], [1, -1], [0, 0], [-1, 1], [-1, 2]].forEach(([dx, dy]) => px.put(ex + dx + 1, ey + dy, acc1, PART.DETAIL, ef));
      drew = true;
    }
    if (/vein|blood|root|crack/.test(n)) {
      const vc = drew ? acc2 : acc1;
      [[-2, -2], [-2, -1], [-3, 0], [-2, 1], [-3, 2], [2, -2], [3, -1], [3, 0], [2, 1], [3, 2]].forEach(([dx, dy]) => px.put(ex + dx + 1, ey + dy, vc, PART.DETAIL, ef));
      drew = true;
    }
    if (!drew) {
      if (/flame|fire|ember|blaze|sun/.test(n)) drawSymbol(px, 'flame', ex + 1, ey, acc, ef);
      else if (/frost|ice|snow|winter/.test(n)) drawSymbol(px, 'star', ex + 1, ey, acc, ef);
      else if (/skull|bone|death|grave/.test(n)) drawSymbol(px, 'skull', ex + 1, ey, acc, ef);
      else if (/holy|divine|celestial|dawn/.test(n)) drawSymbol(px, 'holy', ex + 1, ey, acc, ef);
      else if (/void|shadow|abyss|night|eye/.test(n)) drawSymbol(px, 'eye', ex + 1, ey, acc, ef);
      else {
        const e = v.emblem;
        if (e === 0 || e === 3) { px.ball(Math.round(cx) + 0.5, ey + 0.5, 1.4, 1.4, D.P.metal, PART.DETAIL, 0); }
        else if (e === 1 || e === 4) { for (let k = -2; k <= 2; k++) px.put(ex + 1 + k, ey - Math.abs(k) + 1, acc, PART.DETAIL, F_NOSHADE); }
        else { for (let k = -3; k <= 3; k++) px.put(ex + 1, ey + k, acc, PART.DETAIL, F_NOSHADE); }
      }
    }
  }

  // ---------------------------------------------------------------- humanoid arms / head
  function armColors(D) {
    const t = D.t, P = D.P, style = t.outfit.style;
    if (t.bodyPlan === 'skeletal') return { arm: P.skin, cuff: null, hand: P.skin };
    if (style === 'plate') return { arm: t.darkTorso ? P.outfit : P.metal, cuff: rampDark(P.metal, 0.15), hand: rampDark(P.metal, 0.1) };
    if (style === 'mail' || style === 'tabard') return { arm: rampDark(P.metal, 0.12), cuff: P.leather, hand: P.skin };
    if (style === 'robe' || style === 'cloak') return { arm: P.outfit, cuff: rampDark(P.outfit, 0.15), hand: P.skin, flare: true };
    if (style === 'leather') return { arm: D.v.sleeve ? P.outfit : P.skin, cuff: P.leather, hand: P.skin };
    if (style === 'gi') return { arm: P.outfit, cuff: null, hand: P.skin };
    return { arm: P.skin, cuff: null, hand: P.skin };
  }
  function drawArms(D, L, hold, skip) {
    const px = D.px, t = D.t, P = D.P, fr = D.fr;
    if (skip) {
      // arms drawn by drawArmsOverhead / drawArmsReady; still report resting hand positions
      const hands = {};
      [-1, 1].forEach((side) => { const x0 = side < 0 ? CX - L.shoulderW / 2 - L.armW + 1 : CX + L.shoulderW / 2 - 1; hands[side] = { x: x0, y: L.yTorsoTop + 1 + L.armLen, x0, w: L.armW }; });
      return hands;
    }
    // Paint-blueprint ready stance: bent elbows, shoulder→elbow→wrist joints (not stiff vertical sticks)
    if (D.readyPose) return drawArmsReady(D, L, hold);
    const cols = armColors(D);
    const trans = t.bodyPlan === 'spectral' ? F_TRANS : 0;
    const hands = {};
    [-1, 1].forEach((side) => {
      const part = side < 0 ? PART.ARM_L : PART.ARM_R;
      const x0 = side < 0 ? CX - L.shoulderW / 2 - L.armW + 1 : CX + L.shoulderW / 2 - 1;
      const raised = hold[side] ? true : false;
      const swing = fr.step * side;
      const len = raised ? Math.round(L.torsoH * 0.6) : L.armLen + (swing > 0 ? -1 : 0);
      const y0 = L.yTorsoTop + 1;
      px.rect(x0, y0, L.armW, len, cols.arm, part, trans);
      if (t.bodyPlan === 'skeletal') px.rect(x0 - (side < 0 ? 1 : 0), y0 + Math.round(len / 2), L.armW + 1, 1, rampLight(P.skin, 0.1), part, trans);
      if (cols.flare && !raised) px.rect(x0 - (side < 0 ? 1 : 0), y0 + len - 2, L.armW + 1, 2, cols.arm, part, trans);
      if (cols.cuff) px.rect(x0, y0 + len - 1, L.armW, 1, cols.cuff, part, trans);
      if (t.plateSegments && t.outfit.style === 'plate') for (let y = y0 + 3; y < y0 + len - 1; y += 2) px.rect(x0, y, L.armW, 1, rampDark(P.metal, 0.3), PART.DETAIL, F_NOSHADE);
      const handW = L.armW >= 3 ? 2 : L.armW;
      const hx = side < 0 ? x0 : x0 + L.armW - handW;
      const hy = y0 + len;
      px.rect(hx, hy, handW, L.heavy ? 3 : 2, cols.hand, side < 0 ? PART.HAND_L : PART.HAND_R, trans);
      if (t.claws && !hold[side]) [0, 1].forEach((k) => px.put(hx + k * (handW - 1) + (k ? 1 : -1) * 0, hy + 2 + (L.heavy ? 1 : 0), [236, 230, 214], PART.DETAIL, F_NOSHADE));
      hands[side] = { x: hx + (handW > 1 ? (side < 0 ? 0 : 1) : 0), y: hy, x0, w: L.armW };
    });
    if (t.extraArms > 0) {
      [-1, 1].forEach((side) => {
        const sx = side < 0 ? CX - L.waistW / 2 : CX + L.waistW / 2 - 1;
        const sy = L.yTorsoTop + Math.round(L.torsoH * 0.45);
        const ex = sx + side * 3, ey = sy + 3;
        px.line(sx, sy, ex, ey - 1, rampDark(cols.arm === P.skin ? P.skin : P.skin2, 0.05), side < 0 ? PART.ARM2_L : PART.ARM2_R, trans);
        px.line(sx, sy + 1, ex, ey, rampDark(P.skin, 0.15), side < 0 ? PART.ARM2_L : PART.ARM2_R, trans);
        px.put(ex + side, ey + 1, [236, 230, 214], PART.DETAIL, F_NOSHADE);
      });
    }
    return hands;
  }
  // Ready / fighting grip: articulated arms with bent elbows (Paint proportion blueprint).
  // Weapon hand (-1) holds tip-UP sword; free hand hangs with a soft elbow bend.
  function drawArmsReady(D, L, hold) {
    const px = D.px, fr = D.fr;
    const cols = armColors(D);
    const hands = {};
    const sy = L.yTorsoTop + 1;
    const thick = Math.min(3, Math.max(2, L.armW)); // slender joint volume — lean, not chunky
    const stroke = (x0, y0, x1, y1, col, part) => {
      px.line(x0, y0, x1, y1, col, part, 0);
      if (thick >= 2) px.line(x0 + 1, y0, x1 + 1, y1, rampDark(col, 0.08), part, 0);
      if (thick >= 3) px.line(x0 - 1, y0, x1 - 1, y1, rampLight(col, 0.06), part, 0);
    };
    {
      const side = -1;
      const part = PART.ARM_L;
      const sx = CX - L.shoulderW / 2;
      const elbowX = sx - Math.max(3, Math.round(L.shoulderW * 0.5) + thick);
      const elbowY = sy + Math.round(L.torsoH * 0.3) + (fr.step < 0 ? 1 : 0);
      const wx = elbowX + 1;
      const wy = sy + Math.round(L.torsoH * (D.t.longBlade ? 0.58 : 0.5));
      stroke(sx, sy, elbowX, elbowY, cols.arm, part);
      stroke(elbowX, elbowY, wx, wy, cols.arm, part);
      px.rect(elbowX - 1, elbowY - 1, thick + 1, thick, rampLight(cols.arm, 0.1), part, 0);
      const handW = Math.max(2, thick);
      px.rect(wx - 1, wy, handW + 1, Math.max(2, Math.round(thick * 0.9)), cols.hand, PART.HAND_L, 0);
      hands[side] = { x: wx, y: wy, x0: wx - 1, w: handW };
    }
    {
      const side = 1;
      const part = PART.ARM_R;
      const sx = CX + L.shoulderW / 2 - 1;
      const elbowX = sx + Math.max(3, Math.round(L.shoulderW * 0.4) + thick);
      const elbowY = sy + Math.round(L.torsoH * 0.35) + (fr.step > 0 ? 1 : 0);
      const wx = elbowX - 1;
      const wy = L.yLegTop - 1 + (fr.step > 0 ? 1 : 0);
      stroke(sx, sy, elbowX, elbowY, cols.arm, part);
      stroke(elbowX, elbowY, wx, wy, cols.arm, part);
      px.rect(elbowX - 1, elbowY - 1, thick + 1, thick, rampLight(cols.arm, 0.1), part, 0);
      const handW = Math.max(2, thick);
      px.rect(wx - 1, wy, handW, Math.max(2, Math.round(thick * 0.9)), cols.hand, PART.HAND_R, 0);
      hands[side] = { x: wx, y: wy, x0: wx - 1, w: handW };
    }
    return hands;
  }
  // Arms raised overhead, both hands together above the head holding the weapon (presets, e.g. Mortacia's
  // sword held high). Returns the grip point.
  function drawArmsOverhead(D, L) {
    const px = D.px;
    const cols = armColors(D);
    const lift = D.fr.i === 2 ? 1 : 0;
    const gx = CX, gy = L.yHeadTop - 2 - lift;
    const fore = rampDark(cols.arm, 0.1);
    [-1, 1].forEach((side) => {
      const part = side < 0 ? PART.ARM_L : PART.ARM_R;
      const sx = side < 0 ? CX - L.shoulderW / 2 : CX + L.shoulderW / 2 - 1;
      const sy = L.yTorsoTop + 1;
      // elbow well outside the head so the arms frame it (as in the drawing)
      const ex = side < 0 ? CX - L.headW / 2 - 3 : CX + L.headW / 2 + 2, ey = L.yHeadTop + 1 - lift;
      px.line(sx, sy, ex, ey, cols.arm, part, 0);
      px.line(sx - side, sy, ex - side, ey, cols.arm, part, 0);
      px.line(ex, ey, gx + (side < 0 ? -1 : 1), gy + 1, fore, part, 0);
      px.line(ex + side * 0 - side, ey - 1, gx + (side < 0 ? -1 : 1), gy, fore, part, 0);
    });
    px.rect(gx - 1, gy, 3, 2, cols.hand, PART.HAND_L, 0);
    return { x: gx, y: gy };
  }
  // Large rounded pauldrons with a raised flange (presets, e.g. Suzerain's plate).
  function drawPauldrons(D, L) {
    const px = D.px, P = D.P;
    // Slim knight spaulders (readable, not bulky hunk)
    const r = Math.max(2.6, L.armW * 1.05 + (L.heavy ? 0.3 : 0));
    [-1, 1].forEach((side) => {
      const part = side < 0 ? PART.PAUL_L : PART.PAUL_R;
      const cx = side < 0 ? CX - L.shoulderW / 2 - 0.5 : CX + L.shoulderW / 2 - 0.5;
      const cy = L.yTorsoTop + 1.5;
      px.ellipse(cx, cy, r + 0.5, r, P.metal, part, 0);
      px.ellipse(cx - side * 0.5, cy - 0.8, r - 1.2, r - 1.5, rampLight(P.metal, 0.22), part, 0);
      // flange rising toward the neck
      px.rect(Math.round(cx - side * (r - 1)) - (side < 0 ? 0 : 0), Math.round(cy - r - 1), 1, 2, rampLight(P.metal, 0.35), PART.DETAIL, F_NOSHADE);
      px.span(Math.round(cx), Math.round(cy + r - 0.5), Math.round(r * 2), rampDark(P.metal, 0.3), PART.DETAIL, F_NOSHADE);
    });
  }
  function headRowInset(L, r) {
    if (r === 0) return L.headW >= 8 ? 2 : 1;
    if (r === 1) return L.headW >= 8 ? 1 : 0;
    if (r === L.headH - 1) return L.headW >= 8 ? 2 : 1;
    if (r === L.headH - 2) return 1;
    return 0;
  }
  function drawEars(D, L, eyeY) {
    const px = D.px, t = D.t, P = D.P;
    const ec = t.head === 'human' || t.head === 'demon' ? P.skin : P.skin;
    const hw = L.headW / 2;
    [-1, 1].forEach((side) => {
      const bx = side < 0 ? CX - hw - 1 : CX + hw;
      const p = (dx, dy, c) => px.put(bx + side * dx, eyeY + dy, c || ec, PART.EAR, 0);
      if (t.ears === 'pointed') { p(0, 0); p(0, -1); p(1, -1); p(1, -2); }
      else if (t.ears === 'long') { p(0, 0); p(0, -1); p(1, -1); p(1, -2); p(2, -2); p(2, -3); p(3, -4, rampLight(ec, 0.1)); }
      else if (t.ears === 'fin') { p(0, -1); p(0, 0); p(0, 1); p(1, -2, P.skin2); p(1, -1, P.skin2); p(1, 0, P.skin2); }
      else if (t.ears === 'human' && t.head === 'human') { p(0, 0); }
      if (D.v.earring && t.ears !== 'none' && t.ears !== 'animal' && t.head === 'human') px.put(bx, eyeY + 2, [232, 190, 70], PART.DETAIL, F_NOSHADE);
    });
    if (t.ears === 'animal') {
      [-1, 1].forEach((side) => {
        const bx = side < 0 ? CX - hw + 1 : CX + hw - 2;
        for (let r = 0; r < 3; r++) {
          const w = 3 - r;
          const xs = side < 0 ? bx : bx + (3 - w) - 1;
          px.rect(side < 0 ? bx + (r > 0 ? 0 : 0) : bx - (w - 2), L.yHeadTop - 1 - r, w, 1, P.skin, PART.EAR, 0);
          if (r === 0) px.put(side < 0 ? bx + 1 : bx, L.yHeadTop - 1, mix(P.skin, [230, 150, 150], 0.35), PART.DETAIL, F_NOSHADE);
          void xs;
        }
      });
    }
  }
  function drawEyes(D, L, eyeY, shadowed) {
    const px = D.px, t = D.t, P = D.P;
    const glow = t.eyes.glow || shadowed;
    const col = glow ? P.eye : (luminance(P.eye) > 140 ? [26, 20, 32] : P.eye);
    const fl = glow ? F_GLOW : F_NOSHADE;
    const spread = (L.headW >= 10 ? 1 : 0) + (L.headW >= 10 ? D.v.eyeSpread : 0);
    const style = t.eyes.style;
    if (style === 'cyclops' || t.eyes.count === 1) {
      px.put(CX - 1, eyeY, [240, 236, 220], PART.EYE, F_NOSHADE); px.put(CX, eyeY, col, PART.EYE, fl);
      px.put(CX - 1, eyeY - 1, rampDark(P.skin, 0.3), PART.DETAIL, F_NOSHADE); px.put(CX, eyeY - 1, rampDark(P.skin, 0.3), PART.DETAIL, F_NOSHADE);
      return;
    }
    const xl = CX - 2 - spread, xr = CX + 1 + spread;
    if (style === 'compound') {
      [xl - 1, xr].forEach((x) => { px.rect(x, eyeY - 1, 2, 2, col, PART.EYE, fl); px.put(x, eyeY - 1, lighten(col, 0.5), PART.DETAIL, fl); });
    } else if (style === 'hollow') {
      [xl, xr].forEach((x) => { px.put(x, eyeY, [18, 12, 16], PART.EYE, F_NOSHADE); px.put(x, eyeY - 1, [18, 12, 16], PART.EYE, F_NOSHADE); if (glow) px.put(x, eyeY, col, PART.EYE, F_GLOW); });
    } else {
      px.put(xl, eyeY, col, PART.EYE, fl); px.put(xr, eyeY, col, PART.EYE, fl);
      if (style === 'slit' && L.headW >= 8) { px.put(xl - 1, eyeY, rampLight(col, 0.1), PART.EYE, fl); px.put(xr + 1, eyeY, rampLight(col, 0.1), PART.EYE, fl); px.put(xl, eyeY, [20, 10, 10], PART.EYE, F_NOSHADE); px.put(xr, eyeY, [20, 10, 10], PART.EYE, F_NOSHADE); }
      // gesture/heroic: single dark dots, no white sclera (that reads as big cartoon eyes)
      if (!glow && !shadowed && L.headW >= 8 && t.head === 'human' && !(D.t.heroic || D.t.gesture)) { px.put(xl + 1, eyeY, [236, 232, 226], PART.EYE, F_NOSHADE); px.put(xr - 1, eyeY, [236, 232, 226], PART.EYE, F_NOSHADE); px.put(xl + 1, eyeY, col, PART.EYE, fl); px.put(xl, eyeY, [236, 232, 226], PART.EYE, F_NOSHADE); px.put(xr, eyeY, col, PART.EYE, fl); px.put(xr - 1, eyeY, [236, 232, 226], PART.EYE, F_NOSHADE); }
    }
    for (let k = 2; k < Math.min(t.eyes.count, 8); k++) {
      const ex = CX - 1 + ((k % 2) ? 1 : 0) + (k >= 4 ? (k % 2 ? 2 : -2) : 0);
      const ey = eyeY - 2 - (k >= 4 ? 0 : 0) - Math.floor((k - 2) / 4);
      px.put(ex, ey, col, PART.EYE, fl);
    }
  }
  function drawHead(D, L) {
    const px = D.px, t = D.t, P = D.P, v = D.v;
    const top = L.yHeadTop, hh = L.headH, hw = L.headW;
    const trans = t.bodyPlan === 'spectral' ? F_TRANS : 0;
    const eyeY = top + Math.round(hh * 0.55) - (t.head === 'beast' || t.head === 'reptile' ? 1 : 0);
    const headCol = t.head === 'skull' ? P.skin : P.skin;
    if (t.mane) px.ellipse(CX, top + hh / 2, hw / 2 + 2.5, hh / 2 + 2, rampDark(P.hair, 0.05), PART.HAIRBACK, 0);
    // neck
    px.rect(CX - 1, L.yHeadBottom, 2, 2, rampDark(P.skin, 0.2), PART.NECK, trans);
    for (let r = 0; r < hh; r++) {
      let inset = headRowInset(L, r);
      if (t.head === 'skull' && r >= hh - 3) inset += 1;
      if (t.head === 'beast' && r >= hh - 3) inset = Math.max(inset, Math.floor(hw / 2) - 3 + (r - (hh - 3)));
      if (t.head === 'reptile' && r >= hh - 3) inset = Math.max(inset, Math.floor(hw / 2) - 3);
      if (t.head === 'bird' && r >= hh - 2) inset += 1;
      px.span(CX, top + r, hw - inset * 2, headCol, PART.HEAD, trans);
    }
    if (t.covering !== 'skin' && t.head !== 'skull' && t.covering !== 'bone') textureCovering(D, PART.HEAD, CX - hw, top, CX + hw, top + hh);
    if (t.head === 'skull') {
      const sy = eyeY;
      [CX - 3, CX + 1].forEach((x) => { px.rect(x, sy - 1, 2, 2, [26, 18, 22], PART.EYE, F_NOSHADE); });
      if (t.eyes.glow) { px.put(CX - 3, sy, P.eye, PART.EYE, F_GLOW); px.put(CX + 2, sy, P.eye, PART.EYE, F_GLOW); }
      px.put(CX - 1, sy + 1, [40, 30, 32], PART.DETAIL, F_NOSHADE); px.put(CX, sy + 1, [40, 30, 32], PART.DETAIL, F_NOSHADE);
      for (let x = CX - 2; x < CX + 2; x++) px.put(x, top + hh - 2, (x % 2) ? [40, 30, 32] : lighten(P.skin, 0.15), PART.DETAIL, F_NOSHADE);
    } else if (t.head === 'beast') {
      const my = top + hh - 3;
      for (let r = 0; r < 3; r++) px.span(CX, my + r, 4 - (r === 2 ? 2 : 0), mix(P.skin, [236, 224, 200], 0.4), PART.SNOUT, trans);
      px.put(CX - 1, my, [24, 16, 18], PART.DETAIL, F_NOSHADE); px.put(CX, my, [24, 16, 18], PART.DETAIL, F_NOSHADE);
      if (t.fangs || D.spec.isMonster) { px.put(CX - 2, my + 2, [244, 240, 228], PART.DETAIL, F_NOSHADE); px.put(CX + 1, my + 2, [244, 240, 228], PART.DETAIL, F_NOSHADE); }
      if (t.tusks) { px.put(CX - 3, my + 1, [244, 240, 228], PART.DETAIL, F_NOSHADE); px.put(CX + 2, my + 1, [244, 240, 228], PART.DETAIL, F_NOSHADE); }
      drawEyes(D, L, eyeY, false);
    } else if (t.head === 'reptile') {
      const my = top + hh - 3;
      for (let r = 0; r < 3; r++) px.span(CX, my + r, 6 - r * 2 + 2, rampLight(P.skin, 0.06), PART.SNOUT, trans);
      px.put(CX - 2, my, [24, 16, 18], PART.DETAIL, F_NOSHADE); px.put(CX + 1, my, [24, 16, 18], PART.DETAIL, F_NOSHADE);
      px.span(CX, eyeY - 1, hw - 2, rampDark(P.skin, 0.2), PART.DETAIL, F_NOSHADE);
      if (!t.eyes.style || t.eyes.style === 'normal') t.eyes.style = 'slit';
      drawEyes(D, L, eyeY, false);
    } else if (t.head === 'insect') {
      drawEyes(D, L, eyeY, false);
      px.put(CX - 2, top + hh, rampDark(P.skin, 0.3), PART.DETAIL, F_NOSHADE); px.put(CX + 1, top + hh, rampDark(P.skin, 0.3), PART.DETAIL, F_NOSHADE);
      [-1, 1].forEach((side) => { px.line(CX + side * 1 - (side > 0 ? 1 : 0), top, CX + side * 4, top - 4, rampDark(P.skin, 0.2), PART.DETAIL, F_NOSHADE); px.put(CX + side * 5 - (side > 0 ? 0 : 0), top - 5, P.glow, PART.DETAIL, F_NOSHADE); });
    } else if (t.head === 'bird') {
      drawEyes(D, L, eyeY - 1, false);
      const by = eyeY + 1;
      px.span(CX, by, 4, [228, 164, 52], PART.SNOUT, 0); px.span(CX, by + 1, 2, [228, 164, 52], PART.SNOUT, 0); px.put(CX, by + 2, [150, 90, 30], PART.SNOUT, 0);
      px.put(CX - 1, top - 1, P.hair, PART.HAIR, 0); px.put(CX, top - 2, P.hair, PART.HAIR, 0); px.put(CX + 1, top - 1, P.hair, PART.HAIR, 0);
    } else if (t.head === 'eyeless') {
      px.span(CX, eyeY, hw - 4, P.eye, PART.EYE, F_GLOW);
    } else {
      drawEyes(D, L, eyeY, false);
      // brows / mouth
      if (!D.female && L.headW >= 8) { px.put(CX - 3 - (L.headW >= 10 ? 1 : 0), eyeY - 1, rampDark(P.skin, 0.28), PART.DETAIL, F_NOSHADE); px.put(CX + 2 + (L.headW >= 10 ? 1 : 0), eyeY - 1, rampDark(P.skin, 0.28), PART.DETAIL, F_NOSHADE); }
      const my = Math.min(top + hh - 2, eyeY + 2);
      const mc = D.female
        ? ((t.heroic || t.gesture) ? mix(P.skin, [160, 70, 80], 0.22) : mix(P.skin, [180, 60, 70], 0.45))
        : rampDark(P.skin, 0.28);
      if (t.heroic || t.gesture) px.put(CX, my, mc, PART.DETAIL, F_NOSHADE); // single soft mouth pixel
      else if (v.mouth !== 1) { px.put(CX - 1, my, mc, PART.DETAIL, F_NOSHADE); px.put(CX, my, mc, PART.DETAIL, F_NOSHADE); } else px.put(CX, my, mc, PART.DETAIL, F_NOSHADE);
      if (t.fangs) { px.put(CX - 1, my + 1, [244, 240, 236], PART.DETAIL, F_NOSHADE); px.put(CX, my + 1, [244, 240, 236], PART.DETAIL, F_NOSHADE); }
      if (t.tusks) { px.put(CX - 3, my, [244, 240, 228], PART.DETAIL, F_NOSHADE); px.put(CX + 2, my, [244, 240, 228], PART.DETAIL, F_NOSHADE); px.put(CX - 3, my - 1, [244, 240, 228], PART.DETAIL, F_NOSHADE); px.put(CX + 2, my - 1, [244, 240, 228], PART.DETAIL, F_NOSHADE); }
      if (v.facePaint && D.spec.isMonster !== undefined) { px.put(CX - 3, eyeY + 1, P.glow, PART.DETAIL, F_NOSHADE); px.put(CX + 2, eyeY + 1, P.glow, PART.DETAIL, F_NOSHADE); }
      if (v.scar && !D.female) { px.put(CX + 2, eyeY - 2, rampDark(P.skin, 0.35), PART.DETAIL, F_NOSHADE); px.put(CX + 3, eyeY + 1, rampDark(P.skin, 0.35), PART.DETAIL, F_NOSHADE); }
    }
    if (t.tentacles > 0 && t.bodyPlan !== 'ooze') {
      const n = Math.min(4, t.tentacles);
      for (let k = 0; k < n; k++) {
        const x = CX - 2 + Math.round(k * 3 / Math.max(1, n - 1));
        for (let s = 0; s < 5; s++) px.put(x + ((s + k + D.fr.i) % 3 === 0 ? (k < n / 2 ? -1 : 1) : 0), top + hh - 1 + s, rampDark(P.skin2, 0.05), PART.DETAIL, F_NOSHADE);
      }
    }
    if (t.beard) {
      const by = eyeY + 1;
      for (let y = by; y < top + hh + 3; y++) {
        const w = Math.max(2, hw - 2 - Math.max(0, (y - (top + hh)) * 2));
        px.span(CX, y, w, P.hair, PART.BEARD, 0);
      }
      px.put(CX - 1, by + 1, rampDark(P.hair, 0.4), PART.DETAIL, F_NOSHADE); px.put(CX, by + 1, rampDark(P.hair, 0.4), PART.DETAIL, F_NOSHADE);
    }
    drawEars(D, L, eyeY);
    return eyeY;
  }
  function drawHairFront(D, L, eyeY) {
    const px = D.px, t = D.t, P = D.P, v = D.v;
    const top = L.yHeadTop, hw = L.headW;
    if (['beast', 'reptile', 'insect', 'skull', 'eyeless', 'bird'].includes(t.head)) return;
    if (t.outfit.helm === 'closed' || t.outfit.hood) return;
    const hc = P.hair;
    const h = t.hair;
    if (h === 'none') { if (t.covering === 'skin') px.put(CX - 2, top + 1, rampLight(P.skin, 0.25), PART.DETAIL, F_NOSHADE); return; }
    if (h === 'snakes') {
      for (let k = 0; k < 5; k++) { const x = CX - hw / 2 + 1 + k * 2; px.put(x, top - 1, P.skin2, PART.HAIR, 0); px.put(x + (k % 2 ? 1 : -1), top - 2, P.skin2, PART.HAIR, 0); px.put(x + (k % 2 ? 1 : -1), top - 3 + (D.fr.i % 2), rampLight(P.skin2, 0.2), PART.HAIR, 0); }
      px.span(CX, top, hw - 2, P.skin2, PART.HAIR, 0);
      return;
    }
    if (h === 'flame') {
      for (let x = CX - hw / 2 + 1; x < CX + hw / 2 - 1; x++) { const ht = 1 + ((x * 7 + D.fr.i * 3) % 3); for (let k = 0; k < ht; k++) px.put(x, top - k, k === ht - 1 ? [255, 220, 90] : [255, 120, 40], PART.HAIR, F_GLOW); }
      return;
    }
    if (h === 'mohawk') {
      for (let y = top - 3; y <= top + 1; y++) px.rect(CX - 1, y, 2, 1, hc, PART.HAIR, 0);
      return;
    }
    const vol = (h === 'long' || h === 'flowing') ? 1 : 0;
    px.span(CX, top - vol, hw - 2, hc, PART.HAIR, 0);
    px.span(CX, top, hw, hc, PART.HAIR, 0);
    px.span(CX, top + 1, hw + (vol ? 2 : 0), hc, PART.HAIR, 0);
    // fringe
    const fr = [[1, 0, 1, 1, 0, 1, 1, 0, 1, 1], [1, 1, 0, 0, 1, 1, 1, 0, 0, 1], [0, 1, 1, 1, 1, 1, 1, 1, 1, 0], [1, 0, 0, 1, 1, 0, 0, 1, 0, 0]][v.fringe];
    for (let k = 0; k < hw; k++) if (fr[k % fr.length]) px.put(CX - hw / 2 + k, top + 2, hc, PART.HAIR, 0);
    const sideLen = vol ? (eyeY - top + 3) : (eyeY - top - 1);
    for (let y = top + 1; y <= top + sideLen; y++) {
      px.put(CX - hw / 2 - (vol ? 1 : 0), y, hc, PART.HAIR, 0);
      px.put(CX + hw / 2 - 1 + (vol ? 1 : 0), y, hc, PART.HAIR, 0);
    }
    if (h === 'topknot') px.ball(CX, top - 2, 1.8, 1.6, hc, PART.HAIR, 0);
    if (h === 'braid') for (let y = L.yHeadBottom; y < L.yHeadBottom + Math.round(L.torsoH * 0.6); y++) px.put(CX + hw / 2 - 1 + (y % 2), y, y % 2 ? hc : rampDark(hc, 0.25), PART.HAIR, F_NOSHADE);
    // highlight
    px.put(CX - 2, top, rampLight(hc, 0.3), PART.DETAIL, F_NOSHADE);
    px.put(CX - 1, top, rampLight(hc, 0.2), PART.DETAIL, F_NOSHADE);
  }
  function drawHeadgear(D, L, eyeY) {
    const px = D.px, t = D.t, P = D.P, v = D.v;
    const top = L.yHeadTop, hw = L.headW, hh = L.headH;
    const helm = t.outfit.helm;
    const crownItem = t.items.find((i) => i.type === 'crown');
    const hoodOn = (t.outfit.hood || helm === 'hood' || helm === 'cowl') && !D.hoodOff;
    if (hoodOn) {
      const hc = t.bodyPlan === 'spectral' ? P.outfit : P.outfit;
      const trans = t.bodyPlan === 'spectral' ? F_TRANS : 0;
      for (let y = top - 2; y <= L.yHeadBottom + 1; y++) {
        const r = y - (top - 2);
        let w = hw + 2;
        if (r === 0) w = hw - 2; else if (r === 1) w = hw;
        px.span(CX, y, w, hc, PART.HOOD, trans);
      }
      if (v.hood) px.span(CX, top - 3, 2, hc, PART.HOOD, trans);
      px.span(CX, L.yTorsoTop, L.shoulderW + 1, hc, PART.HOOD, trans);
      px.span(CX, L.yTorsoTop + 1, L.shoulderW - 1, hc, PART.HOOD, trans);
      const shadeAmt = helm === 'cowl' ? 0.7 : (['skull', 'rune'].includes(t.outfit.symbol) ? 0.55 : (t.outfit.symbol === 'eye' ? 0.42 : 0.3));
      const shade = mix(P.skin, INK, shadeAmt);
      for (let y = top + 2; y <= L.yHeadBottom; y++) {
        const w = hw - 2 - (y === L.yHeadBottom ? 2 : 0);
        px.span(CX, y, w, y < eyeY - 1 ? mix(shade, INK, 0.3) : shade, PART.HEAD, F_NOSHADE | trans);
      }
      px.span(CX, top + 1, hw - 2, rampDark(hc, 0.35), PART.DETAIL, F_NOSHADE | trans);
      drawEyes(D, L, eyeY, t.eyes.glow);
      if (helm === 'cowl') for (let y = eyeY + 1; y <= L.yHeadBottom; y++) px.span(CX, y, hw - 2, P.outfit2, PART.HELM, trans);
      if (helm === 'crown' || crownItem) drawCrown(D, CX, top - 2, hw - 2, crownItem);
      return;
    }
    if (helm === 'closed') {
      for (let y = top - 1; y <= L.yHeadBottom; y++) {
        const r = y - (top - 1);
        const w = r === 0 ? hw - 2 : hw + 1 - (y === L.yHeadBottom ? 2 : 0);
        px.span(CX, y, w, P.metal, PART.HELM, 0);
      }
      px.span(CX, eyeY, hw - 1, [24, 20, 28], PART.DETAIL, F_NOSHADE);
      if (t.eyes.glow) { px.put(CX - 2, eyeY, P.eye, PART.DETAIL, F_GLOW); px.put(CX + 1, eyeY, P.eye, PART.DETAIL, F_GLOW); }
      px.rect(CX - 1, top - 1, 1, eyeY - top + 1, rampLight(P.metal, 0.3), PART.DETAIL, F_NOSHADE);
      for (let y = eyeY + 2; y < L.yHeadBottom; y += 2) { px.put(CX - 2, y, rampDark(P.metal, 0.4), PART.DETAIL, F_NOSHADE); px.put(CX + 1, y, rampDark(P.metal, 0.4), PART.DETAIL, F_NOSHADE); }
      if (t.plume || v.plume) {
        const pc = t.plume ? hexToRgb(t.plume) : P.capeC;
        const dir = v.tailDir;
        px.rect(CX - 1, top - 4, 2, 3, pc, PART.HAIR, 0);
        px.put(CX - 1 + dir * 2, top - 4, pc, PART.HAIR, 0); px.put(CX + dir * 3, top - 3, pc, PART.HAIR, 0); px.put(CX + dir * 3, top - 2, rampDark(pc, 0.2), PART.HAIR, 0);
        px.put(CX - 1 + (dir > 0 ? 1 : 0) + dir, top - 5, rampLight(pc, 0.2), PART.HAIR, 0);
      }
      if (t.horns !== 'none') drawHornsAt(D, CX, top, hw / 2 + 1, t.horns, L.s);
      return;
    }
    if (helm === 'open' || helm === 'horned') {
      for (let y = top - 1; y <= top + 2; y++) px.span(CX, y, y === top - 1 ? hw - 2 : hw + 2, P.metal, PART.HELM, 0);
      px.rect(CX - 1, top + 3, 1, Math.max(1, eyeY - top - 1), rampDark(P.metal, 0.05), PART.HELM, 0);
      px.rect(CX - hw / 2 - 1, top + 3, 1, 2, P.metal, PART.HELM, 0); px.rect(CX + hw / 2, top + 3, 1, 2, P.metal, PART.HELM, 0);
      px.span(CX, top - 1, 2, rampLight(P.metal, 0.3), PART.DETAIL, F_NOSHADE);
      if (t.helmTrim) px.span(CX, top + 2, hw + 2, hexToRgb(t.helmTrim), PART.DETAIL, F_NOSHADE);
      if (t.plume) {
        // tall knightly crest (preset Suzerain: red plume like his original art), sweeping back
        const pc = hexToRgb(t.plume), dir = v.tailDir || 1;
        px.rect(CX - 1, top - 6, 2, 5, pc, PART.HAIR, 0);
        px.put(CX - 1, top - 7, rampLight(pc, 0.2), PART.HAIR, 0);
        for (let k = 1; k <= 4; k++) px.put(CX - 1 + dir * (k + 1), top - 7 + Math.floor(k * 0.8), k % 2 ? pc : rampDark(pc, 0.18), PART.HAIR, 0);
      }
      if (helm === 'horned') { const keep = P.hornC; P.hornC = [226, 214, 186]; drawHornsAt(D, CX, top, hw / 2 + 1, 'curved', L.s); P.hornC = keep; }
      return;
    }
    if (helm === 'crown' || crownItem) drawCrown(D, CX, top, hw, crownItem);
    else if (helm === 'circlet') {
      px.span(CX, top + 2, hw, hexToRgb(t.circletColor || '#d8b04a'), PART.DETAIL, F_NOSHADE);
      px.put(CX - 1, top + 2, P.glow, PART.DETAIL, F_GLOW);
    }
  }
  function drawCrown(D, cx, top, w, item) {
    const px = D.px;
    const gold = item ? hexToRgb(item.color) : [232, 184, 62];
    const gem = item ? hexToRgb(item.accent) : D.P.glow;
    px.span(cx, top, w, gold, PART.HELM, 0);
    for (let k = 0; k < w; k += 2) px.put(cx - w / 2 + k, top - 1, rampLight(gold, 0.2), PART.HELM, 0);
    px.put(cx - 1, top - 2, rampLight(gold, 0.3), PART.HELM, 0);
    px.put(cx - 1, top, gem, PART.DETAIL, F_GLOW);
  }

  // ---------------------------------------------------------------- body plans
  function drawHumanoid(D, opts) {
    const o = opts || {};
    const L = o.layout || layoutHumanoid(D);
    D.L = L;
    const t = D.t, P = D.P, px = D.px, v = D.v;
    const items = t.items || [];
    const weapon = items.find((i) => i.slot === 'weapon' && i.type !== 'shield');
    const shield = items.find((i) => i.type === 'shield');
    const holdTypes = ['orb', 'crystal', 'tome', 'lantern', 'skull', 'horn', 'banner', 'wand', 'staff', 'sword', 'dagger', 'axe', 'mace', 'hammer', 'spear', 'scythe', 'trident', 'bow', 'flail', 'whip', 'sickle', 'scimitar', 'greatsword', 'crossbow'];
    const others = items.filter((i) => i !== weapon && i !== shield && holdTypes.includes(i.type));
    const hold = { '-1': null, '1': null };
    if (weapon && weapon.type !== 'claws') hold[-1] = weapon;
    if (shield) hold[1] = shield;
    const floaters = [];
    others.forEach((it) => {
      if (!hold[-1]) hold[-1] = it;
      else if (!hold[1]) hold[1] = it;
      else floaters.push(it);
    });
    // tip-UP default. 'ready'/'rest'/'side' = fighting grip (raised weapon hand); 'overhead' = two-handed high.
    const readyPose = t.weaponPose === 'ready' || t.weaponPose === 'rest' || t.weaponPose === 'side';
    const raised = {
      '-1': (readyPose || (!t.weaponPose || t.weaponPose === 'default')) && !!hold[-1] && !['whip', 'lantern', 'claws'].includes(hold[-1].type),
      '1': !!hold[1] && hold[1].type === 'shield' ? false : (!!hold[1] && !['whip', 'lantern'].includes(hold[1].type) && !readyPose)
    };
    D.tipDown = false;
    D.readyPose = readyPose;
    if (readyPose) D.fightStance = true;
    // back layers
    if (t.wings !== 'none' && !o.noWings) {
      const hybrid = /(kin|spawn|born|blood|folk|touched)\b/i.test(D.spec.race) || t.bodyPlan !== 'draconic';
      const ay = L.yTorsoTop + 3;
      // span/height fitted so triangular peaks stay on-canvas and membranes reach toward the shins
      const maxSpan = Math.min(Math.floor(CX - 2), Math.floor((GRID - 1 - CX) - 2));
      const span = Math.min(maxSpan, Math.round((L.shoulderW / 2 + (hybrid ? 8 : 11)) * v.wingSpread * (L.s > 1.1 ? 1.1 : 1) * (t.wingScale ? Math.min(1.25, t.wingScale) : 1)));
      const hangWant = t.wingHang || (t.raggedWings ? 0.55 : 0.32);
      const ankleY = L.ground - 1; // membranes reach the ankles
      const handAimY = L.yTorsoTop + Math.round(L.torsoH * 0.5);
      let height = Math.round((L.torsoH * (t.wingHang ? 1.55 : 1.15) + 5) * (t.wingScale || 1));
      // peak at ay - height*1.05 + flap; keep tip >= 3 so outline never hits y=0
      height = Math.min(height, Math.max(6, Math.floor((ay - 5) / 1.05)));
      // enough height budget so hang can reach ankles
      height = Math.max(height, Math.max(8, Math.floor((ankleY - ay) * 0.85)));
      height = Math.min(height, Math.max(6, ankleY - ay));
      D.ankleY = ankleY;
      D.handAimY = handAimY;
      drawWings(D, CX, ay, span, height, t.wings);
      // statuesque/Mortacia: clean black outline only — no ragged cuts (those read as folded membrane)
      if (t.raggedWings && !t.statuesque) raggedWingEdges(D);
    }
    if (t.outfit.cape && t.bodyPlan !== 'spectral') drawCape(D, L);
    if (t.tail !== 'none' && !o.noTail) {
      const len = Math.round(9 * L.s);
      drawTail(D, CX + v.tailDir * 2, L.yLegTop + (t.bodyPlan === 'spectral' ? 2 : 1), v.tailDir, len, t.tail === 'none' ? 'thin' : t.tail, Math.min(GRID - 2, L.ground + (L.floating ? 1 : 0)));
    }
    if (t.bodyPlan === 'insectoid') {
      px.ellipse(CX, L.yLegTop + 2, L.hipW / 2 + 3, 4.5, P.skin2, PART.ABDOMEN, 0);
      for (let x = CX - L.hipW / 2 - 2; x < CX + L.hipW / 2 + 3; x++) px.put(x, L.yLegTop + 3, rampDark(P.skin2, 0.25), PART.ABDOMEN, F_NOSHADE);
    }
    drawHairBack(D, L);
    if (!o.noLegs) {
      if (t.bodyPlan === 'spectral') drawSpectralLower(D, L);
      else drawLegs(D, L);
    }
    drawTorso(D, L);
    if (t.garment) drawGarment(D, L);
    if (t.spikes) {
      [-1, 1].forEach((side) => {
        const sx = side < 0 ? CX - L.shoulderW / 2 - 1 : CX + L.shoulderW / 2;
        px.put(sx, L.yTorsoTop - 1, P.hornC, PART.HORN, 0); px.put(sx + side, L.yTorsoTop - 2, rampLight(P.hornC, 0.2), PART.HORN, 0);
        px.put(sx + side * 2, L.yTorsoTop + Math.round(L.torsoH * 0.5), P.hornC, PART.HORN, 0);
      });
    }
    const overhead = t.weaponPose === 'overhead' && hold[-1] && hold[-1].type !== 'shield';
    let grip = null;
    if (overhead) { raised[-1] = false; raised[1] = false; }
    const hands = drawArms(D, L, overhead ? { '-1': null, '1': null } : raised, overhead);
    if (t.pauldrons) drawPauldrons(D, L);
    // held items behind head? draw now (weapon), shield after head
    if (hold[-1] && !overhead) {
      const h = hands[-1];
      if (hold[-1].type === 'shield') drawShield(D, hold[-1], h.x0 + L.armW / 2 - 1, h.y - 1, L);
      else drawWeapon(D, hold[-1], h.x, h.y, -1, L);
    }
    const eyeY = drawHead(D, L);
    drawHairFront(D, L, eyeY);
    const hooded = t.outfit.hood || t.outfit.helm === 'hood' || t.outfit.helm === 'cowl';
    drawHeadgear(D, L, eyeY);
    drawAccessory(D, L);
    if (overhead) grip = drawArmsOverhead(D, L);
    if (overhead && grip) {
      // blade raised diagonally from the two-handed grip above the head (as in the drawing), clamped to the grid
      const wpn = hold[-1];
      const bladeC = hexToRgb((wpn && wpn.color) || '#d8dce4');
      const hiltC = hexToRgb((wpn && wpn.accent) || '#7a7a82');
      const len = Math.max(6, Math.min(grip.y - 3, GRID - 3 - grip.x, Math.round(L.torsoH * 1.1)));
      const bx = grip.x + 1, by = grip.y - 1;
      for (let k = 1; k <= len; k++) {
        const x = bx + k, y = by - k;
        px.put(x, y, bladeC, PART.ITEM, 0);
        px.put(x - 1, y, k < len ? rampLight(bladeC, 0.18) : bladeC, PART.ITEM, 0); // bright edge
        if (k > 1 && k < len - 1) px.put(x, y + 1, rampDark(bladeC, 0.32), PART.ITEM, 0); // shaded edge
      }
      // cross-guard (perpendicular), grip and pommel
      for (let k = -2; k <= 2; k++) px.put(bx + 1 + k, by - 1 + k, hiltC, PART.ITEM, 0);
      px.put(grip.x - 1, grip.y + 2, hiltC, PART.ITEM, 0);
      px.rect(grip.x - 1, grip.y, 3, 2, armColors(D).hand, PART.HAND_L, 0);
    }
    if (hooded && Math.abs(luminance(P.hornC) - luminance(P.outfit)) < 50) P.hornC = [226, 214, 186];
    if (t.horns !== 'none' && t.outfit.helm !== 'closed') drawHornsAt(D, CX, L.yHeadTop - (hooded ? 1 : 0), L.headW / 2 + (hooded ? 1 : 0), t.horns, L.s);
    if (hold[1]) {
      const h = hands[1];
      if (hold[1].type === 'shield') drawShield(D, hold[1], h.x0 + L.armW / 2 + 1, h.y - 1, L);
      else drawWeapon(D, hold[1], h.x, h.y, 1, L);
    }
    floaters.forEach((it, k) => drawHeldOther(D, it, CX + (k % 2 ? -1 : 1) * (L.shoulderW / 2 + 4), L.yTorsoTop - 1, 1, L, true));
    const ring = items.find((i) => i.type === 'ring');
    if (ring) px.put(hands[1].x, hands[1].y + 1, hexToRgb(ring.accent), PART.DETAIL, F_GLOW);
    if (t.handGlow) {
      [-1, 1].forEach((side) => {
        if (hold[side]) return;
        const h = hands[side];
        const r = D.fr.rng;
        px.put(h.x + side * 0, h.y + 2, P.glow, PART.DETAIL, F_GLOW | F_NOOUTLINE);
        px.put(h.x + side * 1 + (r.chance(0.5) ? 1 : -1), h.y + 3 + r.int(0, 1), P.glow, PART.DETAIL, F_GLOW | F_NOOUTLINE);
        if (D.fr.i % 2) px.put(h.x + side, h.y - 1, lighten(P.glow, 0.3), PART.DETAIL, F_GLOW | F_NOOUTLINE);
      });
    }
    if (t.halo || D.level >= 40) {
      const hy = L.yHeadTop - (t.horns !== 'none' || hooded ? 5 : 3);
      for (let x = CX - L.headW / 2; x < CX + L.headW / 2; x++) px.put(x, hy, [255, 236, 150], PART.DETAIL, F_GLOW | F_NOOUTLINE);
      px.put(CX - L.headW / 2 - 1, hy + 1, [255, 236, 150], PART.DETAIL, F_GLOW | F_NOOUTLINE); px.put(CX + L.headW / 2, hy + 1, [255, 236, 150], PART.DETAIL, F_GLOW | F_NOOUTLINE);
    }
    if (D.view === 'back') backView(D, L, o);
    return L;
  }
  // Back view (billboards seen from behind): face -> back of head (hair / helm), front details on the torso
  // removed, long hair / cape / wings drawn over the back. Weapon stays on the same canvas side (hand lock).
  function backView(D, L, o) {
    const px = D.px, P = D.P, t = D.t;
    const helm = t.outfit.helm;
    const hooded = t.outfit.hood || helm === 'hood' || helm === 'cowl';
    const headCol = (helm === 'closed' || helm === 'open' || helm === 'horned') ? P.metal
      : hooded ? P.outfit : (t.hair !== 'none' && t.bodyPlan !== 'skeletal' ? P.hair : rampDark(P.skin, 0.08));
    const headParts = [PART.HEAD, PART.EYE, PART.DETAIL, PART.SNOUT, PART.BEARD, PART.HAIR, PART.HELM, PART.HOOD];
    for (let y = L.yHeadTop - 1; y <= L.yHeadBottom; y++) for (let x = 0; x < px.w; x++) {
      if (Math.abs(x + 0.5 - CX) > L.headW / 2 + 1) continue;
      if (headParts.includes(px.partAt(x, y))) px.put(x, y, (y + x) % 5 === 0 ? rampDark(headCol, 0.12) : headCol, PART.HEAD, 0);
    }
    // torso front details (symbols, buttons, sashes) -> neighbouring base colour
    for (let y = L.yTorsoTop; y < L.yLegTop; y++) {
      let last = null;
      for (let x = 0; x < px.w; x++) {
        const part = px.partAt(x, y);
        if (part === PART.TORSO || part === PART.SKIRT || part === PART.TAB) last = px.colorAt ? px.colorAt(x, y) : null;
        else if (part === PART.DETAIL && last && Math.abs(x + 0.5 - CX) < L.shoulderW / 2) px.put(x, y, last, PART.TORSO, 0);
      }
    }
    if (['long', 'flowing', 'braid'].includes(t.hair) && helm !== 'closed' && !hooded) {
      const len = t.hair === 'flowing' ? Math.round(L.torsoH * 0.95) : Math.round(L.torsoH * 0.5);
      for (let y = L.yHeadBottom - 1; y <= L.yHeadBottom + len; y++) {
        const taper = y > L.yHeadBottom + len - 3 ? 2 : 0;
        px.span(CX, y, L.headW + 2 - taper, (y % 3 === 0) ? rampDark(P.hair, 0.1) : P.hair, PART.HAIRBACK, 0);
      }
    }
    if (t.outfit.cape && t.bodyPlan !== 'spectral') drawCape(D, L);
    if (t.wings !== 'none' && !o.noWings) {
      const v = D.v;
      const hybrid = /(kin|spawn|born|blood|folk|touched)\b/i.test(D.spec.race) || t.bodyPlan !== 'draconic';
      const ay = L.yTorsoTop + 3;
      const maxSpan = Math.min(Math.floor(CX - 2), Math.floor((GRID - 1 - CX) - 2));
      const span = Math.min(maxSpan, Math.round((L.shoulderW / 2 + (hybrid ? 8 : 11)) * v.wingSpread * (L.s > 1.1 ? 1.1 : 1) * (t.wingScale ? Math.min(1.25, t.wingScale) : 1)));
      const hangWant = t.wingHang || (t.raggedWings ? 0.55 : 0.32);
      const ankleY = L.ground - 1;
      const handAimY = L.yTorsoTop + Math.round(L.torsoH * 0.5);
      let height = Math.round((L.torsoH * (t.wingHang ? 1.55 : 1.15) + 5) * (t.wingScale || 1));
      height = Math.min(height, Math.max(6, Math.floor((ay - 5) / 1.05)));
      height = Math.max(height, Math.max(8, Math.floor((ankleY - ay) * 0.85)));
      height = Math.min(height, Math.max(6, ankleY - ay));
      D.ankleY = ankleY;
      D.handAimY = handAimY;
      drawWings(D, CX, ay, span, height, t.wings);
      if (t.raggedWings && !t.statuesque) raggedWingEdges(D);
    }
  }

  // Minimal garments (presets, e.g. Mortacia): bikini top that COVERS the belly, high-cut bottoms,
  // optional butt cape (trails behind so the front view shows bare thighs).
  function drawGarment(D, L) {
    const px = D.px, t = D.t;
    const g = t.garment;
    const col = hexToRgb(g.color || '#8a8a90'), dk = rampDark(col, 0.3), hi = rampLight(col, 0.25);
    const top = L.yTorsoTop;
    const back = D.view === 'back';
    if (g.buttCape) {
      const by = L.yLegTop - 1;
      const capeLen = Math.max(6, Math.round(L.legH * (g.capeLength || 0.85)));
      const capeW = Math.max(3, even(L.hipW + (back ? 1 : 0) - (D.t.statuesque ? 1 : 0)));
      const sway = D.fr.step;
      if (back) {
        for (let y = by; y < by + capeLen; y++) {
          const k = (y - by) / capeLen;
          const w = Math.max(2, Math.round(capeW * (1 - k * 0.25)));
          px.span(CX + Math.round(sway * k * 0.6), y, w, k > 0.8 && (y % 2) ? dk : col, PART.CAPE, 0);
        }
      } else {
        // front: trailing panels at the hips so thighs stay open in the middle
        [-1, 1].forEach((side) => {
          const ox = CX + side * Math.round(L.hipW / 2);
          for (let y = by; y < by + capeLen; y++) {
            const k = (y - by) / capeLen;
            px.put(ox + side * Math.round(k * 2) + Math.round(sway * k), y, k > 0.85 && (y % 2) ? dk : col, PART.CAPE, 0);
            if (k < 0.7) px.put(ox + side * Math.round(k * 2) - side, y, dk, PART.CAPE, 0);
          }
        });
      }
    }
    if (g.top !== false) {
      const bikini = !!(g.bikini || D.t.statuesque);
      if (bikini) {
        // Ink ref: sports-bra / bikini top — thick V straps, cups, ribcage wrap; bare midriff below
        // Slightly narrower chest, a touch more vertical coverage (annotated tweak)
        const cupY = top + Math.max(1, Math.round(L.torsoH * 0.12));
        const cupH = Math.max(3, Math.round(L.torsoH * 0.28));
        const cupW = Math.max(2, Math.round(L.shoulderW / 2) - 2);
        const ribY = cupY + cupH;
        // teardrop / rounded cups with cleavage gap — less wide
        [-1, 1].forEach((side) => {
          const x0 = side < 0 ? CX - cupW - 1 : CX + 1;
          for (let y = cupY; y < cupY + cupH; y++) {
            const tt = (y - cupY) / Math.max(1, cupH - 1);
            const w = Math.max(1, Math.round(cupW * (tt < 0.55 ? 0.7 + tt * 0.4 : 1.05 - tt * 0.45)));
            const xo = side < 0 ? x0 + (cupW - w) : x0;
            px.rect(xo, y, w, 1, col, PART.BELT, 0);
            if (y === cupY) px.put(side < 0 ? xo : xo + w - 1, y, hi, PART.BELT, F_NOSHADE);
          }
        });
        // bare neck: short outer straps from cup outer edge → outer shoulder (no V/collar crowding the neck)
        [-1, 1].forEach((side) => {
          const cupOuterX = side < 0 ? CX - cupW - 1 : CX + cupW;
          const cupTopY = cupY;
          const shX = CX + side * Math.round(L.shoulderW / 2);
          const shY = top + 1;
          for (let i = 0; i <= 5; i++) {
            const u = i / 5;
            const x = Math.round(cupOuterX + (shX - cupOuterX) * u);
            const y = Math.round(cupTopY + (shY - cupTopY) * u);
            // stay away from centerline / neck
            if (Math.abs(x - CX) < Math.max(2, Math.round(L.shoulderW * 0.22))) continue;
            px.put(x, y, dk, PART.DETAIL, F_NOSHADE);
            px.put(x - side, y, col, PART.DETAIL, F_NOSHADE);
          }
        });
        // horizontal ribcage wrap under the cups
        const wrapW = Math.max(4, even(L.shoulderW - 3));
        px.span(CX, ribY, wrapW, col, PART.BELT, 0);
        px.span(CX, ribY + 1, Math.max(2, wrapW - 2), dk, PART.BELT, 0);
        // tiny extra coverage band under rib wrap
        px.span(CX, ribY + 2, Math.max(2, wrapW - 4), col, PART.BELT, 0);
        // bare midriff intentionally left empty down to the bottoms
      } else {
        const cy = top + Math.max(1, Math.round(L.torsoH * 0.12));
        const bellyEnd = L.yLegTop - 2;
        const cw = Math.max(2, Math.round(L.shoulderW / 2) - (D.female ? 0 : 1));
        for (let y = cy; y <= bellyEnd; y++) {
          const tt = (y - cy) / Math.max(1, bellyEnd - cy);
          const half = Math.max(1, Math.round(cw - (tt > 0.55 ? (tt - 0.55) * 1.5 : 0)));
          if (y <= cy + 2 && D.female) {
            px.rect(CX - half - 1, y, half, 1, col, PART.BELT, 0);
            px.rect(CX + 1, y, half, 1, col, PART.BELT, 0);
          } else {
            px.span(CX, y, half * 2, col, PART.BELT, 0);
          }
        }
        [-1, 1].forEach((side) => {
          px.line(CX + side * Math.max(1, cw - 2), cy, CX + side * Math.round(L.shoulderW / 2 - 1), top, dk, PART.DETAIL, F_NOSHADE);
        });
      }
    }
    if (g.bottom !== false) {
      const by = L.yLegTop - 1;
      const bw = Math.max(2, even(L.hipW * (g.highCut ? (D.t.statuesque ? 0.42 : 0.55) : 0.7)));
      px.span(CX, by, bw + 2, dk, PART.BELT, 0);
      px.span(CX, by + 1, bw, col, PART.SKIRT, 0);
      px.span(CX, by + 2, Math.max(2, bw - 2), col, PART.SKIRT, 0);
      if (!g.buttCape) {
        const len = Math.max(3, Math.round(L.legH * (g.length || 0.35)));
        const w = Math.max(2, even(bw * 0.7));
        const sway = D.fr.step;
        for (let y = by + 1; y < by + len; y++) {
          const k = (y - by) / len;
          px.span(CX + Math.round(sway * k), y, w, k > 0.85 && (y % 2) ? dk : col, PART.TAB, 0);
        }
      }
    }
  }

  function drawAccessory(D, L) {
    const px = D.px, P = D.P, t = D.t, v = D.v;
    const style = t.outfit.style;
    if (t.bodyPlan === 'skeletal' && v.acc < 3) return;
    const top = L.yTorsoTop;
    const trans = t.bodyPlan === 'spectral' ? F_TRANS : 0;
    if (v.acc === 1 && style !== 'none') {
      for (let k = 0; k < L.torsoH - 1; k++) px.put(CX + L.shoulderW / 2 - 2 - Math.round(k * (L.shoulderW - 3) / L.torsoH), top + k, P.trim, PART.DETAIL, F_NOSHADE | trans);
    } else if (v.acc === 2) {
      const mc = rampDark(mix(P.outfit, P.capeC, 0.5), 0.1);
      px.span(CX, top, L.shoulderW + 3, mc, PART.MANTLE, trans);
      px.span(CX, top + 1, L.shoulderW + 3, mc, PART.MANTLE, trans);
      px.span(CX, top + 2, L.shoulderW + 1, mc, PART.MANTLE, trans);
      px.put(CX - 1, top + 1, P.trim, PART.DETAIL, F_NOSHADE);
    } else if (v.acc === 3) {
      for (let k = -2; k <= 1; k++) px.put(CX + k, top + 1 + (k === -2 || k === 1 ? 0 : 1), [200, 200, 210], PART.DETAIL, F_NOSHADE);
      px.put(CX - 1, top + 3, P.glow, PART.DETAIL, F_GLOW);
      if (t.bodyPlan === 'spectral') { [-1, 1].forEach((side) => { const x = side < 0 ? CX - L.shoulderW / 2 - L.armW + 1 : CX + L.shoulderW / 2; px.rect(x, top + L.armLen - 1, L.armW, 1, [150, 150, 160], PART.DETAIL, F_NOSHADE); }); }
    } else if (v.acc === 4 && (style === 'robe' || style === 'dress' || t.bodyPlan === 'spectral')) {
      for (let x = CX - L.hipW / 2; x < CX + L.hipW / 2; x += 2) px.put(x, L.yLegTop + 1, P.glow, PART.DETAIL, F_GLOW);
    }
  }
  function drawBeast(D) {
    const t = D.t, P = D.P, px = D.px, v = D.v, fr = D.fr;
    const s = clamp(D.s, 0.55, 1.3);
    const heavy = t.build === 'heavy';
    const bodyW = Math.round((19 + (heavy ? 4 : 0)) * s) + v.bodyW;
    const bodyH = Math.round(12 * s);
    const legH = Math.round(8 * s);
    const ground = GRID - 2;
    const bodyCY = ground - legH - bodyH / 2 + 3 + fr.bob;
    const headW = even(10 * s + (heavy ? 1 : 0)), headH = Math.round(9 * s) + 1;
    const headTop = Math.round(bodyCY - bodyH / 2 - headH * 0.55);
    if (t.wings !== 'none') drawWings(D, CX, bodyCY - 3, Math.round(bodyW / 2 + 8 * s), Math.round(14 * s), t.wings);
    if (t.tail !== 'none') {
      const dir = v.tailDir;
      const x0 = CX + dir * (bodyW / 2 - 2), y0 = bodyCY - 2;
      if (t.tail === 'stinger') drawTail(D, x0, y0, dir, Math.round(9 * s), 'stinger', ground);
      else px.curve([[x0, y0], [x0 + dir * 4 * s, y0 - 3 * s], [x0 + dir * 5 * s, y0 - 8 * s - fr.step], [x0 + dir * 3 * s, y0 - 11 * s]], t.tail === 'thick' ? 2 : 1.2, 0.8, P.skin, PART.TAIL, 0);
    }
    const legWd = Math.max(2, Math.round(3 * s));
    // hind legs
    [-1, 1].forEach((side) => {
      const x = side < 0 ? Math.round(CX - bodyW / 2 + 1) : Math.round(CX + bodyW / 2 - 1 - legWd);
      px.rect(x, bodyCY, legWd, ground - 1 - bodyCY, rampDark(P.skin, 0.22), side < 0 ? PART.LEG_BL : PART.LEG_BR, 0);
    });
    px.ball(CX, bodyCY, bodyW / 2, bodyH / 2, P.skin, PART.BODY, 0, 1, 0.18);
    textureCovering(D, PART.BODY, 0, 0, GRID - 1, GRID - 1);
    px.ellipse(CX, bodyCY + 1, bodyW / 5, bodyH / 2 - 1, P.belly, PART.BODY2, 0);
    // front legs
    [-1, 1].forEach((side) => {
      const lift = fr.step === side ? 1 : 0;
      const x = side < 0 ? Math.round(CX - bodyW * 0.22 - legWd + 1) : Math.round(CX + bodyW * 0.22 - 1);
      px.rect(x, bodyCY + 1, legWd, ground - bodyCY - lift, P.skin, side < 0 ? PART.LEG_L : PART.LEG_R, 0);
      px.rect(x - (side < 0 ? 1 : 0), ground - lift, legWd + 1, 1, rampDark(P.skin, 0.1), side < 0 ? PART.BOOT_L : PART.BOOT_R, 0);
      [0, legWd - 1].forEach((dx) => px.put(x + dx, ground - lift, [236, 230, 214], PART.DETAIL, F_NOSHADE));
    });
    if (t.head === 'human') t.head = 'beast';
    const L = { yHeadTop: headTop, headH, headW, yHeadBottom: headTop + headH - 1, s, torsoH: 8, yTorsoTop: headTop + headH, shoulderW: bodyW, armW: 3, legH: 6, ground };
    if (t.mane) px.ellipse(CX, headTop + headH / 2, headW / 2 + 3, headH / 2 + 2.5, rampDark(P.hair, 0.05), PART.HAIRBACK, 0);
    drawHead(D, L);
    if (t.horns !== 'none') drawHornsAt(D, CX, headTop, headW / 2, t.horns, s);
    return { ground };
  }

  function drawSerpent(D) {
    const t = D.t, P = D.P, px = D.px, v = D.v, fr = D.fr;
    const s = clamp(D.s, 0.6, 1.3);
    const coils = [[0, 42.5, 12 * s, 4 * s, PART.COIL1], [v.tailDir, 37.5, 9.5 * s, 3.6 * s, PART.COIL2], [0, 33, 7 * s, 3.2 * s, PART.COIL3]];
    // tail tip curling out of the bottom coil
    px.curve([[CX - v.tailDir * 10 * s, 44], [CX - v.tailDir * 14 * s, 43], [CX - v.tailDir * 16 * s, 40 - fr.step]], 1.5, 0.5, P.skin, PART.TAIL, 0);
    coils.forEach(([dx, cy, rx, ry, part]) => {
      px.ball(CX + dx, cy, rx, ry, P.skin, part, 0, 1, 0.22);
      for (let x = Math.round(CX + dx - rx * 0.35); x <= CX + dx + rx * 0.35; x++) px.put(x, Math.round(cy + ry * 0.55), P.belly, PART.DETAIL, F_NOSHADE);
    });
    textureCovering(D, PART.COIL1, 0, 0, GRID - 1, GRID - 1);
    textureCovering(D, PART.COIL2, 0, 0, GRID - 1, GRID - 1);
    if (t.nagaTorso) {
      const L0 = layoutHumanoid(D);
      const shift = 33 - L0.yLegTop - 1;
      const L = Object.assign({}, L0, { yLegTop: L0.yLegTop + shift, yTorsoTop: L0.yTorsoTop + shift, yHeadTop: L0.yHeadTop + shift, yHeadBottom: L0.yHeadBottom + shift, ground: GRID - 2 });
      drawHumanoid(D, { layout: L, noLegs: true, noTail: true });
      return { ground: GRID - 2 };
    }
    const neckW = Math.max(3, Math.round(4 * s));
    const neckTop = Math.round(33 - 13 * s);
    for (let y = neckTop; y <= 33; y++) {
      const off = Math.round(Math.sin((y - neckTop) / 4 + fr.i * 0.8) * 1.2);
      px.span(CX + off, y, neckW, P.skin, PART.NECK, 0);
      px.span(CX + off, y, Math.max(1, neckW - 2), P.belly, PART.BODY2, 0);
    }
    const cobra = /cobra|naga|asp/i.test(D.spec.race) || v.stance === 1;
    const hw = even(8 * s), hh = Math.round(7 * s);
    const top = neckTop - hh + 2;
    if (cobra) {
      px.ellipse(CX, top + hh * 0.9, hw / 2 + 3, hh * 0.9, rampDark(P.skin, 0.1), PART.HOOD, 0);
      px.put(CX - 3, top + hh, P.glow, PART.DETAIL, F_NOSHADE); px.put(CX + 2, top + hh, P.glow, PART.DETAIL, F_NOSHADE);
    }
    for (let r = 0; r < hh; r++) {
      const w = r === 0 ? hw - 2 : (r >= hh - 2 ? hw - 2 - (r - (hh - 3)) * 2 : hw);
      px.span(CX, top + r, Math.max(2, w), P.skin, PART.HEAD, 0);
    }
    textureCovering(D, PART.HEAD, 0, 0, GRID - 1, GRID - 1);
    const eyeY = top + 2;
    px.put(CX - 3, eyeY, P.eye, PART.EYE, F_GLOW); px.put(CX + 2, eyeY, P.eye, PART.EYE, F_GLOW);
    px.put(CX - 1, top + hh - 2, [24, 14, 14], PART.DETAIL, F_NOSHADE); px.put(CX, top + hh - 2, [24, 14, 14], PART.DETAIL, F_NOSHADE);
    if (fr.i % 2 === 1) { px.put(CX - 1, top + hh, [210, 40, 50], PART.DETAIL, F_NOSHADE); px.put(CX, top + hh, [210, 40, 50], PART.DETAIL, F_NOSHADE); px.put(CX - 2, top + hh + 1, [210, 40, 50], PART.DETAIL, F_NOSHADE); px.put(CX + 1, top + hh + 1, [210, 40, 50], PART.DETAIL, F_NOSHADE); }
    if (t.horns !== 'none') drawHornsAt(D, CX, top, hw / 2, t.horns, s);
    return { ground: GRID - 2 };
  }

  function drawSpider(D) {
    const t = D.t, P = D.P, px = D.px, v = D.v, fr = D.fr;
    const s = clamp(D.s, 0.6, 1.3);
    const ground = GRID - 2;
    const cephCY = ground - 6 * s - 1 + fr.bob;
    const abdCY = cephCY - 8 * s;
    const scorpion = t.tail === 'stinger';
    // abdomen
    px.ball(CX, abdCY, 10 * s, 8 * s, P.skin, PART.ABDOMEN, 0, 1, 0.25);
    const mk = t.markings;
    const mc = t.eyes.glow ? P.glow : [200, 40, 40];
    if (mk === 'stripes') for (let y = Math.round(abdCY - 5 * s); y < abdCY + 6 * s; y += 3) px.span(CX, y, Math.round(10 * s), rampDark(P.skin, 0.35), PART.DETAIL, F_NOSHADE);
    else if (mk === 'runes' || mk === 'veins') { drawSymbol(px, 'rune', CX, Math.round(abdCY), mc, F_GLOW); }
    else if (v.emblem % 2 === 0) { px.put(CX - 1, abdCY - 2, mc, PART.DETAIL, F_NOSHADE); px.put(CX, abdCY - 2, mc, PART.DETAIL, F_NOSHADE); px.put(CX - 1, abdCY - 1, mc, PART.DETAIL, F_NOSHADE); px.put(CX, abdCY, mc, PART.DETAIL, F_NOSHADE); px.put(CX - 1, abdCY + 1, mc, PART.DETAIL, F_NOSHADE); px.put(CX - 1, abdCY + 2, mc, PART.DETAIL, F_NOSHADE); px.put(CX, abdCY + 2, mc, PART.DETAIL, F_NOSHADE); }
    else { [[-4, -2], [3, -3], [-2, 3], [4, 2], [0, -5]].forEach(([dx, dy]) => px.put(CX + dx * s, abdCY + dy * s, rampLight(P.skin, 0.3), PART.DETAIL, F_NOSHADE)); }
    if (scorpion) {
      const dir = v.tailDir;
      px.curve([[CX, abdCY - 6 * s], [CX + dir * 4, abdCY - 12 * s], [CX + dir * 2, abdCY - 16 * s], [CX - dir * 2, abdCY - 15 * s]], 2, 1.2, P.skin, PART.TAIL, 0);
      px.put(CX - dir * 3, abdCY - 14 * s, [236, 230, 210], PART.DETAIL, F_NOSHADE); px.put(CX - dir * 3, abdCY - 13 * s, [236, 230, 210], PART.DETAIL, F_NOSHADE);
    }
    // legs
    const legCol = rampDark(P.skin, 0.12);
    for (let k = 0; k < 4; k++) {
      if (scorpion && k === 0) continue;
      [-1, 1].forEach((side) => {
        const walk = ((k + (side > 0 ? 1 : 0)) % 2 === 0 ? fr.step : -fr.step);
        const hip = [CX + side * (2.5 + k * 0.8) * s, cephCY - 1 + k * 0.5];
        const knee = [CX + side * (8 + k * 3) * s, cephCY - (9 - k * 1.6) * s + walk];
        const foot = [CX + side * (10 + k * 3.4) * s, ground - (k === 0 || k === 3 ? 1 : 0)];
        const c = k >= 2 ? rampDark(legCol, 0.2) : legCol;
        px.line(hip[0], hip[1], knee[0], knee[1], c, PART.LEG_L + (side > 0 ? 1 : 0), 0);
        px.line(hip[0], hip[1] + 1, knee[0], knee[1] + 1, c, PART.LEG_L + (side > 0 ? 1 : 0), 0);
        px.line(knee[0], knee[1], foot[0], foot[1], c, PART.LEG_BL + (side > 0 ? 1 : 0), 0);
        px.line(knee[0] - side, knee[1], foot[0] - side, foot[1], c, PART.LEG_BL + (side > 0 ? 1 : 0), 0);
        px.put(knee[0], knee[1] - 1, rampLight(P.skin, 0.25), PART.DETAIL, F_NOSHADE);
      });
    }
    if (scorpion) {
      [-1, 1].forEach((side) => {
        const cx2 = CX + side * 8 * s, cy2 = cephCY + 1;
        px.line(CX + side * 3, cephCY, cx2, cy2 - 2, legCol, PART.ARM_L, 0);
        px.ball(cx2 + side, cy2 - 1, 2.6 * s, 2 * s, P.skin, PART.HAND_L + (side > 0 ? 1 : 0), 0);
        px.put(cx2 + side * 2, cy2 - 3, rampLight(P.skin, 0.3), PART.DETAIL, F_NOSHADE);
      });
    }
    px.ball(CX, cephCY, 6 * s, 4.5 * s, rampLight(P.skin, 0.05), PART.BODY, 0, 1, 0.25);
    // eyes
    const ec = t.eyes.glow ? P.eye : [200, 30, 30];
    const ey = Math.round(cephCY - 2 * s);
    px.rect(CX - 2, ey, 1, 2, ec, PART.EYE, F_GLOW); px.rect(CX + 1, ey, 1, 2, ec, PART.EYE, F_GLOW);
    if (t.eyes.count > 2) { [[-4, 0], [3, 0], [-3, -1], [2, -1], [-1, -2], [0, -2]].slice(0, t.eyes.count - 2).forEach(([dx, dy]) => px.put(CX + dx, ey + dy, ec, PART.EYE, F_GLOW)); }
    // fangs
    px.put(CX - 2, cephCY + 4 * s, [236, 230, 214], PART.DETAIL, F_NOSHADE); px.put(CX + 1, cephCY + 4 * s, [236, 230, 214], PART.DETAIL, F_NOSHADE);
    px.put(CX - 2, cephCY + 4 * s - 1, rampDark(P.skin, 0.2), PART.DETAIL, F_NOSHADE); px.put(CX + 1, cephCY + 4 * s - 1, rampDark(P.skin, 0.2), PART.DETAIL, F_NOSHADE);
    return { ground };
  }

  function drawOoze(D) {
    const t = D.t, P = D.P, px = D.px, v = D.v, fr = D.fr;
    const s = clamp(D.s, 0.6, 1.3);
    const trans = t.translucency > 0 ? F_TRANS : 0;
    if (t.floating || t.eyes.style === 'cyclops') {
      const cy = 26 + (fr.i % 2), r = 11 * s;
      const stalks = Math.max(3, t.tentacles || 5);
      for (let k = 0; k < stalks; k++) {
        const a = -Math.PI / 2 + (k - (stalks - 1) / 2) * 0.42;
        const ex = CX + Math.cos(a) * (r + 5), eyy = cy + Math.sin(a) * (r + 5) + ((k + fr.i) % 2);
        px.line(CX + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), ex, eyy, rampDark(P.skin, 0.15), PART.DETAIL, 0);
        px.put(ex, eyy - 1, [240, 236, 220], PART.EYE, 0); px.put(ex, eyy - 1, P.eye, PART.EYE, F_GLOW);
      }
      px.ball(CX, cy, r, r, P.skin, PART.BODY, 0, 1, 0.24);
      textureCovering(D, PART.BODY, 0, 0, GRID - 1, GRID - 1);
      px.ellipse(CX, cy - 1, 4.2 * s, 3.4 * s, [244, 240, 228], PART.EYE, F_NOSHADE);
      px.ellipse(CX, cy - 1, 2.2 * s, 2.2 * s, P.eye, PART.EYE, F_GLOW);
      px.rect(CX - 1, cy - 2, 2, 2, [20, 10, 20], PART.EYE, F_NOSHADE);
      const my = Math.round(cy + r * 0.55);
      px.span(CX, my, Math.round(8 * s), [40, 16, 24], PART.DETAIL, F_NOSHADE);
      for (let x = CX - 3; x < CX + 3; x += 2) px.put(x, my, [240, 236, 220], PART.DETAIL, F_NOSHADE);
      return { ground: GRID - 2 };
    }
    const W = Math.round(26 * s), Hh = Math.round(17 * s);
    const base = GRID - 2;
    for (let x = Math.round(CX - W / 2); x < CX + W / 2; x++) {
      const dx = (x + 0.5 - CX) / (W / 2);
      const h = Math.max(1, Math.round(Hh * Math.sqrt(Math.max(0, 1 - dx * dx)) * (0.85 + 0.15 * Math.cos(dx * 2)) + Math.sin(x * 0.6 + fr.i * 1.4) * 1));
      for (let y = base - h + 1; y <= base; y++) px.put(x, y, P.skin, PART.BODY, trans);
    }
    px.ellipse(CX + 1, base - Hh * 0.4, W * 0.28, Hh * 0.3, rampDark(P.skin, 0.2), PART.BODY2, trans);
    // suspended debris
    const r = makeRng(v.markSeed);
    if (r.chance(0.6) || t.element === 'bone') { px.rect(CX + r.int(-5, 3), base - r.int(4, 7), 3, 2, [226, 218, 196], PART.DETAIL, F_NOSHADE | trans); }
    for (let k = 0; k < 3; k++) {
      const bx = CX + r.int(-W / 3, W / 3), by = base - 2 - ((r.int(0, Hh - 4) + fr.i * 2) % Math.max(3, Hh - 3));
      px.put(bx, by, lighten(P.skin, 0.35), PART.DETAIL, F_NOSHADE | trans);
    }
    // highlight crescent
    for (let k = 0; k < 4; k++) px.put(CX - W * 0.28 + k, base - Hh * 0.8 + Math.abs(k - 1.5) * 0.7 + 1, [250, 255, 250], PART.DETAIL, F_NOSHADE);
    px.put(CX - W * 0.32, base - Hh * 0.6, [250, 255, 250], PART.DETAIL, F_NOSHADE);
    // eyes
    const ey = Math.round(base - Hh * 0.62);
    if (t.eyes.glow) { px.rect(CX - 4, ey, 2, 2, P.eye, PART.EYE, F_GLOW); px.rect(CX + 2, ey, 2, 2, P.eye, PART.EYE, F_GLOW); }
    else { [CX - 4, CX + 2].forEach((x) => { px.rect(x, ey, 2, 2, [244, 244, 240], PART.EYE, F_NOSHADE); px.put(x + 1, ey + 1, [16, 16, 20], PART.EYE, F_NOSHADE); }); }
    px.span(CX, ey + 4, 4, rampDark(P.skin, 0.45), PART.DETAIL, F_NOSHADE);
    // drips
    px.put(CX - W / 2 + 2, base, P.skin, PART.BODY, trans);
    return { ground: base };
  }

  function drawElemental(D) {
    const t = D.t, P = D.P, px = D.px, v = D.v, fr = D.fr;
    const el = t.element;
    const L = layoutHumanoid(D);
    D.L = L;
    const pal = {
      fire: [[196, 46, 22], [255, 120, 30], [255, 196, 60], [255, 246, 190]],
      storm: [[60, 80, 130], [110, 140, 190], [170, 200, 235], [255, 248, 160]],
      water: [[30, 80, 140], [50, 130, 190], [110, 190, 230], [220, 250, 255]],
      frost: [[90, 150, 210], [150, 205, 240], [210, 240, 255], [255, 255, 255]],
      shadow: [[24, 18, 36], [50, 36, 72], [80, 60, 120], [190, 140, 255]],
      void: [[20, 8, 36], [50, 20, 80], [100, 40, 150], [230, 120, 255]],
      poison: [[40, 90, 30], [80, 160, 50], [150, 220, 80], [220, 255, 160]],
      holy: [[200, 160, 70], [240, 210, 120], [255, 240, 190], [255, 255, 240]],
      arcane: [[60, 40, 140], [110, 80, 210], [170, 150, 250], [240, 230, 255]]
    }[el];
    const stoneLike = el === 'earth' || el === 'sand' || el === 'bone' || el === 'blood';
    if (stoneLike || !pal) {
      const sc = P.skin;
      [-1, 1].forEach((side) => px.rect(side < 0 ? CX - 5 : CX + 1, L.yLegTop + 2, 4, L.legH - 1, rampDark(sc, 0.1), side < 0 ? PART.LEG_L : PART.LEG_R, 0));
      px.ball(CX, L.yTorsoTop + L.torsoH * 0.5, L.shoulderW / 2 + 2, L.torsoH / 2 + 1, sc, PART.TORSO, 0, 1, 0.2);
      [-1, 1].forEach((side) => {
        px.ball(CX + side * (L.shoulderW / 2 + 3), L.yTorsoTop + 2, 3.2, 3, rampLight(sc, 0.05), side < 0 ? PART.PAUL_L : PART.PAUL_R, 0, 1);
        px.ball(CX + side * (L.shoulderW / 2 + 4), L.yTorsoTop + L.torsoH * 0.8 + fr.step * side, 3, 3, sc, side < 0 ? PART.HAND_L : PART.HAND_R, 0, 1);
      });
      px.ball(CX, L.yHeadTop + L.headH / 2 + 1, L.headW / 2, L.headH / 2 - 0.5, rampLight(sc, 0.05), PART.HEAD, 0, 1);
      const ey = Math.round(L.yHeadTop + L.headH / 2 + 1);
      px.put(CX - 2, ey, P.glow, PART.EYE, F_GLOW); px.put(CX + 1, ey, P.glow, PART.EYE, F_GLOW);
      const r = makeRng(v.markSeed);
      for (let k = 0; k < 3; k++) { let x = CX + r.int(-4, 3), y = L.yTorsoTop + r.int(1, 4); for (let s = 0; s < 5; s++) { px.put(x, y, P.glow, PART.DETAIL, F_GLOW); x += r.int(-1, 1); y++; } }
      return { ground: GRID - 2 };
    }
    const [edge, mid, inner, core] = pal;
    const flick = (x, k) => ((x * 13 + k * 7 + fr.i * 5 + v.markSeed) % 4);
    const isFlame = el === 'fire' || el === 'holy' || el === 'void' || el === 'arcane';
    const trans = (el === 'water' || el === 'storm' || el === 'shadow') ? F_TRANS : 0;
    const fl = (isFlame ? F_GLOW : 0) | trans | F_NOSHADE;
    const top = L.yTorsoTop, bottom = L.ground - 1;
    const layers = [[edge, 0], [mid, 1], [inner, 2.4], [core, 3.8]];
    layers.forEach(([c, inset], li) => {
      // torso tapering into a flame/vortex tail
      for (let y = top; y <= bottom; y++) {
        const tt = (y - top) / (bottom - top);
        let w = tt < 0.45 ? L.shoulderW + 2 - tt * 4 : (L.shoulderW + 2 - 1.8) * (1 - (tt - 0.45) / 0.55 * 0.92);
        w -= inset * 2;
        const sway = Math.round(Math.sin(tt * 5 + fr.i * 1.7) * tt * 2);
        if (w >= 1) px.span(CX + sway, y, Math.max(1, Math.round(w)), c, PART.BODY, fl);
      }
      // arms
      [-1, 1].forEach((side) => {
        const ax = side < 0 ? CX - L.shoulderW / 2 - 2 : CX + L.shoulderW / 2 - 1;
        const len = L.torsoH + 2 + fr.step * side;
        const aw = 3 - Math.min(2, Math.floor(inset));
        if (aw > 0 && li < 3) px.rect(ax + (side < 0 ? Math.floor(inset / 2) : 0), top + 1 + Math.floor(inset / 2), aw, len - inset, c, PART.ARM_L + (side > 0 ? 1 : 0), fl);
      });
      // head
      const hr = L.headW / 2 + 0.5 - inset * 0.8;
      if (hr > 0.6) px.ellipse(CX, L.yHeadTop + L.headH / 2, hr, L.headH / 2 + 0.5 - inset * 0.8, c, PART.HEAD, fl);
    });
    if (isFlame || el === 'frost') {
      // flame tongues / ice shards on head and shoulders
      for (let x = CX - L.headW / 2 + 1; x < CX + L.headW / 2; x++) {
        const h = el === 'frost' ? ((x % 3 === 0) ? 4 : 1) : 1 + flick(x, 1);
        for (let k = 1; k <= h; k++) px.put(x, L.yHeadTop - k + 1, k === h ? (el === 'frost' ? [255, 255, 255] : core) : mid, PART.HAIR, fl);
      }
      [-1, 1].forEach((side) => {
        const sx = side < 0 ? CX - L.shoulderW / 2 - 1 : CX + L.shoulderW / 2;
        const h = el === 'frost' ? 4 : 2 + flick(sx, 2);
        for (let k = 1; k <= h; k++) px.put(sx + (k > 2 ? side : 0), top - k + 1, k === h ? core : mid, PART.HAIR, fl);
      });
    }
    if (el === 'storm') {
      const r = fr.rng;
      let x = CX + r.int(-3, 3), y = top + 1;
      for (let k = 0; k < 10; k++) { px.put(x, y, core, PART.DETAIL, F_GLOW); x += r.int(-1, 1); y++; }
      for (let y2 = bottom - 3; y2 <= bottom; y2++) px.span(CX + (y2 % 2 ? 2 : -2), y2, 5, mid, PART.BODY, trans | F_NOSHADE);
    }
    if (el === 'water') for (let x = CX - 4; x < CX + 4; x += 3) px.put(x, top + 2 + (fr.i % 2), core, PART.DETAIL, F_NOSHADE);
    // eyes
    const ey = Math.round(L.yHeadTop + L.headH / 2);
    const ec = isFlame ? [60, 12, 4] : core;
    px.put(CX - 2, ey, ec, PART.EYE, isFlame ? F_NOSHADE : F_GLOW); px.put(CX + 1, ey, ec, PART.EYE, isFlame ? F_NOSHADE : F_GLOW);
    // embers / particles
    const r = fr.rng;
    for (let k = 0; k < 4; k++) px.put(CX + r.int(-L.shoulderW / 2 - 3, L.shoulderW / 2 + 3), r.int(Math.max(1, L.yHeadTop - 6), top + 4), core, PART.DETAIL, F_GLOW | F_NOOUTLINE);
    D.noOutline = isFlame;
    return { ground: GRID - 2 };
  }

  function drawDragon(D) {
    const t = D.t, P = D.P, px = D.px, v = D.v, fr = D.fr;
    const s = clamp(D.s, 0.75, 1.3);
    const ground = GRID - 2;
    const bodyCY = ground - 11 * s + fr.bob;
    const neckTopY = Math.round(bodyCY - 13 * s);
    const headH = Math.round(8 * s), headTop = Math.max(4, neckTopY - headH + 2);
    const wingKind = t.wings === 'none' ? 'bat' : t.wings;
    drawWings(D, CX, Math.round(bodyCY - 7 * s), Math.min(23, Math.round(21 * s * v.wingSpread)), Math.round(18 * s), wingKind);
    // tail
    const dir = v.tailDir;
    px.curve([[CX + dir * 4, ground - 4], [CX + dir * 11 * s, ground - 1], [CX + dir * 17 * s, ground - 3 - fr.step], [CX + dir * 20 * s, ground - 8]], 3, 0.8, P.skin, PART.TAIL, 0);
    const tip = [CX + dir * 20 * s, ground - 8];
    px.poly([[tip[0], tip[1] - 3], [tip[0] + dir * 2, tip[1]], [tip[0], tip[1] + 2], [tip[0] - dir * 2, tip[1]]], rampDark(P.skin2, 0.1), PART.DETAIL, 0);
    // haunches
    [-1, 1].forEach((side) => {
      px.ball(CX + side * 7 * s, ground - 6 * s, 4.2 * s, 5.4 * s, rampDark(P.skin, 0.08), side < 0 ? PART.LEG_BL : PART.LEG_BR, 0, 1, 0.2);
      [-1, 0, 1].forEach((d) => px.put(CX + side * 8 * s + d * 1.5, ground, [236, 230, 214], PART.DETAIL, F_NOSHADE));
    });
    // body
    px.ball(CX, bodyCY, 8 * s, 10.5 * s, P.skin, PART.BODY, 0, 1, 0.2);
    textureCovering(D, PART.BODY, 0, 0, GRID - 1, GRID - 1);
    for (let y = Math.round(bodyCY - 9 * s); y < bodyCY + 9 * s; y++) px.span(CX, y, Math.round(5 * s), (y % 2) ? P.belly : rampDark(P.belly, 0.15), PART.BODY2, 0);
    // front legs
    [-1, 1].forEach((side) => {
      const lift = fr.step === side ? 1 : 0;
      const x = side < 0 ? Math.round(CX - 5 * s - 1) : Math.round(CX + 5 * s - 2);
      px.rect(x, Math.round(bodyCY + 2), 3, ground - Math.round(bodyCY + 2) - lift, rampLight(P.skin, 0.04), side < 0 ? PART.LEG_L : PART.LEG_R, 0);
      [0, 1, 2].forEach((d) => px.put(x + d, ground - lift, [236, 230, 214], PART.DETAIL, F_NOSHADE));
    });
    // neck
    const nw = Math.max(4, Math.round(5 * s));
    for (let y = neckTopY; y < bodyCY - 8 * s; y++) {
      px.span(CX, y, nw, P.skin, PART.NECK, 0);
      px.span(CX, y, nw - 2, (y % 2) ? P.belly : rampDark(P.belly, 0.15), PART.BODY2, 0);
      if (y % 3 === 0) { px.put(CX - nw / 2 - 1, y, rampDark(P.skin2, 0.1), PART.DETAIL, F_NOSHADE); px.put(CX + nw / 2, y, rampDark(P.skin2, 0.1), PART.DETAIL, F_NOSHADE); }
    }
    // head: wide skull, narrower snout
    const hw = even(10 * s);
    for (let r = 0; r < headH; r++) {
      let w = hw;
      if (r === 0) w = hw - 4; else if (r === 1) w = hw - 2;
      if (r >= Math.round(headH * 0.5)) w = Math.max(4, hw - 4);
      if (r === headH - 1) w = Math.max(4, hw - 6);
      px.span(CX, headTop + r, w, P.skin, PART.HEAD, 0);
    }
    textureCovering(D, PART.HEAD, 0, 0, GRID - 1, GRID - 1);
    const ey = headTop + Math.round(headH * 0.35);
    px.span(CX, ey - 1, hw - 2, rampDark(P.skin, 0.25), PART.DETAIL, F_NOSHADE);
    px.put(CX - hw / 2 + 1, ey, P.eye, PART.EYE, F_GLOW); px.put(CX + hw / 2 - 2, ey, P.eye, PART.EYE, F_GLOW);
    px.put(CX - 2, headTop + headH - 3, [20, 12, 12], PART.DETAIL, F_NOSHADE); px.put(CX + 1, headTop + headH - 3, [20, 12, 12], PART.DETAIL, F_NOSHADE);
    for (let x = CX - 2; x < CX + 2; x++) if (x % 2 === 0) px.put(x, headTop + headH - 1, [240, 236, 224], PART.DETAIL, F_NOSHADE);
    drawHornsAt(D, CX, headTop + 1, hw / 2 - 1, t.horns === 'none' ? 'long' : t.horns, 1.25);
    if (t.element !== 'none' && fr.i % 2 === 1) {
      const bc = P.glow;
      px.put(CX - 1, headTop + headH, bc, PART.DETAIL, F_GLOW | F_NOOUTLINE); px.put(CX, headTop + headH + 1, bc, PART.DETAIL, F_GLOW | F_NOOUTLINE);
    }
    return { ground };
  }

  // ---------------------------------------------------------------- render entry points
  const pixelCache = new Map();
  const PIXEL_CACHE_MAX = 600;
  // world=true: look for the 3D voxel actors (chunky like the dungeon textures): no glow halos / aura dither /
  // orbit particles (they would become floating voxel slabs), translucency as a checker dither instead of
  // alpha, binary alpha and a posterized palette. Torch lighting is applied by the voxel shader.
  // world === 'billboard': 3D camera-facing billboards (rendererWebGL.js). Like 'world' (binary alpha, no soft
  // halos) but full colour depth (the sprite shader does torch + distance shading) and optional back view.
  function renderProceduralPixels(spec, frame, world, view) {
    const f = Math.max(0, Math.min(3, frame | 0));
    const bb = world === 'billboard';
    const back = view === 'back' && supportsBackView(spec);
    const key = (spec.key || '') + '|' + f + (world ? (bb ? '|b' : '|w') : '') + (back ? '|back' : '');
    if (spec.key && pixelCache.has(key)) return pixelCache.get(key);
    const D = buildContext(spec, f);
    if (back) D.view = 'back';
    if (bb) D.t.gesture = true; // lean silhouette (naturalLimbs on presets overrides stick limbs)
    const t = D.t;
    let L = null;
    switch (t.bodyPlan) {
      case 'beast': drawBeast(D); break;
      case 'serpent': drawSerpent(D); L = D.L; break;
      case 'spider': drawSpider(D); break;
      case 'ooze': drawOoze(D); break;
      case 'elemental': drawElemental(D); L = D.L; break;
      case 'draconic': drawDragon(D); break;
      default: L = drawHumanoid(D); break;
    }
    const px = D.px;
    if (t.translucency > 0) {
      if (t.bodyPlan === 'spectral' && L) passTranslucency(px, t.translucency * 0.75, L.yLegTop - 1, L.ground + 3);
      else passTranslucency(px, t.translucency);
    }
    if (bb || t.heroic || t.gesture) {
      // Prince of Persia gesture look: soft directional shade only (no heavy cartoon banding)
      passShading(px, 0.4);
      passOutline(px, INK, true);
    } else {
      passShading(px);
      passItemOutline(px);
      passOutline(px, INK);
    }
    if (world && t.worldAura > 0) passWorldAura(px, hexToRgb(t.aura.color || t.palette.glow), Math.min(t.worldAura, bb ? 0.22 : t.worldAura), f, true); // motes only on billboards
    if (!world) {
      passGlow(px, D.noOutline ? 1.2 : 1);
      passAura(px, hexToRgb(t.aura.color || t.palette.glow), D.auraStrength, f);
    }
    if (D.level >= 25 && !world) {
      const ang = f * Math.PI / 2;
      [[0, 0], [Math.PI, 1]].forEach(([o]) => {
        const x = Math.round(CX + Math.cos(ang + o) * 15), y = Math.round(26 + Math.sin(ang + o) * 4);
        px.put(x, y, D.P.glow, PART.DETAIL, F_GLOW | F_NOOUTLINE, 0.9);
      });
    }
    const out = new Uint8ClampedArray(GRID * GRID * 4);
    for (let i = 0; i < GRID * GRID; i++) {
      out[i * 4] = px.c[i * 4]; out[i * 4 + 1] = px.c[i * 4 + 1]; out[i * 4 + 2] = px.c[i * 4 + 2];
      out[i * 4 + 3] = Math.round(clamp(px.c[i * 4 + 3], 0, 1) * 255);
      if (world) {
        const a = out[i * 4 + 3] / 255;
        const x = i % GRID, y = (i / GRID) | 0;
        // dithered transparency: keep pixel if alpha beats a 2x2 ordered threshold
        const thr = [0.2, 0.7, 0.95, 0.45][(x & 1) + ((y & 1) << 1)];
        out[i * 4 + 3] = a >= thr ? 255 : 0;
        if (!bb) for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(Math.round(out[i * 4 + k] / 36) * 36.43);
      }
    }
    // Weapon-hand lock: do not mirror back bitmaps (would move the sword to the other hand).
    const result = { w: GRID, h: GRID, data: out };
    if (spec.key) {
      if (pixelCache.size > PIXEL_CACHE_MAX) pixelCache.delete(pixelCache.keys().next().value);
      pixelCache.set(key, result);
    }
    return result;
  }
  function blitScaled(ctx, pixels, dx, dy, scale, mirror) {
    const W = pixels.w * scale, H = pixels.h * scale;
    const img = ctx.createImageData(W, H);
    const d = img.data, src = pixels.data;
    for (let y = 0; y < pixels.h; y++) for (let x = 0; x < pixels.w; x++) {
      const sx = mirror ? pixels.w - 1 - x : x;
      const si = (y * pixels.w + sx) * 4;
      if (!src[si + 3]) continue;
      for (let yy = 0; yy < scale; yy++) {
        let o = ((y * scale + yy) * W + x * scale) * 4;
        for (let xx = 0; xx < scale; xx++, o += 4) { d[o] = src[si]; d[o + 1] = src[si + 1]; d[o + 2] = src[si + 2]; d[o + 3] = src[si + 3]; }
      }
    }
    ctx.putImageData(img, dx, dy);
  }
  function createProceduralCharacterCanvas(spec, opts) {
    const o = opts || {};
    const scale = Math.max(1, Math.min(8, o.scale || DEFAULT_SCALE));
    const canvas = createCanvas(GRID * scale, GRID * scale);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    blitScaled(ctx, renderProceduralPixels(spec, o.frame || 0, !!o.world), 0, 0, scale, !!o.mirror);
    return canvas;
  }
  function supportsBackView(spec) {
    const plan = spec && spec.traits && spec.traits.bodyPlan;
    return !plan || ['humanoid', 'skeletal', 'spectral', 'giant', 'insectoid'].includes(plan) || (plan === 'serpent' && spec.traits.nagaTorso);
  }
  // Scale2x (EPX): doubles pixel art while keeping hard edges but smoothing diagonal stair-steps.
  function scale2x(src, w, h) {
    const W = w * 2, out = new Uint8ClampedArray(W * h * 2 * 4);
    const id = (x, y) => {
      x = x < 0 ? 0 : (x >= w ? w - 1 : x); y = y < 0 ? 0 : (y >= h ? h - 1 : y);
      return (y * w + x) * 4;
    };
    const eq = (a, b) => src[a] === src[b] && src[a + 1] === src[b + 1] && src[a + 2] === src[b + 2] && src[a + 3] === src[b + 3];
    const put = (x, y, s) => { const o = (y * W + x) * 4; out[o] = src[s]; out[o + 1] = src[s + 1]; out[o + 2] = src[s + 2]; out[o + 3] = src[s + 3]; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const P = id(x, y), A = id(x, y - 1), B = id(x + 1, y), C = id(x - 1, y), Dd = id(x, y + 1);
      let e0 = P, e1 = P, e2 = P, e3 = P;
      if (!eq(C, B) && !eq(A, Dd)) {
        if (eq(C, A)) e0 = A;
        if (eq(A, B)) e1 = B;
        if (eq(Dd, C)) e2 = C;
        if (eq(B, Dd)) e3 = Dd;
      }
      put(x * 2, y * 2, e0); put(x * 2 + 1, y * 2, e1); put(x * 2, y * 2 + 1, e2); put(x * 2 + 1, y * 2 + 1, e3);
    }
    return out;
  }
  // Doom-style billboard views from approved front art (Mortacia v12 palette/shapes).
  // WEAPON HAND LOCK: sword is always the character's RIGHT hand (= left side of the FRONT canvas,
  // hold[-1]). Views remap pose so that hand stays anatomically consistent:
  //   front: left of sprite | side face+1: right (forward) | side face-1: left (forward)
  //   back: right of sprite (mirror after back paint) | ¾: intermediate toward the matching side.
  // Never bitmap-mirror a side/¾ copy of the front to flip yaw — that swaps body hands.
  function normalizeBillboardView(view) {
    const v = String(view || 'front').toLowerCase();
    if (v === 'back') return 'back';
    if (v === 'side' || v === 'profile') return 'side';
    if (v === 'threequarter' || v === 'three-quarter' || v === '3q' || v === '3/4') return 'threeQuarter';
    return 'front';
  }
  function fillNearestHoles(out, w, h, minX, maxX, minY, maxY) {
    const tmp = new Uint8ClampedArray(out);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const o = (y * w + x) * 4;
        if (tmp[o + 3]) continue;
        let best = null, bestD = 3;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const i = (ny * w + nx) * 4;
          if (!tmp[i + 3]) continue;
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bestD) { bestD = d; best = i; }
        }
        if (best != null) {
          out[o] = tmp[best]; out[o + 1] = tmp[best + 1]; out[o + 2] = tmp[best + 2]; out[o + 3] = tmp[best + 3];
        }
      }
    }
  }
  function mirrorPixelsX(src, w, h) {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * w + x) * 4;
        const di = (y * w + (w - 1 - x)) * 4;
        out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
      }
    }
    return out;
  }
  function opaqueBounds(src, w, h) {
    let minX = w, maxX = -1, minY = h, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!src[(y * w + x) * 4 + 3]) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return maxX < 0 ? null : { minX, maxX, minY, maxY, cx: (minX + maxX) * 0.5, bw: maxX - minX + 1 };
  }
  // Character's RIGHT-hand / weapon column on the FRONT sprite (left of body).
  function findWeaponSrcX(src, w, h, b) {
    const y0 = b.minY + Math.floor((b.maxY - b.minY) * 0.18);
    const y1 = b.minY + Math.floor((b.maxY - b.minY) * 0.55);
    let bestX = b.minX, bestScore = -1;
    for (let x = b.minX; x <= Math.min(b.maxX, Math.floor(b.cx - 1)); x++) {
      let col = 0, bright = 0;
      for (let y = y0; y <= y1; y++) {
        const i = (y * w + x) * 4;
        if (!src[i + 3]) continue;
        col++;
        // steel / pale blade cue
        if (src[i] > 140 && src[i + 1] > 140 && Math.abs(src[i] - src[i + 1]) < 40) bright++;
      }
      const score = col + bright * 3;
      if (score > bestScore) { bestScore = score; bestX = x; }
    }
    return bestX;
  }
  // Side profile: forward edge = anatomical right hand (samples front's weapon/left side).
  // face=+1 → character faces screen-right → forward/weapon on the RIGHT of the slab.
  // face=-1 → faces screen-left → forward/weapon on the LEFT. Same body hand both ways.
  function buildSideProfile(src, w, h, face, b) {
    const out = new Uint8ClampedArray(w * h * 4);
    const cx = b.cx;
    for (let y = b.minY; y <= b.maxY; y++) {
      let rowMin = w, rowMax = -1;
      for (let x = b.minX; x <= b.maxX; x++) {
        if (!src[(y * w + x) * 4 + 3]) continue;
        if (x < rowMin) rowMin = x; if (x > rowMax) rowMax = x;
      }
      if (rowMax < 0) continue;
      const rowW = rowMax - rowMin + 1;
      // Readable humanoid depth (combat side-profile inspired), not a paper-thin warp
      const thickness = Math.max(6, Math.min(Math.floor(w * 0.36), Math.round(rowW * 0.5 + 4)));
      const mid = Math.round(cx + face * Math.min(b.bw * 0.14, w * 0.07));
      const x0 = mid - Math.floor(thickness / 2);
      for (let t = 0; t < thickness; t++) {
        const nx = x0 + t;
        if (nx < 0 || nx >= w) continue;
        const along = thickness <= 1 ? 0 : t / (thickness - 1);
        // along=0 trailing (wings/back of front), along=1 forward (weapon) when face=+1
        const fromWeapon = face > 0 ? (1 - along) : along;
        const srcX = rowMin + Math.floor(fromWeapon * (rowW - 1));
        const si = (y * w + srcX) * 4;
        if (!src[si + 3]) continue;
        const o = (y * w + nx) * 4;
        const shade = 0.78 + 0.22 * (face > 0 ? along : (1 - along));
        out[o] = Math.min(255, Math.round(src[si] * shade));
        out[o + 1] = Math.min(255, Math.round(src[si + 1] * shade));
        out[o + 2] = Math.min(255, Math.round(src[si + 2] * shade));
        out[o + 3] = src[si + 3];
      }
    }
    fillNearestHoles(out, w, h,
      Math.max(0, Math.floor(cx - b.bw * 0.45)),
      Math.min(w - 1, Math.ceil(cx + b.bw * 0.45)),
      b.minY, b.maxY);
    return out;
  }
  // True Doom ¾: intermediate between front and side. Remap so front's LEFT (right-hand / weapon)
  // becomes the NEAR edge toward `face`, and the opposite flank is foreshortened away from camera.
  // face=+1 → weapon on the RIGHT of the ¾ sprite; face=-1 → weapon on the LEFT. Same body hand.
  function buildThreeQuarter(src, w, h, face, b) {
    const out = new Uint8ClampedArray(w * h * 4);
    const side = buildSideProfile(src, w, h, face, b);
    const cx = b.cx;
    const bw = Math.max(1, b.bw);
    // ¾ width sits between front and side (~72% of front span)
    const outHalf = Math.max(8, Math.round(bw * 0.36));
    const bodyShift = face * Math.round(bw * 0.04);

    for (let y = b.minY; y <= b.maxY; y++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        const si = (y * w + x) * 4;
        if (!src[si + 3]) continue;
        // t=0 at front's left (weapon / right hand), t=1 at front's right (far wing when face=+1)
        const t = (x - b.minX) / bw;
        // Rotate onto screen: weapon (t=0) → near (+face), far edge (t=1) → -face
        // Non-linear squash: near third keeps more samples, far third compresses (Doom foreshortening)
        const nearT = 1 - t; // 1 at weapon, 0 at far
        const squash = 0.55 + 0.45 * Math.pow(nearT, 0.75); // wider near camera
        const along = (0.5 - t) * face; // weapon → +face direction
        const nx = Math.round(cx + along * 2 * outHalf * squash + bodyShift);
        if (nx < 0 || nx >= w) continue;
        const o = (y * w + nx) * 4;
        const shade = 0.82 + 0.18 * nearT;
        const r = Math.min(255, Math.round(src[si] * shade));
        const g = Math.min(255, Math.round(src[si + 1] * shade));
        const bch = Math.min(255, Math.round(src[si + 2] * shade));
        // Near (weapon) wins over far when two source columns land on one dest
        if (!out[o + 3] || nearT >= 0.45) {
          out[o] = r; out[o + 1] = g; out[o + 2] = bch; out[o + 3] = src[si + 3];
        }
      }
    }
    // Stamp near flank from side profile for angled depth toward camera
    const sb = opaqueBounds(side, w, h);
    if (sb) {
      const nearX0 = face > 0 ? Math.floor(sb.minX + sb.bw * 0.40) : sb.minX;
      const nearX1 = face > 0 ? sb.maxX : Math.ceil(sb.minX + sb.bw * 0.60);
      for (let y = sb.minY; y <= sb.maxY; y++) {
        for (let x = nearX0; x <= nearX1; x++) {
          const si = (y * w + x) * 4;
          if (!side[si + 3]) continue;
          const o = si;
          if (!out[o + 3]) {
            out[o] = side[si]; out[o + 1] = side[si + 1]; out[o + 2] = side[si + 2]; out[o + 3] = side[si + 3];
          } else {
            out[o] = Math.round(out[o] * 0.5 + side[si] * 0.5);
            out[o + 1] = Math.round(out[o + 1] * 0.5 + side[si + 1] * 0.5);
            out[o + 2] = Math.round(out[o + 2] * 0.5 + side[si + 2] * 0.5);
          }
        }
      }
    }
    fillNearestHoles(out, w, h,
      Math.max(0, Math.floor(cx - outHalf * 1.35)),
      Math.min(w - 1, Math.ceil(cx + outHalf * 1.35)),
      b.minY, b.maxY);
    return out;
  }
  function deriveViewFromFront(src, w, h, view, facing) {
    const v = normalizeBillboardView(view);
    const face = facing < 0 ? -1 : 1;
    if (v === 'front') {
      const out = new Uint8ClampedArray(src.length);
      out.set(src);
      return out;
    }
    // Back art is painted by renderProceduralPixels(back); mirror so RIGHT hand stays on the
    // character's right (appears on the RIGHT of the canvas when viewed from behind).
    if (v === 'back') return mirrorPixelsX(src, w, h);
    const b = opaqueBounds(src, w, h);
    if (!b) {
      const out = new Uint8ClampedArray(src.length);
      return out;
    }
    if (v === 'threeQuarter') return buildThreeQuarter(src, w, h, face, b);
    return buildSideProfile(src, w, h, face, b);
  }
  // 3D world billboard (Doom-style): crisp binary-alpha at 4x (two Scale2x passes).
  // opts: {frame, view, facing: +1|-1}. Same body weapon hand across all views.
  const billboardCache = new Map();
  function scaleToBillboard(pix) {
    let data = scale2x(pix.data, GRID, GRID);
    data = scale2x(data, GRID * 2, GRID * 2);
    return data;
  }
  // Back: mirror FRONT so the right-hand sword lands on the RIGHT, then overlay mirrored
  // back-of-head / cape / wing-from-behind cues without burying the weapon.
  function composeBackBillboard(frontData, backData, S) {
    const mirroredFront = mirrorPixelsX(frontData, S, S);
    if (!supportsBackView || !backData) return mirroredFront;
    const mirroredBack = mirrorPixelsX(backData, S, S);
    const out = new Uint8ClampedArray(mirroredFront);
    const headEnd = Math.floor(S * 0.42);
    for (let y = 0; y < headEnd; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        if (!mirroredBack[i + 3]) continue;
        // Prefer back hair/helm in the upper band; keep any pale blade pixels from mirrored front
        const frontPale = out[i] > 150 && out[i + 1] > 150 && out[i + 2] > 130
          && (out[i] + out[i + 1] + out[i + 2]) > 450;
        if (frontPale && y > S * 0.12) continue; // don't bury tip-up sword with hair
        out[i] = mirroredBack[i];
        out[i + 1] = mirroredBack[i + 1];
        out[i + 2] = mirroredBack[i + 2];
        out[i + 3] = mirroredBack[i + 3];
      }
    }
    return out;
  }
  function renderBillboardPixels(spec, opts) {
    const o = opts || {};
    const f = Math.max(0, Math.min(3, o.frame | 0));
    const view = normalizeBillboardView(o.view);
    const facing = o.facing < 0 ? -1 : 1;
    const key = (spec.key || '') + '|' + f + '|' + view + '|' + (view === 'front' ? 'c' : (facing > 0 ? 'r' : 'l')) + '|v3';
    if (spec.key && billboardCache.has(key)) return billboardCache.get(key);
    // Always build side/¾/back from FRONT so the sword (right hand / canvas-left) is present
    const frontPix = renderProceduralPixels(spec, f, 'billboard', 'front');
    let data = scaleToBillboard(frontPix);
    const S = GRID * 4;
    if (view === 'back') {
      let backData = null;
      if (supportsBackView(spec)) {
        backData = scaleToBillboard(renderProceduralPixels(spec, f, 'billboard', 'back'));
      }
      data = composeBackBillboard(data, backData, S);
    } else if (view === 'side' || view === 'threeQuarter') {
      data = deriveViewFromFront(data, S, S, view, facing);
    }
    let minX = S, minY = S, maxX = -1, maxY = -1;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (data[(y * S + x) * 4 + 3]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const res = { w: S, h: S, data, bounds: maxX < 0 ? null : { minX, minY, maxX, maxY }, view, facing };
    if (spec.key) {
      if (billboardCache.size > 256) billboardCache.delete(billboardCache.keys().next().value);
      billboardCache.set(key, res);
    }
    return res;
  }

  function createBillboardCanvas(spec, opts) {
    const pix = renderBillboardPixels(spec, opts);
    const canvas = createCanvas(pix.w, pix.h);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(pix.w, pix.h);
    img.data.set(pix.data);
    ctx.putImageData(img, 0, 0);
    canvas._billboardBounds = pix.bounds;
    canvas._billboardView = pix.view;
    return canvas;
  }
  function createProceduralSheetCanvas(spec, frameCount, scale) {
    const n = Math.max(1, Math.min(8, frameCount || 4));
    const sc = Math.max(1, Math.min(8, scale || DEFAULT_SCALE));
    const canvas = createCanvas(GRID * sc * n, GRID * sc);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    for (let f = 0; f < n; f++) blitScaled(ctx, renderProceduralPixels(spec, f % 4), f * GRID * sc, 0, sc, false);
    return canvas;
  }
  function proceduralDataUrl(spec, opts) {
    const c = createProceduralCharacterCanvas(spec, opts);
    return c && typeof c.toDataURL === 'function' ? c.toDataURL('image/png') : '';
  }

  // ---------------------------------------------------------------- spec building + uniqueness
  function isProceduralSpec(spec) { return !!(spec && spec.kind === 'procedural' && spec.traits); }
  function computeWorldScale(tr) {
    if (Number.isFinite(tr.worldScale)) return clamp(tr.worldScale, 0.55, 1.7);
    const base = SIZES[tr.size] || 1;
    const planMul = tr.bodyPlan === 'draconic' ? 1.3 : (tr.bodyPlan === 'giant' ? 1.12 : (tr.bodyPlan === 'spider' || tr.bodyPlan === 'beast' ? 1.05 : 1));
    return Math.round(clamp(base * planMul, 0.55, 1.7) * 100) / 100;
  }
  function finalizeSpec(spec) {
    spec.seed = hashString(String(spec.name || '').toLowerCase() + '|' + spec.salt + '|' + spec.variant);
    spec.key = 'p' + SPEC_VERSION + '-' + hashString(JSON.stringify([spec.traits, spec.seed, spec.level, spec.sex])).toString(36);
    return spec;
  }
  function buildProceduralSpriteSpec(sheetIn, traits, opts) {
    const o = opts || {};
    const sheet = normalizeSheet(sheetIn);
    let tr;
    if (traits && traits.v && traits.palette && traits.outfit) tr = JSON.parse(JSON.stringify(traits));
    else if (traits) tr = normalizeTraitSpec(traits, sheet);
    else tr = deriveFallbackTraits(sheet);
    const first = sheet.name.toLowerCase().split(/\s+/)[0];
    if (SIGNATURE[first] && o.signature !== false) SIGNATURE[first](tr);
    const salt = o.salt !== undefined && o.salt !== null ? (o.salt >>> 0) : hashString('salt|' + sheet.name.toLowerCase());
    const ws = computeWorldScale(tr);
    const spec = {
      kind: 'procedural', version: SPEC_VERSION, name: sheet.name, sex: sheet.sex, race: sheet.race, class: sheet.class,
      level: sheet.level, isMonster: sheet.isMonster, role: sheet.role, traits: tr,
      salt, variant: (o.variant | 0), source: o.source || (traits ? 'llm' : 'fallback'),
      worldScale: ws, grid: GRID,
      design: { torso_width: Math.round(5 * ws), leg_height: Math.round(10 * ws), head_width: Math.round(5 * ws) }
    };
    return finalizeSpec(spec);
  }
  function withVariant(spec, variant) {
    const s = JSON.parse(JSON.stringify(spec));
    s.variant = variant | 0;
    return finalizeSpec(s);
  }
  function spriteFingerprint(spec) {
    const pix = renderProceduralPixels(spec, 0);
    const N = 12, cell = GRID / N;
    const alpha = new Float32Array(N * N), lum = new Float32Array(N * N);
    let r = 0, g = 0, b = 0, wsum = 0;
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
      let a = 0, l = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y++) for (let x = cx * cell; x < (cx + 1) * cell; x++) {
        const i = (y * GRID + x) * 4;
        const pa = pix.data[i + 3] / 255;
        a += pa; l += pa * luminance([pix.data[i], pix.data[i + 1], pix.data[i + 2]]);
        r += pix.data[i] * pa; g += pix.data[i + 1] * pa; b += pix.data[i + 2] * pa; wsum += pa;
      }
      alpha[cy * N + cx] = a / (cell * cell);
      lum[cy * N + cx] = a > 0 ? l / a / 255 : 0;
    }
    return { alpha: Array.from(alpha), lum: Array.from(lum), col: wsum ? [r / wsum, g / wsum, b / wsum] : [0, 0, 0] };
  }
  function fingerprintDistance(a, b) {
    if (!a || !b) return 1;
    let ad = 0, ld = 0, n = 0;
    for (let i = 0; i < a.alpha.length; i++) {
      ad += Math.abs(a.alpha[i] - b.alpha[i]);
      if (a.alpha[i] > 0.15 || b.alpha[i] > 0.15) { ld += Math.abs(a.lum[i] - b.lum[i]); n++; }
    }
    ad /= a.alpha.length; ld = n ? ld / n : 0;
    const cd = Math.hypot(a.col[0] - b.col[0], a.col[1] - b.col[1], a.col[2] - b.col[2]) / 441;
    return ad * 1.6 + ld * 0.9 + cd * 0.9;
  }
  function traitSignature(tr) {
    const pal = hexToRgb(tr.palette.skin), out = hexToRgb(tr.palette.outfit);
    return [BODY_PLANS.indexOf(tr.bodyPlan), tr.size, tr.horns, tr.wings, tr.tail, tr.outfit.style, tr.outfit.helm, tr.outfit.hood ? 1 : 0, Math.round(rgbToHsl(pal)[0] / 30), Math.round(rgbToHsl(out)[0] / 30), (tr.items || []).map((i) => i.type).join(',')].join('|');
  }
  function traitSignatureDistance(a, b) {
    const sa = traitSignature(a).split('|'), sb = traitSignature(b).split('|');
    let d = 0;
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) d += i === 0 ? 3 : 1;
    return d / (sa.length + 2);
  }
  // Re-roll the variation until the sprite is far enough from every known sprite (others: [{fingerprint}|spec]).
  function ensureDistinctSpriteSpec(spec, others, opts) {
    const o = opts || {};
    const threshold = o.threshold || 0.17;
    const tries = o.tries || 6;
    const fps = (others || []).map((x) => (x && x.alpha ? x : (x && x.fingerprint ? x.fingerprint : (isProceduralSpec(x) ? spriteFingerprint(x) : null)))).filter(Boolean);
    if (!fps.length) return { spec, fingerprint: spriteFingerprint(spec), distance: 1, rerolls: 0 };
    const minDist = (fp) => fps.reduce((m, f) => Math.min(m, fingerprintDistance(fp, f)), Infinity);
    let best = spec, bestFp = spriteFingerprint(spec), bestD = minDist(bestFp), rerolls = 0;
    for (let k = 1; k <= tries && bestD < threshold; k++) {
      const cand = withVariant(spec, (spec.variant | 0) + k);
      const fp = spriteFingerprint(cand);
      const d = minDist(fp);
      rerolls = k;
      if (d > bestD) { best = cand; bestFp = fp; bestD = d; }
    }
    return { spec: best, fingerprint: bestFp, distance: bestD, rerolls };
  }
  // ---- Built-in presets: fixed, hand-authored trait specs (never sent to the LLM) ----------------------------
  // Mortacia / Suzerain 3D billboards (2D stays hand-made in renderCharacterSprite.js).
  // Mortacia: Number Six tall SLENDER hourglass — long legs, continuous thighs, lean limbs, long tip-UP sword.
  // Suzerain: slim plate knight + RED cape — lean armored limbs (not bulky), spaulders, long tip-UP sword.
  const PRESET_TRAITS = {
    mortacia: {
      sheet: { name: 'Mortacia', sex: 'Female', race: 'Goddess', class: 'Assassin-Fighter-Necromancer-Goddess', level: 20 },
      salt: 0x6d6f7274,
      traits: {
        v: 1, bodyPlan: 'humanoid', size: 'large', build: 'slender', covering: 'skin', head: 'human', horns: 'none',
        wings: 'bat', tail: 'none', ears: 'human', hair: 'long', eyes: { count: 2, style: 'normal', glow: false },
        extraArms: 0, tentacles: 0, spikes: false, mane: false, beard: false, tusks: false, fangs: false, claws: false,
        translucency: 0, tattered: false, floating: false, halo: false, nagaTorso: false, markings: 'none', element: 'shadow',
        palette: {
          skin: '#e8c4a8', skin2: '#c49a7a', hair: '#f0ebe0', outfit: '#6a6a72', outfit2: '#4a4a52', trim: '#8a8a92',
          metal: '#9a9ca4', eye: '#2a2030', glow: '#a890c8', aura: '#a890c8'
        },
        outfit: { style: 'none', hood: false, cape: false, helm: 'none', symbol: 'none' },
        items: [
          { slot: 'weapon', type: 'sword', name: 'sword', color: '#d4c8a0', accent: '#5a5a62', glow: false, shape: '' }
        ],
        aura: { color: '#a890c8', strength: 0.18 }, handGlow: false, planConfidence: 0, signature: true,
        heroic: true, statuesque: true, naturalLimbs: true, longBlade: true, headroom: 12, worldScale: 1.5, wingColor: '#6e6e76', wingScale: 1.3, wingHang: 1.0, raggedWings: true, weaponPose: 'ready',
        garment: { color: '#5a5a62', length: 0.28, highCut: true, buttCape: true, capeLength: 0.85, top: true, bottom: true, bikini: true },
        bootColor: '#3e3e46', bootHeight: 0.5, worldAura: 0.16
      }
    },
    suzerain: {
      sheet: { name: 'Suzerain', sex: 'Male', race: 'Human', class: 'Knight of Atinus', level: 20 },
      salt: 0x73757a65,
      traits: {
        v: 1, bodyPlan: 'humanoid', size: 'medium', build: 'heavy', covering: 'skin', head: 'human', horns: 'none',
        wings: 'none', tail: 'none', ears: 'human', hair: 'none', eyes: { count: 2, style: 'normal', glow: false },
        extraArms: 0, tentacles: 0, spikes: false, mane: false, beard: false, tusks: false, fangs: false, claws: false,
        translucency: 0, tattered: false, floating: false, halo: false, nagaTorso: false, markings: 'none', element: 'holy',
        palette: {
          skin: '#e0c098', skin2: '#b89070', hair: '#3a2a1a', outfit: '#4a4e56', outfit2: '#34383e', trim: '#b89440',
          metal: '#7a8088', eye: '#1a1a1a', glow: '#ffe8a0', aura: '#ffe8a0'
        },
        outfit: { style: 'plate', hood: false, cape: true, helm: 'closed', symbol: 'holy' },
        capeColor: '#aa2222',
        items: [
          { slot: 'weapon', type: 'sword', name: 'longsword', color: '#c8ccd4', accent: '#b89440', glow: false, shape: '' }
        ],
        aura: { color: '#ffe8a0', strength: 0 }, handGlow: false, planConfidence: 0, signature: true,
        // slim knight: naturalLimbs but build stays plate-readable without bulky segments
        heroic: true, naturalLimbs: true, longBlade: true, plateSegments: false, pauldrons: true, plume: '#6a7078', worldScale: 1.08, weaponPose: 'ready'
      }
    }
  };
  const presetSpecCache = {};
  function presetKeyOf(name) {
    const first = String(name || '').trim().toLowerCase().split(/\s+/)[0];
    return Object.prototype.hasOwnProperty.call(PRESET_TRAITS, first) ? first : null;
  }
  // Fixed detailed spec for a built-in preset (null for everyone else). Stable: same object every call.
  function getPresetProceduralSpec(name) {
    const k = presetKeyOf(name);
    if (!k) return null;
    if (!presetSpecCache[k]) {
      const p = PRESET_TRAITS[k];
      const spec = buildProceduralSpriteSpec(p.sheet, p.traits, { salt: p.salt, variant: 0, source: 'preset', signature: false });
      spec.preset = k;
      presetSpecCache[k] = spec;
    }
    return presetSpecCache[k];
  }

  function createProceduralCharacterSprite(sheet, opts) {
    const o = opts || {};
    const spec = buildProceduralSpriteSpec(sheet, o.traits || null, o);
    return { spec, dataUrl: proceduralDataUrl(spec, { scale: o.scale || DEFAULT_SCALE }) };
  }

  return {
    GRID, SPEC_VERSION, DEFAULT_SCALE, BODY_PLANS,
    hashString, makeRng,
    parseConsoleCharacterSheets, parseSheetBlock, parseEquippedLine, normalizeSheet,
    deriveFallbackTraits, normalizeTraitSpec, validateTraitSpec, traitSchemaDescription,
    buildProceduralSpriteSpec, withVariant, isProceduralSpec,
    renderProceduralPixels, createProceduralCharacterCanvas, createProceduralSheetCanvas, proceduralDataUrl,
    createProceduralCharacterSprite,
    spriteFingerprint, fingerprintDistance, traitSignature, traitSignatureDistance, ensureDistinctSpriteSpec,
    PRESET_TRAITS, getPresetProceduralSpec, isPresetName: (n) => !!presetKeyOf(n),
    renderBillboardPixels, createBillboardCanvas, supportsBackView,
    normalizeBillboardView, deriveViewFromFront
  };
});
