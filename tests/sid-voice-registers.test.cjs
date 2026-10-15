'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Voc=require('../retort/sidVoice/voc64'),Score=require('../retort/sidVoice/registerScore');
const {fixture}=require('./fixtures/sid-voice-input.cjs');
for(const chip of ['8580','10582'])for(const mode of ['1x','2x','4x'])test(chip+' '+mode+' register replay preserves the existing vocoder samples',()=>{
  const original=Voc.render(fixture(chip,mode)),engine=Score.createEngine(original.registerScore,{sampleRate:original.sr});
  assert.equal(engine.info.model,chip);assert.equal(engine.info.chips,64);assert.equal(engine.info.samples,original.length);
  let at=0,maxError=0;while(at<original.length){const chunk=engine.read(Math.min(2048,original.length-at));for(let n=0;n<chunk.length;n++)maxError=Math.max(maxError,Math.abs(chunk[n]-original[at+n]));at+=chunk.length;}
  assert.ok(maxError<1e-7,'sample error '+maxError);assert.ok(engine.info.events<engine.info.rawWrites);
});
test('resampled voice replay is finite and independent of chunk size',()=>{
  const original=Voc.render(fixture()),a=Score.createEngine(original.registerScore,{sampleRate:48000}),b=Score.createEngine(original.registerScore,{sampleRate:48000});
  const count=Math.round(a.info.seconds*48000),expected=a.read(count),actual=new Float32Array(count);
  let at=0;while(at<count){const chunk=b.read(Math.min(137,count-at));actual.set(chunk,at);at+=chunk.length;}
  assert.deepEqual(actual,expected);assert.ok(actual.every(Number.isFinite));assert.ok(actual.some(x=>Math.abs(x)>.001));
});
test('register scores reject truncation, invalid parameters, chip indices and gain',()=>{
  const original=Voc.render(fixture()).registerScore;
  assert.throws(()=>Score.createEngine(original.slice(0,-1)),/Invalid/);
  const bad=original.slice();new DataView(bad.buffer).setUint16(82,65535,true);assert.throws(()=>Score.createEngine(bad),/index/);
  assert.throws(()=>Score.withGain(original,Infinity),/parameters/);
  assert.throws(()=>Score.createEngine(original,{model:'unknown'}),/Choose/);
  assert.ok(!Buffer.from(original).includes(Buffer.from('RIFF')));
});
test('identical TEST and envelope strobes survive delta compression',()=>{
  const r=new Score.Recorder({chips:1,hz:800,nTicks:2,model:'10582',sampleRate:44100,clock:985248,cut:1,exact:true,samples:110,fadeSamples:0});
  for(let i=0;i<2;i++)r.tick([[0,4,24],[0,30,119],[0,0,50]]);
  const info=Score.inspect(r.finish());assert.equal(info.rawWrites,6);assert.equal(info.events,5);
});
test('compile-only speech reproduces the register program without running the SID bank',()=>{
  const {MultiSid}=require('../retort/sidVoice/jsid'),item=fixture(),expected=Voc.render(item).registerScore;
  const old=MultiSid.prototype.render;MultiSid.prototype.render=()=>{throw Error('Unexpected server audio render');};
  try{const compiled=Voc.compile(item);assert.deepEqual(compiled.registerScore,expected);assert.equal(compiled.serverPcm,undefined);}
  finally{MultiSid.prototype.render=old;}
});
test('combat vocalizations also contain only playable SID registers',()=>{
  const Cries=require('../retort/sidVoice/cries');for(const chip of ['8580','10582'])for(const what of Object.keys(Cries.SHAPES)){
    const score=Cries.compile(fixture().P,what,{chip}),engine=Score.createEngine(score.score);
    assert.equal(engine.info.chips,3);assert.equal(engine.info.model,chip);assert.ok(engine.read(22050).some(x=>Math.abs(x)>.001),chip+' '+what);
  }
});
