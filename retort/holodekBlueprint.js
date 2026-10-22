'use strict';
const C = require('./generationContracts');
const num = (minimum, maximum) => ({ type: Number, minimum, maximum });
const xy = { x: num(0, 1), y: num(0, 1) }, rectangle = { ...xy, w: num(.03, .8), h: num(.03, .8) };
const roof = ['stone', 'barrel', 'groin', 'ribbed', 'fan', 'coffered', 'timber', 'hammerbeam', 'boarded', 'gold-coffered', 'pendentive', 'squinch', 'domed'];
const modules = ['portico', 'colonnade', 'vaulted_bay', 'rotunda_section', 'sanctuary', 'courtyard', 'terrace', 'raised_gallery', 'staircase',
  'cloister', 'apsidal_chapel', 'switchback_stair', 'split_raised_gallery', 'temple', 'basilica', 'rotunda', 'bathhouse', 'castle', 'catacomb', 'ruins', 'forum', 'domus', 'villa', 'warehouse', 'insula', 'infrastructure'];
function list(item, min, max = min) { return { type: C.list(item), minItems: min, maxItems: max }; }
async function generate($, { roomDescription, puzzleDesc, classification, size, customTiles, generation, sceneSpec }) {
  const indoor = classification?.indoor === true, ids = (customTiles || []).map(tile => tile?.type || tile?.name).filter(Boolean);
  const data = { description: roomDescription, indoor, size, biome: classification?.biome, architecture: sceneSpec?.architecture,
    features: classification?.features, levelFeatures: sceneSpec?.level?.layoutFeatures, exits: sceneSpec?.exits,
    storey: sceneSpec?.worldContext?.fortifiedFloor, puzzle: sceneSpec?.puzzleMechanism ? 'Dedicated builder owns controls; reserve accessible workshop space, no duplicate devices.' : puzzleDesc };
  const brief = `Design only this room's geometry from saved facts: ${JSON.stringify(data)}. All positions and footprint dimensions are normalized 0..1; widths/heights of modules and corridors are grid tiles. Spawn (0.5,0.75) stays clear. Invent a fresh, connected layout, not the example plan. One walkable surface per XY cell, supported stairs/ramps for elevation changes. Natural caves/mines/ice/lava tubes have solid ceilings, dry connected routes and no compulsory classical shrine. Built interiors need coherent supported architecture matching this room. A declared upper storey means no sky court. Outdoor terrain remains outdoor with distinct near/mid/far scenery and bounded buildings, never a dungeon maze. No actors, items, new exits or quest state.`;
  async function request(component, parameters, arrays, context = {}) {
    const result = await C.request($, { component: 'blueprint-' + component, parameters,
      localWork: { brief: brief + '\nAccepted geometry to preserve: ' + JSON.stringify(context), arrays },
      validate: value => value });
    if (!result.value) throw result.error || Error('No valid blueprint ' + component);
    return result.value;
  }
  const header = await request('concept', { base: { floor: num(-4, 4), ceil: num(3, 9) },
    ...(indoor ? { roomCount: { type: Number, enum: [6, 7, 8, 9, 10, 11, 12] } } : {
      landformCount: { type: Number, enum: [2, 3, 4, 5, 6] }, buildingCount: { type: Number, enum: [0, 1, 2, 3] } }) }, {});
  let result;
  if (indoor) {
    const spaces = await request('spaces', { rooms: list({ ...rectangle,
      role: C.choice(['entrance', 'hall', 'chapel', 'sanctum', 'shrine', 'rotunda', 'courtyard', 'chamber', 'gallery', 'crypt', 'keep']),
      shape: C.choice(['hall', 'round', 'irregular']), clearance: num(3, 9), floor: num(-3, 3),
      roofStyle: C.choice(roof), columnOrder: C.choice(['doric', 'ionic', 'corinthian']) }, header.roomCount) },
      { rooms: { count: header.roomCount, max: 12, batch: 2 } }, header);
    if (!spaces.rooms.some(room => room.role === 'entrance')) throw Error('Blueprint needs an authored entrance room.');
    const index = { type: Number, enum: Array.from({ length: spaces.rooms.length }, (_, i) => i) };
    const routes = await request('connections', {
      corridors: list({ fromRoom: index, toRoom: index, style: C.choice(['L', 'H', 'V']), width: { type: Number, enum: [2, 3, 4] }, ramp: Boolean }, header.roomCount - 1, header.roomCount + 3),
      modules: list({ type: C.choice(modules), room: index, ...xy, width: num(3, 25), height: num(5, 32), roofStyle: C.choice(roof) }, 0, 3)
    }, { corridors: { min: header.roomCount - 1, max: header.roomCount + 3, batch: 3 }, modules: { min: 0, max: 3, batch: 1 } }, spaces);
    result = { base: header.base, indoorPlan: { roomCount: header.roomCount, rooms: spaces.rooms, corridors: routes.corridors,
      modules: routes.modules, heightLevels: [...new Set(spaces.rooms.map(room => room.floor))] } };
  } else {
    const terrain = await request('terrain', { landforms: list({ kind: C.choice(['hill', 'ridge', 'mountain', 'mesa', 'butte', 'hoodoo', 'terraces', 'basin', 'cliff', 'canyon', 'thermal_basin', 'caldera']),
      ...xy, radiusX: num(.03, .7), radiusY: num(.03, .7), rise: num(1, 60), angle: num(0, 359) }, header.landformCount) },
      { landforms: { count: header.landformCount, max: 6, batch: 2 } }, header);
    const structures = await request('buildings', { buildings: list({ type: C.choice(['temple', 'castle', 'rotunda', 'bathhouse', 'catacomb', 'ruins', 'basilica', 'forum', 'villa', 'domus', 'warehouse', 'insula']),
      variant: C.choice(['gatehouse', 'stone-keep', 'shell-keep', 'motte-bailey', 'concentric', 'watchtower']), ...rectangle, ruined: Boolean }, header.buildingCount) },
      { buildings: { count: header.buildingCount, max: 3, batch: 1 } }, terrain);
    const routes = await request('paths', { paths: list({ from: { type: [num(0, 1)], minItems: 2, maxItems: 2 },
      to: { type: [num(0, 1)], minItems: 2, maxItems: 2 }, widthTiles: num(3, 8), ramp: { type: Boolean, enum: [true] } }, 3, 8) },
      { paths: { min: 3, max: 8, batch: 2 } }, { ...terrain, ...structures });
    result = { base: header.base, ...terrain, ...structures, ...routes };
  }
  if (ids.length) {
    const dressed = await request('scenery', { props: list({ type: C.choice(ids), ...xy, scale: num(.5, 1.4) }, 3, 8) },
      { props: { min: 3, max: 8, batch: 3 } }, indoor ? { rooms: result.indoorPlan.rooms } : { buildings: result.buildings });
    result.props = dressed.props;
  } else result.props = [];
  result.seed = generation?.seed || 'local-blueprint';
  console.info('[HolodekWork]', JSON.stringify({ component: 'dungeon-blueprint', phase: 'compiled', indoor,
    spaces: result.indoorPlan?.rooms.length, landforms: result.landforms?.length, props: result.props.length }));
  return result;
}
module.exports = { generate };
