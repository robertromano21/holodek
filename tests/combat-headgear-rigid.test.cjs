'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createCanvas,CanvasRenderingContext2D}=require('canvas'),C=require('../assets/renderCharacterProcedural'),S=require('../assets/renderCharacterSprite'),GA=require('../assets/genreArchitecture'),W=require('../assets/genreWardrobe');
function world(genre){global.HolodekFlags={HOMEBREW_ACTIVE:true,HOMEBREW_GENRES:[genre]};}
function capture(spec,frame,options){
 const previous=GA.drawGarb,parts=[],draw=CanvasRenderingContext2D.prototype.drawImage;let placed;
 CanvasRenderingContext2D.prototype.drawImage=function(image,x,y,...args){
   if(options.action==='attack'&&args.length===0&&parts.length){
     const cv=createCanvas(this.canvas.width,this.canvas.height),ctx=cv.getContext('2d');draw.call(ctx,image,x,y);
     const a=image.getContext('2d').getImageData(0,0,image.width,image.height).data,b=ctx.getImageData(0,0,cv.width,cv.height).data;
     const count=d=>{let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n;};placed={before:count(a),after:count(b)};
   }return draw.call(this,image,x,y,...args);
 };
 GA.drawGarb=(k,g,p)=>{if(!g.hat&&!g.hair)return previous(k,g,p);const cv=createCanvas(k.grid*4,k.grid*4),ctx=cv.getContext('2d');
 const result=previous({...k,rect:(x,y,w,h,c)=>{if(w>0&&h>0&&x+w>0&&y+h>0&&x<k.grid&&y<k.grid){const a=Math.round(Math.max(0,x))*4,b=Math.round(Math.max(0,y))*4;ctx.fillStyle=c;ctx.fillRect(a,b,Math.round(Math.max(0,x)+w)*4-a,Math.round(Math.max(0,y)+h)*4-b);}k.rect(x,y,w,h,c);}},g,p);
 let x0=cv.width,y0=cv.height,x1=-1,y1=-1;const pixels=ctx.getImageData(0,0,cv.width,cv.height).data;
 for(let y=0;y<cv.height;y++)for(let x=0;x<cv.width;x++)if(pixels[(x+y*cv.width)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
 parts.push(x1<0?{w:0,h:0,hash:''}:{w:x1-x0+1,h:y1-y0+1,hash:crypto.createHash('sha256').update(ctx.getImageData(x0,y0,x1-x0+1,y1-y0+1).data).digest('hex')});return result;};
 try{S.createTraitSpriteCanvas(spec,frame,options);}finally{GA.drawGarb=previous;CanvasRenderingContext2D.prototype.drawImage=draw;}
 if(placed)assert.equal(placed.after,placed.before,'translated headgear cannot clip or lose pixels');
 return parts.at(-1);
}
for(const genre of W.allGenres())test('2D standing-walk headgear pixels retain exact dimensions and shape in every attack: '+genre,()=>{
 const saved=global.HolodekFlags;try{world(genre);
 const pieces=Object.values(W.PIECES).filter(p=>['hat','hair'].includes(p.slot)&&(!p.genres||p.genres.includes(genre)));
 for(const plan of ['humanoid','skeletal','spectral','giant','insectoid','serpent'])for(const nativeScale of (plan==='humanoid'?[undefined,1.65]:[undefined])){
 const base=C.buildProceduralSpriteSpec({name:'Headgear audit',race:'human',class:'Fighter',level:3});
 for(const p of pieces){const spec={...base,traits:{...base.traits,bodyPlan:plan,nagaTorso:plan==='serpent',floating:plan==='spectral',genreGarb:{genre,[p.slot]:p.id}}};
 const expected=capture(spec,0,{nativeScale,outline:false,measureBody:true});
 for(let frame=0;frame<4;frame++)assert.deepEqual(capture(spec,frame,{nativeScale,outline:false,measureBody:true,action:'attack'}),expected,plan+' '+p.id+' '+nativeScale+' attack'+frame);
 }
 }
 }finally{if(saved===undefined)delete global.HolodekFlags;else global.HolodekFlags=saved;}
});
test('all four walk frames across the 144 genre expansion actors retain their pre-fix pixels',()=>{
 const saved=global.HolodekFlags;try{for(const e of require('./hat-walk-golden.json')){world(e.genre);for(let f=0;f<4;f++)assert.equal(crypto.createHash('sha256').update(S.createTraitSpriteCanvas(e.spec,f).toBuffer('raw')).digest('hex'),e.hashes[f],e.spec.name+' '+f);}}finally{if(saved===undefined)delete global.HolodekFlags;else global.HolodekFlags=saved;}
});
