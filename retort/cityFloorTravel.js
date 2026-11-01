'use strict';
const F=require('./hostLocalFloors'),I=require('../assets/dungeonInhabitants'),Flags=require('./worldFlags');
const Build=require('./roomBuildState'),coords=key=>Object.fromEntries(['x','y','z'].map((k,i)=>[k,Number(key.split(',')[i])]));
function check(state,request){
  const key=F.keyOf(state.getLastCoords()),d=state.getRoomDungeonForSimulation(state.getLastCoords());
  if(!Flags.on('CITY_SITES')||!Flags.on('ARCHITECTURE_EXPANSION')||state.getGamePaused()||request.runId!==state.getDungeonRunId()||request.geoKey!==key||
    request.floorToken!==F.token(state))throw Error('The floor or adventure changed; refresh this game window.');
  if(!d||request.geometryStamp!==d._geometryStamp)throw Error('The saved floor changed; approach the landing again.');
  if(!I.pointWalkable(d,request.player?.x,request.player?.y))throw Error('There is no valid player position.');
  return{key,d};
}
function ensureRecord(db,hostKey,b){
  const host=db[hostKey],id=b.planId||b.id;
  host.cityArchitecture||={version:1,hostKey,genre:b.genre||'fantasy',buildings:{}};
  host.cityArchitecture.buildings[id]||={plan:require('../assets/cityBuildingPlans').create({...b,id,hostKey,
    genre:host.cityArchitecture.genre||'fantasy',authored:!!b.authored}),floors:{}};
  return id;
}
async function authorFloor(state,snapshot,database,ref,{website=require('./websiteAi').service()}={}){
  await website.ensureConnected();if(!website.remoteBuildEnabled())throw Error('Reconnect Website AI to author this landmark floor.');
  const room=F.bundle(database,ref).room,job={id:F.randomUUID(),key:ref.hostKey,name:room.name,coords:coords(ref.hostKey),runId:snapshot.dungeonRunId,
    model:require('./gameModels').current().id,modelRevision:require('./gameModels').current().revision,entering:true};
  const projected=F.project(database,ref);delete projected[ref.hostKey].cityFloors;
  const scratch={...snapshot,activeCityFloor:null,roomNameDatabaseString:JSON.stringify(projected),lastCoords:job.coords,
    roomDungeonDatabase:{[ref.hostKey]:{}},roomPopulations:{},roomMusicDatabase:{},
    updatedGameConsole:Build.projectConsole(snapshot.updatedGameConsole,room,ref.hostKey,projected,{pending:!room.populationComplete})};
  return new Promise((resolve,reject)=>{
    const worker=website.spawnBuild(job,scratch,{background:false}),timer=setTimeout(()=>{worker.terminate();reject(Error('Building floor authoring timed out; the current floor is unchanged.'));},480000);
    let complete=false;
    worker.on('message',message=>{
      try{
        if(message.type==='failed')throw Error(message.reason);
        if(message.type==='checkpoint'&&message.artifact.stage==='complete'){
          Build.validateArtifact(message.artifact,job,true);complete=true;clearTimeout(timer);resolve(message.artifact);
        }
        if(message.type==='done'&&!complete)throw Error('The building helper returned no complete floor.');
      }catch(error){clearTimeout(timer);worker.terminate();reject(error);}
    });
  });
}
function captureResidents(snapshot,key,dungeon,population){
  const roster=JSON.parse(snapshot.combatCharactersString||'[]');
  if(population)for(const actor of roster)if(actor.type==='monster'&&population.actors?.[actor.name]){
    const record=population.actors[actor.name];Object.assign(record,{hp:actor.hp,state:actor.state,allegiance:I.allegiance(actor)});
    if(Number.isFinite(actor.mazeX))record.position={x:actor.mazeX,y:actor.mazeY};
    if(actor.sprite)record.sprite=actor.sprite;
  }
  return roster.filter(a=>a.type==='monster');
}
async function authorContent(state,database,ref,dungeon,{runner=require('./settingLayer').defaultRunner}={}){
  const room=F.bundle(database,ref).room,record=database[ref.hostKey].cityArchitecture.buildings[ref.buildingId],
    host=database[ref.hostKey],Work=require('./holodekRoomWork');
  return runner(async $=>{
    require('./graveMasterStoryPrompts').appendOriginal($);
    const name=room.namePending?await Work.locationName($,{destination:{coordinates:ref.hostKey,buildingId:ref.buildingId,floor:ref.floor,
      indoor:true,venue:room.cityRoom.establishmentType,footprint:record.plan.footprint,use:room.cityRoom.floorProgram?.use},
      source:{name:host.name,city:host.cityRoom?.cityName,district:host.cityRoom?.districtName},
      building:record.plan.authored?{name:record.plan.name}:undefined},Object.values(host.cityFloors?.buildings||{}).flatMap(b=>Object.values(b.floors||{}).filter(f=>!f.room?.namePending).map(f=>f.room?.name)).filter(Boolean)):room.name;
    const target={...room,name};
    const description=await require('./roomDescription').generate($,{name,coordinates:ref.hostKey,classification:room.classification,
      room:target,worldContext:{city:host.cityRoom,building:room.cityRoom,physicalPlan:record.floors?.[ref.floor]?.plan||require('../assets/cityBuildingPlans').floor(record.plan,ref.floor)},
      physicalGuidance:['Describe only the existing saved floor geometry, its materials, lighting and purpose. Do not change its room outline, stairs, ceiling heights, doors, objects or occupants.']});
    return{name,description};
  });
}
async function transition(state,request,{door=false,author=authorFloor,build=F.geometry,describe}={}){
  const {key,d}=check(state,request),initialRevision=state.getRestoreRevision?.(),initialToken=F.token(state),snapshot=state.exportSaveState();
  const model=require('./gameModels').current();
  const database=JSON.parse(snapshot.roomNameDatabaseString),visible=JSON.parse(state.getRoomNameDatabase()),source=visible[key];
  let hostKey=key,buildingId,floor,mode,control,b;
  if(door){
    b=d.cityBlocks?.buildings.find(b=>b.id===request.buildingId);if(!b)throw Error('That building has not been constructed.');
    const point=require('./cityInteriors').threshold(b,request.player);
    if(!point||Math.hypot(point.x-request.player.x,point.y-request.player.y)>2.2||!I.lineClear(d,request.player,point))throw Error('Walk to the doorway first.');
    if(!b.authored)return{hostLocal:true,unchanged:true,runId:request.runId,geoKey:key,buildingId:b.id};
    buildingId=ensureRecord(database,hostKey,b);floor=0;mode='door';
  }else{
    control=d.cityCirculation?.controls.find(c=>c.id===request.controlId);
    if(!control||![control.point,control.trigger].filter(Boolean).some(p=>Math.hypot(p.x-request.player.x,p.y-request.player.y)<=2.8&&I.lineClear(d,request.player,p)))
      throw Error('Walk to the stair or lift first.');
    b=control.buildingId&&d.cityBlocks?.buildings.find(b=>b.id===control.buildingId);
    const current=F.context(state)||source.cityRoom?.architecture;
    hostKey=current?.hostKey||key;buildingId=b?ensureRecord(database,hostKey,b):current?.buildingId;
    if(!buildingId)throw Error('This landing has no saved building plan.');
    floor=control.mode==='street'?0:control.mode==='stairs'?control.floor+(control.direction==='up'?1:-1):request.floor;mode=control.mode;
    if(!Number.isInteger(floor)||floor<0||floor>=control.storeys||floor===control.floor&&control.mode!=='street')throw Error('Choose another existing floor.');
  }
  const host=database[hostKey],record=host?.cityArchitecture?.buildings?.[buildingId],hostDungeon=snapshot.roomDungeonDatabase[hostKey];
  if(!record?.plan||!hostDungeon?.cells)throw Error('The saved host street is unavailable; no floor was moved.');
  const building=F.migrate(database,snapshot.roomDungeonDatabase,hostKey,buildingId);
  const oldRef=F.context(state),oldPopulation=F.clone(state.getRoomPopulation(key)),oldRoster=captureResidents(snapshot,key,d,oldPopulation);
  if(oldRef){const old=F.bundle(database,oldRef);old.population=F.clone(oldPopulation);old.room.inhabitants=old.population;old.residents=oldRoster;old.dungeon=F.clone(d);old.position={...request.player};old.music=state.getRoomMusic?.(coords(key));}
  else if(key!==hostKey){const legacy=source.cityRoom?.architecture,old=legacy&&building.floors[legacy.floor];if(old){old.population=oldPopulation;old.room.inhabitants=oldPopulation;old.residents=oldRoster;old.dungeon=F.normalizeDungeon(d,hostKey,legacy);}}
  else if(key===hostKey){snapshot.roomPopulations[key]=F.clone(oldPopulation);snapshot.roomDungeonDatabase[key]=F.clone(d);host.cityFloors.streetResidents=F.clone(oldRoster);}
  const returningStreet=floor===0&&(!record.plan.authored||control?.mode==='street'),ref=returningStreet?null:{hostKey,buildingId,floor,token:F.randomUUID()};
  let targetRoom=host,targetDungeon=hostDungeon,population=snapshot.roomPopulations[hostKey]||host.inhabitants,residents=F.clone(host.cityFloors.streetResidents||[]);
  let created=false;
  if(ref){
    const saved=building.floors[floor]||={room:F.floorRoom(database,ref)};
    if(!saved.dungeon){
      if(record.plan.authored){
        const artifact=await author(state,snapshot,database,ref);
        saved.room=Object.fromEntries(Object.entries(artifact.rooms[hostKey]).filter(([k])=>F.LOCAL.has(k)&&k!=='cityFloorContext'));
        saved.dungeon=F.normalizeDungeon(artifact.dungeon,hostKey,ref);saved.music=artifact.music;saved.population=saved.room.inhabitants;
      }else{
        saved.dungeon=build(database,ref);saved.dungeon.visualStyle=F.clone(hostDungeon.visualStyle);
        for(const tile of ['floor','wall','ceiling','door','pillar'])if(hostDungeon.tiles?.[tile])saved.dungeon.tiles[tile]=F.clone(hostDungeon.tiles[tile]);
      }
      created=true;
    }
    if(describe&&(!saved.room.description||/^(?:none|null|undefined)$/i.test(saved.room.description))){
      const prose=await describe(state,database,ref,saved.dungeon);
      if(typeof prose.name!=='string'||!prose.name.trim())throw Error('Floor authoring returned no location name.');
      saved.room.name=prose.name.trim();saved.room.description=require('./roomDescription').validate(prose.description);delete saved.room.namePending;
      saved.room.descriptionAuthorship={source:'model',method:'room-description'};
      if(saved.dungeon.sceneSpec)saved.dungeon.sceneSpec.source={...saved.dungeon.sceneSpec.source,roomName:saved.room.name,description:saved.room.description};
    }
    saved.dungeon=F.normalizeDungeon(saved.dungeon,hostKey,ref);
    const protectedKeys=new Set(Object.values(saved.population?.actors||saved.room.inhabitants?.actors||{}).filter(a=>a.position).map(a=>`${a.position.x},${a.position.y}`));
    require('./cityCirculation').install(saved.dungeon,{protectedKeys});
    require('../assets/dungeonGeometryStamp').stamp(saved.dungeon,hostKey);
    if(ref.floor===0&&!saved.dungeon.cityCirculation?.controls.some(c=>c.mode==='street'))throw Error('The lobby has no safe return to the street; nothing was installed.');
    if(ref.floor>0&&!saved.dungeon.cityCirculation?.controls.some(c=>c.mode==='lift'||c.mode==='stairs'&&c.direction==='down'))
      throw Error('This floor has no safe route down; nothing was installed.');
    population=F.clone(saved.population||saved.room.inhabitants||I.createPopulation(hostKey,[],{indoor:true,starting:false}));
    population.geoKey=hostKey;population.starting=false;population.levelId=F.identity(ref);saved.population=population;saved.room.inhabitants=population;
    targetRoom=saved.room;targetDungeon=saved.dungeon;residents=F.clone(saved.residents||[]);
  }
  const controls=targetDungeon.cityCirculation?.controls||[];
  const landing=ref?controls.find(c=>c.mode===mode&&(mode!=='stairs'||c.direction===(floor>(control?.floor??0)?'down':'up')))||controls[0]:
    controls.find(c=>c.buildingId===b?.id||c.buildingId===buildingId||targetDungeon.cityBlocks?.buildings.find(b=>b.id===c.buildingId)?.planId===buildingId);
  const raw=returningStreet?landing?.arrival||record.placement&&{x:record.placement.left+record.plan.footprint.width/2,y:record.placement.top+1.5}:landing?.arrival;
  const start=raw&&I.pointWalkable(targetDungeon,raw.x,raw.y)?raw:targetDungeon.start&&{x:targetDungeon.start.x+.5,y:targetDungeon.start.y+.5};
  if(!start||!I.pointWalkable(targetDungeon,start.x,start.y))throw Error('This floor has no safe landing; the current floor is unchanged.');
  // Async authorship never commits over a restore, pause, model switch or another floor transition.
  if(state.getDungeonRunId()!==request.runId||state.getGamePaused()||F.token(state)!==initialToken||state.getRestoreRevision?.()!==initialRevision||
    require('./gameModels').current().id!==model.id||require('./gameModels').current().revision!==model.revision||
    state.getRoomDungeonForSimulation(state.getLastCoords())?._geometryStamp!==request.geometryStamp||state.getRoomNameDatabase()!==JSON.stringify(visible))
    throw Error('The adventure changed while this floor was prepared; nothing was installed.');
  const roster=JSON.parse(snapshot.combatCharactersString||'[]').filter(a=>a.type!=='monster');
  for(const actor of roster){for(const field of ['mazePoint','mazeX','mazeY','renderMazeX','renderMazeY'])delete actor[field];actor.mazeRoomKey=hostKey;}
  roster.push(...residents);if(population)I.attach(roster,population);
  const points=[{x:Math.floor(start.x),y:Math.floor(start.y)}],seen=new Set(),used=new Set(),Foot=require('../assets/combatFootprint');
  for(let n=0;n<points.length&&points.length<512;n++)for(const [dx,dy]of [[0,1],[1,0],[0,-1],[-1,0]]){
    const p={x:points[n].x+dx,y:points[n].y+dy},k=`${p.x},${p.y}`;if(!seen.has(k)&&I.walkable(targetDungeon,p.x,p.y)&&I.canTraverse(targetDungeon,points[n],p)){seen.add(k);points.push(p);}}
  for(const actor of roster.filter(a=>a.type==='monster'))for(const p of Foot.cells(actor))used.add(`${p.x},${p.y}`);
  for(const actor of roster.filter(a=>a.type!=='monster')){
    const point=points.find(p=>Foot.cells(actor,p).every(c=>I.walkable(targetDungeon,c.x,c.y)&&!used.has(`${c.x},${c.y}`)));
    if(!point)throw Error('The party does not fit on this landing; the current floor is unchanged.');
    Object.assign(actor,{mazeX:point.x,mazeY:point.y,mazePoint:{x:point.x+.5,y:point.y+.5}});for(const p of Foot.cells(actor,point))used.add(`${p.x},${p.y}`);
  }
  const pc=roster.find(a=>a.type==='pc');if(pc){start.x=pc.mazeX+.5;start.y=pc.mazeY+.5;}
  let text=Build.projectConsole(snapshot.updatedGameConsole,targetRoom,hostKey,{...database,[hostKey]:targetRoom});
  if(population)text=I.withStates(text,population);
  snapshot.currentTasks=F.bindTasks(snapshot.currentTasks,oldRef,hostKey);snapshot.activeCityFloor=ref;snapshot.cityFloorEpoch=ref?.token||F.randomUUID();
  snapshot.roomNameDatabaseString=JSON.stringify(F.syncAliases(database));snapshot.updatedGameConsole=text;snapshot.combatCharactersString=JSON.stringify(roster);
  snapshot.lastCoords=coords(hostKey);snapshot.liveWorldState=null;snapshot.lastAdjudication=null;
  state.importSaveState(snapshot,{graphicsReady:[hostKey]});
  return{type:'city_floor',eventId:F.randomUUID(),runId:request.runId,geoKey:hostKey,fromKey:key,buildingId,controlId:request.controlId,
    targetKey:hostKey,hostLocal:true,floorContext:ref,floorToken:F.token(state),arrival:start,created,
    dungeon:state.getRoomDungeon(coords(hostKey)),population:state.getRoomPopulation(hostKey),
    updatedGameConsole:state.getUpdatedGameConsole(),combatCharactersString:state.getCombatCharactersString(),roomNameDatabaseString:state.getRoomNameDatabase(),
    name:targetRoom.name,content:ref?`Entered ${targetRoom.name}.`:`Returned to ${targetRoom.name}.`};
}
module.exports={check,transition,authorFloor,authorContent};
