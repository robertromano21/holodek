'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const C=require('../assets/renderCharacterProcedural');
// Instrument the real native drawing helper in memory, without changing shipped exports.
const filename=path.resolve(__dirname,'../assets/renderCharacterSprite.js'),m=new Module(filename,module);m.filename=filename;m.paths=module.paths;
let source=fs.readFileSync(filename,'utf8').replace('  // helm / crown / hood',`  ctx._headCapture=createCanvas(ctx.canvas.width,ctx.canvas.height);
  const captureCtx=ctx._headCapture.getContext('2d');captureCtx._c64Geometry=ctx._c64Geometry;
  captureCtx.setTransform(ctx.getTransform());bodyCtx.canvas._testHeadLayer=ctx._headCapture;
  // helm / crown / hood`).replace("  if (t.halo) c64R(ctx, hx, headY - 3, hw - 1, 1, '#ffe680');", "  if (t.halo) c64R(ctx, hx, headY - 3, hw - 1, 1, '#ffe680');\n  delete ctx._headCapture;").replace('function c64R(ctx, x, y, w, h, color) {','function c64R(ctx, x, y, w, h, color) {\n  if(ctx._headCapture)c64R(ctx._headCapture.getContext(\'2d\'),x,y,w,h,color);');m._compile(source,filename);const S=m.exports;
function shape(canvas){const ctx=canvas.getContext('2d'),d=ctx.getImageData(0,0,canvas.width,canvas.height).data;let x0=canvas.width,y0=canvas.height,x1=-1,y1=-1;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(d[(x+y*canvas.width)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}return x1<0?null:{width:x1-x0+1,height:y1-y0+1,hash:crypto.createHash('sha256').update(ctx.getImageData(x0,y0,x1-x0+1,y1-y0+1).data).digest('hex')};}
for(const plan of ['humanoid','skeletal','spectral','giant','insectoid','serpent'])test('native helmet, hood and crown retain walk-reference pixel shape during 2D attacks: '+plan,()=>{
 const base=C.buildProceduralSpriteSpec({name:'Native headgear',race:'human',class:'Fighter',level:3});
 for(const helm of ['hood','cowl','open','closed','horned','crown','circlet'])for(const nativeScale of [undefined,1.65,2.4]){
 const spec={...base,traits:{...base.traits,bodyPlan:plan,nagaTorso:plan==='serpent',floating:plan==='spectral',genreGarb:undefined,hair:'none',horns:'none',halo:false,outfit:{...base.traits.outfit,helm,hood:false}}};
 const expected=shape(S.createTraitSpriteCanvas(spec,0,{nativeScale,measureBody:true,outline:false})._testHeadLayer);
 for(let frame=0;frame<4;frame++)assert.deepEqual(shape(S.createTraitSpriteCanvas(spec,frame,{nativeScale,action:'attack',measureBody:true,outline:false})._testHeadLayer),expected,helm+' '+nativeScale+' '+frame);
 }
});
