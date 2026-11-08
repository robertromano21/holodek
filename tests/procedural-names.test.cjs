'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Names=require('../assets/proceduralNames'),Pantheon=require('../assets/pantheonCharacters');
const profile={prefixes:['Kel','Ven','Sor'],middles:['a','en','il'],endings:['in','el','os']};
const genreTest=(name,run)=>test(name,()=>require('../retort/settingLayer').withDraft(
  {kind:'homebrew',...require('./fixtures/authored-world.cjs')('fantasy')},run));
test('browser and server use the same seeded generator and original game vocabulary',()=>{
  const sandbox={window:{}};vm.runInNewContext(fs.readFileSync('assets/proceduralNames.js','utf8'),sandbox);
  for(let i=0;i<100;i++)assert.equal(sandbox.window.ProceduralNames.generate({seed:i}),Names.generate({seed:i}));
  assert.ok(Names.LEGACY.people.prefixes.includes('Athr'));assert.ok(Names.LEGACY.creature.prefixes.includes('Thrak'));
  for(const p of Object.values(Names.LEGACY))for(const rows of Object.values(p))assert.equal(rows.length,new Set(rows).size);
});
test('thousands of new random identities avoid existing, reserved and case-insensitive names',()=>{
  const used=new Set(['The Keeper',...Pantheon.names]);
  for(let i=0;i<2000;i++){
    const name=Names.generate({seed:'extras-'+i,monster:i%2===0,used,isReserved:n=>!!Pantheon.name(n)});
    assert.match(name,/^[A-Z][a-z]+(?: [A-Z][a-z]+){0,2}$/);assert.ok(name.length<=70);
    assert.equal(new Set(name.split(' ')).size,name.split(' ').length);
    assert.ok(![...used].some(n=>Names.key(n)===Names.key(name)));used.add(name);
  }
  const first=Names.generate({seed:'collision'});assert.notEqual(first,Names.generate({seed:'collision',used:[first.toUpperCase()]}));
  assert.throws(()=>Names.generate({seed:'exhaustion',isReserved:()=>true}),/bounded generation budget/);
});
test('setting-authored name parts shape random names without importing generic fantasy syllables',()=>{
  assert.equal(Names.validProfile(profile),true);
  for(let i=0;i<100;i++)for(const word of Names.generate({seed:i,profile,sex:'Female'}).toLowerCase().split(' '))
    assert.match(word,/^(kel|ven|sor)(a|en|il)?(in|el|os)$/);
  assert.equal(Names.validProfile({...profile,prefixes:['x','x','x']}),false);
  assert.equal(Names.validProfile({...profile,middles:['<script>','a','b']}),false);
});
test('game.js delegates only new random names; existing roster and canonical identities are untouched',()=>{
  const source=fs.readFileSync('assets/game.js','utf8'),start=source.indexOf('function proceduralRandomName('),end=source.indexOf('// Function to create a random NPC character',start);
  const window={ProceduralNames:Names,PantheonCharacters:Pantheon,_characterSheetIndex:{keeper:{}},combatCharacters:[{name:'Companion'}]},npcs=[{Name:'Named Ally'}],before=JSON.stringify({window,npcs});
  const box={window,npcs};vm.runInNewContext(source.slice(start,end),box);
  const candidate=box.getRandomName('Female',{seed:'browser',profile});
  assert.equal(candidate,Names.generate({seed:'browser',sex:'Female',profile,used:['keeper','Named Ally','Companion'],isReserved:n=>!!Pantheon.name(n)}));
  assert.equal(JSON.stringify({window,npcs}),before);
  const html=fs.readFileSync('assets/index.html','utf8');assert.ok(html.indexOf('/assets/proceduralNames.js')<html.indexOf('/assets/game.js'));
});
genreTest('genre random encounter suggestions remain optional, while set quest contacts receive no generated identity',async()=>{
  const {templateContent}=require('retort-js/dist/message'),{generateInhabitants}=require('../retort/inhabitantGeneration');
  const fixture=require('./fixtures/inhabitants.cjs'),{batchRows}=require('./fixtures/inhabitant-batch.cjs'),prompts=[];
  const agent={user:(s,...v)=>prompts.push(typeof s==='string'?s:templateContent(s,...v)),assistant:{generation:async request=>({content:JSON.stringify({inhabitants:batchRows(fixture(8),request)})})}};
  const result=await generateInhabitants(agent,{roomName:'Test Hall',roomDescription:'A public hall.',geoKey:'2,0,0',indoor:true,partyNames:['Hero'],usedNames:['Prior Resident'],quest:'A saved quest',questSeed:true},
    {random:min=>min,level:()=>1,sex:()=>'',xp:()=>0,equipment:async()=>null});
  assert.ok(result.population.actors['Resident 0']);assert.ok(result.population.actors['Resident 1'],'LLM-authored names are not replaced by suggestions');
  const suggestions=prompts.filter(p=>p.startsWith('OPTIONAL PROCEDURAL NAME SUGGESTIONS:'));
  assert.ok(suggestions.length);assert.ok(suggestions.every(p=>!p.includes('"slot":0,')));
  assert.match(prompts.join('\n'),/changing only one part is not a fresh identity/);
});
genreTest('later genre name suggestions account for the names actually accepted in earlier batches',async()=>{
  const {templateContent}=require('retort-js/dist/message'),{generateInhabitants}=require('../retort/inhabitantGeneration');
  const fixture=require('./fixtures/inhabitants.cjs'),{batchRows}=require('./fixtures/inhabitant-batch.cjs');
  const rows=fixture(8),taken=Names.generate({seed:'Test Hall:2,0,0:resident:4'}),prompts=[];rows[0].name=taken;
  const agent={user:(s,...v)=>prompts.push(typeof s==='string'?s:templateContent(s,...v)),assistant:{generation:async request=>({content:JSON.stringify({inhabitants:batchRows(rows,request)})})}};
  await generateInhabitants(agent,{roomName:'Test Hall',roomDescription:'A public hall.',geoKey:'2,0,0',indoor:true},
    {random:min=>min,level:()=>1,sex:()=>'',xp:()=>0,equipment:async()=>null});
  const all=prompts.filter(p=>p.startsWith('OPTIONAL PROCEDURAL NAME SUGGESTIONS:')).map(p=>JSON.parse(p.match(/: (\[.*?\])/)[1]));
  assert.equal(all.length,2);assert.ok(all[1].every(r=>r.name!==taken));
});
genreTest('genre population suggestions use the saved setting culture, while names remain model-authored',async()=>{
  const {templateContent}=require('retort-js/dist/message'),{generateInhabitants}=require('../retort/inhabitantGeneration');
  const fixture=require('./fixtures/inhabitants.cjs'),{batchRows}=require('./fixtures/inhabitant-batch.cjs'),prompts=[],lineages=new Map();
  const table={version:1,canonical:false,originalPercent:0,seed:'authored',entries:Array.from({length:8},(_,i)=>({id:'kind-'+i,name:'Original Species '+i,description:'An authored native being.',habitat:'Its own biome',society:'A local culture',roles:['traveler'],kind:'people',allegiance:'Neutral',weight:1,nameParts:profile}))};
  const agent={user:(s,...v)=>{const p=typeof s==='string'?s:templateContent(s,...v);prompts.push(p);if(p.startsWith('SAVED WORLD POPULATION SAMPLE:'))for(const row of JSON.parse(p.match(/: (\[.*?\])/)[1]))lineages.set(row.slot,row.lineage);},
    assistant:{generation:async request=>({content:JSON.stringify({inhabitants:batchRows(fixture(8).map(r=>({...r,race:lineages.get(r.slot)})),request)})})}};
  const result=await generateInhabitants(agent,{roomName:'New Place',roomDescription:'A public hall.',geoKey:'3,0,0',indoor:true,rooms:{'0,0,0':{setting:{ecology:table}}}},
    {random:min=>min,level:()=>1,sex:()=>'',xp:()=>0,equipment:async()=>null});
  assert.equal(Object.keys(result.population.actors).length,8);
  for(const p of prompts.filter(p=>p.startsWith('OPTIONAL PROCEDURAL NAME SUGGESTIONS:')))for(const row of JSON.parse(p.match(/: (\[.*?\])/)[1]))
    for(const word of row.name.toLowerCase().split(' '))assert.match(word,/^(kel|ven|sor)(a|en|il)?(in|el|os)$/);
});
