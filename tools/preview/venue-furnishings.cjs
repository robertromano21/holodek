'use strict';
process.env.HOLODEK_GENRE_EXPANSION='1';process.env.HOLODEK_ARCHITECTURE_EXPANSION='1';
const fs=require('node:fs'),path=require('node:path'),{createCanvas}=require('canvas'),F=require('../../assets/genreFurnishings'),K=require('../../assets/genreKits');
const genres=Object.keys(F.THEMES),roles=F.DETAIL_ROLES,width=160+roles.length*100,rowHeight=105;
const c=createCanvas(width,genres.length*rowHeight),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
for(const [row,genre]of genres.entries()){
  const y=row*rowHeight;ctx.fillStyle=row%2?'#263039':'#1c2329';ctx.fillRect(0,y,width,rowHeight);
  ctx.font='13px monospace';ctx.fillStyle='#e5d7b9';ctx.fillText(genre,8,y+30);
  for(const [i,role]of roles.entries()){const x=160+i*100;K.paint(ctx,`f_${genre}_${role}`,x,y+2,92,80);
    ctx.fillStyle='#dfd6bf';ctx.font='10px monospace';ctx.fillText(role,x+4,y+98);}
}
const directory=path.resolve('.retort-data/city-interiors-books');fs.mkdirSync(directory,{recursive:true});
const file=path.join(directory,'furnishings.png');fs.writeFileSync(file,c.toBuffer('image/png'));console.log(JSON.stringify({file,genres:genres.length,newObjects:genres.length*roles.length}));
