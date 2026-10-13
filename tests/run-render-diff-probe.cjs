'use strict';
// Read-only comparison of live roster art and the committed sprite implementation.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{execFileSync}=require('node:child_process');
const {loadImage,createCanvas}=require('canvas'),Sprites=require('../assets/renderCharacterSprite'),C=require('../assets/renderCharacterProcedural');
const root=path.resolve(__dirname,'..'),filename=path.join(root,'assets/renderCharacterSprite.js');
const baseline=new Module(filename,module);baseline.paths=Module._nodeModulePaths(path.dirname(filename));
baseline._compile(execFileSync('git',['show','HEAD:assets/renderCharacterSprite.js'],{cwd:root,encoding:'utf8'}),filename);
function bounds(c){
  const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let x0=c.width,y0=c.height,x1=-1,y1=-1;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(x+y*c.width)*4+3]){
    x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
  }
  return{width:c.width,height:c.height,inkWidth:x1-x0+1,inkHeight:y1-y0+1};
}
(async()=>{
  const fd=fs.openSync(path.join(root,'logs/server.log'),'r'),size=fs.fstatSync(fd).size,b=Buffer.alloc(Math.min(size,4000000));
  try{fs.readSync(fd,b,0,b.length,size-b.length);}finally{fs.closeSync(fd);}
  const records=b.toString().split('\n').filter(s=>s.includes('combatCharactersString:'));
  if(!records.length)throw Error('No current combat roster found in the recent log.');
  const last=records.at(-1),pcName=last.match(/"name":"([^"]+)"/)?.[1];
  const data=JSON.parse(fs.readFileSync(path.join(root,'.retort-data/character-traits.json'),'utf8'));
  const entries=Array.isArray(data.entries)?data.entries:Object.values(data.entries),pcEntry=entries.find(e=>e.name===pcName);
  if(!pcEntry)throw Error('No trait record found for the current PC.');
  const roster=entries.filter(e=>e.createdAt>=pcEntry.createdAt-1000&&e.sheet?.role!=='monster').map(e=>{
    const spec=e.traits?C.buildProceduralSpriteSpec(e.sheet,e.traits,{salt:e.salt,variant:e.variant,source:e.source}):
      {kind:'placeholder',name:e.name,seed:1};
    return{name:e.name,type:e.sheet?.role||'npc',sprite:{spec,dataUrl:Sprites.createCharacterSpriteCanvas(e.sheet,spec).toDataURL()}};
  }),rows=[];
  for(const actor of roster){
    if(!actor.sprite?.dataUrl)continue;
    const img=await loadImage(actor.sprite.dataUrl),c=createCanvas(img.width,img.height);c.getContext('2d').drawImage(img,0,0);
    const live=Sprites.createCharacterSpriteCanvas(actor,actor.sprite.spec),old=baseline.exports.createCharacterSpriteCanvas(actor,actor.sprite.spec);
    rows.push({name:actor.name,type:actor.type,kind:actor.sprite.spec?.kind,size:actor.sprite.spec?.traits?.size,
      build:actor.sprite.spec?.traits?.build,saved:bounds(c),current:bounds(live),committed:bounds(old),
      unchanged:live.toBuffer().equals(old.toBuffer())});
  }
  console.log(JSON.stringify(rows,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
