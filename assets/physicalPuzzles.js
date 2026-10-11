(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhysicalPuzzles = api;
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  const VERSION = 2, KINDS = ['sequence', 'alignment', 'channels'];
  const clean = (s, n = 100) => typeof s === 'string' && s.trim().length <= n && !/[<>\r\n]/.test(s) ? s.trim() : '';
  const hash = text => {
    let h = 2166136261;
    for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0).toString(16);
  };
  function compile(raw) {
    if (!raw || !KINDS.includes(raw.kind) || !clean(raw.title, 70) || !clean(raw.context, 300) ||
        !clean(raw.lore, 320) || !Array.isArray(raw.controls) || raw.controls.length < 2 || raw.controls.length > 4) throw Error('Invalid physical puzzle design.');
    const controls = raw.controls.map((c, i) => {
      const suffix = raw.kind === 'sequence' ? 'button' : raw.kind === 'alignment' ? 'dial' : 'lever';
      if (!c || ['plaque', 'receiver'].includes(c.id) || !/^[a-z][a-z0-9_]{0,23}$/.test(c.id) || !clean(c.label, 45) ||
          !c.label.toLowerCase().endsWith(' ' + suffix) ||
          !/^[a-z][a-z0-9 '-]+$/i.test(c.label) || !clean(c.mark, 28) || /^(ash|ember|bone)( seal)?$/i.test(c.label)) throw Error('Invalid puzzle control.');
      const options = raw.kind === 'sequence' ? ['raised', 'lit'] : raw.kind === 'channels' ? ['closed', 'open'] : c.options;
      if (!Array.isArray(options) || options.length !== (raw.kind === 'alignment' ? 3 : 2) ||
          options.some(s => !clean(s, 25)) || new Set(options.map(s => s.toLowerCase())).size !== options.length) throw Error('Invalid dial positions.');
      const goal = raw.kind === 'sequence' ? 1 : c.goal, initial = raw.kind === 'sequence' ? 0 : c.initial;
      if (!Number.isInteger(goal) || !Number.isInteger(initial) || goal < 0 || initial < 0 ||
          goal >= options.length || initial >= options.length) throw Error('Invalid control state.');
      return { id: c.id, label: clean(c.label, 45), mark: clean(c.mark, 28), options: options.map(s => clean(s, 25)), initial, goal, index: i };
    });
    if (new Set(controls.map(c => c.id)).size !== controls.length ||
        new Set(controls.map(c => c.label.toLowerCase())).size !== controls.length ||
        new Set(controls.map(c => c.mark.toLowerCase())).size !== controls.length) throw Error('Puzzle controls must be distinguishable.');
    if (['ash', 'ember', 'bone'].every(mark => controls.some(c => c.mark.toLowerCase() === mark))) throw Error('The retired seal puzzle cannot be regenerated.');
    const order = raw.kind === 'sequence' ? raw.order : [];
    if (raw.kind === 'sequence' && (!Array.isArray(order) || order.length !== controls.length ||
        new Set(order).size !== controls.length || order.some(id => !controls.some(c => c.id === id)))) throw Error('Sequence references missing controls.');
    if (raw.kind !== 'sequence' && controls.every(c => c.initial === c.goal)) throw Error('Puzzle starts already solved.');
    const definition = { version: VERSION, kind: raw.kind, title: clean(raw.title, 70), context: clean(raw.context, 300),
      lore: clean(raw.lore, 320), controls, order: [...order], exhaustionLimit: Math.max(2, Math.min(6, Number(raw.exhaustionLimit) || 4)) };
    definition.id = `mechanism:${hash(JSON.stringify(definition))}`;
    return definition;
  }
  function fallback(seed, roomName = 'the room') {
    const n = parseInt(hash(seed), 16), kind = KINDS[n % KINDS.length];
    const marks = [['Sun', 'Wave', 'Moon'], ['Crown', 'Eye', 'Star'], ['Bell', 'Leaf', 'Tower']][(n >>> 4) % 3];
    const suffix = kind === 'sequence' ? 'button' : kind === 'alignment' ? 'dial' : 'lever';
    return compile({ kind, title: kind === 'sequence' ? 'The Procession Lock' : kind === 'alignment' ? 'The Surveyor\'s Instrument' : 'The Sluice Regulator',
      context: `A weathered mechanism in ${String(roomName).replace(/[<>\r\n]/g, ' ').slice(0, 90)} connects marked controls to a closed stone reading cabinet.`,
      lore: 'The cabinet opens to reveal an old survey: travellers once maintained these routes, and their repairs still bear witness to an inhabited underworld.',
      controls: marks.map((mark, i) => ({ id: `control_${i}`, label: `${mark} ${suffix}`, mark,
        options: ['Sun', 'Wave', 'Moon'], initial: 0, goal: kind === 'channels' ? (i + 1) % 2 : (i + 1) % 3 })),
      order: [1, 0, 2].map(i => `control_${i}`), exhaustionLimit: 4 });
  }
  function clue(p) {
    if (p.kind === 'sequence') return 'A carved procession runs left to right: ' + p.order.map(id => p.controls.find(c => c.id === id).mark).join(' -> ') + '. Each carving matches a button.';
    return (p.kind === 'alignment' ? 'The relief above the instrument pairs each crest with a dial image: ' : 'The engraved water diagram shows the required channels: ') +
      p.controls.map(c => `${c.mark}: ${c.options[c.goal]}`).join('; ') + '.';
  }
  function prose(p) {
    return { description: `${p.context} ${p.controls.map(c => c.label).join(', ')} stand beside a readable instruction plaque and a closed reading cabinet. Its engraved diagram can be examined up close. The controls respond to a hand; the cabinet responds visibly.`,
      solution: p.kind === 'sequence' ? `Press ${p.order.map(id => p.controls.find(c => c.id === id).label).join(', then ')}. The cabinet opens and reveals its carving.` :
        `Set ${p.controls.map(c => `${c.label} to ${c.options[c.goal]}`).join('; ')}. The cabinet opens and reveals its carving.` };
  }
  function initialState(p) { return { revision: 0, values: p.controls.map(c => c.initial), progress: [], status: 'ready' }; }
  function solved(p, state) {
    return p.kind === 'sequence' ? state.progress.length === p.order.length && state.progress.every((id, i) => id === p.order[i]) :
      p.controls.every((c, i) => state.values[i] === c.goal);
  }
  function validState(p, state) {
    return !!state && Number.isSafeInteger(state.revision) && state.revision >= 0 && Array.isArray(state.values) &&
      state.values.length === p.controls.length && state.values.every((v, i) => Number.isInteger(v) && v >= 0 && v < p.controls[i].options.length) &&
      Array.isArray(state.progress) && state.progress.length <= p.order.length && state.progress.every((id, i) => id === p.order[i]) &&
      (p.kind !== 'sequence' || p.controls.every((c, i) => state.values[i] === (state.progress.includes(c.id) ? 1 : 0))) &&
      ['ready', 'complete'].includes(state.status) && (state.status === 'complete') === solved(p, state);
  }
  function step(p, state, controlId, value) {
    if (!validState(p, state) || state.status === 'complete') throw Error('The mechanism is already complete or its state is invalid.');
    const index = p.controls.findIndex(c => c.id === controlId), c = p.controls[index];
    if (!c) throw Error('No such control exists in this mechanism.');
    const next = { ...state, values: [...state.values], progress: [...state.progress], revision: state.revision + 1 };
    if (p.kind === 'sequence') {
      next.progress = p.order[next.progress.length] === controlId ? [...next.progress, controlId] : p.order[0] === controlId ? [controlId] : [];
      next.values = p.controls.map(c => next.progress.includes(c.id) ? 1 : 0);
    } else {
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value >= c.options.length)) throw Error('That position does not exist.');
      next.values[index] = value ?? (next.values[index] + 1) % c.options.length;
    }
    next.status = solved(p, next) ? 'complete' : 'ready';
    return next;
  }
  function command(p, fixture) {
    if (fixture.id === 'plaque') return 'read instruction plaque';
    if (fixture.id === 'receiver') return 'inspect reading cabinet';
    return `${p.kind === 'sequence' ? 'press' : p.kind === 'alignment' ? 'turn' : 'pull'} ${fixture.label}`;
  }
  function intent(input, p) {
    const text = String(input).trim().replace(/[.!]+$/, '').toLowerCase();
    if (/^(read|inspect|examine|look at) (the )?instruction plaque$/.test(text)) return { controlId: 'plaque', inspect: true };
    if (/^(inspect|examine|open|look at) (the )?reading cabinet$/.test(text)) return { controlId: 'receiver', inspect: true };
    for (const c of p.controls) {
      const label = c.label.toLowerCase();
      if (['inspect ', 'examine ', 'look at '].some(prefix => text === prefix + label || text === prefix + 'the ' + label)) return { controlId: c.id, inspect: true };
      const verb = p.kind === 'sequence' ? 'press' : p.kind === 'alignment' ? 'turn' : 'pull';
      const prefixes = [verb, 'use', 'activate', ...(p.kind === 'channels' ? ['toggle', 'set'] : p.kind === 'alignment' ? ['rotate', 'set'] : ['push', 'touch'])];
      for (const prefix of prefixes) for (const article of ['', 'the ']) {
        const head = `${prefix} ${article}${label}`;
        if (text === head) return { controlId: c.id };
        if (p.kind !== 'sequence' && text.startsWith(head + ' to ')) {
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
    if (f.id === 'receiver') return `puzzle_cabinet_${state.status === 'complete' ? 'open' : 'closed'}`;
    const i = p.controls.findIndex(c => c.id === f.id), v = state.values[i];
    return p.kind === 'alignment' ? `puzzle_dial_${v}` : p.kind === 'channels' ? `puzzle_lever_${v}` : `puzzle_button_${v}`;
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
    return { ...spec, puzzleFace: { axis: f.axis || fixtureAxis(dungeon, f), mark: c?.mark || '', option: c?.options[variant] || '' } };
  }
  function isReservedScenery(p, feature) {
    if (!p) return false;
    const text = (typeof feature === 'string' ? feature :
      [feature?.type, feature?.label, feature?.name, feature?.sceneLandmark?.label].filter(Boolean).join(' '))
      .toLowerCase().replace(/_/g, ' ');
    return /\b(dials?|buttons?|levers?|instruction plaques?|reading cabinets?)\b/.test(text);
  }
  function enrichSceneSpec(spec) {
    if (!spec?.puzzleMechanism) return null;
    const reserved = feature => isReservedScenery(spec.puzzleMechanism, feature);
    const omitted = (spec.landmarks || []).filter(reserved).map(l => l.label || l.type);
    spec.landmarks = (spec.landmarks || []).filter(l => !reserved(l));
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
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect x="12" y="25" width="104" height="92" rx="9" fill="#343e42" stroke="${lit ? '#f2cd79' : '#adaeaa'}" stroke-width="7"/><circle cx="64" cy="51" r="17" fill="${lit ? '#f2cd79' : '#65767a'}"/><text x="64" y="87" text-anchor="middle" font-size="12" fill="#fff0cb">${escape(f.label)}</text><text x="64" y="105" text-anchor="middle" font-size="12" fill="#fff0cb">${escape(value)}</text></svg>`);
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
      const local = candidates.filter(c => Math.hypot(c.x - anchor.x, c.y - anchor.y) <= 6 &&
        Math.abs((dungeon.cells[c.key].floorHeight || 0) - (dungeon.cells[anchor.key].floorHeight || 0)) <= .75)
        .sort((a,b) => Math.hypot(a.x-anchor.x,a.y-anchor.y)-Math.hypot(b.x-anchor.x,b.y-anchor.y));
      const selected = [], blocked = new Set();
      for (const c of local) {
        if (selected.some(s => Math.max(Math.abs(s.x - c.x), Math.abs(s.y - c.y)) < 2)) continue;
        blocked.add(c.key);
        if (!safeRemoval(dungeon, c, blocked)) { blocked.delete(c.key); continue; }
        selected.push(c);
        if (selected.length === count) break;
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
    const fixtures = [...p.controls, { id: 'plaque', label: 'instruction plaque' }, { id: 'receiver', label: 'reading cabinet' }].map((c, i) => {
      const height = c.id === 'plaque' || c.id === 'receiver' ? 1 : p.kind === 'channels' ? 1.15 : p.kind === 'alignment' ? 1.05 : .95;
      const f = { id: c.id, label: c.label, key: chosen[i].key, width: .7, height, tiles: [] };
      f.axis = fixtureAxis(dungeon, f);
      const variants = c.id === 'plaque' ? 1 : c.id === 'receiver' ? 2 : p.controls[i].options.length;
      for (let v = 0; v < variants; v++) {
        const tile = `custom_puzzle_${hash(p.id)}_${i}_${v}`;
        const demo = { ...state, values: [...state.values], status: c.id === 'receiver' && v === 1 ? 'complete' : 'ready' };
        if (i < p.controls.length) demo.values[i] = v;
        dungeon.tiles[tile] = { url: svg(p, f, demo), spriteSpec: { voxelShape: fixtureShape(p, f, demo), baseWidth: f.width, gridWidth: f.width,
          heightRatio: .4, material: 'metal', collisionRadius: .35,
          puzzleFace: { axis: f.axis, mark: c.mark || '', option: c.options?.[v] || '' },
          palette: { primary: '#42555d', secondary: '#be955c', highlight: '#ffe2a0', shadow: '#283539' } } };
        f.tiles.push(tile);
      }
      return f;
    });
    dungeon.physicalPuzzle = { version: VERSION, definition: p, state, fixtures };
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
    return { valid: !errors.length, components: ids.length, reachableTiles: reach.count, errors };
  }
  function feedback(p, state, id) {
    if (state.status === 'complete') return `The reading cabinet opens; its carved panel is now visible. ${p.lore}`;
    const c = p.controls.find(c => c.id === id), i = p.controls.indexOf(c);
    return p.kind === 'sequence' ? `${c.label} clicks. ${state.progress.length ? 'A lamp lights on the cabinet.' : 'The lamps go dark; the buttons rise again. The mechanism can be tried again.'}` :
      `${c.label} moves to ${c.options[state.values[i]]}. The cabinet remains closed. Compare the control marks with the nearby diagram.`;
  }
  const HINT_POLICY = 'PUZZLE HINT DISCIPLINE: Companions are observers, not omniscient walkthroughs. Never volunteer the solution, button order, target dial positions or a full action sequence, even from recalled private solution metadata. When explicitly asked for a hint, offer one observation about the visible clue or the mechanism\'s feedback, then let the player decide and try. Do not invent invisible ritual steps, mandatory words or philosophical intentions. Only a server-verified mechanism transition can complete a physical puzzle; narration cannot change its controls or give its reward. Ordinary use is reliable and retryable, never a limited Search attempt or a random failure roll.';
  return { VERSION, KINDS, compile, fallback, clue, prose, initialState, validState, solved, step, command, intent, install, verify, inReach,
    applyVisualState, visualSpec, feedback, HINT_POLICY, enrichSceneSpec, isReservedScenery };
});
