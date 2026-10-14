(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./puzzleModules') : root.PuzzleModules,
    typeof module === 'object' && module.exports ? require('./puzzleMotion') : root.PuzzleMotion,
    typeof module === 'object' && module.exports ? require('./surfaceArt') : root.SurfaceArt,
    typeof module === 'object' && module.exports ? require('./sculptureForms') : root.SculptureForms,
    typeof module === 'object' && module.exports ? require('./readableItems') : root.ReadableItems);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhysicalPuzzles = api;
})(typeof window === 'undefined' ? globalThis : window, function(Modules, Motion, Art, Sculptures, Readables) {
  'use strict';
  const VERSION = 2, KINDS = Object.keys(Modules.mechanics);
  const ordered = p => !!Modules.mechanics[p.kind]?.ordered;
  const receiver = p => Modules.kits[p.moduleKit]?.receiver || 'cabinet';
  const receiverLabel = p => p.outputLabel || ({ cabinet: 'reading cabinet', beacon: 'star beacon', iris: 'stone iris',
    statue: 'ancestral statue', fountain: 'shrine fountain', gate: 'counterweight gate', mosaic: 'memory mosaic',altar:'ceremonial altar' }[receiver(p)]);
  const clean = (s, n = 100) => typeof s === 'string' && s.trim().length <= n && !/[<>\r\n]/.test(s) ? s.trim() : '';
  const hash = text => {
    let h = 2166136261;
    for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0).toString(16);
  };
  function compile(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid physical puzzle design: expected one JSON object.');
    const issues = [];
    if (!KINDS.includes(raw.kind)) issues.push(`kind must be one of ${KINDS.join(', ')}`);
    for (const [field, limit] of [['title', 70], ['context', 300], ['lore', 320]]) {
      if (!clean(raw[field], limit)) issues.push(`${field} must be nonempty single-line text, max ${limit} characters (received ${typeof raw[field] === 'string' ? raw[field].trim().length + ' characters' : typeof raw[field]})`);
    }
    if (!Array.isArray(raw.controls) || raw.controls.length < 2 || raw.controls.length > 4) issues.push('controls must contain 2-4 controls');
    if (issues.length) throw Error(`Invalid physical puzzle design: ${issues.join('; ')}.`);
    const controls = raw.controls.map((c, i) => {
      const suffix = Modules.mechanics[raw.kind].suffix;
      if (!c || ['plaque', 'receiver'].includes(c.id) || !/^[a-z][a-z0-9_]{0,23}$/.test(c.id) || !clean(c.label, 45) ||
          !c.label.toLowerCase().endsWith(' ' + suffix) ||
          !/^[a-z][a-z0-9 '-]+$/i.test(c.label) || !clean(c.mark, 28) || /^(ash|ember|bone)( seal)?$/i.test(c.label)) throw Error('Invalid puzzle control.');
      const options = ordered(raw) ? ['raised', 'lit'] : ['channels','interlock'].includes(raw.kind) ? ['closed', 'open'] :
        raw.kind === 'balance' ? ['Empty', 'One', 'Two'] : c.options;
      if (!Array.isArray(options) || options.length !== Modules.mechanics[raw.kind].positions ||
          options.some(s => !clean(s, 25)) || new Set(options.map(s => s.toLowerCase())).size !== options.length) throw Error('Invalid dial positions.');
      const goal = ordered(raw) ? 1 : c.goal, initial = ordered(raw) ? 0 : c.initial;
      if (!Number.isInteger(goal) || !Number.isInteger(initial) || goal < 0 || initial < 0 ||
          goal >= options.length || initial >= options.length) throw Error('Invalid control state.');
      return { id: c.id, label: clean(c.label, 45), mark: clean(c.mark, 28), options: options.map(s => clean(s, 25)), initial, goal, index: i };
    });
    if (new Set(controls.map(c => c.id)).size !== controls.length ||
        new Set(controls.map(c => c.label.toLowerCase())).size !== controls.length ||
        new Set(controls.map(c => c.mark.toLowerCase())).size !== controls.length) throw Error('Puzzle controls must be distinguishable.');
    if (['ash', 'ember', 'bone'].every(mark => controls.some(c => c.mark.toLowerCase() === mark))) throw Error('The retired seal puzzle cannot be regenerated.');
    const order = ordered(raw) ? raw.order : [];
    if (ordered(raw) && (!Array.isArray(order) || order.length !== controls.length ||
        new Set(order).size !== controls.length || order.some(id => !controls.some(c => c.id === id)))) throw Error('Sequence references missing controls.');
    if (!ordered(raw) && (raw.kind === 'balance' ? controls.reduce((sum,c)=>sum+c.initial-c.goal,0) === 0 :
        controls.every(c => c.initial === c.goal))) throw Error('Puzzle starts already solved.');
    const definition = { version: VERSION, kind: raw.kind, title: clean(raw.title, 70), context: clean(raw.context, 300),
      lore: clean(raw.lore, 320), controls, order: [...order], exhaustionLimit: Math.max(2, Math.min(6, Number(raw.exhaustionLimit) || 4)) };
    if (raw.moduleKit !== undefined) {
      const kit = Modules.kits[raw.moduleKit];
      if (!kit?.kinds.includes(raw.kind) || !Modules.arrangements.includes(raw.arrangement) ||
          !Modules.clueStyles.includes(raw.clueStyle) || !Modules.toolbox().materials.includes(raw.material || kit.material)) throw Error('Invalid or incompatible puzzle modules.');
      definition.moduleKit = raw.moduleKit; definition.arrangement = raw.arrangement; definition.clueStyle = raw.clueStyle;
      definition.material = raw.material || kit.material;
      if (raw.outputLabel !== undefined && !clean(raw.outputLabel, 60)) throw Error('Invalid apparatus output name.');
      if (raw.storyLead !== undefined && !clean(raw.storyLead, 240)) throw Error('Invalid puzzle story lead.');
      if (raw.outputLabel) definition.outputLabel = clean(raw.outputLabel, 60);
      if (raw.storyLead) definition.storyLead = clean(raw.storyLead, 240);
      definition.glyphs = Modules.validateGlyphs(raw.glyphs);
      definition.roomArt = Art.validate(raw.roomArt);
      definition.sculptures = Sculptures.validate(raw.sculptures);
      definition.shrines = Sculptures.validateShrines(raw.shrines);
      definition.readables = Readables.validate(raw.readables);
      definition.inscriptions = Readables.validateInscriptions(raw.inscriptions);
      const labels=[...definition.readables,...definition.inscriptions].map(r=>r.name);
      if(new Set(labels).size!==labels.length || labels.some(n=>controls.some(c=>c.label.toLowerCase()===n)||n==='instruction plaque'||n===receiverLabel(definition).toLowerCase()))
        throw Error('Readable pieces and fixtures must have unambiguous names distinct from controls.');
    }
    if (raw.kind === 'interlock') {
      if (!Array.isArray(raw.couplings) || raw.couplings.length !== controls.length || raw.couplings.some((ids,i) =>
        !Array.isArray(ids) || !ids.includes(controls[i].id) || new Set(ids).size !== ids.length ||
        ids.some(id => !controls.some(c=>c.id===id)))) throw Error('Interlocks must list the actual controls moved by each lever.');
      definition.couplings = raw.couplings.map(ids=>[...ids]);
      if (!findSolution(definition)) throw Error('These interlocks cannot reach their goal. Supply a solvable linkage.');
    }
    definition.id = `mechanism:${hash(JSON.stringify(definition))}`;
    return definition;
  }
  function fallback(seed, roomName = 'the room', context = {}) {
    const n = parseInt(hash(seed), 16), recent=(context.recentKinds||[]).filter(k=>KINDS.includes(k)).slice(-2),
      choices=KINDS.filter(k=>!recent.includes(k)),kind=(choices.length?choices:KINDS)[n%(choices.length||KINDS.length)];
    const symbolSets=[['Sun', 'Wave', 'Moon'], ['Crown', 'Eye', 'Star'], ['Bell', 'Leaf', 'Tower'],['Dragon','Skull','Mountain'],['Key','Serpent','Flame']];
    const marks = symbolSets[(n >>> 4) % symbolSets.length],images=symbolSets[(n>>>6)%symbolSets.length];
    const suffix = Modules.mechanics[kind].suffix;
    const kit = Object.entries(Modules.kits).filter(([,kit])=>kit.kinds.includes(kind))[(n >>> 8) % Object.values(Modules.kits).filter(kit=>kit.kinds.includes(kind)).length];
    return compile({ kind, title: ({sequence:'The Procession Lock',alignment:'The Surveyor\'s Instrument',channels:'The Sluice Regulator',
      interlock:'The Linked Ward',sliding:'The Track Relief',balance:'The Oath Scales',harmonics:'The Echo Score'})[kind],
      context: `In ${String(roomName).replace(/[<>\r\n]/g, ' ').slice(0, 90)}, an ancient mechanism uses ${kit[0].replace(/_/g,' ')} to link its carved controls.`,
      lore: `The awakened mechanism reveals a preserved record of ${String(roomName).replace(/[<>\r\n]/g,' ').slice(0,90)}: its builders maintained this place, and their marks survive.`,
      moduleKit:kit[0],arrangement:Modules.arrangements[(n>>>10)%4],clueStyle:Modules.clueStyles[(n>>>13)%5],material:kit[1].material,
      ...(kind === 'interlock' ? { couplings: marks.map((_,i)=>[`control_${i}`]) } : {}),
      controls: marks.map((mark, i) => ({ id: `control_${i}`, label: `${mark} ${suffix}`, mark,
        options: kind === 'sliding' ? ['Near','Middle','Far'] : images, initial: 0, goal: ['channels','interlock'].includes(kind) ? (i + 1) % 2 : (i + 1) % 3 })),
      order: [1, 0, 2].map(i => `control_${i}`), exhaustionLimit: 4 });
  }
  function clue(p) {
    if (ordered(p)) return (p.kind === 'harmonics' ? 'The carved score reads left to right: ' : 'A carved procession runs left to right: ') + p.order.map(id => p.controls.find(c => c.id === id).mark).join(' -> ') + '. Each carving matches a control.';
    if (p.kind === 'balance') return `The scales call for ${p.controls.reduce((sum,c)=>sum+c.goal,0)} measures in total. Each weight rack carries zero, one or two stones. Any matching total balances the beam.`;
    if (p.kind === 'interlock') return 'Carved rods link each lever to these crests: ' + p.controls.map((c,i)=>`${c.mark} moves ${p.couplings[i].map(id=>p.controls.find(c=>c.id===id).mark).join(' and ')}`).join('; ') +
      '. The destination carving shows ' + p.controls.map(c=>`${c.mark}: ${c.options[c.goal]}`).join('; ') + '. The linkages work in either direction.';
    return (p.kind === 'alignment' ? 'The relief above the instrument pairs each crest with a dial image: ' : p.kind === 'sliding' ? 'The carved track diagram pairs each block with its destination: ' : 'The engraved water diagram shows the required channels: ') +
      p.controls.map(c => `${c.mark}: ${c.options[c.goal]}`).join('; ') + '.';
  }
  function prose(p) {
    const result = receiverLabel(p), clueName = p.clueStyle?.replace(/_/g,' ') || 'instruction plaque';
    const verb=Modules.mechanics[p.kind].verb.replace(/^./,c=>c.toUpperCase());
    return { description: `${p.context} ${p.controls.map(c => c.label).join(', ')} connect to ${result}. A nearby ${clueName} carries the readable visual clue. The apparatus is made of ${p.material || 'stone and metal'}; each action visibly moves its working parts.`,
      solution: (ordered(p) ? `${verb} ${p.order.map(id => p.controls.find(c => c.id === id).label).join(', then ')}.` :
        p.kind === 'interlock' ? findSolution(p).map(move=>`Pull ${p.controls.find(c=>c.id===move.controlId).label}`).join(', then ') +
          '. Targets: '+p.controls.map(c=>`${c.label}: ${c.options[c.goal]}`).join('; ')+'.' :
        `Set ${p.controls.map(c => `${c.label} to ${c.options[c.goal]}`).join('; ')}.`) + ` ${result} responds and reveals its record.` };
  }
  function initialState(p) { return { revision: 0, values: p.controls.map(c => c.initial), progress: [], status: 'ready' }; }
  function solved(p, state) {
    return ordered(p) ? state.progress.length === p.order.length && state.progress.every((id, i) => id === p.order[i]) :
      p.kind === 'balance' ? state.values.reduce((sum,v)=>sum+v,0) === p.controls.reduce((sum,c)=>sum+c.goal,0) :
      p.controls.every((c, i) => state.values[i] === c.goal);
  }
  function validState(p, state) {
    return !!state && Number.isSafeInteger(state.revision) && state.revision >= 0 && Array.isArray(state.values) &&
      state.values.length === p.controls.length && state.values.every((v, i) => Number.isInteger(v) && v >= 0 && v < p.controls[i].options.length) &&
      Array.isArray(state.progress) && state.progress.length <= p.order.length && state.progress.every((id, i) => id === p.order[i]) &&
      (!ordered(p) || p.controls.every((c, i) => state.values[i] === (state.progress.includes(c.id) ? 1 : 0))) &&
      ['ready', 'complete'].includes(state.status) && (state.status === 'complete') === solved(p, state);
  }
  function step(p, state, controlId, value) {
    if (!validState(p, state) || state.status === 'complete') throw Error('The mechanism is already complete or its state is invalid.');
    const index = p.controls.findIndex(c => c.id === controlId), c = p.controls[index];
    if (!c) throw Error('No such control exists in this mechanism.');
    const next = { ...state, values: [...state.values], progress: [...state.progress], revision: state.revision + 1 };
    if (ordered(p)) {
      next.progress = p.order[next.progress.length] === controlId ? [...next.progress, controlId] : p.order[0] === controlId ? [controlId] : [];
      next.values = p.controls.map(c => next.progress.includes(c.id) ? 1 : 0);
    } else {
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value >= c.options.length)) throw Error('That position does not exist.');
      if (p.kind === 'interlock') {
        if (value === undefined || value !== next.values[index]) for (const id of p.couplings[index]) {
          const linked = p.controls.findIndex(c=>c.id===id); next.values[linked] = 1-next.values[linked];
        }
      } else next.values[index] = value ?? (next.values[index] + 1) % c.options.length;
    }
    next.status = solved(p, next) ? 'complete' : 'ready';
    return next;
  }
  function findSolution(p, start = initialState(p)) {
    const keyOf = state=>JSON.stringify([state.values,state.progress]);
    const queue = [{ state:start, moves:[] }], visited = new Set([keyOf(start)]);
    for (let i=0;i<queue.length && i<256;i++) {
      const {state,moves} = queue[i];
      if (state.status==='complete' || solved(p,state)) return moves;
      for (const c of p.controls) {
        const next=step(p,state,c.id),key=keyOf(next);
        if (visited.has(key)) continue; visited.add(key);
        queue.push({state:next,moves:[...moves,{controlId:c.id}]});
      }
    }
    return null;
  }
  function command(p, fixture) {
    if (fixture.id === 'plaque') return 'read instruction plaque';
    if (fixture.id === 'receiver') return 'inspect ' + receiverLabel(p);
    return `${Modules.mechanics[p.kind].verb} ${fixture.label}`;
  }
  function intent(input, p) {
    const text = String(input).trim().replace(/[.!]+$/, '').toLowerCase();
    if (/^(read|inspect|examine|look at) (the )?instruction plaque$/.test(text)) return { controlId: 'plaque', inspect: true };
    if (/^(read|inspect|examine|look at) (the )?(floor mosaic|wall relief|star chart|carved tablet|woven banner)$/.test(text)) return { controlId:'plaque',inspect:true };
    if (['inspect ','examine ','open ','look at '].some(prefix=>text===prefix+receiverLabel(p).toLowerCase() || text===prefix+'the '+receiverLabel(p).toLowerCase())) return {controlId:'receiver',inspect:true};
    for (const c of p.controls) {
      const label = c.label.toLowerCase();
      if (['inspect ', 'examine ', 'look at '].some(prefix => text === prefix + label || text === prefix + 'the ' + label)) return { controlId: c.id, inspect: true };
      const verb = Modules.mechanics[p.kind].verb;
      const prefixes = [verb, 'use', 'activate', ...(['channels','interlock'].includes(p.kind) ? ['toggle','set'] : p.kind === 'alignment' ? ['rotate','set'] :
        ['sliding','balance'].includes(p.kind) ? ['move','set'] : ['push','touch'])];
      for (const prefix of prefixes) for (const article of ['', 'the ']) {
        const head = `${prefix} ${article}${label}`;
        if (text === head) return { controlId: c.id };
        if (!ordered(p) && text.startsWith(head + ' to ')) {
          const value = c.options.findIndex(s => s.toLowerCase() === text.slice(head.length + 4));
          return value < 0 ? { controlId: c.id, invalid: true } : { controlId: c.id, value };
        }
      }
    }
    return null;
  }
  const floor = c => c && !c.blocked && !c.obstacle && c.walkable !== false && (c.tile === 'floor' || c.tile === 'door' && c.door?.isOpen);
  function reachable(dungeon, blocked = new Set()) {
    const { width: w, height: h } = dungeon.layout, seen = new Uint8Array(w * h), q = [];
    const first = dungeon.start.x + dungeon.start.y * w;
    if (!floor(dungeon.cells[`${dungeon.start.x},${dungeon.start.y}`])) return { seen, count: 0 };
    seen[first] = 1; q.push(first);
    for (let head = 0; head < q.length; head++) {
      const i = q[head], x = i % w, y = Math.floor(i / w), z = dungeon.cells[`${x},${y}`].floorHeight || 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, j = nx + ny * w, k = `${nx},${ny}`, c = dungeon.cells[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[j] || blocked.has(k) || !floor(c) || Math.abs((c.floorHeight || 0) - z) > .75) continue;
        seen[j] = 1; q.push(j);
      }
    }
    return { seen, count: q.length };
  }
  function fixtureShape(p, f, state) {
    if (f.id === 'plaque') return 'puzzle_plaque';
    if (f.id === 'receiver') return `puzzle_${receiver(p)}_${state.status === 'complete' ? 'open' : 'closed'}`;
    const i = p.controls.findIndex(c => c.id === f.id), v = state.values[i];
    return `puzzle_${({alignment:'dial',channels:'lever',interlock:'lever',sliding:'slider',balance:'weight',harmonics:'chime',sequence:'button'})[p.kind]}_${v}`;
  }
  function fixtureAxis(dungeon, f) {
    const [x, y] = f.key.split(',').map(Number), start = dungeon.start || { x, y };
    const adjacent = [[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy]) => floor(dungeon.cells[`${x+dx},${y+dy}`]))
      .sort(([ax,ay],[bx,by]) => Math.hypot(x+ax-start.x,y+ay-start.y)-Math.hypot(x+bx-start.x,y+by-start.y));
    return adjacent[0]?.[0] ? 'x' : 'y';
  }
  function visualSpec(dungeon, tileName) {
    const spec = dungeon.tiles?.[tileName]?.spriteSpec;
    if (!spec?.voxelShape?.startsWith('puzzle_')) return spec;
    const e = dungeon.physicalPuzzle, f = e?.fixtures.find(f => f.tiles.includes(tileName));
    if (!f) return spec;
    const c = e.definition.controls.find(c => c.id === f.id), variant = f.tiles.indexOf(tileName);
    const value = f.id==='receiver' ? e.state.status==='complete' ? 1 : 0 : c ? e.state.values[c.index] : 0;
    const sculpture=spec.voxelShape.startsWith('puzzle_statue')?{...spec.puzzleFace?.sculpture,
      workmanship:spec.puzzleFace?.sculpture?.workmanship||'carved'}:null;
    const engraving=f.id==='plaque'?{heading:e.definition.title,text:clue(e.definition),seed:e.definition.id}:null;
    const engravingPairs=engraving?(ordered(e.definition)?e.definition.order.map(id=>({mark:e.definition.controls.find(c=>c.id===id).mark,option:''})):
      e.definition.controls.map(c=>({mark:c.mark,option:c.options[c.goal]}))):null;
    return { ...spec, puzzleFace: { ...spec.puzzleFace, axis: f.axis || fixtureAxis(dungeon, f), mark: c?.mark || '', option: c?.options[variant] || '',
      ...(sculpture?{sculpture}:{}),
      ...(engraving?{engraving,engravingPairs}:{}),
      ...(Motion ? { pose:Motion.pose(dungeon,f.id,value) } : {}), glyphs:e.definition.glyphs || [] } };
  }
  function isReservedScenery(p, feature) {
    if (!p) return false;
    const text = (typeof feature === 'string' ? feature :
      [feature?.type, feature?.label, feature?.name, feature?.sceneLandmark?.label].filter(Boolean).join(' '))
      .toLowerCase().replace(/_/g, ' ');
    return /\b(dials?|buttons?|levers?|instruction plaques?|reading cabinets?)\b/.test(text) ||
      p.controls?.some(c=>text.includes(c.label.toLowerCase())) || !!p.outputLabel && text.includes(p.outputLabel.toLowerCase());
  }
  function enrichSceneSpec(spec) {
    if (!spec?.puzzleMechanism) return null;
    const reserved = feature => isReservedScenery(spec.puzzleMechanism, feature);
    const omitted = (spec.landmarks || []).filter(reserved).map(l => l.label || l.type);
    spec.landmarks = (spec.landmarks || []).filter(l => !reserved(l));
    for (const [i,s] of (spec.puzzleMechanism.sculptures || []).entries()) {
      if (!spec.landmarks.some(l=>l.sculpture?.label===s.label)) spec.landmarks.push({type:`carved_statue_${i}`,label:s.label,count:1,condition:[],sculpture:s});
    }
    for(const shrine of spec.puzzleMechanism.shrines || [])if(!spec.landmarks.some(l=>l.shrine?.label===shrine.label))
      spec.landmarks.push({type:shrine.type,label:shrine.label,count:1,condition:[],shrine});
    for(const r of spec.puzzleMechanism.inscriptions||[])if(!spec.landmarks.some(l=>l.inscription?.id===r.id))
      spec.landmarks.push({type:`${r.type}_${r.id}`,label:r.name,count:1,condition:[],inscription:{...r,mechanismId:spec.puzzleMechanism.id}});
    if (spec.level) spec.level = { ...spec.level,
      structures: (spec.level.structures || []).filter(s => !reserved(s)),
      layoutFeatures: (spec.level.layoutFeatures || []).filter(s => !reserved(s)) };
    spec.puzzleRenderContract = { owner: 'physical-puzzle-builder', omittedScenery: omitted };
    return spec.puzzleRenderContract;
  }
  function safeRemoval(dungeon, c, blocked) {
    const adjacent = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => `${c.x + dx},${c.y + dy}`)
      .filter(k => !blocked.has(k) && floor(dungeon.cells[k]));
    if (!adjacent.length) return false;
    const seen = new Set([adjacent[0]]), q = [adjacent[0]];
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i].split(',').map(Number), z = dungeon.cells[q[i]].floorHeight || 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`, cell = dungeon.cells[k];
        if (Math.abs(nx - c.x) > 2 || Math.abs(ny - c.y) > 2 || seen.has(k) || blocked.has(k) ||
            !floor(cell) || Math.abs((cell.floorHeight || 0) - z) > .75) continue;
        seen.add(k); q.push(k);
      }
    }
    return adjacent.every(k => seen.has(k));
  }
  function svg(p, f, state) {
    const i = p.controls.findIndex(c => c.id === f.id), value = i < 0 ? '' : p.controls[i].options[state.values[i]];
    const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
    const lit = f.id === 'receiver' ? state.status === 'complete' : state.values[i] > 0;
    const symbol=(name,x,y,size,color='#ffe9ae')=>Modules.bitmap(name,p.glyphs).flatMap((row,yy)=>[...row].flatMap((pixel,xx)=>
      pixel==='1' ? [`<rect x="${x+xx*size/7}" y="${y+yy*size/7}" width="${size/7+.1}" height="${size/7+.1}" fill="${color}"/>`] : [])).join('');
    const body=f.palette?.primary || '#34464f', trim=f.palette?.secondary || '#ccab6b';
    let drawing='';
    if (f.id==='plaque') {
      const pairs=ordered(p) ? p.order.map(id=>({mark:p.controls.find(c=>c.id===id).mark,option:''})) : p.controls.map(c=>({mark:c.mark,option:c.options[c.goal]}));
      drawing=pairs.map((c,j)=>symbol(c.mark,22,14+j*23,18)+symbol(c.option || 'star',86,14+j*23,18)+
        `<path d="M49 ${23+j*23}h27l-5-4m5 4l-5 4" fill="none" stroke="${trim}" stroke-width="2"/>`).join('');
    } else if (f.id==='receiver') {
      drawing=symbol(({beacon:'star',statue:'crown',fountain:'wave',iris:'eye',gate:'tower',mosaic:'moon',cabinet:'key',altar:'flame'})[receiver(p)],36,24,56,lit?'#b8ffe4':'#baa887');
    } else if (p.kind==='alignment') {
      drawing='<circle cx="64" cy="58" r="43" fill="none" stroke="'+trim+'" stroke-width="5"/>';
      const c=p.controls[i],a=state.values[i]*Math.PI*2/3;
      drawing+=c.options.map((name,j)=>symbol(name,55+Math.sin(j*Math.PI*2/3)*30,49-Math.cos(j*Math.PI*2/3)*30,18)).join('');
      drawing+=`<path d="M64 58L${64+Math.sin(a)*21} ${58-Math.cos(a)*21}" stroke="#ea6554" stroke-width="5"/>`;
    } else if (p.kind==='sliding') {
      drawing=[0,1,2].map(v=>`<rect x="${16+v*33}" y="30" width="28" height="40" fill="${v===state.values[i]?trim:'#1c2f35'}" stroke="#f2e3b3"/>`).join('')+symbol(p.controls[i].mark,20+state.values[i]*33,37,20,'#172c32');
    } else if (p.kind==='balance') {
      drawing='<path d="M24 68h80M64 29v44m-40-5l9 10h-18z" stroke="'+trim+'" fill="none" stroke-width="5"/>'+
        Array.from({length:state.values[i]},(_,j)=>`<rect x="${70+j*14}" y="42" width="12" height="21" fill="#ffe9ae"/>`).join('');
    } else drawing=symbol(p.controls[i].mark,34,24,60,lit?'#b8ffe4':'#ffe9ae');
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect x="9" y="7" width="110" height="114" rx="6" fill="${body}" stroke="${trim}" stroke-width="5"/>${drawing}<text x="64" y="110" text-anchor="middle" font-family="Georgia" font-size="9" fill="#fff0cb">${escape(value || f.label)}</text></svg>`);
  }
  function applyVisualState(dungeon, state) {
    const e = dungeon.physicalPuzzle, cells = {};
    for (const f of e.fixtures) {
      const tile = f.tiles[f.id === 'plaque' ? 0 : f.id === 'receiver' ? (state.status === 'complete' ? 1 : 0) : state.values[e.definition.controls.findIndex(c => c.id === f.id)]];
      cells[f.key] = { ...dungeon.cells[f.key], tile, feature: tile };
    }
    return { cells, physicalPuzzle: { ...e, state: JSON.parse(JSON.stringify(state)) } };
  }
  function install(dungeon, spec = {}) {
    if (dungeon.physicalPuzzle) return { status: 'existing', id: dungeon.physicalPuzzle.definition.id };
    if (!spec.puzzleMechanism) return { status: 'skipped', reason: 'no-physical-design' };
    const p = compile(spec.puzzleMechanism), state = spec.puzzleMechanism.state || initialState(p);
    if (!validState(p, state)) throw Error('Invalid saved puzzle state.');
    const { width: w, height: h } = dungeon.layout || {};
    if (!(w > 6 && h > 6 && w <= 512 && h <= 512) || !dungeon.start) throw Error('Invalid puzzle room layout.');
    const reach = reachable(dungeon), candidates = [], occupied = new Set((dungeon.sceneObjects || []).map(o => `${o.x},${o.y}`));
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const k = `${x},${y}`, c = dungeon.cells[k], d = Math.hypot(x - dungeon.start.x, y - dungeon.start.y);
      if (d < 3 || !reach.seen[x + y * w] || c.tile !== 'floor' || c.feature || c.interactable || c.navigationReserved || c.exit || c.door || occupied.has(k)) continue;
      if (Number.isFinite(c.ceilHeight) && c.ceilHeight - (c.floorHeight || 0) < 1.35) continue;
      const ns = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => dungeon.cells[`${x + dx},${y + dy}`]);
      if (ns.some(n => n?.exit || n?.door) || ns.filter(floor).length < 2) continue;
      candidates.push({ x, y, key: k, d });
    }
    candidates.sort((a, b) => a.d - b.d);
    const count = p.controls.length + 2;
    let chosen = null;
    for (const anchor of candidates.slice(0, 32)) {
      const templates={row:[[-3,0],[-1,0],[1,0],[3,0],[-1,2],[1,2]],arc:[[-3,1],[-2,-1],[0,-2],[2,-1],[-1,2],[2,2]],
        opposed:[[-2,-2],[2,-2],[-2,1],[2,1],[0,-3],[0,3]],staggered:[[-2,-2],[0,-1],[2,0],[-2,1],[0,2],[2,3]]};
      const pattern=templates[p.arrangement] || templates.staggered,quarter=parseInt(hash(p.id),16)%4;
      const targets=pattern.map(([x,y])=>quarter===0?[x,y]:quarter===1?[-y,x]:quarter===2?[-x,-y]:[y,-x]);
      const local = candidates.filter(c => Math.hypot(c.x - anchor.x, c.y - anchor.y) <= 6 &&
        Math.abs((dungeon.cells[c.key].floorHeight || 0) - (dungeon.cells[anchor.key].floorHeight || 0)) <= .75)
        .sort((a,b) => Math.hypot(a.x-anchor.x,a.y-anchor.y)-Math.hypot(b.x-anchor.x,b.y-anchor.y));
      const selected = [], blocked = new Set();
      for(const [tx,ty] of targets.slice(0,count)){
        for (const c of local.slice().sort((a,b)=>Math.hypot(a.x-anchor.x-tx,a.y-anchor.y-ty)-Math.hypot(b.x-anchor.x-tx,b.y-anchor.y-ty))) {
          if (selected.some(s => Math.max(Math.abs(s.x - c.x), Math.abs(s.y - c.y)) < 2)) continue;
          blocked.add(c.key);
          if (!safeRemoval(dungeon, c, blocked)) { blocked.delete(c.key); continue; }
          selected.push(c);break;
        }
      }
      if (selected.length === count) { chosen = selected; break; }
    }
    if (!chosen && !dungeon.puzzleAlcove && dungeon.classification?.indoor !== false) {
      // New-layout fallback only: carve a modest workshop recess in plain, unreserved masonry.
      const anchors = candidates.length ? candidates.slice(0, 64) : Object.entries(dungeon.cells).filter(([key, c]) => {
        const [x, y] = key.split(',').map(Number);
        return c.tile === 'floor' && reach.seen[x + y * w];
      }).map(([key]) => ({ key, ...Object.fromEntries(key.split(',').map((n, i) => [i ? 'y' : 'x', Number(n)])) })).slice(0, 64);
      for (const a of anchors) {
        const z = dungeon.cells[a.key].floorHeight || 0;
        for (const [dx, dy] of [[1, -2], [-5, -2], [-2, 1], [-2, -5]]) {
          const x = a.x + dx, y = a.y + dy, keys = [];
          if (x < 1 || y < 1 || x + 5 >= w || y + 5 >= h) continue;
          for (let yy = y; yy < y + 5; yy++) for (let xx = x; xx < x + 5; xx++) keys.push(`${xx},${yy}`);
          if (keys.some(k => {
            const c = dungeon.cells[k];
            return !c || !['wall', 'floor'].includes(c.tile) || c.feature || c.architectureRole || c.exteriorRole || c.roof ||
              c.interactable || c.navigationReserved || c.exit || c.door || c.blocked || c.obstacle || occupied.has(k) ||
              c.tile === 'floor' && Math.abs((c.floorHeight || 0) - z) > .75;
          })) continue;
          const saved = keys.map(k => dungeon.cells[k]);
          for (const k of keys) dungeon.cells[k] = { ...dungeon.cells[k], tile: 'floor', floorHeight: z, ceilHeight: z + 2.4 };
          dungeon.puzzleAlcove = { x, y, width: 5, height: 5 };
          try { return install(dungeon, spec); }
          catch (error) { keys.forEach((k, i) => { dungeon.cells[k] = saved[i]; }); delete dungeon.puzzleAlcove; }
        }
      }
    }
    if (!chosen) throw Error('No connected, reachable site for every puzzle component. No incomplete puzzle was built.');
    dungeon.tiles ||= {};
    const material=p.material || 'metal',palette=dungeon.visualStyle?.palette || {};
    const fixtures = [...p.controls, { id: 'plaque', label: 'instruction plaque' }, { id: 'receiver', label: receiverLabel(p) }].map((c, i) => {
      const height = c.id === 'plaque' || c.id === 'receiver' ? 1 : ['channels','interlock','harmonics'].includes(p.kind) ? 1.15 : p.kind === 'alignment' ? 1.05 : .95;
      const f = { id: c.id, label: c.label, key: chosen[i].key, width: .7, height, tiles: [] };
      f.palette={primary:palette.primary || '#42555d',secondary:palette.secondary || '#be955c',highlight:'#ffe2a0',shadow:palette.shadow || '#283539'};
      f.axis = fixtureAxis(dungeon, f);
      const sculpture=Sculptures.normalize(p.sculptures?.find(s=>s.deity)||{label:receiverLabel(p),pose:'offering',head:'bare',robe:'pleated',attribute:'none',form:'wraith'});
      const variants = c.id === 'plaque' ? 1 : c.id === 'receiver' ? 2 : p.controls[i].options.length;
      for (let v = 0; v < variants; v++) {
        const tile = `custom_puzzle_${hash(p.id)}_${i}_${v}`;
        const demo = { ...state, values: [...state.values], status: c.id === 'receiver' && v === 1 ? 'complete' : 'ready' };
        if (i < p.controls.length) demo.values[i] = v;
        dungeon.tiles[tile] = { url: svg(p, f, demo), spriteSpec: { voxelShape: fixtureShape(p, f, demo), baseWidth: f.width, gridWidth: f.width,
          heightRatio: .4, material, collisionRadius: .35,
          puzzleFace: { axis: f.axis, mark: c.mark || '', option: c.options?.[v] || '',glyphs:p.glyphs || [],
            ...(c.id==='receiver'&&receiver(p)==='statue'?{sculpture}:{}),
            clue:p.controls.map(c=>({mark:c.mark,option:c.options[c.goal]})) },
          palette:f.palette } };
        f.tiles.push(tile);
      }
      return f;
    });
    dungeon.physicalPuzzle = { version: VERSION, definition: p, state, fixtures,
      assembly:{kit:p.moduleKit || 'sealed_archive',arrangement:p.arrangement || 'staggered',material,clueStyle:p.clueStyle || 'carved_tablet',receiver:receiver(p)} };
    Object.assign(dungeon.cells, applyVisualState(dungeon, state).cells);
    for (const f of fixtures) Object.assign(dungeon.cells[f.key], { puzzleFixture: f.id, navigationReserved: true, structureHeight: f.height });
    const proof = verify(dungeon);
    if (!proof.valid) throw Error('Physical puzzle construction failed verification.');
    dungeon.physicalPuzzle.buildProof = proof;
    return { status: 'built', id: p.id, kind: p.kind, ...proof };
  }
  function inReach(dungeon, actor, fixture) {
    if (!actor || !Number.isFinite(actor.x) || !Number.isFinite(actor.y) || !fixture) return false;
    const [x, y] = fixture.key.split(',').map(Number), dx = x + .5 - actor.x, dy = y + .5 - actor.y, d = Math.hypot(dx, dy);
    if (d > 2.25) return false;
    const z = dungeon.cells[`${Math.floor(actor.x)},${Math.floor(actor.y)}`]?.floorHeight || 0;
    if (Math.abs((dungeon.cells[fixture.key]?.floorHeight || 0) - z) > .75) return false;
    const steps = Math.max(1, Math.ceil(d * 10));
    for (let i = 0; i <= steps; i++) {
      const k = `${Math.floor(actor.x + dx * i / steps)},${Math.floor(actor.y + dy * i / steps)}`;
      if (k === fixture.key) continue;
      if (!floor(dungeon.cells[k])) return false;
    }
    return true;
  }
  function verify(dungeon) {
    const e = dungeon.physicalPuzzle;
    if (!e || !validState(e.definition, e.state)) return { valid: false, reason: 'missing-mechanism' };
    const { width: w } = dungeon.layout, reach = reachable(dungeon), errors = [];
    const ids = [...e.definition.controls.map(c => c.id), 'plaque', 'receiver'];
    if (e.fixtures.length !== ids.length || new Set(e.fixtures.map(f => f.key)).size !== ids.length) errors.push('wrong-component-count');
    for (const id of ids) {
      const fs = e.fixtures.filter(f => f.id === id), f = fs[0];
      if (fs.length !== 1 || !f || !dungeon.cells[f.key]?.puzzleFixture || !f.tiles.includes(dungeon.cells[f.key].tile) ||
          f.tiles.some((t,v) => {
            const demo = { ...e.state, values: [...e.state.values], status: id === 'receiver' && v === 1 ? 'complete' : 'ready' };
            const i = e.definition.controls.findIndex(c => c.id === id);
            if (i >= 0) demo.values[i] = v;
            return dungeon.tiles[t]?.spriteSpec?.voxelShape !== fixtureShape(e.definition,f,demo) || !dungeon.tiles[t]?.url;
          })) { errors.push(`missing:${id}`); continue; }
      const [x, y] = f.key.split(',').map(Number);
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach.seen[x + dx + (y + dy) * w] && inReach(dungeon, { x: x + dx + .5, y: y + dy + .5 }, f))) errors.push(`unreachable:${id}`);
    }
    if (!findSolution(e.definition,e.state)) errors.push('unreachable-solution');
    return { valid: !errors.length, components: ids.length, reachableTiles: reach.count, solvable:!errors.includes('unreachable-solution'), errors };
  }
  function feedback(p, state, id) {
    if (state.status === 'complete') return `The ${receiverLabel(p)} ${receiver(p)==='cabinet'?'opens; its carved panel is now visible':'awakens; its hidden record becomes visible'}. ${p.lore}${p.storyLead ? ' '+p.storyLead : ''}`;
    const c = p.controls.find(c => c.id === id), i = p.controls.indexOf(c);
    if (p.kind==='balance') return `${c.label} carries ${state.values[i]} stones. The beam reads ${state.values.reduce((sum,v)=>sum+v,0)} of ${p.controls.reduce((sum,c)=>sum+c.goal,0)} measures. The weights remain adjustable.`;
    return ordered(p) ? `${c.label} ${p.kind==='harmonics'?'rings':'clicks'}. ${state.progress.length ? 'A rune lights on '+receiverLabel(p)+'.' : 'The runes go dark; the mechanism resets safely and can be tried again.'}` :
      `${c.label} moves to ${c.options[state.values[i]]}.${p.kind==='interlock'?' Its linked levers move with it.':''} ${receiverLabel(p)} remains dormant. Compare the marks with the nearby diagram.`;
  }
  const HINT_POLICY = 'PUZZLE HINT DISCIPLINE: Companions are observers, not omniscient walkthroughs. Never volunteer the solution, button order, target dial positions or a full action sequence, even from recalled private solution metadata. When explicitly asked for a hint, offer one observation about the visible clue or the mechanism\'s feedback, then let the player decide and try. Do not invent invisible ritual steps, mandatory words or philosophical intentions. Only a server-verified mechanism transition can complete a physical puzzle; narration cannot change its controls or give its reward. Ordinary use is reliable and retryable, never a limited Search attempt or a random failure roll.';
  return { VERSION, KINDS, compile, fallback, clue, prose, initialState, validState, solved, step, command, intent, install, verify, inReach,
    applyVisualState, visualSpec, feedback, HINT_POLICY, enrichSceneSpec, isReservedScenery,findSolution,receiver,receiverLabel,toolbox:Modules.toolbox,
    beginMotion:Motion.begin, motionActive:Motion.active, svg };
});
