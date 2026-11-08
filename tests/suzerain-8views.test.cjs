'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../assets/renderCharacterProcedural');
const S = require('../assets/renderCharacterSprite');
const Poses = require('../assets/combatMapPoses');

const spec = C.getPresetProceduralSpec('Suzerain');
const VIEWS = [['front', 1], ['threeQuarter', 1], ['side', 1], ['backQuarter', 1], ['back', 1], ['backQuarter', -1], ['side', -1], ['threeQuarter', -1]];
const reds = (p, minY, maxY) => { let n = 0; for (let y = minY; y <= maxY; y++) for (let x = 0; x < p.w; x++) { const i = (y * p.w + x) * 4; if (p.data[i + 3] && p.data[i] > 140 && p.data[i + 1] < 80 && p.data[i + 2] < 80) n++; } return n; };

test('Suzerain preset keeps his identity: plate, red cape, red crest, longsword, same size', () => {
  const t = spec.traits;
  assert.strictEqual(t.outfit.style, 'plate'); assert.strictEqual(t.outfit.helm, 'closed'); assert.ok(t.outfit.cape);
  assert.strictEqual(t.capeColor, '#aa2222'); assert.strictEqual(t.plume, '#b82424');
  assert.strictEqual(t.worldScale, 1.08); assert.strictEqual(t.items[0].type, 'sword');
});

test('all 8 Suzerain views render with hard alpha, stable height and a visible red crest', () => {
  const hs = VIEWS.map(([view, facing]) => {
    const p = C.renderBillboardPixels(spec, { frame: 0, view, facing });
    for (let i = 3; i < p.data.length; i += 4) assert.ok(p.data[i] === 0 || p.data[i] === 255, view + ' alpha');
    assert.ok(p.bounds, view + ' empty');
    const top = p.bounds.minY, h = p.bounds.maxY - top;
    assert.ok(reds(p, top, top + Math.round(h * 0.35)) > 0, 'red crest/cape near the top in ' + view + ' ' + facing);
    return h;
  });
  hs.forEach((h) => assert.ok(Math.abs(h - hs[0]) <= hs[0] * 0.12, 'height drift ' + hs));
});

test('back view: no face, cape covers the back, crest still shows', () => {
  const front = C.renderProceduralPixels(spec, 0, 'billboard', 'front');
  const p = C.renderBillboardPixels(spec, { frame: 0, view: 'back', facing: 1 });
  const k = p.w / 64, f = front.face;
  if (f) {
    let skinPx = 0;
    for (let y = Math.round(f.top * k); y <= Math.round(f.bottom * k); y++) for (let x = Math.round(p.w / 2 - 5 * k); x < p.w / 2 + 5 * k; x++) {
      const i = (y * p.w + x) * 4; if (p.data[i + 3] && Math.abs(p.data[i] - f.skin[0]) < 14 && Math.abs(p.data[i + 1] - f.skin[1]) < 14) skinPx++;
    }
    assert.ok(skinPx < k * k * 2, 'face skin on back view: ' + skinPx);
  }
  const b = p.bounds, h = b.maxY - b.minY;
  const backRed = reds(p, b.minY + Math.round(h * 0.25), b.maxY);
  const frontRed = reds(C.renderBillboardPixels(spec, { frame: 0, view: 'front', facing: 1 }), b.minY + Math.round(h * 0.25), b.maxY);
  assert.ok(backRed > frontRed * 2, 'cape dominates the back: ' + backRed + ' vs ' + frontRed);
});

test('every action renders in all 8 views and the side walk strides', () => {
  ['walk', 'idle', 'attack', 'pain', 'death'].forEach((action) => VIEWS.forEach(([view, facing]) => [0, 1, 2, 3].forEach((frame) => {
    const p = C.renderBillboardPixels(spec, { frame, view, facing, action });
    assert.ok(p.bounds, action + ' ' + view + ' ' + frame);
  })));
  const a = C.renderBillboardPixels(spec, { frame: 0, view: 'side', facing: 1 }).data, b = C.renderBillboardPixels(spec, { frame: 1, view: 'side', facing: 1 }).data;
  let diff = 0; for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) diff++;
  assert.ok(diff > 150, 'side walk frames differ: ' + diff);
  const r = C.renderBillboardPixels(spec, { frame: 0, view: 'side', facing: 1 }).data, l = C.renderBillboardPixels(spec, { frame: 0, view: 'side', facing: -1 }).data;
  let lr = 0; for (let i = 3; i < r.length; i += 4) if (r[i] !== l[i]) lr++;
  assert.ok(lr > 100, 'left and right sides differ');
});

test('2D token: hand-made knight with striding walk and four attack poses; helm and crest never stretch', () => {
  const ch = { name: 'Suzerain', _rerollSeed: 0.5 };
  const walk = S.createCombatSpriteSheetCanvas(ch, null, 4);
  assert.strictEqual(walk.width, 384); assert.strictEqual(walk.height, 96); assert.strictEqual(walk._combatBodyHeight, 72);
  const sheet = S.createCombatPoseSheetCanvas(ch, null, walk);
  assert.ok(sheet._combatAttackFrames); assert.strictEqual(sheet.width, 768);
  const g = sheet.getContext('2d'), frames = [];
  for (let f = 0; f < 8; f++) frames.push(g.getImageData(f * 96, 0, 96, 96).data);
  const differ = (a, b) => { let n = 0; for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) n++; return n; };
  assert.ok(differ(frames[0], frames[1]) > 20, 'walk strides');
  assert.ok(differ(frames[4], frames[6]) > 40, 'attack swings');
  // the crest (bright red pixels above the helm) keeps the same pixel count in every frame: rigid, only translated
  const crest = (d) => { let n = 0; for (let y = 0; y < 24; y++) for (let x = 0; x < 96; x++) { const i = (y * 96 + x) * 4; if (d[i + 3] && d[i] > 120 && d[i + 1] < 90) n++; } return n; };
  const helm = (d) => { let n = 0; for (let y = 0; y < 40; y++) for (let x = 24; x < 60; x++) { const i = (y * 96 + x) * 4; if (d[i + 3] && d[i] === 0x12 && d[i + 1] === 0x14) n++; } return n; };
  const c0 = crest(frames[0]), h0 = helm(frames[0]);
  assert.ok(c0 > 0 && h0 > 0);
  // the blade may pass in front of the crest on the wind-up, which only ever hides pixels
  frames.forEach((d, i) => { assert.ok(crest(d) <= c0 && (i === 4 || crest(d) === c0), 'crest stretch in frame ' + i + ': ' + crest(d) + ' vs ' + c0); assert.ok(helm(d) >= h0 && helm(d) <= 27, 'visor slit (3x1 native px, the resting blade may hide one) frame ' + i + ': ' + helm(d)); });
});

test('2D attack turns Suzerain like the other left-facing reference token', () => {
  global.combatCharacters = [{ name: 'Suzerain', x: 5, y: 5 }, { name: 'Orc', x: 8, y: 5 }];
  Poses.cue('Suzerain', 'Orc', 0);
  assert.strictEqual(Poses.facingFlip({ name: 'Suzerain', x: 5, y: 5 }, 0, 10), true);
  Poses.clear(); delete global.combatCharacters;
});

test('2D upright sword frames keep a clear gap between the blade and the helm, pauldron and torso', () => {
  const frames = [[0, null], [1, null], [2, null], [3, null], [0, 'attack'], [3, 'attack']];
  for (const [f, a] of frames) {
    const d = S.createSuzerainReferenceCanvas(f, a).getContext('2d').getImageData(0, 0, 96, 96).data;
    let rows = 0;
    for (let gy = 4; gy <= 13; gy++) {
      const y = gy * 3 + 1; let bladeX = -1;
      for (let x = 0; x < 96; x++) { const i = (y * 96 + x) * 4; if (d[i + 3] && (d[i] === 0xe4 || d[i] === 0xa2) && d[i + 2] > d[i]) bladeX = x; }
      if (bladeX < 0) continue; rows++;
      const gapX = Math.floor(bladeX / 3) * 3 + 3 + 1; // the native px just right of the blade
      assert.strictEqual(d[(y * 96 + gapX) * 4 + 3], 0, 'blade touches the body at row ' + gy + ' frame ' + f + ' ' + a);
    }
    assert.ok(rows >= 6, 'blade spans the body rows in frame ' + f + ' ' + a);
  }
});
