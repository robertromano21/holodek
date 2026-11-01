'use strict';
const C=require('../assets/cityServiceCounters'),I=require('../assets/dungeonInhabitants');
function bound(room,name){return[...Object.values(room?.services||{}),room?.venueDesk,...Object.values(room?.venueDesks||{})]
  .some(s=>require('../assets/cityEstablishments').operators(s).includes(name));}
function owns(d,room,counter,record){
  return bound(room,record.name)&&(C.belongs(d,counter,record.occupation)||
    !record.occupation&&d.cityVenue?.id===counter.venueId);
}
function allows(d,room,record,counterId,player){
  const counter=C.catalog(d).find(c=>c.id===counterId);
  return !!counter&&C.reachable(d,counter,player,I)&&owns(d,room,counter,record);
}
function resolve(state,request){
  const coords=state.getLastCoords(),key=`${coords.x},${coords.y},${coords.z}`;
  if(request.runId!==state.getDungeonRunId()||request.geoKey!==key||state.getGamePaused())throw Error('That counter belongs to another room or game.');
  const d=state.getRoomDungeonForSimulation(coords),counter=C.catalog(d).find(c=>c.id===request.counterId);
  if(!counter||!C.reachable(d,counter,request.player,I))throw Error('Walk closer to the service counter.');
  const room=JSON.parse(state.getRoomNameDatabase())[key],population=state.getRoomPopulation(key),roster=JSON.parse(state.getCombatCharactersString()||'[]');
  for(const record of Object.values(population?.actors||{})){
    const actor=roster.find(a=>a.type==='monster'&&a.name===record.name);
    if(record.status!=='present'||!I.canAct(record)||I.allegiance(record)==='Hostile'||!actor||
      actor.discoveryState==='pending'||!I.canAct(actor)||I.allegiance(actor)==='Hostile'||!owns(d,room,counter,record))continue;
    const reach=I.dialogueReach(d,actor,request.player);
    if(reach.canSpeak&&reach.lineOfSight)return{actor:record.name,counterId:counter.id};
  }
  const row=Object.values(d.cityCrowd?.actors||{}).find(a=>a.status==='ambient'&&C.belongs(d,counter,a.occupation)&&
    Math.hypot(a.position.x+.5-request.player.x,a.position.y+.5-request.player.y)<=8&&
    I.lineClear(d,request.player,{x:a.position.x+.5,y:a.position.y+.5}));
  if(row)return{citizen:{ambient:true,crowdId:row.id,mazeRoomKey:key,name:row.name},counterId:counter.id};
  throw Error('No available attendant is within calling distance of this counter.');
}
module.exports={resolve,allows};
