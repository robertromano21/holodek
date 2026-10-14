(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ObjectDiscovery=api;
})(typeof window==='object'?window:globalThis,function(root){
  'use strict';
  const key=value=>String(value||'').trim().toLowerCase();
  let room=null, visible=new Set(), view=null;
  function countRemaining(objects){
    const rows=Array.isArray(objects)?objects:String(objects||'').split(',');
    return new Set(rows.map(row=>key(typeof row==='string'?row:row?.name))
      .filter(name=>name&&!/^(none|empty|nothing|null|undefined)\.?$/.test(name))).size;
  }
  function isVisible(dungeon,name){return room===dungeon&&visible.has(key(name));}
  function hasDiscovered(dungeon,name){return !!dungeon?.objectDiscoveries?.names?.includes(key(name));}
  function snapshot(dungeon) {
    return room === dungeon && view ? { camera: { ...view }, names: [...visible] } : null;
  }
  function takeRequest(dungeon, command) {
    const match = /^\s*(?:take|pick\s+up|collect)\s+(.+?)\s*$/i.exec(command);
    if (!match) return { error: 'Choose an object currently in view to take.' };
    const all = /^(?:all|all objects|everything)$/i.test(match[1]);
    const names = all ? [...visible] : [...new Set(match[1].split(/,\s*/).map(key).filter(Boolean))];
    if (room !== dungeon || !names.length || names.some(name => !isVisible(dungeon, name)))
      return { error: 'Only objects currently shown in Objects in Room can be taken. Turn toward the object first.' };
    return { names, all };
  }
  function refreshConsole(){
    if(typeof document==='undefined')return;
    const container=document.getElementById('phaser-container');
    if(!container||container.dataset.consoleGeoKey!==room?.geoKey)return;
    const list=container.querySelector('[data-room-object-list]');
    if(list){
      let count=0;
      for(const entry of list.querySelectorAll('[data-room-object]')){
        const show=isVisible(room,entry.dataset.roomObject);entry.hidden=!show;
        const comma=entry.querySelector('[data-object-comma]');if(comma)comma.hidden=count===0;
        if(show)count++;
      }
      const empty=list.querySelector('[data-no-visible-objects]');if(empty)empty.hidden=count>0;
    }
    const properties=container.querySelector('[data-room-object-properties]');
    if(properties){
      const rows=root.InventoryUi?.parseProperties(container.dataset.roomObjectProperties)||[];
      properties.textContent=rows.filter(r=>isVisible(room,r.name)).map(r=>JSON.stringify(r)).join(', ')||'None in view';
    }
    const remaining=container.querySelector('[data-room-object-count]');
    if(remaining&&container.dataset.roomObjects!==undefined)remaining.textContent=String(countRemaining(container.dataset.roomObjects));
    const popup=document.querySelector('.popup-container[data-dungeon-item]');
    if(popup&&!isVisible(room,popup.dataset.dungeonItem))popup.remove();
  }
  function update(dungeon,targets,camera){
    view = camera ? Object.fromEntries(['x','y','eyeZ','dirX','dirY','planeScale','verticalScale','viewShift','aspect'].map(k=>[k,camera[k] ?? (k==='aspect'?1:0)])) : null;
    const next=new Set(targets.filter(t=>t.type==='item').map(t=>key(t.label)));
    const changed=room!==dungeon||next.size!==visible.size||[...next].some(n=>!visible.has(n));
    room=dungeon;visible=next;
    if(changed)refreshConsole();
    if(!next.size)return [];
    dungeon.objectDiscoveries||={version:1,names:[]};
    const fresh=targets.filter(t=>t.type==='item'&&!hasDiscovered(dungeon,t.label));
    for(const target of fresh){
      const name=key(target.label);if(hasDiscovered(dungeon,name))continue;
      dungeon.objectDiscoveries.names.push(name);
      const icon=root.SceneItems?.createItemCanvas?.(target.item)?.toDataURL?.('image/png');
      root.DungeonActionNotices?.receive?.({id:'object:'+dungeon.geoKey+':'+name,runId:root.dungeonRunId,geoKey:dungeon.geoKey,
        kind:'object-discovered',title:target.label,message:'Discovered in view. Walk closer to inspect or take it.',icon});
    }
    if(fresh.length)root.persistDungeonObjectDiscoveries?.(dungeon);
    return fresh;
  }
  function reset(){room=null;visible=new Set();view=null;}
  return{update,isVisible,hasDiscovered,countRemaining,refreshConsole,reset,snapshot,takeRequest};
});
