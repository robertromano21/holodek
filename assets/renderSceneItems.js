// renderSceneItems.js
// Procedural pixel-art sprites for "Objects in Room" items (weapon, amulet, book, potion, ...), drawn from the
// item's name + type + magic level so every object the room text names gets its own pickable sprite in the 2D
// combat map and as a Doom-style billboard in the 3D view. Works in the browser and in node (preview / tests).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SceneItems = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const G = 32; // logical grid
  function hash(s) { let h = 2166136261; s = String(s || ''); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9E3779B9) >>> 0; return s / 4294967296; }; }
  function hex(c) { return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
  function rgb(h) { const m = String(h).replace('#', ''); return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]; }
  function shade(c, f) { return f >= 0 ? c.map((v) => v + (255 - v) * f) : c.map((v) => v * (1 + f)); }

  // ---- classification: name words first, declared type second, generic fallback last ----
  const KINDS = [
    ['sword', /\b(sword|blade|sabre|saber|scimitar|katana|longsword|claymore|falchion|rapier)\b/],
    ['dagger', /\b(dagger|knife|dirk|stiletto|kris|shiv)\b/],
    ['axe', /\b(axe|hatchet|cleaver)\b/],
    ['hammer', /\b(hammer|maul|mace|morningstar|flail|club|cudgel)\b/],
    ['spear', /\b(spear|lance|pike|halberd|trident|glaive|javelin)\b/],
    ['bow', /\b(bow|crossbow|longbow)\b/],
    ['staff', /\b(staff|rod|wand|sceptre|scepter|crook|cane|scourge)\b/],
    ['shield', /\b(shield|buckler|aegis)\b/],
    ['helm', /\b(helm|helmet|crown|circlet|diadem|tiara|mask|cowl)\b/],
    ['armor', /\b(armou?r|mail|breastplate|cuirass|robe|cloak|mantle|tunic|vest)\b/],
    ['amulet', /\b(amulet|necklace|pendant|talisman|locket|medallion|torc|charm)\b/],
    ['ring', /\b(ring|band|signet)\b/],
    ['book', /\b(book|tome|ledger|grimoire|codex|journal|diary|manual|bible|chronicle|almanac)\b/],
    ['scroll', /\b(scroll|parchment|map|letter|note|page|deed|charter|missive)\b/],
    ['potion', /\b(potion|vial|flask|elixir|philter|phial|tonic|draught|bottle|brew)\b/],
    ['gem', /\b(gem|jewel|shard|crystal|stone|diamond|ruby|emerald|sapphire|opal|pearl|eye|heart)\b/],
    ['orb', /\b(orb|sphere|globe|ball)\b/],
    ['key', /\b(key|keystone)\b/],
    ['coins', /\b(coin|coins|gold|silver|purse|pouch|treasure|sovereigns?|crowns)\b/],
    ['skull', /\b(skull|head|bone|relic|idol|fetish|figurine|statuette)\b/],
    ['lantern', /\b(lantern|lamp|candle|torch|brazier)\b/],
    ['horn', /\b(horn|bell|chime|flute|lute|harp|drum)\b/],
    ['chest', /\b(chest|box|casket|coffer|urn|reliquary|chalice|goblet|cup|bowl)\b/],
    ['boots', /\b(boots?|greaves|sandals?|gloves?|gauntlets?|bracers?)\b/]
  ];
  function itemKind(item) {
    const n = String(item && item.name || '').toLowerCase();
    for (const [k, re] of KINDS) if (re.test(n)) return k;
    const t = String(item && item.type || '').toLowerCase();
    if (/weapon/.test(t)) return 'sword';
    if (/armou?r/.test(t)) return 'armor';
    if (/shield/.test(t)) return 'shield';
    if (/potion|consum/.test(t)) return 'potion';
    if (/ring/.test(t)) return 'ring';
    if (/amulet|jewel/.test(t)) return 'amulet';
    if (/book|scroll/.test(t)) return 'book';
    return 'bundle';
  }
  // material tint from words in the name
  const MATS = [
    [/\b(gold|golden|gilded|sun)/, '#d8b040'], [/\b(silver|moon|mithril)/, '#c8ccd8'], [/\b(bone|ivory|skull)/, '#e0d6bc'],
    [/\b(obsidian|shadow|night|void|black|dark)/, '#4a4058'], [/\b(blood|crimson|scarlet|ruby|flame|fire|ember|red)/, '#b8382c'],
    [/\b(frost|ice|winter|sapphire|blue|azure|tide|sea)/, '#5a8ad0'], [/\b(emerald|jade|verdant|green|venom|poison)/, '#3c9a52'],
    [/\b(soul|spirit|echo|ghost|wraith|spectral)/, '#9ab8d8'], [/\b(copper|bronze|brass)/, '#b0703c'], [/\b(rust|rusted)/, '#8a4a2a'],
    [/\b(oak|wood|ash|elm|yew)/, '#7a5434'], [/\b(iron|steel)/, '#8a909a']
  ];
  const GLOWS = [[/\b(soul|spirit|echo|ghost|spectral|void|shade)/, '#a8c8ff'], [/\b(fire|flame|ember|sun|blaze)/, '#ffb040'], [/\b(frost|ice|winter)/, '#a0e8ff'],
    [/\b(blood|crimson|doom|curse|scourge)/, '#ff4a4a'], [/\b(holy|light|dawn|sacred|divine)/, '#fff0a0'], [/\b(venom|poison|plague|rot)/, '#9aff6a'], [/\b(shadow|night|dark|necro)/, '#b070ff']];
  // Prefer an LLM/server assembly block when present (kit of shaft/head/material/ornament/glow).
  function itemLook(item) {
    const n = String(item && item.name || '').toLowerCase();
    const h = hash(n + '|' + (item && item.type || '') + '|' + JSON.stringify(item && item.assembly || {}));
    const a = item && item.assembly;
    if (a && a.kind) {
      return {
        kind: a.kind, shaft: a.shaft, head: a.head, material: a.material, size: a.size, ornament: a.ornament,
        mat: a.color || null, accent: a.accent || null,
        glow: a.glow || null, magic: Math.max(0, Number(item.magic) || 0), seed: h, assembled: true
      };
    }
    let mat = null; for (const [re, c] of MATS) if (re.test(n)) { mat = c; break; }
    let glow = null; for (const [re, c] of GLOWS) if (re.test(n)) { glow = c; break; }
    const magic = Math.max(0, Number(item && item.magic) || 0);
    if (!glow && magic > 0) glow = ['#a8c8ff', '#c890ff', '#90ffd0', '#ffd890'][h % 4];
    return { kind: itemKind(item), mat, glow: magic > 0 || /glow|shimmer|radiant|luminous/.test(n) ? glow || '#c8d8ff' : null, magic, seed: h };
  }

  // ---- pixel buffer ----
  function Buf() { this.c = new Array(G * G).fill(null); }
  Buf.prototype.put = function (x, y, col) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < G && y < G && col) this.c[y * G + x] = col; };
  Buf.prototype.rect = function (x, y, w, h, col) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, col); };
  Buf.prototype.line = function (x0, y0, x1, y1, col, w) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) { const x = Math.round(x0 + (x1 - x0) * k / n), y = Math.round(y0 + (y1 - y0) * k / n); this.put(x, y, col); if (w > 1) this.put(x + 1, y, col); }
  };
  Buf.prototype.disc = function (cx, cy, r, col, light) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = x * x + y * y; if (d > r * r + r * 0.6) continue;
      let c = col; if (light) { const l = (-x - y) / (r * 2); c = shade(col, l > 0.25 ? 0.35 : l < -0.3 ? -0.35 : 0); }
      this.put(cx + x, cy + y, c);
    }
  };

  const SHAFT_COL = { wood: '#7a5434', bone: '#e0d6bc', iron: '#8a909a', steel: '#b8bcc8', bronze: '#b0703c', crystal: '#9ad0e8', shadow: '#4a4058', vine: '#4a6a32', gold: '#d8b040', none: '#9aa0aa' };
  function assembleFromParts(b, look) {
    if (!look.assembled) return false;
    const shaft = look.shaft || 'none', head = look.head || 'none', orn = look.ornament || 'none';
    const sc = rgb(look.mat || SHAFT_COL[shaft] || '#9aa0aa');
    const ac = rgb(look.accent || look.glow || '#c8a040');
    const wood = rgb(SHAFT_COL.wood);
    const size = look.size === 'large' ? 1.15 : look.size === 'small' ? 0.75 : 1;
    // shaft
    if (shaft !== 'none' && ['sword','dagger','axe','hammer','spear','staff','bow','lantern'].includes(look.kind)) {
      const len = Math.round(14 * size);
      if (look.kind === 'bow') { for (let a = -1.1; a <= 1.1; a += 0.05) b.put(10 + Math.cos(a) * 12 * size, 16 + Math.sin(a) * 12 * size, wood); b.line(14, 5, 14, 27, [220, 220, 210], 1); }
      else b.line(9, 28, 9 + Math.round(10 * size), 28 - len, shaft === 'wood' || shaft === 'vine' ? wood : sc, shaft === 'shadow' ? 1 : 2);
    }
    // head
    const hx = 9 + Math.round(10 * size), hy = 28 - Math.round(14 * size);
    if (head === 'blade' || head === 'curved_blade') {
      for (let k = 0; k < Math.round(10 * size); k++) { const x = hx + k, y = hy - k; b.put(x, y, sc); b.put(x - 1, y, shade(sc, 0.35)); if (head === 'curved_blade') b.put(x + 1, y + 1, shade(sc, -0.3)); }
      b.line(hx - 2, hy + 1, hx + 2, hy - 1, ac, 1);
    } else if (head === 'axe_head') { b.disc(hx + 2, hy + 2, 5, sc, true); }
      else if (head === 'hammer_head') { b.rect(hx - 2, hy, 9, 5, sc); }
      else if (head === 'spear_point') { b.line(hx, hy, hx + 4, hy - 5, shade(sc, 0.4), 2); }
      else if (head === 'orb' || head === 'crystal') { b.disc(hx + 1, hy, 3, look.glow ? rgb(look.glow) : ac, true); }
      else if (head === 'skull') { b.disc(hx, hy, 4, rgb('#e0d6bc'), true); b.put(hx - 1, hy, [30,24,26]); b.put(hx + 1, hy, [30,24,26]); }
      else if (head === 'gem') { b.disc(16, 18, 5, look.glow ? rgb(look.glow) : ac, true); }
      else if (head === 'cross') { b.rect(15, 12, 2, 10, ac); b.rect(12, 15, 8, 2, ac); }
      else if (head === 'flame') { b.disc(hx, hy, 3, rgb('#ffb040'), true); b.put(hx, hy - 3, rgb('#ffe080')); }
      else if (head === 'horn') { b.line(hx, hy, hx + 5, hy + 8, shade(sc, -0.3), 1); b.line(hx + 1, hy, hx + 7, hy + 5, shade(sc, -0.3), 1); }
      else if (head === 'book_cover') { const cov = sc; b.rect(7, 9, 18, 15, cov); b.rect(7, 22, 18, 3, [224, 214, 186]); b.rect(13, 13, 6, 6, ac); }
      else if (head === 'vial') { b.rect(14, 5, 4, 2, [140, 100, 60]); b.disc(16, 19, 7, [200, 220, 230]); b.disc(16, 20, 6, look.glow ? rgb(look.glow) : ac, true); }
      else if (head === 'key_bit') { const c = sc; for (let a = 0; a < 6.3; a += 0.2) b.put(10 + Math.cos(a) * 4, 12 + Math.sin(a) * 4, c); b.line(13, 15, 25, 25, c, 2); }
      else if (head === 'coin_pile') { for (let i = 0; i < 6; i++) b.disc(9 + (i * 3) % 14, 15 + (i % 3) * 3, 3, sc, true); }
      else if (head === 'lantern_cage') { b.rect(11, 9, 10, 15, shade(sc, -0.3)); b.rect(13, 11, 6, 11, look.glow ? rgb(look.glow) : rgb('#ffc860')); }
    // ornaments
    if (orn === 'runes') { b.put(12, 14, ac); b.put(12, 16, ac); b.put(14, 15, ac); }
    else if (orn === 'wrap') { b.rect(10, 18, 4, 2, rgb('#6a4a30')); }
    else if (orn === 'chain' && look.kind === 'amulet') { /* chain drawn with gem above */ const chain = sc; b.line(7, 7, 13, 16, chain, 1); b.line(25, 7, 19, 16, chain, 1); }
    else if (orn === 'rust') { b.put(11, 20, rgb('#8a4a2a')); b.put(14, 12, rgb('#8a4a2a')); }
    else if (orn === 'holy_sigil') { b.put(16, 14, ac); b.put(15, 15, ac); b.put(17, 15, ac); b.put(16, 16, ac); }
    else if (orn === 'shadow_wisp') { b.put(20, 10, rgb(look.glow || '#b070ff')); b.put(22, 14, rgb(look.glow || '#b070ff')); }
    else if (orn === 'feathers') { b.put(hx + 2, hy + 2, [220, 210, 190]); b.put(hx + 3, hy + 4, [200, 190, 170]); }
    else if (orn === 'spikes') { b.put(hx - 2, hy, sc); b.put(hx + 4, hy, sc); }
    // kinds without shaft still need a figure
    if (shaft === 'none' && head === 'none') return false;
    if (['amulet','ring','shield','helm','armor','boots','chest','bundle','scroll'].includes(look.kind) && head === 'none') return false;
    if (look.kind === 'amulet' && head === 'gem') { /* already */ }
    if (look.kind === 'ring') { const c = sc; for (let a = 0; a < 6.3; a += 0.15) { b.put(16 + Math.cos(a) * 6, 19 + Math.sin(a) * 4, c); } b.disc(16, 13, 3, ac, true); }
    if (look.kind === 'shield') { for (let y = 6; y < 27; y++) { const w = y < 18 ? 10 : Math.max(1, 10 - (y - 18) * 1.2); for (let x = -w; x <= w; x++) b.put(16 + x, y, Math.abs(x) > w - 1.5 || y < 7.5 ? shade(sc, -0.4) : sc); } b.disc(16, 14, 2, ac, true); }
    return true;
  }

  function drawKind(b, look) {
    if (assembleFromParts(b, look)) return;
    const r = rng(look.seed);
    const metal = rgb(look.mat || '#b8bcc8'), M = metal, Md = shade(metal, -0.4), Ml = shade(metal, 0.45);
    const wood = rgb(look.mat && /wood|oak/.test(look.mat) ? look.mat : '#7a5434');
    const accent = rgb(look.glow || ['#c8a040', '#b03838', '#3870c0', '#40a060'][look.seed % 4]);
    const leather = [110, 70, 44];
    switch (look.kind) {
      case 'sword': case 'dagger': {
        const L = look.kind === 'sword' ? 18 : 10; const x0 = 8, y0 = 25;
        for (let k = 0; k < L; k++) { b.put(x0 + 4 + k, y0 - 4 - k, M); b.put(x0 + 4 + k, y0 - 5 - k, Ml); b.put(x0 + 5 + k, y0 - 4 - k, Md); }
        b.line(x0 + 1, y0 - 6, x0 + 6, y0 - 1, accent, 1); b.line(x0, y0 + 1, x0 + 3, y0 - 2, leather, 2); b.put(x0 - 1, y0 + 2, accent);
        break;
      }
      case 'axe': b.line(9, 27, 21, 7, wood, 2); b.disc(21, 9, 5, M, true); b.rect(14, 5, 5, 9, null); for (let y = 4; y < 15; y++) b.put(16, y, Md); break;
      case 'hammer': b.line(10, 27, 19, 9, wood, 2); b.rect(14, 4, 11, 7, M); b.rect(14, 4, 11, 2, Ml); b.rect(14, 9, 11, 2, Md); break;
      case 'spear': b.line(5, 29, 22, 8, wood, 1); b.line(22, 8, 27, 2, Ml, 2); b.put(21, 10, accent); b.put(20, 10, accent); break;
      case 'bow': for (let a = -1.1; a <= 1.1; a += 0.05) b.put(10 + Math.cos(a) * 12, 16 + Math.sin(a) * 12, wood); b.line(14, 5, 14, 27, [220, 220, 210], 1); break;
      case 'staff': {
        b.line(9, 29, 21, 8, wood, 2); b.line(10, 29, 22, 8, shade(wood, -0.3), 1);
        b.disc(23, 6, 3, look.glow ? rgb(look.glow) : accent, true);
        if (/scourge|flail/.test(look.name || '')) { b.line(23, 9, 27, 18, Md, 1); b.line(24, 9, 29, 15, Md, 1); }
        break;
      }
      case 'shield': for (let y = 6; y < 27; y++) { const w = y < 18 ? 10 : Math.max(1, 10 - (y - 18) * 1.2); for (let x = -w; x <= w; x++) b.put(16 + x, y, Math.abs(x) > w - 1.5 || y < 7.5 ? Md : (x < 0 ? M : shade(M, -0.15))); } b.disc(16, 14, 2, accent, true); break;
      case 'helm':
        if (/crown|circlet|tiara|diadem/.test(look.name || '')) { const c = rgb(look.mat || '#d8b040'); b.rect(8, 16, 17, 7, c); b.rect(8, 21, 17, 2, shade(c, -0.35)); for (let i = 0; i < 5; i++) { b.rect(8 + i * 4, 10 + (i % 2) * 2, 1, 6 - (i % 2) * 2, c); b.put(8 + i * 4, 9 + (i % 2) * 2, shade(c, 0.4)); } b.put(16, 18, accent); b.put(11, 18, [180, 40, 40]); b.put(21, 18, [40, 90, 180]); break; }
        b.disc(16, 16, 8, M, true); b.rect(8, 16, 17, 8, M); b.rect(10, 18, 13, 2, [20, 18, 24]); b.rect(15, 18, 2, 5, [20, 18, 24]); b.rect(8, 23, 17, 1, Md); break;
      case 'armor': b.rect(9, 8, 14, 16, M); b.rect(6, 8, 4, 6, Md); b.rect(22, 8, 4, 6, Md); b.rect(13, 8, 6, 2, [20, 18, 24]); for (let y = 12; y < 24; y += 3) b.rect(9, y, 14, 1, Md); b.rect(9, 8, 2, 16, Ml); break;
      case 'amulet': {
        const chain = rgb(look.mat || '#c8a040');
        for (let a = 0.3; a < Math.PI - 0.3; a += 0.12) b.put(16 + Math.cos(a) * 9, 8 + Math.sin(a) * -0 + (1 - Math.sin(a)) * 0 + Math.sin(a) * 9 - 9 + 6, chain);
        b.line(7, 7, 13, 18, chain, 1); b.line(25, 7, 19, 18, chain, 1);
        b.disc(16, 21, 5, shade(chain, -0.25), true); b.disc(16, 21, 3, look.glow ? rgb(look.glow) : accent, true); b.put(15, 19, [255, 255, 255]);
        break;
      }
      case 'ring': { const c = rgb(look.mat || '#d8b040'); for (let a = 0; a < 6.3; a += 0.15) { b.put(16 + Math.cos(a) * 6, 19 + Math.sin(a) * 4, c); b.put(16 + Math.cos(a) * 6, 20 + Math.sin(a) * 4, shade(c, -0.35)); } b.disc(16, 13, 3, accent, true); break; }
      case 'book': {
        const cov = rgb(look.mat || ['#6a2a2a', '#2a3a6a', '#3a4a2a', '#4a3a2a'][look.seed % 4]);
        b.rect(7, 9, 18, 15, cov); b.rect(7, 22, 18, 3, [224, 214, 186]); b.rect(7, 24, 18, 1, shade(cov, -0.4)); b.rect(7, 9, 2, 16, shade(cov, -0.3));
        b.rect(13, 13, 6, 6, rgb(look.mat && /gold/.test(look.mat) ? '#f0d070' : '#c8a040')); b.rect(14, 14, 4, 4, cov); b.put(15, 15, accent); b.put(16, 16, accent);
        b.rect(9, 9, 16, 1, shade(cov, 0.25));
        break;
      }
      case 'scroll': b.rect(9, 9, 14, 14, [222, 206, 168]); b.rect(7, 8, 18, 3, [196, 176, 136]); b.rect(7, 22, 18, 3, [196, 176, 136]); for (let y = 13; y < 21; y += 2) b.rect(11, y, 6 + (y * 7 % 5), 1, [120, 96, 70]); b.put(16, 24, [160, 30, 30]); break;
      case 'potion': {
        const liq = look.glow ? rgb(look.glow) : accent; b.rect(14, 5, 4, 2, [140, 100, 60]); b.rect(14, 7, 4, 4, [200, 220, 230]);
        b.disc(16, 19, 7, [200, 220, 230]); b.disc(16, 20, 6, liq, true); b.put(13, 16, [255, 255, 255]); b.put(13, 17, [255, 255, 255]);
        break;
      }
      case 'gem': { const c = look.glow ? rgb(look.glow) : rgb(look.mat || '#6ad0e0'); for (let y = 0; y < 14; y++) { const w = y < 4 ? 3 + y * 1.5 : Math.max(0, 9 - (y - 4) * 0.9); for (let x = -w; x <= w; x++) b.put(16 + x, 9 + y, x < -w / 3 ? shade(c, 0.35) : x > w / 3 ? shade(c, -0.35) : c); } b.put(14, 12, [255, 255, 255]); break; }
      case 'orb': b.disc(16, 16, 8, look.glow ? rgb(look.glow) : rgb(look.mat || '#7a6ad0'), true); b.rect(11, 24, 10, 3, Md); b.put(13, 12, [255, 255, 255]); b.put(12, 13, [255, 255, 255]); break;
      case 'key': { const c = rgb(look.mat || '#c8a040'); for (let a = 0; a < 6.3; a += 0.2) b.put(10 + Math.cos(a) * 4, 12 + Math.sin(a) * 4, c); b.line(13, 15, 25, 25, c, 2); b.rect(21, 23, 2, 4, c); b.rect(24, 22, 2, 3, c); break; }
      case 'coins': { const c = rgb(look.mat && /rust|copper/.test(look.mat) ? look.mat : '#d8b040'); for (let i = 0; i < 6; i++) { const x = 9 + (r() * 14) | 0, y = 15 + (r() * 9) | 0; b.disc(x, y, 3, c, true); b.put(x, y, shade(c, -0.35)); } break; }
      case 'skull': { const c = rgb(look.mat || '#e0d6bc'); b.disc(16, 14, 7, c, true); b.rect(12, 19, 9, 5, c); b.rect(12, 13, 3, 3, [30, 24, 26]); b.rect(18, 13, 3, 3, [30, 24, 26]); b.put(16, 17, [60, 50, 50]); for (let x = 13; x < 20; x += 2) b.put(x, 22, [60, 50, 50]); break; }
      case 'lantern': b.rect(11, 9, 10, 15, Md); b.rect(13, 11, 6, 11, rgb(look.glow || '#ffc860')); b.rect(10, 7, 12, 2, M); b.rect(10, 24, 12, 2, M); for (let a = 3.3; a < 6.2; a += 0.2) b.put(16 + Math.cos(a) * 4, 6 + Math.sin(a) * 3, M); break;
      case 'horn': for (let k = 0; k < 16; k++) b.disc(8 + k, 22 - Math.round(Math.sin(k / 5) * 8), Math.max(1, Math.round(k / 4)), shade(rgb(look.mat || '#d8c8a0'), k % 4 ? 0 : -0.25)); break;
      case 'chest': { const c = rgb(look.mat || '#8a5a34'); b.rect(7, 12, 18, 13, c); b.rect(7, 10, 18, 4, shade(c, 0.2)); b.rect(7, 15, 18, 1, Md); b.rect(15, 15, 3, 4, rgb('#d8b040')); b.rect(7, 12, 1, 13, Md); b.rect(24, 12, 1, 13, Md); break; }
      case 'boots': { const c = rgb(look.mat || '#6a4a30'); b.rect(9, 8, 6, 14, c); b.rect(9, 20, 10, 5, c); b.rect(18, 9, 6, 13, shade(c, -0.2)); b.rect(18, 20, 9, 5, shade(c, -0.2)); b.rect(9, 8, 6, 2, shade(c, 0.3)); break; }
      default: { const c = rgb(look.mat || '#8a6a4a'); b.disc(16, 18, 7, c, true); b.line(12, 11, 20, 11, shade(c, -0.4), 1); b.rect(14, 9, 4, 3, shade(c, -0.3)); b.put(16, 18, accent); }
    }
  }
  function outline(b) {
    const out = b.c.slice();
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      if (b.c[y * G + x]) continue;
      let n = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < G && yy < G && b.c[yy * G + xx]) { n = b.c[yy * G + xx]; break; } }
      if (n) out[y * G + x] = shade(n, -0.75);
    }
    b.c = out;
  }
  /** RGBA pixels (G*scale square) for an item. Magic items get a soft glow halo + sparkle. */
  function renderItemPixels(item, opts) {
    const o = opts || {}; const scale = Math.max(1, o.scale | 0 || 2); const look = itemLook(item); look.name = String(item && item.name || '').toLowerCase();
    const b = new Buf(); drawKind(b, look); outline(b);
    const S = G * scale; const data = new Uint8ClampedArray(S * S * 4);
    if (look.glow) {
      const gc = rgb(look.glow); const strength = Math.min(1, 0.35 + look.magic * 0.15);
      // halo: distance to nearest opaque pixel (coarse)
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
        if (b.c[y * G + x]) continue; let best = 9;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < G && yy < G && b.c[yy * G + xx]) best = Math.min(best, Math.hypot(dx, dy)); }
        if (best <= 3) { const a = Math.round(255 * strength * (1 - best / 3.6)); if (a > 0) for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) { const p = ((y * scale + j) * S + x * scale + i) * 4; data[p] = gc[0]; data[p + 1] = gc[1]; data[p + 2] = gc[2]; data[p + 3] = a; } }
      }
      const r = rng(look.seed ^ 77); for (let k = 0; k < 3 + look.magic; k++) { const x = (r() * G) | 0, y = (r() * G * 0.8) | 0; if (!b.c[y * G + x]) b.c[y * G + x] = shade(gc, 0.6); }
    }
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const c = b.c[y * G + x]; if (!c) continue;
      for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) { const p = ((y * scale + j) * S + x * scale + i) * 4; data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255; }
    }
    let maxY = 0; for (let i = 0; i < G * G; i++) if (b.c[i]) maxY = Math.max(maxY, (i / G) | 0);
    return { w: S, h: S, data, kind: look.kind, glow: look.glow, footInset: (G - 1 - maxY) / G };
  }
  function itemKey(item) { return [item && item.name, item && item.type, item && item.magic].join('|').toLowerCase(); }
  const canvasCache = new Map();
  /** Canvas for the item (browser: document canvas; node: pass createCanvas). */
  function createItemCanvas(item, opts) {
    const o = opts || {}; const key = itemKey(item) + '|' + (o.scale || 2);
    if (canvasCache.has(key) && !o.createCanvas) return canvasCache.get(key);
    const pix = renderItemPixels(item, o);
    const cv = o.createCanvas ? o.createCanvas(pix.w, pix.h) : (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: pix.w, height: pix.h }) : null);
    if (!cv) return null;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(pix.w, pix.h); img.data.set(pix.data); ctx.putImageData(img, 0, 0);
    cv._itemKind = pix.kind; cv._footInset = pix.footInset;
    if (!o.createCanvas) canvasCache.set(key, cv);
    return cv;
  }
  const imageCache = new Map();
  /** HTMLImageElement version (Phaser RenderTexture.draw accepts images); null until it has loaded. */
  function getItemImage(item) {
    if (typeof Image === 'undefined') return null;
    const key = itemKey(item); let img = imageCache.get(key);
    if (!img) { const cv = createItemCanvas(item); if (!cv) return null; img = new Image(); img.src = cv.toDataURL('image/png'); imageCache.set(key, img); }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
  function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  /** Parse "Objects in Room:" (+ Properties) from a game-console string into [{name,type,magic}]. */
  function parseRoomObjects(consoleText) {
    const t = String(consoleText || '');
    const m = t.match(/Objects in Room:[ \t]*([^\n]*)/);
    if (!m) return null;
    const names = m[1].split(/,\s*/).map((s) => s.trim()).filter((s) => s && !/^none\.?$/i.test(s) && s.toLowerCase() !== 'nothing');
    const props = {}; const pm = t.match(/Objects in Room Properties:[ \t]*([^\n]*)/);
    if (pm) { const re = /\{([^}]*)\}/g; let q; while ((q = re.exec(pm[1]))) { const body = q[1]; const nm = (body.match(/name:\s*"([^"]+)"/) || [])[1]; if (!nm) continue; props[normName(nm)] = { type: (body.match(/type:\s*"([^"]*)"/) || [])[1] || '', magic: +((body.match(/magic:\s*(-?\d+)/) || [])[1] || 0) }; } }
    return names.map((n) => ({ name: n, type: (props[normName(n)] || {}).type || '', magic: (props[normName(n)] || {}).magic || 0 }));
  }
  return { renderItemPixels, createItemCanvas, getItemImage, itemKind, itemLook, parseRoomObjects, normName, GRID: G };
});
