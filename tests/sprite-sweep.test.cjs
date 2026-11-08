// Every creature/race keyword, preset and common class renders all 8 views and every action as a hard-alpha figure,
// with a turned side view that differs from the front and a death pose that ends lying low.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../assets/renderCharacterProcedural');
const src = fs.readFileSync(path.join(__dirname, '../assets/renderCharacterProcedural.js'), 'utf8');
const kws = [...new Set([...src.matchAll(/defCre(?:New)?\('([^']+)'/g)].map((m) => m[1].split(' ')[0]))];
const V = [['front', 1], ['threeQuarter', 1], ['side', 1], ['backQuarter', 1], ['back', 1], ['backQuarter', -1], ['side', -1], ['threeQuarter', -1]];
const h = (b) => b.maxY - b.minY + 1, w = (b) => b.maxX - b.minX + 1;
test('creature/race keyword list is non-trivial', () => assert.ok(kws.length > 60, String(kws.length)));
for (const kw of kws) {
  test(`sprite sweep: ${kw} has 8 views and every action pose`, () => {
    const spec = C.buildProceduralSpriteSpec({ name: 'Sweep ' + kw, race: kw, class: 'Fighter', level: 3, isMonster: true });
    for (const action of C.ACTIONS || ['walk', 'idle', 'attack', 'pain', 'death']) for (const [view, facing] of V) {
      const p = C.renderBillboardPixels(spec, { frame: action === 'death' ? 3 : 1, view, facing, action });
      assert.ok(p.bounds, `${action} ${view} ${facing} empty`);
    }
    const front = C.renderBillboardPixels(spec, { frame: 0, view: 'front' });
    const side = C.renderBillboardPixels(spec, { frame: 0, view: 'side', facing: 1 });
    assert.ok(!side.data.every((v, i) => v === front.data[i]), 'side identical to front');
    const dead = C.renderBillboardPixels(spec, { frame: 3, view: 'front', action: 'death' });
    // lying down: the body ends lower or sprawls flatter (winged beasts splay their wings wide)
    assert.ok(h(dead.bounds) <= h(front.bounds) * 0.8 || h(dead.bounds) / w(dead.bounds) <= 0.8 * h(front.bounds) / w(front.bounds), 'death should end lying low');
  });
}

require('./sprite-expansion-cases.cjs')('sweep');
