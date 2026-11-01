'use strict';
for(const f of ['ARCHITECTURE_EXPANSION','GENRE_EXPANSION','CITY_SITES','CITY_COMPLETE'])process.env['HOLODEK_'+f]='1';
const fs=require('node:fs'),{createCanvas}=require('canvas'),Plans=require('../../assets/cityBuildingPlans'),H=require('../../retort/hostLocalFloors');
const canvas=createCanvas(1380,1060),ctx=canvas.getContext('2d'),seen=new Set();
ctx.fillStyle='#202831';ctx.fillRect(0,0,1380,1060);ctx.fillStyle='#f4dfbc';ctx.font='26px Georgia';
ctx.fillText('Saved City Floor Variety | actual collision geometry',28,38);ctx.font='15px Georgia';
ctx.fillText('CPU inspection, not a live 3D screenshot. Native modules, real stairs and furnished rooms; same building purpose and envelope.',28,65);
for(let n=0;n<100&&seen.size<6;n++){
  const p=Plans.create({id:'parcel:'+n,seed:'one-city',hostKey:'0,0,0',genre:'fantasy',type:'temple',width:44,depth:52,storeys:4}),r=Plans.floor(p,1);
  if(seen.has(r.composition))continue;const i=seen.size;seen.add(r.composition);
  const ref={hostKey:p.hostKey,buildingId:p.id,floor:1},db={[p.hostKey]:{cityArchitecture:{buildings:{[p.id]:{plan:p,floors:{1:{plan:r}}}}},cityFloors:{buildings:{[p.id]:{floors:{}}}}}};
  db[p.hostKey].cityFloors.buildings[p.id].floors[1]={room:H.floorRoom(db,ref)};const d=H.geometry(db,ref),b=d.cityVenueBounds;
  const x0=30+(i%3)*455,y0=105+Math.floor(i/3)*475,scale=7;
  ctx.fillStyle='#f4dfbc';ctx.font='19px Georgia';ctx.fillText(r.composition,x0,y0);
  for(let y=0;y<r.depth;y++)for(let x=0;x<r.width;x++){
    const c=d.cells[`${b.left+x},${b.top+y}`];ctx.fillStyle=c.cityCirculation?'#f2bf68':c.feature==='pillar'?'#b5d4d7':c.tile==='floor'?'#b6a386':'#39434e';
    ctx.fillRect(x0+x*scale,y0+20+y*scale,scale-.5,scale-.5);
  }
  ctx.fillStyle='#e3d3ba';ctx.font='14px Georgia';ctx.fillText(`${d.indoorRooms.length} spaces | ${d.sceneArchitecture?.modules?.filter(m=>m.status==='built').length||0} CotG modules | ${d.cityVenue.furnishings} props`,x0,y0+410);
}
const file='.retort-data/authored-campaign/floors.png';fs.mkdirSync('.retort-data/authored-campaign',{recursive:true});fs.writeFileSync(file,canvas.toBuffer('image/png'));console.log(JSON.stringify({file,compositions:seen.size}));
