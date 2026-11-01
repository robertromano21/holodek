'use strict';
process.env.HOLODEK_ARCHITECTURE_EXPANSION='1';process.env.HOLODEK_GENRE_EXPANSION='1';
const fs=require('node:fs'),{createCanvas}=require('canvas'),A=require('../../assets/cityArchitectureStyles'),
  S=require('../../assets/cityBuildingStyle'),Sky=require('../../assets/citySkyline'),K=require('../../assets/cityKit');
const canvas=createCanvas(1460,1120),ctx=canvas.getContext('2d'),footprint={version:1,kind:'rectangle'};
ctx.fillStyle='#222a2e';ctx.fillRect(0,0,1460,1120);ctx.font='bold 23px Georgia';ctx.fillStyle='#f1dfb7';
ctx.fillText('NATIVE CITY ARCHITECTURE | generated crown meshes',24,34);ctx.font='15px Georgia';ctx.fillText('CPU geometry/color inspection, not a live game screenshot. Lobby masonry and native torch fixtures are tested separately.',24,60);
function draw(a,palette,left,top,width=150,height=135){
  const points=Sky.faces(a.source==='cityKit'?'a_fantasy_urban_skyline':a.shape,footprint,a);
  const project=p=>[left+(p[0]-p[1])*width*.47,top+(p[0]+p[1])*width*.22-p[2]*height];
  for(const f of points.slice().filter(f=>f.normal[0]>0||f.normal[1]>0||f.normal[2]>0).sort((a,b)=>{
    const depth=f=>f.points.reduce((n,p)=>n+p[0]+p[1]+p[2]*2,0);return depth(a)-depth(b);
  })){
    const c=f.points[0].map((_,i)=>f.points.reduce((n,p)=>n+p[i],0)/4),rgb=A.color(a,...c,f.normal,palette),shade=f.axis===2?1:f.axis===0?.85:.68;
    ctx.fillStyle='rgb('+rgb.map(v=>Math.round(Math.min(255,v*255*shade))).join(',')+')';ctx.beginPath();
    f.points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.closePath();ctx.fill();
  }
}
for(const [i,type]of ['home','guild','temple','civic','bathhouse','warehouse'].entries()){
  const x=130+i*238,b={type,seed:17+i,width:24,depth:24,clearance:2.8,metres:{height:22}},a=A.envelope(A.choose('fantasy',b),b),palette=K.PALETTES[a.paletteName];
  draw(a,{primary:palette.body,secondary:palette.trim},x,243,164,145);
  ctx.fillStyle='#f1dfb7';ctx.font='17px Georgia';ctx.fillText(type,x-70,340);ctx.font='13px Consolas';ctx.fillText(a.shape,x-80,360);
}
for(const [i,genre]of Object.keys(A.PROFILES).filter(g=>g!=='cotg').entries()){
  const col=i%6,row=Math.floor(i/6),x=130+col*238,y=570+row*250,b={type:'civic',seed:i+2,width:24,depth:24,clearance:3,metres:{height:32}},
    s=S.resolve(genre,b),a=A.envelope(s.architecture,b);
  draw(a,s.palette,x,y,150,133);ctx.fillStyle='#f1dfb7';ctx.font='16px Georgia';ctx.fillText(genre,x-85,y+90);
  for(let n=0;n<3;n++){ctx.fillStyle=s.panes[n];ctx.fillRect(x-80+n*18,y+101,11,11);}
  ctx.font='11px Consolas';ctx.fillStyle='#b2c3c4';ctx.fillText(a.source,x-18,y+111);
}
const file='.retort-data/city-aesthetics/geometry-sheet.png';fs.mkdirSync('.retort-data/city-aesthetics',{recursive:true});fs.writeFileSync(file,canvas.toBuffer('image/png'));
console.log(JSON.stringify({file,genres:18,historicTypes:6}));
