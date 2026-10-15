'use strict';
// Offline, matched-take comparisons. Does not contact or mutate the running game.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const Piper = require('../retort/sidVoice/piper'), Analysis = require('../retort/sidVoice/analyse');
const Profile = require('../retort/sidVoice/profile'), Mood = require('../retort/sidVoice/mood');
const Speech = require('../retort/sidVoice'), Voc = require('../retort/sidVoice/voc64');
const text = 'The gods sent Lanul through the ash, but grief could not break her promise.';
const CORPUS = [
  {id:'hard-words',text,targets:['gods','Lanul','ash','grief']},
  {id:'conversation',text:"Did you leave the brass key with Tarn? Good. Bring it back before the gate closes.",targets:['key','Tarn','gate']},
  {id:'names',text:"Mortacia's promise still stands. Suzerain, will you help us cross Tartarus?",targets:["Mortacia's",'Suzerain','Tartarus']}
];
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
  const rows = manifest.characters.map(c => `<section><h2>${esc(c.name)}${c.line?' / '+esc(c.line):''}</h2><p>${esc(c.text||manifest.text)}</p><p>${esc(c.guide)} analysis guide; F0 ${c.profile.f0} Hz; formant scale ${c.profile.fs}</p>${Object.entries(c.variants).map(([mode, v]) => `<label>${mode==='reference'?'Piper analysis reference (NOT SID, audition only)':esc(mode)}<audio controls preload="none" src="${esc(v.file)}"></audio>${v.liveFile?`<span><button data-sid-play="${esc(v.liveFile)}">Play SID</button> <button data-sid-pause="${esc(v.liveFile)}">Pause</button> <button data-sid-stop="${esc(v.liveFile)}">Stop</button> <a download href="${esc(v.liveFile)}">Register score</a></span>`:''}</label>`).join('')}</section>`).join('');
  const hasLive=manifest.characters.some(c=>Object.values(c.variants).some(v=>v.liveFile));
  const live=hasLive?`<p id="sid-audition-status" role="status">Play SID synthesizes registers live; the audio controls above play the WAV comparisons. Live scores require this page to be served by the game.</p><script>${fs.readFileSync(path.join(__dirname,'../assets/sidPlayer.js'),'utf8').replace(/<\/script/gi,'<\\/script')}</script><script>
  (()=>{let player=null,context=null,current='',generation=0;const source=${JSON.stringify(require('../retort/sidArchive').workerBundle()).replace(/</g,'\\u003c')},status=document.getElementById('sid-audition-status');
    const stop=()=>{generation++;player?.dispose();player=null;current='';};
    document.addEventListener('play',e=>{if(e.target.tagName==='AUDIO')stop();},true);
    document.querySelectorAll('[data-sid-play]').forEach(button=>button.onclick=async()=>{const file=button.dataset.sidPlay;
      if(player&&current===file){await player.play();status.textContent='Playing live SID: '+file;return;}
      stop();const ticket=generation;document.querySelectorAll('audio').forEach(a=>a.pause());
      try{context=context||new AudioContext();context.resume();status.textContent='Preparing SID register score...';
        const response=await fetch(file);if(!response.ok)throw Error('Voice score '+response.status);
        const bytes=await response.arrayBuffer();if(ticket!==generation)return;
        const next=await HolodekSidPlayer.open(bytes,{context,source,loop:false,onError:error=>{status.textContent='SID error: '+error.message;}});
        if(ticket!==generation){next.dispose();return;}player=next;current=file;next.onended=()=>{if(player===next){stop();status.textContent='SID ended.';}};await next.play();
        status.textContent='Playing live SID: '+next.info.chips+' chips. No WAV is being generated.';
      }catch(error){if(ticket===generation){stop();status.textContent='SID unavailable: '+error.message;}}
    });
    document.querySelectorAll('[data-sid-pause]').forEach(b=>b.onclick=()=>{if(current===b.dataset.sidPause){player?.pause();status.textContent='SID paused.';}});
    document.querySelectorAll('[data-sid-stop]').forEach(b=>b.onclick=()=>{if(current===b.dataset.sidStop){stop();status.textContent='SID stopped.';}});
    addEventListener('pagehide',()=>{stop();context?.close();});
  })();</script>`:'';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>10582 Voice Auditions</title><style>body{margin:3rem auto;padding:0 1rem;max-width:70rem;background:#171c1b;color:#e9e4d8;font:18px Georgia,serif}h1{font-size:2.6rem}section{border-top:1px solid #647e73;margin-top:2rem;padding:1rem 0}label{display:inline-flex;flex-direction:column;gap:.6rem;margin:0 2rem 1rem 0}audio{max-width:100%}p{line-height:1.5}button{font:inherit;cursor:pointer;background:#303c34;color:#e9e4d8;border:1px solid #647e73;padding:.5rem}a{color:#dfb56b}</style><h1>10582 Voice Auditions</h1><p>Legacy and detail are pure oscillator/noise/filter synthesis, with no sampled-speech layer. An optional, clearly labeled Piper reference is only a diagnostic source comparison, never mixed into the SID clips or game. These are test profiles, not edits to the adventure.</p><p>Each pair uses the exact same Piper take and voice profile. Compare word clarity, consonant harshness, personality and listening comfort. Signal measurements alone do not establish naturalness. Write down what you hear before reading the line; invented names should also be judged by ear, not only automatic word matching.</p>${rows}${live}</html>`;
}
async function main() {
  const mode = process.argv.includes('--4x') ? '4x' : '2x';
  const corpus = process.argv.includes('--corpus') ? CORPUS : CORPUS.slice(0,1);
  const reference = process.argv.includes('--reference');
  const dir = path.resolve(__dirname, '../sid/voice-auditions'); fs.mkdirSync(dir, { recursive: true });
  const manifest = { version: 2, rendererVersion: Voc.VERSION, synthesis: 'SID variants: oscillators-noise-filters-only',
    hasAnalysisReference:reference, mode, text, characters: [] };
  for (const raw of presets) {
    if(process.argv.includes('--mortacia')&&raw.name!=='Mortacia')continue;
    for(const line of corpus){
    const text=line.text;
    const profile = Profile.normalize(raw), mood = Mood.moodOf(text, profile.kind), cad = Mood.cadenceOf(text), conf = Mood.confOf(text, profile);
    const guide = profile.f0 < 150 ? 'ryan' : 'lj'; if (!Piper.hasVoice(guide)) throw new Error('Missing analysis guide: ' + guide);
    const P = Speech.withAccent({ ...Mood.applyMood(profile, mood, cad, conf), guide });
    const t0 = Date.now(), take = await Piper.synthPaced(text, Speech.lsOf(P), P.ns, P.pause, guide, { accent: P.accentName, emph: Speech.Accent.emphasisOf(text, mood) });
    if (!take.phones?.length) throw new Error('Phone-timed model required for this comparison');
    const frames = Analysis.analyse(take.audio), noiseFrames = Analysis.analyseNoise(take.audio);
    const character = { name: raw.name, line:line.id, text, targets:line.targets, phones:take.phones, profile, effectiveProfile: P, guide, sourceHash: crypto.createHash('sha256').update(Buffer.from(Float32Array.from(take.audio).buffer)).digest('hex'), analysisMs: Date.now() - t0, variants: {} };
    const stem=raw.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')+(process.argv.includes('--mortacia')?'-'+profile.f0+'hz':'')+(corpus.length>1?'-'+line.id:'');
    if(reference){const output=pcm(take.audio,take.sr),file=stem+'-reference-'+mode+'.wav';
      fs.writeFileSync(path.join(dir,file),output.wav);character.variants.reference={file,...output.metrics,synthesis:'Piper diagnostic reference only'};}
    for (const variant of ['legacy', 'detail']) {
      const start = Date.now(), samples = Voc.render({ P, frames, noiseFrames: variant === 'detail' ? noiseFrames : null,
        phones: take.phones, syl: take.syl, ph: take.ph, mode, chip: '10582', final: '.', cad });
      const output = pcm(samples, samples.sr, P.loud), file = stem + '-' + variant + '-' + mode + '.wav';
      fs.writeFileSync(path.join(dir, file), output.wav);
      character.variants[variant] = { file, ...output.metrics, articulation: samples.articulation || { mode: 'legacy' }, renderMs: Date.now() - start };
      if(process.argv.includes('--live')){
        const compiled=Voc.compile({P,frames,noiseFrames:variant==='detail'?noiseFrames:null,phones:take.phones,syl:take.syl,ph:take.ph,mode,chip:'10582',final:'.',cad});
        let peak=1e-9;for(const x of samples)peak=Math.max(peak,Math.abs(x));
        const liveFile=stem+'-'+variant+'-'+mode+'.sidvoice';fs.writeFileSync(path.join(dir,liveFile),require('../retort/sidVoice/registerScore').withGain(compiled.registerScore,Math.min(4,.7/peak)*Math.min(1.35,Math.max(.6,P.loud||1))));
        character.variants[variant].liveFile=liveFile;
      }
      process.stdout.write(JSON.stringify({ character: raw.name, variant, ...character.variants[variant] }) + '\n');
    }
    manifest.characters.push(character);
    }
  }
  const suffix = (corpus.length>1?'-corpus':'')+(process.argv.includes('--mortacia')?'-mortacia':'')+(mode === '4x' ? '-4x' : '');
  fs.writeFileSync(path.join(dir, 'manifest' + suffix + '.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, 'index' + suffix + '.html'), page(manifest));
  process.stdout.write('Audition page: /sid/voice-auditions/index' + suffix + '.html\n');
}
if (require.main === module) main().catch(e => { process.stderr.write(e.stack + '\n'); process.exitCode = 1; });
module.exports = { pcm, page, CORPUS };
