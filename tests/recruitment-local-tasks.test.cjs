'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const F=require('../retort/residentFavors'),Plan=require('../retort/residentTaskPlan'),Progress=require('../retort/recruitmentProgress');
const E=require('../retort/economy'),Give=require('../retort/itemTransfer'),I=require('../assets/dungeonInhabitants');
const key='1,0,0',name='Vyth Aerir',farewell='My journal is still here. I must stay and find it. Safe travels.';
function fixture(file='resident-favors'){
  const absolute=require.resolve('./'+file+'.test.cjs'),source=fs.readFileSync(absolute,'utf8');
  return vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\nfixture();',{require:require('node:module').createRequire(absolute)});
}
function bookFixture(){
  const f=fixture();Object.assign(f.p.actors[name],{encounteredAt:1,allegiance:'Friendly',state:'Friendly'});
  f.change(db=>{db[key].inhabitants=f.p;db[key].objects=[{name:'wind journal',type:'other',secretDoorId:'hidden-alcove'}];
    db[key].readables=[{id:'wind',kind:'book',name:'wind journal',chapters:[{title:'Wind',text:'The western wind turns the silver vane.'}]}];});return f;
}
function offer(f,{help=true,research=false,invited=true}={}){
  const option=F.dialogueOptions(f.state,[name],{userInput:invited?'Please join my party.':'How can I help?'})[0];
  const target=option.candidates.find(c=>c.kind==='retrieve'),chapter=option.candidates.find(c=>c.kind==='read');
  return F.applyDialogue(f.state,f.service,{speaker:name,recipient:'PC',socialAction:'offer-favor',playerInvited:invited,
    action:'gestures toward the shelves.',line:'Help me find my journal. I can help you here until we find it.',favorTitle:'The Missing Journal',
    taskPlan:{retrieve:[{target:target.id,instruction:'Find my journal and give it to me.'}],...(research?{read:[{target:chapter.id,instruction:'Read the wind entry before giving me the journal.'}]}:{})},
    joinTiming:help?'help-here':'after-task',departureLine:help?farewell:''},option);
}
const mission=f=>Object.values(f.db()[key].minorMissions || {}).find(m=>m.type==='resident-favor');
const actor=f=>JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name===name);
function accept(f){const result=f.action({kind:'accept-mission',actor:name,missionId:mission(f).id});assert.equal(result.error,undefined,result.error);return result;}
function give(f){f.inventory({name:'wind journal',type:'other'});const result=Give.give(f.state,f.service,'give wind journal to '+name);assert.match(result.content,/You give/);return result;}
function leave(f){
  f.change(db=>db['2,0,0']={name:'Next Room',objects:[],inhabitants:I.createPopulation('2,0,0',[])});
  f.state.getLastCoords=()=>({x:2,y:0,z:0});
  f.state.setUpdatedGameConsole(E.write(f.state.getUpdatedGameConsole(),'Coordinates','X: 2, Y: 0, Z: 0'));
}

test('engine selection distributes physical kinds 45/45/10 and a lone physical kind 90/10',()=>{
  const choices=[{id:'item',kind:'retrieve'},{id:'puzzle',kind:'puzzle'},{id:'talk',kind:'conversation'}],counts={retrieve:0,puzzle:0,conversation:0};
  for(let i=0;i<1000;i++)counts[Plan.select(choices,{random:()=>(i+.5)/1000}).primary]++;
  assert.deepEqual(counts,{retrieve:450,puzzle:450,conversation:100});
  const one={retrieve:0,conversation:0};for(let i=0;i<1000;i++)one[Plan.select(choices.filter(c=>c.kind!=='puzzle'),{random:()=>(i+.5)/1000}).primary]++;
  assert.deepEqual(one,{retrieve:900,conversation:100});
  assert.deepEqual(Plan.select(choices,{seed:'persisted-scope'}),Plan.select(choices,{seed:'persisted-scope'}));
});
test('retrieval selection prefers actual secret-room loot and only permits research from that same book',()=>{
  const choices=[{id:'loose',kind:'retrieve',item:'loose object'},{id:'hidden',kind:'retrieve',secretDoorId:'secret',readableId:'book'},
    {id:'read',kind:'read',readableId:'book'},{id:'wrong',kind:'read',readableId:'other'}];
  const selected=Plan.select(choices,{random:()=>0});assert.deepEqual(selected.choices.map(c=>c.id),['hidden','read']);
  assert.throws(()=>Plan.parse({retrieve:[{target:'hidden',instruction:'Bring the book.'}],read:[{target:'wrong',instruction:'Read another book.'}]},choices,{primary:'retrieve'}),/same actual book/);
});
test('the live response schema permits unused arrays for consent but task validation still enforces the selected primary kind',()=>{
  const choices=[{id:'item',kind:'retrieve'}],schema=Plan.parameter(choices,{primary:'retrieve',optional:true});
  assert.equal(schema.type.retrieve.minItems,0);assert.equal(schema.type.retrieve.maxItems,1);
  assert.throws(()=>Plan.parse({retrieve:[]},choices,{primary:'retrieve'}));
  for(const instruction of ['Observe the item.','No report is needed.'])assert.throws(()=>Plan.parse({retrieve:[{target:'item',instruction}]},choices,{primary:'retrieve'}));
});
test('temporary membership requires an actual invitation and acceptance, and the sheet explains its limits',()=>{
  const f=bookFixture();offer(f);assert.equal(actor(f).type,'monster');assert.equal(mission(f).status,'offered');
  assert.match(mission(f).description,/help here after you accept/);assert.match(mission(f).description,/stay behind/);
  assert.doesNotMatch(mission(f).description,/\b(?:observe|report)\b/i);
  accept(f);assert.equal(actor(f).type,'npc');assert.equal(actor(f).recruitmentLease.source,Progress.SOURCE);
  assert.equal(mission(f).recruitedAt,undefined);assert.ok(mission(f).provisionalJoinedAt);
  assert.equal(Progress.start(f.state,f.service,mission(f)),'');
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').filter(a=>a.name===name).length,1);
  const uninvited=bookFixture();offer(uninvited,{invited:false});accept(uninvited);
  assert.equal(actor(uninvited).type,'monster');assert.equal(mission(uninvited).helperOffer,undefined);
});
test('after-task membership remains a separate option and does not join early',()=>{
  const f=bookFixture();offer(f,{help:false});accept(f);assert.equal(actor(f).type,'monster');assert.equal(mission(f).helperOffer,undefined);
  give(f);Progress.advance(f.state,f.service);assert.equal(actor(f).type,'npc');assert.equal(actor(f).recruitmentLease,undefined);
});
test('a real book task requires reading its content and giving the actual book; the helper then becomes permanent exactly once',()=>{
  const f=bookFixture();offer(f,{research:true});accept(f);const original=actor(f);f.inventory({name:'wind journal',type:'other'});
  assert.match(Give.give(f.state,f.service,'give wind journal to '+name).content,/Read .* before this handoff/);
  assert.equal(f.db()[key].itemTransfers?.length || 0,0);
  assert.equal(Progress.advance(f.state,f.service).length,0);assert.equal(mission(f).status,'accepted');
  const record=f.db()[key].readables[0],Research=require('../retort/bookResearch');
  assert.equal(Research.record(f.state,{allowed:true,inspect:true,record,sourceKey:key,chapter:1}),false);
  assert.equal(F.assess(mission(f),f.db()).passed,false);
  assert.equal(Research.record(f.state,{allowed:true,record,sourceKey:key,chapter:1}),true);
  give(f);const rows=Progress.advance(f.state,f.service);assert.equal(rows.length,1);assert.equal(mission(f).status,'completed');
  assert.ok(mission(f).recruitedAt);assert.equal(actor(f).recruitmentLease,undefined);assert.equal(actor(f).hp,original.hp);
  assert.ok(mission(f).completionEvidence.some(r=>r.source==='engine-give-item-v1'));
  assert.equal(Progress.advance(f.state,f.service).length,0);leave(f);assert.equal(Progress.depart(f.state,f.service).length,0);
  assert.equal(actor(f).type,'npc');
});
test('leaving an unfinished local task restores the same resident at home, keeps their property, and sends one authored farewell',()=>{
  const f=bookFixture();offer(f,{research:true});accept(f);f.inventory({name:'silver ribbon',type:'other'});
  assert.match(Give.give(f.state,f.service,'give silver ribbon to '+name).content,/You give/);const hp=actor(f).hp,stale=f.state.getCombatCharactersString(),staleText=f.state.getUpdatedGameConsole();
  leave(f);const events=[],departures=Progress.depart(f.state,f.service,e=>events.push(e));
  assert.equal(departures.length,1);assert.equal(departures[0].line,farewell);assert.equal(actor(f),undefined);
  const resident=f.db()[key].inhabitants.actors[name];assert.equal(resident.status,'present');assert.equal(resident.hp,hp);
  assert.ok(resident.inventory.some(item=>item.name==='silver ribbon'));assert.equal(resident.position.x,5);assert.equal(resident.position.y,4);
  assert.ok(mission(f).helperDepartedAt);assert.equal(mission(f).status,'accepted');assert.equal(mission(f).recruitedAt,undefined);
  assert.ok(!I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').some(a=>a.name===name));
  assert.equal(events[0].geoKey,key);assert.equal(events[0].dialogue[0].line,farewell);
  assert.equal(Progress.depart(f.state,f.service,e=>events.push(e)).length,0);assert.equal(events.length,1);
  assert.ok(!JSON.parse(F.preserveRoster(f.state,stale)).some(a=>a.name===name&&a.type==='npc'));
  assert.ok(!I.parseSheets(F.preserveConsole(f.state.getUpdatedGameConsole(),staleText,f.db()),'NPCs in Party').some(a=>a.name===name));
});
test('explicitly dismissing a provisional companion leaves the same resident in this room',()=>{
  const f=bookFixture();offer(f);accept(f);const outcome=F.command(f.state,f.service,'remove '+name+' from party');
  assert.match(outcome.content,/stays here/);assert.equal(actor(f).type,'monster');assert.equal(actor(f).recruitmentLease,undefined);
  assert.ok(I.parseSheets(f.state.getUpdatedGameConsole()).some(a=>a.name===name));assert.ok(mission(f).helperDepartedAt);
});
test('stale snapshots cannot remove a legitimate provisional member or erase their departure obligation',()=>{
  const f=bookFixture(),before=f.state.getCombatCharactersString(),text=f.state.getUpdatedGameConsole();offer(f);accept(f);
  const protectedRoster=JSON.parse(F.preserveRoster(f.state,before)).find(a=>a.name===name);
  assert.equal(protectedRoster.type,'npc');assert.equal(protectedRoster.recruitmentLease.source,Progress.SOURCE);
  assert.ok(I.parseSheets(F.preserveConsole(f.state.getUpdatedGameConsole(),text,f.db()),'NPCs in Party').some(a=>a.name===name));
});
test('old-run, dead and permanent companions are not restored as living residents during departure checks',()=>{
  for(const mutate of [f=>{f.state.getDungeonRunId=()=> 'other-run';},f=>{const roster=JSON.parse(f.state.getCombatCharactersString());Object.assign(roster.find(a=>a.name===name),{hp:0,state:'Dead'});f.state.setCombatCharactersString(JSON.stringify(roster));}]){
    const f=bookFixture();offer(f);accept(f);mutate(f);leave(f);assert.equal(Progress.depart(f.state,f.service).length,0);assert.equal(actor(f).type,'npc');
  }
});
test('a helper stays on the original host-local floor rather than being restored on the street or another floor',()=>{
  const f=bookFixture(),ref={hostKey:key,buildingId:'library',floor:1};f.change(db=>db[key].cityFloorContext=ref);offer(f);accept(f);
  f.change(db=>{const saved=structuredClone(db[key]);delete saved.cityFloorContext;
    db[key].cityFloors={buildings:{library:{floors:{1:{room:saved,population:saved.inhabitants}}}}};
    db[key].cityFloorContext={...ref,floor:2};db[key].minorMissions={};db[key].inhabitants=I.createPopulation(key,[]);});
  assert.equal(Progress.depart(f.state,f.service).length,1);
  const room=f.db()[key],saved=room.cityFloors.buildings.library.floors[1];assert.equal(saved.room.inhabitants.actors[name].status,'present');
  assert.equal(saved.population.actors[name].status,'present');assert.equal(room.inhabitants.actors[name],undefined);
  assert.equal(saved.residents.filter(a=>a.name===name).length,1);assert.equal(saved.residents.find(a=>a.name===name).type,'monster');
});
test('an absent origin fails explicitly without discarding the character',()=>{
  const f=bookFixture();offer(f);accept(f);leave(f);f.change(db=>delete db[key].minorMissions);
  assert.throws(()=>Progress.depart(f.state,f.service),/no character was discarded/);assert.equal(actor(f).type,'npc');
});
test('completed physical work reaches the existing authored acknowledgment pipeline without another completion click',async()=>{
  const f=bookFixture();offer(f,{help:false});accept(f);give(f);
  const H=require('../retort/recruitmentHandoff'),prior=H.complete;let calls=0;
  H.complete=async options=>{calls++;assert.equal(options.result.recruitmentHandoff.missionId,mission(f).id);assert.ok(mission(f).recruitedAt);
    return {...options.result,content:'The work is finished. I am coming with you.',dialogue:[{speaker:name,line:'I am coming with you.'}],handoffStatus:'delivered'};};
  try{const result=await Progress.response(f.state,f.service,{content:'You give the journal.',dialogue:[]});assert.equal(calls,1);assert.equal(result.dialogue[0].speaker,name);
    await Progress.response(f.state,f.service,{content:'Next action.'});assert.equal(calls,1);
  }finally{H.complete=prior;}
});
test('rescue contact recruitment is available outside the starter room and does not bypass actual rescue stages',()=>{
  const f=fixture('regional-adventure'),stage=f.state.getCurrentTasks()[0].story.stages.find(s=>s.id==='hook');
  assert.ok(stage.options.some(o=>o.id==='join-rescue'));assert.equal(f.choose('join-rescue').error,undefined);
  assert.ok(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').some(a=>a.name==='Edrin Farrows'));
  assert.equal(require('../retort/questScenes').runtime(f.state.getCurrentTasks()[0],f.db()).stage,'investigation');
  const source=fs.readFileSync('retort/regionalAdventure.js','utf8');assert.match(source,/!require\('\.\.\/assets\/economyRules'\).isStarterRoom\(origin/);
});
