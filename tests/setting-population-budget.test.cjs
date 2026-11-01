'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../retort/settingLayer'),M=require('../retort/gameModels'),Host=require('../retort/pcModelHost'),Runtime=require('../retort/gameRetort'),Budget=require('../retort/holodekBudget');
const Ec=require('../retort/settingEcology'),I=require('../assets/dungeonInhabitants'),fixtures=require('../tests/fixtures/inhabitants.cjs');
async function run(genre){
  const prior=M.current().id,world=genre?S.validateBible(S.localBible('An original orbital culture',[genre])):null;
  const table={version:1,canonical:!genre,originalPercent:genre?0:40,seed:'authored-world',entries:Array.from({length:8},(_,i)=>({id:'kind-'+i,name:'Authored Species '+i,description:'An unusual native body adapted to the region, with independent goals and a distinctive culture.',habitat:'Terraces, city streets and nearby regional routes',society:'Independent households and traveling communities',roles:['traveler','host'],kind:'people',allegiance:'Neutral',weight:1,nameParts:{prefixes:['Kel','Ven','Sor'],middles:['a','en','il'],endings:['in','el','os']}}))};
  const rows=fixtures(8).map(row=>{const h=I.hash(`${table.seed}:2,0,0:population:${row.slot}`);let draw=0;const selected=Ec.choose(table,{},()=>((h+Math.imul(++draw,2654435761))>>>0)/4294967296);return{...row,race:selected.name,allegiance:row.slot<3?'Neutral':'Hostile',encounterId:'local-'+Math.floor(row.slot/3),homeSite:'commons'};});
  let calls=0,maxInput=0;
  const host=Host.createHost({fetchImpl:async(_u,init)=>{const body=JSON.parse(init.body);calls++;const total=Budget.tally(body.messages,[{response_format:body.response_format}]).total;maxInput=Math.max(maxInput,total);
    assert.ok(total<=Budget.CEILING);assert.ok(total+body.max_tokens+Budget.SAFETY<=4096);
    const ids=body.response_format.json_schema.schema.properties.inhabitants.items.properties.slot.enum;
    return{ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({inhabitants:rows.filter(r=>ids.includes(r.slot))})}}]})};
  }});
  S.setActive(world);M.restore('holodek-1');const app=Runtime.createRuntime({models:{...M,getLocalClient:()=>Host.modelClient(host)},log(){}});
  try{const result=await app.run(app.retort($=>require('../retort/inhabitantGeneration').generateInhabitants($,{roomName:'Authored Public Hall',roomDescription:'Enclosed public gathering rooms with visible transit signs and local residents at their own activities.',geoKey:'2,0,0',indoor:true,partyNames:['The Hero'],rooms:{'0,0,0':{setting:{...(world||{}),ecology:table}}}},
      {random:min=>min,level:()=>1,sex:()=>'',xp:()=>0,equipment:async()=>null})),null,{shouldSaveToLog:false});
    assert.ok(result.population,result.error?.message);assert.equal(Object.keys(result.population.actors).length,8);assert.equal(calls,8);console.log(JSON.stringify({genre:genre||'CotG',calls,maxInput,context:4096,pass:true}));
  }finally{M.restore(prior);S.setActive(null);}
}
for(const genre of [null,'sci-fi'])test((genre||'CotG')+' authored population and optional names fit every native 4096-token request',()=>run(genre));
