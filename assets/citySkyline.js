(function(root,factory){const api=factory(root,typeof module==='object'&&module.exports?require('./urbanDesigns'):root.UrbanDesigns,
  typeof module==='object'&&module.exports?require('./cityParcels'):root.CityParcels,
  typeof module==='object'&&module.exports?require('./genreFixtures'):root.GenreFixtures,
  typeof module==='object'&&module.exports?require('./cityBuildingStyle'):root.CityBuildingStyle,
  typeof module==='object'&&module.exports?require('./cityBuildingFootprints'):root.CityBuildingFootprints,
  typeof module==='object'&&module.exports?require('./cityArchitectureStyles'):root.CityArchitectureStyles);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.CitySkyline=api;
})(typeof window==='object'?window:globalThis,function(root,Urban,Parcels,Fixtures,Styles,Footprints,Architecture){
  'use strict';
  const VERSION=6,CHUNK=128,ENTER_NEAR=64,LEAVE_NEAR=80,WINDOWS=896,ACCENTS=24,MAX_VERTICES=60000,CACHE_PANELS=100000;
  const plans=new WeakMap(),surfaces=new Map(),detailCache=new Map();
  let activePlan=null,cachedPanels=0;
  const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  function lightingProfile(genre,storeys=8){
    const high=Parcels.highRise(genre),theme=Fixtures.THEMES[genre]||Fixtures.THEMES.fantasy;
    const windows=Math.min(high?WINDOWS:320,Math.max(96,Math.ceil(storeys*(high?16:20))));
    return{windows,accents:high?ACCENTS:0,group:high?2:1,
      panes:theme.map(t=>t[2]),theme,
      vertical:['cyberpunk','sci-fi','underwater'].includes(genre)};
  }
  function remember(key,detail){
    detailCache.set(key,detail);cachedPanels+=detail.windows.length+detail.walls.length+(detail.facade?.length||0);
    while(detailCache.size>1024||cachedPanels>CACHE_PANELS&&detailCache.size>1){
      const oldest=detailCache.keys().next().value,expired=detailCache.get(oldest);
      cachedPanels-=expired.windows.length+expired.walls.length+(expired.facade?.length||0);detailCache.delete(oldest);
    }
  }
  function faces(shape,footprint,architecture){
    const key=shape+':'+(footprint?.kind||'legacy')+':'+JSON.stringify(architecture||null);
    if(surfaces.has(key))return surfaces.get(key);
    const n=16,voxels=footprint?(architecture?Architecture.build(footprint,architecture,n):Footprints.build(footprint,n)):Urban.build(shape,n),result=[];
    if(!voxels)return result;
    const at=p=>p.every(v=>v>=0&&v<n)&&voxels[p[0]+p[1]*n+p[2]*n*n];
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1])for(let plane=0;plane<n;plane++){
      const ua=(axis+1)%3,va=(axis+2)%3,mask=new Uint8Array(n*n);
      for(let v=0;v<n;v++)for(let u=0;u<n;u++){
        const p=[0,0,0];p[axis]=plane;p[ua]=u;p[va]=v;
        const q=p.slice();q[axis]+=sign;if(at(p)&&!at(q))mask[u+v*n]=1;
      }
      for(let v=0;v<n;v++)for(let u=0;u<n;u++)if(mask[u+v*n]){
        let w=1,h=1;while(u+w<n&&mask[u+w+v*n])w++;
        grow:while(v+h<n){for(let x=0;x<w;x++)if(!mask[u+x+(v+h)*n])break grow;h++;}
        for(let y=0;y<h;y++)for(let x=0;x<w;x++)mask[u+x+(v+y)*n]=0;
        const points=[[u,v],[u+w,v],[u+w,v+h],[u,v+h]].map(([a,b])=>{
          const p=[0,0,0];p[axis]=(plane+(sign>0?1:0))/n;p[ua]=a/n;p[va]=b/n;return p;
        });
        const normal=[0,0,0];normal[axis]=sign;result.push({axis,sign,plane,points,normal});
      }
    }
    surfaces.set(key,result);if(surfaces.size>512)surfaces.delete(surfaces.keys().next().value);return result;
  }
  function details(part,building,genre,run){
    const p=part.position,s=part.size,scale=[s.x,s.y,s.z],offset=[p.x,p.y,p.z],surface=faces(part.shape,part.cityFootprint,part.cityArchitecture),windows=[],panels=[];
    const seed=`${run}:${building.id}`,storey=Math.max(.9,s.z/Math.max(1,(building.storeys||8)-1)),profile=lightingProfile(genre,building.storeys);
    const style=building.visualStyle||Styles.resolve(genre,building,part.palette||{});profile.panes=style.panes;
    if(Architecture.classical(part.cityArchitecture)){
      const detail=Architecture.facade(part,building,surface,style.panes,run),base=rgb(part.palette?.primary||'#647184');
      return{walls:surface.map(face=>({points:face.points.map(point=>point.map((v,i)=>offset[i]+v*scale[i])),normal:face.normal,
        color:wallColor(face,part,base)})),facade:detail.walls,windows:detail.windows,windowCount:detail.windows.length,accentCount:0,beaconFaces:0};
    }
    const pane=(panel,cx,cz,halfW,halfH,color)=>{
      const {face,horizontal}=panel,plane=offset[face.axis]+face.points[0][face.axis]*scale[face.axis]+face.sign*.012;
      return{normal:face.normal,color,points:[[-halfW,-halfH],[halfW,-halfH],[halfW,halfH],[-halfW,halfH]].map(([a,b])=>{
        const point=[0,0,cz+b];point[face.axis]=plane;point[horizontal]=cx+a;return point;
      })};
    };
    let slots=0;
    for(const [faceIndex,face]of surface.entries()){
      if(face.axis===2)continue;
      const horizontal=face.axis===0?1:0,lo=Math.min(...face.points.map(v=>v[horizontal]))*scale[horizontal]+offset[horizontal],
        hi=Math.max(...face.points.map(v=>v[horizontal]))*scale[horizontal]+offset[horizontal],
        bottom=Math.min(...face.points.map(v=>v[2]))*s.z+p.z,top=Math.min(Math.max(...face.points.map(v=>v[2])),part.cityArchitecture?.bodyFraction??1)*s.z+p.z;
      if(hi-lo<.45||top-bottom<.6)continue;
      const cols=Math.min(64,Math.max(1,Math.floor((hi-lo)/1.2))),rowBase=Math.max(0,Math.ceil((bottom-p.z+.32)/storey-.5)),
        rows=Math.min(160,Math.floor((top-p.z-.32)/storey-.5)-rowBase+1);
      if(rows<=0)continue;
      const banksX=Math.ceil(cols/profile.group),banksY=Math.ceil(rows/profile.group);
      panels.push({face,faceIndex,horizontal,lo,hi,bottom,top,cols,rows,rowBase,banksX,banksY,start:slots});slots+=banksX*banksY;
    }
    // Sample occupied room banks in a seeded permutation, rather than enumerating an entire tower.
    const gcd=(a,b)=>{while(b){const r=a%b;a=b;b=r;}return a;};
    let step=slots>1?1+Parcels.hash(seed+':step')%(slots-1):1;
    while(gcd(step,slots)>1)step++;
    const first=slots?Parcels.hash(seed+':first')%slots:0;
    for(let i=0;i<Math.min(slots,profile.windows*4)&&windows.length<profile.windows;i++){
      const slot=(first+i*step)%slots;
      let left=0,right=panels.length-1;
      while(left<right){const mid=(left+right+1)>>1;if(panels[mid].start<=slot)left=mid;else right=mid-1;}
      const panel=panels[left],{faceIndex,lo,hi,cols,rows,rowBase,banksX,start}=panel,
        bankRow=Math.floor((slot-start)/banksX),bankCol=(slot-start)%banksX,
        room=Parcels.hash(`${seed}:${faceIndex}:room:${bankRow},${bankCol}`);
      if(room%100<14)continue;
      const tone=(room>>>8)%10,color=rgb(profile.panes[profile.group===2?(tone<6?0:tone<9?1:2):tone%profile.panes.length]);
      for(let dy=0;dy<profile.group;dy++)for(let dx=0;dx<profile.group;dx++){
        const row=bankRow*profile.group+dy,col=bankCol*profile.group+dx;
        if(row>=rows||col>=cols||windows.length>=profile.windows)continue;
        const h=Parcels.hash(`${seed}:${faceIndex}:${row},${col}`);if(h%100<8)continue;
        windows.push(pane(panel,lo+(col+.5)*(hi-lo)/cols,p.z+(rowBase+row+.5)*storey,
          Math.min(.24,(hi-lo)/cols*.29),Math.min(.31,storey*.24),color.map(c=>Math.min(1,c*(.88+(h%13)/100)))));
      }
    }
    const windowCount=windows.length,accentColor=rgb(style.accent);
    const accents=panels.filter(f=>f.hi-f.lo>=2&&f.top-f.bottom>=1.2).sort((a,b)=>
      Parcels.hash(seed+':edge:'+a.faceIndex)-Parcels.hash(seed+':edge:'+b.faceIndex)).slice(0,Math.max(0,(profile.accents-4)/2));
    for(const panel of accents){
      const {lo,hi,bottom,top}=panel,width=hi-lo,height=top-bottom;
      if(profile.vertical){
        for(const u of[.12,.88])windows.push(pane(panel,lo+width*u,bottom+height*.55,Math.min(.12,width*.025),height*.38,accentColor));
      }else{
        for(const v of[.22,.88])windows.push(pane(panel,(lo+hi)/2,bottom+height*v,width*.42,Math.min(.12,height*.035),accentColor));
      }
    }
    if(profile.accents)for(const panel of panels.filter(f=>f.hi-f.lo>=2&&f.top>=p.z+s.z*.72)
      .sort((a,b)=>b.top-a.top||a.faceIndex-b.faceIndex).slice(0,4)){
      windows.push(pane(panel,(panel.lo+panel.hi)/2,panel.top-.16,(panel.hi-panel.lo)*.42,Math.min(.10,(panel.top-panel.bottom)*.04),accentColor));
    }
    const accentCount=windows.length-windowCount;
    const palette=part.palette||null,base=rgb(palette?.primary||'#647184');
    const walls=surface.map(face=>({points:face.points.map(point=>point.map((v,i)=>offset[i]+v*scale[i])),normal:face.normal,
      color:wallColor(face,part,base)}));
    // Beacons sit on a real occupied roof voxel, never at an empty bounding-box corner.
    if(Parcels.highRise(genre)&&(building.storeys||0)>12){
      const roof=surface.filter(f=>f.axis===2&&f.sign>0).sort((a,b)=>b.points[0][2]-a.points[0][2])[0];
      if(roof){
        const x=roof.points.reduce((n,v)=>n+v[0],0)/4*s.x+p.x,y=roof.points.reduce((n,v)=>n+v[1],0)/4*s.y+p.y,z=roof.points[0][2]*s.z+p.z+.10;
        const color=rgb((Fixtures.THEMES[genre]||Fixtures.THEMES.fantasy)[2][2]);
        for(const normal of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1]]){
          const axis=normal.findIndex(Boolean),ua=(axis+1)%3,va=(axis+2)%3,center=[x,y,z];
          windows.push({normal,color,points:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>{
            const q=center.slice();q[axis]+=normal[axis]*.10;q[ua]+=u*.10;q[va]+=v*.10;return q;
          })});
        }
      }
    }
    return{walls,windows,windowCount,accentCount,beaconFaces:windows.length-windowCount-accentCount};
  }
  function wallColor(face,part,base){
    const a=part.cityArchitecture;
    const center=face.points[0].map((_,i)=>face.points.reduce((n,p)=>n+p[i],0)/4);
    const native=a?Architecture.color(a,...center,face.normal,part.palette):base;
    return native.map(c=>Math.min(a?.heritage ? .65 : .32,.035+c*(a?.heritage?(face.axis===2 ? .56:face.sign>0 ? .48:.38):(face.axis===2 ? .30:face.sign>0 ? .24:.19))));
  }
  function mesh(quads,bounds,glow=false){
    const meshes=[],offset=[bounds.position.x,bounds.position.y,bounds.position.z],inverse=[1/bounds.size.x,1/bounds.size.y,1/bounds.size.z],perMesh=MAX_VERTICES/4;
    // Write bounded typed buffers directly; dense facade batches must not grow/copy giant temporary JS arrays.
    for(let start=0;start<quads.length;start+=perMesh){
      const count=Math.min(perMesh,quads.length-start),vertices=new Float32Array(count*36),indices=new Uint16Array(count*6);
      for(let i=0;i<count;i++){
        const q=quads[start+i],normal=q.normal,center=[0,0,0];
        // Unlit panels reuse the normal attribute for their shared center in the existing subpixel glow pass.
        if(glow)for(let axis=0;axis<3;axis++)center[axis]=((q.points[0][axis]+q.points[1][axis]+q.points[2][axis]+q.points[3][axis])*.25-offset[axis])*inverse[axis];
        for(let corner=0;corner<4;corner++){
          const at=i*36+corner*9,point=q.points[corner];
          for(let axis=0;axis<3;axis++){
            vertices[at+axis]=(point[axis]-offset[axis])*inverse[axis];
            vertices[at+3+axis]=glow?center[axis]:normal[axis];vertices[at+6+axis]=q.color[axis];
          }
        }
        const at=i*6,first=i*4;
        indices[at]=first;indices[at+1]=first+1;indices[at+2]=first+2;indices[at+3]=first;indices[at+4]=first+2;indices[at+5]=first+3;
      }
      meshes.push({vertices,indices});
    }
    return meshes;
  }
  function plan(d){
    if(root.CITY_SKYLINE_RENDERING===false||!Urban||!Parcels||!Fixtures||!d?.cityBlocks?.buildings?.length)return null;
    const old=plans.get(d),stamp=d._geometryStamp||d._meta?.geometryStamp,palette=JSON.stringify(d.visualStyle?.palette||{});
    const genre=d.cityBlocks.streaming?.genre||d.sceneSpec?.city?.genre||'fantasy',run=d.generation?.runId||d.geoKey;
    if(old?.source===d.sceneStructures&&old.length===d.sceneStructures?.length&&old.stamp===stamp&&old.palette===palette&&
      old.run===run&&old.genre===genre&&old.tiles===d.tiles&&old.buildings===d.cityBlocks.buildings&&old.count===d.cityBlocks.buildings.length)return old;
    const buildings=new Map(d.cityBlocks.buildings.map(b=>[b.id,b])),groups=new Map(),members=new Map();
    for(const part of d.sceneStructures||[]){
      const b=buildings.get(part.cityParcel),p=part.position,s=part.size;
      if(!b||part.skyline!==true||!Urban.has(part.shape)||!p||!s||![p.x,p.y,p.z,s.x,s.y,s.z].every(Number.isFinite)||Math.min(s.x,s.y,s.z)<=0)continue;
      const id=b.id,chunk=`${Math.floor(p.x/CHUNK)},${Math.floor(p.y/CHUNK)}`,group=groups.get(chunk)||{id:chunk,members:[],signature:'',glow:null,body:null};
      const signature=JSON.stringify([VERSION,run,genre,id,part.shape,p,s,d.tiles?.[part.tile]?.spriteSpec?.palette,b.visualStyle,part.cityFootprint,part.cityArchitecture]);
      const entry={id,part,b,signature,detail:null};group.members.push(entry);group.signature+=signature;members.set(part,entry);groups.set(chunk,group);
    }
    for(const group of groups.values()){
      const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      for(const {part:{position:p,size:s}}of group.members)for(const [i,k]of ['x','y','z'].entries()){min[i]=Math.min(min[i],p[k]-.1);max[i]=Math.max(max[i],p[k]+s[k]+.4);}
      group.bounds={position:Object.fromEntries(['x','y','z'].map((k,i)=>[k,min[i]])),size:Object.fromEntries(['x','y','z'].map((k,i)=>[k,max[i]-min[i]]))};
    }
    const result={source:d.sceneStructures,length:d.sceneStructures?.length,stamp,palette,genre,run,tiles:d.tiles,
      buildings:d.cityBlocks.buildings,count:d.cityBlocks.buildings.length,members,groups};plans.set(d,result);return result;
  }
  function collect(d,player,lod={},options={}){
    const p=plan(d);
    if(p!==activePlan){
      // Room databases retain visited dungeons; do not retain every visited city's compiled batches too.
      if(activePlan){for(const entry of activePlan.members.values())entry.detail=null;
        for(const group of activePlan.groups.values()){group.body=null;group.glow=null;group.facade=null;}}
      activePlan=p;
    }
    if(!p?.members.size)return null;
    const identity=`${p.run}:${d.geoKey}`;if(lod.identity!==identity){lod.identity=identity;lod.near=new Map();}
    const replaced=new Set(),batches=[],visible=[];let near=0,far=0,windows=0,accents=0,beaconFaces=0,pending=0;
    for(const group of p.groups.values()){
      const distant=[];
      for(const entry of group.members){
        const {position:a,size:s}=entry.part,dx=Math.max(a.x-player.x,0,player.x-a.x-s.x),dy=Math.max(a.y-player.y,0,player.y-a.y-s.y),distance=Math.hypot(dx,dy);
        const close=distance<(lod.near.get(entry.id)?LEAVE_NEAR:ENTER_NEAR);lod.near.set(entry.id,close);
        if(close)near++;else{far++;distant.push(entry);replaced.add(entry.part);}
      }
      if(options.visible&&!options.visible(group.bounds))continue;
      visible.push({group,distant});
    }
    let budget=options.maxNew??4,built=0;
    const ordered=visible.flatMap(({group})=>group.members).sort((a,b)=>
      Math.hypot(a.part.position.x-player.x,a.part.position.y-player.y)-Math.hypot(b.part.position.x-player.x,b.part.position.y-player.y));
    for(const entry of ordered){
      if(!entry.detail)entry.detail=detailCache.get(entry.signature)||null;
      if(!entry.detail&&budget>0){
        const cost=lightingProfile(p.genre,entry.b.storeys).windows>256?2:1;
        if(built===0||budget>=cost){
          entry.detail=details({...entry.part,palette:d.tiles?.[entry.part.tile]?.spriteSpec?.palette},entry.b,p.genre,p.run);
          remember(entry.signature,entry.detail);budget-=cost;built++;
        }
      }
      if(entry.detail){windows+=entry.detail.windowCount;accents+=entry.detail.accentCount;beaconFaces+=entry.detail.beaconFaces;}else pending++;
    }
    for(const {group,distant}of visible){
      const ready=group.members.filter(e=>e.detail),glowKey=ready.map(e=>e.id).join('|');
      if(group.glow?.membership!==glowKey)group.glow={id:'glow:'+group.id,key:group.signature+':glow:'+glowKey,bounds:group.bounds,membership:glowKey,
        meshes:mesh(ready.flatMap(e=>e.detail.windows),group.bounds,true)};
      if(group.glow.meshes.length)batches.push(group.glow);
      if(group.facade?.membership!==glowKey)group.facade={id:'facade:'+group.id,key:group.signature+':facade:'+glowKey,bounds:group.bounds,membership:glowKey,
        meshes:mesh(ready.flatMap(e=>e.detail.facade||[]),group.bounds)};
      if(group.facade.meshes.length)batches.push(group.facade);
      const bodyKey=distant.map(e=>e.id).join('|');
      if(group.body?.membership!==bodyKey)group.body={id:'body:'+group.id,key:group.signature+':'+bodyKey,bounds:group.bounds,
        membership:bodyKey,meshes:mesh(distant.flatMap(e=>{
          if(e.detail)return e.detail.walls;
          const {position:a,size:s}=e.part,scale=[s.x,s.y,s.z],offset=[a.x,a.y,a.z],base=rgb(d.tiles?.[e.part.tile]?.spriteSpec?.palette?.primary||'#647184');
          return faces(e.part.shape,e.part.cityFootprint,e.part.cityArchitecture).map(f=>({points:f.points.map(v=>v.map((x,i)=>offset[i]+x*scale[i])),normal:f.normal,
            color:wallColor(f,{...e.part,palette:d.tiles?.[e.part.tile]?.spriteSpec?.palette},base)}));
        }),group.bounds)};
      if(group.body.meshes.length)batches.push(group.body);
    }
    return{replaced,batches,stats:{buildings:p.members.size,near,far,chunks:p.groups.size,windows,accents,beaconFaces,pending,dynamicLights:0,
      batchedDraws:batches.reduce((n,b)=>n+b.meshes.length,0)}};
  }
  function depthRange(d){return plan(d)?.members.size?Math.max(300,Math.ceil(Math.hypot(d.layout.width,d.layout.height))+32):300;}
  return{VERSION,CHUNK,ENTER_NEAR,LEAVE_NEAR,WINDOWS,ACCENTS,MAX_VERTICES,CACHE_PANELS,lightingProfile,faces,plan,collect,depthRange,
    cacheStats:()=>({entries:detailCache.size,panels:cachedPanels})};
});
