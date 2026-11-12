'use strict';
// Additional sprite-quality painters for library kinds. Helpers come from scenerySprites.

const S = require('./scenerySprites');
const {
  box, clusters, windowAt, doorAt, flames, after, punchEllipse, ellipseSafe, mixSafe, scaleOf
} = S;

const ASPECT = {
  airship: 2.2, anvil: 1.4, barn: 1.4, barrel: 0.7, fireplace: 0.85, hearth: 0.85,
  pier: 2.8, dock: 2.8, chapel: 0.8, shrine: 0.75, pagoda: 0.7, cactus: 0.45,
  baobab: 0.85, wagon: 1.8, cauldron: 0.9, dais: 2.2, lectern: 0.7, pew: 1.8,
  hanging_lanterns: 1.1, floating_rock: 1.3, balloon: 0.75, comet: 1.6,
  cave_mouth: 1.4, standing_stone: 0.45, menhir: 0.4, volcano: 1.2, geyser: 0.7,
  ice_spike: 0.4, kiln: 0.85, forge: 1.1, palisade: 2.4, monument: 0.55,
  granary: 0.7, silo: 0.4, longhouse: 1.8, hall_house: 1.35, stilt_house: 0.9,
  clock_tower: 0.42, chimney_stack: 0.35, waterwheel: 0.85, crane: 0.7, mill: 1.2,
  amphora: 0.55, vase: 0.55, urn: 0.6, loom: 1.1, tool_rack: 1.2, organ_pipes: 1.1,
  bone_arch: 1.15, dome_habitat: 0.95, monolith_alien: 0.4, gantry: 2.0,
  pipe_cluster: 0.9, tank_sphere: 0.95, capsule: 0.45, wreck_frame: 1.6,
  coral_spire: 0.45, giant_fern: 0.7, reed_clump: 1.1, glacier: 1.5, iceberg: 1.2,
  mesa: 1.6, butte: 1.1, geode: 0.95, shopfront: 1.1, cairn: 1.1, totem: 0.4
};

function airship(T, p, M, litL, sc, snap) {
  const { rect, poly, ellipse, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  const hullY = y + h * 0.18;
  const hullH = h * 0.48;
  ellipse(x, hullY, w, hullH, M.outline);
  ellipse(x + 1, hullY + 1, w - 2, hullH - 2, M.c);
  if (litL) ellipse(x + 2, hullY + 2, w * 0.4, hullH * 0.55, M.d);
  else ellipse(x + w * 0.5, hullY + 2, w * 0.4, hullH * 0.55, M.d);
  // fins
  poly([[x + w * 0.78, hullY + hullH * 0.2], [x + w + 4, hullY], [x + w * 0.86, hullY + hullH * 0.45]], M.s, M.outline);
  poly([[x + w * 0.8, hullY + hullH * 0.5], [x + w + 2, hullY + hullH], [x + w * 0.78, hullY + hullH * 0.7]], M.c, M.outline);
  // gondola
  const gx = x + w * 0.28, gw = w * 0.36, gy = hullY + hullH - 2, gh = h * 0.28;
  box(T, gx, gy, gw, gh, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  if (!far) {
    line(gx + 2, gy, gx + 2, hullY + hullH * 0.6, M.woodSh);
    line(gx + gw - 2, gy, gx + gw - 2, hullY + hullH * 0.6, M.woodSh);
    for (let i = 0; i < 3; i++) windowAt(T, gx + 3 + i * (gw / 3), gy + 2, 4, 4, M.outline, M.glass, M.wood, false);
  }
  after(T, p, M, snap, litL);
}

function anvil(T, p, M, litL, sc, snap) {
  const { rect, poly } = T;
  const { x, y, w, h } = p;
  const baseY = y + h;
  box(T, x + w * 0.22, y + h * 0.72, w * 0.56, h * 0.28, M.metalSh, M.metalHi, M.s, M.outline, litL);
  // waist
  box(T, x + w * 0.34, y + h * 0.42, w * 0.32, h * 0.32, M.metal, M.metalHi, M.metalSh, M.outline, litL);
  // face + horn + heel
  poly([
    [x + w * 0.02, y + h * 0.32],
    [x + w * 0.22, y + h * 0.18],
    [x + w * 0.7, y + h * 0.18],
    [x + w * 0.98, y + h * 0.28],
    [x + w * 0.86, y + h * 0.44],
    [x + w * 0.18, y + h * 0.44]
  ], M.metal, M.outline);
  if (litL) poly([[x + w * 0.02, y + h * 0.32], [x + w * 0.22, y + h * 0.18], [x + w * 0.7, y + h * 0.18], [x + w * 0.7, y + h * 0.32]], M.metalHi);
  T.rect(x + w * 0.24, y + h * 0.18, w * 0.44, 2, M.d);
  after(T, p, M, snap, litL);
}

function barn(T, p, M, litL, sc, snap) {
  const { rect, poly } = T;
  const { x, y, w, h } = p, { far } = sc;
  const ch = Math.max(8, Math.round(h * 0.36));
  poly([[x - 2, y + ch], [x + w / 2, y], [x + w + 2, y + ch]], M.roof, M.outline);
  if (litL) poly([[x - 2, y + ch], [x + w / 2, y], [x + w / 2, y + ch]], M.roofHi);
  box(T, x, y + ch - 1, w, h - ch + 1, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  clusters(T, x + 2, y + ch, w - 4, h - ch - 2, M.woodSh, 8, 'brn' + x);
  const dw = Math.max(8, w * 0.28), dh = Math.max(10, (h - ch) * 0.7);
  doorAt(T, Math.round(x + w / 2 - dw / 2), y + h - dh, dw, dh, M.outline, M.woodSh, M.d, !far);
  // loft door
  if (!far) windowAt(T, x + w / 2 - 4, y + ch + 3, 8, 7, M.outline, M.s, M.wood, false);
  after(T, p, M, snap, litL);
}

function hall_house(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  const ch = Math.max(7, Math.round(h * 0.3));
  T.poly([[x - 2, y + ch], [x + w / 2, y], [x + w + 2, y + ch]], M.roof, M.outline);
  if (litL) T.poly([[x - 2, y + ch], [x + w / 2, y], [x + w / 2, y + ch]], M.roofHi);
  box(T, x, y + ch - 1, w, h - ch + 1, M.c, M.d, M.s, M.outline, litL);
  if (!far) {
    for (let i = 0; i < 4; i++) windowAt(T, x + w * 0.08 + i * w * 0.22, y + ch + 4, Math.max(4, w * 0.12), Math.max(6, h * 0.18), M.outline, M.glass, M.c, true);
    doorAt(T, Math.round(x + w * 0.42), y + h - Math.round((h - ch) * 0.55), Math.max(5, w * 0.12), Math.round((h - ch) * 0.55), M.outline, M.s, M.d, true);
  }
  after(T, p, M, snap, litL);
}

function longhouse(T, p, M, litL, sc, snap) { hall_house(T, p, M, litL, sc, snap); }

function chapel(T, p, M, litL, sc, snap) {
  const { poly, rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  const naveW = w * 0.72, naveX = x + w * 0.05, ch = h * 0.28;
  poly([[naveX - 2, y + ch + h * 0.12], [naveX + naveW / 2, y + h * 0.12], [naveX + naveW + 2, y + ch + h * 0.12]], M.roof, M.outline);
  box(T, naveX, y + ch + h * 0.12 - 1, naveW, h - ch - h * 0.12 + 1, M.c, M.d, M.s, M.outline, litL);
  // side steeple
  const tw = w * 0.22, tx = x + w * 0.78;
  box(T, tx, y + h * 0.28, tw, h * 0.72, M.c, M.d, M.s, M.outline, litL);
  poly([[tx - 1, y + h * 0.28], [tx + tw / 2, y], [tx + tw + 1, y + h * 0.28]], M.roof, M.outline);
  if (!far) {
    windowAt(T, naveX + naveW * 0.15, y + h * 0.42, 5, 10, M.outline, M.glass, M.c, true);
    windowAt(T, naveX + naveW * 0.45, y + h * 0.42, 5, 10, M.outline, M.glass, M.c, true);
    doorAt(T, Math.round(naveX + naveW * 0.38), y + h - 14, 8, 14, M.outline, M.s, M.d, true);
  }
  after(T, p, M, snap, litL);
}

function shrine(T, p, M, litL, sc, snap) {
  const { poly, rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  const ch = h * 0.32;
  // raised platform + four posts + hip roof
  box(T, x + 2, y + h - 5, w - 4, 5, M.c, M.d, M.s, M.outline, litL);
  poly([[x - 2, y + ch], [x + w / 2, y], [x + w + 2, y + ch]], M.roof, M.outline);
  if (litL) poly([[x - 2, y + ch], [x + w / 2, y], [x + w / 2, y + ch]], M.roofHi);
  rect(x + 3, y + ch, 2, h - ch - 5, M.woodSh);
  rect(x + w - 5, y + ch, 2, h - ch - 5, M.woodSh);
  if (!far) {
    box(T, x + w * 0.3, y + h * 0.55, w * 0.4, h * 0.22, M.c, M.d, M.s, M.outline, litL);
    flames(T, x + w * 0.4, y + h * 0.42, w * 0.2, h * 0.14, M, 2);
  }
  after(T, p, M, snap, litL);
}

function pagoda(T, p, M, litL, sc, snap) {
  const { poly, rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  const tiers = 3;
  let yy = y + h, ww = w;
  for (let i = 0; i < tiers; i++) {
    const th = Math.round(h * (0.22 - i * 0.02));
    const tw = Math.round(w * (1 - i * 0.22));
    const tx = Math.round(x + (w - tw) / 2);
    const roofH = Math.round(th * 0.55);
    poly([[tx - 4, yy - th + roofH], [tx + tw / 2, yy - th], [tx + tw + 4, yy - th + roofH]], M.roof, M.outline);
    if (litL) poly([[tx - 4, yy - th + roofH], [tx + tw / 2, yy - th], [tx + tw / 2, yy - th + roofH]], M.roofHi);
    box(T, tx + 3, yy - th + roofH - 1, tw - 6, th - roofH + 1, M.wood, M.woodHi, M.woodSh, M.outline, litL);
    if (!far) windowAt(T, tx + tw / 2 - 3, yy - th + roofH + 2, 6, 5, M.outline, M.s, M.wood, false);
    yy -= th;
    ww = tw;
  }
  after(T, p, M, snap, litL);
}

function pier(T, p, M, litL, sc, snap) {
  const { rect, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  const deckH = Math.max(3, Math.round(h * 0.22));
  rect(x, y, w, deckH, M.outline);
  rect(x + 1, y + 1, w - 2, deckH - 2, M.wood);
  if (!far) {
    for (let i = 0; i < 8; i++) rect(x + 2 + i * (w / 8), y + 1, Math.max(2, w / 10), 1, M.woodHi);
  }
  const posts = 5;
  for (let i = 0; i < posts; i++) {
    const px = x + 4 + i * (w - 8) / Math.max(1, posts - 1);
    rect(px, y + deckH, 2, h - deckH, M.woodSh);
    rect(px, y + deckH, 1, h - deckH, M.wood);
  }
  if (!far) {
    line(x, y, x + w, y, M.outline);
    for (let i = 0; i <= 6; i++) rect(x + i * w / 6, y - 3, 1, 3, M.woodSh);
    line(x, y - 3, x + w, y - 3, M.wood);
  }
  after(T, p, M, snap, litL);
}

function fireplace(T, p, M, litL, sc, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = p, { far } = sc;
  box(T, x, y + h * 0.12, w, h * 0.88, M.c, M.d, M.s, M.outline, litL);
  // mantel
  rect(x - 2, y + h * 0.12, w + 4, 5, M.outline);
  rect(x - 1, y + h * 0.12 + 1, w + 2, 3, M.c);
  const aw = w * 0.62, ah = h * 0.52, ax = x + w * 0.19, ay = y + h - ah;
  rect(ax, ay + ah * 0.25, aw, ah * 0.75, M.outline);
  rect(ax + 1, ay + ah * 0.25, aw - 2, ah * 0.75 - 1, '#140c08');
  ellipse(ax, ay, aw, ah * 0.55, M.outline);
  ellipse(ax + 1, ay + 1, aw - 2, ah * 0.55 - 2, '#140c08');
  if (!far) flames(T, ax + 4, ay + ah * 0.2, aw - 8, ah * 0.45, M, 4);
  after(T, p, M, snap, litL);
}

function barrel(T, p, M, litL, sc, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = p;
  ellipse(x, y + h - w * 0.35, w, w * 0.35, M.outline);
  ellipse(x + 1, y + h - w * 0.35 + 1, w - 2, w * 0.35 - 2, M.woodSh);
  box(T, x + 1, y + w * 0.12, w - 2, h - w * 0.28, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  ellipse(x, y, w, w * 0.32, M.outline);
  ellipse(x + 1, y + 1, w - 2, w * 0.32 - 2, M.wood);
  rect(x + 2, y + h * 0.3, w - 4, 2, M.metalSh);
  rect(x + 2, y + h * 0.62, w - 4, 2, M.metalSh);
  after(T, p, M, snap, litL);
}

function cauldron(T, p, M, litL, sc, snap) {
  const { ellipse, rect, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  line(x + 2, y + h, x + w * 0.25, y + h * 0.45, M.metalSh);
  line(x + w - 2, y + h, x + w * 0.75, y + h * 0.45, M.metalSh);
  ellipse(x, y + h * 0.28, w, h * 0.7, M.outline);
  ellipse(x + 1, y + h * 0.28 + 1, w - 2, h * 0.7 - 2, M.metalSh);
  ellipse(x + 3, y + h * 0.28, w - 6, 6, M.outline);
  ellipse(x + 5, y + h * 0.28 + 2, w - 10, 4, M.s);
  if (!far) flames(T, x + w * 0.2, y + h * 0.72, w * 0.6, h * 0.2, M, 3);
  after(T, p, M, snap, litL);
}

function cactus(T, p, M, litL, sc, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = p;
  const cx = x + w / 2, tw = Math.max(4, w * 0.32);
  box(T, cx - tw / 2, y + h * 0.15, tw, h * 0.85, M.foliage, M.d, M.moss, M.outline, litL);
  // arms
  box(T, x, y + h * 0.32, Math.max(3, w * 0.28), Math.max(4, h * 0.12), M.foliage, M.d, M.moss, M.outline, litL);
  box(T, x, y + h * 0.18, Math.max(3, w * 0.14), h * 0.22, M.foliage, M.d, M.moss, M.outline, litL);
  box(T, cx + tw / 2 - 1, y + h * 0.48, Math.max(3, w * 0.26), Math.max(4, h * 0.1), M.foliage, M.d, M.moss, M.outline, litL);
  box(T, x + w - Math.max(3, w * 0.14), y + h * 0.32, Math.max(3, w * 0.14), h * 0.22, M.foliage, M.d, M.moss, M.outline, litL);
  clusters(T, x, y, w, h, M.moss, 8, 'sp' + x);
  after(T, p, M, snap, litL);
}

function baobab(T, p, M, litL, sc, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = p;
  const cx = x + w / 2, tw = w * 0.42;
  box(T, cx - tw / 2, y + h * 0.38, tw, h * 0.62, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  // swollen trunk
  ellipse(cx - tw * 0.6, y + h * 0.42, tw * 1.2, h * 0.32, M.wood);
  ellipse(x + w * 0.08, y, w * 0.38, h * 0.32, M.foliage);
  ellipse(x + w * 0.35, y - 2, w * 0.42, h * 0.3, M.moss);
  ellipse(x + w * 0.55, y + h * 0.06, w * 0.38, h * 0.28, M.foliage);
  after(T, p, M, snap, litL);
}

function wagon(T, p, M, litL, sc, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = p, { far } = sc;
  box(T, x + w * 0.08, y + h * 0.22, w * 0.84, h * 0.42, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  rect(x + w * 0.08, y + h * 0.22, w * 0.84, 3, M.woodHi);
  const wr = Math.max(6, h * 0.38);
  ellipse(x + w * 0.14, y + h - wr, wr, wr, M.outline);
  ellipse(x + w * 0.14 + 1, y + h - wr + 1, wr - 2, wr - 2, M.woodSh);
  ellipse(x + w * 0.68, y + h - wr, wr, wr, M.outline);
  ellipse(x + w * 0.68 + 1, y + h - wr + 1, wr - 2, wr - 2, M.woodSh);
  if (!far) {
    rect(x + w * 0.14 + wr / 2 - 1, y + h - wr, 2, wr, M.metal);
    rect(x + w * 0.68 + wr / 2 - 1, y + h - wr, 2, wr, M.metal);
  }
  after(T, p, M, snap, litL);
}

function dais(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h } = p;
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    box(T, x + w * t * 0.15, y + h * t * 0.55, w * (1 - t * 0.3), Math.max(4, h * 0.4), M.c, M.d, M.s, M.outline, litL);
  }
  after(T, p, M, snap, litL);
}

function lectern(T, p, M, litL, sc, snap) {
  const { rect, poly } = T;
  const { x, y, w, h } = p;
  box(T, x + w * 0.3, y + h * 0.35, w * 0.4, h * 0.65, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  poly([[x + 1, y + h * 0.28], [x + w - 1, y], [x + w - 1, y + h * 0.22], [x + 1, y + h * 0.38]], M.wood, M.outline);
  rect(x + w * 0.2, y + h * 0.08, w * 0.55, h * 0.12, M.s);
  after(T, p, M, snap, litL);
}

function pew(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h } = p;
  box(T, x, y + h * 0.35, w, h * 0.22, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  box(T, x, y, Math.max(3, w * 0.08), h, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  box(T, x + w - Math.max(3, w * 0.08), y, Math.max(3, w * 0.08), h, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  rect(x, y, w, Math.max(3, h * 0.28), M.woodSh);
  after(T, p, M, snap, litL);
}

function hanging_lanterns(T, p, M, litL, sc, snap) {
  const { rect, ellipse, line } = T;
  const { x, y, w, h, count } = p;
  const n = Math.max(3, Math.min(count || 4, 6));
  for (let i = 0; i < n; i++) {
    const xx = x + i * (w - 6) / Math.max(1, n - 1);
    const len = h * (0.35 + (i % 3) * 0.15);
    line(xx + 2, y, xx + 2, y + len, M.woodSh);
    ellipse(xx, y + len, 6, 8, M.outline);
    ellipse(xx + 1, y + len + 1, 4, 6, M.flameHi);
    rect(xx + 1, y + len, 4, 1, M.metal);
  }
  after(T, p, M, snap, litL);
}

function floating_rock(T, p, M, litL, sc, snap) {
  const { poly, ellipse } = T;
  const { x, y, w, h } = p;
  poly([[x, y + h * 0.45], [x + w * 0.2, y + h * 0.1], [x + w * 0.65, y], [x + w, y + h * 0.4], [x + w * 0.7, y + h], [x + w * 0.15, y + h * 0.9]], M.c, M.outline);
  if (litL) poly([[x, y + h * 0.45], [x + w * 0.2, y + h * 0.1], [x + w * 0.65, y], [x + w * 0.5, y + h * 0.9]], M.d);
  else poly([[x + w * 0.65, y], [x + w, y + h * 0.4], [x + w * 0.7, y + h], [x + w * 0.5, y + h * 0.5]], M.d);
  ellipse(x + w * 0.3, y + h + 2, w * 0.4, 4, M.s);
  after(T, p, M, snap, litL);
}

function balloon(T, p, M, litL, sc, snap) {
  const { ellipse, rect, line } = T;
  const { x, y, w, h } = p;
  ellipse(x, y, w, h * 0.7, M.outline);
  ellipse(x + 1, y + 1, w - 2, h * 0.7 - 2, M.cloth);
  if (litL) ellipse(x + 2, y + 2, w * 0.4, h * 0.4, M.d);
  rect(x + w * 0.38, y + h * 0.68, w * 0.24, 3, M.clothSh);
  line(x + w * 0.3, y + h * 0.7, x + w * 0.28, y + h * 0.88, M.woodSh);
  line(x + w * 0.7, y + h * 0.7, x + w * 0.72, y + h * 0.88, M.woodSh);
  box(T, x + w * 0.28, y + h * 0.86, w * 0.44, h * 0.14, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  after(T, p, M, snap, litL);
}

function comet(T, p, M, litL, sc, snap) {
  const { ellipse, poly } = T;
  const { x, y, w, h } = p;
  poly([[x + w * 0.55, y + h * 0.35], [x, y + h * 0.15], [x + w * 0.1, y + h * 0.7]], M.d, M.d);
  poly([[x + w * 0.5, y + h * 0.4], [x + w * 0.05, y + h * 0.45], [x + w * 0.55, y + h * 0.55]], mixSafe(T, M.accent, M.d, 0.4));
  const d = Math.min(w, h) * 0.45;
  ellipse(x + w - d, y, d, d, M.outline);
  ellipse(x + w - d + 1, y + 1, d - 2, d - 2, M.d);
  after(T, p, M, snap, litL);
}

function cave_mouth(T, p, M, litL, sc, snap) {
  const { ellipse, poly } = T;
  const { x, y, w, h } = p;
  poly([[x, y + h], [x + w * 0.05, y + h * 0.25], [x + w * 0.5, y], [x + w * 0.95, y + h * 0.28], [x + w, y + h]], M.c, M.outline);
  if (litL) poly([[x, y + h], [x + w * 0.05, y + h * 0.25], [x + w * 0.5, y], [x + w * 0.45, y + h]], M.d);
  if (!punchEllipse(T, snap, x + w * 0.18, y + h * 0.22, w * 0.64, h * 0.85)) {
    ellipse(x + w * 0.18, y + h * 0.22, w * 0.64, h * 0.85, M.s);
    ellipse(x + w * 0.26, y + h * 0.35, w * 0.48, h * 0.7, '#0a0a0c');
  }
  after(T, p, M, snap, litL);
}

function standing_stone(T, p, M, litL, sc, snap) {
  const { poly } = T;
  const { x, y, w, h } = p;
  poly([[x + w * 0.15, y + h], [x, y + h * 0.35], [x + w * 0.35, y], [x + w * 0.85, y + h * 0.12], [x + w, y + h * 0.5], [x + w * 0.8, y + h]], M.c, M.outline);
  if (litL) poly([[x + w * 0.15, y + h], [x, y + h * 0.35], [x + w * 0.35, y], [x + w * 0.4, y + h]], M.d);
  else poly([[x + w * 0.35, y], [x + w * 0.85, y + h * 0.12], [x + w, y + h * 0.5], [x + w * 0.8, y + h], [x + w * 0.4, y + h]], M.s);
  clusters(T, x, y, w, h, M.s, 6, 'mn' + x);
  after(T, p, M, snap, litL);
}

function volcano(T, p, M, litL, sc, snap) {
  const { poly, rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  poly([[x, y + h], [x + w * 0.32, y + h * 0.18], [x + w * 0.68, y + h * 0.18], [x + w, y + h]], M.c, M.outline);
  if (litL) poly([[x, y + h], [x + w * 0.32, y + h * 0.18], [x + w * 0.5, y + h]], M.d);
  else poly([[x + w * 0.5, y + h], [x + w * 0.68, y + h * 0.18], [x + w, y + h]], M.d);
  poly([[x + w * 0.36, y + h * 0.2], [x + w * 0.5, y + h * 0.08], [x + w * 0.64, y + h * 0.2]], M.s, M.outline);
  if (!far) {
    rect(x + w * 0.46, y, 3, h * 0.12, M.flame);
    flames(T, x + w * 0.38, y - 2, w * 0.24, h * 0.16, M, 3);
  }
  after(T, p, M, snap, litL);
}

function geyser(T, p, M, litL, sc, snap) {
  const { ellipse, rect } = T;
  const { x, y, w, h } = p;
  ellipse(x, y + h * 0.62, w, h * 0.38, M.outline);
  ellipse(x + 1, y + h * 0.62 + 1, w - 2, h * 0.38 - 2, M.c);
  ellipse(x + w * 0.2, y + h * 0.7, w * 0.6, h * 0.2, M.water);
  const cx = x + w / 2;
  rect(cx - 2, y + 2, 4, h * 0.7, M.waterHi);
  rect(cx - 5, y + h * 0.15, 3, h * 0.4, M.water);
  rect(cx + 3, y + h * 0.1, 3, h * 0.45, M.waterHi);
  clusters(T, x + w * 0.2, y, w * 0.6, 8, M.light, 8, 'gs' + x);
  after(T, p, M, snap, litL);
}

function ice_spike(T, p, M, litL, sc, snap) {
  const { poly } = T;
  const { x, y, w, h } = p;
  const cx = x + w / 2;
  poly([[x, y + h], [cx, y], [x + w, y + h]], M.d, M.outline);
  if (litL) poly([[x, y + h], [cx, y], [cx, y + h]], M.light);
  else poly([[cx, y], [x + w, y + h], [cx, y + h]], M.c);
  after(T, p, M, snap, litL);
}

function kiln(T, p, M, litL, sc, snap) {
  const { ellipse, rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  ellipse(x, y + h * 0.15, w, h * 0.85, M.outline);
  ellipse(x + 1, y + h * 0.15 + 1, w - 2, h * 0.85 - 2, M.c);
  if (litL) ellipse(x + 2, y + h * 0.2, w * 0.4, h * 0.5, M.d);
  box(T, x + w * 0.35, y, w * 0.3, h * 0.22, M.c, M.d, M.s, M.outline, litL);
  if (!far) {
    ellipse(x + w * 0.3, y + h * 0.5, w * 0.4, h * 0.35, M.outline);
    ellipse(x + w * 0.3 + 1, y + h * 0.5 + 1, w * 0.4 - 2, h * 0.35 - 2, '#1a0c08');
    flames(T, x + w * 0.34, y + h * 0.55, w * 0.3, h * 0.2, M, 2);
  }
  after(T, p, M, snap, litL);
}

function forge(T, p, M, litL, sc, snap) {
  fireplace(T, p, M, litL, sc, snap);
}

function palisade(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h } = p;
  const n = Math.max(5, Math.round(w / 5));
  for (let i = 0; i < n; i++) {
    const pw = Math.max(3, Math.round(w / n) - 1);
    const px = x + i * (w / n);
    const ph = h - (i % 3);
    rect(px, y + (h - ph), pw, ph, M.outline);
    rect(px + 1, y + (h - ph) + 1, Math.max(1, pw - 2), ph - 2, M.wood);
    if (litL) rect(px + 1, y + (h - ph) + 1, 1, ph - 2, M.woodHi);
    // pointed top
    T.poly([[px, y + (h - ph)], [px + pw / 2, y + (h - ph) - 3], [px + pw, y + (h - ph)]], M.wood, M.outline);
  }
  after(T, p, M, snap, litL);
}

function monument(T, p, M, litL, sc, snap) {
  const { rect, poly } = T;
  const { x, y, w, h } = p;
  box(T, x + w * 0.1, y + h * 0.78, w * 0.8, h * 0.22, M.c, M.d, M.s, M.outline, litL);
  box(T, x + w * 0.22, y + h * 0.22, w * 0.56, h * 0.56, M.c, M.d, M.s, M.outline, litL);
  poly([[x + w * 0.22, y + h * 0.22], [x + w / 2, y], [x + w * 0.78, y + h * 0.22]], M.c, M.outline);
  if (litL) T.poly([[x + w * 0.22, y + h * 0.22], [x + w / 2, y], [x + w / 2, y + h * 0.22]], M.d);
  after(T, p, M, snap, litL);
}

function granary(T, p, M, litL, sc, snap) {
  const { poly, rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  const cap = h * 0.22;
  poly([[x - 2, y + cap], [x + w / 2, y], [x + w + 2, y + cap]], M.thatch, M.outline);
  box(T, x + 2, y + cap - 1, w - 4, h - cap + 1, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  if (!far) doorAt(T, Math.round(x + w / 2 - 3), y + h - 12, 6, 12, M.outline, M.s, M.d, false);
  after(T, p, M, snap, litL);
}

function silo(T, p, M, litL, sc, snap) {
  const { ellipse, rect } = T;
  const { x, y, w, h } = p;
  box(T, x + 1, y + w * 0.25, w - 2, h - w * 0.25, M.c, M.d, M.s, M.outline, litL);
  ellipse(x, y, w, w * 0.55, M.outline);
  ellipse(x + 1, y + 1, w - 2, w * 0.55 - 2, M.c);
  if (litL) ellipse(x + 2, y + 2, w * 0.4, w * 0.35, M.d);
  after(T, p, M, snap, litL);
}

function stilt_house(T, p, M, litL, sc, snap) {
  const { rect, poly } = T;
  const { x, y, w, h } = p, { far } = sc;
  const floor = y + h * 0.42;
  const ch = h * 0.22;
  poly([[x - 2, floor], [x + w / 2, y], [x + w + 2, floor]], M.roof, M.outline);
  box(T, x, floor - 1, w, h * 0.28, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  rect(x + 3, floor + h * 0.26, 2, y + h - (floor + h * 0.26), M.woodSh);
  rect(x + w - 5, floor + h * 0.26, 2, y + h - (floor + h * 0.26), M.woodSh);
  rect(x + w / 2 - 1, floor + h * 0.26, 2, y + h - (floor + h * 0.26), M.woodSh);
  if (!far) {
    windowAt(T, x + 4, floor + 3, 6, 5, M.outline, M.glass, M.wood, false);
    // ladder
    for (let i = 0; i < 4; i++) rect(x + w * 0.7, floor + h * 0.28 + i * 5, 6, 1, M.woodSh);
  }
  after(T, p, M, snap, litL);
}

function clock_tower(T, p, M, litL, sc, snap) {
  const { rect, ellipse, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  box(T, x + w * 0.08, y + h * 0.2, w * 0.84, h * 0.8, M.c, M.d, M.s, M.outline, litL);
  T.poly([[x + w * 0.08, y + h * 0.2], [x + w / 2, y], [x + w * 0.92, y + h * 0.2]], M.roof, M.outline);
  const d = Math.max(8, w * 0.5);
  ellipse(x + w / 2 - d / 2, y + h * 0.28, d, d, M.outline);
  ellipse(x + w / 2 - d / 2 + 1, y + h * 0.28 + 1, d - 2, d - 2, M.d);
  if (!far) {
    line(x + w / 2, y + h * 0.28 + d / 2, x + w / 2, y + h * 0.28 + 3, M.outline);
    line(x + w / 2, y + h * 0.28 + d / 2, x + w / 2 + d * 0.25, y + h * 0.28 + d * 0.65, M.outline);
  }
  after(T, p, M, snap, litL);
}

function chimney_stack(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h } = p;
  box(T, x + 1, y + 4, w - 2, h - 4, M.c, M.d, M.s, M.outline, litL);
  rect(x, y, w, 5, M.s);
  rect(x + 2, y + h * 0.35, w - 4, 2, M.s);
  rect(x + 2, y + h * 0.65, w - 4, 2, M.s);
  after(T, p, M, snap, litL);
}

function waterwheel(T, p, M, litL, sc, snap) {
  const { ellipse, line, rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  const d = Math.min(w, h);
  const dx = x + (w - d) / 2, dy = y + (h - d) / 2;
  ellipse(dx, dy, d, d, M.outline);
  ellipse(dx + 2, dy + 2, d - 4, d - 4, M.wood);
  ellipse(dx + d * 0.3, dy + d * 0.3, d * 0.4, d * 0.4, M.outline);
  const cx = dx + d / 2, cy = dy + d / 2;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    line(cx, cy, cx + Math.cos(a) * d * 0.48, cy + Math.sin(a) * d * 0.48, M.woodSh);
  }
  after(T, p, M, snap, litL);
}

function crane(T, p, M, litL, sc, snap) {
  const { rect, line } = T;
  const { x, y, w, h } = p;
  rect(x + w * 0.12, y + h * 0.35, 3, h * 0.65, M.metalSh);
  rect(x + w * 0.12, y + h * 0.35, w * 0.7, 3, M.metal);
  line(x + w * 0.12 + 2, y + h * 0.38, x + w * 0.82, y + h * 0.7, M.metalSh);
  rect(x + w * 0.78, y + h * 0.7, 4, 6, M.accent);
  box(T, x, y + h * 0.78, w * 0.36, h * 0.22, M.metal, M.metalHi, M.metalSh, M.outline, litL);
  after(T, p, M, snap, litL);
}

function mill(T, p, M, litL, sc, snap) {
  barn(T, p, M, litL, sc, snap);
  const wheel = { x: p.x + p.w - 8, y: p.y + p.h * 0.4, w: Math.max(10, p.w * 0.28), h: Math.max(10, p.h * 0.45) };
  waterwheel(T, wheel, M, litL, scaleOf(wheel), null);
}

function amphora(T, p, M, litL, sc, snap) {
  const { ellipse, rect, poly } = T;
  const { x, y, w, h } = p;
  const cx = x + w / 2;
  ellipse(x + w * 0.15, y + h * 0.2, w * 0.7, h * 0.7, M.outline);
  ellipse(x + w * 0.15 + 1, y + h * 0.2 + 1, w * 0.7 - 2, h * 0.7 - 2, M.c);
  if (litL) ellipse(x + w * 0.2, y + h * 0.25, w * 0.25, h * 0.45, M.d);
  rect(x + w * 0.32, y, w * 0.36, h * 0.22, M.c);
  rect(x + w * 0.32, y, w * 0.36, 2, M.outline);
  // handles
  poly([[x + w * 0.15, y + h * 0.35], [x, y + h * 0.28], [x + w * 0.18, y + h * 0.5]], M.c, M.outline);
  poly([[x + w * 0.85, y + h * 0.35], [x + w, y + h * 0.28], [x + w * 0.82, y + h * 0.5]], M.c, M.outline);
  after(T, p, M, snap, litL);
}

function loom(T, p, M, litL, sc, snap) {
  const { rect, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  box(T, x, y, 3, h, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  box(T, x + w - 3, y, 3, h, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  rect(x, y + 2, w, 3, M.wood);
  rect(x, y + h * 0.55, w, 3, M.wood);
  if (!far) {
    for (let i = 0; i < 8; i++) line(x + 4 + i * (w - 8) / 7, y + 5, x + 4 + i * (w - 8) / 7, y + h * 0.55, i % 2 ? M.cloth : M.accent);
  }
  after(T, p, M, snap, litL);
}

function tool_rack(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h } = p;
  box(T, x, y, w, h, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  rect(x + 2, y + 4, w - 4, 2, M.woodSh);
  rect(x + 2, y + h * 0.5, w - 4, 2, M.woodSh);
  // hanging tools (scenery, not loot)
  rect(x + 4, y + 6, 2, h * 0.35, M.metal);
  rect(x + 10, y + 6, 3, h * 0.28, M.woodSh);
  rect(x + 10, y + 6, 6, 3, M.metalSh);
  rect(x + w - 10, y + h * 0.52, 2, h * 0.35, M.metal);
  after(T, p, M, snap, litL);
}

function organ_pipes(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h, count } = p;
  const n = Math.max(5, Math.min(count || 7, 10));
  for (let i = 0; i < n; i++) {
    const pw = Math.max(2, Math.round(w / n) - 1);
    const px = x + i * (w / n);
    const ph = h * (0.45 + Math.abs(i - n / 2) / n * 0.7);
    box(T, px, y + h - ph, pw, ph, M.metal, M.metalHi, M.metalSh, M.outline, litL);
  }
  after(T, p, M, snap, litL);
}

function bone_arch(T, p, M, litL, sc, snap) {
  const { ellipse, rect } = T;
  const { x, y, w, h } = p;
  box(T, x, y + h * 0.35, Math.max(4, w * 0.16), h * 0.65, M.d, M.light, M.c, M.outline, litL);
  box(T, x + w - Math.max(4, w * 0.16), y + h * 0.35, Math.max(4, w * 0.16), h * 0.65, M.d, M.light, M.c, M.outline, litL);
  ellipse(x, y, w, h * 0.7, M.outline);
  ellipse(x + 2, y + 2, w - 4, h * 0.7 - 4, M.d);
  if (!punchEllipse(T, snap, x + w * 0.18, y + h * 0.18, w * 0.64, h * 0.7)) {
    ellipse(x + w * 0.18, y + h * 0.18, w * 0.64, h * 0.7, M.s);
  }
  after(T, p, M, snap, litL);
}

function dome_habitat(T, p, M, litL, sc, snap) {
  const { ellipse, rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  ellipse(x, y, w, h * 1.15, M.outline);
  ellipse(x + 1, y + 1, w - 2, h * 1.15 - 2, M.metal);
  if (litL) ellipse(x + 2, y + 2, w * 0.4, h * 0.55, M.metalHi);
  box(T, x + w * 0.15, y + h * 0.7, w * 0.7, h * 0.3, M.metalSh, M.metalHi, M.s, M.outline, litL);
  if (!far) {
    windowAt(T, x + w * 0.28, y + h * 0.4, 8, 6, M.outline, M.glass, M.metal, true);
    windowAt(T, x + w * 0.52, y + h * 0.4, 8, 6, M.outline, M.glass, M.metal, true);
  }
  after(T, p, M, snap, litL);
}

function monolith_alien(T, p, M, litL, sc, snap) {
  const { rect, line } = T;
  const { x, y, w, h } = p, { far } = sc;
  box(T, x, y, w, h, M.metal, M.metalHi, M.metalSh, M.outline, litL);
  if (!far) {
    line(x + w / 2, y + 4, x + w / 2, y + h - 4, M.accent);
    rect(x + 2, y + h * 0.3, w - 4, 2, M.accent);
    rect(x + 2, y + h * 0.55, w - 4, 2, M.light);
  }
  after(T, p, M, snap, litL);
}

function gantry(T, p, M, litL, sc, snap) {
  const { rect, line } = T;
  const { x, y, w, h } = p;
  rect(x, y + 2, w, 3, M.metal);
  rect(x, y + 2, 3, h - 2, M.metalSh);
  rect(x + w - 3, y + 2, 3, h - 2, M.metalSh);
  line(x + 3, y + 5, x + w * 0.5, y + h, M.metalSh);
  line(x + w - 3, y + 5, x + w * 0.5, y + h, M.metalSh);
  rect(x, y, w, 2, M.metalHi);
  after(T, p, M, snap, litL);
}

function pipe_cluster(T, p, M, litL, sc, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h, count } = p;
  const n = Math.max(3, Math.min(count || 4, 6));
  for (let i = 0; i < n; i++) {
    const pw = 3 + (i % 3);
    const px = x + i * (w - 6) / Math.max(1, n - 1);
    const ph = h * (0.5 + (i % 3) * 0.15);
    rect(px, y + h - ph, pw, ph, M.outline);
    rect(px + 1, y + h - ph, Math.max(1, pw - 2), ph, i % 2 ? M.metal : M.metalSh);
    ellipse(px - 1, y + h - ph - 2, pw + 2, 4, M.metal);
  }
  after(T, p, M, snap, litL);
}

function tank_sphere(T, p, M, litL, sc, snap) {
  const { ellipse, rect } = T;
  const { x, y, w, h } = p;
  const d = Math.min(w, h * 0.85);
  const dx = x + (w - d) / 2, dy = y;
  ellipse(dx, dy, d, d, M.outline);
  ellipse(dx + 1, dy + 1, d - 2, d - 2, M.metal);
  if (litL) ellipse(dx + 2, dy + 2, d * 0.4, d * 0.5, M.metalHi);
  box(T, x + w * 0.3, y + d * 0.85, w * 0.4, h - d * 0.85, M.metalSh, M.metalHi, M.s, M.outline, litL);
  rect(dx + 4, dy + d * 0.45, d - 8, 2, M.s);
  after(T, p, M, snap, litL);
}

function capsule(T, p, M, litL, sc, snap) {
  const { ellipse, rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  ellipse(x, y, w, w, M.outline);
  ellipse(x + 1, y + 1, w - 2, w - 2, M.metal);
  box(T, x, y + w * 0.4, w, h - w * 0.8, M.metal, M.metalHi, M.metalSh, M.outline, litL);
  ellipse(x, y + h - w, w, w, M.outline);
  ellipse(x + 1, y + h - w + 1, w - 2, w - 2, M.metalSh);
  if (!far) windowAt(T, x + 3, y + h * 0.4, w - 6, 6, M.outline, M.glass, M.metal, true);
  after(T, p, M, snap, litL);
}

function wreck_frame(T, p, M, litL, sc, snap) {
  const { line, rect, poly } = T;
  const { x, y, w, h } = p;
  poly([[x, y + h * 0.4], [x + w * 0.3, y + h * 0.1], [x + w * 0.9, y + h * 0.25], [x + w * 0.7, y + h], [x + w * 0.15, y + h]], M.metalSh, M.outline);
  line(x + w * 0.2, y + h, x + w * 0.35, y, M.metal);
  line(x + w * 0.5, y + h * 0.2, x + w * 0.7, y + h, M.metalSh);
  rect(x + w * 0.4, y + h * 0.3, w * 0.2, 3, M.s);
  after(T, p, M, snap, litL);
}

function coral_spire(T, p, M, litL, sc, snap) {
  const { poly, ellipse } = T;
  const { x, y, w, h } = p;
  const cx = x + w / 2;
  poly([[x + w * 0.2, y + h], [cx, y], [x + w * 0.8, y + h]], M.accent, M.outline);
  if (litL) poly([[x + w * 0.2, y + h], [cx, y], [cx, y + h]], M.d);
  ellipse(cx - 3, y + h * 0.25, 8, 6, M.cloth);
  ellipse(x + 1, y + h * 0.5, 7, 5, M.accent);
  after(T, p, M, snap, litL);
}

function giant_fern(T, p, M, litL, sc, snap) {
  const { line, poly, rect } = T;
  const { x, y, w, h } = p;
  const cx = x + w / 2;
  rect(cx - 1, y + h * 0.3, 2, h * 0.7, M.woodSh);
  for (let i = 0; i < 6; i++) {
    const a = -2.2 + i * 0.55;
    const x2 = cx + Math.cos(a) * w * 0.5, y2 = y + h * 0.25 + Math.sin(a) * h * 0.25;
    line(cx, y + h * 0.35, x2, y2, M.moss);
    poly([[cx, y + h * 0.35], [x2, y2], [x2 - 4, y2 + 6]], i % 2 ? M.foliage : M.moss, M.outline);
  }
  after(T, p, M, snap, litL);
}

function reed_clump(T, p, M, litL, sc, snap) {
  const { line, rect } = T;
  const { x, y, w, h, count } = p;
  const n = Math.max(6, Math.min((count || 4) * 3, 14));
  for (let i = 0; i < n; i++) {
    const xx = x + (i + 0.5) * w / n;
    const hh = h * (0.65 + (i % 4) * 0.08);
    line(xx, y + h, xx + ((i % 3) - 1) * 2, y + h - hh, i % 2 ? M.foliage : M.moss);
  }
  after(T, p, M, snap, litL);
}

function glacier(T, p, M, litL, sc, snap) {
  const { poly } = T;
  const { x, y, w, h } = p;
  poly([[x, y + h], [x + w * 0.15, y + h * 0.35], [x + w * 0.4, y + h * 0.08], [x + w * 0.7, y], [x + w, y + h * 0.4], [x + w * 0.85, y + h]], M.d, M.outline);
  if (litL) poly([[x, y + h], [x + w * 0.15, y + h * 0.35], [x + w * 0.4, y + h * 0.08], [x + w * 0.45, y + h]], M.light);
  else poly([[x + w * 0.7, y], [x + w, y + h * 0.4], [x + w * 0.85, y + h], [x + w * 0.6, y + h]], M.c);
  after(T, p, M, snap, litL);
}

function iceberg(T, p, M, litL, sc, snap) { glacier(T, p, M, litL, sc, snap); }

function mesa(T, p, M, litL, sc, snap) {
  const { poly, rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  poly([[x, y + h], [x + w * 0.12, y + h * 0.22], [x + w * 0.88, y + h * 0.2], [x + w, y + h]], M.c, M.outline);
  if (litL) poly([[x, y + h], [x + w * 0.12, y + h * 0.22], [x + w * 0.3, y + h]], M.d);
  else poly([[x + w * 0.7, y + h], [x + w * 0.88, y + h * 0.2], [x + w, y + h]], M.s);
  rect(x + w * 0.12, y + h * 0.18, w * 0.76, 3, M.s);
  if (!far) clusters(T, x + w * 0.15, y + h * 0.25, w * 0.7, h * 0.6, M.s, 8, 'ms' + x);
  after(T, p, M, snap, litL);
}

function butte(T, p, M, litL, sc, snap) { mesa(T, p, M, litL, sc, snap); }

function geode(T, p, M, litL, sc, snap) {
  const { ellipse, poly } = T;
  const { x, y, w, h } = p, { far } = sc;
  ellipse(x, y, w, h, M.outline);
  ellipse(x + 1, y + 1, w - 2, h - 2, M.c);
  if (!far) {
    ellipse(x + w * 0.18, y + h * 0.18, w * 0.64, h * 0.64, M.outline);
    ellipse(x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.6, M.accent);
    poly([[x + w * 0.4, y + h * 0.3], [x + w * 0.5, y + h * 0.18], [x + w * 0.58, y + h * 0.4]], M.light, M.outline);
  }
  after(T, p, M, snap, litL);
}

function shopfront(T, p, M, litL, sc, snap) {
  const { rect } = T;
  const { x, y, w, h } = p, { far } = sc;
  box(T, x, y + h * 0.18, w, h * 0.82, M.c, M.d, M.s, M.outline, litL);
  rect(x - 2, y + h * 0.18, w + 4, 5, M.woodSh);
  rect(x - 1, y + h * 0.18 + 1, w + 2, 3, M.cloth);
  if (!far) {
    windowAt(T, x + 4, y + h * 0.32, w * 0.4, h * 0.32, M.outline, M.glass, M.c, true);
    doorAt(T, Math.round(x + w * 0.58), y + h - Math.round(h * 0.42), Math.max(6, w * 0.28), Math.round(h * 0.42), M.outline, M.woodSh, M.d, true);
  }
  after(T, p, M, snap, litL);
}

function cairn(T, p, M, litL, sc, snap) {
  const { ellipse } = T;
  const { x, y, w, h } = p;
  ellipse(x + w * 0.05, y + h * 0.55, w * 0.9, h * 0.45, M.c);
  ellipse(x + w * 0.18, y + h * 0.28, w * 0.64, h * 0.4, M.s);
  ellipse(x + w * 0.3, y + h * 0.08, w * 0.4, h * 0.32, M.c);
  if (litL) ellipse(x + w * 0.22, y + h * 0.32, w * 0.22, h * 0.22, M.d);
  after(T, p, M, snap, litL);
}

function totem(T, p, M, litL, sc, snap) {
  const { rect, ellipse } = T;
  const { x, y, w, h } = p, { far } = sc;
  box(T, x + w * 0.2, y, w * 0.6, h, M.wood, M.woodHi, M.woodSh, M.outline, litL);
  if (!far) {
    ellipse(x + w * 0.22, y + 2, w * 0.56, h * 0.22, M.woodSh);
    rect(x + w * 0.28, y + h * 0.32, w * 0.44, 3, M.accent);
    ellipse(x + w * 0.28, y + h * 0.4, w * 0.2, h * 0.12, M.s);
    ellipse(x + w * 0.52, y + h * 0.4, w * 0.2, h * 0.12, M.s);
    rect(x + w * 0.3, y + h * 0.62, w * 0.4, h * 0.12, M.woodSh);
  }
  after(T, p, M, snap, litL);
}

const ALIASES = {
  airship, anvil, barn, hall_house, longhouse, chapel, shrine, pagoda,
  pier, dock: pier, fireplace, hearth: fireplace, barrel, cauldron,
  cactus, baobab, wagon, dais, lectern, pew, hanging_lanterns,
  floating_rock, balloon, comet, cave_mouth, standing_stone, menhir: standing_stone,
  volcano, geyser, ice_spike, kiln, forge, palisade, monument,
  granary, silo, stilt_house, clock_tower, chimney_stack, waterwheel, crane, mill,
  amphora, vase: amphora, urn: amphora, loom, tool_rack, organ_pipes,
  bone_arch, dome_habitat, monolith_alien, gantry, pipe_cluster, tank_sphere,
  capsule, wreck_frame, coral_spire, giant_fern, reed_clump,
  glacier, iceberg, mesa, butte, geode, shopfront, cairn, totem
};

module.exports = { ALIASES, ASPECT, names: Object.keys(ALIASES) };
