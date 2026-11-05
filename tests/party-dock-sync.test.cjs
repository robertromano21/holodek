'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const PartyRoster=require('../assets/partyRoster'),I=require('../assets/dungeonInhabitants');
const game=fs.readFileSync('assets/game.js','utf8'),html=fs.readFileSync('assets/index.html','utf8');
const sheet=(name,hp=12)=>`${name}\nFemale\nHuman\nFighter\nLevel: 2\nAC: 10\nXP: 0\nHP: ${hp}\nMaxHP: 20\nEquipped: None\nAttack: 2\nDamage: 1\nArmor: 0\nMagic: 0\nState: Friendly`;
const oldNames=['Veyr Ashkettle','Dorga Flintlaugh','Oruun of the Still Pool'],newNames=['Vyth Aerir','Calthokael Qyas'];
const data=names=>({pc:sheet('Mortacia',15),npcs:names.map(name=>sheet(name,name===newNames[0]?0:12)).join('\n'),monsters:sheet('Peaceful Bystander')});
const text=data=>`Coordinates: X: -1, Y: 0, Z: 0\nPC:\n${data.pc}\nNPCs in Party:\n${data.npcs}\nMonsters in Room:\n${data.monsters}\nMonsters Equipped Properties: None`;
function fixture(mapReady=false){
  const dock={innerHTML:''},drawn=[],popups=[],sprites=new Map(newNames.map(name=>[name,{dataUrl:'data:'+name}]));
  const window={PartyRoster,DungeonInhabitants:I,dungeonRunId:'run',combatCharacters:[{name:'Mortacia',type:'pc'},...oldNames.map(name=>({name,type:'npc'})),...newNames.map(name=>({name,type:'monster',sprite:sprites.get(name)}))],
    _partyInfoPCString:data(oldNames).pc,_partyInfoNPCString:data(oldNames).npcs};
  const ctx={window,console:{log(){},warn(){}},document:{getElementById:id=>id==='party-icon-dock'?dock:{appendChild(){}},createElement:()=>({style:{}})},
    getPartyInfoSpriteLookup:()=>new Map(),partyCombatBodyCells:()=>1,drawPartySpriteCanvas:(_canvas,entry)=>drawn.push(entry),positionPartyIconDock(){},
    ensureKnownSpritesInCombatList(){},syncPartyMazeToCombatPositions(){},formattedCoordinates:'X: -1, Y: 0, Z: 0'};
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('    function getPartyInfoEntries()'),html.indexOf('    function formatPartySheetHtml(')),ctx);
  vm.runInContext(html.slice(html.indexOf('    function renderPartyIconDock()'),html.indexOf('    function positionPartyIconDock()')),ctx);
  window.renderPartyIconDock=ctx.renderPartyIconDock;window.renderPartyInfoPopup=()=>popups.push(ctx.getPartyInfoEntries());
  vm.runInContext(game.slice(game.indexOf('window.refreshPartyPanels ='),game.indexOf('// Function to display PC data in the PC column')),ctx);
  if(mapReady)window.combatGame={scene:{getScene:()=>({initialized:true,updatePositions:()=>{}})}};
  const start=game.indexOf('            // Update CombatScene with new combatCharactersString'),end=game.indexOf('            window.DungeonLife?.receiveTurnDialogue',start);
  function receive(names,withRoster=true){
    drawn.length=0;ctx.updatedData=data(names);ctx.newCombatCharactersString=withRoster?JSON.stringify([{name:'Mortacia',type:'pc'},...names.map(name=>({name,type:'npc',sprite:sprites.get(name)})),{name:'Peaceful Bystander',type:'monster'}]):null;
    vm.runInContext(game.slice(start,end),ctx);
    Object.assign(ctx,{userInput:'ask monsters to join my quest',currentCoordinates:{x:-1,y:0,z:0},conversationHistory:'',objectsInRoomString:'',serverGameConsole:text(ctx.updatedData),
      updateGameConsole:()=>{window._partyInfoNPCString=data(oldNames).npcs;return text(data(oldNames));}});
    const finish=game.indexOf('            updatedGameConsole = updateGameConsole(userInput, currentCoordinates, conversationHistory, objectsInRoomString, serverGameConsole);',end);
    vm.runInContext(game.slice(finish,game.indexOf('            if (window.DEBUG_LOGS) console.log(updatedGameConsole);',finish)),ctx);
    assert.equal(ctx.updatedGameConsole,ctx.serverGameConsole,'Legacy redraw must not replace the authoritative checkpoint with old membership.');
  }
  return{ctx,window,dock,drawn,popups,sprites,receive};
}
for(const mapReady of [false,true])test('dialogue recruits update actual party cards and popup with '+(mapReady?'an existing combat map':'no combat map'),()=>{
  const f=fixture(mapReady);f.receive([...oldNames,...newNames]);
  assert.deepEqual(f.drawn.map(entry=>entry.label),['Mortacia',...oldNames,...newNames]);
  assert.equal((f.dock.innerHTML.match(/class="party-icon-slot"/g)||[]).length,6);
  assert.equal(f.drawn.find(entry=>entry.label===newNames[0]).hp,'0/20');
  assert.equal(f.drawn.find(entry=>entry.label===newNames[1]).sprite.dataUrl,f.sprites.get(newNames[1]).dataUrl);
  assert.equal(f.popups.at(-1).length,6);assert.ok(!f.dock.innerHTML.includes('Peaceful Bystander'));
  f.receive([...oldNames,...newNames]);assert.equal(f.drawn.length,6,'Repeated delivery must not duplicate members.');
  f.receive(oldNames);assert.equal(f.drawn.length,4,'The next authoritative membership replaces the prior cache.');
});
test('console-only responses refresh dock membership and reuse the existing monster sprite immediately',()=>{
  const f=fixture();f.receive([...oldNames,...newNames],false);
  assert.equal(f.drawn.length,6);assert.equal(f.drawn.at(-1).sprite,f.sprites.get(newNames[1]));assert.equal(f.drawn.at(-1).source.type,'npc');
});
test('realtime results refresh the same dock sources and stale events cannot overwrite them',async()=>{
  const f=fixture();Object.assign(f.ctx,{currentDungeon:{geoKey:'-1,0,0'},currentCoordinates:{x:-1,y:0,z:0},roomNameDatabase:new Map(),
    updateCharacterSheetsFromConsole(){},generateMonstersForRoom(){},updateGameConsole(){},renderDungeonView(){},roomDatabaseSyncClient:{reset(){}},localStorage:{getItem:()=>null}});
  const begin=game.indexOf('const realtimeCombatResultsSeen ='),end=game.indexOf('window.appendDungeonEncounterLog =',begin);
  vm.runInContext(game.slice(begin,end),f.ctx);
  await f.window.applyRealtimeCombatResult({type:'economy_result',runId:'run',geoKey:'-1,0,0',eventId:'join',updatedGameConsole:text(data([...oldNames,...newNames])),content:'They join.'});
  assert.ok(f.dock.innerHTML.includes('Calthokael Qyas'));assert.equal(f.popups.at(-1).length,6);
  await f.window.applyRealtimeCombatResult({type:'economy_result',runId:'old-run',geoKey:'-1,0,0',eventId:'stale',updatedGameConsole:text(data(oldNames)),content:'Stale result.'});
  assert.equal(f.popups.at(-1).length,6);
});
