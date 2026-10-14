(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./dungeonInhabitants') : root.DungeonInhabitants);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.QuestWritings = api;
})(typeof window === 'object' ? window : globalThis, function(I) {
  'use strict';
  function apply(dungeon, room) {
    const records = (room?.inscriptions || []).filter(r => r.questStoryId && r.kind === 'inscription' && r.chapters?.[0]?.text);
    if (!dungeon?.cells || !dungeon.start || !records.length) return [];
    dungeon.questWritings ||= []; dungeon.sceneStructures ||= []; dungeon.tiles ||= {};
    const existing = new Set(dungeon.questWritings.map(w => w.id)), additions = [];
    if(records.every(r=>existing.has(r.id)))return additions;
    const reached = I.reachable(dungeon), sites = [];
    const occupied = new Set((dungeon.sceneObjects || []).map(o => `${o.x},${o.y}`));
    for (const p of reached.slice(0, 4096)) {
      const cell = dungeon.cells[`${p.x},${p.y}`];
      if (cell?.tile !== 'floor' || cell.exit || cell.feature || cell.puzzleFixture || occupied.has(`${p.x},${p.y}`) ||
          I.ceilingHeight(dungeon,cell)-(cell.floorHeight||0)<1.55) continue;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        if (dungeon.cells[`${p.x+dx},${p.y+dy}`]?.tile === 'wall') sites.push({ ...p, dx, dy, wall: true });
      }
    }
    if (!sites.length) for (const p of reached.slice(0, 4096)) {
      const cell = dungeon.cells[`${p.x},${p.y}`];
      if (cell?.tile === 'floor' && !cell.exit && !cell.feature && !cell.puzzleFixture && !occupied.has(`${p.x},${p.y}`) &&
          I.ceilingHeight(dungeon,cell)-(cell.floorHeight||0)>=1.1 &&
          Math.hypot(p.x-dungeon.start.x,p.y-dungeon.start.y) >= 2) sites.push({ ...p, dx: 0, dy: -1, wall: false });
    }
    sites.sort((a,b) => Math.hypot(a.x-dungeon.start.x,a.y-dungeon.start.y)-Math.hypot(b.x-dungeon.start.x,b.y-dungeon.start.y));
    for (const record of records) {
      if (existing.has(record.id)) continue;
      const site = sites.find(p => !dungeon.questWritings.some(w => w.key === `${p.x},${p.y}`));
      if (!site) continue;
      const floor = dungeon.cells[`${site.x},${site.y}`].floorHeight || 0;
      const sx = site.dx ? .09 : .7, sy = site.dx ? .7 : .09;
      const position = { x: site.x+.5-sx/2+site.dx*(site.wall ? .43 : 0),
        y: site.y+.5-sy/2+site.dy*(site.wall ? .43 : 0), z: floor+(site.wall ? .7 : .04) };
      const size = { x: sx, y: sy, z: site.wall ? .8 : 1.05 }, tile = 'quest_writing_'+I.hash(record.id).toString(16);
      const engraving = { seed:record.id,heading:record.title,text:record.chapters[0].text,style:'sepulchral' };
      const spec = { voxelShape: 'puzzle_plaque', material: 'stone', baseWidth: .7, heightRatio: 1,
        puzzleFace:{axis:site.dx?'x':'y',engraving},inscription:{...record,...engraving,motif:'Key'} };
      dungeon.tiles[tile] = { spriteSpec: spec };
      const writing = { id: record.id, name: record.name, key: `${site.x},${site.y}`, x: site.x, y: site.y,
        tile, position, size, inscription: record, mounted: site.wall, questStoryId: record.questStoryId };
      dungeon.questWritings.push(writing);
      dungeon.sceneStructures.push({ id: record.id, role: 'quest-writing', tile, position, size });
      dungeon.inscriptions ||= [];
      if (!dungeon.inscriptions.some(r => r.id === record.id)) dungeon.inscriptions.push(record);
      existing.add(record.id); additions.push(writing);
    }
    return additions;
  }
  function install(dungeon, payload) {
    if (!dungeon || payload.geoKey !== dungeon.geoKey || !Array.isArray(payload.writings)) return false;
    dungeon.questWritings ||= []; dungeon.sceneStructures ||= []; dungeon.tiles ||= {}; dungeon.inscriptions ||= [];
    for (const w of payload.writings) {
      if (dungeon.questWritings.some(r => r.id === w.id)) continue;
      dungeon.questWritings.push(w); dungeon.inscriptions.push(w.inscription);
      dungeon.sceneStructures.push({ id: w.id, role: 'quest-writing', tile: w.tile, position: w.position, size: w.size });
      if (payload.tiles?.[w.tile]) dungeon.tiles[w.tile] = payload.tiles[w.tile];
    }
    if (payload.geometryStamp) dungeon._geometryStamp = payload.geometryStamp;
    return true;
  }
  return { apply, install };
});
