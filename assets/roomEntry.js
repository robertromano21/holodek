(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.RoomEntry=api;})(typeof window==='undefined'?globalThis:window,function(root){
  'use strict';
  const stamp=d=>d?._geometryStamp||d?._meta?.geometryStamp;
  const key=(run,d)=>[run,d?.geoKey,stamp(d)].join('|');
  function create({readManifest,readSnapshot,loadResources,release=()=>{},now=Date.now,maxEntries=2}){
    const cache=new Map();let epoch=0,origin=null,pending=null;
    function clear(){epoch++;for(const entry of cache.values())release(entry.id);cache.clear();origin=null;pending=null;}
    function remember(run,dungeon){
      if(!run||!dungeon?.geoKey||!stamp(dungeon))return Promise.reject(Error('Missing room identity.'));
      const id=key(run,dungeon);if(cache.has(id)){const entry=cache.get(id);cache.delete(id);cache.set(id,entry);return entry.promise;}
      const token=epoch,entry={id,run,geoKey:dungeon.geoKey,stamp:stamp(dungeon),at:now(),resources:null};cache.set(id,entry);
      while(cache.size>maxEntries){const oldest=cache.keys().next().value;release(oldest);cache.delete(oldest);}
      entry.promise=Promise.resolve().then(()=>loadResources(dungeon,id,()=>token===epoch&&cache.get(id)===entry)).then(resources=>{
        if(token!==epoch||cache.get(id)!==entry){release(id);throw Error('Room preload superseded.');}entry.resources=resources;return resources;
      }).catch(error=>{if(cache.get(id)===entry)cache.delete(id);release(id);throw error;});return entry.promise;
    }
    function resources(run,dungeon){return cache.get(key(run,dungeon))?.resources||null;}
    function refresh(identity,preferred){
      const source=[identity.runId,identity.geoKey,identity.geometryStamp].join('|');
      if(origin?.runId&&origin.runId!==identity.runId)clear();
      if(origin?.source!==source){epoch++;origin={...identity,source};pending=null;}
      if(pending)return pending;
      const token=epoch;
      const work=(async()=>{
        const manifest=await readManifest(identity);if(token!==epoch)return;
        if(manifest.scope?.runId!==identity.runId||manifest.scope?.geoKey!==identity.geoKey||manifest.scope?.geometryStamp!==identity.geometryStamp)throw Error('Stale room manifest.');
        const neighbors=(manifest.neighbors||[]).filter(n=>n.preloadable&&n.ready&&!n.locked&&n.geometryStamp)
          .sort((a,b)=>Number(b.direction===preferred)-Number(a.direction===preferred)).slice(0,maxEntries);
        for(const target of neighbors){
          if(token!==epoch)return;const id=[identity.runId,target.geoKey,target.geometryStamp].join('|');if(cache.has(id))continue;
          const snapshot=await readSnapshot(identity,manifest.scope,target);if(token!==epoch)return;
          if(snapshot.scope?.runId!==identity.runId||snapshot.scope?.token!==manifest.scope.token||snapshot.scope?.geometryStamp!==identity.geometryStamp||snapshot.geoKey!==target.geoKey||snapshot.geometryStamp!==target.geometryStamp||snapshot.snapshotToken!==target.snapshotToken||stamp(snapshot.dungeon)!==target.geometryStamp)throw Error('Stale room snapshot.');
          await remember(identity.runId,snapshot.dungeon);
        }
        return manifest;
      })();pending=work;work.finally(()=>{if(pending===work)pending=null;}).catch(()=>{});return work;
    }
    return{clear,remember,resources,refresh,size:()=>cache.size};
  }
  let manager=null,observed=null,preferred=null,lastPoll=0,overlay=null,status=null,transition=null,serial=0;
  const now=()=>root.performance?.now?.()||Date.now();
  function telemetry(stage,extra={}){
    if(!transition)return;const packet={runId:transition.runId,fromKey:transition.fromKey,geoKey:transition.geoKey,stage,
      elapsedMs:Math.max(0,Math.round(now()-transition.at)),cached:!!transition.cached,...extra};root.console?.info?.('[RoomEntry]',packet);
    root.fetch?.('/room-entry-telemetry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet),keepalive:true}).catch(()=>{});
  }
  async function json(url){const r=await root.fetch(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});const v=await r.json();if(!r.ok)throw Error(v.error||'Prepared room unavailable.');return v;}
  function query(identity){return new URLSearchParams(identity).toString();}
  function loadImage(url){return new Promise(resolve=>{const image=new root.Image();let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve(image.complete&&image.naturalWidth?image:null);};const timer=setTimeout(finish,8000);image.onload=()=>{if(image.decode)image.decode().catch(()=>{}).finally(finish);else finish();};image.onerror=finish;image.src=url;});}
  async function loadResources(dungeon,id,valid){
    const textures={},meta={},urls=Object.entries(dungeon.tiles||{}).filter(([,tile])=>tile?.url).slice(0,128);
    for(let offset=0;offset<urls.length;offset+=4){if(!valid())throw Error('Preload superseded.');await Promise.all(urls.slice(offset,offset+4).map(async([name,tile])=>{const image=await loadImage(tile.url);if(image)textures[name]=image;if(tile.spriteSpec)meta[name]=tile.spriteSpec;}));}
    if(!valid())throw Error('Preload superseded.');
    const renderer=root.webglDungeonRenderer;
    if(renderer?.gl&&renderer.prewarmAdjacentRoom)await renderer.prewarmAdjacentRoom(dungeon,id,valid);
    if(!valid())throw Error('Preload superseded.');
    return{textures,meta};
  }
  function getManager(){if(!manager)manager=create({readManifest:i=>json('/adjacent-room-manifest?'+query(i)),
    readSnapshot:(i,scope,target)=>json('/adjacent-room-snapshot?'+query({...i,scopeToken:scope.token,direction:target.direction,snapshotToken:target.snapshotToken})),
    loadResources,release:id=>root.webglDungeonRenderer?.releaseAdjacentRoom?.(id)});return manager;}
  function refresh(){if(!observed||!root.dungeonRunId||root._gameOver)return;lastPoll=Date.now();getManager().refresh(observed,preferred).catch(error=>root.console?.debug?.('[RoomEntry] Preload unavailable:',error.message));}
  function onFrame(dungeon,player,runId){
    if(!dungeon?.geoKey||!stamp(dungeon)||!runId)return;const identity={runId,geoKey:dungeon.geoKey,geometryStamp:stamp(dungeon)};
    const near=root.DungeonExits?.nearby?.(dungeon,player,8)?.direction||null;
    const changed=!observed||query(observed)!==query(identity),approached=near&&near!==preferred;
    if(observed?.runId&&observed.runId!==runId)reset();observed=identity;preferred=near;
    if(changed||approached||Date.now()-lastPoll>6000)refresh();
  }
  function begin(fromKey,geoKey){
    removeOverlay();transition={id:++serial,runId:root.dungeonRunId,fromKey,geoKey,at:now(),frame:false};telemetry('requested');
  }
  function hold(){
    if(overlay||!root.document)return;const source=root.document.querySelector('#retro-graphics-canvas:not([hidden])')||root.webglDungeonRenderer?.canvas;
    if(!source?.width||!source.height||!source.parentNode)return;
    try{overlay=root.document.createElement('canvas');overlay.id='room-entry-hold';overlay.width=source.width;overlay.height=source.height;overlay.setAttribute('aria-hidden','true');overlay.style.cssText=source.style.cssText;Object.assign(overlay.style,{position:'absolute',pointerEvents:'none',zIndex:'2'});overlay.getContext('2d').drawImage(source,0,0);source.parentNode.appendChild(overlay);}catch{overlay?.remove();overlay=null;}
  }
  function removeOverlay(){overlay?.remove();overlay=null;status?.remove();status=null;}
  async function prepare(dungeon,geoKey){
    if(!dungeon||!geoKey||!stamp(dungeon))return null;
    if(!dungeon.geoKey)dungeon={...dungeon,geoKey};
    if(root.currentDungeon?.geoKey!==geoKey)hold();const run=root.dungeonRunId;
    if(transition?.geoKey===geoKey&&root.document&&!status){status=root.document.createElement('div');status.id='room-entry-status';status.setAttribute('role','status');status.style.cssText='position:fixed;left:50%;top:12%;transform:translateX(-50%);z-index:10000;padding:6px 10px;background:#141210e6;color:#ead29d;pointer-events:none';status.textContent='Preparing passage…';root.document.body.appendChild(status);}
    const preparedAt=now(),cached=!!getManager().resources(run,dungeon);if(transition?.geoKey===geoKey)transition.cached=cached;
    try{const resources=await getManager().remember(run,dungeon);if(run!==root.dungeonRunId)throw Error('Adventure changed.');if(transition?.geoKey===geoKey)telemetry('resources-ready',{cached,prepareMs:Math.round(now()-preparedAt)});return resources;}
    catch(error){root.console?.warn?.('[RoomEntry]',error.message);return null;}
  }
  function shown(dungeon){
    if(!transition){if(overlay)root.requestAnimationFrame(()=>root.requestAnimationFrame(removeOverlay));return;}
    if(transition.frame||transition.geoKey!==dungeon?.geoKey)return;transition.frame=true;const id=transition.id;
    root.requestAnimationFrame(()=>root.requestAnimationFrame(()=>{if(transition?.id!==id)return;removeOverlay();telemetry('first-frame',{firstFrameMs:Math.round(now()-transition.at)});
      const resume=()=>{if(transition?.id!==id)return;if(root.PlayerControls?.blocked?.(true)){if(now()-transition.at<60000)root.setTimeout(resume,50);return;}
        root.resumeDungeonHeldMovement?.();telemetry('movement-ready',{movementMs:Math.round(now()-transition.at)});transition.movement=true;};resume();}));
  }
  function reset(){manager?.clear();observed=null;preferred=null;transition=null;serial++;removeOverlay();}
  function cancel(){telemetry('cancelled');transition=null;removeOverlay();}
  if(root.document)root.setInterval(()=>{if(transition?.movement&&!root.GameCommandGate?.busy?.())transition=null;if(transition&&now()-transition.at>120000)cancel();if(observed&&Date.now()-lastPoll>6000)refresh();},1500);
  return{create,onFrame,begin,prepare,shown,reset,cancel,isPending:()=>!!transition,walkingAllowed:()=>!!transition&&transition.runId===root.dungeonRunId&&[transition.fromKey,transition.geoKey].includes(root.currentDungeon?.geoKey),texturesFor:d=>manager?.resources(root.dungeonRunId,d)};
});
