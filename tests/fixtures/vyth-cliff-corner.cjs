'use strict';
// Geometry from the user's matching 262144:3a5bb4c6 checkpoint, translated by (-354,-267).
// The centre ray crosses the cliff at (1,1); the exposed side of the ogre is visible around it.
module.exports=function(){
  const heights=[[14.326,13.677,12.995,12.286],[13.759,13.096,4.834162601626016,4.799487804878048],
    [4.903512195121952,4.868837398373984,4.834162601626016,4.799487804878048],
    [4.903512195121952,4.868837398373984,4.834162601626016,4.799487804878048]];
  const walls=new Set(['2,0','3,0','0,1','1,1']),cells={};
  for(let y=0;y<4;y++)for(let x=0;x<4;x++){const wall=walls.has(`${x},${y}`);cells[`${x},${y}`]={tile:wall?'wall':'floor',floorHeight:heights[y][x],ceilHeight:heights[y][x]+(wall?3.5:2.5),...(wall?{terrainRole:'cliff'}:{})};}
  return{dungeon:{geoKey:'-1,0,0',classification:{indoor:false},layout:{width:4,height:4},start:{x:0,y:2},cells,tiles:{}},
    player:{x:.50200142002495,y:2.9250124140738},target:{x:2,y:1}};
};
