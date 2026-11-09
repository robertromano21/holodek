'use strict';
const { randomUUID } = require('node:crypto');
const I = require('../assets/dungeonInhabitants'), Reach = require('./dungeonReach'), Groups=require('./recruitmentGroups');
const SOURCE = 'engine-resident-favor-v1';
const key = s => String(s || '').trim().toLowerCase();
const dbOf = state => JSON.parse(state.getRoomNameDatabase() || '{}');
const clock = state => dbOf(state)['0,0,0']?.spellSystem?.clock ?? Number(state.getUpdatedGameConsole().match(/^Turns:\s*(\d+)/m)?.[1] || 0);
const floorOf = state => require('./hostLocalFloors').identity(dbOf(state)[`${state.getLastCoords().x},${state.getLastCoords().y},${state.getLastCoords().z}`]?.cityFloorContext);
const all = db => Object.values(db).flatMap(r => Object.values(r?.minorMissions || {})).filter(m => m.source === SOURCE);
function recruitmentRefusal(state,name,db=dbOf(state)) {
  return Object.values(db).map(room=>room?.recruitmentDecisions?.[key(name)])
    .find(decision=>decision?.runId===state.getDungeonRunId() && decision.status==='declined') || null;
}
function refusalMessage(name) {
  return `${name} has already declined the invitation. Repeating it does not change their decision. Discuss their concerns or offer help; completing an agreed favor can reopen recruitment.`;
}
function recordRefusal(state,ctx,consent) {
  const held=recruitmentRefusal(state,ctx.actor.name,ctx.db);if(held)return held;
  const decision={...ctx.db[ctx.geoKey].recruitmentDecisions?.[key(ctx.actor.name)],id:randomUUID(),runId:state.getDungeonRunId(),actor:ctx.actor.name,status:'declined',line:consent.line,at:Date.now()};
  ctx.db[ctx.geoKey].recruitmentDecisions ||= {};ctx.db[ctx.geoKey].recruitmentDecisions[key(ctx.actor.name)]=decision;
  state.setRoomNameDatabase(JSON.stringify(ctx.db));return decision;
}
const invitationIntent=input=>require('./holodekNarration').invitationHint(input);
function favorDecision(input,mission,offered=[]) {
  const text=String(input || '').trim().replace(/[\u2018\u2019]/g,"'");
  if(!mission || mission.status!=='offered' || !text || /\bnot now\b/i.test(text))return 'none';
  const task=/\b(?:favor|request|task|study|conditions|help|work|errand|bargain)\b/i.test(text);
  if(invitationIntent(text) && !task)return 'none';
  const decline=/^(?:no[,.!\s]*(?:thanks|thank you)?[.!\s]*$|(?:i|we)\s+(?:decline|refuse)\b|decline\b)/i.test(text) ||
    task && /\b(?:i|we)\s+(?:can't|cannot|won't|will not|do not want to)\s+(?:help|accept|do|take)\b/i.test(text);
  const accept=!decline && !/\b(?:don't|do not|can't|cannot|won't|will not)\b/i.test(text) &&
    (task && /^(?:yes|okay|ok|sure|agreed|deal)\b/i.test(text) ||
    /^(?:(?:i|we)\s+(?:accept|agree)\b|accept\b|(?:i|we)(?:'ll|\s+will)\s+(?:help|do|take)\b)/i.test(text));
  if(!accept && !decline)return 'none';
  const named=offered.filter(m=>[m.recipient,m.title].some(value=>value &&
    new RegExp('(?:^|[^\\p{L}\\p{N}])'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^\\p{L}\\p{N}])','iu').test(text)));
  const shared=mission.recruitmentGroupId && offered.every(m=>m.recruitmentGroupId===mission.recruitmentGroupId);
  if(named.length ? named.length!==1 || named[0].id!==mission.id : (!shared && offered.length!==1) || offered[0]?.id!==mission.id)return 'none';
  return decline?'decline':'accept';
}
function neutralInvitation(state,ctx,{random=Math.random}={}) {
  const held=Object.values(ctx.db).map(room=>room?.recruitmentDecisions?.[key(ctx.actor.name)]).find(d=>d?.runId===state.getDungeonRunId());
  if(held)return held;
  const roll=Number(random());if(!Number.isFinite(roll) || roll<0 || roll>=1)throw Error('Invite roll must be a unit interval random value.');
  const decision={id:randomUUID(),runId:state.getDungeonRunId(),actor:ctx.actor.name,status:'pending',outcome:roll<.7?'refuse':'favor',roll,at:Date.now()};
  ctx.db[ctx.geoKey].recruitmentDecisions ||= {};ctx.db[ctx.geoKey].recruitmentDecisions[key(ctx.actor.name)]=decision;
  state.setRoomNameDatabase(JSON.stringify(ctx.db));console.info('[ResidentRecruitment]',JSON.stringify({actor:ctx.actor.name,outcome:decision.outcome,roll}));return decision;
}
const groupOf = (population,name) => population?.groups?.find(g=>g.members.includes(name))?.id || population?.actors?.[name]?.encounterId || 'resident:'+name;
const ownMission = (ctx,state) => all(ctx.db).find(m=>m.runId===state.getDungeonRunId() && m.roomKey===ctx.geoKey && m.recipient===ctx.actor.name && m.status!=='withdrawn');
function groupMission(ctx,state) {
  const groupId=groupOf(ctx.population,ctx.actor.name);
  return all(ctx.db).filter(m=>m.type==='resident-favor' && m.runId===state.getDungeonRunId() && m.roomKey===ctx.geoKey && m.floor===floorOf(state) &&
    ['offered','accepted','completed'].includes(m.status) && (m.groupId || groupOf(ctx.population,m.recipient))===groupId)
    .sort((a,b)=>(a.status==='accepted'?-1:a.status==='completed'?0:1)-(b.status==='accepted'?-1:b.status==='completed'?0:1))[0];
}
function reconcileGroupOffers(db) {
  const groups=new Map(),notices=[];
  for(const m of all(db).filter(m=>m.type==='resident-favor' && !m.recruitmentGroupId && ['offered','accepted','completed'].includes(m.status))) {
    const id=JSON.stringify([m.runId,m.roomKey,m.floor,m.groupId || groupOf(db[m.roomKey]?.inhabitants,m.recipient)]);
    const rows=groups.get(id)||[];rows.push(m);groups.set(id,rows);
  }
  for(const rows of groups.values()) {
    const keep=rows.find(m=>m.status==='accepted') || rows.find(m=>m.status==='completed') || rows[0];
    for(const m of rows)if(m!==keep && m.status==='offered') {
      m.status='withdrawn';m.supersededBy=keep.id;m.progress=`The group already has a favor with ${keep.recipient}: ${keep.title}. This duplicate offer was withdrawn; no accepted progress was changed.`;
      notices.push(m.progress);
    }
  }
  return notices;
}
const helpIntent = input => /^(?:help|assist)\b|\b(?:how|what)\b[\s\S]*\b(?:help|assist|do for|need done)\b|\b(?:offer|let (?:me|us))\b[\s\S]*\b(?:help|assist)\b|\b(?:any|have you|got any)\b[\s\S]*\b(?:jobs?|work|tasks?|errands?)\b/i.test(input);
function result(state, content) {
  return { content, actionOnly: true, updatedGameConsole: state.getUpdatedGameConsole(),
    roomNameDatabaseString: state.getRoomNameDatabase(), combatCharactersString: state.getCombatCharactersString() };
}
function nearby(state, name, { contract = false } = {}) {
  const coords = state.getLastCoords(), geoKey = `${coords.x},${coords.y},${coords.z}`;
  const roster = JSON.parse(state.getCombatCharactersString() || '[]'), db = dbOf(state);
  const actor = roster.find(a => (a.type === 'monster' || contract&&a.type==='npc'&&a.recruitmentLease) && key(a.name) === key(name));
  const population = state.getRoomPopulation?.(geoKey) || db[geoKey]?.inhabitants, record = population?.actors?.[actor?.name];
  const pc = roster.find(a => a.type === 'pc' && (a.hp ?? 1) > 0), dungeon = state.getRoomDungeonForSimulation?.(coords);
  const player = Reach.position(pc, geoKey);
  const ctx={actor,record,roster,population,pc,dungeon,geoKey,db};
  const held=actor && contract && ownMission(ctx,state);
  const knownContract=held && held.floor===floorOf(state) && ['offered','accepted','completed','declined'].includes(held.status);
  const reach=!knownContract && actor && player && I.dialogueReach(dungeon,actor,player,{conversation:true});
  if (!actor || !record || record.status !== 'present' && !(contract&&actor.recruitmentLease&&record.status==='recruited') || !I.canAct(actor) || !I.canAct(record) || record.allegiance === 'Hostile' || actor.discoveryState === 'pending' ||
      !pc || !player || !I.isPresent(actor,population) || !I.hasEncountered(actor, population) || I.allegiance(actor) === 'Hostile' ||
      !knownContract && (!reach?.canSpeak || !reach.lineOfSight))
    throw Error(`Move close to ${name} in their room for this conversation.`);
  return ctx;
}
function candidates(state, ctx) {
  const room = ctx.db[ctx.geoKey], protectedNames = new Set((state.getCurrentTasks?.() || []).flatMap(t => t.requiredElements || []).map(e => key(e.name)));
  const choices = [];
  choices.push({id:'conversation',kind:'conversation',roomKey:ctx.geoKey,roomName:room.name,participant:ctx.actor.name});
  const Readables=require('../assets/readableItems');
  for(const record of [...(room.readables || []),...(room.inscriptions || [])])if(record.id && !record.bookLore?.pending && Readables.hasContent(record)){
    for(const [index,chapter]of (record.chapters || []).entries())if(chapter.text?.trim() && !require('./bookResearch').reading(ctx.db,
      {coords:ctx.geoKey,bookId:record.id,value:record.name,chapter:index+1}).passed)
      choices.push({id:'read:'+record.id+':'+(index+1),kind:'read',roomKey:ctx.geoKey,roomName:room.name,
        readableId:record.id,item:record.name,chapter:index+1,chapterTitle:chapter.title});
  }
  const puzzle=room.puzzleMechanism;
  if(puzzle?.id && puzzle.state?.status!=='complete' && require('../assets/physicalPuzzles').validState(puzzle,puzzle.state))
    choices.push({id:'puzzle:'+puzzle.id,kind:'puzzle',mechanismId:puzzle.id,roomKey:ctx.geoKey,roomName:room.name});
  const inventory=require('../assets/inventoryUi').parseProperties(state.getUpdatedGameConsole().match(/^Inventory Properties:[ \t]*(.*)$/m)?.[1] || ''),seen=new Set();
  for (const item of [...(room.objects || []),...inventory]) if (item.name && !seen.has(key(item.name)) && !protectedNames.has(key(item.name)) && !item.minor_mission_id &&
      !require('./residentTaskPlan').RETIRED.test(item.name) && !require('./economy').protectedItem(state, ctx.db, item) && !item.quest_artifact && !item.currency_kind){
    seen.add(key(item.name));const book=(room.readables || []).find(r=>key(r.name)===key(item.name) && r.kind==='book' && !r.bookLore?.pending && Readables.hasContent(r));
    choices.push({ id: 'retrieve:'+choices.length, kind: 'retrieve', item: item.name, roomKey: ctx.geoKey, roomName: room.name,
      ...(item.secretDoorId?{secretDoorId:item.secretDoorId}:{}),...(book?{readableId:book.id}: {}) });
  }
  for (const actor of ctx.roster) if (actor.type === 'monster' && actor.hp > 0 && I.allegiance(actor) === 'Hostile' &&
      !protectedNames.has(key(actor.name)) && I.hasEncountered(actor, ctx.population) &&
      !require('./questDefeatEvidence').evidence(ctx.db, ctx.geoKey, actor.name) && !room.bossGate)
    choices.push({ id: 'defeat:'+choices.length, kind: 'defeat', target: actor.name, roomKey: ctx.geoKey, roomName: room.name });
  return choices;
}
function eligible(state, ctx, {favor=true,groupRecruitment=false}={}) {
  if (favor && require('../assets/economyRules').isStarterRoom(ctx.geoKey,ctx.db[ctx.geoKey]) &&
      !(require('./cotgStarterRecruitment').active(ctx.geoKey,ctx.db[ctx.geoKey],ctx.db) && (ctx.population?.starterRecruitment?.favorActor===ctx.actor.name || groupRecruitment))) return false;
  if (!require('../assets/pantheonCharacters').canRecruit(ctx.actor) || ctx.record.recruitable === false || ctx.record.deityId) return false;
  return !require('./questScenes').recruitmentGuard(state, `add ${ctx.actor.name} to party`);
}
function objectiveText(objective, name) {
  const completion=objective.kind==='conversation'?`Speak naturally with ${name}.`:objective.kind==='read'?`Read "${objective.item}", chapter ${objective.chapter}.`:
    objective.kind==='retrieve'?`Give ${objective.item} to ${name}.`:objective.kind==='puzzle'?`Solve the existing puzzle in ${objective.roomName}.`:
    objective.kind==='defeat'?`Defeat ${objective.target}.`:'This older request needs to be replaced. Invite this resident again.';
  return objective.planVersion===1 && !require('./residentTaskPlan').RETIRED.test(objective.instruction || '')?`${objective.instruction}\nCompletion: ${completion}`:completion;
}
const conditionsOf=m=>m.conditions?.length?m.conditions:[m.objective];
const conditionsText=(list,name)=>list.map(o=>objectiveText(o,name)).join(' Also: ');
function authoredConditions(event,option) {
  if(event.taskPlan)return require('./residentTaskPlan').parse(event.taskPlan,option.candidates,{primary:option.taskPrimaryKind});
  const rows=event.conditions?.length?event.conditions:[{objectiveId:event.favorObjectiveId}];
  if(rows.length<1 || rows.length>3 || new Set(rows.map(r=>r.objectiveId)).size!==rows.length)throw Error('Choose one to three distinct engine-supported conditions.');
  return rows.map(row=>{
    const bound=option.candidates.find(c=>c.id===row.objectiveId);if(!bound)throw Error('The condition does not name a verified target.');
    if(bound.kind==='conversation')return {...bound,focus:event.favorFocus};
    return {...bound};
  });
}
function conditionParameter(choices,optional=false) {
  const C=require('./generationContracts');
  return {type:[{type:{objectiveId:C.choice(choices.length?choices.map(c=>c.id):[''])}}],minItems:optional?0:1,maxItems:3};
}
function participation(mission){
  return mission.helperOffer?`${mission.recipient} will help here after you accept. Finish the agreed work to remain together; if you leave this room first, they stay behind.`:
    mission.invitationPending?`${mission.recipient} will join after the agreed requirements are complete.`:`${mission.recipient} can join if invited after completion.`;
}
function bindInvitation(mission,consent) {
  if(!consent?.playerInvited)return;
  mission.invitationPending=true;mission.conditionalConsent=consent;
  if(mission.objective){mission.requestDescription=`${mission.title}: ${conditionsText(conditionsOf(mission),mission.recipient)}`;
    mission.description=`${mission.requestDescription} ${participation(mission)}`;}
}
function storeOffer(state,ctx,draft,objective,population,consent=null) {
  if(draft.joinTiming==='help-here' && (!draft.departureLine?.trim() || (draft.conditions || [objective]).some(o=>o.kind==='conversation')))
    throw Error('A room-local helper needs a physical task and an authored farewell.');
  const recruitment=consent?.playerInvited && Groups.current(state,ctx.actor.name,ctx.db);
  const held=groupMission(ctx,state);if(!recruitment && held && held.recipient!==ctx.actor.name)throw Error(`This group already has a favor with ${held.recipient}: ${held.title}.`);
  const existing=ownMission(ctx,state);
  if(existing) {
    if(existing.status==='declined')existing.status='offered';
    bindInvitation(existing,consent);
    state.setRoomNameDatabase(JSON.stringify(ctx.db));return existing;
  }
  const name=ctx.actor.name,id='favor:'+randomUUID(),mission={id,source:SOURCE,type:'resident-favor',runId:state.getDungeonRunId(),floor:floorOf(state),
    status:'offered',offeredAt:Date.now(),title:draft.title.trim(),offer:draft.offer.trim(),objective,recipient:name,originalRecipient:name,
    roomKey:ctx.geoKey,roomName:ctx.db[ctx.geoKey].name,groupId:groupOf(ctx.population,name),reward:{type:'recruitment',actor:name},rewardSilver:0,escrowSilver:0,escrowItems:[],
    conditions:draft.conditions || [objective],invitationPending:!!consent?.playerInvited,...(consent?{conditionalConsent:consent}:{}),
    ...(consent?.playerInvited && draft.joinTiming==='help-here'?{helperOffer:{source:require('./recruitmentProgress').SOURCE,line:draft.departureLine}}:{}),
    ...(recruitment?{recruitmentGroupId:recruitment.id}:{}),
    ...(require('./cotgStarterRecruitment').active(ctx.geoKey,ctx.db[ctx.geoKey],ctx.db) && (ctx.population?.starterRecruitment?.favorActor===name || recruitment)?{starterRecruitment:true}:{})};
  mission.requestDescription=`${mission.title}: ${conditionsText(mission.conditions,name)}`;
  mission.description=`${mission.requestDescription} ${participation(mission)}`;
  ctx.db[ctx.geoKey].minorMissions ||= {};ctx.db[ctx.geoKey].minorMissions[id]=mission;
  const decision=ctx.db[ctx.geoKey].recruitmentDecisions?.[key(name)];
  if(decision?.runId===state.getDungeonRunId() && decision.status==='pending' && decision.outcome==='favor') {
    decision.status='conditional';decision.missionId=id;
  }
  const record=population?.actors?.[name] || ctx.record;record.minorMissionId=id;record.servicesAcceptedAt ||= Date.now();ctx.population.actors[name]=record;
  ctx.population.serviceProviders=[...new Set([...(ctx.population.serviceProviders || []),name])];ctx.db[ctx.geoKey].inhabitants=ctx.population;
  state.setRoomNameDatabase(JSON.stringify(ctx.db));state.setRoomPopulation?.(ctx.geoKey,ctx.population);state.emitter?.emit('quest:minorMission');
  console.info('[ResidentFavor]',JSON.stringify({phase:'offered',id,actor:name,objective,taskKinds:mission.conditions.map(c=>c.kind),planVersion:objective.planVersion || 0,origin:consent?'live-dialogue':'help-request'}));return mission;
}
function recruit(state,service,name,mission=null,consent=null,{provisional=false}={}) {
  const roster=JSON.parse(state.getCombatCharactersString() || '[]');
  if(roster.some(a=>a.type==='npc' && key(a.name)===key(name)))return `${name} has already joined the party.`;
  const ctx=nearby(state,name,{contract:true});
  if(!eligible(state,ctx,{favor:false}))throw Error('This resident cannot join through a conversation.');
  if(recruitmentRefusal(state,name,ctx.db))throw Error(refusalMessage(name));
  mission=mission?ctx.db[ctx.geoKey]?.minorMissions?.[mission.id]:ownMission(ctx,state);
  if(provisional && !(mission?.status==='accepted' && mission.invitationPending && mission.helperOffer?.source===require('./recruitmentProgress').SOURCE &&
    mission.helperOffer.line?.trim() && mission.conditionalConsent?.playerInvited))throw Error('A local helper needs an accepted, authored invitation.');
  const group=Groups.current(state,name,ctx.db);
  if(group && !Groups.ready(group,ctx.db) && !(provisional&&group.status==='accepted'))throw Error('The group invitation waits for approval and verification of every agreed condition.');
  if(!mission && require('./cotgStarterRecruitment').active(ctx.geoKey,ctx.db[ctx.geoKey],ctx.db) && ctx.population?.starterRecruitment?.favorActor===name)
    throw Error('This resident has a local recruitment favor to discuss before joining.');
  if(I.allegiance(ctx.record)==='Neutral' && !mission)throw Error('A neutral resident must agree to a favor and verify its completion before joining.');
  if(mission && mission.status!=='completed'&&!provisional)throw Error(`${name}'s invitation is conditional on completing their request. ${mission.description} Status: ${mission.status}. Use Recruitment Progress to review the conditions.`);
  if(!mission && !consent?.playerInvited)throw Error('Joining requires an invitation and the resident’s actual consent.');
  if(I.parseSheets(state.getUpdatedGameConsole(),'NPCs in Party').length>=12)throw Error('The party is full. The resident can join after you make room.');
  let text=state.getUpdatedGameConsole();const sheet=I.parseSheets(text).find(a=>a.name===name);if(!sheet)throw Error('The resident character sheet could not be verified.');
  if(!mission){mission={id:'consent:'+randomUUID(),source:SOURCE,type:'resident-consent',runId:state.getDungeonRunId(),floor:floorOf(state),
    roomKey:ctx.geoKey,roomName:ctx.db[ctx.geoKey].name,recipient:name,originalRecipient:name,status:'completed',title:'Invitation accepted',
    description:`${name} accepted your invitation in conversation.`,reward:{type:'recruitment',actor:name},rewardReceiptId:randomUUID(),consent};}
  ctx.record.status='recruited';ctx.record.allegiance='Friendly';ctx.actor.type='npc';ctx.actor.state='Friendly';
  const block=sheet.rawSheet.replace(/^[ \t]*State:[^\r\n]*/m,'State: Friendly');
  text=text.replace(I.sectionPattern('NPCs in Party'),(_,head,body)=>head+'\n'+(/^\s*None\s*$/i.test(body)?'':body.trim()+'\n')+block+'\n');
  text=text.replace(I.sectionPattern('Monsters in Room'),(_,head,body)=>head+'\n'+(body.replace(sheet.rawSheet,'').trim() || 'None')+'\n');
  if(provisional){mission.provisionalJoinedAt=Date.now();mission.progress=`${name} is helping in this room until the agreed task is finished.`;
    ctx.actor.recruitmentLease={id:randomUUID(),source:require('./recruitmentProgress').SOURCE,runId:mission.runId,roomKey:ctx.geoKey,floor:mission.floor,
      ref:ctx.db[ctx.geoKey].cityFloorContext || null,missionId:mission.id,departureLine:mission.helperOffer.line,
      position:{...ctx.record.position},home:{...ctx.record.home}};
  }else{mission.recruitedAt=Date.now();mission.progress=`${name} has joined the party.`;}
  if(consent)mission.consent=consent;ctx.db[ctx.geoKey].minorMissions ||= {};ctx.db[ctx.geoKey].minorMissions[mission.id]=mission;ctx.db[ctx.geoKey].inhabitants=ctx.population;
  state.setRoomNameDatabase(JSON.stringify(ctx.db));state.setUpdatedGameConsole(text);state.setCombatCharactersString(JSON.stringify(ctx.roster));
  service?.save(ctx.population);require('./economy').refresh(state);
  console.info('[ResidentFavor]',JSON.stringify({phase:'recruited',id:mission.id,actor:name,origin:consent?'live-dialogue':'invitation-command'}));
  return `${name} joins the party. Their identity, equipment and abilities are preserved.`;
}
function dialogueOptions(state,names,{invitation=false,userInput,random=Math.random}={}) {
  const options=[],offerGroups=new Set();
  const invitationRequested=invitation || invitationIntent(userInput);
  if(invitationRequested)Groups.prepare(state,names.filter(name=>{try{return nearby(state,name,{contract:true}).actor.type==='monster';}catch{return false;}}));
  const contextual=userInput!==undefined || invitation;
  const db=dbOf(state),coords=state.getLastCoords(),geoKey=`${coords.x},${coords.y},${coords.z}`,floor=require('./hostLocalFloors').identity(db[geoKey]?.cityFloorContext);
  const offered=all(db).filter(m=>m.type==='resident-favor' && m.runId===state.getDungeonRunId() &&
    m.roomKey===geoKey && m.floor===floor &&
    m.status==='offered' && names.includes(m.recipient));
  for(const name of names){try{
    const ctx=nearby(state,name,{contract:true});if(ctx.actor.type!=='monster')continue;
    if(!eligible(state,ctx,{favor:false})){
      const recruitment=Groups.current(state,name,ctx.db),member=recruitment?.members.find(m=>m.name===name);
      if(invitationRequested && (member?.outcome==='staying' || ctx.record.starterRecruitmentRole==='guardian' || ctx.record.recruitable===false))
        options.push({name,actions:['explain-staying'],staying:true,invitationRequested:true,userInput,playerFavorDecision:'none',
          ...(recruitment?{recruitmentGroupId:recruitment.id}:{}),groupId:groupOf(ctx.population,name),candidates:[],contract:null,
          stayingReason:{role:ctx.record.starterRecruitmentRole,job:ctx.record.job,motivation:ctx.record.motivation,previousReply:member?.line},
          scope:{runId:state.getDungeonRunId(),geoKey:ctx.geoKey,floor:require('./hostLocalFloors').token(state)}});
      continue;
    }
    const recruitment=Groups.current(state,name,ctx.db);
    const favorAllowed=eligible(state,ctx,{groupRecruitment:!!recruitment && invitationRequested});
    const mission=ownMission(ctx,state),group=groupMission(ctx,state),groupId=groupOf(ctx.population,name);
    const starterFavor=!mission && !recruitmentRefusal(state,name,ctx.db) && require('./cotgStarterRecruitment').active(ctx.geoKey,ctx.db[ctx.geoKey],ctx.db) && ctx.population?.starterRecruitment?.favorActor===name;
    let actions=['none',...(!contextual || invitationRequested || mission?.invitationPending?['decline-invitation']:[])];
    if((!contextual || invitationRequested || helpIntent(userInput) || mission?.invitationPending) && favorAllowed &&
      (recruitment && invitationRequested || (!group || group.recipient===name) && !offerGroups.has(groupId)) &&
      (!mission || ['offered','declined'].includes(mission.status)))actions.push('offer-favor');
    if(mission)actions.push('discuss-favor');
    else if(group)actions.push('discuss-favor');
    const playerFavorDecision=favorDecision(userInput,mission,offered);
    if(mission?.status==='offered') {
      if(playerFavorDecision==='accept' && (recruitment || !group || group.id===mission.id))actions.push('accept-favor');
      if(playerFavorDecision==='decline')actions.push('decline-favor');
    }
    if(mission?.status==='accepted' && assess(mission,ctx.db).passed)actions.push('complete-favor');
    const conversationConditions=mission && ['offered','accepted'].includes(mission.status) && userInput?.trim() &&
      !invitationRequested && playerFavorDecision!=='decline' && !/^Approach\b|\bnot now\b/i.test(userInput) ?
      conditionsOf(mission).filter(o=>o.kind==='conversation' && !assessObjective(mission,o,ctx.db).passed).map(o=>({id:o.id,focus:o.focus,
        ...(o.successCriteria?{successCriteria:o.successCriteria,exchange:o.exchange}:{})})):[];
    if(conversationConditions.length)actions.push('fulfill-conversation');
    const refusal=recruitmentRefusal(state,name,ctx.db);
    const neutral=I.allegiance(ctx.record)==='Neutral';
    if((!contextual || invitationRequested || mission?.invitationPending) && !refusal && (!neutral || mission?.status==='completed') && (!mission || mission.status==='completed') && I.parseSheets(state.getUpdatedGameConsole(),'NPCs in Party').length<12)actions.push('accept-invitation');
    const decision=neutral && invitationRequested && !mission && (!group || recruitment) && !refusal ? neutralInvitation(state,ctx,{random}) :
      Object.values(ctx.db).map(room=>room?.recruitmentDecisions?.[key(name)]).find(d=>d?.runId===state.getDungeonRunId());
    if(decision?.status==='pending' && decision.outcome==='refuse')actions=actions.filter(a=>['none','decline-invitation'].includes(a));
    if(decision?.status==='pending' && decision.outcome==='favor')actions=actions.includes('offer-favor')?['none','offer-favor']:['none','decline-invitation'];
    if(invitationRequested && refusal)actions=actions.filter(a=>a!=='offer-favor');
    if(starterFavor)actions=!contextual || invitationRequested?['none','offer-favor']:['none'];
    if(actions.includes('offer-favor'))offerGroups.add(groupId);
    options.push({name,actions,groupId,...(recruitment?{recruitmentGroupId:recruitment.id}:{}),userInput,playerFavorDecision,invitationRequested,conversationConditions,conversationMissionId:conversationConditions.length?mission.id:null,...(starterFavor?{starterFavor:true}:{}),groupContract:group?{actor:group.recipient,title:group.title,status:group.status,description:group.description}:null,
      neutralOutcome:decision?.status==='pending'?(actions.includes('offer-favor')?decision.outcome:'refuse'):null,
      refusal:refusal?{line:refusal.line,message:refusalMessage(name)}:null,
      candidates:favorAllowed?candidates(state,ctx):[],contract:context(state,[name])[0] || null,
      scope:{runId:state.getDungeonRunId(),geoKey:ctx.geoKey,floor:require('./hostLocalFloors').token(state)}});
  }catch{}}
  return options;
}
function applyDialogue(state,service,event,option) {
  const action=event.socialAction || 'none';if(action==='none')return null;
  if(!option || event.speaker!==option.name || event.recipient!=='PC' || !event.line?.trim())throw Error('A social action needs the actual resident’s live reply to the player.');
  const coords=state.getLastCoords();if(option.scope.runId!==state.getDungeonRunId() || option.scope.geoKey!==`${coords.x},${coords.y},${coords.z}` ||
    option.scope.floor!==require('./hostLocalFloors').token(state) || state.getGamePaused?.())throw Error('The conversation changed before this reply finished.');
  const current=dialogueOptions(state,[event.speaker],{userInput:option.userInput,invitation:option.invitationRequested})[0];if(!option.actions.includes(action) || !current?.actions.includes(action))throw Error('That social action is not available for this resident now.');
  if((action==='accept-favor' && option.playerFavorDecision!=='accept') || (action==='decline-favor' && option.playerFavorDecision!=='decline'))
    throw Error('Only the player can accept or decline the recruitment request.');
  const ctx=nearby(state,event.speaker,{contract:true}),consent={speaker:event.speaker,line:event.line,playerInvited:event.playerInvited===true,at:Date.now(),source:'engine-live-dialogue-v1'};
  let mission=ownMission(ctx,state),content;
  if(action==='explain-staying'){
    if(!current.staying || !option.invitationRequested)throw Error('Only an invited stay-behind resident can explain this decision.');
    content=`${event.speaker} remains here.`;
  }else if(action==='accept-invitation'){
    if(!consent.playerInvited && !mission?.invitationPending)throw Error('The player has not invited this resident.');
    content=option.recruitmentGroupId?`${event.speaker} agrees to accompany the group once its shared conditions are approved and verified.`:recruit(state,service,event.speaker,mission,consent);
  }else if(action==='offer-favor'){
    const conditions=mission?conditionsOf(mission):authoredConditions(event,option);
    if(!mission && (!event.favorTitle?.trim() || !event.taskPlan&&!event.favorFocus?.trim()))throw Error('A conditional invitation must select a concrete verified favor.');
    mission=storeOffer(state,ctx,{title:event.favorTitle || mission.title,offer:event.line,conditions,joinTiming:event.joinTiming,departureLine:event.departureLine},conditions[0],ctx.population,consent);
    content=`${mission.invitationPending?'Recruitment Invitation':'Local Request'} (${mission.status}): ${mission.invitationPending?mission.description:requestDescription(mission)} Review the request and choose whether to accept it.`;
  }else if(action==='accept-favor'){
    if(!Groups.accept(state,ctx.db,mission))accept(state,mission);bindInvitation(mission,consent);state.setRoomNameDatabase(JSON.stringify(ctx.db));require('./economy').refresh(state);
    content=`Request accepted: ${mission.description}`;
    content+='\n'+settleConsent(state,service,mission.id);
  }else if(action==='fulfill-conversation'){
    if(mission.id!==option.conversationMissionId)throw Error('The conversational request changed before this reply finished.');
    const proofs=conversationProof(event,option);
    content=commitConversation(state,service,ctx,mission,proofs,option.userInput).content;
  }else if(['complete-favor','report-favor','decline-favor'].includes(action)){
    content=transact(state,ctx.db,mission,action);state.setRoomNameDatabase(JSON.stringify(ctx.db));require('./economy').refresh(state);
    if(action!=='decline-favor' && (mission.invitationPending || consent.playerInvited)) {
      content+='\n'+settleConsent(state,service,mission.id);
    }
  }else if(action==='discuss-favor'){
    if(!mission){const shared=groupMission(ctx,state);if(!shared)throw Error('The group has no current favor.');
      content=`Group favor with ${shared.recipient}: ${shared.description}`;
    }else{
    if(consent.playerInvited){bindInvitation(mission,consent);state.setRoomNameDatabase(JSON.stringify(ctx.db));}
    content=mission.description+'\n'+(mission.progress || 'The favor has not been accepted.');
    }
  }else {
    if(consent.playerInvited || mission?.invitationPending) {
      if(mission){mission.invitationPending=false;delete mission.conditionalConsent;}
      recordRefusal(state,ctx,consent);state.setRoomNameDatabase(JSON.stringify(ctx.db));
    }
    content=`${event.speaker} declines the invitation and remains here.`;
  }
  if(option.recruitmentGroupId && option.invitationRequested){
    const group=Groups.note(state,event.speaker,event,mission);
    if(group?.status==='accepted')content+='\n'+Groups.settle(state,service,group);
  }
  console.info('[ResidentDialogueAction]',JSON.stringify({action,speaker:event.speaker,missionId:mission?.id || null,playerFavorDecision:option.playerFavorDecision || 'none'}));
  return {action,content,actor:event.speaker};
}
function conversationParameter(option){
  const C=require('./generationContracts');
  return {type:[{type:{conditionId:C.choice(option.conversationConditions.map(c=>c.id)),excerpt:{type:String}}}],minItems:0,maxItems:option.conversationConditions.length};
}
function conversationProof(event,option){
  const proofs=event.conversationEvidence,input=String(option.userInput || '');
  if(!Array.isArray(proofs) || !proofs.length || new Set(proofs.map(p=>p.conditionId)).size!==proofs.length ||
    proofs.some(p=>!option.conversationConditions?.some(c=>c.id===p.conditionId) || typeof p.excerpt!=='string' ||
      !p.excerpt.trim() || !input.includes(p.excerpt)))throw Error('Conversational completion needs an exact passage from the current player reply and its actual conversation condition.');
  return proofs;
}
function commitConversation(state,service,ctx,mission,proofs,userInput){
  if(mission.status==='offered' && !Groups.accept(state,ctx.db,mission))accept(state,mission);
  mission.conversationEvidence ||= [];
  for(const proof of proofs)mission.conversationEvidence.push({id:randomUUID(),source:'engine-conversation-evidence-v1',
    runId:mission.runId,roomKey:ctx.geoKey,floor:mission.floor,recipient:mission.recipient,conditionId:proof.conditionId,
    playerInput:userInput,excerpt:proof.excerpt,...(proof.reason?{adjudication:proof.reason}:{}),at:Date.now()});
  refresh(state,ctx.db);
  let content=mission.progress;
  if(assess(mission,ctx.db).passed)content=transact(state,ctx.db,mission,'report-favor');
  state.setRoomNameDatabase(JSON.stringify(ctx.db));require('./economy').refresh(state);
  if(mission.status==='completed' && mission.invitationPending){
    content+='\n'+settleConsent(state,service,mission.id);
  }
  const saved=all(dbOf(state)).find(m=>m.id===mission.id) || mission;
  return {action:'fulfill-conversation',actor:mission.recipient,missionId:mission.id,status:saved.status,recruited:!!saved.recruitedAt,content};
}
function adjudicateConversation(state,service,{userInput,judgments}){
  const Adjudication=require('./conversationAdjudication'),coords=state.getLastCoords(),geoKey=`${coords.x},${coords.y},${coords.z}`;
  if(!judgments?.length || new Set(judgments.map(j=>j.option?.conversationMissionId)).size!==judgments.length)throw Error('A conversation check must identify each actual request once.');
  // Preflight all verdicts before any completion or recruitment is committed.
  for(const {option,decisions}of judgments){
    if(!option || option.userInput!==userInput || option.scope.runId!==state.getDungeonRunId() || option.scope.geoKey!==geoKey ||
      option.scope.floor!==require('./hostLocalFloors').token(state) || state.getGamePaused?.())throw Error('The conversation changed before adjudication finished.');
    const current=dialogueOptions(state,[option.name],{userInput})[0];
    if(!current?.actions.includes('fulfill-conversation') || current.conversationMissionId!==option.conversationMissionId ||
      JSON.stringify(current.conversationConditions)!==JSON.stringify(option.conversationConditions))throw Error('The conversational request changed before adjudication finished.');
    if(!Array.isArray(decisions) || decisions.length!==option.conversationConditions.length || new Set(decisions.map(d=>d.conditionId)).size!==decisions.length ||
      decisions.some(d=>!option.conversationConditions.some(c=>c.id===d.conditionId) || !Adjudication.VERDICTS.includes(d.verdict) ||
        typeof d.reason!=='string' || !d.reason.trim() || /\[\[|\]\]/.test(d.reason) || typeof d.excerpt!=='string' ||
        (d.verdict!=='fulfilled'&&!!d.excerpt)))throw Error('Every conversation condition needs a valid verdict.');
    const proofs=decisions.filter(d=>d.verdict==='fulfilled');if(proofs.length)conversationProof({conversationEvidence:proofs},option);
  }
  const outcomes=[];
  for(const {option,decisions}of judgments){
    const ctx=nearby(state,option.name,{contract:true}),mission=ownMission(ctx,state),proofs=decisions.filter(d=>d.verdict==='fulfilled');
    const outcome=proofs.length?commitConversation(state,service,ctx,mission,proofs,userInput):
      {action:'conversation-adjudicated',actor:option.name,missionId:mission.id,status:mission.status,recruited:false,
        content:decisions.every(d=>d.verdict==='not_addressed')?'':`${mission.title}: ${decisions.map(d=>d.reason).join(' ')}`};
    outcome.decisions=decisions;outcomes.push(outcome);
    console.info('[ConversationAdjudication]',JSON.stringify({phase:'committed',runId:state.getDungeonRunId(),geoKey,
      actor:option.name,missionId:mission.id,status:outcome.status,recruited:outcome.recruited,decisions}));
  }
  const committed=all(dbOf(state));
  for(const outcome of outcomes){const mission=committed.find(m=>m.id===outcome.missionId);if(mission){outcome.status=mission.status;outcome.recruited=!!mission.recruitedAt;}}
  return {outcomes,updatedGameConsole:state.getUpdatedGameConsole(),localFavors:context(state,judgments.map(j=>j.option.name))};
}
function settleConsent(state,service,missionId) {
  const mission=all(dbOf(state)).find(m=>m.id===missionId);
  const group=Groups.linked(state,mission);
  if(group){try{
    const joined=group.members.filter(m=>m.missionId).map(m=>all(dbOf(state)).find(task=>task.id===m.missionId)).filter(Boolean)
      .map(m=>require('./recruitmentProgress').start(state,service,m)).filter(Boolean);
    return [...joined,Groups.settle(state,service,group)].filter(Boolean).join('\n');
  }catch(error){return error.message;}}
  if(mission?.status==='accepted'&&mission.helperOffer){try{return require('./recruitmentProgress').start(state,service,mission);}catch(error){return error.message;}}
  if(!mission || mission.status!=='completed' || !mission.invitationPending || mission.recruitedAt)return '';
  try{return recruit(state,service,mission.recipient,mission,mission.conditionalConsent || null);}catch(error){return error.message;}
}
async function prepare(state, $, input, { audibleNames = [], responseAudience, population, author } = {}) {
  if (!helpIntent(input) || invitationIntent(input) || state.getGamePaused?.()) return [];
  const runId = state.getDungeonRunId(), coords = state.getLastCoords(), geoKey = `${coords.x},${coords.y},${coords.z}`;
  const floor = require('./hostLocalFloors').token(state), names = audibleNames.filter(n => !responseAudience?.directed || responseAudience.responders.includes(n));
  const offers = [];
  for (const name of names) {
    if (offers.length >= 2) break;
    let ctx; try { ctx = nearby(state, name); if (!eligible(state, ctx)) continue; } catch { continue; }
    const held=groupMission(ctx,state);if(held && held.recipient!==name)continue;
    const existing = ownMission(ctx,state);
    if (existing) {
      if (existing.status === 'declined') { existing.status='offered'; state.setRoomNameDatabase(JSON.stringify(ctx.db)); }
      offers.push(existing); continue;
    }
    const Plan=require('./residentTaskPlan'),selection=Plan.select(candidates(state,ctx),{seed:[runId,geoKey,floor,name].join('|')}),choices=selection.choices,C = require('./generationContracts');
    if(!selection.primary)continue;
    const brief = `Construct a coherent side mission for this existing resident from their actual conversation, work and motives. ${Plan.RULES} Prefer relevant conditions over arbitrary chores. Offer to join after verified completion and an invitation. Do not accept for the player, declare completion, spawn objects or change allegiance. Player input: ${JSON.stringify(input)}. Resident: ${JSON.stringify({name,job:ctx.record.job,activity:ctx.record.activity,motivation:ctx.record.motivation,history:ctx.record.profile?.history,previous:ctx.record.dialogue?.slice(-3)})}. Available task kinds and targets: ${JSON.stringify(Plan.catalog(choices))}. ${require('./graveMasterStoryPrompts').settingOnce({})}`;
    let draft;
    try {
      draft = await (author || ((brief, choices) => require('./holodekRoomWork').request($, 'resident-favor', {
        title: C.text(), taskPlan:Plan.parameter(choices,{primary:selection.primary}), offer: C.text()
      }, brief)))(brief, choices);
      if (!draft || !draft.title?.trim() || !draft.offer?.trim() ||
          [draft.title,draft.offer].some(v => typeof v !== 'string' || /\[\[|\]\]/.test(v))) throw Error('The favor did not select a grounded objective.');
      draft.conditions=authoredConditions({taskPlan:draft.taskPlan,conditions:draft.conditions,favorObjectiveId:draft.objectiveId,favorFocus:draft.focus},{candidates:choices,taskPrimaryKind:selection.primary});
    } catch (error) { console.warn('[ResidentFavor]', JSON.stringify({phase:'authoring-failed',actor:name,error:error.message}));
      offers.errors ||= []; offers.errors.push(`A verifiable favor for ${name} could not be prepared. Ask again; no task was accepted or promised.`); continue; }
    const now = state.getLastCoords();
    if (state.getDungeonRunId() !== runId || `${now.x},${now.y},${now.z}` !== geoKey || require('./hostLocalFloors').token(state) !== floor || state.getGamePaused?.()) continue;
    try { ctx = nearby(state, name); if (!eligible(state, ctx)) continue; } catch { continue; }
    const objective = draft.conditions[0];
    offers.push(storeOffer(state,ctx,draft,objective,population));
  }
  return offers;
}
function accept(state, mission, {individual=false}={}) {
  if (mission.runId !== state.getDungeonRunId()) throw Error('That favor belongs to another adventure.');
  if (mission.floor !== floorOf(state)) throw Error('Return to the floor where this favor was offered.');
  const held=groupMission(nearby(state,mission.recipient,{contract:true}),state);
  if(!individual && !mission.recruitmentGroupId && held && held.id!==mission.id)throw Error(`This group already has a favor with ${held.recipient}: ${held.title}.`);
  if (conditionsOf(mission).some(o=>o.kind === 'defeat' && require('./questDefeatEvidence').evidence(dbOf(state),o.roomKey,o.target)))
    throw Error('That opponent was already defeated before this favor was accepted.');
  mission.acceptedAt = Date.now(); mission.acceptedClock = clock(state);
  mission.priorTransferIds=(dbOf(state)[mission.roomKey]?.itemTransfers || []).map(r=>r.id);
  mission.status = 'accepted'; mission.progress = 'Objective accepted; no work verified yet.';
}
function context(state, names) {
  return all(dbOf(state)).filter(m=>m.runId===state.getDungeonRunId() && m.status!=='withdrawn' && names.includes(m.recipient)).map(m=>({
    title:m.title,actor:m.recipient,status:m.status,description:m.invitationPending?m.description:requestDescription(m),
    ...(!require('./residentTaskPlan').RETIRED.test(m.offer || '')?{offer:m.offer}:{}),progress:m.progress,
    ...(m.invitationPending?{reward:m.reward}:{}),readyToReport:m.readyToReport,recruited:!!m.recruitedAt,invitationPending:!!m.invitationPending,
    ...(m.recruitmentGroupId?{groupApproval:Groups.describe(state,m)}:{}) }));
}
function requestDescription(m) {
  return m.objective?`${m.title}: ${conditionsText(conditionsOf(m),m.recipient)}`:m.requestDescription || m.description;
}
function presentation(state) {
  const coords=state.getLastCoords(),roomKey=`${coords.x},${coords.y},${coords.z}`,db=dbOf(state),floor=require('./hostLocalFloors').identity(db[roomKey]?.cityFloorContext);
  const fields=['id','source','type','runId','roomKey','floor','recipient','title','description','offer','status','progress','starterRecruitment','invitationPending','readyToReport','recruitedAt'];
  return all(db).filter(m=>m.type==='resident-favor' && !m.retiredTask && m.runId===state.getDungeonRunId() && m.roomKey===roomKey && m.floor===floor)
    .map(m=>({...Object.fromEntries(fields.filter(k=>m[k]!==undefined).map(k=>[k,m[k]])),requestDescription:requestDescription(m),
      ...(m.recruitmentGroupId?{recruitmentGroup:Groups.describe(state,m,db)}:{})}));
}
function assessObjective(mission,o,db) {
  if(o.kind==='read'){
    const proof=require('./bookResearch').reading(db,{coords:o.roomKey,bookId:o.readableId,value:o.item,chapter:o.chapter});
    const receipt=(db['0,0,0']?.bookReadings || []).find(r=>r.id===proof.evidence.receiptId);
    const passed=proof.passed && receipt.at>=(mission.offeredAt || mission.acceptedAt) && (!receipt.runId || receipt.runId===mission.runId);
    return {passed:!!passed,evidence:passed?[proof.evidence]:[]};
  }
  if(o.kind==='conversation'){
    const evidence=(mission.conversationEvidence || []).filter(r=>r.source==='engine-conversation-evidence-v1' &&
      r.runId===mission.runId && r.roomKey===o.roomKey && r.floor===mission.floor && r.recipient===mission.recipient &&
      r.conditionId===o.id && r.at>=mission.acceptedAt && r.excerpt?.trim() && r.playerInput?.includes(r.excerpt));
    return {passed:evidence.length>0,evidence};
  }
  if(o.kind==='puzzle'){
    const p=db[o.roomKey]?.puzzleMechanism;
    const passed=!!p && p.id===o.mechanismId && p.state?.status==='complete' && require('../assets/physicalPuzzles').validState(p,p.state);
    return {passed,evidence:passed?[{source:'database.puzzleMechanism',roomKey:o.roomKey,mechanismId:p.id,revision:p.state.revision}]:[]};
  }
  if (o.kind === 'survey')return {passed:false,evidence:[]};
  if (o.kind === 'retrieve') {
    const receipt = db[mission.roomKey]?.itemTransfers?.find(r => r.source === 'engine-give-item-v1' && key(r.item) === key(o.item) &&
      key(r.recipient) === key(mission.recipient) && r.at >= mission.acceptedAt && !r.returnedAt && !mission.priorTransferIds?.includes(r.id));
    return { passed:!!receipt, evidence:receipt ? [receipt] : [] };
  }
  const receipt = require('./questDefeatEvidence').evidence(db,o.roomKey,o.target);
  return { passed:!!receipt, evidence:receipt ? [receipt] : [] };
}
function assess(mission,db) {
  const checks=conditionsOf(mission).map(o=>({id:o.id,...assessObjective(mission,o,db)}));
  return {passed:checks.every(c=>c.passed),evidence:checks.flatMap(c=>c.evidence),checks};
}
function refresh(state, db) {
  const notices=reconcileGroupOffers(db);
  for (const m of all(db)) if (m.runId === state.getDungeonRunId() && ['offered','accepted','declined'].includes(m.status)) {
    if(conditionsOf(m).some(o=>o.kind==='survey')){
      m.status='withdrawn';m.retiredTask=true;m.progress='This older request has been withdrawn. Invite the resident again for a new local request.';
      const group=db[m.roomKey]?.recruitmentInvitations?.[m.recruitmentGroupId],member=group?.members.find(row=>row.missionId===m.id);
      if(member){member.outcome='pending';delete member.missionId;group.status='collecting';}
      notices.push(m.progress);continue;
    }
    m.requestDescription=requestDescription(m);m.description=m.requestDescription+' '+participation(m);
    const resident=db[m.roomKey]?.inhabitants?.actors?.[m.recipient];
    if (resident && (resident.status==='dead' || I.state(resident)==='Dead')) {
      m.status='failed';m.progress=`${m.recipient} has died. Their personal favor and invitation can no longer be fulfilled.`;notices.push(m.progress);continue;
    }
    if(m.status!=='accepted')continue;
    const proof=assess(m,db);m.readyToReport = proof.passed;
    m.progress = m.readyToReport ? 'Requirements met. Complete the party invitation when ready.' :
      `${proof.checks.filter(c=>c.passed).length}/${proof.checks.length} conditions verified. `+conditionsOf(m).map(o=>objectiveText(o,m.recipient)).join(' ');
  }
  return notices;
}
function transact(state, db, mission, kind) {
  if (!mission || mission.source !== SOURCE || mission.runId !== state.getDungeonRunId()) throw Error('That request is unavailable.');
  if (kind === 'decline-favor') {
    if(Groups.decline(state,db,mission))return 'You decline the group recruitment conditions. No task was accepted and nobody was added to the party.';
    if (!['offered','declined'].includes(mission.status)) throw Error('An accepted request cannot be declined from the offer menu.');
    mission.status = 'declined'; return `You decline ${mission.title}. No task was accepted and no reward was granted.`;
  }
  if (mission.status === 'completed') return `${mission.title} is already complete. Invite ${mission.recipient} to join when you are ready.`;
  if (mission.status !== 'accepted') throw Error('Accept this request before completing it.');
  const proof = assess(mission,db); if (!proof.passed) throw Error('The work is not verified yet. '+(mission.progress || objectiveText(mission.objective,mission.recipient)));
  mission.status = 'completed'; mission.progress='Request complete. The work is verified.';
  mission.completionEvidence = structuredClone(proof.evidence); mission.rewardReceiptId = randomUUID();
  for(const room of Object.values(db)) {
    const decision=room?.recruitmentDecisions?.[key(mission.recipient)];
    if(decision?.runId===state.getDungeonRunId() && decision.status==='declined') {
      decision.status='reconsidered';decision.favorReceiptId=mission.rewardReceiptId;decision.favorId=mission.id;
    }
  }
  console.info('[ResidentFavor]', JSON.stringify({phase:'completed',id:mission.id,actor:mission.recipient}));
  return mission.recruitmentGroupId?`${mission.title} completed. This condition is verified; the group joins when all its agreed conditions are complete.`:mission.invitationPending?`${mission.title} completed. ${mission.recipient} agrees to join your party. Your conditional invitation is now fulfilled.`:
    `${mission.title} completed. The requested work has been verified.`;
}
function command(state, service, input) {
  const remove=/^remove\s+(.+?)\s+from\s+(?:the\s+)?party[.!]?$/i.exec(input.trim());
  const localHelper=remove&&JSON.parse(state.getCombatCharactersString() || '[]').find(a=>a.type==='npc'&&key(a.name)===key(remove[1])&&a.recruitmentLease?.source===require('./recruitmentProgress').SOURCE);
  if(localHelper){if(state.getGamePaused?.())return result(state,'Resume the game first.');
    require('./recruitmentProgress').depart(state,service,null,{names:[localHelper.name]});return result(state,`${localHelper.name} stays here.`);}
  input=String(input || '').trim().replace(/[.!?]+$/,'');
  const repeated=/^(?:ask\s+(.+?)\s+to\s+join\s+(?:my|our|the)\s+party|(?:add|invite|recruit)\s+(.+?)(?:\s+to\s+(?:(?:my|our|the)\s+)?party)?)$/i.exec(input);
  if(repeated){
    const name=key(repeated[1] || repeated[2]),roster=JSON.parse(state.getCombatCharactersString() || '[]');
    const exact=roster.filter(a=>a.type==='monster'&&key(a.name)===name),matches=exact.length?exact:roster.filter(a=>a.type==='monster'&&key(a.name).startsWith(name+' '));
    if(matches.length===1){const actor=matches[0],refusal=recruitmentRefusal(state,actor.name),c=state.getLastCoords(),geoKey=`${c.x},${c.y},${c.z}`;
      const p=state.getRoomPopulation?.(geoKey) || dbOf(state)[geoKey]?.inhabitants;
      if(refusal && I.canAct(actor) && actor.discoveryState!=='pending' && (!actor.mazeRoomKey || I.roomKey(actor.mazeRoomKey)===geoKey) &&
        p?.actors?.[actor.name]?.status==='present' && I.hasEncountered(actor,p)){
        const line=I.spokenLine(refusal.line,actor.name);
        return {...result(state,`${actor.name} has already declined. Their decision is unchanged.`+(line?`\n\n${actor.name}: "${line}"`:'')),
          ...(line?{dialogue:[{speaker:actor.name,line,utteranceId:randomUUID(),attribution:'labelled',recipient:'PC',attention:'addressing',kind:'turn'}]}:{})};
      }
    }
  }
  const join = /^(?:add|invite|recruit)\s+(.+?)(?:\s+to\s+(?:the\s+)?party)?$/i.exec(input.trim());
  if(join && Groups.collective(state,join[1]))return null; // A named member's invitation is still a group conversation.
  const action = /^(accept|decline)\s+(?:(?:the\s+)?(?:request|favor|job|task|contract)\s+)?(?:from\s+|for\s+)?(.+?)\s*$/i.exec(input.trim());
  const report = /^(?:report(?:\s+(?:back|findings|results))?|turn in(?:\s+(?:the\s+)?(?:favor|job|task))?)\s+(?:to\s+)?(.+?)\s*$/i.exec(input.trim());
  if (!join && !action && !report) return null;
  const db = dbOf(state), coords = state.getLastCoords(), geoKey = `${coords.x},${coords.y},${coords.z}`;
  const missions = all(db).filter(m => m.runId === state.getDungeonRunId() && m.status!=='withdrawn');
  const requested = join?.[1] || action?.[2] || report?.[1];
  const matches = missions.filter(m => key(m.recipient) === key(requested) || key(m.recipient).startsWith(key(requested)+' '));
  if (!matches.length) return null;
  if (requested && new Set(matches.map(m=>m.recipient)).size !== 1) return result(state,'Name the resident whose favor you mean.');
  if (state.getGamePaused?.()) return result(state,'Resume the game before working on a favor.');
  try {
    const mission = matches[0];
    if (join && mission.recruitedAt) return result(state,`${mission.recipient} has already joined under this bargain.`);
    const ctx = nearby(state,mission.recipient,{contract:true});
    if (mission.roomKey !== ctx.geoKey || mission.floor !== floorOf(state)) throw Error('Return to the resident who offered this favor.');
    if (join) return result(state,recruit(state,service,mission.recipient,mission));
    const E=require('./economy'), view=E.view(state,mission.recipient); if(view.error)throw Error(view.error);
    const outcome=E.action(state,service,{kind:report?'report-favor':action[1]==='accept'?'accept-mission':'decline-favor',
      actor:mission.recipient,missionId:mission.id,runId:state.getDungeonRunId(),geoKey,revision:view.revision,nonce:randomUUID()});
    return {...result(state,outcome.error || outcome.content),...(outcome.recruitmentHandoff?{recruitmentHandoff:outcome.recruitmentHandoff}:{})};
  } catch(error) { return result(state,error.message); }
}
function recruitedNames(db) { return new Set(all(db).filter(m=>m.status==='completed' && m.recruitedAt && m.rewardReceiptId ||
  ['accepted','completed'].includes(m.status) && m.provisionalJoinedAt && !m.helperDepartedAt).map(m=>key(m.recipient))); }
function preserveConsole(oldText, incoming, db) {
  for(const m of all(db).filter(m=>m.helperDepartedAt&&!m.recruitedAt)){
    const stale=I.parseSheets(incoming,'NPCs in Party').find(a=>key(a.name)===key(m.recipient));
    if(stale)incoming=incoming.replace(I.sectionPattern('NPCs in Party'),(_,head,body)=>head+'\n'+(body.replace(stale.rawSheet,'').trim() || 'None')+'\n');
  }
  // Old menus and stale browser snapshots cannot promote a resident who refused.
  const refused=new Set(Object.values(db).flatMap(room=>Object.values(room?.recruitmentDecisions || {})).filter(d=>d.status==='declined').map(d=>key(d.actor)));
  for(const actor of I.parseSheets(oldText).filter(a=>refused.has(key(a.name)))) {
    const promoted=I.parseSheets(incoming,'NPCs in Party').find(a=>key(a.name)===key(actor.name));if(!promoted)continue;
    incoming=incoming.replace(I.sectionPattern('NPCs in Party'),(_,head,body)=>head+'\n'+(body.replace(promoted.rawSheet,'').trim() || 'None')+'\n');
    if(!I.parseSheets(incoming).some(a=>key(a.name)===key(actor.name)))incoming=incoming.replace(I.sectionPattern('Monsters in Room'),(_,head,body)=>head+'\n'+(/^\s*None\s*$/i.test(body)?'':body.trim()+'\n')+actor.rawSheet+'\n');
  }
  const names=recruitedNames(db); if(!names.size || typeof incoming!=='string')return incoming;
  for(const actor of I.parseSheets(oldText,'NPCs in Party').filter(a=>names.has(key(a.name)))) {
    const present=I.parseSheets(incoming,'NPCs in Party').some(a=>key(a.name)===key(actor.name));
    incoming=incoming.replace(I.sectionPattern('Monsters in Room'),(_,head,body)=>{
      const stale=I.parseBlocks(body).find(a=>key(a.name)===key(actor.name));return head+(stale?body.replace(stale.rawSheet,''):body);
    });
    if(!present)incoming=incoming.replace(I.sectionPattern('NPCs in Party'),(_,head,body)=>head+'\n'+(/^\s*None\s*$/i.test(body)?'':body.trim()+'\n')+actor.rawSheet+'\n');
  }
  return incoming;
}
function preserveRoster(state,incoming) {
  if(incoming===undefined)return incoming;
  const db=dbOf(state),names=recruitedNames(db);
  const current=JSON.parse(state.getCombatCharactersString() || '[]');let roster=JSON.parse(incoming);
  for(const m of all(db).filter(m=>m.helperDepartedAt&&!m.recruitedAt)){
    const resident=current.find(a=>a.type==='monster'&&key(a.name)===key(m.recipient));
    roster=roster.filter(a=>a.type!=='npc'||key(a.name)!==key(m.recipient));
    if(resident&&!roster.some(a=>key(a.name)===key(m.recipient)))roster.push(structuredClone(resident));
  }
  for(const actor of current.filter(a=>a.type==='monster' && recruitmentRefusal(state,a.name,db))) {
    const row=roster.find(a=>key(a.name)===key(actor.name));
    if(row?.type==='npc')Object.assign(row,{type:'monster',state:actor.state,allegiance:actor.allegiance});
  }
  for(const actor of current.filter(a=>a.type==='npc' && names.has(key(a.name)))) {
    const row=roster.find(a=>key(a.name)===key(actor.name));
    if(row){row.type='npc';if(actor.recruitmentLease)row.recruitmentLease=structuredClone(actor.recruitmentLease);else delete row.recruitmentLease;if(row.state==='Neutral'||row.state==='Hostile')row.state=actor.state;}
    else roster.push(structuredClone(actor));
  }
  return JSON.stringify(roster);
}
module.exports={ SOURCE, helpIntent, nearby, candidates, prepare, accept, assess, refresh, transact, command, objectiveText, context, recruitedNames, preserveConsole, preserveRoster,
  recruit,dialogueOptions,applyDialogue,settleConsent,authoredConditions,conditionParameter,conversationParameter,conversationProof,adjudicateConversation,recruitmentRefusal,refusalMessage,invitationIntent,favorDecision,neutralInvitation,presentation,requestDescription };
