(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GenreFixtures = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const VERSION = 1;
  // Silhouette, luminous color and behavior are asset data shared by every backend.
  const THEMES = {
    fantasy: [['runic sconce','runes','#84edcf'],['amber lantern','cage','#ffd486'],['levitating crystal','crystal','#a8dfff']],
    'dark-fantasy': [['soul cage','cage','#b2f9bf'],['bone votive','prongs','#ffb276'],['blood reliquary','eye','#ff6377']],
    mythic: [['sun disc','disc','#ffe7a1'],['moon tripod','bowl','#bbd9ff'],['sacred flame niche','prongs','#ffbc72']],
    'sci-fi': [['service strip','strip','#cef4ff'],['reactor status bars','bars','#72ffc8'],['docking signal','beacon','#ff9670']],
    cyberpunk: [['cyan neon brackets','brackets','#67f1ff'],['magenta tube bank','bars','#ff8bd4'],['acid signage','strip','#d9ff77']],
    'post-apocalyptic': [['salvaged tube','strip','#e6efac'],['barrel fire cage','cage','#ffad65'],['rad monitor','eye','#9aff8e']],
    steampunk: [['copper arc cage','cage','#b3e8ff'],['pressure globe','globe','#ffe0a0'],['coil discharge','bars','#98cfff']],
    western: [['railroad signal','beacon','#ffb46c'],['saloon oil sconce','cage','#ffe4a0'],['milk glass globe','globe','#fff0c8']],
    modern: [['utility panel','strip','#e3f4ff'],['exit sign','bars','#9bffd0'],['porch globe','globe','#ffe2ad']],
    noir: [['deco fan lamp','fan','#ffe0a5'],['motel neon','brackets','#ff9c80'],['caged alley bulb','cage','#e4dcba']],
    nautical: [['brass ship lantern','cage','#ffd798'],['port running light','beacon','#ff8f88'],['starboard running light','beacon','#8dffc1']],
    'cosmic-horror': [['watching pearl','eye','#9effd9'],['impossible resonator','runes','#b8b5ff'],['submerged votive','crystal','#7be5ff']],
    'gothic-horror': [['iron candle crown','prongs','#ffe4aa'],['rose window lamp','disc','#ff9fab'],['spectral lantern','cage','#a9e3ff']],
    solarpunk: [['petal lamp','fan','#fff1b0'],['algae light vessel','globe','#a0ffd2'],['solar wayfinding','bars','#a4ebff']],
    dieselpunk: [['armored floodlight','disc','#ffe8bd'],['factory tube bank','bars','#bfeaff'],['amber convoy beacon','beacon','#ffb05b']],
    underwater: [['pressure globe','globe','#a8edff'],['reef biolume','prongs','#89ffd5'],['abyssal lure','eye','#c6bbff']],
    prehistoric: [['resin fire basket','bowl','#ffbf75'],['ember stone niche','runes','#ff9969'],['firefly reed cage','cage','#e7ff9c']],
    'desert-fantasy': [['pierced star lantern','cage','#ffda8b'],['turquoise glass niche','disc','#8bf2df'],['astral prism','crystal','#b0d3ff']]
  };
  const SHAPES = {}, TYPES = {};
  for (const [genre, rows] of Object.entries(THEMES)) rows.forEach(([label, model, color], index) => {
    const id = `l_${genre}_${index}`, type = `fixture_${genre}_${index}`;
    SHAPES[id] = { genre, role: 'light', label, model, color, lightType: type, fixture: true, furnishing: true,
      cotg: ['fantasy','dark-fantasy','mythic'].includes(genre), footprint: [1,1], height: 1.2 };
    TYPES[type] = { label, prop: id, color, radius: model === 'strip' || model === 'disc' ? 1.3 : 1,
      falloff: 'soft', genres: [genre], cotg: SHAPES[id].cotg,
      curve: (q,t) => .92 + .055 * Math.sin(t * (model === 'beacon' ? 1.7 : .65) + q * 6) };
  });
  const has = id => Object.hasOwn(SHAPES, id);
  function parts(id) {
    const info = SHAPES[id]; if (!info) return [];
    const boxes = [], box = (x,y,z,a,b,c,m=1) => boxes.push({ x,y,z,a,b,c,m });
    box(.25,.65,.08,.75,.8,.92); // The backplate never pretends to be a floor lamp.
    const core = (x,z,a,c) => box(x,.3,z,a,.62,c,2);
    switch(info.model) {
      case 'strip': box(.06,.35,.3,.94,.7,.7); core(.12,.4,.88,.6); break;
      case 'bars': for(const x of [.2,.44,.68]) { box(x-.04,.35,.18,x+.16,.7,.88); core(x,.25,x+.12,.8); } break;
      case 'brackets': for(const x of [.12,.75]) { core(x,.2,x+.13,.88); core(x===.12?x:x-.15,.2,x===.12?x+.28:x+.13,.31); } break;
      case 'cage': box(.16,.24,.17,.84,.72,.25);box(.12,.22,.77,.88,.74,.86);core(.28,.28,.72,.75);
        for(const x of [.19,.46,.73])box(x,.22,.24,x+.06,.3,.77);break;
      case 'prongs': box(.12,.4,.3,.88,.6,.4); for(const x of [.18,.46,.74]){box(x,.42,.36,x+.08,.57,.66);core(x-.025,.66,x+.1,.88);}break;
      case 'bowl': box(.16,.32,.25,.84,.7,.4);box(.24,.35,.17,.76,.65,.25);for(const x of [.24,.45,.65])core(x,.4,x+.12,.7+(x===.45?.2:0));break;
      case 'runes': for(const [x,z] of [[.2,.2],[.58,.3],[.35,.57]]){box(x-.05,.37,z-.05,x+.25,.68,z+.28);core(x,z,x+.14,z+.22);}break;
      case 'fan': for(let i=0;i<5;i++){const x=.12+i*.16;core(x,.45,x+.13,.86-Math.abs(i-2)*.1);}box(.42,.4,.15,.58,.6,.48);break;
      case 'crystal': for(let i=0;i<7;i++){const w=.1+.24*(1-Math.abs(i-3)/3);core(.5-w,.15+i*.1,.5+w,.27+i*.1);}break;
      case 'eye': box(.1,.34,.35,.9,.7,.7);core(.23,.39,.77,.65);box(.45,.25,.38,.55,.34,.66);core(.47,.49,.53,.57);break;
      case 'beacon': box(.22,.32,.12,.78,.72,.23);box(.16,.32,.79,.84,.72,.88);core(.29,.25,.71,.78);box(.46,.25,.26,.54,.32,.78);break;
      case 'disc': for(let i=0;i<7;i++){const w=Math.sqrt(Math.max(0,1-((i-3)/3.5)**2))*.36;core(.5-w,.18+i*.095,.5+w,.28+i*.095);}break;
      default: core(.28,.3,.72,.74);box(.36,.38,.21,.64,.66,.3);box(.36,.38,.74,.64,.66,.83);
    }
    return boxes;
  }
  const cache = new Map();
  function geometry(id) { if (!cache.has(id)) cache.set(id,parts(id)); return cache.get(id); }
  function material(id,x,y,z) { let m=0;for(const b of geometry(id))if(x>=b.x&&x<=b.a&&y>=b.y&&y<=b.b&&z>=b.z&&z<=b.c)m=b.m;return m; }
  function build(id,size=24) {
    if(!has(id)||!Number.isInteger(size)||size<8||size>64)return null;
    const voxels=new Uint8Array(size**3);
    for(const b of geometry(id))for(let z=Math.floor(b.z*size);z<Math.ceil(b.c*size);z++)
      for(let y=Math.floor(b.y*size);y<Math.ceil(b.b*size);y++)for(let x=Math.floor(b.x*size);x<Math.ceil(b.a*size);x++)voxels[x+y*size+z*size*size]=1;
    return voxels;
  }
  const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  function color(id,x,y,z,normal=[0,0,1]) {
    const info=SHAPES[id];if(!info)return null;
    const glow=rgb(info.color), luminous=material(id,x,y,z)===2;
    return luminous ? glow.map(v=>.28+.72*v) : glow.map(v=>(.12+.16*v)*(normal[2]>.5?1.2:.8));
  }
  function select(genre,seed=0) { const rows=THEMES[genre];return rows ? SHAPES[`l_${genre}_${Math.abs(seed>>>0)%rows.length}`] : null; }
  const emitters=Object.create(null);
  for(const [shape,info] of Object.entries(SHAPES))emitters[shape]=Object.freeze({type:info.lightType,z:.55,color:info.color});
  for(const [genre,rows] of Object.entries(THEMES))emitters[`f_${genre}_light`]=Object.freeze({type:`fixture_${genre}_0`,z:.85,color:rows[0][2]});
  const emission = shape => typeof shape === 'string' ? emitters[shape] || null : null;
  return { VERSION, THEMES, SHAPES, TYPES, has, build, color, material, select, emission, rgb };
});
