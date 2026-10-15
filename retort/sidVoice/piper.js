'use strict';
// Piper (VITS) text-to-speech in Node: espeak-ng phonemes (phonemizer, WASM) -> onnxruntime-node running the Piper .onnx voice.
// Used ONLY as an analysis source for the 64-SID vocoder; its audio is never played.
const fs = require('fs'), path = require('path');
const MODEL = process.env.HOLODEK_PIPER_MODEL || path.join(__dirname, '..', '..', 'models', 'piper', 'en_US-ljspeech-high.onnx');
const Accent = require('./accent');
let ort = null, phon = null, engineReady = null;
// analysis guides: LJ Speech (female) and Ryan (male, en_US-ryan-high). Piper audio is ANALYSIS ONLY (sheet music for the SID vocoder).
const VOICES0 = { lj: MODEL, ryan: process.env.HOLODEK_PIPER_MALE || path.join(__dirname, '..', '..', 'models', 'piper', 'en_US-ryan-high.onnx') };
// consA: prefer the duration-exposing re-export next to each model (<name>-dur.onnx: same weights + the duration predictor's
// ceil output) so phone timings are available; its config is the original <name>.onnx.json. Falls back to the original model.
const durOf = p => p.replace(/\.onnx$/, '-dur.onnx'), VOICES = {}, CFG = {};
for (const [k, p] of Object.entries(VOICES0)) { const d = durOf(p); VOICES[k] = (process.env.SIDVOICE_DURMODEL ?? '1') !== '0' && fs.existsSync(d) ? d : p; CFG[k] = p + '.json'; }
const warned = new Set(); const warnOnce = (v, why) => { if (warned.has(v)) return; warned.add(v); console.warn(`[SidVoice] no phone timings for voice '${v}' (${why}): consonant model off for it, voicefix behaviour (model ${path.basename(VOICES[v])})`); };
const S = {}; // voice -> Promise<{ name, session, cfg }>
const hasVoice = v => !!VOICES[v] && fs.existsSync(VOICES[v]) && fs.existsSync(CFG[v]);
async function useVoice(v) {
  if (!hasVoice(v)) v = 'lj';
  if (!engineReady) engineReady = (async()=>{
    ort = require('onnxruntime-node'); phon = await import('phonemizer');
  })().catch(error=>{ engineReady=null; throw error; });
  await engineReady;
  if (!S[v]) S[v] = (async()=>({name:v,cfg:JSON.parse(fs.readFileSync(CFG[v], 'utf8')),
    session:await ort.InferenceSession.create(VOICES[v], {intraOpNumThreads:Math.max(1,Math.min(8,require('os').cpus().length))})}))()
    .catch(error=>{ delete S[v]; throw error; });
  return S[v];
}
async function load() {
  if (S.lj) return; await useVoice('lj');
  await synth('Welcome, traveller. The torches are lit.', 1); // warm-up run (first inference is several times slower)
  if (hasVoice('ryan')) await synth('Welcome, traveller. The torches are lit.', 1, 1, 'ryan'); // also load + warm the male (Ryan) guide
}
// round3 lexicon (lexicon.json): campaign names + often-missed words -> chosen IPA. Each listed word is phonemized alone
// (cached) and its espeak output is swapped for the lexicon IPA inside the sentence's phonemes, so Piper AND the consonant
// model see the chosen pronunciation. SIDVOICE_LEXICON=0 disables.
let LEX = null; const lexCache = new Map();
function lexicon() { if (LEX) return LEX; LEX = {}; try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'lexicon.json'), 'utf8')); for (const k in j) if (k[0] !== '_') LEX[k.toLowerCase()] = String(j[k]); } catch (e) { console.warn('[SidVoice] lexicon.json not loaded:', e.message); } return LEX; }
// round5: words are looked up with case, edge punctuation and possessives normalised ("Lanul,", "looters'", "Mortacia's");
// matching ignores stress / length marks; each substituted token is remembered (out.lex) so the accent transform cannot
// re-spell a chosen name (restored after Accent.transform when the token layout is unchanged). Misses are logged once.
const lexMissed = new Set();
async function lexApply(clauses, text, lang) { if ((process.env.SIDVOICE_LEXICON ?? '1') === '0') return clauses;
  const L = lexicon(), forms = [];
  for (const raw of String(text).toLowerCase().replace(/[\u2018\u2019]/g, "'").match(/[a-z][a-z']*/g) || []) { const w = raw.replace(/'+$/, ''), poss = /'s$/.test(w), base = poss ? w.slice(0, -2) : w;
    if (L[base] && !forms.some(f => f.raw === raw)) forms.push({ raw, base, poss }); }
  if (!forms.length) return clauses; const norm = s => s.replace(/[ˈˌː.,;:!?'"]/g, ''); const out = clauses.slice(); out.lex = [];
  const toks = out.map(c => c.trim().split(/\s+/).filter(Boolean));
  for (const f of forms) { const k = lang + '|' + f.raw; if (!lexCache.has(k)) lexCache.set(k, String((await phon.phonemize(f.raw.replace(/'$/, ''), lang))[0] || '').trim()); const e = lexCache.get(k);
    let ipa = L[f.base]; if (f.poss) ipa += /[szʃʒ]$|tʃ$|dʒ$/.test(ipa) ? 'ɪz' : /[ptkfθ]$/.test(ipa) ? 's' : 'z';
    let hit = 0; if (e && !/\s/.test(e)) toks.forEach((ts, ci) => ts.forEach((t, ti) => { if (norm(t) === norm(e)) { ts[ti] = ipa; out.lex.push([ci, ti, ipa]); hit++; } }));
    if (!hit && !lexMissed.has(k)) { lexMissed.add(k); console.warn(`[SidVoice] lexicon: '${f.raw}' not found in espeak output (${e}) for: ${String(text).slice(0, 60)}`); }
    if (process.env.SIDVOICE_LEXLOG) console.log('[lex]', f.raw, lang, 'espeak', e, hit ? 'REPLACED x' + hit : 'MISSED'); }
  toks.forEach((ts, ci) => { out[ci] = ts.join(' '); }); return out; }
const lexRestore = (src, tr) => { if (!src.lex || !src.lex.length) return tr; const t = tr.map(c => c.trim().split(/\s+/).filter(Boolean)), s = src.map(c => c.trim().split(/\s+/).filter(Boolean));
  if (t.length !== s.length || t.some((x, i) => x.length !== s[i].length)) return tr; for (const [ci, ti, ipa] of src.lex) t[ci][ti] = ipa; return t.map(x => x.join(' ')); };
// syllables from espeak IPA (Piper's input): one per vowel nucleus (diphthongs / long marks fold in), stress 2 = primary (ˈ),
// 1 = secondary (ˌ), 0 = unstressed. Feeds per-syllable notes in voc64 intonation.
const VOW = /[aeiouyæɑɒɐəɘɛɜɞɤɪʊʌɔøœɯɵɶʉɨ]/;
function sylOf(ph) { const out = []; let pend = 0, inV = false;
  for (const c of ph) { if (c === 'ˈ') { pend = 2; inV = false; continue; } if (c === 'ˌ') { pend = Math.max(pend, 1); inV = false; continue; }
    if (VOW.test(c) || (inV && /[ːˑ̯]/.test(c))) { if (!inV) { out.push(pend); pend = 0; } inV = true; } else inV = false; }
  return out; }
async function synth(text, lengthScale = 1, noiseMul = 1, voice = 'lj', acc = null) { // acc: { accent, emph } (accent.js) // noiseMul: prosody variability (mood) // -> Float32Array @ cfg.audio.sample_rate (22050)
  const {session,cfg,name:guide} = await useVoice(voice);
  const T = acc ? Accent.stripMarks(text) : String(text), TW = T.split(/\s+/).filter(Boolean), lang = acc ? Accent.langOf(acc.accent) : 'en-us', clauses0 = await lexApply(await phon.phonemize(T, lang), T, lang), clauses = acc ? lexRestore(clauses0, Accent.transform(clauses0, acc.accent, acc.emph, TW.length, TW)) : clauses0.map(c => c.replace(/ɾ/g, 't'));
  if (process.env.SIDVOICE_LEXLOG) console.log('[lexph]', voice, acc && acc.accent, JSON.stringify(T), '->', JSON.stringify(clauses));
  const map = cfg.phoneme_id_map, ids = [...map['^'], ...map['_']];
  const end = /[?]\s*$/.test(text) ? '?' : /!\s*$/.test(text) ? '!' : '.';
  const ph = clauses.map(c => c.trim()).filter(Boolean).join(', ') + end;
  const pos = []; for (const p of ph) if (map[p]) { pos.push([p, ids.length, map[p].length]); ids.push(...map[p], ...map['_']); }
  ids.push(...map['$']);
  const inf = cfg.inference || { noise_scale: 0.667, noise_w: 0.8 };
  const r = await session.run({ input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale * noiseMul, lengthScale, inf.noise_w * noiseMul]), [3]) });
  // phone timing: models re-exported with the duration predictor's w_ceil as a 2nd output (frames of hop 256 @ 22050 Hz).
  // Each interspersed blank '_' is split half/half between its neighbours.
  let phones = null; const wo = r.w_ceil || r['/Ceil_output_0'], wc = wo && wo.data;
  if (wc) { const hop = cfg.audio.hop_length || 256, sr = cfg.audio.sample_rate, d = Array.from(wc, Number), st = []; let acc = 0; for (let i = 0; i < d.length; i++) { st.push(acc); acc += d[i]; }
    phones = pos.map(([c, i, k]) => { const own0 = st[i], own1 = st[i + k - 1] + d[i + k - 1], prevBlank = i > 0 ? d[i - 1] : 0, nextBlank = i + k < d.length ? d[i + k] : 0;
      return { c, t0: (own0 - prevBlank / 2) * hop / sr, t1: (own1 + nextBlank / 2) * hop / sr }; }); }
  if (!phones || !phones.length) warnOnce(guide, wo ? 'empty duration output' : 'model has no duration output');
  return { audio: r[session.outputNames[0]].data, sr: cfg.audio.sample_rate, syl: sylOf(ph), ph, phones };
}
// --- paced synthesis: punctuation drives real silence. The phonemizer drops all punctuation (every clause was re-joined
// with a uniform ', '), so semicolons, ellipses, dashes and sentence ends all sounded like a tiny comma. Here each clause is
// synthesized with its own clause-final mark (Piper then does its own pre-pause lengthening / continuation contour) and the
// clauses are joined with explicit silences. pauseMul scales all pauses (mood / confidence).
const PAUSE = { ',': 0.2, ';': 0.26, ':': 0.26, '-': 0.28, '...': 0.6, '.': 0.42, '?': 0.45, '!': 0.38, '"': 0.18 };
function clausesOf(text) {
  const t = String(text).replace(/\u2026/g, '...').replace(/\s+(?:--?|\u2014|\u2013)\s+|(?<=\w)(?:--|\u2014|\u2013)(?=\w)/g, ' -- ');
  const out = []; const re = /(\.\.\.+|--|[,;:?!]|(?<![\d]|\b(?:Mr|Mrs|Ms|Dr|St|Sr|Jr))\.(?!\d))/g; let last = 0, m;
  while ((m = re.exec(t))) { const piece = t.slice(last, m.index).trim(); last = re.lastIndex;
    const mk = m[1] === '--' ? '-' : m[1].startsWith('...') ? '...' : m[1];
    if (/[A-Za-z0-9]/.test(piece)) out.push({ text: piece, mk }); else if (out.length && PAUSE[mk] > PAUSE[out[out.length - 1].mk]) out[out.length - 1].mk = mk; }
  const tail = t.slice(last).trim(); if (/[A-Za-z0-9]/.test(tail)) out.push({ text: tail, mk: '.' });
  return out.length ? out : [{ text: String(text), mk: '.' }];
}
// global speech tempo for every character (speed10 pass): 1.05 = 5% faster speech AND pauses, on top of per-character/mood tempo
const TEMPO = +(process.env.SIDVOICE_TEMPO || 1.05);
async function synthPaced(text, lengthScale = 1, noiseMul = 1, pauseMul = 1, voice = 'lj', acc = null) {
  lengthScale = lengthScale / TEMPO; pauseMul = pauseMul / TEMPO;
  // one Piper pass for the whole sentence (natural coarticulation; splitting it into clause renders cost ~4-6 points of SID
  // intelligibility), then Piper's own clause gaps are located and stretched to the punctuation's pause length.
  const cl = clausesOf(text), { audio: a0, sr, syl, ph, phones } = await synth(text, lengthScale, noiseMul, voice, acc), x = Float32Array.from(a0), hop = Math.round(sr * 0.005);
  const nf = Math.floor(x.length / hop), e = new Float64Array(nf); let pk = 1e-9;
  for (let i = 0; i < nf; i++) { let q = 0; for (let k = i * hop; k < (i + 1) * hop; k++) q += x[k] * x[k]; e[i] = Math.sqrt(q / hop); pk = Math.max(pk, e[i]); }
  let on = 0; while (on < nf && e[on] < pk * 0.02) on++; let off = nf - 1; while (off > on && e[off] < pk * 0.02) off--;
  const runs = []; for (let i = on; i <= off;) { if (e[i] >= pk * 0.02) { i++; continue; } let j = i; while (j <= off && e[j] < pk * 0.02) j++; if (j - i >= 6) runs.push([i, j]); i = j; } // >=30 ms quiet
  const want = cl.length - 1, gaps = runs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, want).sort((p, q) => p[0] - q[0]);
  const out = [], pauses = []; let pos = Math.max(0, on * hop - Math.round(0.01 * sr)); const tmap = [[pos, Math.round(0.03 * sr)]]; // [raw sample, output sample] at each segment start
  const noise = n => { const z = new Float32Array(Math.max(0, n)); let q = 7; for (let k = 0; k < z.length; k++) { q = (q * 1103515245 + 12345) >>> 0; z[k] = (q / 4294967296 - 0.5) * 2e-4; } return z; };
  out.push(noise(Math.round(0.03 * sr)));
  const fade = (seg, f) => { const n = Math.min(seg.length, Math.round(seg.length * f)); for (let k = 0; k < n; k++) seg[seg.length - n + k] *= 1 - 0.65 * (k / n); return seg; };
  gaps.forEach(([g0, g1], gi) => { const mk = gaps.length === want ? cl[gi].mk : ',', mid = Math.round((g0 + g1) / 2) * hop, have = (g1 - g0) * hop / sr, sec = (PAUSE[mk] || 0.2) * pauseMul;
    let seg = x.slice(pos, mid); if (mk === '...') seg = fade(seg, 0.3); out.push(seg); const ins = Math.round(Math.max(0, sec - have) * sr); out.push(noise(ins)); pauses.push(+Math.max(have, sec).toFixed(3));
    tmap.push([mid, tmap[tmap.length - 1][1] + (mid - pos) + ins]); pos = mid; });
  const endMk = cl[cl.length - 1].mk; let seg = x.slice(pos, Math.min(x.length, (off + 1) * hop + Math.round(0.015 * sr))); if (endMk === '...') seg = fade(seg, 0.35); out.push(seg);
  const tail = (PAUSE[endMk] || 0.42) * pauseMul; out.push(noise(Math.round(tail * sr))); pauses.push(tail);
  const n = out.reduce((s2, p) => s2 + p.length, 0), y = new Float32Array(n); let o = 0; for (const p of out) { y.set(p, o); o += p.length; }
  const mapT = t => { const sm = t * sr; let q = tmap[0]; for (const e of tmap) if (e[0] <= sm) q = e; return (q[1] + sm - q[0]) / sr; };
  const ph2 = phones ? phones.map(p => ({ c: p.c, t0: +mapT(p.t0).toFixed(4), t1: +mapT(p.t1).toFixed(4) })) : null;
  return { audio: y, sr, syl, ph, phones: ph2, clauses: cl.length, gapsFound: gaps.length, pauses };
}
module.exports = { lexicon, VOICES, TEMPO, hasVoice, load, synth, synthPaced, clausesOf, PAUSE, MODEL };
