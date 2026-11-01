'use strict';
const Kits = require('../assets/genreKits');
const Architecture = require('../assets/genreArchitecture');
const V = require('../assets/scenePropVoxels');
const AV = require('./assemblyVocab');
const VERSION = 1;
const unique = values => [...new Set(values.filter(Boolean))];
const current = () => require('./settingLayer').current();
const ENGINE_SHAPE = /^(?:puzzle_[a-z0-9_]+|exit_[a-z0-9_]+|secret_wall)$/;
const NEUTRAL = ['boulder', 'rock_face', 'pool', 'barrel', 'table', 'crate', 'rubble'];
const sprites = new Map();
function sprite(shape) {
  if (!Kits.has(shape)) return null;
  if (!sprites.has(shape)) {
    const canvas = require('canvas').createCanvas(128, 128);
    Kits.paint(canvas.getContext('2d'), shape, 0, 0, 128, 128);
    sprites.set(shape, canvas.toDataURL('image/png'));
    if (sprites.size > 128) sprites.delete(sprites.keys().next().value);
  }
  return sprites.get(shape);
}

function catalog(room = {}, setting = current()) {
  room ||= {};
  const resolved = Kits.resolve(room, setting);
  const genres = resolved.homebrew ? resolved.mix.filter(row => row.weight > 0).map(row => row.genre) : Kits.COTG_ALLOWED;
  const classical = genres.some(genre => Kits.COTG_ALLOWED.includes(genre));
  const registered = unique([...Object.keys(V.architecture), ...Object.keys(V.vegetation), ...Object.keys(V.biomeProps)]);
  const native = Kits.SHAPES.filter(shape => Kits.OWNER[shape]?.some(genre => genres.includes(genre)));
  const shapes = unique([...native, ...(classical ? registered.filter(shape => !Kits.has(shape) && !ENGINE_SHAPE.test(shape)) : NEUTRAL.filter(shape => registered.includes(shape)))]);
  const styles = genres.map(genre => Architecture.STYLES[genre]).filter(Boolean);
  const material = Architecture.STYLES[resolved.genre]?.ceiling === 'metal' || /metal|brass|concrete|rust/.test(resolved.voxel) ? 'metal' :
    resolved.voxel === 'wood' ? 'wood' : 'stone';
  const materials = classical ? AV.MATERIALS : unique([material, 'metal', 'wood', 'stone', 'crystal', 'cloth']);
  const clothing = Object.fromEntries(['head','torso','legs'].map(part => [part, unique(genres.flatMap(g => Kits.GENRES[g].clothing[part]))]));
  return { version: VERSION, strict: resolved.homebrew, classical, genre: resolved.genre, genres, shapes,
    material, materials, palette: resolved.palette, clothing,
    held: unique(genres.flatMap(g => Kits.GENRES[g].held)), gear: unique(genres.flatMap(g => Kits.GENRES[g].gear)),
    lights: unique(genres.flatMap(g => [...Kits.GENRES[g].lights, ...require('../assets/genreLights').forGenre(g)])),
    textures: Object.fromEntries(['wall','floor','ceiling','door'].map(part => [part, unique(styles.map(style => style[part]))])),
    roofs: classical ? ['stone','barrel','groin','ribbed','fan','coffered','timber','hammerbeam','boarded','gold-coffered','pendentive','squinch','domed'] :
      material === 'wood' ? ['timber','boarded','pitched'] : ['panel'],
    columns: classical ? ['doric','ionic','corinthian'] : ['plain'],
    modules: classical ? null : ['terrace','raised_gallery','staircase','switchback_stair','split_raised_gallery','courtyard'],
    buildings: classical ? null : ['warehouse','infrastructure'],
    wallStyles: classical ? AV.WALL_STYLES : material === 'wood' ? ['timber'] : material === 'metal' ? ['metal_plate'] : ['brick','rough_hewn'],
    floorTreatments: classical ? AV.FLOOR_TREAT : material === 'wood' ? ['planks'] : material === 'metal' ? ['flagstone'] : ['cobble','packed_earth'] };
}

function directive(room = {}, setting = current()) {
  const c = catalog(room, setting);
  // Most consumers need direction, not the full catalog repeated in every small work order.
  // Selection contracts expose the complete enum separately.
  const shapes = c.strict ? c.shapes : c.shapes.filter(Kits.has).slice(0, 16);
  return 'APPROVED PROCEDURAL ASSETS (authoritative): ' + JSON.stringify({ version: VERSION,
    genres: c.genres, shapes: shapes.slice(0, 24), textures: c.textures }) +
    '. Select IDs only from the complete enum in the requested answer schema; these examples are not a checklist. Labels, histories and layout remain creative; asset IDs do not. ' +
    'No foreign genre assets or freeform drawing programs. Puzzle devices, actors, loot and exits are installed by their own engine systems.';
}

function replacement(shape, c, role = '') {
  if (c.shapes.includes(shape)) return shape;
  const text = `${shape || ''} ${role}`;
  const structural = /roof|ceiling|vault|dome|coffer|slab/.test(text) ? 'roof_panel' :
    /entablature|beam|rib|truss|lintel|cornice|pediment|corbel/.test(text) ? 'beam' :
    /column|pillar|pier|post|buttress|support/.test(text) ? 'support' : null;
  const candidates = structural ? [`g_${c.genre}_${structural}`] :
    /gate|arch|door/.test(text) ? [`x_${c.genre}_gate`, ...Kits.GENRES[c.genre].building] :
    /wall|building|house|hall/.test(text) ? [`x_${c.genre}_hall`, ...Kits.GENRES[c.genre].building] : Kits.GENRES[c.genre].props;
  const selected = candidates.find(id => c.shapes.includes(id)) || c.shapes[0];
  if (!selected) throw Error('No registered assets for genre ' + c.genre);
  return selected;
}

function restrictScene(spec, setting = current()) {
  const c = catalog(spec, setting);
  if (!c.strict) return spec;
  for (const lm of spec.landmarks || []) {
    const shape = replacement(V.select(lm.type, lm.assembly, lm.prim), c, lm.label || lm.type);
    lm.prim = { ...lm.prim, shape };
    // The native shape is authoritative; a generic assembly must not turn a console into an altar.
    if (Kits.has(shape)) lm.assembly = lm.prim.assembly = { ...lm.assembly, kit: 'generic', material: c.material };
  }
  return spec;
}

function scopeBlueprint(blueprint, room = {}, setting = current()) {
  const c = catalog(room, setting);
  if (!c.strict || c.classical || !blueprint) return blueprint;
  const result = { ...blueprint };
  if (blueprint.indoorPlan) result.indoorPlan = { ...blueprint.indoorPlan,
    rooms: (blueprint.indoorPlan.rooms || []).map(r => ({ ...r, roofStyle: c.roofs.includes(r.roofStyle) ? r.roofStyle : c.roofs[0], columnOrder: 'plain' })),
    modules: (blueprint.indoorPlan.modules || []).filter(m => c.modules.includes(m.type)).map(m => ({ ...m, roofStyle: c.roofs[0] })) };
  if (blueprint.buildings) result.buildings = blueprint.buildings.filter(b => c.buildings.includes(b.type));
  return result;
}

// This changes visual descriptors only: never cells, positions, collision extents, actors or puzzle state.
function enforceDungeon(dungeon, spec = dungeon?.sceneSpec || {}, setting = current()) {
  if (!dungeon) return { changed: 0 };
  const c = catalog({ ...spec, genreKit: dungeon.genreKit, planarRealm: spec.worldContext?.planarRealm }, setting);
  if (!c.strict) return { changed: 0 };
  const changes = [];
  for (const [tile, entry] of Object.entries(dungeon.tiles || {})) {
    const original = entry?.spriteSpec?.voxelShape;
    if ((ENGINE_SHAPE.test(original || '') && V.architecture[original]) || entry?.spriteSpec?.puzzleControl) continue;
    if (!original && tile !== 'pillar') continue;
    // Natural ground cover is an approved shared suite outdoors, not a reason to plant dead trees in a station.
    if (spec.indoor === false && (V.vegetation[original] || V.biomeProps[original])) continue;
    const shape = replacement(original, c, tile === 'pillar' ? 'support' : tile);
    if (shape === original) continue;
    entry.spriteSpec = { ...entry.spriteSpec, voxelShape: shape, material: c.material, palette: { ...c.palette } };
    const url = sprite(shape);
    if (url) entry.url = url;
    changes.push({ tile, from: original || 'legacy-pillar', to: shape });
  }
  for (const part of dungeon.sceneStructures || []) {
    const shape = dungeon.tiles?.[part.tile]?.spriteSpec?.voxelShape;
    if (shape && part.shape !== shape) part.shape = shape;
  }
  dungeon.genreAssetPolicy = { version: VERSION, genres: c.genres, changed: changes.length, changes };
  return { changed: changes.length, changes };
}

async function generateTiles($, { roomDesc, puzzleDesc, requiredTypes = [] }) {
  const C = require('./generationContracts'), c = catalog();
  const ids = unique(requiredTypes), slots = ids.length ? ids : [null, null];
  const tiles = [];
  for (const id of slots) {
    await $.user(`Select an approved ${c.genres.join('/')} asset for ${id || 'this room'}. Room: ${roomDesc}. Puzzle context: ${puzzleDesc || 'none'}. Choose a shape ID from the requested enum, never invent one.`);
    const result = await C.request($, { component: 'genre-scenery', parameters: { shape: C.choice(c.shapes) },
      localWork: { brief: `Choose ONE approved physical asset for ${JSON.stringify(id || 'a distinct fitting room landmark')}. Room data: ${JSON.stringify({ roomDesc, puzzleDesc })}. Genres: ${c.genres.join(', ')}. Previously selected: ${tiles.map(t => t.spriteSpec.voxelShape).join(', ')}. No actors, loot, puzzle controls or invented asset IDs.`, arrays: {} },
      validate(value) { if (!c.shapes.includes(value.shape)) throw Error('Unapproved genre shape.'); return value; } });
    if (!result.value) throw result.error || Error('No approved genre scenery selected.');
    tiles.push({ type: id || result.value.shape, label: id || result.value.shape,
      spriteSpec: { voxelShape: result.value.shape, material: c.material, palette: c.palette, profile: 'flat', heightRatio: 1, baseWidth: .6, gridWidth: .6 },
      procedure: { material: c.material, primitives: [], program: [] } });
  }
  return tiles;
}
module.exports = { VERSION, catalog, directive, replacement, restrictScene, scopeBlueprint, enforceDungeon, generateTiles };
