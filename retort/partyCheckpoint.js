'use strict';
const I=require('../assets/dungeonInhabitants'),Shape=require('../saveGameState'),Floors=require('./hostLocalFloors');
const key=value=>String(value||'').trim().toLowerCase();
function replace(text,label,sheets){
  return text.replace(I.sectionPattern(label),(_,header)=>header+' '+(sheets.map(s=>s.rawSheet||s.sheet).join('\n')||'None')+'\n');
}
function browserSheet(row){
  if(!row||['Name','Sex','Race','Class'].some(k=>typeof row[k]!=='string'||!row[k].trim()||/[\r\n]/.test(row[k]))||
    ['Level','AC','XP','HP','MaxHP','Attack','Damage','Armor','Magic'].some(k=>!Number.isFinite(row[k])))return null;
  const equipment=['Weapon','Armor','Shield','Other'].map(k=>{const v=row.Equipped?.[k];return k+': '+(typeof v==='string'?v:v?.name||v?.Name||'None');}).join(', ');
  return I.parseBlocks([row.Name,row.Sex,row.Race,row.Class,...['Level','AC','XP','HP','MaxHP'].map(k=>k+': '+row[k]),
    'Equipped: '+equipment,...['Attack','Damage','Armor','Magic'].map(k=>k+': '+row[k]),'State: '+I.state(row,'Friendly')].join('\n'),'npc')[0];
}
// Old local recruitment saved the roster but not its console. Require two saved
// membership records before recovering an omitted companion; never recruit a bystander.
function reconcile(snapshot,browser){
  const server=Shape.clone(snapshot),db=JSON.parse(server.roomNameDatabaseString),roster=JSON.parse(server.combatCharactersString);
  const confirmed=new Set((browser?.data?.npcs||[]).map(a=>key(a.Name||a.name)));
  const party=I.parseSheets(server.updatedGameConsole,'NPCs in Party'),known=new Set(party.map(a=>key(a.name)));
  const roomKey=`${server.lastCoords.x},${server.lastCoords.y},${server.lastCoords.z}`;
  const floor=Floors.bundle(db,server.activeCityFloor),room=floor?.room||db[roomKey];
  const residents=I.parseSheets(server.updatedGameConsole),recovered=[];
  for(const actor of roster){
    const name=key(actor.name||actor.Name);
    if(actor.type!=='npc'||known.has(name)||!confirmed.has(name))continue;
    const record=room?.inhabitants?.actors?.[actor.name]||server.roomPopulations[roomKey]?.actors?.[actor.name];
    let sheet=residents.find(a=>key(a.name)===name)||I.parseBlocks(record?.sheet||'', 'npc')[0]||
      browserSheet(browser.data.npcs.find(a=>key(a.Name||a.name)===name));
    if(!sheet)throw Error(`Saved companion ${actor.name} has no complete character sheet. The save was not changed.`);
    if(Number.isFinite(actor.hp)){
      const text=(sheet.rawSheet||sheet.sheet).replace(/^(\s*HP:)[^\r\n]*/m,(_,h)=>h+' '+actor.hp)
        .replace(/^(\s*State:)[^\r\n]*/m,(_,h)=>h+' '+I.state({...sheet,...actor},'Friendly'));
      sheet=I.parseBlocks(text,'npc')[0];
    }
    party.push(sheet);known.add(name);recovered.push(actor.name);
  }
  let changed=false;
  if(recovered.length){
    if(!I.sectionPattern('NPCs in Party').test(server.updatedGameConsole))throw Error('Saved party section is missing.');
    server.updatedGameConsole=replace(server.updatedGameConsole,'NPCs in Party',party);
    server.updatedGameConsole=replace(server.updatedGameConsole,'Monsters in Room',residents.filter(a=>!known.has(key(a.name))));
    changed=true;
  }
  if(known.size&&room?.monsters)for(const field of ['inRoom','consoleBlock'])if(typeof room.monsters[field]==='string'){
    const before=I.parseBlocks(room.monsters[field]),after=before.filter(a=>!known.has(key(a.name)));
    if(before.length!==after.length){room.monsters[field]=after.map(a=>a.rawSheet||a.sheet).join('\n')||'None';changed=true;}
  }
  const populations=new Set(Object.values(server.roomPopulations));
  for(const r of Object.values(db)){
    if(r?.inhabitants)populations.add(r.inhabitants);
    for(const b of Object.values(r?.cityFloors?.buildings||{}))for(const f of Object.values(b.floors||{})){
      if(f.population)populations.add(f.population);if(f.room?.inhabitants)populations.add(f.room.inhabitants);
    }
  }
  for(const population of populations){
    let updated=false;
    for(const record of Object.values(population?.actors||{}))if(known.has(key(record.name))&&record.status==='present'){
      record.status='recruited';updated=true;
    }
    if(updated){
      for(const group of population.groups||[])if(group.members.every(name=>population.actors[name]?.status!=='present'))group.status='exhausted';
      population.revision=(population.revision||0)+1;changed=true;
    }
  }
  if(changed)server.roomNameDatabaseString=JSON.stringify(db);
  return{server,recovered,changed};
}
module.exports={reconcile};
