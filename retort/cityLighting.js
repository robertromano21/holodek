'use strict';
const Fixtures=require('../assets/genreFixtures'),Kits=require('../assets/genreKits');
const Architecture=require('../assets/cityArchitectureStyles');
function fixture(d,{id,genre,kit,x,y,z,role,parcel,ceiling,post=false}){
  const era=Architecture.profile(genre,kit?.locked&&genre===kit.genre),index=['torch','gas'].includes(era.fixture)?1:
    ['candle','oil','flame'].includes(era.fixture)?0:require('../assets/cityParcels').hash(id);
  const chosen=Fixtures.select(genre,index);if(!chosen)return;
  const shape=Object.keys(Fixtures.SHAPES).find(key=>Fixtures.SHAPES[key]===chosen),tile='city_fixture_'+shape;
  const support=`g_${genre}_support`,pole='city_fixture_support_'+genre;
  d.tiles[tile]||={spriteSpec:{voxelShape:shape,material:kit.voxel,palette:kit.palette,collisionBlocking:false}};
  d.tiles[pole]||={spriteSpec:{voxelShape:support,material:kit.voxel,palette:kit.palette,collisionBlocking:false}};
  const floor=d.cells[`${Math.floor(x)},${Math.floor(y)}`]?.floorHeight||0;
  d.sceneStructures.push({id,role,cityParcel:parcel,tile,shape,position:{x:x-.2,y:y-.2,z},size:{x:.4,y:.4,z:.4},cullDistance:64});
  const bottom=post?floor:z+.4,top=post?z:ceiling;
  if(Kits.has(support)&&Number.isFinite(top)&&top>bottom+.05)d.sceneStructures.push({id:id+':support',role:role+'-support',cityParcel:parcel,
    tile:pole,shape:support,position:{x:x-.035,y:y-.035,z:bottom},size:{x:.07,y:.07,z:top-bottom},cullDistance:64});
}
function rooms(d,rooms,{genre,kit,id,parcel,role='city-interior-light'}={}){
  if(!require('./worldFlags').on('GENRE_LIGHTS'))return;
  d.tiles||={};d.sceneStructures||=[];
  for(const [i,r]of rooms.entries()){
    const width=r.width||r.w,depth=r.depth||r.h,nx=Math.max(1,Math.ceil(width/10)),ny=Math.max(1,Math.ceil(depth/10));
    for(let iy=0;iy<ny;iy++)for(let ix=0;ix<nx;ix++){
      const x=Math.floor(r.x+(ix+.5)*width/nx)+.5,y=Math.floor(r.y+(iy+.5)*depth/ny)+.5,c=d.cells[`${Math.floor(x)},${Math.floor(y)}`];
      if(c?.tile!=='floor'||parcel&&c.cityParcel!==parcel)continue;
      const floor=c.floorHeight||0,ceiling=c.roof?.height||c.ceilHeight||floor+2.5,z=Math.min(ceiling-.5,floor+1.2);
      fixture(d,{id:`${id}:light:${i}:${ix},${iy}`,genre,kit,x,y,z,ceiling,role,parcel});
    }
  }
}
function streets(d,{genre,kit}={}){
  if(!require('./worldFlags').on('GENRE_LIGHTS'))return;
  d.tiles||={};d.sceneStructures||=[];
  const known=new Set((d.sceneStructures||[]).filter(s=>s.role==='city-street-light').map(s=>s.id));
  for(const [key,c]of Object.entries(d.cells||{}))if(c.cityStreet==='sidewalk'&&!c.cityParcel&&!c.object&&!c.feature&&c.tile==='floor'){
    const [x,y]=key.split(',').map(Number),id=`${d.geoKey}:streetlamp:${key}`;
    if((x+y)%12||known.has(id))continue;
    fixture(d,{id,genre,kit,x:x+.5,y:y+.5,z:(c.floorHeight||0)+1.4,role:'city-street-light',post:true});
  }
}
function facades(d,b,{genre,kit}={}){
  if(!require('./worldFlags').on('GENRE_LIGHTS')||Architecture.profile(genre,kit?.locked&&genre===kit.genre).fixture!=='torch')return;
  const mounts=new Set();
  for(const door of b.doors||[])for(const delta of [-3,3]){
    const horizontal=door.y===b.top||door.y===b.top+b.depth-1,x=door.x+(horizontal?delta:0),y=door.y+(horizontal?0:delta),key=`${x},${y}`,c=d.cells[key];
    if(mounts.size>=8||!c||c.tile!=='wall'||c.feature||c.object||c.cityParcel!==b.id)continue;
    const facing=horizontal?(door.y===b.top?'N':'S'):(door.x===b.left?'W':'E');
    // Reuse the native torch renderer and occlusion on an already-solid wall. Doorways and walkable cells never change.
    d.cells[key]={...c,tile:'torch',torchFacing:facing,torchMountHeight:Math.min(1.5,b.clearance-.35)};mounts.add(key);
  }
}
module.exports={rooms,streets,facades};
