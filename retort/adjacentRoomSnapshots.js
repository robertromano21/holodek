'use strict';
const Build = require('./roomBuildState');
const LIMITS = Object.freeze({ neighbors: 16, snapshotBytes: 8 * 1024 * 1024, cells: 262144, actors: 128, nodes: 1000000, depth: 32 });
const VECTORS = { north:[0,1,0],south:[0,-1,0],east:[1,0,0],west:[-1,0,0],northeast:[1,1,0],northwest:[-1,1,0],southeast:[1,-1,0],southwest:[-1,-1,0],up:[0,0,1],down:[0,0,-1] };
const STAGES = ['population','geometry','music','art','complete'];
const PHASES = ['queued','running','backoff','complete','failed','discarded','cancelled','skipped'];
const TIMINGS = ['requested','resources-ready','first-frame','movement-ready','cancelled','failed'];
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const text = (v,max=160) => typeof v === 'string' && v.length > 0 && v.length <= max;
const key = v => text(v,64) && Build.coordinate.test(v) && v.split(',').every(n=>Number.isSafeInteger(Number(n))) && v.split(',').map(Number).join(',') === v;
const coords = k => Object.fromEntries(k.split(',').map((n,i)=>[['x','y','z'][i],Number(n)]));
const problem = (code,message,status=409) => Object.assign(Error(message),{code,status});
const pick = (v,keys) => Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
function edges(room, from, db) {
  const result=[];
  for(const [direction,raw] of Object.entries(room.exits || {})) {
    const exit=object(raw)?raw:typeof raw==='string'?{status:raw}:null;
    if(!text(direction,40)||!exit||exit.hidden||exit.secret&&!exit.discovered)continue;
    const vector=VECTORS[direction],target=exit.targetCoordinates || (vector&&from.split(',').map((n,i)=>Number(n)+vector[i]).join(','));
    if(!key(target)||target===from||!object(db[target])||!text(db[target].name,240))continue;
    const status=String(exit.status||'open').toLowerCase();
    result.push({direction,geoKey:target,locked:status!=='open'||exit.locked===true||exit.isLocked===true||exit.blocked===true});
    if(result.length===LIMITS.neighbors)break;
  }
  return result;
}
const GRAPHICS = ['geoKey','_geometryStamp','layout','cells','tiles','customTiles','sceneSpec','sceneStructures','sceneObjects','surfaceArt','moldings','moldingArt','sceneRoof','exitFrames','exits','start','_world1Start','entryPlacement','classification','visualStyle','lighting','lightingScope','genreLights','planarRealm','indoorRooms','physicalPuzzle','secretDoors'];
const ACTOR = ['name','sex','race','level','hp','maxHP','ac','state','allegiance','type','status','position','encounterId','sprite','spriteSpec','spriteOptions','appearance','equipped','equipment'];
// Preloads contain graphics, not hidden campaign state, quest answers or future speech.
const PRIVATE = new Set(['__proto__','constructor','prototype','worldContext','roomNameDatabase','roomNameDatabaseString','roomDungeonDatabase','targetCoordinates','puzzleSolution','solution','solutions','answer','answers','credential','apiKey','OPENAI_API_KEY','XAI_API_KEY','memory','history','profile','dialogue','questIntroduction','secretDoorId','secretChamber','unlocks']);
function bounded(value) {
  let bytes=0,nodes=0;const seen=new Set();
  function copy(v,depth=0){
    if(depth>LIMITS.depth||++nodes>LIMITS.nodes)throw problem('SNAPSHOT_TOO_LARGE','This room needs ordinary entry instead of preload.',413);
    if(v===null||typeof v==='boolean'||typeof v==='number'){bytes+=24;return v;}
    if(typeof v==='string'){bytes+=Buffer.byteLength(JSON.stringify(v));if(bytes>LIMITS.snapshotBytes)throw problem('SNAPSHOT_TOO_LARGE','This room needs ordinary entry instead of preload.',413);return v;}
    if(v===undefined)return undefined;
    if(!object(v)&&!Array.isArray(v)||seen.has(v))throw problem('SNAPSHOT_INVALID','Room graphics are unavailable.',503);
    seen.add(v);const out=Array.isArray(v)?[]:{};
    for(const k of Object.keys(v)){
      if(PRIVATE.has(k))continue;bytes+=Buffer.byteLength(k)+4;
      if(bytes>LIMITS.snapshotBytes)throw problem('SNAPSHOT_TOO_LARGE','This room needs ordinary entry instead of preload.',413);
      out[k]=copy(v[k],depth+1);
    }
    seen.delete(v);return out;
  }
  const result=copy(value);
  if(Buffer.byteLength(JSON.stringify(result))>LIMITS.snapshotBytes)throw problem('SNAPSHOT_TOO_LARGE','This room needs ordinary entry instead of preload.',413);
  return result;
}
function publicPopulation(population){
  const actors=Object.entries(population.actors||{});if(actors.length>LIMITS.actors)throw problem('SNAPSHOT_TOO_LARGE','This room needs ordinary entry instead of preload.',413);
  return { ...pick(population,['version','geoKey','revision','indoor','starting']),actors:Object.fromEntries(actors.map(([name,actor])=>[name,pick(actor,ACTOR)])),
    groups:(population.groups||[]).slice(0,LIMITS.actors).map(group=>pick(group,['id','status','members','allegiance'])) };
}
function publicDungeon(dungeon){
  let count=0;for(const unused in dungeon.cells)if(++count>LIMITS.cells)throw problem('SNAPSHOT_TOO_LARGE','This room needs ordinary entry instead of preload.',413);
  const result=pick(dungeon,GRAPHICS);
  if(result.sceneSpec)result.sceneSpec={...result.sceneSpec,source:pick(result.sceneSpec.source,['roomName','description'])};
  if(result.secretDoors)result.secretDoors={version:result.secretDoors.version,revision:result.secretDoors.revision,
    doors:(result.secretDoors.doors||[]).filter(d=>d.discovered||d.open).map(d=>pick(d,['id','key','x','y','open','discovered']))};
  return result;
}
function createService(state,{models,adjacent,flags=()=>require('./worldFlags').snapshot(),logger=console,now=Date.now}={}){
  function scope(query){
    if(!text(query.runId,128)||!key(query.geoKey)||!text(query.geometryStamp,128))throw problem('PRELOAD_IDENTITY','Supply the active run, room and geometry stamp.',400);
    const runId=state.getDungeonRunId(),current=state.getLastCoords(),geoKey=`${current.x},${current.y},${current.z}`;
    if(!runId||query.runId!==runId||query.geoKey!==geoKey)throw problem('PRELOAD_STALE','The active room changed.');
    const db=JSON.parse(state.getRoomNameDatabase()||'{}'),source=db[geoKey],dungeon=state.getRoomDungeonForSimulation?.(current);
    if(!object(source)||!dungeon||query.geometryStamp!==dungeon._geometryStamp)throw problem('PRELOAD_STALE','The active room geometry changed.');
    const model=models.current(),restoreRevision=state.getRestoreRevision?.()||0,contextStamp=Build.context(state,model.id),featureFlags=flags();
    const identity={runId,geoKey,geometryStamp:dungeon._geometryStamp,model:{id:model.id,revision:model.revision},restoreRevision,contextStamp};
    identity.token=Build.hash([identity,source.exits,source.footExits,db['0,0,0']?.pendingFootExits,db['0,0,0']?.footExitsTracked,featureFlags]);
    if(query.scopeToken!==undefined&&query.scopeToken!==identity.token)throw problem('PRELOAD_STALE','The preload context changed.');
    return{identity,db,source,featureFlags};
  }
  function describe(edge,s){
    const room=s.db[edge.geoKey],receipt=room.preparedBuild,visited=room.visited===true;
    const dungeon=state.getRoomDungeonForSimulation?.(coords(edge.geoKey));
    const population=state.getRoomPopulation?.(edge.geoKey)||room.inhabitants;
    const music=state.getRoomMusic?.(coords(edge.geoKey));
    const graphics=!!(dungeon?.geoKey===edge.geoKey&&text(dungeon._geometryStamp,128)&&object(dungeon.cells)&&Object.keys(dungeon.cells).length&&
      [dungeon.layout?.width,dungeon.layout?.height].every(n=>Number.isInteger(n)&&n>0&&n<=1024));
    const populated=population?.geoKey===edge.geoKey&&object(population.actors);
    const prepared=receipt?.runId===s.identity.runId&&receipt.model===s.identity.model.id&&receipt.ready===true&&receipt.stage==='complete'&&room.populationComplete===true&&room.illustration?.plan&&music?.voices?.length&&music?.archive?.id;
    const ready=!!(graphics&&populated&&(visited||prepared));
    const jobs=adjacent.status?.()||[],job=jobs.find(j=>j.key===edge.geoKey&&j.runId===s.identity.runId&&j.model===s.identity.model.id);
    const foot=require('../assets/questMap').exitLocked(s.db,s.identity.geoKey,edge.direction,s.featureFlags);
    const item={...edge,name:room.name,visited,ready,preloadable:ready&&!edge.locked,requiresFootTraversal:foot,
      phase:ready?'ready':PHASES.includes(job?.phase)?job.phase:'unavailable',stage:STAGES.includes(receipt?.stage)?receipt.stage:STAGES.includes(job?.stage)?job.stage:null,
      geometryStamp:ready?dungeon._geometryStamp:null,revision:Number.isSafeInteger(receipt?.revision)?receipt.revision:0,snapshotToken:null};
    if(item.preloadable){
      const visual=bounded(publicPopulation(population));
      item.snapshotToken=Build.hash([s.identity.token,edge,dungeon._geometryStamp,item.revision,receipt?.id,visual,room.illustration?.source,music?.archive?.id,dungeon.sceneObjects]);
    }
    return{item,room,dungeon,population,music};
  }
  function unchanged(query,expected){if(scope(query).identity.token!==expected.token)throw problem('PRELOAD_STALE','The preload context changed.');}
  function manifest(query){
    const s=scope(query),neighbors=edges(s.source,s.identity.geoKey,s.db).map(edge=>{
      try{return describe(edge,s).item;}catch(e){if(e.code!=='SNAPSHOT_TOO_LARGE')throw e;return{...edge,name:s.db[edge.geoKey].name,visited:s.db[edge.geoKey].visited===true,ready:true,preloadable:false,phase:'oversize',stage:null,geometryStamp:null,revision:0,snapshotToken:null};}
    });
    unchanged(query,s.identity);return{version:1,scope:s.identity,neighbors,limits:LIMITS};
  }
  function snapshot(query){
    if(!/^[a-f0-9]{64}$/.test(query.scopeToken||'')||!/^[a-f0-9]{64}$/.test(query.snapshotToken||'')||!text(query.direction,40))throw problem('PRELOAD_TOKEN','Supply the manifest tokens and direction.',400);
    const s=scope(query),edge=edges(s.source,s.identity.geoKey,s.db).find(e=>e.direction===query.direction);
    if(!edge)throw problem('PRELOAD_UNAVAILABLE','That direct route is not available.',404);
    if(edge.locked)throw problem('PRELOAD_LOCKED','That passage is closed.',409);
    const target=describe(edge,s);
    if(!target.item.preloadable)throw problem('PRELOAD_NOT_READY','That adjacent room is not fully prepared.',409);
    if(query.snapshotToken!==target.item.snapshotToken)throw problem('PRELOAD_STALE','The prepared room changed.');
    const id=target.music?.archive?.id,music=/^[a-z0-9-]{1,80}-[a-f0-9]{16}$/.test(id||'')?{title:target.music.title,archiveId:id,
      classicUrl:`/music-archive/${id}/8580.sid`,extendedUrl:`/music-archive/${id}/10582.sid`}:null;
    const result=bounded({version:1,scope:s.identity,direction:edge.direction,geoKey:edge.geoKey,snapshotToken:target.item.snapshotToken,geometryStamp:target.dungeon._geometryStamp,
      dungeon:publicDungeon(target.dungeon),population:publicPopulation(target.population),assets:{illustration:pick(target.room.illustration,['version','source','plan','rasters']),music}});
    unchanged(query,s.identity);if(describe(edge,scope(query)).item.snapshotToken!==target.item.snapshotToken)throw problem('PRELOAD_STALE','The prepared room changed.');
    return result;
  }
  let telemetryRun=null,windowStart=0,count=0;
  function telemetry(body){
    if(!object(body)||!text(body.runId,128)||body.runId!==state.getDungeonRunId())throw problem('TELEMETRY_STALE','That game is no longer active.');
    const allowed=['runId','fromKey','geoKey','stage','elapsedMs','prepareMs','firstFrameMs','movementMs','cached'];
    if(Object.keys(body).some(k=>!allowed.includes(k))||!key(body.fromKey)||!key(body.geoKey)||!TIMINGS.includes(body.stage)||typeof body.cached!=='boolean'||
      ['elapsedMs','prepareMs','firstFrameMs','movementMs'].some(k=>body[k]!==undefined&&(!Number.isFinite(body[k])||body[k]<0||body[k]>1200000)))throw problem('TELEMETRY_INVALID','Invalid room-entry timing report.',400);
    const c=state.getLastCoords(),here=`${c.x},${c.y},${c.z}`,db=JSON.parse(state.getRoomNameDatabase()||'{}');
    if(![body.fromKey,body.geoKey].includes(here)||!edges(db[body.fromKey]||{},body.fromKey,db).some(e=>e.geoKey===body.geoKey&&!e.locked))throw problem('TELEMETRY_STALE','That transition is not current.');
    const time=now();if(telemetryRun!==body.runId||time-windowStart>=60000){telemetryRun=body.runId;windowStart=time;count=0;}
    if(++count>60)throw problem('TELEMETRY_LIMIT','Timing report limit reached.',429);
    logger.info('[RoomEntryTiming]',JSON.stringify(pick(body,allowed)));return{accepted:true};
  }
  return{manifest,snapshot,telemetry};
}
function install(app,state,dependencies){
  const service=createService(state,dependencies);
  const handler=method=>(req,res)=>{
    res.setHeader?.('Cache-Control','no-store');
    try{res.json(service[method](method==='telemetry'?req.body:req.query||{}));}
    catch(error){const known=error.status&&/^PRELOAD_|^SNAPSHOT_|^TELEMETRY_/.test(error.code||'');res.status(known?error.status:503).json({error:known?error.message:'Adjacent-room preload is unavailable.',code:known?error.code:'PRELOAD_UNAVAILABLE'});}
  };
  if(app.get){app.get('/adjacent-room-manifest',handler('manifest'));app.get('/adjacent-room-snapshot',handler('snapshot'));}
  app.post('/room-entry-telemetry',handler('telemetry'));
}
module.exports={LIMITS,createService,install};
