'use strict';
const Parcels=require('../assets/cityParcels'),Venues=require('../assets/cityEstablishments'),Nav=require('./sceneArchitecture');
const {createCanvas}=require('canvas'),{drawSceneSurface}=require('../assets/renderSceneTextures');
const Styles=require('../assets/cityBuildingStyle');
const Footprints=require('../assets/cityBuildingFootprints');
const Architecture=require('../assets/cityArchitectureStyles');
const VERSION=1,MAX_BUILDINGS=48,MAX_PARKS=6,surfaces=new Map();
const COMPASS={north:[0,-1],northeast:[1,-1],east:[1,0],southeast:[1,1],south:[0,1],southwest:[-1,1],west:[-1,0],northwest:[-1,-1]};
function texture(genre,kind){
  const id=genre+':'+kind;if(surfaces.has(id))return surfaces.get(id);
  const palette=require('../assets/genreKits').resolve({genre},require('./genreLayer').activeSetting()).palette;
  const ctx=createCanvas(128,128).getContext('2d');
  const period=Architecture.profile(genre),historic=period.heritage;
  const primary=kind==='road'?(historic?'#866642':'#303a45'):kind==='park'?'#526d4b':kind==='interior'?(historic?'#c8bfab':'#635e62'):(historic?'#b78f5c':'#8b9397');
  drawSceneSurface(ctx,createCanvas,'floor',{material:kind==='park'?'earth':period.material==='wood'?'wood':kind==='road'&&Parcels.highRise(genre)?'metal':'stone',
    palette:{...palette,primary,secondary:kind==='park'?'#344c32':kind==='road'?'#1d2631':'#4d565e'},seed:id,paletteStrength:.8});
  ctx.strokeStyle=kind==='road'?'#849092':'#bac1bd';ctx.lineWidth=kind==='road'?2:1;
  if(kind!=='park'){ctx.strokeRect(.5,.5,127,127);if(kind==='sidewalk'){ctx.beginPath();ctx.moveTo(64,0);ctx.lineTo(64,128);ctx.stroke();}}
  const url=ctx.canvas.toDataURL('image/png');surfaces.set(id,url);return url;
}
function wallTexture(genre,style){
  const id=`${genre}:wall:${style.variant}:${style.palette.primary}:${style.palette.secondary}`;if(surfaces.has(id))return surfaces.get(id);
  const ctx=createCanvas(128,128).getContext('2d');
  drawSceneSurface(ctx,createCanvas,'wall',{material:style.architecture?.material||'stone',palette:style.palette,seed:id,paletteStrength:.85});
  if(style.architecture?.heritage){
    ctx.strokeStyle=style.palette.secondary;ctx.lineWidth=2;
    for(let y=0;y<128;y+=24){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(128,y);ctx.stroke();
      for(let x=(y/24%2)*24;x<128;x+=48){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+24);ctx.stroke();}}
  }
  const url=ctx.canvas.toDataURL('image/png');surfaces.set(id,url);return url;
}
function apply(d,spec,site,{genre='fantasy',scale='city',reserved=new Set(),complete=false,stream=false,observer=null,limit=2,copyCells=false}={}){
  if(!d?.cells||!d.start||spec.indoor||spec.city?.roomKind==='city-building')return{status:'skipped'};
  if(d.cityBlocks?.version&&(!stream||d.cityBlocks.construction?.status==='complete'))return{status:'already-built',buildings:d.cityBlocks.buildings.length};
  if(complete&&stream)return{status:'skipped',reason:'preparation-only'};
  if(stream&&!d.cityBlocks?.streaming)return{status:'skipped',reason:'legacy-neighborhood'};
  const {width,height}=d.layout,cx=Math.floor(d.start.x),cy=Math.floor(d.start.y),pitch=d.cityBlocks?.descriptor?.pitch||Math.min(Parcels.pitchFor(genre),Math.max(26,Math.floor(Math.min(width,height)/3)));
  const vertical=site.design?.verticality,seed=`${d.generation?.seed||d.geoKey}:${site.id}`;
  const kit=require('../assets/genreKits').resolve({genre},require('./genreLayer').activeSetting());
  const districtKey=d.geoKey,design=site.design?.districts?.[spec.city?.district||'gate'];
  const descriptor={...Parcels.district({seed,cityId:site.id,districtKey,scale}),pitch};
  const options={seed,cityId:site.id,districtKey,genre,scale,floors:vertical?.floors,mix:design?.mix};
  const Plans=require('../assets/cityBuildingPlans');
  const focus=stream?{x:Math.round((observer.x-cx)/pitch),y:Math.round((observer.y-cy)/pitch)}:{x:0,y:0};
  // Production preparation visits the entire bounded plan once, not just the arrival neighborhood.
  const radius=complete?descriptor.half-1:stream?2:6,existing=d.cityBlocks,known=new Set([...(existing?.buildings||[]),...(existing?.parks||[])].map(p=>p.id));
  const candidates=[];for(let gy=focus.y-radius;gy<=focus.y+radius;gy++)for(let gx=focus.x-radius;gx<=focus.x+radius;gx++){
    if(!gx&&!gy)continue;const p=Parcels.parcel({...options,x:gx,y:gy});
    if(known.has(p.id)||Math.abs(gx)>=descriptor.half||Math.abs(gy)>=descriptor.half)continue;
    p.left=cx+gx*pitch-Math.floor(p.width/2);p.top=cy+gy*pitch-Math.floor(p.depth/2);p.distance=Math.hypot(gx-focus.x,gy-focus.y);
    if(p.left+p.width<2||p.top+p.depth<2||p.left>=width-2||p.top>=height-2)continue;
    candidates.push(p);
  }
  candidates.sort((a,b)=>a.distance-b.distance||a.seed-b.seed);
  const patch=new Map(),buildings=[],parks=[],protectedKeys=new Set(reserved),claimed=new Set();
  for(const s of d.sceneStructures||[])if(s.position&&s.size)for(let y=Math.floor(s.position.y);y<Math.ceil(s.position.y+s.size.y);y++)for(let x=Math.floor(s.position.x);x<Math.ceil(s.position.x+s.size.x);x++)protectedKeys.add(`${x},${y}`);
  let navigation,connected;
  const routes=spec.city?.routes||[],assigned=new Set((existing?.buildings||[]).concat(existing?.parks||[]).map(b=>b.targetCoordinates).filter(Boolean));
  // Try saved destinations first, then fill remaining parcels; a blocked destination cannot suppress the neighborhood.
  const fitted=candidates.flatMap(p=>[[0,0],[-3,0],[3,0],[0,-3],[0,3],[-3,-3],[3,3]].map(([offsetX,offsetY])=>({...p,offsetX,offsetY,left:p.left+offsetX,top:p.top+offsetY})));
  const rejected={},attempted=new Set(),accepted=new Set();
  const reject=(p,reason)=>{rejected[reason]=(rejected[reason]||0)+1;attempted.add(p.id);};
  const attempts=routes.flatMap(route=>fitted.filter(p=>{
    const bearing=COMPASS[route.direction];
    return !bearing||(p.x*bearing[0]+p.y*bearing[1])/Math.hypot(p.x,p.y)/Math.hypot(...bearing)>=.65;
  }).map(p=>({...p,route}))).concat(fitted);
  for(const attempt of attempts){
    const {route,...p}=attempt;
    if(route&&assigned.has(route.targetCoordinates))continue;
    if(route){p.width=route.footprint?.width||32;p.depth=route.footprint?.depth||32;p.park=route.establishmentType==='park';
      p.left=cx+p.x*pitch-Math.floor(p.width/2)+(p.offsetX||0);p.top=cy+p.y*pitch-Math.floor(p.depth/2)+(p.offsetY||0);
      p.type=route.establishmentType||p.type;p.targetCoordinates=route.targetCoordinates;
      if(route.vertical?.storeys)p.storeys=Math.max(1,Math.min(160,route.vertical.storeys));
      p.metres={width:p.width*Parcels.METRES_PER_CELL,depth:p.depth*Parcels.METRES_PER_CELL,height:route.vertical?.heightMetres||p.storeys*3.4};}
    const venue=Venues.profile(p.park?'park':p.type);
    const footprint=p.park?null:Footprints.create(p.seed),inside=(x,y)=>Footprints.contains(footprint,(x-p.left+.5)/p.width,(y-p.top+.5)/p.depth);
    const visualStyle=Styles.resolve(genre,{...p,name:route?.name,template:route?.template},kit.palette,
      {cotg:kit.locked&&genre===kit.genre,tradition:Architecture.tradition(site.design,site.id)}),wallSurface=`city_wall_surface_${genre}_${visualStyle.variant}_${visualStyle.architecture.paletteName}`;
    if(venue?.monumental)p.storeys=2;
    if(known.has(p.id))continue;
    if(!complete&&buildings.length+parks.length>=(stream?Math.max(1,Math.min(4,limit)):MAX_BUILDINGS+MAX_PARKS))break;
    if(!complete&&!stream&&(!p.park&&buildings.length>=MAX_BUILDINGS||p.park&&parks.length>=MAX_PARKS))continue;
    if(p.left<2||p.top<2||p.left+p.width>=width-2||p.top+p.depth>=height-2){reject(p,'map-edge');continue;}
    const keys=[],heights=[];let free=true;
    parcelCheck:for(let y=p.top-1;y<=p.top+p.depth;y++)for(let x=p.left-1;x<=p.left+p.width;x++){
      const k=`${x},${y}`,c=d.cells[k];
      if(!c||c.tile!=='floor'||c.cityParcel||c.feature||c.object||c.roof||c.blocked||c.obstacle||c.navigationReserved||protectedKeys.has(k)||claimed.has(k)){reject(p,'protected-or-occupied');free=false;break parcelCheck;}
      if(x>=p.left&&x<p.left+p.width&&y>=p.top&&y<p.top+p.depth){keys.push(k);heights.push(c.floorHeight||0);}
    }
    if(!free)continue;
    if(!navigation){navigation=Nav.makeNavigation(d);connected=Nav.reachable(navigation,d.start);}
    heights.sort((a,b)=>a-b);
    const base=heights[Math.floor(heights.length/2)],low=heights[0],high=heights.at(-1);
    const grading=require('./cityFoundations').approaches(d,p,base,{protectedKeys,claimed,reachable:connected.seen});
    if(!grading.entries.length){reject(p,'no-safe-approach');continue;}
    const doors=[],steps=[],railings=[],cells=new Map(),mx=p.left+Math.floor(p.width/2),my=p.top+Math.floor(p.depth/2),
      clearance=p.park?2.2:Plans.clearanceFor(genre,p.type);
    p.storeyHeightMetres=Plans.storeyHeightFor(genre,p.type,p.storeyHeightMetres);
    p.metres.height=p.park?0:Math.max(p.metres.height,(clearance+(Plans.classical(genre)?.6:.4))*Parcels.METRES_PER_CELL+Math.max(0,p.storeys-1)*p.storeyHeightMetres);
    const lobbyKind=['axial-concourse','atrium-gallery','lateral-concourse','cross-hall'][p.seed%4],horizontal=lobbyKind==='lateral-concourse';
    const axisStart=horizontal?p.top:p.left,axisSize=horizontal?p.depth:p.width,otherStart=horizontal?p.left:p.top,otherSize=horizontal?p.width:p.depth;
    const hallWidth=Math.min(axisSize-8,5+((p.seed>>>5)%3)*2),hallMid=axisStart+Math.floor(axisSize/2);
    const partitions=[hallMid-Math.floor(hallWidth/2)-1,hallMid+Math.ceil(hallWidth/2)];
    let ground=null,groundRecipe=null;
    if(!p.park){
      groundRecipe=Plans.floor(Plans.create({...p,seed:p.seed,hostKey:d.geoKey,genre,visualStyle}),0);
      ground={layout:{width:p.width+4,height:p.depth+4},start:{x:Math.floor(p.width/2)+2,y:p.depth},cells:{},tiles:{},
        generation:{seed:groundRecipe.seed},classification:{indoor:true},sceneSpec:{city:{genre,venue:{version:1,type:p.type},architecture:{authored:false,plan:groundRecipe}}}};
      require('./indoorBlueprint').build(ground,{},{floor:base+.24,ceil:clearance,deferCityFurnishings:true,coveredStorey:true});
    }
    for(const k of keys){
      const [x,y]=k.split(',').map(Number),edge=x===p.left||x===p.left+p.width-1||y===p.top||y===p.top+p.depth-1;
      if(!inside(x,y))continue;
      const doorway=(x===p.left&&grading.sides.includes('west')||x===p.left+p.width-1&&grading.sides.includes('east'))&&Math.abs(y-my)<=1||
        (y===p.top&&grading.sides.includes('north')||y===p.top+p.depth-1&&grading.sides.includes('south'))&&Math.abs(x-mx)<=1;
      const along=horizontal?y:x,across=horizontal?x:y,otherMid=horizontal?mx:my;
      const partition=!p.park&&partitions.includes(along)&&across>otherStart+2&&across<otherStart+otherSize-3&&Math.abs(across-otherMid)>1&&
        (lobbyKind!=='atrium-gallery'||across>otherStart+Math.floor(otherSize*.5));
      const boundary=edge||!inside(x-1,y)||!inside(x+1,y)||!inside(x,y-1)||!inside(x,y+1);
      const local=ground?.cells[`${x-p.left+2},${y-p.top+2}`];
      // Keep real north/south and east/west approaches joined to the circulation core.
      const cross=Math.abs(x-mx)<=1||Math.abs(y-my)<=1;
      const wall=boundary&&!doorway||!boundary&&!cross&&(ground?local?.tile!=='floor':partition);
      const inset=Math.min(x-p.left,p.left+p.width-1-x,y-p.top,p.top+p.depth-1-y);
      const rise=p.park?0:Math.min(3,inset+1)*.08;
      const c={...d.cells[k],tile:wall?'wall':'floor',floorHeight:base+rise,ceilHeight:base+(p.park&&wall ? .4 : clearance+.24),cityParcel:p.id,architectureRole:wall?(p.park?'city-park-railing':'city-shell'):'city-interior',
        floorSurface:`city_${p.park?'park':'interior'}_surface`,...(wall&&!p.park?{wallSurface}:{})};
      if(!wall&&!p.park)c.roof={version:1,style:'city-flat',height:base+clearance+.24};
      if(!wall&&!p.park&&inset<2){c.cityStep=true;steps.push({x,y,height:c.floorHeight});}
      if(p.park&&wall)railings.push({x,y});
      if(doorway){doors.push({x,y});c.cityDoorway=p.id;}
      cells.set(k,c);
    }
    for(const [k,c]of grading.cells)cells.set(k,c);
    const next={...navigation,passable:navigation.passable.slice(),floors:navigation.floors.slice()};
    for(const [k,c]of cells){const [x,y]=k.split(',').map(Number),i=y*width+x;next.passable[i]=c.tile==='floor'?1:0;next.floors[i]=c.floorHeight;}
    const after=Nav.reachable(next,d.start);
    if(doors.some(p=>!after.seen[p.y*width+p.x])){reject(p,'unreachable-door');continue;}
    if(connected.seen.some((v,i)=>v&&next.passable[i]&&!after.seen[i])){reject(p,'blocked-existing-route');continue;}
    for(const [k,c]of cells){patch.set(k,c);claimed.add(k);}
    const record={...p,footprint,visualStyle,...(p.park?{type:'park',storeys:0,metres:{...p.metres,height:0}}:{}),base,clearance,doors,steps,railings,entrySides:grading.sides,
      engineering:{version:1,foundation:high-low>.2?'retained-cut-and-fill':'level-plinth',terrainLow:low,terrainHigh:high,
        cut:Math.max(0,high-base),fill:Math.max(0,base-low),approaches:grading.entries},
      ...(venue?{spaces:venue.spaces,furniture:venue.furniture}:{}),interior:{x:p.left+1,y:p.top+1,width:p.width-2,depth:p.depth-2},
      lobbyKind:groundRecipe?.composition||lobbyKind,rooms:p.park?[]:ground?ground.indoorRooms.map(r=>({
        x:p.left+r.x-2,y:p.top+r.y-2,width:r.w,depth:r.h,use:r.role==='entrance'?'public-lobby':r.venueUse||p.type})):horizontal?[
        {use:'public-lobby',x:p.left+1,y:partitions[0]+1,width:p.width-2,depth:partitions[1]-partitions[0]-1},
        {use:p.type,x:p.left+3,y:p.top+1,width:p.width-6,depth:partitions[0]-p.top-1},
        {use:p.type,x:p.left+3,y:partitions[1]+1,width:p.width-6,depth:p.top+p.depth-partitions[1]-2}]:[
        {use:'public-lobby',x:partitions[0]+1,y:p.top+1,width:partitions[1]-partitions[0]-1,depth:p.depth-2},
        {use:p.type,x:p.left+1,y:p.top+3,width:partitions[0]-p.left-1,depth:p.depth-6},
        {use:p.type,x:partitions[1]+1,y:p.top+3,width:p.left+p.width-partitions[1]-2,depth:p.depth-6}],
      name:`${design?.name||site.name} ${p.park?'Garden':p.type} ${buildings.length+parks.length+1}`,authored:false};
    if(p.park)parks.push(record);else buildings.push(record);
    known.add(p.id);
    accepted.add(p.id);
    if(route)assigned.add(route.targetCoordinates);
    navigation=next;connected=after;
  }
  // Do not restamp/repaint a neighborhood merely because the observer moved.
  if(stream&&!buildings.length&&!parks.length)return{status:'unchanged',buildings:0,parks:0};
  if(copyCells)d.cells={...d.cells};
  d.cityArchitecture ||= Plans.district({...options,hostKey:d.geoKey,half:descriptor.half,pitch,origin:{x:cx,y:cy}});
  d.tiles||={};for(const kind of ['road','sidewalk','interior','park'])d.tiles[`city_${kind}_surface`]||={url:texture(genre,kind),surfaceOnly:true};
  for(const [k,c]of patch)d.cells[k]=c;
  // Surface changes follow existing walkable ground; protected routes, heights and objects remain intact.
  let roadCells=0,sidewalkCells=0;const paintRadius=stream?pitch*2:120,px=stream?Math.floor(observer.x):cx,py=stream?Math.floor(observer.y):cy;
  const roadHalf=1,sidewalkWidth=1;
  for(let y=complete?1:Math.max(1,py-paintRadius);y<(complete?height-1:Math.min(height-1,py+paintRadius));y++)for(let x=complete?1:Math.max(1,px-paintRadius);x<(complete?width-1:Math.min(width-1,px+paintRadius));x++){
    const k=`${x},${y}`,c=d.cells[k];if(!c||c.tile!=='floor'||c.cityParcel||c.object||c.feature)continue;
    const dx=Math.abs(((x-cx+pitch*20)%pitch)-pitch/2),dy=Math.abs(((y-cy+pitch*20)%pitch)-pitch/2);
    const distance=Math.min(dx,dy),kind=c.navigationReserved?'road':distance<=roadHalf?'road':distance<=roadHalf+sidewalkWidth?'sidewalk':null;
    if(kind&&c.cityStreet!==kind){d.cells[k]={...c,floorSurface:`city_${kind}_surface`,cityStreet:kind};if(kind==='road')roadCells++;else sidewalkCells++;}
  }
  d.sceneStructures||=[];const roofTile=`city_walkin_roof_${genre}`,roofShape=`g_${genre}_roof_panel`;
  d.tiles[roofTile]={url:d.tiles.ceiling?.url||d.tiles.wall?.url,spriteSpec:{voxelShape:roofShape,material:kit.voxel,palette:kit.palette,collisionBlocking:false}};
  const entry=Object.entries(require('../assets/architectureDesigns').SHAPES).find(([,p])=>p.genre===genre&&p.role==='gate');
  for(const b of buildings){
    const style=b.visualStyle,wall=`city_wall_surface_${genre}_${style.variant}_${style.architecture.paletteName}`;
    d.tiles[wall]||={url:wallTexture(genre,style),surfaceOnly:true};
    const classical=Plans.classical(style.architecture.profile),ceilingShape=classical?'coffered_slab':roofShape,
      ceilingTile=classical?`${roofTile}_coffered_${style.architecture.paletteName}`:roofTile;
    if(classical)d.tiles[ceilingTile]||={spriteSpec:{voxelShape:ceilingShape,material:'stone',palette:style.palette,collisionBlocking:false}};
    const z=b.base+b.clearance+.24;
    for(const r of Footprints.rectangles(b.footprint,b.width,b.depth)){
      d.sceneStructures.push({role:'city-building-foundation',tile:roofTile,shape:roofShape,
        position:{x:b.left+r.x,y:b.top+r.y,z:Math.min(b.base,b.engineering?.terrainLow??b.base)-.16},
        size:{x:r.width,y:r.depth,z:b.base+.24-Math.min(b.base,b.engineering?.terrainLow??b.base)+.16},cityParcel:b.id});
      d.sceneStructures.push({role:'city-walkin-roof',tile:ceilingTile,shape:ceilingShape,position:{x:b.left+r.x,y:b.top+r.y,z},size:{x:r.width,y:r.depth,z:.16},cityParcel:b.id});
    }
    if(entry){
      const shape=style.architecture.heritage&&genre!=='mythic'&&style.architecture.tradition!=='greek'?'aqueduct_arch__v0':entry[0],tile='city_walkin_entry_'+genre+'_'+style.architecture.paletteName+'_'+style.architecture.tradition;
      d.tiles[tile]||={spriteSpec:{voxelShape:shape,material:style.architecture.material,palette:style.palette,
        cityKit:style.architecture.heritage?{palette:style.architecture.paletteName}:undefined,collisionBlocking:false}};
      for(const y of [b.top,b.top+b.depth-1])d.sceneStructures.push({role:'city-venue-entryframe',tile,shape,cityParcel:b.id,
        position:{x:b.left+Math.floor(b.width/2)+.5-2.7,y:y+.35,z:b.base+.08},size:{x:5.4,y:.3,z:Math.min(b.clearance+.1,4.2)},cullDistance:64});
    }
    {
      const cityArchitecture=Architecture.envelope(style.architecture,b),shape=`a_${genre}_urban_skyline`,
        tile=`city_walkin_crown_${genre}_${style.variant}_${b.footprint.kind}_${cityArchitecture.shape}_${cityArchitecture.paletteName}_${cityArchitecture.bodyFraction}`;
      d.tiles[tile]||={spriteSpec:{voxelShape:shape,cityFootprint:b.footprint,cityArchitecture,material:style.architecture.material,collisionBlocking:false,palette:style.palette}};
      d.sceneStructures.push({role:'city-occupied-tower',tile,shape,position:{x:b.left,y:b.top,z:z+.16},
        size:{x:b.width,y:b.depth,z:cityArchitecture.height},skyline:true,cityParcel:b.id,cityFootprint:b.footprint,cityArchitecture});
    }
  }
  // Use the same approved room programs for walk-in frontages and authored interiors.
  d.cityBlocks={...existing,buildings:[...(existing?.buildings||[]),...buildings],parks:[...(existing?.parks||[]),...parks],streaming:{genre,scale}};
  require('./cityCirculation').install(d);
  for(const b of [...buildings,...parks]){
    const rooms=b.park?[{...b.interior,use:'garden courts'}]:b.rooms;
    const fitted=require('./venueFurnishings').place(d,rooms,{type:b.type,genre,kit,id:b.id,parcel:b.id,
      role:b.park?'city-park-furniture':'city-interior-furniture',max:20});
    b.workSites=fitted.sites;b.furnishings=fitted.parts.length;
  }
  for(const b of parks){
    const shape=`f_${genre}_barrier`,tile=`city_walkin_${shape}`;
    d.tiles[tile]||={spriteSpec:{voxelShape:shape,material:kit.voxel,palette:kit.palette,collisionBlocking:false}};
    for(const axis of ['x','y']){
      const length=axis==='x'?b.width:b.depth,mid=Math.floor(length/2);
      for(const edge of [0,axis==='x'?b.depth-1:b.width-1])for(const [offset,span]of [[0,mid-1],[mid+2,length-mid-2]]){
        d.sceneStructures.push({role:'city-park-railing',tile,shape,cityParcel:b.id,cullDistance:48,
          position:{x:b.left+(axis==='x'?offset:edge),y:b.top+(axis==='x'?edge:offset),z:b.base+.12},
          size:{x:axis==='x'?span:.3,y:axis==='x'?.3:span,z:.45}});
      }
    }
  }
  const Lights=require('./cityLighting');
  for(const b of buildings)Lights.rooms(d,b.rooms,{genre,kit,id:b.id,parcel:b.id});
  for(const b of buildings)Lights.facades(d,b,{genre,kit});
  for(const b of buildings)require('./cityArcades').install(d,b);
  for(const b of buildings)require('./cityClassicalDetails').frontage(d,b);
  Lights.streets(d,{genre,kit});
  d.cityBlocks={version:VERSION,descriptor,buildings:[...(existing?.buildings||[]),...buildings],parks:[...(existing?.parks||[]),...parks],
    placement:{version:1,candidateParcels:candidates.length,accepted:accepted.size,unplaced:[...attempted].filter(id=>!accepted.has(id)).length,rejectedAttempts:rejected},
    roadCells:(existing?.roadCells||0)+roadCells,sidewalkCells:(existing?.sidewalkCells||0)+sidewalkCells,metresPerCell:Parcels.METRES_PER_CELL,
    streaming:{version:1,genre,scale,revision:(existing?.streaming?.revision||0)+1},
    ...(complete?{construction:{version:1,status:'complete',scope:'host-room',candidateParcels:candidates.length,
      accepted:accepted.size,unplaced:[...attempted].filter(id=>!accepted.has(id)).length}}:{}),
    streetSection:{roadWidthMetres:(roadHalf*2+1)*Parcels.METRES_PER_CELL,sidewalkWidthMetres:sidewalkWidth*Parcels.METRES_PER_CELL}};
  bindEntrances(d,spec.city?.routes||[]);
  for(const b of d.cityBlocks.buildings){
    if(b.targetCoordinates)b.planId=`landmark:${b.targetCoordinates}`;
    const city={district:spec.city?.district,establishmentType:b.type};
    Plans.bind(d.cityArchitecture,b,{programs:require('./cityArchitecture').programs(city,b.storeys,site.design),authored:b.authored});
  }
  delete d._geometryStamp;
  console.info('[CityBlocks]',JSON.stringify({geoKey:d.geoKey,buildings:buildings.length,parks:parks.length,pitch,placement:d.cityBlocks.placement}));
  return{status:stream?'streamed':'built',buildings:buildings.length,parks:parks.length,roadCells,sidewalkCells,potentialParcels:descriptor.potentialParcels,
    unboundRoutes:routes.filter(r=>!d.cityBuildingEntrances.some(e=>e.targetCoordinates===r.targetCoordinates)).map(r=>r.direction)};
}
function bindEntrances(d,routes){
  const used=new Set(),bindings=[];
  for(const route of routes){
    const marker=d.roomExits?.markers?.find(m=>m.direction===route.direction);if(!marker)continue;
    const b=[...d.cityBlocks.buildings,...d.cityBlocks.parks].find(b=>!used.has(b.id)&&b.targetCoordinates===route.targetCoordinates);
    if(!b)continue;used.add(b.id);b.name=route.name;b.targetCoordinates=route.targetCoordinates;b.authored=true;
    const x=b.left+Math.floor(b.width/2),y=b.top+4,key=`${x},${y}`;
    bindings.push({direction:route.direction,x,y,key,destinationName:route.name,targetCoordinates:route.targetCoordinates,buildingId:b.id});
    const floor=d.cells[key].floorHeight;
    const old={x:marker.x,y:marker.y};Object.assign(marker,bindings.at(-1),{floor,kind:'building-threshold'});
    for(const part of d.sceneStructures||[])if(part.direction===route.direction&&/^journey-exit/.test(part.role||'')){
      part.position.x+=x-old.x;part.position.y+=y-old.y;part.position.z=floor;
    }
    d.cells[key]={...d.cells[key],navigationReserved:true};
  }
  d.cityBuildingEntrances=bindings;
}
module.exports={VERSION,MAX_BUILDINGS,MAX_PARKS,apply,texture,bindEntrances};
