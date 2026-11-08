'use strict';
const Rules=require('../assets/economyRules');
function active(geoKey,room,db) {
  return Rules.isStarterRoom(geoKey,room) && !require('./settingLayer').current() && db?.['0,0,0']?.setting?.kind!=='homebrew';
}
function plan(slots,{random=Math.random}={}) {
  if(!slots.length)return;
  slots[0].starterRecruitmentRole='favor';
  const roll=Number(random());
  if(!Number.isFinite(roll)||roll<0||roll>=1)throw Error('Starter guardian roll must be a unit interval value.');
  if(slots.length>1 && roll<.7)Object.assign(slots.at(-1),{starterRecruitmentRole:'guardian',recruitable:false});
  return {version:1,guardianRoll:roll};
}
function guidance(slots) {
  const roles=slots.filter(s=>s.starterRecruitmentRole).map(s=>({slot:s.slot,role:s.starterRecruitmentRole}));
  return roles.length ? 'COTG STARTER RECRUITMENT '+JSON.stringify(roles)+': favor=welcome the player, carry on your work or converse when approached; do not offer recruitment, mention joining or traveling together, or invent an invitation. Only after the player actually invites you, discuss a small local request as a joining condition. The engine supplies verified local objectives then. guardian=stay tending and guarding the temple entrance; greet or carry on your work normally, and kindly explain that you remain here only when invited. Never promise to join. Keep these roles in personal motives and voice. No shops, commercial jobs, new objects or invented puzzle solutions.' : '';
}
function record(population,plan) {
  if(!plan)return;
  const actors=Object.values(population.actors);
  population.starterRecruitment={...plan,favorActor:actors.find(a=>a.starterRecruitmentRole==='favor')?.name,
    guardianActor:actors.find(a=>a.starterRecruitmentRole==='guardian')?.name || null};
}
function favor(room,mission,runId) {
  const group=room?.recruitmentInvitations?.[mission?.recruitmentGroupId];
  return !!room?.inhabitants?.starterRecruitment && mission?.starterRecruitment===true && mission.type==='resident-favor' &&
    mission.source==='engine-resident-favor-v1' && mission.runId===runId && mission.roomKey==='0,0,0' &&
    (mission.recipient===room.inhabitants.starterRecruitment.favorActor || group?.source==='engine-recruitment-group-v1' &&
      group.runId===runId && group.roomKey===mission.roomKey && group.floor===mission.floor &&
      group.members.some(m=>m.name===mission.recipient && m.missionId===mission.id) &&
      room.inhabitants.actors?.[mission.recipient]?.recruitable!==false);
}
module.exports={active,plan,guidance,record,favor};
