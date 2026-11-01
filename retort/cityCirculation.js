'use strict';
const Flags=require('./worldFlags'),P=require('../assets/cityParcels'),I=require('../assets/dungeonInhabitants'),Nav=require('./sceneArchitecture');
const VERSION=2,Stairs=require('./cityStairwells');
function install(d,{protectedKeys=new Set()}={}){
  if(!Flags.on('ARCHITECTURE_EXPANSION')||!Flags.on('CITY_SITES')||!d?.cells||!d.layout||!d.start)return{changed:false,controls:0};
  const retrofit=Stairs.upgrade(d,{protectedKeys});
  const city=d.sceneSpec?.city,old=d.cityCirculation?.controls||[],controls=old.slice(),existing=new Set(old.map(c=>c.owner));
  const venues=(d.cityBlocks?.buildings||[]).filter(b=>b.storeys>1&&!existing.has(b.id)).map(b=>({owner:b.id,building:b,rooms:b.rooms,
    genre:d.cityBlocks.streaming?.genre||'fantasy',floor:0,storeys:b.storeys,authored:b.authored}));
  const missingStreet=city?.vertical?.floor===0&&d.cityFloorContext&&existing.has('interior')&&!old.some(c=>c.owner==='interior'&&c.mode==='street');
  if(city?.vertical&&city.vertical.storeys>=0&&(!existing.has('interior')||missingStreet))venues.push({owner:'interior',rooms:(d.indoorRooms||[]).map(r=>({x:r.x,y:r.y,width:r.w,depth:r.h})),
    genre:city.genre||'fantasy',floor:city.vertical.floor,storeys:city.vertical.storeys+1,authored:city.architecture?.authored,onlyStreet:missingStreet});
  const finish=(changed,count)=>({changed:require('./cityFloorCeilings').install(d).changed||changed,controls:count});
  if(!venues.length)return finish(retrofit.changed,0);
  const occupied=new Set(protectedKeys);
  if(!d.cityFloorContext)for(let y=d.start.y-2;y<=d.start.y+2;y++)for(let x=d.start.x-2;x<=d.start.x+2;x++)occupied.add(`${x},${y}`);
  for(const a of Object.values(d.cityCrowd?.actors||{}))if(a.position)occupied.add(`${Math.floor(a.position.x)},${Math.floor(a.position.y)}`);
  for(const s of d.sceneStructures||[])if(s.position&&s.size&&!/^city-(?:building-foundation|walkin-roof|occupied-tower|venue-entryframe|floor-ceiling|classical-ceiling-rib|classical-vault)$/.test(s.role||''))
    for(let y=Math.floor(s.position.y);y<Math.ceil(s.position.y+s.size.y);y++)for(let x=Math.floor(s.position.x);x<Math.ceil(s.position.x+s.size.x);x++)occupied.add(`${x},${y}`);
  let reached;const additions=[];d.tiles||={};
  const canReservePartition=(x,y,c)=>{
    const b=d.cityVenueBounds;if(!d.cityFloorContext||city?.architecture?.authored||!b||c?.tile!=='wall')return false;
    return x>b.left&&y>b.top&&x<b.left+b.width-1&&y<b.top+b.depth-1&&
      require('../assets/cityBuildingFootprints').contains(b.outline,(x-b.left+.5)/b.width,(y-b.top+.5)/b.depth);
  };
  for(const v of venues){
    const rooms=v.rooms?.length?v.rooms.slice():[v.building?.interior].filter(Boolean),options=[];
    if(d.cityFloorContext&&d.cityVenueBounds)rooms.push({x:d.cityVenueBounds.left,y:d.cityVenueBounds.top,
      width:d.cityVenueBounds.width,depth:d.cityVenueBounds.depth});
    const margin=d.cityFloorContext?0:1;
    const flightRows=Stairs.rowsFor(d,v.building),coreDepth=flightRows+2;
    for(const r of rooms)for(const rotated of d.cityFloorContext?[false,true]:[false]){
      const w=rotated?coreDepth:2,h=rotated?2:coreDepth;
      for(let y=r.y+margin;y<=r.y+r.depth-h-margin;y++)for(let x=r.x+margin;x<=r.x+r.width-w-margin;x++)options.push({x,y,rotated});
    }
    options.sort((a,b)=>P.hash(`${v.owner}:${a.x},${a.y}`)-P.hash(`${v.owner}:${b.x},${b.y}`));
    const kit=require('../assets/genreKits').resolve({genre:v.genre}),shape=`g_${v.genre}_roof_panel`,tile=`city_circulation_panel_${v.genre}`;
    const makePart=(role,x,y,z,sx,sy,sz)=>additions.push({role,tile,shape,cityParcel:v.building?.id,position:{x,y,z},size:{x:sx,y:sy,z:sz},cullDistance:48});
    const place=(mode,direction)=>{
      let chosen;
      for(const p of options){
        const at=(u,v)=>({x:p.x+(p.rotated?v:u),y:p.y+(p.rotated?u:v)}),landing=at(0,flightRows);
        let free=true,base=d.cells[`${landing.x},${landing.y}`]?.floorHeight||0;
        for(let offset=0;offset<coreDepth&&free;offset++)for(let u=0;u<2;u++){
          const {x,y}=at(u,offset);
          const k=`${x},${y}`,c=d.cells[k];
          // Empty floor plans reserve corridors against furniture, not against walkable stair flights.
          const reserved=c?.navigationReserved&&!d.cityFloorContext;
          if(!c||c.tile!=='floor'&&!canReservePartition(x,y,c)||v.building&&c.cityParcel!==v.building.id||c.object||c.feature||reserved||occupied.has(k)||Math.abs((c.floorHeight||0)-base)>.04||
            (c.roof?.height??c.ceilHeight??base+3)-base<1.05){free=false;break;}
        }
        if(!free)continue;
        reached||=Nav.reachable(Nav.makeNavigation(d),d.start).seen;
        const approach=at(0,flightRows+1);if(!reached[approach.y*d.layout.width+approach.x])continue;
        chosen={...p,base};break;
      }
      if(!chosen)return null;
      const {x,y,base,rotated}=chosen,id=`${v.owner}:${mode}:${direction||'directory'}`;
      const at=(u,v)=>({x:x+(rotated?v:u),y:y+(rotated?u:v)});
      const part=(role,u,v,z,sx,sy,sz)=>{const p=at(u,v);makePart(role,p.x,p.y,z,rotated?sy:sx,rotated?sx:sy,sz);additions.at(-1).cityCirculation=id;};
      d.tiles[tile]||={spriteSpec:{voxelShape:shape,material:kit.voxel,palette:kit.palette,collisionBlocking:false}};
      const point=at(1,flightRows+.5),arrival=at(1,flightRows+1.5);
      for(let offset=0;offset<coreDepth;offset++)for(let u=0;u<2;u++){
        const {x:xx,y:yy}=at(u,offset);
        const key=`${xx},${yy}`;occupied.add(key);d.cells[key]={...d.cells[key],tile:'floor',navigationReserved:true,cityCirculation:id};
      }
      if(mode!=='stairs'){
        for(const side of[0,1.88])part('city-lift-jamb',side,2,base,.12,.35,1.7);
        part('city-lift-lintel',0,2,base+1.65,2,.35,.15);
        part('city-lift-call-panel',1.7,2.45,base+.7,.2,.16,.35);
        part('city-lift-doors',.15,2.1,base,1.7,.06,1.65);
      }
      const control={id,owner:v.owner,buildingId:v.building?.id,mode,direction,floor:v.floor,storeys:v.storeys,authored:!!v.authored,
        point,arrival,trigger:mode==='stairs'?at(1,.5):null,
        label:mode==='street'?'Return to the street':mode==='lift'?`${v.building?.name||'Building'} lift - floor directory`:`Stairs ${direction} - level ${v.floor+(direction==='up'?1:-1)}`,
        box:{...at(0,mode==='lift'?2:0),z:base,sx:rotated?(mode==='lift'?.6:flightRows):2,sy:rotated?2:(mode==='lift'?.6:flightRows),sz:mode==='lift'?1.8:1.05}};
      if(mode==='stairs')Stairs.build(d,control,{x,y,base,rows:flightRows,rotated,part,building:v.building});
      controls.push(control);return control;
    };
    const first=controls.length;
    if(v.owner==='interior'&&v.floor===0&&city.architecture?.hostKey&&(d.cityFloorContext||city.architecture.hostKey!==d.geoKey))place('street');
    if(!v.onlyStreet&&v.floor<v.storeys-1)place('stairs','up');
    if(!v.onlyStreet&&v.floor>0)place('stairs','down');
    if(!v.onlyStreet&&(P.highRise(v.genre)&&v.storeys>4||v.genre==='steampunk'&&v.storeys>4))place('lift');
    if(v.building&&controls.length>first)v.building.circulationVersion=VERSION;
  }
  const added=controls.length-old.length;
  if(added){
    d.sceneStructures||=[];d.sceneStructures.push(...additions);d.cityCirculation={version:VERSION,controls};
    if(city?.vertical){
      d.cityBuildingEntrances=[...(d.cityBuildingEntrances||[]).filter(e=>!['up','down'].includes(e.direction)),
        ...controls.filter(c=>c.owner==='interior'&&c.direction).map(c=>({direction:c.direction,x:Math.floor(c.point.x),y:Math.floor(c.point.y),
          key:`${Math.floor(c.point.x)},${Math.floor(c.point.y)}`,destinationName:c.label}))];
    }
  }
  return finish(!!added||retrofit.changed,added);
}
function legacyTravel(state,request){
  const coords=state.getLastCoords(),key=`${coords.x},${coords.y},${coords.z}`;
  if(!Flags.on('CITY_SITES')||!Flags.on('ARCHITECTURE_EXPANSION')||state.getGamePaused()||request.runId!==state.getDungeonRunId()||request.geoKey!==key)
    throw Error('The building or adventure changed.');
  const d=state.getRoomDungeonForSimulation(coords),control=d?.cityCirculation?.controls.find(c=>c.id===request.controlId);
  if(!control||request.geometryStamp!==d._geometryStamp)throw Error('The saved stair or lift landing changed; approach it again.');
  const near=[control.point,control.trigger].filter(Boolean).some(p=>Math.hypot(p.x-request.player?.x,p.y-request.player?.y)<=2.8&&I.lineClear(d,request.player,p));
  if(!near||!I.pointWalkable(d,request.player?.x,request.player?.y))throw Error('Walk to the stair or lift first.');
  const floor=control.mode==='street'?0:control.mode==='stairs'?control.floor+(control.direction==='up'?1:-1):request.floor;
  if(!Number.isInteger(floor)||floor<0||floor>=control.storeys||floor===control.floor&&control.mode!=='street')throw Error('Choose another existing building floor.');
  const db=JSON.parse(state.getRoomNameDatabase()||'{}'),room=db[key];let groundKey,building;
  if(control.buildingId){
    building=d.cityBlocks.buildings.find(b=>b.id===control.buildingId);if(!building)throw Error('The building is unavailable.');
    const site=room?.environmentIntent?.citySite||db[room?.cityRoom?.anchorKey]?.environmentIntent?.citySite;
    groundKey=require('./cityInteriors').connect(db,key,building,{genre:d.cityBlocks.streaming.genre,site,position:control.arrival}).groundKey;
  }else groundKey=room?.cityRoom?.vertical?.groundKey;
  const ground=db[groundKey],directory=ground?.cityRoom?.vertical?.directory,target=directory?.find(row=>row.floor===floor);
  if(!target||!db[target.key])throw Error('This building floor has no saved connection.');
  let targetKey=target.key,arrival=null;
  const frontage=ground.cityRoom.frontage;
  if(floor===0&&frontage&&!ground.cityRoom.authored){
    const hostCoords=Object.fromEntries(['x','y','z'].map((axis,i)=>[axis,Number(frontage.sourceKey.split(',')[i])]));
    const host=state.getRoomDungeonForSimulation(hostCoords),landing=host?.cityCirculation?.controls.find(c=>c.buildingId===frontage.buildingId&&c.mode===control.mode);
    const point=landing?.arrival||frontage.position;
    if(point&&I.pointWalkable(host,point.x,point.y)){targetKey=frontage.sourceKey;arrival={...point};}
  }
  const roomNameDatabaseString=JSON.stringify(db);state.setRoomNameDatabase(roomNameDatabaseString);
  return{runId:request.runId,geoKey:key,targetKey,buildingId:building?.id||frontage?.buildingId||groundKey,
    controlId:control.id,name:db[targetKey].name,direction:floor>control.floor?'up':'down',arrival,roomNameDatabaseString};
}
function travel(state,request,options){
  if(typeof state.importSaveState!=='function')return legacyTravel(state,request);
  return require('./cityFloorTravel').transition(state,request,options);
}
module.exports={VERSION,install,travel,legacyTravel};
