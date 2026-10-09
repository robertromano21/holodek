'use strict';
const { applySceneGraphics, placeSceneLandmarks } = require('./sceneRoomBuilder');
const { applySceneArchitecture } = require('./sceneArchitecture');
const { applySceneRoofs } = require('./sceneRoofs');
const { prepareSceneGeography, applySceneGeography } = require('./sceneGeography');
const { prepareSceneVegetation, applySceneVegetation } = require('./sceneVegetation');
const { prepareSceneExteriors, applySceneExteriors } = require('./sceneExterior');
const DungeonExits = require('../assets/dungeonExits');
const { buildSceneSpec } = require('./sceneSpec');
const Living = require('../assets/livingEnvironments');
const { buildEnvironment } = require('../assets/dungeonEnvironment');
const OutdoorTerrain = require('./outdoorTerrain');
const IndoorBlueprint = require('./indoorBlueprint');
const { random } = require('./dungeonGeneration');
const Voxels = require('../assets/scenePropVoxels');
const { createCanvas } = require('canvas');
const { drawSceneSurface } = require('../assets/renderSceneTextures');
const { landmarkSpriteSpec, resolveLandmarkDrawer } = require('../assets/renderSceneProps');

const descriptions = {
  exteriors: 'The crossroads has no roof. Beneath a yellow sky, flat ash flagstones lead north to Ruined Temple Entrance and east to Basalt Gatehouse. Each known destination has stone shell walls, paired towers, one physical entrance and a clear walking perimeter. The green floor markers identify the only entrances; the rear and side walls remain closed.',
  deadwood: 'An open grove of Tartarus contains pale hollow trees, lightning-split snags, wind-bent dead trees, dead willows, skeletal pines, twisted yews and rootbound trees. Thorn bushes, bramble patches and ash reeds surround clear walking trails.',
  geography: 'An open mountain pass of Tartarus rises into craggy peaks above a deep canyon and a rocky escarpment. Boulders and rock faces stand beside a traversable mountain approach. A canyon descent leads toward a crypt entrance below.',
  citadel: 'Inside a towering citadel, a great tower rises above a masonry court. Broad stair wings ascend through two flights to an upper landing and descend through two flights to a crypt landing. High groin vaults, a classical pedimented shrine and a rotunda crown the complex. North and east gateways open onto exterior forecourts.',
  byzantine: 'Inside a Byzantine basilica, a pendentive dome rises over four masonry piers. Groin-vaulted side halls and a gilded sanctuary surround an open courtyard.',
  squinch: 'Inside a stone sanctuary, squinch arches transition a square chamber into an octagonal drum and a high dome.',
  fan: 'Inside a Gothic cathedral, fan vaults spread from clustered piers. Flying buttresses brace the walls beside a small open courtyard.',
  hammerbeam: 'Inside a medieval basilica, an exposed hammerbeam timber roof spans the hall above carved wooden supports.',
  boarded: 'Inside an early basilica, painted timber boards form a flat wooden ceiling above the central hall.',
  gold: 'Inside an imperial basilica, a gold-coffered ceiling crowns marble columns and an ornate altar.',
  groin: 'Inside a Romanesque chapel, intersecting groin vaults span square stone bays.',
  motte: 'A motte-and-bailey castle has a raised earth mound, a wooden keep and timber palisades around an open bailey. A timber roof covers the keep.',
  shellkeep: 'A shell keep castle encloses a circular stone courtyard, with covered living quarters within the outer curtain.',
  stonekeep: 'Inside a stone keep castle, a massive square great tower encloses groin-vaulted chambers beside an open bailey.',
  concentric: 'A concentric castle has nested curtain walls enclosing a keep, a covered gate hall and an open bailey between its defenses.',
  amphitheater: 'An open Roman amphitheater has an oval arena, stepped seating terraces and barrel-vaulted arcades beneath its perimeter.',
  theater: 'An open Roman theater has semicircular stepped seating facing a stage, with a barrel-vaulted rear arcade.',
  circus: 'An open Roman circus has a long chariot track and a central spina, with a covered entrance arcade.',
  forum: 'An open Roman forum has a civic square bordered by a covered colonnade and a small altar.',
  warehouse: 'Inside a Roman horreum, storage chambers flank a central service passage beneath a timber roof.',
  domus: 'Inside a Roman domus, roofed residential rooms surround an open atrium and a peristyle courtyard.',
  villa: 'Inside a Roman villa, covered residential wings surround a garden courtyard with marble columns and a pool.',
  insula: 'Inside a Roman insula, ground-floor apartments and stores surround shared corridors beneath boarded timber ceilings.',
  aqueduct: 'An open ruined Roman aqueduct has a repeated stone arcade supported by paired piers above a clear walking passage.',
  temple: 'Inside a Roman temple, a coffered stone ceiling spans a sanctuary with a pedimented Corinthian shrine and an open courtyard. Marble columns flank the central aisle; an altar and an inscribed obsidian obelisk stand beside the shrine.',
  gothic: 'Inside a Gothic cathedral, pointed ribbed vaults rise over clustered piers and a central nave. A stone altar, a pointed arch and a weathered obelisk mark the sanctuary.',
  rotunda: 'Inside a Roman rotunda, a stone dome with an open oculus crowns a circular sanctuary. Ionic columns support the drum around a central altar, with an inscribed obelisk beside the entrance.',
  obelisks: 'An open ceremonial court of Tartarus contains weathered sandstone obelisks and inscribed obsidian obelisks, standing stones, rubble and an altar beneath the sky.',
  castle: 'Inside a medieval castle gatehouse, dressed-stone ashlar walls surround a timber-roofed gate hall and an open courtyard. A lowered portcullis, a timber gate, buttresses, battlements, arrow slits and broken masonry line the defenses.',
  bathhouse: 'Inside a Roman bathhouse, thin-brick walls surround a barrel-vaulted bathing hall and an open courtyard. Fluted columns, a pool, marble sarcophagi and fallen arch fragments stand beside the hall.',
  rubble: 'An open ruined quarry of broken masonry, fallen arch fragments, scree, rubble heaps and stalagmites, surrounded by rough-stone masonry walls.',
  forge: 'An abandoned foundry of brick walls and ash flagstones. A furnace, iron braziers, broken arches and heaps of slag flank a stone working court.',
  graves: 'A ruined burial temple with marble arches, engraved gravestones, a stone altar, fallen masonry and a dead tree beside the sanctuary.',
  grove: 'An open dead grove with calcified roots, a bone tree, a charred tree, cypresses and willows. Pools collect among the gravestones.',
  gallery: 'An open garden of Tartarus: oaks, pines, willows, cypresses, dead trees, bone trees, charred trees and giant mushroom trees surround furnaces, altars, gravestones, braziers, pools, crystal clusters, rubble and roots.'
};
const props = {
  exteriors: [],
  deadwood: ['pale_hollow_tree', 'split_snag', 'wind_bent_tree', 'dead_willow', 'skeletal_pine', 'twisted_yew', 'rootbound_tree', 'thorn_bush', 'bramble_patch', 'ash_reeds'],
  geography: ['boulder', 'rock_face', 'rubble'],
  citadel: ['corinthian_column', 'altar', 'pointed_arch', 'battlement', 'obelisk'],
  byzantine: ['altar', 'ionic_column'], squinch: ['altar', 'doric_column'], fan: ['altar', 'gothic_pier'],
  hammerbeam: ['altar', 'timber_post'], boarded: ['altar', 'timber_post'], gold: ['altar', 'corinthian_column'], groin: ['altar', 'doric_column'],
  motte: ['timber_gate', 'brazier'], shellkeep: ['battlement', 'brazier'], stonekeep: ['portcullis', 'brazier'], concentric: ['portcullis', 'battlement'],
  amphitheater: ['altar', 'archway'], theater: ['archway', 'altar'], circus: ['obelisk', 'archway'], forum: ['altar', 'corinthian_column'],
  warehouse: ['brazier', 'timber_post'], domus: ['pool', 'ionic_column'], villa: ['pool', 'corinthian_column'], insula: ['brazier', 'timber_gate'], aqueduct: ['archway'],
  temple: ['corinthian_column', 'altar', 'obelisk'],
  gothic: ['pointed_arch', 'altar', 'obelisk'],
  rotunda: ['ionic_column', 'altar', 'obelisk'],
  obelisks: ['obelisk', 'obelisk', 'obelisk', 'obelisk', 'rubble', 'altar'],
  castle: ['portcullis', 'timber_gate', 'buttress', 'battlement', 'arrow_slit', 'pointed_arch', 'broken_masonry'],
  bathhouse: ['fluted_column', 'pool', 'sarcophagus', 'fallen_arch', 'archway'],
  rubble: ['broken_masonry', 'fallen_arch', 'scree', 'rubble', 'stalagmite', 'stump'],
  forge: ['furnace', 'brazier', 'archway', 'rubble', 'furnace', 'brazier'],
  graves: ['tomb', 'altar', 'archway', 'dead_tree', 'tomb', 'crystal_cluster'],
  grove: ['dead_tree', 'bone_tree', 'charred_tree', 'cypress', 'willow', 'roots', 'pool', 'tomb'],
  gallery: ['oak', 'pine', 'willow', 'cypress', 'dead_tree', 'bone_tree', 'charred_tree', 'mushroom_tree', 'furnace', 'tomb', 'brazier', 'pool', 'altar', 'archway', 'crystal_cluster', 'rubble', 'roots', 'stump']
};

// Explicit compositions supplement, rather than replace, the original prop/style gallery.
const biomeExhibits = {
  badlands: {
    name: 'Mesa Canyon Badlands', biome: 'desert', floor: 'sand', wall: 'sandstone',
    description: 'An open badlands canyon cuts between flat-topped sandstone mesas, a butte and narrow hoodoos. Three graded trails descend into the winding channel or climb the western mesa and eastern overlook. No roof covers the sand and scree.',
    palette: ['#b97c4d', '#734c32', '#e1bd81', '#392d25'], sky: ['#88694d', '#dfbe86'],
    landforms: [['canyon', .49, .32, .10, .28, 15, 0], ['mesa', .20, .26, .16, .17, 20, 0],
      ['butte', .77, .28, .12, .16, 24, -15], ['hoodoo', .78, .58, .085, .09, 17, 0],
      ['terraces', .19, .57, .14, .15, 9, 0]],
    routes: [
      { label: 'Canyon descent', points: [[.5, .8], [.5, .64], [.49, .32]] },
      { label: 'Mesa summit', points: [[.5, .64], [.20, .64], [.20, .26]] },
      { label: 'Butte overlook', points: [[.5, .64], [.77, .64], [.77, .28]] }
    ],
    props: ['boulder', 'rock_face', 'scree', 'rubble'], naturalProps: ['eroded_hoodoo', 'wind_carved_arch', 'mushroom_rock'],
    clusters: [[.22, .34], [.72, .43], [.70, .57]], budget: 28
  },
  caldera: {
    name: 'Cinder Caldera', biome: 'volcanic', floor: 'ash', wall: 'obsidian',
    description: 'An open volcanic caldera encloses a sunken crater inside a tall circular cinder rim. A southern approach forks into a rim circuit and a descent to glowing lava crust. Basalt formations, charred trees and braziers occupy the slopes. No roof spans the crater.',
    palette: ['#665447', '#342f2b', '#d39754', '#181716'], sky: ['#493d38', '#bb7650'],
    landforms: [['caldera', .50, .32, .27, .28, 42, 0], ['basin', .50, .32, .09, .09, 10, 0],
      ['ridge', .82, .33, .10, .20, 16, -12], ['cliff', .15, .27, .10, .21, 14, 0]],
    routes: [
      { label: 'Crater descent', points: [[.5, .8], [.5, .64], [.73, .64], [.73, .32], [.50, .32]] },
      { label: 'Rim circuit', points: [[.73, .32], [.73, .12], [.27, .12], [.27, .64], [.50, .64]] }
    ],
    props: ['boulder', 'rock_face', 'charred_tree', 'brazier'], naturalProps: ['basalt_columns', 'fumarole_vent', 'lava_spatter'],
    clusters: [[.68, .39], [.34, .47], [.47, .22]], budget: 30,
    crust: { x: .54, y: .34, material: 'lava', palette: { primary: '#f78630', secondary: '#96391d', highlight: '#ffd476', shadow: '#351910' } }
  },
  uplands: {
    name: 'Icy Uplands', biome: 'mountain', floor: 'ice', wall: 'ice',
    description: 'Open icy uplands have two glacier peaks, a long cross-ridge and a terraced snow shelf above a frozen tarn. Switchback trails reach the shelf and the northern saddle. Ice boulders and crystal clusters mark the snow, not forest trees. No roof obstructs the pale sky.',
    palette: ['#b0cbd2', '#628393', '#edf6ed', '#304f63'], sky: ['#567e99', '#d5e5e7'],
    landforms: [['mountain', .24, .24, .19, .21, 25, 0], ['mountain', .74, .20, .16, .20, 30, 0],
      ['ridge', .52, .35, .13, .32, 16, 90], ['terraces', .23, .55, .19, .18, 12, 0],
      ['basin', .74, .56, .16, .16, 7, 0]],
    routes: [
      { label: 'Snow shelf', points: [[.5, .8], [.5, .69], [.22, .69], [.22, .53]] },
      { label: 'Northern saddle', points: [[.5, .69], [.76, .69], [.76, .42], [.48, .42], [.48, .22]] }
    ],
    props: ['boulder', 'rock_face', 'crystal_cluster', 'scree'], naturalProps: ['ice_spires', 'ice_arch', 'pressure_ridge'],
    clusters: [[.28, .43], [.62, .25], [.78, .53]], budget: 26,
    crust: { x: .72, y: .55, material: 'ice', palette: { primary: '#a5dae6', secondary: '#579aaa', highlight: '#effcff', shadow: '#36596b' } }
  },
  leafless: {
    name: 'Leafless Forest', biome: 'forest', floor: 'earth', wall: 'earth',
    description: 'An open leafless forest has dense stands of hollow trees, split snags, dead willows, skeletal pines and twisted yews on low wooded hills. A branching trail joins two clearings and a sunken root hollow. Thorn scrub stays outside the walking corridor. No roof covers the bare canopy.',
    palette: ['#827961', '#4d4e3f', '#b6b096', '#282f2a'], sky: ['#4b5952', '#a2a693'],
    landforms: [['hill', .25, .27, .25, .26, 5, 0], ['ridge', .74, .35, .15, .23, 6, 20],
      ['basin', .30, .61, .14, .16, 4, 0], ['terraces', .65, .66, .18, .15, 4, 0]],
    routes: [
      { label: 'Hollow clearing', points: [[.5, .8], [.5, .55], [.30, .55], [.30, .64]] },
      { label: 'Snag clearing', points: [[.5, .55], [.5, .30], [.24, .30]] },
      { label: 'Yew stand', points: [[.5, .55], [.76, .55], [.76, .32]] }
    ],
    props: ['pale_hollow_tree', 'split_snag', 'wind_bent_tree', 'dead_willow', 'skeletal_pine', 'twisted_yew', 'rootbound_tree', 'thorn_bush', 'bramble_patch', 'roots'],
    clusters: [[.22, .28], [.76, .31], [.27, .67], [.67, .65]], budget: 76
  },
  'modular-sanctuary': {
    name: 'Courtyard Sanctuary Composition', indoor: true, biome: 'temple', floor: 'marble', wall: 'marble',
    description: 'Inside a modular Roman temple complex, a loop of passages links a colonnaded gallery, a groin-vaulted hall, an Ionic domed rotunda and a pedimented portico beside the eastern sanctuary. An open courtyard interrupts the covered interiors; each wing has its own ceiling and grounded supports.',
    palette: ['#c5ba9c', '#7e8575', '#eee5cb', '#394b47'], sky: ['#637d7b', '#c5cbb4'],
    props: ['altar', 'obelisk', 'brazier'], budget: 9
  },
  'modular-foundry': {
    name: 'Stepped Foundry Composition', indoor: true, biome: 'castle', floor: 'stone', wall: 'brick',
    description: 'Inside a modular medieval foundry warehouse, an offset service spine joins hammerbeam workshops, boarded stores and a groin-vaulted loading bay. A narrow staircase rises into the eastern gallery. A small open courtyard vents the northern wing. Furnaces and braziers stand away from the usable passages beneath supported ceilings.',
    palette: ['#92765b', '#5d5148', '#ccae77', '#302c27'], sky: ['#566b6f', '#a4a79b'],
    props: ['furnace', 'brazier', 'rubble'], budget: 12
  }
};
Object.assign(descriptions, Object.fromEntries(Object.entries(biomeExhibits).map(([kind, exhibit]) => [kind, exhibit.description])));

function labSurface(material, palette, seed, kind) {
  const canvas = createCanvas(128, 128);
  drawSceneSurface(canvas.getContext('2d'), createCanvas, kind, { material, palette, seed, paletteStrength: .55 });
  return { url: canvas.toDataURL('image/png') };
}

function labProp(dungeon, type, material) {
  const shape = Voxels.select(type), piece = Voxels.biomeProps?.[shape] || Voxels.architecture[shape] || Voxels.vegetation[shape];
  if (!shape) throw new Error(`Missing lab voxel shape: ${type}`);
  const existing = dungeon.customTiles.find(p => p.type === type && p.spriteSpec.material === material);
  if (existing) return existing.name;
  const name = `custom_${type}_${dungeon.customTiles.length}`;
  const drawer = piece?.drawer || resolveLandmarkDrawer(type);
  const spriteSpec = { ...landmarkSpriteSpec(drawer), voxelShape: shape, material,
    voxelSeed: Math.floor(random(`${dungeon.generation.seed}:${type}`)() * 0xffffffff),
    ...(piece ? { heightRatio: piece.heightRatio, baseWidth: piece.baseWidth, gridWidth: piece.baseWidth } : {}) };
  dungeon.tiles[name] = { spriteSpec, landmark: { type, drawer, material } };
  dungeon.customTiles.push({ name, type, spriteSpec, procedure: { material } });
  return name;
}

function gradeLabRoutes(dungeon, requests) {
  const size = dungeon.layout.width;
  const point = ([x, y]) => ({ x: Math.round(x * (size - 1)), y: Math.round(y * (size - 1)) });
  const routes = [];
  for (const request of requests) {
    const waypoints = request.points.map(point), points = [waypoints[0]];
    for (let i = 1; i < waypoints.length; i++) {
      const to = waypoints[i];
      let { x, y } = points[points.length - 1];
      while (x !== to.x || y !== to.y) {
        if (x !== to.x) x += Math.sign(to.x - x); else y += Math.sign(to.y - y);
        points.push({ x, y });
      }
    }
    // Grade between real terrain samples at the bends, keeping a three-cell walking lane.
    let cursor = 0;
    for (let segment = 1; segment < waypoints.length; segment++) {
      const a = waypoints[segment - 1], b = waypoints[segment];
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const low = dungeon.cells[`${a.x},${a.y}`].floorHeight;
      const sample = dungeon.cells[`${b.x},${b.y}`].floorHeight;
      const high = Math.max(low - length * .6, Math.min(low + length * .6, sample));
      for (let i = 0; i <= length; i++) {
        const p = points[cursor + i], z = Number((low + (high - low) * i / Math.max(1, length)).toFixed(3)) || 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const c = dungeon.cells[`${p.x + dx},${p.y + dy}`];
          if (!c || c.tile !== 'floor' || c.navigationReserved) continue;
          Object.assign(c, { floorHeight: z, ceilHeight: z + 8, terrainRole: 'trail', navigationReserved: true });
        }
      }
      cursor += length;
    }
    const end = points[points.length - 1];
    routes.push({ label: request.label, points, viewpoint: { ...end, angle: -Math.PI / 2 } });
  }
  return routes;
}

function modularLabPlan(kind, rng) {
  const sanctuary = kind === 'modular-sanctuary';
  const rooms = (sanctuary ? [
    [.41, .77, .18, .17, 'entrance', 'coffered', 0], [.06, .45, .26, .26, 'gallery', 'coffered', 0],
    [.06, .07, .30, .28, 'hall', 'groin', .5], [.57, .08, .28, .28, 'hall', 'domed', .5],
    [.65, .43, .25, .24, 'chapel', 'coffered', 1], [.38, .39, .20, .20, 'courtyard', null, 0]
  ] : [
    [.08, .76, .20, .17, 'entrance', 'boarded', 0], [.40, .41, .19, .43, 'hall', 'boarded', 0],
    [.05, .38, .25, .22, 'chamber', 'boarded', 0], [.06, .06, .34, .24, 'hall', 'hammerbeam', .5],
    [.69, .50, .24, .25, 'chamber', 'groin', .5], [.61, .06, .31, .34, 'gallery', 'boarded', 0],
    [.43, .10, .13, .19, 'courtyard', null, 0]
  ]).map(([x, y, w, h, role, roofStyle, floor]) => ({ x, y, w, h, role, floor, roofStyle,
    clearance: 5 + Math.floor(rng() * 3) * .5, columnOrder: sanctuary ? 'ionic' : 'doric' }));
  const links = sanctuary ? [[0, 1, 'H'], [1, 2, 'V'], [2, 3, 'H'], [3, 4, 'V'], [4, 0, 'V'], [0, 5, 'V']] :
    [[0, 2, 'V'], [2, 3, 'V'], [2, 1, 'H'], [1, 4, 'H'], [1, 5, 'V'], [5, 6, 'H'], [6, 3, 'H']];
  const modules = sanctuary ? [
    { type: 'colonnade', room: 1, width: 7, height: 10, roofStyle: 'coffered' },
    { type: 'vaulted_bay', room: 2, width: 9, height: 10, roofStyle: 'groin' },
    { type: 'rotunda_section', room: 3, width: 9, height: 9, roofStyle: 'domed', columnOrder: 'ionic' },
    { type: 'portico', room: 4, width: 5, height: 6, columnOrder: 'corinthian' },
    { type: 'courtyard', room: 5, width: 8, height: 8 }
  ] : [
    { type: 'vaulted_bay', room: 2, width: 7, height: 8, roofStyle: 'boarded' },
    { type: 'colonnade', room: 3, width: 9, height: 8, roofStyle: 'hammerbeam' },
    { type: 'vaulted_bay', room: 4, width: 7, height: 8, roofStyle: 'groin' },
    { type: 'staircase', room: 5, width: 3, height: 16, direction: 'north', x: 1, y: 0, rise: 4.2 },
    { type: 'courtyard', room: 6, width: 5, height: 7 }
  ];
  for (const module of modules) { module.x ??= rng() < .5 ? 0 : 1; module.y ??= rng() < .5 ? 0 : 1; }
  return { rooms, modules, corridors: links.map(([fromRoom, toRoom, style]) => ({ fromRoom, toRoom, style, width: 3 })) };
}

function dressLab(dungeon, exhibit, rng) {
  const { width, height } = dungeon.layout, placed = [];
  const margin = exhibit.indoor ? 1 : 2;
  const catalog = [...exhibit.props, ...(exhibit.naturalProps || []).filter(type => Voxels.biomeProps?.[type])];
  for (let attempt = 0; attempt < exhibit.budget * 100 && placed.length < exhibit.budget; attempt++) {
    const type = catalog[placed.length % catalog.length];
    let x, y;
    if (exhibit.indoor) {
      const room = dungeon.indoorRooms[1 + Math.floor(rng() * (dungeon.indoorRooms.length - 1))];
      x = room.x + Math.floor(rng() * room.w); y = room.y + Math.floor(rng() * room.h);
    } else {
      const cluster = exhibit.clusters[Math.floor(rng() * exhibit.clusters.length)];
      x = Math.round(cluster[0] * width + (rng() - .5) * 30);
      y = Math.round(cluster[1] * height + (rng() - .5) * 28);
    }
    if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3 ||
        Math.hypot(x - dungeon.start.x, y - dungeon.start.y) < 4 ||
        placed.some(p => Math.hypot(p.x - x, p.y - y) < (exhibit.indoor ? 3 : 3.5))) continue;
    const c = dungeon.cells[`${x},${y}`];
    let safe = true;
    for (let dy = -margin; dy <= margin && safe; dy++) for (let dx = -margin; dx <= margin; dx++) {
      const n = dungeon.cells[`${x + dx},${y + dy}`];
      if (n?.tile !== 'floor' || n.navigationReserved || n.feature || n.roof?.zone === 'shrine' ||
          Math.abs(n.floorHeight - c.floorHeight) > 1.4) { safe = false; break; }
    }
    if (!safe) continue;
    const natural = Voxels.biomeProps?.[type];
    const material = natural?.material || (/tree|snag|willow|pine|yew|bush|bramble|roots/.test(type) ? 'wood' :
      ['furnace', 'brazier'].includes(type) ? 'metal' : exhibit.wall);
    const tile = labProp(dungeon, type, material);
    Object.assign(c, { tile, feature: tile, structureHeight: natural ? natural.heightRange[0] + rng() * (natural.heightRange[1] - natural.heightRange[0]) : /tree|snag|willow|pine|yew/.test(type) ? 5 + rng() * 3 :
      type === 'rock_face' ? 4 : type === 'furnace' ? 2.8 : 1.2 + rng() });
    placed.push({ type, tile, x, y });
  }
  if (exhibit.crust) {
    const x = Math.round(exhibit.crust.x * (width - 1)), y = Math.round(exhibit.crust.y * (height - 1));
    const tile = labProp(dungeon, 'coffered_slab', exhibit.crust.material);
    dungeon.tiles[tile].spriteSpec.palette = exhibit.crust.palette;
    // Thin existing slab voxels make a grounded crust; pool voxels have fixed water colors.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = dungeon.cells[`${x + dx},${y + dy}`];
      if (c.tile !== 'floor' || c.navigationReserved) continue;
      Object.assign(c, { tile, feature: tile, structureHeight: .08 });
      placed.push({ type: 'coffered_slab', role: `${exhibit.crust.material}-crust`, tile, x: x + dx, y: y + dy });
    }
  }
  return placed;
}

function buildBiomeLab(kind, options) {
  const exhibit = biomeExhibits[kind], seed = String(options?.seed ?? `environment-lab:${kind}:v1`);
  if (!seed.length || seed.length > 160) throw new Error('Lab seed must contain 1-160 characters.');
  const rng = random(seed), size = exhibit.indoor ? 72 : 96;
  const spec = buildSceneSpec({ roomName: exhibit.name, description: exhibit.description, puzzle: '', objects: [], exits: [], coords: { x: 0, y: 0, z: 0 } });
  spec.indoor = !!exhibit.indoor; spec.biome = exhibit.biome;
  spec.generation = { seed }; spec.floorMaterial = exhibit.floor; spec.wallMaterial = exhibit.wall;
  spec.floorStyleMaterial = exhibit.floor; spec.wallStyleMaterial = exhibit.wall;
  spec.landmarks = exhibit.props.map(type => ({ type, label: type, count: 1, condition: [], placement: 'scattered' }));
  const palette = Object.fromEntries(['primary', 'secondary', 'highlight', 'shadow'].map((name, i) => [name, exhibit.palette[i]]));
  const dungeon = { geoKey: `lab:${kind}:${seed}`, layout: { width: size, height: size },
    start: { x: Math.round(.5 * (size - 1)), y: Math.round(.8 * (size - 1)) }, cells: {}, tiles: {}, customTiles: [],
    sceneSpec: spec, generation: { seed }, classification: { indoor: spec.indoor, biome: exhibit.biome },
    skyTop: exhibit.sky[0], skyBot: exhibit.sky[1], visualStyle: { palette, lighting: { ambient: .8 } } };
  // Avoid the shared on-disk sprite library and any campaign/cache persistence.
  dungeon.tiles.floor = labSurface(exhibit.floor, palette, seed, 'floor');
  dungeon.tiles.wall = labSurface(exhibit.wall, palette, seed, 'wall');
  let routes = [];
  if (exhibit.indoor) {
    const plan = modularLabPlan(kind, rng);
    dungeon.blueprint = { seed, indoorPlan: plan };
    IndoorBlueprint.build(dungeon, plan, { floor: 0, ceil: 5 });
    const entrance = dungeon.indoorRooms[0];
    dungeon.start = { x: entrance.x + Math.floor(entrance.w / 2), y: entrance.y + Math.floor(entrance.h / 2) };
    applySceneArchitecture(dungeon, spec);
    applySceneRoofs(dungeon, spec);
  } else {
    const backing = OutdoorTerrain.plan(spec, size, size);
    const base = { ...backing, features: backing.features.map(f => ({ ...f, rise: f.rise * .14 })), roll: backing.roll * .3,
      detail: { ...backing.detail, amplitude: .4 } };
    const landforms = exhibit.landforms.map(([kind, x, y, radiusX, radiusY, rise, angle]) => ({ kind,
      x: x + (rng() - .5) * .016, y: y + (rng() - .5) * .016, radiusX, radiusY, rise, angle }));
    dungeon.outdoorTerrain = OutdoorTerrain.design(base, { landforms }, size, size);
    dungeon.outdoorTerrain.spawn = { ...dungeon.start };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const z = OutdoorTerrain.heightAt(dungeon.outdoorTerrain, x, y) || 0;
      dungeon.cells[`${x},${y}`] = { tile: x && y && x < size - 1 && y < size - 1 ? 'floor' : 'wall', floorHeight: z, ceilHeight: z + 8 };
    }
    routes = gradeLabRoutes(dungeon, exhibit.routes);
  }
  const placed = dressLab(dungeon, exhibit, rng);
  const viewpoints = exhibit.indoor ? dungeon.indoorRooms.map((r, i) => ({ label: `${r.role} ${i + 1}`,
    x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2), angle: -Math.PI / 2 })) : routes.map(r => ({ label: r.label, ...r.viewpoint }));
  dungeon.environmentLab = { version: 1, kind, seed, routes, viewpoints, props: placed,
    bounds: { width: size, height: size, minHeight: -48, maxHeight: 80 },
    composition: exhibit.indoor ? 'modular-room-graph' : dungeon.outdoorTerrain.profile };
  dungeon.environment = buildEnvironment(dungeon);
  dungeon._geometryStamp = `lab-${kind}-v1:${seed}`;
  return dungeon;
}

function buildEnvironmentLab(kind, options = {}) {
  if (!Object.hasOwn(descriptions, kind)) throw new Error('Unknown environment exhibit.');
  if (Object.hasOwn(biomeExhibits, kind)) return buildBiomeLab(kind, options);
  const roomNames = { exteriors: 'Ashen Crossroads', citadel: 'Towering Citadel', castle: 'Castle Gatehouse', bathhouse: 'Roman Bathhouse', temple: 'Roman Temple', gothic: 'Gothic Cathedral', rotunda: 'Roman Rotunda',
    byzantine: 'Byzantine Basilica', squinch: 'Squinch Sanctuary', fan: 'Fan Vault Cathedral', hammerbeam: 'Timber Basilica',
    boarded: 'Early Basilica', gold: 'Imperial Basilica', groin: 'Romanesque Chapel', motte: 'Motte and Bailey Castle',
    shellkeep: 'Shell Keep Castle', stonekeep: 'Stone Keep Castle', concentric: 'Concentric Castle', amphitheater: 'Roman Amphitheater',
    theater: 'Roman Theater', circus: 'Roman Circus', forum: 'Roman Forum', warehouse: 'Roman Horreum', domus: 'Roman Domus',
    villa: 'Roman Villa', insula: 'Roman Insula', aqueduct: 'Roman Aqueduct' };
  const spec = buildSceneSpec({ roomName: roomNames[kind] || Living.THEMES[kind]?.name || 'Tartarus Voxel Gallery', description: descriptions[kind], puzzle: '', objects: [],
    exits: kind === 'citadel' ? ['north', 'east', 'up', 'down'] : kind === 'exteriors' ? ['north', 'east'] : [],
    coords: { x: 0, y: kind === 'exteriors' ? -1 : 0, z: 0 } });
  spec.indoor = !['exteriors', 'deadwood', 'geography', 'grove', 'gallery', 'rubble', 'amphitheater', 'theater', 'circus', 'forum', 'aqueduct'].includes(kind);
  spec.livingTheme = kind === 'gallery' ? 'grove' : kind;
  spec.landmarks = [...new Set(props[kind])].map(type => ({ type, label: type, count: 1, condition: [], placement: 'scattered' }));
  if (kind === 'geography') spec.exits = spec.source.exits = ['up', 'down'];
  prepareSceneGeography(spec, kind === 'geography' ? {
    '0,0,1': { name: 'Mountain Summit', indoor: false, classification: { indoor: false, biome: 'mountain' } },
    '0,0,-1': { name: 'Buried Crypt', indoor: true, classification: { indoor: true, biome: 'crypt' } }
  } : {}, { backgroundTerrain: kind === 'geography' });
  if (kind === 'exteriors') prepareSceneExteriors(spec, {
    '0,-1,0': { name: 'Ashen Crossroads', indoor: false, exits: {
      north: { targetCoordinates: '0,0,0' }, east: { targetCoordinates: '1,-1,0' }
    } },
    '0,0,0': { name: 'Ruined Temple Entrance', indoor: true, complexId: 'ruined-temple',
      description: 'Inside the ruined temple, stone walls and a covered sanctuary surround the entrance.' },
    '1,-1,0': { name: 'Basalt Gatehouse', indoor: true, siteId: 'lab-basalt-gatehouse',
      description: 'Inside a stone castle gatehouse, paired towers flank the timber-roofed gate hall.' }
  }, { seed: 'environment-lab-exteriors-v1' });
  if (kind === 'deadwood') { spec.exits = ['north', 'east', 'southwest']; prepareSceneVegetation(spec); }
  const largeOutdoor = ['exteriors', 'deadwood', 'geography'].includes(kind);
  const size = largeOutdoor ? 80 : 28;
  const dungeon = { geoKey: `lab:${kind}`, layout: { width: size, height: size },
    start: largeOutdoor ? { x: 40, y: 40 } : { x: 14, y: 24 },
    cells: {}, tiles: {}, customTiles: [], sceneSpec: spec,
    classification: { indoor: spec.indoor }, visualStyle: { palette: { primary: '#a18c69', secondary: '#665842' }, lighting: { ambient: 0.75 } } };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wall = x === 0 || y === 0 || x === size - 1 || y === size - 1;
    dungeon.cells[`${x},${y}`] = { tile: wall ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 3 };
  }
  const structured = !!roomNames[kind] && kind !== 'exteriors';
  if (structured) applySceneArchitecture(dungeon, spec);
  applySceneGeography(dungeon, spec);
  applySceneGraphics(dungeon, spec, { geoKey: dungeon.geoKey, customTiles: [] });
  if (structured) applySceneRoofs(dungeon, spec);
  if (structured || ['exteriors', 'deadwood', 'geography'].includes(kind)) placeSceneLandmarks(dungeon, spec);
  else props[kind].forEach((type, i) => {
    const index = dungeon.customTiles.findIndex(t => t.type === type);
    if (index < 0) throw new Error(`Missing lab prop ${type}`);
    const key = `${5 + (i % 4) * 6},${18 - Math.floor(i / 4) * 3}`;
    const tile = `custom_${dungeon.customTiles[index].type}_${index}`;
    dungeon.cells[key] = { ...dungeon.cells[key], tile, feature: tile };
  });
  applySceneRoofs(dungeon, spec);
  if (kind === 'exteriors') {
    // Match production order: roofs/landmarks first, then physical exits and their facades.
    dungeon._geometryStamp = `lab-${kind}-v6`;
    DungeonExits.install(dungeon, spec.exits);
    applySceneExteriors(dungeon, spec);
  }
  if (kind === 'deadwood') { DungeonExits.install(dungeon); applySceneVegetation(dungeon, spec); }
  if (Living.THEMES[spec.livingTheme]) dungeon.livingEnvironmentReport = Living.install(dungeon, spec);
  dungeon.environment = buildEnvironment(dungeon);
  dungeon._geometryStamp = `lab-${kind}-v6`;
  return dungeon;
}
module.exports = { buildEnvironmentLab, descriptions, biomeExhibits };
