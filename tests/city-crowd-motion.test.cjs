'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I=require('../assets/dungeonInhabitants'),Crowds=require('../retort/cityCrowds');
function fixture(){
  const d={geoKey:'0,0,0',_geometryStamp:'native-city',layout:{width:24,height:24},cells:{},tiles:{},sceneStructures:[],
    cityCrowd:{version:1,revision:1,actors:{a:{id:'a',name:'Citizen',status:'ambient',position:{x:10,y:10},occupation:{mode:'errand'}}}}};
  for(let y=0;y<24;y++)for(let x=0;x<24;x++)d.cells[`${x},${y}`]={tile:x&&y&&x<23&&y<23?'floor':'wall',floorHeight:0,ceilHeight:3};
  const window={DungeonInhabitants:I};vm.runInNewContext(fs.readFileSync('assets/cityCrowdMotion.js','utf8'),{window});
  let stored=d,paused=false;
  const state={getLastCoords:()=>({x:0,y:0,z:0}),getDungeonRunId:()=> 'run',getGamePaused:()=>paused,getRoomPopulation:()=>({actors:{}}),
    getCombatCharactersString:()=> '[]',getRoomDungeonForSimulation:()=>stored,setRoomDungeon:(_coords,next)=>stored=next};
  const request={runId:'run',geoKey:d.geoKey,geometryStamp:d._geometryStamp,player:{x:3.5,y:3.5}};
  return{d,window,api:window.CityCrowdMotion,state,request,row:d.cityCrowd.actors.a,get stored(){return stored;},pause:v=>paused=v};
}
test('unintroduced residents wander natively, stop for combat or their own conversation, and never call a model',()=>{
  const f=fixture(),occupied=new Set(['10,10']);
  f.api.advance(f.d,f.row,f.request.player,occupied,1000);
  assert.deepEqual({...f.api.advance(f.d,f.row,f.request.player,occupied,10000,{pinned:true})},{x:10,y:10});
  const p=f.api.advance(f.d,f.row,f.request.player,occupied,10000);assert.notDeepEqual({...p},{x:10,y:10});
  assert.equal(Math.abs(p.x-10)+Math.abs(p.y-10),1);f.window.gamePaused=true;
  assert.deepEqual({...f.api.advance(f.d,f.row,f.request.player,occupied,20000)},{...p});f.window.gamePaused=false;
  f.window.actionDiceState={active:{kind:'combat'}};assert.deepEqual({...f.api.advance(f.d,f.row,f.request.player,occupied,30000)},{...p});
});
test('verified native movement persists while preserving identity, geometry and click-to-author status',()=>{
  const f=fixture(),occupied=new Set(['10,10']);f.api.advance(f.d,f.row,f.request.player,occupied,1000);f.api.advance(f.d,f.row,f.request.player,occupied,10000);
  const paths=JSON.parse(JSON.stringify(f.api.observations(f.d))),before=JSON.stringify([f.d.cells,f.d.sceneStructures]);
  assert.equal(Crowds.move(f.state,{...f.request,crowdMovements:paths}),true);
  assert.deepEqual(f.stored.cityCrowd.actors.a.position,paths[0].path.at(-1));assert.equal(f.stored.cityCrowd.actors.a.name,'Citizen');
  assert.equal(f.stored.cityCrowd.actors.a.status,'ambient');assert.equal(f.stored._geometryStamp,'native-city');
  assert.equal(JSON.stringify([f.stored.cells,f.stored.sceneStructures]),before);
  f.api.reconcile(f.d,f.stored.cityCrowd);assert.equal(f.api.observations(f.d).length,0);
  assert.equal(Crowds.move(f.state,{...f.request,crowdMovements:paths}),false,'duplicate observations are idempotent');
});
test('stale, remote and paused movement cannot relocate citizens; wall collisions reset their path without moving them',()=>{
  const f=fixture(),path=[{id:'a',from:{x:10,y:10},path:[{x:11,y:10}]}];
  for(const change of [{runId:'old'},{geoKey:'1,0,0'},{geometryStamp:'old'},{player:{x:0,y:0}}])
    assert.equal(Crowds.move(f.state,{...f.request,...change,crowdMovements:path}),false);
  f.pause(true);assert.equal(Crowds.move(f.state,{...f.request,crowdMovements:path}),false);f.pause(false);
  f.d.cells['11,10'].tile='wall';assert.equal(Crowds.move(f.state,{...f.request,crowdMovements:path}),true);
  assert.deepEqual(f.stored.cityCrowd.actors.a.position,{x:10,y:10});assert.equal(f.stored.cityCrowd.actors.a.motionReset,1);
});
test('one click starts a resident introduction without a second button, and duplicate clicks share the pending request',async()=>{
  const f=fixture();let calls=0,resolve,applied=0,dialogue=0;
  const root={dungeonRunId:'run',currentDungeon:f.d,getDungeonLifeContext:()=>({dungeon:f.d,player:f.request.player}),
    fetch:async()=>{calls++;await new Promise(r=>resolve=r);return{ok:true,json:async()=>({runId:'run',geoKey:'0,0,0',dialogue:[{speaker:'Citizen',line:'Welcome.'}]})};},
    applyRealtimeCombatResult:async()=>applied++,DungeonLife:{receiveDialogue:()=>dialogue++},
    document:{createElement:()=>assert.fail('a second confirmation must not be created')}};
  vm.runInNewContext(fs.readFileSync('assets/cityCrowdUi.js','utf8'),{window:root});
  const actor={ambient:true,crowdId:'a',name:'Citizen',mazeRoomKey:f.d.geoKey};
  const work=root.CityCrowdUi.open(actor);assert.equal(calls,1);assert.equal(await root.CityCrowdUi.open(actor),false);
  resolve();assert.equal(await work,true);assert.equal(applied,1);assert.equal(dialogue,1);
});
test('an introduction response from a previous floor cannot overwrite the current scene',async()=>{
  const f=fixture();let resolve,applied=0;
  const root={dungeonRunId:'run',currentDungeon:f.d,getDungeonLifeContext:()=>({dungeon:f.d,player:f.request.player}),
    fetch:async()=>{await new Promise(r=>resolve=r);return{ok:true,json:async()=>({runId:'run',geoKey:'0,0,0'})};},applyRealtimeCombatResult:async()=>applied++};
  vm.runInNewContext(fs.readFileSync('assets/cityCrowdUi.js','utf8'),{window:root});
  const work=root.CityCrowdUi.open({ambient:true,crowdId:'a',name:'Citizen',mazeRoomKey:'0,0,0'});root.currentDungeon={geoKey:'0,0,0'};
  resolve();assert.equal(await work,false);assert.equal(applied,0);
});
