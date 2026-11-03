'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),V=require('../retort/cityVenueServices');
function fixture(type){
  let now=1000;
  const player={x:5.5,y:6.5},calls=[],menus=[],offers=[],acceptors=[],row={id:'one',name:'Local',status:'ambient',seed:0,position:{x:5,y:5},
    occupation:{mode:type?'work':'visit',venueId:'venue',venueType:type||'home'}},d={geoKey:'0,0,0',cityCrowd:{actors:{one:row}},
      ...(type?{cityBlocks:{buildings:[{id:'venue',type,left:1,top:1,width:12,depth:12}]}}:{})},
    root={dungeonRunId:'run',currentDungeon:d,document:{activeElement:{tagName:'BODY'},querySelector:()=>null},DungeonInhabitants:{lineClear:()=>true},
      getDungeonLifeContext:()=>({dungeon:d,player}),getEconomyResidentInfo:()=>type?{kind:type==='temple'?'temple':'venue',venue:true}:null,
      CommerceUi:{invite:name=>{offers.push(name);return true;},inviteAmbient:(actor,accept)=>{offers.push(actor.name);acceptors.push(accept);return true;},
        open:async name=>{menus.push(name);return true;}},fetch:async(_url,r)=>{calls.push(JSON.parse(r.body));row.status='promoted';
        return{ok:true,json:async()=>({runId:'run',geoKey:d.geoKey,actor:row.name,dialogue:[]})};}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/cityCrowdUi'),'utf8'),{window:root,Date:{now:()=>now}});
  return{root,d,player,row,calls,menus,offers,acceptors,at:n=>now=n};
}
for(const type of ['temple','inn','clinic','library','guild'])test(type+' operator offers services before an introduction or model call',async()=>{
  const f=fixture(type);await f.root.CityCrowdUi.onFrame(f.d,f.player);await f.root.CityCrowdUi.onFrame(f.d,f.player);
  assert.equal(f.calls.length,0);assert.deepEqual(f.offers,['Local']);assert.deepEqual(f.menus,[]);
  await f.acceptors[0]();assert.equal(f.calls.length,1);assert.deepEqual(f.menus,['Local']);
});

test('clicking an ambient operator also waits for consent, with no second Meet prompt',async()=>{
  const f=fixture('shop');await f.root.CityCrowdUi.open({ambient:true,crowdId:f.row.id,mazeRoomKey:f.d.geoKey,name:f.row.name});
  assert.equal(f.calls.length,0);assert.deepEqual(f.offers,['Local']);await f.acceptors[0]();
  assert.equal(f.calls.length,1);assert.deepEqual(f.menus,['Local']);
});
test('accepting services opens the menu on the first encounter even before cached resident metadata catches up',async()=>{
  const f=fixture('shop');f.root.getEconomyResidentInfo=()=>null;
  await f.root.CityCrowdUi.open({ambient:true,crowdId:f.row.id,mazeRoomKey:f.d.geoKey,name:f.row.name},{services:true});
  assert.equal(f.calls.length,1);assert.deepEqual(f.menus,['Local']);
});
test('a same-room geometry refresh does not discard the service menu after the introduction',async()=>{
  const f=fixture('shop');f.root.CityFloorScope={token:()=> 'same-floor'};
  f.root.applyRealtimeCombatResult=async()=>{f.root.currentDungeon={...f.d};};
  assert.equal(await f.root.CityCrowdUi.open({ambient:true,crowdId:f.row.id,mazeRoomKey:f.d.geoKey,name:f.row.name},{services:true}),true);
  assert.deepEqual(f.menus,['Local']);
});
test('a changed run, room or floor cannot open an old service invitation after authorship',async()=>{
  for(const change of [f=>f.root.dungeonRunId='other',f=>f.root.currentDungeon={geoKey:'1,0,0'},
    f=>f.root.CityFloorScope={token:()=> 'other-floor'}]){
    const f=fixture('shop');f.root.applyRealtimeCombatResult=async()=>change(f);
    assert.equal(await f.root.CityCrowdUi.open({ambient:true,crowdId:f.row.id,mazeRoomKey:f.d.geoKey,name:f.row.name},{services:true}),false);
    assert.deepEqual(f.menus,[]);
  }
});

test('named service providers offer services automatically even outside ambient city crowds',()=>{
  const f=fixture('shop');delete f.d.cityCrowd;
  f.root.combatCharacters=[{name:'Keeper',type:'monster',state:'Neutral',hp:5,mazeX:5,mazeY:5,mazeRoomKey:f.d.geoKey}];
  for(let i=0;i<20;i++)f.root.CityCrowdUi.onFrame(f.d,f.player);
  assert.deepEqual(f.offers,['Keeper']);assert.equal(f.calls.length,0);
  f.at(20000);f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.offers.length,1);
  f.at(92000);f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.offers.length,2);
});

test('a saved job giver offers work on the street with the same shared cooldown as services',()=>{
  const f=fixture();delete f.d.cityCrowd;f.root.getEconomyResidentInfo=()=>({kind:'mission',jobs:true});
  f.root.combatCharacters=[{name:'Job Giver',type:'monster',state:'Neutral',hp:6,mazeX:5,mazeY:5,mazeRoomKey:f.d.geoKey}];
  for(let i=0;i<20;i++)f.root.CityCrowdUi.onFrame(f.d,f.player);
  assert.deepEqual(f.offers,['Job Giver']);assert.equal(f.calls.length,0);
});

test('service offers respect distance, sightlines, allegiance, room and the shared crowd budget',()=>{
  for(const modify of [a=>a.mazeX=30,a=>a.mazeRoomKey='9,9,9',a=>a.state='Hostile',a=>a.hp=0,a=>a.discoveryState='pending']){
    const f=fixture('shop');delete f.d.cityCrowd;
    const a={name:'Keeper',type:'monster',state:'Neutral',hp:5,mazeX:5,mazeY:5,mazeRoomKey:f.d.geoKey};modify(a);
    f.root.combatCharacters=[a];f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.offers.length,0);
  }
  const f=fixture('shop');f.root.DungeonInhabitants.lineClear=()=>false;f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.offers.length,0);
  f.root.DungeonInhabitants.lineClear=()=>true;f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.offers.length,1);
  f.row.name='Another Worker';f.at(8000);f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.offers.length,1);
  f.at(10000);f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.offers.length,2);
});
test('ordinary city greetings have a grace period, movement threshold and shared 90-second cooldown',async()=>{
  const f=fixture();await f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.calls.length,0);
  f.at(20000);await f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.calls.length,0,'No calls while stationary');
  f.player.x=20.5;f.row.position.x=20;await f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.calls.length,1);assert.deepEqual(f.menus,[]);
  f.row.status='ambient';f.row.id='two';f.player.x=40.5;f.row.position.x=40;
  f.at(100000);await f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.calls.length,1);
  f.at(111000);await f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.calls.length,2);
});
test('ordinary residents do not interrupt active speech or trigger a new request on every step',async()=>{
  const f=fixture();await f.root.CityCrowdUi.onFrame(f.d,f.player);f.at(90000);f.player.x=20.5;f.row.position.x=20;
  f.root.DungeonLife={hasPendingSpeech:()=>true};await f.root.CityCrowdUi.onFrame(f.d,f.player);assert.equal(f.calls.length,0);
  f.root.DungeonLife.hasPendingSpeech=()=>false;f.row.seed=1;
  for(let i=0;i<50;i++)await f.root.CityCrowdUi.onFrame(f.d,f.player);
  assert.equal(f.calls.length,0,'Ineligible bystanders must remain inexpensive');
});
test('service desks are separately bound and described at shared city coordinates',()=>{
  const room={inhabitants:{actors:{}}};
  for(const [name,type]of [['Host','inn'],['Archivist','library'],['Attendant','temple']]){
    const a={name,hp:7,status:'present',allegiance:'Neutral'};room.inhabitants.actors[name]=a;
    const desk=V.bind(room,a,{mode:'work',venueId:name,venueType:type},'1,0,0');
    assert.equal(V.forActor(room,name),desk);assert.equal(V.describe(room,name).type,type);
    if(type==='inn')assert.ok(desk.capabilities.includes('lodging'));
  }
  assert.equal(Object.keys(room.venueDesks).length,3);
});
