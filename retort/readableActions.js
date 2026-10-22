'use strict';
const R=require('../assets/readableItems'),P=require('../assets/physicalPuzzles');
const {position,lineClear}=require('./dungeonReach');
const I=require('../assets/dungeonInhabitants');
const Discovery=require('../assets/outdoorDiscovery');
function prepare({input,consoleText,database,dungeon,actor,geoKey}){
  let action=R.intent(input);if(!action)return null;
  const inventory=String(consoleText.match(/^Inventory:[ \t]*([^\r\n]*)/m)?.[1]||'').split(',').map(R.key);
  for(const sheet of [...I.parseSheets(consoleText,'PC'),...I.parseSheets(consoleText,'NPCs in Party')])
    if(sheet.hp>0&&sheet.equipped?.Other)inventory.push(R.key(sheet.equipped.Other));
  const floorNames=String(consoleText.match(/^Objects in Room:[ \t]*([^\r\n]*)/m)?.[1]||'').split(',').map(R.key);
  const entries=Object.entries(database).flatMap(([sourceKey,room])=>[...(room.readables||[]),...(room.inscriptions||[])].map(record=>({record,sourceKey,room})));
  const named=action.name?entries.filter(e=>R.key(e.record.name).replace(/^the /,'')===action.name.replace(/^the /,'')):entries.filter(e=>inventory.includes(R.key(e.record.name))||e.sourceKey===geoKey&&floorNames.includes(R.key(e.record.name)));
  if(!named.length)return null;
  const focus=database[geoKey]?.readableFocus?.[actor?.name];
  const preferred=!action.name&&focus?named.filter(e=>e.record.mechanismId+':'+e.record.id===focus):named;
  const pool=preferred.length?preferred:named;
  if(pool.length!==1)return{allowed:false,message:'Name the document or inscribed fixture you want to read; more than one matches.'};
  const {record,sourceKey,room}=pool[0],fixed=record.kind==='inscription',owned=!fixed&&inventory.includes(R.key(record.name));
  const lore=!!record.bookLore;
  if(!lore&&!R.hasContent(record))return{allowed:false,message:'This object has no stored contents to read.'};
  if(!actor||!(actor.hp>0))return{allowed:false,message:'Only a living character can read this document.'};
  if(!owned){
    const shelfKey=lore&&record.bookLore.shelf;
    const item=shelfKey?(([x,y])=>({x,y}))(shelfKey.split(',').map(Number)):fixed?(dungeon?.questWritings?.find(o=>o.id===record.id&&R.key(o.name)===R.key(record.name))||dungeon?.sceneLandmarks?.find(o=>R.key(o.label)===R.key(record.name)&&
      dungeon.tiles?.[dungeon.cells[`${o.x},${o.y}`]?.tile]?.spriteSpec?.inscription?.id===record.id)):
      Discovery.objects(dungeon?.sceneObjects||[],database[geoKey]?.inhabitants).find(o=>R.key(o.name)===R.key(record.name));
    const p=position(actor,geoKey),q=item&&(item.position?{x:item.position.x+item.size.x/2,y:item.position.y+item.size.y/2}:{x:item.x+.5,y:item.y+.5});
    // Stop at the near face of a solid monument; its own stone is not an intervening wall.
    const length=p&&q?Math.hypot(p.x-q.x,p.y-q.y):Infinity;
    const target=(fixed||shelfKey)&&!item?.position&&p&&q&&Number.isFinite(length)&&length>0?{x:q.x+(p.x-q.x)*Math.min(.51/Math.max(Math.abs(p.x-q.x),Math.abs(p.y-q.y)),1),
      y:q.y+(p.y-q.y)*Math.min(.51/Math.max(Math.abs(p.x-q.x),Math.abs(p.y-q.y)),1)}:q;
    if(sourceKey!==geoKey||!fixed&&!shelfKey&&!floorNames.includes(R.key(record.name))||!p||!q||length>2.5||!lineClear(dungeon,p,target))
      return{allowed:false,message:fixed?'Walk closer to that inscription.':'Walk closer to that document, or take it before reading it elsewhere.'};
  }
  if(action.chapter!==null&&(!Number.isSafeInteger(action.chapter)||action.chapter<1||action.chapter>record.chapters.length))
    return{allowed:false,message:`This ${record.kind} has ${record.chapters.length} chapters. No new chapter was invented.`};
  // world1 LIBRARY_BOOKS: opening a lore book without a chapter shows its cover and table of contents.
  if(lore&&action.chapter===null)action={...action,inspect:true};
  if(!action.inspect&&!record.chapters[action.chapter===null?0:action.chapter-1]?.text?.trim())
    return{allowed:false,message:'That chapter has no stored contents to read. Choose a chapter with text.'};
  const definition=room.puzzleMechanism,clue=definition&&definition.id===record.mechanismId?P.clue(definition):'';
  const notes=action.inspect?[]:(record.questHooks||[]).filter(h=>h.source==='engine-quest-hook-v1'&&
    database[h.roomKey]?.questStories?.[h.storyId]?.hook.readableId===record.id&&!database[h.roomKey]?.questScenes?.[h.storyId]?.completed);
  return{allowed:true,message:R.passage(record,action,clue)+(notes.length?'\nRecorded obligation:\n'+notes.map(h=>h.text).join('\n'):''),record,sourceKey,chapter:action.chapter??1,inspect:action.inspect,
    metadata:{activity:'Inspection',result:'observed',readableId:record.id,mechanismId:record.mechanismId,source:'stored-readable-metadata'}};
}
module.exports={prepare};
