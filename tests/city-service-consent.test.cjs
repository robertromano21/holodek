'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Services=require('../retort/serviceEncounters');
function fixture(){
  const file=require.resolve('./economy.test.cjs'),source=fs.readFileSync(file,'utf8');
  const f=vm.runInNewContext(source.slice(0,source.indexOf("test('initial pooled"))+'\nfixture();',
    {require:require('node:module').createRequire(file)});
  f.business('shop');
  f.request={runId:'test-run',geoKey:'1,0,0',actor:'Keeper',player:{x:4.5,y:4.5},deferIntroductions:true};
  f.p.actors.Keeper.dialogue=['An authored welcome.'];f.p.actors.Keeper.dialogueIndex=0;
  return f;
}
test('verified services come from bindings, not occupations; hostile and absent providers never qualify',()=>{
  const actors={Keeper:{name:'Keeper',status:'present',hp:5,allegiance:'Neutral'},
    Pretender:{name:'Pretender',status:'present',hp:5,allegiance:'Neutral',job:'shopkeeper'},
    Hostile:{name:'Hostile',status:'present',hp:5,allegiance:'Hostile'},Dead:{name:'Dead',status:'present',hp:0},
    Away:{name:'Away',status:'departed',hp:5},Host:{name:'Host',status:'present',hp:5}};
  assert.deepEqual(Services.providers({services:{shop:{operator:'Keeper'},bad:{operator:'Hostile'},dead:{operator:'Dead'},away:{operator:'Away'}},
    venueDesks:{inn:{operator:'Host'}}},{actors}),['Keeper','Host']);
});
test('passive visits discover service residents without spending their authored introduction or dialogue',()=>{
  const f=fixture(),v=f.service.visit(f.request);assert.ok(!v.error,JSON.stringify(v));
  assert.ok(v.population.serviceProviders.includes('Keeper'));
  assert.equal(v.encounters.length,0);assert.equal(v.dialogue.length,0);
  assert.equal(f.p.actors.Keeper.dialogueIndex,0);assert.ok(!f.p.groups[0].introPlayed);
  assert.ok(f.p.actors.Keeper.encounteredAt);
});
test('ordinary residents still introduce themselves normally, rather than being mistaken for service providers',()=>{
  const f=fixture();f.change(data=>delete data['1,0,0'].services);
  const v=f.service.visit(f.request);assert.equal(v.encounters.length,1);assert.ok(!f.p.actors.Keeper.servicesAcceptedAt);
});

test('saved job givers wait for consent, and completed or other-room jobs do not qualify',()=>{
  const f=fixture();f.change(db=>{delete db['1,0,0'].services;db['1,0,0'].minorMissions={job:{id:'job',status:'offered',patron:'Keeper',originRoomKey:'1,0,0'}};});
  let v=f.service.visit(f.request);assert.ok(v.population.serviceProviders.includes('Keeper'));assert.equal(v.encounters.length,0);
  f.change(db=>db['1,0,0'].minorMissions.job.status='completed');v=f.service.visit(f.request);assert.ok(!v.population.serviceProviders.includes('Keeper'));
  f.change(db=>{const j=db['1,0,0'].minorMissions.job;j.status='offered';j.originRoomKey='9,9,9';});
  v=f.service.visit(f.request);assert.ok(!v.population.serviceProviders.includes('Keeper'));
});
test('acceptance runs the existing encounter once and persists consent across menu openings',async()=>{
  const f=fixture();let calls=0;
  const narrate=async({visit})=>{calls++;assert.deepEqual(visit.encounters,[{groupId:f.p.groups[0].id,names:['Keeper']}]);return{...visit,story:{content:'Authored encounter.'}};};
  const result=await Services.accept(f.state,f.service,f.request,{narrate});assert.ok(result.story);
  assert.equal(calls,1);assert.ok(f.p.actors.Keeper.servicesAcceptedAt);
  await Services.accept(f.state,f.service,f.request,{narrate});assert.equal(calls,1);
  assert.ok(f.db()['1,0,0'].inhabitants.actors.Keeper.servicesAcceptedAt);
});
test('acceptance retains native range, availability and sightline checks before any model request',async()=>{
  for(const alter of [f=>f.request.runId='old',f=>f.pause(),f=>f.request.actor='Pretender',f=>f.request.player={x:13.5,y:13.5},
    f=>f.change(db=>db['1,0,0'].services={}),f=>f.d.cells['5,4']={tile:'wall'}]){
    const f=fixture();alter(f);let calls=0;
    await assert.rejects(Services.accept(f.state,f.service,f.request,{narrate:async()=>{calls++;}}));
    assert.equal(calls,0);assert.ok(!f.p.actors.Keeper.servicesAcceptedAt);
  }
});
test('failed or stale encounters never mark a service accepted',async()=>{
  for(const change of ['failure','run','room','floor','stale']){
    const f=fixture();let epoch='street';f.state.getCityFloorEpoch=()=>epoch;
    await assert.rejects(Services.accept(f.state,f.service,f.request,{narrate:async({visit})=>{
      if(change==='failure')throw Error('Authoring failed');
      if(change==='run')f.state.getDungeonRunId=()=> 'other';
      if(change==='room')f.state.getLastCoords=()=>({z:0,y:1,x:1});
      if(change==='floor')epoch='upper';
      return {...visit,story:{content:'Authored'},stale:change==='stale'};
    }}));
    assert.ok(!f.p.actors.Keeper.servicesAcceptedAt);
  }
});
