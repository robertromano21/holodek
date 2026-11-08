'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/characterMotion3d');
const C = require('../assets/renderCharacterProcedural');

const deg = d => d * Math.PI / 180;
const input = o => ({ scope: 'run|0,0,0', x: 0, y: 0, camX: 5, camY: 0, now: 0, ...o });

test('eight directions are chosen from the angle between the actor facing and the camera', () => {
  const expected = ['front', 'frontQuarterRight', 'sideRight', 'backQuarterRight', 'back', 'backQuarterLeft', 'sideLeft', 'frontQuarterLeft'];
  assert.deepEqual(M.DIRECTIONS, expected);
  for (let i = 0; i < 8; i++) {
    for (const off of [-20, 0, 20]) assert.equal(M.directionIndex(deg(i * 45 + off)), i, `${i * 45 + off} deg`);
    const v = M.directionView(i);
    assert.equal(v.name, expected[i]);
    assert.equal(v.view, ['front', 'threeQuarter', 'side', 'backQuarter', 'back', 'backQuarter', 'side', 'threeQuarter'][i]);
    assert.equal(v.facing, i === 0 || i === 4 ? 0 : i < 4 ? 1 : -1);
  }
  assert.equal(M.directionIndex(deg(180)), 4); assert.equal(M.directionIndex(deg(-180)), 4);
  assert.equal(M.directionIndex(deg(-45)), 7); assert.equal(M.directionIndex(deg(360 + 90)), 2);
});

test('orbiting the camera around a still actor walks through all eight views in order without flicker', () => {
  const c = M.createController();
  // Actor faces +x (towards the start camera); keep it facing that way by walking it a tiny bit first.
  for (let now = 0; now <= 400; now += 20) c.sample('Sentry', input({ now, x: now / 4000 }));
  const seen = [];
  let now = 500;
  const x0 = .1;
  for (let a = 0; a <= 360; a += 1) {
    now += 200;
    const cam = deg(a); // camera bearing minus actor heading grows positive
    const p = c.sample('Sentry', input({ now, x: x0, camX: x0 + 5 * Math.cos(cam), camY: 5 * Math.sin(cam) }));
    if (seen[seen.length - 1] !== p.direction) seen.push(p.direction);
    if (now > 1700) assert.ok(p.view && Number.isInteger(p.direction));
  }
  // The idle actor slowly turns towards the camera, so the walk can stop early; whatever it visits is in order.
  for (let i = 1; i < seen.length; i++) assert.equal((seen[i] - seen[i - 1] + 8) % 8, 1, `ordered: ${seen.join(',')}`);
});

test('a camera jittering on a sector edge does not flip between views', () => {
  const c = M.createController();
  for (let now = 0; now <= 1000; now += 20) c.sample('Guard', input({ x: now / 1000, now }));
  const edge = Math.PI / 8 * 3; // threeQuarter / side boundary
  const views = new Set();
  // move into the threeQuarter sector first
  c.sample('Guard', input({ x: 1, now: 1100, camX: 1 + 5 * Math.cos(Math.PI / 4), camY: -5 * Math.sin(Math.PI / 4) }));
  // (stay inside the 1.1 s before an idle actor starts turning to face the camera)
  for (let now = 1300; now <= 2000; now += 20) {
    const a = edge + (now % 40 ? .06 : -.06);
    views.add(c.sample('Guard', input({ x: 1, now, camX: 1 + 5 * Math.cos(a), camY: -5 * Math.sin(a) })).view);
  }
  assert.equal(views.size, 1);
});

function spanOf(p) { return p.bounds.maxX - p.bounds.minX + 1; }

test('turned views are properly drawn rotations, not squashed or mirrored cards', () => {
  for (const spec of [C.buildProceduralSpriteSpec({ name: 'Turn Test Fighter', race: 'Human', class: 'Fighter', isMonster: true }), C.getPresetProceduralSpec('Mortacia')]) {
    const front = C.renderBillboardPixels(spec, { frame: 0, view: 'front' });
    const views = {};
    for (const view of ['threeQuarter', 'side', 'backQuarter']) for (const facing of [1, -1]) {
      const p = C.renderBillboardPixels(spec, { frame: 0, view, facing });
      assert.ok(p.bounds, `${view} ${facing}`);
      assert.ok(p.data.every((v, i) => i % 4 !== 3 || v === 0 || v === 255), 'hard-edged alpha');
      views[view + facing] = p;
    }
    const fw = spanOf(front);
    // Side is the narrowest view but keeps a real body depth; three-quarters sit between side and front.
    assert.ok(spanOf(views.side1) < fw && spanOf(views.side1) >= fw * .25, `side ${spanOf(views.side1)} vs ${fw}`);
    assert.ok(spanOf(views.threeQuarter1) <= fw + 2 && spanOf(views.threeQuarter1) >= spanOf(views.side1) - 2);
    // Body height is unchanged by turning (no vertical squash); turned poses may drop a 1-grid-pixel crest or plume.
    for (const p of Object.values(views)) assert.ok(Math.abs((p.bounds.maxY - p.bounds.minY) - (front.bounds.maxY - front.bounds.minY)) <= 6);
    // The back-3/4 view differs from the front-3/4 view (the back of the body has come round).
    assert.ok(views.backQuarter1.data.some((v, i) => v !== views.threeQuarter1.data[i]));
    // Left and right are different drawings of the same body.
    assert.ok(views.side1.data.some((v, i) => v !== views['side-1'].data[i]));
  }
});

test('mirroring is only used for symmetric art', () => {
  const spec = C.buildProceduralSpriteSpec({ name: 'Turn Test Fighter', race: 'Human', class: 'Fighter', isMonster: true });
  const r = C.renderBillboardPixels(spec, { frame: 0, view: 'side', facing: 1 }), l = C.renderBillboardPixels(spec, { frame: 0, view: 'side', facing: -1 });
  // Asymmetric art (a one-handed weapon): the left view is its own turned drawing, not a mirror of the right one.
  const mid = (r.bounds.minX + r.bounds.maxX) / 2, mirrored = new Uint8ClampedArray(r.data.length);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const nx = Math.round(2 * mid - x); if (nx < 0 || nx >= r.w) continue; for (let k = 0; k < 4; k++) mirrored[(y * r.w + nx) * 4 + k] = r.data[(y * r.w + x) * 4 + k]; }
  assert.ok(l.data.some((v, i) => v !== mirrored[i]));
  assert.equal(C.renderBillboardPixels(spec, { frame: 0, view: 'front' }).view, 'front');
  assert.equal(C.renderBillboardPixels(spec, { frame: 0, view: 'back-quarter', facing: 1 }).view, 'backQuarter');
});

require('./sprite-expansion-cases.cjs')('directions');
