'use strict';
// Piper analysis -> 64-SID register score for live playback; WAV remains an explicit legacy endpoint.
// Synthesis starts the moment the server creates dialogue (prefetch), and room entry warms profiles + Piper.
const path = require('path'), crypto = require('crypto');
const { Worker } = require('worker_threads');
// Unit of synthesis = one sentence (same splitter as sfx.js speakLine), so the first sentence plays while later ones render.
const clean = s => String(s || '').replace(/([^.!?,;:\s])\s*\n+/g, '$1.\n').replace(/(\w)\s+["\u201c](?=\w)/g, '$1, ').replace(/(\w)["\u201d]\s+(?=\w)/g, '$1, ').replace(/["\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim();
const chunksOf = line => clean(line).split(/(?<=[.!?]['\u2019)\]]*)\s+(?=\S)/).map(clean).filter(Boolean);
const h = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const Mood = require('./mood'), VOC_VERSION = require('./voc64').VERSION || 1, SidMode = require('../sidMode');
const VoiceProfile = require('./profile');
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
function profileOf(name) {
  return profiles.get(VoiceProfile.keyOf(name)) || VoiceProfile.fallback(name);
}
// --- caches ---
const tracks = new Map(), trackSizes = new Map(), wavs = new Map();
function trimLines(){let bytes=0;for(const e of wavs.values())bytes+=e.bytes||0;
  while(wavs.size>200||bytes>24*1024*1024){const key=wavs.keys().next().value;bytes-=wavs.get(key).bytes||0;wavs.delete(key);}stats.lineCacheBytes=bytes;}
function trimTracks() {
  let frames = [...trackSizes.values()].reduce((sum, n) => sum + n, 0);
  while (tracks.size > 120 || frames > 60000) { const key = tracks.keys().next().value;
    frames -= trackSizes.get(key) || 0; tracks.delete(key); trackSizes.delete(key); }
  stats.analysisCacheFrames = frames;
}
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
const withAccent = P => { if ((process.env.SIDVOICE_ACCENT ?? '1') === '0') return Object.assign({}, P, { accentName: 'neutral' }); const a = Accent.accentOf(Object.assign({}, P, { accent: P.accent_ })), t = Accent.traitsOf(a);
  return Object.assign({}, P, { accentName: a, f0: P.f0 * (t.f0Mul || 1), rasp: Math.min(1, (P.rasp || 0) + (t.raspAdd || 0)), range: P.range * t.rangeMul, pull: P.pull ?? t.pull, accentMul: (P.accentMul ?? 1) * t.accentMul, rate: P.rate * t.rateMul, arch: t.arch, emphSt: 2.2 }); };
function track(text, ls, urgent, ns = 1, pm = 1, voice = 'lj', acc = null) {
  const k = voice + '|' + JSON.stringify(acc) + '|' + ls + '|' + ns + '|' + pm + '|' + text; if (tracks.has(k)) return lru(tracks, k, tracks.get(k), 120);
  const p = run({ type: 'track', text, ls, ns, pm, voice, acc }, urgent).then(m => {
    if (tracks.get(k) === p) { trackSizes.set(k, m.frames.length); trimTracks(); }
    stats.last.push({ text: text.slice(0, 40), ...m.ms }); if (stats.last.length > 20) stats.last.shift();
    return { frames: m.frames, noiseFrames: m.noiseFrames, syl: m.syl, ph: m.ph, phones: m.phones }; });
  p.catch(() => { if (tracks.get(k) === p) { tracks.delete(k); trackSizes.delete(k); trimTracks(); } });
  tracks.set(k, p); trimTracks(); return p;
}
let voiceChip = String(process.env.SIDVOICE_CHIP || '10582') === '10582' ? '10582' : '8580', voiceNotch = process.env.SIDVOICE_NOTCH === '1', voiceDetail = process.env.SIDVOICE_DETAIL !== '0'; /* voice chip (♫ panel, POST /voice/chip); per-request ?chip= overrides */
const chipOf = c => String(c) === '10582' ? '10582' : String(c) === '8580' ? '8580' : null;
function wavFor(speaker, text, urgent, mode, moodHint, chip, notch, options = {}) {
  const format=options.format==='score'?'score':'wav';
  mode = SidMode.norm(mode) || SidMode.get(); chip = chipOf(chip) || voiceChip; notch = chip === '10582' && (notch == null ? voiceNotch : !!notch); text = clean(text);
  const detail = chip === '10582' && (options.detail ?? voiceDetail) && process.env.SIDVOICE_DETAIL !== '0';
  const P0 = options.profile ? VoiceProfile.normalize({ ...options.profile, name: speaker }) : profileOf(speaker), cad = Mood.cadenceOf(text), mood = Mood.moodOf(text, P0.kind, moodHint), conf = Mood.confOf(text, P0);
  text = Mood.hesitate(text, conf);
  const P = withAccent(Object.assign(Mood.applyMood(P0, mood, cad, conf), { guide: guideOf(P0) })), acc = { accent: P.accentName, emph: Accent.emphasisOf(text, mood) }, key = h('a1|'+format+'|cry'+!!options.cry+'|' + JSON.stringify(acc) + '|' + 'v' + VOC_VERSION + '|detail' + detail + '|' + JSON.stringify(DIGI) + '|' + mode + '|chip' + chip + (notch ? 'n' : '') + '|' + mood + '|' + cad + '|' + conf + '|' + JSON.stringify(P) + '|' + text);
  if (wavs.has(key)) { const e = lru(wavs, key, wavs.get(key), 200); if (urgent) e.urgent = true; return e.p; }
  const t0 = Date.now(), e = { urgent };
  // renders are short: always run them ahead of queued analyses
  const prepared=options.cry?run({type:'cry',P,what:text,mode,chip},urgent):track(text, lsOf(P), urgent, +P.ns.toFixed(3), +(P.pause || 1).toFixed(2), P.guide, acc).then(tk => run({ type: format==='score'?'score':'render', P, frames: tk.frames, noiseFrames: detail ? tk.noiseFrames : null, syl: tk.syl, ph: tk.ph, phones: tk.phones, audio: null, digi: null, mode, chip, notch, cad, final: /\?\s*$/.test(text) ? '?' : '.' }, true));
  e.p = prepared.then(m => {
    const articulation=m.articulation||{mode:'legacy'},renders=stats.renders||(stats.renders=[]);
    renders.push({speaker,chip,format,articulation,f0:P0.f0,fs:P0.fs,...m.ms});if(renders.length>20)renders.shift();stats.jobs++;
    if(format==='score'){
      const score=Buffer.from(m.score.buffer,m.score.byteOffset,m.score.byteLength);e.bytes=score.length;trimLines();
      return{mood,cad,conf,articulation,score,dur:m.dur,ms:Date.now()-t0};
    }
    const pcm = Buffer.from(m.pcm.buffer, m.pcm.byteOffset, m.pcm.byteLength), b = Buffer.alloc(44), SRo = m.sr || 22050;
    b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(SRo, 24); b.writeUInt32LE(SRo * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length, 40);
    e.bytes=b.length+pcm.length;trimLines();return { mood, cad, conf, articulation, wav: Buffer.concat([b, pcm]), dur: pcm.length / 2 / SRo, ms: Date.now() - t0 }; });
  e.p.catch(err => { stats.failures++; wavs.delete(key); });
  lru(wavs, key, e, 200); return e.p;
}
function scoreFor(speaker,text,urgent,mode,moodHint,chip,notch,options={}){return wavFor(speaker,text,urgent,mode,moodHint,chip,notch,{...options,format:'score'});}
function cryFor(speaker,text,urgent,mode,moodHint,chip,notch,options={}){return wavFor(speaker,text,urgent,mode,moodHint,chip,notch,{...options,format:'score',cry:true});}
// called by server.js wherever dialogue rows are created (broadcast / responses): start synthesis immediately
function prefetch(rows, urgent = false) {
  try { for (const row of Array.isArray(rows) ? rows : []) { if (!row || !row.speaker || !row.line) continue;
      for (const c of chunksOf(row.line).slice(0, 12)) scoreFor(row.speaker, c, urgent).catch(() => {}); } } catch (e) { console.warn('[SidVoice] prefetch', e.message); }
  return rows;
}
function setProfiles(list) { let n = 0; for (const P of Array.isArray(list) ? list : []) if (P && P.name) { profiles.set(VoiceProfile.keyOf(P.name), VoiceProfile.normalize(P)); n++; }
  startWorker(); if (worker && !stats.warmed) { stats.warmed = true; run({ type: 'warm' }, false).catch(() => {}); } return n; }
function install(app, express) {
  app.post('/voice/profiles', express.json({ limit: '200kb' }), (req, res) => res.json({ ok: true, profiles: setProfiles(req.body && req.body.profiles) }));
  // client posts every reply/subtitle line the moment it arrives (before range checks / queueing) so synthesis starts at once
  app.post('/voice/prefetch', express.json({ limit: '100kb' }), (req, res) => {
    const rows = (Array.isArray(req.body && req.body.rows) ? req.body.rows : []).slice(0, 12)
      .filter(r => r && typeof r.speaker === 'string' && typeof r.line === 'string').map(r => ({ speaker: r.speaker.slice(0, 70), line: r.line.slice(0, 4000) }));
    prefetch(rows, true); res.json({ ok: true, rows: rows.length });
  });
  const serveLine = (format,cry=false) => async (req, res) => {
    const q = req.method === 'POST' ? req.body || {} : req.query;
    const speaker = String(q.speaker || '').slice(0, 100), text = String(q.text || '').slice(0, 2000); if (!speaker || !text) return res.status(400).end();
    const profile = q.profile && typeof q.profile === 'object' && !Array.isArray(q.profile) ? { ...q.profile, name: speaker } : null;
    if (profile) profiles.set(VoiceProfile.keyOf(speaker), VoiceProfile.normalize(profile));
    const t0 = Date.now();
    if(cry&&!Object.hasOwn(require('./cries').SHAPES,text))return res.status(400).json({error:'Unknown SID vocalization'});
    try { const r = await (cry?cryFor:format==='score'?scoreFor:wavFor)(speaker, text, true, q.clock, undefined, q.chip, q.notch == null ? undefined : q.notch === true || q.notch === '1', { profile, detail: q.detail == null ? undefined : q.detail !== false && q.detail !== '0' });
      res.set({ 'X-Voice-Mood': r.mood, 'X-Voice-Cadence': r.cad, 'X-Voice-Confidence': String(r.conf), 'X-Voice-Articulation': r.articulation.mode,
        'Content-Type': format==='score'?'application/x-holodek-sid-voice':'audio/wav', 'X-Voice-Transport':format==='score'?'sid-registers':'rendered-wav',
        'Cache-Control': 'no-store', 'X-Voice-Dur': r.dur.toFixed(6), 'X-Voice-Wait-Ms': String(Date.now() - t0), 'X-Voice-Synth-Ms': String(r.ms) }); res.end(format==='score'?r.score:r.wav);
    } catch (e) { res.status(503).json({ error: e.message }); }
  };
  app.get('/voice/line.wav', serveLine('wav'));
  app.post('/voice/line.wav', express.json({ limit: '16kb' }), serveLine('wav'));
  app.post('/voice/line.sidvoice', express.json({limit:'16kb'}),serveLine('score'));
  app.post('/voice/cry.sidvoice', express.json({limit:'16kb'}),serveLine('score',true));
  app.get('/voice/chip', (req, res) => res.json({ chip: voiceChip, notch: voiceNotch, detail: voiceDetail }));
  app.post('/voice/chip', express.json({ limit: '1kb' }), (req, res) => { const c = chipOf(req.body && req.body.chip); if (c) voiceChip = c; if (req.body && 'notch' in req.body) voiceNotch = !!req.body.notch;
    if (req.body && typeof req.body.detail === 'boolean') voiceDetail = req.body.detail && process.env.SIDVOICE_DETAIL !== '0';
    console.info('[SidVoice] voice chip', voiceChip, voiceNotch ? '+notch' : '', voiceDetail ? 'detail' : 'legacy'); res.json({ chip: voiceChip, notch: voiceNotch, detail: voiceDetail }); });
  app.get('/voice/status', (req, res) => res.json({ mode: SidMode.get(), chip: voiceChip, notch: voiceNotch, detail: voiceDetail, synthesis: 'oscillators-noise-filters-only', transport:'live-register-score',chips:64,profileVersion: VoiceProfile.VERSION,
    disabled, queue: queue.length, busy, cachedLines: wavs.size, profiles: [...profiles.values()].map(P => P.name), voiceProfiles: [...profiles.values()], ...stats }));
  // warm Piper at server start so the first line is not slowed by model loading
  setTimeout(() => { startWorker(); if (worker && !stats.warmed) { stats.warmed = true; run({ type: 'warm' }, false).catch(e => console.warn('[SidVoice] warm failed', e.message)); } }, 1500);
}
module.exports = { withAccent, Accent, moodOf: (speaker, text) => Mood.moodOf(clean(text), profileOf(speaker).kind), cadenceOf: t => Mood.cadenceOf(clean(t)), confidenceOf: (speaker, text) => Mood.confOf(clean(text), profileOf(speaker)), install, prefetch, setProfiles, wavFor, scoreFor, chunksOf, profileOf, lsOf };
