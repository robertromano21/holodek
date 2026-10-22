(function(root) {
  'use strict';
  // Campaign Builder UI (flag CAMPAIGN_BUILDER). A UI over existing systems only:
  //   renderer: rendererWebGL via currentDungeon (+ HolodekRoomOps re-stamp)   room edits: HolodekRoomOps (devSandbox ops)
  //   rooms/objects/encounters/worlds/overrides/textures/setting: /builder/* routes -> retort/campaignBuilder.js, textureLibrary.js, settingLayer.js
  //   combat: window.beginEncounterCombat -> /room-population/engage -> combatTurnFlow     colour: BuilderPaint (palette-locked overrides)
  if (!root.HolodekFlags?.CAMPAIGN_BUILDER) return;
  const $ = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) e.append(k); return e; };
  const btn = (text, fn, title) => $('button', { type: 'button', className: 'popup-button', textContent: text, onclick: fn, title: title || '' });
  const field = (label, input) => $('label', { style: 'display:flex;gap:6px;align-items:center;margin:2px 0' }, $('span', { textContent: label, style: 'min-width:92px' }), input);
  const inp = (value = '', type = 'text', { list, ...extra } = {}) => { const e = $('input', { value, type, ...extra, style: 'flex:1;background:#000;color:#fff;border:1px solid #888;font:inherit;padding:2px' }); if (list) e.setAttribute('list', list); return e; };
  const sel = (options, value) => { const s = $('select', { style: 'flex:1;background:#000;color:#fff;border:1px solid #888;font:inherit' }); for (const o of options) s.append($('option', { value: o, textContent: o, selected: o === value })); return s; };
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Error(j.error || r.status); return j; };
  const C = () => root.DesignCatalog, P = () => root.BuilderPaint, Ops = () => root.HolodekRoomOps;
  const roomNow = () => (typeof currentDungeon !== 'undefined' ? currentDungeon : root.currentDungeon);
  let panel = null, state = { key: '0,0,0', tab: 'World', fromGame: false, walk: false, world: { name: 'Untitled World', extent: { depth: 6, width: 9 }, start: '0,0,0', cities: [], rooms: {} }, info: null };
  const hist = () => (state.hist ||= P()?.history?.() || { push() {}, undo: c => c, redo: c => c });
  const status = text => { const s = panel?.querySelector('#cb-status'); state.lastStatus = 'Holodek: ' + text; if (s) s.textContent = state.lastStatus; }; // all builder readouts are attributed to Holodek
  async function setRoom(key) { // load an already-constructed room into the real renderer
    const r = await api(`/get-room-dungeon?coords=${encodeURIComponent(key)}`); if (!r.dungeon) { status(`Room ${key} is not built yet.`); return false; }
    const d = r.dungeon; d.geoKey = key; const ov = state.info?.room?.overrides; const view = ov && P() ? P().apply(d, ov, P().gamePalette(C())) : d;
    currentDungeon = typeof ensureDungeonGeometryStamp === 'function' ? ensureDungeonGeometryStamp(view, key) : view; root.currentDungeon = currentDungeon;
    if (view.start && typeof playerPosX !== 'undefined') { playerPosX = view.start.x + .5; playerPosY = view.start.y + .5; }
    state.key = key; return true; }
  async function refresh() { state.info = await api(`/builder/state?key=${encodeURIComponent(state.key)}`); }
  // ---- minimap of the world grid: hand (green) / assisted (yellow) / generated (grey) / unbuilt (dark)
  function minimap() {
    const cv = $('canvas', { width: 180, height: 180, style: 'image-rendering:pixelated;border:1px solid #888;cursor:pointer' }), g = cv.getContext('2d');
    const keys = state.info?.rooms || [], modes = state.info?.modes || {}, z = Number(state.key.split(',')[2]) || 0, cell = 12, cx = 90, cy = 90;
    g.fillStyle = '#000'; g.fillRect(0, 0, 180, 180);
    for (const k of keys) { const [x, y, kz] = k.split(',').map(Number); if (kz !== z) continue; g.fillStyle = { hand: '#3c3', assisted: '#cc3', generated: '#888' }[modes[k]] || '#444';
      g.fillRect(cx + x * cell - 5, cy - y * cell - 5, 10, 10); if (k === state.key) { g.strokeStyle = '#fff'; g.strokeRect(cx + x * cell - 6, cy - y * cell - 6, 12, 12); } }
    cv.onclick = e => { const b = cv.getBoundingClientRect(), x = Math.round((e.clientX - b.left - cx) / cell), y = Math.round((cy - (e.clientY - b.top)) / cell); state.key = `${x},${y},${z}`; render(); };
    return $('div', {}, cv, $('div', { textContent: 'green hand-made · yellow assisted · grey generated', style: 'font-size:10px' }));
  }
  const TABS = {
    World() { const w = state.world, name = inp(w.name), depth = inp(w.extent.depth, 'number'), width = inp(w.extent.width, 'number'), start = inp(w.start), cities = $('textarea', { value: w.cities.map(c => `${c.name}@${c.site}:${c.role}`).join('\n'), rows: 4, style: 'width:100%;background:#000;color:#fff' });
      const save = () => Object.assign(w, { name: name.value, extent: { depth: +depth.value, width: +width.value }, start: start.value, cities: cities.value.split('\n').filter(Boolean).map(l => { const [n, rest = ''] = l.split('@'); const [site, role] = rest.split(':'); return { name: n.trim(), site: (site || '0,0,0').trim(), role: (role || 'market').trim() }; }) });
      const worlds = sel(['(load...)', ...(state.info?.worlds || [])]);
      worlds.onchange = async () => { if (worlds.selectedIndex) { state.world = await api(`/builder/world/${encodeURIComponent(worlds.value)}`); render(); } };
      return [field('World name', name), field('Extent (depth)', depth), field('Extent (width)', width), field('Start room', start), $('div', { textContent: 'Cities (name@x,y,z:role per line)' }), cities,
        $('div', {}, btn('Save world JSON', async () => { save(); const r = await api('/builder/world/save', { world: { ...state.world, setting: state.info?.setting || null } }); status(`Saved ${r.file}`); }), worlds,
          btn('Play this world', async () => { save(); await api('/builder/testmode', { on: true }).catch(() => {}); const r = await api('/builder/world/play', { world: state.world }); status(`Campaign seeded: ${r.built.length} built rooms; AI fills the rest.`); }))]; },
    Room() { const d = roomNow() || {}, cat = C() || {}, biome = sel(['temple', 'crypt', 'wasteland', 'cavern', 'fortress', 'palace', 'garden', 'city', 'library', 'station_deck', 'scrap_yard'], d.classification?.biome),
        theme = sel(Object.keys(cat.THEMES || {}), d.archTheme), pal = sel(Object.keys(cat.PALETTES || {})), light = sel((cat.LIGHTING || []).map(l => l.id || l)), dir = sel(['north', 'south', 'east', 'west', 'up', 'down', 'portal']);
      const doOp = op => { try { hist().push(snapshotRoom()); const r = Ops().apply(op); status(JSON.stringify(r).slice(0, 120)); } catch (e) { status(e.message); } };
      const shape = inp('', 'text', { list: 'cb-shapes', placeholder: 'shape (city kit, pyramid, statue...)' }), id = inp('', 'text', { placeholder: 'prop id' }), deg = inp(90, 'number'), scale = inp(1.25, 'number');
      const shapes = $('datalist', { id: 'cb-shapes' }); for (const s of [...(root.CityKit?.SHAPES || []), ...(root.GenreKits?.SHAPES || []), ...(cat.PYRAMIDS || []).map(p => p.id || p), 'statue', 'bookshelf']) shapes.append($('option', { value: s }));
      const list = $('div', { style: 'max-height:90px;overflow:auto;font-size:11px' }); try { for (const p of Ops().apply({ op: 'list' })) list.append(btn(`${p.id}: ${p.shape}`, () => { id.value = p.id; })); } catch {}
      return [$('div', { textContent: `Editing ${state.key}: ${state.info?.room?.name || d.roomName || ''}` }), field('Biome', biome), field('Theme', theme), field('Palette', pal), field('Lighting', light),
        btn('Apply room properties', () => doOp({ op: 'style', biome: biome.value, theme: theme.value, palette: pal.value, lighting: light.value })), field('Add exit', dir), btn('Add exit', () => doOp({ op: 'exit', direction: dir.value })),
        $('hr'), shapes, field('Palette panel', shape), btn('Place in front of me', () => doOp({ op: 'place', shape: shape.value, x: Math.floor(playerPosX) + .5, y: Math.floor(playerPosY) - 3.5, size: { x: 2, y: 2, z: 2 }, id: id.value || undefined })),
        field('Selected', id), $('div', {}, btn('Move here', () => doOp({ op: 'move', id: id.value, x: Math.floor(playerPosX) + .5, y: Math.floor(playerPosY) - 2.5 })), btn('Rotate', () => doOp({ op: 'rotate', id: id.value, deg: +deg.value })), deg,
          btn('Scale', () => doOp({ op: 'scale', id: id.value, factor: +scale.value })), scale, btn('Delete', () => doOp({ op: 'remove', id: id.value }))), list,
        $('div', {}, btn('Undo', () => restoreRoom(hist().undo(snapshotRoom()))), btn('Redo', () => restoreRoom(hist().redo(snapshotRoom()))), btn('Fill this room (AI)', () => api('/builder/room', { key: state.key, spec: { name: state.info?.room?.name, keepScenery: true }, mode: 'assisted' }).then(() => status('Marked AI-assisted; generation fills the unbuilt parts.'))))]; },
    Grid() { // blank-grid room designer -> same room schema (POST /builder/room), previewed in the real renderer
      const g = state.grid ||= { width: 15, height: 11, cells: {}, exits: [], lights: [], tile: 'wall', name: 'Hand-built Room', description: '', history: '', mural: '', floorHeight: 0, ceilHeight: 4 };
      const S = 18, cv = $('canvas', { width: g.width * S, height: g.height * S, style: 'image-rendering:pixelated;border:1px solid #888;cursor:crosshair' }), x = cv.getContext('2d');
      const COL = { floor: '#554', wall: '#999', pillar: '#ccc', water: '#36a', pit: '#111', stairs: '#a83', ramp: '#875', light: '#ff8' };
      const draw = () => { for (let y = 0; y < g.height; y++) for (let xx = 0; xx < g.width; xx++) { const c = g.cells[`${xx},${y}`], edge = !xx || !y || xx === g.width - 1 || y === g.height - 1;
        x.fillStyle = COL[c?.tile || (edge ? 'wall' : 'floor')]; x.fillRect(xx * S, y * S, S - 1, S - 1); if (c?.floorHeight) { x.fillStyle = '#fff'; x.fillText(String(c.floorHeight), xx * S + 4, y * S + 12); } }
        for (const l of g.lights) { x.fillStyle = COL.light; x.fillRect(l.x * S + 6, l.y * S + 6, 6, 6); } };
      let down = false; const paint = e => { const b = cv.getBoundingClientRect(), cx = Math.floor((e.clientX - b.left) / S), cy = Math.floor((e.clientY - b.top) / S);
        if (g.tile === 'light') { g.lights.push({ x: cx, y: cy }); } else g.cells[`${cx},${cy}`] = { tile: g.tile, floorHeight: +g.floorHeight, ceilHeight: +g.ceilHeight }; draw(); };
      cv.onmousedown = e => { down = true; paint(e); }; cv.onmousemove = e => down && g.tile !== 'light' && paint(e); cv.onmouseup = () => { down = false; }; draw();
      const tile = sel(['floor', 'wall', 'pillar', 'water', 'pit', 'stairs', 'ramp', 'light'], g.tile); tile.onchange = () => { g.tile = tile.value; };
      const fh = inp(g.floorHeight, 'number'), ch = inp(g.ceilHeight, 'number'); fh.onchange = () => { g.floorHeight = fh.value; }; ch.onchange = () => { g.ceilHeight = ch.value; };
      const w = inp(g.width, 'number'), h = inp(g.height, 'number'), name = inp(g.name), desc = $('textarea', { value: g.description, rows: 2, style: 'width:100%;background:#000;color:#fff' }), histT = $('textarea', { value: g.history, rows: 2, style: 'width:100%;background:#000;color:#fff' }), mural = inp(g.mural);
      const exitDir = sel(['north', 'south', 'east', 'west', 'up', 'down', 'portal']), exitKind = sel(['opening', 'door', 'gate', 'portal']), roof = $('input', { type: 'checkbox', checked: g.roof !== false });
      const spec = () => ({ ...g, name: name.value, description: desc.value, history: histT.value, murals: mural.value ? [{ title: 'Mural', text: mural.value }] : [], width: +w.value, height: +h.value, roof: roof.checked });
      return [cv, field('Paint tile', tile), field('Floor height', fh), field('Ceiling height', ch), field('Width', w), field('Height', h), btn('Resize grid', () => { g.width = +w.value; g.height = +h.value; render(); }), field('Roof (unchecked = open sky)', roof),
        field('Exit', exitDir), field('Exit kind', exitKind), btn('Add exit (links to neighbour)', () => { const [ex, ey, ez] = state.key.split(',').map(Number), off = { north: [0, 1, 0], south: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 0, 1], down: [0, 0, -1], portal: [0, 0, 0] }[exitDir.value];
          g.exits.push({ direction: exitDir.value, kind: exitKind.value, to: `${ex + off[0]},${ey + off[1]},${ez + off[2]}` }); status(`Exits: ${g.exits.map(e => e.direction + '→' + e.to).join(', ')}`); }),
        field('Room name', name), $('div', { textContent: 'Description' }), desc, $('div', { textContent: 'Local history' }), histT, field('Mural text', mural),
        $('div', {}, btn('Save hand-made room', async () => { Object.assign(g, spec()); const r = await api('/builder/room', { key: state.key, spec: spec(), mode: 'hand' }); status(`Saved ${r.key} (${r.layout.width}x${r.layout.height}), exits ${r.exits.join(', ')}`); await setRoom(state.key); }),
          btn('Live 3D preview', () => setRoom(state.key)), btn('Clear grid', () => { state.grid = null; render(); }))]; },
    Objects() { const types = state.info?.objectTypes || ['weapon'], q = inp('', 'text', { placeholder: 'search object library' }), type = sel(types), name = inp(''), atk = inp(0, 'number'), dmg = inp(0, 'number'), ac = inp(0, 'number'), magic = inp(0, 'number'), value = inp(0, 'number'), desc = inp('');
      const title = inp(''), author = inp('Anonymous'), chapters = $('textarea', { rows: 3, placeholder: 'Chapter title | text (one per line)', style: 'width:100%;background:#000;color:#fff' }), gen = $('input', { type: 'checkbox', checked: true }), contents = inp('', 'text', { placeholder: 'chest contents: name:type, ...' });
      const LIB = ['Iron Sword:weapon:2:2', 'Hunting Bow:weapon:1:2', 'Chain Shirt:armor:0:0:3', 'Healing Draught:potion', 'Scroll of Warding:scroll', 'Temple Ledger:book', 'Bronze Key:key', 'Silver Coins:coins', 'Reliquary Box:container', 'Stone Lever:lever', 'Sealed Door:door', 'Ash Altar:altar', 'Pulse Pistol:weapon:2:3', 'Stun Baton:weapon:1:2', 'Hazmat Suit:armor:0:0:2', 'Data Slate:book'];
      const lib = $('div', { style: 'max-height:70px;overflow:auto;font-size:11px' }); const fillLib = () => { lib.textContent = ''; for (const e of LIB.filter(e => e.toLowerCase().includes(q.value.toLowerCase()))) { const [n, t, a = 0, dm = 0, c = 0] = e.split(':'); lib.append(btn(n, () => { name.value = n; type.value = t; atk.value = a; dmg.value = dm; ac.value = c; })); } }; q.oninput = fillLib; fillLib();
      const obj = () => ({ name: name.value, type: type.value, attack: +atk.value, damage: +dmg.value, ac: +ac.value, magic: +magic.value, value: +value.value, description: desc.value, title: title.value, author: author.value, generateOnOpen: gen.checked,
        chapters: chapters.value.split('\n').filter(Boolean).map(l => { const [t, ...r] = l.split('|'); return { title: t.trim(), text: r.join('|').trim() }; }), contents: contents.value.split(',').filter(Boolean).map(s => { const [n, t] = s.split(':'); return { name: n.trim(), type: (t || 'other').trim() }; }) });
      const placed = $('div', { style: 'max-height:80px;overflow:auto;font-size:11px' }); (state.info?.room?.objects || []).forEach((o, i) => placed.append($('div', {}, $('span', { textContent: `${o.name} (${o.type}) ` }), btn('Duplicate', () => api('/builder/object/duplicate', { key: state.key, index: i }).then(refreshRender)), btn('Delete', () => api('/builder/object/delete', { key: state.key, index: i }).then(refreshRender)))));
      return [q, lib, field('Name', name), field('Type', type), field('Attack', atk), field('Damage', dmg), field('AC', ac), field('Magic', magic), field('Value', value), field('Description', desc),
        $('div', { textContent: 'Books: title, author, chapters or generate on open' }), field('Title', title), field('Author', author), field('Generate on open', gen), chapters, contents,
        $('div', {}, btn('Place at my position', async () => { await api('/builder/object', { key: state.key, object: obj(), position: { x: Math.floor(playerPosX), y: Math.floor(playerPosY) } }); status(`Placed ${name.value}`); refreshRender(); }),
          btn('Put in party inventory', async () => { await api('/builder/object', { object: obj(), toInventory: true }); status(`${name.value} added to inventory`); })), $('div', { textContent: 'In this room:' }), placed]; },
    Encounters() { const name = inp('Ash Ghoul'), race = inp('Undead'), level = inp(2, 'number'), hp = inp(14, 'number'), ac = inp(12, 'number'), atkN = inp('Claw'), atkD = inp('1d6'), abil = inp(''), loot = inp(''), disp = sel(['Hostile', 'Neutral', 'Friendly']), size = inp(2, 'number');
      const trig = sel(['enter', 'timer', 'turns', 'quest', 'interaction']), trigV = inp('', 'text', { placeholder: 'seconds / turns / quest step / object' }), surprise = sel(['default', 'force', 'never']), waves = inp(0, 'number'), boss = inp('', 'text', { placeholder: 'boss name (optional)' }), parts = inp('', 'text', { placeholder: 'sprite kit parts e.g. cyborg,visor,energy_rifle' }), weapon = sel(['(natural attacks)', ...((root.RangedRules?.WEAPONS || []).filter(w => !w.move).map(w => w.name + (w.rare ? ' (rare)' : '')))]);
      const enc = () => ({ id: `enc-${name.value.replace(/\W+/g, '-').toLowerCase()}`, groupSize: +size.value, surprise: surprise.value, trigger: { kind: trig.value, value: trigV.value },
        monsters: [{ name: name.value, race: race.value, level: +level.value, hp: +hp.value, ac: +ac.value, attacks: [{ name: atkN.value, damage: atkD.value }], abilities: abil.value.split(',').filter(Boolean), loot: loot.value.split(',').filter(Boolean).map(n => ({ name: n.trim(), type: 'treasure' })), disposition: disp.value, spriteParts: parts.value ? parts.value.split(',') : null, weapon: weapon.selectedIndex ? weapon.value.replace(' (rare)', '') : null }],
        waves: Array.from({ length: +waves.value }, (_, i) => ({ after: 3 + i * 2, monsters: [{ name: `${name.value} reinforcement`, level: +level.value }] })), boss: boss.value ? { name: boss.value, level: +level.value + 3, hp: +hp.value * 3 } : null });
      const add = async () => api('/builder/encounter', { key: state.key, encounter: enc(), near: { x: playerPosX, y: playerPosY } });
      return [field('Monster', name), field('Race / type', race), field('Level', level), field('HP', hp), field('AC', ac), field('Attack', atkN), field('Damage', atkD), field('Abilities', abil), field('Loot', loot), field('Disposition', disp), field('Sprite parts', parts), field('Weapon (ranged)', weapon),
        field('Group size', size), field('Trigger', trig), trigV, field('Surprise', surprise), field('Waves', waves), field('Boss phase', boss),
        $('div', {}, btn('Save encounter to room', async () => { const r = await add(); status(`Encounter saved: ${r.names.join(', ')} (surprise ${r.surprise})`); }),
          btn('Test encounter now', async () => { await api('/builder/testmode', { on: true }).catch(() => {}); const r = await add(); if (r.starting) { status('The starting room cannot host a test fight; open another room.'); return; } close(); setTimeout(() => root.beginEncounterCombat?.(r.names[0]), 400); }),
          btn('Reset / retry', async () => { const r = await add(); status(`Encounter reset: ${r.names.join(', ')}`); }))]; },
    Customize() { // "mini photoshop": palette-locked, non-destructive overrides (room.overrides)
      const cat = C(), pal = P().gamePalette(cat), ov = state.ov ||= JSON.parse(JSON.stringify(state.info?.room?.overrides || {}));
      const swatch = (onPick) => { const w = $('div', { style: 'display:flex;flex-wrap:wrap;gap:1px;max-width:360px' }); for (const c of pal) w.append($('button', { type: 'button', title: c, style: `width:14px;height:14px;background:${c};border:0;padding:0`, onclick: () => onPick(c) })); return w; };
      const num = (k, v, min, max, step) => { const i = inp(v, 'range', { min, max, step }); i.oninput = () => { (ov.adjust ||= {})[k] = +i.value; preview(); }; return field(k, i); };
      const preview = () => { const d = roomNow(); if (!d) return; const base = P().strip(d), view = P().apply(base, ov, pal); currentDungeon = view; root.currentDungeon = view; Ops()?.rerender?.(); };
      const mat = sel(P().MATERIALS), orn = sel(['(keep)', ...(cat.ORNAMENTS || [])]), mold = sel(['(keep)', ...Object.keys(cat.MOLDINGS || {})]), fogD = inp(ov.fog?.density || 0, 'range', { min: 0, max: 1, step: .05 }), lightI = inp(ov.lighting?.intensity ?? 1, 'range', { min: 0, max: 2, step: .05 });
      fogD.oninput = () => { ov.fog = { ...(ov.fog || {}), density: +fogD.value }; preview(); }; lightI.oninput = () => { ov.lighting = { ...(ov.lighting || {}), intensity: +lightI.value }; preview(); };
      orn.onchange = () => { ov.ornament = orn.selectedIndex ? orn.value : undefined; preview(); }; mold.onchange = () => { ov.molding = mold.selectedIndex ? mold.value : undefined; preview(); };
      // pixel paint / fill / eyedropper on a wall or floor texture (stored as a texture override; original tile untouched)
      const tileSel = sel(Object.keys(roomNow()?.tiles || {}).filter(t => roomNow().tiles[t]?.url)), tool = sel(['paint', 'fill', 'eyedropper']); let ink = pal[0];
      const cv = $('canvas', { width: 32, height: 32, style: 'width:192px;height:192px;image-rendering:pixelated;border:1px solid #888' }), g = cv.getContext('2d');
      const loadTex = () => { const t = roomNow()?.tiles?.[tileSel.value]; if (!t) return; const im = new Image(); im.onload = () => { g.imageSmoothingEnabled = false; g.drawImage(im, 0, 0, 32, 32); }; im.src = ov.textures?.[tileSel.value] || t._overrideOf || t.url; };
      tileSel.onchange = loadTex; setTimeout(loadTex, 0);
      cv.onclick = e => { const b = cv.getBoundingClientRect(), px = Math.floor((e.clientX - b.left) / 6), py = Math.floor((e.clientY - b.top) / 6), img = g.getImageData(0, 0, 32, 32);
        state.texHist ||= []; state.texHist.push(cv.toDataURL());
        if (tool.value === 'eyedropper') { ink = P().nearest(P().getPixel(img, px, py), pal); status(`ink ${ink}`); return; }
        if (tool.value === 'fill') P().fill(img, px, py, ink); else P().setPixel(img, px, py, ink); g.putImageData(img, 0, 0); };
      return [$('div', { textContent: 'Palette-locked colour (click a swatch = ink / lighting tint / material colour)' }), swatch(c => { ink = c; status(`ink ${c}`); }),
        num('hue', ov.adjust?.hue || 0, -180, 180, 5), num('saturation', ov.adjust?.saturation || 0, -1, 1, .05), num('brightness', ov.adjust?.brightness || 0, -.5, .5, .02), num('contrast', ov.adjust?.contrast || 0, -.8, .8, .05),
        field('Material', mat), btn('Recolour material with ink', () => { (ov.materials ||= {})[mat.value] = ink; preview(); }), btn('Lighting tint = ink', () => { ov.lighting = { ...(ov.lighting || {}), tint: ink }; preview(); }), field('Light intensity', lightI),
        field('Fog density', fogD), btn('Fog colour = ink', () => { ov.fog = { ...(ov.fog || {}), color: ink }; preview(); }), field('Ornament', orn), field('Molding', mold),
        $('hr'), field('Texture', tileSel), field('Tool', tool), cv, $('div', {}, btn('Apply texture', () => { (ov.textures ||= {})[tileSel.value] = cv.toDataURL('image/png'); preview(); }), btn('Undo stroke', () => { const u = state.texHist?.pop(); if (u) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0); im.src = u; } })),
        $('div', {}, btn('Undo', () => { state.ov = hist().undo(ov); render(); }), btn('Redo', () => { state.ov = hist().redo(ov); render(); }), btn('Save overrides', async () => { hist().push(ov); await api('/builder/overrides', { key: state.key, overrides: ov }); status('Overrides saved (generated room untouched).'); }),
          btn('Revert to generated', async () => { state.ov = {}; await api('/builder/overrides', { key: state.key, overrides: null }); const d = roomNow(); if (d) { currentDungeon = P().strip(d); Ops()?.rerender?.(); } render(); }))]; },
    Textures() { const q = inp(state.texQ || '', 'text', { placeholder: 'search: brick, meander, crypt, lighting...' }), grid = $('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;max-height:300px;overflow:auto' }), counts = $('div', { style: 'font-size:11px' });
      const target = sel(['wall', 'floor', 'ceiling', 'prop']), desc = inp('', 'text', { placeholder: 'describe a new texture (one model call; mock locally)' });
      const load = async () => { const r = await api(`/builder/textures?q=${encodeURIComponent(q.value)}&limit=120`); counts.textContent = Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(' · '); grid.textContent = '';
        for (const e of r.entries) grid.append($('button', { type: 'button', title: e.id, style: 'background:#000;border:1px solid #555;padding:1px;color:#ccc;font-size:9px;width:70px', onclick: () => applyTexture(e, target.value) },
          $('img', { src: `/builder/texture.png?id=${encodeURIComponent(e.id)}&size=64`, width: 64, height: 64, style: 'image-rendering:pixelated' }), $('div', { textContent: (e.label || e.id).slice(0, 14) }))); };
      q.oninput = () => { state.texQ = q.value; clearTimeout(state.texT); state.texT = setTimeout(load, 250); }; setTimeout(load, 0);
      return [q, field('Apply to', target), counts, grid, $('div', {}, desc, btn('Generate new texture', async () => { status('Generating texture spec...'); const r = await api('/builder/texture/generate', { description: desc.value }); status(`Saved ${r.entry.label} to the library`); q.value = 'user'; load(); }))]; },
    Setting() { // New-world flow: (1) genres (multi-select, weights, primary) (2) game prompt (3) master prompt review/edit -> Start
      const ALL = window.HolodekFlags?.GENRE_EXPANSION && window.GenreKits ? Object.keys(window.GenreKits.GENRES) : ['fantasy', 'dark-fantasy', 'sci-fi', 'cyberpunk', 'post-apocalyptic', 'steampunk', 'western', 'modern', 'cosmic-horror', 'nautical', 'mythic', 'noir'];
      const cur = state.info?.setting || state.info?.room?.settingDraft || null, g = state.genres ||= (cur?.genresPicked ? (cur.genreWeights || []).map((x, i) => ({ genre: x.genre, weight: x.weight, primary: i === 0 })) : []);
      const toggles = $('div', { style: 'display:flex;flex-wrap:wrap;gap:3px' });
      for (const name of ALL) { const on = g.find(x => x.genre === name); toggles.append($('button', { type: 'button', className: 'popup-button', textContent: (on ? '■ ' : '□ ') + name, style: on ? 'background:#446;color:#fff' : '',
        onclick: () => { const i = g.findIndex(x => x.genre === name); if (i >= 0) g.splice(i, 1); else g.push({ genre: name, weight: 1, primary: !g.length }); render(); } })); }
      const weights = $('div'); for (const x of g) { const r = inp(x.weight, 'range', { min: .1, max: 3, step: .1 }); r.oninput = () => { x.weight = +r.value; };
        weights.append($('div', { style: 'display:flex;gap:6px;align-items:center' }, $('input', { type: 'radio', name: 'cb-primary', checked: !!x.primary, onchange: () => { g.forEach(y => { y.primary = y === x; }); } }), $('span', { textContent: x.genre, style: 'min-width:120px' }), r)); }
      const prompt = $('textarea', { rows: 4, value: state.gamePrompt ?? (cur?.gamePrompt || ''), placeholder: 'Describe your game: who you are, where it starts, what is at stake...', style: 'width:100%;background:#000;color:#fff' });
      prompt.oninput = () => { state.gamePrompt = prompt.value; };
      const master = $('textarea', { rows: 12, value: state.master ?? (cur?.masterPrompt || cur?.masterDraft || ''), style: 'width:100%;background:#000;color:#fff;font-size:10px' }); master.oninput = () => { state.master = master.value; };
      const ins = $('textarea', { rows: 3, value: state.ins ?? (cur?.instructions?.verbatim || ''), placeholder: 'Additional instructions (kept verbatim and authoritative)', style: 'width:100%;background:#000;color:#fff' }); ins.oninput = () => { state.ins = ins.value; };
      const exp = $('textarea', { rows: 5, value: state.exp ?? (cur?.instructions?.expanded || ''), style: 'width:100%;background:#000;color:#fff;font-size:10px' }); exp.oninput = () => { state.exp = exp.value; };
      const gm = inp(state.gm ?? (cur?.gmName || ''), 'text', { placeholder: 'GM persona name (invented for this world)' }); gm.oninput = () => { state.gm = gm.value; };
      const mc = $('textarea', { rows: 2, value: state.mc ?? (cur?.mainCharacter || ''), placeholder: 'Who is your main character? Describe anyone (or leave blank and Holodek will suggest one at creation).', style: 'width:100%;background:#000;color:#fff' }); mc.oninput = () => { state.mc = mc.value; };
      if (state.party === undefined) state.party = cur?.party !== false;
      const partyBtns = $('div', {}, btn((state.party ? '\u25a0 ' : '\u25a1 ') + 'Yes, a party', () => { state.party = true; render(); }), btn((!state.party ? '\u25a0 ' : '\u25a1 ') + 'No, solo', () => { state.party = false; render(); }));
      const build = async () => { status('Writing the setting bible and master prompt...'); const r = await api('/builder/setting', { seed: prompt.value, prompt: prompt.value, genres: g.length ? g : null, instructions: ins.value });
        state.master = r.master; state.gm = r.gmName; state.exp = r.instructions?.expanded || ''; state.bibleName = r.bible.name; if (!g.length) state.inferred = r.bible.genreWeights; status(`${r.bible.name}: ${r.bible.genreWeights.map(x => `${x.genre} ${Math.round(x.weight * 100)}%`).join(', ')}; stat "${r.bible.resourceName}"${r.leaks.length ? '; lint: ' + r.leaks.join(', ') : ''}`); render(); };
      return [$('div', { textContent: '1) Genres: pick any number (none = inferred from your prompt). Radio = primary.' }), toggles, weights,
        state.inferred ? $('div', { textContent: 'Inferred: ' + state.inferred.map(x => `${x.genre} ${Math.round(x.weight * 100)}%`).join(', '), style: 'font-size:11px;color:#9cf' }) : '',
        $('div', { textContent: '2) Game prompt' }), prompt, btn(state.master ? 'Regenerate' : 'Generate master prompt', guarded('build', build)),
        $('div', { textContent: 'Additional instructions (verbatim, then expanded by the game)' }), ins,
        $('div', { textContent: 'Expanded: (review, edit or regenerate)' }), exp, btn('Regenerate expansion', async () => { const r = await api('/builder/instructions/expand', { instructions: ins.value }); state.exp = r.instructions.expanded; render(); }),
        $('div', { textContent: '3) Master system prompt: review and edit, then Start' }), field('GM persona', gm), master,
        $('div', { textContent: '4) Who is your main character?' }), mc, $('div', { textContent: '5) Do you want a party?' }), partyBtns,
        $('div', { className: 'cb-start' }, btn('Start this world', guarded('start', async () => { const r = await api('/builder/setting/start', { master: master.value, genres: g.length ? g : null, expanded: exp.value, gmName: gm.value, mainCharacter: mc.value, party: !!state.party }); if (r.active && window.HolodekFlags) { window.HolodekFlags.HOMEBREW_ACTIVE = true; window.HolodekFlags.GM_NAME = r.gmName; window.HolodekFlags.RESOURCE_NAME = r.resourceName; window.HolodekFlags.FIRST_ROOM = r.firstRoom; document.getElementById('game-popup')?.remove(); /* the console popup drawn at 'start' still shows the CotG start room; the first homebrew render recreates it */ try { const e = typeof roomNameDatabase !== 'undefined' && roomNameDatabase.get('0,0,0'); if (e && /Ruined Temple/i.test(typeof e === 'string' ? e : e.name || '')) roomNameDatabase.delete('0,0,0'); } catch {} window.HolodekFlags.HOMEBREW_PARTY = r.party !== false; window.HolodekFlags.MAIN_CHARACTER = r.mainCharacter || ''; window.HolodekRoster?.install(r); } if (r.active) { setTimeout(() => { close(); if (typeof displayMessage === 'function') displayMessage(`Holodek: ${r.name} is ready. First room: ${r.firstRoom}. Classes: ${r.classes.map(c => c.name).join(', ')}.\nHolodek: Who is your main character?${r.mainCharacter ? ' (' + r.mainCharacter + ')' : ''} Party: ${r.party !== false ? 'yes, companions from this world' : 'no, solo'}.\nStart Menu: \n \n 3) Create character${r.party !== false ? ' and play as a party of 7 adventurers' : ' and play solo'}.`);
          // world1 fix: never leave the player at a silent menu; go straight on to character creation (option 3).
          const el = document.getElementById('chatuserinput'), go = document.getElementById('chatbotbutton');
          if (el && go && !root._characterStartupPending) { if (typeof displayMessage === 'function') displayMessage('Holodek: moving on to character creation...'); el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); go.click(); }
          else if (typeof displayMessage === 'function') displayMessage('Holodek: type 3 and press Enter to create your character.'); }, 1200); } status(`Started ${r.name} (${r.resourceName}); your game master is ${r.gmName}; homebrew prompt ${r.active ? 'active' : 'saved (HOMEBREW flag off)'}.`); })),
          $('span', { textContent: cur?.kind === 'homebrew' ? ` Current: ${cur.name}` : ' Current: default campaign', style: 'font-size:11px' }))]; },
    Walk() { return [$('div', { textContent: 'Walk-around mode: move freely between built rooms through their exits. No combat, no AI turns.' }),
      btn(state.walk ? 'Stop walking' : 'Start walking', () => { state.walk = !state.walk; root.__builderWalk = state.walk; if (state.walk) { api('/builder/testmode', { on: true }).catch(() => {}); walkLoop(); close(); } else render(); })]; }
  };
  async function applyTexture(e, target) { const d = roomNow(); if (!d) return; const ov = state.ov ||= {};
    if (e.spec.kind === 'palette') ov.palette = Object.fromEntries(['primary', 'secondary', 'tertiary', 'shadow', 'highlight', 'accent'].map((k, i) => [k, C().PALETTES[e.spec.palette][i]]).filter(([, v]) => v));
    else if (e.spec.kind === 'lighting') ov.lighting = { ...(ov.lighting || {}), preset: e.spec.lighting };
    else if (e.spec.kind === 'ornament') ov.ornament = e.spec.carvingStyle; else if (e.spec.kind === 'molding') ov.molding = e.spec.role;
    else if (e.spec.kind === 'theme') Ops()?.apply({ op: 'style', theme: e.spec.theme });
    else { const img = await fetch(`/builder/texture.png?id=${encodeURIComponent(e.id)}&size=128`).then(r => r.blob()); const url = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(img); });
      const tileName = target === 'floor' ? 'floor' : target === 'ceiling' ? (Object.keys(d.tiles || {}).find(t => /roof|ceil/.test(t)) || 'roof') : 'wall'; (ov.textures ||= {})[tileName] = url; }
    const view = P().apply(P().strip(d), ov, P().gamePalette(C())); currentDungeon = view; root.currentDungeon = view; Ops()?.rerender?.(); status(`Applied ${e.id} to ${target} (unsaved override)`); }
  function snapshotRoom() { const d = roomNow(); return d ? { sceneStructures: d.sceneStructures, visualStyle: d.visualStyle, classification: d.classification, archTheme: d.archTheme, roomExits: d.roomExits, cells: d.cells } : {}; }
  function restoreRoom(s) { const d = roomNow(); if (!d || !s) return; Object.assign(d, JSON.parse(JSON.stringify(s))); Ops()?.rerender?.(); render(); }
  async function walkLoop() { // exits in built rooms load the neighbour directly; the game's own turn path is never called
    const off = { north: [0, 1, 0], south: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 0, 1], down: [0, 0, -1] };
    while (state.walk) { await new Promise(r => setTimeout(r, 300)); const d = roomNow(); if (!d?.roomExits?.markers || typeof playerPosX === 'undefined') continue;
      const m = d.roomExits.markers.find(m => Math.hypot(m.x + .5 - playerPosX, m.y + .5 - playerPosY) < 1); if (!m || !off[m.direction]) continue;
      const [x, y, z] = state.key.split(',').map(Number), o = off[m.direction], next = `${x + o[0]},${y + o[1]},${z + o[2]}`;
      if (await setRoom(next)) { const back = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' }[m.direction], arr = roomNow().roomExits?.markers?.find(q => q.direction === back);
        if (arr) { playerPosX = arr.x + .5; playerPosY = arr.y + (back === 'south' ? -1.5 : back === 'north' ? 1.5 : .5); } } else { playerPosX -= (m.x + .5 - playerPosX) * 2; playerPosY -= (m.y + .5 - playerPosY) * 2; } } }
  const refreshRender = async () => { await refresh(); render(); };
  function close() { panel?.remove(); panel = null; }
  // world1 fix: slow live-model steps give loud feedback. The button disables after the first click; the panel and the
  // console show 'Holodek is building your world...' with the server's stage (from /builder/progress); a failure shows
  // a clear message and a Retry button. Nothing silently falls back and nothing waits without saying so.
  const STAGES = { build: ['setting bible', 'master prompt', 'world roster', 'additional instructions', 'ready for review'], start: ['saving the world', 'first room', 'character creation'] };
  const say = t => { if (typeof displayMessage === 'function') try { displayMessage(t); } catch {} };
  function guarded(kind, fn) {
    let running = false;
    const run = async event => {
      if (running) return; running = true; const button = event?.currentTarget || event?.target; if (button) { button.disabled = true; button.dataset.label ||= button.textContent; button.textContent = 'Working...'; }
      const t0 = Date.now(), list = STAGES[kind]; let last = '';
      const tick = async () => { let p = null; try { p = kind === 'build' ? await api('/builder/progress') : null; } catch {}
        if (!running) return; const st = p?.stage || (kind === 'start' ? list[Math.min(list.length - 1, Math.floor((Date.now() - t0) / 4000))] : list[0]), n = Math.max(1, list.indexOf(st) + 1);
        const line = `Holodek is building your world... ${st} (${n}/${list.length}), ${Math.round((Date.now() - t0) / 1000)}s`; status(line.replace(/^Holodek: /, ''));
        if (st !== last) { last = st; say('Holodek is building your world... ' + st); } };
      say('Holodek is building your world...'); const timer = setInterval(tick, 1000); tick();
      try { await fn(event); }
      catch (e) { const msg = `Holodek could not ${kind === 'build' ? 'build the world' : 'start the world'}${last ? ' (at: ' + last + ')' : ''}: ${e.message}`;
        status(msg); say(msg); const s = panel?.querySelector('#cb-status'); if (s) s.append(' ', btn('Retry', () => run(event))); }
      finally { clearInterval(timer); running = false; if (button && button.isConnected) { button.disabled = false; button.textContent = button.dataset.label; } }
    };
    return run;
  }
  // world1 fix: the panel fits the viewport. Title/tabs/Close pinned on top, the body scrolls, the status line is a
  // footer and 'Start this world' sticks to the bottom of the scrolling body; narrow screens stack the minimap.
  function injectStyle() { if (document.getElementById('campaign-builder-fit')) return; const st = document.createElement('style'); st.id = 'campaign-builder-fit'; st.textContent = `
/* body has zoom: var(--game-ui-scale) (1.3125); vh/vw inside it are NOT zoomed, so lengths are divided by the scale
   exactly like the game's own popups (#game-model-popup). */
#campaign-builder.popup-container { position: fixed !important; left: 8px !important; right: auto !important; top: 28px !important; bottom: auto !important; box-sizing: border-box !important;
  width: min(760px, calc(100vw / var(--game-ui-scale, 1) - 16px)) !important; max-width: calc(100vw / var(--game-ui-scale, 1) - 16px) !important; height: auto !important;
  max-height: calc(100vh / var(--game-ui-scale, 1) - 36px) !important;
  display: flex !important; flex-direction: column !important; overflow: hidden !important; }
#campaign-builder .cb-top { flex: none; border-bottom: 1px solid #555; padding-bottom: 4px; margin-bottom: 4px; background: #000; }
#campaign-builder .cb-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
#campaign-builder .cb-start { position: sticky; bottom: 0; z-index: 2; background: #000; padding: 4px 0; border-top: 1px solid #555; }
#campaign-builder #cb-status { flex: none; border-top: 1px solid #333; padding-top: 3px; }
#campaign-builder textarea, #campaign-builder input[type=text] { max-width: 100%; box-sizing: border-box; }
@media (max-width: 700px) { #campaign-builder .cb-row { flex-direction: column; } }`; document.head.append(st); }
  // Safety net: whatever scaling the page applies, clamp the panel to the visible window (measured, in CSS px).
  function fitPanel() { if (!panel || !panel.isConnected) return; panel.style.removeProperty('height'); const r = panel.getBoundingClientRect(); if (!r.height) return;
    const zoom = r.height / (panel.offsetHeight || r.height) || 1, room = window.innerHeight - r.top - 8; if (r.bottom > window.innerHeight - 4) panel.style.setProperty('max-height', Math.max(160, room / zoom) + 'px', 'important'); }
  if (!root.__cbFitBound) { root.__cbFitBound = true; root.addEventListener?.('resize', () => { if (panel) { panel.style.removeProperty('max-height'); fitPanel(); } }); }
  function render() {
    if (!panel) return; panel.textContent = ''; requestAnimationFrame?.(fitPanel);
    const tabs = $('nav', { style: 'display:flex;flex-wrap:wrap;gap:2px' }); for (const t of Object.keys(TABS)) tabs.append(btn(t === state.tab ? `[${t}]` : t, async () => { state.tab = t; await refresh().catch(() => {}); render(); }));
    let body; try { body = TABS[state.tab](); } catch (e) { body = [$('div', { textContent: 'Error: ' + e.message })]; }
    panel.append($('div', { className: 'cb-top' }, $('header', { style: 'display:flex;justify-content:space-between' }, $('strong', { textContent: `Campaign Builder: ${state.world.name}` }),
      $('span', {}, state.fromGame ? btn('Return to game', returnToGame) : btn('Close', close))), tabs),
      $('div', { className: 'cb-body' }, $('div', { className: 'cb-row', style: 'display:flex;gap:8px;align-items:flex-start' }, $('div', { className: 'cb-main', style: 'flex:1;min-width:0' }, ...body), minimap())), $('div', { id: 'cb-status', style: 'font-size:11px;color:#ff8;margin-top:4px', textContent: state.lastStatus || '' }));
  }
  async function open({ fromGame = false, key, tab } = {}) {
    state.fromGame = fromGame; if (tab) state.tab = tab; await refresh().catch(() => {}); state.key = key || state.info?.current || state.key;
    close(); injectStyle(); panel = $('div', { id: 'campaign-builder', className: 'popup-container' });
    panel.style.cssText = 'position:fixed;left:8px;top:28px;width:min(760px,calc(100vw / var(--game-ui-scale, 1) - 16px));max-height:calc(100vh / var(--game-ui-scale, 1) - 36px);overflow:hidden;z-index:4000;background:#000;color:#fff;border:2px solid #aaa;padding:8px;font-family:inherit;font-size:12px';
    panel.addEventListener('keydown', e => e.stopPropagation()); document.body.append(panel); await refresh().catch(() => {}); render(); return true; }
  // ☰ Open in Campaign Editor: snapshot the game first, then edit the current room in place.
  async function openFromGame() { const snap = await api('/builder/snapshot', {}); await open({ fromGame: true, key: snap.key }); status(`Game saved (${snap.file}); editing ${snap.key}.`); }
  async function returnToGame() { api('/builder/testmode', { on: false }).catch(() => {}); state.walk = false; root.__builderWalk = false; const key = state.info?.current || state.key; close(); await setRoom(key); }
  root.CampaignBuilderUi = { open, openFromGame, returnToGame, close, setRoom, TABS: Object.keys(TABS) };
  // ☰ menu entries (pixel-style game-menu buttons)
  const addMenu = () => { const menu = document.getElementById('game-menu'); if (!menu || document.getElementById('open-campaign-editor-button')) return;
    menu.append($('button', { id: 'open-campaign-editor-button', className: 'game-menu-button', textContent: 'Open in Campaign Editor', onclick: openFromGame }),
      $('button', { id: 'return-to-game-button', className: 'game-menu-button', textContent: 'Return to game', onclick: returnToGame })); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addMenu); else addMenu();
})(typeof window === 'object' ? window : globalThis);
