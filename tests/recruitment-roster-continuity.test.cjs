'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),F=require('../retort/residentFavors'),G=require('../retort/recruitmentGroups');
const Progress=require('../retort/recruitmentProgress'),E=require('../retort/economy'),I=require('../assets/dungeonInhabitants');
function fixture(){
  const file=require.resolve('./group-recruitment.test.cjs'),source=fs.readFileSync(file,'utf8');
  const f=vm.runInNewContext(source.slice(0,source.indexOf("\ntest('"))+'\nfixture();',
    {require:createRequire(file),__dirname:require('node:path').dirname(file),console,structuredClone});
  const options=f.options();
  const first=options[0],target=first.candidates.find(c=>c.kind==='retrieve');
  assert.ok(target);
  F.applyDialogue(f.state,f.service,{speaker:first.name,recipient:'PC',line:'Return my ribbon; I can help you find it here.',
    socialAction:'offer-favor',playerInvited:true,favorTitle:'The Missing Ribbon',joinTiming:'help-here',
    departureLine:'I must stay to find my ribbon.',taskPlan:{retrieve:[{target:target.id,instruction:'Find my ribbon and give it to me.'}]}},first);
  F.applyDialogue(f.state,f.service,{speaker:options[1].name,recipient:'PC',line:'Tell me why you want to help before I travel with you.',
    socialAction:'offer-favor',playerInvited:true,favorTitle:'A Sincere Answer',joinTiming:'after-task',
    taskPlan:{conversation:[{target:'conversation',instruction:'Explain your purpose to me.',exchange:'explain',successCriteria:'The player gives a concrete reason for helping.'}]}},options[1]);
  const accepted=F.command(f.state,f.service,'accept request from '+f.first);assert.doesNotMatch(accepted.content,/unavailable|changed/);
  const task=()=>f.missions().find(m=>m.recipient===f.first);
  assert.equal(actor(f,f.first).type,'npc');assert.ok(actor(f,f.first).recruitmentLease);
  return {...f,task};
}
const actor=(f,name)=>JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name===name);
function completeFirst(f){
  f.change(db=>{const m=db[f.d.geoKey].minorMissions[f.task().id];m.status='completed';m.rewardReceiptId='verified-ribbon';
    m.completionEvidence=[{source:'engine-give-item-v1',item:m.objective.item}];});
}
function completeSecond(f){
  const input='I want to protect the people we meet.',option=F.dialogueOptions(f.state,[f.mate],{userInput:input})[0];
  return F.applyDialogue(f.state,f.service,{speaker:f.mate,recipient:'PC',line:'Then I will travel with you.',
    socialAction:'fulfill-conversation',playerInvited:false,conversationEvidence:[{conditionId:'conversation',excerpt:input}]},option);
}
function stale(f){
  const roster=JSON.parse(f.state.getCombatCharactersString()).filter(a=>a.name!==f.first);
  const text=f.state.getUpdatedGameConsole().replace(I.sectionPattern('NPCs in Party'),(_,head,body)=>{
    const row=I.parseBlocks(body).find(a=>a.name===f.first);return head+'\n'+(row?body.replace(row.rawSheet,'').trim()||'None':body)+'\n';});
  return {roster:JSON.stringify(roster),text};
}
function sync(f,snapshot){
  const text=E.preserveInventory(f.state.getUpdatedGameConsole(),snapshot.text,f.state.getRoomNameDatabase());
  const roster=E.preserveFavorRoster(f.state,snapshot.roster);
  f.state.setUpdatedGameConsole(text);f.state.setCombatCharactersString(roster);
}

test('a completed local helper remains protected while the other group condition is pending',()=>{
  const f=fixture();completeFirst(f);assert.equal(G.ready(f.group(),f.db()),false);
  assert.ok(F.recruitedNames(f.db()).has(f.first.toLowerCase()));
  sync(f,stale(f));assert.equal(actor(f,f.first)?.type,'npc');
  assert.ok(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').some(a=>a.name===f.first));
  assert.ok(actor(f,f.first).recruitmentLease);assert.equal(f.task().recruitedAt,undefined);
});

test('finishing the second condition makes the existing helper permanent before admitting the next member',()=>{
  const f=fixture();completeFirst(f);const original=actor(f,f.first);completeSecond(f);
  assert.ok(f.missions().every(m=>m.status==='completed'&&m.recruitedAt));
  assert.equal(actor(f,f.first).recruitmentLease,undefined);
  assert.equal(actor(f,f.first).hp,original.hp);
  assert.equal(actor(f,f.mate).type,'npc');
  sync(f,stale(f));assert.equal(actor(f,f.first)?.type,'npc');
  assert.ok(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').some(a=>a.name===f.first));
  assert.equal(Progress.advance(f.state,f.service).length,0);
  f.state.getLastCoords=()=>({x:2,y:0,z:0});assert.equal(Progress.depart(f.state,f.service).length,0);
  assert.equal(actor(f,f.first).type,'npc');
});

test('a stale temporary lease cannot be reattached after the companion is permanently recruited',()=>{
  const f=fixture(),before=f.state.getCombatCharactersString();completeFirst(f);completeSecond(f);Progress.advance(f.state,f.service);
  const next=JSON.parse(F.preserveRoster(f.state,before)),row=next.find(a=>a.name===f.first);
  assert.equal(row.type,'npc');assert.equal(row.recruitmentLease,undefined);
  assert.equal(next.filter(a=>a.name===f.first).length,1);
});

test('a temporary companion whose task was already completed is still removed when explicitly leaving an unfinished group request',()=>{
  const f=fixture();completeFirst(f);const old=f.state.getCombatCharactersString();
  f.state.getLastCoords=()=>({x:2,y:0,z:0});assert.equal(Progress.depart(f.state,f.service).length,1);
  assert.equal(actor(f,f.first),undefined);assert.ok(f.task().helperDepartedAt);assert.equal(f.task().recruitedAt,undefined);
  assert.ok(!JSON.parse(F.preserveRoster(f.state,old)).some(a=>a.name===f.first&&a.type==='npc'));
});

test('finalization preserves identity, equipment, damage, appearance and preexisting party members',()=>{
  const f=fixture(),roster=JSON.parse(f.state.getCombatCharactersString()),first=roster.find(a=>a.name===f.first);
  Object.assign(first,{hp:7,sprite:{spec:{seed:'kept-appearance'}},originProfile:{race:'Original spirit'},equipped:{weapon:{name:'Kept blade'}}});
  f.state.setCombatCharactersString(JSON.stringify(roster));const before=actor(f,f.first);completeFirst(f);completeSecond(f);
  const {recruitmentLease,...original}=before;assert.deepEqual(actor(f,f.first),original);
  assert.deepEqual(JSON.parse(f.state.getCombatCharactersString()).filter(a=>a.type==='npc').map(a=>a.name).sort(),
    ['Ally',f.first,f.mate].sort());
  assert.equal(Progress.finalize(f.state).length,0);
});

test('stale game, floor, missing group and departed helper proofs cannot finalize an unrelated membership',()=>{
  for(const mutate of [
    f=>{f.state.getDungeonRunId=()=> 'other-run';},
    f=>f.change(db=>db[f.d.geoKey].cityFloorContext={hostKey:f.d.geoKey,buildingId:'inn',floor:2}),
    f=>f.change(db=>delete db[f.d.geoKey].recruitmentInvitations),
    f=>f.change(db=>db[f.d.geoKey].minorMissions[f.task().id].helperDepartedAt=1),
    f=>f.change(db=>db[f.d.geoKey].minorMissions[f.task().id].recipient=f.mate)
  ]){
    const f=fixture();completeFirst(f);
    f.change(db=>{const m=Object.values(db[f.d.geoKey].minorMissions).find(m=>m.recipient===f.mate);m.status='completed';m.rewardReceiptId='verified-answer';});
    mutate(f);assert.equal(Progress.finalize(f.state).length,0);assert.ok(actor(f,f.first).recruitmentLease);
    assert.equal(f.task()?.recruitedAt,undefined);
  }
});

test('a saved completed helper remains protected after the request and roster are serialized between conditions',()=>{
  const f=fixture();completeFirst(f);const before=f.task(),packet=stale(f);
  f.state.setRoomNameDatabase(JSON.stringify(JSON.parse(f.state.getRoomNameDatabase())));
  f.state.setCombatCharactersString(JSON.stringify(JSON.parse(f.state.getCombatCharactersString())));
  sync(f,packet);assert.equal(actor(f,f.first)?.type,'npc');assert.deepEqual(f.task(),before);
  completeSecond(f);assert.ok(f.task().recruitedAt);assert.equal(actor(f,f.first).recruitmentLease,undefined);
  assert.equal(f.task().rewardReceiptId,before.rewardReceiptId);
});
