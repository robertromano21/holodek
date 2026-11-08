'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I=require('../assets/dungeonInhabitants'),F=require('../retort/residentFavors'),N=require('../retort/holodekNarration'),Work=require('../retort/holodekRoomWork');
function from(file,expression){const target=require.resolve('./'+file+'.test.cjs'),source=fs.readFileSync(target,'utf8');
  return vm.runInNewContext(source.slice(0,source.indexOf("\ntest('"))+'\n'+expression,
    {require:require('node:module').createRequire(target),console,structuredClone});}
function dungeon(size=64){
  const d={geoKey:'0,0,0',_geometryStamp:'starter-test',layout:{width:size,height:size},start:{x:3,y:3},cells:{},classification:{indoor:true}};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:x&&y&&x<size-1&&y<size-1?'floor':'wall',floorHeight:0,ceilHeight:4};
  return d;
}
function population(){return I.createPopulation('0,0,0',Array.from({length:4},(_,i)=>({name:'Resident '+i,encounterId:'starter',allegiance:'Hostile'})),{starting:true});}

test('fresh starter groups vary across the reachable room rather than being forced in front of the entrance',()=>{
  const d=dungeon(),sites=[];
  for(let i=0;i<32;i++){
    const p=population();I.place(p,d,{random:()=>(i+.5)/32});assert.ok(p.groups[0].site);sites.push(p.groups[0].site);
    assert.ok(Object.values(p.actors).every(a=>a.allegiance==='Friendly'));
    assert.equal(new Set(Object.values(p.actors).map(a=>`${a.position.x},${a.position.y}`)).size,4);
    for(const a of Object.values(p.actors)){
      assert.ok(Math.abs(a.position.x-d.start.x)+Math.abs(a.position.y-d.start.y)>=4);
      assert.ok(Math.hypot(a.position.x-p.groups[0].site.x,a.position.y-p.groups[0].site.y)<=4);
    }
  }
  assert.ok(new Set(sites.map(p=>`${p.x},${p.y}`)).size>=24);
  assert.ok(Math.max(...sites.map(p=>p.x))-Math.min(...sites.map(p=>p.x))>30);
  assert.ok(Math.max(...sites.map(p=>p.y))-Math.min(...sites.map(p=>p.y))>30);
  assert.ok(sites.some(p=>Math.hypot(p.x-d.start.x,p.y-d.start.y)>I.MONSTER_DIALOGUE_RANGE));
});
test('the first placement seed survives saves and never rerolls or relocates an already placed group',()=>{
  const d=dungeon(),p=population();let rolls=0;I.place(p,d,{random:()=>{rolls++;return .42;}});
  const wire=JSON.stringify(p),restored=JSON.parse(wire);I.place(restored,d,{random:()=>{throw Error('Must not reroll');}});
  assert.equal(JSON.stringify(restored),wire);assert.equal(rolls,1);
  const fresh=population();fresh.starterPlacementSeed=p.starterPlacementSeed;I.place(fresh,d,{random:()=>{throw Error('Seed already saved');}});
  assert.deepEqual(fresh.groups.map(g=>g.site),p.groups.map(g=>g.site));
});
test('saved entrance-side sites remain unchanged even when created before randomized starter placement',()=>{
  const p=population(),d=dungeon();p.groups[0].site={x:4,y:3};
  for(const [i,a]of Object.values(p.actors).entries())a.position=a.home={x:4+i,y:3};
  const sites=JSON.stringify(Object.values(p.actors).map(a=>a.position));I.place(p,d,{random:()=>{throw Error('Existing game must not reroll');}});
  assert.equal(JSON.stringify(Object.values(p.actors).map(a=>a.position)),sites);assert.equal(p.starterPlacementSeed,undefined);
});
test('randomized starter sites avoid sealed chambers, items, exits and the player landing',()=>{
  const d=dungeon();for(let y=1;y<63;y++)d.cells[`40,${y}`].tile='wall';
  d.cells['10,10'].object={name:'an existing object'};d.cells['11,10'].exitMarker=true;
  const reachable=new Set(I.reachable(d).map(t=>`${t.x},${t.y}`));
  for(let i=0;i<24;i++){
    const p=population();I.place(p,d,{random:()=>(i+.5)/24});
    for(const a of Object.values(p.actors)){
      const cell=d.cells[`${a.position.x},${a.position.y}`];assert.ok(reachable.has(`${a.position.x},${a.position.y}`));
      assert.ok(a.position.x<40);assert.ok(!cell.object&&!cell.exitMarker);assert.notDeepEqual(a.position,d.start);
    }
  }
});
test('cramped starter rooms do not stack residents onto the player to force placement',()=>{
  const d=dungeon(7),p=population();d.start={x:3,y:3};
  for(const cell of Object.values(d.cells))cell.tile='wall';d.cells['3,3'].tile='floor';d.cells['3,4'].tile='floor';
  I.place(p,d,{random:()=>.5});assert.equal(p.groups[0].site,null);assert.ok(Object.values(p.actors).every(a=>!a.position));
});
test('non-starter placement ignores the new starter randomness',()=>{
  const d=dungeon(),make=()=>I.createPopulation('1,0,0',[{name:'Resident',encounterId:'regular'}]);
  const a=make(),b=make();I.place(a,d,{random:()=>0});I.place(b,d,{random:()=>.99});
  assert.deepEqual(a.groups.map(g=>g.site),b.groups.map(g=>g.site));assert.equal(a.starterPlacementSeed,undefined);
});
test('a legacy service anchor remains attached to its actual stall across different starter seeds',()=>{
  for(let i=0;i<24;i++){
    const d=dungeon(40);d.start={x:20,y:30};d.classification.indoor=false;
    d.sceneStructures=[{shape:'x_cyberpunk_stall',position:{x:7,y:8,z:0},size:{x:2,y:2,z:2}}];
    const p=I.createPopulation(d.geoKey,[{name:'Trader',serviceRole:'shop',encounterId:'vendor'}],{starting:true,indoor:false});
    I.place(p,d,{random:()=>(i+.5)/24});const at=p.actors.Trader.position;assert.ok(Math.hypot(at.x-8,at.y-11.5)<4);
  }
});
test('a guardian can only explain staying, never consent to recruitment or add a task',()=>{
  const f=from('group-recruitment','fixture({guardian:true});'),options=f.options(),guard=options.find(o=>o.name===f.mate);
  assert.deepEqual(Array.from(guard.actions),['explain-staying']);assert.equal(guard.staying,true);
  for(const socialAction of ['offer-favor','accept-invitation'])assert.throws(()=>F.applyDialogue(f.state,f.service,
    {speaker:f.mate,recipient:'PC',line:'I will come with you.',playerInvited:true,socialAction},guard),/not available/);
  assert.throws(()=>F.recruit(f.state,f.service,f.mate,null,{playerInvited:true}),/cannot join/);
  assert.equal(F.dialogueOptions(f.state,[f.mate],{userInput:'Hello.'}).length,0);
});
async function exchange(f,{failGuardian=false}={}){
  const prior=Work.request,options=f.options(),states=[],utterances=[];let index=0;
  Work.request=async(_$,component,schema,brief,validate)=>{
    if(component==='story-scene'){
      assert.match(brief,/Required existing speakers:.*Vyth Aerir.*Calthokael Qyas/);
      return validate({prose:'The two residents listen to your invitation.',interaction:'recruitment',speakers:f.names});
    }
    if(component==='npc-live-speech'){
      const guardian=index++===1;
      if(guardian){assert.deepEqual(schema.socialAction.enum,['explain-staying']);assert.equal(schema.taskPlan,undefined);assert.match(brief,/STAY-BEHIND RESPONSE/);
        if(failGuardian)throw Error('Guardian voice failed.');
      }
      const value={action:'nods.',line:guardian?'I must remain here to keep the entrance safe. May your road be kind.':'Bring me my measuring ribbon, and I will accompany you.',remember:'',
        recipient:'PC',attention:'addressing',playerInvited:true,socialAction:guardian?'explain-staying':'offer-favor',
        ...(guardian?{}:{favorTitle:'The Missing Ribbon',joinTiming:'after-task',departureLine:'',taskPlan:{retrieve:[{target:schema.taskPlan.type.retrieve.type[0].type.target.enum[0],instruction:'Find my measuring ribbon and give it to me.'}]}})};
      utterances.push(value.line);return validate(value);
    }
    return validate({lines:['There is work to finish here.','The entrance needs tending.']});
  };
  try{
    const result=await N.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput:f.input,characters:f.names.map(name=>({name,partyMember:false,
      ...(name===f.mate?{starterRecruitmentRole:'guardian',recruitable:false}: {})})),audibleNames:f.names,socialInteractions:options,location:null,
      onSocialAction:(event,option)=>{const outcome=F.applyDialogue(f.state,f.service,event,option);states.push(f.group().status);return outcome;}});
    return {result,states,utterances};
  }finally{Work.request=prior;}
}
test('the real invitation pipeline requires the guardian reply before sealing the group review',async()=>{
  const f=from('group-recruitment','fixture({guardian:true});'),{result,states}=await exchange(f);
  assert.deepEqual(states,['collecting','review']);assert.equal(f.missions().length,1);
  const member=f.group().members.find(m=>m.name===f.mate);assert.equal(member.outcome,'staying');assert.equal(member.responsePending,false);
  assert.match(member.line,/remain here/);assert.equal(member.consent,undefined);assert.equal(member.response.source,'engine-live-dialogue-v1');
  assert.ok(result.socialResults.some(r=>r.actor===f.mate&&r.action==='explain-staying'));
  const dialogue=I.extractDialogue(result.content,f.names,{audibleNames:f.names}).dialogue;
  assert.ok(dialogue.some(row=>row.speaker===f.mate&&row.line.includes('remain here')));
  const browser=from('subtitle-diagnostics','fixture();'),played=[];browser.actor.name=f.first;
  browser.ctx.actors.push({...browser.actor,name:f.mate,mazeX:5,mazeY:5});
  browser.root.HolodekSfx={stopSpeech(){},voicePrefetch(){},speakLine(speaker,line,opts){played.push({speaker,line});opts.onSchedule(1000,false);return Promise.resolve();}};
  browser.root.DungeonLife.receiveDialogue({...browser.event,dialogue,kind:'turn'});
  browser.root.DungeonLife.receiveTurnDialogue(result.content,{...browser.event,dialogue,consoleText:f.state.getUpdatedGameConsole()});
  for(let i=0;i<12;i++){browser.advance(20000);browser.root.DungeonLife.tick();}
  assert.equal(played.filter(row=>row.speaker===f.mate&&row.line.includes('remain here')).length,1);
});
test('a failed stay-behind reply cannot produce a half-authored group request or silently recruit anyone',async()=>{
  const f=from('group-recruitment','fixture({guardian:true});');await assert.rejects(exchange(f,{failGuardian:true}),/Guardian voice failed/);
  assert.equal(f.group().status,'collecting');assert.equal(f.missions().length,0);
  assert.ok(JSON.parse(f.state.getCombatCharactersString()).filter(a=>f.names.includes(a.name)).every(a=>a.type==='monster'));
});
test('an unreachable guardian does not add an impossible response prerequisite to a new nearby invitation',()=>{
  const f=from('group-recruitment','fixture({guardian:true});');
  for(let y=0;y<16;y++)f.d.cells[`4,${y}`].tile='wall';f.p.actors[f.first].position={x:3,y:4};
  const roster=JSON.parse(f.state.getCombatCharactersString());roster.find(a=>a.type==='pc').mazeX=2;roster.find(a=>a.name===f.first).mazeX=3;
  f.state.setCombatCharactersString(JSON.stringify(roster));f.change(db=>db[f.d.geoKey].inhabitants=f.p);
  const options=f.options();assert.equal(options.length,1);assert.equal(options[0].name,f.first);assert.equal(f.group(),undefined);
});
test('a saved completed invitation can gain its missing guardian explanation without reopening recruitment',()=>{
  const f=from('group-recruitment','fixture({guardian:true});');f.options();
  f.change(db=>{const g=Object.values(db[f.d.geoKey].recruitmentInvitations)[0];g.status='accepted';g.completedAt=123;
    g.members[0].outcome='ready';delete g.members[1].responsePending;});
  const roster=JSON.parse(f.state.getCombatCharactersString());roster.find(a=>a.name===f.first).type='npc';f.state.setCombatCharactersString(JSON.stringify(roster));
  const option=F.dialogueOptions(f.state,[f.mate],{userInput:'Please join my party.'})[0];
  F.applyDialogue(f.state,f.service,{speaker:f.mate,recipient:'PC',socialAction:'explain-staying',playerInvited:true,
    line:'I must stay here to tend the entrance.'},option);
  assert.equal(f.group().completedAt,123);assert.equal(f.group().status,'accepted');assert.equal(f.missions().length,0);
  assert.equal(f.group().members[1].line,'I must stay here to tend the entrance.');
  assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name===f.mate).type,'monster');
});
