(function(root,factory){const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./cityKit'):root.CityKit,node?require('./urbanDesigns'):root.UrbanDesigns,
    node?require('./cityBuildingFootprints'):root.CityBuildingFootprints);
  if(node)module.exports=api;else root.CityArchitectureStyles=api;
})(typeof window==='object'?window:globalThis,function(Kit,Urban,Footprints){
  'use strict';
  // Shared art direction, not prefab cities or canonical lore. Original kit meshes remain the source of roof geometry.
  const PROFILES={
    cotg:['Classical, Renaissance and medieval underworld city-states; ashlar plinths, arcades, peristyles, domed rotundas, temples, basilicas, castles, fortresses and terraced citadels','stone','torch','candlelit shutters and oil lamps'],
    fantasy:['Classical temples and rotundas, Renaissance palazzi and loggias, medieval guildhalls, timber houses, keeps, castles and citadels','stone','torch','warm candle and oil windows'],
    'dark-fantasy':['The same Classical-Renaissance-medieval construction, weathered ashlar, buttressed keeps, crypt basilicas, cloisters, fortified citadels; inhabited, not universally ruined','stone','torch','warm candle windows; rare ritual glow only at a specific shrine'],
    mythic:['Columned temples, pediments, civic basilicas, amphitheatres, domed baths and processional stoas','stone','flame','oil lamps, braziers and votive flames'],
    'sci-fi':['Engineered towers, pressure shells where required, structural cores, sealed atria, skybridges and modular service decks','metal','electric','work lights, habitation windows and navigation beacons'],
    cyberpunk:['Dense mixed-use megatowers, podium markets, setbacks, enclosed lift cores, elevated transit and crowded service alleys','brick','electric','varied warm homes, cool offices, neon commercial signs'],
    'post-apocalyptic':['Reused masonry and industrial shells, braced salvage additions, patched roofs and defensible courtyards','brick','salvage','barrel fires, oil lamps and selective reclaimed electricity'],
    steampunk:['Brick mills, stone civic halls, iron-and-glass train sheds, riveted bridges, clock towers and pitched roofs','brick','gas','gaslight, oil lamps and occasional industrial arc lights'],
    western:['Timber frames, pitched roofs behind false fronts, shaded porches, boardwalks and stone civic foundations','wood','oil','oil lanterns and candle windows'],
    modern:['Steel or concrete frames, curtain walls, masonry neighborhoods, realistic podiums and accessible civic frontages','stone','electric','warm residential and cool commercial windows'],
    noir:['Art Deco setbacks, brick walk-ups, stone cornices, grand stations, fire escapes and glazed shopfronts','brick','electric','tungsten interiors, street lamps and selective neon'],
    nautical:['Quayside masonry, timber warehouses, arcaded customs halls, pitched roofs, docks and lighthouse towers','stone','oil','ship lanterns, oil-lit windows and harbor signals'],
    'cosmic-horror':['Period-specific coastal masonry, shuttered townhouses, institutional porticos and unsettling but load-bearing additions','brick','oil','ordinary period lamps; exceptional uncanny light remains exceptional'],
    'gothic-horror':['Pointed arches, steep roofs, tracery, buttresses, vaulted churches and stone or half-timbered houses','stone','candle','candle windows and warm lanterns, not office LEDs'],
    solarpunk:['Terraced mixed-use towers, timber or low-carbon frames, planted roofs, shaded arcades and shared gardens','wood','electric','warm low-energy windows and integrated wayfinding'],
    dieselpunk:['Brick industrial blocks, riveted steel sheds, Deco towers, monumental stations and gantries','brick','electric','tungsten windows, industrial tubes and limited signals'],
    underwater:['Pressure-rated domes, cylindrical habitats, reinforced viewports, watertight vestibules and connected service spines','metal','electric','habitat windows, pressure markers and restrained bioluminescence'],
    prehistoric:['Post-and-beam lodges, thatch or hide roofs, dry-stone foundations, hearths and sophisticated earthen gathering spaces','wood','flame','hearth fire, embers and portable flame'],
    'desert-fantasy':['Shaded courtyard houses, arcades, wind towers, domes, vaulted bazaars, cisterns and caravanserais','stone','oil','oil lamps, screened warm windows and courtyard braziers']
  };
  const HERITAGE=new Set(['cotg','fantasy','dark-fantasy','mythic']);
  const classical=a=>['cotg','fantasy','dark-fantasy'].includes(a?.profile);
  const TRADITIONS={
    greek:'Greek-derived: an agora with stoas, council and craft spaces, peristyle houses, temple precincts and an elevated acropolis where terrain allows. Use column-and-lintel porticoes rather than making every Greek frontage an arch. Planned foundations may be orthogonal; older districts can follow inherited paths.',
    roman:'Roman-derived: a forum and civic basilica near principal intersecting streets in planned colonies; porticoes, shops, insulae, domus courts, baths, granaries, fountains and drainage. Use round arches and vaults for working gateways, arcades, bridges and aqueducts. Older cities need not be regular grids.',
    byzantine:'Byzantine-derived: inherited civic routes with later infill, fortified upper precincts, courtyard houses, brick-and-stone arches, domed basilicas, cisterns, hospitals, hospices and harbor stores. Terraces follow terrain. Architectural techniques do not import Christian beliefs into this world.',
    medieval:'Medieval-derived: castle or sanctuary, market and guild quarters, burgage-like frontages, timber and masonry dwellings, vaulted passages, bridges and gated defenses. Choose organic growth, concentric wards, a planned market grid or a linear trade route from local history.',
    renaissance:'Renaissance-derived: choose a civic piazza-centered renewal, orthogonal planned extension, axial avenue connecting gates and institutions, or radial bastioned fortress town according to local history and terrain. Frame rectangular or trapezoidal piazzas with proportioned palazzi, arcaded loggias and civic or sacred institutions; use rustication, ordered facades, courtyards, domes and gardens. Long sightlines need real reachable destinations. Bastioned defenses use low broad ramparts, angular mutually supporting bastions, curtain walls, moats and controlled gates rather than only tall medieval towers; include artillery only if this world establishes gunpowder or equivalent siege technology. Retain inherited medieval quarters and livelihoods instead of imposing universal symmetry or a star outline on every settlement. Monumental fronts serve usable courts and halls; ordinary shops, housing and service access remain essential.'
  };
  const hash=s=>Kit.hash(String(s));
  function profile(genre,cotg=false){const key=cotg?'cotg':Object.hasOwn(PROFILES,genre)?genre:'fantasy',p=PROFILES[key];
    return{key,architecture:p[0],material:p[1],fixture:p[2],lighting:p[3],heritage:HERITAGE.has(key)};}
  function brief(genre,cotg=false){const p=profile(genre,cotg);return p.architecture+'. Lighting: '+p.lighting+
    (p.heritage?' Choose or layer fitting traditions from '+Object.values(TRADITIONS).join(' '):'')+
    '. Apply this idiom at village, town and city scale. Native architecture is functional: entrances, foundations, structural spans, stairs and roofs must fit the actual floor plan. Technology and explicit world instructions take precedence; do not import another campaign\'s names or gods.';}
  const FORMS={temple:[['city_temple',.74,'temple','roman_temple'],['public_baths',.55,'rotunda','byzantine_basilica'],['basilica',.58,'basilica','byzantine_basilica']],
    bathhouse:[['public_baths',.55,'bathhouse','villa']],court:[['basilica',.58,'basilica','byzantine_basilica']],
    library:[['public_baths',.55,'rotunda','byzantine_basilica'],['guild_hall',.70,'guildhall','guildhall']],
    civic:[['city_gate',.60,'citadel','fantastic_citadel'],['city_tower',.82,'castle','medieval_castle'],['basilica',.58,'basilica','byzantine_basilica']],
    transit:[['city_gate',.60,'fortress','fortress']],guild:[['guild_hall',.70,'guildhall','guildhall']],
    arena:[['amphitheatre',.45,'amphitheater','ruined_courtyard']],
    warehouse:[['warehouse',.70,'warehouse','guildhall']],foodhall:[['guild_hall',.70,'market','market']]};
  function tradition(design={},seed=''){
    if(TRADITIONS[design.architecture?.tradition])return design.architecture.tradition;
    const text=[design.identity,design.history,design.skyline].filter(Boolean).join(' ').toLowerCase();
    // A later city's explicit idiom takes precedence over the ancient vocabulary it revives or inherits.
    const found=['renaissance','byzantine','medieval','greek','roman'].find(id=>new RegExp(id==='greek'?'greek|hellenic|hellenistic|stoa|acropolis':id==='roman'?'roman|forum|insula':id).test(text));
    return found||Object.keys(TRADITIONS)[hash(seed)%5];
  }
  function choose(genre,b,{cotg=false,tradition:idiom='mixed'}={}){
    const p=profile(genre,cotg),seed=hash(`${b.seed??b.id}:native-architecture`);
    const named=String(b.template||b.name||'').toLowerCase();
    let forms=FORMS[b.type]||[['city_townhouse',.82,'domus','house'],['city_insula',.82,'insula','house'],['guild_hall',.70,'guildhall','guildhall']];
    if(idiom==='greek'&&['temple','library','civic','guild'].includes(b.type))forms=[b.type==='temple'?FORMS.temple[0]:FORMS.guild[0]];
    if(idiom==='byzantine'&&['temple','library','bathhouse'].includes(b.type))forms=[FORMS.temple[1],FORMS.temple[2]];
    if(idiom==='medieval'&&b.type==='civic')forms=[FORMS.civic[0],FORMS.civic[1]];
    if(idiom==='renaissance'&&b.type==='civic')forms=[FORMS.temple[1],FORMS.civic[2],FORMS.guild[0]];
    if(/citadel/.test(named))forms=[FORMS.civic[0]];
    else if(/fortress|gatehouse/.test(named))forms=[FORMS.transit[0]];
    else if(/castle|keep|watchtower/.test(named))forms=[FORMS.civic[1]];
    else if(/rotunda|domed/.test(named))forms=[FORMS.temple[1]];
    else if(/byzantine_basilica/.test(named))forms=[FORMS.temple[1]];
    else if(/roman_temple|deity_temple/.test(named))forms=[FORMS.temple[0]];
    else if(/guildhall/.test(named))forms=[FORMS.guild[0]];
    const [shape,cut,family,template]=forms[seed%forms.length];
    const paletteNames=p.key==='dark-fantasy'?['basalt','sandstone','bronze','basalt']:['marble','sandstone','bronze','marble'];
    return{version:1,profile:p.key,material:p.material,fixture:p.fixture,heritage:p.heritage,
      source:p.heritage?'cityKit':'urbanDesigns',shape:p.heritage?shape:`a_${genre}_urban_skyline`,cut:p.heritage?cut:.68,
      family:p.heritage?family:'native',tradition:idiom,template:p.heritage?template:null,paletteName:paletteNames[seed%paletteNames.length],
      ...(classical({profile:p.key})&&(['rotunda','bathhouse'].includes(family)||idiom==='byzantine'&&['temple','bathhouse','library'].includes(b.type))?{roofForm:'dome'}:{})};
  }
  function envelope(a,b){
    const upper=Math.max(0,(b.metres?.height||0)/2.5-b.clearance-.4),roof=Math.max(1.2,Math.min(5,Math.min(b.width,b.depth)*.22));
    const fraction=upper?Math.max(1/16,Math.min(14/16,Math.floor(upper/(upper+roof)*16)/16)):0;
    return{...a,bodyFraction:fraction,height:fraction?upper/fraction:roof,
      ...(classical(a)?{facadeVersion:1,storeyHeight:(b.storeyHeightMetres||8.5)/2.5}: {})};
  }
  function build(footprint,a,size=16){
    if(!a?.version)return Footprints.build(footprint,size);
    const native=a.source==='cityKit'?Kit.build(a.shape,size,0):Urban.build(a.shape,size);
    if(!native)return Footprints.build(footprint,size);
    const out=new Uint8Array(size**3),body=Math.round((a.bodyFraction??.75)*size),cut=Math.floor(a.cut*size);
    for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      if(!Footprints.contains(footprint,(x+.5)/size,(y+.5)/size))continue;
      // Full occupied envelope below the crown; only the unoccupied roof uses the original kit's silhouette.
      const nz=Math.min(size-1,cut+Math.floor((z-body)*(size-cut)/Math.max(1,size-body)));
      const dome=a.roofForm==='dome'?Kit.domeProfile(((x+.5)/size-.5)/.76+.5,((y+.5)/size-.5)/.76+.5):null;
      const crown=dome? (z-body)/Math.max(1,size-body)<.12||dome.radius<=1&&(z-body)/Math.max(1,size-body)<=.22+dome.height*.78 : native[x+y*size+nz*size*size];
      if(z<body||crown)out[x+y*size+z*size*size]=1;
    }
    return out;
  }
  function color(a,x,y,z,normal,palette){
    const p=Kit.PALETTES[a.paletteName]||Kit.PALETTES.marble,roof=z>=(a.bodyFraction??.75);
    if(roof&&a.source==='cityKit')return Kit.color(a.shape,x,y,a.cut+(z-(a.bodyFraction??.75))/Math.max(.01,1-(a.bodyFraction??.75))*(1-a.cut),normal,null,a.material,{palette:a.paletteName});
    const mortar=(Math.floor(z*64)%6===0)||Math.floor((x+y)*64+(Math.floor(z*64/6)%2)*4)%12===0;
    const h=roof?palette?.secondary: a.heritage?(mortar?p.trim:p.body):palette?.primary;
    return[1,3,5].map(i=>parseInt((h||'#647184').slice(i,i+2),16)/255);
  }
  function facade(part,building,surface,panes,run=''){
    const a=part.cityArchitecture;if(!classical(a))return{walls:[],windows:[]};
    const palette=Kit.PALETTES[a.paletteName]||Kit.PALETTES.marble,rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255),
      stone=rgb(palette.trim),dark=rgb(palette.dark).map(c=>c*.25),walls=[],windows=[],
      p=part.position,s=part.size,offset=[p.x,p.y,p.z],scale=[s.x,s.y,s.z],pitch=a.storeyHeight||3.4;
    let bays=0;
    for(const [faceIndex,face]of surface.entries()){
      if(face.axis===2)continue;
      const horizontal=1-face.axis,lo=Math.min(...face.points.map(v=>v[horizontal]))*scale[horizontal]+offset[horizontal],
        hi=Math.max(...face.points.map(v=>v[horizontal]))*scale[horizontal]+offset[horizontal],
        bottom=Math.min(...face.points.map(v=>v[2]))*s.z+p.z,
        top=Math.min(a.bodyFraction,Math.max(...face.points.map(v=>v[2])))*s.z+p.z;
      if(hi-lo<2||top-bottom<1.4)continue;
      const point=(u,z,depth)=>{const q=[0,0,z];q[horizontal]=u;q[face.axis]=offset[face.axis]+face.points[0][face.axis]*scale[face.axis]+face.sign*depth;return q;};
      const quad=(role,uv,color,depth=.04,out=walls)=>out.push({role,normal:face.normal,color,points:uv.map(([u,z])=>point(u,z,depth))});
      const rect=(role,x,z,w,h,color,depth=.04,out=walls)=>quad(role,[[x,z],[x+w,z],[x+w,z+h],[x,z+h]],color,depth,out);
      const first=Math.max(0,Math.ceil((bottom-p.z)/pitch)),last=Math.floor((top-p.z-.25)/pitch),
        rows=Math.max(0,last-first+1),cols=Math.min(12,Math.max(1,Math.floor((hi-lo)/3.2))),stride=Math.max(1,Math.ceil(rows*cols/32));
      // Continuous projecting string courses and an eaves cornice, not luminous office-grid lines.
      for(let row=first;row<=last;row+=Math.max(1,Math.ceil(rows/12))){
        const z=p.z+row*pitch;
        if(z<bottom||z>top)continue;
        rect('string-course',lo,z,hi-lo,.12,stone,.16);
        const points=[[lo,z],[hi,z],[hi,z],[lo,z]].map(([u,h],i)=>point(u,h,i<2?.015:.16));
        walls.push({role:'cornice-soffit',normal:[0,0,-1],color:stone,points});
      }
      rect('eaves-cornice',lo,top-.13,hi-lo,.18,stone,.18);
      for(let row=first;row<=last;row++)for(let col=0;col<cols;col++){
        if((row*cols+col)%stride||bays>=128)continue;
        const cx=lo+(col+.5)*(hi-lo)/cols,z=p.z+row*pitch+pitch*.42,
          w=Math.min(.55,(hi-lo)/cols*.20),h=Math.min(.85,pitch*.22),t=.12;
        if(z-h<bottom+.18||z+h+.22>top)continue;
        bays++;
        const round=a.tradition!=='greek'&&(row+col)%3!==0,shoulder=z+h-(round?w:0),
          seed=hash(`${run}:${building.id}:${faceIndex}:${row}:${col}`),lit=seed%5!==0,
          glass=lit?rgb(panes[seed%panes.length]):dark;
        rect('window-recess',cx-w-t,z-h-t,w*2+t*2,h*2+t*2,dark,.018);
        rect('window-pane',cx-w,z-h,w*2,shoulder-(z-h),glass,.025,lit?windows:walls);
        for(const x of [cx-w-t,cx+w])rect('window-jamb',x,z-h,t,shoulder-z+h,stone,.065);
        rect('window-sill',cx-w-t*2,z-h-t,w*2+t*4,t,stone,.13);
        if(round){
          // Voussoirs and the warm pane follow the same semicircle; no bright rectangular cap above an arch.
          for(let i=0;i<6;i++){
            const a0=i*Math.PI/6,a1=(i+1)*Math.PI/6,uv=r=>[cx+Math.cos(r)*w,shoulder+Math.sin(r)*w],
              outer=r=>[cx+Math.cos(r)*(w+t),shoulder+Math.sin(r)*(w+t)];
            quad('arched-window-head',[uv(a0),uv(a1),outer(a1),outer(a0)],stone,.065);
            quad('arched-window-pane',[[cx,shoulder],uv(a0),uv(a1),[cx,shoulder]],glass,.025,lit?windows:walls);
          }
        }else rect('window-lintel',cx-w-t,shoulder,w*2+t*2,t,stone,.065);
      }
    }
    return{walls,windows,bays};
  }
  function template(genre,type,seed,options){const a=choose(genre,{type,seed},options);return a.template;}
  return{PROFILES,TRADITIONS,FORMS,profile,brief,tradition,choose,envelope,build,color,facade,classical,template};
});
