'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Effects=require('../retort/sidEffectsLive'),Score=require('../retort/sidVoice/registerScore');
test('every existing effect and ambience design compiles to bounded live registers in both chip modes',()=>{
  for(const name of Effects.names)for(const chip of ['8580','10582'])for(const clock of ['1x','2x','4x']){
    const score=Effects.compile(name,{chip,clock}),engine=Score.createEngine(score.bytes,{sampleRate:22050});
    assert.equal(engine.info.model,chip);assert.equal(engine.info.kind,score.loop?'sid-ambience':'sid-effect');assert.equal(engine.info.chips,chip==='10582'?2:1);
    assert.ok(score.bytes.length<100000,name);assert.ok(engine.read(Math.min(22050,engine.info.samples)).every(Number.isFinite));
  }
});
test('procedural register designs are deterministic and invalid requests fail explicitly',()=>{
  for(const name of ['amb_water','amb_fire','door','amb_drone_A'])assert.deepEqual(Effects.compile(name,{calibrate:true}).bytes,Effects.compile(name,{calibrate:true}).bytes);
  for(const options of [{chip:'unknown'},{clock:'bad'}])assert.throws(()=>Effects.compile('hit',options),/Unknown/);
  assert.throws(()=>Effects.compile('../private'),/Unknown/);
  const source=fs.readFileSync('retort/sidEffectsLive.js','utf8');assert.ok(!source.includes('.render('));assert.ok(!source.includes('writeMono16Wav'));
});
test('ambience loop replay preserves chip state instead of retriggering its long attack',()=>{
  const score=Effects.compile('amb_wind'),warm=Score.createEngine(score.bytes,{sampleRate:22050}),cold=Score.createEngine(score.bytes,{sampleRate:22050});
  for(let i=0;i<Math.ceil(score.duration);i++)warm.read(22050);
  warm.restartLoop();const energy=x=>x.reduce((s,v)=>s+v*v,0);
  assert.ok(energy(warm.read(2205))>energy(cold.read(2205))*1.5);
});
