(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./shrineIconography'):root.ShrineIconography);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.StoneCarvings=api;
})(typeof window==='undefined'?globalThis:window,function(Icons){
  'use strict';
  const styles=['acanthus','guilloche','egg_dart','vine_scroll','dragon_knot','ossuary_lattice','rosette','palmette',
    'wave_chain','winged_medallion','runic_lintel','heraldic_beasts','star_vault','interlace',
    'laurel_festoon','lotus_chain','coffered_roses','shell_niches','ogee_tracery','dragon_scales','ribbon_scroll','fluted_reeds'];
  const borders=['bead_reel','meander','dentils','rope','stepped'];
  const voxelPatterns=['rosette','palmette','laurel','interlace'];
  const voxelRegions={doric_column:'base',ionic_column:'base',corinthian_column:'base',fluted_column:'base',
    gothic_pier:'base',pillar:'base',pediment:'pediment',pediment_side:'pediment',entablature:'frieze',
    corbel_east:'panel',corbel_west:'panel',corbel_north:'panel',corbel_south:'panel',buttress:'panel',
    pointed_arch:'panel',coffered_slab:'coffers',entablature_ring:'panel',dome_shell:'panel',barrel_rib:'panel',
    ribbed_vault:'panel',barrel_vault_shell:'panel',pointed_vault_shell:'panel',groin_vault_shell:'panel',
    fan_vault_shell:'panel',pendentive_transition:'panel',flying_buttress:'panel',
    battlement:'panel',arrow_slit:'panel',obelisk:'panel',stone_tablet:'panel',gravestone:'panel',chest_tomb:'panel',sarcophagus:'panel'};
  const voxelShapes=Object.keys(voxelRegions);
  function voxelDescriptor(value,shape){
    if(!value||value.version!==1||!voxelShapes.includes(shape)||!voxelPatterns.includes(value.pattern))return null;
    const region=voxelRegions[shape];
    if(value.region!==region)return null;
    return{version:1,region,pattern:value.pattern};
  }
  function resolveVoxelDescriptor(spec={},tileName=''){
    if(!spec||typeof spec!=='object')spec={};
    if(spec.puzzleFace||spec.inscription||spec.stoneCarving===false||
      ['metal','gold','ice','crystal','bone'].includes(spec.material))return null;
    const shape=spec.voxelShape||(/pillar|column/i.test(spec.type||tileName)?'pillar':null);
    if(!voxelShapes.includes(shape))return null;
    if(spec.stoneCarving)return voxelDescriptor(spec.stoneCarving,shape);
    let seed=2166136261;for(const ch of String(shape+':'+(spec.voxelSeed||0)))seed=Math.imul(seed^ch.charCodeAt(0),16777619)>>>0;
    const patterns=voxelRegions[shape]==='base'?['laurel','interlace','palmette']:voxelRegions[shape]==='coffers'?['rosette']:voxelPatterns;
    return{version:1,region:voxelRegions[shape],pattern:patterns[seed%patterns.length]};
  }
  function wallCarvingField(carving,shape,u,pz){
    let low=.3,high=.68;
    if(carving.region==='base'){low=.018;high=shape==='doric_column'?.062:shape==='gothic_pier'?.095:shape==='fluted_column'?.18:.155;}
    if(carving.region==='pediment'){low=.17;high=1-Math.abs(u*2-1)-.16;}
    const left=.12,right=.88;
    if(carving.region==='panel'){
      low=.12;high=.86;
      if(shape==='pointed_arch'){
        const arch=1-Math.abs(u*2-1);low=.57+arch*.36;high=low+.055;
        if(u<.17||u>.83)return null;
      }
    }
    if(high<=low||pz<low||pz>high||u<left||u>right)return null;
    const v=(pz-low)/(high-low);return v<.12||v>.88?null:{u:(u-left)/(right-left),v};
  }
  function carveVoxels(source,size,value,shape){
    const carving=voxelDescriptor(value,shape);
    if(!carving)return source;
    if(source.length!==size**3||size<8||size>64)throw Error('Invalid architectural carving grid.');
    const result=new Uint8Array(source),at=(x,y,z)=>x+y*size+z*size*size;
    const budget=Math.floor(source.reduce((n,v)=>n+(v?1:0),0)*.029);let removed=0;
    const recess=index=>{if(result[index]&&removed<budget){result[index]=0;removed++;}};
    const pattern=(u,v)=>{
      if(carving.pattern==='rosette'){
        const x=u-.5,y=(v-.5)*.6,r=Math.hypot(x,y),a=Math.atan2(y,x);
        return Math.abs(r-.15-.035*Math.cos(a*8))<.018||Math.abs(r-.055)<.015;
      }
      if(carving.pattern==='palmette'){
        const a=Math.atan2((u-.5)*1.5,1-v),r=Math.hypot((u-.5)*1.5,1-v);
        return r<.95&&r>.18&&Math.abs(Math.sin(a*7))<.2;
      }
      if(carving.pattern==='laurel'){
        const t=(u*4)%1,x=t-.5,y=v-.5;
        return Math.abs(Math.abs(x)*1.4+Math.abs(y)*.7-.31)<.055||Math.abs(v-.5)<.06;
      }
      return Math.abs(v-.5-.25*Math.sin(u*Math.PI*6))<.065||Math.abs(v-.5+.25*Math.sin(u*Math.PI*6))<.065;
    };
    const depth=Math.max(1,Math.floor(size*.025)),axes=['base','panel'].includes(carving.region)?[0,1]:[1];
    if(carving.region==='coffers'){
      // Recess the underside of each solid coffer backing, never its supporting ribs.
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const u=((x+.5)/size*4)%1,v=((y+.5)/size*4)%1;
        if(u<.34||u>.9||v<.34||v>.9||!pattern((u-.34)/.56,(v-.34)/.56))continue;
        for(let z=Math.floor(size*.6);z<size-depth-2;z++)if(source[at(x,y,z)]){
          let backed=true;for(let d=1;d<=depth+2;d++)if(!source[at(x,y,z+d)]){backed=false;break;}
          if(backed)for(let d=0;d<depth;d++)recess(at(x,y,z+d));
          break;
        }
      }
      return result;
    }
    // Remove only a shallow skin of occupied voxels. The shaft, cornices, bearing edges
    // and solid backing remain the original structure, not a texture or separate plaque.
    for(const axis of axes)for(const sign of[-1,1])for(let z=0;z<size;z++)for(let along=0;along<size;along++){
      const u=(along+.5)/size,pz=(z+.5)/size;
      const field=wallCarvingField(carving,shape,u,pz);if(!field||!pattern(field.u,field.v))continue;
      for(let i=0;i<size;i++){
        const across=sign<0?i:size-1-i,x=axis===0?across:along,y=axis===1?across:along;
        if(!source[at(x,y,z)])continue;
        const inside=sign<0?1:-1;
        if(across+inside*(depth+2)<0||across+inside*(depth+2)>=size)break;
        let backed=true;for(let d=1;d<=depth+2;d++){
          const back=axis===0?at(across+inside*d,along,z):at(along,across+inside*d,z);
          if(!source[back]){backed=false;break;}
        }
        if(!backed)break;
        for(let d=0;d<depth;d++)recess(axis===0?at(across+inside*d,along,z):at(along,across+inside*d,z));
        break;
      }
    }
    return result;
  }
  function ridgeMesh(source,carved,size,extension,colorFn,opts={}){
    if(source.length!==size**3||carved.length!==source.length||size<8||size>64)throw Error('Invalid ridge grid.');
    const depth=Number.isFinite(extension)?Math.max(0,Math.min(4,extension)):0;
    const vertices=[],indices=[],groups=new Map(),ridgeSites=opts.inspect?[]:null,
      get=(grid,p)=>p.every(n=>n>=0&&n<size)?grid[p[0]+p[1]*size+p[2]*size**2]:0;
    if(!depth)return{vertices,indices,ridgeCount:0};
    const carving=voxelDescriptor(opts.carving||resolveVoxelDescriptor({voxelShape:opts.shape}),opts.shape);
    const axes=carving?(carving.region==='coffers'?[2]:['base','panel'].includes(carving.region)?[0,1]:[1]):[0,1,2];
    const signs=carving?.region==='coffers'?[-1]:[-1,1],cutSides=new Set();
    const addSurface=(p,axis,sign)=>{
      if(!get(source,p)||!get(carved,p))return;
      const outside=p.slice();outside[axis]+=sign;if(get(source,outside))return;
      let safeDepth=depth;
      for(let step=1;step<=Math.ceil(depth);step++){
        const q=p.slice();q[axis]+=sign*step;
        if(get(source,q)){safeDepth=Math.min(safeDepth,step-1);break;}
      }
      if(!safeDepth)return;
      const a=(axis+1)%3,b=(axis+2)%3,plane=p[axis]+(sign>0?1:0),key=[axis,sign,plane,safeDepth].join(',');
      if(!groups.has(key))groups.set(key,{axis,sign,plane,depth:safeDepth,mask:new Uint8Array(size**2)});
      const mask=groups.get(key).mask,index=p[a]+p[b]*size;
      if(ridgeSites&&!mask[index])ridgeSites.push({position:p,axis,sign,depth:safeDepth});
      mask[index]=1;
    };
    for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const cut=[x,y,z];if(!get(source,cut)||get(carved,cut))continue;
      for(const axis of axes)for(const sign of signs){
        const outside=cut.slice();outside[axis]+=sign;if(get(source,outside))continue;
        if(carving){cutSides.add(axis+','+sign);continue;}
        // Unscoped grid callers retain the original local-edge selection.
        const a=(axis+1)%3,b=(axis+2)%3;
        for(let da=-2;da<=2;da++)for(let db=-2;db<=2;db++){
          const p=cut.slice();p[a]+=da;p[b]+=db;addSurface(p,axis,sign);
        }
      }
    }
    if(carving){
      // Raise the uncut field, not a pattern-following halo. Removed voxels and
      // their recess floors never receive added geometry; the backing stays sealed.
      for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const p=[x,y,z];if(!get(source,p)||!get(carved,p))continue;
        for(const axis of axes)for(const sign of signs){
          if(!cutSides.has(axis+','+sign))continue;
          if(carving.region==='coffers'){
            const u=((x+.5)/size*4)%1,v=((y+.5)/size*4)%1;
            if(u<.34||u>.9||v<.34||v>.9)continue;
          }else if(!wallCarvingField(carving,opts.shape,(p[axis===0?1:0]+.5)/size,(z+.5)/size))continue;
          addSurface(p,axis,sign);
        }
      }
    }
    const pad=.008;
    const quad=(axis,sign,plane,a,loA,hiA,b,loB,hiB)=>{
      const normal=[0,0,0];normal[axis]=sign;
      const center=[0,0,0];center[axis]=plane;center[a]=(loA+hiA)/2;center[b]=(loB+hiB)/2;
      const color=typeof colorFn==='function'?colorFn(...center,normal):Array.isArray(colorFn)?colorFn:[1,1,1],base=vertices.length/9;
      for(const[u,v]of[[loA-pad,loB-pad],[hiA+pad,loB-pad],[hiA+pad,hiB+pad],[loA-pad,hiB+pad]]){
        const p=[0,0,0];p[axis]=plane;p[a]=u;p[b]=v;vertices.push(...p.map(n=>n/size),...normal,...color);
      }
      indices.push(base,base+1,base+2,base,base+2,base+3);
    };
    let ridgeCount=0;
    for(const group of groups.values()){
      const{axis,sign,plane,depth,mask}=group,a=(axis+1)%3,b=(axis+2)%3,remaining=new Uint8Array(mask);
      ridgeCount+=mask.reduce((n,v)=>n+v,0);
      for(let v=0;v<size;v++)for(let u=0;u<size;){
        if(!remaining[u+v*size]){u++;continue;}
        let w=1;while(u+w<size&&remaining[u+w+v*size])w++;
        let h=1;outer:while(v+h<size){for(let k=0;k<w;k++)if(!remaining[u+k+(v+h)*size])break outer;h++;}
        quad(axis,sign,plane+sign*depth,a,u,u+w,b,v,v+h);
        for(let dv=0;dv<h;dv++)remaining.fill(0,u+(v+dv)*size,u+w+(v+dv)*size);u+=w;
      }
      // Close the raised perimeter down to the existing sealed exterior surface.
      for(const sideAxis of[a,b]){
        const along=sideAxis===a?b:a;
        const at=(across,v)=>across<0||across>=size||v<0||v>=size?0:
          mask[sideAxis===a?across+v*size:v+across*size];
        for(let edge=0;edge<=size;edge++)for(let v=0;v<size;){
          const facing=at(edge-1,v)-at(edge,v);if(!facing){v++;continue;}
          let end=v+1;while(end<size&&at(edge-1,end)-at(edge,end)===facing)end++;
          quad(sideAxis,facing,edge,along,v,end,axis,Math.min(plane,plane+sign*depth),Math.max(plane,plane+sign*depth));v=end;
        }
      }
    }
    // Dense curved fields can exceed one 16-bit draw. Split only at quad boundaries.
    const parts=[];
    if(vertices.length/9>=65536)for(let start=0;start<vertices.length/9;start+=65532){
      const end=Math.min(vertices.length/9,start+65532),firstIndex=start/4*6,lastIndex=end/4*6;
      parts.push({vertices:vertices.slice(start*9,end*9),indices:indices.slice(firstIndex,lastIndex).map(i=>i-start)});
    }
    return{vertices,indices,ridgeCount,...(parts.length?{parts}:{}),...(ridgeSites?{ridgeSites}:{})};
  }
  function palette(room={},sample){
    const rgb=hex=>/^#[\da-f]{6}$/i.test(hex||'')?[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)):null;
    let body=rgb(room.primary)||[103,86,74];
    if(sample?.data){
      const tones=[];for(let i=0;i<sample.data.length;i+=4)if(sample.data[i+3]>=128)
        tones.push(Array.from(sample.data.subarray(i,i+3)));
      tones.sort((a,b)=>a.reduce((n,v)=>n+v,0)-b.reduce((n,v)=>n+v,0));
      // Ignore dark joints and bright paint/decals when matching the surrounding masonry.
      const middle=tones.slice(Math.floor(tones.length*.2),Math.ceil(tones.length*.8));
      if(middle.length)body=[0,1,2].map(c=>middle.reduce((n,v)=>n+v[c],0)/middle.length);
    }
    const hex=values=>'#'+values.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
    return{primary:hex(body),secondary:hex(body.map(v=>v*.84)),shadow:hex(body.map(v=>v*.48)),highlight:hex(body.map(v=>v+(255-v)*.22))};
  }
  function ink(style,u,v){
    const x=u*12,y=v*8,near=(n,w=.13)=>Math.abs(n)<w;
    if(style==='laurel_festoon')return near(v-.28-.35*Math.abs(Math.sin(u*Math.PI*3)),.04)||near(Math.sin(x*4+y),.13)&&v>.4&&v<.7;
    if(style==='lotus_chain')return near(Math.sin(x)*Math.sin(y)+.35,.12);
    if(style==='coffered_roses'){const a=(u*3)%1-.5,b=v-.5;return near(Math.max(Math.abs(a),Math.abs(b))-.4,.04)||near(Math.hypot(a,b)-.18,.04);}
    if(style==='shell_niches')return near(Math.sin(Math.atan2((u*3)%1-.5,1-v)*9),.2)&&v>.15;
    if(style==='ogee_tracery')return near(Math.abs(Math.sin(u*Math.PI*3))-(1-v)**.6,.07);
    if(style==='dragon_scales')return near(Math.hypot((u*6+Math.floor(v*3)%2*.5)%1-.5,(v*3)%1)-.7,.08);
    if(style==='ribbon_scroll')return near(v-.5-.22*Math.sin(u*Math.PI*6),.05)||near(Math.sin(x*2+y*2),.15)&&v>.3&&v<.7;
    if(style==='fluted_reeds')return near((u*9)%1-.5,.12)&&v>.12&&v<.88;
    if(style==='acanthus'||style==='vine_scroll')return near(Math.sin(x*2)+Math.sin(y*1.4))||style==='acanthus'&&near(Math.sin(x*3-y));
    if(style==='guilloche'||style==='dragon_knot'||style==='wave_chain')return near(v-.5-.23*Math.sin(x*1.6),.035)||near(v-.5+.23*Math.sin(x*1.6),.035);
    if(style==='egg_dart')return near(((x%1)-.5)**2/.12+(v-.5)**2/.18-1,.16)||near(x%1-.98,.05);
    if(style==='rosette'||style==='star_vault'){const r=Math.hypot(u-.5,v-.5),a=Math.atan2(v-.5,u-.5);return near(r-.3-.06*Math.cos(a*12),.035)||near(r-.13,.025);}
    if(style==='palmette')return near(Math.sin(Math.atan2(u-.5,1-v)*12),.16)&&v>.15;
    if(style==='interlace'||style==='ossuary_lattice')return near(Math.sin(x+y*1.4),.17)||near(Math.sin(x-y*1.4),.17);
    if(style==='winged_medallion')return near(Math.hypot((u-.5)*1.4,v-.5)-.33,.035)||near(Math.sin(x*2)+v-.5,.12);
    if(style==='heraldic_beasts')return near(Math.sin(x)*.2+v-.5,.04)||near(u-.5,.035);
    return near(x%1-.5,.06)||near(v-.25,.035)||near(v-.75,.035);
  }
  function validate(raw){
    if(raw.carvingStyle!==undefined&&!styles.includes(raw.carvingStyle)||raw.carvingBorder!==undefined&&!borders.includes(raw.carvingBorder)||
      raw.carvingDepth!==undefined&&!['incised','raised'].includes(raw.carvingDepth)||
      raw.stoneworkRole!==undefined&&!['skirting','dado','cornice'].includes(raw.stoneworkRole))throw Error('Invalid stonework carving.');
    return{...(raw.carvingStyle?{carvingStyle:raw.carvingStyle}:{}),...(raw.carvingBorder?{carvingBorder:raw.carvingBorder}:{}),
      ...(raw.carvingDepth?{carvingDepth:raw.carvingDepth}:{}),...(raw.stoneworkRole?{stoneworkRole:raw.stoneworkRole}:{})};
  }
  function paint(c,art,pal,ink){
    const light=pal.highlight||'#e4d7b6',dark=pal.shadow||'#55483a',trim=pal.secondary||'#b9a180';
    const glyph=ink;ink=(name,x,y,size,color)=>{glyph(name,x+.6,y+.6,size,dark);glyph(name,x,y,size,color);};
    const shape=(draw,fill=false)=>{c.beginPath();draw();c.strokeStyle=dark;c.lineWidth=2.2;c.stroke();c.strokeStyle=light;c.lineWidth=.8;c.stroke();if(fill){c.fillStyle=trim;c.fill();}};
    const leaf=(x,y,angle=0)=>{c.save();c.translate(x,y);c.rotate(angle);shape(()=>{c.moveTo(0,8);c.bezierCurveTo(-9,2,-5,-7,0,-12);c.bezierCurveTo(6,-6,8,1,0,8);},true);
      shape(()=>{c.moveTo(0,7);c.lineTo(0,-9);for(let i=0;i<3;i++){c.moveTo(0,3-i*4);c.lineTo(-4,-i*4);c.moveTo(0,2-i*4);c.lineTo(4,-1-i*4);}});c.restore();};
    const border=art.carvingBorder||'bead_reel';
    if(art.surface==='wall'&&art.format==='mural'){
      for(const y of[3,60]){c.fillStyle=dark;c.fillRect(0,y,96,1);c.fillStyle=light;c.fillRect(0,y+1,96,1);}
      for(const x of art.segmentRole==='middle'?[]:art.segmentRole==='start'?[3]:art.segmentRole==='end'?[91]:[3,91]){
        c.fillStyle=dark;c.fillRect(x,3,2,59);c.fillStyle=light;c.fillRect(x+2,4,1,57);
        for(const y of[17,32,47])shape(()=>{c.moveTo(x-1,y);c.lineTo(x+1,y-3);c.lineTo(x+3,y);c.lineTo(x+1,y+3);c.closePath();});
      }
    }
    for(let x=8;x<90;x+=6)for(const y of[8,55]){
      if(border==='dentils'){c.fillStyle=dark;c.fillRect(x,y,3,3);c.fillStyle=light;c.fillRect(x,y,3,1);}
      else if(border==='meander')shape(()=>{c.moveTo(x,y+3);c.lineTo(x+4,y+3);c.lineTo(x+4,y);c.lineTo(x+1,y);c.lineTo(x+1,y+2);});
      else if(border==='rope')shape(()=>{c.moveTo(x,y);c.bezierCurveTo(x+2,y+5,x+4,y-2,x+6,y+2);});
      else if(border==='stepped')shape(()=>{c.moveTo(x,y+3);c.lineTo(x+2,y+3);c.lineTo(x+2,y+1);c.lineTo(x+4,y+1);c.lineTo(x+4,y+3);});
      else shape(()=>c.ellipse(x,y+1,1.5,1,0,0,Math.PI*2));
    }
    const style=art.carvingStyle;
    if(style==='acanthus'||style==='vine_scroll')for(let i=0;i<6;i++){
      const x=15+i*13;leaf(x,33,i%2?.45:-.45);if(style==='vine_scroll')shape(()=>{c.moveTo(x-8,42);c.bezierCurveTo(x-5,14,x+12,51,x+14,25);});
    }
    else if(style==='guilloche'||style==='wave_chain'||style==='dragon_knot'){
      for(const side of[-1,1])shape(()=>{c.moveTo(10,32);for(let i=0;i<6;i++)c.bezierCurveTo(12+i*12,32+side*17,20+i*12,32-side*17,22+i*12,32);});
      if(style==='dragon_knot'){ink('Dragon',10,22,14,light);ink('Serpent',73,28,13,light);}
      if(style==='wave_chain')for(let i=0;i<5;i++)ink('Wave',14+i*14,43,7,light);
    }else if(style==='egg_dart')for(let i=0;i<9;i++){
      const x=13+i*8;shape(()=>c.ellipse(x,32,3,13,0,0,Math.PI*2));shape(()=>{c.moveTo(x+4,17);c.lineTo(x+4,47);c.lineTo(x+2,44);});
    }else if(style==='ossuary_lattice'||style==='interlace'){
      for(let x=12;x<85;x+=14)for(let y=20;y<50;y+=13)shape(()=>{c.moveTo(x,y-6);c.lineTo(x+7,y);c.lineTo(x,y+6);c.lineTo(x-7,y);c.closePath();});
      if(style==='ossuary_lattice')for(let x=17;x<85;x+=20)ink('Skull',x,27,9,light);
    }else if(style==='rosette'||style==='star_vault'){
      const count=style==='rosette'?12:8;for(let i=0;i<count;i++){const a=i*Math.PI*2/count;c.save();c.translate(48,32);c.rotate(a);
        shape(()=>c.ellipse(0,-13,3,10,0,0,Math.PI*2));c.restore();}
      shape(()=>c.arc(48,32,7,0,Math.PI*2));if(style==='star_vault')ink('Star',43,27,10,light);
    }else if(style==='palmette')for(let i=0;i<11;i++){
      const a=(i-5)*.19;shape(()=>{c.moveTo(48,49);c.quadraticCurveTo(48+Math.sin(a)*28,32,48+Math.sin(a)*37,14+Math.abs(i-5));});
    }else if(style==='winged_medallion'){
      shape(()=>c.ellipse(48,32,15,17,0,0,Math.PI*2));ink(art.motifs[0],40,24,16,light);
      for(const side of[-1,1])for(let i=0;i<6;i++)shape(()=>{c.moveTo(48+side*15,35);c.quadraticCurveTo(48+side*(20+i*2),13+i*2,48+side*36,19+i*4);});
    }else if(style==='runic_lintel')art.motifs.forEach((m,i)=>ink(m,12+i*72/art.motifs.length,24,Math.min(18,64/art.motifs.length),light));
    else if(style==='heraldic_beasts'){ink('Dragon',13,24,22,light);ink(art.motifs[0],41,26,15,light);c.save();c.translate(96,0);c.scale(-1,1);ink('Dragon',13,24,22,light);c.restore();}
    else if(style==='laurel_festoon')for(let i=0;i<3;i++){
      const x=12+i*25;shape(()=>{c.moveTo(x,21);c.bezierCurveTo(x+5,49,x+19,49,x+24,21);});
      for(let j=0;j<7;j++){const t=j/6;c.save();c.translate(x+3+t*18,25+14*Math.sin(t*Math.PI));c.scale(.25,.3);leaf(0,0,(t-.5)*2);c.restore();}
      shape(()=>{c.moveTo(x-2,27);c.lineTo(x+1,18);c.lineTo(x+4,27);});
    }else if(style==='lotus_chain')for(let i=0;i<5;i++){
      const x=17+i*16;for(const side of[-1,0,1])shape(()=>{c.moveTo(x,43);c.quadraticCurveTo(x-9+side*3,29,x+side*8,18);c.quadraticCurveTo(x+9+side*3,29,x,43);},true);
      shape(()=>{c.moveTo(x,43);c.lineTo(x,49);c.moveTo(x-6,46);c.quadraticCurveTo(x,51,x+6,46);});
    }else if(style==='coffered_roses')for(let i=0;i<3;i++){
      const x=12+i*25;for(let n=0;n<3;n++)shape(()=>c.rect(x+n*2,16+n*2,22-n*4,33-n*4));
      for(let j=0;j<8;j++){const a=j*Math.PI/4;shape(()=>c.ellipse(x+11+Math.cos(a)*4,32+Math.sin(a)*5,2,4,a-Math.PI/2,0,Math.PI*2));}
    }else if(style==='shell_niches')for(let i=0;i<3;i++){
      const x=23+i*25;shape(()=>{c.moveTo(x-10,47);c.lineTo(x-10,27);c.arc(x,27,10,Math.PI,0);c.lineTo(x+10,47);});
      for(let j=0;j<9;j++){const a=Math.PI+j*Math.PI/8;shape(()=>{c.moveTo(x,44);c.quadraticCurveTo(x+Math.cos(a)*5,28,x+Math.cos(a)*9,27+Math.sin(a)*9);});}
    }else if(style==='ogee_tracery')for(let i=0;i<4;i++){
      const x=18+i*20;shape(()=>{c.moveTo(x-8,48);c.bezierCurveTo(x-8,34,x-9,27,x,15);c.bezierCurveTo(x+9,27,x+8,34,x+8,48);c.closePath();});
      for(const[dx,dy]of[[0,-3],[3,0],[0,3],[-3,0]])shape(()=>c.arc(x+dx,32+dy,3,0,Math.PI*2));
    }else if(style==='dragon_scales'){
      for(let y=21;y<48;y+=10)for(let x=12+(y%3)*3;x<85;x+=12)shape(()=>{c.moveTo(x-6,y-3);c.quadraticCurveTo(x-7,y+4,x,y+7);c.quadraticCurveTo(x+7,y+4,x+6,y-3);});
    }else if(style==='ribbon_scroll'){
      for(let i=0;i<4;i++){const x=15+i*20;shape(()=>{c.moveTo(x-7,44);c.bezierCurveTo(x+19,51,x-10,13,x+11,20);c.bezierCurveTo(x+20,27,x,36,x,25);});
        c.save();c.translate(x+6,39);c.scale(.3,.4);leaf(0,0,.6);c.restore();}
    }else if(style==='fluted_reeds')for(let i=0;i<10;i++){
      const x=12+i*8;shape(()=>{c.moveTo(x-2,46);c.lineTo(x-2,21);c.quadraticCurveTo(x,13,x+2,21);c.lineTo(x+2,46);c.quadraticCurveTo(x,51,x-2,46);});
      shape(()=>{c.moveTo(x,23);c.lineTo(x,44);});
    }
  }
  function mesh(image,axis,surface,sign,depth='raised'){
    const{width:w,height:h,data}=image;if(!(w>0&&h>0&&w*h<=16384))throw Error('Carving exceeds mesh budget.');
    const vertices=[],indices=[],height=(x,y)=>{
      let lum=0;for(const[dx,dy]of[[0,0],[-1,0],[0,-1],[-1,-1]]){const i=(Math.max(0,Math.min(w-1,x+dx))+Math.max(0,Math.min(h-1,y+dy))*w)*4;lum+=(data[i]+data[i+1]+data[i+2])/765;}
      const value=lum/4;return depth==='incised'?1-value:value;
    };
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=(x+y*w)*4;if(data[i+3]<128)continue;const base=vertices.length/9,col=[data[i]/255,data[i+1]/255,data[i+2]/255];
      const du=(height(x+1,y)-height(x,y))*.7,dv=(height(x,y+1)-height(x,y))*.7;
      const n=surface==='floor'?[-du,dv,1]:axis==='x'?[sign,-du,dv]:[-du,sign,dv],len=Math.hypot(...n);
      for(const[dx,dy]of[[0,0],[1,0],[1,1],[0,1]]){
        const u=(x+dx)/w,v=1-(y+dy)/h,z=height(x+dx,y+dy);
        const p=surface==='floor'?[u,1-v,z]:axis==='x'?[sign*z,u,v]:[u,sign*z,v];vertices.push(...p,...n.map(v=>v/len),...col);
      }
      indices.push(base,base+1,base+2,base,base+2,base+3);
    }
    return{vertices:new Float32Array(vertices),indices:new Uint16Array(indices)};
  }
  function forTradition(tradition){
    const families={egyptian:['palmette','rosette','winged_medallion','runic_lintel'],
      mesopotamian:['rosette','winged_medallion','heraldic_beasts','palmette'],
      classical_roman:['acanthus','egg_dart','guilloche','palmette','wave_chain'],
      classical_greek:['egg_dart','palmette','wave_chain','guilloche'],
      byzantine:['interlace','vine_scroll','guilloche','rosette','winged_medallion'],
      medieval_gothic:['star_vault','vine_scroll','heraldic_beasts','ossuary_lattice'],
      medieval_illuminated:['interlace','vine_scroll','dragon_knot','winged_medallion'],
      romanesque:['dragon_knot','heraldic_beasts','interlace','rosette'],
      renaissance:['acanthus','palmette','guilloche','winged_medallion'],
      baroque:['acanthus','vine_scroll','rosette','winged_medallion']};
    const additions={egyptian:['lotus_chain','fluted_reeds'],mesopotamian:['dragon_scales','lotus_chain'],
      classical_roman:['laurel_festoon','coffered_roses','shell_niches'],classical_greek:['fluted_reeds','laurel_festoon'],
      byzantine:['ribbon_scroll','coffered_roses'],medieval_gothic:['ogee_tracery','dragon_scales'],
      medieval_illuminated:['ribbon_scroll'],romanesque:['shell_niches','dragon_scales'],
      renaissance:['laurel_festoon','coffered_roses','shell_niches','fluted_reeds'],baroque:['laurel_festoon','shell_niches','ribbon_scroll']};
    return families[tradition]?[...families[tradition],...additions[tradition]]:[...styles];
  }
  function modules(art){
    if(!art.carvingStyle||art.puzzleClue||art.surface!=='wall'||art.format!=='mural')return[art];
    const along=art.axis==='x'?'y':'x',width=art.size[along],height=art.size.z;
    const count=Math.max(1,Math.min(8,Math.round(width/(height*1.5)))),step=width/count;
    return Array.from({length:count},(_,i)=>({...art,position:{...art.position,[along]:art.position[along]+i*step},
      size:{...art.size,[along]:step},segmentRole:count===1?'panel':i===0?'start':i===count-1?'end':'middle'}));
  }
  return{styles,borders,ink,validate,paint,mesh,forTradition,modules,palette,voxelPatterns,voxelShapes,voxelRegions,voxelDescriptor,resolveVoxelDescriptor,carveVoxels,ridgeMesh,
    toolbox:()=>({carvingStyle:styles,carvingBorder:borders,carvingDepth:['incised','raised'],stoneworkRole:['skirting','dado','cornice']})};
});
