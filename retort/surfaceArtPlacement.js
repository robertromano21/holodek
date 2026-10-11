'use strict';

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
  return{faces,map};
}

function mountWall({faces,map},row,used,groups=new Map(),centers=[]){
  let best=null;
  for(const face of faces){
    if(used.has(face.key)||row.puzzleClue&&face.d>8)continue;
    const mural=row.kind==='fresco'&&row.format!=='panel'&&!row.puzzleClue;
    const desired=mural?Math.max(1,Math.min(8,Math.ceil((face.top-Math.max(face.z+.35,face.base+.08)-.12)*1.5+.2))):1;
    for(let span=desired;span>=1;span--){
      const start=face.along-Math.floor((span-1)/2),strip=[];
      for(let i=0;i<span;i++){
        const f=map.get(`${face.group}:${start+i}`);
        if(!f||used.has(f.key)||row.puzzleClue&&f.d>8)break;
        strip.push(f);
      }
      if(strip.length!==span)continue;
      const bottom=mural?Math.max(...strip.map(f=>Math.max(f.z+.35,f.base+.08))):face.z+.65;
      const ceiling=Math.min(...strip.map(f=>f.top))-.12;
      const height=mural?Math.min(5.2,ceiling-bottom,(span-.2)/1.5):.6;
      if(height<(mural?.5:.6))continue;
      const width=mural?height*1.5:.8,offset=start+(span-width)/2;
      const plane=face.plane+(face.sign===1?1.01:-.01);
      const position={x:face.axis==='x'?plane:offset,y:face.axis==='y'?plane:offset,z:bottom};
      const size={x:face.axis==='x'?.02:width,y:face.axis==='y'?.02:width,z:height};
      const center={x:position.x+size.x/2,y:position.y+size.y/2};
      const separated=centers.length?Math.min(...centers.map(p=>Math.hypot(p.x-center.x,p.y-center.y))):0;
      const score=width*8-(groups.get(face.group)||0)*30+Math.min(12,separated)-face.d*.04;
      if(!best||score>best.score)best={key:face.key,keys:strip.map(f=>f.key),axis:face.axis,sign:face.sign,surface:'wall',position,size,group:face.group,center,score};
      break;
    }
  }
  if(!best)return null;
  const{score,group,center,...mount}=best;
  groups.set(group,(groups.get(group)||0)+1);centers.push(center);
  return mount;
}

module.exports={wallFaces,mountWall};
