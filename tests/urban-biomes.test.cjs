'use strict';
for(const flag of ['HOMEBREW','GENRE_EXPANSION','ARCHITECTURE_EXPANSION','GENRE_KITS','CITY_PROPS','CAMPAIGN_MAP','CITY_SITES','CITY_COMPLETE'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const U=require('../assets/urbanDesigns'),X=require('../assets/genreExpansion'),K=require('../assets/genreKits'),V=require('../assets/scenePropVoxels'),S=require('../retort/settingLayer'),B=require('../retort/biomeRecipes');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function world(genre){return{kind:'homebrew',seed:'future',genres:[genre],genreWeights:[{genre,weight:1}]};}
test('54 registered native buildings preserve genre scale and real 2D/3D geometry',()=>{
  assert.equal(Object.keys(U.SHAPES).length,54);const sums=new Set();
  for(const [id,d]of Object.entries(U.SHAPES)){
    const mesh=U.build(id,24);assert.equal(mesh.length,24**3);assert.ok(mesh.some(x=>x)&&mesh.some(x=>!x));assert.equal(hash(mesh),hash(U.build(id,24)));
    assert.equal(hash(mesh),hash(K.build(id,24)));assert.equal(hash(mesh),hash(V.build(id,24)));assert.ok(K.OWNER[id].includes(d.genre));
    assert.ok(!sums.has(hash(mesh)),id);sums.add(hash(mesh));assert.ok(X.color(id,.3,.3,.4,[0,0,1]).every(x=>x>=0&&x<=1));
    assert.ok(require('../retort/genreAssetPolicy').catalog({genreKit:d.genre},world(d.genre)).shapes.includes(id));
  }
  assert.ok(U.PROFILES.cyberpunk[1]>U.PROFILES.western[1]*6);assert.equal(U.scale({role:'remote outpost',population:300},'sci-fi'),'village');
  assert.equal(U.scale({population:300000},'cyberpunk'),'metropolis');for(const n of [0,7,65,1.5])assert.equal(U.build('a_cyberpunk_urban_skyline',n),null);
});
for(const n of [16,32])test('all 54 urban silhouettes remain distinct and bounded at '+n+' voxels',()=>{
  const seen=new Set();for(const id of Object.keys(U.SHAPES)){const mesh=U.build(id,n);assert.equal(mesh.length,n**3);assert.ok(!seen.has(hash(mesh)),id);seen.add(hash(mesh));assert.ok(mesh.every(x=>x===0||x===1));}
});
function dungeon(size=96){const d={geoKey:'0,0,0',start:{x:48,y:72},layout:{width:size,height:size},cells:{},tiles:{wall:{url:'old-wall'}},sceneStructures:[]};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  for(let y=0;y<size;y++)d.cells[`48,${y}`].navigationReserved=true;return d;
}
test('metropolis scenery uses walk-in blocks instead of miniature buildings, capped, native and route-safe',()=>{
  const d=dungeon(),city={id:'future-city',name:'Night City',genre:'cyberpunk',population:300000,districts:['market ward','tenements'],utilities:['transport']};
  S.setActive(world('cyberpunk'));
  try{
    const result=require('../retort/cityScenery').apply(d,{city:{genre:'cyberpunk',district:'market'}},city);
    assert.equal(result.status,'built');assert.equal(d.cityScenery.scale,'metropolis');
    const lighting=d.sceneStructures.filter(p=>/^city-(?:interior|street)-light/.test(p.role||''));
    assert.ok(d.sceneStructures.length-lighting.length<=220,'Scenery retains its original non-lighting budget');
    assert.ok(lighting.length<=d.cityBlocks.buildings.length*54+Math.ceil(d.cityBlocks.sidewalkCells/6)*2+32,'Physical lighting scales with occupied rooms and sidewalk length');
    const buildings=d.sceneStructures.filter(p=>p.shape.startsWith('a_cyberpunk_urban_'));assert.ok(buildings.length>=2,buildings.length);
    assert.ok(buildings.some(p=>p.size.z>=50));assert.ok(buildings.every(p=>p.size.x>=14&&p.size.y>=16));
    assert.ok(d.cityBlocks.buildings.length>=2);for(let y=0;y<96;y++){assert.equal(d.cells[`48,${y}`].tile,'floor');assert.equal(d.cells[`48,${y}`].floorHeight,0);}
    assert.ok(d.sceneStructures.some(p=>/stall/.test(p.shape)&&Math.hypot(p.position.x-48,p.position.y-72)<12));
    for(const part of d.sceneStructures)assert.ok(!d.tiles[part.tile].spriteSpec.collisionBlocking);
    const saved=JSON.stringify(d);assert.equal(require('../retort/cityScenery').apply(d,{},city).status,'already-built');assert.equal(JSON.stringify(d),saved);
    for(const p of buildings)for(let y=p.position.y;y<p.position.y+p.size.y;y++)for(let x=p.position.x;x<p.position.x+p.size.x;x++){
      const c=d.cells[`${x},${y}`];assert.ok(!c.navigationReserved||c.cityCirculation,'Only newly installed interior circulation may reserve a tower cell; preexisting routes stay outside');
    }
  }finally{S.setActive(null);}
});
test('urban streets do not inherit badlands props or default dead forests',()=>{
  const spec={city:{genre:'cyberpunk'},biome:'city',indoor:false,architecture:'city_street',source:{roomName:'Night Market',description:'Above the wasteland, ash-scorched concrete forms a busy city street.'},generation:{seed:'city'}};
  assert.equal(require('../retort/sceneVegetation').prepareSceneVegetation(spec).enabled,false);
  assert.ok(!require('../retort/sceneBiomeProps').prepareSceneBiomeProps(spec).profiles.includes('badlands'));
  assert.equal(require('../retort/outdoorTerrain').plan(spec,96,96).profile,'urban');
});
test('single building interiors, existing roofs and remote outpost scale constrain city scenery',()=>{
  const C=require('../retort/cityScenery'),city={id:'outpost',name:'Outpost',role:'remote outpost',population:200,districts:['tenements']};
  S.setActive(world('sci-fi'));
  try{
    const d=dungeon();assert.equal(C.apply(d,{city:{roomKind:'city-building'}},city).reason,'building-interior');assert.equal(d.sceneStructures.length,0);
    for(const c of Object.values(d.cells))c.ceilHeight=3;
    C.apply(d,{indoor:true,city:{genre:'sci-fi'}},city);assert.equal(d.cityScenery.scale,'village');assert.ok(d.sceneStructures.every(p=>p.size.z<=2.7));
    const open=dungeon();C.apply(open,{city:{genre:'sci-fi'}},city);assert.ok(open.sceneStructures.filter(p=>p.shape.startsWith('a_')).every(p=>p.size.z<=8));
  }finally{S.setActive(null);}
});
for(const [id,recipe]of Object.entries(B.CATALOG))test(id+' is genre-scoped, uses approved props and creates deterministic real terrain',()=>{
  const w=recipe.genre?world(recipe.genre):null;S.setActive(w);
  try{
    assert.equal(B.eligible(id,w),true);assert.equal(B.eligible(id,recipe.genre?null:world('cyberpunk')),false);
    const spec={indoor:false,biome:'wasteland',source:{roomName:id,description:recipe.description,environmentIntent:{template:id}},generation:{seed:'recipe:'+id},landmarks:[]};
    assert.equal(B.resolve(spec).id,id);assert.equal(B.resolve({...spec,indoor:true}),null);assert.equal(B.resolve({...spec,city:{}}),null);
    const T=require('../retort/outdoorTerrain'),terrain=T.plan(spec,128,128);assert.equal(terrain.profile,recipe.terrain);assert.deepEqual(terrain,T.plan(spec,128,128));assert.ok(terrain.features.length<=8);
    assert.ok(Number.isFinite(T.heightAt(terrain,20,30)));
    const plants=require('../retort/sceneVegetation').prepareSceneVegetation(spec),props=require('../retort/sceneBiomeProps').prepareSceneBiomeProps(spec);
    assert.equal(spec.biomeRecipe.id,id);assert.ok(props.shapes.length);assert.ok(props.shapes.every(s=>V.biomeShapes.includes(s)&&recipe.props.includes(s)));
    assert.ok(props.maxProps<=80&&plants.maxPlants<=144);
    if(recipe.vegetation==='none')assert.equal(plants.enabled,false);
    if(recipe.vegetation==='living')assert.deepEqual(plants.species,['willow','oak','cypress']);
    assert.ok(require('../retort/environmentIntents').CATALOG[id]);
  }finally{S.setActive(null);}
});
test('all genres and CotG have distinct ecology, without foreign technologies leaking into CotG',()=>{
  for(const genre of Object.keys(U.PROFILES))assert.ok(Object.values(B.CATALOG).some(r=>r.genre===genre),genre);
  const cotg=Object.values(B.CATALOG).filter(r=>B.eligible(r.id,null));assert.equal(cotg.length,3);assert.ok(cotg.every(r=>!/neon|pressure habitat|industrial city|planetary/i.test(r.description)));
  const K2=require('../retort/genreAssetPolicy').catalog({},null);assert.ok(K2.shapes.includes('a_dark-fantasy_urban_skyline'));assert.ok(!K2.shapes.includes('a_cyberpunk_urban_skyline'));
});
