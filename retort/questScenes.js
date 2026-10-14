'use strict';
const { randomUUID } = require('node:crypto');
const I = require('../assets/dungeonInhabitants');
const Inventory = require('../assets/inventoryUi');
const Readables = require('../assets/readableItems');
const Pantheon = require('../assets/pantheonCharacters');
const Factions = require('./factionMemory');
const { prepare: prepareRead } = require('./readableActions');
const { isReservedBossKeyName } = require('./bossGate');
const Q = () => require('./questProgress');
const key = s => String(s || '').trim().toLowerCase();
const field = (text,label) => String(text).match(new RegExp('^'+label+':[ \\t]*([^\\r\\n]*)','m'))?.[1]?.trim() || '';
const write = (text,label,value) => text.replace(new RegExp('^'+label+':[^\\r\\n]*','m'), () => label+': '+value);
function roomSheets(room) {
  const rows=I.parseBlocks(room?.monsters?.inRoom||'');
  return rows.length?rows:I.parseBlocks(room?.monsters?.consoleBlock||'');
}
function residents(room) {
  return roomSheets(room).filter(a => a.hp > 0 && (room?.inhabitants?.actors?.[a.name]?.hp ?? a.hp)>0 &&
    !['dead','departed','recruited'].includes(room?.inhabitants?.actors?.[a.name]?.status));
}
function compile(task, database, currentRoom, options = {}) {
  if (!task?.id || task.story || task.bossGate || task.bossKey || task.actionKind === 'unlock_exit' ||
      task.requiredElements?.some(e => isReservedBossKeyName(database,e.name))) return task;
  const contract=Q().evaluateTaskRequirements(task,{database,roomKey:I.roomKey(currentRoom),consoleText:'Inventory: Empty'});
  if(contract.checks.some(c=>['unsupported_requirement','invalid_requirement'].includes(c.evidence.reason))||
      !Q().verifiedTaskCompletion(task,{checks:contract.checks.map(c=>({...c,passed:true}))}))return task;
  const bindings = Q().deliveryBindings(task), first = task.requiredElements?.[0];
  const roomKey = bindings[0]?.coords || I.roomKey(first?.placement) || I.roomKey(currentRoom), room = database[roomKey];
  if (!room?.name) return task;
  const actors = residents(room), contact = actors.find(a => a.name === bindings[0]?.recipient) ||
    actors.find(a => room.inhabitants?.actors?.[a.name]?.deityId && I.allegiance(a,room.monsters?.state) === 'Neutral') ||
    actors.find(a => I.allegiance(a,room.monsters?.state) !== 'Hostile');
  const documents = (room.readables || []).filter(r => r.chapters?.[0]?.text?.trim() && room.objects?.some(o => key(o.name) === key(r.name)));
  const divine = contact && !Pantheon.canRecruit(contact);
  const kinds = ['npc','item','writing'], preferred = options.hookKind || (divine ? 'npc' : kinds[I.hash(task.id)%3]);
  const kind = preferred === 'npc' && contact ? 'npc' : preferred === 'item' && documents.length ? 'item' : 'writing';
  const id = 'story:'+task.id, hook = { kind, roomKey, roomName: room.name };
  const type=String(task.type).toLowerCase();
  const premise=type==='puzzle'?'The mechanism still keeps its secrets. I need its workings understood, not another guess.':
    type==='deliver'?'Some debts outlast death. I will trust a handoff, not a promise.':
    type==='defeat'?'We do not have to be friends to want the same threat ended.':
    ['Memory is a poor witness. Bring back something real.',
      'I have waited too long for someone willing to finish what was abandoned.',
      'An old obligation can become a bargain, if you are willing to see it through.'][I.hash(task.id)%3];
  const suffix = I.hash(task.id).toString(16).replace(/[0-9]/g,c => String.fromCharCode(97+Number(c)));
  const writing = { id: 'writing:'+task.id, questStoryId: id, mechanismId: id, kind: 'inscription', type: 'stone_tablet',
    name: 'covenant tablet '+suffix, title: 'An Unfinished Covenant', role: 'lore', motif: 'Key',
    backstory: 'A surviving record of an obligation between the souls of Tartarus.',
    chapters: [{ title: 'The obligation', text: task.desc }] };
  if (kind === 'npc') hook.actor = contact.name;
  else if (kind === 'item') Object.assign(hook,{ name: documents[0].name, readableId: documents[0].id });
  else {
    Object.assign(hook,{ name: writing.name, readableId: writing.id });
  }
  const stages = [{ id: 'hook', kind: kind === 'npc' ? 'dialogue' : 'read', roomKey,
    ...(kind === 'npc' ? { actor: contact.name } : { name: hook.name, readableId: hook.readableId }),
    text: kind==='npc' ? `${contact.name}: "${premise} ${task.desc} Will you take this obligation?"` : premise+' '+task.desc,
    options: [{ id: 'accept', label: 'Accept the obligation', action: 'continue', next: 'objective' }] },
    { id: 'objective', kind: 'objective', roomKey, actor: bindings[0]?.recipient || contact?.name, text: task.desc, next: 'resolution' }];
  const guards = String(task.type).toLowerCase() === 'fetch' ? actors.filter(a => I.allegiance(a,room.monsters?.state) === 'Hostile').slice(0,2) : [];
  if (guards.length) {
    stages[1].next = 'encounter';
    stages.push({ id: 'encounter', kind: 'encounter', roomKey,
      targets: guards.map(a => a.name), text: `The recovery is not the end: defeat ${guards.map(a=>a.name).join(' and ')} in ${room.name}, or bring them into the party through the normal recruitment rules.`, next: 'resolution' });
  }
  const choices = [{ id: 'finish', label: contact ? 'Conclude the bargain; travel separately' : 'Record the covenant as fulfilled', action: 'finish', next: 'complete' }];
  if (contact) {
    if (Pantheon.canRecruit(contact)) choices.unshift({ id: 'invite', label: 'Invite '+contact.name+' to join the party', action: 'recruit', next: 'complete' });
    const gift = room.inhabitants?.actors?.[contact.name]?.inventory?.find(o => o?.name && !isReservedBossKeyName(database,o.name));
    if (gift) choices.unshift({ id: 'receive', label: 'Accept '+gift.name+' from '+contact.name, action: 'receive', item: gift.name, next: 'complete' });
  }
  stages.push({ id: 'resolution', kind: 'dialogue', roomKey, ...(contact ? { actor: contact.name } : { name: hook.name, readableId: hook.readableId }),
    text: contact ? `${contact.name}: "The obligation is settled. We need not be friends to share the road. Choose what comes next."` : 'The named obligation has been fulfilled. The record can now be closed.', options: choices },
    { id: 'complete', kind: 'complete', roomKey, text: 'The covenant is fulfilled.' });
  const story = { version: 1, id, title: divine ? 'A Divine Obligation' : String(task.type).toLowerCase() === 'deliver' ? 'A Debt Between Souls' :
    guards.length ? 'The Price of Recovery' : 'An Unfinished Covenant', hook,
    fallback: { name: writing.name, readableId: writing.id }, stages };
  writing.chapters[0].text = premise+' '+task.desc + (guards.length ? '\n'+stages.find(s=>s.kind==='encounter').text : '') +
    '\nThen conclude the covenant with '+(contact ? contact.name+'; if they cannot survive to witness it, use this tablet.' : 'this tablet.');
  const proposed = {...database,[roomKey]:{...room,inscriptions:[...(room.inscriptions||[]),writing]}};
  const next = { ...task, story, hardRequirements: [...(task.hardRequirements||[]),{ check: 'quest_story_complete', value: id, coords: roomKey }] };
  if (!valid(story,proposed)) return task;
  try { Q().taskBinding(next); } catch { return task; }
  room.inscriptions = proposed[roomKey].inscriptions;
  room.questStories ||= {}; room.questStories[id] = story;
  if(kind==='item') {
    const document=documents[0];document.questHooks ||= [];
    document.questHooks.push({source:'engine-quest-hook-v1',storyId:id,roomKey,text:stages[0].text});
  }
  if(contact && room.inhabitants?.actors?.[contact.name]) {
    const record=room.inhabitants.actors[contact.name]; record.questHooks ||= [];
    record.questHooks.push({storyId:id,roomKey,text:stages[0].text});
  }
  return next;
}
function valid(story,database) {
  if (story?.version !== 1 || typeof story.id!=='string' || !story.id || !Array.isArray(story.stages) ||
      story.stages.length < 3 || story.stages.length > 12 || story.stages.some(s=>!s||typeof s.id!=='string'||!s.id||typeof s.text!=='string')) return false;
  const nodes = new Map(story.stages.map(s=>[s.id,s]));
  if (nodes.size !== story.stages.length || !['dialogue','read'].includes(nodes.get('hook')?.kind) ||
      nodes.get('complete')?.kind!=='complete' || story.stages.filter(s=>s.kind==='objective').length!==1) return false;
  const visiting = new Set(), visited = new Set();
  function check(id) {
    if (visiting.has(id)) return false; if (visited.has(id)) return true;
    const s = nodes.get(id), room = s && database[s.roomKey];
    if (!s || !room?.name || !['dialogue','read','objective','encounter','complete',...(story.family==='regional-v1'?['escort']:[])].includes(s.kind)) return false;
    const reserved = name => story.family==='regional-v1' && room.regionalSite?.storyId===story.id && room.regionalSite.actors.some(a=>a.name===name);
    if (s.actor && s.kind!=='escort' && !residents(room).some(a=>a.name===s.actor) && !reserved(s.actor)) return false;
    if (s.kind==='read' && ![...(room.readables||[]),...(room.inscriptions||[])].some(r=>r.id===s.readableId&&r.name===s.name&&r.chapters?.[0]?.text?.trim())) return false;
    if (s.kind==='encounter' && (!s.targets?.length || s.targets.some(name=>!residents(room).some(a=>a.name===name&&I.allegiance(a,room.monsters?.state)==='Hostile') &&
      !(reserved(name)&&room.regionalSite.actors.some(a=>a.name===name&&a.allegiance==='Hostile'))))) return false;
    if(s.options!==undefined&&(!Array.isArray(s.options)||s.options.some(o=>!o||typeof o.id!=='string'||typeof o.label!=='string')))return false;
    const edges = [...(s.options?.map(o=>o.next) || (s.next ? [s.next] : [])),...(s.kind==='escort'&&s.recovery?[s.recovery]:[])];
    if (s.kind!=='complete' && !edges.length || s.kind==='complete' && edges.length ||
        s.options && new Set(s.options.map(o=>o.id)).size!==s.options.length || s.options?.some(o=>!o.id||
        !['continue','finish','recruit','receive'].includes(o.action) || ['receive','recruit'].includes(o.action)&&!s.actor ||
        o.action==='receive'&&!room.inhabitants?.actors?.[s.actor]?.inventory?.some(item=>item.name===o.item))) return false;
    visiting.add(id); const okay = edges.every(check); visiting.delete(id); visited.add(id); return okay;
  }
  return check('hook') && visited.size===nodes.size;
}
function runtime(task,database,create=false) {
  const home = database[task?.story?.hook.roomKey]; if (!home) return null;
  if (!home.questScenes && create) home.questScenes = {};
  let record = home.questScenes?.[task.story.id];
  if (!record && create) record = home.questScenes[task.story.id] = { source: 'engine-quest-scene-v1',
    taskBinding: Q().taskBinding(task), stage: 'hook', revision: 0, history: [], completed: false };
  return record?.source === 'engine-quest-scene-v1' && record.taskBinding === Q().taskBinding(task) ? record : null;
}
function isComplete(task,database) {
  if (!task?.story || !Array.isArray(task.story.stages)) return false;
  const r = runtime(task,database), nodes = new Map(task.story.stages.map(s=>[s.id,s]));
  if (!r?.completed || r.stage !== 'complete' || !Array.isArray(r.history) || !r.history.length || r.history.length > 12 ||
      r.revision!==r.history.length || new Set(r.history.map(h=>h?.id)).size!==r.history.length) return false;
  let stage='hook';
  for (const h of r.history) {
    const s=nodes.get(stage); if (!s || !h || h.source!=='engine-quest-stage-v1' || h.from!==stage || !h.id) return false;
    const expected=s.kind==='escort'&&h.choice==='recover' ? s.recovery : s.options ? s.options.find(o=>o.id===h.choice)?.next : s.next;
    if (h.to!==expected || h.evidence?.kind!==s.kind) return false;
    if(s.kind==='read') {
      const doc=[...(database[s.roomKey]?.readables||[]),...(database[s.roomKey]?.inscriptions||[])].find(r=>r.id===s.readableId);
      if(!Readables.hasContent(doc)||h.evidence.readableId!==doc.id||h.evidence.contentHash!==I.hash(doc.chapters[0].text))return false;
    }
    if(s.kind==='objective'&&(!h.evidence.checks?.length||h.evidence.checks.some(c=>c.passed!==true)))return false;
    if(s.kind==='encounter'&&!encounterResolved(s,database))return false;
    if(s.kind==='escort') {
      if(h.choice==='recover' ? h.evidence.source!=='engine-escort-recovery-v1' :
        h.evidence.source!=='engine-escort-arrival-v1'||h.evidence.actor!==s.actor||h.evidence.roomKey!==s.roomKey||!(h.evidence.hp>0))return false;
    }
    if(s.kind==='dialogue'&&h.evidence.source!=='engine-interaction-v1')return false;
    stage=h.to;
  }
  return stage==='complete';
}
function goal(task,database,text) {
  const checks=Q().evaluateTaskRequirements(task,{database,consoleText:text,roomKey:field(text,'Coordinates')}).checks
    .filter(c=>c.requirement.check!=='quest_story_complete');
  return checks.length>0&&checks.every(c=>c.passed===true);
}
function transition(record,stage,next,choice=null,evidence={}) {
  record.history.push({ id: randomUUID(), source:'engine-quest-stage-v1',from:stage.id,to:next,choice,
    evidence:{...evidence,kind:stage.kind},at:Date.now() });
  record.stage=next; record.revision++; record.completed=next==='complete';
}
function active(state) {
  const task=state.getCurrentTasks?.()?.[state.getCurrentTaskIndex?.()||0];
  if (!task?.story || task.status==='Completed') return null;
  let database; try {database=JSON.parse(state.getRoomNameDatabase()||'{}');}catch{return null;}
  const record=runtime(task,database,true); return record?{task,database,record}:null;
}
function encounterResolved(stage,database) {
  return stage.targets.every(name=> {
    const original=database[stage.roomKey]?.inhabitants?.actors?.[name];
    if(stage.defeatOnly&&original)return original.status==='dead'&&Number.isFinite(original.hp)&&original.hp<=0;
    if(original?.status==='recruited')return true;
    const sheets=Object.values(database).flatMap(roomSheets).filter(s=>s.name===name);
    return sheets.length>0 && sheets.every(s=>s.hp<=0);
  });
}
function refresh(state) {
  const current=state.getCurrentTasks?.()?.[state.getCurrentTaskIndex?.()||0];
  if(current?.story&&Q().deliveryBindings(current).length)require('./questDeliverySuccessors').ensure(state,state.getUpdatedGameConsole());
  const a=active(state); if(!a)return null;
  for(let i=0;i<12;i++) {
    const s=a.task.story.stages.find(s=>s.id===a.record.stage);
    if(s?.kind==='objective'&&goal(a.task,a.database,state.getUpdatedGameConsole()))transition(a.record,s,s.next,null,{checks:
      Q().evaluateTaskRequirements(a.task,{database:a.database,consoleText:state.getUpdatedGameConsole(),roomKey:field(state.getUpdatedGameConsole(),'Coordinates')}).checks.filter(c=>c.requirement.check!=='quest_story_complete')});
    else if(s?.kind==='encounter'&&encounterResolved(s,a.database))transition(a.record,s,s.next,null,{targets:s.targets});
    else if(s?.kind==='escort') {
      const member=I.parseSheets(state.getUpdatedGameConsole(),'NPCs in Party').find(p=>p.name===s.actor);
      const roster=JSON.parse(state.getCombatCharactersString()||'[]'), actor=roster.find(p=>p.name===s.actor&&p.type==='npc');
      const binding=a.task.requiredElements.find(e=>e.name===s.actor), rescued=a.database[binding?.placement]?.inhabitants?.actors?.[s.actor];
      if(rescued?.status!=='recruited'||rescued.regionalStoryId!==a.task.story.id)break;
      if(!member || !I.isAlive(member) || actor && !I.isAlive(actor)) {
        transition(a.record,s,s.recovery,'recover',{source:'engine-escort-recovery-v1',actor:s.actor});
      } else if(I.roomKey(field(state.getUpdatedGameConsole(),'Coordinates'))===s.roomKey && actor?.hp>0 && I.roomKey(actor.mazeRoomKey)===s.roomKey) {
        transition(a.record,s,s.next,null,{source:'engine-escort-arrival-v1',actor:s.actor,hp:Math.min(actor.hp,member.hp),roomKey:s.roomKey});
      } else break;
    }
    else break;
  }
  state.setRoomNameDatabase(JSON.stringify(a.database));
  const text=Q().writeQuestRequirements(state.getUpdatedGameConsole(),a.task,a.database);state.setUpdatedGameConsole(text);
  return a;
}
function describe(task,database) {
  if (!task?.story) return '';
  const r=runtime(task,database),stage=task.story.stages.find(s=>s.id===(r?.stage||'hook'));
  if(!stage)return '';
  if(task.story.family==='regional-v1') {
    const action=stage.kind==='read'?`Read "${stage.name}"`:stage.kind==='encounter'?`Defeat ${stage.targets.join(' and ')}`:
      stage.kind==='escort'?`Escort ${stage.actor} alive, in the party`:stage.kind==='objective'?stage.text:stage.kind==='complete'?'Regional obligation resolved':`Quest Conversation with ${stage.actor}`;
    const dead=stage.actor&&stage.fallback&&(database[stage.roomKey]?.inhabitants?.actors?.[stage.actor]?.status==='dead'||roomSheets(database[stage.roomKey]).some(a=>a.name===stage.actor&&I.state(a)==='Dead'));
    return `${task.story.title}: ${dead?'Use "'+stage.fallback.name+'" after '+stage.actor+'\'s death':action} in ${database[stage.roomKey]?.name} (${stage.roomKey}). `+
      'Reading, combat, escort arrival or the alternate prison testimony, and an explicit faction decision must be verified. '+
      'The existing boss-key retrieval and bound boss fight follow this regional step.';
  }
  const room=database[stage.roomKey]?.name || task.story.hook.roomName;
  const binding=Q().deliveryBindings(task).find(b=>b.recipient===stage.actor&&b.coords===stage.roomKey);
  const speaker=binding?Q().deliveryRecipient(task,database,binding).name:stage.actor;
  const fallback=stage.actor && !Q().deliveryBindings(task).some(b=>b.recipient===stage.actor) &&
    (database[stage.roomKey]?.inhabitants?.actors?.[stage.actor]?.status==='dead'||roomSheets(database[stage.roomKey]).some(a=>a.name===stage.actor&&I.state(a)==='Dead'));
  const action=fallback?`Read "${task.story.fallback.name}" to continue after ${stage.actor}'s death`:stage.kind==='read'?`Read "${stage.name}"`:stage.kind==='encounter'?`Defeat or recruit ${stage.targets.join(' and ')}`:
    stage.kind==='objective'?stage.text:stage.kind==='complete'?'Story resolved':stage.actor?`Speak with ${speaker}`:`Read "${stage.name}" and close the record`;
  const encounter=task.story.stages.find(s=>s.kind==='encounter'),resolution=task.story.stages.find(s=>s.id==='resolution');
  const finalBinding=Q().deliveryBindings(task).find(b=>b.recipient===resolution.actor&&b.coords===resolution.roomKey);
  const finalDead=!finalBinding&&resolution.actor&&(database[resolution.roomKey]?.inhabitants?.actors?.[resolution.actor]?.status==='dead'||
    roomSheets(database[resolution.roomKey]).some(a=>a.name===resolution.actor&&I.state(a)==='Dead'));
  const conclusion=finalDead?task.story.fallback.name:finalBinding?Q().deliveryRecipient(task,database,finalBinding).name:resolution.actor||resolution.name;
  return `${task.story.title}: ${action} in ${room} (${stage.roomKey}). Stage ${task.story.stages.findIndex(s=>s.id===stage.id)+1}/${task.story.stages.length}.`+
    (encounter?` Required encounter: ${encounter.text}`:'')+
    ` Finish with ${conclusion} in ${database[resolution.roomKey]?.name} (${resolution.roomKey}); explicit resolution is required.`;
}
function context(state,a,actorName) {
  const coords=state.getLastCoords(),geoKey=`${coords.x},${coords.y},${coords.z}`,s=a.task.story.stages.find(s=>s.id===a.record.stage);
  const text=state.getUpdatedGameConsole(),dungeon=state.getRoomDungeonForSimulation?.(coords)||state.getRoomDungeon?.(coords);
  const roster=JSON.parse(state.getCombatCharactersString()||'[]'),pc=roster.find(a=>a.type==='pc'&&(a.hp??1)>0);
  if(I.roomKey(field(text,'Coordinates'))!==geoKey||s.roomKey!==geoKey||!pc)return {error:'Travel to the named scene room first.'};
  const delegated=s.actor&&Q().deliveryBindings(a.task).find(b=>b.recipient===s.actor&&b.coords===geoKey);
  let name=delegated?Q().deliveryRecipient(a.task,a.database,delegated).name:s.actor;
  const dead=!delegated && s.actor && (a.database[geoKey]?.inhabitants?.actors?.[s.actor]?.status==='dead'||
    roomSheets(a.database[geoKey]).some(a=>a.name===s.actor&&I.state(a)==='Dead'));
  const writingName=dead?(s.fallback||a.task.story.fallback).name:s.name;
  if(dead)name=null;
  const actor=roster.find(c=>c.name===name),pop=structuredClone(state.getRoomPopulation?.(geoKey)||a.database[geoKey]?.inhabitants||null);
  if(actorName&&key(actorName)!==key(name)&&key(actorName)!==key(writingName))return {error:'That character has no interaction in this quest stage.'};
  if(name) {
    const p=pc.mazePoint||{x:pc.mazeX+.5,y:pc.mazeY+.5},reach=actor&&I.dialogueReach(dungeon,actor,p);
    if(!actor||!I.isPresent(actor,pop)||actor.discoveryState==='pending'||!reach?.lineOfSight||!reach.canSpeak||reach.distance>3)
      return {error:`Move closer to ${name}; this scene needs a living, visible participant.`};
  } else if(writingName) {
    const plan=prepareRead({input:'read '+writingName,consoleText:text,database:a.database,dungeon,actor:pc,geoKey});
    if(!plan?.allowed)return {error:plan?.message||'Approach the named writing first.'};
  }
  return {s,coords,geoKey,text,dungeon,roster,pc,actor,record:actor&&pop?.actors?.[actor.name],population:pop,dead,writingName};
}
function view(state,actorName) {
  const a=refresh(state);if(!a)return {error:'No staged quest is active.'};
  const c=context(state,a,actorName);if(c.error)return c;
  const s=c.s, options=(s.kind==='read'?[]:s.options||[]).filter(o=> {
    if(!['receive','recruit'].includes(o.action))return true;
    if(c.dead||!c.actor||c.actor.type==='npc'||I.allegiance(c.actor)==='Hostile')return false;
    if(o.action==='recruit'&&!Pantheon.canRecruit(c.actor))return false;
    return o.action!=='receive'||c.record?.inventory?.some(item=>key(item.name)===key(o.item));
  }).map(o=>({...o,label:s.actor&&c.actor&&s.actor!==c.actor.name?o.label.replace(s.actor,c.actor.name):o.label}));
  if(s.kind==='objective')for(const b of Q().deliveryBindings(a.task)) {
    const done=Q().evaluateTaskRequirements(a.task,{database:a.database,consoleText:c.text,roomKey:c.geoKey}).checks
      .some(v=>v.requirement.check==='item_delivered'&&v.requirement.item===b.item&&v.passed===true);
    if(!done&&key(Q().deliveryRecipient(a.task,a.database,b).name)===key(c.actor?.name))options.push({id:'give:'+b.item,label:'Give '+b.item,action:'give',item:b.item});
  }
  if(s.kind==='read')options.push({id:'read',label:'Read '+s.name,action:'read'});
  if(s.kind==='encounter')for(const name of s.targets)if(c.roster.some(a=>a.name===name&&a.hp>0&&a.type==='monster'))
    options.push({id:'attack:'+name,label:'Attack '+name,action:'attack',target:name});
  return {scene:{storyId:a.task.story.id,title:a.task.story.title,stageId:s.id,revision:a.record.revision,
    roomKey:s.roomKey,actor:c.actor?.name||null,text:c.dead?`${s.actor} has died. The surviving ${c.writingName} records the remaining obligation.`:
      s.actor&&c.actor&&s.actor!==c.actor.name?s.text.replace(s.actor+':',c.actor.name+':')+'\nActing for '+s.actor+'.':s.text,
    options,description:describe(a.task,a.database)}};
}
function onRead(state,plan) {
  if(!plan?.allowed||plan.inspect)return;
  const a=active(state);if(!a)return;
  const s=a.task.story.stages.find(s=>s.id===a.record.stage);
  if(s?.id==='hook'&&s.kind==='dialogue'&&a.task.story.fallback.readableId===plan.record.id&&s.roomKey===plan.sourceKey) {
    const c=context(state,a);
    if(!c.error&&c.dead) {
      transition(a.record,s,s.options[0].next,s.options[0].id,{source:'engine-interaction-v1',readableId:plan.record.id});
      state.setRoomNameDatabase(JSON.stringify(a.database));refresh(state);
    }
    return;
  }
  if(s?.kind!=='read'||s.readableId!==plan.record.id||s.roomKey!==plan.sourceKey)return;
  if(plan.chapter!==1)return;
  transition(a.record,s,s.options[0].next,s.options[0].id,{readableId:plan.record.id,contentHash:I.hash(plan.record.chapters[0].text)});
  state.setRoomNameDatabase(JSON.stringify(a.database));refresh(state);
}
function inventoryWrite(text,items,properties) {
  return write(write(text,'Inventory',items.join(', ')||'Empty'),'Inventory Properties',properties.map(o=>JSON.stringify(o)).join(', ')||'None');
}
function recruitmentGuard(state,input) {
  const refusal = Pantheon.recruitmentRefusal(input, JSON.parse(state.getCombatCharactersString?.() || '[]'));
  if (refusal) return { actionOnly: true, content: refusal };
  const match=/^(?:add|invite|recruit)\s+(.+?)(?:\s+to\s+(?:the\s+)?party)?$/i.exec(String(input).trim());
  if (match) {
    const db = JSON.parse(state.getRoomNameDatabase() || '{}');
    const targets = Object.values(db).flatMap(r => Object.values(r?.minorMissions || {}))
      .filter(m => m.type === 'raid' && m.status !== 'completed').flatMap(m => m.targets || []);
    const defender = targets.find(name => key(name) === key(match[1]) || key(name).startsWith(key(match[1]) + ' '));
    if (defender) return { actionOnly: true, content: `${defender} is a bound defender in a divine temple raid and will not join the party. The listed mission requires their defeat.` };
  }
  const a=match&&active(state);if(!a)return null;
  if(a.task.story.family==='regional-v1') {
    const bound=a.task.story.stages.flatMap(s=>[s.actor,...(s.targets||[])]).filter(Boolean)
      .find(name=>key(name)===key(match[1])||key(name).startsWith(key(match[1])+' '));
    if(bound)return {actionOnly:true,content:`${bound} belongs to a staged regional encounter. Use its Quest Conversation choices; defenders must be defeated and the prisoner can join after the rescue stage opens.`};
  }
  const contact=a.task.story.stages.find(s=>s.id==='resolution')?.actor;
  const binding=contact&&Q().deliveryBindings(a.task).find(b=>b.recipient===contact);
  const name=binding?Q().deliveryRecipient(a.task,a.database,binding).name:contact;
  if(!name||key(match[1])!==key(name)&&!key(name).startsWith(key(match[1])+' '))return null;
  return {actionOnly:true,content:`${name}'s invitation is part of the quest bargain. Fulfill the listed objective, then use Quest Conversation to choose whether they join. This preserves the pending handoff and other obligations.`};
}
function choose(state,service,request) {
  if(state.getGamePaused?.())return {error:'Resume the game before choosing.',status:409};
  const a=active(state);if(!a)return {error:'No staged quest is active.',status:409};
  const coords=state.getLastCoords(),geoKey=`${coords.x},${coords.y},${coords.z}`;
  if(request.runId!==state.getDungeonRunId()||request.geoKey!==geoKey||request.storyId!==a.task.story.id||
    request.stageId!==a.record.stage||request.revision!==a.record.revision)return {error:'That quest choice is stale. Open the conversation again.',status:409};
  const c=context(state,a);if(c.error)return {...c,status:409};
  const offered=view(state),option=offered.scene?.options.find(o=>o.id===request.optionId);
  if(!option)return {error:'That choice is not available in this stage.',status:409};
  // View may have advanced a mechanically completed objective while validating the request.
  if(offered.scene.stageId!==request.stageId||offered.scene.revision!==request.revision)return {error:'The scene advanced. Open its current choices.',status:409};
  if(option.action==='give') {
    const result=require('./itemTransfer').give(state,service,`give ${option.item} to ${c.actor.name}`);refresh(state);
    return {...result,updatedGameConsole:state.getUpdatedGameConsole()};
  }
  if(option.action==='read') {
    const plan=prepareRead({input:'read '+c.s.name,consoleText:c.text,database:a.database,dungeon:c.dungeon,actor:c.pc,geoKey});
    if(!plan?.allowed)return {error:plan?.message||'The writing cannot be read.',status:409};
    onRead(state,plan);return {content:plan.message,actionOnly:true};
  }
  if(option.action==='attack')return {command:'attack '+option.target,actionOnly:true};
  if(c.s.id==='resolution'&&!goal(a.task,a.database,c.text))return {error:'The bound objective is no longer satisfied. Restore its listed requirements first.',status:409};
  const items=field(c.text,'Inventory').split(',').map(s=>s.trim()).filter(s=>s&&!/^(none|empty)$/i.test(s));
  const properties=Inventory.parseProperties(field(c.text,'Inventory Properties'));
  let text=c.text, content=c.s.text;
  if(['receive','recruit'].includes(option.action)) {
    if(option.action==='recruit'&&!Pantheon.canRecruit(c.actor))return {error:'Divine visitors cannot join the party.',status:409};
    if(!c.actor||!c.record||c.actor.type==='npc'||I.allegiance(c.actor)==='Hostile')return {error:'This character cannot accept that bargain.',status:409};
    const loose=c.record.inventory||[],transfer=option.action==='receive'?loose.filter(o=>key(o.name)===key(option.item)).slice(0,1):loose;
    if(option.action==='receive'&&!transfer.length)return {error:'That item is no longer in this character\'s inventory.',status:409};
    if(transfer.some(o=>!o.name||isReservedBossKeyName(a.database,o.name)||items.some(n=>key(n)===key(o.name)))||
      new Set(transfer.map(o=>key(o.name))).size!==transfer.length)return {error:'The transfer would duplicate or conflict with a carried item. Choose another conclusion.',status:409};
    if(option.action==='recruit'&&I.parseSheets(text,'NPCs in Party').length>=12)return {error:'The party is full; conclude the bargain separately instead.',status:409};
    if(items.length+transfer.length>25)return {error:'The party cannot carry that many loose items. Make room or choose a separate conclusion.',status:409};
    for(const item of transfer){items.push(item.name);properties.push(structuredClone(item));}
    c.record.inventory=loose.filter(o=>!transfer.includes(o));text=inventoryWrite(text,items,properties);
    if(option.action==='receive')content=`${c.actor.name} gives you the ${option.item}.`;
    else {
      const sheet=I.parseSheets(text).find(s=>s.name===c.actor.name);if(!sheet)return {error:'The character sheet could not be verified.',status:409};
      c.record.status='recruited';c.actor.type='npc';c.actor.state='Friendly';
      let block=sheet.rawSheet.replace(/^[ \t]*State:[^\r\n]*/m,'State: Friendly');
      text=text.replace(I.sectionPattern('NPCs in Party'),(whole,head,body)=>head+'\n'+(/^\s*None\s*$/i.test(body)?'':body.trim()+'\n')+block+'\n');
      const live=I.residentSheets(c.population).filter(s=>s.name!==c.actor.name).map(s=>s.rawSheet||s.sheet).join('\n')||'None';
      text=text.replace(I.sectionPattern('Monsters in Room'),(whole,head)=>head+'\n'+live+'\n');
      content=`${c.actor.name} joins the party under the agreed bargain. Loose items join the party inventory; equipped gear stays equipped.`;
    }
    a.database[c.geoKey].inhabitants=c.population;
  }
  transition(a.record,c.s,option.next,option.id,{source:'engine-interaction-v1',actor:c.actor?.name||null,
    action:option.action,item:option.item||null});
  const assessment=Q().evaluateTaskRequirements(a.task,{database:a.database,consoleText:text,roomKey:geoKey});
  if(a.record.completed&&!Q().verifiedTaskCompletion(a.task,assessment))return {error:'The resolution no longer satisfies its completion contract.',status:409};
  if(a.record.completed&&option.factionEffects)Factions.record(a.database,state.getDungeonRunId(),{
    id:a.task.story.id+':resolution',storyId:a.task.story.id,choice:option.id,roomKey:geoKey,
    summary:option.label, effects:option.factionEffects});
  if(a.record.completed)require('./adventureJournal').archive(a.database,a.task);
  state.setRoomNameDatabase(JSON.stringify(a.database));state.setUpdatedGameConsole(text);
  if(option.action==='recruit')state.setCombatCharactersString(JSON.stringify(c.roster));
  if(c.population&&['receive','recruit'].includes(option.action))service.save(c.population);
  if(a.record.completed) {
    const tasks=state.getCurrentTasks(),index=state.getCurrentTaskIndex()||0;
    a.task.status='Completed';a.task.progress=Q().mergeTaskProgress(a.task.progress,assessment);tasks[index]=a.task;
    state.setCurrentTasks(tasks);state.setCurrentTaskIndex(index+1);state.setQuestSeeded(false);
    state.setLastQuestUpdate?.('Task completed: '+a.task.desc);
    text=write(state.getUpdatedGameConsole(),'Quest Progress',`Step ${index+1}/3: Completed; verified objective and story resolution. ${a.task.desc}`);
    text=Q().writeQuestRequirements(text,a.task,a.database);state.setUpdatedGameConsole(text);
    content+='\nQuest step completed by verified actions.';
  } else refresh(state);
  return {content,actionOnly:true,population:c.population};
}
module.exports={compile,valid,runtime,isComplete,describe,refresh,view,choose,onRead,recruitmentGuard};
