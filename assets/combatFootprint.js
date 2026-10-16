(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CombatFootprint = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  function size(actor) {
    const explicit = actor?.combatFootprint;
    if (Number.isInteger(explicit?.width) && Number.isInteger(explicit?.height) &&
        explicit.width >= 1 && explicit.height >= 1 && explicit.width <= 4 && explicit.height <= 4) return explicit;
    const spec = actor?.sprite?.spec || actor?.spriteSpec;
    const stature = spec?.stature || actor?.stature;
    const category = stature?.category === 'humanoid' ? 'humanoid' :
      `${stature?.category || ''} ${spec?.traits?.size || ''} ${actor?.size || ''}`.toLowerCase();
    const span = /gargantuan|colossal/.test(category) ? 4 : /huge/.test(category) ? 3 : /large/.test(category) ? 2 : 1;
    return { width: span, height: span };
  }
  function cells(actor, at = { x: actor?.mazeX, y: actor?.mazeY }) {
    if (!Number.isFinite(at?.x) || !Number.isFinite(at?.y)) return [];
    const { width, height } = size(actor), out = [];
    for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++)
      out.push({ x: Math.floor(at.x) + dx, y: Math.floor(at.y) + dy });
    return out;
  }
  function center(actor, at = { x: actor?.mazeX, y: actor?.mazeY }) {
    const span = size(actor);
    return { x: at.x + span.width / 2, y: at.y + span.height / 2 };
  }
  return { size, cells, center };
});
