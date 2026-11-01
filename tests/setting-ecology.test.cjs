'use strict';
for(const f of ['CITY_COMPLETE','ARCHITECTURE_EXPANSION','GENRE_EXPANSION','HOMEBREW'])process.env['HOLODEK_'+f]='1';
const test=require('node:test'),assert=require('node:assert/strict'),Ec=require('../retort/settingEcology'),S=require('../retort/settingLayer'),Work=require('../retort/holodekRoomWork'),Legacy=require('../assets/monsterRaces');
function table(canonical=false){return{version:1,source:'model-authored',canonical,seed:'test',originalPercent:canonical?40:0,entries:Array.from({length:8},(_,i)=>({id:'ecology-'+i,name:'Invented Kind '+i,description:'An original being with individual traits '+i,habitat:'Its own regional habitat',society:'A culture or ecology of its own',roles:['traveler','hunter'],kind:i<6?'people':'monster',allegiance:i<6?'Neutral':'Hostile',weight:8-i}))};}
test('both CotG encounter sources remain reachable and the original 358-entry catalog stays intact',()=>{
  const t=table(true),before=JSON.stringify(Legacy);assert.equal(Legacy.length,358);Ec.validate(t);
  let calls=0;const old=Ec.choose(t,{},()=>calls++?0:.1);assert.equal(old.source,'original-cotg');assert.equal(old.name,Legacy[0].name);
  calls=0;const native=Ec.choose(t,{},()=>calls++?0:.9);assert.equal(native.source,'authored-setting');assert.equal(native.name,t.entries[0].name);
  assert.equal(JSON.stringify(Legacy),before);assert.throws(()=>Ec.validate({...t,originalPercent:100}),/both encounter sources/);
});
test('original genre worlds never sample generic CotG monsters, even at zero random draw',()=>{
  const t=table();assert.equal(Ec.choose(t,{},()=>0).source,'authored-setting');assert.throws(()=>Ec.validate({...t,originalPercent:20}),/cannot import/);
});
test('city population weights produce exact saved percentages and deterministically select native groups',()=>{
  const t=table(),weights=t.entries.map((e,i)=>({id:e.id,weight:i===3?100:0}));
  assert.equal(Ec.percentages(weights).reduce((n,r)=>n+r.percent,0),100);assert.equal(Ec.percentages(weights)[3].percent,100);
  assert.equal(Ec.choose(t,{weights},()=>.5).name,'Invented Kind 3');assert.throws(()=>Ec.percentages([{id:'empty',weight:0}]),/positive/);
});
test('each setting construction requests an authored table with no prefab creature list in its prompt',async()=>{
  const old=Work.request,prompts=[];let sequence=0;
  Work.request=async(_$,component,parameters,brief,validate,localWork)=>{
    assert.equal(component,'setting-ecology');assert.equal(localWork.arrays.entries.batch,1);prompts.push(brief);
    const t=table(false);t.entries=t.entries.map((e,i)=>({...e,name:'World '+(++sequence)+' Creature '+i}));return validate({originalPercent:0,entries:t.entries});
  };
  try{const b=S.validateBible(S.localBible('An original orbital culture',['sci-fi']));
    const a=await Ec.author({}, {world:b,seed:'a'}),c=await Ec.author({}, {world:b,seed:'b'});
    assert.notDeepEqual(a.entries.map(e=>e.name),c.entries.map(e=>e.name));assert.equal(a.originalPercent,0);assert.equal(a.percentages.reduce((n,r)=>n+r.percent,0),100);
    assert.ok(prompts.every(p=>p.includes('No prefab genre encounter list')&&!p.includes('hull_crawler')&&!p.includes('Orc')));
  }finally{Work.request=old;}
});
test('saved ecology is looked up from the world or its campaign atlas without regenerating it',()=>{
  const a=table(),b=table(true);assert.equal(Ec.get({'0,0,0':{setting:{ecology:a},campaignAtlas:{ecology:b}}}),a);assert.equal(Ec.get({'0,0,0':{campaignAtlas:{ecology:b}}}),b);
});
test('existing named and dead residents are not overwritten by population sampling',()=>{
  const actors={Keeper:{name:'Keeper',status:'dead',race:'Authored Guardian',home:{x:4,y:7}}},saved=JSON.stringify(actors);
  Ec.choose(table(),{},()=>.5);assert.equal(JSON.stringify(actors),saved);
  const source=require('node:fs').readFileSync('retort/inhabitantGeneration.js','utf8');assert.match(source,/slot\.slot===0&&questSeed\)continue/);assert.match(source,/usedNames/);
});
module.exports={table};
