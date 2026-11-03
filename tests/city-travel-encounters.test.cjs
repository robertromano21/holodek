'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const I=require('../assets/dungeonInhabitants'),D=require('../assets/outdoorDiscovery'),E=require('../retort/randomEncounters');
const floor=Object.freeze({tile:'floor',floorHeight:0,ceilHeight:8,cityStreet:'road'}),cells={};
for(let y=0;y<128;y++)for(let x=0;x<128;x++)cells[`${x},${y}`]=floor;
function fixture(){
  const d={geoKey:'2,2,0',classification:{indoor:false},layout:{width:128,height:128},start:{x:16,y:64},
    cityBlocks:{version:1,buildings:[{id:'shop'}]},cells:{...cells},sceneObjects:[{name:'shop ledger',type:'other',x:18,y:18}]};
  for(let y=8;y<40;y++)for(let x=8;x<40;x++)d.cells[`${x},${y}`]={...floor,cityParcel:'shop'};
  const p=I.createPopulation(d.geoKey,[
    {name:'Keeper',routine:'work',serviceRole:'shop',allegiance:'Neutral',encounterId:'shop'},
    {name:'Contact',routine:'wander',allegiance:'Neutral',encounterId:'quest-contact'},
    {name:'Visitor',routine:'wander',allegiance:'Neutral',encounterId:'visitor'},
    {name:'Hunter A',routine:'patrol',allegiance:'Hostile',encounterId:'patrol'},
    {name:'Hunter B',routine:'patrol',allegiance:'Hostile',encounterId:'patrol'}],{indoor:false,groupLimit:6});
  p.settlement={hub:{x:16,y:64}};p.serviceProviders=['Keeper'];p.questIntroduction={speaker:'Contact'};
  for(const g of p.groups){g.site={x:12,y:12};g.members.forEach((name,i)=>{p.actors[name].position=p.actors[name].home={x:12+i,y:12};p.actors[name].hp=20;});}
  D.setup(d,p,{fresh:true});
  const roster=Object.values(p.actors).map(a=>({name:a.name,type:'monster',hp:20,mazeRoomKey:d.geoKey}));I.attach(roster,p);
  const player={x:16.5,y:64.5};
  p.randomEncounters={version:1,count:0,attempts:0,distance:0,movingMs:0,lastAttempt:0,recentRaces:[],heading:0};
  const state={getLastCoords:()=>({x:2,y:2,z:0}),getDungeonRunId:()=> 'run',getGamePaused:()=>false,getCombatActive:()=>false,
    getDungeonTestingMode:()=>false,getRoomDungeonForSimulation:()=>d,getCombatCharactersString:()=>JSON.stringify([
      {name:'PC',type:'pc',hp:20,state:'Alive',level:3,mazeRoomKey:d.geoKey,mazeX:Math.floor(player.x),mazeY:Math.floor(player.y)}])};
  const visit={population:p,encounters:[],discoveries:[],dialogue:[]};
  return{d,p,roster,player,state,visit,
    tick:(x,y,now)=>D.tick(d,p,roster,{x,y},{now,consoleText:'Objects in Room: shop ledger'})};
}
test('large city streets, including roofed city districts, share discovery eligibility without enabling shops or the safe opening',()=>{
  const f=fixture();assert.equal(D.eligible(f.d),true);
  f.d.classification.indoor=true;assert.equal(D.eligible(f.d),true);
  f.d.cityFloorContext={floor:1};assert.equal(D.eligible(f.d),false);
  delete f.d.cityFloorContext;f.d.geoKey='0,0,0';assert.equal(D.eligible(f.d),false);
  f.d.geoKey='2,2,0';f.d.layout={width:32,height:32};assert.equal(D.eligible(f.d),false);
});
test('city setup preserves services, quest contacts and ground contents while preparing only unseen mobile groups',()=>{
  const f=fixture();
  assert.equal(f.p.actors.Keeper.discoveryState,'fixed');assert.equal(f.p.actors.Contact.discoveryState,'fixed');
  assert.equal(f.p.actors.Visitor.discoveryState,'pending');assert.equal(f.p.actors['Hunter A'].discoveryState,'pending');
  assert.equal(f.p.travelDiscovery.objects['shop ledger'].status,'fixed');
  assert.deepEqual(D.objects(f.d.sceneObjects,f.p),f.d.sceneObjects);
});
test('known or speaking city residents and exhausted ground loot cannot become new wandering opportunities',()=>{
  for(const field of ['encounteredAt','lastSpokeAt']){
    const f=fixture(),actor=f.p.actors.Visitor,group=f.p.groups.find(g=>g.members.includes(actor.name));
    delete group.discoveryState;actor[field]=123;actor.position={x:12,y:12};
    f.p.travelDiscovery.objects['shop ledger'].status='exhausted';D.setup(f.d,f.p);
    assert.equal(actor.discoveryState,'fixed');assert.deepEqual(actor.position,{x:12,y:12});
    assert.equal(f.p.travelDiscovery.objects['shop ledger'].status,'exhausted');
  }
});
test('public city parks are exploration space, but ordinary building parcels remain private',()=>{
  const f=fixture(),p={x:18.5,y:18.5};assert.equal(D.publicPoint(f.d,p),false);
  f.d.cityBlocks.parks=[{id:'shop'}];assert.equal(D.publicPoint(f.d,p),true);
});
test('walking through a city reveals a prepared group locally, without changing identities, geometry or shop contents',()=>{
  const f=fixture(),before=JSON.stringify(f.d),names=Object.keys(f.p.actors),keeper=JSON.stringify(f.p.actors.Keeper);
  let event,player;
  for(let n=0;n<24&&!event;n++){player={x:16.5+n*4,y:64.5};event=f.tick(player.x,player.y,1000+n*3000).discoveries[0];}
  assert.ok(event);assert.match(event.text,/along the street/);assert.doesNotMatch(event.text,/wastes/);
  assert.ok(Math.hypot(event.x+.5-player.x,event.y+.5-player.y)>=D.SPAWN_MIN);
  assert.equal(f.d.cells[`${event.x},${event.y}`].cityParcel,undefined);
  assert.equal(JSON.stringify(f.d),before);assert.deepEqual(Object.keys(f.p.actors),names);assert.equal(JSON.stringify(f.p.actors.Keeper),keeper);
  const group=f.p.groups.find(g=>g.id===event.groupId);group.status='discovered';D.release(f.p,group.id);
  const positions=JSON.stringify(group.members.map(name=>f.p.actors[name].position));
  const restored=JSON.parse(JSON.stringify(f.p));D.setup(f.d,restored);
  assert.equal(JSON.stringify(group.members.map(name=>restored.actors[name].position)),positions);
});
test('city travel never advances while standing, in a private building, after a teleport or while jittering in place',()=>{
  const f=fixture();
  for(let n=0;n<70;n++)assert.equal(f.tick(16.5,64.5,1000+n*3000).discoveries.length,0);
  assert.equal(f.p.travelDiscovery.movingMs,0);
  for(let n=0;n<30;n++)assert.equal(f.tick(12.5+n%16,16.5,220000+n*3000).waitReason,'inside-building');
  assert.equal(f.p.travelDiscovery.movingMs,0);
  f.tick(16.5,64.5,400000);f.tick(110.5,100.5,403000);assert.equal(f.p.travelDiscovery.movingMs,0);
  const g=fixture();for(let n=0;n<80;n++)assert.equal(g.tick(16.5+n%2*4,64.5,1000+n*3000).discoveries.length,0);
  assert.ok(g.p.travelDiscovery.distance<12);
});
test('walking through a private shop between street samples does not earn city encounter progress',()=>{
  const f=fixture(),travel={distance:0,movingMs:0,walkedDistance:0,explored:''};
  D.sample(travel,f.d,{x:6.5,y:16.5},1000);D.sample(travel,f.d,{x:42.5,y:16.5},4000);
  assert.equal(travel.distance,0);assert.equal(travel.movingMs,0);
});
test('city discovery respects real movement time even when the whole street was already explored',()=>{
  const f=fixture();f.p.travelDiscovery.explored='f'.repeat(256);let event,elapsed;
  for(let n=0;n<24&&!event;n++){elapsed=n*3000;event=f.tick(16.5+n*3,64.5,1000+elapsed).discoveries[0];}
  assert.ok(event);assert.ok(elapsed>=D.QUIET_MOVING_MS);assert.equal(f.p.travelDiscovery.sequence,1);
});
test('street placement does not cross into walk-in shops, occupy ambient citizens or move through building shortcuts',()=>{
  const f=fixture();f.d.cells={};
  for(let y=40;y<=87;y++)for(let x=0;x<128;x++)f.d.cells[`${x},${y}`]={...floor,...(y<62||y>66?{cityParcel:'private'}:{})};
  const player={x:32.5,y:64.5},occupied=new Set(['48,64']);
  const pool=D.candidates(f.d,player,0,occupied);assert.ok(pool.length);
  const spaces=D.groupSpaces(f.d,pool[0],6,occupied,player);assert.equal(spaces.length,6);
  for(const p of spaces){assert.equal(f.d.cells[`${p.x},${p.y}`].cityParcel,undefined);assert.equal(occupied.has(`${p.x},${p.y}`),false);}
});
function ready(f){Object.assign(f.p.randomEncounters,{distance:100,movingMs:100000,walkedDistance:100,excursion:30});}
test('city refill pacing uses active walking, a 48-tile travel budget and at most two groups',()=>{
  const f=fixture();assert.deepEqual([E.policy(false,.5,{city:true}).distance,E.policy(false,.5,{city:true}).cooldown,E.policy(false,.5,{city:true}).limit],[48,90000,2]);
  f.p.randomEncounters.distance=100;assert.equal(E.opportunity(f.state,f.visit,f.player,200000),null,'Idle wall time does not satisfy the active clock');
  ready(f);assert.ok(E.opportunity(f.state,f.visit,f.player,200000));
  f.p.randomEncounters.count=2;assert.equal(E.opportunity(f.state,f.visit,f.player,200000),null);
});
test('peaceful city residents and incidental speech do not suppress street opportunities, but actual nearby threats do',()=>{
  const f=fixture();ready(f);Object.assign(f.p.actors.Keeper,{position:{x:18,y:64},discoveryState:'fixed'});
  f.visit.dialogue=[{speaker:'Keeper',kind:'canned',line:'A saved passing remark.'}];
  assert.ok(E.opportunity(f.state,f.visit,f.player,200000));
  Object.assign(f.p.actors['Hunter A'],{position:{x:24,y:64},discoveryState:'fixed'});
  assert.equal(E.opportunity(f.state,f.visit,f.player,200000),null);assert.equal(f.p.randomEncounters.movingMs,0);
});
test('city refill guards keep conversation, services, active combat, starting rooms and unresolved discoveries quiet',()=>{
  for(const change of [f=>f.p.dialogueFocus={until:300000},f=>{f.player.x=18.5;f.player.y=18.5;},
    f=>f.state.getGamePaused=()=>true,f=>f.state.getCombatActive=()=>true,f=>f.p.starting=true,
    f=>f.p.travelDiscovery.active={groupId:'unresolved'}]){
    const f=fixture();ready(f);change(f);assert.equal(E.opportunity(f.state,f.visit,f.player,200000),null);
  }
});
test('walking, quiet-time progress and the saved refill counters survive revisiting explored city streets',()=>{
  const f=fixture();f.p.randomEncounters.explored='f'.repeat(256);let opportunity;
  for(let n=0;n<50&&!opportunity;n++){
    f.player.x=16.5+Math.abs(n%16-8)*2;
    opportunity=E.opportunity(f.state,f.visit,f.player,100000+n*3000);
  }
  assert.ok(opportunity);assert.ok(f.p.randomEncounters.movingMs>=90000);assert.ok(f.p.randomEncounters.distance<48);
  const saved=JSON.parse(JSON.stringify(f.p));assert.equal(saved.randomEncounters.movingMs,f.p.randomEncounters.movingMs);
  assert.equal(saved.randomEncounters.walkedDistance,f.p.randomEncounters.walkedDistance);
});
test('population visit handoffs are tracked through receipt application before a queued command snapshots the room',()=>{
  const source=fs.readFileSync('assets/dungeonLifeUi.js','utf8'),start=source.indexOf("const visit = () => post('/room-population/visit'");
  const end=source.indexOf('if (!autonomyPending',start),body=source.slice(start,end);
  assert.ok(start>0);assert.match(body,/receivePopulation\(/);assert.match(body,/trackNative\(visit\)/);
  assert.ok(body.indexOf('receivePopulation(')<body.indexOf('trackNative(visit)'));
});
