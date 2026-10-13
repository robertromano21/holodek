'use strict';
const I=require('../assets/dungeonInhabitants');
const Q=require('./questProgress');
const normalize=value=>I.roomKey(typeof value==='object'&&value?`${value.x},${value.y},${value.z}`:value);
const identity=value=>String(value||'').trim().toLowerCase();
function roomAt(database,key){return database[key]||Object.entries(database).find(([k])=>normalize(k)===key)?.[1];}
function route(database,start,goal){
  const queue=[{key:start,steps:[]}],seen=new Set([start]);
  for(let i=0;i<queue.length&&i<100;i++){
    const current=queue[i];if(current.key===goal)return current.steps;
    const room=roomAt(database,current.key);
    for(const [direction,exit]of Object.entries(room?.exits||{})){
      const target=normalize(exit?.targetCoordinates);if(!target||seen.has(target)||!roomAt(database,target))continue;
      seen.add(target);queue.push({key:target,steps:[...current.steps,{direction,room:roomAt(database,target).name||'unnamed room',
        locked:String(exit.status||'open').toLowerCase()!=='open',...(exit.key?{key:exit.key}:{})}]});
    }
  }
  return null;
}
function facts(state,input){
  const query=identity(input);if(!/\b(where|seen|find|location|directions|way|deliver|bring|present)\b/.test(query))return [];
  let database;try{database=JSON.parse(state.getRoomNameDatabase?.()||'{}');}catch{return [];}
  const tasks=state.getCurrentTasks?.()||[],task=tasks[state.getCurrentTaskIndex?.()||0];
  const start=normalize(state.getLastCoords?.());
  const result=[];
  for(const element of task?.requiredElements||[]){
    if(element.type!=='monster'||!element.name)continue;
    const original=String(element.name),key=normalize(element.placement),room=key&&roomAt(database,key);if(!room)continue;
    const delivery=Q.deliveryBindings(task).find(b=>b.recipient===original&&b.coords===key),
      recipient=delivery?Q.deliveryRecipient(task,database,delivery):{name:original},name=recipient.name,first=identity(original).split(' ')[0];
    if(!query.includes(identity(name))&&!query.includes(identity(original))&&!query.split(/[^a-z'-]+/).includes(first))continue;
    const record=Object.values(room.inhabitants?.actors||{}).find(a=>identity(a.name)===identity(name));
    if(record&&['dead','departed','recruited'].includes(record.status))continue;
    const sheets=I.parseBlocks(room.monsters?.inRoom||room.monsters?.consoleBlock);
    const listed=sheets.some(a=>identity(a.name)===identity(name))||identity(room.monsters?.inRoom)===identity(name)||!!record;
    if(!listed)continue;
    result.push({name,...(recipient.predecessor?{replaces:recipient.predecessor}:{}),room:room.name,coordinates:key,presence:record?.position?'placed':'assigned, not yet observed',
      route:route(database,start,key),source:'existing-quest-binding-and-room-roster'});
  }
  return result.slice(0,4);
}
function prompt(rows){
  return `VERIFIED LOCAL QUEST DIRECTIONS, authoritative reference rather than player-discovered events: ${JSON.stringify(rows)}. `+
    'A nearby quest contact, archivist or resident with established local familiarity may use these relevant local assignments when asked; this does not give every inhabitant private party memories or knowledge of remote events. '+
    'Use the exact destination and route, including a locked threshold. Assigned is not proof that someone has been seen or met. If the route is null, admit that no route is verified. '+
    'Correct earlier unverified directions rather than repeat them as fact. Never move the NPC, create an exit, waive a lock or mark the delivery complete. '+
    'Intentional lies and ambushes require a separate engine-authored deception record and real encounter; none is supplied here. Do not disguise an accidental wrong direction as a planned deception.';
}
module.exports={facts,prompt,route};
