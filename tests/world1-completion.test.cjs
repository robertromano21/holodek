'use strict';
for(const flag of ['GENRE_EXPANSION','ARCHITECTURE_EXPANSION','CITY_COMPLETE','TRADE_ROUTES','CITY_SITES','GENRE_KITS','GENRE_ARCH','HOMEBREW','MARKET_ECONOMY','CITY_PROPS','CAMPAIGN_MAP'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{createCanvas}=require('canvas');
const E=require('../assets/genreExpansion'),K=require('../assets/genreKits'),A=require('../assets/genreArchitecture'),V=require('../assets/scenePropVoxels');
const T=require('../assets/renderSceneTextures'),S=require('../retort/settingLayer'),C=require('../retort/citySites'),Complete=require('../retort/cityCompletion');
const Trade=require('../retort/tradeRoutes'),Market=require('../retort/market'),Scenery=require('../retort/cityScenery');
const P=require('../assets/renderCharacterProcedural'),Sprites=require('../assets/renderCharacterSprite');
const digest=value=>crypto.createHash('sha256').update(ArrayBuffer.isView(value)?Buffer.from(value.buffer,value.byteOffset,value.byteLength):Buffer.from(value)).digest('hex');
const city={id:'test-city',name:'Aster City',districts:['forum','market ward','guild quarter','tenements'],population:7000,utilities:['cistern']};
const genreList=Object.keys(E.PROFILES);
function floor(width=64,height=64){const d={geoKey:'0,3,30',layout:{width,height},start:{x:32,y:32},classification:{indoor:false},tiles:{wall:{url:'old.png'}},cells:{}};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:10};return d;}

test('expansion defaults are off and do not silently expand the old genre menu',()=>{
  const env={...process.env,HOLODEK_GENRE_EXPANSION:'0',HOLODEK_ARCHITECTURE_EXPANSION:'0',HOLODEK_CITY_COMPLETE:'0',HOLODEK_TRADE_ROUTES:'0'};
  const report=JSON.parse(execFileSync(process.execPath,['-e',"const F=require('./retort/worldFlags'),K=require('./assets/genreKits');console.log(JSON.stringify({n:Object.keys(K.GENRES).length,shapes:K.SHAPES.some(x=>x.startsWith('x_')),defaults:['GENRE_EXPANSION','ARCHITECTURE_EXPANSION','CITY_COMPLETE','TRADE_ROUTES'].map(k=>F.DEFAULTS[k])}));"],{cwd:path.resolve(__dirname,'..'),env,encoding:'utf8'}));
  assert.equal(report.n,12);assert.equal(report.shapes,false);assert.deepEqual(report.defaults,[false,false,false,false]);
});
test('all eighteen genres have coordinated native voxel, material, sprite and city options',()=>{
  assert.equal(genreList.length,18);assert.deepEqual(Object.keys(K.GENRES).sort(),S.GENRES.slice().sort());
  for(const genre of genreList){
    for(const role of E.ROLES){const shape=`x_${genre}_${role}`;assert.ok(K.has(shape));assert.ok(V.architecture[shape]);
      for(const size of [12,24,32]){const v=V.build(shape,size,0,{});assert.equal(v.length,size**3);assert.ok(v.some(Boolean));assert.ok(v.every(x=>x===0||x===1));}}
    assert.ok(A.GARB[genre].length);assert.ok(T.hasMaterial('wall',`x_${genre}_wall`));assert.ok(T.hasMaterial('wall',`x_${genre}_door`));assert.ok(T.hasMaterial('floor',`x_${genre}_floor`));
  }
});
test('genre buildings have distinct geometry rather than the same house with eighteen palettes',()=>{
  const hashes=genreList.map(g=>digest(E.build(`x_${g}_house`,24)));assert.equal(new Set(hashes).size,18);
  assert.deepEqual(E.build('x_western_house',24),E.build('x_western_house',24));
  const gate=E.build('x_sci-fi_gate',24);for(let z=0;z<8;z++)for(let y=0;y<24;y++)assert.equal(gate[12+y*24+z*576],0,'gate keeps an open passage');
});
test('CotG gains funerary architecture without admitting technology into its genre resolver',()=>{
  for(const name of Object.keys(E.COTG)){assert.ok(K.COTG_TAGS.includes('x_'+name));assert.ok(E.build('x_'+name,24).some(Boolean));}
  for(const g of genreList.filter(g=>!K.COTG_ALLOWED.includes(g)))assert.ok(!K.COTG_TAGS.includes(`x_${g}_house`));
  const r=K.resolve({genre:'underwater',planarRealm:{genre:'cyberpunk'}},null);assert.ok(r.locked&&K.COTG_ALLOWED.includes(r.genre));
});
test('each new genre builds a self-contained bible, first room, master prompt and playable roster',()=>{
  for(const genre of Object.keys(E.NEW_GENRES)){
    const bible=S.validateBible(S.localBible(`An original ${genre} adventure`,[genre],'new-world'));
    assert.equal(bible.genres[0],genre);assert.ok(S.firstRoom(bible).name.includes(require('../retort/expandedWorlds').rows[genre].noun));
    const roster=S.localRoster(bible);assert.ok(roster.classes.length>=4&&roster.races.length>=2);
    const master=S.masterText(S.masterLocal(bible,bible.seed),bible);assert.ok(master.includes(genre));
    assert.deepEqual(require('../retort/campaignBuilder').lint({bible,roster,master}),[]);
    assert.equal(K.resolve({},bible).genre,genre);
  }
});
test('all genre materials render deterministic, opaque, pixel-native tiles through the existing painter',()=>{
  const images=new Set();
  for(const genre of genreList)for(const [kind,suffix]of [['wall','wall'],['wall','door'],['floor','floor']]){
    const c=createCanvas(64,64),draw=()=>T.drawSceneSurface(c.getContext('2d'),createCanvas,kind,{material:`x_${genre}_${suffix}`,seed:'frozen'});
    draw();const first=c.toBuffer();draw();assert.deepEqual(c.toBuffer(),first);
    const data=c.getContext('2d').getImageData(0,0,64,64).data;for(let i=3;i<data.length;i+=4)assert.equal(data[i],255);
    images.add(digest(first));
  }
  assert.ok(images.size>=45,`only ${images.size} distinct textures`);
});
test('Holodek texture library and picker expose the actual additional assets',()=>{
  const library=require('../retort/textureLibrary').prefabs();
  for(const genre of genreList)assert.ok(library.some(x=>x.id===`floor:x_${genre}_floor`));
  const ui=fs.readFileSync(path.join(__dirname,'../assets/campaignBuilderUi.js'),'utf8');assert.match(ui,/Object.keys\(window.GenreKits.GENRES\)/);assert.match(ui,/root.GenreKits\?\.SHAPES/);
  const index=fs.readFileSync(path.join(__dirname,'../assets/index.html'),'utf8');assert.ok(index.indexOf('genreExpansion.js')<index.indexOf('roomIllustration.js'));
});
test('genre clothing reaches both original 2D tokens and the native multi-view 3D actor path',()=>{
  for(const genre of genreList){
    const sheet=P.normalizeSheet({name:'Test Resident',race:'Human',class:'Traveler',level:2,sex:'Female',equipped:{Weapon:'revolver'}}),traits=P.deriveFallbackTraits(sheet);
    traits.genreGarb={...E.GARB[genre][0]};const dressed=P.buildProceduralSpriteSpec(sheet,traits,{signature:false,salt:123});
    const plainTraits=JSON.parse(JSON.stringify(traits));delete plainTraits.genreGarb;
    const plain=P.buildProceduralSpriteSpec(sheet,plainTraits,{signature:false,salt:123});
    const image=Sprites.createTraitSpriteCanvas(dressed,0);assert.ok(image.toBuffer().length>100);
    assert.notEqual(digest(image.toBuffer()),digest(Sprites.createTraitSpriteCanvas(plain,0).toBuffer()),genre+' token');
    const a=Sprites.createCharacterVoxelFrames(sheet,dressed,{frameCount:1,voxelSize:24})[0];
    const b=Sprites.createCharacterVoxelFrames(sheet,plain,{frameCount:1,voxelSize:24})[0];
    assert.ok(a.voxels.some(Boolean));assert.notEqual(digest(a.colors),digest(b.colors),genre+' 3D');
    assert.equal(dressed.traits.bodyPlan,plain.traits.bodyPlan);
  }
});
test('city plans for every genre retain all districts and reciprocal enterable buildings',()=>{
  for(const genre of genreList)for(let i=0;i<8;i++){
    const p=C.plan({seed:'check'+i,city,genre});assert.deepEqual(C.validate(p),[]);assert.equal(p.stats.districts,7);
    if(!['fantasy','dark-fantasy','mythic'].includes(genre))assert.ok(p.rooms[0].tiles,genre);
  }
});
test('city completion adds district population, markets and routes without rerolling existing actors',()=>{
  const db={'0,3,0':{name:'Aster',exits:{south:{status:'open',targetCoordinates:'0,2,0'}},environmentIntent:{template:'village',citySite:city}}};
  const out=C.install(db,'0,3,0',{seed:'complete'});assert.equal(out.status,'installed');
  const rooms=Object.values(db).filter(r=>r.cityRoom);assert.ok(rooms.every(r=>r.cityRoom.completion===Complete.VERSION));
  assert.ok(rooms.every(r=>r.campaignSetting.city&&r.cityRoom.routes.length));assert.ok(rooms.some(r=>r.market?.routes?.rooms.length));
  const room=rooms[0];room.inhabitants={actors:{Remembered:{hp:0,status:'dead'}}};const old=JSON.stringify(room.inhabitants);
  assert.equal(C.install(db,'0,3,0',{seed:'different'}).status,'already-installed');assert.equal(JSON.stringify(room.inhabitants),old);
});
test('new cities relocate their private layer instead of linking through an unrelated saved room',()=>{
  const p=C.plan({city,seed:'collision'}),blocked=p.rooms[4].key,db={'0,3,0':{name:'Aster',environmentIntent:{citySite:city},exits:{}},[blocked]:{name:'Protected',exits:{},description:'Keep'}};
  const before=JSON.stringify(db[blocked]);const result=C.install(db,'0,3,0',{seed:'collision'});assert.equal(result.status,'installed');assert.equal(JSON.stringify(db[blocked]),before);
  const installed=Object.entries(db).filter(([,r])=>r.cityRoom);assert.ok(installed.every(([,r])=>r.cityRoom.routes.every(e=>db[e.to])));
});
test('entering city streets or interiors does not recursively install a second city',()=>{
  const db={'0,3,0':{name:'Aster',environmentIntent:{citySite:city},exits:{}}};C.install(db,'0,3,0',{seed:'once'});
  const count=Object.keys(db).length;
  for(const [key,room]of Object.entries(db))if(room.cityRoom)C.install(db,key,{seed:'again'});
  assert.equal(Object.keys(db).length,count);
});
test('private city coordinates fit the database bounds even near a remote planar edge',()=>{
  const p=C.plan({city,genre:'underwater',anchorKey:'1000,1000,1000'});assert.deepEqual(C.validate(p),[]);
  assert.ok(p.rooms.every(r=>r.key.split(',').every(n=>Math.abs(Number(n))<=1000)));
});
test('browser synchronization preserves city exits, identity and authoritative market pressure',()=>{
  const db={'0,3,0':{name:'Aster',environmentIntent:{citySite:city},exits:{}}};C.install(db,'0,3,0',{seed:'sync'});
  const next=structuredClone(db),member=Object.keys(db).find(k=>db[k].cityRoom),market=Object.keys(db).find(k=>db[k].market);
  next[member].exits={};delete next[member].cityRoom;next[market].market.demand.weapon=100;
  delete next[db['0,3,0'].citySites.gateKey];
  const merged=JSON.parse(require('../retort/economy').preserve(JSON.stringify(db),JSON.stringify(next)));
  assert.deepEqual(merged[member].exits,db[member].exits);assert.deepEqual(merged[market].market,db[market].market);
  assert.ok(merged[db['0,3,0'].citySites.gateKey]);
});
test('city dressing uses genre building geometry and does not alter movement cells',()=>{
  for(const genre of ['western','sci-fi','underwater','solarpunk']){
    S.setActive(S.validateBible(S.localBible(genre,[genre],'city')));const d=floor(),before=JSON.stringify(d.cells);
    assert.equal(Scenery.apply(d,{city:{genre,district:'residential'}},city).status,'built');
    assert.ok(d.sceneStructures.some(p=>p.shape===`x_${genre}_house`),genre);assert.equal(JSON.stringify(d.cells),before);
  }
  S.setActive(null);
});
test('cavern-to-surface trade follows real open routes and propagates demand without manufacturing inventory',()=>{
  const db={'0,0,0':{classification:{biome:'cave'},exits:{up:{status:'open',targetCoordinates:'0,0,1'}}},'0,0,1':{classification:{biome:'city'},exits:{down:{status:'open',targetCoordinates:'0,0,0'}}}};
  for(const [key,room]of Object.entries(db))Market.seed(room,key);
  const a=db['0,0,0'].market,b=db['0,0,1'].market;a.demand.weapon=.5;b.demand.weapon=2;
  assert.equal(Trade.balance(db,'0,0,0'),1);assert.ok(a.demand.weapon>.5&&b.demand.weapon<2);
  assert.equal(db['0,0,0'].objects,undefined);assert.equal(db['0,0,1'].services,undefined);
  db['0,0,0'].exits.up.status='locked';assert.deepEqual(Trade.connect(db,'0,0,0'),[]);
});
test('room illustrations can use the same actual genre-building voxel recipes',()=>{
  const Art=require('../assets/roomIllustration'),fixture=require('./fixtures/room-art.cjs');
  const images=[];
  for(const genre of ['western','sci-fi','underwater']){
    const p=fixture.temple();p.layers[0]={...p.layers[0],kind:`x_${genre}_house`};assert.ok(Art.validate(p));
    const c=createCanvas(320,200);Art.paint(c.getContext('2d'),p,'same');images.push(digest(c.toBuffer()));
  }
  assert.equal(new Set(images).size,3);
});

test('native genre choices survive the level schema, normalization and voxel selector',()=>{
  const L=require('../retort/levelSpec');
  S.setActive(S.validateBible(S.localBible('a frontier adventure',['western'],'schema')));
  try {
    const raw={wall:{material:'wood'},floor:{material:'wood'},structures:[{name:'Boarding House',shape:'x_western_house',count:1,assembly:{kit:'generic'}}]};
    assert.deepEqual(L.validate(raw),[]);
    const normalized=L.normalize(raw);assert.equal(normalized.structures[0].shape,'x_western_house');
    assert.equal(V.select('boarding_house',normalized.structures[0].assembly,{shape:normalized.structures[0].shape}),'x_western_house');
    assert.match(JSON.stringify(L.buildMessages({roomName:'Main Street'})),/x_western_house/);
  } finally {S.setActive(null);}
  assert.ok(L.validate({wall:{},floor:{},structures:[{name:'Wrong world',shape:'x_sci-fi_house'}]}).length);
});

test('homebrew puzzle direction and schemas do not force the canonical pantheon or sacred scenery',()=>{
  const D=require('../retort/physicalPuzzleDesign'),Myths=require('../retort/mythSelector');
  S.setActive(S.validateBible(S.localBible('Orbital community',['sci-fi'],'puzzles')));
  try {
    const prompt=D.designPrompt({roomName:'Fabrication Deck',description:'A pressure-sealed engineering room.',seed:'fixed'});
    assert.match(prompt,/pressure walls, airlocks/);assert.doesNotMatch(prompt,/Mortacia|Suzerain|Tartarus|Hades|Fiorenan/);
    const scaffold=require('../assets/physicalPuzzles').fallback('fixed','Fabrication Deck');
    assert.doesNotMatch(JSON.stringify(require('../retort/puzzleContract').parameters(scaffold)),/Mortacia|Suzerain|Tartarus|Hades/);
    const art=[{kind:'fresco',label:'The Launch',description:'A remembered launch.',figures:[{subject:'mortal',pose:'standing'}]}],before=JSON.stringify(art);
    Myths.enforce(art,'fixed','0,0,0');assert.equal(JSON.stringify(art),before);assert.equal(Myths.promptBlock('fixed','0,0,0'), '');
    assert.doesNotMatch(JSON.stringify(D.supplementalReadables({roomName:'Archive Hall'})),/Tartarus|Fiorenan|Darkwood/);
  } finally {S.setActive(null);}
});

test('new genre keywords are available without explicit picker selections',()=>{
  for(const genre of Object.keys(E.NEW_GENRES))assert.equal(S.weightedGenres('an original '+genre+' adventure')[0].genre,genre);
});

test('trade respects nested locks, diagonal paths and portals without creating new links',()=>{
  const db={'0,0,0':{exits:{northeast:{status:'open',targetCoordinates:'1,1,0',door:{isLocked:true}},portal:{status:'open',targetCoordinates:'4,4,4'}}},'1,1,0':{},'4,4,4':{}};
  assert.deepEqual(Trade.targets(db,'0,0,0'),[]);
  db['0,0,0'].exits.northeast.door.isLocked=false;assert.deepEqual(Trade.targets(db,'0,0,0'),['1,1,0']);
});

test('genre starts retain their own indoor/outdoor geometry instead of inheriting the CotG temple',()=>{
  for(const genre of genreList){
    const bible=S.validateBible(S.localBible('Original '+genre,[genre],'start'));S.setActive(bible);
    const room={name:'Old starting placeholder',complexId:'ruined-temple',classification:{world1Temple:true,templeComplex:true},objects:['Keep'],exits:{north:{status:'locked'}}};
    const content=JSON.stringify({objects:room.objects,exits:room.exits});S.applyStartRoom(room);
    assert.equal(room.name,S.firstRoom(bible).name);assert.equal(room.indoor,['sci-fi','underwater','noir','modern'].includes(genre));
    assert.notEqual(room.classification.biome,'temple');assert.equal(room.classification.world1Temple,undefined);
    assert.equal(JSON.stringify({objects:room.objects,exits:room.exits}),content);
  }
  S.setActive(null);assert.equal(S.startRoomProfile(),null);
});

test('homebrew atlas, cities and regional communities are derived from their own bible',()=>{
  const Campaign=require('../retort/campaignSetting'),Map=require('../retort/campaignMap');
  for(const genre of genreList){
    const bible=S.validateBible(S.localBible(genre,[genre],'atlas'));S.setActive(bible);
    const atlas=S.campaignPlan('world-run'),map=Map.compose('world-run',atlas),db={'0,0,0':{setting:bible,campaignAtlas:{...atlas,map}}};
    const community=Campaign.plan({targetKey:'3,4,0',sourceKey:'0,0,0',database:db,template:'market'});
    assert.deepEqual(require('../retort/campaignBuilder').lint({atlas,map,community}),[],genre);
    assert.equal(community.kind,'homebrew');assert.equal(community.religion.patron,null);
    assert.ok(map.cities.every(c=>c.genre===genre&&!c.ruler));
    assert.equal(Map.steer({database:db,sourceKey:'0,0,0',candidate:{targetKey:'1,0,0',constraint:'root-other-indoor'}}),null);
  }
  S.setActive(null);
});

test('unknown genres and failed live generation report an error instead of silently creating fantasy',async()=>{
  assert.throws(()=>S.normalizePicked(['not-a-real-genre']),/unavailable/);
  const bible=S.localBible('world',['western']);bible.genres=['missing'];delete bible.genreWeights;
  assert.throws(()=>S.validateBible(bible),/no supported genre/);
  await assert.rejects(S.generate('world',{picked:['western'],runner:async()=>{throw Error('offline');}}),/World creation failed: offline/);
  const good=S.localBible('world',['western']);
  assert.throws(()=>S.validateBible({...good,factions:[]}),/named factions/);
  assert.throws(()=>S.validateBible({...good,cities:'missing'}),/must be arrays/);
  assert.throws(()=>S.validateBible({...good,genres:'western'}),/must be an array/);
  await assert.rejects(S.generateMaster(good,'world',{runner:async()=>{throw Error('offline');}}),/Master prompt creation failed/);
  await assert.rejects(S.generateRoster(good,{runner:async()=>{throw Error('offline');}}),/World roster creation failed/);
});

test('world context carries authoritative district tiles and actual building destinations into the scene',()=>{
  const bible=S.validateBible(S.localBible('frontier',['western'],'routes'));S.setActive(bible);
  try{
    const db={'0,3,0':{name:'Frontier City',environmentIntent:{citySite:city},exits:{}}};C.install(db,'0,3,0',{seed:'frontage'});
    const key=Object.keys(db).find(k=>db[k].cityRoom?.kind==='street'&&Object.values(db[k].exits).some(e=>db[e.targetCoordinates]?.cityRoom?.kind==='building'));
    const [x,y,z]=key.split(',').map(Number),spec={coords:{x,y,z},source:{},exits:Object.keys(db[key].exits)};
    require('../retort/worldContext').attachSceneWorldContext(spec,db,{getCurrentTasks:()=>[]},'');
    assert.equal(spec.city.genre,'western');assert.ok(spec.city.tiles.wall);assert.ok(spec.city.routes.length);
    const d=floor();d.geoKey=key;d.roomExits={markers:spec.city.routes.map((r,i)=>({direction:r.direction,x:4+i*4,y:4,floor:0}))};
    const before=JSON.stringify(d.cells);Scenery.apply(d,spec,city);
    const entrances=d.sceneStructures.filter(p=>p.role==='city-building-entrance');assert.equal(entrances.length,spec.city.routes.length);
    assert.ok(entrances.every(p=>p.shape==='x_western_gate'&&db[p.targetCoordinates]?.name===p.label));
    assert.equal(JSON.stringify(d.cells),before);
  }finally{S.setActive(null);}
});

test('Mode 4 never silently substitutes offline content after live failure, even with expansion disabled',async()=>{
  const previous=process.env.HOLODEK_GENRE_EXPANSION;process.env.HOLODEK_GENRE_EXPANSION='0';
  try{
    const b=S.localBible('frontier',['western']);
    for(const runner of [async()=>{throw Error('offline');},async()=>undefined]){
      await assert.rejects(S.generate('frontier',{picked:['western'],runner}),/World creation failed/);
      await assert.rejects(S.generateRoster(b,{runner}),/World roster creation failed/);
      await assert.rejects(S.generateMaster(b,'frontier',{runner}),/Master prompt creation failed/);
      await assert.rejects(S.expandInstructions('Keep the railway closed.',b,{runner}),/Instruction expansion failed/);
    }
    assert.equal((await S.generate('frontier',{picked:['western']})).kind,'homebrew');
  }finally{process.env.HOLODEK_GENRE_EXPANSION=previous;}
});

test('the real authoring runner uses Luna without a CotG protocol header',async()=>{
  const Models=require('../retort/gameModels'),previous=Models.getClient;let sent;
  Models.getClient=()=>({chat:{completions:{create:async body=>{
    sent=body;
    return (async function*(){yield {choices:[{delta:{tool_calls:[{index:0,id:'test-answer',type:'function',function:{name:body.tools[0].function.name,arguments:'{"label":"A frontier town"}'}}]}}]};yield {choices:[{delta:{},finish_reason:'tool_calls'}]};})();
  }}}});
  try{
    const answer=await S.defaultRunner(async $=>{await $.user`Create an original frontier setting label.`;return $.assistant.generation({parameters:{label:String},strictParameters:true});});
    assert.equal(JSON.parse(answer.content).label,'A frontier town');assert.equal(sent.model,'gpt-6-luna');
    assert.doesNotMatch(JSON.stringify(sent.messages),/Mortacia|Suzerain|Tartarus|Grave Master/);
  }finally{Models.getClient=previous;}
});
