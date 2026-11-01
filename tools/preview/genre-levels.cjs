'use strict';
process.env.HOLODEK_GENRE_EXPANSION='1'; process.env.HOLODEK_ARCHITECTURE_EXPANSION='1';
const fs=require('node:fs'), {createCanvas}=require('canvas');
const Design=require('../../retort/genreLevelDesign'), Indoor=require('../../retort/indoorBlueprint');
const Kits=require('../../assets/genreKits'), Architecture=require('../../assets/architectureDesigns');
const genres=Object.keys(Design.PROFILES), width=1200, panelWidth=400, panelHeight=246;
const canvas=createCanvas(width,Math.ceil(genres.length/3)*panelHeight),ctx=canvas.getContext('2d');
ctx.imageSmoothingEnabled=false;ctx.fillStyle='#121b22';ctx.fillRect(0,0,canvas.width,canvas.height);
for(const [index,genre] of genres.entries()) {
  const x=(index%3)*panelWidth,y=Math.floor(index/3)*panelHeight;
  const profile=Design.select(genre,{seed:'preview-'+genre}), plan=Design.plan(profile);
  const d={layout:{width:96,height:96},start:{x:48,y:72},cells:{},generation:{seed:profile.seed}};
  Indoor.build(d,plan,{floor:0,ceil:6,coveredStorey:true});
  ctx.fillStyle=index%2?'#1b2930':'#152129';ctx.fillRect(x+2,y+2,panelWidth-4,panelHeight-4);
  ctx.font='bold 15px monospace';ctx.fillStyle='#f0e4c6';ctx.fillText(genre,x+12,y+22);
  ctx.font='11px monospace';ctx.fillStyle='#a1bdc5';ctx.fillText(profile.id.split(':')[1].replaceAll('_',' '),x+12,y+39);
  for(const [key,c] of Object.entries(d.cells)) {
    if(c.tile!=='floor')continue;
    const [cx,cy]=key.split(',').map(Number),z=c.floorHeight;
    ctx.fillStyle=`rgb(${Math.round(66+z*27)},${Math.round(112+z*22)},${Math.round(123+z*15)})`;
    ctx.fillRect(x+12+cx*2,y+46+cy*2,2,2);
  }
  ctx.fillStyle='#ffd784';ctx.fillRect(x+11+d.start.x*2,y+45+d.start.y*2,4,4);
  const shape='a_'+genre+'_'+Architecture.OVERLOOKS[genre];
  Kits.paint(ctx,shape,x+218,y+55,166,145);
  ctx.font='10px monospace';ctx.fillStyle='#d5d7cb';
  ctx.fillText('walkable floor elevations',x+12,y+235);
  ctx.fillText('shared 2D / voxel asset',x+218,y+224);
}
const directory='.retort-data/genre-level-pass';fs.mkdirSync(directory,{recursive:true});
const file=directory+'/genre-levels.png';fs.writeFileSync(file,canvas.toBuffer('image/png'));
console.log(JSON.stringify({file,genres:genres.length}));
