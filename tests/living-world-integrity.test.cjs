'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../retort/livingWorld'),L=require('../retort/livingRegionLedger');
function fixture(count=1){
  const key='1,0,0',region={runId:'integrity',communities:[{id:'c1',standing:0,anchor:{key}}],
    residents:[{id:'r1',name:'Sender',homeCommunityId:'c1',goal:{}}],routes:[{communityId:'c1',anchor:key,status:'traversable'}],quests:[],companionThreads:[],ledger:L.create('integrity')};
  const actors={Sender:{name:'Sender',status:'present',hp:10,position:{x:3,y:3}}};W.person(region,'Sender');
  for(let i=0;i<count;i++){const name='Listener '+i;actors[name]={name,status:'present',hp:10,position:{x:4,y:3}};W.person(region,name);}
  actors.Crowd={name:'Crowd',status:'present',hp:10,position:{x:4,y:3}};
  const db={[key]:{inhabitants:{actors}}},dungeon={cells:Object.fromEntries(Array.from({length:144},(_,i)=>[`${i%12},${Math.floor(i/12)}`,{tile:'floor',floorHeight:0,ceilHeight:6}]))};
  const state={getRoomDungeonForSimulation:()=>dungeon,getCombatCharactersString:()=> '[]',getUpdatedGameConsole:()=>''};
  const fact=L.append(region.ledger,{kind:'world-event',writer:'verified-record',key:'news',text:'The registered work finished.',communityId:'c1',roomKey:key,actors:['Sender'],evidence:[{source:'committed-game-state',witnesses:['Sender']}]});
  W.enqueue(region,fact,'c1','Sender',0);return{key,region,db,dungeon,state,fact};
}
test('community news requires a nearby hearing audience and does not promote a background crowd',()=>{
  const f=fixture(3),a=f.db[f.key].inhabitants.actors;
  a['Listener 1'].position={x:11,y:11};a['Listener 2'].position={x:5,y:3};f.dungeon.cells['4,3']={tile:'wall'};
  // Keep one person on the speaker's side of the wall.
  a['Listener 0'].position={x:3,y:4};
  assert.equal(W.activate(f.db,f.region,'c1',{turn:2,state:f.state}),1);
  assert.ok(W.knows(f.region,'Listener 0',f.fact.id));assert.ok(!W.knows(f.region,'Listener 1',f.fact.id));assert.ok(!W.knows(f.region,'Listener 2',f.fact.id));
  assert.ok(!W.knows(f.region,'Crowd',f.fact.id));assert.equal(f.region.world.people.crowd,undefined);
  assert.ok(f.region.ledger.facts.some(x=>x.evidence[0]?.source==='engine-public-news-v1'));
});
test('the news budget applies per listener and unfinished delivery survives a save/load',()=>{
  const f=fixture(20);assert.equal(W.activate(f.db,f.region,'c1',{turn:2,state:f.state}),12);
  assert.equal(f.region.ledger.beliefs.length,12);assert.equal(f.region.world.pending.length,1);
  const loaded=JSON.parse(JSON.stringify(f.region));assert.equal(W.activate(f.db,loaded,'c1',{turn:3,state:f.state}),8);
  assert.equal(loaded.ledger.beliefs.length,20);assert.ok(L.verify(loaded.ledger).ok);
});
test('an abstract connection is not evidence of a courier or an announcement',()=>{
  const f=fixture();f.db['2,0,0']={inhabitants:{actors:{Sender:f.db[f.key].inhabitants.actors.Sender}}};delete f.db[f.key].inhabitants.actors.Sender;
  assert.equal(W.activate(f.db,f.region,'c1',{turn:10,state:f.state}),0);assert.equal(f.region.ledger.beliefs.length,0);
});
test('one accomplishment is not counted again as a favor, visible consequence and standing award',()=>{
  const f=fixture(),r=f.region;r.communities[0].standing=1;r.quests=[{id:'q1',residentId:'r1',goalId:'g1',missionId:'m1',receipt:{missionId:'m1'},consequence:{kind:'standing'}}];
  const add=(kind,key,evidence)=>L.append(r.ledger,{kind,writer:'verified-record',key,text:key,communityId:'c1',actors:['Sender'],evidence:[evidence]});
  add('quest-completed','quest:g1',{missionId:'m1',goalId:'g1'});add('consequence','standing:q1',{});
  add('world-event','job:m1:completed',{id:'m1',category:'favor',status:'completed'});add('transformation','fixture:q1',{});
  assert.equal(W.reputation(r,'c1',W.index(f.db)),2);assert.equal(r.world.reputation.c1.trusted,false);
  add('world-event','job:m2:completed',{id:'m2',category:'job',status:'completed'});
  assert.equal(W.reputation(r,'c1',W.index(f.db)),3);assert.equal(r.world.reputation.c1.trusted,true);
});
test('history over the per-turn limit is deferred, never consumed and lost',()=>{
  const f=fixture(),records=Array.from({length:22},(_,i)=>({id:'transfer:'+i,at:22-i,turn:1,kind:'activity',authority:'state',source:'committed-game-state',
    text:'A verified exchange.',actors:['Sender'],witnesses:['Sender'],roomKey:f.key}));
  f.state.getCampaignMemory=()=>({records});const opts={turn:1,party:{members:[],companions:[]},idx:W.index(f.db),notices:[]};
  assert.equal(W.ingest(f.db,f.state,f.region,opts).length,16);assert.equal(W.ingest(f.db,f.state,f.region,{...opts,turn:2}).length,6);
  const score=f.region.world.people.sender.importance;assert.equal(W.ingest(f.db,f.state,f.region,{...opts,turn:3}).length,0);
  assert.equal(f.region.world.people.sender.importance,score);
});
