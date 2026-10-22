(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./puzzleModules'):root.PuzzleModules,
    typeof module==='object'&&module.exports?require('./sculptureForms'):root.SculptureForms,
    typeof module==='object'&&module.exports?require('./shrineIconography'):root.ShrineIconography,
    typeof module==='object'&&module.exports?require('./frescoDesigns'):root.FrescoDesigns,
    typeof module==='object'&&module.exports?require('./frescoFigures'):root.FrescoFigures,
    typeof module==='object'&&module.exports?require('./artCharacters'):root.ArtCharacters,
    typeof module==='object'&&module.exports?require('./stoneCarvings'):root.StoneCarvings,
    typeof module==='object'&&module.exports?require('./ancientScripts'):root.AncientScripts,
    typeof module==='object'&&module.exports?require('./mosaicDesigns'):root.MosaicDesigns);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SurfaceArt=api;
})(typeof window==='undefined'?globalThis:window,function(Symbols,Sculptures,Iconography,Designs,Figures,People,Carvings,Scripts,Mosaics){
  'use strict';
  const kinds=['fresco','relief','inscription','mosaic'];
  const compositions=['procession','apotheosis','judgment','lamentation','constellation','cosmogony'];
  const pigmentPalettes={
    vermilion:{primary:'#813c32',secondary:'#c08b55',highlight:'#dfcda1',shadow:'#342e32'},
    lapis:{primary:'#35475e',secondary:'#9b8059',highlight:'#e7d9af',shadow:'#242832'},
    verdigris:{primary:'#405f54',secondary:'#b89467',highlight:'#e8d5ac',shadow:'#282d2a'},
    ochre:{primary:'#8c613d',secondary:'#bb995e',highlight:'#eee0b5',shadow:'#352d31'}
  };
  function frescoPalette(art){return art.kind==='mosaic'&&art.style==='byzantine'?
    {primary:'#a78639',secondary:'#dec16d',highlight:'#f3e3ad',shadow:'#233b52'}:
    {...(pigmentPalettes[art.pigments]||pigmentPalettes.vermilion)};}
  // world1: figure hit boxes in raster pixels, matching paint()'s fresco layout. Mosaic/other kinds return [].
  // world1 MOSAIC_HOVER: mosaics expose the same figure boxes, recorded by a draw-free pass of the real mosaic layout.
  const silentContext=()=>new Proxy({},{get:(t,k)=>k in t?t[k]:()=>{},set:(t,k,v)=>{t[k]=v;return true;}});
  function mosaicBoxes(art){
    if(art?.kind!=='mosaic'||art.puzzleClue||(globalThis.HolodekFlags&&globalThis.HolodekFlags.MOSAIC_HOVER===false))return[];
    const native=rasterSize(art),scale=native.height/64,canvasWidth=native.width/scale,rows=Mosaics.figures(art),out=[];
    const pal={primary:'#000',secondary:'#000',highlight:'#000',shadow:'#000'};
    try{Mosaics.paint(silentContext(),art,pal,()=>{},(index,box)=>{if(box&&!out.some(o=>o.index===index%rows.length))out.push({index:index%rows.length,box});},canvasWidth);}catch{return[];}
    return out.map(({index,box})=>{const row=rows[index]||{};return{index,name:row.name||row.subject,role:row.role||'',story:row.story||'',subject:row.subject,row,
      box:{x:box.x*scale,y:box.y*scale,width:box.width*scale,height:box.height*scale}};});
  }
  function figureBoxes(art){
    if(art?.kind==='mosaic')return mosaicBoxes(art);
    if(art?.kind!=='fresco'||art.puzzleClue||!(art.style||art.figures?.length))return[];
    const native=rasterSize(art),scale=native.height/64,canvasWidth=native.width/scale;
    return Designs.layout(art,Designs.figures(art),canvasWidth).map((row,i)=>({index:i,name:row.name||row.subject,role:row.role||'',story:row.story||'',subject:row.subject,
      row,box:{x:row.box.x*scale,y:row.box.y*scale,width:row.box.width*scale,height:row.box.height*scale}}));
  }
  // world1 MOLDINGS: smaller cornice/baseboard courses that repeat the room's band motif. Returned separately from
  // plan() so the authored art allowance, counts and mounting rules of existing rooms are unchanged.
  function moldings(art,{room='',patron=''}={}){
    const Cat=typeof module==='object'&&module.exports?require('./designCatalog'):globalThis.DesignCatalog;
    const wf=name=>typeof module==='object'&&module.exports?require('../retort/worldFlags').on(name):globalThis.HolodekFlags?.[name]===true;
    if(!Cat||!wf('MOLDINGS'))return[];
    const band=art.find(a=>a.kind==='relief'&&/stonework band/.test(a.label||''));if(!band)return[];
    return['cornice','baseboard'].filter(role=>band.stoneworkRole!==role).map(role=>({kind:'relief',surface:'wall',format:'mural',molding:true,
      label:'The '+(patron||'Ancestors')+' '+role,description:'A carved '+role+' course repeating the room\'s '+String(band.carvingStyle).replace(/_/g,' ')+' at a smaller scale.',
      motifs:[patron||'Dragon'],text:'',moldingStyle:band.carvingStyle,...(band.ornamentSecond?{ornamentSecond:band.ornamentSecond,ornamentWeave:band.ornamentWeave}:{}),stoneworkRole:role,carvingDepth:'incised'}));
  }
  function rasterSize(art){
    if(art.kind==='mosaic'&&!art.puzzleClue&&(art.surface==='floor'||Mosaics.shape(art)!=='rectangle'))return{width:120,height:120};
    const ratio=art.aspectRatio||1.5;
    return art.kind==='fresco'&&ratio!==1.5?{width:Math.round(80*ratio),height:80}:{width:144,height:96};
  }
  function presentation(art,{verticalCompensation=1,dungeon}={}){
    if(!['fresco','mosaic'].includes(art.kind)||art.surface!=='wall'||art.puzzleClue)return art;
    const along=art.axis==='x'?'y':'x',ratio=art.kind==='mosaic'?Mosaics.aspectRatio(art):art.aspectRatio||1.5,width=art.size[along],height=art.size.z;
    const compensation=Number.isFinite(verticalCompensation)&&verticalCompensation>0?verticalCompensation:1;
    let available=height;
    if(dungeon){
      const tops=[];
      for(const key of art.keys||[art.key]){
        const cell=dungeon.cells?.[key];if(!cell)continue;
        tops.push((cell.floorHeight||0)+(cell.structureHeight??((cell.ceilHeight??2)-(cell.floorHeight||0))));
        const [x,y]=key.split(',').map(Number),floor=dungeon.cells[`${x+(art.axis==='x'?art.sign:0)},${y+(art.axis==='y'?art.sign:0)}`];
        if(floor)tops.push(floor.roof?.height??floor.ceilHeight??Infinity);
      }
      if(tops.length)available=Math.max(0,Math.min(...tops)-art.position.z-.12);
    }
    // This raycaster uses different horizontal/vertical pixel scales. Compensate only art,
    // growing upward into real masonry; narrow it if the ceiling leaves insufficient height.
    const h=Math.min(available,width/ratio*compensation),w=Math.min(width,h*ratio/compensation);
    return{...art,position:{...art.position,[along]:art.position[along]+(width-w)/2,z:art.position.z+Math.max(0,(Math.min(height,available)-h)/2)},
      size:{...art.size,[along]:w,z:h}};
  }
  function validate(rows){
    if(rows===undefined)return[];
    if(!Array.isArray(rows)||rows.length>6)throw Error('At most six room artworks, plus the permanent puzzle diagram.');
    return rows.map((a,index)=>{
      const issues=[];
      if(!kinds.includes(a?.kind))issues.push('kind must be fresco, relief, inscription or mosaic');
      if(!['wall','floor','object'].includes(a?.surface))issues.push('surface must be wall, floor or object');
      if(typeof a?.label!=='string'||!a.label.trim()||a.label.length>70||/[<>\r\n]/.test(a.label))issues.push('label is required (not name), single line, max70 characters');
      if(typeof a?.description!=='string'||a.description.length>220||/[<>\r\n]/.test(a.description))issues.push('description is required, single line, max220 characters');
      if(!Array.isArray(a?.motifs)||a.motifs.length<1||a.motifs.length>6||a.motifs.some(m=>typeof m!=='string'||!m.trim()||m.length>28||/[<>\r\n]/.test(m)))issues.push('motifs is required: 1-6 short strings, each max28 characters');
      if(a?.text!==undefined&&(typeof a.text!=='string'||a.text.length>120||/[<>\r\n]/.test(a.text)))issues.push('text must be single-line text, max120 characters');
      if(a?.composition!==undefined&&!compositions.includes(a.composition))issues.push(`composition must be ${compositions.join('/')}`);
      if(a?.format!==undefined&&!['panel','mural'].includes(a.format))issues.push('format must be panel or mural');
      if(a?.pigments!==undefined&&(typeof a.pigments!=='string'||!Object.hasOwn(pigmentPalettes,a.pigments)))issues.push('pigments must be ONE string: vermilion/lapis/verdigris/ochre, not an array');
      if(a?.aspectRatio!==undefined&&(![1.5,2,2.5].includes(a.aspectRatio)||a.kind!=='fresco'))issues.push('aspectRatio is fresco-only: 1.5, 2 or 2.5');
      if(issues.length)throw Error(`Invalid selective artwork at roomArt[${index}]: ${issues.join('; ')}.`);
      return{kind:a.kind,surface:a.surface,label:a.label,description:a.description,motifs:[...a.motifs],text:a.text||'',
        ...(typeof a.title==='string'&&a.title.trim()?{title:a.title.trim().slice(0,70)}:{}),...(typeof a.backstory==='string'&&a.backstory.trim()?{backstory:a.backstory.trim().slice(0,600)}:{}),...(a.world1?{world1:a.world1}:{}),composition:a.composition||'procession',
        format:a.format||(a.kind==='fresco'&&a.surface==='wall'?'mural':'panel'),pigments:a.pigments||'vermilion',
        ...(a.aspectRatio!==undefined?{aspectRatio:a.aspectRatio}:{}),
        ...Carvings.validate(a),...Mosaics.validate(a),...(['fresco','mosaic'].includes(a.kind)&&(a.style!==undefined||a.scene!==undefined||a.figures!==undefined)?Designs.validate(a):{})};
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
      if(patron==='Mortacia'&&i===target-1&&!art.some(a=>/sepulchra/i.test(a.label+' '+a.description))){
        art.push({kind:'fresco',surface:'wall',label:'The Sepulchra and the Throne of Hades',
          description:'A historical image of the great green emerald holding Mortacia\'s power, set into the throne of Hades; a depiction, not the relic itself.',
          motifs:['Mortacia','Sepulchra','skeleton','wraith'],scene:'throne_of_hades',composition:'judgment',format:'mural',pigments:'vermilion',text:''});
        continue;
      }
      art.push({kind:'fresco',surface:'wall',label:(patron?patron+': ':'')+themes[i],
        description:`A solemn ${compositions[(i+2)%6]} of ${patron||'the departed'}, with draped souls, stone arcades and celestial imagery.`,
        motifs:[...figures],composition:compositions[(i+2)%6],format:'mural',pigments:Object.keys(pigmentPalettes)[i%4],text:''});
    }
    const style=Designs.tradition(room+' '+description),scene=Designs.sceneFor(room+' '+description);
    const patterns=Carvings.forTradition(style);
    let seed=0;for(const c of room+' '+description)seed=(Math.imul(seed,31)+c.charCodeAt(0))>>>0;
    // Architectural ornament is additional to the six authored paintings, never a replacement.
    if(indoors&&building){
      if(!art.some(a=>a.carvingStyle&&a.surface==='wall'))for(let i=0;i<3;i++)art.push({kind:'relief',surface:'wall',format:'mural',
        label:'The '+(patron||'Ancestors')+' stonework band '+(i+1),description:'A continuous carved frieze of '+(patron||'the ancestors')+' emblems, interwoven scrolls and chiseled borders.',
        motifs:[patron||'Dragon','Moon','Serpent'],text:'',carvingStyle:patterns[seed%patterns.length],stoneworkRole:/crypt|tomb/i.test(room)?'skirting':/palace|basilica/i.test(room)?'cornice':'dado',
        carvingBorder:Carvings.borders[seed%Carvings.borders.length],carvingDepth:'incised'});
      // world1 ARCH_THEMES / MOLDINGS: theme-biased interlocking band plus scaled-down cornice and baseboard courses.
      const Cat=typeof module==='object'&&module.exports?require('./designCatalog'):globalThis.DesignCatalog;
      const wf=name=>typeof module==='object'&&module.exports?require('../retort/worldFlags').on(name):globalThis.HolodekFlags?.[name]===true;
      if(Cat&&wf('ARCH_THEMES')&&wf('ORNAMENT_FIELDS')&&(Carvings.allStyles||[]).includes(Cat.ORNAMENTS[0])){
        const theme=Cat.THEMES[Cat.themeFor(room+' '+description)],pick=theme.ornaments[seed%theme.ornaments.length],second=theme.ornaments[(seed+1)%theme.ornaments.length];
        for(const a of art)if(a.kind==='relief'&&a.surface==='wall'&&/stonework band/.test(a.label)){a.carvingStyle=pick;a.ornamentSecond=second;a.ornamentWeave=Cat.WEAVES[1+seed%3];a.archTheme=Cat.themeFor(room+' '+description);}
      }

      if(!art.some(a=>a.surface==='floor'&&!a.puzzleClue))art.push(style==='byzantine'?{
        kind:'mosaic',surface:'floor',format:'mural',style:'byzantine',label:'The '+(patron||'Ancestors')+' tessellated threshold',
        description:'Gold, lapis and ivory tesserae form interwoven medallions at the entrance.',motifs:[...figures],text:'',composition:'judgment',pigments:'lapis'
      }:{kind:'relief',surface:'floor',format:'mural',label:'The '+(patron||'Ancestors')+' carved threshold',
        description:'Incised stone paving frames the approach with sacred emblems and interlocking ornament.',motifs:[patron||'Dragon','Moon','Serpent'],text:'',
        carvingStyle:patterns[(seed+1)%patterns.length],carvingBorder:'meander',carvingDepth:'incised'});
    }
    if(indoors&&building&&!art.some(a=>a.mosaicPattern)){
      const mosaicPatterns=Mosaics.forTradition(style),pattern=mosaicPatterns[seed%mosaicPatterns.length];
      art.push({kind:'mosaic',surface:'floor',format:'mural',style,mosaicPattern:pattern,
        label:(patron||'The Departed')+': tessellated sanctuary',description:'A bordered pavement of mineral tesserae, sacred emblems and '+pattern.replace(/_/g,' ')+'.',
        motifs:[...figures],text:'',composition:'judgment',pigments:'lapis'});
      if(target===6)art.push({kind:'mosaic',surface:'wall',format:'mural',style:'byzantine',mosaicPattern:'pantheon_rosette',
        label:(patron||'The Ancestors')+': golden rosette',description:'A gold and lapis rosette of sacred emblems surrounding a central medallion.',
        motifs:[...figures],text:'',composition:'judgment',pigments:'lapis'});
    }
    for(const [i,row]of art.entries())if(row.kind==='fresco'||row.kind==='mosaic'&&!row.puzzleClue){
      if(row.kind==='fresco'&&row.format==='mural'&&row.aspectRatio===undefined)row.aspectRatio=2;
      if(!row.style)row.style=style;
      if(row.kind==='mosaic'){
        row.mosaicPattern=Mosaics.resolvePattern(row);
        if(!row.mosaicShape)row.mosaicShape=Mosaics.suggestedShape(row);
        if(!row.figures?.length)row.figures=Mosaics.figures(row);
      }else{
        if(!row.scene)row.scene=i===0?scene:Designs.scenes[(seed+i*5)%Designs.scenes.length];
        if(!row.figures?.length)row.figures=Designs.figures(row);
      }
    }
    if(p?.moduleKit)art.push({kind:p.clueStyle==='floor_mosaic'?'mosaic':'relief',surface:p.clueStyle==='floor_mosaic'?'floor':'wall',
      label:p.title+' diagram',description:'The apparatus reference diagram.',text:'',motifs:p.kind==='harmonics'||p.kind==='sequence'?
        p.order.map(id=>p.controls.find(c=>c.id===id).mark):p.controls.map(c=>c.options[c.goal]),puzzleClue:true,
        clueStyle:p.clueStyle,pairs:['sequence','harmonics'].includes(p.kind)?[]:p.controls.map(c=>({mark:c.mark,option:c.options[c.goal]}))});
    return art.slice(0,13);
  }
  function paint(ctx,createCanvas,art,palette={},glyphs=[],options={}){
    const native=rasterSize(art),cv=createCanvas(native.width,native.height),c=cv.getContext('2d'),canvasWidth=native.width/(native.height/64);
    c.scale(native.height/64,native.height/64);
    // Pigment belongs to the painting, not the beige stone behind it; room lighting still applies in 3D.
    if(art.kind==='fresco'||art.kind==='mosaic'&&art.style)palette=frescoPalette(art);
    const retro=options.retro===true&&art.kind==='fresco'&&!art.puzzleClue;
    if(retro)palette={primary:art.pigments==='vermilion'?'#96282e':'#2724c4',secondary:'#41b936',highlight:'#eff347',shadow:'#000000'};
    const figurePalette=i=>retro?{...palette,primary:['#96282e','#41b936','#2724c4'][i%3]}:palette;
    const primary=palette.primary||'#67564a',trim=palette.secondary||'#c99d65',light=palette.highlight||'#efe0ae',dark=palette.shadow||'#28272a';
    c.fillStyle=primary;c.fillRect(0,0,canvasWidth,64);c.strokeStyle=trim;c.lineWidth=3;
    const shapedMosaic=art.kind==='mosaic'&&!art.puzzleClue&&Mosaics.shape(art)!=='rectangle';
    if(!shapedMosaic&&(!(art.carvingStyle||art.moldingStyle)||art.surface!=='wall'||art.format!=='mural'||art.puzzleClue))c.strokeRect(2,2,canvasWidth-4,60);
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
      if(!art.puzzleClue&&/^sepulchra$/i.test(name)){Iconography.paintSepulchra(c,x,y,size,size,['relief','inscription'].includes(art.kind)?color:undefined);return;}
      if(!art.puzzleClue&&Iconography.paint(c,name,x,y,size,color,['fresco','mosaic'].includes(art.kind)?'painted':undefined))return;
      c.fillStyle=color;const grid=Symbols.bitmap(name,glyphs);grid.forEach((row,yy)=>[...row].forEach((v,xx)=>{if(v==='1')c.fillRect(Math.round(x+xx*size/7),Math.round(y+yy*size/7),Math.ceil(size/7),Math.ceil(size/7));}));
    };
    if(art.pairs?.length){
      art.pairs.forEach((pair,i)=>{const y=9+i*11;
        if(art.clueStyle==='wall_relief'){ink(pair.mark,14,y+1,10,dark);ink(pair.option,70,y+1,10,dark);}
        ink(pair.mark,13,y,10,light);ink(pair.option,69,y,10,light);
        c.fillStyle=trim;c.fillRect(34,y+4,22,1);c.fillRect(53,y+2,1,5);});
    }else if(art.kind==='mosaic'&&!art.puzzleClue){
      const rows=Mosaics.figures(art);
      Mosaics.paint(c,art,{primary,secondary:trim,highlight:light,shadow:dark},ink,(index,box,override)=>{
        Figures.paint(c,{...rows[index%rows.length],...override},palette,box,art.style||'byzantine',createCanvas);
      },canvasWidth);
    }else if(art.kind==='fresco'){
      // Expand architectural space, not the figures' anatomy. Classic 3:2 templates remain available.
      const spread=canvasWidth/96;c.save();c.scale(spread,1);
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
      else{const r=composition==='cosmogony'?12:9;c.fillStyle=light;c.beginPath();c.ellipse(48,18,r/spread,r,0,0,Math.PI*2);c.fill();}
      if(!traditional&&(composition==='constellation'||composition==='cosmogony'))for(let i=0;i<7;i++){
        const x=17+(i*17+art.label.length)%65,y=8+(i*11)%25;c.fillStyle=light;c.fillRect(x,y,1,2);c.fillRect(x-1,y+1,3,1);
      }
      if(!traditional&&(composition==='apotheosis'||composition==='cosmogony')){
        c.fillStyle=light;for(let i=0;i<9;i++){c.beginPath();c.ellipse(17+i*7,35+(i%3),8,2,0,0,Math.PI*2);c.fill();}
      }
      Designs.details(c,art,palette,ink);
      c.restore();
      if(art.style||art.figures?.length){
        const rows=Designs.layout(art,Designs.figures(art),canvasWidth);
        for(const [i,row] of rows.entries()){
          if(art.style==='byzantine'){c.strokeStyle=light;c.lineWidth=1;c.beginPath();c.arc(row.box.x+row.box.width/2,row.box.y+5,5,0,Math.PI*2);c.stroke();}
          Figures.paint(c,row,figurePalette(i),row.box,art.style||'renaissance',createCanvas);
        }
      }else{
      const figures=art.motifs.filter(m=>Iconography.name(m)||Sculptures.forms.includes(m.toLowerCase()));
      const subjects=figures.length?figures.slice(0,3):['human','skeleton','wraith'];
      subjects.forEach((m,i)=>{const deity=Iconography.name(m),form=deity?Iconography.pantheon[deity].form:m.toLowerCase();
        const central=subjects.length===1||composition!=='procession'&&i===0;
        const box=central?{x:27,y:composition==='apotheosis'?3:8,width:43,height:46}:
          {x:subjects.length===2?5+i*46:4+i*29,y:composition==='lamentation'?24:15,width:subjects.length===3?29:39,height:composition==='lamentation'?29:39};
        box.x=(box.x+box.width/2)*spread-box.width/2;
        Sculptures.paintFigure(c,{label:art.label+' '+m,form,deity},{...figurePalette(i),secondary:trim,highlight:light,shadow:dark},
          {...box,pigment:true});});
      const deity=Iconography.name(subjects[0]);ink(deity||art.motifs[0],canvasWidth/2-5,7,9,light);
      }
      // Broken plaster and restrained pigment hatching retain the voxel/pixel vocabulary.
      c.globalAlpha=.2;c.fillStyle=light;for(let y=8;y<56;y+=3)for(let x=8+(y%4);x<canvasWidth-9;x+=7)c.fillRect(x,y,1,1);c.globalAlpha=1;
    }else if(art.carvingStyle&&!art.puzzleClue)Carvings.paint(c,art,palette,ink);
    else if(art.moldingStyle&&!art.puzzleClue){const Cat=typeof module==='object'&&module.exports?require('./designCatalog'):globalThis.DesignCatalog;Cat?.paintBand(c,{...art,carvingStyle:art.moldingStyle},palette);}
    else art.motifs.forEach((name,i)=>{
      const size=Math.min(23,70/art.motifs.length),x=10+i*76/art.motifs.length;
      if(art.kind==='relief')ink(name,x+1,20+1,size,dark);
      ink(name,x,20,size,light);
    });
    if(art.text&&art.kind==='inscription'&&!art.puzzleClue){
      const script=Scripts.describe({text:art.text,seed:art.label}),letters=art.text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      for(let row=0;row<2;row++)for(let j=0;j<18;j++){
        const glyph=Scripts.glyph(letters[row*18+j]||' ',script.style);
        glyph.forEach((bits,y)=>[...bits].forEach((bit,x)=>{if(bit==='1'){
          c.fillStyle=dark;c.fillRect(7+j*4.5+x*.5,43+row*7+y*.5,.7,.7);
          c.fillStyle=light;c.fillRect(7.4+j*4.5+x*.5,43.4+row*7+y*.5,.4,.4);
        }}));
      }
    }else if(art.text){
      c.fillStyle=light;c.font='4px Georgia';const lines=[];let line='';
      for(const word of art.text.split(/\s+/)){if((line+' '+word).length>40){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);
      lines.slice(0,4).forEach((text,i)=>c.fillText(text,7,49+i*4,82));
    }
    // Local abrasion leaves this artwork distinctive without repeating it as a wall texture.
    c.fillStyle=dark;for(let i=0;i<12;i++){const x=(i*31+art.label.length*7)%92,y=(i*17+13)%60;c.fillRect(x,y,2,1);}
    if(art.kind==='mosaic'&&!art.puzzleClue){
      Mosaics.finishShape(c,art,{secondary:trim,highlight:light},canvasWidth);
      const pixels=c.getImageData(0,0,native.width,native.height);
      // Individual tesserae retain the figures' colors; offset grout and facets break the painted surface.
      for(let y=0;y<native.height;y++)for(let x=0;x<native.width;x++){
        const tx=Math.floor((x+(Math.floor(y/3)%2))/3),ty=Math.floor(y/3),i=(x+y*native.width)*4;
        const grout=y%3===0||(x+ty%2)%3===0,factor=grout?.58:.9+((tx*13+ty*7)%9)*.025;
        for(let channel=0;channel<3;channel++)pixels.data[i+channel]=Math.min(255,pixels.data[i+channel]*factor);
      }c.putImageData(pixels,0,0);
    }
    ctx.imageSmoothingEnabled=false;ctx.drawImage(cv,0,0,ctx.canvas.width,ctx.canvas.height);
  }
  function mesh(image,axis='y',surface='wall',sign=-1,carving){
    if(carving?.kind==='inscription'&&!carving.puzzleClue)return Carvings.mesh(image,axis,surface,sign,'raised');
    if((carving?.carvingStyle||carving?.moldingStyle)&&!carving.puzzleClue)return Carvings.mesh(image,axis,surface,sign,carving.carvingDepth);
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
  return{kinds,compositions,pigmentPalettes,frescoPalette,rasterSize,figureBoxes,presentation,validate,plan,moldings,paint,mesh,
    toolbox:()=>({...Designs.toolbox(),frescoAspectRatio:[1.5,2,2.5],mosaicPattern:Mosaics.patterns,mosaicShape:Mosaics.shapes,stonework:Carvings.toolbox()})};
});
