(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./cityEstablishments'):root.CityEstablishments);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.CityServiceCounters=api;
})(typeof window==='object'?window:globalThis,function(E){
  'use strict';
  const cache=new WeakMap();
  function catalog(d){
    if(!d)return[];
    const stamp=`${d._geometryStamp||''}:${d.sceneStructures?.length||0}:${d.cityBlocks?.buildings?.length||0}`;
    const prior=cache.get(d);if(prior?.stamp===stamp&&prior.parts===d.sceneStructures)return prior.rows;
    const venues=new Map((d.cityBlocks?.buildings||[]).filter(b=>E.serviceNotice(b)).map(b=>[b.id,b]));
    if(E.serviceNotice(d.cityVenue))venues.set(d.cityVenue.id,d.cityVenue);
    const selected=new Map();
    for(const part of d.sceneStructures||[]){
      if(!venues.has(part.venueId)||!part.id||!part.position||!part.size||
        !part.serviceCounter&&!/_wares$|_workstation$|_table$|_food$/.test(part.shape||''))continue;
      const rank=part.serviceCounter?0:/_wares$/.test(part.shape)?1:/_workstation$/.test(part.shape)?2:3;
      if(!selected.has(part.venueId)||rank<selected.get(part.venueId).rank)selected.set(part.venueId,{part,rank});
    }
    const rows=[...selected.values()].map(({part})=>({id:part.id,venueId:part.venueId,
      label:E.profile(venues.get(part.venueId)?.type)?.service?'Service Counter':'Work Inquiry Desk',
      position:part.position,size:part.size,point:{x:part.position.x+part.size.x/2,y:part.position.y+part.size.y/2}}));
    cache.set(d,{stamp,parts:d.sceneStructures,rows});return rows;
  }
  function reachable(d,counter,player,I){
    if(!counter||![player?.x,player?.y].every(Number.isFinite)||!I?.pointWalkable(d,player.x,player.y))return false;
    const p=counter.point;return Math.hypot(p.x-player.x,p.y-player.y)<=3&&I.lineClear(d,player,p);
  }
  function belongs(d,counter,occupation){
    if(occupation?.mode!=='work'||!E.serviceNotice({type:occupation.venueType}))return false;
    return occupation.venueId===counter.venueId||d.cityVenue?.id===counter.venueId&&
      d.cityVenue.units?.some(u=>u.id===occupation.venueId);
  }
  return{catalog,reachable,belongs};
});
