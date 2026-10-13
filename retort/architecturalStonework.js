'use strict';
const Carvings=require('../assets/stoneCarvings');
function applyArchitecturalStonework(dungeon,spec={}){
  if(dungeon.architecturalStonework)return dungeon.architecturalStonework;
  const report={version:1,status:'skipped',columns:[],structures:[],surfaceModel:'carved-occupied-voxels'};
  if(spec.architecturalCarvings===false||!dungeon.tiles||!dungeon.cells)return report;
  const eligible=tile=>{
    const meta=dungeon.tiles[tile]?.spriteSpec;
    return !meta?.stoneCarving&&Carvings.resolveVoxelDescriptor(meta,tile);
  };
  const columns=Object.entries(dungeon.cells).filter(([,c])=>c.architectureRole==='roof-support'&&eligible(c.tile));
  const structures=(dungeon.sceneStructures||[]).map((part,index)=>({part,index})).filter(({part})=>eligible(part.tile));
  const variant=(tile,region,pattern)=>{
    const id=tile+'_carved_v1_'+region+'_'+pattern,original=dungeon.tiles[tile];
    dungeon.tiles[id]||={...original,spriteSpec:{...original?.spriteSpec,stoneCarving:{version:1,region,pattern},uncarvedTile:tile}};
    return id;
  };
  // Reuse one deterministic mesh per source tile, not a new mesh for every instance.
  for(const [key,cell]of columns){
    const original=cell.tile,{region,pattern}=eligible(original);
    cell.tile=variant(original,region,pattern);report.columns.push({key,original,tile:cell.tile});
  }
  for(const {part,index}of structures){
    const original=part.tile,{region,pattern}=eligible(original);
    part.tile=variant(original,region,pattern);report.structures.push({index,original,tile:part.tile});
  }
  report.status=report.columns.length||report.structures.length?'built':'skipped';
  dungeon.architecturalStonework=report;return report;
}
module.exports={applyArchitecturalStonework};
