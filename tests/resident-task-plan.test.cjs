'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),Plan=require('../retort/residentTaskPlan'),F=require('../retort/residentFavors'),I=require('../assets/dungeonInhabitants');
function fixture(file='cotg-starter-recruitment'){
  const absolute=path.resolve('tests',file+'.test.cjs'),source=fs.readFileSync(absolute,'utf8');
  return vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\nfixture();',{require:createRequire(absolute)});
}
const roomKey='0,0,0',resident='Vyth Aerir',input='Ask Vyth Aerir to join my party.';
const choices=[{id:'survey',kind:'survey',roomKey},
  {id:'conversation',kind:'conversation',participant:resident,roomKey},
  {id:'retrieve:ring',kind:'retrieve',item:'an existing ring',roomKey},
  {id:'read:record:1',kind:'read',readableId:'record',item:'an existing record',chapter:1,roomKey},
  {id:'puzzle:existing',kind:'puzzle',mechanismId:'existing',roomKey},
  {id:'defeat:existing',kind:'defeat',target:'Existing Hostile',roomKey},
  {id:'survey:worker',kind:'survey',target:'Existing Worker',activity:'tends an existing lamp',roomKey}];
function row(kind,target){return {target,instruction:'A complete instruction authored for this particular request.',
  ...(kind==='conversation'?{exchange:'explain',successCriteria:'The player explains their own intended next action.'}:{}),
  ...(kind==='survey'?{observationCount:'3',observationInterval:'1'}:{})};}
function prepareRoom(f){
  f.p.actors[resident].activity='Tends the existing threshold.';
  f.change(db=>{
    db[roomKey].inhabitants=f.p;
    db[roomKey].objects=[{name:'loose brass ring',type:'other',attack_modifier:0,damage_modifier:0,ac:0},
      {name:'protected artifact',quest_artifact:true,type:'other'}];
    db[roomKey].readables=[{id:'book',kind:'book',name:'existing journal',title:'The Existing Journal',chapters:[{title:'An entry',text:'This is the actual stored entry.'}]}];
    db[roomKey].inscriptions=[{id:'basin',kind:'inscription',name:'basin inscription',title:'The Basin Inscription',chapters:[{title:'Inscription',text:'The actual words cut into the stone.'}]}];
  });return f;
}
function propose(f,taskPlan){
  const option=F.dialogueOptions(f.state,[resident],{userInput:input})[0];
  return F.applyDialogue(f.state,f.service,{speaker:resident,recipient:'PC',line:'Here is the help I would like before joining you.',socialAction:'offer-favor',
    playerInvited:true,favorTitle:'An Authored Request',taskPlan},option);
}
const mission=f=>Object.values(f.db()[roomKey].minorMissions || {}).find(m=>m.type==='resident-favor');

test('Retort task kinds contain separate target enums, never an unbound generic survey or observation fields on other kinds',()=>{
  const schema=Plan.parameter(choices).type;
  assert.deepEqual(Object.keys(schema),Plan.KINDS);
  for(const kind of Plan.KINDS){
    const fields=schema[kind].type[0].type,expected=choices.filter(c=>c.kind===kind&&c.id!=='survey').map(c=>c.id);
    assert.deepEqual(fields.target.enum,expected);assert.equal(fields.observationCount,undefined);
    assert.equal(fields.observationInterval,undefined);assert.equal(fields.instruction.maxLength,undefined);
  }
  assert.deepEqual(schema.conversation.type[0].type.exchange.enum,Plan.EXCHANGES);
  assert.equal(schema.survey,undefined);
});
for(const kind of Plan.KINDS)test('an authored '+kind+' condition compiles to its own supported mechanism and canonical target',()=>{
  const bound=choices.find(c=>c.kind===kind&&c.id!=='survey'),instruction='This is a unique '+kind+' request.';
  const result=Plan.parse({[kind]:[{...row(kind,bound.id),instruction}]},choices)[0];
  assert.equal(result.kind,kind);assert.equal(result.id,bound.id);assert.equal(result.roomKey,roomKey);assert.equal(result.instruction,instruction);
  assert.equal(result.planVersion,1);assert.equal(result.observations,kind==='survey'?3:undefined);
});
test('kind/target mismatches, fabricated targets, duplicate conditions, blank plans and missing criteria are rejected without defaults',()=>{
  for(const plan of [{conversation:[row('conversation','retrieve:ring')]},{retrieve:[row('retrieve','made-up')]},
    {retrieve:[row('retrieve','retrieve:ring'),row('retrieve','retrieve:ring')]},{conversation:[]},
    {conversation:[{target:'conversation',instruction:'Say something.'}]},
    {survey:[{target:'survey:worker',instruction:'Watch an actual activity.'}]},
    {survey:[row('survey','survey')]}])assert.throws(()=>Plan.parse(plan,choices));
});
test('different conditions retain independent authored instructions and criteria without a shared focus template',()=>{
  const result=Plan.parse({retrieve:[{...row('retrieve','retrieve:ring'),instruction:'Bring the existing ring.'}],
    conversation:[{...row('conversation','conversation'),instruction:'Explain your intended route.',successCriteria:'The player describes one intended destination.'}]},choices);
  assert.equal(result.find(c=>c.kind==='retrieve').instruction,'Bring the existing ring.');
  assert.equal(result.find(c=>c.kind==='conversation').successCriteria,'The player describes one intended destination.');
  assert.ok(result.every(c=>c.observations===undefined));
});
test('task authoring retains complete text without adding character limits',()=>{
  const instruction='An authored instruction. '.repeat(1000),result=Plan.parse({retrieve:[{...row('retrieve','retrieve:ring'),instruction}]},choices);
  assert.equal(result[0].instruction,instruction.trim());
});
test('the current-room catalog binds real item and readable targets, excludes protected objects, and watches an actual known activity',()=>{
  const f=prepareRoom(fixture()),available=Plan.catalog(F.dialogueOptions(f.state,[resident],{userInput:input})[0].candidates);
  assert.deepEqual(Array.from(available.read,c=>c.readableId),['book','basin']);
  assert.deepEqual(Array.from(available.retrieve,c=>c.item),['loose brass ring']);
  assert.equal(available.survey,undefined);
  assert.ok(Object.values(available).flat().every(c=>c.roomKey===roomKey));
});
test('a newly authored spoken request displays its own instructions and carries adjudication criteria instead of generic observe/report steps',()=>{
  const f=fixture();propose(f,{conversation:[{target:'conversation',instruction:'Tell me what draws you beyond this entrance.',exchange:'explain',
    successCriteria:'The player states a personal reason for continuing their journey.'}]});
  const m=mission(f);assert.equal(m.status,'offered');assert.equal(m.objective.kind,'conversation');
  assert.match(m.description,/Tell me what draws you/);assert.doesNotMatch(m.description,/Observe |game actions apart|observe for|report to/);
  const next=F.dialogueOptions(f.state,[resident],{userInput:'I want to find out who is waiting beyond the entrance.'})[0];
  assert.equal(next.conversationConditions[0].successCriteria,m.objective.successCriteria);
});
test('reading tasks verify actual stored chapters and inscriptions, never claims, cover inspection or changed content',()=>{
  for(const [id,collection]of [['book','readables'],['basin','inscriptions']]){
    const f=prepareRoom(fixture()),book=f.db()[roomKey][collection][0];
    propose(f,{read:[{target:'read:'+id+':1',instruction:'Read the existing words, then tell me when you are done.'}]});
    F.command(f.state,f.service,'accept request from '+resident);assert.equal(F.assess(mission(f),f.db()).passed,false);
    const Research=require('../retort/bookResearch');
    assert.equal(Research.record(f.state,{allowed:true,inspect:true,record:book,sourceKey:roomKey,chapter:1}),false);
    assert.equal(F.assess(mission(f),f.db()).passed,false);
    assert.equal(Research.record(f.state,{allowed:true,inspect:false,record:book,sourceKey:roomKey,chapter:1}),true);
    assert.equal(F.assess(mission(f),f.db()).passed,true);
    const changed=f.db();changed[roomKey][collection][0].chapters[0].text='A changed chapter.';assert.equal(F.assess(mission(f),changed).passed,false);
    assert.match(F.command(f.state,f.service,'report to '+resident).content,/completed/);assert.ok(mission(f).recruitedAt);
  }
});
test('empty or already-read chapters never become new reading tasks',()=>{
  const f=prepareRoom(fixture()),book=f.db()[roomKey].readables[0];
  f.change(db=>db[roomKey].readables.push({id:'empty',name:'empty book',kind:'book',chapters:[{title:'Empty',text:''}]}));
  require('../retort/bookResearch').record(f.state,{allowed:true,inspect:false,record:book,sourceKey:roomKey,chapter:1});
  const reads=Plan.catalog(F.dialogueOptions(f.state,[resident],{userInput:input})[0].candidates).read;
  assert.ok(reads.every(c=>c.readableId!=='empty'&&c.readableId!=='book'));assert.ok(reads.some(c=>c.readableId==='basin'));
});
test('typed retrieval is accomplished with the real item-transfer receipt, not an observation counter or a spoken claim',()=>{
  const f=prepareRoom(fixture()),target=F.dialogueOptions(f.state,[resident],{userInput:input})[0].candidates.find(c=>c.item==='loose brass ring');
  propose(f,{retrieve:[{target:target.id,instruction:'Bring me the loose brass ring.'}]});F.command(f.state,f.service,'accept request from '+resident);
  assert.equal(F.assess(mission(f),f.db()).passed,false);assert.equal(mission(f).objective.observations,undefined);
  f.inventory({name:'loose brass ring',type:'other',magic:0,attack_modifier:0,damage_modifier:0,ac:0});
  const transfer=require('../retort/itemTransfer').give(f.state,f.service,'give loose brass ring to '+resident);assert.match(transfer.content,/You give/);
  assert.equal(F.assess(mission(f),f.db()).passed,true);assert.match(F.command(f.state,f.service,'report to '+resident).content,/completed/);
  assert.ok(mission(f).recruitedAt);assert.doesNotMatch(mission(f).description,/observe for|Observe |game actions/);
});
test('timed watching is absent from candidate enums and commands cannot manufacture progress',()=>{
  const f=prepareRoom(fixture()),available=F.dialogueOptions(f.state,[resident],{userInput:input})[0].candidates;
  assert.ok(available.every(c=>c.kind!=='survey'));
  assert.throws(()=>propose(f,{survey:[row('survey','survey:worker')]}),/no supported target/);
  assert.equal(F.command(f.state,f.service,'observe for '+resident),null);
  assert.equal(mission(f),undefined);
});
test('legacy timed requests are explicitly withdrawn without free completion or procedural replacement prose',()=>{
  const f=fixture();f.change(db=>db[roomKey].minorMissions={legacy:{id:'legacy',source:F.SOURCE,type:'resident-favor',runId:'test-run',roomKey,floor:'street',
    recipient:resident,status:'accepted',title:'Saved Request',objective:{id:'survey',kind:'survey'},description:'Observe twice, then report.'}});
  const notices=require('../retort/economy').refresh(f.state).notices,m=mission(f);
  assert.equal(m.status,'withdrawn');assert.equal(m.retiredTask,true);assert.equal(m.rewardReceiptId,undefined);
  assert.ok(notices.some(n=>n.includes('withdrawn')));assert.equal(F.presentation(f.state).length,0);
  assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name===resident).type,'monster');
});
test('the actual NPC response pipeline exposes typed targets in the same call and commits an accomplishable LLM-authored request',async()=>{
  const f=prepareRoom(fixture()),N=require('../retort/holodekNarration'),Work=require('../retort/holodekRoomWork'),prior=Work.request,calls=[];
  f.change(db=>db[roomKey].objects=[]);
  Work.request=async(_$,component,schema,brief,validate)=>{
    calls.push(component);
    if(component==='story-scene')return validate({prose:'The resident listens to your invitation.',interaction:'recruitment',speakers:[resident]});
    if(component==='npc-live-speech'){
      assert.ok(schema.taskPlan.type.read);assert.equal(schema.conditions,undefined);assert.equal(schema.favorFocus,undefined);
      assert.doesNotMatch(JSON.stringify(schema.taskPlan),/"enum":\["survey"/);assert.match(brief,/TYPED TASK PLAN/);
      return validate({action:'gestures toward the inscription.',line:'Read the existing inscription. After you report back, I will come with you.',
        remember:'',recipient:'PC',attention:'addressing',socialAction:'offer-favor',playerInvited:true,favorTitle:'The Existing Words',
        taskPlan:{read:[{target:'read:basin:1',instruction:'Read the words preserved on the basin inscription.'}]}});
    }
    return validate({lines:['The inscription is still there.','I am tending the entrance.']});
  };
  try{
    const result=await N.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput:input,characters:[{name:resident}],audibleNames:[resident],
      socialInteractions:F.dialogueOptions(f.state,[resident],{userInput:input}),onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null});
    assert.equal(mission(f).objective.kind,'read');assert.equal(mission(f).objective.readableId,'basin');assert.equal(mission(f).status,'offered');
    assert.match(result.content,/Read the words preserved/);assert.equal(calls.filter(c=>c==='npc-live-speech').length,1);
  }finally{Work.request=prior;}
});
test('real Retort JSON-schema transport authors a typed conversational task with no retries or extra planning call',async()=>{
  const Host=require('../retort/pcModelHost'),Models=require('../retort/gameModels'),Runtime=require('../retort/gameRetort'),N=require('../retort/holodekNarration');
  const f=fixture('resident-favors'),previous=Models.current().id,requests=[];
  f.change(db=>db['1,0,0'].objects=[]);
  Object.assign(f.p.actors[resident],{encounteredAt:1,allegiance:'Friendly',state:'Friendly'});f.change(db=>db['1,0,0'].inhabitants=f.p);
  const host=Host.createHost({fetchImpl:async(_url,init)=>{
    const body=JSON.parse(init.body);requests.push(body);const fields=body.response_format.json_schema.schema.properties;
    let raw;
    if(fields.prose)raw={prose:'The resident listens to your invitation.',interaction:'recruitment',speakers:[resident]};
    else if(fields.line){
      const taskPlan=Object.fromEntries(Object.keys(fields.taskPlan.properties).map(kind=>[kind,[]]));
      taskPlan.conversation=[{target:'conversation',instruction:'Tell me what you hope to find on your journey.',exchange:'explain',successCriteria:'The player states one personal hope for their journey.'}];
      raw={action:'turns toward you.',line:'Tell me what you hope to find on your journey. Then I will come with you.',remember:'',recipient:'PC',attention:'question',
        socialAction:'offer-favor',playerInvited:true,favorTitle:'A Shared Direction',taskPlan};
    }else raw={lines:Array(fields.lines.minItems).fill('The way ahead is still open.')};
    return {ok:true,text:async()=>JSON.stringify({model:'holodek-1',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw)}}]})};
  }});
  const runtime=Runtime.createRuntime({models:{...Models,getLocalClient:()=>Host.modelClient(host)},log(){}});Models.restore('holodek-1');
  try{
    const result=await runtime.run(runtime.retort($=>N.generate($,{consoleText:f.state.getUpdatedGameConsole(),userInput:input,
      characters:[{name:resident}],audibleNames:[resident],socialInteractions:F.dialogueOptions(f.state,[resident],{userInput:input}),
      onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null})),null,{shouldSaveToLog:false});
    const saved=Object.values(f.db()['1,0,0'].minorMissions).find(m=>m.type==='resident-favor');
    assert.equal(saved.objective.kind,'conversation');assert.equal(saved.objective.planVersion,1);assert.equal(saved.status,'offered');
    assert.equal(saved.objective.observations,undefined);assert.match(result.content,/Tell me what you hope/);assert.equal(requests.length,3);
  }finally{Models.restore(previous);}
});
