const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createCanvas}=require('canvas'),Art=require('../assets/surfaceArt'),Figures=require('../assets/frescoFigures'),S=require('../assets/sculptureForms'),A=require('../assets/sculptureAnatomy');
const Carvings=require('../assets/stoneCarvings'),Lamps=require('../assets/artPresentation'),P=require('../assets/physicalPuzzles'),R=require('../assets/readableItems'),C=require('../assets/renderCharacterProcedural');
const {wallFaces,mountWall,visible}=require('../retort/surfaceArtPlacement'),{designPrompt,generateDesign}=require('../retort/physicalPuzzleDesign');
const pal={primary:'#c9c1b1',secondary:'#ada48b',highlight:'#eee4d0',shadow:'#655f52'};
const save=(name,canvas)=>{if(process.env.HOLODEK_ART_PREVIEW==='1'){const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name+'.png'),canvas.toBuffer());}};
function room(){const d={layout:{width:24,height:24},start:{x:12,y:12},cells:{},tiles:{},sceneObjects:[]};
  for(let y=0;y<24;y++)for(let x=0;x<24;x++)d.cells[`${x},${y}`]={tile:!x||!y||x===23||y===23?'wall':'floor',floorHeight:0,ceilHeight:4};return d;}
const candidates=d=>Object.entries(d.cells).filter(([,c])=>c.tile==='floor').map(([key])=>{const[x,y]=key.split(',').map(Number);return{key,x,y,d:Math.hypot(x-12,y-12)};});
test('wall murals require a clear five-point viewing witness and reject pillar-obscured strips',()=>{
  const d=room();d.tiles.pillar={spriteSpec:{baseWidth:.95}};for(let x=1;x<23;x++)d.cells[`${x},2`].tile='pillar';
  const row={kind:'fresco',format:'mural'},mount=mountWall(wallFaces(d,candidates(d)),row,new Set());assert.ok(mount?.viewPoint);
  const p=mount.position,s=mount.size,axis=mount.axis==='x'?'y':'x';
  for(const t of[.05,.25,.5,.75,.95]){const target={x:p.x+s.x/2,y:p.y+s.y/2};target[axis]=p[axis]+s[axis]*t;target[mount.axis]+=mount.sign*.08;assert.ok(visible(d,mount.viewPoint,target));}
  const behind={x:12.5,y:3.5};assert.equal(visible(d,behind,{x:12.5,y:1.1}),false);
  const walls=wallFaces(d,candidates(d));walls.faces=walls.faces.filter(f=>f.group==='y:0:1');
  for(let x=1;x<23;x++)walls.viewKeys.delete(`${x},1`);assert.equal(mountWall(walls,row,new Set()),null);
});
test('art lamps have mounted brackets, finite bounded light records and no room-cell mutations',()=>{
  const d=room(),before=JSON.stringify(d.cells),art={tile:'painting',surface:'wall',axis:'x',sign:1,position:{x:1.01,y:5,z:.35},size:{x:.02,y:7.8,z:5.2}};
  d.artLamps=Lamps.plan(art);assert.equal(d.artLamps.length,2);assert.equal(JSON.stringify(d.cells),before);
  for(const l of d.artLamps){assert.ok(l.x>art.position.x);assert.ok(l.radius<=5&&l.intensity<=1);assert.ok(l.position.x-art.position.x<.03);}
  for(const flame of[false,true]){const mesh=Lamps.mesh(flame,'x',1);assert.ok(mesh.vertices.length>0&&mesh.indices.length>0);assert.ok(mesh.vertices.every(Number.isFinite));}
  assert.equal(Lamps.lights(d,4,5).length,2);assert.equal(Lamps.lights(d,80,80).length,0);assert.equal(Lamps.plan({...art,surface:'floor'}).length,0);
});

test('wall-art light anchors avoid the real renderer DDA corner rejection on all four orientations',()=>{
  const source=fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8'),context={window:{},console};vm.runInNewContext(source,context);
  const renderer=context.window.webglDungeonRenderer,d=room();
  const los=new Function('dungeon','isSolidCell',source.slice(source.indexOf('const hasLineOfSight ='),source.indexOf('const makeTorchUniformData ='))+'return hasLineOfSight;')
    (d,c=>['wall','torch'].includes(c.tile)||c.tile==='door'&&c.door?.isOpen===false);
  for(const axis of['x','y'])for(const sign of[-1,1]){
    const art={tile:'wall_'+axis+sign,surface:'wall',axis,sign,position:{x:8.1,y:8.1,z:.35},size:{x:7.8,y:7.8,z:2.6}};
    art.position[axis]=sign===1?1.01:22.99;art.size[axis]=.02;
    const lights=Lamps.plan(art,d).map((l,order)=>({...l,order}));assert.equal(lights.length,2);
    const byId=new Map(lights.map(l=>[`${l.x},${l.y},${l.radius}`,l])),frame={dungeon:d,stamp:art.tile,lights,byId,membership:[...byId.keys()].join('|')};
    const p=Lamps.lightAnchor(art);assert.equal(renderer.getCachedTorchLights(frame,p.x,p.y,1.5,los).length,2);
    if(sign===-1)assert.equal(renderer.getCachedTorchLights(frame,art.position.x+art.size.x/2,art.position.y+art.size.y/2,1.5,los).length,0,'Positive control must reproduce the old blackout');
  }
});

test('saved mural candles relocate only onto free backing masonry and their flame wicks stay anchored',()=>{
  const d=room(),art={tile:'test',surface:'wall',axis:'y',sign:-1,position:{x:8.1,y:22.99,z:.35},size:{x:7.8,y:.02,z:2.6}};
  d.surfaceArt=[art];d.artLamps=Lamps.plan(art).map(l=>({...l,x:12,position:{...l.position,x:11.89}}));
  const before=JSON.stringify(d),lamps=Lamps.lights(d,12,20);assert.equal(lamps.length,2);assert.equal(JSON.stringify(d),before);
  assert.ok(lamps.every(l=>l.x+.12<art.position.x||l.x-.12>art.position.x+art.size.x));
  for(const l of lamps){const a=Lamps.flamePose(l,.75),b=Lamps.flamePose(l,1.2);assert.notEqual(a.size.z,b.size.z);
    assert.ok(Math.abs(a.position.z+.76*a.size.z-(b.position.z+.76*b.size.z))<1e-9);assert.ok(Math.abs(a.position.x-b.position.x)<.02);}
  d.cells['7,23'].tile='floor';assert.equal(Lamps.lights(d,12,20).length,1,'Never hang candles in empty space');
  d.surfaceArt.push({...art,tile:'neighbor',position:{x:16,y:22.99,z:.35},size:{x:1,y:.02,z:2}});
  assert.equal(Lamps.lights(d,12,20).filter(l=>l.id.startsWith('test:')).length,0,'Never cover an adjacent artwork');
});

test('nearby mosaics recover missing saved sconces before the bounded frame allocation',()=>{
  const d=room();
  d.surfaceArt=Array.from({length:18},(_,i)=>({tile:'art_'+i,kind:i===17?'mosaic':'fresco',surface:'wall',axis:'y',sign:-1,
    position:{x:1.1+i*1.2,y:22.99,z:.35},size:{x:.4,y:.02,z:1}}));
  d.artLamps=d.surfaceArt.flatMap(a=>Lamps.plan(a,d)).slice(0,14);
  assert.equal(d.artLamps.length,14);assert.ok(!d.artLamps.some(l=>l.id.startsWith('art_17:')));
  const before=JSON.stringify(d),lights=Lamps.lights(d,22,21,30);
  assert.equal(lights.length,14,'Keep the existing per-frame budget');
  assert.equal(lights[0].id,'art_17:lamp:0','The nearby mosaic is not starved by distant frescoes');
  assert.ok(!lights.some(l=>l.id==='art_0:lamp:0'));
  assert.ok(lights.every((l,i)=>!i||l.dist2>=lights[i-1].dist2));
  assert.equal(JSON.stringify(d),before,'Do not rewrite the saved room or add collision cells');
  d.artLamps=[];assert.equal(Lamps.lights(d,22,21,3)[0].id,'art_17:lamp:0','Missing lamp metadata also recovers');
  d.surfaceArt[17].surface='floor';assert.ok(!Lamps.lights(d,22,21,30).some(l=>l.id.startsWith('art_17:')),'Do not mount candles on floor mosaics');
});

test('floor mosaics receive bounded freestanding candlesticks outside their tesserae without changing saved geometry',()=>{
  const d=room(),art={tile:'pavement',kind:'mosaic',surface:'floor',position:{x:10.05,y:10.05,z:.01},size:{x:1.9,y:1.9,z:.02}};
  d.surfaceArt=[art];const before=JSON.stringify(d),lamps=Lamps.plan(art,d);
  assert.equal(lamps.length,2);assert.equal(JSON.stringify(d),before);
  for(const lamp of lamps){
    assert.equal(lamp.mount,'floor');assert.ok(lamp.radius<=5&&lamp.intensity<=1);
    assert.ok(lamp.x+.12<art.position.x||lamp.x-.12>art.position.x+art.size.x||lamp.y+.12<art.position.y||lamp.y-.12>art.position.y+art.size.y);
    assert.equal(d.cells[`${Math.floor(lamp.x)},${Math.floor(lamp.y)}`].tile,'floor');
    for(const flame of[false,true])assert.ok(Lamps.mesh(flame,lamp.axis,lamp.sign,lamp.mount).vertices.every(Number.isFinite));
    const a=Lamps.flamePose(lamp,.75),b=Lamps.flamePose(lamp,1.2);
    assert.ok(Math.abs(a.position.z+.76*a.size.z-(b.position.z+.76*b.size.z))<1e-9);
  }
  assert.notDeepEqual(Lamps.mesh(false,'y',-1,'floor'),Lamps.mesh(false,'y',-1),'No wall bracket on freestanding candlesticks');
  assert.equal(Lamps.lights(d,11,11).length,2,'Saved mosaics recover lighting without regeneration');
  assert.deepEqual(Lamps.plan({...art,kind:'relief'},d),[],'Do not add candles to ordinary paving or carved thresholds');
  for(const c of Object.values(d.cells))c.navigationReserved=true;
  assert.deepEqual(Lamps.plan(art,d),[],'Never put stands in reserved walking routes');
});

test('floor mosaic lighting avoids other artworks, objects, raised ledges and blocked cells',()=>{
  const d=room(),art={tile:'pavement',kind:'mosaic',surface:'floor',position:{x:10.05,y:10.05,z:.01},size:{x:1.9,y:1.9,z:.02}};
  d.surfaceArt=[art];const original=Lamps.plan(art,d);
  d.sceneObjects=original.map(l=>({x:l.x,y:l.y}));
  const moved=Lamps.plan(art,d);assert.ok(moved.every(l=>d.sceneObjects.every(o=>Math.hypot(o.x-l.x,o.y-l.y)>=.7)));
  d.sceneObjects=[];d.surfaceArt.push({...art,tile:'neighbor',position:{x:9,y:9,z:.01},size:{x:4,y:4,z:.02}});
  assert.deepEqual(Lamps.plan(art,d),[]);
  d.surfaceArt=[art];for(const c of Object.values(d.cells))c.floorHeight=2;
  assert.deepEqual(Lamps.plan(art,d),[]);
  for(const c of Object.values(d.cells)){c.floorHeight=0;c.tile='wall';}
  assert.deepEqual(Lamps.plan(art,d),[]);
});

test('floor mosaic anchors see their perimeter candlesticks through the real torch LOS selector',()=>{
  const source=fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8'),context={window:{},console};vm.runInNewContext(source,context);
  const renderer=context.window.webglDungeonRenderer,d=room();
  const art={tile:'floor-art',kind:'mosaic',surface:'floor',position:{x:10.05,y:10.05,z:.01},size:{x:1.9,y:1.9,z:.02}};d.surfaceArt=[art];
  const lights=Lamps.plan(art,d).map((l,order)=>({...l,order})),byId=new Map(lights.map(l=>[`${l.x},${l.y},${l.radius}`,l]));
  const frame={dungeon:d,stamp:'floor-mosaic',lights,byId,membership:[...byId.keys()].join('|')},p=Lamps.lightAnchor(art);
  const los=new Function('dungeon','isSolidCell',source.slice(source.indexOf('const hasLineOfSight ='),source.indexOf('const makeTorchUniformData ='))+'return hasLineOfSight;')(d,c=>['wall','torch'].includes(c.tile));
  assert.equal(renderer.getCachedTorchLights(frame,p.x,p.y,1.5,los).length,2);
});

test('indoor ornament supplements paintings, has reachable broad wall bands and safe entrance paving',()=>{
  const d=room(),rows=Art.plan({indoor:true,source:{roomName:'Ruined Temple Entrance',description:'A stone temple of Mortacia.'}});
  assert.equal(rows.filter(a=>a.kind==='fresco').length,4);assert.equal(rows.filter(a=>a.carvingStyle).length,4);
  const band=rows.find(a=>a.carvingStyle&&a.surface==='wall'),mount=mountWall(wallFaces(d,candidates(d)),band,new Set());
  assert.ok(mount.keys.length>=4&&Math.max(mount.size.x,mount.size.y)>3&&mount.size.z<=.8&&mount.viewPoint);
  assert.equal(Art.plan({indoor:false,source:{roomName:'Open Desert',description:'Bare sand.'}}).length,0);
});

test('Byzantine mosaics retain full figures, add genuine tesserae and preserve puzzle diagrams',()=>{
  const row=Art.validate([{kind:'mosaic',surface:'wall',format:'mural',label:'Mortacia and the Departed',description:'A golden sacred court.',
    motifs:['Mortacia','skeleton','wraith'],style:'byzantine',scene:'ancestral_court'}])[0];
  const c=createCanvas(144,96),p=createCanvas(144,96);Art.paint(c.getContext('2d'),createCanvas,row,pal);Art.paint(p.getContext('2d'),createCanvas,{...row,kind:'fresco'},pal);
  assert.notDeepEqual(c.toBuffer(),p.toBuffer());assert.equal(row.style,'byzantine');assert.ok(Art.mesh(c.getContext('2d').getImageData(0,0,144,96)).indices.length>0);
  const planned=Art.plan({indoor:true,source:{roomName:'Byzantine Temple',description:'A golden pendentive dome.'}});
  assert.ok(planned.some(a=>a.kind==='mosaic'&&a.surface==='floor'&&a.figures.length>0));
  save('byzantine-mosaic',c);
});
test('carving designs change actual pixels and create continuous bounded incised/raised relief',()=>{
  const hashes=new Set(),gallery=createCanvas(288*2,212*Math.ceil(Carvings.styles.length/2)),g=gallery.getContext('2d');
  Carvings.styles.forEach((style,i)=>{
    const a=Art.validate([{kind:'relief',surface:'wall',label:'The builders remember',description:'A sacred stonework panel.',motifs:['Mortacia','Dragon','Moon'],carvingStyle:style,carvingBorder:Carvings.borders[i%5],carvingDepth:i%2?'incised':'raised'}])[0];
    const c=createCanvas(144,96);Art.paint(c.getContext('2d'),createCanvas,a,pal);hashes.add(c.toBuffer().toString('base64'));
    const mesh=Art.mesh(c.getContext('2d').getImageData(0,0,144,96),'y','wall',-1,a);assert.ok(mesh.vertices.length/9<65536);assert.ok(mesh.vertices.every(Number.isFinite));
    const depths=new Set();for(let j=1;j<mesh.vertices.length;j+=9)depths.add(mesh.vertices[j]);assert.ok(depths.size>3);
    assert.ok(mesh.indices.every(v=>v<mesh.vertices.length/9));g.imageSmoothingEnabled=false;g.drawImage(c,i%2*288,Math.floor(i/2)*212,288,192);
    g.fillStyle='#e4d5b1';g.font='13px Georgia';g.fillText(style.replace(/_/g,' '),i%2*288+6,Math.floor(i/2)*212+205);
    const plain=Art.mesh(c.getContext('2d').getImageData(0,0,144,96),'y','wall',-1,{...a,puzzleClue:true});assert.ok(Array.from(plain.vertices).filter((_,i)=>i%9===1).every(v=>v===0));
  });assert.equal(hashes.size,Carvings.styles.length);save('stonework-gallery',gallery);
  assert.throws(()=>Carvings.validate({carvingStyle:'laser graffiti'}),/Invalid/);
});
test('refined statues have distinct articulated poses and retain the original sculptural path',()=>{
  const gallery=createCanvas(192*4,244*Math.ceil(S.poses.length/4)),g=gallery.getContext('2d'),hashes=new Set();
  S.poses.forEach((pose,i)=>{
    const s=S.validate([{label:'A carved ancestor',form:'human',pose,head:'bare',robe:pose==='guardian'?'armor':'toga',attribute:'none',workmanship:'carved'}])[0];
    const v=S.build(40,'refined',s);assert.equal(v.length,64000);assert.ok(v.some(Boolean));hashes.add(Buffer.from(v).toString('base64'));
    S.paintFigure(g,s,pal,{x:i%4*192,y:Math.floor(i/4)*244,width:192,height:220});g.fillStyle='#e4d5b1';g.font='13px Georgia';g.fillText(pose,i%4*192+6,Math.floor(i/4)*244+238);
  });assert.equal(hashes.size,S.poses.length);save('carved-statues',gallery);
  const base={label:'Original ancestor',form:'human',pose:'offering',head:'bare',robe:'toga',attribute:'none'};
  assert.deepEqual(S.build(24,'old',base),S.build(24,'old',{...base,workmanship:'classic'}));assert.notDeepEqual(S.build(24,'old',base),S.build(24,'old',{...base,workmanship:'carved'}));
});
test('serpentine dragons differ from the classic figures without changing live character sprites',()=>{
  const preset=JSON.stringify(C.getPresetProceduralSpec('Mortacia')),gallery=createCanvas(192*3,220*2),g=gallery.getContext('2d'),hashes=new Set();
  for(const[i,pose]of['standing','mourning','flying','ascending','seated','bowing'].entries()){
    const f={subject:'Atinus',pose,anatomy:'serpentine',proportions:'classical',facing:i%2?'left':'right',attribute:'none',robe:'pleated',head:'bare'};
    const c=createCanvas(192,192);Figures.paint(c.getContext('2d'),f,pal,{x:0,y:0,width:192,height:192},'renaissance',createCanvas);
    hashes.add(c.toBuffer().toString('base64'));g.drawImage(c,i%3*192,Math.floor(i/3)*220);g.fillStyle='#e4d5b1';g.font='13px Georgia';g.fillText(pose,i%3*192+6,Math.floor(i/3)*220+211);
  }
  assert.ok(hashes.size>=4);save('serpentine-dragons',gallery);assert.equal(JSON.stringify(C.getPresetProceduralSpec('Mortacia')),preset);
  const body=A.build(40,S.normalize({form:'dragon',pose:'guardian',wings:'membrane'}));assert.ok(body.some(Boolean));
});
test('new art metadata round-trips without rewriting old puzzle IDs or stable inscription words',()=>{
  const p=P.fallback('art-preservation','Hall');assert.equal(P.compile(JSON.parse(JSON.stringify(p))).id,p.id);
  const old=P.compile({...p,sculptures:[{label:'The old White Lady',deity:'Mortacia',pose:'offering',head:'bare',robe:'pleated',attribute:'scroll'}]});
  assert.equal(P.compile(JSON.parse(JSON.stringify(old))).id,old.id);assert.equal(old.sculptures[0].workmanship,undefined);
  const r=R.validateInscriptions([{type:'stone_tablet',name:'tablet of the vigil',title:'The Vigil',backstory:'A mason commemorated the watch.',role:'lore',text:'The watch endured.',motif:'Urthur',carvingStyle:'interlace'}])[0];
  assert.equal(r.motif,'Urthur');assert.equal(r.carvingStyle,'interlace');assert.equal(R.passage(r,{inspect:false}),'The Vigil\nThe watch endured.');
});

test('saved statue receivers get a detached refined visual without rewriting puzzle IDs or explicit classic art',()=>{
  const p=Array.from({length:64},(_,i)=>P.fallback('receiver-'+i,'Temple')).find(p=>P.receiver(p)==='statue');assert.ok(p);
  const d=room();P.install(d,{puzzleMechanism:p});const f=d.physicalPuzzle.fixtures.find(f=>f.id==='receiver'),tile=f.tiles[0];
  const before=JSON.stringify(d),spec=P.visualSpec(d,tile);assert.equal(spec.puzzleFace.sculpture.workmanship,'carved');assert.equal(JSON.stringify(d),before);
  assert.equal(P.compile(JSON.parse(JSON.stringify(d.physicalPuzzle.definition))).id,p.id);
  d.tiles[tile].spriteSpec.puzzleFace.sculpture.workmanship='classic';assert.equal(P.visualSpec(d,tile).puzzleFace.sculpture.workmanship,'classic');
});
test('seeded puzzle briefs vary first-room families and refuse repeated example-copying',async()=>{
  const kinds=new Set();for(let i=0;i<64;i++)kinds.add(P.fallback('opening-'+i,'Ruined Temple Entrance').kind);assert.equal(kinds.size,7);
  const context={seed:'rotating',roomName:'Ruined Temple Entrance',recentKinds:['alignment','alignment']},brief=P.fallback(context.seed,context.roomName,context);
  assert.notEqual(brief.kind,'alignment');assert.match(designPrompt(context),new RegExp('REQUIRES kind:"'+brief.kind+'"'));assert.ok(!designPrompt(context).includes('"label":"West dial"'));
  let calls=0;const agent={user(){},assistant:{generation:async()=>{calls++;return{content:JSON.stringify({...P.fallback('wrong','Hall'),kind:'alignment'})};}}};
  const result=await generateDesign(agent,context);assert.equal(result.kind,brief.kind);assert.equal(result.moduleKit,brief.moduleKit);assert.equal(calls,2);
});
