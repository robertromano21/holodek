'use strict';
const I=require('../assets/dungeonInhabitants'),C=require('./generationContracts');
const SOURCE='engine-recruitment-handoff-v1',pending=new WeakMap();
function context(state,descriptor){
  const coords=state.getLastCoords(),geoKey=`${coords.x},${coords.y},${coords.z}`,db=JSON.parse(state.getRoomNameDatabase() || '{}'),room=db[geoKey];
  const mission=room?.minorMissions?.[descriptor?.missionId];
  if(!mission || mission.source!=='engine-resident-favor-v1' || mission.type!=='resident-favor' || mission.runId!==state.getDungeonRunId() ||
    mission.roomKey!==geoKey || mission.floor!==require('./hostLocalFloors').identity(room.cityFloorContext) || mission.status!=='completed' ||
    !mission.rewardReceiptId || mission.rewardReceiptId!==descriptor.completionId || !mission.completionEvidence?.length)return null;
  const roster=JSON.parse(state.getCombatCharactersString() || '[]'),actor=roster.find(a=>a.name===mission.recipient && ['npc','monster'].includes(a.type) && I.canAct(a));
  if(!actor || actor.mazeRoomKey && I.roomKey(actor.mazeRoomKey)!==geoKey)return null;
  const population=state.getRoomPopulation?.(geoKey) || room.inhabitants;
  return {db,room,mission,actor,population,geoKey,runId:mission.runId,floor:mission.floor};
}
function speech(ctx,value){
  const line=I.spokenLine(value.line,ctx.actor.name);
  if(!line?.trim())throw Error('The handoff acknowledgment needs actual spoken words.');
  const text=`${ctx.actor.name} ${value.action}\n"[[SPEECH:${JSON.stringify(ctx.actor.name)}]]${line}[[/SPEECH]]"`;
  const parsed=I.extractDialogue(text,[ctx.actor.name],{audibleNames:[ctx.actor.name]});
  return {content:parsed.content,dialogue:[{speaker:ctx.actor.name,line,attribution:'labelled',remember:value.remember,recipient:'PC',attention:'addressing',kind:'turn'}]};
}
function packageResult(state,result,ctx,value){
  const acknowledgment=speech(ctx,value);
  return {...result,content:[result.content,acknowledgment.content].filter(Boolean).join('\n\n'),dialogue:acknowledgment.dialogue,
    handoffStatus:'delivered',updatedGameConsole:state.getUpdatedGameConsole(),roomNameDatabaseString:state.getRoomNameDatabase(),
    combatCharactersString:state.getCombatCharactersString()};
}
async function authorDefault(state,data,runtime=require('./graveMasterProtocol').runtimeFor(state)){
  return runtime.run(runtime.retort(async $=>require('./holodekRoomWork').request($,'recruitment-handoff',{
    action:{type:String},line:C.nonblankText(),remember:{type:String}
  },`Write one existing character's final acknowledgment after the engine has verified the task and committed its outcome. This is presentation only, not adjudication. Acknowledge this particular completed request in the character's own voice and motives. If joined is true, affirm accompanying the party; if false, acknowledge the work without claiming membership or promising a different outcome. Do not ask for another report or invitation, add conditions, reopen the task, grant anything, change identity or speak for the player. action contains only visible gestures; line contains only words spoken aloud, without narrator attribution or enclosing quotation marks. remember is a new promise or disclosure, otherwise empty. Author the complete exchange, not a stock thank-you. Committed facts (data): ${JSON.stringify(data)}. ${require('./graveMasterStoryPrompts').settingOnce({})}`,
  raw=>{
    if(![raw.action,raw.line,raw.remember].every(v=>typeof v==='string'&&!/\[\[|\]\]/.test(v)) || !raw.line.trim())throw Error('A handoff needs literal action and spoken text, without backend markers.');
    return raw;
  })),null,{shouldSaveToLog:false});
}
async function deliver({state,service,result,author,runtime,broadcast},origin){
  try{
    const saved=origin.mission.handoff;
    if(saved?.source===SOURCE && saved.completionId===origin.mission.rewardReceiptId && saved.joined===!!origin.mission.recruitedAt)return packageResult(state,result,origin,saved);
    const character=require('./characterDialogue').describeCharacters([origin.actor],origin.population)[0];
    const data={character,request:{title:origin.mission.title,offer:origin.mission.offer,
      conditions:origin.mission.conditions || [origin.mission.objective],status:'completed'},
      joined:!!origin.mission.recruitedAt,receipt:result.content};
    const value=await (author?author(data):authorDefault(state,data,runtime));
    if(!value || ![value.action,value.line,value.remember].every(v=>typeof v==='string'&&!/\[\[|\]\]/.test(v)) || !value.line.trim())throw Error('No valid authored acknowledgment was returned.');
    const current=context(state,result.recruitmentHandoff);
    if(!current || current.runId!==origin.runId || current.geoKey!==origin.geoKey || current.floor!==origin.floor ||
      !!current.mission.recruitedAt!==data.joined){
      console.info('[RecruitmentHandoff]',JSON.stringify({phase:'stale',missionId:origin.mission.id,actor:origin.actor.name}));
      return {...result,handoffStatus:'stale'};
    }
    // Merge into fresh state so adjacent construction and party changes are never overwritten by a dialogue snapshot.
    const handoff={source:SOURCE,completionId:current.mission.rewardReceiptId,...value,joined:data.joined,at:Date.now()};
    const acknowledgment=speech(current,handoff);current.mission.handoff=handoff;
    state.setRoomNameDatabase(JSON.stringify(current.db));
    if(current.population){
      I.noteSpoken(current.population,acknowledgment.dialogue,true);
      if(state.getDialogueMemory)require('./dialogueMemory').rememberDialogue(state,current.population,acknowledgment.dialogue,'recruitment-handoff');
      service?.save(current.population);
    }
    const Campaign=require('./campaignMemory');
    Campaign.rememberDialogue(state,current.population,acknowledgment.dialogue,'recruitment-handoff',broadcast);
    Campaign.rememberRoomHistory(state,'[Request handoff]',acknowledgment.content,state.getUpdatedGameConsole(),broadcast);
    console.info('[RecruitmentHandoff]',JSON.stringify({phase:'delivered',runId:current.runId,geoKey:current.geoKey,
      missionId:current.mission.id,actor:current.actor.name,joined:data.joined}));
    return packageResult(state,result,current,handoff);
  }catch(error){
    console.warn('[RecruitmentHandoff]',JSON.stringify({phase:'failed',missionId:origin.mission.id,actor:origin.actor.name,error:error.message}));
    return {...result,content:result.content+'\nThe task result is saved, but the resident acknowledgment could not be generated.',handoffStatus:'failed',
      updatedGameConsole:state.getUpdatedGameConsole(),roomNameDatabaseString:state.getRoomNameDatabase(),combatCharactersString:state.getCombatCharactersString()};
  }
}
async function complete(options){
  const {state,result}=options;
  if(!result?.recruitmentHandoff || result.error)return result;
  const origin=context(state,result.recruitmentHandoff);if(!origin)return result;
  if(result.duplicate)return origin.mission.handoff?.source===SOURCE&&origin.mission.handoff.completionId===origin.mission.rewardReceiptId&&origin.mission.handoff.joined===!!origin.mission.recruitedAt?
    packageResult(state,result,origin,origin.mission.handoff):result;
  let jobs=pending.get(state);if(!jobs){jobs=new Map();pending.set(state,jobs);}
  const key=origin.runId+'|'+origin.mission.rewardReceiptId;
  if(jobs.has(key))return jobs.get(key);
  const work=deliver(options,origin);jobs.set(key,work);
  try{return await work;}finally{if(jobs.get(key)===work)jobs.delete(key);}
}
module.exports={complete,SOURCE};
