'use strict';
const I=require('../assets/dungeonInhabitants');
function route(db,from,to){
  const queue=[{key:from,via:[]}],seen=new Set([from]);
  for(let n=0;n<queue.length&&n<256;n++){
    const p=queue[n];if(p.key===to)return p.via;if(p.via.length>=20)continue;
    const links=Object.entries(db[p.key]?.exits||{});
    for(const connection of Object.values(db[p.key]?.cityInteriors?.buildings||{})){
      const target=db[connection.groundKey];
      if(target?.cityRoom?.frontage?.sourceKey===p.key&&target.cityRoom.frontage.buildingId===connection.buildingId)
        links.push([`enter ${target.name}`,{status:'open',targetCoordinates:connection.groundKey}]);
    }
    for(const [direction,e]of links){
      const key=e?.targetCoordinates;
      if(!key||seen.has(key)||e.status==='locked'||e.hidden||db[key]?.hidden||!db[key]?.name)continue;
      seen.add(key);queue.push({key,via:[...p.via,direction]});
    }
  }
  return null;
}
function candidate(db,originKey,population,{patron}={}){
  const origin=db[originKey];if(!origin?.campaignSetting?.inhabited||origin.deliveryMissionId)return null;
  const giver=Object.values(population?.actors||{}).find(a=>['Neutral','Friendly'].includes(a.allegiance)&&a.status==='present'&&a.hp>0&&!a.deityId&&
    (patron?a.name===patron:!a.serviceId));
  if(!giver)return null;
  const community=origin.campaignSetting.communityId,city=origin.cityRoom?.cityId;
  const destinations=Object.entries(db).filter(([key,r])=>key!==originKey&&r?.populationComplete&&!r.hidden&&!r.bossGate&&
    (community&&r.campaignSetting?.communityId===community||city&&r.cityRoom?.cityId===city)).sort(([a],[b])=>a.localeCompare(b));
  for(const [roomKey,destination]of destinations){
    const path=route(db,originKey,roomKey);if(!path?.length)continue;
    const recipient=Object.values(destination.inhabitants?.actors||{}).find(a=>a.name!==giver.name&&['Neutral','Friendly'].includes(a.allegiance)&&a.status==='present'&&a.hp>0&&!a.deityId);
    if(!recipient)continue;
    return {giver,recipient,roomKey,destination,path};
  }
  return null;
}
function seed(db,originKey,population,seed='',options={}){
  const choice=candidate(db,originKey,population,options);if(!choice)return null;
  const origin=db[originKey],{giver,recipient,roomKey,destination,path}=choice;
    const id=`dispatch:${originKey}:${I.hash(seed+originKey).toString(36)}`,name=`sealed dispatch for ${recipient.name.toLowerCase()} ${I.hash(id).toString(36)}`;
    const currency=require('../assets/currencyLanguage').forWorld(db['0,0,0']?.setting),reward=2+Math.min(4,path.length);
    const mission={id,type:'delivery',source:'engine-local-contract-v1',status:'offered',patron:giver.name,originRoomKey:originKey,
      recipient:recipient.name,originalRecipient:recipient.name,roomKey,roomName:destination.name,sourceRoomKey:originKey,sourceRoomName:origin.name,
      item:name,route:path,rewardSilver:reward,escrowSilver:reward,escrowItems:[],funding:'civic-contract-escrow',
      dispatchItem:{name,type:'other',attack_modifier:0,damage_modifier:0,ac:0,magic:0,minor_mission_id:id,
        description:`A sealed message from ${giver.name}, addressed to ${recipient.name}.`},
      description:`Carry a sealed message from ${giver.name} in ${origin.name} to ${recipient.name} in ${destination.name} (${roomKey}). Accept to receive the dispatch; hand it to the recipient. Payment: ${reward} ${currency.plural}.`};
    if(options.brief){
      const brief=options.brief;
      Object.assign(mission,{title:brief.title,purpose:brief.purpose,authorship:'model-authored',authoredAt:Date.now()});
      mission.dispatchItem.description=brief.parcelDescription;
      mission.description=`${brief.title}: ${brief.purpose} Deliver ${name} from ${giver.name} in ${origin.name} to ${recipient.name} in ${destination.name}. Route: ${path.join(', ')}. Accept to receive the parcel. Payment: ${reward} ${currency.plural}.`;
    }
    origin.minorMissions||={};origin.minorMissions[id]=mission;origin.deliveryMissionId=id;
    giver.minorMissionId||=id;giver.dialogue||=[];giver.dialogue.unshift('I have a sealed dispatch for delivery. Ask me about local work.');
    return mission;
}
module.exports={seed,route,candidate};
