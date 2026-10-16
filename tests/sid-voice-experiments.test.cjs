'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{execFileSync}=require('node:child_process');
const {Worker}=require('node:worker_threads');
const {VARIANTS,BASELINE_K,workerEnvironment}=require('../tools/experiment-sid-voices.cjs');
const {CORPUS,HOLDOUT}=require('../tools/audition-sid-voices.cjs');

test('each clarity candidate changes only its named subsystem and keeps environment isolated',()=>{
  assert.deepEqual(VARIANTS.soft,{factor:'listening-selected baseline',k:{},env:{}});
  assert.deepEqual(VARIANTS.release_bed.k,{bedDb:7});
  assert.deepEqual(VARIANTS.transition_gaps.k,{gapMin:0});
  assert.deepEqual(VARIANTS.transition_gaps.env,{SIDVOICE_GAP:'0'});
  assert.deepEqual(VARIANTS.noise_less.k,{gNv:.36});
  assert.deepEqual(VARIANTS.noise_more.k,{gNv:.54});
  const base={PATH:process.env.PATH,SIDVOICE_K:'{"jit":0.001}',SIDVOICE_GAP:'16'},before={...base};
  const a=workerEnvironment(VARIANTS.transition_gaps,base),b=workerEnvironment(VARIANTS.noise_more,base);
  assert.equal(a.SIDVOICE_GAP,'0');assert.equal(b.SIDVOICE_GAP,'16');
  assert.deepEqual(JSON.parse(a.SIDVOICE_K),{jit:.001,gapMin:0});
  assert.deepEqual(JSON.parse(b.SIDVOICE_K),{jit:.001,gNv:.54});
  assert.deepEqual(base,before);
});

test('zero gap threshold really disables periodic-gap bridging, without changing the default',()=>{
  const modulePath=path.resolve(__dirname,'../retort/sidVoice/voc64.js');
  const script=`const {cleanF0}=require(${JSON.stringify(modulePath)}); const f=[205,0,0,0,205,0,0,0,0,0,0,205].map(x=>[x,[0],[.1,.1,.1]]); console.log(JSON.stringify(cleanF0(f).map(x=>x[0])));`;
  const run=env=>JSON.parse(execFileSync(process.execPath,['-e',script],{env:{...process.env,SIDVOICE_K:'{}',...env},windowsHide:true,encoding:'utf8'}));
  const defaultEnvironment={...process.env};delete defaultEnvironment.SIDVOICE_GAP;
  const normal=JSON.parse(execFileSync(process.execPath,['-e',script],{env:{...defaultEnvironment,SIDVOICE_K:'{}'},windowsHide:true,encoding:'utf8'}));
  assert.ok(normal.every(x=>x>0));assert.deepEqual(run({SIDVOICE_GAP:'16'}),normal);
  assert.deepEqual(run({SIDVOICE_GAP:'0',SIDVOICE_K:'{"gapMin":0}'}),[205,0,0,0,205,0,0,0,0,0,0,205]);
});

test('holdout material has no shared lines or identifiers with the selection corpus',()=>{
  assert.equal(HOLDOUT.length,3);
  for(const line of HOLDOUT){
    assert.ok(!CORPUS.some(c=>c.id===line.id||c.text===line.text));
    assert.ok(line.targets.length>=6);
  }
});

test('real experimental workers preserve the Soft baseline and cannot leak noise settings',async t=>{
  const Voc=require('../retort/sidVoice/voc64');
  const input=require('./fixtures/sid-voice-input.cjs').fixture(),before=structuredClone(input);
  const workers=[];
  t.after(async()=>{for(const worker of workers)await worker.terminate();});
  const workerFor=variant=>{const w=new Worker(path.resolve(__dirname,'../tools/experiment-sid-voices.cjs'),{env:workerEnvironment(variant)});workers.push(w);return w;};
  const render=(w)=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(Error('Test render timed out'));},10000);
    const cleanup=()=>{clearTimeout(timeout);w.removeListener('message',done);w.removeListener('error',fail);};
    const done=result=>{cleanup();result.error?reject(Error(result.error)):resolve(result);},fail=error=>{cleanup();reject(error);};
    w.once('message',done);w.once('error',fail);w.postMessage(input);
  });
  const soft=workerFor(VARIANTS.soft),noise=workerFor(VARIANTS.noise_more);
  const baseline=await render(soft),candidate=await render(noise),again=await render(soft);
  const expected=Voc.render({...input,k:BASELINE_K});
  assert.deepEqual(baseline.samples,Float32Array.from(expected));
  assert.deepEqual(baseline.score,expected.registerScore);
  assert.deepEqual(again.score,baseline.score);
  assert.notDeepEqual(candidate.score,baseline.score);
  assert.deepEqual(input,before);
});
