'use strict';
// Compatibility for older clients: an invitation never supplies the resident's consent.
const {randomUUID}=require('node:crypto'),I=require('../assets/dungeonInhabitants'),F=require('./residentFavors'),Reach=require('./dungeonReach');
const key=s=>String(s || '').trim().toLowerCase();
function dispositionOf(actor,record){return I.allegiance(record || actor,I.allegiance(actor,'Neutral'));}
function hostileInvitation(state,input){
  if(state.getGamePaused?.() || !F.invitationIntent(input))return null;
  const coords=state.getLastCoords(),geoKey=`${coords.x},${coords.y},${coords.z}`,roster=JSON.parse(state.getCombatCharactersString() || '[]');
  const population=state.getRoomPopulation?.(geoKey),pc=roster.find(a=>a.type==='pc' && I.canAct(a)),player=Reach.position(pc,geoKey);
  const dungeon=state.getRoomDungeonForSimulation?.(coords);
  const residents=roster.filter(a=>a.type==='monster' && I.canAct(a) && I.isPresent(a,population) && I.hasEncountered(a,population) &&
    I.dialogueReach(dungeon,a,player,{conversation:true}).lineOfSight);
  const addressed=require('../assets/dialogueAudience').resolve(String(input).replace(/^\s*add\s+(.+?)\s+to\s+(?:the\s+)?party[.!?]*\s*$/i,'ask $1 to join my party.').replace(/^(?:i\s+)?(?:invite|recruit)\s+/i,'ask '),roster,residents.map(a=>a.name));
  return residents.find(a=>addressed.responders.includes(a.name) && dispositionOf(a,population?.actors?.[a.name])==='Hostile') || null;
}
function invite(state,service,name){
  name=String(name || '').trim();if(!name)throw Error('Name the creature you want to invite.');
  if(state.getGamePaused?.())throw Error('Resume the game before inviting anyone.');
  const coords=state.getLastCoords(),geoKey=`${coords.x},${coords.y},${coords.z}`,roster=JSON.parse(state.getCombatCharactersString() || '[]');
  const actor=roster.find(a=>a.type==='monster' && key(a.name)===key(name)),db=JSON.parse(state.getRoomNameDatabase() || '{}');
  const population=state.getRoomPopulation?.(geoKey) || db[geoKey]?.inhabitants,record=population?.actors?.[actor?.name];
  const dungeon=state.getRoomDungeonForSimulation?.(coords),pc=roster.find(a=>a.type==='pc' && I.canAct(a)),player=Reach.position(pc,geoKey);
  if(!actor || !record || record.status!=='present' || !I.canAct(actor) || !I.canAct(record) || !I.hasEncountered(actor,population) ||
      !I.dialogueReach(dungeon,actor,player,{conversation:true}).lineOfSight)throw Error(`${name} is not available for this invitation.`);
  if(actor.recruitable===false || record.recruitable===false || !require('../assets/pantheonCharacters').canRecruit(actor))throw Error(`${actor.name} cannot join the party.`);
  const payload={updatedGameConsole:state.getUpdatedGameConsole(),combatCharactersString:state.getCombatCharactersString(),roomNameDatabaseString:state.getRoomNameDatabase(),population,disposition:dispositionOf(actor,record)};
  if(payload.disposition==='Hostile')return {...payload,attack:true,content:`${actor.name} answers your invitation with violence!`};
  if(F.recruitmentRefusal(state,actor.name))return {...payload,rejected:true,content:F.refusalMessage(actor.name)};
  const guard=require('./questScenes').recruitmentGuard(state,`add ${actor.name} to party`);if(guard)return {...payload,...guard};
  return {...payload,dialogueRequired:true,command:`Ask ${actor.name} to join my party.`,content:`Invite ${actor.name} in conversation so they can decide whether to join.`};
}
function install(app,state,{populationService,busy}={}){
  app.post('/recruit/invite',(req,res)=>{
    if(busy?.() || state.getGamePaused?.())return res.status(409).json({error:'The simulation is busy or paused.'});
    const coords=state.getLastCoords();
    if(req.body?.runId!==state.getDungeonRunId() || req.body?.geoKey!==`${coords.x},${coords.y},${coords.z}` ||
        req.body?.floorToken!==require('./hostLocalFloors').token(state))return res.status(409).json({error:'The invitation belongs to a different room or game.'});
    try{res.json({type:'economy_result',passive:true,eventId:randomUUID(),runId:state.getDungeonRunId(),geoKey:req.body.geoKey,...invite(state,populationService,req.body?.name)});}
    catch(error){res.status(409).json({error:error.message});}
  });
}
module.exports={invite,dispositionOf,hostileInvitation,install};
