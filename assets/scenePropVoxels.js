(function(root) {
  'use strict';
  const nodeMasonry = typeof module !== 'undefined' && module.exports ? require('./masonryPatterns') : null;
  const treeShapes = ['dead_tree', 'oak', 'pine', 'willow', 'cypress', 'mushroom_tree', 'bone_tree', 'charred_tree'];
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const deadTrees = ['pale_hollow_tree', 'split_snag', 'wind_bent_tree', 'dead_willow', 'skeletal_pine', 'twisted_yew', 'rootbound_tree'];
  const scrubShapes = ['thorn_bush', 'bramble_patch', 'ash_reeds'];
  const vegetation = Object.fromEntries([...deadTrees, ...scrubShapes].map(shape => [shape, {
    drawer: deadTrees.includes(shape) ? 'dead_tree' : 'ash_flora', material: 'wood',
    baseWidth: deadTrees.includes(shape) ? 2.1 : 1.15,
    heightRatio: deadTrees.includes(shape) ? 1.6 : 0.3
  }]));
  // Natural props stay separate from masonry and from the existing tree catalog.
  const naturalProp = (drawer, material, baseWidth, heightRange, biomes, organic, palette) =>
    Object.freeze({ drawer, material, baseWidth, heightRange: Object.freeze(heightRange),
      heightRatio: heightRange[0] / 2.5, biomes: Object.freeze(biomes), organic,
      variants: 3, palette: Object.freeze(palette) });
  const biomeProps = Object.freeze({
    eroded_hoodoo: naturalProp('boulder', 'sandstone', .85, [1.25, 2.2], ['badlands'], false, ['#b78358', '#d9ac78']),
    mushroom_rock: naturalProp('boulder', 'sandstone', .95, [.85, 1.5], ['badlands'], false, ['#bd916c', '#e0bb88']),
    wind_carved_arch: naturalProp('archway', 'sandstone', .95, [1, 1.8], ['badlands'], false, ['#b27d56', '#d9b287']),
    layered_outcrop: naturalProp('boulder', 'stone', .95, [.45, .85], ['badlands', 'wetland'], false, ['#8d8270', '#b8a186']),
    stone_cairn: naturalProp('rubble', 'stone', .7, [.65, 1.1], ['badlands', 'forest', 'icy'], false, ['#858a82', '#b4b8ad']),
    talus_fan: naturalProp('rubble', 'stone', .95, [.25, .5], ['badlands', 'volcanic', 'icy'], false, ['#747475', '#a09c91']),
    hollow_log: naturalProp('dead_tree', 'wood', .95, [.3, .55], ['forest', 'wetland'], true, ['#66513d', '#ac9065']),
    uprooted_rootball: naturalProp('vines', 'wood', .95, [.65, 1.1], ['forest', 'wetland'], true, ['#584b39', '#9c8359']),
    buttress_roots: naturalProp('vines', 'wood', .95, [.45, .85], ['forest', 'wetland'], true, ['#665742', '#94805a']),
    shelf_fungi: naturalProp('mushroom', 'moss', .8, [.5, .9], ['forest', 'wetland'], true, ['#97754d', '#e3c79b']),
    toadstool_ring: naturalProp('mushroom', 'moss', .9, [.25, .5], ['forest', 'wetland'], true, ['#a27556', '#e7d9b3']),
    fumarole_vent: naturalProp('boulder', 'obsidian', .9, [.35, .7], ['volcanic'], false, ['#4d5050', '#91836b']),
    mineral_cone: naturalProp('stalagmite', 'stone', .8, [.8, 1.5], ['volcanic'], false, ['#c4ad80', '#eee0b8']),
    basalt_columns: naturalProp('boulder', 'obsidian', .95, [1, 1.8], ['volcanic'], false, ['#464c50', '#727b7f']),
    lava_spatter: naturalProp('rubble', 'obsidian', .9, [.45, .8], ['volcanic'], false, ['#4d3d35', '#967050']),
    sulfur_crust: naturalProp('rubble', 'stone', .95, [.15, .3], ['volcanic'], false, ['#b4a14a', '#e4d374']),
    ice_spires: naturalProp('crystal_cluster', 'ice', .8, [.9, 1.7], ['icy'], false, ['#78b3c7', '#d6f0f3']),
    ice_arch: naturalProp('archway', 'ice', .95, [.8, 1.5], ['icy'], false, ['#92c9d9', '#e2f6f7']),
    pressure_ridge: naturalProp('rubble', 'ice', .95, [.45, .9], ['icy'], false, ['#95b9c4', '#ecf6f4']),
    glacial_erratic: naturalProp('boulder', 'stone', .9, [.55, 1], ['icy', 'badlands'], false, ['#7c8e93', '#c1cbd0']),
    driftwood_tangle: naturalProp('vines', 'wood', .95, [.25, .55], ['wetland', 'forest'], true, ['#7d7c68', '#b8b498']),
    reed_tussock: naturalProp('ash_flora', 'wood', .75, [.5, .9], ['wetland', 'forest'], true, ['#707b46', '#b7b17a'])
  });
  const biomeShapes = Object.freeze(Object.keys(biomeProps));
  const architecture = {
    boulder: { drawer: 'boulder', material: 'stone', heightRatio: 1.1, baseWidth: 1.1 },
    rock_face: { drawer: 'boulder', material: 'stone', heightRatio: 2.2, baseWidth: 1.5 },
    portcullis: { drawer: 'gate', material: 'metal', heightRatio: 1.1, baseWidth: 0.9 },
    timber_gate: { drawer: 'gate', material: 'wood', heightRatio: 1.1, baseWidth: 0.9 },
    buttress: { drawer: 'obelisk', material: 'stone', heightRatio: 1.2, baseWidth: 0.8 },
    battlement: { drawer: 'rubble', material: 'stone', heightRatio: 0.85, baseWidth: 0.95 },
    arrow_slit: { drawer: 'gate', material: 'stone', heightRatio: 1.1, baseWidth: 0.9 },
    fluted_column: { drawer: 'pillar', material: 'marble', heightRatio: 1.2, baseWidth: 0.7 },
    doric_column: { drawer: 'pillar', material: 'stone', heightRatio: 1, baseWidth: 0.85 },
    ionic_column: { drawer: 'pillar', material: 'marble', heightRatio: 1, baseWidth: 0.85 },
    corinthian_column: { drawer: 'pillar', material: 'marble', heightRatio: 1, baseWidth: 0.85 },
    gothic_pier: { drawer: 'pillar', material: 'stone', heightRatio: 1, baseWidth: 0.85 },
    timber_post: { drawer: 'pillar', material: 'wood', heightRatio: 1, baseWidth: 0.8 },
    entablature: { drawer: 'altar', material: 'stone', heightRatio: 1, baseWidth: 1 },
    pediment: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    pediment_side: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    entablature_ring: { drawer: 'altar', material: 'stone', heightRatio: 1, baseWidth: 1 },
    dome_shell: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    barrel_rib: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    ribbed_vault: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    timber_truss: { drawer: 'archway', material: 'wood', heightRatio: 1, baseWidth: 1 },
    coffered_slab: { drawer: 'altar', material: 'stone', heightRatio: 1, baseWidth: 1 },
    barrel_vault_shell: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    pointed_vault_shell: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    pitched_roof_shell: { drawer: 'archway', material: 'wood', heightRatio: 1, baseWidth: 1 },
    groin_vault_shell: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    fan_vault_shell: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    pendentive_transition: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    squinch_transition: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    hammerbeam_truss: { drawer: 'archway', material: 'wood', heightRatio: 1, baseWidth: 1 },
    boarded_ceiling: { drawer: 'altar', material: 'wood', heightRatio: 1, baseWidth: 1 },
    gold_coffered_slab: { drawer: 'altar', material: 'gold', heightRatio: 1, baseWidth: 1 },
    flying_buttress: { drawer: 'archway', material: 'stone', heightRatio: 1, baseWidth: 1 },
    palisade: { drawer: 'gate', material: 'wood', heightRatio: 1, baseWidth: 1 },
    obelisk: { drawer: 'obelisk', heightRatio: 1.5, baseWidth: 0.8 },
    pointed_arch: { drawer: 'archway', material: 'stone', heightRatio: 1.2, baseWidth: 0.9 },
    sarcophagus: { drawer: 'sarcophagus', material: 'marble', heightRatio: 0.5, baseWidth: 0.95 }
  };
  const shapes = new Set([...treeShapes, ...Object.keys(vegetation), ...Object.keys(architecture), ...biomeShapes, 'exit_marker', 'tomb', 'furnace', 'arch', 'brazier', 'rubble', 'broken_masonry', 'fallen_arch', 'scree', 'pool', 'roots', 'altar', 'crystal', 'stump', 'stalagmite']);

  function random(seed) {
    let state = 2166136261;
    for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619) >>> 0;
    return () => { state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return state / 4294967296; };
  }

  function select(type, assembly, primitive) {
    const name = String(type || '').toLowerCase();
    for (const shape of biomeShapes) if (name.includes(shape)) return shape;
    for (const shape of Object.keys(vegetation)) if (name.includes(shape)) return shape;
    for (const shape of Object.keys(architecture).sort((a, b) => b.length - a.length)) {
      if (name.includes(shape)) return shape;
    }
    for (const shape of ['doric_column', 'ionic_column', 'corinthian_column', 'gothic_pier', 'timber_post', 'obelisk']) {
      if (name.includes(shape)) return shape;
    }
    if (/fallen_arch|collapsed_arch/.test(name)) return 'fallen_arch';
    if (/broken_masonry|masonry_rubble|brick_rubble/.test(name)) return 'broken_masonry';
    if (/scree|rockfall|loose_stones/.test(name)) return 'scree';
    if (/portcullis|iron_gate|barred_gate/.test(name)) return 'portcullis';
    if (/timber_gate|wooden_gate/.test(name)) return 'timber_gate';
    if (/buttress/.test(name)) return 'buttress';
    if (/battlement|crenellat|parapet/.test(name)) return 'battlement';
    if (/arrow_slit|arrow_loop|loophole/.test(name)) return 'arrow_slit';
    if (/rock.?face|cliff.?face|escarpment/.test(name)) return 'rock_face';
    if (/boulder|rock_formation|^rock$/.test(name)) return 'boulder';
    if (/fluted_column|classical_column|roman_column/.test(name)) return 'fluted_column';
    if (/pointed_arch|gothic_arch/.test(name)) return 'pointed_arch';
    if (/sarcophag/.test(name)) return 'sarcophagus';
    for (const tree of ['mushroom_tree', 'bone_tree', 'charred_tree', 'cypress', 'willow', 'pine', 'oak']) if (name.includes(tree)) return tree;
    if (/stump|fallen_log/.test(name)) return 'stump';
    if (/stalagmite/.test(name)) return 'stalagmite';
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
    if (/tree/.test(name)) return 'oak';
    const kit = { tree: 'oak', vines: 'roots', grave: 'tomb', tomb: 'tomb', brazier: 'brazier', arch: 'arch', pool: 'pool', rubble: 'rubble', bones: 'rubble', altar: 'altar', crystal: 'crystal' }[assembly?.kit];
    return kit || { tree: 'dead_tree', arch: 'arch', pile: 'rubble', mound: 'rubble', pool: 'pool', bowl: 'brazier', crystal: 'crystal', slab: 'altar' }[primitive?.shape] || null;
  }

  // Unit-volume shapes: the existing renderer applies world width and height once.
  function build(shape, size = 16, seed = 0) {
    if (!shapes.has(shape)) return null;
    if (!Number.isInteger(size) || size < 8 || size > 64) throw new RangeError('Voxel size must be 8..64.');
    if (shape === 'pediment_side') {
      const source = build('pediment', size), rotated = new Uint8Array(source.length);
      for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        rotated[(size - 1 - y) + x * size + z * size * size] = source[x + y * size + z * size * size];
      }
      return rotated;
    }
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
    const woodyCurve = (a, control, b, radius, tipRadius) => {
      const length = Math.hypot(...control.map((v, k) => v - a[k])) + Math.hypot(...b.map((v, k) => v - control[k]));
      const steps = Math.max(1, Math.ceil(length * size * 3));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, p = a.map((v, k) => ((1 - t) ** 2 * v + 2 * (1 - t) * t * control[k] + t * t * b[k]) * size);
        const r = (radius + (tipRadius - radius) * t) * size;
        // Sample round tubes at voxel centers. Tiny twigs keep one centerline voxel,
        // rather than inflating every sample to an overlapping 2x2x2 box.
        for (let z = Math.floor(p[2] - r); z <= Math.ceil(p[2] + r); z++) {
          for (let y = Math.floor(p[1] - r); y <= Math.ceil(p[1] + r); y++) for (let x = Math.floor(p[0] - r); x <= Math.ceil(p[0] + r); x++) {
            if (x >= 0 && y >= 0 && z >= 0 && x < size && y < size && z < size &&
                Math.hypot(x + .5 - p[0], y + .5 - p[1], z + .5 - p[2]) <= r) grid[x + y * size + z * size * size] = 1;
          }
        }
        const [x, y, z] = p.map(Math.floor);
        if (x >= 0 && y >= 0 && z >= 0 && x < size && y < size && z < size) grid[x + y * size + z * size * size] = 1;
      }
    };
    if (biomeProps[shape]) {
      buildNaturalProp(shape, size, seed, grid, box, woodyCurve);
    } else if (deadTrees.includes(shape) || ['dead_tree', 'bone_tree', 'charred_tree'].includes(shape)) {
      const rnd = random(`${shape}:${seed}`);
      const bent = shape === 'wind_bent_tree', snag = shape === 'split_snag';
      const at = z => [0.5 + (bent ? z * 0.28 : Math.sin(z * 7) * 0.05), 0.5 + Math.sin(z * 5 + rndLean) * 0.035, z];
      const rndLean = rnd() * Math.PI * 2;
      for (let i = 0; i < 10; i++) {
        const z = i * (snag ? 0.067 : 0.095);
        const endZ = z + (snag ? 0.067 : 0.095);
        woodyCurve(at(z), at((z + endZ) / 2), at(endZ), .07 - z * .052, .07 - endZ * .052);
      }
      const arms = shape === 'skeletal_pine' ? 12 : snag ? 5 : 8;
      for (let i = 0; i < arms; i++) {
        const z = 0.3 + i / arms * 0.48, a = i * GOLDEN_ANGLE + rnd() * 0.6;
        const start = at(z), reach = 0.25 + rnd() * 0.14;
        const end = [Math.max(0.08, Math.min(0.92, start[0] + Math.cos(a) * reach)),
          Math.max(0.08, Math.min(0.92, start[1] + Math.sin(a) * reach)),
          Math.min(0.95, z + (shape === 'skeletal_pine' ? 0.06 : 0.15 + rnd() * 0.12))];
        const mid = start.map((v, k) => v + (end[k] - v) * 0.55);
        const curl = (shape === 'twisted_yew' ? .14 : .07) * (rnd() < .5 ? -1 : 1);
        mid[0] -= Math.sin(a) * curl; mid[1] += Math.cos(a) * curl; mid[2] += .05;
        woodyCurve(start, mid, end, .027, .009);
        for (const side of [-1, 1]) {
          const aa = a + side * (0.4 + rnd() * 0.5);
          const tip = [Math.max(0.035, Math.min(0.965, end[0] + Math.cos(aa) * 0.1)),
            Math.max(0.035, Math.min(0.965, end[1] + Math.sin(aa) * 0.1)),
            shape === 'dead_willow' ? Math.max(0.22, end[2] - 0.24 - rnd() * 0.16) : Math.min(0.98, end[2] + 0.09)];
          const bend = end.map((v, k) => (v + tip[k]) / 2);
          bend[0] -= Math.sin(aa) * .045; bend[1] += Math.cos(aa) * .045;
          if (shape === 'dead_willow') bend[2] += .07;
          woodyCurve(end, bend, tip, .012, .003);
        }
      }
      for (let i = 0; i < (shape === 'rootbound_tree' ? 9 : 5); i++) {
        const a = i * GOLDEN_ANGLE;
        woodyCurve([.5, .5, .16], [.5 + Math.cos(a) * .18, .5 + Math.sin(a) * .18, .04],
          [.5 + Math.cos(a) * .34, .5 + Math.sin(a) * .34, .02], shape === 'rootbound_tree' ? .045 : .025, .008);
      }
      if (snag) {
        woodyCurve(at(.5), [.38, .58, .7], [.36, .45, .93], .038, .012);
        woodyCurve(at(.5), [.6, .48, .72], [.68, .58, .82], .03, .008);
      }
      if (shape === 'pale_hollow_tree') {
        // Keep the split trunk open, rather than painting a black spot on a solid trunk.
        for (let z = 1; z < size * 0.35; z++) for (let y = Math.floor(size * 0.4); y < size * 0.58; y++) {
          for (let x = Math.floor(size * 0.46); x < size * 0.53; x++) grid[x + y * size + z * size * size] = 0;
        }
      }
    } else if (scrubShapes.includes(shape)) {
      const rnd = random(`${shape}:${seed}`);
      for (let i = 0; i < 11; i++) {
        const a = i * GOLDEN_ANGLE, r = 0.2 + rnd() * 0.24;
        const start = [0.5, 0.5, 0.025];
        const end = [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, 0.35 + rnd() * 0.55];
        if (shape === 'ash_reeds') { start[0] = end[0]; start[1] = end[1]; end[0] += 0.02; }
        if (shape === 'bramble_patch') end[2] *= 0.6;
        branch(start, end, 0.018);
        if (shape !== 'ash_reeds') branch(end.map((v, k) => (v + start[k]) / 2),
          [Math.max(0.04, end[0] - 0.09), Math.min(0.96, end[1] + 0.1), end[2] + 0.08], 0.012);
      }
    } else if (shape === 'exit_marker') {
      box(0.04, 0.04, 0, 0.18, 0.96, 0.6); box(0.82, 0.04, 0, 0.96, 0.96, 0.6);
      box(0.18, 0.04, 0, 0.82, 0.18, 0.6); box(0.18, 0.82, 0, 0.82, 0.96, 0.6);
      branch([0.5, 0.35, 0.6], [0.5, 0.65, 0.6], 0.045);
    } else if (shape === 'portcullis' || shape === 'timber_gate') {
      box(0, 0.3, 0, 0.12, 0.7, 1);
      box(0.88, 0.3, 0, 1, 0.7, 1);
      box(0.1, 0.3, 0.9, 0.9, 0.7, 1);
      for (let x = 0.2; x < 0.9; x += 0.2) box(x, 0.45, 0.02, x + 0.05, 0.55, 0.92);
      for (const z of [0.25, 0.55, 0.8]) box(0.1, 0.42, z, 0.9, 0.58, z + 0.055);
      if (shape === 'timber_gate') box(0.12, 0.46, 0.03, 0.88, 0.54, 0.91);
    } else if (shape === 'buttress') {
      for (let step = 0; step < 4; step++) {
        box(0.2 + step * 0.035, 0.05 + step * 0.17, step * 0.25,
          0.8 - step * 0.035, 0.95, (step + 1) * 0.25);
      }
    } else if (shape === 'battlement') {
      box(0, 0.25, 0, 1, 0.75, 0.65);
      for (const x of [0, 0.4, 0.8]) box(x, 0.25, 0.65, x + 0.2, 0.75, 1);
    } else if (shape === 'arrow_slit') {
      box(0, 0.3, 0, 1, 0.7, 0.2);
      box(0, 0.3, 0.85, 1, 0.7, 1);
      box(0, 0.3, 0.2, 0.42, 0.7, 0.85);
      box(0.58, 0.3, 0.2, 1, 0.7, 0.85);
    } else if (shape === 'obelisk') {
      box(0.06, 0.06, 0, 0.94, 0.94, 0.08);
      box(0.14, 0.14, 0.08, 0.86, 0.86, 0.16);
      for (let z = 0.16; z < 1; z += 1 / size) {
        const r = z < 0.82 ? 0.25 - (z - 0.16) * 0.1 : Math.max(0.01, (1 - z) * 1.04);
        box(0.5 - r, 0.5 - r, z, 0.5 + r, 0.5 + r, z + 1 / size);
      }
    } else if (shape === 'palisade') {
      for (let i = 0; i < 5; i++) {
        const x = i / 5;
        box(x + 0.025, 0.36, 0, x + 0.175, 0.64, 0.87);
        for (let z = 0.87; z < 1; z += 1 / size) {
          const inset = (z - 0.87) * 0.5;
          box(x + 0.025 + inset, 0.36 + inset, z, x + 0.175 - inset, 0.64 - inset, z + 1 / size);
        }
      }
      for (const z of [0.3, 0.6]) box(0, 0.6, z, 1, 0.7, z + 0.07);
    } else if (shape === 'flying_buttress') {
      box(0, 0.15, 0, 0.22, 0.85, 0.88);
      box(0.03, 0.24, 0.88, 0.18, 0.76, 1);
      for (let x = 0.2; x < 1; x += 1 / size) {
        const h = 0.5 + Math.sqrt(Math.max(0, 1 - (1 - x) ** 2)) * 0.45;
        box(x, 0.32, h - 0.11, x + 1 / size, 0.68, h);
      }
    } else if (shape === 'boarded_ceiling') {
      box(0, 0, 0.7, 1, 1, 1);
      for (let x = 0; x < 1; x += 0.125) box(x, 0, 0.32, x + 0.09, 1, 0.7);
      for (const y of [0.1, 0.8]) box(0, y, 0, 1, y + 0.1, 0.32);
    } else if (shape === 'coffered_slab' || shape === 'gold_coffered_slab') {
      box(0, 0, 0.65, 1, 1, 1);
      for (let i = 0; i < 4; i++) {
        box(i / 4, 0, 0, i / 4 + 0.06, 1, 0.65);
        box(0, i / 4, 0, 1, i / 4 + 0.06, 0.65);
      }
      if (shape === 'gold_coffered_slab') for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        box(x / 4 + 0.11, y / 4 + 0.11, 0.48, x / 4 + 0.18, y / 4 + 0.18, 0.65);
      }
    } else if (shape === 'groin_vault_shell' || shape === 'fan_vault_shell') {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const px = (x + 0.5) / size, py = (y + 0.5) / size;
        const r = Math.min(Math.hypot(px, py), Math.hypot(1 - px, py),
          Math.hypot(px, 1 - py), Math.hypot(1 - px, 1 - py));
        const h = shape === 'groin_vault_shell' ? Math.max(Math.sin(px * Math.PI), Math.sin(py * Math.PI)) * 0.85 :
          Math.min(0.9, Math.sqrt(r) * 1.15);
        box(x / size, y / size, Math.max(0, h - 0.1), (x + 1) / size, (y + 1) / size, h + 0.04);
      }
      if (shape === 'fan_vault_shell') for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [1, 0, -1, 1], [0, 1, 1, -1], [1, 1, -1, -1]]) {
        for (let a = 0; a <= Math.PI / 2; a += Math.PI / 12) {
          let last = [cx, cy, 0];
          for (let r = 0.08; r <= 0.7; r += 0.08) {
            const next = [cx + Math.cos(a) * r * sx, cy + Math.sin(a) * r * sy,
              Math.min(0.86, Math.sqrt(r) * 1.15) - 0.06];
            branch(last, next, 0.023); last = next;
          }
        }
      }
    } else if (shape === 'pendentive_transition' || shape === 'squinch_transition') {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const px = Math.abs((x + 0.5) / size - 0.5) * 2;
        const py = Math.abs((y + 0.5) / size - 0.5) * 2;
        if (px < 0.25 || py < 0.25) continue;
        if (shape === 'pendentive_transition' && (px + py) / 2 > 0.52) {
          const h = Math.sqrt(Math.max(0, 1 - Math.min(1, (px * px + py * py) / 2)));
          box(x / size, y / size, Math.max(0, h - 0.13), (x + 1) / size, (y + 1) / size, h + 0.09);
        } else if (shape === 'squinch_transition' && px + py > 1.2 && px + py < 1.65) {
          const h = Math.sqrt(Math.max(0, 1 - (px - py) ** 2)) * 0.85;
          box(x / size, y / size, h - 0.16, (x + 1) / size, (y + 1) / size, h + 0.08);
        }
      }
      box(0.1, 0.1, 0.9, 0.9, 0.17, 1); box(0.1, 0.83, 0.9, 0.9, 0.9, 1);
      box(0.1, 0.1, 0.9, 0.17, 0.9, 1); box(0.83, 0.1, 0.9, 0.9, 0.9, 1);
      for (const x of [0, 0.83]) for (const y of [0, 0.83]) box(x, y, 0, x + 0.17, y + 0.17, 0.4);
    } else if (shape === 'hammerbeam_truss') {
      box(0, 0.35, 0, 0.24, 0.65, 0.13); box(0.76, 0.35, 0, 1, 0.65, 0.13);
      for (const [a, b] of [ [[0.15, 0.5, 0], [0.25, 0.5, 0.65]],
        [[0.85, 0.5, 0], [0.75, 0.5, 0.65]], [[0, 0.5, 0.2], [0.5, 0.5, 1]],
        [[1, 0.5, 0.2], [0.5, 0.5, 1]], [[0.2, 0.5, 0.12], [0.5, 0.5, 0.8]],
        [[0.8, 0.5, 0.12], [0.5, 0.5, 0.8]] ]) branch(a, b, 0.045);
    } else if (['barrel_vault_shell', 'pointed_vault_shell', 'pitched_roof_shell'].includes(shape)) {
      for (let x = 0; x < size; x++) {
        const t = (x + 0.5) / size;
        const h = (shape === 'barrel_vault_shell' ? Math.sin(t * Math.PI) : 1 - Math.abs(2 * t - 1)) * 0.85;
        box(x / size, 0, Math.max(0, h - 0.1), (x + 1) / size, 1, h + 0.05);
      }
      if (shape === 'pitched_roof_shell') box(0.46, 0, 0.84, 0.54, 1, 1);
    } else if (['barrel_rib', 'ribbed_vault', 'timber_truss'].includes(shape)) {
      for (let i = 0; i < size; i++) {
        const t = (i + 0.5) / size;
        const h = shape === 'barrel_rib' ? Math.sin(t * Math.PI) : 1 - Math.abs(2 * t - 1);
        const ys = shape === 'ribbed_vault' ? [t, 1 - t] : [0.5];
        for (const y of ys) box(i / size, y - 0.07, Math.max(0, h - 0.1), (i + 1) / size, y + 0.07, h + 0.02);
      }
      if (shape === 'timber_truss') box(0, 0.44, 0, 1, 0.56, 0.08);
    } else if (shape === 'entablature') {
      box(0, 0.08, 0, 1, 0.92, 0.25);
      box(0, 0.16, 0.25, 1, 0.84, 0.72);
      box(0, 0, 0.72, 1, 1, 1);
    } else if (shape === 'pediment') {
      box(0, 0, 0, 1, 1, 0.12);
      for (let x = 0; x < size; x++) {
        const h = 1 - Math.abs(2 * (x + 0.5) / size - 1);
        // Recessed tympanum with raised cornices on both faces.
        box(x / size, 0.15, 0.08, (x + 1) / size, 0.85, h);
        box(x / size, 0, Math.max(0.08, h - 0.12), (x + 1) / size, 1, h + 0.04);
      }
    } else if (shape === 'dome_shell' || shape === 'entablature_ring') {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) / 0.5;
        if (r > 1) continue;
        if (shape === 'entablature_ring') {
          if (r > 0.82) box(x / size, y / size, 0, (x + 1) / size, (y + 1) / size, 1);
        } else {
          const h = Math.sqrt(Math.max(0, 1 - r * r));
          if (r < 0.13) continue; // Oculus remains open to Tartarus's sky.
          box(x / size, y / size, r > 0.85 ? 0 : Math.max(0, h - 0.14), (x + 1) / size, (y + 1) / size, h);
        }
      }
    } else if (shape === 'timber_post') {
      box(0.1, 0.1, 0, 0.9, 0.9, 0.08);
      box(0.3, 0.3, 0.08, 0.7, 0.7, 1);
      branch([0.5, 0.5, 0.68], [0.08, 0.5, 0.94], 0.055);
      branch([0.5, 0.5, 0.68], [0.92, 0.5, 0.94], 0.055);
      box(0.02, 0.2, 0.94, 0.98, 0.8, 1);
    } else if (shape === 'gothic_pier') {
      box(0.08, 0.08, 0, 0.92, 0.92, 0.1);
      box(0.3, 0.3, 0.1, 0.7, 0.7, 0.92);
      for (const [x, y] of [[0.22, 0.5], [0.78, 0.5], [0.5, 0.22], [0.5, 0.78]]) {
        box(x - 0.1, y - 0.1, 0.1, x + 0.1, y + 0.1, 0.94);
      }
      box(0.12, 0.12, 0.92, 0.88, 0.88, 1);
    } else if (['doric_column', 'ionic_column', 'corinthian_column'].includes(shape)) {
      const doric = shape === 'doric_column';
      box(0.08, 0.08, 0, 0.92, 0.92, doric ? 0.07 : 0.1);
      if (!doric) box(0.18, 0.18, 0.1, 0.82, 0.82, 0.17);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
        const r = (doric ? 0.29 : 0.23) + 0.025 * Math.cos(Math.atan2(dy, dx) * 12);
        if (Math.hypot(dx, dy) <= r) box(x / size, y / size, doric ? 0.07 : 0.17, (x + 1) / size, (y + 1) / size, 0.83);
      }
      box(0.18, 0.18, 0.83, 0.82, 0.82, 0.92);
      if (shape === 'ionic_column') {
        for (const x of [0.02, 0.76]) box(x, 0.25, 0.83, x + 0.22, 0.75, 0.96);
      } else if (shape === 'corinthian_column') {
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          const x = 0.5 + Math.cos(a) * 0.32, y = 0.5 + Math.sin(a) * 0.32;
          box(x - 0.08, y - 0.08, 0.76 + i % 2 * 0.05, x + 0.08, y + 0.08, 0.95);
        }
      }
      box(0.05, 0.05, 0.95, 0.95, 0.95, 1);
    } else if (shape === 'boulder' || shape === 'rock_face') {
      for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const px = (x + 0.5) / size, py = (y + 0.5) / size, pz = (z + 0.5) / size;
        const rough = Math.sin(x * 1.7 + y * 0.9 + z * 0.6) * 0.035;
        const solid = shape === 'boulder' ?
          ((px - 0.48) / 0.46) ** 2 + ((py - 0.51) / 0.41) ** 2 + ((pz - 0.43) / 0.53) ** 2 < 1 + rough :
          px > 0.08 + rough && px < 0.94 - pz * 0.15 + rough && py > 0.15 + pz * 0.32 + rough && py < 0.94;
        if (solid) box(x / size, y / size, z / size, (x + 1) / size, (y + 1) / size, (z + 1) / size);
      }
    } else if (shape === 'fluted_column') {
      box(0.1, 0.1, 0, 0.9, 0.9, 0.12);
      box(0.16, 0.16, 0.12, 0.84, 0.84, 0.2);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
        const radius = 0.24 + 0.04 * Math.cos(Math.atan2(dy, dx) * 8);
        if (Math.hypot(dx, dy) <= radius) box(x / size, y / size, 0.2, (x + 1) / size, (y + 1) / size, 0.86);
      }
      box(0.12, 0.12, 0.86, 0.88, 0.88, 0.94);
      box(0.06, 0.06, 0.94, 0.94, 0.94, 1);
    } else if (shape === 'pointed_arch') {
      box(0.03, 0.3, 0, 0.2, 0.7, 0.55);
      box(0.8, 0.3, 0, 0.97, 0.7, 0.55);
      for (const side of [-1, 1]) for (let i = 0; i <= size; i++) {
        const t = i / size, x = 0.5 + side * 0.38 * (1 - t);
        box(x - 0.065, 0.3, 0.52 + t * 0.4, x + 0.065, 0.7, 0.6 + t * 0.4);
      }
    } else if (shape === 'sarcophagus') {
      box(0.08, 0.08, 0, 0.92, 0.92, 0.12);
      box(0.18, 0.12, 0.12, 0.82, 0.88, 0.65);
      box(0.1, 0.05, 0.65, 0.9, 0.95, 0.8);
      box(0.4, 0.22, 0.8, 0.6, 0.42, 1);
      box(0.35, 0.42, 0.8, 0.65, 0.82, 0.92);
    } else if (treeShapes.includes(shape)) {
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
      if (shape === 'oak') {
        box(0.12, 0.15, 0.56, 0.88, 0.85, 0.8);
        box(0.2, 0.23, 0.8, 0.78, 0.77, 0.94);
        box(0.32, 0.32, 0.94, 0.66, 0.65, 1);
      } else if (shape === 'pine' || shape === 'cypress') {
        for (let z = 0.35; z < 0.95; z += 0.1) {
          const radius = shape === 'pine' ? (1 - z) * 0.6 : 0.15 + (1 - z) * 0.12;
          box(0.5 - radius, 0.5 - radius, z, 0.5 + radius, 0.5 + radius, z + 0.1);
        }
      } else if (shape === 'willow') {
        box(0.1, 0.12, 0.78, 0.9, 0.88, 0.94);
        for (const p of [[0.1, 0.2], [0.1, 0.7], [0.85, 0.3], [0.8, 0.8], [0.3, 0.1], [0.7, 0.8]]) {
          box(p[0], p[1], 0.25, p[0] + 0.08, p[1] + 0.08, 0.85);
        }
      } else if (shape === 'mushroom_tree') {
        box(0.05, 0.05, 0.7, 0.95, 0.95, 0.82);
        box(0.15, 0.15, 0.82, 0.85, 0.85, 0.94);
        box(0.3, 0.3, 0.94, 0.7, 0.7, 1);
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
    } else if (shape === 'broken_masonry') {
      for (const [x, y, z, w] of [[0.05, 0.12, 0, 0.4], [0.52, 0.08, 0, 0.4], [0.22, 0.5, 0, 0.6], [0.12, 0.35, 0.25, 0.45], [0.4, 0.5, 0.5, 0.35]]) {
        box(x, y, z, x + w, y + 0.25, z + 0.2);
      }
      box(0.18, 0.55, 0.45, 0.35, 0.85, 0.95);
    } else if (shape === 'fallen_arch') {
      box(0.04, 0.18, 0, 0.25, 0.65, 0.9);
      box(0.7, 0.24, 0, 0.94, 0.78, 0.35);
      branch([0.28, 0.2, 0.12], [0.68, 0.65, 0.35], 0.12);
      box(0.32, 0.72, 0, 0.64, 0.94, 0.2);
    } else if (shape === 'scree') {
      for (let i = 0; i < 14; i++) {
        const x = 0.08 + ((i * 7) % 13) / 16, y = 0.05 + ((i * 5) % 11) / 14;
        const h = 0.12 + (1 - Math.hypot(x - 0.5, y - 0.5)) * 0.4;
        box(x, y, 0, x + 0.12, y + 0.13, h);
      }
    } else if (shape === 'rubble') {
      for (const [x, y, w, h] of [[0.05, 0.15, 0.35, 0.4], [0.35, 0.4, 0.45, 0.6], [0.55, 0.1, 0.35, 0.35], [0.18, 0.48, 0.3, 0.8]]) {
        box(x, y, 0, x + w, y + w, h);
        box(x + 0.05, y + 0.05, h, x + w - 0.05, y + w - 0.05, h + 0.15);
      }
    } else if (shape === 'stump') {
      box(0.1, 0.1, 0, 0.9, 0.9, 0.15);
      box(0.25, 0.25, 0.15, 0.75, 0.75, 0.85);
      box(0.2, 0.35, 0.85, 0.65, 0.7, 1);
    } else if (shape === 'stalagmite') {
      for (let z = 0; z < size; z++) {
        const r = 0.45 * (1 - z / size);
        box(0.5 - r, 0.5 - r, z / size, 0.5 + r, 0.5 + r, (z + 1) / size);
      }
    }
    return grid;
  }

  function usesRoomPalette(shape) {
    return !!architecture[shape] || ['arch', 'altar', 'tomb', 'rubble', 'fallen_arch', 'scree', 'broken_masonry'].includes(shape);
  }

  function buildNaturalProp(shape, size, seed, grid, box, curve) {
    const rnd = random(`${shape}:${seed}`), lean = (rnd() - .5) * .12, phase = rnd() * Math.PI * 2;
    const solid = (bounds, test) => {
      const [x0, y0, z0, x1, y1, z1] = bounds;
      for (let z = Math.max(0, Math.floor(z0 * size)); z < Math.min(size, Math.ceil(z1 * size)); z++) {
        for (let y = Math.max(0, Math.floor(y0 * size)); y < Math.min(size, Math.ceil(y1 * size)); y++) {
          for (let x = Math.max(0, Math.floor(x0 * size)); x < Math.min(size, Math.ceil(x1 * size)); x++) {
            if (test((x + .5) / size, (y + .5) / size, (z + .5) / size)) grid[x + y * size + z * size * size] = 1;
          }
        }
      }
    };
    const ellipsoid = (x, y, z, rx, ry, rz) => solid([x - rx, y - ry, z - rz, x + rx, y + ry, z + rz],
      (a, b, c) => ((a - x) / rx) ** 2 + ((b - y) / ry) ** 2 + ((c - z) / rz) ** 2 <= 1);
    const cone = (x, y, z0, z1, r0, r1, inner = 0, facets = false) => {
      solid([x - r0 - .15, y - r0 - .15, z0, x + r0 + .15, y + r0 + .15, z1], (a, b, z) => {
        const t = (z - z0) / (z1 - z0), dx = a - x - lean * t, dy = b - y;
        const radius = r0 + (r1 - r0) * t;
        const distance = facets ? Math.max(Math.abs(dx), Math.abs(dx * .5 + dy * .866), Math.abs(dx * .5 - dy * .866)) : Math.hypot(dx, dy);
        return distance <= radius && distance >= inner;
      });
    };
    if (shape === 'eroded_hoodoo') {
      cone(.5, .5, 0, .22, .32, .21);
      cone(.5, .5, .18, .8, .16, .09);
      ellipsoid(.5 + lean, .5, .86, .29 + rnd() * .05, .26, .14);
    } else if (shape === 'mushroom_rock') {
      cone(.5, .5, 0, .7, .25, .12);
      ellipsoid(.5 + lean, .5, .77, .46, .35 + rnd() * .07, .21);
    } else if (shape === 'wind_carved_arch' || shape === 'ice_arch') {
      const ice = shape === 'ice_arch', depth = ice ? .09 : .16;
      solid([0, .5 - depth, 0, 1, .5 + depth, 1], (x, y, z) => {
        const ring = Math.hypot((x - .5 - lean * z) / .38, z / .82);
        return Math.abs(ring - 1) < (ice ? .13 : .22) + Math.sin(z * 19 + phase) * .025;
      });
      if (ice) for (const x of [.15, .78]) cone(x, .5, 0, .46 + rnd() * .2, .12, .015, 0, true);
    } else if (shape === 'layered_outcrop') {
      for (let i = 0; i < 5; i++) {
        const offset = Math.sin(i * 2 + phase) * .09;
        box(.08 + i * .035 + offset, .1 + i * .045, i * .18,
          .9 - i * .06 + offset, .86 - i * .045, i * .18 + .13 + rnd() * .045);
      }
    } else if (shape === 'stone_cairn') {
      for (let i = 0; i < 5; i++) {
        const r = .34 - i * .055;
        ellipsoid(.5 + Math.sin(i + phase) * .035, .5, .095 + i * .18, r, r * .83, .105);
      }
    } else if (shape === 'talus_fan') {
      for (let i = 0; i < 15; i++) {
        const x = .14 + rnd() * .7, y = .12 + rnd() * .72;
        cone(x, y, 0, .16 + y * .7, .065 + rnd() * .04, .035, 0, true);
      }
    } else if (shape === 'hollow_log') {
      solid([.04, .16, 0, .96, .84, .8], (x, y, z) => {
        const axis = .47 + Math.sin(x * 4 + phase) * .04;
        const distance = Math.hypot((y - axis) / .27, (z - .34) / .34);
        return distance <= 1 && distance >= .52 && !(x > .8 && y < .4 && z > .5);
      });
      curve([.65, .52, .4], [.7, .7, .6], [.78, .79, .86], .055, .013);
    } else if (shape === 'uprooted_rootball') {
      ellipsoid(.38 + lean, .5, .3, .27, .3, .32);
      curve([.3, .5, .24], [.6, .47, .4], [.95, .45, .2], .1, .065);
      for (let i = 0; i < 8; i++) {
        const a = i * GOLDEN_ANGLE + phase;
        curve([.35, .5, .25], [.4 + Math.cos(a) * .3, .5 + Math.sin(a) * .27, .5],
          [.45 + Math.cos(a) * .36, .5 + Math.sin(a) * .42, .7 + rnd() * .22], .04, .007);
      }
    } else if (shape === 'buttress_roots') {
      cone(.5, .5, .15, .88, .13, .08);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + phase;
        curve([.5, .5, .65], [.5 + Math.cos(a) * .24, .5 + Math.sin(a) * .24, .06],
          [.5 + Math.cos(a) * .44, .5 + Math.sin(a) * .44, .015], .07, .016);
      }
    } else if (shape === 'shelf_fungi') {
      curve([.43, .53, .02], [.5 + lean, .55, .46], [.48, .56, .98], .09, .06);
      for (let i = 0; i < 5; i++) {
        const x = i % 2 ? .64 : .28;
        ellipsoid(x, .46 + rnd() * .16, .17 + i * .17, .27, .25, .065);
      }
    } else if (shape === 'toadstool_ring') {
      for (let i = 0; i < 7; i++) {
        const a = i * Math.PI * 2 / 7 + phase, x = .5 + Math.cos(a) * .32, y = .5 + Math.sin(a) * .32;
        const h = .35 + rnd() * .5;
        cone(x, y, 0, h - .06, .035, .027);
        ellipsoid(x, y, h, .13, .13, .095);
      }
    } else if (shape === 'fumarole_vent' || shape === 'mineral_cone') {
      const vent = shape === 'fumarole_vent';
      cone(.5, .5, 0, vent ? .5 : .97, .43, vent ? .28 : .14, vent ? .16 : .075);
      if (vent) for (let i = 0; i < 5; i++) {
        const a = i * GOLDEN_ANGLE + phase;
        ellipsoid(.5 + Math.cos(a) * .28, .5 + Math.sin(a) * .28, .47, .14, .12, .12 + rnd() * .16);
      }
    } else if (shape === 'basalt_columns') {
      for (const [x, y, h] of [[.32, .32, .7], [.59, .35, 1], [.34, .65, .5], [.62, .65, .8]]) {
        cone(x, y, 0, h - rnd() * .12, .16, .15, 0, true);
      }
    } else if (shape === 'lava_spatter') {
      for (let i = 0; i < 7; i++) {
        const a = i * GOLDEN_ANGLE + phase;
        const x = .5 + Math.cos(a) * .24, y = .5 + Math.sin(a) * .24;
        ellipsoid(x, y, .18, .18, .14, .2);
        curve([x, y, .16], [x - .12, y + .04, .65], [x + .05, y - .03, .55 + rnd() * .4], .065, .025);
      }
    } else if (shape === 'sulfur_crust') {
      for (let i = 0; i < 4; i++) cone(.5, .5, i * .19, i * .19 + .14,
        .44 - i * .05, .44 - i * .05, .28 - i * .04);
      for (let i = 0; i < 4; i++) {
        const a = phase + i * Math.PI / 2;
        ellipsoid(.5 + Math.cos(a) * .31, .5 + Math.sin(a) * .31, .68, .09, .085, .2);
      }
    } else if (shape === 'ice_spires') {
      for (const [x, y, h, r] of [[.5, .5, 1, .18], [.2, .34, .65, .12], [.75, .64, .8, .15]]) {
        cone(x, y, 0, h - rnd() * .08, r, .012, 0, true);
      }
    } else if (shape === 'pressure_ridge') {
      for (let i = 0; i < 5; i++) {
        const x = .12 + i * .17, y = .46 + Math.sin(i + phase) * .08;
        solid([x - .11, y - .25, 0, x + .11, y + .25, 1], (a, b, z) =>
          z < .5 + i * .08 && Math.abs(a - x - z * lean) < .1 * (1 - z * .6) &&
          Math.abs(b - y - z * .12) < .24 * (1 - z));
      }
    } else if (shape === 'glacial_erratic') {
      solid([.08, .12, 0, .92, .88, .9], (x, y, z) =>
        Math.abs((x - .5 - lean * z) / .42) ** 3 + Math.abs((y - .5) / .36) ** 3 +
        Math.abs((z - .38) / .46) ** 3 < 1 && x + z * .22 < .92);
    } else if (shape === 'driftwood_tangle') {
      for (let i = 0; i < 6; i++) {
        const a = i * GOLDEN_ANGLE + phase, dx = Math.cos(a) * .4, dy = Math.sin(a) * .4;
        curve([.5 - dx, .5 - dy, .04], [.5 + lean, .5, .25 + rnd() * .25],
          [.5 + dx, .5 + dy, .12 + rnd() * .4], .04, .018);
      }
    } else if (shape === 'reed_tussock') {
      ellipsoid(.5, .5, .06, .25, .24, .12);
      for (let i = 0; i < 11; i++) {
        const a = i * GOLDEN_ANGLE + phase, r = .08 + rnd() * .15, h = .5 + rnd() * .46;
        const x = .5 + Math.cos(a) * r, y = .5 + Math.sin(a) * r;
        curve([x, y, .02], [x, y, h * .6], [x + lean, y + .08, h], .013, .007);
        ellipsoid(x + lean, y + .08, h - .1, .025, .025, .1);
      }
    }
  }

  function color(shape, x, y, z, normal, base, material, options = {}) {
    const textures = options.textures !== false;
    const h = textures ? Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719)) : 0.5;
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    if (usesRoomPalette(shape)) {
      if (!textures) return base.slice();
      const palette = options.palette || {};
      const body = palette.primary || base, trim = palette.secondary || base.map(v => v * .55);
      const edge = palette.highlight || base.map(v => v + (1 - v) * .45);
      const dark = palette.shadow || base.map(v => v * .3);
      const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
      const column = /column|pier|post/.test(shape);
      const molding = /entablature|pediment|coffer|obelisk|altar|sarcophagus|tomb/.test(shape);
      const band = column ? z < .16 || z > .84 : molding && (z < .18 || z > .78);
      let tone = band ? mix(trim, edge, .15) : body;
      if (/gold/.test(material || '') && /coffer/.test(shape) && z < .75) tone = edge;
      const u = normal[0] ? y : x, v = normal[2] ? y : z;
      if (/wood/.test(material || '') || /timber|boarded|palisade|hammerbeam/.test(shape)) {
        if (Math.floor((u + Math.sin(v * 12) * .04) * 32) % 6 === 0) tone = mix(tone, trim, .6);
      } else if (/marble/.test(material || '') || /fluted|ionic|corinthian|sarcophagus/.test(shape)) {
        if (Math.abs(Math.sin((u + v * .45) * 22)) > .96) tone = mix(tone, trim, .4);
      } else if (/metal|gold|rust/.test(material || '') || /portcullis/.test(shape)) {
        if (h > .94) tone = mix(tone, edge, .3);
      } else if (!column) {
        const masonry = nodeMasonry || root.MasonryPatterns;
        const bond = masonry?.names.includes(material) ? material : 'ashlar';
        const sample = masonry?.sample(bond, u * 32, v * 32) ?? 2;
        if (sample === 0) tone = mix(tone, dark, .45);
        else if (sample === 3) tone = mix(tone, edge, .25);
        else if (sample === 1) tone = mix(tone, trim, .2);
      }
      return tone.map(value => Math.max(0, Math.min(1, value)));
    }
    let hex = null;
    if (biomeProps[shape]) {
      const meta = biomeProps[shape];
      const band = /hoodoo|outcrop|mineral|crust/.test(shape) ? Math.floor(z * 13) % 4 === 0 : normal[2] > .5;
      return rgb(meta.palette[band ? 1 : 0]).map(v => v * (textures ? .86 + h * .14 : 1));
    }
    if (deadTrees.includes(shape)) {
      const grain = textures && Math.floor((x + y + Math.sin(z * 12) * 0.04) * 40) % 4 === 0;
      const palettes = { pale_hollow_tree: ['#dddcc8', '#8b938b'], split_snag: ['#927259', '#504638'],
        wind_bent_tree: ['#b5b099', '#777e76'], dead_willow: ['#a8b0aa', '#636f6b'],
        skeletal_pine: ['#61554b', '#303535'], twisted_yew: ['#987d72', '#53484c'], rootbound_tree: ['#afa887', '#626c51'] };
      hex = palettes[shape][grain ? 1 : 0];
      if (z < 0.12 && h > 0.78) hex = '#7a845c';
    } else if (scrubShapes.includes(shape)) hex = shape === 'ash_reeds' ? '#b9a97c' : h > 0.8 ? '#c7b38f' : shape === 'thorn_bush' ? '#79655b' : '#59654c';
    else if (shape === 'exit_marker') hex = '#84d5ad';
    if (treeShapes.includes(shape) || shape === 'stump' || shape === 'roots') {
      const foliage = !['dead_tree', 'bone_tree', 'charred_tree', 'stump', 'roots'].includes(shape) &&
        (z > 0.65 || shape === 'willow' && Math.hypot(x - 0.5, y - 0.5) > 0.27);
      if (foliage) hex = shape === 'mushroom_tree' ? (h > 0.8 ? '#e8d8a0' : '#277f89') :
        shape === 'willow' ? '#73976c' : shape === 'pine' ? '#245446' : shape === 'cypress' ? '#446347' : '#658344';
      else hex = shape === 'bone_tree' ? (h > 0.7 ? '#f3e2be' : '#b9b09c') :
        shape === 'charred_tree' ? (h > 0.94 ? '#bf6137' : '#393735') :
        normal[2] > 0.5 ? '#b39564' : textures && Math.floor((x + y) * 40) % 3 === 0 ? '#443629' : '#806243';
    } else if (shape === 'furnace') {
      hex = z < 0.14 && x > 0.24 && x < 0.76 && y < 0.74 ? (h > 0.5 ? '#ffc955' : '#db5e24') :
        Math.floor(z * 16) % 4 === 0 ? '#454249' : y < 0.16 ? '#a46b4b' : '#70696b';
    } else if (shape === 'brazier') hex = z < 0.56 ? '#5a6264' : z < 0.7 && x > 0.2 && x < 0.8 && y > 0.2 && y < 0.8 ? '#f29c36' : '#96734a';
    else if (shape === 'pool') hex = z < 0.2 && x > 0.2 && x < 0.8 && y > 0.2 && y < 0.8 ? '#397e86' : '#89938a';
    else if (shape === 'tomb') hex = material === 'gold' ? '#efc556' : z > 0.3 && z < 0.8 && h > 0.85 ? '#c2b390' : z < 0.25 ? '#596854' : '#99988c';
    else if (shape === 'altar') hex = z > 0.82 ? '#b1a185' : '#6b6e69';
    else if (['rubble', 'fallen_arch', 'scree'].includes(shape)) hex = h > 0.7 ? '#aaa694' : '#777469';
    else if (shape === 'broken_masonry') hex = z > 0.4 ? '#b88a64' : h > 0.5 ? '#90715a' : '#777469';
    else if (shape === 'arch') hex = Math.floor(z * 20) % 4 === 0 ? '#575b53' : '#a3997f';
    else if (shape === 'crystal') hex = h > 0.7 ? '#aae3dc' : '#3a929f';
    if (!hex) return base;
    return rgb(hex).map(v => Math.max(0, Math.min(1, v * (0.83 + h * 0.17))));
  }
  const api = { build, select, color, usesRoomPalette, random, vegetation, deadTrees, scrubShapes, architecture,
    biomeProps, biomeShapes, shapes: [...shapes] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScenePropVoxels = api;
})(typeof window === 'undefined' ? globalThis : window);
