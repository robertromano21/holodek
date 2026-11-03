'use strict';
const BASE_TILES = new Set(['floor', 'wall', 'door', 'torch', 'pillar']);

// Structural voxels borrow a base surface image; their own spriteSpec owns the shape.
// Genre painting can replace that base URL after the structure was constructed.
function rebind(dungeon) {
  const changed = [];
  const customNames = new Set((dungeon?.customTiles || []).map((tile, i) => tile.name || `custom_${tile.type}_${i}`));
  for (const [name, tile] of Object.entries(dungeon?.tiles || {})) {
    let source = BASE_TILES.has(tile.surfaceSource) ? tile.surfaceSource : null;
    if (!source && tile.surfaceSource === undefined && !customNames.has(name) && tile.url?.startsWith('/sid/sprites/')) {
      const prefix = name.match(/^custom_structure_v[1-7]_/)?.[0];
      const spec = tile.spriteSpec;
      if (prefix && spec?.voxelShape && spec.material && name === prefix + spec.voxelShape + '_' + spec.material) {
        source = dungeon.tiles.pillar?.url ? 'pillar' : 'wall';
      }
    }
    const url = source && source !== name && dungeon.tiles[source]?.url;
    if (url && tile.url !== url) { changed.push({ name, source }); tile.url = url; }
  }
  return changed;
}
module.exports = { rebind };
