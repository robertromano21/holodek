'use strict';
for(const flag of ['CITY_PROPS','CAMPAIGN_MAP','ARCHITECTURE_EXPANSION','CITY_SITES','GENRE_EXPANSION','HOMEBREW'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const Blocks=require('../retort/cityBlocks'),Scenery=require('../retort/cityScenery'),Stream=require('../retort/cityStreaming');
const Nav=require('../retort/sceneArchitecture'),Plans=require('../assets/cityBuildingPlans');
const Setting=require('../retort/settingLayer');
const site={id:'prepared-city',name:'Authored City',scale:'metropolis'};
function flat(size=128){
  const d={geoKey:'0,1,0',generation:{seed:'prepared-city'},layout:{width:size,height:size},start:{x:size/2,y:size/2},
    cells:{},tiles:{},sceneStructures:[]};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  return d;
}
const digest=d=>crypto.createHash('sha256').update(JSON.stringify(d)).digest('hex');

for(const genre of ['fantasy','cyberpunk'])test(`${genre} preparation builds the complete host footprint, including distant walk-in buildings`,()=>Setting.withDraft({kind:'homebrew',seed:'prepared-city',genres:[genre]},()=>{
  const d=flat(512),spec={indoor:false,city:{genre}};
  d.cells['45,45'].object={id:'saved-object'};d.cells['46,45'].navigationReserved=true;
  const reserved=structuredClone([d.cells['45,45'],d.cells['46,45']]);
  const result=Scenery.apply(d,spec,site),blocks=d.cityBlocks;
  assert.equal(result.status,'built');assert.equal(blocks.construction.status,'complete');
  assert.equal(d.cityScenery.genre,genre);assert.equal(blocks.streaming.genre,genre);
  assert.ok(blocks.buildings.length>Blocks.MAX_BUILDINGS);
  assert.ok(blocks.parks.length>Blocks.MAX_PARKS);
  assert.ok(blocks.buildings.some(b=>Math.abs(b.x)>=6||Math.abs(b.y)>=6),'Distant parcels are built before the player approaches');
  if(genre==='fantasy')assert.ok(blocks.buildings.some(b=>Math.abs(b.x)>6||Math.abs(b.y)>6),'Preparation extends beyond the old arrival radius where the map fits more parcels');
  assert.equal(blocks.construction.candidateParcels,blocks.construction.accepted+blocks.construction.unplaced);
  const all=[...blocks.buildings,...blocks.parks];assert.equal(new Set(all.map(b=>b.id)).size,all.length);
  const reached=Nav.reachable(Nav.makeNavigation(d),d.start);
  for(const b of all){
    assert.ok(b.left>=2&&b.top>=2&&b.left+b.width<510&&b.top+b.depth<510);
    for(const p of b.doors)assert.ok(reached.seen[p.y*512+p.x],b.id+' door');
    if(b.park)continue;
    assert.ok(b.rooms.length>=2);assert.ok(d.sceneStructures.some(p=>p.cityParcel===b.id&&p.role==='city-walkin-roof'));
    const record=d.cityArchitecture.buildings[b.planId];assert.equal(record.status,'built');
    assert.ok(record.floors[0]?.plan);assert.ok(Object.keys(record.floors).length<=2,'Upper storeys keep compact recipes, not eager cell grids');
    assert.equal(record.floors[0].dungeon,undefined);assert.equal(record.floors[0].population,undefined);
  }
  assert.equal(d.inhabitants,undefined);assert.equal(d.services,undefined);
  assert.deepEqual(d.cells['45,45'],reserved[0]);
  const {cityStreet,floorSurface,...protectedCell}=d.cells['46,45'];assert.deepEqual(protectedCell,reserved[1]);
  assert.ok(Object.keys(d.cells).some(k=>{const [x,y]=k.split(',').map(Number);return Math.abs(x-256)>120&&Math.abs(y-256)>120&&d.cells[k].cityStreet;}));
  d._geometryStamp='prepared-snapshot';
  const saved=JSON.parse(JSON.stringify(d)),before=digest(saved);
  assert.equal(Scenery.apply(saved,spec,site).status,'already-built');
  assert.equal(Blocks.apply(saved,spec,site,{genre,complete:true}).status,'already-built');
  assert.equal(Blocks.apply(saved,spec,site,{genre,stream:true,observer:{x:480,y:256}}).status,'already-built');
  assert.equal(digest(saved),before,'Reloading never reconstructs or repaints the saved city');
}));

test('complete preparation is deterministic, genre-native, route-safe and leaves existing records intact',()=>{
  const E=require('../assets/dungeonExits'),genres=Object.keys(require('../assets/urbanDesigns').PROFILES);
  for(const genre of genres)Setting.withDraft({kind:'homebrew',seed:'prepared-city',genres:[genre]},()=>{
    const d=flat(),other=flat(),spec={city:{genre}};
    Blocks.apply(d,spec,site,{genre,complete:true});Blocks.apply(other,spec,site,{genre,complete:true});
    assert.equal(digest(d),digest(other),genre);
    assert.equal(d.cityBlocks.construction.status,'complete');assert.ok(d.cityBlocks.buildings.length,genre);
  });
  const d=flat(256),routes=[{direction:'east',name:'Authored Archive',targetCoordinates:'2,1,0',
    footprint:{width:32,depth:32},vertical:{storeys:10},establishmentType:'library'}];
  E.install(d,{east:{targetCoordinates:'2,1,0',status:'locked'}});
  Blocks.apply(d,{city:{routes}},site,{genre:'fantasy',complete:true});
  const binding=d.cityBuildingEntrances[0],b=d.cityBlocks.buildings.find(b=>b.id===binding.buildingId);
  assert.equal(binding.targetCoordinates,'2,1,0');assert.equal(b.name,'Authored Archive');
  assert.equal(d.roomExits.markers[0].key,binding.key);assert.equal(d.cells[binding.key].navigationReserved,true);
  assert.equal(Plans.floor(d.cityArchitecture.buildings[b.planId].plan,1).connections.down,0);
  const before=digest(d);Blocks.apply(d,{city:{routes}},site,{genre:'fantasy',complete:true});assert.equal(digest(d),before);
});

test('walking never builds even in legacy cities and snapshot recovery remains scope-checked',()=>{
  for(const legacy of [false,true]){
    const d=flat(),spec={city:{genre:'cyberpunk'}};
    Blocks.apply(d,spec,site,{genre:'cyberpunk',complete:!legacy});d._geometryStamp='saved';
    const resident={actors:{Saved:{status:'dead',position:{x:64,y:64},inventory:['heirloom']}}};d.population=resident;
    let reads=0,writes=0,paused=false;
    const state={getLastCoords:()=>({x:0,y:1,z:0}),getDungeonRunId:()=> 'run',getGamePaused:()=>paused,
      getRoomDungeonForSimulation:()=>d,getRoomNameDatabase(){reads++;throw Error('Walking must not read authoring data');},
      setRoomDungeon(){writes++;throw Error('Walking must not write geometry');}};
    const request={runId:'run',geoKey:d.geoKey,player:{x:64,y:64},geometryStamp:'saved'},before=digest(d);
    const options={finalize(){throw Error('Walking must not finalize geometry');}};
    for(let i=0;i<40;i++)assert.equal(Stream.advance(state,{...request,player:{x:64+i/10,y:64}},options),null);
    assert.equal(Stream.advance(state,{...request,geometryStamp:undefined},options),null);
    const stale={...request,geometryStamp:'stale'};
    assert.equal(Stream.advance(state,stale).cityStream.snapshot,d);
    for(const patch of [{runId:'old'},{geoKey:'1,1,0'},{player:{x:NaN,y:64}},{player:{x:-2,y:64}}])assert.equal(Stream.advance(state,{...stale,...patch}),null);
    paused=true;assert.equal(Stream.advance(state,stale),null);
    assert.equal(reads,0);assert.equal(writes,0);assert.equal(digest(d),before);
  }
});

test('preparation does not upgrade existing snapshots or build a city inside a building',()=>{
  const d=flat();Blocks.apply(d,{city:{}},site);d._geometryStamp='legacy';
  const before=digest(d);Blocks.apply(d,{city:{}},site,{complete:true});assert.equal(digest(d),before);
  assert.equal(d.cityBlocks.construction,undefined,'Existing saves are not falsely marked fully prepared');
  for(const spec of [{indoor:true},{city:{roomKind:'city-building'}}]){
    const room=flat(),before=digest(room);assert.equal(Blocks.apply(room,spec,site,{complete:true}).status,'skipped');assert.equal(digest(room),before);
  }
  const occupied=flat();for(const c of Object.values(occupied.cells))c.navigationReserved=true;
  Blocks.apply(occupied,{city:{}},site,{complete:true});
  assert.equal(occupied.cityBlocks.construction.accepted,0);
  assert.equal(occupied.cityBlocks.construction.unplaced,occupied.cityBlocks.construction.candidateParcels);
});
