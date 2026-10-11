(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./renderCharacterProcedural'):root.ProceduralCharacters,
    typeof module==='object'&&module.exports?require('./sculptureForms'):root.SculptureForms,
    typeof module==='object'&&module.exports?require('./shrineIconography'):root.ShrineIconography,
    typeof module==='object'&&module.exports?require('./artCharacters'):root.ArtCharacters);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FrescoFigures=api;
})(typeof window==='undefined'?globalThis:window,function(Characters,Sculptures,Icons,People){
  'use strict';
  const cache=new Map();
  const gestures={standing:[[0,0],[0,0]],contrapposto:[[.18,-.12],[-.12,.35]],offering:[[.5,-1.4],[-.5,1.4]],
    invocation:[[2.3,-.25],[-2.3,.25]],mourning:[[-.5,-1.35],[-.1,.15]],pointing:[[0,0],[-1.5,.05]],
    reading:[[.55,-1.4],[-.55,1.4]],kneeling:[[.5,-1.25],[-.5,1.25]],seated:[[.4,-1.15],[-.4,1.15]],
    reclining:[[.25,-.6],[-.8,.45]],guarding:[[-.2,-.9],[-.1,.8]],striding:[[.4,0],[-.4,0]]};
  function bbox(pixels,accept){
    let x0=pixels.w,y0=pixels.h,x1=-1,y1=-1;
    for(let y=0;y<pixels.h;y++)for(let x=0;x<pixels.w;x++){
      const i=x+y*pixels.w;if(pixels.data[i*4+3]&&accept(pixels.parts[i],x,y)){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    }
    return x1<0?null:{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};
  }
  function layer(pixels,accept,createCanvas){
    const c=createCanvas(pixels.w,pixels.h),ctx=c.getContext('2d'),image=ctx.createImageData(pixels.w,pixels.h);
    for(let y=0;y<pixels.h;y++)for(let x=0;x<pixels.w;x++){
      const i=x+y*pixels.w;if(accept(pixels.parts[i],x,y))image.data.set(pixels.data.subarray(i*4,i*4+4),i*4);
    }
    ctx.putImageData(image,0,0);return c;
  }
  function attribute(ctx,name,hand,palette){
    if(!hand||!name||name==='none')return;
    const x=Math.round(hand.x),y=Math.round(hand.y),light=palette.highlight||'#ead8ad',dark=palette.shadow||'#302c31';
    ctx.fillStyle=light;ctx.strokeStyle=light;ctx.lineWidth=1;
    if(['staff','sword','torch','scales'].includes(name)){ctx.fillRect(x,y-17,1,21);if(name==='sword')ctx.fillRect(x-3,y-3,7,1);
      if(name==='torch'){ctx.fillStyle='#cf683d';ctx.fillRect(x-1,y-20,3,5);ctx.fillStyle=light;ctx.fillRect(x,y-20,1,3);}
      if(name==='scales'){ctx.fillRect(x-7,y-13,15,1);ctx.beginPath();ctx.moveTo(x-6,y-13);ctx.lineTo(x-8,y-7);ctx.lineTo(x-4,y-7);ctx.closePath();ctx.stroke();ctx.beginPath();ctx.moveTo(x+6,y-13);ctx.lineTo(x+4,y-7);ctx.lineTo(x+8,y-7);ctx.closePath();ctx.stroke();}
    }else if(name==='book'||name==='scroll'){
      ctx.fillRect(x-5,y-3,11,6);ctx.fillStyle=dark;ctx.fillRect(x,y-3,1,6);if(name==='scroll'){ctx.fillRect(x-6,y-4,2,8);ctx.fillRect(x+5,y-4,2,8);}
    }else if(name==='bowl'){ctx.beginPath();ctx.arc(x,y-2,5,0,Math.PI);ctx.fill();}
    else if(name==='shield'||name==='orb'){ctx.beginPath();ctx.ellipse(x,y-3,name==='shield'?5:3,name==='shield'?7:3,0,0,Math.PI*2);ctx.fill();}
    else if(name==='hourglass'){ctx.fillRect(x-3,y-6,7,1);ctx.fillRect(x-3,y+2,7,1);ctx.beginPath();ctx.moveTo(x-2,y-5);ctx.lineTo(x+2,y+1);ctx.moveTo(x+2,y-5);ctx.lineTo(x-2,y+1);ctx.stroke();}
    else if(['scythe','sickle','pick','halberd'].includes(name)){
      ctx.fillRect(x,y-17,1,21);ctx.beginPath();ctx.moveTo(x-6,y-11);
      if(name==='pick')ctx.lineTo(x+5,y-19);else ctx.quadraticCurveTo(x-2,y-20,x+6,y-17);ctx.stroke();
      if(name==='halberd'){ctx.fillRect(x+1,y-17,4,5);ctx.fillRect(x,y-22,1,6);}if(name==='sickle')ctx.fillRect(x,y-3,2,5);
    }else if(['spear','lance','harpoon'].includes(name)){
      ctx.fillRect(x,y-20,1,27);ctx.beginPath();ctx.moveTo(x,y-25);ctx.lineTo(x-2,y-19);ctx.lineTo(x+2,y-19);ctx.closePath();ctx.fill();
      if(name==='lance'){ctx.fillRect(x-2,y-5,5,2);ctx.fillRect(x,y,2,7);}
      if(name==='harpoon'){ctx.fillRect(x+1,y-20,3,1);ctx.beginPath();ctx.arc(x+4,y+4,4,0,Math.PI*1.7);ctx.stroke();}
    }else if(name==='dagger'){ctx.fillRect(x,y-8,2,12);ctx.fillRect(x-3,y,7,1);}
    else if(name==='mace'||name==='club'){ctx.fillRect(x,y-10,2,15);ctx.fillRect(x-2,y-16,6,7);if(name==='mace')ctx.fillRect(x-3,y-14,8,2);}
    else if(name==='gauntlet'){ctx.fillRect(x-2,y-5,6,8);for(let i=0;i<3;i++)ctx.fillRect(x-2+i*2,y-8,1,3);}
    else if(name==='bow'||name==='lyre'){
      ctx.beginPath();ctx.moveTo(x,y-16);ctx.quadraticCurveTo(x+9,y-5,x,y+6);ctx.lineTo(x,y-16);ctx.stroke();
      if(name==='lyre')for(let i=1;i<4;i++)ctx.fillRect(x+i,y-10,1,12);else ctx.fillRect(x-5,y-4,14,1);
    }else if(['whip','chain','sling','net'].includes(name)){
      ctx.beginPath();ctx.moveTo(x,y-2);ctx.bezierCurveTo(x+13,y-15,x+14,y+14,x+2,y+12);ctx.stroke();
      if(name==='chain')for(let i=0;i<6;i++)ctx.strokeRect(x+5+(i%2)*2,y-3+i*3,2,3);
      if(name==='sling')ctx.fillRect(x+4,y+9,5,3);
      if(name==='net'){for(let i=0;i<5;i++){ctx.fillRect(x+i*2,y,1,11);ctx.fillRect(x,y+i*2,10,1);}}
    }else if(name==='catapult'){
      ctx.fillRect(x-10,y+4,19,2);ctx.fillRect(x-2,y-2,3,8);ctx.beginPath();ctx.moveTo(x-5,y+4);ctx.lineTo(x+8,y-13);ctx.stroke();
      ctx.fillRect(x+5,y-14,7,2);ctx.strokeRect(x-9,y+5,4,4);ctx.strokeRect(x+4,y+5,4,4);
    }
  }
  function assemble(raw,palette,style,createCanvas){
    const deity=Icons.name(raw.subject),person=!deity&&(raw.race||raw.className||raw.subject==='mortal'||People.race(raw.subject)),
      figure={...raw,...(!raw.race&&People.race(raw.subject)?{race:People.race(raw.subject)}:{})},
      form=deity?Icons.pantheon[deity].form:person?People.form(figure):raw.subject,
      original=person?People.characterSpec(figure,palette):Sculptures.characterSpec({label:'Painted '+raw.subject,form,deity},palette),traits=JSON.parse(JSON.stringify(original.traits));
    traits.heroic=true;traits.gesture=true;traits.naturalLimbs=true;traits.weaponPose='default';traits.items=[];
    if(form!=='dragon'){
      if(!person){traits.build='slender';traits.statuesque=true;}
      delete traits.garment;
      if(raw.robe!=='class'){traits.outfit.style=raw.robe==='armor'?'mail':'robe';traits.outfit.cape=raw.robe==='mantle';}
      if(raw.head!=='class'){traits.outfit.hood=raw.head==='hood';traits.outfit.helm=raw.head==='helmet'?'open':raw.head==='crown'?'crown':'none';}
    }
    const spec=Characters.buildProceduralSpriteSpec({name:original.name,race:original.race,sex:original.sex,class:figure.className||'Painted ancestor',level:1},traits,{signature:false,source:'fresco-figure',salt:original.seed});
    const source=Characters.renderAssemblyPixels(spec),p={...source,parts:new Uint8Array(source.parts)},parts=p.parts;
    // Outline pixels inherit the adjacent body part, so repositioning a limb also moves its ink edge.
    for(let y=0;y<p.h;y++)for(let x=0;x<p.w;x++){
      const i=x+y*p.w;if(parts[i]!==99)continue;
      for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<p.w&&ny<p.h&&p.parts[nx+ny*p.w]>0&&p.parts[nx+ny*p.w]!==99){parts[i]=p.parts[nx+ny*p.w];break;}}
    }
    const pad=12,c=createCanvas(p.w+pad*2,p.h+pad*2),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.translate(pad,pad);
    if(form==='dragon'){
      const angle={invocation:-.2,mourning:.18,striding:.1,reclining:.65,guarding:-.08}[raw.pose]||0;
      ctx.translate(p.w/2,p.h/2);ctx.rotate(angle);ctx.translate(-p.w/2,-p.h/2);ctx.drawImage(layer(p,()=>true,createCanvas),0,0);
      attribute(ctx,raw.attribute,{x:p.w*.35,y:p.h*.63},palette);
    }else{
      const armIds=new Set([11,12,13,14,26,27]),headIds=new Set([15,16,17,18,19,24,28,40]),lowerIds=new Set([7,8,10,38,39]);
      const lower=bbox(p,id=>lowerIds.has(id)),sitting=['kneeling','seated'].includes(raw.pose),lowerScale=sitting?.5:1,shift=sitting&&lower?lower.h*.5:0;
      ctx.drawImage(layer(p,id=>!armIds.has(id)&&!headIds.has(id)&&!lowerIds.has(id),createCanvas),0,shift);
      if(lower){ctx.save();ctx.translate(0,lower.y+shift);ctx.scale(1,lowerScale);ctx.translate(0,-lower.y);
        if(raw.pose==='striding')ctx.transform(1,0,.18,1,-lower.y*.18,0);ctx.drawImage(layer(p,id=>lowerIds.has(id),createCanvas),0,0);ctx.restore();}
      const head=bbox(p,id=>headIds.has(id));
      if(head){const tilt=['mourning','reading','kneeling'].includes(raw.pose)?.2:raw.pose==='contrapposto'?-.08:0;
        ctx.save();ctx.translate(head.x+head.w/2,head.y+head.h+shift);ctx.rotate(tilt);ctx.translate(-head.x-head.w/2,-head.y-head.h);ctx.drawImage(layer(p,id=>headIds.has(id),createCanvas),0,0);ctx.restore();}
      const hands=[];
      for(const [i,ids]of [[11,13,26],[12,14,27]].entries()){
        const b=bbox(p,id=>ids.includes(id));if(!b)continue;
        const split=b.y+b.h*.52,sx=b.x+b.w/2,sy=b.y,upper=split-sy,angles=(gestures[raw.pose]||gestures.standing)[i];
        ctx.save();ctx.translate(sx,sy+shift);ctx.rotate(angles[0]);ctx.translate(-sx,-sy);ctx.drawImage(layer(p,(id,x,y)=>ids.includes(id)&&y<split,createCanvas),0,0);ctx.restore();
        const elbow={x:sx-Math.sin(angles[0])*upper,y:sy+shift+Math.cos(angles[0])*upper},a=angles[0]+angles[1];
        ctx.save();ctx.translate(elbow.x,elbow.y);ctx.rotate(a);ctx.translate(-sx,-split);ctx.drawImage(layer(p,(id,x,y)=>ids.includes(id)&&y>=split,createCanvas),0,0);ctx.restore();
        hands.push({x:elbow.x-Math.sin(a)*(b.h-upper),y:elbow.y+Math.cos(a)*(b.h-upper)});
      }
      attribute(ctx,raw.attribute,hands[raw.pose==='pointing'?1:0],palette);
      if(raw.head==='laurel'&&head){ctx.fillStyle=palette.secondary;for(let i=0;i<5;i++)ctx.fillRect(head.x+i*head.w/5,head.y+shift,1,2);}
    }
    const patron=deity||People.defaults(figure).patron;
    if(patron)Icons.paint(ctx,patron,p.w-14,2,13,Icons.pantheon[patron].color);
    let image=c.getContext('2d').getImageData(0,0,c.width,c.height);
    if(raw.facing!=='front'){
      const view=Characters.deriveViewFromFront(image.data,c.width,c.height,'threeQuarter',raw.facing==='left'?-1:1);image.data.set(view);
    }
    for(let i=0;i<image.data.length;i+=4)if(image.data[i+3]){
      const d=image.data,shade=(d[i]+d[i+1]+d[i+2])/3;
      if(style==='classical_greek'){const col=shade>195?[230,187,112]:[42,32,28];d[i]=col[0];d[i+1]=col[1];d[i+2]=col[2];}
      else if(style==='mesopotamian'){d[i]=Math.min(235,shade*.65+73);d[i+1]=Math.min(220,shade*.6+61);d[i+2]=Math.min(200,shade*.5+49);}
      else if(shade<45){d[i]=78;d[i+1]=56;d[i+2]=49;}else for(let j=0;j<3;j++)d[i+j]=Math.min(255,d[i+j]*.84+[34,28,19][j]);
    }
    ctx.setTransform(1,0,0,1,0,0);ctx.putImageData(image,0,0);
    if(raw.pose==='reclining'){
      const horizontal=createCanvas(c.height,c.width),h=horizontal.getContext('2d');h.translate(horizontal.width,0);h.rotate(Math.PI/2);h.drawImage(c,0,0);return horizontal;
    }
    return c;
  }
  function paint(ctx,raw,palette,box,style,createCanvas){
    const key=JSON.stringify([raw,palette,style]);
    let image=cache.get(key);if(!image){image=assemble(raw,palette,style,createCanvas);if(cache.size>=48)cache.delete(cache.keys().next().value);cache.set(key,image);}
    const pixels=image.getContext('2d').getImageData(0,0,image.width,image.height);
    const bounds=bbox({w:image.width,h:image.height,data:pixels.data,parts:new Uint8Array(image.width*image.height)},()=>true);
    if(bounds){
      const scale=Math.min(box.width/bounds.w,box.height/bounds.h)*People.scale({...raw,race:raw.race||People.race(raw.subject)}),w=bounds.w*scale,h=bounds.h*scale;
      ctx.imageSmoothingEnabled=false;ctx.drawImage(image,bounds.x,bounds.y,bounds.w,bounds.h,box.x+(box.width-w)/2,box.y+box.height-h,w,h);
    }
  }
  return{paint,assemble};
});
