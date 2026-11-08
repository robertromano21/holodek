'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),F=require('../retort/residentFavors'),H=require('../retort/recruitmentHandoff'),E=require('../retort/economy');
const name='Vyth Aerir',line='You set the old instrument right. Our bargain is kept; I will walk beside you.';
function prepared({solve=true,invited=true}={}){
  const file=path.resolve('tests/cotg-starter-recruitment.test.cjs'),source=fs.readFileSync(file,'utf8');
  const {f,definition}=vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\n({f:fixture(),definition:puzzle()});',{require:createRequire(file)});
  f.p.actors[name].profile={name,voice:'Dry, practical, with a trace of amusement.',personality:'Patient and observant.',history:'Tended this existing instrument.',motivation:'Wants it repaired before leaving.'};
  f.change(db=>{db['0,0,0'].puzzleMechanism=definition;db['0,0,0'].inhabitants=f.p;});
  const input='Ask Vyth Aerir to join my party.',option=F.dialogueOptions(f.state,[name],{userInput:input})[0];
  F.applyDialogue(f.state,f.service,{speaker:name,recipient:'PC',line:'Set the existing instrument right, then report to me. I will join you afterward.',
    socialAction:'offer-favor',playerInvited:true,favorTitle:'The Waiting Instrument',taskPlan:{puzzle:[{target:'puzzle:'+definition.id,instruction:'Solve the existing instrument.'}]}},option);
  if(!invited)f.change(db=>{const m=Object.values(db['0,0,0'].minorMissions)[0];m.invitationPending=false;delete m.conditionalConsent;});
  F.command(f.state,f.service,'accept request from '+name);
  if(solve)f.change(db=>{const p=db['0,0,0'].puzzleMechanism;for(const c of p.controls)
    if(p.state.values[p.controls.indexOf(c)]!==c.goal)p.state=require('../assets/physicalPuzzles').step(p,p.state,c.id,c.goal);});
  const memory={characters:{},recent:[]};f.state.getDialogueMemory=()=>memory;
  return {...f,memory,mission:()=>Object.values(f.db()['0,0,0'].minorMissions).find(m=>m.type==='resident-favor')};
}
const authored={action:'He rests one hand on the repaired instrument.',line,remember:'The instrument is repaired and I have joined the party.'};
const report=f=>F.command(f.state,f.service,'report findings to '+name);

test('the verified puzzle report recruits first, then authors a personal handoff with exactly that resident',async()=>{
  const f=prepared(),result=report(f),before=f.state.getCombatCharactersString();let calls=0;
  assert.equal(f.mission().status,'completed');assert.ok(f.mission().recruitedAt);assert.ok(result.recruitmentHandoff);
  const done=await H.complete({state:f.state,service:f.service,result,author:async data=>{
    calls++;assert.equal(data.joined,true);assert.equal(data.request.status,'completed');assert.equal(data.request.title,'The Waiting Instrument');
    assert.equal(data.character.name,name);assert.equal(data.character.partyMember,true);assert.match(data.character.background.voice,/Dry, practical/);
    assert.equal(f.state.getCombatCharactersString(),before);return authored;
  }});
  assert.equal(calls,1);assert.equal(done.handoffStatus,'delivered');assert.match(done.content,/completed/);assert.match(done.content,/joins the party/);
  assert.match(done.content,/Our bargain is kept/);assert.doesNotMatch(done.content,/\[\[SPEECH/);
  assert.equal(done.dialogue.length,1);assert.equal(done.dialogue[0].speaker,name);assert.equal(done.dialogue[0].line,line);
  assert.equal(done.dialogue[0].attribution,'labelled');assert.equal(done.dialogue[0].attention,'addressing');
  assert.doesNotMatch(done.dialogue[0].line,/rests one hand/);assert.equal(f.state.getCombatCharactersString(),before);
  assert.equal(f.mission().handoff.line,line);assert.equal(f.memory.characters[name].recent.at(-1),line);
});
test('an incomplete puzzle report never triggers a handoff or changes recruitment',async()=>{
  const f=prepared({solve:false}),result=report(f);let calls=0;
  assert.equal(result.recruitmentHandoff,undefined);assert.match(result.content,/not verified/);
  assert.equal(await H.complete({state:f.state,service:f.service,result,author:()=>{calls++;return authored;}}),result);
  assert.equal(calls,0);assert.equal(f.mission().status,'accepted');assert.equal(f.mission().recruitedAt,undefined);
});
test('a completed favor without standing recruitment consent gets acknowledgment without inventing membership',async()=>{
  const f=prepared({invited:false}),result=report(f);
  const done=await H.complete({state:f.state,service:f.service,result,author:async data=>{
    assert.equal(data.joined,false);assert.equal(data.character.partyMember,false);return {...authored,line:'The instrument is right again. Thank you; I will keep tending it.',remember:''};
  }});
  assert.equal(f.mission().status,'completed');assert.equal(f.mission().recruitedAt,undefined);assert.match(done.content,/keep tending it/);
});
test('a response failure preserves completion, receipt, original character and actual party membership',async()=>{
  const f=prepared(),result=report(f),wire=f.state.getCombatCharactersString(),receipt=f.mission().rewardReceiptId;
  const done=await H.complete({state:f.state,service:f.service,result,author:async()=>{throw Error('A temporary model error.');}});
  assert.equal(done.handoffStatus,'failed');assert.match(done.content,/result is saved/);assert.equal(done.dialogue,undefined);
  assert.equal(f.mission().status,'completed');assert.equal(f.mission().rewardReceiptId,receipt);assert.ok(f.mission().recruitedAt);
  assert.equal(f.state.getCombatCharactersString(),wire);
});
test('concurrent delivery and cached replay do not reauthor or duplicate witnessed handoff memory',async()=>{
  const f=prepared(),result=report(f);let calls=0,release;
  const options={state:f.state,service:f.service,result,author:async()=>{calls++;await new Promise(resolve=>release=resolve);return authored;}};
  const a=H.complete(options),b=H.complete(options);assert.equal(calls,1);release();const results=await Promise.all([a,b]);
  assert.equal(results[0].content,results[1].content);
  const again=await H.complete({...options,author:()=>{throw Error('Cached text must be reused.');}});
  assert.equal(again.content,results[0].content);assert.equal(f.memory.characters[name].recent.filter(s=>s===line).length,1);
});
test('economy nonce replay carries the cached handoff without charging or recruiting twice',async()=>{
  const f=prepared(),m=f.mission(),body={kind:'report-favor',actor:name,missionId:m.id,runId:'test-run',geoKey:'0,0,0',revision:f.book().revision,nonce:'handoff-nonce-1'};
  const result=E.action(f.state,f.service,body);assert.ok(result.recruitmentHandoff);
  const done=await H.complete({state:f.state,service:f.service,result,author:async()=>authored});
  const replay=E.action(f.state,f.service,body);assert.equal(replay.duplicate,true);assert.ok(replay.recruitmentHandoff);
  const cached=await H.complete({state:f.state,service:f.service,result:replay,author:()=>{throw Error('No repeated authoring.');}});
  assert.equal(cached.content,done.content);assert.equal(cached.dialogue[0].line,line);
  assert.equal(f.book().receipts.filter(r=>r.nonce===body.nonce).length,1);
});
test('a fresh second report on an already completed request does not create another handoff',()=>{
  const f=prepared();report(f);
  const duplicate=E.action(f.state,f.service,{kind:'report-favor',actor:name,missionId:f.mission().id,runId:'test-run',geoKey:'0,0,0',revision:f.book().revision,nonce:'another-report-1'});
  assert.equal(duplicate.recruitmentHandoff,undefined);
});
test('handoff authoring merges into current state without discarding an adjacent room built during the call',async()=>{
  const f=prepared(),result=report(f);
  const done=await H.complete({state:f.state,service:f.service,result,author:async()=>{
    f.change(db=>db['0,1,0']={name:'Already Built Adjacent Room',objects:[{name:'kept item'}]});return authored;
  }});
  assert.equal(done.handoffStatus,'delivered');assert.equal(f.db()['0,1,0'].name,'Already Built Adjacent Room');
  assert.equal(f.db()['0,1,0'].objects[0].name,'kept item');
});
test('run, room, floor, actor and receipt changes discard late acknowledgment without changing the committed task',async()=>{
  for(const change of [f=>f.state.getDungeonRunId=()=> 'new-run',f=>f.state.getLastCoords=()=>({x:0,y:1,z:0}),
    f=>f.change(db=>db['0,0,0'].cityFloorContext={hostKey:'0,0,0',buildingId:'upper',floor:1}),
    f=>f.state.setCombatCharactersString(JSON.stringify(JSON.parse(f.state.getCombatCharactersString()).map(a=>a.name===name?{...a,hp:0,state:'Dead'}:a))),
    f=>f.change(db=>Object.values(db['0,0,0'].minorMissions)[0].rewardReceiptId='changed')]){
    const f=prepared(),result=report(f);
    const done=await H.complete({state:f.state,service:f.service,result,author:async()=>{change(f);return authored;}});
    assert.equal(done.handoffStatus,'stale');assert.equal(done.dialogue,undefined);assert.equal(f.mission().handoff,undefined);
    assert.equal(f.mission().status,'completed');
  }
});
test('ordinary economy actions, forged completion IDs and unverified missions never invoke the handoff author',async()=>{
  const f=prepared(),result=report(f);let calls=0;
  for(const value of [{content:'Purchased.'},{...result,recruitmentHandoff:{missionId:f.mission().id,completionId:'fake'}}])
    await H.complete({state:f.state,service:f.service,result:value,author:()=>{calls++;return authored;}});
  assert.equal(calls,0);
});
test('the actual Report Findings route awaits the shared authored handoff after recruitment and broadcasts its dialogue',async()=>{
  const f=prepared(),routes={},events=[],server=fs.readFileSync('server.js','utf8'),serverRequire=createRequire(path.resolve('server.js'));
  const context={sharedState:f.state,populationService:f.service,Economy:E,inputTaskInFlight:false,prepareQuestScene:()=>({}),
    broadcast:event=>events.push(event),console,app:{post:(url,handler)=>routes[url]=handler},
    require:spec=>spec==='./retort/recruitmentHandoff'?{complete:options=>H.complete({...options,author:async()=>{
      assert.equal(context.inputTaskInFlight,true);assert.ok(f.mission().recruitedAt);return authored;
    }})}:serverRequire(spec)};
  vm.runInNewContext(server.slice(server.indexOf("app.post('/economy/action'"),server.indexOf("app.post('/room-population/visit'")),context);
  let status=200,data;const res={status:n=>{status=n;return res;},json:value=>data=value};
  await routes['/economy/action']({body:{kind:'report-favor',actor:name,missionId:f.mission().id,runId:'test-run',geoKey:'0,0,0',revision:f.book().revision,nonce:'route-handoff-1'}},res);
  assert.equal(status,200);assert.equal(context.inputTaskInFlight,false);assert.equal(data.dialogue[0].line,line);
  assert.equal(data.type,'economy_result');assert.equal(data.handoffStatus,'delivered');assert.equal(events.filter(e=>e.type==='economy_result').length,1);
});
test('the typed report shortcut uses the same handoff without entering the general room/quest turn',async()=>{
  const f=prepared(),source=fs.readFileSync('retort/retortWithUserInput.js','utf8'),start=source.indexOf('  const favorAction ='),end=source.indexOf('  if (giveResult)',start);
  const result=await vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})()',{
    options:{},directCombat:false,ResidentFavors:F,sharedState:f.state,populationService:f.service,userInput:'report findings to '+name,broadcast(){},
    require:spec=>{assert.equal(spec,'./recruitmentHandoff');return{complete:options=>H.complete({...options,author:async()=>authored})};}
  });
  assert.equal(result.actionOnly,true);assert.equal(result.dialogue[0].line,line);assert.equal(result.handoffStatus,'delivered');
});
test('real Retort transport uses one post-commit authoring call and returns speech-only dialogue',async()=>{
  const f=prepared(),result=report(f),Host=require('../retort/pcModelHost'),Models=require('../retort/gameModels'),Runtime=require('../retort/gameRetort');
  const previous=Models.current().id,requests=[];
  const host=Host.createHost({fetchImpl:async(_url,init)=>{
    assert.ok(f.mission().recruitedAt);const body=JSON.parse(init.body);requests.push(body);
    assert.ok(body.response_format.json_schema.schema.properties.line);
    return {ok:true,text:async()=>JSON.stringify({model:'holodek-1',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(authored)}}]})};
  }});
  const runtime=Runtime.createRuntime({models:{...Models,getLocalClient:()=>Host.modelClient(host)},log(){}});Models.restore('holodek-1');
  try{
    const done=await H.complete({state:f.state,service:f.service,result,runtime});
    assert.equal(done.handoffStatus,'delivered');assert.equal(requests.length,1);assert.equal(done.dialogue[0].line,line);
  }finally{Models.restore(previous);}
});
test('SSE and HTTP copies display the authored handoff once after hydrating the actual recruited roster',async()=>{
  const f=prepared(),result=await H.complete({state:f.state,service:f.service,result:report(f),author:async()=>authored});
  const file=path.resolve('tests/realtime-combat-result.test.cjs'),source=fs.readFileSync(file,'utf8');
  const prefix=source.slice(0,source.indexOf("test('")).replace('return {root,d,text,calls,log,event};','return {root,d,text,calls,log,event,context};');
  const browser=vm.runInNewContext(prefix+'\nfixture();',{require:createRequire(file),__dirname:path.dirname(file)}),spoken=[];
  browser.d.geoKey='0,0,0';browser.root.dungeonRunId='test-run';
  Object.assign(browser.context,{roomNameDatabase:new Map(),roomDatabaseSyncClient:{reset(){}}});
  browser.root.DungeonLife.receiveTurnDialogue=(content,event)=>{
    assert.equal(browser.root.combatCharacters.find(a=>a.name===name).type,'npc');assert.equal(event.consoleText,result.updatedGameConsole);spoken.push(event.dialogue[0].line);
  };
  const event={...result,eventId:'handoff-result',runId:'test-run',geoKey:'0,0,0',type:'economy_result'};
  await Promise.all([browser.root.applyRealtimeCombatResult(event),browser.root.applyRealtimeCombatResult(event)]);
  assert.deepEqual(spoken,[line]);assert.equal(browser.log.length,1);assert.match(browser.log[0].textContent,/Our bargain is kept/);
});
