'use strict';
const fs=require('node:fs'),path=require('node:path'),{createCanvas}=require('canvas'),P=require('../../assets/renderCharacterProcedural'),A=require('../../assets/genreArchitecture');
const genres=Object.keys(require('../../assets/cityEstablishments').NAMES),cell=112,canvas=createCanvas(10*cell,Math.ceil(genres.length/2)*132),ctx=canvas.getContext('2d');
ctx.fillStyle='#142029';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;
for(const [g,genre]of genres.entries()){
  const ox=(g%2)*560,oy=Math.floor(g/2)*132;ctx.fillStyle='#ecdab1';ctx.font='15px monospace';ctx.fillText(genre+' : procedural, zero model calls',ox+10,oy+18);
  for(let i=0;i<5;i++){
    const spec=require('../../assets/cityCrowdUi').specFor({name:genre+' Citizen '+i,race:i===4?'Construct':'Human',sex:i%2?'Female':'Male',role:i%2?'resident':'courier',genre,seed:g*314159+i},{procedural:P,architecture:A});
    const pixels=P.renderBillboardPixels(spec,0,false,{view:'front'}),sprite=createCanvas(pixels.w,pixels.h),s=sprite.getContext('2d'),image=s.createImageData(pixels.w,pixels.h);image.data.set(pixels.data);s.putImageData(image,0,0);
    ctx.drawImage(sprite,ox+i*cell+14,oy+24,96,96);
  }
}
const out=path.resolve(__dirname,'../../.retort-data/city-streaming/crowd-bodies.png');fs.writeFileSync(out,canvas.toBuffer('image/png'));console.log(out);
