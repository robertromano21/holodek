(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShrineIconography = api;
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  // Compact visual index of the pantheon in retortWithUserInput's campaign prompt.
  const pantheon = {
    Mortacia: { form:'human', wings:'skeletal', hair:'blonde', symbol:'winged_lady', color:'#eee7ce', domain:'death, memory, ancestors; tall White Lady with blonde hair and grey dragon wings: raised pointed wrists, long skeletal ribs and scalloped membranes, not feathers or bare bones' },
    Atinus: { form:'dragon', symbol:'skull', color:'#ad674d', domain:'Wardrake; war, strategy, honor; narrow dragon skull, swept long horns, central spike, hooked cheeks and red-gold edging' },
    Arithus: { form:'dragon', symbol:'dagger', color:'#a34a3e', domain:'Kinslayer; vengeance, kinstrife; fists gripping a downward dagger' },
    Atricles: { form:'dragon', symbol:'eye', color:'#a4aa9a', domain:'Ringdrake; justice and balance; pale banded-agate dragon, long neck and curled tail, broad membrane wings, two hind legs and golden rings' },
    Chaoticum: { form:'dragon', symbol:'flame', color:'#e59946', domain:'chaos and destruction; fireball through stars' },
    Dantuea: { form:'dragon', symbol:'serpent', color:'#594d66', domain:'Darkdrake; corruption and undeath; skeletal dragon with a narrow horned skull, exposed ribs and spine, bony wing spars and two hind legs' },
    Dyanetzia: { form:'dragon', symbol:'leaf', color:'#b29b52', domain:'Earthdragon, Dyana; topaz/clay dragon curled head to tail; nature and renewal' },
    Eredine: { form:'dragon', symbol:'eye', color:'#b4bfd4', domain:'magic and runes; dragon wings on an opal/crystal eye' },
    Krystalynn: { form:'dragon', symbol:'eye', color:'#a75d65', domain:'nightmares and illusions; dragon head with cracked bloodstone eye' },
    Leona: { form:'dragon', symbol:'flowers', color:'#7f9e64', domain:'forests; wooden disk with snapdragon flowers' },
    Llellwyth: { form:'dragon', symbol:'flame', color:'#d48a55', domain:'Phoenix; rebirth and forge; carnelian wings' },
    Mordicar: { form:'dragon', symbol:'picks', color:'#a9a79c', domain:'stone, mountains, masons; crossed quarry picks' },
    Musydius: { form:'dragon', symbol:'prism', color:'#91b7b9', domain:'music and echoes; clear crystal prism on a metal chain' },
    Neptar: { form:'dragon', symbol:'wave', color:'#668eab', domain:'storms and water; roaring serpent with lightning' },
    Poena: { form:'dragon', symbol:'cloud', color:'#c5b6cc', domain:'wind, love and vows; coiled dragon on a cloud' },
    Rama: { form:'dragon', symbol:'heart_flame', color:'#d9a556', domain:'Rama\'san; sun, history, prophecy; ruby heart with a flame' },
    Sharlynn: { form:'dragon', symbol:'serpent', color:'#7c9562', domain:'betrayal and rot; green dragon looking back at its tail' },
    Sylanos: { form:'dragon', symbol:'moon', color:'#d5d5d1', domain:'white moon and positive energy; silver disk' },
    Syluria: { form:'dragon', symbol:'moon', color:'#759fcb', domain:'blue moon and change; blue disk' },
    Turthus: { form:'dragon', symbol:'turtle', color:'#939887', domain:'wisdom and texts; giant turtle dragon with a massive stone carapace, draconic head, sturdy limbs and long tail' },
    Uceracea: { form:'dragon', symbol:'unicorn', color:'#d6cec5', domain:'Unicorn; sacred animals, purification; unicorn profile with pearl horn' },
    Urthur: { form:'dragon', symbol:'eye', color:'#547ba3', domain:'Greatdrake; guardianship and loyalty; sapphire eye' },
    'Nameless Drake': { form:'dragon', symbol:'triangle', color:'#514b56', domain:'Unseen; cruelty and fear; black triangle' }
  };
  // Campaign canon, not a borrowing from the historic traditions used to frame the art.
  const details = {
    Mortacia:['Bonedrake; Mistress Death; White Lady','N','White female figure with skeletal dragon wings','The Reaper','scythe'],
    Atinus:['Wardrake; Silent General','CN','Draconic skull','The Glorysword','sword'],
    Arithus:['Kinslayer; Grinning Slaughter','CE','Clenched fists gripping a downward dagger','Killing Stroke','dagger'],
    Atricles:['Ringdrake; Banded One; Agate Eye','N','Banded agate carved as a dragon','Swift Justice','sword'],
    Chaoticum:['Lord of Destruction','CN','Fireball shooting through stars','The Wrecking Ball','catapult'],
    Dantuea:['Darkdrake; Silent Sphere; Obsidian Eye','NE','Cabochon obsidian carved as a dragon','Fist of Darkness','gauntlet'],
    Dyanetzia:['Earthdragon; Motherdrake; Topaz Ring','NG','Topaz or fired-clay dragon curled head to tail in a ring','Branch of Life','staff'],
    Eredine:['Mysticdrake; Shimmering Star; Opal Eye','N','Spread-wing dragon perched on an opal or clear-crystal eye','Staff of the Inner Eye','staff'],
    Krystalynn:['Scarred Dragon; Bloodstone Eye; Lady of Illusions','CN','Dragon-head profile with a cracked bloodstone eye',"Fear's Arm",'club'],
    Leona:['Wooddrake; Flowering Mistress; Everbloom','N','Wooden disk carved with snapdragon flowers','The Tangled Web','net'],
    Llellwyth:['Phoenix; Everliving Flame; Carnelian Eye','CG','Phoenix with carnelian or red-glass beads dangling from wings and tail','The Fiery Beak','spear'],
    Mordicar:['Stonedrake; Granite Lord; Cracked Plate','N','Crossed heavy picks with a quarry behind','Stonecutter','pick'],
    Musydius:['Echodrake; Gleaming Prism; Singing Serpent; Artisan','NG','Crystal prism and metal rod linked by a chain or cord','Singing Stone','sling'],
    Neptar:['Stormdrake; Thundering Lord; Fury','CN','Roaring serpent profile with lightning issuing from its mouth','Thunder and Lightning','harpoon'],
    Poena:['Winddrake; Misty Dragon; Lady of Clouds','CG','Coiled dragon resting on a cloud','The Eternal Flight','bow'],
    Rama:['Firedrake; Lifegiver; Ruby Heart; All','LG','Ruby or red-glass heart with a central flame','The Searing Lance','lance'],
    Sharlynn:['Greendrake; Jealous Wyrm; Emerald Eye','LE','Green enameled dragon looking back at its tail',"The Tongue's Lashing",'whip'],
    Sylanos:['Luminescent Egg; Shining One','NG','Silver disk','The Crescent Blade','sickle'],
    Syluria:['Shadowed Egg; Cloaking One; Blue Goddess','N','Blue disk','Staff of Syluria','staff'],
    Turthus:['Great Turtle; Armored Sleeper; Hematite Eye','N','Turtle shell studded with granite, hematite or marble chips','War Shell','mace'],
    Uceracea:['Unicorn; Pearly Steeds; Pearl Eye','CG','Unicorn-head profile with a pearl or white enameled horn','Pearled Horn','lance'],
    Urthur:['Greatdrake; Giant Wyrm; Sapphire Eye','LG','Blue enameled eye','The Deterrent','halberd'],
    'Nameless Drake':['Unseen; Unknowable; Unforgiving','NE','Black triangle','Whirling Pain','chain']
  };
  for(const [deity,[epithets,alignment,symbolDescription,weapon,attribute]] of Object.entries(details))
    Object.assign(pantheon[deity],{epithets,alignment,symbolDescription,weapon,attribute});
  // Art-direction recipes interpret the portfolios; they are not new campaign anatomy facts.
  const effigies={
    Atinus:{build:'heavy',horns:'ram',claws:true},Arithus:{build:'heavy',horns:'curved',spikes:true,fangs:true},
    Atricles:{build:'slender',horns:'curved',markings:'stripes',ringdrake:true},Chaoticum:{build:'heavy',wings:'flame',spikes:true},
    Dantuea:{build:'slender',wings:'bone',covering:'bone',markings:'cracks'},Dyanetzia:{build:'heavy',horns:'antlers',wings:'none',tail:'thick'},
    Eredine:{build:'slender',horns:'antlers',markings:'runes'},Krystalynn:{build:'slender',horns:'nubs',spikes:true,markings:'cracks'},
    Leona:{build:'slender',horns:'antlers',wings:'none',tail:'thin',covering:'bark'},Llellwyth:{build:'slender',wings:'flame',horns:'none'},
    Mordicar:{build:'heavy',horns:'ram',wings:'none',covering:'stone'},Musydius:{build:'slender',horns:'curved',wings:'feather'},
    Neptar:{build:'slender',horns:'long',tail:'scaled'},Poena:{build:'slender',horns:'none',wings:'spectral'},
    Rama:{build:'heavy',horns:'long',wings:'flame'},Sharlynn:{build:'slender',horns:'nubs',tail:'thick',claws:true},
    Sylanos:{build:'slender',horns:'curved',wings:'feather',markings:'none'},Syluria:{build:'slender',horns:'antlers',wings:'bat'},
    Turthus:{build:'heavy',horns:'none',wings:'none',tail:'thick',covering:'stone',carapace:true},Uceracea:{build:'slender',horns:'crown',wings:'feather'},
    Urthur:{build:'heavy',horns:'ram',wings:'bat',spikes:true},'Nameless Drake':{build:'slender',horns:'none',wings:'bone',covering:'shadow'}
  };
  for(const [deity,visual]of Object.entries(effigies))pantheon[deity].visual=visual;
  const aliases = { dyana:'Dyanetzia', earthdragon:'Dyanetzia', bonedrake:'Mortacia', 'white lady':'Mortacia', darkdrake:'Dantuea', wardrake:'Atinus', 'rama\'san':'Rama' };
  for(const [deity,canon] of Object.entries(pantheon))for(const title of canon.epithets.split('; '))
    aliases[['all','artisan','fury','unseen'].includes(title.toLowerCase())?'the '+title.toLowerCase():title.toLowerCase()]=deity;
  function name(value) {
    const key = String(value || '').trim().toLowerCase();
    return Object.keys(pantheon).find(n => n.toLowerCase() === key) || aliases[key] || null;
  }
  function find(text) {
    const source = String(text || '').toLowerCase();
    return Object.keys(pantheon).find(n => new RegExp('\\b'+n.toLowerCase()+'\\b').test(source)) ||
      Object.keys(aliases).sort((a,b)=>b.length-a.length)
        .map(a => new RegExp('\\b'+a+'\\b').test(source) ? aliases[a] : null).find(Boolean) || null;
  }
  const emblems=new Map();
  function bitmap(value){
    const deity=/^suzerain(?: emblem)?$/i.test(String(value).trim())?'Suzerain':name(value);if(!deity)return null;
    if(emblems.has(deity))return emblems.get(deity);
    const size=25,grid=Array.from({length:size},()=>Array(size).fill('0'));
    const dot=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&x<size&&y>=0&&y<size)grid[y][x]='1';};
    const line=(a,b)=>{const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*2);for(let i=0;i<=n;i++)dot(a[0]+(b[0]-a[0])*i/Math.max(1,n),a[1]+(b[1]-a[1])*i/Math.max(1,n));};
    const path=pts=>pts.slice(1).forEach((p,i)=>line(pts[i],p));
    const oval=(x,y,rx,ry,solid=false)=>{for(let yy=0;yy<size;yy++)for(let xx=0;xx<size;xx++){
      const r=((xx-x)/rx)**2+((yy-y)/ry)**2;if(solid?r<=1:Math.abs(r-1)<.23)dot(xx,yy);
    }};
    const dragon=(x=12,y=12,r=8)=>{oval(x,y,r,r*.75);path([[x+r*.5,y-r*.5],[x+r,y-r],[x+r,y-r*.2],[x+r*.5,y]]);dot(x+r*.65,y-r*.45);};
    const wing=(side,bone=false)=>{path([[12,10],[12+side*8,3],[12+side*11,13],[12,10]]);
      for(const t of[6,9,12])line([12,10],[12+side*9,t]);if(!bone)line([12,10],[12+side*6,5]);};
    const flame=(x,y)=>path([[x,y+5],[x-3,y+2],[x-2,y-1],[x,y-5],[x+1,y],[x+3,y+2],[x,y+5]]);
    switch(deity){
      case'Suzerain':
        path([[12,1],[9,6],[12,11],[15,6],[12,1]]);line([12,10],[12,23]);
        for(const side of[-1,1]){
          const p=(x,y)=>[12+side*x,y];
          path([p(0,12),p(5,11),p(8,7),p(9,3),p(5,5),p(4,8),p(5,9),p(7,7)]);
          path([p(0,18),p(4,16),p(7,17),p(8,20),p(6,22),p(4,20),p(5,19)]);
        }line([8,14],[16,14]);break;
      case'Mortacia':oval(12,5,2,2,true);path([[12,8],[8,21],[16,21],[12,8]]);
        for(const side of[-1,1]){const p=(x,y)=>[12+side*x,y],tip=p(6,1);
          path([p(2,9),tip,p(9,8),p(11,22),p(8,18),p(6,21),p(4,15),p(3,17),p(2,9)]);
          for(const end of[p(11,22),p(6,21),p(3,17)])line(tip,end);
        }break;
      case'Atinus':
        path([[10,7],[2,1],[6,9],[5,8],[7,13],[4,11],[6,16],[9,17],[9,21],[11,23],[13,23],[15,21],[15,17],
          [18,16],[20,11],[17,13],[19,8],[18,9],[22,1],[14,7],[12,4],[10,7]]);
        path([[9,9],[7,8],[9,13],[10,12],[9,9]]);path([[15,9],[17,8],[15,13],[14,12],[15,9]]);
        line([12,8],[12,15]);path([[10,17],[12,16],[14,17]]);dot(10,18);dot(14,18);
        for(const x of[10,12,14])line([x,20],[x,22]);
        for(const side of[-1,1])path([[12+side*4,16],[12+side*6,18],[12+side*4,18]]);break;
      case'Arithus':path([[12,2],[9,17],[12,23],[15,17],[12,2]]);line([6,9],[18,9]);
        for(const x of[5,14]){path([[x,6],[x+4,6],[x+4,12],[x,12],[x,6]]);for(let y=7;y<12;y+=2)line([x,y],[x+3,y]);}break;
      case'Atricles':dragon();for(const y of[6,10,14,18])line([5,y],[18,y]);break;
      case'Dantuea':oval(12,12,10,10);dragon(12,12,6);line([6,20],[18,4]);break;
      case'Dyanetzia':dragon(12,12,9);path([[19,6],[17,12],[13,15],[9,13],[10,10]]);break;
      case'Eredine':wing(-1);wing(1);path([[4,19],[12,15],[20,19],[12,23],[4,19]]);oval(12,19,2,2,true);dragon(12,8,3);break;
      case'Krystalynn':path([[4,20],[7,12],[5,4],[12,7],[18,9],[22,15],[14,16],[12,22]]);oval(13,11,3,3);
        path([[11,8],[13,10],[12,12],[15,14]]);break;
      case'Leona':oval(12,12,11,11);for(const x of[7,12,17]){line([x,19],[x,7]);oval(x,7,2,3);line([x,13],[x-2,11]);line([x,15],[x+2,13]);}break;
      case'Llellwyth':wing(-1);wing(1);path([[10,10],[12,6],[15,8],[12,11],[10,19],[12,23],[14,19],[13,11]]);
        for(const x of[3,7,17,21]){line([x,14],[x,18]);oval(x,19,1,1,true);}break;
      case'Mordicar':for(const y of[5,9,13])line([2,y],[22,y]);line([5,21],[18,6]);line([19,21],[6,6]);
        path([[12,4],[18,6],[21,11]]);path([[3,11],[6,6],[12,4]]);break;
      case'Musydius':path([[3,4],[11,4],[13,10],[7,16],[1,10],[3,4]]);line([3,4],[7,16]);line([11,4],[7,16]);
        path([[12,12],[14,17],[18,18],[21,13]]);line([21,3],[21,22]);break;
      case'Neptar':path([[2,23],[4,13],[5,5],[10,3],[15,6],[14,10],[8,10],[7,16],[10,23]]);
        path([[13,8],[22,8],[17,13],[23,13],[18,20]]);break;
      case'Poena':dragon(12,9,7);for(const x of[4,8,13,18,21])oval(x,19,3,2);line([2,21],[23,21]);break;
      case'Rama':path([[12,23],[3,14],[2,7],[5,3],[9,3],[12,6],[15,3],[19,3],[22,7],[21,14],[12,23]]);flame(12,13);break;
      case'Sharlynn':path([[3,19],[5,6],[11,3],[20,7],[22,17],[17,21],[11,18],[14,14],[19,15],[21,12]]);
        path([[5,6],[9,10],[8,13],[3,11]]);dot(6,10);break;
      case'Sylanos':case'Syluria':oval(12,12,10,10,true);break;
      case'Turthus':oval(11,13,7,8);path([[7,8],[11,6],[15,8],[16,13],[14,18],[10,20],[6,16],[7,8]]);
        path([[8,11],[12,9],[15,12],[12,16],[8,14],[8,11]]);
        for(const[a,b]of[[[8,11],[6,8]],[[12,9],[11,6]],[[15,12],[18,12]],[[12,16],[14,19]],[[8,14],[5,16]]])line(a,b);
        path([[14,6],[15,3],[19,2],[23,5],[19,7],[17,9]]);dot(19,4);
        for(const side of[-1,1]){path([[11+side*6,9],[11+side*10,7],[11+side*9,11]]);path([[11+side*6,17],[11+side*9,21],[11+side*5,20]]);}
        path([[10,21],[7,24],[12,22]]);break;
      case'Uceracea':path([[5,22],[7,14],[6,9],[10,8],[10,4],[13,7],[22,3],[17,10],[21,13],[20,17],[12,16],[11,22]]);dot(14,11);break;
      case'Urthur':path([[2,12],[7,6],[17,6],[22,12],[17,18],[7,18],[2,12]]);oval(12,12,4,5);oval(12,12,1,3,true);break;
      case'Chaoticum':flame(17,9);path([[15,9],[3,22],[10,10],[15,9]]);for(const[x,y]of[[4,4],[19,20],[22,3]]){line([x-1,y],[x+1,y]);line([x,y-1],[x,y+1]);}break;
      case'Nameless Drake':for(let y=2;y<23;y++)for(let x=12-(y-2)/2;x<=12+(y-2)/2;x++)dot(x,y);break;
    }
    const rows=Object.freeze(grid.map(r=>r.join('')));emblems.set(deity,rows);return rows;
  }
  function paint(ctx,value,x,y,size,color,finish){
    if(/^suzerain helmet$/i.test(String(value).trim())){paintSuzerainHelmet(ctx,x+size*.1,y,size*.8,size,finish==='painted'?undefined:color);return true;}
    const grid=bitmap(value);if(!grid)return false;
    const pixel=(xx,yy)=>ctx.fillRect(x+xx*size/grid.length,y+yy*size/grid.length,size/grid.length+.1,size/grid.length+.1);
    if(finish==='painted'&&name(value)==='Atinus'){
      // Keep the colored edging inside the emblem box, including on small mosaics.
      for(let yy=0;yy<grid.length;yy++)for(let xx=0;xx<grid.length;xx++)if(grid[yy][xx]!=='1'&&
        [[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dy])=>grid[yy+dy]?.[xx+dx]==='1')){
        ctx.fillStyle=(xx+yy)%3?'#b25136':'#dfac59';pixel(xx,yy);
      }
    }
    ctx.fillStyle=finish==='painted'&&name(value)==='Atinus'?'#392c2b':color||pantheon[name(value)]?.color||'#b87355';
    grid.forEach((row,yy)=>[...row].forEach((bit,xx)=>{if(bit==='1')pixel(xx,yy);}));
    return true;
  }
  function paintSuzerainHelmet(ctx,x,y,width,height,color){
    ctx.save();ctx.translate(x,y);ctx.scale(width/32,height/40);
    const edge=color||'#bd834c',red=color||'#9d3940',metal=color||'#302c35',light=color||'#8d8278',voidColor='#16171e';
    const poly=(pts,fill,stroke)=>{ctx.beginPath();pts.forEach(([u,v],i)=>i?ctx.lineTo(u,v):ctx.moveTo(u,v));ctx.closePath();ctx.fillStyle=fill;ctx.fill();
      if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.8;ctx.stroke();}};
    poly([[16,1],[9,3],[4,10],[3,24],[1,36],[8,39],[16,37],[24,39],[31,36],[29,24],[28,10],[23,3]],metal,edge);
    for(const side of[-1,1]){
      const pts=rows=>rows.map(([u,v])=>[16+side*u,v]);
      poly(pts([[0,3],[7,5],[11,12],[12,23],[10,33],[4,34],[6,25],[3,19],[0,17]]),metal,light);
      poly(pts([[0,19],[5,14],[12,17],[8,22],[3,25],[1,23]]),voidColor,red);
      poly(pts([[3,25],[8,23],[10,33],[4,35]]),metal,edge);
      poly(pts([[0,36],[4,34],[13,37],[8,38]]),light,edge);
    }
    poly([[16,21],[18,25],[18,34],[16,36],[14,34],[14,25]],voidColor,light);
    paint(ctx,'Suzerain',10,3,12,red);
    ctx.restore();
  }
  function paintSepulchra(ctx,x,y,width,height=width,color){
    const polygon=(points,fill)=>{ctx.fillStyle=fill;ctx.beginPath();points.forEach(([u,v],i)=>i?ctx.lineTo(x+u*width,y+v*height):ctx.moveTo(x+u*width,y+v*height));ctx.closePath();ctx.fill();};
    const edge=color||'#103e34',mid=color||'#23875a',light=color||'#8be4a5',deep=color||'#145741';
    polygon([[.25,0],[.75,0],[1,.25],[1,.72],[.68,1],[.25,.94],[0,.68],[0,.25]],edge);
    polygon([[.27,.08],[.73,.08],[.86,.3],[.69,.76],[.26,.73],[.13,.3]],mid);
    polygon([[.27,.08],[.73,.08],[.65,.23],[.34,.23],[.18,.37],[.13,.3]],light);
    polygon([[.86,.3],[.94,.26],[.94,.68],[.66,.94],[.69,.76]],deep);
    polygon([[.34,.23],[.65,.23],[.76,.38],[.62,.67],[.33,.66],[.23,.39]],color||'#39b578');
    if(!color){ctx.fillStyle='#d8f3bb';ctx.fillRect(x+width*.31,y+height*.25,Math.max(1,width*.09),Math.max(1,height*.19));}
  }
  function toolbox(){return Object.fromEntries(Object.entries(pantheon).map(([n,c])=>[n,{form:c.form,color:c.color,symbol:c.symbolDescription,attribute:c.attribute,weapon:c.weapon,domain:c.domain}]));}
  return { pantheon, name, find, bitmap, paint, paintSepulchra, paintSuzerainHelmet, toolbox };
});
