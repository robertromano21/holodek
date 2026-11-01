(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./cityParcels') : root.CityParcels,
    typeof module === 'object' && module.exports ? require('./cityEstablishments') : root.CityEstablishments,
    typeof module === 'object' && module.exports ? require('./cityArchitectureStyles') : root.CityArchitectureStyles);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CityBuildingPlans = api;
})(typeof window === 'object' ? window : globalThis, function(P, E, A) {
  'use strict';
  const VERSION = 1;
  const classical = genre => ['fantasy','dark-fantasy','cotg'].includes(genre);
  function clearanceFor(genre,type) {
    const height=E.profile(type)?.clearance||2.4;
    return classical(genre)?Math.max(type==='foodhall'?4.4:3,height):height;
  }
  function storeyHeightFor(genre,type,requested=3.4) {
    const height=Number.isFinite(requested)?Math.max(3.4,Math.min(classical(genre)?24:12,requested)):3.4;
    return classical(genre)?Math.max(height,(clearanceFor(genre,type)+.4)*P.METRES_PER_CELL):height;
  }
  const bounded = (n, lo, hi, fallback) => Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
  function create({ seed = '', hostKey, id, name = '', genre = 'fantasy', type = 'home', width, depth, storeys,
    verticality = {}, programs, entrySides, groundRooms, footprint, visualStyle, authored = false, storeyHeightMetres = 3.4 } = {}) {
    if (typeof hostKey !== 'string' || typeof id !== 'string' || !id) throw Error('A building needs a host and stable ID.');
    if (!E.TYPES.includes(type)) type = 'home';
    if (!E.NAMES[genre]) throw Error('Unknown building genre.');
    const profile = E.profile(type), hash = P.hash(`${seed}:${hostKey}:${id}:architecture-${VERSION}`);
    const w = bounded(width, 12, 64, profile.width), d = bounded(depth, 12, 64, profile.depth);
    const count = profile.openAir ? 1 : bounded(storeys, 1, 161, 1);
    const grand = !profile.openAir && (profile.monumental || count >= 12 || ['civic', 'guild', 'library', 'court'].includes(type));
    const styles = P.highRise(genre) ? ['axial-concourse', 'atrium-gallery', 'garden-hall', 'ceremonial-hall'] :
      ['processional-hall', 'courtyard-gallery', 'arcaded-hall', 'hearth-hall'];
    const plan = { version: VERSION, layoutVersion:2, id, hostKey, seed: hash, genre, type, name, authored,
      ...(classical(genre)?{architectureStyle:visualStyle?.architecture||A.choose(genre,{type,seed:hash,id})}:{}),
      footprint: { width: w, depth: d, metresPerCell: P.METRES_PER_CELL }, storeys: count,
      ...(footprint?.version===1?{outline:{...footprint}}:{}),
      storeyHeightMetres: storeyHeightFor(genre,type,storeyHeightMetres),
      lobby: { style: grand ? styles[hash % styles.length] : 'public-entrance',
        clearance: grand ? Math.max(clearanceFor(genre,type), 4.8) : clearanceFor(genre,type), tall: grand },
      circulation: { transit: P.highRise(genre) && count > 4 ? 'lift-and-stairs' : 'stairs',
        core: { x: w - 5, y: 2, width: 3, depth: 4 }, corridorWidth: 3,
        entrySides: [...new Set((entrySides || ['north', 'south', 'west', 'east']).filter(s => ['north', 'south', 'west', 'east'].includes(s)))] },
      programs: programs || { lowerUse: { type, use: verticality.lowerUse || profile.spaces.join(', ') },
        middleUse: { type, use: verticality.middleUse || profile.spaces.join(', ') },
        upperUse: { type, use: verticality.upperUse || profile.spaces.join(', ') },
        roofUse: { type: 'civic', use: verticality.roofUse || 'Enclosed upper floor' } } };
    if (groundRooms?.length) plan.groundRooms = groundRooms.map(r => ({ ...r }));
    return plan;
  }
  function floor(plan, index) {
    if (plan?.version !== VERSION || !Number.isInteger(index) || index < 0 || index >= plan.storeys) throw Error('Unknown planned building floor.');
    const { width: w, depth: d } = plan.footprint, last = plan.storeys - 1;
    const band = index === 0 ? 'lowerUse' : index === last ? 'roofUse' : index < last / 3 ? 'lowerUse' : index < last * .8 ? 'middleUse' : 'upperUse';
    const program = plan.programs[band] || plan.programs.lowerUse;
    const type = E.TYPES.includes(program?.type) ? program.type : plan.type, profile = E.profile(type);
    const rooms = [], middle = Math.floor(w / 2), hallLeft = middle - 1, corridors=[],modules=[];
    const variant=P.hash(`${plan.seed}:${plan.id}:composition:${index}`)%6;
    let composition='concourse';
    if (index === 0 && plan.groundRooms) rooms.push(...plan.groundRooms.map(r => ({ ...r })));
    else if(plan.layoutVersion===2){
      const space=(x,y,width,depth,role='chamber',shape='hall')=>{
        width=Math.min(width,w-1-x);depth=Math.min(depth,d-1-y);
        if(width>=3&&depth>=3)rooms.push({x,y,width,depth,role,shape,
          use:role==='entrance'?'public-lobby':profile.spaces[(rooms.length+variant)%profile.spaces.length]});
      };
      const innerW=w-2,innerD=d-2,cx=Math.floor(w/2),cy=Math.floor(d/2),
        leftW=Math.max(3,cx-2),rightX=cx+2,rightW=Math.max(3,w-rightX-1),back=Math.max(5,Math.floor(d*.55));
      if(variant===0){
        composition='apsidal-hall';space(2,back,w-4,d-back-1,'entrance');
        space(2,2,w-4,back-3,'hall');
        if(w>=22&&d>=24)space(cx-4,2,9,9,'rotunda','round');
      }else if(variant===1){
        composition='peristyle-ring';
        space(1,d-5,innerW,4,'entrance');space(1,1,innerW,4,'gallery');
        space(1,4,4,d-8,'gallery');space(w-5,4,4,d-8,'gallery');
        space(6,6,w-12,d-12,'hall');
      }else if(variant===2){
        composition='offset-suites';space(1,d-5,innerW,4,'entrance');
        const cut=5+P.hash(`${plan.seed}:${index}:partition`)%Math.max(1,w-12);
        space(1,1,cut-1,Math.max(4,cy-2));space(cut+1,1,w-cut-2,Math.max(4,cy+1));
        space(1,cy,cut-1,Math.max(3,d-cy-6));
      }else if(variant===3){
        composition='rotunda-and-wings';space(1,d-5,innerW,4,'entrance');
        const diameter=Math.max(7,Math.min(w-4,d-8));
        space(cx-Math.floor(diameter/2),2,diameter,diameter,'rotunda','round');
        if(w>=26){space(1,2,5,d-8,'gallery');space(w-6,2,5,d-8,'gallery');}
      }else if(variant===4){
        composition='staggered-galleries';space(1,d-5,innerW,4,'entrance');
        space(1,1,leftW,Math.max(5,cy),'hall');space(rightX,1,rightW,Math.max(4,cy-3));
        space(rightX,cy-1,rightW,Math.max(3,d-cy-5),'gallery');
      }else{
        composition='cloister-and-chambers';space(1,d-5,innerW,4,'entrance');
        space(1,1,Math.max(7,Math.floor(innerW*.62)),d-7,'hall');
        const x=Math.max(7,Math.floor(innerW*.62))+2;
        if(w-x-1>=3){space(x,1,w-x-1,Math.max(3,cy-2));space(x,cy,w-x-1,Math.max(3,d-cy-6));}
      }
      for(let i=1;i<rooms.length;i++)corridors.push({fromRoom:i-1,toRoom:i,width:2+(variant%2),style:i%2?'H':'V'});
      if(rooms.length>2)corridors.push({fromRoom:rooms.length-1,toRoom:0,width:2,style:'V'});
      const style=plan.architectureStyle;
      if(style)for(let i=1;i<rooms.length;i++){
        const r=rooms[i],roof=style.tradition==='medieval'?'ribbed':style.tradition==='byzantine'?'pendentive':'coffered';
        r.roofStyle=roof;r.columnOrder=style.tradition==='greek'?'doric':'ionic';
        if(r.shape==='round'&&r.width>=11&&r.depth>=11)modules.push({type:'rotunda_section',room:i,roofStyle:roof});
        else if(composition==='cloister-and-chambers'&&r.width>=13&&r.depth>=15)modules.push({type:'cloister',room:i});
        else if(r.width>=7&&r.depth>=8)modules.push({type:'colonnade',room:i,width:r.width-2,height:r.depth-2});
      }
    }
    else {
      rooms.push({ x: hallLeft, y: 1, width: 3, depth: d - 2, use: index === 0 ? 'public-lobby' : 'floor concourse', role: 'entrance' });
      const rows = Math.max(1, Math.min(3, Math.floor((d - 2) / 9))), roomDepth = Math.floor((d - 2) / rows);
      for (let row = 0; row < rows; row++) for (const side of [0, 1]) {
        const x = side ? middle + 3 : 1, width = side ? w - middle - 4 : middle - 3;
        const y = 1 + row * roomDepth, depth = (row === rows - 1 ? d - 1 - y : roomDepth - 1);
        rooms.push({ x, y, width, depth, use: profile.spaces[(row * 2 + side + P.hash(`${plan.seed}:${index}`)) % profile.spaces.length], role: 'chamber' });
      }
    }
    return { version: VERSION, id: `${plan.id}:floor:${index}`, hostKey: plan.hostKey, buildingId: plan.id, floor: index,
      seed: P.hash(`${plan.seed}:floor:${index}`), width: w, depth: d, type, use: program?.use || profile.spaces.join(', '),
      clearance: index === 0 ? plan.lobby.clearance : Math.max(1.2, Math.min(clearanceFor(plan.genre,type),
        plan.storeyHeightMetres/P.METRES_PER_CELL-(classical(plan.genre)?.4:.4/P.METRES_PER_CELL))),
      rooms,corridors,modules,composition,layoutVersion:plan.layoutVersion||1, core: { ...plan.circulation.core }, connections: { ...(index > 0 ? { down: index - 1 } : {}), ...(index < last ? { up: index + 1 } : {}) },
      ...(plan.outline?{outline:{...plan.outline}}:{}),
      ...(plan.architectureStyle?{architectureStyle:{...plan.architectureStyle}}:{}),
      policy: 'saved-plan; geometry-on-demand; inhabitants-on-visit' };
  }
  // Precompute compact recipes, never meshes, textures, people, or a cell grid for every storey.
  function district({ seed, cityId, hostKey, genre, scale, floors, mix, half, pitch, origin } = {}) {
    const buildings = {}, candidates = [], radius = bounded(half, 2, 16, scale === 'metropolis' ? 16 : 10);
    for (let y = 1 - radius; y < radius; y++) for (let x = 1 - radius; x < radius; x++) {
      if (!x && !y) continue;
      const parcel = P.parcel({ seed, cityId, districtKey: hostKey, genre, scale, floors, mix, x, y });
      if (!parcel.park) candidates.push(parcel);
    }
    candidates.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.seed - b.seed);
    for (const p of candidates.slice(0, scale === 'metropolis' ? 750 : scale === 'city' ? 320 : 48)) {
      const plan = create({ ...p, seed, hostKey, genre });
      buildings[p.id] = { plan, parcel: { x: p.x, y: p.y }, status: 'planned', floors: {} };
    }
    return { version: VERSION, cityId, hostKey, seed, genre, pitch: pitch || P.pitchFor(genre), origin,
      buildings, policy: 'host-owned; seeded-plans-first; detailed-geometry-nearby' };
  }
  function bind(architecture, b, options = {}) {
    const id = b.planId || b.id;
    const groundRooms = (b.rooms || []).map(r => ({ x: r.x - b.left, y: r.y - b.top, width: r.width, depth: r.depth, use: r.use,
      role: r.use === 'public-lobby' ? 'entrance' : 'chamber' }));
    const record = architecture.buildings[id] ||= { floors: {} };
    // Fitted terrain, authored envelopes, and actual doors supersede a parcel's provisional envelope once.
    if (record.status !== 'built') record.plan = create({ ...b, ...options, id, hostKey: architecture.hostKey, seed: architecture.seed,
      genre: architecture.genre, groundRooms });
    if(Number.isFinite(b.clearance)&&record.plan.groundRooms)record.plan.lobby.clearance=b.clearance;
    record.placement = { left: b.left, top: b.top, base: b.base, entrySides: b.entrySides };
    record.status = 'built'; record.floors ||= {};
    for (let i = 0; i < Math.min(2, record.plan.storeys); i++) record.floors[i] ||= { plan: floor(record.plan, i) };
    b.planId = id; b.architectureVersion = VERSION;
    return record;
  }
  return { VERSION, classical, clearanceFor, storeyHeightFor, create, floor, district, bind };
});
