'use strict';
const I=require('../assets/dungeonInhabitants');
function providers(room,population,database={}){
  if(require('../assets/economyRules').isStarterRoom(population?.geoKey,room))return[];
  const jobs=Object.values(database).flatMap(r=>Object.values(r?.minorMissions||{})).filter(m=>m.status!=='completed');
  const E=require('../assets/cityEstablishments');
  const names=new Set([...Object.values(room?.services||{}).flatMap(E.operators),...E.operators(room?.venueDesk),
    ...Object.values(room?.venueDesks||{}).flatMap(E.operators),...Object.values(population?.actors||{}).filter(a=>a.deityId).map(a=>a.name),
    ...jobs.flatMap(m=>[...(m.roomKey===population.geoKey?[m.recipient]:[]),...(!m.originRoomKey||m.originRoomKey===population.geoKey?[m.patron]:[])])]);
  return [...names].filter(name=>{const a=population?.actors?.[name];return a?.status==='present'&&(a.hp??1)>0&&I.allegiance(a)!=='Hostile';});
}
async function accept(state,service,request,{visit,narrate=require('./encounterNarration').narrateEncounter,isCurrent=()=>true,view=require('./economy').view}={}){
  const coords=state.getLastCoords(),key=`${coords.x},${coords.y},${coords.z}`,run=state.getDungeonRunId();
  const floor=require('./hostLocalFloors').token(state);
  if(request.runId!==run||request.geoKey!==key||state.getGamePaused())throw Error('That service offer is no longer active.');
  visit ||= service.visit(request);
  if(visit.error)throw Error(visit.error);
  const population=visit.population,actor=population.actors[request.actor];
  if(!population.serviceProviders?.includes(request.actor))throw Error('That resident has no verified services here.');
  const available=view(state,request.actor,request.counterId);if(available.error)throw Error(available.error);
  if(actor.servicesAcceptedAt)return{population,dialogue:[]};
  const group=population.groups.find(g=>g.members.includes(actor.name));if(!group)throw Error('The service encounter is unavailable.');
  const currentScope=()=>{const c=state.getLastCoords();return isCurrent()&&!state.getGamePaused()&&state.getDungeonRunId()===run&&
    `${c.x},${c.y},${c.z}`===key&&require('./hostLocalFloors').token(state)===floor;};
  const result=await narrate({state,service,visit:{...visit,dialogue:[],encounters:[{groupId:group.id,names:[actor.name]}]},isCurrent:currentScope});
  const current=state.getLastCoords();
  if(result.stale||!result.story||!isCurrent()||state.getDungeonRunId()!==run||state.getRoomPopulation(key)!==population||
    key!==`${current.x},${current.y},${current.z}`||require('./hostLocalFloors').token(state)!==floor)
    throw Error('The service encounter changed before it finished.');
  actor.servicesAcceptedAt=Date.now();service.save(population);
  return result;
}
module.exports={providers,accept};
