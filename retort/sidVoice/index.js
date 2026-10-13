'use strict';
// SID voices: server-side Piper -> analysis -> 64-SID vocoder render, cached per (speaker profile, sentence).
// Synthesis starts the moment the server creates dialogue (prefetch), and room entry warms profiles + Piper.
const path = require('path'), crypto = require('crypto');
const { Worker } = require('worker_threads');
// Unit of synthesis = one sentence (same splitter as sfx.js speakLine), so the first sentence plays while later ones render.
const clean = s => String(s || '').replace(/([^.!?,;:\s])\s*\n+/g, '$1.\n').replace(/(\w)\s+["\u201c](?=\w)/g, '$1, ').replace(/(\w)["\u201d]\s+(?=\w)/g, '$1, ').replace(/["\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim();
const chunksOf = line => clean(line).split(/(?<=[.!?]['\u2019)\]]*)\s+(?=\S)/).map(clean).filter(Boolean);
const h = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const hash32 = s => { let x = 2166136261; for (const c of String(s)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
const Mood = require('./mood'), VOC_VERSION = require('./voc64').VERSION || 1, SidMode = require('../sidMode');
const stats = { jobs: 0, failures: 0, last: [] }, MAX_PREFETCH = 24;
let worker = null, seq = 0, busy = false, disabled = null; const pending = new Map(), queue = [];
function startWorker() {
  if (worker || disabled) return;
  try { worker = new Worker(path.join(__dirname, 'worker.js')); } catch (e) { disabled = e.message; return; }
  worker.on('message', m => { const p = pending.get(m.id); pending.delete(m.id); busy = false; if (p) m.ok ? p.res(m) : p.rej(new Error(m.error)); pump(); });
  worker.on('error', e => { console.warn('[SidVoice] worker error', e.message); stats.failures++; worker = null; busy = false; for (const p of pending.values()) p.rej(e); pending.clear(); });
}
function pump() {
  if (busy || !queue.length) return; startWorker(); if (!worker) { while (queue.length) queue.shift().rej(new Error('sid voice disabled: ' + disabled)); return; }
  const j = queue.shift(); busy = true; pending.set(j.msg.id, j); worker.postMessage(j.msg);
}
function run(msg, urgent) {
  return new Promise((res, rej) => { msg.id = ++seq; const j = { msg, res, rej, urgent };
    if (urgent) { const i = queue.findIndex(q => !q.urgent); i < 0 ? queue.push(j) : queue.splice(i, 0, j); } else {
      queue.push(j); const pre = queue.filter(q => !q.urgent); if (pre.length > MAX_PREFETCH) { const drop = pre[0]; queue.splice(queue.indexOf(drop), 1); drop.rej(new Error('prefetch queue full')); } }
    pump(); });
}
// --- voice profiles (sent by the client's sfx.js voiceProfile when a room is entered; hashed default otherwise) ---
const profiles = new Map();
// Character overrides (named voices). Mortacia: warm maternal alto/mezzo, female formants, gentle breath, low warmth, steady legato.
const OVERRIDES = { mortacia: { f0: 196, fs: 1.04, alpha: 1.0, breath: 0.1, rasp: 0, range: 2.6, rate: 4.0, conf: 0.85, warm: 0.3, vibAmt: 0.7, vibRate: 4.8, scale: [0, 2, 4, 5, 7, 9], pull: 0.16, accent: 2.2, decl: 2.5 } };
function clampProfile(P) { const o = OVERRIDES[String(P.name || '').toLowerCase().split(/\s+/)[0]] || null;
  const base = { name: P.name, kind: P.kind || 'humanoid', f0: Math.max(90, Math.min(235, +P.f0 || 130)), fs: Math.max(0.92, Math.min(1.05, +P.fs || 1)),
  rasp: (+P.rasp || 0) * 0.35, breath: Math.min(0.45, (+P.breath || 0) * 0.6), range: Math.min(4.5, Math.max(2, +P.range || 3.2)), rate: +P.rate || 4.8, ...(P.conf !== undefined ? { conf: Math.max(-1, Math.min(1, +P.conf)) } : {}) };
  // speaking scale: each character's own favoured pitch targets and accent spread (derived from name hash + pitch range)
  Object.assign(base, { scaleIdx: hash32(String(P.name) + '#scale') % 5, pull: 0.12, accent: +(1.4 * base.range / 3.2).toFixed(2), decl: 2 });
  return o ? Object.assign(base, o) : base; }
function profileOf(name) {
  if (profiles.has(name)) return profiles.get(name);
  const r = i => (hash32(name + '#' + i) % 1000) / 1000;
  return clampProfile({ name, f0: 105 + r(1) * 110, fs: 0.94 + r(2) * 0.12, breath: 0.08 + r(5) * 0.1, rasp: r(6) * 0.2, range: 3.2, rate: 4.6 + r(9) });
}
// --- caches ---
const tracks = new Map(), wavs = new Map();
const lru = (m, k, v, max) => { m.delete(k); m.set(k, v); while (m.size > max) m.delete(m.keys().next().value); return v; };
const SPEED = +(process.env.SIDVOICE_SPEED || 0.83);
// SID digi layer (digi.js): SIDVOICE_DIGI = hybrid (64-SID vocoder body + triangle/TEST-bit digi voice for consonants and
// transients) | full (default since the articul pass: lowest buzz; Piper waveform through one SID voice, triangle/TEST-bit
// sample-and-hold; keeps mood tempo/pauses but loses the per-character pitch/scale/formant shaping) | off (64-SID vocoder only).
// SIDVOICE_DIGI_KIND = tri (default) | pwm8 | d418 (4-bit $D418, +8 mid offset; SIDVOICE_DIGI_MODEL 6581|8580).
const DIGI = null; // digi (Piper waveform through SID) DISABLED by user decision: voices are SID-synthesized only; SIDVOICE_DIGI is ignored // global tempo (Piper length_scale multiplier); <1 = faster
const lsOf = P => +(SPEED * Math.max(0.7, Math.min(1.45, 4.8 / P.rate))).toFixed(2); // wide enough for mood tempo
// analysis guide: male-range characters (base F0 < 150 Hz) are analysed from Piper's male Ryan voice, others from LJ (SIDVOICE_GUIDE=lj forces LJ)
const guideOf = P => (process.env.SIDVOICE_GUIDE || 'auto') === 'lj' ? 'lj' : (P.f0 < 150 ? 'ryan' : 'lj');
// accents (accent.js): phoneme-level accent + emphasis go to Piper (analysis); prosodic traits widen/shape the SID melody
const Accent = require('./accent');
const withAccent = P => { if ((process.env.SIDVOICE_ACCENT ?? '1') === '0') return Object.assign({}, P, { accentName: 'neutral' }); const a = Accent.accentOf(P), t = Accent.traitsOf(a);
  return Object.assign({}, P, { accentName: a, range: P.range * t.rangeMul, pull: P.pull ?? t.pull, accentMul: (P.accentMul ?? 1) * t.accentMul, rate: P.rate * t.rateMul, arch: t.arch, emphSt: 2.2 }); };
function track(text, ls, urgent, ns = 1, pm = 1, voice = 'lj', acc = null) {
  const k = voice + '|' + JSON.stringify(acc) + '|' + ls + '|' + ns + '|' + pm + '|' + text; if (tracks.has(k)) return lru(tracks, k, tracks.get(k), 300);
  const p = run({ type: 'track', text, ls, ns, pm, voice, acc }, urgent).then(m => { stats.last.push({ text: text.slice(0, 40), ...m.ms }); if (stats.last.length > 20) stats.last.shift(); return { frames: m.frames, syl: m.syl, audio: m.audio }; });
  p.catch(() => tracks.delete(k)); return lru(tracks, k, p, 300);
}
function wavFor(speaker, text, urgent, mode, moodHint) {
  mode = SidMode.norm(mode) || SidMode.get(); text = clean(text); const P0 = profileOf(speaker), cad = Mood.cadenceOf(text), mood = Mood.moodOf(text, P0.kind, moodHint), conf = Mood.confOf(text, P0);
  text = Mood.hesitate(text, conf);
  const P = withAccent(Object.assign(Mood.applyMood(P0, mood, cad, conf), { guide: guideOf(P0) })), acc = { accent: P.accentName, emph: Accent.emphasisOf(text, mood) }, key = h('a1|' + JSON.stringify(acc) + '|' + 'v' + VOC_VERSION + '|' + JSON.stringify(DIGI) + '|' + mode + '|' + mood + '|' + cad + '|' + conf + '|' + JSON.stringify(P) + '|' + text);
  if (wavs.has(key)) { const e = lru(wavs, key, wavs.get(key), 200); if (urgent) e.urgent = true; return e.p; }
  const t0 = Date.now(), e = { urgent };
  // renders are short: always run them ahead of queued analyses
  e.p = track(text, lsOf(P), urgent, +P.ns.toFixed(3), +(P.pause || 1).toFixed(2), P.guide, acc).then(tk => run({ type: 'render', P, frames: tk.frames, syl: tk.syl, audio: null, digi: null, mode, cad, final: /\?\s*$/.test(text) ? '?' : '.' }, true)).then(m => {
    const pcm = Buffer.from(m.pcm.buffer, m.pcm.byteOffset, m.pcm.byteLength), b = Buffer.alloc(44), SRo = m.sr || 22050;
    b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(SRo, 24); b.writeUInt32LE(SRo * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length, 40);
    stats.jobs++; return { mood, cad, conf, wav: Buffer.concat([b, pcm]), dur: pcm.length / 2 / SRo, ms: Date.now() - t0 }; });
  e.p.catch(err => { stats.failures++; wavs.delete(key); });
  lru(wavs, key, e, 200); return e.p;
}
// called by server.js wherever dialogue rows are created (broadcast / responses): start synthesis immediately
function prefetch(rows, urgent = false) {
  try { for (const row of Array.isArray(rows) ? rows : []) { if (!row || !row.speaker || !row.line) continue;
      for (const c of chunksOf(row.line).slice(0, 12)) wavFor(row.speaker, c, urgent).catch(() => {}); } } catch (e) { console.warn('[SidVoice] prefetch', e.message); }
  return rows;
}
function setProfiles(list) { let n = 0; for (const P of Array.isArray(list) ? list : []) if (P && P.name) { profiles.set(String(P.name), clampProfile(P)); n++; }
  startWorker(); if (worker && !stats.warmed) { stats.warmed = true; run({ type: 'warm' }, false).catch(() => {}); } return n; }
function install(app, express) {
  app.post('/voice/profiles', express.json({ limit: '200kb' }), (req, res) => res.json({ ok: true, profiles: setProfiles(req.body && req.body.profiles) }));
  // client posts every reply/subtitle line the moment it arrives (before range checks / queueing) so synthesis starts at once
  app.post('/voice/prefetch', express.json({ limit: '100kb' }), (req, res) => {
    const rows = (Array.isArray(req.body && req.body.rows) ? req.body.rows : []).slice(0, 12)
      .filter(r => r && typeof r.speaker === 'string' && typeof r.line === 'string').map(r => ({ speaker: r.speaker.slice(0, 70), line: r.line.slice(0, 4000) }));
    prefetch(rows, true); res.json({ ok: true, rows: rows.length });
  });
  app.get('/voice/line.wav', async (req, res) => {
    const speaker = String(req.query.speaker || ''), text = String(req.query.text || '').slice(0, 400); if (!speaker || !text) return res.status(400).end();
    const t0 = Date.now();
    try { const r = await wavFor(speaker, text, true, req.query.clock);
      res.set({ 'X-Voice-Mood': r.mood, 'X-Voice-Cadence': r.cad, 'X-Voice-Confidence': String(r.conf), 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Voice-Dur': r.dur.toFixed(3), 'X-Voice-Wait-Ms': String(Date.now() - t0), 'X-Voice-Synth-Ms': String(r.ms) }); res.end(r.wav);
    } catch (e) { res.status(503).json({ error: e.message }); }
  });
  app.get('/voice/status', (req, res) => res.json({ mode: SidMode.get(), disabled, queue: queue.length, busy, cachedLines: wavs.size, profiles: [...profiles.keys()], ...stats }));
  // warm Piper at server start so the first line is not slowed by model loading
  setTimeout(() => { startWorker(); if (worker && !stats.warmed) { stats.warmed = true; run({ type: 'warm' }, false).catch(e => console.warn('[SidVoice] warm failed', e.message)); } }, 1500);
}
module.exports = { withAccent, Accent, moodOf: (speaker, text) => Mood.moodOf(clean(text), profileOf(speaker).kind), cadenceOf: t => Mood.cadenceOf(clean(t)), confidenceOf: (speaker, text) => Mood.confOf(clean(text), profileOf(speaker)), install, prefetch, setProfiles, wavFor, chunksOf, profileOf, lsOf };
