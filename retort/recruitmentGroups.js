'use strict';
const {randomUUID}=require('node:crypto'),I=require('../assets/dungeonInhabitants');
const SOURCE='engine-recruitment-group-v1';
const database=state=>JSON.parse(state.getRoomNameDatabase() || '{}');
const groupOf=(population,name)=>population?.groups?.find(g=>g.members.includes(name))?.id || population?.actors?.[name]?.encounterId || 'resident:'+name;
function scope(state,db=database(state)){
  const c=state.getLastCoords(),roomKey=`${c.x},${c.y},${c.z}`,room=db[roomKey];
  return {db,room,roomKey,runId:state.getDungeonRunId(),floor:require('./hostLocalFloors').identity(room?.cityFloorContext)};
}
function current(state,name,db=database(state)){
  const s=scope(state,db);
  return Object.values(s.room?.recruitmentInvitations || {}).find(g=>g.source===SOURCE && g.runId===s.runId &&
    g.roomKey===s.roomKey && g.floor===s.floor && g.members.some(m=>m.name===name) && g.status!=='declined') || null;
}
function audience(state,input,audible,policy){
  if(!require('./holodekNarration').invitationHint(input))return policy;
  const s=scope(state),p=state.getRoomPopulation?.(s.roomKey) || s.room?.inhabitants;
  const roster=JSON.parse(state.getCombatCharactersString() || '[]');
  const residents=roster.filter(a=>audible.includes(a.name) && a.type==='monster' && I.canAct(a) &&
    a.discoveryState!=='pending' && (!a.mazeRoomKey || I.roomKey(a.mazeRoomKey)===s.roomKey) &&
    I.allegiance(a)!=='Hostile' && I.hasEncountered(a,p));
  const lower=String(input).toLowerCase(),named=residents.filter(a=>lower.includes(a.name.toLowerCase()));
  const contact=named[0] || residents.find(a=>policy?.responders?.includes(a.name)) || (!policy?.directed?residents[0]:null);
  if(!contact)return policy;
  const group=groupOf(p,contact.name),names=residents.filter(a=>groupOf(p,a.name)===group).map(a=>a.name);
  return {...policy,directed:true,kind:'recruitment-group',targets:names,responders:names,reactors:[]};
}
function collective(state,name){
  const s=scope(state),p=state.getRoomPopulation?.(s.roomKey) || s.room?.inhabitants;
  const actor=Object.keys(p?.actors || {}).find(n=>n.toLowerCase()===name.toLowerCase() || n.toLowerCase().startsWith(name.toLowerCase()+' '));
  if(!actor)return false;
  if(current(state,actor,s.db))return true;
  const group=groupOf(p,actor);
  return Object.values(p.actors).filter(a=>a.status==='present' && groupOf(p,a.name)===group && I.canAct(a)).length>1;
}
function prepare(state,names){
  const s=scope(state),p=state.getRoomPopulation?.(s.roomKey) || s.room?.inhabitants;
  if(!s.room)return;
  const roster=JSON.parse(state.getCombatCharactersString() || '[]'),groups=new Map();
  for(const name of names){const a=roster.find(a=>a.name===name && a.type==='monster' && I.canAct(a));
    const r=p?.actors?.[name];if(!a || !r || r.status!=='present' || a.discoveryState==='pending' ||
      a.mazeRoomKey && I.roomKey(a.mazeRoomKey)!==s.roomKey || !I.hasEncountered(a,p) || I.allegiance(a)==='Hostile')continue;
    const protectedContact=r.recruitable===false || r.deityId || !require('../assets/pantheonCharacters').canRecruit(a) ||
      require('./questScenes').recruitmentGuard(state,`add ${name} to party`);
    const id=groupOf(p,name),rows=groups.get(id)||[];rows.push({name,outcome:protectedContact?'staying':'pending',...(protectedContact?{responsePending:true}:{})});groups.set(id,rows);
  }
  let changed=false;
  for(const [groupId,members]of groups)if(members.length>1 && !members.some(m=>current(state,m.name,s.db))){
    const id='invitation:'+randomUUID();s.room.recruitmentInvitations ||= {};
    s.room.recruitmentInvitations[id]={id,source:SOURCE,runId:s.runId,roomKey:s.roomKey,floor:s.floor,groupId,
      status:'collecting',members,createdAt:Date.now()};changed=true;
  }
  if(changed)state.setRoomNameDatabase(JSON.stringify(s.db));
}
function note(state,name,event,mission){
  const s=scope(state),g=current(state,name,s.db);if(!g)return null;
  const member=g.members.find(m=>m.name===name);
  const staying=event.socialAction==='explain-staying' && member.outcome==='staying';
  if(g.status!=='collecting' && member.outcome!=='pending' && !staying)return g;
  if(staying)member.responsePending=false;
  else if(event.socialAction==='decline-invitation')member.outcome='declined';
  else if(mission){member.outcome='conditional';member.missionId=mission.id;
    const saved=s.room.minorMissions?.[mission.id];if(saved)saved.recruitmentGroupId=g.id;
  }else if(event.socialAction==='accept-invitation')member.outcome='ready';
  else return g;
  member.line=event.line;
  const reply={speaker:name,line:event.line,playerInvited:true,at:Date.now(),source:'engine-live-dialogue-v1'};
  if(staying)member.response=reply;else member.consent=reply;
  if(g.status==='collecting' && g.members.every(m=>m.outcome!=='pending' && !m.responsePending)){
    g.status=g.members.some(m=>m.outcome==='conditional')?'review':'accepted';g.sealedAt=Date.now();
    console.info('[RecruitmentGroup]',JSON.stringify({phase:'sealed',id:g.id,members:g.members.map(m=>({name:m.name,outcome:m.outcome,missionId:m.missionId}))}));
  }
  state.setRoomNameDatabase(JSON.stringify(s.db));return g;
}
function linked(state,mission,db=database(state)){
  const s=scope(state,db),g=s.room?.recruitmentInvitations?.[mission?.recruitmentGroupId];
  return g?.source===SOURCE && g.runId===s.runId && g.roomKey===s.roomKey && g.floor===s.floor &&
    g.members.some(m=>m.missionId===mission.id && m.name===mission.recipient)?g:null;
}
function accept(state,db,mission){
  const g=linked(state,mission,db);if(!g)return false;
  if(!['review','accepted'].includes(g.status))throw Error('Wait for the group to finish explaining its conditions.');
  const tasks=g.members.filter(m=>m.outcome==='conditional').map(m=>db[g.roomKey].minorMissions?.[m.missionId]);
  if(tasks.some(m=>!m || !['offered','accepted','completed'].includes(m.status)))throw Error('The group request changed. Review its current conditions.');
  // Validate into copies first, so one invalid condition cannot partially accept the group.
  const F=require('./residentFavors'),drafts=tasks.filter(m=>m.status==='offered').map(m=>{const draft=structuredClone(m);F.accept(state,draft,{individual:true});return draft;});
  for(const draft of drafts)Object.assign(db[g.roomKey].minorMissions[draft.id],draft);
  g.status='accepted';g.acceptedAt ||= Date.now();return true;
}
function decline(state,db,mission){
  const g=linked(state,mission,db);if(!g)return false;
  if(g.status!=='review')throw Error('An accepted group request cannot be declined from the offer menu.');
  for(const member of g.members)if(member.missionId){const m=db[g.roomKey].minorMissions?.[member.missionId];
    if(m?.status==='offered'){m.status='declined';m.invitationPending=false;delete m.conditionalConsent;}}
  g.status='declined';g.declinedAt=Date.now();return true;
}
function ready(g,db){
  return g?.status==='accepted' && g.members.every(m=>m.outcome!=='pending' && !m.responsePending && (m.outcome!=='conditional' ||
    db[g.roomKey]?.minorMissions?.[m.missionId]?.status==='completed'));
}
function complete(state,db,mission){
  const g=linked(state,mission,db);if(!g)throw Error('That group invitation is unavailable.');
  if(g.status!=='accepted')throw Error('Review and accept the group request before completing the invitation.');
  const F=require('./residentFavors'),tasks=g.members.filter(m=>m.outcome==='conditional').map(m=>db[g.roomKey].minorMissions?.[m.missionId]);
  if(tasks.some(m=>!m || m.status!=='completed' && (m.status!=='accepted' || !F.assess(m,db).passed)))
    throw Error('Some agreed recruitment conditions are not verified yet. Open Recruitment Progress to review them.');
  const lines=[];let handoff=mission;
  for(const task of tasks)if(task.status!=='completed'){lines.push(F.transact(state,db,task,'report-favor'));handoff=task;}
  return {content:lines.join('\n') || 'All agreed group conditions are verified.',missionId:handoff.id};
}
function settle(state,service,group){
  const s=scope(state),g=s.room?.recruitmentInvitations?.[group.id];if(!ready(g,s.db))return '';
  const roster=JSON.parse(state.getCombatCharactersString() || '[]'),members=g.members.filter(m=>['ready','conditional'].includes(m.outcome) && !roster.some(a=>a.type==='npc'&&a.name===m.name));
  if(!members.length)return '';
  if(I.parseSheets(state.getUpdatedGameConsole(),'NPCs in Party').length+members.length>12)return 'The group is ready, but the party needs space before they can join.';
  if(members.some(m=>!roster.some(a=>a.type==='monster'&&a.name===m.name&&I.canAct(a)) ||
    s.room.inhabitants?.actors?.[m.name]?.status!=='present'))return 'The group requirements are complete; return to its surviving members to finish recruitment.';
  const F=require('./residentFavors'),lines=[];
  if(members.some(m=>F.recruitmentRefusal(state,m.name,s.db) || s.room.inhabitants.actors[m.name].recruitable===false ||
    !require('../assets/pantheonCharacters').canRecruit(roster.find(a=>a.name===m.name)) ||
    require('./questScenes').recruitmentGuard(state,`add ${m.name} to party`)))return 'A group member is no longer available for recruitment. Their current refusal or quest role is preserved.';
  for(const member of members){const task=member.missionId?s.room.minorMissions?.[member.missionId]:null;
    lines.push(F.recruit(state,service,member.name,task,member.consent));}
  const latest=scope(state),saved=latest.room.recruitmentInvitations[g.id];saved.completedAt ||= Date.now();
  state.setRoomNameDatabase(JSON.stringify(latest.db));
  console.info('[RecruitmentGroup]',JSON.stringify({phase:'recruited',id:g.id,members:members.map(m=>m.name)}));return lines.join('\n');
}
function describe(state,mission,db=database(state)){
  const g=linked(state,mission,db);if(!g)return null;
  return {id:g.id,status:g.status,members:g.members.map(member=>{const m=db[g.roomKey].minorMissions?.[member.missionId];
    return {name:member.name,outcome:member.outcome,...(m?{missionId:m.id,status:m.status,readyToReport:!!m.readyToReport,participation:m.helperOffer?'help-here':'after-task',description:m.requestDescription || m.description}:{}),...(member.line?{line:member.line}:{})};})};
}
module.exports={SOURCE,audience,collective,prepare,current,note,linked,accept,decline,ready,complete,settle,describe};
