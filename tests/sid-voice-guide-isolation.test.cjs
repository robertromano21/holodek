'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
  const created=[],runs=[],pending=[];
  const map=n=>({'^':[n],_:[0],$:[3],a:[4],'.':[5]});
  const cfg=guide=>JSON.stringify({phoneme_id_map:map(guide==='ryan'?22:11),audio:{sample_rate:22050}});
  class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}}
  const ort={Tensor,InferenceSession:{create:async file=>{
    const guide=file.includes('ryan')?'ryan':'lj';created.push(guide);
    await new Promise(resolve=>setTimeout(resolve,guide==='lj'?1:3));
    return{outputNames:[guide],run:async input=>{runs.push({guide,first:Number(input.input.data[0])});
      return{[guide]:{data:Float32Array.from([guide==='lj'?1:2])},w_ceil:{data:Float32Array.from(input.input.data,()=>1)}};}};
  }}};
  const phon={phonemize:async()=>{await new Promise(resolve=>pending.push(resolve));return['a'];}};
  const code=fs.readFileSync('retort/sidVoice/piper.js','utf8').replace("await import('phonemizer')","require('phonemizer')");
  const context={module:{exports:{}},process:{env:{SIDVOICE_LEXICON:'0'}},console,setTimeout,Float32Array,Float64Array,BigInt64Array,BigInt,
    __dirname:path.resolve('retort/sidVoice'),require:id=>id==='fs'?{existsSync:()=>true,readFileSync:file=>cfg(file.includes('ryan')?'ryan':'lj')}:
      id==='onnxruntime-node'?ort:id==='phonemizer'?phon:id==='./accent'?{}:require(id)};
  vm.runInNewContext(code,context);return{piper:context.module.exports,created,runs,pending};
}
test('concurrent guide requests keep their own model, config and output tensor',async()=>{
  const f=fixture(),a=f.piper.synth('a.',1,1,'lj'),b=f.piper.synth('a.',1,1,'ryan');
  while(f.pending.length<2)await new Promise(resolve=>setTimeout(resolve,2));
  f.pending.splice(0).forEach(resolve=>resolve());
  const [lj,ryan]=await Promise.all([a,b]);
  assert.equal(lj.audio[0],1);assert.equal(ryan.audio[0],2);
  assert.deepEqual(f.runs,[{guide:'lj',first:11},{guide:'ryan',first:22}]);
});
test('concurrent first requests share a single model-loading promise',async()=>{
  const f=fixture(),a=f.piper.synth('a.',1,1,'lj'),b=f.piper.synth('a.',1,1,'lj');
  while(f.pending.length<2)await new Promise(resolve=>setTimeout(resolve,2));
  f.pending.splice(0).forEach(resolve=>resolve());await Promise.all([a,b]);
  assert.deepEqual(f.created,['lj']);
});
