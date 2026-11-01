(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CityBuildingFootprints=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const KINDS=['rectangle','chamfered','cross-wing','opposed-setbacks','corner-setback'];
  function create(seed){return{version:1,kind:KINDS[1+(Number(seed)>>>0)%4]};}
  function contains(shape,x,y){
    if(x<0||y<0||x>=1||y>=1)return false;
    const a=Math.min(x,1-x),b=Math.min(y,1-y);
    switch(shape?.kind){
      case 'chamfered':return a+b>=.18;
      case 'cross-wing':return a>=.22||b>=.22;
      case 'opposed-setbacks':return !(x<.23&&y<.27||x>.77&&y>.73);
      case 'corner-setback':return !(x>.68&&y<.28);
      default:return true;
    }
  }
  function rectangles(shape,width,depth){
    const rows=[];
    for(let y=0;y<depth;y++){
      let left=0,right=width;while(left<right&&!contains(shape,(left+.5)/width,(y+.5)/depth))left++;
      while(right>left&&!contains(shape,(right-.5)/width,(y+.5)/depth))right--;
      const previous=rows.at(-1);
      if(previous&&previous.x===left&&previous.width===right-left)previous.depth++;
      else rows.push({x:left,y,width:right-left,depth:1});
    }
    return rows;
  }
  function build(shape,size=16){
    const cells=new Uint8Array(size**3);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(contains(shape,(x+.5)/size,(y+.5)/size))for(let z=0;z<size;z++)cells[x+y*size+z*size*size]=1;
    return cells;
  }
  return{KINDS,create,contains,rectangles,build};
});
