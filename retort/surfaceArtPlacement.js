'use strict';
const Mosaics=require('../assets/mosaicDesigns');

function wallFaces(dungeon,candidates){
  const faces=[],map=new Map();
  for(const c of candidates)for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
    const key=`${c.x+dx},${c.y+dy}`,wall=dungeon.cells[key];
    if(wall?.tile!=='wall'||wall.exit||wall.door||wall.exteriorRole||wall.navigationReserved)continue;
    const floor=dungeon.cells[c.key],base=wall.floorHeight||0,z=floor.floorHeight||0;
    const top=Math.min(base+(wall.structureHeight??Math.max(0,(wall.ceilHeight??base+2)-base)),floor.roof?.height??Infinity,floor.ceilHeight??Infinity);
    if(base>z+.25||top<z+1.3)continue;
    const axis=dx?'x':'y',sign=dx?-dx:-dy,plane=axis==='x'?c.x+dx:c.y+dy,along=axis==='x'?c.y:c.x;
    const group=`${axis}:${plane}:${sign}`,face={key,axis,sign,plane,along,group,z,base,top,d:c.d};
    map.set(`${group}:${along}`,face);faces.push(face);
  }
  return{faces,map,dungeon,viewKeys:new Set(candidates.map(c=>c.key))};
}

function visible(dungeon,a,b){
  const distance=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.ceil(distance*8);
  for(let i=0;i<steps;i++){
    const t=i/steps,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,key=`${Math.floor(x)},${Math.floor(y)}`,c=dungeon.cells[key];
    if(!c||c.tile==='wall'||c.tile==='torch'||c.tile==='door'&&!c.open)return false;
    const s=dungeon.tiles?.[c.tile]?.spriteSpec;
    if(c.tile!=='floor'&&c.tile!=='door'){
      const width=s?.baseWidth||.8,dx=x-(Math.floor(x)+.5),dy=y-(Math.floor(y)+.5);
      if(Math.abs(dx)<width*.5+.08&&Math.abs(dy)<width*.5+.08)return false;
    }
  }
  return true;
}
function viewingPoint(dungeon,mount,viewKeys){
  const p=mount.position,s=mount.size,along=mount.axis==='x'?'y':'x',axis=mount.axis,width=s[along],center={x:p.x+s.x/2,y:p.y+s.y/2};
  for(const distance of[Math.max(1.5,width*.9),Math.max(2.5,width*1.1),Math.max(.75,width*.87)])for(const offset of[0,-.2,.2]){
    const point={...center};point[axis]+=mount.sign*distance;point[along]+=width*offset;
    const key=`${Math.floor(point.x)},${Math.floor(point.y)}`,c=dungeon.cells[key];
    if(viewKeys&&!viewKeys.has(key)||c?.tile!=='floor'||c.feature||c.exit||c.interactable||Math.abs((c.floorHeight||0)-(mount.floorZ??p.z-.35))>.8)continue;
    if([.05,.25,.5,.75,.95].every(t=>{
      const target={...center};target[along]=p[along]+width*t;target[axis]+=mount.sign*.08;
      return visible(dungeon,point,target);
    }))return point;
  }
  return null;
}
function mountWall({faces,map,dungeon,viewKeys},row,used,groups=new Map(),centers=[]){
  let best=null;
  for(const face of faces){
    if(used.has(face.key)||row.puzzleClue&&face.d>8)continue;
    const mural=(row.kind==='fresco'||row.kind==='mosaic')&&row.format!=='panel'&&!row.puzzleClue;
    const ratio=row.kind==='mosaic'?Mosaics.aspectRatio(row):row.kind==='fresco'?(row.aspectRatio||1.5):1.5;
    const frieze=!!(row.carvingStyle||row.moldingStyle)&&row.format==='mural'&&!row.puzzleClue;
    const desired=frieze?(['skirting','baseboard'].includes(row.stoneworkRole)?5:6):mural?Math.max(1,Math.min(8,Math.ceil((face.top-Math.max(face.z+.35,face.base+.08)-.12)*ratio+.2))):1;
    for(let span=desired;span>=1;span--){
      const start=face.along-Math.floor((span-1)/2),strip=[];
      for(let i=0;i<span;i++){
        const f=map.get(`${face.group}:${start+i}`);
        if(!f||used.has(f.key)||row.puzzleClue&&f.d>8)break;
        strip.push(f);
      }
      if(strip.length!==span)continue;
      const ceiling=Math.min(...strip.map(f=>f.top))-.12;
      const floorZ=Math.max(...strip.map(f=>f.z)),cornice=frieze&&row.stoneworkRole==='cornice'&&ceiling-floorZ>=2.5;
      const bottom=frieze?cornice?ceiling-.65:Math.max(...strip.map(f=>Math.max(f.z+(row.stoneworkRole==='baseboard'?.02:row.stoneworkRole==='skirting'?.18:.55),f.base+.08))):
        mural?Math.max(...strip.map(f=>Math.max(f.z+.35,f.base+.08))):face.z+.65;
      const height=frieze?Math.min(row.stoneworkRole==='baseboard'?.3:row.stoneworkRole==='skirting'?.45:row.molding&&row.stoneworkRole==='cornice'?.4:.65,ceiling-bottom):mural?Math.min(5.2,ceiling-bottom,(span-.2)/ratio):.6;
      if(height<(frieze?(row.stoneworkRole==='baseboard'||row.molding?.25:.35):mural?.5:.6))continue;
      const width=frieze?span-.2:mural?height*ratio:.8,offset=start+(span-width)/2;
      const plane=face.plane+(face.sign===1?1.01:-.01);
      const position={x:face.axis==='x'?plane:offset,y:face.axis==='y'?plane:offset,z:bottom};
      const size={x:face.axis==='x'?.02:width,y:face.axis==='y'?.02:width,z:height};
      const center={x:position.x+size.x/2,y:position.y+size.y/2};
      const viewPoint=dungeon?viewingPoint(dungeon,{position,size,axis:face.axis,sign:face.sign,...(frieze?{floorZ}:{})},viewKeys):null;
      if(dungeon&&!viewPoint)continue;
      const separated=centers.length?Math.min(...centers.map(p=>Math.hypot(p.x-center.x,p.y-center.y))):0;
      const score=width*8-(groups.get(face.group)||0)*30+Math.min(12,separated)-face.d*.04;
      if(!best||score>best.score)best={key:face.key,keys:strip.map(f=>f.key),axis:face.axis,sign:face.sign,surface:'wall',position,size,...(viewPoint?{viewPoint}:{}),group:face.group,center,score};
      break;
    }
  }
  if(!best)return null;
  const{score,group,center,...mount}=best;
  groups.set(group,(groups.get(group)||0)+1);centers.push(center);
  return mount;
}

module.exports={wallFaces,mountWall,viewingPoint,visible};
