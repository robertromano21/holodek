'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Models=require('../retort/gameModels'),T=require('../retort/modelTransport');
const row=Models.catalog.find(r=>r.id==='groq-gpt-oss-120b');
test('Groq has an explicit model, separate credentials and preserves Luna as default',async()=>{
  assert.equal(row.apiModel,'openai/gpt-oss-120b');assert.equal(row.provider,'groq');assert.equal(Models.DEFAULT_MODEL,'gpt-6-luna');
  const prior=process.env.GROQ_API_KEY;delete process.env.GROQ_API_KEY;
  try{const service=Models.createModelService({clientFor:()=>null,localProbe:async()=>[]});assert.equal((await service.view()).all.find(r=>r.id===row.id).status,'needs key');await assert.rejects(service.select(row.id,0),e=>e.status===428);assert.equal(service.current().id,'gpt-6-luna');process.env.GROQ_API_KEY='offline-groq-test-key-not-real';assert.equal((await service.view()).all.find(r=>r.id===row.id).status,'ready');await service.select(row.id,0);assert.equal(service.current().id,row.id);}finally{if(prior===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=prior;}
});
function fixture(content){const sent=[];return{sent,models:{profile:()=>row,getGroqClient:()=>({chat:{completions:{create:async body=>{sent.push(body);return{choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16}};}}}})}};}
test('Groq structured authoring uses non-streamed strict JSON without tools, validates and yields usage',async()=>{
  const f=fixture('{"answer":"ready"}'),out=[];
  for await(const chunk of T.stream({model:row.id,name:'answer',parameters:{answer:String}},[{role:'user',content:'Return the answer'}],{models:f.models}))out.push(chunk);
  assert.equal(f.sent.length,1);const b=f.sent[0];assert.equal(b.model,'openai/gpt-oss-120b');assert.equal(b.reasoning_effort,'low');assert.equal(b.stream,false);assert.equal(b.tools,undefined);assert.equal(b.stream_options,undefined);assert.equal(b.response_format.json_schema.strict,true);assert.equal(b.response_format.json_schema.schema.additionalProperties,false);assert.deepEqual(JSON.parse(out[0].contentDelta),{answer:'ready'});assert.equal(out[0].totalTokens,16);
});
test('Groq rejects invalid JSON and schema failures without repairs or model substitution',async()=>{
  for(const content of['not JSON','{"wrong":"field"}']){const f=fixture(content);await assert.rejects(async()=>{for await(const chunk of T.stream({model:row.id,parameters:{answer:String}},[],{models:f.models}))void chunk;},e=>e.code==='MODEL_SCHEMA');assert.equal(f.sent.length,1);}
});
test('ordinary Groq completions use its own client and API model',async()=>{
  const f=fixture('ready');const result=await T.complete(null,{model:row.id,messages:[]},{models:f.models});assert.equal(result.choices[0].message.content,'ready');assert.equal(f.sent[0].model,'openai/gpt-oss-120b');
});
test('Groq strict callers decode optional protocol nulls without authoring missing content',async()=>{
  const f=fixture('{"answer":"ready","note":null,"rows":[{"name":"Nera","note":null}]}'),out=[];
  const parameters={answer:String,note:{type:String,optional:true},rows:{type:[{type:{name:String,note:{type:String,optional:true}}}]}};
  for await(const chunk of T.stream({model:row.id,strictParameters:true,parameters},[],{models:f.models}))out.push(chunk);
  assert.deepEqual(JSON.parse(out[0].contentDelta),{answer:'ready',rows:[{name:'Nera'}]});
  assert.ok(f.sent[0].response_format.json_schema.schema.required.includes('note'));
});
test('website worker routes Groq only to its fixed endpoint with an ephemeral credential',async()=>{
  const W=require('../tools/website-worker/worker.cjs');let wire;
  const result=await W.handle({operation:'generate',provider:'groq',credential:'gsk_'+'offline'.repeat(6),body:{model:'openai/gpt-oss-120b',messages:[{role:'user',content:'Reply ready'}],stream:false}},{fetchImpl:async(url,options)=>{wire={url,options};return new Response(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'ready'}}]}));}});
  assert.equal(wire.url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(result.choices[0].message.content,'ready');assert.ok(wire.options.headers.Authorization.startsWith('Bearer gsk_'));
});
test('diagnostics redact Groq keys independently of other providers',()=>{
  const key='gsk_'+'offline'.repeat(6);assert.ok(!require('../retort/privateDiagnostics').clean('GROQ_API_KEY='+key).includes(key));
});
