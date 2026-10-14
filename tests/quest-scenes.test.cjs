'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../retort/questScenes'),Q=require('../retort/questProgress'),I=require('../assets/dungeonInhabitants');
const W=require('../assets/questWritings'),Read=require('../retort/readableActions');
const {createPopulationService}=require('../retort/roomPopulation');
const sheet=(name,hp=20,state='Neutral')=>`${name}\nFemale\nHuman\nArchivist\nLevel: 2\nAC: 10\nXP: 0\nHP: ${hp}\nMaxHP: 20\nEquipped: Weapon: None, Armor: None, Shield: None, Other: None\nAttack: 0\nDamage: 0\nArmor: 0\nMagic: 0\nState: ${state}`;
function fixture(kind='npc',type='Fetch',guard=false) {
  const roomKey='1,0,0',name='Edrin Farrows',item='shardbreaker maul',metadata={name:item,type:'weapon',damage_modifier:4};
  const p=I.createPopulation(roomKey,[{name,hp:20,allegiance:'Neutral',encounterId:'scribe'},
    ...(guard?[{name:'Stone Sentinel',hp:20,allegiance:'Hostile',encounterId:'guard'}]:[])]);
  for(const [i,a]of Object.values(p.actors).entries()){a.position=a.home={x:3+i,y:2};a.sheet=sheet(a.name,20,a.allegiance);a.hp=20;}
  p.actors[name].inventory=[{name:'scribe scroll',type:'scroll',magic:2}];
  const db={[roomKey]:{name:'Hall of Records',objects:[metadata,{name:'chronicle of ancient vows',type:'book'}],
    inhabitants:p,monsters:{inRoom:Object.values(p.actors).map(a=>a.sheet).join('\n'),state:guard?'Mixed':'Neutral'},
    readables:[{id:'book:1',name:'chronicle of ancient vows',kind:'book',title:'Ancient Vows',chapters:[{title:'The first vow',text:'A promise recorded in stone.'}]}]}};
  const base=Q.compileGeneratedTask({id:'test-'+kind,type,actionKind:type==='Deliver'?'deliver_item':'take_item',
    requiredElements:[{type:'weapon',name:item,placement:roomKey},...(type==='Deliver'?[{type:'monster',name,placement:roomKey}]:[])]},db,roomKey);
  let tasks=[S.compile(base,db,roomKey,{hookKind:kind})],idx=0,wire=JSON.stringify([{name:'Mortacia',type:'pc',hp:12,mazeX:2,mazeY:2,mazeRoomKey:roomKey},
    ...Object.values(p.actors).map(a=>({name:a.name,type:'monster',hp:20,state:a.allegiance,mazeX:a.position.x,mazeY:a.position.y,mazeRoomKey:roomKey}))]);
  let database=JSON.stringify(db),text=`Current Quest: The temple records\nQuest Progress: Step 1/3: Pending\nCoordinates: X: 1, Y: 0, Z: 0\nObjects in Room: shardbreaker maul, chronicle of ancient vows\nInventory: Empty\nInventory Properties: None\nPC:\n${sheet('Mortacia',12,'Friendly')}\nNPCs in Party: None\nMonsters in Room:\n${db[roomKey].monsters.inRoom}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nRooms Visited: 3`;
  const d={geoKey:roomKey,start:{x:2,y:2},layout:{width:8,height:8},cells:{},sceneObjects:[{name:'chronicle of ancient vows',x:2,y:3}]};
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)d.cells[`${x},${y}`]={tile:x===0||y===0||x===7||y===7?'wall':'floor',floorHeight:.4};
  W.apply(d,db[roomKey]);let population=p,paused=false;
  const state={getLastCoords:()=>({x:1,y:0,z:0}),getDungeonRunId:()=> 'run',getGamePaused:()=>paused,
    getRoomDungeon:()=>d,getRoomDungeonForSimulation:()=>d,getRoomPopulation:()=>population,setRoomPopulation:(k,v)=>population=v,
    getRoomNameDatabase:()=>database,setRoomNameDatabase:v=>database=v,getUpdatedGameConsole:()=>text,setUpdatedGameConsole:v=>text=v,
    getCombatCharactersString:()=>wire,setCombatCharactersString:v=>wire=v,getCurrentTasks:()=>tasks,setCurrentTasks:v=>tasks=v,
    getCurrentTaskIndex:()=>idx,setCurrentTaskIndex:v=>idx=v,setQuestSeeded(){},setLastQuestUpdate(){}};
  const service=createPopulationService(state);
  const view=()=>S.view(state).scene;
  const choose=id=>{const scene=view();return S.choose(state,service,{runId:'run',geoKey:roomKey,storyId:scene.storyId,stageId:scene.stageId,revision:scene.revision,optionId:id});};
  const carry=()=>{text=text.replace('Inventory: Empty','Inventory: '+item).replace('Inventory Properties: None','Inventory Properties: '+JSON.stringify(metadata));};
  return {state,service,d,view,choose,carry,task:()=>tasks[0],db:()=>JSON.parse(database),p:()=>population,paused:v=>paused=v,name,item,roomKey};
}
test('compiler builds actual NPC, document and voxel-writing hooks without changing base objective gates',()=>{
  for(const kind of ['npc','item','writing']) {
    const f=fixture(kind),task=f.task();assert.equal(task.story.hook.kind,kind);assert.equal(S.valid(task.story,f.db()),true);
    assert.equal(task.hardRequirements.at(-1).check,'quest_story_complete');
    assert.match(Q.describeQuestRequirements(task,f.db()),/shardbreaker maul.*Hall of Records/);
    assert.equal(S.isComplete(task,f.db()),false);
  }
});
test('NPC dialogue, engine objective, explicit conclusion and persisted receipts complete exactly once',()=>{
  const f=fixture();assert.equal(f.view().stageId,'hook');
  assert.equal(f.choose('accept').error,undefined);assert.equal(f.view().stageId,'objective');
  f.carry();assert.equal(f.view().stageId,'resolution');
  f.state.setCurrentTasks(JSON.parse(JSON.stringify(f.state.getCurrentTasks())));
  assert.equal(f.choose('finish').error,undefined);assert.equal(f.state.getCurrentTaskIndex(),1);
  assert.equal(S.isComplete(f.task(),f.db()),true);assert.equal(f.task().status,'Completed');
  assert.ok(S.choose(f.state,f.service,{optionId:'finish'}).error);
});
test('actual chapter reading is required: a forged accept choice or cover inspection cannot open a document hook',()=>{
  const f=fixture('writing'),hook=f.task().story.hook;
  assert.deepEqual(f.view().options.map(o=>o.id),['read']);assert.ok(f.choose('accept').error);
  const plan=Read.prepare({input:'examine '+hook.name,consoleText:f.state.getUpdatedGameConsole(),database:f.db(),dungeon:f.d,
    actor:JSON.parse(f.state.getCombatCharactersString())[0],geoKey:f.roomKey});
  assert.equal(plan.allowed,true);S.onRead(f.state,plan);assert.equal(f.view().stageId,'hook');
  assert.equal(f.choose('read').error,undefined);assert.equal(f.view().stageId,'objective');
  f.carry();assert.equal(f.choose('finish').error,undefined);assert.equal(S.isComplete(f.task(),f.db()),true);
});
test('a real book preserves its chapters while carrying stored quest notes with exact requirements',()=>{
  const f=fixture('item'),doc=f.db()[f.roomKey].readables[0];
  assert.equal(doc.chapters[0].text,'A promise recorded in stone.');assert.match(f.view().description,/Finish with Edrin Farrows/);
  const read=f.choose('read');assert.equal(read.error,undefined);assert.match(read.content,/Recorded obligation.*|shardbreaker maul/);
  assert.equal(f.view().stageId,'objective');f.carry();assert.equal(f.choose('finish').error,undefined);
});
test('receiving an actual personal item retains its full properties and cannot be replayed',()=>{
  const f=fixture();f.choose('accept');f.carry();
  const before=JSON.parse(f.state.getCombatCharactersString()).map(a=>a.hp);
  assert.equal(f.choose('receive').error,undefined);
  assert.deepEqual(f.p().actors[f.name].inventory,[]);
  assert.match(f.state.getUpdatedGameConsole(),/Inventory: shardbreaker maul, scribe scroll/);
  assert.match(f.state.getUpdatedGameConsole(),/"magic":2/);
  assert.deepEqual(JSON.parse(f.state.getCombatCharactersString()).map(a=>a.hp),before);
  assert.ok(S.choose(f.state,f.service,{optionId:'receive'}).error);
});
test('a neutral contact can accept the explicit recruitment bargain; loose possessions join inventory, HP and equipped gear survive',()=>{
  const f=fixture();f.choose('accept');f.carry();
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('Equipped: Weapon: None','Equipped: Weapon: iron staff'));
  assert.equal(f.choose('invite').error,undefined);
  assert.equal(f.p().actors[f.name].status,'recruited');
  const actor=JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name===f.name);
  assert.equal(actor.type,'npc');assert.equal(actor.hp,20);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party')[0].name,f.name);
  assert.match(f.state.getUpdatedGameConsole(),/scribe scroll/);
});
test('delivery uses the ordinary engine receipt and cannot finish by narration or dropping the item',()=>{
  const f=fixture('npc','Deliver');f.choose('accept');f.carry();
  assert.equal(f.view().stageId,'objective');assert.ok(f.choose('finish').error);
  assert.equal(f.choose('give:'+f.item).error,undefined);assert.equal(f.state.getCurrentTaskIndex(),0);
  assert.equal(f.view().stageId,'resolution');assert.equal(f.db()[f.roomKey].itemTransfers[0].taskBinding,Q.taskBinding(f.task()));
  assert.equal(f.choose('finish').error,undefined);assert.equal(f.state.getCurrentTaskIndex(),1);
});
test('ordinary recruitment cannot remove a staged handoff recipient before their obligation; unrelated characters retain normal recruitment',()=>{
  const f=fixture('npc','Deliver');
  assert.ok(S.recruitmentGuard(f.state,'add Edrin Farrows to party'));
  assert.ok(S.recruitmentGuard(f.state,'invite Edrin to the party'));
  assert.equal(S.recruitmentGuard(f.state,'add Another Archivist to party'),null);
  assert.equal(S.recruitmentGuard(f.state,'give shardbreaker maul to Edrin Farrows'),null);
  f.choose('accept');f.carry();f.choose('give:'+f.item);f.choose('finish');
  assert.equal(S.recruitmentGuard(f.state,'add Edrin Farrows to party'),null);
});
test('planned hostile encounter cannot be completed by narrative; actual saved HP is required',()=>{
  const f=fixture('npc','Fetch',true);f.choose('accept');f.carry();assert.equal(f.view().stageId,'encounter');
  assert.equal(f.view().options[0].target,'Stone Sentinel');assert.ok(f.choose('finish').error);
  const db=f.db();db[f.roomKey].monsters.inRoom=db[f.roomKey].monsters.inRoom.replace('Stone Sentinel\nFemale\nHuman\nArchivist\nLevel: 2\nAC: 10\nXP: 0\nHP: 20','Stone Sentinel\nFemale\nHuman\nArchivist\nLevel: 2\nAC: 10\nXP: 0\nHP: 0');
  f.state.setRoomNameDatabase(JSON.stringify(db));assert.equal(f.view().stageId,'resolution');
  assert.equal(f.choose('finish').error,undefined);
});
test('stale run, room, revision, unavailable options, pause and distant participants cannot consume a choice',()=>{
  const f=fixture(),scene=f.view(),request={runId:'run',geoKey:f.roomKey,storyId:scene.storyId,stageId:scene.stageId,revision:scene.revision,optionId:'accept'};
  const before=f.state.getRoomNameDatabase();
  for(const change of [{runId:'old'},{geoKey:'0,0,0'},{revision:9},{optionId:'mint-key'}])assert.ok(S.choose(f.state,f.service,{...request,...change}).error);
  f.paused(true);assert.ok(S.choose(f.state,f.service,request).error);f.paused(false);
  assert.equal(f.state.getRoomNameDatabase(),before);
  const roster=JSON.parse(f.state.getCombatCharactersString());roster[0].mazeX=6;roster[0].mazeY=6;f.state.setCombatCharactersString(JSON.stringify(roster));
  assert.ok(S.choose(f.state,f.service,request).error);
});
test('empty/missing readables, cyclic graphs and nonexistent actors cannot publish a story',()=>{
  for(const change of [s=>s.stages[0].actor='Ghost',s=>s.stages[0].options[0].next='hook',s=>s.stages[0].options[0].next='missing']) {
    const f=fixture(),story=structuredClone(f.task().story);change(story);assert.equal(S.valid(story,f.db()),false);
  }
  const f=fixture('writing'),db=f.db();db[f.roomKey].inscriptions=[];assert.equal(S.valid(f.task().story,db),false);
});
test('a dead optional contact leaves an accessible tablet conclusion rather than an unfinishable scene',()=>{
  const f=fixture();f.choose('accept');f.carry();f.view();
  const db=f.db();db[f.roomKey].inhabitants.actors[f.name].status='dead';f.state.setRoomNameDatabase(JSON.stringify(db));
  const scene=f.view();assert.equal(scene.actor,null);assert.deepEqual(scene.options.map(o=>o.id),['finish']);
  assert.equal(f.choose('finish').error,undefined);assert.equal(f.state.getCurrentTaskIndex(),1);
});
test('a real delivery assistant can take over the staged dialogue and handoff without impersonating the deceased recipient',()=>{
  const f=fixture('npc','Deliver'),db=f.db();
  const record=f.p().actors[f.name];record.status='dead';record.hp=0;record.sheet=sheet(f.name,0,'Dead');
  db[f.roomKey].inhabitants=f.p();db[f.roomKey].monsters.inRoom=record.sheet;
  f.state.setRoomNameDatabase(JSON.stringify(db));
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace(sheet(f.name),record.sheet));
  const roster=JSON.parse(f.state.getCombatCharactersString());roster[1].hp=0;roster[1].state='Dead';f.state.setCombatCharactersString(JSON.stringify(roster));
  const scene=f.view();assert.match(scene.actor,/Assistant/);assert.doesNotMatch(scene.text,/^Edrin Farrows:/);
  f.choose('accept');f.carry();assert.equal(f.choose('give:'+f.item).error,undefined);
  assert.equal(f.choose('finish').error,undefined);assert.equal(S.isComplete(f.task(),f.db()),true);
});
test('proof validation rejects rewritten task identities or histories claiming a read without actual content evidence',()=>{
  const f=fixture('writing');f.choose('read');f.carry();f.choose('finish');
  const db=f.db(),record=S.runtime(f.task(),db);delete record.history[0].evidence.contentHash;
  assert.equal(S.isComplete(f.task(),db),false);
  assert.equal(S.isComplete({...f.task(),desc:'Different obligation'},f.db()),false);
});
test('boss-key objectives and legacy tasks remain outside the stage compiler',()=>{
  const f=fixture(),task={id:'boss',actionKind:'unlock_exit',type:'Fetch',requiredElements:[]};
  assert.equal(S.compile(task,f.db(),f.roomKey),task);
  assert.equal(S.compile({...task,bossGate:true},f.db(),f.roomKey).story,undefined);
});
