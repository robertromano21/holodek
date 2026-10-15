'use strict';

// A continuous rock canopy, not load-bearing temple bays or random sky openings.
function build(dungeon, spec, version) {
  const { width, height } = dungeon.layout;
  const material = ['stone', 'obsidian', 'ice', 'earth', 'crystal'].includes(spec.wallStyleMaterial) ? spec.wallStyleMaterial : 'stone';
  let spring = 3;
  for (const c of Object.values(dungeon.cells)) spring = Math.max(spring,
    Number.isFinite(c.ceilHeight) ? c.ceilHeight : (c.floorHeight || 0) + 3);
  const tile = `custom_underground_roof_v${version}_${material}`;
  dungeon.tiles ||= {};
  dungeon.tiles[tile] = { url: dungeon.tiles.wall?.url,
    spriteSpec: { voxelShape: 'rock_ceiling', material, profile: 'flat', heightRatio: 1, baseWidth: 1 } };
  const parts = [];
  // Shared elevation and solid, abutting edges prevent sky leaks between chunks.
  for (let y = 0; y < height; y += 32) for (let x = 0; x < width; x += 32) parts.push({
    tile, shape: 'rock_ceiling', position: { x, y, z: spring },
    size: { x: Math.min(32, width - x), y: Math.min(32, height - y), z: .6 }, role: 'underground-ceiling'
  });
  let count = 0;
  for (const c of Object.values(dungeon.cells)) {
    if (c.tile === 'wall' || c.tile === 'torch') c.ceilHeight = Math.max(c.ceilHeight || 0, spring + .6);
    c.roof = { version, style: 'rock', height: spring, slopeX: 0, slopeY: 0, material, zone: 'underground' };
    if (c.tile === 'floor') count++;
  }
  dungeon.sceneStructures = [...(dungeon.sceneStructures || []), ...parts];
  return { version, status: 'built', style: 'rock', idiom: 'natural', coveredCells: Object.keys(dungeon.cells).length,
    parts: parts.length, bays: [], rejected: [], skyDefault: false, roofEvidence: 'underground-geology',
    coverage: { eligible: count, covered: count, uncovered: 0, ratio: 1, target: 1, targetMet: true, openZones: [] } };
}

module.exports = { build };
