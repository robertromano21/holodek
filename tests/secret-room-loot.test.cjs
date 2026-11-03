'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Loot=require('../retort/secretRoomLoot'),Secrets=require('../retort/secretDoors'),Items=require('../retort/itemAuthoring');
const {makeNavigation,reachable}=require('../retort/sceneArchitecture'),Objects=require('../assets/sceneObjectSync');
const materials=['bronze','silver','iron','copper','glass','ceramic'];
function fixture(outside=false){
  const dungeon={geoKey:'1,0,0',layout:{width:64,height:64},start:{x:32,y:32},generation:{seed:'secret-rewards'},cells:{},tiles:{},
    sceneObjects:[{name:'ordinary blade',type:'weapon',magic:0,x:30,y:30}]};
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)dungeon.cells[`${x},${y}`]={
    tile:x===0||y===0||x===63||y===63||!outside&&(x<20||x>44||y<20||y>44)?'wall':'floor',floorHeight:0,ceilHeight:3};
  let database={'1,0,0':{name:'An Authored Location',description:'An authored description.',objects:[{
    name:'ordinary blade',type:'weapon',attack_modifier:3,damage_modifier:4,ac:0,magic:0}]}},runId='run';
  let text='Coordinates: X: 1, Y: 0, Z: 0\nObjects in Room: ordinary blade\nObjects in Room Properties: '+JSON.stringify(database['1,0,0'].objects[0]);
  const state={getDungeonRunId:()=>runId,getRoomNameDatabase:()=>JSON.stringify(database),setRoomNameDatabase:value=>database=JSON.parse(value),
    getUpdatedGameConsole:()=>text,setUpdatedGameConsole:value=>text=value};
  const requests=[],author=async(_agent,request)=>{
    requests.push(request);return Items.validate({items:Array.from({length:request.count},(_,i)=>({name:'hidden '+materials[i]+' relic',type:'other',
      attack_modifier:0,damage_modifier:0,ac:0,magic:1,consumable_kind:'none',description:'A finely worked portable object.'}))},request);
  };
  return{dungeon,state,requests,author,db:()=>database,text:()=>text,run:value=>runId=value,
    prepare:()=>Loot.prepare({},state,dungeon,text,{author})};
}

for(const outside of [false,true])test(`every ${outside?'outdoor vault':'indoor secret chamber'} has an extra authored object, never a relocated ordinary item`,async()=>{
  const f=fixture(outside),regular=structuredClone(f.dungeon.sceneObjects);await f.prepare();
  const doors=f.dungeon.secretDoors.doors;assert.ok(doors.length>=2&&doors.length<=6);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].count,doors.length);assert.match(f.requests[0].purpose,/IN ADDITION/);
  assert.deepEqual(f.dungeon.sceneObjects.slice(0,1),regular);assert.equal(f.db()['1,0,0'].objects.length,1+doors.length);
  const closed=reachable(makeNavigation(f.dungeon),f.dungeon.start);
  for(const door of doors){
    const item=f.dungeon.sceneObjects.find(item=>item.secretDoorId===door.id);assert.ok(item);assert.ok(door.chamber.includes(`${item.x},${item.y}`));
    assert.equal(closed.seen[item.y*64+item.x],0);assert.ok(f.db()['1,0,0'].objects.some(object=>object.economyItemId===item.id));
    assert.equal(f.dungeon.cells[door.key].tile,'wall');assert.equal(door.discovered,false);
    f.dungeon.cells[door.key]={...f.dungeon.cells[door.key],tile:'door',door:{isOpen:true}};
    assert.equal(reachable(makeNavigation(f.dungeon),f.dungeon.start).seen[item.y*64+item.x],1);
  }
  assert.match(f.text(),/hidden .*relic/);const positions=structuredClone(f.dungeon.sceneObjects);
  Objects.sync(f.dungeon,f.text());assert.deepEqual(f.dungeon.sceneObjects,positions,'Ordinary object synchronization must not move secret rewards into the main room');
});

test('saved rooms retain exact bonus identities and placements and never refill collected secret loot',async()=>{
  const f=fixture();await f.prepare();const first=f.dungeon.sceneObjects.find(item=>item.secretDoorId);
  const database=f.db();database['1,0,0'].objects=database['1,0,0'].objects.filter(item=>item.name!==first.name);
  f.dungeon.sceneObjects=f.dungeon.sceneObjects.filter(item=>item.name!==first.name);
  const remaining=JSON.stringify(f.dungeon.sceneObjects);await f.prepare();
  assert.equal(f.requests.length,1);assert.equal(JSON.stringify(f.dungeon.sceneObjects),remaining);
  assert.ok(!f.db()['1,0,0'].objects.some(item=>item.name===first.name));
  f.dungeon.secretDoors=JSON.parse(JSON.stringify(f.dungeon.secretDoors));await f.prepare();assert.equal(f.requests.length,1);
});

test('legacy secret chambers receive their bonus once without reopening doors or rebuilding cached geometry',async()=>{
  const f=fixture();Secrets.install(f.dungeon);f.dungeon._geometryStamp='cached-geometry';
  const before=JSON.stringify(f.dungeon.cells);await f.prepare();
  assert.equal(f.requests.length,1);assert.equal(f.dungeon._geometryStamp,'cached-geometry');assert.equal(JSON.stringify(f.dungeon.cells),before);
  await f.prepare();assert.equal(f.requests.length,1);
});

test('a rebuilt placement uses the saved bonus object rather than generating another reward',async()=>{
  const f=fixture();await f.prepare();const original=structuredClone(f.dungeon.sceneObjects),door=f.dungeon.secretDoors.doors[0];
  f.dungeon.sceneObjects=f.dungeon.sceneObjects.filter(item=>item.secretDoorId!==door.id);delete door.reward;
  await f.prepare();assert.equal(f.requests.length,1);assert.equal(f.dungeon.sceneObjects.length,original.length);
  assert.equal(f.dungeon.sceneObjects.find(item=>item.secretDoorId===door.id).name,original.find(item=>item.secretDoorId===door.id).name);
});

test('empty secret plans and cached rooms without secret doors make no item-authoring calls',async()=>{
  const f=fixture();f.dungeon._geometryStamp='cached';await f.prepare();assert.equal(f.requests.length,0);
  f.dungeon.secretDoors={doors:[]};await f.prepare();assert.equal(f.requests.length,0);assert.equal(f.db()['1,0,0'].objects.length,1);
});

test('outdoor travel discovery cannot relocate secret rewards out of their vaults',async()=>{
  const f=fixture(true);await f.prepare();f.dungeon.classification={indoor:false};f.dungeon.layout={width:192,height:192};
  const population={geoKey:f.dungeon.geoKey,groups:[],actors:{}},Discovery=require('../assets/outdoorDiscovery');
  assert.equal(Discovery.setup(f.dungeon,population,{fresh:true}),true);
  for(const item of f.dungeon.sceneObjects.filter(item=>item.secretDoorId)){
    assert.equal(population.travelDiscovery.objects[item.name].status,'fixed');
    assert.equal(population.travelDiscovery.objects[item.name].x,item.x);
  }
});

test('failed or incomplete bonus authoring never consumes rewards or overwrites ordinary room objects',async()=>{
  for(const author of [async()=>{throw Error('Model unavailable.');},async()=>[]]){
    const f=fixture(),before=f.state.getRoomNameDatabase();
    await assert.rejects(Loot.prepare({},f.state,f.dungeon,f.text(),{author}));
    assert.equal(f.state.getRoomNameDatabase(),before);assert.equal(f.dungeon.sceneObjects.length,1);
    assert.ok(f.dungeon.secretDoors.doors.every(door=>!door.reward));
  }
});

test('secret item authoring uses the current genre and existing modifier validation, without CotG fallback',async()=>{
  const f=fixture(),database=f.db(),world=require('./fixtures/authored-world.cjs')('cyberpunk');world.kind='homebrew';
  database['0,0,0']={setting:world};const prompts=[];let calls=0;
  Secrets.install(f.dungeon);const count=f.dungeon.secretDoors.doors.length;
  const agent={user:async text=>prompts.push(text),assistant:{generation:async()=>{calls++;return{content:JSON.stringify({items:
    Array.from({length:count},(_,i)=>({name:'sealed '+materials[i]+' module',type:'other',attack_modifier:0,damage_modifier:0,ac:0,magic:0,
      consumable_kind:'none',description:'A sealed ceramic component in a protective sleeve.'}))})};}}};
  await Loot.prepare(agent,f.state,f.dungeon,f.text(),{author:($,options)=>Items.generate($,{...options,random:()=>.99})});assert.equal(calls,1);
  assert.doesNotMatch(prompts.join('\n'),/Tartarus|Mortacia|Arithus/);
  assert.ok(f.db()['1,0,0'].objects.filter(item=>item.secretDoorId).every(item=>item.item_source===Items.SOURCE&&item.damage_dice===undefined));
});

test('changed games and duplicate names cannot install secret rewards after asynchronous authoring',async()=>{
  for(const changed of [false,true]){
    const f=fixture(),before=f.state.getRoomNameDatabase();
    await assert.rejects(Loot.prepare({},f.state,f.dungeon,f.text(),{author:async(_agent,request)=>{
      if(changed)f.run('another-run');return Array.from({length:request.count},()=>({name:'ordinary blade'}));
    }}));assert.equal(f.state.getRoomNameDatabase(),before);assert.equal(f.dungeon.sceneObjects.length,1);
  }
});

test('main, isolated construction and cached room entry prepare secret loot before publishing the dungeon',()=>{
  const source=fs.readFileSync('retort/retortWithUserInput.js','utf8');
  assert.equal((source.match(/await require\('\.\/secretRoomLoot'\)\.prepare\(/g)||[]).length,3);
  assert.match(source,/secretRoomLoot'\)\.prepare\([^;]+;\s*roomNameDatabaseString = sharedState.getRoomNameDatabase\(\);\s*const finalDungeon = finalizeRoomDungeon/);
});
