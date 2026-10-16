'use strict';
// Worker thread: Piper synth -> analysis (track) and 64-SID render, off the game server's event loop.
const { parentPort } = require('worker_threads');
const piper = require('./piper'), { analyse, analyseNoise } = require('./analyse'), voc = require('./voc64');
const Timbre = require('./timbre');
parentPort.on('message', async job => {
  try {
    if(job.type==='cry'){const t0=Date.now(),result=require('./cries').compile(job.P,job.what,{chip:job.chip,mode:job.mode});return parentPort.postMessage({id:job.id,ok:true,...result,articulation:{mode:'sid-vocalization'},ms:{render:Date.now()-t0}},[result.score.buffer]);}
    if(job.type==='score'){
      const t0=Date.now(),style=Timbre.config(job.timbre,job.chip),compiled=voc.compile({...job,k:style.k}),gain=1.5*style.gain*Math.min(1.35,Math.max(.6,job.P.loud||1));
      const score=require('./registerScore').withGain(compiled.registerScore,gain);
      return parentPort.postMessage({id:job.id,ok:true,score,dur:compiled.length/compiled.sr,articulation:compiled.articulation||{mode:'legacy'},ms:{compile:Date.now()-t0,serverPcm:!!compiled.serverPcm}},[score.buffer]);
    }
    if (job.type === 'warm') { await piper.load(); return parentPort.postMessage({ id: job.id, ok: true }); }
    if (job.type === 'track') { const t0 = Date.now(), { audio, sr, syl, ph, phones } = await piper.synthPaced(job.text, job.ls, job.ns, job.pm || 1, job.voice || 'lj', job.acc || null); const t1 = Date.now();
      if (sr !== 22050) throw new Error('model rate ' + sr);
      const frames = analyse(audio), t2 = Date.now(), noiseFrames = analyseNoise(audio);
      return parentPort.postMessage({ id: job.id, ok: true, frames, noiseFrames, syl, ph, phones, ms: { piper: t1 - t0, analyse: t2 - t1, detail: Date.now() - t2 } }); }
    if (job.type === 'render') { const t0 = Date.now(), d = voc.render({ chip: job.chip, notch: job.notch, P: job.P, frames: job.frames, noiseFrames: job.noiseFrames, final: job.final, mode: job.mode, cad: job.cad, syl: job.syl, ph: job.ph, phones: job.phones, k:Timbre.config(job.timbre,job.chip).k });
      let pk = 1e-9; for (const v of d) pk = Math.max(pk, Math.abs(v)); const g = Math.min(4, 0.7 / pk) * Math.min(1.35, Math.max(0.6, job.P.loud || 1)) /* mood loudness */;
      const pcm = new Int16Array(d.length);
      for (let i = 0; i < d.length; i++) pcm[i] = Math.max(-32767, Math.min(32767, Math.round(d[i] * g * 32767)));
      return parentPort.postMessage({ id: job.id, ok: true, pcm, sr: d.sr || 22050, articulation: d.articulation || { mode: 'legacy' }, ms: { render: Date.now() - t0 } }, [pcm.buffer]); }
  } catch (e) { parentPort.postMessage({ id: job.id, ok: false, error: String(e && e.message || e) }); }
});
