'use strict';
for(const f of ['CITY_COMPLETE','CITY_SITES','ARCHITECTURE_EXPANSION','GENRE_EXPANSION','HOMEBREW'])process.env['HOLODEK_'+f]='1';
const test=require('node:test'),assert=require('node:assert/strict'),A=require('../retort/cityAuthoring'),S=require('../retort/settingLayer'),Work=require('../retort/holodekRoomWork'),E=require('../assets/cityEstablishments');
function ecology(canonical=false){const entries=Array.from({length:8},(_,i)=>({id:'ecology-'+i,name:'Native Lineage '+i,description:'A distinct authored kind '+i,habitat:'Terraces and streets',society:'Independent neighborhoods',roles:['courier','collector'],kind:i<6?'people':'monster',allegiance:i<6?'Neutral':'Hostile',weight:i<6?20:2}));return{version:1,canonical,originalPercent:canonical?40:0,seed:'world-seed',entries};}
function design(){return{version:1,source:'model-authored',venueProgram:1,scale:'city',form:'ring',identity:'An old city of travelers and river crossings.',history:'Three refugee communities built it together.',skyline:'Layered roofs above a broad public square.',districts:Object.fromEntries(A.DISTRICTS.map(id=>[id,{name:'Authored '+id,atmosphere:'A distinct local neighborhood '+id,residentRoles:['local host','visiting storyteller'],locales:require('../retort/cityLife').required(id).map(type=>({name:'Named '+id+' '+E.name(type),type})),mix:['shop','inn','bar','home']}]))};}
test('CotG city authoring compiles a complete original plan, demographic percentages and seeded filler once',async()=>{
  S.setActive(null);const old=Work.request,calls=[];const table=ecology(true),draft=design();
  Work.request=async(_$,component,_p,brief,validate)=>{
    calls.push({component,brief});let v=component==='city-identity'?{identity:draft.identity,history:draft.history,skyline:draft.skyline,form:draft.form}:component==='city-population-percentages'?{originalPercent:35,weights:table.entries.map(e=>({id:e.id,weight:e.weight}))}:draft.districts[brief.match(/district role (\w+)/)[1]];
    if(component==='city-district'){const {locales,...rest}=v;v={...rest,venues:Object.fromEntries(locales.map(l=>[l.type,l.name]))};}return validate?validate(v):v;
  };
  try{
    const room={name:'New City Gate',environmentIntent:{citySite:{id:'city',name:'New City',region:'Tartarus',population:12000}}};
    assert.equal((await A.ensure({},room,{ecology:table,seed:'run'})).status,'authored');assert.equal(calls.length,9);
    assert.equal(room.environmentIntent.citySite.design.source,'model-authored');assert.equal(room.environmentIntent.citySite.design.populationMix.percentages.reduce((n,r)=>n+r.percent,0),100);
    const db={'2,3,0':room},r=require('../retort/citySites').install(db,'2,3,0',{seed:'run'});assert.equal(r.status,'installed');assert.ok(r.stats.rooms>=30&&r.stats.rooms<=60);assert.ok(r.stats.proceduralFrontages>400);
    const streets=Object.values(db).filter(r=>r.cityRoom?.kind==='street');assert.ok(streets.every(r=>r.cityRoom.districtName.startsWith('Authored')));
    assert.ok(streets.every(r=>r.campaignSetting.city.populationMix.originalPercent===35));assert.ok(streets.every(r=>r.cityRoom.population.roles.includes('visiting storyteller')));
    assert.equal((await A.ensure({},room,{ecology:table,seed:'run'})).status,'skipped');assert.equal(calls.length,9);
  }finally{Work.request=old;}
});
test('failed city authoring never commits a partial city or manufactures a fallback district',async()=>{
  const old=Work.request;let count=0;
  Work.request=async()=>{if(++count>1)throw Error('Authoring interrupted');return{identity:'A real concept',history:'Its own history',skyline:'Layered stone',form:'grid'};};
  const room={environmentIntent:{citySite:{name:'Unbuilt City',id:'unbuilt'}}},before=JSON.stringify(room);
  try{await assert.rejects(A.ensure({},room),/interrupted/);assert.equal(JSON.stringify(room),before);}finally{Work.request=old;}
});
test('visited city geometry and existing cast never trigger new city authorship',async()=>{
  const room={visited:true,name:'Old City',inhabitants:{actors:{NamedGuardian:{status:'dead',home:{x:8,y:9}}}},environmentIntent:{citySite:{name:'Old City'}}},before=JSON.stringify(room);
  assert.equal((await A.ensure({},room)).status,'skipped');assert.equal(JSON.stringify(room),before);
});
for(const genre of Object.keys(E.NAMES))test(genre+' uses authored districts plus reproducible appropriate establishments, not new prefab monsters',()=>{
  const b=S.validateBible(S.localBible('Original city',[genre]));S.setActive(b);
  try{
    const city={id:'city',name:'Authored City',genre,population:150000,design:design()};const C=require('../retort/citySites'),p=C.plan({city,genre,seed:'run'});
    assert.deepEqual(C.validate(p),[]);assert.ok(p.rooms.length>=30&&p.rooms.length<=60);
    const street=p.rooms.find(r=>r.fabric);assert.ok(street);const rows=E.frontages(street.fabric);assert.deepEqual(rows,E.frontages(street.fabric));assert.ok(rows.length>=28&&rows.length<=64);assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
    assert.ok(rows.some(r=>r.type==='shop'));assert.ok(rows.every(r=>E.TYPES.includes(r.type)&&r.interactionPolicy.includes('investigation')&&r.authored===false));
    const building=p.rooms.find(r=>r.establishmentType==='inn');assert.ok(building&&building.name.startsWith('Named '));
  }finally{S.setActive(null);}
});
test('authored home/civic roles are not silently converted into shops',()=>{
  const R=require('../retort/serviceRoles');for(const type of ['home','civic','warehouse']){const room={cityRoom:{kind:'building',district:'market',establishmentType:type}};assert.equal(R.market(room,{siteKind:'market'}),false);assert.equal(R.kind(room),null);}assert.equal(R.kind({cityRoom:{establishmentType:'clinic'}}),'temple');
});
module.exports={ecology,design};

test('the live Gasket Reach collision compiles without retries or discarding authored prose',()=>{
  const raw={name:'Mothglass Ward',atmosphere:'Rain-dark lanes beneath stacked dwellings.',residentRoles:['gasket-fitter','registrar'],
    venues:{temple:'The Still Interval',clinic:'Blue Thread Clinic',bathhouse:'Eight-Bell Steam Hall'},mix:['shop','inn','bar','workshop']};
  const accepted={gate:{name:'Chrome Blocks',locales:Object.entries(raw.venues).map(([type,name])=>({type,name}))}};
  const result=A.compileDistrict(raw,{id:'temple',required:['temple','clinic','bathhouse'],accepted});
  assert.equal(result.name,raw.name);assert.equal(result.atmosphere,raw.atmosphere);assert.deepEqual(result.residentRoles,raw.residentRoles);
  const names=[...accepted.gate.locales,...result.locales].map(l=>l.name.toLowerCase());assert.equal(new Set(names).size,names.length);
  for(const l of result.locales){assert.equal(l.authoredName,raw.venues[l.type]);assert.ok(l.name.includes('Mothglass Ward'));assert.ok(l.name.length<=65);}
  assert.deepEqual(result,A.compileDistrict(raw,{id:'temple',required:['temple','clinic','bathhouse'],accepted}));
});
test('identical district/venue names can fill all wards with bounded unique addresses and no prefab stories',()=>{
  const accepted={};
  for(const id of A.DISTRICTS){const required=require('../retort/cityLife').required(id),raw={name:'Repeated Place',atmosphere:'A model-authored local life.',
    residentRoles:['worker','visitor'],venues:Object.fromEntries(required.map(type=>[type,'Shared House'])),mix:['home','shop']};
    accepted[id]=A.compileDistrict(raw,{id,required,accepted});}
  const d={...design(),districts:accepted};assert.equal(A.validate(d),d);
  assert.throws(()=>A.compileDistrict({name:'Valid',venues:{}},{id:'gate',required:['inn'],accepted:{}}),/Author one name/);
});
