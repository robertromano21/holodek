'use strict';
for(const f of ['ARCHITECTURE_EXPANSION','GENRE_EXPANSION','CITY_SITES','CITY_COMPLETE','GENRE_KITS'])process.env['HOLODEK_'+f]='1';
const test=require('node:test'),assert=require('node:assert/strict'),Plans=require('../assets/cityBuildingPlans'),
  A=require('../assets/cityArchitectureStyles'),Sky=require('../assets/citySkyline'),V=require('../assets/scenePropVoxels'),
  Details=require('../retort/cityClassicalDetails'),H=require('../retort/hostLocalFloors'),Nav=require('../retort/sceneArchitecture');
const genres=['fantasy','dark-fantasy'];
function floor(genre='fantasy',type='temple',tradition='byzantine'){
  const style=A.choose(genre,{seed:3,type},{tradition}),p=Plans.create({id:'hall',hostKey:'0,0,0',seed:'native',genre,type,
    width:44,depth:52,storeys:4,visualStyle:{architecture:style}}),ref={hostKey:p.hostKey,buildingId:p.id,floor:1},
    db={[p.hostKey]:{cityArchitecture:{buildings:{[p.id]:{plan:p,floors:{}}}},cityFloors:{buildings:{[p.id]:{floors:{}}}}}};
  db[p.hostKey].cityFloors.buildings[p.id].floors[1]={room:H.floorRoom(db,ref)};
  return{d:H.geometry(db,ref),p,db,ref};
}
test('new fantasy storeys fit rendered people and venue purpose; modern and futuristic dimensions stay unchanged',()=>{
  for(const genre of genres)for(const type of ['home','inn','foodhall','guild','temple']){
    const p=Plans.create({id:'room',hostKey:'0,0,0',genre,type,storeys:4});
    assert.ok(p.lobby.clearance>=3);assert.ok(Plans.floor(p,1).clearance>=3);
    assert.ok(Plans.floor(p,1).clearance+.4<=p.storeyHeightMetres/2.5+1e-9);
    if(type==='foodhall')assert.ok(Plans.floor(p,1).clearance>=4.4);
    if(type==='temple')assert.ok(Plans.floor(p,1).clearance>=7.2-1e-9);
  }
  for(const genre of ['modern','cyberpunk','sci-fi']){
    const p=Plans.create({id:'room',hostKey:'0,0,0',genre,type:'home',storeys:4});
    assert.equal(p.storeyHeightMetres,3.4);assert.equal(Plans.floor(p,1).clearance,1.2);assert.equal(p.architectureStyle,undefined);
  }
});
test('native CotG facade vocabulary is also used by both fantasy genres without importing CotG lore',()=>{
  for(const [genre,cotg]of [['fantasy',true],['fantasy',false],['dark-fantasy',false]]){
    const b={id:'ward',seed:3,type:'guild',width:24,depth:24,clearance:4.2,storeys:5,storeyHeightMetres:11.5,metres:{height:58}},
      a=A.envelope(A.choose(genre,b,{cotg,tradition:'roman'}),b),part={cityArchitecture:a,position:{x:2,y:4,z:4.6},size:{x:24,y:24,z:a.height}},
      faces=Sky.faces('a_fantasy_urban_skyline',{version:1,kind:'rectangle'},a),detail=A.facade(part,b,faces,['#ffd598','#eab96d'],'one');
    assert.ok(detail.bays>12&&detail.bays<=128);assert.ok(detail.walls.some(q=>q.role==='arched-window-head'));
    assert.ok(detail.walls.some(q=>q.role==='string-course'));assert.ok(detail.walls.some(q=>q.role==='eaves-cornice'));
    assert.ok(detail.windows.length);assert.deepEqual(detail,A.facade(part,b,faces,['#ffd598','#eab96d'],'one'));
    for(const q of [...detail.walls,...detail.windows])assert.ok(q.points.flat().every(Number.isFinite));
    for(const q of detail.windows)for(const p of q.points)assert.ok(p[2]<part.position.z+a.bodyFraction*part.size.z);
    assert.doesNotMatch(JSON.stringify(detail),/Mortacia|Tartarus/);
  }
  assert.deepEqual(A.facade({cityArchitecture:A.choose('modern',{seed:1})}),{walls:[],windows:[]});
});
test('domed civic crowns use the same native dome profile at both LODs and retain every occupied storey',()=>{
  for(const genre of genres){
    const b={id:'baths',type:'bathhouse',seed:2,width:28,depth:30,clearance:4,storeys:4,storeyHeightMetres:11,metres:{height:45}},
      a=A.envelope(A.choose(genre,b,{tradition:'byzantine'}),b),f={version:1,kind:'chamfered'};
    assert.equal(a.roofForm,'dome');assert.deepEqual(V.build(`a_${genre}_urban_skyline`,16,0,{cityFootprint:f,cityArchitecture:a}),A.build(f,a,16));
    assert.ok(Sky.faces(`a_${genre}_urban_skyline`,f,a).filter(f=>f.axis===2&&f.sign>0).length>2);
    const g=A.build(f,a,32),z=Math.round(a.bodyFraction*32)-1;
    assert.equal(g[16+16*32+z*32*32],1);
  }
});
test('native columns, entablatures and pediments flank the real door, remain bounded and install once',()=>{
  for(const cotg of [false,true]){
    const b={id:'temple',seed:1,type:'temple',left:20,top:20,width:24,depth:30,base:2,clearance:7.2,entrySides:['north','south'],
      visualStyle:{architecture:A.choose('fantasy',{type:'temple',seed:1},{cotg})}},d={tiles:{},sceneStructures:[]};
    assert.equal(Details.frontage(d,b),12);assert.equal(Details.frontage(d,b),0);
    for(const p of d.sceneStructures){assert.ok(V.build(p.shape,16,0,d.tiles[p.tile].spriteSpec));
      if(p.role==='city-classical-column')assert.ok(p.position.x+p.size.x<31||p.position.x>34);}
    assert.ok(d.sceneStructures.some(p=>p.shape==='pediment'));assert.ok(d.sceneStructures.some(p=>p.shape==='entablature'));
  }
});
test('new host-local fantasy halls reuse original coffers, columns and vaults while stairs and every floor remain connected',()=>{
  for(const genre of genres){
    const {d,p,db}=floor(genre);assert.ok(d.classicalInterior.columns>0);assert.ok(d.classicalInterior.vaults>0);
    assert.ok(d.sceneStructures.some(p=>p.role==='city-floor-ceiling'&&p.shape==='coffered_slab'));
    assert.ok(d.sceneStructures.some(p=>p.shape==='dome_shell'));assert.ok(d.cityVenue.furnishings>0);
    assert.ok(d.cityCirculation.controls.some(c=>c.direction==='up'));assert.ok(d.cityCirculation.controls.some(c=>c.direction==='down'));
    const nav=Nav.makeNavigation(d),seen=Nav.reachable(nav,d.start);
    for(let i=0;i<nav.passable.length;i++)if(nav.passable[i])assert.ok(seen.seen[i],`Disconnected cell ${i}`);
    for(const part of d.sceneStructures.filter(p=>p.role==='city-classical-vault'))assert.ok(V.build(part.shape,16,0,d.tiles[part.tile].spriteSpec));
    const snapshot=JSON.stringify(d);assert.equal(Details.interior(d).changed,false);assert.equal(JSON.stringify(d),snapshot);
    assert.equal(Object.keys(db).length,1);assert.equal(d.geoKey,p.hostKey);assert.equal(d.cityFloorContext.floor,1);
  }
});
test('Classical facade relief is lit and batched at near and far distances; only the warm panes use glow',()=>{
  const b={id:'one',seed:3,type:'guild',storeys:4,width:24,depth:24,clearance:4.2,metres:{height:45},storeyHeightMetres:11.5},
    a=A.envelope(A.choose('fantasy',b,{tradition:'roman'}),b),part={shape:'a_fantasy_urban_skyline',cityParcel:b.id,skyline:true,tile:'body',
      cityArchitecture:a,cityFootprint:{version:1,kind:'rectangle'},position:{x:0,y:0,z:4.6},size:{x:24,y:24,z:a.height}},
    d={geoKey:'0,0,0',layout:{width:256,height:256},cityBlocks:{buildings:[b],streaming:{genre:'fantasy'}},sceneStructures:[part],tiles:{body:{spriteSpec:{palette:{primary:'#d6b688'}}}}};
  const near=Sky.collect(d,{x:4,y:4},{},{maxNew:10}),far=Sky.collect(d,{x:200,y:200},{},{maxNew:10});
  assert.ok(near.batches.some(b=>b.id.startsWith('facade:')));assert.ok(near.batches.some(b=>b.id.startsWith('glow:')));
  assert.ok(far.batches.some(b=>b.id.startsWith('facade:')));assert.ok(far.batches.some(b=>b.id.startsWith('body:')));
  assert.equal(near.replaced.size,0);assert.equal(far.replaced.size,1);assert.equal(far.stats.dynamicLights,0);
  assert.deepEqual(near.batches.find(b=>b.id.startsWith('facade:')).meshes,far.batches.find(b=>b.id.startsWith('facade:')).meshes);
});
test('legacy built floors and authored layouts are not reconstructed to add the new procedural style',()=>{
  const {d}=floor();delete d.classicalInterior;delete d.sceneSpec.city.architecture.plan.architectureStyle;
  const saved=JSON.stringify(d);assert.equal(Details.interior(d).changed,false);assert.equal(JSON.stringify(d),saved);
  const authored=floor().d;authored.sceneSpec.city.architecture.authored=true;delete authored.classicalInterior;
  const prior=JSON.stringify(authored);assert.equal(Details.interior(authored).changed,false);assert.equal(JSON.stringify(authored),prior);
});
test('street-accessible fantasy lobbies also have native coffered roofs, raised floor pitches and open real doorways',()=>{
  const d={geoKey:'0,0,0',generation:{seed:'classical-street'},layout:{width:128,height:128},start:{x:64,y:64},tiles:{},cells:{},sceneStructures:[]};
  for(let y=0;y<128;y++)for(let x=0;x<128;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  require('../retort/cityBlocks').apply(d,{city:{}},{id:'native',name:'Ward',design:{architecture:{tradition:'roman'}}},{genre:'fantasy',scale:'town'});
  assert.ok(d.cityBlocks.buildings.length);
  for(const b of d.cityBlocks.buildings){
    assert.ok(d.sceneStructures.some(s=>s.cityParcel===b.id&&s.role==='city-walkin-roof'&&s.shape==='coffered_slab'));
    assert.ok(b.metres.height+1e-9>=(b.clearance+.6)*2.5+(b.storeys-1)*b.storeyHeightMetres);
    assert.equal(d.cityArchitecture.buildings[b.id].plan.storeyHeightMetres,b.storeyHeightMetres);
    for(const p of b.doors)assert.equal(d.cells[`${p.x},${p.y}`].tile,'floor');
  }
});
