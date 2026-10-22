'use strict';
// world1 PYRAMIDS: an optional decorative pass AFTER normal wasteland generation. It never edits the wasteland
// generation rules, exits, routes or the 0,0,0 temple; it only adds one scene structure on already-free floor.
const Flags = require('./worldFlags');
const C = require('../assets/designCatalog');
const LABELS = { pyramid_stepped: 'Stepped pyramid', pyramid_smooth: 'Smooth-faced pyramid', pyramid_ruined: 'Ruined pyramid', ziggurat_terraced: 'Terraced ziggurat' };
function isWasteland(dungeon, sceneSpec, geoKey) {
  if (geoKey === '0,0,0' || geoKey === '0,1,0') return false;
  const text = `${sceneSpec?.roomName || ''} ${sceneSpec?.source?.description || ''} ${dungeon?.classification?.biome || ''}`.toLowerCase();
  return dungeon?.classification?.indoor !== true && /wasteland|badland|desert|dune|barren|salt flat|waste\b/.test(text);
}
function apply(dungeon, sceneSpec, geoKey, { chance = 45 } = {}) {
  if (!Flags.on('PYRAMIDS') || !dungeon?.cells || !dungeon.layout) return { status: 'skipped' };
  if (dungeon.pyramidFeature) return { status: 'already-built', shape: dungeon.pyramidFeature.shape };
  if (!isWasteland(dungeon, sceneSpec, geoKey)) return { status: 'not-wasteland' };
  const seed = C.hash(`${geoKey}:${sceneSpec?.roomName || ''}`);
  if (seed % 100 >= chance) return { status: 'none-here' };
  const shape = C.PYRAMIDS[seed % C.PYRAMIDS.length], foot = 5 + seed % 3;
  const { width, height } = dungeon.layout, start = dungeon.start || { x: 0, y: 0 };
  const blocked = k => { const c = dungeon.cells[k]; return !c || c.tile !== 'floor' || c.navigationReserved || c.exitMarker || c.exit || c.object || c.feature; };
  let best = null;
  for (let y = 1; y + foot < height - 1; y++) for (let x = 1; x + foot < width - 1; x++) {
    let ok = true;
    for (let j = -1; j <= foot && ok; j++) for (let i = -1; i <= foot && ok; i++) if (blocked(`${x + i},${y + j}`)) ok = false;
    if (!ok) continue;
    const d = Math.hypot(x + foot / 2 - start.x, y + foot / 2 - start.y);
    if (d < 6) continue;
    const score = d + (C.hash(`${x},${y},${seed}`) % 7);
    if (!best || score > best.score) best = { x, y, score };
  }
  if (!best) return { status: 'no-space' };
  const floor = dungeon.cells[`${best.x},${best.y}`].floorHeight || 0, lore = C.PYRAMID_LORE[(seed >>> 3) % C.PYRAMID_LORE.length];
  const tile = `world1_${shape}`;
  dungeon.tiles ||= {}; dungeon.sceneStructures ||= [];
  dungeon.tiles[tile] = { url: dungeon.tiles.wall?.url, spriteSpec: { voxelShape: shape, material: 'stone', collisionBlocking: false, profile: 'flat', heightRatio: 1, baseWidth: 1, gridWidth: 1 },
    landmark: { type: 'pyramid', label: LABELS[shape], lore } };
  dungeon.sceneStructures.push({ tile, shape, role: 'world1-pyramid', position: { x: best.x, y: best.y, z: floor }, size: { x: foot, y: foot, z: foot * .7 } });
  (dungeon.sceneLandmarks ||= []).push({ x: best.x + Math.floor(foot / 2), y: best.y, type: 'pyramid', label: LABELS[shape], lore });
  dungeon.pyramidFeature = { version: 1, shape, label: LABELS[shape], lore, at: { x: best.x, y: best.y }, footprint: foot };
  return { status: 'built', shape, at: dungeon.pyramidFeature.at, lore };
}
module.exports = { apply, isWasteland, LABELS };
