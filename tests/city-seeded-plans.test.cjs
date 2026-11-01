'use strict';
process.env.HOLODEK_ARCHITECTURE_EXPANSION='1';
process.env.HOLODEK_CITY_SITES='1';
process.env.HOLODEK_CITY_COMPLETE='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Plans=require('../assets/cityBuildingPlans'),A=require('../retort/cityArchitecture'),E=require('../assets/cityEstablishments');
const MapLevel=require('../assets/cityLevelMap'),Indoor=require('../retort/indoorBlueprint');
const options={seed:'city-seed',hostKey:'0,0,0',id:'block:3,2',name:'Authored Workshop',genre:'cyberpunk',type:'workshop',width:28,depth:30,storeys:80};
const clone=v=>JSON.parse(JSON.stringify(v));
test('building recipes and floor geometry are deterministic, versioned, host-owned and contain no generated people',()=>{
  const plan=Plans.create(options),again=Plans.create(options);
  assert.deepEqual(plan,again);assert.notEqual(plan.seed,Plans.create({...options,seed:'new-game'}).seed);
  assert.equal(plan.hostKey,'0,0,0');assert.equal(plan.storeys,80);
  for(const n of [0,1,27,65,79]){
    const floor=Plans.floor(plan,n);assert.deepEqual(floor,Plans.floor(clone(plan),n));
    assert.equal(floor.hostKey,plan.hostKey);assert.equal(floor.buildingId,plan.id);
    assert.equal(floor.connections.up,n===79?undefined:n+1);assert.equal(floor.connections.down,n===0?undefined:n-1);
    for(const r of floor.rooms)assert.ok(r.x>=1&&r.y>=1&&r.width>=3&&r.depth>=3&&r.x+r.width<plan.footprint.width&&r.y+r.depth<plan.footprint.depth);
  }
  assert.throws(()=>Plans.floor(plan,-1));assert.throws(()=>Plans.floor(plan,80));
  assert.doesNotMatch(JSON.stringify(plan),/actors|inventory|targetCoordinates|Tartarus|Mortacia/);
});
test('750 procedural buildings have compact plans upfront, not 750 eager dungeons or LLM requests',()=>{
  const a=Plans.district({seed:'stress',cityId:'city',hostKey:'1,2,3',genre:'modern',scale:'metropolis',floors:100});
  assert.equal(Object.keys(a.buildings).length,750);assert.ok(Buffer.byteLength(JSON.stringify(a))<800000);
  for(const r of Object.values(a.buildings)){assert.equal(r.plan.hostKey,'1,2,3');assert.equal(r.status,'planned');assert.deepEqual(r.floors,{});assert.equal(r.dungeon,undefined);}
  assert.deepEqual(a,Plans.district({seed:'stress',cityId:'city',hostKey:'1,2,3',genre:'modern',scale:'metropolis',floors:100}));
});
test('all genres and approved venue types yield connected fitted floors with native furnishings and lights',()=>{
  const Nav=require('../retort/sceneArchitecture');
  for(const genre of Object.keys(E.NAMES))for(const type of ['home','shop','temple','inn','workshop','civic']){
    const p=Plans.create({...options,genre,type,width:E.profile(type).width,depth:E.profile(type).depth,storeys:3});
    for(const n of [0,1]){
      const plan=Plans.floor(p,n),venue={version:1,id:p.id,type,...E.profile(type)},d={geoKey:'test',layout:{width:96,height:96},start:{x:48,y:70},cells:{},tiles:{},sceneStructures:[],
        sceneSpec:{city:{genre,venue,architecture:{hostKey:p.hostKey,buildingId:p.id,floor:n,plan}}}};
      Indoor.build(d,{},{});const reachable=Nav.reachable(Nav.makeNavigation(d),d.start);
      for(const [k,c]of Object.entries(d.cells))if(c.tile==='floor')assert.ok(reachable.seen[Number(k.split(',')[1])*96+Number(k.split(',')[0])],`${genre}:${type}:${n}:${k}`);
      assert.equal(d.cityVenueBounds.width,p.footprint.width);assert.equal(d.cityVenueBounds.depth,p.footprint.depth);
      assert.ok(d.cityVenue.furnishings>0);assert.ok(d.sceneStructures.some(s=>s.role==='city-venue-light'));
    }
  }
});
test('fitted street dimensions and actual rooms are retained in the first two planned storeys',()=>{
  const a=Plans.district({seed:'fit',cityId:'city',hostKey:'0,0,0',genre:'cyberpunk',scale:'town'});
  const b={...options,id:'fitted',left:20,top:30,base:4,clearance:3,entrySides:['north'],rooms:[{x:30,y:31,width:6,depth:28,use:'public-lobby'}]};
  const r=Plans.bind(a,b);assert.equal(r.status,'built');assert.equal(r.plan.lobby.clearance,3);
  assert.deepEqual(r.floors[0].plan.rooms[0],{x:10,y:1,width:6,depth:28,use:'public-lobby',role:'entrance'});
  assert.deepEqual(Object.keys(r.floors),['0','1']);assert.equal(b.planId,'fitted');
  const saved=JSON.stringify(r);Plans.bind(a,b);assert.equal(JSON.stringify(r),saved);
});
test('named locations store plans under their street and legacy floors remain aliases without new world keys',()=>{
  const db={'0,0,0':{environmentIntent:{citySite:{id:'authored-city',design:{}}}},'1,0,0':{name:'Street'},
    '2,0,0':{name:'Named Library',objects:[{name:'Clue'}],cityRoom:{kind:'building',anchorKey:'0,0,0',streetKey:'1,0,0',genre:'fantasy',establishmentType:'library',venue:{width:32,depth:36}}}};
  const keys=Object.keys(db),objects=clone(db['2,0,0'].objects);assert.equal(A.installNamed(db,'0,0,0'),1);
  assert.deepEqual(Object.keys(db),keys);assert.deepEqual(db['2,0,0'].objects,objects);
  const floor=A.forRoom(db['2,0,0'],db);assert.equal(floor.hostKey,'1,0,0');assert.equal(floor.authored,true);assert.equal(floor.plan.type,'library');
  const saved=JSON.stringify(db);assert.equal(A.installNamed(db,'0,0,0'),0);assert.equal(JSON.stringify(db),saved);
});
test('older city records without establishment types retain their story and receive valid physical plans',()=>{
  const db={'0,0,0':{environmentIntent:{citySite:{id:'legacy',design:{}}}},street:{name:'Old Street'},
    building:{name:'Old Hall',description:'Saved original history.',cityRoom:{kind:'building',anchorKey:'0,0,0',streetKey:'street',genre:'fantasy',district:'guild'}}};
  assert.equal(A.installNamed(db,'0,0,0'),1);assert.equal(db.building.description,'Saved original history.');
  assert.equal(db.building.cityRoom.establishmentType,undefined);assert.ok(A.forRoom(db.building,db).plan.rooms.length>0);
});
test('host floor layers restore built geometry without reconstructing, moving or repopulating it',()=>{
  const ref={hostKey:'0,0,0',buildingId:'tower',floor:7},db={'0,0,0':{},'9,9,9':{cityRoom:{architecture:ref}}};
  const dungeons={'0,0,0':{cells:{'2,3':{tile:'floor'}}}},floor={geoKey:'9,9,9',sceneSpec:{city:{architecture:ref}},cells:{'4,5':{tile:'door',door:{isOpen:true}}},
    cityCrowd:{actors:{Saved:{status:'promoted'}}},sceneObjects:[{name:'Saved clue',x:4,y:5}],_geometryStamp:'stable'};
  assert.equal(A.cacheLayer(db,dungeons,'9,9,9',floor),true);
  const saved=clone(dungeons);assert.deepEqual(A.cachedLayer(db,saved,'9,9,9'),floor);
  assert.equal(A.cachedLayer(db,saved,'9,9,8'),null);assert.equal(saved['9,9,9'],undefined);
  assert.equal(saved['0,0,0'].cityInteriorLayers.buildings.tower.floors[7].legacyKey,'9,9,9');
});
test('real checkpoints preserve host floor geometry, refill a missing alias cache, and resist a stale host snapshot',()=>{
  const state=require('../sharedState'),Shape=require('../saveGameState'),ref={hostKey:'0,0,0',buildingId:'saved-tower',floor:2};
  const db={'0,0,0':{name:'Street'},'9,9,9':{name:'Office',cityRoom:{architecture:ref},inhabitants:{actors:{Saved:{status:'defeated',inventory:['keepsake']}}}}};
  state.setRoomNameDatabase(JSON.stringify(db));state.setCombatCharactersString('[]');state.setUpdatedGameConsole('Coordinates: X: 0, Y: 0, Z: 0');
  const host={geoKey:'0,0,0',layout:{width:16,height:16},cells:{'1,1':{tile:'floor'}}};
  state.setRoomDungeon({x:0,y:0,z:0},host);
  const floor={geoKey:'9,9,9',layout:{width:16,height:16},_geometryStamp:'saved-geometry',cells:{'5,5':{tile:'door',door:{isOpen:true}}},sceneSpec:{city:{architecture:ref}}};
  state.setRoomDungeon({x:9,y:9,z:9},floor);state.setRoomDungeon({x:0,y:0,z:0},host);
  const checkpoint=state.exportSaveState();delete checkpoint.roomDungeonDatabase['9,9,9'];Shape.validate(checkpoint);
  state.importSaveState(checkpoint,{graphicsReady:['0,0,0']});
  assert.deepEqual(state.getRoomDungeonForSimulation({x:9,y:9,z:9}),floor);
  assert.deepEqual(JSON.parse(state.getRoomNameDatabase())['9,9,9'].inhabitants,db['9,9,9'].inhabitants);
  assert.equal(state.getRoomDungeonForSimulation({x:0,y:0,z:0}).cityInteriorLayers.buildings['saved-tower'].floors[2].dungeon._geometryStamp,'saved-geometry');
});
test('streamed plans cannot erase saved floor aliases or later room content',()=>{
  const p=Plans.create(options),db={'0,0,0':{cityArchitecture:{version:1,buildings:{[p.id]:{plan:p,status:'built',floors:{0:{plan:Plans.floor(p,0),legacyKey:'8,8,8'},7:{legacyKey:'9,9,9'}}}}}}};
  const d={cityArchitecture:{version:1,buildings:{[p.id]:{plan:p,status:'built',floors:{0:{plan:Plans.floor(p,0)}}}}}};
  A.persist(db,'0,0,0',d);assert.equal(db['0,0,0'].cityArchitecture.buildings[p.id].floors[0].legacyKey,'8,8,8');assert.equal(db['0,0,0'].cityArchitecture.buildings[p.id].floors[7].legacyKey,'9,9,9');
  const merged=JSON.parse(require('../retort/economy').preserve(JSON.stringify(db),JSON.stringify({'0,0,0':{cityArchitecture:{spoof:true}}})));
  assert.deepEqual(merged['0,0,0'].cityArchitecture,db['0,0,0'].cityArchitecture);
});
test('procedural saved plans bypass blueprint model calls but set buildings retain their helper authoring path',async()=>{
  const source=fs.readFileSync(require.resolve('../retort/retortWithUserInput'),'utf8'),start=source.indexOf('async function generateDungeonBlueprint('),end=source.indexOf('\nasync function ',start+20);
  const p=Plans.create(options),planned={plan:Plans.floor(p,0),authored:false};let calls=0;
  const context={DungeonGeneration:{seedBlueprint:(b,g)=>({...b,generation:g})},BlueprintDesign:{enrich:b=>b},StoryPrompts:{isHolodek1:()=>true},
    require:id=>id==='./holodekBlueprint'?{generate:async()=>{calls++;return{};}}:{catalog:()=>({strict:true})}};
  vm.runInNewContext(source.slice(start,end)+';this.build=generateDungeonBlueprint;',context);
  const args=[{},'',null,{indoor:true},96,[],{seed:'saved'}, {city:{architecture:planned}}];
  const result=await context.build(...args);assert.equal(calls,0);assert.equal(result.designContract.source,'saved-city-building-plan');
  planned.authored=true;await context.build(...args);assert.equal(calls,1);
});
test('procedural floors do not dispatch a full website construction job',()=>{
  const plan=Plans.create(options),db={'0,0,0':{cityArchitecture:{buildings:{[plan.id]:{plan,floors:{}}}}},
    '9,9,9':{name:'Procedural Office',description:'An existing seeded procedural office floor.',populationComplete:true,
      cityRoom:{architecture:{hostKey:'0,0,0',buildingId:plan.id,floor:2}}}};
  let dispatched=0;
  const website={view:()=>({enabled:true,remoteBuild:true}),spawnBuild(){dispatched++;throw Error('Must not dispatch');}};
  const state={getDungeonRunId:()=> 'run',getRoomNameDatabase:()=>JSON.stringify(db)};
  assert.equal(require('../retort/websiteRoomPipeline').begin(state,'Coordinates: X: 9, Y: 9, Z: 9',{website}),null);
  assert.equal(dispatched,0);
});
test('Level map detects the real active building and follows a floor change without altering world geometry',()=>{
  const d={geoKey:'221,246,0',layout:{width:96,height:96},sceneSpec:{city:{architecture:{hostKey:'0,0,0',buildingId:'tower',floor:2,name:'Tower'}}},cityVenueBounds:{left:30,top:20,width:28,depth:30}};
  const before=JSON.stringify(d),a=MapLevel.context(d,{x:40,y:40});assert.equal(a.floor,2);assert.equal(a.hostKey,'0,0,0');
  const projection=MapLevel.projection(a,512,{x:40,y:40});assert.equal(projection.extent,34);
  assert.ok(MapLevel.contains(a,{x:40,y:40}));assert.equal(MapLevel.contains(a,{x:10,y:10}),false);assert.equal(JSON.stringify(d),before);
  d.sceneSpec.city.architecture.floor=3;const b=MapLevel.context(d,{x:40,y:40});assert.equal(b.floor,3);assert.notEqual(a.id,b.id);
});
test('street Level view recognizes only a constructed lobby at the player, never a distant or unbuilt plan',()=>{
  const d={geoKey:'0,0,0',layout:{width:96,height:96},cells:{'23,24':{tile:'floor',cityParcel:'built'}},cityBlocks:{buildings:[{id:'built',left:20,top:20,width:20,depth:20,name:'Shop'}]}};
  assert.equal(MapLevel.context(d,{x:23.5,y:24.5}).floor,0);assert.equal(MapLevel.context(d,{x:22,y:22}),null);
  assert.equal(MapLevel.context(d,{x:4,y:4}),null);
});
test('floors sharing a host coordinate have separate map discovery masks and returning restores each mask',async()=>{
  const Cartography=require('../assets/dungeonCartography'),atlas=Cartography.createAtlas();
  const d={geoKey:'0,0,0',layout:{width:20,height:20},cells:{'5,5':{tile:'floor'}},sceneSpec:{city:{architecture:{hostKey:'0,0,0',buildingId:'tower',floor:0}}}};
  const first=atlas.get(d,'run');await first.ready;atlas.reveal(first,d,{x:5.5,y:5.5});assert.equal(first.count,1);
  d.sceneSpec.city.architecture.floor=1;const second=atlas.get(d,'run');await second.ready;
  assert.notEqual(second,first);assert.equal(second.count,0);
  d.sceneSpec.city.architecture.floor=0;assert.equal(atlas.get(d,'run'),first);assert.equal(first.count,1);
});
test('optional Level mode keeps all original map controls, fog, discovered icons and normal room view by default',()=>{
  const html=fs.readFileSync(require.resolve('../assets/index.html'),'utf8'),source=fs.readFileSync(require.resolve('../assets/explorationMapUi'),'utf8');
  for(const id of ['zoom-in','zoom-out','follow','whole','close','canvas','caption','level'])assert.ok(html.includes('id="exploration-map-'+id+'"'));
  const atlas={get:d=>({width:d.layout.width,height:d.layout.height,bits:new Uint8Array(1),revision:0}),reveal:()=>[],clear(){},flush(){},flushAll(){}};
  const root={CityLevelMap:MapLevel,DungeonCartography:{createAtlas:()=>atlas}},ctx={window:root,document:{addEventListener(){}}};
  vm.runInNewContext(source,ctx);const ui=root.DungeonExplorationMap;
  assert.equal(ui.view().mode,'room');assert.equal(ui.setView('level'),false);
  const d={geoKey:'floor',layout:{width:20,height:20},sceneSpec:{city:{vertical:{towerId:'tower',floor:1}}}};
  ui.update(d,{x:10,y:10},0,'run');assert.equal(ui.setView('level'),true);assert.equal(ui.view().level.floor,1);
  d.sceneSpec.city.vertical.floor=2;ui.update(d,{x:10,y:10},0,'run');assert.equal(ui.view().mode,'level');assert.equal(ui.view().level.floor,2);
  assert.equal(ui.setView('room'),true);assert.equal(ui.view().mode,'room');
  assert.match(source,/state\.bits\[byte\]/);assert.match(source,/knownObjects/);assert.match(source,/knownEncounters/);
});
