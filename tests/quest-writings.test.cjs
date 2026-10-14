'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../assets/questWritings'),Ui=require('../assets/worldInteractionUi');
function fixture() {
  const d={geoKey:'1,0,0',start:{x:2,y:2},layout:{width:6,height:6},cells:{},tiles:{}};
  for(let y=0;y<6;y++)for(let x=0;x<6;x++)d.cells[`${x},${y}`]={tile:x===0||y===0||x===5||y===5?'wall':'floor',floorHeight:1.2};
  const inscription={id:'writing:1',questStoryId:'story:1',name:'covenant tablet',title:'A surviving promise',kind:'inscription',chapters:[{text:'Return the iron sigil to the Hall of Records.'}]};
  W.apply(d,{inscriptions:[inscription]});return {d,inscription};
}
test('voxel plaques are additive, above the terrain, reachable and idempotent without altering collision cells',()=>{
  const f=fixture(),before=JSON.stringify(f.d.cells);
  assert.equal(f.d.questWritings.length,1);assert.equal(f.d.sceneStructures[0].role,'quest-writing');
  assert.ok(f.d.questWritings[0].position.z>1.2);
  W.apply(f.d,{inscriptions:[f.inscription]});assert.equal(f.d.questWritings.length,1);assert.equal(JSON.stringify(f.d.cells),before);
  const copy={...f.d,questWritings:[],sceneStructures:[],inscriptions:[]};
  const payload={geoKey:f.d.geoKey,writings:f.d.questWritings,tiles:f.d.tiles,geometryStamp:'new'};
  assert.equal(W.install(copy,payload),true);W.install(copy,payload);assert.equal(copy.sceneStructures.length,1);
  assert.equal(W.install(copy,{...payload,geoKey:'other'}),false);
});
test('camera-visible inscription discovery excludes behind-camera, distant and occluded writing',()=>{
  const {d}=fixture(),w=d.questWritings[0],q={x:w.position.x+w.size.x/2,y:w.position.y+w.size.y/2};
  const camera={x:q.x+1,y:q.y,eyeZ:2.3,dirX:-1,dirY:0,planeScale:.66,verticalScale:.66,billboards:[]};
  assert.equal(Ui.visibleWritings(d,camera).length,1);
  assert.equal(Ui.visibleWritings(d,{...camera,dirX:1}).length,0);
  assert.equal(Ui.visibleWritings(d,{...camera,x:q.x+4}).length,0);
  d.cells[`${Math.floor(camera.x)},${Math.floor(camera.y)}`].tile='wall';
  assert.equal(Ui.visibleWritings(d,camera).length,0);
});
test('discovery notifications display stored writing, are replay-safe, and pause is respected',()=>{
  const {d,inscription}=fixture(),events=[];
  global.DungeonActionNotices={receive:e=>events.push(e)};global.dungeonRunId='run';
  const Discovery=require('../assets/writingDiscovery'),targets=[{enabled:true,inscription}];
  global.gamePaused=true;assert.deepEqual(Discovery.update(d,targets),[]);global.gamePaused=false;
  assert.equal(Discovery.update(d,targets).length,1);assert.match(events[0].message,/iron sigil.*Hall of Records/);
  assert.deepEqual(Discovery.update(d,targets),[]);assert.equal(events.length,1);
  delete global.DungeonActionNotices;delete global.dungeonRunId;delete global.gamePaused;
});
