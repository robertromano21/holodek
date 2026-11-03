'use strict';
const I=require('../assets/dungeonInhabitants'),Names=require('../assets/proceduralNames');
function appearance(citizen){return require('../assets/cityCrowdUi').specFor(citizen,{procedural:require('../assets/renderCharacterProcedural'),architecture:require('../assets/genreArchitecture')});}
function preserveBody(actor,citizen){
  if(actor.visualIdentity?.version===1)return false;
  actor.visualIdentity={version:1,crowdId:citizen.id,seed:citizen.seed};
  actor.sprite={spec:appearance(citizen),procedural:true,source:'procedural-crowd',appearanceLocked:true};
  return true;
}
function repairPromoted(state,d,key){
  const p=state.getRoomPopulation(key),db=JSON.parse(state.getRoomNameDatabase());let changed=false;
  for(const row of Object.values(d.cityCrowd?.actors||{}))if(row.status==='promoted'&&p?.actors[row.name]){
    const actor=p.actors[row.name];changed=preserveBody(actor,row)||changed;
    if(!actor.serviceId&&require('./economy').bindVenueTrader(db,key,actor,row.occupation,state.getUpdatedGameConsole?.()||''))changed=true;
    if(!require('./cityVenueServices').forActor(db[key],actor.name)&&require('./cityVenueServices').bind(db[key],actor,row.occupation,key))changed=true;
  }
  if(!changed)return;
  state.setRoomPopulation?.(key,p);
  db[key].inhabitants=p;state.setRoomNameDatabase?.(JSON.stringify(db));
  const roster=JSON.parse(state.getCombatCharactersString()||'[]');I.attach(roster,p);state.setCombatCharactersString(JSON.stringify(roster));
}
function move(state,request){
  if(!request.crowdMovements?.length||!Array.isArray(request.crowdMovements)||request.crowdMovements.length>32||state.getGamePaused?.())return false;
  const coords=state.getLastCoords(),key=`${coords.x},${coords.y},${coords.z}`,d=state.getRoomDungeonForSimulation(coords);
  if(request.runId!==state.getDungeonRunId()||request.geoKey!==key||!d?.cityCrowd||request.geometryStamp!==d._geometryStamp||
    !I.pointWalkable(d,request.player?.x,request.player?.y))return false;
  const crowd=structuredClone(d.cityCrowd),same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
  const occupied=new Set(Object.values(crowd.actors).filter(a=>a.status==='ambient').map(a=>`${a.position.x},${a.position.y}`));
  for(const a of Object.values(state.getRoomPopulation(key)?.actors||{}))if(a.position)occupied.add(`${a.position.x},${a.position.y}`);
  for(const a of JSON.parse(state.getCombatCharactersString()||'[]'))if(Number.isFinite(a.mazeX)&&Number.isFinite(a.mazeY))occupied.add(`${a.mazeX},${a.mazeY}`);
  let changed=false;
  for(const row of request.crowdMovements){
    const a=crowd.actors[row?.id];if(!a||a.status!=='ambient'||!same(a.position,row.from)||!Array.isArray(row.path)||!row.path.length||row.path.length>8)continue;
    if(Math.hypot(a.position.x+.5-request.player.x,a.position.y+.5-request.player.y)>48)continue;
    const home=a.home||a.position,radius=a.occupation?.mode==='work'?3:a.occupation?.mode==='visit'?5:8;
    let from=a.position,valid=true;
    for(const p of row.path){
      if(!Number.isInteger(p?.x)||!Number.isInteger(p?.y)||Math.abs(p.x-from.x)+Math.abs(p.y-from.y)!==1||Math.hypot(p.x-home.x,p.y-home.y)>radius||
        occupied.has(`${p.x},${p.y}`)&&!same(p,a.position)||d.cells[`${p.x},${p.y}`]?.navigationReserved||!I.canTraverse(d,from,p)){valid=false;break;}
      from=p;
    }
    if(!valid){a.motionReset=(a.motionReset||0)+1;changed=true;continue;}
    occupied.delete(`${a.position.x},${a.position.y}`);a.home={...home};a.position={...from};occupied.add(`${from.x},${from.y}`);changed=true;
  }
  if(changed){crowd.revision++;if(state.setRoomCrowd)state.setRoomCrowd(coords,crowd);else state.setRoomDungeon(coords,{...d,cityCrowd:crowd},d.customTiles);}
  return changed;
}
function synchronize(state,request){
  const coords=state.getLastCoords(),key=`${coords.x},${coords.y},${coords.z}`;
  if(request.runId!==state.getDungeonRunId()||request.geoKey!==key)return null;
  move(state,request);
  const source=state.getRoomDungeonForSimulation(coords);
  if(!source?.cityBlocks&&!source?.cityVenue?.units)return null;
  repairPromoted(state,source,key);
  const prior=source.cityCrowd,stamp=source._geometryStamp;
  if(prior?.placementVersion===2&&prior.sourceStamp===stamp)return request.crowdRevision===prior.revision?null:prior;
  const db=JSON.parse(state.getRoomNameDatabase()||'{}'),room=db[key],ecology=require('./settingEcology').get(db);
  const world=db['0,0,0']?.setting||require('./settingLayer').current();
  const species=ecology?.entries.filter(e=>e.kind==='people'||e.kind==='construct'||e.kind==='monster'&&e.allegiance!=='Hostile')||[];
  if(!species.length)return null; // An original world's native peoples must be authored, not imported from another genre.
  const crowd=structuredClone(prior||{version:1,revision:0,actors:{}}),used=new Set(Object.values(db).flatMap(r=>Object.keys(r?.inhabitants?.actors||{})).concat(Object.values(crowd.actors).map(a=>a.name)));
  const occupied=new Set(Object.values(state.getRoomPopulation(key)?.actors||{}).map(a=>a.position&&`${a.position.x},${a.position.y}`));
  for(const a of Object.values(crowd.actors))occupied.add(`${a.position.x},${a.position.y}`);
  const candidates=[];
  for(const b of source.cityBlocks?.buildings||[])for(let i=0;i<Math.max(4,Math.min(15,Math.floor((b.width||16)*(b.depth||16)/64)));i++){
    const rooms=b.rooms||[],space=rooms[i%Math.max(1,rooms.length)],sites=(b.workSites||[]).filter(s=>!space||
      s.position.x>=space.x&&s.position.x<space.x+space.width&&s.position.y>=space.y&&s.position.y<space.y+space.depth);
    const site=sites[Math.floor(i/Math.max(1,rooms.length))%Math.max(1,sites.length)],p=site?.position||
      (space?{x:space.x+2+(i%2),y:space.y+2+Math.floor(i/rooms.length)}:{x:b.left+3+i*3,y:b.top+4});
    candidates.push({id:`${b.id}:citizen:${i}`,...p,use:b.type,index:i,venue:{id:b.id,name:b.name},space:space?.use||site?.use,bounds:space,parcel:b.footprint?b.id:null});
  }
  for(const unit of source.cityVenue?.units||[])if(unit.position)for(let i=0;i<2;i++)candidates.push({id:prior?.actors[`${key}:${unit.id}:citizen:${i}`]?`${key}:${unit.id}:citizen:${i}`:
    `${require('./hostLocalFloors').identity(source.cityFloorContext)}:${key}:${unit.id}:citizen:${i}`,x:unit.position.x+i,y:unit.position.y,
    use:room?.cityRoom?.establishmentType||'home',index:i,venue:{id:unit.id,name:room.name},space:unit.use,bounds:unit.room});
  for(const [cell,c]of Object.entries(source.cells))if(c.cityStreet==='sidewalk'&&I.hash(key+':'+cell)%67===0){const [x,y]=cell.split(',').map(Number);candidates.push({id:`${key}:pedestrian:${cell}`,x,y,use:'traveler'});}
  const program=room?.cityRoom?.floorProgram,cap=program?Math.max(0,program.residents-(program.namedResidents||8)):2048;
  const offsets=Array.from({length:25},(_,i)=>({dx:i%5-2,dy:Math.floor(i/5)-2})).sort((a,b)=>Math.hypot(a.dx,a.dy)-Math.hypot(b.dx,b.dy));
  let count=Object.keys(crowd.actors).length;
  for(const p of candidates){
    if(crowd.actors[p.id]||count>=cap)continue;
    let position=null;
    for(const {dx,dy}of offsets)if((!p.bounds||
      p.x+dx>=p.bounds.x&&p.x+dx<p.bounds.x+p.bounds.width&&p.y+dy>=p.bounds.y&&p.y+dy<p.bounds.y+p.bounds.depth)&&
      !occupied.has(`${p.x+dx},${p.y+dy}`)&&(!p.parcel||source.cells[`${p.x+dx},${p.y+dy}`]?.cityParcel===p.parcel)&&
      (p.use!=='traveler'||source.cells[`${p.x+dx},${p.y+dy}`]?.cityStreet==='sidewalk')&&I.pointWalkable(source,p.x+dx+.5,p.y+dy+.5)){
      position={x:p.x+dx,y:p.y+dy};break;
    }
    if(!position)continue;
    const seed=request.runId+':'+p.id,h=I.hash(seed),weights=room?.campaignSetting?.city?.populationMix?.weights||[];
    const eligible=species.map(e=>({...e,weight:weights.find(w=>w.id===e.id)?.weight??e.weight})).filter(e=>e.weight>0);
    if(!eligible.length)continue;let draw=(h/4294967296)*eligible.reduce((n,e)=>n+e.weight,0),lineage=eligible.at(-1);
    for(const e of eligible){draw-=e.weight;if(draw<0){lineage=e;break;}}
    const name=Names.generate({seed,profile:lineage.nameParts,used:[...used],isReserved:n=>!!require('../assets/pantheonCharacters').name(n)});used.add(name);
    const occupation=require('./cityActivities').assignment(p.use,p.index??h%3,seed,p.venue);
    if(p.space)occupation.space=p.space;
    crowd.actors[p.id]={id:p.id,name,race:lineage.name,appearance:lineage.description.slice(0,180),lineageId:lineage.id,sex:h%2?'Female':'Male',position,
      genre:room?.cityRoom?.genre||world?.genres?.[0]||'fantasy',role:occupation.duty,occupation,activity:occupation.activity,status:'ambient',seed:h};
    occupied.add(`${position.x},${position.y}`);
    count++;
  }
  crowd.revision++;crowd.sourceStamp=stamp;crowd.placementVersion=2;
  if(state.setRoomCrowd)state.setRoomCrowd(coords,crowd);else state.setRoomDungeon(coords,{...source,cityCrowd:crowd},source.customTiles);
  return crowd;
}
async function meet(state,service,request,{runtime,isCurrent=()=>true}={}){
  move(state,request);
  const coords=state.getLastCoords(),key=`${coords.x},${coords.y},${coords.z}`,d=state.getRoomDungeonForSimulation(coords);
  if(request.runId!==state.getDungeonRunId()||request.geoKey!==key||state.getGamePaused())throw Error('That encounter is no longer active.');
  const citizen=d?.cityCrowd?.actors?.[request.id];
  if(!citizen||citizen.status!=='ambient')throw Error('That citizen has already been met or is no longer here.');
  const C=require('../assets/cityServiceCounters'),counter=request.counterId&&C.catalog(d).find(c=>c.id===request.counterId),
    atCounter=counter&&C.reachable(d,counter,request.player,I)&&C.belongs(d,counter,citizen.occupation);
  if(!I.pointWalkable(d,request.player?.x,request.player?.y)||Math.hypot(citizen.position.x+.5-request.player.x,citizen.position.y+.5-request.player.y)>(atCounter?8:3.5)||
    !I.lineClear(d,request.player,{x:citizen.position.x+.5,y:citizen.position.y+.5}))throw Error('Walk closer to speak to this citizen.');
  const db=JSON.parse(state.getRoomNameDatabase()),room=db[key],table=require('./settingEcology').get(db),lineage=table?.entries.find(e=>e.id===citizen.lineageId);
  const servicesAllowed=!require('../assets/economyRules').isStarterRoom(key,room);
  if(!lineage)throw Error('The saved native population group is unavailable.');
  const generator=runtime||require('./graveMasterProtocol').runtimeFor(state),roster=JSON.parse(state.getCombatCharactersString()||'[]'),floorToken=require('./hostLocalFloors').token(state),visual=appearance(citizen);
  const result=await generator.run(generator.retort(async $=>{
    require('./graveMasterStoryPrompts').appendOriginal($);
    if(servicesAllowed&&citizen.occupation?.mode==='work')await $.user('Welcome the arriving visitor in your own voice and offer help with your saved venue duty. For a service venue, ask what service they need. The engine supplies the actual available menu and prices; invent no new transactions, rewards or prerequisites.');
    if(!servicesAllowed)await $.user('This is the protected starter room. Greet the visitor as a local resident; do not offer services, trading, jobs or quests.');
    return require('./inhabitantGeneration').generateInhabitants($,{roomName:room.name,roomDescription:room.description||'',geoKey:key,indoor:d.classification?.indoor!==false,
      rooms:db,campaignSetting:room.campaignSetting,partyNames:roster.filter(a=>a.type!=='monster').map(a=>a.name),
      usedNames:Object.values(db).flatMap(r=>Object.keys(r?.inhabitants?.actors||{})),
      encounter:{count:1,races:[citizen.race],catalog:[lineage],identity:{name:citizen.name,race:citizen.race},
        theme:`The player is meeting this existing local citizen. Preserve their name, race and ALREADY VISIBLE BODY. Saved anatomy (data): ${JSON.stringify(visual.traits)}. This introduction is not a transformation or a new creature roll. Saved reason for being here: ${JSON.stringify(citizen.occupation||{})}. ${servicesAllowed&&citizen.occupation?.mode==='work'&&citizen.occupation.venueType==='shop'?'You operate this shop. Your first remark is a personal welcome and an invitation to browse or say what the player wants to purchase. Trading uses the engine menu; do not invent prices, payments or completed sales.':''} Express that duty in the setting's own vocabulary, give a distinct personal errand or ambition, and ground remarks in this actual venue. Author only this person's personality, voice, history and three remarks; no prefab biography or invented transaction. Public world facts: ${JSON.stringify(require('./publicWorldKnowledge').facts(db,room))}`}},
      {random:(min,max)=>min+Math.floor(Math.random()*(max-min)),level:()=>1,sex:()=>citizen.sex,xp:()=>0,equipment:async()=>null});
  }));
  if(!isCurrent()||require('./hostLocalFloors').token(state)!==floorToken||state.getDungeonRunId()!==request.runId||state.getRoomDungeonForSimulation(coords)?.cityCrowd?.actors[request.id]?.status!=='ambient'||
    `${state.getLastCoords().x},${state.getLastCoords().y},${state.getLastCoords().z}`!==key)throw Error('The room changed before this introduction completed.');
  if(!result.population||Object.keys(result.population.actors).length!==1)throw Error('No complete citizen introduction was returned.');
  const p=state.getRoomPopulation(key),actor=Object.values(result.population.actors)[0],sheet=I.parseBlocks(result.sheets)[0];
  if(!p||p.actors[actor.name]||actor.name!==citizen.name||actor.race!==citizen.race)throw Error('The citizen identity changed during authorship.');
  if(citizen.occupation?.mode==='work'&&require('../assets/cityEstablishments').servicePlan({type:citizen.occupation.venueType})&&
    !['Friendly','Neutral'].includes(I.allegiance(actor)))throw Error('The planned venue needs an available attendant. Its introduction could not be installed; try again.');
  const group={...result.population.groups[0],id:'citizen:'+citizen.id,site:{...citizen.position},discoveryState:'fixed',status:'discovered',introPlayed:true};
  Object.assign(actor,{encounterId:group.id,position:{...citizen.position},home:{...citizen.position},occupation:citizen.occupation,
    sheet:sheet.sheet,discoveryState:'fixed',encounteredAt:Date.now(),dialogueIndex:1});
  preserveBody(actor,citizen);
  p.actors[actor.name]=actor;p.groups.push(group);p.initialSheets=[p.initialSheets,result.sheets].filter(Boolean).join('\n');p.revision++;
  const savedDb=JSON.parse(state.getRoomNameDatabase()),business=require('./economy').bindVenueTrader(savedDb,key,actor,citizen.occupation,state.getUpdatedGameConsole?.()||'');
  const desk=require('./cityVenueServices').bind(savedDb[key],actor,citizen.occupation,key);
  if(business||desk)actor.servicesAcceptedAt=Date.now();
  if(business||desk){savedDb[key].inhabitants=p;state.setRoomNameDatabase(JSON.stringify(savedDb));}
  if(business&&require('./economy').needsStock(business)){
    try{await generator.run(generator.retort($=>require('./economy').prepareStocks($,state,key,{serviceId:business.id})));}
    catch(error){console.warn('[MerchantStock]',key,error.message);}
    if(!isCurrent()||require('./hostLocalFloors').token(state)!==floorToken||state.getDungeonRunId()!==request.runId)
      throw Error('The room changed before this shop introduction completed.');
  }
  I.attach(roster,p);state.setCombatCharactersString(JSON.stringify(roster));service.save(p);
  const latest=state.getRoomDungeonForSimulation(coords),crowd=structuredClone(latest.cityCrowd);crowd.actors[citizen.id].status='promoted';crowd.revision++;
  if(state.setRoomCrowd)state.setRoomCrowd(coords,crowd);else state.setRoomDungeon(coords,{...latest,cityCrowd:crowd},latest.customTiles);
  return{actor:actor.name,serviceAccess:!!(business||desk),population:p,crowd,content:`${actor.name}: "${actor.dialogue[0]}"`,dialogue:[{speaker:actor.name,line:actor.dialogue[0],kind:'turn'}]};
}
module.exports={synchronize,meet,move,preserveBody,repairPromoted};
