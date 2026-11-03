'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Policy=require('../retort/encounterPolicy'),Generation=require('../retort/inhabitantGeneration'),Build=require('../retort/roomBuildState');
const Story=require('../retort/graveMasterStoryPrompts'),Setting=require('../retort/settingLayer');
const fixtures=require('./fixtures/inhabitants.cjs'),{batchRows}=require('./fixtures/inhabitant-batch.cjs');
const party=size=>Array.from({length:size},(_,i)=>({name:'Party '+i,type:i?'npc':'pc',hp:20,state:'Alive',level:4}));
const slots=count=>Array.from({length:count},(_,slot)=>({slot,allegiance:'Neutral',encounterId:'residents'}));
test('every ordinary encounter uses the original 60/20/20 hostile, neutral and friendly odds',()=>{
  const totals={Hostile:0,Neutral:0,Friendly:0};for(let i=0;i<10000;i++)totals[Policy.disposition((i+.5)/10000)]++;
  assert.deepEqual(totals,{Hostile:6000,Neutral:2000,Friendly:2000});
  assert.equal(Policy.disposition(.59999),'Hostile');assert.equal(Policy.disposition(.6),'Neutral');
  assert.equal(Policy.disposition(.8),'Friendly');
});
test('starter exemption applies to CotG and original genre openings, not host-local floors',()=>{
  for(const name of ['Ruined Temple Entrance','An Original City','An Original Habitat']){
    const room={name,classification:{indoor:true}},db={'0,0,0':room},s=slots(8);
    assert.equal(Policy.reserve(db,'0,0,0',{seed:'run'}),null);
    const budget=Policy.budget(room,'0,0,0',null,{party:party(7)});Policy.apply(s,budget);
    assert.deepEqual(budget.groups,[]);assert.equal(room.encounterRoll,undefined);
  }
  assert.equal(Policy.profile({cityFloorContext:{floor:1}},'0,0,0'),'dangerous');
});
test('peaceful service interiors, hostile temples and hand-authored or scripted casts retain their exceptions',()=>{
  const key='1,1,0';
  for(const type of ['shop','temple','inn','clinic','library']){
    const room={classification:{indoor:true},cityRoom:{venue:{type}}},budget=Policy.budget(room,key,{version:2,seed:'run'},{party:party(7),indoor:true});
    Policy.apply(slots(8),budget);assert.deepEqual(budget.groups,[]);
  }
  assert.equal(Policy.profile({campaignSetting:{siteKind:'roman_temple'}},key,{indoor:true}),'safe');
  assert.equal(Policy.budget({},key,{}, {hostileTemple:true}),null);
  for(const room of [{builder:{mode:'hand'}},{regionalSite:{actors:[{name:'Bound Enemy'}]}}]){
    assert.equal(Policy.reserve({[key]:room},key,{seed:'run'}),null);assert.equal(Policy.budget(room,key,{}),null);
  }
});
test('saved encounter seeds survive retries and existing authored casts are never rerolled',()=>{
  const key='1,1,0',db={[key]:{name:'An authored destination'}},first=Policy.reserve(db,key,{seed:'run'});
  assert.equal(first.version,2);assert.equal(first.count,undefined);
  assert.deepEqual(Policy.reserve(JSON.parse(JSON.stringify(db)),key,{seed:'retry'}),first);
  for(const inhabitants of [{authoredAt:1},{initialSheets:'Saved sheets'},{actors:{Existing:{hp:7}}}]){
    const room={name:'Existing room',inhabitants},before=JSON.stringify(room);
    assert.equal(Policy.reserve({[key]:room},key,{seed:'run'}),null);assert.equal(JSON.stringify(room),before);
  }
});
test('quiet neighbors do not force a hostile group and legacy room quotas no longer control new casts',()=>{
  const key='2,1,0',db={'1,1,0':{encounterRoll:{version:1,count:0}},[key]:{name:'Two'}};
  const saved=Policy.reserve(db,key,{seed:'run'});assert.equal(saved.droughtOverride,undefined);
  const plans=[0,3].map(count=>{
    const legacy={version:1,runId:'run',count,baseCount:count},room={encounterRoll:legacy};
    assert.equal(Policy.reserve({[key]:room},key,{seed:'retry'}),legacy);
    const plan=Policy.budget(room,key,legacy,{party:party(7)});Policy.apply(slots(16),plan);return plan;
  });
  assert.deepEqual(plans[0],plans[1]);
});
test('stale browser snapshots cannot replace v1 or v2 reservations, and new runs stay isolated',()=>{
  for(const roll of [{version:1,runId:'run',count:2},{version:2,runId:'run',seed:'saved'}]){
    const current={'1,1,0':{name:'One',encounterRoll:roll}};
    for(const next of [{'1,1,0':{name:'One'}},{'1,1,0':{name:'One',encounterRoll:{...roll,seed:'changed',count:0}}}])
      assert.deepEqual(JSON.parse(Build.protectDatabase(JSON.stringify(current),JSON.stringify(next),'run'))['1,1,0'].encounterRoll,roll);
    const fresh={'1,1,0':{name:'A different campaign'}};
    assert.deepEqual(JSON.parse(Build.protectDatabase(JSON.stringify(current),JSON.stringify(fresh),'new-run')),fresh);
  }
});
test('groups roll independently without changing population or protected quest/service slots',()=>{
  const s=slots(16);Object.assign(s[3],{serviceRole:'shop'});Object.assign(s[4],{encounterId:'quest-contact'});
  const b=Policy.budget({},'1,1,0',{seed:'stable'},{party:party(4)});let calls=0;
  Policy.apply(s,b,{random:()=>[.1,.6,.8][calls++]});
  assert.equal(calls,3);assert.equal(s.length,16);
  assert.deepEqual(b.groups.map(g=>g.allegiance),['Hostile','Neutral','Friendly']);
  assert.equal(b.groups.reduce((n,g)=>n+g.size,0),11);
  assert.ok(b.groups.every(g=>g.size>=2&&g.size<=6));
  assert.ok(s.slice(0,5).every(s=>!s.engineEncounter));
  assert.ok(s.filter(s=>s.engineEncounter).every(s=>s.cohortAllegiance==='Hostile'?s.routine==='patrol':s.routine==='wander'));
});
test('party-scaled cohorts remain 2-6 members for all ordinary population targets',()=>{
  for(let size=1;size<=10;size++)for(let count=8;count<=24;count++){
    const b=Policy.budget({},'1,1,0',{seed:'stable'},{party:party(size)}),s=slots(count);
    Policy.apply(s,b);assert.ok(b.groups.every(g=>g.size>=2&&g.size<=6));
    assert.equal(b.groups.reduce((n,g)=>n+g.size,0),count-3);assert.equal(s.length,count);
  }
});
async function generate({size=7,settled=false,genre=false,starting=false,corrupt=false,seed='stable',market=false}={}){
  const original=Story.isHolodek1;Story.isHolodek1=()=>true;
  if(genre)Setting.setActive(Setting.validateBible(Setting.localBible('Offline Test World',['cyberpunk'])));
  try{
    const key=starting?'0,0,0':'3,4,0',room={name:starting?'Ruined Temple Entrance':'An authored location',
      ...(market?{cityRoom:{venue:{id:'test',type:'shop',service:'shop',roles:['shopkeeper']}}}:{})},members=party(size);
    const budget=Policy.budget(room,key,{version:2,seed},{party:members,indoor:!settled,roll:.5});
    const count=starting?(genre?2:1):settled?16:Math.max(8,Math.min(16,size+4)),planned=slots(count),expected=structuredClone(budget);
    if(!starting)Policy.apply(planned,expected);
    const rows=fixtures(24,Array.from({length:24},(_,slot)=>({slot,
      allegiance:planned[slot]?.cohortAllegiance||'Neutral',encounterId:'model-label-'+slot,
      ...(corrupt&&slot===3?{allegiance:'Friendly'}:{})}))),prompts=[];
    const $={user:(p,...v)=>prompts.push(typeof p==='string'?p:String.raw({raw:p},...v)),assistant:{generation:async request=>({content:JSON.stringify({inhabitants:batchRows(rows,request)})})}};
    const result=await Generation.generateInhabitants($,{roomName:room.name,geoKey:key,roomDescription:'An original authored location.',
      indoor:!settled,rooms:{[key]:room},party:members,partyNames:members.map(a=>a.name),roomEncounterPlan:budget,
      ...(settled?{campaignSetting:{inhabited:true,village:{id:'test',population:'A mixed civilian community.'}}}:{})},
      {random:min=>min,level:()=>4,sex:()=> 'Female',xp:()=>0,equipment:async()=>null});
    return{...result,budget,expected,prompts,count};
  }finally{Story.isHolodek1=original;if(genre)Setting.setActive(null);}
}
for(const seed of ['stable','another','third'])for(const genre of [false,true])test(`${genre?'genre':'CotG'} authoring preserves independently rolled groups (${seed})`,async()=>{
  const f=await generate({seed,genre,settled:genre});
  assert.equal(Object.keys(f.population.actors).length,f.count);
  assert.deepEqual(f.population.encounterBudget.groups.map(({id,...g})=>g),f.expected.groups);
  assert.ok(Object.values(f.population.actors).slice(0,3).every(a=>a.allegiance==='Neutral'));
  for(const plan of f.population.encounterBudget.groups){
    const group=f.population.groups.find(g=>g.id===plan.id);assert.equal(group.members.length,plan.size);
    assert.ok(group.members.every(name=>f.population.actors[name].allegiance===plan.allegiance));
    assert.ok(group.members.every(name=>f.population.actors[name].routine===(plan.allegiance==='Hostile'?'patrol':'wander')));
  }
  if(genre)assert.ok(!f.prompts.some(p=>/Tartarus|Arithus|Dantuea/.test(p)));
});
test('starter monsters remain small, Friendly and recruitable with no genre shopkeeper exception',async()=>{
  for(const genre of [false,true]){
    const f=await generate({starting:true,genre,market:true});
    assert.equal(Object.keys(f.population.actors).length,genre?2:1);
    assert.ok(Object.values(f.population.actors).every(a=>a.allegiance==='Friendly'&&!a.serviceRole));
    assert.equal(f.population.encounterBudget,undefined);assert.equal(f.population.venue,undefined);
    assert.ok(f.prompts.some(p=>/no services|No services/.test(p)));
  }
});
test('the model cannot replace an engine-selected hostile group with peaceful workers',async()=>{
  let seed;for(let n=0;n<100;n++)if(Policy.disposition(Policy.unit(`${n}:0`))==='Hostile'){seed=String(n);break;}
  await assert.rejects(generate({seed,corrupt:true}),/must preserve its routine cohort allegiance/);
});
test('production reuses saved cast and adjacent workers reserve before exporting snapshots',()=>{
  const source=fs.readFileSync('retort/retortWithUserInput.js','utf8'),a=source.indexOf('async function generateRoomInhabitantPopulation('),body=source.slice(a,source.indexOf('async function generateRoomObjects(',a));
  assert.ok(body.indexOf('if (seeded?.initialSheets)')<body.indexOf('encounterPolicy.reserve('));assert.match(body,/roomEncounterPlan,/);
  const queue=fs.readFileSync('retort/roomBuildQueue.js','utf8');assert.ok(queue.indexOf("require('./encounterPolicy').reserve(")<queue.indexOf('const snapshot = state.exportSaveState()'));
});
