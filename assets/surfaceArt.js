(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./puzzleModules'):root.PuzzleModules,
    typeof module==='object'&&module.exports?require('./sculptureForms'):root.SculptureForms,
    typeof module==='object'&&module.exports?require('./shrineIconography'):root.ShrineIconography,
    typeof module==='object'&&module.exports?require('./frescoDesigns'):root.FrescoDesigns,
    typeof module==='object'&&module.exports?require('./frescoFigures'):root.FrescoFigures,
    typeof module==='object'&&module.exports?require('./artCharacters'):root.ArtCharacters);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SurfaceArt=api;
})(typeof window==='undefined'?globalThis:window,function(Symbols,Sculptures,Iconography,Designs,Figures,People){
  'use strict';
  const kinds=['fresco','relief','inscription','mosaic'];
  const compositions=['procession','apotheosis','judgment','lamentation','constellation','cosmogony'];
  const pigmentPalettes={
    vermilion:{primary:'#813c32',secondary:'#c08b55',highlight:'#dfcda1',shadow:'#342e32'},
    lapis:{primary:'#35475e',secondary:'#9b8059',highlight:'#e7d9af',shadow:'#242832'},
    verdigris:{primary:'#405f54',secondary:'#b89467',highlight:'#e8d5ac',shadow:'#282d2a'},
    ochre:{primary:'#8c613d',secondary:'#bb995e',highlight:'#eee0b5',shadow:'#352d31'}
  };
  function frescoPalette(art){return{...(pigmentPalettes[art.pigments]||pigmentPalettes.vermilion)};}
  function validate(rows){
    if(rows===undefined)return[];
    if(!Array.isArray(rows)||rows.length>6)throw Error('At most six room artworks, plus the permanent puzzle diagram.');
    return rows.map(a=>{
      if(!kinds.includes(a?.kind)||!['wall','floor','object'].includes(a.surface)||typeof a.label!=='string'||!a.label.trim()||a.label.length>70||
        /[<>\r\n]/.test(a.label)||typeof a.description!=='string'||a.description.length>220||/[<>\r\n]/.test(a.description)||
        !Array.isArray(a.motifs)||a.motifs.length<1||a.motifs.length>6||a.motifs.some(m=>typeof m!=='string'||!m.trim()||m.length>28||/[<>\r\n]/.test(m))||
        a.text!==undefined&&(typeof a.text!=='string'||a.text.length>120||/[<>\r\n]/.test(a.text))||
        a.composition!==undefined&&!compositions.includes(a.composition)||
        a.format!==undefined&&!['panel','mural'].includes(a.format)||
        a.pigments!==undefined&&!Object.hasOwn(pigmentPalettes,a.pigments))throw Error('Invalid selective artwork.');
      return{kind:a.kind,surface:a.surface,label:a.label,description:a.description,motifs:[...a.motifs],text:a.text||'',composition:a.composition||'procession',
        format:a.format||(a.kind==='fresco'&&a.surface==='wall'?'mural':'panel'),pigments:a.pigments||'vermilion',
        ...(a.kind==='fresco'&&(a.style!==undefined||a.scene!==undefined||a.figures!==undefined)?Designs.validate(a):{})};
    });
  }
  function plan(spec){
    const p=spec.puzzleMechanism,provided=p?.roomArt||[],description=String(spec.source?.description||''),room=String(spec.source?.roomName||'');
    const clauses=description.split(/[.!?]/).filter(s=>/fresco|mural|inscription|carving|mosaic|tapestr/i.test(s));
    const patron=Iconography.find(description)||p?.shrines?.[0]?.deity||p?.sculptures?.find(s=>s.deity)?.deity||(/ruined temple/i.test(room)?'Mortacia':null);
    const figures=[...new Set([...(patron?[patron]:[]),...People.motifs(description),...(People.votaries[patron]||[]),'skeleton','wraith'])].slice(0,6);
    if(!patron&&!People.motifs(description).length)figures.unshift('human');
    const art=provided.length?provided.slice(0,6).map(a=>({...a,motifs:[...a.motifs]})):clauses.slice(0,4).map((clause,i)=>({kind:/inscription/i.test(clause)?'inscription':/carv/i.test(clause)?'relief':/mosaic/i.test(clause)?'mosaic':'fresco',
      surface:/floor|underfoot/i.test(clause)?'floor':'wall',label:'Ancient '+(/inscription/i.test(clause)?'inscription':'wall art')+' '+(i+1),
      description:clause.trim().slice(0,220),motifs:/fresco|mural|tapestr/i.test(clause)?figures:
        Object.keys(Symbols.glyphs).filter(name=>new RegExp('\\b'+name,'i').test(clause)).slice(0,4),text:'',composition:compositions[(i+2)%6],format:'mural',pigments:'vermilion'}));
    for(const row of art)if(!row.motifs.length)row.motifs=['crown','moon','serpent'];
    const building=/temple|crypt|cloister|cathedral|palace|castle|hall|basilica|shrine|chapel|library|keep/i.test(room+' '+description);
    const indoors=spec.indoor!==false&&(spec.indoor===true||building);
    const target=indoors&&building?(/cathedral|basilica|palace|grand hall/i.test(room+' '+description)?6:4):0;
    const themes=['The Departed','The Vigil','The Procession','The Celestial Court','The Lament','The Heavens'];
    while(art.length<target){const i=art.length;
      art.push({kind:'fresco',surface:'wall',label:(patron?patron+': ':'')+themes[i],
        description:`A solemn ${compositions[(i+2)%6]} of ${patron||'the departed'}, with draped souls, stone arcades and celestial imagery.`,
        motifs:[...figures],composition:compositions[(i+2)%6],format:'mural',pigments:Object.keys(pigmentPalettes)[i%4],text:''});
    }
    const style=Designs.tradition(room+' '+description),scene=Designs.sceneFor(room+' '+description);
    for(const [i,row]of art.entries())if(row.kind==='fresco'){
      if(!row.style)row.style=style;
      if(!row.scene)row.scene=i===0?scene:Designs.scenes[(Designs.scenes.indexOf(scene)+i)%Designs.scenes.length];
      if(!row.figures?.length)row.figures=Designs.figures(row);
    }
    if(p?.moduleKit)art.push({kind:p.clueStyle==='floor_mosaic'?'mosaic':'relief',surface:p.clueStyle==='floor_mosaic'?'floor':'wall',
      label:p.title+' diagram',description:'The apparatus reference diagram.',text:'',motifs:p.kind==='harmonics'||p.kind==='sequence'?
        p.order.map(id=>p.controls.find(c=>c.id===id).mark):p.controls.map(c=>c.options[c.goal]),puzzleClue:true,
        clueStyle:p.clueStyle,pairs:['sequence','harmonics'].includes(p.kind)?[]:p.controls.map(c=>({mark:c.mark,option:c.options[c.goal]}))});
    return art.slice(0,7);
  }
  function paint(ctx,createCanvas,art,palette={},glyphs=[]){
    const cv=createCanvas(144,96),c=cv.getContext('2d');c.scale(1.5,1.5);
    // Pigment belongs to the painting, not the beige stone behind it; room lighting still applies in 3D.
    if(art.kind==='fresco')palette=frescoPalette(art);
    const primary=palette.primary||'#67564a',trim=palette.secondary||'#c99d65',light=palette.highlight||'#efe0ae',dark=palette.shadow||'#28272a';
    c.fillStyle=primary;c.fillRect(0,0,96,64);c.strokeStyle=trim;c.lineWidth=3;c.strokeRect(2,2,92,60);
    if(art.clueStyle==='star_chart'){
      c.fillStyle=dark;c.fillRect(6,6,84,52);c.strokeStyle=trim;c.lineWidth=.5;
      for(const radius of [12,20,28]){c.beginPath();c.arc(48,32,radius,0,Math.PI*2);c.stroke();}
      c.fillStyle=light;for(let i=0;i<16;i++)c.fillRect(9+(i*29)%78,8+(i*17)%47,1,1);
    }else if(art.clueStyle==='woven_banner'){
      for(let y=7;y<57;y+=2)for(let x=7;x<89;x+=3){c.fillStyle=(x+y)%3?trim:dark;c.globalAlpha=.15;c.fillRect(x,y,2,1);}
      c.globalAlpha=1;c.fillStyle=trim;for(let x=7;x<90;x+=4)c.fillRect(x,58,2,5);
    }else if(art.clueStyle==='floor_mosaic'){
      c.fillStyle=dark;for(let i=0;i<14;i++){c.fillRect(7+i*6,6,3,3);c.fillRect(7+i*6,55,3,3);}
      c.strokeStyle=trim;c.lineWidth=.4;for(let x=6;x<92;x+=6){c.beginPath();c.moveTo(x,7);c.lineTo(x,55);c.stroke();}
    }else if(art.clueStyle==='carved_tablet'){
      c.strokeStyle=dark;c.lineWidth=1;c.beginPath();c.moveTo(5,5);c.lineTo(17,12);c.lineTo(13,24);c.moveTo(89,60);c.lineTo(80,45);c.stroke();
    }
    const ink=(name,x,y,size,color)=>{
      if(!art.puzzleClue&&Iconography.paint(c,name,x,y,size,color))return;
      c.fillStyle=color;const grid=Symbols.bitmap(name,glyphs);grid.forEach((row,yy)=>[...row].forEach((v,xx)=>{if(v==='1')c.fillRect(Math.round(x+xx*size/7),Math.round(y+yy*size/7),Math.ceil(size/7),Math.ceil(size/7));}));
    };
    if(art.pairs?.length){
      art.pairs.forEach((pair,i)=>{const y=9+i*11;
        if(art.clueStyle==='wall_relief'){ink(pair.mark,14,y+1,10,dark);ink(pair.option,70,y+1,10,dark);}
        ink(pair.mark,13,y,10,light);ink(pair.option,69,y,10,light);
        c.fillStyle=trim;c.fillRect(34,y+4,22,1);c.fillRect(53,y+2,1,5);});
    }else if(art.kind==='fresco'){
      const composition=art.composition||compositions[art.label.length%compositions.length];
      // Original compositions borrow spatial hierarchy and gesture, not a museum painting.
      const fill=(color,points)=>{c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();};
      c.fillStyle=dark;c.fillRect(6,6,84,45);
      const sky=c.createLinearGradient(0,5,0,46);sky.addColorStop(0,primary);sky.addColorStop(1,trim);c.fillStyle=sky;c.fillRect(9,7,78,39);
      // Perspective pavement and aedicules anchor the figures in the room's architecture.
      fill(primary,[[6,44],[90,44],[90,58],[6,58]]);
      c.strokeStyle=trim;c.lineWidth=1;for(let x=-30;x<130;x+=20){c.beginPath();c.moveTo(48,37);c.lineTo(x,58);c.stroke();}
      for(const y of [46,51,57]){c.beginPath();c.moveTo(6,y);c.lineTo(90,y);c.stroke();}
      for(const x of [10,71]){
        c.fillStyle=primary;c.fillRect(x,13,14,32);c.fillStyle=dark;c.fillRect(x+3,24,8,21);
        c.beginPath();c.arc(x+7,24,4,Math.PI,0);c.fill();c.fillStyle=trim;c.fillRect(x,13,2,32);c.fillRect(x+12,13,2,32);
        c.fillRect(x-1,43,16,2);c.fillRect(x-1,12,16,2);
      }
      const traditional=art.style&&art.style!=='renaissance';
      if(traditional)Designs.background(c,art,palette,ink);
      else{c.fillStyle=light;c.beginPath();c.arc(48,18,composition==='cosmogony'?12:9,0,Math.PI*2);c.fill();}
      if(!traditional&&(composition==='constellation'||composition==='cosmogony'))for(let i=0;i<7;i++){
        const x=17+(i*17+art.label.length)%65,y=8+(i*11)%25;c.fillStyle=light;c.fillRect(x,y,1,2);c.fillRect(x-1,y+1,3,1);
      }
      if(!traditional&&(composition==='apotheosis'||composition==='cosmogony')){
        c.fillStyle=light;for(let i=0;i<9;i++){c.beginPath();c.ellipse(17+i*7,35+(i%3),8,2,0,0,Math.PI*2);c.fill();}
      }
      Designs.details(c,art,palette,ink);
      if(art.style||art.figures?.length){
        const rows=Designs.layout(art,Designs.figures(art));
        for(const row of rows){
          if(art.style==='byzantine'){c.strokeStyle=light;c.lineWidth=1;c.beginPath();c.arc(row.box.x+row.box.width/2,row.box.y+5,5,0,Math.PI*2);c.stroke();}
          Figures.paint(c,row,palette,row.box,art.style||'renaissance',createCanvas);
        }
      }else{
      const figures=art.motifs.filter(m=>Iconography.name(m)||Sculptures.forms.includes(m.toLowerCase()));
      const subjects=figures.length?figures.slice(0,3):['human','skeleton','wraith'];
      subjects.forEach((m,i)=>{const deity=Iconography.name(m),form=deity?Iconography.pantheon[deity].form:m.toLowerCase();
        const central=subjects.length===1||composition!=='procession'&&i===0;
        const box=central?{x:27,y:composition==='apotheosis'?3:8,width:43,height:46}:
          {x:subjects.length===2?5+i*46:4+i*29,y:composition==='lamentation'?24:15,width:subjects.length===3?29:39,height:composition==='lamentation'?29:39};
        Sculptures.paintFigure(c,{label:art.label+' '+m,form,deity},{...palette,primary,secondary:trim,highlight:light,shadow:dark},
          {...box,pigment:true});});
      const deity=Iconography.name(subjects[0]);ink(deity||art.motifs[0],43,7,9,light);
      }
      // Broken plaster and restrained pigment hatching retain the voxel/pixel vocabulary.
      c.globalAlpha=.2;c.fillStyle=light;for(let y=8;y<56;y+=3)for(let x=8+(y%4);x<87;x+=7)c.fillRect(x,y,1,1);c.globalAlpha=1;
    }else art.motifs.forEach((name,i)=>{
      const size=Math.min(23,70/art.motifs.length),x=10+i*76/art.motifs.length;
      if(art.kind==='relief')ink(name,x+1,20+1,size,dark);
      ink(name,x,20,size,light);
    });
    if(art.text){c.fillStyle=light;c.font='5px Georgia';c.fillText(art.text.slice(0,34),7,56,82);}
    // Local abrasion leaves this artwork distinctive without repeating it as a wall texture.
    c.fillStyle=dark;for(let i=0;i<12;i++){const x=(i*31+art.label.length*7)%92,y=(i*17+13)%60;c.fillRect(x,y,2,1);}
    ctx.imageSmoothingEnabled=false;ctx.drawImage(cv,0,0,ctx.canvas.width,ctx.canvas.height);
  }
  function mesh(image,axis='y',surface='wall',sign=-1){
    const{width:w,height:h,data}=image,vertices=[],indices=[];
    if(!(w>0&&h>0&&w*h<=16384))throw Error('Artwork raster exceeds its bounded mesh budget.');
    // Merge equal-color horizontal runs: detailed frescoes do not need a quad per pixel.
    for(let y=0;y<h;y++)for(let x=0;x<w;){
      const i=(x+y*w)*4;if(data[i+3]<128){x++;continue;}
      let end=x+1;
      while(end<w){const j=(end+y*w)*4;if(data[j+3]<128||data[j]!==data[i]||data[j+1]!==data[i+1]||data[j+2]!==data[i+2])break;end++;}
      const base=vertices.length/9,color=[data[i]/255,data[i+1]/255,data[i+2]/255];
      for(const[dx,dy]of[[0,0],[1,0],[1,1],[0,1]]){
        const u=(x+dx*(end-x))/w,v=1-(y+dy)/h;
        const pos=surface==='floor'?[u,1-v,.015]:axis==='x'?[0,u,v]:[u,0,v];
        const normal=surface==='floor'?[0,0,1]:axis==='x'?[sign,0,0]:[0,sign,0];
        vertices.push(...pos,...normal,...color);
      }
      indices.push(base,base+1,base+2,base,base+2,base+3);
      x=end;
    }
    return{vertices:new Float32Array(vertices),indices:new Uint16Array(indices)};
  }
  return{kinds,compositions,pigmentPalettes,frescoPalette,validate,plan,paint,mesh,toolbox:Designs.toolbox};
});
