(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RetroDetails=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const colors=[[0,0,0],[255,255,255],[150,40,46],[91,214,206],[159,45,173],[65,185,54],[39,36,196],[239,243,71],[159,72,21],[94,53,0],[218,95,102],[71,71,71],[120,120,120],[145,255,132],[104,100,255],[174,174,174]];
  // cc110: hypothetical 1992 expansion palette, retaining all sixteen VIC-II colors.
  const enhancedColors=[...colors,[24,24,28],[43,41,45],[94,94,94],[148,148,148],[211,211,211],[199,155,77],[246,209,140],[255,235,185],[48,31,16],[123,85,43],[191,124,62],[88,30,36],[23,32,72],[64,83,128],[39,74,45],[55,111,112]];
  const expandedColors=[...enhancedColors,[12,12,16],[34,34,38],[58,58,62],[82,82,86],[106,106,110],[132,132,136],[162,162,166],[192,192,196],[230,230,225],[255,246,214],[225,184,111],[166,132,76],[143,106,53],[98,67,33],[67,43,23],[31,20,12],[118,29,36],[184,61,68],[237,136,137],[49,30,73],[192,100,199],[23,26,114],[56,60,154],[142,145,235],[16,46,62],[45,91,107],[83,147,159],[137,229,216],[24,91,34],[91,142,53],[167,201,80],[209,224,125]];
  const palettes={16:colors,32:enhancedColors,64:expandedColors},enhancedLookups=new Map();
  function enhanced(base,width=640,height=400,colorCount=32){
    if(![[320,200],[640,400],[1280,800]].some(size=>size[0]===width&&size[1]===height)||base.length!==width*height*4||!palettes[colorCount])throw new RangeError('Unsupported retro frame size or palette.');
    const palette=palettes[colorCount];let lookup=enhancedLookups.get(colorCount);
    if(!lookup){lookup=new Uint8Array(32768);for(let r=0;r<32;r++)for(let g=0;g<32;g++)for(let b=0;b<32;b++){let best=0,error=Infinity;for(let i=0;i<palette.length;i++){const c=palette[i],e=2*(r*8+4-c[0])**2+4*(g*8+4-c[1])**2+3*(b*8+4-c[2])**2;if(e<error){best=i;error=e;}}lookup[r*1024+g*32+b]=best;}enhancedLookups.set(colorCount,lookup);}
    const exact=new Map(palette.map((c,i)=>[(c[0]<<16)|(c[1]<<8)|c[2],i]));
    const data=new Uint8ClampedArray(base.length),indices=new Uint8Array(width*height);
    for(let p=0;p<indices.length;p++){const i=p*4,c=exact.get((base[i]<<16)|(base[i+1]<<8)|base[i+2])??lookup[(base[i]>>3)*1024+(base[i+1]>>3)*32+(base[i+2]>>3)];indices[p]=c;const rgb=palette[c];data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];data[i+3]=255;}
    return{data,indices,width,height,colorCount,mode:'enhanced'};
  }
  function legacyFrame(frame){if(frame.mode!=='enhanced')return frame;const data=new Uint8ClampedArray(320*200*4);for(let y=0;y<200;y++)for(let x=0;x<320;x++){const source=(Math.floor(y*frame.height/200)*frame.width+Math.floor(x*frame.width/320))*4;data.set(frame.data.subarray(source,source+4),(y*320+x)*4);}return hires(data);}
  const packed=new Map(colors.map((c,i)=>[(c[0]<<16)|(c[1]<<8)|c[2],i]));
  const distances=colors.map(a=>colors.map(b=>2*(a[0]-b[0])**2+4*(a[1]-b[1])**2+3*(a[2]-b[2])**2));
  function closest(r,g,b){const exact=packed.get((r<<16)|(g<<8)|b);if(exact!==undefined)return exact;let best=0,error=Infinity;for(let i=0;i<16;i++){const c=colors[i],e=2*(r-c[0])**2+4*(g-c[1])**2+3*(b-c[2])**2;if(e<error){error=e;best=i;}}return best;}
  const hash=(x,y,seed)=>{let n=(Math.imul(x+1,73856093)^Math.imul(y+1,19349663)^seed)>>>0;n=Math.imul(n^(n>>>16),0x45d9f3b)>>>0;return(n^(n>>>16))>>>0;};
  function seedFor(value){let n=2166136261;for(const c of String(value||''))n=Math.imul(n^c.charCodeAt(0),16777619)>>>0;return n;}
  // A separate paint layer: alpha, silhouettes and the supplied base coat are never mutated.
  function paint(base,width,height,{kind='wall',material='stone',seed=''}={}){
    const out=new Uint8ClampedArray(base);if(width<8||height<8||base.length!==width*height*4)return out;
    // Trace existing pigment transitions only; flat surfaces receive no invented scratches.
    const luma=i=>base[i]*.299+base[i+1]*.587+base[i+2]*.114;
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const i=(y*width+x)*4;if(base[i+3]!==255)continue;
      const neighbors=[i-4,i+4,i-width*4,i+width*4];if(neighbors.some(j=>base[j+3]!==255))continue;
      const current=luma(i),low=Math.min(...neighbors.map(luma)),high=Math.max(...neighbors.map(luma));
      if(high-low<28||kind==='art'||kind==='character')continue;
      const index=closest(base[i],base[i+1],base[i+2]);
      // Darken the existing low side of a joint; preserve the original bright ridge.
      if(current<high-24&&current<=low+4&&(x+y)%3===0){const c=colors[index===0?0:11];if(luma(i)>71)out.set(c,i);}
    }
    return out;
  }
  const cellCache=new Map();
  function cellPalette(counts){
    const key=Array.from(counts).join(',');if(cellCache.has(key))return cellCache.get(key);
    const selected=[0],errors=distances.map(row=>row[0]);
    for(let slot=0;slot<3;slot++){let winner=-1,gain=-1;for(let c=1;c<16;c++){if(selected.includes(c))continue;let improvement=0;for(let i=1;i<16;i++)improvement+=counts[i]*Math.max(0,errors[i]-distances[i][c]);if(improvement>gain){gain=improvement;winner=c;}}if(winner<0||gain===0)break;selected.push(winner);for(let i=0;i<16;i++)errors[i]=Math.min(errors[i],distances[i][winner]);}
    const map=Uint8Array.from(colors,(_,i)=>selected.reduce((best,c)=>distances[i][c]<distances[i][best]?c:best,0));
    const value={selected,map};if(cellCache.size>=4096)cellCache.delete(cellCache.keys().next().value);cellCache.set(key,value);return value;
  }
  // Standard VIC-II multicolor bitmap: 160x200, 40x25 cells of 4x8 wide pixels.
  // Global background index 0 plus no more than three per-cell foreground colors.
  function multicolor(base,width=160,height=200){
    if(width!==160||height!==200||base.length!==128000)throw new RangeError('VIC-II multicolor requires a 160x200 RGBA frame.');
    const data=new Uint8ClampedArray(base),indices=new Uint8Array(32000),cells=[];
    for(let p=0;p<32000;p++){const i=p*4;indices[p]=closest(base[i],base[i+1],base[i+2]);}
    for(let cy=0;cy<25;cy++)for(let cx=0;cx<40;cx++){
      const counts=new Uint8Array(16);for(let y=0;y<8;y++)for(let x=0;x<4;x++)counts[indices[(cy*8+y)*160+cx*4+x]]++;
      const table=cellPalette(counts);cells.push(table.selected);
      for(let y=0;y<8;y++)for(let x=0;x<4;x++){const p=(cy*8+y)*160+cx*4+x,index=table.map[indices[p]],i=p*4;indices[p]=index;data.set(colors[index],i);data[i+3]=255;}
    }
    return{data,indices,cells,background:0,width,height};
  }
  // Export a standard Koala bitmap so the frame can be viewed on a real VIC-II/VICE.
  function koala(frame){
    if(frame.width!==160||frame.height!==200||frame.cells?.length!==1000)throw Error('A constrained multicolor frame is required.');
    const bytes=new Uint8Array(10003);bytes[0]=0;bytes[1]=96;
    for(let cell=0;cell<1000;cell++){const palette=[0,...frame.cells[cell].filter(i=>i!==0)];while(palette.length<4)palette.push(0);bytes[8002+cell]=(palette[1]<<4)|palette[2];bytes[9002+cell]=palette[3];for(let y=0;y<8;y++){let row=0;for(let x=0;x<4;x++){const p=(Math.floor(cell/40)*8+y)*160+(cell%40)*4+x,index=palette.indexOf(frame.indices[p]);row=(row<<2)|Math.max(0,index);}bytes[2+cell*8+y]=row;}}
    bytes[10002]=0;return bytes;
  }
  const hiresCache=new Map();
  function hiresPalette(counts){
    const key=Array.from(counts).join(',');if(hiresCache.has(key))return hiresCache.get(key);
    const present=[];for(let i=0;i<16;i++)if(counts[i])present.push(i);
    let pair=present.length<2?[present[0]||0,present[0]||0]:present.slice(0,2),best=Infinity;
    if(present.length>2)for(let a=0;a<16;a++)for(let b=a+1;b<16;b++){
      // Retain real ink strokes rather than blending sparse black into the base color.
      if(counts[0]>=3&&a!==0)continue;
      let error=0;for(const i of present)error+=counts[i]*Math.min(distances[i][a],distances[i][b]);
      if(error<best){best=error;pair=[a,b];}
    }
    const map=Uint8Array.from(colors,(_,i)=>distances[i][pair[0]]<=distances[i][pair[1]]?pair[0]:pair[1]);
    const result={pair,map};if(hiresCache.size>=4096)hiresCache.delete(hiresCache.keys().next().value);hiresCache.set(key,result);return result;
  }
  function hires(base,width=320,height=200){
    if(width!==320||height!==200||base.length!==256000)throw new RangeError('VIC-II hires requires a 320x200 RGBA frame.');
    const data=new Uint8ClampedArray(base),indices=new Uint8Array(64000),cells=[];
    for(let p=0;p<64000;p++){const i=p*4;indices[p]=closest(base[i],base[i+1],base[i+2]);}
    for(let cy=0;cy<25;cy++)for(let cx=0;cx<40;cx++){
      const counts=new Uint8Array(16);for(let y=0;y<8;y++)for(let x=0;x<8;x++)counts[indices[(cy*8+y)*320+cx*8+x]]++;
      const table=hiresPalette(counts);cells.push(table.pair);
      for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p=(cy*8+y)*320+cx*8+x,index=table.map[indices[p]],i=p*4;indices[p]=index;data.set(colors[index],i);data[i+3]=255;}
    }
    return{data,indices,cells,width,height,mode:'hires'};
  }
  // C64 memory image: load $1c00; screen at $1c00, bitmap at $2000.
  // VIC bank 0, $d018=$78, bitmap enabled in $d011, multicolor cleared in $d016.
  function hiresPrg(frame){
    if(frame.mode!=='hires'||frame.cells?.length!==1000)throw Error('A constrained hires frame is required.');
    const bytes=new Uint8Array(9026);bytes[0]=0;bytes[1]=28;
    for(let cell=0;cell<1000;cell++){const pair=frame.cells[cell];bytes[2+cell]=(pair[1]<<4)|pair[0];for(let y=0;y<8;y++){let row=0;for(let x=0;x<8;x++){const p=(Math.floor(cell/40)*8+y)*320+(cell%40)*8+x;row=(row<<1)|(frame.indices[p]===pair[1]&&pair[0]!==pair[1]?1:0);}bytes[1026+cell*8+y]=row;}}
    return bytes;
  }
  function shader(source){
    if(!source.includes('u_torchCount')||!source.includes('void main()'))return source;
    const size=Number(source.match(/uniform vec3 u_torchPos\[(\d+)\]/)?.[1]||64);
    const glsl=`
vec3 retroPalette(int i) {
  const vec3 p[16] = vec3[16](${colors.map(c=>'vec3('+c.map(n=>n+'.0').join(',')+')/255.0').join(',')});
  return p[clamp(i,0,15)];
}
uniform float u_retroPhase;
vec2 retroLighting(vec3 pos, vec3 N) {
  float illumination=0.38, facing=0.0, weight=0.0;
  for(int i=0;i<${Math.min(size,8)};i++) { if(i>=u_torchCount)break;
    vec3 toLight=u_torchPos[i]-pos;float distanceToLight=length(toLight);
    float reach=max(0.1,u_torchRadius[i]);float falloff=max(0.0,1.0-distanceToLight/(reach*1.8));
    float strength=falloff*falloff*clamp(u_torchIntensity[i],0.0,1.5);
    float diffuse=max(0.0,dot(N,toLight/max(0.001,distanceToLight)));
    illumination+=strength*(0.15+0.85*diffuse);facing+=strength*diffuse;weight+=strength;
  }
  return vec2(clamp(illumination,0.0,1.0),weight>0.001?facing/weight:0.0);
}
// Input is the completed, shadow-tested Modern voxel color.
vec3 retroTrace(vec3 shaded, vec3 pos, vec3 N) {
  float value=dot(shaded,vec3(0.299,0.587,0.114));
  float ridge=length(dFdx(N))+length(dFdy(N));
  float gradient=abs(dFdx(value))+abs(dFdy(value));
  float edge=clamp(ridge+gradient,0.0,1.0);
  // Widen only the shadow range; existing highlights keep their exact values.
  vec3 ink=shaded*mix(0.5,1.0,smoothstep(0.06,0.38,value));
  // Cool blue/violet shadow inks borrow existing light levels and face orientation.
  float shadowBand=(1.0-smoothstep(0.08,0.38,value))*0.55;
  vec3 coolInk=mix(vec3(0.09,0.125,0.28),vec3(0.192,0.118,0.286),clamp(0.5+0.5*N.x,0.0,1.0));
  ink=mix(ink,coolInk*clamp(value/0.14,0.0,1.0),shadowBand);
  // A restrained paper-white lift only where Modern already supplies a highlight.
  ink=mix(ink,vec3(1.0),0.04*smoothstep(0.58,0.95,value));
  // Accentuate actual transitions only; preserve quiet flat faces.
  // Solid black at actual dark creases; retain the finished lighting on flat faces.
  if(value<0.07||(edge>0.04&&value<0.30))ink=vec3(0.0);
  else if(edge>0.018&&value<0.42)ink*=0.38;
  if(edge>0.08&&value>0.58)ink=mix(ink,vec3(1.0),0.18);
  // No light is added to dark faces. Sparse glints inherit the existing bright edge.
  vec2 uv=abs(N.z)>0.6?pos.xy:abs(N.x)>abs(N.y)?pos.yz:pos.xz;
  vec2 q=floor(uv*48.0);
  if(edge>0.12&&value>0.72&&mod(q.x+3.0*q.y,7.0)<1.0&&mod(floor(u_retroPhase)+floor(pos.x*3.0+pos.y*5.0),7.0)!=2.0)ink=mix(ink,vec3(1.0),0.16);
  return clamp(ink,0.0,1.0);
}
vec3 retroPaint(vec3 base, vec3 pos, vec3 normal) {
  if(max(base.r,max(base.g,base.b))<0.035)return vec3(0.0);
  vec3 N=normalize(normal);vec2 lighting=retroLighting(pos,N);float illumination=lighting.x;
  vec2 uv=abs(N.z)>0.6?pos.xy:abs(N.x)>abs(N.y)?pos.yz:pos.xz;
  vec2 q=floor(uv*48.0);
  float footprint=max(length(dFdx(uv)),length(dFdy(uv)))*48.0;
  // Real normal and pigment transitions locate ridges and grooves, not a scratch texture.
  float pigment=dot(base,vec3(0.299,0.587,0.114));
  float edge=clamp(length(dFdx(N))+length(dFdy(N))+abs(dFdx(pigment))+abs(dFdy(pigment)),0.0,1.0);
  float stipple=mod(q.x+q.y*2.0,4.0);
  float band=illumination<0.48?0.68:illumination<0.68?0.84:1.0;
  vec3 target=base*band;
  // Stable sparse pen marks only at existing shaded transitions.
  if(footprint<1.5&&edge>0.08&&illumination<0.68&&stipple<1.0)target=vec3(0.0);
  // Light animation is confined to bright ridge pixels. Base shading never uses the clock.
  float localPhase=mod(floor(u_retroPhase)+floor(pos.x*3.0+pos.y*5.0),7.0);
  float glintMask=mod(q.x+q.y*3.0,5.0);
  if(footprint<1.5&&edge>0.06&&lighting.y>0.55&&illumination>0.68&&glintMask<1.0&&localPhase!=2.0)target=mix(base,vec3(1.0),0.65);
  int best=0;float error=100.0;
  for(int i=0;i<16;i++){vec3 d=target-retroPalette(i);float e=dot(d*d,vec3(2.0,4.0,3.0));if(e<error){error=e;best=i;}}
  return retroPalette(best);
}

`;
    return source.replace('void main() {',glsl+'\nvoid main() {');
  }
  function torchOffset(seed,timeMs){const steps=[0,1,0,-1,0,0,1,0,-1,0,1];return steps[((Math.floor(timeMs/240)+Math.abs(Math.floor(seed)))%steps.length+steps.length)%steps.length]/64;}
  return{paint,multicolor,koala,hires,hiresPrg,shader,colors,torchOffset,enhanced,enhancedColors,expandedColors,palettes,legacyFrame};
});
