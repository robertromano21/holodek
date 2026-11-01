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
function noticeFixture(kind='npc') {
  const f=fixture(kind);f.events=[];f.broadcast=e=>f.events.push(e);
  f.state.getCurrentQuest=()=> 'The temple records';f.state.getQuestSeeded=()=>true;
  f.dialogue=(speaker=f.name,extra={})=>S.onDialogue(f.state,{type:'character_dialogue',runId:'run',geoKey:f.roomKey,
    dialogue:[{speaker,line:'I have an obligation to discuss with you.',recipient:'PC'}],...extra},f.broadcast);
  return f;
}
test('quest preparation, room polling and unrelated speakers do not announce the saved hook',()=>{
  const f=noticeFixture();assert.equal(f.view().stageId,'hook');assert.equal(f.events.length,0);
  assert.equal(f.dialogue('Another resident'),false);assert.equal(f.events.length,0);
  assert.equal(f.task().seedNoticeId,undefined);
  assert.equal(f.dialogue(),true);assert.equal(f.events.length,1);assert.equal(f.events[0].kind,'quest-seeded');
  assert.equal(f.view().stageId,'hook','Hearing the giver does not accept or advance the quest');
  assert.equal(f.dialogue(),false);
  f.state.setCurrentTasks(JSON.parse(JSON.stringify(f.state.getCurrentTasks())));
  assert.equal(f.dialogue(),false,'A saved notice receipt survives reload');assert.equal(f.events.length,1);
});
test('a visible giver conversation announces without needing to accept, including narrated encounters',()=>{
  for(const mode of ['view','story']) {
    const f=noticeFixture();
    if(mode==='view')assert.equal(S.view(f.state,f.name,f.broadcast).scene.stageId,'hook');
    else assert.equal(f.dialogue(f.name,{type:'encounter_story'}),true);
    assert.equal(f.events.length,1);assert.equal(f.task().status,'Pending');assert.equal(f.view().stageId,'hook');
  }
});
test('stale rooms, runs, floors, silence and speech to other residents cannot announce a quest',()=>{
  for(const extra of [{runId:'old'},{geoKey:'0,0,0'},{floorToken:'old-floor'},
    {dialogue:[]},{dialogue:[{speaker:'Edrin Farrows',line:'',recipient:'PC'}]},
    {dialogue:[{speaker:'Edrin Farrows',line:'Good morning.',recipient:'Another resident'}]}]) {
    const f=noticeFixture();assert.equal(f.dialogue(f.name,extra),false);assert.equal(f.events.length,0);
  }
  const f=noticeFixture(),db=f.db();
  f.task().roomScopes={[f.roomKey]:{hostKey:f.roomKey,buildingId:'hall',floor:1}};
  db[f.roomKey].cityFloorContext={hostKey:f.roomKey,buildingId:'hall',floor:2};f.state.setRoomNameDatabase(JSON.stringify(db));
  assert.equal(f.dialogue(),false);assert.equal(f.events.length,0);
});
test('distant, hidden, dead and occluded givers do not trigger encounter notices',()=>{
  for(const change of [f=>{const roster=JSON.parse(f.state.getCombatCharactersString());roster[0].mazeX=6;roster[0].mazeY=6;f.state.setCombatCharactersString(JSON.stringify(roster));},
    f=>f.p().actors[f.name].discoveryState='pending',
    f=>{const db=f.db();db[f.roomKey].inhabitants.actors[f.name].status='dead';f.state.setRoomNameDatabase(JSON.stringify(db));},
    f=>{f.d.cells['3,2']={tile:'wall',blocked:true};}]) {
    const f=noticeFixture();change(f);assert.equal(f.dialogue(),false);assert.equal(f.events.length,0);
  }
});
test('written hooks announce on reading, never on room entry, inspection or a forged chapter',()=>{
  for(const kind of ['writing','item']) {
    const f=noticeFixture(kind),hook=f.task().story.hook;
    assert.equal(S.view(f.state,null,f.broadcast).scene.stageId,'hook');assert.equal(f.events.length,0);
    const plan=Read.prepare({input:'read '+hook.name,consoleText:f.state.getUpdatedGameConsole(),database:f.db(),dungeon:f.d,
      actor:JSON.parse(f.state.getCombatCharactersString())[0],geoKey:f.roomKey});
    assert.equal(plan.allowed,true);
    for(const invalid of [{...plan,inspect:true},{...plan,allowed:false},{...plan,chapter:999},{...plan,sourceKey:'0,0,0'}])S.onRead(f.state,invalid,f.broadcast);
    assert.equal(f.events.length,0);assert.equal(f.view().stageId,'hook');
    S.onRead(f.state,plan,f.broadcast);assert.equal(f.events.length,1);assert.equal(f.view().stageId,'objective');
    S.onRead(f.state,plan,f.broadcast);assert.equal(f.events.length,1);
  }
});
test('quest scene read and accept buttons deliver the same single notice as ordinary actions',()=>{
  for(const kind of ['npc','writing']) {
    const f=noticeFixture(kind),scene=f.view();
    const result=S.choose(f.state,f.service,{runId:'run',geoKey:f.roomKey,storyId:scene.storyId,
      stageId:scene.stageId,revision:scene.revision,optionId:kind==='npc'?'accept':'read'},f.broadcast);
    assert.equal(result.error,undefined);assert.equal(f.events.length,1);assert.equal(f.view().stageId,'objective');
  }
});
test('a deceased giver announces only when the surviving written introduction is actually read',()=>{
  const f=noticeFixture(),db=f.db();
  db[f.roomKey].inhabitants.actors[f.name].status='dead';f.state.setRoomNameDatabase(JSON.stringify(db));
  assert.equal(f.dialogue(),false);assert.equal(S.view(f.state,null,f.broadcast).scene.actor,null);assert.equal(f.events.length,0);
  const fallback=f.task().story.fallback,plan=Read.prepare({input:'read '+fallback.name,consoleText:f.state.getUpdatedGameConsole(),
    database:f.db(),dungeon:f.d,actor:JSON.parse(f.state.getCombatCharactersString())[0],geoKey:f.roomKey});
  assert.equal(plan.allowed,true);S.onRead(f.state,plan,f.broadcast);
  assert.equal(f.events.length,1);assert.equal(f.view().stageId,'objective');
});
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

test('known quest contacts allow progress inquiries during an unfinished encounter without offering a premature conclusion',()=>{
  const f=fixture('npc','Fetch',true);f.choose('accept');f.carry();
  assert.equal(f.view().stageId,'encounter');
  const before=f.state.getRoomNameDatabase(),result=S.view(f.state,f.name);
  assert.equal(result.error,undefined);assert.equal(result.scene.inquiry,true);
  assert.equal(result.scene.actor,f.name);assert.equal(result.scene.stageId,'encounter');
  assert.deepEqual(result.scene.options,[]);assert.match(result.scene.description,/defeat or recruit Stone Sentinel/i);
  assert.equal(f.state.getRoomNameDatabase(),before);assert.equal(f.task().status,'Pending');
  for(const optionId of ['invite','finish'])assert.ok(S.choose(f.state,f.service,{runId:'run',geoKey:f.roomKey,
    storyId:result.scene.storyId,stageId:result.scene.stageId,revision:result.scene.revision,optionId}).error);
  assert.ok(S.view(f.state,'Edrin Farrows Junior').error,'Similar names do not impersonate the quest contact');
  const roster=JSON.parse(f.state.getCombatCharactersString());roster[0].mazeX=6;roster[0].mazeY=6;
  f.state.setCombatCharactersString(JSON.stringify(roster));assert.match(S.view(f.state,f.name).error,/Move closer/);
});

test('the resolution recruitment guard points to the final choice instead of claiming the objective is unfinished',()=>{
  const f=fixture();f.choose('accept');f.carry();assert.equal(f.view().stageId,'resolution');
  const result=S.recruitmentGuard(f.state,'add Edrin Farrows to party');
  assert.equal(result.actionOnly,true);assert.match(result.content,/ready for its final choice/);
  assert.match(result.content,/Quest Conversation/);assert.doesNotMatch(result.content,/Fulfill the listed objective/);
  assert.equal(f.task().status,'Pending');assert.equal(f.choose('invite').error,undefined);
});

test('a known contact can discuss an objective in another room without exposing its remote interaction choices',()=>{
  const f=fixture('npc','Fetch',true);f.choose('accept');f.carry();f.view();
  const db=f.db(),task=f.task(),stage=task.story.stages.find(s=>s.id==='encounter');
  stage.roomKey='2,0,0';db['2,0,0']={name:'Distant Guardhouse'};
  db[f.roomKey].questScenes[task.story.id].taskBinding=Q.taskBinding(task);
  f.state.setRoomNameDatabase(JSON.stringify(db));
  const result=S.view(f.state,f.name);assert.equal(result.error,undefined);
  assert.equal(result.scene.inquiry,true);assert.equal(result.scene.roomKey,f.roomKey);
  assert.match(result.scene.description,/Distant Guardhouse/);assert.deepEqual(result.scene.options,[]);
  assert.equal(S.runtime(task,f.db()).stage,'encounter');
});

test('actual nonlethal combat remains credited after bandaging, recovery, healing and JSON reload',()=>{
  const Life=require('../retort/combatLife');
  for(const natural of [1,20]) {
    const f=fixture('npc','Fetch',true);
    f.task().story.stages.find(s=>s.kind==='encounter').defeatOnly=true;
    f.choose('accept');f.carry();assert.equal(f.view().stageId,'encounter');
    const db=f.db(),actor=I.parseSheets(f.state.getUpdatedGameConsole()).find(a=>a.name==='Stone Sentinel');
    Life.apply(db,'run',actor,0,natural,{geoKey:f.roomKey,damage:20});Life.commit(f.state,db);
    const roster=JSON.parse(f.state.getCombatCharactersString());roster[0].mazeX=3;f.state.setCombatCharactersString(JSON.stringify(roster));
    if(natural===1)assert.equal(Life.care(f.state,{runId:'run',geoKey:f.roomKey,actor:'Mortacia',target:actor.name,kind:'bandage',nonce:'quest-bandage:123'}).error,undefined);
    Life.advance(f.state);Life.advance(f.state);
    const healed=f.db(),resident=I.parseSheets(f.state.getUpdatedGameConsole()).find(a=>a.name===actor.name);
    Life.apply(healed,'run',resident,10,null,{geoKey:f.roomKey});Life.commit(f.state,healed);
    f.state.setRoomNameDatabase(JSON.stringify(JSON.parse(f.state.getRoomNameDatabase())));
    assert.equal(f.view().stageId,'resolution');assert.equal(f.task().status,'Pending','An explicit conclusion is still required');
    assert.equal(f.choose('finish').error,undefined);assert.equal(S.isComplete(f.task(),f.db()),true);
    assert.equal(f.p().actors[actor.name].hp,10);assert.notEqual(f.p().actors[actor.name].status,'dead');
    assert.match(f.state.getUpdatedGameConsole(),/Inventory: shardbreaker maul/,'Fetch keeps its item');
  }
});

test('legacy saved survival evidence unlocks a spared guard, but neutral state alone does not',()=>{
  const f=fixture('npc','Fetch',true);f.choose('accept');f.carry();
  const db=f.db(),guard=db[f.roomKey].inhabitants.actors['Stone Sentinel'];
  guard.hp=1;guard.state=guard.allegiance='Neutral';guard.sheet=sheet(guard.name,1,'Neutral');
  db[f.roomKey].monsters.inRoom=Object.values(db[f.roomKey].inhabitants.actors).map(a=>a.sheet).join('\n');
  f.state.setRoomNameDatabase(JSON.stringify(db));assert.equal(f.view().stageId,'encounter');
  const next=f.db();next['0,0,0']={combatLife:{source:'engine-combat-life-v1',version:1,runId:'run',clock:25,actors:{'stone sentinel':{
    name:guard.name,type:'monster',geoKey:f.roomKey,hp:1,state:'Neutral',at:23,
    save:{natural:9,total:9,difficulty:12,passed:false},mercy:{by:'Mortacia',at:23}}},receipts:[]}};
  f.state.setRoomNameDatabase(JSON.stringify(next));assert.equal(f.view().stageId,'resolution');
  assert.equal(f.choose('finish').error,undefined);assert.equal(S.isComplete(f.task(),f.db()),true);
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
