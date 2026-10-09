(function(root) {
  'use strict';
  function create() {
    let room = null, value = 0;
    const reset = () => { room = null; value = 0; };
    function update(dungeon, camera = {}, dt = 0, enabled = true) {
      if (room !== dungeon) { room = dungeon; value = 0; }
      let target = 0;
      const { x, y, angle, vx = 0, vy = 0 } = camera;
      if (enabled && dungeon?.cells && [x, y, angle, vx, vy].every(Number.isFinite)) {
        const dx = Math.cos(angle), dy = Math.sin(angle), forward = vx * dx + vy * dy;
        if (forward > .04) {
          const here = dungeon.cells[`${Math.floor(x)},${Math.floor(y)}`];
          const ahead = dungeon.cells[`${Math.floor(x + dx * 1.3)},${Math.floor(y + dy * 1.3)}`];
          const open = c => c && (c.tile === 'floor' || c.tile === 'door' && c.door?.isOpen && !c.door.locked);
          if (open(here) && open(ahead) && Number.isFinite(here.floorHeight) && Number.isFinite(ahead.floorHeight)) {
            const drop = here.floorHeight - ahead.floorHeight;
            if (drop > .05) target = -Math.min(.1, drop / 1.3 * .085);
          }
        }
      }
      const step = Number.isFinite(dt) ? Math.max(0, Math.min(.1, dt)) : 0;
      value += (target - value) * (1 - Math.exp(-5 * step));
      if (Math.abs(value) < .0002) value = 0;
      return value;
    }
    return { update, reset };
  }
  const api = { ...create(), create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TerrainCamera = api;
})(typeof window !== 'undefined' ? window : globalThis);
