'use strict';
const I = require('../assets/dungeonInhabitants');
const E = require('../assets/cityEstablishments');
const WORK = new Set(['inn', 'bar', 'foodhall', 'workshop', 'warehouse', 'guild', 'library', 'civic', 'court', 'transit', 'temple', 'clinic', 'theatre', 'bathhouse', 'arena', 'shop']);
function seed(room, population, geoKey) {
  const type = room?.cityRoom?.establishmentType;
  if (!WORK.has(type) || room.venueDesk) return;
  const candidates = Object.values(population?.actors || {}).filter(a => a.status === 'present' && a.hp > 0 &&
    ['Friendly', 'Neutral'].includes(a.allegiance) && !a.deityId);
  const operator = candidates.find(a => a.serviceId) || candidates.find(a => a.encounterId === 'venue-operator') ||
    candidates.find(a => a.venueDuty || a.occupation?.mode === 'work') || candidates[0];
  if (!operator) return;
  room.venueDesk = { version: 1, id: `venue-desk:${geoKey}`, operator: operator.name, type, name: room.name,
    capabilities: E.servicePlan({type}).deskCapabilities, lodgingPrice: type === 'inn' ? 2 : null,
    stays: [], revision: 0 };
}
function describe(room, actorName) {
  const desk = forActor(room,actorName), actor = room?.inhabitants?.actors?.[actorName];
  if (!desk || actor?.status !== 'present' || !I.canAct(actor) || I.allegiance(actor) === 'Hostile') return null;
  return { id: desk.id, name: desk.name, type: desk.type, capabilities: desk.capabilities, lodgingPrice: desk.lodgingPrice,
    stayCount: desk.stays.length, floor: room.cityRoom?.vertical?.floor ?? 0, use: room.cityRoom?.floorProgram?.use };
}
function forActor(room,name){return[room?.venueDesk,...Object.values(room?.venueDesks||{})].find(d=>E.operators(d).includes(name));}
function bind(room,actor,occupation,key){
  const type=occupation?.venueType;if(occupation?.mode!=='work'||!occupation.venueId||!WORK.has(type)||!['Friendly','Neutral'].includes(I.allegiance(actor)))return null;
  const existing=forActor(room,actor.name);if(existing)return existing;
  room.venueDesks||={};const id=`venue-desk:${key}:${occupation.venueId}`;
  if(room.venueDesks[id]){
    const desk=room.venueDesks[id];desk.attendants=[...new Set([...(desk.attendants||[]),actor.name])];return desk;
  }
  return room.venueDesks[id]={version:1,id,operator:actor.name,type,name:actor.name,capabilities:E.servicePlan({type}).deskCapabilities,
    lodgingPrice:type==='inn'?2:null,stays:[],revision:0};
}
module.exports = { seed, describe,forActor,bind };
