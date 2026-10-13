'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createCanvas}=require('canvas'),Scripts=require('../assets/ancientScripts'),P=require('../assets/physicalPuzzles');
const Art=require('../assets/surfaceArt'),Carvings=require('../assets/stoneCarvings'),Voxels=require('../assets/scenePropVoxels'),Symbols=require('../assets/puzzleModules');
const {wallFaces,mountWall}=require('../retort/surfaceArtPlacement');
const palette={primary:'#67564a',secondary:'#594c42',highlight:'#a08c78',shadow:'#312922'};
function room(){const d={layout:{width:24,height:24},start:{x:12,y:12},cells:{},tiles:{},sceneObjects:[]};
  for(let y=0;y<24;y++)for(let x=0;x<24;x++)d.cells[`${x},${y}`]={tile:!x||!y||x===23||y===23?'wall':'floor',floorHeight:0,ceilHeight:4};return d;}
function artwork(){return{kind:'relief',surface:'wall',format:'mural',label:'The Ancient Vigil',motifs:['Mortacia','Dragon'],
  carvingStyle:'acanthus',carvingBorder:'meander',carvingDepth:'incised',axis:'y',sign:-1,
  position:{x:4,y:22.99,z:.55},size:{x:5.8,y:.08,z:.65},tile:'carving'};}
test('four fictional scripts have distinct stable alphabets and detached bounded descriptors',()=>{
  const alphabets=new Set();
  for(const style of Scripts.styles){const glyphs=[...Scripts.alphabet].map(c=>Scripts.glyph(c,style));
    assert.equal(new Set(glyphs.map(g=>g.join(''))).size,36);alphabets.add(JSON.stringify(glyphs));
    for(const g of glyphs){assert.equal(g.length,9);assert.ok(g.every(r=>/^[01]{7}$/.test(r)));}
    const first=Scripts.glyph('A',style);first[0]='changed';assert.notDeepEqual(first,Scripts.glyph('A',style));
  }
  assert.equal(alphabets.size,4);assert.ok(Scripts.glyph('?').every(r=>r==='0000000'));
  const raw={text:'The watch endures.',heading:'The Vigil',seed:'vigil'},before=JSON.stringify(raw);
  assert.deepEqual(Scripts.describe(raw),Scripts.describe(raw));assert.equal(JSON.stringify(raw),before);
  assert.equal(Scripts.describe({text:'x'.repeat(3000)}).text.length,1600);
  assert.notEqual(Scripts.describe({text:'x'.repeat(1599)+'a'}).key,Scripts.describe({text:'x'.repeat(1599)+'b'}).key);
});
test('engraved reference glyphs remain canonical, deterministic and unaffected by border wear',()=>{
  const pairs=[{mark:'Sun',option:'Moon'},{mark:'Dragon',option:'Wave'}],raw={heading:'The Vigil',text:'The watch endures.',seed:'vigil',style:'draconic'};
  const raster=Scripts.raster(raw,pairs);assert.equal(raster.cuts.length,96*112);assert.deepEqual(raster,Scripts.raster(raw,pairs));
  assert.ok(raster.cuts.every(v=>v>=0&&v<=1));
  for(const[i,pair]of pairs.entries())for(const[name,x]of[[pair.mark,15],[pair.option,66]]){
    const grid=Symbols.bitmap(name);for(let y=0;y<12;y++)for(let xx=0;xx<12;xx++)
      assert.equal(raster.cuts[x+xx+(37+i*13+y)*96],grid[Math.floor(y*grid.length/12)][Math.floor(xx*grid.length/12)]==='1'?1:0);
  }
  const gallery=createCanvas(384,448),ctx=gallery.getContext('2d');
  for(const[style,i]of Scripts.styles.entries()){
    const c=createCanvas(192,224);Scripts.paint(c.getContext('2d'),{...raw,style},palette,pairs,[],createCanvas);
    ctx.drawImage(c,(i%2)*192,Math.floor(i/2)*224);
    assert.notDeepEqual(Scripts.image({...raw,style}).data,Scripts.image({...raw,style,text:'Different words'}).data);
  }
  if(process.env.HOLODEK_ART_PREVIEW==='1'){const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'ancient-scripts.png'),gallery.toBuffer());}
});
test('both engraved plaque faces have real incisions, finite normals and safe index budgets on either axis',()=>{
  const raw={text:'The ancient covenant endures.'};
  for(const axis of['x','y'])for(const sign of[-1,1]){
    const mesh=Scripts.mesh(raw,palette,[],[],axis,sign),depths=new Set();assert.equal(mesh.vertices.length/9,43008);
    assert.ok(mesh.vertices.every(Number.isFinite));assert.ok(mesh.indices.every(i=>i<43008));
    const grid=Voxels.build('puzzle_plaque',32,'vigil',{axis});
    for(let i=0;i<mesh.vertices.length;i+=9){const p=Array.from(mesh.vertices.subarray(i,i+3)),n=Array.from(mesh.vertices.subarray(i+3,i+6));
      assert.ok(Math.abs(Math.hypot(...n)-1)<.000001);assert.ok(n[axis==='x'?0:1]*sign>0);
      const d=p[axis==='x'?0:1];depths.add(d);assert.ok(sign<0?d>=.3699&&d<=.3981:d>=.6019&&d<=.6301);
      const tangent=p[axis==='x'?1:0];
      if(tangent>.24&&tangent<.76&&p[2]>.46&&p[2]<.86){
        const [x,y,z]=p.map(v=>Math.floor(v*32));assert.equal(grid[x+y*32+z*32*32],0,'The voxel core must stay behind the recessed panel');
      }
    }assert.ok(depths.size>3);
  }
});
test('saved plaques derive complete verified clues without changing puzzle IDs, state or reading text',()=>{
  const seen=new Set();for(let i=0;i<128;i++){
    const p=P.fallback('engraving-'+i,'Temple');if(seen.has(p.kind))continue;seen.add(p.kind);
    const d=room();P.install(d,{puzzleMechanism:p});const plaque=d.physicalPuzzle.fixtures.find(f=>f.id==='plaque'),before=JSON.stringify(d);
    const spec=P.visualSpec(d,plaque.tiles[0]);assert.equal(spec.puzzleFace.engraving.text,P.clue(p));assert.equal(spec.puzzleFace.engraving.seed,p.id);
    const pairs=['sequence','harmonics'].includes(p.kind)?p.order.map(id=>({mark:p.controls.find(c=>c.id===id).mark,option:''})):
      p.controls.map(c=>({mark:c.mark,option:c.options[c.goal]}));assert.deepEqual(spec.puzzleFace.engravingPairs,pairs);
    assert.equal(JSON.stringify(d),before);assert.equal(P.compile(d.physicalPuzzle.definition).id,p.id);
  }assert.equal(seen.size,7);
});
test('only duplicate freestanding diagram overlays are replaced; clicking still reads the plaque',()=>{
  const d=room();P.install(d,{puzzleMechanism:P.fallback('overlay','Temple')});const f=d.physicalPuzzle.fixtures.find(f=>f.id==='plaque');
  const [x,y]=f.key.split(',').map(Number),a={...artwork(),puzzleClue:true,surface:'object',key:f.key,position:{x:x+.3,y:y+.3,z:.4},size:{x:.1,y:.4,z:.5}};
  assert.equal(Scripts.replacesClueOverlay(d,a),true);
  for(const row of[{...a,surface:'wall'},{...a,surface:'floor'},{...a,key:'other'},{...a,puzzleClue:false}])assert.equal(Scripts.replacesClueOverlay(d,row),false);
  assert.equal(Scripts.replacesClueOverlay({},a),false);
  const sandbox={AncientScripts:Scripts,PhysicalPuzzles:P,module:{exports:{}}};vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/worldInteractionUi.js'),'utf8'),sandbox);
  d.surfaceArt=[a];const camera={x:x-1,y:y+.5,eyeZ:.65,dirX:1,dirY:0,planeScale:.577,verticalScale:1};
  const picked=sandbox.module.exports.pick(d,camera,camera,.5,.5);assert.equal(picked?.type,'puzzle');assert.equal(picked?.label,'instruction plaque');
  assert.equal(picked.command,'read instruction plaque');assert.equal(picked.detail,P.clue(d.physicalPuzzle.definition));
});
test('stonework has proportioned connected modules with finished ends, distinct pixels and no mutation',()=>{
  const a=artwork(),before=JSON.stringify(a),modules=Carvings.modules(a);assert.ok(modules.length>3&&modules.length<=8);
  assert.equal(JSON.stringify(a),before);assert.equal(modules[0].segmentRole,'start');assert.equal(modules.at(-1).segmentRole,'end');
  for(const[i,m]of modules.entries()){
    assert.ok(Math.abs(m.size.x/m.size.z-1.5)<.2);assert.equal(m.position.z,a.position.z);
    if(i)assert.ok(Math.abs(modules[i-1].position.x+modules[i-1].size.x-m.position.x)<1e-8);
  }
  assert.ok(Math.abs(modules.at(-1).position.x+modules.at(-1).size.x-a.position.x-a.size.x)<1e-8);
  const images=new Set(modules.map(m=>{const c=createCanvas(144,96);Art.paint(c.getContext('2d'),createCanvas,m,palette);return c.toBuffer().toString('base64');}));
  assert.equal(images.size,3);
  for(const row of[{...a,kind:'fresco',carvingStyle:undefined},{...a,puzzleClue:true},{...a,surface:'floor'}])assert.deepEqual(Carvings.modules(row),[row]);
  assert.equal(Carvings.modules({...a,size:{x:100,y:.08,z:.1}}).length,8);
  const rotated={...a,axis:'x',position:{x:22.99,y:4,z:.55},size:{x:.08,y:5.8,z:.65}};
  assert.equal(Carvings.modules(rotated).length,modules.length);
});
test('stonework palette matches room masonry samples without inheriting mortar or pigment extremes',()=>{
  const data=new Uint8ClampedArray(100*4);
  for(let i=0;i<100;i++)data.set(i<20?[0,0,0,255]:i>=80?[255,255,255,255]:[90,70,55,255],i*4);
  const p=Carvings.palette(palette,{data});assert.equal(p.primary,'#5a4637');assert.notEqual(p.shadow,p.highlight);
  assert.equal(Carvings.palette({primary:'#335577'}).primary,'#335577');assert.equal(Carvings.palette({primary:'bad'}).primary,'#67564a');
  const before=JSON.stringify(palette);Carvings.palette(palette,{data});assert.equal(JSON.stringify(palette),before);
});
test('new indoor bands share a coherent pattern, role and safe mounting height',()=>{
  const d=room(),candidates=Object.entries(d.cells).filter(([,c])=>c.tile==='floor').map(([key])=>{const[x,y]=key.split(',').map(Number);return{key,x,y,d:Math.hypot(x-12,y-12)};});
  for(const[name,role]of[['Ruined Temple Entrance','dado'],['Royal Palace','cornice'],['Ancient Crypt','skirting']]){
    const rows=Art.plan({indoor:true,source:{roomName:name,description:'Ancient stone architecture.'}}).filter(a=>a.carvingStyle&&a.surface==='wall');
    assert.equal(rows.length,3);assert.equal(new Set(rows.map(a=>a.carvingStyle+'|'+a.carvingBorder)).size,1);assert.ok(rows.every(a=>a.stoneworkRole===role));
    const used=new Set(),groups=new Map(),centers=[];for(const row of rows){const m=mountWall(wallFaces(d,candidates),row,used,groups,centers);
      assert.ok(m?.viewPoint);assert.ok(m.position.z>=0&&m.position.z+m.size.z<4);m.keys.forEach(k=>used.add(k));
      assert.ok(role==='cornice'?m.position.z>3:role==='skirting'?m.position.z<.3:m.position.z>=.5);
    }
  }
});
