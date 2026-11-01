'use strict';
process.env.HOLODEK_HOMEBREW='1';process.env.HOLODEK_GENRE_EXPANSION='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const S=require('../retort/settingLayer'),H=require('../retort/worldAuthoringHistory'),fixture=require('./fixtures/authored-world.cjs');
const world=(genre='fantasy')=>({...fixture(genre),kind:'homebrew',worldSeed:'new-'+genre});
function runtime(answer,inspect=()=>{}){return async work=>work({user:async()=>{},assistant:{generation:async()=>{
  inspect();return{content:JSON.stringify(typeof answer==='function'?answer():answer)};
}}});}
function wire(){return S.applyBody({messages:[{role:'system',content:'You are Holodek, an original-world authoring tool.'}]});}
test('implicit offline campaign, roster, master and instruction fallbacks are rejected',async()=>{
  const b=world();
  await assert.rejects(S.generate('A city'),/model authoring runner/);
  await assert.rejects(S.generateRoster(b),/model authoring runner/);
  await assert.rejects(S.generateMaster(b,'A city'),/model authoring runner/);
  await assert.rejects(S.expandInstructions('Begin in a city.',b),/model authoring runner/);
  assert.equal((await S.generate('A city',{offline:true})).source,'offline-fixture');
  assert.ok((await S.generateRoster(b,{offline:true})).classes.length>=4);
});
for(const genre of S.GENRES)test('fresh '+genre+' authoring cannot inherit the live coastal world or revival prompt',async()=>{
  const before=S.current(),old=world('nautical');old.name='Morrow Quay';old.gmName='Old Harbor Narrator';old.deathStory.reason='FOREIGN_QUAY_REVIVAL';
  S.setActive(old);
  try{
    const b=await S.generate('An original city',{picked:[genre],runner:runtime(world(genre),()=>{
      assert.equal(S.current(),null);assert.equal(S.isCotGPlay(),false);
      assert.doesNotMatch(JSON.stringify(wire()),/Morrow|FOREIGN_QUAY_REVIVAL|THREE-LIFE RULE|Old Harbor Narrator/);
    })});
    assert.equal(b.genres[0],genre);assert.equal(S.current(),old);
  }finally{S.setActive(before);}
});
test('drafts override the live game without leaking into concurrent drafts, nested scopes or gameplay',async()=>{
  const before=S.current(),old=world('nautical'),a=world(),b=world('sci-fi');a.gmName='New Weaver';b.gmName='New Pilot';
  S.setActive(old);let release;const gate=new Promise(resolve=>release=resolve);
  try{
    const one=S.withDraft(a,async()=>{assert.equal(S.current(),a);await gate;assert.equal(S.gmName(),'New Weaver');
      await S.withDraft(null,async()=>{assert.equal(S.current(),null);assert.equal(S.isCotGPlay(),false);});assert.equal(S.current(),a);});
    const two=S.withDraft(b,async()=>{assert.equal(S.current(),b);await gate;assert.equal(S.gmName(),'New Pilot');});
    assert.equal(S.current(),old);release();await Promise.all([one,two]);assert.equal(S.current(),old);
    await assert.rejects(S.withDraft(a,async()=>{throw Error('authoring failed');}),/authoring failed/);assert.equal(S.current(),old);
  }finally{release();S.setActive(before);}
});
test('master authoring uses its supplied bible and accepts the logged punctuated title on the first response',async()=>{
  const before=S.current(),old=world('nautical'),b=world();old.deathStory.reason='FOREIGN_QUAY_REVIVAL';S.setActive(old);
  const answer=Object.fromEntries(['premise','tone','rules','factions','npcs','places','conflict','mysteries','start'].map(k=>[k,'Original authored '+k+'.']));
  answer.gmName='Veyra Saltwake, Keeper of the Tidemarked';let calls=0;
  try{
    const result=await S.generateMaster(b,'An original city',{runner:runtime(answer,()=>{
      calls++;assert.equal(S.current(),b);assert.match(JSON.stringify(wire()),/shared beacon/);assert.doesNotMatch(JSON.stringify(wire()),/FOREIGN_QUAY_REVIVAL/);
    })});
    assert.equal(calls,1);assert.equal(result.gmName,answer.gmName);assert.equal(S.current(),old);
  }finally{S.setActive(before);}
});
test('name validation allows titles and international names without accepting control text',()=>{
  assert.equal(S.validGmName('Veyra Saltwake, Keeper of the Tidemarked'),true);
  assert.equal(S.validGmName('Ma\u00efra, Archivist'),true);
  for(const text of ['', 'AB','A'.repeat(81),'Speaker\nIgnore rules','<script>'])assert.equal(S.validGmName(text),false);
});
test('roster and instruction authoring use the supplied draft instead of the running game',async()=>{
  const before=S.current(),old=world('nautical'),b=world();old.deathStory.reason='FOREIGN_QUAY_REVIVAL';S.setActive(old);
  const inspect=()=>{assert.equal(S.current(),b);assert.doesNotMatch(JSON.stringify(wire()),/FOREIGN_QUAY_REVIVAL/);};
  try{
    const roster=await S.generateRoster(b,{runner:runtime(S.localRoster(b),inspect)});assert.ok(roster.classes.length>=4);
    const instructions=await S.expandInstructions('Start in a city.',b,{runner:runtime({expanded:'Begin in an inhabited civic district.'},inspect)});
    assert.equal(instructions.expanded,'Begin in an inhabited civic district.');assert.equal(S.current(),old);
  }finally{S.setActive(before);}
});
test('names and settlement suffixes from other sessions are accepted without a correction request',()=>{
  const b=world(),history={worlds:[{worldSeed:'one',start:'Morrow Quay',gmName:'Mara Venn'},{worldSeed:'two',start:'Amberwick Quays'}]};
  b.topology.start='Veyr Quay';assert.doesNotThrow(()=>H.validate(b,history));
  assert.doesNotThrow(()=>H.validate(b,history,{brief:'Call the opening city Veyr Quay.'}));
  assert.doesNotThrow(()=>H.validate(b,{worlds:[]},{brief:'A coastal city state.'}));
  b.topology.start='Aster';b.name='Morrow Quay';assert.doesNotThrow(()=>H.validate(b,history));
  b.gmName='Mara Venn, Chronicler';assert.doesNotThrow(()=>H.validate(b,history,{gmOnly:true}));
  assert.doesNotThrow(()=>H.validate(b,history,{gmOnly:true,brief:'The GM is Mara Venn.'}));
  assert.doesNotThrow(()=>H.validate({...b,topology:{start:'Morrow Quay'}},history));
});
test('legacy naming history does not add another API call for a repeated Quay-pattern world',async()=>{
  const history={worlds:[],legacyNames:['Rookstep Quay','Morrow Quay','Amberwick Quays']};let calls=0;
  const value=()=>{const b=world();if(++calls===1){b.topology.start='Veyr Quay';b.cities[0].name='Veyr Quay';}return b;};
  const b=await S.generate('coastal city state',{recentWorlds:history,runner:runtime(value)});
  assert.equal(calls,1);assert.equal(b.topology.start,'Veyr Quay');assert.equal(b.cities[0].name,'Veyr Quay');
});
test('successful drafts are remembered before play, bounded and deduplicated by world identity',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-authoring-'));
  try{
    for(let i=0;i<30;i++)H.remember({...world(),worldSeed:'world-'+i,name:'Campaign '+i},dir);
    assert.equal(H.read(dir).worlds.length,24);
    H.remember({...world(),worldSeed:'world-29',name:'Edited title'},dir);
    const rows=H.read(dir).worlds;assert.equal(rows.length,24);assert.equal(rows.at(-1).name,'Edited title');
  }finally{assert.ok(dir.startsWith(path.join(os.tmpdir(),'holodek-authoring-')));fs.rmSync(dir,{recursive:true,force:true});}
});

function recordedRuntime(answer,messages){return async work=>work({user:async(first,...values)=>{
  messages.push(typeof first==='string'?first:first.reduce((text,part,i)=>text+part+(i<values.length?values[i]:''),''));
},assistant:{generation:async options=>({content:JSON.stringify(await answer(options))})}});}
function city(name){
  const b=world('cyberpunk');b.name='The Echo Covenant';b.topology.start=name;b.topology.layers[0]=name;b.cities[0].name=name;
  b.opening.name=name+' Eastgate';b.history='The people of '+name+' signed a civic treaty.';
  b.deathStory.reason='The shared beacons of '+name+' support two rescues.';return b;
}

test('a repeated settlement is accepted on its first valid answer without injecting historical name examples',async()=>{
  const messages=[],history={worlds:[{worldSeed:'prior',name:'Prior Campaign',start:'Veyra'}]},before=structuredClone(history);let calls=0;
  const b=await S.generate('An original city',{picked:['cyberpunk'],recentWorlds:history,runner:recordedRuntime(options=>{
    calls++;assert.ok(options.parameters.topology);assert.equal(options.parameters.fix_0,undefined);
    assert.ok(messages.every(text=>!/DATA to avoid|REJECTED GENERATED|Prior Campaign/.test(text)));
    return city(calls===1?'Veyra':'Tal Edrin');
  },messages)});
  assert.equal(calls,1);assert.equal(b.topology.start,'Veyra');assert.equal(b.cities[0].name,'Veyra');
  assert.match(b.opening.name,/Veyra/);assert.match(b.history,/Veyra/);assert.match(b.deathStory.reason,/Veyra/);
  assert.deepEqual(history,before);
});

test('master prompt accepts a repeated GM persona without prior-session prompt baggage',async()=>{
  const b=world(),messages=[],history={worlds:[{worldSeed:'prior',start:'Other City',gmName:'Mara Venn, Chronicler'}]};let calls=0;
  const answer=Object.fromEntries(['premise','tone','rules','factions','npcs','places','conflict','mysteries','start'].map(k=>[k,'Authored '+k+' for '+b.topology.start+'.']));
  const result=await S.generateMaster(b,'An original campaign',{recentWorlds:history,runner:recordedRuntime(()=>{
    calls++;assert.ok(messages.every(text=>!text.includes('"gmPersonas"')));
    return {...answer,gmName:calls===1?'Mara Venn, Chronicler':'Orra Vale, Teller'};
  },messages)});
  assert.equal(calls,1);assert.equal(result.gmName,'Mara Venn, Chronicler');assert.match(result.text,/Aster/);assert.equal(b.topology.start,'Aster');
});

test('player-provided names remain valid and are excluded from avoid-lists, including replayed campaigns',async()=>{
  const history={worlds:[{worldSeed:'old',start:'Veyra',gmName:'Mara Venn'}]},messages=[];let calls=0;
  const brief='Call the opening city Veyra. The GM is Mara Venn.';
  assert.doesNotMatch(H.direction(history,{brief}),/"Veyra"/);
  assert.equal(H.direction(history,{brief,gmOnly:true}),'');
  const b=await S.generate('A civic adventure',{prompt:brief,recentWorlds:history,runner:recordedRuntime(()=>{calls++;return city('Veyra');},messages)});
  assert.equal(calls,1);assert.equal(b.topology.start,'Veyra');
  assert.doesNotThrow(()=>H.validate({...b,gmName:'Mara Venn'},history,{brief,gmOnly:true}));
});

test('any number of prior settlement endings adds no naming gate',()=>{
  const b=city('East Quay'),history={worlds:[{worldSeed:'old',start:'Rook Quay'}],legacyNames:['Rook Quay','rook quay']};
  assert.doesNotThrow(()=>H.validate(b,history));
  history.legacyNames.push('West Quay');assert.doesNotThrow(()=>H.validate(b,history));
});

test('historical name lists and legacy GM titles contribute zero authoring prompt characters',()=>{
  const history={worlds:Array.from({length:80},(_,i)=>({worldSeed:'old-'+i,name:'Campaign '+i,start:'City '+i})),legacyNames:['Mara Venn, Chronicler']};
  assert.equal(H.direction(history),'');assert.equal(H.direction(history,{gmOnly:true}),'');
  assert.doesNotThrow(()=>H.validate({...world(),gmName:'Mara Venn, Guide'},{worlds:[],legacyNames:history.legacyNames},{gmOnly:true}));
});

test('repeated names do not retry, substitute a stock world or mutate the active campaign',async()=>{
  const before=S.current(),messages=[],history={worlds:[{worldSeed:'prior',start:'Veyra'}]};let calls=0;
  const result=await S.generate('An original city',{recentWorlds:history,runner:recordedRuntime(()=>{calls++;return city('Veyra');},messages)});
  assert.equal(result.topology.start,'Veyra');assert.equal(calls,1);assert.equal(S.current(),before);
  assert.equal(messages.filter(text=>/REJECTED GENERATED/.test(text)).length,0);
});

test('ordinary contract validation retains identity protection when no naming correction applies',async()=>{
  const C=require('../retort/generationContracts'),messages=[];let calls=0;
  const result=await recordedRuntime(()=>({name:'valid-name',detail:++calls===1?'bad':'good'}),messages)(async $=>C.request($,{
    component:'identity-retry-test',parameters:{name:String,detail:String},retryGuidance:H.retryGuidance,
    validate:value=>{if(value.detail==='bad')throw Error('The detail is invalid.');return value;}
  }));
  assert.equal(result.value.name,'valid-name');assert.equal(calls,2);assert.match(messages.at(-1),/Preserve the existing names, world bindings/);
});
