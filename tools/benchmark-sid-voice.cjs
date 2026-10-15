'use strict';
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const Piper=require('../retort/sidVoice/piper'),Analysis=require('../retort/sidVoice/analyse'),Speech=require('../retort/sidVoice'),Profile=require('../retort/sidVoice/profile'),Mood=require('../retort/sidVoice/mood'),Voc=require('../retort/sidVoice/voc64'),Score=require('../retort/sidVoice/registerScore');
(async()=>{
  const text='The gods sent Lanul through the ash, but grief could not break her promise.',P0=Profile.normalize({name:'Mortacia'}),cad=Mood.cadenceOf(text),mood=Mood.moodOf(text,P0.kind),conf=Mood.confOf(text,P0);
  const P=Speech.withAccent({...Mood.applyMood(P0,mood,cad,conf),guide:'lj'}),start=performance.now();
  const take=await Piper.synthPaced(text,Speech.lsOf(P),P.ns,P.pause,'lj',{accent:P.accentName,emph:Speech.Accent.emphasisOf(text,mood)});
  const item={P,frames:Analysis.analyse(take.audio),noiseFrames:Analysis.analyseNoise(take.audio),phones:take.phones,syl:take.syl,ph:take.ph,chip:'10582',mode:'2x',final:'.',cad};
  const analysisMs=performance.now()-start,a=performance.now(),samples=Voc.render(item),renderMs=performance.now()-a,b=performance.now(),compiled=Voc.compile(item),compileMs=performance.now()-b;
  const engine=Score.createEngine(compiled.registerScore,{sampleRate:samples.sr});let error=0;
  for(let at=0;at<samples.length;at+=4096){const chunk=engine.read(Math.min(4096,samples.length-at));for(let i=0;i<chunk.length;i++)error=Math.max(error,Math.abs(chunk[i]-samples[at+i]));}
  const report={pass:error<1e-7&&compiled.articulation?.mode==='detail'&&!compiled.serverPcm,seconds:samples.length/samples.sr,analysisMs,renderMs,compileMs,renderStageSpeedup:renderMs/compileMs,totalStageSpeedup:(analysisMs+renderMs)/(analysisMs+compileMs),maxReplaySampleError:error,
    note:'Single matched-take local measurement; excludes browser startup, network transfer, and live client CPU. Analysis is still required. Gain policy is separate from oscillator replay equivalence.'};
  const directory=path.resolve(__dirname,'../.retort-data/voice-scores');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'compile-benchmark.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
})().catch(error=>{console.error(error);process.exitCode=1;});
