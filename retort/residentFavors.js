'use strict';
const { randomUUID } = require('node:crypto');
const I = require('../assets/dungeonInhabitants'), Reach = require('./dungeonReach');
const SOURCE = 'engine-resident-favor-v1';
const key = s => String(s || '').trim().toLowerCase();
const dbOf = state => JSON.parse(state.getRoomNameDatabase() || '{}');
const clock = state => dbOf(state)['0,0,0']?.spellSystem?.clock ?? Number(state.getUpdatedGameConsole().match(/^Turns:\s*(\d+)/m)?.[1] || 0);
const floorOf = state => require('./hostLocalFloors').identity(dbOf(state)[`${state.getLastCoords().x},${state.getLastCoords().y},${state.getLastCoords().z}`]?.cityFloorContext);
const all = db => Object.values(db).flatMap(r => Object.values(r?.minorMissions || {})).filter(m => m.source === SOURCE);
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
  for(const m of all(db).filter(m=>m.type==='resident-favor' && ['offered','accepted','completed'].includes(m.status))) {
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
function nearby(state, name, { handoff = false } = {}) {
  const coords = state.getLastCoords(), geoKey = `${coords.x},${coords.y},${coords.z}`;
  const roster = JSON.parse(state.getCombatCharactersString() || '[]'), db = dbOf(state);
  const actor = roster.find(a => a.type === 'monster' && key(a.name) === key(name));
  const population = state.getRoomPopulation?.(geoKey) || db[geoKey]?.inhabitants, record = population?.actors?.[actor?.name];
  const pc = roster.find(a => a.type === 'pc' && (a.hp ?? 1) > 0), dungeon = state.getRoomDungeonForSimulation?.(coords);
  const player = Reach.position(pc, geoKey), reach = actor && player && I.dialogueReach(dungeon, actor, player, { conversation:true });
  if (!actor || !record || record.status !== 'present' || !I.canAct(actor) || !I.canAct(record) || record.allegiance === 'Hostile' || actor.discoveryState === 'pending' ||
      !I.hasEncountered(actor, population) || I.allegiance(actor) === 'Hostile' || !reach?.canSpeak || !reach.lineOfSight || handoff && reach.distance > 3)
    throw Error(`Move close to ${name} in their room for this conversation.`);
  return { actor, record, roster, population, pc, dungeon, geoKey, db };
}
function candidates(state, ctx) {
  const room = ctx.db[ctx.geoKey], protectedNames = new Set((state.getCurrentTasks?.() || []).flatMap(t => t.requiredElements || []).map(e => key(e.name)));
  const choices = [{ id: 'survey', kind: 'survey', roomKey: ctx.geoKey, roomName: room.name, observations: 2, interval: 2 }];
  for (const item of room.objects || []) if (item.name && !protectedNames.has(key(item.name)) && !item.minor_mission_id &&
      !require('./economy').protectedItem(state, ctx.db, item) && !item.quest_artifact && !item.currency_kind)
    choices.push({ id: 'retrieve:'+choices.length, kind: 'retrieve', item: item.name, roomKey: ctx.geoKey, roomName: room.name });
  for (const actor of ctx.roster) if (actor.type === 'monster' && actor.hp > 0 && I.allegiance(actor) === 'Hostile' &&
      !protectedNames.has(key(actor.name)) && I.hasEncountered(actor, ctx.population) &&
      !require('./questDefeatEvidence').evidence(ctx.db, ctx.geoKey, actor.name) && !room.bossGate)
    choices.push({ id: 'defeat:'+choices.length, kind: 'defeat', target: actor.name, roomKey: ctx.geoKey, roomName: room.name });
  return choices;
}
function eligible(state, ctx, {favor=true}={}) {
  if (favor && require('../assets/economyRules').isStarterRoom(ctx.geoKey,ctx.db[ctx.geoKey])) return false;
  if (!require('../assets/pantheonCharacters').canRecruit(ctx.actor) || ctx.record.recruitable === false || ctx.record.deityId) return false;
  return !require('./questScenes').recruitmentGuard(state, `add ${ctx.actor.name} to party`);
}
function objectiveText(objective, name) {
  if (objective.kind === 'survey') return `Observe ${objective.focus} in ${objective.roomName} ${objective.observations || 2} times, with at least ${objective.interval} game actions between observations. Use "observe for ${name}", then return and "report to ${name}".`;
  if (objective.kind === 'retrieve') return `Find ${objective.item} in ${objective.roomName}, give it to ${name}, then report to ${name}.`;
  return `Defeat ${objective.target} in ${objective.roomName}, then report to ${name}.`;
}
const conditionsOf=m=>m.conditions?.length?m.conditions:[m.objective];
const conditionsText=(list,name)=>list.map(o=>objectiveText(o,name)).join(' Also: ');
function authoredConditions(event,option) {
  const rows=event.conditions?.length?event.conditions:[{objectiveId:event.favorObjectiveId,observationCount:'2',observationInterval:'2'}];
  if(rows.length<1 || rows.length>3 || new Set(rows.map(r=>r.objectiveId)).size!==rows.length)throw Error('Choose one to three distinct engine-supported conditions.');
  return rows.map(row=>{
    const bound=option.candidates.find(c=>c.id===row.objectiveId);if(!bound)throw Error('The condition does not name a verified target.');
    if(bound.kind==='survey'){
      if(!['1','2','3'].includes(String(row.observationCount)) || !['1','2','3','5'].includes(String(row.observationInterval)))throw Error('Choose the observation count and interval from the supplied enums.');
      return {...bound,focus:event.favorFocus,observations:Number(row.observationCount),interval:Number(row.observationInterval)};
    }
    return {...bound};
  });
}
function conditionParameter(choices,optional=false) {
  const C=require('./generationContracts');
  return {type:[{type:{objectiveId:C.choice(choices.length?choices.map(c=>c.id):['']),observationCount:C.choice(['','1','2','3']),observationInterval:C.choice(['','1','2','3','5'])}}],minItems:optional?0:1,maxItems:3};
}
function storeOffer(state,ctx,draft,objective,population,consent=null) {
  const held=groupMission(ctx,state);if(held && held.recipient!==ctx.actor.name)throw Error(`This group already has a favor with ${held.recipient}: ${held.title}.`);
  const existing=ownMission(ctx,state);
  if(existing) {
    if(existing.status==='declined')existing.status='offered';
    if(consent?.playerInvited){existing.invitationPending=true;existing.conditionalConsent=consent;
      if(existing.objective)existing.description=`${existing.title}: ${conditionsText(conditionsOf(existing),existing.recipient)} Reward: ${existing.recipient} has conditionally accepted your invitation and will join after verified completion.`;}
    state.setRoomNameDatabase(JSON.stringify(ctx.db));return existing;
  }
  const name=ctx.actor.name,id='favor:'+randomUUID(),mission={id,source:SOURCE,type:'resident-favor',runId:state.getDungeonRunId(),floor:floorOf(state),
    status:'offered',title:draft.title.trim(),offer:draft.offer.trim(),objective,recipient:name,originalRecipient:name,
    roomKey:ctx.geoKey,roomName:ctx.db[ctx.geoKey].name,groupId:groupOf(ctx.population,name),reward:{type:'recruitment',actor:name},rewardSilver:0,escrowSilver:0,escrowItems:[],
    conditions:draft.conditions || [objective],invitationPending:!!consent?.playerInvited,...(consent?{conditionalConsent:consent}:{})};
  mission.description=`${mission.title}: ${conditionsText(mission.conditions,name)} Reward: ${name} `+
    (mission.invitationPending?'has conditionally accepted your invitation and will join after verified completion.':'will join when you invite them after completion.');
  ctx.db[ctx.geoKey].minorMissions ||= {};ctx.db[ctx.geoKey].minorMissions[id]=mission;
  const record=population?.actors?.[name] || ctx.record;record.minorMissionId=id;record.servicesAcceptedAt ||= Date.now();ctx.population.actors[name]=record;
  ctx.population.serviceProviders=[...new Set([...(ctx.population.serviceProviders || []),name])];ctx.db[ctx.geoKey].inhabitants=ctx.population;
  state.setRoomNameDatabase(JSON.stringify(ctx.db));state.setRoomPopulation?.(ctx.geoKey,ctx.population);state.emitter?.emit('quest:minorMission');
  console.info('[ResidentFavor]',JSON.stringify({phase:'offered',id,actor:name,objective,origin:consent?'live-dialogue':'help-request'}));return mission;
}
function recruit(state,service,name,mission=null,consent=null) {
  const roster=JSON.parse(state.getCombatCharactersString() || '[]');
  if(roster.some(a=>a.type==='npc' && key(a.name)===key(name)))return `${name} has already joined the party.`;
  const ctx=nearby(state,name);
  if(!eligible(state,ctx,{favor:false}))throw Error('This resident cannot join through a conversation.');
  mission=mission?ctx.db[ctx.geoKey]?.minorMissions?.[mission.id]:ownMission(ctx,state);
  if(mission && mission.status!=='completed')throw Error(`${name}'s invitation is conditional on the favor. ${mission.description} Status: ${mission.status}. Accept with "accept favor from ${name}"; report with "report to ${name}".`);
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
  mission.recruitedAt=Date.now();mission.progress=`${name} has joined the party.`;if(consent)mission.consent=consent;ctx.db[ctx.geoKey].minorMissions ||= {};ctx.db[ctx.geoKey].minorMissions[mission.id]=mission;ctx.db[ctx.geoKey].inhabitants=ctx.population;
  state.setRoomNameDatabase(JSON.stringify(ctx.db));state.setUpdatedGameConsole(text);state.setCombatCharactersString(JSON.stringify(ctx.roster));
  service?.save(ctx.population);require('./economy').refresh(state);
  console.info('[ResidentFavor]',JSON.stringify({phase:'recruited',id:mission.id,actor:name,origin:consent?'live-dialogue':'invitation-command'}));
  return `${name} joins the party. Their identity, equipment and abilities are preserved.`;
}
function dialogueOptions(state,names) {
  const options=[],offerGroups=new Set();
  for(const name of names){try{
    const ctx=nearby(state,name);if(!eligible(state,ctx,{favor:false}))continue;
    const favorAllowed=eligible(state,ctx);
    const mission=ownMission(ctx,state),group=groupMission(ctx,state),groupId=groupOf(ctx.population,name);
    const actions=['none','decline-invitation'];
    if(favorAllowed && (!group || group.recipient===name) && !offerGroups.has(groupId) && (!mission || ['offered','declined'].includes(mission.status))) { actions.push('offer-favor');offerGroups.add(groupId); }
    if(mission)actions.push('discuss-favor');
    else if(group)actions.push('discuss-favor');
    if(mission?.status==='offered') { if(!group || group.id===mission.id)actions.push('accept-favor');actions.push('decline-favor'); }
    if(mission?.status==='accepted' && assess(mission,ctx.db).passed)actions.push('report-favor');
    if((!mission || mission.status==='completed') && I.parseSheets(state.getUpdatedGameConsole(),'NPCs in Party').length<12)actions.push('accept-invitation');
    options.push({name,actions,groupId,groupContract:group?{actor:group.recipient,title:group.title,status:group.status,description:group.description}:null,
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
  const current=dialogueOptions(state,[event.speaker])[0];if(!current?.actions.includes(action))throw Error('That social action is not available for this resident now.');
  const ctx=nearby(state,event.speaker),consent={speaker:event.speaker,line:event.line,playerInvited:event.playerInvited===true,at:Date.now(),source:'engine-live-dialogue-v1'};
  let mission=ownMission(ctx,state),content;
  if(action==='accept-invitation'){
    if(!consent.playerInvited && !mission?.invitationPending)throw Error('The player has not invited this resident.');
    content=recruit(state,service,event.speaker,mission,consent);
  }else if(action==='offer-favor'){
    const conditions=mission?conditionsOf(mission):authoredConditions(event,option);
    if(!mission && (!event.favorTitle?.trim() || !event.favorFocus?.trim()))throw Error('A conditional invitation must select a concrete verified favor.');
    mission=storeOffer(state,ctx,{title:event.favorTitle || mission.title,offer:event.line,conditions},conditions[0],ctx.population,consent);
    content=`Local favor (${mission.status}): ${mission.description} Accept or decline in conversation, or use Local Contract.`;
  }else if(action==='accept-favor'){
    accept(state,mission);if(consent.playerInvited)mission.invitationPending=true;state.setRoomNameDatabase(JSON.stringify(ctx.db));require('./economy').refresh(state);
    content=`Local favor accepted: ${mission.description}`;
  }else if(action==='report-favor' || action==='decline-favor'){
    content=transact(state,ctx.db,mission,action);state.setRoomNameDatabase(JSON.stringify(ctx.db));require('./economy').refresh(state);
    if(action==='report-favor' && (mission.invitationPending || consent.playerInvited)) {
      try{content+='\n'+recruit(state,service,event.speaker,mission,consent);}catch(error){content+='\n'+error.message;}
    }
  }else if(action==='discuss-favor'){
    if(!mission){const shared=groupMission(ctx,state);if(!shared)throw Error('The group has no current favor.');
      content=`Group favor with ${shared.recipient}: ${shared.description}`;
    }else{
    if(consent.playerInvited){mission.invitationPending=true;state.setRoomNameDatabase(JSON.stringify(ctx.db));}
    content=mission.description+'\n'+(mission.progress || 'The favor has not been accepted.');
    }
  }else content=`${event.speaker} declines the invitation and remains here.`;
  console.info('[ResidentDialogueAction]',JSON.stringify({action,speaker:event.speaker,missionId:mission?.id || null}));
  return {action,content,actor:event.speaker};
}
function settleConsent(state,service,missionId) {
  const mission=all(dbOf(state)).find(m=>m.id===missionId);
  if(!mission || mission.status!=='completed' || !mission.invitationPending || mission.recruitedAt)return '';
  try{return recruit(state,service,mission.recipient,mission,mission.conditionalConsent || null);}catch(error){return error.message;}
}
async function prepare(state, $, input, { audibleNames = [], responseAudience, population, author } = {}) {
  if (!helpIntent(input) || state.getGamePaused?.()) return [];
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
    const choices = candidates(state, ctx), C = require('./generationContracts');
    const brief = `Construct a coherent side mission for this existing resident from their actual conversation, work and motives. Choose one to three distinct conditions using the supplied objectiveId enums; all conditions must be fulfilled. Every target already exists. Write a personal title and natural offer, not a prefabricated quest. For observation conditions choose observationCount (1,2,3) and observationInterval (1,2,3,5 game actions); leave those fields empty for retrieval/defeat. focus describes the existing activity, not an invented object. Prefer relevant conditions over arbitrary chores. Offer to join after verified completion and an invitation. Do not accept for the player, declare completion, spawn objects or change allegiance. Player input: ${JSON.stringify(input)}. Resident: ${JSON.stringify({name,job:ctx.record.job,activity:ctx.record.activity,motivation:ctx.record.motivation,history:ctx.record.profile?.history,previous:ctx.record.dialogue?.slice(-3)})}. Grounded conditions: ${JSON.stringify(choices)}. ${require('./graveMasterStoryPrompts').settingOnce({})}`;
    let draft;
    try {
      draft = await (author || ((brief, choices) => require('./holodekRoomWork').request($, 'resident-favor', {
        title: C.text(100), conditions:conditionParameter(choices), focus: C.text(120), offer: C.text(900)
      }, brief)))(brief, choices);
      if (!draft || !draft.title?.trim() || !draft.offer?.trim() ||
          [draft.title,draft.focus,draft.offer].some(v => typeof v !== 'string' || /\[\[|\]\]/.test(v))) throw Error('The favor did not select a grounded objective.');
      draft.conditions=authoredConditions({conditions:draft.conditions,favorObjectiveId:draft.objectiveId,favorFocus:draft.focus},{candidates:choices});
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
function accept(state, mission) {
  if (mission.runId !== state.getDungeonRunId()) throw Error('That favor belongs to another adventure.');
  if (mission.floor !== floorOf(state)) throw Error('Return to the floor where this favor was offered.');
  const held=groupMission(nearby(state,mission.recipient),state);
  if(held && held.id!==mission.id)throw Error(`This group already has a favor with ${held.recipient}: ${held.title}.`);
  if (conditionsOf(mission).some(o=>o.kind === 'defeat' && require('./questDefeatEvidence').evidence(dbOf(state),o.roomKey,o.target)))
    throw Error('That opponent was already defeated before this favor was accepted.');
  mission.acceptedAt = Date.now(); mission.acceptedClock = clock(state); mission.observations = [];
  mission.priorTransferIds=(dbOf(state)[mission.roomKey]?.itemTransfers || []).map(r=>r.id);
  mission.status = 'accepted'; mission.progress = 'Objective accepted; no work verified yet.';
}
function context(state, names) {
  return all(dbOf(state)).filter(m=>m.runId===state.getDungeonRunId() && m.status!=='withdrawn' && names.includes(m.recipient)).map(m=>({
    title:m.title,actor:m.recipient,status:m.status,description:m.description,offer:m.offer,progress:m.progress,
    reward:m.reward,readyToReport:m.readyToReport,recruited:!!m.recruitedAt,invitationPending:!!m.invitationPending }));
}
function assessObjective(mission,o,db) {
  if (o.kind === 'survey') {
    const observed=(mission.observations || []).filter(r=>!r.conditionId || r.conditionId===o.id);
    return {passed:observed.length>=o.observations,evidence:observed};
  }
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
    const resident=db[m.roomKey]?.inhabitants?.actors?.[m.recipient];
    if (resident && (resident.status==='dead' || I.state(resident)==='Dead')) {
      m.status='failed';m.progress=`${m.recipient} has died. Their personal favor and invitation can no longer be fulfilled.`;notices.push(m.progress);continue;
    }
    if(m.status!=='accepted')continue;
    const proof=assess(m,db);m.readyToReport = proof.passed;
    m.progress = m.readyToReport ? `Work verified. Return and report to ${m.recipient}.` :
      `${proof.checks.filter(c=>c.passed).length}/${proof.checks.length} conditions verified. `+conditionsOf(m).map(o=>o.kind==='survey'?
        `${assessObjective(m,o,db).evidence.length}/${o.observations} observations recorded. ${objectiveText(o,m.recipient)}`:objectiveText(o,m.recipient)).join(' ');
  }
  return notices;
}
function transact(state, db, mission, kind) {
  if (!mission || mission.source !== SOURCE || mission.runId !== state.getDungeonRunId()) throw Error('That favor is unavailable.');
  if (kind === 'decline-favor') {
    if (!['offered','declined'].includes(mission.status)) throw Error('An accepted favor cannot be declined from the offer menu.');
    mission.status = 'declined'; return `You decline ${mission.title}. No task was accepted and no reward was granted.`;
  }
  if (mission.status === 'completed') return `${mission.title} is already complete. Invite ${mission.recipient} to join when you are ready.`;
  if (mission.status !== 'accepted') throw Error('Accept this favor before reporting progress.');
  const proof = assess(mission,db); if (!proof.passed) throw Error('The work is not verified yet. '+(mission.progress || objectiveText(mission.objective,mission.recipient)));
  mission.status = 'completed'; mission.progress=`Favor complete. Invite ${mission.recipient} to claim the agreed recruitment reward.`;
  mission.completionEvidence = structuredClone(proof.evidence); mission.rewardReceiptId = randomUUID();
  console.info('[ResidentFavor]', JSON.stringify({phase:'completed',id:mission.id,actor:mission.recipient}));
  return `${mission.title} completed. ${mission.recipient} agrees to join your party. `+
    (mission.invitationPending?'Your conditional invitation is now fulfilled.':'Invite them when you are ready; they have not joined yet.');
}
function command(state, service, input) {
  input=String(input || '').trim().replace(/[.!?]+$/,'');
  const join = /^(?:add|invite|recruit)\s+(.+?)(?:\s+to\s+(?:the\s+)?party)?$/i.exec(input.trim());
  const action = /^(accept|decline)\s+(?:(?:the\s+)?(?:favor|job|task|contract)\s+)?(?:from\s+|for\s+)?(.+?)\s*$/i.exec(input.trim());
  const report = /^(?:report(?:\s+(?:back|findings|results))?|turn in(?:\s+(?:the\s+)?(?:favor|job|task))?)\s+(?:to\s+)?(.+?)\s*$/i.exec(input.trim());
  const observe = /^(?:observe|watch|study)\b/i.test(input.trim());
  if (!join && !action && !report && !observe) return null;
  const db = dbOf(state), coords = state.getLastCoords(), geoKey = `${coords.x},${coords.y},${coords.z}`;
  const missions = all(db).filter(m => m.runId === state.getDungeonRunId() && m.status!=='withdrawn');
  const requested = join?.[1] || action?.[2] || report?.[1];
  const matches = requested ? missions.filter(m => key(m.recipient) === key(requested) || key(m.recipient).startsWith(key(requested)+' ')) :
    missions.filter(m => m.status === 'accepted' && conditionsOf(m).some(o=>o.kind === 'survey' && o.roomKey === geoKey &&
      (/\bfor\s+/i.test(input) ? key(input).endsWith('for '+key(m.recipient)) : key(o.focus).split(/\W+/).some(w => w.length>3 && key(input).includes(w)))));
  if (!matches.length) return null;
  if (requested && new Set(matches.map(m=>m.recipient)).size !== 1) return result(state,'Name the resident whose favor you mean.');
  if (state.getGamePaused?.()) return result(state,'Resume the game before working on a favor.');
  try {
    if (observe) {
      const scope = floorOf(state), roster = JSON.parse(state.getCombatCharactersString() || '[]');
      if (!Reach.position(roster.find(a=>a.type==='pc' && a.hp>0),geoKey)) throw Error('A conscious player must be present to observe.');
      const notices = [];
      for (const m of matches) {
        if (m.floor !== scope) continue;
        const observation=conditionsOf(m).find(o=>o.kind==='survey' && o.roomKey===geoKey);if(!observation)continue;
        const now = clock(state), last = m.observations?.at(-1);
        if (last && now-last.clock < observation.interval) { notices.push(`Keep observing the surroundings; ${observation.interval-(now-last.clock)} more game action(s) must pass before the next observation.`); continue; }
        if ((m.observations?.length || 0) >= observation.observations) { notices.push(`Your observations for ${m.recipient} are recorded. Check the remaining conditions, then report to them.`); continue; }
        m.observations ||= []; m.observations.push({id:randomUUID(),source:SOURCE,runId:m.runId,roomKey:geoKey,clock:now,
          conditionId:observation.id,position:Reach.position(roster.find(a=>a.type==='pc'),geoKey),focus:observation.focus});
        notices.push(`Observation ${m.observations.length}/${observation.observations} recorded for ${m.recipient}: ${observation.focus}.`);
      }
      refresh(state,db); state.setRoomNameDatabase(JSON.stringify(db)); require('./economy').refresh(state);
      return result(state,notices.join('\n') || 'These observations belong to a different floor.');
    }
    const mission = matches[0];
    if (join && mission.recruitedAt) return result(state,`${mission.recipient} has already joined under this bargain.`);
    const ctx = nearby(state,mission.recipient,{handoff:true});
    if (mission.roomKey !== ctx.geoKey || mission.floor !== floorOf(state)) throw Error('Return to the resident who offered this favor.');
    if (join) return result(state,recruit(state,service,mission.recipient,mission));
    const E=require('./economy'), view=E.view(state,mission.recipient); if(view.error)throw Error(view.error);
    const outcome=E.action(state,service,{kind:report?'report-favor':action[1]==='accept'?'accept-mission':'decline-favor',
      actor:mission.recipient,missionId:mission.id,runId:state.getDungeonRunId(),geoKey,revision:view.revision,nonce:randomUUID()});
    return result(state,outcome.error || outcome.content);
  } catch(error) { return result(state,error.message); }
}
function recruitedNames(db) { return new Set(all(db).filter(m=>m.status==='completed' && m.recruitedAt && m.rewardReceiptId).map(m=>key(m.recipient))); }
function preserveConsole(oldText, incoming, db) {
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
  const names=recruitedNames(dbOf(state));if(!names.size)return incoming;
  const current=JSON.parse(state.getCombatCharactersString() || '[]'),roster=JSON.parse(incoming);
  for(const actor of current.filter(a=>a.type==='npc' && names.has(key(a.name)))) {
    const row=roster.find(a=>key(a.name)===key(actor.name));
    if(row){row.type='npc';if(row.state==='Neutral'||row.state==='Hostile')row.state=actor.state;}
    else roster.push(structuredClone(actor));
  }
  return JSON.stringify(roster);
}
module.exports={ SOURCE, helpIntent, nearby, candidates, prepare, accept, assess, refresh, transact, command, objectiveText, context, recruitedNames, preserveConsole, preserveRoster,
  recruit,dialogueOptions,applyDialogue,settleConsent,authoredConditions,conditionParameter };
