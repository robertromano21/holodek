'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const V=require('../assets/scenePropVoxels'),C=require('../assets/stoneCarvings'),S=require('../assets/sculptureForms'),Collision=require('../assets/voxelCollision');
const {applyArchitecturalStonework}=require('../retort/architecturalStonework');
const descriptor=(shape,pattern)=>({version:1,region:C.voxelRegions[shape],pattern});
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const d={generation:{seed:'selective-geometry'},tiles:{column:{url:'/old-column.png',spriteSpec:{voxelShape:'corinthian_column',material:'marble',baseWidth:.85}},
    pediment:{url:'/old-stone.png',spriteSpec:{voxelShape:'pediment',material:'stone'}},plain:{spriteSpec:{voxelShape:'doric_column',material:'stone'}}},cells:{},sceneStructures:[]};
  for(let i=0;i<9;i++)d.cells[`${i},0`]={tile:'column',architectureRole:'roof-support',floorHeight:0,ceilHeight:5,structureHeight:5};
  d.cells['0,1']={tile:'plain',floorHeight:0,ceilHeight:3};
  for(let i=0;i<6;i++)d.sceneStructures.push({tile:'pediment',shape:'pediment',position:{x:i,y:0,z:5},size:{x:3,y:.6,z:1},role:'pediment'});
  return d;
}
test('architectural carving actually removes shallow occupied voxels, preserves solid backing, and never changes plain geometry',()=>{
  for(const shape of C.voxelShapes.filter(s=>s!=='pillar')){
    const plain=V.build(shape,64),before=new Uint8Array(plain),hashes=new Set();
    for(const pattern of C.voxelPatterns){
      const meta=descriptor(shape,pattern),carved=V.build(shape,64,0,{stoneCarving:meta});hashes.add(Buffer.from(carved).toString('base64'));
      let removed=0;
      for(let i=0;i<plain.length;i++){
        assert.ok(carved[i]<=plain[i],'Carving is subtraction, not a painted face or an enlarged pillar');
        if(plain[i]&&!carved[i]){
          removed++;const z=Math.floor(i/64**2)/64;
          if(meta.region==='base')assert.ok(z<.19);
          else if(meta.region==='pediment')assert.ok(z>=.15&&z<.85);
        }
      }
      assert.ok(removed>=0&&removed<plain.reduce((n,v)=>n+v,0)*.04,shape+': safe subtraction budget');assert.deepEqual(plain,before);
      assert.deepEqual(carved,V.build(shape,64,0,{stoneCarving:clone(meta)}));
      assert.deepEqual(V.build(shape,64,0,{stoneCarving:null}),plain);
    }
    assert.ok(hashes.size>=2,shape+': distinct geometrical patterns');
    const automatic=V.build(shape,64,0,{stoneCarving:C.resolveVoxelDescriptor({voxelShape:shape})});
    assert.notDeepEqual(automatic,plain,shape+': automatic ornament must actually carve stone');
  }
  assert.equal(C.voxelDescriptor({version:1,pattern:'rosette',region:'base'},'timber_post'),null);
  assert.equal(C.voxelDescriptor({version:1,pattern:'unbuilt',region:'base'},'ionic_column'),null);
  assert.deepEqual(V.build('ionic_column',16),V.build('ionic_column',16,0,{detail:{skin:'carving'}}));
});
test('all compatible instances get shared variant geometry, with unchanged positions, materials, dimensions and collision',()=>{
  const d=fixture(),before=clone(d),report=applyArchitecturalStonework(d);
  assert.equal(report.columns.length,9);assert.equal(report.structures.length,6);
  assert.equal(new Set(Object.values(d.cells).map(c=>c.tile)).size,2,'Repeated pillars share one mesh');
  assert.equal(d.cells['0,1'].tile,'plain','Existing non-support cells retain their tile identifiers; the renderer adds detail');
  for(const [key,c]of Object.entries(d.cells)){
    assert.deepEqual({...c,tile:before.cells[key].tile},before.cells[key]);
    if(c.tile!==before.cells[key].tile){const original=before.tiles[before.cells[key].tile],variant=d.tiles[c.tile];
      assert.equal(variant.url,original.url);assert.deepEqual({...variant.spriteSpec,stoneCarving:undefined,uncarvedTile:undefined},
        {...original.spriteSpec,stoneCarving:undefined,uncarvedTile:undefined});}
    const [x,y]=key.split(',').map(Number);
    for(const delta of[.15,.3,.5,.7,.85])assert.deepEqual(Collision.testCell(d,x,y,x+delta,y+.5),Collision.testCell(before,x,y,x+delta,y+.5));
  }
  d.sceneStructures.forEach((p,i)=>assert.deepEqual({...p,tile:before.sceneStructures[i].tile},before.sceneStructures[i]));
  const snapshot=clone(d);assert.equal(applyArchitecturalStonework(d),report);assert.deepEqual(d,snapshot);
  const same=fixture();applyArchitecturalStonework(same);assert.deepEqual(same,d);
  const disabled=fixture(),original=clone(disabled);applyArchitecturalStonework(disabled,{architecturalCarvings:false});assert.deepEqual(disabled,original);
  const solitary=fixture();solitary.cells={'0,0':solitary.cells['0,0']};solitary.sceneStructures=solitary.sceneStructures.slice(0,1);
  const r=applyArchitecturalStonework(solitary);assert.equal(r.columns.length+r.structures.length,2,'A single eligible piece also receives detail');
});
test('new roof construction selects carvings, while saved roofs and existing architecture stay untouched',()=>{
  const {buildSceneSpec}=require('../retort/sceneSpec'),{applySceneArchitecture}=require('../retort/sceneArchitecture'),{applySceneRoofs}=require('../retort/sceneRoofs');
  const spec=buildSceneSpec({roomName:'Roman Temple',description:'Inside a Roman temple, Corinthian columns support a coffered ceiling and a pedimented shrine beside an open courtyard.'});
  const d={layout:{width:32,height:32},start:{x:16,y:26},cells:{},tiles:{wall:{url:'/wall.png'},pillar:{url:'/pillar.png'}}};
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)d.cells[`${x},${y}`]={tile:x&&y&&x<31&&y<31?'floor':'wall',floorHeight:0,ceilHeight:3};
  applySceneArchitecture(d,spec);applySceneRoofs(d,spec);
  assert.equal(d.architecturalStonework.status,'built');assert.ok(d.architecturalStonework.columns.length>3);
  for(const cell of Object.values(d.cells).filter(c=>c.architectureRole==='roof-support'))assert.ok(!C.resolveVoxelDescriptor(d.tiles[cell.tile]?.spriteSpec,cell.tile)||d.tiles[cell.tile]?.spriteSpec?.stoneCarving);
  for(const part of d.sceneStructures)assert.ok(!C.resolveVoxelDescriptor(d.tiles[part.tile]?.spriteSpec,part.tile)||d.tiles[part.tile]?.spriteSpec?.stoneCarving);
  const snapshot=JSON.stringify(d);applySceneRoofs(d,spec);assert.equal(JSON.stringify(d),snapshot);
});
function renderer(){
  const context={window:{ScenePropVoxels:V,StoneCarvings:C,SculptureForms:S},console,clearTimeout};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8'),context);
  const r=context.window.webglDungeonRenderer,deleted=[],uploads=[];
  r.gl={ARRAY_BUFFER:1,ELEMENT_ARRAY_BUFFER:2,STATIC_DRAW:3,createBuffer:()=>({}),deleteBuffer:b=>deleted.push(b),bindBuffer(){},bufferData:(target,data)=>uploads.push({target,data})};
  r.voxelMeshes={};r._requestGpuSimpleVoxelMesh=()=>null;return{r,context,deleted,uploads};
}
test('renderer toggling restores byte-identical original grids and rebuilds only changed meshes within the index budget',()=>{
  const {r,context,deleted,uploads}=renderer(),d=fixture();applyArchitecturalStonework(d);
  const tile=d.architecturalStonework.columns[0].tile,meta=d.tiles[tile].spriteSpec,before=JSON.stringify(d);
  const carved=r.buildVoxelGrid(tile,d,64);assert.notDeepEqual(carved,V.build(meta.voxelShape,64));
  d.tiles.wood={spriteSpec:{voxelShape:'timber_post',material:'wood'}};
  const unchanged=JSON.stringify(d),plainMesh=r.getVoxelMesh('wood',d),mesh=r.getVoxelMesh(tile,d);assert.ok(mesh._debugKey.includes('size:64'));assert.equal(mesh.passes.length,2);
  for(const u of uploads.filter(u=>u.target===1)){assert.ok(u.data.length/9<65536);assert.ok(u.data.every(Number.isFinite));}
  context.window.ARCHITECTURAL_CARVINGS=false;
  assert.deepEqual(r.buildVoxelGrid(tile,d,16),V.build(meta.voxelShape,16));
  const fallback=r.getVoxelMesh(tile,d);assert.ok(fallback._debugKey.includes('size:16'));assert.ok(fallback.passes);assert.ok(deleted.includes(mesh.vbo));
  assert.equal(r.getVoxelMesh('wood',d),plainMesh,'Incompatible pieces stay cached');
  context.window.ARCHITECTURAL_CARVINGS=true;const restored=r.getVoxelMesh(tile,d);assert.ok(restored._debugKey.includes('size:64'));
  assert.deepEqual(r.buildVoxelGrid(tile,d,64),carved);assert.equal(JSON.stringify(d),unchanged);
});

test('untagged saved architecture receives render-only detail and excludes uncarvable materials, inscriptions and controls',()=>{
  const {r,context}=renderer(),d=fixture();d.tiles.pillar={spriteSpec:{type:'pillar',material:'granite'}};
  const before=JSON.stringify(d);assert.ok(r.getVoxelMesh('column',d)._debugKey.includes('size:64'));
  const carved=r.buildVoxelGrid('pillar',d,64);context.window.ARCHITECTURAL_CARVINGS=false;
  const plain=r.buildVoxelGrid('pillar',d,64);assert.notDeepEqual(carved,plain);
  assert.equal(JSON.stringify(d),before);
  assert.ok(C.resolveVoxelDescriptor({voxelShape:'ionic_column',material:'wood'}),'Wooden architecture can also carry carvings');
  for(const spec of[{voxelShape:'ionic_column',material:'metal'},{voxelShape:'pediment',inscription:{}},
    {voxelShape:'pediment',puzzleFace:{}},{voxelShape:'pediment',stoneCarving:false},{voxelShape:'boulder'},
    {voxelShape:'statue'},{voxelShape:'squinch_transition'}])assert.equal(C.resolveVoxelDescriptor(spec),null);
});

test('detailed meshes cover every exposed voxel boundary without inset-face cracks or hollowing the ridges',()=>{
  const {r}=renderer(),size=32,at=(x,y,z)=>x+y*size+z*size**2;
  const surface=mesh=>{
    const faces=new Set();
    for(let i=0;i<mesh.vertices.length;i+=36){
      const v=mesh.vertices,n=v.slice(i+3,i+6),axis=n.findIndex(v=>Math.abs(v)>.5),a=(axis+1)%3,b=(axis+2)%3;
      const corners=[0,9,18,27].map(offset=>v.slice(i+offset,i+offset+3).map(p=>Math.round(p*size)));
      for(let u=Math.min(...corners.map(p=>p[a]));u<Math.max(...corners.map(p=>p[a]));u++)
        for(let w=Math.min(...corners.map(p=>p[b]));w<Math.max(...corners.map(p=>p[b]));w++)faces.add([axis,n[axis],corners[0][axis],u,w].join(','));
    }
    return faces;
  };
  for(const shape of ['fluted_column','corinthian_column','pediment']){
    const grid=V.build(shape,size,0,{stoneCarving:C.resolveVoxelDescriptor({voxelShape:shape})}),expected=new Set();
    for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(grid[at(x,y,z)]){
      const p=[x,y,z];for(let axis=0;axis<3;axis++)for(const sign of[-1,1]){
        const q=p.slice();q[axis]+=sign;
        if(q.every(v=>v>=0&&v<size)&&grid[at(...q)])continue;
        expected.add([axis,sign,p[axis]+(sign>0?1:0),p[(axis+1)%3],p[(axis+2)%3]].join(','));
      }
    }
    assert.deepEqual(surface(r.greedyMesh(grid,size,[1,1,1],{closedSurface:true})),expected,shape);
    assert.notDeepEqual(surface(r.greedyMesh(grid,size,[1,1,1])),expected,'Positive control reproduces the old inset-face gap');
    if(shape.includes('column'))for(let z=Math.ceil(size*.22);z<Math.floor(size*.72);z++)
      assert.ok(grid[at(size/2,size/2,z)],'Fluted shafts retain a continuous solid core');
  }
});

test('a distant occupied voxel across an air gap cannot count as solid backing for a carving',()=>{
  const size=64,grid=new Uint8Array(size**3);
  for(let z=0;z<size;z++)for(let x=0;x<size;x++)for(const y of[8,11])grid[x+y*size+z*size**2]=1;
  for(const pattern of C.voxelPatterns)assert.deepEqual(C.carveVoxels(grid,size,descriptor('entablature',pattern),'entablature'),grid);
});

test('half repair interpolates face positions and seam padding, without changing voxels or normals',()=>{
  const {r}=renderer(),size=32;
  for(const shape of ['fluted_column','corinthian_column','pediment']){
    const grid=V.build(shape,size,0,{stoneCarving:C.resolveVoxelDescriptor({voxelShape:shape})}),before=new Uint8Array(grid);
    const old=r.greedyMesh(grid,size,[1,1,1],{closedSurface:0,seamPad:.08}),
      half=r.greedyMesh(grid,size,[1,1,1],{closedSurface:.5,seamPad:.08}),
      full=r.greedyMesh(grid,size,[1,1,1],{closedSurface:1,seamPad:.08});
    assert.deepEqual(half.indices,old.indices);assert.deepEqual(full.indices,old.indices);
    let changed=0;
    for(let i=0;i<half.vertices.length;i++){
      assert.ok(Math.abs(half.vertices[i]-(old.vertices[i]+full.vertices[i])/2)<1e-10,shape+': exact halfway mesh');
      if(i%9>=3)assert.equal(half.vertices[i],old.vertices[i],'Normals and constant color are unchanged');
      if(half.vertices[i]!==old.vertices[i])changed++;
    }
    assert.ok(changed>0);assert.deepEqual(grid,before);
    assert.deepEqual(r.greedyMesh(grid,size,[1,1,1],{closedSurface:true,seamPad:.08}),full);
    assert.deepEqual(r.greedyMesh(grid,size,[1,1,1],{closedSurface:5,seamPad:.08}),full,
      'Over-100% must never move the sealed backing or incision faces');
    assert.deepEqual(r.greedyMesh(grid,size,[1,1,1],{closedSurface:-1,seamPad:.08}),old);
  }
});

test('over-100% extends supported ridge tops and side walls, continuously, not the incision backing',()=>{
  const size=32,source=new Uint8Array(size**3).fill(1),carved=new Uint8Array(source),at=(x,y,z)=>x+y*size+z*size**2;
  for(let z=8;z<24;z++)for(let y=8;y<24;y++)if(y%4===0)carved[at(0,y,z)]=0;
  const before=new Uint8Array(carved),meshes=[.5,1,2,4].map(depth=>C.ridgeMesh(source,carved,size,depth,[1,1,1]));
  for(let m=0;m<meshes.length;m++){
    const mesh=meshes[m],depth=[.5,1,2,4][m];assert.ok(mesh.ridgeCount>0);assert.deepEqual(mesh.indices,meshes[0].indices);
    let tops=0,walls=0;
    for(let i=0;i<mesh.vertices.length;i+=9){
      const v=mesh.vertices;assert.ok(v[i]<=.008/size+1e-10,'Added geometry remains outside the original face');
      if(v[i+3]===-1){assert.equal(v[i],-depth/size);tops++;}
      else{assert.ok(v[i+4]||v[i+5]);walls++;}
    }
    assert.ok(tops&&walls,'Every raised region includes top and connecting wall faces');
    assert.ok(mesh.vertices.every(Number.isFinite));
  }
  assert.deepEqual(carved,before);assert.ok(source.every(v=>v===1));
  assert.equal(C.ridgeMesh(source,carved,size,0,[1,1,1]).vertices.length,0);
  assert.deepEqual(C.ridgeMesh(source,carved,size,5,[1,1,1]),meshes[3]);
});

test('relief raises the complete uncut field, not a narrow halo following the carved lines',()=>{
  const size=32,source=new Uint8Array(size**3).fill(1),carved=new Uint8Array(source),at=(x,y,z)=>x+y*size+z*size**2;
  for(let z=8;z<24;z++)carved[at(15,0,z)]=0;
  const carving=descriptor('stone_tablet','interlace'),before=new Uint8Array(carved);
  for(const extension of[.5,2,4]){
    const mesh=C.ridgeMesh(source,carved,size,extension,[1,1,1],{shape:'stone_tablet',carving,inspect:true}),sites=new Set();
    for(const site of mesh.ridgeSites){
      assert.equal(site.axis,1);assert.equal(site.sign,-1);assert.equal(site.position[1],0);
      assert.equal(carved[at(...site.position)],1,'Removed carving voxels and their floors never protrude');
      sites.add(site.position.join(','));
    }
    const expected=new Set();
    for(let z=0;z<size;z++)for(let x=0;x<size;x++){
      const u=(x+.5)/size,v=((z+.5)/size-.12)/(.86-.12);
      if(u>=.12&&u<=.88&&v>=.12&&v<=.88&&carved[at(x,0,z)])expected.add([x,0,z].join(','));
    }
    assert.deepEqual(sites,expected,'The full negative space between carving lines is raised');
    assert.ok(sites.has('5,0,10'),'Uncut stone far from the incision also protrudes');
    assert.ok(!sites.has('15,0,10'),'The incision stays recessed');
    assert.ok(!sites.has('5,0,1'),'The undecorated rim is not extended');
  }
  const previous=C.ridgeMesh(source,carved,size,2,[1,1,1],{inspect:true});
  assert.ok(!previous.ridgeSites.some(s=>s.position.join(',')==='5,0,10'),'Positive control detects the old narrow-halo behavior');
  assert.deepEqual(carved,before);assert.ok(source.every(v=>v===1));
  assert.equal(C.ridgeMesh(source,source,size,2,[1,1,1],{shape:'stone_tablet',carving}).ridgeCount,0,'No relief on an uncarved field');
});

test('every carving surface keeps supported outward relief inside its field and within the draw budget',()=>{
  const{r}=renderer(),legacy={tiles:{pillar:{spriteSpec:{profile:'cylinder',heightRatio:1,gridWidth:.5}}}};
  for(const shape of C.voxelShapes){
    const source=shape==='pillar'?r.buildVoxelGrid('pillar',legacy,64,{carveArchitecture:false}):V.build(shape,64),before=new Uint8Array(source);
    for(const pattern of C.voxelPatterns){
      const carving=descriptor(shape,pattern),carved=C.carveVoxels(source,64,carving,shape),snapshot=new Uint8Array(carved);
      for(const extension of[.5,2,4]){
        const mesh=C.ridgeMesh(source,carved,64,extension,[1,1,1],{shape,carving,inspect:true}),at=p=>p.every(n=>n>=0&&n<64)?source[p[0]+p[1]*64+p[2]*4096]:0;
        const parts=mesh.parts||[mesh];
        assert.ok(parts.every(part=>part.vertices.length/9<65536&&part.indices.every(i=>i<part.vertices.length/9)),shape+': each added relief draw stays 16-bit');
        if(mesh.parts){
          assert.deepEqual(parts.flatMap(part=>part.vertices),mesh.vertices,'Chunking retains every surface vertex');
          assert.equal(parts.reduce((n,part)=>n+part.indices.length,0),mesh.indices.length);
        }
        assert.ok(mesh.vertices.every(Number.isFinite));assert.ok(mesh.indices.every(i=>i<mesh.vertices.length/9));
        assert.equal(mesh.ridgeSites.length,mesh.ridgeCount);
        for(const site of mesh.ridgeSites){
          const{position:p,axis,sign,depth}=site;assert.ok(at(p)&&carved[p[0]+p[1]*64+p[2]*4096]);
          for(let step=1;step<=Math.ceil(depth);step++){const q=p.slice();q[axis]+=sign*step;assert.equal(at(q),0,'Never fill an original recess or intersect another structural surface');}
          if(carving.region==='coffers'){
            assert.equal(axis,2);assert.equal(sign,-1);
            for(const coordinate of[p[0],p[1]]){const t=((coordinate+.5)/64*4)%1;assert.ok(t>=.34&&t<=.9,'Coffer ribs stay untouched');}
          }else{
            assert.ok((['base','panel'].includes(carving.region)?[0,1]:[1]).includes(axis));
            const u=(p[axis===0?1:0]+.5)/64,z=(p[2]+.5)/64;let low=.3,high=.68;
            if(carving.region==='base'){low=.018;high=shape==='doric_column'?.062:shape==='gothic_pier'?.095:shape==='fluted_column'?.18:.155;}
            if(carving.region==='pediment'){low=.17;high=1-Math.abs(u*2-1)-.16;}
            if(carving.region==='panel'){low=.12;high=.86;if(shape==='pointed_arch'){low=.57+(1-Math.abs(u*2-1))*.36;high=low+.055;assert.ok(u>=.17&&u<=.83);}}
            assert.ok(u>=.12&&u<=.88);assert.ok((z-low)/(high-low)>=.12&&(z-low)/(high-low)<=.88,shape+': retain bearing edges and ornament margins');
          }
        }
        assert.deepEqual(Buffer.from(carved),Buffer.from(snapshot));assert.deepEqual(Buffer.from(source),Buffer.from(before));
      }
    }
  }
});

test('column ridge extension stays in the incision band instead of raising the cornice into tabs',()=>{
  for(const shape of['doric_column','ionic_column','corinthian_column','fluted_column','gothic_pier'])for(const pattern of C.voxelPatterns){
    const source=V.build(shape,64),carving=descriptor(shape,pattern),carved=C.carveVoxels(source,64,carving,shape),
      high=shape==='doric_column'?.062:shape==='gothic_pier'?.095:shape==='fluted_column'?.18:.155;
    for(const extension of[2,4]){
      const mesh=C.ridgeMesh(source,carved,64,extension,[1,1,1],{shape,carving});
      const boundary=Math.ceil(high*64)/64+.008/64;
      for(let i=2;i<mesh.vertices.length;i+=9)assert.ok(mesh.vertices[i]<=boundary+1e-10,
        shape+': relief must not protrude into the upper rim or shaft');
      assert.ok(mesh.vertices.every(Number.isFinite));
      if(pattern===C.resolveVoxelDescriptor({voxelShape:shape}).pattern)assert.ok(mesh.ridgeCount>0,'Keep the actual ornament');
    }
  }
  const shape='ionic_column',source=V.build(shape,64),carving=C.resolveVoxelDescriptor({voxelShape:shape}),carved=C.carveVoxels(source,64,carving,shape),
    unbounded=C.ridgeMesh(source,carved,64,2,[1,1,1]);
  assert.ok(unbounded.vertices.some((v,i)=>i%9===2&&v>.155),'Positive control catches the old neighbor expansion into the cornice');
});

test('the default 300% relief and comparison settings rebuild only carved architecture, not statues or lighting',()=>{
  const {r,context,deleted}=renderer(),d=fixture();
  d.tiles.statue={spriteSpec:{voxelShape:'statue',material:'marble',sculpture:{workmanship:'carved',form:'human'}}};
  d.tiles.wood={spriteSpec:{voxelShape:'timber_post',material:'wood'}};
  const before=JSON.stringify(d),grid=r.buildVoxelGrid('column',d,64),wood=r.getVoxelMesh('wood',d),statue=r.getVoxelMesh('statue',d);
  let mesh=r.getVoxelMesh('column',d);assert.ok(mesh._debugKey.includes('closure:3'));
  const hints=m=>Object.fromEntries(Object.entries(m).filter(([k])=>!['vbo','ibo','_debugKey','passes','count'].includes(k)));
  const lighting=hints(mesh);
  for(const setting of[1,0,.5,-2,3,5,6,NaN]){
    context.window.STONEWORK_SURFACE_CLOSURE=setting;
    const next=r.getVoxelMesh('column',d),expected=Number.isFinite(setting)?Math.max(0,Math.min(5,setting)):3;
    assert.ok(next._debugKey.includes('closure:'+expected));
    if(next!==mesh)assert.ok(deleted.includes(mesh.vbo));
    assert.deepEqual(hints(next),lighting,'Material and lighting hints stay identical');
    assert.equal(next.count,mesh.count,'Base incision geometry stays intact');
    if(expected>1){assert.equal(next.passes.length,2);for(const part of next.passes)assert.deepEqual(hints(part),lighting);}
    assert.deepEqual(r.buildVoxelGrid('column',d,64),grid,'Source carvings keep the same detail');
    assert.equal(r.getVoxelMesh('statue',d),statue);assert.equal(r.getVoxelMesh('wood',d),wood);
    mesh=next;
  }
  assert.equal(JSON.stringify(d),before);
});

test('500% keeps the 100% base mesh byte-identical and draws additional supported ridges separately',()=>{
  const {r,context,uploads}=renderer(),d=fixture(),before=JSON.stringify(d);
  context.window.STONEWORK_SURFACE_CLOSURE=1;
  r.getVoxelMesh('column',d);const sealed=uploads.find(u=>u.target===1).data,mark=uploads.length;
  context.window.STONEWORK_SURFACE_CLOSURE=5;
  const raised=r.getVoxelMesh('column',d),added=uploads.slice(mark).filter(u=>u.target===1);
  assert.equal(added.length,2);assert.deepEqual(added[0].data,sealed,'The incision floor, walls, material and normals never move');
  assert.ok(added[1].data.length>0);assert.equal(raised.passes.length,2);
  for(const upload of added)assert.ok(upload.data.length/9<65536);
  assert.equal(JSON.stringify(d),before);
});

test('production relief leaves every 100% structural surface unchanged, including pillar shafts and base rims',()=>{
  const {r,context,uploads}=renderer(),d={tiles:{}};
  const meshBaseClosures=[],greedy=r.greedyMesh;
  r.greedyMesh=function(grid,size,color,opts){meshBaseClosures.push(opts.closedSurface);return greedy.call(this,grid,size,color,opts);};
  for(const shape of C.voxelShapes)for(const material of['stone','wood']){
    const tile='custom_scoped_'+shape+'_'+material;
    d.tiles[tile]={spriteSpec:shape==='pillar'?{type:'pillar',profile:'cylinder',heightRatio:1,gridWidth:.5,material}:{voxelShape:shape,material}};
    const before=JSON.stringify(d);context.window.STONEWORK_SURFACE_CLOSURE=1;
    const mark=uploads.length;r.getVoxelMesh(tile,d);const sealed=uploads.slice(mark);
    assert.equal(sealed.length,2);
    for(const relief of[3,5]){
      context.window.STONEWORK_SURFACE_CLOSURE=relief;
      const next=uploads.length,mesh=r.getVoxelMesh(tile,d),added=uploads.slice(next);
      if(C.voxelRegions[shape]==='base')assert.equal(mesh.passes?.length,2,shape+': keep relief on the actual pillar-base carving');
      assert.deepEqual(added[0].data,sealed[0].data,shape+': all base vertices, normals and colors stay at 100%');
      assert.deepEqual(added[1].data,sealed[1].data,shape+': all base indices stay at 100%');
      if(mesh.passes)assert.ok(added[2].data.length>0);
      assert.equal(JSON.stringify(d),before);
    }
  }
  assert.ok(meshBaseClosures.every(value=>value===1),'Never send the relief percentage to the structural surface mesher');
  d.tiles.plain={spriteSpec:{voxelShape:'ionic_column',material:'stone',stoneCarving:false}};
  const plain=r.getVoxelMesh('plain',d);
  for(const relief of[1,3,5]){context.window.STONEWORK_SURFACE_CLOSURE=relief;assert.equal(r.getVoxelMesh('plain',d),plain);}
});

test('live menu settings redraw paused wooden architecture, preserve wood and report the actual cached percentages',()=>{
  const {r,context,deleted}=renderer(),d={tiles:{},cells:{},sceneStructures:[]};
  for(const[slot,shape]of['doric_column','ionic_column','corinthian_column'].entries()){
    const tile='custom_structure_v6_'+shape+'_wood';d.tiles[tile]={spriteSpec:{voxelShape:shape,material:'wood',baseWidth:.85}};
    d.cells[slot+',0']={tile,architectureRole:'roof-support',floorHeight:1,ceilHeight:6,structureHeight:5};
  }
  const before=JSON.stringify(d),root=context.window;let redraws=0;
  root.currentDungeon=d;root.gamePaused=true;root.renderDungeonView=()=>{redraws++;for(const cell of Object.values(d.cells))r.getVoxelMesh(cell.tile,d);};
  root.localStorage={getItem:()=>null,setItem(){}};context.document={getElementById:()=>null,addEventListener(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/gameMenuUi'),'utf8'),context);
  for(const percent of[100,500,300]){
    root.GameMenuUi.setStoneworkClosure(percent/100);assert.equal(redraws,[100,500,300].indexOf(percent)+1);
    const status=root.GameMenuUi.getStoneworkStatus();assert.equal(status.percent,percent);assert.equal(status.compatibleInstances,3);
    assert.equal(status.baseSurfacePercent,100);assert.equal(status.reliefScope,'carving-fields');assert.equal(status.carvingRegions.base,3);
    assert.deepEqual(Array.from(status.cachedPercentages),[percent]);assert.equal(Object.keys(status.excludedByMaterial).length,0);
    for(const cell of Object.values(d.cells)){
      const mesh=r.voxelMeshes[cell.tile];assert.ok(mesh._debugKey.includes('size:64'));
      assert.equal(mesh.passes?.length||1,percent>100?2:1);
    }
  }
  const oldParts=Object.values(r.voxelMeshes).flatMap(mesh=>Array.from(mesh.passes||[mesh]));
  root.GameMenuUi.setStonework(false);assert.equal(redraws,4);
  for(const part of oldParts)assert.ok(deleted.includes(part.vbo)&&deleted.includes(part.ibo));
  for(const mesh of Object.values(r.voxelMeshes))assert.ok(mesh._debugKey.includes('size:16'));
  root.GameMenuUi.setStonework(true);assert.equal(redraws,5);assert.equal(root.GameMenuUi.getStoneworkStatus().enabled,true);
  assert.deepEqual(Array.from(root.GameMenuUi.getStoneworkStatus().cachedPercentages),[300]);
  assert.equal(root.gamePaused,true);assert.equal(JSON.stringify(d),before,'No wood material or room data is changed');
  for(const spec of[{voxelShape:'timber_post',material:'wood'},{voxelShape:'corinthian_column',material:'metal'},
    {voxelShape:'corinthian_column',material:'wood',stoneCarving:false}])assert.equal(C.resolveVoxelDescriptor(spec),null);
});

test('menu fallback is reversible, persists locally, and binds once rather than once per menu opening',()=>{
  const buttons=new Map(),events=new Map(),store=new Map([['holodek.stoneworkSurfaceClosure','0']]);
  const element=id=>({id,style:{},hidden:false,offsetWidth:80,listeners:new Map(),textContent:'',setAttribute(k,v){this[k]=v;},
    addEventListener(k,f){const rows=this.listeners.get(k)||[];rows.push(f);this.listeners.set(k,rows);},getBoundingClientRect:()=>({width:80,bottom:30}),appendChild(){},focus(){},contains:()=>false});
  for(const id of['game-menu','game-menu-toggle','carved-stonework-toggle','stonework-fill-toggle'])buttons.set(id,element(id));
  const context={window:{innerWidth:900,innerHeight:700,localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},addEventListener(){}},
    document:{getElementById:id=>buttons.get(id),addEventListener:(k,f)=>events.set(k,f)}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/gameMenuUi'),'utf8'),context);events.get('DOMContentLoaded')();
  const button=buttons.get('carved-stonework-toggle');for(let i=0;i<4;i++){context.window.GameMenuUi.setOpen(true);context.window.GameMenuUi.setOpen(false);}
  assert.equal(button.listeners.get('click').length,1);
  button.listeners.get('click')[0]();assert.equal(context.window.ARCHITECTURAL_CARVINGS,false);assert.match(button.textContent,/OFF/);
  assert.equal(store.get('holodek.architecturalCarvings'),'off');button.listeners.get('click')[0]();assert.equal(context.window.ARCHITECTURAL_CARVINGS,true);
  context.window.GameMenuUi.setStonework(false);
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/gameMenuUi'),'utf8'),context);assert.equal(context.window.ARCHITECTURAL_CARVINGS,false);
  const fill=buttons.get('stonework-fill-toggle');assert.equal(fill.listeners.get('click').length,1);assert.match(fill.textContent,/Stonework Relief/);
  assert.equal(context.window.STONEWORK_SURFACE_CLOSURE,3);assert.match(fill.textContent,/300%/);
  for(const value of[5,0,.5,1,3]){
    fill.listeners.get('click')[0]();assert.equal(context.window.STONEWORK_SURFACE_CLOSURE,value);
    assert.equal(store.get('holodek.stoneworkSurfaceClosure'),String(value));assert.match(fill.textContent,new RegExp(value*100+'%'));
    assert.equal(context.window.ARCHITECTURAL_CARVINGS,false,'Comparing fill must not change carving coverage');
  }
  assert.equal(context.window.GameMenuUi.setStoneworkClosure(5),5);assert.match(fill.textContent,/500%/);
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/gameMenuUi'),'utf8'),context);assert.equal(context.window.STONEWORK_SURFACE_CLOSURE,5);
  assert.equal(context.window.GameMenuUi.setStoneworkClosure(6),5);
  assert.equal(context.window.GameMenuUi.setStoneworkClosure(2.5),2.5);assert.match(fill.textContent,/250%/);
  context.window.GameMenuUi.setStoneworkClosure(Infinity);assert.equal(context.window.STONEWORK_SURFACE_CLOSURE,3);
  context.window.GameMenuUi.setStoneworkClosure(-1);assert.equal(context.window.STONEWORK_SURFACE_CLOSURE,0);
});
