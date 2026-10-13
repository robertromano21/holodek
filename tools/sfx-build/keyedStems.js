'use strict';
// Key-neutral pitched ambience stems, all in A, transposed in the browser by playbackRate (at most 6 semitones):
//   amb_drone_A : chant drone, A2 saw + E3 pulse (tonic + fifth) over an A1 triangle pedal, moving vowel band-pass
//   amb_drip_A  : one water drip "plink" on A5 (held 6 frames, then a slight downward chirp)
//   amb_howl_A  : one distant howl, rising from G4 to A4, vibrato, falling away
const B = require('./buildSfx.js');
const { shot, loop, midi, ad, sr } = B, off = { gate: 0 };
loop('amb_drone_A', 16, t => { const x = t / 50;
  return { v: [{ hz: midi(45) * (1 + Math.sin(x * 5.5) * 0.003), wave: 'saw', gate: true, ad: ad(10, 0), sr: sr(12, 0) },
    { hz: midi(52) * 1.002, wave: 'pulse', pw: 1000 + Math.sin(x * 0.8) * 400, gate: true, ad: ad(11, 0), sr: sr(10, 0) },
    { hz: midi(33), wave: 'tri', gate: true, ad: ad(12, 0), sr: sr(10, 0) }],
    f: { cut: 270 + Math.sin(x * 0.9) * 80 + Math.sin(x * 0.37) * 50, res: 13, route: 3, mode: 'bp', vol: 15 } }; }, { gain: 0.8 });
shot('amb_drip_A', 14, t => ({ v: [{ hz: midi(81) * (t < 6 ? 1 : 1 - (t - 6) * 0.01), wave: 'tri', gate: t < 1, ad: ad(0, 5), sr: sr(0, 6) }, off, off] }), { tail: 0.3 });
shot('amb_howl_A', 125, t => { const p = t / 125, base = midi(69);
  const hz = base * Math.pow(2, (p < 0.3 ? -2 + p / 0.3 * 2 : p > 0.75 ? -(p - 0.75) * 12 : 0) / 12) * (1 + Math.sin(t * 0.9) * 0.008);
  return { v: [{ hz, wave: 'tri', gate: p < 0.72, ad: ad(11, 9), sr: sr(12, 10) },
    { hz: hz * 1.5, wave: 'pulse', pw: 300, gate: p < 0.5, ad: ad(12, 9), sr: sr(6, 10) }, off],
    f: { cut: 350 + Math.sin(p * Math.PI) * 300, res: 8, route: 3, mode: 'lp', vol: 15 } }; }, { tail: 0.8 });
console.log('keyed stems done');
