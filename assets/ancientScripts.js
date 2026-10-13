(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./puzzleModules'):root.PuzzleModules);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AncientScripts=api;
})(typeof window==='undefined'?globalThis:window,function(Symbols){
  'use strict';
  const styles=['draconic','sepulchral','astral','wedge'],alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const WIDTH=96,HEIGHT=112,glyphCache=new Map();
  function hash(value){let n=2166136261;for(const c of String(value))n=Math.imul(n^c.charCodeAt(0),16777619)>>>0;return n;}
  function describe(raw={}){
    const text=String(raw.text||'The departed remember the ancient covenant.').slice(0,1600),heading=String(raw.heading||'The ancient covenant').slice(0,90);
    const seed=String(raw.seed||heading+' '+text).slice(0,120),style=styles.includes(raw.style)?raw.style:styles[hash(seed)%styles.length];
    return{version:1,style,seed,heading,text,key:hash(style+'|'+seed+'|'+heading+'|'+text).toString(16)};
  }
  function glyph(letter,style='draconic'){
    const index=alphabet.indexOf(String(letter).toUpperCase());
    if(index<0)return Array(9).fill('0000000');
    if(!styles.includes(style))throw Error('Unknown fictional engraving script.');
    const key=style+':'+index;if(glyphCache.has(key))return glyphCache.get(key).slice();
    const pixels=Array.from({length:9},()=>Array(7).fill('0'));
    const dot=(x,y)=>{if(x>=0&&y>=0&&x<7&&y<9)pixels[y][x]='1';};
    const line=(x0,y0,x1,y1)=>{const count=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));
      for(let i=0;i<=count;i++){const t=count?i/count:0;dot(Math.round(x0+(x1-x0)*t),Math.round(y0+(y1-y0)*t));}};
    const mask=(index+1)*109&1023;
    if(style==='astral'){
      const ring=[[3,0],[5,1],[6,4],[5,7],[3,8],[1,7],[0,4],[1,1]];
      ring.forEach((p,i)=>{if(mask&(1<<i))line(...p,...ring[(i+1)%8]);});
      if(mask&256)line(3,2,3,6);if(mask&512)line(1,4,5,4);
    }else if(style==='wedge'){
      for(let i=0;i<8;i++)if(mask&(1<<i)){const x=i%2*4,y=Math.floor(i/2)*2;
        line(x,y,x+2,y);line(x,y,x+1,y+1);}
      if(mask&256)line(0,8,6,8);if(mask&512)line(3,0,3,8);
    }else{
      const strokes=style==='draconic'?[[1,0,1,8],[1,0,5,2],[1,3,5,1],[1,4,5,6],[1,7,5,5],
        [5,0,5,8],[1,8,5,6],[0,2,3,5],[3,4,6,1],[3,1,3,7]]:
        [[2,0,2,8],[2,0,5,0],[2,3,5,3],[2,6,5,6],[2,8,5,7],
          [5,1,5,6],[0,1,0,3],[0,5,0,7],[3,1,4,2],[3,4,4,5]];
      strokes.forEach((stroke,i)=>{if(mask&(1<<i))line(...stroke);});
    }
    const rows=pixels.map(row=>row.join(''));glyphCache.set(key,rows);return rows.slice();
  }
  const letters=text=>String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  function raster(raw,pairs=[],glyphs=[]){
    const descriptor=describe(raw),cuts=new Float32Array(WIDTH*HEIGHT),set=(x,y,value=1)=>{
      x=Math.round(x);y=Math.round(y);if(x>=0&&y>=0&&x<WIDTH&&y<HEIGHT)cuts[x+y*WIDTH]=Math.max(cuts[x+y*WIDTH],value);
    };
    const line=(x0,y0,x1,y1,value=1)=>{const count=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));
      for(let i=0;i<=count;i++){const t=count?i/count:0;set(x0+(x1-x0)*t,y0+(y1-y0)*t,value);}};
    const word=(text,x,y)=>{for(const c of letters(text).slice(0,10)){
      if(c!==' ')glyph(c,descriptor.style).forEach((row,yy)=>[...row].forEach((bit,xx)=>{if(bit==='1')set(x+xx,y+yy);}));x+=8;
    }};
    const rows=letters(descriptor.text).match(/.{1,10}(?: |$)|.{1,10}/g)||[];
    for(const x of[3,6,89,92])line(x,3,x,108,.55);
    for(const y of[3,6,105,108])line(3,y,92,y,.55);
    for(let y=12;y<102;y+=8){line(2,y,6,y+3,.8);line(89,y+3,93,y,.8);}
    for(const[x,y]of[[9,9],[86,9],[9,102],[86,102]]){
      line(x-2,y,x,y-2,.8);line(x,y-2,x+2,y,.8);line(x+2,y,x,y+2,.8);line(x,y+2,x-2,y,.8);
    }
    if(pairs.length){
      word(descriptor.heading,10,11);word(letters(descriptor.heading).slice(10),10,22);
      for(const[pair,i]of pairs.slice(0,4).map((p,i)=>[p,i])){
        const y=37+i*13;
        for(const[name,x]of[[pair.mark,15],[pair.option,66]])if(name){
          const bitmap=Symbols.bitmap(name,glyphs),n=bitmap.length;
          for(let yy=0;yy<12;yy++)for(let xx=0;xx<12;xx++)if(bitmap[Math.floor(yy*n/12)]?.[Math.floor(xx*n/12)]==='1')set(x+xx,y+yy);
        }
        line(35,y+6,59,y+6,.7);line(56,y+3,59,y+6,.7);line(56,y+9,59,y+6,.7);
      }
      word(rows[0]||'REMEMBER',10,91);word(rows[1]||'THE COVENANT',10,101);
    }else rows.slice(0,9).forEach((row,i)=>word(row,10,11+i*10));
    // Wear affects only framing, never the verified reference diagram.
    const n=hash(descriptor.seed);for(let i=0;i<9;i++)line(1+(n+i*7)%5,14+(n+i*13)%82,4+(n+i*7)%5,18+(n+i*13)%82,.35);
    return{width:WIDTH,height:HEIGHT,cuts,descriptor};
  }
  function image(raw,palette={},pairs=[],glyphs=[]){
    const result=raster(raw,pairs,glyphs),data=new Uint8ClampedArray(WIDTH*HEIGHT*4);
    const rgb=(value,fallback)=>Array.isArray(value)?value: /^#[\da-f]{6}$/i.test(value||'')?[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255):fallback;
    const body=rgb(palette.primary,[.56,.49,.37]),ink=body.map(v=>Math.max(.045,v*.23)),highlight=body.map(v=>Math.min(1,v+.2));
    for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
      const i=x+y*WIDTH,cut=result.cuts[i],rim=!cut&&x>0&&y>0&&result.cuts[i-1-WIDTH]>.5;
      const tone=cut?ink:rim?highlight:body;
      for(let c=0;c<3;c++)data[i*4+c]=Math.round(tone[c]*255);data[i*4+3]=255;
    }return{...result,data};
  }
  function paint(ctx,raw,palette,pairs,glyphs,factory){
    const result=image(raw,palette,pairs,glyphs),cv=ctx.canvas.ownerDocument?.createElement('canvas');
    // Callers can also supply a canvas factory for the server's Canvas implementation.
    const canvas=cv||factory?.(WIDTH,HEIGHT);
    if(!canvas)throw Error('An engraving canvas factory is required.');canvas.width=WIDTH;canvas.height=HEIGHT;
    const c=canvas.getContext('2d'),pixels=c.createImageData(WIDTH,HEIGHT);pixels.data.set(result.data);c.putImageData(pixels,0,0);
    ctx.imageSmoothingEnabled=false;ctx.drawImage(canvas,0,0,ctx.canvas.width,ctx.canvas.height);return result;
  }
  function mesh(raw,palette,pairs,glyphs,axis='x',sign=-1){
    const result=image(raw,palette,pairs,glyphs),vertices=[],indices=[],height=(x,y)=>{
      let sum=0;for(const[dx,dy]of[[0,0],[-1,0],[0,-1],[-1,-1]])sum+=result.cuts[Math.max(0,Math.min(WIDTH-1,x+dx))+Math.max(0,Math.min(HEIGHT-1,y+dy))*WIDTH];
      return sum*.25;
    };
    const position=(u,v,depth)=>{
      const p=[sign<0?.37+depth*.028:.63-depth*.028,.21+.58*(sign<0?1-u:u),.42+.48*(1-v)];
      return axis==='y'?[1-p[1],p[0],p[2]]:p;
    };
    for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
      const base=vertices.length/9,i=(x+y*WIDTH)*4,color=Array.from(result.data.subarray(i,i+3),v=>v/255);
      const du=(height(x+1,y)-height(x,y))*.028*WIDTH/.58,dv=(height(x,y+1)-height(x,y))*.028*HEIGHT/.48;
      let normal=[sign,sign*du,-dv];if(axis==='y')normal=[-normal[1],normal[0],normal[2]];
      const len=Math.hypot(...normal);normal=normal.map(v=>v/len);
      for(const[dx,dy]of[[0,0],[1,0],[1,1],[0,1]])vertices.push(...position((x+dx)/WIDTH,(y+dy)/HEIGHT,height(x+dx,y+dy)),...normal,...color);
      indices.push(base,base+1,base+2,base,base+2,base+3);
    }return{vertices:new Float32Array(vertices),indices:new Uint16Array(indices)};
  }
  function replacesClueOverlay(dungeon,art){
    if(!art.puzzleClue||art.surface!=='object')return false;
    const plaque=dungeon.physicalPuzzle?.fixtures?.find(f=>f.id==='plaque');
    return !!plaque&&art.key===plaque.key&&dungeon.tiles?.[plaque.tiles[0]]?.spriteSpec?.voxelShape==='puzzle_plaque';
  }
  return{styles,alphabet,describe,glyph,raster,image,paint,mesh,replacesClueOverlay};
});
