(function(root) {
  'use strict';
  const V = typeof module !== 'undefined' && module.exports ? require('./scenePropVoxels') : root.ScenePropVoxels;
  const masks = new Map();
  const plinths = new Map();
  const SIZE = 16;
  const PLINTH_TOP = { doric_column: 0.07, ionic_column: 0.17, corinthian_column: 0.17, fluted_column: 0.2 };

  function dimensions(cell, spec) {
    const floor = Number.isFinite(cell.floorHeight) ? cell.floorHeight : 0;
    return { floor, width: Number.isFinite(spec.baseWidth) ? spec.baseWidth : 0.6,
      height: Number.isFinite(cell.structureHeight) ? cell.structureHeight :
        Math.max(0.5, ((cell.ceilHeight ?? floor + 2) - floor) * (spec.heightRatio ?? 1)) };
  }

  function plinthFor(shape) {
    if (plinths.has(shape)) return plinths.get(shape);
    const grid = V?.build(shape, SIZE);
    if (!grid) return null;
    const top = new Uint8Array(SIZE * SIZE);
    const layers = Math.ceil(PLINTH_TOP[shape] * SIZE);
    for (let z = 0; z < layers; z++) for (let i = 0; i < top.length; i++) {
      if (grid[z * SIZE * SIZE + i]) top[i] = z + 1;
    }
    plinths.set(shape, top);
    return top;
  }

  // Sub-tile footing leaves the shared room grid and adjacent passage heights unchanged.
  function surfaceAt(dungeon, x, y, radius = 0.2) {
    const cx = Math.floor(x), cy = Math.floor(y);
    const result = { height: dungeon?.cells?.[`${cx},${cy}`]?.floorHeight || 0, kind: 'floor' };
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const key = `${cx + dx},${cy + dy}`, cell = dungeon?.cells?.[key];
      const spec = dungeon?.tiles?.[cell?.tile]?.spriteSpec;
      if (!PLINTH_TOP[spec?.voxelShape] || cell.tile === 'pillar' || cell.blocked || cell.obstacle || spec.collisionBlocking === false) continue;
      const { floor, width, height } = dimensions(cell, spec);
      if (width <= 0 || height <= 0) continue;
      const originX = cx + dx + 0.5 - width / 2, originY = cy + dy + 0.5 - width / 2;
      if (x + radius < originX || x - radius > originX + width || y + radius < originY || y - radius > originY + width) continue;
      const top = plinthFor(spec.voxelShape);
      if (!top) continue;
      const step = width / SIZE;
      for (let gy = Math.max(0, Math.floor((y - radius - originY) / step)); gy <= Math.min(SIZE - 1, Math.floor((y + radius - originY) / step)); gy++) {
        for (let gx = Math.max(0, Math.floor((x - radius - originX) / step)); gx <= Math.min(SIZE - 1, Math.floor((x + radius - originX) / step)); gx++) {
          const z = top[gy * SIZE + gx];
          const ox = Math.max(originX + gx * step - x, 0, x - originX - (gx + 1) * step);
          const oy = Math.max(originY + gy * step - y, 0, y - originY - (gy + 1) * step);
          const surface = floor + z / SIZE * height;
          if (z && ox * ox + oy * oy < radius * radius && surface > result.height) {
            Object.assign(result, { height: surface, kind: 'column-plinth', key, shape: spec.voxelShape });
          }
        }
      }
    }
    return result;
  }

  function maskFor(shape, low, high, seed = 0) {
    const key = `${shape}:${seed}:${low}:${high}`;
    if (masks.has(key)) return masks.get(key);
    const grid = V?.build(shape, SIZE, seed);
    if (!grid) return null;
    const mask = new Uint8Array(SIZE * SIZE);
    for (let z = low; z <= high; z++) for (let i = 0; i < mask.length; i++) {
      if (grid[z * SIZE * SIZE + i]) mask[i] = 1;
    }
    if (masks.size >= 256) masks.delete(masks.keys().next().value);
    masks.set(key, mask);
    return mask;
  }

  // Use the actual rendered horizontal cross-section at the standing body's height.
  function testCell(dungeon, tileX, tileY, x, y, radius = 0.2, eyeHeight = 0.65, stepHeight = 1.5, standingHeight) {
    const cell = dungeon?.cells?.[`${tileX},${tileY}`];
    const tile = cell?.tile;
    const spec = dungeon?.tiles?.[tile]?.spriteSpec;
    if (!spec?.voxelShape || tile === 'pillar' || !V?.shapes.includes(spec.voxelShape)) return null;
    if (cell.blocked || cell.obstacle) return { blocked: true, shape: spec.voxelShape, mode: 'blocked-voxel' };
    if (spec.collisionBlocking === false) return { blocked: false, shape: spec.voxelShape, mode: 'nonblocking-voxel' };
    const { width, floor, height } = dimensions(cell, spec);
    if (width <= 0 || height <= 0) return null;
    const standingFloor = Number.isFinite(standingHeight) ? standingHeight : surfaceAt(dungeon, x, y, radius).height;
    const lowZ = standingFloor + Math.max(0, eyeHeight - radius) - floor;
    const highZ = standingFloor + eyeHeight + radius - floor;
    if (lowZ >= height || highZ < 0) return { blocked: false, shape: spec.voxelShape, mode: 'voxel-cross-section' };
    if (/_column$/.test(spec.voxelShape)) {
      // Match legacy pillar clearance, but keep the camera outside unusually broad shafts.
      const shaft = spec.voxelShape === 'doric_column' ? 0.35 : spec.voxelShape === 'fluted_column' ? 0.32 : 0.3;
      const clearance = Math.max(Math.max(0.08, Math.min(0.18, width * 0.18)), width * shaft - radius + 0.04);
      const distance = Math.hypot(x - tileX - 0.5, y - tileY - 0.5);
      return { blocked: distance < clearance + radius, shape: spec.voxelShape, mode: 'column-clearance',
        radius, clearance, distance };
    }
    const low = Math.max(0, Math.min(SIZE - 1, Math.floor(lowZ / height * SIZE)));
    const high = Math.max(0, Math.min(SIZE - 1, Math.floor(highZ / height * SIZE)));
    const mask = maskFor(spec.voxelShape, low, high, spec.voxelSeed || 0);
    if (!mask) return null;
    const originX = tileX + 0.5 - width / 2, originY = tileY + 0.5 - width / 2;
    const step = width / SIZE;
    const minX = Math.max(0, Math.floor((x - radius - originX) / step));
    const maxX = Math.min(SIZE - 1, Math.floor((x + radius - originX) / step));
    const minY = Math.max(0, Math.floor((y - radius - originY) / step));
    const maxY = Math.min(SIZE - 1, Math.floor((y + radius - originY) / step));
    for (let gy = minY; gy <= maxY; gy++) for (let gx = minX; gx <= maxX; gx++) {
      if (!mask[gy * SIZE + gx]) continue;
      const dx = Math.max(originX + gx * step - x, 0, x - originX - (gx + 1) * step);
      const dy = Math.max(originY + gy * step - y, 0, y - originY - (gy + 1) * step);
      if (dx * dx + dy * dy < radius * radius) {
        return { blocked: true, shape: spec.voxelShape, mode: 'voxel-cross-section',
          voxel: { x: gx, y: gy, low, high }, radius };
      }
    }
    return { blocked: false, shape: spec.voxelShape, mode: 'voxel-cross-section' };
  }

  const api = { testCell, surfaceAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoxelCollision = api;
})(typeof window === 'undefined' ? globalThis : window);
