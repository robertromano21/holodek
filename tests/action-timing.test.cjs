'use strict';
// Action playback holds key poses: attack wind-up held and strike fast, pain flinch quick then slower recovery,
// death starts slow, falls fast and holds on the ground; a broken timing table falls back to even frames.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../assets/characterMotion3d');

const frameAt = (name, kind, ms) => { M.clearActions(name); M.cueAction(name, kind, 1000); return M.actionFor(name, 1000 + ms, {}); };

test('attack: wind-up held longer than the fast strike, then follow-through and settle', () => {
  const t = M.timingFor('attack');
  assert.strictEqual(t.length, 4);
  assert.ok(t[0] > t[1] * 2, 'wind-up ' + t[0] + ' vs strike ' + t[1]);
  assert.ok(t[2] > t[1] && t[3] > t[1]);
  assert.deepStrictEqual(frameAt('a', 'attack', 10), { action: 'attack', frame: 0 });
  assert.strictEqual(frameAt('a', 'attack', t[0] + 5).frame, 1);
  assert.strictEqual(frameAt('a', 'attack', t[0] + t[1] + 5).frame, 2);
  assert.strictEqual(frameAt('a', 'attack', t[0] + t[1] + t[2] + t[3] + 5).action, 'idle');
});

test('pain: quick flinch, slower recovery', () => {
  const t = M.timingFor('pain');
  assert.ok(t[0] < t[t.length - 1]);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] >= t[i - 1]);
  assert.strictEqual(frameAt('p', 'pain', 5).frame, 0);
});

test('death: slow start, fast fall, holds on the ground', () => {
  const t = M.timingFor('death');
  assert.ok(t[0] > t[1] && t[0] > t[2], 'buckle ' + t[0] + ' slower than the fall ' + t[1] + '/' + t[2]);
  assert.strictEqual(t[t.length - 1], Infinity);
  assert.deepStrictEqual(frameAt('d', 'death', 60 * 60 * 1000), { action: 'death', frame: 3 });
});

test('a broken timing table falls back to even frames', () => {
  const saved = M.ACTION_TIMING.attack;
  try {
    M.ACTION_TIMING.attack = [100, NaN, -5];
    assert.deepStrictEqual(M.timingFor('attack'), M.EVEN_TIMING.attack);
    const r = frameAt('b', 'attack', 150);
    assert.deepStrictEqual(r, { action: 'attack', frame: 1 });
    M.ACTION_TIMING.attack = null;
    assert.deepStrictEqual(M.timingFor('attack'), M.EVEN_TIMING.attack);
  } finally { M.ACTION_TIMING.attack = saved; M.clearActions(); }
});
