'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Objects=require('../assets/objectDiscovery'),World=require('../assets/worldInteractionUi');
test('remaining loot counts the full room list, not visibility, discovery history, inventory or fixtures',()=>{
  for(const value of ['None','Empty','Nothing.','',null,undefined,[]])assert.equal(Objects.countRemaining(value),0);
  assert.equal(Objects.countRemaining('old scroll, bronze sword, hidden key'),3);
  assert.equal(Objects.countRemaining('old scroll, OLD SCROLL, None'),1,'The scene only places one instance per item name');
  assert.equal(Objects.countRemaining([{name:'old scroll'},{name:'hidden key'},null]),2);
  const room={geoKey:'0,0,0',sceneObjects:[{name:'old scroll'}],objectDiscoveries:{names:['old scroll']}};
  Objects.update(room,[]);
  assert.equal(Objects.countRemaining('old scroll, hidden key'),2);
  assert.equal(Objects.isVisible(room,'old scroll'),false);
  assert.equal(Objects.countRemaining('hidden key'),1,'Pickup removes one room entry');
  assert.equal(Objects.countRemaining('hidden key, dropped sword'),2,'Drop adds a room entry');
  const game=require('node:fs').readFileSync(require.resolve('../assets/game'),'utf8');
  assert.match(game,/Objects in Room Properties: <span data-room-object-properties>[^\n]+\n\s*\nObjects in Room Remaining: <span data-room-object-count>/);
});
test('object discovery notifies once, persists names, hides availability when out of view and never takes loot',()=>{
  const events=[],old=globalThis.DungeonActionNotices;globalThis.DungeonActionNotices={receive:event=>events.push(event)};
  try{
    Objects.reset();const room={geoKey:'0,0,0',sceneObjects:[{name:'old scroll'}]},target={type:'item',label:'old scroll',item:room.sceneObjects[0]};
    assert.equal(Objects.isVisible(room,target.label),false);
    assert.equal(Objects.update(room,[target]).length,1);assert.equal(events.length,1);assert.equal(events[0].kind,'object-discovered');
    assert.equal(Objects.isVisible(room,target.label),true);Objects.update(room,[target]);assert.equal(events.length,1);
    Objects.update(room,[]);assert.equal(Objects.isVisible(room,target.label),false);assert.equal(Objects.hasDiscovered(room,target.label),true);
    const saved=JSON.parse(JSON.stringify(room));Objects.update(saved,[target]);assert.equal(events.length,1);assert.equal(saved.sceneObjects.length,1);
    Objects.update({geoKey:'1,0,0'},[target]);assert.equal(events.length,2);assert.equal(room.sceneObjects.length,1);
  }finally{globalThis.DungeonActionNotices=old;Objects.reset();}
});
test('objects must have visible opaque pixels in front of the camera, with no wall or actor occlusion',()=>{
  const d={cells:{},tiles:{}};for(let y=0;y<8;y++)for(let x=0;x<8;x++)d.cells[`${x},${y}`]={tile:'floor'};
  const target={type:'item',key:'5,4',label:'old scroll',distance:3,pixels:{w:4,h:4,data:new Uint8Array(64).fill(255)},screen:{left:.4,right:.6,top:.4,bottom:.6}};
  const c={x:2.5,y:4.5,eyeZ:.65,dirX:1,dirY:0,planeScale:.577,verticalScale:1.73,billboards:[target]};
  assert.equal(World.visibleBillboards(d,c,'item').length,1);
  d.cells['3,4']={tile:'wall',ceilHeight:3};assert.equal(World.visibleBillboards(d,c,'item').length,0);
  d.cells['3,4'].tile='floor';target.screen.left=1.2;target.screen.right=1.4;assert.equal(World.visibleBillboards(d,c,'item').length,0);
});

test('thin opaque sprite rows remain selectable at every approach orientation',()=>{for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const d={cells:{},tiles:{}};for(let y=0;y<10;y++)for(let x=0;x<10;x++)d.cells[x+','+y]={tile:'floor'};const pixels={w:4,h:32,data:new Uint8Array(4*32*4)};pixels.data[(1*4+1)*4+3]=255;const c={x:4.5,y:4.5,eyeZ:.65,dirX:Math.cos(angle),dirY:Math.sin(angle),planeScale:.577,verticalScale:1.73};const target={type:'item',key:'6,4',label:'thin key',distance:1,pixels,screen:{left:.4,right:.6,top:.4,bottom:.6}};c.billboards=[target];assert.equal(World.visibleBillboards(d,c,'item').length,1);}});
