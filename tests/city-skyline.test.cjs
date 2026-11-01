'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../assets/citySkyline'),Urban=require('../assets/urbanDesigns');
function fixture(count=1,genre='cyberpunk',run='skyline-test'){
  const d={geoKey:'1,0,30',generation:{runId:run},_geometryStamp:'first',layout:{width:512,height:512},cells:{'1,1':{tile:'floor',floorHeight:0}},
    cityBlocks:{streaming:{genre},buildings:[]},tiles:{tower:{spriteSpec:{palette:{primary:'#665577'}}}},genreLights:[],sceneStructures:[]};
  for(let i=0;i<count;i++){
    d.cityBlocks.buildings.push({id:run+':'+i,storeys:80});
    d.sceneStructures.push({skyline:true,cityParcel:run+':'+i,tile:'tower',shape:`a_${genre}_urban_skyline`,
      position:{x:200+(i%30)*36,y:30+Math.floor(i/30)*36,z:3},size:{x:24,y:24,z:100}});
  }
  return d;
}
test('every genre has seeded luminous facades on real surfaces without changing geometry or creating dynamic lights',()=>{
  for(const genre of Object.keys(Urban.PROFILES)){
    const d=fixture(1,genre),before=JSON.stringify(d),a=C.collect(d,{x:0,y:0},{}),glow=a.batches.find(b=>b.id.startsWith('glow:'));
    assert.equal(JSON.stringify(d),before);assert.equal(a.stats.dynamicLights,0);assert.ok(a.stats.windows>0,genre);assert.ok(glow.meshes.length);
    for(const batch of a.batches)for(const m of batch.meshes){
      assert.ok(m.vertices.length/9<=C.MAX_VERTICES);assert.ok(m.indices.every(v=>v<m.vertices.length/9));
      for(let i=0;i<m.vertices.length;i+=9)assert.ok(m.vertices.slice(i,i+3).every(v=>v>=-.001&&v<=1.001));
    }
  }
});
test('nearby bodies stay detailed, distant bodies are batched and glow remains stable across the hysteresis band',()=>{
  const d=fixture(),lod={},a=C.collect(d,{x:100,y:40},lod),glow=a.batches.find(b=>b.id.startsWith('glow:'));
  assert.equal(a.stats.far,1);assert.ok(a.replaced.has(d.sceneStructures[0]));
  const b=C.collect(d,{x:140,y:40},lod);assert.equal(b.stats.near,1);assert.equal(b.replaced.size,0);
  assert.equal(b.batches.find(b=>b.id.startsWith('glow:')),glow);
  assert.equal(C.collect(d,{x:130,y:40},lod).stats.near,1);
  assert.equal(C.collect(d,{x:110,y:40},lod).stats.far,1);
});
test('distant facades survive the old 192-cell cutoff and retain distinct depths across the district',()=>{
  const d=fixture();d.sceneStructures[0].position.x=450;
  const result=C.collect(d,{x:0,y:0},{});assert.equal(result.stats.far,1);assert.ok(result.batches.length);
  assert.ok(C.depthRange(d)>Math.hypot(512,512));assert.equal(C.depthRange({layout:{width:512,height:512}}),300);
});
test('cold window work is incremental and offscreen chunks never compile or upload facades',()=>{
  const d=fixture(20,'modern','progressive'),lod={},first=C.collect(d,{x:0,y:0},lod);
  assert.equal(first.stats.pending,18);
  let frame=first;for(let i=0;i<9;i++)frame=C.collect(d,{x:0,y:0},lod);
  assert.equal(frame.stats.pending,0);assert.ok(frame.stats.windows>1000);
  const hidden=C.collect(fixture(10,'modern','hidden'),{x:0,y:0},{},{visible:()=>false});
  assert.equal(hidden.batches.length,0);assert.equal(hidden.replaced.size,10);
});
test('750 buildings use chunk batches rather than thousands of window draw calls or active lights',()=>{
  const d=fixture(750,'cyberpunk','stress-750'),lod={};let result,frames=0;
  do{result=C.collect(d,{x:0,y:0},lod);frames++;}while(result.stats.pending&&frames<750);
  assert.equal(result.stats.buildings,750);assert.equal(result.stats.pending,0);assert.equal(result.stats.dynamicLights,0);
  assert.ok(result.stats.windows>=750*600);assert.ok(result.stats.batchedDraws<=result.stats.chunks*2+4);
  assert.ok(result.stats.batchedDraws<150);assert.equal(d.genreLights.length,0);
  assert.ok(C.cacheStats().panels<=C.CACHE_PANELS);assert.ok(C.cacheStats().entries<=1024);
  const again=C.collect(d,{x:1,y:1},lod);assert.equal(again.batches[0].meshes,result.batches[0].meshes);
});
test('large batches split before unsigned-short indices overflow',()=>{
  const d=fixture(160,'cyberpunk','index-limit');for(const p of d.sceneStructures)p.position={x:210,y:40,z:3};
  const result=C.collect(d,{x:0,y:0},{},{maxNew:0}),body=result.batches.find(b=>b.id.startsWith('body:'));
  assert.ok(body.meshes.length>1);
  for(const m of body.meshes){assert.ok(m.vertices.length/9<=60000);assert.ok(m.indices.every(i=>i<m.vertices.length/9));}
});
test('GPU batches are reused, replaced and freed with a bounded cache',()=>{
  const source=fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8'),start=source.indexOf('    clearCitySkylineMeshes()'),end=source.indexOf('    getSurfaceArtMesh(',start);
  let allocated=0;const freed=[];
  const context={root:{gl:{deleteBuffer:b=>freed.push(b)},_createCharacterGpuMeshRecord:()=>({vbo:++allocated,ibo:++allocated})},Map};
  vm.runInNewContext('Object.assign(root,{'+source.slice(start,end)+'});',context);
  const batch={id:'glow:0,0',key:'first',meshes:[{}]},record=context.root.getCitySkylineMesh(batch);
  assert.equal(record.torchLimit,0);assert.equal(record.lightingScope,'skyline');assert.equal(context.root.getCitySkylineMesh(batch),record);assert.equal(allocated,2);
  context.root.getCitySkylineMesh({...batch,key:'second'});assert.equal(freed.length,2);
  for(let i=0;i<110;i++)context.root.getCitySkylineMesh({...batch,id:'glow:'+i});
  const active=new Set(Array.from({length:110},(_,i)=>'glow:'+i));
  context.root.pruneCitySkylineMeshes(active);assert.equal(context.root.citySkylineMeshes.size,110);
  for(const id of active){const p=context.root.citySkylineMeshes.get(id).passes[0];assert.ok(!freed.includes(p.vbo)&&!freed.includes(p.ibo));}
  context.root.pruneCitySkylineMeshes(new Set(['glow:109']));assert.equal(context.root.citySkylineMeshes.size,96);
  context.root.clearCitySkylineMeshes();assert.equal(freed.length,allocated);
});
test('glow vertices encode a shared physical center so subpixel expansion does not move their world depth',()=>{
  const result=C.collect(fixture(),{x:0,y:0},{}),batch=result.batches.find(b=>b.id.startsWith('glow:'));
  for(const {vertices:v}of batch.meshes)for(let q=0;q<v.length;q+=36)for(let axis=0;axis<3;axis++){
    const center=(v[q+axis]+v[q+9+axis]+v[q+18+axis]+v[q+27+axis])/4;
    for(let corner=0;corner<4;corner++)assert.ok(Math.abs(v[q+corner*9+3+axis]-center)<1e-6);
  }
});
test('streaming, run and palette invalidation rebuild the plan but unchanged buildings retain their window patterns',()=>{
  const d=fixture(),lod={},first=C.collect(d,{x:0,y:0},lod),key=first.batches.find(b=>b.id.startsWith('glow:')).key;
  d.sceneStructures=d.sceneStructures.slice();d._geometryStamp='streamed';
  assert.equal(C.collect(d,{x:0,y:0},lod).batches.find(b=>b.id.startsWith('glow:')).key,key);
  d.generation.runId='new-game';
  assert.notEqual(C.collect(d,{x:0,y:0},lod).batches.find(b=>b.id.startsWith('glow:')).key,key);
  const paletteKey=C.collect(d,{x:0,y:0},lod).batches.find(b=>b.id.startsWith('body:')).key;
  d.tiles={tower:{spriteSpec:{palette:{primary:'#123456'}}}};
  assert.notEqual(C.collect(d,{x:0,y:0},lod).batches.find(b=>b.id.startsWith('body:')).key,paletteKey);
});
test('leaving a city releases compiled CPU meshes even when the room database retains its dungeon',()=>{
  const d=fixture(4,'cyberpunk','memory-lifetime'),p=C.plan(d);C.collect(d,{x:0,y:0},{});
  const first=C.collect(d,{x:0,y:0},{});
  const keys=first.batches.map(b=>b.key);assert.ok([...p.groups.values()].some(g=>g.body?.meshes.length));
  C.collect({layout:{width:8,height:8}},{x:0,y:0},{});
  for(const group of p.groups.values()){assert.equal(group.body,null);assert.equal(group.glow,null);}
  for(const entry of p.members.values())assert.equal(entry.detail,null);
  assert.deepEqual(C.collect(d,{x:0,y:0},{}).batches.map(b=>b.key),keys);
});
test('occupied high-rise window banks are denser, floor-aligned and remain attached to real walls',()=>{
  const d=fixture(1,'cyberpunk','dense-banks'),result=C.collect(d,{x:0,y:0},{}),entry=[...C.plan(d).members.values()][0],
    detail=entry.detail,{position:p,size:s}=entry.part,voxels=Urban.build(entry.part.shape,16),storey=s.z/79;
  assert.equal(detail.windowCount,C.WINDOWS);assert.ok(detail.accentCount>0&&detail.accentCount<=C.ACCENTS);assert.equal(detail.beaconFaces,5);
  assert.ok(detail.windowCount>640);assert.equal(result.stats.windows,C.WINDOWS);assert.equal(result.stats.accents,detail.accentCount);
  let paired=0;const centers=[];
  for(const q of detail.windows.slice(0,detail.windowCount)){
    const center=[0,1,2].map(i=>q.points.reduce((n,v)=>n+v[i],0)/4),row=(center[2]-p.z)/storey-.5;
    assert.ok(Math.abs(row-Math.round(row))<1e-8);
    for(const point of q.points){
      const at=point.map((v,i)=>Math.floor((v-q.normal[i]*.024-p[['x','y','z'][i]])/s[['x','y','z'][i]]*16));
      assert.equal(voxels[at[0]+at[1]*16+at[2]*256],1,'Every lit window corner has a real wall behind it');
    }
    if(centers.some(other=>Math.abs(other[2]-center[2])<1e-8&&Math.hypot(other[0]-center[0],other[1]-center[1])<1.7))paired++;
    centers.push(center);
  }
  assert.ok(paired>detail.windowCount*.2,'Occupied windows form neighboring room banks, not only isolated dots');
  const medieval=C.lightingProfile('fantasy',80);assert.equal(medieval.accents,0);assert.ok(medieval.windows<640);
});
test('production renderer skips replaced bodies, depth-tests the same batches in both lighting modes and does no torch queries for them',()=>{
  const source=fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8');
  assert.match(source,/citySkyline\?\.replaced.has\(part\)/);assert.match(source,/window.CitySkyline\?\.depthRange\(dungeon\)/);
  assert.match(source,/inst.mesh.torchLimit===0 \? \{count:0\}/);assert.match(source,/lightingScope==='skyline' \? 1\.0/);
  assert.match(source,/visible:bounds=>this.isVoxelBoxVisible/);assert.match(source,/citySkyline: citySkyline\?\.stats/);
  assert.match(source,/gl\.depthFunc\(gl.LEQUAL\)/);
  assert.match(source,/uniform float u_skylineGlow/);assert.match(source,/inst.mesh.skylineGlow\?1:0/);
  assert.match(source,/gl\.uniform1f\(this.voxelUniforms.skylineGlow,0\)/);
  assert.match(source,/pruneCitySkylineMeshes\(new Set\(\(citySkyline\?\.batches/);
  assert.match(source,/float haloPixels = corePixels \+ min\(2\.0/);
  assert.match(source,/outColor=vec4\(paint,clamp\(core\+halo\*0\.28/);
  assert.match(source,/if\(inst.mesh.skylineGlow\)\{gl.enable\(gl.BLEND\);gl.blendFunc\(gl.SRC_ALPHA,gl.ONE\);gl.depthMask\(false\)/);
});
test('window and accent colors come from each setting\'s own approved luminous fixtures',()=>{
  const Fixtures=require('../assets/genreFixtures');
  for(const [genre,theme]of Object.entries(Fixtures.THEMES)){
    assert.deepEqual(C.lightingProfile(genre,80).panes,theme.map(t=>t[2]),genre);
    assert.deepEqual(C.lightingProfile(genre,80).theme,theme);
  }
  assert.notDeepEqual(C.lightingProfile('cyberpunk',80).panes,C.lightingProfile('noir',80).panes);
});
test('a complete production frame submits skyline batches without light queries and resets glow before ordinary meshes',()=>{
  const state={},draws=[],live=new Set();let next=0,retro=false;
  const gl=new Proxy({createBuffer(){const id=++next;live.add(id);return id;},deleteBuffer:id=>live.delete(id),
    getParameter:()=>false,isEnabled:()=>false,uniform1f:(k,v)=>state[k]=v,uniform1i:(k,v)=>state[k]=v,
    bindBuffer:(type,id)=>{if(type==='ARRAY_BUFFER')state.buffer=id;},drawElements(){assert.ok(live.has(state.buffer));draws.push({...state});}},
    {get:(o,k)=>k in o?o[k]:/^[A-Z_0-9]+$/.test(k)?k:()=>{}});
  const d=fixture(1,'cyberpunk','full-frame');d.classification={indoor:false};
  const root={currentDungeon:d,dungeonTextures:{},CitySkyline:C,WEBGPU_VOXEL_PREWARM:false,
    playerDungeonX:1,playerDungeonY:35,playerPosX:1.5,playerPosY:35.5,playerZ:.65,playerAngle:0,
    RetroGraphics:{fullbright:()=>retro}};
  const document={getElementById:id=>id==='dungeon-popup'?{style:{display:'block'}}:{clientWidth:640,clientHeight:480}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8'),{window:root,document,performance,console,clearTimeout});
  const r=root.webglDungeonRenderer;
  Object.assign(r,{gl,canvas:{width:160,height:120},cellTex:{},roofCellsTex:{},voxelProgram:{},
    voxelUniforms:{skylineGlow:'glow',unlit:'unlit',torchCount:'lights',retroInk:'ink'},
    rebuildDungeonTextures(){},buildHaloTexture(){},buildBlobShadowTexture(){},buildFlameTexture(){}});
  const before=JSON.stringify(d);
  for(const enabled of[false,true,false]){
    retro=enabled;draws.length=0;r.renderScene();
    assert.equal(r.lastFrameStats.citySkyline.far,1);assert.equal(r.lastFrameStats.citySkyline.dynamicLights,0);
    assert.equal(r.lastFrameStats.torchQueries,0);assert.ok(draws.length>=2);
    assert.ok(draws.some(v=>v.glow===1));assert.ok(draws.every(v=>v.unlit===1&&v.lights===0));assert.equal(state.glow,0);
  }
  const ordinary=gl.createBuffer();r.getVoxelMesh=()=>({vbo:ordinary,count:6});root.playerPosX=145;root.playerDungeonX=145;
  draws.length=0;r.renderScene();assert.equal(r.lastFrameStats.citySkyline.near,1);
  assert.equal(draws.find(v=>v.buffer===ordinary).glow,0);assert.equal(JSON.stringify(d),before);
});
