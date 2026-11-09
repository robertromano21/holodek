'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),Opening=require('../retort/openingQuestPreparation'),Scenes=require('../retort/questScenes');
const Q=require('../retort/questProgress'),I=require('../assets/dungeonInhabitants'),Give=require('../retort/itemTransfer');
function from(name,expression,extra={}){
  const file=require.resolve('./'+name+'.test.cjs'),source=fs.readFileSync(file,'utf8');
  return vm.runInNewContext(source.slice(0,source.indexOf("\ntest('"))+'\n'+expression,{require:createRequire(file),console,structuredClone,...extra});
}
const sheet=name=>`${name}\nFemale\nShade\nArchivist\nLevel: 4\nAC: 12\nXP: 8000\nHP: 20\nMaxHP: 20\nEquipped: Weapon: None, Armor: None, Shield: None, Other: None\nAttack: 0\nDamage: 0\nArmor: 0\nMagic: 0\nState: Friendly`;
async function prepared(t,kind='Deliver'){
  const s=from('opening-quest-preparation','fixture(t)',{t}),name='Veyra Siltwake',origin=s.db()['0,0,0'];
  origin.monsters={inRoom:sheet(name),consoleBlock:sheet(name),state:'Friendly'};
  origin.inhabitants={actors:{[name]:{name,status:'present',hp:20,sheet:sheet(name)}}};
  const entry=s.service.begin();await new Promise(r=>setImmediate(r));const artifact=s.artifact();
  if(kind==='Research'){
    artifact.rooms['0,0,0'].objects.push({name:'temple chronicle',type:'book'});
    artifact.rooms['0,0,0'].readables=[{id:'chronicle',name:'temple chronicle',kind:'book',chapters:[{title:'Witness',text:'The threshold kept its witnesses.'}]}];
  }
  artifact.task=Scenes.compile(Q.compileGeneratedTask({id:'task:contact',type:kind,actionKind:kind==='Deliver'?'deliver_item':'read_book',
    requiredElements:[{type:kind==='Deliver'?'object':'book',name:kind==='Deliver'?'ivory token':'temple chronicle',placement:'0,0,0'},
      {type:'monster',name,placement:'0,0,0'}]},artifact.rooms,'0,0,0'),artifact.rooms,'0,0,0',{hookKind:'writing'});
  assert.ok(artifact.task.story);s.workers[0].emit('message',{type:'checkpoint',artifact});await entry.promise;
  let roster=[{name:'Player',type:'pc',hp:20},{name,type:'npc',hp:20}],text=s.state.getUpdatedGameConsole();
  Object.assign(origin.inhabitants.actors[name],{status:'recruited'});origin.monsters.inRoom=origin.monsters.consoleBlock='None';
  s.state.getCombatCharactersString=()=>JSON.stringify(roster);
  s.state.setCombatCharactersString=value=>{roster=JSON.parse(value);};
  s.state.setUpdatedGameConsole(text+'\nPC:\n'+sheet('Player')+'\nNPCs in Party:\n'+sheet(name)+'\nMonsters in Room: None\nMonsters Equipped Properties: None');
  return {...s,name,artifact,origin};
}

for(const kind of ['Deliver','Research'])test('prepared '+kind+' quest binds after its required starter contact joins, without changing task requirements',async t=>{
  const f=await prepared(t,kind),original=structuredClone(f.artifact.task),before=f.origin.inhabitants.actors[f.name];
  assert.equal(await f.service.activate('0,1,0'),true);const task=f.state.getCurrentTasks()[0];
  assert.deepEqual(task.requiredElements,original.requiredElements);assert.deepEqual(task.actionRequirements,original.actionRequirements);
  assert.equal(task.desc,original.desc);assert.equal(task.id,original.id);
  assert.equal(task.story.stages.find(s=>s.id==='resolution').actor,undefined);
  assert.equal(task.story.stages.find(s=>s.id==='resolution').readableId,task.story.fallback.readableId);
  assert.equal(f.db()['0,0,0'].monsters.inRoom,'None');
  for(const [key,value]of Object.entries(before))assert.deepEqual(f.db()['0,0,0'].inhabitants.actors[f.name][key],value);
  assert.ok(Scenes.valid(task.story,f.db()));assert.equal(f.jobs.length,1);assert.equal(await f.service.activate('0,1,0'),false);
});

test('a stale recruited flag or a missing/dead party member is not enough to bypass an unavailable required contact',async t=>{
  for(const mode of ['missing','dead','not-party','not-on-sheet']){
    const f=await prepared(t);f.state.setCombatCharactersString(JSON.stringify(mode==='missing'?[]:[{name:f.name,type:mode==='not-party'?'monster':'npc',hp:mode==='dead'?0:20}]));
    if(mode==='not-on-sheet')f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace(I.sectionPattern('NPCs in Party'),(_,h)=>h+' None\n'));
    const before=f.state.getRoomNameDatabase();await assert.rejects(f.service.activate('0,1,0'),error=>{
      assert.equal(error.code,'OPENING_QUEST_BINDING_INVALID');
      assert.ok(error.issues.some(issue=>issue.reason==='unavailable_actor'&&issue.actor===f.name));return /does not fit/.test(error.message);
    });
    assert.equal(f.state.getRoomNameDatabase(),before);assert.equal(f.seeded(),false);
  }
});

test('scene validation names the exact invalid contact and stage without weakening the validator',async t=>{
  const f=await prepared(t),story=f.artifact.task.story,db=structuredClone(f.artifact.rooms),actor=db['0,0,0'].inhabitants.actors[f.name];
  actor.status='departed';db['0,0,0'].monsters.inRoom=db['0,0,0'].monsters.consoleBlock='None';
  const issues=[];assert.equal(Scenes.valid(story,db,issues),false);
  assert.ok(issues.some(i=>i.reason==='unavailable_actor'&&i.actor===f.name&&i.roomKey==='0,0,0'));
});

function companionDelivery(){
  const f=from('item-transfer','fixture()'),name='Edrin Farrows';
  const task=Q.normalizeDeliveryTask(JSON.parse(JSON.stringify(f.tasks()[0])));f.state.setCurrentTasks([task]);
  const roster=f.roster(),member=roster.find(a=>a.name===name);member.type='npc';member.state='Friendly';
  f.state.setCombatCharactersString(JSON.stringify(roster));f.p.actors[name].status='recruited';
  const text=f.state.getUpdatedGameConsole(),record=I.parseSheets(text).find(a=>a.name===name);
  f.setText(text.replace('NPCs in Party: None','NPCs in Party:\n'+record.rawSheet).replace(I.sectionPattern('Monsters in Room'),head=>head.split('\n')[0]+'\nNone\n'));
  return f;
}

test('the actual item handoff to a confirmed companion still writes the original bound delivery receipt',()=>{
  const f=companionDelivery(),result=Give.give(f.state,f.service,f.input);
  assert.match(result.content,/You give/);assert.match(result.updatedGameConsole,/Inventory: Empty/);
  assert.equal(f.tasks()[0].status,'Completed');assert.equal(f.p.actors['Edrin Farrows'].receivedItems[0].taskBinding,Q.taskBinding(f.tasks()[0]));
  assert.equal(f.roster().find(a=>a.name==='Edrin Farrows').type,'npc');
});

test('ordinary shared-inventory companions cannot receive arbitrary gifts through the quest-only handoff path',()=>{
  for(const mode of ['wrong-item','finished','not-on-sheet','dead','other-room']){
    const f=companionDelivery(),before=f.state.getUpdatedGameConsole();
    if(mode==='wrong-item')f.input='give different item to Edrin Farrows';
    if(mode==='finished')f.tasks()[0].status='Completed';
    if(mode==='not-on-sheet')f.setText(before.replace(I.sectionPattern('NPCs in Party'),(_,h)=>h+' None\n'));
    if(mode==='dead'){const r=f.roster();r.find(a=>a.name==='Edrin Farrows').hp=0;f.state.setCombatCharactersString(JSON.stringify(r));}
    if(mode==='other-room'){const r=f.roster();r.find(a=>a.name==='Edrin Farrows').mazeRoomKey='9,9,0';f.state.setCombatCharactersString(JSON.stringify(r));}
    const text=f.state.getUpdatedGameConsole();Give.give(f.state,f.service,f.input);
    assert.equal(f.state.getUpdatedGameConsole(),text,mode);assert.equal(f.p.actors['Edrin Farrows'].receivedItems?.length||0,0,mode);
  }
});
