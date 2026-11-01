'use strict';
// Fit a level occupied floor to real terrain. Only the lot and its validated approaches are graded.
function approaches(d,b,base,{protectedKeys=new Set(),claimed=new Set(),reachable}={}){
  const mx=b.left+Math.floor(b.width/2),my=b.top+Math.floor(b.depth/2),edges=[
    {side:'north',x:mx,y:b.top,dx:0,dy:-1},{side:'south',x:mx,y:b.top+b.depth-1,dx:0,dy:1},
    {side:'west',x:b.left,y:my,dx:-1,dy:0},{side:'east',x:b.left+b.width-1,y:my,dx:1,dy:0}];
  const cells=new Map(),entries=[];
  for(const edge of edges){
    let chosen=null;
    for(let length=1;length<=24&&!chosen;length++){
      const patch=new Map();let fits=true;
      for(let lane=-1;lane<=1&&fits;lane++){
        const endX=edge.x+edge.dx*(length+1)+(edge.dy?lane:0),endY=edge.y+edge.dy*(length+1)+(edge.dx?lane:0),end=d.cells[`${endX},${endY}`];
        if(!end||end.tile!=='floor'||reachable&&!reachable[endY*d.layout.width+endX]||
          Math.abs((end.floorHeight||0)-(base+.08))/(length+1)>.2){fits=false;break;}
        for(let step=1;step<=length;step++){
          const x=edge.x+edge.dx*step+(edge.dy?lane:0),y=edge.y+edge.dy*step+(edge.dx?lane:0),key=`${x},${y}`,c=d.cells[key];
          const floorHeight=base+.08+((end.floorHeight||0)-base-.08)*step/(length+1);
          if(!c||c.tile!=='floor'||c.cityParcel||c.cityApproach&&c.cityApproach!==b.id||c.object||c.feature||c.roof||c.blocked||c.obstacle||
            protectedKeys.has(key)||claimed.has(key)||c.navigationReserved&&Math.abs(floorHeight-(c.floorHeight||0))>.001){fits=false;break;}
          patch.set(key,{...c,floorHeight,ceilHeight:Math.max(c.ceilHeight||0,floorHeight+3),cityApproach:b.id,
            architectureRole:'city-graded-approach',floorSurface:'city_sidewalk_surface'});
        }
      }
      if(fits)chosen={side:edge.side,length,cells:patch};
    }
    if(chosen){for(const [key,c]of chosen.cells)cells.set(key,c);entries.push({side:chosen.side,length:chosen.length});}
  }
  return{cells,entries,sides:entries.map(e=>e.side)};
}
module.exports={approaches};
