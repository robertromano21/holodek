'use strict';
// JS port of speechlab/voc/analyze.py: f0 (normalised autocorrelation, 2.5 ms hop), harmonic-peak spectral envelope
// (128 log bins 0-11 kHz) and 13-band aperiodicity. Frames: [f0, env[128], ap[13]].
const SR = 22050, HOP = Math.round(SR / 400), NB = 128, BANDS = [600, 900, 1300, 1800, 2400, 3000, 3700, 4500, 5300, 6200, 7200, 8200, 9300];
const NF = 2048, W = Math.round(0.032 * SR);
const win = Float64Array.from({ length: W }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (W - 1)));
const rev = new Uint32Array(NF); for (let i = 0, b = Math.log2(NF); i < NF; i++) { let r = 0; for (let k = 0; k < b; k++) r |= ((i >> k) & 1) << (b - 1 - k); rev[i] = r; }
const cosT = new Float64Array(NF / 2), sinT = new Float64Array(NF / 2); for (let i = 0; i < NF / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / NF); sinT[i] = -Math.sin(2 * Math.PI * i / NF); }
const re = new Float64Array(NF), im = new Float64Array(NF);
function fftMag(x, out) { // x: Float64Array(NF) real -> out magnitude (NF/2+1)
  re.fill(0); im.fill(0); for (let i = 0; i < NF; i++) re[rev[i]] = x[i];
  for (let s = 2; s <= NF; s <<= 1) { const h = s >> 1, st = NF / s; for (let i = 0; i < NF; i += s) for (let j = 0; j < h; j++) {
    const k = j * st, tr = re[i + j + h] * cosT[k] - im[i + j + h] * sinT[k], ti = re[i + j + h] * sinT[k] + im[i + j + h] * cosT[k];
    re[i + j + h] = re[i + j] - tr; im[i + j + h] = im[i + j] - ti; re[i + j] += tr; im[i + j] += ti; } }
  for (let i = 0; i <= NF / 2; i++) out[i] = Math.hypot(re[i], im[i]);
}
function pitchTrack(x) {
  const n = Math.floor(x.length / HOP), L = Math.round(0.04 * SR), lo = Math.floor(SR / 450), hi = Math.ceil(SR / 70), f = new Float64Array(n);
  let gmax = 1e-9; for (let i = 0; i < x.length; i++) gmax = Math.max(gmax, Math.abs(x[i]));
  for (let i = 0; i < n; i += 4) { const c = i * HOP - (L >> 1); if (c < 0 || c + L + hi >= x.length) continue;
    let e0 = 0, pk = 0; for (let k = 0; k < L; k++) e0 += x[c + k] * x[c + k]; if (Math.sqrt(e0 / L) < gmax * 0.02) continue;
    let best = 0, bl = 0; const r = new Float64Array(hi + 1);
    for (let l = lo; l <= hi; l++) { let s = 0, e1 = 0; for (let k = 0; k < L; k++) { s += x[c + k] * x[c + k + l]; e1 += x[c + k + l] * x[c + k + l]; } r[l] = s / Math.sqrt(e0 * e1 + 1e-12); if (r[l] > best) { best = r[l]; bl = l; } }
    if (best < 0.5) continue;
    for (let d = 2; d <= 4; d++) { const l2 = Math.round(bl / d); if (l2 >= lo && r[l2] > best * 0.9) bl = l2; } // prefer the shortest strong period (octave-error guard)
    let p = bl; if (bl > lo && bl < hi) { const a = r[bl - 1], b = r[bl], cc = r[bl + 1], den = a - 2 * b + cc; if (den) p = bl + 0.5 * (a - cc) / den; }
    f[i] = SR / p; pk = 1; }
  for (let i = 0; i < n; i++) if (i % 4) { const a = i - i % 4, b = a + 4 < n ? a + 4 : a; f[i] = f[a] > 0 && f[b] > 0 ? f[a] + (f[b] - f[a]) * (i % 4) / 4 : (i % 4 < 2 ? f[a] : f[b]); }
  const g = Float64Array.from(f); // 5-point median + drop isolated voiced frames
  for (let i = 2; i < n - 2; i++) { const w = [f[i - 2], f[i - 1], f[i], f[i + 1], f[i + 2]]; const v = w.filter(z => z > 0); g[i] = v.length >= 3 ? v.sort((a, b) => a - b)[v.length >> 1] : 0; }
  // voicing edge refinement (10 ms): the 40 ms periodicity window lets voicing bleed ~20 ms into neighbouring consonants, so
  // harmonic chips buzzed through s/t/k/f. A frame stays voiced only if its low band (<900 Hz, 1-pole split) dominates.
  if (!process.env.SIDVOICE_NOVREF) { const W = Math.round(0.01 * SR); let lpS = 0; const lo2 = new Float64Array(x.length), aL = 1 - Math.exp(-2 * Math.PI * 900 / SR);
    for (let k = 0; k < x.length; k++) { lpS += aL * (x[k] - lpS); lo2[k] = lpS; }
    for (let i = 0; i < n; i++) if (g[i] > 0) { const c = i * HOP - (W >> 1); if (c < 0 || c + W >= x.length) continue; let el = 0, eh = 0;
      for (let k = c; k < c + W; k++) { el += lo2[k] * lo2[k]; const h = x[k] - lo2[k]; eh += h * h; }
      if (el < eh * (+process.env.SIDVOICE_VREF || 0.6)) g[i] = 0; } }
  return g;
}
function analyse(x) {
  const f0s = pitchTrack(x), n = f0s.length, frames = [], buf = new Float64Array(NF), X = new Float64Array(NF / 2 + 1), binHz = SR / NF;
  for (let i = 0; i < n; i++) {
    if (i % 2 && frames.length) { const p = frames[frames.length - 1]; frames.push([+f0s[i].toFixed(1), p[1], (f0s[i] > 0) === (p[0] > 0) ? p[2] : (f0s[i] > 0 ? p[2].map(() => 0.3) : p[2].map(() => 1))]); continue; }
    buf.fill(0); const c = i * HOP - (W >> 1); for (let k = 0; k < W; k++) { const j = c + k; buf[k] = j >= 0 && j < x.length ? x[j] * win[k] : 0; }
    fftMag(buf, X); for (let k = 0; k < X.length; k++) X[k] = X[k] / (W / 4) + 1e-7;
    const f0 = f0s[i], env = new Array(NB), ap = new Array(BANDS.length);
    if (f0 > 0) {
      const hf = [], pk = [], rr = [];
      for (let k = 1; k * f0 < 10500; k++) { const a = Math.max(1, Math.floor((k - 0.5) * f0 / binHz)), b = Math.min(X.length - 1, Math.ceil((k + 0.5) * f0 / binHz));
        if (b <= a) break; let m = 0; for (let q = a; q < b; q++) if (X[q] > m) m = X[q];
        const vl = Math.sqrt(X[a] * X[Math.max(a, b - 1)]);
        hf.push(k * f0); pk.push(m); rr.push(Math.min(1, Math.max(0.02, (vl / m) ** 2 * 2.5))); }
      for (let b = 0; b < NB; b++) { const fz = b * (SR / 2) / (NB - 1); let v;
        if (fz <= hf[0]) v = Math.log(pk[0]); else if (fz >= hf[hf.length - 1]) v = Math.log(pk[pk.length - 1]);
        else { let j = 1; while (hf[j] < fz) j++; const u = (fz - hf[j - 1]) / (hf[j] - hf[j - 1]); v = Math.log(pk[j - 1]) * (1 - u) + Math.log(pk[j]) * u; }
        env[b] = +v.toFixed(2); }
      BANDS.forEach((bf, j) => { let v; if (bf <= hf[0]) v = rr[0]; else if (bf >= hf[hf.length - 1]) v = rr[rr.length - 1]; else { let q = 1; while (hf[q] < bf) q++; const u = (bf - hf[q - 1]) / (hf[q] - hf[q - 1]); v = rr[q - 1] * (1 - u) + rr[q] * u; } ap[j] = +v.toFixed(2); });
    } else { // unvoiced: smoothed log spectrum (average over ~350 Hz)
      const Ls = Array.from(X, v => Math.log(v)), half = 8;
      for (let b = 0; b < NB; b++) { const k0 = Math.round(b * (SR / 2) / (NB - 1) / binHz); let s = 0, c2 = 0; for (let k = Math.max(0, k0 - half); k <= Math.min(Ls.length - 1, k0 + half); k++) { s += Ls[k]; c2++; } env[b] = +(s / c2).toFixed(2); }
      ap.fill(1); }
    frames.push([+f0.toFixed(1), env, ap]);
  }
  return frames;
}
// A separate 8 ms noise spectrum. Keep the 32 ms harmonic analysis untouched.
// Window-energy compensation prevents stationary noise gaining 6 dB just because
// the window is four times shorter. Only parameters leave this analyser, not PCM.
function analyseNoise(x) {
  const w = Math.round(0.008 * SR), window = Float64Array.from({ length: w }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (w - 1)));
  const buf = new Float64Array(NF), X = new Float64Array(NF / 2 + 1), frames = [], scale = 4 / w * Math.sqrt(w / W);
  for (let i = 0, n = Math.floor(x.length / HOP); i < n; i++) {
    buf.fill(0); let energy = 0; const c = i * HOP - (w >> 1);
    for (let k = 0; k < w; k++) { const sample = x[c + k] || 0; energy += sample * sample; buf[k] = sample * window[k]; }
    fftMag(buf, X); const logs = Array.from(X, v => Math.log(v * scale + 1e-7)), env = new Float32Array(NB);
    for (let b = 0; b < NB; b++) { const at = Math.round(b * (NF / 2) / (NB - 1)); let sum = 0, count = 0;
      for (let k = Math.max(0, at - 3); k <= Math.min(logs.length - 1, at + 3); k++) { sum += logs[k]; count++; }
      env[b] = +(sum / count).toFixed(3); }
    let high = 0; for (let k = Math.ceil(1500 * NF / SR); k <= Math.floor(9000 * NF / SR); k++) high += (X[k] * scale) ** 2;
    frames.push({ env, rms: Math.sqrt(energy / w), high });
  }
  return frames;
}
module.exports = { analyse, analyseNoise, SR, HOP };
