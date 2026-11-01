'use strict';
const fs=require('node:fs'),{createCanvas}=require('canvas'),C=require('../../retort/cityBlocks');
const size=256,d={geoKey:'0,0,30',generation:{seed:'walk-in-check'},layout:{width:size,height:size},start:{x:128,y:128},cells:{},tiles:{}};
for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
const report=C.apply(d,{city:{}},{id:'walk-in-city',name:'Test Ward',design:{verticality:{floors:120}}},{genre:'cyberpunk',scale:'metropolis'});
const canvas=createCanvas(1100,820),ctx=canvas.getContext('2d');ctx.fillStyle='#16212a';ctx.fillRect(0,0,1100,820);
ctx.font='bold 23px Consolas';ctx.fillStyle='#f5e5c5';ctx.fillText('CITY BLOCKS | COMPILED GEOMETRY',25,34);
ctx.font='14px Consolas';ctx.fillStyle='#b8c8ca';ctx.fillText('Collision-cell plan, not a rendered game screenshot. Scale: 2.5 metres / cell.',25,60);
const colors={city_road_surface:'#303a45',city_sidewalk_surface:'#abb2b2',city_interior_surface:'#8e718b',city_park_surface:'#61956b'},zoom=2.5;
for(const [k,c]of Object.entries(d.cells)){
  const [x,y]=k.split(',').map(Number);ctx.fillStyle=c.tile==='wall'?'#e6d5b0':colors[c.floorSurface]||'#202b31';ctx.fillRect(25+x*zoom,90+y*zoom,zoom,zoom);
}
ctx.fillStyle='#fff';ctx.fillRect(25+127*zoom,90+127*zoom,5,5);
ctx.font='bold 14px Consolas';ctx.fillText('Ground floors: '+report.buildings+' | parks: '+report.parks,25,760);
ctx.font='13px Consolas';ctx.fillStyle='#abc7cb';ctx.fillText('Open doors, lobbies, purpose bays, steps and park boundaries use real cells.',25,788);
const left=710,top=120,width=350,height=590;
ctx.font='bold 17px Consolas';ctx.fillStyle='#f5e5c5';ctx.fillText('TRUE-SCALE ELEVATIONS',left,105);
const towers=d.cityBlocks.buildings.slice(0,3),px=1.1,ground=top+height;
ctx.strokeStyle='#95a8ae';ctx.beginPath();ctx.moveTo(left,ground);ctx.lineTo(left+width,ground);ctx.stroke();
for(let i=0;i<towers.length;i++){
  const b=towers[i],x=left+i*110,w=b.metres.width*px,h=b.metres.height*px;
  ctx.fillStyle=['#776d94','#687f91','#608f87'][i];ctx.fillRect(x,ground-h,w,h);
  ctx.strokeStyle='#a5bac4';for(let y=ground-h+8;y<ground;y+=3.4*px)ctx.strokeRect(x+3,y,w-6,1);
  ctx.fillStyle='#e0ddca';ctx.font='12px Consolas';ctx.fillText(b.storeys+' floors',x,ground-h-22);ctx.fillText(Math.round(b.metres.height)+' m',x,ground-h-7);
  ctx.fillText(Math.round(b.metres.width)+' m wide',x,ground+20);
}
ctx.font='13px Consolas';ctx.fillStyle='#abc7cb';ctx.fillText('Upper massing shown; not all floors',left,770);ctx.fillText('are generated or currently accessible.',left,791);
const file='.retort-data/walk-in-city/city-blocks.png';fs.writeFileSync(file,canvas.toBuffer('image/png'));console.log(JSON.stringify({file,...report}));
