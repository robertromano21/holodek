'use strict';
for(const f of ['CITY_SITES','CITY_COMPLETE','CITY_PROPS','CAMPAIGN_MAP','ARCHITECTURE_EXPANSION','GENRE_EXPANSION','HOMEBREW'])process.env['HOLODEK_'+f]='1';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../retort/citySites'),V=require('../retort/cityVerticality'),S=require('../retort/settingLayer');
function city(floors=80,transit='lift'){
  return{id:'authored-city',name:'The Authored Capital',population:300000,scale:'metropolis',design:{version:1,source:'model-authored',form:'grid',identity:'A city of stacked neighborhoods.',history:'Built by generations of residents.',skyline:'Monumental towers with elevated connections.',
    verticality:{floors,transit,bridges:true,lowerUse:'Public markets and arrivals',middleUse:'Homes and neighborhood services',upperUse:'An archive and civic halls',roofUse:'Enclosed crown gardens and bridge access'},
    districts:Object.fromEntries(C.DISTRICTS.map(id=>[id,{name:'Original '+id,atmosphere:'A distinct neighborhood.',residentRoles:['resident','traveler'],locales:[{name:'Original '+id+' Hall',type:'civic'},{name:'Original '+id+' House',type:'home'}],mix:['home','shop']}]))}};
}
for(const genre of ['modern','sci-fi','cyberpunk','dark-fantasy'])test(genre+' gets actual connected landmark floors without eager hundreds of interiors',()=>{
  const model=city(genre==='dark-fantasy'?96:120,genre==='dark-fantasy'?'ramps':'lift');
  for(let seed=0;seed<35;seed++){
    const plan=C.plan({city:model,genre,seed:String(seed)});assert.deepEqual(C.validate(plan),[]);assert.ok(plan.rooms.length>=30&&plan.rooms.length<=60);
    assert.equal(plan.stats.towers,2);assert.equal(plan.stats.landmarkFloors,6);assert.equal(plan.stats.storeys,model.design.verticality.floors);
    assert.equal(new Set(plan.rooms.map(r=>r.name)).size,plan.rooms.length);
    const byKey=new Map(plan.rooms.map(r=>[r.key,r]));
    for(const ground of plan.rooms.filter(r=>r.vertical?.floor===0)){
      let cursor=ground;const levels=[0];
      while(cursor.exits.up){cursor=byKey.get(cursor.exits.up.targetCoordinates);levels.push(cursor.vertical.floor);}
      assert.equal(levels.at(-1),model.design.verticality.floors);assert.equal(levels.length,4);
      while(cursor.exits.down)cursor=byKey.get(cursor.exits.down.targetCoordinates);
      assert.equal(cursor.key,ground.key);assert.ok(Object.values(cursor.exits).some(e=>e.targetCoordinates===ground.streetKey));
    }
    assert.equal(plan.rooms.filter(r=>Object.values(r.exits).some(e=>e.transport==='covered-skybridge')).length,2);
  }
});
test('vertical stops install once, preserve the floor identity and never retrofit visited cities',()=>{
  const world=S.validateBible(S.localBible('A vertical city',['cyberpunk']));S.setActive(world);
  try{
    const model=city(),db={'0,3,0':{name:model.name,exits:{},environmentIntent:{citySite:model}}};
    assert.equal(C.install(db,'0,3,0',{seed:'city'}).status,'installed');
    const upper=Object.values(db).find(r=>r.cityRoom?.vertical?.floor>0);assert.ok(upper.indoor);assert.equal(upper.campaignSetting.city.vertical.storeys,80);
    assert.deepEqual(require('../retort/locationAwareness').settlement(upper,'unused').vertical,{floor:40,storeys:80,transit:'lift',use:'Homes and neighborhood services'});
    assert.equal(upper.cityRoom.establishmentType,'civic');assert.match(C.describe(upper),/actual tower level/);assert.match(C.describe(upper),/unbuilt intermediate floor/);
    upper.visited=true;upper.inhabitants={actors:{Keeper:{status:'dead',name:'Keeper'}}};const before=JSON.stringify(db);
    assert.equal(C.install(db,'0,3,0',{seed:'different'}).status,'already-installed');assert.equal(JSON.stringify(db),before);
  }finally{S.setActive(null);}
});
test('small settlements and underground rooms are not forced into skyscraper floor graphs',()=>{
  const low=city(2,'stairs');assert.equal(V.reserve(low),0);const small=C.plan({city:low,genre:'western'});assert.equal(small.rooms.filter(r=>r.vertical).length,0);
  const underground=C.plan({city:city(),genre:'dark-fantasy',underground:true});assert.equal(underground.rooms.filter(r=>r.vertical).length,0);
  const invalid=city();invalid.design.verticality.floors=Infinity;assert.throws(()=>C.plan({city:invalid}),/verticality/);
});
test('vertical private layers remain unique and bounded near world coordinate limits',()=>{
  for(const anchorKey of ['969,949,900','-969,-949,-990','969,949,990']){
    const plan=C.plan({city:city(160),genre:'sci-fi',anchorKey});assert.deepEqual(C.validate(plan),[]);
    assert.ok(plan.rooms.every(r=>r.key.split(',').map(Number).every(n=>Math.abs(n)<=999)));
  }
});
