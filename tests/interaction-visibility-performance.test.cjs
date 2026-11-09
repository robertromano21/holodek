'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Items=require('../assets/renderSceneItems');
function fixture(){
  const counts={candidates:0,objects:0},root={
    CityServiceCounters:{catalog(){counts.candidates++;return[];}},
    getVisibleSceneObjects(){counts.objects++;return[];}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/worldInteractionUi'),'utf8'),
    {window:root,console,document:{readyState:'loading',addEventListener(){}}});
  const dungeon={geoKey:'0,0,0',cells:{},tiles:{},_geometryStamp:'unchanged'};
  for(let y=0;y<40;y++)for(let x=0;x<40;x++)dungeon.cells[x+','+y]={tile:'floor',floorHeight:0,ceilHeight:3};
  const pixels=Items.renderItemPixels({name:'pilgrim cudgel',type:'weapon'},{scale:2,world:true});
  const item={type:'item',key:'18,10',label:'cudgel',distance:8,pixels,
    screen:{left:.4,right:.6,top:.4,bottom:.6}};
  const camera={x:10.5,y:10.5,eyeZ:.65,dirX:1,dirY:0,planeScale:.577,verticalScale:1.73,billboards:[item]};
  return{World:root.WorldInteractionUi,root,counts,dungeon,item,camera};
}
// The original exhaustive pixel walk is the behavioral oracle; clicks retain their public picker.
function reference(World,dungeon,camera,type='item'){
  const result=[];
  for(const target of camera.billboards||[]){
    if(type&&target.type!==type)continue;
    const b=target.screen,p=target.pixels;if(!b||!p?.data||!(b.bottom>b.top)||!(b.right>b.left))continue;
    const low=Math.max(0,Math.ceil((0-b.top)/(b.bottom-b.top)*p.h));
    const high=Math.min(p.h-1,Math.floor((1-b.top)/(b.bottom-b.top)*p.h));let seen=false;
    for(let y=low;y<=high&&!seen;y+=target.type==='item'?1:Math.max(1,Math.floor((high-low+1)/8))){
      const opaque=[];for(let x=0;x<p.w;x++)if(p.data[(y*p.w+x)*4+3]>=128)opaque.push(x);
      for(const x of target.type==='item'?opaque:[opaque[0],opaque[Math.floor(opaque.length/2)],opaque[opaque.length-1]]){
        if(x===undefined)continue;
        const v=b.top+(y+.5)/p.h*(b.bottom-b.top),u=b.left+(x+.5)/p.w*(b.right-b.left)+(b.upperShift||0)*(1-(y+.5)/p.h);
        if(u<0||u>1||v<0||v>1)continue;
        if(World.pick(dungeon,camera,camera,u,v)===target){seen=true;break;}
      }
    }
    if(seen)result.push(target);
  }
  return result;
}
test('occluded loot prepares fixture candidates at most once, without re-reconciling objects per opaque pixel',()=>{
  const f=fixture();
  f.dungeon.surfaceArt=[{tile:'mural',kind:'fresco',surface:'wall',axis:'x',sign:-1,label:'painted panel',
    position:{x:14,y:0,z:0},size:{x:.1,y:40,z:4}}];
  assert.equal(f.World.visibleBillboards(f.dungeon,f.camera,'item').length,0);
  assert.equal(f.counts.candidates,1);assert.equal(f.counts.objects,0);
  f.dungeon.surfaceArt=[];
  assert.equal(f.World.visibleBillboards(f.dungeon,f.camera,'item')[0],f.item);
  assert.equal(f.counts.candidates,2,'Each new check prepares current candidates, not a stale frame cache');
});
test('encounter actors blocking loot short-circuit fixture work; moving away immediately reveals it',()=>{
  const f=fixture(),actor={...f.item,type:'character',label:'guard',distance:4,
    pixels:{w:64,h:64,data:new Uint8Array(64*64*4).fill(255)}};
  f.camera.billboards=[actor,f.item];
  assert.equal(f.World.visibleBillboards(f.dungeon,f.camera,'item').length,0);
  assert.equal(f.counts.candidates,0);
  actor.screen={left:.05,right:.1,top:.4,bottom:.6};
  assert.equal(f.World.visibleBillboards(f.dungeon,f.camera,'item')[0],f.item);
  assert.equal(f.counts.candidates,1);
});
test('wall, door, floor and roof changes remain live even without a new geometry stamp',()=>{
  const f=fixture();
  for(const occluder of [{tile:'wall'},{tile:'door',door:{isOpen:false}},{tile:'floor',floorHeight:2},
    {tile:'floor',roof:{height:.1}}]){
    for(let y=0;y<40;y++)f.dungeon.cells['14,'+y]={ceilHeight:3,...occluder};
    assert.equal(f.World.visibleBillboards(f.dungeon,f.camera,'item').length,0);
    for(let y=0;y<40;y++)f.dungeon.cells['14,'+y]={tile:'door',ceilHeight:3,door:{isOpen:true}};
    assert.equal(f.World.visibleBillboards(f.dungeon,f.camera,'item')[0],f.item);
  }
});
test('thin exposed item pixels, actor alpha holes, clipping and motion agree with exhaustive picking',()=>{
  const f=fixture();let seed=79;
  const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  const actor={...f.item,type:'character',distance:4,pixels:{w:16,h:16,data:new Uint8Array(16*16*4)}};
  const thin={...f.item,label:'thin key',pixels:{w:16,h:32,data:new Uint8Array(16*32*4)}};
  f.camera.billboards=[actor,thin,f.item];
  for(let n=0;n<45;n++){
    actor.pixels.data.fill(255);
    for(let j=0;j<16;j++)actor.pixels.data[(Math.floor(random()*256))*4+3]=0;
    thin.pixels.data.fill(0);thin.pixels.data[(Math.floor(random()*16*32))*4+3]=255;
    thin.screen={left:random()*.9-.1,right:1.05,top:random()*.5-.1,bottom:1.1};
    actor.screen={left:.35+random()*.15,right:.65,top:.3,bottom:.8,upperShift:random()*.1};
    actor.distance=n%3===0?8:4;
    const expected=reference(f.World,f.dungeon,f.camera);
    assert.deepEqual(Array.from(f.World.visibleBillboards(f.dungeon,f.camera,'item')),expected,'case '+n);
  }
});
test('equal-depth opaque billboards keep the original first-hit ordering',()=>{
  const f=fixture(),other={...f.item,label:'second item'};f.camera.billboards=[f.item,other];
  assert.deepEqual(Array.from(f.World.visibleBillboards(f.dungeon,f.camera,'item')),[f.item]);
  f.camera.billboards.reverse();
  assert.deepEqual(Array.from(f.World.visibleBillboards(f.dungeon,f.camera,'item')),[other]);
});
test('fixture alpha masks and nearer props still occlude visible loot through the same picker',()=>{
  const f=fixture();
  f.dungeon.surfaceArt=[{tile:'mosaic',kind:'mosaic',surface:'wall',axis:'x',sign:-1,
    position:{x:14,y:0,z:0},size:{x:.1,y:40,z:4}}];
  f.root.MosaicDesigns={contains:()=>false};
  assert.equal(f.World.visibleBillboards(f.dungeon,f.camera,'item')[0],f.item);
  f.root.MosaicDesigns.contains=()=>true;
  assert.equal(f.World.visibleBillboards(f.dungeon,f.camera,'item').length,0);
  assert.equal(f.World.pick(f.dungeon,f.camera,f.camera,.5,.5)?.type,'art');
});
module.exports={fixture,reference};
