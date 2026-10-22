'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.HOLODEK_RECOVERY_SOURCE_ROOT||path.resolve(__dirname,'..');
const {generateInhabitants}=require(path.join(root,'retort/inhabitantGeneration'));
const {retortSchemaToJsonSchema}=require('retort-js/dist/tooling');
const {toJSON}=require(process.env.HOLODEK_RECOVERY_SOURCE_ROOT?path.join(__dirname,'../retort/structuredSchema'):path.join(root,'retort/structuredSchema'));
const fixtures=require(path.join(root,'tests/fixtures/inhabitants.cjs'));
const {templateContent}=require('retort-js/dist/message');
const Runtime=require(path.join(root,'retort/gameRetort')),Models=require(path.join(root,'retort/gameModels'));
const context={geoKey:'0,0,0',roomName:'Ruined Temple Entrance',roomDescription:'A roofed temple with memorial reliefs.',indoor:true,partyNames:['Mortacia']};
function rules(count,counters){return{random:(min,max)=>max===5?count:min,level:()=>{counters.levels++;return 1;},sex:()=> 'Female',xp:()=>0,equipment:async()=>{counters.equipment++;return null;}};}
function cast(count){return fixtures(count).map(r=>({...r,allegiance:'Friendly',encounterId:'keepers',homeSite:'commons'}));}
function agent(replies){let index=0;const requests=[],prompts=[];return {requests,prompts,user:(parts,...values)=>prompts.push(templateContent(parts,...values)),assistant:{generation:async options=>{requests.push(options);const r=replies[Math.min(index++,replies.length-1)];if(r instanceof Error)throw r;return{content:typeof r==='string'?r:JSON.stringify(r)};}}};}

test('array cardinality survives the Retort converter, strict nesting and nullable arrays',()=>{
  const parameters={cast:{type:[{type:{slot:Number,dialogue:{type:[String],minItems:3,maxItems:3}}}],minItems:1,maxItems:1},optional:{type:[String],nullable:true,minItems:0,maxItems:4}};
  const vendor=retortSchemaToJsonSchema(parameters);assert.equal(vendor.properties.cast.minItems,undefined);
  const schema=toJSON(parameters);assert.equal(schema.properties.cast.minItems,1);assert.equal(schema.properties.cast.maxItems,1);
  assert.equal(schema.properties.cast.items.properties.dialogue.minItems,3);assert.equal(schema.properties.optional.maxItems,4);
  const plain={name:String,values:[Number],nested:{type:{enabled:Boolean}}};assert.deepEqual(toJSON(plain),retortSchemaToJsonSchema(plain));
  assert.throws(()=>toJSON({rows:{type:[String],minItems:2,maxItems:1}}),/minItems/);
});

test('the logged three residents all claiming slot zero gets one correction, not truncation or a new random count',async()=>{
  const bad=cast(3).map(r=>({...r,slot:0})),good=[bad[0]],a=agent([{inhabitants:bad},{inhabitants:good}]);
  const counters={levels:0,equipment:0},result=await generateInhabitants(a,context,rules(1,counters));
  assert.equal(a.requests.length,2);assert.deepEqual(Object.keys(result.population.actors),[good[0].name]);assert.equal(counters.levels,1);assert.equal(counters.equipment,0);
  assert.match(a.prompts.join('\n'),/exactly 1 inhabitants with slot IDs 0/);assert.match(a.prompts.at(-1),/Expected exactly 1 inhabitants/);
  for(const request of a.requests){const s=toJSON(request.parameters).properties.inhabitants;assert.equal(s.minItems,1);assert.equal(s.maxItems,1);}
});

for(const defect of ['too few','duplicate slots','missing biography'])test(`a ${defect} correction is validated before any mechanical allocation`,async()=>{
  const bad=cast(4);if(defect==='too few')bad.length=1;else if(defect==='duplicate slots')bad[1].slot=0;else delete bad[0].history;
  const a=agent([{inhabitants:bad},{inhabitants:cast(4)}]),counters={levels:0,equipment:0};
  const result=await generateInhabitants(a,context,rules(4,counters));assert.equal(a.requests.length,2);assert.equal(Object.keys(result.population.actors).length,4);assert.equal(counters.levels,4);
});

test('failed correction stops after four total calls without inventing, deduplicating or allocating residents',async()=>{
  const a=agent([{inhabitants:cast(3).map(r=>({...r,slot:0}))}]),counters={levels:0,equipment:0};
  await assert.rejects(generateInhabitants(a,context,rules(1,counters)),/Expected exactly 1 inhabitants/);
  assert.equal(a.requests.length,4);assert.deepEqual(counters,{levels:0,equipment:0});
});

test('provider unavailability is not retried as a malformed cast',async()=>{
  const a=agent([Error('provider unavailable')]),counters={levels:0,equipment:0};
  await assert.rejects(generateInhabitants(a,context,rules(1,counters)),/provider unavailable/);assert.equal(a.requests.length,1);assert.equal(counters.levels,0);
});

test('declining a supplemental encounter still accepts an empty cast without allocating stats',async()=>{
  const a=agent([{skip:true,inhabitants:[]}]),counters={levels:0,equipment:0};
  assert.deepEqual(await generateInhabitants(a,{...context,geoKey:'2,0,0',encounter:{count:2,races:['Human']}},rules(1,counters)),{skipped:true});
  assert.equal(toJSON(a.requests[0].parameters).properties.inhabitants.minItems,0);assert.equal(counters.levels,0);
});

test('real Luna transport rejects an oversized structured cast and the same Retort session recovers',async()=>{
  const requests=[],counters={levels:0,equipment:0},client={chat:{completions:{create:async body=>{
    requests.push(body);const rows=requests.length===1?cast(3).map(r=>({...r,slot:0})):cast(1);
    return(async function*(){yield{choices:[{delta:{tool_calls:[{index:0,id:'cast-'+requests.length,type:'function',function:{name:'answer',arguments:JSON.stringify({inhabitants:rows})}}]}}]};yield{choices:[{delta:{},finish_reason:'tool_calls'}]};})();
  }}}};
  const models=Models.createModelService({initial:'gpt-6-luna',clientFor:()=>client}),runtime=Runtime.createRuntime({models,client,log(){}});
  const result=await runtime.run(runtime.retort($=>generateInhabitants($,context,rules(1,counters))),null,{shouldSaveToLog:false});
  assert.equal(requests.length,2);assert.equal(Object.keys(result.population.actors).length,1);assert.equal(counters.levels,1);
  for(const request of requests){assert.equal(request.model,'gpt-6-luna');const s=request.tools[0].function.parameters.properties.inhabitants;assert.equal(s.minItems,1);assert.equal(s.maxItems,1);}
});
