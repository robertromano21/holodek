'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I=require('../assets/dungeonInhabitants'),Generation=require('../retort/inhabitantGeneration'),Setting=require('../retort/settingLayer');

test('a described and visited Mode 4 starting room with an empty placeholder still needs residents',()=>{
  const room={populationComplete:true,visited:true,description:'Chapel steps',inhabitants:I.createPopulation('0,0,0',[],{starting:true})};
  assert.equal(Generation.needsStartingResidents(room,'0,0,0',true),true);
  for(const patch of [{startingResidentsComplete:true},{inhabitants:{authoredAt:1}},{inhabitants:{initialSheets:'original cast'}},
    {inhabitants:{actors:{Sella:{status:'dead'}}}},{inhabitants:{actors:{Sella:{status:'recruited'}}}},
    {inhabitants:{companions:{Sella:{status:'dead'}}}}])assert.equal(Generation.needsStartingResidents({...room,...patch},'0,0,0',true),false);
  assert.equal(Generation.needsStartingResidents(room,'0,1,0',true),false);
  assert.equal(Generation.needsStartingResidents(room,'0,0,0',false),false);
});

test('production starting-resident repair preserves existing content and does not run twice',async()=>{
  const source=fs.readFileSync(require.resolve('../retort/retortWithUserInput'),'utf8');
  const begin=source.indexOf('    // Mode 4 starts with an authored description'),end=source.indexOf('    // world1 CITY_SITES:',begin);
  const currentRoomData={name:'Arrival',populationComplete:true,objects:[{name:'supplies'}],exits:{west:{status:'locked'}},puzzleMechanism:{solved:true}};
  const db={'0,0,0':currentRoomData};let saved=JSON.stringify(db),calls=0;
  const context={require:require('node:module').createRequire(require.resolve('../retort/retortWithUserInput')),
    alreadyPopulated:true,missingDescription:false,WorldSetting:{current:()=>({kind:'homebrew'})},currentRoomData,coordKey:'0,0,0',roomName:'Arrival',roomDescription:'An arrival deck',
    roomNameDatabasePlain:db,needsUpdate:false,console:{info(){}},sharedState:{getRoomNameDatabase:()=>saved},
    persistRoomDb:value=>{saved=JSON.stringify(value);},$: {run:fn=>fn({})},
    generateRoomInhabitantPopulation:async()=>{calls++;const generated=JSON.parse(saved);generated['0,0,0'].inhabitants={authoredAt:1,actors:{Mira:{allegiance:'Friendly'}}};saved=JSON.stringify(generated);}};
  vm.runInNewContext('async function run(){'+source.slice(begin,end)+'}',context);
  await context.run();await context.run();
  assert.equal(calls,1);assert.equal(currentRoomData.startingResidentsComplete,true);
  assert.deepEqual(JSON.parse(JSON.stringify(currentRoomData.objects)),[{name:'supplies'}]);assert.equal(currentRoomData.exits.west.status,'locked');assert.equal(currentRoomData.puzzleMechanism.solved,true);
});

test('Mode 4 creates at least two authored, friendly, recruitable setting guides',async()=>{
  Setting.setActive(Setting.validateBible(Setting.localBible('Starport',['sci-fi'])));
  try{
    const rows=require('./fixtures/inhabitants.cjs')(2),prompts=[],requests=[];
    const $={user:(text)=>prompts.push(String(text)),assistant:{generation:async request=>{
      requests.push(request);
      return {content:JSON.stringify({inhabitants:require('./fixtures/inhabitant-batch.cjs').batchRows(rows,request)})};
    }}};
    const result=await Generation.generateInhabitants($,{geoKey:'0,0,0',roomName:'Arrival',roomDescription:'A starport deck',partyNames:[],usedNames:[]},
      {random:min=>min,level:()=>1,sex:()=>'Female',xp:()=>0,equipment:async()=>null});
    assert.equal(Object.keys(result.population.actors).length,2);assert.equal(requests.length,1);
    assert.ok(Object.values(result.population.actors).every(a=>a.allegiance==='Friendly'&&a.status==='present'));
    assert.match(prompts.join(' '),/available to recruit/);assert.match(prompts.join(' '),/acquaint the newcomer/);
    assert.match(prompts.join(' '),/offers to accompany/);assert.equal(result.population.questIntroduction,undefined);
  }finally{Setting.setActive(null);}
});

test('starting residents are placed in view and conversation range, not behind an arrival wall',()=>{
  const d={geoKey:'0,0,0',layout:{width:22,height:16},start:{x:2,y:3},cells:{},classification:{indoor:true}};
  for(let y=0;y<16;y++)for(let x=0;x<22;x++)d.cells[`${x},${y}`]={tile:x&&y&&x<21&&y<15&&!(x===6&&y<12)?'floor':'wall',floorHeight:0,ceilHeight:3};
  const pop=I.createPopulation('0,0,0',Array.from({length:4},(_,i)=>({name:'Guide '+i,encounterId:'welcome',allegiance:'Friendly'})),{starting:true});
  I.place(pop,d);
  for(const a of Object.values(pop.actors)){
    assert.ok(a.position,a.name);assert.ok(a.position.x<6,a.name+' visible side of wall');
    assert.ok(Math.hypot(a.position.x-d.start.x,a.position.y-d.start.y)<=10);
  }
  const positions=JSON.stringify(pop.actors);I.place(pop,d);assert.equal(JSON.stringify(pop.actors),positions);
});
