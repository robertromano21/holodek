'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Pixels=require('../assets/gameUiPixels');
test('pixel icon filter uses a small palette and crisp alpha without changing dimensions',()=>{
  const data=Uint8ClampedArray.from([255,220,120,255,123,44,89,120,255,255,255,50,0,0,0,0]);
  const result=Pixels.pixels(data);assert.equal(result,data);assert.equal(result.length,16);
  assert.deepEqual([result[3],result[7],result[11],result[15]],[255,255,0,0]);
  const original=result.slice();Pixels.pixels(result);assert.deepEqual(result,original);
});
test('icon conversion happens once, keeps original artwork and cannot intercept clicks',()=>{
  let paints=0,source;
  const canvas={setAttribute(name,value){this[name]=value;},getContext:()=>({drawImage(img){paints++;source=img;},
    getImageData:()=>({data:new Uint8ClampedArray(24*24*4)}),putImageData(){}})};
  const image={complete:true,naturalWidth:80,src:'/assets/adventurers-map.svg'};
  const button={children:[],querySelector:s=>s==='img'?image:button.children[0],appendChild:c=>button.children.push(c),
    classList:{add(name){this.name=name;}}};
  const window={document:{readyState:'complete',getElementById:()=>null,createElement:()=>canvas}};
  const context={window,document:window.document};vm.runInNewContext(fs.readFileSync('assets/gameUiPixels.js','utf8'),context);
  window.GameUiPixels.icon(button);window.GameUiPixels.icon(button);
  assert.equal(paints,1);assert.equal(source,image);assert.equal(image.src,'/assets/adventurers-map.svg');
  assert.equal(canvas.width,24);assert.equal(canvas.height,24);assert.equal(canvas['aria-hidden'],'true');
  assert.equal(button.classList.name,'ui-pixel-icon-ready');
  assert.match(fs.readFileSync('assets/gameUiPixels.css','utf8'),/\.ui-pixel-icon\s*\{[^}]*pointer-events:\s*none/);
});
test('an unreadable icon retains its original visible SVG instead of hiding it',()=>{
  let hidden=false;
  const window={document:{getElementById:()=>null,createElement:()=>({getContext(){throw Error('No canvas');}})},console:{warn(){}}};
  const document={readyState:'complete'},context={window,document};vm.runInNewContext(fs.readFileSync('assets/gameUiPixels.js','utf8'),context);
  window.GameUiPixels.icon({querySelector:s=>s==='img'?{complete:true,naturalWidth:80}:null,classList:{add(){hidden=true;}}});
  assert.equal(hidden,false);
});
