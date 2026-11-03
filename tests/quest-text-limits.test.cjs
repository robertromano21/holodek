'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Work=require('../retort/holodekRoomWork'),C=require('../retort/generationContracts'),Models=require('../retort/gameModels');
const paragraph='Seek The Ashen Measure in the Ossuary of Unfinished Names, where Griefmaw the Hollow Regent keeps vigil among the soul-ledgers of Tartarus\u2019s dead. The Measure is said to weigh not bodies, but the names and memories that survive them; Griefmaw claims that no soul should pass while its story remains unfinished. Learn what the Regent is guarding, face the danger of its vigil, and recover the artifact without mistaking possession for rightful judgment. Outside, Tartarus\u2019s yellow sky stains the ash wastes beyond the ossuary, while wind worries the sealed stone and carries rumors of a deeper corruption in the passage from death to rest.';

test('the exact 638-character quest paragraph from the failed travel is accepted intact',()=>{
  assert.equal(paragraph.length,638);assert.equal(Work.questDescription(paragraph),paragraph);
  assert.equal(Work.questDescription(paragraph.repeat(20)),paragraph.repeat(20));
});

test('authored quest names are not rejected for character or word counts',()=>{
  const name='The Memorial Repository of Forgotten Names Beneath the Last Mountain';
  assert.ok(name.split(' ').length>5);assert.equal(Work.questName(name),name);
  assert.equal(Work.questName(name+' of the Fallen Kingdoms Beyond the Sea'),name+' of the Fallen Kingdoms Beyond the Sea');
  for(const value of ['', 'None','Unknown','Unassigned Boss','bad\nname'])assert.throws(()=>Work.questName(value),/name:/);
  for(const value of ['', 'None','Unknown','bad\nparagraph'])assert.throws(()=>Work.questDescription(value),/description:/);
});

test('quest schemas remove text ceilings without changing enums, list bounds, patterns or the original schema',()=>{
  const parameters={title:C.text(70),rows:{type:C.list({name:C.nonblankText(40),desc:C.text(600)}),minItems:1,maxItems:3},
    action:C.choice(['read','defeat']),count:{type:Number,minimum:1,maximum:3}};
  const next=Work.questParameters(parameters);
  assert.equal(next.title.maxLength,undefined);assert.equal(next.rows.type[0].type.desc.maxLength,undefined);
  assert.equal(next.rows.type[0].type.name.maxLength,undefined);assert.equal(next.rows.type[0].type.name.pattern,parameters.rows.type[0].type.name.pattern);
  assert.equal(next.rows.minItems,1);assert.equal(next.rows.maxItems,3);assert.deepEqual(next.action.enum,['read','defeat']);
  assert.equal(next.count.maximum,3);assert.equal(parameters.title.maxLength,70);assert.equal(parameters.rows.type[0].type.desc.maxLength,600);
});

function agent(answer){
  const requests=[],messages=[],$={model:'gpt-6-luna',user:async text=>messages.push(text),run:async fn=>fn($),
    assistant:{generation:async options=>{requests.push(options);return{content:JSON.stringify(answer)}}}};
  return{$,requests,messages};
}

test('cloud quest contracts accept long authored paragraphs on their first attempt',async()=>{
  const before=Models.current().id;Models.restore('gpt-6-luna');
  try{
    const f=agent({description:paragraph}),reply=await Work.questReply(f.$,'quest-premise',{description:C.text(600)},
      {artifact:'The Ashen Measure',boss:'Griefmaw the Hollow Regent'},'Write the bound quest paragraph.');
    assert.equal(reply.result.description,paragraph);assert.equal(f.requests.length,1);
    assert.equal(f.requests[0].parameters.description.maxLength,undefined);assert.equal(f.requests[0].parameters.description.minLength,1);
  }finally{Models.restore(before);}
});

for(const preparation of [{bossKey:'2,0,0'},{}])test('the actual cloud opening pipeline uses corrected contracts, not unvalidated raw replies: '+JSON.stringify(preparation),async()=>{
  const source=fs.readFileSync(require.resolve('../retort/retortWithUserInput'),'utf8');
  const start=source.indexOf('async function generateQuest('),end=source.indexOf('\nfunction allocateXP(',start);
  let quest='None',tasks=[],index=0,seeded=false,text='Coordinates: X: 0, Y: 0, Z: 0\nRooms Visited: 1\nNext Artifact: None\nNext Boss: None\nNext Boss Room: None\nBoss Room Coordinates: None\nCurrent Quest: None';
  const calls=[],replies={'quest-artifact-name':'The Ashen Measure','quest-boss-name':'Griefmaw the Hollow Regent','quest-boss-location':'The Ossuary of Unfinished Names'};
  const sharedState={getCurrentTaskIndex:()=>index,getCurrentQuest:()=>quest,getCurrentTasks:()=>tasks,
    setCurrentQuest:v=>{quest=v},setCurrentTasks:v=>{tasks=v},setCurrentTaskIndex:v=>{index=v},setQuestSeeded:v=>{seeded=v},setUpdatedGameConsole:v=>{text=v}};
  const generate=vm.runInNewContext('('+source.slice(start,end).trim()+')',{
    WorldSetting:{current:()=>null},StoryPrompts:{isHolodek1:()=>false},sharedState,updatedGameConsole:text,roomNameDatabaseString:'{}',
    Divinity:{finalStage:()=>false},FortifiedSites:{bossCandidates:()=>[]},snapshotQuestContext:()=>({}),Pantheon:{name:()=>null},
    console:{log(){},error(){},warn(){}},require:id=>{assert.equal(id,'./holodekRoomWork');return{...Work,questReply:async(_$,component,parameters)=>{
      calls.push(component);assert.ok(Object.values(parameters).every(p=>p.maxLength===undefined));
      return{result:component==='quest-premise'?{description:paragraph}:{name:replies[component]}};
    }}}
  });
  await generate({assistant:()=>{throw Error('Raw foreground model generation must not run.')}},preparation);
  assert.deepEqual(calls,['quest-artifact-name','quest-boss-name','quest-boss-location','quest-premise']);
  assert.equal(quest,paragraph);assert.ok(text.includes('Current Quest: '+paragraph));assert.equal(seeded,false);assert.equal(index,0);
});
