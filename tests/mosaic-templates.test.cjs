'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createCanvas}=require('canvas'),Art=require('../assets/surfaceArt'),M=require('../assets/mosaicDesigns'),Designs=require('../assets/frescoDesigns');
const Figures=require('../assets/frescoFigures'),P=require('../assets/physicalPuzzles'),UI=require('../assets/worldInteractionUi');
const {mountWall,wallFaces}=require('../retort/surfaceArtPlacement');
const base={kind:'mosaic',surface:'wall',format:'mural',label:'The ancestral sanctuary',description:'Emblems of the departed.',
  motifs:['Mortacia','Atinus','Atricles'],style:'byzantine',pigments:'lapis'};
function render(row,api=Art){const size=api.rasterSize(row),c=createCanvas(size.width,size.height);api.paint(c.getContext('2d'),createCanvas,row);return c;}
function isolatedArt(replacements={}){
  const context={module:{exports:{}},require:name=>replacements[name]||require(path.join(__dirname,'../assets',name))};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/surfaceArt.js'),'utf8'),context);return context.module.exports;
}
function room(){
  const d={cells:{},tiles:{},layout:{width:18,height:18},start:{x:9,y:9}},candidates=[];
  for(let y=0;y<18;y++)for(let x=0;x<18;x++){
    const key=`${x},${y}`;d.cells[key]={tile:x===0||y===0||x===17||y===17?'wall':'floor',floorHeight:0,ceilHeight:6};
    if(d.cells[key].tile==='floor')candidates.push({key,x,y,d:Math.hypot(x-9,y-9)});
  }return{d,candidates};
}
test('all decorative mosaics bypass fresco scenery and scene-derived figure templates, including legacy metadata',()=>{
  const forbidden=()=>assert.fail('Mosaics must not call fresco composition templates');
  const api=isolatedArt({'./frescoDesigns':{...Designs,figures:forbidden,layout:forbidden,background:forbidden,details:forbidden}});
  for(const mosaicPattern of[undefined,...M.patterns]){
    const row={...base,scene:'ancestral_court',...(mosaicPattern?{mosaicPattern}:{})},before=JSON.stringify(row);
    assert.ok(render(row,api).toBuffer().length>500);assert.equal(JSON.stringify(row),before);
    const planned=api.plan({indoor:false,puzzleMechanism:{roomArt:[row]}});
    assert.ok(M.patterns.includes(planned[0].mosaicPattern));assert.ok(planned[0].figures.length);
  }
  const legacy=Art.validate([base])[0],before=JSON.stringify(legacy);
  assert.equal(legacy.mosaicPattern,undefined);assert.equal(legacy.mosaicShape,undefined);
  assert.deepEqual(render(legacy).toBuffer(),render({...legacy,scene:'banquet_of_shades',composition:'lamentation'}).toBuffer());
  assert.equal(JSON.stringify(legacy),before);assert.equal(M.resolvePattern(legacy),'pantheon_rosette');
});
test('mosaic figure defaults are independent, canonical dragons and authored costumes survive',()=>{
  const art={...base,mosaicPattern:'apse_court',motifs:['Mortacia','Suzerain','Scholar']},rows=M.figures(art);
  assert.equal(rows[0].pose,'benediction');assert.equal(rows[0].subject,'Mortacia');assert.equal(rows[0].attribute,'sword');
  assert.equal(rows[1].robe,'class');assert.equal(rows[2].className,'Scholar');assert.equal(rows[2].attribute,'book');
  assert.deepEqual(M.figures({...art,scene:'dragon_war'}),rows);
  const guardians={...base,mosaicPattern:'dragon_guardians',motifs:['Turthus','Dantuea']},painted=[];
  const spy={...Figures,paint:(c,f,pal,box)=>painted.push({f,box})};
  render(guardians,isolatedArt({'./frescoFigures':spy}));
  assert.deepEqual(painted.map(r=>r.f.subject),['Turthus','Dantuea']);
  assert.ok(painted.every(r=>r.f.anatomy==='serpentine'&&r.f.proportions==='classical'));
  const figures=[{subject:'Mortacia',pose:'reading',robe:'mantle',head:'bare',attribute:'book',facing:'left',proportions:'classical'}];
  const authored=Art.validate([{...art,figures}])[0];painted.length=0;render(authored,isolatedArt({'./frescoFigures':spy}));
  assert.equal(painted.length,1);assert.deepEqual(JSON.parse(JSON.stringify(painted[0].f)),authored.figures[0]);
  assert.equal(M.figures(authored),authored.figures);
});
test('shaped mosaics have transparent surroundings, circular bounds and bounded meshes on walls and floors',()=>{
  const gallery=createCanvas(900,330*2),g=gallery.getContext('2d'),hashes=new Set();
  const examples=[['circle','pantheon_rosette'],['circle','spiral_shield'],['circle','sepulchra_knot'],
    ['hexagon','honeycomb_medallions'],['octagon','interlaced_roundels'],['rectangle','meander_pavement']];
  for(const [i,[mosaicShape,mosaicPattern]]of examples.entries()){
    const row=Art.validate([{...base,mosaicShape,mosaicPattern}])[0],before=JSON.stringify(row),c=render(row);
    hashes.add(c.toBuffer().toString('base64'));
    if(mosaicShape!=='rectangle'){
      assert.equal(c.width,c.height);const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height);
      assert.equal(pixels.data[3],0);assert.equal(pixels.data[((c.width-1)*4)+3],0);
      let x0=c.width,x1=-1,y0=c.height,y1=-1;
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels.data[(x+y*c.width)*4+3]>=128){
        x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      }
      if(mosaicShape==='circle')assert.equal(x1-x0,y1-y0);
      for(const surface of['wall','floor']){
        const mesh=Art.mesh(pixels,'y',surface,-1,row);assert.ok(mesh.vertices.length/9<65536&&mesh.indices.length>0);
        assert.ok(mesh.vertices.every(Number.isFinite));assert.ok(mesh.indices.every(j=>j<mesh.vertices.length/9));
        for(let j=0;j<mesh.vertices.length;j+=36){
          const u=mesh.vertices[j],v=surface==='floor'?mesh.vertices[j+1]:1-mesh.vertices[j+2];
          assert.ok(u>.005||v>.005,'Transparent top-left corners must not become mesh geometry');
        }
      }
    }
    const definition=P.compile({...P.fallback('mosaic-shapes','Temple'),roomArt:[row]});
    assert.equal(P.compile(JSON.parse(JSON.stringify(definition))).id,definition.id);assert.equal(JSON.stringify(row),before);
    g.fillStyle='#514436';g.fillRect(i%3*300,Math.floor(i/3)*330,300,330);g.imageSmoothingEnabled=false;
    const scale=Math.min(280/c.width,280/c.height);g.drawImage(c,i%3*300+10,Math.floor(i/3)*330+10,c.width*scale,c.height*scale);
    g.fillStyle='#eadbbc';g.font='14px Georgia';g.fillText(mosaicPattern.replace(/_/g,' '),i%3*300+10,Math.floor(i/3)*330+310);
  }
  assert.equal(hashes.size,examples.length);
  if(process.env.HOLODEK_ART_PREVIEW==='1'){const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'mosaic-shapes-preview.png'),gallery.toBuffer());}
  assert.throws(()=>Art.validate([{...base,mosaicShape:'ellipse'}]),/Invalid mosaic shape/);
  assert.throws(()=>Art.validate([{...base,kind:'fresco',mosaicShape:'circle'}]),/Invalid mosaic shape/);
});
test('round mosaics keep full wall width when headroom permits, and new mounts respect the square aspect',()=>{
  const {d,candidates}=room(),row={...base,mosaicShape:'circle',mosaicPattern:'spiral_shield'};
  const mount=mountWall(wallFaces(d,candidates),row,new Set());assert.ok(mount);
  assert.equal(Math.max(mount.size.x,mount.size.y),mount.size.z);assert.ok(mount.size.z>3&&mount.viewPoint);
  for(const axis of['x','y'])for(const compensation of[1,1.6,16/9]){
    const along=axis==='x'?'y':'x',a={...row,axis,key:'0,0',sign:1,position:{x:0,y:0,z:.35},size:{x:.02,y:.02,z:3}};a.size[along]=3;
    const dungeon={cells:{'0,0':{floorHeight:0,ceilHeight:8}}},before=JSON.stringify(a);
    const shown=Art.presentation(a,{dungeon,verticalCompensation:compensation});
    assert.equal(shown.size[along],3);assert.ok(Math.abs(shown.size[along]/shown.size.z*compensation-1)<1e-10);
    assert.equal(JSON.stringify(a),before);
    dungeon.cells['0,0'].ceilHeight=2;const low=Art.presentation(a,{dungeon,verticalCompensation:compensation});
    assert.ok(low.position.z+low.size.z<=1.88);assert.ok(Math.abs(low.size[along]/low.size.z*compensation-1)<1e-10);
  }
});
test('round mosaic hovering excludes cut-off corners and retains the visible center',()=>{
  const oldArt=global.SurfaceArt,oldM=global.MosaicDesigns;global.SurfaceArt=Art;global.MosaicDesigns=M;
  try{
    const {d}=room();d.surfaceArt=[{...base,mosaicShape:'circle',axis:'x',sign:-1,key:'6,8',
      position:{x:6,y:7,z:.1},size:{x:.02,y:2,z:2},mosaicPattern:'spiral_shield'}];
    const camera={x:3,y:8,eyeZ:1.1,dirX:1,dirY:0,planeScale:1/3,verticalScale:1.5};
    assert.equal(UI.pick(d,camera,camera,.5,.5)?.type,'art');
    assert.equal(UI.pick(d,camera,camera,.06,.64),null);
    d.surfaceArt[0].mosaicShape='rectangle';assert.equal(UI.pick(d,camera,camera,.06,.64)?.type,'art','The old rectangular bounds would select this corner');
    for(const mosaicShape of M.shapes){assert.equal(M.contains({mosaicShape},.5,.5),true);assert.equal(M.contains({mosaicShape},0,0),mosaicShape==='rectangle');}
  }finally{if(oldArt===undefined)delete global.SurfaceArt;else global.SurfaceArt=oldArt;if(oldM===undefined)delete global.MosaicDesigns;else global.MosaicDesigns=oldM;}
});
test('research patterns and circle variants appear in deterministic new-room plans without replacing frescoes or clues',()=>{
  const shapes=new Set(),patterns=new Set();
  for(let i=0;i<64;i++){
    const spec={indoor:true,source:{roomName:'Grand Roman Palace '+i,description:'A stone atrium of Mortacia.'},puzzleMechanism:P.fallback('shapes-'+i,'Palace')},before=JSON.stringify(spec);
    const rows=Art.plan(spec);assert.equal(rows.filter(r=>r.kind==='fresco').length,6);assert.equal(rows.filter(r=>r.puzzleClue).length,1);assert.ok(rows.length<=13);
    for(const r of rows.filter(r=>r.kind==='mosaic'&&!r.puzzleClue)){shapes.add(r.mosaicShape);patterns.add(r.mosaicPattern);assert.equal(r.scene,undefined);}
    assert.equal(JSON.stringify(spec),before);assert.deepEqual(Art.plan(spec),rows);
  }
  assert.equal(shapes.size,M.shapes.length);assert.ok(shapes.has('circle'));
  for(const p of['meander_pavement','honeycomb_medallions','spiral_shield','intersecting_circles'])assert.ok(patterns.has(p));
  for(const style of Object.keys(Designs.styles))assert.ok(M.forTradition(style).every(p=>M.patterns.includes(p)));
});
test('puzzle mosaics ignore decorative shapes, figures and patterns; frescoes never use mosaic layouts',()=>{
  const clue={...base,puzzleClue:true,clueStyle:'floor_mosaic',surface:'floor',pairs:[{mark:'Dragon',option:'Moon'},{mark:'Skull',option:'Sun'}]};
  const original=render(clue).toBuffer(),api=isolatedArt({'./mosaicDesigns':{...M,paint:()=>assert.fail('Wrong renderer')}});
  for(const mosaicShape of M.shapes)assert.deepEqual(render({...clue,mosaicShape,mosaicPattern:'spiral_shield'},api).toBuffer(),original);
  assert.deepEqual(Art.rasterSize(clue),{width:144,height:96});
  const fresco={...base,kind:'fresco',scene:'ancestral_court',aspectRatio:2};
  assert.deepEqual(render(fresco,api).toBuffer(),render(fresco).toBuffer());
  const {designPrompt}=require('../retort/physicalPuzzleDesign'),prompt=designPrompt({roomName:'Temple',seed:'patterns'});
  assert.match(prompt,/OWN composition templates/);assert.match(prompt,/guilloche_emblems/);assert.match(prompt,/mosaicShape/);
});
