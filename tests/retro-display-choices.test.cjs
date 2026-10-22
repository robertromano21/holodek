'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createCanvas}=require('canvas'),D=require('../assets/retroDetails');
test('modern additions are opt-in, bounded and Classic restores the original renderer',()=>{
  let mode='modern',relief=3;const window={STONEWORK_SURFACE_CLOSURE:3,RetroGraphics:{status:()=>({mode,resolution:'cc220'}),sizes:{cc220:[1280,800]},fullbright:()=>mode!=='modern',setMode:m=>mode=m},GameMenuUi:{setStoneworkClosure:v=>relief=v}};
  vm.runInNewContext(fs.readFileSync('assets/graphicsSettings.js','utf8'),{window});const G=window.GraphicsSettings,renderer={canvas:{width:160,height:120,style:{filter:''}}};window.webglDungeonRenderer=renderer;
  assert.equal(G.status().look,'classic');G.applyToRenderer(renderer);assert.equal(renderer.canvas.width,160);assert.equal(renderer.canvas.style.filter,'');
  for(const name of ['engraved','moonlit','lantern']){G.setModern(name);assert.notEqual(renderer.canvas.style.filter,'');assert.equal(renderer.canvas.width,160);assert.ok(relief>=3);}
  G.setModern(null,{sharpness:999,contrast:-10,saturation:999});assert.equal(G.status().sharpness,4);assert.equal(G.status().contrast,50);assert.equal(G.status().saturation,150);
  G.setModern('classic',{sharpness:1});assert.equal(renderer.canvas.width,160);assert.equal(renderer.canvas.height,120);assert.equal(renderer.canvas.style.filter,'');assert.equal(relief,3);
  mode='c64_glazed';G.applyToRenderer(renderer);assert.equal(renderer.canvas.width,1280);assert.equal(renderer.canvas.height,800);assert.equal(renderer.canvas.style.filter,'');
});
test('all nine display combinations preserve exact palette colors and source pixels',()=>{
  for(const [width,height] of [[320,200],[640,400],[1280,800]])for(const count of [16,32,64]){
    const palette=D.palettes[count];assert.equal(new Set(palette.map(c=>c.join(','))).size,count);
    assert.deepEqual(palette.slice(0,16),D.colors);
    const source=new Uint8ClampedArray(width*height*4);
    for(let p=0;p<width*height;p++)source.set([...palette[p%count],255],p*4);
    const before=Buffer.from(source),out=D.enhanced(source,width,height,count);
    assert.deepEqual(Buffer.from(out.data),before);assert.deepEqual(Buffer.from(source),before);
    assert.equal(new Set(out.indices).size,count);assert.equal(out.width,width);assert.equal(out.height,height);
    assert.equal(D.hiresPrg(D.legacyFrame(out)).length,9026);
  }
});
test('browser changes logical output size and color depth independently and retains preferences',()=>{
  const saved={'holodek-retro-display':JSON.stringify({resolution:'cc220',colors:64})};const host={appendChild(c){c.parentNode=this;}};
  const document={documentElement:{dataset:{}},readyState:'loading',getElementById(){},addEventListener(){},createElement(){const c=createCanvas(1,1);c.style={};c.setAttribute=()=>{};return c;}};
  const window={document,RetroDetails:D,performance,localStorage:{getItem:k=>saved[k],setItem:(k,v)=>saved[k]=v},console};
  const code=fs.readFileSync('assets/retroGraphics.js','utf8');vm.runInNewContext(code,{window,document});
  assert.equal(window.RetroGraphics.status().resolution,'cc65');assert.equal(window.RetroGraphics.status().colors,32);
  const R=window.RetroGraphics,scene=createCanvas(1280,800);scene.getContext('2d').fillRect(0,0,1280,800);
  R.setMode('c64_glazed');
  for(const resolution of ['cc65','cc110','cc220'])for(const colors of [16,32,64]){
    R.setDisplay({resolution,colors});assert.equal(R.present(scene,host),true);
    assert.equal(R.status().width,R.sizes[resolution][0]);assert.equal(R.status().colors,colors);
    assert.equal(R.exportHires().length,9026);
  }
  assert.throws(()=>R.setDisplay({colors:256}),/Unsupported/);assert.throws(()=>R.setDisplay({resolution:'__proto__'}),/Unsupported/);
  vm.runInNewContext(code,{window,document});assert.equal(window.RetroGraphics.status().resolution,'cc220');assert.equal(window.RetroGraphics.status().colors,64);assert.equal(window.RetroGraphics.status().mode,'modern');
});

test('Modern keeps its native resolution and independent detail through every Retro size',()=>{
  let mode='modern',resolution='cc65';const sizes={cc65:[320,200],cc110:[640,400],cc220:[1280,800]};const window={RetroGraphics:{status:()=>({mode,resolution}),sizes,fullbright:()=>mode!=='modern',setMode:m=>mode=m},GameMenuUi:{setStoneworkClosure(){}}};
  vm.runInNewContext(fs.readFileSync('assets/graphicsSettings.js','utf8'),{window});const G=window.GraphicsSettings;
  for(const [width,height] of [[160,120],[640,480],[960,540]]){const renderer={canvas:{width,height,style:{}}};window.webglDungeonRenderer=renderer;G.setModern('classic',{sharpness:1});assert.equal(renderer.canvas.width,width);
    for(const sharpness of [1,2,3,4]){G.setModern(null,{sharpness});for(const name of ['engraved','moonlit','classic']){G.setModern(name);assert.equal(renderer.canvas.width,width*sharpness);assert.equal(renderer.canvas.height,height*sharpness);}
      for(const size of Object.keys(sizes)){resolution=size;mode='c64_glazed';G.applyToRenderer(renderer);assert.equal(renderer.canvas.width,sizes[size][0]);mode='modern';G.applyToRenderer(renderer);assert.equal(renderer.canvas.width,width*sharpness);assert.equal(renderer.canvas.height,height*sharpness);assert.equal(renderer.canvas.style.filter,'');}
    }
  }
});
