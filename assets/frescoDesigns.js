(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./shrineIconography'):root.ShrineIconography,
    typeof module==='object'&&module.exports?require('./artCharacters'):root.ArtCharacters);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FrescoDesigns=api;
})(typeof window==='undefined'?globalThis:window,function(Icons,People){
  'use strict';
  const styles={
    renaissance:'Perspective pavements, triangular groups, distant landscapes and counterposed gestures.',
    classical_roman:'Painted architectural vistas, slender columns, framed narrative panels and mineral reds.',
    classical_greek:'Terracotta grounds, dark outlined figures, meander borders and balanced profile groups.',
    medieval_gothic:'Pointed arcades, tracery, tall figures and jewel-colored narrative compartments.',
    medieval_illuminated:'Interlaced margins, leafy initials, ornamental medallions and manuscript-like scenes.',
    byzantine:'Gold tesserae, frontal hieratic figures, aureoles and balanced sacred courts.',
    egyptian:'Flat registers, profile gestures, hierarchical scale, reed borders and symbolic bands.',
    mesopotamian:'Stone-colored processional reliefs, winged guardians, rosettes and stepped framing.',
    romanesque:'Round arches, almond-shaped glory, rhythmic compartments and strongly outlined figures.',
    baroque:'Sweeping curtains, diagonal groups, directional light and cloud-borne dramatic gestures.'
  };
  const poses=['standing','contrapposto','offering','invocation','mourning','pointing','reading','kneeling','seated','reclining','guarding','striding'];
  const scenes=['ancestral_court','burial_rites','dragon_war','scholars','star_map','forge','river_crossing','garden_of_souls','gatekeepers','pilgrimage'];
  const attributes=People.attributes;
  const robes=['pleated','toga','mantle','armor','shroud'],heads=['bare','helmet','hood','laurel','crown'];
  const forms=['human','dragon','skeleton','wraith','angel','demon','mortal'];
  function validate(art){
    const style=art.style||'renaissance',scene=art.scene||'ancestral_court';
    if(!Object.hasOwn(styles,style)||!scenes.includes(scene)||art.figures!==undefined&&(!Array.isArray(art.figures)||art.figures.length>6))throw Error('Invalid fresco tradition, scene or figure count.');
    const figures=(art.figures||[]).map(f=>{
      const subject=Icons.name(f?.subject)||f?.subject;
      if(!subject||!Icons.name(subject)&&!forms.includes(subject)&&!People.race(subject)||!poses.includes(f.pose)||
        f.facing!==undefined&&!['front','left','right'].includes(f.facing)||f.attribute!==undefined&&!attributes.includes(f.attribute)||
        f.robe!==undefined&&!robes.includes(f.robe)&&f.robe!=='class'||f.head!==undefined&&!heads.includes(f.head)&&f.head!=='class')throw Error('Invalid fresco figure, pose or costume.');
      const person=People.validate({...f,...(People.race(subject)&&!f.race?{race:subject}:{})});
      if(Icons.name(subject)&&Object.keys(person).length)throw Error('Invalid mortal overrides on a canonical deity.');
      const defaults=People.defaults(person),deity=Icons.name(subject),classFigure=!!person.className;
      return{subject,pose:f.pose,facing:f.facing||'front',attribute:f.attribute|| (deity?Icons.pantheon[deity].attribute:defaults.attribute),
        robe:f.robe||(classFigure?'class':'pleated'),head:f.head||(classFigure?'class':'bare'),...person};
    });
    return{style,scene,figures};
  }
  function tradition(text){
    const t=String(text||'').toLowerCase();
    if(/egypt|hypostyle|pylon|hieroglyph/.test(t))return'egyptian';
    if(/byzant|pendentive|gold.*mosaic|iconostasis/.test(t))return'byzantine';
    if(/gothic|pointed arch|fan vault|tracery/.test(t))return'medieval_gothic';
    if(/manuscript|illuminated|scriptorium/.test(t))return'medieval_illuminated';
    if(/roman(esque)|round.*vault/.test(t))return'romanesque';
    if(/roman|atrium|domus|forum/.test(t))return'classical_roman';
    if(/greek|hellenic|meander/.test(t))return'classical_greek';
    if(/ziggurat|assyrian|mesopotam/.test(t))return'mesopotamian';
    if(/baroque|baldachin|baldacchino/.test(t))return'baroque';
    return'renaissance';
  }
  function sceneFor(text){
    const t=String(text||'').toLowerCase();
    return /forge|smith|furnace/.test(t)?'forge':/librar|archive|book|scribe/.test(t)?'scholars':
      /battle|war|knight/.test(t)?'dragon_war':/burial|tomb|crypt|grave/.test(t)?'burial_rites':
      /star|constellation|observatory/.test(t)?'star_map':/river|water|bridge/.test(t)?'river_crossing':
      /garden|forest|root/.test(t)?'garden_of_souls':/gate|guard|entrance/.test(t)?'gatekeepers':'ancestral_court';
  }
  function figures(art){
    if(art.figures?.length)return art.figures;
    const subjects=(art.motifs||[]).map(s=>Icons.name(s)||People.race(s)||People.role(s)||s.toLowerCase()).filter(s=>Icons.name(s)||forms.includes(s)||People.race(s)||People.role(s)).slice(0,6);
    if(!subjects.length)subjects.push('human','skeleton','wraith');
    const scene=art.scene||'ancestral_court';
    const gestures={ancestral_court:['offering','kneeling','invocation'],burial_rites:['mourning','reclining','kneeling'],
      dragon_war:['guarding','striding','pointing'],scholars:['seated','reading','pointing'],star_map:['invocation','pointing','reading'],
      forge:['standing','kneeling','offering'],river_crossing:['pointing','striding','mourning'],garden_of_souls:['contrapposto','seated','offering'],
      gatekeepers:['guarding','standing','kneeling'],pilgrimage:['striding','offering','standing']}[scene];
    return subjects.map((subject,i)=>{
      const role=People.role(subject),race=People.race(subject),deity=Icons.name(subject);
      return{subject:role?'mortal':subject,...(race?{race}:{}),...(role?{className:role}:{}),pose:gestures[i%3],
        facing:['egyptian','classical_greek','mesopotamian'].includes(art.style)?(i%2?'left':'right'):'front',
        attribute:deity?Icons.pantheon[deity].attribute:role?People.defaults({className:role}).attribute:
          scene==='scholars'?'book':scene==='dragon_war'?'sword':scene==='forge'?'torch':scene==='ancestral_court'&&i===0?'scales':i===1?'scroll':'none',
        robe:role?'class':art.style==='classical_roman'||art.style==='classical_greek'?'toga':scene==='dragon_war'?'armor':'pleated',head:role?'class':scene==='dragon_war'?'helmet':'bare'};
    });
  }
  function layout(art,rows){
    const style=art.style||'renaissance',composition=art.composition||'judgment',count=rows.length;
    const equal=['classical_greek','classical_roman','medieval_illuminated','mesopotamian','egyptian'].includes(style)||composition==='procession';
    return rows.map((f,i)=>{
      let width,height,x,y;
      if(equal){width=Math.min(42,78/count);height=style==='egyptian'?37:42;x=9+i*78/count+(78/count-width)/2;y=style==='egyptian'?14:11;}
      else if(i===0){width=40;height=46;x=28;y=8;}else{width=count>3?23:29;height=count>3?27:34;x=i%2?6:62;y=i>2?26:19;}
      if(f.pose==='kneeling'||f.pose==='seated'){height*=.75;y+=10;}
      if(f.pose==='reclining'){width=Math.max(width,35);height=22;y=31;}
      if(composition==='lamentation'&&f.pose!=='reclining'){height*=.85;y+=6;}
      return{...f,box:{x,y,width,height}};
    });
  }
  function background(c,art,pal,ink){
    const {primary,secondary:trim,highlight:light,shadow:dark}=pal,style=art.style;
    const fill=(color,pts)=>{c.fillStyle=color;c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();};
    c.fillStyle=dark;c.fillRect(6,6,84,52);
    if(style==='classical_greek'){
      c.fillStyle='#b36c42';c.fillRect(7,7,82,50);c.strokeStyle=dark;c.lineWidth=1;
      for(let x=8;x<89;x+=8){c.strokeRect(x,8,6,4);c.fillRect(x,53,5,2);}c.fillStyle=dark;c.fillRect(8,48,80,2);
    }else if(style==='egyptian'){
      c.fillStyle='#cfb176';c.fillRect(7,7,82,50);c.fillStyle=dark;c.fillRect(8,12,80,1);c.fillRect(8,49,80,1);
      for(let i=0;i<9;i++)ink((art.motifs||['sun'])[i%(art.motifs?.length||1)],10+i*8,51,5,dark);
      for(const x of[8,84]){c.fillStyle=trim;c.fillRect(x,15,3,32);fill(dark,[[x-2,16],[x+1,12],[x+5,16]]);}
      c.fillStyle=light;c.beginPath();c.arc(48,10,4,0,Math.PI*2);c.fill();
    }else if(style==='byzantine'){
      c.fillStyle='#b69851';c.fillRect(7,7,82,50);c.fillStyle=light;
      for(let y=8;y<56;y+=3)for(let x=8+(y%2);x<88;x+=3){c.globalAlpha=((x+y)%7)/20;c.fillRect(x,y,2,2);}c.globalAlpha=1;
      fill(dark,[[48,6],[78,31],[48,55],[18,31]]);c.strokeStyle=trim;c.lineWidth=2;c.beginPath();c.ellipse(48,31,23,24,0,0,Math.PI*2);c.stroke();
    }else if(style==='medieval_gothic'){
      c.fillStyle=primary;c.fillRect(7,7,82,50);
      for(const x of[10,37,64]){fill(dark,[[x,47],[x,20],[x+10,7],[x+20,20],[x+20,47]]);c.strokeStyle=trim;c.lineWidth=1;c.strokeRect(x,24,20,24);
        c.beginPath();c.moveTo(x+1,20);c.lineTo(x+10,8);c.lineTo(x+19,20);c.stroke();ink('Star',x+7,17,6,light);}
    }else if(style==='medieval_illuminated'){
      c.fillStyle=primary;c.fillRect(10,10,76,45);c.strokeStyle=trim;c.lineWidth=1;
      for(let i=0;i<9;i++){const y=9+i*5;c.beginPath();c.ellipse(8,y,2,4,i%2?.5:-.5,0,Math.PI*2);c.stroke();c.beginPath();c.ellipse(88,y,2,4,i%2?-.5:.5,0,Math.PI*2);c.stroke();}
      for(let x=13;x<84;x+=8){ink('Leaf',x,7,5,light);ink('Star',x,53,4,trim);}c.fillStyle=dark;c.fillRect(12,13,72,37);
    }else if(style==='mesopotamian'){
      c.fillStyle='#b9a48c';c.fillRect(7,7,82,50);c.fillStyle=dark;c.fillRect(8,49,80,1);
      for(let x=9;x<88;x+=10){ink('Star',x,8,6,trim);c.fillRect(x,53,2,2);c.fillRect(x+3,53,1,3);}
      for(const x of[8,81]){c.fillStyle=trim;c.fillRect(x,18,6,31);c.fillRect(x+1,14,4,4);c.fillRect(x+2,10,2,4);}
    }else if(style==='romanesque'){
      c.fillStyle=primary;c.fillRect(7,7,82,50);c.fillStyle=trim;
      for(const x of[10,37,64]){c.fillRect(x,22,21,30);c.beginPath();c.arc(x+10.5,22,10.5,Math.PI,0);c.fill();c.fillStyle=dark;c.fillRect(x+2,22,17,28);c.beginPath();c.arc(x+10.5,22,8.5,Math.PI,0);c.fill();c.fillStyle=trim;}
    }else if(style==='baroque'){
      const glow=c.createLinearGradient(10,8,84,54);glow.addColorStop(0,light);glow.addColorStop(.3,primary);glow.addColorStop(1,dark);c.fillStyle=glow;c.fillRect(7,7,82,50);
      for(const x of[7,82]){fill(primary,[[x,7],[x+7,7],[x+5,51],[x-4,53]]);c.strokeStyle=trim;for(let i=0;i<3;i++){c.beginPath();c.moveTo(x+i*2,7);c.bezierCurveTo(x+4,20,x-5,34,x+3,50);c.stroke();}}
      c.fillStyle=light;for(let i=0;i<6;i++){c.beginPath();c.ellipse(19+i*11,48-i*5,9,2,-.25,0,Math.PI*2);c.fill();}
    }else if(style==='classical_roman'){
      c.fillStyle=primary;c.fillRect(7,7,82,50);
      for(const x of[10,37,64]){c.strokeStyle=trim;c.lineWidth=1;c.strokeRect(x,10,21,41);c.fillStyle=dark;c.fillRect(x+2,12,17,37);c.fillStyle=light;c.fillRect(x-1,11,2,42);c.fillRect(x+21,11,2,42);}
      c.fillStyle=trim;for(let x=7;x<90;x+=4)c.fillRect(x,54,2,1);
    }
  }
  function details(c,art,pal,ink){
    const scene=art.scene,light=pal.highlight,dark=pal.shadow,trim=pal.secondary;
    if(scene==='river_crossing'){c.fillStyle=trim;for(let i=0;i<5;i++)c.fillRect(9+i*15,48+i%2,12,1);ink('Wave',40,43,12,light);}
    if(scene==='forge'){c.fillStyle=dark;c.fillRect(36,43,24,6);ink('Flame',42,33,12,light);}
    if(scene==='garden_of_souls')for(const x of[12,77]){c.fillStyle=trim;c.fillRect(x,35,1,18);ink('Leaf',x-3,28,9,light);}
    if(scene==='star_map')for(let i=0;i<8;i++)ink(i%2?'Star':'Moon',12+i*9,8+(i%2)*5,5,light);
    if(scene==='gatekeepers'){c.strokeStyle=trim;c.lineWidth=1;c.strokeRect(35,15,26,33);for(let x=39;x<59;x+=4)c.fillRect(x,16,1,30);}
    if(scene==='scholars'){c.fillStyle=trim;c.fillRect(28,46,38,2);c.fillRect(31,48,2,7);c.fillRect(62,48,2,7);}
    if(scene==='burial_rites'){c.fillStyle=trim;c.fillRect(29,49,39,5);c.fillStyle=light;c.fillRect(27,48,43,2);}
  }
  return{styles,poses,scenes,attributes,robes,heads,validate,tradition,sceneFor,figures,layout,background,details,
    toolbox:()=>({styles,scenes,poses,attributes,robes:[...robes,'class'],heads:[...heads,'class'],subjects:[...Object.keys(Icons.pantheon),...forms],people:People.toolbox()})};
});
