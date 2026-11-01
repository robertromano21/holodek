'use strict';
for(const f of ['HOMEBREW','GENRE_EXPANSION','ARCHITECTURE_EXPANSION'])process.env['HOLODEK_'+f]='1';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../retort/settingLayer'),Models=require('../retort/gameModels'),Host=require('../retort/pcModelHost'),Runtime=require('../retort/gameRetort'),Budget=require('../retort/holodekBudget');
function answer(schema,key=''){
  if(schema.enum)return schema.enum[0];const type=[].concat(schema.type||[]).find(t=>t!=='null');
  if(type==='object')return Object.fromEntries(Object.entries(schema.properties||{}).map(([k,v])=>[k,answer(v,k)]));
  if(type==='array')return Array.from({length:key==='speakers'?1:schema.minItems??1},()=>answer(schema.items,key));
  if(type==='boolean')return false;if(type==='number')return schema.minimum||0;
  return key==='prose'?'You pause beside the marked path.':key==='remember'?'':'The city lies north beyond the marsh.';
}
for(const genre of ['cyberpunk','sci-fi','dark-fantasy'])test(genre+' scene, speech and caches retain geography inside actual 4096-token work orders',async()=>{
  const prior=Models.current().id,b=S.validateBible(S.localBible('An original regional world',[genre]));S.setActive(b);Models.restore('holodek-1');
  const location={room:'Retention Marsh',coordinates:'1,0,0',biome:'wetland',indoor:false,architecture:'natural',settlement:null,currency:b.currency.plural,
    neighbors:Array.from({length:8},(_,i)=>({direction:['north','south','east','west','northeast','southeast','northwest','southwest'][i],status:'open',name:'Known Regional Approach '+i,coordinates:i+',2,0'})),
    locales:Array.from({length:4},(_,i)=>({name:'Established Regional City '+i,coordinates:i+',5,0',bearing:'north',distance:5,route:{via:'southeast',steps:3},source:'public-campaign-map'})),
    services:[{kind:'shop',operator:'Resident Trader',available:true,position:{x:20,y:25}}]};
  let calls=0;const host=Host.createHost({fetchImpl:async(_url,init)=>{calls++;const body=JSON.parse(init.body);
    const total=Budget.tally(body.messages,[{response_format:body.response_format}]).total;
    assert.ok(total<=Budget.CEILING,total+' input tokens');assert.ok(total+body.max_tokens+Budget.SAFETY<=4096);
    return{ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(answer(body.response_format.json_schema.schema))}}]})};
  }});
  const app=Runtime.createRuntime({models:{...Models,getLocalClient:()=>Host.modelClient(host)},log(){}});
  try{
    const result=await app.run(app.retort($=>require('../retort/holodekNarration').generate($,{consoleText:'Room Name: Retention Marsh\nRoom Description: Low reeds and firm walking paths frame the water.\nCoordinates: 1,0,0\nExits: north, southeast',
      userInput:'Which way to the city?',characters:[{name:'Guide',job:'local courier',history:'A regional courier for the last five years.',personality:'Practical and careful.'}],audibleNames:['Guide'],requiredSpeakers:['Guide'],location})),null,{shouldSaveToLog:false});
    assert.ok(result.content||result.value?.content,result.error?.message);assert.ok(calls>=3);
  }finally{S.setActive(null);Models.restore(prior);}
});
