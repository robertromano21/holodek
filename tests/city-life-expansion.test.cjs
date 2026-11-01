'use strict';
for(const flag of ['CITY_SITES','CITY_COMPLETE','ARCHITECTURE_EXPANSION','GENRE_EXPANSION','GENRE_KITS','HOMEBREW','MARKET_ECONOMY'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../assets/cityEstablishments'),Life=require('../retort/cityLife'),City=require('../retort/citySites');
const Setting=require('../retort/settingLayer'),I=require('../assets/dungeonInhabitants'),Indoor=require('../retort/indoorBlueprint');
const Nav=require('../retort/sceneArchitecture');
function design(){return{version:1,source:'model-authored',venueProgram:1,scale:'metropolis',form:'grid',identity:'A distinctive city of crossing paths.',
  history:'Built by several communities.',skyline:'Tall towers frame public halls.',
  verticality:{floors:120,transit:'lift',bridges:true,lowerUse:'Public services',middleUse:'Homes and studios',upperUse:'Offices',roofUse:'Enclosed viewing gallery'},
  districts:Object.fromEntries(City.DISTRICTS.map(id=>[id,{name:'Original '+id,atmosphere:'A neighborhood with its own customs.',
    residentRoles:['resident','visitor'],locales:Life.required(id).map(type=>({name:id+' '+type+' landmark',type})),mix:['shop','inn','home','park','guild']}]))};}
function database(){return{'0,3,0':{name:'City Arrival',environmentIntent:{citySite:{id:'city-life',name:'New City',population:150000,design:design()}},exits:{west:{status:'locked',targetCoordinates:'-1,3,0'}},objects:[]}};}
function interior(type){
  const venue=Life.venue(type,'venue:'+type,'Authored '+type),d={geoKey:'0,0,31',layout:{width:64,height:64},start:{x:32,y:48},
    classification:{indoor:true},generation:{seed:'venue-layout'},sceneSpec:{city:{genre:'cyberpunk',venue}},cells:{},tiles:{},sceneStructures:[]};
  const plan={rooms:[{x:.4,y:.7,w:.2,h:.25,role:'entrance',shape:'hall'},{x:.2,y:.25,w:.6,h:.4,role:'hall',shape:'hall'},
    {x:.02,y:.03,w:.2,h:.2,role:'chamber',shape:'hall'},{x:.75,y:.03,w:.2,h:.2,role:'chamber',shape:'hall'}]};
  Indoor.build(d,plan,{floor:0,ceil:3});return{d,venue,plan};
}

test('every approved venue has native labels, legal templates, useful spaces and physically distinct dimensions in all eighteen genres',()=>{
  const catalog=require('../retort/environmentIntents').CATALOG,F=require('../assets/genreFurnishings');
  assert.equal(E.TYPES.length,18);assert.equal(Object.keys(E.NAMES).length,18);
  for(const [genre,names]of Object.entries(E.NAMES)){
    assert.equal(names.length,E.TYPES.length,genre);assert.equal(new Set(names).size,names.length,genre);
    for(const type of E.TYPES){const p=E.profile(type);assert.ok(p&&catalog[E.TEMPLATES[type]],genre+':'+type);
      assert.ok(p.spaces.length>=3&&p.roles.length>=3);assert.ok(p.width>=16&&p.depth>=18);
      for(const role of p.furniture)assert.ok(F.has(`f_${genre}_${role}`));}
  }
  assert.ok(E.profile('arena').width*E.profile('arena').depth>7*E.profile('shop').width*E.profile('shop').depth);
  assert.ok(E.profile('temple').clearance>E.profile('shop').clearance*2);
  assert.equal(E.name('inn','sci-fi'),'Transit Berths');assert.equal(E.name('arena','cyberpunk'),'Combat Sports Dome');
  for(const genre of Object.keys(E.NAMES))assert.doesNotMatch(Life.brief(genre,false),/Children of the Grave|Tartarus|Mortacia|Arithus/);
  assert.match(Life.brief('dark-fantasy',true),/Children of the Grave/);
});

test('all authored landmarks are installed exactly once before procedural filler across seeds and genres',()=>{
  const draft=design(),expected=Object.values(draft.districts).flatMap(d=>d.locales);
  for(const genre of Object.keys(E.NAMES))for(let seed=0;seed<12;seed++){
    const p=City.plan({city:{id:'city',name:'Metropolis',design:draft,population:200000},genre,seed:String(seed)});
    assert.deepEqual(City.validate(p),[],genre+':'+seed);assert.ok(p.rooms.length>=30&&p.rooms.length<=60);
    assert.equal(p.stats.authoredLocales,expected.length);
    for(const l of expected){const matches=p.rooms.filter(r=>r.name===l.name);assert.equal(matches.length,1,l.name);
      assert.equal(matches[0].establishmentType,l.type);assert.equal(matches[0].authored,true);assert.ok(matches[0].exits);}
    assert.equal(new Set(p.rooms.filter(r=>r.venue).map(r=>r.venue.id)).size,p.rooms.filter(r=>r.venue).length);
    assert.ok(p.rooms.filter(r=>r.vertical?.floor>0).every(r=>!r.authored));
  }
});

test('city installation preserves saved neighbors, records venue purpose, keeps parks open and never invents staff',()=>{
  Setting.setActive(null);const db=database(),neighbor={visited:true,name:'Saved neighbor',inhabitants:{actors:{Ada:{status:'dead'}}}};
  db['-1,3,0']=neighbor;const before=JSON.stringify(neighbor);
  assert.equal(City.install(db,'0,3,0',{seed:'run'}).status,'installed');
  assert.equal(JSON.stringify(db['-1,3,0']),before);assert.equal(db['0,3,0'].exits.west.status,'locked');
  for(const room of Object.values(db).filter(r=>r.cityRoom?.venue)){
    const c=room.cityRoom;assert.equal(room.campaignSetting.city.venue.id,c.venue.id);
    assert.equal(c.footprint.width,c.venue.width);assert.equal(c.footprint.depth,c.venue.depth);
    assert.ok(c.population.roles.includes(c.venue.roles[0]));assert.equal(room.inhabitants,undefined);
    if(c.establishmentType==='park'){assert.equal(room.classification.indoor,false);assert.equal(room.isOutdoor,true);assert.equal(room.market,undefined);}
    if(['arena','guild','library','court','home'].includes(c.establishmentType))assert.equal(require('../retort/serviceRoles').kind(room),null);
  }
  const saved=JSON.stringify(db);assert.equal(City.install(db,'0,3,0').status,'already-installed');assert.equal(JSON.stringify(db),saved);
});

test('a station or underwater city keeps public gardens under its actual enclosure instead of exposing them to vacuum or ocean',()=>{
  for(const genre of ['sci-fi','underwater']){
    Setting.setActive(Setting.validateBible(Setting.localBible('Enclosed habitat',[genre])));
    try{
      const db=database();db['0,3,0'].environmentIntent.citySite.design.enclosed=true;
      assert.equal(City.install(db,'0,3,0',{seed:'habitat'}).status,'installed');
      const park=Object.values(db).find(r=>r.cityRoom?.establishmentType==='park');assert.ok(park);
      assert.equal(park.classification.indoor,true);assert.equal(park.environmentIntent.indoor,true);assert.equal(park.isOutdoor,false);
    }finally{Setting.setActive(null);}
  }
});

test('venue envelopes keep authored rooms within their actual footprint, connected, furnished and tall enough',()=>{
  Setting.setActive(null);
  for(const type of E.TYPES.filter(t=>!E.profile(t).openAir)){
    const {d,venue,plan}=interior(type),bounds=d.cityVenueBounds;
    assert.equal(bounds.width,venue.width);assert.equal(bounds.depth,venue.depth);
    const nav=Nav.reachable(Nav.makeNavigation(d),d.start);assert.equal(d.indoorLayout.disconnectedRooms,0,type);
    for(const r of d.indoorRooms){assert.ok(r.x>=bounds.left-1&&r.y>=bounds.top-1,type);
      assert.ok(r.x+r.w<=bounds.left+bounds.width+1&&r.y+r.h<=bounds.top+bounds.depth+1,type);
      assert.ok(r.clearance>=venue.clearance);assert.ok(nav.seen[(r.y+Math.floor(r.h/2))*64+r.x+Math.floor(r.w/2)]);}
    assert.ok(d.cityVenue.furnishings>0,type);assert.equal(plan.rooms[0].x,.4,'Fitting does not mutate the authored blueprint');
    const genre=require('../assets/genreKits').resolve({genre:'cyberpunk'},Setting.current()).genre;
    assert.ok(d.sceneStructures.filter(s=>s.role==='city-venue-furniture').every(s=>s.shape.startsWith('f_'+genre+'_')));
  }
});

test('an overflowing model rectangle is clamped to the venue envelope rather than creating an enormous interior',()=>{
  const v=Life.venue('shop','small','Small shop'),result=require('../retort/cityVenueLayout').fit({rooms:[{x:.9,y:.9,w:.8,h:.8,role:'hall'}]},v,64,64);
  const r=result.rooms[0],b=result.venueBounds;assert.ok((r.x+r.w)*64<=b.left+b.width);assert.ok((r.y+r.h)*64<=b.top+b.depth);
});

test('a monumental temple exterior has its real footprint, high nave, grounded foundation and native open entrance frames',()=>{
  const C=require('../retort/cityBlocks'),Exits=require('../assets/dungeonExits'),size=256;
  const d={geoKey:'0,0,30',layout:{width:size,height:size},start:{x:128,y:128},generation:{seed:'monument'},cells:{},tiles:{},sceneStructures:[]};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  const p=E.profile('temple'),exits={east:{status:'locked',targetCoordinates:'4,0,31'}};
  Exits.install(d,exits);
  C.apply(d,{city:{routes:[{direction:'east',targetCoordinates:'4,0,31',name:'Authored Sanctuary',establishmentType:'temple',footprint:p}]}},
    {id:'temple-city',name:'City',design:{verticality:{floors:120}}},{genre:'mythic',scale:'metropolis'});
  const b=d.cityBlocks.buildings.find(b=>b.authored);assert.ok(b);
  assert.equal(b.metres.width,110);assert.equal(b.metres.depth,130);assert.equal(b.clearance*2.5,18);
  assert.equal(b.storeys,2,'A monumental nave is not replaced with a residential tower');
  const parts=d.sceneStructures.filter(s=>s.cityParcel===b.id);
  assert.ok(parts.some(s=>s.role==='city-building-foundation'&&s.position.z<=b.base&&s.position.z+s.size.z>=b.base+.24));
  const frames=parts.filter(s=>s.role==='city-venue-entryframe');assert.equal(frames.length,2);
  assert.ok(frames.every(s=>s.shape.startsWith('a_mythic_')&&s.position.z===b.base+.08));
  const nav=Nav.reachable(Nav.makeNavigation(d),d.start);assert.ok(b.doors.every(p=>nav.seen[p.y*size+p.x]));
  assert.equal(exits.east.status,'locked');assert.equal(d.cityBuildingEntrances[0].targetCoordinates,'4,0,31');
  assert.ok(d.cityBlocks.streetSection.sidewalkWidthMetres>=2.5,'Dense side streets retain a full pedestrian pavement');
});

test('public city directions include real named venues and next exits, never hidden or disconnected promises',()=>{
  const db=database();City.install(db,'0,3,0',{seed:'directions'});
  const first=Object.entries(db).find(([,r])=>r.cityRoom?.establishmentType==='inn'),[key,room]=first;
  const street=room.cityRoom.streetKey,facts=require('../retort/locationAwareness').snapshot(db,street);
  const inn=facts.locales.find(l=>l.coordinates===key);assert.ok(inn);assert.equal(inn.use,'inn');assert.ok(inn.route.via);
  assert.equal(db[street].exits[inn.route.via].targetCoordinates,key);
  room.hidden=true;assert.ok(!require('../retort/locationAwareness').snapshot(db,street).locales.some(l=>l.coordinates===key));
});

test('venue staff and patrons are authored in the existing batches for CotG and original worlds, with real service roles',async()=>{
  const Generation=require('../retort/inhabitantGeneration'),{batchRows}=require('./fixtures/inhabitant-batch.cjs');
  const {templateContent}=require('retort-js/dist/message');
  for(const original of [false,true])for(const type of ['arena','inn','clinic','guild','park','foodhall']){
    Setting.setActive(original?Setting.validateBible(Setting.localBible('Original metropolis',['sci-fi'])):null);
    const venue=Life.venue(type,'venue:'+type,'Authored '+type),key='0,0,31',rows=require('./fixtures/inhabitants.cjs')(8),prompts=[],requests=[];
    const room={cityRoom:{kind:'building',establishmentType:type,venue}},setting={inhabited:true,city:{venue,population:{civilianMajority:true}}};
    const $={user:(parts,...values)=>prompts.push(typeof parts==='string'?parts:templateContent(parts,...values)),assistant:{generation:async request=>{
      requests.push(request);return{content:JSON.stringify({inhabitants:batchRows(rows,request)})};}}};
    try{
      const result=await Generation.generateInhabitants($,{roomName:'Authored '+type,roomDescription:'A venue with its own daily activity.',geoKey:key,
        indoor:true,campaignSetting:setting,rooms:{[key]:room}},
        {random:min=>min,level:()=>1,sex:()=>'Female',xp:()=>0,equipment:async()=>null});
      assert.equal(requests.length,2,'No additional model calls to manufacture a crowd');
      assert.equal(Object.keys(result.population.actors).length,8);assert.equal(result.population.venue.id,venue.id);
      assert.match(prompts.join('\n'),/VENUE FUNCTION/);assert.match(prompts.join('\n'),/venueDuty/);
      assert.equal(result.population.actors['Resident 1'].serviceRole,venue.service);
      if(original)assert.doesNotMatch(prompts.join('\n'),/Tartarus|Arithus|Mortacia/);
    }finally{Setting.setActive(null);}
  }
});

test('staff placement in new compact venues is prioritized without resetting people between rounds or revisits',()=>{
  const {d,venue}=interior('shop'),rows=require('./fixtures/inhabitants.cjs')(8).map((r,i)=>({...r,allegiance:'Neutral',encounterId:'group-'+i,
    ...(i===1?{serviceRole:'shop'}:{})}));
  const pop=I.createPopulation(d.geoKey,rows,{indoor:true});pop.venue={version:1,id:venue.id,type:venue.type};
  I.place(pop,d);assert.ok(pop.actors['Resident 1'].position);assert.ok(Object.values(pop.actors).every(a=>a.position));
  for(const a of Object.values(pop.actors))assert.equal(d.cells[`${a.position.x},${a.position.y}`].tile,'floor');
  const before=JSON.stringify(pop.actors);I.place(pop,d);assert.equal(JSON.stringify(pop.actors),before);
});

test('an explicitly evil temple remains hostile even with an original venue name',()=>{
  const C=require('../retort/campaignSetting');assert.equal(C.hostileTemple({religion:{patron:'Arithus'},city:{establishmentType:'temple'}},'The Unspoken Vault'),true);
  assert.equal(C.hostileTemple({religion:{patron:'Arithus'},city:{establishmentType:'park'}},'Public Garden'),false);
});

test('CotG and science-fiction venue staffing fit real holodek-1 input and output reservations without more batches',async()=>{
  const Models=require('../retort/gameModels'),Host=require('../retort/pcModelHost'),Runtime=require('../retort/gameRetort'),Budget=require('../retort/holodekBudget');
  const previous=Models.current().id;
  for(const genre of [null,'sci-fi']){
    const world=genre?Setting.validateBible(Setting.localBible('Orbital culture',[genre])):null;
    Setting.setActive(world);Models.restore('holodek-1');let calls=0;
    const rows=require('./fixtures/inhabitants.cjs')(8).map(r=>({...r,allegiance:'Neutral',homeSite:'commons',encounterId:'care-'+r.slot}));
    const venue=Life.venue('clinic','venue:medical','Authored Care Facility'),setting={inhabited:true,city:{venue,population:{civilianMajority:true}}};
    const host=Host.createHost({fetchImpl:async(_url,init)=>{
      const body=JSON.parse(init.body),input=Budget.tally(body.messages,[{response_format:body.response_format}]).total;calls++;
      assert.ok(input<=Budget.CEILING);assert.ok(input+body.max_tokens+Budget.SAFETY<=4096);
      const ids=body.response_format.json_schema.schema.properties.inhabitants.items.properties.slot.enum;
      return{ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({inhabitants:rows.filter(r=>ids.includes(r.slot))})}}]})};
    }});
    const app=Runtime.createRuntime({models:{...Models,getLocalClient:()=>Host.modelClient(host)},log(){}});
    try{
      const result=await app.run(app.retort($=>require('../retort/inhabitantGeneration').generateInhabitants($,{roomName:venue.name,
        roomDescription:'A staffed care facility with reception and treatment rooms.',geoKey:'2,0,31',indoor:true,campaignSetting:setting,
        usedNames:Array.from({length:800},(_,i)=>'Earlier Citizen '+i),
        rooms:{'2,0,31':{cityRoom:{kind:'building',establishmentType:'clinic',venue}}}},
        {random:min=>min,level:()=>1,sex:()=> 'Female',xp:()=>0,equipment:async()=>null})),null,{shouldSaveToLog:false});
      assert.ok(result.population,result.error?.message);assert.equal(calls,8);
      assert.equal(result.population.actors['Resident 1'].serviceRole,'temple');
    }finally{Models.restore(previous);Setting.setActive(null);}
  }
});

test('names omitted from the compact local prompt still participate in authoritative duplicate checks',async()=>{
  const Models=require('../retort/gameModels'),Generation=require('../retort/inhabitantGeneration'),{batchRows}=require('./fixtures/inhabitant-batch.cjs');
  const previous=Models.current().id;Models.restore('holodek-1');Setting.setActive(null);
  const rows=require('./fixtures/inhabitants.cjs')(8,[{slot:0,name:'Long Ago Citizen'}]);
  const names=['Long Ago Citizen',...Array.from({length:800},(_,i)=>'Earlier Citizen '+i)];
  const $={user(){},assistant:{generation:async request=>({content:JSON.stringify({inhabitants:batchRows(rows,request)})})}};
  try{
    await assert.rejects(Generation.generateInhabitants($,{roomName:'A public hall',roomDescription:'A public hall with residents.',
      geoKey:'1,0,31',indoor:true,usedNames:names},{random:min=>min,level:()=>1,sex:()=> 'Female',xp:()=>0,equipment:async()=>null}),/duplicate or reserved name/);
  }finally{Models.restore(previous);}
});
