'use strict';
process.env.HOLODEK_GENRE_EXPANSION='1';process.env.HOLODEK_ARCHITECTURE_EXPANSION='1';
const fs=require('node:fs'),{createCanvas}=require('canvas'),U=require('../../assets/urbanDesigns'),K=require('../../assets/genreKits'),B=require('../../retort/biomeRecipes');
const canvas=createCanvas(1260,1560),ctx=canvas.getContext('2d');ctx.fillStyle='#101b22';ctx.fillRect(0,0,1260,1560);ctx.imageSmoothingEnabled=false;
for(const [i,genre]of Object.keys(U.PROFILES).entries()){
  const x=i%3*420,y=Math.floor(i/3)*260,p=U.PROFILES[genre],recipe=Object.values(B.CATALOG).find(r=>r.genre===genre);
  ctx.fillStyle=i%2?'#21323a':'#17272f';ctx.fillRect(x+3,y+3,414,254);ctx.fillStyle='#f3e5c3';ctx.font='bold 17px Consolas';ctx.fillText(genre,x+14,y+25);
  for(const [j,role]of ['midrise','skyline','terrace'].entries())K.paint(ctx,`a_${genre}_urban_${role}`,x+10+j*136,y+43,130,160);
  ctx.font='12px Consolas';ctx.fillStyle='#9bd1d1';ctx.fillText(p[3]+' | '+p[0]+'/'+p[1]+' units',x+14,y+220);
  ctx.fillStyle='#b4bcae';ctx.fillText('Biome: '+recipe.id.replaceAll('_',' '),x+14,y+241);
}
const out='.retort-data/place-grounding/urban-biomes.png';fs.mkdirSync('.retort-data/place-grounding',{recursive:true});fs.writeFileSync(out,canvas.toBuffer('image/png'));console.log(JSON.stringify({file:out,genres:18,buildings:54,biomes:Object.keys(B.CATALOG).length}));
