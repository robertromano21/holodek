'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const Voc=require('../retort/sidVoice/voc64'),Score=require('../retort/sidVoice/registerScore');
const {fixture}=require('./fixtures/sid-voice-input.cjs');
const {pcm,readTake,SMOOTH_VARIANTS}=require('../tools/audition-sid-voices.cjs');

test('smoothing is opt-in and cannot change an 8580 render',()=>{
  const original=fixture();
  assert.deepEqual(Voc.render(original),Voc.render({...original,k:{smoothLevels:false}}));
  const classic=fixture('8580');
  assert.deepEqual(Voc.render(classic),Voc.render({...classic,k:{smoothLevels:true}}));
});

test('continuous harmonic levels avoid coarse gate retriggers and leave noise writes alone',()=>{
  const item=fixture(),a=Voc.voice(item),b=Voc.voice({...item,k:{smoothLevels:true}});
  let gates=0;
  for(let n=0;n<120;n++){
    const before=a.ticks(n),after=b.ticks(n);
    assert.deepEqual(after.filter(w=>w[0]>=51),before.filter(w=>w[0]>=51));
    for(const [c,r,v]of after)if(c>=1&&c<=44&&r<21&&r%7===4){assert.equal(v&1,1);gates++;}
  }
  assert.ok(gates>1000);
});

test('harmonic level ramps use more than the old 45 loudness steps',()=>{
  const item=fixture('10582','2x','lj',160);
  item.P.neutral=true;
  item.frames=item.frames.map((f,i)=>[205,f[1].map(v=>v+Math.log(.02+.98*i/159)),f[2]]);
  const voice=Voc.voice({...item,k:{smoothLevels:true}}),levels=new Set(),state=[0,0,0];
  for(let n=0;n<300;n++){
    for(const [c,r,v]of voice.ticks(n))if(c===1&&r>=25&&r<=27)state[r-25]=v;
    levels.add(state.reduce((a,b)=>a+b,0));
  }
  assert.ok(levels.size>45,String(levels.size));
});

for(const mode of ['1x','2x','4x'])test('smooth '+mode+' score replay matches render without PCM or new registers',()=>{
  const item={...fixture('10582',mode),k:SMOOTH_VARIANTS.soft},samples=Voc.render(item),compiled=Voc.compile(item);
  assert.deepEqual(compiled.registerScore,samples.registerScore);
  const engine=Score.createEngine(compiled.registerScore,{sampleRate:samples.sr});let error=0;
  for(let at=0;at<samples.length;at+=4096){const chunk=engine.read(Math.min(4096,samples.length-at));for(let i=0;i<chunk.length;i++)error=Math.max(error,Math.abs(chunk[i]-samples[at+i]));}
  assert.ok(error<1e-7,String(error));assert.ok(samples.every(Number.isFinite));
  assert.equal(compiled.serverPcm,undefined);
  assert.deepEqual(Voc.render({...item,audio:new Float32Array(10000).fill(1),digi:{mix:'full'}}),samples);
});

test('audition comparison matches RMS rather than disguising smoothing with lower volume',()=>{
  const a=Float32Array.from({length:1000},(_,i)=>.1*Math.sin(i*.2)),b=Float32Array.from(a,x=>x*.3);
  const reference=pcm(a,44100),candidate=pcm(b,44100,1,reference.metrics.rms);
  assert.ok(Math.abs(candidate.metrics.rms-reference.metrics.rms)<.00003);
  assert.equal(candidate.metrics.clipped,0);
  assert.throws(()=>pcm(Float32Array.from([NaN]),44100),/Non-finite/);
});

test('saved analysis takes replay exact float samples and reject altered source hashes',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sid-take-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const audio=Float32Array.from([.001,.2,-.15,0]),bytes=Buffer.from(audio.buffer),hash=crypto.createHash('sha256').update(bytes).digest('hex'),file=path.join(dir,'take.json');
  fs.writeFileSync(file,JSON.stringify({version:1,sr:22050,phones:[{c:'a',t0:0,t1:.1}],ph:'a',syl:[2],audio:bytes.toString('base64')}));
  assert.deepEqual(readTake(file,hash).audio,audio);
  assert.throws(()=>readTake(file,'changed'),/Invalid or changed/);
});
