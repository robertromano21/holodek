'use strict';
const Plans=require('../assets/cityBuildingPlans'),K=require('../assets/cityKit');
function part(d,id,role,shape,position,size,palette,parcel){
  const tile=`classical_${shape}_${palette}`;
  const p=K.PALETTES[palette]||K.PALETTES.marble;
  d.tiles||={};d.sceneStructures||=[];
  d.tiles[tile]||={spriteSpec:{voxelShape:shape,material:'stone',palette:{primary:p.body,secondary:p.trim,highlight:p.trim,shadow:p.dark},collisionBlocking:false}};
  d.sceneStructures.push({id,role,shape,tile,position,size,cityParcel:parcel,cullDistance:80});
}
function frontage(d,b){
  const a=b.visualStyle?.architecture;
  if(!Plans.classical(a?.profile))return 0;
  const prefix=b.id+':classical:';
  if(d.sceneStructures?.some(p=>p.id?.startsWith(prefix)))return 0;
  // A portico projects into the reserved approach; its columns flank the actual three-cell door.
  // No new walls or painted "entrances" are introduced into the saved navigation grid.
  let count=0;
  for(const side of ['north','south']){
    if(!b.entrySides?.includes(side))continue;
    const mid=b.left+Math.floor(b.width/2)+.5,y=side==='north'?b.top-1.05:b.top+b.depth+.55,
      height=b.clearance-.12,span=Math.min(10,b.width-4),palette=a.paletteName;
    for(const x of [mid-span/2,mid-2.4,mid+2.4,mid+span/2]){
      part(d,prefix+side+':column:'+x,'city-classical-column',a.tradition==='greek'?'doric_column':'ionic_column',
        {x:x-.34,y:y-.34,z:b.base+.16},{x:.68,y:.68,z:height-.35},palette,b.id);count++;
    }
    part(d,prefix+side+':lintel','city-classical-entablature','entablature',
      {x:mid-span/2-.5,y:y-.5,z:b.base+height-.2},{x:span+1,y:1,z:.5},palette,b.id);count++;
    if(['temple','civic','guild','court','library'].includes(b.type)){
      part(d,prefix+side+':pediment','city-classical-pediment','pediment',
        {x:mid-span/2-.5,y:y-.5,z:b.base+height+.28},{x:span+1,y:1,z:Math.min(2.6,span*.22)},palette,b.id);count++;
    }
  }
  return count;
}
function ceilings(d){
  const city=d.sceneSpec?.city,genre=city?.genre;
  if(!Plans.classical(genre)||city?.architecture?.authored)return 0;
  d.sceneStructures=(d.sceneStructures||[]).filter(p=>p.role!=='city-classical-ceiling-rib');
  const panels=d.sceneStructures.filter(p=>p.role==='city-floor-ceiling'),palette=genre==='dark-fantasy'?'basalt':'sandstone';
  let count=0;
  // Dress only intact, high panels: raised shaft caps and narrow openings remain completely clear.
  for(const p of panels){
    const {position:q,size:s}=p;
    if(count>=32||s.x<4||s.y<4)continue;
    const floor=d.cells[`${q.x},${q.y}`]?.floorHeight||0;
    if(q.z-floor<2.8)continue;
    for(const t of [.25,.75]){
      part(d,`classical:ceiling:${count}`,'city-classical-ceiling-rib','entablature',
        {x:q.x,y:q.y+s.y*t-.10,z:q.z-.18},{x:s.x,y:.20,z:.2},palette);count++;
    }
  }
  return count;
}
function interior(d){
  const city=d.sceneSpec?.city,style=city?.architecture?.plan?.architectureStyle;
  if(!Plans.classical(city?.genre)||!style||city?.architecture?.authored||d.classicalInterior)return{changed:false};
  const Nav=require('./sceneArchitecture'),palette=style.paletteName||'marble',
    p=K.PALETTES[palette],shape=style.tradition==='medieval'?'gothic_pier':style.tradition==='greek'?'doric_column':'ionic_column',tile=`classical_support_${shape}_${palette}`;
  d.tiles[tile]={spriteSpec:{voxelShape:shape,material:'stone',heightRatio:1,baseWidth:.65,
    palette:{primary:p.body,secondary:p.trim,highlight:p.trim,shadow:p.dark}}};
  let columns=0,vaults=0;
  for(const r of d.indoorRooms||[]){
    if(r.w<7||r.h<7)continue;
    const ceiling=r.floor+r.clearance,publicRoom=['temple','civic','guild','court','library','foodhall','bathhouse'].includes(city.establishmentType);
    if(!publicRoom)continue;
    for(let y=r.y+2;y<r.y+r.h-2&&columns<24;y+=5)for(const x of [r.x+1,r.x+r.w-2]){
      const key=`${x},${y}`,c=d.cells[key];
      if(c?.tile!=='floor'||c.navigationReserved||c.cityCirculation||c.feature||c.object||c.interactable||c.roofless||
        Math.hypot(x+.5-d.start.x,y+.5-d.start.y)<2.5||Math.abs(c.floorHeight-r.floor)>.01)continue;
      const before=Nav.reachable(Nav.makeNavigation(d),d.start);
      d.cells[key]={...c,tile,feature:'pillar',structureHeight:r.clearance,architectureRole:'roof-support'};
      const nav=Nav.makeNavigation(d),after=Nav.reachable(nav,d.start);
      if(before.seen.some((v,i)=>v&&nav.passable[i]&&!after.seen[i])){d.cells[key]=c;continue;}
      columns++;
    }
    // Reuse the original vault meshes within this storey's real headroom, never above its next floor.
    if(vaults>=2||r.clearance<4||r.w<9||r.h<9)continue;
    const span=Math.min(7,r.w-2,r.h-2),x=r.x+Math.floor((r.w-span)/2),y=r.y+Math.floor((r.h-span)/2),keys=[];
    for(let dy=0;dy<span;dy++)for(let dx=0;dx<span;dx++)keys.push(`${x+dx},${y+dy}`);
    if(keys.some(k=>{const c=d.cells[k];return c?.tile!=='floor'||c.cityCirculation||c.roofless||c.architectureRole==='stair-tread'||
      c.architectureRole==='stair-landing'||Math.abs(c.floorHeight-r.floor)>.01||Math.abs(c.ceilHeight-ceiling)>.01;}))continue;
    const dome=['rotunda','bathhouse'].includes(style.family)||style.tradition==='byzantine',rise=Math.min(1.4,r.clearance-2.8),spring=ceiling-rise;
    part(d,`classical:vault:${vaults}`,'city-classical-vault',dome?'dome_shell':'groin_vault_shell',
      {x,y,z:spring},{x:span,y:span,z:rise},palette);
    if(dome){
      part(d,`classical:oculus-cap:${vaults}`,'city-classical-vault','coffered_slab',
        {x:x+span*.4,y:y+span*.4,z:ceiling-.02},{x:span*.2,y:span*.2,z:.08},palette);
    }
    for(const k of keys){const c=d.cells[k];c.classicalVault=true;c.roof={version:1,style:dome?'domed':'groin',height:ceiling,slopeX:0,slopeY:0};}
    vaults++;
  }
  d.classicalInterior={version:1,columns,vaults,source:'native-cotg-architecture',family:style.family};
  require('./cityFloorCeilings').install(d);
  return{changed:true,columns,vaults};
}
module.exports={frontage,ceilings,interior};
