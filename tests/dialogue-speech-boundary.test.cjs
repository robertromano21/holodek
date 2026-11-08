'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const I=require('../assets/dungeonInhabitants'),Narration=require('../retort/holodekNarration'),Work=require('../retort/holodekRoomWork');
const name='Orvek Flintwake';
const mixed='\u201cThat last name you recited\u2014\u201d Orvek\u2019s voice comes softly, with a pause as the stone\u2019s answer dies away. '+
  '\u201cI know the cadence around it, not the soul behind it. The funeral rhythm breaks just before the name, as if later voices were laid over the original.\u201d '+
  'He withdraws his hand from the pillar. \u201cI can compare it with the next section of the wall, if you\u2019d like. I won\u2019t claim the rhythm tells us who had the right to mourn.\u201d';
const expected='That last name you recited\u2014 I know the cadence around it, not the soul behind it. The funeral rhythm breaks just before the name, '+
  'as if later voices were laid over the original. I can compare it with the next section of the wall, if you\u2019d like. I won\u2019t claim the rhythm tells us who had the right to mourn.';

test('the logged Orvek reply separates all three spoken passages without losing their order',()=>{
  const passages=I.speechPassages(mixed,name);
  assert.equal(passages.length,3);assert.ok(passages.every(p=>p.quoted));
  assert.equal(I.spokenLine(mixed,name),expected);
  for(const p of passages)assert.equal(mixed.slice(p.start+1,p.end-1).trim(),p.line);
});
for(const raw of [
  'I can compare the next section of the wall.',
  'I call that mark "the gate". Follow me.',
  '"Borrowed Silence" is just the name of the hall.',
  'They called it "unfinished", but I disagree.',
  '"No." I can give no other answer.',
  '"No." It is too late.',
  '"Wait." They will be here soon.',
  '"Never." He must stay here.',
  'He said "wait", but I chose to leave.',
  '"I call it "the gate". Follow me."',
  '\u201cWait. He withdraws his hand from the pillar.',
  '"Wait." He withdraws his hand. "An unfinished reply',
  'Don\u2019t mistake the pillars\u2019 marks for names.'
])test('ambiguous or ordinary speech remains intact: '+raw,()=>{
  assert.equal(I.spokenLine(raw,name),raw);
});
for(const raw of ['"I can help."',' \u201cI can help.\u201d '])test('a complete speech envelope is unwrapped: '+raw,()=>{
  assert.equal(I.spokenLine(raw,name),'I can help.');
});
test('straight quotes and explicit speaker attribution separate narration',()=>{
  assert.equal(I.spokenLine('Orvek says, "Wait here." He points to the door. "I will return."',name),'Wait here. I will return.');
  assert.equal(I.spokenLine('"Wait here," he says.',name),'Wait here,');
});
test('nested and escaped quotations inside spoken passages survive extraction',()=>{
  const nested='\u201cShe called it \u201cthe gate\u201d yesterday.\u201d He points. \u201cI agree.\u201d';
  assert.equal(I.spokenLine(nested,name),'She called it \u201cthe gate\u201d yesterday. I agree.');
  assert.equal(I.spokenLine('"She called it \\"the gate\\" yesterday." He points. "I agree."',name),
    'She called it \\"the gate\\" yesterday. I agree.');
});
test('legacy labelled mixed speech keeps narration in the log but not in subtitle/SID input',()=>{
  const raw=`${name} taps the stone. "[[SPEECH:${JSON.stringify(name)}]]${mixed}[[/SPEECH]]"`+
    '\n\n[[CHARACTER_DIALOGUE]]'+JSON.stringify({spoken:[{speaker:name,recipient:'PC',attention:'addressing',remember:'The cadence is familiar.'}]})+'[[/CHARACTER_DIALOGUE]]';
  const result=I.extractDialogue(raw,[name]);
  assert.match(result.content,/He withdraws his hand from the pillar/);
  assert.match(result.content,/voice comes softly/);assert.doesNotMatch(result.content,/\[\[/);
  assert.equal(result.dialogue.length,1);assert.equal(result.dialogue[0].line,expected);
  assert.equal(result.dialogue[0].attention,'addressing');assert.equal(result.dialogue[0].recipient,'PC');
  assert.equal(result.dialogue[0].remember,'The cadence is familiar.');
  assert.doesNotMatch(I.splitSpeech(result.dialogue[0].line).join(' '),/withdraws|voice comes/);
});
test('unknown speakers do not gain speech attribution through quoted extraction',()=>{
  const result=I.extractDialogue(`[[SPEECH:"Unknown"]]${mixed}[[/SPEECH]]`,[name]);
  assert.equal(result.dialogue.length,0);assert.match(result.content,/withdraws/);
});
test('reply alternatives, exchanges and legacy dialogue metadata receive the same speech-only treatment',()=>{
  assert.equal(I.sanitizeReplies([{speaker:name,lines:[mixed]}],[name])[0].lines[0],expected);
  const exchanges=I.sanitizeExchanges([{lines:[{speaker:name,line:mixed},{speaker:'Sella Venn',line:'I agree.'}]}],[name,'Sella Venn']);
  assert.equal(exchanges[0].lines[0].line,expected);
  const parsed=I.extractDialogue('[[CHARACTER_DIALOGUE]]'+JSON.stringify({spoken:[{speaker:name,line:mixed}]})+'[[/CHARACTER_DIALOGUE]]',[name]);
  assert.equal(parsed.dialogue[0].line,expected);
  assert.deepEqual(I.sanitizeReplies([{speaker:name,lines:[42,null]}],[name]),[]);
});
async function generate(line,{invite=false}={}){
  const original=Work.request,calls=[],commits=[];
  Work.request=async(_$,component,parameters,brief,validate)=>{
    calls.push({component,parameters,brief});
    const raw=component==='story-scene'?{prose:'The resident turns to listen.',speakers:[name],...(invite?{interaction:'recruitment'}:{})}:
      component==='npc-live-speech'?{action:'taps the stone.',line,remember:'',recipient:'PC',attention:'addressing',
        ...(invite?{socialAction:'accept-invitation',playerInvited:true,conditions:[],favorTitle:'',favorFocus:''}:{})}:
      {lines:[mixed,mixed]};
    return validate(raw);
  };
  try{
    const result=await Narration.generate({},{consoleText:'Room Name: Ruined Temple Entrance\nRoom Description: A roofed hall.',
      userInput:invite?'Please join us.':'What do you hear?',encounter:!invite,location:null,
      characters:[{name,partyMember:true}],audibleNames:[name],
      socialInteractions:invite?[{name,actions:['none','accept-invitation'],candidates:[]}]:[],
      onSocialAction:async value=>{commits.push(value);return null;}});
    return{result,calls,commits};
  }finally{Work.request=original;}
}
test('ordinary encounters get a universal speech boundary and compile mixed lines without another model call',async()=>{
  const {result,calls}=await generate(mixed);
  assert.equal(calls.length,3);
  const live=calls.find(c=>c.component==='npc-live-speech'),cache=calls.find(c=>c.component==='npc-reply-cache');
  assert.match(live.brief,/SPEECH BOUNDARY/);assert.match(live.parameters.line.description,/Only the words spoken aloud/);
  assert.match(live.parameters.action.description,/third-person stage directions/);
  assert.match(cache.brief,/without stage directions/);
  assert.doesNotMatch(cache.brief,/withdraws his hand|voice comes softly/);
  const parsed=I.extractDialogue(result.content,[name]);
  assert.equal(parsed.dialogue[0].line,expected);assert.match(parsed.content,/He withdraws his hand/);
  assert.equal((result.content.match(/\[\[SPEECH:/g)||[]).length,3);
  assert.equal(parsed.replies[0].lines[0],expected);
});
test('social actions receive only actual spoken consent while gestures stay visible',async()=>{
  const {result,commits}=await generate('"Yes, I will join you." He lowers his hand.',{invite:true});
  assert.equal(commits.length,1);assert.equal(commits[0].line,'Yes, I will join you.');
  assert.equal(commits[0].playerInvited,true);assert.equal(commits[0].socialAction,'accept-invitation');
  const parsed=I.extractDialogue(result.content,[name]);
  assert.equal(parsed.dialogue[0].line,'Yes, I will join you.');assert.match(parsed.content,/He lowers his hand/);
});
test('correct unquoted live speech still follows the normal labelled pipeline',async()=>{
  const {result}=await generate('I can compare the next section of the wall.');
  assert.equal(I.extractDialogue(result.content,[name]).dialogue[0].line,'I can compare the next section of the wall.');
});
test('long authored speech is preserved without a length rejection, truncation or extra model request',async()=>{
  const long='I can help you compare the inscriptions. '.repeat(150).trim();
  const {result,calls}=await generate('"'+long+'" He lowers his hand.');
  assert.equal(calls.length,3);assert.equal(I.extractDialogue(result.content,[name]).dialogue[0].line,long);
});
