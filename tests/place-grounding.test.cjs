'use strict';
process.env.HOLODEK_HOMEBREW='1';process.env.HOLODEK_GENRE_EXPANSION='1';process.env.HOLODEK_CITY_SITES='1';
process.env.HOLODEK_CAMPAIGN_MAP='1';process.env.HOLODEK_CITY_PLACEMENT='1';process.env.HOLODEK_CITY_COMPLETE='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const L=require('../retort/locationAwareness'),S=require('../retort/settingLayer'),Money=require('../assets/currencyLanguage');
function bible(genre){const b=S.localBible('Original world',[genre]);b.cities=[{name:b.topology.start,role:'starting'}];return S.validateBible(b);}
test('city prose is not settlement identity; directions distinguish map bearings from saved exits',()=>{
  const db={'0,0,0':{name:'City Night Market',classification:{biome:'wasteland',indoor:false},exits:{southeast:{status:'open',targetCoordinates:'1,-1,0'},west:{status:'locked',targetCoordinates:'-1,0,0'}},
    campaignAtlas:{map:{cities:[{name:'Actual City',site:{key:'0,3,0'}},{name:'Hidden City',site:{key:'9,9,0'}}]}}},
    '1,-1,0':{name:'Approach',exits:{north:{status:'open',targetCoordinates:'0,3,0'}}},
    '0,3,0':{name:'City Gate',environmentIntent:{citySite:{name:'Actual City'}}},'9,9,0':{name:'Hidden City',secret:true},
    '-1,0,0':{name:'Locked Site',environmentIntent:{citySite:{name:'Locked City'}}}};
  const f=L.snapshot(db,'0,0,0');assert.equal(f.settlement,null);assert.equal(f.biome,'wasteland');
  const c=f.locales.find(r=>r.name==='Actual City');assert.equal(c.bearing,'north');assert.equal(c.route.via,'southeast');assert.equal(c.route.steps,2);
  assert.equal(f.locales.find(r=>r.name==='Locked City').route,null);assert.ok(!JSON.stringify(f).includes('Hidden City'));
  assert.match(L.prompt(f),/stall is scenery/);assert.match(L.prompt(f),/not a verified traversable route/);
});
test('unknown and hidden routes do not reveal private rooms or resurrect vendors',()=>{
  const db={'0,0,0':{name:'Market',exits:{east:{status:'open',targetCoordinates:'1,0,0',secret:true}},services:{s:{kind:'shop',operator:'Seller'}},
    inhabitants:{actors:{Seller:{status:'recruited',state:'Friendly',hp:10}}}},'1,0,0':{name:'Secret Laboratory',secret:true}};
  assert.deepEqual(L.snapshot(db,'0,0,0').neighbors,[]);assert.equal(L.snapshot(db,'0,0,0').services[0].available,false);
  db['0,0,0'].inhabitants.actors.Seller.status='present';assert.equal(L.snapshot(db,'0,0,0').services[0].available,true);
  db['0,0,0'].inhabitants.actors.Seller.hp=0;assert.equal(L.snapshot(db,'0,0,0').services[0].available,false);
});
test('read-only place diagnostics catch the observed generation mismatches without altering rooms',()=>{
  const db={'0,0,0':{name:'Named Market',setting:{kind:'homebrew',topology:{start:'Named City'},cities:[{name:'Named City'}]},populationComplete:true,campaignSetting:{siteKind:'market'},
    cityRoom:{cityName:'Named City'},sceneSpec:{biome:'wasteland',biomePropsPlan:{profiles:['badlands']},vegetationPlan:{enabled:true,profile:'scorched'},worldContext:{campaign:{origin:'Tartarus'}}}}};
  const before=JSON.stringify(db),report=require('../retort/placeConsistency').audit(db);
  for(const code of ['CITY_BIOME_MISMATCH','URBAN_BADLANDS_DRESSING','URBAN_DEFAULT_DEAD_FOREST','FOREIGN_CAMPAIGN_CONTEXT','MARKET_WITHOUT_BOUND_SERVICE','STARTING_CITY_UNBOUND'])assert.ok(report.findings.some(f=>f.code===code),code);
  assert.equal(JSON.stringify(db),before);
});
for(const genre of Object.keys(Money.NAMES))test(genre+' future start, atlas, public context and currency share the same world',()=>{
  const b=bible(genre);S.setActive(b);
  try{
    const room={name:'Ruined Temple Entrance',complexId:'ruined-temple'},db={'0,0,0':room};S.applyStartRoom(room,b);room.setting=b;
    assert.equal(room.classification.biome,'city');assert.equal(room.complexId,undefined);
    const Map=require('../retort/campaignMap'),atlas=S.campaignPlan('run',b),map=Map.compose('run',atlas);Map.placeCities(map,'run');
    assert.equal(map.cities[0].site.key,'0,0,0');assert.equal(map.cities[0].site.underground,false);
    const result=require('../retort/citySites').install(db,'0,0,0',{seed:'future'});assert.equal(result.status,'installed');
    assert.equal(require('../retort/citySites').install(db,'0,0,0',{seed:'future'}).status,'already-installed');
    const ctx=require('../retort/worldContext').buildRoomWorldContext(db,'0,0,0');assert.equal(ctx.campaign.origin,b.topology.start);
    assert.ok(!JSON.stringify(ctx.campaign).includes('Tartarus'));assert.equal(ctx.complexId,null);
    assert.equal(Money.forWorld(b).plural,Money.NAMES[genre][1]);assert.match(S.guidance(),new RegExp(Money.NAMES[genre][1]));
    const before=JSON.stringify(room);room.visited=true;const saved=JSON.stringify(room);S.applyStartRoom(room,b);assert.equal(JSON.stringify(room),saved);assert.ok(before.length);
  }finally{S.setActive(null);}
});
test('canonical campaign remains canonical and item names / numeric money fields are untouched',()=>{
  S.setActive(null);assert.equal(require('../retort/worldContext').buildRoomWorldContext({'0,0,0':{}},'0,0,0').complexId,'ruined-temple');
  assert.equal(Money.forWorld(null).label,'Silver Pieces');
  const c=Money.forWorld({kind:'homebrew',genres:['cyberpunk']});
  assert.equal(Money.relabelText('Silver Pieces: 12. Costs 1 silver piece. 3 silver left.',c),'Scrip: 12. Costs 1 scrip. 3 scrip left.');
  assert.equal(Money.relabelText('3 silver blades, silver lining, silver key',c),'3 silver blades, silver lining, silver key');
  assert.equal(Money.forWorld({kind:'homebrew',genres:['western'],currency:{singular:'rail chit',plural:'rail chits'}}).plural,'rail chits');
  assert.equal(Money.forWorld({kind:'homebrew',genres:['western'],currencyName:'<script>'}).plural,'dollars');
});
test('currency display reverses cleanly between worlds without rewriting its source',async()=>{
  const text={nodeValue:'Silver Pieces: 17. Magic: 4',parentElement:{closest:()=>false}},nodes=[text];let currency=Money.forWorld({kind:'homebrew',genres:['cyberpunk']});
  const window={CurrencyLanguage:Money,HolodekFlags:{},document:{querySelectorAll:()=>[{}],createTreeWalker:()=>{let i=0;return{nextNode:()=>nodes[i++]};}},NodeFilter:{SHOW_TEXT:4},
    fetch:async()=>({json:async()=>({RESOURCE_NAME:'Tech',CURRENCY:currency})})};
  vm.runInNewContext(fs.readFileSync('assets/resourceLabelUi.js','utf8'),{window});await window.ResourceLabelUi.refresh();assert.equal(text.nodeValue,'Scrip: 17. Tech: 4');
  currency=Money.forWorld(null);await window.ResourceLabelUi.refresh();assert.equal(text.nodeValue,'Silver Pieces: 17. Tech: 4');
});
test('market service roles are engine-bound and starting markets keep two other friendly guides',async()=>{
  S.setActive(bible('cyberpunk'));
  try{
    const G=require('../retort/inhabitantGeneration'),rows=require('./fixtures/inhabitants.cjs')(3),prompts=[];
    const $={user:t=>prompts.push(String(t)),assistant:{generation:async req=>({content:JSON.stringify({inhabitants:require('./fixtures/inhabitant-batch.cjs').batchRows(rows,req)})})}};
    const result=await G.generateInhabitants($,{geoKey:'0,0,0',roomName:'Market',rooms:{'0,0,0':{environmentIntent:{template:'market',citySite:{name:'City'}}}}},
      {random:min=>min,level:()=>1,sex:()=>'Female',xp:()=>0,equipment:async()=>null});
    const actors=Object.values(result.population.actors);assert.equal(actors.length,3);assert.equal(actors.filter(a=>a.serviceRole==='shop').length,1);assert.ok(actors.every(a=>a.allegiance==='Friendly'));
    const db={'0,0,0':{name:'Market',environmentIntent:{template:'market',citySite:{name:'City'}}}};
    require('../retort/economy').seedRoom(db,'0,0,0',result.population,'future','',{deferCommunity:true});
    assert.equal(Object.values(db['0,0,0'].services)[0].operator,actors[1].name);assert.equal(actors[1].job,rows[1].job);assert.match(actors[1].dialogue[0],/scrip/);
    const before=JSON.stringify(db);require('../retort/economy').seedRoom(db,'0,0,0',result.population,'future','',{deferCommunity:true});assert.equal(JSON.stringify(db),before);
  }finally{S.setActive(null);}
});
test('a market operator spawns alongside the actual stall and stays at the saved site',()=>{
  const I=require('../assets/dungeonInhabitants'),d={layout:{width:40,height:40},start:{x:20,y:30},classification:{indoor:false},cells:{},
    sceneStructures:[{shape:'x_cyberpunk_stall',position:{x:7,y:8,z:0},size:{x:2,y:2,z:2}}]};
  for(let y=0;y<40;y++)for(let x=0;x<40;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  const p=I.createPopulation('0,0,0',[{name:'Trader',serviceRole:'shop',encounterId:'vendor',allegiance:'Friendly'}],{starting:true,indoor:false});I.place(p,d);
  const at=p.actors.Trader.position;assert.ok(at);assert.ok(Math.hypot(at.x-8,at.y-11.5)<4,JSON.stringify(at));assert.ok(!(at.x>=7&&at.x<9&&at.y>=8&&at.y<10));
  const saved=JSON.stringify(p);I.place(p,d);assert.equal(JSON.stringify(p),saved);
});
test('local scene, individual live speech and cached alternatives all receive verified geography',async()=>{
  const Work=require('../retort/holodekRoomWork'),old=Work.request,briefs=[];
  Work.request=async(_$,component,_params,brief)=>{briefs.push({component,brief});return component==='story-scene'?{prose:'You stand beside the marked path.',speakers:['Guide']}:component==='npc-live-speech'?{action:'points north.',line:'The city is north, beyond the marsh.',remember:'',recipient:'PC'}:{lines:['The city lies north.','This is still the marsh.']};};
  try{await require('../retort/holodekNarration').generate({}, {consoleText:'Room Name: Marsh\nRoom Description: An open marsh.\nCoordinates: 1,0,0',characters:[{name:'Guide'}],audibleNames:['Guide'],location:{room:'Marsh',biome:'wetland',coordinates:'1,0,0',settlement:null,locales:[{name:'City',bearing:'north',route:null}]}});
    for(const component of ['story-scene','npc-live-speech','npc-reply-cache']){const b=briefs.find(r=>r.component===component)?.brief;assert.match(b,/Marsh/);assert.match(b,/not a verified traversable route/);}
  }finally{Work.request=old;}
});
