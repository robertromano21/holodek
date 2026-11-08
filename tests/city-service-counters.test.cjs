'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../assets/cityServiceCounters'),I=require('../assets/dungeonInhabitants'),S=require('../retort/serviceCounters'),E=require('../retort/economy');
function fixture(){
  const file=require.resolve('./economy.test.cjs'),source=fs.readFileSync(file,'utf8');
  const f=vm.runInNewContext(source.slice(0,source.indexOf("test('initial pooled"))+'\nfixture();',
    {require:require('node:module').createRequire(file)});f.business('shop');
  f.d.cityBlocks={buildings:[{id:'venue',type:'shop',name:'Authored shop',left:1,top:1,width:12,depth:12}]};
  f.d.sceneStructures=[{id:'counter-one',venueId:'venue',serviceCounter:true,shape:'f_fantasy_wares',
    position:{x:4,y:3,z:0},size:{x:1,y:1,z:.6}}];
  Object.assign(f.p.actors.Keeper,{position:{x:8,y:4},home:{x:8,y:4},occupation:{mode:'work',venueId:'venue',venueType:'shop'}});
  f.p.groups[0].site={x:8,y:4};
  const roster=JSON.parse(f.state.getCombatCharactersString());roster.find(a=>a.name==='Keeper').mazeX=8;f.state.setCombatCharactersString(JSON.stringify(roster));
  f.change(db=>db['1,0,0'].inhabitants=f.p);
  f.request={runId:'test-run',geoKey:'1,0,0',counterId:'counter-one',player:{x:4.5,y:4.5}};return f;
}
test('new service venues have one genre-native physical counter and an adjacent work site',()=>{
  const Venues=require('../assets/cityEstablishments'),F=require('../retort/venueFurnishings');
  for(const genre of Object.keys(Venues.NAMES))for(const type of Venues.TYPES){
    const d={start:{x:1,y:1},cells:{},tiles:{},sceneStructures:[]};
    for(let y=0;y<24;y++)for(let x=0;x<24;x++)d.cells[`${x},${y}`]={tile:'floor',ceilHeight:4};
    const fitted=F.place(d,[{x:4,y:4,width:16,depth:16,use:'public reception'}],{type,genre,kit:{voxel:'stone',palette:{}},id:'venue',max:8});
    const counters=fitted.parts.filter(p=>p.serviceCounter);
    assert.equal(counters.length,['home','park'].includes(type)?0:1,genre+':'+type);
    if(counters.length){assert.equal(counters[0].shape,`f_${genre}_wares`);assert.ok(fitted.sites.some(s=>s.serviceCounter));}
  }
});
test('existing saved counters are clickable without rebuilding geometry; homes and beds are not counters',()=>{
  const f=fixture(),part=f.d.sceneStructures[0];delete part.serviceCounter;
  assert.equal(C.catalog(f.d)[0].id,part.id);assert.equal(part.serviceCounter,undefined);
  const d={...f.d,sceneStructures:[{...part,shape:'f_fantasy_sleeping'}]};assert.equal(C.catalog(d).length,0);
  assert.equal(C.catalog({...f.d,cityBlocks:{buildings:[{id:'venue',type:'home'}]}}).length,0);
});

test('new named venue operators start near their counter while saved resident positions remain unchanged',()=>{
  const d={geoKey:'1,0,0',classification:{indoor:true},layout:{width:40,height:40},start:{x:20,y:36},cells:{},
    cityVenue:{id:'venue',workSites:[{serviceCounter:true,position:{x:8,y:8}}]},_geometryStamp:'first'};
  for(let y=1;y<39;y++)for(let x=1;x<39;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:4};
  for(const kind of ['shop','temple','library']){
    const p=I.createPopulation(d.geoKey,[{name:'Keeper',race:'Human',allegiance:'Neutral',encounterId:'venue-operator',
      ...(kind==='library'?{}:{serviceRole:kind})}],{indoor:true});p.venue={version:1,id:'venue'};
    I.place(p,d);assert.ok(Math.hypot(p.actors.Keeper.home.x-8,p.actors.Keeper.home.y-8)<4,kind);
    p.actors.Keeper.position={x:15,y:16};const home={...p.actors.Keeper.home};
    I.place(p,{...d,_geometryStamp:'changed'});assert.deepEqual(p.actors.Keeper.home,home);assert.deepEqual(p.actors.Keeper.position,{x:15,y:16});
  }
});
test('counter resolution uses its saved operator; transactions remain priced and nonce-protected',()=>{
  const f=fixture(),selection=S.resolve(f.state,f.request);assert.equal(selection.actor,'Keeper');
  assert.equal(E.view(f.state,'Keeper').error,undefined,'An ordinary resident click is no longer limited to three cells.');
  assert.ok(!E.view(f.state,'Keeper',selection.counterId).error);
  const request={kind:'buy',actor:'Keeper',item:'healing potion 6 hp',counterId:selection.counterId};
  assert.ok(!f.action(request).error);assert.equal(f.book().silver,0);
  assert.match(f.state.getUpdatedGameConsole(),/Inventory: healing potion 6 hp/);
  assert.equal(f.db()['1,0,0'].services.shop.stock[0].quantity,1);
  assert.match(f.action(request).error,/Not enough silver/);
});
test('counter validation rejects wrong venues, missing geometry, out-of-range observers, hostile and hidden providers',()=>{
  for(const alter of [f=>f.request.counterId='forged',f=>f.request.runId='old',f=>f.request.geoKey='9,9,9',
    f=>f.request.player={x:14.5,y:14.5},f=>f.p.actors.Keeper.occupation.venueId='another',
    f=>{const a=JSON.parse(f.state.getCombatCharactersString());a.find(a=>a.name==='Keeper').state='Hostile';f.state.setCombatCharactersString(JSON.stringify(a));},
    f=>f.d.cells['6,4']={tile:'wall'}]){
    const f=fixture();alter(f);assert.throws(()=>S.resolve(f.state,f.request));
    if(f.request.counterId==='forged')assert.match(E.view(f.state,'Keeper','forged').error,/counter.*not available/);
  }
});
test('a counter can introduce only its own saved procedural worker, never a passerby or another venue worker',()=>{
  const f=fixture();f.p.actors={};
  const row={id:'worker',name:'Saved Worker',status:'ambient',position:{x:7,y:4},occupation:{mode:'work',venueId:'venue',venueType:'shop'}};
  f.d.cityCrowd={actors:{worker:row}};
  assert.equal(S.resolve(f.state,f.request).citizen.crowdId,'worker');
  row.occupation.mode='visit';assert.throws(()=>S.resolve(f.state,f.request));
  row.occupation.mode='work';row.occupation.venueId='other';assert.throws(()=>S.resolve(f.state,f.request));
});
test('the actual world ray picker exposes the counter, checks occlusion and activates the service path',async()=>{
  const f=fixture(),opened=[],root={CityServiceCounters:C,DungeonInhabitants:I,CommerceUi:{openCounter:id=>opened.push(id)}};
  const document={readyState:'loading',hidden:false,addEventListener(){},querySelectorAll:()=>[]};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/worldInteractionUi'),'utf8'),{window:root,document});
  const camera={x:4.5,y:6.5,eyeZ:.65,dirX:0,dirY:-1,planeScale:.577,verticalScale:1.73,viewShift:0};
  const hit=root.WorldInteractionUi.pick(f.d,camera,camera,.5,.65);
  assert.equal(hit.type,'service-counter');assert.equal(hit.enabled,true);assert.equal(hit.command,'access services');
  await root.WorldInteractionUi.activate(hit);assert.deepEqual(opened,['counter-one']);
  f.d.cells['4,5']={tile:'wall',floorHeight:0,ceilHeight:3};
  assert.notEqual(root.WorldInteractionUi.pick(f.d,camera,camera,.5,.65)?.type,'service-counter');
});
