'use strict';
const VERSION=3;
function openStreetRoof(d,control,opening){
  const result=[];
  for(const p of d.sceneStructures||[]){
    const a=p.position,s=p.size;
    if(p.role!=='city-walkin-roof'||p.cityParcel!==control.buildingId||!a||!s){result.push(p);continue;}
    const x0=Math.max(a.x,opening.x),y0=Math.max(a.y,opening.y),x1=Math.min(a.x+s.x,opening.x+opening.width),y1=Math.min(a.y+s.y,opening.y+opening.depth);
    if(x0>=x1||y0>=y1){result.push(p);continue;}
    for(const [x,y,w,h]of [[a.x,a.y,x0-a.x,s.y],[x1,a.y,a.x+s.x-x1,s.y],[x0,a.y,x1-x0,y0-a.y],[x0,y1,x1-x0,a.y+s.y-y1]])
      if(w>.001&&h>.001)result.push({...p,position:{...a,x,y},size:{...s,x:w,y:h},stairOpening:control.id});
  }
  d.sceneStructures=result;
}
function riseFor(d,{direction,base=0,ceiling,building}={}){
  const vertical=d.sceneSpec?.city?.vertical;
  if(direction==='down')return Math.max(1.2,vertical?.floor===1&&vertical.elevationMetres?vertical.elevationMetres/2.5:(vertical?.storeyHeightMetres||3.4)/2.5);
  return Math.max(1.2,(ceiling??base+(building?.clearance||2.5))-base+.16);
}
function rowsFor(d,building){
  const p=building?.rooms?.[0]||d.indoorRooms?.[0],cell=p&&d.cells[`${Math.floor(p.x+1)},${Math.floor(p.y+1)}`];
  const base=cell?.floorHeight||0,ceiling=cell?.roof?.height??cell?.ceilHeight??base+2.5;
  return Math.max(4,1+Math.ceil(Math.max(riseFor(d,{base,ceiling,building}),riseFor(d,{direction:'down',base,ceiling,building}))/1.35));
}
function build(d,control,{x,y,base,rows=4,rotated=false,part,building}={}){
  const at=(u,v)=>({x:x+(rotated?v:u),y:y+(rotated?u:v)}),landing=at(0,rows+1);
  const landingCell=d.cells[`${landing.x},${landing.y}`],ceiling=landingCell?.roof?.height??landingCell?.ceilHeight??base+2.5;
  const rise=riseFor(d,{direction:control.direction,base,ceiling,building}),down=control.direction==='down';
  const flightRows=down?rows:rows-1;
  if(rise/flightRows>1.5)return null;
  const sign=down?-1:1,headroom=1.15,openingZ=down?base:ceiling,upperRoof=down?ceiling:Math.max(ceiling,base+rise+headroom);
  const detailed=!!d.cityFloorContext,subdivisions=detailed?4:1;
  for(let row=0;row<rows;row++){
    const height=sign*rise*Math.min(1,(rows-row)/flightRows);
    for(let u=0;u<2;u++){
      const p=at(u,row),key=`${p.x},${p.y}`,c=d.cells[key];
      d.cells[key]={...c,floorHeight:base+height,ceilHeight:upperRoof,
        roof:{...c.roof,version:1,style:'panel',height:upperRoof,slopeX:0,slopeY:0},stairwell:control.id};
    }
    // Fine treads follow the same floor-to-floor rise as the coarse navigation grid.
    if(detailed&&!down&&row===0)part('city-stair-upper-landing',0,0,base+rise-.16,2,1,.16);
    for(let sub=0;sub<(down||row>0?subdivisions:0);sub++){
      const v=row+sub/subdivisions,top=base+sign*rise*(rows-v)/flightRows,low=down?base-rise-.1:base-.1;
      part('city-stair-tread',0,v,low,2,1/subdivisions,Math.max(.02,top-low));
    }
    for(const side of [0,1.94]){
      if(detailed||row===0)part('city-stair-baluster',side,row,base+height,.06,.06,.85);
      if(detailed||row===0)part('city-stair-handrail',side,row,base+height+.8,.06,detailed?1:rows,.08);
    }
  }
  const openingRows=down?rows:rows+1;
  if(!down)for(let u=0;u<2;u++){
    const p=at(u,rows),c=d.cells[`${p.x},${p.y}`];
    d.cells[`${p.x},${p.y}`]={...c,ceilHeight:upperRoof,roof:{...c.roof,version:1,style:'panel',height:upperRoof,slopeX:0,slopeY:0},stairwell:control.id};
  }
  for(const side of [-.08,1.96])part('city-stair-opening-frame',side,-.08,openingZ-.12,.12,openingRows+.16,.16);
  if(detailed)for(const end of [-.08,openingRows-.04])part('city-stair-opening-frame',-.08,end,openingZ-.12,2.16,.12,.16);
  const opening={...at(0,0),width:rotated?openingRows:2,depth:rotated?2:openingRows,height:openingZ};
  if(!down&&!d.cityFloorContext){
    openStreetRoof(d,control,opening);
    part('city-stair-shaft-cap',0,0,upperRoof-.04,2,openingRows,.22);
  }
  control.stairwell={version:VERSION,rise,rows,rotated,base,ceiling,opening,headroom,upperLanding:down?null:{...at(0,0),width:rotated?1:2,depth:rotated?2:1,height:base+rise}};
  control.triggerArea={...at(0,0),width:rotated?1:2,depth:rotated?2:1};
  control.box={...control.box,z:down?base-rise:base,sz:rise+headroom};
  return control.stairwell;
}
function upgrade(d,{protectedKeys=new Set()}={}){
  if(!d.cityCirculation?.controls||d.sceneSpec?.city?.architecture?.authored)return{changed:false};
  let changed=false;
  for(const control of d.cityCirculation?.controls||[]){
    if(control.mode!=='stairs'||control.stairwell?.version===VERSION)continue;
    const box=control.box,rotated=control.stairwell?.rotated??(box.sx>box.sy),x=box.x,y=box.y,rows=control.stairwell?.rows||4;
    const cells=[];
    for(let v=0;v<rows+2;v++)for(let u=0;u<2;u++){
      const key=`${x+(rotated?v:u)},${y+(rotated?u:v)}`;if(d.cells[key]?.cityCirculation===control.id)cells.push([key,d.cells[key]]);
    }
    if(!cells.length||cells.some(([key])=>protectedKeys.has(key)))continue;
    const base=d.cells[`${Math.floor(control.arrival.x)},${Math.floor(control.arrival.y)}`]?.floorHeight||0;
    const landing=d.cells[`${Math.floor(control.arrival.x)},${Math.floor(control.arrival.y)}`];
    if(riseFor(d,{base,ceiling:landing?.roof?.height??landing?.ceilHeight,direction:control.direction})/(control.direction==='down'?rows:rows-1)>1.5)continue;
    const matching=s=>s.role?.startsWith('city-stair-')&&(s.cityCirculation===control.id||s.position&&
      s.position.x>=x&&s.position.x<x+(rotated?rows:2)&&s.position.y>=y&&s.position.y<y+(rotated?2:rows));
    const exemplar=(d.sceneStructures||[]).find(matching);if(!exemplar)continue;
    d.sceneStructures=d.sceneStructures.filter(s=>!matching(s));
    if(d.cityFloorContext)for(const cell of Object.values(d.cells))if(cell.tile==='floor'&&!cell.roof)
      cell.roof={version:1,style:'panel',height:cell.ceilHeight,slopeX:0,slopeY:0};
    const part=(role,u,v,z,sx,sy,sz)=>d.sceneStructures.push({role,tile:exemplar.tile,shape:exemplar.shape,cityCirculation:control.id,
      position:{x:x+(rotated?v:u),y:y+(rotated?u:v),z},size:{x:rotated?sy:sx,y:rotated?sx:sy,z:sz},cullDistance:48});
    build(d,control,{x,y,base,rows,rotated,part});changed=true;
  }
  return{changed};
}
module.exports={VERSION,riseFor,rowsFor,build,upgrade,openStreetRoof};
