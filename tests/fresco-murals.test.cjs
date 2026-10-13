'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCanvas}=require('canvas'),Art=require('../assets/surfaceArt'),P=require('../assets/physicalPuzzles'),Designs=require('../assets/frescoDesigns'),Figures=require('../assets/frescoFigures');
const {wallFaces,mountWall}=require('../retort/surfaceArtPlacement');
function room(height=3,width=30){
  const d={layout:{width,height:width},start:{x:Math.floor(width/2),y:Math.floor(width/2)},cells:{},tiles:{},sceneObjects:[],
    visualStyle:{palette:{primary:'#b69a6c',secondary:'#a18358',highlight:'#d8b77e',shadow:'#826a43'}}};
  for(let y=0;y<width;y++)for(let x=0;x<width;x++)d.cells[`${x},${y}`]={tile:x===0||y===0||x===width-1||y===width-1?'wall':'floor',floorHeight:0,ceilHeight:height};
  return d;
}
function candidates(d){return Object.entries(d.cells).filter(([,c])=>c.tile==='floor'&&!c.navigationReserved&&!c.feature).map(([key])=>{
  const[x,y]=key.split(',').map(Number);return{key,x,y,d:Math.hypot(x-d.start.x,y-d.start.y)};
});}
function spec(){return{indoor:true,source:{roomName:'Ruined Temple Entrance',description:'A vaulted stone temple bears faded frescoes of the departed.'}};}
test('indoor temple plans four dignified paintings; grand buildings six; outdoor wilderness is not filled with murals',()=>{
  const plan=Art.plan(spec());assert.equal(plan.length,9);assert.equal(plan.filter(a=>a.kind==='fresco').length,4);
  assert.ok(plan.filter(a=>a.kind==='fresco').every(a=>a.format==='mural'&&a.motifs.includes('Mortacia')));
  const palace=Art.plan({indoor:true,source:{roomName:'Grand Palace',description:'A vaulted hall.'}});assert.equal(palace.length,12);assert.equal(palace.filter(a=>a.kind==='fresco').length,6);
  assert.equal(Art.plan({indoor:false,source:{roomName:'Desert',description:'Open dunes.'}}).length,0);
  assert.deepEqual(Art.plan(spec()),plan);
  assert.equal(Art.validate(plan.filter(a=>a.kind==='fresco')).length,4);assert.throws(()=>Art.validate([...plan,...plan]),/six/);
  assert.throws(()=>Art.validate([{...plan[0],pigments:'hot pink'}]),/Invalid/);
});
test('fresco pigments ignore beige wall colors and retain probe-like contrast without changing character sprites',()=>{
  const art=Art.plan(spec())[0],colors=[];
  for(const primary of ['#bda578','#777766']){
    const canvas=createCanvas(144,96);Art.paint(canvas.getContext('2d'),createCanvas,art,{primary,secondary:primary,highlight:primary,shadow:primary});
    colors.push(canvas.getContext('2d').getImageData(0,0,144,96).data);
  }
  assert.deepEqual(colors[0],colors[1]);
  let bright=0,dark=0,red=0;
  for(let i=0;i<colors[0].length;i+=4){const[r,g,b]=colors[0].slice(i,i+3);if(r>190&&g>175&&b>140)bright++;if(r+g+b<260)dark++;if(r>g*1.45&&r>b*1.45)red++;}
  assert.ok(bright>40&&dark>500&&red>300,JSON.stringify({bright,dark,red}));
  const hashes=new Set();for(const pigments of Object.keys(Art.pigmentPalettes)){
    const c=createCanvas(144,96);Art.paint(c.getContext('2d'),createCanvas,{...art,pigments});hashes.add(c.toBuffer().toString('base64'));
  }
  assert.equal(hashes.size,4);
});

test('panoramic murals expand composition rather than figure anatomy and keep classic templates',()=>{
  const art=Art.plan(spec())[0],rows=Designs.figures(art),classic=Designs.layout(art,rows),wide=Designs.layout(art,rows,128);
  for(let i=0;i<rows.length;i++){
    assert.equal(wide[i].box.width,classic[i].box.width);assert.equal(wide[i].box.height,classic[i].box.height);
    assert.ok(Math.abs(wide[i].box.x+wide[i].box.width/2-(classic[i].box.x+classic[i].box.width/2)*4/3)<1e-8);
  }
  const frames=[];
  for(const aspectRatio of[1.5,2,2.5]){
    const row={...art,aspectRatio},{width,height}=Art.rasterSize(row),c=createCanvas(width,height);
    Art.paint(c.getContext('2d'),createCanvas,row);assert.equal(width/height,aspectRatio);assert.ok(width*height<=16384);
    const mesh=Art.mesh(c.getContext('2d').getImageData(0,0,width,height));assert.ok(mesh.vertices.length/9<65536);assert.ok(mesh.vertices.every(Number.isFinite));
    frames.push({aspectRatio,c});
  }
  const c=createCanvas(96,96),ctx=c.getContext('2d'),draw=ctx.drawImage.bind(ctx),scales=[];
  ctx.drawImage=(...args)=>{if(args.length===9)scales.push([args[7]/args[3],args[8]/args[4]]);draw(...args);};
  Figures.paint(ctx,rows[0],Art.frescoPalette(art),{x:0,y:0,width:60,height:90},art.style,createCanvas);
  assert.ok(scales.length>0&&scales.every(([x,y])=>Math.abs(x-y)<1e-8));
  assert.equal(Art.validate([{...art,aspectRatio:1.5}])[0].aspectRatio,1.5);
  assert.throws(()=>Art.validate([{...art,aspectRatio:20}]),/Invalid/);
  if(process.env.HOLODEK_ART_PREVIEW==='1'){
    const gallery=createCanvas(800,1320),g=gallery.getContext('2d');g.imageSmoothingEnabled=false;
    frames.forEach(({aspectRatio,c},i)=>{g.drawImage(c,0,i*440,c.width*4,c.height*4);g.fillStyle='#eadbbb';g.font='14px Georgia';g.fillText(aspectRatio+':1',8,i*440+424);});
    const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'fresco-wide-compositions.png'),gallery.toBuffer());
  }
});

test('saved mural presentation fits its natural ratio without changing mounts, metadata or footprint',()=>{
  for(const axis of['x','y'])for(const ratio of[1.5,2,2.5]){
    const along=axis==='x'?'y':'x',art={kind:'fresco',surface:'wall',axis,aspectRatio:ratio,
      position:{x:5,y:5,z:.35},size:{x:axis==='x'?.02:4,y:axis==='y'?.02:4,z:4}},before=JSON.stringify(art),shown=Art.presentation(art);
    assert.equal(JSON.stringify(art),before);assert.equal(shown.size[along]/shown.size.z,ratio);
    assert.ok(shown.position.z>=art.position.z&&shown.position.z+shown.size.z<=art.position.z+art.size.z);
    assert.ok(shown.position[along]>=art.position[along]&&shown.position[along]+shown.size[along]<=art.position[along]+art.size[along]);
  }
  const a={kind:'relief',surface:'wall'};assert.equal(Art.presentation(a),a);
});
test('murals use several continuous wall cells, preserve proportions and spread across four faces',()=>{
  const d=room(),walls=wallFaces(d,candidates(d)),used=new Set(),groups=new Map(),centers=[];
  const mounts=Art.plan(spec()).filter(a=>a.kind==='fresco').map(a=>{const mount=mountWall(walls,a,used,groups,centers);assert.ok(mount);mount.keys.forEach(k=>used.add(k));return mount;});
  assert.equal(groups.size,4);
  for(const m of mounts){const width=Math.max(m.size.x,m.size.y);assert.ok(width>=3&&m.size.z>=2);assert.equal(width/m.size.z,2);
    assert.ok(m.keys.length>=3);assert.ok(m.keys.every(k=>d.cells[k].tile==='wall'));assert.ok(m.position.z+m.size.z<=3);}
  const tall=room(9),big=mountWall(wallFaces(tall,candidates(tall)),Art.plan(spec())[0],new Set());
  assert.ok(Math.max(big.size.x,big.size.y)>7&&big.size.z>3.5);assert.ok(big.size.z<=3.9);
});
test('murals never cross doors, exits, reserved routes, missing walls, roof edges or changes of elevation',()=>{
  const d=room(3,14);
  for(const key of ['0,5','13,6','6,0','7,13']){d.cells[key].tile='door';d.cells[key].exit='north';}
  d.cells['1,8'].navigationReserved=true;d.cells['0,10'].tile='floor';
  d.cells['5,1'].roof={height:1.7};d.cells['9,12'].floorHeight=1;
  const walls=wallFaces(d,candidates(d)),used=new Set(),groups=new Map(),centers=[];
  for(const art of Art.plan(spec())){
    const m=mountWall(walls,art,used,groups,centers);if(!m)continue;m.keys.forEach(k=>used.add(k));
    for(const key of m.keys){const[x,y]=key.split(',').map(Number),wall=d.cells[key];assert.equal(wall.tile,'wall');assert.ok(!wall.exit);
      const floor=d.cells[`${x+(m.axis==='x'?m.sign:0)},${y+(m.axis==='y'?m.sign:0)}`];
      assert.ok(floor&&!floor.navigationReserved);assert.ok(m.position.z>=(floor.floorHeight||0)+.3);
      assert.ok(m.position.z+m.size.z<=Math.min(floor.ceilHeight,floor.roof?.height??Infinity));}
  }
});
test('large murals can be examined near their far edge, but not through their supporting wall',()=>{
  const World=require('../assets/worldInteractionUi'),d=room(3,22);
  for(let x=0;x<22;x++)d.cells[`${x},10`].tile='wall';
  d.surfaceArt=[{kind:'fresco',axis:'y',sign:-1,surface:'wall',key:'2,10',label:'The White Lady',description:'The departed beneath dragon wings.',
    position:{x:2,y:9.99,z:.35},size:{x:7.8,y:.02,z:2.6}}];
  const camera={x:9.5,y:8.5,eyeZ:.9,dirX:0,dirY:1,planeScale:.577,verticalScale:1};
  const target=World.pick(d,camera,camera,.5,.5);assert.equal(target?.label,'The White Lady');assert.equal(target.enabled,true);
  const behind={...camera,y:11.5,dirY:-1};assert.equal(World.pick(d,behind,behind,.5,.5),null);
});
test('full construction adds four murals plus a nearby diagram without changing exits, items, layout or puzzle state',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-murals-')),prior=process.env.HOLODEK_SPRITE_DIR;
  process.env.HOLODEK_SPRITE_DIR=tmp;delete require.cache[require.resolve('../retort/sceneRoomBuilder')];
  try{
    const {applySurfaceArt}=require('../retort/sceneRoomBuilder'),d=room(),s=spec();
    s.puzzleMechanism=P.fallback('mural-test','Ruined Temple Entrance');P.install(d,s);
    const before=JSON.stringify({cells:d.cells,items:d.sceneObjects,puzzle:d.physicalPuzzle});
    const report=applySurfaceArt(d,s);assert.equal(report.frescoes,4);assert.equal(report.count,10);assert.equal(report.murals,4);
    assert.equal(d.surfaceArt.filter(a=>a.carvingStyle).length,4);
    assert.equal(JSON.stringify({cells:d.cells,items:d.sceneObjects,puzzle:d.physicalPuzzle}),before);
    assert.equal(d.surfaceArt.filter(a=>a.puzzleClue).length,1);assert.ok(P.verify(d).valid);
    assert.equal(applySurfaceArt(d,s).status,'existing');assert.deepEqual(JSON.parse(JSON.stringify(d.surfaceArt)),d.surfaceArt);
    if(process.env.HOLODEK_ART_PREVIEW==='1'){
      const gallery=createCanvas(576,384),ctx=gallery.getContext('2d');
      d.surfaceArt.filter(a=>a.kind==='fresco').forEach((art,i)=>{
        const c=createCanvas(288,144);Art.paint(c.getContext('2d'),createCanvas,art,d.visualStyle.palette);ctx.drawImage(c,(i%2)*288,Math.floor(i/2)*192);
      });
      const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'fresco-mural-preview.png'),gallery.toBuffer());
    }
  }finally{
    if(prior===undefined)delete process.env.HOLODEK_SPRITE_DIR;else process.env.HOLODEK_SPRITE_DIR=prior;
    delete require.cache[require.resolve('../retort/sceneRoomBuilder')];fs.rmSync(tmp,{recursive:true,force:true});
  }
});
