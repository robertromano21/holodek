'use strict';
for(const flag of ['CITY_SITES','ARCHITECTURE_EXPANSION'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../retort/cityCirculation'),Ceilings=require('../retort/cityFloorCeilings'),V=require('../assets/scenePropVoxels');
function room(genre='cyberpunk'){
  const d={geoKey:'0,0,0',cityFloorContext:{hostKey:'0,0,0',buildingId:'inn',floor:2},layout:{width:24,height:24},start:{x:12,y:21},
    tiles:{},cells:{},sceneStructures:[],indoorRooms:[{x:2,y:2,w:20,h:20}],sceneSpec:{indoor:true,city:{genre,
      architecture:{authored:false},vertical:{floor:2,storeys:5,storeyHeightMetres:3.4}}}};
  for(let y=0;y<24;y++)for(let x=0;x<24;x++)d.cells[`${x},${y}`]={tile:x&&y&&x<23&&y<23?'floor':'wall',floorHeight:0,ceilHeight:1.2};
  C.install(d);return d;
}
function covering(d,x,y){return d.sceneStructures.filter(p=>p.role==='city-floor-ceiling'&&x>=p.position.x&&y>=p.position.y&&x<p.position.x+p.size.x&&y<p.position.y+p.size.y);}
test('native upper floors get real, genre-specific, bounded ceiling meshes, not only roof metadata',()=>{
  for(const genre of Object.keys(require('../assets/genreCeilings').PROFILES)){
    const d=room(genre),panels=d.sceneStructures.filter(p=>p.role==='city-floor-ceiling');
    assert.ok(panels.length>0&&panels.length<100,genre);
    for(const [key,c]of Object.entries(d.cells).filter(([,c])=>c.tile==='floor')){
      const [x,y]=key.split(',').map(Number),cover=covering(d,x+.5,y+.5);assert.equal(cover.length,1,`${genre} ceiling coverage at ${key}`);
      assert.ok(Math.abs(cover[0].position.z+.04-c.roof.height)<1e-6);
    }
    assert.ok(panels.every(p=>p.size.x<=8&&p.size.y<=8&&p.shape===`g_${genre}_roof_panel`));
    assert.ok(V.build(panels[0].shape,16).some(Boolean));
    const before=JSON.stringify(d);assert.equal(C.install(d).changed,false);assert.equal(JSON.stringify(d),before);
  }
});
test('upward stair shafts remain open through the room ceiling but are covered above the upper landing',()=>{
  const d=room(),up=d.cityCirculation.controls.find(c=>c.direction==='up'),b=up.triggerArea;
  const caps=covering(d,b.x+.5,b.y+.5);assert.equal(caps.length,1);
  assert.ok(caps[0].position.z>up.stairwell.upperLanding.height+1);
  assert.ok(d.sceneStructures.filter(s=>s.role==='city-stair-opening-frame'&&s.cityCirculation===up.id).length===4);
});
test('older saved floors can gain ceilings without moving residents, loot, geometry or authored sky courts',()=>{
  const d=room();d.sceneStructures=d.sceneStructures.filter(s=>s.role!=='city-floor-ceiling');delete d.cityFloorCeiling;
  d.cityCrowd={actors:{resident:{position:{x:12,y:12}}}};d.sceneObjects=[{name:'book',x:11,y:12}];
  d.sceneRoof.coverage.openZones=[{x:10,y:10,width:2,height:2}];
  const cells=JSON.stringify(d.cells),crowd=JSON.stringify(d.cityCrowd),loot=JSON.stringify(d.sceneObjects);
  assert.equal(Ceilings.install(d).changed,true);assert.equal(covering(d,10.5,10.5).length,0);
  assert.equal(JSON.stringify(d.cells),cells);assert.equal(JSON.stringify(d.cityCrowd),crowd);assert.equal(JSON.stringify(d.sceneObjects),loot);
  const authored={...d,sceneSpec:{city:{architecture:{authored:true}}}};assert.equal(Ceilings.install(authored).changed,false);
});
test('walking either side of a full-width landing automatically changes floor once, without a prompt',async()=>{
  for(const rotated of [false,true])for(const side of [.25,1.75]){
    const d=room(),c=d.cityCirculation.controls.find(c=>c.direction==='up');
    c.triggerArea={x:5,y:5,width:rotated?1:2,depth:rotated?2:1};c.trigger={x:rotated?5.5:6,y:rotated?6:5.5};
    const player={x:rotated?5.5:5+side,y:rotated?5+side:5.5};let busy=false,calls=0,applied=0;
    const window={currentDungeon:d,dungeonRunId:'run',HolodekFlags:{ARCHITECTURE_EXPANSION:true},
      document:{querySelector:()=>null,activeElement:{tagName:'BODY'}},DungeonInhabitants:{pointWalkable:()=>true,lineClear:()=>true},
      GameCommandGate:{busy:()=>busy,begin:()=>busy=true,end:()=>busy=false},getDungeonLifeContext:()=>({dungeon:d,player}),
      fetch:async()=>{calls++;return{ok:true,json:async()=>({hostLocal:true})};},applyCityFloor:async()=>{applied++;}};
    vm.runInNewContext(fs.readFileSync('assets/cityCirculationUi.js','utf8'),{window});
    await window.CityCirculationUi.onFrame(d,player);await window.CityCirculationUi.onFrame(d,player);
    assert.equal(calls,1);assert.equal(applied,1);assert.equal(busy,false);
    window.gamePaused=true;window.CityCirculationUi.onFrame(d,{x:1,y:1});window.CityCirculationUi.onFrame(d,player);assert.equal(calls,1);
  }
});
test('street roof panels are split around an upward stairwell without extending its cut into another building',()=>{
  const Stairs=require('../retort/cityStairwells'),original={role:'city-walkin-roof',cityParcel:'inn',tile:'roof',shape:'g_fantasy_roof_panel',
    position:{x:2,y:2,z:2.5},size:{x:12,y:12,z:.2}},other={...original,cityParcel:'other'};
  const d={sceneStructures:[original,other]},opening={x:5,y:5,width:2,depth:5};
  Stairs.openStreetRoof(d,{id:'inn:stairs:up',buildingId:'inn'},opening);
  const panels=d.sceneStructures.filter(s=>s.cityParcel==='inn');assert.equal(panels.length,4);assert.ok(d.sceneStructures.includes(other));
  const area=panels.reduce((sum,p)=>sum+p.size.x*p.size.y,0);assert.equal(area,144-10);
  assert.ok(panels.every(p=>p.position.x+p.size.x<=opening.x||p.position.x>=opening.x+opening.width||p.position.y+p.size.y<=opening.y||p.position.y>=opening.y+opening.depth));
  const saved=JSON.stringify(d);Stairs.openStreetRoof(d,{id:'inn:stairs:up',buildingId:'inn'},opening);assert.equal(JSON.stringify(d),saved);
});
