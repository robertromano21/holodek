'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const A=require('../assets/dialogueAudience'),I=require('../assets/dungeonInhabitants'),N=require('../retort/holodekNarration'),Work=require('../retort/holodekRoomWork');
const cast=[{name:'Ivrin Sablewing',partyMember:false,allegiance:'Friendly',race:'Ash-moth spirit',activity:'Recites remembered names.'},
  {name:'Tavren Oruul',partyMember:false,allegiance:'Neutral'},
  {name:'Keshta Vell',partyMember:true,allegiance:'Friendly'},
  {name:'Ashfang',partyMember:false,allegiance:'Hostile'}];
const roster=cast.map(a=>({...a,type:a.partyMember?'npc':'monster',hp:20}));
async function generate({input='Ask Ivrin about the name carried for centuries',speakers=[],audible=cast.map(a=>a.name),line,
  speech={},policy,characters=cast,replyOnly=false,prose='Ivrin pauses his recitation and turns toward you.'}={}){
  const calls=[],before=Work.request;
  Work.request=async(_$,component,parameters,brief,validate)=>{
    calls.push({component,parameters,brief});
    if(component==='story-scene')return validate({prose,speakers:[...speakers]});
    if(component==='npc-live-speech'){
      const name=JSON.parse(brief.match(/Write ONLY ("(?:[^"\\]|\\.)*")'s complete reply/)[1]);
      return validate({action:'looks toward you.',line:typeof line==='function'?line(name):line||'The name is Elreth. I have carried it since the storm took my roost.',
        remember:'',recipient:'PC',attention:'addressing',...speech});
    }
    return validate({lines:['A future alternative, not a reply now.','Another future alternative, not a reply now.']});
  };
  try{
    const result=await N.generate({},{consoleText:'Room Name: Ruined Temple Entrance\nRoom Description: A roofed chamber.',
      userInput:input,characters,audibleNames:audible,responseAudience:policy,replyOnly,location:null});
    const effective=policy||A.resolve(input,roster,audible);
    return{result,calls,parsed:I.extractDialogue(result.content,cast.map(a=>a.name),{audibleNames:audible,responsePolicy:effective})};
  }finally{Work.request=before;}
}
test('the exact Ivrin question gets actual speech even when the scene planner selects nobody',async()=>{
  const policy=A.resolve('Ask Ivrin about the name carried for centuries',roster,cast.map(a=>a.name));
  assert.deepEqual(policy.responders,['Ivrin Sablewing']);
  const {parsed,calls}=await generate({policy});
  assert.equal(parsed.dialogue.length,1);assert.equal(parsed.dialogue[0].speaker,'Ivrin Sablewing');
  assert.match(parsed.dialogue[0].line,/Elreth/);assert.match(parsed.content,/Ivrin Sablewing.*"The name is Elreth/s);
  assert.deepEqual(calls.map(c=>c.component),['story-scene','npc-live-speech','npc-reply-cache']);
  const live=calls.find(c=>c.component==='npc-live-speech');assert.match(live.brief,/REQUIRED DIRECT REPLY/);
  assert.deepEqual(live.parameters.recipient.enum,['PC']);assert.deepEqual(live.parameters.attention.enum,['addressing','question']);
  assert.equal(A.missingResponses(policy,parsed.dialogue).length,0);
});
test('direct-address enforcement also works for a companion without social or recruitment options',async()=>{
  const {parsed}=await generate({input:'Ask Keshta about the carving',line:'The carving preserves a promise, not a command.'});
  assert.deepEqual(parsed.dialogue.map(r=>r.speaker),['Keshta Vell']);
});
test('a hostile answers in character without gaining consent, dealing damage or changing the saved cast',async()=>{
  const before=JSON.stringify(cast),{parsed,calls}=await generate({input:'Tell Ashfang to stand aside',line:'No. Come closer and I will tear you apart.'});
  assert.deepEqual(parsed.dialogue.map(r=>r.speaker),['Ashfang']);assert.match(parsed.dialogue[0].line,/tear you apart/);
  assert.equal(JSON.stringify(cast),before);assert.match(calls.find(c=>c.component==='npc-live-speech').brief,/do not invent an attack result/);
});
test('a non-speaking creature can make an audible warning, not acquire invented language',async()=>{
  const {parsed}=await generate({input:'Speak to Ashfang',line:'Hrrrr!'});assert.equal(parsed.dialogue[0].line,'Hrrrr!');
});
test('an addressed group gets one responder rather than a whole-room chorus',async()=>{
  const {parsed}=await generate({input:'Ask the residents about the names'});
  assert.equal(parsed.dialogue.length,1);assert.equal(parsed.dialogue[0].speaker,'Ivrin Sablewing');
  const selected=await generate({input:'Ask the residents about the names',speakers:['Tavren Oruul']});
  assert.deepEqual(selected.parsed.dialogue.map(r=>r.speaker),['Tavren Oruul']);
});
test('every explicitly named reachable recipient answers and unrelated companions stay quiet',async()=>{
  const {parsed}=await generate({input:'Ask Ivrin and Tavren about the carving'});
  assert.deepEqual(parsed.dialogue.map(r=>r.speaker),['Ivrin Sablewing','Tavren Oruul']);
});
test('an unavailable addressee never becomes a distant reply or a substitute companion',async()=>{
  const {parsed,calls}=await generate({audible:['Keshta Vell'],prose:'Ivrin cannot hear you from here.'});
  assert.deepEqual(parsed.dialogue,[]);assert.deepEqual(calls.map(c=>c.component),['story-scene']);
});
test('ordinary exploration is still permitted to have no dialogue',async()=>{
  const {parsed,calls}=await generate({input:'Look at the carving'});
  assert.deepEqual(parsed.dialogue,[]);assert.equal(calls.length,1);
});
for(const speech of[{line:' '},{recipient:'Tavren Oruul'},{attention:'passing'}])test('a direct reply cannot be replaced by '+JSON.stringify(speech),async()=>{
  await assert.rejects(generate({speech}),/nonempty|actual live reply/);
});
test('the post-extraction guard ignores cached future lines when checking live replies',()=>{
  const policy=A.resolve('Ask Ivrin about the names',roster,cast.map(a=>a.name));
  assert.deepEqual(A.missingResponses(policy,[]),['Ivrin Sablewing']);
  assert.deepEqual(A.missingResponses(policy,[{speaker:'Keshta Vell',recipient:'PC',line:'A substitute answer.'}]),['Ivrin Sablewing']);
  assert.deepEqual(A.missingResponses(policy,[{speaker:'Ivrin Sablewing',recipient:'Tavren Oruul',line:'An aside.'}]),['Ivrin Sablewing']);
  assert.deepEqual(A.missingResponses(policy,[{speaker:'Ivrin Sablewing',recipient:'PC',line:'I cannot tell you that.'}]),[]);
});
test('an omitted non-local reply can be supplied without rewriting its scene or refreshing the cache again',async()=>{
  const {parsed,calls}=await generate({replyOnly:true});
  assert.deepEqual(calls.map(c=>c.component),['npc-live-speech']);
  assert.equal(parsed.dialogue[0].speaker,'Ivrin Sablewing');assert.doesNotMatch(parsed.content,/pauses his recitation/);
});
test('the production final-story route checks and supplies missing replies for every model without replacing valid narration',()=>{
  const source=fs.readFileSync('retort/retortWithUserInput.js','utf8');
  assert.ok(source.includes('DialogueAudience.missingResponses(responseAudience, spoken.dialogue)'));
  assert.ok(source.includes('replyOnly:true'));
  assert.ok(source.includes('requiredSpeakers:unanswered'));
  assert.ok(source.includes('requestedResponders:responseAudience?.responders'));
});
