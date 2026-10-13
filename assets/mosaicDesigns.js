(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./shrineIconography'):root.ShrineIconography,
    typeof module==='object'&&module.exports?require('./artCharacters'):root.ArtCharacters);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MosaicDesigns=api;
})(typeof window==='undefined'?globalThis:window,function(Icons,People){
  'use strict';
  const patterns=['apse_court','interlaced_roundels','opus_sectile','celestial_wheel','river_vine','dragon_guardians','star_lattice','funerary_garden','emerald_throne',
    'pantheon_rosette','sepulchra_knot','wyvern_spiral','guilloche_emblems','meander_pavement','honeycomb_medallions','spiral_shield','intersecting_circles'];
  const shapes=['rectangle','circle','hexagon','octagon'];
  function validate(art){
    if(art.mosaicPattern!==undefined&&(art.kind!=='mosaic'||!patterns.includes(art.mosaicPattern)))throw Error('Invalid mosaic pattern.');
    if(art.mosaicShape!==undefined&&(art.kind!=='mosaic'||!shapes.includes(art.mosaicShape)))throw Error('Invalid mosaic shape.');
    return{...(art.mosaicPattern!==undefined?{mosaicPattern:art.mosaicPattern}:{}),...(art.mosaicShape!==undefined?{mosaicShape:art.mosaicShape}:{})};
  }
  function forTradition(style){
    if(style==='byzantine')return['apse_court','interlaced_roundels','celestial_wheel','river_vine','emerald_throne','pantheon_rosette','sepulchra_knot','guilloche_emblems'];
    if(style==='egyptian'||style==='mesopotamian')return['star_lattice','dragon_guardians','funerary_garden','pantheon_rosette','honeycomb_medallions'];
    if(style==='classical_roman'||style==='classical_greek')return['opus_sectile','river_vine','interlaced_roundels','wyvern_spiral','meander_pavement','honeycomb_medallions','spiral_shield','intersecting_circles'];
    return['celestial_wheel','funerary_garden','dragon_guardians','interlaced_roundels','pantheon_rosette','sepulchra_knot','wyvern_spiral',
      'guilloche_emblems','meander_pavement','honeycomb_medallions','spiral_shield','intersecting_circles'];
  }
  function shape(art){return art.puzzleClue?'rectangle':shapes.includes(art.mosaicShape)?art.mosaicShape:'rectangle';}
  function suggestedShape(art){
    return{celestial_wheel:'circle',pantheon_rosette:'circle',sepulchra_knot:'circle',wyvern_spiral:'circle',guilloche_emblems:'circle',
      spiral_shield:'circle',honeycomb_medallions:'hexagon',interlaced_roundels:'octagon'}[resolvePattern(art)]||'rectangle';
  }
  function aspectRatio(art){return shape(art)==='rectangle'?1.5:1;}
  function outline(c,art,width,height,inset=0){
    const form=shape(art),cx=width/2,cy=height/2,r=Math.min(width,height)/2-inset;c.beginPath();
    if(form==='rectangle')c.rect(inset,inset,width-2*inset,height-2*inset);
    else if(form==='circle')c.arc(cx,cy,r,0,Math.PI*2);
    else{const sides=form==='hexagon'?6:8;
      for(let i=0;i<sides;i++){const a=i*2*Math.PI/sides+(sides===8?Math.PI/8:0),x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;
        if(i)c.lineTo(x,y);else c.moveTo(x,y);}c.closePath();}
  }
  function contains(art,u,v){
    if(u<0||u>1||v<0||v>1)return false;
    const form=shape(art),x=u-.5,y=v-.5;
    if(form==='rectangle')return true;
    if(form==='circle')return x*x+y*y<=.25;
    const sides=form==='hexagon'?6:8,offset=sides===8?Math.PI/8:0,apothem=.5*Math.cos(Math.PI/sides);
    for(let i=0;i<sides;i++){const a=(i+.5)*2*Math.PI/sides+offset;if(x*Math.cos(a)+y*Math.sin(a)>apothem)return false;}
    return true;
  }
  function finishShape(c,art,pal,width,height=64){
    if(shape(art)==='rectangle')return;
    c.save();c.globalCompositeOperation='destination-in';outline(c,art,width,height,1);c.fillStyle='#ffffff';c.fill();
    c.globalCompositeOperation='source-over';outline(c,art,width,height,2);c.strokeStyle=pal.secondary;c.lineWidth=2;c.stroke();
    outline(c,art,width,height,5);c.strokeStyle=pal.highlight;c.lineWidth=.7;c.stroke();c.restore();
  }
  function resolvePattern(art){
    if(patterns.includes(art.mosaicPattern))return art.mosaicPattern;
    const text=[art.label,art.description,...(art.motifs||[])].join(' ').toLowerCase();
    if(/sepulchra|emerald/.test(text))return /throne|hades/.test(text)?'emerald_throne':'sepulchra_knot';
    if(/star|celestial|constellation|orbit|zodiac/.test(text))return'celestial_wheel';
    if(/river|wave|crossing/.test(text))return'river_vine';
    if(/garden|grove|cypress/.test(text))return'funerary_garden';
    const deities=(art.motifs||[]).map(Icons.name).filter(Boolean);
    if(deities.length>1)return'pantheon_rosette';
    if(/wyvern|coiled dragon/.test(text))return'wyvern_spiral';
    const pool=forTradition(art.style);let seed=0;
    for(const ch of text)seed=(Math.imul(seed,31)+ch.charCodeAt(0))>>>0;
    return pool[seed%pool.length];
  }
  function isDragon(subject){return Icons.pantheon[Icons.name(subject)]?.form==='dragon'||/^dragon$/i.test(subject);}
  function figures(art){
    if(art.figures?.length)return art.figures;
    const pattern=resolvePattern(art),dragonPattern=['dragon_guardians','wyvern_spiral'].includes(pattern);
    const forms=['human','dragon','skeleton','wraith','angel','demon','mortal'];
    let subjects=(art.motifs||[]).map(s=>Icons.name(s)||People.hero(s)||People.race(s)||People.role(s)||s.toLowerCase())
      .filter(s=>Icons.name(s)||People.hero(s)||People.race(s)||People.role(s)||forms.includes(s)).slice(0,6);
    if(dragonPattern)subjects=subjects.filter(isDragon);
    if(!subjects.length)subjects=dragonPattern?['dragon','dragon']:['human'];
    const pose={apse_court:'benediction',emerald_throne:'offering',funerary_garden:'contrapposto',pantheon_rosette:'invocation',
      dragon_guardians:'bowing',wyvern_spiral:'flying'}[pattern]||'standing';
    return subjects.map((subject,i)=>{
      const deity=Icons.name(subject),hero=People.hero(subject),role=People.role(subject),race=People.race(subject),dragon=isDragon(subject);
      return{subject:role||race&&!deity?'mortal':subject,...(role||race&&!deity?{race:race||'Human',...(role?{className:role}:{})}:{}),
        pose,facing:dragon?(i%2?'left':'right'):'front',attribute:deity==='Mortacia'||hero?'sword':deity?Icons.pantheon[deity].attribute:People.defaults({className:role}).attribute,
        robe:role||hero?'class':'pleated',head:role||hero?'class':'bare',proportions:'classical',...(dragon?{anatomy:'serpentine'}:{})};
    });
  }
  function paint(c,art,pal,ink,figure,width=96,height=64){
    const light=pal.highlight,dark=pal.shadow,trim=pal.secondary,base=pal.primary,cx=width/2,cy=height/2;
    const path=(points,color,stroke)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();
      c.fillStyle=color;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=.65;c.stroke();}};
    const ring=(x,y,r,color,line=1)=>{c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.strokeStyle=color;c.lineWidth=line;c.stroke();};
    const disc=(x,y,r,color)=>{c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=color;c.fill();};
    const line=(points,color=trim,thickness=1)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=thickness;c.stroke();};
    const braid=(radius)=>{
      for(let strand=0;strand<2;strand++){
        const pts=[];for(let i=0;i<=96;i++){const a=i*Math.PI/48,r=radius+Math.sin(a*4+strand*Math.PI)*2;
          pts.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]);}
        line(pts,strand?light:trim,1.4);
      }
    };
    const vine=(x,y,side)=>{c.strokeStyle=trim;c.lineWidth=1.2;c.beginPath();c.moveTo(x,y+20);c.bezierCurveTo(x-side*14,y+5,x+side*14,y-9,x,y-20);c.stroke();
      for(let j=0;j<6;j++){const yy=y-16+j*6,xx=x+Math.sin(j*1.1)*4;path([[xx,yy],[xx+side*7,yy-4],[xx+side*5,yy+2]],j%2?light:trim);}};
    const shaped=shape(art)!=='rectangle';
    c.fillStyle=dark;c.fillRect(3,3,width-6,height-6);
    if(!shaped){c.strokeStyle=trim;c.lineWidth=1;c.strokeRect(5,5,width-10,height-10);
    // Small repeated border pieces, not one motif stretched to the length of the wall.
    for(let x=8;x<width-7;x+=5)for(const y of[7,height-7])path([[x,y-1.3],[x+2,y],[x,y+1.3],[x-2,y]],light);
    for(let y=12;y<height-10;y+=5)for(const x of[7,width-7])disc(x,y,.85,trim);
    }
    c.save();if(shaped)outline(c,art,width,height,7);else{c.beginPath();c.rect(9,10,width-18,height-20);}c.clip();
    const motif=(i,x,y,size)=>ink((art.motifs||['Dragon'])[i%(art.motifs?.length||1)],x-size/2,y-size/2,size,light);
    const pattern=resolvePattern(art);
    if(pattern==='emerald_throne'){
      c.fillStyle=trim;c.fillRect(cx-10,16,20,31);c.fillRect(cx-14,46,28,3);c.fillStyle=base;c.fillRect(cx-7,19,14,24);
      for(const side of[-1,1]){c.fillStyle=light;c.fillRect(cx+side*13-1,32,2,15);disc(cx+side*13,31,2,trim);}
      ink('Sepulchra',cx-7,19,14,light);motif(0,cx,40,9);
      const bw=Math.min(25,(width-42)/2);
      for(const [i,side]of[-1,1].entries())figure(i,{x:cx+side*(width/2-20)-bw/2,y:18,width:bw,height:32});
    }else if(pattern==='apse_court'){
      // A single mandorla and emblem field, not the fresco's three-figure architectural court.
      c.fillStyle=trim;c.fillRect(10,10,width-20,height-20);
      path([[cx,11],[cx+16,cy],[cx,height-11],[cx-16,cy]],base,light);
      ring(cx,20,6,light,.8);figure(0,{x:cx-13,y:15,width:26,height:36});
      for(const side of[-1,1])for(let i=0;i<3;i++){
        const x=cx+side*(width/2-17),y=17+i*15;disc(x,y,4,dark);motif(i,x,y,5);
      }
    }else if(pattern==='interlaced_roundels'){
      const r=Math.min(12,(width-23)/4.5);
      for(let i=0;i<3;i++){const x=cx+(i-1)*r*1.65,y=cy+(i%2?4:-3);
        disc(x,y,r,base);ring(x,y,r,trim,2.5);ring(x,y,r-2,light,.65);motif(i,x,y,r*1.1);}
      for(let x=16;x<width-12;x+=9){ring(x,14,2,trim);ring(x,height-14,2,trim);}
    }else if(pattern==='opus_sectile'){
      const unit=11;
      for(let y=10;y<height-10;y+=unit)for(let x=9;x<width-9;x+=unit){
        const alt=(Math.floor(x/unit)+Math.floor(y/unit))%2;
        path([[x,y],[x+unit,y],[x+unit,y+unit],[x,y+unit]],alt?base:trim);
        path([[x+unit/2,y+1],[x+unit-1,y+unit/2],[x+unit/2,y+unit-1],[x+1,y+unit/2]],dark,light);
        disc(x+unit/2,y+unit/2,1.7,alt?trim:light);
      }
      disc(cx,cy,11,dark);ring(cx,cy,11,light,1.5);motif(0,cx,cy,14);
    }else if(pattern==='celestial_wheel'){
      const r=Math.min(width/2-11,21);disc(cx,cy,r,base);
      for(const radius of[r,r-3,r*.46])ring(cx,cy,radius,trim,1);
      for(let i=0;i<12;i++){const a=i*Math.PI/6,x=cx+Math.cos(a)*r*.75,y=cy+Math.sin(a)*r*.75;
        c.strokeStyle=trim;c.lineWidth=.6;c.beginPath();c.moveTo(cx+Math.cos(a)*r*.48,cy+Math.sin(a)*r*.48);c.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);c.stroke();
        ink(i%3===0?'Moon':'Star',x-2.5,y-2.5,5,light);}
      motif(0,cx,cy,13);
    }else if(pattern==='river_vine'){
      for(const side of[-1,1])vine(cx+side*(width/2-18),cy,side);
      for(let y=40;y<height-11;y+=4){c.strokeStyle=trim;c.lineWidth=1;c.beginPath();c.moveTo(11,y);for(let x=11;x<width-10;x+=8)c.quadraticCurveTo(x+4,y-3,x+8,y);c.stroke();}
      motif(0,cx,cy-3,18);ink('Bowl',cx-7,cy+8,14,light);
    }else if(pattern==='dragon_guardians'){
      const bw=(width-22)/2;
      figure(0,{x:10,y:13,width:bw,height:36},{pose:'bowing',facing:'right'});
      figure(1,{x:cx+1,y:13,width:bw,height:36},{pose:'bowing',facing:'left'});
      disc(cx,18,5,trim);motif(0,cx,18,7);c.fillStyle=trim;c.fillRect(cx-1,36,2,15);ink('Bowl',cx-5,32,10,light);
    }else if(pattern==='star_lattice'){
      for(let y=15;y<height-10;y+=14)for(let x=16;x<width-10;x+=14){
        const pts=[];for(let i=0;i<16;i++){const a=i*Math.PI/8,r=i%2?3:7;pts.push([x+Math.cos(a)*r,y+Math.sin(a)*r]);}
        path(pts,base,light);disc(x,y,1.4,trim);
      }
    }else if(pattern==='funerary_garden'){
      c.fillStyle=base;c.fillRect(10,10,width-20,height-20);
      for(const side of[-1,1]){const x=cx+side*(width/2-19);path([[x-5,46],[x-3,24],[x,14],[x+3,24],[x+5,46]],dark,trim);
        c.fillStyle=trim;c.fillRect(x-.5,20,1,29);}
      ring(cx,24,8,trim,1);figure(0,{x:cx-13,y:17,width:26,height:34});
      for(let i=0;i<7;i++)ink('Leaf',12+i*(width-29)/6,47,5,light);
    }else if(pattern==='pantheon_rosette'){
      const r=Math.min(width/2-11,height/2-11);
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4,x=cx+Math.cos(a)*r*.76,y=cy+Math.sin(a)*r*.76;
        path([[cx,cy],[x+Math.cos(a+.9)*6,y+Math.sin(a+.9)*6],[cx+Math.cos(a)*r,cy+Math.sin(a)*r],
          [x+Math.cos(a-.9)*6,y+Math.sin(a-.9)*6]],i%2?base:trim,light);
      }
      disc(cx,cy,r*.57,dark);ring(cx,cy,r*.57,light,1.2);
      figure(0,{x:cx-11,y:cy-12,width:22,height:24});
      for(const side of[-1,1])for(const dy of[-11,11]){
        const x=cx+side*(width/2-17),y=cy+dy;disc(x,y,5,base);ring(x,y,5,trim);motif((side+1)+(dy>0?1:0),x,y,6);
      }
    }else if(pattern==='sepulchra_knot'){
      const r=Math.min(width/2-13,height/2-13);disc(cx,cy,r+2,base);braid(r);
      path([[cx,cy-12],[cx+12,cy],[cx,cy+12],[cx-12,cy]],dark,light);
      ink('Sepulchra',cx-7,cy-9,14,light);
      for(const side of[-1,1])for(const dy of[-12,12]){
        const x=cx+side*(width/2-17),y=cy+dy;
        ink('Leaf',x-3,y-3,6,trim);line([[x-side*4,y],[cx+side*(r+1),cy+Math.sign(dy)*5]],trim,.7);
      }
    }else if(pattern==='wyvern_spiral'){
      const r=Math.min(width/2-12,height/2-12);disc(cx,cy,r,base);braid(r);
      for(let i=0;i<12;i++){const a=i*Math.PI/6;disc(cx+Math.cos(a)*(r-4),cy+Math.sin(a)*(r-4),.7,light);}
      const bw=Math.min(48,width-24);figure(0,{x:cx-bw/2,y:cy-17,width:bw,height:34});
      for(const side of[-1,1])ink('Leaf',cx+side*(width/2-17)-3,cy-3,6,trim);
    }else if(pattern==='guilloche_emblems'){
      const r=Math.min(width/2-12,height/2-12);braid(r);braid(r-5);
      disc(cx,cy,r*.45,base);ring(cx,cy,r*.45,light);motif(0,cx,cy,r*.65);
      for(let i=0;i<8;i++){const a=i*Math.PI/4,x=cx+Math.cos(a)*(r-9),y=cy+Math.sin(a)*(r-9);
        disc(x,y,2.4,dark);motif(i,x,y,3.5);}
    }else if(pattern==='meander_pavement'){
      // Right-angle returning keys, not swastika motifs or a stretched continuous stripe.
      for(let x=10;x<width-13;x+=8)for(const [y,sign]of[[13,1],[height-13,-1]])
        line([[x,y+sign*4],[x,y],[x+6,y],[x+6,y+sign*4],[x+3,y+sign*4],[x+3,y+sign*2]],light,1.1);
      for(let y=23;y<height-20;y+=8)for(const [x,sign]of[[13,1],[width-13,-1]])
        line([[x+sign*4,y],[x,y],[x,y+6],[x+sign*4,y+6],[x+sign*4,y+3],[x+sign*2,y+3]],light,1.1);
      for(let y=24;y<height-20;y+=7)for(let x=24;x<width-20;x+=7)
        path([[x,y-3],[x+3,y],[x,y+3],[x-3,y]],(x+y)%2?base:trim);
      disc(cx,cy,8,dark);ring(cx,cy,8,trim);motif(0,cx,cy,10);
    }else if(pattern==='honeycomb_medallions'){
      const r=7.3,hex=(x,y,color)=>{
        const pts=[];for(let i=0;i<6;i++){const a=i*Math.PI/3;pts.push([x+r*Math.cos(a),y+r*Math.sin(a)]);}path(pts,color,light);
      };
      for(let i=0;i<6;i++){const a=(i+.5)*Math.PI/3,x=cx+Math.cos(a)*r*1.8,y=cy+Math.sin(a)*r*1.8;
        hex(x,y,i%2?base:trim);motif(i+1,x,y,6);}
      hex(cx,cy,dark);motif(0,cx,cy,9);
    }else if(pattern==='spiral_shield'){
      const radius=Math.min(width/2-11,height/2-11),bands=4,sectors=20;
      for(let j=0;j<bands;j++)for(let i=0;i<sectors;i++){
        const r=8+j*(radius-8)/bands,next=r+(radius-8)/bands,a=(i+j*.6)*Math.PI*2/sectors,b=a+Math.PI*2/sectors;
        path([[cx+Math.cos(a)*r,cy+Math.sin(a)*r],[cx+Math.cos(b)*next,cy+Math.sin(b)*next],
          [cx+Math.cos(a)*next,cy+Math.sin(a)*next]],i%2?light:trim);
      }
      ring(cx,cy,radius,trim);disc(cx,cy,7,base);ring(cx,cy,7,light);motif(0,cx,cy,9);
    }else if(pattern==='intersecting_circles'){
      for(let y=10;y<height-8;y+=9)for(let x=9;x<width-8;x+=9){ring(x,y,6.4,trim,1.2);disc(x+4.5,y+4.5,.7,light);}
      disc(cx,cy,10,base);ring(cx,cy,10,light);motif(0,cx,cy,13);
    }
    c.restore();
  }
  return{patterns,shapes,validate,forTradition,resolvePattern,figures,shape,suggestedShape,aspectRatio,contains,finishShape,paint};
});
