'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),F=require('../retort/residentFavors'),G=require('../retort/recruitmentGroups'),E=require('../retort/economy');
function from(file,expression){const target=path.resolve('tests',file+'.test.cjs'),source=fs.readFileSync(target,'utf8');
  return vm.runInNewContext(source.slice(0,source.indexOf("\ntest('"))+'\n'+expression,{require:createRequire(target),__dirname:path.dirname(target),console,structuredClone});}
function fixture({third=false,guardian=false}={}){
  const f=from('resident-dialogue-actions',`(()=>{const f=fixture();return {...f,mate:addGroupMate(f)};})()`),first='Vyth Aerir',names=[first,f.mate];
  if(third){const name='The Remaining Watcher',a={...f.p.actors[first],name,position:{x:6,y:5},sheet:f.row(name)};
    f.p.groups[0].members.push(name);f.p.actors[name]=a;names.push(name);
    f.state.setCombatCharactersString(JSON.stringify([...JSON.parse(f.state.getCombatCharactersString()),{name,type:'monster',hp:12,state:'Friendly',mazeX:6,mazeY:5,mazeRoomKey:f.d.geoKey}]));
    f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('Monsters Equipped Properties:',f.row(name)+'\nMonsters Equipped Properties:'));
  }
  for(const name of names)Object.assign(f.p.actors[name],{encounteredAt:1,allegiance:'Friendly',state:'Friendly'});
  if(guardian)Object.assign(f.p.actors[names.at(-1)],{recruitable:false,starterRecruitmentRole:'guardian'});
  f.change(db=>db[f.d.geoKey].inhabitants=f.p);
  const input='Ask '+first+' to join my party.',options=()=>F.dialogueOptions(f.state,names,{userInput:input});
  return {...f,first,names,input,options,group:()=>Object.values(f.db()[f.d.geoKey].recruitmentInvitations || {})[0],
    missions:()=>Object.values(f.db()[f.d.geoKey].minorMissions || {}).filter(m=>m.type==='resident-favor')};
}
const plan=instruction=>({conversation:[{target:'conversation',instruction,exchange:'explain',successCriteria:'The player gives a concrete answer to this request.'}]});
function reply(f,option,action='offer-favor'){
  const event={speaker:option.name,recipient:'PC',line:action==='offer-favor'?'Explain your purpose to me before we travel.':action==='accept-invitation'?'I am willing to travel with the group.':'I will remain here.',
    playerInvited:true,socialAction:action,...(action==='offer-favor'?{favorTitle:'A Request From '+option.name,taskPlan:plan('Explain your purpose to '+option.name+'.')}:{})};
  return F.applyDialogue(f.state,f.service,event,option);
}
function offerAll(f){const options=f.options();for(const option of options)reply(f,option);return f.missions();}
function fulfill(f,name,input){const option=F.dialogueOptions(f.state,[name],{userInput:input})[0];
  return F.applyDialogue(f.state,f.service,{speaker:name,recipient:'PC',line:'That answers my question.',socialAction:'fulfill-conversation',
    playerInvited:false,conversationEvidence:[{conditionId:'conversation',excerpt:input}]},option);}

test('naming one resident expands only their encountered audible group, not unrelated city residents',()=>{
  const f=fixture(),audible=[...f.names,'Other Resident'];
  const other={...f.p.actors[f.first],name:'Other Resident',encounterId:'another'};f.p.actors[other.name]=other;f.p.groups.push({id:'another',members:[other.name]});
  f.state.setCombatCharactersString(JSON.stringify([...JSON.parse(f.state.getCombatCharactersString()),{name:other.name,type:'monster',hp:10,state:'Friendly',mazeRoomKey:f.d.geoKey}]));
  const policy=G.audience(f.state,f.input,audible,{directed:true,responders:[f.first]});
  assert.deepEqual(policy.responders,f.names);assert.equal(policy.kind,'recruitment-group');
  assert.deepEqual(G.audience(f.state,f.input,[f.first],{directed:true,responders:[f.first]}).responders,[f.first]);
  assert.equal(F.command(f.state,f.service,'add '+f.first+' to party'),null,'The named console shortcut must reach live group dialogue.');
});
test('each willing group member can bind personal conditions without the old one-job rule discarding them',()=>{
  const f=fixture(),options=f.options();assert.equal(options.filter(o=>o.actions.includes('offer-favor')).length,2);
  reply(f,options[0]);assert.equal(f.group().status,'collecting');reply(f,options[1]);
  assert.equal(f.group().status,'review');assert.equal(f.missions().length,2);assert.ok(f.missions().every(m=>m.recruitmentGroupId===f.group().id));
  E.refresh(f.state);assert.ok(f.missions().every(m=>m.status==='offered'));
  assert.equal(F.presentation(f.state)[0].recruitmentGroup.members.filter(m=>m.outcome==='conditional').length,2);
});
test('one approval accepts every bound condition and completion of only one never recruits part of the group',()=>{
  const f=fixture(),missions=offerAll(f);
  const accepted=F.command(f.state,f.service,'accept request from '+f.first);assert.doesNotMatch(accepted.content,/unavailable|changed/);
  assert.equal(f.group().status,'accepted');assert.ok(f.missions().every(m=>m.status==='accepted'));
  fulfill(f,f.first,'I intend to help the people we find along the road.');
  assert.equal(f.missions()[0].status,'completed');assert.ok(f.missions().every(m=>!m.recruitedAt));
  assert.throws(()=>F.recruit(f.state,f.service,f.first,missions[0]),/every agreed condition/);
  fulfill(f,f.mate,'I intend to protect our companions along the road.');
  assert.ok(f.missions().every(m=>m.status==='completed' && m.recruitedAt));
  assert.ok(JSON.parse(f.state.getCombatCharactersString()).filter(a=>f.names.includes(a.name)).every(a=>a.type==='npc'));
  assert.equal(new Set(JSON.parse(f.state.getCombatCharactersString()).filter(a=>a.type==='npc').map(a=>a.name)).size,3);
});
test('performing an offered conversational condition accepts the shared request but still waits for the other conditions',()=>{
  const f=fixture();offerAll(f);fulfill(f,f.first,'I intend to protect the lost.');
  assert.equal(f.group().status,'accepted');assert.equal(f.missions().find(m=>m.recipient===f.mate).status,'accepted');
  assert.ok(f.missions().every(m=>!m.recruitedAt));
});
test('one decline declines all offered conditions and never adds an unconditional member',()=>{
  const f=fixture(),options=f.options();reply(f,options[0]);reply(f,options[1],'accept-invitation');
  assert.equal(f.group().status,'review');assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name===f.mate).type,'monster');
  F.command(f.state,f.service,'decline request from '+f.first);
  assert.equal(f.group().status,'declined');assert.ok(f.missions().every(m=>m.status==='declined'));
  assert.ok(JSON.parse(f.state.getCombatCharactersString()).filter(a=>f.names.includes(a.name)).every(a=>a.type==='monster'));
});
test('a willing member waits for the others but a genuine refusal is not included in the recruitment reward',()=>{
  const f=fixture({third:true}),options=f.options();reply(f,options[0]);reply(f,options[1],'accept-invitation');reply(f,options[2],'decline-invitation');
  assert.equal(f.group().status,'review');assert.equal(f.group().members[2].outcome,'declined');
  F.command(f.state,f.service,'accept request from '+f.first);fulfill(f,f.first,'I intend to keep our companions safe.');
  const roster=JSON.parse(f.state.getCombatCharactersString());assert.equal(roster.find(a=>a.name===f.first).type,'npc');assert.equal(roster.find(a=>a.name===f.mate).type,'npc');
  assert.equal(roster.find(a=>a.name===f.names[2]).type,'monster');
});
test('a guardian stays behind and cannot contribute a recruitment task or join through group approval',()=>{
  const f=fixture({third:true,guardian:true}),options=f.options();assert.equal(options.length,3);assert.equal(f.group().members[2].outcome,'staying');
  assert.deepEqual(options[2].actions,['explain-staying']);
  for(const option of options)reply(f,option,option.staying?'explain-staying':'offer-favor');F.command(f.state,f.service,'accept request from '+f.first);
  fulfill(f,f.first,'I intend to help the lost.');fulfill(f,f.mate,'I intend to protect them.');
  assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name===f.names[2]).type,'monster');
});
test('all unconditional consents commit only after the last live group reply',()=>{
  const f=fixture(),options=f.options();reply(f,options[0],'accept-invitation');
  assert.ok(JSON.parse(f.state.getCombatCharactersString()).filter(a=>f.names.includes(a.name)).every(a=>a.type==='monster'));
  reply(f,options[1],'accept-invitation');
  assert.ok(JSON.parse(f.state.getCombatCharactersString()).filter(a=>f.names.includes(a.name)).every(a=>a.type==='npc'));
});
test('a half-authored exchange cannot be accepted and a failed later speaker does not add an earlier consenting member',()=>{
  const f=fixture(),options=f.options();reply(f,options[0],'accept-invitation');
  assert.equal(f.group().status,'collecting');assert.equal(G.ready(f.group(),f.db()),false);
  assert.throws(()=>F.recruit(f.state,f.service,f.first,null,{playerInvited:true}),/every agreed condition/);
});
test('a stored group request cannot be accepted from another floor or game and is unchanged by a stale approval',()=>{
  for(const change of [f=>f.state.getDungeonRunId=()=> 'other',f=>f.state.getLastCoords=()=>({x:2,y:0,z:0}),
    f=>f.change(db=>db[f.d.geoKey].cityFloorContext={hostKey:f.d.geoKey,buildingId:'upper',floor:1})]){
    const f=fixture(),missions=offerAll(f),db=f.db();change(f);
    assert.equal(G.linked(f.state,missions[0]),null);assert.equal(G.accept(f.state,f.db(),missions[0]),false);
    assert.ok(f.missions().every(m=>m.status==='offered'));assert.equal(db[f.d.geoKey].recruitmentInvitations[f.group().id].status,'review');
  }
});

test('the group popup waits for the complete dialogue and one popup lists every condition and staying member',()=>{
  const f=from('recruitment-delivery','commerce();'),a=f.actor.name,b='Second Recruit',stay='The Guardian';let talking=true,holds=0,resumes=0;
  f.window.getEconomyResidentInfo=()=>null;
  f.window.DungeonLife={hasPendingTurnSpeech:()=>talking,holdDialogue:()=>{holds++;let done=false;return ()=>{if(!done){done=true;resumes++;}};}};
  const group={id:'group-1',status:'review',members:[{name:a,outcome:'conditional',missionId:f.mission.id,status:'offered',description:'Share a memory.'},
    {name:b,outcome:'conditional',missionId:'second',status:'offered',description:'Solve the existing puzzle.'},{name:stay,outcome:'staying'}]};
  const m={...f.mission,recruitmentGroup:group},event={...f.event(),recruitmentRequests:[m],dialogue:[{speaker:a,line:'Tell me a memory.'},{speaker:b,line:'Please solve the puzzle.'}]};
  f.window.CommerceUi.receiveResult(event);f.window.CommerceUi.dialogueQueued({...event,speakers:[a,b]});
  assert.equal(f.window.CommerceUi.onFrame(),false);assert.equal(holds,0);
  talking=false;assert.equal(f.window.CommerceUi.onFrame(),true);assert.equal(holds,1);
  const visible=f.nodes.filter(n=>n.tag==='p' && n.isConnected).map(n=>n.textContent).join('\n');assert.match(visible,/Share a memory/);assert.match(visible,/Solve the existing puzzle/);assert.match(visible,/The Guardian/);
  assert.ok(f.button('Accept Group Request'));assert.ok(f.button('Decline Group Request'));
  f.button('Not Now').click();assert.equal(resumes,1);f.window.CommerceUi.onFrame();assert.equal(f.button('Accept Group Request'),undefined);
});
test('speech arriving during a recruitment decision stays queued and does not play until the hold is released',()=>{
  const f=from('subtitle-diagnostics','fixture();'),spoken=[];
  f.root.HolodekSfx={stopSpeech(){},voicePrefetch(){},speakLine(name,line,options){spoken.push(line);options.onSchedule(1000,false);return Promise.resolve();}};
  const release=f.root.DungeonLife.holdDialogue();
  f.root.DungeonLife.receiveTurnDialogue('',{...f.event,dialogue:[{speaker:f.actor.name,line:'This can wait until your decision.',attribution:'labelled'}]});
  for(let n=0;n<4;n++){f.advance(20000);f.root.DungeonLife.tick();}
  assert.deepEqual(spoken,[]);assert.equal(f.root.DungeonLife.hasPendingTurnSpeech(),true);
  release();f.root.DungeonLife.tick();assert.deepEqual(spoken,['This can wait until your decision.']);
});
test('a dialogue hold is nest-safe, released after reset, and never changes the engine pause flag',()=>{
  const f=from('subtitle-diagnostics','fixture();'),a=f.root.DungeonLife.holdDialogue(),b=f.root.DungeonLife.holdDialogue();
  f.root.DungeonLife.receiveDialogue(f.event);a();f.root.DungeonLife.tick();assert.equal(f.reports.filter(r=>r.stage==='displayed').length,0);
  b();f.root.DungeonLife.tick();assert.equal(f.reports.filter(r=>r.stage==='displayed').length,1);assert.notEqual(f.root.gamePaused,true);
  f.root.DungeonLife.reset();a();b();assert.equal(f.root.DungeonLife.hasPendingTurnSpeech(),false);
});
test('normal character actions show progress and a separate completion button, and approaching never reopens an accepted request',async()=>{
  const f=from('recruitment-delivery','commerce();');f.mission.status='accepted';f.mission.readyToReport=true;
  f.window.CommerceUi.receiveResult(f.event());
  assert.equal(f.window.CommerceUi.invite(f.actor.name),false);assert.equal(f.window.CommerceUi.invite(f.actor.name,{characterClick:true}),false);
  const actions=f.document.createElement('div');f.body.appendChild(actions);f.window.CommerceUi.addAction(actions,f.actor.name);
  assert.ok(f.button('Recruitment Progress'));assert.ok(f.button('Complete Party Invitation'));assert.equal(f.button('Complete Party Invitation').disabled,false);
  f.hook(async request=>({ok:true,json:async()=>request.path==='/economy/view'?{revision:7}:{...f.event(),type:'economy_result',content:'Verified.'}}));
  await f.button('Complete Party Invitation').click();
  const sent=f.requests.find(r=>r.path==='/economy/action');assert.equal(sent.body.kind,'complete-recruitment');assert.equal(sent.body.missionId,f.mission.id);
  assert.equal(f.button('Accept Request'),undefined);
});
test('group completion preflights every physical task, then verifies all and recruits without a second report popup',()=>{
  const f=fixture(),missions=offerAll(f);F.command(f.state,f.service,'accept request from '+f.first);
  f.change(db=>{for(const m of Object.values(db[f.d.geoKey].minorMissions)){
    m.objective={id:'puzzle:'+m.id,kind:'puzzle',roomKey:f.d.geoKey,mechanismId:'instrument'};m.conditions=[m.objective];
  }});
  const body={kind:'complete-recruitment',actor:f.first,missionId:missions[0].id,runId:'test-run',geoKey:f.d.geoKey,revision:f.book().revision,nonce:'complete-group-1'};
  const failed=E.action(f.state,f.service,body);assert.match(failed.error,/not verified/);assert.ok(f.missions().every(m=>m.status==='accepted'));
  const puzzle=from('cotg-starter-recruitment','puzzle();');puzzle.id='instrument';for(const control of puzzle.controls)
    if(puzzle.state.values[puzzle.controls.indexOf(control)]!==control.goal)puzzle.state=require('../assets/physicalPuzzles').step(puzzle,puzzle.state,control.id,control.goal);
  f.change(db=>db[f.d.geoKey].puzzleMechanism=puzzle);
  const done=E.action(f.state,f.service,body);assert.equal(done.error,undefined);assert.ok(done.recruitmentHandoff);
  assert.ok(f.missions().every(m=>m.status==='completed'&&m.rewardReceiptId&&m.recruitedAt));
  assert.equal(E.action(f.state,f.service,body).duplicate,true);
});
test('the actual live exchange binds two typed counteroffers and one refusal before producing its final packet',async()=>{
  const f=fixture({third:true}),Work=require('../retort/holodekRoomWork'),N=require('../retort/holodekNarration'),original=Work.request;
  const options=f.options();let speaker=0;
  Work.request=async(_$,component,schema,brief,validate)=>{
    if(component==='story-scene')return validate({prose:'The three residents consider your invitation.',interaction:'recruitment',speakers:f.names});
    if(component==='npc-live-speech'){
      const name=f.names[speaker++],conditional=speaker<3;assert.match(brief,/GROUP RECRUITMENT/);assert.ok(schema.socialAction.enum.includes('offer-favor'));
      return validate({action:'nods.',line:conditional?'Explain your purpose to me first; then I will travel with the willing group.':'I will stay here. Safe travels.',remember:'',recipient:'PC',attention:'addressing',
        socialAction:conditional?'offer-favor':'decline-invitation',playerInvited:true,...(conditional?{favorTitle:'A Request From '+name,
          taskPlan:schema.taskPlan.type.retrieve?{retrieve:[{target:schema.taskPlan.type.retrieve.type[0].type.target.enum[0],instruction:'Return my existing possession.'}]}:plan('Explain your purpose to '+name+'.')}:{})});
    }
    return validate({lines:['The road remains open.','I am tending my work.']});
  };
  try{
    const result=await N.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput:f.input,characters:f.names.map(name=>({name,partyMember:false})),
      audibleNames:f.names,socialInteractions:options,onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null});
    assert.equal(result.socialResults.length,3);assert.equal(f.missions().length,2);assert.equal(f.group().status,'review');assert.equal(f.group().members[2].outcome,'declined');
    assert.ok(f.missions().every(m=>m.status==='offered'));assert.ok(!result.content.includes('could not be completed'));
  }finally{Work.request=original;}
});
test('a later failed live speech leaves the entire group unapproved and unrecruited',async()=>{
  const f=fixture(),Work=require('../retort/holodekRoomWork'),N=require('../retort/holodekNarration'),original=Work.request;let speaker=0;
  Work.request=async(_$,component,schema,brief,validate)=>{
    if(component==='story-scene')return validate({prose:'The residents listen.',interaction:'recruitment',speakers:f.names});
    if(++speaker===2)throw Error('The second voice failed.');
    return validate({action:'nods.',line:'I will come with the willing group.',remember:'',recipient:'PC',attention:'addressing',socialAction:'accept-invitation',playerInvited:true});
  };
  try{await assert.rejects(N.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput:f.input,characters:f.names.map(name=>({name,partyMember:false})),
    audibleNames:f.names,socialInteractions:f.options(),onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null}),/second voice failed/);
    assert.equal(f.group().status,'collecting');assert.equal(f.missions().length,0);
    assert.ok(JSON.parse(f.state.getCombatCharactersString()).filter(a=>f.names.includes(a.name)).every(a=>a.type==='monster'));
  }finally{Work.request=original;}
});
test('CotG starter group conditions stay recruitment-only and any participating request can approve the whole group',()=>{
  const f=fixture(),old=f.d.geoKey;f.d.geoKey='0,0,0';f.p.geoKey='0,0,0';f.p.starting=true;
  f.p.starterRecruitment={version:1,favorActor:f.first,guardianActor:null};f.p.actors[f.first].starterRecruitmentRole='favor';
  f.change(db=>{db['0,0,0']={...db[old],economy:db['0,0,0'].economy,inhabitants:f.p};delete db[old];});
  f.state.getLastCoords=()=>({x:0,y:0,z:0});f.state.getRoomPopulation=k=>k==='0,0,0'?f.p:null;
  f.state.setRoomPopulation=(k,p)=>{if(k==='0,0,0'&&p!==f.p)Object.assign(f.p,p);};
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('Coordinates: X: 1, Y: 0, Z: 0','Coordinates: X: 0, Y: 0, Z: 0'));
  f.state.setCombatCharactersString(JSON.stringify(JSON.parse(f.state.getCombatCharactersString()).map(a=>({...a,mazeRoomKey:'0,0,0'}))));
  const options=f.options();assert.deepEqual(options[0].actions,['none','offer-favor']);assert.ok(options[1].actions.includes('offer-favor'));
  for(const option of options)reply(f,option);
  assert.ok(f.missions().every(m=>m.starterRecruitment));
  const accepted=F.command(f.state,f.service,'accept request from '+f.mate);assert.match(accepted.content,/Request accepted/);
  assert.ok(f.missions().every(m=>m.status==='accepted'));assert.equal(f.db()['0,0,0'].services,undefined);
  assert.match(E.action(f.state,f.service,{runId:'test-run',geoKey:'0,0,0',kind:'buy',actor:f.mate,revision:f.book().revision,nonce:'starter-no-trade'}).error,/unavailable in the starter room/);
});
test('all group acceptances are preflighted so an invalid later request cannot partially accept the first',()=>{
  const f=fixture(),missions=offerAll(f);f.change(db=>db[f.d.geoKey].minorMissions[missions[1].id].floor='wrong-floor');
  const db=f.db();assert.throws(()=>G.accept(f.state,db,missions[0]),/Return to the floor/);
  assert.ok(Object.values(db[f.d.geoKey].minorMissions).every(m=>m.status==='offered'));assert.equal(f.group().status,'review');
});
test('a generic acceptance binds the shared conditions once rather than asking the model to choose between group jobs',()=>{
  const f=fixture();offerAll(f);const options=F.dialogueOptions(f.state,f.names,{userInput:'I accept the conditions.'});
  assert.equal(options.filter(o=>o.actions.includes('accept-favor')).length,1);
  const option=options.find(o=>o.actions.includes('accept-favor'));
  F.applyDialogue(f.state,f.service,{speaker:option.name,recipient:'PC',line:'We will wait while you do the work.',socialAction:'accept-favor',playerInvited:true},option);
  assert.ok(f.missions().every(m=>m.status==='accepted'));
});
test('changing rooms closes a recruitment decision and releases its dialogue hold without carrying it into another scene',()=>{
  const f=from('recruitment-delivery','commerce();');let resumes=0;
  f.window.DungeonLife={holdDialogue:()=>()=>resumes++};f.window.CommerceUi.invite(f.actor.name);
  assert.ok(f.button('Accept Request'));f.window.currentDungeon.geoKey='0,1,0';f.window.CommerceUi.onFrame();
  assert.equal(resumes,1);assert.equal(f.button('Accept Request'),undefined);
});
test('willing members without their own task expose the shared progress instead of another Add to Party loop',()=>{
  const f=fixture(),options=f.options();reply(f,options[0]);reply(f,options[1],'accept-invitation');
  const window={dungeonRunId:'test-run',EconomyRules:require('../assets/economyRules')},source=fs.readFileSync('assets/game.js','utf8');
  vm.runInNewContext(source.slice(source.indexOf('window.getEconomyResidentInfo ='),source.indexOf('window.commitLocalPartyChange =')),
    {window,currentDungeon:f.d,roomNameDatabase:new Map(Object.entries(f.db()))});
  const business=window.getEconomyResidentInfo(f.mate);assert.equal(business.recruitmentCondition.recipient,f.first);
  assert.equal(business.recruitmentCondition.recruitmentGroup.id,f.group().id);
});
test('a compact group packet exposes shared progress for an unconditional member and clears it after recruitment',()=>{
  const f=from('recruitment-delivery','commerce();'),other='Willing Companion';
  const group={id:'shared',status:'accepted',members:[{name:f.actor.name,outcome:'conditional',missionId:f.mission.id,status:'accepted',readyToReport:true},{name:other,outcome:'ready'}]};
  const m={...f.mission,status:'accepted',recruitmentGroup:group};f.window.getEconomyResidentInfo=()=>null;
  f.window.CommerceUi.receiveResult({...f.event(),recruitmentRequests:[m]});
  const actions=f.document.createElement('div');f.body.appendChild(actions);f.window.CommerceUi.addAction(actions,other);
  assert.ok(f.button('Recruitment Progress'));assert.ok(f.button('Complete Party Invitation'));assert.equal(f.button('Complete Party Invitation').disabled,false);
  f.window.CommerceUi.receiveResult({...f.event(),recruitmentRequests:[{...m,status:'completed',recruitedAt:1}]});
  assert.equal(f.window.CommerceUi.requestFor(other),null);
});
test('quest-protected group contacts are marked as staying rather than leaving the invitation collecting forever',()=>{
  const f=fixture(),Scenes=require('../retort/questScenes'),original=Scenes.recruitmentGuard;
  Scenes.recruitmentGuard=(_state,input)=>input.includes(f.mate)?{content:'This contact remains in their quest role.'}:null;
  try{const options=f.options();assert.equal(options.length,2);assert.equal(f.group().members[1].outcome,'staying');
    reply(f,options[0]);assert.equal(f.group().status,'collecting');assert.equal(f.missions().length,1);
    reply(f,options[1],'explain-staying');assert.equal(f.group().status,'review');assert.equal(f.group().members[1].responsePending,false);
  }finally{Scenes.recruitmentGuard=original;}
});
test('an old dialogue hold cannot restart a different scene after reset',()=>{
  const f=from('subtitle-diagnostics','fixture();'),played=[];
  f.root.HolodekSfx={stopSpeech(){},voicePrefetch(){},speakLine(_name,line,options){played.push(line);options.onSchedule(1000,false);return Promise.resolve();}};
  const stale=f.root.DungeonLife.holdDialogue();f.root.DungeonLife.reset();f.root.DungeonLife.receiveDialogue(f.event);
  assert.equal(played.length,1);stale();assert.equal(played.length,1);
});
test('the completion handoff is reauthored only when a later party-space change actually fulfills recruitment',async()=>{
  const f=fixture(),options=f.options();for(const option of options)reply(f,option);
  F.command(f.state,f.service,'accept request from '+f.first);
  // Preserve verified receipts while simulating a full party at the initial handoff.
  f.change(db=>{for(const m of Object.values(db[f.d.geoKey].minorMissions)){
    m.status='completed';m.rewardReceiptId='receipt:'+m.id;m.completionEvidence=[{source:'engine-test',id:m.id}];
  }});
  const mission=f.missions()[0],H=require('../retort/recruitmentHandoff'),result={content:'Work verified.',recruitmentHandoff:{missionId:mission.id,completionId:mission.rewardReceiptId}};
  let calls=0;const author=async data=>{calls++;return{action:'nods.',line:data.joined?'We can travel together now.':'The work is done; make room for us when you can.',remember:''};};
  const first=await H.complete({state:f.state,service:f.service,result,author});assert.match(first.content,/make room/);
  G.settle(f.state,f.service,f.group());assert.ok(f.missions().every(m=>m.recruitedAt));
  const second=await H.complete({state:f.state,service:f.service,result,author});assert.match(second.content,/travel together now/);assert.equal(calls,2);
  await H.complete({state:f.state,service:f.service,result,author});assert.equal(calls,2);
});
test('repeat named Add-to-Party attempts restate a saved refusal without a model call, reroll or new group request',()=>{
  const f=fixture(),options=f.options();reply(f,options[0]);reply(f,options[1],'decline-invitation');
  const before=f.state.getRoomNameDatabase(),count=f.missions().length;
  const utterances=new Set();
  for(const input of ['add '+f.mate+' to party','Ask '+f.mate+' to join my party.','invite '+f.mate]){
    const result=F.command(f.state,f.service,input);assert.equal(result.actionOnly,true);assert.match(result.content,/already declined/);
    assert.equal(result.dialogue[0].line,'I will remain here.');assert.equal(f.state.getRoomNameDatabase(),before);assert.equal(f.missions().length,count);
    assert.match(result.dialogue[0].utteranceId,/^[0-9a-f-]{36}$/);utterances.add(result.dialogue[0].utteranceId);
  }
  assert.equal(utterances.size,3,'Each fresh request has its own subtitle delivery, not a new recruitment decision.');
  assert.equal(F.command(f.state,f.service,'Ask '+f.first+' to join my party.'),null,'Willing members still use their shared invitation.');
});
test('a saved refusal is not remotely voiced for an absent, undiscovered or dead resident',()=>{
  for(const change of [f=>f.state.setCombatCharactersString(JSON.stringify(JSON.parse(f.state.getCombatCharactersString()).map(a=>a.name===f.mate?{...a,mazeRoomKey:'elsewhere'}:a))),
    f=>f.state.setCombatCharactersString(JSON.stringify(JSON.parse(f.state.getCombatCharactersString()).map(a=>a.name===f.mate?{...a,hp:0,state:'Dead'}:a))),
    f=>f.state.setCombatCharactersString(JSON.stringify(JSON.parse(f.state.getCombatCharactersString()).map(a=>a.name===f.mate?{...a,discoveryState:'pending'}:a)))]){
    const f=fixture(),options=f.options();reply(f,options[0]);reply(f,options[1],'decline-invitation');change(f);
    assert.equal(F.command(f.state,f.service,'Ask '+f.mate+' to join my party.'),null);
  }
});
