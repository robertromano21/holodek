'use strict';
// Lego-style scenery pieces. Sprite-quality painters with sockets for stacking,
// repeating and front-attaching. Materials, light and condition come from the recipe.

const S = require('./scenerySprites');
const {
  box, clusters, windowAt, doorAt, flames, ellipseSafe, mixSafe, lumaHex,
  applyCondition, snapshotBBox, punchEllipse, scaleOf
} = S;

const MATERIALS = ['stone', 'brick', 'timber', 'plank', 'adobe', 'metal', 'crystal', 'organic'];
const WALL_STYLES = ['plain', 'windowed', 'buttressed', 'damaged'];
const ROOFS = ['gable', 'hip', 'flat', 'battlement', 'cone', 'onion', 'dome', 'thatch', 'pagoda', 'sawtooth'];
const TOWERS = ['round', 'square', 'tapered', 'segmented'];
const WINDOWS = ['arched', 'square', 'slit', 'round', 'stained', 'shuttered', 'lit'];
const COLUMNS = ['plain', 'fluted', 'capital', 'base'];
const CONDITIONS = ['intact', 'weathered', 'ruined', 'overgrown'];

const PIECE_TYPES = [
  'wall_seg', 'roof', 'tower_body', 'floor', 'setback',
  'window', 'door', 'archway', 'column', 'arch', 'colonnade_bay',
  'chimney', 'balcony', 'stairs', 'buttress', 'awning', 'banner', 'lantern',
  'pipe', 'vent', 'antenna', 'plinth', 'fence', 'railing',
  'trunk', 'branch', 'foliage', 'frond', 'root', 'rock', 'ledge', 'crystal',
  'panel', 'gear', 'wheel', 'dish', 'coil', 'blade'
];

function isPieceType(t) { return PIECE_TYPES.includes(t); }

function sockets(box) {
  const { x, y, w, h } = box;
  return {
    top: { x: x + w * 0.08, y, w: w * 0.84, side: 'top' },
    bottom: { x: x + w * 0.08, y: y + h, w: w * 0.84, side: 'bottom' },
    left: { x, y: y + h * 0.08, h: h * 0.84, side: 'left' },
    right: { x: x + w, y: y + h * 0.08, h: h * 0.84, side: 'right' },
    front: { x: x + 2, y: y + 2, w: Math.max(2, w - 4), h: Math.max(2, h - 4), side: 'front' }
  };
}

function parseVariant(type, variant) {
  const raw = String(variant || '').toLowerCase().replace(/[/-]/g, '_').trim();
  const tokens = raw.split('_').filter(Boolean);
  const has = t => tokens.includes(t);
  const material = MATERIALS.find(m => has(m)) || null;
  const out = { raw: raw || 'plain', material, tokens, has };
  if (type === 'wall_seg') out.style = WALL_STYLES.find(s => has(s)) || 'plain';
  if (type === 'roof') out.shape = ROOFS.find(s => has(s)) || 'gable';
  if (type === 'tower_body') out.shape = TOWERS.find(s => has(s)) || 'square';
  if (type === 'window') {
    out.shape = ['arched', 'square', 'slit', 'round'].find(s => has(s)) || 'square';
    out.stained = has('stained');
    out.shuttered = has('shuttered');
    out.lit = has('lit');
  }
  if (type === 'column') out.shape = COLUMNS.find(s => has(s)) || 'capital';
  if (type === 'door' || type === 'archway') out.shape = has('arched') ? 'arched' : (has('heavy') ? 'heavy' : 'square');
  if (type === 'banner') out.shape = has('swallowtail') ? 'swallowtail' : 'square';
  if (type === 'foliage') out.shape = has('hanging') ? 'hanging' : (has('needle') ? 'needle' : 'clump');
  return out;
}

function matFor(material, M, mix) {
  if (!material) return M;
  const N = Object.assign({}, M);
  if (material === 'brick') {
    N.c = mix(M.c, '#8a3a28', 0.45); N.s = mix(M.s, '#3a1410', 0.4); N.d = mix(M.d, '#c07058', 0.3);
  } else if (material === 'timber' || material === 'plank') {
    N.c = M.wood; N.s = M.woodSh; N.d = M.woodHi;
  } else if (material === 'adobe') {
    N.c = mix(M.c, '#c4a06a', 0.4); N.s = mix(M.s, '#6a4a28', 0.35); N.d = mix(M.d, '#e8c888', 0.3);
  } else if (material === 'metal') {
    N.c = M.metal; N.s = M.metalSh; N.d = M.metalHi;
  } else if (material === 'crystal') {
    N.c = mix(M.glass || M.d, M.accent, 0.35); N.s = mix(M.s, M.accent, 0.3); N.d = M.light || M.d;
  } else if (material === 'organic') {
    N.c = mix(M.c, M.foliage, 0.4); N.s = mix(M.s, M.moss, 0.35); N.d = mix(M.d, M.foliage, 0.25);
  }
  return N;
}

function fillMaterial(T, x, y, w, h, material, M, litL, rich) {
  const { rect } = T;
  const mat = material || 'stone';
  if (mat === 'brick') {
    const mortar = M.s;
    for (let row = 0, i = 0; row < h - 1; row += 3, i++) {
      const off = (i & 1) ? 2 : 0;
      for (let col = off; col < w - 1; col += 5) {
        const bw = Math.min(4, x + w - 1 - (x + col));
        if (bw > 1) {
          rect(x + col, y + row, bw, 2, (col + row) % 7 ? M.c : M.s);
          if (litL && col < w * 0.25) rect(x + col, y + row, Math.min(2, bw), 2, M.d);
        }
      }
      rect(x, y + row + 2, w, 1, mortar);
    }
  } else if (mat === 'plank') {
    for (let row = 2; row < h - 1; row += 4) {
      rect(x + 1, y + row, w - 2, 1, M.s);
      if (rich) {
        for (let col = 3; col < w - 3; col += 8) rect(x + col, y + row - 2, 1, 3, M.s);
      }
    }
    clusters(T, x + 1, y + 1, w - 2, h - 2, M.s, rich ? 6 : 3, 'pl' + x + y);
  } else if (mat === 'timber') {
    rect(x, y, 3, h, M.s);
    rect(x + w - 3, y, 3, h, M.s);
    if (litL) rect(x + 1, y, 1, h, M.d);
    for (let col = 10; col < w - 6; col += 10) rect(x + col, y, 2, h, M.s);
    clusters(T, x + 3, y + 1, w - 6, h - 2, M.s, 4, 'tm' + x);
  } else if (mat === 'metal') {
    for (let row = 3; row < h - 2; row += 6) rect(x + 2, y + row, w - 4, 1, M.s);
    if (rich) {
      for (let col = 3; col < w - 2; col += 6) {
        rect(x + col, y + 3, 1, 1, M.d);
        rect(x + col, y + h - 4, 1, 1, M.s);
      }
    }
  } else if (mat === 'crystal') {
    clusters(T, x + 1, y + 1, w - 2, h - 2, M.d, rich ? 8 : 4, 'cr' + x);
    if (litL) clusters(T, x + 1, y + 1, Math.max(2, w * 0.4), h - 2, M.light || M.d, 4, 'cl' + x);
  } else if (mat === 'organic') {
    clusters(T, x, y, w, h, M.moss || M.s, rich ? 10 : 5, 'og' + x);
    clusters(T, x + 1, y + 1, w - 2, h - 2, M.foliage || M.c, 6, 'of' + x);
  } else if (mat === 'adobe') {
    clusters(T, x + 1, y + 1, w - 2, h - 2, M.s, rich ? 8 : 4, 'ad' + x);
  } else {
    // stone masonry clusters, not line noise
    if (rich) {
      for (let row = 3; row < h - 3; row += 5) {
        const off = (row / 5) & 1 ? 3 : 0;
        for (let col = 2 + off; col < w - 5; col += 8) rect(x + col, y + row, 5, 1, M.s);
      }
    }
    clusters(T, x + 1, y + 1, w - 2, h - 2, M.s, rich ? 10 : 5, 'st' + x + y);
  }
}

function wallBody(T, box0, M, litL, style) {
  const { x, y, w, h } = box0;
  box(T, x, y, w, h, M.c, M.d, M.s, M.outline, litL);
  if (style === 'buttressed') {
    box(T, x - 2, y + h * 0.35, Math.max(4, w * 0.16), h * 0.65, M.c, M.d, M.s, M.outline, litL);
    box(T, x + w - Math.max(4, w * 0.16) + 2, y + h * 0.35, Math.max(4, w * 0.16), h * 0.65, M.c, M.d, M.s, M.outline, litL);
  }
}

function paintWall(T, box0, M, litL, sc, v) {
  const { x, y, w, h } = box0;
  const style = v.style || 'plain';
  wallBody(T, box0, M, litL, style);
  fillMaterial(T, x + 1, y + 1, w - 2, h - 2, v.material || 'stone', M, litL, sc.rich);
  if (style === 'windowed' && !sc.far && w >= 16 && h >= 16) {
    const ww = Math.max(4, Math.round(w * 0.18)), wh = Math.max(5, Math.round(h * 0.32));
    const wy = y + Math.round(h * 0.22);
    windowAt(T, x + Math.round(w * 0.18), wy, ww, wh, M.outline, M.glass, M.c, sc.rich);
    if (w >= 28) windowAt(T, x + w - Math.round(w * 0.18) - ww, wy, ww, wh, M.outline, M.glass, M.c, sc.rich);
  }
  if (style === 'damaged') {
    const { poly } = T;
    poly([[x + w * 0.62, y], [x + w, y], [x + w, y + h * 0.28], [x + w * 0.78, y + h * 0.12]], M.outline);
  }
}

function paintRoof(T, box0, M, litL, sc, v) {
  const { rect, poly, ellipse, line } = T;
  const { x, y, w, h } = box0;
  const shape = v.shape || 'gable';
  const useThatch = shape === 'thatch' || v.material === 'organic';
  const mid = useThatch ? M.thatch : (v.material === 'metal' ? M.metal : M.roof);
  const hi = useThatch ? M.thatchHi : (v.material === 'metal' ? M.metalHi : M.roofHi);
  const sh = useThatch ? M.thatchSh : (v.material === 'metal' ? M.metalSh : M.roofSh);
  const cx = x + w / 2, base = y + h;
  if (shape === 'gable' || shape === 'thatch') {
    poly([[x - 2, base], [cx, y], [x + w + 2, base]], mid, M.outline);
    if (litL) poly([[x - 2, base], [cx, y], [cx, base]], hi);
    else poly([[cx, y], [x + w + 2, base], [cx, base]], hi);
    if (litL) poly([[cx, y], [x + w + 2, base], [cx + 1, base]], sh);
    rect(x - 2, base - 2, w + 4, 2, M.outline);
    rect(x - 1, base - 2, w + 2, 1, hi);
    if (useThatch) clusters(T, x, y + 2, w, h - 2, sh, sc.rich ? 12 : 5, 'th' + x);
  } else if (shape === 'hip') {
    poly([[x, base], [x + w * 0.22, y + h * 0.35], [x + w * 0.78, y + h * 0.35], [x + w, base]], mid, M.outline);
    poly([[x + w * 0.22, y + h * 0.35], [cx, y], [x + w * 0.78, y + h * 0.35]], mid, M.outline);
    if (litL) poly([[x, base], [x + w * 0.22, y + h * 0.35], [cx, y], [cx, base]], hi);
  } else if (shape === 'flat') {
    box(T, x, y + 3, w, h - 3, M.c, M.d, M.s, M.outline, litL);
    rect(x - 1, y, w + 2, 4, M.outline);
    rect(x, y + 1, w, 2, M.c);
    if (litL) rect(x, y + 1, Math.max(2, w * 0.25), 2, M.d);
  } else if (shape === 'battlement') {
    box(T, x, y + 4, w, h - 4, M.c, M.d, M.s, M.outline, litL);
    const n = Math.max(3, Math.min(8, Math.round(w / 7)));
    for (let i = 0; i < n; i++) {
      const mw = Math.max(2, Math.floor(w / n * 0.5));
      rect(x + Math.round(i * w / n), y, mw, 6, (i % 2) ? M.c : M.s);
    }
  } else if (shape === 'cone') {
    poly([[x, base], [cx, y], [x + w, base]], mid, M.outline);
    if (litL) poly([[x, base], [cx, y], [cx, base]], hi); else poly([[cx, y], [x + w, base], [cx, base]], sh);
  } else if (shape === 'onion') {
    ellipse(x + w * 0.08, y + h * 0.15, w * 0.84, h * 0.7, M.outline);
    ellipse(x + w * 0.08 + 1, y + h * 0.15 + 1, w * 0.84 - 2, h * 0.7 - 2, mid);
    if (litL) ellipse(x + w * 0.12, y + h * 0.18, w * 0.32, h * 0.4, hi);
    poly([[x + w * 0.3, y + h * 0.22], [cx, y], [x + w * 0.7, y + h * 0.22]], mid, M.outline);
    poly([[x, base], [x + w * 0.2, y + h * 0.55], [x + w * 0.8, y + h * 0.55], [x + w, base]], mid, M.outline);
  } else if (shape === 'dome') {
    ellipse(x, y, w, h * 1.7, M.outline);
    ellipse(x + 1, y + 1, w - 2, h * 1.7 - 2, mid);
    if (litL) ellipse(x + 2, y + 2, w * 0.4, h * 0.9, hi);
    box(T, x + w * 0.08, y + h * 0.72, w * 0.84, h * 0.28, M.c, M.d, M.s, M.outline, litL);
    rect(cx - 1, y, 2, 4, M.accent);
  } else if (shape === 'pagoda') {
    const tiers = sc.far ? 2 : 3;
    let yy = base, ww = w;
    for (let i = 0; i < tiers; i++) {
      const th = h / tiers;
      const tw = w * (1 - i * 0.18);
      const tx = x + (w - tw) / 2;
      poly([[tx - 3, yy - th * 0.45], [tx + tw / 2, yy - th], [tx + tw + 3, yy - th * 0.45]], mid, M.outline);
      if (litL) poly([[tx - 3, yy - th * 0.45], [tx + tw / 2, yy - th], [tx + tw / 2, yy - th * 0.45]], hi);
      box(T, tx + 2, yy - th * 0.45, tw - 4, th * 0.45, M.c, M.d, M.s, M.outline, litL);
      yy -= th;
    }
  } else if (shape === 'sawtooth') {
    const n = Math.max(2, Math.min(5, Math.round(w / 16)));
    for (let i = 0; i < n; i++) {
      const x0 = x + i * w / n, ww = w / n;
      poly([[x0, base], [x0, y + h * 0.2], [x0 + ww * 0.7, y], [x0 + ww, y + h * 0.2], [x0 + ww, base]], mid, M.outline);
      if (litL) poly([[x0, base], [x0, y + h * 0.2], [x0 + ww * 0.7, y], [x0 + ww * 0.35, base]], hi);
    }
  }
}

function paintTower(T, box0, M, litL, sc, v) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = box0;
  const shape = v.shape || 'square';
  if (shape === 'round' || shape === 'tapered') {
    const topW = shape === 'tapered' ? Math.max(6, w * 0.55) : w * 0.85;
    for (let i = 0; i < h; i++) {
      const t = i / Math.max(1, h - 1);
      const ww = Math.round(topW + (w - topW) * t);
      const xx = Math.round(x + (w - ww) / 2);
      rect(xx, y + i, ww, 1, M.outline);
      rect(xx + 1, y + i, Math.max(1, ww - 2), 1, M.c);
      const band = Math.max(1, Math.round((ww - 2) * 0.25));
      if (litL) { rect(xx + 1, y + i, band, 1, M.d); rect(xx + ww - 1 - band, y + i, band, 1, M.s); }
      else { rect(xx + ww - 1 - band, y + i, band, 1, M.d); rect(xx + 1, y + i, band, 1, M.s); }
    }
  } else if (shape === 'segmented') {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const tw = w * (0.7 + i * 0.1), th = h / n;
      const tx = x + (w - tw) / 2, ty = y + i * th;
      box(T, tx, ty, tw, th, M.c, M.d, M.s, M.outline, litL);
      fillMaterial(T, tx + 1, ty + 1, tw - 2, th - 2, v.material || 'stone', M, litL, sc.rich && i === n - 1);
    }
  } else {
    box(T, x, y, w, h, M.c, M.d, M.s, M.outline, litL);
    fillMaterial(T, x + 1, y + 1, w - 2, h - 2, v.material || 'stone', M, litL, sc.rich);
  }
}

function paintFloor(T, box0, M, litL, sc, v) {
  const { rect } = T;
  const { x, y, w, h } = box0;
  box(T, x, y, w, h, M.c, M.d, M.s, M.outline, litL);
  fillMaterial(T, x + 1, y + 1, w - 2, h - 2, v.material || 'stone', M, litL, sc.rich);
  if (sc.rich) {
    for (let i = 1; i < 4; i++) rect(x + w * (i / 4), y, 1, h, M.s);
  }
}

function paintSetback(T, box0, M, litL, sc, v) {
  const { x, y, w, h } = box0;
  const inset = Math.max(2, Math.round(w * 0.08));
  box(T, x + inset, y, w - inset * 2, h, M.c, M.d, M.s, M.outline, litL);
  fillMaterial(T, x + inset + 1, y + 1, w - inset * 2 - 2, h - 2, v.material || 'stone', M, litL, sc.rich);
}

function paintWindow(T, box0, M, litL, sc, v) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = box0;
  const glass = v.lit ? M.flameHi || M.light || M.d : (v.stained ? mixSafe(T, M.accent, M.glass, 0.45) : M.glass);
  if (v.shape === 'round') {
    ellipse(x, y, w, h, M.outline);
    ellipse(x + 1, y + 1, w - 2, h - 2, glass);
  } else if (v.shape === 'arched') {
    rect(x, y + h * 0.35, w, h * 0.65, M.outline);
    rect(x + 1, y + h * 0.35, w - 2, h * 0.65 - 1, glass);
    ellipse(x, y, w, h * 0.7, M.outline);
    ellipse(x + 1, y + 1, w - 2, h * 0.7 - 2, glass);
  } else if (v.shape === 'slit') {
    rect(x, y, Math.max(2, w), h, M.outline);
    rect(x + 1, y + 1, Math.max(1, w - 2), h - 2, v.lit ? glass : M.s);
  } else {
    windowAt(T, x, y, w, h, M.outline, glass, v.stained ? M.accent : M.c, sc.rich && w >= 6);
  }
  if (v.shuttered && w >= 6) {
    rect(x, y + 1, Math.max(2, w * 0.35), h - 2, M.woodSh);
    rect(x + w - Math.max(2, w * 0.35), y + 1, Math.max(2, w * 0.35), h - 2, M.woodSh);
  }
}

function paintDoor(T, box0, M, litL, sc, v) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = box0;
  if (v.shape === 'arched') {
    rect(x, y + h * 0.3, w, h * 0.7, M.outline);
    rect(x + 1, y + h * 0.3, w - 2, h * 0.7 - 1, M.woodSh);
    ellipse(x, y, w, h * 0.6, M.outline);
    ellipse(x + 1, y + 1, w - 2, h * 0.6 - 2, M.woodSh);
  } else {
    doorAt(T, x, y, w, h, M.outline, v.shape === 'heavy' ? M.s : M.woodSh, M.d, sc.rich);
  }
}

function paintArchway(T, box0, M, litL, sc, v, snap) {
  const { ellipse, rect } = T;
  const { x, y, w, h } = box0;
  box(T, x, y, w, h, M.c, M.d, M.s, M.outline, litL);
  fillMaterial(T, x + 1, y + 1, w - 2, Math.max(2, h * 0.2), v.material || 'stone', M, litL, false);
  const ax = x + w * 0.12, aw = w * 0.76, ay = y + h * 0.12, ah = h * 0.88;
  ellipse(ax, ay, aw, ah * 0.7, M.outline);
  rect(ax, ay + ah * 0.32, aw, ah * 0.68, M.outline);
  if (!punchEllipse(T, snap, ax + 2, ay + 2, aw - 4, ah - 4)) {
    ellipse(ax + 2, ay + 2, aw - 4, ah * 0.7 - 4, M.s);
    rect(ax + 2, ay + ah * 0.32, aw - 4, ah * 0.68 - 2, '#0c0a10');
  }
}

function paintColumn(T, box0, M, litL, sc, v) {
  const { rect } = T;
  const { x, y, w, h } = box0;
  const cap = v.shape !== 'base' && v.shape !== 'plain';
  const base = v.shape !== 'plain';
  const capH = cap ? Math.max(3, Math.round(h * 0.1)) : 0;
  const baseH = base ? Math.max(3, Math.round(h * 0.1)) : 0;
  if (cap) {
    rect(x - 2, y, w + 4, capH, M.outline);
    rect(x - 1, y + 1, w + 2, capH - 2, M.d);
  }
  if (base) {
    rect(x - 2, y + h - baseH, w + 4, baseH, M.outline);
    rect(x - 1, y + h - baseH + 1, w + 2, baseH - 2, M.c);
  }
  box(T, x, y + capH, w, h - capH - baseH, M.c, M.d, M.s, M.outline, litL);
  if (v.shape === 'fluted' && sc.rich) {
    for (let f = x + 2; f < x + w - 2; f += 3) rect(f, y + capH + 1, 1, h - capH - baseH - 2, M.s);
  }
}

function paintArch(T, box0, M, litL, sc, v, snap) {
  paintArchway(T, box0, M, litL, sc, v, snap);
}

function paintColonnadeBay(T, box0, M, litL, sc, v, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = box0;
  const colW = Math.max(4, Math.round(w * 0.22));
  const lintH = Math.max(6, Math.round(h * 0.2));
  // lintel / entablature
  box(T, x, y, w, lintH, M.c, M.d, M.s, M.outline, litL);
  if (sc.rich) rect(x + 1, y + lintH - 2, w - 2, 1, M.d);
  // columns at both sides (right column is shared with the next bay visually)
  paintColumn(T, { x, y: y + lintH - 1, w: colW, h: h - lintH + 1 }, M, litL, sc, { shape: 'capital' });
  paintColumn(T, { x: x + w - colW, y: y + lintH - 1, w: colW, h: h - lintH + 1 }, M, litL, sc, { shape: 'capital' });
  // arched opening
  const ax = x + colW, aw = w - colW * 2, ay = y + lintH, ah = h - lintH;
  if (aw > 4 && ah > 6) {
    ellipse(ax, ay, aw, Math.min(aw, ah * 0.7), M.outline);
    rect(ax, ay + Math.min(aw, ah * 0.7) * 0.45, aw, ah - Math.min(aw, ah * 0.7) * 0.45, M.outline);
    const opened = punchEllipse(T, snap, ax + 1, ay + 1, aw - 2, ah - 2);
    if (!opened) {
      ellipse(ax + 1, ay + 1, aw - 2, Math.min(aw, ah * 0.7) - 2, '#0a0810');
      rect(ax + 1, ay + Math.min(aw, ah * 0.7) * 0.45, aw - 2, ah - Math.min(aw, ah * 0.7) * 0.45 - 1, '#0a0810');
    }
  }
}

function paintChimney(T, box0, M, litL, sc) {
  const { rect } = T;
  const { x, y, w, h } = box0;
  box(T, x, y + 2, w, h - 2, M.c, M.d, M.s, M.outline, litL);
  rect(x - 1, y, w + 2, 3, M.s);
  if (sc.rich) rect(x + 1, y - 2, Math.max(1, w - 2), 2, M.s);
}

function paintBalcony(T, box0, M, litL, sc) {
  const { rect } = T;
  const { x, y, w, h } = box0;
  box(T, x, y + h * 0.55, w, h * 0.45, M.c, M.d, M.s, M.outline, litL);
  const n = Math.max(3, Math.round(w / 4));
  for (let i = 0; i < n; i++) rect(x + i * w / n, y, 1, h * 0.55, M.s);
  rect(x, y, w, 2, M.d);
}

function paintStairs(T, box0, M, litL, sc) {
  const { x, y, w, h } = box0;
  const steps = Math.max(3, Math.min(8, Math.round(h / 4)));
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    box(T, x + w * t * 0.15, y + h * t, w * (1 - t * 0.15), Math.max(3, h / steps + 1), M.c, M.d, M.s, M.outline, litL);
  }
}

function paintButtress(T, box0, M, litL) {
  const { poly } = T;
  const { x, y, w, h } = box0;
  poly([[x, y + h], [x, y + h * 0.15], [x + w, y + h], [x, y + h]], M.c, M.outline);
  if (litL) poly([[x, y + h], [x, y + h * 0.15], [x + w * 0.4, y + h]], M.d);
}

function paintAwning(T, box0, M, litL, sc) {
  const { poly, rect } = T;
  const { x, y, w, h } = box0;
  poly([[x - 2, y + h], [x + w / 2, y], [x + w + 2, y + h]], M.cloth, M.outline);
  if (litL) poly([[x - 2, y + h], [x + w / 2, y], [x + w / 2, y + h]], M.d);
  if (sc.rich) {
    for (let i = 0; i < 4; i++) {
      if (i % 2) poly([[x - 2 + i * (w + 4) / 4, y + h], [x + w / 2, y + 1], [x - 2 + (i + 1) * (w + 4) / 4, y + h]], M.accent);
    }
  }
  rect(x + 1, y + h, 2, 3, M.woodSh);
  rect(x + w - 3, y + h, 2, 3, M.woodSh);
}

function paintBanner(T, box0, M, litL, sc, v) {
  const { rect, poly } = T;
  const { x, y, w, h } = box0;
  rect(x, y, w, 3, M.outline);
  rect(x + 1, y + 1, w - 2, 1, M.woodHi);
  rect(x, y, 2, h, M.woodSh);
  const bh = v.shape === 'swallowtail' ? h - 7 : h - 4;
  poly([[x + 3, y + 3], [x + w - 1, y + 3], [x + w - 2, y + 3 + bh], [x + 4, y + 3 + bh]], M.cloth, M.outline);
  if (litL) rect(x + 4, y + 4, Math.max(1, w * 0.25), bh - 2, M.d);
  if (v.shape === 'swallowtail') poly([[x + 3, y + 3 + bh], [x + w / 2, y + h], [x + w - 1, y + 3 + bh]], M.cloth, M.outline);
  if (sc.rich) rect(x + w * 0.35, y + h * 0.3, Math.max(2, w * 0.28), 3, M.accent);
}

function paintLantern(T, box0, M, litL, sc) {
  const { rect, ellipse, line } = T;
  const { x, y, w, h } = box0;
  line(x + w / 2, y, x + w / 2, y + h * 0.35, M.woodSh);
  rect(x + 1, y + h * 0.35, w - 2, 2, M.metal);
  ellipse(x, y + h * 0.4, w, h * 0.5, M.outline);
  ellipse(x + 1, y + h * 0.4 + 1, w - 2, h * 0.5 - 2, M.flameHi);
  if (sc.rich) flames(T, x, y + h * 0.35, w, h * 0.2, M, 1);
}

function paintPipe(T, box0, M, litL) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = box0;
  const t = Math.max(2, Math.round(w * 0.4));
  rect(x + (w - t) / 2, y, t, h, M.outline);
  rect(x + (w - t) / 2 + 1, y, Math.max(1, t - 2), h, M.metal);
  ellipse(x, y - 1, w, Math.max(3, w * 0.5), M.metalSh);
}

function paintVent(T, box0, M, litL) {
  const { rect } = T;
  const { x, y, w, h } = box0;
  box(T, x, y, w, h, M.metal, M.metalHi, M.metalSh, M.outline, litL);
  for (let i = 2; i < h - 2; i += 3) rect(x + 1, y + i, w - 2, 1, M.s);
}

function paintAntenna(T, box0, M, litL) {
  const { rect, line } = T;
  const { x, y, w, h } = box0;
  const cx = x + w / 2;
  rect(cx - 1, y + h * 0.2, 2, h * 0.8, M.metal);
  line(cx, y, cx - w * 0.4, y + h * 0.25, M.metalSh);
  line(cx, y, cx + w * 0.4, y + h * 0.25, M.metalSh);
  rect(cx - 2, y, 4, 3, M.accent);
}

function paintPlinth(T, box0, M, litL, sc, v) {
  const { x, y, w, h } = box0;
  const mid = Math.round(h * 0.45);
  box(T, x + w * 0.06, y + h - mid, w * 0.88, mid, M.c, M.d, M.s, M.outline, litL);
  box(T, x + w * 0.14, y, w * 0.72, h - mid + 1, M.c, M.d, M.s, M.outline, litL);
  fillMaterial(T, x + w * 0.14 + 1, y + 1, w * 0.72 - 2, h - mid - 1, v.material || 'stone', M, litL, sc.rich);
}

function paintFence(T, box0, M, litL, sc) {
  const { rect, poly } = T;
  const { x, y, w, h } = box0;
  const n = Math.max(4, Math.round(w / 5));
  for (let i = 0; i < n; i++) {
    const px = x + i * w / n, pw = Math.max(2, w / n - 1);
    rect(px, y + 3, pw, h - 3, M.outline);
    rect(px + 1, y + 3, Math.max(1, pw - 2), h - 4, M.wood);
    poly([[px, y + 3], [px + pw / 2, y], [px + pw, y + 3]], M.wood, M.outline);
  }
  rect(x, y + h * 0.45, w, 2, M.woodSh);
}

function paintRailing(T, box0, M, litL) {
  const { rect } = T;
  const { x, y, w, h } = box0;
  const n = Math.max(3, Math.round(w / 4));
  for (let i = 0; i <= n; i++) rect(x + i * w / n, y, 1, h, M.s);
  rect(x, y, w, 2, M.d);
  rect(x, y + h - 2, w, 2, M.s);
}

function paintTrunk(T, box0, M, litL, sc, v) {
  const { rect } = T;
  const { x, y, w, h } = box0;
  const lean = (v.has && v.has('lean')) ? (litL ? 1 : -1) : 0;
  if (lean) {
    for (let i = 0; i < h; i++) {
      const xx = Math.round(x + Math.sin((i / h) * 1.3) * lean * w * 0.2);
      rect(xx, y + i, w, 1, M.outline);
      rect(xx + 1, y + i, w - 2, 1, M.wood);
      if (litL) rect(xx + 1, y + i, Math.max(1, w * 0.35), 1, M.woodHi);
    }
  } else {
    box(T, x, y, w, h, M.wood, M.woodHi, M.woodSh, M.outline, litL);
    clusters(T, x, y, w, h, M.woodSh, 5, 'bk' + x);
  }
}

function paintBranch(T, box0, M, litL) {
  const { line } = T;
  const { x, y, w, h } = box0;
  line(x, y + h, x + w * 0.6, y, M.outline);
  line(x, y + h, x + w * 0.6, y, M.wood);
  line(x + w * 0.4, y + h * 0.4, x + w, y + h * 0.15, M.woodSh);
}

function paintFoliage(T, box0, M, litL, sc, v) {
  const { ellipse, line } = T;
  const { x, y, w, h } = box0;
  if (v.shape === 'hanging') {
    const n = sc.far ? 5 : 9;
    for (let i = 0; i < n; i++) {
      const xx = x + i * w / Math.max(1, n - 1);
      const drop = y + h * (0.7 + (i % 3) * 0.1);
      line(xx, y, xx + ((i % 2) ? 3 : -3), drop, M.moss);
      if (!sc.far) for (let k = 0; k < 3; k++) ellipse(xx - 2, y + h * (0.2 + k * 0.2), 5, 7, k % 2 ? M.foliage : M.moss);
    }
  } else if (v.shape === 'needle') {
    const { poly } = T;
    const cx = x + w / 2;
    poly([[x, y + h], [cx, y], [x + w, y + h]], M.foliage, M.outline);
    if (litL) poly([[x, y + h], [cx, y], [cx, y + h]], M.d);
  } else {
    ellipse(x, y, w, h, M.outline);
    ellipse(x + 1, y + 1, w - 2, h - 2, M.foliage);
    if (litL) ellipse(x + 1, y + 1, w * 0.4, h * 0.5, M.d);
  }
}

function paintFrond(T, box0, M, litL, sc) {
  const { line, poly } = T;
  const { x, y, w, h } = box0;
  const x0 = x + 2, y0 = y + h * 0.15, x1 = x + w, y1 = y + h * 0.85;
  line(x0, y0, x1, y1, M.outline);
  line(x0, y0, x1, y1, M.moss);
  const n = sc.far ? 4 : 6;
  for (let k = 1; k <= n; k++) {
    const t = k / (n + 0.3);
    const fx = x0 + (x1 - x0) * t, fy = y0 + (y1 - y0) * t;
    const leaf = (0.7 - Math.abs(t - 0.45)) * w * 0.5;
    poly([[fx, fy], [fx, fy + leaf * 0.4], [fx + (x1 - x0) * 0.1, fy + (y1 - y0) * 0.1]], k % 2 ? M.foliage : M.moss, M.outline);
    poly([[fx, fy], [fx, fy - leaf * 0.3], [fx + (x1 - x0) * 0.08, fy + (y1 - y0) * 0.08]], M.foliage);
  }
}

function paintRoot(T, box0, M, litL) {
  const { line } = T;
  const { x, y, w, h } = box0;
  line(x + w * 0.5, y, x, y + h, M.woodSh);
  line(x + w * 0.5, y, x + w, y + h, M.woodSh);
  line(x + w * 0.5, y, x + w * 0.3, y + h * 0.7, M.wood);
  line(x + w * 0.5, y, x + w * 0.75, y + h * 0.8, M.wood);
}

function paintRock(T, box0, M, litL, sc) {
  const { poly } = T;
  const { x, y, w, h } = box0;
  poly([[x, y + h * 0.55], [x + w * 0.18, y + h * 0.15], [x + w * 0.55, y], [x + w, y + h * 0.4], [x + w * 0.7, y + h], [x + w * 0.15, y + h]], M.c, M.outline);
  if (litL) poly([[x, y + h * 0.55], [x + w * 0.18, y + h * 0.15], [x + w * 0.55, y], [x + w * 0.4, y + h]], M.d);
  else poly([[x + w * 0.55, y], [x + w, y + h * 0.4], [x + w * 0.7, y + h], [x + w * 0.45, y + h]], M.s);
  if (sc.rich) clusters(T, x, y, w, h, M.s, 6, 'rk' + x);
}

function paintLedge(T, box0, M, litL) {
  const { rect } = T;
  const { x, y, w, h } = box0;
  box(T, x, y + 2, w, h - 2, M.c, M.d, M.s, M.outline, litL);
  rect(x, y, w, 3, M.d);
}

function paintCrystal(T, box0, M, litL) {
  const { poly, line } = T;
  const { x, y, w, h } = box0;
  const cx = x + w / 2;
  poly([[x, y + h], [x + w * 0.2, y + h * 0.25], [cx, y], [x + w * 0.8, y + h * 0.22], [x + w, y + h]], M.glass || M.d, M.outline);
  if (litL) poly([[x, y + h], [x + w * 0.2, y + h * 0.25], [cx, y], [cx, y + h]], M.d);
  line(cx, y, cx, y + h, M.light || M.d);
}

function paintPanel(T, box0, M, litL, sc) {
  const { rect } = T;
  const { x, y, w, h } = box0;
  box(T, x, y, w, h, M.metal, M.metalHi, M.metalSh, M.outline, litL);
  if (!sc.far) {
    rect(x + 2, y + 2, w * 0.6, h * 0.4, M.outline);
    rect(x + 3, y + 3, w * 0.6 - 2, h * 0.4 - 2, M.glass);
    for (let i = 0; i < 3; i++) rect(x + 3 + i * 5, y + h * 0.6, 3, 3, i % 2 ? M.flame : M.metalHi);
  }
}

function paintGear(T, box0, M, litL) {
  const { ellipse, line } = T;
  const { x, y, w, h } = box0;
  const d = Math.min(w, h), dx = x + (w - d) / 2, dy = y + (h - d) / 2;
  ellipse(dx, dy, d, d, M.outline);
  ellipse(dx + 2, dy + 2, d - 4, d - 4, M.metal);
  ellipse(dx + d * 0.3, dy + d * 0.3, d * 0.4, d * 0.4, M.outline);
  const cx = dx + d / 2, cy = dy + d / 2;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    line(cx, cy, cx + Math.cos(a) * d * 0.5, cy + Math.sin(a) * d * 0.5, M.metalSh);
  }
}

function paintWheel(T, box0, M, litL) { paintGear(T, box0, M, litL); }

function paintDish(T, box0, M, litL) {
  const { ellipse, line, rect } = T;
  const { x, y, w, h } = box0;
  ellipse(x, y, w, h * 0.7, M.outline);
  ellipse(x + 1, y + 1, w - 2, h * 0.7 - 2, M.metal);
  if (litL) ellipse(x + 2, y + 2, w * 0.4, h * 0.4, M.metalHi);
  ellipse(x + w * 0.2, y + h * 0.15, w * 0.6, h * 0.4, M.metalSh);
  line(x + w / 2, y + h * 0.35, x + w / 2, y + h, M.metal);
  rect(x + w / 2 - 2, y + h * 0.3, 4, 4, M.accent);
}

function paintCoil(T, box0, M, litL) {
  const { ellipse, rect } = T;
  const { x, y, w, h } = box0;
  for (let i = 0; i < 4; i++) ellipse(x, y + i * (h / 5), w, h * 0.28, i % 2 ? M.accent : M.metal);
  rect(x + w / 2 - 1, y, 2, h, M.metalSh);
}

function paintBlade(T, box0, M, litL, sc) {
  const { poly, line } = T;
  const { x, y, w, h } = box0;
  const canvas = mixSafe(T, M.d, '#e6dcc4', 0.5);
  poly([[x, y], [x + w, y + h * 0.08], [x + w, y + h * 0.92], [x, y + h]], canvas, M.outline);
  line(x, y + h / 2, x + w, y + h / 2, M.woodSh);
  if (sc.rich) {
    line(x + w * 0.33, y + 2, x + w * 0.33, y + h - 2, M.woodSh);
    line(x + w * 0.66, y + 2, x + w * 0.66, y + h - 2, M.woodSh);
  }
}

const PAINTERS = {
  wall_seg: paintWall, roof: paintRoof, tower_body: paintTower, floor: paintFloor, setback: paintSetback,
  window: paintWindow, door: paintDoor, archway: paintArchway, column: paintColumn, arch: paintArch,
  colonnade_bay: paintColonnadeBay, chimney: paintChimney, balcony: paintBalcony, stairs: paintStairs,
  buttress: paintButtress, awning: paintAwning, banner: paintBanner, lantern: paintLantern,
  pipe: paintPipe, vent: paintVent, antenna: paintAntenna, plinth: paintPlinth, fence: paintFence,
  railing: paintRailing, trunk: paintTrunk, branch: paintBranch, foliage: paintFoliage, frond: paintFrond,
  root: paintRoot, rock: paintRock, ledge: paintLedge, crystal: paintCrystal, panel: paintPanel,
  gear: paintGear, wheel: paintWheel, dish: paintDish, coil: paintCoil, blade: paintBlade
};

function paintPiece(type, variant, T, box0, colsOrM, litL, sc, condition) {
  const fn = PAINTERS[type];
  if (!fn) return false;
  const mix = T.mixHex;
  const M0 = colsOrM.c ? S.mats(colsOrM, mix) : colsOrM;
  const v = parseVariant(type, variant);
  let M = matFor(v.material, M0, mix);
  const lighting = colsOrM.lighting;
  if (lighting === 'moonlit' || colsOrM.palette === 'frost_silver') {
    M = S.boostContrast(M, mix);
  }
  const snap = (condition && condition !== 'intact' && T.ctx) ? snapshotBBox(T, box0.x, box0.y - 4, box0.w, box0.h + 6) : null;
  fn(T, box0, M, litL, sc || scaleOf({ w: box0.w, h: box0.h }), v, snap);
  if (condition && condition !== 'intact') {
    applyCondition(T, { x: box0.x, y: box0.y, w: box0.w, h: box0.h, parts: { condition } }, M, snap, litL);
  }
  return true;
}

function catalog() {
  // compact list of type/variant pairs for the sheet
  const list = [];
  for (const m of MATERIALS) {
    list.push({ type: 'wall_seg', variant: m + '_plain', label: 'wall ' + m });
  }
  for (const s of WALL_STYLES) if (s !== 'plain') list.push({ type: 'wall_seg', variant: 'stone_' + s, label: 'wall ' + s });
  for (const r of ROOFS) list.push({ type: 'roof', variant: r, label: 'roof ' + r });
  for (const t of TOWERS) list.push({ type: 'tower_body', variant: t, label: 'tower ' + t });
  list.push({ type: 'floor', variant: 'stone', label: 'floor' });
  list.push({ type: 'setback', variant: 'stone', label: 'setback' });
  list.push({ type: 'plinth', variant: 'stone', label: 'plinth' });
  list.push({ type: 'stairs', variant: 'stone', label: 'stairs' });
  for (const w of ['square', 'arched', 'slit', 'round', 'stained', 'shuttered', 'arched_lit']) {
    list.push({ type: 'window', variant: w, label: 'window ' + w });
  }
  list.push({ type: 'door', variant: 'plank', label: 'door' });
  list.push({ type: 'door', variant: 'arched', label: 'door arched' });
  list.push({ type: 'archway', variant: 'stone', label: 'archway' });
  list.push({ type: 'column', variant: 'capital', label: 'column' });
  list.push({ type: 'column', variant: 'fluted', label: 'column fluted' });
  list.push({ type: 'colonnade_bay', variant: 'stone', label: 'colonnade bay' });
  for (const a of ['chimney', 'balcony', 'buttress', 'awning', 'banner', 'lantern', 'pipe', 'vent', 'antenna', 'fence', 'railing']) {
    list.push({ type: a, variant: 'plain', label: a });
  }
  for (const a of ['trunk', 'branch', 'foliage', 'frond', 'root', 'rock', 'ledge', 'crystal']) {
    list.push({ type: a, variant: a === 'foliage' ? 'clump' : 'plain', label: a });
  }
  list.push({ type: 'foliage', variant: 'hanging', label: 'foliage hanging' });
  list.push({ type: 'foliage', variant: 'needle', label: 'foliage needle' });
  for (const a of ['panel', 'gear', 'wheel', 'dish', 'coil', 'blade']) list.push({ type: a, variant: 'metal', label: a });
  return list;
}

module.exports = {
  PIECE_TYPES, MATERIALS, WALL_STYLES, ROOFS, TOWERS, WINDOWS, COLUMNS, CONDITIONS,
  isPieceType, sockets, parseVariant, paintPiece, catalog, fillMaterial, matFor, PAINTERS
};
