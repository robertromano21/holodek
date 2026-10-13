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
const K = Object.assign({ gam: 0.6, gN: 0.6, gH: 4, slew: 10, rng: 1, jit: 0.0025, shim: 0.02, vib: 0.002, jitW: 0, gNh: 6, gNhE: 3, rel: 0, att: 0, room: 0.15, roomT: 0.35, phase: +(process.env.SIDVOICE_PHASE ?? 1), det: 2, roomCut: 0.03, digiN: 0.15, digiV: 0.0, digiG: 1, gapMin: 4, gapAp: 0.4, bassHz: 300, bassFl: 0.15, bassSm: 0.88, bassG: 0.92, gamH: 0.8, gamH1: 0.7, hwR: 0.92, hwA: 0.3, cjit: 0.006, cshim: 0.02, flk: 0.005, tilt: 0, tiltF: 1500, nV: 1, deHold: 1, cphase: 0.25, asp: 0.5, disp: +(process.env.SIDVOICE_DISP ?? 1), tri3: 1, raspF: 160, ldisp: 1, ldet: 2.5, lcph: 3.2, form: +(process.env.SIDVOICE_FORM ?? 0), fres: 9, fG: 1, fx: 1100, fsm: 0.85, fof: +(process.env.SIDVOICE_FOF ?? 0), fofA: 0.12, fofT: 0.35, fofF: 0.25, sync: +(process.env.SIDVOICE_SYNC ?? 0), sRing: 0, sG: 1.5, sRes: 6, sMode: 0x20, tf: +(process.env.SIDVOICE_TFOF ?? 0), tfA: 0.0008, tfBW: 1, tfG: 1, tfN: 5, tfGam: 0.7, tfV: 0, tfLP: 1.6, tfE: 0, tfGate: 0.002, slewN: 45, clos: 0.006 }, JSON.parse(process.env.SIDVOICE_K || '{}'));
const K_BASE = K, HZ_BASE = HZ;
// Best-known in-game default (v20): MALE (Ryan-guided) voices at 2x/4x use the true-FOF blend 0.25 at a 2400 Hz register rate
// (lab: male clarity 93/91 vs 88, buzz ~equal). Female voices and 1x stay on the plain vocoder at 800 Hz. SIDVOICE_BEST=0 disables.
const BEST = { hz: 2400, k: { tf: 0.25, tfG: 5, tfBW: 0.6, tfGam: 0.5 } };
const bestOf = item => (process.env.SIDVOICE_BEST ?? '1') !== '0' && !process.env.SIDVOICE_HZ && item.P && item.P.guide === 'ryan' && ['2x', '4x'].includes(modeOf(item.mode).name) ? BEST : null;
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
function intonation(fr, P, rs0, med, final, rnd, cad, syl) {
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
  const breath = neutral ? 0 : Math.min(0.6, P.breath + (P.breathAdd || 0)), rasp = neutral ? 0 : Math.min(1, P.rasp * 1.5);
  
  // global level: max harmonic amplitude over the line
  let G = 1e-9; for (const f of fr) for (const v of f[1]) G = Math.max(G, Math.exp(v));
  const W = +item.warp || 1; const envAt = (f, hz) => { hz /= W; const x = hz / alpha / (SR / 2) * (NB - 1); if (x >= NB - 1) return Math.exp(f[1][NB - 1]); const i = Math.floor(x), u = x - i; return Math.exp(f[1][i] * (1 - u) + f[1][i + 1] * u); };
  const apAt = (f, hz) => { const h = hz / W / alpha; if (h <= BANDS[0]) return f[2][0]; for (let i = 1; i < BANDS.length; i++) if (h <= BANDS[i]) { const u = (h - BANDS[i - 1]) / (BANDS[i] - BANDS[i - 1]); return f[2][i - 1] * (1 - u) + f[2][i] * u; } return f[2][BANDS.length - 1]; };
  const lastN = new Uint8Array(64), lastM = new Int16Array(64), init = [], last = new Int16Array(64), lastHz = Float64Array.from({ length: 64 }, (_, c) => K.disp ? 600 + ((c * 2654435761) >>> 0) % 997 : 1000), lastVol = new Uint8Array(64);
  for (let c = 0; c < 64; c++) { for (let v = 0; v < 3; v++) init.push([c, v * 7 + 5, (c >= 1 && c <= 50 ? K.att << 4 : 0)], [c, v * 7 + 6, 0xf0 | (c >= 1 && c <= 50 ? K.rel : 0)], [c, v * 7 + 2, 0], [c, v * 7 + 3, 8]);
    init.push([c, 23, (c >= 45 && c < 51 ? 0x47 : c >= 51 ? 0x67 : 0x07)]); }
  const units = (a, g = K.gam) => Math.round(45 * Math.pow(Math.max(0, Math.min(1, a)), g)); // harmonic chips use K.gamH (closer to linear = natural tilt & level variation), noise/consonant chips keep K.gam
  const rm = new Float64Array(64), rmD = Math.pow(10, -1.8 / (K.roomT * HZ)); // room: each chip's level decays as a ~roomT s (RT60) tail
  let fofM = 1, clos = false; // FOF-style per-glottal-cycle taper (pitch-synchronous level on harmonic chips), set per tick
  const setChip = (w, c, hz, wave, u, cutHz, mode) => { if (K.room && c >= 1 && c <= 44) { rm[c] = Math.max(u, rm[c] * rmD); u = Math.max(u, Math.round(rm[c] * K.room)); }
    // stops: noise chips may jump (sharp burst), and during a closure every chip drops at once (silence before the burst)
    if (clos && c <= 50) { u = 0; if (c >= 1 && c <= 44) rm[c] = 0; } else { const sl = c >= 51 ? K.slewN : K.slew; u = Math.max(last[c] - sl, Math.min(last[c] + sl, u)); } last[c] = u;
    if (hz > 0) lastHz[c] = hz; else hz = lastHz[c]; // voiced: always track k*f0 (keeps phase relations), unvoiced: hold // silent chips keep their pitch so release tails never jump
    let n = lastN[c]; if (u === 0) n = 0; else if (!n || u > n * 15) n = Math.ceil(u / 15); else if (n > 1 && u < (n - 1) * 15 * 0.6) n = Math.ceil(u / 15); if (n !== lastN[c] && n && lastN[c]) STATS.gateFlips++; lastN[c] = n; const _n = n, vol = n ? Math.max(1, Math.min(15, Math.round(u / n))) : lastVol[c]; lastVol[c] = vol; const _ = 0, fr = hz2reg(hz), r = cutReg(cutHz || hz * 1.5);
    for (let v = 0; v < 3; v++) w.push([c, v * 7, fr & 255], [c, v * 7 + 1, fr >> 8], [c, v * 7 + 4, wave | (v < n ? 1 : 0)]);
    w.push([c, 21, r & 7], [c, 22, r >> 3], [c, 24, mode | (fofM !== 1 && c >= 1 && c <= 44 && vol ? Math.max(1, Math.min(15, Math.round(vol * fofM))) : vol)]); };
  // tri3: one chip = 3 voices on 3 DIFFERENT adjacent harmonics (triangle, shared LP above the top one): 18 individually
  // pitch-locked harmonics from chips 45-50 instead of 6 'stand-ins' -> low-F0 (male) voices keep individual harmonics far higher.
  const setChip3 = (w, c, hzs, u, cutHz) => { u = Math.max(last[c] - K.slew, Math.min(last[c] + K.slew, u)); last[c] = u; const vol = Math.max(0, Math.min(15, u)), r = cutReg(cutHz);
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
  const bassA = new Float64Array(45), hw = new Float64Array(45), pdn = new Float64Array(45); let gph = 0, cj = 0, cs = 1, flk = 0; const tiltG = hf => hf > K.tiltF ? Math.pow(hf / K.tiltF, -K.tilt * (P.bright ?? 1) ** -0.5) : 1; // natural HF roll-off (less buzz)
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
  let tfPrevV = false;
  return { chips: 64, nTicks: Math.ceil((fr.length + 20) * R), ticks: n => { const x = n / R, f = lerpF(x), w = [], end = x >= frI.length;
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
        if (!voiced || hf > M.maxHz) { setChip(w, c, 0, 0x10, 0, 0, 0x10); continue; }
        const ap = Math.min(1, apAt(f, hf) + breath * 0.5 * hf / 3000), top = Math.min(1, (M.maxHz - hf) / (0.15 * M.maxHz)), // fade toward the ceiling: no hard on/off as pitch moves
          a = envAt(f, hf) / G * Math.sqrt(1 - ap) * sh * tiltG(hf) * top * top * (warm && hf < 700 ? 1 + warm * (1 - hf / 700) : 1);
        let aa = a; if (hf < K.bassHz) { // bass (H1-H3 region): steady level, little flutter/shimmer, gentle low-shelf flatten (warmth kept)
          const bw = 1 - hf / K.bassHz; aa = a / sh * (1 + (sh - 1) * (1 - bw * 0.85)) * (1 - (1 - K.bassG) * bw); bassA[k] = bassA[k] ? bassA[k] * K.bassSm + aa * (1 - K.bassSm) : aa; aa = bassA[k]; } else bassA[k] = 0;
        hw[k] = hw[k] * K.hwR + (rnd() - 0.5) * K.hwA * Math.min(1.5, 0.5 + k / 8) * (hf < K.bassHz ? K.bassFl : 1); setChip(w, c, hf + (k > (K.ldisp && f0 < 140 ? 2 : 4) ? det[k] * Math.min(1, (k - (K.ldisp && f0 < 140 ? 2 : 4)) / 6) * (K.ldisp && f0 < 140 ? K.ldet : 1) + pdn[k] : 0), 0x10, units(aa * Math.exp(hw[k]) * (fOn && hf > K.fx ? 1 - K.form * Math.min(1, (hf - K.fx) / 400) : 1) * (sOn && hf > K.fx ? 1 - K.sync * Math.min(1, (hf - K.fx) / 400) : 1) * (tOn ? 1 - K.tf : 1), M.mult === 1 ? K.gamH1 : K.gamH), Math.min(12000, hf * 1.5), 0x10); }
      if (M.mult > 1 && K.tri3) { const kTop = voiced ? Math.floor(M.maxHz / f0) : 0, span = Math.max(0, kTop - 44), step = Math.max(1, Math.ceil(span / 18));
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
      BANDS.forEach((bf, j) => { const c = 51 + j, ap = end ? 0 : Math.min(1, apAt(f, bf) + (voiced ? breath * 0.6 : 0)), a = end ? 0 : envAt(f, bf) / G * Math.sqrt(ap) * K.gN * (bf >= 4500 ? (M.mult > 1 ? K.gNhE : K.gNh) * (P.bright ?? 1) : 1) * (voiced ? (1 + K.asp * Math.cos(2 * Math.PI * gph)) * (bf >= 2000 ? K.nV : 1) : (hyb ? K.digiN : 1));
        setChip(w, c, 3800, 0x80, units(a), bf * alpha, 0x20); });
      return (n === 0 ? init : []).concat(w); } };
}
// digi layer (see digi.js): 'full' = Piper waveform streamed through an emulated SID digi technique only; 'hybrid' = 64-chip
// vocoder for the voiced body + digi for voiceless consonants/transients (vocoder noise chips turned down there).
function digiWeight(item, fr) { const n = item.audio.length, w = new Float32Array(n), A = item.audio; let G = 1e-9; for (const f of fr) for (const v of f[1]) G = Math.max(G, Math.exp(v));
  const per = 22050 / FHZ; for (let i = 0; i < fr.length; i++) { const f = fr[i]; let em = -99; for (const v of f[1]) em = Math.max(em, v);
    const t = f[0] > 0 ? K.digiV : (Math.exp(em) / G > 0.004 ? 1 : 0.5); for (let k = Math.round(i * per); k < Math.min(n, Math.round((i + 1) * per)); k++) w[k] = t; }
  const out = new Float32Array(n); let y = 0; const a = 1 - Math.exp(-1 / (0.004 * 22050)); for (let k = 0; k < n; k++) { y += a * (w[k] - y); out[k] = y; } // 4 ms crossfades
  return out; }
function render(item) { item = Object.assign({}, item, { digi: null, audio: null }); // digi disabled: SID synthesis only // -> Float32Array at 22050 Hz (DC-blocked)
  const Dg = item.digi && item.audio ? require('./digi') : null, Md = modeOf(item.mode);
  if (Dg && item.digi.mix === 'full') { const d = Dg.digi(item.audio, Md, item.digi); d.sr = Md.sr; const g = 0.25 / (d.unit); for (let k = 0; k < d.length; k++) d[k] *= g; return d; }
  const B = bestOf(item); if (B && !item.hz) item = Object.assign({}, item, { hz: B.hz, k: Object.assign({}, B.k, item.k || {}) });
  const m = voice(item), M = modeOf(item.mode), ms = new MultiSid(64, M.sr, { clk: M.clk, cut: M.cut }), d = ms.render(m.nTicks, item.hz || HZ, m.ticks); d.sr = M.sr;
  let px = 0, py = 0; for (let k = 0; k < d.length; k++) { const y = d[k] - px + 0.995 * py; px = d[k]; py = y; d[k] = y; }
  if (Dg && item.digi.mix === 'hybrid') { const fr = item.frames, w = digiWeight(item, fr), g = Dg.digi(item.audio, M, Object.assign({}, item.digi, { weight: w })), up = M.sr / 22050;
    // level match: vocoder voiced RMS vs Piper voiced RMS sets the digi gain (consonants keep Piper's consonant/vowel balance)
    let ev = 0, ep = 0; for (let k = 0; k < item.audio.length; k++) if (w[k] < 0.05) { const j = Math.round(k * up); if (j < d.length) { ev += d[j] * d[j]; ep += item.audio[k] * item.audio[k]; } }
    const gain = Math.sqrt(ev / Math.max(1e-12, ep)) / (g.unit * g.norm) * K.digiG; const L = Math.min(d.length, g.length);
    for (let k = 0; k < L; k++) d[k] += g[k] * gain; }
  return d;
}
module.exports = { STATS, voice, render, digiWeight, SR, MODES, modeOf, VERSION: 24 };
