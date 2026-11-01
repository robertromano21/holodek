'use strict';
process.env.HOLODEK_GENRE_EXPANSION='1';
const test=require('node:test'),assert=require('node:assert/strict'),Setting=require('../retort/settingLayer'),
  fixture=require('./fixtures/authored-world.cjs'),RD=require('../retort/roomDescription');
function runner(value,messages=[]){return work=>work({user:async text=>messages.push(String(text)),assistant:{generation:async()=>({content:JSON.stringify(value)})}});}
for(const genre of Object.keys(require('../assets/genreKits').GENRES))test('production '+genre+' campaign is wholly model-authored without a sample plot or preset place names',async()=>{
  const authored=fixture(genre),messages=[],b=await Setting.generate('An original game',{picked:[genre],worldSeed:'repeatable-test',
    prompt:'Start in a mountain trading city.',instructions:'No coastal setting.',runner:runner(authored,messages)});
  assert.equal(b.name,authored.name);assert.equal(b.source,'model-authored');assert.equal(b.protagonist,authored.protagonist);
  assert.equal(b.currency.singular,'mark');assert.deepEqual(Setting.firstRoom(b),{name:authored.opening.name,description:''});
  const prompt=messages.join('\n');assert.match(prompt,/mountain trading city/);assert.match(prompt,/No coastal setting/);
  assert.doesNotMatch(prompt,/Use this skeleton|Lowgate|High Seat|Directorate|Quiet Choir|Pale Judge|Green Mother|Sump Decks|Quay/);
});
test('incomplete model authorship fails explicitly rather than supplying stock campaign fields',async()=>{
  const value=fixture('fantasy');delete value.resourceName;
  await assert.rejects(Setting.generate('Original game',{runner:async()=>value}),/resourceName/);
  await assert.rejects(Setting.generateMaster(fixture('fantasy'),'Original game',{runner:async()=>({gmName:'The Weaver',premise:'One sentence.'})}),/campaign section/);
});
test('homebrew descriptions reuse room construction with their own saved campaign, not canonical lore or concatenated fragments',async()=>{
  const b={...fixture('fantasy'),kind:'homebrew',masterPrompt:'You author Aster Treaty. The mountain trading city has terraced stone buildings.'};
  Setting.setActive(b);
  try{
    const target={name:'The Eastern Tollhouse',coordinates:'0,0,0',classification:{indoor:true},
      worldContext:{physicalPlan:{composition:'rotunda-and-wings',clearance:4.8}},physicalGuidance:['Preserve the built geometry.']},
      prompt=RD.creationPrompt(target),messages=[];
    assert.match(prompt,/Aster Treaty/);assert.match(prompt,/rotunda-and-wings/);assert.doesNotMatch(prompt,/Tartarus|Mortacia|Grave Master/);
    const prose='Stone ribs cross a vaulted tollhouse, where wind murmurs through the eastern shutters.';
    const result=await RD.generate({user:async text=>messages.push(text),assistant:{generation:async()=>({content:prose})}},target);
    assert.equal(result,prose);assert.equal(messages.length,1);
  }finally{Setting.setActive(null);}
});
