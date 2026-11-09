'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const N=require('../retort/holodekNarration'),Work=require('../retort/holodekRoomWork'),I=require('../assets/dungeonInhabitants'),Plan=require('../retort/residentTaskPlan');
async function offer({kind='retrieve',conditions,joinTiming='after-task'}={}){
  const name='Tavren Oruul',target={id:kind+'-target',kind,item:'ash woven mantle',mechanismId:'threshold',roomKey:'0,0,0',roomName:'Ruined Temple Entrance'};
  const instruction=kind==='puzzle'?'Set the three levers to answer the Threshold Receiver. I will help you here.':'Bring me the ash woven mantle, and I will join your quest.';
  const before=Work.request,calls=[],commits=[];
  Work.request=async(_$,component,schema,brief,validate)=>{
    calls.push({component,schema,brief});
    if(component==='story-scene')return validate({prose:'Tavren considers your invitation.',interaction:'recruitment',speakers:[name]});
    if(component==='npc-live-speech')return validate({action:'gives you a rueful smile.',line:'Solve the puzzle and I will join you.',
      remember:'I asked you to solve the puzzle.',recipient:'PC',attention:'addressing',socialAction:'offer-favor',playerInvited:true,
      favorTitle:'A Mantle for the Unclaimed',taskPlan:conditions||{[kind]:[{target:target.id,instruction}]},joinTiming,
      departureLine:joinTiming==='help-here'?'The mechanism still needs my care. I will stay here.':''});
    return validate({lines:['A future remark.','Another future remark.']});
  };
  try{
    const result=await N.generate({},{consoleText:'Room Name: Ruined Temple Entrance\nRoom Description: A roofed hall.',
      userInput:'Ask Tavren to join my party',characters:[{name,partyMember:false}],audibleNames:[name],location:null,
      socialInteractions:[{name,starterFavor:true,actions:['offer-favor'],candidates:[target]}],
      onSocialAction:event=>{commits.push(event);return{actor:name,action:event.socialAction};}});
    return{result,calls,commits,instruction,parsed:I.extractDialogue(result.content,[name])};
  }finally{Work.request=before;}
}
test('the logged puzzle-versus-mantle mismatch cannot become a hidden accepted requirement',async()=>{
  const f=await offer();assert.equal(f.parsed.dialogue[0].line,f.instruction);
  assert.match(f.parsed.content,/ash woven mantle/);assert.doesNotMatch(f.parsed.content,/Solve the puzzle/);
  assert.equal(f.commits[0].line,f.parsed.dialogue[0].line);assert.equal(f.commits[0].remember,'');
  assert.equal(f.calls.length,3,'Use the same authored task, not a new model call or generated stock dialogue');
});
test('every authored condition is spoken, not only the first condition',()=>{
  const conditions=[{instruction:'Find my journal.'},{instruction:'Read its first chapter before giving it to me.'}];
  assert.equal(Plan.spokenRequest(conditions),'Find my journal. Read its first chapter before giving it to me.');
  assert.throws(()=>Plan.spokenRequest([{instruction:''}]),/spoken instruction/);
  const schema=Plan.parameter([{id:'item',kind:'retrieve'}]);assert.match(schema.type.retrieve.type[0].type.instruction.description,/exact words become your spoken/);
});
test('new puzzle recruits use the existing provisional-help mode and supply an authored farewell',async()=>{
  const f=await offer({kind:'puzzle',joinTiming:'help-here'}),voice=f.calls.find(c=>c.component==='npc-live-speech');
  assert.deepEqual(voice.schema.joinTiming.enum,['help-here']);assert.equal(f.commits[0].joinTiming,'help-here');
  assert.match(f.commits[0].departureLine,/stay here/);assert.equal(f.parsed.dialogue[0].line,f.instruction);
});
test('group progress distinguishes fulfilled puzzles from a pending item handoff and explains its disabled button',()=>{
  const file=require.resolve('./recruitment-delivery.test.cjs'),source=fs.readFileSync(file,'utf8');
  const f=vm.runInNewContext(source.slice(0,source.indexOf("\ntest('"))+'\ncommerce();',{require:createRequire(file),console,structuredClone});
  const group={id:'group',status:'accepted',members:[
    {name:f.actor.name,outcome:'conditional',missionId:f.mission.id,status:'completed',description:'Solve the threshold mechanism.'},
    {name:'Tavren Oruul',outcome:'conditional',missionId:'mantle',status:'accepted',description:'Give me the ash woven mantle.'}]};
  const m={...f.mission,status:'completed',invitationPending:true,recruitmentGroup:group};
  f.window.CommerceUi.receiveResult({...f.event(),recruitmentRequests:[m]});
  const actions=f.document.createElement('div');f.body.appendChild(actions);f.window.CommerceUi.addAction(actions,f.actor.name);
  f.button('Recruitment Progress').click();
  const text=f.nodes.filter(n=>n.isConnected).map(n=>n.textContent||'').join('\n');
  assert.match(text,/Still needed: Tavren Oruul/);assert.match(text,/\(Verified\)/);assert.match(text,/\(Still Needed\)/);
  const finish=()=>f.nodes.filter(n=>n.isConnected&&n.tag==='button'&&n.textContent==='Complete Party Invitation').at(-1);
  assert.equal(finish().disabled,true);assert.match(finish().title,/Tavren/);
  f.button('Close').click();group.members[1].status='completed';f.button('Recruitment Progress').click();
  assert.equal(finish().disabled,false);
});
test('the Ivrin-style mixed group records solved puzzles, waits for the real handoff, then joins automatically exactly once',()=>{
  const file=require.resolve('./group-recruitment.test.cjs'),source=fs.readFileSync(file,'utf8');
  const f=vm.runInNewContext(source.slice(0,source.indexOf("\ntest('"))+
    '\n(()=>{const f=fixture({third:true});offerAll(f);return {...f,puzzle:from("cotg-starter-recruitment","puzzle();")};})()',
    {require:createRequire(file),console,structuredClone,__dirname:require('node:path').dirname(file)});
  const F=require('../retort/residentFavors'),P=require('../retort/recruitmentProgress'),Give=require('../retort/itemTransfer');
  F.command(f.state,f.service,'accept request from '+f.first);
  const puzzle=f.puzzle;puzzle.id='threshold';for(const control of puzzle.controls)
    if(puzzle.state.values[puzzle.controls.indexOf(control)]!==control.goal)puzzle.state=require('../assets/physicalPuzzles').step(puzzle,puzzle.state,control.id,control.goal);
  f.change(db=>{db[f.d.geoKey].puzzleMechanism=puzzle;
    for(const[index,m]of Object.values(db[f.d.geoKey].minorMissions).entries()){
      m.objective=index===1?{id:'mantle',kind:'retrieve',item:'ash woven mantle',roomKey:f.d.geoKey}:
        {id:'puzzle',kind:'puzzle',mechanismId:puzzle.id,roomKey:f.d.geoKey};m.conditions=[m.objective];
    }});
  assert.equal(P.advance(f.state,f.service).length,1);
  assert.equal(f.missions().filter(m=>m.status==='completed').length,2);
  assert.ok(f.names.every(name=>JSON.parse(f.state.getCombatCharactersString()).some(a=>a.name===name&&a.type==='monster')));
  f.inventory({name:'ash woven mantle',type:'armor',attack_modifier:0,damage_modifier:0,ac:1,magic:0});
  assert.match(Give.give(f.state,f.service,'give ash woven mantle to '+f.names[1]).content,/You give/);
  P.advance(f.state,f.service);
  const roster=JSON.parse(f.state.getCombatCharactersString());
  for(const name of f.names)assert.equal(roster.filter(a=>a.name===name&&a.type==='npc').length,1);
  assert.ok(f.missions().every(m=>m.status==='completed'&&m.recruitedAt));
  assert.equal(P.advance(f.state,f.service).length,0);
});
