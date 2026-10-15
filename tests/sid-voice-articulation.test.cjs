'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { analyse, analyseNoise, SR, HOP } = require('../retort/sidVoice/analyse');
const Articulation = require('../retort/sidVoice/articulation'), Voc = require('../retort/sidVoice/voc64');
const spectral = (level = -4) => Array.from({ length: 128 }, (_, k) => level - ((k - 22) / 30) ** 2);
const harmonic = n => Array.from({ length: n }, () => [150, spectral(), new Array(13).fill(0.1)]);
test('8 ms descriptors track a short burst without the 32 ms spectral smear', () => {
  const x = new Float32Array(Math.round(SR * 0.2)); let seed = 123;
  for (let k = Math.round(SR * 0.08); k < Math.round(SR * 0.085); k++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; x[k] = (seed / 2147483648 - 1) * 0.5; }
  const long = analyse(x), short = analyseNoise(x);
  assert.equal(long.length, short.length);
  for (const f of short) { assert.equal(f.env.length, 128); assert.ok(f.env.every(Number.isFinite)); assert.ok(Number.isFinite(f.high)); }
  const peak = Math.max(...short.map(f => f.high)), active = short.map((f, i) => f.high > peak * 0.1 ? i : -1).filter(i => i >= 0);
  assert.ok(active.length * HOP / SR < 0.015);
  const early = Math.round(0.065 * SR / HOP); assert.ok(Math.max(...long[early][1]) > Math.max(...short[early].env) + 1);
});
test('short spectra retain the long-window stationary noise level', () => {
  let seed = 42; const x = Float32Array.from({ length: SR / 2 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 2147483648 - 1) * 0.1; });
  const long = analyse(x), short = analyseNoise(x); let a = 0, b = 0;
  for (let i = 12; i < long.length - 12; i++) for (let k = 10; k < 110; k++) { a += Math.exp(2 * long[i][1][k]); b += Math.exp(2 * short[i].env[k]); }
  const db = 10 * Math.log10(b / a); assert.ok(Math.abs(db) < 2, String(db));
});
test('vowels and silence do not acquire a short-window noise layer', () => {
  const fr = Array.from({ length: 80 }, () => ({ env: spectral(), rms: 0.1, high: 1 }));
  const p = Articulation.plan(fr, [{ c: 'a', t0: 0, t1: 0.2 }]), f = harmonic(1)[0];
  assert.ok(p.mix.every(x => x === 0)); assert.equal(Articulation.frameAt(fr, p, 20, f), f);
  const silent = fr.map(f => ({ ...f, rms: 0, high: 0 }));
  const q = Articulation.plan(silent, [{ c: 'g', t0: 0.02, t1: 0.08 }, { c: 's', t0: 0.08, t1: 0.15 }]);
  assert.equal(q.bursts.length, 0); assert.ok(q.mix.every(x => x === 0));
});
test('measured bursts have bounded windows and fricative edges crossfade', () => {
  const fr = Array.from({ length: 80 }, (_, i) => ({ env: spectral(), rms: i < 18 ? 0 : 0.1, high: i < 18 ? 0 : 1 }));
  const p = Articulation.plan(fr, [{ c: '\u0261', t0: 0.02, t1: 0.06 }, { c: 's', t0: 0.1, t1: 0.15 }]);
  assert.deepEqual(p.bursts[0], [18, 26]); assert.equal(p.mix[18], 0.5); assert.equal(p.mix[19], 1);
  assert.equal(p.mix[40], 0.5); assert.equal(p.mix[59], 0.5); assert.equal(p.mix[60], 0);
});
test('stress timing warps both analysis tracks with the same indices', () => {
  const frames = harmonic(80), noiseFrames = frames.map((_, i) => ({ env: spectral(), rms: i, high: i }));
  const item = { frames, noiseFrames, phones: [{ c: '\u02c8', t0: 0, t1: 0 }, { c: 'a', t0: 0.01, t1: 0.15 }] };
  const warped = Voc.stressTiming(item);
  assert.equal(warped.frames.length, warped.noiseFrames.length);
  warped.frames.forEach((f, i) => assert.equal(warped.noiseFrames[i], noiseFrames[frames.indexOf(f)]));
});
test('held-vowel vibrato clock advances; disabling it remains deterministic', () => {
  const item = { frames: harmonic(200), mode: '2x', final: '.', P: { name: 'Test', f0: 150, fs: 1, range: 3.2, breath: 0, rasp: 0, vibAmt: 0, vibRate: 5 } };
  const a = Voc.voice(item), b = Voc.voice({ ...item, P: { ...item.P, vibAmt: 1 } }); let differences = 0;
  for (let n = 0; n < 350; n++) { const x = a.ticks(n), y = b.ticks(n);
    const freq = row => row.filter(w => w[0] === 1 && (w[1] === 0 || w[1] === 1));
    if (JSON.stringify(freq(x)) !== JSON.stringify(freq(y))) differences++;
  }
  assert.ok(differences > 10);
});
test('8580 ignores the new descriptors; injected PCM cannot enable digi playback', () => {
  const frames = harmonic(24), item = { frames, mode: '1x', chip: '8580', final: '.', P: { name: 'Test', f0: 150, fs: 1, range: 3.2, breath: 0, rasp: 0, vibAmt: 0 } };
  const a = Voc.render(item), b = Voc.render({ ...item, noiseFrames: frames.map(() => ({ env: spectral(0), rms: 1, high: 1 })), phones: [], audio: new Float32Array(1000).fill(1), digi: { mix: 'full' } });
  assert.deepEqual(a, b); assert.ok(a.every(Number.isFinite));
});
test('10582 detail controls change noise synthesis without changing timing or admitting PCM', () => {
  const frames = harmonic(48), noiseFrames = frames.map((_, i) => ({ env: spectral(i < 12 ? -15 : -3), rms: i < 12 ? 0 : 0.1, high: i < 12 ? 0 : 1 }));
  for (const mode of ['1x', '2x', '4x']) {
    const item = { frames, noiseFrames, mode, chip: '10582', final: '.', phones: [{ c: 'g', t0: 0.015, t1: 0.045 }, { c: 's', t0: 0.05, t1: 0.09 }],
      P: { name: 'Test', f0: 150, fs: 1, range: 3.2, breath: 0, rasp: 0, vibAmt: 0 } };
    const detail = Voc.render(item), injected = Voc.render({ ...item, audio: new Float32Array(1000).fill(1), digi: { mix: 'full' } });
    const legacy = Voc.render({ ...item, noiseFrames: null });
    assert.deepEqual(detail, injected); assert.equal(detail.length, legacy.length);
    assert.ok(detail.every(Number.isFinite)); assert.ok(detail.articulation.activeFrames > 0);
    assert.ok(detail.some((v, i) => Math.abs(v - legacy[i]) > 1e-7));
  }
});
