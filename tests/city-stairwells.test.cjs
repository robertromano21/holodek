'use strict';
for(const f of ['CITY_SITES','ARCHITECTURE_EXPANSION'])process.env['HOLODEK_'+f]='1';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../retort/cityCirculation'),I=require('../assets/dungeonInhabitants');
function room(clearance=1.2){
  const d={geoKey:'0,0,0',cityFloorContext:{hostKey:'0,0,0',buildingId:'tower',floor:1},layout:{width:40,height:40},start:{x:20,y:35},
    cells:{},tiles:{},sceneStructures:[],indoorRooms:[{x:3,y:3,w:32,h:31}],sceneSpec:{city:{genre:'sci-fi',architecture:{authored:false},
      vertical:{floor:1,storeys:4,storeyHeightMetres:3.4,elevationMetres:3.4}}}};
  for(let y=0;y<40;y++)for(let x=0;x<40;x++)d.cells[`${x},${y}`]={tile:x&&y&&x<39&&y<39?'floor':'wall',floorHeight:0,ceilHeight:clearance,
    roof:{version:1,style:'panel',height:clearance,slopeX:0,slopeY:0}};
  C.install(d);return d;
}
for(const clearance of [1.2,2.5,4.8,7.2,8])test(`stairs meet the ${clearance}-high ceiling with a framed shaft and a reachable trigger`,()=>{
  const d=room(clearance),up=d.cityCirculation.controls.find(c=>c.direction==='up');assert.ok(up);assert.ok(up.stairwell.rise>clearance);
  const {rows,rotated,rise}=up.stairwell,base=up.box.z,x=up.box.x,y=up.box.y;
  assert.ok(rise/rows<=1.5);assert.equal(up.stairwell.opening.height,clearance);
  const top=d.cells[`${x},${y}`];assert.ok(top.floorHeight>=base+clearance);assert.ok(top.roof.height-top.floorHeight>=1.1);
  assert.ok(d.sceneStructures.filter(p=>p.cityCirculation===up.id&&p.role==='city-stair-opening-frame').length===4);
  assert.equal(d.sceneStructures.filter(p=>p.cityCirculation===up.id&&p.role==='city-stair-tread').length,(rows-1)*4);
  assert.equal(d.sceneStructures.filter(p=>p.cityCirculation===up.id&&p.role==='city-stair-upper-landing').length,1);
  assert.equal(up.stairwell.upperLanding.height,top.floorHeight);
  const lower=d.cells[`${x+(rotated?rows:0)},${y+(rotated?0:rows)}`];
  assert.ok(lower.roof.height>clearance,'the opening includes the approach, not a low crossbar over the first tread');
  for(let row=rows+1;row>0;row--){const a={x:x+(rotated?row:0),y:y+(rotated?0:row)},b={x:x+(rotated?row-1:0),y:y+(rotated?0:row-1)};
    assert.ok(I.canTraverse(d,a,b),`cannot climb row ${row}`);}
  assert.ok(I.pointWalkable(d,up.trigger.x,up.trigger.y));
  const stamp=JSON.stringify(d);assert.equal(C.install(d).changed,false);assert.equal(JSON.stringify(d),stamp);
});
test('old host-local stair cores upgrade without duplicating controls and defer when a person occupies the shaft',()=>{
  const d=room(),up=d.cityCirculation.controls.find(c=>c.direction==='up'),original=up.id;delete up.stairwell;
  const key=Object.keys(d.cells).find(k=>d.cells[k].cityCirculation===up.id);
  assert.equal(C.install(d,{protectedKeys:new Set([key])}).changed,false);
  assert.equal(up.stairwell,undefined);assert.equal(C.install(d).changed,true);assert.equal(up.stairwell.version,3);
  assert.equal(d.cityCirculation.controls.filter(c=>c.id===original).length,1);
});
