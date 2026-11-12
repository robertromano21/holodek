'use strict';
// Sprite-quality scenery painters for the preview grammar. Dedicated silhouettes,
// multi-material palettes, lit/mid/shadow faces, dark outlines, cluster texture.

function mats(cols, mix) {
  const c = cols.c, s = cols.s, d = cols.d;
  const accent = cols.accent || d;
  const light = cols.light || d;
  const foliage = cols.foliage || mix(c, '#3d7a3a', 0.55);
  const outline = mix(s, '#000000', 0.62);
  return {
    c, s, d, accent, light, foliage, outline,
    wood: mix(c, '#6b4424', 0.5), woodSh: mix(s, '#3a2412', 0.45), woodHi: mix(d, '#c49a5a', 0.35),
    roof: mix(c, '#7a2e28', 0.48), roofSh: mix(s, '#3a1614', 0.5), roofHi: mix(d, '#c46a48', 0.3),
    thatch: mix(c, '#b08a3a', 0.4), thatchSh: mix(s, '#5a4018', 0.45), thatchHi: mix(d, '#e0c06a', 0.3),
    metal: mix(c, '#8a9098', 0.55), metalSh: mix(s, '#2a2e34', 0.5), metalHi: mix(d, '#d0d4d8', 0.35),
    glass: mix(light, '#8ec8e8', 0.35),
    flame: mix(accent, '#ffb030', 0.45), flameHi: mix(light, '#fff0a8', 0.5),
    water: mix(c, '#2a6a88', 0.5), waterHi: mix(d, '#a8d8e8', 0.4),
    cloth: mix(accent, c, 0.35), clothSh: mix(s, accent, 0.4),
    moss: mix(foliage, '#2a5a28', 0.3)
  };
}

function scaleOf(p) {
  const far = p.depth === 'far' || p.w < 18 || p.h < 18;
  const rich = !far && p.w >= 28 && p.h >= 28;
  return { far, rich, mid: !far };
}

const ASPECT = {
  cottage: 0.95, hut: 0.95, watchtower: 0.42, keep_tower: 0.42,
  lighthouse: 0.38, windmill: 1.0, gate_wall: 1.35, wall_gate: 1.35, gatehouse: 1.35,
  stone_bridge: 2.55, stone_statue: 0.5, plaza_fountain: 1.05, fountain_bowl: 1.05,
  water_well: 0.85, well_house: 0.85, dome_building: 0.9, domed_hall: 0.9,
  spire: 0.4, bell_tower: 0.4, minaret: 0.4, arch_ruin: 1.15, column_ruin: 1.15,
  market_stall: 1.2, tent_pavilion: 0.9, canvas_tent: 0.9,
  ship: 2.35, shipwreck: 2.25, boat: 2.2,
  pine: 0.55, broadleaf: 0.72, dead_tree: 0.65, willow: 0.7, palm_tree: 0.6,
  rock_formation: 1.25, boulder: 1.2, crag: 1.1, cliff: 0.78, water_fall: 0.62,
  mushroom: 0.9, crystal_cluster: 0.85, crystal_spire: 0.5,
  royal_throne: 0.75, stone_altar: 1.25, book_case: 0.7,
  workbench: 2.05, banquet_table: 2.0, candelabra: 0.55, brazier_stand: 0.65,
  hanging_banner: 0.42, tapestry: 0.5, wall_banner: 0.42,
  machine_console: 0.85, alien_pylon: 0.4, dish_antenna: 0.95,
  ringed_planet: 1.4, landing_spire: 0.4
};
const CENTER_ANCHOR = new Set(['ringed_planet']);

function fitBox(p, aspect, anchor) {
  aspect = aspect || 0.9;
  let x = p.x, y = p.y, w = p.w, h = p.h;
  if (w <= 2 || h <= 2) return { x, y, w, h };
  const a = w / h;
  if (a > aspect) {
    const nw = Math.max(4, Math.round(h * aspect));
    x = Math.round(x + (w - nw) / 2);
    w = nw;
  } else {
    const nh = Math.max(4, Math.round(w / aspect));
    if (anchor === 'center') y = Math.round(y + (h - nh) / 2);
    else y = Math.round(y + (h - nh));
    h = nh;
  }
  return { x, y, w, h };
}

function condOf(p) {
  return (p.parts && p.parts.condition) || p.condition || 'intact';
}

function punchEllipse(T, snap, x, y, w, h) {
  if (!snap) return false;
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  if (rx < 1 || ry < 1) return false;
  restorePoly(T, snap, (xx, yy) => {
    const dx = (xx - cx) / rx, dy = (yy - cy) / ry;
    return dx * dx + dy * dy <= 1;
  });
  return true;
}

function clusters(T, x, y, w, h, color, n, salt) {
  const { rect, hash } = T;
  const area = Math.max(4, w * h);
  const count = Math.min(n, Math.max(1, Math.floor(area / 28)));
  for (let i = 0; i < count; i++) {
    const xx = x + (hash('cx' + salt + i + x + y) % Math.max(1, w - 1));
    const yy = y + (hash('cy' + salt + i + x + y) % Math.max(1, h - 1));
    const zw = 1 + (hash('cw' + salt + i) % 2);
    const zh = 1 + (hash('ch' + salt + i) % 2);
    if (xx + zw <= x + w && yy + zh <= y + h) rect(xx, yy, zw, zh, color);
  }
}

function windowAt(T, x, y, w, h, frame, glass, mullion, rich) {
  const { rect } = T;
  w = Math.max(3, Math.round(w)); h = Math.max(4, Math.round(h));
  rect(x, y, w, h, frame);
  if (w > 2 && h > 2) rect(x + 1, y + 1, w - 2, h - 2, glass);
  if (rich && w >= 6 && h >= 6) {
    rect(x + Math.floor(w / 2), y + 1, 1, h - 2, mullion);
    if (h >= 8) rect(x + 1, y + Math.floor(h / 2), w - 2, 1, mullion);
  }
}

function doorAt(T, x, y, w, h, frame, fill, knob, rich) {
  const { rect } = T;
  w = Math.max(3, Math.round(w)); h = Math.max(5, Math.round(h));
  rect(x, y, w, h, frame);
  if (w > 2 && h > 2) rect(x + 1, y + 1, w - 2, h - 2, fill);
  if (rich && w >= 5) rect(x + w - 2, y + Math.floor(h * 0.55), 1, 1, knob);
}

function box(T, x, y, w, h, mid, lit, sh, out, litL) {
  const { rect } = T;
  rect(x, y, w, h, out);
  if (w > 2 && h > 2) rect(x + 1, y + 1, w - 2, h - 2, mid);
  const band = Math.max(1, Math.round((w - 2) * 0.22));
  if (w > 4 && h > 3) {
    if (litL) { rect(x + 1, y + 1, band, h - 2, lit); rect(x + w - 1 - band, y + 1, band, h - 2, sh); }
    else { rect(x + w - 1 - band, y + 1, band, h - 2, lit); rect(x + 1, y + 1, band, h - 2, sh); }
  }
}

function gable(T, x, y, w, ch, mid, lit, sh, out, litL) {
  const { poly } = T;
  const peak = litL ? x + w * 0.42 : x + w * 0.58;
  const base = y + ch;
  poly([[x - 2, base], [peak, y], [x + w + 2, base]], mid, out);
  if (litL) poly([[x - 2, base], [peak, y], [peak, base]], lit);
  else poly([[peak, y], [x + w + 2, base], [peak, base]], lit);
  // shadow slope
  if (litL) poly([[peak, y], [x + w + 2, base], [peak + 1, base]], sh);
  else poly([[x - 2, base], [peak, y], [peak - 1, base]], sh);
}

function flames(T, x, y, w, h, M, n) {
  const { poly, hash } = T;
  const k = Math.max(2, n);
  for (let i = 0; i < k; i++) {
    const xx = x + (i + 0.5) * w / k + ((hash('fl' + i + x) % 3) - 1);
    const hh = h * (0.6 + (hash('fh' + i + x) % 5) / 10);
    poly([[xx - 1, y + h], [xx, y + h - hh], [xx + 2, y + h]], i % 2 ? M.flame : M.flameHi, M.outline);
  }
}

function snapshotBBox(tools, x, y, w, h) {
  const ctx = tools.ctx;
  if (!ctx || !ctx.getImageData) return null;
  const x0 = Math.max(0, Math.floor(x - 4)), y0 = Math.max(0, Math.floor(y - 8));
  const x1 = Math.min(tools.width || 320, Math.ceil(x + w + 6));
  const y1 = Math.min(tools.height || 200, Math.ceil(y + h + 6));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1, data: ctx.getImageData(x0, y0, x1 - x0, y1 - y0) };
}

function restoreRect(tools, snap, sx, sy, sw, sh) {
  if (!snap || !tools.ctx) return;
  const ctx = tools.ctx;
  const img = ctx.getImageData(0, 0, tools.width || 320, tools.height || 200);
  const D = img.data, S = snap.data.data, sw0 = snap.x1 - snap.x0, sh0 = snap.y1 - snap.y0;
  const W = tools.width || 320;
  const x0 = Math.max(snap.x0, Math.round(sx)), y0 = Math.max(snap.y0, Math.round(sy));
  const x1 = Math.min(snap.x1, Math.round(sx + sw)), y1 = Math.min(snap.y1, Math.round(sy + sh));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
    const di = (yy * W + xx) * 4;
    const si = ((yy - snap.y0) * sw0 + (xx - snap.x0)) * 4;
    if (si < 0 || si + 3 >= S.length) continue;
    D[di] = S[si]; D[di + 1] = S[si + 1]; D[di + 2] = S[si + 2]; D[di + 3] = S[si + 3];
  }
  ctx.putImageData(img, 0, 0);
}

function restorePoly(tools, snap, testFn) {
  if (!snap || !tools.ctx) return;
  const ctx = tools.ctx;
  const img = ctx.getImageData(0, 0, tools.width || 320, tools.height || 200);
  const D = img.data, S = snap.data.data, sw0 = snap.x1 - snap.x0;
  const W = tools.width || 320;
  for (let yy = snap.y0; yy < snap.y1; yy++) for (let xx = snap.x0; xx < snap.x1; xx++) {
    if (!testFn(xx, yy)) continue;
    const di = (yy * W + xx) * 4;
    const si = ((yy - snap.y0) * sw0 + (xx - snap.x0)) * 4;
    D[di] = S[si]; D[di + 1] = S[si + 1]; D[di + 2] = S[si + 2]; D[di + 3] = S[si + 3];
  }
  ctx.putImageData(img, 0, 0);
}

function applyCondition(T, p, M, snap, litL) {
  const { rect, hash, mixHex } = T;
  const cond = condOf(p);
  const x = p.x, y = p.y, w = p.w, h = p.h, baseY = y + h;
  const { far } = scaleOf(p);
  if (cond === 'intact') return;
  if (far && cond !== 'ruined' && cond !== 'overgrown') return;

  if (cond === 'weathered' || cond === 'ruined') {
    const streaks = far ? 2 : (cond === 'ruined' ? 6 : 5);
    const stain = mixHex(M.s, '#1a100c', 0.62);
    for (let i = 0; i < streaks; i++) {
      const xx = x + 2 + (hash('stx' + i + x) % Math.max(1, w - 5));
      const yy = y + Math.round(h * (0.04 + (hash('sty' + i + x) % 18) / 100));
      const hh = Math.round(h * (0.38 + (hash('sth' + i + x) % 28) / 100));
      const sw = cond === 'ruined' ? 2 : 2;
      rect(xx, yy, sw, Math.min(hh, baseY - yy - 1), stain);
      clusters(T, xx - 1, yy, sw + 3, Math.min(hh, baseY - yy - 1), mixHex(stain, M.c, 0.3), 5, 'stc' + i + x);
    }
    const chips = far ? 2 : (cond === 'ruined' ? 8 : 5);
    for (let i = 0; i < chips; i++) {
      const side = hash('chip' + i + x) % 4;
      const cw = 3 + (hash('cww' + i + x) % 4), ch = 2 + (hash('cwh' + i + x) % 3);
      let cx, cy;
      if (side === 0) { cx = x + (hash('cx' + i + x) % Math.max(1, w - cw)); cy = y; }
      else if (side === 1) { cx = x + w - cw; cy = y + (hash('cy' + i + x) % Math.max(1, h - ch)); }
      else if (side === 2) { cx = x + (hash('cx' + i + x) % Math.max(1, w - cw)); cy = baseY - ch; }
      else { cx = x; cy = y + (hash('cy' + i + x) % Math.max(1, h - ch)); }
      if (snap) restoreRect(T, snap, cx, cy, cw, ch);
      else rect(cx, cy, cw, ch, M.outline);
    }
  }
  if (cond === 'ruined') {
    const left = (hash('ruin' + x) % 2) === 0;
    const rw = Math.max(8, Math.round(w * 0.46)), rh = Math.max(8, Math.round(h * 0.38));
    const rx = left ? x : x + w - rw, ry = y;
    if (snap) {
      restorePoly(T, snap, (xx, yy) => {
        if (yy < ry || yy > ry + rh) return false;
        if (left) return xx >= rx && (xx - rx) > (yy - ry) * (rw / (rh * 1.15)) - 1 && xx < rx + rw;
        return xx <= rx + rw && (rx + rw - xx) > (yy - ry) * (rw / (rh * 1.15)) - 1 && xx > rx;
      });
      // hole in the wall
      const hx = x + w * (left ? 0.55 : 0.15), hy = y + h * 0.48;
      punchEllipse(T, snap, hx, hy, Math.max(5, w * 0.22), Math.max(5, h * 0.18));
    }
    const n = far ? 3 : 8;
    for (let i = 0; i < n; i++) {
      const rw2 = 4 + (hash('rbw' + i + x) % 8), rh2 = 3 + (hash('rbh' + i + x) % 5);
      const rx2 = x + (hash('rbx' + i + x) % Math.max(1, w + 4)) - 3;
      const col = i % 2 ? M.s : M.c;
      T.poly([[rx2, baseY], [rx2 + rw2 * 0.35, baseY - rh2], [rx2 + rw2 * 0.7, baseY - rh2 * 0.45], [rx2 + rw2, baseY]], col, M.outline);
    }
  }
  if (cond === 'overgrown') {
    const vines = far ? 2 : 5;
    const leaf = M.foliage, moss = M.moss;
    for (let i = 0; i < vines; i++) {
      let vx = x + 1 + Math.round((i + 0.3) * (w - 3) / Math.max(1, vines));
      const top = y + Math.round(h * (0.08 + (hash('vt' + i + x) % 30) / 100));
      const dir = i % 2 ? 1 : -1;
      for (let yy = baseY - 2; yy > top; yy -= 3) {
        rect(vx, yy, 2, 4, i % 2 ? moss : leaf);
        if ((hash('vw' + i + yy + x) % 3) === 0) vx += dir;
        if (vx < x) vx = x;
        if (vx > x + w - 3) vx = x + w - 3;
        if ((hash('vl' + i + yy + x) % 4) === 0) rect(vx + dir * 2, yy, 3, 2, leaf);
      }
    }
    // moss clumps along the base and upper edge / roof
    const clump = far ? 4 : 10;
    for (let i = 0; i < clump; i++) {
      const cw = 3 + (hash('mw' + i + x) % 4), ch = 2 + (hash('mh' + i + x) % 3);
      const cx = x + (hash('mx' + i + x) % Math.max(1, w - cw));
      const onRoof = (hash('mr' + i + x) % 3) === 0;
      const cy = onRoof ? y + (hash('my' + i + x) % 5) : baseY - ch - (hash('my' + i + x) % 4);
      rect(cx, cy, cw, ch, i % 2 ? leaf : moss);
    }
  }
}



function lumaHex(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return 80;
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 3 + g * 6 + b) / 10;
}

function boostContrast(M, mix) {
  if (lumaHex(M.c) - lumaHex(M.s) < 38 || lumaHex(M.s) > 88) {
    M.s = mix(M.s, '#101218', 0.52);
    M.d = mix(M.d, '#f6f4ee', 0.32);
    M.c = mix(M.c, M.s, 0.08);
    M.outline = mix(M.s, '#000000', 0.5);
  }
  return M;
}

function preTint(hex, lighting) {
  if (!hex || (lighting !== 'golden_hour' && lighting !== 'sandstorm_haze')) return hex;
  const t = lighting === 'golden_hour' ? [0.9, 1, 1.18] : [0.94, 1, 1.16];
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v, i) => Math.max(0, Math.min(255, Math.round(v * t[i]))));
  return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('');
}

function paleSnow(M) {
  return lumaHex(M.d) > 180 || lumaHex(M.c) > 150;
}

function after(T, p, M, snap, litL) {
  applyCondition(T, p, M, snap, litL);
}

// ----------------- buildings -----------------
function cottage(T, p, M, litL, sc, snap) {
  const { rect, line } = T;
  const { x, y, w, h } = p, { rich } = sc;
  const ch = Math.max(6, Math.round(h * 0.34));
  const eaves = y + ch;
  gable(T, x, y, w, ch, M.roof, M.roofHi, M.roofSh, M.outline, litL);
  // eaves line
  rect(x - 2, eaves, w + 4, 2, M.outline);
  rect(x - 1, eaves, w + 2, 1, M.roofHi);
  box(T, x, eaves, w, h - ch, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  clusters(T, x + 2, eaves + 2, w - 4, h - ch - 3, M.woodSh, rich ? 10 : 4, 'plk' + x);
  // horizontal plank clusters rather than full lines
  if (rich) {
    for (let yy = eaves + 4; yy < y + h - 4; yy += 4) {
      const gap = 3 + (T.hash('pg' + yy + x) % 4);
      for (let xx = x + 2; xx < x + w - 3; xx += gap + 6) rect(xx, yy, Math.min(6, x + w - 3 - xx), 1, M.woodSh);
    }
  }
  const dw = Math.max(3, Math.round(w * 0.2)), dh = Math.max(6, Math.round((h - ch) * 0.55));
  doorAt(T, Math.round(x + w * 0.38), y + h - dh, dw, dh, M.outline, M.woodSh, M.accent, rich);
  if (w >= 24) {
    windowAt(T, x + 4, eaves + Math.max(3, (h - ch) * 0.18), Math.max(4, w * 0.16), Math.max(5, h * 0.16), M.outline, M.glass, M.wood, rich);
    windowAt(T, x + w - 4 - Math.max(4, w * 0.16), eaves + Math.max(3, (h - ch) * 0.18), Math.max(4, w * 0.16), Math.max(5, h * 0.16), M.outline, M.glass, M.wood, rich);
  }
  // chimney
  const cw = Math.max(3, Math.round(w * 0.1)), cy = y + 2, cx = litL ? x + w * 0.72 : x + w * 0.16;
  rect(cx, cy, cw, ch + 2, M.outline);
  rect(cx + 1, cy + 1, cw - 2, ch, M.c);
  rect(cx, cy, cw, 2, M.s);
  after(T, p, M, snap, litL);
}

function hut(T, p, M, litL, sc, snap) {
  const { rect, poly, line } = T;
  const { x, y, w, h } = p, { rich } = sc;
  const ch = Math.max(7, Math.round(h * 0.42));
  const peak = x + w * 0.5;
  poly([[x - 3, y + ch], [peak, y], [x + w + 3, y + ch]], M.thatch, M.outline);
  if (litL) poly([[x - 3, y + ch], [peak, y], [peak, y + ch]], M.thatchHi);
  else poly([[peak, y], [x + w + 3, y + ch], [peak, y + ch]], M.thatchHi);
  // thatch clumps, not lines
  clusters(T, x, y + 2, w, ch - 2, M.thatchSh, rich ? 12 : 5, 'th' + x);
  box(T, x + 1, y + ch - 1, w - 2, h - ch + 1, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  const dw = Math.max(3, Math.round(w * 0.22)), dh = Math.max(6, Math.round((h - ch) * 0.7));
  doorAt(T, Math.round(x + w / 2 - dw / 2), y + h - dh, dw, dh, M.outline, M.woodSh, M.d, rich);
  if (rich && w > 22) windowAt(T, x + 3, y + ch + 3, 5, 5, M.outline, M.glass, M.wood, false);
  after(T, p, M, snap, litL);
}

function watchtower(T, p, M, litL, sc, snap) {
  const { rect, line } = T;
  const { x, y, w, h, count } = p, { rich, far } = sc;
  const mer = Math.max(4, Math.round(h * 0.12));
  const topW = Math.max(8, Math.round(w * 0.8));
  const tx = Math.round(x + (w - topW) / 2);
  // tapered shaft via slices so it never reads as a single slab
  const shaftY = y + mer, shaftH = h - mer;
  for (let i = 0; i < shaftH; i++) {
    const t = i / Math.max(1, shaftH - 1);
    const ww = Math.round(topW + (w - topW) * t);
    const xx = Math.round(x + (w - ww) / 2);
    rect(xx, shaftY + i, ww, 1, M.outline);
    rect(xx + 1, shaftY + i, Math.max(1, ww - 2), 1, M.c);
    const band = Math.max(1, Math.round((ww - 2) * 0.28));
    if (litL) { rect(xx + 1, shaftY + i, band, 1, M.d); rect(xx + ww - 1 - band, shaftY + i, band, 1, M.s); }
    else { rect(xx + ww - 1 - band, shaftY + i, band, 1, M.d); rect(xx + 1, shaftY + i, band, 1, M.s); }
  }
  // parapet + merlons
  rect(tx - 3, y, topW + 6, mer + 3, M.outline);
  rect(tx - 2, y + 1, topW + 4, mer + 1, M.c);
  if (litL) rect(tx - 2, y + 1, Math.max(2, Math.round((topW + 4) * 0.28)), mer + 1, M.d);
  const n = Math.max(3, Math.min(count || 4, 6));
  const snow = paleSnow(M);
  for (let i = 0; i < n; i++) {
    const mw = Math.max(2, Math.floor((topW + 6) / n * 0.5));
    const mx = tx - 3 + Math.round(i * (topW + 6) / n);
    rect(mx, y - 4, mw, 5, (i % 2) ? M.c : M.s);
    line(mx, y - 4, mx + mw, y - 4, M.outline);
    if (snow) rect(mx, y - 5, mw, 2, M.d);
  }
  if (!far) {
    const sl = Math.max(2, Math.round(w * 0.14));
    windowAt(T, Math.round(x + w / 2 - sl / 2), y + h * 0.3, sl, Math.max(5, h * 0.1), M.outline, M.s, M.c, false);
    windowAt(T, Math.round(x + w / 2 - sl / 2), y + h * 0.5, sl, Math.max(5, h * 0.1), M.outline, M.s, M.c, false);
    if (snow) {
      clusters(T, tx - 2, y + 1, topW + 4, 3, M.d, 5, 'snw' + x);
      rect(x + 2, y + h * 0.62, Math.max(3, w * 0.2), 2, M.d);
    }
  }
  const dw = Math.max(3, Math.round(w * 0.28)), dh = Math.max(6, Math.round(h * 0.16));
  doorAt(T, Math.round(x + w / 2 - dw / 2), y + h - dh, dw, dh, M.outline, M.s, M.accent, rich);
  after(T, p, M, snap, litL);
}

function lighthouse(T, p, M, litL, sc, snap) {
  const { rect, poly, line } = T;
  const { x, y, w, h } = p, { rich } = sc;
  const lanternH = Math.max(6, Math.round(h * 0.16));
  const capH = Math.max(4, Math.round(h * 0.08));
  const galH = 3;
  const shaftY = y + capH + lanternH + galH;
  const shaftH = y + h - shaftY;
  const topW = Math.max(6, Math.round(w * 0.42));
  const botW = w;
  // shaft taper via horizontal slices
  for (let i = 0; i < shaftH; i++) {
    const t = i / Math.max(1, shaftH - 1);
    const ww = Math.round(topW + (botW - topW) * t);
    const xx = Math.round(x + (w - ww) / 2);
    const yy = shaftY + i;
    rect(xx, yy, ww, 1, M.outline);
    rect(xx + 1, yy, ww - 2, 1, M.c);
    const band = Math.max(1, Math.round((ww - 2) * 0.22));
    if (litL) { rect(xx + 1, yy, band, 1, M.d); rect(xx + ww - 1 - band, yy, band, 1, M.s); }
    else { rect(xx + ww - 1 - band, yy, band, 1, M.d); rect(xx + 1, yy, band, 1, M.s); }
  }
  // dark bands
  if (rich) {
    for (const f of [0.25, 0.5, 0.75]) {
      const yy = shaftY + Math.round(shaftH * f);
      const t = f;
      const ww = Math.round(topW + (botW - topW) * t);
      const xx = Math.round(x + (w - ww) / 2);
      rect(xx + 1, yy, ww - 2, 2, M.s);
    }
  }
  // gallery
  const gw = topW + 4, gx = Math.round(x + (w - gw) / 2);
  rect(gx, shaftY - galH, gw, galH, M.outline);
  rect(gx + 1, shaftY - galH + 1, gw - 2, galH - 1, M.metal);
  if (rich) for (let i = 0; i < 5; i++) rect(gx + 1 + i * (gw - 2) / 5, shaftY - galH - 2, 1, 2, M.metalSh);
  // lantern house
  const lw = topW, lx = Math.round(x + (w - lw) / 2), ly = y + capH;
  rect(lx, ly, lw, lanternH, M.outline);
  rect(lx + 1, ly + 1, lw - 2, lanternH - 2, M.flameHi);
  if (rich) {
    rect(lx + Math.floor(lw / 2), ly + 1, 1, lanternH - 2, M.metalSh);
    rect(lx + 1, ly + Math.floor(lanternH / 2), lw - 2, 1, M.metalSh);
  }
  // cap
  const cx = x + w / 2;
  poly([[lx - 1, ly], [cx, y], [lx + lw + 1, ly]], M.roof, M.outline);
  if (litL) poly([[lx - 1, ly], [cx, y], [cx, ly]], M.roofHi);
  else poly([[cx, y], [lx + lw + 1, ly], [cx, ly]], M.roofHi);
  const dw = Math.max(3, Math.round(w * 0.2)), dh = Math.max(6, Math.round(h * 0.14));
  doorAt(T, Math.round(x + w / 2 - dw / 2), y + h - dh, dw, dh, M.outline, M.s, M.accent, rich);
  after(T, p, M, snap, litL);
}

function windmill(T, p, M0, litL, sc, snap) {
  const { rect, line, poly } = T;
  const { x, y, w, h } = p, { rich, far } = sc;
  const M = Object.assign({}, M0);
  // keep body/sail hues out of the golden-hour pink flush; roof can stay warm
  const light = M.lighting;
  M.c = preTint(M.c, light); M.d = preTint(M.d, light);
  M.wood = preTint(M.wood, light); M.woodHi = preTint(M.woodHi, light); M.woodSh = preTint(M.woodSh, light);
  const capH = Math.max(6, Math.round(h * 0.18));
  const hubY = y + capH, hubX = x + w / 2;
  const bodyY = y + capH, bodyH = h - capH;
  const topW = Math.max(8, Math.round(w * 0.55));
  const tx = Math.round(x + (w - topW) / 2);
  for (let i = 0; i < bodyH; i++) {
    const t = i / Math.max(1, bodyH - 1);
    const ww = Math.round(topW + (w * 0.72 - topW) * t);
    const xx = Math.round(x + (w - ww) / 2);
    rect(xx, bodyY + i, ww, 1, M.outline);
    rect(xx + 1, bodyY + i, Math.max(1, ww - 2), 1, M.c);
    const band = Math.max(1, Math.round((ww - 2) * 0.22));
    if (litL) rect(xx + 1, bodyY + i, band, 1, M.d); else rect(xx + ww - 1 - band, bodyY + i, band, 1, M.d);
  }
  poly([[tx - 2, bodyY], [hubX, y], [tx + topW + 2, bodyY]], M.roof, M.outline);
  if (litL) poly([[tx - 2, bodyY], [hubX, y], [hubX, bodyY]], M.roofHi);
  else poly([[hubX, y], [tx + topW + 2, bodyY], [hubX, bodyY]], M.roofSh);
  const arm = Math.min(w, h) * 0.48;
  const canvas = preTint(mixSafe(T, M.d, '#e6dcc4', 0.5), light);
  const canvasSh = preTint(mixSafe(T, canvas, M.woodSh, 0.25), light);
  for (let i = 0; i < 4; i++) {
    const a = -0.45 + i * Math.PI / 2;
    const x2 = hubX + Math.cos(a) * arm, y2 = hubY + Math.sin(a) * arm * 0.85;
    const px = -Math.sin(a) * Math.max(3, w * 0.13), py = Math.cos(a) * Math.max(2, w * 0.1);
    const midX = hubX + Math.cos(a) * arm * 0.28, midY = hubY + Math.sin(a) * arm * 0.28 * 0.85;
    // wooden arm
    line(hubX, hubY, x2, y2, M.outline);
    line(hubX, hubY, x2, y2, M.wood);
    poly([[midX + px, midY + py], [x2 + px, y2 + py], [x2 - px, y2 - py], [midX - px, midY - py]], i % 2 ? canvas : canvasSh, M.outline);
    if (!far) {
      // lattice: two along, two across
      const ix = (k) => midX + (x2 - midX) * k, iy = (k) => midY + (y2 - midY) * k;
      line(ix(0.33) + px * 0.8, iy(0.33) + py * 0.8, ix(0.33) - px * 0.8, iy(0.33) - py * 0.8, M.woodSh);
      line(ix(0.66) + px * 0.8, iy(0.66) + py * 0.8, ix(0.66) - px * 0.8, iy(0.66) - py * 0.8, M.woodSh);
      line(midX + px * 0.45, midY + py * 0.45, x2 + px * 0.45, y2 + py * 0.45, M.woodSh);
      line(midX - px * 0.45, midY - py * 0.45, x2 - px * 0.45, y2 - py * 0.45, M.woodSh);
    }
  }
  rect(hubX - 2, hubY - 2, 5, 5, M.outline);
  rect(hubX - 1, hubY - 1, 3, 3, M.metal);
  const dw = Math.max(3, Math.round(w * 0.18)), dh = Math.max(6, Math.round(h * 0.16));
  doorAt(T, Math.round(x + w / 2 - dw / 2), y + h - dh, dw, dh, M.outline, M.s, M.d, rich);
  if (!far) windowAt(T, Math.round(x + w / 2 - 2), bodyY + bodyH * 0.25, 5, 6, M.outline, M.glass, M.c, true);
  after(T, p, M0, snap, litL);
}

function gate_wall(T, p, M, litL, sc, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = p, { rich } = sc;
  box(T, x, y + 3, w, h - 3, M.c, M.d, M.s, M.outline, litL);
  // coping
  rect(x - 1, y, w + 2, 4, M.outline);
  rect(x, y + 1, w, 2, M.c);
  clusters(T, x + 2, y + 6, w - 4, h - 10, M.s, rich ? 14 : 6, 'mw' + x);
  // masonry clusters in rows, not full lines
  if (rich) {
    for (let yy = y + 8; yy < y + h - 4; yy += 5) {
      const off = (yy / 5) & 1 ? 3 : 0;
      for (let xx = x + 2 + off; xx < x + w - 6; xx += 8) rect(xx, yy, 5, 1, M.s);
    }
  }
  const aw = Math.max(8, Math.round(w * 0.32)), ah = Math.max(10, Math.round(h * 0.62));
  const ax = Math.round(x + w / 2 - aw / 2), ay = y + h - ah;
  rect(ax, ay + Math.round(ah * 0.35), aw, Math.ceil(ah * 0.65), M.outline);
  rect(ax + 1, ay + Math.round(ah * 0.35), aw - 2, Math.ceil(ah * 0.65) - 1, '#0a0a0c');
  ellipse(ax, ay, aw, ah * 0.7, M.outline);
  ellipse(ax + 1, ay + 1, aw - 2, ah * 0.7 - 2, '#0a0a0c');
  if (rich) {
    // wooden gate leaves slightly recessed, not a gameplay door — scenery
    const leaf = Math.floor((aw - 4) / 2);
    rect(ax + 2, ay + Math.round(ah * 0.42), leaf, Math.round(ah * 0.5), M.woodSh);
    rect(ax + 2 + leaf + 1, ay + Math.round(ah * 0.42), leaf, Math.round(ah * 0.5), M.woodSh);
  }
  after(T, p, M, snap, litL);
}

function stone_bridge(T, p, M, litL, sc, snap) {
  const { rect, line } = T;
  const { x, y, w, h, count } = p, { rich, far } = sc;
  const deckH = Math.max(4, Math.round(h * 0.22));
  const deckY = y;
  box(T, x, deckY, w, deckH, M.c, M.d, M.s, M.outline, litL);
  if (!far) {
    line(x, deckY, x + w, deckY, M.d);
    for (let i = 0; i <= 6; i++) rect(Math.round(x + i * w / 6), deckY - 3, 1, 3, M.outline);
    line(x, deckY - 3, x + w, deckY - 3, M.s);
  }
  const n = Math.max(1, Math.min(count || 2, 3));
  for (let i = 0; i < n; i++) {
    const aw = w / n * 0.72, ax = x + i * w / n + w / n * 0.14;
    const ah = Math.max(6, h - deckH - 1), ay = y + deckH;
    // masonry arch ring, then punch the opening to the background
    const { ellipse } = T;
    ellipse(ax, ay - ah * 0.05, aw, ah * 1.15, M.outline);
    ellipse(ax + 1, ay - ah * 0.05 + 1, aw - 2, ah * 1.15 - 2, M.c);
    if (!punchEllipse(T, snap, ax + 3, ay + 1, aw - 6, ah * 1.05)) {
      ellipse(ax + 3, ay + 1, aw - 6, ah * 1.05, M.s);
    }
  }
  for (let i = 0; i <= n; i++) {
    const px = Math.round(x + i * w / n - 2);
    rect(px, y + deckH, 5, h - deckH, M.outline);
    rect(px + 1, y + deckH, 3, h - deckH, M.c);
    if (litL) rect(px + 1, y + deckH, 1, h - deckH, M.d);
  }
  after(T, p, M, snap, litL);
}

function stone_statue(T, p, M, litL, sc, snap) {
  const { rect, poly, ellipse } = T;
  const { x, y, w, h } = p, { far } = sc;
  // two-step plinth
  const pedH = Math.max(6, Math.round(h * 0.18));
  box(T, x + w * 0.08, y + h - pedH * 0.45, w * 0.84, pedH * 0.45, M.c, M.d, M.s, M.outline, litL);
  box(T, x + w * 0.16, y + h - pedH, w * 0.68, pedH * 0.6, M.c, M.d, M.s, M.outline, litL);
  const cx = x + w / 2;
  const footY = y + h - pedH;
  const hipY = footY - h * 0.26;
  const shY = hipY - h * 0.28;
  const headH = Math.max(5, h * 0.14);
  // legs: weight on the near leg, the other slightly relaxed
  const lw = Math.max(2, Math.round(w * 0.13));
  box(T, cx - w * 0.16 - lw / 2, hipY, lw, footY - hipY, M.c, M.d, M.s, M.outline, litL);
  box(T, cx + w * 0.12, hipY + 2, Math.max(2, lw - 1), footY - hipY - 2, M.s, M.c, M.s, M.outline, litL);
  // hips / torso / shoulders
  box(T, cx - w * 0.18, hipY - 3, w * 0.36, 5, M.c, M.d, M.s, M.outline, litL);
  const tw = w * 0.34;
  box(T, cx - tw / 2, shY, tw, hipY - shY, M.c, M.d, M.s, M.outline, litL);
  // simple stone drape over one shoulder (decorative, no face or costume)
  if (!far) {
    poly([[cx - tw / 2, shY + 2], [cx - tw / 2 - w * 0.08, hipY + 4], [cx - tw / 2 + 2, hipY], [cx - tw / 2 + 3, shY + 8]], litL ? M.d : M.c, M.outline);
  }
  // arms: one hanging, one slightly extended with a plain stone tablet
  poly([[cx - tw / 2, shY + 3], [cx - tw / 2 - w * 0.18, shY + h * 0.22], [cx - tw / 2 - w * 0.1, shY + h * 0.24], [cx - tw / 2 + 1, shY + h * 0.12]], M.c, M.outline);
  poly([[cx + tw / 2, shY + 3], [cx + tw / 2 + w * 0.2, shY + h * 0.14], [cx + tw / 2 + w * 0.18, shY + h * 0.2], [cx + tw / 2, shY + h * 0.1]], M.s, M.outline);
  if (!far) {
    rect(cx + tw / 2 + w * 0.14, shY + h * 0.12, Math.max(3, w * 0.1), Math.max(4, h * 0.08), M.c);
    rect(cx + tw / 2 + w * 0.14, shY + h * 0.12, Math.max(3, w * 0.1), 1, M.d);
  }
  // neck + head (blank stone, maybe a wedge cap)
  rect(cx - 1, shY - 3, 3, 4, M.c);
  const hw = Math.max(4, w * 0.26);
  ellipse(cx - hw / 2, shY - 3 - headH, hw, headH, M.outline);
  ellipse(cx - hw / 2 + 1, shY - 2 - headH, hw - 2, headH - 2, litL ? M.d : M.c);
  if (!far) poly([[cx - hw * 0.35, shY - 3 - headH + 2], [cx, shY - 5 - headH], [cx + hw * 0.35, shY - 3 - headH + 2]], M.s, M.outline);
  after(T, p, M, snap, litL);
}

function plaza_fountain(T, p, M, litL, sc, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = p, { rich, far } = sc;
  const basinH = Math.max(6, Math.round(h * 0.32));
  ellipse(x, y + h - basinH, w, basinH, M.outline);
  ellipse(x + 1, y + h - basinH + 1, w - 2, basinH - 2, M.c);
  ellipse(x + 3, y + h - basinH + 3, w - 6, basinH - 6, M.water);
  clusters(T, x + 6, y + h - basinH + 4, w - 12, basinH - 8, M.waterHi, 8, 'rip' + x);
  const pw = Math.max(4, Math.round(w * 0.16)), px = Math.round(x + w / 2 - pw / 2);
  const ph = Math.round(h * 0.36), py = y + h - basinH - ph + Math.round(basinH * 0.35);
  box(T, px, py, pw, ph, M.c, M.d, M.s, M.outline, litL);
  const uw = Math.round(w * 0.42), uy = py - 4;
  ellipse(x + w / 2 - uw / 2, uy, uw, 7, M.outline);
  ellipse(x + w / 2 - uw / 2 + 1, uy + 1, uw - 2, 5, M.water);
  if (!far) {
    const cx = Math.round(x + w / 2);
    rect(cx, y + 2, 2, uy - (y + 2), M.waterHi);
    rect(cx - 4, y + 6, 2, uy - (y + 6), M.water);
    rect(cx + 4, y + 6, 2, uy - (y + 6), M.water);
    // splash dots
    clusters(T, cx - 6, y + 1, 14, 6, M.light, 5, 'jet' + x);
  }
  after(T, p, M, snap, litL);
}

function water_well(T, p, M, litL, sc, snap) {
  const { rect, ellipse, line, poly } = T;
  const { x, y, w, h } = p, { rich, far } = sc;
  const rimY = y + h * 0.58;
  ellipse(x, rimY, w, h * 0.42, M.outline);
  ellipse(x + 1, rimY + 1, w - 2, h * 0.42 - 2, M.c);
  ellipse(x + 4, rimY + 4, w - 8, h * 0.28, M.s);
  ellipse(x + 6, rimY + 6, w - 12, h * 0.2, M.water);
  clusters(T, x + 7, rimY + 6, w - 14, 5, M.waterHi, 4, 'ww' + x);
  // stone wall of the shaft under the rim
  box(T, x + 2, rimY + h * 0.16, w - 4, y + h - (rimY + h * 0.16), M.c, M.d, M.s, M.outline, litL);
  // posts and a compact roof just above the rim
  const pw = 2;
  const roofY = y + 1;
  const roofH = Math.max(5, Math.round(h * 0.22));
  rect(x + 3, roofY + roofH, pw, rimY - (roofY + roofH) + 2, M.woodSh);
  rect(x + w - 5, roofY + roofH, pw, rimY - (roofY + roofH) + 2, M.woodSh);
  const peak = x + w / 2;
  poly([[x, roofY + roofH], [peak, roofY], [x + w, roofY + roofH]], M.roof, M.outline);
  if (litL) poly([[x, roofY + roofH], [peak, roofY], [peak, roofY + roofH]], M.roofHi);
  else poly([[peak, roofY], [x + w, roofY + roofH], [peak, roofY + roofH]], M.roofHi);
  if (!far) {
    // crank + bucket
    line(x + 4, roofY + roofH + 3, x + w - 5, roofY + roofH + 3, M.metal);
    rect(x + w - 3, roofY + roofH + 1, 4, 4, M.metal);
    rect(peak - 2, rimY - 6, 4, 5, M.woodSh);
  }
  after(T, p, M, snap, litL);
}

function dome_building(T, p, M, litL, sc, snap) {
  const { ellipse, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  const drumH = Math.max(10, Math.round(h * 0.48));
  const drumY = y + h - drumH;
  const drumW = Math.round(w * 0.86);
  const drumX = Math.round(x + (w - drumW) / 2);
  const domeH = Math.round(Math.min(h - drumH + 4, w * 0.48));
  const domeY = drumY - domeH + 2;
  ellipse(x, domeY, w, domeH * 2, M.outline);
  ellipse(x + 1, domeY + 1, w - 2, domeH * 2 - 2, M.c);
  if (litL) ellipse(x + 2, domeY + 2, w * 0.42, domeH * 1.4, M.d);
  else ellipse(x + w * 0.52, domeY + 2, w * 0.42, domeH * 1.4, M.d);
  box(T, drumX, drumY, drumW, drumH, M.c, M.d, M.s, M.outline, litL);
  // cornice
  T.rect(drumX - 2, drumY - 2, drumW + 4, 3, M.outline);
  T.rect(drumX - 1, drumY - 1, drumW + 2, 1, M.d);
  if (!far) {
    const cx = x + w / 2;
    line(cx, domeY + 2, cx, drumY, M.s);
    line(x + w * 0.28, domeY + domeH * 0.45, cx, domeY + 2, M.s);
    line(x + w * 0.72, domeY + domeH * 0.45, cx, domeY + 2, M.s);
    const nw = Math.max(4, Math.round(drumW * 0.12)), nh = Math.max(5, Math.round(drumH * 0.4));
    for (let i = 0; i < 3; i++) windowAt(T, drumX + drumW * 0.14 + i * drumW * 0.26, drumY + 4, nw, nh, M.outline, M.glass, M.c, true);
  }
  T.rect(x + w / 2 - 1, domeY - 3, 2, 5, M.accent);
  T.rect(x + w / 2 - 2, domeY - 5, 4, 3, M.d);
  after(T, p, M, snap, litL);
}

function spire(T, p, M, litL, sc, snap) {
  const { rect, poly, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  const baseH = Math.max(6, Math.round(h * 0.16));
  box(T, x + w * 0.12, y + h - baseH, w * 0.76, baseH, M.c, M.d, M.s, M.outline, litL);
  const cx = x + w / 2;
  // setback stages so it isn't a single cone on a box
  const stages = [
    [0.62, 0.22],
    [0.44, 0.22],
    [0.28, 0.2]
  ];
  let yy = y + h - baseH;
  for (let i = 0; i < stages.length; i++) {
    const [wr, hr] = stages[i];
    const ww = Math.max(4, w * wr), hh = Math.max(5, h * hr);
    const xx = cx - ww / 2;
    box(T, xx, yy - hh, ww, hh, M.c, M.d, M.s, M.outline, litL);
    if (!far) windowAt(T, cx - 2, yy - hh + 3, 4, Math.max(4, hh * 0.4), M.outline, M.glass, M.c, false);
    // string course
    rect(xx - 1, yy - 2, ww + 2, 2, M.s);
    yy -= hh;
  }
  const needleH = yy - y;
  poly([[cx - w * 0.12, yy], [cx, y], [cx + w * 0.12, yy]], M.c, M.outline);
  if (litL) poly([[cx - w * 0.12, yy], [cx, y], [cx, yy]], M.d);
  else poly([[cx, y], [cx + w * 0.12, yy], [cx, yy]], M.d);
  line(cx, y, cx, yy, M.outline);
  rect(cx - 1, y - 3, 2, 4, M.accent);
  after(T, p, M, snap, litL);
}

function arch_ruin(T, p, M, litL, sc, snap) {
  const { rect, ellipse, poly } = T;
  const { x, y, w, h } = p, { rich } = sc;
  const pierW = Math.max(6, Math.round(w * 0.2));
  box(T, x, y + h * 0.22, pierW, h * 0.78, M.c, M.d, M.s, M.outline, litL);
  const rh = h * 0.55;
  box(T, x + w - pierW, y + h - rh, pierW, rh, M.c, M.d, M.s, M.outline, litL);
  // masonry arch ring
  ellipse(x, y + 2, w, h * 0.72, M.outline);
  ellipse(x + 1, y + 3, w - 2, h * 0.72 - 2, M.c);
  if (litL) clusters(T, x + 2, y + 4, w * 0.4, h * 0.25, M.d, 6, 'arL' + x);
  // opening shows the background, not a black disc
  if (!punchEllipse(T, snap, x + pierW, y + h * 0.2, w - pierW * 2, h * 0.7)) {
    ellipse(x + pierW, y + h * 0.2, w - pierW * 2, h * 0.7, M.s);
  }
  // broken top-right of the ring
  if (snap) restorePoly(T, snap, (xx, yy) => xx > x + w * 0.58 && yy < y + h * 0.32);
  clusters(T, x + 2, y + 4, w - 4, h * 0.28, M.s, 8, 'ar' + x);
  for (let i = 0; i < 6; i++) {
    const rx = x + w * 0.35 + (T.hash('r' + i + x) % Math.max(1, w * 0.55));
    const rw = 5 + (T.hash('rw' + i) % 6), rh2 = 3 + (i % 4);
    poly([[rx, y + h], [rx + rw * 0.4, y + h - rh2], [rx + rw, y + h]], i % 2 ? M.c : M.s, M.outline);
  }
  after(T, p, M, snap, litL);
}

function market_stall(T, p, M, litL, sc, snap) {
  const { rect, poly, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  const roofH = Math.max(7, Math.round(h * 0.42));
  poly([[x - 3, y + roofH], [x + w * 0.5, y], [x + w + 3, y + roofH]], M.cloth, M.outline);
  if (litL) poly([[x - 3, y + roofH], [x + w * 0.5, y], [x + w * 0.5, y + roofH]], M.d);
  // filled stripe wedges
  const stripes = 5;
  for (let i = 0; i < stripes; i++) {
    if (i % 2) continue;
    const xa = x - 3 + i * (w + 6) / stripes;
    const xb = x - 3 + (i + 1) * (w + 6) / stripes;
    poly([[xa, y + roofH], [x + w * 0.5, y + 1], [xb, y + roofH]], i % 4 === 0 ? M.d : M.accent);
  }
  rect(x + 2, y + roofH, 2, h - roofH, M.woodSh);
  rect(x + w - 4, y + roofH, 2, h - roofH, M.woodSh);
  rect(x, y + h - 7, w, 7, M.outline);
  rect(x + 1, y + h - 6, w - 2, 5, M.wood);
  rect(x + 1, y + h - 6, w - 2, 1, M.woodHi);
  if (!far) {
    ellipseSafe(T, x + 3, y + h - 14, 8, 6, M.thatch, M.outline);
    rect(x + 13, y + h - 13, 7, 6, M.cloth);
    rect(x + w - 16, y + h - 12, 7, 5, M.woodSh);
    rect(x + w - 16, y + h - 12, 7, 1, M.accent);
  }
  after(T, p, M, snap, litL);
}

function tent_pavilion(T, p, M, litL, sc, snap) {
  const { rect, poly, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  const cx = x + w / 2;
  // slightly bellied tent, not a bare triangle
  poly([[x, y + h], [x + w * 0.08, y + h * 0.45], [cx, y], [x + w * 0.92, y + h * 0.45], [x + w, y + h]], M.cloth, M.outline);
  if (litL) poly([[x, y + h], [x + w * 0.08, y + h * 0.45], [cx, y], [cx, y + h]], M.d);
  else poly([[cx, y], [x + w * 0.92, y + h * 0.45], [x + w, y + h], [cx, y + h]], M.clothSh);
  line(cx, y, cx, y + h, M.outline);
  // peak knob
  rect(cx - 1, y - 2, 3, 3, M.woodSh);
  if (!far) {
    line(x + w * 0.22, y + h * 0.55, cx, y, M.clothSh);
    line(x + w * 0.78, y + h * 0.55, cx, y, M.clothSh);
    // entrance flap
    poly([[cx - 5, y + h], [cx, y + h * 0.42], [cx + 5, y + h]], M.clothSh, M.outline);
  }
  // guy ropes
  line(x, y + h * 0.5, x - 4, y + h + 1, M.woodSh);
  line(x + w, y + h * 0.5, x + w + 4, y + h + 1, M.woodSh);
  after(T, p, M, snap, litL);
}

function ellipseSafe(T, x, y, w, h, fill, out) {
  T.ellipse(x, y, w, h, out);
  if (w > 2 && h > 2) T.ellipse(x + 1, y + 1, w - 2, h - 2, fill);
}


function ship(T, p, M, litL, sc, snap) {
  const { rect, poly, line, ellipse } = T;
  const { x, y, w, h } = p, { rich, far } = sc;
  const wreck = p.kind === 'shipwreck';
  const keel = y + h - 1;
  const gunwale = y + h * (wreck ? 0.52 : 0.48);
  const prowX = x + 1;
  const sternX = x + w - 1;
  const midX = x + w * (wreck ? 0.46 : 0.5);
  // hull: pointed prow, slightly raised sterncastle
  const sternTop = gunwale - h * 0.12;
  poly([
    [prowX, gunwale + h * 0.08],
    [x + w * 0.16, gunwale],
    [x + w * 0.72, gunwale],
    [x + w * 0.86, sternTop],
    [sternX, gunwale + h * 0.04],
    [x + w * 0.88, keel],
    [x + w * 0.18, keel]
  ], M.wood, M.outline);
  // lit hull face under the gunwale
  poly([
    [x + w * 0.16, gunwale],
    [x + w * 0.72, gunwale],
    [x + w * 0.7, gunwale + h * 0.16],
    [x + w * 0.2, gunwale + h * 0.16]
  ], litL ? M.woodHi : M.woodSh);
  // plank clusters
  clusters(T, x + w * 0.18, gunwale + 2, w * 0.6, h * 0.28, M.woodSh, rich ? 12 : 6, 'hk' + x);
  // gunwale rail
  rect(x + w * 0.16, gunwale - 1, w * 0.58, 2, M.outline);
  rect(x + w * 0.16, gunwale, w * 0.58, 1, M.woodHi);
  if (wreck) {
    const hx = x + w * 0.4, hy = gunwale + h * 0.1, hw = w * 0.2, hh = h * 0.22;
    if (!punchEllipse(T, snap, hx, hy, hw, hh)) {
      ellipse(hx, hy, hw, hh, M.outline);
      ellipse(hx + 1, hy + 1, hw - 2, hh - 2, M.water);
    }
  }
  // mast
  const mx = Math.round(x + w * (wreck ? 0.4 : 0.46));
  const mastTop = y + (wreck ? h * 0.18 : 1);
  rect(mx, mastTop, 2, gunwale - mastTop, M.outline);
  rect(mx, mastTop, 1, gunwale - mastTop, M.wood);
  if (wreck) {
    // snapped mast + torn sail
    line(mx, mastTop, mx + w * 0.18, mastTop - h * 0.12, M.woodSh);
    poly([[mx + 1, y + h * 0.28], [mx + w * 0.28, y + h * 0.34], [mx + w * 0.12, y + h * 0.46], [mx + 1, y + h * 0.4]], M.clothSh, M.outline);
  } else if (!far) {
    // yard and sail
    const yardY = y + h * 0.1;
    line(mx - w * 0.28, yardY + 1, mx + w * 0.3, yardY, M.woodSh);
    poly([[mx + 2, yardY], [mx + w * 0.3, yardY + 1], [mx + w * 0.24, gunwale - 2], [mx + 2, gunwale - 2]], M.cloth, M.outline);
    if (litL) poly([[mx + 2, yardY], [mx + w * 0.12, yardY], [mx + w * 0.1, gunwale - 2], [mx + 2, gunwale - 2]], M.d);
    // rigging (few deliberate lines)
    line(mx, mastTop, mx + w * 0.3, yardY, M.outline);
    line(mx, mastTop, mx - w * 0.24, yardY + 2, M.outline);
    line(mx, gunwale, mx + w * 0.24, gunwale - 2, M.outline);
  }
  after(T, p, M, snap, litL);
}

function shipwreck(T, p, M, litL, sc, snap) { ship(T, p, M, litL, sc, snap); }

function pine(T, p, M, litL, sc, snap) {
  const { rect, poly } = T;
  const { x, y, w, h } = p, { rich } = sc;
  const cx = x + w / 2;
  const tw = Math.max(2, Math.round(w * 0.14));
  rect(cx - tw / 2 - 1, y + h * 0.62, tw + 2, h * 0.38, M.outline);
  rect(cx - tw / 2, y + h * 0.62, tw, h * 0.38, M.wood);
  if (litL) rect(cx - tw / 2, y + h * 0.62, Math.max(1, tw * 0.4), h * 0.38, M.woodHi);
  clusters(T, cx - tw / 2, y + h * 0.64, tw, h * 0.34, M.woodSh, 4, 'bark' + x);
  const layersN = rich ? 5 : 4;
  for (let i = 0; i < layersN; i++) {
    const t = i / layersN;
    const ww = w * (0.98 - t * 0.5);
    const hh = h * 0.2;
    const yy = y + t * h * 0.52;
    const jitter = ((T.hash('pj' + i + x) % 5) - 2);
    poly([[cx - ww / 2 + jitter, yy + hh], [cx, yy], [cx + ww / 2 + jitter, yy + hh]], i % 2 ? M.foliage : M.moss, M.outline);
    if (litL) poly([[cx - ww / 2 + jitter, yy + hh], [cx, yy], [cx, yy + hh]], M.d);
    else poly([[cx, yy], [cx + ww / 2 + jitter, yy + hh], [cx, yy + hh]], M.s);
  }
  after(T, p, M, snap, litL);
}

function broadleaf(T, p, M, litL, sc, snap) {
  const { rect, ellipse, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  const cx = x + w / 2;
  const tw = Math.max(3, Math.round(w * 0.16));
  const trunkTop = y + h * 0.45;
  rect(cx - tw / 2 - 1, trunkTop, tw + 2, y + h - trunkTop, M.outline);
  rect(cx - tw / 2, trunkTop, tw, y + h - trunkTop, M.wood);
  if (litL) rect(cx - tw / 2, trunkTop, Math.max(1, tw * 0.4), y + h - trunkTop, M.woodHi);
  clusters(T, cx - tw / 2, trunkTop, tw, y + h - trunkTop, M.woodSh, 5, 'brk' + x);
  if (!far) {
    line(cx, trunkTop + 4, cx - w * 0.28, y + h * 0.28, M.woodSh);
    line(cx, trunkTop, cx + w * 0.3, y + h * 0.22, M.woodSh);
    line(cx, y + h * 0.38, cx + w * 0.18, y + h * 0.3, M.wood);
  }
  // main crown, then overlapping clumps so it isn't three floating discs
  ellipse(x + w * 0.08, y + 1, w * 0.84, h * 0.5, M.outline);
  ellipse(x + w * 0.08 + 1, y + 2, w * 0.84 - 2, h * 0.5 - 2, M.foliage);
  if (litL) ellipse(x + w * 0.12, y + 3, w * 0.36, h * 0.28, M.d);
  const clumps = [
    [x - 1, y + h * 0.12, w * 0.42, h * 0.28],
    [x + w * 0.58, y + h * 0.1, w * 0.42, h * 0.3],
    [x + w * 0.22, y - 1, w * 0.52, h * 0.26],
    [x + w * 0.12, y + h * 0.28, w * 0.36, h * 0.22],
    [x + w * 0.5, y + h * 0.26, w * 0.38, h * 0.22]
  ];
  for (let i = 0; i < clumps.length; i++) {
    const [cx2, cy2, cw, ch] = clumps[i];
    ellipse(cx2, cy2, cw, ch, i % 2 ? M.moss : M.foliage);
    if (litL && i < 3) ellipse(cx2 + 1, cy2 + 1, cw * 0.4, ch * 0.45, M.d);
  }
  after(T, p, M, snap, litL);
}

function dead_tree(T, p, M, litL, sc, snap) {
  const { rect, line, poly } = T;
  const { x, y, w, h } = p, { far } = sc;
  const cx = x + w * 0.52;
  const tw = Math.max(4, Math.round(w * 0.2));
  // split trunk
  poly([[cx - tw, y + h], [cx - tw * 0.2, y + h * 0.38], [cx + tw * 0.35, y + h * 0.38], [cx + tw * 0.85, y + h]], M.wood, M.outline);
  if (litL) poly([[cx - tw, y + h], [cx - tw * 0.2, y + h * 0.38], [cx, y + h]], M.woodHi);
  else poly([[cx + tw * 0.35, y + h * 0.38], [cx + tw * 0.85, y + h], [cx, y + h]], M.woodSh);
  // bark crack
  line(cx, y + h * 0.42, cx + 1, y + h - 1, M.s);
  clusters(T, cx - tw, y + h * 0.42, tw * 2, h * 0.55, M.woodSh, 7, 'db' + x);
  // forked bare limbs, 2px thick
  const limbs = [
    [cx, y + h * 0.38, cx - w * 0.42, y + h * 0.08, cx - w * 0.28, y + h * 0.02],
    [cx, y + h * 0.36, cx + w * 0.4, y + h * 0.06, cx + w * 0.48, y + h * 0.16],
    [cx - w * 0.08, y + h * 0.32, cx - w * 0.38, y + h * 0.2, cx - w * 0.34, y + h * 0.12],
    [cx + w * 0.06, y + h * 0.3, cx + w * 0.32, y + h * 0.14, cx + w * 0.22, y + h * 0.08]
  ];
  for (const [x0, y0, x1, y1, x2, y2] of limbs) {
    line(x0, y0, x1, y1, M.outline);
    line(x0, y0, x1, y1, M.wood);
    if (!far) {
      line(x1, y1, x2, y2, M.outline);
      line(x1, y1, x2, y2, M.woodSh);
    }
  }
  // broken stub
  line(cx + 2, y + h * 0.38, cx + w * 0.16, y + h * 0.3, M.woodSh);
  rect(cx + w * 0.14, y + h * 0.28, 3, 3, M.s);
  after(T, p, M, snap, litL);
}

function willow(T, p, M, litL, sc, snap) {
  const { rect, ellipse, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  const cx = x + w / 2;
  const tw = Math.max(3, Math.round(w * 0.13));
  rect(cx - tw / 2 - 1, y + h * 0.4, tw + 2, h * 0.6, M.outline);
  rect(cx - tw / 2, y + h * 0.4, tw, h * 0.6, M.wood);
  if (litL) rect(cx - tw / 2, y + h * 0.4, Math.max(1, tw * 0.4), h * 0.6, M.woodHi);
  // broad crown
  ellipse(x, y, w, h * 0.36, M.outline);
  ellipse(x + 1, y + 1, w - 2, h * 0.36 - 2, M.foliage);
  if (litL) ellipse(x + 2, y + 2, w * 0.4, h * 0.2, M.d);
  ellipse(x + w * 0.06, y + h * 0.08, w * 0.4, h * 0.22, M.moss);
  ellipse(x + w * 0.52, y + h * 0.06, w * 0.42, h * 0.24, M.foliage);
  const n = far ? 8 : 15;
  for (let i = 0; i < n; i++) {
    const xx = x + 1 + i * (w - 2) / Math.max(1, n - 1);
    const drop = y + h * (0.62 + (i % 4) * 0.07);
    const x2 = xx + ((i % 3) - 1) * 5;
    line(xx, y + h * 0.14, x2, drop, M.moss);
    const leaves = far ? 3 : 6;
    for (let k = 0; k < leaves; k++) {
      const t = 0.12 + k * (0.8 / leaves);
      const lx = xx + (x2 - xx) * t - 2, ly = (y + h * 0.14) + (drop - (y + h * 0.14)) * t;
      ellipse(lx, ly, 6, 8, k % 2 ? M.foliage : M.moss);
    }
  }
  after(T, p, M, snap, litL);
}

function palm_tree(T, p, M, litL, sc, snap) {
  const { rect, poly, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  const tw = Math.max(3, Math.round(w * 0.15));
  const lean = litL ? 1 : -1;
  const trunkH = h * 0.68;
  let topX = x + w / 2, topY = y + h - trunkH;
  for (let i = 0; i < trunkH; i++) {
    const t = i / Math.max(1, trunkH);
    const xx = Math.round(x + w / 2 - tw / 2 + Math.sin(t * 1.4) * lean * w * 0.14);
    const yy = Math.round(y + h - trunkH + i);
    rect(xx - 1, yy, tw + 2, 1, M.outline);
    rect(xx, yy, tw, 1, M.wood);
    if (litL) rect(xx, yy, Math.max(1, Math.round(tw * 0.4)), 1, M.woodHi);
    if (i === 0) { topX = xx + tw / 2; topY = yy; }
  }
  if (!far) {
    for (let i = 0; i < 6; i++) {
      const t = 0.12 + i * 0.14;
      const xx = Math.round(x + w / 2 - tw / 2 + Math.sin(t * 1.4) * lean * w * 0.14);
      const yy = Math.round(y + h - trunkH + t * trunkH);
      rect(xx, yy, tw, 1, M.woodSh);
    }
  }
  // real fronds: midrib + paired leaflets, fan + droop
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = -2.95 + i * (3.15 / Math.max(1, n - 1));
    const len = w * (0.46 + (i % 3 === 1 ? 0.1 : 0));
    const x2 = topX + Math.cos(a) * len;
    const y2 = topY + Math.sin(a) * h * 0.32 + h * 0.1;
    line(topX, topY, x2, y2, M.outline);
    line(topX, topY, x2, y2, M.moss);
    const pairs = far ? 4 : 7;
    for (let k = 1; k <= pairs; k++) {
      const t = k / (pairs + 0.35);
      const fx = topX + (x2 - topX) * t, fy2 = topY + (y2 - topY) * t;
      const leaf = (0.7 - Math.abs(t - 0.45)) * len * 0.38;
      const nx = -Math.sin(a) * leaf, ny = Math.cos(a) * leaf * 0.45;
      const tip = 0.12;
      poly([[fx, fy2], [fx + nx, fy2 + ny], [fx + (x2 - topX) * tip, fy2 + (y2 - topY) * tip]], k % 2 ? M.foliage : M.moss, M.outline);
      poly([[fx, fy2], [fx - nx * 0.85, fy2 - ny * 0.7], [fx + (x2 - topX) * tip, fy2 + (y2 - topY) * tip]], M.foliage);
    }
  }
  after(T, p, M, snap, litL);
}

function rock_formation(T, p, M, litL, sc, snap) {
  const { poly, ellipse } = T;
  const { x, y, w, h, count } = p, { rich } = sc;
  const n = Math.max(3, Math.min(count || 4, 5));
  const boulders = [];
  for (let i = 0; i < n; i++) {
    const ww = w * (0.38 + (T.hash('rw' + i + x) % 28) / 100);
    const hh = h * (0.34 + (T.hash('rh' + i + x) % 36) / 100);
    const xx = x + (i * (w - ww) / Math.max(1, n - 1) + (T.hash('rx' + i + x) % 5) - 2);
    const yy = y + h - hh - (i % 3 === 1 ? h * 0.12 : 0);
    boulders.push({ xx, yy, ww, hh, i });
  }
  for (const { xx, yy, ww, hh, i } of boulders) {
    // irregular rounded rock, not a pyramid
    const pts = [
      [xx, yy + hh * 0.55],
      [xx + ww * 0.15, yy + hh * 0.15],
      [xx + ww * 0.5, yy],
      [xx + ww * 0.88, yy + hh * 0.22],
      [xx + ww, yy + hh * 0.6],
      [xx + ww * 0.7, yy + hh],
      [xx + ww * 0.2, yy + hh]
    ];
    poly(pts, i % 2 ? M.c : mixSafe(T, M.c, M.s, 0.25), M.outline);
    if (litL) poly([pts[0], pts[1], pts[2], [xx + ww * 0.5, yy + hh], pts[6]], M.d);
    else poly([pts[2], pts[3], pts[4], [xx + ww * 0.5, yy + hh]], M.d);
  }
  if (rich) clusters(T, x, y + h * 0.3, w, h * 0.7, M.s, 10, 'rk' + x);
  after(T, p, M, snap, litL);
}

function cliff(T, p, M, litL, sc, snap) {
  const { poly, rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  const pts = [
    [x, y + h],
    [x + w * 0.04, y + h * 0.7],
    [x + w * 0.18, y + h * 0.6],
    [x + w * 0.08, y + h * 0.42],
    [x + w * 0.22, y + h * 0.3],
    [x + w * 0.12, y + h * 0.16],
    [x + w * 0.3, y + h * 0.06],
    [x + w * 0.46, y],
    [x + w * 0.6, y + h * 0.07],
    [x + w * 0.72, y + h * 0.02],
    [x + w * 0.84, y + h * 0.14],
    [x + w * 0.94, y + h * 0.1],
    [x + w, y + h * 0.36],
    [x + w * 0.9, y + h * 0.58],
    [x + w * 0.98, y + h]
  ];
  poly(pts, M.c, M.outline);
  if (litL) poly([[x, y + h], [x + w * 0.04, y + h * 0.7], [x + w * 0.12, y + h * 0.16], [x + w * 0.46, y], [x + w * 0.5, y + h]], M.d);
  else poly([[x + w * 0.72, y + h * 0.02], [x + w * 0.94, y + h * 0.1], [x + w, y + h * 0.36], [x + w * 0.98, y + h], [x + w * 0.7, y + h]], M.d);
  // forced shadow edge so pale / frost palettes keep a readable face
  if (litL) poly([[x + w * 0.84, y + h * 0.14], [x + w, y + h * 0.36], [x + w * 0.98, y + h], [x + w * 0.78, y + h]], M.s);
  else poly([[x, y + h], [x + w * 0.04, y + h * 0.7], [x + w * 0.12, y + h * 0.16], [x + w * 0.22, y + h]], M.s);
  if (!far) {
    rect(x + w * 0.18, y + h * 0.34, w * 0.3, 2, M.s);
    rect(x + w * 0.32, y + h * 0.34 - 4, w * 0.18, 4, M.d);
    rect(x + w * 0.22, y + h * 0.56, w * 0.42, 2, M.s);
    rect(x + w * 0.4, y + h * 0.74, w * 0.32, 2, M.s);
    if (paleSnow(M)) {
      rect(x + w * 0.28, y + 1, w * 0.36, 3, M.d);
      rect(x + w * 0.32, y + h * 0.34 - 5, w * 0.18, 2, M.d);
      clusters(T, x + w * 0.2, y, w * 0.55, 8, M.d, 8, 'snowc' + x);
    }
    clusters(T, x + w * 0.1, y + h * 0.12, w * 0.8, h * 0.8, M.s, 16, 'cf' + x);
  }
  after(T, p, M, snap, litL);
}

function water_fall(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h } = p, { rich, far } = sc;
  cliff(T, Object.assign({}, p, { kind: 'cliff', parts: { condition: 'intact' } }), M, litL, sc, null);
  const wx = x + w * 0.3, ww = w * 0.4;
  // solid-ish water ribbon so it survives Bayer
  rect(wx, y + 2, ww, h - 8, M.water);
  rect(wx + 2, y + 2, Math.max(2, ww * 0.35), h - 8, M.waterHi);
  if (!far) {
    clusters(T, wx, y + 2, ww, h - 8, M.light, rich ? 16 : 8, 'wf' + x);
    // slightly wavy edge
    for (let i = 0; i < 6; i++) {
      const yy = y + 4 + i * (h - 12) / 6;
      rect(wx - 1, yy, 2, 3, M.waterHi);
      rect(wx + ww - 1, yy + 2, 2, 3, M.water);
    }
  }
  clusters(T, wx - 3, y, ww + 6, 6, M.light, 10, 'foamT' + x);
  clusters(T, wx - 5, y + h - 7, ww + 10, 7, M.light, 12, 'foamB' + x);
  after(T, p, M, snap, litL);
}

function mushroom(T, p, M, litL, sc, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = p, { rich } = sc;
  const cx = x + w / 2;
  const stemW = Math.max(3, w * 0.22), stemH = h * 0.45;
  rect(cx - stemW / 2 - 1, y + h - stemH, stemW + 2, stemH, M.outline);
  rect(cx - stemW / 2, y + h - stemH, stemW, stemH, M.thatchHi);
  if (litL) rect(cx - stemW / 2, y + h - stemH, Math.max(1, stemW * 0.4), stemH, M.d);
  const capH = h * 0.48, capY = y + h - stemH - capH * 0.55;
  ellipse(x, capY, w, capH, M.outline);
  ellipse(x + 1, capY + 1, w - 2, capH - 2, M.roof);
  if (litL) ellipse(x + 2, capY + 2, w * 0.4, capH * 0.5, M.roofHi);
  if (rich) {
    clusters(T, x + 4, capY + 3, w - 8, capH * 0.45, M.thatchHi, 6, 'spot' + x);
    // gill hint
    for (let i = 0; i < 4; i++) rect(x + w * 0.25 + i * w * 0.12, capY + capH * 0.7, 1, 2, M.s);
  }
  after(T, p, M, snap, litL);
}

function crystal_cluster(T, p, M, litL, sc, snap) {
  const { poly, line } = T;
  const { x, y, w, h, count } = p, { rich } = sc;
  const n = Math.max(3, Math.min(count || 5, 7));
  for (let i = 0; i < n; i++) {
    const ww = w / n * (0.7 + (T.hash('cw' + i + x) % 40) / 100);
    const hh = h * (0.45 + (T.hash('ch' + i + x) % 55) / 100);
    const xx = x + i * (w - ww) / Math.max(1, n - 1);
    const yy = y + h - hh;
    const peak = xx + ww * 0.45;
    const glass = i % 2 ? M.glass : mixSafe(T, M.accent, M.glass, 0.4);
    const sh = M.s;
    poly([[xx, y + h], [xx + ww * 0.15, yy + hh * 0.2], [peak, yy], [xx + ww * 0.85, yy + hh * 0.18], [xx + ww, y + h]], glass, M.outline);
    if (litL) poly([[xx, y + h], [xx + ww * 0.15, yy + hh * 0.2], [peak, yy], [peak, y + h]], M.d);
    else poly([[peak, yy], [xx + ww * 0.85, yy + hh * 0.18], [xx + ww, y + h], [peak, y + h]], sh);
    if (rich) line(peak, yy, peak, y + h, M.light);
  }
  after(T, p, M, snap, litL);
}

function mixSafe(T, a, b, t) { return T.mixHex(a, b, t); }

function royal_throne(T, p, M, litL, sc, snap) {
  const { rect, poly } = T;
  const { x, y, w, h } = p, { rich } = sc;
  // dais
  rect(x + w * 0.05, y + h - 5, w * 0.9, 5, M.outline);
  rect(x + w * 0.05 + 1, y + h - 4, w * 0.9 - 2, 3, M.c);
  const seatY = y + h * 0.58, seatH = Math.max(5, h * 0.18);
  const seatW = w * 0.7, seatX = x + w * 0.15;
  // legs / posts
  box(T, x + w * 0.15, seatY, Math.max(3, w * 0.1), y + h - 5 - seatY, M.metal, M.metalHi, M.metalSh, M.outline, litL);
  box(T, x + w * 0.75, seatY, Math.max(3, w * 0.1), y + h - 5 - seatY, M.metal, M.metalHi, M.metalSh, M.outline, litL);
  // seat
  box(T, seatX, seatY, seatW, seatH, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  rect(seatX + 2, seatY + 1, seatW - 4, Math.max(2, seatH * 0.45), M.cloth);
  // arms
  box(T, seatX - 2, seatY - h * 0.12, Math.max(3, w * 0.1), h * 0.22, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  box(T, seatX + seatW - w * 0.1 + 2, seatY - h * 0.12, Math.max(3, w * 0.1), h * 0.22, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  // back
  const backH = h * 0.55, backY = y + h * 0.05;
  box(T, x + w * 0.22, backY, w * 0.56, backH, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  if (rich) {
    rect(x + w * 0.3, backY + 4, w * 0.4, backH * 0.45, M.cloth);
    // finials
    poly([[x + w * 0.24, backY], [x + w * 0.28, backY - 5], [x + w * 0.32, backY]], M.metal, M.outline);
    poly([[x + w * 0.68, backY], [x + w * 0.72, backY - 5], [x + w * 0.76, backY]], M.metal, M.outline);
  }
  after(T, p, M, snap, litL);
}

function stone_altar(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h } = p, { rich } = sc;
  const baseH = Math.max(4, h * 0.2);
  box(T, x + w * 0.1, y + h - baseH, w * 0.8, baseH, M.c, M.d, M.s, M.outline, litL);
  const topH = Math.max(6, h * 0.35);
  box(T, x, y + h - baseH - topH, w, topH, M.c, M.d, M.s, M.outline, litL);
  // cloth runner
  rect(x + w * 0.3, y + h - baseH - topH, w * 0.4, topH + 2, M.cloth);
  rect(x + w * 0.3, y + h - baseH - topH, w * 0.4, 1, M.d);
  if (rich) {
    // candlesticks
    const cy = y + h - baseH - topH;
    rect(x + w * 0.18, cy - 8, 2, 8, M.metal);
    rect(x + w * 0.8, cy - 8, 2, 8, M.metal);
    flames(T, x + w * 0.15, cy - 14, 8, 6, M, 2);
    flames(T, x + w * 0.77, cy - 14, 8, 6, M, 2);
  }
  after(T, p, M, snap, litL);
}

function book_case(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h, count } = p, { rich } = sc;
  box(T, x, y, w, h, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  const shelves = Math.max(3, Math.min(count || 4, 6));
  const sh = (h - 4) / shelves;
  const palette = [M.roof, M.cloth, M.accent, M.water, M.s, M.d, M.woodSh];
  for (let i = 0; i < shelves; i++) {
    const sy = y + 2 + i * sh;
    rect(x + 1, sy + sh - 2, w - 2, 2, M.woodSh);
    if (rich || !sc.far) {
      let xx = x + 2;
      let b = 0;
      while (xx < x + w - 4) {
        const bw = 2 + (T.hash('bk' + i + b + x) % 3);
        const bh = Math.max(4, sh - 4 - (T.hash('bh' + i + b) % 3));
        const col = palette[(T.hash('bc' + i + b + x)) % palette.length];
        if (xx + bw < x + w - 2) {
          rect(xx, sy + sh - 2 - bh, bw, bh, col);
          if (bw > 2) rect(xx, sy + sh - 2 - bh, 1, bh, M.outline);
        }
        xx += bw + 1;
        b++;
        if (b > 20) break;
      }
    }
  }
  after(T, p, M, snap, litL);
}

function workbench(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  const topY = y + Math.round(h * 0.28);
  const topH = Math.max(4, Math.round(h * 0.22));
  rect(x, topY, w, topH, M.outline);
  rect(x + 1, topY + 1, w - 2, topH - 2, M.wood);
  rect(x + 1, topY + 1, w - 2, 1, M.woodHi);
  clusters(T, x + 2, topY + 1, w - 4, topH - 2, M.woodSh, 8, 'gr' + x);
  const lw = Math.max(3, Math.round(w * 0.08));
  box(T, x + 3, topY + topH, lw, y + h - (topY + topH), M.wood, M.woodHi, M.woodSh, M.outline, litL);
  box(T, x + w - 3 - lw, topY + topH, lw, y + h - (topY + topH), M.wood, M.woodHi, M.woodSh, M.outline, litL);
  // stretcher
  rect(x + 3, y + h - 5, w - 6, 2, M.woodSh);
  if (!far) {
    // vise
    rect(x + w * 0.72, topY - 4, 8, 4, M.metal);
    rect(x + w * 0.72 + 6, topY - 8, 3, 8, M.metalSh);
    rect(x + w * 0.72 + 1, topY - 2, 5, 2, M.metalHi);
    // hammer
    rect(x + w * 0.18, topY - 2, 10, 2, M.woodSh);
    rect(x + w * 0.18 + 8, topY - 5, 5, 5, M.metal);
  }
  after(T, p, M, snap, litL);
}

function candelabra(T, p, M, litL, sc, snap) {
  const { rect, ellipse, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  const cx = Math.round(x + w / 2);
  const baseY = y + h;
  ellipse(cx - w * 0.28, baseY - 5, w * 0.56, 5, M.outline);
  ellipse(cx - w * 0.28 + 1, baseY - 4, w * 0.56 - 2, 3, M.metal);
  rect(cx - 1, y + h * 0.3, 3, h * 0.68, M.outline);
  rect(cx, y + h * 0.3, 1, h * 0.68, M.metalHi);
  const arms = far ? 3 : 5;
  for (let i = 0; i < arms; i++) {
    const t = arms === 1 ? 0.5 : i / (arms - 1);
    const ax = Math.round(x + w * (0.1 + t * 0.8));
    const ay = Math.round(y + h * (0.3 + Math.abs(t - 0.5) * 0.12));
    // curved-ish arm as 2 segments, 2px
    const midX = Math.round((cx + ax) / 2), midY = Math.round(y + h * 0.42);
    line(cx, y + h * 0.48, midX, midY, M.metal);
    line(midX, midY, ax, ay, M.metal);
    rect(ax - 1, ay - 2, 3, 3, M.metalSh);
    rect(ax - 1, ay - 8, 2, 6, M.thatchHi);
    flames(T, ax - 3, ay - 15, 7, 7, M, 1);
  }
  after(T, p, M, snap, litL);
}

function brazier_stand(T, p, M, litL, sc, snap) {
  const { rect, poly, ellipse, line } = T;
  const { x, y, w, h } = p, { rich } = sc;
  const cx = x + w / 2;
  // tripod legs
  poly([[cx, y + h * 0.45], [x + 2, y + h], [cx - 2, y + h * 0.5]], M.metalSh, M.outline);
  poly([[cx, y + h * 0.45], [x + w - 2, y + h], [cx + 2, y + h * 0.5]], M.metal, M.outline);
  if (rich) line(cx, y + h * 0.5, cx, y + h, M.metalSh);
  const bw = w * 0.7, by = y + h * 0.32;
  ellipse(cx - bw / 2, by, bw, h * 0.28, M.outline);
  ellipse(cx - bw / 2 + 1, by + 1, bw - 2, h * 0.28 - 2, M.metal);
  flames(T, cx - w * 0.28, y, w * 0.56, h * 0.4, M, rich ? 5 : 3);
  after(T, p, M, snap, litL);
}

function hanging_banner(T, p, M, litL, sc, snap) {
  const { rect, poly, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  // pole on the left, cloth hanging from a short crossbar
  rect(x, y, 2, h, M.outline);
  rect(x, y, 1, h, M.wood);
  rect(x, y, w - 1, 3, M.outline);
  rect(x + 1, y + 1, w - 3, 1, M.woodHi);
  const bx = x + 3, bw = w - 5, by = y + 3, bh = h - 8;
  const folds = 3;
  for (let i = 0; i < folds; i++) {
    const x0 = bx + i * bw / folds;
    const x1 = bx + (i + 1) * bw / folds;
    const col = i % 2 ? M.cloth : M.clothSh;
    poly([[x0, by], [x1, by], [x1 - 1, by + bh], [x0 + 1, by + bh]], col, i === 0 || i === folds - 1 ? M.outline : col);
  }
  // swallowtail
  poly([[bx, by + bh], [bx + bw * 0.5, by + bh + 6], [bx + bw, by + bh]], M.cloth, M.outline);
  if (!far) {
    // simple motif
    rect(bx + bw * 0.32, by + bh * 0.22, Math.max(3, bw * 0.36), 3, M.accent);
    rect(bx + bw * 0.42, by + bh * 0.22, Math.max(2, bw * 0.16), Math.max(6, bh * 0.22), M.accent);
  }
  after(T, p, M, snap, litL);
}

function machine_console(T, p, M, litL, sc, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = p, { far } = sc;
  box(T, x, y + h * 0.22, w, h * 0.78, M.metal, M.metalHi, M.metalSh, M.outline, litL);
  box(T, x + 2, y, w - 4, h * 0.38, M.metalSh, M.metalHi, M.s, M.outline, litL);
  // screens always at mid+
  if (!far) {
    rect(x + 4, y + 3, Math.max(6, w * 0.42), Math.max(5, h * 0.2), M.outline);
    rect(x + 5, y + 4, Math.max(4, w * 0.42 - 2), Math.max(3, h * 0.2 - 2), M.glass);
    rect(x + w * 0.52, y + 3, Math.max(5, w * 0.3), Math.max(4, h * 0.12), M.outline);
    rect(x + w * 0.52 + 1, y + 4, Math.max(3, w * 0.3 - 2), Math.max(2, h * 0.12 - 2), mixSafe(T, M.accent, M.glass, 0.4));
    for (let i = 0; i < 4; i++) {
      ellipse(x + 5 + i * 6, y + h * 0.48, 4, 4, M.outline);
      ellipse(x + 6 + i * 6, y + h * 0.48 + 1, 2, 2, i % 2 ? M.flame : M.metalHi);
    }
    rect(x + w - 6, y + h * 0.16, 4, h * 0.4, M.metalSh);
    ellipse(x + w - 8, y + h * 0.1, 8, 6, M.metal);
  }
  after(T, p, M, snap, litL);
}

function alien_pylon(T, p, M, litL, sc, snap) {
  const { rect, poly, line, ellipse } = T;
  const { x, y, w, h } = p, { far } = sc;
  const cx = x + w / 2;
  poly([[x, y + h], [x + w * 0.2, y + h * 0.78], [x + w * 0.8, y + h * 0.78], [x + w, y + h]], M.metalSh, M.outline);
  const topW = Math.max(4, w * 0.28), botW = w * 0.55;
  const top = y + 4, base = y + h * 0.8;
  poly([[cx - botW / 2, base], [cx - topW / 2, top], [cx + topW / 2, top], [cx + botW / 2, base]], M.metal, M.outline);
  if (litL) poly([[cx - botW / 2, base], [cx - topW / 2, top], [cx, top], [cx, base]], M.metalHi);
  else poly([[cx, top], [cx + topW / 2, top], [cx + botW / 2, base], [cx, base]], M.metalHi);
  line(cx, top, cx, base, M.accent);
  if (!far) {
    line(cx - topW * 0.25, top + 2, cx - botW * 0.22, base, M.light);
    ellipse(cx - w * 0.3, y + h * 0.35, w * 0.6, 6, M.outline);
    ellipse(cx - w * 0.3 + 1, y + h * 0.35 + 1, w * 0.6 - 2, 4, M.accent);
  }
  poly([[cx - topW / 2, top], [cx, y], [cx + topW / 2, top]], M.glass, M.outline);
  poly([[cx, y], [cx + (litL ? -1 : 1) * 2, top], [cx, top]], M.light);
  after(T, p, M, snap, litL);
}

function dish_antenna(T, p, M, litL, sc, snap) {
  const { rect, ellipse, line, poly } = T;
  const { x, y, w, h } = p, { rich } = sc;
  const cx = x + w / 2;
  // tripod
  line(cx, y + h * 0.45, x + 2, y + h, M.metalSh);
  line(cx, y + h * 0.45, x + w - 2, y + h, M.metalSh);
  line(cx, y + h * 0.45, cx, y + h, M.metal);
  const dw = w * 0.95, dh = h * 0.42, dy = y + 2;
  ellipse(x, dy, dw, dh, M.outline);
  ellipse(x + 1, dy + 1, dw - 2, dh - 2, M.metal);
  if (litL) ellipse(x + 2, dy + 2, dw * 0.45, dh * 0.6, M.metalHi);
  else ellipse(x + dw * 0.5, dy + 2, dw * 0.45, dh * 0.6, M.metalHi);
  // inner dish shadow
  ellipse(x + dw * 0.18, dy + dh * 0.2, dw * 0.64, dh * 0.6, M.metalSh);
  // feed horn
  const fx = cx, fy = dy + dh * 0.45;
  line(fx, fy, fx, fy + h * 0.12, M.outline);
  rect(fx - 2, fy - 2, 4, 4, M.accent);
  after(T, p, M, snap, litL);
}

function ringed_planet(T, p, M, litL, sc, snap) {
  const { ellipse, line } = T;
  const { x, y, w, h } = p, { rich } = sc;
  const rw = w, rh = Math.max(6, h * 0.28), ry = y + h * 0.42;
  // ring first (behind), then body, then front ring
  ellipse(x, ry, rw, rh, M.outline);
  ellipse(x + 1, ry + 1, rw - 2, rh - 2, M.metal);
  const d = Math.min(w, h) * 0.72;
  const dx = x + (w - d) / 2, dy = y + (h - d) / 2;
  ellipse(dx, dy, d, d, M.outline);
  ellipse(dx + 1, dy + 1, d - 2, d - 2, M.c);
  // terminator
  if (litL) ellipse(dx + 1, dy + 1, d * 0.45, d - 2, M.d);
  else ellipse(dx + d * 0.5, dy + 1, d * 0.45, d - 2, M.d);
  // shadow side
  if (litL) ellipse(dx + d * 0.55, dy + 2, d * 0.4, d - 4, M.s);
  else ellipse(dx + 2, dy + 2, d * 0.4, d - 4, M.s);
  if (rich) clusters(T, dx + 4, dy + 4, d - 8, d - 8, M.s, 6, 'crat' + x);
  // front ring arc: redraw lower half-ish as highlight
  ellipse(x + 2, ry + 2, rw - 4, rh - 4, M.metalHi);
  // hide mid ring through planet by redrawing body center band
  ellipse(dx + 1, dy + 1, d - 2, d - 2, M.c);
  if (litL) ellipse(dx + 1, dy + 1, d * 0.45, d - 2, M.d);
  else ellipse(dx + d * 0.5, dy + 1, d * 0.45, d - 2, M.d);
  after(T, p, M, snap, litL);
}

const ALIASES = {
  cottage: cottage, hut: hut,
  watchtower: watchtower, keep_tower: watchtower,
  lighthouse: lighthouse, windmill: windmill,
  gate_wall: gate_wall, wall_gate: gate_wall, gatehouse: gate_wall,
  stone_bridge: stone_bridge, stone_statue: stone_statue,
  plaza_fountain: plaza_fountain, fountain_bowl: plaza_fountain,
  water_well: water_well, well_house: water_well,
  dome_building: dome_building, domed_hall: dome_building,
  spire: spire, bell_tower: spire, minaret: spire,
  arch_ruin: arch_ruin, column_ruin: arch_ruin,
  market_stall: market_stall, tent_pavilion: tent_pavilion, canvas_tent: tent_pavilion,
  ship: ship, shipwreck: shipwreck, boat: ship,
  pine: pine, broadleaf: broadleaf, dead_tree: dead_tree, willow: willow, palm_tree: palm_tree,
  rock_formation: rock_formation, boulder: rock_formation, crag: rock_formation,
  cliff: cliff, water_fall: water_fall,
  mushroom: mushroom, crystal_cluster: crystal_cluster, crystal_spire: crystal_cluster,
  royal_throne: royal_throne, stone_altar: stone_altar, book_case: book_case,
  workbench: workbench, banquet_table: workbench,
  candelabra: candelabra, brazier_stand: brazier_stand,
  hanging_banner: hanging_banner, tapestry: hanging_banner, wall_banner: hanging_banner,
  machine_console: machine_console, alien_pylon: alien_pylon,
  dish_antenna: dish_antenna, landing_spire: dish_antenna,
  ringed_planet: ringed_planet
};

function handles(kind) { return !!ALIASES[kind]; }

function paint(kind, T, p, cols) {
  const fn = ALIASES[kind];
  if (!fn) return false;
  const M = mats(cols, T.mixHex);
  M.lighting = cols && cols.lighting;
  if (['cliff', 'rock_formation', 'watchtower', 'keep_tower', 'stone_statue', 'spire', 'dome_building', 'arch_ruin', 'gate_wall'].includes(kind)
      || ['cliff', 'rock_formation', 'watchtower'].includes(fn.name)) {
    boostContrast(M, T.mixHex);
  }
  const aspect = ASPECT[kind] || 0.9;
  const q = Object.assign({}, p, fitBox(p, aspect, CENTER_ANCHOR.has(kind) ? 'center' : 'base'));
  const litL = T.litLeft((q.x + q.w / 2));
  const sc = scaleOf(q);
  const snap = snapshotBBox(T, q.x, q.y - 12, q.w, q.h + 14);
  fn(T, q, M, litL, sc, snap);
  return true;
}

module.exports = { handles, paint, ALIASES, mats, names: Object.keys(ALIASES), ASPECT, fitBox, CENTER_ANCHOR,
  box, gable, clusters, windowAt, doorAt, flames, after, punchEllipse, ellipseSafe, mixSafe, condOf, scaleOf,
  snapshotBBox, restoreRect, restorePoly, lumaHex, boostContrast, preTint, paleSnow, applyCondition };
try {
  const More = require('./scenerySpritesMore');
  if (More && More.ALIASES) Object.assign(ALIASES, More.ALIASES);
  if (More && More.ASPECT) Object.assign(ASPECT, More.ASPECT);
  module.exports.names = Object.keys(ALIASES);
} catch (err) { /* optional extras */ }

