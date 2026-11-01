'use strict';
const fs=require('node:fs'),path=require('node:path');
const directory=path.join(__dirname,'..','data');
function record(b){return{worldSeed:b.worldSeed,name:b.name,start:b.topology?.start,gmName:b.gmName};}
function read(dir=directory){
  const file=path.join(dir,'recent-world-authoring.json'),legacy=path.join(dir,'recent-world-names.json');
  const data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,worlds:[]};
  if(data.version!==1||!Array.isArray(data.worlds))throw Error('The recent-world authoring history is invalid.');
  const names=fs.existsSync(legacy)?JSON.parse(fs.readFileSync(legacy,'utf8')):[];
  if(!Array.isArray(names)||names.some(n=>typeof n!=='string'))throw Error('The legacy world-name history is invalid.');
  return{worlds:data.worlds.slice(-24),legacyNames:names};
}
// History remains an archive, not input examples or an extra model-validation gate.
// Identity collisions inside the active world are still checked by its own authoring contracts.
function validate() {}
function direction() { return ''; }
function retryGuidance() { return null; }
function remember(b,dir=directory){
  const history=read(dir),next={version:1,worlds:[...history.worlds.filter(w=>w.worldSeed!==b.worldSeed),record(b)].slice(-24)};
  fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'recent-world-authoring.json'),tmp=file+'.'+process.pid+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(next,null,2));fs.renameSync(tmp,file);
}
module.exports={read,validate,remember,record,direction,retryGuidance};
