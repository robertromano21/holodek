'use strict';
// Mood + sentence-type cadence for SID speech. Rule-based from the line text and the speaker's voice kind (deterministic, so
// the server prefetch and the browser request produce the same cache key). Acoustic profiles follow the vocal-emotion cue
// tables of Scherer (1986/2003) and Juslin & Laukka (2003): F0 level/range, rate, loudness, high-frequency energy (tilt),
// voice quality (breathy/tense), jitter, tremor and contour shape. Values are blended onto the character's base profile.
const MOODS = {
  neutral:  {},
  excited:  { moodF0: 2.5, moodRange: 1.35, rate: 1.12, loud: 1.15, bright: 1.25, breathAdd: -0.03, accentMul: 1.3, finalAdd: 0.5, ns: 1.15 },
  joyful:   { moodF0: 2,   moodRange: 1.3,  rate: 1.06, loud: 1.08, bright: 1.15, accentMul: 1.25, finalAdd: 0.8, ns: 1.1 },
  sad:      { moodF0: -2,  moodRange: 0.6,  rate: 0.85, loud: 0.8,  bright: 0.7,  breathAdd: 0.08, accentMul: 0.6, declMul: 1.4, finalAdd: -1, ns: 0.85 },
  angry:    { moodF0: 1.5, moodRange: 1.3,  rate: 1.08, loud: 1.2,  bright: 1.35, breathAdd: -0.05, jitMul: 1.6, accentMul: 1.4, finalAdd: -1, ns: 1.1 },
  fearful:  { moodF0: 3,   moodRange: 1.1,  rate: 1.12, loud: 0.95, bright: 1.05, breathAdd: 0.08, jitMul: 2, tremAmt: 0.012, tremRate: 7, ns: 1.2 },
  calm:     { moodF0: -1,  moodRange: 0.8,  rate: 0.92, loud: 0.9,  bright: 0.85, breathAdd: 0.04, accentMul: 0.8, finalAdd: -0.5, ns: 0.9 },
  menacing: { moodF0: -2.5, moodRange: 0.7, rate: 0.88, loud: 1.0,  bright: 0.9,  breathAdd: 0.02, raspAdd: 0.06, accentMul: 0.9, finalAdd: -1.5, ns: 0.9 },
  weary:    { moodF0: -1.5, moodRange: 0.6, rate: 0.85, loud: 0.82, bright: 0.75, breathAdd: 0.1, accentMul: 0.6, declMul: 1.5, finalAdd: -1, ns: 0.85 },
};
const KW = [ // [mood, regex] first match wins (checked after punctuation cues)
  ['fearful', /\b(afraid|scared|terrif|help me|run!?|flee|hide|please,? no|they'?re coming|what was that)\b/i],
  ['angry', /\b(how dare|fool|damn|curse you|traitor|enough|silence|you will pay|liar|get out)\b/i],
  ['sad', /\b(alas|sorrow|grief|mourn|lost (him|her|them|everything)|weep|tears|i miss|gone forever|dead now)\b/i],
  ['weary', /\b(tired|weary|so long|exhausted|years|ages|i'?m old)\b/i],
  ['menacing', /\b(blood|bones|grind|devour|soon you|your soul|feed|kill you|i will (end|break|crush))\b/i],
  ['calm', /\b(child|be still|peace|rest|do not fear|don'?t be afraid|i will walk|with you|gently|safe)\b/i],
  ['joyful', /\b(wonderful|glad|thank you|hooray|splendid|delight|happy|welcome)\b/i],
  ['excited', /\b(look|quick|hurry|at last|we found|amazing|incredible|move)\b/i],
];
const KIND_BIAS = { beast: 'menacing', undead: 'menacing', regal: 'calm' };
function moodOf(text, kind, explicit) {
  if (process.env.SIDVOICE_MOOD && MOODS[process.env.SIDVOICE_MOOD]) return process.env.SIDVOICE_MOOD;
  if (explicit && MOODS[explicit]) return explicit;
  const t = String(text || '');
  for (const [m, re] of KW) if (re.test(t)) return m;
  if (/!/.test(t)) return 'excited';
  return KIND_BIAS[kind] && t.length > 12 ? KIND_BIAS[kind] : 'neutral';
}
const WH = /^\s*(who|what|where|when|why|how|which|whose|whom)\b/i;
const IMPERATIVE = /^\s*(go|come|run|stop|look|listen|mind|leave|bring|take|give|move|hurry|follow|wait|stand|kneel|rise|hold|keep|get|put|tell|show|open|close|fight|kill|flee|beware|remember|do not|don'?t|never|let)\b/i;
function cadenceOf(text) {
  const t = String(text || '').trim();
  if (/\?\s*['")\]]*$/.test(t)) return WH.test(t) ? 'wh' : 'yn';
  if (IMPERATIVE.test(t)) return 'cmd';
  if (/!\s*['")\]]*$/.test(t)) return 'excl';
  return 'stmt';
}
// --- confidence: the PRIMARY layer under mood and cadence. c in [-1,1] = character baseline (status/personality) + per-line cues.
// Confident: lower steady F0, firm falling finals, steady rate, fewer pauses, louder, less breath/jitter.
// Unconfident: higher, more variable F0, rising (uptalk) finals, hesitation pauses, softer, breathier, more jitter.
const KIND_CONF = { regal: 0.6, undead: 0.5, beast: 0.4, humanoid: 0.1 };
const HEDGE = /\b(maybe|perhaps|i think|i guess|i suppose|probably|possibly|might|sort of|kind of|not sure|i don'?t know|um+|uh+|er+|well,)\b/gi;
const SURE = /\b(i will|i shall|certainly|of course|without doubt|i know|you will|must|always|never)\b/gi;
function confOf(text, P) {
  const t = String(text || '');
  let c = P.conf !== undefined ? +P.conf : (KIND_CONF[P.kind] ?? 0.1);
  if (process.env.SIDVOICE_CONF !== undefined && process.env.SIDVOICE_CONF !== '') return +process.env.SIDVOICE_CONF;
  c -= 0.3 * Math.min(3, (t.match(HEDGE) || []).length);
  c -= 0.25 * Math.min(2, (t.match(/\.\.\.|\u2026/g) || []).length);
  if (/\b(\w{1,3})-\1/i.test(t)) c -= 0.5;                        // stammer: "I-I", "w-what"
  c += 0.15 * Math.min(2, (t.match(SURE) || []).length);
  return +Math.max(-1, Math.min(1, c)).toFixed(2);
}
// unconfident lines get audible hesitation: a pause after hedge words (Piper renders commas as short pauses)
function hesitate(text, c) { return c < -0.25 ? String(text).replace(/\b(maybe|perhaps|i think|i guess|um+|uh+|well)\b(?![,.])/gi, '$1,') : text; }
function applyConf(Q, c) {
  Q.moodF0 = (Q.moodF0 || 0) - 1.5 * c;                              // semitones
  Q.moodRange = (Q.moodRange ?? 1) * (1 - 0.2 * c);
  Q.jitMul = (Q.jitMul ?? 1) * (1 - 0.45 * c);
  Q.breathAdd = (Q.breathAdd || 0) - 0.05 * c;
  Q.declMul = (Q.declMul ?? 1) * (1 + 0.2 * c);
  Q.finalAdd = (Q.finalAdd || 0) + (c >= 0 ? -1.2 * c : 0);          // firm fall
  if (c < 0 && (Q.cad === 'stmt' || Q.cad === 'excl')) Q.finalAdd += -3 * c; // uptalk
  if (c < -0.4) { Q.tremAmt = Math.max(Q.tremAmt || 0, -0.012 * c); Q.tremRate = Q.tremRate || 6; }
  Q.loud = (Q.loud || 1) * (1 + 0.12 * c);
  Q.rate = Q.rate * (c < 0 ? 1 + 0.06 * c : 1);                      // hesitant = a touch slower
  Q.bright = (Q.bright ?? 1) * (1 + 0.1 * c);
  Q.pause = +((Q.pause || 1) * (c < 0 ? 1 - 0.4 * c : 1 - 0.15 * c)).toFixed(2); // hesitant = longer gaps, confident = fewer/shorter
  Q.conf = c; return Q;
}
function applyMood(P, mood, cad, conf) {
  const M = MOODS[mood] || {}, Q = Object.assign({}, P);
  for (const k of ['moodF0', 'moodRange', 'bright', 'breathAdd', 'jitMul', 'tremAmt', 'tremRate', 'accentMul', 'declMul', 'finalAdd']) if (M[k] !== undefined) Q[k] = M[k];
  if (M.raspAdd) Q.rasp = (Q.rasp || 0) + M.raspAdd;
  Q.rate = (P.rate || 4.8) * (M.rate || 1) * (cad === 'cmd' ? 1.08 : 1);
  Q.loud = (M.loud || 1) * (cad === 'cmd' ? 1.1 : cad === 'excl' ? 1.08 : 1);
  Q.pause = { sad: 1.3, weary: 1.35, calm: 1.25, menacing: 1.2, excited: 0.75, angry: 0.8, fearful: 0.85, joyful: 0.9 }[mood] || 1;
  Q.ns = (M.ns || 1) * (conf !== undefined && conf < 0 ? 1 - 0.15 * conf : 1); Q.mood = mood; Q.cad = cad;
  return conf === undefined ? Q : applyConf(Q, conf);
}
module.exports = { confOf, hesitate, MOODS, moodOf, cadenceOf, applyMood };
