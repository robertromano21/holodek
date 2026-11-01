'use strict';
const {randomUUID}=require('node:crypto');
const I=require('../assets/dungeonInhabitants'),Plans=require('../assets/cityBuildingPlans');
const coordinate=/^-?\d+,-?\d+,-?\d+$/;
// The campaign stays at its world address. Only these room-local fields are paged.
const LOCAL=new Set(['name','description','roomDescription','indoor','isIndoor','isOutdoor','classification','complexId','exits','objects',
  'monsters','inhabitants','environmentIntent','cityRoom','campaignSetting','populationComplete','startingResidentsComplete','visited',
  'puzzleDescription','puzzleSolution','puzzleMechanism','sceneSpec','blueprint','customTiles','illustration','preparedBuild','builder',
  'groundInventoryVersion','groundInventory','services','minorMissions','market','venueDesk','venueDesks','readables','bookReadings','bookFacts',
  'questWritings','questStories','questScenes','deliveryReceipts','deliveryDelegates','templeSuppression','secretDoors','physicalPuzzle',
  'randomEncounters','encounters','combatDefeats','defeatEvidence','cityFloorContext','namePending','descriptionAuthorship']);
const clone=v=>v==null?v:structuredClone(v);
const keyOf=c=>`${c.x},${c.y},${c.z}`;
const identity=r=>r?`${r.hostKey}|${r.buildingId}|${r.floor}`:'street';
function valid(ref){return !!ref&&coordinate.test(ref.hostKey)&&typeof ref.buildingId==='string'&&ref.buildingId.length>0&&
  ref.buildingId.length<=240&&Number.isInteger(ref.floor)&&ref.floor>=0&&ref.floor<=160;}
function bundle(database,ref){return valid(ref)?database[ref.hostKey]?.cityFloors?.buildings?.[ref.buildingId]?.floors?.[ref.floor]:null;}
function context(state){return state.getActiveCityFloor?.()||null;}
function publicStores(database){
  const next={...database};
  for(const [key,host]of Object.entries(database))if(host.cityFloors){
    const buildings={};
    for(const [id,b]of Object.entries(host.cityFloors.buildings||{}))buildings[id]={...b,floors:Object.fromEntries(Object.entries(b.floors||{}).map(([n,f])=>
      [n,Object.fromEntries(Object.entries(f).filter(([key])=>!['dungeon','music','residents','position'].includes(key)))]))};
    const {streetResidents,...store}=host.cityFloors;
    next[key]={...host,cityFloors:{...store,buildings}};
  }
  return next;
}
function mergeStores(database,incoming){
  const out={...incoming};
  for(const [key,host]of Object.entries(database))if(host.cityFloors&&out[key]){
    const store=incoming[key].cityFloors||host.cityFloors,buildings={...store.buildings};
    for(const [id,b]of Object.entries(host.cityFloors.buildings||{})){
      const current=buildings[id]||b,floors={...current.floors};
      for(const [n,f]of Object.entries(b.floors||{}))floors[n]={...f,...floors[n],...(f.dungeon?{dungeon:f.dungeon}:{}),
        ...(f.music?{music:f.music}:{}),...(f.residents?{residents:f.residents}:{})};
      buildings[id]={...b,...current,floors};
    }
    out[key]={...out[key],cityFloors:{...store,...(host.cityFloors.streetResidents?{streetResidents:host.cityFloors.streetResidents}:{}),buildings}};
  }
  return out;
}
function project(database,ref){
  const visible=publicStores(database);
  if(!ref)return visible;
  const saved=bundle(database,ref),host=database[ref.hostKey];
  if(!saved?.room)throw Error('The saved building floor is missing.');
  const shared=Object.fromEntries(Object.entries(host).filter(([k])=>!LOCAL.has(k)));
  return{...visible,[ref.hostKey]:{...shared,...saved.room,cityFloors:visible[ref.hostKey].cityFloors,cityFloorContext:{...ref}}};
}
function absorb(database,incoming,ref){
  incoming=mergeStores(database,incoming);
  if(!ref)return syncAliases(incoming);
  if(!bundle(database,ref))throw Error('The active floor no longer exists.');
  const next=incoming[ref.hostKey];if(!next||identity(next.cityFloorContext)!==identity(ref))throw Error('Stale building-floor database.');
  const host={...database[ref.hostKey]},local={};
  for(const [k,v]of Object.entries(next))if(LOCAL.has(k)){if(k!=='cityFloorContext')local[k]=v;}else if(k!=='cityFloors')host[k]=v;
  host.cityFloors=next.cityFloors||database[ref.hostKey].cityFloors;
  const saved=host.cityFloors.buildings[ref.buildingId].floors[ref.floor];
  for(const [k,v]of Object.entries(host.cityFloors.streetRoom||{}))if(LOCAL.has(k)&&k!=='cityFloorContext')host[k]=v;
  saved.room=local;saved.population=local.inhabitants||saved.population;
  return syncAliases({...incoming,[ref.hostKey]:host});
}
function syncAliases(database){
  for(const host of Object.values(database))for(const b of Object.values(host.cityFloors?.buildings||{}))for(const f of Object.values(b.floors||{}))
    if(f.legacyKey&&database[f.legacyKey]&&f.room)database[f.legacyKey]={...database[f.legacyKey],...f.room,inhabitants:f.population||f.room.inhabitants};
  return database;
}
function bindTasks(tasks,ref,hostKey=ref?.hostKey){
  if(!hostKey)return tasks;
  return tasks.map(task=>{
    if(!task||typeof task!=='object'||task.roomScopes?.[hostKey]!==undefined)return task;
    const mentions=value=>typeof value==='string'?I.roomKey(value)===hostKey:value&&typeof value==='object'?
      ['x','y','z'].every(k=>Number.isFinite(value[k]))&&keyOf(value)===hostKey||Object.values(value).some(mentions):false;
    const mentioned=mentions([task.requiredElements,task.guardElements,task.hardRequirements,task.actionRequirements,task.story]);
    return mentioned?{...task,roomScopes:{...task.roomScopes,[hostKey]:ref?{hostKey,buildingId:ref.buildingId,floor:ref.floor}:null}}:task;
  });
}
function forTask(database,task){
  let next=database;
  for(const [key,ref]of Object.entries(task?.roomScopes||{})){
    const room=ref?bundle(database,ref)?.room:database[key]?.cityFloorContext?database[key].cityFloors?.streetRoom:database[key];
    if(room){const shared=database[key];next={...next,[key]:new Proxy(room,{get:(target,k)=>k in target?target[k]:!LOCAL.has(k)?shared?.[k]:undefined})};}
  }
  return next;
}
function normalizeDungeon(d,hostKey,ref){
  d=clone(d);delete d.cityInteriorLayers;d.geoKey=hostKey;d.cityFloorContext=clone(ref);
  if(d.inhabitants)d.inhabitants.geoKey=hostKey;
  if(d.sceneSpec?.source)d.sceneSpec.source.coordinates=hostKey;
  if(d.sceneSpec?.city?.architecture)d.sceneSpec.city.architecture={...d.sceneSpec.city.architecture,...ref};
  return require('../assets/dungeonGeometryStamp').stamp(d,hostKey);
}
function migrate(database,dungeons,hostKey,buildingId){
  const host=database[hostKey];if(!host)throw Error('The host street is missing.');
  host.cityFloors||={version:1,buildings:{}};
  host.cityFloors.streetRoom=Object.fromEntries(Object.entries(host).filter(([k])=>LOCAL.has(k)&&k!=='cityFloorContext'));
  const building=host.cityFloors.buildings[buildingId]||={floors:{}};
  for(const [legacyKey,room]of Object.entries(database)){
    const ref=room.cityRoom?.architecture;
    if(ref?.hostKey!==hostKey||ref.buildingId!==buildingId||legacyKey===hostKey)continue;
    const prior=building.floors[ref.floor];if(prior)continue;
    const local=Object.fromEntries(Object.entries(room).filter(([k])=>LOCAL.has(k)&&k!=='cityFloorContext'));
    const geometry=dungeons[legacyKey]||dungeons[hostKey]?.cityInteriorLayers?.buildings?.[buildingId]?.floors?.[ref.floor]?.dungeon;
    const population=clone(room.inhabitants);if(population){population.geoKey=hostKey;population.starting=false;}
    building.floors[ref.floor]={room:local,population,legacyKey,...(geometry?{dungeon:normalizeDungeon(geometry,hostKey,ref)}:{})};
    if(population)local.inhabitants=population;
  }
  return building;
}
function floorRoom(database,ref){
  const host=database[ref.hostKey],record=host?.cityArchitecture?.buildings?.[ref.buildingId],plan=record?.plan;
  if(!plan||ref.floor>=plan.storeys)throw Error('That building floor is not in the saved plan.');
  const recipe=record.floors?.[ref.floor]?.plan||Plans.floor(plan,ref.floor),E=require('../assets/cityEstablishments'),Life=require('./cityLife');
  const type=recipe.type,venue=Life.venue(type,recipe.id,`${plan.name} Level ${ref.floor}`);
  Object.assign(venue,{width:recipe.width,depth:recipe.depth,storeyClearance:recipe.clearance});
  const vertical={floor:ref.floor,storeys:plan.storeys-1,towerId:plan.id,groundKey:ref.hostKey,transit:plan.circulation.transit,
    storeyHeightMetres:plan.storeyHeightMetres,podiumHeightMetres:(plan.lobby.clearance+.6)*2.5,
    elevationMetres:ref.floor===0?0:(plan.lobby.clearance+.6)*2.5+(ref.floor-1)*plan.storeyHeightMetres};
  const floorProgram={version:1,floor:ref.floor,units:Math.max(2,recipe.rooms.length-1),residents:12,namedResidents:8,use:recipe.use};
  return{name:venue.name||plan.name,namePending:!plan.authored,description:'',
    indoor:true,isIndoor:true,isOutdoor:false,classification:{indoor:true,biome:'city',architecture:'city_building',size:Math.max(recipe.width,recipe.depth)},
    exits:{},objects:[],monsters:{inRoom:'None',state:'None',equippedProperties:'None'},
    cityRoom:{...host.cityRoom,kind:'building',streetKey:ref.hostKey,genre:plan.genre,establishmentType:type,venue,
      architecture:{...ref,authored:plan.authored},vertical,footprint:plan.footprint,
      floorProgram},
    campaignSetting:{...host.campaignSetting,inhabited:true,siteKind:venue.service==='shop'?'market':venue.service==='temple'?'temple':type,
      city:{...host.campaignSetting?.city,kind:'building',genre:plan.genre,establishmentType:type,venue,vertical,floorProgram,
        population:{roles:venue.roles,civilianMajority:true,maxResidents:12}}},
    environmentIntent:{template:'city_building',indoor:true,targetKey:ref.hostKey,narrativeHint:`Inside ${plan.name}, level ${ref.floor}; ${recipe.use}.`},
    startingResidentsComplete:true,populationComplete:!plan.authored};
}
function geometry(database,ref){
  const room=bundle(database,ref).room,record=database[ref.hostKey].cityArchitecture.buildings[ref.buildingId];
  const recipe=record.floors?.[ref.floor]?.plan||Plans.floor(record.plan,ref.floor),size=Math.max(32,recipe.width+8,recipe.depth+8);
  const city={...room.cityRoom,architecture:{...ref,name:record.plan.name,authored:false,plan:recipe}};
  const d={geoKey:ref.hostKey,cityFloorContext:clone(ref),layout:{width:size,height:size},start:{x:Math.floor(size/2),y:size-6},cells:{},tiles:{},
    sceneStructures:[],classification:room.classification,generation:{seed:recipe.seed,roomKey:ref.hostKey},
    sceneSpec:{source:{roomName:room.name,description:room.description},city,exits:[],indoor:true},customTiles:[]};
  require('./indoorBlueprint').build(d,{},{deferCityFurnishings:true});
  if(recipe.layoutVersion===2&&recipe.modules?.length){
    d.blueprint={indoorPlan:{modules:clone(recipe.modules)}};
    require('./sceneArchitecture').applySceneArchitecture(d,{...d.sceneSpec,architecture:recipe.architectureStyle?.family||'domus'});
    // Original modules may request monumental headroom; a stacked floor cannot exceed its saved envelope.
    for(const c of Object.values(d.cells))if(c.tile==='floor'||c.feature==='pillar'){
      c.ceilHeight=Math.min(c.ceilHeight,c.floorHeight+recipe.clearance);
      if(c.structureHeight)c.structureHeight=Math.min(c.structureHeight,recipe.clearance);
    }
  }
  for(const cell of Object.values(d.cells))if(cell.tile==='floor'&&!cell.roof)
    cell.roof={version:1,style:'panel',height:cell.ceilHeight,slopeX:0,slopeY:0};
  require('./cityCirculation').install(d);
  require('./cityClassicalDetails').interior(d);
  require('./cityVenueLayout').furnish(d,city.venue);
  // Surfaces are shared approved native assets; there is no model request for a procedural floor.
  const kit=require('../assets/genreKits').resolve({genre:city.genre});d.genreKit=kit;
  for(const tile of ['floor','wall','ceiling'])d.tiles[tile]||={};
  require('./genreLayer').fixtures(d);
  return require('../assets/dungeonGeometryStamp').stamp(d,ref.hostKey);
}
function selectDungeon(snapshot){const ref=snapshot.activeCityFloor;return ref?bundle(JSON.parse(snapshot.roomNameDatabaseString),ref)?.dungeon:snapshot.roomDungeonDatabase[keyOf(snapshot.lastCoords)];}
function validateSnapshot(snapshot){
  const ref=snapshot.activeCityFloor;if(!ref)return;
  const saved=valid(ref)&&ref.hostKey===keyOf(snapshot.lastCoords)&&bundle(JSON.parse(snapshot.roomNameDatabaseString),ref);
  if(!saved?.room||!saved.dungeon?.cells||saved.dungeon.geoKey!==ref.hostKey||identity(saved.dungeon.cityFloorContext)!==identity(ref)||typeof ref.token!=='string')
    throw Error('Invalid saved host-local floor.');
}
function token(state){return context(state)?.token||state.getCityFloorEpoch?.()||'street';}
function activeRoom(database,key){return database[key]?.cityFloorContext||null;}
function matches(database,boundKey,currentKey,task){
  const active=activeRoom(database,currentKey),bound=task?.roomScopes?.[boundKey];
  if(boundKey===currentKey)return bound===undefined||identity(bound)===identity(active);
  const ref=database[boundKey]?.cityRoom?.architecture;
  return !!ref&&ref.hostKey===currentKey&&identity(ref)===identity(active);
}
module.exports={LOCAL,identity,valid,bundle,context,project,absorb,bindTasks,forTask,migrate,floorRoom,geometry,normalizeDungeon,
  selectDungeon,validateSnapshot,token,activeRoom,keyOf,clone,randomUUID,publicStores,mergeStores,matches,syncAliases};
