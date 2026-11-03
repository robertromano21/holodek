'use strict';
const {createHash}=require('node:crypto');
const Balance=require('./encounterBalance');
const coordinate=/^-?\d+,-?\d+,-?\d+$/;
const SAFE_VENUES=new Set(['shop','temple','clinic','inn','bar','foodhall','bathhouse','library','home','house','guild','guildhall','workshop','civic','court','transit','theatre','warehouse']);
function unit(seed){return createHash('sha256').update(String(seed)).digest().readUInt32BE(0)/4294967296;}
function disposition(roll){return roll<.6?'Hostile':roll<.8?'Neutral':'Friendly';}
function profile(room={},key,{indoor,hostileTemple=false}={}){
  if(key==='0,0,0'&&!room.cityFloorContext)return 'starting';
  if(room.builder?.mode==='hand'||room.regionalSite?.actors?.length)return 'scripted';
  if(hostileTemple)return 'hostile-temple';
  if(room.encounterDanger==='safe')return 'safe';
  if(room.encounterDanger==='dangerous')return 'dangerous';
  const type=room.cityRoom?.venue?.type||room.campaignSetting?.city?.venue?.type||room.cityRoom?.establishmentType;
  const inside=room.cityFloorContext?true:indoor??room.classification?.indoor??room.indoor;
  if(inside!==false&&SAFE_VENUES.has(type))return 'safe';
  if(inside!==false&&['inn','house','guildhall','temple','roman_temple','byzantine_basilica','deity_temple'].includes(room.campaignSetting?.siteKind))return 'safe';
  return 'dangerous';
}
function reserve(db,key,{seed=''}={}){
  const room=db[key];
  if(!coordinate.test(key||'')||!room||profile(room,key)==='starting'||profile(room,key)==='scripted')return null;
  if([1,2].includes(room.encounterRoll?.version))return room.encounterRoll;
  // A release upgrade must never rebalance an already authored cast.
  if(room.inhabitants?.authoredAt||room.inhabitants?.initialSheets||Object.keys(room.inhabitants?.actors||{}).length)return null;
  room.encounterRoll={version:2,runId:seed,seed:`${seed}:${key}:encounter-dispositions`};
  return room.encounterRoll;
}
function budget(room,key,reservation,{party=[],indoor,hostileTemple=false,roll=.5}={}){
  const kind=profile(room,key,{indoor,hostileTemple});
  if(['scripted','hostile-temple'].includes(kind))return null;
  if(kind==='dangerous'&&!reservation)return null;
  const target=Balance.groupSize(Balance.partySummary(party).size,roll);
  // Legacy reservations retain their identity, not the superseded room-level hostile quota.
  const seed=reservation?.seed||`${reservation?.runId||''}:${key}:encounter-dispositions`;
  return{version:2,profile:kind,seed,target,groups:[]};
}
function apply(slots,budget,{random=index=>unit(`${budget.seed}:${index}`)}={}){
  const eligible=slots.filter(s=>s.slot>=3&&!s.serviceRole&&s.encounterId!=='quest-contact');
  for(const slot of slots)if(slot.slot>=3)slot.peaceful=true;
  const sizes=budget.profile==='dangerous'?Balance.partition(eligible.length,budget.target):[];
  budget.groups=[];
  let offset=0;
  sizes.forEach((size,index)=>{
    const roll=random(index);if(!Number.isFinite(roll)||roll<0||roll>=1)throw Error('Invalid encounter disposition roll.');
    const allegiance=disposition(roll),cohort=`rolled-encounter-${index+1}`,members=eligible.slice(offset,offset+=size);
    budget.groups.push({cohort,size,allegiance,slots:members.map(slot=>slot.slot)});
    for(const slot of members){
      delete slot.peaceful;delete slot.unitId;delete slot.venueDuty;
      Object.assign(slot,{engineEncounter:true,engineThreat:allegiance==='Hostile',cohort,cohortSize:size,cohortAllegiance:allegiance,
        fixedHomeSite:'commons',routine:allegiance==='Hostile'?'patrol':'wander'});
    }
  });
}
module.exports={unit,disposition,profile,reserve,budget,apply};
