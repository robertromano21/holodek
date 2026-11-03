'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../assets/economyRules'),E=require('../retort/economy'),V=require('../retort/cityVenueServices');
const Delivery=require('../retort/deliveryMissions'),Services=require('../retort/serviceEncounters');
const Counters=require('../assets/cityServiceCounters'),Landmarks=require('../assets/landmarkCatalog');
function fixture(){
  const file=require.resolve('./economy.test.cjs'),source=fs.readFileSync(file,'utf8');
  const f=vm.runInNewContext(source.slice(0,source.indexOf("test('initial pooled"))+'\nfixture();',
    {require:require('node:module').createRequire(file)});f.business('shop');
  f.change(db=>{db['0,0,0']={...db['1,0,0'],economy:db['0,0,0'].economy};delete db['1,0,0'];});
  f.d.geoKey='0,0,0';f.p.geoKey='0,0,0';f.state.getLastCoords=()=>({x:0,y:0,z:0});
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('Coordinates: X: 1, Y: 0, Z: 0','Coordinates: X: 0, Y: 0, Z: 0'));
  f.state.setCombatCharactersString(JSON.stringify(JSON.parse(f.state.getCombatCharactersString()).map(a=>({...a,mazeRoomKey:'0,0,0'}))));
  return f;
}
test('starter service protection follows the opening coordinate, not genre, name or host floor number',()=>{
  for(const name of ['Ruined Temple Entrance','The First City','An Original Starport'])assert.equal(R.isStarterRoom('0,0,0',{name}),true);
  assert.equal(R.isStarterRoom('0,0,0',{cityFloorContext:{floor:0}}),false);
  assert.equal(R.isStarterRoom('0,1,0',{name:'Ruined Temple Entrance'}),false);
});
test('opening economy still creates purses and loot, but no shop, work desk, service roles or local jobs',()=>{
  for(const original of [false,true]){
    const population=structuredClone(fixture().p),room={name:'Ruined Temple Entrance',
      cityRoom:{establishmentType:'shop'},campaignSetting:{inhabited:true,siteKind:'market',faction:{id:'local',allegiance:'Neutral'}}},db={'0,0,0':room};
    if(original)room.setting={id:'original-world'};
    E.seedRoom(db,'0,0,0',population,'test');
    assert.equal(room.services,undefined);assert.equal(room.venueDesk,undefined);assert.equal(room.minorMissions,undefined);
    assert.ok(Object.values(population.actors).every(a=>a.wallet&&!a.serviceId));
    assert.ok(room.objects.length>0,'Existing starter scroll/loot rules are preserved');
  }
});
test('ambient promotion cannot bind a starter trader or job desk, but host-local floors may bind both',()=>{
  const actor={name:'Resident',allegiance:'Neutral',status:'present',hp:12},occupation={mode:'work',venueType:'shop',venueId:'shop'};
  const room={cityRoom:{establishmentType:'shop'},inhabitants:{actors:{Resident:actor}}},db={'0,0,0':room};
  assert.equal(E.bindVenueTrader(db,'0,0,0',actor,occupation),null);assert.equal(V.bind(room,actor,occupation,'0,0,0'),null);
  V.seed(room,room.inhabitants,'0,0,0');assert.equal(room.venueDesk,undefined);assert.equal(actor.serviceId,undefined);
  room.cityFloorContext={floor:1};assert.ok(E.bindVenueTrader(db,'0,0,0',actor,occupation));assert.ok(V.bind(room,actor,occupation,'0,0,0'));
});
test('legacy saved services and jobs are unavailable at the opening without deleting the saved records',async()=>{
  const f=fixture(),before=JSON.stringify(f.db()['0,0,0'].services);
  f.change(db=>db['0,0,0'].minorMissions={old:{id:'old',patron:'Keeper',roomKey:'0,0,0',status:'offered'}});
  assert.match(E.view(f.state,'Keeper').error,/starter room/);
  for(const kind of ['buy','sell','heal','resurrect','lodge','accept-mission']){
    const result=E.action(f.state,f.service,{runId:'test-run',geoKey:'0,0,0',nonce:'starter-test:'+kind,revision:0,kind,actor:'Keeper'});
    assert.match(result.error,/starter room/,kind);
  }
  assert.throws(()=>E.venueContext(f.state,'Keeper'),/starter room/);
  await assert.rejects(require('../retort/cityCommissions').request(f.state,f.service,
    {runId:'test-run',geoKey:'0,0,0',actor:'Keeper'},{run:()=>assert.fail('No model call for forbidden starter jobs')}),/starter room/);
  assert.deepEqual(Services.providers(f.db()['0,0,0'],f.p,f.db()),[]);
  assert.equal(Delivery.candidate(f.db(),'0,0,0',f.p),null);
  assert.equal(Delivery.seed(f.db(),'0,0,0',f.p),null);
  await require('../retort/merchantStock').prepare(null,f.state,'0,0,0',{author:()=>assert.fail('No stock call for a starter shop')});
  assert.equal(JSON.stringify(f.db()['0,0,0'].services),before);
});
test('starter protection does not block ordinary inventory use',()=>{
  const f=fixture(),potion=R.healingPotion(4);f.inventory(potion);
  const result=E.action(f.state,f.service,{runId:'test-run',geoKey:'0,0,0',nonce:'starter-test:drink',revision:f.book().revision,
    kind:'drink',item:potion.name,target:'Benedict'});
  assert.equal(result.error,undefined);assert.match(result.content,/drinks/);
});
test('recurring cast arcs cannot author, install or advance starter-room jobs',async()=>{
  const Cast=require('../retort/roomCast'),population={actors:{Guide:{name:'Guide',allegiance:'Friendly',dialogue:['Welcome.']}},
    roomCast:{version:'world1',members:[{name:'Guide',interests:['history']}],arcs:[{id:'offer',giver:'Guide',title:'An Old Job',premise:'An old request.',stages:['Ask.','Travel.','Return.']}],visits:1}},
    db={'0,0,0':{name:'Ruined Temple Entrance'},'0,1,0':{name:'Next Room'}},before=JSON.stringify(db);
  assert.equal(await Cast.generate({assistant:{generation:()=>assert.fail('No starter job model request')}},
    {geoKey:'0,0,0',population}),null);
  assert.equal(await Cast.generateIsolated({getRoomNameDatabase:()=>JSON.stringify(db)},{geoKey:'0,0,0',population}),null);
  assert.equal(Cast.install(db,'0,0,0',population,'run'),null);assert.equal(JSON.stringify(db),before);
  assert.equal(Cast.revisit(db,'0,0,0',population),false);assert.equal(db['0,0,0'].minorMissions,undefined);
});
test('genre recurring cast briefs do not import CotG deities',()=>{
  const Setting=require('../retort/settingLayer');Setting.setActive(Setting.validateBible(Setting.localBible('Offline World',['cyberpunk'])));
  try{const prompt=require('../retort/roomCast').promptBlock({runId:'test',geoKey:'0,1,0'});
    assert.match(prompt,/this campaign/);assert.doesNotMatch(prompt,/Mortacia|Arithus|Tartarus|Atinus/);
  }finally{Setting.setActive(null);}
});
test('starter landmarks and counters do not advertise services or local work',()=>{
  const d={geoKey:'0,0,0',cityBlocks:{buildings:[{id:'shop',type:'shop',name:'Authored Shop',left:1,top:1,width:8,depth:8}]},
    sceneStructures:[{id:'desk',venueId:'shop',serviceCounter:true,position:{x:2,y:2},size:{x:1,y:1}}]};
  assert.equal(Counters.catalog(d).length,0);assert.equal(Landmarks.catalog(d).filter(m=>m.kind==='service-building').length,0);
  const other={...d,geoKey:'1,0,0'};assert.equal(Counters.catalog(other).length,1);
  assert.equal(Landmarks.catalog(other).filter(m=>m.kind==='service-building').length,1);
});
test('browser ignores stale starter job/service metadata before opening any menu or sending any request',async()=>{
  const window={currentDungeon:{geoKey:'0,0,0'},EconomyRules:R,getEconomyResidentInfo:()=>({kind:'mission',jobs:true})};
  vm.runInNewContext(fs.readFileSync('assets/commerceUi.js','utf8'),{window});
  assert.equal(window.CommerceUi.invite('Keeper'),false);
  assert.equal(window.CommerceUi.inviteAmbient({name:'Keeper'},()=>assert.fail('No service acceptance')),false);
  assert.equal(await window.CommerceUi.open('Keeper'),false);assert.equal(await window.CommerceUi.openCounter('desk'),false);
  assert.equal(window.CommerceUi.hasInteraction(),false);
});
test('the browser resident sheet suppresses legacy starter job buttons without hiding recruitment',()=>{
  const source=fs.readFileSync('assets/game.js','utf8'),start=source.indexOf('window.getEconomyResidentInfo ='),end=source.indexOf('window.prepareEconomyState =',start);
  const room={services:{shop:{kind:'shop',operator:'Keeper'}},minorMissions:{old:{patron:'Keeper',status:'offered'}}},d={geoKey:'0,0,0'};
  const window={EconomyRules:R,CityEstablishments:require('../assets/cityEstablishments')};
  vm.runInNewContext(source.slice(start,end),{window,roomNameDatabase:new Map([['0,0,0',room]]),currentDungeon:d});
  assert.equal(window.getEconomyResidentInfo('Keeper'),null);
  room.cityFloorContext={floor:1};assert.equal(window.getEconomyResidentInfo('Keeper').kind,'shop');
});
