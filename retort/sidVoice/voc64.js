'use strict';
// 64-SID HNM vocoder: drives the jsid multi-SID bank from an analysed speech track (f0, harmonic envelope, band aperiodicity).
// Every sample still comes from SID oscillators (triangle/saw/noise), SID ADSR and the SID filter; registers at 400 Hz.
// Layout: SID1 sub-octave rasp | SID2-45 harmonics 1..44 (triangle, LP; 3 phase-locked voices/chip -> 45 amplitude steps)
//         SID46-51 high voiced bands 4.2-8.2 kHz (saw at bf/2, BP picks its 2nd partial = true harmonic of f0)
//         SID52-64 13 LFSR noise bands 0.6-9.3 kHz (BP; aspiration, breath, frication; level = envelope x aperiodicity)
const { MultiSid, CLK, cutHz: cutHzJ } = require('./jsid.js'), fs = require('fs');
const HZ = +(process.env.SIDVOICE_HZ || 800), FHZ = 400, SR = 22050, NB = 128, BANDS = [600, 900, 1300, 1800, 2400, 3000, 3700, 4500, 5300, 6200, 7200, 8200, 9300], HB = [4200, 4800, 5500, 6300, 7200, 8200];
const CAL = [[60, 389], [100, 630], [150, 1015], [220, 1455], [300, 2200], [400, 2653], [550, 3541], [700, 5085], [900, 6181], [1100, 7877], [1400, 8999], [1700, 10627]];
const cutReg0 = hz => { if (hz <= CAL[0][1]) return Math.max(3, Math.round(60 * hz / 389)); for (let i = 1; i < CAL.length; i++) if (hz <= CAL[i][1]) { const [r0, f0] = CAL[i - 1], [r1, f1] = CAL[i]; return Math.round(r0 + (r1 - r0) * (hz - f0) / (f1 - f0)); } return 1700; };
// Clock modes. stock = real PAL SID (985 kHz: oscillators top out at ~3.9 kHz with usable 16-bit steps, filter 30 Hz-12 kHz).
// enhanced = the SAME emulated chip clocked at 2x PAL (1.97 MHz): oscillators reach ~7.8 kHz and the filter cutoff range doubles.
// Not a stock C64 configuration (overclocked SID), rendered at 44.1 kHz so the extra range is not aliased.
// 4x = 3.94 MHz: oscillators to ~15.6 kHz (44.1 kHz render, Nyquist 22 kHz). Voices are analysed from 22.05 kHz Piper audio,
// so speech content stops at ~11 kHz: in 4x the voice harmonic ceiling is 10.5 kHz (the chip could go higher; the source can't).
const MODES = { '1x': { name: '1x', mult: 1, clk: CLK, sr: 22050, cut: 1, maxHz: 3840 }, '2x': { name: '2x', mult: 2, clk: CLK * 2, sr: 44100, cut: 2, maxHz: 7680 },
  '4x': { name: '4x', mult: 4, clk: CLK * 4, sr: 44100, cut: 4, maxHz: 10500 } };
MODES.stock = MODES['1x']; MODES.enhanced = MODES['2x'];
const modeOf = m => MODES[m] || MODES[String(process.env.SIDVOICE_CLOCK || '').toLowerCase()] || MODES['1x'];
const K = Object.assign({ gam: 0.6, gN: 0.6, gH: 4, slew: 10, rng: 1, jit: 0.0025, shim: 0.02, vib: 0.002, jitW: 0, gNh: 6, gNhE: 3, rel: 0, att: 0, room: 0.15, roomT: 0.35, phase: +(process.env.SIDVOICE_PHASE ?? 1), det: 2, roomCut: 0.03, digiN: 0.15, digiV: 0.0, digiG: 1, gapMin: 4, gapAp: 0.4, bassHz: 300, bassFl: 0.15, bassSm: 0.88, bassG: 0.92, gamH: 0.8, gamH1: 0.7, hwR: 0.92, hwA: 0.3, cjit: 0.006, cshim: 0.02, flk: 0.005, tilt: 0, tiltF: 1500, nV: 1, deHold: 1, cphase: 0.25, asp: 0.5, disp: +(process.env.SIDVOICE_DISP ?? 1), tri3: 1, raspF: 160, ldisp: 1, ldet: 2.5, lcph: 3.2, form: +(process.env.SIDVOICE_FORM ?? 0), fres: 9, fG: 1, fx: 1100, fsm: 0.85, fof: +(process.env.SIDVOICE_FOF ?? 0), fofA: 0.12, fofT: 0.35, fofF: 0.25, sync: +(process.env.SIDVOICE_SYNC ?? 0), sRing: 0, sG: 1.5, sRes: 6, sMode: 0x20, tf: +(process.env.SIDVOICE_TFOF ?? 0), tfA: 0.0008, tfBW: 1, tfG: 1, tfN: 5, tfGam: 0.7, tfV: 0, tfLP: 1.6, tfE: 0, tfGate: 0.002, slewN: 45, clos: 0.006,
  // voicefix pass: aperiodicity-gated noise chips, voiced HF roll-off, gentler slews, line fades/tails
  gNv: 0.45, apV0: 0.85, apV1: 1.0, brV: 0.1, nFloor: 0.004, vtilt: 1.6, vtF: 2600, slewV: 5, slewNv: 16, closSl: 12, tailF: 120, fadeMs: 20, bFloor: 0, consAp: 0.8, vbar: 1, stressL: 1.3, postS: 0.8, unstrS: 0.92, onW: 0.6, onMs: 20, pkPad: 10, pkVar: 0.5, relV: 3 /* ADSR release ~72 ms: harmonic chips decay into pauses instead of stepping to digital zero */ }, JSON.parse(process.env.SIDVOICE_K || '{}'));
const VFIX = (process.env.SIDVOICE_VFIX ?? '1') !== '0'; // 0 = pre-voicefix behaviour (A/B)
const CONTOUR = String(process.env.SIDVOICE_CONTOUR || 'b').toLowerCase(); // a = Piper F0 only, b = smooth contour (default), c = b + speaking-scale snap
let X10 = String(process.env.SIDVOICE_CHIP || '8580') === '10582', X10F = String(process.env.SIDVOICE_X10F || 'lvl,mute,fmt'), XL = X10 && X10F.includes('lvl'), XM = X10 && X10F.includes('mute'), XN = X10 && X10F.includes('fenv'), XF = X10 && X10F.includes('fmt'); // 10582 extended chip (jsid.js), voice only: SIDVOICE_CHIP=10582 (default 8580); features SIDVOICE_X10F (default lvl,mute,fmt; fenv opt-in)
let NOTCH = String(process.env.SIDVOICE_CHIP || '8580') === '10582' && process.env.SIDVOICE_NOTCH === '1'; const BEDGE = process.env.SIDVOICE_BURST_EDGE !== '0', BEB = +(process.env.SIDVOICE_BURST_EDGE_BIAS_MS || 0) / 1000, BFG = +(process.env.SIDVOICE_BURST_FORM_G || 1); /* 10582 NOISEFORM burst edge (default on; SIDVOICE_BURST_EDGE=0 disables) */ const NOISEFORM = process.env.SIDVOICE_NOISEFORM !== '0', LINEAR = process.env.SIDVOICE_LINEAR === '1'; /* 10582 only: NOISEFORM (default on, SIDVOICE_NOISEFORM=0 disables) = movable noise formants on bursts/frication (formant voices on noise, $1F-$23); LINEAR (default off) = 8-bit level from linear amplitude, no gamma, short release */ /* 10582 output notch on /l/ (default off) */
const CLOCKFIX = (process.env.SIDVOICE_CLOCKFIX ?? '1') !== '0'; // tick clock fix: MultiSid plays exactly HZ updates/s (was round(sr/HZ) samples per tick: 2450 instead of 2400 -> speech ~2% fast vs the analysis)
const CONS = VFIX && (process.env.SIDVOICE_CONS ?? '1') !== '0', Cons = require('./cons'); // consonant model (place cues), see cons.js
const PULL = process.env.SIDVOICE_PULL !== undefined ? +process.env.SIDVOICE_PULL : 0; // optional scale pull in contour b (0 = off)
const K_BASE = K, HZ_BASE = HZ;
// Best-known in-game default (v20): MALE (Ryan-guided) voices at 2x/4x use the true-FOF blend 0.25 at a 2400 Hz register rate
// (lab: male clarity 93/91 vs 88, buzz ~equal). Female voices and 1x stay on the plain vocoder at 800 Hz. SIDVOICE_BEST=0 disables.
const BEST = { hz: 2400, k: { tf: 0.25, tfG: 5, tfBW: 0.6, tfGam: 0.5 } };
// round4 (R4B): optional lighter true-FOF blend for female (LJSpeech-guided) voices at 2x/4x (SIDVOICE_FOFF=0.15). Tested and
// left OFF by default: target words did not move, mean score fell and voiced HF/large jumps rose slightly.
const BEST_F = { hz: 2400, k: { tf: +(process.env.SIDVOICE_FOFF ?? 0), tfG: 5, tfBW: 0.6, tfGam: 0.5 } };
const bestOf = item => { if ((process.env.SIDVOICE_BEST ?? '1') === '0' || process.env.SIDVOICE_HZ || !item.P || !['2x', '4x'].includes(modeOf(item.mode).name)) return null;
  if (item.P.guide === 'ryan') return BEST; return item.P.guide === 'lj' && BEST_F.k.tf > 0 ? BEST_F : null; };
let CUR = MODES.stock; const hz2reg = hz => Math.max(0, Math.min(65535, Math.round(hz * 16777216 / CUR.clk))), cutReg = hz => { if (CUR.cut === 1) return cutReg0(hz); // enhanced: jsid maps reg r -> cutHz(r) * (1 + (cut-1) r/2047); invert by bisection
  let lo = 0, hi = 2047; while (lo < hi) { const m = (lo + hi) >> 1; if (cutHzJ(m) * (1 + (CUR.cut - 1) * m / 2047) < hz) lo = m + 1; else hi = m; } return lo; };
function cleanF0(src) { // fill <=20 ms voicing dropouts and fold isolated octave errors back (pitch-tracker artifacts -> warble)
  const fr = src.map(f => [f[0], f[1], f[2]]), n = fr.length;
  for (let i = 1; i < n; i++) if (fr[i][0] <= 0 && fr[i - 1][0] > 0) { let j = i; while (j < n && fr[j][0] <= 0) j++;
    let apG = 0; for (let k = i; k < j && k < n; k++) apG += (fr[k][2][0] + fr[k][2][1] + fr[k][2][2]) / 3; apG /= Math.max(1, Math.min(j, n) - i);
    // bridge only pitch-tracker dropouts: short gaps, or gaps that are still periodic (low aperiodicity). Real voiceless consonants
    // (s, t, k, f...) are no longer bridged, so harmonic chips stop buzzing through them (was 13.5% of voiceless frames).
    if (j < n && (j - i <= K.gapMin || (j - i <= (+process.env.SIDVOICE_GAP || 16) && apG < K.gapAp))) for (let k = i; k < j; k++) { const u = (k - i + 1) / (j - i + 1); fr[k][0] = Math.exp(Math.log(fr[i - 1][0]) * (1 - u) + Math.log(fr[j][0]) * u); } i = j; }
  for (let i = 4; i < n - 4; i++) { const f = fr[i][0]; if (f <= 0) continue; const nb = [fr[i - 4][0], fr[i + 4][0]].filter(x => x > 0); if (nb.length < 2) continue;
    const ref = Math.sqrt(nb[0] * nb[1]), r = Math.log2(f / ref); if (Math.abs(r) > 0.6) fr[i][0] = f * Math.pow(2, -Math.round(r)); }
  if (K.deHold) { // the analysis F0 is sample-and-hold (~9-frame plateaus = audible register stepping): re-draw it as a smooth
    // log-linear line through the plateau centres inside each voiced stretch
    for (let i = 0; i < n;) { if (fr[i][0] <= 0) { i++; continue; } let j = i; while (j < n && fr[j][0] > 0) j++;
      const A = []; for (let a = i; a < j;) { let b = a; while (b + 1 < j && Math.abs(fr[b + 1][0] - fr[a][0]) < 1e-6) b++; A.push([(a + b) / 2, Math.log(fr[a][0])]); a = b + 1; }
      if (A.length > 1) for (let k = i, q = 0; k < j; k++) { while (q < A.length - 2 && A[q + 1][0] < k) q++; const [x0, y0] = A[q], [x1, y1] = A[q + 1], u = Math.max(-0.5, Math.min(1.5, (k - x0) / (x1 - x0 || 1)));
        fr[k][0] = Math.exp(y0 + (y1 - y0) * u); }
      i = j; } }
  return fr;
}
// Speaking 'scale': every character's intonation gravitates to its own pitch targets (semitones re its median), with varied
// accent heights per voiced stretch, declination across the line and a phrase-final fall (or rise on questions).
const SCALES = [[0, 2, 4, 7, 9], [0, 3, 5, 7, 10], [0, 2, 3, 5, 7, 9, 10], [0, 2, 4, 6, 8, 10], [0, 2, 5, 7, 9]];
// voicefix contour: continuous intonation from Piper's own F0 (smoothed), widened if Piper is too flat, plus declination,
// ONE stress peak (espeak primary stress, longest = focus), smooth per-syllable stress shaping (SIDVOICE_SYLAMT), sentence
// cadence (statement / wh / command fall, yes-no rise), continuation rises, mood as a level offset. No scale snapping and no
// forced neighbour steps (mode c re-adds the old scale snap for A/B; SIDVOICE_PULL adds an optional light pull in b).
function sylSplit(fr, segs) { const n = fr.length, en = fr.map(f => { let m = -99; for (const x of f[1]) if (x > m) m = x; return m; }), es = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = Math.max(0, i - 6); k <= Math.min(n - 1, i + 6); k++) { s += en[k]; c++; } es[i] = s / c; }
  const sy = []; segs.forEach(([a, b], si) => { const cut = [a];
    for (let i = a + 20; i < b - 20; i++) if (es[i] <= es[i - 1] && es[i] < es[i + 1] && i - cut[cut.length - 1] >= 36) {
      let pl = -99, pr = -99; for (let k = cut[cut.length - 1]; k < i; k++) pl = Math.max(pl, es[k]); for (let k = i; k < Math.min(b, i + 60); k++) pr = Math.max(pr, es[k]);
      if (Math.min(pl, pr) - es[i] > 0.35 && b - i >= 30) cut.push(i); }
    cut.push(b); for (let q = 0; q + 1 < cut.length; q++) sy.push([cut[q], cut[q + 1], si]); });
  return sy; }
function contour(fr, P, rs0, med, final, cad, syl, mode) {
  const mShift = P.moodF0 || 0, mRange = P.moodRange ?? 1, n = fr.length, v = fr.map(f => f[0] > 0), st = new Float64Array(n);
  for (let i = 0; i < n; i++) if (v[i]) st[i] = 12 * Math.log2(fr[i][0] / med) * rs0 * mRange;
  const segs = []; for (let i = 0; i < n;) { if (!v[i]) { i++; continue; } let j = i; while (j < n && v[j]) j++; segs.push([i, j]); i = j; }
  const out = fr.map(f => [f[0], f[1], f[2]]); if (!segs.length) return out;
  const W = 48, sm = new Float64Array(n); for (const [a, b] of segs) for (let i = a; i < b; i++) { let s = 0, c = 0; for (let k = Math.max(a, i - W); k < Math.min(b, i + W); k++) { s += st[k]; c++; } sm[i] = s / c; }
  if (mode === 'a') { for (const [a, b] of segs) for (let i = a; i < b; i++) out[i][0] = P.f0 * Math.pow(2, st[i] / 12); return out; }
  // widen a too-flat Piper line to the character's range (range 3.2 -> ~6 st p5-p95)
  const vs = []; for (const [a, b] of segs) for (let i = a; i < b; i++) vs.push(sm[i]); vs.sort((x, y) => x - y);
  const R = vs[Math.floor(vs.length * 0.95)] - vs[Math.floor(vs.length * 0.05)], want = 1.9 * P.range * mRange, wid = Math.max(1, Math.min(2, want / Math.max(0.5, R)));
  const accent = (P.accent ?? 1.4) * (P.accentMul ?? 1), decl = (P.decl ?? 2) * (P.declMul ?? 1), off = new Float64Array(n);
  const t0 = segs[0][0], t1 = segs[segs.length - 1][1];
  for (let i = 0; i < n; i++) off[i] = mShift - decl * Math.max(0, Math.min(1, (i - t0) / Math.max(1, t1 - t0))) + (P.arch || 0) * Math.sin(Math.PI * Math.max(0, Math.min(1, (i - t0) / Math.max(1, t1 - t0))));
  const bump = (a, b, h, pad = 16) => { const A = Math.max(0, a - pad), B = Math.min(n, b + pad); for (let i = A; i < B; i++) off[i] += h * Math.sin(Math.PI * (i - A) / Math.max(1, B - A)); };
  // syllables + espeak stress
  const sy = sylSplit(fr, segs), N = sy.length, M = syl && syl.length ? syl : null, amt = +(process.env.SIDVOICE_SYLAMT || 0.15), SYL = (process.env.SIDVOICE_SYLL ?? '1') !== '0';
  const sOf = k => M ? M[Math.round(N > 1 ? k * (M.length - 1) / (N - 1) : 0)] : 0;
  let pk = -1, pl = 0; sy.forEach(([a, b], k) => { if (sOf(k) === 2 && b - a >= pl) { pl = b - a; pk = k; } }); // longest primary-stress syllable = focus
  if (pk < 0 && N) { pk = 0; sy.forEach(([a, b], k) => { if (b - a > sy[pk][1] - sy[pk][0]) pk = k; }); }
  if (SYL) sy.forEach(([a, b], k) => { const s = sOf(k); if (k !== pk) bump(a, b, (s === 2 ? 1.0 : s === 1 ? 0.4 : -0.35) * Math.max(1, accent * 0.8) * amt * 2); });
  // round4 (R4A): narrower stress peak (sin^2 window, K.pkPad frames = 25 ms pad) and its height varied per line (seeded, x0.75..1.25)
  const R4A = (process.env.SIDVOICE_R4A ?? '1') !== '0'; let lh = 2166136261; for (const ch of String(P.name) + '|' + n + '|' + (M ? M.join('') : '')) lh = Math.imul(lh ^ ch.charCodeAt(0), 16777619); lh = (lh >>> 0) / 4294967296;
  if (pk >= 0 && R4A) { const h = 2.2 * Math.max(1, accent * 0.8) * (cad === 'excl' ? 1.4 : 1) * (1 + K.pkVar * (lh - 0.5)), A = Math.max(0, sy[pk][0] - K.pkPad), B = Math.min(n, sy[pk][1] + K.pkPad);
    for (let i = A; i < B; i++) off[i] += h * Math.sin(Math.PI * (i - A) / Math.max(1, B - A)) ** 2; }
  else if (pk >= 0) bump(sy[pk][0], sy[pk][1], 2.2 * Math.max(1, accent * 0.8) * (cad === 'excl' ? 1.4 : 1), 24);
  // continuation rises before >=100 ms pauses
  segs.forEach(([a, b], si) => { if (si < segs.length - 1 && segs[si + 1][0] - b >= 40) { const L = Math.min(40, b - a); for (let i = b - L; i < b; i++) off[i] += 1.0 * (i - (b - L)) / L; } });
  // final cadence over the last ~400 ms of voicing
  { const [a, b] = segs[segs.length - 1], L = Math.min(160, Math.max(40, b - a)), q = cad === 'yn' || (final === '?' && cad !== 'wh');
    const amp = (q ? 4.5 : cad === 'wh' ? -3 : cad === 'cmd' ? -3.5 : cad === 'excl' ? -2 : -3) + (P.finalAdd || 0);
    for (let i = b - L; i < b; i++) { const u = (i - (b - L)) / L; off[i] += amp * Math.pow(u, 1.5); } }
  const k = 20, offS = new Float64Array(n); { let acc = 0; for (let i = 0; i < n; i++) { acc += off[i] - (i >= k ? off[i - k] : 0); offS[i] = acc / Math.min(k, i + 1); } }
  const sc = P.scale || SCALES[(P.scaleIdx ?? 0) % SCALES.length], deg = []; for (let o = -2; o <= 1; o++) for (const d of sc) deg.push(o * 12 + d);
  const pull = mode === 'c' ? (P.pull ?? 0.3) : PULL;
  for (const [a, b] of segs) for (let i = a; i < b; i++) { let y = sm[i] * wid + offS[i]; const fine = (st[i] - sm[i]) * wid * (P.fineKeep ?? 0.8);
    if (pull > 0 || mode === 'c') { let j = 0; while (j < deg.length - 2 && deg[j + 1] <= y) j++; const d0 = deg[j], d1 = deg[j + 1], u = Math.max(0, Math.min(1, (y - d0) / (d1 - d0)));
      y = d0 + (u - pull * Math.sin(2 * Math.PI * u) / (2 * Math.PI)) * (d1 - d0); }
    if (process.env.SIDVOICE_QSTAT) { const z = y + fine; let md = 99; for (const d of deg) md = Math.min(md, Math.abs(z - d)); const q = STATS.q || (STATS.q = [0, 0]); q[1]++; if (md < 0.15) q[0]++; }
    out[i][0] = P.f0 * Math.pow(2, (y + fine) / 12); }
  return out;
}
function intonation(fr, P, rs0, med, final, rnd, cad, syl) {
  if (VFIX) return contour(fr, P, rs0, med, final, cad, syl, CONTOUR);
  const mShift = P.moodF0 || 0, mRange = P.moodRange ?? 1;
  if (process.env.SIDVOICE_INTON) P = Object.assign({}, P, JSON.parse(process.env.SIDVOICE_INTON));
  const n = fr.length, st = new Float64Array(n), v = fr.map(f => f[0] > 0);
  for (let i = 0; i < n; i++) if (v[i]) st[i] = 12 * Math.log2(fr[i][0] / med) * rs0 * mRange;
  const sc = P.scale || SCALES[(P.scaleIdx ?? 0) % SCALES.length], deg = []; for (let o = -2; o <= 1; o++) for (const d of sc) deg.push(o * 12 + d);
  const pull = P.pull ?? 0.3, accent = (P.accent ?? 1.4) * (P.accentMul ?? 1) * (cad === 'excl' ? 1.5 : 1), decl = (P.decl ?? 2) * (P.declMul ?? 1), W = +(P.W || 48); // W: 60 ms smoothing at 400 Hz frames
  const segs = []; for (let i = 0; i < n;) { if (!v[i]) { i++; continue; } let j = i; while (j < n && v[j]) j++; segs.push([i, j]); i = j; }
  const off = new Float64Array(n); let prev = 0, lastVoiced = segs.length ? segs[segs.length - 1] : null;
  segs.forEach(([a, b], si) => { let o = (rnd() - 0.5) * 2 * accent; if (Math.abs(o - prev) < 0.6) o += o >= prev ? 0.8 : -0.8; prev = o; // no repeated identical accent
    const tl = a / Math.max(1, n); o -= decl * tl; const last = si === segs.length - 1;
    // sentence-type cadence (statement / yes-no / wh-question / command / exclamation) + continuation rises before pauses
    if (si === 0) o += cad === 'wh' ? 2.5 : cad === 'cmd' ? 2.5 : cad === 'excl' ? 1.5 : 0;
    if (cad === 'excl' && si === Math.floor(segs.length / 3)) o += 3;
    if (last) o += (cad === 'yn' ? 3 : cad === 'wh' ? -2 : cad === 'cmd' ? -2.5 : cad === 'excl' ? -1 : (final === '?' ? 3 : -1.5)) + (P.finalAdd || 0);
    else if (segs[si + 1][0] - b >= 40) o += 1.2; // >=100 ms pause after this stretch: comma/list continuation rise
    o += mShift;
    o += (P.arch || 0) * Math.sin(Math.PI * Math.min(1, (a + b) / 2 / Math.max(1, n))); // phrase-level melodic arch (sing-y)
    if (P.emphSt && segs.length > 2) { const L = b - a, mean = segs.reduce((s, q) => s + q[1] - q[0], 0) / segs.length; if (L > 1.5 * mean) o += P.emphSt * Math.min(1.5, L / mean - 1); } // focus words (lengthened in Piper) peak higher
    for (let i = a; i < b; i++) off[i] = o; });
  // per-syllable notes (syllnote pass): split voiced stretches at energy dips into syllable nuclei; each syllable gets its own
  // note: stressed (espeak ˈ/ˌ) higher, unstressed lower, consecutive syllables always step at least one scale degree apart.
  const SYL = (process.env.SIDVOICE_SYLL ?? '1') !== '0'; let kS = 32;
  if (SYL && segs.length) { const en = fr.map(f => { let m = -99; for (const x of f[1]) if (x > m) m = x; return m; }), es = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = Math.max(0, i - 6); k <= Math.min(n - 1, i + 6); k++) { s += en[k]; c++; } es[i] = s / c; }
    const sy = []; // [a, b, seg index]
    segs.forEach(([a, b], si) => { const cut = [a]; let lastPk = a;
      for (let i = a + 20; i < b - 20; i++) if (es[i] <= es[i - 1] && es[i] < es[i + 1] && i - cut[cut.length - 1] >= 36) { // local dip, >= 90 ms syllables
        let pl = -99, pr = -99; for (let k = cut[cut.length - 1]; k < i; k++) pl = Math.max(pl, es[k]); for (let k = i; k < Math.min(b, i + 60); k++) pr = Math.max(pr, es[k]);
        if (Math.min(pl, pr) - es[i] > 0.35 && b - i >= 30) cut.push(i); }
      cut.push(b); for (let q = 0; q + 1 < cut.length; q++) sy.push([cut[q], cut[q + 1], si]); });
    const N = sy.length, M = syl && syl.length ? syl : null, amt = +(process.env.SIDVOICE_SYLAMT || 0.4), step = amt * Math.max(1.5, accent * 0.9); let pv = null;
    sy.forEach(([a, b], k) => { const s = M ? M[Math.round(N > 1 ? k * (M.length - 1) / (N - 1) : 0)] : (k % 2 ? 0 : 1);
      let o = off[a] + (s === 2 ? 1.6 : s === 1 ? 0.6 : -0.7) * Math.max(1, accent * 0.8) * amt;
      if (pv !== null && Math.abs(o - pv) < step) o = pv + (o >= pv ? step : -step) * (s ? 1 : (k % 2 ? 1 : -1)); // distinct neighbour notes
      pv = o; for (let i = a; i < b; i++) off[i] = o; });
    kS = 20; } // 50 ms glide: still continuous, short enough that each syllable reaches its own note
  // glide offsets between stretches (no steps)
  const offS = new Float64Array(n); { let acc = 0; const k = kS; for (let i = 0; i < n; i++) { acc += off[i] - (i >= k ? off[i - k] : 0); offS[i] = acc / Math.min(k, i + 1); } }
  const out = fr.map(f => [f[0], f[1], f[2]]);
  for (const [a, b] of segs) for (let i = a; i < b; i++) {
    let sum = 0, c = 0; for (let k = Math.max(a, i - W); k < Math.min(b, i + W); k++) { sum += st[k]; c++; } const sm = sum / c + offS[i];
    // continuous attraction toward the scale (no jump when the contour crosses a midpoint between notes -> no pitch steps/warble)
    let j = 0; while (j < deg.length - 2 && deg[j + 1] <= sm) j++; const d0 = deg[j], d1 = deg[j + 1], u = Math.max(0, Math.min(1, (sm - d0) / (d1 - d0)));
    const uw = u - pull * Math.sin(2 * Math.PI * u) / (2 * Math.PI), fine = (st[i] - sum / c) * (P.fineKeep ?? 0.8), y = d0 + uw * (d1 - d0) + fine;
    out[i][0] = P.f0 * Math.pow(2, y / 12); }
  return out;
}
const STATS = { gateFlips: 0, mJumps: 0, voicingFlips: 0, octJumps: 0, ticks: 0 };
function voice(item, opts = {}) {
  const HZ = item.hz || HZ_BASE, K = item.k ? Object.assign({}, K_BASE, item.k) : K_BASE;
  const M = CUR = modeOf(item.mode), P = item.P, fr = cleanF0(item.frames), neutral = !!P.neutral, hyb = !!(item.digi && item.digi.mix === 'hybrid' && item.audio);
  const vf = fr.filter(f => f[0] > 0).map(f => f[0]).sort((a, b) => a - b), med = vf[vf.length >> 1] || 200;
  let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const male = P.f0 < 150, alpha = (male && P.guide !== 'ryan' ? 0.84 : 1.0) * (neutral ? 1 : P.fs) * (P.alpha || 1), rs0 = neutral ? 1 : Math.max(0.6, Math.min(1.9, P.range / 3.2)) * K.rng;
  const frI = neutral ? fr.map(f => [f[0] > 0 ? P.f0 * Math.pow(f[0] / med, rs0) : 0, f[1], f[2]]) : intonation(fr, P, rs0, med, item.final, rnd, item.cad, item.syl);
  const CMODE = String(process.env.SIDVOICE_CONS_MODE || 'A').toUpperCase(), hasPh = !!(item.phones && item.phones.length), CP = !CONS || neutral ? null : CMODE === 'B' ? Cons.plan2(fr, null, 'B') : hasPh ? Cons.plan2(fr, item.phones, 'A') : (process.env.SIDVOICE_CONS_FALLBACK_B === '1' ? Cons.plan2(fr, null, 'B') : null); if (CP) STATS.cons = CP.stats; let cb = 0, cfi = -1, jump = false; // A (default) = Piper phone durations; B only via SIDVOICE_CONS_MODE=B or opt-in fallback SIDVOICE_CONS_FALLBACK_B=1; no phones -> voicefix behaviour
  let vIn0 = frI.findIndex(f => f[0] > 0), vIn1 = frI.length - 1; while (vIn1 > 0 && !(frI[vIn1][0] > 0)) vIn1--; if (vIn0 < 0) { vIn0 = 1e9; vIn1 = -1; }
  const breath = neutral ? 0 : Math.min(0.6, P.breath + (P.breathAdd || 0)), rasp = neutral ? 0 : Math.min(1, P.rasp * 1.5);
  
  // global level: max harmonic amplitude over the line
  let G = 1e-9; for (const f of fr) for (const v of f[1]) G = Math.max(G, Math.exp(v));
  const W = +item.warp || 1; const envAt = (f, hz) => { hz /= W; const x = hz / alpha / (SR / 2) * (NB - 1); if (x >= NB - 1) return Math.exp(f[1][NB - 1]); const i = Math.floor(x), u = x - i; return Math.exp(f[1][i] * (1 - u) + f[1][i + 1] * u); };
  const apAt = (f, hz) => { const h = hz / W / alpha; if (h <= BANDS[0]) return f[2][0]; for (let i = 1; i < BANDS.length; i++) if (h <= BANDS[i]) { const u = (h - BANDS[i - 1]) / (BANDS[i] - BANDS[i - 1]); return f[2][i - 1] * (1 - u) + f[2][i] * u; } return f[2][BANDS.length - 1]; };
  const EW = item.bEdge || null; let inEW = false; // burst-edge windows (frame units)
  const LIN = X10 && LINEAR, NF = X10 && NOISEFORM, nfS = [0, 0, 0, 0], nfB = [0, 0, 0, 0]; let nfOn = false; // 10582 noise-formant / linear-level state
  const lastN = new Uint8Array(64), lastM = new Int16Array(64), init = [], last = new Float64Array(64), lastHz = Float64Array.from({ length: 64 }, (_, c) => K.disp ? 600 + ((c * 2654435761) >>> 0) % 997 : 1000), lastVol = new Uint8Array(64);
  for (let c = 0; c < 64; c++) { for (let v = 0; v < 3; v++) init.push([c, v * 7 + 5, (c >= 1 && c <= 50 ? K.att << 4 : 0)], [c, v * 7 + 6, 0xf0 | (c >= 1 && c <= 50 ? (VFIX ? (LIN ? (K.relL ?? 1) : K.relV) : K.rel) : 0)], [c, v * 7 + 2, 0], [c, v * 7 + 3, 8]);
    init.push([c, 23, (c >= 45 && c < 51 ? 0x47 : c >= 51 ? 0x67 : 0x07)]); }
  const units = (a, g = K.gam) => Math.round(45 * Math.pow(Math.max(0, Math.min(1, a)), LIN ? 1 : g)); // LINEAR: no gamma (harmonics 0.8, noise 0.6 dropped) // harmonic chips use K.gamH (closer to linear = natural tilt & level variation), noise/consonant chips keep K.gam
  const rm = new Float64Array(64), rmD = Math.pow(10, -1.8 / (K.roomT * HZ)); // room: each chip's level decays as a ~roomT s (RT60) tail
  const LW = new Uint8Array(fr.length + 1); if (X10 && item.phones) for (const p of item.phones) if (/^[lɫ]$/.test(p.c)) for (let k = Math.max(0, Math.round(p.t0 * 400)); k < Math.min(fr.length, Math.round(p.t1 * 400)); k++) LW[k] = 1; // 10582: /l/ windows from phone times
  const xLv = new Int16Array(64).fill(-1), xMu = new Uint8Array(64), xFS = [500, 1500, 2500]; let brAge = 1e9, xFOn = false; // 10582 state
  let fofM = 1, clos = false; // FOF-style per-glottal-cycle taper (pitch-synchronous level on harmonic chips), set per tick
  const setChip = (w, c, hz, wave, u, cutHz, mode) => { if (K.room && c >= 1 && c <= 44) { rm[c] = Math.max(u, rm[c] * rmD); u = Math.max(u, Math.round(rm[c] * K.room)); }
    // stops: noise chips may jump (sharp burst), and during a closure every chip drops at once (silence before the burst)
    if (XN && c >= 51 && brAge < 0.02 * HZ) { /* 10582 fenv: burst window, the chip's fast noise envelope shapes it (no slew) */ } else if (clos && c <= 50 && !VFIX) { u = 0; if (c >= 1 && c <= 44) rm[c] = 0; } else { const sl = (VFIX ? (c >= 51 ? K.slewNv : K.slewV) : (c >= 51 ? K.slewN : K.slew)) * (VFIX ? 800 / HZ : 1), dn = VFIX && clos && c <= 50 ? Math.max(sl, K.closSl * 800 / HZ) : LIN ? sl * (K.dnL ?? 2) : sl; if (VFIX && clos && c <= 50) u = c === 1 && K.vbar && rm[1] + last[1] > 0 ? K.vbar : 0; // round3 voice bar: chip 1 ramps down to the lowest volume step through closures (no digital-zero gap; the burst covers it) // voicefix: closures and syllable landings ramp (no hard drop to 0)
      u = Math.max(last[c] - dn, Math.min(last[c] + sl, u)); } last[c] = Math.round(u * 100) / 100; u = Math.round(u); // bursts are slewed too (no bypass: it caused ticks)
    if (hz > 0) lastHz[c] = hz; else hz = lastHz[c]; // voiced: always track k*f0 (keeps phase relations), unvoiced: hold // silent chips keep their pitch so release tails never jump
    const xMute = XM && cfi >= 0 && LW[cfi] === 1 && ((c >= 1 && c <= 44 && hz > 1150 && hz < 2700) || (c >= 53 && c <= 55)); // 10582: /l/ dip by hard mute (harmonics 1.15-2.7 kHz + noise bands 1.3/1.8/2.4 kHz)
    if (XM && ((c >= 1 && c <= 44) || (c >= 53 && c <= 55))) { const mb = xMute ? 7 : 0; if (mb !== xMu[c]) { w.push([c, 28, mb]); xMu[c] = mb; } }
    let n = lastN[c]; if (xMute && lastN[c] > 0) n = lastN[c]; else if (u === 0) n = 0; else if (!n || u > n * 15) n = Math.ceil(u / 15); else if (n > 1 && u < (n - 1) * 15 * 0.6) n = Math.ceil(u / 15); if (n !== lastN[c] && n && lastN[c]) STATS.gateFlips++; lastN[c] = n; const _n = n, vol = n ? Math.max(1, Math.min(15, Math.round(u / n))) : lastVol[c]; lastVol[c] = vol; const _ = 0, fr = hz2reg(hz), r = cutReg(XM && c >= 1 && c <= 44 && hz > 0 && hz <= 1150 && cfi >= 0 && LW[cfi] ? hz * (K.xlCut ?? 0.9) : (cutHz || hz * 1.5)); // 10582 /l/: LP pulled to the fundamental below the dip
    for (let v = 0; v < 3; v++) w.push([c, v * 7, fr & 255], [c, v * 7 + 1, fr >> 8], [c, v * 7 + 4, wave | (v < n ? 1 : 0)]);
    if (XL && ((c >= 1 && c <= 44) || (LIN && c >= 51))) { const lv = n ? Math.max(1, Math.min(255, Math.round(255 * Math.min(1, last[c] / (n * 15)) * (fofM !== 1 ? fofM : 1)))) : 0; // 10582: 8-bit level from the unrounded slewed amplitude
      if (lv !== xLv[c]) { for (let v = 0; v < 3; v++) w.push([c, 25 + v, lv]); xLv[c] = lv; } w.push([c, 21, r & 7], [c, 22, r >> 3], [c, 24, mode | (n ? 15 : vol)]); return; }
    w.push([c, 21, r & 7], [c, 22, r >> 3], [c, 24, mode | (fofM !== 1 && c >= 1 && c <= 44 && vol ? Math.max(1, Math.min(15, Math.round(vol * fofM))) : vol)]); };
  // tri3: one chip = 3 voices on 3 DIFFERENT adjacent harmonics (triangle, shared LP above the top one): 18 individually
  // pitch-locked harmonics from chips 45-50 instead of 6 'stand-ins' -> low-F0 (male) voices keep individual harmonics far higher.
  const setChip3 = (w, c, hzs, u, cutHz) => { const sl3 = VFIX ? K.slewV * 800 / HZ : K.slew; u = Math.max(last[c] - sl3, Math.min(last[c] + sl3, u)); last[c] = u; u = Math.round(u); const vol = Math.max(0, Math.min(15, u)), r = cutReg(cutHz);
    for (let v = 0; v < 3; v++) { const hz = hzs[v] > 0 ? hzs[v] : 0, fr = hz2reg(hz || 1000); w.push([c, v * 7, fr & 255], [c, v * 7 + 1, fr >> 8], [c, v * 7 + 4, 0x10 | (hz && vol ? 1 : 0)]); }
    lastN[c] = vol ? 3 : 0; lastVol[c] = vol; w.push([c, 21, r & 7], [c, 22, r >> 3], [c, 24, 0x10 | vol]); };
  const warm = neutral ? 0 : (+P.warm || 0), vibD = neutral ? 0 : K.vib * (P.vibAmt ?? 1), vibR = P.vibRate || 5.2;
  let jw = 0, sw = 0, vrun = 0, ph = 0, sh = 1; // smoothed jitter/shimmer walks, voiced run length (ticks), vibrato phase
  const R = HZ / FHZ, lerpF = x => { const i = Math.min(Math.floor(x), frI.length - 1), j = Math.min(i + 1, frI.length - 1), u = Math.min(1, x - i), a = frI[i], b = frI[j];
    if (u === 0 || i === j) return a; // register updates between analysis frames are interpolated (no 2.5 ms stair-steps)
    const f0 = a[0] > 0 && b[0] > 0 ? Math.exp(Math.log(a[0]) * (1 - u) + Math.log(b[0]) * u) : (u < 0.5 ? a[0] : b[0]);
    return [f0, a[1].map((v, k) => v * (1 - u) + b[1][k] * u), a[2].map((v, k) => v * (1 - u) + b[2][k] * u)]; };
  // Vocal-tract phase dispersion: above H4 each chip is detuned by a fixed fraction of a Hz, so its phase slowly rotates
  // against the others (natural speech: high-harmonic phases are not locked to the glottal pulse) -> rounder, less buzzy cycles.
  // per-harmonic decorrelated amplitude micro-fluctuation (natural cycle-to-cycle variation; natural speech shows ~5-10 dB more
  // 10-40 Hz harmonic-amplitude modulation than a fixed vocoder). Random walk per chip, ~15 ms memory at 800 Hz.
  const bassA = new Float64Array(45), hw = new Float64Array(45), pdn = new Float64Array(45); let gph = 0, cj = 0, cs = 1, flk = 0; const vT = hf => VFIX && hf > K.vtF ? Math.pow(hf / K.vtF, -K.vtilt * (P.bright ?? 1) ** -0.5) : 1; const tiltG = hf => vT(hf) * (hf > K.tiltF ? Math.pow(hf / K.tiltF, -K.tilt * (P.bright ?? 1) ** -0.5) : 1); // natural HF roll-off (less buzz); vT = voicefix voiced roll-off above vtF
  const det = Float64Array.from({ length: 45 }, (_, k) => (k % 2 ? 1 : -1) * (0.4 + 0.6 * ((((k * 40503) >>> 0) % 1000) / 1000)) * K.det);
  // Glottal-like phase relations ("rounder" cycles): at the first voiced tick each harmonic chip k arrives at a chosen phase,
  // because before it its oscillator idles at a frequency picked so that f_k * T0 lands exactly there (16-bit register math).
  // Low harmonics take the relation measured on natural speech (H2 -0.3, H3/H4 -1.2 rad re H1), higher ones a fixed spread.
  // Once voiced, chip k is locked to k*f0, so the relation (cycle shape) is kept for the whole line.
  if (K.phase && !neutral) { let n0 = 0; const nT = Math.ceil((fr.length + 20) * R); while (n0 < nT && !(lerpF(n0 / R)[0] > 0)) n0++;
    const per = Math.round(M.sr / HZ), T0 = n0 * per / M.sr;
    if (T0 >= 0.004) { const TH = [0, -0.3, -1.2, -1.2, -2.0, -2.6];
      for (let k = 1; k <= 44; k++) { const th = k <= TH.length ? TH[k - 1] : ((((k * 2654435761) >>> 0) % 1000) / 1000) * 2 * Math.PI;
        const pk = (((th - 0.75 * (k - 1)) / (2 * Math.PI) + (k - 1) / 2) % 1 + 1) % 1, /* -0.75(k-1): measured constant phase offset of the chip path */ N = Math.round(700 * T0) + 3 * k, reg = Math.round((N + pk) / T0 * 16777216 / M.clk);
        lastHz[k] = reg * M.clk / 16777216; } } }
  // SID-filter source-filter path (parallel formants, Klatt/Holmes style): chips 42/43/44 = saw glottal source at f0 through
  // their own SID SVF in band-pass, cutoff following F2/F3/F4 picked from the analysed envelope, resonance = formant sharpness.
  // Harmonic chips keep the low region (F1 + pitch); above K.fx their level is cross-faded by K.form into the formant chips.
  const FR = [[900, 2700], [2000, 3500], [3200, 4800]], fmS = [1500, 2500, 3500];
  const fmPick = f => { const out = []; let lo = 0; for (let j = 0; j < 3; j++) { let best = -1e9, bh = fmS[j];
      for (let hz = Math.max(FR[j][0], lo + 300); hz <= FR[j][1]; hz += 50) { const x = hz / (SR / 2) * (NB - 1), i = Math.floor(x), u = x - i, v = f[1][i] * (1 - u) + f[1][Math.min(NB - 1, i + 1)] * u; if (v > best) { best = v; bh = hz; } }
      out.push(bh); lo = bh; } return out; };
  // TRUE FOF / VOSIM (PASP formant synthesis): per glottal period each formant i is an exponentially decaying sinusoid at Fi
  // with a rising half-sine onset. SID: chip 40+i, voice 1 = silent triangle at F0 (sync master, phase reset once at voicing
  // onset so the SID period and the software glottal clock coincide), voice 2 = TRIANGLE at Fi hard-synced to it (phase restarts
  // every period), LP just above Fi; the grain envelope (half-sine attack tfA s, decay exp(-pi*BW*t)) is written to the chip's
  // volume register at the register rate (SIDVOICE_HZ, >= 2400 Hz). tfV = VOSIM-style trim (grain cut at one period).
  const TFR = [[200, 1000, 80], [700, 2600, 100], [1800, 3500, 140], [3000, 4500, 200], [4000, 5600, 260]], tfS = [500, 1500, 2500, 3500, 4500], tfB = TFR.map(r => r[2]);
  const envBin = (f, hz) => { const x = hz / (SR / 2) * (NB - 1), i = Math.min(NB - 2, Math.floor(x)), u = x - i; return f[1][i] * (1 - u) + f[1][i + 1] * u; };
  const tfPick = f => { const out = []; let lo = 0; for (let j = 0; j < K.tfN; j++) { let best = -1e9, bh = tfS[j];
      for (let hz = Math.max(TFR[j][0], lo + 250); hz <= TFR[j][1]; hz += 25) { const v = envBin(f, hz) - 0.15 * Math.abs(hz - tfS[j]) / 500; /* continuity prior (high-F0 ambiguity) */ if (v > best) { best = v; bh = hz; } }
      // -3 dB half-width -> bandwidth
      const pk = envBin(f, bh); let l = bh, r = bh; while (l > 100 && envBin(f, l) > pk - 0.345) l -= 20; while (r < 10000 && envBin(f, r) > pk - 0.345) r += 20;
      out.push([bh, Math.max(TFR[j][2] * 0.6, Math.min(600, (r - l)))]); lo = bh; } return out; };
  let tfPrevV = false, t3s = 0;
  return { chips: 64, nTicks: Math.ceil((fr.length + (VFIX ? K.tailF : 20)) * R), ticks: n => { const x = n / R, f = lerpF(x), w = [], end = x >= frI.length;
      // natural F0 contour kept; micro-perturbation is a slow random walk (not white per-tick noise, which buzzes)
      jw = jw * 0.92 + (rnd() - 0.5) * 0.21; sw = sw * 0.95 + (rnd() - 0.5) * 0.14; flk = flk * 0.97 + (rnd() - 0.5) * K.flk;
      let f0 = f[0] > 0 ? f[0] * W : 0;
      // glottal-cycle clock: at each new cycle draw per-cycle jitter / shimmer and nudge upper-harmonic phases (cycle-to-cycle variation)
      if (f0) { gph += f0 / HZ; if (gph >= 1) { gph -= Math.floor(gph); cj = (rnd() + rnd() - 1) * K.cjit * (P.jitMul ?? 1); cs = 1 + (rnd() + rnd() - 1) * K.cshim; for (let k = 5; k <= 44; k++) pdn[k] = (rnd() - 0.5) * K.cphase * (K.ldisp && f0 < 140 ? K.lcph : 1) * k * 0.1; } }
      if (f0) f0 *= 1 + cj + (P.tremAmt ? P.tremAmt * Math.sin(2 * Math.PI * (P.tremRate || 6.5) * n / HZ) : 0);// already mapped onto the character's speaking scale (intonation) vrun = f0 ? vrun + 1 : 0; ph += 2 * Math.PI * vibR / HZ;
      if (f0) f0 *= 1 + flk * (P.jitMul ?? 1) + jw * 2 * K.jit + (rnd() - 0.5) * 2 * K.jitW + vibD * Math.min(1, Math.max(0, (vrun - 60 * R) / (80 * R))) * Math.sin(ph); // vibrato only on held vowels
      sh = (1 + sw * 2 * K.shim) * (f0 ? cs : 1);
      const voiced = f0 > 0 && !end;
      { let em = -1e9; for (const v of f[1]) em = Math.max(em, v); clos = !end && K.clos > 0 && Math.exp(em) / G < K.clos; } // stop closure (near-silent frame)
      if (CP) { const fi = Math.min(CP.n - 1, Math.floor(x)); jump = !end && fi !== cfi && CP.burst[fi] > 0; if (jump) brAge = 0; else brAge++; cfi = fi; cb = end ? 0 : CP.clos[fi]; if (cb === 1) clos = true; } // consonant cues: closures, burst onsets
      if (!voiced && !end && K.roomCut) { let em = 0; for (const v of f[1]) em = Math.max(em, v); if (Math.exp(em) / G > K.roomCut) for (let c = 1; c <= 44; c++) rm[c] = 0; }
      // ^ room tail only rings into real silence: an audible voiceless consonant cuts it (it held harmonics through s/t/k = 'buzz between words')
      // sub-octave rasp
      setChip(w, 0, voiced ? f0 / 2 : 0, 0x10, voiced ? units(rasp * 0.5 * Math.min(1, Math.max(0, (f0 - K.raspF) / 60)) * envAt(f, f0) / G) : 0, 300, 0x10);
      // FOF taper: soft attack (fofA of the cycle) then exponential decay (time constant fofT of the cycle) to floor fofF;
      // normalised to unit mean so loudness is unchanged. Needs register rate >> F0 (SIDVOICE_HZ).
      if (K.fof > 0 && voiced) { const p = gph, e = p < K.fofA ? Math.sin(Math.PI / 2 * p / K.fofA) : Math.exp(-(p - K.fofA) / K.fofT);
        const mean = K.fofA * 2 / Math.PI + K.fofT * (1 - Math.exp(-(1 - K.fofA) / K.fofT)), g = K.fofF + (1 - K.fofF) * e, gm = K.fofF + (1 - K.fofF) * mean;
        fofM = 1 + K.fof * (g / gm - 1); } else fofM = 1;
      // sync/ring formant layer: per chip voice 1 = triangle at f0 (gate off: silent, only its accumulator runs as sync master),
      // voice 2 = saw at formant Fi HARD-SYNCED to voice 1 (or triangle ring-modulated by it), through the chip's SID filter.
      // The synced oscillator restarts every glottal period -> a burst of Fi per cycle = a formant on the f0 harmonic grid (pure SID).
      const sOn = K.sync > 0 && !(K.form > 0), smT = sOn && voiced ? fmPick(f) : null;
      if (sOn) for (let j = 0; j < 3; j++) { const c = 42 + j;
        if (!smT) { w.push([c, 4, 0x10], [c, 11, 0x20], [c, 18, 0x20], [c, 24, K.sMode]); continue; }
        fmS[j] = fmS[j] * K.fsm + smT[j] * (1 - K.fsm); const Fh = Math.min(M.maxHz, fmS[j] * alpha * W), ap = Math.min(1, apAt(f, Fh) + breath * 0.5 * Fh / 3000);
        const a = envAt(f, Fh) / G * Math.sqrt(1 - ap) * sh * tiltG(Fh) * K.sync * K.sG, vol = Math.max(0, Math.min(15, units(a, K.gamH)));
        const r0 = hz2reg(f0), r1 = hz2reg(Fh), cr = cutReg(Fh);
        w.push([c, 0, r0 & 255], [c, 1, r0 >> 8], [c, 4, 0x10], [c, 7, r1 & 255], [c, 8, r1 >> 8], [c, 11, (K.sRing ? 0x14 : 0x22) | (vol ? 1 : 0)], [c, 18, 0x20],
          [c, 23, (K.sRes << 4) | 2], [c, 21, cr & 7], [c, 22, cr >> 3], [c, 24, K.sMode | Math.max(0, Math.min(15, Math.round(vol * fofM)))]); }
      const tOn = K.tf > 0;
      if (tOn) { const tk = voiced ? tfPick(f) : null; const onset = voiced && !tfPrevV; tfPrevV = voiced;
        for (let j = 0; j < 5; j++) { const c = 40 + j;
          if (!tk || j >= K.tfN) { w.push([c, 11, 0x10], [c, 24, 0x10]); continue; }
          tfS[j] = tfS[j] * K.fsm + tk[j][0] * (1 - K.fsm); tfB[j] = tfB[j] * K.fsm + tk[j][1] * (1 - K.fsm);
          const Fh = Math.min(M.maxHz * 0.97, tfS[j] * alpha * W), bw = tfB[j] * alpha * K.tfBW, t = gph / f0, al = Math.PI * bw;
          let e = t < K.tfA ? 0.5 * (1 - Math.cos(Math.PI * t / K.tfA)) : Math.exp(-al * (t - K.tfA)); if (K.tfV && gph > 0.95) e *= (1 - gph) / 0.05;
          // grain peak ~ A/(alpha): scale by alpha/f0 so the formant's harmonic level matches the analysed envelope
          const ap = Math.min(1, apAt(f, Fh) + breath * 0.5 * Fh / 3000), A = envAt(f, Fh) / G * Math.sqrt(1 - ap) * sh * tiltG(Fh) * Math.min(4, al / (f0 * Math.PI)) * K.tfG * K.tf;
          const vol = Math.max(0, Math.min(15, Math.round(15 * Math.pow(Math.max(0, Math.min(1, K.tfE ? A : A * e)), K.tfGam)))), newCyc = gph < f0 / HZ; // tfE: grain envelope from the SID ADSR (gate retrigger each period: 2 ms attack, release/decay rate tfE-1)
          const r0 = hz2reg(f0), r1 = hz2reg(Fh), cr = cutReg(Math.min(20000, Fh * K.tfLP));
          if (onset) w.push([c, 4, 0x18]); // TEST: reset master phase at voicing onset (aligns SID period with glottal clock)
          if (K.tfE) w.push([c, 12, (K.tfE - 1) & 15], [c, 13, (K.tfE - 1) & 15]); w.push([c, 0, r0 & 255], [c, 1, r0 >> 8], [c, 4, 0x10], [c, 7, r1 & 255], [c, 8, r1 >> 8], [c, 11, K.tfE ? (t < K.tfGate ? 0x13 : 0x12) : 0x13], [c, 18, 0x10],
            [c, 23, 2], [c, 21, cr & 7], [c, 22, cr >> 3], [c, 24, 0x10 | vol]); } }
      const fOn = K.form > 0, fmT = fOn && voiced ? fmPick(f) : null;
      if (fOn) for (let j = 0; j < 3; j++) { const c = 42 + j; if (!fmT) { setChip(w, c, 0, 0x20, 0, 0, 0x20); continue; }
        fmS[j] = fmS[j] * K.fsm + fmT[j] * (1 - K.fsm); const Fh = fmS[j] * alpha * W, ap = Math.min(1, apAt(f, Fh) + breath * 0.5 * Fh / 3000);
        const a = envAt(f, Fh) / G * Math.sqrt(1 - ap) * sh * tiltG(Fh) * K.form * K.fG; w.push([c, 23, (K.fres << 4) | 7]);
        setChip(w, c, f0, 0x20, units(a, K.gamH), Fh, 0x20); }
      for (let k = 1; k <= 44; k++) { const c = k, hf = k * f0;
        if ((fOn || sOn) && k >= 42) continue; if (tOn && k >= 40) continue;
        if (!voiced || hf > M.maxHz) { setChip(w, c, 0, 0x10, k === 1 && VFIX && K.vbar && x > vIn0 && x < vIn1 ? K.vbar : 0, k === 1 ? lastHz[1] * 1.5 : 0, 0x10); continue; } // round3: chip 1 keeps the lowest volume step between the first and last voiced frame (no digital zero inside a line)
        const ap = Math.min(1, apAt(f, hf) + breath * 0.5 * hf / 3000), top = Math.min(1, (M.maxHz - hf) / (0.15 * M.maxHz)), // fade toward the ceiling: no hard on/off as pitch moves
          a = envAt(f, hf) / G * Math.sqrt(1 - ap) * sh * tiltG(hf) * top * top * (warm && hf < 700 ? 1 + warm * (1 - hf / 700) : 1) * (CP && cfi >= 0 ? (cb === 2 ? (k <= 3 ? 0.5 : 0.04) : 1) * Cons.sonGain(CP.son[cfi], hf) : 1);
        let aa = a; if (hf < K.bassHz) { // bass (H1-H3 region): steady level, little flutter/shimmer, gentle low-shelf flatten (warmth kept)
          const bw = 1 - hf / K.bassHz; aa = a / sh * (1 + (sh - 1) * (1 - bw * 0.85)) * (1 - (1 - K.bassG) * bw); bassA[k] = bassA[k] ? bassA[k] * K.bassSm + aa * (1 - K.bassSm) : aa; aa = bassA[k]; } else bassA[k] = 0;
        hw[k] = hw[k] * K.hwR + (rnd() - 0.5) * K.hwA * Math.min(1.5, 0.5 + k / 8) * (hf < K.bassHz ? K.bassFl : 1); setChip(w, c, hf + (k > (K.ldisp && f0 < 140 ? 2 : 4) ? det[k] * Math.min(1, (k - (K.ldisp && f0 < 140 ? 2 : 4)) / 6) * (K.ldisp && f0 < 140 ? K.ldet : 1) + pdn[k] : 0), 0x10, units(aa * Math.exp(hw[k]) * (fOn && hf > K.fx ? 1 - K.form * Math.min(1, (hf - K.fx) / 400) : 1) * (sOn && hf > K.fx ? 1 - K.sync * Math.min(1, (hf - K.fx) / 400) : 1) * (tOn ? 1 - K.tf : 1), M.mult === 1 ? K.gamH1 : K.gamH), Math.min(12000, hf * 1.5), 0x10); }
      if (XF) { const tk = voiced && !end ? fmPick(f) : null, isL = cfi >= 0 && LW[cfi] === 1; // 10582: one true formant voice per chip on chips 1-3 (F1, F2, F3), excited by chip k's voice-1 wraps / k = one pulse per glottal period
        for (let j = 0; j < 3; j++) { const c = j + 1; if (!tk) { if (xFOn) w.push([c, 35, 0]); continue; }
          const tgt = isL ? [360, 950, 2900][j] : tk[j]; xFS[j] = xFS[j] * (K.xfS ?? 0.6) + tgt * (1 - (K.xfS ?? 0.6)); const Fh = Math.min(M.maxHz * 0.95, xFS[j] * alpha), bw = [90, 110, 160][j];
          const ap = Math.min(1, apAt(f, Fh) + breath * 0.5 * Fh / 3000), a = envAt(f, Fh) / G * Math.sqrt(1 - ap) * sh * tiltG(Fh) * (K.xfv ?? 0.35) * (isL && j === 2 ? 1.6 : 1), lv = Math.max(0, Math.min(255, Math.round(255 * units(a, K.gamH) / 45)));
          const hzr = Math.round(Fh); w.push([c, 31, 1 | (c - 1) << 5], [c, 32, hzr & 255], [c, 33, hzr >> 8], [c, 34, Math.round(bw / 4)], [c, 35, lv]); } xFOn = !!tk; }
      if (M.mult > 1 && K.tri3) { const kTop = voiced ? Math.floor(M.maxHz / f0) : 0, span = Math.max(0, kTop - 44), st0 = Math.max(1, Math.ceil(span / 18)); // voicefix: harmonic stride held per voiced stretch (re-picked only on big moves) -> no chip frequency jumps
        const step = !VFIX ? st0 : (!voiced ? (t3s = 0, st0) : (!t3s || Math.abs(st0 - t3s) > 1 ? (t3s = st0) : t3s));
        HB.forEach((_, j) => { const c = 45 + j; if (!voiced || span <= 0) return setChip3(w, c, [0, 0, 0], 0, 1000);
          const hs = [0, 1, 2].map(v => { const m = 44 + (j * 3 + v) * step + 1; return m <= kTop ? m * f0 : 0; }); if (!hs[0]) return setChip3(w, c, [0, 0, 0], 0, 1000);
          let as = 0, nh = 0; for (const hf of hs) if (hf) { const ap = Math.min(1, apAt(f, hf) + breath * 0.5 * hf / 3000); as += envAt(f, hf) / G * Math.sqrt((1 - ap) * step) * sh * tiltG(hf); nh++; }
          setChip3(w, c, hs, units(as / nh, K.gamH), Math.min(20000, Math.max(...hs) * 1.3)); });
      } else if (M.mult > 1) { // enhanced: harmonics 1..44 already reach 44*f0 (up to 7.7 kHz); chips 46-51 fill harmonics above that,
        // each a real pitch-locked harmonic (index fixed per voiced stretch) standing in for its neighbours.
        const k0 = 45, kTop = voiced ? Math.floor(M.maxHz / f0) : 0, span = Math.max(0, kTop - 44), step = Math.max(1, Math.ceil(span / 6));
        HB.forEach((_, j) => { const c = 45 + j; if (!voiced || 44 + j * step + 1 > kTop) { lastM[c] = 0; return setChip(w, c, 0, 0x10, 0, 0, 0x10); }
          let m = lastM[c]; const want = 44 + j * step + Math.ceil(step / 2); if (!m || Math.abs(want - m) > Math.max(2, step)) m = Math.min(kTop, want); lastM[c] = m;
          const hf = m * f0; if (hf > M.maxHz) return setChip(w, c, 0, 0x10, 0, 0, 0x10);
          const ap = Math.min(1, apAt(f, hf) + breath * 0.5 * hf / 3000), a = envAt(f, hf) / G * Math.sqrt((1 - ap) * step) * sh * tiltG(hf);
          setChip(w, c, hf, 0x10, units(a, M.mult === 1 ? K.gamH1 : K.gamH), Math.min(20000, hf * 1.5), 0x10); });
      } else
      HB.forEach((bf, j) => { const c = 45 + j; if (!voiced) { lastM[c] = 0; return setChip(w, c, 0, 0x20, 0, 0, 0x20); }
        const q = bf / 2 / f0; let m = lastM[c]; if (!m || Math.abs(q - m) > 0.45 * m) m = Math.max(1, Math.round(q)); /* locked per voiced stretch; re-pick only on big pitch moves */ if (lastM[c] && m !== lastM[c]) STATS.mJumps++; lastM[c] = m; const _m = m, osc = m * f0; if (osc > 3840) return setChip(w, c, 0, 0x20, 0, 0, 0x20);
        const ap = apAt(f, bf), a = envAt(f, bf) / G * Math.sqrt(1 - ap) * K.gH * (P.bright ?? 1) * tiltG(bf); setChip(w, c, osc, 0x20, units(a), osc * 2, 0x20); });
      // voicefix noise gate: noise opens by REAL aperiodicity (mean of the 3.7-9.3 kHz bands: fricatives, bursts, aspiration) and closes on
      // vowels; breath only adds a small gated share on voiced frames (no constant ~6 kHz floor); near-silent frames get no noise at all.
      let gv = 1, quiet = false, nSoft = 1; if (VFIX && !end) { let am = 0; for (let q = 6; q < BANDS.length; q++) am += f[2][q]; am /= BANDS.length - 6; gv = voiced ? Math.max(0, Math.min(1, (am - K.apV0) / (K.apV1 - K.apV0))) : 1; let em = -1e9; for (const v of f[1]) em = Math.max(em, v); const rq = Math.exp(em) / G; quiet = rq < K.nFloor; nSoft = Math.min(1, Math.max(0, (rq - K.nFloor) / (3 * K.nFloor))) ** 2; } // soft downward expander (no gate clicks)
      const nm = CP && !end && cfi >= 0 ? CP.nm[cfi] : null, ng = nm ? CP.ng[cfi] : 1; if (CP && !end && cfi >= 0 && CP.vn[cfi] > gv) gv = CP.vn[cfi]; if (nm) quiet = false;
      if (NF) { let am = 0; for (let q = 6; q < BANDS.length; q++) am += f[2][q]; am /= BANDS.length - 6; const was = nfOn; inEW = !!EW && EW.some(([a, b]) => x >= a && x < b); nfOn = !end && (inEW || (!quiet && (!!nm || (!voiced && am > (K.nfAp ?? 0.6))))); // burst / fricative frames only; vowels stay on the harmonic stack
        if (nfOn) { const L = hz => Math.log(Math.max(1e-9, envAt(f, hz))), pk = []; let mx = -1e9; // peaks of the Piper envelope (output Hz)
          for (let hz = 900; hz <= Math.min(M.maxHz * 0.95, 10000); hz += 50) { const v = L(hz); if (v > mx) mx = v; if (v >= L(hz - 150) && v >= L(hz + 150)) pk.push([hz, v]); }
          pk.sort((p, q) => q[1] - p[1]); const sel = []; for (const q of pk) { if (q[1] < mx - (K.nfDr ?? 1.6)) break; if (sel.every(o => Math.abs(o[0] - q[0]) > 600)) sel.push(q); if (sel.length >= 4) break; }
          sel.sort((p, q) => p[0] - q[0]);
          for (let j = 0; j < 4; j++) { const c = 51 + j; if (j >= sel.length) { w.push([c, 35, 0]); continue; } const [hz0, v] = sel[j]; let l = hz0, r = hz0; while (l > 300 && L(l) > v - 0.345) l -= 25; while (r < 10500 && L(r) > v - 0.345) r += 25;
            const bw = Math.max(200, Math.min(1000, r - l)); nfS[j] = was && nfS[j] ? nfS[j] * 0.4 + hz0 * 0.6 : hz0; nfB[j] = was && nfB[j] ? nfB[j] * 0.4 + bw * 0.6 : bw; // own centre + bandwidth, every tick
            const a = Math.exp(v) / G * Math.sqrt(Math.max(K.consAp, apAt(f, hz0))) * K.gNv * nSoft * Math.min(2, ng) * (K.nfG ?? (LIN ? 12 : 5)) * nfB[j] / 500, lv = Math.max(0, Math.min(255, Math.round(255 * units(a) / 45 * (inEW ? BFG : 1)))), hzr = Math.round(nfS[j]);
            w.push([c, 31, 1 | 1 << 1], [c, 32, hzr & 255], [c, 33, hzr >> 8], [c, 34, Math.round(nfB[j] / 4)], [c, 35, lv]); } }
        else if (was) for (let j = 0; j < 4; j++) { const c = 51 + j; w.push([c, 35, 0], [c, 31, 0], [c, 25, 255], [c, 26, 255], [c, 27, 255]); xLv[c] = -1; } }
      BANDS.forEach((bf, j) => { const c = 51 + j, ap = nm ? Math.max(K.consAp, apAt(f, bf)) : end || quiet ? 0 : VFIX ? Math.min(1, apAt(f, bf) * gv + (voiced ? breath * 0.6 * K.brV : 0)) : Math.min(1, apAt(f, bf) + (voiced ? breath * 0.6 : 0)), a = end || quiet ? 0 : envAt(f, bf) / G * Math.sqrt(ap) * (VFIX ? K.gNv : K.gN) * (bf >= 4500 ? (VFIX ? 1 : (M.mult > 1 ? K.gNhE : K.gNh)) * (P.bright ?? 1) : 1) * (voiced ? (1 + K.asp * Math.cos(2 * Math.PI * gph)) * (bf >= 2000 ? K.nV : 1) : (hyb ? K.digiN : 1)) * nSoft;
        const a2 = nm ? Math.max(a * nm[j] * ng, K.bFloor * nm[j] * Math.min(2, ng)) : a; // place-shaped noise (bursts / fricatives)
        setChip(w, c, 3800, 0x80, units((nfOn ? a * (K.nfBr ?? 0.3) : a2) * (LIN ? (K.nLg ?? 4.5) : 1) * (inEW && bf > 4000 ? Math.pow(10, -(K.bedDb ?? 11) / 20 / (LIN ? 1 : K.gam)) : 1)), bf * alpha, 0x20); // NOISEFORM: fixed bands keep breath/room only, place cues move to the noise formants
        if (nfOn && j < 4) { w.push([c, 24, 0x20 | 15], [c, 25, 0], [c, 26, 0], [c, 27, 0]); xLv[c] = -1; } // host chip: band voices silent (LFSR keeps running as the formant's noise source), formant voice at full master volume
        if (XN) { if (jump) w.push([c, 29, (K.xfA ?? 3) | (K.xfD ?? 4) << 4], [c, 30, 7 | 7 << 4]); else if (brAge === Math.ceil(0.02 * HZ)) w.push([c, 30, 0]); } }); // 10582 fenv: fast noise envelope per burst
      return (n === 0 ? init : []).concat(w); } };
}
// digi layer (see digi.js): 'full' = Piper waveform streamed through an emulated SID digi technique only; 'hybrid' = 64-chip
// vocoder for the voiced body + digi for voiceless consonants/transients (vocoder noise chips turned down there).
function digiWeight(item, fr) { const n = item.audio.length, w = new Float32Array(n), A = item.audio; let G = 1e-9; for (const f of fr) for (const v of f[1]) G = Math.max(G, Math.exp(v));
  const per = 22050 / FHZ; for (let i = 0; i < fr.length; i++) { const f = fr[i]; let em = -99; for (const v of f[1]) em = Math.max(em, v);
    const t = f[0] > 0 ? K.digiV : (Math.exp(em) / G > 0.004 ? 1 : 0.5); for (let k = Math.round(i * per); k < Math.min(n, Math.round((i + 1) * per)); k++) w[k] = t; }
  const out = new Float32Array(n); let y = 0; const a = 1 - Math.exp(-1 / (0.004 * 22050)); for (let k = 0; k < n; k++) { y += a * (w[k] - y); out[k] = y; } // 4 ms crossfades
  return out; }
// round3 irregular timing: with Piper phone durations, the espeak primary-stressed vowel is lengthened (stressL) and the next
// vowel shortened (postS) by re-sampling the analysis frames (nearest frame); phone times are warped with them.
function stressTiming(item) { const ph = item.phones; if (!VFIX || !ph || !ph.length || (process.env.SIDVOICE_STRESST ?? '1') === '0' || !item.frames) return item;
  const VW = /[aeiouyæɑɒɐəɘɛɜɞɤɪʊʌɔøœɯɵɶʉɨɚɝ]/, n = item.frames.length, fac = new Float64Array(n).fill(1); let pend = false, post = false;
  const R4A = (process.env.SIDVOICE_R4A ?? '1') !== '0'; let sec = false; // round4: unstressed vowels rush a bit (K.unstrS), secondary-stressed keep length
  for (const p of ph) { if (p.c === 'ˈ') { pend = true; continue; } if (p.c === 'ˌ') { sec = true; continue; } if (!VW.test(p.c)) continue; const a = Math.max(0, Math.round(p.t0 * 400)), b = Math.min(n, Math.round(p.t1 * 400));
    const f = pend ? (R4A ? K.stressL : 1.15) : post ? (R4A ? K.postS : 0.88) : sec || !R4A ? 1 : K.unstrS; for (let i = a; i < b; i++) fac[i] = f; post = pend; pend = false; sec = false; }
  const src = []; let acc = 0; for (let i = 0; i < n; i++) { acc += fac[i]; while (src.length < Math.round(acc)) src.push(i); }
  const cum = new Float64Array(n + 1); for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + fac[i];
  const tw = t => { const x = t * 400, i = Math.max(0, Math.min(n - 1, Math.floor(x))); return (cum[i] + (x - i) * fac[i]) / 400; };
  return Object.assign({}, item, { frames: src.map(i => item.frames[i]), phones: ph.map(p => ({ c: p.c, t0: tw(p.t0), t1: tw(p.t1) })) }); }
// round4 (R4B): vowel-onset sharpening. In the first ~20 ms after a stop release the analysed envelope is a smear of burst +
// transition; bias it toward the vowel's own steady-state spectral shape (mean of its middle half), level kept, fading out.
const STOPS = /^[ptkbdgʔ]$/, VWL = /[aeiouyæɑɒɐəɘɛɜɞɤɪʊʌɔøœɯɵɶʉɨɚɝ]/;
function onsetSharpen(item) { const ph = item.phones, fr = item.frames; if (!VFIX || !ph || !ph.length || !fr || !(K.onW > 0)) return item;
  const out = fr.slice(), n = fr.length, L = Math.max(1, Math.round(K.onMs * 0.4)); let prevStop = false;
  for (const p of ph) { if (p.c === 'ˈ' || p.c === 'ˌ') continue; const isV = VWL.test(p.c);
    if (isV && prevStop) { const a = Math.max(0, Math.round(p.t0 * 400)), b = Math.min(n, Math.round(p.t1 * 400)), q0 = a + ((b - a) >> 2), q1 = b - ((b - a) >> 2);
      if (q1 - q0 >= 4) { const NBn = fr[a] ? fr[a][1].length : 0, tg = new Float64Array(NBn); for (let i = q0; i < q1; i++) for (let k = 0; k < NBn; k++) tg[k] += fr[i][1][k] / (q1 - q0);
        let tm = -1e9; for (const v of tg) tm = Math.max(tm, v);
        for (let j = 0; j < L && a + j < b; j++) { const f = fr[a + j]; if (!(f[0] > 0)) continue; let om = -1e9; for (const v of f[1]) om = Math.max(om, v);
          const w = K.onW * (1 - (j / L) ** 2), e = f[1].map((v, k) => v + w * (tg[k] - tm + om - v)); out[a + j] = [f[0], e, f[2]]; } } }
    prevStop = STOPS.test(p.c); }
  return Object.assign({}, item, { frames: out }); }
// round6 (R6S): phone-time snap. Piper's duration-predictor phone times trail its own audio (seen up to ~75 ms), so every
// consonant event built on them (closure, burst, fricative noise window, onset sharpen, sonorant shaping) landed late, on the
// vowel. Each boundary where the phone string predicts a voicing change (voiced <-> unvoiced/silent) is matched to the nearest
// same-direction voicing transition in the analysed audio (search -30..+8 frames, 2.5 ms each); voiceless-stop releases also
// look for the sharpest energy rise. Where audio and phone time disagree by more than SIDVOICE_SNAP_TOL frames (default 4 =
// 10 ms) the audio wins; phone times are then re-mapped piecewise-linearly between monotone anchors. Analysis only (no audio).
const SNV = /[aeiouyæɑɒɐəɘɛɜɞɤɪʊʌɔøœɯɵɶʉɨɚɝmnŋlɫɹrwjbdgɡzʒvð]/;
function snapMeasure(ph, fr) { const n = fr.length, vo = fr.map(f => f[0] > 0), B = [];
  let G = -1e9; const em = fr.map(f => { let m = -1e9; for (const v of f[1]) m = Math.max(m, v); G = Math.max(G, m); return m; });
  const P = ph.filter(p => !/[ˈˌ]/.test(p.c) && p.t1 > p.t0); const isV = p => p.c !== ' ' && SNV.test(p.c) && !/[,.?!;:]/.test(p.c);
  for (let q = 1; q < P.length; q++) { const a = isV(P[q - 1]), b = isV(P[q]); if (a === b) continue; const t = Math.round(P[q].t0 * 400); if (t <= 2 || t >= n - 2) continue;
    let best = null; for (let k = Math.max(1, t - 30); k <= Math.min(n - 1, t + 8); k++) if (vo[k] === b && vo[k - 1] === a) { if (best === null || Math.abs(k - t) < Math.abs(best - t)) best = k; }
    if (best === null) continue; let at = best;
    if (b && /^[ptk]$/.test(P[q - 1].c)) { let bd = 0, bi = -1; for (let k = Math.max(2, best - 14); k <= best; k++) { const d = em[k] - em[k - 2]; if (d > bd && em[k] > G - 6) { bd = d; bi = k; } } if (bi >= 0 && bd > 1) at = Math.min(best, bi + 1); }
    B.push({ q: ph.indexOf(P[q]), t, at, d: at - t }); }
  return B; }
function phoneSnap(item) { const ph = item.phones, fr = item.frames; if (!VFIX || !ph || !ph.length || !fr || (process.env.SIDVOICE_SNAP ?? '1') === '0') return item;
  const TOL = +(process.env.SIDVOICE_SNAP_TOL || 4), B = snapMeasure(ph, fr), S = STATS.snap || (STATS.snap = { before: [], after: [], moved: 0, bounds: 0 });
  for (const b of B) S.before.push(b.d); S.bounds += B.length;
  const A = [[0, 0]]; for (const b of B) { if (Math.abs(b.d) <= TOL) { A.push([b.t, b.t]); continue; } const l = A[A.length - 1]; if (b.at > l[1] && b.t > l[0]) { A.push([b.t, b.at]); S.moved++; } }
  const T = Math.max(fr.length, Math.round(ph[ph.length - 1].t1 * 400) + 1); A.push([T, T]);
  const map = s => { const x = s * 400; let i = 1; while (i < A.length - 1 && A[i][0] < x) i++; const [x0, y0] = A[i - 1], [x1, y1] = A[i]; return (x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1) / 400; };
  const out = Object.assign({}, item, { phones: ph.map(p => ({ c: p.c, t0: map(p.t0), t1: map(p.t1) })) });
  for (const b of snapMeasure(out.phones, fr)) S.after.push(b.d); return out; }
function render(item) { if (!item || !item.chip) return render0(item); /* per-request voice chip (♫ panel): item.chip '8580' | '10582' (lvl,mute,fmt), item.notch; restored after the render */
  const sv = [X10, XL, XM, XN, XF, NOTCH]; X10 = String(item.chip) === '10582'; XL = X10 && X10F.includes('lvl'); XM = X10 && X10F.includes('mute'); XN = X10 && X10F.includes('fenv'); XF = X10 && X10F.includes('fmt'); NOTCH = X10 && !!item.notch;
  try { return render0(item); } finally { [X10, XL, XM, XN, XF, NOTCH] = sv; } }
function burstEdges(item, d) { /* SIDVOICE_BURST_EDGE: per stop phone, closure-end/burst-start edge = earlier of (a) >2 kHz energy rise in the first-pass rendered audio, (b) 2-8 kHz envelope rise in the post-snap frames; window = edge .. edge + bedMs */
  const sr = d.sr, hop = Math.round(0.002 * sr), W = [], fr = item.frames, bw = (K.bedMs ?? 25) / 2.5;
  const c = Math.cos(2 * Math.PI * 2000 / sr), al = Math.sin(2 * Math.PI * 2000 / sr) / (2 * 0.707), b0 = (1 + c) / 2 / (1 + al), b1 = -(1 + c) / (1 + al), a1 = -2 * c / (1 + al), a2 = (1 - al) / (1 + al); // 2 kHz high-pass biquad
  const hp = new Float32Array(d.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let k = 0; k < d.length; k++) { const y = b0 * d[k] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = d[k]; y2 = y1; y1 = y; hp[k] = y; }
  const eA = t => { const k0 = Math.max(0, Math.round(t * sr)); let e = 1e-12; for (let k = k0; k < Math.min(hp.length, k0 + hop); k++) e += hp[k] * hp[k]; return 10 * Math.log10(e / hop); };
  const eF = t => { const i = Math.max(0, Math.min(fr.length - 1, Math.round(t * 400))), f = fr[i][1]; let e = 1e-12; for (let b = Math.round(2000 / 11025 * 127); b <= Math.round(8000 / 11025 * 127); b++) e += Math.exp(2 * f[b]); return 10 * Math.log10(e); };
  const rise = (E, t0) => { let tm = t0 - 0.03, em = 1e9; for (let t = t0 - 0.03; t <= t0 + 0.01; t += 0.002) { const e = E(t); if (e < em) { em = e; tm = t; } } let mx = -1e9; for (let t = tm; t <= t0 + 0.06; t += 0.002) mx = Math.max(mx, E(t)); const th = em + 0.5 * (mx - em); for (let t = tm; t <= t0 + 0.06; t += 0.002) if (E(t) >= th) return t; return null; };
  for (const p of item.phones || []) if (/^[ɡgbdkpt]$/.test(p.c)) { const ta = rise(eA, p.t0), tf = rise(eF, p.t0), e = Math.min(ta ?? 1e9, tf ?? 1e9) - BEB; if (e < 1e8) W.push([e * 400, e * 400 + bw, ta, tf]); }
  return W; }
function render0(item) { if (BEDGE && X10 && NOISEFORM && !item._ep && !item.bEdge && item.phones) { const d1 = render0(Object.assign({}, item, { _ep: 1 })), it = stressTiming(phoneSnap(Object.assign({}, item, { digi: null, audio: null }))), it2 = (process.env.SIDVOICE_R4B ?? '1') !== '0' ? onsetSharpen(it) : it; const EWs = burstEdges(it2, d1); return render0(Object.assign({}, item, { _ep: 1, bEdge: EWs })); }
  return render0b(item); }
function render0b(item) { const _bE = item.bEdge; item = stressTiming(phoneSnap(Object.assign({}, item, { digi: null, audio: null }))); if ((process.env.SIDVOICE_R4B ?? '1') !== '0') item = onsetSharpen(item); if (_bE) item = Object.assign({}, item, { bEdge: _bE }); // digi disabled: SID synthesis only // -> Float32Array at 22050 Hz (DC-blocked)
  const Dg = item.digi && item.audio ? require('./digi') : null, Md = modeOf(item.mode);
  if (Dg && item.digi.mix === 'full') { const d = Dg.digi(item.audio, Md, item.digi); d.sr = Md.sr; const g = 0.25 / (d.unit); for (let k = 0; k < d.length; k++) d[k] *= g; return d; }
  const B = bestOf(item); if (B && !item.hz) item = Object.assign({}, item, { hz: B.hz, k: Object.assign({}, B.k, item.k || {}) });
  const m = voice(item); if (X10 && NOTCH && item.phones) { const hzN = item.hz || HZ, pad = Number(process.env.SIDVOICE_NOTCH_PAD_MS ?? 9) / 1000, NW = []; for (const p of item.phones) if (/^[lɫ]$/.test(p.c)) NW.push([Math.max(0, Math.floor((p.t0 - pad) * hzN)), Math.ceil((p.t1 + pad) * hzN)]);
    const nf = Math.round(Number(process.env.SIDVOICE_NOTCH_HZ ?? 2000)), nw = Math.round(Number(process.env.SIDVOICE_NOTCH_W ?? 400)), nd = Math.max(0, Math.min(255, Math.round(255 * Number(process.env.SIDVOICE_NOTCH_DEPTH ?? 0.15)))), tk0 = m.ticks; let non = false;
    m.ticks = n => { const w = tk0(n), on = NW.some(([a, b]) => n >= a && n < b); if (on !== non) { for (let c = 0; c < 64; c++) { if (on) w.push([c, 37, nf & 255], [c, 38, nf >> 8], [c, 39, nw & 255], [c, 40, nw >> 8], [c, 41, nd]); w.push([c, 36, on ? 1 : 0]); } non = on; } return w; }; } /* 10582 output notch: on at first tick of each padded /l/ window, off on the tick after */
  const M = modeOf(item.mode), ms = new MultiSid(64, M.sr, { clk: M.clk, cut: M.cut, model: X10 ? '10582' : undefined }), d = ms.render(m.nTicks, item.hz || HZ, m.ticks, CLOCKFIX); d.sr = M.sr;
  let px = 0, py = 0; for (let k = 0; k < d.length; k++) { const y = d[k] - px + 0.995 * py; px = d[k]; py = y; d[k] = y; }
  if (VFIX) { const L = Math.min(d.length >> 2, Math.round(K.fadeMs / 1000 * M.sr)); for (let k = 0; k < L; k++) { const g = Math.sin(Math.PI / 2 * k / L) ** 2; d[k] *= g; d[d.length - 1 - k] *= g; } } // voicefix: ~20 ms line fades
  if (Dg && item.digi.mix === 'hybrid') { const fr = item.frames, w = digiWeight(item, fr), g = Dg.digi(item.audio, M, Object.assign({}, item.digi, { weight: w })), up = M.sr / 22050;
    // level match: vocoder voiced RMS vs Piper voiced RMS sets the digi gain (consonants keep Piper's consonant/vowel balance)
    let ev = 0, ep = 0; for (let k = 0; k < item.audio.length; k++) if (w[k] < 0.05) { const j = Math.round(k * up); if (j < d.length) { ev += d[j] * d[j]; ep += item.audio[k] * item.audio[k]; } }
    const gain = Math.sqrt(ev / Math.max(1e-12, ep)) / (g.unit * g.norm) * K.digiG; const L = Math.min(d.length, g.length);
    for (let k = 0; k < L; k++) d[k] += g[k] * gain; }
  return d;
}
module.exports = { stressTiming, phoneSnap, snapMeasure, STATS, voice, render, digiWeight, SR, MODES, modeOf, VERSION: (X10 ? (NOTCH ? 43 : 41) : VFIX ? (CONS ? (!CLOCKFIX ? ((process.env.SIDVOICE_SNAP ?? '1') === '0' ? 29 : 30) : (process.env.SIDVOICE_SNAP ?? '1') === '0' ? 31 : 32) : 25) : 24) + (NOISEFORM ? 100 : 0) + (NOISEFORM && BEDGE ? 100 : 0) }; // +100 burst-edge cache bump // +100: noise-formant cache bump (10582 renders keyed by chip in index.js)
