(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.CityCirculationUi=api;})(typeof window==='object'?window:globalThis,function(root){
  'use strict';
  let pending=false,suppressed=null;
  function blocked(){return root.gamePaused||root._gameOver||root._playerUnconscious||root._deathSceneActive||root._characterStartupPending||root._combatCommandPending||root.__builderWalk||
    root.actionDiceState?.active||root._combatRoundActiveUntil>Date.now()||root.RoomEntry?.isPending?.()||root.GameCommandGate?.busy?.()||
    root.document?.querySelector('.popup-container')||/^(INPUT|TEXTAREA|SELECT)$/.test(root.document?.activeElement?.tagName);}
  const identity=d=>`${root.dungeonRunId}:${d.geoKey}`;
  const reachable=(d,c,p)=>root.DungeonInhabitants?.pointWalkable(d,p?.x,p?.y)&&[c.point,c.trigger].filter(Boolean).some(q=>
    Math.hypot(q.x-p.x,q.y-p.y)<=2.8&&root.DungeonInhabitants.lineClear(d,p,q));
  function suppress(key){suppressed=`${root.dungeonRunId}:${key}`;}
  function onLanding(c,p){
    const b=c.triggerArea||(c.box&&{x:c.box.x,y:c.box.y,width:c.box.sx>c.box.sy?1:2,depth:c.box.sx>c.box.sy?2:1});
    return b?p.x>=b.x&&p.y>=b.y&&p.x<b.x+b.width&&p.y<b.y+b.depth:Math.hypot(c.trigger.x-p.x,c.trigger.y-p.y)<.7;
  }
  async function travel(control,floor){
    const ctx=root.getDungeonLifeContext?.(),d=ctx?.dungeon;
    if(pending||blocked()||!d||!d.cityCirculation?.controls.some(c=>c.id===control.id)||!reachable(d,control,ctx.player))return false;
    pending=true;const runId=root.dungeonRunId,stamp=d._geometryStamp,token=identity(d);let held=false;suppressed=token;
    try{
      held=true;root.GameCommandGate?.begin?.();
      const response=await root.fetch('/city/buildings/travel',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({runId,geoKey:d.geoKey,geometryStamp:stamp,controlId:control.id,floor,player:{...ctx.player}})});
      const result=await response.json();if(!response.ok)throw Error(result.error||'The landing is unavailable.');
      if(result.hostLocal){await root.applyCityFloor?.(result);return true;}
      const current=root.getDungeonLifeContext?.();
      if(root.currentDungeon!==d||identity(d)!==token||d._geometryStamp!==stamp||result.runId!==runId||result.geoKey!==d.geoKey||
        result.controlId!==control.id||!reachable(d,control,current?.player))return false;
      root.GameCommandGate?.end?.();held=false;
      if(blocked())return false;
      suppressed=token;await root.enterCityBuilding(result);return true;
    }catch(error){
      if(root.currentDungeon===d&&root.dungeonRunId===runId)root.DungeonActionNotices?.receive?.({id:'city-floor:'+Date.now(),runId,geoKey:d.geoKey,
        kind:'city-travel',title:control.label,result:'blocked',message:error.message});return false;
    }finally{pending=false;if(held&&root.dungeonRunId===runId)root.GameCommandGate?.end?.();}
  }
  function open(control){
    if(control.mode!=='lift')return travel(control);
    const ctx=root.getDungeonLifeContext?.();if(blocked()||pending||!ctx?.dungeon||!reachable(ctx.dungeon,control,ctx.player))return false;
    const panel=root.document.createElement('section');panel.className='popup-container combat-target-actions';panel.setAttribute('role','dialog');
    const title=root.document.createElement('h3');title.textContent=control.label;panel.appendChild(title);
    const label=root.document.createElement('label');label.textContent='Destination floor ';const select=root.document.createElement('select');
    for(let floor=0;floor<control.storeys;floor++)if(floor!==control.floor){const option=root.document.createElement('option');option.value=String(floor);option.textContent=floor===0?'Street / lobby':`Level ${floor}`;select.appendChild(option);}
    label.appendChild(select);panel.appendChild(label);
    const go=root.document.createElement('button');go.className='popup-button';go.textContent='Use lift';go.onclick=()=>{const floor=Number(select.value);panel.remove();travel(control,floor);};
    const close=root.document.createElement('button');close.className='popup-button';close.textContent='Cancel';close.onclick=()=>panel.remove();
    panel.appendChild(go);panel.appendChild(close);root.document.body.appendChild(panel);root.CombatCharacterUi?.positionActions?.(panel);return true;
  }
  function onFrame(d,player){
    if(!root.HolodekFlags?.ARCHITECTURE_EXPANSION||!d?.cityCirculation||root.currentDungeon!==d||pending||!Number.isFinite(player?.x)||!Number.isFinite(player?.y))return;
    const stairs=d.cityCirculation.controls.filter(c=>c.mode==='stairs'&&c.trigger);
    if(suppressed===identity(d)){
      if(stairs.some(c=>Math.hypot(c.trigger.x-player.x,c.trigger.y-player.y)<2.2))return;
      suppressed=null;
    }
    if(blocked())return;
    const c=stairs.find(c=>onLanding(c,player)&&reachable(d,c,player));
    if(c)return travel(c);
  }
  return{open,travel,onFrame,suppress,reachable};
});
