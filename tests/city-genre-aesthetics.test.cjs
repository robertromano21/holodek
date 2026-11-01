'use strict';
for(const flag of ['ARCHITECTURE_EXPANSION','GENRE_EXPANSION','CITY_SITES','CITY_COMPLETE','CITY_PROPS','GENRE_LIGHTS','GENRE_KITS'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('../assets/cityArchitectureStyles'),S=require('../assets/cityBuildingStyle'),K=require('../assets/cityKit'),
  F=require('../assets/cityBuildingFootprints'),V=require('../assets/scenePropVoxels'),Sky=require('../assets/citySkyline');
const genres=Object.keys(require('../assets/genreFixtures').THEMES);
test('CotG and all 18 genres have explicit architectural materials, era lighting and human-scale construction guidance',()=>{
  assert.equal(Object.keys(A.PROFILES).length,19);
  for(const g of genres){const p=A.profile(g);assert.ok(p.material&&p.fixture&&p.lighting);assert.match(A.brief(g),/village, town and city/);}
  assert.match(A.brief('fantasy',true),/citadels/);assert.equal(A.profile('sci-fi').heritage,false);
  for(const g of ['fantasy','dark-fantasy'])assert.match(A.brief(g),/Classical.*Renaissance.*medieval/);
});
test('Greek, Roman, Byzantine, medieval and Renaissance traditions are saved, seed-stable and do not impose foreign religion',()=>{
  for(const [tradition,text]of Object.entries(A.TRADITIONS)){
    assert.equal(A.tradition({architecture:{tradition}},'other'),tradition);assert.ok(text.length>100);
    assert.equal(A.tradition({identity:tradition+' city'}),tradition);
  }
  assert.match(A.TRADITIONS.greek,/column-and-lintel/);assert.match(A.TRADITIONS.roman,/need not be regular grids/);
  assert.match(A.TRADITIONS.byzantine,/do not import Christian/);
  const temple=A.choose('fantasy',{type:'temple',seed:3},{tradition:'greek'});assert.equal(temple.shape,'city_temple');
  assert.equal(A.choose('fantasy',{type:'temple',seed:3},{tradition:'byzantine'}).template,'byzantine_basilica');
});
test('Renaissance city authoring covers civic, grid, axial and bastioned plans without importing artillery or erasing older quarters',()=>{
  for(const [genre,cotg]of [['fantasy',true],['fantasy',false],['dark-fantasy',false]]){
    const brief=A.brief(genre,cotg);
    for(const pattern of [/piazza-centered renewal/,/orthogonal planned extension/,/axial avenue/,/radial bastioned fortress/,
      /low broad ramparts/,/mutually supporting bastions/,/artillery only if this world establishes/,/Retain inherited medieval quarters/])assert.match(brief,pattern);
  }
  assert.doesNotMatch(A.brief('sci-fi'),/Renaissance-derived|artillery only if/,'A future city does not inherit the historic planning checklist');
});
test('explicit later architectural idioms outrank inherited Classical references, while a saved choice remains authoritative',()=>{
  assert.equal(A.tradition({identity:'A Renaissance city with a Roman forum',history:'An older medieval quarter survives.'}),'renaissance');
  assert.equal(A.tradition({identity:'A Byzantine port with a Roman basilica and Greek stoa'}),'byzantine');
  assert.equal(A.tradition({architecture:{tradition:'roman'},identity:'Renaissance additions'}),'roman');
});
test('original native architectural families, not industrial slabs, supply historic roofs and named venue templates',()=>{
  const found=new Set();
  for(const type of ['home','temple','civic','guild','bathhouse','warehouse','library','court','transit'])for(let seed=0;seed<40;seed++){
    const a=A.choose('fantasy',{type,seed});assert.equal(a.source,'cityKit');assert.ok(K.has(a.shape));found.add(a.family);
    assert.ok(require('../retort/environmentIntents').CATALOG[a.template]);
  }
  for(const family of ['temple','rotunda','basilica','castle','citadel','fortress','guildhall','domus','insula'])assert.ok(found.has(family),family);
});
test('named landmark doorways carry their original interior template into exterior family selection',()=>{
  const route=require('../retort/citySites').sceneKind({cityRoom:{kind:'street',genre:'fantasy'},exits:{east:{targetCoordinates:'2,0,31'}}},
    {'2,0,31':{name:'Authored Hall',environmentIntent:{template:'fantastic_citadel'},cityRoom:{kind:'building',establishmentType:'civic'}}}).routes[0];
  assert.equal(route.template,'fantastic_citadel');assert.equal(A.choose('fantasy',{type:'civic',seed:2,template:route.template}).family,'citadel');
  assert.equal(A.choose('fantasy',{type:'temple',seed:2,template:'roman_temple'}).family,'temple');
  assert.equal(A.choose('fantasy',{type:'temple',seed:2,template:'byzantine_basilica'}).family,'rotunda');
});
test('footprint-matched near models and distant surfaces share shaped crowns without shrinking any occupied floor',()=>{
  const f=F.create(2);
  for(const type of ['home','temple','civic','bathhouse'])for(const storeys of [1,2,6,120]){
    const b={id:type,seed:3,type,width:24,depth:24,storeys,clearance:3,metres:{height:8.5+(storeys-1)*3.4}};
    const a=A.envelope(A.choose('fantasy',b),b),shape='a_fantasy_urban_skyline',mesh=V.build(shape,16,0,{cityFootprint:f,cityArchitecture:a});
    assert.deepEqual(mesh,A.build(f,a,16));
    assert.ok(a.height*a.bodyFraction>=Math.max(0,b.metres.height/2.5-b.clearance-.4)-1e-9);
    const body=Math.round(a.bodyFraction*16);
    for(let z=0;z<body;z++)for(let y=0;y<16;y++)for(let x=0;x<16;x++)assert.equal(mesh[x+y*16+z*256],Number(F.contains(f,(x+.5)/16,(y+.5)/16)));
    assert.ok(mesh.some(v=>v));assert.ok(Sky.faces(shape,f,a).length>6);
    assert.ok(mesh.slice(15*256).some(v=>!v),'Roof/castellations cannot be a solid flat extrusion');
  }
});
test('fantasy windows and all pre-electric common fixtures are warm; explicit modern facades retain color variation',()=>{
  for(const genre of ['fantasy','dark-fantasy','mythic','western','gothic-horror','nautical','steampunk','desert-fantasy'])for(let seed=0;seed<12;seed++){
    for(const h of S.resolve(genre,{type:'home',seed}).panes){const rgb=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));assert.ok(rgb[0]>rgb[2],genre+': '+h);}
  }
  for(const g of ['modern','sci-fi','cyberpunk'])assert.ok(new Set(Array.from({length:24},(_,seed)=>S.resolve(g,{seed,type:'shop'}).panes.join(','))).size>2);
});
function dungeon(){const d={geoKey:'0,0,30',generation:{seed:'native-arcades'},layout:{width:128,height:128},start:{x:64,y:64},tiles:{},cells:{},sceneStructures:[]};
  for(let y=0;y<128;y++)for(let x=0;x<128;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};return d;}
test('built historic blocks have real roofs at low storeys, native wall torches, stone surfaces and open doorways',()=>{
  for(const genre of ['fantasy','dark-fantasy']){
    const d=dungeon(),site={id:'period-city',name:'Ward',design:{architecture:{tradition:'roman'}}};
    require('../retort/cityBlocks').apply(d,{city:{}},site,{genre,scale:'town'});
    const torches=Object.values(d.cells).filter(c=>c.tile==='torch');assert.ok(torches.length);assert.ok(torches.every(c=>c.wallSurface&&c.torchFacing));
    for(const b of d.cityBlocks.buildings){assert.ok(d.sceneStructures.some(s=>s.skyline&&s.cityParcel===b.id));
      for(const door of b.doors)assert.equal(d.cells[`${door.x},${door.y}`].tile,'floor');}
    assert.ok(d.sceneStructures.some(s=>s.role==='city-lobby-arcade'));
    const arcs=d.sceneStructures.filter(s=>s.role==='city-lobby-arcade');assert.ok(arcs.length<=d.cityBlocks.buildings.length*6);
    for(const part of d.sceneStructures)if(part.role==='city-lobby-arcade'||part.role==='city-venue-entryframe')assert.ok(V.build(part.shape,16,0,d.tiles[part.tile].spriteSpec),part.shape+' must be registered');
    const restored=JSON.parse(JSON.stringify(d));assert.deepEqual(restored.cityBlocks,d.cityBlocks);
  }
});
test('sideways arcade voxels are truly transposed and leave their central passage empty',()=>{
  const normal=V.build('aqueduct_arch__v0',16),side=V.build('aqueduct_arch__v0',16,0,{cityArcade:{axis:'y'}});
  for(let z=0;z<16;z++)for(let y=0;y<16;y++)for(let x=0;x<16;x++)assert.equal(side[x+y*16+z*256],normal[y+x*16+z*256]);
  assert.equal(side[8+8*16+4*256],0);assert.equal(normal[8+8*16+4*256],0);
});
test('homebrew fantasy and dark fantasy preserve the native torch; other genres still receive their own mounted fixtures',()=>{
  for(const genre of genres){
    const d={geoKey:'0,0,0',cells:{'1,1':{tile:'torch'}},tiles:{torch:{url:'native-flame'}},genreLights:[]},before=JSON.stringify(d),
      setting={seed:'world',genres:[genre]};
    require('../retort/genreLayer').fixtures(d,{genre},{setting});
    if(['fantasy','dark-fantasy'].includes(genre))assert.equal(JSON.stringify(d),before);
    else assert.ok(d.tiles.torch.spriteSpec.voxelShape.startsWith('l_'+genre+'_'));
  }
});
test('character direction covers every genre without a fixed futuristic role menu; familiar fantasy labels are permitted',()=>{
  const C=require('../retort/genreCharacterPalette');assert.deepEqual(Object.keys(C.DIRECTIONS).sort(),genres.slice().sort());
  const fantasy=C.direction({genres:['fantasy','dark-fantasy'],worldSeed:'one'});assert.match(fantasy,/Human, Elf, Dwarf, Halfling/);assert.match(fantasy,/Fighter, Rogue, Wizard, Cleric/);
  const tech=C.direction({genres:['sci-fi','cyberpunk'],worldSeed:'one'});assert.match(tech,/not occupation/);assert.match(tech,/Human-only/);assert.doesNotMatch(tech,/Netrunner|Street Samurai|Void Pilot|Systems Tech/);
  const angles=new Set(Array.from({length:20},(_,i)=>C.direction({genres:['sci-fi'],worldSeed:String(i)})));assert.ok(angles.size>=4);
});
test('production roster request uses the selected world, not the mock fallback or the old example lists',async()=>{
  const prompts=[],value={classes:['Fighter','Rogue','Wizard','Cleric'].map(name=>({name,description:name+' tradition',hitDie:'8',stats:{},abilities:[],gear:[],ammo:'',bodyPlan:'humanoid'})),
    races:['Human','Elf','Dwarf'].map(name=>({name,description:name+' people',stats:{},hpBonus:0,bodyPlan:'humanoid'}))};
  const $={user:input=>prompts.push(String(input)),assistant:{generation:async()=>({content:JSON.stringify(value)})}};
  const result=await require('../retort/settingLayer').generateRoster({name:'New Realm',worldSeed:'new',genres:['fantasy'],genreWeights:[{genre:'fantasy',weight:1}],gamePrompt:'A traditional magical world'},
    {runner:async work=>work($)});
  assert.equal(result.races[0].name,'Human');assert.equal(result.classes[0].name,'Fighter');assert.match(prompts.join(' '),/traditional magical world/);
  assert.doesNotMatch(prompts.join(' '),/Examples of the kind|Stoneborn|Leafkin|Shieldbearer/);
});
test('browser loads the shared style before voxel generation and near meshes include both descriptor cache keys',()=>{
  const index=fs.readFileSync(require.resolve('../assets/index.html'),'utf8');assert.ok(index.indexOf('cityArchitectureStyles.js')<index.indexOf('scenePropVoxels.js'));
  const renderer=fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8');assert.match(renderer,/cityArchitecture:spec.cityArchitecture,cityArcade:spec.cityArcade/);
  assert.match(renderer,/spec.cityFootprint,spec.cityArchitecture,spec.cityArcade,spec.palette/);
  const root={CityKit:K,UrbanDesigns:require('../assets/urbanDesigns'),CityBuildingFootprints:F};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/cityArchitectureStyles'),'utf8'),{window:root});assert.ok(root.CityArchitectureStyles);
});
test('starting an old builder draft cannot silently substitute the mock roster, and initial authoring sees player instructions',()=>{
  const source=fs.readFileSync(require.resolve('../retort/campaignBuilderRoutes'),'utf8');
  assert.doesNotMatch(source,/Setting\.localRoster\(/);assert.match(source,/older draft has no authored character roster/);
  assert.ok(source.indexOf('bible.instructions={verbatim:')<source.indexOf('Setting.generateRoster(bible'));
  const start=source.indexOf("app.post('/builder/setting/start'"),end=source.indexOf('// Prefab texture library',start),fragment=source.slice(start,end);
  let handler,activated=0;
  const bible={name:'Old world',genres:['fantasy'],genreWeights:[{genre:'fantasy',weight:1}],classes:[{}],races:[{}]},Setting=require('../retort/settingLayer');
  vm.runInNewContext(fragment,{app:{post(...args){handler=args.at(-1);}},guard:{},json:{},wrap:fn=>fn,db:()=>({'0,0,0':{settingDraft:bible}}),
    Setting:{normalizePicked:Setting.normalizePicked,setMaster(){activated++;}},B:{}});
  assert.throws(()=>handler({body:{genres:['sci-fi']}}),/genres changed/);assert.equal(activated,0);
  delete bible.races;assert.throws(()=>handler({body:{}}),/no authored character roster/);assert.equal(activated,0);
});
