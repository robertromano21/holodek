(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CityParcels=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const VERSION=1,PITCH=36,METRES_PER_CELL=2.5;
  const hash=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
  const highRise=g=>['modern','sci-fi','cyberpunk','noir','solarpunk','dieselpunk','underwater'].includes(g);
  const pitchFor=genre=>highRise(genre)?PITCH:28;
  function entrance(b,player){
    const mx=b.left+Math.floor(b.width/2)+.5,my=b.top+Math.floor(b.depth/2)+.5;
    const points=[{x:mx,y:b.top+2.5,side:'north'},{x:mx,y:b.top+b.depth-2.5,side:'south'},
      {x:b.left+2.5,y:my,side:'west'},{x:b.left+b.width-2.5,y:my,side:'east'}]
      .filter(p=>!b.entrySides||b.entrySides.includes(p.side)).map(({x,y})=>({x,y}));
    return player?points.sort((a,b)=>Math.hypot(a.x-player.x,a.y-player.y)-Math.hypot(b.x-player.x,b.y-player.y))[0]:points[0];
  }
  function parcel({seed='',cityId='',districtKey='',genre='fantasy',x=0,y=0,floors=0,scale='city',mix=['home','shop','workshop','civic']}={}){
    const id=`${cityId}:${districtKey}:parcel:${x},${y}`,h=hash(seed+':'+id),tall=highRise(genre)&&scale==='metropolis';
    const width=(tall?22:14)+h%5*2,depth=(tall?24:16)+(h>>>4)%4*2;
    const lowRise=['outpost','village','town'].includes(scale),ceiling=lowRise?3:160;
    const typical=highRise(genre)?floors||(tall?80:6):Math.min(floors||6,12);
    const storeys=Math.max(1,Math.min(ceiling,Math.round(typical*(.45+(h>>>8)%56/100))));
    return{version:VERSION,id,x,y,width,depth,storeys,type:mix[(h>>>14)%mix.length]||'home',park:(h>>>18)%13===0,
      metres:{width:width*METRES_PER_CELL,depth:depth*METRES_PER_CELL,height:storeys*3.4},seed:h};
  }
  function district(options={}){
    const half=options.scale==='metropolis'?16:options.scale==='city'?10:4;
    return{version:VERSION,seed:options.seed||'',cityId:options.cityId,districtKey:options.districtKey,half,pitch:PITCH,
      potentialParcels:half*half*4,policy:'deterministic-parcels; detailed-nearby-only'};
  }
  return{VERSION,PITCH,METRES_PER_CELL,hash,highRise,pitchFor,entrance,parcel,district};
});
