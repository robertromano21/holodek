'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCanvas}=require('canvas'),Art=require('../assets/surfaceArt'),Mosaics=require('../assets/mosaicDesigns'),Designs=require('../assets/frescoDesigns');
const P=require('../assets/physicalPuzzles'),S=require('../assets/sculptureForms'),Carvings=require('../assets/stoneCarvings');
const save=(name,c)=>{if(process.env.HOLODEK_ART_PREVIEW==='1'){const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name+'.png'),c.toBuffer());}};
const base={kind:'fresco',surface:'wall',label:'The underworld remembers',description:'The sacred court of the departed.',motifs:['Mortacia','skeleton','wraith'],style:'renaissance',composition:'judgment',format:'mural'};
test('additive mosaic recipes render bounded distinct floor and wall art, with stable metadata',()=>{
  const gallery=createCanvas(576,232*Mosaics.patterns.length),g=gallery.getContext('2d'),hashes=new Set();
  for(const[i,mosaicPattern]of Mosaics.patterns.entries())for(const[j,surface]of['wall','floor'].entries()){
    const row=Art.validate([{...base,kind:'mosaic',style:'byzantine',surface,mosaicPattern}])[0],size=Art.rasterSize(row),c=createCanvas(size.width,size.height);
    Art.paint(c.getContext('2d'),createCanvas,row);hashes.add(c.toBuffer().toString('base64'));
    const mesh=Art.mesh(c.getContext('2d').getImageData(0,0,c.width,c.height),'y',surface,-1,row);
    assert.ok(mesh.vertices.length/9<65536);assert.ok(mesh.vertices.every(Number.isFinite));assert.ok(mesh.indices.every(i=>i<mesh.vertices.length/9));
    const p=P.compile({...P.fallback('mosaic-expansion','Temple'),roomArt:[row]});assert.equal(P.compile(JSON.parse(JSON.stringify(p))).id,p.id);
    g.imageSmoothingEnabled=false;const scale=Math.min(288/c.width,208/c.height);g.drawImage(c,j*288,i*232,c.width*scale,c.height*scale);
    g.fillStyle='#eadbbc';g.font='12px Georgia';g.fillText(mosaicPattern+' / '+surface,j*288+6,i*232+224);
  }
  assert.equal(hashes.size,Mosaics.patterns.length*2);save('mosaic-expansion',gallery);
  assert.throws(()=>Art.validate([{...base,mosaicPattern:'apse_court'}]),/Invalid/);
  assert.throws(()=>Art.validate([{...base,kind:'mosaic',mosaicPattern:'invented'}]),/Invalid/);
  assert.equal(Art.validate([{...base,kind:'mosaic'}])[0].mosaicPattern,undefined);
});
test('new fresco scenes preserve old scenes, fill broad compositions without overlapping figure boxes',()=>{
  const scenes=Designs.scenes.slice(16),gallery=createCanvas(800,240*Math.ceil(scenes.length/2)),g=gallery.getContext('2d'),hashes=new Set();
  assert.equal(Designs.scenes[0],'ancestral_court');assert.equal(scenes.length,10);
  scenes.forEach((scene,i)=>{
    const row=Art.validate([{...base,scene,aspectRatio:2}])[0],c=createCanvas(160,80);Art.paint(c.getContext('2d'),createCanvas,row);
    hashes.add(c.toBuffer().toString('base64'));
    for(const width of[96,128,160]){
      const boxes=Designs.layout(row,Designs.figures(row),width).map(f=>f.box).sort((a,b)=>a.x-b.x);
      boxes.forEach((b,j)=>{assert.ok(b.x>=0&&b.x+b.width<=width&&b.y+b.height<=64);if(j)assert.ok(boxes[j-1].x+boxes[j-1].width<=b.x);});
    }
    g.imageSmoothingEnabled=false;g.drawImage(c,i%2*400,Math.floor(i/2)*240,400,200);g.fillStyle='#eadbbc';g.font='14px Georgia';g.fillText(scene.replace(/_/g,' '),i%2*400+7,Math.floor(i/2)*240+222);
  });
  assert.equal(hashes.size,scenes.length);save('fresco-expansion',gallery);
});
test('ornament supplements four or six paintings without crowding out the permanent puzzle clue',()=>{
  for(const[roomName,count]of[['Ruined Temple Entrance',4],['Grand Palace',6]]){
    const p=P.fallback('art-count',roomName),spec={indoor:true,source:{roomName,description:'Ancient stone halls of Mortacia.'},puzzleMechanism:p};
    const rows=Art.plan(spec);assert.equal(rows.filter(a=>a.kind==='fresco').length,count);
    assert.equal(rows.filter(a=>a.mosaicPattern).length,count===6?2:1);assert.equal(rows.filter(a=>a.puzzleClue).length,1);assert.ok(rows.length<=13);
    assert.deepEqual(Art.plan(spec),rows);
  }
  assert.equal(Carvings.styles.length,22);for(const style of Object.keys(Designs.styles))assert.ok(Carvings.forTradition(style).every(s=>Carvings.styles.includes(s)));
});
test('wall art grows upward at widescreen proportions without changing saved width, cells or labels',()=>{
  for(const axis of['x','y'])for(const ratio of[1.5,2,2.5]){
    const along=axis==='x'?'y':'x',d={cells:{'0,0':{tile:'wall',floorHeight:0,ceilHeight:10}}};
    const row={...base,aspectRatio:ratio,axis,sign:1,key:'0,0',position:{x:0,y:0,z:.35},size:{x:.02,y:.02,z:6/ratio}};row.size[along]=6;
    const before=JSON.stringify({row,d});
    for(const compensation of[1,16/10,16/9,21/9]){
      const shown=Art.presentation(row,{dungeon:d,verticalCompensation:compensation});
      assert.ok(Math.abs(shown.size[along]-6)<1e-10);assert.ok(Math.abs(shown.size[along]/shown.size.z*compensation-ratio)<1e-10);
      assert.ok(shown.position.z+shown.size.z<=9.88);assert.equal(shown.label,row.label);
    }
    assert.equal(JSON.stringify({row,d}),before);
  }
});
test('art respects low ceilings and remains pickable throughout its taller visible face',()=>{
  const UI=require('../assets/worldInteractionUi'),row={...base,axis:'y',sign:-1,key:'3,5',position:{x:1,y:5,z:.35},size:{x:6,y:.02,z:4}};
  const d={surfaceArt:[row],cells:{'3,5':{tile:'wall',floorHeight:0,ceilHeight:3}}};
  const shown=Art.presentation(row,{dungeon:d,verticalCompensation:16/9});assert.ok(shown.position.z+shown.size.z<=2.88);
  for(let x=0;x<9;x++)for(let y=0;y<5;y++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:3};
  const saved=global.SurfaceArt;global.SurfaceArt=Art;
  const camera={x:4,y:3,eyeZ:1.5,dirX:0,dirY:1,planeScale:.577,verticalScale:1.732,artVerticalCompensation:16/9};
  try{const target=UI.pick(d,camera,{x:4,y:3},.5,.25);assert.equal(target.type,'art');assert.equal(target.box.sz,shown.size.z);assert.equal(target.box.x,shown.position.x);}
  finally{if(saved===undefined)delete global.SurfaceArt;else global.SurfaceArt=saved;}
});
test('carved statues add sculptural poses with supported seats and retain classic geometry',()=>{
  const old={label:'Ancestor',pose:'offering',head:'bare',robe:'toga',attribute:'none',form:'human'},newPoses=['laureate','mantled_scholar','victorious','lyrist'];
  assert.deepEqual(S.build(24,'old',old),S.build(24,'old',{...old,workmanship:'classic'}));
  const hashes=new Set();for(const pose of newPoses){
    const s=S.validate([{...old,pose,workmanship:'carved'}])[0],v=S.build(64,'new',s);hashes.add(Buffer.from(v).toString('base64'));
    assert.equal(v.length,64**3);assert.ok(v.some(Boolean));
    if(pose==='mantled_scholar')assert.ok(v[Math.floor(.39*64)+Math.floor(.63*64)*64+Math.floor(.2*64)*64**2],'Seat leg reaches the plinth');
  }assert.equal(hashes.size,4);
});
