'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCanvas}=require('canvas');
const P=require('../assets/physicalPuzzles'),M=require('../assets/puzzleModules'),Motion=require('../assets/puzzleMotion');
const S=require('../assets/sculptureForms'),Art=require('../assets/surfaceArt'),Icons=require('../assets/shrineIconography'),V=require('../assets/scenePropVoxels');
const clone=value=>JSON.parse(JSON.stringify(value));
function design(kind){for(let i=0;i<200;i++){const p=P.fallback('module-'+i,'Shrine of Mortacia');if(p.kind===kind)return p;}throw Error(kind);}
function room(){
  const d={geoKey:'0,1,0',layout:{width:28,height:28},start:{x:14,y:14},cells:{},tiles:{},sceneObjects:[{name:'quest key',x:8,y:8}],
    sceneStructures:[],classification:{indoor:true},visualStyle:{palette:{primary:'#59616a',secondary:'#b49a7b',highlight:'#edce93',shadow:'#303740'}}};
  for(let y=0;y<28;y++)for(let x=0;x<28;x++)d.cells[`${x},${y}`]={tile:x===0||y===0||x===27||y===27?'wall':'floor',floorHeight:0,ceilHeight:3};
  d.cells['2,14'].navigationReserved=true;d.cells['2,14'].exit='west';return d;
}
for(const kind of P.KINDS)test(`${kind}: every reachable wrong setting retains a deterministic solution`,()=>{
  const p=design(kind),start=P.initialState(p),queue=[start],seen=new Set();
  for(let i=0;i<queue.length;i++){
    const s=queue[i],key=JSON.stringify([s.values,s.progress]);if(seen.has(key))continue;seen.add(key);
    const moves=P.findSolution(p,s);assert.ok(moves,kind+' '+key);
    let solved=s;for(const move of moves)solved=P.step(p,solved,move.controlId);
    assert.ok(P.solved(p,solved));assert.ok(P.validState(p,solved));
    if(s.status==='complete')continue;
    for(const c of p.controls)queue.push(P.step(p,s,c.id));
  }
  assert.ok(seen.size>1&&seen.size<=81);
  const d=room();P.install(d,{puzzleMechanism:p});assert.ok(P.verify(d).valid);
  for(const f of d.physicalPuzzle.fixtures)for(const tile of f.tiles)assert.ok(V.build(d.tiles[tile].spriteSpec.voxelShape)?.some(Boolean));
  assert.equal(d.cells['2,14'].exit,'west');assert.equal(d.sceneObjects[0].name,'quest key');
});
test('unreachable linked-lever designs and incompatible kits are refused at inception',()=>{
  const p=clone(design('interlock'));p.controls=p.controls.slice(0,2);p.controls[0].goal=1;p.controls[1].goal=0;
  p.couplings=p.controls.map(()=>p.controls.map(c=>c.id));assert.throws(()=>P.compile(p),/cannot reach/);
  const other=clone(design('balance'));other.moduleKit='lunar_orrery';assert.throws(()=>P.compile(other),/incompatible/);
});
test('four apparatus arrangements produce different verified footprints without moving room objects',()=>{
  const footprints=[];
  for(const arrangement of M.arrangements){const d=room(),p=P.compile({...design('alignment'),arrangement});P.install(d,{puzzleMechanism:p});
    footprints.push(JSON.stringify(d.physicalPuzzle.fixtures.map(f=>f.key)));assert.ok(P.verify(d).valid);assert.equal(d.cells['8,8'].tile,'floor');}
  assert.equal(new Set(footprints).size,4);
});
test('visual glyphs are deterministic, distinguishable and cannot overwrite canonical symbols',()=>{
  const custom={name:'Oracle',pixels:['0001000','0010100','0100010','1000001','0100010','0010100','0001000']};
  assert.equal(M.validateGlyphs([custom]).length,1);assert.deepEqual(M.bitmap('Oracle',[custom]),custom.pixels);
  assert.throws(()=>M.validateGlyphs([{...custom,name:'Sun'}]),/unique/);
  assert.throws(()=>M.validateGlyphs([custom,{...custom,name:'Witness'}]),/unique/);
  assert.deepEqual(M.bitmap('Eclipse'),M.bitmap('Eclipse'));assert.notDeepEqual(M.bitmap('Moon'),M.bitmap('Wave'));
});
test('motion interpolates, wraps dials, tolerates duplicate deltas and never changes persistent state',()=>{
  const d=room(),p=design('alignment');P.install(d,{puzzleMechanism:p});
  const before=clone(d.physicalPuzzle),s=P.step(p,before.state,p.controls[0].id),after=P.applyVisualState(d,s).physicalPuzzle;
  const saved=JSON.stringify(d);assert.ok(Motion.begin(d,before,after,100));
  assert.equal(Motion.pose(d,p.controls[0].id,1,100),0);
  const mid=Motion.pose(d,p.controls[0].id,1,425);assert.ok(mid>0&&mid<1);
  assert.ok(Motion.active(d,425));assert.equal(Motion.pose(d,p.controls[0].id,1,800),1);assert.equal(Motion.active(d,800),false);
  assert.equal(JSON.stringify(d),saved);assert.equal(Motion.begin(d,after,after,150),false);
  before.state.values[0]=2;after.state.values[0]=0;after.state.revision=before.state.revision+1;
  Motion.begin(d,before,after,1000);assert.ok(Motion.pose(d,p.controls[0].id,0,1450)>2);
});
test('pausing the game freezes mechanical motion on the shared logical clock',()=>{
  const d={},p=design('channels'),before={definition:p,state:P.initialState(p)},after={definition:p,state:P.step(p,P.initialState(p),p.controls[0].id)};
  const previous=global.DungeonLife;let now=100;global.DungeonLife={time:()=>now};
  try{Motion.begin(d,before,after);now=400;const first=Motion.pose(d,p.controls[0].id,1);assert.equal(Motion.pose(d,p.controls[0].id,1),first);now=1000;assert.equal(Motion.active(d),false);}
  finally{if(previous===undefined)delete global.DungeonLife;else global.DungeonLife=previous;}
});
test('working parts have genuine intermediate geometry instead of flashing between endpoint sprites',()=>{
  for(const [shape,to] of [['puzzle_dial_1',1],['puzzle_lever_1',1],['puzzle_slider_2',2],['puzzle_cabinet_open',1],['puzzle_gate_open',1]]){
    const before=V.build(shape,32,0,{pose:0}),mid=V.build(shape,32,0,{pose:to*.5}),after=V.build(shape,32,0,{pose:to});
    assert.notDeepEqual(before,mid,shape);assert.notDeepEqual(mid,after,shape);
  }
});
test('shrine forms obey the campaign pantheon and reuse the detailed character generator',()=>{
  const presetBefore=JSON.stringify(require('../assets/renderCharacterProcedural').getPresetProceduralSpec('Mortacia'));
  const m=S.normalize({deity:'Mortacia',form:'dragon'});assert.equal(m.form,'human');assert.equal(m.hair,'blonde');assert.equal(m.wings,'skeletal');
  assert.equal(S.characterSpec(m).traits.bodyPlan,'humanoid');assert.equal(S.characterSpec(m).traits.wings,'bat');assert.equal(S.characterSpec(m).traits.wingShape,'mortacia');
  for(const name of ['Atinus','Arithus','Poena','Earthdragon']){
    const s=S.normalize({deity:name,form:'human'});assert.equal(s.form,'dragon');assert.equal(S.characterSpec(s).traits.bodyPlan,'draconic');
    assert.notDeepEqual(S.build(24,1,m),S.build(24,1,s));
  }
  assert.equal(Icons.name('Dyana'),'Dyanetzia');assert.ok(Icons.find('A mural shows the White Lady'));
  assert.throws(()=>S.validate([{label:'false deity',deity:'Zeus',pose:'offering',head:'bare',robe:'toga',attribute:'none'}]),/Invalid/);
  assert.equal(JSON.stringify(require('../assets/renderCharacterProcedural').getPresetProceduralSpec('Mortacia')),presetBefore);
});
test('sculpture gesture, head, robe and monster forms produce varied bounded silhouettes',()=>{
  const shapes=S.poses.map(pose=>Buffer.from(S.build(24,2,{pose})).toString('base64'));
  assert.equal(new Set(shapes).size,S.poses.length);
  for(const form of S.forms){const voxels=S.build(24,1,{form,pose:'guardian'});assert.equal(voxels.length,24**3);assert.ok(voxels.some(Boolean));}
});
test('fresco compositions and deity identities change pixels; decoration remains within a finite budget',()=>{
  const hashes=[],gallery=createCanvas(96*3,64*2),g=gallery.getContext('2d');
  for(const [i,composition]of Art.compositions.entries()){
    const canvas=createCanvas(96,64),ctx=canvas.getContext('2d');
    const art=Art.validate([{kind:'fresco',surface:'wall',label:'Mortacia receives souls',description:'The departed beneath dragon wings.',motifs:['Mortacia','skeleton','wraith'],composition,text:'Memory endures.'}])[0];
    Art.paint(ctx,createCanvas,art,{primary:'#813c32',secondary:'#c08b55',highlight:'#dfcda1',shadow:'#342e32'});
    hashes.push(Buffer.from(ctx.getImageData(0,0,96,64).data).toString('base64'));g.drawImage(canvas,(i%3)*96,Math.floor(i/3)*64);
    const mesh=Art.mesh(ctx.getImageData(0,0,96,64));assert.ok(mesh.indices.length>100);assert.ok(mesh.vertices.length/9<65536);
    assert.ok(mesh.indices.every(index=>index<mesh.vertices.length/9));assert.ok(mesh.vertices.every(Number.isFinite));
  }
  assert.equal(new Set(hashes).size,6);
  if(process.env.HOLODEK_ART_PREVIEW==='1'){
    const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'fresco-compositions.png'),gallery.toBuffer('image/png'));
  }
  assert.throws(()=>Art.mesh({width:256,height:256,data:[]}),/budget/);
});
test('artwork is attached to safe surfaces and persists without changing navigation, loot or the mechanism',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-art-test-')),prior=process.env.HOLODEK_SPRITE_DIR;
  process.env.HOLODEK_SPRITE_DIR=temp;
  try{
    const {applySurfaceArt}=require('../retort/sceneRoomBuilder');
    const d=room(),p=P.compile({...design('alignment'),roomArt:[
      {kind:'fresco',surface:'wall',label:'Mortacia at the threshold',description:'The White Lady shelters souls.',motifs:['Mortacia','wraith'],composition:'judgment'},
      {kind:'mosaic',surface:'floor',label:'The rings of Syluria',description:'The blue moon above a draconic procession.',motifs:['Moon','dragon']}]});
    P.install(d,{puzzleMechanism:p});const cells=JSON.stringify(d.cells),items=JSON.stringify(d.sceneObjects),mechanism=JSON.stringify(d.physicalPuzzle);
    assert.equal(applySurfaceArt(d,{puzzleMechanism:p}).count,3);
    assert.equal(JSON.stringify(d.cells),cells);assert.equal(JSON.stringify(d.sceneObjects),items);assert.equal(JSON.stringify(d.physicalPuzzle),mechanism);
    assert.ok(d.surfaceArt.every(a=>[a.position.x,a.position.y,a.position.z,a.size.x,a.size.y,a.size.z].every(Number.isFinite)));
    for(const a of d.surfaceArt)if(a.surface==='wall')assert.equal(d.cells[a.key].tile,'wall');
    assert.equal(applySurfaceArt(d,{puzzleMechanism:p}).status,'existing');assert.ok(P.verify(d).valid);
    assert.deepEqual(clone(d).surfaceArt,d.surfaceArt);
  }finally{
    if(prior===undefined)delete process.env.HOLODEK_SPRITE_DIR;else process.env.HOLODEK_SPRITE_DIR=prior;
    delete require.cache[require.resolve('../retort/sceneRoomBuilder')];
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
test('altar forms contain supported canopies, distinguishable profiles and correctly mounted candles',()=>{
  const seen=new Set();
  for(const shape of S.altarTypes){const grid=V.build(shape,24,0,{shrine:{candles:3,deity:'Mortacia'}});seen.add(Buffer.from(grid).toString('base64'));assert.ok(grid.some(Boolean));
    const sites=V.candleSites(shape,{candles:3});assert.equal(sites.length,3);assert.ok(sites.every(s=>s.z<1&&s.z>.5));}
  assert.equal(seen.size,S.altarTypes.length);assert.deepEqual(V.candleSites(undefined),[]);
  assert.equal(V.candleSites('candelabra').length,3);assert.equal(V.candleSites('horned_altar',{candles:0}).length,0);
  const canopy=V.build('canopied_altar',32);for(const x of [3,28])for(const y of [3,28])for(let z=5;z<28;z++)assert.equal(canopy[x+y*32+z*1024],1);
});
test('clue treatments are visibly different, not just five names for the same plaque',()=>{
  const seen=new Set(),p=design('alignment');
  for(const clueStyle of M.clueStyles){
    const art=Art.plan({puzzleMechanism:{...p,clueStyle}}).find(a=>a.puzzleClue),canvas=createCanvas(144,96),ctx=canvas.getContext('2d');
    Art.paint(ctx,createCanvas,art);seen.add(Buffer.from(ctx.getImageData(0,0,144,96).data).toString('base64'));
  }
  assert.equal(seen.size,5);
});
