'use strict';
const Flags=require('./worldFlags'),I=require('../assets/dungeonInhabitants'),Parcels=require('../assets/cityParcels');
const E=require('../assets/cityEstablishments'),Life=require('./cityLife');
const keyOf=c=>`${c.x},${c.y},${c.z}`;

const threshold=Parcels.entrance;
function allocate(database,id){
  const occupied=new Set(Object.keys(database).map(k=>k.split(',').slice(0,2).join(',')));
  for(let i=0;i<10000;i++){
    const x=Parcels.hash(id+':x:'+i)%1999-999,y=Parcels.hash(id+':y:'+i)%1999-999;
    if(!occupied.has(`${x},${y}`))return `${x},${y},0`;
  }
  throw Error('No private building address is available.');
}
function connect(database,sourceKey,b,{genre='fantasy',site,position=threshold(b)}={}){
  const source=database[sourceKey];if(!source)throw Error('The street is no longer available.');
  const previous=source.cityInteriors?.buildings?.[b.id];
  if(previous){
    const ground=database[previous.groundKey];
    if(ground?.cityRoom?.frontage?.buildingId!==b.id)throw Error('The saved building connection is incomplete.');
    ground.cityRoom.frontage.position={...position};
    return previous;
  }
  // Authored compass routes already have an interior. Never create a competing copy.
  if(b.targetCoordinates){
    const target=database[b.targetCoordinates];
    if(!target?.cityRoom&&!target?.fortifiedFloor)throw Error('The authored building destination is missing.');
    return{groundKey:b.targetCoordinates,buildingId:b.id,authored:true};
  }
  const type=E.TYPES.includes(b.type)?b.type:'home',name=b.name||`${source.name} building`,groundKey=allocate(database,sourceKey+':'+b.id);
  const anchorKey=source.cityRoom?.anchorKey||sourceKey,venue=Life.venue(type,b.id,name),point=position;
  Object.assign(venue,{width:b.width,depth:b.depth});
  database[groundKey]={name,indoor:true,isIndoor:true,isOutdoor:false,complexId:`city-building:${groundKey}`,
    classification:{indoor:true,size:Math.max(b.width,b.depth),biome:'city',architecture:'city_building',features:[]},
    exits:{south:{status:'open',targetCoordinates:sourceKey,label:'Return to the street'}},objects:[],
    monsters:{inRoom:'None',state:'None',equippedProperties:'None'},
    environmentIntent:{template:'city_building',targetKey:groundKey,indoor:true,mapRole:`city:${site?.id||source.cityRoom?.cityId}`,
      narrativeHint:`Inside ${name}; ${type}. Preserve its saved street doorway and floor connections.`},
    cityRoom:{version:1,cityId:site?.id||source.cityRoom?.cityId,cityName:source.cityRoom?.cityName||site?.name||source.name,
      anchorKey,kind:'building',district:source.cityRoom?.district||'gate',districtName:source.cityRoom?.districtName||source.name,
      genre,streetKey:sourceKey,establishmentType:type,venue,authored:false,
      footprint:{width:b.width,depth:b.depth,metresPerCell:Parcels.METRES_PER_CELL},
      frontage:{version:1,buildingId:b.id,sourceKey,position:point},
      vertical:{towerId:`frontage:${sourceKey}:${b.id}`,floor:0,storeys:Math.max(0,Math.min(159,(b.storeys||1)-1)),
        transit:Parcels.highRise(genre)?'lift':'stairs',storeyHeightMetres:3.4}}};
  const profile=E.profile(type),use=profile.spaces.join(', ');
  const floorSite={...site,design:{...site?.design,verticality:site?.design?.verticality||{
    lowerUse:use,middleUse:use,upperUse:use,roofUse:`Enclosed upper floor of ${name}`}}};
  const Plans=require('../assets/cityBuildingPlans'),Architecture=require('./cityArchitecture');
  source.cityArchitecture||={version:1,hostKey:sourceKey,seed:site?.id||sourceKey,genre,buildings:{}};
  const planned=source.cityArchitecture.buildings[b.planId||b.id]||{plan:Plans.create({seed:site?.id||sourceKey,hostKey:sourceKey,
    ...b,id:b.planId||b.id,genre,programs:Architecture.programs({establishmentType:type},b.storeys||1,floorSite.design)}),floors:{}};
  source.cityArchitecture.buildings[b.planId||b.id]=planned;
  database[groundKey].cityRoom.architecture={hostKey:sourceKey,buildingId:b.planId||b.id,floor:0};
  require('./cityTowerFloors').install(database,anchorKey,{groundKey,site:floorSite});
  source.cityInteriors||={version:1,buildings:{}};
  const connection={buildingId:b.id,groundKey,storeys:b.storeys||1,position:point};
  source.cityInteriors.buildings[b.id]=connection;
  return connection;
}
function prepare(state,request,options={}){
  if(state.exportSaveState)return require('./cityFloorTravel').transition(state,request,{...options,door:true});
  if(!Flags.on('CITY_SITES')||!Flags.on('ARCHITECTURE_EXPANSION'))throw Error('City interiors are not enabled.');
  const key=keyOf(state.getLastCoords());
  if(state.getGamePaused()||request.runId!==state.getDungeonRunId()||request.geoKey!==key)throw Error('The street or adventure changed.');
  const d=state.getRoomDungeonForSimulation(state.getLastCoords());
  if(!d||request.geometryStamp!==d._geometryStamp)throw Error('The street changed; approach the doorway again.');
  const b=d.cityBlocks?.buildings.find(b=>b.id===request.buildingId);
  if(!b)throw Error('That building has not been constructed.');
  const point=threshold(b,request.player);
  if(!I.pointWalkable(d,request.player?.x,request.player?.y)||Math.hypot(request.player.x-point.x,request.player.y-point.y)>2.2||
    !I.lineClear(d,request.player,point))throw Error('Walk to the building entrance first.');
  const database=JSON.parse(state.getRoomNameDatabase()||'{}'),room=database[key];
  const site=room?.environmentIntent?.citySite||database[room?.cityRoom?.anchorKey]?.environmentIntent?.citySite;
  const connection=connect(database,key,b,{genre:d.cityBlocks.streaming?.genre||room?.cityRoom?.genre||'fantasy',site,position:point});
  // No dungeon, population, player location or existing save slot changes in this preparation step.
  const roomNameDatabaseString=JSON.stringify(database);state.setRoomNameDatabase(roomNameDatabaseString);
  return{runId:request.runId,geoKey:key,targetKey:connection.groundKey,buildingId:b.id,name:database[connection.groundKey].name,
    roomNameDatabaseString};
}
module.exports={threshold,connect,prepare};
