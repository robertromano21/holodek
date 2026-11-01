'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Details=require('../retort/cityClassicalDetails'),A=require('../assets/cityArchitectureStyles');
test('native portico relief sits entirely outside the occupied upper-floor facade instead of intersecting its wall plane',()=>{
  const b={id:'hall',type:'civic',seed:5,left:20,top:30,width:24,depth:26,base:1,clearance:5,entrySides:['north','south'],
    visualStyle:{architecture:A.choose('fantasy',{type:'civic',seed:5})}},d={sceneStructures:[],tiles:{}};
  Details.frontage(d,b);
  for(const p of d.sceneStructures){
    assert.ok(p.position.y+p.size.y<b.top||p.position.y>b.top+b.depth,'Portico parts must clear the wall envelope');
    assert.equal(d.tiles[p.tile].spriteSpec.collisionBlocking,false);
  }
});
test('opaque voxel illumination has bounded exposure and cannot wash out albedo with a white torch overlay',()=>{
  const source=fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8');
  assert.match(source,/torchLight = 1\.5 \* \(1\.0 - exp\(-max\(0\.0, torchLight\) \/ 1\.5\)\)/);
  assert.match(source,/vec3 torchTint = v_color \* torchChromatic/);
  assert.match(source,/col \+= \(vec3\(1\.0\) - col\) \* torchChromatic \* torchLight \* 0\.04/);
  let previous=0;
  for(const n of [0,.1,.5,1,2,4,8,16,128]){const value=1.5*(1-Math.exp(-n/1.5));assert.ok(value>=previous&&value<=1.5);previous=value;}
});
