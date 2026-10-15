'use strict';
const { makeNavigation, reachable, addVerticalRoutes } = require('./sceneArchitecture');

function install(dungeon, spec) {
  const floor = spec.worldContext?.fortifiedFloor;
  if (floor?.version !== 1) return { status: 'skipped', reason: 'not-multi-storey-site' };
  if (dungeon.fortifiedStairs) return dungeon.fortifiedStairs;
  const required = floor.stairs || [], architecture = dungeon.sceneArchitecture;
  const existing = architecture?.verticalRoutes?.routes || [];
  const routes = existing.filter(r => required.includes(r.direction));
  const mutable = new Set(Object.entries(dungeon.cells).filter(([, c]) => c.tile === 'wall' && !c.feature && !c.exit && !c.door && !c.interactable && !c.exteriorRole).map(([k]) => k));
  const { width, height } = dungeon.layout;
  for (const direction of required.filter(d => !routes.some(r => r.direction === d))) {
    const nav = makeNavigation(dungeon), reached = reachable(nav, dungeon.start), candidates = [];
    for (let y = 18; y < height - 5; y += 3) for (let x = 5; x < width - 5; x += 3) {
      const cell = dungeon.cells[`${x},${y}`];
      if (reached.seen[y * width + x] && cell?.tile === 'floor' && !cell.feature && !cell.stairRoute &&
          Math.hypot(x - dungeon.start.x, y - dungeon.start.y) > 6) candidates.push({ x, y });
    }
    let built;
    candidates.sort((a, b) => Math.hypot(a.x - dungeon.start.x, a.y - dungeon.start.y) - Math.hypot(b.x - dungeon.start.x, b.y - dungeon.start.y));
    for (const p of candidates.slice(0, 128)) {
      const result = addVerticalRoutes(dungeon, { ...spec, exits: [direction] }, {
        footprint: { x: p.x - 4, y: p.y - 17, width: 9, height: 22 }, dimensions: { clearance: 4.5 }
      }, mutable);
      if (result.routes.length) { built = result.routes[0]; break; }
    }
    if (!built) throw Error(`Cannot construct a safe ${direction} staircase for ${floor.siteId}; no floor was finalized.`);
    routes.push(built);
  }
  if (architecture) architecture.verticalRoutes = { ...architecture.verticalRoutes, routes };
  return (dungeon.fortifiedStairs = { version: 1, status: 'built', siteId: floor.siteId, level: floor.level,
    routes, surfaceModel: 'stairs-to-separate-world-xyz-storey' });
}
module.exports = { install };
