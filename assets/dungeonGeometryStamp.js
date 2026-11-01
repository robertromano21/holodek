(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DungeonGeometryStamp=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // Preserve the existing room fingerprint format on every authoring and rendering path.
  function compute(dungeon,geoKey){
    if(!dungeon?.cells)return `${geoKey||'unknown'}:empty`;
    let hash=2166136261>>>0;
    const mix=value=>{const text=String(value);for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}};
    const layout=dungeon.layout||{};
    mix(geoKey||dungeon.geoKey||'');mix(layout.width||0);mix(layout.height||0);
    const keys=Object.keys(dungeon.cells).sort();
    for(const key of keys){
      const cell=dungeon.cells[key]||{};mix(key);mix(cell.tile||'floor');
      if(cell.floorSurface)mix(`surface:${cell.floorSurface}`);
      if(cell.wallSurface)mix(`wall:${cell.wallSurface}`);
      mix(Number.isFinite(cell.floorHeight)?Math.round(cell.floorHeight*1000):0);
      mix(Number.isFinite(cell.ceilHeight)?Math.round(cell.ceilHeight*1000):0);
      if(cell.roof)mix(`roof:${cell.roof.style}:${cell.roof.height}:${cell.roof.slopeX}:${cell.roof.slopeY}`);
      if(cell.structureHeight)mix(`support:${cell.structureHeight}`);
      if(cell.door)mix(cell.door.isOpen===false?'door:closed':'door:open');
    }
    mix(JSON.stringify(dungeon.sceneStructures||[]));
    if(dungeon.surfaceArt?.length)mix(JSON.stringify(dungeon.surfaceArt));
    return `${keys.length}:${(hash>>>0).toString(16)}`;
  }
  function stamp(dungeon,geoKey){
    if(!dungeon)return dungeon;
    const geometryStamp=compute(dungeon,geoKey);
    dungeon._geometryStamp=geometryStamp;dungeon._meta={...dungeon._meta,geometryStamp};return dungeon;
  }
  return{compute,stamp};
});
