'use strict';
for(const flag of ['ARCHITECTURE_EXPANSION','CITY_PROPS'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Blocks=require('../retort/cityBlocks'),Stream=require('../retort/cityStreaming'),I=require('../assets/dungeonInhabitants');
function fixture(size=128){
  const d={geoKey:'0,0,30',_geometryStamp:'saved',layout:{width:size,height:size},start:{x:size/2,y:size/2},cells:{},tiles:{},sceneStructures:[],
    generation:{seed:'walk-regression'},cityArchitecture:{version:1,buildings:{}},
    cityBlocks:{version:1,descriptor:{pitch:36},buildings:[],parks:[],streaming:{revision:1,genre:'modern',scale:'city'}}};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,navigationReserved:true};
  const site={id:'walk-regression',name:'Ward'},room={cityRoom:{kind:'street'},environmentIntent:{citySite:site}};let writes=0;
  const state={getGamePaused:()=>false,getLastCoords:()=>({x:0,y:0,z:30}),getDungeonRunId:()=> 'run',getRoomDungeonForSimulation:()=>d,
    getRoomNameDatabase:()=>JSON.stringify({[d.geoKey]:room}),getRoomPopulation:()=>({actors:{}}),getCombatCharactersString:()=> '[]',setRoomDungeon(){writes++;}};
  return{d,site,state,request:{runId:'run',geoKey:d.geoKey,player:{x:size/2,y:size/2}},get writes(){return writes;}};
}
test('blocked city streaming does not repaint roads, change cells, metadata, or its geometry stamp',()=>{
  const f=fixture(),before=JSON.stringify(f.d),cells=f.d.cells;
  const result=Blocks.apply(f.d,{city:{}},f.site,{stream:true,genre:'modern',observer:f.request.player});
  assert.equal(result.status,'unchanged');assert.equal(f.d.cells,cells);assert.equal(JSON.stringify(f.d),before);
});
test('short and long walking visits never read authoring state or finalize geometry',()=>{
  const f=fixture(),before=JSON.stringify(f.d);let reads=0;
  const get=f.state.getRoomNameDatabase;f.state.getRoomNameDatabase=()=>{reads++;return get();};
  for(let i=0;i<4;i++)assert.equal(Stream.advance(f.state,{...f.request,player:{x:64+i*3,y:64}},{finalize(){throw Error('No-op finalized');}}),null);
  assert.equal(reads,0);assert.equal(f.writes,0);assert.equal(JSON.stringify(f.d),before);
  Stream.advance(f.state,{...f.request,player:{x:104,y:64}},{finalize(){throw Error('No-op finalized');}});
  assert.equal(reads,0,'Long walks do not build another neighborhood');
});
test('missed city deltas recover the exact saved snapshot before the stream throttle',()=>{
  const f=fixture();Stream.advance(f.state,f.request);
  const result=Stream.advance(f.state,{...f.request,geometryStamp:'old'});
  assert.equal(result.cityStream.snapshot,f.d);assert.equal(result.geometryStamp,'saved');assert.equal(f.writes,0);
});
test('3D crowd visibility accepts canonical and display room IDs, but rejects a different room',()=>{
  const text=fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8'),start=text.indexOf('    _getVisibleCharacterVoxelActors() {'),end=text.indexOf('\n    _getCharacterMazeRenderPosition',start);
  assert.ok(start>0&&end>start);
  const rows=['0,0,30','X: 0, Y: 0, Z: 30','1,0,30'].map((mazeRoomKey,i)=>({name:'Resident '+i,type:'ambient',mazeRoomKey,mazeX:3,mazeY:4,sprite:{spec:{kind:'procedural'}}}));
  const window={combatCharacters:[],CityCrowdUi:{actors:()=>rows},DungeonInhabitants:I};
  const renderer=vm.runInNewContext('({'+text.slice(start,end)+'})',{window});
  renderer._getCurrentRoomKey=()=> 'X: 0, Y: 0, Z: 30';renderer._getActorWorldSpec=a=>a.sprite.spec;
  assert.deepEqual(Array.from(renderer._getVisibleCharacterVoxelActors(),a=>a.name),['Resident 0','Resident 1']);
});
test('the very first combat roster has team borders before population attachment canonicalizes its room IDs',()=>{
  const root={combatCharacters:[{name:'Party ally',type:'npc',hp:10,mazeRoomKey:'X: 873, Y: 473, Z: 0',mazeX:5,mazeY:5},
    {name:'Opponent',type:'monster',state:'Hostile',hp:10,mazeRoomKey:'X: 873, Y: 473, Z: 0',mazeX:6,mazeY:5},
    {name:'Other room',type:'monster',state:'Hostile',hp:10,mazeRoomKey:'X: 0, Y: 0, Z: 0',mazeX:6,mazeY:5}]};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/combatTacticalUi'),'utf8'),{window:root});
  const rows=root.CombatTacticalUi.occupants({dungeon:{geoKey:'873,473,0',cells:{'5,5':{},'6,5':{}}},pos:{x:5,y:5}});
  assert.deepEqual(Array.from(rows,a=>[a.name,a.hostile]),[['Party ally',false],['Opponent',true]]);
});
test('new crowd bodies are built incrementally across render frames without model calls',()=>{
  const f=fixture(),rows=Object.fromEntries(Array.from({length:24},(_,i)=>['citizen-'+i,{id:'citizen-'+i,name:'Resident '+i,status:'ambient',
    position:{x:30+i,y:30},genre:'modern',role:'resident',seed:i}]));
  f.d.cityCrowd={actors:rows};let now=0,builds=0;
  const root={dungeonRunId:'run',performance:{now:()=>now},ProceduralCharacters:{deriveFallbackTraits:()=>({}),buildProceduralSpriteSpec:()=>{builds++;return{kind:'procedural'};}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/cityCrowdUi'),'utf8'),{window:root});
  assert.equal(root.CityCrowdUi.actors(f.d,{x:40,y:40}).length,2);
  assert.equal(root.CityCrowdUi.actors(f.d,{x:40,y:40}).length,2);assert.equal(builds,2);
  for(let frame=1;frame<12;frame++){now=frame*17;root.CityCrowdUi.actors(f.d,{x:40,y:40});}
  assert.equal(builds,24);assert.equal(root.CityCrowdUi.actors(f.d,{x:40,y:40}).length,24);
});
test('native facade palettes and window banks differ between buildings and survive saving',()=>{
  const Styles=require('../assets/cityBuildingStyle'),Kits=require('../assets/genreKits'),Fixtures=require('../assets/genreFixtures');
  for(const genre of Object.keys(Fixtures.THEMES)){
    const base=Kits.resolve({genre}).palette,styles=Array.from({length:32},(_,i)=>Styles.resolve(genre,{id:'building-'+i,type:'shop',seed:i},base));
    assert.ok(new Set(styles.map(s=>s.palette.primary)).size>1,genre+' wall variation');
    assert.ok(new Set(styles.map(s=>s.panes.join(','))).size>1,genre+' window variation');
    for(let i=0;i<32;i++){assert.ok(styles[i].variant<Styles.VARIANTS);assert.deepEqual(Styles.resolve(genre,JSON.parse(JSON.stringify({id:'building-'+i,type:'shop',seed:i})),base),styles[i]);}
  }
});
test('cell wall surfaces use the voxel facade base color without replacing collision geometry',()=>{
  const f=fixture(128);for(const c of Object.values(f.d.cells))delete c.navigationReserved;
  delete f.d.cityBlocks;delete f.d.cityArchitecture;
  Blocks.apply(f.d,{city:{}},f.site,{genre:'cyberpunk'});
  assert.ok(f.d.cityBlocks.buildings.length);
  assert.ok(new Set(f.d.cityBlocks.buildings.map(b=>b.lobbyKind)).size>1,'New lobbies have different seeded circulation layouts');
  for(const b of f.d.cityBlocks.buildings){
    const walls=Object.values(f.d.cells).filter(c=>c.cityParcel===b.id&&c.tile==='wall');
    assert.ok(walls.length);for(const c of walls)assert.ok(f.d.tiles[c.wallSurface]?.surfaceOnly);
    const tower=f.d.sceneStructures.find(p=>p.cityParcel===b.id&&p.skyline);
    if(tower)assert.equal(f.d.tiles[tower.tile].spriteSpec.palette.primary,b.visualStyle.palette.primary);
  }
});
