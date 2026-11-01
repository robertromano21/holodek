'use strict';
const Routes=require('../assets/outdoorRoutes');
const small=(v,n=100)=>typeof v==='string'?v.slice(0,n):'';
const hidden=r=>r?.hidden===true||r?.secret===true||r?.discovered===false||r?.coordinateAmbiguous;
function settlement(room,key){
  const c=room?.cityRoom,site=room?.environmentIntent?.citySite;
  if(c)return{name:small(c.cityName),kind:c.kind,district:small(c.districtName),anchor:c.anchorKey,
    ...(c.vertical?{vertical:{floor:c.vertical.floor,storeys:c.vertical.storeys,transit:c.vertical.transit,use:small(c.vertical.use)}}:{})};
  if(site)return{name:small(site.name),kind:room.citySites?'city-gateway':'planned-city-site',anchor:key};
  if(room?.villagePlan)return{name:small(room.name),kind:'village',anchor:key};
  return null;
}
function bearing(from,to){
  const x=Math.sign(to.x-from.x),y=Math.sign(to.y-from.y);
  if(!x&&!y)return to.z>from.z?'up':to.z<from.z?'down':'here';
  return(y>0?'north':y<0?'south':'')+(x>0?'east':x<0?'west':'');
}
function snapshot(database,coords){
  const scope=require('./dialogueContextPolicy').limits();
  const {rooms}=Routes.indexDatabase(database),at=Routes.coordinates(coords);
  if(!at)return null;
  const key=Routes.keyOf(at),room=rooms.get(key);
  if(!room||hidden(room))return null;
  const physical=room.sceneSpec||{},city=settlement(room,key),paths=new Map([[key,{via:null,steps:0}]]),queue=[key];
  for(let i=0;i<queue.length&&i<scope.pathNodes;i++){
    const k=queue[i],r=rooms.get(k),path=paths.get(k);
    if(path.steps>=scope.pathHops)continue;
    for(const e of Routes.exitEntries(r?.exits)){
      if(e.direction==='portal'||e.info?.hidden||e.info?.secret)continue;
      const next=Routes.resolveExit(k,e.direction,r.exits),target=rooms.get(next.targetKey);
      if(next.status!=='open'||!target||hidden(target)||paths.has(next.targetKey))continue;
      paths.set(next.targetKey,{via:path.via||e.direction,steps:path.steps+1});queue.push(next.targetKey);
    }
  }
  const neighbors=Routes.exitEntries(room.exits).filter(e=>!e.info?.hidden&&!e.info?.secret).slice(0,10).map(e=>{
    const route=Routes.resolveExit(at,e.direction,room.exits),r=rooms.get(route.targetKey);
    return{direction:e.direction,status:route.status,name:hidden(r)?'unknown':small(r?.name)||'unknown',coordinates:route.targetKey};
  });
  const places=new Map();
  if(city?.anchor)for(const [k,r]of rooms){
    const venue=r?.cityRoom;
    if(k===key||hidden(r)||venue?.anchorKey!==city.anchor||venue.kind!=='building'||!venue.venue||!paths.has(k))continue;
    places.set(k,{name:small(r.name),coordinates:k,bearing:bearing(at,Routes.coordinates(k)),distance:paths.get(k).steps,
      route:paths.get(k),source:'saved-city-plan',kind:'city-venue',use:venue.establishmentType});
  }
  for(const [k,r]of rooms){
    if(hidden(r))continue;
    const site=settlement(r,k);if(!site||site.anchor&&k!==site.anchor&&site.kind!=='village')continue;
    const p=Routes.coordinates(k);if(!p||p.z!==at.z&&!paths.has(k))continue;
    const distance=Math.max(Math.abs(p.x-at.x),Math.abs(p.y-at.y));if(distance>scope.radius&&!paths.has(k))continue;
    places.set(k,{name:site.name,coordinates:k,bearing:bearing(at,p),distance,route:paths.get(k)||null,source:'saved-settlement'});
  }
  const map=rooms.get('0,0,0')?.campaignAtlas?.map;
  for(const site of map?.cities||[]){
    const p=Routes.coordinates(site.site?.key);if(!p||p.z!==at.z)continue;
    const k=Routes.keyOf(p),distance=Math.max(Math.abs(p.x-at.x),Math.abs(p.y-at.y));
    if(distance>scope.radius||places.has(k)||hidden(rooms.get(k)))continue;
    places.set(k,{name:small(site.name),coordinates:k,bearing:bearing(at,p),distance,route:paths.get(k)||null,source:'public-campaign-map'});
  }
  const actors=room.inhabitants?.actors||{},services=Object.values(room.services||{}).slice(0,4).map(s=>({kind:s.kind,operator:small(s.operator),
    available:!!actors[s.operator]&&actors[s.operator].status==='present'&&actors[s.operator].hp!==0&&!['Dead','Dying','Unconscious'].includes(actors[s.operator].state),
    position:actors[s.operator]?.position||null}));
  return{room:small(room.name),coordinates:key,indoor:physical.indoor??Routes.indoor(room),
    biome:small(physical.biome||room.classification?.biome)||'unclassified',architecture:small(physical.architecture||room.classification?.architecture),
    settlement:city,region:small(room.campaignSetting?.region||room.regionId),
    currency:require('../assets/currencyLanguage').forWorld(rooms.get('0,0,0')?.setting||require('./settingLayer').current()).plural,
    publicWorld:require('./publicWorldKnowledge').facts(Object.fromEntries(rooms),room),
    neighbors,locales:[...places.values()].sort((a,b)=>a.distance-b.distance).slice(0,scope.locales),services};
}
function parcelAt(dungeon,player){
  if(!dungeon?.cityBlocks||!Number.isFinite(player?.x)||!Number.isFinite(player?.y))return null;
  const cell=dungeon.cells?.[`${Math.floor(player.x)},${Math.floor(player.y)}`];
  const b=[...dungeon.cityBlocks.buildings,...dungeon.cityBlocks.parks].find(b=>b.id===cell?.cityParcel);
  if(!b)return null;
  return{id:b.id,name:small(b.name),use:small(b.park?'public park':b.type),indoor:!b.park,
    widthMetres:b.metres.width,depthMetres:b.metres.depth,
    access:b.park?'open park':b.targetCoordinates?'ground-floor lobby; saved entrance leads to '+b.targetCoordinates:'walk-in ground floor only',
    operator:'Use verified services only; parcel purpose does not imply a present vendor.'};
}
function fromState(state){
  try{
    const coords=state.getLastCoords?.(),facts=snapshot(state.getRoomNameDatabase?.()||'{}',coords);
    const live=state.getLiveWorldState?.();
    if(facts&&live?.roomKey===facts.coordinates){
      const building=parcelAt(state.getRoomDungeonForSimulation?.(Routes.coordinates(coords)),live.player);
      if(building)facts.building=building;
    }
    return facts;
  }catch{return null;}
}
const RULES='Residents know their present room, biome and ordinary regional landmarks, not private quest state. A world/city name in prose is NOT proof that this room belongs to a built city. '+
    'For directions use route.via as the next exit; bearing alone is only a map direction, not a verified traversable route. Respect closed exits and admit unknown routes. '+
    'Do not say already here unless the saved settlement/coordinate agrees. A stall is scenery, not evidence of a vendor: only listed available service operators may trade. '+
    'Correct conflicting earlier dialogue; do not invent vendors, buildings, routes or hidden knowledge. '+require('./publicWorldKnowledge').POLICY;
function prompt(facts){
  if(!facts)return '';
  return 'VERIFIED LOCAL GEOGRAPHY AND SERVICES (read-only public knowledge): '+JSON.stringify(facts)+'. '+RULES;
}
module.exports={settlement,bearing,snapshot,fromState,parcelAt,prompt,RULES};
