(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShrineIconography = api;
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  // Compact visual index of the pantheon in retortWithUserInput's campaign prompt.
  const pantheon = {
    Mortacia: { form:'human', wings:'skeletal', hair:'blonde', symbol:'winged_lady', color:'#eee7ce', domain:'death, memory, ancestors; tall White Lady with blonde hair and skeletal dragon wings' },
    Atinus: { form:'dragon', symbol:'skull', color:'#ad674d', domain:'Wardrake; war, strategy, honor; draconic skull' },
    Arithus: { form:'dragon', symbol:'dagger', color:'#a34a3e', domain:'Kinslayer; vengeance, kinstrife; fists gripping a downward dagger' },
    Atricles: { form:'dragon', symbol:'eye', color:'#a4aa9a', domain:'Ringdrake; justice and balance; banded agate dragon' },
    Chaoticum: { form:'dragon', symbol:'flame', color:'#e59946', domain:'chaos and destruction; fireball through stars' },
    Dantuea: { form:'dragon', symbol:'serpent', color:'#594d66', domain:'Darkdrake; obsidian dragon, corruption and undeath' },
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
    Turthus: { form:'dragon', symbol:'turtle', color:'#939887', domain:'wisdom and texts; stone turtle shell' },
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
    Atricles:{build:'slender',horns:'curved',markings:'stripes'},Chaoticum:{build:'heavy',wings:'flame',spikes:true},
    Dantuea:{build:'slender',wings:'bone',covering:'bone',markings:'cracks'},Dyanetzia:{build:'heavy',horns:'antlers',wings:'none',tail:'thick'},
    Eredine:{build:'slender',horns:'antlers',markings:'runes'},Krystalynn:{build:'slender',horns:'nubs',spikes:true,markings:'cracks'},
    Leona:{build:'slender',horns:'antlers',wings:'none',tail:'thin',covering:'bark'},Llellwyth:{build:'slender',wings:'flame',horns:'none'},
    Mordicar:{build:'heavy',horns:'ram',wings:'none',covering:'stone'},Musydius:{build:'slender',horns:'curved',wings:'feather'},
    Neptar:{build:'slender',horns:'long',tail:'scaled'},Poena:{build:'slender',horns:'none',wings:'spectral'},
    Rama:{build:'heavy',horns:'long',wings:'flame'},Sharlynn:{build:'slender',horns:'nubs',tail:'thick',claws:true},
    Sylanos:{build:'slender',horns:'curved',wings:'feather',markings:'none'},Syluria:{build:'slender',horns:'antlers',wings:'bat'},
    Turthus:{build:'heavy',horns:'none',wings:'none',tail:'thick',covering:'stone'},Uceracea:{build:'slender',horns:'crown',wings:'feather'},
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
    const deity=name(value);if(!deity)return null;
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
      case'Mortacia':oval(12,5,2,2,true);path([[12,8],[8,21],[16,21],[12,8]]);wing(-1,true);wing(1,true);break;
      case'Atinus':path([[4,7],[2,2],[9,5],[15,5],[22,2],[20,7],[19,16],[16,20],[8,20],[5,16],[4,7]]);
        oval(8,11,2,2,true);oval(16,11,2,2,true);path([[10,16],[12,14],[14,16]]);for(const x of[8,11,14,17])line([x,18],[x,22]);break;
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
      case'Turthus':oval(12,12,9,10);path([[7,7],[12,4],[17,7],[17,17],[12,20],[7,17],[7,7]]);line([7,12],[17,12]);line([12,4],[12,20]);
        for(const [x,y]of[[5,8],[5,17],[19,8],[19,17]])oval(x,y,1,1,true);break;
      case'Uceracea':path([[5,22],[7,14],[6,9],[10,8],[10,4],[13,7],[22,3],[17,10],[21,13],[20,17],[12,16],[11,22]]);dot(14,11);break;
      case'Urthur':path([[2,12],[7,6],[17,6],[22,12],[17,18],[7,18],[2,12]]);oval(12,12,4,5);oval(12,12,1,3,true);break;
      case'Chaoticum':flame(17,9);path([[15,9],[3,22],[10,10],[15,9]]);for(const[x,y]of[[4,4],[19,20],[22,3]]){line([x-1,y],[x+1,y]);line([x,y-1],[x,y+1]);}break;
      case'Nameless Drake':for(let y=2;y<23;y++)for(let x=12-(y-2)/2;x<=12+(y-2)/2;x++)dot(x,y);break;
    }
    const rows=Object.freeze(grid.map(r=>r.join('')));emblems.set(deity,rows);return rows;
  }
  function paint(ctx,value,x,y,size,color){
    const grid=bitmap(value);if(!grid)return false;
    ctx.fillStyle=color||pantheon[name(value)].color;
    grid.forEach((row,yy)=>[...row].forEach((bit,xx)=>{if(bit==='1')ctx.fillRect(x+xx*size/grid.length,y+yy*size/grid.length,size/grid.length+.1,size/grid.length+.1);}));
    return true;
  }
  function toolbox(){return Object.fromEntries(Object.entries(pantheon).map(([n,c])=>[n,{form:c.form,color:c.color,symbol:c.symbolDescription,attribute:c.attribute,weapon:c.weapon,domain:c.domain}]));}
  return { pantheon, name, find, bitmap, paint, toolbox };
});
