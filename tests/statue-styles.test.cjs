'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createCanvas}=require('canvas'),S=require('../assets/sculptureForms'),V=require('../assets/scenePropVoxels'),C=require('../assets/stoneCarvings');
const Characters=require('../assets/renderCharacterProcedural'),P=require('../assets/physicalPuzzles');
const base={label:'Ancestor of the pale court',form:'human',pose:'contrapposto',head:'bare',robe:'armor',attribute:'none',workmanship:'carved'};
const voxel=(grid,x,y,z,size=64)=>grid[Math.floor(x*size)+Math.floor(y*size)*size+Math.floor(z*size)*size**2];

test('Classical and Renaissance are distinct deterministic geometry with a bearing foot, defined head and real drapery',()=>{
  const original=S.build(64,13,base),hashes=new Set([Buffer.from(original).toString('base64')]);
  for(const sculptureStyle of S.styles){
    const spec=S.validate([{...base,sculptureStyle}])[0],grid=S.build(64,13,spec);
    hashes.add(Buffer.from(grid).toString('base64'));assert.deepEqual(grid,S.build(64,13,spec));
    assert.ok(voxel(grid,.55,.51,.145),'Bearing foot rests on the plinth');
    assert.ok(voxel(grid,.55,.51,.2),'Ankle is above the bearing foot');
    const head=grid.slice(55*64**2),oldHead=original.slice(55*64**2);
    assert.ok(head.reduce((n,v)=>n+v,0)<oldHead.reduce((n,v)=>n+v,0),'Head is better proportioned, not enlarged');
    const draped=S.build(64,13,{...spec,robe:'toga'});assert.notDeepEqual(draped,grid);
    assert.ok(draped.reduce((n,v)=>n+v,0)>grid.reduce((n,v)=>n+v,0),'Drapery is modeled volume');
  }
  assert.equal(hashes.size,3);
  assert.throws(()=>S.validate([{...base,sculptureStyle:'photo texture'}]),/Invalid sculpture/);
});

test('all existing gestures, clothes and attributes remain available in each style',()=>{
  for(const sculptureStyle of S.styles){
    const hashes=new Set();
    for(const pose of S.poses){const grid=S.build(40,2,{...base,pose,robe:'toga',sculptureStyle});
      assert.ok(grid.some(Boolean));hashes.add(Buffer.from(grid).toString('base64'));}
    assert.equal(hashes.size,S.poses.length);
    assert.notDeepEqual(S.build(48,2,{...base,attribute:'sword',sculptureStyle}),S.build(48,2,{...base,attribute:'book',sculptureStyle}));
  }
});

test('visual refinement is detached, reversible, honors classic workmanship and preserves mechanism hashes',()=>{
  const old={...base,workmanship:undefined},before=JSON.stringify(old);
  assert.ok(S.styles.includes(S.visualSpec(old).sculptureStyle));assert.equal(JSON.stringify(old),before);
  assert.deepEqual(S.build(32,4,S.visualSpec(S.visualSpec(old),false)),S.build(32,4,{...old,workmanship:'carved'}));
  assert.deepEqual(S.build(32,4,S.visualSpec(old,false)),S.build(32,4,old));
  const classic={...old,workmanship:'classic'};assert.deepEqual(S.visualSpec(classic),classic);
  const definition=P.compile({...P.fallback('statue-compatibility','Temple'),sculptures:[base]});
  const snapshot=JSON.stringify(definition);S.visualSpec(definition.sculptures[0]);
  assert.equal(JSON.stringify(definition),snapshot);assert.equal(P.compile(JSON.parse(snapshot)).id,definition.id);
});

test('canonical anatomy and Mortacia costume remain intact, with no changes to live sprites',()=>{
  const before=JSON.stringify(Characters.getPresetProceduralSpec('Mortacia'));
  for(const deity of ['Mortacia','Atinus','Atricles','Dantuea','Turthus']){
    const spec=S.normalize({...base,deity,form:undefined});
    for(const sculptureStyle of S.styles){
      const grid=S.build(48,1,{...spec,sculptureStyle});assert.ok(grid.some(Boolean));
      assert.equal(S.normalize({...spec,sculptureStyle}).form,spec.form);
      if(deity!=='Mortacia'){
        // Dragon/turtle/skeletal silhouettes keep their established anatomy.
        const unstyled=S.build(48,1,spec),withoutPlinth=g=>g.slice(Math.ceil(48*.12)*48**2);
        assert.deepEqual(withoutPlinth(grid),withoutPlinth(unstyled));
      }
    }
    if(deity==='Mortacia'){
      assert.equal(spec.hair,'blonde');assert.notEqual(spec.wings,'none');
      const grid=S.build(64,1,{...spec,sculptureStyle:'classical'});
      assert.ok(voxel(grid,.5,.43,.55),'Armor covers the abdomen');
    }
  }
  assert.equal(JSON.stringify(Characters.getPresetProceduralSpec('Mortacia')),before);
});

test('renderer caches detailed statues, restores previous geometry and keeps all architectural meshes in budget',()=>{
  const context={window:{ScenePropVoxels:V,StoneCarvings:C,SculptureForms:S},console,clearTimeout};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8'),context);
  const r=context.window.webglDungeonRenderer,uploads=[],deleted=[];
  r.gl={ARRAY_BUFFER:1,ELEMENT_ARRAY_BUFFER:2,STATIC_DRAW:3,createBuffer:()=>({}),deleteBuffer:b=>deleted.push(b),bindBuffer(){},bufferData:(target,data)=>uploads.push({target,data})};
  r.voxelMeshes={};r._requestGpuSimpleVoxelMesh=()=>null;
  const d={tiles:{statue:{spriteSpec:{voxelShape:'statue',material:'marble',sculpture:{...base,sculptureStyle:'renaissance'}}}}},before=JSON.stringify(d);
  const grid=r.buildVoxelGrid('statue',d,64),mesh=r.getVoxelMesh('statue',d);assert.equal(r.getVoxelMesh('statue',d),mesh);
  context.window.ARCHITECTURAL_CARVINGS=false;
  assert.deepEqual(r.buildVoxelGrid('statue',d,64),S.build(64,0,base));
  const fallback=r.getVoxelMesh('statue',d);assert.notEqual(fallback,mesh);assert.ok(deleted.includes(mesh.vbo));
  context.window.ARCHITECTURAL_CARVINGS=true;assert.deepEqual(r.buildVoxelGrid('statue',d,64),grid);assert.equal(JSON.stringify(d),before);
  for(const shape of C.voxelShapes){d.tiles[shape]={spriteSpec:{...(shape==='pillar'?{type:'pillar'}:{voxelShape:shape}),material:'stone'}};
    assert.ok(r.getVoxelMesh(shape,d)._debugKey.includes('size:64'));}
  for(const {target,data} of uploads){assert.ok(data.every(Number.isFinite));if(target===1)assert.ok(data.length/9<65536,'Uint16 index budget');}
});

test('statue style preview uses the same voxel builders as the game',()=>{
  if(!process.env.HOLODEK_ART_PREVIEW)return;
  const rows=[{...base,robe:'toga',pose:'contrapposto'},
    {...base,robe:'mantle',pose:'orator',attribute:'scroll'},
    {...base,robe:'toga',pose:'mantled_scholar',attribute:'book'},
    {...base,deity:'Mortacia',attribute:'sword',pose:'guardian'},
    {...base,deity:'Atricles',form:'dragon'},
    {...base,deity:'Turthus',form:'dragon'}];
  const canvas=createCanvas(840,rows.length*256+50),g=canvas.getContext('2d');
  g.fillStyle='#202326';g.fillRect(0,0,canvas.width,canvas.height);g.font='19px Georgia';g.fillStyle='#ebd6ac';
  for(const [i,label]of ['Previous','Classical','Renaissance'].entries())g.fillText(label,i*280+18,30);
  rows.forEach((raw,row)=>['previous',...S.styles].forEach((style,col)=>{
    const spec=style==='previous'?raw:{...raw,sculptureStyle:style};
    S.paintFigure(g,spec,{primary:'#c6bda9'},{x:col*280+10,y:row*256+48,width:260,height:226});
    g.fillStyle='#ebd6ac';g.font='15px Georgia';g.fillText(raw.deity||raw.pose,col*280+14,row*256+293);
  }));
  fs.mkdirSync('logs/probes',{recursive:true});fs.writeFileSync('logs/probes/statue-styles-preview.png',canvas.toBuffer());
});
