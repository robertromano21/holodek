'use strict';
for(const flag of ['CITY_SITES','CITY_COMPLETE','ARCHITECTURE_EXPANSION','GENRE_LIGHTS'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../retort/cityInteriors'),P=require('../assets/cityParcels'),Indoor=require('../retort/indoorBlueprint');
const genres=Object.keys(require('../assets/genreFixtures').THEMES);
const building={id:'city:district:parcel:1,1',name:'Test Ward Clinic',type:'clinic',left:12,top:12,width:24,depth:26,storeys:78};
function fixture(){
  let db={'0,0,0':{name:'Test Ward',environmentIntent:{citySite:{id:'city',name:'Test City'}}}},paused=false,run='run';
  const d={geoKey:'0,0,0',_geometryStamp:'street-1',layout:{width:64,height:64},cells:{},cityBlocks:{buildings:[building],streaming:{genre:'cyberpunk'}}};
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  const state={getGamePaused:()=>paused,getLastCoords:()=>({x:0,y:0,z:0}),getDungeonRunId:()=>run,getRoomDungeonForSimulation:()=>d,
    getRoomNameDatabase:()=>JSON.stringify(db),setRoomNameDatabase:t=>db=JSON.parse(t)};
  const req={runId:'run',geoKey:'0,0,0',geometryStamp:'street-1',buildingId:building.id,player:C.threshold(building)};
  return{state,d,req,get db(){return db;},set paused(v){paused=v;},set run(v){run=v;}};
}
test('every street building connects to the existing floor system exactly once, without changing the street or creating dungeons',()=>{
  const f=fixture(),geometry=JSON.stringify(f.d),result=C.prepare(f.state,f.req),ground=f.db[result.targetKey];
  assert.equal(JSON.stringify(f.d),geometry);assert.deepEqual(f.state.getLastCoords(),{x:0,y:0,z:0});
  assert.equal(ground.exits.south.targetCoordinates,'0,0,0');assert.equal(ground.cityRoom.vertical.floor,0);
  assert.equal(ground.cityRoom.vertical.directory.length,78);assert.equal(Object.keys(f.db).length,79);
  assert.equal(ground.cityRoom.footprint.width,24);assert.equal(ground.cityRoom.venue.depth,26);
  for(const row of ground.cityRoom.vertical.directory){
    const room=f.db[row.key];assert.equal(room.cityRoom.frontage.buildingId,building.id);assert.equal(room.cityRoom.vertical.floor,row.floor);
    assert.equal(room.populationComplete,undefined);assert.equal(room.inhabitants,undefined);assert.equal(room.dungeon,undefined);
    if(row.floor>0)assert.equal(room.exits.down.targetCoordinates,ground.cityRoom.vertical.directory[row.floor-1].key);
    if(row.floor<77)assert.equal(room.exits.up.targetCoordinates,ground.cityRoom.vertical.directory[row.floor+1].key);
  }
  const before=JSON.stringify(f.db);assert.equal(C.prepare(f.state,f.req).targetKey,result.targetKey);assert.equal(JSON.stringify(f.db),before);
  f.db[result.targetKey].inhabitants={actors:{saved:{name:'Existing resident',status:'defeated'}}};
  C.prepare(f.state,f.req);assert.equal(f.db[result.targetKey].inhabitants.actors.saved.status,'defeated');
});
test('all four doors lead to the same interior and remember the actual return doorway',()=>{
  const f=fixture(),first=C.prepare(f.state,f.req),point=P.entrance(building,{x:building.left+building.width,y:building.top+building.depth/2});
  const second=C.prepare(f.state,{...f.req,player:point});assert.equal(second.targetKey,first.targetKey);
  assert.deepEqual(f.db[first.targetKey].cityRoom.frontage.position,point);assert.notDeepEqual(point,f.req.player);
});
test('stale, distant, blocked, paused and unconstructed entrances cannot change the database',()=>{
  const f=fixture(),before=JSON.stringify(f.db);
  for(const request of [{...f.req,runId:'old'},{...f.req,geoKey:'1,0,0'},{...f.req,geometryStamp:'old'},
    {...f.req,buildingId:'not-built'},{...f.req,player:{x:2,y:2}},{...f.req,player:{x:NaN,y:2}}])assert.throws(()=>C.prepare(f.state,request));
  f.paused=true;assert.throws(()=>C.prepare(f.state,f.req));f.paused=false;
  const p=f.req.player;f.d.cells[`${Math.floor(p.x)},${Math.floor(p.y)}`].tile='wall';assert.throws(()=>C.prepare(f.state,f.req));
  assert.equal(JSON.stringify(f.db),before);
});
test('authored buildings reuse their original destination and do not duplicate set locations',()=>{
  const db={'0,0,0':{name:'Street'},'3,2,6':{name:'Authored Library',cityRoom:{kind:'building'},objects:[{name:'Quest book'}]}};
  const before=JSON.stringify(db),result=C.connect(db,'0,0,0',{...building,targetCoordinates:'3,2,6'});
  assert.equal(result.groundKey,'3,2,6');assert.equal(JSON.stringify(db),before);
});
test('every genre gets believable fitted floors, furniture and persistent addresses without imported CotG lore',()=>{
  for(const genre of genres){
    const db={'0,0,0':{name:'Native Ward'}},b={...building,id:'parcel:'+genre,storeys:3};
    const link=C.connect(db,'0,0,0',b,{genre}),room=db[db[link.groundKey].exits.up.targetCoordinates];
    assert.equal(room.cityRoom.genre,genre);assert.equal(room.indoor,true);
    const dungeon={geoKey:'test',layout:{width:96,height:96},cells:{},tiles:{},start:{x:48,y:70},sceneStructures:[],
      sceneSpec:{city:require('../retort/citySites').sceneKind(room,db)}};
    Indoor.build(dungeon,{},{});assert.equal(dungeon.cityVenueBounds.width,b.width);assert.equal(dungeon.cityVenueBounds.depth,b.depth);
    assert.ok(dungeon.cityVenue.furnishings>0,genre);assert.ok(dungeon.cityVenue.units.length>0,genre);
    assert.doesNotMatch(JSON.stringify(db),/Tartarus|Mortacia|Arithus/);
  }
});
test('entrance UI shares server thresholds, refuses walls and is wired into normal room travel and exact return placement',()=>{
  const f=fixture(),context={window:{DungeonInhabitants:require('../assets/dungeonInhabitants'),CityParcels:P}};
  f.d.cityBlocks.buildings=[{...building,authored:true}];
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/cityBuildingUi'),'utf8'),context);
  assert.equal(context.window.CityBuildingUi.nearby(f.d,f.req.player).id,building.id);
  assert.equal(context.window.CityBuildingUi.nearby(f.d,{x:1,y:1}),null);
  const source=fs.readFileSync(require.resolve('../assets/game'),'utf8');
  assert.match(source,/window\.enterCityBuilding = passage => chatbotprocessinput/);
  assert.match(source,/CityBuildingUi\?\.onFrame\(currentDungeon, player\)/);
  assert.match(source,/frontage\?\.sourceKey === geoKey/);assert.match(source,/return \{ \.\.\.frontage.position \}/);
});
test('new dense districts actually construct dozens of buildings and give every room a visible light fixture',()=>{
  const size=384,d={geoKey:'2,0,30',layout:{width:size,height:size},start:{x:192,y:192},cells:{},tiles:{},sceneStructures:[]};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  const result=require('../retort/cityBlocks').apply(d,{city:{}},{id:'dense',name:'Native City',design:{verticality:{floors:100}}},{genre:'cyberpunk',scale:'metropolis'});
  assert.ok(result.buildings>=40,result.buildings);assert.equal(d.cityBlocks.descriptor.pitch,36);
  assert.ok(d.sceneStructures.filter(p=>p.role==='city-interior-light').length>=result.buildings*3);
  for(const part of d.sceneStructures.filter(p=>p.role==='city-interior-light'))assert.ok(require('../assets/genreLights').emission(d.tiles[part.tile].spriteSpec));
  assert.ok(d.sceneStructures.some(p=>p.role==='city-street-light'));
  assert.ok(d.cityBlocks.placement.accepted>=40);assert.ok(d.cityBlocks.placement.rejectedAttempts);
});
test('fortresses, citadels, castles, wizard towers and temples retain their actual authored storeys and street gate',()=>{
  const F=require('../retort/fortifiedSites');
  for(const type of F.TYPES){
    const db={'0,0,0':{name:'Street',indoor:false,exits:{east:{status:'open',targetCoordinates:'1,0,0'}}}};
    const planned=F.route(db,'0,0,0','east',type,{},false);assert.ok(planned,type);
    const raw={name:'Authored '+type,history:'A maintained regional seat.',purpose:'Defend the district.',heraldry:'A distinctive local banner.',
      patron:type==='deity_temple'?'Atinus':'none',floors:planned.floors.map((f,i)=>({label:'Storey '+i,flavor:'A practical and distinct occupied floor.'}))};
    Object.assign(db,F.compile(db,planned,raw,'run').rooms);
    const before=JSON.stringify(db),linked=C.connect(db,'0,0,0',{...building,targetCoordinates:planned.entryKey});
    assert.equal(linked.groundKey,planned.entryKey);assert.equal(JSON.stringify(db),before);
    assert.equal(db[planned.entryKey].exits.west.targetCoordinates,'0,0,0');assert.ok(db[planned.entryKey].exits.up);assert.ok(db[planned.entryKey].exits.down);
  }
});
test('walls do not let hidden bystanders consume all visible resident slots',()=>{
  const d={geoKey:'street',cells:{},cityCrowd:{actors:{}}};
  for(let y=0;y<40;y++)for(let x=0;x<40;x++)d.cells[`${x},${y}`]={tile:x===10?'wall':'floor',floorHeight:0};
  for(let i=0;i<24;i++)d.cityCrowd.actors['hidden-'+i]={id:'hidden-'+i,name:'Hidden '+i,status:'ambient',position:{x:12+i%2,y:4+Math.floor(i/2)},genre:'modern',race:'Human',sex:'Female',role:'traveler',seed:i};
  d.cityCrowd.actors.visible={id:'visible',name:'Visible Resident',status:'ambient',position:{x:5,y:30},genre:'modern',race:'Human',sex:'Male',role:'traveler',seed:30};
  const root={DungeonInhabitants:require('../assets/dungeonInhabitants'),ProceduralCharacters:require('../assets/renderCharacterProcedural'),GenreArchitecture:require('../assets/genreArchitecture')};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/cityCrowdUi'),'utf8'),{window:root});
  const actors=root.CityCrowdUi.actors(d,{x:5,y:5});assert.equal(actors.length,1);assert.equal(actors[0].name,'Visible Resident');
});
test('uneven urban land uses retained foundations and graded approaches instead of a flat-terrain veto',()=>{
  const size=192,d={geoKey:'3,0,30',layout:{width:size,height:size},start:{x:96,y:96},cells:{},tiles:{},sceneStructures:[]};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:x*.08+Math.sin(y/20)*.3};
  const result=require('../retort/cityBlocks').apply(d,{city:{}},{id:'hills',name:'Hillside City',design:{verticality:{floors:80}}},{genre:'modern',scale:'metropolis'});
  assert.ok(result.buildings>0);assert.equal(d.cityBlocks.placement.rejectedAttempts['steep-terrain'],undefined);
  assert.ok(d.cityBlocks.buildings.some(b=>b.engineering.fill>.5&&b.engineering.cut>.5));
  assert.ok(d.cityBlocks.buildings.some(b=>b.engineering.approaches.some(a=>a.length>1)));
  const nav=require('../retort/sceneArchitecture'),reach=nav.reachable(nav.makeNavigation(d),d.start);
  for(const b of d.cityBlocks.buildings){
    assert.equal(b.engineering.foundation,'retained-cut-and-fill');assert.ok(b.engineering.approaches.length>0);
    for(const p of b.doors)assert.equal(reach.seen[p.y*size+p.x],1);
    const foundation=d.sceneStructures.find(s=>s.role==='city-building-foundation'&&s.cityParcel===b.id);
    assert.ok(foundation.position.z<=b.engineering.terrainLow);assert.ok(foundation.size.z>.5);
  }
});
test('returning from an interior restores the actual doorway and suppresses an immediate re-entry popup',()=>{
  const source=fs.readFileSync(require.resolve('../assets/game'),'utf8'),start=source.indexOf('function world1ArrivalStart('),end=source.indexOf('\nfunction world1ApplyDatabase',start);
  const point={x:25.5,y:14.5},calls=[],context={window:{RoomArrival:{},_world1Arrival:{fromKey:'2,2,0',direction:'south',at:Date.now()},
    DungeonInhabitants:require('../assets/dungeonInhabitants'),CityBuildingUi:{suppress:(...v)=>calls.push(v)}},
    roomNameDatabase:new Map([['2,2,0',{cityRoom:{frontage:{sourceKey:'0,0,0',buildingId:building.id,position:point}}}]]),
    dungeon:{cells:{'25,14':{tile:'floor',floorHeight:0}}}};
  context.window.getRoomNameDatabase=()=>context.roomNameDatabase;
  vm.runInNewContext(source.slice(start,end)+';result=world1ArrivalStart(dungeon,"0,0,0");',context);
  assert.equal(context.result.x,point.x);assert.equal(context.result.y,point.y);assert.deepEqual(calls,[['0,0,0',building.id]]);
  assert.equal(context.window._world1Arrival,null);
});
