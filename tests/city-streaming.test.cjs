'use strict';
for(const flag of ['CITY_SITES','CITY_COMPLETE','CITY_PROPS','CAMPAIGN_MAP','ARCHITECTURE_EXPANSION','GENRE_EXPANSION','HOMEBREW'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Blocks=require('../retort/cityBlocks'),Floors=require('../retort/cityTowerFloors'),Sites=require('../retort/citySites'),Setting=require('../retort/settingLayer');
function flat(size=384){
  const d={geoKey:'0,0,30',_geometryStamp:'original',generation:{seed:'stream-city'},layout:{width:size,height:size},start:{x:size/2,y:size/2},cells:{},tiles:{},sceneStructures:[]};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};return d;
}
const site={id:'stream-city',name:'Authored City',design:{verticality:{floors:120}}};
function model(floors=120){return{id:'city',name:'City',scale:'metropolis',design:{version:1,source:'model-authored',form:'grid',identity:'A city of stacked neighborhoods.',history:'Many generations.',skyline:'Mixed-use towers.',
  verticality:{floors,transit:'lift',bridges:true,lowerUse:'Trade and public arrivals',middleUse:'Homes and daily life',upperUse:'Civic offices and knowledge',roofUse:'Enclosed crown gardens'},
  districts:Object.fromEntries(Sites.DISTRICTS.map(d=>[d,{name:'Original '+d,atmosphere:'Daily local activity.',residentRoles:['resident','visitor'],locales:[{name:'Original '+d+' House',type:'home'},{name:'Original '+d+' Hall',type:'civic'}],mix:['home','shop','clinic','civic']}]))}};}
test('exploration adds bounded deterministic parcels beyond the initial patch without resetting saved buildings',()=>{
  const d=flat();Blocks.apply(d,{city:{}},site,{genre:'cyberpunk',scale:'metropolis'});
  const original=structuredClone(d.cityBlocks.buildings),oldCells=Object.fromEntries(Object.entries(d.cells).filter(([,c])=>c.cityParcel));
  const result=Blocks.apply(d,{city:{}},site,{genre:'cyberpunk',scale:'metropolis',stream:true,observer:{x:332,y:192}});
  assert.ok(result.buildings+result.parks>0);assert.ok(result.buildings+result.parks<=2);
  assert.deepEqual(d.cityBlocks.buildings.slice(0,original.length),original);
  for(const [k,c]of Object.entries(oldCells))assert.equal(d.cells[k],c);
  const ids=new Set();for(const b of [...d.cityBlocks.buildings,...d.cityBlocks.parks]){assert.ok(!ids.has(b.id));ids.add(b.id);}
  const saved=JSON.parse(JSON.stringify(d)),count=ids.size;
  Blocks.apply(saved,{city:{}},site,{genre:'cyberpunk',scale:'metropolis',stream:true,observer:{x:332,y:192}});
  assert.ok(saved.cityBlocks.buildings.length+saved.cityBlocks.parks.length>=count);
  assert.equal(new Set([...saved.cityBlocks.buildings,...saved.cityBlocks.parks].map(p=>p.id)).size,saved.cityBlocks.buildings.length+saved.cityBlocks.parks.length);
});
test('streaming preserves occupied squares, protected routes, objects and all earlier navigation',()=>{
  const d=flat();Blocks.apply(d,{city:{}},site,{genre:'modern',scale:'metropolis'});
  const point={x:332,y:192},reserved=new Set();for(let y=175;y<210;y++)for(let x=315;x<350;x++)reserved.add(`${x},${y}`);
  d.cells['330,225'].object={id:'saved-loot'};d.cells['335,230'].navigationReserved=true;
  const before=Object.fromEntries([...reserved,'330,225','335,230'].map(k=>[k,structuredClone(d.cells[k])]));
  Blocks.apply(d,{city:{}},site,{genre:'modern',scale:'metropolis',stream:true,observer:point,reserved});
  for(const [k,c]of Object.entries(before)){const {floorSurface,cityStreet,...actual}=d.cells[k],{floorSurface:_,cityStreet:__,...expected}=c;assert.deepEqual(actual,expected,k);}
  const Nav=require('../retort/sceneArchitecture'),reachable=Nav.reachable(Nav.makeNavigation(d),d.start);
  for(const b of [...d.cityBlocks.buildings,...d.cityBlocks.parks])for(const door of b.doors)assert.equal(reachable.seen[door.y*d.layout.width+door.x],1);
});
test('walking reconciles stale snapshots without constructing, finalizing or saving city geometry',()=>{
  const d=flat();Blocks.apply(d,{city:{}},site,{genre:'modern',scale:'metropolis'});d._geometryStamp='before';
  const population={actors:{Saved:{position:{x:332,y:232},status:'dead',inventory:['heirloom']}}},before=JSON.stringify(population);
  let stored,stamps=0;const state={getGamePaused:()=>false,getLastCoords:()=>({x:0,y:0,z:30}),getDungeonRunId:()=> 'run',getRoomDungeonForSimulation:()=>structuredClone(stored||d),
    getRoomNameDatabase:()=>JSON.stringify({[d.geoKey]:{cityRoom:{kind:'street'},environmentIntent:{citySite:site}}}),getRoomPopulation:()=>population,
    getCombatCharactersString:()=> '[]',setRoomDungeon:(_coords,value)=>stored=value};
  const advance=require('../retort/cityStreaming').advance,request={runId:'run',geoKey:d.geoKey,player:{x:332,y:192}},finalize=(_key,room)=>({...room,_geometryStamp:'after-'+(++stamps)});
  assert.equal(advance(state,{...request,runId:'old'},{finalize}),null);assert.equal(stored,undefined);
  assert.equal(advance(state,{...request,player:{x:NaN,y:1}},{finalize}),null);
  const authoritative=JSON.stringify(d);
  assert.equal(advance(state,request,{finalize}),null);
  assert.equal(advance(state,{...request,geometryStamp:'before'},{finalize}),null);
  const recovery=advance(state,{...request,geometryStamp:'missed-stream'},{finalize});
  assert.equal(recovery.cityStream.snapshot._geometryStamp,'before');assert.equal(recovery.previousStamp,'missed-stream');
  assert.equal(advance(state,{...request,player:{x:192,y:332}},{finalize}),null);
  assert.equal(stored,undefined);assert.equal(stamps,0);assert.equal(JSON.stringify(d),authoritative);assert.equal(JSON.stringify(population),before);
});
test('client applies streamed structures exactly once and refuses a previous run or geometry revision',()=>{
  const source=fs.readFileSync(require.resolve('../assets/game'),'utf8'),start=source.indexOf('window.applyLivingEnvironmentDelta = function(data)'),end=source.indexOf('\n};',start)+3;
  const d={geoKey:'0,0,30',_geometryStamp:'before',cells:{},tiles:{},sceneStructures:[]},window={dungeonRunId:'run'};
  vm.runInNewContext(source.slice(start,end),{window,currentDungeon:d,console:{error(){}},idbSetDungeon:()=>Promise.resolve(),renderDungeonView(){}});
  const event={geoKey:d.geoKey,runId:'run',previousStamp:'before',geometryStamp:'after',cells:{'2,2':{tile:'wall'}},cityStream:{blocks:{},tiles:{wall:{}},structures:[{role:'tower'}],lights:[]}};
  window.applyLivingEnvironmentDelta({...event,runId:'old'});assert.equal(d.sceneStructures.length,0);
  window.applyLivingEnvironmentDelta(event);window.applyLivingEnvironmentDelta(event);assert.equal(d.sceneStructures.length,1);assert.equal(d._geometryStamp,'after');
  window.applyLivingEnvironmentDelta({...event,previousStamp:'stale',geometryStamp:'new'});assert.equal(d.sceneStructures.length,1);
});
test('new 160-storey towers have compact host-local floor recipes, reciprocal circulation and no eager rooms or residents',()=>{
  Setting.setActive(Setting.validateBible(Setting.localBible('A vertical city',['cyberpunk'])));
  try{
    const city=model(160),db={'0,3,0':{name:'City',exits:{},environmentIntent:{citySite:city}}};Sites.install(db,'0,3,0',{seed:'floors'});
    const grounds=Object.entries(db).filter(([,r])=>r.cityRoom?.vertical?.floor===0&&r.cityRoom.vertical.directory.length>100);assert.equal(grounds.length,2);
    for(const [key,ground]of grounds){
      const directory=ground.cityRoom.vertical.directory,ref=ground.cityRoom.architecture,record=db[ref.hostKey].cityArchitecture.buildings[ref.buildingId];
      assert.equal(directory.length,161);assert.equal(directory[0].key,ref.hostKey);
      for(let floor=0;floor<=160;floor++){
        const room=require('../retort/hostLocalFloors').floorRoom(db,{...ref,floor}),c=room.cityRoom;assert.equal(c.vertical.floor,floor);
        assert.equal(c.vertical.elevationMetres,floor===0?0:c.vertical.podiumHeightMetres+(floor-1)*c.vertical.storeyHeightMetres);
        if(floor>0)assert.ok(c.venue.storeyClearance*2.5<c.vertical.storeyHeightMetres,'Upper ceilings cannot cross the floor above');
        assert.ok(c.floorProgram.units>=2);assert.ok(c.floorProgram.residents>=8&&c.floorProgram.residents<=24);assert.ok(room.indoor);
        assert.equal(room.inhabitants,undefined);assert.equal(room.dungeon,undefined);
        assert.ok(directory[floor].key.split(',').every(n=>Math.abs(Number(n))<=999));
        const plan=require('../assets/cityBuildingPlans').floor(record.plan,floor);
        if(floor>0)assert.equal(plan.connections.down,floor-1);
        if(floor<160)assert.equal(plan.connections.up,floor+1);
        assert.equal(directory[floor].key,ref.hostKey);
      }
    }
    const saved=JSON.stringify(db);Sites.install(db,'0,3,0',{seed:'other'});assert.equal(JSON.stringify(db),saved);
  }finally{Setting.setActive(null);}
});
test('busy tower floors use small authored batches and place all residents once in the actual interior',async()=>{
  const Generation=require('../retort/inhabitantGeneration'),Life=require('../retort/cityLife'),{batchRows}=require('./fixtures/inhabitant-batch.cjs');
  const venue=Life.venue('home','floor:12','Authored Floor 12'),key='0,0,80',rows=require('./fixtures/inhabitants.cjs')(24),requests=[];
  const $={user(){},assistant:{generation:async request=>{requests.push(request);return{content:JSON.stringify({inhabitants:batchRows(rows,request)})};}}};
  const result=await Generation.generateInhabitants($,{roomName:venue.name,roomDescription:'A lived-in floor.',geoKey:key,indoor:true,
    rooms:{[key]:{cityRoom:{venue,floorProgram:{version:1,floor:12,units:12,residents:24}}}},campaignSetting:{inhabited:true,city:{venue,population:{civilianMajority:true}}}},
    {random:min=>min,level:()=>1,sex:()=> 'Female',xp:()=>0,equipment:async()=>null});
  assert.equal(requests.length,6);assert.equal(Object.keys(result.population.actors).length,24);
  assert.ok(Object.values(result.population.actors).every(a=>a.unitId));
  const d=flat(96);d.geoKey=key;d.cityVenue={id:venue.id,units:[{id:'floor-12:unit-1',position:{x:30,y:30}},{id:'floor-12:unit-2',position:{x:60,y:60}}]};const I=require('../assets/dungeonInhabitants');I.place(result.population,d);
  assert.ok(Object.values(result.population.actors).every(a=>d.cityVenue.units.some(u=>u.id===a.unitId)));
  assert.ok(Object.values(result.population.actors).every(a=>a.position));const before=JSON.stringify(result.population);I.place(result.population,d);assert.equal(JSON.stringify(result.population),before);
});
test('tower unit addresses refer to real fitted rooms and furnishings, not off-map imaginary apartments',()=>{
  const venue=require('../retort/cityLife').venue('home','floor-4','Floor 4');Object.assign(venue,{width:32,depth:36});
  const d={geoKey:'1,1,80',layout:{width:64,height:64},start:{x:32,y:48},classification:{indoor:true},generation:{seed:'floor'},
    sceneSpec:{city:{genre:'cyberpunk',venue,floorProgram:{version:1,floor:4,units:3,residents:8}}},cells:{},tiles:{},sceneStructures:[]};
  const plan={rooms:[{x:.4,y:.7,w:.2,h:.25,role:'entrance',shape:'hall'},{x:.2,y:.25,w:.6,h:.4,role:'hall',shape:'hall'},
    {x:.02,y:.03,w:.2,h:.2,role:'chamber',shape:'hall'},{x:.75,y:.03,w:.2,h:.2,role:'chamber',shape:'hall'}]};
  require('../retort/indoorBlueprint').build(d,plan,{floor:0,ceil:3});assert.equal(d.cityVenue.units.length,3);
  for(const unit of d.cityVenue.units){assert.ok(unit.position);assert.equal(d.cells[`${unit.position.x},${unit.position.y}`].tile,'floor');
    assert.ok(unit.position.x>=unit.room.x&&unit.position.x<unit.room.x+unit.room.width);assert.ok(unit.position.y>=unit.room.y&&unit.position.y<unit.room.y+unit.room.depth);}
});
test('24-resident holodek-1 floors remain inside the real 4096 input plus output budget for every single-resident work order',async()=>{
  const Models=require('../retort/gameModels'),Host=require('../retort/pcModelHost'),Runtime=require('../retort/gameRetort'),Budget=require('../retort/holodekBudget'),Life=require('../retort/cityLife');
  const previous=Models.current().id;Models.restore('holodek-1');Setting.setActive(Setting.validateBible(Setting.localBible('A vast original city',['sci-fi'])));
  const rows=require('./fixtures/inhabitants.cjs')(24).map(r=>({...r,allegiance:'Neutral',homeSite:'commons',encounterId:'floor-'+r.slot}));
  const venue=Life.venue('home','tower:floor:60','Authored Floor 60');let calls=0;
  const host=Host.createHost({fetchImpl:async(_url,init)=>{
    const body=JSON.parse(init.body),input=Budget.tally(body.messages,[{response_format:body.response_format}]).total;calls++;
    assert.ok(input+body.max_tokens+Budget.SAFETY<=4096);const ids=body.response_format.json_schema.schema.properties.inhabitants.items.properties.slot.enum;
    return{ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({inhabitants:rows.filter(r=>ids.includes(r.slot))})}}]})};
  }}),app=Runtime.createRuntime({models:{...Models,getLocalClient:()=>Host.modelClient(host)},log(){}});
  try{
    const result=await app.run(app.retort($=>require('../retort/inhabitantGeneration').generateInhabitants($,{roomName:venue.name,roomDescription:'Homes around a shared indoor circulation core.',
      geoKey:'1,1,120',indoor:true,usedNames:Array.from({length:1200},(_,i)=>'Earlier Citizen '+i),
      campaignSetting:{inhabited:true,city:{venue,population:{civilianMajority:true}}},
      rooms:{'1,1,120':{cityRoom:{venue,floorProgram:{version:1,floor:60,units:12,residents:24}}}}},
      {random:min=>min,level:()=>1,sex:()=> 'Female',xp:()=>0,equipment:async()=>null})),null,{shouldSaveToLog:false});
    assert.ok(result.population,result.error?.message);assert.equal(calls,24);assert.equal(Object.keys(result.population.actors).length,24);
  }finally{Models.restore(previous);Setting.setActive(null);}
});
test('tower directories do not inflate generation prompts and legacy room access remains unchanged',()=>{
  const city=model(),db={'0,3,0':{name:'City',exits:{},environmentIntent:{citySite:city}}};Sites.install(db,'0,3,0');
  const ground=Object.values(db).find(r=>r.cityRoom?.vertical?.floor===0&&r.cityRoom.vertical.directory.length>100);
  assert.ok(ground.cityRoom.vertical.directory.length>100);
  assert.equal(ground.campaignSetting.city.vertical.directory,undefined);assert.doesNotMatch(Sites.describe(ground),/"directory"/);
  const legacy={'0,3,0':{citySites:{version:'old'},environmentIntent:{citySite:city}},'1,1,31':{visited:true,cityRoom:{anchorKey:'0,3,0',completion:require('../retort/cityCompletion').VERSION},inhabitants:{actors:{Saved:{status:'dead'}}}}};
  const before=JSON.stringify(legacy);Sites.install(legacy,'0,3,0');assert.equal(JSON.stringify(legacy),before);
});
module.exports={flat,model,site};
