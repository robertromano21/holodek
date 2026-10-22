(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GenreExpansion = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const VERSION = 'world1-art-expansion-1';
  const family = ['fantasy', 'dark-fantasy', 'mythic'];
  // Each row is a complete visual language, not a palette substituted on a classical city.
  const PROFILES = {
    fantasy: { label: 'Timber guild town', form: 'timber', street: 'winding_lanes', wall: 'timber', floor: 'cobble', hat: 'hood', coat: 'vest', names: ['Watch Gate','Market Ward','Sanctuary Ward','Hearth Row','Guild Quarter','River Quay','Root Cellars'] },
    'dark-fantasy': { label: 'Sepulchral fortress', form: 'ossuary', street: 'winding_lanes', wall: 'bone', floor: 'slate', hat: 'hood', coat: 'robe_hem', names: ['Black Gate','Candle Market','Ossuary Ward','Mourning Row','Iron Guilds','Silent Quay','Burial Vaults'] },
    mythic: { label: 'Sacred marble polis', form: 'classical', street: 'agora_grid', wall: 'fluted', floor: 'mosaic', hat: 'laurel', coat: 'chiton', names: ['Lion Gate','Agora','Sacred Precinct','Courtyard Homes','Artisan Stoa','Harbor Stoa','Cistern Steps'] },
    western: { label: 'False-front frontier', form: 'frontier', street: 'main_street', wall: 'clapboard', floor: 'boardwalk', hat: 'wide_brim', coat: 'duster', names: ['Stage Stop','Main Street','Church Hill','Boarding Row','Smithy Row','Rail Depot','Silver Mine'] },
    'sci-fi': { label: 'Modular pressure habitat', form: 'habitat', street: 'ring_corridor', wall: 'bulkhead', floor: 'grate', hat: 'helmet', coat: 'suit_stripe', names: ['Arrival Lock','Trade Concourse','Memorial Deck','Hab Ring','Fabrication Deck','Docking Ring','Service Underdeck'] },
    cyberpunk: { label: 'Layered neon megablock', form: 'arcology', street: 'alley_grid', wall: 'neon', floor: 'asphalt', hat: 'visor', coat: 'trench', names: ['Checkpoint','Night Market','Neon Chapel','Capsule Stacks','Chop District','Freight Port','Old Metro'] },
    'post-apocalyptic': { label: 'Salvaged scrap settlement', form: 'scrap', street: 'shanty_ring', wall: 'scrap', floor: 'cracked', hat: 'gasmask', coat: 'poncho', names: ['Scrap Gate','Barter Circle','Memory Shelter','Patchwork Homes','Repair Yards','Convoy Depot','Old Bunkers'] },
    steampunk: { label: 'Brass canal foundry', form: 'foundry', street: 'canal_grid', wall: 'rivet', floor: 'cog', hat: 'top', coat: 'greatcoat', names: ['Customs Works','Brass Exchange','Bell Quarter','Terrace Row','Engine Guilds','Canal Docks','Boiler Tunnels'] },
    modern: { label: 'Civic streets and apartments', form: 'civic', street: 'block_grid', wall: 'concrete', floor: 'pavement', hat: 'cap', coat: 'jacket', names: ['Transit Interchange','Shopping District','Community Quarter','Apartment Blocks','Industrial Park','Freight Terminal','Utility Network'] },
    noir: { label: 'Art-deco rain city', form: 'deco', street: 'block_grid', wall: 'deco', floor: 'checker', hat: 'fedora', coat: 'trench', names: ['Station Steps','Old Market','Cathedral Ward','Walk-Up Row','Printworks','Docklands','Service Tunnels'] },
    nautical: { label: 'Stilt harbor and sail lofts', form: 'harbor', street: 'harbor_quay', wall: 'shiplap', floor: 'deck', hat: 'tricorn', coat: 'greatcoat', names: ['Harbor Gate','Fish Market','Mariners Chapel','Sailors Row','Ropemakers Yard','Long Quay','Tide Caves'] },
    'cosmic-horror': { label: 'Crooked drowned masonry', form: 'eldritch', street: 'drowned_lanes', wall: 'organic', floor: 'spiral', hat: 'hood', coat: 'robe_hem', names: ['Tide Gate','Lantern Market','Listening Parish','Shut Houses','Salt Guilds','Drowned Wharf','Deep Galleries'] },
    'gothic-horror': { label: 'Buttressed spires and manors', form: 'gothic', street: 'winding_lanes', wall: 'gothic', floor: 'slate', hat: 'hood', coat: 'greatcoat', names: ['Iron Lychgate','Lamplight Market','Cathedral Close','Manor Row','Bell Founders','Fog Quay','Catacombs'] },
    solarpunk: { label: 'Terraced living glass', form: 'garden', street: 'canal_grid', wall: 'living', floor: 'terracotta', hat: 'sunhat', coat: 'jacket', names: ['Garden Gate','Cooperative Market','Reflection Gardens','Canopy Homes','Repair Commons','Water Transit','Root Works'] },
    dieselpunk: { label: 'Riveted streamlined industry', form: 'diesel', street: 'block_grid', wall: 'diesel', floor: 'grate', hat: 'goggles', coat: 'greatcoat', names: ['Motor Checkpoint','Exchange Hall','Memorial Square','Workers Blocks','Machine Works','Railhead','Engine Vaults'] },
    underwater: { label: 'Pressure domes and reef terraces', form: 'reef', street: 'ring_corridor', wall: 'pressure', floor: 'shell', hat: 'bubble', coat: 'suit_stripe', names: ['Pressure Lock','Pearl Exchange','Coral Sanctuary','Dome Gardens','Current Works','Submersible Docks','Trench Access'] },
    prehistoric: { label: 'Raised lodges and standing stones', form: 'lodge', street: 'shanty_ring', wall: 'wattle', floor: 'earth', hat: 'feather', coat: 'poncho', names: ['Standing Gate','Gathering Circle','Ancestor Stones','Hearth Lodges','Flint Makers','River Landing','Deep Caverns'] },
    'desert-fantasy': { label: 'Wind towers and tiled courtyards', form: 'desert', street: 'winding_lanes', wall: 'adobe', floor: 'star', hat: 'turban', coat: 'robe_hem', names: ['Caravan Gate','Covered Bazaar','Star Sanctuary','Courtyard Homes','Kiln Quarter','Canal Landing','Cool Cisterns'] }
  };
  const PIGMENTS = {
    fantasy: ['#785337','#d4bc8b','#eedba5','#251b17','#e8c39e','#5f843f'],
    'dark-fantasy': ['#534b61','#a69da6','#e4d8b7','#19141e','#d8d4c0','#934669'],
    mythic: ['#dfd9c6','#a29373','#f4ead0','#383240','#c79a52','#497b9b'],
    western: ['#c89558','#795136','#f4d995','#2e211b','#e8c39e','#ad4430'],
    'sci-fi': ['#aebbc6','#3c5364','#82d5eb','#15202b','#e8c39e','#ed8151'],
    cyberpunk: ['#343442','#675879','#f181cf','#141522','#e8c39e','#61d6de'],
    'post-apocalyptic': ['#a17b4c','#594c3a','#dcc68a','#26251c','#c79a52','#7d9b51'],
    steampunk: ['#a37b41','#5d4b37','#eccb7b','#262124','#e8c39e','#539b8e'],
    modern: ['#b3b3a7','#56616a','#e8e6d4','#242c32','#e8c39e','#527995'],
    noir: ['#68646a','#333945','#d6d0b9','#171c27','#e8c39e','#aa5b4f'],
    nautical: ['#a17b52','#3e5364','#e9d29b','#1d2f3d','#e8c39e','#a75b42'],
    'cosmic-horror': ['#446f6d','#283a4a','#80c4ae','#121e27','#d8d4c0','#9882bd'],
    'gothic-horror': ['#655b6c','#393745','#cab9b3','#181922','#e8c39e','#a45864'],
    solarpunk: ['#d5c8a4','#5b8b6a','#f1e4ad','#263e3b','#c79a52','#71bdc5'],
    dieselpunk: ['#7c837c','#434b4f','#d6b16a','#202a30','#e8c39e','#ad553d'],
    underwater: ['#559b9b','#325a75','#a1e2d2','#162f49','#c79a52','#d98e9c'],
    prehistoric: ['#9a784a','#65513a','#ddc68a','#302c24','#c79a52','#7e9d5b'],
    'desert-fantasy': ['#d6ae7c','#986f52','#f0d897','#483041','#c79a52','#4f9d9b']
  };
  const NEW_GENRES = Object.fromEntries(['gothic-horror','solarpunk','dieselpunk','underwater','prehistoric','desert-fantasy'].map(genre => {
    const p = PROFILES[genre];
    return [genre, { palette: PIGMENTS[genre], plans: ['lean','stocky','tall'],
      clothing: { head: ['normal_human','hooded_cowl'], torso: ['tunic','coat_flowing'], legs: ['striding_boots'] },
      gear: ['satchel','backpack','goggles'], held: genre === 'dieselpunk' ? ['rifle','pistol','wrench_mace'] : genre === 'underwater' ? ['harpoon','scanner','lantern_hand'] : genre === 'prehistoric' ? ['spear','sling','throwing_axe'] : ['staff_crook','lantern_hand','scanner'],
      creatures: { 'gothic-horror':['belfry_wraith','crypt_bat','manor_sentinel','grave_hound'], solarpunk:['orchard_keeper','canopy_glider','pollinator_drone','moss_grazer'], dieselpunk:['iron_sentry','engine_crawler','yard_hound','masked_scout'], underwater:['reef_guardian','trench_eel','shell_grazer','kelp_stalker'], prehistoric:['saber_cat','marsh_behemoth','flint_guardian','feathered_hunter'], 'desert-fantasy':['dune_stalker','glass_serpent','sand_sentinel','oasis_guardian'] }[genre],
      props: [`x_${genre}_utility`,`x_${genre}_stall`], building: [`x_${genre}_house`,`x_${genre}_hall`,`x_${genre}_gate`,`x_${genre}_tower`],
      voxel: ['reef','garden'].includes(p.form) ? 'stone' : ['diesel'].includes(p.form) ? 'metal' : 'wood',
      textures: { wall: `x_${genre}_wall`, floor: `x_${genre}_floor` }, lights: genre === 'dieselpunk' ? ['oil_lantern','fluorescent'] : genre === 'underwater' || genre === 'solarpunk' ? ['crystal_glow','fluorescent'] : ['oil_lantern','candle'] }];
  }));
  const ALIASES = { 'solar punk':'solarpunk', 'diesel punk':'dieselpunk', undersea:'underwater', 'stone age':'prehistoric', 'desert fantasy':'desert-fantasy', 'gothic-horror':'gothic-horror' };
  const ROLES = ['house','hall','gate','tower','column','shrine','stall','utility'];
  const SHAPES = Object.fromEntries(Object.keys(PROFILES).flatMap(genre => ROLES.map(role => [`x_${genre}_${role}`, { genre, role, cotg: family.includes(genre), footprint: ['house','hall'].includes(role) ? [3,3] : role === 'gate' ? [3,1] : [1,1], height: ['hall','tower'].includes(role) ? 5 : role === 'house' ? 3.5 : role === 'column' ? 3 : 2.5 }])));
  const COTG = { funerary_stoa:'mythic', ossuary_arcade:'dark-fantasy', sepulchral_pylon:'dark-fantasy', ribbed_buttress:'dark-fantasy', basalt_ziggurat:'dark-fantasy', bone_reliquary:'dark-fantasy', memorial_rotunda:'mythic', mourning_gate:'dark-fantasy' };
  for (const [name,genre] of Object.entries(COTG)) SHAPES[`x_${name}`] = { genre, role:name, cotg:true, footprint:['ribbed_buttress','bone_reliquary'].includes(name)?[1,1]:[3,2], height:4 };
  const has = name => Object.prototype.hasOwnProperty.call(SHAPES,name);
  function build(name, size = 24) {
    if (!has(name) || !Number.isInteger(size) || size < 8 || size > 64) return null;
    const { genre,role } = SHAPES[name], form = PROFILES[genre].form, v = new Uint8Array(size ** 3);
    const box = (x0,y0,z0,x1,y1,z1,on=1) => {
      for(let z=Math.max(0,Math.floor(z0*size));z<Math.min(size,Math.ceil(z1*size));z++)
        for(let y=Math.max(0,Math.floor(y0*size));y<Math.min(size,Math.ceil(y1*size));y++)
          for(let x=Math.max(0,Math.floor(x0*size));x<Math.min(size,Math.ceil(x1*size));x++)v[x+y*size+z*size*size]=on;
    };
    const cyl=(cx,cy,r,z0,z1,on=1)=>{for(let z=Math.floor(z0*size);z<Math.min(size,Math.ceil(z1*size));z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(Math.hypot((x+.5)/size-cx,(y+.5)/size-cy)<=r)v[x+y*size+z*size*size]=on;};
    const dome=(z0,r=.46)=>{for(let z=z0;z<1;z+=1/size)cyl(.5,.53,r*Math.sqrt(Math.max(0,1-((z-z0)/(1-z0))**2)),z,z+1/size);};
    const roof=(base,top,inset=0)=>{for(let z=base;z<top;z+=1/size){const t=(z-base)/(top-base);box(inset,.02+t*.44,z,1-inset,.98-t*.44,z+1/size);}};
    const arch=(x0,x1,y0,y1,spring,top)=>{box(x0,y0,0,x1,y1,spring,0);for(let z=spring;z<top;z+=1/size){const t=(z-spring)/(top-spring),w=(x1-x0)/2*Math.sqrt(Math.max(0,1-t*t));box(.5-w,y0,z,.5+w,y1,z+1/size,0);}};
    const windows=()=>{for(let x=.16;x<.9;x+=.22)for(let z=.32;z<.72;z+=.25)box(x,0,z,x+.08,.1,z+.13,0);};
    if(role==='column'){box(.18,.18,0,.82,.82,.1);cyl(.5,.5,.18,.1,.86);box(.12,.12,.86,.88,.88,.98);if(['ossuary','gothic','classical'].includes(form))for(let x=.3;x<.8;x+=.12)box(x,.27,.18,x+.04,.35,.8,0);return v;}
    if(role==='stall'){box(.08,.12,0,.14,.86,.8);box(.86,.12,0,.92,.86,.8);box(.12,.5,.28,.88,.86,.4);roof(.8,.98);return v;}
    if(role==='utility'){cyl(.5,.5,.3,.1,.65);box(.42,.42,0,.58,.58,.95);if(['habitat','diesel','foundry'].includes(form)){box(.12,.12,.65,.88,.88,.72);box(.45,.45,.9,.55,.55,1);}else{for(let i=0;i<4;i++){const a=i*Math.PI/2;box(.45+Math.cos(a)*.3,.45+Math.sin(a)*.3,.7,.55+Math.cos(a)*.3,.55+Math.sin(a)*.3,.84);}}return v;}
    if(role==='basalt_ziggurat'){for(let i=0;i<5;i++)box(i*.08,i*.08,i*.17,1-i*.08,1-i*.08,(i+1)*.17);box(.42,.0,0,.58,.5,.86);return v;}
    if(role==='ribbed_buttress'){for(let i=0;i<5;i++)box(.1+i*.12,.1,0,.25+i*.12,.9,1-i*.16);return v;}
    if(role==='bone_reliquary'){box(.1,.2,0,.9,.8,.12);box(.2,.3,.12,.8,.7,.7);box(.1,.2,.7,.9,.8,.8);for(let x=.25;x<.8;x+=.18){cyl(x,.28,.045,.15,.72);cyl(x,.72,.045,.15,.72);}return v;}
    if(['funerary_stoa','ossuary_arcade'].includes(role)){box(0,.5,0,1,.95,.7);for(let x=.04;x<1;x+=.18)cyl(x,.18,.045,0,.75);box(0,.02,.75,1,.98,.86);roof(.86,1);if(role==='ossuary_arcade')for(let x=.08;x<.9;x+=.18)box(x,.45,.15,x+.07,.55,.28,0);return v;}
    if(role==='memorial_rotunda'){cyl(.5,.5,.44,0,.64);cyl(.5,.5,.32,.05,.64,0);dome(.65);box(.4,0,0,.6,.3,.5,0);return v;}
    if(['gate','mourning_gate','sepulchral_pylon'].includes(role)){
      box(.02,.12,0,.28,.88,.95);box(.72,.12,0,.98,.88,.95);box(.28,.22,.64,.72,.78,.91);
      if(['habitat','arcology','reef'].includes(form)){box(.08,.06,.8,.92,.94,.87);box(.38,.2,0,.62,.8,.7,0);}else arch(.28,.72,.1,.9,.48,.8);
      if(['frontier','lodge'].includes(form)){box(0,.3,.9,1,.7,.98);box(.02,.22,.7,.98,.78,.78);}
      if(role==='sepulchral_pylon')for(let i=0;i<4;i++)box(.04+i*.02,.14+i*.02,.6+i*.09,.26-i*.02,.86-i*.02,.7+i*.09);
      return v;
    }
    if(role==='tower'){
      if(['habitat','reef','desert'].includes(form)){cyl(.5,.5,.31,0,.8);dome(.8,.36);}
      else{box(.18,.18,0,.82,.82,.78);windows();if(['gothic','ossuary','eldritch'].includes(form)){roof(.76,1,.12);box(.45,.45,.9,.55,.55,1);}else{box(.08,.08,.72,.92,.92,.8);box(.25,.25,.8,.75,.75,.9);}}
      if(['diesel','foundry','civic','deco'].includes(form))box(.62,.6,.8,.72,.7,1);
      return v;
    }
    if(role==='shrine'){box(.08,.08,0,.92,.92,.15);for(const x of[.15,.8])box(x,.5,.15,x+.06,.7,.8);box(.12,.45,.8,.88,.75,.9);cyl(.5,.6,.12,.15,.7);return v;}
    box(.08,.12,0,.92,.94,.7);box(.17,.21,.05,.83,.85,.65,0);windows();box(.41,0,0,.59,.24,.42,0);
    switch(form){
      case 'frontier':
        roof(.68,.9,.04);box(.04,.06,.64,.96,.15,.99);box(0,0,0,1,.18,.07);box(0,.0,.55,1,.25,.61);
        for(const x of[.06,.9])box(x,.04,.06,x+.04,.12,.58);box(.2,.02,.74,.8,.08,.86);break;
      case 'timber': roof(.68,1);for(const x of[.08,.48,.87])box(x,.06,0,x+.05,.16,.7);break;
      case 'classical': box(.02,.02,0,.98,.98,.12);for(let x=.08;x<1;x+=.17)cyl(x,.12,.04,.12,.72);roof(.76,.98);box(0,0,.71,1,1,.78);break;
      case 'ossuary': case 'gothic':
        roof(.68,.99,.03);for(const x of[.02,.9]){box(x,.1,0,x+.08,.9,.82);box(x+.02,.12,.82,x+.06,.24,.98);}for(let x=.24;x<.8;x+=.19)box(x,.07,.5,x+.04,.13,.87);
        if(form==='ossuary'){box(.06,.02,.2,.94,.1,.27);for(let x=.2;x<.9;x+=.16)cyl(x,.1,.05,.3,.45);}break;
      case 'habitat':
        box(0,.07,.65,1,1,.73);for(const x of[.04,.88])box(x,.05,.1,x+.08,.97,.8);box(.2,.2,.73,.8,.8,.8);box(.35,.35,.8,.65,.65,.85);break;
      case 'arcology':
        box(.12,.18,.7,.88,.92,.87);box(.24,.26,.87,.76,.84,.98);for(let z=.22;z<.95;z+=.2)box(.02,.02,z,.98,.16,z+.045);box(.7,0,.5,.95,.06,.83);break;
      case 'scrap':
        box(.02,.02,.68,.98,.95,.74);box(.18,.12,.74,.8,.9,.82);box(.75,.15,.2,.95,.7,.68);for(let x=.2;x<.9;x+=.15)box(x,.06,.2,x+.035,.13,.68);break;
      case 'foundry': case 'diesel':
        roof(.7,.87);for(const x of[.12,.76])cyl(x,.77,.07,.6,1);box(.13,.08,.44,.87,.15,.5);box(.7,.04,.18,.85,.16,.44);if(form==='diesel'){box(.2,.25,.87,.8,.85,.94);box(.28,.33,.94,.72,.77,1);}break;
      case 'civic': case 'deco':
        box(.03,.07,.7,.97,.97,.76);box(.14,.2,.76,.86,.94,.94);windows();if(form==='deco'){for(let i=0;i<3;i++)box(.32+i*.04,.1,.7+i*.09,.68-i*.04,.9,.81+i*.09);}break;
      case 'harbor':
        box(0,.02,.15,1,1,.21);for(const x of[.08,.84])box(x,.12,0,x+.06,.92,.4);roof(.7,.97);box(.1,.02,.45,.9,.2,.5);break;
      case 'eldritch':
        roof(.7,.97,.04);box(.05,.04,.2,.14,.24,.98);box(.78,.1,.35,.9,.2,.89);for(let i=0;i<5;i++)box(.18+i*.13,.02,.25+i*.06,.24+i*.13,.13,.52+i*.05);break;
      case 'garden':
        for(let i=0;i<3;i++){box(.04+i*.1,.04+i*.12,.68+i*.09,.96-i*.1,.98,.74+i*.09);for(let x=.1+i*.1;x<.9-i*.1;x+=.13)box(x,.1+i*.12,.74+i*.09,x+.06,.2+i*.12,.81+i*.09);}break;
      case 'reef': dome(.68);for(const x of[.02,.86])cyl(x+.05,.54,.06,0,.74);box(.2,.04,.45,.8,.12,.52);break;
      case 'lodge':
        roof(.52,.98);box(.1,.1,.5,.9,.9,.65);for(let x=.12;x<.9;x+=.14)box(x,.08,0,x+.045,.18,.58);break;
      case 'desert':
        dome(.7,.38);box(.02,.08,.65,.98,.98,.72);box(.72,.68,.7,.9,.86,1);box(.76,.7,.82,.86,.84,.95,0);break;
    }
    if(role==='hall'){box(0,.12,0,.08,.94,.65);box(.92,.12,0,1,.94,.65);box(.3,0,.38,.7,.16,.45);}
    return v;
  }
  function color(name,x,y,z,normal) {
    const info=SHAPES[name];if(!info)return null;
    const p=PIGMENTS[info.genre], edge=z>.7 || Math.abs(y-.1)<.04, hex=p[edge?2:Math.floor(x*24)%7===0?1:0];
    const shade=normal[2]>.5?1.05:normal[0]+normal[1]>0?.9:.72;
    return [1,3,5].map(i=>Math.max(0,Math.min(1,parseInt(hex.slice(i,i+2),16)/255*shade)));
  }
  const MAT={},WALL={},FLOOR={},STYLES={},GARB={};
  for(const [genre,p]of Object.entries(PROFILES)){
    const c=PIGMENTS[genre], wall=`x_${genre}_wall`, floor=`x_${genre}_floor`, door=`x_${genre}_door`;
    MAT[wall]=MAT[floor]=MAT[door]=[c[0],c[1],c[2],c[3]];
    WALL[wall]=(P,C,r)=>{
      P.fill(C[0]);
      if(['clapboard','timber','shiplap','wattle'].includes(p.wall)){
        for(let y=0;y<32;y+=4){P.rect(0,y,32,1,C[2]);P.rect(0,y+3,32,1,C[1]);}
        for(let x=0;x<32;x+=p.wall==='wattle'?3:16)P.rect(x,0,1,32,C[3]);
        if(p.wall==='timber')for(let i=0;i<30;i++)P.rect(i,i,2,1,C[1]);
      }else if(['bulkhead','pressure','rivet','diesel','neon','scrap'].includes(p.wall)){
        for(let y=0;y<32;y+=16)for(let x=0;x<32;x+=16){P.rect(x,y,15,15,C[1]);P.rect(x+1,y+1,13,12,C[0]);P.px(x+2,y+2,C[2]);P.px(x+12,y+12,C[3]);}
        if(['bulkhead','pressure','neon'].includes(p.wall)){P.rect(3,6,10,2,c[5]);P.rect(18,22,10,2,c[5]);}
        if(p.wall==='diesel'||p.wall==='scrap')for(let i=0;i<32;i+=4)P.rect(i,29,2,2,C[2]);
      }else if(p.wall==='organic'||p.wall==='living'){
        for(let i=0;i<4;i++)for(let y=0;y<32;y++){const x=i*8+Math.round(2*Math.sin(y*.4+i));P.rect(x,y,2,1,p.wall==='living'?c[5]:C[1]);}
        for(let i=0;i<14;i++)P.rect(r()*32,r()*32,2,2,C[2]);
      }else{
        for(let y=0;y<32;y+=8){P.rect(0,y,32,1,C[3]);for(let x=(y%16?8:0);x<32;x+=16)P.rect(x,y,1,8,C[1]);}
        if(['gothic','bone','fluted','deco'].includes(p.wall))for(let x=3;x<32;x+=8){P.rect(x,2,2,28,C[2]);P.rect(x+2,2,1,28,C[1]);}
        if(p.wall==='bone')for(let x=5;x<32;x+=8){P.rect(x,10,4,4,C[2]);P.px(x+1,11,C[3]);P.px(x+3,11,C[3]);}
        if(p.wall==='adobe')for(let i=0;i<75;i++)P.px(r()*32,r()*32,r()<.5?C[1]:C[2]);
      }
    };
    WALL[door]=(P,C,r)=>{P.fill(C[3]);WALL[wall](P,C,r);P.rect(0,0,2,32,C[1]);P.rect(30,0,2,32,C[1]);P.rect(0,0,32,2,C[2]);P.rect(25,16,3,2,C[2]);if(['habitat','reef','diesel'].includes(p.form)){P.rect(15,2,2,28,C[3]);P.rect(4,26,24,2,c[5]);}};
    FLOOR[floor]=(P,C,r)=>{
      P.fill(C[0]);
      if(['boardwalk','deck'].includes(p.floor)){for(let x=0;x<32;x+=5){P.rect(x,0,1,32,C[3]);P.px(x+2,5,C[1]);P.px(x+2,25,C[1]);}}
      else if(p.floor==='grate'){P.fill(C[3]);for(let y=0;y<32;y+=4)for(let x=0;x<32;x+=4)P.rect(x,y,3,3,C[1]);P.rect(0,14,32,2,C[2]);}
      else if(['cobble','slate','pavement','terracotta','checker','star','mosaic'].includes(p.floor)){
        for(let y=0;y<32;y+=8)for(let x=0;x<32;x+=8){P.rect(x+1,y+1,7,7,p.floor==='checker'&&(x+y)%16?C[3]:C[(x/8+y/8)%2]);
          if(['mosaic','star'].includes(p.floor)){P.rect(x+3,y+2,2,4,c[5]);P.rect(x+2,y+3,4,2,c[5]);}else P.px(x+2,y+2,C[2]);}
      }else if(p.floor==='cog'||p.floor==='spiral'||p.floor==='shell'){
        for(let y=8;y<32;y+=16)for(let x=8;x<32;x+=16)for(let i=0;i<32;i++){const a=i*.4,radius=p.floor==='spiral'?i*.18:5;P.px(x+Math.cos(a)*radius,y+Math.sin(a)*radius,C[2]);}
      }else{for(let i=0;i<160;i++)P.px(r()*32,r()*32,C[r()<.5?1:2]);if(p.floor==='asphalt')P.rect(0,28,32,1,c[5]);if(p.floor==='cracked')for(let y=0;y<32;y++)P.px(12+Math.round(3*Math.sin(y*.4)),y,C[3]);}
    };
    const window=['habitat','reef','foundry'].includes(p.form)?'porthole':['gothic','ossuary'].includes(p.form)?'lancet':['arcology'].includes(p.form)?'neon':'sash';
    STYLES[genre]={label:p.label,wall,floor,door,ceiling:['frontier','harbor','timber','lodge'].includes(p.form)?'wood':'stone',window,trim:['habitat','arcology','diesel'].includes(p.form)?'hazard':p.form==='harbor'?'rope':p.form==='classical'?'meander':'cornice',shapes:[['habitat','reef'].includes(p.form)?'corridor_grid':p.form==='lodge'?'shanty_ring':p.form==='classical'?'temple_court':'storefront'],street:p.street,props:[`x_${genre}_utility`,`x_${genre}_column`],zones:{street:{wall,floor,shape:['frontier','arcology'].includes(p.form)?'main_street':'storefront'},mine:{shape:'mine_tunnel',window:null},church:{shape:p.form==='gothic'?'church_nave':'hall'},house:{shape:'storefront'}}};
    GARB[genre]=[{hat:p.hat,coat:p.coat,belt:genre==='western'?'gunbelt':genre==='nautical'?'sash':'tool',genre},{hat:p.hat,coat:['frontier','ossuary','deco'].includes(p.form)?'vest':p.coat,belt:'tool',genre}];
  }
  const imageVoxels=new Map();
  function paintVoxels(ctx,frame,x,y,w,h,pigments){
    const n=frame.size,W=n*4+2,H=n*4+2,data=new Uint8ClampedArray(W*H*4),faces=[];
    const occupied=(a,b,c)=>a>=0&&a<n&&b>=0&&b<n&&c>=0&&c<n&&frame.voxels[a+b*n+c*n*n];
    const project=(a,b,c)=>[(a-b+n)*2,(n*4-a-b-c*2)];
    for(let z=0;z<n;z++)for(let yy=0;yy<n;yy++)for(let xx=0;xx<n;xx++){
      const i=xx+yy*n+z*n*n;if(!frame.voxels[i])continue;
      const rgb=frame.colors?[0,1,2].map(k=>frame.colors[i*3+k]*255):[1,3,5].map(k=>parseInt(pigments[z>n*.72?1:0].slice(k,k+2),16));
      if(!occupied(xx-1,yy,z))faces.push({depth:z-xx-yy,points:[[xx,yy,z],[xx,yy+1,z],[xx,yy+1,z+1],[xx,yy,z+1]],rgb,shade:.73});
      if(!occupied(xx,yy-1,z))faces.push({depth:z-xx-yy+.1,points:[[xx,yy,z],[xx+1,yy,z],[xx+1,yy,z+1],[xx,yy,z+1]],rgb,shade:.92});
      if(!occupied(xx,yy,z+1))faces.push({depth:z-xx-yy+.2,points:[[xx,yy,z+1],[xx+1,yy,z+1],[xx+1,yy+1,z+1],[xx,yy+1,z+1]],rgb,shade:1.12});
    }
    faces.sort((a,b)=>a.depth-b.depth);
    for(const face of faces){
      const points=face.points.map(p=>project(...p)),lo=Math.max(0,Math.min(...points.map(p=>p[1]))),hi=Math.min(H-1,Math.max(...points.map(p=>p[1])));
      const col=face.rgb.map(v=>Math.max(0,Math.min(255,Math.round(v*face.shade))));
      for(let py=lo;py<=hi;py++){
        const intersections=[];
        for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4];if((a[1]<=py+.5&&b[1]>py+.5)||(b[1]<=py+.5&&a[1]>py+.5))intersections.push(a[0]+(py+.5-a[1])*(b[0]-a[0])/(b[1]-a[1]));}
        intersections.sort((a,b)=>a-b);
        for(let px=Math.max(0,Math.ceil(intersections[0]||0));px<Math.min(W,Math.ceil(intersections[1]||0));px++){const i=(px+py*W)*4;data[i]=col[0];data[i+1]=col[1];data[i+2]=col[2];data[i+3]=255;}
      }
    }
    let l=W,t=H,r=0,b=0;
    for(let py=0;py<H;py++)for(let px=0;px<W;px++)if(data[(px+py*W)*4+3]){l=Math.min(l,px);r=Math.max(r,px);t=Math.min(t,py);b=Math.max(b,py);}
    const scale=Math.min(w/Math.max(1,r-l+1),h/Math.max(1,b-t+1)),ox=x+(w-(r-l+1)*scale)/2,oy=y+h-(b-t+1)*scale;
    for(let py=t;py<=b;py++)for(let px=l;px<=r;px++){
      const i=(px+py*W)*4;if(!data[i+3])continue;ctx.fillStyle=`rgb(${data[i]},${data[i+1]},${data[i+2]})`;
      ctx.fillRect(Math.round(ox+(px-l)*scale),Math.round(oy+(py-t)*scale),Math.max(1,Math.ceil(scale)),Math.max(1,Math.ceil(scale)));
    }
    return true;
  }
  function paint(ctx,name,x,y,w,h,colors){
    if(!has(name))return false;
    if(!imageVoxels.has(name))imageVoxels.set(name,build(name,24));
    return paintVoxels(ctx,{size:24,voxels:imageVoxels.get(name)},x,y,w,h,colors||PIGMENTS[SHAPES[name].genre]);
  }
  return {VERSION,PROFILES,PIGMENTS,NEW_GENRES,ALIASES,SHAPES,COTG,ROLES,has,build,color,paint,paintVoxels,MAT,WALL,FLOOR,STYLES,GARB};
});
