// assets/renderSceneTextures.js
// Material-aware, tileable floor and wall textures driven by the room's scene spec
// (wood planks, marble, bone, metal, ice, lava, sand, ash, roots, crystal...), plus
// ground-cover overlays (standing water, ash, blood, moss, bones, rubble, snow).
// Painted on a 32x32 grid and upscaled with nearest-neighbour like the sprite catalog.

'use strict';

const BASE = 32;

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
function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(h || ''));
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
function shade(a, f) { const A = hexToRgb(a); return rgbToHex([A[0] * f, A[1] * f, A[2] * f]); }

// Tile-wrapping painter: anything drawn past an edge wraps to the other side,
// so every texture tiles seamlessly in the raycaster.
function painter(ctx) {
  const P = {
    px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(((Math.round(x) % BASE) + BASE) % BASE, ((Math.round(y) % BASE) + BASE) % BASE, 1, 1); },
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P.px(x + i, y + j, c); },
    fill(c) { ctx.fillStyle = c; ctx.fillRect(0, 0, BASE, BASE); }
  };
  return P;
}

const MAT = {
  stone:    ['#6e6a64', '#4e4a45', '#8c867c', '#2a2724'],
  brick:    ['#7a4a3a', '#5a3428', '#9c644e', '#2a1810'],
  marble:   ['#d8d4cc', '#b8b2a8', '#f4f1ea', '#8a857c'],
  bone:     ['#cfc6a8', '#a99f82', '#ece5cf', '#4a4232'],
  obsidian: ['#25212b', '#18151c', '#4a4060', '#060508'],
  wood:     ['#6a4a2e', '#553a22', '#8a6440', '#24160a'],
  metal:    ['#5e646c', '#484d54', '#9aa2ac', '#1a1c1f'],
  ice:      ['#a6d2ea', '#86b8d6', '#e6f6ff', '#3a6a8a'],
  lava:     ['#3a1e18', '#24120e', '#ff6a20', '#0a0404'],
  ash:      ['#5f5d5a', '#4a4846', '#8a8782', '#1c1b1a'],
  sand:     ['#b89a68', '#a0845a', '#d8be8c', '#5a4628'],
  sandstone:['#b08a5e', '#94724c', '#d0aa7c', '#4a3620'],
  earth:    ['#5e4630', '#4a3624', '#7e6244', '#1e140c'],
  roots:    ['#3e3424', '#2c2418', '#5a6a32', '#100c08'],
  crystal:  ['#5a4480', '#463466', '#b49aff', '#1a1028'],
  flesh:    ['#8e3a44', '#702c36', '#c06070', '#2a0c12']
};

// Blend the material's own colours toward the room palette so the spec's light/colour wins.
function materialColors(material, palette, t = 0.35) {
  const m = MAT[material] || MAT.stone;
  if (!palette) return m.slice();
  return [
    mix(m[0], palette.primary || m[0], t),
    mix(m[1], palette.secondary || m[1], t * 0.8),
    mix(m[2], palette.highlight || m[2], t * 0.5),
    mix(m[3], palette.shadow || m[3], t)
  ];
}

// ---------------- floors ----------------
const FLOOR = {
  stone(P, c, rng) {
    P.fill(c[3]);
    for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
      const tone = rng() < 0.3 ? c[1] : c[0];
      P.rect(bx * 8 + 1, by * 8 + 1, 7, 7, tone);
      P.rect(bx * 8 + 1, by * 8 + 1, 7, 1, c[2]);
    }
  },
  brick(P, c, rng) {
    P.fill(c[3]);
    for (let r = 0; r < 8; r++) { const off = (r % 2) * 4; for (let k = 0; k < 4; k++) P.rect(k * 8 + off + 1, r * 4 + 1, 7, 3, rng() < 0.25 ? c[1] : c[0]); }
  },
  marble(P, c, rng) {
    P.fill(c[0]);
    for (let k = 0; k < 4; k++) { let x = rng() * 32, y = rng() * 32; for (let i = 0; i < 22; i++) { P.px(x, y, c[1]); x += 1; y += rng() < 0.5 ? 1 : (rng() < 0.5 ? 0 : -1); } }
    for (let i = 0; i < 32; i++) { P.px(i, 0, c[3]); P.px(0, i, c[3]); P.px(i, 16, c[1]); P.px(16, i, c[1]); }
    for (let i = 1; i < 16; i++) { P.px(i, 1, c[2]); P.px(i + 16, 17, c[2]); }
  },
  bone(P, c, rng) {
    P.fill(c[3]);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
      const x = k * 8 + (r % 2) * 4, y = r * 8;
      if (rng() < 0.5) { P.rect(x + 1, y + 3, 6, 2, c[0]); P.rect(x, y + 2, 2, 4, c[2]); P.rect(x + 6, y + 2, 2, 4, c[2]); }
      else { P.rect(x + 2, y + 1, 4, 4, c[0]); P.rect(x + 3, y + 5, 2, 2, c[1]); P.px(x + 3, y + 3, c[3]); P.px(x + 5, y + 3, c[3]); P.rect(x + 2, y + 1, 4, 1, c[2]); }
    }
  },
  obsidian(P, c, rng) {
    P.fill(c[1]);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { const x = k * 8 + (r % 2) * 4, y = r * 8; P.rect(x + 1, y + 1, 6, 6, c[0]); P.px(x + 2, y + 2, c[2]); P.px(x + 3, y + 2, c[2]); }
  },
  wood(P, c, rng) {
    P.fill(c[3]);
    for (let r = 0; r < 6; r++) {
      const y = Math.floor(r * 32 / 6), h = Math.floor((r + 1) * 32 / 6) - y - 1;
      const tone = r % 2 ? c[1] : c[0];
      P.rect(0, y, 32, h, tone);
      for (let i = 0; i < 8; i++) P.px(rng() * 32, y + 1 + rng() * Math.max(1, h - 1), c[1]);
      const seam = Math.floor(rng() * 32); for (let j = 0; j < h; j++) P.px(seam, y + j, c[3]);
      P.px(seam + 2, y + 1, c[2]);
    }
  },
  metal(P, c, rng) {
    P.fill(c[1]);
    for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
      const x = bx * 16, y = by * 16;
      P.rect(x + 1, y + 1, 14, 14, c[0]);
      for (let i = 3; i < 14; i += 3) P.rect(x + i, y + 2, 1, 12, c[1]);
      for (const [dx, dy] of [[2, 2], [13, 2], [2, 13], [13, 13]]) P.px(x + dx, y + dy, c[2]);
    }
  },
  ice(P, c, rng) {
    P.fill(c[0]);
    for (let i = 0; i < 40; i++) P.px(rng() * 32, rng() * 32, c[2]);
    for (let k = 0; k < 3; k++) { let x = rng() * 32, y = rng() * 32; for (let i = 0; i < 18; i++) { P.px(x, y, c[3]); x += rng() < 0.6 ? 1 : 0; y += rng() < 0.6 ? 1 : -1; } }
  },
  lava(P, c, rng) {
    P.fill(c[0]);
    for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) P.rect(bx * 8 + 1, by * 8 + 1, 6 + Math.floor(rng() * 2), 6 + Math.floor(rng() * 2), rng() < 0.5 ? c[0] : c[1]);
    for (let i = 0; i < 32; i++) { P.px(i, (i * 7) % 32, c[2]); P.px((i * 3) % 32, i, mix(c[2], '#ffd040', 0.4)); }
    for (let by = 0; by < 4; by++) for (let x = 0; x < 32; x++) P.px(x, by * 8, mix(c[2], c[0], 0.3));
  },
  ash(P, c, rng) {
    P.fill(c[0]);
    for (let i = 0; i < 160; i++) P.px(rng() * 32, rng() * 32, rng() < 0.5 ? c[1] : c[2]);
    for (let i = 0; i < 6; i++) P.px(rng() * 32, rng() * 32, '#c04018');
  },
  sand(P, c, rng) {
    P.fill(c[0]);
    for (let r = 0; r < 4; r++) for (let x = 0; x < 32; x++) P.px(x, r * 8 + Math.round(2 * Math.sin((x + r * 5) / 5)), c[1]);
    for (let i = 0; i < 90; i++) P.px(rng() * 32, rng() * 32, rng() < 0.5 ? c[2] : c[1]);
  },
  earth(P, c, rng) {
    P.fill(c[0]);
    for (let i = 0; i < 26; i++) { const x = rng() * 32, y = rng() * 32, s = 1 + Math.floor(rng() * 3); P.rect(x, y, s, s, rng() < 0.5 ? c[1] : c[2]); }
    for (let i = 0; i < 6; i++) P.rect(rng() * 32, rng() * 32, 2, 1, c[3]);
  },
  roots(P, c, rng) {
    FLOOR.earth(P, c, rng);
    for (let k = 0; k < 4; k++) { let x = rng() * 32, y = rng() * 32; for (let i = 0; i < 24; i++) { P.px(x, y, c[1]); P.px(x, y + 1, c[3]); x += 1; y += rng() < 0.4 ? 1 : (rng() < 0.5 ? -1 : 0); } }
    for (let i = 0; i < 20; i++) P.px(rng() * 32, rng() * 32, c[2]);
  },
  crystal(P, c, rng) {
    FLOOR.obsidian(P, c, rng);
    for (let i = 0; i < 10; i++) { const x = rng() * 32, y = rng() * 32; P.px(x, y, c[2]); P.px(x + 1, y, mix(c[2], '#ffffff', 0.5)); }
  },
  flesh(P, c, rng) {
    P.fill(c[0]);
    for (let k = 0; k < 5; k++) { let x = rng() * 32, y = rng() * 32; for (let i = 0; i < 20; i++) { P.px(x, y, c[3]); x += rng() < 0.5 ? 1 : 0; y += rng() < 0.5 ? 1 : -1; } }
    for (let i = 0; i < 30; i++) P.px(rng() * 32, rng() * 32, c[2]);
  }
};
FLOOR.sandstone = FLOOR.stone;

// ---------------- walls ----------------
const WALL = {
  stone(P, c, rng) {
    P.fill(c[3]);
    for (let r = 0; r < 4; r++) { const off = (r % 2) * 5; for (let k = -1; k < 3; k++) { const w = 10 + Math.floor(rng() * 4); P.rect(k * 13 + off + 1, r * 8 + 1, w, 7, rng() < 0.3 ? c[1] : c[0]); P.rect(k * 13 + off + 1, r * 8 + 1, w, 1, c[2]); } }
  },
  brick(P, c, rng) {
    P.fill(c[3]);
    for (let r = 0; r < 8; r++) { const off = (r % 2) * 4; for (let k = 0; k < 4; k++) { P.rect(k * 8 + off + 1, r * 4 + 1, 7, 3, rng() < 0.2 ? c[1] : c[0]); P.rect(k * 8 + off + 1, r * 4 + 1, 7, 1, c[2]); } }
  },
  marble(P, c, rng) {
    P.fill(c[1]);
    for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) { P.rect(k * 16 + 1, r * 16 + 1, 15, 15, c[0]); P.rect(k * 16 + 1, r * 16 + 1, 15, 1, c[2]); }
    for (let k = 0; k < 3; k++) { let x = rng() * 32, y = rng() * 32; for (let i = 0; i < 18; i++) { P.px(x, y, c[1]); y += 1; x += rng() < 0.5 ? 1 : -1; } }
  },
  bone(P, c, rng) {
    // stacked skulls and long bones
    P.fill(c[3]);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
      const x = k * 8 + (r % 2) * 4, y = r * 8;
      if ((r + k) % 2 === 0) {
        P.rect(x + 1, y + 1, 6, 5, c[0]); P.rect(x + 2, y + 6, 4, 1, c[1]);
        P.rect(x + 2, y + 3, 1, 1, c[3]); P.rect(x + 5, y + 3, 1, 1, c[3]); P.px(x + 4, y + 5, c[3]);
        P.rect(x + 1, y + 1, 6, 1, c[2]);
      } else {
        P.rect(x, y + 3, 8, 2, c[0]); P.rect(x, y + 2, 1, 4, c[2]); P.rect(x + 7, y + 2, 1, 4, c[2]);
      }
    }
  },
  obsidian(P, c, rng) {
    P.fill(c[1]);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) { const x = k * 16 + (r % 2) * 8, y = r * 8; P.rect(x + 1, y + 1, 15, 7, c[0]); P.rect(x + 2, y + 1, 4, 1, c[2]); }
  },
  wood(P, c, rng) {
    P.fill(c[3]);
    for (let k = 0; k < 6; k++) {
      const x = Math.floor(k * 32 / 6), w = Math.floor((k + 1) * 32 / 6) - x - 1;
      P.rect(x, 0, w, 32, k % 2 ? c[1] : c[0]);
      for (let i = 0; i < 6; i++) P.px(x + rng() * w, rng() * 32, c[1]);
      P.px(x + 1, 4, c[3]); P.px(x + 1, 27, c[3]);
    }
    P.rect(0, 8, 32, 2, c[3]); P.rect(0, 24, 32, 2, c[3]);
  },
  metal(P, c, rng) {
    P.fill(c[1]);
    for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) {
      const x = k * 16, y = r * 16;
      P.rect(x + 1, y + 1, 14, 14, c[0]); P.rect(x + 1, y + 1, 14, 1, c[2]);
      for (const [dx, dy] of [[2, 2], [13, 2], [2, 13], [13, 13]]) P.px(x + dx, y + dy, c[2]);
    }
    for (let i = 0; i < 12; i++) P.px(rng() * 32, rng() * 32, '#7a3a1a'); // rust flecks
  },
  ice(P, c, rng) {
    P.fill(c[1]);
    for (let r = 0; r < 4; r++) { const off = (r % 2) * 8; for (let k = 0; k < 2; k++) { P.rect(k * 16 + off + 1, r * 8 + 1, 15, 7, c[0]); P.rect(k * 16 + off + 2, r * 8 + 2, 5, 1, c[2]); } }
  },
  roots(P, c, rng) {
    P.fill(c[0]);
    for (let i = 0; i < 30; i++) P.rect(rng() * 32, rng() * 32, 2, 2, c[1]);
    for (let k = 0; k < 6; k++) { let x = rng() * 32; for (let y = 0; y < 32; y++) { P.px(x, y, c[3]); P.px(x + 1, y, c[1]); if (rng() < 0.3) x += rng() < 0.5 ? 1 : -1; } }
    for (let i = 0; i < 26; i++) P.px(rng() * 32, rng() * 32, c[2]);
  },
  ash(P, c, rng) {
    WALL.stone(P, c, rng);
    for (let k = 0; k < 5; k++) { const x = rng() * 32; const len = 6 + rng() * 14; for (let y = 0; y < len; y++) P.px(x, 32 - y, shade(c[3], 1.2)); } // soot streaks
  },
  sandstone(P, c, rng) {
    P.fill(c[3]);
    for (let r = 0; r < 4; r++) { const off = (r % 2) * 8; for (let k = 0; k < 2; k++) { P.rect(k * 16 + off + 1, r * 8 + 1, 15, 7, c[0]); for (let i = 0; i < 6; i++) P.px(k * 16 + off + 1 + rng() * 15, r * 8 + 1 + rng() * 7, c[1]); } }
  },
  earth(P, c, rng) {
    P.fill(c[0]);
    for (let i = 0; i < 18; i++) { const x = rng() * 32, y = rng() * 32, w = 3 + Math.floor(rng() * 5), h = 2 + Math.floor(rng() * 3); P.rect(x, y, w, h, c[1]); P.rect(x, y, w, 1, c[2]); P.rect(x, y + h, w, 1, c[3]); }
  },
  crystal(P, c, rng) {
    WALL.earth(P, materialColors('obsidian'), rng);
    for (let k = 0; k < 7; k++) { const x = rng() * 32, y = rng() * 32; for (let i = 0; i < 5; i++) { P.px(x, y - i, c[0]); P.px(x + 1, y - i, i < 3 ? c[2] : c[0]); } }
  },
  flesh(P, c, rng) {
    FLOOR.flesh(P, c, rng);
    for (let k = 0; k < 4; k++) { const y = rng() * 32; for (let x = 0; x < 32; x++) P.px(x, y + Math.round(Math.sin(x / 3)), c[1]); }
  }
};
WALL.lava = WALL.obsidian;
WALL.sand = WALL.sandstone;

// ---------------- overlays ----------------
function overlayGroundCover(P, cover, rng, colors) {
  for (const g of cover) {
    switch (g) {
      case 'water': {
        // irregular standing-water puddles with ripples
        for (let k = 0; k < 3; k++) {
          const cx = rng() * 32, cy = rng() * 32, rx = 4 + rng() * 6, ry = 2 + rng() * 3;
          for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
            if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) P.px(cx + x, cy + y, (x + y) % 5 === 0 ? '#5a8ab0' : '#2e5a7a');
          }
          P.px(cx - 1, cy - 1, '#a8d8f0'); P.px(cx, cy - 1, '#a8d8f0');
        }
        break;
      }
      case 'ash': for (let i = 0; i < 70; i++) P.px(rng() * 32, rng() * 32, rng() < 0.6 ? '#8a8782' : '#5a5856'); break;
      case 'blood': for (let k = 0; k < 3; k++) { const x = rng() * 32, y = rng() * 32; P.rect(x, y, 3, 2, '#5a0c10'); P.px(x + 3, y + 1, '#7a1418'); P.px(x - 1, y + 2, '#5a0c10'); } break;
      case 'moss': for (let k = 0; k < 6; k++) { const x = rng() * 32, y = rng() * 32; P.rect(x, y, 3, 2, '#4a6a32'); P.px(x + 1, y, '#7a9a4a'); } break;
      case 'bones': for (let k = 0; k < 3; k++) { const x = rng() * 32, y = rng() * 32; P.rect(x, y, 4, 1, '#e0d6c0'); P.px(x, y - 1, '#e0d6c0'); P.px(x + 3, y + 1, '#e0d6c0'); } break;
      case 'rubble': for (let k = 0; k < 7; k++) { const x = rng() * 32, y = rng() * 32; P.rect(x, y, 2, 2, colors[1]); P.px(x, y, colors[2]); } break;
      case 'snow': for (let i = 0; i < 90; i++) P.px(rng() * 32, rng() * 32, rng() < 0.7 ? '#eef6ff' : '#c8dcf0'); break;
      case 'ice': for (let i = 0; i < 20; i++) P.px(rng() * 32, rng() * 32, '#d8f0ff'); break;
      case 'sand': for (let i = 0; i < 40; i++) P.px(rng() * 32, rng() * 32, '#c8aa78'); break;
      case 'lava': for (let i = 0; i < 12; i++) P.px(rng() * 32, rng() * 32, '#ff6a20'); break;
      case 'cobweb': break; // walls only
      default: break;
    }
  }
}
function overlayWallCover(P, cover, rng) {
  if (cover.includes('water')) { for (let x = 0; x < 32; x++) { const h = 3 + Math.round(rng() * 2); for (let y = 0; y < h; y++) P.px(x, 31 - y, y === h - 1 ? '#2a3a44' : '#1e2a32'); } for (let i = 0; i < 6; i++) { const x = rng() * 32; for (let y = 0; y < 8; y++) P.px(x, 20 + y, '#2a3a44'); } }
  if (cover.includes('moss')) for (let i = 0; i < 26; i++) P.px(rng() * 32, 20 + rng() * 12, rng() < 0.5 ? '#4a6a32' : '#6a8a42');
  if (cover.includes('ash')) for (let i = 0; i < 30; i++) P.px(rng() * 32, rng() * 32, '#2a2928');
  if (cover.includes('blood')) for (let k = 0; k < 2; k++) { const x = rng() * 32, y = rng() * 16; for (let i = 0; i < 8; i++) P.px(x + (i % 2), y + i, '#5a0c10'); }
  if (cover.includes('cobweb')) { const x = 0, y = 0; for (let i = 0; i < 8; i++) { P.px(x + i, y + i, '#c8c8c8'); P.px(x + i, y, '#a0a0a0'); P.px(x, y + i, '#a0a0a0'); } }
  if (cover.includes('snow') || cover.includes('ice')) for (let x = 0; x < 32; x++) P.px(x, 0, '#eef6ff');
}

// ---------------- level-spec wall decals + floor scatter ----------------
function overlayDecals(P, decals, rng) {
  for (const d of decals || []) {
    const c = d.color || '#2a2018'; const n = Math.max(1, Math.round((d.density ?? 0.5) * 6));
    switch (d.kind) {
      case 'glyphs': for (let k = 0; k < n + 2; k++) { const x = 3 + Math.floor(rng() * 26), y = 6 + Math.floor(rng() * 18); const g = Math.floor(rng() * 4);
        P.px(x, y, c); P.px(x, y + 1, c); P.px(x, y + 2, c); if (g === 0) { P.px(x + 1, y, c); P.px(x + 2, y, c); } else if (g === 1) { P.px(x + 1, y + 1, c); P.px(x + 2, y + 2, c); } else if (g === 2) { P.px(x - 1, y + 2, c); P.px(x + 1, y + 2, c); } else { P.px(x + 1, y, c); P.px(x + 1, y + 2, c); } } break;
      case 'vines': case 'roots': for (let k = 0; k < n; k++) { let x = rng() * 32; const len = 10 + rng() * 20; for (let y = 0; y < len; y++) { x += rng() < 0.5 ? -0.6 : 0.6; P.px(x, y, c); if (rng() < 0.2) P.px(x + 1, y, mix(c, '#ffffff', 0.25)); } } break;
      case 'tapestry': case 'banners': case 'murals': { if (rng() > (d.density ?? 0.4)) break; const x = 8 + Math.floor(rng() * 8), w = 7, h = 10; P.rect(x, 4, w, h, c); P.rect(x, 4, w, 1, mix(c, '#000000', 0.4)); for (let i = 0; i < 4; i++) P.rect(x + 2 + i * 2, 8 + (i % 2) * 4, 1, 3, mix(c, '#e0c060', 0.6)); for (let i = 0; i < w; i++) if (rng() < 0.5) P.px(x + i, 4 + h, c); break; }
      case 'cracks': for (let k = 0; k < n; k++) { let x = rng() * 32, y = rng() * 16; for (let i = 0; i < 9; i++) { P.px(x, y, c); y += 1; x += rng() < 0.5 ? -1 : 1; } } break;
      case 'moss': for (let i = 0; i < n * 8; i++) P.px(rng() * 32, 20 + rng() * 12, rng() < 0.5 ? '#4a6a32' : '#6a8a42'); break;
      case 'frost': for (let i = 0; i < n * 10; i++) P.px(rng() * 32, rng() * 10, '#e8f6ff'); break;
      case 'blood': for (let k = 0; k < n; k++) { const x = rng() * 32, y = rng() * 16; for (let i = 0; i < 7; i++) P.px(x + (i % 2), y + i, '#5a0c10'); } break;
      case 'cobwebs': for (let i = 0; i < 8; i++) { P.px(i, i, '#c8c8c8'); P.px(i, 0, '#a0a0a0'); P.px(0, i, '#a0a0a0'); } break;
      case 'water_stains': for (let k = 0; k < n; k++) { const x = rng() * 32; for (let y = 0; y < 12; y++) P.px(x, y, 'rgba(20,30,40,0.5)'); } break;
      default: break;
    }
  }
}
function overlayScatter(P, scatter, rng) {
  for (const d of scatter || []) {
    const c = d.color || '#c8aa78'; const n = Math.max(1, Math.round((d.density ?? 0.5) * 6));
    switch (d.kind) {
      case 'sand': for (let k = 0; k < 2; k++) { const cx = rng() * 32, cy = rng() * 32; for (let y = -3; y <= 3; y++) for (let x = -8; x <= 8; x++) if ((x * x) / 64 + (y * y) / 9 < 1 && rng() < 0.8) P.px(cx + x, cy + y, (x + y) % 3 ? c : mix(c, '#ffffff', 0.2)); } for (let i = 0; i < n * 8; i++) P.px(rng() * 32, rng() * 32, c); break;
      case 'bones': for (let k = 0; k < n; k++) { const x = rng() * 32, y = rng() * 32; P.rect(x, y, 4, 1, c); P.px(x, y - 1, c); P.px(x + 3, y + 1, c); } break;
      case 'coins': for (let k = 0; k < n + 1; k++) { const x = rng() * 32, y = rng() * 32; P.rect(x, y, 2, 1, c); P.px(x, y + 1, mix(c, '#000000', 0.35)); } break;
      case 'petals': case 'leaves': for (let k = 0; k < n * 3; k++) { const x = rng() * 32, y = rng() * 32; P.px(x, y, c); P.px(x + 1, y, mix(c, '#000000', 0.2)); } break;
      case 'fungi': for (let k = 0; k < n; k++) { const x = rng() * 32, y = rng() * 32; P.px(x, y, d.glow || c); P.px(x + 1, y, d.glow || c); P.px(x, y - 1, mix(d.glow || c, '#ffffff', 0.5)); } break;
      case 'puddles': for (let k = 0; k < 2; k++) { const cx = rng() * 32, cy = rng() * 32; for (let y = -2; y <= 2; y++) for (let x = -5; x <= 5; x++) if ((x * x) / 25 + (y * y) / 4 <= 1) P.px(cx + x, cy + y, c); P.px(cx - 1, cy - 1, '#a8d8f0'); } break;
      case 'snow': for (let i = 0; i < n * 14; i++) P.px(rng() * 32, rng() * 32, '#eef6ff'); break;
      case 'straw': case 'reeds': for (let i = 0; i < n * 6; i++) { const x = rng() * 32, y = rng() * 32; P.px(x, y, c); P.px(x + 1, y + (rng() < 0.5 ? 1 : 0), c); } break;
      case 'ash': case 'embers': for (let i = 0; i < n * 10; i++) P.px(rng() * 32, rng() * 32, d.kind === 'embers' && rng() < 0.3 ? '#ff7a20' : c); break;
      case 'rubble': for (let k = 0; k < n + 2; k++) { const x = rng() * 32, y = rng() * 32; P.rect(x, y, 2, 2, c); P.px(x, y, mix(c, '#ffffff', 0.3)); } break;
      case 'glass': for (let k = 0; k < n * 2; k++) P.px(rng() * 32, rng() * 32, '#d8f0ff'); break;
      case 'moss': case 'blood': for (let k = 0; k < n; k++) { const x = rng() * 32, y = rng() * 32; P.rect(x, y, 3, 2, c); } break;
      default: break;
    }
  }
}

function upscale(small, ctx) {
  const S = ctx.canvas.width;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, S, S);
  ctx.drawImage(small, 0, 0, BASE, BASE, 0, 0, S, S);
}

/** True if this module has a texture for the material. */
function hasMaterial(kind, material) {
  return !!(kind === 'wall' ? WALL[material] : FLOOR[material]);
}

/**
 * Paint a tileable floor or wall texture.
 * @param kind 'floor' | 'wall'
 * @param opts { material, palette, groundCover:[...], seed }
 */
function drawSceneSurface(ctx, createCanvas, kind, opts = {}) {
  const material = opts.material || 'stone';
  const table = kind === 'wall' ? WALL : FLOOR;
  const fn = table[material] || table.stone;
  const small = createCanvas(BASE, BASE);
  const sctx = small.getContext('2d');
  const P = painter(sctx);
  const rng = makeRng(seedFrom(`${kind}|${material}|${opts.seed || ''}`));
  const colors = materialColors(MAT[material] ? material : 'stone', opts.palette, opts.paletteStrength ?? 0.35);
  fn(P, colors, rng);
  const cover = Array.isArray(opts.groundCover) ? opts.groundCover : [];
  if (kind === 'floor') { overlayGroundCover(P, cover, rng, colors); overlayScatter(P, opts.scatter, rng); }
  else { overlayWallCover(P, cover, rng); overlayDecals(P, opts.decals, rng); }
  upscale(small, ctx);
  return material;
}

module.exports = { drawSceneSurface, hasMaterial, materialColors, overlayDecals, overlayScatter };
