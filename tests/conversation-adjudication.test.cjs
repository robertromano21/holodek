'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),F=require('../retort/residentFavors'),A=require('../retort/conversationAdjudication');
const N=require('../retort/holodekNarration'),Work=require('../retort/holodekRoomWork');
function fixtureFrom(file){
  const absolute=path.resolve('tests',file+'.test.cjs'),source=fs.readFileSync(absolute,'utf8');
  return vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\nfixture();',{require:createRequire(absolute)});
}
const input="ask Ilyra what the child's name was and what was done to lay the child to rest after the fever was contained";
const name='Ilyra Venn';
function request({mixed=false}={}){
  const f=fixtureFrom('cotg-starter-recruitment'),old='Vyth Aerir';
  const record=f.p.actors[old];delete f.p.actors[old];f.p.actors[name]={...record,name,sheet:record.sheet.replaceAll(old,name)};
  for(const group of f.p.groups)group.members=group.members.map(n=>n===old?name:n);
  f.p.starterRecruitment.favorActor=name;f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replaceAll(old,name));
  f.state.setCombatCharactersString(JSON.stringify(JSON.parse(f.state.getCombatCharactersString()).map(a=>a.name===old?{...a,name}:a)));
  f.change(db=>{db['0,0,0'].inhabitants=f.p;if(mixed)db['0,0,0'].objects=[{name:'loose ring',type:'other',magic:0}];});
  const option=F.dialogueOptions(f.state,[name],{userInput:'Ask Ilyra Venn to join my party.'})[0];
  const plan={conversation:[{target:'conversation',instruction:'Speak with Ilyra about the unnamed child, sharing a relevant memory or asking a sincere question about the child.',
    exchange:'share_memory',successCriteria:"The player responds directly to Ilyra's concern, sharing a relevant memory or asking a sincere question about the child's identity rather than treating remembrance as resurrection."}]};
  if(mixed)plan.retrieve=[{target:option.candidates.find(c=>c.item==='loose ring').id,instruction:'Give me the loose ring as well.'}];
  F.applyDialogue(f.state,f.service,{speaker:name,recipient:'PC',line:'An honest question about the child would help me remember. Afterward I will join you.',
    socialAction:'offer-favor',playerInvited:true,favorTitle:'Remember the unnamed child',taskPlan:plan},option);
  F.command(f.state,f.service,'accept request from '+name);
  return {...f,mission:()=>Object.values(f.db()['0,0,0'].minorMissions).find(m=>m.type==='resident-favor')};
}
function decisions(f,userInput=input,verdict='fulfilled'){
  const options=F.dialogueOptions(f.state,[name],{userInput}),checks=A.checks(options,[name]);
  return {options,checks,raw:Object.fromEntries(checks.map(row=>[row.key,{verdict,excerpt:verdict==='fulfilled'?userInput:'',
    reason:verdict==='fulfilled'?"The player asks a sincere question about the child's identity, which is an allowed way to fulfill the request.":'The player has not performed the requested exchange.'}]))};
}
async function run(f,{userInput=input,verdict='fulfilled',failResponse=false,beforeCommit,assertResponse}={}){
  const original=Work.request,calls=[],d=decisions(f,userInput,verdict);
  Work.request=async(_$,component,schema,brief,validate)=>{
    calls.push(component);
    if(component==='story-scene'){
      assert.ok(schema.conversationJudgments);assert.match(brief,/independently of speakers/);assert.match(brief,/a relevant question IS performance/);
      return validate({prose:'PREMATURE SETUP: she prepares to answer.',interaction:'conversation',speakers:[],conversationJudgments:d.raw});
    }
    if(component==='npc-live-speech'){
      if(failResponse)throw Error('The response model failed after commitment.');
      assertResponse?.({schema,brief});assert.equal(schema.conversationEvidence,undefined);assert.equal(schema.socialAction,undefined);
      assert.ok(schema.sceneProse);assert.match(brief,/ENGINE-COMMITTED CONVERSATION OUTCOME/);
      return validate({sceneProse:'Ilyra gives your question her full attention, holding the child distinct from the grief.',action:'looks up.',
        line:verdict==='fulfilled'&&!f.mission().conditions.some(c=>c.kind==='retrieve')?'That question is what I hoped you would ask. I will accompany you.':'I hear you. Our remaining work is still unfinished.',
        remember:'',recipient:'PC',attention:'addressing'});
    }
    return validate({lines:['We can carry the memory carefully.','The entrance remains quiet.']});
  };
  try{
    const result=await N.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput,characters:[{name,partyMember:false}],audibleNames:[name],
      localFavors:F.context(f.state,[name]),socialInteractions:d.options,
      onConversationAdjudication:proposal=>{beforeCommit?.();return F.adjudicateConversation(f.state,f.service,proposal);},
      onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null});
    return {result,calls};
  }finally{Work.request=original;}
}
test('the exact fever-and-child question is adjudicated with no selected speakers, committed, then supplied to the final response',async()=>{
  const f=request();let replied=false;
  const {result,calls}=await run(f,{beforeCommit:()=>assert.equal(f.mission().status,'accepted'),assertResponse:({brief})=>{
    replied=true;assert.equal(f.mission().status,'completed');assert.ok(f.mission().recruitedAt);
    assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name===name).type,'npc');
    assert.match(brief,/"status":"completed","recruited":true/);assert.doesNotMatch(brief,/NO PLAYER INVITATION/);
  }});
  assert.ok(replied);assert.match(result.content,/joins the party/);assert.doesNotMatch(result.content,/PREMATURE SETUP/);
  assert.equal(f.mission().completionEvidence[0].playerInput,input);assert.equal(result.socialResults[0].recruited,true);
  assert.deepEqual(calls,['story-scene','npc-live-speech','npc-reply-cache']);
});
test('a semantic negative verdict preserves the accepted task and cannot join by enthusiastic response prose',async()=>{
  const f=request(),{result}=await run(f,{userInput:'I will ask you later.',verdict:'not_fulfilled',assertResponse:()=>assert.equal(f.mission().status,'accepted')});
  assert.equal(f.mission().status,'accepted');assert.equal(f.mission().recruitedAt,undefined);assert.equal(result.socialResults[0].recruited,false);
});
test('adjudication of words cannot satisfy a remaining physical item-transfer condition',async()=>{
  const f=request({mixed:true});await run(f,{assertResponse:({brief})=>{
    assert.equal(f.mission().status,'accepted');assert.equal(f.mission().recruitedAt,undefined);assert.match(brief,/"status":"accepted","recruited":false/);
  }});
  assert.equal(F.assess(f.mission(),f.db()).checks.find(c=>c.id==='conversation').passed,true);assert.equal(F.assess(f.mission(),f.db()).passed,false);
});
test('a failed response after adjudication returns the committed result rather than silently recruiting behind an error',async()=>{
  const f=request(),{result,calls}=await run(f,{failResponse:true});
  assert.equal(f.mission().status,'completed');assert.ok(f.mission().recruitedAt);assert.match(result.content,/joins the party/);
  assert.match(result.content,/result was recorded, but the response could not be generated/);assert.doesNotMatch(result.content,/PREMATURE SETUP/);
  assert.equal(result.socialResults[0].recruited,true);assert.deepEqual(calls,['story-scene','npc-live-speech']);
});
test('adjudication rejects invented evidence, missing verdicts and unsupported outcomes before state changes',()=>{
  const f=request(),d=decisions(f),before=f.state.getRoomNameDatabase(),key=d.checks[0].key;
  for(const raw of [{},{[key]:{verdict:'fulfilled',excerpt:'The player never said this.',reason:'A made-up result.'}},
    {[key]:{verdict:'auto-join',excerpt:input,reason:'Invalid outcome.'}}])assert.throws(()=>A.parse(raw,d.checks,input));
  assert.equal(f.state.getRoomNameDatabase(),before);
});
test('run, room, pause and changed criteria invalidate the staged verdict without awarding recruitment',()=>{
  for(const change of [f=>f.state.getDungeonRunId=()=> 'other',f=>f.state.getLastCoords=()=>({x:1,y:0,z:0}),f=>f.state.getGamePaused=()=>true,
    f=>f.change(db=>Object.values(db['0,0,0'].minorMissions)[0].conditions[0].successCriteria='An explicitly changed criterion.')]){
    const f=request(),d=decisions(f),judgments=A.parse(d.raw,d.checks,input);change(f);
    assert.throws(()=>F.adjudicateConversation(f.state,f.service,{userInput:input,judgments}),/conversation.*changed|request changed/);
    assert.equal(f.mission().status,'accepted');assert.equal(f.mission().recruitedAt,undefined);
  }
});
test('all staged verdicts are preflighted before committing the first valid one',()=>{
  const f=request(),d=decisions(f),judgments=A.parse(d.raw,d.checks,input),bad={...judgments[0],option:{...judgments[0].option,
    conversationMissionId:'other-request',scope:{...judgments[0].option.scope,runId:'stale'}}};
  assert.throws(()=>F.adjudicateConversation(f.state,f.service,{userInput:input,judgments:[...judgments,bad]}),/conversation changed/);
  assert.equal(f.mission().status,'accepted');assert.equal(f.mission().conversationEvidence,undefined);
});
test('the live game turn wires semantic adjudication before the final response',()=>{
  const source=fs.readFileSync('retort/retortWithUserInput.js','utf8');
  assert.match(source,/onConversationAdjudication:.*ResidentFavors\.adjudicateConversation\(sharedState,populationService,judgment\)/);
});
test('real Retort transport commits the structured verdict before authoring the response without adding a model call',async()=>{
  const Host=require('../retort/pcModelHost'),Models=require('../retort/gameModels'),Runtime=require('../retort/gameRetort');
  const f=request(),previous=Models.current().id,requests=[];
  const host=Host.createHost({fetchImpl:async(_url,init)=>{
    const body=JSON.parse(init.body);requests.push(body);const fields=body.response_format.json_schema.schema.properties;let raw;
    if(fields.prose){
      assert.ok(fields.conversationJudgments);
      raw={prose:'A provisional setup before adjudication.',interaction:'conversation',speakers:[],
        conversationJudgments:Object.fromEntries(Object.keys(fields.conversationJudgments.properties).map(key=>[key,
          {verdict:'fulfilled',excerpt:input,reason:'The request explicitly permits a sincere question about the child; the player asked one.'}]))};
    }else if(fields.line){
      assert.ok(f.mission().recruitedAt);assert.ok(fields.sceneProse);assert.equal(fields.socialAction,undefined);
      raw={sceneProse:'Ilyra receives your question as the honest exchange she requested.',action:'looks up.',
        line:'That was what I needed. I will come with you.',remember:'',recipient:'PC',attention:'addressing'};
    }else raw={lines:Array(fields.lines.minItems).fill('I will carry the memory carefully.')};
    return {ok:true,text:async()=>JSON.stringify({model:'holodek-1',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw)}}]})};
  }});
  const runtime=Runtime.createRuntime({models:{...Models,getLocalClient:()=>Host.modelClient(host)},log(){}});Models.restore('holodek-1');
  try{
    const result=await runtime.run(runtime.retort($=>N.generate($,{consoleText:f.state.getUpdatedGameConsole(),userInput:input,
      characters:[{name}],audibleNames:[name],socialInteractions:F.dialogueOptions(f.state,[name],{userInput:input}),localFavors:F.context(f.state,[name]),
      onConversationAdjudication:proposal=>F.adjudicateConversation(f.state,f.service,proposal),location:null})),null,{shouldSaveToLog:false});
    assert.equal(requests.length,3);assert.ok(f.mission().recruitedAt);assert.match(result.content,/joins the party/);
    assert.doesNotMatch(result.content,/provisional setup/);
  }finally{Models.restore(previous);}
});

function ui(){const f=fixtureFrom('resident-recruitment-ui');f.conditional(true);return f;}
function packet(f,m){return{runId:'run-a',geoKey:'1,0,0',recruitmentRequests:[m]};}
for(const status of ['accepted','declined'])test(status+' requests stop intercepting character-sheet clicks and cannot reappear from stale offered packets',()=>{
  const f=ui(),m=f.window.getEconomyResidentInfo(f.actor.name).recruitmentCondition;
  f.window.CommerceUi.receiveResult(packet(f,{...m,status}));
  if(status==='declined')f.window.getEconomyResidentInfo=()=>({kind:'mission',jobs:true,introduced:true});else m.status=status;
  assert.equal(f.window.CombatCharacterUi.open(f.actor),true);assert.equal(f.sheet.style.display,'block');
  assert.ok(f.button('Attack'));assert.ok(f.button('Give Item'));assert.equal(f.button('Accept Request'),undefined);assert.equal(f.button('View Job Offers'),undefined);
  f.window.CommerceUi.receiveResult(packet(f,{...m,status:'offered'}));
  f.document.querySelectorAll('.popup-container').forEach(n=>n.remove());f.sheet.style.display='none';
  assert.equal(f.window.CommerceUi.onFrame(),false);assert.equal(f.button('Accept Request'),undefined);
});
test('Not Now preserves the request but restores normal stats/actions on every later click',()=>{
  const f=ui();assert.equal(f.window.CommerceUi.onFrame(),true);f.button('Not Now').click();
  for(let i=0;i<3;i++){
    assert.equal(f.window.CombatCharacterUi.open(f.actor),true);assert.equal(f.sheet.style.display,'block');assert.ok(f.button('Attack'));
    assert.ok(f.button('Give Item'));assert.ok(f.button('Recruitment Progress'));assert.equal(f.button('Accept Request'),undefined);
  }
  assert.equal(f.requests.length,0);
});
test('accepted request progress remains explicitly available from the ordinary character sheet',async()=>{
  const f=ui(),m=f.window.getEconomyResidentInfo(f.actor.name).recruitmentCondition;m.status='accepted';m.progress='The conversation remains to be completed.';
  f.window.CommerceUi.receiveResult(packet(f,m));f.window.CombatCharacterUi.open(f.actor);await f.button('Recruitment Progress').click();
  assert.ok(f.button('Complete Party Invitation'));assert.equal(f.button('Accept Request'),undefined);assert.equal(f.requests.length,0);
});
test('a dismissed offer does not automatically repeat when its invitation flag changes',()=>{
  const f=ui(),m=f.window.getEconomyResidentInfo(f.actor.name).recruitmentCondition;
  f.window.CommerceUi.onFrame();f.button('Not Now').click();m.invitationPending=!m.invitationPending;
  f.window.CommerceUi.receiveResult(packet(f,m));f.document.querySelectorAll('.popup-container').forEach(n=>n.remove());f.sheet.style.display='none';
  assert.equal(f.window.CommerceUi.onFrame(),false);
});
