// assets/renderSceneProps.js
// Pixel-art drawers for room landmarks and room objects, in the same 32x32 → 320x320
// nearest-neighbour catalog style as renderSprite_poke.js / renderCharacterSprite.js.
// Each drawer paints a transparent billboard standing on the bottom edge of the tile.
// Used server-side (node-canvas) to create custom_<type> sprites once per room coordinate.

'use strict';

const BASE = 32;

// ---------- deterministic RNG ----------
function seedFrom(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || 'seed');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- colour helpers ----------
function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
function shade(a, f) {
  const A = hexToRgb(a);
  return rgbToHex([A[0] * f, A[1] * f, A[2] * f]);
}

// ---------- materials ----------
const MATERIAL_PALETTES = {
  stone:    { base: '#7d776d', dark: '#4e4a44', light: '#aaa397', edge: '#2a2724' },
  marble:   { base: '#d9d4ca', dark: '#a39d92', light: '#fbf8f2', edge: '#5e5a54' },
  bone:     { base: '#d8ccb0', dark: '#9e9174', light: '#f5eedc', edge: '#4a4232' },
  obsidian: { base: '#2c2834', dark: '#16131b', light: '#5d5373', edge: '#050407' },
  wood:     { base: '#7a5532', dark: '#4a3119', light: '#a77a4c', edge: '#22150a' },
  metal:    { base: '#6c727a', dark: '#3a3e44', light: '#b1b8c2', edge: '#16181b' },
  rust:     { base: '#8a4a28', dark: '#4e2512', light: '#c07040', edge: '#24100a' },
  gold:     { base: '#c9a23a', dark: '#806420', light: '#f4dc7c', edge: '#3a2c0c' },
  crystal:  { base: '#7a5cc0', dark: '#3e2c6e', light: '#d2baff', edge: '#170f2a' },
  ash:      { base: '#6c6966', dark: '#3c3a38', light: '#a29e98', edge: '#171615' },
  flesh:    { base: '#9a4450', dark: '#5a1e28', light: '#d47c88', edge: '#220a0e' },
  ice:      { base: '#9fd0ea', dark: '#5a8cae', light: '#ecf9ff', edge: '#20384a' },
  earth:    { base: '#6e5236', dark: '#40301e', light: '#9c7a54', edge: '#1a120a' },
  moss:     { base: '#55703a', dark: '#2e3e1e', light: '#86a65a', edge: '#121a0a' },
  cloth:    { base: '#7a2a2a', dark: '#481414', light: '#b04848', edge: '#1e0808' },
  leaf:     { base: '#3e6a2e', dark: '#22401a', light: '#6a9a48', edge: '#0e1a0a' }
};

function paletteFor(material, tint) {
  const p = { ...(MATERIAL_PALETTES[material] || MATERIAL_PALETTES.stone) };
  if (tint) {
    for (const k of Object.keys(p)) p[k] = mix(p[k], tint, 0.18);
  }
  return p;
}

// ---------- pixel painter ----------
function makePainter(ctx) {
  const P = {
    rect(x, y, w, h, c) { if (!c || w <= 0 || h <= 0) return; ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
    px(x, y, c) { P.rect(x, y, 1, 1, c); },
    hline(x0, x1, y, c) { P.rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, c); },
    vline(x, y0, y1, c) { P.rect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c); },
    line(x0, y0, x1, y1, c) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let i = 0; i < 128; i++) {
        P.px(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    },
    ellipse(cx, cy, rx, ry, c) {
      for (let y = -ry; y <= ry; y++) {
        const span = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry || 1))));
        P.hline(cx - span, cx + span, Math.round(cy + y), c);
      }
    },
    // box with light top-left / dark bottom-right bevel
    block(x, y, w, h, pal) {
      P.rect(x, y, w, h, pal.base);
      P.hline(x, x + w - 1, y, pal.light);
      P.vline(x, y, y + h - 1, pal.light);
      P.hline(x, x + w - 1, y + h - 1, pal.dark);
      P.vline(x + w - 1, y, y + h - 1, pal.dark);
    },
    clear(x, y, w, h) { ctx.clearRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
    groundShadow(cx, w) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = 0; i < 2; i++) ctx.fillRect(Math.round(cx - w / 2 + i), 30 + i, Math.round(w - i * 2), 1);
    }
  };
  return P;
}

function speckle(P, rng, x, y, w, h, colors, n) {
  for (let i = 0; i < n; i++) P.px(x + Math.floor(rng() * w), y + Math.floor(rng() * h), colors[Math.floor(rng() * colors.length)]);
}
function crackLine(P, rng, x, y, len, c) {
  let cx = x, cy = y;
  for (let i = 0; i < len; i++) {
    P.px(cx, cy, c);
    cy += 1; cx += rng() < 0.5 ? -1 : (rng() < 0.5 ? 0 : 1);
  }
}
function rubbleAt(P, rng, pal, x0, x1, count = 5) {
  for (let i = 0; i < count; i++) {
    const w = 1 + Math.floor(rng() * 3);
    const x = x0 + Math.floor(rng() * Math.max(1, x1 - x0 - w));
    P.rect(x, 31 - 1, w, 2, rng() < 0.5 ? pal.base : pal.dark);
    P.px(x, 30, pal.light);
  }
}
function flame(P, x, y, h = 5, color = '#ffb040') {
  const core = mix(color, '#ffffff', 0.6), outer = mix(color, '#c02000', 0.35);
  P.rect(x - 1, y - h + 2, 3, h - 2, outer);
  P.rect(x, y - h, 1, h, color);
  P.rect(x, y - h + 3, 1, h - 3, core);
  P.px(x - 1, y - h + 1, color);
}

// ---------- landmark drawers ----------
// each: (P, pal, o, rng) ; o = { broken, burnt, glowing, overgrown, flooded, bloody, accent, light }
const DRAW = {};

DRAW.altar = (P, pal, o, rng) => {
  P.groundShadow(16, 26);
  P.block(8, 22, 16, 9, pal);                 // base
  P.rect(10, 24, 12, 1, pal.dark);
  P.block(5, 18, 22, 4, pal);                 // top slab
  P.hline(5, 26, 18, pal.light);
  if (o.glowing || o.light) { flame(P, 9, 18, 4, o.light || '#ffcc66'); flame(P, 22, 18, 4, o.light || '#ffcc66'); }
  P.rect(14, 25, 4, 4, pal.dark); P.rect(15, 26, 2, 2, o.accent || pal.light); // carved sigil
  if (o.bloody) { P.rect(12, 18, 6, 1, '#6a0c10'); P.vline(17, 19, 22, '#6a0c10'); }
  if (o.broken) {
    P.clear(20, 17, 8, 5); P.clear(22, 22, 3, 2);
    P.line(15, 18, 19, 31, pal.edge); P.line(16, 18, 20, 31, pal.edge);
    P.block(23, 27, 5, 4, pal); P.block(3, 28, 4, 3, pal);
    rubbleAt(P, rng, pal, 2, 30, 6);
  }
};

DRAW.statue = (P, pal, o, rng) => {
  P.groundShadow(16, 18);
  P.block(9, 26, 14, 5, pal);                 // plinth
  P.hline(9, 22, 26, pal.light);
  // robed figure
  P.rect(12, 14, 8, 12, pal.base);            // robe
  P.rect(11, 20, 10, 6, pal.base);
  P.vline(12, 14, 25, pal.light); P.vline(19, 14, 25, pal.dark);
  P.vline(15, 16, 25, pal.dark); P.vline(17, 18, 25, pal.dark); // folds
  P.rect(10, 14, 2, 7, pal.base); P.vline(10, 14, 20, pal.light); // left arm
  P.rect(20, 12, 2, 6, pal.base); P.vline(21, 12, 17, pal.dark);  // right arm raised
  P.rect(20, 7, 1, 6, pal.dark);              // staff / sword
  P.rect(13, 12, 6, 2, pal.base);             // shoulders
  P.rect(14, 7, 4, 5, pal.base);              // head
  P.px(14, 7, pal.light); P.hline(14, 17, 6, pal.light);
  P.px(15, 9, pal.edge); P.px(17, 9, pal.edge); // eyes
  if (o.glowing) { P.px(15, 9, o.accent || '#80d0ff'); P.px(17, 9, o.accent || '#80d0ff'); }
  if (o.burnt) { P.px(15, 10, '#202020'); P.vline(15, 10, 13, '#2a2a2a'); P.vline(17, 10, 12, '#2a2a2a'); } // soot tears
  if (o.broken) {
    P.clear(13, 5, 6, 7);                     // head gone
    P.clear(20, 6, 3, 12);                    // arm gone
    P.line(13, 12, 19, 14, pal.edge);
    P.block(23, 28, 4, 3, pal); P.rect(24, 28, 2, 1, pal.light); // head on ground
    rubbleAt(P, rng, pal, 4, 28, 4);
  }
};

DRAW.pillar = (P, pal, o, rng) => {
  P.groundShadow(16, 14);
  P.block(10, 27, 12, 4, pal); P.block(10, 2, 12, 3, pal);
  P.rect(11, 5, 10, 22, pal.base);
  for (let x = 12; x < 21; x += 2) P.vline(x, 5, 26, pal.dark);
  P.vline(11, 5, 26, pal.light);
  if (o.broken) DRAW.broken_columns(P, pal, o, rng, true);
};

DRAW.broken_columns = (P, pal, o, rng, redraw) => {
  if (redraw) P.clear(0, 0, 32, 32);
  P.groundShadow(16, 26);
  // standing stump
  P.block(5, 27, 11, 4, pal);
  P.rect(6, 13, 9, 14, pal.base);
  for (let x = 7; x < 15; x += 2) P.vline(x, 14, 26, pal.dark);
  P.vline(6, 13, 26, pal.light);
  // jagged top
  for (let x = 6; x < 15; x++) { const t = Math.floor(rng() * 4); P.clear(x, 10, 1, 3 + t); }
  P.hline(6, 14, 13 + 0, pal.light);
  // fallen drum
  P.rect(17, 25, 12, 6, pal.base); P.hline(17, 28, 25, pal.light); P.hline(17, 28, 30, pal.dark);
  P.ellipse(28, 28, 2, 3, pal.light); P.ellipse(28, 28, 1, 2, pal.dark);
  rubbleAt(P, rng, pal, 2, 30, 5);
};

DRAW.sarcophagus = (P, pal, o, rng) => {
  P.groundShadow(16, 28);
  P.block(3, 21, 26, 10, pal);
  P.block(2, 17, 28, 4, pal);                 // lid
  P.rect(10, 18, 12, 2, pal.dark);            // effigy
  P.rect(8, 18, 3, 2, pal.light);
  for (let x = 6; x < 27; x += 5) P.rect(x, 24, 3, 5, pal.dark);
  if (o.broken) { P.clear(20, 15, 11, 4); P.line(18, 17, 30, 14, pal.edge); P.block(22, 13, 9, 3, pal); }
};

DRAW.obelisk = (P, pal, o) => {
  P.groundShadow(16, 14);
  P.block(10, 27, 12, 4, pal);
  for (let y = 4; y < 27; y++) {
    const half = 3 + Math.floor((y - 4) / 9);
    P.hline(16 - half, 15 + half, y, pal.base);
    P.px(16 - half, y, pal.light); P.px(15 + half, y, pal.dark);
  }
  P.rect(15, 1, 2, 3, pal.light); P.px(14, 3, pal.base); P.px(17, 3, pal.dark);
  const g = o.glowing ? (o.accent || '#80c0ff') : pal.dark;
  for (let y = 8; y < 25; y += 4) { P.hline(14, 17, y, g); P.px(15, y + 1, g); }
};

DRAW.archway = (P, pal) => {
  P.groundShadow(16, 28);
  P.block(3, 8, 6, 23, pal); P.block(23, 8, 6, 23, pal);
  for (let x = 3; x < 29; x++) {
    const d = Math.abs(x - 16);
    const y = 2 + Math.floor((d * d) / 40);
    P.vline(x, y, Math.min(9, y + 4), pal.base);
    P.px(x, y, pal.light);
  }
  P.rect(14, 2, 4, 4, pal.light);
};

DRAW.throne = (P, pal, o) => {
  P.groundShadow(16, 22);
  P.block(9, 3, 14, 18, pal);                 // back
  P.rect(11, 5, 10, 14, o.accent || '#7a1a1a');
  P.block(7, 19, 18, 4, pal);                 // seat
  P.block(7, 15, 3, 6, pal); P.block(22, 15, 3, 6, pal); // arms
  P.block(8, 23, 3, 8, pal); P.block(21, 23, 3, 8, pal);
  P.px(10, 2, pal.light); P.px(21, 2, pal.light); P.px(16, 1, o.accent || '#d4b040');
};

DRAW.fountain = (P, pal, o) => {
  P.groundShadow(16, 28);
  P.block(3, 23, 26, 8, pal);
  P.rect(4, 23, 24, 2, '#3a6a9a'); P.hline(5, 26, 23, '#9cd0f0');
  P.block(14, 12, 4, 11, pal); P.block(10, 10, 12, 3, pal);
  P.vline(13, 4, 9, '#9cd0f0'); P.vline(18, 4, 9, '#9cd0f0'); P.rect(15, 2, 2, 8, '#bfe4ff');
};
DRAW.well = (P, pal) => {
  P.groundShadow(16, 24);
  P.block(5, 20, 22, 11, pal);
  P.rect(7, 20, 18, 2, '#1a2a3a');
  P.block(6, 6, 2, 14, MATERIAL_PALETTES.wood); P.block(24, 6, 2, 14, MATERIAL_PALETTES.wood);
  P.block(5, 4, 22, 3, MATERIAL_PALETTES.wood); P.vline(16, 7, 15, '#a08050'); P.block(14, 15, 4, 4, MATERIAL_PALETTES.wood);
};
DRAW.pool = (P, pal) => {
  P.ellipse(16, 28, 14, 3, pal.dark);
  P.ellipse(16, 28, 12, 2, '#2e5a7a');
  P.hline(8, 14, 27, '#8cc4e4'); P.hline(18, 22, 29, '#8cc4e4');
};

DRAW.brazier = (P, pal, o) => {
  const m = MATERIAL_PALETTES.metal;
  P.groundShadow(16, 14);
  P.line(11, 30, 14, 22, m.dark); P.line(21, 30, 18, 22, m.dark); P.vline(16, 22, 30, m.base);
  P.block(9, 18, 14, 4, m); P.rect(10, 17, 12, 1, '#401808');
  const c = o.light || '#ff9a30';
  flame(P, 12, 17, 6, c); flame(P, 16, 17, 9, c); flame(P, 20, 17, 6, c);
};
DRAW.campfire = (P, pal, o) => {
  const w = MATERIAL_PALETTES.wood;
  P.ellipse(16, 30, 9, 1, '#2a2622');
  for (let x = 7; x < 26; x += 3) P.block(x, 28, 3, 2, MATERIAL_PALETTES.stone);
  P.line(10, 29, 20, 24, w.dark); P.line(22, 29, 12, 24, w.base);
  const c = o.light || '#ff8a20';
  flame(P, 14, 26, 8, c); flame(P, 17, 26, 11, c); flame(P, 19, 26, 7, c);
};
DRAW.furnace = (P, pal, o) => {
  const stone = MATERIAL_PALETTES.stone, metal = MATERIAL_PALETTES.metal;
  P.groundShadow(16, 14);
  P.block(7, 10, 19, 21, stone);
  P.block(18, 1, 6, 11, metal);
  P.rect(10, 18, 13, 11, '#25140c');
  P.rect(11, 24, 11, 4, '#b84616');
  flame(P, 14, 26, 6, o.light || '#ffae42');
  flame(P, 19, 26, 8, o.light || '#ffae42');
  for (let x = 10; x <= 22; x += 3) P.vline(x, 18, 29, metal.dark);
};
DRAW.torch_stand = (P, pal, o) => {
  const m = MATERIAL_PALETTES.metal;
  P.groundShadow(16, 10);
  P.rect(13, 29, 7, 2, m.dark); P.vline(16, 9, 29, m.base); P.vline(15, 9, 29, m.light);
  P.block(13, 7, 7, 3, m); flame(P, 16, 7, 6, o.light || '#ffaa40');
};
DRAW.candelabra = (P, pal, o) => {
  const g = MATERIAL_PALETTES.gold;
  P.groundShadow(16, 10);
  P.rect(12, 29, 9, 2, g.dark); P.vline(16, 12, 29, g.base);
  P.hline(9, 23, 14, g.base); P.vline(9, 10, 14, g.base); P.vline(23, 10, 14, g.base);
  for (const x of [9, 16, 23]) { P.rect(x, 8, 1, 3, '#efe6d0'); flame(P, x, 8, 3, o.light || '#ffd070'); }
};

DRAW.crystal_cluster = (P, pal, o) => {
  const c = MATERIAL_PALETTES.crystal;
  const shards = [[9, 18, 3], [13, 8, 4], [18, 12, 3], [22, 20, 3], [16, 22, 2]];
  for (const [x, top, w] of shards) {
    for (let y = top; y < 31; y++) {
      const ww = Math.min(w, 1 + Math.floor((y - top) / 2));
      P.hline(x - ww, x + ww - 1, y, c.base);
      P.px(x - ww, y, c.light);
      P.px(x + ww - 1, y, c.dark);
    }
  }
  if (o.glowing !== false) { P.px(13, 10, '#ffffff'); P.px(18, 14, '#ffffff'); }
};

DRAW.bookshelf = (P, pal, o, rng) => {
  const w = MATERIAL_PALETTES.wood;
  P.block(4, 2, 24, 29, w);
  const cols = ['#7a2020', '#204a7a', '#2a6a2a', '#7a6a20', '#5a2a6a', '#3a3a3a'];
  for (let shelf = 0; shelf < 4; shelf++) {
    const y = 4 + shelf * 7;
    P.rect(5, y, 22, 6, w.edge);
    let x = 6;
    while (x < 26) {
      const bw = 1 + Math.floor(rng() * 2), bh = 3 + Math.floor(rng() * 3);
      if (!(o.broken && rng() < 0.3)) P.rect(x, y + 6 - bh, bw, bh, cols[Math.floor(rng() * cols.length)]);
      x += bw + (rng() < 0.2 ? 1 : 0);
    }
    P.hline(5, 26, y + 6, w.light);
  }
};

DRAW.table = (P, pal) => {
  const w = MATERIAL_PALETTES.wood;
  P.groundShadow(16, 26);
  P.block(3, 18, 26, 3, w); P.block(5, 21, 2, 10, w); P.block(25, 21, 2, 10, w);
  P.rect(10, 16, 3, 2, '#c8c0a0'); P.rect(18, 15, 2, 3, '#6a8aa0');
};
DRAW.chest = (P, pal, o) => {
  const w = MATERIAL_PALETTES.wood, m = MATERIAL_PALETTES.metal;
  P.groundShadow(16, 22);
  P.block(6, 20, 20, 11, w); P.block(6, 16, 20, 5, w);
  P.vline(9, 16, 30, m.base); P.vline(22, 16, 30, m.base); P.hline(6, 25, 21, m.dark);
  P.rect(15, 20, 3, 3, MATERIAL_PALETTES.gold.base);
  if (o.open) { P.rect(7, 17, 18, 3, MATERIAL_PALETTES.gold.light); }
};
DRAW.barrel = (P) => {
  const w = MATERIAL_PALETTES.wood, m = MATERIAL_PALETTES.metal;
  P.groundShadow(16, 16);
  for (let y = 12; y < 31; y++) { const b = y > 16 && y < 27 ? 8 : 7; P.hline(16 - b, 15 + b, y, w.base); P.px(16 - b, y, w.light); P.px(15 + b, y, w.dark); }
  P.ellipse(16, 12, 7, 1, w.light);
  for (const y of [14, 21, 28]) P.hline(9, 22, y, m.dark);
  for (let x = 11; x < 22; x += 3) P.vline(x, 13, 30, w.dark);
};
DRAW.crate = (P) => {
  const w = MATERIAL_PALETTES.wood;
  P.groundShadow(16, 20);
  P.block(7, 15, 18, 16, w);
  P.line(8, 16, 23, 29, w.dark); P.line(23, 16, 8, 29, w.dark);
  P.hline(7, 24, 22, w.dark);
};
DRAW.cage = (P, pal, o) => {
  const m = MATERIAL_PALETTES.metal;
  P.vline(16, 0, 4, m.dark);
  P.ellipse(16, 6, 8, 2, m.base);
  for (let x = 9; x <= 23; x += 2) P.vline(x, 6, 26, m.base);
  P.hline(8, 24, 26, m.dark); P.hline(8, 24, 16, m.dark);
  if (o.remains !== false) { P.rect(14, 22, 4, 3, '#e0d6c0'); P.px(15, 23, '#2a2a2a'); }
};
DRAW.chains = (P) => {
  const m = MATERIAL_PALETTES.metal;
  for (const x of [10, 16, 22]) {
    for (let y = 0; y < 24 + (x % 3) * 2; y += 2) { P.px(x, y, m.light); P.px(x, y + 1, m.dark); }
  }
  P.rect(9, 24, 3, 2, m.base); P.rect(21, 28, 3, 2, m.base);
};

DRAW.tree = (P, pal, o, rng) => {
  const w = MATERIAL_PALETTES.wood, l = MATERIAL_PALETTES.leaf;
  P.groundShadow(16, 20);
  P.rect(14, 16, 4, 15, w.base); P.vline(14, 16, 30, w.light); P.vline(17, 16, 30, w.dark);
  P.ellipse(16, 10, 10, 8, l.base); P.ellipse(13, 8, 5, 4, l.light); P.ellipse(20, 13, 5, 3, l.dark);
  speckle(P, rng, 7, 3, 18, 14, [l.light, l.dark], 18);
};
DRAW.dead_tree = (P, pal, o) => {
  const w = o.burnt ? MATERIAL_PALETTES.ash : MATERIAL_PALETTES.wood;
  const c = o.burnt ? '#1a1816' : w.dark;
  P.groundShadow(16, 16);
  P.rect(14, 12, 4, 19, c); P.vline(14, 12, 30, w.base);
  P.line(15, 16, 7, 6, c); P.line(7, 6, 5, 2, c); P.line(10, 10, 9, 4, c);
  P.line(17, 13, 25, 4, c); P.line(22, 7, 27, 6, c); P.line(16, 12, 17, 2, c);
  P.line(13, 30, 10, 31, c); P.line(18, 30, 22, 31, c);
};
DRAW.ash_flora = (P, pal, o, rng) => {
  const a = MATERIAL_PALETTES.ash;
  P.groundShadow(16, 16);
  for (let i = 0; i < 6; i++) {
    const x = 8 + i * 3, top = 12 + Math.floor(rng() * 8);
    P.line(16, 30, x, top, a.base); P.px(x, top, '#ff7a30'); P.px(x, top + 1, a.light);
  }
  P.ellipse(16, 29, 5, 2, a.dark);
};
DRAW.mushroom = (P, pal, o) => {
  const caps = [[10, 20, 5, '#8a3a6a'], [20, 16, 6, '#6a3a8a'], [15, 24, 3, '#8a5a3a']];
  P.groundShadow(16, 22);
  for (const [x, y, r, c] of caps) {
    P.rect(x - 1, y, 2, 31 - y, '#d8d0c0');
    P.ellipse(x, y, r, Math.max(1, Math.floor(r / 2)), c);
    P.px(x - 1, y - 1, o.glowing ? '#a0ffc0' : mix(c, '#ffffff', 0.5));
  }
};
DRAW.boulder = (P, pal, o, rng) => {
  P.groundShadow(16, 24);
  P.ellipse(16, 23, 11, 8, pal.base); P.ellipse(13, 20, 6, 4, pal.light); P.ellipse(20, 27, 6, 3, pal.dark);
  crackLine(P, rng, 17, 17, 8, pal.edge);
};
DRAW.stalagmite = (P, pal) => {
  P.groundShadow(16, 20);
  for (const [x, top, b] of [[11, 10, 4], [18, 4, 5], [24, 16, 3]]) {
    for (let y = top; y < 31; y++) { const w = Math.max(1, Math.floor(((y - top) / (31 - top)) * b)); P.hline(x - w, x + w, y, pal.base); P.px(x - w, y, pal.light); P.px(x + w, y, pal.dark); }
  }
};
DRAW.bone_pile = (P, pal, o, rng) => {
  const b = MATERIAL_PALETTES.bone;
  P.ellipse(16, 28, 12, 3, b.dark);
  for (let i = 0; i < 9; i++) { const x = 6 + Math.floor(rng() * 18), y = 24 + Math.floor(rng() * 5); P.line(x, y, x + 3 + Math.floor(rng() * 3), y - 1 + Math.floor(rng() * 3), b.base); }
  for (const [x, y] of [[11, 23], [19, 22], [15, 26]]) { P.rect(x, y, 4, 3, b.light); P.px(x + 1, y + 1, '#1a1a1a'); P.px(x + 2, y + 1, '#1a1a1a'); }
};
DRAW.rubble = (P, pal, o, rng) => {
  P.ellipse(16, 29, 13, 2, pal.dark);
  for (let i = 0; i < 10; i++) { const w = 2 + Math.floor(rng() * 5), h = 2 + Math.floor(rng() * 3); P.block(3 + Math.floor(rng() * (26 - w)), 31 - h - Math.floor(rng() * 4), w, h, pal); }
};
DRAW.stairs = (P, pal) => {
  P.groundShadow(16, 28);
  for (let i = 0; i < 5; i++) P.block(3 + i * 2, 27 - i * 4, 26 - i * 4, 4, pal);
};
DRAW.banner = (P, pal, o) => {
  const m = MATERIAL_PALETTES.metal, c = o.accent || '#7a1a1a';
  P.vline(8, 2, 31, m.dark); P.hline(8, 24, 3, m.base);
  P.rect(11, 4, 12, 18, c); P.vline(11, 4, 21, mix(c, '#ffffff', 0.25));
  for (let x = 11; x < 23; x++) P.vline(x, 22, 22 + (x % 3 === 0 ? 3 : 2), c);
  P.rect(15, 9, 4, 4, MATERIAL_PALETTES.gold.base);
  if (o.burnt || o.broken) { P.clear(18, 15, 5, 10); P.px(18, 15, '#201010'); }
};
DRAW.tomb = (P, pal, o, rng) => {
  P.groundShadow(16, 16);
  P.rect(9, 12, 14, 19, pal.base); P.ellipse(16, 12, 7, 4, pal.base);
  P.vline(9, 12, 30, pal.light); P.vline(22, 12, 30, pal.dark);
  P.rect(15, 14, 2, 8, pal.dark); P.rect(12, 16, 8, 2, pal.dark);
  if (o.broken) crackLine(P, rng, 18, 9, 12, pal.edge);
};
DRAW.mirror = (P, pal, o) => {
  const g = MATERIAL_PALETTES.gold;
  P.groundShadow(16, 14);
  P.ellipse(16, 13, 8, 11, g.base); P.ellipse(16, 13, 6, 9, '#3a4a5a'); P.line(13, 8, 18, 18, '#a0b8c8');
  P.rect(13, 25, 6, 6, g.dark);
  if (o.broken) { P.line(12, 6, 20, 20, '#101010'); P.line(19, 6, 13, 17, '#101010'); }
};
DRAW.bed = (P) => {
  const w = MATERIAL_PALETTES.wood;
  P.groundShadow(16, 28);
  P.block(2, 18, 4, 13, w); P.block(26, 22, 4, 9, w);
  P.rect(5, 22, 22, 5, '#a09070'); P.rect(6, 20, 6, 3, '#d8d0c0'); P.rect(12, 21, 14, 3, '#5a3a6a');
};
DRAW.pew = (P) => {
  const w = MATERIAL_PALETTES.wood;
  P.groundShadow(16, 28);
  P.block(2, 14, 28, 9, w); P.block(2, 22, 28, 3, w); P.block(3, 25, 2, 6, w); P.block(27, 25, 2, 6, w);
};
DRAW.gate = (P, pal) => {
  const m = MATERIAL_PALETTES.metal;
  P.block(2, 2, 4, 29, pal); P.block(26, 2, 4, 29, pal); P.block(2, 1, 28, 3, pal);
  for (let x = 8; x < 26; x += 3) { P.vline(x, 4, 28, m.base); P.px(x, 29, m.light); }
  for (const y of [10, 20]) P.hline(6, 25, y, m.dark);
};
DRAW.portal = (P, pal, o) => {
  const c = o.accent || '#a060ff';
  P.block(4, 4, 4, 27, pal); P.block(24, 4, 4, 27, pal);
  P.ellipse(16, 17, 8, 12, shade(c, 0.4)); P.ellipse(16, 17, 6, 10, c); P.ellipse(16, 17, 3, 6, mix(c, '#ffffff', 0.6));
};
DRAW.bridge = (P, pal) => {
  const w = MATERIAL_PALETTES.wood;
  P.rect(0, 24, 32, 3, w.base); for (let x = 0; x < 32; x += 3) P.vline(x, 24, 26, w.dark);
  P.hline(0, 31, 20, w.dark); for (const x of [2, 15, 29]) P.vline(x, 20, 30, w.edge);
};
DRAW.tent = (P) => {
  const c = MATERIAL_PALETTES.cloth;
  P.groundShadow(16, 28);
  for (let y = 6; y < 31; y++) { const h = Math.floor((y - 6) * 0.55); P.hline(16 - h, 16 + h, y, c.base); P.px(16 - h, y, c.light); P.px(16 + h, y, c.dark); }
  for (let y = 18; y < 31; y++) { const h = Math.floor((y - 18) * 0.3); P.hline(16 - h, 16 + h, y, '#200808'); }
};

// Generic fallback for a landmark type with no dedicated drawer: a carved block
// sized and marked so it still reads as "a thing" made of the right material.
DRAW._generic = (P, pal, o, rng) => {
  P.groundShadow(16, 20);
  P.block(8, 14, 16, 17, pal);
  P.rect(11, 17, 10, 2, pal.dark); P.rect(11, 22, 10, 2, pal.dark);
  speckle(P, rng, 9, 15, 14, 15, [pal.light, pal.dark], 10);
  if (o.broken) { P.clear(18, 12, 7, 6); rubbleAt(P, rng, pal, 4, 28, 5); }
};

const LANDMARK_ALIASES = {
  idol: 'statue', effigy: 'statue', colossus: 'statue', monolith: 'obelisk', menhir: 'obelisk', standing_stone: 'obelisk',
  coffin: 'sarcophagus', casket: 'sarcophagus', bier: 'sarcophagus', column: 'pillar', broken_column: 'broken_columns',
  arch: 'archway', basin: 'fountain', crystals: 'crystal_cluster', crystal: 'crystal_cluster', bookcase: 'bookshelf',
  desk: 'table', workbench: 'table', coffer: 'chest', strongbox: 'chest', cask: 'barrel', keg: 'barrel', gibbet: 'cage',
  shackles: 'chains', withered_tree: 'dead_tree', petrified_tree: 'dead_tree', skulls: 'bone_pile', debris: 'rubble',
  steps: 'stairs', tapestry: 'banner', flag: 'banner', grave: 'tomb', headstone: 'tomb', gravestone: 'tomb', cot: 'bed',
  bench: 'pew', portcullis: 'gate', rift: 'portal', toadstool: 'mushroom', fungus: 'mushroom', rock: 'boulder',
  stalactite: 'stalagmite', firepit: 'campfire', fire_pit: 'campfire', candles: 'candelabra', pond: 'pool',
  crystal_spire: 'crystal_cluster', bone_pillar: 'pillar', shattered_obelisk: 'obelisk', ash_pile: 'rubble'
};

function resolveLandmarkDrawer(type) {
  const t = String(type || '').toLowerCase().replace(/^custom_/, '').replace(/_\d+$/, '');
  if (DRAW[t]) return t;
  if (LANDMARK_ALIASES[t]) return LANDMARK_ALIASES[t];
  // substring match ("ancient_altar" -> altar, "statues_of_kings" -> statue)
  const keys = Object.keys(DRAW).filter(k => !k.startsWith('_')).sort((a, b) => b.length - a.length);
  for (const k of keys) if (t.includes(k)) return k;
  for (const [alias, k] of Object.entries(LANDMARK_ALIASES)) if (t.includes(alias)) return k;
  return null;
}

// Default material per landmark when the room text doesn't say.
const DEFAULT_MATERIAL = {
  bookshelf: 'wood', table: 'wood', chest: 'wood', barrel: 'wood', crate: 'wood', bed: 'wood', pew: 'wood',
  cage: 'metal', chains: 'metal', gate: 'metal', brazier: 'metal', tree: 'wood', dead_tree: 'wood',
  bone_pile: 'bone', crystal_cluster: 'crystal', banner: 'cloth', tent: 'cloth', mushroom: 'moss', ash_flora: 'ash'
};

// ---------- generic primitive drawer (level-spec structures, incl. invented props) ----------
// o.prim = { shape, width 0.2-1, height 0.2-1.4, color, color2, glow }; drawn on the 32px grid, feet at y=31.
function palFromHex(c, fallback) {
  if (!c) return fallback;
  return { base: c, light: mix(c, '#ffffff', 0.3), dark: mix(c, '#000000', 0.4), accent: mix(c, '#ffffff', 0.55) };
}
DRAW._primitive = (P, pal0, o, rng) => {
  const pr = o.prim || {};
  const pal = palFromHex(pr.color, pal0);
  const pal2 = palFromHex(pr.color2, { base: pal.dark, light: pal.base, dark: mix(pal.dark, '#000000', 0.3) });
  const W = Math.max(6, Math.round(28 * (pr.width || 0.6))), H = Math.max(5, Math.round(30 * Math.min(1, (pr.height || 0.8) / 1.1)));
  const cx = 16, x0 = Math.round(cx - W / 2), top = 31 - H;
  const glow = pr.glow;
  switch (pr.shape) {
    case 'column': case 'broken_column': {
      const cw = Math.max(4, Math.round(W * 0.45)); const bx = cx - Math.round(cw / 2);
      const h = pr.shape === 'broken_column' ? Math.round(H * 0.55) : H;
      P.block(bx - 1, 31 - 3, cw + 2, 3, pal); P.block(bx, 31 - h, cw, h - 2, pal);
      for (let x = bx + 1; x < bx + cw - 1; x += 2) P.vline(x, 31 - h + 2, 28, pal.dark);
      if (pr.shape === 'broken_column') { for (let x = bx; x < bx + cw; x++) if (rng() < 0.5) P.px(x, 31 - h, null); P.clear(bx + cw - 2, 31 - h, 2, 2); P.block(cx + 3, 27, Math.round(W * 0.45), 4, pal); P.block(x0, 29, 4, 2, pal2); }
      else P.block(bx - 1, 31 - h, cw + 2, 2, pal);
      break;
    }
    case 'arch': {
      const pw = Math.max(3, Math.round(W * 0.2)); P.block(x0, top + 6, pw, H - 6, pal); P.block(x0 + W - pw, top + 6, pw, H - 6, pal);
      for (let a = 0; a <= Math.PI; a += 0.04) { const rx = W / 2 - pw / 2, x = cx + Math.cos(a) * rx, y = top + 7 - Math.sin(a) * 6; P.rect(x - 1, y - 1, 3, 3, a < 0.3 || a > 2.8 ? pal.base : pal.light); P.px(x, y + 2, pal.dark); }
      for (let y = top + 9; y < 31; y += 3) { P.hline(x0, x0 + pw - 1, y, pal.dark); P.hline(x0 + W - pw, x0 + W - 1, y, pal.dark); }
      break;
    }
    case 'slab': case 'table': {
      const h = Math.min(H, 14); P.block(x0, 31 - h, W, 3, pal);
      if (pr.shape === 'table') { P.rect(x0 + 1, 31 - h + 3, 2, h - 3, pal.dark); P.rect(x0 + W - 3, 31 - h + 3, 2, h - 3, pal.dark); }
      else { P.block(x0 + 2, 31 - h + 3, W - 4, h - 3, pal2); speckle(P, rng, x0 + 2, 31 - h + 3, W - 4, h - 3, [pal.dark], 6); }
      break;
    }
    case 'statue': {
      P.block(cx - 5, 27, 10, 4, pal2); P.ellipse(cx, top + 3, 3, 3, pal.base); P.rect(cx - 4, top + 6, 8, Math.max(4, H - 14), pal.base);
      P.rect(cx - 3, top + 6 + Math.max(4, H - 14), 6, 27 - (top + 6 + Math.max(4, H - 14)), pal.base); P.vline(cx - 4, top + 6, 26, pal.light); P.vline(cx + 3, top + 6, 26, pal.dark);
      P.rect(cx - 6, top + 7, 2, 7, pal.base); P.rect(cx + 4, top + 7, 2, 7, pal.dark); break;
    }
    case 'mound': case 'pile': {
      for (let y = 0; y < H; y++) { const span = Math.round((W / 2) * Math.sqrt(1 - Math.pow(1 - y / H, 2))); P.hline(cx - span, cx + span, top + y, y < 2 ? pal.light : pal.base); }
      if (pr.shape === 'pile') for (let i = 0; i < 9; i++) { const x = cx - W / 2 + rng() * W, y = top + 2 + rng() * (H - 2); P.rect(x, y, 2, 1, rng() < 0.5 ? pal.light : pal.dark); }
      else speckle(P, rng, x0, top, W, H, [pal.dark, pal.light], 14);
      break;
    }
    case 'spire': case 'stalagmite': case 'crystal': {
      const n = pr.shape === 'crystal' ? 3 : 1;
      for (let k = 0; k < n; k++) { const bx = cx + (k - (n - 1) / 2) * 7, h = H - k * 4 * (k % 2), bw = pr.shape === 'spire' ? 6 : 5;
        for (let y = 0; y < h; y++) { const w = Math.max(1, Math.round(bw * (y / h))); P.hline(bx - w / 2, bx + w / 2, 31 - h + y, y % 5 === 0 ? pal.dark : (k % 2 ? pal.light : pal.base)); }
        if (glow) P.vline(bx, 31 - h + 2, 29, mix(glow, '#ffffff', 0.4)); }
      break;
    }
    case 'cluster': {
      for (let i = 0; i < 6; i++) { const x = x0 + 2 + rng() * (W - 4), h = 3 + rng() * (H - 4), r = 2 + Math.round(rng() * 2);
        P.vline(x, 31 - h, 31, '#d8d0c0'); P.ellipse(x, 31 - h, r, Math.max(1, r - 1), glow ? (i % 2 ? glow : mix(glow, '#ffffff', 0.35)) : pal.base); P.px(x - 1, 31 - h - 1, '#ffffff'); }
      break;
    }
    case 'tree': {
      P.rect(cx - 2, 31 - Math.round(H * 0.5), 4, Math.round(H * 0.5), pal2.base || '#5a3a22');
      P.ellipse(cx, top + Math.round(H * 0.3), Math.round(W / 2), Math.round(H * 0.3), pal.base); speckle(P, rng, x0, top, W, Math.round(H * 0.55), [pal.light, pal.dark], 30);
      break;
    }
    case 'orb': P.block(cx - 4, 26, 8, 5, pal2); P.ellipse(cx, 20, 5, 5, glow || pal.base); P.px(cx - 2, 18, '#ffffff'); break;
    case 'pool': for (let y = 0; y < 5; y++) { const span = Math.round((W / 2) * Math.sqrt(1 - Math.pow((y - 2) / 2.6, 2))); P.hline(cx - span, cx + span, 26 + y, y === 0 ? pal.light : pal.base); } P.hline(cx - 3, cx + 2, 27, '#c8e8ff'); break;
    case 'bowl': { P.rect(cx - 1, 31 - Math.round(H * 0.6), 3, Math.round(H * 0.6), pal.dark); P.block(cx - 4, 29, 8, 2, pal); const by = 31 - Math.round(H * 0.6); P.ellipse(cx, by, Math.round(W / 2), 2, pal.base); P.hline(cx - W / 2 + 1, cx + W / 2 - 1, by - 2, pal.light); if (glow) flame(P, cx, by - 2, 7, glow); break; }
    case 'frame': { P.block(x0, top, W, H, pal); P.rect(x0 + 2, top + 2, W - 4, H - 4, pal.dark); for (let y = top + 5; y < 30; y += 5) { P.hline(x0 + 2, x0 + W - 3, y, pal.base); for (let x = x0 + 3; x < x0 + W - 3; x += 2) P.vline(x, y - 3, y - 1, rng() < 0.5 ? pal2.base : pal.light); } break; }
    case 'hanging': case 'banner': {
      if (pr.shape === 'banner') { P.hline(x0, x0 + W - 1, top, pal.dark); P.rect(x0 + 1, top + 1, W - 2, H - 4, pal.base); for (let x = x0 + 1; x < x0 + W - 1; x++) if (rng() < 0.6) P.vline(x, top + H - 4, top + H - 3 + Math.round(rng() * 2), pal.base); P.rect(cx - 1, top + 4, 3, 3, pal.accent); }
      else for (let k = 0; k < 4; k++) { let x = x0 + 2 + k * (W - 4) / 3; for (let y = top; y < 31; y++) { x += rng() < 0.5 ? -0.5 : 0.5; P.px(x, y, pal.base); if (rng() < 0.25) P.px(x + 1, y, pal.light); } }
      break;
    }
    case 'barrel': P.block(cx - 5, 31 - Math.min(H, 14), 10, Math.min(H, 14), pal); P.hline(cx - 5, cx + 4, 31 - Math.min(H, 14) + 3, pal.dark); P.hline(cx - 5, cx + 4, 28, pal.dark); break;
    default: P.block(x0, top, W, H, pal); speckle(P, rng, x0, top, W, H, [pal.light, pal.dark], 12);
  }
  if (glow && !['bowl', 'cluster', 'orb'].includes(pr.shape)) speckle(P, rng, x0, top, W, H, [glow], 4);
  // assembly overlays: base plinth, ornaments (glyphs/vines/cracks/gold), state damage
  if (pr.base === 'plinth') P.block(cx - Math.round(W / 2) - 1, 29, W + 2, 2, pal2);
  if (pr.base === 'rubble') rubbleAt(P, rng, pal, x0 - 2, x0 + W + 2, 4);
  if (pr.base === 'sand_drift') { for (let i = 0; i < 8; i++) P.px(x0 + Math.floor(rng() * W), 30, mix(pal.base, '#d8be8c', 0.5)); }
  if (pr.ornament === 'glyphs' || pr.ornament === 'runes') {
    const gc = pr.ornament === 'glyphs' ? '#3a2a1a' : (pr.color2 || '#c8a040');
    for (let k = 0; k < 3; k++) { const gx = x0 + 2 + Math.floor(rng() * Math.max(1, W - 4)), gy = top + 4 + Math.floor(rng() * Math.max(1, H - 8)); P.px(gx, gy, gc); P.px(gx, gy + 1, gc); P.px(gx + 1, gy, gc); }
  }
  if (pr.ornament === 'vines' || pr.ornament === 'moss') {
    const vc = pr.ornament === 'moss' ? '#4a6a32' : (pr.color || '#5a6a32');
    for (let k = 0; k < 3; k++) { let vx = x0 + 1 + Math.floor(rng() * Math.max(1, W - 2)); for (let y = top; y < 31; y++) { vx += rng() < 0.5 ? -0.4 : 0.4; P.px(vx, y, vc); } }
  }
  if (pr.ornament === 'cracks' || pr.state === 'cracked') crackLine(P, rng, cx - 1, top + 2, Math.max(4, H - 4), pal.dark);
  if (pr.ornament === 'gold_trim') { P.hline(x0, x0 + W - 1, top + 1, '#c8a040'); P.hline(x0, x0 + W - 1, 30, '#c8a040'); }
  if (pr.ornament === 'frost') for (let i = 0; i < 6; i++) P.px(x0 + Math.floor(rng() * W), top + Math.floor(rng() * 4), '#e8f6ff');
  if (pr.ornament === 'cobwebs') { P.px(x0, top, '#c8c8c8'); P.px(x0 + 1, top + 1, '#c8c8c8'); P.px(x0 + 2, top + 2, '#a0a0a0'); }
  if (pr.state === 'pointed' && pr.shape === 'arch') { P.px(cx, top - 1, pal.light); P.px(cx - 1, top, pal.base); P.px(cx + 1, top, pal.base); }
};
DRAW.colonnade = (P, pal, o, rng) => DRAW._primitive(P, pal, { ...o, prim: { ...(o.prim || {}), shape: 'column' } }, rng);

// ---------- object (item) drawers ----------
// Smaller props lying in the room: drawn in the lower half so they read as on the floor.
const ITEM = {};
ITEM.weapon = (P, o, name) => {
  const m = MATERIAL_PALETTES[/rust/.test(name) ? 'rust' : /gold/.test(name) ? 'gold' : /bone/.test(name) ? 'bone' : 'metal'];
  const w = MATERIAL_PALETTES.wood;
  if (/axe/.test(name)) { P.line(12, 30, 20, 16, w.base); P.ellipse(20, 16, 4, 3, m.base); P.px(22, 15, m.light); }
  else if (/bow/.test(name)) { for (let y = 12; y < 30; y++) P.px(14 + Math.round(4 * Math.sin(((y - 12) / 18) * Math.PI)), y, w.base); P.vline(14, 12, 29, '#d8d0c0'); }
  else if (/(staff|spear|halberd|glaive|trident)/.test(name)) { P.line(10, 31, 22, 6, w.base); P.line(22, 6, 24, 2, m.light); P.px(23, 5, m.base); }
  else if (/(mace|hammer|club|flail)/.test(name)) { P.line(12, 30, 18, 18, w.base); P.block(16, 13, 6, 6, m); }
  else if (/(dagger|knife)/.test(name)) { P.line(13, 29, 18, 24, w.dark); P.line(18, 24, 23, 19, m.light); P.hline(16, 19, 25, m.dark); }
  else { // sword, stuck point-down in the floor
    P.vline(16, 12, 30, m.light); P.vline(17, 12, 30, m.base);
    P.hline(12, 21, 11, m.dark); P.rect(16, 6, 2, 5, w.base); P.rect(15, 5, 4, 1, MATERIAL_PALETTES.gold.base);
  }
  P.groundShadow(16, 10);
};
ITEM.armor = (P, o, name) => {
  const m = MATERIAL_PALETTES[/leather/.test(name) ? 'wood' : /gold/.test(name) ? 'gold' : 'metal'];
  if (/(helm|helmet|crown|circlet)/.test(name)) { P.ellipse(16, 25, 6, 5, m.base); P.rect(10, 25, 13, 5, m.base); P.hline(12, 20, 26, m.edge); P.px(12, 22, m.light); }
  else if (/(shield|buckler)/.test(name)) { P.ellipse(16, 22, 7, 8, m.base); P.ellipse(16, 22, 5, 6, '#7a1a1a'); P.rect(15, 18, 2, 8, MATERIAL_PALETTES.gold.base); }
  else if (/(robe|cloak)/.test(name)) { const c = MATERIAL_PALETTES.cloth; P.rect(9, 24, 15, 6, c.base); P.hline(9, 23, 24, c.light); P.rect(12, 22, 8, 2, c.dark); }
  else { // armour on a small stand
    const w = MATERIAL_PALETTES.wood;
    P.vline(16, 8, 30, w.dark); P.hline(11, 21, 30, w.dark);
    P.rect(11, 12, 10, 10, m.base); P.rect(9, 12, 3, 4, m.base); P.rect(21, 12, 3, 4, m.base);
    P.vline(11, 12, 21, m.light); P.hline(12, 20, 17, m.dark); P.ellipse(16, 8, 3, 3, m.base);
  }
  P.groundShadow(16, 14);
};
ITEM.potion = (P, o, name) => {
  const c = /(heal|red|blood)/.test(name) ? '#d02030' : /(mana|blue)/.test(name) ? '#2050e0' : /(poison|green)/.test(name) ? '#30b030' : '#a040d0';
  P.groundShadow(16, 8);
  P.ellipse(16, 26, 4, 4, '#c8d8e0'); P.ellipse(16, 27, 3, 3, c); P.px(15, 25, '#ffffff');
  P.rect(15, 19, 3, 4, '#c8d8e0'); P.rect(15, 18, 3, 1, '#7a5532');
};
ITEM.scroll = (P) => { P.groundShadow(16, 12); P.rect(10, 26, 13, 4, '#e8dcb8'); P.ellipse(10, 28, 1, 2, '#c8b890'); P.ellipse(23, 28, 1, 2, '#c8b890'); P.rect(15, 26, 2, 4, '#8a1a1a'); };
ITEM.book = (P, o, name) => { const c = /(black|necro|dark)/.test(name) ? '#2a2026' : '#5a2a1a'; P.groundShadow(16, 12); P.block(10, 25, 13, 5, { base: c, light: mix(c, '#ffffff', 0.3), dark: shade(c, 0.6) }); P.hline(11, 21, 29, '#e8dcb8'); P.rect(15, 26, 3, 2, MATERIAL_PALETTES.gold.base); };
ITEM.key = (P, o, name) => { const m = MATERIAL_PALETTES[/bone/.test(name) ? 'bone' : /iron|rust/.test(name) ? 'metal' : 'gold']; P.groundShadow(16, 10); P.ellipse(11, 27, 3, 2, m.base); P.px(11, 27, '#000'); P.hline(13, 22, 27, m.base); P.vline(21, 27, 29, m.base); P.vline(19, 27, 29, m.base); };
ITEM.jewelry = (P) => { const g = MATERIAL_PALETTES.gold; P.groundShadow(16, 8); P.ellipse(16, 27, 4, 2, g.base); P.ellipse(16, 27, 2, 1, '#00000000'); P.px(16, 25, '#d02060'); P.px(14, 26, g.light); };
ITEM.gem = (P, o, name) => { const c = /ruby|red/.test(name) ? '#e02040' : /emerald|green/.test(name) ? '#20c060' : /sapphire|blue/.test(name) ? '#2060e0' : /orb/.test(name) ? '#a070ff' : '#c0e8ff'; P.groundShadow(16, 8); P.ellipse(16, 26, 3, 3, c); P.px(15, 25, '#ffffff'); P.ellipse(16, 26, 5, 5, mix(c, '#00000000', 0.9)); };
ITEM.treasure = (P, o, name) => {
  const g = MATERIAL_PALETTES.gold;
  if (/(chalice|goblet|cup)/.test(name)) { P.groundShadow(16, 8); P.ellipse(16, 20, 4, 2, g.base); P.vline(16, 21, 28, g.dark); P.hline(13, 19, 29, g.base); return; }
  if (/(idol|relic|artifact|artefact)/.test(name)) { P.groundShadow(16, 8); P.rect(14, 20, 5, 10, g.base); P.ellipse(16, 19, 3, 3, g.base); P.px(15, 19, '#e02040'); P.px(17, 19, '#e02040'); return; }
  P.ellipse(16, 28, 8, 3, g.dark); P.ellipse(16, 27, 6, 2, g.base); P.ellipse(16, 25, 3, 1, g.light);
};
ITEM.container = (P, o, name) => {
  if (/(chest|coffer|casket|box)/.test(name)) { const s = makeScaled(P, 0.6); DRAW.chest(s, null, {}); return; }
  if (/(urn|jar)/.test(name)) { const c = MATERIAL_PALETTES.earth; P.groundShadow(16, 10); P.ellipse(16, 25, 5, 5, c.base); P.rect(14, 18, 5, 3, c.base); P.px(13, 24, c.light); return; }
  const c = '#8a7050'; P.groundShadow(16, 12); P.ellipse(16, 26, 6, 4, c); P.rect(15, 20, 3, 3, shade(c, 0.8)); P.hline(14, 18, 22, '#3a2a1a');
};
ITEM.light = (P, o) => { const m = MATERIAL_PALETTES.metal; P.groundShadow(16, 8); P.rect(13, 20, 7, 9, m.dark); P.rect(14, 21, 5, 7, '#ffd070'); P.hline(13, 19, 19, m.base); P.ellipse(16, 17, 2, 1, m.base); flame(P, 16, 26, 4, o.light || '#ffaa40'); };
ITEM.tool = (P, o, name) => { const w = MATERIAL_PALETTES.wood, m = MATERIAL_PALETTES.metal; P.groundShadow(16, 12); if (/rope/.test(name)) { P.ellipse(16, 27, 6, 3, '#a08a5a'); P.ellipse(16, 27, 3, 1, '#6a5a3a'); return; } P.line(10, 30, 20, 18, w.base); P.line(17, 16, 24, 20, m.base); };
ITEM.remains = (P) => { const b = MATERIAL_PALETTES.bone; P.groundShadow(16, 14); P.ellipse(13, 26, 4, 3, b.light); P.px(12, 26, '#111'); P.px(14, 26, '#111'); P.line(17, 29, 26, 27, b.base); P.line(18, 27, 24, 30, b.base); };
ITEM.food = (P) => { P.groundShadow(16, 10); P.ellipse(14, 27, 4, 2, '#b08040'); P.ellipse(20, 27, 2, 2, '#c02020'); P.px(20, 25, '#3a8a2a'); };
ITEM.item = (P, o) => { const c = '#8a7050'; P.groundShadow(16, 10); P.ellipse(16, 27, 5, 3, c); P.ellipse(16, 25, 2, 1, mix(c, '#ffffff', 0.4)); if (o.glowing) P.px(16, 24, '#ffffff'); };

// Draw a full-size drawer shrunk toward the floor (used for chests as items).
function makeScaled(P, scale) {
  const off = (v, isY) => isY ? 32 - (32 - v) * scale : 16 + (v - 16) * scale;
  const Q = { ...P };
  Q.rect = (x, y, w, h, c) => P.rect(off(x), off(y, true), Math.max(1, w * scale), Math.max(1, h * scale), c);
  Q.px = (x, y, c) => P.rect(off(x), off(y, true), 1, 1, c);
  Q.hline = (x0, x1, y, c) => Q.rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, c);
  Q.vline = (x, y0, y1, c) => Q.rect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c);
  Q.block = (x, y, w, h, pal) => { Q.rect(x, y, w, h, pal.base); Q.hline(x, x + w - 1, y, pal.light); Q.hline(x, x + w - 1, y + h - 1, pal.dark); };
  Q.groundShadow = (cx, w) => P.groundShadow(cx, w * scale);
  return Q;
}

// ---------- entry points ----------
/**
 * Paint a landmark sprite on a 320x320 node-canvas context.
 * @param ctx  2D context of the output canvas (320x320)
 * @param type landmark type (altar, statue, ...)
 * @param opts { material, tint, condition:[...], accent, light, seed }
 * @returns true when a dedicated drawer was used
 */
function drawLandmarkSprite(ctx, createCanvas, type, opts = {}) {
  const key = resolveLandmarkDrawer(type);
  const small = createCanvas(BASE, BASE);
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = false;
  const P = makePainter(sctx);
  const material = opts.material || DEFAULT_MATERIAL[key] || 'stone';
  const pal = paletteFor(material, opts.tint);
  const cond = new Set(opts.condition || []);
  const o = {
    broken: cond.has('broken'), burnt: cond.has('burnt'), glowing: cond.has('glowing'),
    overgrown: cond.has('overgrown'), flooded: cond.has('flooded'), bloody: cond.has('bloody'),
    accent: opts.accent, light: opts.light, prim: opts.prim
  };
  const rng = makeRng(seedFrom(`${type}|${opts.seed || ''}`));
  // level-spec structures carry a primitive: use it unless a dedicated drawer exists and the spec gave no colour
  // assembly options override / enrich the primitive (state, ornament, colours)
  if (opts.assembly) {
    const A = opts.assembly;
    o.prim = Object.assign({}, opts.prim || {}, {
      shape: (opts.prim && opts.prim.shape) || undefined,
      color: A.color || (opts.prim && opts.prim.color), color2: A.color2 || (opts.prim && opts.prim.color2),
      glow: A.glow || (opts.prim && opts.prim.glow), material: A.material,
      state: A.state, base: A.base, ornament: A.ornament, kit: A.kit, size: A.size
    });
    if (A.state === 'collapsed' || A.state === 'ruined' || A.state === 'cracked') o.broken = true;
    if (A.state === 'overgrown' || A.ornament === 'vines' || A.ornament === 'moss') o.overgrown = true;
    if (A.state === 'burnt') o.burnt = true;
    if (A.state === 'glowing' || A.glow) o.glowing = true;
  }
  const usePrim = (opts.prim || opts.assembly) && ((opts.prim && opts.prim.shape) || opts.assembly) && (!key || (opts.prim && opts.prim.color) || opts.assembly || opts.preferPrimitive);
  (usePrim ? DRAW._primitive : (DRAW[key] || DRAW._generic))(P, pal, o, rng);
  // Surface effects only paint on the sprite itself, never on the transparent background.
  sctx.globalCompositeOperation = 'source-atop';
  if (o.overgrown) speckle(P, rng, 4, 14, 24, 17, [MATERIAL_PALETTES.moss.base, MATERIAL_PALETTES.moss.light], 22);
  if (o.burnt && key !== 'dead_tree') speckle(P, rng, 4, 4, 24, 26, ['#1a1816', '#2a2624'], 20);
  sctx.globalCompositeOperation = 'source-over';
  if (o.flooded) { sctx.fillStyle = 'rgba(46,90,122,0.65)'; sctx.fillRect(0, 28, 32, 4); P.hline(2, 12, 28, '#9cd0f0'); P.hline(18, 28, 29, '#9cd0f0'); }
  blit(small, ctx);
  return !!key;
}

/** Paint an "Objects in Room" item as a floor billboard. */
function drawItemSprite(ctx, createCanvas, name, category, opts = {}) {
  const small = createCanvas(BASE, BASE);
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = false;
  const P = makePainter(sctx);
  const cat = ITEM[category] ? category : 'item';
  ITEM[cat](P, { glowing: !!opts.glowing, light: opts.light }, String(name || '').toLowerCase());
  blit(small, ctx);
  return cat;
}

function blit(small, ctx) {
  const S = ctx.canvas.width;
  ctx.clearRect(0, 0, S, S);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, BASE, BASE, 0, 0, S, S);
}

/** spriteSpec the 3D renderers already understand, sized per landmark. */
const PRIM_SPEC = {
  column: 'pillar', broken_column: 'broken_columns', arch: 'archway', slab: 'altar', table: 'altar', statue: 'statue', mound: 'rubble', pile: 'bone_pile',
  spire: 'obelisk', stalagmite: 'obelisk', crystal: 'crystal_cluster', cluster: 'crystal_cluster', tree: 'tree', orb: 'brazier', pool: 'pool', bowl: 'brazier',
  frame: 'bookshelf', hanging: 'banner', banner: 'banner', barrel: 'brazier'
};
function landmarkSpriteSpec(type, prim) {
  if (prim && prim.shape) {
    const base = landmarkSpriteSpec(PRIM_SPEC[prim.shape] || '_generic');
    const h = Math.max(0.25, Math.min(1.3, prim.height || base.heightRatio));
    const w = Math.max(0.3, Math.min(1, prim.width || base.baseWidth));
    return { ...base, profile: prim.shape === 'column' ? 'cylinder' : 'flat', heightRatio: h, baseWidth: w, gridWidth: w, collisionRadius: prim.blocking === false ? 0.05 : base.collisionRadius };
  }
  const key = resolveLandmarkDrawer(type) || '_generic';
  const specs = {
    altar: { profile: 'slab', heightRatio: 0.55, baseWidth: 0.8, gridWidth: 0.8, depth: 0.6 },
    statue: { profile: 'flat', heightRatio: 1.05, baseWidth: 0.5, gridWidth: 0.5, depth: 0.4, collisionRadius: 0.2 },
    pillar: { profile: 'cylinder', heightRatio: 1.0, baseWidth: 0.4, gridWidth: 0.4, depth: 0.8, collisionRadius: 0.12 },
    broken_columns: { profile: 'flat', heightRatio: 0.7, baseWidth: 0.8, gridWidth: 0.8, depth: 0.5 },
    sarcophagus: { profile: 'slab', heightRatio: 0.5, baseWidth: 0.9, gridWidth: 0.9, depth: 0.6 },
    obelisk: { profile: 'block', heightRatio: 1.15, baseWidth: 0.4, gridWidth: 0.4, depth: 0.6, collisionRadius: 0.15 },
    archway: { profile: 'arch', heightRatio: 1.1, baseWidth: 0.9, gridWidth: 0.9, depth: 0.4 },
    throne: { profile: 'flat', heightRatio: 0.9, baseWidth: 0.6, gridWidth: 0.6, depth: 0.5 },
    fountain: { profile: 'flat', heightRatio: 0.8, baseWidth: 0.85, gridWidth: 0.85, depth: 0.5 },
    pool: { profile: 'flat', heightRatio: 0.3, baseWidth: 0.9, gridWidth: 0.9, depth: 0.1, collisionRadius: 0.3 },
    crystal_cluster: { profile: 'flat', heightRatio: 0.85, baseWidth: 0.6, gridWidth: 0.6, depth: 0.5 },
    bookshelf: { profile: 'block', heightRatio: 1.0, baseWidth: 0.8, gridWidth: 0.8, depth: 0.4 },
    tree: { profile: 'flat', heightRatio: 1.2, baseWidth: 0.7, gridWidth: 0.7, depth: 0.3, collisionRadius: 0.15 },
    dead_tree: { profile: 'flat', heightRatio: 1.2, baseWidth: 0.7, gridWidth: 0.7, depth: 0.3, collisionRadius: 0.12 },
    bone_pile: { profile: 'flat', heightRatio: 0.4, baseWidth: 0.8, gridWidth: 0.8, depth: 0.3 },
    rubble: { profile: 'flat', heightRatio: 0.45, baseWidth: 0.9, gridWidth: 0.9, depth: 0.3 },
    banner: { profile: 'flat', heightRatio: 1.0, baseWidth: 0.6, gridWidth: 0.6, depth: 0.1, collisionRadius: 0.1 },
    chains: { profile: 'flat', heightRatio: 1.0, baseWidth: 0.6, gridWidth: 0.6, depth: 0.1, collisionRadius: 0.1 },
    brazier: { profile: 'flat', heightRatio: 0.7, baseWidth: 0.5, gridWidth: 0.5, depth: 0.4, collisionRadius: 0.18 },
    furnace: { profile: 'flat', heightRatio: 1.1, baseWidth: 0.85, gridWidth: 0.85, depth: 0.7, collisionRadius: 0.3 },
    _generic: { profile: 'slab', heightRatio: 0.7, baseWidth: 0.6, gridWidth: 0.6, depth: 0.5 }
  };
  const s = specs[key] || specs._generic;
  return {
    depth: 0.5, ...s,
    detail: { bandCount: 0, grooveCount: 0, grooveDepth: 0.1, taper: 0, baseHeight: 0.1, capHeight: 0.08, baseFlare: 0.05, capFlare: 0.05, wear: 0.2, chips: 0.15, cracks: 0.15, noise: 0.2, skin: '', skinStrength: 0, carving: '', accentColor: null, accentStrength: 0 },
    pixelArt: true
  };
}

module.exports = {
  drawLandmarkSprite,
  drawItemSprite,
  resolveLandmarkDrawer,
  landmarkSpriteSpec,
  MATERIAL_PALETTES,
  paletteFor
};
