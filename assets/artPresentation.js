(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArtPresentation=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  function lightAnchor(art){
    const p=art.position,s=art.size,point={x:p.x+s.x*.5,y:p.y+s.y*.5};
    // A thin wall panel's box center can fall on a blocked DDA grid corner.
    if(art.surface==='wall')point[art.axis]=p[art.axis]+art.sign*.08;
    // Floor medallions also commonly center on exact cell corners. Keep the
    // lighting sample inside one cell so a descending DDA ray cannot overshoot.
    if(art.surface==='floor')for(const axis of['x','y'])if(Math.abs(point[axis]-Math.round(point[axis]))<1e-6)point[axis]+=.01;
    return point;
  }
  function floorLamps(art,dungeon){
    const p=art.position,s=art.size;
    if(art.kind!=='mosaic'||!dungeon||!p||!s||![p.x,p.y,p.z,s.x,s.y].every(Number.isFinite)||s.x<.5||s.y<.5)return[];
    const points=[];
    for(const t of[.25,.75,.5])points.push([p.x+s.x*t,p.y-.35],[p.x+s.x*t,p.y+s.y+.35],
      [p.x-.35,p.y+s.y*t],[p.x+s.x+.35,p.y+s.y*t]);
    const lamps=[],limit=s.x*s.y>=9?4:2;
    for(const[x,y]of points){
      if(lamps.length===limit)break;
      const cells=[[-.12,-.12],[.12,-.12],[-.12,.12],[.12,.12]].map(([dx,dy])=>dungeon.cells?.[`${Math.floor(x+dx)},${Math.floor(y+dy)}`]);
      const c=cells[0],floor=c?.floorHeight||0,top=Math.min(c?.ceilHeight??Infinity,c?.roof?.height??Infinity);
      if(cells.some(c=>!c||c.tile!=='floor'||c.feature||c.exit||c.complexExit||c.door||c.interactable||c.blocked||c.obstacle||c.navigationReserved||
        Math.abs((c.floorHeight||0)-floor)>.08)||Math.abs(floor-p.z)>.2||top-floor<1||
        lamps.some(l=>Math.hypot(l.x-x,l.y-y)<.7))continue;
      if((dungeon.surfaceArt||[]).some(a=>a.surface==='floor'&&x+.12>a.position.x&&x-.12<a.position.x+a.size.x&&y+.12>a.position.y&&y-.12<a.position.y+a.size.y))continue;
      const occupied=['sceneObjects','sceneLandmarks','sceneProps','objects','props'].some(key=>{
        const raw=dungeon[key],rows=Array.isArray(raw)?raw:Object.values(raw||{});
        return rows.some(o=>{const q=o.position||o;return Number.isFinite(q.x)&&Number.isFinite(q.y)&&Math.hypot(q.x-x,q.y-y)<.7;});
      });
      if(occupied)continue;
      lamps.push({id:art.tile+':lamp:'+lamps.length,mount:'floor',axis:'y',sign:-1,x,y,z:floor+.77,
        radius:Math.min(5,Math.max(2.4,Math.hypot(s.x,s.y)*.65+1)),intensity:.85,
        position:{x:x-.11,y:y-.11,z:floor+.025},size:{x:.22,y:.22,z:.85}});
    }
    return lamps;
  }
  function plan(art,dungeon){
    if(art.surface==='floor')return floorLamps(art,dungeon);
    if(art.surface!=='wall')return[];
    const p=art.position,s=art.size,width=Math.max(s.x,s.y),height=s.z;
    const lamps=width>2?[-.28,width+.28]:[width+.28],axis=art.axis,normal=art.sign;
    return lamps.map((offset,i)=>{
      const x=p.x+(axis==='y'?offset:normal*.2),y=p.y+(axis==='x'?offset:normal*.2),z=p.z+Math.max(.4,Math.min(height*.55,2.5));
      const position={x:x-.11,y:y-.11,z:z-.35},size={x:.22,y:.22,z:.42};
      position[axis]=p[axis]+(normal>0?.01:-.36);size[axis]=.35;
      return{id:art.tile+':lamp:'+i,axis,sign:normal,x,y,z,radius:Math.min(5,Math.max(2.4,width*.7+height*.5)),intensity:.85,position,size};
    }).filter(l=>{
      if(!dungeon)return true;
      const backing={x:l.x,y:l.y};backing[axis]=p[axis]-normal*.1;
      const cell=dungeon.cells?.[`${Math.floor(backing.x)},${Math.floor(backing.y)}`];
      if(!cell||!['wall','torch'].includes(cell.tile)||l.z-.35<(cell.floorHeight||0)||l.z+.1>(cell.ceilHeight??Infinity))return false;
      const along=axis==='x'?'y':'x';
      return !(dungeon.surfaceArt||[]).some(a=>a.tile!==art.tile&&a.surface==='wall'&&a.axis===axis&&
        Math.abs(a.position[axis]-p[axis])<.1&&l[along]+.12>a.position[along]&&
        l[along]-.12<a.position[along]+a.size[along]&&l.z+.1>a.position.z&&l.z-.35<a.position.z+a.size.z);
    });
  }
  function lights(dungeon,x,y,range=20){
    // Older rooms saved only the first 14 mounts. Rebuild valid mounts without
    // rewriting the room, then spend the frame budget on the nearest sconces.
    const art=dungeon.surfaceArt||[],tiles=new Set(art.map(a=>a.tile));
    const lamps=art.flatMap(a=>plan(a,dungeon));
    lamps.push(...(dungeon.artLamps||[]).filter(l=>!tiles.has(String(l.id).split(':lamp:')[0])));
    return lamps.filter(l=>l&&[l.x,l.y,l.z,l.radius,l.intensity].every(Number.isFinite)&&
      Math.hypot(l.x-x,l.y-y)<=range).map(l=>({...l,radius:Math.max(.5,Math.min(5,l.radius)),intensity:Math.max(0,Math.min(1,l.intensity)),dist2:(l.x-x)**2+(l.y-y)**2}))
      .sort((a,b)=>a.dist2-b.dist2).slice(0,14);
  }
  function flamePose(lamp,flicker){
    const pulse=Math.max(.75,Math.min(1.2,Number.isFinite(flicker)?flicker:1));
    const size={...lamp.size,z:lamp.size.z*(.85+.15*pulse)},position={...lamp.position};
    position.z+=.76*(lamp.size.z-size.z);
    position[lamp.axis==='x'?'y':'x']+=(pulse-1)*.018;
    return{position,size};
  }
  function mesh(flame=false,axis='y',sign=-1,mount='wall'){
    const vertices=[],indices=[];
    const box=(lo,hi,color)=>{
      for(const [axis,sign]of[[0,-1],[0,1],[1,-1],[1,1],[2,-1],[2,1]]){
        const u=(axis+1)%3,v=(axis+2)%3,base=vertices.length/9;
        for(const[a,b]of[[0,0],[1,0],[1,1],[0,1]]){const p=[0,0,0],n=[0,0,0];p[axis]=sign<0?lo[axis]:hi[axis];p[u]=a?hi[u]:lo[u];p[v]=b?hi[v]:lo[v];n[axis]=sign;
          vertices.push(...p,...n,...color);}
        indices.push(base,base+1,base+2,base,base+2,base+3);
      }
    };
    if(flame){box([.35,.35,.76],[.65,.65,.95],[1,.65,.16]);box([.44,.44,.9],[.56,.56,1],[1,.93,.58]);}
    else if(mount==='floor'){
      box([.12,.12,0],[.88,.88,.12],[.34,.25,.16]);
      box([.4,.4,.12],[.6,.6,.54],[.48,.33,.18]);
      box([.18,.18,.54],[.82,.82,.63],[.6,.43,.22]);
      box([.32,.32,.63],[.68,.68,.76],[.86,.76,.55]);
    }else{
      const a=axis==='x'?0:1,lo=[.25,.25,.15],hi=[.75,.75,.62];lo[a]=sign>0?0:.85;hi[a]=sign>0?.15:1;box(lo,hi,[.34,.25,.16]);
      const armLo=[.42,.42,.32],armHi=[.58,.58,.44];armLo[a]=sign>0?.08:.42;armHi[a]=sign>0?.58:.92;box(armLo,armHi,[.48,.33,.18]);
      box([.4,.4,0],[.6,.6,.57],[.34,.25,.16]);box([.18,.18,.54],[.82,.82,.63],[.6,.43,.22]);box([.32,.32,.63],[.68,.68,.76],[.86,.76,.55]);
    }
    return{vertices:new Float32Array(vertices),indices:new Uint16Array(indices)};
  }
  return{plan,lights,lightAnchor,flamePose,mesh};
});
