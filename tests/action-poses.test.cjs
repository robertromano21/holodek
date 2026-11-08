'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../assets/renderCharacterProcedural');
const M = require('../assets/characterMotion3d');

test('combat lines cue attack, pain and death poses that play as timed key frames, then fall back', () => {
  M.clearActions();
  M.cueFromCombatLine('Mortacia hits Ash Wolf for 7 damage', ['Mortacia', 'Ash Wolf'], 1000);
  assert.deepEqual(M.actionFor('Mortacia', 1000, {}), { action: 'attack', frame: 0 });
  assert.equal(M.actionFor('Mortacia', 1000 + M.timingFor('attack')[0] + 10, {}).frame, 1); // after the held wind-up
  assert.equal(M.actionFor('Ash Wolf', 1190, {}).action, 'pain');
  assert.equal(M.actionFor('Mortacia', 5000, { moving: true }).action, 'walk');
  assert.equal(M.actionFor('Mortacia', 5000, {}).action, 'idle');
  M.cueFromCombatLine('Ash Wolf is killed by Mortacia', ['Ash Wolf', 'Mortacia'], 6000);
  assert.equal(M.actionFor('Ash Wolf', 6100, {}).action, 'death');
  assert.deepEqual(M.actionFor('Ash Wolf', 60000, {}), { action: 'death', frame: 3 }); // held on the ground
  M.cueAction('Ash Wolf', 'pain', 61000);
  assert.equal(M.actionFor('Ash Wolf', 61010, {}).frame, 3, 'the dead do not flinch');
  assert.deepEqual(M.actionFor('Nobody', 1, { down: true }), { action: 'death', frame: 3 });
  M.clearActions();
});

test('action poses render for humanoids and four-legged creatures; unsupported plans fall back safely', () => {
  const specs = [C.getPresetProceduralSpec('Mortacia'), C.buildProceduralSpriteSpec({ name: 'Ash Wolf', race: 'Dire Wolf', class: 'Beast', isMonster: true })];
  for (const spec of specs) {
    assert.ok(C.supportsActionPoses(spec));
    const stand = C.renderBillboardPixels(spec, { frame: 0, view: 'side', facing: 1 });
    const dead = C.renderBillboardPixels(spec, { frame: 3, view: 'front', facing: 1, action: 'death' });
    // a felled body lies on the ground: wider than tall, not a scaled-down standing figure
    assert.ok(dead.bounds.maxY - dead.bounds.minY < (stand.bounds.maxY - stand.bounds.minY) * 0.6);
    assert.ok(dead.bounds.maxX - dead.bounds.minX > dead.bounds.maxY - dead.bounds.minY);
    assert.ok(Math.abs(dead.bounds.maxY - stand.bounds.maxY) <= 12, 'lies on the same ground line');
  }
  const ooze = C.buildProceduralSpriteSpec({ name: 'Grey Ooze', race: 'Ooze', class: 'Slime', isMonster: true });
  if (!C.supportsActionPoses(ooze)) assert.ok(C.renderBillboardPixels(ooze, { frame: 0, view: 'front', action: 'attack' }).bounds);
});

test('the world renderer passes the cued action with a walk fallback, and the combat log feeds the cues', () => {
  const r = fs.readFileSync(path.join(__dirname, '../assets/rendererWebGL.js'), 'utf8');
  assert.match(r, /actionFor\?\.\(actor\?\.name, now, \{ moving: !!pick\.moving, down: !!down \}\)/);
  assert.match(r, /action: a \|\| 'walk'/);
  assert.match(r, /catch \(e\) \{ action = 'walk'; animFrame = frame; \}/);
  const s = fs.readFileSync(path.join(__dirname, '../assets/sfx.js'), 'utf8');
  assert.match(s, /CharacterMotion3D\?\.cueFromCombatLine\?\.\(line, namesIn\(line\)/);
});

test('front rest arms are bent and asymmetric, and the front walk alternates legs and moves wings', () => {
  const spec = C.buildProceduralSpriteSpec({ name: 'Cogwright Vell', race: 'Human', class: 'Clockwork Artificer', level: 3, sex: 'male' });
  const p = C.renderProceduralPixels(spec, 0, 'billboard', 'front', true);
  // the arm path leans (elbow out, wrist in): an arm column is not one straight vertical run
  const cols = new Set();
  for (let i = 0; i < 64 * 64; i++) if (p.data[i * 4 + 3] && p.parts[i] === 11) cols.add(i % 64);
  assert.ok(cols.size >= 3, 'bent arm spans columns: ' + cols.size);
  const m = C.getPresetProceduralSpec('Mortacia');
  const f1 = C.renderProceduralPixels(m, 1, 'billboard', 'front'), f3 = C.renderProceduralPixels(m, 3, 'billboard', 'front');
  let diff = 0; for (let i = 3; i < f1.data.length; i += 4) if (f1.data[i] !== f3.data[i]) diff++;
  assert.ok(diff > 20, 'front walk contact frames differ: ' + diff);
});
