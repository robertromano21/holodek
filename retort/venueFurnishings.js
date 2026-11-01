'use strict';
const F=require('../assets/genreFurnishings'),E=require('../assets/cityEstablishments');
const RECIPES={
  shop:['wares','workstation','storage','noticeboard','vessel'],inn:['sleeping','wardrobe','table','seat','basin'],
  bar:['food','table','seat','vessel','instrument'],workshop:['craft','tools','storage','workstation','wares'],
  clinic:['medical','basin','storage','workstation','seat'],home:['sleeping','wardrobe','table','food','seat','basin','planter'],
  civic:['workstation','table','seat','bookshelf','noticeboard'],warehouse:['storage','wares','transport','workstation','tools'],
  arena:['barrier','seat','stage','noticeboard','storage'],guild:['craft','tools','table','bookshelf','noticeboard'],
  park:['seat','planter','noticeboard','vessel'],library:['bookshelf','bookshelf','research','table','seat','vessel'],
  theatre:['stage','seat','instrument','wardrobe','storage'],bathhouse:['basin','seat','wardrobe','planter','device'],
  transit:['seat','noticeboard','communication','storage','transport'],temple:['altar','seat','communication','planter','bookshelf'],
  court:['workstation','table','seat','bookshelf','noticeboard'],foodhall:['food','table','seat','wares','vessel','basin']
};
function roles(type,use=''){
  if(/entrance|lobby|foyer|reception|waiting|concourse/.test(use))return['noticeboard','seat','planter','workstation'];
  if(/sleep|guest chamber|changing/.test(use))return['sleeping','wardrobe','seat','basin'];
  if(/kitchen|food|serving/.test(use))return['food','table','vessel','wares','basin'];
  if(/stock|supply|storage|loading/.test(use))return['storage','wares','tools','transport'];
  if(/archive|records|research/.test(use))return['bookshelf','research','table','seat'];
  if(/treatment/.test(use))return['medical','basin','storage','seat'];
  return RECIPES[type]||RECIPES.civic;
}
function place(d,rooms,{type,genre,kit,id,role='city-venue-furniture',parcel=null,max=64}={}){
  const parts=[],sites=[],occupied=new Set();let counterPlaced=false;d.tiles||={};
  for(const part of d.sceneStructures||[])if(part.position&&part.size&&part.size.x<=8&&part.size.y<=8&&
    !/^city-(?:building-foundation|walkin-roof|occupied-tower|venue-entryframe|park-railing|floor-ceiling|classical-ceiling-rib|classical-vault)$/.test(part.role||''))for(let y=Math.floor(part.position.y);y<Math.ceil(part.position.y+part.size.y);y++)
    for(let x=Math.floor(part.position.x);x<Math.ceil(part.position.x+part.size.x);x++)occupied.add(`${x},${y}`);
  for(const [index,r]of rooms.entries()){
    const w=r.w||r.width,h=r.h||r.depth;if(w<3||h<3)continue;
    const use=r.venueUse||r.use||type,choices=[],rx=r.x+Math.floor(w/2),ry=r.y+Math.floor(h/2);
    for(let y=r.y+1;y<r.y+h-1;y++)for(let x=r.x+1;x<r.x+w-1;x++){
      if(w>=8&&Math.abs(x-rx)<=1||h>=8&&Math.abs(y-ry)<=1)continue; // Preserve broad circulation in larger rooms.
      if(Math.min(x-r.x,r.x+w-1-x,y-r.y,r.y+h-1-y)>2)continue;
      choices.push({x,y});
    }
    choices.sort((a,b)=>E.hash(`${id}:${index}:${a.x},${a.y}`)-E.hash(`${id}:${index}:${b.x},${b.y}`));
    const recipe=roles(type,use),target=Math.min(12,Math.max(3,Math.floor(w*h/24)));
    let placed=0;
    for(const p of choices){
      if(placed>=target||parts.length>=max)break;
      const serviceCounter=!counterPlaced&&!!E.serviceNotice({type}),furnishing=serviceCounter?'wares':recipe[placed%recipe.length],shape=`f_${genre}_${furnishing}`,metres=F.dimensions(shape);if(!metres)continue;
      const size={x:metres[0]/2.5,y:metres[1]/2.5,z:metres[2]/2.5},position={x:p.x+.5-size.x/2,y:p.y+.5-size.y/2};
      const keys=[];let valid=true,base=d.cells[`${p.x},${p.y}`]?.floorHeight||0;
      for(let y=Math.floor(position.y);y<Math.ceil(position.y+size.y);y++)for(let x=Math.floor(position.x);x<Math.ceil(position.x+size.x);x++){
        const k=`${x},${y}`,c=d.cells[k];keys.push(k);
        if(x<r.x+1||x>=r.x+w-1||y<r.y+1||y>=r.y+h-1||!c||c.tile!=='floor'||parcel&&c.cityParcel!==parcel||c.object||c.cityStep||c.navigationReserved||occupied.has(k)||
          Math.abs((c.floorHeight||0)-base)>.08||(c.ceilHeight??Infinity)-base<size.z+.1||Math.hypot(x-d.start.x,y-d.start.y)<3)valid=false;
      }
      if(!valid)continue;
      for(const k of keys)occupied.add(k);
      const tile='city_furnished_'+shape;d.tiles[tile]||={spriteSpec:{voxelShape:shape,material:kit.voxel,palette:kit.palette,collisionBlocking:false}};
      const part={id:`${id}:room:${index}:furniture:${placed}`,role,tile,shape,venueId:id,use,position:{...position,z:base},size,cullDistance:40,
        ...(parcel?{cityParcel:parcel}:{}),...(serviceCounter?{serviceCounter:true}:{})};
      parts.push(part);
      const adjacent=[[0,1],[1,0],[0,-1],[-1,0]].map(([dx,dy])=>({x:p.x+dx,y:p.y+dy})).find(q=>{
        const c=d.cells[`${q.x},${q.y}`];return c?.tile==='floor'&&!occupied.has(`${q.x},${q.y}`)&&!c.navigationReserved;});
      if(adjacent)sites.push({id:part.id,role:furnishing,use,position:adjacent,...(serviceCounter?{serviceCounter:true}:{})});
      counterPlaced ||= serviceCounter;
      placed++;
    }
  }
  d.sceneStructures||=[];d.sceneStructures.push(...parts);return{parts,sites};
}
module.exports={RECIPES,roles,place};
