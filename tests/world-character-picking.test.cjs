'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const UI = require('../assets/worldInteractionUi');
function fixture() {
  const dungeon = { geoKey:'0,0,0', cells:{}, tiles:{}, sceneLandmarks:[] };
  for (let y=0;y<9;y++) for(let x=0;x<9;x++) dungeon.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  const data = new Uint8Array(4*4*4); for(let i=0;i<16;i++)data[i*4+3]=255;data[3]=0;
  const actor={name:'Visible Elf',type:'monster',hp:20};
  const target={type:'character',character:actor,key:'5,4',x:5.5,y:4.5,label:actor.name,enabled:true,distance:3,
    pixels:{w:4,h:4,data},screen:{left:.4,right:.6,top:.2,bottom:.8,upperShift:0}};
  const camera={x:2.5,y:4.5,eyeZ:.65,dirX:1,dirY:0,planeScale:Math.tan(Math.PI/6),verticalScale:1.3,billboards:[target]};
  return{dungeon,camera,target};
}
test('3D character picking follows the rendered footprint, transparency, leaning and depth order',()=>{
  const {dungeon:d,camera:c,target:t}=fixture();
  assert.equal(UI.pick(d,c,c,.5,.5),t);
  assert.equal(UI.pick(d,c,c,.41,.21),null,'Transparent headroom is not clickable');
  assert.equal(UI.pick(d,c,c,.3,.5),null);
  t.screen.upperShift=.2;
  assert.equal(UI.pick(d,c,c,.68,.3),t,'Lean changes the visible silhouette');
  assert.equal(UI.pick(d,c,c,.41,.3),null);
  const item={...t,type:'item',character:undefined,label:'bronze sword',distance:1};
  c.billboards.push(item);assert.equal(UI.pick(d,c,c,.6,.5),item);
});
test('wall occlusion, pending discoveries and defeated actors cannot expose names or sheets',()=>{
  const {dungeon:d,camera:c,target:t}=fixture();
  d.cells['3,4']={tile:'wall',floorHeight:0,ceilHeight:3};assert.equal(UI.pick(d,c,c,.5,.5),null);
  d.cells['3,4'].tile='floor';t.character.discoveryState='pending';assert.equal(UI.pick(d,c,c,.5,.5),null);
  delete t.character.discoveryState;t.character.hp=0;assert.equal(UI.pick(d,c,c,.5,.5),null);
});
