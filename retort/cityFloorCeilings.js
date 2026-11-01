'use strict';
const VERSION=2,MAX_SPAN=8;
function install(d){
  if(!d?.cityFloorContext||!d.cells||d.sceneSpec?.city?.architecture?.authored)return{changed:false};
  const open=d.sceneRoof?.coverage?.openZones||[],heights=new Map();
  for(const [key,c]of Object.entries(d.cells)){
    const [x,y]=key.split(',').map(Number);
    if(c.tile!=='floor'||c.roofless||open.some(z=>x>=z.x&&y>=z.y&&x<z.x+z.width&&y<z.y+z.height))continue;
    const height=c.roof?.height??c.ceilHeight;
    if(!Number.isFinite(height)||height-(c.floorHeight||0)<.95)continue;
    c.roof||={version:1,style:'panel',height,slopeX:0,slopeY:0};heights.set(key,height);
  }
  const genre=d.sceneSpec?.city?.genre||d.genreKit?.genre||'fantasy',kit=require('../assets/genreKits').resolve({genre});
  const signature=require('../assets/cityParcels').hash(JSON.stringify([genre,[...heights]])),old=d.cityFloorCeiling;
  if(old?.version===VERSION&&old.signature===signature&&(d.sceneStructures||[]).filter(s=>s.role==='city-floor-ceiling').length===old.parts)
    return{changed:false};
  const tile=`city_floor_ceiling_${genre}`,classical=d.sceneSpec?.city?.architecture?.plan?.architectureStyle,
    shape=classical&&require('../assets/cityBuildingPlans').classical(genre)?'coffered_slab':`g_${genre}_roof_panel`,profile=require('../assets/genreCeilings').PROFILES[genre];
  d.tiles||={};d.tiles[tile]={spriteSpec:{voxelShape:shape,material:profile?.material||kit.voxel,
    palette:profile?{primary:profile.base,secondary:profile.dark,highlight:profile.accent,shadow:profile.dark}:kit.palette,collisionBlocking:false}};
  if(classical&&shape==='coffered_slab'){
    const p=require('../assets/cityKit').PALETTES[classical.paletteName]||require('../assets/cityKit').PALETTES.marble;
    Object.assign(d.tiles[tile].spriteSpec,{material:'stone',palette:{primary:p.body,secondary:p.trim,highlight:p.trim,shadow:p.dark}});
  }
  const parts=[],remaining=new Map(heights);
  // Bounded panels follow the real envelope and raised stair shaft; no low slab crosses the opening.
  for(const [key,z]of heights){
    if(!remaining.has(key))continue;
    const [x,y]=key.split(',').map(Number);let sx=1,sy=1;
    while(sx<MAX_SPAN&&remaining.get(`${x+sx},${y}`)===z)sx++;
    rows:while(sy<MAX_SPAN){for(let dx=0;dx<sx;dx++)if(remaining.get(`${x+dx},${y+sy}`)!==z)break rows;sy++;}
    for(let dy=0;dy<sy;dy++)for(let dx=0;dx<sx;dx++)remaining.delete(`${x+dx},${y+dy}`);
    parts.push({role:'city-floor-ceiling',tile,shape,position:{x,y,z:z-.04},size:{x:sx,y:sy,z:.22},cullDistance:64});
  }
  d.sceneStructures=[...(d.sceneStructures||[]).filter(s=>s.role!=='city-floor-ceiling'),...parts];
  require('./cityClassicalDetails').ceilings(d);
  d.cityFloorCeiling={version:VERSION,signature,coveredCells:heights.size,parts:parts.length};
  d.sceneRoof={...d.sceneRoof,status:'built',coveredCells:heights.size,parts:parts.length,skyDefault:false,
    coverage:{...d.sceneRoof?.coverage,eligible:heights.size,covered:heights.size,ratio:1,targetMet:true,openZones:open}};
  return{changed:true,parts:parts.length};
}
module.exports={VERSION,install};
