'use strict';
for(const flag of ['CITY_SITES','ARCHITECTURE_EXPANSION','GENRE_EXPANSION'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),F=require('../assets/cityBuildingFootprints'),P=require('../assets/cityBuildingPlans');
const Blocks=require('../retort/cityBlocks'),Nav=require('../retort/sceneArchitecture'),Indoor=require('../retort/indoorBlueprint');
function flat(size=192){const d={geoKey:'2,3,0',layout:{width:size,height:size},generation:{seed:'footprints'},start:{x:size/2,y:size/2},cells:{},tiles:{},sceneStructures:[]};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:4};return d;}
test('shared envelope recipes retain central circulation and decompose into exactly matching foundation/roof slabs',()=>{
  for(const kind of F.KINDS){const shape={version:1,kind},rects=F.rectangles(shape,32,36),coverage=new Set();
    for(const r of rects)for(let y=r.y;y<r.y+r.depth;y++)for(let x=r.x;x<r.x+r.width;x++){assert.ok(!coverage.has(`${x},${y}`));coverage.add(`${x},${y}`);}
    for(let y=0;y<36;y++)for(let x=0;x<32;x++)assert.equal(coverage.has(`${x},${y}`),F.contains(shape,(x+.5)/32,(y+.5)/36));
    for(let i=0;i<100;i++){assert.ok(F.contains(shape,.5,(i+.5)/100));assert.ok(F.contains(shape,(i+.5)/100,.5));}
  }
});
test('street walls and upper-floor plans use the same saved nonrectangular envelope and preserve walkable rooms',()=>{
  const d=flat();Blocks.apply(d,{city:{}},{id:'city',name:'City',design:{verticality:{floors:60}}},{genre:'cyberpunk',scale:'metropolis'});
  assert.ok(new Set(d.cityBlocks.buildings.map(b=>b.footprint.kind)).size>=3);
  for(const b of d.cityBlocks.buildings){
    const record=d.cityArchitecture.buildings[b.planId];assert.deepEqual(record.plan.outline,b.footprint);
    for(const [key,c]of Object.entries(d.cells))if(c.cityParcel===b.id){const [x,y]=key.split(',').map(Number);assert.ok(F.contains(b.footprint,(x-b.left+.5)/b.width,(y-b.top+.5)/b.depth));}
    const floor=P.floor(record.plan,Math.min(1,record.plan.storeys-1)),inside=flat(96);
    inside.sceneSpec={city:{genre:'cyberpunk',venue:{version:1,type:b.type,width:b.width,depth:b.depth},architecture:{plan:floor,authored:false}}};
    Indoor.build(inside,{},{});const bounds=inside.cityVenueBounds,reached=Nav.reachable(Nav.makeNavigation(inside),inside.start);
    for(const [key,c]of Object.entries(inside.cells))if(c.tile==='floor'){
      const [x,y]=key.split(',').map(Number);assert.ok(F.contains(b.footprint,(x-bounds.left+.5)/bounds.width,(y-bounds.top+.5)/bounds.depth));
      assert.equal(reached.seen[y*96+x],1,'Every indoor wing is reachable');
    }
    for(const c of d.cityCirculation?.controls.filter(c=>c.buildingId===b.id)||[])assert.ok(d.cells[`${Math.floor(c.point.x)},${Math.floor(c.point.y)}`].cityParcel===b.id);
  }
});
test('near tower voxel bodies and distant skyline surfaces derive from exactly the same envelope',()=>{
  const V=require('../assets/scenePropVoxels'),S=require('../assets/citySkyline');
  for(const kind of F.KINDS.slice(1)){
    const outline={version:1,kind},shape='a_cyberpunk_urban_skyline',near=V.build(shape,16,0,{cityFootprint:outline}),shared=F.build(outline,16);
    assert.deepEqual(near,shared);assert.ok(S.faces(shape,outline).length>=6);
    for(const face of S.faces(shape,outline)){
      const center=[0,1,2].map(i=>face.points.reduce((n,p)=>n+p[i],0)/4-face.normal[i]*.001);
      const [x,y,z]=center.map(v=>Math.max(0,Math.min(15,Math.floor(v*16))));assert.equal(near[x+y*16+z*256],1);
    }
  }
});
test('six-member new encounters stay together without changing intentionally solo or legacy cohorts',()=>{
  const I=require('../assets/dungeonInhabitants'),rows=Array.from({length:6},(_,i)=>({name:'Guard '+i,race:'Native guard',allegiance:'Hostile',encounterId:'patrol'}));
  const p=I.createPopulation('1,1,0',rows,{indoor:true,groupLimit:6});assert.equal(p.groups.length,1);assert.equal(p.groups[0].members.length,6);
  assert.equal(I.createPopulation('1,1,0',[rows[0]],{groupLimit:6}).groups[0].members.length,1);
  assert.equal(I.createPopulation('1,1,0',rows).groups.length,2);
});
