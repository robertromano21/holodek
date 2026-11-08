'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../assets/renderCharacterProcedural');

const spec = C.getPresetProceduralSpec('Mortacia');
const VIEWS = [['front', 1], ['threeQuarter', 1], ['side', 1], ['backQuarter', 1], ['back', 1], ['backQuarter', -1], ['side', -1], ['threeQuarter', -1]];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (d, i, c, tol) => Math.abs(d[i] - c[0]) < tol && Math.abs(d[i + 1] - c[1]) < tol && Math.abs(d[i + 2] - c[2]) < tol;

test('all 8 Mortacia views render with hard alpha and a stable height', () => {
  const hs = VIEWS.map(([view, facing]) => {
    const p = C.renderBillboardPixels(spec, { frame: 0, view, facing });
    for (let i = 3; i < p.data.length; i += 4) assert.ok(p.data[i] === 0 || p.data[i] === 255, view + ' alpha');
    assert.ok(p.bounds, view + ' empty');
    return p.bounds.maxY - p.bounds.minY;
  });
  hs.forEach((h) => assert.ok(Math.abs(h - hs[0]) <= hs[0] * 0.1, 'height drift ' + hs));
});

test('back view shows no face and the wings cover arms and sword', () => {
  const front = C.renderProceduralPixels(spec, 0, 'billboard', 'front');
  const p = C.renderBillboardPixels(spec, { frame: 0, view: 'back', facing: 1 });
  const k = p.w / 64, f = front.face;
  assert.ok(f, 'front render exposes face metrics');
  const skin = f.skin;
  let skinPx = 0;
  for (let y = Math.round(f.top * k); y <= Math.round(f.bottom * k); y++) for (let x = Math.round(p.w / 2 - 5 * k); x < p.w / 2 + 5 * k; x++) {
    const i = (y * p.w + x) * 4; if (p.data[i + 3] && near(p.data, i, skin, 14)) skinPx++;
  }
  assert.ok(skinPx < k * k * 2, 'face skin on back view: ' + skinPx);
  const fb = C.renderBillboardPixels(spec, { frame: 0, view: 'front', facing: 1 }).bounds;
  assert.ok(Math.abs((p.bounds.maxX - p.bounds.minX) - (fb.maxX - fb.minX)) <= 8 * k, 'wings span on back');
  // from behind the wings are nearest the camera: they cover her arms and most of the sword (a tip may peek out)
  const bright = (q) => { let n = 0; for (let i = 0; i < q.data.length; i += 4) if (q.data[i + 3] && q.data[i] + q.data[i + 1] + q.data[i + 2] > 560) n++; return n; };
  const frontBlade = bright(C.renderBillboardPixels(spec, { frame: 0, view: 'front', facing: 1 }));
  assert.ok(bright(p) < frontBlade * 0.6, 'wings cover the sword from behind: ' + bright(p) + ' vs ' + frontBlade);
});

test('turned views are not a rotated card: side width is bounded and differs left/right', () => {
  const w = (v, fc) => { const b = C.renderBillboardPixels(spec, { frame: 0, view: v, facing: fc }).bounds; return b.maxX - b.minX; };
  // winged: wings seen side-on legitimately widen the silhouette, but never past a sane bound
  assert.ok(w('side', 1) <= w('front', 1) * 1.3, 'winged side ' + w('side', 1) + ' vs front ' + w('front', 1));
  assert.ok(w('side', 1) >= w('front', 1) * 0.6, 'winged side keeps wing presence: ' + w('side', 1));
  // wingless humanoids: side stays narrower than front (held weapons keep it above 0.7x, see the 0.45x depth check below)
  const s3 = C.buildProceduralSpriteSpec({ name: 'Sample Knight', race: 'Human', class: 'Fighter', level: 3, sex: 'male' });
  const w3 = (v) => { const b = C.renderBillboardPixels(s3, { frame: 0, view: v, facing: 1 }).bounds; return b.maxX - b.minX; };
  assert.ok(w3('side') < w3('front'), 'wingless side ' + w3('side') + ' vs front ' + w3('front'));
  assert.ok(w('threeQuarter', 1) < w('front', 1));
  const r = C.renderBillboardPixels(spec, { frame: 0, view: 'side', facing: 1 }).data, l = C.renderBillboardPixels(spec, { frame: 0, view: 'side', facing: -1 }).data;
  let diff = 0; for (let i = 3; i < r.length; i += 4) if (r[i] !== l[i]) diff++;
  assert.ok(diff > 100);
});

test('generic humanoid side view keeps real depth and every action renders in all 8 views', () => {
  const s2 = C.buildProceduralSpriteSpec({ name: 'Cogwright Vell', race: 'Human', class: 'Clockwork Artificer', level: 3, sex: 'male' });
  const w = (v, fc) => { const b = C.renderBillboardPixels(s2, { frame: 0, view: v, facing: fc }).bounds; return b.maxX - b.minX + 1; };
  assert.ok(w('side', 1) >= w('front', 1) * 0.45, 'side ' + w('side', 1) + ' vs front ' + w('front', 1));
  ['walk', 'idle', 'attack', 'pain', 'death'].forEach((action) => VIEWS.forEach(([view, facing]) => [0, 1, 2, 3].forEach((frame) => {
    const p = C.renderBillboardPixels(spec, { frame, view, facing, action });
    assert.ok(p.bounds, action + ' ' + view + ' ' + frame);
    for (let i = 3; i < p.data.length; i += 64) assert.ok(p.data[i] === 0 || p.data[i] === 255);
  })));
  // the side walk is a stride, not one pose: contact frames differ from the standing frame
  const a = C.renderBillboardPixels(spec, { frame: 0, view: 'side', facing: 1 }).data, b = C.renderBillboardPixels(spec, { frame: 1, view: 'side', facing: 1 }).data;
  let diff = 0; for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) diff++;
  assert.ok(diff > 200, 'side walk frames differ: ' + diff);
});
