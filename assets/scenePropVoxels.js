(function(root) {
  'use strict';
  const shapes = new Set(['dead_tree', 'tomb', 'furnace', 'arch', 'brazier', 'rubble', 'pool', 'roots', 'altar', 'crystal']);

  function select(type, assembly, primitive) {
    const name = String(type || '').toLowerCase();
    if (/furnace|kiln|smelter/.test(name)) return 'furnace';
    if (/dead.?tree|withered|calcified.*tree/.test(name)) return 'dead_tree';
    if (/gravestone|headstone|tomb|grave_marker/.test(name)) return 'tomb';
    if (/root|vine|tendril/.test(name)) return 'roots';
    if (/brazier|fire_bowl/.test(name)) return 'brazier';
    if (/arch/.test(name)) return 'arch';
    if (/pool|basin/.test(name)) return 'pool';
    if (/rubble|fallen_stone|shards.*stone|bones/.test(name)) return 'rubble';
    if (/altar|sarcophag/.test(name)) return 'altar';
    if (/crystal/.test(name)) return 'crystal';
    const kit = { tree: 'dead_tree', vines: 'roots', grave: 'tomb', tomb: 'tomb', brazier: 'brazier', arch: 'arch', pool: 'pool', rubble: 'rubble', bones: 'rubble', altar: 'altar', crystal: 'crystal' }[assembly?.kit];
    return kit || { tree: 'dead_tree', arch: 'arch', pile: 'rubble', mound: 'rubble', pool: 'pool', bowl: 'brazier', crystal: 'crystal', slab: 'altar' }[primitive?.shape] || null;
  }

  // Unit-volume shapes: the existing renderer applies world width and height once.
  function build(shape, size = 16) {
    if (!shapes.has(shape)) return null;
    if (!Number.isInteger(size) || size < 8 || size > 64) throw new RangeError('Voxel size must be 8..64.');
    const grid = new Uint8Array(size ** 3);
    const box = (x0, y0, z0, x1, y1, z1) => {
      for (let z = Math.floor(z0 * size); z < Math.ceil(z1 * size); z++) {
        for (let y = Math.floor(y0 * size); y < Math.ceil(y1 * size); y++) {
          for (let x = Math.floor(x0 * size); x < Math.ceil(x1 * size); x++) {
            if (x >= 0 && y >= 0 && z >= 0 && x < size && y < size && z < size) {
              grid[x + y * size + z * size * size] = 1;
            }
          }
        }
      }
    };
    const branch = (a, b, radius) => {
      const steps = Math.ceil(Math.hypot(...b.map((v, i) => v - a[i])) * size * 2);
      for (let i = 0; i <= steps; i++) {
        const p = a.map((v, k) => v + (b[k] - v) * i / Math.max(1, steps));
        box(p[0] - radius, p[1] - radius, p[2] - radius,
          p[0] + radius, p[1] + radius, p[2] + radius);
      }
    };
    if (shape === 'dead_tree') {
      branch([0.5, 0.5, 0.03], [0.47, 0.51, 0.7], 0.08);
      branch([0.47, 0.51, 0.7], [0.58, 0.48, 0.98], 0.035);
      branch([0.48, 0.5, 0.48], [0.12, 0.3, 0.71], 0.05);
      branch([0.12, 0.3, 0.71], [0.08, 0.24, 0.9], 0.025);
      branch([0.49, 0.5, 0.64], [0.88, 0.72, 0.84], 0.04);
      branch([0.72, 0.63, 0.75], [0.81, 0.87, 0.95], 0.025);
      branch([0.5, 0.5, 0.4], [0.6, 0.12, 0.64], 0.04);
      for (const end of [[0.2, 0.4, 0.02], [0.73, 0.75, 0.02], [0.58, 0.18, 0.02]]) {
        branch([0.5, 0.5, 0.14], end, 0.045);
      }
    } else if (shape === 'tomb') {
      box(0.08, 0.12, 0, 0.92, 0.88, 0.12);
      box(0.18, 0.22, 0.12, 0.82, 0.78, 0.23);
      box(0.22, 0.35, 0.23, 0.78, 0.65, 0.77);
      box(0.28, 0.35, 0.77, 0.72, 0.65, 0.89);
      box(0.37, 0.35, 0.89, 0.63, 0.65, 1);
    } else if (shape === 'furnace') {
      box(0.06, 0.06, 0, 0.94, 0.94, 0.12);
      box(0.06, 0.1, 0.12, 0.24, 0.9, 0.65);
      box(0.76, 0.1, 0.12, 0.94, 0.9, 0.65);
      box(0.24, 0.74, 0.12, 0.76, 0.9, 0.65);
      box(0.06, 0.1, 0.53, 0.94, 0.9, 0.7);
      // Hollow firebox and chimney, not a painted rectangle on a solid cube.
      box(0.5, 0.5, 0.7, 0.625, 1, 1);
      box(0.875, 0.5, 0.7, 1, 1, 1);
      box(0.625, 0.5, 0.7, 0.875, 0.625, 1);
      box(0.625, 0.875, 0.7, 0.875, 1, 1);
    } else if (shape === 'arch') {
      box(0, 0.3, 0, 0.2, 0.7, 0.8);
      box(0.8, 0.3, 0, 1, 0.7, 0.8);
      box(0.1, 0.3, 0.75, 0.3, 0.7, 0.9);
      box(0.7, 0.3, 0.75, 0.9, 0.7, 0.9);
      box(0.25, 0.3, 0.88, 0.75, 0.7, 1);
    } else if (shape === 'brazier' || shape === 'pool') {
      if (shape === 'brazier') {
        box(0.15, 0.15, 0, 0.3, 0.3, 0.65);
        box(0.7, 0.15, 0, 0.85, 0.3, 0.65);
        box(0.4, 0.7, 0, 0.6, 0.85, 0.65);
      }
      const base = shape === 'pool' ? 0 : 0.55;
      box(0.1, 0.1, base, 0.9, 0.9, base + 0.12);
      box(0.05, 0.05, base + 0.1, 0.2, 0.95, 0.98);
      box(0.8, 0.05, base + 0.1, 0.95, 0.95, 0.98);
      box(0.2, 0.05, base + 0.1, 0.8, 0.2, 0.98);
      box(0.2, 0.8, base + 0.1, 0.8, 0.95, 0.98);
    } else if (shape === 'roots') {
      for (const [a, b] of [
        [[0.05, 0.2, 0.04], [0.9, 0.7, 0.18]],
        [[0.2, 0.95, 0.05], [0.6, 0.15, 0.45]],
        [[0.3, 0.4, 0.12], [0.2, 0.3, 0.95]],
        [[0.65, 0.5, 0.2], [0.85, 0.25, 0.7]]
      ]) branch(a, b, 0.055);
    } else if (shape === 'altar') {
      box(0.08, 0.15, 0, 0.92, 0.85, 0.15);
      box(0.2, 0.25, 0.15, 0.8, 0.75, 0.8);
      box(0, 0.05, 0.8, 1, 0.95, 1);
    } else if (shape === 'crystal') {
      for (const [cx, cy, h] of [[0.45, 0.5, 1], [0.2, 0.25, 0.6], [0.75, 0.65, 0.75]]) {
        box(cx - 0.12, cy - 0.12, 0, cx + 0.12, cy + 0.12, h - 0.2);
        box(cx - 0.065, cy - 0.065, h - 0.2, cx + 0.065, cy + 0.065, h);
      }
    } else if (shape === 'rubble') {
      for (const [x, y, w, h] of [[0.05, 0.15, 0.35, 0.4], [0.35, 0.4, 0.45, 0.6], [0.55, 0.1, 0.35, 0.35], [0.18, 0.48, 0.3, 0.8]]) {
        box(x, y, 0, x + w, y + w, h);
        box(x + 0.05, y + 0.05, h, x + w - 0.05, y + w - 0.05, h + 0.15);
      }
    }
    return grid;
  }

  const api = { build, select };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScenePropVoxels = api;
})(typeof window === 'undefined' ? globalThis : window);
