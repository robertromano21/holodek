'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I=require('../assets/dungeonInhabitants');
const {createPopulationService}=require('../retort/roomPopulation');
const source=fs.readFileSync('retort/retortWithUserInput.js','utf8');
const helper=source.slice(source.indexOf('function patchLiveHPToConsole('),source.indexOf('// Update the combat map in Phaser',source.indexOf('function patchLiveHPToConsole(')));
const sheet=(name,indent='',prefix='')=>[prefix+name,'Female','Stone Golem','Guardian','Level: 3','AC: 12','XP: 0','HP: 23','MaxHP: 23','Equipped: None','Attack: 4','Damage: 6','Armor: 0','Magic: 0','State: Hostile'].map(s=>indent+s).join('\n');
for(const indent of['','      '])for(const prefix of['','Name: '])test('combat HP survives console and population refresh: '+JSON.stringify({indent,prefix}),()=>{
  const population=I.createPopulation('0,0,0',[{name:'Thalra Grimstone',hp:23,state:'Hostile'}]);
  const c={Inhabitants:I,combatPopulation:population};vm.runInNewContext(helper,c);
  const text='PC: '+sheet('Mortacia',indent,prefix)+'\nNPCs in Party: None\nMonsters in Room: '+sheet('Thalra Grimstone',indent,prefix)+'\nMonsters Equipped Properties: None\nMonsters State: Hostile';
  const updated=c.patchLiveHPToConsole(text,{name:'Mortacia',hp:15},[],[{name:'Thalra Grimstone',hp:3}]);
  const actual=I.parseSheets(updated)[0];assert.equal(actual.hp,3);assert.equal(actual.maxHp,23);
  assert.equal(I.parseSheets(updated,'PC')[0].hp,15);assert.equal(population.actors['Thalra Grimstone'].hp,3);
  I.sync(population,I.parseSheets(updated));assert.equal(I.residentSheets(population)[0].hp,3);
  assert.equal(c.patchLiveHPToConsole(updated,null,[],[]),updated);
});

test('each hit commits PC, companion and enemy HP before the next turn and survives population/database refresh',()=>{
  const code=source.slice(source.indexOf('function broadcastCombatHealth('),source.indexOf('// Update the combat map in Phaser'));
  let text='Coordinates: X: 1, Y: 0, Z: 0\nPC:\n'+sheet('Hero')+'\nNPCs in Party:\n'+sheet('Companion')+
    '\nMonsters in Room:\n'+sheet('Thalra Grimstone')+'\n'+sheet('Other Guard')+
    '\nMonsters Equipped Properties: None\nMonsters State: Hostile';
  const population=I.createPopulation('1,0,0',[{name:'Thalra Grimstone',allegiance:'Hostile'},{name:'Other Guard',allegiance:'Hostile'}]);
  I.sync(population,I.parseSheets(text));
  let wire=JSON.stringify([['Hero','pc'],['Companion','npc'],['Thalra Grimstone','monster'],['Other Guard','monster']]
    .map(([name,type])=>({name,type,hp:23,mazeX:4,mazeY:5})));
  let db=JSON.stringify({'1,0,0':{name:'Temple',monsters:{inRoom:I.parseSheets(text).map(a=>a.rawSheet).join('\n')}}});
  const state={getUpdatedGameConsole:()=>text,setUpdatedGameConsole:v=>text=v,
    getCombatCharactersString:()=>wire,setCombatCharactersString:v=>wire=v,
    getRoomPopulation:()=>population,setRoomPopulation(){},getRoomNameDatabase:()=>db,setRoomNameDatabase:v=>db=v,
    getDungeonRunId:()=> 'run'};
  const events=[],dice={active:{id:'battle',kind:'combat',geoKey:'1,0,0'}};
  const context={Inhabitants:I,sharedState:state,actionDice:dice,combatSpace:null,combatTurnFlow:null,combatPopulation:population,
    updatedGameConsole:text,populationService:createPopulationService(state),broadcast:e=>events.push(structuredClone(e))};
  vm.runInNewContext(code,context);
  const hero={name:'Hero',type:'pc',hp:15,maxHp:23},companion={name:'Companion',type:'npc',hp:12,maxHp:23};
  const thalra={name:'Thalra Grimstone',type:'monster',hp:3,maxHp:23,state:'Hostile'},other={name:'Other Guard',type:'monster',hp:23,maxHp:23,state:'Hostile'};
  context.commitCombatHealth(hero,[companion],[thalra,other]);
  assert.deepEqual(JSON.parse(wire).map(a=>a.hp),[15,12,3,23]);
  assert.equal(population.actors['Thalra Grimstone'].hp,3);
  assert.equal(I.parseBlocks(JSON.parse(db)['1,0,0'].monsters.inRoom)[0].hp,3);
  context.populationService.prepare(text,{geoKey:'1,0,0',layout:{width:0,height:0},cells:{}});
  assert.equal(population.actors['Thalra Grimstone'].hp,3);
  thalra.hp=-4;context.commitCombatHealth(hero,[companion],[thalra,other]);
  assert.equal(I.parseSheets(text)[0].hp,-4);assert.equal(I.parseSheets(text)[0].state,'Dead');
  assert.equal(population.actors['Thalra Grimstone'].status,'dead');
  assert.equal(I.parseBlocks(JSON.parse(db)['1,0,0'].monsters.inRoom)[0].hp,-4);
  assert.equal(events[0].revision,1);assert.equal(events[1].revision,2);
  assert.equal(I.parseSheets(events[0].updatedGameConsole)[0].hp,3);
  assert.equal(I.parseSheets(events[1].updatedGameConsole)[0].hp,-4);
  assert.equal(dice.active.id,'battle');
});
