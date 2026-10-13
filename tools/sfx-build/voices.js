'use strict';
// Wordless character "voices", rendered through real SID (reSIDfp 6581) like the other effects. All pitched clips are in A
// and are transposed in the browser by playbackRate (sfx.js speakVoice()).
//   vox_syl_{a,e,i,o,u}_A : humanoid babble syllable, A3 pulse through a resonant band-pass "vowel" that sweeps (formant-ish)
//   vox_regal_{a,o}_A     : slow, deep regal syllable (A2 saw + A1 pulse, vibrato, low vowel band)
//   vox_growl1/2          : beast growl/snarl (low saw ring-modulated by noisy tri, low-pass opening and closing)
//   vox_whisper1/2, vox_hiss : undead/spirit breath (noise through sweeping band-pass / high-pass)
// Run on the build box: node voices.js <outDir>
const B = require('./buildSfx.js'), { shot, midi, ad, sr, rng } = B, off = { gate: 0 };
const lerp = (a, b, x) => a + (b - a) * Math.max(0, Math.min(1, x));
const VOW = { a: [700, 560], e: [900, 1050], i: [1250, 1400], o: [480, 380], u: [330, 280] };
for (const [v, [c0, c1]] of Object.entries(VOW)) shot('vox_syl_' + v + '_A', 7, t => ({
  v: [{ hz: midi(57) * (1 + (t < 4 ? 0.01 * t : 0.03 - 0.02 * (t - 4))), wave: 'pulse', pw: 1400 + t * 60, gate: t < 5, ad: ad(0, 6), sr: sr(11, 4) },
    { hz: midi(69) * 1.003, wave: 'tri', gate: t < 4, ad: ad(0, 5), sr: sr(6, 3) }, off],
  f: { cut: lerp(c0, c1, t / 6), res: 12, route: 1, mode: 'bp', vol: 15 } }), { tail: 0.12, gain: 0.9 });
for (const [v, c0, c1] of [['a', 520, 420], ['o', 360, 300]]) shot('vox_regal_' + v + '_A', 16, t => { const vib = 1 + Math.sin(t * 1.1) * 0.006;
  return { v: [{ hz: midi(45) * vib, wave: 'saw', gate: t < 12, ad: ad(4, 8), sr: sr(12, 6) },
    { hz: midi(33) * vib, wave: 'pulse', pw: 900, gate: t < 12, ad: ad(5, 8), sr: sr(10, 6) },
    { hz: midi(52) * vib, wave: 'tri', gate: t < 10, ad: ad(6, 6), sr: sr(6, 5) }],
    f: { cut: lerp(c0, c1, t / 15), res: 13, route: 3, mode: 'bp', vol: 15 } }; }, { tail: 0.25, gain: 0.9 });
[['vox_growl1', 3, 34, 55], ['vox_growl2', 11, 24, 70]].forEach(([n, seed, len, base]) => { const r = rng(seed); shot(n, len, t => { const p = t / len, j = r();
  return { v: [{ hz: base * (1 + Math.sin(t * 2.3) * 0.06) * (p < 0.2 ? 0.85 + p : 1.05 - p * 0.2), wave: 'saw', gate: p < 0.8, ad: ad(2, 6), sr: sr(12, 5) },
    { hz: base * 2.02 + j * 30, wave: 'tri', ring: true, gate: p < 0.8, ad: ad(1, 6), sr: sr(10, 5) },
    { hz: 400 + j * 700, wave: 'noise', gate: p < 0.7, ad: ad(1, 6), sr: sr(8, 4) }],
    f: { cut: 120 + Math.sin(p * Math.PI) * 380 + j * 60, res: 10, route: 7, mode: 'lp', vol: 15 } }; }, { tail: 0.2 }); });
[['vox_whisper1', 18, 900, 1500, 'bp'], ['vox_whisper2', 14, 1400, 800, 'bp'], ['vox_hiss', 16, 1700, 1900, 'hp']].forEach(([n, len, c0, c1, mode]) =>
  shot(n, len, t => ({ v: [{ hz: 3200 + Math.sin(t * 1.7) * 900, wave: 'noise', gate: t < len - 5, ad: ad(5, 6), sr: sr(10, 7) }, off, off],
    f: { cut: lerp(c0, c1, t / len) + Math.sin(t * 2.1) * 120, res: 9, route: 1, mode, vol: 15 } }), { tail: 0.2, gain: 0.8 }));
console.log('voices done');
