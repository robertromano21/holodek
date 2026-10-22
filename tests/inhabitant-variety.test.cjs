'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=process.env.HOLODEK_WEBSITE_SOURCE_ROOT||path.resolve(__dirname,'..');
const V=require(path.join(root,'retort/inhabitantVariety'));
const {generateInhabitants}=require(path.join(root,'retort/inhabitantGeneration'));
const fixtures=require(path.join(root,'tests/fixtures/inhabitants.cjs'));
const {templateContent}=require('retort-js/dist/message');
function room(name,when,job,activity,motivation){return{name,inhabitants:{authoredAt:when,actors:{[name+' resident']:{name:name+' resident',job,activity,motivation}}}};}
test('recent room concepts distinguish shared regional background from repeated personal scenarios',()=>{
  const rooms={'0,0,0':room('Temple',1,'mason','repairing a pillar','Restore the same broken column.'),
    '1,0,0':room('Road',2,'wellkeeper','arguing over water','Secure water rights.'),
    '2,0,0':room('Spring',3,'wellkeeper','arguing over water','Secure water rights.')};
  const before=JSON.stringify(rooms),brief=V.brief(rooms,'3,0,0');
  assert.equal(brief.frequentOccupations[0].job,'wellkeeper'); assert.equal(brief.frequentOccupations[0].rooms,2);
  assert.equal(brief.recentSituations[0].place,'Spring');
  const prompt=V.prompt(brief);
  assert.match(prompt,/not an earlier dispute with new names/); assert.match(prompt,/not an exhaustive profession list/);
  assert.match(prompt,/water-rights dispute/); assert.match(prompt,/pillar repairer/);
  assert.match(prompt,/Do not rewrite returning residents/); assert.equal(JSON.stringify(rooms),before);
});
test('regular rooms exclude their own cast; supplemental encounters contrast with current residents too',()=>{
  const rooms={'0,0,0':room('Temple',2,'mason','repairing a pillar','Finish a column')};
  assert.equal(V.brief(rooms,'0,0,0').recentSituations.length,0);
  assert.equal(V.brief(rooms,'0,0,0',{includeCurrent:true}).recentSituations.length,1);
  assert.match(V.prompt(V.brief(rooms,'0,0,0',{includeCurrent:true}),{encounter:true}),/CURRENT room/);
});
test('novelty context is bounded and contains only cast metadata, not secrets or inferred outcomes',()=>{
  const rooms={};for(let n=0;n<100;n++){
    rooms[`${n},0,0`]=room('Room '+n,n,'profession '+n+'x'.repeat(500),'activity '+'y'.repeat(500),'motivation '+'z'.repeat(500));
    rooms[`${n},0,0`].puzzleSolution='HIDDEN_SOLUTION';rooms[`${n},0,0`].inventory=['UNSEEN_TREASURE'];
  }
  const context=V.brief(rooms,'200,0,0'),json=JSON.stringify(context);
  assert.ok(json.length<=4600);assert.ok(context.frequentOccupations.length<=12);assert.ok(context.recentSituations.length<=12);
  assert.doesNotMatch(json,/HIDDEN_SOLUTION|UNSEEN_TREASURE/);assert.equal(context.recentSituations[0].key,'99,0,0');
});
test('new cast requests carry prior concepts without another model call, new constraints or changed allegiance mechanics',async()=>{
  const prompts=[],calls=[],rows=fixtures(2).map(r=>({...r,allegiance:'Hostile'}));
  const $={user:(s,...v)=>prompts.push(templateContent(s,...v)),assistant:{generation:async options=>{calls.push(options);return{content:JSON.stringify({inhabitants:rows})};}}};
  const records={'0,-1,0':room('Old Workshop',1,'carver','repairing a pillar','Finish the memorial.')};
  const before=JSON.stringify(records),result=await generateInhabitants($,{roomName:'Ruined Temple Entrance',roomDescription:'A roofed chamber.',geoKey:'0,0,0',indoor:true,rooms:records,
    campaignSetting:{pressure:'water rights and burial debts',livelihoods:['grave masonry']}},
    {random:(a,b)=>b===5?2:a,level:()=>1,sex:()=> 'Female',xp:()=>0,equipment:async()=>null});
  assert.equal(calls.length,1);assert.equal(JSON.stringify(records),before);
  assert.ok(prompts.some(p=>p.includes('Old Workshop')&&p.includes('ROOM-SPECIFIC SCENARIO VARIETY')));
  assert.ok(Object.values(result.population.actors).every(a=>a.allegiance==='Friendly'));
  assert.ok(result.population.authoredAt>0);
  assert.ok(Object.values(result.population.actors).every(a=>a.job==='grave mason'),'Guidance does not silently replace model-authored jobs or fail generation.');
  const ordinary=fs.readFileSync(path.join(root,'retort/retortWithUserInput.js'),'utf8');
  const encounters=fs.readFileSync(path.join(root,'retort/randomEncounters.js'),'utf8');
  assert.match(ordinary,/campaignSetting: room.campaignSetting, rooms: records/);assert.match(encounters,/rooms: db/);
});
test('default regional seeds no longer prescribe water rights and setting guidance does not require water in every room',()=>{
  const C=require(path.join(root,'retort/campaignSetting'));
  assert.ok(C.REGIONS.every(r=>!/water rights|burial debts|road tolls|contested riverbanks/.test(r.pressure)));
  assert.match(C.describe({region:'Test Region'}),/not a repeated room scenario/);
  assert.match(C.describe({region:'Test Region'}),/Only describe water or other resources actually supported/);
});
