(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.CityCrowdUi=api;})(typeof window==='object'?window:globalThis,function(root){
  'use strict';
  const cache=new Map(),offered=new Map(),greetingBudgets=new Map();let pending=false,pinned=null,buildFrame=-1,built=0,offerRun=null,lastOfferAt=-Infinity;
  const VENUES=new Set(['shop','temple','clinic','inn','bar','foodhall','workshop','warehouse','guild','library','civic','court','transit','theatre','bathhouse','arena']);
  function specFor(row,{procedural=root.ProceduralCharacters,architecture=root.GenreArchitecture}={}){
    const sheet={name:row.name,sex:row.sex,race:[row.race,row.appearance].filter(Boolean).join(' '),class:row.role,level:1,isMonster:true};
    const traits=procedural.deriveFallbackTraits(sheet),garb=architecture?.garbFor([{genre:row.genre,weight:1}],row.name);
    if(garb&&!['fantasy','dark-fantasy','mythic','desert-fantasy','gothic-horror','prehistoric'].includes(row.genre)&&['humanoid','giant','skeletal'].includes(traits.bodyPlan)){
      traits.outfit={...traits.outfit,style:'leather',hood:false,cape:false,helm:'none',symbol:'none'};
    }
    if(!/guard|soldier|military|hunter/i.test(row.role||''))traits.items=[];
    if(garb)traits.genreGarb=garb;
    return procedural.buildProceduralSpriteSpec(sheet,traits,{salt:row.seed,source:'procedural-crowd',signature:false});
  }
  function actors(dungeon,player){
    if(!dungeon?.cityCrowd||!root.ProceduralCharacters)return[];
    const frame=Math.floor((root.performance?.now?.()??Date.now())/16);
    if(frame!==buildFrame){buildFrame=frame;built=0;}
    const motion=root.CityCrowdMotion,point=row=>motion?.position(dungeon,row)||row.position;
    const candidates=Object.values(dungeon.cityCrowd.actors).filter(a=>a.status==='ambient'&&
      dungeon.cells[`${point(a).x},${point(a).y}`]?.tile==='floor'&&Math.hypot(point(a).x+.5-player.x,point(a).y+.5-player.y)<48)
      .sort((a,b)=>Math.hypot(a.position.x-player.x,a.position.y-player.y)-Math.hypot(b.position.x-player.x,b.position.y-player.y));
    const rows=[];
    for(const row of candidates){
      const p=point(row);if(root.DungeonInhabitants&&!root.DungeonInhabitants.lineClear(dungeon,player,{x:p.x+.5,y:p.y+.5}))continue;
      rows.push(row);if(rows.length===24)break;
    }
    const visible=[],occupied=new Set(Object.values(dungeon.cityCrowd.actors).filter(a=>a.status==='ambient').map(a=>`${point(a).x},${point(a).y}`));
    for(const a of root.combatCharacters||[])if(Number.isFinite(a.mazeX)&&Number.isFinite(a.mazeY))occupied.add(`${a.mazeX},${a.mazeY}`);
    for(const row of rows){
      const id=root.dungeonRunId+':'+(root.CityFloorScope?.cacheKey(dungeon.geoKey,dungeon)||dungeon.geoKey)+':'+row.id;
      if(!cache.has(id)){
        if(built>=2)continue;
        built++;
        const spec=specFor(row);
        const canvas=root.createTraitSpriteCanvas?.(spec,0);
        const sprite={spec,dataUrl:canvas?.toDataURL?.()||'',procedural:true,source:'procedural-crowd',clientOnly:true};
        cache.set(id,{name:row.name,type:'ambient',ambient:true,crowdId:row.id,race:row.race,sex:row.sex,job:row.role,
          mazeRoomKey:dungeon.geoKey,mazeX:row.position.x,mazeY:row.position.y,state:'Neutral',sprite});
        if(cache.size>256)cache.delete(cache.keys().next().value);
      }
      const actor=cache.get(id),p=motion?.advance(dungeon,row,player,occupied,Date.now(),{pinned:pinned===row.id||root.CommerceUi?.isInteracting?.(row.name)})||row.position;
      if(actor.mazeX!==p.x||actor.mazeY!==p.y){
        actor._renderFromMazeX=actor.renderMazeX??actor.mazeX;actor._renderFromMazeY=actor.renderMazeY??actor.mazeY;
        actor.mazeX=p.x;actor.mazeY=p.y;actor._renderTweenToX=p.x;actor._renderTweenToY=p.y;actor._renderTweenStartedAt=Date.now();actor.moveTweenMs=900;
      }
      actor.activity=row.activity;actor.occupation=row.occupation;visible.push(actor);
    }
    return visible;
  }
  function receive(event){
    if(event.runId!==root.dungeonRunId||event.geoKey!==root.currentDungeon?.geoKey||!event.crowd)return;
    if((root.currentDungeon.cityCrowd?.revision||0)>event.crowd.revision)return;
    root.CityCrowdMotion?.reconcile(root.currentDungeon,event.crowd);
    root.currentDungeon.cityCrowd=event.crowd;root.persistCityCrowd?.();
  }
  function offer(actor,show){
    const run=root.dungeonRunId,now=Date.now(),d=root.currentDungeon;
    if(offerRun!==run){offered.clear();offerRun=run;lastOfferAt=-Infinity;}
    const id=run+':'+(root.CityFloorScope?.cacheKey(d.geoKey,d)||d.geoKey)+':'+actor.name;
    if(now-lastOfferAt<8000||now<(offered.get(id)||0))return false;
    if(!show())return false;
    offered.set(id,now+90000);lastOfferAt=now;if(offered.size>256)offered.delete(offered.keys().next().value);return true;
  }
  function offerAmbient(actor){return root.CommerceUi?.inviteAmbient?.(actor,()=>open(actor,{services:true}))||false;}
  async function open(actor,{services=false,counterId}={}){
    if(pending||!actor.ambient||root.gamePaused||root.actionDiceState?.active||root.GameCommandGate?.busy?.())return false;
    const ctx=root.getDungeonLifeContext?.();if(!ctx||ctx.dungeon.geoKey!==actor.mazeRoomKey)return false;
    const row=ctx.dungeon.cityCrowd?.actors?.[actor.crowdId];
    if(!services&&!root.EconomyRules?.isStarterRoom(ctx.dungeon.geoKey,ctx.dungeon)&&row?.occupation?.mode==='work'&&VENUES.has(row.occupation.venueType))return offerAmbient(actor);
    const runId=root.dungeonRunId,floorToken=root.CityFloorScope?.token();
    const current=()=>root.currentDungeon?.geoKey===ctx.dungeon.geoKey&&root.dungeonRunId===runId&&root.CityFloorScope?.token()===floorToken&&
      (root.currentDungeon===ctx.dungeon||typeof floorToken==='string'&&floorToken.length>0);
    pending=true;pinned=actor.crowdId;
    const track=root.GameCommandGate?.trackNative||((work)=>work());
    return track(async()=>{
    try{
      const response=await root.fetch('/city/residents/meet',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({runId,geoKey:ctx.dungeon.geoKey,floorToken,id:actor.crowdId,counterId,player:{...ctx.player},
          geometryStamp:ctx.dungeon._geometryStamp,crowdMovements:root.CityCrowdMotion?.observations(ctx.dungeon)})});
      const result=await response.json();if(!response.ok)throw Error(result.error||'The resident could not respond.');
      if(!current())return false;
      receive(result);await root.applyRealtimeCombatResult?.(result);
      if(!current())return false;
      root.DungeonLife?.receiveDialogue?.({dialogue:result.dialogue,runId:result.runId,geoKey:result.geoKey,source:'citizen-introduction'});
      const business=root.getEconomyResidentInfo?.(result.actor);
      if(services||result.serviceAccess||business&&(business.venue||['shop','temple'].includes(business.kind)))
        return await root.CommerceUi?.open(result.actor,{counterId})||false;
      return true;
    }catch(error){
      if(current())root.DungeonActionNotices?.receive?.({id:'citizen:'+Date.now(),runId,geoKey:ctx.dungeon.geoKey,
        kind:'city-resident',title:actor.name,message:error.message});return false;
    }finally{pending=false;pinned=null;}
    });
  }
  function greetAmbient(d,player){
    const now=Date.now(),run=root.dungeonRunId;
    let budget=greetingBudgets.get(run);
    if(!budget){budget={nextAt:now+15000,anchor:{...player},scope:root.CityFloorScope?.cacheKey(d.geoKey,d)||d.geoKey};greetingBudgets.set(run,budget);if(greetingBudgets.size>2)greetingBudgets.delete(greetingBudgets.keys().next().value);return;}
    const scope=root.CityFloorScope?.cacheKey(d.geoKey,d)||d.geoKey;
    if(scope!==budget.scope){budget.scope=scope;budget.anchor={...player};return;}
    if(now<budget.nextAt||Math.hypot(player.x-budget.anchor.x,player.y-budget.anchor.y)<8||
      root.DungeonLife?.hasPendingSpeech?.())return;
    const row=Object.values(d.cityCrowd.actors).find(a=>{
      if(a.status!=='ambient'||(a.seed>>>0)%5||a.occupation?.mode==='work'&&VENUES.has(a.occupation.venueType))return false;
      const p=root.CityCrowdMotion?.position(d,a)||a.position;
      return Math.hypot(p.x+.5-player.x,p.y+.5-player.y)<=3.5&&root.DungeonInhabitants?.lineClear(d,player,{x:p.x+.5,y:p.y+.5});
    });
    if(!row)return;
    budget.nextAt=now+90000;budget.anchor={...player};
    return open({ambient:true,crowdId:row.id,mazeRoomKey:d.geoKey,name:row.name});
  }
  function onFrame(d,player){
    if(!d||pending||root.CommerceUi?.hasInteraction?.()||root.gamePaused||root.actionDiceState?.active||root._combatCommandPending||
      root._gameOver||root._playerUnconscious||root._deathSceneActive||root._characterStartupPending||root._combatRoundActiveUntil>Date.now()||
      root.GameCommandGate?.busy?.()||root.GameCommandGate?.isSubmitting?.()||root.RoomEntry?.isPending?.()||root.document?.querySelector('.popup-container')||
      /^(INPUT|TEXTAREA|SELECT)$/.test(root.document?.activeElement?.tagName)||root.currentDungeon!==d)return;
    const nearby=point=>Math.hypot(point.x-player.x,point.y-player.y)<=3&&root.DungeonInhabitants?.lineClear(d,player,point);
    const ctx=root.getDungeonLifeContext?.();
    for(const actor of ctx?.actors||root.combatCharacters||[]){
      if(actor.type!=='monster'||(actor.hp??1)<=0||actor.discoveryState==='pending'||
        ['Hostile','Dead','Dying','Unconscious'].includes(root.DungeonLife?.actorAllegiance?.(actor)||actor.allegiance||actor.state))continue;
      const roomKey=root.DungeonInhabitants?.roomKey?.(actor.mazeRoomKey)||actor.mazeRoomKey;
      if(roomKey&&roomKey!==d.geoKey||!Number.isFinite(actor.mazeX)||!nearby({x:actor.mazeX+.5,y:actor.mazeY+.5}))continue;
      const business=root.getEconomyResidentInfo?.(actor.name);
      if(business&&(business.jobs||business.venue||['shop','temple','venue','divine'].includes(business.kind))&&offer(actor,()=>root.CommerceUi?.invite?.(actor.name)))return true;
    }
    if(!d.cityCrowd)return;
    for(const row of Object.values(d.cityCrowd.actors)){
      if(row.status!=='ambient'||row.occupation?.mode!=='work'||!VENUES.has(row.occupation.venueType))continue;
      const p=root.CityCrowdMotion?.position(d,row)||row.position;
      if(!p||!nearby({x:p.x+.5,y:p.y+.5}))continue;
      const actor={ambient:true,crowdId:row.id,mazeRoomKey:d.geoKey,name:row.name};
      if(offer(actor,()=>offerAmbient(actor)))return true;
    }
    return greetAmbient(d,player);
  }
  return{actors,receive,open,specFor,onFrame};
});
