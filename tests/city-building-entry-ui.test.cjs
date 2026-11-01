'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../assets/cityParcels'),I=require('../assets/dungeonInhabitants');
const source=fs.readFileSync(require.resolve('../assets/cityBuildingUi'),'utf8');
function fixture(){
  const b={id:'walkin-building',name:'Actual Workshop',authored:true,left:12,top:12,width:24,depth:26,storeys:30};
  const d={geoKey:'1,0,0',_geometryStamp:'street-v1',layout:{width:64,height:64},cells:{},cityBlocks:{buildings:[b]}};
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:4};
  const player={...P.entrance(b)},calls=[],entries=[],notices=[];
  let busy=false,popup=null,roomPending=false,begins=0,ends=0;
  const root={dungeonRunId:'entry-run',currentDungeon:d,HolodekFlags:{ARCHITECTURE_EXPANSION:true},CityParcels:P,DungeonInhabitants:I,
    document:{activeElement:{tagName:'BODY'},querySelector:()=>popup,createElement:()=>{throw Error('Automatic entry must not create a popup.');}},
    GameCommandGate:{busy:()=>busy,begin:()=>{busy=true;begins++;},end:()=>{busy=false;ends++;}},
    RoomEntry:{isPending:()=>roomPending},getDungeonLifeContext:()=>({dungeon:root.currentDungeon,player}),
    DungeonActionNotices:{receive:event=>notices.push(event)},
    fetch:async(url,options)=>{
      calls.push({url,body:JSON.parse(options.body),busy});
      return{ok:true,json:async()=>({runId:'entry-run',geoKey:d.geoKey,targetKey:'5,5,0',buildingId:b.id,name:b.name})};
    },enterCityBuilding:async passage=>{assert.equal(busy,false,'release the preparation lock before the command wrapper');entries.push(passage);busy=true;}};
  vm.runInNewContext(source,{window:root});
  const side=(direction,across=0,depth=0)=>{
    const mx=b.left+Math.floor(b.width/2)+.5,my=b.top+Math.floor(b.depth/2)+.5;
    Object.assign(player,direction==='north'?{x:mx+across,y:b.top+2.5+depth}:direction==='south'?{x:mx+across,y:b.top+b.depth-2.5+depth}:
      direction==='west'?{x:b.left+2.5+depth,y:my+across}:{x:b.left+b.width-2.5+depth,y:my+across});
  };
  return{root,d,b,player,calls,entries,notices,side,api:root.CityBuildingUi,
    get begins(){return begins;},get ends(){return ends;},get busy(){return busy;},set busy(value){busy=value;},
    set popup(value){popup=value;},set roomPending(value){roomPending=value;}};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}

test('procedural lobbies, including legacy parcels without circulation markers, never reload the street',async()=>{
  const f=fixture();f.b.authored=false;
  for(const side of ['north','south','east','west']){f.side(side);await f.api.onFrame(f.d,f.player);}
  assert.equal(f.calls.length,0);assert.equal(f.entries.length,0);assert.equal(f.begins,0);
});

for(const side of ['north','south','east','west'])test(side+' doorway enters automatically across its full width without a dialog',async()=>{
  for(const across of [-1.35,0,1.35]){
    const f=fixture();f.side(side,across);
    await f.api.onFrame(f.d,f.player);
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/city/buildings/prepare');assert.equal(f.calls[0].busy,true);
    assert.deepEqual(f.calls[0].body.player,f.player);assert.equal(f.entries.length,1);assert.equal(f.begins,1);assert.equal(f.ends,1);
    assert.equal(f.busy,true,'the normal room command owns its lock after handoff');assert.equal(f.notices.length,0);
  }
});

test('walking on the pavement or beside the opening never triggers an entry',async()=>{
  const f=fixture();
  for(const [side,across,depth]of [['north',0,-2],['south',0,2],['west',0,-2],['east',0,2],['north',1.6,0],['north',0,.9]]){
    f.side(side,across,depth);await f.api.onFrame(f.d,f.player);
  }
  assert.equal(f.calls.length,0);assert.equal(f.entries.length,0);
});

test('returning to the street stays suppressed until the player walks clear, then permits a deliberate re-entry',async()=>{
  const f=fixture();f.api.suppress(f.d.geoKey,f.b.id);
  await f.api.onFrame(f.d,f.player);f.side('north',0,.9);await f.api.onFrame(f.d,f.player);f.side('north');await f.api.onFrame(f.d,f.player);
  assert.equal(f.calls.length,0);
  f.side('north',0,-3);await f.api.onFrame(f.d,f.player);f.side('north');await f.api.onFrame(f.d,f.player);
  assert.equal(f.entries.length,1);
  f.busy=false;await f.api.onFrame(f.d,f.player);assert.equal(f.entries.length,1);
});

test('a previous game cannot suppress the same parcel in the next game',async()=>{
  const f=fixture();f.api.suppress(f.d.geoKey,f.b.id);f.root.dungeonRunId='new-run';
  f.root.fetch=async()=>({ok:true,json:async()=>({runId:'new-run',geoKey:f.d.geoKey,buildingId:f.b.id,targetKey:'5,5,0'})});
  await f.api.onFrame(f.d,f.player);assert.equal(f.entries.length,1);
});

test('all existing pause, combat, input, menu, startup and room-entry guards prevent automatic travel',async()=>{
  const guards=[f=>f.root.gamePaused=true,f=>f.root._gameOver=true,f=>f.root._playerUnconscious=true,f=>f.root._deathSceneActive=true,
    f=>f.root._characterStartupPending=true,f=>f.root._combatCommandPending=true,f=>f.root.actionDiceState={active:true},
    f=>f.root._combatRoundActiveUntil=Date.now()+10000,f=>f.root.__builderWalk=true,f=>f.busy=true,f=>f.roomPending=true,
    f=>f.popup={},...['INPUT','TEXTAREA','SELECT'].map(tagName=>f=>f.root.document.activeElement={tagName})];
  for(const guard of guards){const f=fixture();guard(f);await f.api.onFrame(f.d,f.player);assert.equal(f.calls.length,0);assert.equal(f.begins,0);}
  const f=fixture();f.root.HolodekFlags.ARCHITECTURE_EXPANSION=false;await f.api.onFrame(f.d,f.player);assert.equal(f.calls.length,0);
});

test('authored entrances use doorway preparation; unavailable sides and blocked cells never auto-enter',async()=>{
  const authored=fixture();authored.b.authored=true;await authored.api.onFrame(authored.d,authored.player);assert.equal(authored.calls.length,1);
  const f=fixture();f.b.entrySides=['south'];await f.api.onFrame(f.d,f.player);assert.equal(f.calls.length,0);
  delete f.b.entrySides;f.d.cells[`${Math.floor(f.player.x)},${Math.floor(f.player.y)}`].tile='wall';
  await f.api.onFrame(f.d,f.player);assert.equal(f.calls.length,0);
  const g=fixture();g.root.DungeonInhabitants={...I,lineClear:()=>false};await g.api.onFrame(g.d,g.player);assert.equal(g.calls.length,0);
});

test('invalid movement samples or an old render frame cannot acquire a new command lock',async()=>{
  const f=fixture();
  for(const player of [null,{}, {x:NaN,y:2}, {x:2,y:Infinity}])await f.api.onFrame(f.d,player);
  f.root.currentDungeon={...f.d,geoKey:'2,0,0'};await f.api.onFrame(f.d,f.player);
  assert.equal(f.calls.length,0);assert.equal(f.begins,0);assert.equal(f.busy,false);
});

test('frames during slow preparation share one request and cannot start competing room changes',async()=>{
  const f=fixture(),response=deferred();f.root.fetch=async()=>{f.calls.push({});return response.promise;};
  const work=f.api.onFrame(f.d,f.player);
  for(let i=0;i<25;i++)f.api.onFrame(f.d,f.player);
  assert.equal(f.calls.length,1);assert.equal(f.entries.length,0);
  response.resolve({ok:true,json:async()=>({runId:'entry-run',geoKey:f.d.geoKey,buildingId:f.b.id,targetKey:'5,5,0'})});
  await work;assert.equal(f.entries.length,1);assert.equal(f.begins,1);assert.equal(f.ends,1);
});

test('walking away, pausing, opening a menu or changing geometry during preparation cancels travel',async()=>{
  for(const change of [f=>f.side('north',0,-3),f=>f.root.gamePaused=true,f=>f.popup={},f=>f.d._geometryStamp='new-geometry',
    f=>f.root._combatCommandPending=true,f=>f.roomPending=true]){
    const f=fixture();f.root.fetch=async()=>{change(f);return{ok:true,json:async()=>({runId:'entry-run',geoKey:f.d.geoKey,buildingId:f.b.id,targetKey:'5,5,0'})};};
    await f.api.onFrame(f.d,f.player);assert.equal(f.entries.length,0);assert.equal(f.busy,false);assert.equal(f.ends,1);
  }
});

test('a stale response never changes rooms or releases another adventures command lock',async()=>{
  for(const change of [f=>f.root.dungeonRunId='new-run',f=>f.root.currentDungeon={...f.d,geoKey:'2,0,0'}]){
    const f=fixture();f.root.fetch=async()=>{change(f);return{ok:true,json:async()=>({runId:'entry-run',geoKey:f.d.geoKey,buildingId:f.b.id,targetKey:'5,5,0'})};};
    await f.api.onFrame(f.d,f.player);assert.equal(f.entries.length,0);assert.equal(f.ends,0);assert.equal(f.notices.length,0);
  }
  const f=fixture();f.root.fetch=async()=>({ok:true,json:async()=>({runId:'entry-run',geoKey:f.d.geoKey,buildingId:'a-different-building'})});
  await f.api.onFrame(f.d,f.player);assert.equal(f.entries.length,0);assert.equal(f.busy,false);
});

test('failed preparation shows one non-modal notice, releases the lock and retries only after walking away',async()=>{
  const f=fixture();f.root.fetch=async()=>{f.calls.push({});return{ok:false,json:async()=>({error:'The door is temporarily unavailable.'})};};
  await f.api.onFrame(f.d,f.player);assert.equal(f.notices.length,1);assert.match(f.notices[0].message,/temporarily unavailable/);assert.equal(f.busy,false);
  for(let i=0;i<20;i++)await f.api.onFrame(f.d,f.player);
  assert.equal(f.calls.length,1);f.side('north',0,-3);await f.api.onFrame(f.d,f.player);f.side('north');await f.api.onFrame(f.d,f.player);
  assert.equal(f.calls.length,2);assert.equal(f.notices.length,2);assert.equal(f.entries.length,0);
});

test('room-generation failure is caught without a stuck preparation lock or repeated frame submissions',async()=>{
  const f=fixture();f.root.enterCityBuilding=async()=>{throw Error('Interior generation failed.');};
  await f.api.onFrame(f.d,f.player);assert.equal(f.notices.length,1);assert.equal(f.busy,false);
  await f.api.onFrame(f.d,f.player);assert.equal(f.calls.length,1);
});
