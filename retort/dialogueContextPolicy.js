'use strict';
const compact=()=>require('./graveMasterStoryPrompts').isHolodek1();
function limits(){return compact()?{memoryChars:6000,recordChars:220,recent:3,outcomes:1,found:2,ledgerChars:3600,people:8,locales:4,radius:12,pathNodes:160,pathHops:6}:
  {memoryChars:24000,recordChars:1600,recent:12,outcomes:6,found:8,ledgerChars:16000,people:32,locales:12,radius:48,pathNodes:1024,pathHops:20};}
function background(profile){
  const summary=require('../assets/characterProfiles').compact(profile);
  if(!summary||compact())return summary;
  return Object.fromEntries(['personality','voice','history','motivation'].map(key=>[key,String(profile[key]||'')]));
}
module.exports={compact,limits,background};
