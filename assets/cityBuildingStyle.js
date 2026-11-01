(function(root,factory){const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./cityParcels'):root.CityParcels,node?require('./genreFixtures'):root.GenreFixtures,
    node?require('./designCatalog'):root.DesignCatalog,node?require('./cityArchitectureStyles'):root.CityArchitectureStyles,
    node?require('./cityKit'):root.CityKit);
  if(node)module.exports=api;else root.CityBuildingStyle=api;
})(typeof window==='object'?window:globalThis,function(P,F,C,A,Kit){
  'use strict';
  const VERSION=1,VARIANTS=8,approved=[...new Set(Object.values(C?.PALETTES||{}).flat())];
  const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
  function blend(a,b,weight){
    const left=rgb(a),right=rgb(b),color=left.map((v,i)=>Math.round(v*(1-weight)+right[i]*weight));
    if(approved.length)return approved.reduce((best,h)=>{
      const distance=rgb(h).reduce((n,v,i)=>n+(v-color[i])**2,0);return distance<best.distance?{h,distance}:best;
    },{h:a,distance:Infinity}).h;
    return '#'+color.map(v=>v.toString(16).padStart(2,'0')).join('');
  }
  function resolve(genre,b,base={},options={}){
    const variant=P.hash(`${b.seed??b.id}:finish-${VERSION}`)%VARIANTS,theme=F.THEMES[genre]||F.THEMES.fantasy;
    const modern=P.highRise(genre),materials=['#b8c8d8','#8b9397','#8b6331','#545a61','#c79a52','#6a4a7a','#526d4b','#8b5a2b'];
    const architecture=A.choose(genre,b,options),native=Kit.PALETTES[architecture.paletteName];
    const primary=architecture.heritage?native.body:blend(base.primary||'#647184',materials[variant],modern?.72:.4);
    const palette={...base,primary,secondary:architecture.heritage?native.trim:blend(primary,base.shadow||'#121416',.35)};
    let panes=theme.map(row=>row[2]);
    if(modern){
      const warm=['#ffe2ad','#fff0c8'],cool=['#cef4ff','#e3f4ff'];
      const residential=['home','inn','bar','foodhall'].includes(b.type),office=['civic','guild','clinic','library','court'].includes(b.type);
      panes=residential?[...warm,panes[variant%3]]:office?[...cool,panes[variant%3]]:
        variant%3===0?[...warm,panes[1]]:variant%3===1?[...cool,panes[2]]:[panes[variant%3],panes[(variant+1)%3],warm[0]];
    }else if(['torch','candle','oil','gas','flame'].includes(architecture.fixture)){
      const warm=['#ffcf83','#ffe2ad','#eeb66c','#ffd49a'];panes=[warm[variant%4],warm[(variant+1)%4],warm[(variant+2)%4]];
    }else panes=[panes[variant%3],panes[(variant+1)%3],panes[(variant+2)%3]];
    return{version:VERSION,variant,palette,panes,accent:architecture.heritage?panes[0]:theme[variant%3][2],architecture};
  }
  return{VERSION,VARIANTS,resolve};
});
