'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Opening=require('../retort/openingQuestPreparation'),Recovery=require('../retort/roomTravelRecovery'),Shape=require('../saveGameState');
const sheet=(name='Keeper')=>`${name}\nUnknown\nShade\nWarden\nLevel: 4\nAC: 12\nXP: 8000\nHP: 17\nMaxHP: 20\nEquipped: Weapon: None, Armor: None, Shield: None, Other: None\nAttack: 1\nDamage: 2\nArmor: 0\nMagic: 0\nState: Neutral`;
function plans(){
  return {id:'quest',bossKey:'2,0,0',assignment:{assignments:[{owner:'north',destination:'0,1,0'}],
    reservations:[{id:'north',key:'0,1,0'},{id:'east',key:'1,0,0'},{id:'quest',key:'2,0,0'}]}};
}
function database(){return {'0,0,0':{name:'Entrance',populationComplete:true,monsters:{inRoom:sheet('Welcome Keeper')}},
  '0,1,0':{name:'North Tomb',monsters:{inRoom:'None',state:'None'},objects:[]},
  '1,0,0':{name:'East Court',monsters:{inRoom:'None',state:'None'},objects:[]},
  '2,0,0':{name:'Boss Vault'}};}
test('private quest monster placement cannot compete with assigned or reserved adjacent populations',()=>{
  const db=database(),before=structuredClone(db);
  assert.deepEqual(Opening.placementKeys(db,plans(),'monster'),['0,0,0']);
  assert.deepEqual(db,before);
  for(const kind of ['object','key'])assert.deepEqual(Opening.placementKeys(db,plans(),kind),['0,0,0','0,1,0','1,0,0']);
  assert.deepEqual(Opening.placementKeys(db,null,'monster'),Object.keys(db));
});
test('a private quest can still reference an already authored neighboring resident',()=>{
  const db=database();Object.assign(db['0,1,0'],{populationComplete:true,monsters:{inRoom:sheet('North Resident')}});
  assert.deepEqual(Opening.placementKeys(db,plans(),'monster'),['0,0,0','0,1,0']);
  db['0,1,0'].monsters.inRoom='None';assert.deepEqual(Opening.placementKeys(db,plans(),'monster'),['0,0,0']);
});
test('production quest placement passes the ownership-filtered coordinates to the actual enum planner',()=>{
  const source=fs.readFileSync(require.resolve('../retort/retortWithUserInput'),'utf8');
  const start=source.indexOf('      const placementCoordinates ='),end=source.indexOf('      await $.user',start);
  let selection;
  vm.runInNewContext(source.slice(start,end),{preparation:true,preparationJob:plans(),
    roomNameDatabasePlain:database(),elType:'monster',partyNpcNames:[],allCoords:Object.keys(database()),currentRoomKey:'0,0,0',
    bossGateReport:{gate:{targetKey:'2,0,0'}},hasMonstersInCurrent:true,preferElsewhere:true,usedPlacements:new Set(),
    require:id=>id==='./openingQuestPreparation'?Opening:{plan:options=>{selection=require('../retort/questPlacement').plan(options);return selection;}}});
  assert.deepEqual(selection.candidates,['0,0,0']);assert.match(selection.instruction,/reuse an existing/);
});
test('two concurrently built neighboring casts survive the private quest object overlay in either completion order',()=>{
  const base=database(),rooms=structuredClone(base);
  rooms['0,1,0'].objects.push({name:'quest token',type:'other',properties:{magic:1}});
  for(const order of [['0,1,0','1,0,0'],['1,0,0','0,1,0']]){
    const current=structuredClone(base);
    for(const key of order)Object.assign(current[key],{populationComplete:true,monsters:{inRoom:sheet(key),state:'Neutral'},
      inhabitants:{actors:{[key]:{name:key,hp:17}}},preparedBuild:{ready:true,stage:'complete'}});
    const merged=Opening.mergedRooms({base,rooms},current);
    for(const key of order){assert.deepEqual(merged[key].monsters,current[key].monsters);
      assert.deepEqual(merged[key].inhabitants,current[key].inhabitants);assert.deepEqual(merged[key].preparedBuild,current[key].preparedBuild);}
    assert.equal(merged['0,1,0'].objects[0].name,'quest token');
  }
});
test('a full-party starter uses an item or key rather than inventing extra starter monsters or paying for a rejected kind',()=>{
  const db=database(),job=plans(),excludeNames=['Welcome Keeper'];
  assert.deepEqual(Opening.placementKeys(db,job,'monster',{excludeNames}),[]);
  const source=fs.readFileSync(require.resolve('../retort/retortWithUserInput'),'utf8');
  const start=source.indexOf('      const elementTypes ='),end=source.indexOf('      await $.user',start);
  const context={preparation:true,preparationJob:job,roomNameDatabasePlain:db,partyNpcNames:excludeNames,require:()=>Opening};
  vm.runInNewContext(source.slice(start,end)+'\nglobalThis.kinds=elementTypes;',context);
  assert.deepEqual([...context.kinds],['object','key']);
  context.preparation=false;vm.runInNewContext('{'+source.slice(start,end)+'\nglobalThis.kinds=elementTypes;}',context);
  assert.deepEqual([...context.kinds],['object','key','monster']);
});
function fixture(){
  const snapshot=require('../sharedState').exportSaveState(),db=database();
  Object.assign(db['0,0,0'],{objects:[{name:'old coin',type:'other'}],exits:{north:{status:'open',targetCoordinates:'0,1,0'}},
    inhabitants:{version:1,geoKey:'0,0,0',actors:{},groups:[]}});
  const origin='Room Name: Entrance\nRoom Description: A fully authored entrance.\nCoordinates: X: 0, Y: 0, Z: 0\nExits: north\nMonsters in Room: None\nMonsters Equipped Properties: None\nMonsters State: None\nInventory: silver spear\nInventory Properties: None\nTurns: 4\nCurrent Quest: None';
  Object.assign(snapshot,{dungeonRunId:'handoff-run',lastCoords:{x:0,y:0,z:0},updatedGameConsole:origin,
    roomNameDatabaseString:JSON.stringify(db),combatCharactersString:JSON.stringify([{name:'Player',type:'pc',hp:40,mazeRoomKey:'0,0,0',mazeX:4,mazeY:4}]),
    roomDungeonDatabase:{'0,0,0':{geoKey:'0,0,0',cells:{'4,4':{tile:'floor'}},layout:{width:8,height:8}}},
    campaignMemory:{...snapshot.campaignMemory,runId:'handoff-run'}});
  const state={getDungeonRunId:()=>snapshot.dungeonRunId,getLastCoords:()=>snapshot.lastCoords,getActiveCityFloor:()=>null,
    getUpdatedGameConsole:()=>snapshot.updatedGameConsole,setUpdatedGameConsole:v=>{snapshot.updatedGameConsole=v;},
    getRoomNameDatabase:()=>snapshot.roomNameDatabaseString,getCombatCharactersString:()=>snapshot.combatCharactersString,
    setCombatCharactersString:v=>{snapshot.combatCharactersString=v;},getRoomPopulation:()=>null,
    getRoomDungeonForSimulation:c=>snapshot.roomDungeonDatabase[[c.x,c.y,c.z].join(',')],
    getRoomDungeon:c=>state.getRoomDungeonForSimulation(c),getGamePaused:()=>false,getCombatMode:()=>false};
  return {state,snapshot,origin,pending:()=>state.setUpdatedGameConsole(origin.replace('X: 0, Y: 0','X: 1, Y: 0'))};
}
test('a rejected entry restores a save-valid origin without erasing completed adjacent rooms or inventory',()=>{
  const f=fixture(),attempt=Recovery.capture(f.state),db=f.state.getRoomNameDatabase();
  f.pending();assert.throws(()=>Shape.validate(f.snapshot),/Server console and saved room disagree/);
  const result=Recovery.recover(f.state,attempt);assert.equal(result.geoKey,'0,0,0');
  assert.match(f.state.getUpdatedGameConsole(),/Inventory: silver spear/);
  assert.match(f.state.getUpdatedGameConsole(),/Turns: 4/);assert.equal(f.state.getRoomNameDatabase(),db);
  assert.doesNotThrow(()=>Shape.validate(f.snapshot));assert.equal(Recovery.recover(f.state,attempt),null);
});
for(const mode of ['new run','published entry','floor'])test('failed-entry recovery never rolls back '+mode,()=>{
  const f=fixture(),attempt=Recovery.capture(f.state);f.pending();
  if(mode==='new run')f.snapshot.dungeonRunId='different-run';
  if(mode==='published entry')f.snapshot.lastCoords={x:1,y:0,z:0};
  if(mode==='floor')f.state.getActiveCityFloor=()=>({hostKey:'0,0,0',buildingId:'inn',floor:1});
  const before=structuredClone(f.snapshot);assert.equal(Recovery.recover(f.state,attempt),null);assert.deepEqual(f.snapshot,before);
});
test('the actual input route returns recovery with the error, without regenerating or replaying the command',async()=>{
  const f=fixture();f.pending();const source=fs.readFileSync(require.resolve('../server'),'utf8');
  const start=source.indexOf("app.post('/processInput7',"),end=source.indexOf('// New endpoint:',start);
  const tasks=new Map();let handler,calls=0,code,receipt;
  vm.runInNewContext(source.slice(start,end),{app:{post:(url,fn)=>{handler=fn}},sharedState:f.state,tasks,
    inputTaskInFlight:false,npcAutonomyTickInFlight:false,Date,console:{log(){},info(){},warn(){},error(){}},
    require:id=>{assert.equal(id,'./retort/roomTravelRecovery');return Recovery;},broadcast(){},
    actionDice:{end(){}},retortWithUserInput:async()=>{calls++;throw Object.assign(Error('Concurrent room change: 0,1,0.monsters.inRoom'),{code:'ROOM_BUILD_CONFLICT'});}});
  await handler({body:{userInput:'east'}},{status:n=>{code=n;return{json:v=>{receipt=v}}}});
  const result=tasks.get(receipt.taskId);assert.equal(code,202);assert.equal(calls,1);assert.equal(result.status,'error');
  assert.match(result.result,/Concurrent room change/);assert.equal(result.recovery.geoKey,'0,0,0');
  assert.doesNotThrow(()=>Shape.validate(f.snapshot));
});
test('browser recovery applies the original-room checkpoint and clears the abandoned arrival',()=>{
  const source=fs.readFileSync(require.resolve('../assets/game'),'utf8'),start=source.indexOf('window.applyFailedRoomEntry ='),end=source.indexOf('const realtimeCombatResultsSeen',start);
  let applied=0,rendered=0,cancelled=0;
  const root={_world1Arrival:{direction:'east'},_world1FootExit:{direction:'east'},
    applyPreparedRoomEntry:e=>{applied++;return e?.runId==='run';},RoomEntry:{cancel:()=>{cancelled++;}}};
  vm.runInNewContext(source.slice(start,end),{window:root,renderDungeonView:()=>{rendered++;}});
  assert.equal(root.applyFailedRoomEntry({runId:'old'}),false);assert.equal(rendered,0);
  assert.equal(root.applyFailedRoomEntry({runId:'run'}),true);assert.equal(rendered,1);assert.equal(cancelled,1);
  assert.equal(root._world1Arrival,null);assert.equal(root._world1FootExit,null);assert.equal(applied,2);
});
test('reusing authored quest residents reads exact sheets without rewriting a neighboring cast',()=>{
  const source=fs.readFileSync(require.resolve('../retort/retortWithUserInput'),'utf8');
  const start=source.indexOf('    function getFirstMonsterNameForPlacement('),end=source.indexOf('  // ------------------- seeding helper',start);
  assert.ok(start>0&&end>start);
  const db=database();db['0,1,0'].monsters={inRoom:sheet('North Resident'),consoleBlock:sheet('North Resident'),state:'Neutral'};
  const before=structuredClone(db),context={Inhabitants:require('../assets/dungeonInhabitants'),sharedState:{getRoomPopulation:()=>null}};
  vm.runInNewContext(source.slice(start,end)+'\nglobalThis.pick=getFirstMonsterNameForPlacement;',context);
  assert.equal(context.pick(db,'0,1,0',null,new Set()),'North Resident');assert.deepEqual(db,before);
  assert.match(source,/if \(!preparation\) normalizeMonstersDbEntry\(roomNameDatabasePlain, placement, npcExcludeSet\)/);
});
