'use strict';
const I=require('../assets/dungeonInhabitants'),Floors=require('./hostLocalFloors');
const SOURCE='engine-local-recruitment-helper-v1',pending=new WeakMap(),running=new WeakSet();
const read=state=>JSON.parse(state.getRoomNameDatabase() || '{}');
function scope(state,db=read(state)){const c=state.getLastCoords(),key=`${c.x},${c.y},${c.z}`;return{key,floor:Floors.identity(db[key]?.cityFloorContext)};}
function origin(db,lease){const host=db[lease.roomKey];return lease.ref?Floors.bundle(db,lease.ref)?.room:
  host?.cityFloorContext?host.cityFloors?.streetRoom:host;}
function same(state,db,lease){const s=scope(state,db);return lease.runId===state.getDungeonRunId() && lease.roomKey===s.key && lease.floor===s.floor;}
function queue(state,rows){const held=pending.get(state)||{completions:[],departures:[]};
  for(const key of ['completions','departures'])for(const row of rows[key] || [])if(!held[key].some(r=>(r.completionId || r.id)===(row.completionId || row.id)))held[key].push(row);
  pending.set(state,held);
}
function start(state,service,mission){
  const db=read(state),s=scope(state,db),m=db[s.key]?.minorMissions?.[mission.id];
  if(!m || m.runId!==state.getDungeonRunId() || m.floor!==s.floor || m.status!=='accepted' || !m.invitationPending ||
    m.helperOffer?.source!==SOURCE || m.helperDepartedAt || m.provisionalJoinedAt || !m.helperOffer.line?.trim())return '';
  const group=require('./recruitmentGroups').linked(state,m,db);if(group && group.status!=='accepted')return '';
  return require('./residentFavors').recruit(state,service,m.recipient,m,m.conditionalConsent,{provisional:true});
}
function advance(state,service){
  if(running.has(state))return[];running.add(state);
  try{
    const F=require('./residentFavors'),db=read(state),s=scope(state,db),room=db[s.key],completed=[];
    for(const m of Object.values(room?.minorMissions || {}))if(m.source===F.SOURCE && m.runId===state.getDungeonRunId() &&
      m.floor===s.floor && m.status==='accepted' && F.assess(m,db).passed){F.transact(state,db,m,'complete-favor');completed.push(m);}
    if(completed.length)state.setRoomNameDatabase(JSON.stringify(db));
    let latest=read(state),roster=JSON.parse(state.getCombatCharactersString() || '[]'),changed=false;
    for(const actor of roster){const lease=actor.recruitmentLease;if(!lease || lease.source!==SOURCE || !same(state,latest,lease))continue;
      const m=latest[s.key]?.minorMissions?.[lease.missionId],group=require('./recruitmentGroups').linked(state,m,latest);
      if(m?.status!=='completed' || group&&!require('./recruitmentGroups').ready(group,latest))continue;
      m.recruitedAt ||= Date.now();m.progress=actor.name+' has joined the party.';delete actor.recruitmentLease;changed=true;
    }
    if(changed){state.setRoomNameDatabase(JSON.stringify(latest));state.setCombatCharactersString(JSON.stringify(roster));}
    for(const m of completed)if(m.invitationPending)F.settleConsent(state,service,m.id);
    const acknowledgments=new Map();
    for(const m of completed)acknowledgments.set(m.recruitmentGroupId || m.id,{missionId:m.id,completionId:m.rewardReceiptId});
    const rows=[...acknowledgments.values()];if(rows.length){queue(state,{completions:rows});require('./economy').refresh(state);}
    return rows;
  }finally{running.delete(state);}
}
function depart(state,service,broadcast,{names=[]}={}){
  const db=read(state),s=scope(state,db),roster=JSON.parse(state.getCombatCharactersString() || '[]'),departures=[];
  let text=state.getUpdatedGameConsole(),changed=false;
  for(let index=roster.length-1;index>=0;index--){const actor=roster[index],lease=actor.recruitmentLease;
    const here=lease&&same(state,db,lease);
    if(lease?.source!==SOURCE || lease.runId!==state.getDungeonRunId() || here&&!names.includes(actor.name) || !I.canAct(actor))continue;
    const room=origin(db,lease),mission=room?.minorMissions?.[lease.missionId],resident=room?.inhabitants?.actors?.[actor.name];
    if(!mission || !resident)throw Error('The local helper origin could not be verified; no character was discarded.');
    const sheet=I.parseSheets(text,'NPCs in Party').find(a=>a.name===actor.name);
    if(sheet)text=text.replace(I.sectionPattern('NPCs in Party'),(_,head,body)=>head+'\n'+(body.replace(sheet.rawSheet,'').trim() || 'None')+'\n');
    roster.splice(index,1);changed=true;
    resident.status=I.canAct(actor)?'present':'dead';resident.hp=actor.hp;
    if(sheet)resident.sheet=sheet.rawSheet;
    resident.position={...lease.position};resident.home={...lease.home};
    mission.helperDepartedAt=Date.now();delete mission.provisionalJoinedAt;
    const clear=target=>{if(target?.inhabitants?.companions)delete target.inhabitants.companions[actor.name];};
    for(const target of Object.values(db)){
      clear(target);clear(target?.cityFloors?.streetRoom);
      for(const building of Object.values(target?.cityFloors?.buildings || {}))for(const floor of Object.values(building.floors || {})){
        clear(floor.room);if(floor.population?.companions)delete floor.population.companions[actor.name];
      }
    }
    const residentActor={...actor,type:'monster',mazeRoomKey:lease.roomKey,mazeX:lease.position.x,mazeY:lease.position.y};
    for(const field of ['recruitmentLease','mazePoint','renderMazeX','renderMazeY'])delete residentActor[field];
    if(here){roster.push(residentActor);if(sheet)text=text.replace(I.sectionPattern('Monsters in Room'),(_,head,body)=>
      head+'\n'+(/^\s*None\s*$/i.test(body)?'':body.trim()+'\n')+sheet.rawSheet+'\n');}
    if(lease.ref){const bundle=Floors.bundle(db,lease.ref);if(bundle){bundle.population=room.inhabitants;
      bundle.residents=[...(bundle.residents || []).filter(row=>row.name!==actor.name),residentActor];}}
    else if(db[lease.roomKey]?.cityFloors){const host=db[lease.roomKey];host.cityFloors.streetResidents=[...(host.cityFloors.streetResidents || []).filter(row=>row.name!==actor.name),residentActor];}
    const line=lease.departureLine,departure={id:lease.id,speaker:actor.name,line,roomKey:lease.roomKey,runId:lease.runId,ref:lease.ref};
    departures.unshift(departure);
    if(lease.runId===state.getDungeonRunId() && I.canAct(actor))broadcast?.({type:'character_dialogue',runId:lease.runId,geoKey:lease.roomKey,
      dialogue:[{speaker:actor.name,line,recipient:'PC',attention:'passing',kind:'turn'}]});
  }
  if(changed){state.setRoomNameDatabase(JSON.stringify(db));state.setUpdatedGameConsole(text);state.setCombatCharactersString(JSON.stringify(roster));
    if(db[s.key]?.inhabitants)state.setRoomPopulation?.(s.key,db[s.key].inhabitants);
    for(const departure of departures){const room=origin(db,departure);if(!departure.ref && room?.inhabitants && departure.roomKey!==s.key)state.setRoomPopulation?.(departure.roomKey,room.inhabitants);}
    queue(state,{departures});console.info('[RecruitmentHelper]',JSON.stringify({phase:'stayed-behind',roomKey:s.key,members:departures.map(r=>r.speaker)}));
  }
  return departures;
}
async function response(state,service,result,broadcast){
  depart(state,service,broadcast);advance(state,service);
  const work=pending.get(state);pending.delete(state);if(!work)return result;
  if(work.departures.length)result={...result,content:work.departures.filter(r=>r.runId===state.getDungeonRunId()).map(r=>r.speaker+': "'+r.line+'"').join('\n\n')+'\n\n'+(result.content || '')};
  for(const descriptor of work.completions){const before=result.dialogue || [];
    const {handoffStatus,...base}=result;
    result=await require('./recruitmentHandoff').complete({state,service,result:{...base,recruitmentHandoff:descriptor},broadcast});
    result.dialogue=result.handoffStatus==='delivered'?[...before,...(result.dialogue || [])]:before;
  }
  return {...result,...(result.population?{population:state.getRoomPopulation?.(scope(state).key) || result.population}:{}),updatedGameConsole:state.getUpdatedGameConsole(),roomNameDatabaseString:state.getRoomNameDatabase(),combatCharactersString:state.getCombatCharactersString()};
}
module.exports={SOURCE,start,advance,depart,response};
