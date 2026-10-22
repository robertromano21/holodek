'use strict';
for(const name of ['GENRE_EXPANSION','ARCHITECTURE_EXPANSION','GENRE_KITS','GENRE_ARCH'])process.env['HOLODEK_'+name]='1';
const fs=require('node:fs'),path=require('node:path'),{createCanvas}=require('canvas');
const E=require('../../assets/genreExpansion'),T=require('../../assets/renderSceneTextures'),P=require('../../assets/renderCharacterProcedural'),S=require('../../assets/renderCharacterSprite');
const output=path.resolve(__dirname,'../../previews/completion');fs.mkdirSync(output,{recursive:true});
function actor(ctx,frame,x,y,w,h){
  return E.paintVoxels(ctx,frame,x,y,w,h);
}
const genres=Object.keys(E.PROFILES);
for(let page=0;page<3;page++){
  const c=createCanvas(1100,1370),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
  ctx.fillStyle='#151c25';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#e8d8ac';ctx.font='bold 24px monospace';ctx.fillText('HOLODEK / PROCEDURAL GENRE EXPANSION',25,38);
  ctx.font='14px monospace';ctx.fillText('Native building geometry / wall + floor + door tiles / 2D token / solid 3D actor',25,66);
  for(let row=0;row<6;row++){
    const genre=genres[page*6+row],y=95+row*208,p=E.PROFILES[genre];
    ctx.fillStyle=row%2?'#202d36':'#1b2630';ctx.fillRect(14,y,1072,196);ctx.fillStyle='#f1dfac';ctx.font='bold 18px monospace';ctx.fillText(genre.toUpperCase(),26,y+24);ctx.font='12px monospace';ctx.fillStyle='#a6c1c8';ctx.fillText(p.label,26,y+45);
    E.paint(ctx,`x_${genre}_house`,22,y+54,180,133);E.paint(ctx,`x_${genre}_hall`,205,y+54,180,133);E.paint(ctx,`x_${genre}_gate`,388,y+54,155,133);
    for(const [i,[kind,suffix]]of [['wall','wall'],['floor','floor'],['wall','door']].entries()){
      const tile=createCanvas(64,64);T.drawSceneSurface(tile.getContext('2d'),createCanvas,kind,{material:`x_${genre}_${suffix}`,seed:'preview'});ctx.drawImage(tile,550+i*68,y+86);ctx.fillStyle='#a6c1c8';ctx.fillText(suffix,550+i*68,y+168);
    }
    const sheet=P.normalizeSheet({name:'Genre Resident',race:'Human',class:'Traveler',level:2,sex:'Female',equipped:{Weapon:genre==='western'?'revolver':genre==='sci-fi'?'blaster pistol':'spear'}});
    const traits=P.deriveFallbackTraits(sheet);traits.genreGarb={...E.GARB[genre][0]};
    const pigments=E.PIGMENTS[genre];Object.assign(traits.palette,{outfit:pigments[0],outfit2:pigments[1],trim:pigments[2],skin:pigments[4],glow:pigments[5]});
    const spec=P.buildProceduralSpriteSpec(sheet,traits,{signature:false,salt:123});ctx.drawImage(S.createTraitSpriteCanvas(spec,0),770,y+61,108,108);
    actor(ctx,S.createCharacterVoxelFrames(sheet,spec,{frameCount:1,voxelSize:32})[0],880,y+52,183,145);
  }
  const file=path.join(output,`genres-${page+1}.png`);fs.writeFileSync(file,c.toBuffer('image/png'));console.log(file);
}
const c=createCanvas(1100,620),ctx=c.getContext('2d');ctx.fillStyle='#17171c';ctx.fillRect(0,0,1100,620);ctx.fillStyle='#e8d8ac';ctx.font='bold 23px monospace';ctx.fillText('ADDITIONAL COTG ARCHITECTURE / ALSO HOLODEK OPTIONS',22,35);
Object.keys(E.COTG).forEach((name,i)=>{const x=(i%4)*270+12,y=Math.floor(i/4)*280+65;E.paint(ctx,'x_'+name,x,y,250,210);ctx.font='14px monospace';ctx.fillStyle='#d6c9a8';ctx.fillText(name.replaceAll('_',' '),x+12,y+244);});
const file=path.join(output,'cotg-architecture.png');fs.writeFileSync(file,c.toBuffer('image/png'));console.log(file);
