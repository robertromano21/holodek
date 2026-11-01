'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture,request,control}=require('./host-local-floors.test.cjs'),State=require('../sharedState'),C=require('../retort/cityCirculation');
test('legacy procedural doorway requests are true no-ops, preserving position, crowd identities and sprite records',async()=>{
  const f=fixture(),d=State.getRoomDungeonForSimulation({x:0,y:0,z:0});
  d.cityCrowd={version:1,revision:7,actors:{blob:{id:'blob',name:'Local Ooze',race:'Native Ooze',position:{x:20,y:20},status:'ambient',seed:123}}};
  const before=JSON.stringify(State.exportSaveState()),r={...request(control('stairs','up')),buildingId:f.b.id,player:require('../assets/cityParcels').entrance(f.b)};
  const result=await require('../retort/cityFloorTravel').transition(State,r,{door:true});
  assert.equal(result.unchanged,true);assert.equal(JSON.stringify(State.exportSaveState()),before);
});
test('street residents and ambient body seeds survive going upstairs, returning and public database synchronization',async()=>{
  fixture();const coords={x:0,y:0,z:0},d=State.getRoomDungeonForSimulation(coords),sprite={spec:{body:'ooze',seed:52},dataUrl:'saved-body'};
  d.cityCrowd={version:1,revision:9,actors:{blob:{id:'blob',name:'Local Ooze',race:'Native Ooze',position:{x:20,y:20},status:'ambient',seed:123}}};
  const before=structuredClone(d.cityCrowd),roster=JSON.parse(State.getCombatCharactersString());
  roster.push({name:'Street Keeper',type:'monster',hp:7,state:'Neutral',mazeX:20,mazeY:23,mazeRoomKey:'0,0,0',sprite});
  State.setCombatCharactersString(JSON.stringify(roster));
  await C.travel(State,request(control('stairs','up')));
  const publicDb=State.getRoomNameDatabase();assert.equal(JSON.parse(publicDb)['0,0,0'].cityFloors.streetResidents,undefined);
  State.setRoomNameDatabase(publicDb);
  await C.travel(State,request(control('stairs','down')));
  assert.deepEqual(State.getRoomDungeonForSimulation(coords).cityCrowd,before);
  const restored=JSON.parse(State.getCombatCharactersString()).find(a=>a.name==='Street Keeper');
  assert.deepEqual(restored.sprite,sprite);assert.equal(restored.mazeX,20);assert.equal(restored.mazeY,23);
});
test('entering a shop offers services first, then authors one welcome and opens trade after acceptance',async()=>{
  const row={id:'worker',name:'Keeper',status:'ambient',position:{x:5,y:5},occupation:{mode:'work',venueId:'shop',venueType:'shop'}},
    d={geoKey:'0,0,0',cityBlocks:{buildings:[{id:'shop',type:'shop',left:1,top:1,width:12,depth:12}]},cityCrowd:{actors:{worker:row}}},
    player={x:5.5,y:6.5},calls=[],trades=[],offers=[];
  const root={dungeonRunId:'run',currentDungeon:d,document:{activeElement:{tagName:'BODY'},querySelector:()=>null},
    DungeonInhabitants:{lineClear:()=>true},getDungeonLifeContext:()=>({dungeon:d,player}),getEconomyResidentInfo:()=>({kind:'shop'}),
    fetch:async(url,request)=>{calls.push(JSON.parse(request.body));return{ok:true,json:async()=>({runId:'run',geoKey:d.geoKey,actor:row.name,dialogue:[]})};},
    CommerceUi:{inviteAmbient:(_actor,accept)=>{offers.push(accept);return true;},open:async name=>trades.push(name)}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/cityCrowdUi'),'utf8'),{window:root});
  await root.CityCrowdUi.onFrame(d,player);await root.CityCrowdUi.onFrame(d,player);
  assert.equal(calls.length,0);assert.equal(offers.length,1);assert.equal(trades.length,0);await offers[0]();
  assert.equal(calls.length,1);assert.deepEqual(trades,['Keeper']);
});
test('a shop visit outside greeting range, through a wall, in combat or paused never starts authorship',async()=>{
  for(const change of [r=>r.gamePaused=true,r=>r.actionDiceState={active:true},r=>r.DungeonInhabitants.lineClear=()=>false]){
    const d={geoKey:'0,0,0',cityBlocks:{buildings:[{id:'shop',type:'shop',left:1,top:1,width:12,depth:12}]},cityCrowd:{actors:{}}},
      root={currentDungeon:d,document:{querySelector:()=>null},DungeonInhabitants:{lineClear:()=>true},fetch:()=>{throw Error('No model call');}};
    change(root);vm.runInNewContext(fs.readFileSync(require.resolve('../assets/cityCrowdUi'),'utf8'),{window:root});
    assert.equal(root.CityCrowdUi.onFrame(d,{x:5,y:5}),undefined);
  }
});
