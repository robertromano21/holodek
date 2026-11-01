'use strict';
process.env.HOLODEK_GENRE_EXPANSION='1';process.env.HOLODEK_ARCHITECTURE_EXPANSION='1';
const fs=require('node:fs'),path=require('node:path'),{createCanvas}=require('canvas');
const F=require('../../assets/genreFixtures'),K=require('../../assets/genreKits');
const c=createCanvas(1200,1420),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
ctx.fillStyle='#10171c';ctx.fillRect(0,0,c.width,c.height);
ctx.font='bold 24px Georgia';ctx.fillStyle='#f1dfba';ctx.fillText('GENRE LIGHT SOURCES',24,35);
ctx.font='15px Georgia';ctx.fillStyle='#b6cad1';ctx.fillText('54 registered procedural sprite / voxel assets. Asset sheet, not a gameplay screenshot.',24,61);
for(const [i,genre]of Object.keys(F.THEMES).entries()){
  const x=(i%3)*400,y=84+Math.floor(i/3)*220;
  ctx.fillStyle=i%2?'#1a242b':'#151f26';ctx.fillRect(x+8,y,384,208);
  ctx.fillStyle='#e8d5ad';ctx.font='bold 17px Georgia';ctx.fillText(genre.toUpperCase(),x+20,y+27);
  for(let j=0;j<3;j++){
    const id=`l_${genre}_${j}`,info=F.SHAPES[id],xx=x+16+j*126;
    const glow=ctx.createRadialGradient(xx+58,y+94,3,xx+58,y+94,60);glow.addColorStop(0,info.color+'55');glow.addColorStop(1,info.color+'00');
    ctx.fillStyle=glow;ctx.fillRect(xx,y+38,120,125);K.paint(ctx,id,xx+10,y+48,96,96);
    ctx.fillStyle=info.color;ctx.fillRect(xx+49,y+155,18,3);ctx.font='11px Georgia';ctx.fillStyle='#c7d1d4';
    const words=info.label.split(' ');let line='',row=0;
    for(const word of words){if(ctx.measureText(line+' '+word).width>111){ctx.fillText(line,xx+4,y+176+row++*14);line=word;}else line=(line+' '+word).trim();}
    ctx.fillText(line,xx+4,y+176+row*14);
  }
}
const dir=path.resolve('.retort-data/genre-assets');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'genre-lights.png');fs.writeFileSync(file,c.toBuffer('image/png'));console.log(file);
