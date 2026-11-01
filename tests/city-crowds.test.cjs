'use strict';
for(const flag of ['ARCHITECTURE_EXPANSION','CITY_COMPLETE','CITY_PROPS','CITY_SITES','HOMEBREW'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Crowds=require('../retort/cityCrowds');
function fixture(){
  const key='0,0,30',d={geoKey:key,_geometryStamp:'city',layout:{width:80,height:80},start:{x:40,y:40},cells:{},cityBlocks:{buildings:[]},customTiles:[],sceneStructures:[]};
  for(let y=0;y<80;y++)for(let x=0;x<80;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,cityStreet:'sidewalk'};
  for(let i=0;i<9;i++)d.cityBlocks.buildings.push({id:'building-'+i,left:5+(i%3)*20,top:5+Math.floor(i/3)*20,type:'home'});
  const ecology={version:1,seed:'world',canonical:false,originalPercent:0,entries:Array.from({length:8},(_,i)=>({id:'group-'+i,name:'Native Group '+i,kind:'people',allegiance:'Neutral',weight:1,
    description:'Humanlike habitat residents.',roles:['resident','courier'],habitat:'sealed city',society:'A neighborhood of local families.'}))};
  const db={'0,0,0':{setting:{kind:'homebrew',name:'The Orbital City',genres:['sci-fi'],realm:'A sealed habitat.',peoples:'Native residents.',ecology}},[key]:{name:'Market Ward',description:'A busy local ward.',
    cityRoom:{kind:'street',genre:'sci-fi'},inhabitants:{actors:{}},campaignSetting:{inhabited:true,city:{population:{civilianMajority:true}}}}};
  let stored=d,roster=[],population={geoKey:key,actors:{},groups:[],revision:1};
  const state={getDungeonRunId:()=> 'run',getLastCoords:()=>({x:0,y:0,z:30}),getGamePaused:()=>false,getRoomDungeonForSimulation:()=>stored,
    getRoomNameDatabase:()=>JSON.stringify(db),getRoomPopulation:()=>population,getCombatCharactersString:()=>JSON.stringify(roster),
    setCombatCharactersString:text=>roster=JSON.parse(text),setRoomDungeon:(_coords,next)=>stored=next};
  const request={runId:'run',geoKey:key},service={save:p=>{population=p;db[key].inhabitants=p;}};
  return{key,d,db,state,request,service,get stored(){return stored;},get population(){return population;}};
}
test('physical crowd identities use saved native peoples with no dialogue or sprite model requests',()=>{
  const f=fixture(),crowd=Crowds.synchronize(f.state,f.request);assert.ok(Object.keys(crowd.actors).length>40);
  assert.equal(new Set(Object.values(crowd.actors).map(a=>a.name)).size,Object.keys(crowd.actors).length);
  for(const citizen of Object.values(crowd.actors)){assert.match(citizen.race,/Native Group/);assert.equal(f.stored.cells[`${citizen.position.x},${citizen.position.y}`].tile,'floor');
    assert.equal(citizen.dialogue,undefined);assert.equal(citizen.history,undefined);assert.equal(citizen.sprite,undefined);}
  assert.equal(Crowds.synchronize(f.state,{...f.request,crowdRevision:crowd.revision}),null);
  const old=Object.values(crowd.actors)[0];old.status='promoted';f.stored._geometryStamp='expanded';
  const next=Crowds.synchronize(f.state,f.request);assert.equal(next.actors[old.id].status,'promoted');
});
test('crowds produce bounded procedural bodies in native clothing without requesting LLM traits',()=>{
  const f=fixture(),crowd=Crowds.synchronize(f.state,f.request),root={ProceduralCharacters:require('../assets/renderCharacterProcedural'),GenreArchitecture:require('../assets/genreArchitecture')};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/cityCrowdUi'),'utf8'),{window:root});
  const actors=root.CityCrowdUi.actors(f.stored,{x:40,y:40});assert.ok(actors.length>0&&actors.length<=24);
  for(const actor of actors){assert.equal(actor.sprite.spec.kind,'procedural');assert.equal(actor.sprite.spec.source,'procedural-crowd');assert.ok(actor.sprite.spec.traits.genreGarb);
    const pixels=root.ProceduralCharacters.renderBillboardPixels(actor.sprite.spec,0,false,{view:'front'});assert.ok(pixels.data.some((v,i)=>i%4===3&&v>0));}
  assert.equal(Object.keys(f.population.actors).length,0,'Bystanders are not a combat encounter or cache population');
});
test('meeting authors exactly one existing citizen and saves their name, position and introduction once',async()=>{
  const f=fixture(),crowd=Crowds.synchronize(f.state,f.request),citizen=Object.values(crowd.actors)[0];let calls=0;
  const row=require('./fixtures/inhabitants.cjs')(1,[{slot:0,name:citizen.name,race:citizen.race,allegiance:'Neutral'}])[0];
  const runtime={retort:fn=>fn,run:async fn=>fn({user(){},system(){},messages:[],assistant:{generation:async request=>{
    calls++;assert.equal(request.parameters.inhabitants.maxItems,1);return{content:JSON.stringify({skip:false,inhabitants:[row]})};}}})};
  const request={...f.request,id:citizen.id,player:{x:citizen.position.x+.5,y:citizen.position.y+1.5}};
  const result=await Crowds.meet(f.state,f.service,request,{runtime});assert.equal(calls,1);assert.equal(result.actor,citizen.name);
  assert.equal(Object.keys(f.population.actors).length,1);assert.deepEqual(f.population.actors[citizen.name].position,citizen.position);
  assert.equal(f.stored.cityCrowd.actors[citizen.id].status,'promoted');assert.match(result.content,new RegExp(citizen.name));
  await assert.rejects(Crowds.meet(f.state,f.service,request,{runtime}),/already been met/);assert.equal(calls,1);
});
test('remote, stale and occluded citizen introductions never invoke the model',async()=>{
  const f=fixture(),crowd=Crowds.synchronize(f.state,f.request),citizen=Object.values(crowd.actors)[0],runtime={run(){throw Error('MUST NOT CALL MODEL');}};
  await assert.rejects(Crowds.meet(f.state,f.service,{...f.request,id:citizen.id,player:{x:70,y:70}},{runtime}),/closer/);
  await assert.rejects(Crowds.meet(f.state,f.service,{...f.request,runId:'old',id:citizen.id,player:citizen.position},{runtime}),/no longer active/);
});
test('public local knowledge permits concrete cuisine but never exports the final goal or private faction plans',()=>{
  const f=fixture(),world=f.db['0,0,0'].setting;world.antagonist='SECRET FINAL BOSS';world.topology={goal:'SECRET THRONE'};world.history='SECRET CHAMBER';
  f.db[f.key].campaignSetting.ecology='Hydroponic greens and cultivated mushrooms';
  const location=require('../retort/locationAwareness').snapshot(f.db,{x:0,y:0,z:30}),prompt=require('../retort/locationAwareness').prompt(location);
  assert.match(prompt,/Orbital City|sealed habitat/);assert.match(prompt,/Hydroponic/);assert.match(prompt,/two plausible local alternatives/);assert.match(prompt,/Exact named venues/);
  assert.doesNotMatch(prompt,/SECRET/);
});
