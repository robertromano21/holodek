'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mountFloorMosaic,restoreFloorMosaics}=require('../retort/surfaceArtPlacement'),Secrets=require('../retort/secretDoors');
function room(width=24,height=24){
  const dungeon={geoKey:'1,0,0',layout:{width,height},start:{x:Math.floor(width/2),y:Math.floor(height/2)},cells:{},sceneObjects:[]},candidates=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const key=`${x},${y}`;dungeon.cells[key]={tile:!x||!y||x===width-1||y===height-1?'wall':'floor',floorHeight:0,ceilHeight:6};
    if(dungeon.cells[key].tile==='floor')candidates.push({key,x,y});
  }
  candidates.sort((a,b)=>Math.hypot(a.x-dungeon.start.x,a.y-dungeon.start.y)-Math.hypot(b.x-dungeon.start.x,b.y-dungeon.start.y));
  return{dungeon,candidates};
}
const mosaic={kind:'mosaic',surface:'floor',format:'mural',tile:'existing-art',label:'An authored mosaic',description:'An authored image.',
  mosaicShape:'circle',mosaicPattern:'pantheon_rosette',motifs:['Dragon']};

test('decorative floor mosaics use a broad six-tile footprint, with square proportions for round designs',()=>{
  const {dungeon,candidates}=room(),mount=mountFloorMosaic(dungeon,mosaic,candidates);
  assert.equal(mount.size.x,5.9);assert.equal(mount.size.y,5.9);assert.equal(mount.keys.length,36);
  const art={...mosaic,...mount};assert.equal(require('../assets/surfaceArt').presentation(art),art);
});

test('large mosaics find clear floor before shrinking and never cross pillars, stairs, walls or raised floors',()=>{
  const {dungeon,candidates}=room();
  Object.assign(dungeon.cells['12,12'],{feature:'pillar'});Object.assign(dungeon.cells['11,12'],{navigationReserved:true});
  Object.assign(dungeon.cells['10,12'],{floorHeight:1});Object.assign(dungeon.cells['9,12'],{exit:'up'});
  const mount=mountFloorMosaic(dungeon,mosaic,candidates,new Set(['8,12']));assert.equal(mount.size.x,5.9);
  for(const key of ['12,12','11,12','10,12','9,12','8,12'])assert.ok(!mount.keys.includes(key));
});

test('small rooms fit a smaller contiguous mosaic instead of clipping or changing puzzle diagrams',()=>{
  const {dungeon,candidates}=room(6,6),mount=mountFloorMosaic(dungeon,mosaic,candidates);
  assert.equal(mount.size.x,3.9);assert.equal(mount.keys.length,16);
  assert.equal(mountFloorMosaic(dungeon,{...mosaic,puzzleClue:true},candidates),null);
  assert.equal(mountFloorMosaic(dungeon,{...mosaic,format:'panel'},candidates),null);
  assert.equal(mountFloorMosaic(dungeon,{...mosaic,kind:'relief'},candidates),null);
});

test('cached mosaic resizing preserves the original art, scene and objects, and is idempotent',()=>{
  const {dungeon}=room(),art={...mosaic,key:'3,3',keys:['3,3','4,3','3,4','4,4'],position:{x:3.05,y:3.05,z:.01},size:{x:1.9,y:1.9,z:.02}};
  const clue={...art,puzzleClue:true,key:'6,6',keys:['6,6'],size:{x:.9,y:.9,z:.02}};
  dungeon.surfaceArt=[art,clue];const cells=JSON.stringify(dungeon.cells),objects=JSON.stringify(dungeon.sceneObjects);
  assert.equal(restoreFloorMosaics(dungeon),true);const restored=dungeon.surfaceArt[0];
  assert.equal(restored.tile,art.tile);assert.equal(restored.description,art.description);assert.equal(restored.mosaicPattern,art.mosaicPattern);
  assert.equal(restored.size.x,5.9);assert.equal(dungeon.surfaceArt[1],clue);
  assert.equal(JSON.stringify(dungeon.cells),cells);assert.equal(JSON.stringify(dungeon.sceneObjects),objects);
  assert.equal(restoreFloorMosaics(dungeon),false);
});

test('multiple cached floor artworks remain disjoint after enlargement',()=>{
  const {dungeon}=room();
  dungeon.surfaceArt=[3,8].map(x=>({...mosaic,tile:'art-'+x,key:`${x},3`,keys:[`${x},3`,`${x+1},3`,`${x},4`,`${x+1},4`],
    position:{x:x+.05,y:3.05,z:.01},size:{x:1.9,y:1.9,z:.02}}));
  assert.equal(restoreFloorMosaics(dungeon),true);const seen=new Set();
  for(const art of dungeon.surfaceArt)for(const key of art.keys){assert.ok(!seen.has(key));seen.add(key);}
});

test('secret chamber installation cannot replace the floor under a large mosaic with a vault wall',()=>{
  const {dungeon,candidates}=room(64,64),mount=mountFloorMosaic(dungeon,mosaic,candidates);dungeon.surfaceArt=[{...mosaic,...mount}];
  const before=Object.fromEntries(mount.keys.map(key=>[key,structuredClone(dungeon.cells[key])]));Secrets.install(dungeon);
  for(const key of mount.keys)assert.deepEqual(dungeon.cells[key],before[key]);
  assert.ok(dungeon.secretDoors.doors.length>=2);
});
