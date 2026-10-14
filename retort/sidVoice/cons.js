'use strict';
// Consonant model (pure SID): espeak phonemes (Piper's own input) are aligned to the analysed frames, then each consonant
// gets place-of-articulation cues the 32 ms analysis window smears away:
//  stops    p t k b d g : fast duck of the harmonic chips at closure (voiced: low voice bar), then a sharp noise burst whose
//                         spectrum is set by place (labial low/diffuse, alveolar ~4.5 kHz, velar = next vowel's F2), short decay,
//                         aspiration for voiceless ones (noise shaped by the following vowel)
//  fricatives s z sh zh f v th dh h : fast noise onset, place band (s/z high ~6 kHz, sh/zh ~3 kHz, f/v/th/dh flat & weak, h = vowel shape)
//  sonorants m n ng l r w j : harmonic-envelope shaping over the phone (nasal murmur, r lowered F3, l, w low F2, j high F2)
// Output: per analysis frame (400 Hz) cue arrays read by voc64.voice(). Noise = SID noise chips 51-63 through their filters.
const BANDS = [600, 900, 1300, 1800, 2400, 3000, 3700, 4500, 5300, 6200, 7200, 8200, 9300], NB = 128, SR = 22050;
const VOW = /[aeiouyæɑɒɐəɘɛɜɞɤɪʊʌɔøœɯɵɶʉɨɚɝ]/;
const STOP = { p: 'lab', b: 'lab', t: 'alv', d: 'alv', k: 'vel', g: 'vel', 'ɡ': 'vel', 'ʔ': 'glot' }, VSTOP = /^[bdgɡ]$/;
const FRIC = { s: 's', z: 's', 'ʃ': 'sh', 'ʒ': 'sh', f: 'f', v: 'f', 'θ': 'f', 'ð': 'f', h: 'h' }, VFRIC = /^[zʒvð]$/;
const SON = { m: 'nas', n: 'nas', 'ŋ': 'nas', l: 'l', 'ɫ': 'l', 'ɹ': 'r', r: 'r', w: 'w', j: 'j' };
function tokens(ph) { const out = []; const s = String(ph || '').replace(/[ˈˌːˑ̩̯]/g, '');
  for (let i = 0; i < s.length; i++) { const c = s[i], d = s[i + 1];
    if ((c === 't' && d === 'ʃ') || (c === 'd' && d === 'ʒ')) { out.push({ p: c, k: 'stop' }, { p: d, k: 'fric', aff: 1 }); i++; continue; }
    if (/[\s]/.test(c)) { out.push({ k: 'sp' }); continue; } if (/[,.?!;:]/.test(c)) { out.push({ k: 'pause' }); continue; }
    if (VOW.test(c)) { if (!out.length || out[out.length - 1].k !== 'v') out.push({ p: c, k: 'v' }); else out[out.length - 1].p += c; continue; }
    if (STOP[c]) out.push({ p: c, k: 'stop' }); else if (FRIC[c]) out.push({ p: c, k: 'fric' }); else if (SON[c]) out.push({ p: c, k: 'son' }); }
  return out; }
const g2 = (bf, fc, sg, fl) => fl + (1 - fl) * Math.exp(-0.5 * (Math.log2(bf / fc) / sg) ** 2);
function mask(kind, fc) { const MS = +(process.env.SIDVOICE_CONS_MASK ?? 0.5); const m0 = BANDS.map(bf => kind === 'lab' ? Math.pow(bf / 600, -0.9) : kind === 'alv' ? g2(bf, 4500, 0.5, 0.12) * (bf < 2000 ? 0.4 : 1)
    : kind === 'vel' ? g2(bf, fc, 0.35, 0.1) : kind === 's' ? g2(bf, 6600, 0.45, 0.05) * (bf < 3500 ? 0.3 : 1) : kind === 'sh' ? g2(bf, 3000, 0.45, 0.12)
    : kind === 'f' ? 0.45 : 1);
  const m = m0.map(v => Math.pow(v, MS)); // MS: template strength (0 = keep Piper's own spectrum, 1 = full place template)
  return Float32Array.from(m); }
function plan(frames, ph, opt = {}) { const PARTS = String(process.env.SIDVOICE_CONS_PARTS || 'stop,fric,son'); opt = Object.assign({ bG: +(process.env.SIDVOICE_CONS_BG || 1.8) }, opt);
  const n = frames.length, out = { n, nm: new Array(n).fill(null), ng: new Float32Array(n).fill(1), burst: new Uint8Array(n), clos: new Uint8Array(n), son: new Array(n).fill(null), vn: new Float32Array(n), stats: { clusters: 0, matched: 0, stops: 0, frics: 0, sons: 0 } };
  const T = tokens(ph); if (!T.length || !n) return out;
  let G = 1e-9; const em = frames.map(f => { let m = -1e9; for (const v of f[1]) m = Math.max(m, v); G = Math.max(G, Math.exp(m)); return m; });
  const rel = em.map(m => Math.exp(m) / G), cls = frames.map((f, i) => f[0] > 0 ? 'V' : rel[i] < 0.012 ? 'S' : 'U');
  // non-voiced runs (inside speech)
  let first = cls.indexOf('V'), last = cls.lastIndexOf('V'); if (first < 0) return out;
  const runs = []; for (let i = 0; i < n;) { if (cls[i] === 'V') { i++; continue; } let j = i; while (j < n && cls[j] !== 'V') j++;
    let a = i, b = j; if (a === 0) { while (a < b && cls[a] === 'S') a++; } if (b === n) { while (b > a && cls[b - 1] === 'S') b--; }
    let u = 0, s = 0; for (let k = a; k < b; k++) cls[k] === 'U' ? u++ : s++; if (b > a) runs.push({ a, b, u, s }); i = j; }
  // obstruent clusters in phone order (with index of next vowel/sonorant), pauses split clusters
  const C = []; let cur = null; T.forEach((t, ti) => { if (t.k === 'stop' || t.k === 'fric') { if (!cur) { cur = { ph: [], ti }; C.push(cur); } cur.ph.push(t); } else if (t.k !== 'sp') cur = null; });
  out.stats.clusters = C.length;
  const exp = c => c.ph.reduce((s, t) => s + (t.k === 'stop' ? 22 : 30), 0); // expected frames (2.5 ms)
  const vOnly = c => c.ph.every(t => VSTOP.test(t.p) || VFRIC.test(t.p));
  const m = C.length, r = runs.length, INF = 1e9, dp = Array.from({ length: m + 1 }, () => new Float64Array(r + 1).fill(INF)), bk = Array.from({ length: m + 1 }, () => new Int8Array(r + 1));
  dp[0][0] = 0;
  for (let i = 0; i <= m; i++) for (let j = 0; j <= r; j++) { const d = dp[i][j]; if (d >= INF) continue;
    if (i < m && j < r) { const R = runs[j], L = R.b - R.a, c = d + 0.6 * Math.abs(Math.log(Math.max(4, L) / exp(C[i]))) + (vOnly(C[i]) ? 0.3 : 0) + (L > 120 && R.s > 0.8 * L ? 0.8 : 0); if (c < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = c; bk[i + 1][j + 1] = 1; } }
    if (i < m) { const c = d + (vOnly(C[i]) ? 0.25 : 1.6); if (c < dp[i + 1][j]) { dp[i + 1][j] = c; bk[i + 1][j] = 2; } }
    if (j < r) { const R = runs[j], L = R.b - R.a, c = d + (L < 8 ? 0.2 : R.s > 0.7 * L ? 0.4 : 1.2); if (c < dp[i][j + 1]) { dp[i][j + 1] = c; bk[i][j + 1] = 3; } } }
  const match = new Array(m).fill(-1); for (let i = m, j = r; i > 0 || j > 0;) { const b = bk[i][j]; if (b === 1) { match[i - 1] = j - 1; i--; j--; } else if (b === 2) i--; else j--; }
  // next-vowel F2 (velar burst centre) from the first voiced frame after t
  const f2At = t => { let i = t; while (i < n && cls[i] !== 'V') i++; i = Math.min(n - 1, i + 6); const f = frames[i]; let best = -1e9, bh = 1800;
    for (let hz = 1200; hz <= 3000; hz += 50) { const x = hz / (SR / 2) * (NB - 1), k = Math.floor(x), u = x - k, v = f[1][k] * (1 - u) + f[1][k + 1] * u; if (v > best) { best = v; bh = hz; } } return bh; };
  const applyStop = (t, a, b, voiced) => { const pl = STOP[t.p]; if (pl === 'glot') { for (let k = a; k < Math.min(b, a + 12); k++) out.clos[k] = 2; return; }
    let c = a; while (c < b && cls[c] === 'S') c++; // detected closure
    if (c === a) c = Math.min(b - 1, a + Math.max(3, Math.round((b - a) * (voiced ? 0.35 : 0.3)))); // smeared: impose a closure
    for (let k = a; k < c; k++) out.clos[k] = voiced ? 2 : 1;
    const bd = pl === 'lab' ? 4 : pl === 'alv' ? 6 : 9, mk = mask(pl, pl === 'vel' ? f2At(c) : 0); out.burst[c] = 1; out.stats.stops++;
    for (let k = c; k < b; k++) { const age = k - c; if (age < bd * 3) { out.nm[k] = mk; out.ng[k] = (opt.bG || 1.8) * Math.exp(-age / bd) + (voiced ? 0 : 0.6); } else if (!voiced) { out.nm[k] = null; out.ng[k] = 0.9; } } };
  const applyFric = (t, a, b, voicedSpan) => { const pl = FRIC[t.p], mk = mask(pl, 0), g = pl === 's' ? 1.35 : pl === 'sh' ? 1.25 : pl === 'f' ? 0.75 : 0.9; out.stats.frics++;
    for (let k = a; k < b; k++) { out.nm[k] = mk; out.ng[k] = g; if (voicedSpan) out.vn[k] = pl === 'f' ? 0.35 : 0.6; }
    if (!voicedSpan) out.burst[a] = 2; };
  // place clusters: matched -> split the run among the phones; unmatched (voiced, inside a vowel stretch) -> interpolated position
  const anchors = []; C.forEach((c, i) => { if (match[i] >= 0) anchors.push([c.ti, runs[match[i]].a]); });
  const posOf = ti => { let lo = [0, first], hi = [T.length, last]; for (const a of anchors) { if (a[0] <= ti) lo = a; else { hi = a; break; } } return Math.round(lo[1] + (hi[1] - lo[1]) * (ti - lo[0]) / Math.max(1, hi[0] - lo[0])); };
  C.forEach((c, i) => { const R = match[i] >= 0 ? runs[match[i]] : null;
    if (R) { out.stats.matched++; const tot = exp(c); let a = R.a; c.ph.forEach((t, q) => { const b = q === c.ph.length - 1 ? R.b : Math.min(R.b, a + Math.round((R.b - R.a) * (t.k === 'stop' ? 22 : 30) / tot));
        if (PARTS.includes(t.k)) t.k === 'stop' ? applyStop(t, a, b, VSTOP.test(t.p)) : applyFric(t, a, b, false); a = b; }); }
    else { let a = posOf(c.ti); c.ph.forEach(t => { const L = t.k === 'stop' ? 12 : 22, b = Math.min(n, a + L); if (PARTS.includes(t.k)) t.k === 'stop' ? applyStop(t, a, b, true) : applyFric(t, a, b, true); a = b; }); } });
  // sonorants: position by interpolation between obstruent anchors, ~50 ms spans, harmonic-envelope shaping
  T.forEach((t, ti) => { if (t.k !== 'son' || !PARTS.includes('son')) return; const a = posOf(ti), L = 20; out.stats.sons++;
    for (let k = Math.max(0, a - 2); k < Math.min(n, a + L); k++) if (cls[k] === 'V' && !out.son[k]) out.son[k] = SON[t.p]; });
  return out; }
// v2 (true phone timing): phones = [{c, t0, t1}] in seconds from Piper's duration predictor (w_ceil output). Mode 'A' uses them;
// mode 'B' is phone-agnostic (every unvoiced run = consonant: slewed onset, short decay, tilt toward the next vowel's F2).
function plan2(frames, phones, mode) {
  const n = frames.length, out = { n, nm: new Array(n).fill(null), ng: new Float32Array(n).fill(1), burst: new Uint8Array(n), clos: new Uint8Array(n), son: new Array(n).fill(null), vn: new Float32Array(n), stats: { mode, stops: 0, frics: 0, sons: 0, runs: 0 } };
  let G = 1e-9; const em = frames.map(f => { let m = -1e9; for (const v of f[1]) m = Math.max(m, v); G = Math.max(G, Math.exp(m)); return m; });
  const rel = em.map(m => Math.exp(m) / G), cls = frames.map((f, i) => f[0] > 0 ? 'V' : rel[i] < 0.012 ? 'S' : 'U');
  const f2At = t => { let i = t; while (i < n && cls[i] !== 'V') i++; i = Math.min(n - 1, i + 6); const f = frames[i]; let best = -1e9, bh = 1800;
    for (let hz = 1200; hz <= 3000; hz += 50) { const x = hz / (SR / 2) * (NB - 1), k = Math.floor(x), u = x - k, v = f[1][k] * (1 - u) + f[1][k + 1] * u; if (v > best) { best = v; bh = hz; } } return bh; };
  const onsetIn = (a, b) => { let bi = a, bd = -1e9; for (let k = Math.max(a + 1, 1); k < b; k++) { const d = em[k] - em[k - 2 < 0 ? 0 : k - 2]; if (d > bd) { bd = d; bi = k; } } return bi; };
  if (mode === 'B') { for (let i = 0; i < n;) { if (cls[i] === 'V') { i++; continue; } let j = i; while (j < n && cls[j] !== 'V') j++;
      let a = i; while (a < j && cls[a] === 'S') a++; if (j - a >= 3 && i > 0 && j < n) { out.stats.runs++; const c = a, mk = Float32Array.from(BANDS.map(bf => Math.sqrt(g2(bf, f2At(j) * 2, 0.8, 0.35))));
        for (let k = c; k < j; k++) { out.nm[k] = mk; out.ng[k] = 1 + 0.6 * Math.exp(-(k - c) / 6); } out.burst[c] = 1; } i = j; }
    return out; }
  const F = s => Math.max(0, Math.min(n, Math.round(s * 400)));
  const ph = []; for (let q = 0; q < phones.length; q++) { const c = phones[q].c; if (/[ˈˌː\s,.?!;:]/.test(c)) continue;
    const nx = phones[q + 1]; if ((c === 't' && nx && nx.c === 'ʃ') || (c === 'd' && nx && nx.c === 'ʒ')) { ph.push({ c, a: F(phones[q].t0), b: F(phones[q].t1), k: 'stop' }); continue; }
    ph.push({ c, a: F(phones[q].t0), b: F(phones[q].t1), k: STOP[c] ? 'stop' : FRIC[c] ? 'fric' : SON[c] ? 'son' : VOW.test(c) ? 'v' : 'x' }); }
  for (const p of ph) { if (p.b <= p.a) continue;
    if (p.k === 'stop') { const pl = STOP[p.c], voiced = VSTOP.test(p.c); out.stats.stops++;
      if (pl === 'glot') { for (let k = p.a; k < p.b; k++) out.clos[k] = 2; continue; }
      const c = onsetIn(p.a + Math.round((p.b - p.a) * 0.3), Math.min(n, p.b + 6)); for (let k = p.a; k < c; k++) out.clos[k] = voiced ? 2 : 1;
      const bd = pl === 'lab' ? 4 : pl === 'alv' ? 6 : 9, mk = mask(pl, pl === 'vel' ? f2At(c) : 0); out.burst[c] = 1;
      for (let k = c; k < Math.min(n, c + bd * 2); k++) { out.nm[k] = mk; out.ng[k] = 1 + 0.4 * Math.exp(-(k - c) / (bd * 0.6)); } } // round3: softer, faster-decaying burst (place mask kept)
    else if (p.k === 'fric') { const pl = FRIC[p.c], mk = mask(pl, 0), g = pl === 's' ? 1.3 : pl === 'sh' ? 1.2 : pl === 'f' ? 0.8 : 1; out.stats.frics++;
      for (let k = p.a; k < p.b; k++) { out.nm[k] = mk; out.ng[k] = g; if (VFRIC.test(p.c) && cls[k] === 'V') out.vn[k] = pl === 'f' ? 0.35 : 0.6; } }
    else if (p.k === 'son') { out.stats.sons++; for (let k = p.a; k < p.b; k++) if (cls[k] === 'V') out.son[k] = SON[p.c]; } }
  return out; }
// harmonic gain for a sonorant at frequency hf (applied to the analysed envelope)
function sonGain(kind, hf) { if (!kind) return 1;
  if (kind === 'nas') return hf < 400 ? 1.1 : hf < 1000 ? 0.75 : 0.55;
  if (kind === 'r') return hf > 1400 && hf < 2800 ? 0.55 : hf >= 2800 ? 0.7 : 1;
  if (kind === 'l') return hf > 1500 && hf < 2600 ? 0.75 : hf < 500 ? 1.1 : 1;
  if (kind === 'w') return hf > 1000 ? 0.6 : 1.05;
  if (kind === 'j') return hf > 2000 && hf < 3500 ? 1.25 : hf > 800 && hf < 1500 ? 0.8 : 1;
  return 1; }
module.exports = { plan, plan2, tokens, sonGain, mask };
