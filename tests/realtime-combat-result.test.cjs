const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const I=require('../assets/dungeonInhabitants');
const {buildInitialWorldConsole,buildInitialGameConsole,formatStartingCharacterSheet}=require('../retort/initialGameState');
const source=fs.readFileSync(path.join(__dirname,'../assets/game.js'),'utf8');
const applyCode=source.slice(source.indexOf('const realtimeCombatResultsSeen ='),source.indexOf('window.appendDungeonDialogueLog ='));
function fixture() {
  const d={geoKey:'1,0,0',_geometryStamp:'unchanged',cells:{'4,4':{tile:'floor',floorHeight:0}},sceneObjects:[{name:'sword',x:5,y:4}]};
  const text=buildInitialGameConsole(buildInitialWorldConsole().console,{Name:'Mortacia',Sex:'Female',Race:'Goddess',Class:'Fighter',Level:50,AC:13,HP:88,MaxHP:100},[])
    .replace('Coordinates: X: 0, Y: 0, Z: 0','Coordinates: X: 1, Y: 0, Z: 0')
    .replace('Monsters in Room: None',`Monsters in Room:\n${formatStartingCharacterSheet({Name:'Guard',Sex:'Male',Race:'Wraith',Class:'Fighter',Level:1,AC:10,HP:0,MaxHP:10})}`);
  const calls=[],log=[];
  const root={dungeonRunId:'run',DungeonInhabitants:I,latestUpdatedData:{presentationMarker:'preserved'},
    DungeonLife:{receivePopulation:event=>calls.push(['population',event])},renderPartyIconDock:()=>calls.push(['dock']),
    game:{scene:{getScene:()=>({scene:{restart:data=>calls.push(['scene',data])}})}}};
  const context={window:root,currentDungeon:d,currentCoordinates:{x:1,y:0,z:0},
    document:{createElement:()=>({style:{}}),getElementById:()=>({appendChild:entry=>log.push(entry)})},
    localStorage:{getItem:()=> 'conversation'},updateCharacterSheetsFromConsole:value=>calls.push(['sheets',value]),
    ensureKnownSpritesInCombatList:roster=>{calls.push(['sprites']);roster.find(a=>a.type==='pc').sprite={dataUrl:'player-selected-preset'};},
    syncPartyMazeToCombatPositions:reset=>calls.push(['positions',reset]),generateMonstersForRoom:(...args)=>calls.push(['monsters',...args]),
    updateGameConsole:(...args)=>calls.push(['console',...args]),addPromptAndResponse:(...args)=>calls.push(['history',...args]),
    renderDungeonView:()=>calls.push(['render'])};
  vm.runInNewContext(applyCode,context);
  const event={eventId:'round-1',runId:'run',geoKey:d.geoKey,content:'Mortacia defeats Guard.',updatedGameConsole:text,
    combatCharactersString:JSON.stringify([{name:'Mortacia',type:'pc',hp:88,mazeX:4,mazeY:4,mazeRoomKey:d.geoKey}]),
    population:I.createPopulation(d.geoKey,[{name:'Guard',allegiance:'Hostile'}])};
  return {root,d,text,calls,log,event};
}
test('automatic combat updates the essential original console/cache flow exactly once across SSE and HTTP delivery',async()=>{
  const f=fixture(),geometry=JSON.stringify(f.d);
  await Promise.all([f.root.applyRealtimeCombatResult(f.event),f.root.applyRealtimeCombatResult(f.event)]);
  const updates=f.calls.filter(row=>row[0]==='console');assert.equal(updates.length,1);
  assert.equal(updates[0][1],'');assert.equal(updates[0][3],f.text);assert.equal(updates[0][5],f.text);
  assert.equal(f.root.latestUpdatedData.presentationMarker,'preserved');assert.match(f.root.latestUpdatedData.pc,/HP: 88/);
  assert.match(f.root.latestUpdatedData.monsters,/HP: 0/);assert.equal(f.root.combatCharacters[0].sprite.dataUrl,'player-selected-preset');
  assert.equal(f.log.length,1);assert.equal(f.calls.filter(row=>row[0]==='history').length,1);
  assert.equal(f.root.lastServerGameConsole,f.text);assert.equal(JSON.stringify(f.d),geometry);
});

test('completed combat replaces client-guessed loot positions with the server drop tile', async () => {
  const f = fixture(), drop = { name: 'guard blade', x: 8, y: 6 };
  await f.root.applyRealtimeCombatResult({ ...f.event, type: 'realtime_combat_result', sceneObjects: [drop] });
  assert.deepEqual(f.d.sceneObjects, [drop]); assert.equal(f.d._geometryStamp, 'unchanged');
});
for(const changes of [{runId:'old'},{geoKey:'2,0,0'},{eventId:undefined},{updatedGameConsole:'Coordinates: X: 2, Y: 0, Z: 0'},
  {combatCharactersString:'invalid'},{combatCharactersString:'{}'}])test(`stale or malformed encounter results cannot update the current room: ${JSON.stringify(changes)}`,async()=>{
  const f=fixture();await f.root.applyRealtimeCombatResult({...f.event,...changes});assert.equal(f.calls.length,0);assert.equal(f.log.length,0);
  await f.root.applyRealtimeCombatResult(f.event);assert.equal(f.calls.filter(row=>row[0]==='console').length,1,'An invalid result did not consume the legitimate event ID.');
});
