'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),I=require('../assets/dungeonInhabitants');
const game=fs.readFileSync('assets/game.js','utf8');
function dock(){
  const file=require.resolve('./party-dock-sync.test.cjs'),source=fs.readFileSync(file,'utf8');
  const f=vm.runInNewContext(source.slice(0,source.indexOf('\nfor(const mapReady'))+'\nfixture();',
    {require:createRequire(file),console});
  const c=f.ctx;c.document.querySelector=()=>null;c.document.querySelectorAll=()=>[];
  vm.runInContext(game.slice(game.indexOf('function displayPCData('),game.indexOf('function calculateNumVisitedRooms(')),c);
  Object.assign(c,{npcsString:'None',charactersString:f.window._partyInfoPCString,completeQuestIfArtifactFound(){},globalArtifactsFound:0,globalQuestsAchieved:0,
    roomName:'Same Room',roomHistory:'An unchanged room.',x:0,y:0,z:0,equipmentString:'None',metadataString:'None',exitsString:'north',puzzleInRoom:'None',puzzleSolution:'None',
    nextArtifact:'None',nextBoss:'None',nextBossRoom:'None',bossCoordinates:'None',currentQuest:'None',inventoryString:'Empty',inventoryPropertiesString:'None',characters:[],npcs:[],
    turns:2,monstersInRoomString:'None',monstersEquippedPropertiesString:'None',monstersState:'None',numVisitedRooms:1,adjacentRooms:'None',connectedRoomsString:''});
  f.window.lastServerGameConsole='A committed current-run checkpoint.';f.window.renderPartyIconDock();f.drawn.length=0;
  const begin=game.indexOf('  // Display PC and NPC data',game.indexOf('function updateGameConsole(')),end=game.indexOf('// Commit authoritative sheet sources together',begin);
  vm.runInContext('function buildDraft(){\n'+game.slice(begin,end),c);
  return {...f,draft:()=>vm.runInContext('buildDraft()',c)};
}

test('pending command drafts never remove confirmed cards or replace their sheet sources',async()=>{
  const f=dock(),before=f.dock.innerHTML,party=f.window._partyInfoNPCString;
  for(let i=0;i<3;i++){
    const text=f.draft();await Promise.resolve();
    assert.equal(f.dock.innerHTML,before);assert.equal(f.window._partyInfoNPCString,party);
    assert.match(text,/Veyr Ashkettle/,'The draft sent to state synchronization must retain confirmed members too.');
    assert.equal(f.drawn.length,0,'Building a command must not tear down and redraw the dock.');
  }
});

test('a failed command or retry leaves the existing party visible without a response to restore it',async()=>{
  const f=dock(),before=f.dock.innerHTML;
  await assert.rejects(async()=>{f.draft();throw Error('Request failed.');},/Request failed/);
  assert.equal(f.dock.innerHTML,before);f.draft();assert.equal(f.dock.innerHTML,before);
});

test('authoritative dismissal and an explicitly empty party replace the dock rather than being unioned with old members',()=>{
  const f=dock();f.window.refreshPartyPanels({pc:f.window._partyInfoPCString,npcs:'None'});f.drawn.length=0;
  assert.equal((f.dock.innerHTML.match(/class="party-icon-slot"/g)||[]).length,1);
  f.draft();assert.equal((f.dock.innerHTML.match(/class="party-icon-slot"/g)||[]).length,1);
});

test('start-menu previews still render before there is a committed game checkpoint',()=>{
  const f=dock();f.window.lastServerGameConsole='';f.draft();
  assert.equal(f.window._partyInfoNPCString,'None');assert.ok(f.drawn.length>0);
});

function motion(){
  const live={name:'Companion',type:'npc',hp:12,mazeX:4,mazeY:5,mazeRoomKey:'X: 0, Y: 0, Z: 0',renderMazeX:3.6,renderMazeY:5,
    _renderFromMazeX:3,_renderFromMazeY:5,_renderTweenToX:4,_renderTweenToY:5,_renderTweenStartedAt:900,moveTweenMs:500,
    _nextMazeStepAt:1500,walkFrame:2,_lastWalkAnimAt:970,facing:'right',sprite:{dataUrl:'data:kept'},recruitmentLease:{id:'old-lease'}};
  const window={dungeonRunId:'run',currentCoordinates:'X: 0, Y: 0, Z: 0',DungeonInhabitants:I,combatCharacters:[live],CityFloorScope:{token:()=> 'street'}};
  const c={window,currentDungeon:{geoKey:'0,0,0'},isCombatRoundActive:()=>false,Date:{now:()=>1000}};vm.createContext(c);
  const start=game.indexOf('function captureCombatRosterTurn('),end=game.indexOf('function isDungeonActorPresent(',start);
  assert.ok(start>=0,'The response path needs an explicit scoped roster reconciler.');vm.runInContext(game.slice(start,end),c);
  return {c,window,live,capture:()=>c.captureCombatRosterTurn(),merge:(rows,baseline)=>c.reconcileIncomingCombatRoster(rows,baseline)};
}

test('same-cell roster updates retain live animation and appearance but accept health, membership and lease changes',()=>{
  const f=motion(),next={name:f.live.name,type:'npc',hp:3,state:'Friendly',mazeX:4,mazeY:5,mazeRoomKey:'0,0,0'};
  const row=f.merge([next])[0];assert.equal(row.renderMazeX,3.6);assert.equal(row._renderTweenStartedAt,900);assert.equal(row._nextMazeStepAt,1500);
  assert.equal(row.sprite,f.live.sprite);assert.equal(row.hp,3);assert.equal(row.recruitmentLease,undefined);assert.equal(next.renderMazeX,undefined);
  assert.equal(row.walkFrame,2);assert.equal(row._lastWalkAnimAt,970);
});

test('a slow noncombat turn echo cannot rewind movement that continued while its model response was pending',()=>{
  const f=motion(),baseline=f.capture();f.live.mazeX=7;f.live.renderMazeX=6.7;f.live._renderTweenToX=7;
  const row=f.merge([{name:f.live.name,type:'npc',hp:9,mazeX:4,mazeY:5,mazeRoomKey:'0,0,0'}],baseline)[0];
  assert.equal(row.mazeX,7);assert.equal(row.renderMazeX,6.7);assert.equal(row.hp,9);
});

test('actual server moves and combat steps remain authoritative rather than being replaced with client coordinates',()=>{
  const f=motion(),baseline=f.capture();f.live.mazeX=7;
  const moved=f.merge([{name:f.live.name,type:'npc',hp:5,mazeX:9,mazeY:5,mazeRoomKey:'0,0,0'}],baseline)[0];assert.equal(moved.mazeX,9);
  assert.equal(moved.renderMazeX,3.6);assert.equal(moved._renderTweenToX,9);
  f.c.isCombatRoundActive=()=>true;
  assert.equal(f.merge([{name:f.live.name,type:'npc',mazeX:4,mazeY:5,mazeRoomKey:'0,0,0'}],baseline)[0].mazeX,4);
});

test('room, floor and run changes never inherit a previous scene position or obsolete tween',()=>{
  for(const change of [f=>{f.c.currentDungeon.geoKey='0,1,0';},f=>{f.window.CityFloorScope.token=()=> 'inn-2';},f=>{f.window.dungeonRunId='another';}]){
    const f=motion(),baseline=f.capture();change(f);
    const row=f.merge([{name:f.live.name,type:'npc',mazeX:2,mazeY:2,mazeRoomKey:f.c.currentDungeon.geoKey}],baseline)[0];
    assert.equal(row.mazeX,2);assert.equal(row.renderMazeX,undefined);assert.equal(row._renderTweenStartedAt,undefined);
  }
});

test('a fresh authoritative roster can remove actors without restoring them from the prior client list',()=>{
  const f=motion();assert.equal(f.merge([]).length,0);
});

test('sheet-only updates reuse a valid existing location instead of spawning a companion again',()=>{
  const f=motion(),row=f.merge([{name:f.live.name,type:'npc',hp:6}])[0];
  assert.equal(row.mazeX,f.live.mazeX);assert.equal(row.mazeY,f.live.mazeY);assert.equal(row.renderMazeX,f.live.renderMazeX);
  assert.equal(row.hp,6);assert.equal(row.recruitmentLease,undefined);
});

test('both formatted and raw room keys reuse a valid anchor without repositioning or restarting its tween',()=>{
  for(const key of ['0,0,0','X: 0, Y: 0, Z: 0']){
    const f=motion();f.live.mazeRoomKey=key;
    const c=f.c;Object.assign(c,{playerDungeonX:0,playerDungeonY:0,playerPosX:.5,playerPosY:.5,MAX_STEP:1.5,
      shouldUsePartyMazeAnchors:()=>true,getCurrentCombatRoomKey:()=> 'X: 0, Y: 0, Z: 0',
      collectNearbyWalkableTiles:()=>[{x:1,y:0,dist:1}],isDungeonActorPresent:()=>true,isSpawnBlockedCell:()=>false,
      hashCharacterName:()=>0,ensureMonsterSpriteData(){},preferPartyViewingTiles:tiles=>tiles});
    c.currentDungeon.cells={'0,0':{floorHeight:0},'1,0':{floorHeight:0},'4,5':{floorHeight:0}};
    vm.runInContext(game.slice(game.indexOf('function ensurePartyMazeAnchors('),game.indexOf('function syncPartyMazeToCombatPositions(')),c);
    c.ensurePartyMazeAnchors();assert.equal(f.live.mazeX,4);assert.equal(f.live.mazeY,5);assert.equal(f.live._renderTweenStartedAt,900);
  }
});

test('real server combat steps animate from the last rendered point without changing the destination',()=>{
  const f=motion(),row=f.merge([{name:f.live.name,type:'npc',hp:0,state:'Dead',mazeX:5,mazeY:5,mazeRoomKey:'0,0,0',facing:'up'}])[0];
  assert.equal(row.hp,0);assert.equal(row.state,'Dead');assert.equal(row.mazeX,5);assert.equal(row._renderFromMazeX,3.6);
  assert.equal(row._renderTweenStartedAt,1000);assert.equal(row._renderTweenToX,5);
  assert.equal(row.facing,'up');
});

test('a combat request cannot later masquerade as a noncombat position echo after the round flag clears',()=>{
  const f=motion();f.c.isCombatRoundActive=()=>true;const baseline=f.capture();
  f.c.isCombatRoundActive=()=>false;f.live.mazeX=7;
  assert.equal(f.merge([{name:f.live.name,type:'npc',mazeX:4,mazeY:5,mazeRoomKey:'0,0,0'}],baseline)[0].mazeX,4);
});

test('the actual normal-response reconciliation keeps a moving companion through its combat-map update and final party redraw',()=>{
  const f=dock(),c=f.ctx,actor=f.window.combatCharacters.find(a=>a.type==='npc');
  c.currentDungeon={geoKey:'-1,0,0'};c.isCombatRoundActive=()=>false;
  Object.assign(actor,{mazeX:4,mazeY:5,mazeRoomKey:'X: -1, Y: 0, Z: 0',renderMazeX:3.8,renderMazeY:5,_renderTweenStartedAt:900});
  const begin=game.indexOf('function captureCombatRosterTurn('),end=game.indexOf('function isDungeonActorPresent(',begin);
  vm.runInContext(game.slice(begin,end),c);c.combatTurnSnapshot=c.captureCombatRosterTurn();
  actor.mazeX=7;actor.renderMazeX=6.8;
  const names=f.window.combatCharacters.filter(a=>a.type==='npc').map(a=>a.name);f.receive(names);
  const next=f.window.combatCharacters.find(a=>a.name===actor.name);assert.equal(next.mazeX,7);assert.equal(next.renderMazeX,6.8);
  assert.equal(next._renderTweenStartedAt,900);assert.ok(f.dock.innerHTML.includes(actor.name));
});

test('the prompt, realtime result and final combat event paths all reconcile instead of discarding live movement',()=>{
  for(const marker of ['// Update CombatScene with new combatCharactersString',"} else if (data.type === 'final')",'window.applyRealtimeCombatResult =']){
    const start=game.indexOf(marker);assert.match(game.slice(start,start+6500),/reconcileIncomingCombatRoster|reconcileCombatRoster/);
  }
  const sync=game.indexOf('if (!completedStartResult) await syncGameStateBeforeCommand');
  assert.match(game.slice(sync-300,sync),/captureCombatRosterTurn/);
});
