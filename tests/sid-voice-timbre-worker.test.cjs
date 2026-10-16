'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{Worker}=require('node:worker_threads');
const Timbre=require('../retort/sidVoice/timbre'),Voc=require('../retort/sidVoice/voc64'),Score=require('../retort/sidVoice/registerScore'),{fixture}=require('./fixtures/sid-voice-input.cjs');

test('production worker compiles the listening-selected Soft program without rendering PCM',async t=>{
  const worker=new Worker(path.resolve('retort/sidVoice/worker.js'));t.after(()=>worker.terminate());
  const item={...fixture(),type:'score',id:1,timbre:'soft'};
  for(let i=25;i<28;i++)item.frames[i][0]=0;
  const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage(item);});
  assert.equal(result.ok,true);assert.equal(result.ms.serverPcm,false);
  const expected=Score.withGain(Voc.compile({...item,k:Timbre.STYLES.soft.k}).registerScore,1.5*Timbre.STYLES.soft.gain);
  assert.deepEqual(result.score,expected);
  const baseline=require('../tools/experiment-sid-voices.cjs').BASELINE_K;
  assert.notDeepEqual(result.score,Score.withGain(Voc.compile({...item,k:baseline}).registerScore,1.5*Timbre.STYLES.soft.gain));
});

test('style selection has no extended settings or gain compensation on an 8580',()=>{
  assert.equal(Timbre.effective('soft','8580'),'original');assert.equal(Timbre.config('soft','8580').k,null);
  assert.equal(Timbre.config('soft','8580').gain,1);assert.throws(()=>Timbre.config('not a style','10582'),/Unsupported/);
});

test('Soft preserves measured gaps per request without changing the comparison styles or later calls',()=>{
  const frames=[205,0,0,0,205,0,0,0,0,0,0,205].map(x=>[x,[0],[.1,.1,.1]]),before=structuredClone(frames);
  const normal=Voc.cleanF0(frames),soft=Voc.cleanF0(frames,Timbre.STYLES.soft.k);
  assert.deepEqual(soft.map(f=>f[0]),frames.map(f=>f[0]));
  assert.ok(normal.every(f=>f[0]>0));assert.deepEqual(Voc.cleanF0(frames),normal);
  assert.deepEqual(frames,before);
  assert.equal(Timbre.STYLES.original.k,null);
  assert.equal(Timbre.STYLES.continuous.k.gapMin,undefined);
  assert.equal(Timbre.STYLES.continuous.k.gapMax,undefined);
});

test('per-request gap controls cannot alter stock 8580 register programs',()=>{
  const item=fixture('8580');for(let i=25;i<28;i++)item.frames[i][0]=0;
  const baseline=Voc.compile(item).registerScore;
  assert.deepEqual(Voc.compile({...item,k:{gapMin:0,gapMax:0}}).registerScore,baseline);
});
