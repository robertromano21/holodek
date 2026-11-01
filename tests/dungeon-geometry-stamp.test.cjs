'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const G=require('../assets/dungeonGeometryStamp');
function geometry(){return{geoKey:'0,0,0',layout:{width:2,height:2},cells:{
  '0,0':{tile:'floor',floorHeight:0,ceilHeight:3},'1,0':{tile:'door',floorHeight:0,ceilHeight:3,door:{isOpen:false}},
  '0,1':{tile:'wall',floorSurface:'road',wallSurface:'brick',roof:{style:'pitched',height:4,slopeX:.5,slopeY:-.25},structureHeight:6}},
  sceneStructures:[{role:'arch',size:{x:2,y:1,z:3}}],surfaceArt:[{kind:'mosaic',id:'floor'}]};}
test('shared fingerprint preserves the verified historical room format',()=>{
  assert.equal(G.compute(null,'0,0,0'),'0,0,0:empty');assert.equal(G.compute({cells:{}},'0,0,0'),'0:962582b');
  assert.equal(G.compute(geometry(),'0,0,0'),'3:29eafaed');
});
test('browser script and Node export use the same geometry fingerprint',()=>{
  const window={};vm.runInNewContext(fs.readFileSync(require.resolve('../assets/dungeonGeometryStamp'),'utf8'),{window});
  const d=geometry();assert.equal(window.DungeonGeometryStamp.compute(d,d.geoKey),G.compute(d,d.geoKey));
  const html=fs.readFileSync(require.resolve('../assets/index.html'),'utf8');
  assert.ok(html.indexOf('/assets/dungeonGeometryStamp.js')<html.indexOf('/assets/game.js?'));
});
test('doors, street surfaces, heights, roofs, structures and art invalidate the fingerprint',()=>{
  const original=geometry(),stamp=G.compute(original,original.geoKey);
  for(const change of [d=>d.cells['1,0'].door.isOpen=true,d=>d.cells['0,1'].floorSurface='sidewalk',d=>d.cells['0,1'].wallSurface='metal',
    d=>d.cells['0,0'].floorHeight=.2,d=>d.cells['0,0'].ceilHeight=4,d=>d.cells['0,1'].roof.height=6,
    d=>d.cells['0,1'].roof.slopeY=.5,d=>d.cells['0,1'].structureHeight=7,d=>d.sceneStructures[0].size.x=3,d=>d.surfaceArt[0].id='other']){
    const d=structuredClone(original);change(d);assert.notEqual(G.compute(d,d.geoKey),stamp);
  }
});
test('stamping changes only version metadata, never layouts, inventory or unrelated runtime metadata',()=>{
  const d=geometry(),before=structuredClone(d);d._meta={runId:'run',finalizedAt:42};d.inventory=['quest token'];
  assert.equal(G.stamp(d,d.geoKey),d);assert.equal(d._meta.geometryStamp,d._geometryStamp);
  for(const [key,value]of Object.entries(before))assert.deepEqual(d[key],value);
  assert.equal(d._meta.runId,'run');assert.equal(d._meta.finalizedAt,42);assert.deepEqual(d.inventory,['quest token']);
});
