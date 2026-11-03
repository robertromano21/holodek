'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const I=require('../assets/dungeonInhabitants'),D=require('../assets/outdoorDiscovery');
const {createPopulationService}=require('../retort/roomPopulation');
const floor=Object.freeze({tile:'floor',floorHeight:0,ceilHeight:8}),cells={};
for(let y=0;y<256;y++)for(let x=0;x<256;x++)cells[`${x},${y}`]=floor;
Object.freeze(cells);
function fixture(){
  const d={geoKey:'1,0,0',classification:{indoor:false},layout:{width:256,height:256},start:{x:128,y:128},
    _geometryStamp:'unchanged',cells,sceneLandmarks:[],sceneObjects:[]};
  const p=I.createPopulation(d.geoKey,Array.from({length:4},(_,n)=>({name:'Patrol '+n,allegiance:'Hostile',routine:'patrol',encounterId:'patrol'})),{indoor:false});
  const group=p.groups[0];group.site={x:20,y:20};group.discoveryState='fixed';group.setEncounter=true;
  for(const [n,a]of Object.values(p.actors).entries())Object.assign(a,{hp:80,level:12,inventory:[{name:'saved equipment',type:'weapon'}],
    sheet:'saved character sheet',discoveryState:'fixed',position:{x:20+n,y:20},home:{x:20+n,y:20}});
  return{d,p,group};
}
function walk(f,options={}){
  let result;
  for(let n=0;n<25;n++){
    result=D.tick(f.d,f.p,[],{x:128.5+n*3,y:128.5},{now:1000+n*3000,consoleText:'Objects in Room: None',...options});
    if(result.discoveries.length)return result.discoveries[0];
  }
}
const identities=p=>Object.values(p.actors).map(({position,home,discoveryState,discoveryRevision,...identity})=>identity);

test('legacy unseen fixed patrols return to travel placement without rerolling their identities, stats or loot',()=>{
  const f=fixture(),before=structuredClone(identities(f.p)),geometry=JSON.stringify(f.d);
  assert.equal(D.setup(f.d,f.p),true);assert.equal(f.group.discoveryState,'pending');assert.equal(f.group.site,null);
  assert.ok(Object.values(f.p.actors).every(a=>a.position===null&&a.home===null));
  f.p=JSON.parse(JSON.stringify(f.p));f.group=f.p.groups[0];
  assert.ok(walk(f));assert.equal(f.group.discoveryState,'placed');assert.equal(f.group.members.length,4);
  assert.deepEqual(identities(f.p),before);assert.equal(JSON.stringify(f.d),geometry);
});

test('a quest naming an ordinary prepared patrol protects its identity, not its arbitrary tile',()=>{
  const f=fixture(),protectedNames=f.group.members.slice(0,2);
  D.setup(f.d,f.p,{protectedNames});
  assert.equal(f.group.discoveryState,'pending');assert.ok(walk(f,{protectedNames}));
  assert.equal(f.group.discoveryState,'placed');assert.deepEqual(f.group.members,['Patrol 0','Patrol 1','Patrol 2','Patrol 3']);
});

test('prepared roaming groups in settlement hubs still use travel placement',()=>{
  const f=fixture();f.p.settlement={hub:true};D.setup(f.d,f.p);
  assert.equal(f.group.discoveryState,'pending');assert.ok(walk(f));
});

test('proximity behind a wall is not an observed entry encounter',()=>{
  const f=fixture();delete f.group.discoveryState;f.group.site={x:144,y:128};
  for(const [n,a]of Object.values(f.p.actors).entries())a.position=a.home={x:144+n,y:128};
  f.d.cells={...cells};for(let y=110;y<150;y++)f.d.cells[`136,${y}`]={...floor,tile:'wall'};
  D.setup(f.d,f.p);assert.equal(f.group.discoveryState,'pending');
});

test('nearby visible groups are not teleported away but remain recoverable if never encountered',()=>{
  const f=fixture();delete f.group.discoveryState;f.group.site={x:144,y:128};
  for(const [n,a]of Object.values(f.p.actors).entries())a.position=a.home={x:144+n,y:128};
  D.setup(f.d,f.p);assert.equal(f.group.discoveryState,'fixed');
  const before=JSON.stringify(f.group.site);D.setup(f.d,f.p,{player:{x:130,y:128}});assert.equal(JSON.stringify(f.group.site),before);
  D.setup(f.d,f.p,{player:{x:220,y:220}});assert.equal(f.group.discoveryState,'pending');
});

for(const reason of ['discovered','engaged','exhausted','intro','met','spoke','pursuit','dead','unconscious','recruited','departed'])
test('known or resolved encounters retain their locations: '+reason,()=>{
  const f=fixture(),a=f.p.actors[f.group.members[0]];
  if(['discovered','engaged','exhausted'].includes(reason))f.group.status=reason;
  else if(reason==='intro')f.group.introPlayed=true;
  else if(reason==='met')a.encounteredAt=1;
  else if(reason==='spoke')a.lastSpokeAt=1;
  else if(reason==='pursuit')a.pursuit={lastSeenAt:1};
  else if(reason==='unconscious')a.hp=0;
  else a.status=reason;
  const before=JSON.stringify(f.group.site);D.setup(f.d,f.p);walk(f);
  assert.equal(f.group.discoveryState,'fixed');assert.equal(JSON.stringify(f.group.site),before);
});

for(const reason of ['fixed-group','quest-group','fixed-actor','quest-actor','deity','regional','successor','service','provider','unit','home','occupation','camp','quest-speaker','protected','settlement'])
test('actual location-bound encounters retain their sites: '+reason,()=>{
  const f=fixture(),a=f.p.actors[f.group.members[0]],protectedNames=[];
  if(reason==='fixed-group')f.group.fixed=true;
  if(reason==='quest-group')f.group.questBound=true;
  if(reason==='fixed-actor')a.fixed=true;
  if(reason==='quest-actor')a.questBound=true;
  if(reason==='deity')a.deityId='deity';
  if(reason==='regional')a.regionalStoryId='story';
  if(reason==='successor')a.deliverySuccessorId='successor';
  if(reason==='service')a.serviceRole='shop';
  if(reason==='provider')f.p.serviceProviders=[a.name];
  if(reason==='unit')a.unitId='building-room';
  if(reason==='home')a.homeSite='tower';
  if(reason==='occupation')a.occupation={mode:'work'};
  if(reason==='camp'){for(const a of Object.values(f.p.actors))a.routine='guard';f.d.sceneLandmarks=[{type:'camp',x:20,y:20}];}
  if(reason==='quest-speaker')f.p.questIntroduction={speaker:a.name,status:'pending'};
  if(reason==='protected'){delete f.group.setEncounter;protectedNames.push(a.name);}
  if(reason==='settlement'){delete f.group.setEncounter;f.p.settlement={hub:true};}
  const before=JSON.stringify(f.group.site);D.setup(f.d,f.p,{protectedNames});walk(f,{protectedNames});
  assert.equal(f.group.discoveryState,'fixed');assert.equal(JSON.stringify(f.group.site),before);
});

test('starter, indoor, small outdoor and boss spaces never run the recovery migration',()=>{
  for(const kind of ['starter','indoor','small','boss']){
    const f=fixture();
    if(kind==='starter'){f.d.geoKey='0,0,0';f.p.starting=true;}
    if(kind==='indoor')f.d.classification.indoor=true;
    if(kind==='small')f.d.layout={width:64,height:64};
    const before=JSON.stringify(f.p);assert.equal(D.setup(f.d,f.p,{bossRoom:kind==='boss'}),false);
    assert.equal(JSON.stringify(f.p),before);
  }
});

test('the tick path also recovers legacy fixed groups without bypassing travel pacing',()=>{
  const f=fixture();D.setup(f.d,f.p);f.group.discoveryState='fixed';f.group.site={x:20,y:20};
  for(const a of Object.values(f.p.actors))a.position=a.home={x:20,y:20};
  assert.equal(D.tick(f.d,f.p,[],{x:128.5,y:128.5},{now:1000}).discoveries.length,0);
  assert.equal(D.tick(f.d,f.p,[],{x:132.5,y:128.5},{now:4000}).discoveries.length,0);
  assert.equal(f.group.discoveryState,'pending');assert.equal(f.group.site,null);
});

test('population service preserves quest target bindings and revisions when recovering a saved patrol',()=>{
  const f=fixture(),tasks=[{status:'In Progress',story:{stages:[{kind:'encounter',targets:f.group.members.slice(0,2)}]}}];
  let db=JSON.stringify({[f.d.geoKey]:{name:'Outdoor area',inhabitants:f.p}});
  const state={getRoomPopulation:()=>f.p,setRoomPopulation(){},getUpdatedGameConsole:()=>'',getCurrentTasks:()=>tasks,
    getRoomNameDatabase:()=>db,setRoomNameDatabase:v=>{db=v}};
  const before=f.p.revision,service=createPopulationService(state);
  service.get(f.d.geoKey,'',f.d,{x:128.5,y:128.5});
  assert.equal(f.group.discoveryState,'pending');assert.ok(f.p.revision>before);
  service.save(f.p);assert.equal(JSON.parse(db)[f.d.geoKey].inhabitants.groups[0].discoveryState,'pending');
  assert.deepEqual(tasks[0].story.stages[0].targets,['Patrol 0','Patrol 1']);
});
