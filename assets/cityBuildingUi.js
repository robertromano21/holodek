(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.CityBuildingUi=api;})(typeof window==='object'?window:globalThis,function(root){
  'use strict';
  let suppressed=null,pending=false;
  const threshold=(b,player)=>(root.CityParcels||(typeof require==='function'?require('./cityParcels'):null)).entrance(b,player);
  const identity=(d,b)=>`${root.dungeonRunId}:${d.geoKey}:${b.id}`;
  function atDoor(d,b,player){
    if(!Number.isFinite(player?.x)||!Number.isFinite(player?.y))return false;
    const point=threshold(b,player),vertical=point?.x===b.left+Math.floor(b.width/2)+.5;
    if(!point)return false;
    const across=vertical?Math.abs(player.x-point.x):Math.abs(player.y-point.y);
    const depth=vertical?Math.abs(player.y-point.y):Math.abs(player.x-point.x);
    // The three-cell doorway sits inside the frontage, not on the passing pavement.
    return across<=1.4&&depth<=.65&&root.DungeonInhabitants?.pointWalkable(d,player.x,player.y)&&
      root.DungeonInhabitants?.lineClear(d,player,point);
  }
  function nearby(d,player){
    if(!d?.cityBlocks||!player)return null;
    // Procedural ground floors are already part of the street grid, including legacy parcels.
    return (d.cityBlocks.buildings||[]).filter(b=>b.authored&&atDoor(d,b,player)).map(b=>({building:b,point:threshold(b,player)}))
      .sort((a,b)=>Math.hypot(a.point.x-player.x,a.point.y-player.y)-Math.hypot(b.point.x-player.x,b.point.y-player.y))[0]?.building||null;
  }
  function suppress(geoKey,id){suppressed=`${root.dungeonRunId}:${geoKey}:${id}`;}
  function blocked(){
    return root.gamePaused||root._gameOver||root._playerUnconscious||root._deathSceneActive||root._characterStartupPending||root._combatCommandPending||
      root.__builderWalk||root.actionDiceState?.active||root.GameCommandGate?.busy?.()||root.RoomEntry?.isPending?.()||root._combatRoundActiveUntil>Date.now()||
      root.document.querySelector('.popup-container')||/^(INPUT|TEXTAREA|SELECT)$/.test(root.document.activeElement?.tagName);
  }
  async function enter(d,b){
    pending=true;suppressed=identity(d,b);
    const runId=root.dungeonRunId,geoKey=d.geoKey,geometryStamp=d._geometryStamp;let held=false;
    const current=()=>root.dungeonRunId===runId&&root.currentDungeon===d;
    try{
      let ctx=root.getDungeonLifeContext?.();
      if(!current()||ctx?.dungeon!==d||!atDoor(d,b,ctx.player))return;
      held=true;root.GameCommandGate?.begin?.();
      const response=await root.fetch('/city/buildings/prepare',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({runId,geoKey,geometryStamp,buildingId:b.id,player:{...ctx.player}})});
      const result=await response.json();if(!response.ok)throw Error(result.error||'The building is unavailable.');
      if(result.unchanged)return;
      if(result.hostLocal){await root.applyCityFloor?.(result);return;}
      ctx=root.getDungeonLifeContext?.();
      if(!current()||ctx?.dungeon!==d||d._geometryStamp!==geometryStamp||result.runId!==runId||result.geoKey!==geoKey||
        result.buildingId!==b.id||!atDoor(d,b,ctx.player))return;
      root.GameCommandGate?.end?.();held=false;
      // State may have paused or opened a menu during the preparation request.
      if(blocked())return;
      await root.enterCityBuilding(result);
    }catch(error){
      if(current())root.DungeonActionNotices?.receive?.({id:`city-entry:${runId}:${geoKey}:${b.id}:${Date.now()}`,
        runId,geoKey,kind:'city-entry',title:b.name||'Building Entrance',result:'blocked',message:error.message});
    }finally{
      pending=false;
      if(held&&current())root.GameCommandGate?.end?.();
    }
  }
  function onFrame(d,player){
    if(!root.document||!root.HolodekFlags?.ARCHITECTURE_EXPANSION||pending||!d?.cityBlocks||root.currentDungeon!==d||
      !Number.isFinite(player?.x)||!Number.isFinite(player?.y))return;
    if(suppressed){
      const held=(d.cityBlocks.buildings||[]).find(b=>identity(d,b)===suppressed),point=held&&threshold(held,player);
      if(!point||Math.hypot(player.x-point.x,player.y-point.y)>2.2)suppressed=null;
    }
    if(blocked())return;
    const b=nearby(d,player);if(!b||suppressed===identity(d,b))return;
    return enter(d,b);
  }
  return{threshold,nearby,suppress,onFrame};
});
