'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const B=require('../retort/encounterBalance'),I=require('../assets/dungeonInhabitants'),G=require('../retort/inhabitantGeneration');
const fixtures=require('./fixtures/inhabitants.cjs'),{batchRows}=require('./fixtures/inhabitant-batch.cjs');
const sheet=(name,level,hp=30,state='Friendly')=>`${name}\nFemale\nHuman\nFighter\nLevel: ${level}\nAC: 10\nXP: 0\nHP: ${hp}\nMaxHP: 30\nEquipped: Weapon: None, Armor: None, Shield: None, Other: None\nAttack: 3\nDamage: 2\nArmor: 0\nMagic: 0\nState: ${state}`;
function partyText(key='2,0,0'){
  const [x,y,z]=key.split(',');return `Room Name: Test Site\nCoordinates: X: ${x}, Y: ${y}, Z: ${z}\nPC:\n${sheet('Mortacia',51)}\nNPCs in Party:\n${sheet('Ally One',9)}\n${sheet('Ally Two',11)}\n${sheet('Ally Three',11)}\nMonsters in Room: None\nTurns: 4`;
}
const rawRoster=()=>['Mortacia','Ally One','Ally Two','Ally Three'].map((name,index)=>({name,type:index?'npc':'pc',hp:30,state:'Friendly'}));
const fullParty=()=>B.partyMembers(rawRoster(),partyText());
test('missing map-actor levels come from authoritative party sheets, not a level-one default',()=>{
  const raw=rawRoster(),before=JSON.stringify(raw),party=B.partyMembers(raw,partyText());
  assert.deepEqual(party.map(a=>a.level),[51,9,11,11]);assert.deepEqual(B.partySummary(party),{size:4,level:10});
  assert.deepEqual(B.levelRange(party),{min:10,max:12});assert.equal(JSON.stringify(raw),before);
});
test('Mortacia counts toward group size but never the ordinary level baseline, regardless of case',()=>{
  const party=fullParty();party[0].name=' MORTACIA ';party[0].level=999;
  assert.deepEqual(B.partySummary(party),{size:4,level:10});
  assert.deepEqual(B.partySummary([{Name:'Mortacia',HP:50,Level:51}]),{size:1,level:3});
});
test('authoritative downed sheets, enemies and noncombatants do not inflate the party average',()=>{
  const raw=[...rawRoster(),{name:'Enemy',type:'monster',hp:100,level:90},{name:'Guide',type:'npc',hp:20,level:90,noncombatant:true}];
  const text=partyText().replace(sheet('Ally Two',11),sheet('Ally Two',11,0,'Unconscious'));
  const party=B.partyMembers(raw,text);assert.deepEqual(B.partySummary(party),{size:3,level:10});
  assert.ok(!party.some(a=>a.name==='Enemy'));assert.equal(raw[2].hp,30);
});
test('high-level ordinary parties are not silently capped to level twelve; ordinary rolls still stop at twenty',()=>{
  assert.deepEqual(B.levelRange([{Name:'Ally',Level:18,HP:50}]),{min:18,max:20});
  assert.deepEqual(B.levelRange([{Name:'Ally',Level:25,HP:50}]),{min:20,max:20});
  assert.deepEqual(B.levelRange([{Name:'New Adventurer',Level:1,HP:5}]),{min:1,max:3});
});
test('ordinary hostile rolls include the average and average plus two, not the old broad low-level range',()=>{
  const calls=[],party=fullParty();
  for(const high of [false,true]){
    const choose=B.levelPicker(party,{fallback:()=>assert.fail('A hostile must use its party-scaled range'),random:(min,max)=>{calls.push([min,max]);return high?max:min;}});
    assert.equal(choose({allegiance:'Hostile'}),high?12:10);
  }
  assert.deepEqual(calls,[[10,12],[10,12]]);
});
test('starter, authored bosses, existing identities and peaceful residents retain their own level rules',()=>{
  for(const options of [{starting:true},{scripted:true},{identity:true}]){
    const choose=B.levelPicker(fullParty(),{...options,fallback:()=>37,random:()=>assert.fail('Special identities must not be rebalanced')});
    assert.equal(choose({allegiance:'Hostile'}),37);
  }
  const choose=B.levelPicker(fullParty(),{fallback:()=>2,random:()=>assert.fail('Do not rescale peaceful residents')});
  for(const allegiance of ['Neutral','Friendly'])assert.equal(choose({allegiance}),2);
});
async function preparedRules(room={name:'Test Site',classification:{indoor:false}},key='2,0,0'){
  const source=fs.readFileSync('retort/retortWithUserInput.js','utf8'),a=source.indexOf('async function generateRoomInhabitantPopulation('),b=source.indexOf('async function generateRoomObjects(',a),saved={[key]:room};let captured;
  const party=fullParty().map(s=>({Name:s.name,Level:s.level,HP:s.hp}));
  const context={require:createRequire(require.resolve('../retort/retortWithUserInput')),console,Inhabitants:I,updatedGameConsole:partyText(key),
    extractCharactersAndNpcs:()=>({characters:[party[0]],npcs:party.slice(1)}),needsQuestIntroduction:()=>false,
    sharedState:{getRoomNameDatabase:()=>JSON.stringify(saved),setRoomNameDatabase:text=>Object.assign(saved,JSON.parse(text)),
      getDungeonRunId:()=> 'offline-run',getCurrentQuest:()=> '',getCurrentTaskIndex:()=>0},
    getRandomInt:(min,max)=>max,getRandomSex:()=> 'Female',
    generateInhabitants:async(_$,data,rules)=>{captured={data,rules};throw Error('captured rules');}};
  vm.runInNewContext(source.slice(a,b),context);
  await assert.rejects(context.generateRoomInhabitantPopulation({},room.name,'An authored test site.',key),/captured rules/);
  return captured;
}
test('the actual prepared-room callback uses party-scaled hostiles even with Mortacia leading',async()=>{
  const {rules}=await preparedRules();assert.equal(rules.level({allegiance:'Hostile'}),12);
  assert.equal(rules.level({allegiance:'Neutral'}),15,'Existing peaceful resident rule is untouched');
});
test('the prepared-room callback preserves exceptional boss and hand-authored generation',async()=>{
  for(const room of [{name:'Boss Site',bossGate:{targetKey:'2,0,0'}},{name:'Hand Site',builder:{mode:'hand'}}]){
    const {rules}=await preparedRules(room);assert.equal(rules.level({allegiance:'Hostile'}),15);
  }
});
test('higher encounter levels propagate through real HP, XP, attack and damage allocation without another model call',async()=>{
  const party=fullParty(),rows=fixtures(8),calls=[],choose=B.levelPicker(party,{fallback:()=>1,random:min=>min});
  const $={user(){},assistant:{generation:async request=>{calls.push(request);return{content:JSON.stringify({inhabitants:batchRows(rows,request)})};}}};
  const result=await G.generateInhabitants($,{geoKey:'2,0,0',roomName:'Test Site',indoor:true,party,partyNames:party.map(a=>a.name)},
    {level:choose,random:min=>min,sex:()=> 'Female',xp:level=>level*1000,equipment:async()=>null});
  const hostiles=I.parseBlocks(result.sheets).filter(a=>a.state==='Hostile');assert.ok(hostiles.length>=2);
  assert.ok(hostiles.every(a=>a.level===10&&a.hp>=10&&a.xp===10000&&a.attack===5&&a.damage===3));
  assert.equal(result.population.encounterBalance.partyLevel,10);assert.ok(calls.length<=8);
});
test('the actual supplemental path hydrates stripped map actors and generates a high-level group',async()=>{
  const file=require.resolve('./random-encounters.test.cjs'),source=fs.readFileSync(file,'utf8');
  const helpers=vm.runInNewContext(source.slice(0,source.indexOf("test('browser and server"))+'\n({setup,runtime});',{require:createRequire(file)});
  const f=helpers.setup();
  const roster=rawRoster().map((a,i)=>({...a,mazeX:20-i,mazeY:20,mazeRoomKey:'4,4,0'}));f.state.setCombatCharactersString(JSON.stringify(roster));
  f.state.getUpdatedGameConsole=()=>partyText('4,4,0');
  const Random=require('../retort/randomEncounters'),count=Random.opportunity(f.state,f.visit,f.player,200000).rules.groupSize;
  const rows=fixtures(count,Array.from({length:count},(_,slot)=>({slot,name:'Scaling Test '+slot,race:'Allip',allegiance:'Hostile'})));
  await Random.maybeGenerate({...f,now:200000,random:()=>0,runtime:helpers.runtime({inhabitants:rows})});
  const enemies=Object.values(f.p.actors).filter(a=>a.supplemental).map(a=>I.parseBlocks(a.sheet)[0]);
  assert.equal(enemies.length,count);assert.ok(enemies.every(a=>a.level>=10&&a.level<=12));
  assert.ok(enemies.every(a=>a.hp>=10));assert.equal(f.p.randomEncounters.count,1);
});
