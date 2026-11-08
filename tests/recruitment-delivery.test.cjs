'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path'),{createRequire}=require('node:module');
function fixtureFrom(file,expression){
  const absolute=path.resolve('tests',file+'.test.cjs'),source=fs.readFileSync(absolute,'utf8');
  return vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\n'+expression,
    {require:createRequire(absolute),console});
}
function commerce(){
  const f=fixtureFrom('commerce-ui','fixture();'),d=f.window.currentDungeon;d.geoKey='0,0,0';
  const actor={name:'Ilyra Veilstep',type:'monster',hp:43,state:'Friendly',mazeRoomKey:d.geoKey,mazeX:45,mazeY:4};
  const mission={id:'saved-request',source:'engine-resident-favor-v1',type:'resident-favor',runId:'run',roomKey:d.geoKey,floor:'street',
    recipient:actor.name,title:'A Grounded Request',description:'Solve the existing threshold puzzle. I will join afterward.',
    status:'offered',starterRecruitment:true,invitationPending:true};
  f.window.getDungeonLifeContext=()=>({dungeon:d,player:{x:4.5,y:4.5},actors:[actor]});
  f.window.getEconomyResidentInfo=()=>({kind:'mission',introduced:true,recruitmentCondition:mission});
  const event=()=>({runId:'run',geoKey:d.geoKey,recruitmentRequests:[structuredClone(mission)]});
  return{...f,actor,mission,event};
}
test('a saved starter invitation opens without a redundant top-level business marker',()=>{
  const f=commerce();assert.equal(f.window.CommerceUi.invite(f.actor.name),true);
  assert.ok(f.button('Accept Request'));assert.equal(f.requests.length,0);assert.equal(f.mission.status,'offered');
});
test('a compact encounter packet repairs an older metadata pointer and the character-sheet button',async()=>{
  const f=commerce();f.window.getEconomyResidentInfo=()=>({recruitmentCondition:{missionId:f.mission.id}});
  f.window.CommerceUi.receiveResult(f.event());const actions=f.document.createElement('div');f.body.appendChild(actions);
  f.window.CommerceUi.addAction(actions,f.actor.name);await f.button('Recruitment Invitation').click();
  assert.ok(f.button('Accept Request'));assert.equal(f.requests.length,0);
});
test('an unresolved saved pointer requests the authoritative view without triggering another encounter',async()=>{
  const f=commerce();f.window.getEconomyResidentInfo=()=>({introduced:false,recruitmentCondition:{missionId:f.mission.id}});
  f.hook(async()=>({ok:true,json:async()=>({revision:1,missions:[f.mission]})}));
  assert.equal(await f.window.CommerceUi.open(f.actor.name),true);assert.ok(f.button('Accept Request'));
  assert.deepEqual(Array.from(f.requests,r=>r.path),['/economy/view']);
});
test('the invitation popup follows the whole live exchange, not only the offerer or a reply-attention hold',()=>{
  const f=commerce();let pending=true,otherPending=true;
  f.window.getEconomyResidentInfo=()=>null;
  f.window.DungeonLife={hasPendingSpeech:()=>true,hasPendingTurnSpeech:name=>name?name===f.actor.name&&pending:pending||otherPending};
  f.window.CommerceUi.receiveResult({...f.event(),dialogue:[{speaker:f.actor.name,line:'Please examine the threshold before I join.'}]});
  assert.equal(f.window.CommerceUi.onFrame(),false);assert.equal(f.button('Accept Request'),undefined);
  f.window.CommerceUi.dialogueQueued({...f.event(),speakers:['Other Resident']});
  assert.equal(f.window.CommerceUi.onFrame(),false);
  f.window.CommerceUi.dialogueQueued({...f.event(),speakers:[f.actor.name]});
  assert.equal(f.window.CommerceUi.onFrame(),false);
  pending=false;assert.equal(f.window.CommerceUi.onFrame(),false);assert.equal(f.button('Accept Request'),undefined);
  otherPending=false;assert.equal(f.window.CommerceUi.onFrame(),true);assert.ok(f.button('Accept Request'));
  assert.equal(f.mission.status,'offered');assert.equal(f.requests.length,0);
});
test('an invisible retained sheet cannot block a saved request and room keys use the shared normalizer',()=>{
  const f=commerce(),hidden=f.document.createElement('div');hidden.className='popup-container';hidden.style.display='none';f.body.appendChild(hidden);
  f.actor.mazeRoomKey='0, 0, 0';f.window.DungeonInhabitants=require('../assets/dungeonInhabitants');
  assert.equal(f.window.CommerceUi.onFrame(),true);assert.ok(f.button('Accept Request'));
});
test('compact descriptors preserve run, room, floor and starter exclusions',()=>{
  for(const change of [m=>m.runId='wrong',m=>m.roomKey='1,0,0',m=>m.floor='upper',m=>m.starterRecruitment=false]){
    const f=commerce();change(f.mission);f.window.CommerceUi.receiveResult(f.event());
    assert.equal(f.window.CommerceUi.onFrame(),false);assert.equal(f.button('Accept Request'),undefined);
  }
});
test('diagnostic retries are deduplicated and retain a bounded history',()=>{
  const f=commerce();f.window.CommerceUi.receiveResult(f.event());f.window.GameCommandGate={busy:()=>true};
  for(let i=0;i<50;i++)f.window.CommerceUi.onFrame();
  assert.equal(f.window.CommerceUi.diagnostics().filter(row=>row.reason==='action-busy').length,1);
  for(let i=0;i<100;i++)f.window.CommerceUi.receiveResult({...f.event(),recruitmentRequests:[{...f.mission,id:'request-'+i}]});
  assert.equal(f.window.CommerceUi.diagnostics().length,64);
});
test('a finished arrival no longer leaves automatic invitations blocked',()=>{
  const window={dungeonRunId:'run',requestAnimationFrame:fn=>fn()};
  vm.runInNewContext(fs.readFileSync('assets/roomEntry.js','utf8'),{window,Date,console});
  window.RoomEntry.begin('0,0,0','1,0,0');assert.equal(window.RoomEntry.isPending(),true);
  window.RoomEntry.shown({geoKey:'wrong'});assert.equal(window.RoomEntry.isPending(),true);
  window.RoomEntry.shown({geoKey:'1,0,0'});assert.equal(window.RoomEntry.isPending(),false);
});
test('recruitment diagnostics accept current scoped fields only and do not mutate game state',()=>{
  const D=require('../retort/recruitmentDiagnostics'),state={getDungeonRunId:()=> 'run',getLastCoords:()=>({x:0,y:0,z:0})};
  const row={version:'recruitment-delivery-1',phase:'shown',reason:'',actor:'Ilyra',requestId:'saved',floor:'street',runId:'run',geoKey:'0,0,0',at:1000,untrusted:'discard'};
  const result=D.record(state,row);assert.equal(result.phase,'shown');assert.equal(result.untrusted,undefined);
  for(const changes of [{runId:'other'},{geoKey:'1,0,0'},{phase:'accept-mission'},{at:'invalid'},{actor:{}}])assert.equal(D.record(state,{...row,...changes}),null);
});
test('labelled speech is authoritative and engine command quotations never become the resident voice',()=>{
  const f=fixtureFrom('subtitle-diagnostics','fixture();'),queued=[];
  f.root.CommerceUi={dialogueQueued:event=>queued.push(event)};
  f.root.DungeonLife.receiveTurnDialogue('The request says use "observe for Ilyra Veilstep", then "report to Ilyra Veilstep".',
    {...f.event,dialogue:[{speaker:f.actor.name,line:'Please examine the threshold, then report to me.',attribution:'labelled'}]});
  for(let i=0;i<4;i++){f.advance(20000);f.root.DungeonLife.tick();}
  assert.equal(f.reports.filter(r=>r.stage==='displayed').map(r=>r.line).join(' '),'Please examine the threshold, then report to me.');
  assert.ok(queued.some(e=>e.speakers.includes(f.actor.name)));
});
test('pending-turn detection distinguishes live reply speech from canned chatter',()=>{
  const f=fixtureFrom('subtitle-diagnostics','fixture();');
  f.root.DungeonLife.receiveDialogue({...f.event,dialogue:[{speaker:f.actor.name,line:'I am still at work.',kind:'canned'}]});
  assert.equal(f.root.DungeonLife.hasPendingTurnSpeech(f.actor.name),false);
  f.root.DungeonLife.receiveTurnDialogue('',{...f.event,dialogue:[{speaker:f.actor.name,line:'I will join after the work is verified.',attribution:'labelled'}]});
  assert.equal(f.root.DungeonLife.hasPendingTurnSpeech(f.actor.name),true);
  for(let i=0;i<4;i++){f.advance(20000);f.root.DungeonLife.tick();}
  assert.equal(f.root.DungeonLife.hasPendingTurnSpeech(f.actor.name),false);
});

const F=require('../retort/residentFavors');
function conversationalRequest({invited=true,mixed=false}={}){
  const f=fixtureFrom(invited?'cotg-starter-recruitment':'resident-favors','fixture();'),name='Vyth Aerir',input=invited?'Ask Vyth Aerir to join my party.':'How can I help Vyth Aerir?';
  f.p.actors[name].encounteredAt=1;
  const option=F.dialogueOptions(f.state,[name],{userInput:input})[0];
  if(mixed){option.candidates.push({id:'retrieve-test',kind:'retrieve',item:'existing stone',roomKey:'0,0,0',roomName:'Ruined Temple Entrance'});}
  F.applyDialogue(f.state,f.service,{speaker:name,recipient:'PC',line:'Tell me one memory you freely choose. I will listen, then join you.',
    socialAction:'offer-favor',playerInvited:invited,favorTitle:'A Memory Freely Given',favorFocus:'Share one memory you choose to speak aloud.',
    conditions:[{objectiveId:'conversation',observationCount:'',observationInterval:''},...(mixed?[{objectiveId:'retrieve-test'}]:[])]},option);
  return{...f,name,mission:()=>Object.values(f.db()[f.d.geoKey].minorMissions).find(m=>m.type==='resident-favor')};
}
function fulfill(f,input,event={}){
  const option=F.dialogueOptions(f.state,[f.name],{userInput:input})[0];
  return F.applyDialogue(f.state,f.service,{speaker:f.name,recipient:'PC',line:'Thank you for sharing that memory. I will accompany you.',
    socialAction:'fulfill-conversation',playerInvited:false,conversationEvidence:[{conditionId:'conversation',excerpt:input}],...event},option);
}
test('a voluntary shared memory satisfies an offered spoken request and fulfills standing recruitment immediately',()=>{
  const f=conversationalRequest();assert.equal(f.mission().status,'offered');
  assert.doesNotMatch(f.mission().description,/\b(?:observ(?:e|ation|ations)|report(?:ing)?)\b/i);
  const input='Say to Vyth: I remember the throne in Hades, before the undead appeared and nothing felt safe.';
  const result=fulfill(f,input),saved=f.mission();
  assert.equal(saved.status,'completed');assert.ok(saved.recruitedAt);assert.match(result.content,/joins the party/);
  assert.equal(saved.completionEvidence[0].playerInput,input);assert.equal(saved.completionEvidence[0].excerpt,input);
  assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name===f.name).type,'npc');
  assert.equal(F.dialogueOptions(f.state,[f.name],{userInput:input}).length,0,'A recruited member cannot earn the reward twice.');
});
test('previously accepted conversational requests also finish without observe or report commands',()=>{
  const f=conversationalRequest();F.command(f.state,f.service,'accept request from '+f.name);
  fulfill(f,'I remember the garden where I first learned to sing.');assert.equal(f.mission().status,'completed');assert.ok(f.mission().recruitedAt);
});
test('a conversational receipt cannot bypass a remaining physical condition',()=>{
  const f=conversationalRequest({mixed:true});fulfill(f,'I remember the quiet garden.');
  assert.equal(f.mission().status,'accepted');assert.equal(f.mission().readyToReport,false);assert.equal(f.mission().recruitedAt,undefined);
  assert.equal(F.assess(f.mission(),f.db()).checks.find(c=>c.id==='conversation').passed,true);
  assert.equal(F.assess(f.mission(),f.db()).checks.find(c=>c.id==='retrieve-test').passed,false);
});
test('dialogue evidence is tied to the actual player text and cannot be invented by the resident',()=>{
  for(const evidence of [[{conditionId:'conversation',excerpt:'A memory the player never said.'}],
    [{conditionId:'survey',excerpt:'Hello.'}],[],[{conditionId:'conversation',excerpt:''}]]){
    const f=conversationalRequest(),before=f.state.getRoomNameDatabase();
    assert.throws(()=>fulfill(f,'Hello.',{conversationEvidence:evidence}),/exact passage/);
    assert.equal(f.state.getRoomNameDatabase(),before);assert.equal(f.mission().status,'offered');
  }
});
test('automatic approach, another invitation and Not Now cannot fulfill a conversation request',()=>{
  const f=conversationalRequest();
  for(const userInput of ['Approach Vyth Aerir','Ask Vyth Aerir to join my party.','Not now.','I decline the request.','']){
    assert.ok(!F.dialogueOptions(f.state,[f.name],{userInput})[0].actions.includes('fulfill-conversation'),userInput);
  }
});
test('dialogue adjudication cannot substitute words for survey or item-transfer evidence',()=>{
  const f=conversationalRequest();f.change(db=>{const m=Object.values(db['0,0,0'].minorMissions)[0];
    m.conditions=[{id:'survey',kind:'survey',roomKey:'0,0,0',focus:'the threshold',observations:1,interval:1}];m.objective=m.conditions[0];});
  assert.ok(!F.dialogueOptions(f.state,[f.name],{userInput:'I completed everything.'})[0].actions.includes('fulfill-conversation'));
  assert.throws(()=>fulfill(f,'I completed everything.'),/not available/);assert.equal(f.mission().status,'offered');
});
test('finishing a spoken favor without an invitation never silently recruits the resident',()=>{
  const f=conversationalRequest({invited:false});const result=fulfill(f,'I remember the winter I spent tending that garden.');
  assert.equal(f.mission().status,'completed');assert.equal(f.mission().recruitedAt,undefined);assert.doesNotMatch(result.content,/joins the party|agrees to join/);
});
test('a stale or paused conversation cannot commit fulfillment evidence',()=>{
  for(const change of [f=>f.state.getLastCoords=()=>({x:1,y:0,z:0}),f=>f.state.getGamePaused=()=>true,f=>f.state.getDungeonRunId=()=> 'other-run']){
    const f=conversationalRequest(),input='I remember that garden.',option=F.dialogueOptions(f.state,[f.name],{userInput:input})[0];change(f);
    assert.throws(()=>F.applyDialogue(f.state,f.service,{speaker:f.name,recipient:'PC',line:'I heard your memory.',socialAction:'fulfill-conversation',
      conversationEvidence:[{conditionId:'conversation',excerpt:input}]},option),/conversation changed/);
    assert.equal(f.mission().status,'offered');
  }
});
test('the existing live speech call adjudicates a real player memory and commits before emitting the final response',async()=>{
  const f=conversationalRequest(),Work=require('../retort/holodekRoomWork'),N=require('../retort/holodekNarration'),original=Work.request;
  const userInput='Say to Vyth: I remember the garden where I learned to sing.',calls=[];
  Work.request=async(_$,component,schema,brief,validate)=>{
    calls.push(component);
    if(component==='story-scene')return validate({prose:'The listener gives your memory room.',interaction:'conversation',speakers:[f.name]});
    if(component==='npc-live-speech'){
      assert.match(brief,/CONVERSATIONAL REQUEST FULFILLMENT/);assert.match(brief,/A relevant question can itself fulfill a request if its criterion allows questions/);
      assert.ok(schema.socialAction.enum.includes('fulfill-conversation'));
      return validate({action:'nods.',line:'Thank you for sharing that memory. I will come with you.',remember:'',recipient:'PC',attention:'addressing',
        socialAction:'fulfill-conversation',playerInvited:true,conditions:[],favorTitle:'',favorFocus:'',
        conversationEvidence:[{conditionId:'conversation',excerpt:'I remember the garden where I learned to sing.'}]});
    }
    return validate({lines:['I remember what you chose to share.','The path is open.']});
  };
  try{
    const result=await N.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput,characters:[{name:f.name}],audibleNames:[f.name],
      localFavors:F.context(f.state,[f.name]),socialInteractions:F.dialogueOptions(f.state,[f.name],{userInput}),
      onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null});
    assert.equal(f.mission().status,'completed');assert.ok(f.mission().recruitedAt);assert.match(result.content,/joins the party/);
    assert.equal(calls.filter(c=>c==='npc-live-speech').length,1);assert.equal(calls.length,3,'No extra adjudication model request.');
  }finally{Work.request=original;}
});

test('one pending invitation never forces an uninvolved resident to answer recruitment or removes their ordinary reply enum',async()=>{
  const f=conversationalRequest(),name='Another Resident',actor={...f.p.actors[f.name],name,encounterId:'another-group',starterRecruitmentRole:undefined};
  f.p.actors[name]=actor;f.p.groups.push({id:'another-group',members:[name]});f.change(db=>db['0,0,0'].inhabitants=f.p);
  f.state.setCombatCharactersString(JSON.stringify([...JSON.parse(f.state.getCombatCharactersString()),
    {name,type:'monster',hp:12,state:'Friendly',mazeX:5,mazeY:5,mazeRoomKey:'0,0,0'}]));
  const Work=require('../retort/holodekRoomWork'),N=require('../retort/holodekNarration'),original=Work.request,userInput='Hello, everyone. How are you?';let speakers=0;
  Work.request=async(_$,component,schema,brief,validate)=>{
    if(component==='story-scene')return validate({prose:'The two residents look up.',interaction:'recruitment',speakers:[f.name,name]});
    if(component==='npc-live-speech'){
      const first=speakers++===0;
      if(!first){assert.ok(schema.socialAction.enum.includes('none'));assert.match(brief,/Another resident's invitation does not invite you/);}
      return validate({action:'looks up.',line:first?'Our request still stands.':'Hello. I am keeping these stones clean.',remember:'',recipient:'PC',attention:'passing',
        socialAction:first?'discuss-favor':'none',playerInvited:first,conditions:[],favorTitle:'',favorFocus:'',conversationEvidence:[]});
    }
    return validate({lines:['The temple is quiet.','The stones are clean.']});
  };
  try{
    const result=await N.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput,characters:[{name:f.name},{name}],audibleNames:[f.name,name],
      localFavors:F.context(f.state,[f.name,name]),socialInteractions:F.dialogueOptions(f.state,[f.name,name],{userInput}),
      onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null});
    assert.match(result.content,/I am keeping these stones clean/);assert.equal(f.mission().status,'offered');
  }finally{Work.request=original;}
});
