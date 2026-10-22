'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Snap=require('../retort/adjacentRoomSnapshots');
function fixture(){
  let runId='run',here={x:0,y:0,z:0},model={id:'gpt-6-luna',revision:1},restore=0,quest='quest',writes=0;
  const origin={name:'Origin',visited:true,description:'The current room.',exits:{north:{targetCoordinates:'0,1,0',status:'open'}}};
  const population={version:1,geoKey:'0,1,0',revision:1,actors:{Guide:{name:'Guide',position:{x:2,y:2},hp:10,sprite:{spec:{role:'shade'}},history:'private history',dialogue:['future words']}},groups:[]};
  const db={'0,0,0':origin,'0,1,0':{name:'Court',populationComplete:true,preparedBuild:{version:1,id:'job',runId:'run',model:model.id,ready:true,stage:'complete',revision:1},inhabitants:population,
    illustration:{version:1,source:'art',plan:{layers:[]}},exits:{north:{targetCoordinates:'0,2,0'}},secret:'not for preload'},'0,2,0':{name:'Unseen far room',secret:'far-room-sentinel'}};
  const dungeon=geoKey=>({geoKey,_geometryStamp:'stamp-'+geoKey,layout:{width:4,height:4},cells:{'1,1':{tile:'floor',floorHeight:0,ceilHeight:6}},start:{x:1,y:1},
    sceneSpec:{source:{roomName:'Court',description:'A court.',puzzleSolution:'private solution'},worldContext:{db,secret:'far-world-sentinel'}},
    secretDoors:{version:1,revision:0,doors:[{id:'hidden',discovered:false},{id:'known',discovered:true,x:2,y:2}]}});
  const dungeons={'0,0,0':dungeon('0,0,0'),'0,1,0':dungeon('0,1,0')},songs={'0,1,0':{title:'Court music',voices:[{}],archive:{id:'court-0123456789abcdef'}}};
  const jobs=[{key:'0,1,0',runId:'run',model:model.id,phase:'running',stage:'music',reason:'must not be sent'}],logs=[];
  const state={getDungeonRunId:()=>runId,getLastCoords:()=>here,getRestoreRevision:()=>restore,getCurrentQuest:()=>quest,getCurrentTasks:()=>[],getCurrentTaskIndex:()=>0,
    getRoomNameDatabase:()=>JSON.stringify(db),getRoomDungeonForSimulation:c=>dungeons[`${c.x},${c.y},${c.z}`],getRoomDungeon(){throw Error('Mutating/cloning getter forbidden.');},
    getRoomMusic:c=>songs[`${c.x},${c.y},${c.z}`],getRoomPopulation:k=>db[k]?.inhabitants,
    setRoomNameDatabase(){writes++;throw Error('Mutation forbidden.');},setLastCoords(){writes++;throw Error('Mutation forbidden.');}};
  const deps={models:{current:()=>model},adjacent:{status:()=>jobs,queueNeighbors(){writes++;throw Error('Generation forbidden.');},_reset(){writes++;throw Error('Reset forbidden.');}},flags:()=>({FOOT_EXITS:true}),logger:{info:(...v)=>logs.push(v)},now:()=>100};
  const service=Snap.createService(state,deps),query={runId:'run',geoKey:'0,0,0',geometryStamp:'stamp-0,0,0'};
  const snapshot=()=>{const manifest=service.manifest(query),neighbor=manifest.neighbors.find(n=>n.direction==='north');return{...query,scopeToken:manifest.scope.token,direction:'north',snapshotToken:neighbor.snapshotToken};};
  return{db,dungeons,songs,population,state,deps,service,query,snapshot,jobs,logs,get writes(){return writes;},setRun:v=>runId=v,setHere:v=>here=v,setModel:v=>model=v,setRestore:v=>restore=v,setQuest:v=>quest=v};
}
test('manifest and graphics snapshot read only direct prepared destinations, without hidden campaign state',()=>{
  const f=fixture(),before=JSON.stringify([f.db,f.dungeons,f.songs]);
  const manifest=f.service.manifest(f.query);assert.equal(manifest.neighbors.length,1);assert.equal(manifest.neighbors[0].ready,true);
  assert.equal(manifest.scope.model.revision,1);assert.match(manifest.scope.contextStamp,/^[a-f0-9]{64}$/);
  const response=f.service.snapshot(f.snapshot());assert.equal(response.geoKey,'0,1,0');assert.equal(response.geometryStamp,'stamp-0,1,0');
  assert.equal(response.population.actors.Guide.position.x,2);assert.equal(response.assets.music.extendedUrl,'/music-archive/court-0123456789abcdef/10582.sid');
  const output=JSON.stringify(response);
  for(const forbidden of ['Unseen far room','far-room-sentinel','far-world-sentinel','private solution','private history','future words','targetCoordinates'])assert.ok(!output.includes(forbidden),forbidden);
  assert.deepEqual(response.dungeon.secretDoors.doors.map(d=>d.id),['known']);
  assert.equal(JSON.stringify([f.db,f.dungeons,f.songs]),before);assert.equal(f.writes,0);
});
test('incomplete checkpoints expose bounded status only; all assets are required before unvisited readiness',()=>{
  for(const field of ['population','geometry','music','art','receipt']){
    const f=fixture();
    if(field==='population')delete f.db['0,1,0'].inhabitants;
    if(field==='geometry')delete f.dungeons['0,1,0'];
    if(field==='music')delete f.songs['0,1,0'];
    if(field==='art')delete f.db['0,1,0'].illustration;
    if(field==='receipt')f.db['0,1,0'].preparedBuild.ready=false;
    const manifest=f.service.manifest(f.query),item=manifest.neighbors[0];
    assert.equal(item.ready,false,field);assert.equal(item.snapshotToken,null);assert.equal(item.phase,'running');assert.equal(item.stage,'complete');
    assert.ok(!JSON.stringify(manifest).includes('must not be sent'));
    assert.throws(()=>f.service.snapshot({...f.query,scopeToken:manifest.scope.token,direction:'north',snapshotToken:'a'.repeat(64)}),e=>e.code==='PRELOAD_NOT_READY');
  }
});
test('hidden, undiscovered, nonexistent and far destinations cannot be requested; locked exits cannot yield snapshots',()=>{
  const f=fixture(),source=f.db['0,0,0'];
  source.exits.east={targetCoordinates:'0,2,0',hidden:true};source.exits.west={targetCoordinates:'0,2,0',secret:true};source.exits.south={targetCoordinates:'99,99,99'};
  const query=f.snapshot(),manifest=f.service.manifest(f.query);assert.deepEqual(manifest.neighbors.map(n=>n.direction),['north']);
  for(const direction of ['east','west','south','unknown'])assert.throws(()=>f.service.snapshot({...query,direction}),e=>e.code==='PRELOAD_UNAVAILABLE');
  source.exits.north.status='sealed';const next=f.service.manifest(f.query);assert.equal(next.neighbors[0].locked,true);assert.equal(next.neighbors[0].preloadable,false);
  assert.throws(()=>f.service.snapshot({...query,scopeToken:next.scope.token}),e=>e.code==='PRELOAD_LOCKED');
});
test('declared diagonal and portal destinations work, but undeclared coordinate neighbors never appear',()=>{
  const f=fixture();f.db['0,0,0'].exits={northeast:{status:'open'},portal:{kind:'portal',targetCoordinates:'500,400,100',status:'open'}};
  f.db['1,1,0']={...f.db['0,1,0'],name:'Diagonal'};f.db['500,400,100']={...f.db['0,1,0'],name:'Portal realm'};
  assert.deepEqual(f.service.manifest(f.query).neighbors.map(n=>n.geoKey),['1,1,0','500,400,100']);
  f.db['0,0,0'].exits={north:'open'};assert.equal(f.service.manifest(f.query).neighbors[0].preloadable,true);
});
test('visited geometry/population remains reusable without a new-generation receipt or new art/music',()=>{
  const f=fixture(),room=f.db['0,1,0'];room.visited=true;delete room.preparedBuild;delete room.illustration;delete f.songs['0,1,0'];
  assert.equal(f.service.manifest(f.query).neighbors[0].ready,true);assert.equal(f.service.snapshot(f.snapshot()).assets.music,null);
});
test('foot traversal remains authoritative and preload never marks a route traversed',()=>{
  const f=fixture();f.db['0,0,0'].footExitsTracked=true;const before=JSON.stringify(f.db);
  const item=f.service.manifest(f.query).neighbors[0];assert.equal(item.requiresFootTraversal,true);assert.equal(item.preloadable,true);
  f.service.snapshot(f.snapshot());assert.equal(JSON.stringify(f.db),before);assert.equal(f.writes,0);
});
test('cached tokens reject model, quest, restore, source locks and target revisions changing',()=>{
  const changes=[f=>f.setModel({id:'gpt-6-luna',revision:2}),f=>f.setQuest('new quest'),f=>f.setRestore(1),
    f=>f.db['0,0,0'].exits.north.status='locked',f=>f.population.revision++,f=>f.population.actors.Guide.position.x++,f=>f.db['0,1,0'].illustration.source='new-art',
    f=>f.dungeons['0,1,0']._geometryStamp='new-stamp',f=>f.songs['0,1,0'].archive.id='new-song-0123456789abcdef'];
  for(const change of changes){const f=fixture(),query=f.snapshot();change(f);assert.throws(()=>f.service.snapshot(query),e=>e.code==='PRELOAD_STALE');}
  const f=fixture();f.db['0,1,0'].preparedBuild.model='other-model';assert.equal(f.service.manifest(f.query).neighbors[0].ready,false);
  f.db['0,1,0'].preparedBuild.runId='old-run';assert.equal(f.service.manifest(f.query).neighbors[0].ready,false);
});
test('stale run, current room, geometry, malformed identities and missing tokens fail without mutation',()=>{
  const f=fixture();for(const query of [{...f.query,runId:'old'},{...f.query,geoKey:'0,1,0'},{...f.query,geometryStamp:'old'}])assert.throws(()=>f.service.manifest(query),e=>e.code==='PRELOAD_STALE');
  for(const geoKey of ['00,0,0','0,0,0 extra',['0,0,0'],'1.5,0,0'])assert.throws(()=>f.service.manifest({...f.query,geoKey}),e=>e.status===400);
  assert.throws(()=>f.service.snapshot({...f.query,direction:'north'}),e=>e.code==='PRELOAD_TOKEN');assert.equal(f.writes,0);
});
test('payloads and neighbor count are bounded and oversized rooms fail with normal-entry fallback',()=>{
  const f=fixture();for(let i=0;i<30;i++){f.db['0,0,0'].exits['door'+i]={targetCoordinates:`${i+1},0,0`};f.db[`${i+1},0,0`]={name:'Door '+i};}
  assert.equal(f.service.manifest(f.query).neighbors.length,Snap.LIMITS.neighbors);
  const query=f.snapshot();f.dungeons['0,1,0'].tiles={large:'x'.repeat(Snap.LIMITS.snapshotBytes+1)};
  assert.throws(()=>f.service.snapshot(query),e=>e.status===413&&e.code==='SNAPSHOT_TOO_LARGE');
  f.population.actors.Guide.sprite={dataUrl:'x'.repeat(Snap.LIMITS.snapshotBytes+1)};
  const oversized=f.service.manifest(f.query).neighbors[0];assert.equal(oversized.preloadable,false);assert.equal(oversized.phase,'oversize');
});
test('reentrant state changes during a read invalidate the response, without publishing a mixed-run manifest',()=>{
  const f=fixture(),read=f.state.getRoomPopulation;let changed=false;
  f.state.getRoomPopulation=k=>{if(!changed){changed=true;f.setRun('new-run');}return read(k);};
  assert.throws(()=>f.service.manifest(f.query),e=>e.code==='PRELOAD_STALE');assert.equal(f.writes,0);
});
test('telemetry is bounded, run-scoped logs only, and cannot inject fields or request foreign transitions',()=>{
  const f=fixture(),body={runId:'run',fromKey:'0,0,0',geoKey:'0,1,0',stage:'first-frame',elapsedMs:17,firstFrameMs:16,cached:true},before=JSON.stringify(f.db);
  assert.deepEqual(f.service.telemetry(body),{accepted:true});assert.equal(f.logs.length,1);assert.equal(f.writes,0);assert.equal(JSON.stringify(f.db),before);
  f.setHere({x:0,y:1,z:0});assert.deepEqual(f.service.telemetry({...body,stage:'movement-ready'}),{accepted:true});
  for(const change of [{runId:'old'},{elapsedMs:NaN},{prepareMs:-1},{movementMs:Infinity},{stage:'secret'},{credential:'secret'},{geoKey:'0,2,0'},{cached:'yes'}])assert.throws(()=>f.service.telemetry({...body,...change}));
  for(let i=0;i<58;i++)f.service.telemetry(body);assert.throws(()=>f.service.telemetry(body),e=>e.status===429);
});
test('routes disable HTTP caching, sanitize internal failures and preserve legacy display behavior',()=>{
  const f=fixture(),get={},post={};require('../retort/roomPrefetchRoutes').install({get:(p,h)=>get[p]=h,post:(p,h)=>post[p]=h},f.state,
    {...f.deps,website:{backgroundEnabled:()=>false,view:()=>({revision:1})}});
  let code=200,result,cache;const res={setHeader:(k,v)=>{if(k==='Cache-Control')cache=v;},status(n){code=n;return this;},json:v=>result=v};
  get['/adjacent-room-manifest']({query:f.query},res);assert.equal(code,200);assert.equal(cache,'no-store');assert.equal(result.neighbors[0].ready,true);
  f.state.getRoomNameDatabase=()=>{throw Error('secret private host and key');};get['/adjacent-room-manifest']({query:f.query},res);
  assert.equal(code,503);assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(post['/room-displayed']);assert.ok(post['/room-entry-telemetry']);
});
