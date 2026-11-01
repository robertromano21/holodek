'use strict';
for(const flag of ['CITY_SITES','CITY_COMPLETE','ARCHITECTURE_EXPANSION','GENRE_EXPANSION'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),State=require('../sharedState'),F=require('../retort/hostLocalFloors');
const C=require('../retort/cityCirculation'),Plans=require('../assets/cityBuildingPlans'),I=require('../assets/dungeonInhabitants');
const Geometry=require('../assets/dungeonGeometryStamp'),vm=require('node:vm'),fs=require('node:fs');
const clientSource=fs.readFileSync(require.resolve('../assets/game'),'utf8');
const clientStamp=vm.runInNewContext('('+clientSource.slice(clientSource.indexOf('function computeDungeonGeometryStamp('),
  clientSource.indexOf('function ensureDungeonGeometryStamp('))+')',{window:{DungeonGeometryStamp:Geometry}});
const coords={x:0,y:0,z:0},key='0,0,0';
function fixture({authored=false,genre='cyberpunk'}={}){
  State.beginDungeonRun();const base=State.exportSaveState(),b={id:'parcel:host-test',name:'Test Tower',type:'home',left:10,top:10,width:32,depth:36,storeys:8,authored,
    rooms:[{x:11,y:11,width:30,depth:34,use:'public-lobby'}]};
  const d={geoKey:key,_geometryStamp:'street-v1',layout:{width:80,height:80},start:{x:40,y:70},cells:{},tiles:{},sceneStructures:[],
    cityBlocks:{buildings:[b],streaming:{genre}},cityArchitecture:{version:1,hostKey:key,genre,buildings:{}}};
  for(let y=0;y<80;y++)for(let x=0;x<80;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:3,...(x>=10&&x<42&&y>=10&&y<46?{cityParcel:b.id}:{})};
  Plans.bind(d.cityArchitecture,b,{authored});C.install(d);
  const population=I.createPopulation(key,[{name:'Street Keeper',hp:7,maxHp:7,allegiance:'Neutral',encounterId:'street'}]);
  const room={name:'Saved Street',description:'An inhabited street with a tower.',objects:[{name:'Street coin'}],inhabitants:population,
    monsters:{inRoom:'None',equippedProperties:'None'},setting:{kind:'homebrew',name:'World stays here'},cityArchitecture:d.cityArchitecture};
  Object.assign(base,{activeCityFloor:null,roomNameDatabaseString:JSON.stringify({[key]:room}),roomDungeonDatabase:{[key]:d},roomPopulations:{[key]:population},
    lastCoords:coords,updatedGameConsole:'Room Name: Saved Street\nRoom Description: An inhabited street.\nCoordinates: X: 0, Y: 0, Z: 0\nMonsters in Room: None\nMonsters Equipped Properties: None\nMonsters State: None\nObjects in Room: Street coin\nObjects in Room Properties: None\nInventory: Quest token\nTurns: 6',
    combatCharactersString:JSON.stringify([{name:'Hero',type:'pc',hp:12,mazeX:24,mazeY:24,mazeRoomKey:key},{name:'Ally',type:'npc',hp:8,inventory:['keepsake'],mazeX:25,mazeY:24,mazeRoomKey:key}]),
    gamePaused:false,characterGenerationInProgress:false,currentTasks:[],campaignMemory:{...base.campaignMemory,runId:base.dungeonRunId}});
  State.importSaveState(base,{graphicsReady:[key]});return{b,d,population};
}
function request(control,extra={}){const d=State.getRoomDungeonForSimulation(State.getLastCoords());return{runId:State.getDungeonRunId(),geoKey:F.keyOf(State.getLastCoords()),
  floorToken:F.token(State),geometryStamp:d._geometryStamp,controlId:control.id,player:{...control.point},...extra};}
const control=(mode,direction)=>State.getRoomDungeonForSimulation(State.getLastCoords()).cityCirculation.controls.find(c=>c.mode===mode&&(!direction||c.direction===direction));
test('street -> floors 1 and 2 -> street keeps coordinates, stores nested floors, and creates no world rooms',async()=>{
  fixture();const street=structuredClone(State.getRoomDungeonForSimulation(coords)),keys=Object.keys(JSON.parse(State.getRoomNameDatabase()));
  const first=await C.travel(State,request(control('stairs','up')));assert.equal(first.hostLocal,true);assert.equal(first.geoKey,key);assert.equal(first.floorContext.floor,1);
  assert.deepEqual(State.getLastCoords(),coords);assert.equal(State.getRoomPopulation(key).starting,false);
  assert.equal(JSON.parse(State.getRoomNameDatabase())[key].setting.name,'World stays here');
  const up=control('stairs','up');assert.ok(up);await C.travel(State,request(up));assert.equal(State.getActiveCityFloor().floor,2);
  await C.travel(State,request(control('stairs','down')));assert.equal(State.getActiveCityFloor().floor,1);
  await C.travel(State,request(control('stairs','down')));assert.equal(State.getActiveCityFloor(),null);
  assert.deepEqual(Object.keys(JSON.parse(State.getRoomNameDatabase())),keys);const restored=State.getRoomDungeonForSimulation(coords);
  assert.deepEqual(restored.cells,street.cells);assert.deepEqual(restored.sceneStructures,street.sceneStructures);assert.equal(restored._geometryStamp,street._geometryStamp);
});
test('occupants, inventory, doors and loot are isolated and returning never reconstructs a floor',async()=>{
  fixture();await C.travel(State,request(control('lift'),{floor:3}));
  let db=JSON.parse(State.getRoomNameDatabase());db[key].objects=[{name:'Saved upstairs clue'}];State.setRoomNameDatabase(JSON.stringify(db));
  const p=State.getRoomPopulation(key);p.actors.Defeated={name:'Defeated',status:'present',hp:0,maxHp:5,state:'Unconscious',inventory:['Letter'],mercy:{bandaged:true}};State.setRoomPopulation(key,p);
  const d=State.getRoomDungeonForSimulation(coords);d.cells['2,2'].door={isOpen:true};Geometry.stamp(d,key);State.setRoomDungeon(coords,d);
  const stamp=d._geometryStamp;await C.travel(State,request(control('lift'),{floor:4}));assert.equal(State.getRoomPopulation(key).actors.Defeated,undefined);
  assert.notDeepEqual(JSON.parse(State.getRoomNameDatabase())[key].objects,[{name:'Saved upstairs clue'}]);
  await C.travel(State,request(control('lift'),{floor:3}),{build:()=>{throw Error('Must reuse saved geometry');}});
  assert.equal(State.getRoomDungeonForSimulation(coords).cells['2,2'].door.isOpen,true);assert.equal(State.getRoomDungeonForSimulation(coords)._geometryStamp,stamp);
  assert.deepEqual(State.getRoomPopulation(key).actors.Defeated.inventory,['Letter']);assert.deepEqual(JSON.parse(State.getRoomNameDatabase())[key].objects,[{name:'Saved upstairs clue'}]);
  assert.deepEqual(JSON.parse(State.getCombatCharactersString()).find(a=>a.name==='Ally').inventory,['keepsake']);
});
test('stale floor token, paused, distant and failed geometry requests leave all state unchanged',async()=>{
  fixture();const lift=control('lift'),r=request(lift,{floor:2}),before=JSON.stringify(State.exportSaveState());
  for(const invalid of [{floorToken:'old'},{player:{x:1,y:1}},{floor:999},{geometryStamp:'old'}])await assert.rejects(C.travel(State,{...r,...invalid}));
  await assert.rejects(C.travel(State,r,{build:()=>{throw Error('construction failed');}}),/construction failed/);assert.equal(JSON.stringify(State.exportSaveState()),before);
  await C.travel(State,r);await assert.rejects(C.travel(State,r),/floor or adventure changed/);
});
test('save/load selects the active floor, not the host street, while old checkpoints remain valid',async()=>{
  fixture();const original=State.exportSaveState();delete original.activeCityFloor;delete original.cityFloorEpoch;require('../saveGameState').validate(original);
  await C.travel(State,request(control('lift'),{floor:6}));const saved=State.exportSaveState();require('../saveGameState').validate(saved);
  assert.equal(F.selectDungeon(saved).cityFloorContext.floor,6);assert.equal(saved.roomDungeonDatabase[key].cityFloorContext,undefined);
  State.importSaveState(saved,{graphicsReady:[key]});assert.equal(State.getActiveCityFloor().floor,6);assert.equal(State.getRoomDungeon(coords).cityFloorContext.floor,6);
  const broken=structuredClone(saved);broken.activeCityFloor.buildingId='missing';assert.throws(()=>require('../saveGameState').validate(broken),/host-local floor/);
});
test('world coordinate quest gates distinguish street and floor without invalidating historical task receipts',async()=>{
  fixture();const Q=require('../retort/questProgress'),task={description:'Visit the street',hardRequirements:[{check:'at_coords',value:key}],actionRequirements:[]};
  const binding=Q.taskBinding(task);State.setCurrentTasks([task]);await C.travel(State,request(control('lift'),{floor:2}));
  const current=State.getCurrentTasks()[0];assert.equal(Q.taskBinding(current),binding);
  assert.equal(Q.evaluateTaskRequirements(current,{roomKey:key,database:JSON.parse(State.getRoomNameDatabase()),consoleText:'Inventory: Empty'}).progress.eligible,false);
});
module.exports={fixture,request,control};

test('all genres keep usable floor stairs, native furnishings, lights and the planned envelope',async()=>{
  for(const genre of Object.keys(require('../assets/cityEstablishments').NAMES)){
    const f=fixture({genre});await C.travel(State,request(control('stairs','up')));
    const d=State.getRoomDungeonForSimulation(coords);assert.equal(d.cityVenueBounds.width,f.b.width,genre);
    assert.ok(d.cityCirculation.controls.some(c=>c.direction==='down'),genre);assert.ok(d.cityVenue.furnishings>0,genre);
    assert.ok(d.sceneStructures.some(s=>s.role==='city-venue-light'),genre);
    assert.deepEqual(State.getLastCoords(),coords);
  }
});
test('a named ground floor has an actual return control, uses its helper once and never imports helper world edits',async()=>{
  const f=fixture({authored:true});let calls=0;
  const options={door:true,author:async(_state,_snapshot,db,ref)=>{
    calls++;const floor=F.bundle(db,ref),room=structuredClone(floor.room);room.populationComplete=true;
    assert.equal(floor.room.populationComplete,false,'named floors must request inhabitants on their first visit');
    return{rooms:{[key]:room,'99,99,99':{name:'A forbidden worker world edit'}},dungeon:F.geometry(db,ref)};
  }};
  const point=require('../assets/cityParcels').entrance(f.b),r={...request(control('stairs','up')),buildingId:f.b.id,player:point};
  const result=await require('../retort/cityFloorTravel').transition(State,r,options);
  assert.equal(result.floorContext.floor,0);assert.equal(calls,1);assert.ok(control('street'));
  assert.equal(JSON.parse(State.getRoomNameDatabase())['99,99,99'],undefined);
  await C.travel(State,request(control('street')));assert.equal(State.getActiveCityFloor(),null);
  await require('../retort/cityFloorTravel').transition(State,{...r,floorToken:F.token(State)},options);assert.equal(calls,1);
});
test('a pause or adventure reset during helper authorship cannot install a prepared floor',async()=>{
  const f=fixture({authored:true});const before=State.exportSaveState(),point=require('../assets/cityParcels').entrance(f.b);
  await assert.rejects(require('../retort/cityFloorTravel').transition(State,{...request(control('stairs','up')),buildingId:f.b.id,player:point},{door:true,
    author:async(_state,_snapshot,db,ref)=>{const artifact={rooms:{[key]:F.bundle(db,ref).room},dungeon:F.geometry(db,ref)};State.setGamePaused(true);return artifact;}}),/adventure changed/);
  assert.equal(State.getActiveCityFloor(),null);assert.equal(State.getRoomNameDatabase(),before.roomNameDatabaseString);State.setGamePaused(false);
});
test('public room payloads contain no archived cell grids; later state sync cannot erase private floor geometry',async()=>{
  fixture();await C.travel(State,request(control('lift'),{floor:5}));
  const view=JSON.parse(State.getRoomNameDatabase()),ref=State.getActiveCityFloor();assert.equal(F.bundle(view,ref).dungeon,undefined);
  const before=JSON.stringify(State.getRoomDungeonForSimulation(coords).cells);view[key].objects.push({name:'A new clue'});State.setRoomNameDatabase(JSON.stringify(view));
  assert.equal(JSON.stringify(State.getRoomDungeonForSimulation(coords).cells),before);
  assert.ok(F.selectDungeon(State.exportSaveState()).cells);assert.ok(F.selectDungeon(State.exportSaveState()).cityCirculation.controls.length);
});
test('population and geometry identities survive ordinary floor visits and resident saves',async()=>{
  fixture();await C.travel(State,request(control('lift'),{floor:5}));
  const p=State.getRoomPopulation(key),d=State.getRoomDungeonForSimulation(coords);p.randomEncounters={attempts:1};State.setRoomPopulation(key,p);
  assert.equal(State.getRoomPopulation(key),p);assert.equal(State.getRoomDungeonForSimulation(coords),d);
  const db=JSON.parse(State.getRoomNameDatabase());db[key].objects.push({name:'Clue'});State.setRoomNameDatabase(JSON.stringify(db));
  assert.equal(State.getRoomPopulation(key),p);assert.equal(State.getRoomDungeonForSimulation(coords),d);
});
test('floor-bound quests qualify on the correct floor and never from another floor at the same address',async()=>{
  fixture();await C.travel(State,request(control('lift'),{floor:2}));
  State.setCurrentTasks([{description:'Find this floor',hardRequirements:[{check:'at_coords',value:key}],actionRequirements:[]}]);
  const task=State.getCurrentTasks()[0],Q=require('../retort/questProgress'),read=()=>Q.evaluateTaskRequirements(task,{roomKey:key,consoleText:'Inventory: Empty',database:JSON.parse(State.getRoomNameDatabase())}).progress.eligible;
  assert.equal(read(),true);await C.travel(State,request(control('lift'),{floor:3}));assert.equal(read(),false);
  await C.travel(State,request(control('lift'),{floor:2}));assert.equal(read(),true);
});
test('legacy built floors are adopted at their host, with old addresses retained as references rather than travel destinations',async()=>{
  const f=fixture(),snapshot=State.exportSaveState(),db=JSON.parse(snapshot.roomNameDatabaseString),ref={hostKey:key,buildingId:f.b.id,floor:3};
  db[key].cityFloors={version:1,buildings:{[ref.buildingId]:{floors:{}}}};
  const room=F.floorRoom(db,ref);db['873,473,103']={...room,description:'Saved authored floor with an old private address.'};
  db[key].cityFloors.buildings[ref.buildingId].floors[3]={room};
  const d=F.geometry(db,ref);d.geoKey='873,473,103';delete d.cityFloorContext;d.cells['2,2'].door={isOpen:true};
  delete db[key].cityFloors.buildings[ref.buildingId].floors[3];
  snapshot.roomNameDatabaseString=JSON.stringify(db);snapshot.roomDungeonDatabase['873,473,103']=d;State.importSaveState(snapshot,{graphicsReady:[key,'873,473,103']});
  const result=await C.travel(State,request(control('lift'),{floor:3}),{build:()=>{throw Error('Never rebuild a saved floor');}});
  assert.equal(result.geoKey,key);assert.equal(State.getRoomDungeonForSimulation(coords).cells['2,2'].door.isOpen,true);
  assert.equal(F.matches(JSON.parse(State.getRoomNameDatabase()),'873,473,103',key),true);
  assert.ok(JSON.parse(State.getRoomNameDatabase())['873,473,103']);
});

test('compact floor envelopes reserve reachable stairs before furnishings, including shaped footprints',()=>{
  const E=require('../assets/cityEstablishments'),shapes=require('../assets/cityBuildingFootprints').KINDS;
  for(const type of E.TYPES.filter(t=>!E.profile(t).openAir))for(const kind of shapes){
    const ref={hostKey:key,buildingId:'small:'+type,floor:1},plan=Plans.create({hostKey:key,id:ref.buildingId,genre:'fantasy',type,
      width:12,depth:12,storeys:3,footprint:{version:1,kind}});
    const db={[key]:{cityArchitecture:{buildings:{[ref.buildingId]:{plan}}},cityFloors:{buildings:{[ref.buildingId]:{floors:{}}}}}};
    db[key].cityFloors.buildings[ref.buildingId].floors[1]={room:F.floorRoom(db,ref)};
    const d=F.geometry(db,ref),down=d.cityCirculation?.controls.find(c=>c.direction==='down');
    assert.ok(down,`${type}/${kind} needs a route down`);assert.ok(I.pointWalkable(d,down.arrival.x,down.arrival.y),`${type}/${kind} needs a reachable landing`);
  }
});

test('browser-stamped requests can go up and back down repeatedly without disabling stale geometry protection',async()=>{
  fixture();Geometry.stamp(State.getRoomDungeonForSimulation(coords),key);
  for(let round=0;round<3;round++){
    for(const direction of ['up','up','down','down']){
      const landing=control('stairs',direction),d=State.getRoomDungeonForSimulation(coords),stamp=clientStamp(d,key);
      const result=await C.travel(State,request(landing,{geometryStamp:stamp}));
      assert.equal(result.dungeon._geometryStamp,clientStamp(result.dungeon,key));
      assert.deepEqual(State.getLastCoords(),coords);
    }
    assert.equal(State.getActiveCityFloor(),null);
  }
  await assert.rejects(C.travel(State,request(control('stairs','up'),{geometryStamp:'1024:obsolete'})),/saved floor changed/);
});

test('loading a legacy floor fingerprint repairs only version metadata and permits a browser-stamped descent',async()=>{
  fixture();Geometry.stamp(State.getRoomDungeonForSimulation(coords),key);
  await C.travel(State,request(control('stairs','up')));const snapshot=State.exportSaveState(),ref=snapshot.activeCityFloor;
  const db=JSON.parse(snapshot.roomNameDatabaseString),d=F.bundle(db,ref).dungeon;
  d._geometryStamp='floor:2677048495';d._meta={...d._meta,geometryStamp:d._geometryStamp};
  snapshot.roomNameDatabaseString=JSON.stringify(db);
  const unchanged=JSON.stringify([d.cells,d.sceneStructures,snapshot.combatCharactersString,snapshot.currentTasks]);
  State.importSaveState(snapshot,{graphicsReady:[key]});const restored=State.getRoomDungeonForSimulation(coords);
  assert.equal(restored._geometryStamp,clientStamp(restored,key));assert.deepEqual(State.getActiveCityFloor(),ref);
  assert.equal(JSON.stringify([restored.cells,restored.sceneStructures,State.getCombatCharactersString(),State.getCurrentTasks()]),unchanged);
  const result=await C.travel(State,request(control('stairs','down'),{geometryStamp:clientStamp(restored,key)}));
  assert.equal(result.floorContext,null);assert.deepEqual(State.getLastCoords(),coords);
});

test('adding a missing return control to an authored helper floor re-stamps its final delivered geometry',async()=>{
  const f=fixture({authored:true});Geometry.stamp(State.getRoomDungeonForSimulation(coords),key);
  const result=await require('../retort/cityFloorTravel').transition(State,{...request(control('stairs','up')),buildingId:f.b.id,
    player:require('../assets/cityParcels').entrance(f.b)},{door:true,author:async(_state,_snapshot,db,ref)=>{
      const d=F.geometry(db,ref);delete d.cityCirculation;delete d.sceneSpec.city.vertical;
      d.sceneSpec.city.vertical=F.bundle(db,ref).room.cityRoom.vertical;
      return{rooms:{[key]:F.bundle(db,ref).room},dungeon:d};
    }});
  assert.equal(result.dungeon._geometryStamp,clientStamp(result.dungeon,key));assert.ok(control('street'));
});

test('crowd-only motion preserves geometry object identities and still persists in floor checkpoints',async()=>{
  fixture();const street=State.getRoomDungeonForSimulation(coords),cells=street.cells;
  State.setRoomCrowd(coords,{version:1,revision:1,actors:{}});
  assert.equal(State.getRoomDungeonForSimulation(coords),street);assert.equal(street.cells,cells);
  await C.travel(State,request(control('stairs','up')));const d=State.getRoomDungeonForSimulation(coords),floorCells=d.cells,stamp=d._geometryStamp;
  State.setRoomCrowd(coords,{version:1,revision:2,actors:{walker:{id:'walker',position:{x:3,y:4},status:'ambient'}}});
  assert.equal(State.getRoomDungeonForSimulation(coords),d);assert.equal(d.cells,floorCells);assert.equal(d._geometryStamp,stamp);
  assert.equal(F.selectDungeon(State.exportSaveState()).cityCrowd.actors.walker.position.x,3);
});
