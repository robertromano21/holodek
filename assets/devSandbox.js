(function(root) {
  'use strict';
  // Playtest-only live room editor. Active ONLY when the server reports DEV_SANDBOX (HOLODEK_DEV_SANDBOX=1 on a non-3000 test port).
  // window.__holodekDev.apply(op) edits the OPEN room in place and re-renders it; nothing generates a new room.
  // Ops queued by POST /dev/room (localhost only) are pulled by this page and applied the same way.
  if (!root.HolodekFlags?.DEV_SANDBOX && !root.HolodekFlags?.CAMPAIGN_BUILDER) return;
  const SANDBOX = !!root.HolodekFlags?.DEV_SANDBOX;
  const snapshots = new Map(); let rev = 0, seq = 0;
  const room = () => root.currentDungeon || (typeof currentDungeon !== 'undefined' ? currentDungeon : null);
  const C = () => root.DesignCatalog, K = () => root.CityKit;
  function rerender(d) { d._geometryStamp = `dev-${++rev}-${Date.now()}`; d._meta = { ...(d._meta || {}), geometryStamp: d._geometryStamp }; return { ok: true, rev }; }
  function find(d, id) { return (d.sceneStructures || []).find(p => p.devId === id || p.tile === id); }
  function tileFor(d, shape, o) {
    const kit = K()?.has?.(shape) ? { palette: o.palette || 'sandstone', guild: o.guild || null, city: { id: 'dev', name: 'Sandbox', role: 'market' } } : null;
    const name = `dev_${shape}_${o.palette || 'p'}_${seq}`;
    d.tiles[name] = { url: d.tiles.wall?.url, spriteSpec: { voxelShape: shape, material: o.material || 'stone', collisionBlocking: false, profile: 'flat', heightRatio: 1, baseWidth: 1, gridWidth: 1, ...(kit ? { cityKit: kit } : {}), ...(o.stoneCarving ? { stoneCarving: o.stoneCarving } : {}) } };
    return name;
  }
  const ops = {
    list(d) { return (d.sceneStructures || []).filter(p => p.devId).map(p => ({ id: p.devId, shape: p.shape, position: p.position, size: p.size, rotation: p.rotation || 0 })); },
    shapes() { return { cityKit: (K()?.SHAPES || []).map(n => `${n}__v0`), genres: root.GenreKits?.SHAPES || [], pyramids: C()?.PYRAMIDS || [], ornaments: C()?.ORNAMENTS || [], palettes: Object.keys(C()?.PALETTES || {}), lighting: C()?.LIGHTING || [] }; },
    place(d, o) { // {shape, x, y, z?, size?:{x,y,z}, palette?, material?}
      const shape = /__v\d+$/.test(o.shape) || !K()?.SHAPES?.includes(o.shape) ? o.shape : `${o.shape}__v0`; seq++;
      const tile = tileFor(d, shape, o), floor = d.cells?.[`${Math.floor(o.x)},${Math.floor(o.y)}`]?.floorHeight || 0, id = o.id || `dev${seq}`;
      (d.sceneStructures ||= []).push({ tile, shape, role: 'dev-sandbox', devId: id, position: { x: o.x, y: o.y, z: o.z ?? floor }, size: o.size || { x: 2, y: 2, z: 2 }, rotation: o.rotation || 0 });
      return { id, ...rerender(d) }; },
    move(d, o) { const p = find(d, o.id); if (!p) throw Error('no such prop ' + o.id); Object.assign(p.position, { x: o.x ?? p.position.x, y: o.y ?? p.position.y, z: o.z ?? p.position.z }); return rerender(d); },
    rotate(d, o) { const p = find(d, o.id); if (!p) throw Error('no such prop ' + o.id); p.rotation = ((o.deg || 0) % 360 + 360) % 360;
      if (p.rotation % 180 === 90) [p.size.x, p.size.y] = [p.size.y, p.size.x]; return rerender(d); }, // quarter turns swap footprint; finer angles are stored only
    scale(d, o) { const p = find(d, o.id); if (!p) throw Error('no such prop ' + o.id); for (const k of ['x', 'y', 'z']) p.size[k] *= o[k] ?? o.factor ?? 1; return rerender(d); },
    remove(d, o) { const n = (d.sceneStructures || []).length; d.sceneStructures = (d.sceneStructures || []).filter(p => p.devId !== o.id && p.tile !== o.id);
      if (o.art) { d.surfaceArt = (d.surfaceArt || []).filter(a => a.label !== o.art); d.moldingArt = (d.moldingArt || []).filter(a => a.label !== o.art); }
      return { removed: n - d.sceneStructures.length, ...rerender(d) }; },
    style(d, o) { // {biome?, theme?, palette?, lighting?}
      if (o.biome) (d.classification ||= {}).biome = o.biome;
      if (o.theme) d.archTheme = o.theme;
      if (o.palette && C()?.PALETTES[o.palette]) { const [primary, secondary, , shadow, highlight, accent] = C().PALETTES[o.palette]; d.visualStyle = { ...(d.visualStyle || {}), palette: { ...(d.visualStyle?.palette || {}), primary, secondary, shadow, highlight, accent } }; }
      if (o.lighting) d.devLighting = o.lighting;
      return rerender(d); },
    cell(d, o) { // re-wall or open floor: {x, y, tile:'wall'|'floor', floorHeight?, ceilHeight?}
      const k = `${o.x},${o.y}`; d.cells[k] = { ...(d.cells[k] || {}), tile: o.tile || 'floor', ...(o.floorHeight != null ? { floorHeight: o.floorHeight } : {}), ...(o.ceilHeight != null ? { ceilHeight: o.ceilHeight } : {}) }; return rerender(d); },
    resize(d, o) { // grow the layout; new cells are walls
      const w = Math.max(d.layout.width, o.width || 0), h = Math.max(d.layout.height, o.height || 0);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.cells[`${x},${y}`] ||= { tile: 'wall', floorHeight: 0, ceilHeight: 3 };
      d.layout = { ...d.layout, width: w, height: h }; return rerender(d); },
    exit(d, o) { const dirs = [...new Set([...(d.roomExits?.markers || []).map(m => m.direction), o.direction])]; root.DungeonExits?.install(d, dirs); return rerender(d); },
    spawn(d, o) { // through the game's own console path, so rules and saves stay consistent
      const t = o.kind === 'monster' ? `summon a ${o.name || 'ash ghoul'}` : `call out to ${o.name || 'a traveller'}`; return queueConsole(t); },
    encounter(_d, o) { return queueConsole(o.surprise ? 'search the shadows carefully' : 'attack'); },
    snapshot(d, o) { snapshots.set(o.name || 'default', JSON.stringify({ sceneStructures: d.sceneStructures, tiles: d.tiles, cells: d.cells, layout: d.layout, visualStyle: d.visualStyle, classification: d.classification, surfaceArt: d.surfaceArt, moldingArt: d.moldingArt, roomExits: d.roomExits }));
      return { saved: o.name || 'default', bytes: snapshots.get(o.name || 'default').length }; },
    restore(d, o) { const s = snapshots.get(o.name || 'default'); if (!s) throw Error('no snapshot ' + (o.name || 'default')); Object.assign(d, JSON.parse(s)); return rerender(d); },
    focus(_d, o) { if (typeof playerPosX !== 'undefined') { playerPosX = o.x; playerPosY = o.y; } return { ok: true }; }
  };
  function queueConsole(text) { const el = document.getElementById('chatuserinput'); if (!el || el.value.trim()) return { ok: false, reason: 'console busy' }; el.value = text; root.chatbotprocessinput?.(); return { ok: true, console: text }; }
  function apply(op) {
    const d = room(); if (!d) throw Error('no open room');
    const fn = ops[op?.op]; if (!fn) throw Error('unknown op ' + op?.op + '; ops: ' + Object.keys(ops).join(', '));
    const result = fn(d, op || {}); console.info('[DevSandbox]', JSON.stringify({ op: op.op, id: op.id, result }).slice(0, 400)); return result;
  }
  root.HolodekRoomOps = { apply, ops: Object.keys(ops), rerender: () => rerender(room()) }; // shared with the Campaign Builder
  if (!SANDBOX) return;
  root.__holodekDev = { apply, ops: Object.keys(ops) };
  // Pull ops queued by POST /dev/room (this page only applies them to its own open room).
  setInterval(async () => { try { const r = await fetch('/dev/room/next', { cache: 'no-store' }); if (r.status !== 200) return; const list = await r.json();
    for (const { id, op } of list) { let result; try { result = apply(op); } catch (e) { result = { error: e.message }; }
      fetch('/dev/room/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, result }) }); } } catch {} }, 1000);
})(typeof window === 'object' ? window : globalThis);
