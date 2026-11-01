'use strict';
for(const f of ['CITY_COMPLETE','CITY_SITES','ARCHITECTURE_EXPANSION','GENRE_EXPANSION','HOMEBREW'])process.env['HOLODEK_'+f]='1';
const test=require('node:test'),assert=require('node:assert/strict'),S=require('../retort/settingLayer'),M=require('../retort/gameModels'),Host=require('../retort/pcModelHost'),Runtime=require('../retort/gameRetort'),Budget=require('../retort/holodekBudget');
function value(schema,serial,key='',index=0,offset=0){
  if(schema.enum)return schema.enum[index%schema.enum.length];const type=[].concat(schema.type||[]).find(t=>t!=='null');
  if(type==='object')return Object.fromEntries(Object.entries(schema.properties||{}).map(([k,v])=>[k,value(v,serial,k,index,offset)]));
  if(type==='array')return Array.from({length:schema.minItems??2},(_,i)=>value(schema.items,serial,key,i+offset,offset));
  if(type==='number'||type==='integer')return key==='weight'?10:key==='floors'?72:schema.minimum??1;if(type==='boolean')return false;
  if(['prefixes','middles','endings'].includes(key))return ['va','nel','kor'][index%3];
  if(require('../assets/cityEstablishments').TYPES.includes(key))return 'Original '+key+' venue '+serial;
  return key==='name'?'New Native '+serial+' '+index:'An authored local description.';
}
for(const genre of [null,'cyberpunk'])test((genre||'CotG')+' ecology and city authoring fit real local input/output reservations',async()=>{
  const prior=M.current().id,world=genre?S.validateBible(S.localBible('An original city',[genre])):null;S.setActive(world);M.restore('holodek-1');let calls=0;
  const host=Host.createHost({fetchImpl:async(_u,init)=>{const body=JSON.parse(init.body);calls++;
    const total=Budget.tally(body.messages,[{response_format:body.response_format}]).total;assert.ok(total<=Budget.CEILING,total);assert.ok(total+body.max_tokens+Budget.SAFETY<=4096);
    const offset=Number(body.messages.map(m=>m.content).join(' ').match(/ONLY \$\.weights\[(\d+)\.\./)?.[1]||0);
    const answer=value(body.response_format.json_schema.schema,calls,'',0,offset);return{ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(answer)}}]})};
  }});
  const app=Runtime.createRuntime({models:{...M,getLocalClient:()=>Host.modelClient(host)},log(){}});
  try{
    const result=await app.run(app.retort(async $=>({value:await require('../retort/settingEcology').author($,{world,atlas:{regions:[{name:'Tartarus',ecology:'An inhabited underworld.'}]},seed:'new-setting'})})),null,{shouldSaveToLog:false});
    assert.equal(result.value?.entries.length,8,result.error?.message);assert.ok(calls>=8);
    const room={environmentIntent:{citySite:{id:'city',name:'Original City',population:12000}}};
    const city=await app.run(app.retort(async $=>({value:await require('../retort/cityAuthoring').ensure($,room,{world,ecology:result.value,seed:'new-city'})})),null,{shouldSaveToLog:false});
    assert.equal(city.value?.status,'authored',city.error?.message);assert.equal(Object.keys(room.environmentIntent.citySite.design.districts).length,7);
  }finally{S.setActive(null);M.restore(prior);}
});
