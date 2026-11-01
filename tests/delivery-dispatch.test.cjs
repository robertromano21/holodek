'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../retort/economy'),I=require('../assets/dungeonInhabitants'),D=require('../retort/deliveryMissions'),Give=require('../retort/itemTransfer');
const sheet=require('../retort/initialGameState').formatStartingCharacterSheet;
function fixture(){
  const row=name=>sheet({Name:name,Sex:'Female',Race:'Human',Class:'Cleric',Level:2,AC:10,HP:12,MaxHP:12,State:'Neutral'},6,name==='Hero'?'pc':'npc');
  const pops={},dungeons={};
  for(const [key,name]of [['1,0,0','Sender'],['2,0,0','General']]){
    const p=I.createPopulation(key,[{name,race:'Human',className:'Cleric',allegiance:'Neutral',job:'official',encounterId:name}]);
    Object.assign(p.actors[name],{hp:12,maxHp:12,position:{x:5,y:4},home:{x:5,y:4},sheet:row(name)});p.groups[0].site={x:5,y:4};pops[key]=p;
    const d={geoKey:key,start:{x:4,y:4},layout:{width:12,height:12},cells:{},sceneObjects:[],tiles:{}};
    for(let y=0;y<12;y++)for(let x=0;x<12;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:3};dungeons[key]=d;
  }
  const campaignSetting={inhabited:true,communityId:'city',community:'Test City',authority:'Council',faction:{name:'Council',allegiance:'Neutral'}};
  let db={'0,0,0':{},'1,0,0':{name:'Guild Hall',campaignSetting,inhabitants:pops['1,0,0'],objects:[],
    monsters:{inRoom:row('Sender')},exits:{east:{status:'open',targetCoordinates:'2,0,0'}}},
    '2,0,0':{name:'Command Hall',populationComplete:true,campaignSetting,inhabitants:pops['2,0,0'],objects:[],monsters:{inRoom:row('General')}}};
  const mission=D.seed(db,'1,0,0',pops['1,0,0'],'dispatch-test');assert.ok(mission);
  let key='1,0,0',text=`Room Name: Guild Hall\nCoordinates: X: 1, Y: 0, Z: 0\nInventory: Empty\nInventory Properties: None\nObjects in Room: None\nObjects in Room Properties: None\nPC:\n${row('Hero')}\nNPCs in Party: None\nMonsters in Room:\n${row('Sender')}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nRooms Visited: 2`,roster;
  const install=name=>roster=[{name:'Hero',type:'pc',hp:12,mazeX:4,mazeY:4,mazeRoomKey:key},{name,type:'monster',hp:12,state:'Neutral',mazeX:5,mazeY:4,mazeRoomKey:key}];install('Sender');
  const state={getDungeonRunId:()=> 'dispatch-run',getGamePaused:()=>false,getLastCoords:()=>({x:Number(key[0]),y:0,z:0}),
    getRoomNameDatabase:()=>JSON.stringify(db),setRoomNameDatabase:t=>db=JSON.parse(t),getUpdatedGameConsole:()=>text,setUpdatedGameConsole:t=>text=t,
    getCombatCharactersString:()=>JSON.stringify(roster),setCombatCharactersString:t=>roster=JSON.parse(t),
    getRoomPopulation:k=>pops[k],setRoomPopulation:(k,p)=>pops[k]=p,getRoomDungeonForSimulation:()=>dungeons[key],getCurrentTasks:()=>[],getCurrentTaskIndex:()=>0};
  const service={save:p=>{pops[key]=p;db[key].inhabitants=p;}};E.start(state,{Name:'Hero'},[]);
  const accept=(nonce='dispatch:accept',actor='Sender')=>E.action(state,service,{kind:'accept-mission',actor,missionId:mission.id,runId:'dispatch-run',geoKey:key,revision:E.project(state).revision,nonce});
  const move=()=>{key='2,0,0';text=text.replace('X: 1, Y: 0, Z: 0','X: 2, Y: 0, Z: 0').replace(I.sectionPattern('Monsters in Room'),(_,header)=>header+'\n'+row('General')+'\n');install('General');};
  return{state,service,accept,move,mission,get db(){return db;}};
}
test('dispatch acceptance issues one real parcel; cross-room handoff pays once with completion feedback',()=>{
  const f=fixture(),before=E.project(f.state).silver;
  const accepted=f.accept();assert.ok(!accepted.error,accepted.error);assert.match(f.state.getUpdatedGameConsole(),/sealed dispatch/);
  assert.equal(f.accept().duplicate,true);assert.equal(E.field(f.state.getUpdatedGameConsole(),'Inventory').split(',').length,1);
  f.move();assert.equal(E.view(f.state,'General').missions[0].status,'accepted');
  const result=Give.give(f.state,f.service,'give '+f.mission.item+' to General');assert.match(result.content,/You give/);
  const receipt=f.db['2,0,0'].itemTransfers[0];assert.equal(receipt.minorMissionId,f.mission.id);
  E.refresh(f.state);assert.equal(E.project(f.state).silver,before+f.mission.rewardSilver);
  assert.equal(f.db['1,0,0'].minorMissions[f.mission.id].status,'completed');E.refresh(f.state);
  assert.equal(E.project(f.state).silver,before+f.mission.rewardSilver);assert.equal(f.state.getCurrentTaskIndex(),0);
});
test('full inventory refuses a dispatch atomically and a recipient cannot accept on the sender behalf',()=>{
  const f=fixture();f.state.setUpdatedGameConsole(E.write(f.state.getUpdatedGameConsole(),'Inventory',Array.from({length:25},(_,i)=>'item '+i).join(', ')));
  assert.match(f.accept().error,/full|25|carry/i);assert.equal(f.db['1,0,0'].minorMissions[f.mission.id].status,'offered');
  assert.equal(f.db['1,0,0'].minorMissions[f.mission.id].issued,undefined);f.move();
  assert.match(f.accept('dispatch:wrong','General').error,/unavailable|sender|origin/i);
});
test('a same-named item without the issued dispatch identity cannot satisfy the contract',()=>{
  const f=fixture();assert.ok(!f.accept().error);f.move();
  const db=f.db;db['2,0,0'].itemTransfers=[{id:'fake',source:'engine-give-item-v1',roomKey:'2,0,0',recipient:'General',item:f.mission.item,at:Date.now()}];
  f.state.setRoomNameDatabase(JSON.stringify(db));const balance=E.project(f.state).silver;E.refresh(f.state);
  assert.equal(E.project(f.state).silver,balance);assert.equal(f.db['1,0,0'].minorMissions[f.mission.id].status,'accepted');
});
