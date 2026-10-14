'use strict';
// Per-character accents (S.A.M.-style accented speech, done at the phoneme level BEFORE Piper analysis; output stays pure SID)
// + emphasis/focus words. Phoneme transforms act on espeak IPA (Piper's input). Prosodic traits shape the SID intonation.
const V = 'aeiouæɑɒɔəɛɜɪʊʌɐɚɝ';
const PROFILES = {
  orc:      { ph: [[/ð/g, 'd'], [/θ/g, 't']], traits: { rangeMul: 1.15, pull: 0, accentMul: 1.3, rateMul: 0.94, arch: 0.5 } },
  elf:      { ph: [[/ɹ/g, 'ɾ'], [/ˈ([eiouæɑɔɛɪʊʌ])(?![ːaeiouæɑɒɔəɛɜɪʊʌ])/g, 'ˈ$1ː'], [/oʊ/g, 'oː']], traits: { rangeMul: 1.45, pull: 0, accentMul: 1.5, rateMul: 1.0, arch: 1.1 } },
  northern: { ph: [[/oʊ/g, 'oː'], [/eɪ/g, 'eː']], traits: { rangeMul: 1.1, pull: 0, accentMul: 1.2, rateMul: 0.95, arch: 0.6 } },
  rural:    { ph: [[/(^|\s)h(?=ˈ|ˌ|[aeiouæɑɒɔəɛɜɪʊʌ])/g, '$1'], [/ɪŋ(\s|$)/g, 'ɪn$1']], traits: { rangeMul: 1.3, pull: 0, accentMul: 1.4, rateMul: 0.92, arch: 0.8 } },
  regal:    { ph: [[/æ/g, 'ɑː'], [/ɚ/g, 'ə'], [/oʊ/g, 'əʊ'], [/ˈ([eiouɑɔɛɪʊʌ])(?![ːaeiouæɑɒɔəɛɜɪʊʌ])/g, 'ˈ$1ː']], traits: { rangeMul: 1.35, pull: 0, accentMul: 1.3, rateMul: 0.93, arch: 1 } },
  hiss:     { ph: [[/s/g, 'ss'], [/z/g, 'sz'], [/ʃ/g, 'ʃʃ']], traits: { rangeMul: 1.25, pull: 0, accentMul: 1.5, rateMul: 1.06, arch: 0.5 } },
  // Mid-Atlantic / Transatlantic (Mortacia): espeak RP phonology (crisp unflapped t, non-rhotic, broad 'ah' in bath words,
  // rounded 'aw'), precise articulation, measured cadence, gently elevated melodic glide.
  midatl:   { lang: 'en-gb-x-rp', ph: [], traits: { rangeMul: 1.3, pull: 0, accentMul: 1.25, rateMul: 0.9, arch: 0.9 } },
  // round3: 'shade' = the dead / spectral: low, narrow, slow, slight rasp (f0Mul/raspAdd applied in index.withAccent)
  shade:    { ph: [], traits: { rangeMul: 0.75, pull: 0, accentMul: 0.7, rateMul: 0.84, arch: 0.3, f0Mul: 0.86, raspAdd: 0.08 } },
  // round3: living adventuring companion: brighter, a little quicker, wider and more conversational than neutral
  party:    { ph: [], traits: { rangeMul: 1.35, pull: 0, accentMul: 1.25, rateMul: 1.05, arch: 0.6 } },
  neutral:  { ph: [], traits: { rangeMul: 1.25, pull: 0, accentMul: 1.3, rateMul: 1, arch: 0.75 } },
};
const NAMED = { mortacia: 'midatl', 'old tobin': 'rural', snikkit: 'hiss', grishnak: 'orc', velyra: 'elf', azrakthul: 'northern' };
function accentOf(P) {
  if (P.accent && PROFILES[P.accent]) return P.accent; // stored per-character voice spec wins (stable across rooms)
  const n = String(P.name || '').toLowerCase(); for (const k in NAMED) if (n.includes(k)) return NAMED[k];
  const s = (n + ' ' + (P.kind || '') + ' ' + (P.race || '')).toLowerCase();
  if (/\b(orc|ogre|troll|beast|brute)/.test(s)) return 'orc'; if (/goblin|kobold|snake|lizard|naga/.test(s)) return 'hiss';
  if (/elf|elven|fae|sylph|shadowsong/.test(s)) return 'elf'; if (/undead|ghoul|wraith|shade|spectr|ghost|lich|revenant|necro/.test(s)) return 'shade'; if (/dwar|giant|north/.test(s)) return 'northern';
  if (/regal|queen|king|lord|lady|goddess/.test(s)) return 'regal'; if (/old|farmer|peasant|innkeep/.test(s)) return 'rural';
  return 'neutral';
}
// emphasis: words the speaker is driving at
const STOP = new Set('a an the and or but of to in on at by for with from is are was were be been am i you he she it we they me him her us them my your his its our their this that these those do does did have has had will would shall should can could may might must not no so as if then than there here what who where when why how'.split(' '));
const NEG = /^(not|never|no|nothing|none|nobody|nowhere|cannot|can't|won't|don't|didn't|isn't|aren't|wasn't)$/i, INT = /^(very|so|truly|all|every|must|always|only|ever|dare|now|swear|beware)$/i;
function emphasisOf(text, mood) {
  const words = String(text).split(/\s+/).filter(Boolean), sc = words.map(() => 0);
  words.forEach((w0, i) => { const w = w0.replace(/[^A-Za-z'*_-]/g, ''), b = w.replace(/[*_]/g, ''), lw = b.toLowerCase(); if (!b) return;
    if (/^[*_].+[*_]$/.test(w) || (b.length > 1 && b === b.toUpperCase() && /[A-Z]/.test(b))) sc[i] += 3;
    if (i > 0 && b !== 'I' && /^[A-Z]/.test(b) && !/[.!?]$/.test(words[i - 1])) sc[i] += 2; // names / proper nouns
    if (NEG.test(lw)) sc[i] += 2.2; if (INT.test(lw)) sc[i] += 1.4;
    if (!STOP.has(lw) && lw.length > 3) sc[i] += 0.6;
    if (/[.!?;:,]$/.test(w0) || i === words.length - 1) { for (let j = i; j >= 0; j--) { const lj = words[j].replace(/[^A-Za-z']/g, '').toLowerCase(); if (lj && !STOP.has(lj) && lj.length > 2) { sc[j] += 1.2; break; } } } });
  if (mood === 'angry' || mood === 'excited') sc.forEach((s, i) => { if (s >= 1.4) sc[i] += 0.3; });
  const k = Math.max(1, Math.round(words.length / 6)), ord = sc.map((s, i) => [s, i]).filter(x => x[0] >= 1.6).sort((a, b) => b[0] - a[0]).slice(0, k);
  return ord.map(x => x[1]).sort((a, b) => a - b);
}
const stripMarks = t => String(t).replace(/[*_]+([^*_]+)[*_]+/g, '$1');
// stressed word: primary stress + lengthened stressed vowel (Piper then gives it more duration, pitch and energy)
function emphWord(w) { if (!/[ˈˌ]/.test(w)) { const m = w.search(new RegExp('[' + V + ']')); if (m < 0) return w; w = w.slice(0, m) + 'ˈ' + w.slice(m); }
  w = w.replace('ˌ', 'ˈ'); return w.replace(new RegExp('ˈ([^' + V + ']*[' + V + '])(?![ː' + V + '])'), 'ˈ$1ː'); }
// clauses: espeak IPA clauses; text words aligned by count (skip emphasis when counts disagree)
// American flap fix: espeak en-us turns medial t/d into a flap (Tartarus -> tˈɑːɹɾɑːɹɹəs), which the SID renders as a soft
// d-like tap or nothing. Where the spelling has t the flap becomes t (d-spelled flaps become d).
function unflap(w, sp) { if (!w.includes('ɾ')) return w; const s = String(sp || '').toLowerCase(); return w.replace(/ɾ/g, !s || /t/.test(s) || !/d/.test(s) ? 't' : 'd'); }
function transform(clauses, accent, emph, nTextWords, textWords) {
  const prof = PROFILES[accent] || PROFILES.neutral; let wi = 0; const total = clauses.reduce((a, c) => a + c.trim().split(/\s+/).filter(Boolean).length, 0), ok = emph && emph.length && total === nTextWords;
  const aligned = textWords && total === textWords.length;
  return clauses.map(c => { let ws = c.trim().split(/\s+/).filter(Boolean).map(w => { const e = ok && emph.includes(wi); w = unflap(w, aligned ? textWords[wi] : ''); wi++; return e ? emphWord(w) : w; });
    let s = ws.join(' '); if (!process.env.ACC_NOPH) for (const [re, rep] of prof.ph) s = s.replace(re, rep); return s; });
}
module.exports = { PROFILES, accentOf, emphasisOf, transform, stripMarks, langOf: a => (PROFILES[a] || PROFILES.neutral).lang || 'en-us', traitsOf: a => (PROFILES[a] || PROFILES.neutral).traits };
