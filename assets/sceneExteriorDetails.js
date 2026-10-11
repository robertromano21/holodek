(function(root) {
  'use strict';
  const VERSION = 1;
  const views = new WeakMap();
  const directions = { north: [0, -1], northeast: [0, -1], east: [1, 0], southeast: [0, 1],
    south: [0, 1], southwest: [0, 1], west: [-1, 0], northwest: [0, -1] };

  function torchAt(u, v, half, depth) {
    return v === 0 && Math.abs(u) >= 2 && (Math.abs(u) === half || (Math.abs(u) - 2) % 4 === 0) ||
      Math.abs(u) === half && v > 0 && v < depth - 1 && (v - 3) % 6 === 0 ||
      v === depth - 1 && Math.abs(u) % 6 === 0;
  }

  function mountHeight(height) { return Math.min(height - .2, Math.max(2.2, Math.min(3.5, height * .28))); }

  function forRendering(dungeon) {
    if (!dungeon?.sceneExteriors?.buildings?.length || dungeon.classification?.indoor === true ||
        dungeon.sceneSpec?.indoor === true || !dungeon.cells || !dungeon.tiles) return dungeon;
    const stamp = dungeon._geometryStamp || dungeon._meta?.geometryStamp;
    const cached = views.get(dungeon);
    if (cached && cached.stamp === stamp) return cached.view;
    let cells, tiles, structures;
    for (const b of dungeon.sceneExteriors.buildings.slice(0, 2)) {
      const door = b.doorway, f = directions[b.direction];
      if (b.entrance !== 'closed-gate' || !f || !door || ![door.x, door.y, door.floor, b.wallHeight,
          b.transverse, b.depth].every(Number.isFinite) || b.wallHeight <= 0 || b.wallHeight > 64 ||
          b.transverse < 3 || b.transverse > 41 || b.depth < 3 || b.depth > 41) continue;
      const cross = [-f[1], f[0]], half = Math.floor(b.transverse / 2);
      const at = (u, v) => ({ x: door.x + cross[0] * u + f[0] * v, y: door.y + cross[1] * u + f[1] * v });
      const gateCells = [-1, 0, 1].map(u => at(u, 1));
      const sealed = gateCells.every(p => {
        const c = dungeon.cells[`${p.x},${p.y}`];
        return c?.exteriorRole === 'closed-gate' && c.exteriorDestination === b.targetKey && c.blocked;
      });
      if (sealed && !(dungeon.sceneStructures || []).some(p => p.role === 'exterior-closed-gate' &&
          p.exteriorDestination === b.targetKey && /^grand_gate(?:_side)?$/.test(p.shape))) {
        const shape = f[1] ? 'grand_gate' : 'grand_gate_side';
        const palette = b.palette || { primary: '#81988c', secondary: '#496656', highlight: '#eadfc6', shadow: '#30352f' };
        const identity = String(b.targetKey).replace(/[^a-z0-9_-]/gi, '_');
        const colors = Object.values(palette).join('').replace(/[^a-z0-9]/gi, '');
        const tile = `custom_exterior_gate_v${VERSION}_${identity}_${shape}_${colors}`;
        tiles ||= { ...dungeon.tiles };
        tiles[tile] = { url: dungeon.tiles.wall?.url, spriteSpec: { voxelShape: shape, material: 'metal', palette,
          profile: 'flat', heightRatio: 1, baseWidth: 1, gridWidth: 1 } };
        structures ||= (dungeon.sceneStructures || []).slice();
        structures = structures.filter(p => p.role !== 'exterior-closed-gate' || p.exteriorDestination !== b.targetKey);
        structures.push({ tile, shape, role: 'exterior-closed-gate', skyline: true, exteriorDestination: b.targetKey,
          position: { x: Math.min(...gateCells.map(p => p.x)), y: Math.min(...gateCells.map(p => p.y)), z: door.floor },
          size: { x: f[1] ? 3 : 1, y: f[0] ? 3 : 1, z: b.wallHeight } });
      }
      for (let v = 0; v < b.depth; v++) for (let u = -half; u <= half; u++) {
        if (!torchAt(u, v, half, b.depth)) continue;
        const p = at(u, v), key = `${p.x},${p.y}`, c = dungeon.cells[key];
        if (!c || !['wall', 'torch'].includes(c.tile) || c.exteriorDestination !== b.targetKey ||
            !['shell-wall', 'tower'].includes(c.exteriorRole) || c.feature && c.feature !== 'torch' || c.door || c.exit) continue;
        const height = c.ceilHeight - c.floorHeight;
        if (!Number.isFinite(height) || height < .5) continue;
        const torchMountHeight = mountHeight(height);
        if (c.tile === 'torch' && c.feature === 'torch' && c.torchMountHeight === torchMountHeight) continue;
        cells ||= { ...dungeon.cells };
        cells[key] = { ...c, tile: 'torch', feature: 'torch', torchMountHeight };
      }
    }
    // The saved room stays authoritative; this cached view only supplies visible dressing.
    const view = cells || tiles || structures ? { ...dungeon, cells: cells || dungeon.cells, tiles: tiles || dungeon.tiles,
      sceneStructures: structures || dungeon.sceneStructures, _geometryStamp: `${stamp || 'unstamped'}:exterior-details:${VERSION}` } : dungeon;
    views.set(dungeon, { stamp, view });
    return view;
  }

  const api = { VERSION, torchAt, mountHeight, forRendering };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SceneExteriorDetails = api;
})(typeof window === 'undefined' ? globalThis : window);
