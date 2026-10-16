'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Effects=require('../retort/sidEffectsLive'),Converter=require('../retort/sidToWav');
const source=fs.readFileSync('assets/sidPlayer.js','utf8'),workerSource=fs.readFileSync('assets/sidLiveWorker.js','utf8');

async function render(bytes,sampleRate=44100){
  let result;const self={postMessage:d=>result=d},context={self,Converter,Float32Array,Math,Number};
  vm.runInNewContext(workerSource,context);await self.onmessage({data:{action:'effect-buffer',id:1,bytes,sampleRate}});return result;
}

test('short cached SID frames match streaming synthesis including gain, fades and device resampling',async()=>{
  for(const chip of ['8580','10582'])for(const sampleRate of [44100,48000]){
    const score=Effects.compile('step1',{chip}),result=await render(score.bytes,sampleRate);
    assert.equal(result.error,undefined);assert.equal(result.effectBuffer,true);
    const engine=Converter.createEngine(score.bytes,{sampleRate}),samples=new Float32Array(result.samples),fade=sampleRate*.005;
    const raw=engine.read(samples.length);
    for(let i=0;i<samples.length;i++)assert.equal(samples[i],Math.fround(Math.max(-.98,Math.min(.98,raw[i]))*Math.min(1,i/fade,(samples.length-1-i)/fade)));
  }
});

test('short-effect worker explicitly refuses ambience and voice scores',async()=>{
  const ambience=await render(Effects.compile('amb_water').bytes);assert.match(ambience.error,/Only short/);
  const voice=require('../retort/sidVoice/voc64').compile(require('./fixtures/sid-voice-input.cjs').fixture()).registerScore;
  assert.match((await render(voice)).error,/Only short/);
});

function fixture(){
  const workers=[];
  class Worker{
    constructor(){this.messages=[];workers.push(this);}
    postMessage(d){this.messages.push(d);}
    terminate(){this.terminated=true;}
    respond(id,samples=[.1,.2,.1,0]){this.onmessage({data:{effectBuffer:true,id,sampleRate:44100,seconds:samples.length/44100,samples:Float32Array.from(samples).buffer}});}
  }
  const context={WeakMap,URL,Blob,Worker,DOMException,setTimeout,clearTimeout,Float32Array,Number,Math,Map,Promise};
  vm.runInNewContext(source,context);
  const audio={sampleRate:44100,createBuffer(channels,length,sampleRate){const data=new Float32Array(length);return{length,sampleRate,copyToChannel:x=>data.set(x),getChannelData:()=>data};}};
  return{Cache:context.HolodekSidPlayer.EffectCache,audio,workers};
}

test('one worker deduplicates preparations and reuses cached frames without new render requests',async()=>{
  const f=fixture(),cache=new f.Cache(f.audio,'source');
  const a=cache.get('step1',new ArrayBuffer(8)),b=cache.get('step1',new ArrayBuffer(8));assert.equal(a,b);
  f.workers[0].respond(1);const buffer=await a;
  assert.equal(await cache.get('step1',new ArrayBuffer(8)),buffer);
  assert.equal(f.workers.length,1);assert.equal(f.workers[0].messages.length,1);assert.equal(cache.stats().hits,1);
  cache.dispose();
});

test('the effect cache has an explicit byte budget and evicts least recently used buffers',async()=>{
  const f=fixture(),cache=new f.Cache(f.audio,'source',{maxBytes:16});
  const first=cache.get('a',new ArrayBuffer(8));f.workers[0].respond(1);await first;
  const second=cache.get('b',new ArrayBuffer(8));f.workers[0].respond(2);await second;
  assert.equal(cache.stats().entries,1);assert.equal(cache.stats().bytes,16);
  assert.ok(!cache.buffers.has('a'));cache.dispose();
});

test('cancellation rejects pending work and worker errors never produce a fallback buffer',async()=>{
  const f=fixture(),cache=new f.Cache(f.audio,'source');
  const a=cache.get('a',new ArrayBuffer(8));f.workers[0].onmessage({data:{effectBuffer:true,id:1,error:'bad SID'}});
  await assert.rejects(a,/bad SID/);assert.equal(cache.stats().entries,0);
  const b=cache.get('b',new ArrayBuffer(8));cache.dispose();await assert.rejects(b,{name:'AbortError'});
  assert.equal(f.workers[0].terminated,true);assert.equal(cache.stats().bytes,0);
});

test('walking starts a footstep on initial motion, preserves cadence, and ignores teleports',()=>{
  const sfx=fs.readFileSync('assets/sfx.js','utf8'),calls=[],context={window:{playerPosX:0,playerPosY:0},performance:{now:()=>context.time},time:0,
    currentRoomKey:()=>context.room,room:'0,0,0',play:(...args)=>calls.push(args),Math};
  const start=sfx.indexOf("  let walkingRoom="),end=sfx.indexOf('  function tick()',start);
  vm.runInNewContext('let lastX=null,lastY=null,walked=0,stepAlt=false;'+sfx.slice(start,end)+';this.walk=walkTick;',context);
  context.walk();context.time=16;context.window.playerPosX=.01;context.walk();assert.equal(calls.length,1);
  context.time=32;context.window.playerPosX=.02;context.walk();assert.equal(calls.length,1);
  context.time=48;context.window.playerPosX=1;context.walk();assert.equal(calls.length,2);
  context.time=64;context.window.playerPosX=20;context.walk();assert.equal(calls.length,2);
  context.room='1,0,0';context.window.playerPosX=1;context.walk();assert.equal(calls.length,2);
});
