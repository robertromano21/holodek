(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArchitectureDesigns = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  // Architecture is geometry, not a painted doorway on an opaque cube.
  // Each family owns its proportions, opening, support rhythm and joinery.
  const ROWS = {
    fantasy: ['round',3,'stone','stepped_keep_portal','cloister_walk','illuminators_desk'],
    'dark-fantasy': ['pointed',4,'stone','recessed_crypt_portal','ossuary_loggia','funerary_record_cabinet'],
    mythic: ['square',5,'marble','dentilled_ceremonial_gate','processional_colonnade','libation_vessel_stand'],
    'sci-fi': ['hex',2,'metal','ribbed_pressure_frame','service_gantry','navigation_workstation'],
    cyberpunk: ['square',4,'metal','layered_security_frame','cable_skywalk','data_terminal_pedestal'],
    'post-apocalyptic': ['broken',3,'metal','salvaged_checkpoint_frame','patched_scrap_walk','salvage_sorting_station'],
    steampunk: ['round',4,'brass','riveted_foundry_portal','iron_truss_gallery','pressure_instrument_stand'],
    western: ['square',3,'wood','braced_ranch_gateway','covered_boardwalk','assayers_counter'],
    modern: ['square',2,'concrete','recessed_civic_entry','cantilevered_concourse','reception_island'],
    noir: ['stepped',5,'stone','deco_stepped_entry','clerestory_arcade','records_reception_desk'],
    nautical: ['round',2,'wood','timbered_shipyard_entry','rope_rail_gangway','chartmakers_bench'],
    'cosmic-horror': ['pointed',3,'stone','offset_ritual_threshold','crooked_tidal_arcade','sealed_observation_case'],
    'gothic-horror': ['pointed',5,'stone','deep_traceried_entry','rib_vaulted_cloister','mortuary_instrument_table'],
    solarpunk: ['round',4,'wood','trellised_garden_entry','planted_walkway','seed_exchange_counter'],
    dieselpunk: ['hex',3,'metal','armored_depot_frame','riveted_loading_gallery','mechanics_diagnostic_station'],
    underwater: ['round',5,'metal','reinforced_dive_frame','enclosed_observation_walk','sampling_pressure_table'],
    prehistoric: ['triangle',2,'wood','lashed_trilithon_entry','hide_roofed_shelter','flint_knapping_bench'],
    'desert-fantasy': ['pointed',4,'sandstone','layered_oasis_portal','pierced_shade_gallery','ceramic_water_service']
  };
  const SHAPES = {};
  for (const [genre, row] of Object.entries(ROWS)) for (let i=0;i<3;i++) {
    const id='a_'+genre+'_'+row[i+3];
    SHAPES[id]={genre,role:['gate','gallery','workstation'][i],form:row[0],rhythm:row[1],material:row[2],
      architecturalDesign:true,furnishing:i===2,cotg:['fantasy','dark-fantasy','mythic'].includes(genre),
      label:row[i+3].replaceAll('_',' '),footprint:i===0?[3,1]:i===1?[3,2]:[1,1],height:i===0?3.2:i===1?3:1.2};
  }
  const OVERLOOKS = {
    fantasy:'turret_belvedere', 'dark-fantasy':'mourning_watch', mythic:'painted_exedra',
    'sci-fi':'observation_rib', cyberpunk:'signal_canopy', 'post-apocalyptic':'scrap_lookout',
    steampunk:'pressure_gauge_balcony', western:'survey_shelter', modern:'concourse_pavilion',
    noir:'deco_press_balcony', nautical:'harbormasters_watch', 'cosmic-horror':'offset_listening_frame',
    'gothic-horror':'traceried_oriel', solarpunk:'seed_garden_pergola', dieselpunk:'armored_signal_box',
    underwater:'reef_observation_bay', prehistoric:'ridge_shelter', 'desert-fantasy':'windcatcher_loggia'
  };
  for (const [genre, name] of Object.entries(OVERLOOKS)) {
    const row = ROWS[genre];
    SHAPES['a_'+genre+'_'+name] = { genre, role:'overlook', form:row[0], rhythm:row[1], material:row[2],
      architecturalDesign:true, cotg:['fantasy','dark-fantasy','mythic'].includes(genre),
      label:name.replaceAll('_',' '), footprint:[2,2], height:2.8 };
  }
  const COTG = {
    mourning_vestry_portal:['gate','pointed',3],
    dragon_rib_ambulatory:['gallery','pointed',5],
    ancestral_niche_wall:['niches','square',4],
    sepulchral_baldachin:['baldachin','round',4],
    winged_memorial_stela:['stela','pointed',3],
    funerary_procession_bier:['bier','square',4],
    tolling_soul_bell:['bell','round',3],
    carved_offering_tripod:['tripod','triangle',3],
    scroll_archive_shelves:['archive','round',5],
    draconic_bone_screen:['screen','pointed',5]
  };
  for(const [name,[role,form,rhythm]] of Object.entries(COTG)) SHAPES['a_cotg_'+name]={genre:'dark-fantasy',role,form,rhythm,
    material:'stone',label:name.replaceAll('_',' '),cotg:true,architecturalDesign:true,furnishing:!['gate','gallery'].includes(role),
    footprint:role==='gallery'?[3,2]:role==='gate'?[3,1]:[1,1],height:role==='gallery'||role==='gate'?3.2:2};
  const has=id=>Object.hasOwn(SHAPES,id);
  function opening(form,x,z,width=.29) {
    const u=Math.abs(x-.5)/width;
    if(u>=1||z<.03)return false;
    const top=form==='pointed'?.83-.24*u:form==='round'?.58+.24*Math.sqrt(1-u*u):
      form==='triangle'?.87-.31*u:form==='hex'?.82-Math.max(0,u-.55)*.36:
      form==='stepped'?.83-Math.floor(u*3)*.055:form==='broken'?.76+(.5-x)*.12:.79;
    return z<top;
  }
  function build(id,size=24) {
    if(!has(id)||!Number.isInteger(size)||size<8||size>64)return null;
    const d=SHAPES[id],v=new Uint8Array(size**3),g=d.genre,tech=/sci-fi|cyberpunk|dieselpunk|underwater/.test(g),
      timber=d.material==='wood',rh=d.rhythm,genreIndex=Object.keys(ROWS).indexOf(g),
      post=.035+(rh-2)*.004, roof=.83+(rh-3)*.015;
    const box=(x,y,z,a,b,c,on=1)=>{for(let k=Math.max(0,Math.floor(z*size));k<Math.min(size,Math.ceil(c*size));k++)
      for(let j=Math.max(0,Math.floor(y*size));j<Math.min(size,Math.ceil(b*size));j++)
        for(let i=Math.max(0,Math.floor(x*size));i<Math.min(size,Math.ceil(a*size));i++)v[i+j*size+k*size*size]=on;};
    const solid=fn=>{for(let k=0;k<size;k++)for(let j=0;j<size;j++)for(let i=0;i<size;i++){
      const x=(i+.5)/size,y=(j+.5)/size,z=(k+.5)/size;if(fn(x,y,z))v[i+j*size+k*size*size]=1;}};
    const rod=(ax,ay,az,bx,by,bz,r=.035)=>{const dx=bx-ax,dy=by-ay,dz=bz-az,l=dx*dx+dy*dy+dz*dz;
      solid((x,y,z)=>{const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy+(z-az)*dz)/l));
        return Math.hypot(x-ax-t*dx,y-ay-t*dy,z-az-t*dz)<r;});};
    if(d.role==='gate') {
      solid((x,y,z)=>{
        const depth=Math.abs(y-.5),layer=depth<.09?0:depth<.17?1:depth<.24?2:3;
        if(layer===3)return false;
        const outside=x>.035+layer*.035&&x<.965-layer*.035&&z<.98-layer*.025;
        return outside&&!opening(d.form,x,z,.27+layer*.035);
      });
      box(.025,.24,.02,.235,.76,.13);box(.765,.24,.02,.975,.76,.13);
      if(tech){for(const x of [.10,.90])for(const z of [.2,.46,.72])box(x-.035,.22,z,x+.035,.30,z+.06);}
      else if(timber){rod(.1,.25,.65,.30,.25,.83,.045);rod(.9,.25,.65,.70,.25,.83,.045);}
      else{for(let i=0;i<rh+2;i++){const x=.08+i*.84/(rh+1);box(x,.24,.91,x+.035,.31,.97);}}
      if(id.startsWith('a_cotg_'))for(const x of [.15,.85])for(let i=0;i<5;i++)rod(x,.22,.20+i*.13,x+(x<.5?.06:-.06),.22,.24+i*.13,.027);
      if(g==='solarpunk')for(const x of [.08,.92]){box(x-.065,.25,0,x+.065,.75,.18);rod(x,.35,.15,x+.06,.35,.88,.024);}
    } else if(d.role==='gallery') {
      box(.015,.03,0,.985,.97,.08);box(.015,.03,roof,.985,.97,roof+.08);
      const trussed=tech||timber||d.material==='brass'||g==='post-apocalyptic'||g==='modern';
      const positions=Array.from({length:rh},(_,i)=>.08+i*.84/(rh-1));
      for(const x of positions)for(const y of [.12,.88]){
        box(x-post,y-post,.06,x+post,y+post,roof);
        box(x-post*1.35,y-post*1.35,.08,x+post*1.35,y+post*1.35,.17);
        box(x-post*1.4,y-post*1.4,roof-.08,x+post*1.4,y+post*1.4,roof+.01);
      }
      if(trussed){for(const x of positions){rod(x,.12,roof,x,.5,.98,.035);rod(x,.88,roof,x,.5,.98,.035);}
        for(const y of [.12,.88]){rod(.05,y,.44,.95,y,.44,.027);for(let i=0;i<rh-1;i++)rod(positions[i],y,.45,positions[i+1],y,roof-.08,.022);}}
      else for(let i=0;i<rh-1;i++)for(const y of [.12,.88]){
        const a=positions[i],b=positions[i+1],c=(a+b)/2,w=(b-a)*.45;
        solid((x,yy,z)=>Math.abs(yy-y)<.045&&x>a&&x<b&&z>roof-.25&&z<roof&&
          z>roof-.25+.19*(d.form==='pointed'?1-Math.abs((x-c)/w):Math.sqrt(Math.max(0,1-((x-c)/w)**2))));
      }
      if(id.startsWith('a_cotg_'))for(const x of positions){rod(x,.12,roof-.18,x,.50,.98,.025);rod(x,.88,roof-.18,x,.50,.98,.025);}
      if(g==='underwater'){box(.05,.08,.74,.95,.92,.79);box(.05,.08,.22,.95,.14,.28);}
      if(g==='solarpunk')for(const y of [.04,.80])box(.18,y,.08,.82,y+.15,.21);
      if(g==='desert-fantasy')for(let i=0;i<9;i++)box(.06+i*.105,.05,.92,.11+i*.105,.95,.98);
    } else if(d.role==='overlook') {
      // A scenery silhouette; traversable balconies are built by the floorplan.
      const deck=.20+(genreIndex%3)*.035, reach=.82-(genreIndex%4)*.035;
      box(.04,.10,deck,.96,reach,deck+.08);
      for(const x of [.13,.87])for(const y of [.18,reach-.06]) {
        box(x-post,y-post,.02,x+post,y+post,.86);
        box(x-post*1.6,y-post*1.6,deck-.05,x+post*1.6,y+post*1.6,deck+.10);
      }
      for(const x of [.10,.90]) {
        rod(x,.14,deck+.35,x,reach-.02,deck+.35,.026);
        for(let i=0;i<rh;i++){const y=.18+i*(reach-.24)/(rh-1);rod(x,y,deck+.09,x,y,deck+.36,.018);}
      }
      box(.04,reach-.04,deck+.10,.96,reach+.02,deck+.38);
      if(d.form==='pointed'||d.form==='triangle') {
        solid((x,y,z)=>x>.04&&x<.96&&y>.10&&y<reach&&Math.abs(z-(.98-Math.abs(x-.5)*.26))<.035);
      } else if(tech) {
        box(.03,.09,.84,.97,reach+.02,.92);
        for(let i=0;i<rh;i++){const x=.13+i*.74/(rh-1);box(x-.025,.08,.72,x+.025,.18,.94);}
      } else {
        for(let i=0;i<rh+2;i++){const x=.06+i*.88/(rh+1);box(x-.025,.08,.84,x+.025,reach+.02,.91);}
        rod(.04,.13,.83,.96,.13,.83,.04);rod(.04,reach-.02,.83,.96,reach-.02,.83,.04);
      }
      if(g==='solarpunk')for(const x of [.08,.76])box(x,.18,deck+.08,x+.16,.45,deck+.24);
      if(g==='underwater'){box(.08,reach,.30,.92,reach+.07,.80);box(.18,reach-.01,.39,.82,reach+.08,.68,0);}
      if(g==='post-apocalyptic')box(.58,.10,.84,.88,.37,1,0);
      if(g==='nautical')rod(.5,.18,deck+.07,.5,.18,.99,.035);
      if(g==='desert-fantasy')for(let i=0;i<4;i++)box(.2+i*.17,reach-.06,.5,.25+i*.17,reach+.03,.70,0);
    } else if(d.role==='workstation') {
      const top=.48+(genreIndex%4)*.045,w=.86-(genreIndex%3)*.055,depth=.34+(rh-2)*.045;
      box((1-w)/2,.5-depth/2,top,(1+w)/2,.5+depth/2,top+.075);
      for(const x of [.18,.82])for(const y of [.5-depth/2+.025,.5+depth/2-.025])box(x-.04,y-.04,.03,x+.04,y+.04,top);
      box(.12,.21,.02,.88,.79,.075);
      if(tech){box(.22,.53,top+.07,.78,.69,.93);box(.28,.45,top+.07,.72,.58,.78);
        for(let i=0;i<rh;i++)box(.25+i*.12,.68,.14,.31+i*.12,.75,.43);}
      else if(g==='mythic'||g==='desert-fantasy')for(let i=0;i<rh;i++){
        const x=.25+i*.5/(rh-1);solid((xx,y,z)=>{const r=z>top+.32?.035:z>top+.14?.075:.045;return Math.hypot(xx-x,y-.50)<r&&z>top+.075&&z<top+.41;});}
      else if(g==='nautical'){box(.14,.32,top+.075,.86,.70,top+.11);rod(.75,.38,top+.1,.75,.38,.93,.035);}
      else if(g==='western'||g==='prehistoric'){box(.20,.40,top+.075,.60,.63,top+.20);for(let i=0;i<rh;i++)rod(.68,.34+i*.10,top+.10,.81,.34+i*.10,top+.22,.025);}
      else{box(.12,.64,top+.07,.88,.79,.91);for(let i=0;i<rh;i++)box(.20+i*.13,.57,top+.07,.25+i*.13,.64,top+.27);
        box(.16,.66,.70,.84,.72,.74);}
    } else if(d.role==='niches'||d.role==='archive') {
      box(.04,.35,.02,.96,.74,.98);
      for(let z=0;z<3;z++)for(let x=0;x<rh;x++){
        const a=.09+x*.84/rh,b=a+.84/rh-.045,k=.10+z*.27;
        box(a,.28,k,b,.64,k+.20,0);
        if(d.role==='archive')for(let i=0;i<2;i++)rod(a+.04+i*.045,.38,k+.035,a+.04+i*.045,.60,k+.035,.025);
      }
      box(.02,.31,.02,.98,.78,.09);box(.02,.31,.92,.98,.78,.99);
    } else if(d.role==='baldachin') {
      for(const x of [.16,.84])for(const y of [.16,.84]){rod(x,y,.06,x,y,.79,.055);box(x-.08,y-.08,.02,x+.08,y+.08,.13);}
      box(.05,.05,.78,.95,.95,.87);solid((x,y,z)=>z>.86&&z<.99-Math.max(Math.abs(x-.5),Math.abs(y-.5))*.25&&Math.max(Math.abs(x-.5),Math.abs(y-.5))<.44);
      box(.30,.29,.08,.70,.71,.32);
    } else if(d.role==='stela') {
      box(.24,.39,.05,.76,.63,.88);box(.12,.30,.02,.88,.72,.14);
      for(const side of [-1,1]){rod(.5+side*.13,.32,.82,.5+side*.43,.32,.91,.04);for(let i=0;i<4;i++)rod(.5+side*.15,.32,.80-i*.10,.5+side*(.43-i*.045),.32,.73-i*.14,.03);}
    } else if(d.role==='bier') {
      box(.12,.20,.30,.88,.80,.40);box(.22,.25,.4,.78,.75,.61);box(.29,.30,.60,.71,.70,.66);
      for(const x of [.22,.78])for(const y of [.28,.72])box(x-.05,y-.05,.02,x+.05,y+.05,.31);
      for(const y of [.29,.71])rod(.02,y,.32,.98,y,.32,.035);
    } else if(d.role==='bell') {
      for(const x of [.16,.84])box(x-.06,.40,.02,x+.06,.60,.91);box(.07,.34,.85,.93,.66,.96);
      solid((x,y,z)=>{const r=.11+(.8-z)*.24;return z>.32&&z<.81&&Math.abs(Math.hypot(x-.5,y-.5)-r)<.045;});
      rod(.5,.5,.34,.5,.5,.72,.035);box(.08,.32,.02,.92,.68,.10);
    } else if(d.role==='tripod') {
      for(let i=0;i<3;i++){const a=i*Math.PI*2/3;rod(.5+Math.cos(a)*.32,.5+Math.sin(a)*.32,.03,.5+Math.cos(a)*.15,.5+Math.sin(a)*.15,.72,.045);}
      solid((x,y,z)=>z>.69&&z<.84&&Math.hypot(x-.5,y-.5)<.32&&!(z>.76&&Math.hypot(x-.5,y-.5)<.25));
    } else if(d.role==='screen') {
      box(.05,.43,.02,.95,.57,.12);box(.05,.43,.90,.95,.57,.98);
      for(let i=0;i<5;i++){const x=.13+i*.185;rod(x,.50,.12,x,.50,.90,.025);for(const side of [-1,1])rod(x,.50,.60,x+side*.07,.50,.80,.02);}
    }
    // Construction details distinguish equal-purpose pieces across cultures and technologies.
    if(d.role==='gate'&&g==='dieselpunk')for(const side of [-1,1])rod(.5+side*.40,.20,.10,.5+side*.32,.20,.62,.075);
    if(d.role==='gate'&&g==='desert-fantasy')for(const x of [.10,.90]){box(x-.07,.17,.68,x+.07,.27,.96);box(x-.025,.14,.75,x+.025,.30,.87,0);}
    if(d.role==='gallery'){
      if(g==='steampunk'){for(const y of [.08,.92]){rod(.04,y,.62,.96,y,.62,.035);box(.03,y-.055,.03,.97,y+.055,.14);}}
      if(g==='western'){box(.03,.05,.32,.97,.13,.37);for(let i=0;i<4;i++)rod(.12+i*.24,.12,.09,.12+i*.24,.12,.34,.027);}
      if(g==='post-apocalyptic'){for(let i=0;i<3;i++)box(.18+i*.24,.05,roof,.27+i*.24,.40,roof+.12,0);box(.02,.44,roof+.07,.98,.57,roof+.12);}
      if(g==='modern'){for(const x of [.08,.92])box(x-post*1.5,.01,.17,x+post*1.5,.23,roof-.07,0);box(.02,.85,.08,.98,.98,.35);box(.01,.01,roof+.06,.99,.98,roof+.14);}
      if(g==='nautical'){for(const y of [.12,.88]){rod(.04,y,.25,.96,y,.25,.05);rod(.04,y,.59,.96,y,.59,.05);}for(const x of [.27,.73])rod(x,.06,.05,x,.06,.62,.03);}
      if(g==='noir'){box(.03,.05,roof-.18,.97,.22,roof+.13);for(let i=0;i<7;i++)box(.10+i*.12,.01,roof-.10,.16+i*.12,.25,roof+.035,0);}
      if(g==='gothic-horror'){rod(.06,.08,roof-.12,.94,.92,roof+.13,.035);rod(.06,.92,roof-.12,.94,.08,roof+.13,.035);}
      if(g==='dieselpunk'){box(.31,.22,roof+.05,.69,.78,roof+.15);for(let i=0;i<4;i++)box(.36+i*.075,.30,roof+.1,.39+i*.075,.70,1,0);}
      if(g==='prehistoric'){box(0,0,roof,1,1,1,0);solid((x,y,z)=>x>.025&&x<.975&&Math.abs(z-(.98-Math.abs(y-.5)*.27))<.035);rod(.02,.5,.97,.98,.5,.97,.03);}
    }
    if(d.role==='workstation'&&g==='solarpunk'){box(.12,.60,.58,.88,.85,.98,0);for(let i=0;i<3;i++){const x=.18+i*.23;box(x,.33,.60,x+.17,.62,.80);box(x+.03,.36,.72,x+.14,.59,.84,0);rod(x+.08,.48,.76,x+.08,.48,.95,.025);}}
    return v;
  }
  function color(id,x,y,z,normal,palette) {
    if(!has(id))return null;
    const p=palette||['#827466','#4d4542','#d0b78c','#25242a'];
    const d=SHAPES[id],course=Math.floor(z*24),joint=Math.floor(x*24+(course%2)*2)%7===0;
    const trim=z>.86||z<.11||d.role==='gate'&&Math.abs(x-.5)>.35;
    const hex=p[trim?2:joint&&course%4===0?3:1===Math.floor(y*24)%7?1:0]||p[0];
    return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  }
  return { VERSION:2,SHAPES,ROWS,OVERLOOKS,COTG,has,build,color };
});
