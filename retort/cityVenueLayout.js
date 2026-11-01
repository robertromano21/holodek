'use strict';
const E=require('../assets/cityEstablishments');
function fit(plan,venue,width,height,architecture){
  if(venue?.version!==1||!E.TYPES.includes(venue.type))return plan;
  if(architecture?.plan?.version===1&&!architecture.authored){
    const saved=architecture.plan,w=saved.width,h=saved.depth;
    if(w>width-4||h>height-4)throw Error('Saved building plan does not fit the scene envelope.');
    const left=Math.floor((width-w)/2),top=Math.floor((height-h)/2);
    return{...plan,venueBounds:{left,top,width:w,depth:h,metresPerCell:2.5,outline:saved.outline},modules:saved.modules||[],heightLevels:[0],
      rooms:saved.rooms.map(r=>({x:(left+r.x)/(width-1),y:(top+r.y)/(height-1),w:r.width/width,h:r.depth/height,
        role:r.role||'chamber',shape:r.shape||'hall',floor:0,clearance:saved.clearance,venueUse:r.use,
        ...(r.roofStyle?{roofStyle:r.roofStyle}:{}),...(r.columnOrder?{columnOrder:r.columnOrder}:{})})),corridors:saved.corridors||[]};
  }
  if(!Array.isArray(plan.rooms)||!plan.rooms.some(r=>[r.x,r.y,r.w,r.h].every(Number.isFinite)&&r.w>0&&r.h>0)){
    const spaces=E.profile(venue.type).spaces;
    plan={...plan,rooms:[{x:.38,y:.74,w:.24,h:.24,role:'entrance'},...spaces.map((_,i)=>({
      x:.03+(i%2)*.5,y:.03+Math.floor(i/2)*.34,w:.44,h:.28,role:'chamber'}))],corridors:[]};
  }
  const profile=E.profile(venue.type),w=Math.min(Number.isInteger(venue.width)&&venue.width>=12&&venue.width<=64?venue.width:profile.width,width-4),
    h=Math.min(Number.isInteger(venue.depth)&&venue.depth>=12&&venue.depth<=64?venue.depth:profile.depth,height-4);
  const left=Math.floor((width-w)/2),top=Math.floor((height-h)/2);
  const project=(value,span,offset,total)=> (offset+value*span)/total;
  return {...plan,venueBounds:{left,top,width:w,depth:h,metresPerCell:2.5,outline:architecture?.plan?.outline},rooms:plan.rooms.map((room,i)=>{
    const rw=Math.max(3/w,Math.min(1,room.w)),rh=Math.max(3/h,Math.min(1,room.h));
    return {...room,
    x:project(Math.max(0,Math.min(1-rw,room.x)),w,left,width),y:project(Math.max(0,Math.min(1-rh,room.y)),h,top,height),w:rw*w/width,h:rh*h/height,
    clearance:venue.storeyClearance||Math.max(Number.isFinite(room.clearance)?room.clearance:0,profile.clearance),
    ...(venue.storeyClearance?{floor:0}:{}),
    venueUse:room.role==='entrance'?'public entrance':profile.spaces[Math.max(0,i-1)%profile.spaces.length]};}),
    corridors:(plan.corridors||[]).map(c=>({...c,...(Array.isArray(c.from)?{from:[project(c.from[0],w,left,width),project(c.from[1],h,top,height)]}:{}),
      ...(Array.isArray(c.to)?{to:[project(c.to[0],w,left,width),project(c.to[1],h,top,height)]}:{})}))};
}
function furnish(dungeon,venue){
  if(venue?.version!==1||!dungeon.indoorRooms?.length)return;
  const profile=E.profile(venue.type);if(!profile)return;
  const kit=require('../assets/genreKits').resolve({genre:dungeon.sceneSpec?.city?.genre},require('./settingLayer').current());
  dungeon.sceneStructures=(dungeon.sceneStructures||[]).filter(s=>s.role!=='city-venue-furniture');dungeon.tiles||={};
  const fitted=require('./venueFurnishings').place(dungeon,dungeon.indoorRooms,{type:venue.type,genre:kit.genre,kit,id:venue.id});
  dungeon.sceneStructures=dungeon.sceneStructures.filter(s=>!/^city-venue-light/.test(s.role||''));
  require('./cityLighting').rooms(dungeon,dungeon.indoorRooms,{genre:kit.genre,kit,id:venue.id,role:'city-venue-light'});
  dungeon.cityVenue={version:1,id:venue.id,type:venue.type,spaces:profile.spaces,physicalFootprint:dungeon.cityVenueBounds,
    furnishings:fitted.parts.length,workSites:fitted.sites};
  const program=dungeon.sceneSpec?.city?.floorProgram;
  if(program?.version===1){
    const rooms=dungeon.indoorRooms.filter(r=>r.role!=='entrance').slice(0,program.units);
    dungeon.cityVenue.units=rooms.map((room,i)=>{
      const choices=[];
      for(let y=room.y+1;y<room.y+room.h-1;y++)for(let x=room.x+1;x<room.x+room.w-1;x++)if(dungeon.cells[`${x},${y}`]?.tile==='floor')choices.push({x,y});
      choices.sort((a,b)=>Math.hypot(a.x-room.x-room.w/2,a.y-room.y-room.h/2)-Math.hypot(b.x-room.x-room.w/2,b.y-room.y-room.h/2));
      return{id:`floor-${program.floor}:unit-${i+1}`,use:room.venueUse,room:{x:room.x,y:room.y,width:room.w,depth:room.h},position:choices[0]||null};
    });
  }
}
module.exports={fit,furnish};
