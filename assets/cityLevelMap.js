(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CityLevelMap = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  function context(dungeon, player, database) {
    if (!dungeon?.layout) return null;
    const room = database?.get?.(dungeon.geoKey) || database?.[dungeon.geoKey], city = dungeon.sceneSpec?.city;
    const ref = city?.architecture || room?.cityRoom?.architecture, vertical = city?.vertical || room?.cityRoom?.vertical;
    if (dungeon.cityVenueBounds || vertical || ref) {
      const b = dungeon.cityVenueBounds || { left: 0, top: 0, width: dungeon.layout.width, depth: dungeon.layout.height };
      return { id: `${ref?.hostKey || dungeon.geoKey}:${ref?.buildingId || vertical?.towerId || 'interior'}:${ref?.floor ?? vertical?.floor ?? 0}`,
        hostKey: ref?.hostKey || room?.cityRoom?.streetKey || dungeon.geoKey,
        buildingId: ref?.buildingId || vertical?.towerId, floor: ref?.floor ?? vertical?.floor ?? 0,
        name: ref?.name || room?.name || dungeon.sceneSpec?.source?.roomName || 'Building', bounds: b };
    }
    const b = (dungeon.cityBlocks?.buildings || []).find(b => player && player.x >= b.left + 1 && player.x < b.left + b.width - 1 &&
      player.y >= b.top + 1 && player.y < b.top + b.depth - 1 && dungeon.cells?.[`${Math.floor(player.x)},${Math.floor(player.y)}`]?.cityParcel === b.id);
    return b ? { id: `${dungeon.geoKey}:${b.planId || b.id}:0`, hostKey: dungeon.geoKey, buildingId: b.planId || b.id,
      floor: 0, name: b.name, bounds: { left: b.left, top: b.top, width: b.width, depth: b.depth } } : null;
  }
  function projection(level, range, player, viewCenter) {
    const b = level.bounds, extent = Math.max(1, Math.min(range, Math.max(b.width, b.depth) + 4));
    const center = viewCenter || player;
    const axis = (start, span, c) => span + 4 <= extent ? start + (span - extent) / 2 : Math.max(start - 2, Math.min(start + span + 2 - extent, c - extent / 2));
    return { extent, left: axis(b.left, b.width, center.x), top: axis(b.top, b.depth, center.y) };
  }
  const contains = (level, p) => !level || p.x >= level.bounds.left && p.y >= level.bounds.top &&
    p.x < level.bounds.left + level.bounds.width && p.y < level.bounds.top + level.bounds.depth;
  return { context, projection, contains };
});
