'use strict';
function install(d,b){
  const a=b.visualStyle?.architecture;if(!a?.heritage)return 0;
  const room=b.rooms?.find(r=>r.use==='public-lobby');if(!room)return 0;
  d.sceneStructures||=[];d.tiles||={};
  const prefix=b.id+':arcade:';if(d.sceneStructures.some(s=>s.id?.startsWith(prefix)))return 0;
  const horizontal=b.lobbyKind==='lateral-concourse',length=horizontal?room.width:room.depth,
    breadth=horizontal?room.depth:room.width,clearance=b.clearance;
  if(a.tradition==='greek')return 0; // Greek colonnades are supplied by the original street kit, not forced into arched aisles.
  const shape='aqueduct_arch__v0',tile=`city_arcade_${shape}_${a.paletteName}_${horizontal?'y':'x'}`;
  d.tiles[tile]||={spriteSpec:{voxelShape:shape,material:'stone',cityKit:{palette:a.paletteName},cityArcade:{axis:horizontal?'y':'x'},collisionBlocking:false}};
  let count=0;
  for(let offset=2;offset<length-3&&count<6;offset+=5){
    // Put supports on existing masonry, not in the open aisle; these arches span the usable lobby.
    const x=horizontal?room.x+offset:room.x-1,y=horizontal?room.y-1:room.y+offset,span=breadth+2;
    const left={x,y},right=horizontal?{x,y:y+span-1}:{x:x+span-1,y};
    if(![left,right].every(p=>['wall','torch'].includes(d.cells[`${p.x},${p.y}`]?.tile)))continue;
    d.sceneStructures.push({id:prefix+count,role:'city-lobby-arcade',shape,tile,cityParcel:b.id,cullDistance:64,
      position:{x:horizontal?x-.1:x,y:horizontal?y:y-.1,z:b.base+.24},
      size:{x:horizontal?.4:span,y:horizontal?span:.4,z:clearance}});count++;
  }
  return count;
}
module.exports={install};
