'use strict';
// Offline, matched-take comparisons. Does not contact or mutate the running game.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const Piper = require('../retort/sidVoice/piper'), Analysis = require('../retort/sidVoice/analyse');
const Profile = require('../retort/sidVoice/profile'), Mood = require('../retort/sidVoice/mood');
const Speech = require('../retort/sidVoice'), Voc = require('../retort/sidVoice/voc64');
const text = 'The gods sent Lanul through the ash, but grief could not break her promise.';
const presets = [
  { name: 'Mortacia', kind: 'regal', accent: 'midatl' },
  { name: 'Vessa Reedwake', kind: 'humanoid', race: 'Elf', accent: 'elf', f0: 211, fs: 1.16, range: 4.4, rate: 5, breath: 0.13, rasp: 0.02, warm: 0.12, bright: 1.1, vibAmt: 0.6, vibRate: 5.8, pauses: 0.9 },
  { name: 'Orro Flintcup', kind: 'humanoid', race: 'Dwarf', accent: 'northern', f0: 106, fs: 0.86, range: 2.7, rate: 4.1, breath: 0.08, rasp: 0.3, warm: 0.3, bright: 0.88, vibAmt: 0.9, vibRate: 4.3, pauses: 1.15 }
];
function pcm(samples, sr, loud = 1) {
  let peak = 1e-9; for (const v of samples) { if (!Number.isFinite(v)) throw new Error('Non-finite synthesized sample'); peak = Math.max(peak, Math.abs(v)); }
  const gain = Math.min(4, 0.7 / peak) * Math.min(1.35, Math.max(0.6, loud)), bytes = Buffer.alloc(samples.length * 2);
  let e = 0, pk = 0, jumps = 0, prev = 0, clipped = 0;
  for (let i = 0; i < samples.length; i++) { const raw = Math.round(samples[i] * gain * 32767), v = Math.max(-32767, Math.min(32767, raw));
    bytes.writeInt16LE(v, i * 2); e += (v / 32767) ** 2; pk = Math.max(pk, Math.abs(v / 32767));
    if (Math.abs(v / 32767 - prev) > 0.2) jumps++; if (Math.abs(raw) > 32767) clipped++; prev = v / 32767; }
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + bytes.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(bytes.length, 40);
  return { wav: Buffer.concat([header, bytes]), metrics: { duration: samples.length / sr, sampleRate: sr, rms: Math.sqrt(e / samples.length), peak: pk, clipped, largeSampleSteps: jumps } };
}
function page(manifest) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rows = manifest.characters.map(c => `<section><h2>${esc(c.name)}</h2><p>${esc(c.guide)} analysis guide; F0 ${c.profile.f0} Hz; formant scale ${c.profile.fs}</p>${Object.entries(c.variants).map(([mode, v]) => `<label>${esc(mode)}<audio controls preload="none" src="${esc(v.file)}"></audio></label>`).join('')}</section>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>10582 Voice Auditions</title><style>body{margin:3rem auto;padding:0 1rem;max-width:70rem;background:#171c1b;color:#e9e4d8;font:18px Georgia,serif}h1{font-size:2.6rem}section{border-top:1px solid #647e73;margin-top:2rem;padding:1rem 0}label{display:inline-flex;flex-direction:column;gap:.6rem;margin:0 2rem 1rem 0}audio{max-width:100%}p{line-height:1.5}</style><h1>10582 Voice Auditions</h1><p>All audible output is synthesized by emulated oscillators, noise and filters. No sampled-speech layer. These are test profiles, not edits to the adventure.</p><p>${esc(manifest.text)}</p><p>Each character's pair uses the exact same Piper take and voice profile. Compare word clarity, consonant harshness, personality and listening comfort. Signal measurements alone do not establish naturalness.</p>${rows}</html>`;
}
async function main() {
  const mode = process.argv.includes('--4x') ? '4x' : '2x';
  const dir = path.resolve(__dirname, '../sid/voice-auditions'); fs.mkdirSync(dir, { recursive: true });
  const manifest = { version: 1, rendererVersion: Voc.VERSION, synthesis: 'oscillators-noise-filters-only', mode, text, characters: [] };
  for (const raw of presets) {
    const profile = Profile.normalize(raw), mood = Mood.moodOf(text, profile.kind), cad = Mood.cadenceOf(text), conf = Mood.confOf(text, profile);
    const guide = profile.f0 < 150 ? 'ryan' : 'lj'; if (!Piper.hasVoice(guide)) throw new Error('Missing analysis guide: ' + guide);
    const P = Speech.withAccent({ ...Mood.applyMood(profile, mood, cad, conf), guide });
    const t0 = Date.now(), take = await Piper.synthPaced(text, Speech.lsOf(P), P.ns, P.pause, guide, { accent: P.accentName, emph: Speech.Accent.emphasisOf(text, mood) });
    if (!take.phones?.length) throw new Error('Phone-timed model required for this comparison');
    const frames = Analysis.analyse(take.audio), noiseFrames = Analysis.analyseNoise(take.audio);
    const character = { name: raw.name, profile, effectiveProfile: P, guide, sourceHash: crypto.createHash('sha256').update(Buffer.from(Float32Array.from(take.audio).buffer)).digest('hex'), analysisMs: Date.now() - t0, variants: {} };
    for (const variant of ['legacy', 'detail']) {
      const start = Date.now(), samples = Voc.render({ P, frames, noiseFrames: variant === 'detail' ? noiseFrames : null,
        phones: take.phones, syl: take.syl, ph: take.ph, mode, chip: '10582', final: '.', cad });
      const output = pcm(samples, samples.sr, P.loud), file = raw.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + variant + '-' + mode + '.wav';
      fs.writeFileSync(path.join(dir, file), output.wav);
      character.variants[variant] = { file, ...output.metrics, articulation: samples.articulation || { mode: 'legacy' }, renderMs: Date.now() - start };
      process.stdout.write(JSON.stringify({ character: raw.name, variant, ...character.variants[variant] }) + '\n');
    }
    manifest.characters.push(character);
  }
  const suffix = mode === '4x' ? '-4x' : '';
  fs.writeFileSync(path.join(dir, 'manifest' + suffix + '.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, 'index' + suffix + '.html'), page(manifest));
  process.stdout.write('Audition page: /sid/voice-auditions/index' + suffix + '.html\n');
}
if (require.main === module) main().catch(e => { process.stderr.write(e.stack + '\n'); process.exitCode = 1; });
module.exports = { pcm, page };
