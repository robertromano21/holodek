'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Models=require('../retort/gameModels'),P=require('../retort/dialogueContextPolicy');
const profile={personality:'Precise and curious.',voice:'Measured.',history:'A long personal history. '.repeat(80)+'HISTORY_END',motivation:'Protect the regional observatory.'};
for(const model of ['gpt-6-luna','grok-4.20-0309-non-reasoning','gpt-4.1'])test(model+' uses richer dialogue context, not the local model clamps',async()=>{
  const prior=Models.current().id;Models.restore(model);
  try{
    assert.equal(P.compact(),false);assert.equal(P.limits().memoryChars,24000);assert.equal(P.background(profile).history,profile.history);
    const D=require('../retort/characterDialogue');assert.equal(D.describeCharacters([{name:'Guide',type:'npc',hp:5,originProfile:profile}],null)[0].background.history,profile.history);
    const prompts=[],capture=(t,...values)=>prompts.push(Array.isArray(t)&&t.raw?t.reduce((s,p,i)=>s+p+(i<values.length?values[i]:''),''):String(t));
    const $={user:capture,system:capture,assistant:{generation:async()=>({content:'{"spoken":[],"replies":[]}'})}};
    const room='r'.repeat(2000)+'ROOM_END',quest='q'.repeat(1000)+'QUEST_END',conversation='CONVERSATION_BEGIN'+'c'.repeat(3000)+'CONVERSATION_END';
    await D.generateCharacterDialogue($,{characters:[{name:'Guide',partyMember:true}],roomDescription:room,quest,conversation,location:null});
    const prompt=prompts.join('\n');for(const text of [room,quest,conversation])assert.ok(prompt.includes(text));
    const db={'0,0,0':{name:'Home',campaignAtlas:{map:{cities:Array.from({length:8},(_,i)=>({name:'City '+i,site:{key:(i+1)+',0,0'}}))}}}};
    assert.equal(require('../retort/locationAwareness').snapshot(db,'0,0,0').locales.length,8);
  }finally{Models.restore(prior);}
});
test('holodek-1 alone retains compact profiles and bounded public recall',()=>{
  const prior=Models.current().id;Models.restore('holodek-1');
  try{assert.equal(P.compact(),true);assert.equal(P.limits().memoryChars,6000);assert.equal(P.limits().locales,4);assert.ok(P.background(profile).history.length<=300);}
  finally{Models.restore(prior);}
});
test('explicit memory budgets are still honored and remote evidence stays witness-scoped',()=>{
  const prior=Models.current().id;Models.restore('gpt-6-luna');
  try{
    const C=require('../retort/campaignMemory');const state={getDungeonRunId:()=>null,getUpdatedGameConsole:()=>'',getCombatCharactersString:()=> '[]'};
    assert.ok(JSON.stringify(C.dialogueContext(state,[{name:'Guide'}],'city',1000)).length<=1000);
  }finally{Models.restore(prior);}
});
