'use strict';
const H=require('./roomHazards'),C=require('./generationContracts'),Work=require('./holodekRoomWork'),I=require('../assets/dungeonInhabitants');
const literal=value=>typeof value==='string'&&!!value.trim()&&!/^(none|null|undefined|unknown)$/i.test(value.trim())&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]|\[\[|\]\]/.test(value);
const prose=value=>value.trim().replace(/\s+/g,' ');
async function prepare($,dungeon,{runId='',author}={}){
  // No regeneration during walking, a saved return, or an action on a cleared hazard.
  if(dungeon.roomHazards || dungeon._geometryStamp || dungeon._meta?.geometryStamp || dungeon._meta?.finalizedAt)return dungeon;
  const draft=H.requiredDraft(dungeon),report=draft.roomHazards;
  if(report.quota.starter){
    dungeon.roomHazards=report;
    console.info('[RoomHazards]',JSON.stringify({phase:'starter-skipped',runId,geoKey:dungeon.geoKey,requested:0,placed:0}));
    return dungeon;
  }
  const planned=report.hazards.map(h=>({id:h.id,kind:h.kind,keys:h.keys,zone:h.zone,choices:h.choices,damage:h.damage,
    mechanics:H.CATALOG[h.kind].outcome}));
  const ids=planned.map(h=>h.id),text=C.nonblankText();
  const parameters={hazards:{type:[{type:{id:C.choice(ids),name:text,description:text}}],minItems:ids.length,maxItems:ids.length}};
  const data={room:dungeon.sceneSpec?.source?.roomName,description:dungeon.sceneSpec?.source?.description,
    genre:report.genre,indoor:report.quota.indoor,biome:dungeon.classification?.biome,
    region:Work.region(dungeon.sceneSpec?.worldContext?.campaignSetting),hazards:planned};
  const brief=`ENVIRONMENTAL HAZARD AUTHORING ONLY. Name and describe every listed, already placeable physical hazard in this room. Return each exact id once. Write original names and complete descriptions grounded in this campaign and genre, not examples or stock descriptions. Explain the visible warning and physical danger so the player can recognize it. Hazards are local, optional obstacles with a safe bypass. Preserve the supplied kind, footprint, checks and effects; do not invent additional mechanics, rooms, exits, loot, creatures, quests or completed actions. Do not describe the entire biome as harmful. Fantasy uses setting-native natural or magical dangers, not modern lighting or industrial technology. Technical settings use their own technology. Existing room facts (data): ${JSON.stringify(data)}.`;
  const validate=raw=>{
    if(!Array.isArray(raw?.hazards)||raw.hazards.length!==ids.length||new Set(raw.hazards.map(h=>h.id)).size!==ids.length ||
      raw.hazards.some(h=>!ids.includes(h.id)||!literal(h.name)||!literal(h.description)) ||
      new Set(raw.hazards.map(h=>prose(h.name).toLowerCase())).size!==ids.length)
      throw Error('Author every bound hazard once with its own nonempty name and description.');
    return raw;
  };
  console.info('[RoomHazards]',JSON.stringify({phase:'planned',runId,geoKey:dungeon.geoKey,requested:ids.length,kinds:planned.map(h=>h.kind)}));
  const raw=author?validate(await author({parameters,brief,data})):await Work.request($,'room-hazards',parameters,brief,validate,
    {arrays:{hazards:{count:ids.length,batch:3}},uniqueFields:()=>['id','name']});
  for(const h of report.hazards){const row=raw.hazards.find(r=>r.id===h.id);h.label=prose(row.name);h.description=prose(row.description);
    h.evidence=h.description;h.authorship='model';h.commands=H.commands(h);}
  Object.assign(dungeon,{cells:draft.cells,tiles:draft.tiles,roomHazards:report});
  console.info('[RoomHazards]',JSON.stringify({phase:'ready',runId,geoKey:dungeon.geoKey,requested:ids.length,placed:report.hazards.length,
    hazards:report.hazards.map(h=>({id:h.id,kind:h.kind,name:h.label,keys:h.keys}))}));
  return dungeon;
}
function context(dungeon,point){
  if(!dungeon?.roomHazards?.hazards?.length || !point)return[];
  return dungeon.roomHazards.hazards.filter(h=>[...h.zone,...h.keys].some(k=>{const[x,y]=k.split(',').map(Number),p={x:x+.5,y:y+.5};
    return Math.hypot(p.x-point.x,p.y-point.y)<=18&&I.lineClear(dungeon,point,p);}))
    .map(h=>({name:h.label,description:h.description,kind:h.kind,state:h.state,keys:h.keys,choices:h.choices}));
}
module.exports={prepare,context};
