'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../retort/cotgStarterRecruitment'),F=require('../retort/residentFavors'),E=require('../retort/economy');
const I=require('../assets/dungeonInhabitants'),P=require('../assets/physicalPuzzles'),Work=require('../retort/holodekRoomWork');
const Narration=require('../retort/holodekNarration'),Setting=require('../retort/settingLayer');
function fixture(){
  const file=require.resolve('./resident-favors.test.cjs'),source=fs.readFileSync(file,'utf8');
  const f=vm.runInNewContext(source.slice(0,source.indexOf("const F=require"))+'\nfixture();',{require:require('node:module').createRequire(file)});
  f.p.geoKey='0,0,0';f.p.starting=true;f.d.geoKey='0,0,0';
  Object.assign(f.p.actors['Vyth Aerir'],{allegiance:'Friendly',state:'Friendly',encounteredAt:1,starterRecruitmentRole:'favor'});
  f.p.starterRecruitment={version:1,favorActor:'Vyth Aerir',guardianActor:null,guardianRoll:.8};
  f.change(db=>{db['0,0,0']={...db['1,0,0'],economy:db['0,0,0'].economy,inhabitants:f.p};delete db['1,0,0'];});
  f.state.getLastCoords=()=>({x:0,y:0,z:0});f.state.getRoomPopulation=k=>k==='0,0,0'?f.p:null;
  f.state.setRoomPopulation=(k,p)=>{if(k==='0,0,0'&&p!==f.p)Object.assign(f.p,p);};
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('Coordinates: X: 1, Y: 0, Z: 0','Coordinates: X: 0, Y: 0, Z: 0'));
  f.state.setCombatCharactersString(JSON.stringify(JSON.parse(f.state.getCombatCharactersString()).map(a=>({...a,state:a.type==='monster'?'Friendly':a.state,mazeRoomKey:'0,0,0'}))));
  f.service=require('../retort/roomPopulation').createPopulationService(f.state);return f;
}
const mission=f=>Object.values(f.db()['0,0,0'].minorMissions || {}).find(m=>m.type==='resident-favor');
const offer=async(f,choose=choices=>choices.find(c=>c.kind==='retrieve'))=>{
  return F.prepare(f.state,null,'How can I help?',{audibleNames:['Vyth Aerir'],population:f.p,author:async(_brief,choices)=>({
    title:'An Authored Personal Favor',offer:'Help me finish my work here; afterward I can come with you.',
    conditions:[{objectiveId:choose(choices).id}]})});
};
function puzzle(){const p=P.compile({kind:'alignment',title:'An Existing Instrument',context:'The existing instrument.',lore:'An existing record.',
  controls:['West','Middle','East'].map((s,i)=>({id:s.toLowerCase(),label:s+' Dial',mark:s,options:['Sun','Moon','Wave'],initial:0,goal:i})),order:['east','west','middle'],exhaustionLimit:4});
  return {...p,state:P.initialState(p)};
}

test('CotG has one guaranteed favor contact and exactly 70 percent one-guardian outcomes, not independent per-monster rolls',()=>{
  let guarded=0;
  for(let i=0;i<1000;i++){
    const slots=[{slot:0},{slot:1},{slot:2}],plan=S.plan(slots,{random:()=>(i+.5)/1000});
    assert.equal(slots.filter(s=>s.starterRecruitmentRole==='favor').length,1);
    const guard=slots.filter(s=>s.starterRecruitmentRole==='guardian');assert.ok(guard.length<=1);
    if(guard.length){guarded++;assert.equal(guard[0].recruitable,false);assert.notEqual(guard[0],slots[0]);}
    const pop={actors:Object.fromEntries(slots.map(s=>['Resident '+s.slot,{...s,name:'Resident '+s.slot}]))};S.record(pop,plan);
    assert.equal(pop.starterRecruitment.favorActor,'Resident 0');assert.equal(!!pop.starterRecruitment.guardianActor,guard.length===1);
  }
  assert.equal(guarded,700);
});

test('starter exception is CotG-only, never a genre first room or an upper host-local floor',()=>{
  assert.equal(S.active('0,0,0',{},{}),true);assert.equal(S.active('1,0,0',{},{}),false);
  assert.equal(S.active('0,0,0',{cityFloorContext:{floor:1}},{}),false);
  assert.equal(S.active('0,0,0',{}, {'0,0,0':{setting:{kind:'homebrew'}}}),false);
  Setting.withDraft({kind:'homebrew',...require('./fixtures/authored-world.cjs')('cyberpunk')},()=>assert.equal(S.active('0,0,0',{},{}),false));
});

test('designated starter contact must offer a favor, cannot join first, and a guardian stays unrecruitable',()=>{
  const f=fixture(),option=F.dialogueOptions(f.state,['Vyth Aerir'],{invitation:true})[0];
  assert.deepEqual(option.actions,['none','offer-favor']);assert.equal(option.starterFavor,true);
  assert.ok(option.candidates.every(c=>c.roomKey==='0,0,0'));
  assert.throws(()=>F.recruit(f.state,f.service,'Vyth Aerir',null,{playerInvited:true}),/local recruitment favor/);
  f.p.actors['Vyth Aerir'].recruitable=false;f.change(db=>db['0,0,0'].inhabitants=f.p);
  assert.deepEqual(F.dialogueOptions(f.state,['Vyth Aerir'],{invitation:true})[0].actions,['explain-staying']);
  assert.throws(()=>F.recruit(f.state,f.service,'Vyth Aerir',null,{playerInvited:true}),/cannot join/);
});

test('an actual starter invitation requires a grounded spoken request, persisted as offered rather than accepted',async()=>{
  const f=fixture(),original=Work.request,input='Ask Vyth Aerir to join my party.';
  Work.request=async(_$,component,schema,brief,validate)=>{
    if(component==='story-scene')return validate({prose:'The observer turns toward Mortacia.',interaction:'recruitment',speakers:['Vyth Aerir']});
    if(component==='npc-live-speech'){
      assert.match(brief,/offer-favor is required after this actual invitation/);
      assert.match(brief,/engine-selected primary kind/);
      assert.deepEqual(schema.socialAction.enum,['offer-favor']);
      return validate({action:'gestures toward the threshold.',line:'Bring my measuring ribbon back. Afterward I will join you.',
        recipient:'PC',attention:'addressing',remember:'',socialAction:'offer-favor',playerInvited:true,
        favorTitle:'Study the Threshold',taskPlan:{retrieve:[{target:schema.taskPlan.type.retrieve.type[0].type.target.enum[0],instruction:'Bring my measuring ribbon back.'}]}});
    }
    return validate({lines:['I am tending the entrance.','The stones have not moved.']});
  };
  try{
    const result=await Narration.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput:input,
      characters:[{name:'Vyth Aerir'}],audibleNames:['Vyth Aerir'],socialInteractions:F.dialogueOptions(f.state,['Vyth Aerir'],{userInput:input}),
      onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null});
    assert.match(result.content,/Bring my measuring ribbon/);assert.equal(mission(f).status,'offered');
    assert.equal(mission(f).invitationPending,true);assert.equal(F.presentation(f.state)[0].starterRecruitment,true);
    assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name==='Vyth Aerir').type,'monster');
  }finally{Work.request=original;}
});

test('production generation preserves the authored favor/guardian roles and original friendly starter monster rules',async t=>{
  const Models=require('../retort/gameModels'),prior=Models.current().id;Models.restore('gpt-6-luna');
  const random=t.mock.method(Math,'random',()=>.5),rows=require('./fixtures/inhabitants.cjs')(2),{batchRows}=require('./fixtures/inhabitant-batch.cjs');
  const prompts=[],agent={user:(p,...v)=>prompts.push(typeof p==='string'?p:String.raw({raw:p},...v)),assistant:{generation:async opts=>({content:JSON.stringify({inhabitants:batchRows(rows,opts)})})}};
  try{
    const result=await require('../retort/inhabitantGeneration').generateInhabitants(agent,{roomName:'Ruined Temple Entrance',roomDescription:'The existing threshold.',geoKey:'0,0,0',indoor:true,rooms:{'0,0,0':{}}},
      {random:min=>min,level:()=>3,sex:()=>'Female',xp:()=>0,equipment:async()=>null});
    const pop=result.population,plan=pop.starterRecruitment;
    assert.equal(Object.keys(pop.actors).length,2);assert.ok(plan.favorActor);assert.ok(plan.guardianActor);assert.notEqual(plan.favorActor,plan.guardianActor);
    assert.equal(pop.actors[plan.guardianActor].recruitable,false);assert.ok(Object.values(pop.actors).every(a=>a.allegiance==='Friendly'));
    const described=require('../retort/characterDialogue').describeCharacters(Object.values(pop.actors).map(a=>({...a,type:'monster',hp:10})),pop);
    assert.equal(described.find(a=>a.name===plan.guardianActor).starterRecruitmentRole,'guardian');assert.match(prompts.join('\n'),/COTG STARTER RECRUITMENT/);
    const saved=structuredClone(pop);assert.deepEqual(saved.starterRecruitment,plan);
  }finally{random.mock.restore();Models.restore(prior);}
});

test('a later failed reply cannot commit an earlier speakers invitation without delivering the exchange',async()=>{
  const f=fixture();delete f.p.starterRecruitment;delete f.p.actors['Vyth Aerir'].starterRecruitmentRole;
  const mate={...f.p.actors['Vyth Aerir'],name:'Second Resident'};f.p.actors[mate.name]=mate;f.change(db=>db['0,0,0'].inhabitants=f.p);
  const wire=JSON.parse(f.state.getCombatCharactersString());wire.push({...wire.find(a=>a.type==='monster'),name:mate.name});f.state.setCombatCharactersString(JSON.stringify(wire));
  const original=Work.request;let speakers=0;
  Work.request=async(_$,component,_schema,_brief,validate)=>{
    if(component==='story-scene')return validate({prose:'Both residents listen.',interaction:'recruitment',speakers:['Vyth Aerir',mate.name]});
    if(component==='npc-live-speech'){
      if(++speakers===2)throw Error('Second voice failed.');
      return validate({action:'nods.',line:'Yes, I will join.',remember:'',socialAction:'accept-invitation',playerInvited:false,conditions:[],favorTitle:'',favorFocus:'',recipient:'PC',attention:'addressing'});
    }
    throw Error('No cache request before the live exchange validates.');
  };
  try{
    await assert.rejects(Narration.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput:'tell monsters my full tale and ask if they would join my quest',
      characters:[{name:'Vyth Aerir',partyMember:false},{name:mate.name,partyMember:false}],audibleNames:['Vyth Aerir',mate.name],
      socialInteractions:F.dialogueOptions(f.state,['Vyth Aerir',mate.name]),onSocialAction:(e,o)=>F.applyDialogue(f.state,f.service,e,o),location:null}),/Second voice failed/);
    assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name==='Vyth Aerir').type,'monster');assert.equal(mission(f),undefined);
  }finally{Work.request=original;}
});

test('the first-room character sheet exposes only the verified starter favor, never legacy shop metadata',()=>{
  const f=fixture(),m={id:'tutorial',source:F.SOURCE,type:'resident-favor',runId:'test-run',roomKey:'0,0,0',recipient:'Vyth Aerir',status:'offered',starterRecruitment:true};
  f.change(db=>db['0,0,0'].minorMissions={tutorial:m});
  const source=fs.readFileSync('assets/game.js','utf8'),start=source.indexOf('window.getEconomyResidentInfo ='),end=source.indexOf('window.prepareEconomyState =',start);
  const window={EconomyRules:require('../assets/economyRules'),dungeonRunId:'test-run'};
  vm.runInNewContext(source.slice(start,end),{window,roomNameDatabase:new Map([['0,0,0',f.db()['0,0,0']]]),currentDungeon:{geoKey:'0,0,0'}});
  assert.equal(window.getEconomyResidentInfo('Vyth Aerir').starterRecruitment,true);assert.equal(window.getEconomyResidentInfo('Different Resident'),null);
});

test('retrieval tutorial verifies a real item handoff without enabling starter services or ordinary jobs',async()=>{
  const f=fixture();await offer(f);assert.equal(mission(f).starterRecruitment,true);assert.equal(mission(f).status,'offered');
  const view=E.view(f.state,'Vyth Aerir');assert.equal(view.error,undefined);assert.equal(view.service,null);assert.equal(view.venue,null);
  assert.equal(view.missions.length,1);assert.match(F.command(f.state,f.service,'accept favor from Vyth Aerir').content,/accepted/);
  f.inventory({name:'wind measuring ribbon',type:'other'});
  assert.match(require('../retort/itemTransfer').give(f.state,f.service,'give wind measuring ribbon to Vyth Aerir').content,/You give/);
  assert.match(F.command(f.state,f.service,'report to Vyth Aerir').content,/completed/);
  assert.match(F.command(f.state,f.service,'add Vyth Aerir to party').content,/joins the party/);
  assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name==='Vyth Aerir').type,'npc');
  for(const kind of ['buy','sell','heal','resurrect','lodge'])assert.match(E.action(f.state,f.service,{runId:'test-run',geoKey:'0,0,0',kind,actor:'Vyth Aerir',nonce:'blocked:'+kind,revision:E.project(f.state).revision}).error,/starter room/);
});

test('puzzle tutorial binds the existing mechanism, rejects narration and replacement puzzles, and completes on verified state',async()=>{
  const f=fixture();f.change(db=>{db['0,0,0'].puzzleMechanism=puzzle();db['0,0,0'].objects=[];});await offer(f,c=>c.find(x=>x.kind==='puzzle'));
  assert.equal(mission(f).objective.kind,'puzzle');F.command(f.state,f.service,'accept favor from Vyth Aerir');
  assert.equal(F.assess(mission(f),f.db()).passed,false);
  f.change(db=>{const p=db['0,0,0'].puzzleMechanism;for(const c of p.controls)if(p.state.values[p.controls.indexOf(c)]!==c.goal)p.state=P.step(p,p.state,c.id,c.goal);});
  assert.equal(F.assess(mission(f),f.db()).passed,true);
  const replaced=f.db();replaced['0,0,0'].puzzleMechanism.id='replacement';assert.equal(F.assess(mission(f),replaced).passed,false);
  assert.match(F.command(f.state,f.service,'report to Vyth Aerir').content,/completed/);
});

test('retrieval remains available and a distant or quest-protected target is never invented for the tutorial',()=>{
  const f=fixture();f.change(db=>db['0,0,0'].objects=[{name:'Loose Brass Ring',type:'other',attack_modifier:0,damage_modifier:0,ac:0}]);
  const choices=F.dialogueOptions(f.state,['Vyth Aerir'])[0].candidates;
  assert.ok(choices.some(c=>c.kind==='retrieve'&&c.item==='Loose Brass Ring'));
  assert.ok(!choices.some(c=>c.kind==='survey'));assert.ok(choices.every(c=>c.roomKey==='0,0,0'));
});

test('an approached starter contact greets the player without offering recruitment or inventing an invitation',async()=>{
  const f=fixture(),original=Work.request,schemas=[];
  Work.request=async(_$,component,schema,brief,validate)=>{
    schemas.push(schema);
    if(component==='story-scene'){
      assert.match(brief,/Required existing speakers:.*Vyth Aerir/);
      return validate({prose:'The resident turns to you.',interaction:'conversation',speakers:['Vyth Aerir']});
    }
    if(component==='npc-live-speech'){
      assert.deepEqual(schema.socialAction.enum,['none']);assert.deepEqual(schema.playerInvited.enum,[false]);
      assert.match(brief,/NO PLAYER INVITATION/);assert.doesNotMatch(brief,/offer-favor is required/);
      return validate({action:'gestures toward the threshold.',line:'Hello. The threshold stones carry the sound of the wind.',
        remember:'',socialAction:'none',playerInvited:false,recipient:'PC',attention:'passing',conditions:[],favorTitle:'',favorFocus:''});
    }
    return validate({lines:['The threshold is still here.','There is time to observe it.']});
  };
  try{
    await Narration.generate({},{consoleText:f.state.getUpdatedGameConsole(),encounter:true,userInput:'approach Vyth Aerir',
      characters:[{name:'Vyth Aerir',partyMember:false}],audibleNames:['Vyth Aerir'],socialInteractions:F.dialogueOptions(f.state,['Vyth Aerir'],{userInput:'approach Vyth Aerir'}),
      onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null});
    assert.equal(mission(f),undefined);
  }finally{Work.request=original;}
});
