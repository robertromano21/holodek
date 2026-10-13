'use strict';
// Piper (VITS) text-to-speech in Node: espeak-ng phonemes (phonemizer, WASM) -> onnxruntime-node running the Piper .onnx voice.
// Used ONLY as an analysis source for the 64-SID vocoder; its audio is never played.
const fs = require('fs'), path = require('path');
const MODEL = process.env.HOLODEK_PIPER_MODEL || path.join(__dirname, '..', '..', 'models', 'piper', 'en_US-ljspeech-high.onnx');
const Accent = require('./accent');
let session = null, cfg = null, ort = null, phon = null;
// analysis guides: LJ Speech (female) and Ryan (male, en_US-ryan-high). Piper audio is ANALYSIS ONLY (sheet music for the SID vocoder).
const VOICES = { lj: MODEL, ryan: process.env.HOLODEK_PIPER_MALE || path.join(__dirname, '..', '..', 'models', 'piper', 'en_US-ryan-high.onnx') };
const S = {}; // voice -> { session, cfg }
const hasVoice = v => !!VOICES[v] && fs.existsSync(VOICES[v]) && fs.existsSync(VOICES[v] + '.json');
async function useVoice(v) { if (!hasVoice(v)) v = 'lj'; if (!S[v]) { if (!ort) { ort = require('onnxruntime-node'); phon = await import('phonemizer'); }
  S[v] = { cfg: JSON.parse(fs.readFileSync(VOICES[v] + '.json', 'utf8')), session: await ort.InferenceSession.create(VOICES[v], { intraOpNumThreads: Math.max(1, Math.min(8, require('os').cpus().length)) }) }; }
  session = S[v].session; cfg = S[v].cfg; }
async function load() {
  if (S.lj) return; await useVoice('lj');
  await synth('Welcome, traveller. The torches are lit.', 1); // warm-up run (first inference is several times slower)
  if (hasVoice('ryan')) await synth('Welcome, traveller. The torches are lit.', 1, 1, 'ryan'); // also load + warm the male (Ryan) guide
}
// syllables from espeak IPA (Piper's input): one per vowel nucleus (diphthongs / long marks fold in), stress 2 = primary (ˈ),
// 1 = secondary (ˌ), 0 = unstressed. Feeds per-syllable notes in voc64 intonation.
const VOW = /[aeiouyæɑɒɐəɘɛɜɞɤɪʊʌɔøœɯɵɶʉɨ]/;
function sylOf(ph) { const out = []; let pend = 0, inV = false;
  for (const c of ph) { if (c === 'ˈ') { pend = 2; inV = false; continue; } if (c === 'ˌ') { pend = Math.max(pend, 1); inV = false; continue; }
    if (VOW.test(c) || (inV && /[ːˑ̯]/.test(c))) { if (!inV) { out.push(pend); pend = 0; } inV = true; } else inV = false; }
  return out; }
async function synth(text, lengthScale = 1, noiseMul = 1, voice = 'lj', acc = null) { // acc: { accent, emph } (accent.js) // noiseMul: prosody variability (mood) // -> Float32Array @ cfg.audio.sample_rate (22050)
  await useVoice(voice);
  const T = acc ? Accent.stripMarks(text) : String(text), TW = T.split(/\s+/).filter(Boolean), clauses0 = await phon.phonemize(T, acc ? Accent.langOf(acc.accent) : 'en-us'), clauses = acc ? Accent.transform(clauses0, acc.accent, acc.emph, TW.length, TW) : clauses0.map(c => c.replace(/ɾ/g, 't')), map = cfg.phoneme_id_map, ids = [...map['^'], ...map['_']];
  const end = /[?]\s*$/.test(text) ? '?' : /!\s*$/.test(text) ? '!' : '.';
  const ph = clauses.map(c => c.trim()).filter(Boolean).join(', ') + end;
  for (const p of ph) if (map[p]) ids.push(...map[p], ...map['_']);
  ids.push(...map['$']);
  const inf = cfg.inference || { noise_scale: 0.667, noise_w: 0.8 };
  const r = await session.run({ input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale * noiseMul, lengthScale, inf.noise_w * noiseMul]), [3]) });
  return { audio: r[session.outputNames[0]].data, sr: cfg.audio.sample_rate, syl: sylOf(ph) };
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
  const cl = clausesOf(text), { audio: a0, sr, syl } = await synth(text, lengthScale, noiseMul, voice, acc), x = Float32Array.from(a0), hop = Math.round(sr * 0.005);
  const nf = Math.floor(x.length / hop), e = new Float64Array(nf); let pk = 1e-9;
  for (let i = 0; i < nf; i++) { let q = 0; for (let k = i * hop; k < (i + 1) * hop; k++) q += x[k] * x[k]; e[i] = Math.sqrt(q / hop); pk = Math.max(pk, e[i]); }
  let on = 0; while (on < nf && e[on] < pk * 0.02) on++; let off = nf - 1; while (off > on && e[off] < pk * 0.02) off--;
  const runs = []; for (let i = on; i <= off;) { if (e[i] >= pk * 0.02) { i++; continue; } let j = i; while (j <= off && e[j] < pk * 0.02) j++; if (j - i >= 6) runs.push([i, j]); i = j; } // >=30 ms quiet
  const want = cl.length - 1, gaps = runs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, want).sort((p, q) => p[0] - q[0]);
  const out = [], pauses = []; let pos = Math.max(0, on * hop - Math.round(0.01 * sr));
  const noise = n => { const z = new Float32Array(Math.max(0, n)); let q = 7; for (let k = 0; k < z.length; k++) { q = (q * 1103515245 + 12345) >>> 0; z[k] = (q / 4294967296 - 0.5) * 2e-4; } return z; };
  out.push(noise(Math.round(0.03 * sr)));
  const fade = (seg, f) => { const n = Math.min(seg.length, Math.round(seg.length * f)); for (let k = 0; k < n; k++) seg[seg.length - n + k] *= 1 - 0.65 * (k / n); return seg; };
  gaps.forEach(([g0, g1], gi) => { const mk = gaps.length === want ? cl[gi].mk : ',', mid = Math.round((g0 + g1) / 2) * hop, have = (g1 - g0) * hop / sr, sec = (PAUSE[mk] || 0.2) * pauseMul;
    let seg = x.slice(pos, mid); if (mk === '...') seg = fade(seg, 0.3); out.push(seg); out.push(noise(Math.round(Math.max(0, sec - have) * sr))); pauses.push(+Math.max(have, sec).toFixed(3)); pos = mid; });
  const endMk = cl[cl.length - 1].mk; let seg = x.slice(pos, Math.min(x.length, (off + 1) * hop + Math.round(0.015 * sr))); if (endMk === '...') seg = fade(seg, 0.35); out.push(seg);
  const tail = (PAUSE[endMk] || 0.42) * pauseMul; out.push(noise(Math.round(tail * sr))); pauses.push(tail);
  const n = out.reduce((s2, p) => s2 + p.length, 0), y = new Float32Array(n); let o = 0; for (const p of out) { y.set(p, o); o += p.length; }
  return { audio: y, sr, syl, clauses: cl.length, gapsFound: gaps.length, pauses };
}
module.exports = { TEMPO, hasVoice, load, synth, synthPaced, clausesOf, PAUSE, MODEL };
